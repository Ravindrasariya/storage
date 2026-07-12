import { randomUUID } from "crypto";
import { db } from "./db";
import { cashReceiptApplications, migrations } from "@shared/schema";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

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
    name: "2026-07-12_add_cash_receipts_is_advance_payment",
    up: async () => {
      // Task #333 — additive NOT NULL column with default 0. Marks a
      // cold_merchant / cold_charges receipt recorded as an advance
      // prepayment against future cold storage bhada. All legacy receipts
      // stay 0 (the default fills both new and existing rows). db:push also
      // handles this, but the explicit migration runs first so environments
      // that skip post-merge.sh still get the column.
      await db.execute(sql`
        ALTER TABLE cash_receipts
        ADD COLUMN IF NOT EXISTS is_advance_payment INTEGER NOT NULL DEFAULT 0
      `);
    },
  },
  {
    name: "2026-06-18_repair_null_chamber_names",
    up: async () => {
      // Task #323 — an account with imperfect data ("Maa Umia Cold Storage
      // Tarana") had chambers with a NULL/blank name, which shipped a null
      // chamberName into the Analytics quality chart and crashed the Recharts
      // render. Backfill a safe placeholder name so the data shape is always
      // valid. Idempotent: only touches rows that are still null/blank.
      await db.execute(sql`
        UPDATE chambers
        SET name = 'Unknown'
        WHERE name IS NULL OR btrim(name) = ''
      `);
    },
  },
  {
    name: "2026-05-27_add_cash_receipts_due_type",
    up: async () => {
      // Task #309 — additive NOT NULL column with default 'cold_charges'.
      // All legacy receipts are treated as cold_charges (no backfill needed
      // because the default fills both new and existing rows).
      await db.execute(sql`
        ALTER TABLE cash_receipts
        ADD COLUMN IF NOT EXISTS due_type TEXT NOT NULL DEFAULT 'cold_charges'
      `);
    },
  },
  {
    name: "2026-05-26_add_sales_history_grading_per_bag",
    up: async () => {
      // Task #300 — additive nullable column. No default, no back-fill:
      // legacy rows stay NULL ("Grading/Bag" displayed blank in Edit dialog
      // and CSV). drizzle's db:push also handles this, but the explicit
      // migration runs first so environments that skip post-merge.sh
      // still get the column.
      await db.execute(sql`
        ALTER TABLE sales_history
        ADD COLUMN IF NOT EXISTS grading_per_bag REAL
      `);
    },
  },
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
  {
    name: "2026-04-04_add_merchant_advance_events_indexes",
    up: async () => {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_mae_advance_id ON merchant_advance_events(merchant_advance_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_mae_receipt_id ON merchant_advance_events(receipt_id) WHERE receipt_id IS NOT NULL`);
    },
  },
  {
    name: "add_farmer_entity_type_and_custom_rates",
    up: async () => {
      await db.execute(sql`ALTER TABLE farmer_ledger ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'farmer'`);
      await db.execute(sql`ALTER TABLE farmer_ledger ADD COLUMN IF NOT EXISTS custom_cold_charge_rate REAL`);
      await db.execute(sql`ALTER TABLE farmer_ledger ADD COLUMN IF NOT EXISTS custom_hammali_rate REAL`);
    },
  },
  {
    name: "2026-04-17_backfill_cold_storage_bill_numbers",
    up: async () => {
      // Assign coldStorageBillNumber to every existing salesHistory row that
      // doesn't already have one. Numbers are assigned per cold storage in
      // chronological (sold_at, id tiebreaker) order, continuing from the
      // current next_cold_storage_bill_number counter on cold_storages.
      await db.execute(sql`
        WITH ranked AS (
          SELECT
            sh.id,
            cs.next_cold_storage_bill_number
              + ROW_NUMBER() OVER (
                  PARTITION BY sh.cold_storage_id
                  ORDER BY sh.sold_at, sh.id
                )
              - 1 AS new_bill
          FROM sales_history sh
          JOIN cold_storages cs ON cs.id = sh.cold_storage_id
          WHERE sh.cold_storage_bill_number IS NULL
        )
        UPDATE sales_history sh
        SET cold_storage_bill_number = ranked.new_bill
        FROM ranked
        WHERE sh.id = ranked.id
      `);

      // Bump each cold storage's counter past the highest assigned number so
      // future sales don't collide. Only updates when needed → idempotent.
      await db.execute(sql`
        UPDATE cold_storages cs
        SET next_cold_storage_bill_number = sub.next_val
        FROM (
          SELECT
            cold_storage_id,
            MAX(cold_storage_bill_number) + 1 AS next_val
          FROM sales_history
          WHERE cold_storage_bill_number IS NOT NULL
          GROUP BY cold_storage_id
        ) sub
        WHERE cs.id = sub.cold_storage_id
          AND sub.next_val > cs.next_cold_storage_bill_number
      `);
    },
  },
  {
    name: "2026-04-20_add_paid_cash_account_counters",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE sales_history
        ADD COLUMN IF NOT EXISTS paid_cash REAL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE sales_history
        ADD COLUMN IF NOT EXISTS paid_account REAL DEFAULT 0
      `);
    },
  },
  {
    name: "2026-04-21_create_cash_receipt_applications",
    up: async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS cash_receipt_applications (
          id VARCHAR PRIMARY KEY,
          cold_storage_id VARCHAR NOT NULL,
          cash_receipt_id VARCHAR NOT NULL,
          sales_history_id VARCHAR NOT NULL,
          amount_applied REAL NOT NULL,
          applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS cra_receipt_idx ON cash_receipt_applications(cash_receipt_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS cra_sale_idx ON cash_receipt_applications(sales_history_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS cra_cs_idx ON cash_receipt_applications(cold_storage_id)`);
    },
  },
  {
    name: "2026-04-22_backfill_legacy_receipt_applications",
    up: async () => {
      // Synthesize cash_receipt_applications rows for receipts created before
      // Task #156 added the junction table. Without these rows, the exit
      // register cannot attribute legacy receipts' round-off concessions to
      // specific sales, so the round-off stays bundled in Cash Received
      // instead of moving to Discount.
      //
      // Algorithm: walk every non-reversed receipt that has zero application
      // rows in receipt-date order (FIFO). For each one:
      //   - manual single-sale closures (applies_to_sale_id set) attribute
      //     the entire gross to that sale,
      //   - cold_merchant / sales_goods receipts FIFO across the buyer's sales
      //     by createdAt, capped at each sale's residual (paid_amount minus
      //     discount_allocated minus already-attributed amount_applied),
      //   - farmer receipts do the same against self-sales for the matching
      //     farmer (ledger id, falling back to "name (village)" composite),
      //   - other payer types (kata, others, cold_merchant_advance,
      //     farmer_loan) don't attach to sales so we skip them.
      // Each iteration re-queries residuals so subsequent receipts see the
      // updated attribution from earlier ones in the same pass.
      const legacyReceipts = (await db.execute(sql`
        SELECT cr.id,
               cr.cold_storage_id,
               cr.payer_type,
               cr.buyer_name,
               cr.farmer_ledger_id,
               cr.amount,
               cr.round_off,
               cr.applied_amount,
               cr.received_at,
               cr.applies_to_sale_id
        FROM cash_receipts cr
        WHERE cr.is_reversed = 0
          AND NOT EXISTS (
            SELECT 1 FROM cash_receipt_applications cra
            WHERE cra.cash_receipt_id = cr.id
          )
        ORDER BY cr.received_at ASC, cr.created_at ASC
      `)).rows as Array<{
        id: string;
        cold_storage_id: string;
        payer_type: string;
        buyer_name: string | null;
        farmer_ledger_id: string | null;
        amount: number;
        round_off: number;
        applied_amount: number | null;
        received_at: Date;
        applies_to_sale_id: string | null;
      }>;

      const round2 = (n: number) => Math.round(n * 100) / 100;

      for (const r of legacyReceipts) {
        const baseAmount = Number(r.amount) || 0;
        const roundOff = Number(r.round_off) || 0;
        const fullGross = round2(baseAmount + roundOff);
        if (fullGross <= 0) continue;
        // Cap allocation at the portion that historically flowed into sales:
        // applied_amount tracks how much of `amount` (base) the FIFO wrote
        // into salesHistory.paid_amount; the proportional round-off slice
        // is `round_off * applied_amount / amount`. The remainder stayed as
        // unapplied buyer/farmer credit and never touched a sale, so it
        // shouldn't get a junction row.
        const appliedBase = r.applied_amount == null
          ? baseAmount
          : Math.min(Number(r.applied_amount) || 0, baseAmount);
        const gross = baseAmount > 0
          ? round2(appliedBase + (roundOff * appliedBase) / baseAmount)
          : 0;
        if (gross <= 0) continue;
        const appliedAt = r.received_at instanceof Date
          ? r.received_at
          : new Date(r.received_at as unknown as string);

        if (r.applies_to_sale_id) {
          await db.insert(cashReceiptApplications).values({
            id: randomUUID(),
            coldStorageId: r.cold_storage_id,
            cashReceiptId: r.id,
            salesHistoryId: r.applies_to_sale_id,
            amountApplied: gross,
            appliedAt,
          });
          continue;
        }

        const isBuyerReceipt =
          r.payer_type === "cold_merchant" || r.payer_type === "sales_goods";
        const isFarmerReceipt = r.payer_type === "farmer";
        if (!isBuyerReceipt && !isFarmerReceipt) continue;

        let candidates: Array<{ id: string; residual: number }> = [];
        if (isBuyerReceipt) {
          if (!r.buyer_name) continue;
          const rows = (await db.execute(sql`
            SELECT s.id,
                   GREATEST(
                     COALESCE(s.paid_amount, 0)
                       - COALESCE(s.discount_allocated, 0)
                       - COALESCE((
                           SELECT SUM(cra.amount_applied)
                           FROM cash_receipt_applications cra
                           WHERE cra.sales_history_id = s.id
                         ), 0),
                     0
                   ) AS residual
            FROM sales_history s
            WHERE s.cold_storage_id = ${r.cold_storage_id}
              AND COALESCE(s.paid_amount, 0) > 0
              AND LOWER(TRIM(CASE
                WHEN s.is_transfer_reversed = 1 THEN s.buyer_name
                WHEN s.transfer_to_buyer_name IS NOT NULL AND s.transfer_to_buyer_name <> ''
                  THEN s.transfer_to_buyer_name
                ELSE s.buyer_name
              END)) = LOWER(TRIM(${r.buyer_name}))
            ORDER BY s.sold_at ASC
          `)).rows as Array<{ id: string; residual: number }>;
          candidates = rows.map((c) => ({ id: c.id, residual: Number(c.residual) || 0 }));
        } else {
          // farmer / self-sale receipt
          const composite = r.buyer_name; // e.g. "Name (Village)"
          const rows = (await db.execute(sql`
            SELECT s.id,
                   GREATEST(
                     COALESCE(s.paid_amount, 0)
                       - COALESCE(s.discount_allocated, 0)
                       - COALESCE((
                           SELECT SUM(cra.amount_applied)
                           FROM cash_receipt_applications cra
                           WHERE cra.sales_history_id = s.id
                         ), 0),
                     0
                   ) AS residual
            FROM sales_history s
            WHERE s.cold_storage_id = ${r.cold_storage_id}
              AND s.is_self_sale = 1
              AND COALESCE(s.paid_amount, 0) > 0
              AND (
                (s.farmer_ledger_id IS NOT NULL AND s.farmer_ledger_id = ${r.farmer_ledger_id ?? ""})
                OR (
                  ${r.farmer_ledger_id === null ? 1 : 0} = 1
                  AND LOWER(TRIM(s.farmer_name || ' (' || s.village || ')')) = LOWER(TRIM(${composite ?? ""}))
                )
              )
            ORDER BY s.sold_at ASC
          `)).rows as Array<{ id: string; residual: number }>;
          candidates = rows.map((c) => ({ id: c.id, residual: Number(c.residual) || 0 }));
        }

        let remaining = gross;
        for (const c of candidates) {
          if (remaining < 0.005) break;
          if (c.residual < 0.005) continue;
          const slice = round2(Math.min(remaining, c.residual));
          if (slice < 0.005) continue;
          await db.insert(cashReceiptApplications).values({
            id: randomUUID(),
            coldStorageId: r.cold_storage_id,
            cashReceiptId: r.id,
            salesHistoryId: c.id,
            amountApplied: slice,
            appliedAt,
          });
          remaining = round2(remaining - slice);
        }
      }
    },
  },
  {
    name: "2026-04-04_add_base_hammali_amount",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE sales_history
        ADD COLUMN IF NOT EXISTS base_hammali_amount REAL
      `);
      await db.execute(sql`
        UPDATE sales_history
        SET base_hammali_amount = CASE
          WHEN base_charge_amount_at_sale = 0 THEN 0
          WHEN hammali IS NOT NULL THEN
            hammali * CASE
              WHEN charge_basis = 'totalRemaining' THEN COALESCE(remaining_size_at_sale, quantity_sold)
              ELSE quantity_sold
            END
          ELSE 0
        END
        WHERE base_hammali_amount IS NULL
      `);
    },
  },
  {
    name: "2026-04-21_backfill_extra_due_to_merchant_original",
    up: async () => {
      // Backfill extra_due_to_merchant_original for historical records that were created
      // before createSalesHistory was fixed to always seed this column. Without this,
      // payment reversals cannot restore the correct extraDueToMerchant baseline.
      await db.execute(sql`
        UPDATE sales_history
        SET extra_due_to_merchant_original = extra_due_to_merchant
        WHERE extra_due_to_merchant > 0
          AND (extra_due_to_merchant_original IS NULL OR extra_due_to_merchant_original = 0)
      `);
    },
  },
  {
    // Task #219 — Convert the bare `timestamp` columns whose value is shown
    // to the user as a calendar day (or used in `getFullYear()` filters) to
    // `timestamptz` so the absolute instant survives the `pg` driver
    // round-trip. Per project convention every existing value was written
    // as IST wall-clock (see server/db.ts), so `AT TIME ZONE 'Asia/Kolkata'`
    // re-interprets the historic rows as IST and produces the correct UTC
    // instant — which corrects the off-by-one bug for late-evening writes
    // both going forward AND retroactively.
    //
    // exit_history.exit_date is intentionally excluded: Task #218 already
    // fixed the route layer to anchor at noon IST, and the four
    // `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'` SQL wrappers in
    // server/storage.ts depend on the column staying a bare timestamp.
    name: "2026-04-23_convert_displayed_dates_to_timestamptz",
    up: async () => {
      // Superseded by `2026-04-23_convert_all_timestamps_to_timestamptz`
      // (Task #220), which is a strict superset of the original 8-column
      // conversion list. Kept as an empty entry so the migration name
      // continues to be recorded as applied on environments that ran the
      // earlier version. New environments will simply see this entry as a
      // no-op and then apply the table-wide migration immediately below.
    },
  },
  {
    // Task #220 — Pre-emptively convert every remaining bare `timestamp`
    // column in the schema to `timestamptz` so the off-by-one IST/UTC bug
    // class is eliminated entirely (not just for the columns that happen to
    // be displayed today). Strict superset of the Task #219 conversion list
    // above. Idempotent per-column: each ALTER only runs when the column is
    // still `timestamp without time zone`, so re-runs and partial overlaps
    // with the post-merge.sh psql block are no-ops.
    //
    // exit_history.exit_date remains the single documented exception — see
    // schema.ts and replit.md for why (Task #218 fixed it at the route layer
    // and four `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'` SQL wrappers
    // in server/storage.ts depend on it staying a bare timestamp).
    name: "2026-04-23_convert_all_timestamps_to_timestamptz",
    up: async () => {
      const conversions: Array<{ table: string; column: string }> = [
        { table: "migrations", column: "applied_at" },
        { table: "cold_storage_users", column: "created_at" },
        { table: "user_sessions", column: "created_at" },
        { table: "user_sessions", column: "last_accessed_at" },
        { table: "lots", column: "sold_at" },
        { table: "lots", column: "created_at" },
        { table: "sales_history", column: "paid_at" },
        { table: "sales_history", column: "entry_date" },
        { table: "sales_history", column: "sold_at" },
        { table: "sales_history", column: "transfer_date" },
        { table: "sales_history", column: "transfer_reversed_at" },
        { table: "lot_edit_history", column: "changed_at" },
        { table: "sale_edit_history", column: "changed_at" },
        { table: "maintenance_records", column: "created_at" },
        { table: "exit_history", column: "reversed_at" },
        { table: "exit_history", column: "created_at" },
        { table: "cash_receipts", column: "received_at" },
        { table: "cash_receipts", column: "reversed_at" },
        { table: "cash_receipts", column: "created_at" },
        { table: "cash_receipt_applications", column: "applied_at" },
        { table: "cash_receipt_applications", column: "created_at" },
        { table: "expenses", column: "paid_at" },
        { table: "expenses", column: "reversed_at" },
        { table: "expenses", column: "created_at" },
        { table: "cash_transfers", column: "transferred_at" },
        { table: "cash_transfers", column: "reversed_at" },
        { table: "cash_transfers", column: "created_at" },
        { table: "cash_opening_balances", column: "created_at" },
        { table: "cash_opening_balances", column: "updated_at" },
        { table: "opening_receivables", column: "effective_date" },
        { table: "opening_receivables", column: "last_accrual_date" },
        { table: "opening_receivables", column: "previous_effective_date" },
        { table: "opening_receivables", column: "created_at" },
        { table: "opening_payables", column: "created_at" },
        { table: "discounts", column: "discount_date" },
        { table: "discounts", column: "reversed_at" },
        { table: "discounts", column: "created_at" },
        { table: "bank_accounts", column: "created_at" },
        { table: "farmer_advance_freight", column: "effective_date" },
        { table: "farmer_advance_freight", column: "last_accrual_date" },
        { table: "farmer_advance_freight", column: "previous_effective_date" },
        { table: "farmer_advance_freight", column: "reversed_at" },
        { table: "farmer_advance_freight", column: "created_at" },
        { table: "merchant_advance", column: "effective_date" },
        { table: "merchant_advance", column: "last_accrual_date" },
        { table: "merchant_advance", column: "original_effective_date" },
        { table: "merchant_advance", column: "previous_effective_date" },
        { table: "merchant_advance", column: "reversed_at" },
        { table: "merchant_advance", column: "created_at" },
        { table: "merchant_advance_events", column: "event_date" },
        { table: "merchant_advance_events", column: "effective_date_before" },
        { table: "merchant_advance_events", column: "effective_date_after" },
        { table: "merchant_advance_events", column: "created_at" },
        { table: "farmer_loan", column: "effective_date" },
        { table: "farmer_loan", column: "last_accrual_date" },
        { table: "farmer_loan", column: "original_effective_date" },
        { table: "farmer_loan", column: "previous_effective_date" },
        { table: "farmer_loan", column: "reversed_at" },
        { table: "farmer_loan", column: "created_at" },
        { table: "farmer_loan_events", column: "event_date" },
        { table: "farmer_loan_events", column: "effective_date_before" },
        { table: "farmer_loan_events", column: "effective_date_after" },
        { table: "farmer_loan_events", column: "created_at" },
        { table: "farmer_ledger", column: "archived_at" },
        { table: "farmer_ledger", column: "created_at" },
        { table: "farmer_ledger_edit_history", column: "modified_at" },
        { table: "buyer_ledger", column: "archived_at" },
        { table: "buyer_ledger", column: "created_at" },
        { table: "buyer_ledger_edit_history", column: "modified_at" },
        { table: "assets", column: "purchase_date" },
        { table: "assets", column: "disposed_at" },
        { table: "assets", column: "created_at" },
        { table: "asset_depreciation_log", column: "calculated_at" },
        { table: "liabilities", column: "start_date" },
        { table: "liabilities", column: "due_date" },
        { table: "liabilities", column: "settled_at" },
        { table: "liabilities", column: "created_at" },
        { table: "liability_payments", column: "paid_at" },
        { table: "liability_payments", column: "created_at" },
      ];
      for (const { table, column } of conversions) {
        await db.execute(sql.raw(
          `DO $$ BEGIN ` +
          `IF (SELECT data_type FROM information_schema.columns ` +
          `WHERE table_name = '${table}' AND column_name = '${column}') ` +
          `= 'timestamp without time zone' THEN ` +
          `ALTER TABLE ${table} ` +
          `ALTER COLUMN ${column} TYPE timestamptz ` +
          `USING ${column} AT TIME ZONE 'Asia/Kolkata'; ` +
          `END IF; END $$`
        ));
      }
    },
  },
  {
    // Task #262 — backfill `remaining_size_at_sale` for legacy sales rows
    // created before the column was added to the schema. Without this, the
    // new "Remaining # Bags" column on the Sales History table would render
    // "—" for every historical sale on production databases (e.g. the
    // Hostinger VPS) because only sales created AFTER the column existed
    // have it populated by createSalesHistory.
    //
    // For every NULL row, set remaining_size_at_sale to:
    //   original_lot_size − Σ quantity_sold of all PRIOR sales of the same
    //   lot, ordered chronologically by (sold_at, id).
    //
    // This matches the semantics of the column ("remaining bags BEFORE this
    // sale") so the UI's `remaining_size_at_sale - quantity_sold` formula
    // produces the correct post-sale remaining for every historical row.
    name: "2026-05-01_backfill_remaining_size_at_sale",
    up: async () => {
      await db.execute(sql`
        UPDATE sales_history AS sh
        SET remaining_size_at_sale = computed.remaining_before
        FROM (
          SELECT
            id,
            original_lot_size - COALESCE(
              SUM(quantity_sold) OVER (
                PARTITION BY lot_id
                ORDER BY sold_at, id
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ),
              0
            ) AS remaining_before
          FROM sales_history
        ) AS computed
        WHERE sh.id = computed.id
          AND sh.remaining_size_at_sale IS NULL
      `);
    },
  },
  {
    // Adds a true row-creation timestamp to sales_history so the Sales
    // History display can sort same-date sales as "newest entered first"
    // (Task #264). The existing `sold_at` column always stores noon IST of
    // the operator-picked sale date, so it cannot tell two same-date sales
    // apart. The legacy backfill below copies sold_at into created_at —
    // this is best-effort: the true historical entry order of sales
    // recorded before this migration was never persisted and is not
    // recoverable. From this migration forward, every new sales_history
    // INSERT auto-captures NOW() (which, with the connection-level
    // SET TIME ZONE 'Asia/Kolkata' in server/db.ts, evaluates to IST
    // wall-clock).
    name: "2026-05-01_add_created_at_to_sales_history",
    up: async () => {
      await db.execute(sql`
        ALTER TABLE sales_history
        ADD COLUMN IF NOT EXISTS created_at timestamptz
      `);
      // Backfill any pre-existing rows with sold_at as a deterministic
      // placeholder. timestamptz -> timestamptz is an instant copy, so
      // no AT TIME ZONE wrapper is needed (or correct).
      await db.execute(sql`
        UPDATE sales_history
        SET created_at = sold_at
        WHERE created_at IS NULL
      `);
      await db.execute(sql`
        ALTER TABLE sales_history
        ALTER COLUMN created_at SET DEFAULT NOW()
      `);
      await db.execute(sql`
        ALTER TABLE sales_history
        ALTER COLUMN created_at SET NOT NULL
      `);
    },
  },
  {
    // Task #312 — heal Merchant Extras drain by re-replaying every buyer's
    // extras FIFO through the ledger-ID-keyed `recomputeBuyerExtras` helper.
    //
    // Why this is needed: the legacy `recomputeBuyerPayments` reset and
    // replay queries matched extras-bearing sales by exact
    // `LOWER(TRIM(buyer_name))`. Any drift between a receipt's `buyer_name`
    // text and its sales' `buyer_name` text (rename, capitalisation,
    // trailing space, merge) silently excluded those sales from the FIFO
    // pool — producing the Jatisha symptom (₹8,720 receipt only drained
    // ₹560 instead of fully closing the buyer's extras). The new code path
    // keys on `buyer_ledger_id`, so a one-shot replay heals every legacy
    // mis-drained row in place.
    //
    // Pre-state snapshot: this migration first creates a never-dropped
    // snapshot table `merchant_extras_heal_snapshot_2026_05_28` and copies
    // current `extra_due_to_merchant` / `extra_due_to_merchant_original`
    // for every extras-bearing sale plus current `applied_amount` /
    // `unapplied_amount` for every non-reversed merchant_extras receipt
    // BEFORE replaying. Reversal path is documented in the snapshot table.
    //
    // Idempotency: re-running is safe. `CREATE TABLE IF NOT EXISTS` plus
    // an `INSERT … ON CONFLICT DO NOTHING` keyed on (row_kind, row_id)
    // means a second run inserts no extra snapshot rows and the recompute
    // helper is itself idempotent (resets to extra_due_to_merchant_original
    // and replays from there).
    //
    // Transaction note: `runMigrations` wraps each `up()` in
    // `db.transaction(async tx => ...)`, but THIS migration uses the
    // module-level `db` (and the storage helper does too). With drizzle-pg
    // those calls grab a different pooled connection and therefore run on
    // autocommit — NOT inside the outer migration tx. That's tolerated
    // here because the design is recovery-safe under that model: the
    // snapshot INSERTs are `ON CONFLICT DO NOTHING` and the recompute is
    // idempotent (resets from `extra_due_to_merchant_original` every time,
    // then replays). If the migration aborts mid-loop, the registry row
    // rolls back, the next startup re-runs the whole loop, snapshots skip
    // already-snapshotted rows, and recompute re-converges to the same
    // post-state. The dry-run path writes nothing at all (the `if (!dryRun)`
    // guards every write) and then throws to abort the registry insert.
    //
    // Dry-run: set `HEAL_DRY_RUN=1` in the environment. The migration will
    // log the planned changes per (cold_storage_id, buyer_ledger_id) and
    // then THROW to abort the transaction (so neither the snapshot table
    // nor the migrations registry record the run). Re-run with the env
    // var unset (or set to 0) to actually apply.
    name: "2026-05-28_heal_merchant_extras_drain_by_ledger_id",
    up: async () => {
      const dryRun = process.env.HEAL_DRY_RUN === "1";

      const snapshotTable = "merchant_extras_heal_snapshot_2026_05_28";

      // Dry-run must be strictly read-only — no DDL, no DML. Gate the
      // snapshot-table creation behind `!dryRun` so HEAL_DRY_RUN=1 leaves
      // the database byte-for-byte unchanged (even the empty snapshot
      // table is a write).
      if (!dryRun) {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS ${sql.identifier(snapshotTable)} (
            row_kind TEXT NOT NULL,
            row_id VARCHAR NOT NULL,
            cold_storage_id VARCHAR NOT NULL,
            buyer_ledger_id VARCHAR,
            extra_due_to_merchant DOUBLE PRECISION,
            extra_due_to_merchant_original DOUBLE PRECISION,
            applied_amount DOUBLE PRECISION,
            unapplied_amount DOUBLE PRECISION,
            snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (row_kind, row_id)
          )
        `);
      }

      // Build the worklist: every (cold_storage_id, buyer_ledger_id) that
      // has at least one non-reversed merchant_extras receipt OR at least
      // one extras-bearing sale with a non-null ledger ID.
      const worklist = (await db.execute(sql`
        SELECT DISTINCT cold_storage_id, buyer_ledger_id
        FROM (
          SELECT cold_storage_id, buyer_ledger_id
          FROM cash_receipts
          WHERE payer_type = 'cold_merchant'
            AND due_type = 'merchant_extras'
            AND is_reversed = 0
            AND applies_to_sale_id IS NULL
            AND buyer_ledger_id IS NOT NULL
          UNION ALL
          SELECT cold_storage_id, buyer_ledger_id
          FROM sales_history
          WHERE buyer_ledger_id IS NOT NULL
            AND (
              COALESCE(extra_due_to_merchant, 0) > 0
              OR COALESCE(extra_due_to_merchant_original, 0) > 0
            )
        ) u
        WHERE buyer_ledger_id IS NOT NULL
        ORDER BY cold_storage_id, buyer_ledger_id
      `)).rows as Array<{ cold_storage_id: string; buyer_ledger_id: string }>;

      console.log(
        `[migration 2026-05-28_heal_merchant_extras_drain_by_ledger_id]` +
          ` ${worklist.length} (cold_storage_id, buyer_ledger_id) pair(s) to ` +
          (dryRun ? "ANALYSE (HEAL_DRY_RUN=1)" : "heal")
      );

      // Aggregate per-buyer failures so one bad ledger doesn't abort the
      // whole rollout. We re-throw at the end if any buyer failed so the
      // migration is NOT marked applied — the operator must investigate
      // and re-run. Each successful buyer's writes remain committed (by
      // design: heal is idempotent, so partial progress is safe to retry).
      const failures: Array<{ csid: string; blid: string; error: string }> = [];

      for (const { cold_storage_id: csid, buyer_ledger_id: blid } of worklist) {
        // Snapshot the pre-state for THIS buyer ledger.
        if (!dryRun) {
          try {
            // Per-buyer transaction boundary: snapshot inserts run inside
            // a tx so a mid-snapshot failure rolls back the partial
            // snapshot rows for this buyer. `recomputeBuyerExtras` uses
            // the module-level `db` (not tx) — that's autocommit-safe
            // because the helper is itself idempotent (deletes
            // applications, resets sales, replays from scratch); a retry
            // converges. If snapshot succeeds but recompute throws, the
            // snapshot rows persist as the paper trail and the failure is
            // logged + reported at the end.
            await db.transaction(async (tx) => {
              await tx.execute(sql`
                INSERT INTO ${sql.identifier(snapshotTable)}
                  (row_kind, row_id, cold_storage_id, buyer_ledger_id,
                   extra_due_to_merchant, extra_due_to_merchant_original,
                   applied_amount, unapplied_amount)
                SELECT 'sale',
                       sh.id,
                       sh.cold_storage_id,
                       sh.buyer_ledger_id,
                       sh.extra_due_to_merchant,
                       sh.extra_due_to_merchant_original,
                       NULL,
                       NULL
                FROM sales_history sh
                WHERE sh.cold_storage_id = ${csid}
                  AND sh.buyer_ledger_id = ${blid}
                  AND (
                    COALESCE(sh.extra_due_to_merchant, 0) > 0
                    OR COALESCE(sh.extra_due_to_merchant_original, 0) > 0
                  )
                ON CONFLICT (row_kind, row_id) DO NOTHING
              `);
              await tx.execute(sql`
                INSERT INTO ${sql.identifier(snapshotTable)}
                  (row_kind, row_id, cold_storage_id, buyer_ledger_id,
                   extra_due_to_merchant, extra_due_to_merchant_original,
                   applied_amount, unapplied_amount)
                SELECT 'receipt',
                       cr.id,
                       cr.cold_storage_id,
                       cr.buyer_ledger_id,
                       NULL,
                       NULL,
                       cr.applied_amount,
                       cr.unapplied_amount
                FROM cash_receipts cr
                WHERE cr.cold_storage_id = ${csid}
                  AND cr.buyer_ledger_id = ${blid}
                  AND cr.payer_type = 'cold_merchant'
                  AND cr.due_type = 'merchant_extras'
                  AND cr.is_reversed = 0
                  AND cr.applies_to_sale_id IS NULL
                ON CONFLICT (row_kind, row_id) DO NOTHING
              `);
            });

            const result = await storage.recomputeBuyerExtras(blid, csid);
            console.log(
              `  cs=${csid.slice(0, 8)} ledger=${blid.slice(0, 8)} → ` +
                `salesReset=${result.salesReset} receiptsReplayed=${result.receiptsReplayed}`
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failures.push({ csid, blid, error: msg });
            console.error(
              `  [FAIL] cs=${csid.slice(0, 8)} ledger=${blid.slice(0, 8)} → ${msg}`
            );
            // Continue to next buyer.
          }
        } else {
          // Dry-run: just enumerate what we'd touch.
          const saleCount = (await db.execute(sql`
            SELECT COUNT(*)::int AS n
            FROM sales_history
            WHERE cold_storage_id = ${csid}
              AND buyer_ledger_id = ${blid}
              AND (
                COALESCE(extra_due_to_merchant, 0) > 0
                OR COALESCE(extra_due_to_merchant_original, 0) > 0
              )
          `)).rows[0] as { n: number };
          const receiptCount = (await db.execute(sql`
            SELECT COUNT(*)::int AS n
            FROM cash_receipts
            WHERE cold_storage_id = ${csid}
              AND buyer_ledger_id = ${blid}
              AND payer_type = 'cold_merchant'
              AND due_type = 'merchant_extras'
              AND is_reversed = 0
              AND applies_to_sale_id IS NULL
          `)).rows[0] as { n: number };
          console.log(
            `  [dry-run] cs=${csid.slice(0, 8)} ledger=${blid.slice(0, 8)} → ` +
              `${saleCount.n} extras-bearing sale(s), ${receiptCount.n} extras receipt(s)`
          );
        }
      }

      if (dryRun) {
        throw new Error(
          "HEAL_DRY_RUN=1 — Merchant Extras heal aborted without writing. " +
            "Unset HEAL_DRY_RUN (or set to 0) and restart to apply for real."
        );
      }

      if (failures.length > 0) {
        const summary = failures
          .map((f) => `cs=${f.csid.slice(0, 8)} ledger=${f.blid.slice(0, 8)}: ${f.error}`)
          .join("; ");
        throw new Error(
          `[migration 2026-05-28_heal_merchant_extras_drain_by_ledger_id] ` +
            `${failures.length} buyer(s) failed; migration NOT marked applied. ` +
            `Successful buyers were committed (heal is idempotent — safe to retry). ` +
            `Failures: ${summary}`
        );
      }
    },
  },
  {
    // Task #313 — Cold-charges drain by buyer_ledger_id.
    //
    // Companion heal to the 2026-05-28 merchant_extras heal. Where the prior
    // pass moved the EXTRAS-side FIFO from buyer_name matching onto
    // buyer_ledger_id, this pass does the same for the COLD-CHARGES side:
    // opening_receivables → sales_history (cold_storage_charge) → cash_receipts
    // (cold_charges + null due_type) → discounts (buyerAllocations JSON).
    //
    // Before the recompute can drain by ledger, two prep steps:
    //   (a) Backfill `sales_history.transfer_to_buyer_ledger_id` from
    //       `buyer_ledger` by looking up the row whose name matches
    //       `transfer_to_buyer_name` within the same cold_storage_id.
    //       Only rows with non-empty transfer_to_buyer_name AND null
    //       transfer_to_buyer_ledger_id are touched.
    //   (b) Per-buyer-ledger recompute via `recomputeBuyerPayments(csid, blid)`.
    //       The new ledger-first predicate (with legacy name fallback for
    //       null-ledger rows) is identical across reset, replay, and
    //       discount-allocation matching.
    //
    // Worklist is every (cold_storage_id, buyer_ledger_id) that has at
    // least one non-reversed cold_charges receipt, one cold_merchant
    // opening receivable, or one sale whose ORIGINAL or TRANSFER-TO ledger
    // ID is the buyer. Null-ledger legacy rows are NOT in the worklist —
    // they will be picked up next time a user-driven recompute fires for a
    // matching ledger (via the name-fallback branch).
    //
    // Dry-run: set `HEAL_DRY_RUN=1` in the environment. The migration logs
    // the planned changes per (cold_storage_id, buyer_ledger_id) and then
    // THROWS to abort the transaction — neither the snapshot table nor the
    // migrations registry record the run. Re-run with the env var unset
    // (or set to 0) to actually apply.
    name: "2026-05-29_heal_cold_charges_drain_by_ledger_id",
    up: async () => {
      const dryRun = process.env.HEAL_DRY_RUN === "1";

      const snapshotTable = "cold_charges_heal_snapshot_2026_05_29";

      if (!dryRun) {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS ${sql.identifier(snapshotTable)} (
            row_kind TEXT NOT NULL,
            row_id VARCHAR NOT NULL,
            cold_storage_id VARCHAR NOT NULL,
            buyer_ledger_id VARCHAR,
            transfer_to_buyer_ledger_id VARCHAR,
            transfer_to_buyer_name TEXT,
            cold_storage_charge DOUBLE PRECISION,
            paid_amount DOUBLE PRECISION,
            payment_status TEXT,
            opening_receivable_paid DOUBLE PRECISION,
            applied_amount DOUBLE PRECISION,
            unapplied_amount DOUBLE PRECISION,
            snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (row_kind, row_id)
          )
        `);
        // Idempotent column add for snapshots created by an earlier run.
        await db.execute(sql`
          ALTER TABLE ${sql.identifier(snapshotTable)}
          ADD COLUMN IF NOT EXISTS transfer_to_buyer_name TEXT
        `);
      }

      // Unresolved-transfer warning: rows whose transfer_to_buyer_name has
      // no matching buyer_ledger row (so backfill below CANNOT touch them).
      // Logged whether or not dry-run; rolls back into the worklist later
      // only when a user manually creates the missing ledger entry.
      const unresolved = (await db.execute(sql`
        SELECT sh.id, sh.cold_storage_id, sh.transfer_to_buyer_name
        FROM sales_history sh
        WHERE sh.transfer_to_buyer_ledger_id IS NULL
          AND sh.transfer_to_buyer_name IS NOT NULL
          AND TRIM(sh.transfer_to_buyer_name) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM buyer_ledger bl
            WHERE bl.cold_storage_id = sh.cold_storage_id
              AND LOWER(TRIM(bl.buyer_name)) = LOWER(TRIM(sh.transfer_to_buyer_name))
          )
      `)).rows as Array<{ id: string; cold_storage_id: string; transfer_to_buyer_name: string }>;
      if (unresolved.length > 0) {
        console.warn(
          `[migration 2026-05-29_heal_cold_charges_drain_by_ledger_id]` +
            ` WARNING: ${unresolved.length} sale(s) have transfer_to_buyer_name that` +
            ` does NOT resolve to any buyer_ledger row — these will NOT be backfilled.` +
            ` Manual buyer-ledger creation required to bring them into the ledger-first drain.`
        );
        for (const r of unresolved.slice(0, 20)) {
          console.warn(
            `  unresolved sale=${r.id.slice(0, 8)} cs=${r.cold_storage_id.slice(0, 8)}` +
              ` transfer_to_buyer_name="${r.transfer_to_buyer_name}"`
          );
        }
        if (unresolved.length > 20) {
          console.warn(`  ... (+${unresolved.length - 20} more)`);
        }
      }

      // (a) Backfill `transfer_to_buyer_ledger_id` from buyer_ledger by name.
      //     Scoped per cold_storage_id and only on rows where the column is
      //     currently NULL but the name column is non-empty. Skipped under
      //     dry-run (strictly read-only).
      let backfilled = 0;
      if (!dryRun) {
        const backfillResult = await db.execute(sql`
          UPDATE sales_history sh
          SET transfer_to_buyer_ledger_id = bl.id
          FROM buyer_ledger bl
          WHERE sh.cold_storage_id = bl.cold_storage_id
            AND sh.transfer_to_buyer_ledger_id IS NULL
            AND sh.transfer_to_buyer_name IS NOT NULL
            AND TRIM(sh.transfer_to_buyer_name) <> ''
            AND LOWER(TRIM(sh.transfer_to_buyer_name)) = LOWER(TRIM(bl.buyer_name))
        `);
        backfilled = (backfillResult as { rowCount?: number }).rowCount ?? 0;
        console.log(
          `[migration 2026-05-29_heal_cold_charges_drain_by_ledger_id]` +
            ` backfilled transfer_to_buyer_ledger_id on ${backfilled} sale(s)`
        );
      } else {
        const planned = (await db.execute(sql`
          SELECT COUNT(*)::int AS n
          FROM sales_history sh
          JOIN buyer_ledger bl
            ON bl.cold_storage_id = sh.cold_storage_id
           AND LOWER(TRIM(sh.transfer_to_buyer_name)) = LOWER(TRIM(bl.buyer_name))
          WHERE sh.transfer_to_buyer_ledger_id IS NULL
            AND sh.transfer_to_buyer_name IS NOT NULL
            AND TRIM(sh.transfer_to_buyer_name) <> ''
        `)).rows[0] as { n: number };
        console.log(
          `[migration 2026-05-29_heal_cold_charges_drain_by_ledger_id]` +
            ` [dry-run] would backfill transfer_to_buyer_ledger_id on ${planned.n} sale(s)`
        );
      }

      // (b) Build the worklist: every (cold_storage_id, buyer_ledger_id)
      //     that touches the cold-charges side.
      const worklist = (await db.execute(sql`
        SELECT DISTINCT cold_storage_id, buyer_ledger_id
        FROM (
          SELECT cold_storage_id, buyer_ledger_id
          FROM cash_receipts
          WHERE payer_type = 'cold_merchant'
            AND COALESCE(due_type, 'cold_charges') = 'cold_charges'
            AND is_reversed = 0
            AND applies_to_sale_id IS NULL
            AND buyer_ledger_id IS NOT NULL
          UNION ALL
          SELECT cold_storage_id, buyer_ledger_id
          FROM opening_receivables
          WHERE payer_type = 'cold_merchant'
            AND buyer_ledger_id IS NOT NULL
          UNION ALL
          SELECT cold_storage_id, buyer_ledger_id
          FROM sales_history
          WHERE buyer_ledger_id IS NOT NULL
          UNION ALL
          SELECT cold_storage_id, transfer_to_buyer_ledger_id AS buyer_ledger_id
          FROM sales_history
          WHERE transfer_to_buyer_ledger_id IS NOT NULL
        ) u
        WHERE buyer_ledger_id IS NOT NULL
        ORDER BY cold_storage_id, buyer_ledger_id
      `)).rows as Array<{ cold_storage_id: string; buyer_ledger_id: string }>;

      console.log(
        `[migration 2026-05-29_heal_cold_charges_drain_by_ledger_id]` +
          ` ${worklist.length} (cold_storage_id, buyer_ledger_id) pair(s) to ` +
          (dryRun ? "ANALYSE (HEAL_DRY_RUN=1)" : "heal")
      );

      const failures: Array<{ csid: string; blid: string; error: string }> = [];

      for (const { cold_storage_id: csid, buyer_ledger_id: blid } of worklist) {
        if (!dryRun) {
          try {
            // Per-buyer tx for the snapshot; `recomputeBuyerPayments` uses
            // module-level `db` (autocommit-safe because the helper is
            // itself idempotent — clears applications, resets, replays
            // from scratch; a retry converges).
            await db.transaction(async (tx) => {
              await tx.execute(sql`
                INSERT INTO ${sql.identifier(snapshotTable)}
                  (row_kind, row_id, cold_storage_id, buyer_ledger_id,
                   transfer_to_buyer_ledger_id, transfer_to_buyer_name,
                   cold_storage_charge,
                   paid_amount, payment_status,
                   opening_receivable_paid, applied_amount, unapplied_amount)
                SELECT 'sale',
                       sh.id,
                       sh.cold_storage_id,
                       sh.buyer_ledger_id,
                       sh.transfer_to_buyer_ledger_id,
                       sh.transfer_to_buyer_name,
                       sh.cold_storage_charge,
                       sh.paid_amount,
                       sh.payment_status,
                       NULL, NULL, NULL
                FROM sales_history sh
                WHERE sh.cold_storage_id = ${csid}
                  AND (
                    sh.buyer_ledger_id = ${blid}
                    OR sh.transfer_to_buyer_ledger_id = ${blid}
                  )
                ON CONFLICT (row_kind, row_id) DO NOTHING
              `);
              await tx.execute(sql`
                INSERT INTO ${sql.identifier(snapshotTable)}
                  (row_kind, row_id, cold_storage_id, buyer_ledger_id,
                   transfer_to_buyer_ledger_id, transfer_to_buyer_name,
                   cold_storage_charge,
                   paid_amount, payment_status,
                   opening_receivable_paid, applied_amount, unapplied_amount)
                SELECT 'receipt',
                       cr.id,
                       cr.cold_storage_id,
                       cr.buyer_ledger_id,
                       NULL, NULL, NULL, NULL, NULL, NULL,
                       cr.applied_amount,
                       cr.unapplied_amount
                FROM cash_receipts cr
                WHERE cr.cold_storage_id = ${csid}
                  AND cr.buyer_ledger_id = ${blid}
                  AND cr.payer_type = 'cold_merchant'
                  AND COALESCE(cr.due_type, 'cold_charges') = 'cold_charges'
                  AND cr.is_reversed = 0
                  AND cr.applies_to_sale_id IS NULL
                ON CONFLICT (row_kind, row_id) DO NOTHING
              `);
              await tx.execute(sql`
                INSERT INTO ${sql.identifier(snapshotTable)}
                  (row_kind, row_id, cold_storage_id, buyer_ledger_id,
                   transfer_to_buyer_ledger_id, transfer_to_buyer_name,
                   cold_storage_charge,
                   paid_amount, payment_status,
                   opening_receivable_paid, applied_amount, unapplied_amount)
                SELECT 'opening_receivable',
                       o.id,
                       o.cold_storage_id,
                       o.buyer_ledger_id,
                       NULL, NULL, NULL, NULL, NULL,
                       o.paid_amount,
                       NULL, NULL
                FROM opening_receivables o
                WHERE o.cold_storage_id = ${csid}
                  AND o.buyer_ledger_id = ${blid}
                  AND o.payer_type = 'cold_merchant'
                ON CONFLICT (row_kind, row_id) DO NOTHING
              `);
            });

            const result = await storage.recomputeBuyerPayments(csid, blid);
            console.log(
              `  cs=${csid.slice(0, 8)} ledger=${blid.slice(0, 8)} → ` +
                `salesUpdated=${result.salesUpdated} receiptsUpdated=${result.receiptsUpdated}`
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failures.push({ csid, blid, error: msg });
            console.error(
              `  [FAIL] cs=${csid.slice(0, 8)} ledger=${blid.slice(0, 8)} → ${msg}`
            );
            // Continue to next buyer.
          }
        } else {
          const saleCount = (await db.execute(sql`
            SELECT COUNT(*)::int AS n
            FROM sales_history
            WHERE cold_storage_id = ${csid}
              AND (buyer_ledger_id = ${blid} OR transfer_to_buyer_ledger_id = ${blid})
          `)).rows[0] as { n: number };
          const receiptCount = (await db.execute(sql`
            SELECT COUNT(*)::int AS n
            FROM cash_receipts
            WHERE cold_storage_id = ${csid}
              AND buyer_ledger_id = ${blid}
              AND payer_type = 'cold_merchant'
              AND COALESCE(due_type, 'cold_charges') = 'cold_charges'
              AND is_reversed = 0
              AND applies_to_sale_id IS NULL
          `)).rows[0] as { n: number };
          const receivableCount = (await db.execute(sql`
            SELECT COUNT(*)::int AS n
            FROM opening_receivables
            WHERE cold_storage_id = ${csid}
              AND buyer_ledger_id = ${blid}
              AND payer_type = 'cold_merchant'
          `)).rows[0] as { n: number };
          console.log(
            `  [dry-run] cs=${csid.slice(0, 8)} ledger=${blid.slice(0, 8)} → ` +
              `${saleCount.n} sale(s) (original+transfer), ${receiptCount.n} cold-charges receipt(s), ${receivableCount.n} opening receivable(s)`
          );
        }
      }

      if (dryRun) {
        throw new Error(
          "HEAL_DRY_RUN=1 — Cold-charges heal aborted without writing. " +
            "Unset HEAL_DRY_RUN (or set to 0) and restart to apply for real."
        );
      }

      if (failures.length > 0) {
        const summary = failures
          .map((f) => `cs=${f.csid.slice(0, 8)} ledger=${f.blid.slice(0, 8)}: ${f.error}`)
          .join("; ");
        throw new Error(
          `[migration 2026-05-29_heal_cold_charges_drain_by_ledger_id] ` +
            `${failures.length} buyer(s) failed; migration NOT marked applied. ` +
            `Successful buyers were committed (heal is idempotent — safe to retry). ` +
            `Failures: ${summary}`
        );
      }
    },
  },
  {
    // Task #317 — one-time heal for buyers whose Merchant Extras receipts
    // under-drained because the previous `recomputeBuyerExtras` (both reset
    // and per-receipt drain) excluded sales with `fifo_exclusion = 1`.
    // `fifo_exclusion` is a cold-charges pool flag (set only by
    // `_applyManualPaymentTx`); it has nothing to do with extras, which live
    // in their own column and have a single payment path. After the code fix
    // drops that predicate, this heal re-runs `recomputeBuyerExtras` for every
    // affected buyer so previously-parked receipts drain to completion.
    //
    // Worklist: every (cold_storage_id, buyer_ledger_id) that has at least
    // one sale with `fifo_exclusion = 1` AND non-zero extras (either current
    // or original). Buyers outside this worklist were not subject to the bug
    // — a recompute on them is a no-op, so we skip them for speed.
    //
    // Dry-run: set `HEAL_DRY_RUN=1`. Logs the planned work per buyer and
    // THROWS to abort the transaction — neither the snapshot table nor the
    // migrations registry record the run. Re-run with the env var unset to
    // actually apply.
    name: "2026-05-29_heal_extras_drain_fifo_exclusion",
    up: async () => {
      const dryRun = process.env.HEAL_DRY_RUN === "1";
      const snapshotTable = "extras_drain_heal_snapshot_2026_05_29";

      if (!dryRun) {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS ${sql.identifier(snapshotTable)} (
            row_kind TEXT NOT NULL,
            row_id VARCHAR NOT NULL,
            cold_storage_id VARCHAR NOT NULL,
            buyer_ledger_id VARCHAR,
            extra_due_to_merchant DOUBLE PRECISION,
            extra_due_to_merchant_original DOUBLE PRECISION,
            applied_amount DOUBLE PRECISION,
            unapplied_amount DOUBLE PRECISION,
            snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (row_kind, row_id)
          )
        `);
      }

      const worklist = (await db.execute(sql`
        SELECT DISTINCT cold_storage_id, buyer_ledger_id
        FROM sales_history
        WHERE buyer_ledger_id IS NOT NULL
          AND COALESCE(fifo_exclusion, 0) = 1
          AND (
            COALESCE(extra_due_to_merchant, 0) > 0
            OR COALESCE(extra_due_to_merchant_original, 0) > 0
          )
        ORDER BY cold_storage_id, buyer_ledger_id
      `)).rows as Array<{ cold_storage_id: string; buyer_ledger_id: string }>;

      console.log(
        `[migration 2026-05-29_heal_extras_drain_fifo_exclusion]` +
          ` ${worklist.length} (cold_storage_id, buyer_ledger_id) pair(s) to ` +
          (dryRun ? "ANALYSE (HEAL_DRY_RUN=1)" : "heal")
      );

      const failures: Array<{ csid: string; blid: string; error: string }> = [];

      for (const { cold_storage_id: csid, buyer_ledger_id: blid } of worklist) {
        if (!dryRun) {
          try {
            await db.transaction(async (tx) => {
              await tx.execute(sql`
                INSERT INTO ${sql.identifier(snapshotTable)}
                  (row_kind, row_id, cold_storage_id, buyer_ledger_id,
                   extra_due_to_merchant, extra_due_to_merchant_original,
                   applied_amount, unapplied_amount)
                SELECT 'sale',
                       sh.id,
                       sh.cold_storage_id,
                       sh.buyer_ledger_id,
                       sh.extra_due_to_merchant,
                       sh.extra_due_to_merchant_original,
                       NULL, NULL
                FROM sales_history sh
                WHERE sh.cold_storage_id = ${csid}
                  AND sh.buyer_ledger_id = ${blid}
                  AND (
                    COALESCE(sh.extra_due_to_merchant, 0) > 0
                    OR COALESCE(sh.extra_due_to_merchant_original, 0) > 0
                  )
                ON CONFLICT (row_kind, row_id) DO NOTHING
              `);
              await tx.execute(sql`
                INSERT INTO ${sql.identifier(snapshotTable)}
                  (row_kind, row_id, cold_storage_id, buyer_ledger_id,
                   extra_due_to_merchant, extra_due_to_merchant_original,
                   applied_amount, unapplied_amount)
                SELECT 'receipt',
                       cr.id,
                       cr.cold_storage_id,
                       cr.buyer_ledger_id,
                       NULL, NULL,
                       cr.applied_amount,
                       cr.unapplied_amount
                FROM cash_receipts cr
                WHERE cr.cold_storage_id = ${csid}
                  AND cr.buyer_ledger_id = ${blid}
                  AND cr.payer_type = 'cold_merchant'
                  AND cr.due_type = 'merchant_extras'
                  AND cr.is_reversed = 0
                  AND cr.applies_to_sale_id IS NULL
                ON CONFLICT (row_kind, row_id) DO NOTHING
              `);
            });

            const result = await storage.recomputeBuyerExtras(blid, csid);
            console.log(
              `  cs=${csid.slice(0, 8)} ledger=${blid.slice(0, 8)} → ` +
                `salesReset=${result.salesReset} receiptsReplayed=${result.receiptsReplayed}`
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failures.push({ csid, blid, error: msg });
            console.error(
              `  [FAIL] cs=${csid.slice(0, 8)} ledger=${blid.slice(0, 8)} → ${msg}`
            );
          }
        } else {
          const saleCount = (await db.execute(sql`
            SELECT COUNT(*)::int AS n
            FROM sales_history
            WHERE cold_storage_id = ${csid}
              AND buyer_ledger_id = ${blid}
              AND COALESCE(fifo_exclusion, 0) = 1
              AND (
                COALESCE(extra_due_to_merchant, 0) > 0
                OR COALESCE(extra_due_to_merchant_original, 0) > 0
              )
          `)).rows[0] as { n: number };
          const receiptStats = (await db.execute(sql`
            SELECT COUNT(*)::int AS n,
                   COALESCE(SUM(unapplied_amount), 0)::float8 AS total_unapplied
            FROM cash_receipts
            WHERE cold_storage_id = ${csid}
              AND buyer_ledger_id = ${blid}
              AND payer_type = 'cold_merchant'
              AND due_type = 'merchant_extras'
              AND is_reversed = 0
              AND applies_to_sale_id IS NULL
          `)).rows[0] as { n: number; total_unapplied: number };
          console.log(
            `  [dry-run] cs=${csid.slice(0, 8)} ledger=${blid.slice(0, 8)} → ` +
              `${saleCount.n} fifo-excluded extras sale(s), ${receiptStats.n} extras receipt(s)` +
              ` with ₹${Number(receiptStats.total_unapplied).toFixed(2)} currently unapplied`
          );
        }
      }

      if (dryRun) {
        throw new Error(
          "HEAL_DRY_RUN=1 — Extras drain heal aborted without writing. " +
            "Unset HEAL_DRY_RUN (or set to 0) and restart to apply for real."
        );
      }

      if (failures.length > 0) {
        const summary = failures
          .map((f) => `cs=${f.csid.slice(0, 8)} ledger=${f.blid.slice(0, 8)}: ${f.error}`)
          .join("; ");
        throw new Error(
          `[migration 2026-05-29_heal_extras_drain_fifo_exclusion] ` +
            `${failures.length} buyer(s) failed; migration NOT marked applied. ` +
            `Successful buyers were committed (heal is idempotent — safe to retry). ` +
            `Failures: ${summary}`
        );
      }
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
