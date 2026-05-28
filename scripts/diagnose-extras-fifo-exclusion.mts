/**
 * Task #317 — Read-only diagnostic for the extras drain vs. fifo_exclusion bug.
 *
 * The Buyer Ledger summary card sums `extra_due_to_merchant` on every sale
 * for a buyer (no `fifo_exclusion` filter), but the previous
 * `recomputeBuyerExtras` excluded sales with `fifo_exclusion = 1` from both
 * reset and drain. Buyers with at least one such sale show summary_total >
 * drain_visible_total — that gap is exactly what gets parked as `unappliedAmount`
 * on Merchant Extras receipts.
 *
 * For every (cold_storage_id, buyer_ledger_id) this prints:
 *   - summary_total       = Σ extra_due_to_merchant for ALL sales (what the
 *                           Buyer Ledger card shows)
 *   - drain_visible_total = Σ extra_due_to_merchant for sales with
 *                           fifo_exclusion = 0 (what the OLD drain could see)
 *   - hidden_by_flag      = summary_total − drain_visible_total
 *   - per-receipt applied / unapplied
 *
 * Run BEFORE and AFTER the heal migration on the VPS. Post-heal,
 * `hidden_by_flag` should still be > 0 (the flag is harmless data), but every
 * receipt should show unapplied = 0 and every affected sale should show
 * extra_due_to_merchant = 0.
 *
 * Usage:
 *   tsx scripts/diagnose-extras-fifo-exclusion.mts            # all cold stores
 *   tsx scripts/diagnose-extras-fifo-exclusion.mts <csid>     # one cold store
 *
 * Does NOT write to the database. Safe to run against production.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

type LedgerRow = {
  id: string;
  buyer_name: string;
  summary_total: number;
  drain_visible_total: number;
  excluded_sale_count: number;
};

type ReceiptRow = {
  id: string;
  transaction_id: string | null;
  amount: number;
  applied_amount: number;
  unapplied_amount: number;
  received_at: Date;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function diagnoseColdStorage(coldStorageId: string): Promise<void> {
  console.log("\n" + "=".repeat(78));
  console.log(`Cold storage: ${coldStorageId}`);
  console.log("=".repeat(78));

  const ledgerRows = (await db.execute(sql`
    SELECT bl.id,
           bl.buyer_name,
           COALESCE(SUM(COALESCE(sh.extra_due_to_merchant, 0)), 0)::float8 AS summary_total,
           COALESCE(SUM(
             CASE WHEN COALESCE(sh.fifo_exclusion, 0) = 0
                  THEN COALESCE(sh.extra_due_to_merchant, 0)
                  ELSE 0 END
           ), 0)::float8 AS drain_visible_total,
           COALESCE(SUM(
             CASE WHEN COALESCE(sh.fifo_exclusion, 0) = 1
                       AND COALESCE(sh.extra_due_to_merchant, 0) > 0
                  THEN 1 ELSE 0 END
           ), 0)::int AS excluded_sale_count
    FROM buyer_ledger bl
    LEFT JOIN sales_history sh
      ON sh.cold_storage_id = bl.cold_storage_id
     AND sh.buyer_ledger_id = bl.id
    WHERE bl.cold_storage_id = ${coldStorageId}
    GROUP BY bl.id, bl.buyer_name
    HAVING COALESCE(SUM(COALESCE(sh.extra_due_to_merchant, 0)), 0) > 0.5
        OR EXISTS (
          SELECT 1 FROM cash_receipts cr
          WHERE cr.cold_storage_id = ${coldStorageId}
            AND cr.buyer_ledger_id = bl.id
            AND cr.payer_type = 'cold_merchant'
            AND cr.due_type = 'merchant_extras'
            AND cr.is_reversed = 0
            AND COALESCE(cr.unapplied_amount, 0) > 0.5
        )
    ORDER BY bl.buyer_name
  `)).rows as unknown as LedgerRow[];

  if (ledgerRows.length === 0) {
    console.log("(no buyers with extras activity or unapplied extras receipts)");
    return;
  }

  for (const ledger of ledgerRows) {
    const summaryTotal = round2(Number(ledger.summary_total));
    const drainVisibleTotal = round2(Number(ledger.drain_visible_total));
    const hiddenByFlag = round2(summaryTotal - drainVisibleTotal);

    const receipts = (await db.execute(sql`
      SELECT id,
             transaction_id,
             COALESCE(amount, 0)::float8 AS amount,
             COALESCE(applied_amount, 0)::float8 AS applied_amount,
             COALESCE(unapplied_amount, 0)::float8 AS unapplied_amount,
             received_at
      FROM cash_receipts
      WHERE cold_storage_id = ${coldStorageId}
        AND buyer_ledger_id = ${ledger.id}
        AND payer_type = 'cold_merchant'
        AND due_type = 'merchant_extras'
        AND is_reversed = 0
        AND applies_to_sale_id IS NULL
      ORDER BY received_at ASC
    `)).rows as unknown as ReceiptRow[];

    const totalUnapplied = round2(
      receipts.reduce((sum, r) => sum + Number(r.unapplied_amount || 0), 0)
    );

    console.log("\n  " + "-".repeat(74));
    console.log(`  Buyer: ${ledger.buyer_name}`);
    console.log(`    ledger_id              = ${ledger.id}`);
    console.log(`    summary_total          = ₹${summaryTotal.toLocaleString("en-IN")}  (Buyer Ledger card sees this)`);
    console.log(`    drain_visible_total    = ₹${drainVisibleTotal.toLocaleString("en-IN")}  (OLD drain only saw this)`);
    if (hiddenByFlag > 0.5) {
      console.log(`    *** hidden_by_flag     = ₹${hiddenByFlag.toLocaleString("en-IN")}  on ${ledger.excluded_sale_count} sale(s) with fifo_exclusion=1 ***`);
    }
    console.log(`    extras receipts        = ${receipts.length}, Σ unapplied = ₹${totalUnapplied.toLocaleString("en-IN")}`);
    for (const r of receipts) {
      const txn = r.transaction_id || r.id.slice(0, 8);
      const flag = Number(r.unapplied_amount) > 0.5 ? "  <-- STUCK" : "";
      console.log(
        `      - receipt ${txn}: amount=₹${Number(r.amount).toLocaleString("en-IN")}  applied=₹${Number(r.applied_amount).toLocaleString("en-IN")}  unapplied=₹${Number(r.unapplied_amount).toLocaleString("en-IN")}${flag}`
      );
    }
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  let coldStorageIds: string[];

  if (arg) {
    coldStorageIds = [arg];
  } else {
    const rows = (await db.execute(sql`
      SELECT id FROM cold_storages ORDER BY id
    `)).rows as unknown as Array<{ id: string }>;
    coldStorageIds = rows.map((r) => r.id);
  }

  console.log(`Scanning ${coldStorageIds.length} cold storage(s) for extras drain vs. fifo_exclusion drift...`);

  for (const csid of coldStorageIds) {
    await diagnoseColdStorage(csid);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
