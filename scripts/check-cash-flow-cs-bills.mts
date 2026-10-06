#!/usr/bin/env tsx
// Verifies the shared card/dialog component and actual allocation metadata.
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import pg from "pg";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { ReceiptColdBills, getReceiptColdBills } from "../client/src/components/ReceiptColdBills.tsx";

const cases = [
  { payerType: "cold_merchant", dueType: "cold_charges", coldStorageBillNumbers: "11", expected: "11" },
  { payerType: "cold_merchant", dueType: "cold_charges", coldStorageBillNumbers: "2, 11, 30", expected: "2, 11, 30" },
  { payerType: "farmer", dueType: "cold_charges", coldStorageBillNumbers: "7", expected: "7" },
  { payerType: "cold_merchant", dueType: "cold_charges", coldStorageBillNumbers: null, expected: null },
  { payerType: "cold_merchant", dueType: "cold_charges", coldStorageBillNumbers: "", expected: null },
  { payerType: "cold_merchant", dueType: "cold_charges", coldStorageBillNumbers: "  ", expected: null },
  { payerType: "cold_merchant", dueType: "merchant_extras", coldStorageBillNumbers: "11", expected: null },
  { payerType: "sales_goods", dueType: "cold_charges", coldStorageBillNumbers: "11", expected: null },
  { payerType: "others", dueType: "cold_charges", coldStorageBillNumbers: "11", expected: null },
  { payerType: "kata", dueType: "cold_charges", coldStorageBillNumbers: "11", expected: null },
  { payerType: "farmer", dueType: "farmer_receivable", coldStorageBillNumbers: "11", expected: null },
];
for (const { expected, ...receipt } of cases) {
  assert.equal(getReceiptColdBills(receipt), expected);
  for (const variant of ["card", "detail"] as const) {
    for (const label of ["CS Bill #", "शीत भण्डार बिल #"]) {
      const html = renderToStaticMarkup(React.createElement(ReceiptColdBills, {
        receipt, variant, label, testId: "bills-test",
      }));
      if (expected == null) assert.equal(html, "", `Omit ${JSON.stringify(receipt)}`);
      else {
        assert.ok(html.includes(expected));
        assert.ok(html.includes(label));
        assert.ok(html.includes("[overflow-wrap:anywhere]"), "Both surfaces wrap full number lists");
        assert.ok(!html.includes("truncate") && !html.includes("line-clamp"), "No clipping/ellipsis");
      }
    }
  }
}
const longList = Array.from({ length: 60 }, (_, i) => i + 10000).join(", ");
for (const variant of ["card", "detail"] as const) {
  const html = renderToStaticMarkup(React.createElement(ReceiptColdBills, {
    receipt: { payerType: "cold_merchant", dueType: "cold_charges", coldStorageBillNumbers: longList },
    variant, label: "CS Bill #", testId: "long-list",
  }));
  assert.ok(html.includes(longList), "Long list stays complete");
}
const cashPage = await readFile("client/src/pages/CashManagement.tsx", "utf8");
assert.equal((cashPage.match(/<ReceiptColdBills\b/g) || []).length, 2, "Both history and detail use the shared field");
assert.ok(cashPage.includes('className="max-w-md max-h-[90dvh] overflow-y-auto"'),
  "Long payment dialogs remain scrollable within the viewport");

