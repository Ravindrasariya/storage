import { db } from "./db";
import { sql } from "drizzle-orm";
import { saudaMultiSql } from "./sauda-multi-sql";

export async function initializeSauda() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lot_sauda (
      lot_id varchar PRIMARY KEY REFERENCES lots(id) ON DELETE CASCADE,
      cold_storage_id varchar NOT NULL REFERENCES cold_storages(id) ON DELETE CASCADE,
      buyer_ledger_id varchar NOT NULL REFERENCES buyer_ledger(id) ON DELETE CASCADE,
      quantity integer NOT NULL CHECK (quantity > 0),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX IF NOT EXISTS lot_sauda_cold_storage_idx ON lot_sauda(cold_storage_id);
  `);
  await initializeMultipleSaudas();
}

export async function initializeMultipleSaudas() {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(726308458)`);
    await tx.execute(sql.raw(saudaMultiSql));
  });
}
