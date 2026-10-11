---
name: Browser validation ordering
description: Why development-browser checks are separate from the post-merge setup script.
---

Keep checks that need a running Vite development application as separate mandatory validation steps, not part of post-merge setup.

**Why:** Replit performs workflow reconciliation after the setup script completes. A browser check inside that script could run against a stopped app or stale code. Database/API checks can instead start their own ephemeral HTTP server during setup.

**How to apply:** Start or restart the development application before running browser validation. Do not suppress browser prerequisite failures to make setup appear successful.
