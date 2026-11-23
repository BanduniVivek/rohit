import { Router } from 'express';
import { AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';
import { updateUserProfile } from '../modules/identity/identity.service.ts';
import { addSavedLocation, getRiderMe } from '../modules/riders/riders.service.ts';
import {
  BENGALURU_LANDMARKS,
  findNearbyEligibleDrivers,
  getActiveServiceArea,
  upsertDriverLocation,
} from '../modules/location/location.service.ts';
import { calculateFareEstimates, getActiveFareConfigs } from '../modules/pricing/pricing.service.ts';
import {
  getDriverByUserId,
  getDriverEarningsLedger,
  onboardDriver,
  setDriverAvailability,
} from '../modules/drivers/drivers.service.ts';
import {
  acceptRideRequest,
  getDriverIncomingRequests,
  rejectRideRequest,
  triggerDemoDriverMatch,
} from '../modules/dispatch/dispatch.service.ts';
import {
  cancelRideTrip,
  completeRideTrip,
  createRideBooking,
  getDriverActiveRide,
  getRideDetails,
  getRiderRides,
  markDriverArrived,
  startTripWithOtp,
  submitRideRating,
} from '../modules/rides/rides.service.ts';
import { createPaymentOrder, processPaymentWebhook } from '../modules/payments/payments.service.ts';
import {
  createSupportTicket,
  listAllTicketsAndSos,
  listUserSupportTickets,
  resolveSupportTicket,
  triggerSosEvent,
} from '../modules/support/support.service.ts';
import {
  decideDriverVerification,
  ensureSeededCityData,
  getAdminDashboardSummary,
  listAllDriversAdmin,
  listAuditLogsAdmin,
  listRidesAdmin,
  updateFareConfigAdmin,
  updateServiceAreaAdmin,
} from '../modules/admin/admin.service.ts';
import { publishDomainEvent } from '../platform/events/bus.ts';

export const v1Router = Router();

// Lazy seed check middleware (no startup probe)
v1Router.use(async (_req, _res, next) => {
  await ensureSeededCityData();
  next();
});

// Identity (scoped by X-App-Portal header)
v1Router.get('/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = req.authUser!.role;
    const riderData = role === 'RIDER' ? await getRiderMe(req.authUser!.id) : { profile: null };
    const driverData = role === 'DRIVER' ? await getDriverByUserId(req.authUser!.id) : null;
    res.json({
      user: req.authUser,
      riderProfile: riderData.profile,
      driverProfile: driverData,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load session profile' });
  }
});

const INDIA_FALLBACK_HUBS = [
  { id: 'nit-trichy', name: 'NIT Trichy', address: 'National Institute of Technology, Thuvakudi, Tiruchirappalli, Tamil Nadu 620015', lat: 10.7634, lng: 78.8150 },
  { id: 'trichy-airport', name: 'Tiruchirappalli International Airport (TRZ)', address: 'Trichy Airport, Pudukkottai Main Rd, Tiruchirappalli, Tamil Nadu 620007', lat: 10.7654, lng: 78.7097 },
  { id: 'trichy-junction', name: 'Tiruchirappalli Junction', address: 'Trichy Railway Junction, Cantonment, Tiruchirappalli, Tamil Nadu 620001', lat: 10.8005, lng: 78.6869 },
  { id: 'chennai-airport', name: 'Chennai International Airport', address: 'Meenambakkam, Chennai, Tamil Nadu 600027', lat: 12.9941, lng: 80.1709 },
  { id: 'bengaluru-indiranagar', name: 'Indiranagar 100ft Rd', address: '100 Feet Road, Indiranagar, Bengaluru, Karnataka', lat: 12.9784, lng: 77.6408 },
  { id: 'bengaluru-mg-road', name: 'MG Road Metro', address: 'Mahatma Gandhi Road, Bengaluru, Karnataka', lat: 12.9756, lng: 77.6066 },
  { id: 'delhi-igi', name: 'Indira Gandhi International Airport', address: 'New Delhi, Delhi 110037', lat: 28.5562, lng: 77.1000 },
  { id: 'mumbai-csmia', name: 'Chhatrapati Shivaji Maharaj International Airport', address: 'Mumbai, Maharashtra 400099', lat: 19.0896, lng: 72.8656 },
  { id: 'hyderabad-rgia', name: 'Hyderabad Rajiv Gandhi Airport', address: 'Shamshabad, Hyderabad, Telangana 500409', lat: 17.2403, lng: 78.4294 },
];

// All-India Geocoding & Street Routing Proxy (Nominatim + Photon + OSRM)
v1Router.get('/geo/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ results: [] });
  }

  const results: Array<{ id: string; name: string; address: string; lat: number; lng: number }> = [];
  const seen = new Set<string>();

  const pushUnique = (item: { id: string; name: string; address: string; lat: number; lng: number }) => {
    if (Number.isNaN(item.lat) || Number.isNaN(item.lng)) return;
    const key = `${item.lat.toFixed(3)},${item.lng.toFixed(3)}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(item);
    }
  };

  // 1. Query OpenStreetMap Nominatim scoped to India
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&limit=6&addressdetails=1&q=${encodeURIComponent(
      q
    )}`;
    const response = await fetch(nomUrl, {
      headers: {
        'User-Agent': 'MetroRideIndiaPlatform/1.0 (https://metroride.city)',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (response.ok) {
      const data = (await response.json()) as any[];
      for (const item of data) {
        const displayName = String(item.display_name || '');
        pushUnique({
          id: `nom-${item.place_id}`,
          name: item.name ? String(item.name) : displayName.split(',')[0],
          address: displayName,
          lat: Number(item.lat),
          lng: Number(item.lon),
        });
      }
    }
  } catch {
    // Fallback to Photon below
  }

  // 2. Query Photon (OSM fuzzy geocoder) for abbreviations like "NIT Trichy", "Trichy Airport", etc.
  if (results.length < 4) {
    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
        q
      )}&limit=8&lat=20.5937&lon=78.9629`;
      const response = await fetch(photonUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = (await response.json()) as any;
        const features = Array.isArray(data?.features) ? data.features : [];
        for (const f of features) {
          const props = f.properties || {};
          if (props.countrycode && String(props.countrycode).toUpperCase() !== 'IN') continue;
          const coords = f.geometry?.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) continue;
          const name = props.name || props.street || props.city || q;
          const parts = [props.name, props.street, props.district, props.city, props.state, props.postcode]
            .filter(Boolean)
            .filter((v, idx, arr) => arr.indexOf(v) === idx);
          pushUnique({
            id: `ph-${props.osm_id || Math.random()}`,
            name: String(name),
            address: parts.join(', ') || String(name),
            lat: Number(coords[1]),
            lng: Number(coords[0]),
          });
        }
      }
    } catch {
      // ignore network timeout
    }
  }

  // 3. Local India hub matches if upstream calls failed or returned empty
  const lowerQ = q.toLowerCase();
  const localMatches = INDIA_FALLBACK_HUBS.filter(
    (h) => h.name.toLowerCase().includes(lowerQ) || h.address.toLowerCase().includes(lowerQ)
  );
  for (const m of localMatches) {
    pushUnique(m);
  }

  res.json({ results: results.slice(0, 8) });
});

v1Router.get('/geo/reverse', requireAuth, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'Valid lat/lng required' });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MetroRideIndiaPlatform/1.0 (https://metroride.city)',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(4500),
    });
    if (response.ok) {
      const data = (await response.json()) as any;
      if (data?.display_name) {
        return res.json({ address: String(data.display_name) });
      }
    }
  } catch {
    // fallback below
  }

  res.json({ address: `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` });
});

v1Router.get('/geo/route', requireAuth, async (req, res) => {
  const pLat = Number(req.query.pickupLat);
  const pLng = Number(req.query.pickupLng);
  const dLat = Number(req.query.dropLat);
  const dLng = Number(req.query.dropLng);

  if ([pLat, pLng, dLat, dLng].some(Number.isNaN)) {
    return res.status(400).json({ error: 'Valid coordinates required' });
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${pLng},${pLat};${dLng},${dLat}?overview=full&geometries=geojson`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = (await response.json()) as any;
      const route = data?.routes?.[0];
      if (route?.geometry?.coordinates?.length) {
        const coords: [number, number][] = route.geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng]
        );
        return res.json({
          coordinates: coords,
          distanceKm: Number((route.distance / 1000).toFixed(2)),
          durationMin: Math.max(2, Math.round(route.duration / 60)),
        });
      }
    }
  } catch {
    // Fallback interpolated route points
  }

  const steps = 18;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    coords.push([pLat + (dLat - pLat) * t, pLng + (dLng - pLng) * t]);
  }
  res.json({ coordinates: coords, distanceKm: null, durationMin: null });
});

