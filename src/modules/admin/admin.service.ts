import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  auditLogs,
  driverDocuments,
  driverEarnings,
  driverLocations,
  driverProfiles,
  fareConfigs,
  rides,
  serviceAreas,
  users,
  vehicles,
} from '../../db/schema.ts';
import { publishDomainEvent } from '../../platform/events/bus.ts';

let seedPromise: Promise<void> | null = null;

export async function ensureSeededCityData() {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        const existingAreas = await db.select().from(serviceAreas).limit(1);
        if (existingAreas.length === 0) {
          await db.insert(serviceAreas).values({
            cityName: 'Bengaluru',
            centerLat: 12.9716,
            centerLng: 77.5946,
            radiusKm: 20,
            operatingHours: '05:00 - 23:59',
            supportPhone: '+91 80 4400 9100',
            allowOutOfAreaDrop: true,
            isActive: true,
          });
        } else {
          // Ensure demo allows picking any location out-of-the-box if still at initial default
          await db
            .update(serviceAreas)
            .set({ allowOutOfAreaDrop: true })
            .where(eq(serviceAreas.id, existingAreas[0].id));
        }

        const existingFares = await db.select().from(fareConfigs).limit(1);
        if (existingFares.length === 0) {
          await db.insert(fareConfigs).values([
            {
              version: 1,
              vehicleType: 'BIKE',
              baseFare: '20.00',
              perKmRate: '7.00',
              perMinRate: '1.00',
              minimumFare: '25.00',
              waitingFeePerMin: '1.00',
              cancellationFee: '15.00',
              commissionRatePct: '15.00',
              isActive: true,
            },
            {
              version: 1,
              vehicleType: 'AUTO',
              baseFare: '30.00',
              perKmRate: '12.00',
              perMinRate: '1.00',
              minimumFare: '35.00',
              waitingFeePerMin: '2.00',
              cancellationFee: '25.00',
              commissionRatePct: '15.00',
              isActive: true,
            },
            {
              version: 1,
              vehicleType: 'MINI',
              baseFare: '45.00',
              perKmRate: '15.00',
              perMinRate: '1.50',
              minimumFare: '60.00',
              waitingFeePerMin: '3.00',
              cancellationFee: '35.00',
              commissionRatePct: '15.00',
              isActive: true,
            },
            {
              version: 1,
              vehicleType: 'SEDAN',
              baseFare: '60.00',
              perKmRate: '18.00',
              perMinRate: '2.00',
              minimumFare: '85.00',
              waitingFeePerMin: '4.00',
              cancellationFee: '50.00',
              commissionRatePct: '15.00',
              isActive: true,
            },
          ]);
        }

        // Seed 4 verified online city drivers across Bengaluru so riders can book and track right away
        const demoDrivers = [
          {
            uid: 'demo-driver-arjun',
            name: 'Arjun Gowda',
            phone: '+91 98450 11223',
            email: 'arjun.driver@metroride.city',
            licenceNumber: 'KA03-2019-0048192',
            reg: 'KA-03-MN-4821',
            category: 'AUTO',
            make: 'Bajaj',
            model: 'RE Compact CNG',
            colour: 'Yellow & Green',
            lat: 12.9762,
            lng: 77.6382,
          },
          {
            uid: 'demo-driver-kavitha',
            name: 'Kavitha Nair',
            phone: '+91 98450 33445',
            email: 'kavitha.driver@metroride.city',
            licenceNumber: 'KA01-2020-0091234',
            reg: 'KA-01-EQ-9012',
            category: 'MINI',
            make: 'Tata',
            model: 'Tiago EV',
            colour: 'Pearl White',
            lat: 12.9718,
            lng: 77.6095,
          },
          {
            uid: 'demo-driver-rohan',
            name: 'Rohan Shetty',
            phone: '+91 98450 55667',
            email: 'rohan.driver@metroride.city',
            licenceNumber: 'KA05-2021-0072341',
            reg: 'KA-05-AB-3319',
            category: 'BIKE',
            make: 'Ather',
            model: '450X',
            colour: 'Space Grey',
            lat: 12.9415,
            lng: 77.6261,
          },
          {
            uid: 'demo-driver-imran',
            name: 'Imran Pasha',
            phone: '+91 98450 77889',
            email: 'imran.driver@metroride.city',
            licenceNumber: 'KA02-2018-0031904',
            reg: 'KA-02-HT-7740',
            category: 'SEDAN',
            make: 'Maruti Suzuki',
            model: 'Dzire Tour S',
            colour: 'Silver',
            lat: 12.9689,
            lng: 77.5992,
          },
        ];

        for (const d of demoDrivers) {
          const existing = await db.select().from(users).where(eq(users.uid, d.uid)).limit(1);
          if (existing.length === 0) {
            const [user] = await db
              .insert(users)
              .values({
                uid: d.uid,
                name: d.name,
                phone: d.phone,
                email: d.email,
                role: 'DRIVER',
                status: 'ACTIVE',
              })
              .returning();

            const [drv] = await db
              .insert(driverProfiles)
              .values({
                userId: user.id,
                licenceNumber: d.licenceNumber,
                licenceExpiry: '2031-08-15',
                verificationStatus: 'APPROVED',
                isOnline: true,
                ratingAvg: '4.92',
                totalTrips: 142,
              })
              .returning();

            await db.insert(vehicles).values({
              driverId: drv.id,
              registrationNumber: d.reg,
              category: d.category,
              make: d.make,
              model: d.model,
              colour: d.colour,
              verificationStatus: 'APPROVED',
            });

            await db.insert(driverDocuments).values([
              {
                driverId: drv.id,
                documentType: 'DRIVING_LICENCE',
                fileRef: `secure://docs/${drv.id}/dl.pdf`,
                expiryDate: '2031-08-15',
                verificationStatus: 'APPROVED',
              },
              {
                driverId: drv.id,
                documentType: 'RC_BOOK',
                fileRef: `secure://docs/${drv.id}/rc.pdf`,
                expiryDate: '2032-05-01',
                verificationStatus: 'APPROVED',
              },
            ]);

            await db.insert(driverLocations).values({
              driverId: drv.id,
              lat: d.lat,
              lng: d.lng,
              heading: 45,
              speed: 18,
              isAvailable: true,
              updatedAt: new Date(),
            });
          } else {
            // Keep demo driver locations fresh on boot
            const [drv] = await db
              .select()
              .from(driverProfiles)
              .where(eq(driverProfiles.userId, existing[0].id))
              .limit(1);
            if (drv) {
              await db
                .update(driverLocations)
                .set({ updatedAt: new Date() })
                .where(eq(driverLocations.driverId, drv.id));
            }
          }
        }
      } catch (err) {
        console.error('Seed city data warning:', err);
        seedPromise = null;
      }
    })();
  }
  return seedPromise;
}

