#!/usr/bin/env node
/**
 * Concurrency smoke check for the baseColdChargesBilled compare-and-set
 * (CAS) used by both the partial-sale path (server/routes.ts) and the
 * Master Nikasi path (server/storage.ts createMasterNikasi). See
 * Task #253 for the underlying race-condition write-up.
 *
 * What this checks:
 *   1. With N concurrent UPDATE-with-predicate calls against a single lot
 *      whose baseColdChargesBilled = 0, exactly ONE is reported as the
 *      winner (UPDATE returned a row); the rest report 0 rows. This
 *      proves Postgres serialises predicate-gated UPDATEs the way the
 *      CAS implementation in DatabaseStorage.claimBaseColdCharges
 *      depends on.
 *   2. After the burst, lots.baseColdChargesBilled is exactly 1
 *      (idempotent flip — second wave from a different "loser" cannot
 *      bump it higher).
 *
 * What this DOES NOT check:
 *   - The downstream sale-row creation, edit history, or charge-amount
 *     math. Those are integration-level concerns; the CAS itself is the
 *     race-safety primitive and is what this guards against.
 *
 * Why this script: Task #253 explicitly requires "a short concurrency
 * smoke check confirms the guarantee". Running this against a real DB
 * is the cheapest, most direct evidence the fix works.
 *
 * Run manually:
 *   DATABASE_URL=postgres://... node scripts/check-base-cold-charges-cas.mjs
 *
 * Exit code: 0 on success, 1 on any failure (so the script is CI-friendly).
 *
 * Cleanup: Inserts a single throwaway lot (UUID), runs the check, then
 * deletes it. If the script crashes mid-run the throwaway lot may remain
 * — its lotNo starts with "__cas_smoke_" so it's easy to identify and
 * clean up manually with:
 *   DELETE FROM lots WHERE lot_no LIKE '__cas_smoke_%';
 */

import pg from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CONCURRENCY = 16;
const ROUNDS = 5;

async function main() {
  // Pick any existing cold storage + chamber so the FK constraints pass.
  // We intentionally don't create our own — every dev DB already has one
  // from prior testing, and creating extras would clutter the workspace.
  const csRow = await pool.query("SELECT id FROM cold_storages LIMIT 1");
  if (csRow.rowCount === 0) {
    throw new Error("No cold_storages row exists; run the app once to create one before running this smoke check.");
  }
  const coldStorageId = csRow.rows[0].id;

  const chRow = await pool.query(
    "SELECT id FROM chambers WHERE cold_storage_id = $1 LIMIT 1",
    [coldStorageId],
  );
  if (chRow.rowCount === 0) {
    throw new Error("No chambers row exists for the chosen cold storage.");
  }
  const chamberId = chRow.rows[0].id;

  const testLotId = randomUUID();
  const testLotNo = `__cas_smoke_${Date.now()}`;

  // Minimal insert: most columns have defaults / nullable. We only need
  // the columns required by the lots schema NOT NULL constraints to
  // create a usable test row. Adjust if the schema gains required fields.
  await pool.query(
    `INSERT INTO lots (
       id, cold_storage_id, chamber_id, lot_no, farmer_name, contact_number,
       village, tehsil, district, state, type, bag_type, quality,
       assaying_type, size, remaining_size, floor, position,
       base_cold_charges_billed
     ) VALUES (
       $1, $2, $3, $4, 'CAS Smoke', '0000000000', 'X', 'X', 'X', 'X',
       'seed', 'seed', 'good', 'self', 100, 100, 0, 'A1', 0
     )`,
    [testLotId, coldStorageId, chamberId, testLotNo],
  );

  let failures = 0;
  try {
    for (let round = 1; round <= ROUNDS; round++) {
      // Reset flag to 0 before each round.
      await pool.query(
        "UPDATE lots SET base_cold_charges_billed = 0 WHERE id = $1",
        [testLotId],
      );

      // Fire CONCURRENCY parallel CAS attempts. This mirrors what
      // DatabaseStorage.claimBaseColdCharges does, written in raw SQL so
      // the smoke check has zero dependency on the app code path.
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          pool.query(
            "UPDATE lots SET base_cold_charges_billed = 1 WHERE id = $1 AND base_cold_charges_billed = 0 RETURNING id",
            [testLotId],
          ),
        ),
      );
      const winners = results.filter((r) => r.rowCount === 1).length;
      const losers = results.filter((r) => r.rowCount === 0).length;

      const flagRow = await pool.query(
        "SELECT base_cold_charges_billed AS f FROM lots WHERE id = $1",
        [testLotId],
      );
      const finalFlag = flagRow.rows[0].f;

      const ok = winners === 1 && losers === CONCURRENCY - 1 && finalFlag === 1;
      if (!ok) {
        failures++;
        console.error(
          `Round ${round}: FAIL — winners=${winners} losers=${losers} flag=${finalFlag} ` +
            `(expected winners=1, losers=${CONCURRENCY - 1}, flag=1)`,
        );
      } else {
        console.log(`Round ${round}: ok — 1 winner, ${CONCURRENCY - 1} losers, flag=1`);
      }
    }
  } finally {
    // Always clean up, even on failure.
    await pool.query("DELETE FROM lots WHERE id = $1", [testLotId]);
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\nbaseColdChargesBilled CAS smoke check FAILED: ${failures}/${ROUNDS} rounds`);
    process.exit(1);
  }
  console.log(`\nbaseColdChargesBilled CAS smoke check passed (${ROUNDS} rounds, ${CONCURRENCY} concurrent each).`);
}

main().catch((err) => {
  console.error("Smoke check crashed:", err);
  process.exit(1);
});
