#!/usr/bin/env tsx
// Real HTTP/DB regression check. Only this run's synthetic fixtures are removed.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const id = `__csv_choices_${Date.now()}_${process.pid}`;
const auth = { "x-auth-token": `${id}_session` };
const farmer = 'किसान, "राम"\nजी';
const village = ' गाँव, "A" ';
const kataHeaders = ["Sale Date", "Receipt #", "CS Bill #", "Exit Bill #", "Farmer Name", "Village", "Kata Charges"];

function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(cell); cell = ""; }
    else if (c === "\n" && !quoted) { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}

const app = express();
app.use(express.json());
const server = createServer(app);
try {
  const { registerRoutes } = await import("../server/routes.ts");
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const cs of [id, `${id}_other`]) {
    await pool.query(`INSERT INTO cold_storages
      (id,name,total_capacity,wafer_rate,seed_rate,linked_phones)
      VALUES ($1,'CSV Smoke',10000,100,100,'{}')`, [cs]);
  }
  await pool.query(`INSERT INTO cold_storage_users
    (id,cold_storage_id,name,mobile_number,password,access_type)
    VALUES ($1,$2,'CSV User',$3,'fixture','edit')`,
  [`${id}_user`, id, `9${Date.now().toString().slice(-9)}`]);
  await pool.query(`INSERT INTO user_sessions (id,user_id,cold_storage_id) VALUES ($1,$2,$3)`,
    [auth["x-auth-token"], `${id}_user`, id]);

  const fixtureRows = [
    // Receipt, date (IST), type, status, CS bill, kata, self, transfer, reversed.
    ["A", "2019-07-20T00:15:00+05:30", "seed", "due", 11, 75, 1, null, 0],
    ["B", "2019-08-21T12:00:00+05:30", "wafer", "paid", null, 0, 0, null, 0],
    ["C", "2020-07-20T12:00:00+05:30", "seed", "partial", 12, 25, 1, "Merchant", 0],
    ["D", "2019-07-22T12:00:00+05:30", "seed", "due", 11, 30, 1, "Merchant", 1],
  ] as const;
  for (const [receipt, date, type, status, bill, kata, self, transfer, reversed] of fixtureRows) {
    await pool.query(`INSERT INTO sales_history
      (id,cold_storage_id,lot_id,farmer_name,village,tehsil,district,state,
       contact_number,lot_no,chamber_name,floor,position,potato_type,bag_type,
       quality,original_lot_size,sale_type,quantity_sold,price_per_bag,
       cold_storage_charge,payment_status,sale_year,sold_at,cold_storage_bill_number,
       kata_charges,is_self_sale,buyer_name,transfer_to_buyer_name,is_transfer_reversed,exit_bill_numbers)
      VALUES ($1,$2,$3,$4,$5,'T','D','S','0001230000',$6,'C',0,'P','X',$7,
        'good',100,'partial',20,10,200,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [`${id}_${receipt}`, id, `${id}_lot`, receipt === "B" ? "Other Farmer" : farmer,
      receipt === "B" ? "Other Village" : village, receipt, type, status,
      Number(date.slice(0, 4)), date, bill, kata, self, self ? null : "Merchant",
      transfer, reversed, receipt === "A" ? "101, 102" : null]);
  }
  // A second tenant's matching sale must never leak into downloads.
  // Copy via explicit fields to avoid relying on column order.
  await pool.query(`INSERT INTO sales_history
    (id,cold_storage_id,lot_id,farmer_name,village,tehsil,district,state,contact_number,
     lot_no,chamber_name,floor,position,potato_type,bag_type,quality,original_lot_size,
     sale_type,quantity_sold,price_per_bag,cold_storage_charge,payment_status,sale_year,sold_at)
    SELECT $1,$2,lot_id,farmer_name,village,tehsil,district,state,contact_number,'LEAK',
      chamber_name,floor,position,potato_type,bag_type,quality,original_lot_size,
      sale_type,quantity_sold,price_per_bag,cold_storage_charge,payment_status,sale_year,sold_at
    FROM sales_history WHERE id=$3`, [`${id}_other_sale`, `${id}_other`, `${id}_A`]);

  async function download(type: string | undefined, filters: Record<string, string> = {}, language = "en") {
    const params = new URLSearchParams({ fromDate: "2000-01-01", toDate: "2099-12-31", language, ...filters });
    if (type) params.set("exportType", type);
    const response = await fetch(`${base}/api/export/sales?${params}`, { headers: auth });
    assert.equal(response.status, 200, await response.clone().text());
    return { text: await response.text(), filename: response.headers.get("content-disposition") };
  }
  const oldDefault = await download(undefined);
  const overall = await download("overall");
  assert.equal(overall.text, oldDefault.text, "Explicit Overall must preserve default CSV bytes");
  assert.equal(overall.filename, 'attachment; filename="sales_2000-01-01_to_2099-12-31.csv"');
  const full = parseCSV(overall.text);
  assert.equal(full[0].length, 44);
  const kata = await download("kata");
  assert.match(kata.filename!, /sales_kata_/);
  const slim = parseCSV(kata.text);
  assert.deepEqual(slim[0], kataHeaders);
  assert.equal(slim.length, 5, "One row per sale, not per exit, tenant scoped");
  const a = slim.find(row => row[1] === "A")!;
  assert.deepEqual(a.slice(1), ["A", "11", "101, 102", farmer, village, "75"]);
  assert.deepEqual(slim.find(row => row[1] === "B")!.slice(2, 4), ["", ""]);
  assert.equal(slim.find(row => row[1] === "B")![6], "0");
  assert.deepEqual(parseCSV((await download("kata", {}, "hi")).text)[0], kataHeaders);
  for (const row of slim.slice(1)) {
    const original = full.find(r => r[2] === row[1])!;
    assert.deepEqual(row, [0, 2, 3, 5, 7, 9, 24].map(i => original[i]), "Kata values match Overall projection");
  }

  const cases: Array<[Record<string, string>, string[]]> = [
    [{ year: "2019" }, ["A", "B", "D"]],
    [{ months: "7" }, ["A", "C", "D"]],
    [{ months: "7,8", days: "20,21" }, ["A", "B", "C"]],
    [{ days: "22" }, ["D"]],
    [{ farmerName: " किसान " }, ["A", "C", "D"]],
    [{ village: 'गाँव, "a"' }, ["A", "C", "D"]],
    [{ contactNumber: "123" }, ["A", "B", "C", "D"]],
    [{ buyerName: "Self" }, ["A", "D"]],
    [{ buyerName: "Merchant" }, ["B", "C"]],
    [{ bagType: "wafer" }, ["B"]],
    [{ paymentStatus: "due" }, ["A", "D"]],
    [{ paymentStatus: "partial" }, ["C"]],
    [{ paymentStatus: "paid" }, ["B"]],
    [{ coldStorageBillNumber: "11" }, ["A", "D"]],
    [{ year: "all", months: "7", days: "20" }, ["A", "C"]],
    [{ year: "2019", months: "7", days: "20", farmerName: "किसान", village: 'गाँव, "a"',
      contactNumber: "123", buyerName: "Self", bagType: "seed", paymentStatus: "due", coldStorageBillNumber: "11" }, ["A"]],
    [{ months: "12" }, []],
  ];
  for (const [filters, expected] of cases) {
    for (const type of ["overall", "kata"]) {
      const rows = parseCSV((await download(type, filters)).text);
      const receipts = rows.slice(1).map(row => row[type === "kata" ? 1 : 2]).sort();
      assert.deepEqual(receipts, expected, `${type}: ${JSON.stringify(filters)}`);
    }
  }
  const unauthorized = await fetch(`${base}/api/export/sales?fromDate=2000-01-01&toDate=2099-12-31&exportType=kata`);
  assert.equal(unauthorized.status, 401);
  for (const query of ["months=13", "days=0", "exportType=unknown", "coldStorageBillNumber=nope"]) {
    const invalid = await fetch(`${base}/api/export/sales?fromDate=2000-01-01&toDate=2099-12-31&${query}`, { headers: auth });
    assert.equal(invalid.status, 400);
  }
  // Exercise the same single-use token path as the download button.
  const tokenRes = await fetch(`${base}/api/export/token`, { method: "POST", headers: auth });
  const { downloadToken } = await tokenRes.json() as { downloadToken: string };
  const tokenURL = `${base}/api/export/sales?fromDate=2000-01-01&toDate=2099-12-31&exportType=kata&downloadToken=${downloadToken}`;
  assert.equal((await fetch(tokenURL)).status, 200);
  assert.equal((await fetch(tokenURL)).status, 401);
  console.log(`Sales CSV choices passed: exact headers/projection, Overall compatibility, ${cases.length} filter cases for both exports, tenant isolation, token auth, and CSV escaping.`);
} finally {
  await pool.query("DELETE FROM sales_history WHERE cold_storage_id = ANY($1)", [[id, `${id}_other`]]);
  await pool.query("DELETE FROM user_sessions WHERE cold_storage_id=$1", [id]);
  await pool.query("DELETE FROM cold_storage_users WHERE cold_storage_id=$1", [id]);
  await pool.query("DELETE FROM cold_storages WHERE id = ANY($1)", [[id, `${id}_other`]]);
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
process.exit(0);
