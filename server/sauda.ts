import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { buyerLedger, lots, lotSauda } from "@shared/schema";
import { db } from "./db";

export const saudaInput = z.object({
  quantity: z.number().int().positive().max(2147483647),
  buyerLedgerId: z.string().min(1),
}).strict();

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
    .where(eq(lotSauda.coldStorageId, coldStorageId)).orderBy(lotSauda.updatedAt, lotSauda.id);
}

// Saudas are independent notes, not reservations. There is intentionally no
// comparison with stock, sold bags, other Saudas or Master Nikasi quantities.
export async function saveSauda(coldStorageId: string, lotId: string, body: unknown) {
  const input = saudaInput.parse(body);
  return db.transaction(async tx => {
    const [lot] = await tx.select({ id: lots.id }).from(lots)
      .where(and(eq(lots.id, lotId), eq(lots.coldStorageId, coldStorageId))).for("key share");
    if (!lot) throw new SaudaError(404, "Lot not found");
    const [buyer] = await tx.select().from(buyerLedger)
      .where(and(eq(buyerLedger.id, input.buyerLedgerId), eq(buyerLedger.coldStorageId, coldStorageId))).for("share");
    if (!buyer || buyer.isArchived === 1) throw new SaudaError(400, "Select an active existing buyer from this cold storage");
    const id = randomUUID();
    await tx.insert(lotSauda).values({ id, lotId, coldStorageId, ...input });
    return { id, lotId, ...input, buyerInitials: buyer.initials, buyerName: buyer.buyerName };
  });
}

export async function deleteSauda(coldStorageId: string, lotId: string, saudaId: string) {
  // All three identifiers are checked in the DELETE itself: no stale read
  // can accidentally delete another entry or cross a tenant boundary.
  const deleted = await db.delete(lotSauda).where(and(
    eq(lotSauda.id, saudaId), eq(lotSauda.lotId, lotId), eq(lotSauda.coldStorageId, coldStorageId),
  )).returning({ id: lotSauda.id });
  if (!deleted.length) throw new SaudaError(404, "Sauda not found or already deleted. Refresh the list.");
  return { success: true };
}
