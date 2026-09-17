#!/usr/bin/env tsx
/**
 * Smoke check: a sale with money recorded against it cannot be edited.
 *
 * Task #361 froze sale edits once ANY payment exists — manual or
 * FIFO/lumpsum, full or partial, cash, account or discount. The guard is
 * server-side because it is the only layer that sees the true payment
 * state, and it is shared by BOTH edit paths:
 *   • PATCH /api/sales-history/:id            (single-sale save)
 *   • PATCH /api/sales-history/cs-bill/:bill  (CS Bill # group cascade)
 *
 * The risks this script guards against:
 *   1. A future refactor drops the guard from one of the two paths (the
 *      cascade one is easy to miss — it lives inside the storage
 *      transaction, not the route).
 *   2. Someone "simplifies" the payment rule down to `payment_status`,
 *      which would falsely freeze legacy rows that carry
 *      payment_status='paid' with a zero paid_amount and no receipts.
 *   3. The cascade guard runs but leaves a partial write behind (e.g. it
 *      is moved after the UPDATE).
 *   4. A reversed payment keeps blocking forever.
 *
 * What this script asserts (against a real DB, over real HTTP routes, so
 * route-layer error mapping is covered too, not just storage):
 *   1. paid_amount > 0            → single-sale PATCH refused (400).
 *   2. manual single-sale receipt → refused, even with zero paid_amount.
 *   3. FIFO application row       → refused, even with zero paid_amount.
 *   4. discount_allocated only    → refused (discounts move ledgers too).
 *   5. unpaid sale                → PATCH succeeds and the value changes.
 *   6. legacy paid-flag-only row  → NOT blocked (no money ever moved).
 *   7. reversed receipt           → NOT blocked (payment was undone).
 *   8. bill group with one paid sibling → cascade refused AND neither
 *      row changed (no partial write).
 *   9. bill group with no paid sibling  → cascade still works.
 *
 * Run manually:
 *   DATABASE_URL=postgres://... tsx scripts/check-sale-edit-payment-block.mts
 *
 * Exit code: 0 on success, 1 on any failure.
 *
 * Cleanup: every fixture is tagged with a `__pay_block_smoke_` prefixed
 * cold-storage / user id and wiped at start AND in the finally block. If
 * the script crashes mid-run, leftovers can be removed with:
 *   DELETE FROM cold_storages WHERE id LIKE '__pay_block_smoke_%';
 *   (child tables are cleaned by the same prefix logic below)
 */

import pg from "pg";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PREFIX = "__pay_block_smoke_";
const RUN_ID = `${PREFIX}${Date.now()}_${process.pid}`;
const USER_ID = `${RUN_ID}_user`;
const SESSION_TOKEN = `${RUN_ID}_token`;

// Pinned to a fixed past year so repeated runs never collide through the
// entry-year-scoped CS Bill # dup check, and so the "not in the future"
// sale-date guard can never trip.
const TEST_YEAR = 2016;
const TEST_DATE = `${TEST_YEAR}-06-15`;
const TEST_ENTRY_INSTANT = new Date(`${TEST_YEAR}-03-01T12:00:00+05:30`);

async function wipeByPrefix(): Promise<void> {
  await pool.query(
    `DELETE FROM sale_edit_history WHERE sale_id IN (SELECT id FROM sales_history WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM lot_edit_history WHERE lot_id IN (SELECT id FROM lots WHERE cold_storage_id LIKE $1)`,
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
    "buyer_ledger",
  ]) {
    await pool.query(`DELETE FROM ${t} WHERE cold_storage_id LIKE $1`, [`${PREFIX}%`]);
  }
  await pool.query(`DELETE FROM user_sessions WHERE id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM cold_storage_users WHERE id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM cold_storages WHERE id LIKE $1`, [`${PREFIX}%`]);
}

