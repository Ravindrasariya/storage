import { and, eq, sql } from "drizzle-orm";
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
    lotId: lotSauda.lotId,
    buyerLedgerId: lotSauda.buyerLedgerId,
    quantity: lotSauda.quantity,
    buyerInitials: buyerLedger.initials,
  }).from(lotSauda)
    .innerJoin(lots, and(eq(lots.id, lotSauda.lotId), eq(lots.coldStorageId, coldStorageId)))
    .innerJoin(buyerLedger, and(eq(buyerLedger.id, lotSauda.buyerLedgerId), eq(buyerLedger.coldStorageId, coldStorageId)))
    .where(eq(lotSauda.coldStorageId, coldStorageId));
}

export async function saveSauda(coldStorageId: string, lotId: string, body: unknown) {
  const input = saudaInput.parse(body);
  return db.transaction(async tx => {
    // Same lock order as Master Nikasi: tenant, then lot. This makes an
    // availability recheck and marker replacement atomic with finalization.
    await tx.execute(sql`SELECT id FROM cold_storages WHERE id = ${coldStorageId} FOR UPDATE`);
    const [lot] = await tx.select().from(lots)
      .where(and(eq(lots.id, lotId), eq(lots.coldStorageId, coldStorageId))).for("update");
    if (!lot) throw new SaudaError(404, "Lot not found");
    if (input.quantity > lot.remainingSize) {
      throw new SaudaError(400, `Quantity exceeds current remaining bags (${lot.remainingSize})`);
    }
    const [buyer] = await tx.select().from(buyerLedger)
      .where(and(eq(buyerLedger.id, input.buyerLedgerId), eq(buyerLedger.coldStorageId, coldStorageId)));
    if (!buyer) throw new SaudaError(400, "Select an existing buyer from this cold storage");
    await tx.insert(lotSauda).values({ lotId, coldStorageId, ...input })
      .onConflictDoUpdate({
        target: lotSauda.lotId,
        set: { ...input, updatedAt: sql`clock_timestamp()` },
      });
    return { lotId, ...input, buyerInitials: buyer.initials };
  });
}
