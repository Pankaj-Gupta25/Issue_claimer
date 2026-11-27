import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

export async function getSettings() {
  const [row] = await db().select().from(settings).where(eq(settings.id, 1));
  return row ?? { id: 1, paused: false };
}

export async function setPaused(paused: boolean): Promise<void> {
  await db()
    .insert(settings)
    .values({ id: 1, paused })
    .onConflictDoUpdate({ target: settings.id, set: { paused } });
}
