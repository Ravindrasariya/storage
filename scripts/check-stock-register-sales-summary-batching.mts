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
import pg from "pg";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  loadSalesSummaryBatches,
  SALES_SUMMARY_BATCH_SIZE,
} from "../client/src/lib/salesSummaryBatch.ts";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

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
  await pool.query("DELETE FROM exit_history WHERE cold_storage_id LIKE $1", [`${PREFIX}%`]);
  await pool.query("DELETE FROM sales_history WHERE cold_storage_id LIKE $1", [`${PREFIX}%`]);
  await pool.query("DELETE FROM lots WHERE cold_storage_id LIKE $1", [`${PREFIX}%`]);
  await pool.query("DELETE FROM chambers WHERE cold_storage_id LIKE $1", [`${PREFIX}%`]);
  await pool.query("DELETE FROM user_sessions WHERE id LIKE $1", [`${PREFIX}%`]);
  await pool.query("DELETE FROM cold_storage_users WHERE id LIKE $1", [`${PREFIX}%`]);
  await pool.query("DELETE FROM cold_storages WHERE id LIKE $1", [`${PREFIX}%`]);
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
  await cleanup();
  await setup();

  const { registerRoutes } = await import("../server/routes.ts");
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = { "x-auth-token": SESSION_TOKEN };

  try {
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
    console.log("\nStock Register sales-summary batching check passed.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanup();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("Stock Register sales-summary batching check FAILED:", error);
  try { await cleanup(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});