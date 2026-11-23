import { and, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  driverLocations,
  driverProfiles,
  rideRequests,
  rides,
  rideStatusHistory,
  users,
  vehicles,
} from '../../db/schema.ts';
import { findNearbyEligibleDrivers, haversineKm } from '../location/location.service.ts';
import { publishDomainEvent } from '../../platform/events/bus.ts';

const OFFER_TTL_MS = 15 * 60 * 1000;

export async function dispatchRideToNearbyDrivers(rideId: string) {
  const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
  if (!ride || ride.status !== 'SEARCHING') {
    return [];
  }

  // 1. Find nearby drivers matching requested vehicle category within 25km
  const nearbyMatching = await findNearbyEligibleDrivers({
    pickupLat: ride.pickupLat,
    pickupLng: ride.pickupLng,
    vehicleType: ride.vehicleType,
    radiusKm: 25,
  });

  // 2. Also find ALL currently online approved human drivers (not demo bots) so an active driver
  // logged into the Driver app receives live ride requests even across any chosen city/location.
  const allOnlineDrivers = await db
    .select({
      driverId: driverProfiles.id,
      userId: driverProfiles.userId,
      uid: users.uid,
      driverName: users.name,
      lat: driverLocations.lat,
      lng: driverLocations.lng,
    })
    .from(driverProfiles)
    .innerJoin(users, eq(driverProfiles.userId, users.id))
    .innerJoin(driverLocations, eq(driverProfiles.id, driverLocations.driverId))
    .where(and(eq(driverProfiles.verificationStatus, 'APPROVED'), eq(driverProfiles.isOnline, true)));

  const activeRides = await db
    .select({ driverId: rides.driverId })
    .from(rides)
    .where(inArray(rides.status, ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS']));
  const busyIds = new Set(activeRides.map((r) => r.driverId).filter(Boolean));

  const candidatesMap = new Map<string, { driverId: string; userId: string; distanceKm: number }>();

  for (const d of nearbyMatching) {
    candidatesMap.set(d.driverId, { driverId: d.driverId, userId: d.userId, distanceKm: d.distanceKm });
  }

  for (const d of allOnlineDrivers) {
    if (busyIds.has(d.driverId)) continue;
    if (!d.uid.startsWith('demo-driver-') && !candidatesMap.has(d.driverId)) {
      const dist = Number(haversineKm(ride.pickupLat, ride.pickupLng, d.lat, d.lng).toFixed(2));
      candidatesMap.set(d.driverId, { driverId: d.driverId, userId: d.userId, distanceKm: dist });
    }
  }

  const candidates = Array.from(candidatesMap.values());
  if (candidates.length === 0) {
    return [];
  }

  const expiresAt = new Date(Date.now() + OFFER_TTL_MS);
  const createdRequests = [];

  for (const candidate of candidates.slice(0, 10)) {
    const [reqRow] = await db
      .insert(rideRequests)
      .values({
        rideId: ride.id,
        driverId: candidate.driverId,
        status: 'OFFERED',
        distanceKm: candidate.distanceKm.toFixed(2),
        expiresAt,
      })
      .onConflictDoNothing()
      .returning();

    if (reqRow) {
      createdRequests.push(reqRow);
      await publishDomainEvent({
        eventType: 'ride.request.created',
        aggregateType: 'ride_request',
        aggregateId: reqRow.id,
        payload: {
          requestId: reqRow.id,
          rideId: ride.id,
          driverId: candidate.driverId,
          pickupAddress: ride.pickupAddress,
          dropAddress: ride.dropAddress,
          pickupLat: ride.pickupLat,
          pickupLng: ride.pickupLng,
          dropLat: ride.dropLat,
          dropLng: ride.dropLng,
          distanceKm: ride.distanceKm,
          estimatedFare: ride.estimatedFare,
          vehicleType: ride.vehicleType,
          expiresAt: expiresAt.toISOString(),
        },
        rooms: [`driver:${candidate.driverId}`, `user:${candidate.userId}`, 'admin:ops'],
      });
    }
  }

  return createdRequests;
}

/**
 * Ensures an approved, online, idle driver receives offers for any rides currently in SEARCHING
 * (including rides requested right before the driver went online).
 */
export async function syncOpenRidesToOnlineDriver(driverId: string) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.id, driverId))
    .limit(1);

  if (!driver || !driver.isOnline || driver.verificationStatus !== 'APPROVED') {
    return;
  }

  const [busyRide] = await db
    .select({ id: rides.id })
    .from(rides)
    .where(
      and(
        eq(rides.driverId, driver.id),
        inArray(rides.status, ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'])
      )
    )
    .limit(1);

  if (busyRide) return;

  const searchingRides = await db
    .select()
    .from(rides)
    .where(eq(rides.status, 'SEARCHING'))
    .orderBy(desc(rides.requestedAt))
    .limit(10);

  if (searchingRides.length === 0) return;

  const [loc] = await db
    .select()
    .from(driverLocations)
    .where(eq(driverLocations.driverId, driver.id))
    .limit(1);

  const expiresAt = new Date(Date.now() + OFFER_TTL_MS);

  for (const ride of searchingRides) {
    const [existing] = await db
      .select()
      .from(rideRequests)
      .where(and(eq(rideRequests.rideId, ride.id), eq(rideRequests.driverId, driver.id)))
      .limit(1);

    const dist = loc
      ? Number(haversineKm(ride.pickupLat, ride.pickupLng, loc.lat, loc.lng).toFixed(2))
      : 1.0;

    if (!existing) {
      await db
        .insert(rideRequests)
        .values({
          rideId: ride.id,
          driverId: driver.id,
          status: 'OFFERED',
          distanceKm: dist.toFixed(2),
          expiresAt,
        })
        .onConflictDoNothing();
    } else if (existing.status === 'EXPIRED' || (existing.status === 'OFFERED' && existing.expiresAt < new Date())) {
      await db
        .update(rideRequests)
        .set({ status: 'OFFERED', expiresAt })
        .where(eq(rideRequests.id, existing.id));
    }
  }
}

