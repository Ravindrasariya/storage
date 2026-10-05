---
name: Self sale adjustment rule
description: Business restriction on changing an adjusted merchant sale to Self
---

Self sales have no meaning with Self Due and Receivable adjustments. If a particular sale's adjustment is greater than zero, the user cannot change its buyer to Self in the Edit Sale dialog.

**Why:** The user explained that this adjustment option is hidden when recording a Self sale and asked for the same restriction when editing the buyer.

**How to apply:** Preserve the restriction on buyer reassignment without silently clearing adjustments or changing historical financial records. Zero or absent adjustments do not impose this restriction.
