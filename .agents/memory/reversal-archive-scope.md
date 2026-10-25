---
name: Reversal archive scope
description: User-required separate reversal archives and limits on legacy recovery in the Bills History Recycle Bin.
---

Keep future reversed sales and Nikasi snapshots in separate archive tables for tracking only. Do not change existing tables or variables in ways that impact existing calculations or logic. Preserve existing sale deletion and Nikasi soft-reversal semantics; adding the archive does not authorize extra source-table deletions.

**Why:** The user clarified: “Dont make any changes in existing tables or variables which can impact the existing calcuations, logic” and “Idea is to just keep track of all the reversed sales and nikasi”.

**How to apply:** Use additive snapshot capture and separate archive reads, never feed archives into live accounting, stock totals, or bill allocation. Copy available historical reversed exits without updating, moving or deleting the source rows.

Prefix the archived register tab names with Archive: Archive Nikasi Register and Archive Sales History.

**Why:** The user requested “lets prefix the tab name as Archive”.

**How to apply:** Apply this prefix within the archive navigation, leaving ordinary active register names unchanged.

Keep the Bills History Recycle Bin entry icon-only, with a clear gap between it and the other tabs.

**Why:** The user requested “Just keep the icon - not lable and keep gap between the other tabs and this icon, so that user can see it clearly”.

**How to apply:** Do not show a text label beside the entry icon on desktop or mobile; preserve its accessible name and tooltip. This does not remove the Archive-prefixed names inside the archive view.

Track future reversals and show available older Nikasi records; older Nikasi entries may reference sales that were already deleted. Do not promise missing historical sale details or assume approval for backup recovery.

**Why:** The user selected forward tracking and explicitly noted that older Nikasi entries linked to reversed sales have missing sale records.

**How to apply:** Preserve available legacy exit details, leave unavailable fields blank, and keep backup recovery outside this feature.
