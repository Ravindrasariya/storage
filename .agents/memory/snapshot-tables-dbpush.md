---
name: Heal/snapshot backup tables vs db:push
description: Why date-suffixed backup tables exist, and why db:push must not try to drop them (it hangs non-interactive post-merge/deploy).
---

# Heal/snapshot backup tables vs db:push

One-time "heal" migrations in `server/migrations.ts` create date-suffixed backup
tables (e.g. `cold_charges_heal_snapshot_2026_05_29`,
`extras_drain_heal_snapshot_2026_05_29`) as safety snapshots before mutating data.
These tables are intentional backups and are **not** part of `shared/schema.ts`.

**The trap:** `drizzle-kit push` (`npm run db:push`) sees any table not in the
schema as something to DROP, and prints an interactive "data loss — are you sure?"
prompt. The post-merge script (`scripts/post-merge.sh`) and the VPS deploy run with
stdin closed, so that prompt never gets an answer and the step **hangs until it
times out** → post-merge / deploy fails.

**Resolution (non-destructive):** `drizzle.config.ts` has
`tablesFilter: ["!*_[0-9][0-9][0-9][0-9]_[0-9][0-9]_[0-9][0-9]"]` which excludes any
`*_YYYY_MM_DD` table from drizzle's management, so push leaves the backups alone and
runs non-interactively. We did **not** drop the tables (that would also destroy the
backups on the user's VPS at deploy time).

**Why:** preserving the user's backup data matters more than tidy schema; and the
real failure mode was the interactive prompt, not the tables themselves.

**How to apply:** when writing a new one-time heal/snapshot migration, name its
backup table with a trailing `_YYYY_MM_DD` date so the existing `tablesFilter`
auto-excludes it. If a non-schema table with a *different* naming pattern ever
causes db:push to hang again, extend the `tablesFilter` negation — do not blindly
add `--force` (that would silently apply every drop).
