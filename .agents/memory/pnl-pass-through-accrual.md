---
name: P&L pass-through accrual rule
description: Why the P&L expense side has billing-time accruals for hammali/grading/merchant-extras and suppresses the matching cash expense types.
---

The P&L route accrues four pass-through charges as **expenses at sale-time**, computed live from `sales_history` for the FY: base hammali (with `COALESCE(base_hammali_amount, hammali * quantity_sold)` for legacy rows), extra hammali, grading charges, and `extra_due_to_merchant_original`. They emit as `expenseByType` keys `hammali_billed`, `extra_hammali_billed`, `grading_billed`, `merchant_extras_billed`.

To avoid double-counting the matching cash payouts, the revenue-expense aggregation in the same route filters out `expense_type IN ('hammali', 'grading_charges')`. Those cash entries still appear in Cash Flow and the expenses table itself — only the P&L hides them.

**Why:** the operator collects hammali / extra hammali / grading / merchant-extras from the buyer or farmer at sale-time and pays them onward to labourers / grader / merchant. They're pass-throughs. Before this policy, income was billed-basis but the matching expense was cash-basis (and only if the operator remembered to log it), so Net Profit drifted by the unmatched delta.

**How to apply:**
- Never add `hammali` or `grading_charges` back into the P&L revenue-expense sum.
- If a new pass-through column is added to `sales_history`, decide explicitly whether its matching cash expense type also needs suppressing.
- Kata charges are intentionally NOT in this scheme — they remain income-only.
- The rule is retroactive (live-computed, no backfill), so historical FY profit numbers shift on first reopen.
- Cash Flow, Balance Sheet, ledgers, and sale create/edit/reverse paths are untouched — this lives entirely inside the P&L handler.
