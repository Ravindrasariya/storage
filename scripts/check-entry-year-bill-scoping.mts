#!/usr/bin/env tsx
/**
 * Smoke check: both bill series are numbered per STOCK ENTRY YEAR.
 *
 * Task #354. The Cold Storage Bill # (sales_history.cold_storage_bill_number)
 * and the Exit / Nikasi Bill # (exit_history.bill_number) both restart at 1
 * for each year that stock came INTO the cold store — NOT the year it was
 * sold or exited. A lot that enters in Nov 2026 and leaves in Jan 2027 keeps
 * drawing from the 2026 series.
 *
 * Why this needs a machine check rather than a code comment:
 *
 *   • Neither bill column has a DB unique index. Uniqueness rests entirely
 *     on a FOR UPDATE lock plus a scoped duplicate query. If a future edit
 *     changes the scope predicate on ONE of the several paths that allocate
 *     or validate a bill # (partial sale, master nikasi, explicit assign,
 *     the two edit cascades, the hint endpoints), the paths silently
 *     disagree and duplicates become creatable.
 *
 *   • A Master Nikasi batch has NO batch/group id. Its rows are bound
 *     together only by (bill #, series year). Since numbering restarts per
 *     entry year, a bill # is no longer unique within a sale year, so a
 *     cascade that scopes by the wrong year would rewrite an unrelated
 *     season's batch. That is a silent, cross-batch data corruption — the
 *     exact failure mode with no visible symptom until reconciliation.
 *
 * Every fixture below is deliberately built with ONE sale/exit year shared
 * across TWO entry years. That way any assertion that passes only because
 * the code is still keying off sale/exit date will fail here.
 *
 * What this asserts (over real HTTP routes against a real DB, so route-layer
 * regressions are caught too — not just storage-layer ones):
 *   1. Auto-assign (MAX+1) is per entry year: a 2017-entry sale gets #1 even
 *      though the 2016-entry series is already at #5, and the next
 *      2016-entry sale continues at #6.
 *   2. The next-cs-bill hint endpoint agrees with the allocator for both
 *      entry years (the hint is what the operator sees pre-filled).
 *   3. The same CS bill # may exist once per entry year, but a second use
 *      WITHIN one entry year is still rejected.
 *   4. The CS edit cascade only touches rows in its own entry year.
 *   5. Exit bill # auto-assign is per entry year and ignores the now-dead
 *      cold_storages.next_exit_bill_number lifetime counter.
 *   6. Master Nikasi rejects a batch that spans two entry years, and still
 *      accepts a single-entry-year batch.
 *   7. The exit by-bill GET and edit cascade only see/touch rows in their
 *      own entry year.
 *
 * Run manually:
 *   DATABASE_URL=postgres://... tsx scripts/check-entry-year-bill-scoping.mts
 *
 * Exit code: 0 on success, 1 on any failure.
 *
 * Cleanup: every fixture is tagged with a unique
 * `__entryyear_smoke_<timestamp>` cold-storage / user id and vacuumed both
 * on start and in the finally block. Leftovers from a crashed run:
 *   DELETE FROM cold_storages WHERE id LIKE '__entryyear_smoke_%';
 *   DELETE FROM cold_storage_users WHERE id LIKE '__entryyear_smoke_%';
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

const PREFIX = "__entryyear_smoke_";
const RUN_ID = `${PREFIX}${Date.now()}_${process.pid}`;
const USER_ID = `${RUN_ID}_user`;
const SESSION_TOKEN = `${RUN_ID}_token`;

// Two entry years, ONE shared sale/exit year. Pinned to the past so the
// "not materially in the future" guards can never trip, and >= 2015 so the
// implausible-year guards accept them.
const ENTRY_A = 2016;
const ENTRY_B = 2017;
const ENTRY_INSTANT: Record<number, Date> = {
  [ENTRY_A]: new Date(`${ENTRY_A}-03-01T12:00:00+05:30`),
  [ENTRY_B]: new Date(`${ENTRY_B}-03-01T12:00:00+05:30`),
};
// Deliberately later than BOTH entry years: every sale and exit below shares
// this one calendar year, so nothing here can pass by accident if the code
// regresses to scoping by sale/exit date.
const TXN_YEAR = 2018;
const TXN_DATE = `${TXN_YEAR}-06-15`;
const TXN_INSTANT = new Date(`${TXN_DATE}T12:00:00+05:30`);

async function wipeByPrefix(): Promise<void> {
  await pool.query(
    `DELETE FROM lot_edit_history WHERE lot_id IN (SELECT id FROM lots WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM sale_edit_history WHERE sale_id IN (SELECT id FROM sales_history WHERE cold_storage_id LIKE $1)`,
    [`${PREFIX}%`],
  );
  for (const t of [
    "exit_history",
    "sales_history",
    "lots",
    "chambers",
    "farmer_ledger",
    "buyer_ledger",
  ]) {
    await pool.query(`DELETE FROM ${t} WHERE cold_storage_id LIKE $1`, [`${PREFIX}%`]);
  }
  await pool.query(`DELETE FROM user_sessions WHERE id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM cold_storage_users WHERE id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM cold_storages WHERE id LIKE $1`, [`${PREFIX}%`]);
}

const coldStorageId = RUN_ID;
const chamberId = `${RUN_ID}_ch`;
const farmerLedgerId = `${RUN_ID}_fl`;

async function insertLot(suffix: string, entryYear: number): Promise<string> {
  const lotId = `${RUN_ID}_lot_${suffix}`;
  await pool.query(
    `INSERT INTO lots (
       id, cold_storage_id, farmer_name, village, tehsil, district, state,
       contact_number, lot_no, size, remaining_size, chamber_id, floor,
       position, type, bag_type, quality, potato_size, assaying_type,
       up_for_sale, sale_status, base_cold_charges_billed, farmer_ledger_id,
       created_at
     ) VALUES (
       $1, $2, 'Smoke Farmer', 'X', 'X', 'X', 'X',
       '0000000000', $3, 100, 100, $4, 0,
       'P1', 'seed', 'seed', 'good', 'large', 'self',
       0, 'available', 0, $5,
       $6
     )`,
    [lotId, coldStorageId, `__lot_${suffix}`, chamberId, farmerLedgerId, ENTRY_INSTANT[entryYear]],
  );
  return lotId;
}

/**
 * Insert a sales_history row directly. entry_date is the snapshot the app
 * takes at sale time; we set it explicitly (and pin the parent lot's
 * created_at to match) so the entry-year resolution has a deterministic
 * answer regardless of which of the two sources the code reads.
 */
