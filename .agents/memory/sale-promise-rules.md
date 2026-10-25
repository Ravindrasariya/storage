---
name: Non-financial sale promises
description: Sauda is the non-financial individual-dialog promise; actual new sales come only through Master Nikasi.
---

The user wants the individual Sale dialog to record only a promise of a possible sale, using bag quantity and an existing Buyer Ledger buyer. Existing buyers only was explicitly selected; use their current saved initials.

**Why:** The user described this as a discussion that the buyer may eventually buy the lot, not a completed sale.

**How to apply:** Promises have no charges, bills, financial calculations, or Buyer/Farmer Ledger effects. Do not create buyer records as a side effect.

Call the individual promise action and dialog “Sauda”, not Sale. Actual new sales come only through Master Nikasi.

**Why:** The user requested: “rename it as "Sauda" instead of sale, now sale will come from master niaksi only”.

**How to apply:** Use Sauda/सौदा for this non-financial flow; preserve actual Sale History and Sale Edit terminology and behavior.

Disconnect the old individual-sale backend wiring from Sauda. Submit's only purpose is to show the selected existing buyer's initials on Stock Register, supported only by isolated non-financial Sauda persistence.

**Why:** The user explicitly instructed: “disconnect all backend wiring or tables impacted due to individual sale dialog” and that initials on Stock Register are “the only purpose” of this button.

**How to apply:** Do not route Sauda through actual-sale creation with zero charges or hidden bills. Do not invoke stock/ledger/payment/FIFO/bill mutations or change existing buyer initials. Preserve shared actual-sale functions, existing tables, Master Nikasi, historical sales, and Sale Edit.

The promise dialog has only bag quantity (maximum current remaining bags), existing buyer selection, Cancel, and Submit.

**Why:** The user explicitly reduced the current dialog to these inputs and actions using screenshots.

**How to apply:** Validate positive whole-number quantity without reserving or reducing stock. Keep the dialog inputs/actions minimal; the later user-requested confirmed delete icon belongs at the end of the saved Sauda entry.

Sale Edit works as is with no impact from the promise change; new actual sales edited there will be Master Nikasi-led sales. Previously created actual individual-dialog sales remain actual sales.

**Why:** The user instructed: “remember Sale edit would work as is. No impact with this change. Now Sale edit will represent the Master niaksi led sale”.

**How to apply:** Keep actual-sale edit fields, calculations, restrictions, and payment locks unchanged. Do not repurpose Sale Edit to edit non-financial promises.

Promises do not reduce Remaining Bags or change Exit/Sold Bags. Stock Register shows only buyer initials for the promise, without cold-store bills or exit/edit/bill-print icons.

**Why:** The user corrected the earlier quantity implication: “lets not even reduce the rmeianing bags, just show initials that's it”.

**How to apply:** Keep promise quantities informational and separate from actual-sale/stock calculations and bill allocation.

Actual finalization through Nikasi allows the same or a different buyer. Master Nikasi can sell more bags than are physically exited.

**Why:** The user clarified that Master Nikasi already preserves sell-now/exit-later flexibility and that a promised buyer can change if the promise fails.

**How to apply:** Do not equate actual sold bags with exited bags, require the promised buyer at finalization, or reinterpret previously completed individual-dialog sales as promises.

Allow multiple Saudas per lot. The normal Sauda action creates another entry rather than replacing an earlier one. Saved Saudas cannot be edited, including by clicking initials; to correct one, delete it and create a new entry.

**Why:** The user confirmed “Multiple Saudas per lot—each can be deleted, but not edited” and said the user can delete and create a new one.

**How to apply:** This supersedes both the earlier one-marker-per-lot replacement rule and initials-click editing. Initials are informational; provide confirmed entry-specific deletion instead of edit UI/endpoints. The manual-decision rule below supersedes the initially requested combined quantity limit.

Give each saved Sauda entry a delete icon at the end. Ask “Are you sure you want to delete this Sauda?” and delete only that entry if confirmed. Do not check overall Sauda/sale bags or add Sauda checks at Nikasi time; leave decisions to the operator.

**Why:** The user explicitly stopped the earlier approach: “No Check for overall Sauda or Sale bags, No niasi time check, let user take the decisions.”

**How to apply:** This supersedes aggregate caps, mandatory selection/conversion, automatic consumption and clearing at Master Nikasi. Keep Saudas independent and manually managed; preserve existing actual-sale safeguards and all non-financial isolation rules.
