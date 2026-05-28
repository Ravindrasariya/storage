/**
 * Task #313 — Read-only diagnostic for the Cold-Charges under-drain.
 *
 * Surfaces buyers whose cold-charges (cold_storage_charge), opening
 * receivables and buyer-to-buyer transfer dues have not drained correctly
 * because the legacy reset/replay matched sales/receivables by exact
 * `LOWER(TRIM(buyer_name))` instead of by `buyer_ledger_id`. For every
 * affected (cold_storage_id, buyer_ledger_id) pair this prints:
 *   - buyer ledger ID + canonical buyer name from `buyer_ledger`
 *   - distinct `buyer_name` text values across that ledger's sales /
 *     receipts / opening receivables (drift evidence)
 *   - Σ outstanding due (cold_storage_charge − paid_amount) matched BY
 *     LEDGER (the truth — what the new FIFO will drain against)
 *   - Σ outstanding due matched BY EXACT NAME against one receipt's
 *     `buyer_name` (the old behaviour — shows how much the legacy code
 *     could "see")
 *   - per-receipt applied / unapplied / amount + `buyer_name` text
 *
 * Usage:
 *   tsx scripts/diagnose-cold-charges-drain-by-ledger-id.mts            # all cold stores
 *   tsx scripts/diagnose-cold-charges-drain-by-ledger-id.mts <csid>     # one cold store
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
  transfer_to_buyer_name: string | null;
  transfer_to_buyer_ledger_id: string | null;
  cold_storage_charge: number | null;
  paid_amount: number | null;
  due_amount: number | null;
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

  // Find every buyer ledger that has either a non-reversed cold-charges
  // receipt or a charge-bearing sale or an opening receivable in this
  // cold storage.
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
            AND COALESCE(cr.due_type, 'cold_charges') = 'cold_charges'
            AND cr.is_reversed = 0
        )
        OR EXISTS (
          SELECT 1 FROM sales_history sh
          WHERE sh.cold_storage_id = ${coldStorageId}
            AND sh.buyer_ledger_id = bl.id
            AND COALESCE(sh.fifo_exclusion, 0) = 0
            AND COALESCE(sh.cold_storage_charge, 0) > 0
        )
        OR EXISTS (
          SELECT 1 FROM opening_receivables orc
          WHERE orc.cold_storage_id = ${coldStorageId}
            AND orc.buyer_ledger_id = bl.id
            AND orc.payer_type = 'cold_merchant'
        )
      )
    ORDER BY bl.buyer_name
  `)).rows as unknown as LedgerRow[];

  if (ledgerRows.length === 0) {
    console.log("(no buyers with cold-charges activity)");
    return;
  }

  for (const ledger of ledgerRows) {
    const sales = (await db.execute(sql`
      SELECT id,
             buyer_name,
             buyer_ledger_id,
             transfer_to_buyer_name,
             transfer_to_buyer_ledger_id,
             COALESCE(cold_storage_charge, 0) AS cold_storage_charge,
             COALESCE(paid_amount, 0) AS paid_amount,
             COALESCE(due_amount, 0) AS due_amount,
             sold_at
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND buyer_ledger_id = ${ledger.id}
        AND COALESCE(fifo_exclusion, 0) = 0
        AND COALESCE(cold_storage_charge, 0) > 0
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
        AND COALESCE(due_type, 'cold_charges') = 'cold_charges'
        AND is_reversed = 0
        AND applies_to_sale_id IS NULL
      ORDER BY received_at ASC
    `)).rows as unknown as ReceiptRow[];

    if (sales.length === 0 && receipts.length === 0) continue;

    const duesByLedger = round2(
      sales.reduce((sum, s) => sum + Number(s.due_amount || 0), 0)
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
    const duesMatchedByLegacyName = round2(
      sales
        .filter(
          (s) => (s.buyer_name || "").trim().toLowerCase() === referenceReceiptName
        )
        .reduce((sum, s) => sum + Number(s.due_amount || 0), 0)
    );

    const drift = round2(duesByLedger - duesMatchedByLegacyName);

    console.log("\n  " + "-".repeat(74));
    console.log(`  Buyer ledger: ${ledger.buyer_name}`);
    console.log(`    ledger_id              = ${ledger.id}`);
    console.log(`    charge-bearing sales   = ${sales.length}`);
    console.log(`    Σ outstanding (LEDGER) = ₹${duesByLedger.toLocaleString("en-IN")}`);
    console.log(`    Σ outstanding (NAME)   = ₹${duesMatchedByLegacyName.toLocaleString("en-IN")}    [legacy match against "${referenceReceiptName}"]`);
    if (drift > 0.5) {
      console.log(`    *** UNDER-DRAIN RISK   = ₹${drift.toLocaleString("en-IN")} hidden from legacy FIFO ***`);
    }
    console.log(`    cold-charge receipts   = ${receipts.length}, total ₹${totalReceipts.toLocaleString("en-IN")}`);
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

/**
 * Task #313 — Ledger-vs-name worklist parity across the three cold-charges
 * inputs: cash_receipts (cold_merchant + cold_charges, non-reversed,
 * applies_to_sale_id IS NULL), opening_receivables (cold_merchant), and
 * discount allocations (parsed from discounts.buyer_allocations JSON).
 *
 * For each input we build two worklists per cold storage:
 *   - LEDGER: the set of buyer_ledger_id values the NEW (ledger-first)
 *     drain will visit.
 *   - NAME:   the set of LOWER(TRIM(buyer_name)) values the OLD (name-only)
 *     drain would visit.
 *
 * Then we report:
 *   - rows present in the NAME worklist but whose name can't be resolved
 *     to any ledger ID in `buyer_ledger` (under-drain risk: legacy code
 *     was reaching them, ledger code won't).
 *   - rows present in the LEDGER worklist whose ledger has a name that
 *     differs from the row's stored buyer_name (drift evidence: the same
 *     ledger has multiple buyer_name values across the input, which is
 *     exactly the rename / merge scenario the task closes).
 *
 * Pure read; safe against production.
 */
