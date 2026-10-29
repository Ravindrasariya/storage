---
name: Print pagination validation
description: Validate real paginated PDFs, not only the print document or small report fixtures.
---

Any report-layout change needs a real A4 PDF check with realistic margins and a farmer group that exceeds the space remaining below the summary.

**Why:** A compact bilingual fixture and successful PDF downloads passed while the user's large register printed only a summary on page one. A continuous browser screenshot cannot reveal that pagination failure.

**How to apply:** Check the first printed page contains actual sale rows, inspect continuation pages and repeated headers, and verify the final sale survives. Include multi-sale rowspans and both languages; inspecting the print popup alone is insufficient.
