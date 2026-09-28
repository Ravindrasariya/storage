#!/usr/bin/env tsx
/**
 * Regression guard: manual single-sale payment round-off semantics (Task #389).
 *
 * The "Record Payment — Cold Storage Bill" dialog (print-receipt button on
 * Stock Register and Sales History) must use the SAME round-off contract as
 * the Cash tab:
 *
 *   - The "Amount" field the operator types is the ACTUAL money received.
 *   - "Round-off" is layered ON TOP of it, never subtracted from it.
 *   - The gross applied to the sale (and stored in cash_receipts.amount) is
 *     therefore `amount + roundOff`, with round_off stamped alongside it.
 *   - The payment-details view derives "Actual Paid" as `amount - roundOff`,
 *     which must give back exactly the number the operator typed.
 *
 * Concretely, for a ₹12,050 due paid with ₹12,000 cash + ₹50 round-off:
 *   stored amount = 12050, stored round_off = 50,
 *   displayed Actual Paid = 12000, due after = 0.
 *
 * A regression that stores the typed amount as the gross (12,000) would make
 * the details view report Actual Paid ₹11,950 — the round-off eaten out of
 * the operator's cash instead of added to it.
 *
 * Covers both payment modes (cash and account) since the dialog offers both.
 *
 * Run manually:
 *   DATABASE_URL=postgres://... tsx scripts/check-manual-payment-roundoff.mts
 *
 * Exit code: 0 on success, 1 on any failure.
 *
 * Cleanup: fixtures are prefixed with __manualpay_smoke_<timestamp>_<pid> on
 * the cold_storage_id and wiped at start AND in the finally block. If the
 * script crashes mid-run, leftovers can be removed with:
 *   DELETE FROM cold_storages WHERE id LIKE '__manualpay_smoke_%';
 */

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PREFIX = "__manualpay_smoke_";
const RUN_ID = `${PREFIX}${Date.now()}_${process.pid}`;
const COLD_STORAGE_ID = RUN_ID;
const CHAMBER_ID = `${RUN_ID}_ch`;
const FARMER_LEDGER_ID = `${RUN_ID}_fl`;
const BANK_ACCOUNT_ID = `${RUN_ID}_bank`;

const TEST_YEAR = 2016;
const TEST_DATE = `${TEST_YEAR}-06-15`;
const TEST_ENTRY_INSTANT = new Date(`${TEST_YEAR}-03-01T12:00:00+05:30`);
const RECEIVED_AT = new Date(`${TEST_DATE}T12:00:00+05:30`);

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
    "bank_accounts",
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
       $1, 'Manual Payment Smoke CS', 10000, 100, 100,
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
    [FARMER_LEDGER_ID, COLD_STORAGE_ID, `FMMANPAY${Date.now()}`],
  );
  await pool.query(
    `INSERT INTO bank_accounts (id, cold_storage_id, account_name, account_type, year, opening_balance)
     VALUES ($1, $2, 'Smoke Bank', 'current', $3, 0)`,
    [BANK_ACCOUNT_ID, COLD_STORAGE_ID, TEST_YEAR],
  );
}