async function insertSale(
  suffix: string,
  lotId: string,
  entryYear: number,
  csBillNumber: number | null,
  quantitySold = 5,
): Promise<string> {
  const saleId = `${RUN_ID}_sale_${suffix}`;
  await pool.query(
    `INSERT INTO sales_history (
       id, cold_storage_id, farmer_name, village, tehsil, district, state,
       contact_number, lot_no, lot_id, chamber_name, floor, position,
       potato_type, bag_type, quality, original_lot_size, sale_type,
       quantity_sold, price_per_bag, cold_storage_charge, payment_status,
       sale_year, sold_at, cold_storage_bill_number, farmer_ledger_id,
       is_self_sale, entry_date
     ) VALUES (
       $1, $2, 'Smoke Farmer', 'X', 'X', 'X', 'X',
       '0000000000', $3, $4, 'C1', 0, 'P1',
       'seed', 'seed', 'good', 100, 'partial',
       $5, 0, 0, 'due',
       $6, $7, $8, $9,
       1, $10
     )`,
    [
      saleId,
      coldStorageId,
      `__lot_${suffix}`,
      lotId,
      quantitySold,
      TXN_YEAR,
      TXN_INSTANT,
      csBillNumber,
      farmerLedgerId,
      ENTRY_INSTANT[entryYear],
    ],
  );
  return saleId;
}

async function setupFixtures(): Promise<void> {
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
       500, 1, 1, 1, 1, 1, 1, 1, 'active'
     )`,
    // next_exit_bill_number is seeded to 500 on purpose: it is the DEAD
    // lifetime counter. If any allocation path still reads it, the exit
    // assertions below will see 500/501 instead of the per-entry-year 1/2.
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
    [farmerLedgerId, coldStorageId, `FMEY${Date.now()}`],
  );

  await pool.query(
    `INSERT INTO cold_storage_users (id, cold_storage_id, name, mobile_number, password, access_type)
     VALUES ($1, $2, 'Smoke User', $3, 'smoke', 'edit')`,
    [USER_ID, coldStorageId, `9${Date.now().toString().slice(-9)}`],
  );
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, cold_storage_id) VALUES ($1, $2, $3)`,
    [SESSION_TOKEN, USER_ID, coldStorageId],
  );
}

