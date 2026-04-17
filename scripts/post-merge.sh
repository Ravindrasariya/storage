#!/bin/bash
set -e
npm install
npm run db:push

# Idempotent backfill: snapshot lots.marka into sales_history.marka for any
# historical sale rows that were created before sales_history.marka existed.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "UPDATE sales_history SET marka = lots.marka FROM lots WHERE sales_history.lot_id = lots.id AND sales_history.marka IS NULL AND lots.marka IS NOT NULL AND lots.marka <> '';" \
    || echo "[post-merge] sales_history.marka backfill skipped (non-fatal)"

  # Idempotent backfill: denormalise non-reversed exit_history rows into
  # sales_history.exit_bill_numbers / exit_dates as comma-separated strings,
  # ordered by exit_date. Re-runnable: always recomputes from live data.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "UPDATE sales_history sh SET exit_bill_numbers = agg.bills, exit_dates = agg.dates FROM (SELECT sales_history_id, string_agg(bill_number::text, ', ' ORDER BY exit_date ASC) AS bills, string_agg(to_char(exit_date, 'DD/MM/YYYY'), ', ' ORDER BY exit_date ASC) AS dates FROM exit_history WHERE is_reversed = 0 GROUP BY sales_history_id) agg WHERE sh.id = agg.sales_history_id;" \
    || echo "[post-merge] sales_history exit-info backfill skipped (non-fatal)"
fi
