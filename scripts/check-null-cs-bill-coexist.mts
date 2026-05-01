#!/usr/bin/env tsx
/**
 * Smoke check: NULL is a first-class CS Bill # value.
 *
 * Task #256 made the cold-storage bill # column on sales_history nullable
 * AND removed the dup check whenever the bill # is NULL — multiple sales
 * in the same cold storage and same year can all have no CS Bill #
 * without being flagged as duplicates. The collision check uses
 * `eq(coldStorageBillNumber, X)`, which by SQL three-valued logic never
 * matches NULL, so any number of bill-less sales coexist freely and only
 * collide when an operator types a duplicate positive integer.
 *
 * The risk this script guards against: a future cleanup tightens the dup
 * check (e.g. swaps `eq(...)` for `IS NOT DISTINCT FROM`, or adds a
 * "bill # required" pre-check, or drops the `if (userCsBill != null)`
 * gate) and quietly rejects a second NULL. Such a regression would be
 * invisible until a real-world second NULL-bill sale hit production.
 *
 * What this script asserts (against a real DB, exercising HTTP routes —
 * the same path the UI takes — so route-layer regressions are caught
 * too, not just storage-layer ones):
 *   1. POST /api/lots/:id/partial-sale called twice with
 *      coldStorageBillNumber=null in the same year both succeed and the
 *      DB rows land with NULL coldStorageBillNumber.
 *   2. POST /api/farmers/master-nikasi with sharedColdStorageBillNumber
 *      omitted on a batch where every selected lot is already
 *      base-billed lands every row with NULL coldStorageBillNumber AND
 *      returns sharedColdStorageBillNumber: null.
 *   3. PATCH /api/sales-history/cs-bill/:billNumber?year=YYYY with
 *      newBillNumber=null clears an existing positive bill # to NULL
 *      for both a single-row case AND a sibling cascade where two sales
 *      share the same bill # in the same year.
 *
 * Run manually:
 *   DATABASE_URL=postgres://... tsx scripts/check-null-cs-bill-coexist.mts
 *
 * Exit code: 0 on success, 1 on any failure.
 *
 * Cleanup: All fixtures (cold storage, chamber, farmer ledger, lots,
 * sales, exit history, edit history, smoke user/session) are tagged
 * with a unique `__null_csbill_smoke_<timestamp>` cold-storage id and
 * `__null_csbill_smoke_user_<timestamp>` user id so they can be vacuumed
 * on script start AND in the finally block. If the script ever crashes
 * mid-run, leftover rows can be cleaned with:
 *   DELETE FROM cold_storages WHERE id LIKE '__null_csbill_smoke_%';
 *   DELETE FROM cold_storage_users WHERE id LIKE '__null_csbill_smoke_%';
 *   (the FK-less child tables are cleaned by the PREFIX_CLEANUP block
 *   below — same logic as the start-of-run wipe.)
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

// All fixtures share this prefix on their cold_storage_id / user id so
// the start-of-run wipe + finally-block cleanup find them with a single
// LIKE pattern, no matter which child table they live in.
const PREFIX = "__null_csbill_smoke_";
const RUN_ID = `${PREFIX}${Date.now()}_${process.pid}`;
const USER_ID = `${RUN_ID}_user`;
const SESSION_TOKEN = `${RUN_ID}_token`;

async function wipeByPrefix(): Promise<void> {
  // Order: child tables first (no FKs are declared in the schema, but the
  // app code treats cold_storage_id as the tenancy boundary, so we wipe
  // every table that carries it). Each query is keyed by the prefix so
  // this is safe to run before AND after the test.
  const childTablesByCsId = [
    "exit_history",
    "sales_history",
    "lots",
    "chambers",
    "farmer_ledger",
    "buyer_ledger",
  ];

  // lot_edit_history / sale_edit_history don't carry cold_storage_id —
  // clean them by their parent's prefix BEFORE we wipe the parents.
  await pool.query(
    `DELETE FROM lot_edit_history WHERE lot_id IN (SELECT id FROM lots WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM sale_edit_history WHERE sale_id IN (SELECT id FROM sales_history WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );

  for (const t of childTablesByCsId) {
    await pool.query(
      `DELETE FROM ${t} WHERE cold_storage_id LIKE $1`,
      [`${PREFIX}%`],
    );
  }

  await pool.query(`DELETE FROM user_sessions WHERE id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM cold_storage_users WHERE id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM cold_storages WHERE id LIKE $1`, [`${PREFIX}%`]);
}

interface Fixtures {
  coldStorageId: string;
  chamberId: string;
  farmerLedgerId: string;
  lotIds: string[];
}

async function setupFixtures(): Promise<Fixtures> {
  const coldStorageId = RUN_ID;
  const chamberId = `${RUN_ID}_ch`;
  const farmerLedgerId = `${RUN_ID}_fl`;
  // Three lots: lots[0]/lots[1] go through partial-sale (test 1),
  // lots[2]/lots[3] go through master-nikasi (test 2). lots[2..3] are
  // pre-flagged base_cold_charges_billed=1 so MN takes the auto-skip
  // NULL-bill path. lots[0..1] are NOT pre-flagged because the
  // partial-sale endpoint only requires the bag-count math to work.
  const lotIds = [
    `${RUN_ID}_lot1`,
    `${RUN_ID}_lot2`,
    `${RUN_ID}_lot3`,
    `${RUN_ID}_lot4`,
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
       $1, 'Smoke CS', 10000, 100, 100,
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
     ) VALUES ($1, $2, $3, 'Smoke Farmer', '0000000000', 'X',
       'X', 'X', 'X', 'farmer', 0, 0)`,
    [farmerLedgerId, coldStorageId, `FMSMOKE${Date.now()}`],
  );

  for (let i = 0; i < lotIds.length; i++) {
    const lotId = lotIds[i];
    // First two lots: partial-sale path → no base flag needed.
    // Last two lots: master-nikasi auto-skip → must be base-billed.
    const baseBilled = i >= 2 ? 1 : 0;
    await pool.query(
      `INSERT INTO lots (
         id, cold_storage_id, farmer_name, village, tehsil, district, state,
         contact_number, lot_no, size, remaining_size, chamber_id, floor,
         position, type, bag_type, quality, potato_size, assaying_type,
         up_for_sale, sale_status, base_cold_charges_billed, farmer_ledger_id
       ) VALUES (
         $1, $2, 'Smoke Farmer', 'X', 'X', 'X', 'X',
         '0000000000', $3, 100, 100, $4, 0,
         'P1', 'seed', 'seed', 'good', 'large', 'self',
         0, 'available', $5, $6
       )`,
      [lotId, coldStorageId, `__lot_${lotId}`, chamberId, baseBilled, farmerLedgerId],
    );
  }

  // Smoke user with edit access + session — required by requireAuth /
  // requireEditAccess on every mutation route under test.
  await pool.query(
    `INSERT INTO cold_storage_users (id, cold_storage_id, name, mobile_number, password, access_type)
     VALUES ($1, $2, 'Smoke User', $3, 'smoke', 'edit')`,
    [USER_ID, coldStorageId, `9${Date.now().toString().slice(-9)}`],
  );
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, cold_storage_id) VALUES ($1, $2, $3)`,
    [SESSION_TOKEN, USER_ID, coldStorageId],
  );

  return { coldStorageId, chamberId, farmerLedgerId, lotIds };
}

async function getSaleBillNumber(saleId: string): Promise<number | null> {
  const r = await pool.query(
    `SELECT cold_storage_bill_number FROM sales_history WHERE id = $1`,
    [saleId],
  );
  if (r.rowCount === 0) return null;
  return r.rows[0].cold_storage_bill_number as number | null;
}

// Pin every test to a fixed past date so multiple runs in the same
// calendar year don't collide through the year-scoped dup check, AND so
// the partial-sale endpoint's "not more than 1 day in the future" guard
// can never trip on us.
const TEST_YEAR = 2000;
const TEST_DATE = `${TEST_YEAR}-06-15`;

async function main(): Promise<void> {
  // Clear leftovers from any prior crashed run before we touch fixtures.
  await wipeByPrefix();

  // Stand up an in-process Express app on an ephemeral port so the
  // HTTP-route assertions below exercise the real auth + validation +
  // error-mapping middleware stack the UI actually hits — not just the
  // storage layer underneath.
  const { registerRoutes } = await import("../server/routes.ts");
  const app = express();
  app.use(express.json());

  // Request counter for /assign-bill-number — used by Test 4 below to
  // prove that the print-resolve read traffic never triggers the
  // bill-promotion endpoint, even indirectly via some future GET-handler
  // side effect. Mounted BEFORE registerRoutes so it observes every hit.
  // Keyed by `${method} ${path-without-id}` so we count both billType
  // values (coldStorage vs sales). The counter resets per test below.
  const assignBillCallLog: { method: string; url: string }[] = [];
  app.use((req, _res, next) => {
    if (/\/api\/sales-history\/[^/]+\/assign-bill-number\b/.test(req.url)) {
      assignBillCallLog.push({ method: req.method, url: req.url });
    }
    next();
  });

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const fixtures = await setupFixtures();
  const { lotIds } = fixtures;

  const authHeaders = {
    "content-type": "application/json",
    "x-auth-token": SESSION_TOKEN,
  };

  let failures = 0;

  try {
    // ---------------------------------------------------------------------
    // Test 1: two NULL-bill partial sales coexist in the same year via
    // the partial-sale HTTP endpoint.
    // ---------------------------------------------------------------------
    const partialSaleBody = (lotId: string) =>
      JSON.stringify({
        quantitySold: 1,
        pricePerBag: 0,
        paymentStatus: "due",
        paidAmount: 0,
        dueAmount: 0,
        position: "P1",
        kataCharges: 0,
        extraHammali: 0,
        gradingCharges: 0,
        chargeBasis: "actual",
        isSelfSale: true,
        coldStorageBillNumber: null,
        soldAt: TEST_DATE,
      });

    const ps1Resp = await fetch(`${baseUrl}/api/lots/${lotIds[0]}/partial-sale`, {
      method: "POST",
      headers: authHeaders,
      body: partialSaleBody(lotIds[0]),
    });
    const ps2Resp = await fetch(`${baseUrl}/api/lots/${lotIds[1]}/partial-sale`, {
      method: "POST",
      headers: authHeaders,
      body: partialSaleBody(lotIds[1]),
    });

    if (!ps1Resp.ok || !ps2Resp.ok) {
      failures++;
      console.error(
        `Test 1 FAIL — partial-sale HTTP failed: ` +
          `ps1=${ps1Resp.status} ${await ps1Resp.text()}, ` +
          `ps2=${ps2Resp.status} ${await ps2Resp.text()}`,
      );
    } else {
      const sale1 = (await ps1Resp.json()) as { id: string };
      const sale2 = (await ps2Resp.json()) as { id: string };
      const sale1Bill = await getSaleBillNumber(sale1.id);
      const sale2Bill = await getSaleBillNumber(sale2.id);
      if (sale1Bill === null && sale2Bill === null) {
        console.log("Test 1 (partial-sale x2 NULL): ok — both rows landed with NULL CS Bill #");
      } else {
        failures++;
        console.error(
          `Test 1 FAIL — sale1=${sale1Bill} sale2=${sale2Bill} (expected null, null)`,
        );
      }
    }

    // ---------------------------------------------------------------------
    // Test 2: master-nikasi auto-skip via the master-nikasi HTTP endpoint
    // — every selected lot is already base-billed and the operator left
    // the shared CS Bill # blank, so every row in the batch must land
    // with NULL.
    // ---------------------------------------------------------------------
    const mnResp = await fetch(`${baseUrl}/api/farmers/master-nikasi`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        farmerLedgerId: fixtures.farmerLedgerId,
        buyerLedgerId: null,
        exitDate: TEST_DATE,
        // sharedColdStorageBillNumber omitted (== undefined) → server
        // takes the auto-skip path because every selected lot is already
        // base-billed.
        rows: [lotIds[2], lotIds[3]].map((lotId) => ({
          lotId,
          exitBags: 1,
          soldBags: 1,
          chargeBasis: "actual",
          kataCharges: 0,
          extraHammaliPerBag: 0,
          gradingCharges: 0,
        })),
      }),
    });

    if (!mnResp.ok) {
      failures++;
      console.error(`Test 2 FAIL — master-nikasi HTTP ${mnResp.status}: ${await mnResp.text()}`);
    } else {
      const mnResult = (await mnResp.json()) as {
        sharedColdStorageBillNumber: number | null;
        sales: { saleId: string; coldStorageBillNumber: number | null }[];
      };
      const allReturnedNull = mnResult.sales.every((s) => s.coldStorageBillNumber === null);
      const sharedReturnedNull = mnResult.sharedColdStorageBillNumber === null;
      const dbBillsForMnSales = await Promise.all(
        mnResult.sales.map((s) => getSaleBillNumber(s.saleId)),
      );
      const allDbNull = dbBillsForMnSales.every((b) => b === null);

      if (allReturnedNull && sharedReturnedNull && allDbNull) {
        console.log(
          `Test 2 (master-nikasi auto-skip): ok — ${mnResult.sales.length} rows, all NULL`,
        );
      } else {
        failures++;
        console.error(
          `Test 2 FAIL — sharedColdStorageBillNumber=${mnResult.sharedColdStorageBillNumber}, ` +
            `returned=[${mnResult.sales.map((s) => s.coldStorageBillNumber).join(",")}], ` +
            `db=[${dbBillsForMnSales.join(",")}]`,
        );
      }
    }

    // ---------------------------------------------------------------------
    // Test 3a: clear a single-row bill # via the Edit cascade endpoint.
    // ---------------------------------------------------------------------
    // Insert a bill-bearing sale via raw SQL so the test stays focused
    // on the clear path. Bill numbers 998/999 are chosen high enough to
    // never collide with the MN-allocated one above (which auto-counts
    // from MAX(...)+1 starting at 0 → 1 in this fresh-prefix run).
    const sale3aId = `${RUN_ID}_sale3a`;
    await pool.query(
      `INSERT INTO sales_history (
         id, cold_storage_id, farmer_name, village, tehsil, district, state,
         contact_number, lot_no, lot_id, chamber_name, floor, position,
         potato_type, bag_type, quality, original_lot_size, sale_type,
         quantity_sold, price_per_bag, cold_storage_charge, payment_status,
         sale_year, sold_at, cold_storage_bill_number, farmer_ledger_id, is_self_sale
       ) VALUES (
         $1, $2, 'Smoke Farmer', 'X', 'X', 'X', 'X',
         '0000000000', '__lot_smoke', $3, 'C1', 0, 'P1',
         'seed', 'seed', 'good', 100, 'partial',
         1, 0, 0, 'due',
         $4, $5, 999, $6, 1
       )`,
      [sale3aId, fixtures.coldStorageId, lotIds[0], TEST_YEAR, new Date(`${TEST_DATE}T12:00:00+05:30`), fixtures.farmerLedgerId],
    );
    const clear3aResp = await fetch(
      `${baseUrl}/api/sales-history/cs-bill/999?year=${TEST_YEAR}`,
      {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ newBillNumber: null }),
      },
    );
    if (!clear3aResp.ok) {
      failures++;
      console.error(`Test 3a FAIL — clear HTTP ${clear3aResp.status}: ${await clear3aResp.text()}`);
    } else {
      const clear3a = (await clear3aResp.json()) as {
        updatedCount: number;
        effectiveBillNumber: number | null;
      };
      const sale3aBill = await getSaleBillNumber(sale3aId);
      if (
        clear3a.updatedCount === 1 &&
        clear3a.effectiveBillNumber === null &&
        sale3aBill === null
      ) {
        console.log("Test 3a (clear single-row bill # via PATCH): ok — bill # cleared to NULL");
      } else {
        failures++;
        console.error(
          `Test 3a FAIL — updatedCount=${clear3a.updatedCount} ` +
            `effectiveBillNumber=${clear3a.effectiveBillNumber} db=${sale3aBill}`,
        );
      }
    }

    // ---------------------------------------------------------------------
    // Test 3b: clear a sibling cascade — two sales sharing the same bill
    // # in the same year both clear in one PATCH call.
    // ---------------------------------------------------------------------
    const sale3bIds = [`${RUN_ID}_sale3b1`, `${RUN_ID}_sale3b2`];
    for (const sId of sale3bIds) {
      await pool.query(
        `INSERT INTO sales_history (
           id, cold_storage_id, farmer_name, village, tehsil, district, state,
           contact_number, lot_no, lot_id, chamber_name, floor, position,
           potato_type, bag_type, quality, original_lot_size, sale_type,
           quantity_sold, price_per_bag, cold_storage_charge, payment_status,
           sale_year, sold_at, cold_storage_bill_number, farmer_ledger_id, is_self_sale
         ) VALUES (
           $1, $2, 'Smoke Farmer', 'X', 'X', 'X', 'X',
           '0000000000', '__lot_smoke', $3, 'C1', 0, 'P1',
           'seed', 'seed', 'good', 100, 'partial',
           1, 0, 0, 'due',
           $4, $5, 998, $6, 1
         )`,
        [sId, fixtures.coldStorageId, lotIds[0], TEST_YEAR, new Date(`${TEST_DATE}T12:00:00+05:30`), fixtures.farmerLedgerId],
      );
    }
    const clear3bResp = await fetch(
      `${baseUrl}/api/sales-history/cs-bill/998?year=${TEST_YEAR}`,
      {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ newBillNumber: null }),
      },
    );
    if (!clear3bResp.ok) {
      failures++;
      console.error(`Test 3b FAIL — clear HTTP ${clear3bResp.status}: ${await clear3bResp.text()}`);
    } else {
      const clear3b = (await clear3bResp.json()) as {
        updatedCount: number;
        effectiveBillNumber: number | null;
      };
      const sale3bBills = await Promise.all(sale3bIds.map(getSaleBillNumber));
      const all3bNull = sale3bBills.every((b) => b === null);
      if (
        clear3b.updatedCount === 2 &&
        clear3b.effectiveBillNumber === null &&
        all3bNull
      ) {
        console.log(
          `Test 3b (clear sibling cascade via PATCH): ok — ${clear3b.updatedCount} sales cleared to NULL`,
        );
      } else {
        failures++;
        console.error(
          `Test 3b FAIL — updatedCount=${clear3b.updatedCount} ` +
            `effectiveBillNumber=${clear3b.effectiveBillNumber} db=[${sale3bBills.join(",")}]`,
        );
      }
    }
    // ---------------------------------------------------------------------
    // Test 4 (Task #260): Opening the print dialog on a NULL-bill sale
    // must not promote it to a real CS Bill #. The client print path
    // calls /api/sales-history (to hydrate the row) and conditionally
    // /api/sales-history/cs-bill-batch (only when bill # is non-null).
    // It must NEVER call POST /assign-bill-number for the deduction
    // path. This test:
    //   a) inserts a NULL-bill sale,
    //   b) hits the read-side endpoints the print dialog uses,
    //   c) asserts the row is still NULL, AND
    //   d) sanity-checks that POST /assign-bill-number STILL works for
    //      the legitimate first-time-assignment button (Task #249) — so
    //      we confirm the endpoint isn't broken, just no longer
    //      side-effected by print.
    // ---------------------------------------------------------------------
    const sale4Id = `${RUN_ID}_sale4`;
    await pool.query(
      `INSERT INTO sales_history (
         id, cold_storage_id, farmer_name, village, tehsil, district, state,
         contact_number, lot_no, lot_id, chamber_name, floor, position,
         potato_type, bag_type, quality, original_lot_size, sale_type,
         quantity_sold, price_per_bag, cold_storage_charge, payment_status,
         sale_year, sold_at, cold_storage_bill_number, farmer_ledger_id, is_self_sale
       ) VALUES (
         $1, $2, 'Smoke Farmer', 'X', 'X', 'X', 'X',
         '0000000000', '__lot_smoke', $3, 'C1', 0, 'P1',
         'seed', 'seed', 'good', 100, 'partial',
         1, 0, 0, 'due',
         $4, $5, NULL, $6, 1
       )`,
      [sale4Id, fixtures.coldStorageId, lotIds[0], TEST_YEAR, new Date(`${TEST_DATE}T12:00:00+05:30`), fixtures.farmerLedgerId],
    );

    // Reset the assign-bill request counter so step (b)'s assertion
    // measures only the print-read traffic — not any prior test.
    assignBillCallLog.length = 0;

    // (b) Hit the read-side endpoint the print dialog uses to hydrate
    // the sale row. The sibling-fetch endpoint (cs-bill-batch) is
    // intentionally NOT called here because the client-side query is
    // gated `enabled: open && csBillNumber != null` — for a NULL-bill
    // sale the print path issues no batch fetch at all. The only
    // network call we exercise here is the sales-history GET; if a
    // regression slips a write side-effect into either GET handler,
    // step (c) will detect it as a column promotion.
    const listResp = await fetch(`${baseUrl}/api/sales-history`, {
      headers: authHeaders,
    });
    if (!listResp.ok) {
      failures++;
      console.error(`Test 4 FAIL — sales-history GET ${listResp.status}: ${await listResp.text()}`);
    }

    // (b.1) Network-level assertion: the print-read traffic above must
    // NOT have caused any /assign-bill-number POST. Catches a future
    // server-side regression that adds a side effect to a GET handler
    // (more direct than (c)'s column-state check).
    if (assignBillCallLog.length !== 0) {
      failures++;
      console.error(
        `Test 4 FAIL — print-read traffic triggered ${assignBillCallLog.length} assign-bill-number call(s): ` +
          JSON.stringify(assignBillCallLog),
      );
    } else {
      console.log("Test 4 (network): ok — no assign-bill-number POST during print-read traffic");
    }

    // (c) Re-read the row directly from the DB after the simulated
    // print-resolve traffic above. If a regression silently re-adds a
    // server-side promote on print, this column will turn positive.
    const sale4Bill = await getSaleBillNumber(sale4Id);
    if (sale4Bill !== null) {
      failures++;
      console.error(
        `Test 4 FAIL — print-resolve simulation promoted NULL → ${sale4Bill} ` +
          `(expected NULL; the deduction print path must not call assign-bill-number)`,
      );
    } else {
      console.log("Test 4 (print resolve preserves NULL): ok — row unchanged after read-side traffic");
    }

    // (d) Sanity counter-check: the assign-bill-number endpoint itself
    // still works when called explicitly (the first-time-assignment
    // button — Task #249 — depends on it). If this regresses, the
    // endpoint has been broken or removed.
    const assignResp = await fetch(
      `${baseUrl}/api/sales-history/${sale4Id}/assign-bill-number`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ billType: "coldStorage" }),
      },
    );
    if (!assignResp.ok) {
      failures++;
      console.error(`Test 4d FAIL — assign-bill-number HTTP ${assignResp.status}: ${await assignResp.text()}`);
    } else {
      const assigned = (await assignResp.json()) as { billNumber: number };
      const sale4BillAfter = await getSaleBillNumber(sale4Id);
      if (typeof assigned.billNumber === "number" && sale4BillAfter === assigned.billNumber) {
        console.log(
          `Test 4d (explicit assign still works for Task #249 button): ok — promoted to #${assigned.billNumber}`,
        );
      } else {
        failures++;
        console.error(
          `Test 4d FAIL — explicit assign returned ${JSON.stringify(assigned)} but db=${sale4BillAfter}`,
        );
      }
    }
  } finally {
    await wipeByPrefix();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\nNULL CS Bill # coexistence smoke check FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log(`\nNULL CS Bill # coexistence smoke check passed.`);
}

main().catch(async (err) => {
  console.error("Smoke check crashed:", err);
  try { await wipeByPrefix(); } catch { /* best effort */ }
  try { await pool.end(); } catch { /* best effort */ }
  process.exit(1);
});
