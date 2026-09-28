---
name: Nikasi Balance timestamp consistency
description: A sale row and its own exit_history row must share one explicit app-side createdAt, not defaultNow()+new Date(), or point-in-time balance queries misfire.
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

**How to apply:** When two rows created in the same transaction must be
comparable by timestamp (especially when one's timestamp is later used as a
cutoff to look the other one up), capture ONE `new Date()` in app code
before either insert and pass it explicitly to both — don't mix
`defaultNow()` with app-side `new Date()` for timestamps that must agree.