export async function getDriverIncomingRequests(userId: string) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  if (!driver || !driver.isOnline || driver.verificationStatus !== 'APPROVED') return [];

  await syncOpenRidesToOnlineDriver(driver.id);

  const now = new Date();
  return await db
    .select({
      requestId: rideRequests.id,
      rideId: rideRequests.rideId,
      status: rideRequests.status,
      distanceToPickupKm: rideRequests.distanceKm,
      expiresAt: rideRequests.expiresAt,
      pickupAddress: rides.pickupAddress,
      dropAddress: rides.dropAddress,
      pickupLat: rides.pickupLat,
      pickupLng: rides.pickupLng,
      dropLat: rides.dropLat,
      dropLng: rides.dropLng,
      tripDistanceKm: rides.distanceKm,
      durationMin: rides.durationMin,
      estimatedFare: rides.estimatedFare,
      vehicleType: rides.vehicleType,
      paymentMethod: rides.paymentMethod,
      riderName: users.name,
    })
    .from(rideRequests)
    .innerJoin(rides, eq(rideRequests.rideId, rides.id))
    .innerJoin(users, eq(rides.riderId, users.id))
    .where(
      and(
        eq(rideRequests.driverId, driver.id),
        eq(rideRequests.status, 'OFFERED'),
        eq(rides.status, 'SEARCHING'),
        gt(rideRequests.expiresAt, now)
      )
    )
    .orderBy(desc(rideRequests.sentAt));
}