const COLD_STORAGE_ID = RUN_ID;
const CHAMBER_ID = `${RUN_ID}_ch`;
const FARMER_LEDGER_ID = `${RUN_ID}_fl`;

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
       $1, 'Payment Block Smoke CS', 10000, 100, 100,
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
    [FARMER_LEDGER_ID, COLD_STORAGE_ID, `FMPAYBLK${Date.now()}`],
  );
  await pool.query(
    `INSERT INTO cold_storage_users (id, cold_storage_id, name, mobile_number, password, access_type)
     VALUES ($1, $2, 'Smoke User', $3, 'smoke', 'edit')`,
    [USER_ID, COLD_STORAGE_ID, `9${Date.now().toString().slice(-9)}`],
  );
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, cold_storage_id) VALUES ($1, $2, $3)`,
    [SESSION_TOKEN, USER_ID, COLD_STORAGE_ID],
  );
}

interface SaleOpts {
  paidAmount?: number;
  paidCash?: number;
  paidAccount?: number;
  discountAllocated?: number;
  paymentStatus?: string;
  coldStorageBillNumber?: number | null;
}

/** Creates a lot + one sale row against it, returns the sale id. */
async function makeSale(tag: string, opts: SaleOpts = {}): Promise<string> {
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
       50, 10, 600, $5, $6,
       $7, $8, $9, 0, $10, $11,
       $12, $13, 1, $14, 5
     )`,
    [
      saleId,
      COLD_STORAGE_ID,
      lotId,
      `__lot_${tag}`,
      opts.paymentStatus ?? "due",
      opts.paidAmount ?? 0,
      opts.paidCash ?? 0,
      opts.paidAccount ?? 0,
      opts.discountAllocated ?? 0,
      TEST_YEAR,
      new Date(`${TEST_DATE}T12:00:00+05:30`),
      TEST_ENTRY_INSTANT,
      opts.coldStorageBillNumber ?? null,
      FARMER_LEDGER_ID,
    ],
  );
  return saleId;
}

/** Non-reversed manual single-sale receipt (appliesToSaleId, FIFO-excluded). */
async function addManualReceipt(tag: string, saleId: string, amount: number): Promise<void> {
  await pool.query(
    `INSERT INTO cash_receipts (
       id, cold_storage_id, payer_type, due_type, buyer_name, receipt_type,
       amount, round_off, received_at, applied_amount, unapplied_amount,
       is_reversed, applies_to_sale_id
     ) VALUES ($1, $2, 'cold_merchant', 'cold_charges', 'Smoke Buyer', 'cash',
       $3, 0, $4, $3, 0, 0, $5)`,
    [`${RUN_ID}_rcpt_${tag}`, COLD_STORAGE_ID, amount, new Date(`${TEST_DATE}T12:00:00+05:30`), saleId],
  );
}

/** FIFO/lumpsum receipt + its application row against a sale. */
async function addFifoApplication(
  tag: string,
  saleId: string,
  amount: number,
  reversed = false,
): Promise<void> {
  const receiptId = `${RUN_ID}_frcpt_${tag}`;
  await pool.query(
    `INSERT INTO cash_receipts (
       id, cold_storage_id, payer_type, due_type, buyer_name, receipt_type,
       amount, round_off, received_at, applied_amount, unapplied_amount, is_reversed
     ) VALUES ($1, $2, 'cold_merchant', 'cold_charges', 'Smoke Buyer', 'cash',
       $3, 0, $4, $3, 0, $5)`,
    [receiptId, COLD_STORAGE_ID, amount, new Date(`${TEST_DATE}T12:00:00+05:30`), reversed ? 1 : 0],
  );
  await pool.query(
    `INSERT INTO cash_receipt_applications (
       id, cold_storage_id, cash_receipt_id, sales_history_id, amount_applied
     ) VALUES ($1, $2, $3, $4, $5)`,
    [`${RUN_ID}_app_${tag}`, COLD_STORAGE_ID, receiptId, saleId, amount],
  );
}