/** A sale carrying an unpaid cold-storage bill of `billed`, untouched by FIFO. */
async function makeSale(tag: string, billed: number): Promise<string> {
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
       entry_date, cold_storage_bill_number, is_self_sale, farmer_ledger_id, price_per_kg,
       fifo_exclusion
     ) VALUES (
       $1, $2, $3, 'Smoke Farmer', 'X', 'X', 'X', 'X',
       '0000000000', $4, 'C1', 0, 'P1', 'seed', 'seed',
       'good', 100, 'partial', 10, 60,
       50, 10, $5, 'due', 0,
       0, 0, 0, $5, $6, $7,
       $8, NULL, 1, $9, 5,
       0
     )`,
    [
      saleId,
      COLD_STORAGE_ID,
      lotId,
      `__lot_${tag}`,
      billed,
      TEST_YEAR,
      new Date(`${TEST_DATE}T12:00:00+05:30`),
      TEST_ENTRY_INSTANT,
      FARMER_LEDGER_ID,
    ],
  );
  return saleId;
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
    const { storage } = await import("../server/storage.ts");

    // The exact scenario from the bug report: ₹12,050 due, operator hands over
    // ₹12,000 cash and writes ₹50 as round-off.
    const TYPED_AMOUNT = 12000;
    const ROUND_OFF = 50;
    const DUE = TYPED_AMOUNT + ROUND_OFF;

    for (const mode of ["cash", "account"] as const) {
      const saleId = await makeSale(mode, DUE);

      // Mirrors what the route layer composes from the dialog's two fields:
      // `amount` reaching storage is ALREADY the gross (typed + round-off).
      const { receipt } = await storage.createManualSalePayment({
        coldStorageId: COLD_STORAGE_ID,
        saleId,
        receiptType: mode,
        accountType: null,
        accountId: mode === "account" ? BANK_ACCOUNT_ID : null,
        amount: TYPED_AMOUNT + ROUND_OFF,
        roundOff: ROUND_OFF,
        receivedAt: RECEIVED_AT,
        notes: null,
      });

      // 1. Stored receipt is the gross, with the round-off stamped beside it —
      //    exactly how the Cash tab stores its own receipts.
      if (!approxEqual(Number(receipt.amount) || 0, DUE)) {
        fail(`${mode} — stored receipt amount: expected gross ₹${DUE}, got ₹${receipt.amount}`);
      } else {
        ok(`${mode} — receipt stores the gross ₹${DUE} (typed ₹${TYPED_AMOUNT} + round-off ₹${ROUND_OFF})`);
      }
      if (!approxEqual(Number(receipt.roundOff) || 0, ROUND_OFF)) {
        fail(`${mode} — stored round_off: expected ₹${ROUND_OFF}, got ₹${receipt.roundOff}`);
      } else {
        ok(`${mode} — receipt stores round-off ₹${ROUND_OFF}`);
      }

      // 2. The payment-details view derives Actual Paid as amount - roundOff.
      //    It must give back the operator's typed amount, NOT typed - roundOff.
      const displayedActualPaid = (Number(receipt.amount) || 0) - (Number(receipt.roundOff) || 0);
      if (!approxEqual(displayedActualPaid, TYPED_AMOUNT)) {
        fail(
          `${mode} — displayed Actual Paid: expected ₹${TYPED_AMOUNT} (what the operator typed), got ₹${displayedActualPaid}` +
            ` — round-off is being eaten out of the payment instead of added on top`,
        );
      } else {
        ok(`${mode} — payment-details view shows Actual Paid ₹${TYPED_AMOUNT}, matching the typed amount`);
      }

      // 3. The sale's due is cleared by the full gross, and the money lands in
      //    the right cash/account column.
      const { rows } = await pool.query(
        `SELECT paid_amount, due_amount, paid_cash, paid_account, payment_status
           FROM sales_history WHERE id = $1`,
        [saleId],
      );
      const sale = rows[0];
      if (!approxEqual(Number(sale.paid_amount) || 0, DUE) || !approxEqual(Number(sale.due_amount) || 0, 0)) {
        fail(
          `${mode} — sale after payment: expected paid ₹${DUE} / due ₹0, got paid ₹${sale.paid_amount} / due ₹${sale.due_amount}`,
        );
      } else {
        ok(`${mode} — sale due of ₹${DUE} is fully cleared by the gross`);
      }
      const expectedCash = mode === "cash" ? DUE : 0;
      const expectedAccount = mode === "account" ? DUE : 0;
      if (
        !approxEqual(Number(sale.paid_cash) || 0, expectedCash) ||
        !approxEqual(Number(sale.paid_account) || 0, expectedAccount)
      ) {
        fail(
          `${mode} — paid_cash/paid_account: expected ₹${expectedCash}/₹${expectedAccount}, got ₹${sale.paid_cash}/₹${sale.paid_account}`,
        );
      } else {
        ok(`${mode} — the gross lands in the ${mode === "cash" ? "cash" : "account"} column`);
      }

      // 4. Sales History attributes the whole round-off to this sale, so the
      //    printed bill / Discount card agree with the details view.
      const historyRows = await storage.getSalesHistory(COLD_STORAGE_ID);
      const row = historyRows.find((r) => r.id === saleId);
      const attributed = mode === "cash" ? row?.roundOffCash : row?.roundOffAccount;
      if (!row) {
        fail(`${mode} — sale missing from getSalesHistory`);
      } else if (!approxEqual(Number(attributed) || 0, ROUND_OFF)) {
        fail(`${mode} — Sales History round-off attribution: expected ₹${ROUND_OFF}, got ₹${attributed}`);
      } else {
        ok(`${mode} — Sales History attributes the full ₹${ROUND_OFF} round-off to the sale`);
      }
    }
  } finally {
    await wipeByPrefix();
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\nManual payment round-off check FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log("\nManual payment round-off check passed.");
}

main().catch(async (err) => {
  console.error("Smoke check crashed:", err);
  try { await wipeByPrefix(); } catch { /* best effort */ }
  try { await pool.end(); } catch { /* best effort */ }
  process.exit(1);
});
