-- Idempotent post-merge backfills, batched into a single psql round-trip.

-- Snapshot lots.marka into sales_history.marka for any historical sale rows
-- created before sales_history.marka existed.
UPDATE sales_history
SET marka = lots.marka
FROM lots
WHERE sales_history.lot_id = lots.id
  AND sales_history.marka IS NULL
  AND lots.marka IS NOT NULL
  AND lots.marka <> '';

-- Denormalise non-reversed exit_history rows into
-- sales_history.exit_bill_numbers / exit_dates as comma-separated strings,
-- ordered by exit_date.
WITH agg AS (
  SELECT sales_history_id,
         string_agg(bill_number::text, ', ' ORDER BY exit_date ASC) AS bills,
         string_agg(to_char(exit_date, 'DD/MM/YYYY'), ', ' ORDER BY exit_date ASC) AS dates
  FROM exit_history
  WHERE is_reversed = 0
  GROUP BY sales_history_id
)
UPDATE sales_history sh
SET exit_bill_numbers = agg.bills,
    exit_dates = agg.dates
FROM agg
WHERE sh.id = agg.sales_history_id;

-- Full recompute: clear stale values on sales that no longer have any active
-- (non-reversed) exits.
UPDATE sales_history sh
SET exit_bill_numbers = NULL,
    exit_dates = NULL
WHERE (sh.exit_bill_numbers IS NOT NULL OR sh.exit_dates IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM exit_history eh
    WHERE eh.sales_history_id = sh.id AND eh.is_reversed = 0
  );
