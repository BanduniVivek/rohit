import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  auditLogs,
  driverDocuments,
  driverEarnings,
  driverLocations,
  driverProfiles,
  rides,
  users,
  vehicles,
} from '../../db/schema.ts';
import { publishDomainEvent } from '../../platform/events/bus.ts';
import { syncOpenRidesToOnlineDriver } from '../dispatch/dispatch.service.ts';

export async function getDriverByUserId(userId: string) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  if (!driver) return null;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const driverVehicles = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.driverId, driver.id));
  const docs = await db
    .select()
    .from(driverDocuments)
    .where(eq(driverDocuments.driverId, driver.id));
  const [location] = await db
    .select()
    .from(driverLocations)
    .where(eq(driverLocations.driverId, driver.id))
    .limit(1);

  return {
    driver,
    user,
    vehicles: driverVehicles,
    documents: docs,
    location: location || null,
  };
}

export async function onboardDriver(
  userId: string,
  payload: {
    name: string;
    phone: string;
    licenceNumber: string;
    licenceExpiry: string;
    aadhaarNumber: string;
    licenceDocRef: string;
    aadhaarDocRef: string;
    rcDocRef?: string;
    registrationNumber: string;
    category: 'BIKE' | 'AUTO' | 'MINI' | 'SEDAN';
    make: string;
    model: string;
    colour: string;
    lat?: number;
    lng?: number;
  }
) {
  const cleanReg = payload.registrationNumber.trim().toUpperCase();
  const cleanLicence = payload.licenceNumber.trim().toUpperCase();
  const cleanAadhaar = payload.aadhaarNumber.trim();

  const driverResult = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ name: payload.name.trim(), phone: payload.phone.trim(), updatedAt: new Date() })
      .where(eq(users.id, userId));

    const [existingDriver] = await tx
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, userId))
      .limit(1);

    // Prevent colliding vehicle registration number from another driver
    const conflictingVehicle = await tx
      .select()
      .from(vehicles)
      .where(
        existingDriver
          ? and(eq(vehicles.registrationNumber, cleanReg), ne(vehicles.driverId, existingDriver.id))
          : eq(vehicles.registrationNumber, cleanReg)
      )
      .limit(1);

    if (conflictingVehicle.length > 0) {
      throw new Error(`Vehicle registration ${cleanReg} is already registered to another driver.`);
    }

    let driver = existingDriver;
    if (!driver) {
      const [created] = await tx
        .insert(driverProfiles)
        .values({
          userId,
          licenceNumber: cleanLicence,
          licenceExpiry: payload.licenceExpiry,
          aadhaarNumber: cleanAadhaar,
          verificationStatus: 'PENDING',
          rejectionReason: null,
          isOnline: false,
        })
        .returning();
      driver = created;
    } else {
      const [updated] = await tx
        .update(driverProfiles)
        .set({
          licenceNumber: cleanLicence,
          licenceExpiry: payload.licenceExpiry,
          aadhaarNumber: cleanAadhaar,
          verificationStatus: 'PENDING',
          rejectionReason: null,
          isOnline: false,
          updatedAt: new Date(),
        })
        .where(eq(driverProfiles.id, driver.id))
        .returning();
      driver = updated;
    }

    const existingVehicles = await tx
      .select()
      .from(vehicles)
      .where(eq(vehicles.driverId, driver.id));

    if (existingVehicles.length === 0) {
      await tx.insert(vehicles).values({
        driverId: driver.id,
        registrationNumber: cleanReg,
        category: payload.category,
        make: payload.make.trim(),
        model: payload.model.trim(),
        colour: payload.colour.trim(),
        verificationStatus: 'PENDING',
      });
    } else {
      await tx
        .update(vehicles)
        .set({
          registrationNumber: cleanReg,
          category: payload.category,
          make: payload.make.trim(),
          model: payload.model.trim(),
          colour: payload.colour.trim(),
          verificationStatus: 'PENDING',
        })
        .where(eq(vehicles.id, existingVehicles[0].id));
    }

    // Replace submitted KYC documents on each fresh submission
    await tx.delete(driverDocuments).where(eq(driverDocuments.driverId, driver.id));

    await tx.insert(driverDocuments).values([
      {
        driverId: driver.id,
        documentType: 'DRIVING_LICENCE',
        fileRef: payload.licenceDocRef,
        expiryDate: payload.licenceExpiry,
        verificationStatus: 'PENDING',
      },
      {
        driverId: driver.id,
        documentType: 'AADHAAR_CARD',
        fileRef: payload.aadhaarDocRef,
        expiryDate: null,
        verificationStatus: 'PENDING',
      },
      {
        driverId: driver.id,
        documentType: 'RC_BOOK',
        fileRef: payload.rcDocRef || `RC-${cleanReg}`,
        expiryDate: '2030-12-31',
        verificationStatus: 'PENDING',
      },
    ]);

    await tx
      .insert(driverLocations)
      .values({
        driverId: driver.id,
        lat: payload.lat ?? 12.9716,
        lng: payload.lng ?? 77.5946,
        isAvailable: false,
      })
      .onConflictDoUpdate({
        target: driverLocations.driverId,
        set: {
          ...(payload.lat !== undefined ? { lat: payload.lat } : {}),
          ...(payload.lng !== undefined ? { lng: payload.lng } : {}),
          isAvailable: false,
          updatedAt: new Date(),
        },
      });

    await tx.insert(auditLogs).values({
      actorId: userId,
      action: 'DRIVER_KYC_SUBMITTED',
      entityType: 'driver_profile',
      entityId: driver.id,
      metadata: {
        licenceNumber: cleanLicence,
        aadhaarLast4: cleanAadhaar.slice(-4),
        registrationNumber: cleanReg,
        category: payload.category,
      },
    });

    return driver;
  });

  await publishDomainEvent({
    eventType: 'driver.onboarded',
    aggregateType: 'driver_profile',
    aggregateId: driverResult.id,
    payload: {
      driverId: driverResult.id,
      verificationStatus: driverResult.verificationStatus,
      name: payload.name,
    },
    rooms: ['admin:ops'],
  });

  return driverResult;
}

