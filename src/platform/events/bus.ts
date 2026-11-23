import { Server as SocketIOServer } from 'socket.io';
import { adminAuth } from '../../lib/firebase-admin.ts';
import { db } from '../../db/index.ts';
import { driverLocations, driverProfiles, outboxEvents, rides, users } from '../../db/schema.ts';
import { and, eq, inArray } from 'drizzle-orm';

let ioInstance: SocketIOServer | null = null;

export function attachSocketServer(io: SocketIOServer) {
  ioInstance = io;

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      const rawPortal = String(socket.handshake.auth?.portal || 'RIDER').toUpperCase();
      const portal = rawPortal === 'DRIVER' || rawPortal === 'ADMIN' ? rawPortal : 'RIDER';

      if (!token) {
        return next(new Error('Unauthorized: missing socket token'));
      }
      const decoded = await adminAuth.verifyIdToken(token);
      const scopedUid = `${decoded.uid}:${portal}`;
      const [dbUser] = await db.select().from(users).where(eq(users.uid, scopedUid)).limit(1);
      if (!dbUser) {
        return next(new Error('Unauthorized: user not registered'));
      }
      socket.data.user = dbUser;
      next();
    } catch {
      next(new Error('Unauthorized: invalid socket token'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user as { id: string; role: string };
    socket.join(`user:${user.id}`);

    if (user.role === 'ADMIN') {
      socket.join('admin:ops');
    }

    const [driver] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, user.id))
      .limit(1);

    if (driver) {
      socket.join(`driver:${driver.id}`);
    }

    socket.on('driver:join', async () => {
      const [drv] = await db
        .select()
        .from(driverProfiles)
        .where(eq(driverProfiles.userId, user.id))
        .limit(1);
      if (drv) {
        socket.join(`driver:${drv.id}`);
      }
    });

    socket.on('ride:join', async (rideId: string) => {
      if (!rideId || typeof rideId !== 'string') return;
      const [ride] = await db.select().from(rides).where(eq(rides.id, rideId)).limit(1);
      if (!ride) return;

      const [drv] = await db
        .select()
        .from(driverProfiles)
        .where(eq(driverProfiles.userId, user.id))
        .limit(1);

      const isRider = ride.riderId === user.id;
      const isDriver = drv && ride.driverId === drv.id;
      const isAdmin = user.role === 'ADMIN';

      if (isRider || isDriver || isAdmin) {
        socket.join(`ride:${rideId}`);
      }
    });

    // Real-time high-frequency driver location streaming over Socket.IO
    socket.on(
      'driver:location:stream',
      async (payload: { lat: number; lng: number; heading?: number; speed?: number }) => {
        try {
          if (user.role !== 'DRIVER') return;
          const lat = Number(payload?.lat);
          const lng = Number(payload?.lng);
          if (Number.isNaN(lat) || Number.isNaN(lng)) return;

          const [drv] = await db
            .select()
            .from(driverProfiles)
            .where(eq(driverProfiles.userId, user.id))
            .limit(1);
          if (!drv) return;

          const heading = Math.round(Number(payload?.heading) || 0);
          const speed = Number(payload?.speed) || 25;

          await db
            .insert(driverLocations)
            .values({
              driverId: drv.id,
              lat,
              lng,
              heading,
              speed,
              isAvailable: true,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: driverLocations.driverId,
              set: { lat, lng, heading, speed, updatedAt: new Date() },
            });

          const [activeRide] = await db
            .select()
            .from(rides)
            .where(
              and(
                eq(rides.driverId, drv.id),
                inArray(rides.status, ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'])
              )
            )
            .limit(1);

          const evtPayload = {
            driverId: drv.id,
            lat,
            lng,
            heading,
            speed,
            timestamp: new Date().toISOString(),
          };

          io.to('admin:ops').to(`driver:${drv.id}`).emit('driver.location.updated', evtPayload);
          if (activeRide) {
            io.to(`ride:${activeRide.id}`)
              .to(`user:${activeRide.riderId}`)
              .emit('driver.location.updated', evtPayload);
          }
        } catch (err) {
          console.error('driver:location:stream error:', err);
        }
      }
    );

    socket.on('ops:join', () => {
      if (user.role === 'ADMIN') {
        socket.join('admin:ops');
      }
    });
  });
}

export async function publishDomainEvent(params: {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  rooms: string[];
  correlationId?: string;
}) {
  const correlationId = params.correlationId || crypto.randomUUID();
  try {
    await db.insert(outboxEvents).values({
      eventType: params.eventType,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      payload: params.payload,
      correlationId,
      publishedAt: new Date(),
    });
  } catch (error) {
    console.error('Failed to persist outbox event:', error);
  }

  if (ioInstance) {
    for (const room of params.rooms) {
      ioInstance.to(room).emit(params.eventType, {
        ...params.payload,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
