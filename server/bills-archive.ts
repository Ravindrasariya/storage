import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { reversedExitsArchive, reversedSalesArchive } from "@shared/schema";
import type { ArchiveRecord } from "@shared/bills-archive";

type Snapshot = Pick<ArchiveRecord, "sale" | "exit" | "lot" | "display">;

/** Used only for raw SQL snapshots/backfill, not for any active business data. */
function camelRow(row: Record<string, any> | null): Record<string, any> | null {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value,
  ]));
}

/**
 * Copy-only setup: creates NEW tables and copies retained legacy exits.
 * No ALTER/UPDATE/DELETE of any existing table, no guessed sale/charge values.
 */
export async function initializeBillsArchive() {
  await db.transaction(async tx => {
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS reversed_sales_archive (
        id VARCHAR PRIMARY KEY, cold_storage_id VARCHAR NOT NULL,
        reversed_at TIMESTAMPTZ, archived_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        operator_name TEXT, source TEXT NOT NULL, snapshot JSONB NOT NULL
      )
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS reversed_exits_archive (
        id VARCHAR PRIMARY KEY, cold_storage_id VARCHAR NOT NULL,
        reversed_at TIMESTAMPTZ, archived_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        operator_name TEXT, source TEXT NOT NULL, snapshot JSONB NOT NULL
      )
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS reversed_sales_archive_tenant_idx ON reversed_sales_archive(cold_storage_id)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS reversed_exits_archive_tenant_idx ON reversed_exits_archive(cold_storage_id)`);
    await tx.execute(sql`
      INSERT INTO reversed_exits_archive (id, cold_storage_id, reversed_at, source, snapshot)
      SELECT e.id, e.cold_storage_id, e.reversed_at, 'legacy',
        jsonb_build_object('exit', to_jsonb(e), 'sale', to_jsonb(s), 'lot', to_jsonb(l),
          'display', '{}'::jsonb)
      FROM exit_history e
      LEFT JOIN sales_history s ON s.id = e.sales_history_id AND s.cold_storage_id = e.cold_storage_id
      LEFT JOIN lots l ON l.id = e.lot_id AND l.cold_storage_id = e.cold_storage_id
      WHERE e.is_reversed = 1
      ON CONFLICT (id) DO NOTHING
    `);
  });
}

/**
 * The existing delete and snapshot insert share ONE SQL statement. Only a row
 * actually deleted is archived; an insert failure rolls back this delete.
 * The caller's original stock/charge calculations are deliberately untouched.
 */
export async function deleteSaleWithArchive(
  saleId: string, snapshot: Snapshot, operatorName?: string,
  runner: Pick<typeof db, "execute"> = db,
) {
  await runner.execute(sql`
    WITH removed AS (
      DELETE FROM sales_history WHERE id = ${saleId} RETURNING *
    )
    INSERT INTO reversed_sales_archive (id, cold_storage_id, reversed_at, operator_name, source, snapshot)
    SELECT r.id, r.cold_storage_id, clock_timestamp(), ${operatorName ?? null}, 'reversal',
      ${JSON.stringify(snapshot)}::jsonb || jsonb_build_object('sale', to_jsonb(r))
    FROM removed r
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * Same soft-reversal predicate/values as before, coupled only to an additive
 * archive insert. UPDATE RETURNING is also the authoritative set of captured
 * exits, so blocked/no-op attempts do not manufacture archive rows.
 */
export async function reverseExitsWithArchive(
  saleId: string, snapshots: Record<string, Snapshot>, operatorName?: string, exitId?: string,
  runner: Pick<typeof db, "execute"> = db,
): Promise<Array<{ id: string; bagsExited: number }>> {
  const result = await runner.execute(sql`
    WITH reversed AS (
      UPDATE exit_history SET is_reversed = 1, reversed_at = ${new Date()}
      WHERE ${exitId ? sql`id = ${exitId}` : sql`sales_history_id = ${saleId} AND is_reversed = 0`}
      RETURNING *
    ), archived AS (
      INSERT INTO reversed_exits_archive (id, cold_storage_id, reversed_at, operator_name, source, snapshot)
      SELECT r.id, r.cold_storage_id, r.reversed_at, ${operatorName ?? null}, 'reversal',
        COALESCE(${JSON.stringify(snapshots)}::jsonb -> r.id,
          jsonb_build_object(
            'sale', (SELECT to_jsonb(s) FROM sales_history s WHERE s.id = r.sales_history_id AND s.cold_storage_id = r.cold_storage_id),
            'lot', (SELECT to_jsonb(l) FROM lots l WHERE l.id = r.lot_id AND l.cold_storage_id = r.cold_storage_id),
            'display', '{}'::jsonb))
          || jsonb_build_object('exit', to_jsonb(r))
      FROM reversed r
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    )
    SELECT id, bags_exited AS "bagsExited" FROM reversed
  `);
  return result.rows as Array<{ id: string; bagsExited: number }>;
}

function toArchiveRecord(row: typeof reversedSalesArchive.$inferSelect): ArchiveRecord {
  const snapshot = row.snapshot as Snapshot;
  const sale = camelRow(snapshot.sale);
  const exit = camelRow(snapshot.exit);
  const lot = camelRow(snapshot.lot);
  // These are retained identifiers/details, not reconstructed historical money.
  // Never substitute current lot balances or charges for missing sale fields.
  const legacyDisplay = exit ? {
    ...(sale ?? {}),
    exitId: exit.id, saleId: exit.salesHistoryId, lotId: exit.lotId,
    exitDate: exit.exitDate, billNumber: exit.billNumber, bagsExited: exit.bagsExited,
    farmerName: sale?.farmerName ?? lot?.farmerName,
    village: sale?.village ?? lot?.village,
    contactNumber: sale?.contactNumber ?? lot?.contactNumber,
    lotNo: sale?.lotNo ?? lot?.lotNo, marka: sale?.marka ?? lot?.marka,
    bagType: sale?.bagType ?? lot?.bagType,
    potatoType: sale?.potatoType ?? lot?.type,
    entryDate: sale?.entryDate ?? lot?.createdAt,
    coldStorageBillNumber: sale?.coldStorageBillNumber,
  } : (sale ?? {});
  return {
    id: row.id, originalId: row.id, coldStorageId: row.coldStorageId,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt.toISOString(), operatorName: row.operatorName,
    source: row.source as ArchiveRecord["source"],
    sale, exit, lot,
    display: { ...legacyDisplay, ...(snapshot.display ?? {}) },
  };
}

export async function getBillsArchive(coldStorageId: string, kind: "sales" | "exits", id?: string) {
  const table = kind === "sales" ? reversedSalesArchive : reversedExitsArchive;
  const rows = await db.select().from(table)
    .where(and(eq(table.coldStorageId, coldStorageId), id ? eq(table.id, id) : undefined))
    .orderBy(desc(table.reversedAt), desc(table.archivedAt), desc(table.id));
  return rows.map(toArchiveRecord);
}
