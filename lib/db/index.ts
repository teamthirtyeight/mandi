import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// No throw when it's missing: `next build` imports this file without a database.
// postgres.js connects on the first query, which then fails with a clear error.
const url = process.env.DATABASE_URL ?? "postgres://DATABASE_URL-is-not-set.invalid/mandix";

// Reuse one client across hot reloads in dev.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
const client = globalForDb.pg ?? postgres(url, { max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
/** The raw postgres.js client, for LISTEN/NOTIFY (lib/negotiation/bus.ts, lib/jobs). */
export const pg = client;
export { schema };
