import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { auditLogs, payments, rides } from '../../db/schema.ts';
import { publishDomainEvent } from '../../platform/events/bus.ts';

export async function createPaymentOrder(params: {
  rideId: string;
  riderId: string;
  method: 'CASH' | 'UPI' | 'CARD';
  idempotencyKey: string;
}) {
  const existing = await db
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, params.idempotencyKey))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [ride] = await db.select().from(rides).where(eq(rides.id, params.rideId)).limit(1);
  if (!ride) throw new Error('Ride not found');
  if (ride.riderId !== params.riderId) throw new Error('Forbidden');

  const amount = ride.finalFare || ride.estimatedFare;
  const provider = params.method === 'CASH' ? 'CASH_LEDGER' : 'RAZORPAY';
  const txId = `${provider}_${ride.id.slice(0, 8)}_${Date.now()}`;

  const [payment] = await db
    .insert(payments)
    .values({
      rideId: ride.id,
      riderId: params.riderId,
      idempotencyKey: params.idempotencyKey,
      amount,
      method: params.method,
      provider,
      providerTransactionId: txId,
      status: params.method === 'CASH' ? 'PENDING' : 'AUTHORIZED',
    })
    .returning();

  return payment;
}

export async function processPaymentWebhook(params: {
  provider: string;
  providerTransactionId: string;
  status: 'PAID' | 'FAILED' | 'REFUNDED';
  actorId?: string;
}) {
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(payments)
      .where(eq(payments.providerTransactionId, params.providerTransactionId))
      .limit(1);

    if (!existing) {
      throw new Error('Payment transaction not found');
    }

    // Idempotent webhook guard: if already in terminal desired status, return without duplicate writes
    if (existing.status === params.status) {
      return { payment: existing, duplicate: true };
    }

    const [updatedPayment] = await tx
      .update(payments)
      .set({ status: params.status, updatedAt: new Date() })
      .where(eq(payments.id, existing.id))
      .returning();

    await tx
      .update(rides)
      .set({ paymentStatus: params.status })
      .where(eq(rides.id, existing.rideId));

    await tx.insert(auditLogs).values({
      actorId: params.actorId || null,
      action: 'PAYMENT_WEBHOOK_PROCESSED',
      entityType: 'payment',
      entityId: existing.id,
      metadata: {
        provider: params.provider,
        providerTransactionId: params.providerTransactionId,
        previousStatus: existing.status,
        newStatus: params.status,
      },
    });

    return { payment: updatedPayment, duplicate: false };
  });

  if (!result.duplicate) {
    await publishDomainEvent({
      eventType: 'payment.status.changed',
      aggregateType: 'payment',
      aggregateId: result.payment.id,
      payload: {
        rideId: result.payment.rideId,
        paymentId: result.payment.id,
        status: result.payment.status,
      },
      rooms: [`ride:${result.payment.rideId}`, `user:${result.payment.riderId}`, 'admin:ops'],
    });
  }

  return result;
}
