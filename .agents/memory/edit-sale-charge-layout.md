---
name: Edit Sale charge layout
description: Confirmed two-column charge order and read-only extra-Hammali total; grading total stays editable.
---

In Edit Sale, use four two-column rows: Cold Storage Charge | Hammali/bag; Kata | Tulai; Extra Hammali/bag | Total Extra Hammali; Grading/bag | Total Grading.

**Why:** The user confirmed this exact interpretation of their screenshot and requested moving Extra Hammali to its own row, with grading below it.

**How to apply:** Total Extra Hammali is read-only and equals the existing extra-Hammali rate times sold bags. Total Grading remains editable with its existing autofill/override behavior. Keep the base Hammali field distinct and preserve financial calculations and payment locks. This request applies to Edit Sale, not the original Sale creation dialog.
