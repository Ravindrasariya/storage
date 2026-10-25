---
name: Stock Register MR scope
description: Business rules and deliberate scope boundaries for the on-screen buyer initials column.
---

Stock Register MR shows the buyer's current Buyer Ledger initials for each sale, exactly `Self` for self-sales, and genuinely blank cells when initials are blank. Do not invent initials or snapshot them onto sales.

**Why:** The user requested current Buyer Ledger initials, with explicit Self and blank behavior.

**How to apply:** Preserve per-sale identity on lots with multiple sales. Keep this change limited to the on-screen register; print/PDF/CSV additions require a separate request.
