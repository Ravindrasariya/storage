-- Back up first; stop old application workers before applying this migration.
-- Widening only: all old lot/buyer/quantity rows survive with stable IDs.
BEGIN;
SELECT pg_advisory_xact_lock(726308458);
ALTER TABLE lot_sauda ADD COLUMN IF NOT EXISTS id varchar;
UPDATE lot_sauda SET id = 'legacy:' || lot_id WHERE id IS NULL;
ALTER TABLE lot_sauda ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE lot_sauda ALTER COLUMN id SET NOT NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='lot_sauda'::regclass AND contype='p'
    AND pg_get_constraintdef(oid) = 'PRIMARY KEY (lot_id)') THEN
    ALTER TABLE lot_sauda DROP CONSTRAINT lot_sauda_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='lot_sauda'::regclass AND contype='p') THEN
    ALTER TABLE lot_sauda ADD PRIMARY KEY (id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS lot_sauda_lot_idx ON lot_sauda(lot_id);
CREATE TABLE IF NOT EXISTS sauda_sale_sources (
  id varchar PRIMARY KEY,
  cold_storage_id varchar NOT NULL REFERENCES cold_storages(id) ON DELETE CASCADE,
  sale_id varchar NOT NULL,
  lot_id varchar NOT NULL,
  sauda_id varchar NOT NULL,
  buyer_ledger_id varchar NOT NULL,
  buyer_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sauda_sale_sources_sale_idx ON sauda_sale_sources(cold_storage_id, sale_id);
CREATE OR REPLACE FUNCTION check_open_sauda_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target varchar; l lots%ROWTYPE; open_bags bigint; sold_bags bigint;
BEGIN
  IF TG_TABLE_NAME = 'lots' THEN
    target := NEW.id;
  ELSE
    IF TG_OP = 'DELETE' THEN target := OLD.lot_id; ELSE target := NEW.lot_id; END IF;
  END IF;
  SELECT * INTO l FROM lots WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(sum(quantity),0) INTO open_bags FROM lot_sauda WHERE lot_id=target;
  IF open_bags = 0 THEN RETURN NULL; END IF;
  SELECT coalesce(sum(quantity_sold),0) INTO sold_bags FROM sales_history
    WHERE lot_id=target AND cold_storage_id=l.cold_storage_id;
  IF open_bags > l.remaining_size OR open_bags + sold_bags > l.size THEN
    RAISE EXCEPTION 'Open Sauda bags plus sold bags exceed lot capacity. Reduce the open Saudas before changing this lot.'
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='lot_sauda_capacity_guard' AND tgrelid='lot_sauda'::regclass) THEN
    CREATE CONSTRAINT TRIGGER lot_sauda_capacity_guard AFTER INSERT OR UPDATE OR DELETE ON lot_sauda
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_open_sauda_capacity();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='lot_capacity_sauda_guard' AND tgrelid='lots'::regclass) THEN
    CREATE CONSTRAINT TRIGGER lot_capacity_sauda_guard AFTER UPDATE OF size, remaining_size ON lots
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_open_sauda_capacity();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sale_capacity_sauda_guard' AND tgrelid='sales_history'::regclass) THEN
    CREATE CONSTRAINT TRIGGER sale_capacity_sauda_guard AFTER INSERT OR UPDATE OF quantity_sold, lot_id ON sales_history
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_open_sauda_capacity();
  END IF;
END $$;
COMMIT;
