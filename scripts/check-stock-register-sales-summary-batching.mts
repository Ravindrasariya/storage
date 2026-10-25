#!/usr/bin/env tsx
/**
 * Regression guard for Stock Register's yellow sale/exit columns.
 *
 * A broad variety filter can return more than 1,000 lots. The sales-summary
 * route intentionally accepts at most 1,000 IDs per request, and practical
 * GET request-line limits are lower still for UUIDs. This check sends one
 * real fully-sold lot plus 1,000 UUID-length missing IDs through the same
 * client batching helper used by StockRegister and verifies that the real
 * sale, exit date, Exit Bill #, and Cold Bill # survive the merged response.
 */

import express from "express";
import assert from "node:assert/strict";
import pg from "pg";
import { requireDevelopmentFixtures } from "./require-development-fixtures.mts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  loadSalesSummaryBatches,
  SALES_SUMMARY_BATCH_SIZE,
} from "../client/src/lib/salesSummaryBatch.ts";

const { Pool } = pg;
requireDevelopmentFixtures();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PREFIX = "__ssb_smoke_";
const RUN_ID = `${PREFIX}${Date.now()}_${process.pid}`;
const CS_ID = RUN_ID;
const USER_ID = `${RUN_ID}_user`;
const SESSION_TOKEN = `${RUN_ID}_token`;
const CHAMBER_ID = `${RUN_ID}_chamber`;
const LOT_ID = `${RUN_ID}_sold_lot`;
const SALE_ID = `${RUN_ID}_sale`;
const EXIT_ID = `${RUN_ID}_exit`;

async function cleanup(): Promise<void> {
  for (const table of ["exit_history", "sales_history", "buyer_ledger", "lots", "chambers"]) {
    await pool.query(`DELETE FROM ${table} WHERE cold_storage_id IN ($1,$2)`, [CS_ID, `${CS_ID}_other`]);
  }
  await pool.query("DELETE FROM user_sessions WHERE id=$1", [SESSION_TOKEN]);
  await pool.query("DELETE FROM cold_storage_users WHERE id=$1", [USER_ID]);
  await pool.query("DELETE FROM cold_storages WHERE id IN ($1,$2)", [CS_ID, `${CS_ID}_other`]);
}

async function setup(): Promise<void> {
  await pool.query(
    `INSERT INTO cold_storages (
       id, name, total_capacity, wafer_rate, seed_rate,
       wafer_cold_charge, wafer_hammali, seed_cold_charge, seed_hammali,
       charge_unit, linked_phones, next_exit_bill_number,
       next_cold_storage_bill_number, next_sales_bill_number,
       next_entry_bill_number, next_wafer_lot_number,
       next_ration_seed_lot_number, starting_wafer_lot_number,
       starting_ration_seed_lot_number, status
     ) VALUES (
       $1, 'SSB Smoke CS', 10000, 100, 100, 50, 10, 50, 10,
       'bag', '{}', 1, 1, 1, 1, 1, 1, 1, 1, 'active'
     )`,
    [CS_ID],
  );
  await pool.query(
    `INSERT INTO chambers (id, cold_storage_id, name, capacity, current_fill)
     VALUES ($1, $2, 'C1', 10000, 0)`,
    [CHAMBER_ID, CS_ID],
  );
  await pool.query(
    `INSERT INTO lots (
       id, cold_storage_id, farmer_name, village, tehsil, district, state,
       contact_number, lot_no, size, remaining_size, chamber_id, floor,
       position, type, bag_type, quality, potato_size, assaying_type,
       up_for_sale, sale_status, base_cold_charges_billed
     ) VALUES (
       $1, $2, 'SSB Farmer', 'X', 'X', 'X', 'X', '0000000000',
       '225', 109, 0, $3, 8, '10 11 12', 'CS3', 'wafer', 'good',
       'large', 'self', 0, 'sold', 1
     )`,
    [LOT_ID, CS_ID, CHAMBER_ID],
  );
  await pool.query(
    `INSERT INTO sales_history (
       id, cold_storage_id, farmer_name, village, tehsil, district, state,
       contact_number, lot_no, lot_id, chamber_name, floor, position,
       potato_type, bag_type, quality, original_lot_size, sale_type,
       quantity_sold, price_per_bag, cold_storage_charge, payment_status,
       sale_year, sold_at, entry_date, cold_storage_bill_number
     ) VALUES (
       $1, $2, 'SSB Farmer', 'X', 'X', 'X', 'X', '0000000000',
       '225', $3, 'C1', 8, '10 11 12', 'CS3', 'wafer', 'good',
       109, 'full', 109, 60, 6540, 'due', 2026,
       '2026-08-20T12:00:00+05:30', '2026-02-10T12:00:00+05:30', 321
     )`,
    [SALE_ID, CS_ID, LOT_ID],
  );
  await pool.query(
    `INSERT INTO exit_history (
       id, sales_history_id, lot_id, cold_storage_id, bags_exited,
       bill_number, exit_date, is_reversed
     ) VALUES (
       $1, $2, $3, $4, 109, 654, '2026-08-21T12:00:00+05:30', 0
     )`,
    [EXIT_ID, SALE_ID, LOT_ID, CS_ID],
  );
  await pool.query(
    `INSERT INTO cold_storage_users (
       id, cold_storage_id, name, mobile_number, password, access_type
     ) VALUES ($1, $2, 'SSB User', $3, 'smoke', 'edit')`,
    [USER_ID, CS_ID, `7${Date.now().toString().slice(-9)}`],
  );
  await pool.query(
    "INSERT INTO user_sessions (id, user_id, cold_storage_id) VALUES ($1, $2, $3)",
    [SESSION_TOKEN, USER_ID, CS_ID],
  );
}

