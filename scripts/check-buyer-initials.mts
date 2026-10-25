// Real HTTP/save/readback checks, restricted to the verified development database.
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { auth, cleanup, id, pool, setup } from "./tulai-fixtures.mts";

const app = express();
app.use(express.json());
const server = createServer(app);
let serverPool: { end: () => Promise<void> } | undefined;
try {
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
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  const create = (body: object) => request("/api/buyer-ledger/manual", body, "POST", 201);
  const read = async (buyerId: string) =>
    (await pool.query("SELECT * FROM buyer_ledger WHERE id=$1", [buyerId])).rows[0];
  const update = (buyerId: string, body: object) => request(`/api/buyer-ledger/${buyerId}`, body, "PATCH");
  const buyer = await create({ buyerName: "Roop Laxmi Traders", initials: "  rLt  " });
   assert.equal((await read(buyer.id)).initials, "RLT");
  const ledger = await request("/api/buyer-ledger", undefined, "GET");
   assert.equal(ledger.buyers.find((b: any) => b.id === buyer.id).initials, "RLT");
  const before = await read(buyer.id);
   await update(buyer.id, { initials: "  आर  " });
   assert.deepEqual(await read(buyer.id), { ...before, initials: "आर" });
  const history = await request(`/api/buyer-ledger/${buyer.id}/history`, undefined, "GET");
  assert.equal(history.length, 1);
   assert.equal(JSON.parse(history[0].beforeValues).initials, "RLT");
   assert.equal(JSON.parse(history[0].afterValues).initials, "आर");
  await update(buyer.id, { address: "Market" }); // Older callers omit initials.
   assert.equal((await read(buyer.id)).initials, "आर");
   await update(buyer.id, { initials: " abcd " });
   assert.equal((await read(buyer.id)).initials, "ABCD");
   await update(buyer.id, { initials: "ßa" });
   assert.equal((await read(buyer.id)).initials, "SSA");
   for (const overlong of ["abcde", " abcdE ", "ßßa"]) {
     const saved = await read(buyer.id);
     const oldHistory = await request(`/api/buyer-ledger/${buyer.id}/history`, undefined, "GET");
     for (const [path, method, body] of [
       ["/api/buyer-ledger/manual", "POST", { buyerName: "Overlong", initials: overlong }],
       [`/api/buyer-ledger/${buyer.id}`, "PATCH", { initials: overlong }],
     ] as const) {
       const failure = await request(path, body, method, 400);
       assert.match(failure.error, /at most 4/);
       assert.equal(failure.details[0].path[0], "initials");
     }
     assert.deepEqual(await read(buyer.id), saved);
     assert.deepEqual(await request(`/api/buyer-ledger/${buyer.id}/history`, undefined, "GET"), oldHistory);
   }
   const four = await create({ buyerName: "Four Characters", initials: " abcd " });
   assert.equal((await read(four.id)).initials, "ABCD");
  for (const blank of ["   ", null, ""]) {
    await update(buyer.id, { initials: blank });
    assert.equal((await read(buyer.id)).initials, null);
  }
  const legacy = await create({ buyerName: "Legacy Buyer" });
  assert.equal((await read(legacy.id)).initials, null);
   await pool.query("UPDATE buyer_ledger SET initials='LegacyLong' WHERE id=$1", [legacy.id]);
   await update(legacy.id, { address: "Legacy address" });
   assert.equal((await read(legacy.id)).initials, "LegacyLong");
   await request(`/api/buyer-ledger/${legacy.id}`, { initials: "LegacyLong" }, "PATCH", 400);
   assert.equal((await read(legacy.id)).initials, "LegacyLong");
   await update(legacy.id, { initials: "lgcy" });
   assert.equal((await read(legacy.id)).initials, "LGCY");
  const duplicate = await create({ buyerName: "Another Buyer", initials: "rLt" });
   await request("/api/buyer-ledger/manual", { buyerName: " roop laxmi traders ", initials: "Othr" }, "POST", 409);
  for (const invalid of [4, {}, []]) {
    await request("/api/buyer-ledger/manual", { buyerName: "Invalid", initials: invalid }, "POST", 400);
    await request(`/api/buyer-ledger/${buyer.id}`, { initials: invalid }, "PATCH", 400);
  }
   await update(buyer.id, { initials: "Srce" });
   const changes = { buyerName: "Another Buyer", initials: "New" };
  const mergeCheck = await request(`/api/buyer-ledger/${buyer.id}/check-merge`, changes);
  assert.equal(mergeCheck.willMerge, true);
  const pending = await update(buyer.id, changes);
  assert.equal(pending.needsConfirmation, true);
  const merged = await update(buyer.id, { ...changes, confirmMerge: true });
  assert.equal(merged.merged, true);
   assert.equal((await read(duplicate.id)).initials, "RLT");
  assert.equal((await read(buyer.id)).is_archived, 1);
  await request("/api/buyer-ledger/manual", { buyerName: "Denied", initials: "D" }, "POST", 401, { ...auth, "x-auth-token": "" });
  await pool.query("UPDATE cold_storage_users SET access_type='view' WHERE id=$1", [`${id}_user`]);
  await request("/api/buyer-ledger/manual", { buyerName: "Denied", initials: "D" }, "POST", 403);
  await request(`/api/buyer-ledger/${legacy.id}`, { initials: "D" }, "PATCH", 403);
  console.log("Buyer initials API checks passed: persistence, list/readback, trim/case, clear, legacy omission, history, duplicates, validation, merge destination, permissions.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.query("DELETE FROM buyer_ledger_edit_history WHERE cold_storage_id IN ($1,$2)", [id, `${id}_other`]);
  await pool.query("DELETE FROM daily_id_counters WHERE starts_with(id, $1)", [`buyer_${id}_`]);
  await cleanup();
  await serverPool?.end();
}