export async function getAdminDashboardSummary() {
  const allUsers = await db.select().from(users);
  const allDrivers = await db.select().from(driverProfiles);
  const allRides = await db.select().from(rides);
  const allEarnings = await db.select().from(driverEarnings);

  const ridersCount = allUsers.filter((u) => u.role === 'RIDER').length;
  const driversCount = allDrivers.length;
  const onlineDriversCount = allDrivers.filter((d) => d.isOnline && d.verificationStatus === 'APPROVED').length;
  const pendingDriversCount = allDrivers.filter((d) => d.verificationStatus === 'PENDING').length;

  const activeRidesCount = allRides.filter((r) =>
    ['REQUESTED', 'SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(r.status)
  ).length;
  const completedRidesCount = allRides.filter((r) => r.status === 'COMPLETED').length;
  const cancelledRidesCount = allRides.filter((r) => r.status === 'CANCELLED').length;

  const grossBookings = allEarnings.reduce((acc, e) => acc + Number(e.grossAmount), 0);
  const platformCommission = allEarnings.reduce((acc, e) => acc + Number(e.commissionAmount), 0);

  return {
    kpis: {
      registeredRiders: ridersCount,
      registeredDrivers: driversCount,
      onlineDrivers: onlineDriversCount,
      pendingApprovals: pendingDriversCount,
      activeRides: activeRidesCount,
      completedRides: completedRidesCount,
      cancelledRides: cancelledRidesCount,
      grossBookings: grossBookings.toFixed(2),
      platformCommission: platformCommission.toFixed(2),
    },
  };
}

export async function listAllDriversAdmin() {
  const drivers = await db
    .select({
      driverId: driverProfiles.id,
      userId: driverProfiles.userId,
      name: users.name,
      email: users.email,
      phone: users.phone,
      licenceNumber: driverProfiles.licenceNumber,
      licenceExpiry: driverProfiles.licenceExpiry,
      aadhaarNumber: driverProfiles.aadhaarNumber,
      verificationStatus: driverProfiles.verificationStatus,
      rejectionReason: driverProfiles.rejectionReason,
      isOnline: driverProfiles.isOnline,
      ratingAvg: driverProfiles.ratingAvg,
      totalTrips: driverProfiles.totalTrips,
      createdAt: driverProfiles.createdAt,
    })
    .from(driverProfiles)
    .innerJoin(users, eq(driverProfiles.userId, users.id))
    .orderBy(desc(driverProfiles.createdAt));

  const allVehicles = await db.select().from(vehicles);
  const allDocs = await db.select().from(driverDocuments);
  const allLocs = await db.select().from(driverLocations);

  return drivers.map((d) => ({
    ...d,
    vehicles: allVehicles.filter((v) => v.driverId === d.driverId),
    documents: allDocs.filter((doc) => doc.driverId === d.driverId),
    location: allLocs.find((l) => l.driverId === d.driverId) || null,
  }));
}

export async function decideDriverVerification(params: {
  driverId: string;
  adminUserId: string;
  decision: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  reason?: string;
}) {
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.id, params.driverId))
      .limit(1);

    if (!existing) throw new Error('Driver profile not found');

    const [updated] = await tx
      .update(driverProfiles)
      .set({
        verificationStatus: params.decision,
        rejectionReason: params.decision === 'APPROVED' ? null : params.reason || 'Compliance check failed',
        isOnline: params.decision === 'APPROVED' ? existing.isOnline : false,
        updatedAt: new Date(),
      })
      .where(eq(driverProfiles.id, params.driverId))
      .returning();

    await tx
      .update(vehicles)
      .set({ verificationStatus: params.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED' })
      .where(eq(vehicles.driverId, params.driverId));

    await tx
      .update(driverDocuments)
      .set({
        verificationStatus: params.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        reviewerId: params.adminUserId,
        rejectionNote: params.decision === 'APPROVED' ? null : params.reason || null,
      })
      .where(eq(driverDocuments.driverId, params.driverId));

    await tx.insert(auditLogs).values({
      actorId: params.adminUserId,
      action: `DRIVER_${params.decision}`,
      entityType: 'driver_profile',
      entityId: params.driverId,
      metadata: {
        previousStatus: existing.verificationStatus,
        newStatus: params.decision,
        reason: params.reason || null,
      },
    });

    return updated;
  });

  await publishDomainEvent({
    eventType: 'driver.verification.updated',
    aggregateType: 'driver_profile',
    aggregateId: params.driverId,
    payload: {
      driverId: params.driverId,
      verificationStatus: result.verificationStatus,
      rejectionReason: result.rejectionReason,
    },
    rooms: [`driver:${params.driverId}`, `user:${result.userId}`, 'admin:ops'],
  });

  return result;
}

