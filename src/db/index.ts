import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

// Reuse one pool per process (and across hot reloads in `next dev`).
const globalForDb = globalThis as unknown as { radarPool?: Pool; radarDb?: Db };

export function db(): Db {
  if (!globalForDb.radarDb) {
    globalForDb.radarPool = new Pool({ connectionString: env.databaseUrl, max: 5 });
    globalForDb.radarDb = drizzle({ client: globalForDb.radarPool, schema });
  }
  return globalForDb.radarDb;
}

/** Close the pool so CLI scripts can exit. */
export async function closeDb(): Promise<void> {
  await globalForDb.radarPool?.end();
  globalForDb.radarPool = undefined;
  globalForDb.radarDb = undefined;
}