export async function setDriverAvailability(userId: string, isOnline: boolean) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  if (!driver) {
    throw new Error('Driver profile not found. Complete onboarding first.');
  }

  if (isOnline && driver.verificationStatus !== 'APPROVED') {
    throw new Error(
      `Cannot go online: verification status is ${driver.verificationStatus}. Admin approval is required.`
    );
  }

  const [updated] = await db
    .update(driverProfiles)
    .set({ isOnline, updatedAt: new Date() })
    .where(eq(driverProfiles.id, driver.id))
    .returning();

  await db
    .update(driverLocations)
    .set({ isAvailable: isOnline, updatedAt: new Date() })
    .where(eq(driverLocations.driverId, driver.id));

  if (isOnline) {
    await syncOpenRidesToOnlineDriver(driver.id);
  }

  await publishDomainEvent({
    eventType: 'driver.availability.changed',
    aggregateType: 'driver_profile',
    aggregateId: driver.id,
    payload: { driverId: driver.id, isOnline },
    rooms: [`driver:${driver.id}`, `user:${userId}`, 'admin:ops'],
  });

  return updated;
}

export async function getDriverEarningsLedger(userId: string) {
  const [driver] = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);

  if (!driver) return { summary: { gross: '0.00', commission: '0.00', net: '0.00', trips: 0 }, entries: [] };

  const entries = await db
    .select({
      id: driverEarnings.id,
      rideId: driverEarnings.rideId,
      grossAmount: driverEarnings.grossAmount,
      commissionAmount: driverEarnings.commissionAmount,
      netAmount: driverEarnings.netAmount,
      status: driverEarnings.status,
      createdAt: driverEarnings.createdAt,
      pickupAddress: rides.pickupAddress,
      dropAddress: rides.dropAddress,
      paymentMethod: rides.paymentMethod,
    })
    .from(driverEarnings)
    .innerJoin(rides, eq(driverEarnings.rideId, rides.id))
    .where(eq(driverEarnings.driverId, driver.id))
    .orderBy(desc(driverEarnings.createdAt));

  let gross = 0;
  let commission = 0;
  let net = 0;
  for (const e of entries) {
    gross += Number(e.grossAmount);
    commission += Number(e.commissionAmount);
    net += Number(e.netAmount);
  }

  return {
    summary: {
      gross: gross.toFixed(2),
      commission: commission.toFixed(2),
      net: net.toFixed(2),
      trips: entries.length,
    },
    entries,
  };
}
