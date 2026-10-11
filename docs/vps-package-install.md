# Package installation on the Hostinger VPS

The lockfile pins package versions and integrity hashes. Keep it: removing it can
change dependencies. Replit-internal tarball hosts are not accessible from the VPS.
The corrected Playwright URLs point to public npm without changing their versions
or hashes.

## Normal installation after uploading the corrected code

Run from the application directory on the VPS:

```bash
cd /var/www/krashuved/csm-app

# Save the current manifests before replacing/uploading them.
backup_dir="$(mktemp -d /tmp/csm-package-backup.XXXXXX)"
cp package.json package-lock.json "$backup_dir/"
printf 'Package manifest backup: %s\n' "$backup_dir"

# Upload/pull the corrected project files before continuing.
# This standalone check needs only Node, not installed dependencies.
node scripts/check-package-urls.mjs

# Install the locked versions, including development tools needed for the build.
npm ci --include=dev --registry=https://registry.npmjs.org/

# Confirm installation did not reintroduce internal URLs.
npm run check:package-urls
npm run build
```

`npm ci` replaces `node_modules` with the locked dependencies. Schedule this during
your usual deployment window. These package installation/build commands do not
run `db:push` or database migrations.

The build automatically checks URL portability and runs the guard's tests.
Restart your existing application service only after installation and build
succeed. Use your configured service manager; do not start a second server.

**Database caution:** application startup runs all pending registered migrations,
not just the Tulai migration. Back up production data and review pending migrations
before a restart. This procedure does not authorize production schema changes.

**Do not run `scripts/post-merge.sh` on the VPS.** It is Replit setup machinery and
currently includes schema push and data backfills. The new package guards do not
make that script a safe VPS deployment command.

## Immediate repair of an older affected upload

If you cannot upload the corrected lockfile yet, these exact two known packages
were verified to exist on public npm with matching integrity hashes:
`playwright@1.64.0` and `playwright-core@1.64.0`.

```bash
cd /var/www/krashuved/csm-app
backup_dir="$(mktemp -d /tmp/csm-package-backup.XXXXXX)"
cp package.json package-lock.json "$backup_dir/"

sed -i 's#http://package-firewall.replit.internal/npm/#https://registry.npmjs.org/#g' package-lock.json
npm ci --include=dev --registry=https://registry.npmjs.org/
npm run build
```

Only use this replacement for the known matching packages. For newly introduced
internal URLs, first verify the locked version and integrity hash against public
npm metadata. A public registry flag alone does not replace explicit internal
URLs in the lockfile. Upgrading npm, changing DNS, or clearing the cache is not
necessary for this issue.

## Tulai column is a separate operation

Package installation does not add database columns. If you want to add only the
Tulai column, after backing up the correct production database, use the previously
reviewed additive SQL:

```sql
ALTER TABLE public.sales_history
ADD COLUMN IF NOT EXISTS tulai_charges REAL;
```

This statement does not drop any table or rewrite historical charge values.
Do not run schema push or delete backlog/snapshot tables to install packages.
