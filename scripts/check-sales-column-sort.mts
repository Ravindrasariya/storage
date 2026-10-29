import assert from "node:assert/strict";
import { nextSalesSort, sortSalesHistory } from "../client/src/lib/sales-history-sort.ts";

export const rows = [
  { id: "a", soldAt: "2026-09-30T06:30:00Z", farmerName: "Beta", coldStorageCharge: 1000.5 },
  { id: "b", soldAt: "2026-10-02T06:30:00Z", farmerName: "arun", coldStorageCharge: 90.25 },
  { id: "c", soldAt: "2026-10-01T06:30:00Z", farmerName: "ARUN", coldStorageCharge: 900.5 },
  { id: "d", soldAt: "2026-10-02T06:30:00Z", farmerName: "सीता", coldStorageCharge: 90.25 },
  { id: "e", soldAt: "2026-10-01T06:30:00Z", farmerName: "अरुण", coldStorageCharge: 1000.05 },
];
const frozen = Object.freeze(rows.map(row => Object.freeze({ ...row })));
const ids = (values: readonly { id: string }[]) => values.map(row => row.id);
assert.deepEqual(ids(sortSalesHistory(frozen, null, "en")), ["a", "b", "c", "d", "e"]);
for (const language of ["en", "hi"]) {
  assert.deepEqual(ids(sortSalesHistory(frozen, { field: "soldAt", direction: "desc" }, language)), ["b", "d", "c", "e", "a"]);
  assert.deepEqual(ids(sortSalesHistory(frozen, { field: "soldAt", direction: "asc" }, language)), ["a", "c", "e", "b", "d"]);
  assert.deepEqual(ids(sortSalesHistory(frozen, { field: "coldStorageCharge", direction: "desc" }, language)), ["a", "e", "c", "b", "d"]);
  assert.deepEqual(ids(sortSalesHistory(frozen, { field: "coldStorageCharge", direction: "asc" }, language)), ["b", "d", "c", "e", "a"]);
  const collator = new Intl.Collator(language, { sensitivity: "base" });
  for (const direction of ["asc", "desc"] as const) {
    const sorted = sortSalesHistory(frozen, { field: "farmerName", direction }, language);
    for (let index = 1; index < sorted.length; index++) {
      assert.ok(collator.compare(sorted[index - 1].farmerName, sorted[index].farmerName) * (direction === "asc" ? 1 : -1) <= 0);
    }
    assert.ok(ids(sorted).indexOf("b") < ids(sorted).indexOf("c"), "Case-insensitive ties preserve original order");
  }
}
for (const field of ["soldAt", "farmerName", "coldStorageCharge"] as const) {
  const first = nextSalesSort(null, field);
  assert.equal(first.direction, field === "farmerName" ? "asc" : "desc");
  assert.notEqual(nextSalesSort(first, field).direction, first.direction);
  assert.deepEqual(nextSalesSort({ field: field === "soldAt" ? "farmerName" : "soldAt", direction: "asc" }, field), first);
}
assert.deepEqual(sortSalesHistory([], { field: "soldAt", direction: "desc" }, "en"), []);
assert.deepEqual(ids(frozen), ["a", "b", "c", "d", "e"]);
assert.notEqual(sortSalesHistory(frozen, null, "en"), frozen);
console.log("Sales column sorting passed: chronological dates, localized case-insensitive names, numeric decimals, stable ties, default order, direction transitions and immutable inputs.");