async function readSale(saleId: string): Promise<{
  pricePerKg: number | null;
  billNumber: number | null;
  soldAt: Date;
}> {
  const r = await pool.query(
    `SELECT price_per_kg, cold_storage_bill_number, sold_at FROM sales_history WHERE id = $1`,
    [saleId],
  );
  return {
    pricePerKg: r.rows[0].price_per_kg,
    billNumber: r.rows[0].cold_storage_bill_number,
    soldAt: r.rows[0].sold_at,
  };
}

async function main(): Promise<void> {
  await wipeByPrefix();

  const { registerRoutes } = await import("../server/routes.ts");
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const authHeaders = {
    "content-type": "application/json",
    "x-auth-token": SESSION_TOKEN,
  };

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`FAIL — ${msg}`);
  };

  const patchSale = (saleId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/sales-history/${saleId}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify(body),
    });

  /** Asserts the single-sale PATCH is refused with the payment-block tag. */
  async function expectBlocked(label: string, saleId: string): Promise<void> {
    const before = await readSale(saleId);
    const resp = await patchSale(saleId, { pricePerKg: 99 });
    const body = (await resp.json()) as { error?: string; field?: string };
    const after = await readSale(saleId);
    if (resp.status !== 400 || body.field !== "paymentRecorded") {
      fail(`${label} — expected 400 + field=paymentRecorded, got ${resp.status} ${JSON.stringify(body)}`);
      return;
    }
    if (!/payment already exists/i.test(body.error || "")) {
      fail(`${label} — message does not mention the existing payment: ${body.error}`);
      return;
    }
    if (after.pricePerKg !== before.pricePerKg) {
      fail(`${label} — sale was modified despite the block (${before.pricePerKg} → ${after.pricePerKg})`);
      return;
    }
    console.log(`ok — ${label}: refused, nothing written (${body.error})`);
  }

  /** Asserts the single-sale PATCH goes through. */
  async function expectAllowed(label: string, saleId: string): Promise<void> {
    const resp = await patchSale(saleId, { pricePerKg: 77 });
    const text = await resp.text();
    if (!resp.ok) {
      fail(`${label} — expected the edit to succeed, got ${resp.status} ${text}`);
      return;
    }
    const after = await readSale(saleId);
    if (after.pricePerKg !== 77) {
      fail(`${label} — edit reported success but price_per_kg is ${after.pricePerKg}`);
      return;
    }
    console.log(`ok — ${label}: edit applied normally`);
  }

  try {
    await setupBaseFixtures();

    // 1. Money booked directly on the sale row (the ordinary paid case).
    const paidSale = await makeSale("paid", { paidAmount: 500, paidCash: 500, paymentStatus: "partial" });
    await expectBlocked("cash-paid sale", paidSale);

    // 2. Manual single-sale receipt with zero paid_amount on the row.
    //    Only the receipt proves the payment here.
    const manualSale = await makeSale("manual");
    await addManualReceipt("manual", manualSale, 300);
    await expectBlocked("manually paid sale (zero paid_amount on the row)", manualSale);

    // 3. FIFO/lumpsum application row, again with a zero paid_amount.
    const fifoSale = await makeSale("fifo");
    await addFifoApplication("fifo", fifoSale, 250);
    await expectBlocked("FIFO/lumpsum-paid sale (zero paid_amount on the row)", fifoSale);

    // 4. Discount-only allocation — no cash, but ledger balances moved.
    const discountSale = await makeSale("discount", { discountAllocated: 120 });
    await expectBlocked("discount-only sale", discountSale);

    // 4b. Account-only allocation.
    const accountSale = await makeSale("account", { paidAccount: 400, paymentStatus: "partial" });
    await expectBlocked("account-paid sale", accountSale);

    // 5. Plain unpaid sale — unaffected.
    const unpaidSale = await makeSale("unpaid");
    await expectAllowed("unpaid sale", unpaidSale);

    // 6. Legacy row: payment_status='paid' but no money anywhere. Must NOT
    //    be frozen — the flag alone is not evidence of a payment.
    const legacySale = await makeSale("legacy", { paymentStatus: "paid", paidAmount: 0 });
    await expectAllowed("legacy paid-flag-only sale", legacySale);

    // 7. Reversed receipt — the payment was undone, so the sale is free again.
    const reversedSale = await makeSale("reversed");
    await addFifoApplication("reversed", reversedSale, 200, true);
    await expectAllowed("sale whose payment was reversed", reversedSale);

    // -----------------------------------------------------------------
    // 8. CS Bill # cascade: two siblings share bill # 8801, one is paid.
    //    The whole cascade must be refused with no partial write.
    // -----------------------------------------------------------------
    const GROUP_BILL = 8801;
    const sibUnpaid = await makeSale("sib_unpaid", { coldStorageBillNumber: GROUP_BILL });
    const sibPaid = await makeSale("sib_paid", {
      coldStorageBillNumber: GROUP_BILL,
      paidAmount: 700,
      paidCash: 700,
      paymentStatus: "partial",
    });

    const beforeA = await readSale(sibUnpaid);
    const beforeB = await readSale(sibPaid);
    const cascadeResp = await fetch(`${baseUrl}/api/sales-history/cs-bill/${GROUP_BILL}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ saleId: sibUnpaid, newBillNumber: 8899 }),
    });
    const cascadeBody = (await cascadeResp.json()) as { error?: string; field?: string };
    const afterA = await readSale(sibUnpaid);
    const afterB = await readSale(sibPaid);

    if (cascadeResp.status !== 400 || cascadeBody.field !== "paymentRecorded") {
      fail(
        `bill-group cascade — expected 400 + field=paymentRecorded, ` +
          `got ${cascadeResp.status} ${JSON.stringify(cascadeBody)}`,
      );
    } else if (afterA.billNumber !== beforeA.billNumber || afterB.billNumber !== beforeB.billNumber) {
      fail(
        `bill-group cascade — partial write detected: ` +
          `sibling A ${beforeA.billNumber}→${afterA.billNumber}, ` +
          `sibling B ${beforeB.billNumber}→${afterB.billNumber}`,
      );
    } else {
      console.log(`ok — bill-group cascade with one paid sibling: refused, no partial write`);
    }

    // The paid sibling must also be refused when it is the one being edited.
    const cascadeFromPaid = await fetch(`${baseUrl}/api/sales-history/cs-bill/${GROUP_BILL}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ saleId: sibPaid, newSoldAt: `${TEST_YEAR}-07-20` }),
    });
    if (cascadeFromPaid.status !== 400) {
      fail(`bill-group cascade from the paid sibling — expected 400, got ${cascadeFromPaid.status}`);
    } else {
      console.log("ok — bill-group cascade initiated from the paid sibling: refused");
    }

    // 9. Counter-check: an unpaid bill group still cascades normally, so
    //    the guard has not frozen ordinary bill-number corrections.
    const CLEAN_BILL = 8802;
    const cleanA = await makeSale("clean_a", { coldStorageBillNumber: CLEAN_BILL });
    await makeSale("clean_b", { coldStorageBillNumber: CLEAN_BILL });
    const cleanResp = await fetch(`${baseUrl}/api/sales-history/cs-bill/${CLEAN_BILL}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ saleId: cleanA, newBillNumber: 8877 }),
    });
    const cleanText = await cleanResp.text();
    if (!cleanResp.ok) {
      fail(`unpaid bill-group cascade — expected success, got ${cleanResp.status} ${cleanText}`);
    } else {
      const afterClean = await readSale(cleanA);
      if (afterClean.billNumber !== 8877) {
        fail(`unpaid bill-group cascade — reported success but bill # is ${afterClean.billNumber}`);
      } else {
        console.log("ok — unpaid bill group still cascades normally");
      }
    }
  } finally {
    await wipeByPrefix();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\nSale-edit payment block check FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log("\nSale-edit payment block check passed.");
}

main().catch(async (err) => {
  console.error("Smoke check crashed:", err);
  try { await wipeByPrefix(); } catch { /* best effort */ }
  try { await pool.end(); } catch { /* best effort */ }
  process.exit(1);
});
