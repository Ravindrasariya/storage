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
  {
    name: "2026-03-09_cleanup_self_sale_buyer_ledger",
    up: async () => {
      // 1. Nullify buyer ledger references on self-sale salesHistory rows
      await db.execute(sql`
        UPDATE sales_history
        SET buyer_ledger_id = NULL, buyer_id = NULL
        WHERE is_self_sale = 1
          AND (buyer_ledger_id IS NOT NULL OR buyer_id IS NOT NULL)
      `);

      // 2. Delete buyer_ledger entries that match the self-sale composite name pattern
      //    ("Name - Phone - Village") AND have no non-self references
      await db.execute(sql`
        DELETE FROM buyer_ledger
        WHERE buyer_name ~ '^.+ - [0-9]{10} - .+$'
        AND id NOT IN (
          SELECT DISTINCT buyer_ledger_id FROM sales_history
          WHERE buyer_ledger_id IS NOT NULL AND is_self_sale = 0
        )
        AND id NOT IN (
          SELECT DISTINCT buyer_ledger_id FROM opening_receivables
          WHERE buyer_ledger_id IS NOT NULL
        )
        AND id NOT IN (
          SELECT DISTINCT buyer_ledger_id FROM cash_receipts
          WHERE buyer_ledger_id IS NOT NULL
        )
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
