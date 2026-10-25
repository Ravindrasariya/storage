// Keep scripts/sql/multiple-saudas-hostinger.sql equivalent to this migration.
// Widen the old one-entry key without deleting or replacing any saved Sauda.
export const saudaMultiSql = `
ALTER TABLE lot_sauda ADD COLUMN IF NOT EXISTS id varchar;
UPDATE lot_sauda SET id = 'legacy:' || lot_id WHERE id IS NULL;
ALTER TABLE lot_sauda ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE lot_sauda ALTER COLUMN id SET NOT NULL;
DO $$
DECLARE old_key text;
BEGIN
  SELECT conname INTO old_key FROM pg_constraint
    WHERE conrelid='lot_sauda'::regclass AND contype='p'
    AND pg_get_constraintdef(oid) = 'PRIMARY KEY (lot_id)';
  IF old_key IS NOT NULL THEN
    EXECUTE format('ALTER TABLE lot_sauda DROP CONSTRAINT %I', old_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='lot_sauda'::regclass AND contype='p') THEN
    ALTER TABLE lot_sauda ADD PRIMARY KEY (id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS lot_sauda_lot_idx ON lot_sauda(lot_id);

-- Remove only the obsolete guards from the interrupted conversion approach.
-- No business data or genuine actual-sale stock constraints are removed.
DROP TRIGGER IF EXISTS lot_sauda_capacity_guard ON lot_sauda;
DROP TRIGGER IF EXISTS lot_capacity_sauda_guard ON lots;
DROP TRIGGER IF EXISTS sale_capacity_sauda_guard ON sales_history;
DROP FUNCTION IF EXISTS check_open_sauda_capacity();
`;
