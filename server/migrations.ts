import { db } from "./db";
import { migrations } from "@shared/schema";
import { sql } from "drizzle-orm";

interface Migration {
  name: string;
  up: () => Promise<void>;
}

// ============================================================
// MIGRATION REGISTRY
//
// How to add a new migration:
//   1. Add an entry to the MIGRATIONS array below
//   2. Give it a unique name: "YYYY-MM-DD_short_description"
//   3. Write the `up` function with your one-time SQL/logic
//   4. Deploy — it will run automatically on next server start
//
// How to remove an old migration:
//   - Simply delete the entry from the MIGRATIONS array
//   - The record in the `migrations` table stays as a log
//   - It will never re-run because the name is already recorded
// ============================================================

const MIGRATIONS: Migration[] = [
  {
    name: "2026-02-27_reclassify_advances_to_advance_class",
    up: async () => {
      await db.execute(sql`
        UPDATE expenses
        SET expense_class = 'advance'
        WHERE expense_type IN ('farmer_advance', 'farmer_freight', 'merchant_advance')
          AND expense_class = 'revenue'
      `);
    },
  },
];

function migrationLog(message: string): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [migrations] ${message}`);
}

export async function runMigrations(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS migrations (
      name VARCHAR PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await db.select({ name: migrations.name }).from(migrations);
  const appliedSet = new Set(applied.map((m) => m.name));

  let ranCount = 0;
  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.name)) continue;

    try {
      await db.transaction(async (tx) => {
        await migration.up();
        await tx.insert(migrations).values({ name: migration.name });
      });
      migrationLog(`Migration applied: ${migration.name}`);
      ranCount++;
    } catch (error) {
      migrationLog(`Migration FAILED: ${migration.name} — ${error}`);
      throw error;
    }
  }

  if (ranCount === 0) {
    migrationLog(`All ${MIGRATIONS.length} migration(s) already applied`);
  } else {
    migrationLog(`Applied ${ranCount} new migration(s)`);
  }
}
