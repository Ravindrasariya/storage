-- Tasks #219 + #220 — Convert every bare `timestamp` column in the schema to
-- `timestamptz` BEFORE `npm run db:push` so drizzle's auto-generated ALTER does
-- not fall back to a default cast (which interprets the historic IST wall-clock
-- values as UTC and shifts every value by ~5h30m).
--
-- Idempotent: each column is only altered while it is still `timestamp without
-- time zone`, so re-runs are no-ops. Mirrored by the runtime migration
-- `2026-04-23_convert_all_timestamps_to_timestamptz` for any environment that
-- skips the post-merge script. The single documented exception is
-- `exit_history.exit_date` — see schema.ts and replit.md for why.
--
-- This runs as ONE psql round-trip. It previously ran as ~80 separate psql
-- invocations, whose per-process connection overhead dominated post-merge
-- runtime and eventually blew the setup timeout.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('migrations', 'applied_at'),
      ('cold_storage_users', 'created_at'),
      ('user_sessions', 'created_at'),
      ('user_sessions', 'last_accessed_at'),
      ('lots', 'sold_at'),
      ('lots', 'created_at'),
      ('sales_history', 'paid_at'),
      ('sales_history', 'entry_date'),
      ('sales_history', 'sold_at'),
      ('sales_history', 'transfer_date'),
      ('sales_history', 'transfer_reversed_at'),
      ('lot_edit_history', 'changed_at'),
      ('sale_edit_history', 'changed_at'),
      ('maintenance_records', 'created_at'),
      ('exit_history', 'reversed_at'),
      ('exit_history', 'created_at'),
      ('cash_receipts', 'received_at'),
      ('cash_receipts', 'reversed_at'),
      ('cash_receipts', 'created_at'),
      ('cash_receipt_applications', 'applied_at'),
      ('cash_receipt_applications', 'created_at'),
      ('expenses', 'paid_at'),
      ('expenses', 'reversed_at'),
      ('expenses', 'created_at'),
      ('cash_transfers', 'transferred_at'),
      ('cash_transfers', 'reversed_at'),
      ('cash_transfers', 'created_at'),
      ('cash_opening_balances', 'created_at'),
      ('cash_opening_balances', 'updated_at'),
      ('opening_receivables', 'effective_date'),
      ('opening_receivables', 'last_accrual_date'),
      ('opening_receivables', 'previous_effective_date'),
      ('opening_receivables', 'created_at'),
      ('opening_payables', 'created_at'),
      ('discounts', 'discount_date'),
      ('discounts', 'reversed_at'),
      ('discounts', 'created_at'),
      ('bank_accounts', 'created_at'),
      ('farmer_advance_freight', 'effective_date'),
      ('farmer_advance_freight', 'last_accrual_date'),
      ('farmer_advance_freight', 'previous_effective_date'),
      ('farmer_advance_freight', 'reversed_at'),
      ('farmer_advance_freight', 'created_at'),
      ('merchant_advance', 'effective_date'),
      ('merchant_advance', 'last_accrual_date'),
      ('merchant_advance', 'original_effective_date'),
      ('merchant_advance', 'previous_effective_date'),
      ('merchant_advance', 'reversed_at'),
      ('merchant_advance', 'created_at'),
      ('merchant_advance_events', 'event_date'),
      ('merchant_advance_events', 'effective_date_before'),
      ('merchant_advance_events', 'effective_date_after'),
      ('merchant_advance_events', 'created_at'),
      ('farmer_loan', 'effective_date'),
      ('farmer_loan', 'last_accrual_date'),
      ('farmer_loan', 'original_effective_date'),
      ('farmer_loan', 'previous_effective_date'),
      ('farmer_loan', 'reversed_at'),
      ('farmer_loan', 'created_at'),
      ('farmer_loan_events', 'event_date'),
      ('farmer_loan_events', 'effective_date_before'),
      ('farmer_loan_events', 'effective_date_after'),
      ('farmer_loan_events', 'created_at'),
      ('farmer_ledger', 'archived_at'),
      ('farmer_ledger', 'created_at'),
      ('farmer_ledger_edit_history', 'modified_at'),
      ('buyer_ledger', 'archived_at'),
      ('buyer_ledger', 'created_at'),
      ('buyer_ledger_edit_history', 'modified_at'),
      ('assets', 'purchase_date'),
      ('assets', 'disposed_at'),
      ('assets', 'created_at'),
      ('asset_depreciation_log', 'calculated_at'),
      ('liabilities', 'start_date'),
      ('liabilities', 'due_date'),
      ('liabilities', 'settled_at'),
      ('liabilities', 'created_at'),
      ('liability_payments', 'paid_at'),
      ('liability_payments', 'created_at')
    ) AS t(tbl, col)
  LOOP
    IF (
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col
    ) = 'timestamp without time zone' THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''Asia/Kolkata''',
        r.tbl, r.col, r.col
      );
      RAISE NOTICE '[post-merge] converted %.% to timestamptz', r.tbl, r.col;
    END IF;
  END LOOP;
END $$;
