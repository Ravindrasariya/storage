#!/usr/bin/env tsx
/**
 * Regression guard: the Self buyer filter must be applied consistently across
 * three server-side code paths — Sales History rows, Sold/Exit summary totals,
 * and CSV export.
 *
 * Why this exists: the "Self" branch of the buyerName filter is wired into
 * three separate storage helpers (getSalesHistory, getTotalBagsExited,
 * getSalesForExport). A future change to any of those helpers — or to the
 * isSelfSale/isTransferReversed logic — could silently break Self filtering,
 * returning zero rows, wrong counts, or leaking non-Self rows into the
 * Self-filtered view without anyone noticing until an operator complains.
 *
 * What this script asserts (exercising the real HTTP route stack):
 *
 *   Test 1  GET /api/sales-history?buyerName=Self
 *     - Returns our "clean" self sale (isSelfSale=1, no transfer).
 *     - Returns our "reversed-transfer" self sale (isSelfSale=1,
 *       isTransferReversed=1) — reversed transfer still counts as Self.
 *     - Does NOT return our "active-transfer" self sale (isSelfSale=1,
 *       transferToBuyerName set, isTransferReversed=0) — once transferred
 *       out it is no longer Self.
 *     - Does NOT return our non-Self sale (isSelfSale=0, buyerName set).
 *     - Every fixture row in the response has isSelfSale=1 and no active
 *       transfer to another buyer.
 *
 *   Test 2  GET /api/sales-history?buyerName=<unique-non-self-name>
 *     - Returns the non-Self sale.
 *     - Returns the active-transfer sale (whose transfer destination matches
 *       the buyer name).
 *     - Does NOT return the clean self sale or the reversed-transfer sale.
 *
 *   Test 3  GET /api/sales-history/exits-summary?buyerName=Self
 *     - totalBagsExited equals the sum of exit bags from the two qualifying
 *       self sales (sale_clean + sale_reversed_transfer).
 *
 *   Test 4  GET /api/export/sales?buyerName=Self&fromDate=…&toDate=…
 *     - CSV data row count (header excluded) matches the sales-history row
 *       count from Test 1 for the same fixture date range.
 *
 * Fixture layout (all tagged __sbf_smoke_<timestamp>_<pid>):
 *   sale_clean            — isSelfSale=1, no transfer
 *   sale_active_transfer  — isSelfSale=1, transfer to BUYER_NAME, active
 *   sale_reversed_transfer— isSelfSale=1, transfer to BUYER_NAME, reversed
 *   sale_real_buyer       — isSelfSale=0, buyerName=BUYER_NAME
 *
 *   exit_clean            — 5 bags exited from sale_clean
 *   exit_reversed_transfer— 3 bags exited from sale_reversed_transfer
 *   (no exit from sale_active_transfer or sale_real_buyer)
 *
 * Run manually:
 *   DATABASE_URL=postgres://... tsx scripts/check-self-buyer-filter.mts
 *
 * Exit code: 0 on success, 1 on any failure.
 *
 * Cleanup: all fixtures use the PREFIX on cold_storage_id / user id so they
 * can be vacuumed at script start AND in the finally block. If the script
 * ever crashes mid-run, leftover rows can be removed with:
 *   DELETE FROM cold_storages WHERE id LIKE '__sbf_smoke_%';
 *   DELETE FROM cold_storage_users WHERE id LIKE '__sbf_smoke_%';
 */

import pg from "pg";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PREFIX = "__sbf_smoke_";
const RUN_ID = `${PREFIX}${Date.now()}_${process.pid}`;
const USER_ID = `${RUN_ID}_user`;
const SESSION_TOKEN = `${RUN_ID}_token`;

// A buyer name that is both unique to this run AND contains "SmokeBuyer" so
// Test 2's partial-match search hits the real-buyer rows without matching any
// unrelated production data. We search by buyerName=BUYER_NAME below.
const BUYER_NAME = `SBFSmokeBuyer_${Date.now()}`;

// Fixed date in 2017 — far enough in the past to never trigger the
// "not more than 1 day in the future" guard, and early enough that the
// plausibility-year check (rejects typo'd years like 0026) accepts it.
// Using 2017 to avoid any collision with the 2016 fixtures in the
// null-cs-bill smoke script if both happen to run at the same time.
const TEST_YEAR = 2017;
const TEST_DATE = `${TEST_YEAR}-07-20`;
const TEST_DATE_TS = `${TEST_DATE}T12:00:00+05:30`;

