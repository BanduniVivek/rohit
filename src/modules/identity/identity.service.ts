import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { users, riderProfiles } from '../../db/schema.ts';

export type PortalRole = 'RIDER' | 'DRIVER' | 'ADMIN';

export async function getOrCreatePortalUser(input: {
  firebaseUid: string;
  email: string;
  name: string;
  portal: PortalRole;
}) {
  try {
    // Scope the DB identity by portal so a single evaluator can run
    // separate Rider, Driver, and Admin sessions concurrently across tabs.
    const scopedUid = `${input.firebaseUid}:${input.portal}`;
    const existing = await db.select().from(users).where(eq(users.uid, scopedUid)).limit(1);
    if (existing.length > 0) {
      return existing[0];
    }

    const inserted = await db
      .insert(users)
      .values({
        uid: scopedUid,
        email: input.email,
        name: input.name,
        role: input.portal,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: input.email,
          updatedAt: new Date(),
        },
      })
      .returning();

    const user = inserted[0];

    if (input.portal === 'RIDER') {
      await db
        .insert(riderProfiles)
        .values({
          userId: user.id,
          savedLocations: [
            {
              id: 'home-blr',
              label: 'Indiranagar 100ft Rd',
              address: '100 Feet Road, Indiranagar, Bengaluru',
              lat: 12.9784,
              lng: 77.6408,
            },
            {
              id: 'work-blr',
              label: 'Koramangala 4th Block',
              address: '80 Feet Road, 4th Block Koramangala, Bengaluru',
              lat: 12.9352,
              lng: 77.6245,
            },
          ],
        })
        .onConflictDoNothing();
    }

    return user;
  } catch (error) {
    console.error('getOrCreatePortalUser failed:', error);
    throw new Error('Failed to resolve user identity', { cause: error });
  }
}

export async function updateUserProfile(
  userId: string,
  payload: { name?: string; phone?: string; emergencyContactName?: string; emergencyContactPhone?: string }
) {
  try {
    if (payload.name || payload.phone) {
      await db
        .update(users)
        .set({
          ...(payload.name ? { name: payload.name } : {}),
          ...(payload.phone ? { phone: payload.phone } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    }

    if (payload.emergencyContactName !== undefined || payload.emergencyContactPhone !== undefined) {
      await db
        .update(riderProfiles)
        .set({
          ...(payload.emergencyContactName !== undefined
            ? { emergencyContactName: payload.emergencyContactName }
            : {}),
          ...(payload.emergencyContactPhone !== undefined
            ? { emergencyContactPhone: payload.emergencyContactPhone }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(riderProfiles.userId, userId));
    }

    const [updatedUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const [profile] = await db.select().from(riderProfiles).where(eq(riderProfiles.userId, userId)).limit(1);
    return { user: updatedUser, riderProfile: profile };
  } catch (error) {
    console.error('updateUserProfile failed:', error);
    throw new Error('Failed to update user profile', { cause: error });
  }
}