// City & Map Context
v1Router.get('/city/context', requireAuth, async (req: AuthRequest, res) => {
  try {
    const area = await getActiveServiceArea();
    const lat = Number(req.query.lat) || area?.centerLat || 12.9716;
    const lng = Number(req.query.lng) || area?.centerLng || 77.5946;
    const showAllIndia = req.authUser?.role === 'ADMIN' || req.query.all === 'true';
    const nearbyDrivers = await findNearbyEligibleDrivers({
      pickupLat: lat,
      pickupLng: lng,
      radiusKm: showAllIndia ? 5000 : 100,
    });
    const fareConfigs = await getActiveFareConfigs();
    res.json({
      serviceArea: area,
      landmarks: BENGALURU_LANDMARKS,
      nearbyDrivers,
      fareConfigs,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch city context' });
  }
});

// Rider Endpoints (strictly RIDER role)
v1Router.get('/riders/me', requireAuth, requireRole(['RIDER']), async (req: AuthRequest, res) => {
  try {
    const data = await getRiderMe(req.authUser!.id);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch rider profile' });
  }
});

v1Router.put('/riders/me', requireAuth, requireRole(['RIDER']), async (req: AuthRequest, res) => {
  try {
    const updated = await updateUserProfile(req.authUser!.id, {
      name: req.body?.name,
      phone: req.body?.phone,
      emergencyContactName: req.body?.emergencyContactName,
      emergencyContactPhone: req.body?.emergencyContactPhone,
    });
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to update profile' });
  }
});

v1Router.post(
  '/riders/saved-locations',
  requireAuth,
  requireRole(['RIDER']),
  async (req: AuthRequest, res) => {
    try {
      const { label, address, lat, lng } = req.body || {};
      if (!label || !address || typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: 'Invalid location payload' });
      }
      const updated = await addSavedLocation(req.authUser!.id, { label, address, lat, lng });
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to save location' });
    }
  }
);

