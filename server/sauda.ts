import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { buyerLedger, lots, lotSauda, salesHistory, saudaSaleSources } from "@shared/schema";
import { db } from "./db";

export const saudaInput = z.object({
  quantity: z.number().int().positive().max(2147483647),
  buyerLedgerId: z.string().min(1),
}).strict();
export const saudaSelectionsInput = z.array(z.object({
  saudaId: z.string().min(1),
  quantity: z.number().int().positive().max(2147483647),
}).strict()).max(1000);
export type SaudaSelection = z.infer<typeof saudaSelectionsInput>[number];
export interface SaudaSource extends SaudaSelection {
  buyerLedgerId: string;
  buyerName: string;
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class SaudaError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readSauda(coldStorageId: string) {
  return db.select({
    id: lotSauda.id, lotId: lotSauda.lotId,
    buyerLedgerId: lotSauda.buyerLedgerId, quantity: lotSauda.quantity,
    buyerInitials: buyerLedger.initials, buyerName: buyerLedger.buyerName,
  }).from(lotSauda)
    .innerJoin(lots, and(eq(lots.id, lotSauda.lotId), eq(lots.coldStorageId, coldStorageId)))
    .innerJoin(buyerLedger, and(eq(buyerLedger.id, lotSauda.buyerLedgerId), eq(buyerLedger.coldStorageId, coldStorageId)))
    .where(eq(lotSauda.coldStorageId, coldStorageId)).orderBy(lotSauda.id);
}

// Caller holds the tenant and lot locks. remainingSize is preserved for stock
// display, but inconsistent legacy sales must not allow new over-allocation.
export async function saudaAvailability(tx: Tx, lot: typeof lots.$inferSelect) {
  const [sold] = await tx.select({ n: sql<number>`coalesce(sum(${salesHistory.quantitySold}),0)` })
    .from(salesHistory).where(and(eq(salesHistory.lotId, lot.id), eq(salesHistory.coldStorageId, lot.coldStorageId)));
  return Math.max(0, Math.min(lot.remainingSize, lot.size - Number(sold.n)));
}

export async function saveSauda(coldStorageId: string, lotId: string, body: unknown, saudaId?: string) {
  const input = saudaInput.parse(body);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM cold_storages WHERE id = ${coldStorageId} FOR UPDATE`);
    const [lot] = await tx.select().from(lots)
      .where(and(eq(lots.id, lotId), eq(lots.coldStorageId, coldStorageId))).for("update");
    if (!lot) throw new SaudaError(404, "Lot not found");
    const entries = await tx.select().from(lotSauda)
      .where(and(eq(lotSauda.lotId, lotId), eq(lotSauda.coldStorageId, coldStorageId)));
    if (saudaId && !entries.some(s => s.id === saudaId)) {
      throw new SaudaError(409, "This Sauda is no longer open. Refresh the lot and select an open Sauda.");
    }
    const available = await saudaAvailability(tx, lot);
    const max = Math.max(0, available - entries.filter(s => s.id !== saudaId).reduce((n, s) => n + s.quantity, 0));
    if (input.quantity > max) throw new SaudaError(409, `Only ${max} bag(s) available for this Sauda. Refresh the lot or reduce the quantity.`);
    const [buyer] = await tx.select().from(buyerLedger)
      .where(and(eq(buyerLedger.id, input.buyerLedgerId), eq(buyerLedger.coldStorageId, coldStorageId)));
    if (!buyer || buyer.isArchived === 1) throw new SaudaError(400, "Select an active existing buyer from this cold storage");
    const id = saudaId ?? randomUUID();
    if (saudaId) {
      await tx.update(lotSauda).set({ ...input, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(lotSauda.id, id), eq(lotSauda.lotId, lotId), eq(lotSauda.coldStorageId, coldStorageId)));
    } else {
      await tx.insert(lotSauda).values({ id, lotId, coldStorageId, ...input });
    }
    return { id, lotId, ...input, buyerInitials: buyer.initials, buyerName: buyer.buyerName };
  });
}

export async function prepareSaudaConversion(tx: Tx, lot: typeof lots.$inferSelect, soldBags: number, selections: SaudaSelection[] = []) {
  saudaSelectionsInput.parse(selections);
  const entries = await tx.select({
    id: lotSauda.id, quantity: lotSauda.quantity,
    buyerLedgerId: lotSauda.buyerLedgerId, buyerName: buyerLedger.buyerName,
  }).from(lotSauda).innerJoin(buyerLedger, and(
    eq(buyerLedger.id, lotSauda.buyerLedgerId), eq(buyerLedger.coldStorageId, lot.coldStorageId),
  )).where(and(eq(lotSauda.lotId, lot.id), eq(lotSauda.coldStorageId, lot.coldStorageId)));
  const ids = new Set<string>();
  const sources: SaudaSource[] = selections.map(selection => {
    const entry = entries.find(e => e.id === selection.saudaId);
    if (ids.has(selection.saudaId) || !entry || selection.quantity > entry.quantity) {
      throw new SaudaError(409, `Lot ${lot.lotNo}: selected Sauda changed or is invalid. Refresh and select its available quantity.`);
    }
    ids.add(selection.saudaId);
    return { ...selection, buyerLedgerId: entry.buyerLedgerId, buyerName: entry.buyerName };
  });
  const selected = sources.reduce((n, s) => n + s.quantity, 0);
  const available = await saudaAvailability(tx, lot);
  const open = entries.reduce((n, s) => n + s.quantity, 0);
  if (selected > soldBags || soldBags > available || soldBags + open - selected > available) {
    throw new SaudaError(409, `Lot ${lot.lotNo}: ${Math.max(0, available - open)} unassigned bag(s). Select sufficient open Sauda quantities for this sale, without exceeding sold bags.`);
  }
  return sources;
}

export async function consumeSaudas(tx: Tx, coldStorageId: string, lotId: string, saleId: string, sources: SaudaSource[]) {
  for (const source of sources) {
    const where = and(eq(lotSauda.id, source.saudaId), eq(lotSauda.lotId, lotId), eq(lotSauda.coldStorageId, coldStorageId));
    const [entry] = await tx.select().from(lotSauda).where(where);
    if (!entry || entry.quantity < source.quantity) throw new SaudaError(409, "Selected Sauda changed. Refresh and try again.");
    await tx.insert(saudaSaleSources).values({ id: randomUUID(), coldStorageId, lotId, saleId, ...source });
    if (entry.quantity === source.quantity) await tx.delete(lotSauda).where(where);
    else await tx.update(lotSauda).set({ quantity: entry.quantity - source.quantity, updatedAt: sql`clock_timestamp()` }).where(where);
  }
}
