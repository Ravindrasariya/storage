---
name: Synthetic fixture safety
description: Safety tradeoff for automatic tests that create authenticated tenants and accounting records.
---

Do not authorize synthetic fixture writes solely from NODE_ENV or a caller-provided opt-in. Keep automatic checks restricted to a verified workspace development database boundary.

**Why:** Post-merge commands explicitly set development mode, but the configured database could still be a production target. Fixture sessions grant real authenticated access and tests exercise real accounting mutations. Supporting arbitrary external development databases is less important than failing closed.

**How to apply:** If the workspace database infrastructure changes, verify the new development endpoint independently before widening the guard. Do not add an environment-variable escape hatch to make a failing remote target pass.

For UI-only selection/search changes, prefer browser-intercepted API fixtures when real persistence and accounting are outside scope.

**Why:** Sorting, identity selection and outgoing payloads can be checked on the actual app without creating accounting records or requiring privileged fixture sessions.

**How to apply:** Intercept every API request, including authentication and writes, inside the test browser. Assert allowed write payloads and reject unexpected mutations. Never add an auth bypass to application code. Tests that need real database persistence must still use the verified development boundary above.
