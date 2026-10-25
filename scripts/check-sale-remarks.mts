#!/usr/bin/env tsx
// Real HTTP/DB checks restricted by the shared verified development boundary.
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { saleRemarkSchema } from "../shared/sale-remarks.ts";
import { auth, cleanup, farmerId, id, lot, pool, setup } from "./tulai-fixtures.mts";

process.env.TZ = "Asia/Kolkata";
const app = express();
app.use(express.json());
const server = createServer(app);
let serverPool: { end: () => Promise<void> } | undefined;
try {
  for (const value of [undefined, null, "", "   "]) {
    assert.equal(saleRemarkSchema.parse(value), value === undefined ? undefined : null);
  }
  assert.equal(saleRemarkSchema.parse("  टिप्पणी <b>note</b>  "), "टिप्पणी <b>note</b>");
  assert.equal(saleRemarkSchema.parse("x".repeat(500)), "x".repeat(500));
  const invalid = ["x".repeat(501), "a\nb", "\rnote", "note\u2028", "a\u2029b", "a\u0085b", "\0", 12, {}, []];
  for (const value of invalid) assert.equal(saleRemarkSchema.safeParse(value).success, false);

  const { registerRoutes } = await import("../server/routes.ts");
  serverPool = (await import("../server/db.ts")).pool;
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await setup();
  async function request(path: string, body?: unknown, method = "POST", status = 200, headers = auth) {
    const response = await fetch(base + path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return JSON.parse(text);
  }
  const saleBody = { quantitySold: 10, pricePerBag: 60, paymentStatus: "due", paidAmount: 0,
    isSelfSale: true, chargeBasis: "actual", soldAt: "2016-06-15" };
  const read = async (saleId: string) =>
    (await pool.query(`SELECT * FROM sales_history WHERE id=$1`, [saleId])).rows[0];
  async function sell(name: string, extra: object = {}) {
    const lotId = await lot(name);
    const body = { ...saleBody, ...extra } as any;
    await request("/api/farmers/master-nikasi", {
      farmerLedgerId: farmerId, exitDate: body.soldAt, remarks: body.remarks,
      rows: [{ lotId, soldBags: body.quantitySold, exitBags: 1 }],
    }, "POST", 201);
    return (await pool.query(`SELECT * FROM sales_history WHERE lot_id=$1`, [lotId])).rows[0];
  }
  async function snapshot(saleId: string) {
    const sale = await read(saleId);
    delete sale.remarks;
    return {
      sale,
      lot: (await pool.query(`SELECT * FROM lots WHERE id=$1`, [sale.lot_id])).rows,
      receipts: (await pool.query(`SELECT * FROM cash_receipts WHERE cold_storage_id=$1 ORDER BY id`, [id])).rows,
      applications: (await pool.query(`SELECT * FROM cash_receipt_applications WHERE cold_storage_id=$1 ORDER BY id`, [id])).rows,
      exits: (await pool.query(`SELECT * FROM exit_history WHERE sales_history_id=$1 ORDER BY id`, [saleId])).rows,
    };
  }
  const sale = await sell("remark", { remarks: "  शुरुआती टिप्पणी <script>literal</script>  " });
  assert.equal(sale.remarks, "शुरुआती टिप्पणी <script>literal</script>");
  assert.equal((await request(`/api/sales-history/${sale.id}`, undefined, "GET")).remarks, sale.remarks);
  const before = await snapshot(sale.id);
  await request(`/api/sales-history/${sale.id}`, { remarks: "Edited" }, "PATCH");
  assert.deepEqual(await snapshot(sale.id), before, "Remark-only edit changed financial/stock records");
  await request(`/api/sales-history/${sale.id}`, { netWeight: 500 }, "PATCH");
  assert.equal((await read(sale.id)).remarks, "Edited", "Omitted remark was cleared");
  const beforeClear = await snapshot(sale.id);
  await request(`/api/sales-history/${sale.id}`, { remarks: "   " }, "PATCH");
  assert.equal((await read(sale.id)).remarks, null);
  assert.deepEqual(await snapshot(sale.id), beforeClear);
  await request(`/api/sales-history/${sale.id}`, { remarks: "Restorable" }, "PATCH");
  await request(`/api/sales-history/${sale.id}`, { remarks: null }, "PATCH");
  const history = await request(`/api/sales-history/${sale.id}/edit-history`, undefined, "GET");
  assert.ok(history.some((entry: any) => entry.fieldChanged === "remarks" && entry.oldValue === "Restorable" && entry.newValue === null));
  await request(`/api/sales-history/${sale.id}`, { remarks: "Restorable" }, "PATCH");
  assert.equal((await read(sale.id)).remarks, "Restorable");
  for (const [n, remark] of [undefined, null, "", "   ", "x".repeat(500)].entries()) {
    const legacy = await sell(`blank-${n}`, remark === undefined ? {} : { remarks: remark });
    assert.equal(legacy.remarks, n === 4 ? remark : null);
  }
  const invalidLot = await lot("invalid");
  const batchLot = await lot("invalid-batch");
  for (const value of invalid) {
    await request(`/api/lots/${invalidLot}/partial-sale`, { ...saleBody, remarks: value }, "POST", 410);
    await request(`/api/sales-history/${sale.id}`, { remarks: value }, "PATCH", 400);
    await request("/api/farmers/master-nikasi", { farmerLedgerId: farmerId, exitDate: "2016-06-15",
      remarks: value, rows: [{ lotId: batchLot, exitBags: 1 }] }, "POST", 400);
  }
  assert.equal((await pool.query(`SELECT remaining_size FROM lots WHERE id=$1`, [invalidLot])).rows[0].remaining_size, 100);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM sales_history WHERE lot_id IN ($1,$2)`, [invalidLot, batchLot])).rows[0].n, 0);
  const batchRows = await Promise.all(["batch-a", "batch-b"].map(async name => ({ lotId: await lot(name), exitBags: 3 })));
  const batch = await request("/api/farmers/master-nikasi", { farmerLedgerId: farmerId, exitDate: "2016-06-15",
    remarks: "  Shared once  ", rows: batchRows }, "POST", 201);
  const [a, b] = batch.sales.map((row: any) => row.saleId);
  assert.equal((await read(a)).remarks, "Shared once");
  assert.equal((await read(b)).remarks, "Shared once");
  const siblingSnapshot = await read(b);
  await request(`/api/sales-history/${a}`, { remarks: "Only A" }, "PATCH");
  assert.deepEqual(await read(b), siblingSnapshot, "Sibling changed with shared CS/Exit bill numbers");
  await request(`/api/sales-history/${a}`, { remarks: "" }, "PATCH");
  assert.equal((await read(a)).remarks, null);
  assert.equal((await request(`/api/sales-history/${b}`, undefined, "GET")).remarks, "Shared once");
  const freshBatch = await request("/api/farmers/master-nikasi", { farmerLedgerId: farmerId, exitDate: "2016-06-15",
    rows: [{ lotId: await lot("next-batch"), exitBags: 1 }] }, "POST", 201);
  assert.equal((await read(freshBatch.sales[0].saleId)).remarks, null);
  for (const [n, field] of ["paid_amount", "paid_cash", "paid_account", "discount_allocated"].entries()) {
    const paid = await sell(`paid-${n}`, { remarks: "Locked" });
    await pool.query(`UPDATE sales_history SET ${field}=25 WHERE id=$1`, [paid.id]);
    const locked = await snapshot(paid.id);
    const blocked = await request(`/api/sales-history/${paid.id}`, { remarks: "Forbidden" }, "PATCH", 400);
    assert.equal(blocked.field, "paymentRecorded");
    assert.equal((await read(paid.id)).remarks, "Locked");
    assert.deepEqual(await snapshot(paid.id), locked);
  }
  const manual = await sell("manual-paid", { remarks: "Payment note is separate" });
  await request(`/api/sales/${manual.id}/manual-payment`, {
    receiptType: "cash", amount: 100, receivedAt: "2016-06-15", notes: "Receipt note",
  });
  await request(`/api/sales-history/${manual.id}`, { remarks: null }, "PATCH", 400);
  assert.equal((await read(manual.id)).remarks, "Payment note is separate");
  // Flags alone are not payment evidence: preserve the legacy rule.
  const flagOnly = await sell("flag-only");
  await pool.query(`UPDATE sales_history SET payment_status='paid' WHERE id=$1`, [flagOnly.id]);
  await request(`/api/sales-history/${flagOnly.id}`, { remarks: "Still editable" }, "PATCH");
  await request(`/api/sales-history/${sale.id}`, { remarks: "No auth" }, "PATCH", 401, { "Content-Type": "application/json" } as typeof auth);
  await pool.query(`UPDATE cold_storage_users SET access_type='view' WHERE id=$1`, [`${id}_user`]);
  await request(`/api/sales-history/${sale.id}`, { remarks: "View only" }, "PATCH", 403);
  await pool.query(`UPDATE cold_storage_users SET access_type='edit', cold_storage_id=$1 WHERE id=$2`, [`${id}_other`, `${id}_user`]);
  await request(`/api/sales-history/${sale.id}`, { remarks: "Wrong tenant" }, "PATCH", 404);
  await request(`/api/lots/${invalidLot}/partial-sale`, { ...saleBody, remarks: "Wrong tenant" }, "POST", 410);
  assert.equal((await read(sale.id)).remarks, "Restorable");
  console.log("Sale remarks: validation, persistence, clear/omit, history, batch copies, sibling isolation, payment locks and authorization passed.");
} finally {
  await cleanup();
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  await serverPool?.end();
}
