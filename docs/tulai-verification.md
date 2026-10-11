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
- `npm run check` still reports unrelated pre-existing type errors. Baseline had 15 diagnostics; the post-change check had 14, with no new Tulai-specific diagnostic identified. Existing duplicate translation, payload typing, compiler-target and historical storage/interface issues remain outside this change.
- Receipt pagination checks use representative four-payment individual receipts, not unlimited histories. Batch/history output is intentionally allowed to span pages.
- Existing buyer reassignment, discount and transfer mechanisms were reviewed for use of the composite sale total; every possible combined lifecycle permutation was not separately driven through a browser.
- Browser checks require Playwright and the Replit Chromium binary. PDFs/screenshots generated for verification are kept in `/tmp`, not committed.