// Optional isolated layout harness. It renders the production component with
// built app CSS and synthetic data, never bypassing the app's authentication.
// Run after npm run build: tsx scripts/check-cash-flow-cs-bills.mts --preview
if (process.argv.includes("--preview")) {
  const assets = await readdir("dist/public/assets");
  const cssFile = assets.find(name => name.startsWith("index-") && name.endsWith(".css"));
  assert.ok(cssFile, "Run npm run build before previewing");
  const css = await readFile(`dist/public/assets/${cssFile}`, "utf8");
  const label = process.argv.includes("--hindi") ? "शीत भण्डार बिल #" : "CS Bill #";
  const render = (numbers: string, variant: "card" | "detail") => renderToStaticMarkup(
    React.createElement(ReceiptColdBills, {
      receipt: { payerType: "cold_merchant", dueType: "cold_charges", coldStorageBillNumbers: numbers },
      variant, label, testId: `${variant}-layout-test`,
    }),
  );
  const cards = ["37", "2, 11, 30, 37", longList].map(numbers => `
    <div class="p-2 rounded-lg bg-green-50 border border-green-200">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <span class="text-sm font-medium truncate">Test Farmer (Village)</span>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 min-w-fit">
          <span class="font-semibold text-sm whitespace-nowrap text-green-600">+₹3,850</span>
          <span class="text-xs rounded-md bg-blue-600 px-2 py-1 text-white">Inflow</span>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
        <span>06/10/2026</span><span class="rounded border px-2">Cash</span>
      </div>
      ${render(numbers, "card")}
    </div>`).join("");
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${css}</style></head><body><main class="max-w-md mx-auto p-4 space-y-4">
    <h1 class="font-semibold">Payment bill-number layout checks</h1>
    <section class="space-y-2">${cards}</section>
    <section class="space-y-4 rounded-lg border p-4">
      <h2 class="font-semibold">Payment Details</h2>
      <div class="bg-muted/50 rounded-lg p-4 space-y-3">
        <div class="flex justify-between gap-3"><span>Buyer Name:</span><span>Test Farmer</span></div>
        ${render(longList, "detail")}
        <div class="flex justify-between"><span>Amount:</span><span class="text-green-600">₹3,850</span></div>
      </div>
      <button class="w-full rounded bg-red-600 p-2 text-white">Reverse Entry (layout only)</button>
    </section></main></body></html>`;
  createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  }).listen(5001, "0.0.0.0", () => console.log("Layout test ready on port 5001"));
  await new Promise(() => {});
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const cs = `__cash_bills_${Date.now()}_${process.pid}`;
const otherCS = `${cs}_other`;
try {
  const { storage } = await import("../server/storage.ts");
  for (const coldStorageId of [cs, otherCS]) {
    await pool.query(`INSERT INTO cold_storages
      (id,name,total_capacity,wafer_rate,seed_rate,linked_phones)
      VALUES ($1,'Cash Bills Test',10000,100,100,'{}')`, [coldStorageId]);
  }
  async function sale(key: string, bill: number | null) {
    await pool.query(`INSERT INTO sales_history
      (id,cold_storage_id,lot_id,farmer_name,village,tehsil,district,state,
       contact_number,lot_no,chamber_name,floor,position,potato_type,bag_type,
       quality,original_lot_size,sale_type,quantity_sold,price_per_bag,cold_storage_charge,
       payment_status,due_amount,sale_year,sold_at,cold_storage_bill_number,is_self_sale,buyer_name)
      VALUES ($1,$2,$3,'Test Farmer','X','X','X','X','0000000000',$4,'C',0,'P',
        'seed','seed','good',100,'partial',10,10,100,'due',100,2016,
        '2016-07-20 12:00:00',$5,0,'')`, [`${cs}_${key}`, cs, `${cs}_lot`, key, bill]);
    return `${cs}_${key}`;
  }
  async function receipt(key: string, coldStorageId = cs, reversed = false) {
    const id = `${cs}_${key}`;
    await pool.query(`INSERT INTO cash_receipts
      (id,cold_storage_id,payer_type,due_type,receipt_type,amount,buyer_name,is_reversed,received_at)
      VALUES ($1,$2,'cold_merchant','cold_charges','cash',100,'Same Buyer',$3,'2016-07-21 12:00:00')`,
      [id, coldStorageId, reversed ? 1 : 0]);
    return id;
  }
  let applicationCounter = 0;
  async function apply(receiptId: string, saleId: string) {
    await pool.query(`INSERT INTO cash_receipt_applications
      (id,cold_storage_id,cash_receipt_id,sales_history_id,amount_applied)
      VALUES ($1,$2,$3,$4,10)`, [`${cs}_app_${++applicationCounter}`, cs, receiptId, saleId]);
  }
  const bill11a = await sale("sale_11a", 11);
  const bill11b = await sale("sale_11b", 11);
  const bill2 = await sale("sale_2", 2);
  const noBill = await sale("sale_null", null);
  const single = await receipt("single");
  await apply(single, bill11a);
  const multiple = await receipt("multiple");
  for (const saleId of [bill11a, bill11b, bill2, noBill]) await apply(multiple, saleId);
  const nullOnly = await receipt("null_only");
  await apply(nullOnly, noBill);
  const unallocated = await receipt("unallocated");
  const foreign = await receipt("foreign", otherCS);
  const reversed = await receipt("reversed", cs, true);
  await apply(reversed, bill11a);
  const manualSale = await sale("sale_manual", 37);
  const { receipt: manual } = await storage.createManualSalePayment({
    coldStorageId: cs, saleId: manualSale, receiptType: "cash", accountType: null,
    accountId: null, amount: 100, receivedAt: new Date("2016-07-21T12:00:00+05:30"), notes: "fixture",
  });
  const rows = await storage.getCashReceipts(cs);
  const find = (id: string) => {
    const result = rows.find(row => row.id === id);
    assert.ok(result, `Receipt ${id} exists`);
    return result;
  };
  assert.equal(find(single).coldStorageBillNumbers, "11");
  assert.equal(find(multiple).coldStorageBillNumbers, "2, 11", "Distinct, numeric sorted, comma-space");
  assert.equal(find(nullOnly).coldStorageBillNumbers, null);
  assert.equal(find(unallocated).coldStorageBillNumbers, null, "No guessing by shared buyer name");
  assert.ok(!rows.some(row => row.id === foreign), "Cold-storage isolation");
  assert.equal(find(manual.id).appliesToSaleId, manualSale);
  assert.equal(getReceiptColdBills(find(manual.id)), "37", "Actual manual-payment path is covered");
  assert.equal(getReceiptColdBills(find(reversed)), "11", "Do not hide retained links merely for reversed status");
  for (const receiptRow of rows) {
    const bills = getReceiptColdBills(receiptRow);
    for (const variant of ["card", "detail"] as const) {
      const html = renderToStaticMarkup(React.createElement(ReceiptColdBills, {
        receipt: receiptRow, variant, label: "CS Bill #", testId: receiptRow.id,
      }));
      if (bills) assert.ok(html.includes(receiptRow.coldStorageBillNumbers!), "Use the same text as the PDF");
      else assert.equal(html, "");
    }
  }
  console.log("Cash Flow CS bills passed: both UI surfaces, English/Hindi, single/multiple/long lists, omitted missing/unrelated receipts, distinct allocations, manual payments, reversal metadata, tenant isolation, and PDF text parity.");
} finally {
  for (const table of ["cash_receipt_applications", "cash_receipts", "sales_history"]) {
    await pool.query(`DELETE FROM ${table} WHERE cold_storage_id = ANY($1)`, [[cs, otherCS]]);
  }
  await pool.query("DELETE FROM cold_storages WHERE id = ANY($1)", [[cs, otherCS]]);
  await pool.query("DELETE FROM daily_id_counters WHERE id LIKE $1", [`%${cs}%`]);
  await pool.end();
}
process.exit(0);
