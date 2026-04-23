#!/bin/bash
set -e
npm install

# Task #219 — Convert displayed-date columns from bare `timestamp` to
# `timestamptz` BEFORE `npm run db:push` so the auto-generated ALTER does not
# fall back to a default cast (which interprets the historic IST wall-clock
# values as UTC and shifts every visible date by ~5h30m). Each block is
# idempotent: it only runs if the column is still `timestamp without time
# zone`. This is mirrored by the runtime migration
# `2026-04-23_convert_displayed_dates_to_timestamptz` for any environment
# that skips this script.
if [ -n "$DATABASE_URL" ]; then
  for pair in \
    "lots created_at" \
    "sales_history sold_at" \
    "lot_edit_history changed_at" \
    "sale_edit_history changed_at" \
    "cash_receipts created_at" \
    "buyer_ledger created_at" \
    "buyer_ledger_edit_history modified_at" \
    "farmer_ledger_edit_history modified_at"; do
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