async function parityWorklists(coldStorageId: string): Promise<void> {
  console.log("\n  " + "=".repeat(74));
  console.log(`  Worklist parity (ledger vs name) for cold_storage_id=${coldStorageId}`);
  console.log("  " + "=".repeat(74));

  const inputs: Array<{
    label: string;
    query: ReturnType<typeof sql>;
  }> = [
    {
      label: "cash_receipts (cold_merchant + cold_charges, non-reversed, top-level)",
      query: sql`
        SELECT buyer_ledger_id, LOWER(TRIM(buyer_name)) AS name_key, buyer_name
        FROM cash_receipts
        WHERE cold_storage_id = ${coldStorageId}
          AND payer_type = 'cold_merchant'
          AND COALESCE(due_type, 'cold_charges') = 'cold_charges'
          AND is_reversed = 0
          AND applies_to_sale_id IS NULL
      `,
    },
    {
      label: "opening_receivables (cold_merchant)",
      query: sql`
        SELECT buyer_ledger_id, LOWER(TRIM(buyer_name)) AS name_key, buyer_name
        FROM opening_receivables
        WHERE cold_storage_id = ${coldStorageId}
          AND payer_type = 'cold_merchant'
      `,
    },
  ];

  for (const input of inputs) {
    const rows = (await db.execute(input.query)).rows as unknown as Array<{
      buyer_ledger_id: string | null;
      name_key: string | null;
      buyer_name: string | null;
    }>;
    const ledgerWorklist = new Set<string>();
    const nameWorklist = new Set<string>();
    const ledgerToNames = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r.buyer_ledger_id) {
        ledgerWorklist.add(r.buyer_ledger_id);
        if (r.name_key) {
          const set = ledgerToNames.get(r.buyer_ledger_id) ?? new Set<string>();
          set.add(r.name_key);
          ledgerToNames.set(r.buyer_ledger_id, set);
        }
      }
      if (r.name_key) nameWorklist.add(r.name_key);
    }

    // Names with no resolvable ledger (legacy reachable, ledger unreachable).
    const ledgerNameRows = (await db.execute(sql`
      SELECT LOWER(TRIM(buyer_name)) AS name_key
      FROM buyer_ledger
      WHERE cold_storage_id = ${coldStorageId}
    `)).rows as unknown as Array<{ name_key: string }>;
    const knownLedgerNames = new Set(ledgerNameRows.map((r) => r.name_key));
    const orphanNames = [...nameWorklist].filter((n) => n && !knownLedgerNames.has(n));

    // Ledger IDs whose rows carry >1 distinct buyer_name (rename drift).
    const driftLedgers = [...ledgerToNames.entries()].filter(([, s]) => s.size > 1);

    console.log(`\n  - ${input.label}`);
    console.log(`      rows=${rows.length}  ledger-keys=${ledgerWorklist.size}  name-keys=${nameWorklist.size}`);
    if (orphanNames.length > 0) {
      console.log(`      *** ${orphanNames.length} name(s) NOT resolvable to any buyer_ledger:`);
      for (const n of orphanNames.slice(0, 10)) console.log(`          "${n}"`);
      if (orphanNames.length > 10) console.log(`          ... (+${orphanNames.length - 10} more)`);
    }
    if (driftLedgers.length > 0) {
      console.log(`      *** ${driftLedgers.length} ledger(s) carry >1 distinct buyer_name (rename drift):`);
      for (const [blid, names] of driftLedgers.slice(0, 10)) {
        console.log(`          ledger=${blid.slice(0, 8)} names=${JSON.stringify([...names])}`);
      }
      if (driftLedgers.length > 10) console.log(`          ... (+${driftLedgers.length - 10} more)`);
    }
  }

  // Discount allocations — embedded JSON. Walk every non-reversed discount
  // and inspect each allocation: does it carry buyerLedgerId? Does its
  // buyerName resolve to a buyer_ledger row in this cold storage?
  const discounts = (await db.execute(sql`
    SELECT id, buyer_allocations
    FROM discounts
    WHERE cold_storage_id = ${coldStorageId}
      AND COALESCE(is_reversed, 0) = 0
  `)).rows as unknown as Array<{ id: string; buyer_allocations: string }>;

  let allocCount = 0;
  let withLedgerId = 0;
  let withoutLedgerId = 0;
  const unresolvableNames = new Set<string>();
  const knownLedgerNames2 = new Set(
    (
      (await db.execute(sql`
        SELECT LOWER(TRIM(buyer_name)) AS name_key
        FROM buyer_ledger
        WHERE cold_storage_id = ${coldStorageId}
      `)).rows as unknown as Array<{ name_key: string }>
    ).map((r) => r.name_key)
  );

  for (const d of discounts) {
    let parsed: Array<{ buyerName?: string; buyerLedgerId?: string | null }> = [];
    try {
      parsed = JSON.parse(d.buyer_allocations) || [];
    } catch {
      continue;
    }
    for (const a of parsed) {
      allocCount++;
      if (typeof a.buyerLedgerId === "string" && a.buyerLedgerId.length > 0) {
        withLedgerId++;
      } else {
        withoutLedgerId++;
        const nameKey = (a.buyerName || "").trim().toLowerCase();
        if (nameKey && !knownLedgerNames2.has(nameKey)) {
          unresolvableNames.add(nameKey);
        }
      }
    }
  }

  console.log(`\n  - discounts.buyer_allocations (non-reversed)`);
  console.log(`      discounts=${discounts.length}  allocations=${allocCount}  withLedgerId=${withLedgerId}  withoutLedgerId=${withoutLedgerId}`);
  if (unresolvableNames.size > 0) {
    console.log(`      *** ${unresolvableNames.size} name-only allocation buyerName(s) NOT resolvable to any buyer_ledger:`);
    for (const n of [...unresolvableNames].slice(0, 10)) console.log(`          "${n}"`);
    if (unresolvableNames.size > 10) console.log(`          ... (+${unresolvableNames.size - 10} more)`);
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

  console.log(`Scanning ${coldStorageIds.length} cold storage(s) for cold-charges drain drift...`);

  for (const csid of coldStorageIds) {
    await diagnoseColdStorage(csid);
    await parityWorklists(csid);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