async function main(): Promise<void> {
  let serverPool: { end: () => Promise<void> } | undefined;
  const { registerRoutes } = await import("../server/routes.ts");
  serverPool = (await import("../server/db.ts")).pool;
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = { "x-auth-token": SESSION_TOKEN };

  try {
    await setup();
    // UUID-length IDs reproduce both the API count pressure and the request
    // line size that occurs with real filtered production lots.
    const lotIds = [
      LOT_ID,
      ...Array.from(
        { length: 1000 },
        (_, i) => `${RUN_ID}_missing_${String(i).padStart(4, "0")}_xxxxxxxxxxxxxxxx`,
      ),
    ];
    let requests = 0;
    let largestBatch = 0;

    const merged = await loadSalesSummaryBatches(lotIds, async (batch) => {
      requests++;
      largestBatch = Math.max(largestBatch, batch.length);
      const response = await fetch(
        `${baseUrl}/api/lots/sales-summary?lotIds=${encodeURIComponent(batch.join(","))}`,
        { headers },
      );
      if (!response.ok) {
        throw new Error(`summary batch failed: HTTP ${response.status} ${await response.text()}`);
      }
      return response.json();
    });

    if (requests !== Math.ceil(lotIds.length / SALES_SUMMARY_BATCH_SIZE)) {
      throw new Error(`expected 6 bounded requests, received ${requests}`);
    }
    if (largestBatch > SALES_SUMMARY_BATCH_SIZE || largestBatch > 1000) {
      throw new Error(`batch exceeded safety limit: ${largestBatch}`);
    }

    const [sale] = merged[LOT_ID] || [];
    if (!sale) throw new Error("fully-sold filtered lot lost its sales summary");
    if (sale.quantitySold !== 109 || sale.totalExited !== 109) {
      throw new Error(`wrong Exited / Sold values: ${sale.totalExited} / ${sale.quantitySold}`);
    }
    if (sale.coldStorageBillNumber !== 321) {
      throw new Error(`wrong Cold Bill #: ${sale.coldStorageBillNumber}`);
    }
    if (sale.exits?.length !== 1 || sale.exits[0].billNumber !== 654) {
      throw new Error(`wrong Exit Bill summary: ${JSON.stringify(sale.exits)}`);
    }
    const exitDay = new Date(sale.exits[0].exitDate).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    if (exitDay !== "2026-08-21") {
      throw new Error(`wrong exit date: ${exitDay}`);
    }
    if (!Array.isArray(merged[lotIds[1000]]) || merged[lotIds[1000]].length !== 0) {
      throw new Error("missing lots were not represented as confirmed empty summaries");
    }
    console.log(
      `Test 1 (1,001 filtered lot IDs): ok — ${requests} requests, max ${largestBatch} IDs; sold/exit/bill details preserved`,
    );

    let failurePropagated = false;
    try {
      await loadSalesSummaryBatches(lotIds, async (_batch) => {
        throw new Error("simulated summary failure");
      });
    } catch (error) {
      failurePropagated = error instanceof Error && /simulated summary failure/.test(error.message);
    }
    if (!failurePropagated) {
      throw new Error("batch failure was converted into an empty/no-sale result");
    }
    console.log("Test 2 (failed batch remains an error): ok");

    // MR resolution, using several sales on the same lot and a second tenant.
    await pool.query(`INSERT INTO cold_storages
      (id,name,total_capacity,wafer_rate,seed_rate,linked_phones)
      VALUES ($1,'Other tenant',1000,60,60,'{}')`, [`${CS_ID}_other`]);
    const buyer = async (suffix: string, name: string, initials: string | null, cs = CS_ID) => {
      const id = `${RUN_ID}_${suffix}`;
      await pool.query(`INSERT INTO buyer_ledger (id,cold_storage_id,buyer_id,buyer_name,initials)
        VALUES ($1,$2,$3,$4,$5)`, [id, cs, id, name, initials]);
      return id;
    };
    const linked = await buyer("linked", "Canonical", "  rLt  ");
    const legacy = await buyer("legacy", "Legacy Buyer", "एलबी");
    await buyer("duplicate1", "Ambiguous", "Wrong1");
    await buyer("duplicate2", " AMBIGUOUS ", "Wrong2");
    const blank = await buyer("blank", "Blank", "   ");
    const nullInitials = await buyer("null", "Null", null);
    const emptyInitials = await buyer("empty", "Empty", "");
    const foreign = await buyer("foreign", "Canonical", "LEAK", `${CS_ID}_other`);
    await buyer("foreignLegacy", "Legacy Buyer", "LEAK", `${CS_ID}_other`);
    await buyer("foreignOnly", "Foreign Only", "LEAK", `${CS_ID}_other`);
    const addSale = async (suffix: string, buyerId: string | null, name: string | null, self = 0, cs = CS_ID) => {
      const id = `${RUN_ID}_sale_${suffix}`;
      await pool.query(`INSERT INTO sales_history (
        id,cold_storage_id,farmer_name,village,tehsil,district,state,contact_number,lot_no,lot_id,
        chamber_name,floor,position,potato_type,bag_type,quality,original_lot_size,sale_type,
        quantity_sold,price_per_bag,cold_storage_charge,payment_status,sale_year,sold_at,
        buyer_ledger_id,buyer_name,is_self_sale)
        SELECT $1,$2,farmer_name,village,tehsil,district,state,contact_number,lot_no,lot_id,
        chamber_name,floor,position,potato_type,bag_type,quality,original_lot_size,'partial',
        1,60,60,'due',2026,sold_at,$3,$4,$5 FROM sales_history WHERE id=$6`,
        [id, cs, buyerId, name, self, SALE_ID]);
      return id;
    };
    const expected = new Map<string, [number, string | null]>();
    for (const [suffix, ledgerId, name, self, initials] of [
      ["linked", linked, "Stale sale name", 0, "rLt"],
      ["legacy", null, "  LEGACY BUYER ", 0, "एलबी"],
      ["ambiguous", null, "ambiguous", 0, null],
      ["blank", blank, "Blank", 0, null],
      ["null", nullInitials, "Null", 0, null],
      ["empty", emptyInitials, "Empty", 0, null],
      ["self", linked, "Canonical", 1, null],
      ["unknown", null, "Unknown", 0, null],
      ["noName", null, null, 0, null],
      ["dangling", "does-not-exist", "Legacy Buyer", 0, null],
      ["foreignId", foreign, "Legacy Buyer", 0, null],
      ["foreignName", null, "Foreign Only", 0, null],
    ] as Array<[string, string | null, string | null, number, string | null]>) {
      expected.set(await addSale(suffix, ledgerId, name, self), [self, initials]);
    }
    const foreignSale = await addSale("foreign", foreign, "Canonical", 0, `${CS_ID}_other`);
    const summary = async () => {
      const response = await fetch(`${baseUrl}/api/lots/sales-summary?lotIds=${LOT_ID}`, { headers });
      assert.equal(response.status, 200);
      return (await response.json())[LOT_ID] as any[];
    };
    const rows = await summary();
    assert.equal(rows.length, expected.size + 1);
    assert.equal(rows.some(s => s.saleId === foreignSale), false);
    for (const [saleId, [self, initials]] of expected) {
      const row = rows.find(s => s.saleId === saleId);
      assert.ok(row);
      assert.equal(row.isSelfSale, self);
      assert.equal(row.buyerInitials, initials, saleId);
    }
    await pool.query("UPDATE buyer_ledger SET initials='New' WHERE id=$1", [linked]);
    assert.equal((await summary()).find(s => s.saleId === `${RUN_ID}_sale_linked`).buyerInitials, "New");
    await pool.query("UPDATE buyer_ledger SET initials=NULL WHERE id IN ($1,$2)", [linked, legacy]);
    for (const suffix of ["linked", "legacy"]) {
      assert.equal((await summary()).find(s => s.saleId === `${RUN_ID}_sale_${suffix}`).buyerInitials, null);
    }
    console.log("Test 3 (MR): ok — live/cleared initials, mixed buyers, Self, legacy match, ambiguous/missing buyers, tenant isolation");
    console.log("\nStock Register sales-summary batching check passed.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanup();
    await pool.end();
    await serverPool?.end();
  }
}

main().catch(async (error) => {
  console.error("Stock Register sales-summary batching check FAILED:", error);
  try { await cleanup(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});