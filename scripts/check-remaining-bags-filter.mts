#!/usr/bin/env tsx
/**
 * Regression guard: the Remaining Bags checkbox filter on the Stock Register
 * must only return lots whose remainingSize > 0.
 *
 * Why this exists: the filter is applied inside getFilteredLotsForRegister()
 * via parseRegisterParams(). A future change to either helper — or to the
 * underlying lot data shape — could silently break the check and start
 * returning fully-sold lots to operators. This script exercises the real
 * HTTP route stack (auth, param parsing, storage layer) so route-level
 * regressions are caught in addition to storage-layer ones.
 *
 * What this script asserts:
 *   1. GET /api/lots/search?type=filter&remainingBags=true returns ONLY lots
 *      whose remainingSize > 0 (zero-remaining lots are excluded).
 *   2. The filter ANDs with a quality param: adding quality=good returns only
 *      the intersection — good-quality lots with remaining bags.
 *   3. A zero-remaining lot that also has quality=good is not returned by
 *      the AND query (i.e. the remainingBags gate is applied last and
 *      cannot be bypassed by an additional filter).
 *
 * Run manually:
 *   DATABASE_URL=postgres://... tsx scripts/check-remaining-bags-filter.mts
 *
 * Exit code: 0 on success, 1 on any failure.
 *
 * Cleanup: all fixtures are prefixed with __rbf_smoke_<timestamp>_<pid> on
 * the cold_storage_id / user id so they can be vacuumed at script start AND
 * in the finally block. If the script crashes mid-run, leftover rows can be
 * removed with:
 *   DELETE FROM cold_storages WHERE id LIKE '__rbf_smoke_%';
 *   DELETE FROM cold_storage_users WHERE id LIKE '__rbf_smoke_%';
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

const PREFIX = "__rbf_smoke_";
const RUN_ID = `${PREFIX}${Date.now()}_${process.pid}`;
const USER_ID = `${RUN_ID}_user`;
const SESSION_TOKEN = `${RUN_ID}_token`;

async function wipeByPrefix(): Promise<void> {
  // lot_edit_history has no cold_storage_id — clean it via the parent lot ids.
  await pool.query(
    `DELETE FROM lot_edit_history WHERE lot_id IN (SELECT id FROM lots WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM sale_edit_history WHERE sale_id IN (SELECT id FROM sales_history WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );

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
  /** lot ids, in insertion order — see inline comments for what each holds */
  lotIds: string[];
}

