import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  keepAlive: true,
  // Fail with an error instead of waiting forever (a sleeping free database can need a few seconds to wake up).
  connectionTimeoutMillis: 30_000,
});
export const db = drizzle(pool, { schema });

// Background fetching gets its own small pool, so it can never use up the
// connections that page requests (Settings, Alerts, Feed...) are waiting for.
export const syncPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  keepAlive: true,
  connectionTimeoutMillis: 30_000,
});
export const syncDb = drizzle(syncPool, { schema });

export * from "./schema";
