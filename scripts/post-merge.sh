#!/bin/bash
set -e
npm install

# Tasks #219 + #220 — Convert every bare `timestamp` column in the schema to
# `timestamptz` BEFORE `npm run db:push` so drizzle's auto-generated ALTER
# does not fall back to a default cast (which interprets the historic IST
# wall-clock values as UTC and shifts every value by ~5h30m). Each block is
# idempotent: it only runs if the column is still `timestamp without time
# zone`. This is mirrored by the runtime migration
# `2026-04-23_convert_all_timestamps_to_timestamptz` for any environment
# that skips this script. The single documented exception is
# `exit_history.exit_date` — see schema.ts and replit.md for why.
if [ -n "$DATABASE_URL" ]; then
  for pair in \
    "migrations applied_at" \
    "cold_storage_users created_at" \
    "user_sessions created_at" \
    "user_sessions last_accessed_at" \
    "lots sold_at" \
    "lots created_at" \
    "sales_history paid_at" \
    "sales_history entry_date" \
    "sales_history sold_at" \
    "sales_history transfer_date" \
    "sales_history transfer_reversed_at" \
    "lot_edit_history changed_at" \
    "sale_edit_history changed_at" \
    "maintenance_records created_at" \
    "exit_history reversed_at" \
    "exit_history created_at" \
    "cash_receipts received_at" \
    "cash_receipts reversed_at" \
    "cash_receipts created_at" \
    "cash_receipt_applications applied_at" \
    "cash_receipt_applications created_at" \
    "expenses paid_at" \
    "expenses reversed_at" \
    "expenses created_at" \
    "cash_transfers transferred_at" \
    "cash_transfers reversed_at" \
    "cash_transfers created_at" \
    "cash_opening_balances created_at" \
    "cash_opening_balances updated_at" \
    "opening_receivables effective_date" \
    "opening_receivables last_accrual_date" \
    "opening_receivables previous_effective_date" \
    "opening_receivables created_at" \
    "opening_payables created_at" \
    "discounts discount_date" \
    "discounts reversed_at" \
    "discounts created_at" \
    "bank_accounts created_at" \
    "farmer_advance_freight effective_date" \
    "farmer_advance_freight last_accrual_date" \
    "farmer_advance_freight previous_effective_date" \
    "farmer_advance_freight reversed_at" \
    "farmer_advance_freight created_at" \
    "merchant_advance effective_date" \
    "merchant_advance last_accrual_date" \
    "merchant_advance original_effective_date" \
    "merchant_advance previous_effective_date" \
    "merchant_advance reversed_at" \
    "merchant_advance created_at" \
    "merchant_advance_events event_date" \
    "merchant_advance_events effective_date_before" \
    "merchant_advance_events effective_date_after" \
    "merchant_advance_events created_at" \
    "farmer_loan effective_date" \
    "farmer_loan last_accrual_date" \
    "farmer_loan original_effective_date" \
    "farmer_loan previous_effective_date" \
    "farmer_loan reversed_at" \
    "farmer_loan created_at" \
    "farmer_loan_events event_date" \
    "farmer_loan_events effective_date_before" \
    "farmer_loan_events effective_date_after" \
    "farmer_loan_events created_at" \
    "farmer_ledger archived_at" \
    "farmer_ledger created_at" \
    "farmer_ledger_edit_history modified_at" \
    "buyer_ledger archived_at" \
    "buyer_ledger created_at" \
    "buyer_ledger_edit_history modified_at" \
    "assets purchase_date" \
    "assets disposed_at" \
    "assets created_at" \
    "asset_depreciation_log calculated_at" \
    "liabilities start_date" \
    "liabilities due_date" \
    "liabilities settled_at" \
    "liabilities created_at" \
    "liability_payments paid_at" \
    "liability_payments created_at"; do
    set -- $pair
    table=$1
    column=$2
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
      "DO \$\$ BEGIN IF (SELECT data_type FROM information_schema.columns WHERE table_name = '$table' AND column_name = '$column') = 'timestamp without time zone' THEN ALTER TABLE $table ALTER COLUMN $column TYPE timestamptz USING $column AT TIME ZONE 'Asia/Kolkata'; END IF; END \$\$;" \
      || echo "[post-merge] timestamptz conversion for $table.$column skipped (non-fatal)"
  done
fi

npm run db:push

# Guardrail: every sale-touching React Query mutation must call
# invalidateSaleSideEffects(queryClient) so dependent pages (NIKASI / Exit
# Register / Cash Flow / Buyer & Farmer Ledger) refresh automatically. This
# catches forgotten cache invalidations introduced by new features.
node scripts/check-sale-invalidation.mjs

# Idempotent backfill: snapshot lots.marka into sales_history.marka for any
# historical sale rows that were created before sales_history.marka existed.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "UPDATE sales_history SET marka = lots.marka FROM lots WHERE sales_history.lot_id = lots.id AND sales_history.marka IS NULL AND lots.marka IS NOT NULL AND lots.marka <> '';" \
    || echo "[post-merge] sales_history.marka backfill skipped (non-fatal)"

  # Idempotent backfill: denormalise non-reversed exit_history rows into
  # sales_history.exit_bill_numbers / exit_dates as comma-separated strings,
  # ordered by exit_date. Full recompute: also clears stale values on sales
  # that no longer have any active (non-reversed) exits.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "WITH agg AS (SELECT sales_history_id, string_agg(bill_number::text, ', ' ORDER BY exit_date ASC) AS bills, string_agg(to_char(exit_date, 'DD/MM/YYYY'), ', ' ORDER BY exit_date ASC) AS dates FROM exit_history WHERE is_reversed = 0 GROUP BY sales_history_id) UPDATE sales_history sh SET exit_bill_numbers = agg.bills, exit_dates = agg.dates FROM agg WHERE sh.id = agg.sales_history_id;" \
    || echo "[post-merge] sales_history exit-info backfill (populate) skipped (non-fatal)"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "UPDATE sales_history sh SET exit_bill_numbers = NULL, exit_dates = NULL WHERE (sh.exit_bill_numbers IS NOT NULL OR sh.exit_dates IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM exit_history eh WHERE eh.sales_history_id = sh.id AND eh.is_reversed = 0);" \
    || echo "[post-merge] sales_history exit-info backfill (clear) skipped (non-fatal)"
fi