export async function acceptRideRequest(requestId: string, userId: string) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  if (!driver) {
    throw new Error('Driver profile not found');
  }
  if (driver.verificationStatus !== 'APPROVED' || !driver.isOnline) {
    throw new Error('Driver must be approved by Admin and online to accept rides');
  }

  const result = await db.transaction(async (tx) => {
    const [requestRow] = await tx
      .select()
      .from(rideRequests)
      .where(and(eq(rideRequests.id, requestId), eq(rideRequests.driverId, driver.id)))
      .limit(1);

    if (!requestRow) {
      throw new Error('Ride request not found');
    }
    if (requestRow.status !== 'OFFERED') {
      throw new Error(`Ride request is already ${requestRow.status}`);
    }

    const activeDriverRides = await tx
      .select({ id: rides.id })
      .from(rides)
      .where(
        and(
          eq(rides.driverId, driver.id),
          inArray(rides.status, ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'])
        )
      )
      .limit(1);

    if (activeDriverRides.length > 0) {
      throw new Error('Driver already has an active trip in progress');
    }

    // Atomic race-condition protection
    const updatedRides = await tx
      .update(rides)
      .set({
        driverId: driver.id,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      })
      .where(and(eq(rides.id, requestRow.rideId), eq(rides.status, 'SEARCHING')))
      .returning();

    if (updatedRides.length === 0) {
      await tx
        .update(rideRequests)
        .set({ status: 'SUPERSEDED', respondedAt: new Date() })
        .where(eq(rideRequests.id, requestId));
      throw new Error('Ride was already assigned to another driver or cancelled');
    }

    const assignedRide = updatedRides[0];

    await tx
      .update(rideRequests)
      .set({ status: 'ACCEPTED', respondedAt: new Date() })
      .where(eq(rideRequests.id, requestId));

    await tx
      .update(rideRequests)
      .set({ status: 'SUPERSEDED', respondedAt: new Date() })
      .where(
        and(
          eq(rideRequests.rideId, assignedRide.id),
          ne(rideRequests.id, requestId),
          eq(rideRequests.status, 'OFFERED')
        )
      );

    await tx
      .update(driverLocations)
      .set({ isAvailable: false, updatedAt: new Date() })
      .where(eq(driverLocations.driverId, driver.id));

    await tx.insert(rideStatusHistory).values({
      rideId: assignedRide.id,
      previousStatus: 'SEARCHING',
      newStatus: 'ACCEPTED',
      actorId: userId,
      reason: 'Driver accepted dispatch offer',
    });

    const [driverUser] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    const [vehicle] = await tx
      .select()
      .from(vehicles)
      .where(eq(vehicles.driverId, driver.id))
      .limit(1);

    return { assignedRide, driverUser, vehicle };
  });

  await publishDomainEvent({
    eventType: 'ride.request.accepted',
    aggregateType: 'ride',
    aggregateId: result.assignedRide.id,
    payload: {
      rideId: result.assignedRide.id,
      status: 'ACCEPTED',
      driverId: driver.id,
      driverName: result.driverUser?.name,
      vehicleNumber: result.vehicle?.registrationNumber,
    },
    rooms: [
      `ride:${result.assignedRide.id}`,
      `user:${result.assignedRide.riderId}`,
      `driver:${driver.id}`,
      `user:${userId}`,
      'admin:ops',
    ],
  });

  return result.assignedRide;
}

export async function rejectRideRequest(requestId: string, userId: string) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  if (!driver) throw new Error('Driver profile not found');

  const [updated] = await db
    .update(rideRequests)
    .set({ status: 'REJECTED', respondedAt: new Date() })
    .where(
      and(
        eq(rideRequests.id, requestId),
        eq(rideRequests.driverId, driver.id),
        eq(rideRequests.status, 'OFFERED')
      )
    )
    .returning();

  return updated || null;
}

export async function triggerDemoDriverMatch(rideId: string) {
  const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
  if (!ride || ride.status !== 'SEARCHING') return null;

  const offers = await db
    .select({
      requestId: rideRequests.id,
      driverId: rideRequests.driverId,
      userId: driverProfiles.userId,
      uid: users.uid,
    })
    .from(rideRequests)
    .innerJoin(driverProfiles, eq(rideRequests.driverId, driverProfiles.id))
    .innerJoin(users, eq(driverProfiles.userId, users.id))
    .where(and(eq(rideRequests.rideId, rideId), eq(rideRequests.status, 'OFFERED')));

  const demoOffer = offers.find((o) => o.uid.startsWith('demo-driver-')) || offers[0];
  if (!demoOffer) return null;

  return await acceptRideRequest(demoOffer.requestId, demoOffer.userId);
}
