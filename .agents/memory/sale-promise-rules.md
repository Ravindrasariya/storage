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

Allow multiple Saudas per lot. The normal Sauda action creates another entry rather than replacing an earlier one; clicking a particular Sauda's initials opens that entry for changes, including switching buyer. The overall Sauda bags plus already-sold bags must not exceed total bags for that lot.

**Why:** The user changed the lifecycle: after a Sauda for 50 of 100 bags, the next Sauda could be for another 25 bags, and requested editing by clicking the initials.

**How to apply:** Treat this as superseding the earlier one-marker-per-lot replacement rule. Enforce the combined limit on creation and editing without reducing displayed Remaining Bags or making financial entries. Keep actual-sale controls separate from clickable Sauda initials.

Master Nikasi must let the operator explicitly pick the open Sauda portion being converted to an actual sale. Only selected quantities are consumed; unrelated Saudas remain. A sale cannot proceed without selecting sufficient Sauda quantities when unassigned bags alone are insufficient.

**Why:** The user warned that automatic clearing or partial clearing could cause confusion about which buyer the bags were assigned to, and requested explicit selection at Master Nikasi.

**How to apply:** Show each open Sauda's buyer and available quantity when selecting portions. Preserve the buyer association of unconsumed portions; fully consumed entries leave the open list only when the actual sale commits. Keep selection separate from physical exit quantities.
