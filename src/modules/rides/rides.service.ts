import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  auditLogs,
  driverEarnings,
  driverLocations,
  driverProfiles,
  fareBreakdowns,
  fareConfigs,
  payments,
  ratings,
  rideCancellations,
  rides,
  rideStatusHistory,
  users,
  vehicles,
} from '../../db/schema.ts';
import { calculateFareEstimates } from '../pricing/pricing.service.ts';
import { validateCoordinatesInServiceArea } from '../location/location.service.ts';
import { dispatchRideToNearbyDrivers } from '../dispatch/dispatch.service.ts';
import { publishDomainEvent } from '../../platform/events/bus.ts';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  REQUESTED: ['SEARCHING', 'CANCELLED'],
  SEARCHING: ['ACCEPTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function assertValidRideTransition(from: string, to: string) {
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid ride state transition: ${from} -> ${to}`);
  }
}

export async function createRideBooking(params: {
  riderId: string;
  idempotencyKey: string;
  vehicleType: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropAddress: string;
  dropLat: number;
  dropLng: number;
  paymentMethod: 'CASH' | 'ONLINE';
}) {
  // Idempotency check
  const existingByKey = await db
    .select()
    .from(rides)
    .where(eq(rides.idempotencyKey, params.idempotencyKey))
    .limit(1);

  if (existingByKey.length > 0) {
    return existingByKey[0];
  }

  // Invariant: Rider cannot have > 1 active booking
  const activeRiderRides = await db
    .select({ id: rides.id })
    .from(rides)
    .where(
      and(
        eq(rides.riderId, params.riderId),
        inArray(rides.status, ['REQUESTED', 'SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'])
      )
    )
    .limit(1);

  if (activeRiderRides.length > 0) {
    throw new Error('You already have an active ride in progress');
  }

  // Service-area geofence validation (only enforces strict boundary when allowOutOfAreaDrop is disabled)
  const pickupCheck = await validateCoordinatesInServiceArea(params.pickupLat, params.pickupLng);
  if (!pickupCheck.valid && !pickupCheck.allowOutOfAreaDrop) {
    throw new Error(`Pickup is outside the ${pickupCheck.cityName} service zone (${pickupCheck.radiusKm} km radius)`);
  }

  const dropCheck = await validateCoordinatesInServiceArea(params.dropLat, params.dropLng);
  if (!dropCheck.valid && !dropCheck.allowOutOfAreaDrop) {
    throw new Error(`Drop location is outside the ${dropCheck.cityName} service zone`);
  }

  const estimates = await calculateFareEstimates(
    params.pickupLat,
    params.pickupLng,
    params.dropLat,
    params.dropLng
  );

  const selected = estimates.find((e) => e.vehicleType === params.vehicleType);
  if (!selected) {
    throw new Error(`Unsupported vehicle category: ${params.vehicleType}`);
  }

  const pickupOtp = String(Math.floor(1000 + Math.random() * 9000));

  const createdRide = await db.transaction(async (tx) => {
    const [ride] = await tx
      .insert(rides)
      .values({
        idempotencyKey: params.idempotencyKey,
        riderId: params.riderId,
        vehicleType: params.vehicleType,
        pickupAddress: params.pickupAddress,
        pickupLat: params.pickupLat,
        pickupLng: params.pickupLng,
        dropAddress: params.dropAddress,
        dropLat: params.dropLat,
        dropLng: params.dropLng,
        distanceKm: selected.distanceKm.toFixed(2),
        durationMin: selected.durationMin,
        estimatedFare: selected.estimatedFare,
        fareVersion: selected.fareVersion,
        pickupOtp,
        status: 'SEARCHING',
        paymentMethod: params.paymentMethod,
        paymentStatus: 'PENDING',
      })
      .returning();

    await tx.insert(rideStatusHistory).values([
      {
        rideId: ride.id,
        previousStatus: null,
        newStatus: 'REQUESTED',
        actorId: params.riderId,
        reason: 'Ride booking requested',
      },
      {
        rideId: ride.id,
        previousStatus: 'REQUESTED',
        newStatus: 'SEARCHING',
        actorId: params.riderId,
        reason: 'Searching nearby verified drivers',
      },
    ]);

    // Store immutable fare snapshot breakdown
    const breakdownRows = [
      {
        rideId: ride.id,
        component: 'BASE_FARE',
        quantity: '1.00',
        rate: selected.breakdown.baseFare,
        amount: selected.breakdown.baseFare,
        pricingVersion: selected.fareVersion,
      },
      {
        rideId: ride.id,
        component: 'DISTANCE_CHARGE',
        quantity: selected.distanceKm.toFixed(2),
        rate: (Number(selected.breakdown.distanceCharge) / Math.max(1, selected.distanceKm)).toFixed(2),
        amount: selected.breakdown.distanceCharge,
        pricingVersion: selected.fareVersion,
      },
      {
        rideId: ride.id,
        component: 'TIME_CHARGE',
        quantity: String(selected.durationMin),
        rate: (Number(selected.breakdown.timeCharge) / Math.max(1, selected.durationMin)).toFixed(2),
        amount: selected.breakdown.timeCharge,
        pricingVersion: selected.fareVersion,
      },
    ];

    if (Number(selected.breakdown.minimumAdjustment) > 0) {
      breakdownRows.push({
        rideId: ride.id,
        component: 'MINIMUM_ADJUSTMENT',
        quantity: '1.00',
        rate: selected.breakdown.minimumAdjustment,
        amount: selected.breakdown.minimumAdjustment,
        pricingVersion: selected.fareVersion,
      });
    }

    await tx.insert(fareBreakdowns).values(breakdownRows);
    return ride;
  });

  await dispatchRideToNearbyDrivers(createdRide.id);

  await publishDomainEvent({
    eventType: 'ride.created',
    aggregateType: 'ride',
    aggregateId: createdRide.id,
    payload: { rideId: createdRide.id, status: createdRide.status },
    rooms: [`user:${params.riderId}`, 'admin:ops'],
  });

  return createdRide;
}

export async function getRideDetails(rideId: string, requesterUserId: string, requesterRole: string) {
  const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
  if (!ride) return null;

  let driverInfo = null;
  if (ride.driverId) {
    const [drv] = await db
      .select({
        driverId: driverProfiles.id,
        userId: driverProfiles.userId,
        name: users.name,
        phone: users.phone,
        ratingAvg: driverProfiles.ratingAvg,
        totalTrips: driverProfiles.totalTrips,
        vehicleNumber: vehicles.registrationNumber,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        vehicleColour: vehicles.colour,
        vehicleCategory: vehicles.category,
        lat: driverLocations.lat,
        lng: driverLocations.lng,
      })
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .leftJoin(vehicles, eq(driverProfiles.id, vehicles.driverId))
      .leftJoin(driverLocations, eq(driverProfiles.id, driverLocations.driverId))
      .where(eq(driverProfiles.id, ride.driverId))
      .limit(1);

    driverInfo = drv || null;
  }

  // Resource-level authorization check
  const isRider = ride.riderId === requesterUserId;
  const isDriver = driverInfo && driverInfo.userId === requesterUserId;
  const isAdmin = requesterRole === 'ADMIN';
  if (!isRider && !isDriver && !isAdmin) {
    throw new Error('Forbidden: not authorized to view this ride');
  }

  const [rider] = await db
    .select({ id: users.id, name: users.name, phone: users.phone })
    .from(users)
    .where(eq(users.id, ride.riderId))
    .limit(1);

  const history = await db
    .select()
    .from(rideStatusHistory)
    .where(eq(rideStatusHistory.rideId, ride.id))
    .orderBy(rideStatusHistory.createdAt);

  const breakdowns = await db
    .select()
    .from(fareBreakdowns)
    .where(eq(fareBreakdowns.rideId, ride.id));

  const [rating] = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.rideId, ride.id), eq(ratings.raterId, requesterUserId)))
    .limit(1);

  const [cancellation] = await db
    .select()
    .from(rideCancellations)
    .where(eq(rideCancellations.rideId, ride.id))
    .limit(1);

  // Never expose pickupOtp to unassigned users; driver validates rider's OTP
  const sanitizedRide = isDriver && !isRider && !isAdmin ? { ...ride, pickupOtp: '****' } : ride;

  return {
    ride: sanitizedRide,
    rider,
    driver: driverInfo,
    history,
    breakdowns,
    myRating: rating || null,
    cancellation: cancellation || null,
  };
}

export async function getRiderRides(riderId: string) {
  return await db
    .select()
    .from(rides)
    .where(eq(rides.riderId, riderId))
    .orderBy(desc(rides.requestedAt));
}

export async function getDriverActiveRide(userId: string) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  if (!driver) return null;

  const [active] = await db
    .select()
    .from(rides)
    .where(
      and(
        eq(rides.driverId, driver.id),
        inArray(rides.status, ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'])
      )
    )
    .limit(1);

  if (!active) return null;
  return await getRideDetails(active.id, userId, 'DRIVER');
}

export async function markDriverArrived(rideId: string, actorUserId: string) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, actorUserId))
    .limit(1);

  if (!driver) throw new Error('Driver profile not found');

  const updated = await db.transaction(async (tx) => {
    const [ride] = await tx.select().from(rides).where(eq(rides.id, rideId)).limit(1);
    if (!ride) throw new Error('Ride not found');
    if (ride.driverId !== driver.id) throw new Error('Only assigned driver can mark arrival');
    assertValidRideTransition(ride.status, 'ARRIVED');

    const [next] = await tx
      .update(rides)
      .set({ status: 'ARRIVED', arrivedAt: new Date() })
      .where(and(eq(rides.id, rideId), eq(rides.status, 'ACCEPTED')))
      .returning();

    await tx.insert(rideStatusHistory).values({
      rideId,
      previousStatus: 'ACCEPTED',
      newStatus: 'ARRIVED',
      actorId: actorUserId,
      reason: 'Driver arrived at pickup point',
    });

    return next;
  });

  await publishDomainEvent({
    eventType: 'ride.driver.arrived',
    aggregateType: 'ride',
    aggregateId: rideId,
    payload: { rideId, status: 'ARRIVED' },
    rooms: [`ride:${rideId}`, `user:${updated.riderId}`, `driver:${driver.id}`, 'admin:ops'],
  });

  return updated;
}

export async function startTripWithOtp(rideId: string, actorUserId: string, otp: string) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, actorUserId))
    .limit(1);

  if (!driver) throw new Error('Driver profile not found');

  const updated = await db.transaction(async (tx) => {
    const [ride] = await tx.select().from(rides).where(eq(rides.id, rideId)).limit(1);
    if (!ride) throw new Error('Ride not found');
    if (ride.driverId !== driver.id) throw new Error('Only assigned driver can start trip');
    assertValidRideTransition(ride.status, 'IN_PROGRESS');

    if (ride.pickupOtp !== otp.trim()) {
      throw new Error('Invalid pickup OTP. Please verify the 4-digit code with the rider.');
    }

    const [next] = await tx
      .update(rides)
      .set({ status: 'IN_PROGRESS', startedAt: new Date() })
      .where(and(eq(rides.id, rideId), eq(rides.status, 'ARRIVED')))
      .returning();

    await tx.insert(rideStatusHistory).values({
      rideId,
      previousStatus: 'ARRIVED',
      newStatus: 'IN_PROGRESS',
      actorId: actorUserId,
      reason: 'Pickup OTP verified; trip started',
    });

    return next;
  });

  await publishDomainEvent({
    eventType: 'ride.started',
    aggregateType: 'ride',
    aggregateId: rideId,
    payload: { rideId, status: 'IN_PROGRESS' },
    rooms: [`ride:${rideId}`, `user:${updated.riderId}`, `driver:${driver.id}`, 'admin:ops'],
  });

  return updated;
}

export async function completeRideTrip(
  rideId: string,
  actorUserId: string,
  cashCollected: boolean = false
) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, actorUserId))
    .limit(1);

  if (!driver) throw new Error('Driver profile not found');

  const updated = await db.transaction(async (tx) => {
    const [ride] = await tx.select().from(rides).where(eq(rides.id, rideId)).limit(1);
    if (!ride) throw new Error('Ride not found');
    if (ride.driverId !== driver.id) throw new Error('Only assigned driver can complete trip');
    assertValidRideTransition(ride.status, 'COMPLETED');

    const [cfg] = await tx
      .select()
      .from(fareConfigs)
      .where(and(eq(fareConfigs.vehicleType, ride.vehicleType), eq(fareConfigs.isActive, true)))
      .limit(1);

    const commissionRatePct = cfg ? Number(cfg.commissionRatePct) : 15;
    const gross = Number(ride.estimatedFare);
    const commission = Number(((gross * commissionRatePct) / 100).toFixed(2));
    const net = Number((gross - commission).toFixed(2));

    const nextPaymentStatus =
      ride.paymentMethod === 'CASH' && cashCollected ? 'PAID' : ride.paymentStatus;

    const [next] = await tx
      .update(rides)
      .set({
        status: 'COMPLETED',
        finalFare: gross.toFixed(2),
        paymentStatus: nextPaymentStatus,
        completedAt: new Date(),
      })
      .where(and(eq(rides.id, rideId), eq(rides.status, 'IN_PROGRESS')))
      .returning();

    await tx.insert(rideStatusHistory).values({
      rideId,
      previousStatus: 'IN_PROGRESS',
      newStatus: 'COMPLETED',
      actorId: actorUserId,
      reason: 'Trip completed at destination',
    });

    await tx
      .insert(driverEarnings)
      .values({
        driverId: driver.id,
        rideId: ride.id,
        grossAmount: gross.toFixed(2),
        commissionAmount: commission.toFixed(2),
        netAmount: net.toFixed(2),
        status: 'RECORDED',
      })
      .onConflictDoNothing();

    if (ride.paymentMethod === 'CASH' && cashCollected) {
      await tx
        .insert(payments)
        .values({
          rideId: ride.id,
          riderId: ride.riderId,
          idempotencyKey: `cash-${ride.id}`,
          amount: gross.toFixed(2),
          method: 'CASH',
          provider: 'CASH_LEDGER',
          providerTransactionId: `CASH-${ride.id.slice(0, 8).toUpperCase()}`,
          status: 'PAID',
        })
        .onConflictDoNothing();
    }

    await tx
      .update(driverProfiles)
      .set({ totalTrips: driver.totalTrips + 1, updatedAt: new Date() })
      .where(eq(driverProfiles.id, driver.id));

    await tx
      .update(driverLocations)
      .set({ isAvailable: true, updatedAt: new Date() })
      .where(eq(driverLocations.driverId, driver.id));

    return next;
  });

  await publishDomainEvent({
    eventType: 'ride.completed',
    aggregateType: 'ride',
    aggregateId: rideId,
    payload: {
      rideId,
      status: 'COMPLETED',
      finalFare: updated.finalFare,
      paymentStatus: updated.paymentStatus,
    },
    rooms: [`ride:${rideId}`, `user:${updated.riderId}`, `driver:${driver.id}`, 'admin:ops'],
  });

  return updated;
}

export async function cancelRideTrip(params: {
  rideId: string;
  actorUserId: string;
  actorRole: string;
  reason: string;
}) {
  const result = await db.transaction(async (tx) => {
    const [ride] = await tx.select().from(rides).where(eq(rides.id, params.rideId)).limit(1);
    if (!ride) throw new Error('Ride not found');

    assertValidRideTransition(ride.status, 'CANCELLED');

    let cancelledBy = 'ADMIN';
    if (ride.riderId === params.actorUserId && params.actorRole !== 'ADMIN') {
      cancelledBy = 'RIDER';
    } else if (ride.driverId) {
      const [drv] = await tx
        .select()
        .from(driverProfiles)
        .where(eq(driverProfiles.id, ride.driverId))
        .limit(1);
      if (drv && drv.userId === params.actorUserId) {
        cancelledBy = 'DRIVER';
      } else if (params.actorRole !== 'ADMIN') {
        throw new Error('Forbidden: cannot cancel another user ride');
      }
    } else if (params.actorRole !== 'ADMIN' && ride.riderId !== params.actorUserId) {
      throw new Error('Forbidden');
    }

    let feeAmount = '0.00';
    if (cancelledBy === 'RIDER' && ['ACCEPTED', 'ARRIVED'].includes(ride.status)) {
      const [cfg] = await tx
        .select()
        .from(fareConfigs)
        .where(and(eq(fareConfigs.vehicleType, ride.vehicleType), eq(fareConfigs.isActive, true)))
        .limit(1);
      feeAmount = cfg ? Number(cfg.cancellationFee).toFixed(2) : '25.00';
    }

    const [updated] = await tx
      .update(rides)
      .set({ status: 'CANCELLED', cancelledAt: new Date() })
      .where(eq(rides.id, ride.id))
      .returning();

    await tx.insert(rideCancellations).values({
      rideId: ride.id,
      cancelledBy,
      actorId: params.actorUserId,
      reason: params.reason || 'Cancelled by user',
      feeAmount,
    });

    await tx.insert(rideStatusHistory).values({
      rideId: ride.id,
      previousStatus: ride.status,
      newStatus: 'CANCELLED',
      actorId: params.actorUserId,
      reason: `${cancelledBy}: ${params.reason}`,
    });

    if (ride.driverId) {
      await tx
        .update(driverLocations)
        .set({ isAvailable: true, updatedAt: new Date() })
        .where(eq(driverLocations.driverId, ride.driverId));
    }

    await tx.insert(auditLogs).values({
      actorId: params.actorUserId,
      action: 'RIDE_CANCELLED',
      entityType: 'ride',
      entityId: ride.id,
      metadata: { cancelledBy, reason: params.reason, feeAmount },
    });

    return { updated, cancelledBy, feeAmount };
  });

  await publishDomainEvent({
    eventType: 'ride.cancelled',
    aggregateType: 'ride',
    aggregateId: params.rideId,
    payload: {
      rideId: params.rideId,
      status: 'CANCELLED',
      cancelledBy: result.cancelledBy,
      feeAmount: result.feeAmount,
    },
    rooms: [
      `ride:${params.rideId}`,
      `user:${result.updated.riderId}`,
      ...(result.updated.driverId ? [`driver:${result.updated.driverId}`] : []),
      'admin:ops',
    ],
  });

  return result.updated;
}

export async function submitRideRating(params: {
  rideId: string;
  raterId: string;
  score: number;
  review?: string;
}) {
  if (params.score < 1 || params.score > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  return await db.transaction(async (tx) => {
    const [ride] = await tx.select().from(rides).where(eq(rides.id, params.rideId)).limit(1);
    if (!ride) throw new Error('Ride not found');
    if (ride.status !== 'COMPLETED') throw new Error('Can only rate completed trips');
    if (ride.riderId !== params.raterId) throw new Error('Only the rider can submit driver rating');
    if (!ride.driverId) throw new Error('No driver assigned to rate');

    const [driver] = await tx
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.id, ride.driverId))
      .limit(1);

    if (!driver) throw new Error('Driver not found');

    const [created] = await tx
      .insert(ratings)
      .values({
        rideId: ride.id,
        raterId: params.raterId,
        rateeId: driver.userId,
        score: params.score,
        review: params.review || null,
      })
      .returning();

    const allRatings = await tx
      .select({ score: ratings.score })
      .from(ratings)
      .where(eq(ratings.rateeId, driver.userId));

    const avg =
      allRatings.reduce((acc, r) => acc + r.score, 0) / Math.max(1, allRatings.length);

    await tx
      .update(driverProfiles)
      .set({ ratingAvg: avg.toFixed(2), updatedAt: new Date() })
      .where(eq(driverProfiles.id, driver.id));

    return created;
  });
}
