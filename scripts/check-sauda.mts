// Real HTTP/DB checks; shared fixture boundary permits local Helium only.
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
  const edit = (lotId: string, saudaId: string, quantity: number, buyerLedgerId: string, expected = 200) =>
    api(`/api/lots/${lotId}/sauda/${encodeURIComponent(saudaId)}`, { quantity, buyerLedgerId }, "PATCH", expected);
  const before = await snapshot();
  assert.deepEqual(await list(), []);
  const first = await save(lotA, 50, buyerA);
  const second = await save(lotA, 25, buyerB);
  assert.notEqual(first.id, second.id);
  assert.equal((await list()).length, 2);
  assert.equal((await list()).find((s: any) => s.id === second.id).buyerInitials, null, "Blank initials must stay blank");
  await edit(lotA, second.id, 30, buyerA);
  assert.equal((await list()).find((s: any) => s.id === second.id).buyerLedgerId, buyerA);
  await edit(lotA, second.id, 25, buyerB);
  await edit(lotA, first.id, 76, buyerA, 409);
  await edit(lotB, first.id, 5, buyerA, 409);
  await edit(lotA, "missing", 5, buyerA, 409);
  await save(lotB, 50, buyerB);
  for (const quantity of [0, -1, 1.5, "10", null, {}, 2147483648]) await save(lotA, quantity, buyerA, 400);
  await save(lotA, 26, buyerA, 409);
  await save(lotA, 10, foreign, 400);
  await save(lotA, 10, randomUUID(), 400);
  await save(foreignLot, 10, buyerA, 404);
  await save("missing", 10, buyerA, 404);
  await api(`/api/lots/${lotA}/sauda`, { quantity: 10, buyerLedgerId: buyerA, kataCharges: 100 }, "POST", 400);
  await api(`/api/lots/${lotA}/sauda`, { quantity: 10, buyerLedgerId: buyerA }, "POST", 401, { "Content-Type": "application/json" });
  await api(`/api/lots/${lotA}/partial-sale`, { quantitySold: 10, buyerName: "New buyer" }, "POST", 410);
  await pool.query(`UPDATE cold_storage_users SET access_type='view' WHERE id=$1`, [`${id}_user`]);
  assert.equal((await list()).length, 3, "Viewers can read initials");
  await save(lotA, 10, buyerA, 403);
  await edit(lotA, first.id, 10, buyerA, 403);
  await api(`/api/lots/${lotA}/sauda`, undefined, "DELETE", 404);
  await pool.query(`UPDATE cold_storage_users SET access_type='edit' WHERE id=$1`, [`${id}_user`]);
  assert.deepEqual(await snapshot(), before, "Sauda mutated stock, billing, ledger, audit, archives or numbering");
  await pool.query(`UPDATE buyer_ledger SET initials='LIVE' WHERE id=$1`, [buyerA]);
  assert.equal((await list()).find((s: any) => s.id === first.id).buyerInitials, "LIVE");
  await assert.rejects(pool.query(`UPDATE lots SET remaining_size=20 WHERE id=$1`, [lotA]), /Open Sauda bags/);
  await assert.rejects(pool.query(`UPDATE lots SET size=70 WHERE id=$1`, [lotA]), /Open Sauda bags/);
  assert.equal((await list()).find((s: any) => s.id === first.id).quantity, 50);
  const batch = (rows: object[], buyerLedgerId = buyerB, extra: object = {}) =>
    ({ farmerLedgerId: farmerId, buyerLedgerId, exitDate: "2016-06-15", rows, ...extra });
  await api("/api/farmers/master-nikasi", batch([
    { lotId: lotA, soldBags: 100, exitBags: 3, saudaSelections: [{ saudaId: first.id, quantity: 50 }, { saudaId: second.id, quantity: 25 }] }, { lotId: lotB, soldBags: 101, exitBags: 1 },
  ]), "POST", 400);
  assert.equal((await list()).length, 3, "Failed batch discarded Sauda");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM sales_history WHERE cold_storage_id=$1`, [id])).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM sauda_sale_sources WHERE cold_storage_id=$1`, [id])).rows[0].n, 0);
  const convert = (soldBags: number, selections: object[], expected = 409) =>
    api("/api/farmers/master-nikasi", batch([{ lotId: lotA, soldBags, exitBags: 3, saudaSelections: selections }]), "POST", expected);
  await convert(40, []);
  await convert(40, [{ saudaId: first.id, quantity: 14 }]);
  await convert(40, [{ saudaId: first.id, quantity: 41 }]);
  await convert(40, [{ saudaId: first.id, quantity: 10 }, { saudaId: first.id, quantity: 10 }]);
  await convert(40, [{ saudaId: second.id, quantity: 26 }]);
  await convert(40, [{ saudaId: "missing", quantity: 20 }]);
  const foreignEntry = (await pool.query(`INSERT INTO lot_sauda (lot_id,cold_storage_id,buyer_ledger_id,quantity)
    VALUES ($1,$2,$3,10) RETURNING id`, [foreignLot, `${id}_other`, foreign])).rows[0];
  await convert(40, [{ saudaId: foreignEntry.id, quantity: 20 }]);
  const partial = await convert(40, [{ saudaId: first.id, quantity: 20 }], 201);
  assert.equal((await list()).find((s: any) => s.id === first.id).quantity, 30);
  assert.equal((await list()).find((s: any) => s.id === second.id).quantity, 25);
  assert.equal(partial.sales[0].saudaSources[0].buyerLedgerId, buyerA);
  const attribution = (await pool.query(`SELECT * FROM sauda_sale_sources WHERE sale_id=$1`, [partial.sales[0].saleId])).rows[0];
  assert.equal(attribution.quantity, 20);
  assert.equal(attribution.buyer_ledger_id, buyerA);
  await save(lotA, 6, buyerA, 409);
  await edit(lotA, first.id, 36, buyerA, 409);
  // Unassigned-only sale, followed by explicitly consuming both entries.
  await convert(5, [], 201);
  const finalized = await convert(55, [{ saudaId: first.id, quantity: 30 }, { saudaId: second.id, quantity: 25 }], 201);
  await edit(lotA, first.id, 1, buyerA, 409);
  assert.equal((await list()).length, 1);
  assert.equal((await list())[0].lotId, lotB, "Finalizing one lot cleared another marker");
  const saleId = finalized.sales[0].saleId;
  const sale = await api(`/api/sales-history/${saleId}`, undefined, "GET");
  assert.equal(sale.buyerLedgerId, buyerB, "Promised buyer overrode explicit final buyer");
  assert.equal(sale.quantitySold, 55);
  assert.equal((await pool.query(`SELECT remaining_size FROM lots WHERE id=$1`, [lotA])).rows[0].remaining_size, 0);
  await api(`/api/sales-history/${saleId}/exits`, { bagsExited: 52, exitDate: "2016-06-16" }, "POST", 201);
  await api(`/api/sales-history/${saleId}/exits`, { bagsExited: 1, exitDate: "2016-06-16" }, "POST", 400);
  await api(`/api/sales-history/${saleId}`, { remarks: "Sale Edit remains active", tulaiCharges: 25 }, "PATCH");
  await api(`/api/sales/${saleId}/manual-payment`, { receiptType: "cash", amount: 10, receivedAt: "2016-06-16" });
  await api(`/api/sales-history/${saleId}`, { remarks: "Must remain locked" }, "PATCH", 400);
  // Tenant serialization must cover both create/create and create/actual-sale.
  const raceLot = await lot("race");
  const raced = await Promise.all([60, 60].map(quantity => fetch(base + `/api/lots/${raceLot}/sauda`,
    { method: "POST", headers: auth, body: JSON.stringify({ quantity, buyerLedgerId: buyerA }) })));
  assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
  const race2 = await lot("race-sale");
  const raceResults = await Promise.all([
    fetch(base + `/api/lots/${race2}/sauda`, { method: "POST", headers: auth, body: JSON.stringify({ quantity: 80, buyerLedgerId: buyerA }) }),
    fetch(base + "/api/farmers/master-nikasi", { method: "POST", headers: auth, body: JSON.stringify(batch([{ lotId: race2, soldBags: 30, exitBags: 1 }])) }),
  ]);
  assert.equal(raceResults.filter(r => r.ok).length, 1);
  const existing = await save(await lot("race-convert"), 100, buyerA);
  const racePayload = batch([{ lotId: existing.lotId, soldBags: 60, exitBags: 1, saudaSelections: [{ saudaId: existing.id, quantity: 60 }] }]);
  const competing = await Promise.all([1, 2].map(() => fetch(base + "/api/farmers/master-nikasi",
    { method: "POST", headers: auth, body: JSON.stringify(racePayload) })));
  assert.equal(competing.filter(r => r.ok).length, 1);
  assert.equal((await list()).find((s: any) => s.id === existing.id).quantity, 40);
  // Both migration variants are identical modulo comments/transaction wrapper,
  // and repeated startup/manual application cannot resurrect consumed entries.
  const normalizeSql = (s: string) => s.replace(/--[^\n]*/g, "").replace(/^\s*(BEGIN;|COMMIT;|SELECT pg_advisory_xact_lock\(726308458\);)\s*$/gm, "").replace(/\s+/g, " ").trim();
  const manual = readFileSync("scripts/sql/multiple-saudas-hostinger.sql", "utf8");
  assert.equal(normalizeSql(manual), normalizeSql(saudaMultiSql));
  const prior = await list();
  await pool.query(manual);
  await (await import("../server/sauda-migration.ts")).initializeSauda();
  assert.deepEqual(await list(), prior);
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
  console.log("Sauda: independent entries, exact edits, aggregate cap, selected partial/full conversion, source snapshots, rollback, concurrency, idempotent migration, tenant/access restrictions, legacy exits and Sale Edit/payment locks passed.");
} finally {
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  await cleanup();
  await serverPool?.end();
}