v1Router.get('/rides/estimate', requireAuth, requireRole(['RIDER']), async (req, res) => {
  try {
    const pickupLat = Number(req.query.pickupLat);
    const pickupLng = Number(req.query.pickupLng);
    const dropLat = Number(req.query.dropLat);
    const dropLng = Number(req.query.dropLng);

    if ([pickupLat, pickupLng, dropLat, dropLng].some((v) => Number.isNaN(v))) {
      return res.status(400).json({ error: 'Valid pickup and drop coordinates are required' });
    }

    const estimates = await calculateFareEstimates(pickupLat, pickupLng, dropLat, dropLng);
    res.json({ estimates });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to estimate fare' });
  }
});

v1Router.get('/rides/me', requireAuth, requireRole(['RIDER']), async (req: AuthRequest, res) => {
  try {
    const list = await getRiderRides(req.authUser!.id);
    res.json({ rides: list });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load rides' });
  }
});

v1Router.post('/rides', requireAuth, requireRole(['RIDER']), async (req: AuthRequest, res) => {
  try {
    const {
      idempotencyKey,
      vehicleType,
      pickupAddress,
      pickupLat,
      pickupLng,
      dropAddress,
      dropLat,
      dropLng,
      paymentMethod,
    } = req.body || {};

    if (!idempotencyKey || !vehicleType || !pickupAddress || !dropAddress) {
      return res.status(400).json({ error: 'Missing required booking fields' });
    }

    const ride = await createRideBooking({
      riderId: req.authUser!.id,
      idempotencyKey: String(idempotencyKey),
      vehicleType: String(vehicleType),
      pickupAddress: String(pickupAddress),
      pickupLat: Number(pickupLat),
      pickupLng: Number(pickupLng),
      dropAddress: String(dropAddress),
      dropLat: Number(dropLat),
      dropLng: Number(dropLng),
      paymentMethod: paymentMethod === 'ONLINE' ? 'ONLINE' : 'CASH',
    });

    res.status(201).json({ ride });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to create booking' });
  }
});

