# Sale remarks

Sale, Master Nikasi and Edit Sale accept an optional single-line remark of up
to 500 characters. Blank/whitespace becomes NULL; omitting the field on an
update leaves it unchanged. Embedded line breaks and NUL characters are
rejected. Hindi and other Unicode text are supported.

Master Nikasi copies its shared remark into each created sale once. Each sale
then owns its own copy: changing or clearing one does not alter siblings,
even if they share bill numbers. Lot remarks and payment notes are unrelated.
Remarks are not added to receipts or exports by this change.

The existing payment-recorded edit lock also applies to remarks and restoring
an earlier remark. A legacy `payment_status='paid'` flag alone is not proof
of payment; the existing server payment-evidence rules remain authoritative.

## VPS schema requirement

This release requires one new nullable TEXT column, with no default or backfill:

```sql
ALTER TABLE public.sales_history ADD COLUMN IF NOT EXISTS remarks TEXT;
```

The registered additive migration runs during the app's normal startup migration
process. Back up the intended database and review **all** pending migrations
before restarting the production service: startup runs more than just this
one migration if others are pending. This document does not authorize applying
production changes. Do not use `db:push` or the Replit post-merge script on the
VPS for this operation; do not delete backlog/snapshot tables.

## Development checks

After starting/restarting the development app to apply its additive migration:

```sh
NODE_ENV=development npm run test:sale-remarks
NODE_ENV=development npm run test:sale-remarks-browser
```

These checks use synthetic records and the existing verified Helium development
database guard. They refuse remote/production databases. Browser checks require
the running development app and Chromium, and must not run inside post-merge
setup before the app is restarted.
