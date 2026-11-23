import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  doublePrecision,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  uid: text('uid').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email').notNull(),
  role: text('role').notNull().default('RIDER'), // RIDER | DRIVER | ADMIN
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | BLOCKED
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const riderProfiles = pgTable('rider_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  savedLocations: jsonb('saved_locations')
    .$type<Array<{ id: string; label: string; address: string; lat: number; lng: number }>>()
    .default([])
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const driverProfiles = pgTable('driver_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  licenceNumber: text('licence_number').notNull(),
  licenceExpiry: text('licence_expiry').notNull(),
  aadhaarNumber: text('aadhaar_number'),
  verificationStatus: text('verification_status').notNull().default('PENDING'), // PENDING | APPROVED | REJECTED | SUSPENDED
  rejectionReason: text('rejection_reason'),
  isOnline: boolean('is_online').notNull().default(false),
  ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }).notNull().default('4.90'),
  totalTrips: integer('total_trips').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const vehicles = pgTable('vehicles', {
  id: uuid('id').defaultRandom().primaryKey(),
  driverId: uuid('driver_id')
    .references(() => driverProfiles.id, { onDelete: 'cascade' })
    .notNull(),
  registrationNumber: text('registration_number').notNull().unique(),
  category: text('category').notNull(), // BIKE | AUTO | MINI | SEDAN
  make: text('make').notNull(),
  model: text('model').notNull(),
  colour: text('colour').notNull(),
  verificationStatus: text('verification_status').notNull().default('PENDING'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const driverDocuments = pgTable('driver_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  driverId: uuid('driver_id')
    .references(() => driverProfiles.id, { onDelete: 'cascade' })
    .notNull(),
  documentType: text('document_type').notNull(), // DRIVING_LICENCE | RC_BOOK | INSURANCE | KYC_ID
  fileRef: text('file_ref').notNull(),
  expiryDate: text('expiry_date'),
  verificationStatus: text('verification_status').notNull().default('PENDING'), // PENDING | APPROVED | REJECTED
  reviewerId: uuid('reviewer_id').references(() => users.id),
  rejectionNote: text('rejection_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const driverLocations = pgTable('driver_locations', {
  driverId: uuid('driver_id')
    .references(() => driverProfiles.id, { onDelete: 'cascade' })
    .primaryKey(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  heading: integer('heading').notNull().default(0),
  speed: doublePrecision('speed').notNull().default(0),
  isAvailable: boolean('is_available').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const serviceAreas = pgTable('service_areas', {
  id: uuid('id').defaultRandom().primaryKey(),
  cityName: text('city_name').notNull(),
  centerLat: doublePrecision('center_lat').notNull(),
  centerLng: doublePrecision('center_lng').notNull(),
  radiusKm: doublePrecision('radius_km').notNull().default(18),
  operatingHours: text('operating_hours').notNull().default('05:00 - 23:59'),
  supportPhone: text('support_phone').notNull().default('+91 80 4400 9100'),
  allowOutOfAreaDrop: boolean('allow_out_of_area_drop').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const fareConfigs = pgTable('fare_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  version: integer('version').notNull().default(1),
  vehicleType: text('vehicle_type').notNull(), // BIKE | AUTO | MINI | SEDAN
  baseFare: numeric('base_fare', { precision: 10, scale: 2 }).notNull(),
  perKmRate: numeric('per_km_rate', { precision: 10, scale: 2 }).notNull(),
  perMinRate: numeric('per_min_rate', { precision: 10, scale: 2 }).notNull(),
  minimumFare: numeric('minimum_fare', { precision: 10, scale: 2 }).notNull(),
  waitingFeePerMin: numeric('waiting_fee_per_min', { precision: 10, scale: 2 }).notNull().default('2.00'),
  cancellationFee: numeric('cancellation_fee', { precision: 10, scale: 2 }).notNull().default('25.00'),
  commissionRatePct: numeric('commission_rate_pct', { precision: 5, scale: 2 }).notNull().default('15.00'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rides = pgTable(
  'rides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    riderId: uuid('rider_id')
      .references(() => users.id)
      .notNull(),
    driverId: uuid('driver_id').references(() => driverProfiles.id),
    vehicleType: text('vehicle_type').notNull(),
    pickupAddress: text('pickup_address').notNull(),
    pickupLat: doublePrecision('pickup_lat').notNull(),
    pickupLng: doublePrecision('pickup_lng').notNull(),
    dropAddress: text('drop_address').notNull(),
    dropLat: doublePrecision('drop_lat').notNull(),
    dropLng: doublePrecision('drop_lng').notNull(),
    distanceKm: numeric('distance_km', { precision: 8, scale: 2 }).notNull(),
    durationMin: integer('duration_min').notNull(),
    estimatedFare: numeric('estimated_fare', { precision: 10, scale: 2 }).notNull(),
    finalFare: numeric('final_fare', { precision: 10, scale: 2 }),
    fareVersion: integer('fare_version').notNull().default(1),
    pickupOtp: text('pickup_otp').notNull(),
    status: text('status').notNull().default('REQUESTED'), // REQUESTED | SEARCHING | ACCEPTED | ARRIVED | IN_PROGRESS | COMPLETED | CANCELLED | EXPIRED
    paymentMethod: text('payment_method').notNull().default('CASH'), // CASH | ONLINE
    paymentStatus: text('payment_status').notNull().default('PENDING'), // NOT_REQUIRED | PENDING | AUTHORIZED | PAID | FAILED | REFUNDED
    requestedAt: timestamp('requested_at').defaultNow().notNull(),
    acceptedAt: timestamp('accepted_at'),
    arrivedAt: timestamp('arrived_at'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    cancelledAt: timestamp('cancelled_at'),
  },
  (table) => [
    index('rides_rider_status_idx').on(table.riderId, table.status, table.requestedAt),
    index('rides_driver_status_idx').on(table.driverId, table.status),
  ]
);

export const rideRequests = pgTable(
  'ride_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rideId: uuid('ride_id')
      .references(() => rides.id, { onDelete: 'cascade' })
      .notNull(),
    driverId: uuid('driver_id')
      .references(() => driverProfiles.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').notNull().default('OFFERED'), // OFFERED | ACCEPTED | REJECTED | EXPIRED | SUPERSEDED
    distanceKm: numeric('distance_km', { precision: 8, scale: 2 }).notNull(),
    sentAt: timestamp('sent_at').defaultNow().notNull(),
    respondedAt: timestamp('responded_at'),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('ride_requests_ride_driver_uidx').on(table.rideId, table.driverId),
    index('ride_requests_driver_status_idx').on(table.driverId, table.status, table.expiresAt),
  ]
);

export const rideStatusHistory = pgTable('ride_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  rideId: uuid('ride_id')
    .references(() => rides.id, { onDelete: 'cascade' })
    .notNull(),
  previousStatus: text('previous_status'),
  newStatus: text('new_status').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const fareBreakdowns = pgTable('fare_breakdowns', {
  id: uuid('id').defaultRandom().primaryKey(),
  rideId: uuid('ride_id')
    .references(() => rides.id, { onDelete: 'cascade' })
    .notNull(),
  component: text('component').notNull(), // BASE_FARE | DISTANCE_CHARGE | TIME_CHARGE | WAITING_FEE | MINIMUM_ADJUSTMENT
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  rate: numeric('rate', { precision: 10, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  pricingVersion: integer('pricing_version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rideId: uuid('ride_id')
      .references(() => rides.id, { onDelete: 'cascade' })
      .notNull(),
    riderId: uuid('rider_id')
      .references(() => users.id)
      .notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    method: text('method').notNull().default('CASH'), // CASH | UPI | CARD
    provider: text('provider').notNull().default('CASH_LEDGER'), // CASH_LEDGER | RAZORPAY
    providerTransactionId: text('provider_transaction_id').unique(),
    status: text('status').notNull().default('PENDING'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('payments_ride_status_idx').on(table.rideId, table.status)]
);

export const driverEarnings = pgTable('driver_earnings', {
  id: uuid('id').defaultRandom().primaryKey(),
  driverId: uuid('driver_id')
    .references(() => driverProfiles.id)
    .notNull(),
  rideId: uuid('ride_id')
    .references(() => rides.id)
    .notNull()
    .unique(),
  grossAmount: numeric('gross_amount', { precision: 10, scale: 2 }).notNull(),
  commissionAmount: numeric('commission_amount', { precision: 10, scale: 2 }).notNull(),
  adjustments: numeric('adjustments', { precision: 10, scale: 2 }).notNull().default('0.00'),
  netAmount: numeric('net_amount', { precision: 10, scale: 2 }).notNull(),
  status: text('status').notNull().default('RECORDED'), // RECORDED | SETTLED
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rideCancellations = pgTable('ride_cancellations', {
  id: uuid('id').defaultRandom().primaryKey(),
  rideId: uuid('ride_id')
    .references(() => rides.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  cancelledBy: text('cancelled_by').notNull(), // RIDER | DRIVER | ADMIN | SYSTEM
  actorId: uuid('actor_id').references(() => users.id),
  reason: text('reason').notNull(),
  feeAmount: numeric('fee_amount', { precision: 10, scale: 2 }).notNull().default('0.00'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rideId: uuid('ride_id')
      .references(() => rides.id, { onDelete: 'cascade' })
      .notNull(),
    raterId: uuid('rater_id')
      .references(() => users.id)
      .notNull(),
    rateeId: uuid('ratee_id')
      .references(() => users.id)
      .notNull(),
    score: integer('score').notNull(), // 1-5
    review: text('review'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('ratings_ride_rater_uidx').on(table.rideId, table.raterId)]
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    creatorId: uuid('creator_id')
      .references(() => users.id)
      .notNull(),
    rideId: uuid('ride_id').references(() => rides.id),
    category: text('category').notNull(), // FARE_DISPUTE | LOST_ITEM | DRIVER_BEHAVIOUR | APP_ISSUE
    description: text('description').notNull(),
    status: text('status').notNull().default('OPEN'), // OPEN | IN_REVIEW | RESOLVED
    resolution: text('resolution'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('support_tickets_status_idx').on(table.status)]
);

export const sosEvents = pgTable('sos_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  rideId: uuid('ride_id').references(() => rides.id),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  status: text('status').notNull().default('TRIGGERED'), // TRIGGERED | ACKNOWLEDGED | RESOLVED
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  correlationId: text('correlation_id').notNull(),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  riderProfile: one(riderProfiles, {
    fields: [users.id],
    references: [riderProfiles.userId],
  }),
  driverProfile: one(driverProfiles, {
    fields: [users.id],
    references: [driverProfiles.userId],
  }),
  ridesAsRider: many(rides),
}));

export const driverProfilesRelations = relations(driverProfiles, ({ one, many }) => ({
  user: one(users, {
    fields: [driverProfiles.userId],
    references: [users.id],
  }),
  vehicles: many(vehicles),
  documents: many(driverDocuments),
  location: one(driverLocations, {
    fields: [driverProfiles.id],
    references: [driverLocations.driverId],
  }),
}));
