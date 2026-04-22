import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// =============================================================================
// IST TIMEZONE CONVENTION — READ BEFORE WRITING ANY DATE-RELATED CODE
// =============================================================================
// This project operates entirely in India Standard Time (Asia/Kolkata):
//
//   1. The Node process is pinned to IST in `server/index.ts` line 1
//      (`process.env.TZ = 'Asia/Kolkata'`), so every `new Date()`,
//      `Date.getFullYear()`, date-fns `format(...)`, and JS Date→string
//      conversion on the server runs in IST wall-clock.
//
//   2. Every Postgres session is pinned to IST by the `connect` listener
//      below, so `now()`, `CURRENT_TIMESTAMP`, `CURRENT_DATE`, and any raw
//      SQL date math (`EXTRACT`, `date_trunc`, `::date`, etc.) also run in
//      IST. This means every column with `.defaultNow()` stores the IST
//      wall-clock — not UTC.
//
//   3. All `timestamp` columns in `shared/schema.ts` are
//      `TIMESTAMP WITHOUT TIME ZONE` and store the IST wall-clock value.
//
// Rules for new code:
//   - Use `new Date()` for "now". Do NOT use `new Date(Date.UTC(...))` to
//     populate a timestamp column — that writes a UTC wall-clock and will
//     read back ~5h30m behind reality.
//   - Do NOT parse `Z`-suffixed ISO strings from external sources straight
//     into a timestamp column without first converting to IST wall-clock.
//   - New raw SQL date math may rely on the session being IST (no need to
//     wrap in `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'`). The four
//     pre-existing wrappers in `server/storage.ts` are kept as-is — they
//     remain correct, just no longer the only IST-safe spots.
// =============================================================================
pool.on("connect", (client) => {
  // Fire-and-forget; pg queues this before any user query on this client.
  // If it ever errors we surface it to stderr so the operator notices —
  // we deliberately do not swallow silently.
  client.query("SET TIME ZONE 'Asia/Kolkata'").catch((err) => {
    console.error("[db] Failed to SET TIME ZONE 'Asia/Kolkata':", err);
  });
});

export const db = drizzle(pool, { schema });
