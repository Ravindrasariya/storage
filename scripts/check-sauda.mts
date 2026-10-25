// Real HTTP/DB checks; shared fixture boundary permits local Helium only.
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
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
  const before = await snapshot();
  assert.deepEqual(await list(), []);
  await save(lotA, 30, buyerA);
  assert.deepEqual(await list(), [{ lotId: lotA, buyerLedgerId: buyerA, quantity: 30, buyerInitials: "AB" }]);
  await save(lotA, 100, buyerB);
  assert.equal((await list()).length, 1);
  assert.equal((await list())[0].buyerInitials, null, "Blank initials must stay blank");
  await save(lotA, 25, buyerA);
  await save(lotB, 50, buyerB);
  for (const quantity of [0, -1, 1.5, 101, "10", null, {}, 2147483648]) await save(lotA, quantity, buyerA, 400);
  await save(lotA, 10, foreign, 400);
  await save(lotA, 10, randomUUID(), 400);
  await save(foreignLot, 10, buyerA, 404);
  await save("missing", 10, buyerA, 404);
  await api(`/api/lots/${lotA}/sauda`, { quantity: 10, buyerLedgerId: buyerA, kataCharges: 100 }, "POST", 400);
  await api(`/api/lots/${lotA}/sauda`, { quantity: 10, buyerLedgerId: buyerA }, "POST", 401, { "Content-Type": "application/json" });
  await api(`/api/lots/${lotA}/partial-sale`, { quantitySold: 10, buyerName: "New buyer" }, "POST", 410);
  await pool.query(`UPDATE cold_storage_users SET access_type='view' WHERE id=$1`, [`${id}_user`]);
  assert.equal((await list()).length, 2, "Viewers can read initials");
  await save(lotA, 10, buyerA, 403);
  await api(`/api/lots/${lotA}/sauda`, undefined, "DELETE", 404);
  await pool.query(`UPDATE cold_storage_users SET access_type='edit' WHERE id=$1`, [`${id}_user`]);
  assert.deepEqual(await snapshot(), before, "Sauda mutated stock, billing, ledger, audit, archives or numbering");
  await pool.query(`UPDATE buyer_ledger SET initials='LIVE' WHERE id=$1`, [buyerA]);
  assert.equal((await list()).find((s: any) => s.lotId === lotA).buyerInitials, "LIVE");
  await pool.query(`UPDATE lots SET remaining_size=20 WHERE id=$1`, [lotA]);
  await save(lotA, 25, buyerA, 400);
  assert.equal((await list()).find((s: any) => s.lotId === lotA).quantity, 25, "Rejected stale submission changed marker");
  await pool.query(`UPDATE lots SET remaining_size=100 WHERE id=$1`, [lotA]);
  const batch = (rows: object[], buyerLedgerId = buyerB, extra: object = {}) =>
    ({ farmerLedgerId: farmerId, buyerLedgerId, exitDate: "2016-06-15", rows, ...extra });
  await api("/api/farmers/master-nikasi", batch([
    { lotId: lotA, soldBags: 100, exitBags: 3 }, { lotId: lotB, soldBags: 101, exitBags: 1 },
  ]), "POST", 400);
  assert.equal((await list()).length, 2, "Failed batch discarded Sauda");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM sales_history WHERE cold_storage_id=$1`, [id])).rows[0].n, 0);
  const finalized = await api("/api/farmers/master-nikasi", batch([{ lotId: lotA, soldBags: 100, exitBags: 3 }]), "POST", 201);
  assert.equal((await list()).length, 1);
  assert.equal((await list())[0].lotId, lotB, "Finalizing one lot cleared another marker");
  const saleId = finalized.sales[0].saleId;
  const sale = await api(`/api/sales-history/${saleId}`, undefined, "GET");
  assert.equal(sale.buyerLedgerId, buyerB, "Promised buyer overrode explicit final buyer");
  assert.equal(sale.quantitySold, 100);
  assert.equal((await pool.query(`SELECT remaining_size FROM lots WHERE id=$1`, [lotA])).rows[0].remaining_size, 0);
  await api(`/api/sales-history/${saleId}/exits`, { bagsExited: 97, exitDate: "2016-06-16" }, "POST", 201);
  await api(`/api/sales-history/${saleId}/exits`, { bagsExited: 1, exitDate: "2016-06-16" }, "POST", 400);
  await api(`/api/sales-history/${saleId}`, { remarks: "Sale Edit remains active", tulaiCharges: 25 }, "PATCH");
  await api(`/api/sales/${saleId}/manual-payment`, { receiptType: "cash", amount: 10, receivedAt: "2016-06-16" });
  await api(`/api/sales-history/${saleId}`, { remarks: "Must remain locked" }, "PATCH", 400);
  // Old individual sales retain their original ID and independent exit limit,
  // including when no unsold bags remain on the parent lot.
  for (const name of ["no-exit", "partial-exit", "zero-unsold"]) {
    const legacyLot = await lot(name);
    const legacy = await legacySaleFixture(legacyLot);
    if (name === "zero-unsold") await pool.query(`UPDATE lots SET remaining_size=0 WHERE id=$1`, [legacyLot]);
    if (name === "partial-exit") await api(`/api/sales-history/${legacy.id}/exits`, { bagsExited: 4, exitDate: "2016-06-16" }, "POST", 201);
    await api(`/api/sales-history/${legacy.id}/exits`, { bagsExited: name === "partial-exit" ? 6 : 10, exitDate: "2016-06-17" }, "POST", 201);
    await api(`/api/sales-history/${legacy.id}/exits`, { bagsExited: 1, exitDate: "2016-06-17" }, "POST", 400);
    await api(`/api/sales-history/${legacy.id}`, { remarks: "Historical edit" }, "PATCH");
  }
  await pool.query(`UPDATE cold_storage_users SET cold_storage_id=$1 WHERE id=$2`, [`${id}_other`, `${id}_user`]);
  assert.deepEqual(await list(), [], "Sauda read leaked another tenant");
  await save(lotB, 10, foreign, 404);
  console.log("Sauda: isolated writes, bounds/stale recheck, live/blank initials, tenant/viewer restrictions, replacement, atomic finalization, original-sale exits and Sale Edit/payment locks passed.");
} finally {
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  await cleanup();
  await serverPool?.end();
}
