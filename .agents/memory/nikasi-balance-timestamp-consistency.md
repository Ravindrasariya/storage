---
name: Nikasi Balance timestamp consistency
description: Sale and exit creation use PostgreSQL clock_timestamp() defaults; handle historical skew when reprinting.
---

Point-in-time queries that filter `... WHERE createdAt <= asOf` and expect a
newly-inserted row to satisfy the comparison against itself (asOf = that
row's own createdAt) require BOTH sides of the comparison to come from the
same clock.

Postgres's `now()` (and column `defaultNow()`) is pinned to the
**transaction's start instant**, not the current statement. An app-side
`new Date()` called later in the same transaction (after locks, lookups, or
per-row math) can land AFTER that pinned instant. If one row in a pair uses
`defaultNow()` and the sibling row uses `new Date()`, their `createdAt`
values can disagree even though both were "created together."

**Why:** `createMasterNikasi` created a `sales_history` row with
`createdAt: new Date()` and its paired `exit_history` row with
`defaultNow()`; the sale's timestamp could exceed the exit's, so
`getLotBalances`' `sale.createdAt <= asOf` filter (asOf = the exit's own
createdAt) excluded the very sale just created, making its bags show as
fully un-exited on the receipt printed immediately after.

**How to apply:** `sales_history.created_at` and `exit_history.created_at`
now default to PostgreSQL `clock_timestamp()`, which is evaluated at INSERT
even inside a long transaction. Let the DB assign both timestamps; do not
provide JS-side overrides or revert either default to transaction-start
`NOW()`. The Master Nikasi sale is inserted before its exit, so the exit's
true creation timestamp is no earlier than the sale's. Operator-editable
`sold_at` and `exit_date` are business dates, not these creation timestamps.

Historical receipts must remain correct even after fixing future inserts.
An active exit existing by the cutoff proves its parent sale existed by
that cutoff, regardless of the parent's inconsistent timestamp.

**Why:** Historical paired rows with the exit timestamp earlier than the
sale timestamp remained in the database after the insert fix. Fresh-entry
tests alone missed the reprint failure.

**How to apply:** Include legacy-skew fixtures in balance regression tests;
do not rely only on newly created records or rewrite historical timestamps
to hide the inconsistency.