async function wipeByPrefix(): Promise<void> {
  // Child tables without cold_storage_id — clean via parent ids first.
  await pool.query(
    `DELETE FROM lot_edit_history WHERE lot_id IN (SELECT id FROM lots WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM sale_edit_history WHERE sale_id IN (SELECT id FROM sales_history WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );

  // exit_history has cold_storage_id — wipe it before sales_history.
  const childTablesByCsId = [
    "exit_history",
    "sales_history",
    "lots",
    "chambers",
    "farmer_ledger",
    "buyer_ledger",
  ];
  for (const t of childTablesByCsId) {
    await pool.query(`DELETE FROM ${t} WHERE cold_storage_id LIKE $1`, [`${PREFIX}%`]);
  }

  await pool.query(`DELETE FROM user_sessions WHERE id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM cold_storage_users WHERE id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM cold_storages WHERE id LIKE $1`, [`${PREFIX}%`]);
}

interface Fixtures {
  coldStorageId: string;
  chamberId: string;
  farmerLedgerId: string;
  lotId: string;
  saleCleanId: string;
  saleActiveTransferId: string;
  saleReversedTransferId: string;
  saleRealBuyerId: string;
  /** Unique lot_no values per sale — used to identify rows in the CSV export */
  lotNoClean: string;
  lotNoActiveXfer: string;
  lotNoRevXfer: string;
  lotNoReal: string;
}

async function setupFixtures(): Promise<Fixtures> {
  const coldStorageId = RUN_ID;
  const chamberId = `${RUN_ID}_ch`;
  const farmerLedgerId = `${RUN_ID}_fl`;
  const lotId = `${RUN_ID}_lot`;

  // --- Cold storage ---
  await pool.query(
    `INSERT INTO cold_storages (
       id, name, total_capacity, wafer_rate, seed_rate,
       wafer_cold_charge, wafer_hammali, seed_cold_charge, seed_hammali,
       charge_unit, linked_phones,
       next_exit_bill_number, next_cold_storage_bill_number, next_sales_bill_number,
       next_entry_bill_number, next_wafer_lot_number, next_ration_seed_lot_number,
       starting_wafer_lot_number, starting_ration_seed_lot_number, status
     ) VALUES (
       $1, 'SBF Smoke CS', 10000, 100, 100,
       50, 10, 50, 10,
       'bag', '{}',
       1, 1, 1, 1, 1, 1, 1, 1, 'active'
     )`,
    [coldStorageId],
  );

  await pool.query(
    `INSERT INTO chambers (id, cold_storage_id, name, capacity, current_fill)
     VALUES ($1, $2, 'C1', 10000, 0)`,
    [chamberId, coldStorageId],
  );

  await pool.query(
    `INSERT INTO farmer_ledger (
       id, cold_storage_id, farmer_id, name, contact_number, village,
       tehsil, district, state, entity_type, is_flagged, is_archived
     ) VALUES ($1, $2, $3, 'SBF Farmer', '0000000000', 'X',
       'X', 'X', 'X', 'farmer', 0, 0)`,
    [farmerLedgerId, coldStorageId, `FMSBF${Date.now()}`],
  );

  // One lot shared by all test sales — enough bags for all 4 sales combined.
  await pool.query(
    `INSERT INTO lots (
       id, cold_storage_id, farmer_name, village, tehsil, district, state,
       contact_number, lot_no, size, remaining_size, chamber_id, floor,
       position, type, bag_type, quality, potato_size, assaying_type,
       up_for_sale, sale_status, base_cold_charges_billed, farmer_ledger_id
     ) VALUES (
       $1, $2, 'SBF Farmer', 'X', 'X', 'X', 'X',
       '0000000000', '__sbf_lot', 500, 496, $3, 0,
       'P1', 'seed', 'seed', 'good', 'large', 'self',
       0, 'partial', 0, $4
     )`,
    [lotId, coldStorageId, chamberId, farmerLedgerId],
  );

  // Smoke user with edit access and session.
  await pool.query(
    `INSERT INTO cold_storage_users (id, cold_storage_id, name, mobile_number, password, access_type)
     VALUES ($1, $2, 'SBF User', $3, 'smoke', 'edit')`,
    [USER_ID, coldStorageId, `9${Date.now().toString().slice(-9)}`],
  );
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, cold_storage_id) VALUES ($1, $2, $3)`,
    [SESSION_TOKEN, USER_ID, coldStorageId],
  );

  // Each sale gets a unique lot_no so individual rows are identifiable in
  // the CSV export by their "Receipt #" column — making Test 4 able to
  // assert that specific records are present or absent rather than only
  // checking the row count.
  const LOT_NO_CLEAN = `__sbf_clean_${Date.now()}`;
  const LOT_NO_ACTIVE_XFER = `__sbf_active_xfer_${Date.now()}`;
  const LOT_NO_REV_XFER = `__sbf_rev_xfer_${Date.now()}`;
  const LOT_NO_REAL = `__sbf_real_${Date.now()}`;

  // Helper to insert a sales_history row directly via SQL.
  const insertSale = async (params: {
    id: string;
    lotNo: string;
    isSelfSale: 0 | 1;
    buyerName: string | null;
    transferToBuyerName: string | null;
    isTransferReversed: 0 | 1;
    quantitySold: number;
  }) => {
    await pool.query(
      `INSERT INTO sales_history (
         id, cold_storage_id, farmer_name, village, tehsil, district, state,
         contact_number, lot_no, lot_id, chamber_name, floor, position,
         potato_type, bag_type, quality, original_lot_size, sale_type,
         quantity_sold, price_per_bag, cold_storage_charge, payment_status,
         sale_year, sold_at, cold_storage_bill_number, farmer_ledger_id,
         is_self_sale, buyer_name, transfer_to_buyer_name, is_transfer_reversed
       ) VALUES (
         $1, $2, 'SBF Farmer', 'X', 'X', 'X', 'X',
         '0000000000', $3, $4, 'C1', 0, 'P1',
         'seed', 'seed', 'good', 500, 'partial',
         $5, 0, 0, 'due',
         $6, $7, NULL, $8,
         $9, $10, $11, $12
       )`,
      [
        params.id,
        coldStorageId,
        params.lotNo,
        lotId,
        params.quantitySold,
        TEST_YEAR,
        new Date(TEST_DATE_TS),
        farmerLedgerId,
        params.isSelfSale,
        params.buyerName,
        params.transferToBuyerName,
        params.isTransferReversed,
      ],
    );
  };

  const saleCleanId = `${RUN_ID}_sale_clean`;
  const saleActiveTransferId = `${RUN_ID}_sale_active_xfer`;
  const saleReversedTransferId = `${RUN_ID}_sale_rev_xfer`;
  const saleRealBuyerId = `${RUN_ID}_sale_real`;

  // sale_clean: pure self sale — no transfer at all.
  await insertSale({
    id: saleCleanId,
    lotNo: LOT_NO_CLEAN,
    isSelfSale: 1,
    buyerName: null,
    transferToBuyerName: null,
    isTransferReversed: 0,
    quantitySold: 1,
  });

  // sale_active_transfer: self sale whose dues were transferred to BUYER_NAME
  // and the transfer has NOT been reversed. Under Self filter: excluded.
  // Under real-buyer filter (BUYER_NAME): included.
  await insertSale({
    id: saleActiveTransferId,
    lotNo: LOT_NO_ACTIVE_XFER,
    isSelfSale: 1,
    buyerName: null,
    transferToBuyerName: BUYER_NAME,
    isTransferReversed: 0,
    quantitySold: 1,
  });

  // sale_reversed_transfer: self sale whose transfer was reversed, so the
  // dues are back with Self. Under Self filter: included.
  await insertSale({
    id: saleReversedTransferId,
    lotNo: LOT_NO_REV_XFER,
    isSelfSale: 1,
    buyerName: null,
    transferToBuyerName: BUYER_NAME,
    isTransferReversed: 1,
    quantitySold: 1,
  });

  // sale_real_buyer: a plain sale to BUYER_NAME (not self). Under Self
  // filter: excluded. Under real-buyer filter: included.
  await insertSale({
    id: saleRealBuyerId,
    lotNo: LOT_NO_REAL,
    isSelfSale: 0,
    buyerName: BUYER_NAME,
    transferToBuyerName: null,
    isTransferReversed: 0,
    quantitySold: 1,
  });

  // Exit rows.
  //
  // Qualifying Self sales (isSelfSale=1, no active transfer):
  //   exit_clean            — 5 bags from sale_clean
  //   exit_reversed_transfer— 3 bags from sale_reversed_transfer
  //   Total qualifying exits = 8
  //
  // Excluded sales (must NOT appear in exits-summary?buyerName=Self):
  //   exit_active_transfer  — 7 bags from sale_active_transfer
  //   exit_real_buyer       — 11 bags from sale_real_buyer
  //   Total excluded exits  = 18
  //
  // By giving the excluded sales distinct, non-zero exit counts we make
  // Test 3 sensitive: any Self-filter leak in getTotalBagsExited will push
  // the API total above 8, causing the strict-equality assertion to fail.
  await pool.query(
    `INSERT INTO exit_history (id, sales_history_id, lot_id, cold_storage_id, bags_exited, bill_number, exit_date, is_reversed)
     VALUES ($1, $2, $3, $4, 5, 1, $5, 0)`,
    [`${RUN_ID}_exit_clean`, saleCleanId, lotId, coldStorageId, new Date(TEST_DATE_TS)],
  );
  await pool.query(
    `INSERT INTO exit_history (id, sales_history_id, lot_id, cold_storage_id, bags_exited, bill_number, exit_date, is_reversed)
     VALUES ($1, $2, $3, $4, 3, 2, $5, 0)`,
    [`${RUN_ID}_exit_rev_xfer`, saleReversedTransferId, lotId, coldStorageId, new Date(TEST_DATE_TS)],
  );
  await pool.query(
    `INSERT INTO exit_history (id, sales_history_id, lot_id, cold_storage_id, bags_exited, bill_number, exit_date, is_reversed)
     VALUES ($1, $2, $3, $4, 7, 3, $5, 0)`,
    [`${RUN_ID}_exit_active_xfer`, saleActiveTransferId, lotId, coldStorageId, new Date(TEST_DATE_TS)],
  );
  await pool.query(
    `INSERT INTO exit_history (id, sales_history_id, lot_id, cold_storage_id, bags_exited, bill_number, exit_date, is_reversed)
     VALUES ($1, $2, $3, $4, 11, 4, $5, 0)`,
    [`${RUN_ID}_exit_real_buyer`, saleRealBuyerId, lotId, coldStorageId, new Date(TEST_DATE_TS)],
  );

  return {
    coldStorageId,
    chamberId,
    farmerLedgerId,
    lotId,
    saleCleanId,
    saleActiveTransferId,
    saleReversedTransferId,
    saleRealBuyerId,
    lotNoClean: LOT_NO_CLEAN,
    lotNoActiveXfer: LOT_NO_ACTIVE_XFER,
    lotNoRevXfer: LOT_NO_REV_XFER,
    lotNoReal: LOT_NO_REAL,
  };
}

