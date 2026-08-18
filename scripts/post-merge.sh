#!/bin/bash
set -e
npm install

# Tasks #219 + #220 — Convert bare `timestamp` columns to `timestamptz` BEFORE
# the drizzle push, so drizzle's auto-generated ALTER does not fall back to a
# default cast (which would interpret historic IST wall-clock values as UTC and
# shift every value by ~5h30m). Idempotent: only columns still typed
# `timestamp without time zone` are altered.
#
# Mirrored by the runtime migration
# `2026-04-23_convert_all_timestamps_to_timestamptz` for environments that skip
# this script. The single documented exception is `exit_history.exit_date` —
# see schema.ts and replit.md for why.
#
# This is a single psql round-trip; it previously ran ~80 separate psql
# invocations whose per-process connection overhead dominated post-merge
# runtime and eventually blew the setup timeout.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/post-merge-timestamptz.sql \
    || echo "[post-merge] timestamptz conversion skipped (non-fatal)"
fi

npm run db:push

# Guardrail: every sale-touching React Query mutation must call
# invalidateSaleSideEffects(queryClient) so dependent pages (NIKASI / Exit
# Register / Cash Flow / Buyer & Farmer Ledger) refresh automatically. This
# catches forgotten cache invalidations introduced by new features.
node scripts/check-sale-invalidation.mjs

# Regression guard: Self buyer filter must work consistently across the
# sales-history, exits-summary, and CSV-export paths.
tsx scripts/check-self-buyer-filter.mts

# Idempotent backfills (marka snapshot + exit-info denormalisation), batched
# into a single psql round-trip.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/post-merge-backfills.sql \
    || echo "[post-merge] post-merge backfills skipped (non-fatal)"
fi
