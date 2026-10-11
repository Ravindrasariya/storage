# Tulai implementation and verification

## Impact checklist
- Optional nullable Tulai follows Kata in the shared sale model, create/edit/batch payloads, state, calculations, audit history, bill rows and exports.
- Individual Sale uses a Kata/Tulai row; Edit Sale uses Kata/Tulai/Extra Hammali; Master Nikasi has an adjacent column, adjusted total spans, compact widths and mobile scrolling.
- Sale totals include Tulai once. Base-charge recovery subtracts it; the shared total helper still returns the stored composite total without adding extras again.
- Unpaid labour is independent of customer collection: active billed Tulai less active revenue Tulai payouts, floored at zero.
- Revenue Expense offers Tulai with an unpaid bracket including zero. Existing cash/account, receiver, date, remarks and reversal paths apply.
- P&L accrues Tulai at billing and suppresses matching cash/account payouts, preventing a second expense.
- Overall and Kata CSV place Tulai immediately after Kata; a separate Tulai export uses the same metadata and filters. Hindi is exactly तुलाई.
- The latest Tulai edit can be restored through the normal payment-guarded edit path, with total/FIFO/report refresh.

## Actual checks
- Production build passed.
- Focused HTTP/database checks passed for invalid/negative amounts, omitted/null/empty/zero, clearing, self/merchant sales, bag/quintal/actual/total-remaining/already-billed cases, audit history, collection/reversal and edit blocking, cash/account labour payouts/reversals, P&L independence, batch totals/overpayment/round-off, sale reversal and tenant/year isolation.
- Sales CSV checks passed for positive and null Tulai, adjacent headers, row alignment, escaping, authentication, tenant isolation and 17 filter combinations across all three exports.
- Browser checks passed using real components and synthetic authenticated development sessions: desktop/mobile sale and Master Nikasi, previous-Tulai restoration, Revenue Expense creation, the unpaid bracket changing from ₹100 to ₹80, and payout reversal.
- Actual Chromium A4 print and generated/shared PDF checks passed for both individual bill types: one page each. The Cold Storage Bill retained all four representative bottom payment entries.
- The additive migration applied successfully to the existing populated development database. Repeated startup/migration execution reported all migrations already applied.
- Existing sale invalidation, null-CS-bill coexistence, remaining-bags, Self buyer, entry-year bill scoping, payment edit blocking, round-off attribution, manual-payment round-off and Nikasi balance regressions passed.
- Requested code audit found verification/layout gaps, not an accounting/security defect. Positive export, edit restoration and real pagination checks were added/run; the measured mobile clipping and table spacing were corrected.
- Synthetic fixtures were cleaned up; production data was not accessed.

## Existing limitations and coverage boundaries
- `npm run check` now reports only the existing duplicate `allMonths` translation key (`TS1117`, `client/src/lib/i18n.tsx:767`). The Tulai post-change baseline had 14 diagnostics; the type-feedback restoration below removed the in-scope payload, compiler-target and storage/interface errors. Duplicate translation cleanup remains a separate task.
- Receipt pagination checks use representative four-payment individual receipts, not unlimited histories. Batch/history output is intentionally allowed to span pages.
- Existing buyer reassignment, discount and transfer mechanisms were reviewed for use of the composite sale total; every possible combined lifecycle permutation was not separately driven through a browser.
- Browser checks require Playwright and the Replit Chromium binary. PDFs/screenshots generated for verification are kept in `/tmp`, not committed.

## Type-feedback restoration verification
- CashManagement expense payload types include the submitted expense class and farmer/merchant advance fields. LotEntry batch payload types include farmer/company entity type and the already-submitted entry date. StockRegister name-search state is explicitly a string, so search tokens infer correctly.
- TypeScript targets ES2015, the minimum target supporting the existing Set/Map iteration. No route logic, accounting calculations, database schema or translation keys were changed.
- Master Nikasi inserts now use Drizzle's inferred insert types instead of insert-schema assertions that omitted required IDs. Its local sales result includes the existing `exitCreatedAt` field.
- Exit-register storage uses the shared response fields with a database `Date` for `exitDate`; the shared HTTP response retains its serialized string date. Farmer synchronization caches the returned inserted row, including database-default entity type, custom-rate fields and timestamps, rather than constructing an incomplete row.
- `npm run check` exited 2 with exactly one diagnostic: the excluded duplicate translation key noted above.
- `npm run build` passed. Non-fatal warnings remain for the same duplicate translation key, outdated Browserslist data, a PostCSS plugin's missing `from` option and large bundle chunks; these were not changed in this type-fix scope.
- All of these existing regressions exited 0 against synthetic development fixtures:
  - `node scripts/check-sale-invalidation.mjs`
  - `npx tsx scripts/check-tulai.mts`
  - `npx tsx scripts/check-null-cs-bill-coexist.mts`
  - `npx tsx scripts/check-remaining-bags-filter.mts`
  - `npx tsx scripts/check-self-buyer-filter.mts`
  - `npx tsx scripts/check-entry-year-bill-scoping.mts`
  - `npx tsx scripts/check-sale-edit-payment-block.mts`
  - `npx tsx scripts/check-roundoff-attribution.mts`
  - `npx tsx scripts/check-manual-payment-roundoff.mts`
  - `npx tsx scripts/check-nikasi-balance-post-exit.mts`
  - `npx tsx scripts/check-cash-flow-cs-bills.mts`
  - `npx tsx scripts/check-self-buyer-adjustment-block.mts`
  - `node scripts/check-base-cold-charges-cas.mjs`
- Expected rejection logs for overpayment and mixed-entry-year Master Nikasi requests were part of passing negative tests, not unexpected failures.
- The application workflow restarted successfully and served on port 5000 with all migrations already applied. A preview screenshot confirmed the login page renders; signed-in UI was not visually reverified for this type-only change.
