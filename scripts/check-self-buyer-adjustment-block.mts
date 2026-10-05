#!/usr/bin/env tsx
// Real HTTP/DB regression check, including deterministic concurrent edits.
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const id = `__self_adj_${Date.now()}_${process.pid}`;
const otherId = `${id}_other`;
const app = express();
app.use(express.json());
const server = createServer(app);
let base = "";
const headers = { "content-type": "application/json", "x-auth-token": `${id}_session` };
const { storage } = await import("../server/storage.ts");

async function makeSale(tag: string, adj: number | null = 0, cs = id, self = false) {
  const saleId = `${id}_${tag}`;
  await pool.query(`INSERT INTO sales_history
    (id,cold_storage_id,lot_id,farmer_name,village,tehsil,district,state,
     contact_number,lot_no,chamber_name,floor,position,potato_type,bag_type,
     quality,original_lot_size,sale_type,quantity_sold,price_per_bag,
     cold_charge,hammali,cold_storage_charge,payment_status,due_amount,
     sale_year,sold_at,is_self_sale,buyer_name,buyer_ledger_id,buyer_id,
     adj_receivable_self_due_amount,farmer_ledger_id)
    VALUES ($1,$2,$3,'Smoke Farmer','X','X','X','X','0000000000',$4,'C',0,'P',
      'seed','seed','good',100,'partial',10,60,50,10,600,'due',600,2016,
      '2016-07-20 12:00:00',$5,$6,$7,$8,$9,$10)`,
  [saleId, cs, `${id}_lot`, tag, self ? 1 : 0, self ? null : "Smoke Buyer A",
    self ? null : `${id}_buyer_a`, self ? null : "BYA", adj, `${id}_farmer`]);
  return saleId;
}
async function patch(saleId: string, body: Record<string, unknown>) {
  return fetch(`${base}/api/sales-history/${saleId}`, { method: "PATCH", headers, body: JSON.stringify(body) });
}
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ["sales_history", "lots", "farmer_ledger", "buyer_ledger",
    "cash_receipts", "cash_receipt_applications", "opening_receivables", "discounts"]) {
    result[table] = (await pool.query(`SELECT * FROM ${table} WHERE cold_storage_id=$1 ORDER BY id`, [id])).rows;
  }
  result.history = (await pool.query(`SELECT * FROM sale_edit_history WHERE sale_id IN
    (SELECT id FROM sales_history WHERE cold_storage_id=$1) ORDER BY id`, [id])).rows;
  return result;
}
async function expectBlocked(saleId: string, body: Record<string, unknown>, label: string) {
  const before = await snapshot();
  const response = await patch(saleId, body);
  const result = await response.json() as { field?: string; error?: string };
  assert.equal(response.status, 400, `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.field, "buyerLedgerId", label);
  assert.match(result.error!, /Adj Receivable & Self Due/, label);
  assert.deepEqual(await snapshot(), before, `${label}: no sale/history/financial side effects`);
}
async function expectAllowed(saleId: string, body: Record<string, unknown>, label: string) {
  const response = await patch(saleId, body);
  assert.equal(response.status, 200, `${label}: ${await response.clone().text()}`);
  return await response.json() as Record<string, unknown>;
}

try {
  const { registerRoutes } = await import("../server/routes.ts");
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const cs of [id, otherId]) {
    await pool.query(`INSERT INTO cold_storages
      (id,name,total_capacity,wafer_rate,seed_rate,linked_phones)
      VALUES ($1,'Adjustment Smoke',10000,100,100,'{}')`, [cs]);
  }
  await pool.query(`INSERT INTO cold_storage_users
    (id,cold_storage_id,name,mobile_number,password,access_type)
    VALUES ($1,$2,'Smoke User',$3,'fixture','edit')`,
    [`${id}_user`, id, `9${Date.now().toString().slice(-9)}`]);
  await pool.query(`INSERT INTO user_sessions (id,user_id,cold_storage_id) VALUES ($1,$2,$3)`,
    [headers["x-auth-token"], `${id}_user`, id]);
  await pool.query(`INSERT INTO farmer_ledger
    (id,cold_storage_id,farmer_id,name,contact_number,village,tehsil,district,state)
    VALUES ($1,$2,'FMTEST','Smoke Farmer','0000000000','X','X','X','X')`, [`${id}_farmer`, id]);
  for (const [key, label] of [["a", "A"], ["b", "B"]]) {
    await pool.query(`INSERT INTO buyer_ledger (id,cold_storage_id,buyer_id,buyer_name)
      VALUES ($1,$2,$3,$4)`, [`${id}_buyer_${key}`, id, `BY${label}`, `Smoke Buyer ${label}`]);
  }
  const positive = await makeSale("positive", 100);
  const small = await makeSale("small", 0.001);
  const zero = await makeSale("zero");
  const missing = await makeSale("missing", null);
  const pending = await makeSale("pending");
  for (const representation of [{ isSelfSale: 1 }, { buyerLedgerId: null },
    { isSelfSale: 1, buyerLedgerId: null }, { isSelfSale: 0, buyerLedgerId: null }]) {
    await expectBlocked(positive, representation, `positive: ${JSON.stringify(representation)}`);
  }
  await expectBlocked(small, { isSelfSale: 1 }, "any positive amount, no epsilon");
  await expectBlocked(positive, { isSelfSale: 1, adjReceivableSelfDueAmount: 0, pricePerKg: 77 },
    "clearing adjustment in same request cannot bypass saved positive amount");
  await expectBlocked(pending, { isSelfSale: 1, adjReceivableSelfDueAmount: 25, pricePerKg: 88 },
    "pending positive adjustment cannot accompany Self");
  assert.equal((await expectAllowed(zero, { isSelfSale: 1, buyerLedgerId: null }, "zero allowed")).isSelfSale, 1);
  assert.equal((await expectAllowed(missing, { buyerLedgerId: null }, "missing allowed")).isSelfSale, 1);
  assert.equal((await expectAllowed(positive, { pricePerKg: 42 }, "unrelated edit allowed")).pricePerKg, 42);
  assert.equal((await expectAllowed(positive, { buyerLedgerId: `${id}_buyer_a`, isSelfSale: 0 },
    "same merchant allowed")).adjReceivableSelfDueAmount, 100);
  assert.equal((await expectAllowed(positive, { buyerLedgerId: `${id}_buyer_b`, isSelfSale: 0 },
    "merchant-to-merchant allowed")).buyerLedgerId, `${id}_buyer_b`);
  const otherSale = await makeSale("foreign", 50, otherId);
  const foreignBefore = (await pool.query("SELECT * FROM sales_history WHERE id=$1", [otherSale])).rows;
  assert.equal((await patch(otherSale, { isSelfSale: 1 })).status, 404);
  assert.deepEqual((await pool.query("SELECT * FROM sales_history WHERE id=$1", [otherSale])).rows, foreignBefore);
  const legacySelf = await makeSale("legacy_self", 10, id, true);
  assert.equal((await expectAllowed(legacySelf, { pricePerKg: 33 }, "unrelated legacy Self edit allowed")).pricePerKg, 33);
  // Persisted current state takes precedence over a stale caller's zero.
  const stale = await makeSale("stale");
  await pool.query("UPDATE sales_history SET adj_receivable_self_due_amount=50 WHERE id=$1", [stale]);
  await expectBlocked(stale, { isSelfSale: 1, adjReceivableSelfDueAmount: 0 }, "stale dialog");
  const direct = await makeSale("direct", 100);
  await assert.rejects(storage.updateSalesHistory(direct, { isSelfSale: 1 }), /Adj Receivable & Self Due/);

  // Hold an uncommitted edit: reads see the old merchant/zero, then the
  // guarded UPDATE waits. Committing proves the predicate is re-evaluated.
  async function race(tag: string, concurrentSQL: string, body: Record<string, unknown>, expectedColumns: Record<string, unknown>) {
    const saleId = await makeSale(tag);
    const before = await snapshot();
    const locker = await pool.connect();
    let request: Promise<Response> | undefined;
    try {
      await locker.query("BEGIN");
      const lockerPid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await locker.query(concurrentSQL, [saleId]);
      request = patch(saleId, body);
      const deadline = Date.now() + 8000;
      let waiting = false;
      while (Date.now() < deadline) {
        waiting = (await pool.query(`SELECT 1 FROM pg_stat_activity
          WHERE $1 = ANY(pg_blocking_pids(pid)) AND query ILIKE '%update%\"sales_history\"%set%'`, [lockerPid])).rowCount! > 0;
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.ok(waiting, `${tag}: request reached guarded UPDATE while row locked`);
      await locker.query("COMMIT");
      const response = await request;
      const result = await response.json() as { field?: string };
      assert.equal(response.status, 400, `${tag}: ${JSON.stringify(result)}`);
      assert.equal(result.field, "buyerLedgerId", tag);
      // Only the intentional concurrent edit is allowed to change anything.
      const salesBefore = before.sales_history as Array<Record<string, unknown>>;
      Object.assign(salesBefore.find(s => s.id === saleId)!, expectedColumns);
      assert.deepEqual(await snapshot(), before, `${tag}: rejected edit has no side effects`);
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (request) await request;
    }
  }
  await race("race_adjustment", "UPDATE sales_history SET adj_receivable_self_due_amount=50 WHERE id=$1",
    { isSelfSale: 1, buyerLedgerId: null, pricePerKg: 77 }, { adj_receivable_self_due_amount: 50 });
  await race("race_self", "UPDATE sales_history SET is_self_sale=1,buyer_name=NULL,buyer_ledger_id=NULL,buyer_id=NULL WHERE id=$1",
    { adjReceivableSelfDueAmount: 50, pricePerKg: 88 },
    { is_self_sale: 1, buyer_name: null, buyer_ledger_id: null, buyer_id: null });
  console.log("Self buyer adjustment guard passed: positive/small/zero/missing, all Self representations, combined edits, stale requests, permitted edits, tenant isolation, storage guard, no side effects, and both concurrent edit orders.");
} finally {
  await pool.query(`DELETE FROM sale_edit_history WHERE sale_id IN
    (SELECT id FROM sales_history WHERE cold_storage_id = ANY($1))`, [[id, otherId]]);
  for (const table of ["cash_receipt_applications", "cash_receipts", "exit_history", "sales_history",
    "opening_receivables", "discounts", "lots", "farmer_ledger", "buyer_ledger", "user_sessions", "cold_storage_users"]) {
    await pool.query(`DELETE FROM ${table} WHERE cold_storage_id = ANY($1)`, [[id, otherId]]);
  }
  await pool.query("DELETE FROM cold_storages WHERE id = ANY($1)", [[id, otherId]]);
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
process.exit(0);
