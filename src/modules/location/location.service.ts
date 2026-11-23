import { and, eq, inArray, gte } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { driverLocations, driverProfiles, rides, serviceAreas, users, vehicles } from '../../db/schema.ts';

export const BENGALURU_LANDMARKS = [
  { id: 'indiranagar', name: 'Indiranagar 100ft Rd', address: '100 Feet Road, Indiranagar, Bengaluru', lat: 12.9784, lng: 77.6408 },
  { id: 'mg-road', name: 'MG Road Metro', address: 'Mahatma Gandhi Road, Shivaji Nagar, Bengaluru', lat: 12.9756, lng: 77.6066 },
  { id: 'koramangala', name: 'Koramangala 4th Block', address: '80 Feet Road, Koramangala 4th Block, Bengaluru', lat: 12.9352, lng: 77.6245 },
  { id: 'hsr', name: 'HSR Layout Sector 2', address: '27th Main Road, HSR Layout, Bengaluru', lat: 12.9121, lng: 77.6446 },
  { id: 'whitefield', name: 'Whitefield ITPL', address: 'ITPL Main Road, Whitefield, Bengaluru', lat: 12.9855, lng: 77.7363 },
  { id: 'majestic', name: 'Majestic Railway Station', address: 'KSR Bengaluru City Junction, Majestic', lat: 12.9779, lng: 77.5713 },
  { id: 'jayanagar', name: 'Jayanagar 4th Block', address: '11th Main, Jayanagar 4th Block, Bengaluru', lat: 12.9299, lng: 77.5838 },
  { id: 'hebbal', name: 'Hebbal Flyover', address: 'Outer Ring Road, Hebbal, Bengaluru', lat: 13.0358, lng: 77.5970 },
];

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function estimateRoadTrip(pickupLat: number, pickupLng: number, dropLat: number, dropLng: number) {
  const straightKm = haversineKm(pickupLat, pickupLng, dropLat, dropLng);
  const distanceKm = Math.max(0.8, Number((straightKm * 1.28).toFixed(2)));
  // Average Bengaluru city speed ~22 km/h => ~2.7 min per km + 2 min pickup buffer
  const durationMin = Math.max(4, Math.round(distanceKm * 2.7 + 2));
  return { distanceKm, durationMin };
}

export async function getActiveServiceArea() {
  const rows = await db.select().from(serviceAreas).limit(1);
  return rows[0] || null;
}

export async function validateCoordinatesInServiceArea(lat: number, lng: number) {
  const area = await getActiveServiceArea();
  if (!area) return { valid: true, distanceFromCenterKm: 0, cityName: 'Bengaluru' };
  const dist = haversineKm(area.centerLat, area.centerLng, lat, lng);
  return {
    valid: area.isActive && dist <= area.radiusKm,
    distanceFromCenterKm: Number(dist.toFixed(2)),
    cityName: area.cityName,
    allowOutOfAreaDrop: area.allowOutOfAreaDrop,
    radiusKm: area.radiusKm,
  };
}

export async function upsertDriverLocation(params: {
  driverId: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  isAvailable?: boolean;
}) {
  try {
    const [loc] = await db
      .insert(driverLocations)
      .values({
        driverId: params.driverId,
        lat: params.lat,
        lng: params.lng,
        heading: params.heading ?? 0,
        speed: params.speed ?? 0,
        isAvailable: params.isAvailable ?? true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: driverLocations.driverId,
        set: {
          lat: params.lat,
          lng: params.lng,
          heading: params.heading ?? 0,
          speed: params.speed ?? 0,
          ...(params.isAvailable !== undefined ? { isAvailable: params.isAvailable } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();

    return loc;
  } catch (error) {
    console.error('upsertDriverLocation failed:', error);
    throw new Error('Failed to update driver location', { cause: error });
  }
}

export async function findNearbyEligibleDrivers(params: {
  pickupLat: number;
  pickupLng: number;
  vehicleType?: string;
  radiusKm?: number;
  freshnessMinutes?: number;
}) {
  const radiusKm = params.radiusKm ?? 8;
  const freshnessMs = (params.freshnessMinutes ?? 30) * 60 * 1000;
  const threshold = new Date(Date.now() - freshnessMs);

  const onlineDrivers = await db
    .select({
      driverId: driverProfiles.id,
      userId: driverProfiles.userId,
      driverName: users.name,
      ratingAvg: driverProfiles.ratingAvg,
      totalTrips: driverProfiles.totalTrips,
      lat: driverLocations.lat,
      lng: driverLocations.lng,
      heading: driverLocations.heading,
      updatedAt: driverLocations.updatedAt,
      vehicleId: vehicles.id,
      category: vehicles.category,
      make: vehicles.make,
      model: vehicles.model,
      colour: vehicles.colour,
      registrationNumber: vehicles.registrationNumber,
    })
    .from(driverProfiles)
    .innerJoin(users, eq(driverProfiles.userId, users.id))
    .innerJoin(driverLocations, eq(driverProfiles.id, driverLocations.driverId))
    .innerJoin(vehicles, eq(driverProfiles.id, vehicles.driverId))
    .where(
      and(
        eq(driverProfiles.verificationStatus, 'APPROVED'),
        eq(driverProfiles.isOnline, true),
        eq(driverLocations.isAvailable, true),
        gte(driverLocations.updatedAt, threshold),
        ...(params.vehicleType ? [eq(vehicles.category, params.vehicleType)] : [])
      )
    );

  // Exclude drivers currently on an active trip
  const activeRides = await db
    .select({ driverId: rides.driverId })
    .from(rides)
    .where(inArray(rides.status, ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS']));

  const busyDriverIds = new Set(activeRides.map((r) => r.driverId).filter(Boolean));

  return onlineDrivers
    .filter((d) => !busyDriverIds.has(d.driverId))
    .map((d) => ({
      ...d,
      distanceKm: Number(haversineKm(params.pickupLat, params.pickupLng, d.lat, d.lng).toFixed(2)),
    }))
    .filter((d) => d.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