interface SaleRow {
  id: string;
  isSelfSale: number;
  transferToBuyerName: string | null;
  isTransferReversed: number;
}

async function main(): Promise<void> {
  // Clear any leftover rows from a prior crashed run before touching fixtures.
  await wipeByPrefix();

  // Stand up an in-process Express app on an ephemeral port so every assertion
  // exercises the real auth + validation + storage middleware stack — identical
  // to what the UI hits — rather than calling storage functions directly.
  const { registerRoutes } = await import("../server/routes.ts");
  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const fixtures = await setupFixtures();
  const {
    saleCleanId,
    saleActiveTransferId,
    saleReversedTransferId,
    saleRealBuyerId,
    lotNoClean,
    lotNoActiveXfer,
    lotNoRevXfer,
    lotNoReal,
  } = fixtures;

  const authHeaders = {
    "content-type": "application/json",
    "x-auth-token": SESSION_TOKEN,
  };

  // IDs we expect to see / not-see under each filter, for quick set lookups.
  const selfExpected = new Set([saleCleanId, saleReversedTransferId]);
  const selfExcluded = new Set([saleActiveTransferId, saleRealBuyerId]);
  const buyerExpected = new Set([saleRealBuyerId, saleActiveTransferId]);
  const buyerExcluded = new Set([saleCleanId, saleReversedTransferId]);
  const allFixtureIds = new Set([
    saleCleanId,
    saleActiveTransferId,
    saleReversedTransferId,
    saleRealBuyerId,
  ]);

  let failures = 0;

  try {
    // -------------------------------------------------------------------------
    // Test 1: GET /api/sales-history?buyerName=Self
    // -------------------------------------------------------------------------
    const r1 = await fetch(`${baseUrl}/api/sales-history?buyerName=Self`, {
      headers: authHeaders,
    });
    if (!r1.ok) {
      failures++;
      console.error(`Test 1 FAIL — HTTP ${r1.status}: ${await r1.text()}`);
    } else {
      const all1 = (await r1.json()) as SaleRow[];
      const ours1 = all1.filter((s) => allFixtureIds.has(s.id));
      const returnedIds1 = new Set(ours1.map((s) => s.id));

      // 1a: expected rows are present.
      const missing1 = [...selfExpected].filter((id) => !returnedIds1.has(id));
      // 1b: excluded rows are absent.
      const unexpected1 = [...selfExcluded].filter((id) => returnedIds1.has(id));

      if (missing1.length === 0 && unexpected1.length === 0) {
        console.log(
          `Test 1a (Self filter includes correct rows): ok — returned ${ours1.length} fixture row(s)`,
        );
      } else {
        failures++;
        if (missing1.length > 0) {
          console.error(
            `Test 1 FAIL — Self filter is missing rows it should include: ${missing1.join(", ")}`,
          );
        }
        if (unexpected1.length > 0) {
          console.error(
            `Test 1 FAIL — Self filter returned rows it should exclude: ${unexpected1.join(", ")}`,
          );
        }
      }

      // 1c: every returned fixture row passes the Self-filter invariant
      //     (isSelfSale=1 AND no active transfer to another buyer).
      const badInvariant = ours1.filter((s) => {
        const isActiveTx =
          s.transferToBuyerName &&
          s.transferToBuyerName.trim() !== "" &&
          s.isTransferReversed !== 1;
        return s.isSelfSale !== 1 || isActiveTx;
      });
      if (badInvariant.length > 0) {
        failures++;
        console.error(
          `Test 1c FAIL — ${badInvariant.length} returned row(s) violate isSelfSale=1 / no-active-transfer invariant: ` +
            badInvariant
              .map(
                (s) =>
                  `${s.id} (isSelfSale=${s.isSelfSale}, transferToBuyerName=${s.transferToBuyerName}, isTransferReversed=${s.isTransferReversed})`,
              )
              .join(", "),
        );
      } else {
        console.log(
          `Test 1c (Self-filter invariant on returned rows): ok — all ${ours1.length} fixture row(s) have isSelfSale=1 and no active transfer`,
        );
      }

      // 1d: global sanity — no row in the full response may violate the invariant.
      const globalBad1 = all1.filter((s) => {
        const isActiveTx =
          s.transferToBuyerName &&
          s.transferToBuyerName.trim() !== "" &&
          (s.isTransferReversed ?? 0) !== 1;
        return (s.isSelfSale ?? 0) !== 1 || isActiveTx;
      });
      if (globalBad1.length > 0) {
        failures++;
        console.error(
          `Test 1 FAIL (global) — ${globalBad1.length} row(s) in the Self-filter response violate the invariant: ` +
            globalBad1
              .slice(0, 5)
              .map(
                (s) =>
                  `${s.id} (isSelfSale=${s.isSelfSale}, transfer=${s.transferToBuyerName}, reversed=${s.isTransferReversed})`,
              )
              .join(", ") +
            (globalBad1.length > 5 ? ` … and ${globalBad1.length - 5} more` : ""),
        );
      } else {
        console.log(
          `Test 1d (global Self-filter invariant): ok — all ${all1.length} row(s) in response are valid Self sales`,
        );
      }
    }

    // -------------------------------------------------------------------------
    // Test 2: GET /api/sales-history?buyerName=<real-buyer-name>
    // Verifies that Self-sale rows do NOT leak into a real-buyer search,
    // AND that the active-transfer self sale DOES appear (its effective buyer
    // is the transfer destination, which equals BUYER_NAME).
    // -------------------------------------------------------------------------
    const r2 = await fetch(
      `${baseUrl}/api/sales-history?buyerName=${encodeURIComponent(BUYER_NAME)}`,
      { headers: authHeaders },
    );
    if (!r2.ok) {
      failures++;
      console.error(`Test 2 FAIL — HTTP ${r2.status}: ${await r2.text()}`);
    } else {
      const all2 = (await r2.json()) as SaleRow[];
      const ours2 = all2.filter((s) => allFixtureIds.has(s.id));
      const returnedIds2 = new Set(ours2.map((s) => s.id));

      const missing2 = [...buyerExpected].filter((id) => !returnedIds2.has(id));
      const unexpected2 = [...buyerExcluded].filter((id) => returnedIds2.has(id));

      if (missing2.length === 0 && unexpected2.length === 0) {
        console.log(
          `Test 2 (real-buyer filter): ok — returned ${ours2.length} expected fixture row(s), no Self-only rows leaked`,
        );
      } else {
        failures++;
        if (missing2.length > 0) {
          console.error(
            `Test 2 FAIL — real-buyer filter is missing expected rows: ${missing2.join(", ")}`,
          );
        }
        if (unexpected2.length > 0) {
          console.error(
            `Test 2 FAIL — real-buyer filter returned Self-only rows it should exclude: ${unexpected2.join(", ")}`,
          );
        }
      }
    }

    // -------------------------------------------------------------------------
    // Test 3: GET /api/sales-history/exits-summary?buyerName=Self
    //
    // The session token is scoped to our smoke cold storage, so the API
    // returns only this tenant's exits — no pre-existing production data
    // can bleed in. We therefore assert a strict equality:
    //
    //   totalBagsExited === 5 + 3 = 8
    //     (exit_clean from sale_clean)
    //   + (exit_reversed_transfer from sale_reversed_transfer)
    //
    // The excluded sales have their own exits (7 + 11 = 18 bags) that must
    // NOT be counted. Any leak in getTotalBagsExited will push the total
    // above 8 and fail the strict-equality check — making the assertion
    // sensitive to the exact Self-filter boundary.
    // -------------------------------------------------------------------------
    const EXPECTED_SELF_EXITS = 5 + 3; // qualifying exits only

    const r3 = await fetch(
      `${baseUrl}/api/sales-history/exits-summary?buyerName=Self&year=${TEST_YEAR}`,
      { headers: authHeaders },
    );
    if (!r3.ok) {
      failures++;
      console.error(`Test 3 FAIL — HTTP ${r3.status}: ${await r3.text()}`);
    } else {
      const body3 = (await r3.json()) as { totalBagsExited: number };

      // Strict equality: session is tenant-scoped so the API total is
      // exclusively from our fixture cold storage. Excluded exits (7 + 11)
      // are present in the DB — any Self-filter leak raises the total above 8.
      if (body3.totalBagsExited === EXPECTED_SELF_EXITS) {
        console.log(
          `Test 3 (exits-summary Self filter): ok — API returned exactly ${body3.totalBagsExited} (qualifying Self exits only; excluded exits are in the DB but correctly filtered out)`,
        );
      } else {
        failures++;
        const excludedInDb = 7 + 11;
        console.error(
          `Test 3 FAIL — exits-summary returned ${body3.totalBagsExited}, expected exactly ${EXPECTED_SELF_EXITS}. ` +
            `Fixture DB has ${excludedInDb} additional bags exited from non-Self sales; if the total is ${EXPECTED_SELF_EXITS + excludedInDb} ` +
            `the Self filter in getTotalBagsExited is leaking excluded rows into the count.`,
        );
      }
    }

    // -------------------------------------------------------------------------
    // Test 4: GET /api/export/sales?buyerName=Self&fromDate=…&toDate=…
    //
    // The CSV export independently implements the Self filter in
    // getSalesForExport (server/storage.ts ~7261). A count-only assertion
    // cannot catch all plausible regressions — e.g. a bug that swaps
    // sale_clean for sale_active_transfer still returns two rows.
    //
    // Each fixture sale was given a unique lot_no (the "Receipt #" column in
    // the CSV, index 2). We parse the CSV and verify by lot_no:
    //   - LOT_NO_CLEAN and LOT_NO_REV_XFER must appear (qualifying Self sales).
    //   - LOT_NO_ACTIVE_XFER and LOT_NO_REAL must be absent (excluded).
    //
    // The DB-count cross-check is kept as a secondary completeness assertion.
    // -------------------------------------------------------------------------
    const fromDate = `${TEST_YEAR}-07-01`;
    const toDate   = `${TEST_YEAR}-07-31`;

    const r4Csv = await fetch(
      `${baseUrl}/api/export/sales?buyerName=${encodeURIComponent("Self")}&fromDate=${fromDate}&toDate=${toDate}&language=en`,
      { headers: authHeaders },
    );
    if (!r4Csv.ok) {
      failures++;
      console.error(`Test 4 FAIL — export HTTP ${r4Csv.status}: ${await r4Csv.text()}`);
    } else {
      const csvText = await r4Csv.text();
      // Strip BOM if present, split into lines, drop the header line, and
      // filter out any trailing empty line from the final \n.
      const lines = csvText.replace(/^\uFEFF/, "").split("\n");
      const dataRows = lines.slice(1).filter((l) => l.trim() !== "");
      const csvDataCount = dataRows.length;

      // The "Receipt #" column is index 2 (0-based). Each cell may be wrapped
      // in double-quotes by escapeCSV; strip quotes for comparison.
      const RECEIPT_COL = 2;
      const receiptNumbers = new Set(
        dataRows.map((row) => {
          const cols = row.split(",");
          return cols[RECEIPT_COL]?.replace(/^"|"$/g, "").trim() ?? "";
        }),
      );

      // 4a: qualifying Self sales must be present.
      const csvMissing: string[] = [];
      if (!receiptNumbers.has(lotNoClean))   csvMissing.push(`LOT_NO_CLEAN (${lotNoClean})`);
      if (!receiptNumbers.has(lotNoRevXfer)) csvMissing.push(`LOT_NO_REV_XFER (${lotNoRevXfer})`);

      // 4b: excluded sales must be absent.
      const csvUnexpected: string[] = [];
      if (receiptNumbers.has(lotNoActiveXfer)) csvUnexpected.push(`LOT_NO_ACTIVE_XFER (${lotNoActiveXfer})`);
      if (receiptNumbers.has(lotNoReal))        csvUnexpected.push(`LOT_NO_REAL (${lotNoReal})`);

      if (csvMissing.length === 0 && csvUnexpected.length === 0) {
        console.log(
          `Test 4a/4b (CSV export Self filter — record presence/absence): ok — ` +
            `qualifying lot numbers present, excluded lot numbers absent (${csvDataCount} total CSV row(s))`,
        );
      } else {
        failures++;
        if (csvMissing.length > 0) {
          console.error(
            `Test 4 FAIL — qualifying Self sales missing from CSV: ${csvMissing.join(", ")}`,
          );
        }
        if (csvUnexpected.length > 0) {
          console.error(
            `Test 4 FAIL — excluded sales leaked into CSV: ${csvUnexpected.join(", ")}`,
          );
        }
      }

      // 4c: secondary completeness check — CSV row count must equal the DB
      // count of qualifying Self sales for this tenant + date range.
      const dbCount4 = await pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM sales_history
         WHERE cold_storage_id = $1
           AND is_self_sale = 1
           AND (transfer_to_buyer_name IS NULL OR transfer_to_buyer_name = '' OR is_transfer_reversed = 1)
           AND sold_at >= $2::timestamptz
           AND sold_at <= ($3::date + interval '1 day - 1 millisecond')::timestamptz`,
        [fixtures.coldStorageId, fromDate, toDate],
      );
      const expectedCsvCount = Number(dbCount4.rows[0].cnt);
      if (csvDataCount === expectedCsvCount) {
        console.log(
          `Test 4c (CSV row count matches DB): ok — both equal ${csvDataCount}`,
        );
      } else {
        failures++;
        console.error(
          `Test 4c FAIL — CSV has ${csvDataCount} data row(s) but DB has ${expectedCsvCount} qualifying Self sales for the same period`,
        );
      }
    }
  } finally {
    await wipeByPrefix();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\nSelf buyer filter regression check FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log(`\nSelf buyer filter regression check passed.`);
}

main().catch(async (err) => {
  console.error("Regression check crashed:", err);
  try { await wipeByPrefix(); } catch { /* best effort */ }
  try { await pool.end(); } catch { /* best effort */ }
  process.exit(1);
});
