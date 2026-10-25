#!/usr/bin/env tsx
// Real HTTP/database regression check; only synthetic development fixtures are touched.
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { auth, cleanup, farmerId, id, lot, pool, setup } from "./tulai-fixtures.mts";
process.env.TZ = "Asia/Kolkata";
const app = express();
app.use(express.json());
const server = createServer(app);
try {
  const { registerRoutes } = await import("../server/routes.ts");
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await setup();
  async function request(path: string, body?: unknown, method = "POST", status = 200) {
    const response = await fetch(base + path, {
      method, headers: auth, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return JSON.parse(text);
  }
  const stats = () => request("/api/analytics/payments?year=2016", undefined, "GET");
  const pnl = () => request("/api/reports/pnl/2016-17", undefined, "GET");
  const saleBody = {
    quantitySold: 10, pricePerBag: 60, paymentStatus: "due", paidAmount: 0,
    dueAmount: 0, kataCharges: 20, extraHammali: 30, gradingCharges: 40,
    isSelfSale: true, chargeBasis: "actual", soldAt: "2016-06-15",
  };
  async function sell(name: string, tulai: unknown = undefined, overrides: object = {}, billed = 0) {
    const lotId = await lot(name, billed);
    const body = { ...saleBody, ...overrides } as any;
    let buyerLedgerId: string | undefined;
    if (!body.isSelfSale) {
      const { storage } = await import("../server/storage.ts");
      buyerLedgerId = (await storage.ensureBuyerLedgerEntry(id, { buyerName: body.buyerName })).id;
    }
    await request("/api/farmers/master-nikasi", {
      farmerLedgerId: farmerId, buyerLedgerId, exitDate: body.soldAt,
      rows: [{ lotId, soldBags: body.quantitySold, exitBags: 1, chargeBasis: body.chargeBasis,
        kataCharges: body.kataCharges, tulaiCharges: tulai, extraHammaliPerBag: body.extraHammali / body.quantitySold,
        gradingCharges: body.gradingCharges }],
    }, "POST", 201);
    return (await pool.query(`SELECT * FROM sales_history WHERE lot_id=$1`, [lotId])).rows[0];
  }
  for (const value of [-1, "nope", "Infinity", "NaN", {}]) {
    const lotId = await lot(`bad${String(value)}`);
    await request("/api/farmers/master-nikasi", { farmerLedgerId: farmerId, exitDate: saleBody.soldAt,
      rows: [{ lotId, exitBags: 1, tulaiCharges: value }] }, "POST", 400);
    assert.equal((await pool.query(`SELECT remaining_size FROM lots WHERE id=$1`, [lotId])).rows[0].remaining_size, 100);
  }
  for (const [index, value] of [undefined, null, "", 0].entries()) {
    const sale = await sell(`zero${index}`, value);
    assert.equal(sale.tulai_charges ?? 0, 0);
    assert.equal(sale.kata_charges, 20);
    assert.equal(sale.cold_storage_charge, 690);
  }
  const sale = await sell("positive", 50);
  assert.equal(sale.cold_storage_charge, 740);
  assert.equal(sale.base_charge_amount_at_sale, 600);
  assert.equal((await stats()).tulaiDue, 50);
  assert.equal((await stats()).totalTulaiCharges, 50);
  const initialPnl = await pnl();
  assert.equal(initialPnl.expenses.byType.tulai_billed, 50);
  for (const value of [-2, "bad", "Infinity"]) {
    await request(`/api/sales-history/${sale.id}`, { tulaiCharges: value }, "PATCH", 400);
  }
  await request(`/api/sales-history/${sale.id}`, { tulaiCharges: 80 }, "PATCH");
  assert.equal((await stats()).tulaiDue, 80);
  const edit = (await pool.query(`SELECT * FROM sale_edit_history WHERE sale_id=$1
    AND field_changed='tulaiCharges' ORDER BY changed_at DESC`, [sale.id])).rows[0];
  assert.equal(edit.old_value, "50");
  assert.equal(edit.new_value, "80");
  await request(`/api/sales-history/${sale.id}`, { tulaiCharges: "" }, "PATCH");
  const cleared = (await pool.query(`SELECT * FROM sales_history WHERE id=$1`, [sale.id])).rows[0];
  assert.equal(cleared.tulai_charges, 0);
  assert.equal(cleared.cold_storage_charge, 690);
  assert.equal((await stats()).tulaiDue, 0);
  await request(`/api/sales-history/${sale.id}`, { tulaiCharges: 50 }, "PATCH");

  const noBase = await sell("already-billed", 15, {}, 1);
  assert.equal(noBase.cold_storage_charge, 105);
  assert.equal(noBase.base_charge_amount_at_sale, 0);
  const remaining = await sell("remaining", 25, { chargeBasis: "totalRemaining" });
  assert.equal(remaining.cold_storage_charge, 6115);
  await pool.query(`UPDATE cold_storages SET charge_unit='quintal' WHERE id=$1`, [id]);
  const quintal = await sell("quintal", 35);
  assert.equal(quintal.cold_storage_charge, 475);
  await pool.query(`UPDATE cold_storages SET charge_unit='bag' WHERE id=$1`, [id]);
  const merchant = await sell("merchant", 45, { isSelfSale: false, buyerName: "Tulai Buyer" });
  assert.equal(merchant.cold_storage_charge, 735);
  const beforeCollection = (await stats()).tulaiDue;
  const receipt = await request("/api/cash-receipts", {
    payerType: "cold_merchant", buyerName: "Tulai Buyer", receiptType: "cash",
    amount: 735, receivedAt: "2016-06-15T12:00:00+05:30",
  });
  assert.equal((await stats()).tulaiDue, beforeCollection, "Customer collection must not pay Himmal");
  await request(`/api/sales-history/${merchant.id}`, { tulaiCharges: 1 }, "PATCH", 400);
  await request(`/api/cash-receipts/${receipt.receipt.id}/reverse`, {});
  assert.equal((await stats()).tulaiDue, beforeCollection);
  const beforePayout = await pnl();
  const expense = await request("/api/expenses", {
    expenseType: "tulai", expenseClass: "revenue", receiverName: "Himmal", paymentMode: "cash",
    amount: 30, paidAt: "2016-06-15T12:00:00+05:30", remarks: "Tulai test",
  });
  assert.equal((await stats()).tulaiDue, beforeCollection - 30);
  assert.deepEqual((await pnl()).expenses, beforePayout.expenses, "Payout must not double-count expense accrual");
  await request(`/api/expenses/${expense.id}/reverse`, {});
  assert.equal((await stats()).tulaiDue, beforeCollection);
  const bank = await request("/api/bank-accounts", {
    accountName: "Tulai Test Account", accountType: "current", openingBalance: 1000, year: 2016,
  });
  const accountPayout = await request("/api/expenses", {
    expenseType: "tulai", expenseClass: "revenue", receiverName: "Himmal",
    paymentMode: "account", accountType: "current", accountId: bank.id,
    amount: 20, paidAt: "2016-06-15T12:00:00+05:30",
  });
  assert.equal((await stats()).tulaiDue, beforeCollection - 20);
  assert.deepEqual((await pnl()).expenses, beforePayout.expenses);
  const activeAccountOutflow = await pool.query(`SELECT COALESCE(SUM(amount),0) AS amount
    FROM expenses WHERE cold_storage_id=$1 AND account_id=$2 AND is_reversed=0`, [id, bank.id]);
  assert.equal(1000 - Number(activeAccountOutflow.rows[0].amount), 980);
  await request(`/api/expenses/${accountPayout.id}/reverse`, {});
  assert.equal((await stats()).tulaiDue, beforeCollection);
  await request("/api/expenses", {
    expenseType: "tulai", expenseClass: "capital", paymentMode: "cash",
    amount: 1, paidAt: "2016-06-15",
  }, "POST", 400);

  const mnLot1 = await lot("mn1", 1), mnLot2 = await lot("mn2", 1);
  const batchBody = {
    farmerLedgerId: farmerId, exitDate: "2016-06-16",
    rows: [{ lotId: mnLot1, exitBags: 2, kataCharges: 10, tulaiCharges: 20 },
      { lotId: mnLot2, exitBags: 3, kataCharges: 15, tulaiCharges: 25 }],
  };
  await request("/api/farmers/master-nikasi", {
    ...batchBody, payment: { amount: 71, receiptType: "cash", receivedAt: "2016-06-16" },
  }, "POST", 400);
  const batch = await request("/api/farmers/master-nikasi", {
    ...batchBody, payment: { amount: 60, roundOff: 10, receiptType: "cash", receivedAt: "2016-06-16" },
  }, "POST", 201);
  assert.equal(batch.sales.reduce((sum: number, s: any) => sum + s.tulaiCharges, 0), 45);
  assert.equal(batch.sales.reduce((sum: number, s: any) => sum + s.totalColdStorageCharge, 0), 70);
  assert.equal((await stats()).tulaiDue, beforeCollection + 45, "Batch customer payment is not labour payout");
  const beforeReversal = await stats();
  await request(`/api/sales-history/${sale.id}/reverse`, {});
  assert.equal((await stats()).tulaiDue, beforeReversal.tulaiDue - 50);
  assert.equal((await pnl()).expenses.byType.tulai_billed, beforeReversal.totalTulaiCharges - 50);
  assert.equal((await request("/api/analytics/payments?year=2015", undefined, "GET")).tulaiDue, 0);
  const other = (await pool.query(`SELECT COALESCE(SUM(tulai_charges),0) AS total FROM sales_history
    WHERE cold_storage_id=$1`, [`${id}_other`])).rows[0];
  assert.equal(Number(other.total), 0);
  console.log("Tulai checks passed: validation, null/zero/clear, bag/quintal/remaining/prebilled, self/merchant, edit history, customer collection/reversal, payment guard, labour payout/reversal, P&L, batch payment/round-off, sale reversal and year/tenant isolation.");
} finally {
  await cleanup();
  await new Promise<void>(resolve => server.close(() => resolve()));
  const { pool: appPool } = await import("../server/db.ts");
  await appPool.end();
}
