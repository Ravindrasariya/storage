#!/usr/bin/env tsx
/**
 * Regression guard: per-sale round-off attribution (Task #378).
 *
 * Sales History and the Nikasi/Exit Register both pull round-off back out
 * of "Cash Paid"/"Account Paid" and surface it in a separate Discount card.
 * Both computations share the same math: cash_receipts.amount is already
 * the GROSS amount (inclusive of round_off — see the schema comment on
 * cashReceipts.roundOff), and cash_receipt_applications.amount_applied rows
 * sum to that same gross across the sales a receipt was applied to. So each
 * sale's round-off slice is:
 *
 *   amountApplied * (roundOff / amount)
 *
 * NOT amountApplied * (roundOff / (amount + roundOff)) — that denominator
 * double-counts the round-off and understates every sale's slice (a ₹100
 * gross receipt with ₹10 round-off, applied in full to one sale, must
 * attribute the full ₹10 to that sale — not ₹9.09).
 *
 * This script exercises both storage.getSalesHistory() and
 * storage.getExitRegister() against real DB fixtures with:
 *   1. A receipt applied in full to a single sale.
 *   2. A receipt split across two sales (proportional attribution).
 *
 * Run manually:
 *   DATABASE_URL=postgres://... tsx scripts/check-roundoff-attribution.mts
 *
 * Exit code: 0 on success, 1 on any failure.
 *
 * Cleanup: fixtures are prefixed with __roundoff_smoke_<timestamp>_<pid> on
 * the cold_storage_id and wiped at start AND in the finally block. If the
 * script crashes mid-run, leftovers can be removed with:
 *   DELETE FROM cold_storages WHERE id LIKE '__roundoff_smoke_%';
 */

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PREFIX = "__roundoff_smoke_";
const RUN_ID = `${PREFIX}${Date.now()}_${process.pid}`;
const COLD_STORAGE_ID = RUN_ID;
const CHAMBER_ID = `${RUN_ID}_ch`;
const FARMER_LEDGER_ID = `${RUN_ID}_fl`;

const TEST_YEAR = 2016;
const TEST_DATE = `${TEST_YEAR}-06-15`;
const TEST_ENTRY_INSTANT = new Date(`${TEST_YEAR}-03-01T12:00:00+05:30`);

