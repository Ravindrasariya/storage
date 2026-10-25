---
name: Reversal archive scope
description: User-required separate reversal archives and limits on legacy recovery in the Bills History Recycle Bin.
---

Keep future reversed sales and Nikasi records in separate archive tables. Remove the reversed records from the active tables; do not retain them there as the source of Recycle Bin data.

**Why:** The user explicitly required separate tables so reversed entries cannot affect calculations: “not in the same - otherwise calculations will get impacted.”

**How to apply:** Preserve complete snapshots before removal and keep archive reads separate from live accounting, stock totals, and bill allocation.

Track future reversals and show available older Nikasi records; older Nikasi entries may reference sales that were already deleted. Do not promise missing historical sale details or assume approval for backup recovery.

**Why:** The user selected forward tracking and explicitly noted that older Nikasi entries linked to reversed sales have missing sale records.

**How to apply:** Preserve available legacy exit details, leave unavailable fields blank, and keep backup recovery outside this feature.
