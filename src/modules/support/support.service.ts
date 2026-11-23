import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { auditLogs, sosEvents, supportTickets, users } from '../../db/schema.ts';
import { publishDomainEvent } from '../../platform/events/bus.ts';

export async function createSupportTicket(params: {
  creatorId: string;
  rideId?: string;
  category: string;
  description: string;
}) {
  const [ticket] = await db
    .insert(supportTickets)
    .values({
      creatorId: params.creatorId,
      rideId: params.rideId || null,
      category: params.category,
      description: params.description,
      status: 'OPEN',
    })
    .returning();

  return ticket;
}

export async function listUserSupportTickets(userId: string) {
  return await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.creatorId, userId))
    .orderBy(desc(supportTickets.createdAt));
}

export async function triggerSosEvent(params: {
  userId: string;
  rideId?: string;
  lat: number;
  lng: number;
  notes?: string;
}) {
  const [sos] = await db
    .insert(sosEvents)
    .values({
      userId: params.userId,
      rideId: params.rideId || null,
      lat: params.lat,
      lng: params.lng,
      status: 'TRIGGERED',
      notes: params.notes || 'Emergency SOS triggered from mobile client',
    })
    .returning();

  await db.insert(auditLogs).values({
    actorId: params.userId,
    action: 'SOS_TRIGGERED',
    entityType: 'sos_event',
    entityId: sos.id,
    metadata: { rideId: params.rideId, lat: params.lat, lng: params.lng },
  });

  await publishDomainEvent({
    eventType: 'sos.triggered',
    aggregateType: 'sos_event',
    aggregateId: sos.id,
    payload: { sosId: sos.id, rideId: params.rideId, lat: params.lat, lng: params.lng },
    rooms: ['admin:ops'],
  });

  return sos;
}

export async function resolveSupportTicket(
  ticketId: string,
  adminUserId: string,
  status: 'IN_REVIEW' | 'RESOLVED',
  resolution: string
) {
  const [updated] = await db
    .update(supportTickets)
    .set({ status, resolution, updatedAt: new Date() })
    .where(eq(supportTickets.id, ticketId))
    .returning();

  await db.insert(auditLogs).values({
    actorId: adminUserId,
    action: 'SUPPORT_TICKET_UPDATED',
    entityType: 'support_ticket',
    entityId: ticketId,
    metadata: { status, resolution },
  });

  return updated;
}

export async function listAllTicketsAndSos() {
  const tickets = await db
    .select({
      id: supportTickets.id,
      rideId: supportTickets.rideId,
      category: supportTickets.category,
      description: supportTickets.description,
      status: supportTickets.status,
      resolution: supportTickets.resolution,
      createdAt: supportTickets.createdAt,
      creatorName: users.name,
      creatorEmail: users.email,
    })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.creatorId, users.id))
    .orderBy(desc(supportTickets.createdAt));

  const sos = await db
    .select({
      id: sosEvents.id,
      rideId: sosEvents.rideId,
      lat: sosEvents.lat,
      lng: sosEvents.lng,
      status: sosEvents.status,
      notes: sosEvents.notes,
      createdAt: sosEvents.createdAt,
      userName: users.name,
      userPhone: users.phone,
    })
    .from(sosEvents)
    .innerJoin(users, eq(sosEvents.userId, users.id))
    .orderBy(desc(sosEvents.createdAt));

  return { tickets, sos };
}
