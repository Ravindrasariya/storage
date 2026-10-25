// Real HTTP/DB checks. The shared fixture boundary permits local Helium only.
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { saudaMultiSql } from "../server/sauda-multi-sql.ts";
import { auth, cleanup, farmerId, id, lot, pool, setup, legacySaleFixture } from "./tulai-fixtures.mts";

const app = express();
app.use(express.json());
const server = createServer(app);
let serverPool: { end(): Promise<void> } | undefined;
try {
  const { registerRoutes } = await import("../server/routes.ts");
  serverPool = (await import("../server/db.ts")).pool;
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await setup();
  const buyerA = randomUUID(), buyerB = randomUUID(), foreign = randomUUID();
  for (const [buyerId, tenant, initials] of [[buyerA, id, "AB"], [buyerB, id, null], [foreign, `${id}_other`, "NO"]]) {
    await pool.query(`INSERT INTO buyer_ledger (id,cold_storage_id,buyer_id,buyer_name,initials)
      VALUES ($1,$2,$1::varchar,$1::varchar,$3)`, [buyerId, tenant, initials]);
  }
  const lotA = await lot("sauda-a"), lotB = await lot("sauda-b");
  const foreignLot = await lot("foreign");
  await pool.query(`UPDATE lots SET cold_storage_id=$1 WHERE id=$2`, [`${id}_other`, foreignLot]);
  async function api(path: string, body?: unknown, method = "POST", expected = 200, headers: Record<string, string> = auth) {
    const res = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    assert.equal(res.status, expected, `${method} ${path}: ${text}`);
    return res.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text;
  }
  async function snapshot() {
    const state: Record<string, unknown> = {};
    for (const table of ["cold_storages", "lots", "chambers", "sales_history", "exit_history",
      "cash_receipts", "cash_receipt_applications", "buyer_ledger", "farmer_ledger",
      "expenses", "discounts", "opening_receivables", "opening_payables", "reversed_sales_archive", "reversed_exits_archive"]) {
      const scope = table === "cold_storages" ? "id" : "cold_storage_id";
      state[table] = (await pool.query(`SELECT * FROM ${table} WHERE ${scope} IN ($1,$2) ORDER BY id`, [id, `${id}_other`])).rows;
    }
    state.editHistory = (await pool.query(`SELECT * FROM lot_edit_history WHERE lot_id IN ($1,$2,$3) ORDER BY id`, [lotA, lotB, foreignLot])).rows;
    state.counters = (await pool.query(`SELECT * FROM daily_id_counters ORDER BY id`)).rows;
    return state;
  }
  const list = () => api("/api/sauda", undefined, "GET");
  const save = (lotId: string, quantity: unknown, buyerLedgerId: string, expected = 200) =>
    api(`/api/lots/${lotId}/sauda`, { quantity, buyerLedgerId }, "POST", expected);
  const remove = (lotId: string, saudaId: string, expected = 200) =>
    api(`/api/lots/${lotId}/sauda/${encodeURIComponent(saudaId)}`, undefined, "DELETE", expected);
  const before = await snapshot();
  assert.deepEqual(await list(), []);
  const first = await save(lotA, 50, buyerA);
  const second = await save(lotA, 25, buyerA);
  const blank = await save(lotA, 250, buyerB);
  assert.notEqual(first.id, second.id, "Same buyer/initials must still have separate identity");
  assert.equal((await list()).length, 3, "No aggregate cap or replacement");
  assert.equal((await list()).find((s: any) => s.id === blank.id).buyerInitials, null);
  await save(lotB, 50, buyerB);
  for (const quantity of [0, -1, 1.5, "10", null, {}, 2147483648]) await save(lotA, quantity, buyerA, 400);
  await save(lotA, 10, foreign, 400);
  await save(lotA, 10, randomUUID(), 400);
  await pool.query(`UPDATE buyer_ledger SET is_archived=1 WHERE id=$1`, [buyerB]);
  await save(lotA, 10, buyerB, 400);
  await pool.query(`UPDATE buyer_ledger SET is_archived=0 WHERE id=$1`, [buyerB]);
  await save(foreignLot, 10, buyerA, 404);
  await save("missing", 10, buyerA, 404);
  await api(`/api/lots/${lotA}/sauda`, { quantity: 10, buyerLedgerId: buyerA, kataCharges: 100 }, "POST", 400);
  await api(`/api/lots/${lotA}/sauda`, { quantity: 10, buyerLedgerId: buyerA }, "POST", 401, { "Content-Type": "application/json" });
  await api(`/api/lots/${lotA}/sauda/${first.id}`, undefined, "DELETE", 401, {});
  await api(`/api/lots/${lotA}/sauda/${first.id}`, { quantity: 20, buyerLedgerId: buyerB }, "PATCH", 404);
  await remove(lotB, first.id, 404);
  await remove(lotA, "missing", 404);
  await pool.query(`UPDATE cold_storage_users SET access_type='view' WHERE id=$1`, [`${id}_user`]);
  assert.equal((await list()).length, 4);
  await save(lotA, 10, buyerA, 403);
  await remove(lotA, first.id, 403);
  await pool.query(`UPDATE cold_storage_users SET access_type='edit' WHERE id=$1`, [`${id}_user`]);
  await remove(lotA, second.id);
  await remove(lotA, second.id, 404);
  assert.equal((await list()).find((s: any) => s.id === first.id).quantity, 50, "Deleting identical initials must not affect sibling");
  const replacement = await save(lotA, 75, buyerB);
  assert.notEqual(replacement.id, second.id);
  assert.deepEqual(await snapshot(), before, "Create/delete/recreate mutated stock, billing, ledgers, audit, archives or numbering");
  await pool.query(`UPDATE buyer_ledger SET initials='LIVE' WHERE id=$1`, [buyerA]);
  assert.equal((await list()).find((s: any) => s.id === first.id).buyerInitials, "LIVE");

  // No Sauda constraint may block lot changes or actual sales.
  await pool.query(`UPDATE lots SET size=90, remaining_size=90 WHERE id=$1`, [lotA]);
  await pool.query(`UPDATE lots SET size=100, remaining_size=100 WHERE id=$1`, [lotA]);
  const batch = (rows: object[], buyerLedgerId = buyerB, extra: object = {}) =>
    ({ farmerLedgerId: farmerId, buyerLedgerId, exitDate: "2016-06-15", rows, ...extra });
  const priorSales = await list();
  await api("/api/farmers/master-nikasi", batch([
    { lotId: lotA, soldBags: 100, exitBags: 3 }, { lotId: lotB, soldBags: 101, exitBags: 1 },
  ]), "POST", 400);
  assert.deepEqual(await list(), priorSales, "Failed Nikasi changed Saudas");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM sales_history WHERE cold_storage_id=$1`, [id])).rows[0].n, 0);
  const finalized = await api("/api/farmers/master-nikasi", batch([{ lotId: lotA, soldBags: 100, exitBags: 3 }]), "POST", 201);
  assert.deepEqual(await list(), priorSales, "Successful Nikasi must leave all Saudas unchanged");
  const saleId = finalized.sales[0].saleId;
  const sale = await api(`/api/sales-history/${saleId}`, undefined, "GET");
  assert.equal(sale.buyerLedgerId, buyerB, "Promised buyer changed final buyer");
  assert.equal(sale.quantitySold, 100);
  assert.equal((await pool.query(`SELECT remaining_size FROM lots WHERE id=$1`, [lotA])).rows[0].remaining_size, 0);
  const afterSold = await save(lotA, 150, buyerA);
  await remove(lotA, afterSold.id);
  await api(`/api/sales-history/${saleId}/exits`, { bagsExited: 97, exitDate: "2016-06-16" }, "POST", 201);
  await api(`/api/sales-history/${saleId}/exits`, { bagsExited: 1, exitDate: "2016-06-16" }, "POST", 400);
  await api(`/api/sales-history/${saleId}`, { remarks: "Sale Edit remains active", tulaiCharges: 25 }, "PATCH");
  await api(`/api/sales/${saleId}/manual-payment`, { receiptType: "cash", amount: 10, receivedAt: "2016-06-16" });
  await api(`/api/sales-history/${saleId}`, { remarks: "Must remain locked" }, "PATCH", 400);
  const paidSale = await api(`/api/sales-history/${saleId}`, undefined, "GET");
  await remove(lotA, first.id);
  assert.deepEqual(await api(`/api/sales-history/${saleId}`, undefined, "GET"), paidSale, "Deleting Sauda changed a paid actual sale");

  // Original Individual Sale is a real sale, independent of every Sauda.
  const saleBody = {
    quantitySold: 10, pricePerBag: 60, paymentStatus: "due", paymentMode: "cash",
    isSelfSale: false, buyerName: "Restored Individual Buyer", chargeBasis: "actual",
    soldAt: "2016-06-15", kataCharges: 20, tulaiCharges: 12.5, extraHammali: 30,
    gradingCharges: 40, gradingPerBag: 4, netWeight: 450, pricePerKg: 20, remarks: "Individual sale restored",
  };
  for (const [index, deliveryType] of ["gate", "gateWeighing", "bilty", "biltyWeighing"].entries()) {
    const individualLot = await lot(`individual-${index}`);
    await save(individualLot, 250, buyerA);
    await save(individualLot, 75, buyerA);
    const markersBefore = await list();
    const paymentStatus = ["due", "partial", "paid", "due"][index];
    const paymentMode = index === 1 ? "account" : "cash";
    const body = { ...saleBody, deliveryType, paymentStatus, paymentMode, paidAmount: index === 1 ? 100 : 0,
      isSelfSale: index === 3, position: "P2" };
    const chamberBefore = (await pool.query(`SELECT current_fill FROM chambers WHERE cold_storage_id=$1`, [id])).rows;
    await api(`/api/lots/${individualLot}/partial-sale`, body);
    assert.deepEqual((await pool.query(`SELECT current_fill FROM chambers WHERE cold_storage_id=$1`, [id])).rows, chamberBefore,
      "Individual Sale must not reduce physical chamber fill");
    const saleRow = (await pool.query(`SELECT * FROM sales_history WHERE lot_id=$1`, [individualLot])).rows[0];
    assert.ok(saleRow, "Individual Sale did not persist an actual sale");
    assert.equal(saleRow.quantity_sold, 10);
    assert.equal(saleRow.delivery_type, deliveryType);
    assert.equal(saleRow.cold_storage_charge, 702.5);
    assert.equal(saleRow.base_charge_amount_at_sale, 600);
    assert.equal(saleRow.base_hammali_amount, 100);
    assert.equal(saleRow.paid_amount, index === 1 ? 100 : index === 2 ? 702.5 : 0);
    assert.equal(saleRow.due_amount, index === 1 ? 602.5 : index === 2 ? 0 : 702.5);
    assert.equal(saleRow.payment_mode, paymentStatus === "due" ? null : paymentMode);
    assert.equal(saleRow.remarks, saleBody.remarks);
    assert.equal(saleRow.grading_per_bag, 4);
    assert.equal(saleRow.net_weight, 450);
    assert.equal(saleRow.is_self_sale, index === 3 ? 1 : 0);
    if (index !== 3) assert.ok(saleRow.buyer_ledger_id, "Original free-text buyer creation/linking missing");
    assert.ok(saleRow.cold_storage_bill_number > 0);
    const readLot = (await pool.query(`SELECT * FROM lots WHERE id=$1`, [individualLot])).rows[0];
    assert.equal(readLot.remaining_size, 90);
    assert.equal(readLot.position, "P2");
    assert.equal((await pool.query(`SELECT count(*)::int n FROM exit_history WHERE sales_history_id=$1`, [saleRow.id])).rows[0].n, 0,
      "Sale must not create a physical exit");
    assert.deepEqual(await list(), markersBefore, "Individual Sale changed informational Saudas");
    // Original validations must reject before changing stock or Saudas.
    await api(`/api/lots/${individualLot}/partial-sale`, { ...body, quantitySold: 91 }, "POST", 400);
    for (const soldAt of ["2016-02-31", "2014-01-01", "wrong"]) {
      await api(`/api/lots/${individualLot}/partial-sale`, { ...body, soldAt }, "POST", 400);
    }
    const duplicate = await api(`/api/lots/${individualLot}/partial-sale`,
      { ...body, coldStorageBillNumber: saleRow.cold_storage_bill_number }, "POST", 400);
    assert.equal(duplicate.field, "coldStorageBillNumber");
    assert.equal((await pool.query(`SELECT remaining_size FROM lots WHERE id=$1`, [individualLot])).rows[0].remaining_size, 90);
    await pool.query(`UPDATE cold_storage_users SET access_type='view' WHERE id=$1`, [`${id}_user`]);
    await api(`/api/lots/${individualLot}/partial-sale`, body, "POST", 403);
    await pool.query(`UPDATE cold_storage_users SET access_type='edit' WHERE id=$1`, [`${id}_user`]);
    if (index === 0) {
      await api(`/api/sales-history/${saleRow.id}`, { remarks: "Individual Sale Edit" }, "PATCH");
      await api(`/api/sales-history/${saleRow.id}/exits`, { bagsExited: 4, exitDate: "2016-06-16" }, "POST", 201);
      await api(`/api/sales-history/${saleRow.id}/exits`, { bagsExited: 7, exitDate: "2016-06-16" }, "POST", 400);
      await api(`/api/sales/${saleRow.id}/manual-payment`, { receiptType: "cash", amount: 10, receivedAt: "2016-06-16" });
      await api(`/api/sales-history/${saleRow.id}`, { remarks: "Must remain locked" }, "PATCH", 400);
    }
    assert.deepEqual(await list(), markersBefore);
  }
  await api(`/api/lots/${foreignLot}/partial-sale`, saleBody, "POST", 403);
  await api(`/api/lots/missing/partial-sale`, saleBody, "POST", 404);
  await api(`/api/lots/${lotB}/partial-sale`, saleBody, "POST", 401, {});

  // Concurrent creation keeps both entries; duplicate deletes affect exactly one.
  const raceLot = await lot("race");
  const raced = await Promise.all([80, 80].map(quantity => save(raceLot, quantity, buyerA)));
  assert.notEqual(raced[0].id, raced[1].id);
  const deletes = await Promise.all([1, 2].map(() => fetch(base + `/api/lots/${raceLot}/sauda/${raced[0].id}`, { method: "DELETE", headers: auth })));
  assert.deepEqual(deletes.map(r => r.status).sort(), [200, 404]);
  assert.ok((await list()).some((s: any) => s.id === raced[1].id));

  // Old actual individual sales retain original identity, edit and exit behavior.
  for (const name of ["no-exit", "partial-exit", "zero-unsold"]) {
    const legacyLot = await lot(name);
    const legacy = await legacySaleFixture(legacyLot);
    if (name === "zero-unsold") await pool.query(`UPDATE lots SET remaining_size=0 WHERE id=$1`, [legacyLot]);
    if (name === "partial-exit") await api(`/api/sales-history/${legacy.id}/exits`, { bagsExited: 4, exitDate: "2016-06-16" }, "POST", 201);
    await api(`/api/sales-history/${legacy.id}/exits`, { bagsExited: name === "partial-exit" ? 6 : 10, exitDate: "2016-06-17" }, "POST", 201);
    await api(`/api/sales-history/${legacy.id}/exits`, { bagsExited: 1, exitDate: "2016-06-17" }, "POST", 400);
    await api(`/api/sales-history/${legacy.id}`, { remarks: "Historical edit" }, "PATCH");
  }
  // Startup and manual SQL stay equivalent, idempotent, and preserve IDs.
  const normalizeSql = (s: string) => s.replace(/--[^\n]*/g, "").replace(/^\s*(BEGIN;|COMMIT;|SELECT pg_advisory_xact_lock\(726308458\);)\s*$/gm, "").replace(/\s+/g, " ").trim();
  const manual = readFileSync("scripts/sql/multiple-saudas-hostinger.sql", "utf8");
  assert.equal(normalizeSql(manual), normalizeSql(saudaMultiSql));
  const prior = await list();
  await pool.query(manual);
  await (await import("../server/sauda-migration.ts")).initializeSauda();
  assert.deepEqual(await list(), prior, "Rerunning migration changed or resurrected entries");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${id}_migration"`);
    await client.query(`SET LOCAL search_path TO "${id}_migration",public`);
    await client.query(`CREATE TABLE lot_sauda (lot_id varchar PRIMARY KEY, cold_storage_id varchar, buyer_ledger_id varchar, quantity int, updated_at timestamptz DEFAULT now());
      CREATE TABLE lots (id varchar); CREATE TABLE sales_history (id varchar)`);
    await client.query(`INSERT INTO lot_sauda (lot_id,cold_storage_id,buyer_ledger_id,quantity) VALUES ('old-lot','old-tenant','old-buyer',50)`);
    await client.query(saudaMultiSql);
    assert.deepEqual((await client.query(`SELECT id,lot_id,buyer_ledger_id,quantity FROM lot_sauda`)).rows,
      [{ id: "legacy:old-lot", lot_id: "old-lot", buyer_ledger_id: "old-buyer", quantity: 50 }]);
    await client.query(`INSERT INTO lot_sauda (lot_id,quantity) VALUES ('old-lot',25)`);
    await client.query(saudaMultiSql);
    assert.equal((await client.query(`SELECT count(*)::int n FROM lot_sauda`)).rows[0].n, 2);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  await pool.query(`UPDATE cold_storage_users SET cold_storage_id=$1 WHERE id=$2`, [`${id}_other`, `${id}_user`]);
  assert.deepEqual(await list(), [], "Sauda read leaked another tenant");
  await save(lotB, 10, foreign, 404);
  await remove(lotA, blank.id, 404);
  console.log("Sauda and original Individual Sale: independent creation, real stock/charges/bills/payments, all delivery options, validation, tenant/viewer scope, delete/recreate, no edits/caps, races, migration preservation/idempotency, unchanged Nikasi, exits and Sale Edit/payment locks passed.");
} finally {
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  await cleanup();
  await serverPool?.end();
}
