// Exercise the real summary query/projection without connecting to any database.
import assert from "node:assert/strict";
import { db, pool } from "../server/db.ts";
import { DatabaseStorage } from "../server/storage.ts";
import { salesHistory, buyerLedger, exitHistory } from "../shared/schema.ts";

const originalSelect = db.select;
const originalQuery = pool.query;
const originalConnect = pool.connect;
const calls: Array<{ table: unknown; fields: Record<string, unknown>; sql: string; params: unknown[] }> = [];
let sales: any[] = ["due", "paid", "partial", null].map((paymentStatus, index) => ({
  id: `sale-${index}`, lotId: "lot", soldAt: new Date("2026-10-01T00:00:00Z"),
  quantitySold: 10, coldStorageBillNumber: 22 + index,
  isSelfSale: index === 1 ? 1 : 0, buyerLedgerId: "buyer", buyerName: "Buyer",
  paymentStatus,
}));
const blockedConnection = () => { throw new Error("Database access forbidden in PS contract test"); };
(pool as any).query = blockedConnection;
(pool as any).connect = blockedConnection;
(db as any).select = (fields: Record<string, unknown>) => {
  const builder = originalSelect.call(db, fields as any);
  const from = builder.from.bind(builder);
  (builder as any).from = (table: any) => {
    const query = from(table);
    (query as any).execute = async () => {
      const { sql, params } = query.toSQL();
      calls.push({ table, fields, sql, params });
      const fixtures = table === salesHistory ? sales
        : table === buyerLedger ? [{ id: "buyer", buyerName: "Buyer", initials: "BY" }]
        : table === exitHistory ? [{
          salesHistoryId: "sale-2", exitDate: new Date("2026-10-02T00:00:00Z"), billNumber: 44, bagsExited: 4,
        }] : assert.fail("Unexpected table");
      // Return only projected properties, catching accidental missing fields.
      return fixtures.map(row => Object.fromEntries(Object.keys(fields).map(key => [key, row[key]])));
    };
    return query;
  };
  return builder;
};
try {
  const storage = new DatabaseStorage();
  const result = await storage.getSalesWithExitsByLotIds("tenant-fixture", ["lot", "unsold"]);
  assert.deepEqual(result.lot.map(sale => sale.paymentStatus), ["due", "paid", "partial", null]);
  assert.deepEqual(result.unsold, []);
  assert.equal(result.lot[1].isSelfSale, 1);
  assert.equal(result.lot[1].buyerInitials, null);
  assert.equal(result.lot[0].buyerInitials, "BY");
  assert.equal(result.lot[2].totalExited, 4);
  assert.equal(result.lot[2].exits[0].billNumber, 44);
  assert.equal(calls.length, 3, "Keep constant batched queries, never per-sale requests");
  assert.equal(calls[0].fields.paymentStatus, salesHistory.paymentStatus);
  for (const call of calls) {
    assert.ok(call.params.includes("tenant-fixture"), "Every summary query remains tenant-scoped");
    assert.match(call.sql, /cold_storage_id/);
  }
  assert.ok(calls[0].params.includes("lot") && calls[0].params.includes("unsold"));
  assert.match(calls[0].sql, /order by "sales_history"\."sold_at" asc/);
  assert.match(calls[2].sql, /"exit_history"\."is_reversed" = /);
  sales[0].paymentStatus = "paid";
  assert.equal((await storage.getSalesWithExitsByLotIds("tenant-fixture", ["lot"])).lot[0].paymentStatus, "paid");
  sales = [];
  const before = calls.length;
  assert.deepEqual(await storage.getSalesWithExitsByLotIds("tenant-fixture", ["unsold"]), { unsold: [] });
  assert.equal(calls.length, before + 1, "No unnecessary buyer/exit reads without sales");
  const after = calls.length;
  assert.deepEqual(await storage.getSalesWithExitsByLotIds("tenant-fixture", []), {});
  assert.equal(calls.length, after);
  console.log("Stock PS summary checks passed: authoritative status projection, null preservation, fresh reads, tenant-scoped batched SQL, Self/MR and exit preservation, unsold/empty cases. Database access blocked.");
} finally {
  db.select = originalSelect;
  pool.query = originalQuery;
  pool.connect = originalConnect;
  await pool.end();
}
