import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { riderProfiles, users } from '../../db/schema.ts';

export async function getRiderMe(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [profile] = await db
    .select()
    .from(riderProfiles)
    .where(eq(riderProfiles.userId, userId))
    .limit(1);
  return { user, profile };
}

export async function addSavedLocation(
  userId: string,
  loc: { label: string; address: string; lat: number; lng: number }
) {
  const [profile] = await db
    .select()
    .from(riderProfiles)
    .where(eq(riderProfiles.userId, userId))
    .limit(1);

  const existing = profile?.savedLocations || [];
  const next = [
    ...existing.slice(0, 9),
    {
      id: crypto.randomUUID(),
      ...loc,
    },
  ];

  const [updated] = await db
    .update(riderProfiles)
    .set({ savedLocations: next, updatedAt: new Date() })
    .where(eq(riderProfiles.userId, userId))
    .returning();

  return updated;
}
