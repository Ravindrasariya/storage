---
name: Stock Register MR scope
description: Business rules and deliberate scope boundaries for the on-screen buyer initials column.
---

Stock Register MR shows the buyer's current Buyer Ledger initials for each sale, exactly `Self` for self-sales, and genuinely blank cells when initials are blank. Do not invent initials or snapshot them onto sales.

**Why:** The user requested current Buyer Ledger initials, with explicit Self and blank behavior.

**How to apply:** Preserve per-sale identity on lots with multiple sales. Keep this change limited to the on-screen register; print/PDF/CSV additions require a separate request.

MR follows the sale's buyer, not the merchant receiving transferred dues. Keep that behavior when a merchant transfer is active or reversed.

**Why:** The user explicitly confirmed that retaining the sale buyer's initials through merchant transfers is fine.

**How to apply:** Do not substitute transfer-recipient initials into MR unless the user changes this requirement.

Use silver/light gray for Partial in the Stock Register's PS badges, not yellow.

**Why:** The user said, “Keep Partial as Silver given overall its Yello background in the right side.”

**How to apply:** Preserve the silver Partial badge against the existing yellow sale section when restyling PS, including dark mode. This is not a request to recolor global badges or other reports.
