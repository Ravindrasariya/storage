---
name: Non-financial sale promises
description: User-defined distinction between individual-dialog promises and actual Master Nikasi sales.
---

The user wants the individual Sale dialog to record only a promise of a possible sale, using bag quantity and an existing Buyer Ledger buyer. Existing buyers only was explicitly selected; use their current saved initials.

**Why:** The user described this as a discussion that the buyer may eventually buy the lot, not a completed sale.

**How to apply:** Promises have no charges, bills, financial calculations, or Buyer/Farmer Ledger effects. Do not create buyer records as a side effect.

The promise dialog has only bag quantity (maximum current remaining bags), existing buyer selection, Cancel, and Submit.

**Why:** The user explicitly reduced the current dialog to these inputs and actions using screenshots.

**How to apply:** Validate the quantity without reserving or reducing stock. Do not add other fields or extra Clear/Delete actions.

Sale Edit works as is with no impact from the promise change; new actual sales edited there will be Master Nikasi-led sales. Previously created actual individual-dialog sales remain actual sales.

**Why:** The user instructed: “remember Sale edit would work as is. No impact with this change. Now Sale edit will represent the Master niaksi led sale”.

**How to apply:** Keep actual-sale edit fields, calculations, restrictions, and payment locks unchanged. Do not repurpose Sale Edit to edit non-financial promises.

Promises do not reduce Remaining Bags or change Exit/Sold Bags. Stock Register shows only buyer initials for the promise, without cold-store bills or exit/edit/bill-print icons.

**Why:** The user corrected the earlier quantity implication: “lets not even reduce the rmeianing bags, just show initials that's it”.

**How to apply:** Keep promise quantities informational and separate from actual-sale/stock calculations and bill allocation.

Actual finalization through Nikasi allows the same or a different buyer. Master Nikasi can sell more bags than are physically exited.

**Why:** The user clarified that Master Nikasi already preserves sell-now/exit-later flexibility and that a promised buyer can change if the promise fails.

**How to apply:** Do not equate actual sold bags with exited bags, require the promised buyer at finalization, or reinterpret previously completed individual-dialog sales as promises.
