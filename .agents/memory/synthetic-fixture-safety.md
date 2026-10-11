---
name: Synthetic fixture safety
description: Safety tradeoff for automatic tests that create authenticated tenants and accounting records.
---

Do not authorize synthetic fixture writes solely from NODE_ENV or a caller-provided opt-in. Keep automatic checks restricted to a verified workspace development database boundary.

**Why:** Post-merge commands explicitly set development mode, but the configured database could still be a production target. Fixture sessions grant real authenticated access and tests exercise real accounting mutations. Supporting arbitrary external development databases is less important than failing closed.

**How to apply:** If the workspace database infrastructure changes, verify the new development endpoint independently before widening the guard. Do not add an environment-variable escape hatch to make a failing remote target pass.
