# Sauda deployment on Hostinger

Use the existing Hostinger application and database. No database replacement,
`db:push`, historical-sale conversion or user-data cleanup is needed.

1. Back up the production database using the usual VPS procedure.
2. Stop old application workers. The old single-entry application must not run
   against the widened key: its upsert and automatic clearing are incompatible.
3. Using the VPS's existing PostgreSQL connection, apply
   `scripts/sql/sauda-hostinger.sql` with `psql -v ON_ERROR_STOP=1 -f`, then
   `scripts/sql/multiple-saudas-hostinger.sql` the same way. Both are idempotent.
   The first creates the isolated Sauda table if absent. The second assigns
   stable IDs to old entries and widens the primary key without deleting their
   lot, buyer or quantity. It removes only obsolete Sauda-capacity triggers from
   the interrupted conversion implementation, if present.
4. Build the updated app with the existing package installation process and
   `npm run build`, then restart the existing production service. The startup
   migration performs the same widening/obsolete-guard removal idempotently.
5. Confirm multiple Saudas can be created for one lot; each has a delete icon
   and confirmation. Initials are informational, not edit controls.
6. Confirm Master Nikasi works independently and leaves Saudas unchanged.

## Manual lifecycle

The create dialog contains only positive whole-number quantity, an existing
active Buyer Ledger buyer, Cancel and Submit. Each submission creates a separate
entry, even with identical initials or the same buyer. There is no editing:
delete with confirmation and create a new Sauda to correct quantity or buyer.
Cancel/dismiss never deletes; confirmation deletes only the selected entry.
View-only users cannot create or delete.

No combined Sauda/sold-bag limit, stock reservation or Sauda-based Nikasi check
exists. Saudas do not reduce displayed Remaining Bags, change actual sold/exit
quantities, create bills, or update payments, ledgers, FIFO or charge calculations.
Master Nikasi never selects, consumes, reduces or clears them. Fully sold lots
can retain informational Saudas until the operator deletes them.

Existing actual-sale stock safeguards, Sale Edit/payment locks and individual
exits remain unchanged. Reversing an actual sale does not change Saudas.

If the interrupted conversion implementation created an attribution table,
this revision does not read/write it or delete its records. No such table is
created by this rollout. Do not use schema-push cleanup to remove existing data.
Do not downgrade to old workers while multiple entries exist; roll forward, or
restore the backed-up application/schema/data together in a maintenance window.

## Development checks (never run fixtures on the VPS)

Synthetic tests require `scripts/require-development-fixtures.mts`, which verifies
the workspace's local Helium development boundary before allowing fixture writes.

```
npm run check
NODE_ENV=development npm run test:sauda
NODE_ENV=development npm run test:tulai
NODE_ENV=development npm run test:sale-remarks
NODE_ENV=development npm run test:bills-archive
NODE_ENV=development npm run test:sales-csv-choices
```

After restarting the development application:

```
NODE_ENV=development npm run test:sauda-browser
NODE_ENV=development npm run test:tulai-browser
NODE_ENV=development npm run test:sale-remarks-browser
NODE_ENV=development npm run test:bills-archive-browser
```

Historical individual-sale fixtures are inserted only by a guarded test helper,
not through a production API. `/partial-sale` remains retired with HTTP 410.
