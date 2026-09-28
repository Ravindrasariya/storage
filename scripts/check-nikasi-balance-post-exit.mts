#!/usr/bin/env tsx
/**
 * Regression guard: Nikasi Balance must reflect state AFTER the exit being
 * printed — the just-exited bags must be subtracted out, not still counted
 * as pending/un-exited.
 *
 * Task #405. getLotBalances(coldStorageId, requests) computes a lot's
 * point-in-time Balance as `unsold + nonExited`, both filtered to only
 * count sales_history / exit_history rows whose `createdAt` is <= the
 * request's `asOf` cutoff. Both print paths (single-lot ExitDialog and
 * Master Nikasi) pass the JUST-CREATED exit's own `createdAt` as `asOf`, so
 * that exit's row is expected to satisfy `createdAt <= asOf` by definition
 * (it's a self-comparison).
 *
  * That invariant broke for Master Nikasi specifically: createMasterNikasi
 * stamped the new sales_history row's `createdAt` with an app-side
 * `new Date()` call, while the sibling exit_history row relied on the
 * column's DB-side `defaultNow()`. Postgres's `now()` is pinned to the
 * TRANSACTION's start instant, not the current statement — so real
 * wall-clock work inside the transaction (locking the cold-storage row,
 * looking up farmer records, per-row charge math) could push the sale's
 * `new Date()` timestamp to AFTER the transaction-start instant the exit's
 * `defaultNow()` recorded. getLotBalances' `sale.createdAt <= asOf` filter
 * would then exclude the very sale the fresh exit belongs to, so its bags
 * were counted as fully unsold on the receipt printed immediately after
 * (Balance = full lot size, not lot size minus the just-exited bags).
 *
  * New Master Nikasi rows share a DB transaction-start timestamp. Existing
  * rows written before that fix still have the skew, so the balance query
  * must also recognize a sale as existing when its exit exists by the cutoff.
 *
 * What this script asserts (over real HTTP routes against a real DB):
 *   1. POST /api/farmers/master-nikasi (single-row batch): the balance
 *      resolved via POST /api/lots/balances, using the response's own
 *      exitCreatedAt as asOf, subtracts the just-exited bags.
  *   2. Reprints of pre-fix Master Nikasi exits, including a fully-exited
  *      24-bag lot, deduct the current exit despite the legacy clock skew.
  *   3. Single-lot exit flow (POST /api/sales-history/:id/exits, called
 *      twice on the same sale): each freshly-created exit's own createdAt
 *      as asOf resolves a balance that includes ALL exits up to and
 *      including itself.
 *
 * Run manually:
 *   DATABASE_URL=postgres://... tsx scripts/check-nikasi-balance-post-exit.mts
 *
 * Exit code: 0 on success, 1 on any failure.
 *
 * Cleanup: every fixture is tagged with a `__nikbal_smoke_` prefixed
 * cold-storage id and wiped at start AND in the finally block. Leftovers
 * from a crashed run:
 *   DELETE FROM cold_storages WHERE id LIKE '__nikbal_smoke_%';
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

const PREFIX = "__nikbal_smoke_";
const RUN_ID = `${PREFIX}${Date.now()}_${process.pid}`;

async function wipeByPrefix(): Promise<void> {
  for (const t of ["cash_receipts", "exit_history", "sales_history", "lots", "chambers", "farmer_ledger", "user_sessions", "cold_storage_users"]) {
    const col = t === "cold_storage_users" || t === "user_sessions" ? "cold_storage_id" : "cold_storage_id";
    await pool.query(`DELETE FROM ${t} WHERE ${col} LIKE $1`, [`${PREFIX}%`]);
  }
  await pool.query(`DELETE FROM cold_storages WHERE id LIKE $1`, [`${PREFIX}%`]);
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

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(msg);
  };

  const csId = `${RUN_ID}_cs`;
  const chamberId = `${RUN_ID}_chamber`;
  const userId = `${RUN_ID}_user`;
  const token = `${RUN_ID}_token`;
  const farmerLedgerId = `${RUN_ID}_fl`;
  const authHeaders = { "content-type": "application/json", "x-auth-token": token };

  try {
    await pool.query(
      `INSERT INTO cold_storages (
         id, name, total_capacity, wafer_rate, seed_rate,
         wafer_cold_charge, wafer_hammali, seed_cold_charge, seed_hammali,
         charge_unit, linked_phones,
         next_exit_bill_number, next_cold_storage_bill_number, next_sales_bill_number,
         next_entry_bill_number, next_wafer_lot_number, next_ration_seed_lot_number,
         starting_wafer_lot_number, starting_ration_seed_lot_number, status
       ) VALUES ($1, 'Nikasi Balance Smoke CS', 10000, 100, 100, 50, 10, 50, 10, 'bag', '{}', 1,1,1,1,1,1,1,1,'active')`,
      [csId],
    );
    await pool.query(
      `INSERT INTO cold_storage_users (id, cold_storage_id, name, mobile_number, password, access_type)
       VALUES ($1, $2, 'Smoke User', $3, 'smoke', 'edit')`,
      [userId, csId, `9${Date.now().toString().slice(-9)}`],
    );
    await pool.query(
      `INSERT INTO user_sessions (id, user_id, cold_storage_id) VALUES ($1, $2, $3)`,
      [token, userId, csId],
    );
    await pool.query(
      `INSERT INTO chambers (id, cold_storage_id, name, capacity, current_fill)
       VALUES ($1, $2, 'C1', 10000, 0)`,
      [chamberId, csId],
    );
    await pool.query(
      `INSERT INTO farmer_ledger (
         id, cold_storage_id, farmer_id, name, contact_number, village,
         tehsil, district, state, entity_type, is_flagged, is_archived
       ) VALUES ($1, $2, $3, 'Smoke Farmer', '0000000000', 'X', 'X', 'X', 'X', 'farmer', 0, 0)`,
      [farmerLedgerId, csId, `FMNB${Date.now()}`],
    );

    // ------------------------------------------------------------------
    // Test 1: Master Nikasi batch (createMasterNikasi) — the bug's origin.
    // ------------------------------------------------------------------
    const lotMnId = `${RUN_ID}_lot_mn`;
    await pool.query(
      `INSERT INTO lots (
         id, cold_storage_id, farmer_name, village, tehsil, district, state,
         contact_number, lot_no, size, remaining_size, chamber_id, floor,
         position, type, bag_type, quality, potato_size, assaying_type,
         up_for_sale, sale_status, base_cold_charges_billed, farmer_ledger_id
       ) VALUES ($1, $2, 'Smoke Farmer', 'V', 'T', 'D', 'S', '9999999999', 'LMN', 100, 100, $3, 0,
         'P1', 'seed', 'seed', 'good', 'large', 'self', 0, 'unsold', 0, $4)`,
      [lotMnId, csId, chamberId, farmerLedgerId],
    );

    const mnRes = await fetch(`${baseUrl}/api/farmers/master-nikasi`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        farmerLedgerId,
        exitDate: new Date().toISOString().slice(0, 10),
        rows: [{
          lotId: lotMnId,
          exitBags: 40,
          soldBags: 40,
          chargeBasis: "actual",
          kataCharges: 0,
          extraHammaliPerBag: 0,
          gradingCharges: 0,
        }],
      }),
    });
    if (!mnRes.ok) {
      fail(`Test 1 FAIL — master-nikasi request failed: ${mnRes.status} ${await mnRes.text()}`);
    } else {
      const mnData = await mnRes.json() as { sharedExitBillNumber: number; sales: Array<{ lotId: string; exitCreatedAt: string }> };
      const row = mnData.sales.find(s => s.lotId === lotMnId);
      if (!row) {
        fail(`Test 1 FAIL — master-nikasi response missing sale row for lot`);
      } else {
        const balRes = await fetch(`${baseUrl}/api/lots/balances`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ items: [{ lotId: lotMnId, asOf: row.exitCreatedAt }] }),
        });
        const balances = await balRes.json() as Record<string, number>;
        if (balances[lotMnId] !== 60) {
          fail(
            `Test 1 FAIL — Master Nikasi Balance right after exit should be 60 (100 - 40 just-exited), ` +
              `got ${balances[lotMnId]}. This means the just-created sale/exit pair's timestamps ` +
              `disagree (sale.createdAt landed AFTER exit.createdAt), so getLotBalances' asOf cutoff ` +
              `excluded the sale and its bags still show as un-exited.`,
          );
        } else {
          console.log("Test 1 (Master Nikasi fresh-print balance): ok — 60 (just-exited bags subtracted)");
        }

        // Simulate an already-stored Master Nikasi from before Task #405:
        // its JS-stamped sale was created milliseconds AFTER its tx-start
        // DB-stamped exit. Reprinting must still count that exit even though
        // the sale's creation timestamp lies after the receipt's cutoff.
        await pool.query(
          `UPDATE sales_history SET created_at = (
             SELECT e.created_at + interval '60 milliseconds'
             FROM exit_history e WHERE e.sales_history_id = sales_history.id
             LIMIT 1
           ) WHERE cold_storage_id = $1 AND lot_id = $2`,
          [csId, lotMnId],
        );
        const legacyExitRes = await fetch(`${baseUrl}/api/exits/by-bill/${mnData.sharedExitBillNumber}?exitId=${encodeURIComponent((await pool.query(
          `SELECT id FROM exit_history WHERE cold_storage_id = $1 AND lot_id = $2 LIMIT 1`,
          [csId, lotMnId],
        )).rows[0].id)}`, { headers: authHeaders });
        if (!legacyExitRes.ok) {
          fail(`Test 1b FAIL — reprint lookup failed: ${legacyExitRes.status} ${await legacyExitRes.text()}`);
        } else {
          const legacyData = await legacyExitRes.json() as { exits: Array<{ lotId: string; createdAt: string }> };
          const legacyExit = legacyData.exits.find(e => e.lotId === lotMnId);
          if (!legacyExit) {
            fail("Test 1b FAIL — reprint lookup omitted the legacy exit");
          } else {
            const legacyBalanceRes = await fetch(`${baseUrl}/api/lots/balances`, {
              method: "POST", headers: authHeaders,
              body: JSON.stringify({ items: [{ lotId: lotMnId, asOf: legacyExit.createdAt }] }),
            });
            const legacyBalance = await legacyBalanceRes.json() as Record<string, number>;
            if (legacyBalance[lotMnId] !== 60) {
              fail(`Test 1b FAIL — reprinted pre-fix Master Nikasi should show 60 (100 - 40), got ${legacyBalance[lotMnId]}`);
            } else {
              console.log("Test 1b (legacy Master Nikasi reprint balance): ok — 60");
            }
          }
        }
      }
    }

    // A fully-exited 24-bag lot matches the originally reported symptom:
    // before the legacy-row fix its printed balance incorrectly stayed 24.
    const lotFullId = `${RUN_ID}_lot_full`;
    await pool.query(
      `INSERT INTO lots (
         id, cold_storage_id, farmer_name, village, tehsil, district, state,
         contact_number, lot_no, size, remaining_size, chamber_id, floor,
         position, type, bag_type, quality, potato_size, assaying_type,
         up_for_sale, sale_status, base_cold_charges_billed, farmer_ledger_id
       ) VALUES ($1, $2, 'Smoke Farmer', 'V', 'T', 'D', 'S', '9999999999', 'LFULL', 24, 24, $3, 0,
         'P1', 'seed', 'seed', 'good', 'large', 'self', 0, 'unsold', 0, $4)`,
      [lotFullId, csId, chamberId, farmerLedgerId],
    );
    const fullRes = await fetch(`${baseUrl}/api/farmers/master-nikasi`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({
        farmerLedgerId,
        exitDate: new Date().toISOString().slice(0, 10),
        rows: [{
          lotId: lotFullId, exitBags: 24, soldBags: 24, chargeBasis: "actual",
          kataCharges: 0, extraHammaliPerBag: 0, gradingCharges: 0,
        }],
      }),
    });
    if (!fullRes.ok) {
      fail(`Test 1c FAIL — full-lot Master Nikasi request failed: ${fullRes.status} ${await fullRes.text()}`);
    } else {
      const fullData = await fullRes.json() as { sales: Array<{ lotId: string; exitCreatedAt: string }> };
      const fullRow = fullData.sales.find(s => s.lotId === lotFullId);
      if (!fullRow) {
        fail("Test 1c FAIL — full-lot Master Nikasi response missing sale");
      } else {
        await pool.query(
          `UPDATE sales_history SET created_at = (
             SELECT e.created_at + interval '60 milliseconds'
             FROM exit_history e WHERE e.sales_history_id = sales_history.id
             LIMIT 1
           ) WHERE cold_storage_id = $1 AND lot_id = $2`,
          [csId, lotFullId],
        );
        const fullBalRes = await fetch(`${baseUrl}/api/lots/balances`, {
          method: "POST", headers: authHeaders,
          body: JSON.stringify({ items: [{ lotId: lotFullId, asOf: fullRow.exitCreatedAt }] }),
        });
        const fullBalance = await fullBalRes.json() as Record<string, number>;
        if (fullBalance[lotFullId] !== 0) {
          fail(`Test 1c FAIL — fully-exited legacy 24-bag lot should have Balance 0, got ${fullBalance[lotFullId]}`);
        } else {
          console.log("Test 1c (fully-exited legacy Master Nikasi): ok — 0");
        }
      }
    }

    // ------------------------------------------------------------------
    // Test 2: single-lot Exit dialog flow — two sequential exits on the
    // same sale, each print resolving balance with its OWN exit's
    // createdAt as asOf.
    // ------------------------------------------------------------------
    const lotSingleId = `${RUN_ID}_lot_single`;
    const saleSingleId = `${RUN_ID}_sale_single`;
    await pool.query(
      `INSERT INTO lots (
         id, cold_storage_id, farmer_name, village, tehsil, district, state,
         contact_number, lot_no, size, remaining_size, chamber_id, floor,
         position, type, bag_type, quality, potato_size, assaying_type,
         up_for_sale, sale_status, base_cold_charges_billed
       ) VALUES ($1, $2, 'F', 'V', 'T', 'D', 'S', '9999999999', 'LS1', 100, 100, $3, 0,
         'P1', 'seed', 'seed', 'good', 'large', 'self', 0, 'unsold', 1)`,
      [lotSingleId, csId, chamberId],
    );
    await pool.query(
      `INSERT INTO sales_history (
         id, cold_storage_id, lot_id, farmer_name, village, tehsil, district, state,
         contact_number, lot_no, chamber_name, floor, position, potato_type, bag_type,
         quality, original_lot_size, sale_type, quantity_sold, price_per_bag,
         cold_charge, hammali, cold_storage_charge, payment_status, paid_amount,
         paid_cash, paid_account, discount_allocated, due_amount, sale_year, sold_at,
         buyer_name, is_self_sale
       ) VALUES ($1, $2, $3, 'F', 'V', 'T', 'D', 'S', '9999999999', 'LS1', 'C', 0, 'P1', 'X', 'seed',
         'good', 100, 'full', 50, 100, 10, 5, 1000, 'unpaid', 0, 0, 0, 0, 1000, 2026, now(),
         'Buyer1', 0)`,
      [saleSingleId, csId, lotSingleId],
    );

    const exit1Res = await fetch(`${baseUrl}/api/sales-history/${saleSingleId}/exits`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ bagsExited: 20, billNumber: 101 }),
    });
    const exit1 = await exit1Res.json() as { createdAt: string };
    const bal1Res = await fetch(`${baseUrl}/api/lots/balances`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ items: [{ lotId: lotSingleId, asOf: exit1.createdAt }] }),
    });
    const bal1 = await bal1Res.json() as Record<string, number>;
    if (bal1[lotSingleId] !== 80) {
      fail(`Test 2a FAIL — balance right after first exit should be 80 (100 - 20), got ${bal1[lotSingleId]}`);
    } else {
      console.log("Test 2a (single-exit fresh-print balance): ok — 80");
    }

    const exit2Res = await fetch(`${baseUrl}/api/sales-history/${saleSingleId}/exits`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ bagsExited: 30, billNumber: 102 }),
    });
    const exit2 = await exit2Res.json() as { createdAt: string };
    const bal2Res = await fetch(`${baseUrl}/api/lots/balances`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ items: [{ lotId: lotSingleId, asOf: exit2.createdAt }] }),
    });
    const bal2 = await bal2Res.json() as Record<string, number>;
    if (bal2[lotSingleId] !== 50) {
      fail(`Test 2b FAIL — balance right after second exit should be 50 (100 - 50), got ${bal2[lotSingleId]}`);
    } else {
      console.log("Test 2b (second sequential exit fresh-print balance): ok — 50");
    }
  } finally {
    await wipeByPrefix();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\nNikasi Balance post-exit regression check FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log(`\nNikasi Balance post-exit regression check passed.`);
}

main().catch(async (err) => {
  console.error("Regression check crashed:", err);
  try { await wipeByPrefix(); } catch { /* best effort */ }
  try { await pool.end(); } catch { /* best effort */ }
  process.exit(1);
});
