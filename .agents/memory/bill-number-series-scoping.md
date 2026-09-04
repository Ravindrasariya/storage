---
name: Bill number series scoping
description: Why both bill series are keyed to the stock entry year, why the year must be computed in SQL, and what makes duplicates possible if one path drifts.
---

## Rule

Both bill series — the Cold Storage Bill # on sales and the Exit/Nikasi Bill # on
exits — are numbered `MAX + 1` within `(cold storage, STOCK ENTRY year)`. The
entry year is the year the lot came into the cold store, not the year it was
sold or exited.

The entry year is **always computed in Postgres**, never derived in JS from a
date the caller holds. Resolution is `COALESCE(sale.entry_date, lot.created_at)`.

Routes resolve the year from an entity id the client already has (`lotId` /
`saleId` / `exitId`). A `year` / `entryYear` query param is only a legacy
fallback for non-UI callers, and it means the **entry** year.

**Why:** a lot entering in November and leaving in January is ordinary. Under
sale-year scoping its two halves land in different counters, so one physical
season produces two overlapping number ranges. Entry date is immutable in this
app, which is what makes it a safe grouping key; sale and exit dates are
operator-editable and therefore cannot anchor a series.

**Why the year must come from SQL:** the allocator, the duplicate predicate, and
the error message all have to agree on one value. A JS-derived year silently
disagrees with a SQL predicate across timezones and whenever a caller supplies
an explicit entry date. The server process runs in UTC while the DB session is
pinned to Asia/Kolkata, so `extract(year from ...)` and `Date.getFullYear()`
genuinely differ on the boundary days that matter most.

## The failure mode to respect

Neither bill column has a DB unique index. Uniqueness rests entirely on a
`FOR UPDATE` lock on the cold-storages row plus a correctly scoped duplicate
query. Several independent paths allocate or validate a bill #: sale creation
with an operator-typed number, auto-assign, Master Nikasi, exit creation, and
two edit cascades. If **one** of them scopes differently from the others,
duplicates become creatable and nothing surfaces an error.

A cheap pre-flight duplicate check in a route does **not** substitute for the
check inside the write transaction — the pre-flight runs outside the lock, so
concurrent submits sail past it. Both must be entry-year scoped; a regression in
only the transactional one is invisible to any HTTP-level test.

## Master Nikasi has no batch id

A Master Nikasi batch's rows are bound together only by `(bill #, series year)`.
Because numbering restarts per entry year, a bill # is no longer unique within a
sale year — so a cascade scoped by the wrong year rewrites an unrelated season's
batch, silently. This is why mixed-entry-year batches are rejected outright
rather than split automatically: one shared bill # cannot belong to two series.

## How to apply

Any new code that allocates, validates, looks up, or cascades a bill number must
go through the shared entry-year SQL fragments and the ownership-checked
resolvers rather than reading a year off a date. The regression script
`scripts/check-entry-year-bill-scoping.mts` (registered as its own workflow)
covers per-year reset for both series, cross-sale-year collisions within one
entry series, cascade confinement, and the mixed-batch rejection — extend it
when adding a new allocation path.
