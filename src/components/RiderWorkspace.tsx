import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  CreditCard,
  History,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Search,
  ShieldAlert,
  Star,
  User,
  Wallet,
} from 'lucide-react';
import { CityMap, MapDriver } from './CityMap';
import { PWAInstallButton } from './PWAInstallButton';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface GeoPlace {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface FareEstimate {
  vehicleType: string;
  label: string;
  etaMin: number;
  distanceKm: number;
  durationMin: number;
  estimatedFare: string;
  fareVersion: number;
  breakdown: {
    baseFare: string;
    distanceCharge: string;
    timeCharge: string;
    minimumAdjustment: string;
    minimumFare: string;
    cancellationFee: string;
    commissionRatePct: string;
  };
}

export const RiderWorkspace: React.FC = () => {
  const { appUser, riderProfile, socket, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<'book' | 'trips' | 'account'>('book');

  const [nearbyDrivers, setNearbyDrivers] = useState<MapDriver[]>([]);
  const [pickup, setPickup] = useState<{ address: string; lat: number; lng: number }>({
    address: 'National Institute of Technology, Thuvakudi, Tiruchirappalli, Tamil Nadu',
    lat: 10.7634,
    lng: 78.8150,
  });
  const [drop, setDrop] = useState<{ address: string; lat: number; lng: number }>({
    address: 'Tiruchirappalli International Airport, Tamil Nadu',
    lat: 10.7654,
    lng: 78.7097,
  });

  // Debounced India-wide search autocomplete states
  const [pickupQuery, setPickupQuery] = useState('NIT Trichy, Tiruchirappalli');
  const [dropQuery, setDropQuery] = useState('Trichy Airport, Tiruchirappalli');
  const [pickupSuggestions, setPickupSuggestions] = useState<GeoPlace[]>([]);
  const [dropSuggestions, setDropSuggestions] = useState<GeoPlace[]>([]);
  const [searchingField, setSearchingField] = useState<'pickup' | 'drop' | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const hasAutoLocatedRef = useRef(false);

  const [mapSelectMode, setMapSelectMode] = useState<'pickup' | 'drop' | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  const [estimates, setEstimates] = useState<FareEstimate[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('AUTO');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'ONLINE'>('CASH');
  const [showBreakdown, setShowBreakdown] = useState(false);

  const [ridesList, setRidesList] = useState<any[]>([]);
  const [activeRideDetail, setActiveRideDetail] = useState<any | null>(null);
  const [loadingBooking, setLoadingBooking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [cancelReason, setCancelReason] = useState('Change of plans');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingReview, setRatingReview] = useState('');
  const [supportCategory, setSupportCategory] = useState('FARE_DISPUTE');
  const [supportDesc, setSupportDesc] = useState('');
  const [tickets, setTickets] = useState<any[]>([]);

  const [profileName, setProfileName] = useState(appUser?.name || '');
  const [profilePhone, setProfilePhone] = useState(appUser?.phone || '');
  const [emergencyName, setEmergencyName] = useState(riderProfile?.emergencyContactName || '');
  const [emergencyPhone, setEmergencyPhone] = useState(riderProfile?.emergencyContactPhone || '');

  useEffect(() => {
    setProfileName(appUser?.name || '');
    setProfilePhone(appUser?.phone || '');
    setEmergencyName(riderProfile?.emergencyContactName || '');
    setEmergencyPhone(riderProfile?.emergencyContactPhone || '');
  }, [appUser, riderProfile]);

  const reverseGeocodeAndSet = useCallback(
    async (field: 'pickup' | 'drop', lat: number, lng: number, notice?: string) => {
      let resolvedAddress = `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      try {
        const res = await apiRequest<{ address: string }>(`/geo/reverse?lat=${lat}&lng=${lng}`);
        if (res.address) resolvedAddress = res.address;
      } catch {
        // fallback to coords
      }
      if (field === 'pickup') {
        setPickup({ address: resolvedAddress, lat, lng });
        setPickupQuery(resolvedAddress);
        setPickupSuggestions([]);
      } else {
        setDrop({ address: resolvedAddress, lat, lng });
        setDropQuery(resolvedAddress);
        setDropSuggestions([]);
      }
      if (notice) setStatusNotice(notice);
    },
    []
  );

  // Auto-detect real Rider GPS once on load (if permitted and no active ride)
  useEffect(() => {
    if (hasAutoLocatedRef.current || !navigator.geolocation) return;
    hasAutoLocatedRef.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lng = Number(pos.coords.longitude.toFixed(5));
        reverseGeocodeAndSet('pickup', lat, lng);
      },
      () => {
        // Keep current defaults if user declines browser GPS
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }, [reverseGeocodeAndSet]);

  const loadCityAndRides = useCallback(async () => {
    try {
      const [cityRes, ridesRes, ticketRes] = await Promise.all([
        apiRequest(`/city/context?lat=${pickup.lat}&lng=${pickup.lng}`),
        apiRequest('/rides/me'),
        apiRequest('/support/tickets'),
      ]);
      setNearbyDrivers(cityRes.nearbyDrivers || []);
      const list = ridesRes.rides || [];
      setRidesList(list);
      setTickets(ticketRes.tickets || []);

      const active = list.find((r: any) =>
        ['REQUESTED', 'SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(r.status)
      );
      if (active) {
        const detail = await apiRequest(`/rides/${active.id}`);
        setActiveRideDetail(detail);
      }
    } catch (err) {
      console.error(err);
    }
  }, [pickup.lat, pickup.lng]);

  useEffect(() => {
    loadCityAndRides();
  }, [loadCityAndRides]);

  // Fetch road route + fare estimates whenever pickup/drop change
  useEffect(() => {
    const pLat = activeRideDetail?.ride ? activeRideDetail.ride.pickupLat : pickup.lat;
    const pLng = activeRideDetail?.ride ? activeRideDetail.ride.pickupLng : pickup.lng;
    const dLat = activeRideDetail?.ride ? activeRideDetail.ride.dropLat : drop.lat;
    const dLng = activeRideDetail?.ride ? activeRideDetail.ride.dropLng : drop.lng;

    let cancelled = false;
    (async () => {
      try {
        const [estRes, routeRes] = await Promise.all([
          apiRequest<{ estimates: FareEstimate[] }>(
            `/rides/estimate?pickupLat=${pLat}&pickupLng=${pLng}&dropLat=${dLat}&dropLng=${dLng}`
          ),
          apiRequest<{ coordinates: [number, number][] }>(
            `/geo/route?pickupLat=${pLat}&pickupLng=${pLng}&dropLat=${dLat}&dropLng=${dLng}`
          ),
        ]);
        if (!cancelled) {
          setEstimates(estRes.estimates || []);
          setRouteCoords(routeRes.coordinates || []);
        }
      } catch (err: any) {
        if (!cancelled) setErrorMsg(err.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    pickup.lat,
    pickup.lng,
    drop.lat,
    drop.lng,
    activeRideDetail?.ride?.id,
    activeRideDetail?.ride?.pickupLat,
    activeRideDetail?.ride?.dropLat,
  ]);

  // Real-time Socket.IO sync for active ride and real-time driver GPS movement
  useEffect(() => {
    if (!socket) return;
    if (activeRideDetail?.ride?.id) {
      socket.emit('ride:join', activeRideDetail.ride.id);
    }

    const refreshActiveRide = async () => {
      if (!activeRideDetail?.ride?.id) return;
      try {
        const detail = await apiRequest(`/rides/${activeRideDetail.ride.id}`);
        setActiveRideDetail(detail);
        const ridesRes = await apiRequest('/rides/me');
        setRidesList(ridesRes.rides || []);
      } catch {
        // ignore transient refresh
      }
    };

    const handleDriverLoc = (payload: { driverId: string; lat: number; lng: number; heading?: number }) => {
      setActiveRideDetail((prev: any) => {
        if (!prev?.driver || prev.driver.driverId !== payload.driverId) return prev;
        return {
          ...prev,
          driver: { ...prev.driver, lat: payload.lat, lng: payload.lng },
        };
      });
      setNearbyDrivers((prev) => {
        const exists = prev.some((d) => d.driverId === payload.driverId);
        if (exists) {
          return prev.map((d) =>
            d.driverId === payload.driverId ? { ...d, lat: payload.lat, lng: payload.lng } : d
          );
        }
        return prev;
      });
    };

    socket.on('ride.request.accepted', refreshActiveRide);
    socket.on('ride.driver.arrived', refreshActiveRide);
    socket.on('ride.started', refreshActiveRide);
    socket.on('ride.completed', refreshActiveRide);
    socket.on('ride.cancelled', refreshActiveRide);
    socket.on('payment.status.changed', refreshActiveRide);
    socket.on('driver.location.updated', handleDriverLoc);

    return () => {
      socket.off('ride.request.accepted', refreshActiveRide);
      socket.off('ride.driver.arrived', refreshActiveRide);
      socket.off('ride.started', refreshActiveRide);
      socket.off('ride.completed', refreshActiveRide);
      socket.off('ride.cancelled', refreshActiveRide);
      socket.off('payment.status.changed', refreshActiveRide);
      socket.off('driver.location.updated', handleDriverLoc);
    };
  }, [socket, activeRideDetail?.ride?.id]);

  // Debounced India-wide geocoding search
  const runGeoSearch = useCallback(async (field: 'pickup' | 'drop', q: string) => {
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setSearchingField(field);
    try {
      const res = await apiRequest<{ results: GeoPlace[] }>(
        `/geo/search?q=${encodeURIComponent(q)}`,
        { signal: controller.signal }
      );
      if (field === 'pickup') setPickupSuggestions(res.results || []);
      else setDropSuggestions(res.results || []);
    } catch {
      // ignore abort or transient network error
    } finally {
      setSearchingField((cur) => (cur === field ? null : cur));
    }
  }, []);

  const handleSearchAddress = (field: 'pickup' | 'drop', q: string) => {
    if (field === 'pickup') setPickupQuery(q);
    else setDropQuery(q);

    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);

    if (q.trim().length < 2) {
      if (field === 'pickup') setPickupSuggestions([]);
      else setDropSuggestions([]);
      setSearchingField(null);
      return;
    }

    searchTimerRef.current = window.setTimeout(() => {
      runGeoSearch(field, q.trim());
    }, 320);
  };

  const selectedEstimate = useMemo(
    () => estimates.find((e) => e.vehicleType === selectedVehicle) || estimates[0],
    [estimates, selectedVehicle]
  );

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lng = Number(pos.coords.longitude.toFixed(5));
        reverseGeocodeAndSet('pickup', lat, lng, 'Pickup set to your real-time GPS location.');
      },
      () => {
        setErrorMsg('Location permission denied. Type any address in India or tap Pin on Map.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleBookRide = async () => {
    setErrorMsg(null);
    setStatusNotice(null);
    setLoadingBooking(true);
    try {
      const idempotencyKey = `ride-${appUser?.id}-${Date.now()}`;
      const res = await apiRequest<{ ride: any }>('/rides', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey,
          vehicleType: selectedVehicle,
          pickupAddress: pickup.address,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropAddress: drop.address,
          dropLat: drop.lat,
          dropLng: drop.lng,
          paymentMethod,
        }),
      });
      const detail = await apiRequest(`/rides/${res.ride.id}`);
      setActiveRideDetail(detail);
      setStatusNotice('Ride requested! Broadcast to online approved drivers in real time.');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoadingBooking(false);
    }
  };

  const handleCancelRide = async () => {
    if (!activeRideDetail?.ride?.id) return;
    setErrorMsg(null);
    try {
      await apiRequest(`/rides/${activeRideDetail.ride.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason }),
      });
      setShowCancelConfirm(false);
      setActiveRideDetail(null);
      setStatusNotice('Booking cancelled.');
      await loadCityAndRides();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handlePayOnline = async () => {
    if (!activeRideDetail?.ride?.id) return;
    setErrorMsg(null);
    try {
      const orderRes = await apiRequest<{ payment: any }>(
        `/rides/${activeRideDetail.ride.id}/payment-orders`,
        {
          method: 'POST',
          body: JSON.stringify({
            method: 'UPI',
            idempotencyKey: `upi-${activeRideDetail.ride.id}`,
          }),
        }
      );
      await apiRequest('/payments/webhooks/razorpay', {
        method: 'POST',
        body: JSON.stringify({
          providerTransactionId: orderRes.payment.providerTransactionId,
          status: 'PAID',
        }),
      });
      const detail = await apiRequest(`/rides/${activeRideDetail.ride.id}`);
      setActiveRideDetail(detail);
      setStatusNotice('UPI payment verified.');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSubmitRating = async () => {
    if (!activeRideDetail?.ride?.id) return;
    setErrorMsg(null);
    try {
      await apiRequest(`/rides/${activeRideDetail.ride.id}/rate`, {
        method: 'POST',
        body: JSON.stringify({ score: ratingScore, review: ratingReview }),
      });
      const detail = await apiRequest(`/rides/${activeRideDetail.ride.id}`);
      setActiveRideDetail(detail);
      setStatusNotice('Thank you for rating your trip.');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleTriggerSos = async () => {
    setErrorMsg(null);
    try {
      await apiRequest('/support/sos', {
        method: 'POST',
        body: JSON.stringify({
          rideId: activeRideDetail?.ride?.id,
          lat: pickup.lat,
          lng: pickup.lng,
          notes: 'Rider triggered emergency SOS alert',
        }),
      });
      setStatusNotice('Emergency SOS logged and sent to Operations.');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSubmitSupport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportDesc.trim()) return;
    setErrorMsg(null);
    try {
      await apiRequest('/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          rideId: activeRideDetail?.ride?.id,
          category: supportCategory,
          description: supportDesc,
        }),
      });
      setSupportDesc('');
      const ticketRes = await apiRequest('/support/tickets');
      setTickets(ticketRes.tickets || []);
      setStatusNotice('Support ticket submitted.');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await apiRequest('/riders/me', {
        method: 'PUT',
        body: JSON.stringify({
          name: profileName,
          phone: profilePhone,
          emergencyContactName: emergencyName,
          emergencyContactPhone: emergencyPhone,
        }),
      });
      await refreshProfile();
      setStatusNotice('Rider profile saved.');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const activeRide = activeRideDetail?.ride;
  const activeDriver = activeRideDetail?.driver;

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 lg:min-h-[calc(100vh-56px)] bg-slate-50">
      {/* Live Street Map */}
      <div className="lg:col-span-7 h-[40vh] min-h-[270px] lg:h-[calc(100vh-56px)] lg:sticky lg:top-14">
        <CityMap
          pickup={activeRide ? { lat: activeRide.pickupLat, lng: activeRide.pickupLng } : pickup}
          drop={activeRide ? { lat: activeRide.dropLat, lng: activeRide.dropLng } : drop}
          routeCoords={routeCoords}
          nearbyDrivers={nearbyDrivers}
          assignedDriver={
            activeDriver?.lat
              ? {
                  driverId: activeDriver.driverId,
                  driverName: activeDriver.name,
                  category: activeDriver.vehicleCategory,
                  lat: activeDriver.lat,
                  lng: activeDriver.lng,
                }
              : null
          }
          activeSelectionMode={!activeRide ? mapSelectMode : null}
          onMapPick={(lat, lng) => {
            if (mapSelectMode === 'pickup') {
              setMapSelectMode(null);
              reverseGeocodeAndSet('pickup', lat, lng);
            } else if (mapSelectMode === 'drop') {
              setMapSelectMode(null);
              reverseGeocodeAndSet('drop', lat, lng);
            }
          }}
          className="w-full h-full"
        />
      </div>

      {/* Rider Action Panel */}
      <div className="lg:col-span-5 flex flex-col bg-white border-t lg:border-t-0 lg:border-l border-slate-200 pb-20 lg:pb-6">
        <div className="hidden lg:flex items-center gap-1 p-2 mx-5 mt-4 bg-slate-100 rounded-xl">
          {[
            { id: 'book', label: 'Book Ride' },
            { id: 'trips', label: 'My Trips' },
            { id: 'account', label: 'Profile & Safety' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="lg:hidden pt-2.5 pb-1 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        <div className="px-4 sm:px-6 py-3 space-y-4 flex-1 overflow-y-auto">
          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusNotice && (
            <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs text-emerald-900">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
              <span>{statusNotice}</span>
            </div>
          )}

          {activeTab === 'book' && (
            <>
              {activeRide ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-slate-500">Live Ride Status</p>
                        <h2 className="text-lg font-bold text-slate-900">
                          {activeRide.status === 'SEARCHING' && 'Waiting for driver to accept...'}
                          {activeRide.status === 'ACCEPTED' && 'Driver on the way (Live GPS)'}
                          {activeRide.status === 'ARRIVED' && 'Driver arrived at pickup'}
                          {activeRide.status === 'IN_PROGRESS' && 'En route to destination'}
                          {activeRide.status === 'COMPLETED' && 'Arrived at destination'}
                          {activeRide.status === 'CANCELLED' && 'Ride cancelled'}
                        </h2>
                      </div>
                      <span className="font-mono text-xs font-semibold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-md">
                        {activeRide.status}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-700 pt-2 border-t border-slate-200">
                      <div className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-600 mt-1.5 shrink-0" />
                        <span className="font-medium">{activeRide.pickupAddress}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-sm bg-amber-600 mt-1.5 shrink-0" />
                        <span className="font-medium">{activeRide.dropAddress}</span>
                      </div>
                    </div>

                    {['ACCEPTED', 'ARRIVED'].includes(activeRide.status) && (
                      <div className="flex items-center justify-between rounded-xl bg-slate-900 text-white px-4 py-3">
                        <div>
                          <p className="text-xs text-slate-300">Pickup OTP</p>
                          <p className="text-[11px] text-slate-400">
                            Share this 4-digit PIN with your driver
                          </p>
                        </div>
                        <span className="font-mono text-2xl font-bold tracking-widest tabular-nums text-amber-400">
                          {activeRide.pickupOtp}
                        </span>
                      </div>
                    )}

                    {activeDriver && (
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-white border border-slate-200 p-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm shrink-0">
                            {activeDriver.name?.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">
                              {activeDriver.name}
                            </p>
                            <p className="text-xs text-slate-500 truncate">
                              {activeDriver.vehicleMake} {activeDriver.vehicleModel} ·{' '}
                              {activeDriver.vehicleColour}
                            </p>
                            <p className="font-mono text-xs font-semibold text-slate-800 mt-0.5">
                              {activeDriver.vehicleNumber}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="flex items-center justify-end gap-1 text-xs font-bold text-slate-900 tabular-nums">
                            <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                            <span>{activeDriver.ratingAvg}</span>
                          </div>
                          {activeDriver.phone && (
                            <a
                              href={`tel:${activeDriver.phone}`}
                              className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-emerald-700 hover:underline"
                            >
                              <Phone className="w-3 h-3" />
                              <span>Call</span>
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {activeRide.status === 'SEARCHING' && (
                      <p className="text-xs text-slate-600 pt-1">
                        Your ride request is live for approved online drivers in{' '}
                        <span className="font-mono font-semibold">/driver</span>. Once accepted,
                        your driver&apos;s real-time GPS will appear on the map.
                      </p>
                    )}

                    {['SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(
                      activeRide.status
                    ) && (
                      <div className="flex items-center gap-2 pt-1">
                        {activeRide.status !== 'IN_PROGRESS' && (
                          <button
                            type="button"
                            onClick={() => setShowCancelConfirm(true)}
                            className="flex-1 min-h-[44px] rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Cancel Ride
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleTriggerSos}
                          className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
                        >
                          <ShieldAlert className="w-4 h-4" />
                          <span>Emergency SOS</span>
                        </button>
                      </div>
                    )}

                    {activeRide.status === 'CANCELLED' && (
                      <button
                        type="button"
                        onClick={() => setActiveRideDetail(null)}
                        className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
                      >
                        Book Another Ride
                      </button>
                    )}
                  </div>

                  {activeRide.status === 'COMPLETED' && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-slate-500">Final Trip Receipt</p>
                          <p className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                            ₹{activeRide.finalFare || activeRide.estimatedFare}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Payment State</p>
                          <p className="font-mono text-xs font-bold text-slate-900">
                            {activeRide.paymentMethod} · {activeRide.paymentStatus}
                          </p>
                        </div>
                      </div>

                      {activeRideDetail.breakdowns?.length > 0 && (
                        <div className="space-y-1 text-xs text-slate-600 border-t border-slate-100 pt-2">
                          {activeRideDetail.breakdowns.map((b: any) => (
                            <div key={b.id} className="flex justify-between tabular-nums">
                              <span>{b.component.replace(/_/g, ' ')}</span>
                              <span className="font-mono">₹{b.amount}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeRide.paymentStatus !== 'PAID' && (
                        <button
                          type="button"
                          onClick={handlePayOnline}
                          className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800"
                        >
                          <CreditCard className="w-4 h-4" />
                          <span>Pay ₹{activeRide.finalFare || activeRide.estimatedFare} via UPI</span>
                        </button>
                      )}

                      {!activeRideDetail.myRating ? (
                        <div className="border-t border-slate-100 pt-3 space-y-2.5">
                          <p className="text-xs font-semibold text-slate-800">Rate your driver</p>
                          <div className="flex items-center gap-2">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setRatingScore(n)}
                                className={`min-h-[44px] min-w-[44px] rounded-xl border flex items-center justify-center ${
                                  ratingScore >= n
                                    ? 'border-amber-400 bg-amber-50 text-amber-600'
                                    : 'border-slate-200 text-slate-400'
                                }`}
                                aria-label={`Rate ${n} stars`}
                              >
                                <Star
                                  className={`w-5 h-5 ${ratingScore >= n ? 'fill-amber-500' : ''}`}
                                />
                              </button>
                            ))}
                          </div>
                          <input
                            type="text"
                            value={ratingReview}
                            onChange={(e) => setRatingReview(e.target.value)}
                            placeholder="Optional trip feedback..."
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={handleSubmitRating}
                            className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-semibold"
                          >
                            Submit Rating
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs font-medium text-emerald-700">
                          Rated {activeRideDetail.myRating.score}/5 stars
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => setActiveRideDetail(null)}
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Book Another Ride
                      </button>
                    </div>
                  )}

                  {showCancelConfirm && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
                      <p className="text-sm font-bold text-red-950">Confirm Cancellation</p>
                      <select
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        className="w-full rounded-xl border border-red-200 bg-white px-3 py-2.5 text-sm"
                      >
                        <option value="Change of plans">Change of plans</option>
                        <option value="Driver taking too long">Driver taking too long</option>
                        <option value="Entered wrong pickup">Entered wrong pickup</option>
                      </select>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowCancelConfirm(false)}
                          className="flex-1 min-h-[44px] rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700"
                        >
                          Keep Ride
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelRide}
                          className="flex-1 min-h-[44px] rounded-xl bg-red-600 text-white text-xs font-semibold"
                        >
                          Confirm Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* BOOKING FLOW: ALL-INDIA SEARCH OR MAP PIN */
                <div className="space-y-4">
                  <div>
                    <h1 className="text-lg font-bold text-slate-900">Plan your ride across India</h1>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Search any city, campus, airport, or landmark in India (e.g. NIT Trichy to
                      Trichy Airport)
                    </p>
                  </div>

                  {/* Pickup Search */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 relative">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>Pickup Location</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleUseCurrentGps}
                          className="min-h-[32px] px-2.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1"
                        >
                          <LocateFixed className="w-3 h-3" />
                          <span>My GPS</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMapSelectMode(mapSelectMode === 'pickup' ? null : 'pickup')
                          }
                          className={`min-h-[32px] px-2.5 rounded-lg border text-[11px] font-semibold ${
                            mapSelectMode === 'pickup'
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-200'
                          }`}
                        >
                          {mapSelectMode === 'pickup' ? 'Tap Map...' : 'Pin on Map'}
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={pickupQuery}
                        onChange={(e) => handleSearchAddress('pickup', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && pickupSuggestions[0]) {
                            e.preventDefault();
                            const top = pickupSuggestions[0];
                            setPickup({ address: top.address, lat: top.lat, lng: top.lng });
                            setPickupQuery(top.address);
                            setPickupSuggestions([]);
                          }
                        }}
                        placeholder="Search any pickup in India..."
                        className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                    {searchingField === 'pickup' && (
                      <p className="text-[11px] text-slate-500">Searching places across India...</p>
                    )}
                    {pickupSuggestions.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white shadow-md divide-y divide-slate-100 max-h-48 overflow-y-auto z-20 relative">
                        {pickupSuggestions.map((place) => (
                          <button
                            key={place.id}
                            type="button"
                            onClick={() => {
                              setPickup({
                                address: place.address,
                                lat: place.lat,
                                lng: place.lng,
                              });
                              setPickupQuery(place.address);
                              setPickupSuggestions([]);
                            }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50"
                          >
                            <p className="font-semibold text-slate-900 truncate">{place.name}</p>
                            <p className="text-slate-500 truncate">{place.address}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Destination Search */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 relative">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                        <Navigation className="w-3.5 h-3.5" />
                        <span>Destination</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setMapSelectMode(mapSelectMode === 'drop' ? null : 'drop')}
                        className={`min-h-[32px] px-2.5 rounded-lg border text-[11px] font-semibold ${
                          mapSelectMode === 'drop'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200'
                        }`}
                      >
                        {mapSelectMode === 'drop' ? 'Tap Map...' : 'Pin on Map'}
                      </button>
                    </div>
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={dropQuery}
                        onChange={(e) => handleSearchAddress('drop', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && dropSuggestions[0]) {
                            e.preventDefault();
                            const top = dropSuggestions[0];
                            setDrop({ address: top.address, lat: top.lat, lng: top.lng });
                            setDropQuery(top.address);
                            setDropSuggestions([]);
                          }
                        }}
                        placeholder="Search any destination in India..."
                        className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                    {searchingField === 'drop' && (
                      <p className="text-[11px] text-slate-500">Searching places across India...</p>
                    )}
                    {dropSuggestions.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white shadow-md divide-y divide-slate-100 max-h-48 overflow-y-auto z-20 relative">
                        {dropSuggestions.map((place) => (
                          <button
                            key={place.id}
                            type="button"
                            onClick={() => {
                              setDrop({
                                address: place.address,
                                lat: place.lat,
                                lng: place.lng,
                              });
                              setDropQuery(place.address);
                              setDropSuggestions([]);
                            }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50"
                          >
                            <p className="font-semibold text-slate-900 truncate">{place.name}</p>
                            <p className="text-slate-500 truncate">{place.address}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Vehicle Options */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">Select Ride</span>
                      {selectedEstimate && (
                        <span className="font-mono tabular-nums">
                          {selectedEstimate.distanceKm} km · {selectedEstimate.durationMin} min
                        </span>
                      )}
                    </div>

                    <div className="space-y-2">
                      {estimates.map((est) => {
                        const active = selectedVehicle === est.vehicleType;
                        return (
                          <button
                            key={est.vehicleType}
                            type="button"
                            onClick={() => setSelectedVehicle(est.vehicleType)}
                            className={`w-full min-h-[56px] flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                              active
                                ? 'border-emerald-700 bg-emerald-50/70'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                  active
                                    ? 'bg-emerald-700 text-white'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                <Car className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-900">{est.label}</p>
                                <p className="text-xs text-slate-500 tabular-nums">
                                  {est.etaMin} min pickup · v{est.fareVersion}
                                </p>
                              </div>
                            </div>
                            <p className="font-mono text-base font-bold text-slate-900 tabular-nums">
                              ₹{est.estimatedFare}
                            </p>
                          </button>
                        );
                      })}
                    </div>

                    {selectedEstimate && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowBreakdown(!showBreakdown)}
                          className="text-xs font-semibold text-emerald-800 hover:underline"
                        >
                          {showBreakdown ? 'Hide fare breakdown' : 'View fare breakdown'}
                        </button>
                        {showBreakdown && (
                          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1 text-xs text-slate-600 tabular-nums">
                            <div className="flex justify-between">
                              <span>Base fare</span>
                              <span className="font-mono">₹{selectedEstimate.breakdown.baseFare}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Distance ({selectedEstimate.distanceKm} km)</span>
                              <span className="font-mono">
                                ₹{selectedEstimate.breakdown.distanceCharge}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Time ({selectedEstimate.durationMin} min)</span>
                              <span className="font-mono">
                                ₹{selectedEstimate.breakdown.timeCharge}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Payment Method */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('CASH')}
                      className={`flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-xl border text-xs font-semibold ${
                        paymentMethod === 'CASH'
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      <Wallet className="w-4 h-4" />
                      <span>Cash</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('ONLINE')}
                      className={`flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-xl border text-xs font-semibold ${
                        paymentMethod === 'ONLINE'
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>UPI / Online</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={loadingBooking || !selectedEstimate}
                    onClick={handleBookRide}
                    className="w-full min-h-[48px] rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {loadingBooking
                      ? 'Requesting Ride...'
                      : `Request ${selectedEstimate?.label || 'Ride'} · ₹${
                          selectedEstimate?.estimatedFare || '0'
                        }`}
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === 'trips' && (
            <div className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">Your Ride History</h2>
              {ridesList.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-800">No rides booked yet</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('book')}
                    className="mt-2 min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold"
                  >
                    Book First Ride
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl bg-white">
                  {ridesList.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={async () => {
                        const detail = await apiRequest(`/rides/${r.id}`);
                        setActiveRideDetail(detail);
                        setActiveTab('book');
                      }}
                      className="w-full text-left px-4 py-3.5 hover:bg-slate-50 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-slate-800">{r.vehicleType}</span>
                          <span>·</span>
                          <span>{r.status}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {r.pickupAddress} → {r.dropAddress}
                        </p>
                      </div>
                      <p className="font-mono text-sm font-bold text-slate-900 tabular-nums shrink-0">
                        ₹{r.finalFare || r.estimatedFare}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'account' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Install Android Rider App</h2>
                <PWAInstallButton variant="banner" />
              </div>

              <form onSubmit={handleSaveProfile} className="rounded-2xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Profile & Emergency Contact</h2>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
                <input
                  type="tel"
                  value={profilePhone}
                  onChange={(e) => setProfilePhone(e.target.value)}
                  placeholder="Mobile number"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
                <input
                  type="text"
                  value={emergencyName}
                  onChange={(e) => setEmergencyName(e.target.value)}
                  placeholder="Emergency contact name"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
                <input
                  type="tel"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                  placeholder="Emergency contact phone"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
                <button
                  type="submit"
                  className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-semibold"
                >
                  Save Profile
                </button>
              </form>

              <form onSubmit={handleSubmitSupport} className="rounded-2xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Support Ticket</h2>
                <select
                  value={supportCategory}
                  onChange={(e) => setSupportCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white"
                >
                  <option value="FARE_DISPUTE">Fare dispute</option>
                  <option value="LOST_ITEM">Lost item in vehicle</option>
                  <option value="DRIVER_BEHAVIOUR">Safety or driver feedback</option>
                  <option value="APP_ISSUE">Payment or app issue</option>
                </select>
                <textarea
                  rows={2}
                  value={supportDesc}
                  onChange={(e) => setSupportDesc(e.target.value)}
                  placeholder="Describe your issue..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-semibold"
                >
                  Submit Ticket
                </button>
                {tickets.length > 0 && (
                  <div className="pt-2 space-y-2 border-t border-slate-100">
                    {tickets.slice(0, 4).map((t) => (
                      <div key={t.id} className="text-xs text-slate-600 flex justify-between gap-2">
                        <span className="truncate font-medium text-slate-800">{t.description}</span>
                        <span className="font-mono font-semibold shrink-0">{t.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Android Bottom Tab Bar */}
      <nav
        aria-label="Rider mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-3 h-16 pb-safe"
      >
        {[
          { id: 'book', label: 'Ride', icon: Car },
          { id: 'trips', label: 'Trips', icon: History },
          { id: 'account', label: 'Safety', icon: User },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id as any)}
              className={`flex flex-col items-center justify-center min-h-[44px] ${
                active ? 'text-emerald-700 font-bold' : 'text-slate-500 font-medium'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
