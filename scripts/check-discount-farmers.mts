import assert from "node:assert/strict";
import { filterDiscountFarmers, sortedDiscountFarmers } from "../client/src/lib/discount-farmers.ts";

export const farmerRows = [
  { id: "z", farmerName: "Zubin", village: "South", contactNumber: "9000000001", totalDue: 100 },
  { id: "b", farmerName: "bala", village: "West", contactNumber: "9000000002", totalDue: 200 },
  { id: "a2", farmerName: "Arun", village: "East", contactNumber: "9000000004", totalDue: 300 },
  { id: "a1", farmerName: "arun", village: "East", contactNumber: "9000000003", totalDue: 400 },
  { id: "a0", farmerName: "Arun", village: "Central", contactNumber: "9000000005", totalDue: 1 },
  { id: "h2", farmerName: "सीता", village: "उज्जैन", contactNumber: "9000000006", totalDue: 500 },
  { id: "h1", farmerName: "अजय", village: "देवास", contactNumber: "9000000007", totalDue: 600 },
  { id: "zero", farmerName: "AAA excluded", village: "Central", contactNumber: "9000000008", totalDue: 0 },
  { id: "fraction", farmerName: "AAA excluded", village: "Central", contactNumber: "9000000009", totalDue: 0.99 },
].map(row => ({ ...row, pyReceivables: row.totalDue, advanceDue: 0, freightDue: 0, selfDue: 0, merchantDue: 0 }));

const original = JSON.stringify(farmerRows);
const frozen = Object.freeze(farmerRows.map(row => Object.freeze({ ...row })));
for (const locale of ["en", "hi"]) {
  const sorted = sortedDiscountFarmers(frozen, locale);
  assert.equal(sorted.length, 7);
  const compare = new Intl.Collator(locale, { sensitivity: "base", numeric: true }).compare;
  for (let n = 1; n < sorted.length; n++) assert.ok(compare(sorted[n - 1].farmerName, sorted[n].farmerName) <= 0);
  assert.deepEqual(sorted.filter(row => row.farmerName.toLowerCase() === "arun").map(row => row.id), ["a0", "a1", "a2"]);
  assert.deepEqual(sortedDiscountFarmers([...frozen].reverse(), locale), sorted, "Order depends on API order");
  const ids = (query: string) => filterDiscountFarmers(sorted, query, locale).map(row => row.id);
  assert.deepEqual(ids("  ARUN  "), ["a0", "a1", "a2"]);
  assert.deepEqual(ids("west"), ["b"]);
  assert.deepEqual(ids("000000004"), ["a2"]);
  assert.deepEqual(ids("सीता"), ["h2"]);
  assert.deepEqual(ids("उज्जैन"), ["h2"]);
  assert.deepEqual(ids("  "), sorted.map(row => row.id));
  assert.deepEqual(ids("no match"), []);
  assert.deepEqual(ids("excluded"), []);
  const duplicates = [{ ...frozen[0], id: "same-b" }, { ...frozen[0], id: "same-a" }];
  assert.deepEqual(sortedDiscountFarmers(duplicates, locale).map(row => row.id), ["same-a", "same-b"]);
}
assert.equal(JSON.stringify(farmerRows), original, "Cached input was mutated");
assert.deepEqual(sortedDiscountFarmers([], "en"), []);
console.log("Discount farmer sorting/filtering passed: eligibility, case, Hindi, whitespace, stable ties, searches and immutable input.");