async function saleBill(saleId: string): Promise<number | null> {
  const r = await pool.query(
    `SELECT cold_storage_bill_number FROM sales_history WHERE id = $1`,
    [saleId],
  );
  return r.rowCount === 0 ? null : (r.rows[0].cold_storage_bill_number as number | null);
}

async function saleSoldAtDay(saleId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT to_char(sold_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS d
       FROM sales_history WHERE id = $1`,
    [saleId],
  );
  return r.rowCount === 0 ? null : (r.rows[0].d as string);
}

async function exitBill(exitId: string): Promise<number | null> {
  const r = await pool.query(`SELECT bill_number FROM exit_history WHERE id = $1`, [exitId]);
  return r.rowCount === 0 ? null : (r.rows[0].bill_number as number | null);
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

  await setupFixtures();

  const authHeaders = {
    "content-type": "application/json",
    "x-auth-token": SESSION_TOKEN,
  };

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(msg);
  };

  try {
    // Lots: two per entry year for the numbering tests, plus three reserved
    // for the Master Nikasi batch tests.
    const lotA1 = await insertLot("a1", ENTRY_A);
    const lotA2 = await insertLot("a2", ENTRY_A);
    const lotB1 = await insertLot("b1", ENTRY_B);
    const lotB2 = await insertLot("b2", ENTRY_B);
    const lotMnA1 = await insertLot("mna1", ENTRY_A);
    const lotMnA2 = await insertLot("mna2", ENTRY_A);
    const lotMnB1 = await insertLot("mnb1", ENTRY_B);

    // ------------------------------------------------------------------
    // Test 1: MAX+1 auto-assign is scoped to the ENTRY year.
    // Entry-2016 already holds bill #5. A sale of entry-2017 stock — sold
    // in the SAME calendar year — must still start its own series at #1.
    // ------------------------------------------------------------------
    const saleA1 = await insertSale("a1", lotA1, ENTRY_A, 5);
    const saleB1 = await insertSale("b1", lotB1, ENTRY_B, null);
    const saleA2 = await insertSale("a2", lotA2, ENTRY_A, null);

    const assign = async (saleId: string) => {
      const r = await fetch(`${baseUrl}/api/sales-history/${saleId}/assign-bill-number`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ billType: "coldStorage" }),
      });
      if (!r.ok) return { ok: false as const, status: r.status, text: await r.text() };
      return { ok: true as const, body: (await r.json()) as { billNumber: number } };
    };

    const b1Assign = await assign(saleB1);
    const a2Assign = await assign(saleA2);

    if (!b1Assign.ok || !a2Assign.ok) {
      fail(
        `Test 1 FAIL — assign-bill-number HTTP: ` +
          `B1=${b1Assign.ok ? "ok" : `${b1Assign.status} ${b1Assign.text}`}, ` +
          `A2=${a2Assign.ok ? "ok" : `${a2Assign.status} ${a2Assign.text}`}`,
      );
    } else if (b1Assign.body.billNumber !== 1 || a2Assign.body.billNumber !== 6) {
      fail(
        `Test 1 FAIL — expected entry-${ENTRY_B} sale to get #1 and entry-${ENTRY_A} sale to get #6, ` +
          `got ${b1Assign.body.billNumber} and ${a2Assign.body.billNumber}. ` +
          `(Both sales are in sale year ${TXN_YEAR}; if the series is still keyed on sale year, ` +
          `the ${ENTRY_B}-entry sale would have been given #6.)`,
      );
    } else {
      console.log(
        `Test 1 (CS auto-assign resets per entry year): ok — entry-${ENTRY_B} → #1, entry-${ENTRY_A} → #6`,
      );
    }

    // ------------------------------------------------------------------
    // Test 2: the pre-fill hint must agree with the allocator, per entry
    // year. A hint that disagrees leads the operator to type a number the
    // server then rejects (or worse, silently renumbers).
    // ------------------------------------------------------------------
    const hint = async (lotId: string) => {
      const r = await fetch(
        `${baseUrl}/api/cold-storages/${coldStorageId}/next-cs-bill?lotId=${encodeURIComponent(lotId)}`,
        { headers: authHeaders },
      );
      if (!r.ok) return null;
      return (await r.json()) as { nextBillNumber: number; entryYear: number };
    };
    const hintA = await hint(lotA1);
    const hintB = await hint(lotB1);
    if (!hintA || !hintB) {
      fail("Test 2 FAIL — next-cs-bill hint endpoint did not respond OK");
    } else if (
      hintA.nextBillNumber !== 7 ||
      hintA.entryYear !== ENTRY_A ||
      hintB.nextBillNumber !== 2 ||
      hintB.entryYear !== ENTRY_B
    ) {
      fail(
        `Test 2 FAIL — hints disagree with allocator: ` +
          `entry-${ENTRY_A} hint=${hintA.nextBillNumber} (year ${hintA.entryYear}, expected 7/${ENTRY_A}), ` +
          `entry-${ENTRY_B} hint=${hintB.nextBillNumber} (year ${hintB.entryYear}, expected 2/${ENTRY_B})`,
      );
    } else {
      console.log("Test 2 (next-cs-bill hint matches allocator per entry year): ok");
    }

    // ------------------------------------------------------------------
    // Test 3: bill #5 already exists in entry-2016. Reusing it in
    // entry-2017 must be ALLOWED (separate series); reusing it a second
    // time within entry-2017 must still be REJECTED.
    // ------------------------------------------------------------------
    const saleB2 = await insertSale("b2", lotB2, ENTRY_B, null);
    const saleB3 = await insertSale("b3", lotB2, ENTRY_B, null);

    const setBill = async (saleId: string, newBillNumber: number) =>
      fetch(`${baseUrl}/api/sales-history/cs-bill/none`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ saleId, newBillNumber }),
      });

    const crossYearReuse = await setBill(saleB2, 5);
    if (!crossYearReuse.ok) {
      fail(
        `Test 3a FAIL — reusing #5 in entry-${ENTRY_B} was rejected, but ${ENTRY_A} and ${ENTRY_B} ` +
          `are independent series: ${crossYearReuse.status} ${await crossYearReuse.text()}`,
      );
    } else if ((await saleBill(saleB2)) !== 5) {
      fail(`Test 3a FAIL — #5 not persisted on the entry-${ENTRY_B} sale`);
    } else {
      console.log(`Test 3a (same bill # allowed once per entry year): ok`);
    }

    const sameYearReuse = await setBill(saleB3, 5);
    if (sameYearReuse.ok) {
      fail(
        `Test 3b FAIL — a SECOND use of #5 within entry-${ENTRY_B} was accepted; ` +
          `the duplicate check is no longer enforcing uniqueness inside a series`,
      );
    } else {
      console.log(`Test 3b (duplicate within one entry year still rejected): ok`);
    }

    // ------------------------------------------------------------------
    // Test 4: the CS edit cascade must not cross entry years. Bill #5 now
    // exists in BOTH series. Editing the entry-2016 one must leave the
    // entry-2017 one completely untouched.
    // ------------------------------------------------------------------
    const saleA1b = await insertSale("a1b", lotA1, ENTRY_A, 5); // sibling in the 2016 batch
    const newDay = `${TXN_YEAR}-07-01`;
    const cascadeResp = await fetch(`${baseUrl}/api/sales-history/cs-bill/5`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ saleId: saleA1, newSoldAt: newDay }),
    });
    if (!cascadeResp.ok) {
      fail(`Test 4 FAIL — CS cascade HTTP ${cascadeResp.status}: ${await cascadeResp.text()}`);
    } else {
      const cascade = (await cascadeResp.json()) as { updatedCount: number };
      const a1Day = await saleSoldAtDay(saleA1);
      const a1bDay = await saleSoldAtDay(saleA1b);
      const b2Day = await saleSoldAtDay(saleB2);
      if (cascade.updatedCount !== 2 || a1Day !== newDay || a1bDay !== newDay) {
        fail(
          `Test 4 FAIL — cascade did not cover its own entry-${ENTRY_A} batch: ` +
            `updatedCount=${cascade.updatedCount} (expected 2), a1=${a1Day}, a1b=${a1bDay} (expected ${newDay})`,
        );
      } else if (b2Day !== TXN_DATE) {
        fail(
          `Test 4 FAIL — cascade LEAKED across entry years: the entry-${ENTRY_B} sale sharing bill #5 ` +
            `moved to ${b2Day} (expected untouched at ${TXN_DATE}). This is silent cross-batch corruption.`,
        );
      } else {
        console.log("Test 4 (CS cascade confined to its own entry year): ok — 2 rows, other series untouched");
      }
    }

    // ------------------------------------------------------------------
    // Test 5: exit bill # auto-assign is per entry year, and the dead
    // lifetime counter (seeded to 500) is never consulted.
    // ------------------------------------------------------------------
    const createExit = async (saleId: string) => {
      const r = await fetch(`${baseUrl}/api/sales-history/${saleId}/exits`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ bagsExited: 1, exitDate: TXN_DATE }),
      });
      if (!r.ok) return { ok: false as const, status: r.status, text: await r.text() };
      return { ok: true as const, body: (await r.json()) as { id: string; billNumber: number } };
    };

    const exitA1 = await createExit(saleA1);
    const exitB1 = await createExit(saleB1);
    const exitA2 = await createExit(saleA2);

    if (!exitA1.ok || !exitB1.ok || !exitA2.ok) {
      fail(
        `Test 5 FAIL — exit creation HTTP: ` +
          `A1=${exitA1.ok ? "ok" : `${exitA1.status} ${exitA1.text}`}, ` +
          `B1=${exitB1.ok ? "ok" : `${exitB1.status} ${exitB1.text}`}, ` +
          `A2=${exitA2.ok ? "ok" : `${exitA2.status} ${exitA2.text}`}`,
      );
    } else if (
      exitA1.body.billNumber !== 1 ||
      exitB1.body.billNumber !== 1 ||
      exitA2.body.billNumber !== 2
    ) {
      fail(
        `Test 5 FAIL — expected entry-${ENTRY_A}: #1 then #2, entry-${ENTRY_B}: #1. Got ` +
          `A1=${exitA1.body.billNumber}, B1=${exitB1.body.billNumber}, A2=${exitA2.body.billNumber}. ` +
          `Values near 500 mean the dead next_exit_bill_number lifetime counter is being read again.`,
      );
    } else {
      console.log(
        `Test 5 (exit auto-assign resets per entry year, lifetime counter ignored): ok — A:1,2 / B:1`,
      );
    }

    // ------------------------------------------------------------------
    // Test 6: Master Nikasi must refuse a batch that spans entry years —
    // one shared bill # cannot belong to two series — but must still
    // accept a single-entry-year batch.
    // ------------------------------------------------------------------
    const mn = async (lotIds: string[]) =>
      fetch(`${baseUrl}/api/farmers/master-nikasi`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          farmerLedgerId,
          buyerLedgerId: null,
          exitDate: TXN_DATE,
          rows: lotIds.map((lotId) => ({
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

    const mixedResp = await mn([lotMnA1, lotMnB1]);
    if (mixedResp.ok) {
      fail(
        `Test 6a FAIL — a Master Nikasi spanning entry ${ENTRY_A} and ${ENTRY_B} was ACCEPTED. ` +
          `Its single shared bill # would be ambiguous across two series and the edit cascade ` +
          `could never reassemble the batch.`,
      );
    } else {
      const msg = ((await mixedResp.json()) as { error?: string }).error ?? "";
      if (!/different stock entry years/i.test(msg)) {
        fail(`Test 6a FAIL — rejected, but not for the entry-year reason. Message: ${msg}`);
      } else {
        console.log("Test 6a (mixed-entry-year Master Nikasi rejected): ok");
      }
    }

    const sameYearResp = await mn([lotMnA1, lotMnA2]);
    if (!sameYearResp.ok) {
      fail(
        `Test 6b FAIL — a single-entry-year Master Nikasi was rejected: ` +
          `${sameYearResp.status} ${await sameYearResp.text()}`,
      );
    } else {
      const mnResult = (await sameYearResp.json()) as { sharedExitBillNumber: number };
      // Entry-2016 exits are at #2 after Test 5, so the batch takes #3.
      if (mnResult.sharedExitBillNumber !== 3) {
        fail(
          `Test 6b FAIL — batch took exit bill #${mnResult.sharedExitBillNumber}, expected #3 ` +
            `(continuing the entry-${ENTRY_A} series)`,
        );
      } else {
        console.log("Test 6b (single-entry-year Master Nikasi accepted, continues its series): ok");
      }
    }

    // ------------------------------------------------------------------
    // Test 7: exit bill #1 now exists in both series. The by-bill lookup
    // and the exit cascade must each see only their own entry year.
    // ------------------------------------------------------------------
    if (exitA1.ok && exitB1.ok) {
      const byBillResp = await fetch(
        `${baseUrl}/api/exits/by-bill/1?exitId=${encodeURIComponent(exitA1.body.id)}`,
        { headers: authHeaders },
      );
      if (!byBillResp.ok) {
        fail(`Test 7a FAIL — by-bill GET ${byBillResp.status}: ${await byBillResp.text()}`);
      } else {
        const rows = ((await byBillResp.json()) as { exits: { exitId: string }[] }).exits;
        const ids = rows.map((r) => r.exitId);
        if (ids.length !== 1 || ids[0] !== exitA1.body.id) {
          fail(
            `Test 7a FAIL — by-bill #1 anchored on the entry-${ENTRY_A} exit returned ` +
              `[${ids.join(",")}]; expected only ${exitA1.body.id}. The entry-${ENTRY_B} exit ` +
              `also carries #1 and must not appear.`,
          );
        } else {
          console.log("Test 7a (exit by-bill GET confined to its own entry year): ok");
        }
      }

      const exitCascadeResp = await fetch(
        `${baseUrl}/api/exits/by-bill/1?exitId=${encodeURIComponent(exitA1.body.id)}`,
        {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ newBillNumber: 9 }),
        },
      );
      if (!exitCascadeResp.ok) {
        fail(`Test 7b FAIL — exit cascade HTTP ${exitCascadeResp.status}: ${await exitCascadeResp.text()}`);
      } else {
        const a1Bill = await exitBill(exitA1.body.id);
        const b1Bill = await exitBill(exitB1.body.id);
        if (a1Bill !== 9) {
          fail(`Test 7b FAIL — entry-${ENTRY_A} exit was not renumbered to #9 (got ${a1Bill})`);
        } else if (b1Bill !== 1) {
          fail(
            `Test 7b FAIL — exit cascade LEAKED across entry years: the entry-${ENTRY_B} exit ` +
              `sharing #1 changed to #${b1Bill} (expected untouched at #1)`,
          );
        } else {
          console.log("Test 7b (exit cascade confined to its own entry year): ok");
        }
      }
    }
    // ------------------------------------------------------------------
    // Test 8: an OPERATOR-TYPED CS bill # on a new sale must collide by
    // entry year, across sale years.
    //
    // This is the case the earlier tests miss. Every assertion above works
    // on sales that already exist; this one goes through sale CREATION,
    // which has its own duplicate check inside the insert transaction. The
    // scenario that breaks a sale-year-scoped check is mundane and will
    // happen every January: two sales of the SAME 2016-entry stock, one
    // dated December, one dated January. They belong to one series and must
    // collide — a sale-year check sees 2016 vs 2017 and lets both through.
    // ------------------------------------------------------------------
    const lotDec = await insertLot("dec", ENTRY_A);
    const lotJan = await insertLot("jan", ENTRY_A);
    const lotNewSeason = await insertLot("newseason", ENTRY_B);

    const partialSale = async (lotId: string, soldAt: string, csBill: number) =>
      fetch(`${baseUrl}/api/lots/${lotId}/partial-sale`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
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
          coldStorageBillNumber: csBill,
          soldAt,
        }),
      });

    const decResp = await partialSale(lotDec, `${ENTRY_A}-12-20`, 77);
    if (!decResp.ok) {
      fail(`Test 8a FAIL — first explicit #77 on entry-${ENTRY_A} stock rejected: ${decResp.status} ${await decResp.text()}`);
    } else {
      console.log(`Test 8a (explicit CS #77 accepted on entry-${ENTRY_A} stock): ok`);
    }

    const janResp = await partialSale(lotJan, `${ENTRY_B}-01-10`, 77);
    if (janResp.ok) {
      fail(
        `Test 8b FAIL — #77 was accepted a SECOND time within the entry-${ENTRY_A} series just because ` +
          `the sale was dated in January of the next calendar year. This is the January duplicate: ` +
          `two bills numbered 77 in one series, with no DB unique index to catch it.`,
      );
    } else {
      console.log(`Test 8b (same-entry-year reuse across sale years rejected): ok`);
    }

    const newSeasonResp = await partialSale(lotNewSeason, `${ENTRY_B}-06-10`, 77);
    if (!newSeasonResp.ok) {
      fail(
        `Test 8c FAIL — #77 on entry-${ENTRY_B} stock was rejected: ${newSeasonResp.status} ` +
          `${await newSeasonResp.text()}. It shares a SALE year with 8b but belongs to a different series.`,
      );
    } else {
      console.log(`Test 8c (same bill # in the next entry-year series accepted): ok`);
    }

    // Test 8d: the same collision, asserted one layer down. The route runs a
    // cheap pre-flight duplicate check before it mutates anything, so 8b
    // above would still pass if ONLY the pre-flight were entry-scoped. The
    // authoritative check is the one inside createSalesHistory's transaction,
    // under the cold-storage row lock — that is the one that has to hold when
    // two operators submit at once. Call it directly to prove it.
    const { storage } = await import("../server/storage.ts");
    const lotDirect = await insertLot("direct", ENTRY_A);
    let directRejected = false;
    let directError = "";
    try {
      await storage.createSalesHistory(
        {
          coldStorageId,
          farmerName: "Smoke Farmer",
          village: "X",
          tehsil: "X",
          district: "X",
          state: "X",
          contactNumber: "0000000000",
          lotNo: "__lot_direct",
          lotId: lotDirect,
          chamberName: "C1",
          floor: 0,
          position: "P1",
          potatoType: "seed",
          bagType: "seed",
          quality: "good",
          originalLotSize: 100,
          saleType: "partial",
          quantitySold: 1,
          pricePerBag: 0,
          coldStorageCharge: 0,
          paymentStatus: "due",
          // Sale year deliberately differs from the entry year.
          saleYear: ENTRY_B,
          soldAt: new Date(`${ENTRY_B}-02-01T12:00:00+05:30`),
          entryDate: ENTRY_INSTANT[ENTRY_A],
          farmerLedgerId,
          isSelfSale: 1,
        } as never,
        { userColdStorageBillNumber: 77 },
      );
    } catch (err) {
      directRejected = true;
      directError = err instanceof Error ? err.message : String(err);
    }
    if (!directRejected) {
      fail(
        `Test 8d FAIL — createSalesHistory's LOCKED duplicate check accepted a second #77 in the ` +
          `entry-${ENTRY_A} series (sale dated ${ENTRY_B}). The route pre-check alone is not enough: ` +
          `it runs outside the transaction, so concurrent submits bypass it.`,
      );
    } else if (!/already used/i.test(directError)) {
      fail(`Test 8d FAIL — rejected, but not as a duplicate. Message: ${directError}`);
    } else {
      console.log("Test 8d (locked transactional dup check is entry-year scoped): ok");
    }

    // ------------------------------------------------------------------
    // Test 10: the bill # hints must answer for the lot they are ASKED
    // about, not for "some lot of this farmer".
    //
    // Master Nikasi pre-fills both shared bill # inputs from these hints
    // and then SUBMITS whatever is in them as explicit numbers. So if the
    // dialog anchors its hint on the wrong lot — say the farmer's first
    // available lot rather than the row the operator actually picked — a
    // farmer holding stock from two seasons gets the other series' number
    // written into this batch, with no error at any layer. Pinning the
    // per-lot behaviour of the endpoints here is what makes that class of
    // client bug detectable.
    // ------------------------------------------------------------------
    // Push the entry-A CS series ahead of entry-B's so the two hints can't
    // agree by coincidence — otherwise a hint anchored on the wrong lot
    // would return the right number by luck and the test would pass blind.
    const lotBump = await insertLot("bump", ENTRY_A);
    const bumpResp = await partialSale(lotBump, `${ENTRY_A}-12-22`, 90);
    if (!bumpResp.ok) fail(`Test 10 setup FAIL — could not advance the entry-${ENTRY_A} CS series: ${await bumpResp.text()}`);

    const seriesMax = async (table: "cs" | "exit", entryYear: number) => {
      const q = table === "cs"
        ? `SELECT COALESCE(MAX(cold_storage_bill_number), 0) AS m FROM sales_history sh
             WHERE sh.cold_storage_id = $1
               AND extract(year from COALESCE(sh.entry_date, (SELECT l.created_at FROM lots l WHERE l.id = sh.lot_id)))::int = $2`
        : `SELECT COALESCE(MAX(eh.bill_number), 0) AS m FROM exit_history eh
             WHERE eh.cold_storage_id = $1
               AND extract(year from COALESCE(
                     (SELECT sh.entry_date FROM sales_history sh WHERE sh.id = eh.sales_history_id),
                     (SELECT l.created_at FROM lots l WHERE l.id = eh.lot_id)))::int = $2`;
      const res = await pool.query(q, [coldStorageId, entryYear]);
      return Number(res.rows[0].m) + 1;
    };

    for (const kind of ["next-cs-bill", "next-exit-bill"] as const) {
      const anchors: Array<[string, number]> = [[lotDec, ENTRY_A], [lotNewSeason, ENTRY_B]];
      const seen: number[] = [];
      for (const [lotId, expectedYear] of anchors) {
        const resp = await fetch(
          `${baseUrl}/api/cold-storages/${coldStorageId}/${kind}?lotId=${encodeURIComponent(lotId)}`,
          { headers: authHeaders },
        );
        const body = await resp.json();
        const expected = await seriesMax(kind === "next-cs-bill" ? "cs" : "exit", expectedYear);
        if (body.entryYear !== expectedYear || body.nextBillNumber !== expected) {
          fail(
            `Test 10 FAIL — ${kind} anchored on the entry-${expectedYear} lot returned ` +
              `{entryYear: ${body.entryYear}, nextBillNumber: ${body.nextBillNumber}}, expected ` +
              `{entryYear: ${expectedYear}, nextBillNumber: ${expected}}.`,
          );
        }
        seen.push(body.nextBillNumber);
      }
      if (seen[0] === seen[1]) {
        fail(
          `Test 10 FAIL — ${kind} returned the same number (${seen[0]}) for lots from two different ` +
            `entry years, so this check can no longer detect a hint anchored on the wrong lot. ` +
            `Adjust the fixtures so the two series are genuinely at different positions.`,
        );
      }
    }
    console.log("Test 10 (bill # hints answer per anchor lot, not per farmer): ok");

    // ------------------------------------------------------------------
    // Test 9: no ordinary allocation above may have touched the dead
    // lifetime counter. Test 5 proves it is not READ; this proves normal
    // sale/exit/nikasi traffic does not WRITE it either, so a future reader
    // can't mistake a moving value for a live counter. (Cold-storage reset
    // is out of scope here — it wipes the whole tenant, which would destroy
    // every fixture the tests above depend on.)
    // ------------------------------------------------------------------
    const counterRow = await pool.query(
      `SELECT next_exit_bill_number FROM cold_storages WHERE id = $1`,
      [coldStorageId],
    );
    const counterNow = counterRow.rows[0]?.next_exit_bill_number;
    if (counterNow !== 500) {
      fail(
        `Test 9 FAIL — cold_storages.next_exit_bill_number moved from its seeded 500 to ${counterNow}. ` +
          `The column is deprecated and must be left alone; a moving value invites a future change to ` +
          `treat it as authoritative again.`,
      );
    } else {
      console.log("Test 9 (dead lifetime exit counter never written): ok — still 500");
    }
  } finally {
    await wipeByPrefix();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\nEntry-year bill scoping check FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log(`\nEntry-year bill scoping check passed.`);
}

main().catch(async (err) => {
  console.error("Entry-year bill scoping check crashed:", err);
  try { await wipeByPrefix(); } catch { /* best effort */ }
  try { await pool.end(); } catch { /* best effort */ }
  process.exit(1);
});
