---
name: Stock Register MR scope
description: Business rules and deliberate scope boundaries for the on-screen buyer initials column.
---

Stock Register MR shows the buyer's current Buyer Ledger initials for each sale, exactly `Self` for self-sales, and genuinely blank cells when initials are blank. Do not invent initials or snapshot them onto sales.

**Why:** The user requested current Buyer Ledger initials, with explicit Self and blank behavior.

**How to apply:** Preserve per-sale identity on lots with multiple sales. The user subsequently extended MR and PS to the Stock Register PDF/print report; CSV and other reports still require a separate request.

MR follows the sale's buyer, not the merchant receiving transferred dues. Keep that behavior when a merchant transfer is active or reversed.

**Why:** The user explicitly confirmed that retaining the sale buyer's initials through merchant transfers is fine.

**How to apply:** Do not substitute transfer-recipient initials into MR unless the user changes this requirement.

Use silver/light gray for Partial in the Stock Register's PS badges, not yellow.

**Why:** The user said, “Keep Partial as Silver given overall its Yello background in the right side.”

**How to apply:** Preserve the silver Partial badge against the existing yellow sale section when restyling PS, including dark mode. This is not a request to recolor global badges or other reports.

Keep English PS badges their original compact size; let Hindi badges expand only as their translated wording requires. Center the PS heading directly above the badges.

**Why:** The user corrected enlarged badges: “Please dont increase badge size by a lot. Keep it same size for English. For Hindi let appripriate badge expand in size.”

**How to apply:** Do not use a uniform minimum badge width to hide spacing problems.

Prioritize room for Exited/Sold, Exit Dates, and Exit Bill numbers, while keeping Cold Bill No and MR compact toward PS.

**Why:** The user's latest correction superseded equal-width columns: “Shift cold Bill no and MR towards PS. Give more space to 1st 3. Given multiple date and exit bill nubers could be there”.

**How to apply:** Preserve content-aware sizing rather than equal-width yellow tracks when adjusting Stock Register spacing.