async function setupFixtures(): Promise<Fixtures> {
  const coldStorageId = RUN_ID;
  const chamberId = `${RUN_ID}_ch`;
  const farmerLedgerId = `${RUN_ID}_fl`;

  // Four lots covering the 2×2 matrix of (remainingSize, quality):
  //   lot0 — remainingSize=50, quality=good   → must appear in BOTH queries
  //   lot1 — remainingSize=30, quality=average → must appear in query 1 only
  //   lot2 — remainingSize=0,  quality=good   → must appear in NEITHER query
  //   lot3 — remainingSize=0,  quality=average → must appear in NEITHER query
  const lotIds = [
    `${RUN_ID}_lot0`,
    `${RUN_ID}_lot1`,
    `${RUN_ID}_lot2`,
    `${RUN_ID}_lot3`,
  ];

  await pool.query(
    `INSERT INTO cold_storages (
       id, name, total_capacity, wafer_rate, seed_rate,
       wafer_cold_charge, wafer_hammali, seed_cold_charge, seed_hammali,
       charge_unit, linked_phones,
       next_exit_bill_number, next_cold_storage_bill_number, next_sales_bill_number,
       next_entry_bill_number, next_wafer_lot_number, next_ration_seed_lot_number,
       starting_wafer_lot_number, starting_ration_seed_lot_number, status
     ) VALUES (
       $1, 'RBF Smoke CS', 10000, 100, 100,
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
     ) VALUES ($1, $2, $3, 'RBF Farmer', '0000000000', 'X',
       'X', 'X', 'X', 'farmer', 0, 0)`,
    [farmerLedgerId, coldStorageId, `FMRBF${Date.now()}`],
  );

  const lotSpecs = [
    { remaining: 50, quality: "good" },
    { remaining: 30, quality: "average" },
    { remaining: 0,  quality: "good" },
    { remaining: 0,  quality: "average" },
  ];

  for (let i = 0; i < lotIds.length; i++) {
    const { remaining, quality } = lotSpecs[i];
    await pool.query(
      `INSERT INTO lots (
         id, cold_storage_id, farmer_name, village, tehsil, district, state,
         contact_number, lot_no, size, remaining_size, chamber_id, floor,
         position, type, bag_type, quality, potato_size, assaying_type,
         up_for_sale, sale_status, base_cold_charges_billed, farmer_ledger_id
       ) VALUES (
         $1, $2, 'RBF Farmer', 'X', 'X', 'X', 'X',
         '0000000000', $3, 100, $4, $5, 0,
         'P${i + 1}', 'seed', 'seed', $6, 'large', 'self',
         0, 'available', 0, $7
       )`,
      [
        lotIds[i],
        coldStorageId,
        `__rbf_lot_${i}`,
        remaining,
        chamberId,
        quality,
        farmerLedgerId,
      ],
    );
  }

  await pool.query(
    `INSERT INTO cold_storage_users (id, cold_storage_id, name, mobile_number, password, access_type)
     VALUES ($1, $2, 'RBF User', $3, 'smoke', 'edit')`,
    [USER_ID, coldStorageId, `9${Date.now().toString().slice(-9)}`],
  );
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, cold_storage_id) VALUES ($1, $2, $3)`,
    [SESSION_TOKEN, USER_ID, coldStorageId],
  );

  return { coldStorageId, chamberId, farmerLedgerId, lotIds };
}

interface LotResult {
  id: string;
  remainingSize: number;
  quality: string;
}

async function main(): Promise<void> {
  await wipeByPrefix();

  const { registerRoutes } = await import("../server/routes.ts");
  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const fixtures = await setupFixtures();
  const { coldStorageId, lotIds } = fixtures;

  const authHeaders = {
    "content-type": "application/json",
    "x-auth-token": SESSION_TOKEN,
  };

  let failures = 0;

  try {
    // -------------------------------------------------------------------------
    // Test 1: remainingBags=true returns only lots with remainingSize > 0
    // -------------------------------------------------------------------------
    const r1 = await fetch(
      `${baseUrl}/api/lots/search?type=filter&remainingBags=true`,
      { headers: authHeaders },
    );
    if (!r1.ok) {
      failures++;
      console.error(`Test 1 FAIL — HTTP ${r1.status}: ${await r1.text()}`);
    } else {
      const all = (await r1.json()) as LotResult[];

      // Filter down to just the lots created by this run so concurrent runs
      // and pre-existing data don't cause false failures.
      const ours = all.filter((l) => lotIds.includes(l.id));

      // Lots with remaining bags: lot0 (remaining=50) and lot1 (remaining=30)
      const expectedIds = new Set([lotIds[0], lotIds[1]]);
      const returnedIds = new Set(ours.map((l) => l.id));

      const missing = [...expectedIds].filter((id) => !returnedIds.has(id));
      const unexpected = ours.filter(
        (l) => !expectedIds.has(l.id) || (l.remainingSize ?? 0) <= 0,
      );

      if (missing.length === 0 && unexpected.length === 0) {
        console.log(
          `Test 1 (remainingBags=true): ok — ${ours.length} fixture lot(s) returned, all have remainingSize > 0`,
        );
      } else {
        failures++;
        if (missing.length > 0) {
          console.error(
            `Test 1 FAIL — lots with remaining bags were missing from response: ${missing.join(", ")}`,
          );
        }
        if (unexpected.length > 0) {
          console.error(
            `Test 1 FAIL — lots with remainingSize ≤ 0 appeared in response: ` +
              unexpected.map((l) => `${l.id} (remainingSize=${l.remainingSize})`).join(", "),
          );
        }
      }

      // Sanity: every lot in the full response (across all cold storages)
      // must have remainingSize > 0 — the filter must hold globally, not
      // just for our fixtures.
      const globalViolators = all.filter((l) => (l.remainingSize ?? 0) <= 0);
      if (globalViolators.length > 0) {
        failures++;
        console.error(
          `Test 1 FAIL (global) — ${globalViolators.length} lot(s) with remainingSize ≤ 0 in response: ` +
            globalViolators
              .slice(0, 5)
              .map((l) => `${l.id} (remainingSize=${l.remainingSize})`)
              .join(", ") +
            (globalViolators.length > 5 ? ` … and ${globalViolators.length - 5} more` : ""),
        );
      }
    }

    // -------------------------------------------------------------------------
    // Test 2: remainingBags=true AND quality=good returns only the intersection
    // (lot0: remaining=50 AND quality=good). lot1 has remaining=30 but
    // quality=average so it must NOT appear. lot2 has quality=good but
    // remaining=0 so it must NOT appear either.
    // -------------------------------------------------------------------------
    const r2 = await fetch(
      `${baseUrl}/api/lots/search?type=filter&remainingBags=true&quality=good`,
      { headers: authHeaders },
    );
    if (!r2.ok) {
      failures++;
      console.error(`Test 2 FAIL — HTTP ${r2.status}: ${await r2.text()}`);
    } else {
      const all2 = (await r2.json()) as LotResult[];
      const ours2 = all2.filter((l) => lotIds.includes(l.id));

      // Only lot0 should survive both gates.
      const expectedId = lotIds[0];
      const returnedIds2 = new Set(ours2.map((l) => l.id));

      const missing2 = returnedIds2.has(expectedId) ? [] : [expectedId];
      // lot1 (remaining=30, quality=average) must be absent.
      // lot2 (remaining=0, quality=good) must be absent.
      const badIds = [lotIds[1], lotIds[2], lotIds[3]].filter((id) =>
        returnedIds2.has(id),
      );

      if (missing2.length === 0 && badIds.length === 0) {
        console.log(
          `Test 2 (remainingBags=true AND quality=good): ok — only the intersection lot (lot0) returned`,
        );
      } else {
        failures++;
        if (missing2.length > 0) {
          console.error(
            `Test 2 FAIL — expected lot missing from AND result: ${missing2.join(", ")}`,
          );
        }
        if (badIds.length > 0) {
          console.error(
            `Test 2 FAIL — lots that should have been excluded by AND appear in response: ` +
              badIds
                .map((id) => {
                  const l = ours2.find((x) => x.id === id);
                  return `${id} (remainingSize=${l?.remainingSize}, quality=${l?.quality})`;
                })
                .join(", "),
          );
        }
      }

      // Global: every lot returned must have quality=good AND remainingSize > 0.
      const globalBad2 = all2.filter(
        (l) => l.quality !== "good" || (l.remainingSize ?? 0) <= 0,
      );
      if (globalBad2.length > 0) {
        failures++;
        console.error(
          `Test 2 FAIL (global) — ${globalBad2.length} lot(s) violate remainingBags AND quality=good: ` +
            globalBad2
              .slice(0, 5)
              .map((l) => `${l.id} (remainingSize=${l.remainingSize}, quality=${l.quality})`)
              .join(", ") +
            (globalBad2.length > 5 ? ` … and ${globalBad2.length - 5} more` : ""),
        );
      }
    }

    // -------------------------------------------------------------------------
    // Test 3: without remainingBags, zero-remaining lots are visible — confirms
    // our zero-remaining fixtures exist and are reachable, so a future change
    // that accidentally hides all lots would still be caught as a Test 1/2
    // false-negative rather than a silent pass.
    // -------------------------------------------------------------------------
    const r3 = await fetch(
      `${baseUrl}/api/lots/search?type=filter&quality=good`,
      { headers: authHeaders },
    );
    if (!r3.ok) {
      failures++;
      console.error(`Test 3 FAIL — HTTP ${r3.status}: ${await r3.text()}`);
    } else {
      const all3 = (await r3.json()) as LotResult[];
      const ours3 = all3.filter((l) => lotIds.includes(l.id));
      // Without remainingBags=true, both good-quality lots (lot0 and lot2)
      // should come back.
      const goodLotIds = new Set([lotIds[0], lotIds[2]]);
      const returnedIds3 = new Set(ours3.map((l) => l.id));
      const missing3 = [...goodLotIds].filter((id) => !returnedIds3.has(id));
      if (missing3.length === 0) {
        console.log(
          `Test 3 (no remainingBags filter, quality=good): ok — zero-remaining good-quality lot is visible without filter`,
        );
      } else {
        failures++;
        console.error(
          `Test 3 FAIL — expected good-quality lots not returned without remainingBags: ${missing3.join(", ")}`,
        );
      }
    }
  } finally {
    await wipeByPrefix();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\nRemaining Bags filter regression check FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log(`\nRemaining Bags filter regression check passed.`);
}

main().catch(async (err) => {
  console.error("Regression check crashed:", err);
  try { await wipeByPrefix(); } catch { /* best effort */ }
  try { await pool.end(); } catch { /* best effort */ }
  process.exit(1);
});
