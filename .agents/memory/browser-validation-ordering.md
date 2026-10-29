---
name: Browser validation ordering
description: Browser validation prerequisites and asynchronous download/menu lifecycle boundaries.
---

Keep checks that need a running Vite development application as separate mandatory validation steps, not part of post-merge setup.

**Why:** Replit performs workflow reconciliation after the setup script completes. A browser check inside that script could run against a stopped app or stale code. Database/API checks can instead start their own ephemeral HTTP server during setup.

**How to apply:** Start or restart the development application before running browser validation. Do not suppress browser prerequisite failures to make setup appear successful.

Treat a browser download event and the originating dropdown's readiness as separate lifecycle boundaries.

**Why:** Sequential CSV checks can receive the download event before the previous menu/focus transition settles. Immediately toggling the trigger can close the menu instead of opening it, producing a false download failure despite correct export requests.

**How to apply:** Verify the previous option is hidden before another selection, or explicitly open the menu through its keyboard behavior rather than assuming a trigger click always opens it. Do not add delays or change working export code to compensate for test synchronization.

Validate print layouts against the printable content width and actual paginated PDFs, not only a desktop viewport.

**Why:** CSS page margins and body margins both reduce table width. A DOM overflow check can pass while payment lines still split across PDF pages; Chromium also rounds paper dimensions by fractions of a point.

**How to apply:** Account for both margin layers in print emulation, allow small paper-size rounding tolerance, and inspect rendered PDF pages for complete rows and repeated final-column headers. Keep generated PDFs and page images in ignored artifact storage.
