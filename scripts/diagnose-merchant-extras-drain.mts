/**
 * Task #312 — Read-only diagnostic for the Merchant Extras under-drain.
 *
 * Surfaces buyers whose merchant_extras receipts have applied less than they
 * should because the legacy reset/replay matched sales by exact
 * `LOWER(TRIM(buyer_name))` instead of by `buyer_ledger_id`. For every
 * affected (cold_storage_id, buyer_ledger_id) pair this prints:
 *   - buyer ledger ID + canonical buyer name from `buyer_ledger`
 *   - distinct `buyer_name` text values across that ledger's extras-bearing
 *     sales (drift evidence)
 *   - Σ extra_due_to_merchant matched BY LEDGER (the truth — what the new
 *     `recomputeBuyerExtras` will drain against)
 *   - Σ extra_due_to_merchant matched BY EXACT NAME against any one
 *     receipt's `buyer_name` (the old behaviour — shows how much the legacy
 *     code could "see")
 *   - per-receipt applied / unapplied / amount + `buyer_name` text
 *
 * Usage:
 *   tsx scripts/diagnose-merchant-extras-drain.mts            # all cold stores
 *   tsx scripts/diagnose-merchant-extras-drain.mts <csid>     # one cold store
 *
 * Does NOT write to the database. Safe to run against production.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

type ReceiptRow = {
  id: string;
  transaction_id: string | null;
  cold_storage_id: string;
  buyer_ledger_id: string | null;
  buyer_name: string | null;
  amount: number;
  applied_amount: number | null;
  unapplied_amount: number | null;
  received_at: Date;
};

type SaleRow = {
  id: string;
  buyer_name: string | null;
  buyer_ledger_id: string | null;
  extra_due_to_merchant: number | null;
  extra_due_to_merchant_original: number | null;
  sold_at: Date;
};

type LedgerRow = { id: string; buyer_name: string };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function diagnoseColdStorage(coldStorageId: string): Promise<void> {
  console.log("\n" + "=".repeat(78));
  console.log(`Cold storage: ${coldStorageId}`);
  console.log("=".repeat(78));

  // Find every buyer ledger that has either a non-reversed merchant_extras
  // receipt or an extras-bearing sale in this cold storage.
  const ledgerRows = (await db.execute(sql`
    SELECT DISTINCT bl.id, bl.buyer_name
    FROM buyer_ledger bl
    WHERE bl.cold_storage_id = ${coldStorageId}
      AND (
        EXISTS (
          SELECT 1 FROM cash_receipts cr
          WHERE cr.cold_storage_id = ${coldStorageId}
            AND cr.buyer_ledger_id = bl.id
            AND cr.payer_type = 'cold_merchant'
            AND cr.due_type = 'merchant_extras'
            AND cr.is_reversed = 0
        )
        OR EXISTS (
          SELECT 1 FROM sales_history sh
          WHERE sh.cold_storage_id = ${coldStorageId}
            AND sh.buyer_ledger_id = bl.id
            AND (
              COALESCE(sh.extra_due_to_merchant, 0) > 0
              OR COALESCE(sh.extra_due_to_merchant_original, 0) > 0
            )
        )
      )
    ORDER BY bl.buyer_name
  `)).rows as unknown as LedgerRow[];

  if (ledgerRows.length === 0) {
    console.log("(no buyers with merchant_extras activity)");
    return;
  }

  for (const ledger of ledgerRows) {
    const sales = (await db.execute(sql`
      SELECT id,
             buyer_name,
             buyer_ledger_id,
             COALESCE(extra_due_to_merchant, 0) AS extra_due_to_merchant,
             COALESCE(extra_due_to_merchant_original, 0) AS extra_due_to_merchant_original,
             sold_at
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND buyer_ledger_id = ${ledger.id}
        AND (
          COALESCE(extra_due_to_merchant, 0) > 0
          OR COALESCE(extra_due_to_merchant_original, 0) > 0
        )
        AND COALESCE(fifo_exclusion, 0) = 0
      ORDER BY sold_at ASC, id ASC
    `)).rows as unknown as SaleRow[];

    const receipts = (await db.execute(sql`
      SELECT id,
             transaction_id,
             cold_storage_id,
             buyer_ledger_id,
             buyer_name,
             COALESCE(amount, 0) AS amount,
             COALESCE(applied_amount, 0) AS applied_amount,
             COALESCE(unapplied_amount, 0) AS unapplied_amount,
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

    if (sales.length === 0 && receipts.length === 0) continue;

    const extrasByLedger = round2(
      sales.reduce((sum, s) => sum + Number(s.extra_due_to_merchant_original || 0), 0)
    );
    const totalReceipts = round2(
      receipts.reduce((sum, r) => sum + Number(r.amount || 0), 0)
    );
    const totalApplied = round2(
      receipts.reduce((sum, r) => sum + Number(r.applied_amount || 0), 0)
    );
    const totalUnapplied = round2(
      receipts.reduce((sum, r) => sum + Number(r.unapplied_amount || 0), 0)
    );

    // Distinct buyer_name text values across sales (drift evidence).
    const distinctSaleNames = Array.from(
      new Set(sales.map((s) => (s.buyer_name || "").trim().toLowerCase()))
    );
    const receiptNames = Array.from(
      new Set(receipts.map((r) => (r.buyer_name || "").trim().toLowerCase()))
    );

    // What the LEGACY name-equality query would have matched against
    // the FIRST receipt's buyer_name text. If this differs from the
    // ledger-keyed total, the under-drain symptom is reproducible.
    const referenceReceiptName = receiptNames[0] || "";
    const extrasMatchedByLegacyName = round2(
      sales
        .filter(
          (s) => (s.buyer_name || "").trim().toLowerCase() === referenceReceiptName
        )
        .reduce((sum, s) => sum + Number(s.extra_due_to_merchant_original || 0), 0)
    );

    const drift = round2(extrasByLedger - extrasMatchedByLegacyName);

    console.log("\n  " + "-".repeat(74));
    console.log(`  Buyer ledger: ${ledger.buyer_name}`);
    console.log(`    ledger_id              = ${ledger.id}`);
    console.log(`    extras-bearing sales   = ${sales.length}`);
    console.log(`    Σ extras (BY LEDGER)   = ₹${extrasByLedger.toLocaleString("en-IN")}`);
    console.log(`    Σ extras (BY OLD NAME) = ₹${extrasMatchedByLegacyName.toLocaleString("en-IN")}    [legacy match against "${referenceReceiptName}"]`);
    if (drift > 0.5) {
      console.log(`    *** UNDER-DRAIN RISK   = ₹${drift.toLocaleString("en-IN")} hidden from legacy FIFO ***`);
    }
    console.log(`    extras receipts        = ${receipts.length}, total ₹${totalReceipts.toLocaleString("en-IN")}`);
    console.log(`    Σ applied              = ₹${totalApplied.toLocaleString("en-IN")}`);
    console.log(`    Σ unapplied            = ₹${totalUnapplied.toLocaleString("en-IN")}`);
    if (distinctSaleNames.length > 1) {
      console.log(`    distinct sale buyer_name values (drift): ${JSON.stringify(distinctSaleNames)}`);
    }
    if (receiptNames.length > 1) {
      console.log(`    distinct receipt buyer_name values:      ${JSON.stringify(receiptNames)}`);
    }
    for (const r of receipts) {
      const txn = r.transaction_id || r.id.slice(0, 8);
      console.log(
        `      - receipt ${txn}: amount=₹${Number(r.amount).toLocaleString("en-IN")}  applied=₹${Number(r.applied_amount || 0).toLocaleString("en-IN")}  unapplied=₹${Number(r.unapplied_amount || 0).toLocaleString("en-IN")}  buyer_name="${r.buyer_name || ""}"`
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

  console.log(`Scanning ${coldStorageIds.length} cold storage(s) for merchant_extras drain drift...`);

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
