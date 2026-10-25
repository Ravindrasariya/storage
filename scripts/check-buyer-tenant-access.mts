// Real HTTP/DB isolation checks using only verified development fixtures.
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { auth, cleanup, id, pool, setup } from "./tulai-fixtures.mts";

const app = express();
app.use(express.json());
const server = createServer(app);
const otherToken = `${id}_other_session`;
const otherUser = `${id}_other_user`;
const otherAuth = { ...auth, "x-auth-token": otherToken };
let serverPool: { end: () => Promise<void> } | undefined;
try {
  const { registerRoutes } = await import("../server/routes.ts");
  serverPool = (await import("../server/db.ts")).pool;
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await setup();
  await pool.query(`INSERT INTO cold_storage_users
    (id,cold_storage_id,name,mobile_number,password,access_type)
    VALUES ($1,$2,'Other fixture operator','0000000000','fixture','edit')`,
    [otherUser, `${id}_other`]);
  await pool.query(`INSERT INTO user_sessions (id,user_id,cold_storage_id)
    VALUES ($1,$2,$3)`, [otherToken, otherUser, `${id}_other`]);

  async function request(path: string, body?: unknown, method = "POST", status = 200, headers = auth) {
    const response = await fetch(base + path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  const create = (name: string, headers = auth) => request(
    "/api/buyer-ledger/manual", { buyerName: name, initials: "TEST" }, "POST", 201, headers,
  );
  const own = await create("Same Name");
  const ownTarget = await create("Merge Target");
  const foreign = await create("Same Name", otherAuth);
  const foreignTarget = await create("Merge Target", otherAuth);
  await request(`/api/buyer-ledger/${foreign.id}`, { address: "Private foreign address" }, "PATCH", 200, otherAuth);
  await request(`/api/buyer-ledger/${own.id}`, { address: "Private own address" }, "PATCH");
  // Seed dues so a forbidden confirmed merge would have financial effects.
  for (const [buyer, cs] of [[own, id], [foreign, `${id}_other`]] as const) {
    await pool.query(`INSERT INTO opening_receivables
      (id,cold_storage_id,year,payer_type,buyer_name,buyer_ledger_id,buyer_id,due_amount)
      VALUES ($1,$2,2026,'cold_merchant','Same Name',$3,$4,1250)`,
      [`${buyer.id}_receivable`, cs, buyer.id, buyer.buyerId]);
  }
  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const table of ["buyer_ledger", "buyer_ledger_edit_history", "opening_receivables",
      "sales_history", "cash_receipts", "cash_receipt_applications"]) {
      result[table] = (await pool.query(
        `SELECT * FROM ${table} WHERE cold_storage_id IN ($1,$2) ORDER BY id`, [id, `${id}_other`],
      )).rows;
    }
    return result;
  }
  const routes = (buyerId: string): Array<[string, string, unknown?]> => [
    [`/api/buyer-ledger/${buyerId}`, "PATCH", {
      buyerName: "Merge Target", initials: "HACK", address: "Changed",
      contactNumber: "1234567890", confirmMerge: true,
      coldStorageId: id, buyerLedgerId: own.id,
    }],
    [`/api/buyer-ledger/${buyerId}/check-merge`, "POST", { buyerName: "Merge Target" }],
    [`/api/buyer-ledger/${buyerId}/flag`, "POST", {}],
    [`/api/buyer-ledger/${buyerId}/archive`, "POST", {}],
    [`/api/buyer-ledger/${buyerId}/reinstate`, "POST", {}],
    [`/api/buyer-ledger/${buyerId}/history`, "GET"],
    [`/api/buyer-ledger/${buyerId}/transactions?fy=2026`, "GET"],
  ];
  const before = await snapshot();
  for (const [headers, deniedId] of [[auth, foreign.id], [otherAuth, own.id]] as const) {
    for (const [path, method, body] of routes(deniedId)) {
      const denied = await request(path, body, method, 404, headers);
      assert.deepEqual(denied, { error: "Buyer not found" });
      assert.deepEqual(await snapshot(), before, `Forbidden ${method} ${path} changed records`);
    }
    const list = await request("/api/buyer-ledger", undefined, "GET", 200, headers);
    assert.ok(!list.buyers.some((buyer: any) => buyer.id === deniedId));
  }
  // Unknown IDs are indistinguishable from IDs owned by another tenant.
  for (const [path, method, body] of routes(`${id}_missing_buyer`)) {
    assert.deepEqual(await request(path, body, method, 404), { error: "Buyer not found" });
  }
  // User-supplied tenant IDs in query/body must never override the session.
  await request(`/api/buyer-ledger/${foreign.id}?coldStorageId=${id}_other`,
    { initials: "HACK", coldStorageId: `${id}_other` }, "PATCH", 404);
  // Archived foreign records remain protected too.
  await request(`/api/buyer-ledger/${foreign.id}/archive`, {}, "POST", 200, otherAuth);
  const archivedSnapshot = await snapshot();
  await request(`/api/buyer-ledger/${foreign.id}/reinstate`, {}, "POST", 404);
  assert.deepEqual(await snapshot(), archivedSnapshot);
  await request(`/api/buyer-ledger/${foreign.id}/reinstate`, {}, "POST", 200, otherAuth);

  // Authorized operations still work, including history, transactions and merge.
  const history = await request(`/api/buyer-ledger/${own.id}/history`, undefined, "GET");
  assert.ok(history.length > 0);
  const transactions = await request(`/api/buyer-ledger/${own.id}/transactions?fy=2026`, undefined, "GET");
  assert.ok(Array.isArray(transactions.transactions));
  await request(`/api/buyer-ledger/${own.id}`, { initials: "PASS" }, "PATCH");
  const flag = await request(`/api/buyer-ledger/${own.id}/flag`, {});
  assert.ok(flag);
  await request(`/api/buyer-ledger/${own.id}/archive`, {});
  await request(`/api/buyer-ledger/${own.id}/reinstate`, {});
  const preview = await request(`/api/buyer-ledger/${own.id}/check-merge`, { buyerName: "Merge Target" });
  assert.equal(preview.willMerge, true);
  assert.equal(preview.targetBuyer.id, ownTarget.id);
  const merged = await request(`/api/buyer-ledger/${own.id}`,
    { buyerName: "Merge Target", initials: "PASS", confirmMerge: true }, "PATCH");
  assert.equal(merged.merged, true);
  const receivable = (await pool.query("SELECT buyer_ledger_id FROM opening_receivables WHERE id=$1",
    [`${own.id}_receivable`])).rows[0];
  assert.equal(receivable.buyer_ledger_id, ownTarget.id);
  assert.equal((await pool.query("SELECT buyer_ledger_id FROM opening_receivables WHERE id=$1",
    [`${foreign.id}_receivable`])).rows[0].buyer_ledger_id, foreign.id);
  assert.equal((await pool.query("SELECT is_archived FROM buyer_ledger WHERE id=$1",
    [foreignTarget.id])).rows[0].is_archived, 0);

  for (const [path, method, body] of routes(ownTarget.id)) {
    await request(path, body, method, 401, { ...auth, "x-auth-token": "" });
  }
  await pool.query("UPDATE cold_storage_users SET access_type='view' WHERE id=$1", [`${id}_user`]);
  for (const [path, method, body] of routes(ownTarget.id)) {
    await request(path, body, method, method === "GET" ? 200 : 403);
  }
  for (const suffix of ["history", "transactions?fy=2026"]) {
    await request(`/api/buyer-ledger/${foreign.id}/${suffix}`, undefined, "GET", 404);
  }
  console.log("Buyer tenant access checks passed: both directions, all seven ID endpoints, missing IDs, spoofed tenant IDs, unchanged foreign records/dues/history, same-store merge and edit, viewer reads and write denial, unauthenticated denial.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.query("DELETE FROM opening_receivables WHERE cold_storage_id IN ($1,$2)", [id, `${id}_other`]);
  await pool.query("DELETE FROM buyer_ledger_edit_history WHERE cold_storage_id IN ($1,$2)", [id, `${id}_other`]);
  await pool.query("DELETE FROM daily_id_counters WHERE starts_with(id,$1) OR starts_with(id,$2)",
    [`buyer_${id}_`, `buyer_${id}_other_`]);
  await pool.query("DELETE FROM user_sessions WHERE id=$1", [otherToken]);
  await pool.query("DELETE FROM cold_storage_users WHERE id=$1", [otherUser]);
  await cleanup();
  await serverPool?.end();
}