v1Router.get('/rides/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const details = await getRideDetails(String(req.params.id), req.authUser!.id, req.authUser!.role);
    if (!details) return res.status(404).json({ error: 'Ride not found' });
    res.json(details);
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 400;
    res.status(status).json({ error: error.message || 'Failed to fetch ride' });
  }
});

v1Router.post(
  '/rides/:id/demo-match',
  requireAuth,
  requireRole(['RIDER']),
  async (req: AuthRequest, res) => {
    try {
      const matched = await triggerDemoDriverMatch(String(req.params.id));
      if (!matched) {
        return res
          .status(404)
          .json({ error: 'No online driver available for auto-match right now' });
      }
      res.json({ ride: matched });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Demo match failed' });
    }
  }
);

v1Router.post('/rides/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
  try {
    const reason = String(req.body?.reason || 'Plan changed');
    const ride = await cancelRideTrip({
      rideId: String(req.params.id),
      actorUserId: req.authUser!.id,
      actorRole: req.authUser!.role,
      reason,
    });
    res.json({ ride });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to cancel ride' });
  }
});

v1Router.post(
  '/rides/:id/rate',
  requireAuth,
  requireRole(['RIDER']),
  async (req: AuthRequest, res) => {
    try {
      const score = Number(req.body?.score);
      const review = req.body?.review ? String(req.body.review) : undefined;
      const rating = await submitRideRating({
        rideId: String(req.params.id),
        raterId: req.authUser!.id,
        score,
        review,
      });
      res.status(201).json({ rating });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to submit rating' });
    }
  }
);

// Driver Endpoints (strictly DRIVER role)
v1Router.post(
  '/drivers/onboarding',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const {
        name,
        phone,
        licenceNumber,
        licenceExpiry,
        aadhaarNumber,
        licenceDocRef,
        aadhaarDocRef,
        rcDocRef,
        registrationNumber,
        category,
        make,
        model,
        colour,
        lat,
        lng,
      } = req.body || {};

      if (
        !name ||
        !phone ||
        !licenceNumber ||
        !licenceExpiry ||
        !aadhaarNumber ||
        !licenceDocRef ||
        !aadhaarDocRef ||
        !registrationNumber ||
        !category ||
        !make ||
        !model
      ) {
        return res.status(400).json({
          error:
            'Please fill all driver details, vehicle details, Driving Licence, and Aadhaar Card documents.',
        });
      }

      const driver = await onboardDriver(req.authUser!.id, {
        name,
        phone,
        licenceNumber,
        licenceExpiry,
        aadhaarNumber,
        licenceDocRef,
        aadhaarDocRef,
        rcDocRef,
        registrationNumber,
        category,
        make,
        model,
        colour: colour || 'White',
        lat: lat ? Number(lat) : undefined,
        lng: lng ? Number(lng) : undefined,
      });
      res.status(201).json({ driver });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Driver onboarding failed' });
    }
  }
);

v1Router.get('/drivers/me', requireAuth, requireRole(['DRIVER']), async (req: AuthRequest, res) => {
  try {
    const data = await getDriverByUserId(req.authUser!.id);
    res.json({ driverProfile: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch driver profile' });
  }
});

v1Router.patch(
  '/drivers/me/availability',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const isOnline = Boolean(req.body?.isOnline);
      const driver = await setDriverAvailability(req.authUser!.id, isOnline);
      res.json({ driver });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to update availability' });
    }
  }
);

