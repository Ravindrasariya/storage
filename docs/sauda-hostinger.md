# Sauda deployment on Hostinger

Deploy this change using the existing Hostinger application and database. No
database replacement, `db:push`, historical-sale conversion, or table cleanup is
needed.

1. Back up the production database using the usual VPS procedure.
2. Using the VPS's existing PostgreSQL connection, apply
   `scripts/sql/sauda-hostinger.sql` with `psql -v ON_ERROR_STOP=1 -f`.
   The SQL is additive and safe to rerun. It creates only the separate
   `lot_sauda` table and its tenant index.
3. Build the updated app with the existing package installation process and
   `npm run build`, then restart the existing production service.
   The normal startup migration also creates this table idempotently, so it
   remains safe when the manual SQL was applied first.
4. Confirm the individual action says **Sauda**, saves only an informational
   quantity and an existing buyer, and shows that buyer's saved initials in
   Stock Register. Actual new sales must go through **Master Nikasi**.

Sauda never reduces remaining stock, reserves bags, creates a bill, or updates
payments/ledgers. A replacement overwrites the lot's one active marker; Cancel
writes nothing. Successful Master Nikasi clears only its lots' markers within
the actual-sale transaction. Reversing an actual sale does not restore an old
Sauda marker. Existing genuine sales and Sale Edit remain unchanged.

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
