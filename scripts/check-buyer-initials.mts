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
  assert.equal((await read(buyer.id)).initials, "rLt");
  const ledger = await request("/api/buyer-ledger", undefined, "GET");
  assert.equal(ledger.buyers.find((b: any) => b.id === buyer.id).initials, "rLt");
  const before = await read(buyer.id);
  await update(buyer.id, { initials: "  आरएलटी  " });
  assert.deepEqual(await read(buyer.id), { ...before, initials: "आरएलटी" });
  const history = await request(`/api/buyer-ledger/${buyer.id}/history`, undefined, "GET");
  assert.equal(history.length, 1);
  assert.equal(JSON.parse(history[0].beforeValues).initials, "rLt");
  assert.equal(JSON.parse(history[0].afterValues).initials, "आरएलटी");
  await update(buyer.id, { address: "Market" }); // Older callers omit initials.
  assert.equal((await read(buyer.id)).initials, "आरएलटी");
  for (const blank of ["   ", null, ""]) {
    await update(buyer.id, { initials: blank });
    assert.equal((await read(buyer.id)).initials, null);
  }
  const legacy = await create({ buyerName: "Legacy Buyer" });
  assert.equal((await read(legacy.id)).initials, null);
  const duplicate = await create({ buyerName: "Another Buyer", initials: "rLt" });
  await request("/api/buyer-ledger/manual", { buyerName: " roop laxmi traders ", initials: "Other" }, "POST", 409);
  for (const invalid of [4, {}, []]) {
    await request("/api/buyer-ledger/manual", { buyerName: "Invalid", initials: invalid }, "POST", 400);
    await request(`/api/buyer-ledger/${buyer.id}`, { initials: invalid }, "PATCH", 400);
  }
  await update(buyer.id, { initials: "Source" });
  const changes = { buyerName: "Another Buyer", initials: "Do not overwrite target" };
  const mergeCheck = await request(`/api/buyer-ledger/${buyer.id}/check-merge`, changes);
  assert.equal(mergeCheck.willMerge, true);
  const pending = await update(buyer.id, changes);
  assert.equal(pending.needsConfirmation, true);
  const merged = await update(buyer.id, { ...changes, confirmMerge: true });
  assert.equal(merged.merged, true);
  assert.equal((await read(duplicate.id)).initials, "rLt");
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
