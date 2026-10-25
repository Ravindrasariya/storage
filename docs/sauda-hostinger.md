# Sauda deployment on Hostinger

Deploy this change using the existing Hostinger application and database. No
database replacement, `db:push`, historical-sale conversion, or table cleanup is
needed.

1. Back up the production database using the usual VPS procedure.
2. Stop old application workers (the old one-entry application is not compatible
   with multiple entries). Using the VPS's existing PostgreSQL connection, apply
   `scripts/sql/sauda-hostinger.sql` with `psql -v ON_ERROR_STOP=1 -f`.
   The SQL is additive and safe to rerun. It creates only the separate
   `lot_sauda` table and its tenant index. Then apply
   `scripts/sql/multiple-saudas-hostinger.sql` with the same command.
   This second script preserves existing lot/buyer/quantity rows, assigns stable
   IDs to them, widens the primary key to allow multiple entries, adds a separate
   non-financial source-attribution table and installs deferred capacity guards.
   Both scripts are safe to rerun. No existing stock or financial rows are edited.
3. Build the updated app with the existing package installation process and
   `npm run build`, then restart the existing production service.
   The normal startup migration also creates this table idempotently, so it
   remains safe when the manual SQL was applied first.
4. Confirm the individual action says **Sauda**, saves only an informational
   quantity and an existing buyer, and shows that buyer's saved initials in
   Stock Register. Actual new sales must go through **Master Nikasi**.

Sauda never reduces displayed remaining stock, creates a bill, or updates
payments/ledgers. It limits future unassigned sale availability, separately from
physical stock. The normal action creates a new entry; clicking particular
initials edits that entry, even for matching buyers/initials. Cancel writes nothing.

Master Nikasi explicitly converts selected quantities, preserving all unrelated
entries and each partial remainder's buyer. If unassigned bags are insufficient,
the operator must select enough open Sauda bags to cover the sale. These changes,
immutable source-buyer snapshots, sales, exits and any attached payments commit
or roll back together. Source buyers are separate from the final sale buyer.
Reversing a sale does not restore consumed Saudas; source snapshots survive
reversal and do not participate in stock, billing, archives or accounting totals.
Existing genuine sales, Sale Edit, payment locks and individual exits are unchanged.

Example: total 100, open Saudas 50+25 leaves 25 unassigned. Selling 40 requires
at least 15 explicitly selected Sauda bags. Selecting 20 from the first leaves
30+25 open, 40 sold and 5 unassigned.

Do not downgrade to the old app while multiple entries exist: old workers can
clear all entries and cannot write against the widened primary key. Roll forward
or restore the backed-up schema/data together during a maintenance window.

## Development checks (never run fixture scripts on the VPS)

All synthetic checks must pass `scripts/require-development-fixtures.mts`, which
verifies the workspace's local Helium database before allowing fixture writes.

```
npm run check
NODE_ENV=development npm run test:sauda
NODE_ENV=development npm run test:tulai
NODE_ENV=development npm run test:sale-remarks
NODE_ENV=development npm run test:bills-archive
NODE_ENV=development npm run test:sales-csv-choices
```

After starting/restarting the development application:

```
NODE_ENV=development npm run test:sauda-browser
NODE_ENV=development npm run test:tulai-browser
NODE_ENV=development npm run test:sale-remarks-browser
NODE_ENV=development npm run test:bills-archive-browser
```

Historical individual-sale fixtures are inserted only by a guarded test helper,
not through a production API. The retired `/partial-sale` route returns HTTP
410 with an instruction to use Master Nikasi.
