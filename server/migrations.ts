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
  {
    name: "2026-03-27_add_farmer_payment_tracking",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE sales_history
        ADD COLUMN IF NOT EXISTS farmer_payment_status TEXT DEFAULT 'unpaid'
      `);
      await db.execute(sql`
        ALTER TABLE sales_history
        ADD COLUMN IF NOT EXISTS farmer_paid_at TEXT
      `);
    },
  },
  {
    name: "2026-03-18_unique_asset_depreciation_log_per_fy",
    up: async () => {
      // Remove any duplicate (assetId, financialYear) rows that may exist,
      // keeping the most recently calculated one before adding the unique index.
      await db.execute(sql`
        DELETE FROM asset_depreciation_log
        WHERE id NOT IN (
          SELECT DISTINCT ON (asset_id, financial_year) id
          FROM asset_depreciation_log
          ORDER BY asset_id, financial_year, calculated_at DESC
        )
      `);
      // Create the unique index so the DB enforces one log per asset per FY.
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS asset_dep_log_asset_fy_idx
        ON asset_depreciation_log (asset_id, financial_year)
      `);
    },
  },
  {
    name: "2026-03-27_liability_amounts_to_double_precision",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE liabilities
          ALTER COLUMN original_amount TYPE double precision,
          ALTER COLUMN outstanding_amount TYPE double precision,
          ALTER COLUMN emi_amount TYPE double precision
      `);
      await db.execute(sql`
        ALTER TABLE liability_payments
          ALTER COLUMN amount TYPE double precision,
          ALTER COLUMN principal_component TYPE double precision,
          ALTER COLUMN interest_component TYPE double precision
      `);
    },
  },
  {
    name: "2026-03-28_add_latest_principal_columns",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE opening_receivables
        ADD COLUMN IF NOT EXISTS latest_principal REAL
      `);
      await db.execute(sql`
        ALTER TABLE farmer_advance_freight
        ADD COLUMN IF NOT EXISTS latest_principal REAL
      `);
      await db.execute(sql`
        ALTER TABLE merchant_advance
        ADD COLUMN IF NOT EXISTS latest_principal REAL
      `);
      await db.execute(sql`
        UPDATE opening_receivables
        SET latest_principal = due_amount
        WHERE latest_principal IS NULL AND rate_of_interest > 0
      `);
      await db.execute(sql`
        UPDATE farmer_advance_freight
        SET latest_principal = amount
        WHERE latest_principal IS NULL AND rate_of_interest > 0
      `);
      await db.execute(sql`
        UPDATE merchant_advance
        SET latest_principal = amount
        WHERE latest_principal IS NULL AND rate_of_interest > 0
      `);
    },
  },
  {
    name: "2026-03-27_reclassify_capital_expenses",
    up: async () => {
      await db.execute(sql`
        UPDATE expenses
        SET expense_class = 'capital'
        WHERE expense_type IN ('loan_principal', 'asset_purchase')
          AND expense_class != 'capital'
      `);
    },
  },
  {
    name: "2026-03-28_add_remarks_to_merchant_advance",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE merchant_advance
        ADD COLUMN IF NOT EXISTS remarks TEXT
      `);
    },
  },
  {
    name: "2026-03-29_add_previous_effective_date_columns",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE opening_receivables
          ADD COLUMN IF NOT EXISTS previous_effective_date TIMESTAMP,
          ADD COLUMN IF NOT EXISTS previous_latest_principal REAL
      `);
      await db.execute(sql`
        ALTER TABLE farmer_advance_freight
          ADD COLUMN IF NOT EXISTS previous_effective_date TIMESTAMP,
          ADD COLUMN IF NOT EXISTS previous_latest_principal REAL
      `);
      await db.execute(sql`
        ALTER TABLE merchant_advance
          ADD COLUMN IF NOT EXISTS previous_effective_date TIMESTAMP,
          ADD COLUMN IF NOT EXISTS previous_latest_principal REAL
      `);
    },
  },
  {
    name: "2026-04-04_add_applied_advance_ids_to_receipts",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE cash_receipts
          ADD COLUMN IF NOT EXISTS applied_advance_ids TEXT
      `);
    },
  },
  {
    name: "2026-04-04_add_original_effective_date",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE merchant_advance
          ADD COLUMN IF NOT EXISTS original_effective_date TIMESTAMP
      `);
      await db.execute(sql`
        UPDATE merchant_advance
        SET original_effective_date = COALESCE(previous_effective_date, effective_date)
        WHERE original_effective_date IS NULL
      `);
    },
  },
  {
    name: "2026-04-04_create_merchant_advance_events",
    up: async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS merchant_advance_events (
          id VARCHAR PRIMARY KEY,
          merchant_advance_id VARCHAR NOT NULL,
          event_type TEXT NOT NULL,
          event_date TIMESTAMP NOT NULL,
          amount REAL NOT NULL,
          rate_of_interest REAL NOT NULL DEFAULT 0,
          latest_principal_before REAL,
          latest_principal_after REAL,
          effective_date_before TIMESTAMP,
          effective_date_after TIMESTAMP,
          final_amount_before REAL,
          final_amount_after REAL,
          paid_amount_before REAL,
          paid_amount_after REAL,
          payment_amount REAL,
          receipt_id VARCHAR,
          interest_compounded REAL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
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
