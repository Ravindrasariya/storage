---
name: tsx dev server route changes
description: Server route edits don't take effect on save in dev — must restart the workflow.
---

The `dev` script is `NODE_ENV=development tsx server/index.ts` (no `--watch`). Saving a file in `server/` triggers Vite's client HMR (because shared types are touched) but does **not** reload the Node process, so any newly added Express route handler stays unregistered until the workflow is restarted.

**Why this matters:** a newly added `app.get(...)` route will fall through to Vite's catch-all on a real request, which returns `200` with `index.html`. Client code that does `await res.json()` then throws "Unexpected token <" / SyntaxError, and any catch-block toast (e.g. "Could not load ...") fires — making it look like the route or client is buggy when the route just isn't loaded yet.

**How to apply:**
- After adding or changing a server route (or any non-HMR-safe server code), restart the `Start application` workflow before testing.
- When debugging a "client got 200 but JSON parse failed" symptom, first confirm the Express request logger printed the response body (` :: {...}`) — if it printed `200 in Nms` with no body, the request didn't reach your handler, and a workflow restart is almost always the fix.
- The production build (`npm run build` → `node dist/index.cjs`) bundles everything fresh, so this only bites in dev.
