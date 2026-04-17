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
fi