async function wipeByPrefix(): Promise<void> {
  await pool.query(
    `DELETE FROM sale_edit_history WHERE sale_id IN (SELECT id FROM sales_history WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );
  for (const t of [
    "cash_receipt_applications",
    "cash_receipts",
    "exit_history",
    "sales_history",
    "lots",
    "chambers",
    "farmer_ledger",
  ]) {
    await pool.query(`DELETE FROM ${t} WHERE cold_storage_id LIKE $1`, [`${PREFIX}%`]);
  }
  await pool.query(`DELETE FROM cold_storages WHERE id LIKE $1`, [`${PREFIX}%`]);
}

async function setupBaseFixtures(): Promise<void> {
  await pool.query(
    `INSERT INTO cold_storages (
       id, name, total_capacity, wafer_rate, seed_rate,
       wafer_cold_charge, wafer_hammali, seed_cold_charge, seed_hammali,
       charge_unit, linked_phones,
       next_exit_bill_number, next_cold_storage_bill_number, next_sales_bill_number,
       next_entry_bill_number, next_wafer_lot_number, next_ration_seed_lot_number,
       starting_wafer_lot_number, starting_ration_seed_lot_number, status
     ) VALUES (
       $1, 'Round-off Smoke CS', 10000, 100, 100,
       50, 10, 50, 10, 'bag', '{}',
       1, 1, 1, 1, 1, 1, 1, 1, 'active'
     )`,
    [COLD_STORAGE_ID],
  );
  await pool.query(
    `INSERT INTO chambers (id, cold_storage_id, name, capacity, current_fill)
     VALUES ($1, $2, 'C1', 10000, 0)`,
    [CHAMBER_ID, COLD_STORAGE_ID],
  );
  await pool.query(
    `INSERT INTO farmer_ledger (
       id, cold_storage_id, farmer_id, name, contact_number, village,
       tehsil, district, state, entity_type, is_flagged, is_archived
     ) VALUES ($1, $2, $3, 'Smoke Farmer', '0000000000', 'X', 'X', 'X', 'X', 'farmer', 0, 0)`,
    [FARMER_LEDGER_ID, COLD_STORAGE_ID, `FMROUND${Date.now()}`],
  );
}

async function makeSale(tag: string, opts: {
  paidAmount?: number;
  paidCash?: number;
  billNumber?: number | null;
}): Promise<string> {
  const lotId = `${RUN_ID}_lot_${tag}`;
  const saleId = `${RUN_ID}_sale_${tag}`;
  await pool.query(
    `INSERT INTO lots (
       id, cold_storage_id, farmer_name, village, tehsil, district, state,
       contact_number, lot_no, size, remaining_size, chamber_id, floor,
       position, type, bag_type, quality, potato_size, assaying_type,
       up_for_sale, sale_status, base_cold_charges_billed, farmer_ledger_id, created_at
     ) VALUES (
       $1, $2, 'Smoke Farmer', 'X', 'X', 'X', 'X',
       '0000000000', $3, 100, 90, $4, 0,
       'P1', 'seed', 'seed', 'good', 'large', 'self',
       0, 'partial', 1, $5, $6
     )`,
    [lotId, COLD_STORAGE_ID, `__lot_${tag}`, CHAMBER_ID, FARMER_LEDGER_ID, TEST_ENTRY_INSTANT],
  );
  await pool.query(
    `INSERT INTO sales_history (
       id, cold_storage_id, lot_id, farmer_name, village, tehsil, district, state,
       contact_number, lot_no, chamber_name, floor, position, potato_type, bag_type,
       quality, original_lot_size, sale_type, quantity_sold, price_per_bag,
       cold_charge, hammali, cold_storage_charge, payment_status, paid_amount,
       paid_cash, paid_account, discount_allocated, due_amount, sale_year, sold_at,
       entry_date, cold_storage_bill_number, is_self_sale, farmer_ledger_id, price_per_kg
     ) VALUES (
       $1, $2, $3, 'Smoke Farmer', 'X', 'X', 'X', 'X',
       '0000000000', $4, 'C1', 0, 'P1', 'seed', 'seed',
       'good', 100, 'partial', 10, 60,
       50, 10, 600, 'partial', $5,
       $6, 0, 0, 0, $7, $8,
       $9, $10, 1, $11, 5
     )`,
    [
      saleId,
      COLD_STORAGE_ID,
      lotId,
      `__lot_${tag}`,
      opts.paidAmount ?? 0,
      opts.paidCash ?? 0,
      TEST_YEAR,
      new Date(`${TEST_DATE}T12:00:00+05:30`),
      TEST_ENTRY_INSTANT,
      opts.billNumber ?? null,
      FARMER_LEDGER_ID,
    ],
  );
  return saleId;
}

/** A cash receipt with a real gross amount + round-off, applied across `applications`. */
async function addReceiptWithRoundOff(
  tag: string,
  amount: number,
  roundOff: number,
  applications: Array<{ saleId: string; amountApplied: number }>,
): Promise<void> {
  const receiptId = `${RUN_ID}_rcpt_${tag}`;
  await pool.query(
    `INSERT INTO cash_receipts (
       id, cold_storage_id, payer_type, due_type, buyer_name, receipt_type,
       amount, round_off, received_at, applied_amount, unapplied_amount, is_reversed
     ) VALUES ($1, $2, 'cold_merchant', 'cold_charges', 'Smoke Buyer', 'cash',
       $3, $4, $5, $3, 0, 0)`,
    [receiptId, COLD_STORAGE_ID, amount, roundOff, new Date(`${TEST_DATE}T12:00:00+05:30`)],
  );
  for (const app of applications) {
    await pool.query(
      `INSERT INTO cash_receipt_applications (
         id, cold_storage_id, cash_receipt_id, sales_history_id, amount_applied
       ) VALUES ($1, $2, $3, $4, $5)`,
      [`${RUN_ID}_app_${tag}_${app.saleId.slice(-4)}`, COLD_STORAGE_ID, receiptId, app.saleId, app.amountApplied],
    );
  }
}

async function addExit(tag: string, saleId: string, lotId: string, bagsExited: number, billNumber: number): Promise<void> {
  await pool.query(
    `INSERT INTO exit_history (
       id, sales_history_id, lot_id, cold_storage_id, bags_exited, bill_number, exit_date, is_reversed
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
    [`${RUN_ID}_exit_${tag}`, saleId, lotId, COLD_STORAGE_ID, bagsExited, billNumber, new Date(`${TEST_DATE}T12:00:00+05:30`)],
  );
}

function approxEqual(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol;
}

async function main(): Promise<void> {
  await wipeByPrefix();

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`FAIL — ${msg}`);
  };
  const ok = (msg: string) => console.log(`ok — ${msg}`);

  try {
    await setupBaseFixtures();

    // Case 1: ₹90 payment + ₹10 round-off, applied in full to one sale.
    // Gross amount = 100 (already includes the round-off — see schema
    // comment). The sale must show the FULL ₹10 as round-off, not ₹9.09.
    const fullSale = await makeSale("full", { paidAmount: 100, paidCash: 100 });
    await addReceiptWithRoundOff("full", 100, 10, [{ saleId: fullSale, amountApplied: 100 }]);

    // Case 2: ₹180 gross (₹20 round-off) split 75/25 across two sales.
    // Sale A gets 135 of the gross (75%) → round-off share = 15.
    // Sale B gets 45 of the gross (25%) → round-off share = 5.
    const splitSaleA = await makeSale("split_a", { paidAmount: 135, paidCash: 135 });
    const splitSaleB = await makeSale("split_b", { paidAmount: 45, paidCash: 45 });
    await addReceiptWithRoundOff("split", 180, 20, [
      { saleId: splitSaleA, amountApplied: 135 },
      { saleId: splitSaleB, amountApplied: 45 },
    ]);

    const { storage } = await import("../server/storage.ts");

    // --- getSalesHistory (Sales History summary) ---
    const salesHistoryRows = await storage.getSalesHistory(COLD_STORAGE_ID);
    const byId = new Map(salesHistoryRows.map((r) => [r.id, r]));

    const full = byId.get(fullSale);
    if (!full) {
      fail("getSalesHistory — full-application sale not found");
    } else if (!approxEqual(full.roundOffCash ?? 0, 10)) {
      fail(`getSalesHistory — full-application round-off: expected ~10, got ${full.roundOffCash}`);
    } else {
      ok("getSalesHistory — full-application receipt attributes the whole round-off (₹10) to the one sale");
    }

    const a = byId.get(splitSaleA);
    const b = byId.get(splitSaleB);
    if (!a || !b) {
      fail("getSalesHistory — split-application sales not found");
    } else {
      if (!approxEqual(a.roundOffCash ?? 0, 15)) {
        fail(`getSalesHistory — split sale A round-off: expected ~15, got ${a.roundOffCash}`);
      } else {
        ok("getSalesHistory — split-application sale A gets its proportional round-off (₹15 of ₹20)");
      }
      if (!approxEqual(b.roundOffCash ?? 0, 5)) {
        fail(`getSalesHistory — split sale B round-off: expected ~5, got ${b.roundOffCash}`);
      } else {
        ok("getSalesHistory — split-application sale B gets its proportional round-off (₹5 of ₹20)");
      }
    }

    // --- getExitRegister (Nikasi Register) — same formula, sanity-checked
    // via a fully-exited version of the same two sales.
    await addExit("full", fullSale, `${RUN_ID}_lot_full`, 10, 9001);
    await addExit("split_a", splitSaleA, `${RUN_ID}_lot_split_a`, 10, 9002);
    await addExit("split_b", splitSaleB, `${RUN_ID}_lot_split_b`, 10, 9003);

    const exitRegister = await storage.getExitRegister(COLD_STORAGE_ID, { year: TEST_YEAR });
    const exitById = new Map(exitRegister.rows.map((r) => [r.saleId, r]));

    if (!approxEqual(exitRegister.summary.roundOffReceived, 30)) {
      fail(`getExitRegister — total round-off received: expected ~30, got ${exitRegister.summary.roundOffReceived}`);
    } else {
      ok("getExitRegister — total round-off received across both receipts is ₹30 (₹10 + ₹20), not double-counted or shrunk");
    }
  } finally {
    await wipeByPrefix();
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\nRound-off attribution check FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log("\nRound-off attribution check passed.");
}

main().catch(async (err) => {
  console.error("Smoke check crashed:", err);
  try { await wipeByPrefix(); } catch { /* best effort */ }
  try { await pool.end(); } catch { /* best effort */ }
  process.exit(1);
});