v1Router.post(
  '/drivers/me/location',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const driverData = await getDriverByUserId(req.authUser!.id);
      if (!driverData) return res.status(404).json({ error: 'Driver profile not found' });

      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: 'Valid lat/lng required' });
      }

      const loc = await upsertDriverLocation({
        driverId: driverData.driver.id,
        lat,
        lng,
        heading: Number(req.body?.heading) || 0,
        speed: Number(req.body?.speed) || 20,
      });

      const active = await getDriverActiveRide(req.authUser!.id);
      const rooms = ['admin:ops', `driver:${driverData.driver.id}`];
      if (active) {
        rooms.push(`ride:${active.ride.id}`);
        rooms.push(`user:${active.ride.riderId}`);
      }

      await publishDomainEvent({
        eventType: 'driver.location.updated',
        aggregateType: 'driver_location',
        aggregateId: driverData.driver.id,
        payload: {
          driverId: driverData.driver.id,
          lat: loc.lat,
          lng: loc.lng,
          heading: loc.heading,
        },
        rooms,
      });

      res.json({ location: loc });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to update location' });
    }
  }
);

v1Router.get(
  '/drivers/me/earnings',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const ledger = await getDriverEarningsLedger(req.authUser!.id);
      res.json(ledger);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load earnings' });
    }
  }
);

v1Router.get(
  '/drivers/me/active-ride',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const active = await getDriverActiveRide(req.authUser!.id);
      res.json({ activeRide: active });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load active ride' });
    }
  }
);

v1Router.get(
  '/drivers/me/ride-requests',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const requests = await getDriverIncomingRequests(req.authUser!.id);
      res.json({ requests });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load ride requests' });
    }
  }
);

v1Router.post(
  '/ride-requests/:id/accept',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const ride = await acceptRideRequest(String(req.params.id), req.authUser!.id);
      res.json({ ride });
    } catch (error: any) {
      const status = error.message?.includes('already') ? 409 : 400;
      res.status(status).json({ error: error.message || 'Failed to accept request' });
    }
  }
);

v1Router.post(
  '/ride-requests/:id/reject',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const result = await rejectRideRequest(String(req.params.id), req.authUser!.id);
      res.json({ request: result });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to reject request' });
    }
  }
);

v1Router.post(
  '/rides/:id/arrive',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const ride = await markDriverArrived(String(req.params.id), req.authUser!.id);
      res.json({ ride });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to mark arrival' });
    }
  }
);

v1Router.post(
  '/rides/:id/start',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const otp = String(req.body?.otp || '');
      const ride = await startTripWithOtp(String(req.params.id), req.authUser!.id, otp);
      res.json({ ride });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to start trip' });
    }
  }
);

v1Router.post(
  '/rides/:id/complete',
  requireAuth,
  requireRole(['DRIVER']),
  async (req: AuthRequest, res) => {
    try {
      const cashCollected = Boolean(req.body?.cashCollected);
      const ride = await completeRideTrip(String(req.params.id), req.authUser!.id, cashCollected);
      res.json({ ride });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to complete trip' });
    }
  }
);

// Payments & Webhooks
v1Router.post(
  '/rides/:id/payment-orders',
  requireAuth,
  requireRole(['RIDER']),
  async (req: AuthRequest, res) => {
    try {
      const method = req.body?.method === 'CARD' ? 'CARD' : req.body?.method === 'UPI' ? 'UPI' : 'CASH';
      const idempotencyKey = String(req.body?.idempotencyKey || `pay-${req.params.id}-${method}`);
      const order = await createPaymentOrder({
        rideId: String(req.params.id),
        riderId: req.authUser!.id,
        method,
        idempotencyKey,
      });
      res.status(201).json({ payment: order });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to create payment order' });
    }
  }
);

v1Router.post('/payments/webhooks/:provider', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { providerTransactionId, status } = req.body || {};
    if (!providerTransactionId || !['PAID', 'FAILED', 'REFUNDED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }
    const result = await processPaymentWebhook({
      provider: String(req.params.provider),
      providerTransactionId: String(providerTransactionId),
      status,
      actorId: req.authUser!.id,
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Webhook processing failed' });
  }
});

// Support & SOS
v1Router.post('/support/tickets', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { rideId, category, description } = req.body || {};
    if (!category || !description) {
      return res.status(400).json({ error: 'Category and description are required' });
    }
    const ticket = await createSupportTicket({
      creatorId: req.authUser!.id,
      rideId: rideId || undefined,
      category: String(category),
      description: String(description),
    });
    res.status(201).json({ ticket });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to create support ticket' });
  }
});