export async function updateFareConfigAdmin(params: {
  adminUserId: string;
  vehicleType: string;
  baseFare: string;
  perKmRate: string;
  perMinRate: string;
  minimumFare: string;
  waitingFeePerMin: string;
  cancellationFee: string;
  commissionRatePct: string;
}) {
  return await db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(fareConfigs)
      .where(and(eq(fareConfigs.vehicleType, params.vehicleType), eq(fareConfigs.isActive, true)))
      .limit(1);

    const nextVersion = current.length > 0 ? current[0].version + 1 : 1;

    if (current.length > 0) {
      await tx
        .update(fareConfigs)
        .set({ isActive: false })
        .where(eq(fareConfigs.id, current[0].id));
    }

    const [created] = await tx
      .insert(fareConfigs)
      .values({
        version: nextVersion,
        vehicleType: params.vehicleType,
        baseFare: Number(params.baseFare).toFixed(2),
        perKmRate: Number(params.perKmRate).toFixed(2),
        perMinRate: Number(params.perMinRate).toFixed(2),
        minimumFare: Number(params.minimumFare).toFixed(2),
        waitingFeePerMin: Number(params.waitingFeePerMin).toFixed(2),
        cancellationFee: Number(params.cancellationFee).toFixed(2),
        commissionRatePct: Number(params.commissionRatePct).toFixed(2),
        isActive: true,
      })
      .returning();

    await tx.insert(auditLogs).values({
      actorId: params.adminUserId,
      action: 'FARE_CONFIG_VERSIONED',
      entityType: 'fare_config',
      entityId: created.id,
      metadata: { vehicleType: params.vehicleType, version: nextVersion, baseFare: created.baseFare },
    });

    return created;
  });
}

export async function updateServiceAreaAdmin(params: {
  adminUserId: string;
  cityName: string;
  radiusKm: number;
  operatingHours: string;
  supportPhone: string;
  allowOutOfAreaDrop: boolean;
  isActive: boolean;
}) {
  const existing = await db.select().from(serviceAreas).limit(1);
  if (existing.length === 0) return null;

  const [updated] = await db
    .update(serviceAreas)
    .set({
      cityName: params.cityName,
      radiusKm: params.radiusKm,
      operatingHours: params.operatingHours,
      supportPhone: params.supportPhone,
      allowOutOfAreaDrop: params.allowOutOfAreaDrop,
      isActive: params.isActive,
      updatedAt: new Date(),
    })
    .where(eq(serviceAreas.id, existing[0].id))
    .returning();

  await db.insert(auditLogs).values({
    actorId: params.adminUserId,
    action: 'SERVICE_AREA_UPDATED',
    entityType: 'service_area',
    entityId: updated.id,
    metadata: { cityName: params.cityName, radiusKm: params.radiusKm, isActive: params.isActive },
  });

  return updated;
}

export async function listRidesAdmin() {
  return await db.select().from(rides).orderBy(desc(rides.requestedAt)).limit(50);
}

export async function listAuditLogsAdmin() {
  return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(60);
}
