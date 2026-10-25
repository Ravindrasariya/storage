// Real API/persistence checks. The shared fixture guard verifies local Helium
// before opening a connection; never run synthetic mutations on remote data.
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { auth, cleanup, id, lot, pool, setup } from "./tulai-fixtures.mts";

process.env.TZ = "Asia/Kolkata";
const app = express();
app.use(express.json());
const server = createServer(app);
let serverPool: { end(): Promise<void> } | undefined;
const otherToken = `${id}_other_session`;
const otherUser = `${id}_other_user`;
try {
  const { initializeBillsArchive } = await import("../server/bills-archive.ts");
  await initializeBillsArchive();
  const { registerRoutes } = await import("../server/routes.ts");
  serverPool = (await import("../server/db.ts")).pool;
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await setup();
  await pool.query(`INSERT INTO cold_storage_users
    (id,cold_storage_id,name,mobile_number,password,access_type)
    VALUES ($1,$2,'Foreign operator','0000000000','fixture','view')`, [otherUser, `${id}_other`]);
  await pool.query(`INSERT INTO user_sessions (id,user_id,cold_storage_id)
    VALUES ($1,$2,$3)`, [otherToken, otherUser, `${id}_other`]);
  const otherAuth = { ...auth, "x-auth-token": otherToken };
  async function api(path: string, body?: unknown, method = "GET", expected = 200, headers: Record<string, string> = auth) {
    const res = await fetch(base + path, { method, headers, ...(body == null ? {} : { body: JSON.stringify(body) }) });
    const data = await res.text();
    assert.equal(res.status, expected, `${method} ${path}: ${data}`);
    return data && res.headers.get("content-type")?.includes("application/json") ? JSON.parse(data) : data;
  }
  const list = (kind: string) => api(`/api/bills-archive/${kind}`);
  async function sell(name: string) {
    const lotId = await lot(name);
    await api(`/api/lots/${lotId}/partial-sale`, {
      quantitySold: 10, pricePerBag: 60, paymentStatus: "due", paidAmount: 0,
      isSelfSale: true, chargeBasis: "actual", soldAt: "2016-06-15",
      remarks: `Archive ${name} <b>literal</b>`, tulaiCharges: 25,
    }, "POST");
    return (await pool.query(`SELECT * FROM sales_history WHERE lot_id=$1`, [lotId])).rows[0];
  }
  async function exit(saleId: string, bags: number, date: string) {
    await api(`/api/sales-history/${saleId}/exits`, { bagsExited: bags, exitDate: date }, "POST", 201);
    return (await pool.query(`SELECT * FROM exit_history WHERE sales_history_id=$1 ORDER BY created_at DESC LIMIT 1`, [saleId])).rows[0];
  }
  async function activeSnapshot() {
    const result: Record<string, unknown> = {};
    for (const table of ["sales_history", "exit_history", "lots", "cash_receipts", "cash_receipt_applications", "chambers", "buyer_ledger", "farmer_ledger"]) {
      result[table] = (await pool.query(`SELECT * FROM ${table} WHERE cold_storage_id=$1 ORDER BY id`, [id])).rows;
    }
    return result;
  }
  const sale = await sell("standalone");
  const firstExit = await exit(sale.id, 3, "2016-06-15");
  const latestExit = await exit(sale.id, 2, "2016-06-16");
  const baselineLot = (await pool.query(`SELECT * FROM lots WHERE id=$1`, [sale.lot_id])).rows[0];
  const baselineActive = await activeSnapshot();
  await initializeBillsArchive();
  await initializeBillsArchive();
  assert.deepEqual(await activeSnapshot(), baselineActive, "Archive initialization mutated existing business rows");
  assert.equal((await list("sales")).length, 0);
  assert.equal((await list("exits")).length, 0, "Active entries appeared in archive");
  await api("/api/bills-archive/sales", undefined, "GET", 401, {});
  await api(`/api/sales-history/${sale.id}/reverse`, {}, "POST", 403, otherAuth);
  assert.equal((await list("sales")).length, 0, "Denied reversal was archived");
  await pool.query(`INSERT INTO cash_receipts
    (id,cold_storage_id,payer_type,receipt_type,amount,received_at,applies_to_sale_id)
    VALUES ($1,$2,'cold_merchant','cash',1,NOW(),$3)`, [`${id}_blocking_receipt`, id, sale.id]);
  const blockedBefore = await activeSnapshot();
  await api(`/api/sales-history/${sale.id}/reverse`, {}, "POST", 400);
  assert.equal((await list("sales")).length, 0, "Blocked reversal was archived");
  assert.deepEqual(await activeSnapshot(), blockedBefore);
  await pool.query(`DELETE FROM cash_receipts WHERE id=$1`, [`${id}_blocking_receipt`]);

  await api(`/api/sales-history/${sale.id}/exits/reverse-latest`, {}, "POST");
  let exits = await list("exits");
  assert.equal(exits.length, 1);
  const snapshot = exits[0];
  assert.equal(snapshot.id, latestExit.id, "Wrong latest exit archived");
  assert.equal(snapshot.operatorName, "Tulai Operator");
  assert.equal(snapshot.source, "reversal");
  assert.equal(snapshot.display.bagsExited, 2);
  assert.equal(snapshot.sale.remarks, sale.remarks);
  const softExit = (await pool.query(`SELECT * FROM exit_history WHERE id=$1`, [latestExit.id])).rows[0];
  assert.equal(softExit.is_reversed, 1, "Existing soft reversal was not preserved");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM sales_history WHERE id=$1`, [sale.id])).rows[0].n, 1);
  assert.deepEqual((await pool.query(`SELECT * FROM lots WHERE id=$1`, [sale.lot_id])).rows[0], baselineLot,
    "Standalone exit reversal changed financial/stock lot data");
  assert.deepEqual(await api(`/api/bills-archive/exits/${snapshot.id}`), snapshot);
  await api(`/api/bills-archive/exits/${snapshot.id}`, undefined, "GET", 404, otherAuth);
  assert.equal((await api("/api/bills-archive/exits", undefined, "GET", 200, otherAuth)).length, 0);

  await api(`/api/sales-history/${sale.id}/reverse`, {}, "POST");
  const archivedSales = await list("sales");
  assert.equal(archivedSales.length, 1);
  assert.equal(archivedSales[0].id, sale.id);
  assert.equal(archivedSales[0].display.coldStorageCharge, sale.cold_storage_charge);
  assert.equal(archivedSales[0].display.tulaiCharges, 25);
  assert.equal(archivedSales[0].sale.quantitySold, sale.quantity_sold);
  assert.equal(archivedSales[0].sale.coldStorageBillNumber, sale.cold_storage_bill_number);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM sales_history WHERE id=$1`, [sale.id])).rows[0].n, 0,
    "Existing sale hard deletion was not preserved");
  exits = await list("exits");
  assert.equal(exits.length, 2);
  assert.deepEqual(exits.find((row: any) => row.id === latestExit.id), snapshot,
    "Previously reversed exit snapshot was overwritten on sale reversal");
  assert.equal(exits.find((row: any) => row.id === firstExit.id).sale.id, sale.id);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM exit_history WHERE sales_history_id=$1 AND is_reversed=1`, [sale.id])).rows[0].n, 2);
  const restoredLot = (await pool.query(`SELECT * FROM lots WHERE id=$1`, [sale.lot_id])).rows[0];
  assert.equal(restoredLot.remaining_size, baselineLot.remaining_size + sale.quantity_sold);
  assert.equal(restoredLot.total_paid_charge, Math.max(0, (baselineLot.total_paid_charge || 0) - (sale.paid_amount || 0)));
  assert.equal(restoredLot.total_due_charge, Math.max(0, (baselineLot.total_due_charge || 0) - (sale.due_amount || 0)));
  assert.equal((await api("/api/sales-history")).length, 0);
  assert.equal((await api("/api/exit-register")).rows.length, 0);
  const afterReverse = await activeSnapshot();
  await api(`/api/sales-history/${sale.id}/reverse`, {}, "POST", 404);
  assert.deepEqual(await activeSnapshot(), afterReverse);
  assert.equal((await list("sales")).length, 1, "Repeat reversal duplicated sale archive");

  // Same numeric bill in the same entry series may be reused after reversal:
  // archive must not change allocation or merge old/new records.
  const next = await sell("reused");
  assert.equal(next.cold_storage_bill_number, sale.cold_storage_bill_number);
  const nextExit = await exit(next.id, 1, "2016-06-17");
  assert.equal(nextExit.bill_number, firstExit.bill_number);
  await api(`/api/sales-history/${next.id}/reverse`, {}, "POST");
  assert.equal((await list("sales")).length, 2);
  assert.equal((await list("exits")).length, 3);
  const activeBeforeReads = await activeSnapshot();
  await list("sales"); await list("exits");
  assert.deepEqual(await activeSnapshot(), activeBeforeReads, "Archive reads changed accounting rows");

  // An orphaned retained historical exit has no recoverable sale charges.
  const orphanId = `${id}_legacy_exit`;
  await pool.query(`INSERT INTO exit_history
    (id,sales_history_id,lot_id,cold_storage_id,bags_exited,bill_number,exit_date,is_reversed,reversed_at)
    VALUES ($1,'already-deleted-sale',$2,$3,4,77,'2015-12-31 12:00:00',1,NULL)`, [orphanId, sale.lot_id, id]);
  const beforeBackfill = await activeSnapshot();
  await initializeBillsArchive(); await initializeBillsArchive();
  assert.deepEqual(await activeSnapshot(), beforeBackfill, "Legacy copy altered source rows");
  const legacy = (await list("exits")).find((row: any) => row.id === orphanId);
  assert.ok(legacy);
  assert.equal(legacy.sale, null);
  assert.equal(legacy.source, "legacy");
  assert.equal(legacy.reversedAt, null, "Unknown reversal time was fabricated");
  assert.equal(legacy.display.bagsExited, 4);
  assert.equal(legacy.display.billNumber, 77);
  assert.equal(legacy.display.coldStorageCharge, undefined);
  assert.equal(legacy.display.buyerName, undefined);
  assert.equal((await list("sales")).length, 2, "Missing legacy sale was fabricated");
  await api(`/api/bills-archive/sales/${sale.id}`, undefined, "GET", 404, otherAuth);
  await api(`/api/bills-archive/sales/${sale.id}`, {}, "POST", 404);

  // Force an archive-only write failure using a transaction-local helper runner.
  // Verify the deleted source row rolls back instead of disappearing untracked.
  const rollbackSale = await sell("rollback");
  assert.match(rollbackSale.id, /^[A-Za-z0-9_]+$/);
  const rollbackExit = await exit(rollbackSale.id, 2, "2016-06-18");
  const beforeFailedArchive = await activeSnapshot();
  const constraint = `archive_test_${process.pid}`;
  try {
    // Reject ONLY our synthetic row in the NEW archive table. No alteration
    // of an existing business table, and no global failure for other tenants.
    await pool.query(`ALTER TABLE reversed_sales_archive ADD CONSTRAINT ${constraint}
      CHECK (id <> '${rollbackSale.id}')`);
    await api(`/api/sales-history/${rollbackSale.id}/reverse`, {}, "POST", 500);
    assert.deepEqual(await activeSnapshot(), beforeFailedArchive,
      "Archive failure partly changed source stock, exits or payment data");
    assert.ok(!(await list("exits")).some((row: any) => row.id === rollbackExit.id),
      "Failed sale reversal left a cascaded archive row behind");
  } finally {
    await pool.query(`ALTER TABLE reversed_sales_archive DROP CONSTRAINT IF EXISTS ${constraint}`);
  }
  assert.equal((await pool.query(`SELECT count(*)::int n FROM sales_history WHERE id=$1`, [rollbackSale.id])).rows[0].n, 1);
  assert.ok(!(await list("sales")).some((row: any) => row.id === rollbackSale.id));
  console.log("PASS: archive isolation, source preservation, standalone/cascaded snapshots, legacy orphans, idempotency, reused bills, rollback and tenant/role API guards");
} finally {
  await pool.query(`DELETE FROM user_sessions WHERE id=$1`, [otherToken]).catch(() => {});
  await pool.query(`DELETE FROM cold_storage_users WHERE id=$1`, [otherUser]).catch(() => {});
  await cleanup();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await serverPool?.end();
}