v1Router.get('/support/tickets', requireAuth, async (req: AuthRequest, res) => {
  try {
    const tickets = await listUserSupportTickets(req.authUser!.id);
    res.json({ tickets });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch support tickets' });
  }
});

v1Router.post('/support/sos', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { rideId, lat, lng, notes } = req.body || {};
    const sos = await triggerSosEvent({
      userId: req.authUser!.id,
      rideId: rideId || undefined,
      lat: Number(lat) || 12.9716,
      lng: Number(lng) || 77.5946,
      notes,
    });
    res.status(201).json({ sos });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to trigger SOS' });
  }
});

// Admin Operations (strictly ADMIN role)
v1Router.get('/admin/dashboard', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const summary = await getAdminDashboardSummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load dashboard KPIs' });
  }
});

v1Router.get('/admin/drivers', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const drivers = await listAllDriversAdmin();
    res.json({ drivers });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load drivers' });
  }
});

v1Router.post('/admin/drivers/:id/decision', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const decision = req.body?.decision;
    if (!['APPROVED', 'REJECTED', 'SUSPENDED'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid verification decision' });
    }
    const updated = await decideDriverVerification({
      driverId: String(req.params.id),
      adminUserId: req.authUser!.id,
      decision,
      reason: req.body?.reason,
    });
    res.json({ driver: updated });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to apply driver decision' });
  }
});

v1Router.get('/admin/rides', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const list = await listRidesAdmin();
    res.json({ rides: list });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch rides' });
  }
});

v1Router.get('/admin/fare-configs', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const configs = await getActiveFareConfigs();
    res.json({ fareConfigs: configs });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load fare configs' });
  }
});

v1Router.patch('/admin/fare-config', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const {
      vehicleType,
      baseFare,
      perKmRate,
      perMinRate,
      minimumFare,
      waitingFeePerMin,
      cancellationFee,
      commissionRatePct,
    } = req.body || {};

    if (!vehicleType) return res.status(400).json({ error: 'vehicleType required' });

    const created = await updateFareConfigAdmin({
      adminUserId: req.authUser!.id,
      vehicleType,
      baseFare,
      perKmRate,
      perMinRate,
      minimumFare,
      waitingFeePerMin: waitingFeePerMin || '2.00',
      cancellationFee: cancellationFee || '25.00',
      commissionRatePct: commissionRatePct || '15.00',
    });

    res.json({ fareConfig: created });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to update fare config' });
  }
});

v1Router.patch('/admin/service-area', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const updated = await updateServiceAreaAdmin({
      adminUserId: req.authUser!.id,
      cityName: String(req.body?.cityName || 'Bengaluru'),
      radiusKm: Number(req.body?.radiusKm || 20),
      operatingHours: String(req.body?.operatingHours || '05:00 - 23:59'),
      supportPhone: String(req.body?.supportPhone || '+91 80 4400 9100'),
      allowOutOfAreaDrop: Boolean(req.body?.allowOutOfAreaDrop),
      isActive: req.body?.isActive !== false,
    });
    res.json({ serviceArea: updated });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to update service area' });
  }
});

v1Router.get('/admin/support', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const data = await listAllTicketsAndSos();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch support queue' });
  }
});

v1Router.patch('/admin/support/tickets/:id', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const status = req.body?.status === 'RESOLVED' ? 'RESOLVED' : 'IN_REVIEW';
    const resolution = String(req.body?.resolution || 'Reviewed by city operations');
    const updated = await resolveSupportTicket(
      String(req.params.id),
      req.authUser!.id,
      status,
      resolution
    );
    res.json({ ticket: updated });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to update ticket' });
  }
});

v1Router.get('/admin/audit-logs', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const logs = await listAuditLogsAdmin();
    res.json({ auditLogs: logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load audit logs' });
  }
});
