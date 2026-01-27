import { randomUUID } from "crypto";
import { eq, and, or, like, ilike, desc, sql, gte, lte, inArray, type SQL } from "drizzle-orm";
import { db } from "./db";
import {
  coldStorages,
  coldStorageUsers,
  userSessions,
  chambers,
  chamberFloors,
  lots,
  lotEditHistory,
  salesHistory,
  saleEditHistory,
  maintenanceRecords,
  exitHistory,
  cashReceipts,
  expenses,
  cashTransfers,
  cashOpeningBalances,
  openingReceivables,
  openingPayables,
  dailyIdCounters,
  discounts,
  type ColdStorage,
  type InsertColdStorage,
  type ColdStorageUser,
  type InsertColdStorageUser,
  type UserSession,
  type Chamber,
  type InsertChamber,
  type ChamberFloor,
  type InsertChamberFloor,
  type Lot,
  type InsertLot,
  type LotEditHistory,
  type InsertLotEditHistory,
  type SalesHistory,
  type InsertSalesHistory,
  type SaleEditHistory,
  type InsertSaleEditHistory,
  type MaintenanceRecord,
  type InsertMaintenanceRecord,
  type ExitHistory,
  type InsertExitHistory,
  type CashReceipt,
  type InsertCashReceipt,
  type Expense,
  type InsertExpense,
  type CashTransfer,
  type InsertCashTransfer,
  type CashOpeningBalance,
  type InsertCashOpeningBalance,
  type OpeningReceivable,
  type InsertOpeningReceivable,
  type OpeningPayable,
  type InsertOpeningPayable,
  type Discount,
  type InsertDiscount,
  type DashboardStats,
  type QualityStats,
  type PaymentStats,
  type MerchantStats,
  calculateProportionalEntryDeductions,
} from "@shared/schema";

// Entity type prefixes for sequential IDs
export type EntityType = 'cold_storage' | 'lot' | 'sales' | 'cash_flow';
const ENTITY_PREFIXES: Record<EntityType, string> = {
  cold_storage: 'CS',
  lot: 'LT',
  sales: 'SL',
  cash_flow: 'CF',
};

// Generate a sequential ID in format: PREFIX + YYYYMMDD + counter (no zero-padding)
// Example: LT202601251, LT202601252, ... LT20260125100
// For cash_flow entity type, coldStorageId is required to make IDs unique per cold store
export async function generateSequentialId(entityType: EntityType, coldStorageId?: string): Promise<string> {
  // Enforce coldStorageId for cash_flow to prevent accidental global IDs
  if (entityType === 'cash_flow' && !coldStorageId) {
    throw new Error('coldStorageId is required for cash_flow entity type');
  }
  
  const now = new Date();
  const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  // For cash_flow, include coldStorageId to make IDs unique per cold store
  const rowId = entityType === 'cash_flow' && coldStorageId 
    ? `${entityType}_${coldStorageId}_${dateKey}` 
    : `${entityType}_${dateKey}`;
  const prefix = ENTITY_PREFIXES[entityType];

  // Atomic increment pattern: Try UPDATE first, then INSERT if no row exists
  // This ensures unique counters even under concurrent access
  const updateResult = await db
    .update(dailyIdCounters)
    .set({ counter: sql`${dailyIdCounters.counter} + 1` })
    .where(eq(dailyIdCounters.id, rowId))
    .returning({ counter: dailyIdCounters.counter });

  if (updateResult.length > 0) {
    return `${prefix}${dateKey}${updateResult[0].counter}`;
  }

  // No existing row - try to insert (use onConflictDoNothing in case of race)
  await db
    .insert(dailyIdCounters)
    .values({
      id: rowId,
      entityType,
      dateKey,
      counter: 0, // Start at 0, first update will make it 1
    })
    .onConflictDoNothing();

  // Now do the atomic update to get the counter
  const finalResult = await db
    .update(dailyIdCounters)
    .set({ counter: sql`${dailyIdCounters.counter} + 1` })
    .where(eq(dailyIdCounters.id, rowId))
    .returning({ counter: dailyIdCounters.counter });

  return `${prefix}${dateKey}${finalResult[0]?.counter || 1}`;
}

export interface IStorage {
  initializeDefaultData(): Promise<void>;
  getColdStorage(id: string): Promise<ColdStorage | undefined>;
  getDefaultColdStorage(): Promise<ColdStorage>;
  getChambers(coldStorageId: string): Promise<Chamber[]>;
  getChamber(id: string): Promise<Chamber | undefined>;
  getFloorCapacityByChamber(coldStorageId: string): Promise<Record<string, { floor: number; bags: number }[]>>;
  // Chamber floors
  getChamberFloors(chamberId: string): Promise<ChamberFloor[]>;
  getChamberFloor(id: string): Promise<ChamberFloor | undefined>;
  getAllChamberFloors(coldStorageId: string): Promise<Record<string, ChamberFloor[]>>;
  createChamberFloor(data: InsertChamberFloor): Promise<ChamberFloor>;
  updateChamberFloor(id: string, updates: Partial<ChamberFloor>): Promise<ChamberFloor | undefined>;
  deleteChamberFloor(id: string): Promise<boolean>;
  deleteFloorsByChamber(chamberId: string): Promise<void>;
  updateChamberFill(id: string, fill: number): Promise<void>;
  createLot(lot: InsertLot): Promise<Lot>;
  createBatchLots(lots: InsertLot[], coldStorageId: string, bagTypeCategory?: "wafer" | "rationSeed"): Promise<{ lots: Lot[]; entrySequence: number }>;
  getNextEntrySequence(coldStorageId: string): Promise<number>;
  getLot(id: string): Promise<Lot | undefined>;
  updateLot(id: string, updates: Partial<Lot>): Promise<Lot | undefined>;
  searchLots(type: "phone", query: string, coldStorageId: string): Promise<Lot[]>;
  searchLotsByLotNoAndSize(lotNo: string, size: string, coldStorageId: string): Promise<Lot[]>;
  searchLotsByFarmerName(query: string, coldStorageId: string, village?: string, contactNumber?: string): Promise<Lot[]>;
  getAllLots(coldStorageId: string): Promise<Lot[]>;
  getLotsByEntrySequence(entrySequence: number, coldStorageId: string): Promise<Lot[]>;
  createEditHistory(history: InsertLotEditHistory): Promise<LotEditHistory>;
  getLotHistory(lotId: string): Promise<LotEditHistory[]>;
  deleteEditHistory(historyId: string): Promise<void>;
  getDashboardStats(coldStorageId: string): Promise<DashboardStats>;
  getQualityStats(coldStorageId: string, year?: number): Promise<QualityStats>;
  getPaymentStats(coldStorageId: string, year?: number): Promise<PaymentStats>;
  getMerchantStats(coldStorageId: string, year?: number): Promise<MerchantStats>;
  getAnalyticsYears(coldStorageId: string): Promise<number[]>;
  checkResetEligibility(coldStorageId: string): Promise<{ canReset: boolean; remainingBags: number; remainingLots: number }>;
  resetSeason(coldStorageId: string): Promise<void>;
  finalizeSale(lotId: string, paymentStatus: "due" | "paid" | "partial", buyerName?: string, pricePerKg?: number, paidAmount?: number, dueAmount?: number, paymentMode?: "cash" | "account", kataCharges?: number, extraHammali?: number, gradingCharges?: number, netWeight?: number, customColdCharge?: number, customHammali?: number): Promise<Lot | undefined>;
  updateColdStorage(id: string, updates: Partial<ColdStorage>): Promise<ColdStorage | undefined>;
  createChamber(data: { name: string; capacity: number; coldStorageId: string }): Promise<Chamber>;
  updateChamber(id: string, updates: Partial<Chamber>): Promise<Chamber | undefined>;
  deleteChamber(id: string): Promise<boolean>;
  // Sales History
  createSalesHistory(data: InsertSalesHistory): Promise<SalesHistory>;
  getSalesHistory(coldStorageId: string, filters?: {
    year?: number;
    farmerName?: string;
    village?: string;
    contactNumber?: string;
    paymentStatus?: "paid" | "due";
    buyerName?: string;
  }): Promise<SalesHistory[]>;
  markSaleAsPaid(saleId: string): Promise<SalesHistory | undefined>;
  getSalesYears(coldStorageId: string): Promise<number[]>;
  reverseSale(saleId: string): Promise<{ success: boolean; lot?: Lot; message?: string; errorType?: string; buyerName?: string; coldStorageId?: string }>;
  updateSalesHistoryForTransfer(saleId: string, updates: {
    clearanceType: string;
    transferToBuyerName: string;
    transferGroupId: string;
    transferDate: Date;
    transferRemarks: string | null;
    transferTransactionId?: string;
    paymentStatus?: string;
    paidAmount?: number;
    dueAmount?: number;
  }): Promise<SalesHistory | undefined>;
  // Maintenance Records
  getMaintenanceRecords(coldStorageId: string): Promise<MaintenanceRecord[]>;
  createMaintenanceRecord(data: InsertMaintenanceRecord): Promise<MaintenanceRecord>;
  updateMaintenanceRecord(id: string, updates: Partial<MaintenanceRecord>): Promise<MaintenanceRecord | undefined>;
  deleteMaintenanceRecord(id: string): Promise<boolean>;
  // Sale Edit History
  getSaleEditHistory(saleId: string): Promise<SaleEditHistory[]>;
  createSaleEditHistory(data: InsertSaleEditHistory): Promise<SaleEditHistory>;
  // Exit History
  createExit(data: InsertExitHistory): Promise<ExitHistory>;
  getExitsForSale(salesHistoryId: string): Promise<ExitHistory[]>;
  getTotalExitedBags(salesHistoryId: string): Promise<number>;
  getTotalBagsExited(coldStorageId: string, year?: number): Promise<number>;
  reverseLatestExit(salesHistoryId: string): Promise<{ success: boolean; message?: string }>;
  // Cash Receipts
  getBuyersWithDues(coldStorageId: string): Promise<{ buyerName: string; totalDue: number }[]>;
  getCashReceipts(coldStorageId: string): Promise<CashReceipt[]>;
  getSalesGoodsBuyers(coldStorageId: string): Promise<string[]>;
  createCashReceiptWithFIFO(data: InsertCashReceipt): Promise<{ receipt: CashReceipt; salesUpdated: number }>;
  // Expenses
  getExpenses(coldStorageId: string): Promise<Expense[]>;
  createExpense(data: InsertExpense): Promise<Expense>;
  // Cash Transfers (Self)
  getCashTransfers(coldStorageId: string): Promise<CashTransfer[]>;
  createCashTransfer(data: InsertCashTransfer): Promise<CashTransfer>;
  reverseCashTransfer(transferId: string): Promise<{ success: boolean; message?: string }>;
  // Reversal
  reverseCashReceipt(receiptId: string): Promise<{ success: boolean; message?: string }>;
  reverseExpense(expenseId: string): Promise<{ success: boolean; message?: string }>;
  // FIFO Recomputation
  recomputeBuyerPayments(buyerName: string, coldStorageId: string): Promise<{ salesUpdated: number; receiptsUpdated: number }>;
  // Admin
  recalculateSalesCharges(coldStorageId: string): Promise<{ updated: number; message: string }>;
  // Bill number assignment
  assignBillNumber(saleId: string, billType: "coldStorage" | "sales"): Promise<number>;
  assignLotBillNumber(lotId: string): Promise<number>;
  // Admin - Cold Storage Management
  getAllColdStorages(): Promise<ColdStorage[]>;
  createColdStorage(data: InsertColdStorage): Promise<ColdStorage>;
  archiveColdStorage(id: string): Promise<boolean>;
  updateColdStorageStatus(id: string, status: 'active' | 'inactive' | 'archived'): Promise<boolean>;
  resetColdStorage(id: string): Promise<boolean>;
  // Cold Storage Users
  getColdStorageUsers(coldStorageId: string): Promise<ColdStorageUser[]>;
  createColdStorageUser(data: InsertColdStorageUser): Promise<ColdStorageUser>;
  updateColdStorageUser(id: string, updates: Partial<ColdStorageUser>): Promise<ColdStorageUser | undefined>;
  deleteColdStorageUser(id: string): Promise<boolean>;
  resetUserPassword(userId: string, newPassword: string): Promise<boolean>;
  // Authentication
  authenticateUser(mobileNumber: string, password: string): Promise<{ user: ColdStorageUser; coldStorage: ColdStorage; blocked?: string } | null>;
  getUserById(userId: string): Promise<ColdStorageUser | undefined>;
  // Session Management
  createSession(token: string, userId: string, coldStorageId: string): Promise<UserSession>;
  getSession(token: string): Promise<UserSession | undefined>;
  deleteSession(token: string): Promise<void>;
  updateSessionLastAccess(token: string): Promise<void>;
  // Export
  getLotsForExport(coldStorageId: string, fromDate: Date, toDate: Date): Promise<Lot[]>;
  getSalesForExport(coldStorageId: string, fromDate: Date, toDate: Date, filters?: { year?: string; farmerName?: string; village?: string; contactNumber?: string; buyerName?: string; paymentStatus?: string }): Promise<SalesHistory[]>;
  getCashDataForExport(coldStorageId: string, fromDate: Date, toDate: Date): Promise<{ receipts: CashReceipt[]; expenses: Expense[]; transfers: CashTransfer[] }>;
  // Farmer lookup for auto-complete
  getFarmerRecords(coldStorageId: string, year?: number): Promise<{ farmerName: string; village: string; tehsil: string; district: string; state: string; contactNumber: string }[]>;
  // Buyer lookup for auto-complete (last 2 years)
  getBuyerRecords(coldStorageId: string): Promise<{ buyerName: string }[]>;
  // Bag type label lookup for auto-complete
  getBagTypeLabels(coldStorageId: string): Promise<{ label: string }[]>;
  // Opening Balances
  getOpeningBalance(coldStorageId: string, year: number): Promise<CashOpeningBalance | undefined>;
  upsertOpeningBalance(data: InsertCashOpeningBalance): Promise<CashOpeningBalance>;
  // Opening Receivables
  getOpeningReceivables(coldStorageId: string, year: number): Promise<OpeningReceivable[]>;
  createOpeningReceivable(data: InsertOpeningReceivable): Promise<OpeningReceivable>;
  deleteOpeningReceivable(id: string): Promise<OpeningReceivable | undefined>;
  // Opening Payables
  getOpeningPayables(coldStorageId: string, year: number): Promise<OpeningPayable[]>;
  createOpeningPayable(data: InsertOpeningPayable): Promise<OpeningPayable>;
  deleteOpeningPayable(id: string): Promise<boolean>;
  // Discounts
  getFarmersWithDues(coldStorageId: string): Promise<{ farmerName: string; village: string; contactNumber: string; totalDue: number }[]>;
  getBuyerDuesForFarmer(coldStorageId: string, farmerName: string, village: string, contactNumber: string): Promise<{ buyerName: string; totalDue: number; latestSaleDate: Date }[]>;
  createDiscountWithFIFO(data: InsertDiscount): Promise<{ discount: Discount; salesUpdated: number }>;
  getDiscounts(coldStorageId: string): Promise<Discount[]>;
  reverseDiscount(discountId: string): Promise<{ success: boolean; message?: string }>;
  getDiscountForFarmerBuyer(coldStorageId: string, farmerName: string, village: string, contactNumber: string, buyerName: string): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async initializeDefaultData(): Promise<void> {
    const existingStorage = await db.select().from(coldStorages).where(eq(coldStorages.id, "cs-default"));
    if (existingStorage.length === 0) {
      await db.insert(coldStorages).values({
        id: "cs-default",
        name: "Main Cold Storage",
        totalCapacity: 50000,
        waferRate: 165,
        seedRate: 170,
        waferColdCharge: 145,
        waferHammali: 20,
        seedColdCharge: 150,
        seedHammali: 20,
        linkedPhones: ["8882589392"],
      });

      const chamberData = [
        { id: "ch-1", name: "Chamber A", capacity: 10000, currentFill: 0, coldStorageId: "cs-default" },
        { id: "ch-2", name: "Chamber B", capacity: 12000, currentFill: 0, coldStorageId: "cs-default" },
        { id: "ch-3", name: "Chamber C", capacity: 8000, currentFill: 0, coldStorageId: "cs-default" },
        { id: "ch-4", name: "Chamber D", capacity: 10000, currentFill: 0, coldStorageId: "cs-default" },
        { id: "ch-5", name: "Chamber E", capacity: 10000, currentFill: 0, coldStorageId: "cs-default" },
      ];

      for (const ch of chamberData) {
        await db.insert(chambers).values(ch);
      }
    }
  }

  async getColdStorage(id: string): Promise<ColdStorage | undefined> {
    const [result] = await db.select().from(coldStorages).where(eq(coldStorages.id, id));
    return result;
  }

  async getDefaultColdStorage(): Promise<ColdStorage> {
    const [result] = await db.select().from(coldStorages).where(eq(coldStorages.id, "cs-default"));
    return result;
  }

  async getChambers(coldStorageId: string): Promise<Chamber[]> {
    return db.select().from(chambers).where(eq(chambers.coldStorageId, coldStorageId)).orderBy(chambers.name);
  }

  async getChamber(id: string): Promise<Chamber | undefined> {
    const [result] = await db.select().from(chambers).where(eq(chambers.id, id));
    return result;
  }

  async getFloorCapacityByChamber(coldStorageId: string): Promise<Record<string, { floor: number; bags: number }[]>> {
    const allLots = await db.select().from(lots).where(eq(lots.coldStorageId, coldStorageId));
    const floorData: Record<string, { floor: number; bags: number }[]> = {};
    
    for (const lot of allLots) {
      // Only include lots with remaining bags and valid floor numbers
      if (lot.remainingSize <= 0) continue;
      if (lot.floor === null || lot.floor === undefined) continue;
      
      if (!floorData[lot.chamberId]) {
        floorData[lot.chamberId] = [];
      }
      
      const existingFloor = floorData[lot.chamberId].find(f => f.floor === lot.floor);
      if (existingFloor) {
        existingFloor.bags += lot.remainingSize;
      } else {
        floorData[lot.chamberId].push({ floor: lot.floor, bags: lot.remainingSize });
      }
    }
    
    // Sort floors by floor number
    for (const chamberId in floorData) {
      floorData[chamberId].sort((a, b) => a.floor - b.floor);
    }
    
    return floorData;
  }

  async getChamberFloors(chamberId: string): Promise<ChamberFloor[]> {
    return db.select().from(chamberFloors).where(eq(chamberFloors.chamberId, chamberId));
  }

  async getChamberFloor(id: string): Promise<ChamberFloor | undefined> {
    const [result] = await db.select().from(chamberFloors).where(eq(chamberFloors.id, id));
    return result;
  }

  async getAllChamberFloors(coldStorageId: string): Promise<Record<string, ChamberFloor[]>> {
    const allChambers = await db.select().from(chambers).where(eq(chambers.coldStorageId, coldStorageId));
    const result: Record<string, ChamberFloor[]> = {};
    
    for (const chamber of allChambers) {
      const floors = await db.select().from(chamberFloors).where(eq(chamberFloors.chamberId, chamber.id));
      result[chamber.id] = floors.sort((a, b) => a.floorNumber - b.floorNumber);
    }
    
    return result;
  }

  async createChamberFloor(data: InsertChamberFloor): Promise<ChamberFloor> {
    const id = randomUUID();
    const [result] = await db.insert(chamberFloors).values({ id, ...data }).returning();
    return result;
  }

  async updateChamberFloor(id: string, updates: Partial<ChamberFloor>): Promise<ChamberFloor | undefined> {
    const [result] = await db.update(chamberFloors).set(updates).where(eq(chamberFloors.id, id)).returning();
    return result;
  }

  async deleteChamberFloor(id: string): Promise<boolean> {
    const result = await db.delete(chamberFloors).where(eq(chamberFloors.id, id));
    return true;
  }

  async deleteFloorsByChamber(chamberId: string): Promise<void> {
    await db.delete(chamberFloors).where(eq(chamberFloors.chamberId, chamberId));
  }

  async updateChamberFill(id: string, fill: number): Promise<void> {
    await db.update(chambers).set({ currentFill: fill }).where(eq(chambers.id, id));
  }

  async createLot(insertLot: InsertLot): Promise<Lot> {
    const id = await generateSequentialId('lot');
    const lotData = {
      ...insertLot,
      id,
      remainingSize: insertLot.remainingSize ?? insertLot.size,
      assayerImage: insertLot.assayerImage ?? null,
      reducingSugar: insertLot.reducingSugar ?? null,
      dm: insertLot.dm ?? null,
      remarks: insertLot.remarks ?? null,
      upForSale: insertLot.upForSale ?? 0,
      saleStatus: insertLot.saleStatus ?? "available",
      paymentStatus: insertLot.paymentStatus ?? null,
      saleCharge: insertLot.saleCharge ?? null,
      totalPaidCharge: insertLot.totalPaidCharge ?? null,
      totalDueCharge: insertLot.totalDueCharge ?? null,
      soldAt: insertLot.soldAt ?? null,
    };

    const [lot] = await db.insert(lots).values(lotData).returning();

    const chamber = await this.getChamber(lot.chamberId);
    if (chamber) {
      await this.updateChamberFill(chamber.id, chamber.currentFill + lot.size);
    }

    return lot;
  }

  async getNextEntrySequence(coldStorageId: string): Promise<number> {
    // Atomically increment and return the next entry sequence number
    const [result] = await db
      .update(coldStorages)
      .set({ nextEntryBillNumber: sql`COALESCE(${coldStorages.nextEntryBillNumber}, 0) + 1` })
      .where(eq(coldStorages.id, coldStorageId))
      .returning({ entrySequence: coldStorages.nextEntryBillNumber });
    
    return result?.entrySequence ?? 1;
  }

  async createBatchLots(insertLots: InsertLot[], coldStorageId: string, bagTypeCategory?: "wafer" | "rationSeed"): Promise<{ lots: Lot[]; entrySequence: number }> {
    // Determine which lot number counter to use based on bag type category
    // Wafer uses nextWaferLotNumber, Ration/Seed uses nextRationSeedLotNumber
    const isWaferCategory = bagTypeCategory === "wafer";
    
    // Atomic read-and-increment pattern using raw SQL with CTE
    // Counter semantics: nextXLotNumber stores the NEXT number to assign (starts at 1)
    // CTE atomically: captures pre-increment value, updates to incremented value, returns pre-increment
    // This prevents race conditions and correctly handles NULL/legacy data
    let entrySequence: number;
    
    if (isWaferCategory) {
      // Raw SQL CTE that atomically reads, increments, and returns the PRE-increment value
      // If counter is NULL, treat as 1 (first lot number)
      const result = await db.execute(sql`
        WITH old_value AS (
          SELECT COALESCE(next_wafer_lot_number, 1) as lot_num
          FROM cold_storages
          WHERE id = ${coldStorageId}
        )
        UPDATE cold_storages
        SET next_wafer_lot_number = (SELECT lot_num FROM old_value) + 1
        WHERE id = ${coldStorageId}
        RETURNING (SELECT lot_num FROM old_value) as assigned_lot_number
      `);
      
      const rows = result.rows as Array<{ assigned_lot_number: number }>;
      if (!rows || rows.length === 0) {
        throw new Error(`Cold storage not found: ${coldStorageId}`);
      }
      entrySequence = rows[0].assigned_lot_number;
    } else {
      // Raw SQL CTE for ration/seed counter
      const result = await db.execute(sql`
        WITH old_value AS (
          SELECT COALESCE(next_ration_seed_lot_number, 1) as lot_num
          FROM cold_storages
          WHERE id = ${coldStorageId}
        )
        UPDATE cold_storages
        SET next_ration_seed_lot_number = (SELECT lot_num FROM old_value) + 1
        WHERE id = ${coldStorageId}
        RETURNING (SELECT lot_num FROM old_value) as assigned_lot_number
      `);
      
      const rows = result.rows as Array<{ assigned_lot_number: number }>;
      if (!rows || rows.length === 0) {
        throw new Error(`Cold storage not found: ${coldStorageId}`);
      }
      entrySequence = rows[0].assigned_lot_number;
    }
    
    const createdLots: Lot[] = [];
    
    for (const insertLot of insertLots) {
      const id = await generateSequentialId('lot');
      const lotData = {
        ...insertLot,
        id,
        coldStorageId,
        lotNo: String(entrySequence), // Set lotNo to the entry sequence
        entrySequence, // Set the unified entry sequence
        remainingSize: insertLot.remainingSize ?? insertLot.size,
        assayerImage: insertLot.assayerImage ?? null,
        reducingSugar: insertLot.reducingSugar ?? null,
        dm: insertLot.dm ?? null,
        remarks: insertLot.remarks ?? null,
        upForSale: insertLot.upForSale ?? 0,
        saleStatus: insertLot.saleStatus ?? "available",
        paymentStatus: insertLot.paymentStatus ?? null,
        saleCharge: insertLot.saleCharge ?? null,
        totalPaidCharge: insertLot.totalPaidCharge ?? null,
        totalDueCharge: insertLot.totalDueCharge ?? null,
        soldAt: insertLot.soldAt ?? null,
      };

      const [lot] = await db.insert(lots).values(lotData).returning();
      createdLots.push(lot);

      // Update chamber fill
      const chamber = await this.getChamber(lot.chamberId);
      if (chamber) {
        await this.updateChamberFill(chamber.id, chamber.currentFill + lot.size);
      }
    }

    return { lots: createdLots, entrySequence };
  }

  async getLot(id: string): Promise<Lot | undefined> {
    const [result] = await db.select().from(lots).where(eq(lots.id, id));
    return result;
  }

  async updateLot(id: string, updates: Partial<Lot>): Promise<Lot | undefined> {
    // Auto-update paymentStatus based on totalDueCharge and totalPaidCharge
    // Only compute if not explicitly setting paymentStatus
    if (!updates.paymentStatus && (updates.totalDueCharge !== undefined || updates.totalPaidCharge !== undefined)) {
      const lot = await this.getLot(id);
      if (lot) {
        const dueAmount = updates.totalDueCharge ?? lot.totalDueCharge ?? 0;
        const paidAmount = updates.totalPaidCharge ?? lot.totalPaidCharge ?? 0;
        
        // Ensure non-negative
        if (updates.totalDueCharge !== undefined && updates.totalDueCharge !== null && updates.totalDueCharge < 0) {
          updates.totalDueCharge = 0;
        }
        
        // Calculate correct paymentStatus based on both amounts
        // 'paid' = fully paid (paid > 0 AND due <= 0)
        // 'due' = any amount due (due > 0)
        // null = no charges yet (paid == 0 AND due == 0)
        if (paidAmount > 0 && dueAmount <= 0) {
          updates.paymentStatus = "paid";
        } else if (dueAmount > 0) {
          updates.paymentStatus = "due";
        } else {
          updates.paymentStatus = null;
        }
      }
    }
    
    const [result] = await db.update(lots).set(updates).where(eq(lots.id, id)).returning();
    return result;
  }

  async searchLots(type: "phone", query: string, coldStorageId: string): Promise<Lot[]> {
    return db.select().from(lots).where(
      and(
        eq(lots.coldStorageId, coldStorageId),
        ilike(lots.contactNumber, `%${query}%`)
      )
    );
  }

  async searchLotsByLotNoAndSize(lotNo: string, size: string, coldStorageId: string): Promise<Lot[]> {
    const allLots = await db.select().from(lots).where(eq(lots.coldStorageId, coldStorageId));
    
    return allLots.filter((lot) => {
      const matchesLotNo = !lotNo || lot.lotNo.toLowerCase().includes(lotNo.toLowerCase());
      const sizeNum = parseInt(size, 10);
      const matchesSize = !size || isNaN(sizeNum) || lot.size === sizeNum;
      return matchesLotNo && matchesSize;
    });
  }

  async searchLotsByFarmerName(query: string, coldStorageId: string, village?: string, contactNumber?: string): Promise<Lot[]> {
    const allLots = await db.select().from(lots).where(eq(lots.coldStorageId, coldStorageId));
    const lowerQuery = query.toLowerCase().trim();
    return allLots.filter((lot) => {
      const nameMatch = lot.farmerName.toLowerCase().trim().includes(lowerQuery);
      if (!nameMatch) return false;
      if (village && lot.village.trim().toLowerCase() !== village.trim().toLowerCase()) return false;
      if (contactNumber && lot.contactNumber.trim() !== contactNumber.trim()) return false;
      return true;
    });
  }

  async getAllLots(coldStorageId: string): Promise<Lot[]> {
    return db.select().from(lots).where(eq(lots.coldStorageId, coldStorageId));
  }

  async getLotsByEntrySequence(entrySequence: number, coldStorageId: string): Promise<Lot[]> {
    return db.select().from(lots).where(
      and(
        eq(lots.coldStorageId, coldStorageId),
        eq(lots.entrySequence, entrySequence)
      )
    );
  }

  async createEditHistory(insertHistory: InsertLotEditHistory): Promise<LotEditHistory> {
    const id = randomUUID();
    const historyData = {
      ...insertHistory,
      id,
      soldQuantity: insertHistory.soldQuantity ?? null,
      pricePerBag: insertHistory.pricePerBag ?? null,
      totalPrice: insertHistory.totalPrice ?? null,
      salePaymentStatus: insertHistory.salePaymentStatus ?? null,
      saleCharge: insertHistory.saleCharge ?? null,
    };

    const [history] = await db.insert(lotEditHistory).values(historyData).returning();
    return history;
  }

  async getLotHistory(lotId: string): Promise<LotEditHistory[]> {
    return db.select().from(lotEditHistory)
      .where(eq(lotEditHistory.lotId, lotId))
      .orderBy(desc(lotEditHistory.changedAt));
  }

  async deleteEditHistory(historyId: string): Promise<void> {
    await db.delete(lotEditHistory).where(eq(lotEditHistory.id, historyId));
  }

  async getDashboardStats(coldStorageId: string): Promise<DashboardStats> {
    const coldStorage = await this.getColdStorage(coldStorageId);
    const allChambers = await this.getChambers(coldStorageId);
    const allLots = await this.getAllLots(coldStorageId);

    const currentUtilization = allLots.reduce((sum, lot) => sum + lot.remainingSize, 0);
    const peakUtilization = allLots.reduce((sum, lot) => sum + lot.size, 0);
    
    // Total unique farmers (all lots)
    const uniqueFarmers = new Set(allLots.map((lot) => lot.contactNumber));
    // Remaining unique farmers (lots with remaining bags > 0)
    const remainingFarmers = new Set(
      allLots.filter((lot) => lot.remainingSize > 0).map((lot) => lot.contactNumber)
    );
    
    const totalWaferBags = allLots
      .filter((lot) => lot.bagType === "wafer")
      .reduce((sum, lot) => sum + lot.size, 0);
    const remainingWaferBags = allLots
      .filter((lot) => lot.bagType === "wafer")
      .reduce((sum, lot) => sum + lot.remainingSize, 0);
    const totalSeedBags = allLots
      .filter((lot) => lot.bagType === "seed")
      .reduce((sum, lot) => sum + lot.size, 0);
    const remainingSeedBags = allLots
      .filter((lot) => lot.bagType === "seed")
      .reduce((sum, lot) => sum + lot.remainingSize, 0);
    const totalRationBags = allLots
      .filter((lot) => lot.bagType === "Ration")
      .reduce((sum, lot) => sum + lot.size, 0);
    const remainingRationBags = allLots
      .filter((lot) => lot.bagType === "Ration")
      .reduce((sum, lot) => sum + lot.remainingSize, 0);
    
    const remainingLots = allLots.filter((lot) => lot.remainingSize > 0).length;

    const chamberStats = allChambers.map((chamber) => {
      const chamberLots = allLots.filter((lot) => lot.chamberId === chamber.id);
      const currentFill = chamberLots.reduce((sum, lot) => sum + lot.remainingSize, 0);
      return {
        id: chamber.id,
        name: chamber.name,
        capacity: chamber.capacity,
        currentFill,
        fillPercentage: chamber.capacity > 0 
          ? Math.round((currentFill / chamber.capacity) * 100) 
          : 0,
      };
    });

    const chamberMap = new Map(allChambers.map(c => [c.id, c.name]));
    const saleLots = allLots
      .filter((lot) => lot.upForSale === 1 && lot.remainingSize > 0 && lot.saleStatus !== "sold")
      .map((lot) => {
        // Wafer uses wafer rates, Seed and Ration use seed rates
        const useWaferRates = lot.bagType === "wafer";
        const coldCharge = useWaferRates 
          ? (coldStorage?.waferColdCharge || coldStorage?.waferRate || 0) 
          : (coldStorage?.seedColdCharge || coldStorage?.seedRate || 0);
        const hammali = useWaferRates 
          ? (coldStorage?.waferHammali || 0) 
          : (coldStorage?.seedHammali || 0);
        const rate = useWaferRates 
          ? (coldStorage?.waferRate || 0) 
          : (coldStorage?.seedRate || 0);
        return {
          id: lot.id,
          lotNo: lot.lotNo,
          farmerName: lot.farmerName,
          contactNumber: lot.contactNumber,
          village: lot.village,
          chamberName: chamberMap.get(lot.chamberId) || "Unknown",
          floor: lot.floor,
          position: lot.position,
          originalSize: lot.size,
          remainingSize: lot.remainingSize,
          bagType: lot.bagType,
          type: lot.type,
          quality: lot.quality,
          potatoSize: lot.potatoSize,
          rate,
          coldCharge,
          hammali,
          netWeight: lot.netWeight,
          chargeUnit: coldStorage?.chargeUnit || "bag",
          baseColdChargesBilled: lot.baseColdChargesBilled || 0,
          advanceDeduction: lot.advanceDeduction || 0,
          freightDeduction: lot.freightDeduction || 0,
          otherDeduction: lot.otherDeduction || 0,
        };
      })
      .sort((a, b) => parseInt(a.lotNo, 10) - parseInt(b.lotNo, 10));

    return {
      totalCapacity: coldStorage?.totalCapacity || 0,
      usedCapacity: currentUtilization,
      peakUtilization,
      currentUtilization,
      totalFarmers: uniqueFarmers.size,
      remainingFarmers: remainingFarmers.size,
      totalLots: allLots.length,
      remainingLots,
      totalWaferBags,
      remainingWaferBags,
      totalSeedBags,
      remainingSeedBags,
      totalRationBags,
      remainingRationBags,
      waferRate: coldStorage?.waferRate || 0,
      seedRate: coldStorage?.seedRate || 0,
      waferColdCharge: coldStorage?.waferColdCharge || coldStorage?.waferRate || 0,
      waferHammali: coldStorage?.waferHammali || 0,
      seedColdCharge: coldStorage?.seedColdCharge || coldStorage?.seedRate || 0,
      seedHammali: coldStorage?.seedHammali || 0,
      chamberStats,
      saleLots,
    };
  }

  async updateColdStorage(id: string, updates: Partial<ColdStorage>): Promise<ColdStorage | undefined> {
    const [result] = await db.update(coldStorages).set(updates).where(eq(coldStorages.id, id)).returning();
    return result;
  }

  async createChamber(data: { name: string; capacity: number; coldStorageId: string }): Promise<Chamber> {
    const id = `ch-${randomUUID().slice(0, 8)}`;
    const [chamber] = await db.insert(chambers).values({
      id,
      name: data.name,
      capacity: data.capacity,
      currentFill: 0,
      coldStorageId: data.coldStorageId,
    }).returning();
    return chamber;
  }

  async updateChamber(id: string, updates: Partial<Chamber>): Promise<Chamber | undefined> {
    const [result] = await db.update(chambers).set(updates).where(eq(chambers.id, id)).returning();
    return result;
  }

  async deleteChamber(id: string): Promise<boolean> {
    const chamberLots = await db.select().from(lots).where(eq(lots.chamberId, id));
    if (chamberLots.length > 0) {
      return false;
    }
    await db.delete(chambers).where(eq(chambers.id, id));
    return true;
  }

  async getQualityStats(coldStorageId: string, year?: number): Promise<QualityStats> {
    // Combine data from both lots (current unsold) and salesHistory (sold)
    // This ensures analytics show current season AND survive resets
    
    const allChambers = await this.getChambers(coldStorageId);
    let allLots = await this.getAllLots(coldStorageId);
    const allSales = await this.getSalesHistory(coldStorageId, year ? { year } : undefined);
    
    // Filter lots by year if specified
    if (year) {
      allLots = allLots.filter((lot) => {
        const entryYear = new Date(lot.createdAt).getFullYear();
        return entryYear === year;
      });
    }
    
    // Build chamber quality maps - one for remaining, one for original
    const chamberMapRemaining = new Map<string, { chamberId: string; chamberName: string; poor: number; medium: number; good: number }>();
    const chamberMapOriginal = new Map<string, { chamberId: string; chamberName: string; poor: number; medium: number; good: number }>();
    
    // Initialize with current chambers
    allChambers.forEach(chamber => {
      chamberMapRemaining.set(chamber.id, {
        chamberId: chamber.id,
        chamberName: chamber.name,
        poor: 0,
        medium: 0,
        good: 0,
      });
      chamberMapOriginal.set(chamber.id, {
        chamberId: chamber.id,
        chamberName: chamber.name,
        poor: 0,
        medium: 0,
        good: 0,
      });
    });
    
    // Add remaining bags from lots table (for remaining view)
    // Add original size from lots table (for original distribution)
    for (const lot of allLots) {
      const existingRemaining = chamberMapRemaining.get(lot.chamberId);
      const existingOriginal = chamberMapOriginal.get(lot.chamberId);
      if (existingRemaining) {
        if (lot.quality === "poor") existingRemaining.poor += lot.remainingSize;
        else if (lot.quality === "medium") existingRemaining.medium += lot.remainingSize;
        else if (lot.quality === "good") existingRemaining.good += lot.remainingSize;
      }
      if (existingOriginal) {
        if (lot.quality === "poor") existingOriginal.poor += lot.size;
        else if (lot.quality === "medium") existingOriginal.medium += lot.size;
        else if (lot.quality === "good") existingOriginal.good += lot.size;
      }
    }
    
    // Add sold quantities from salesHistory ONLY for historical data (after season reset)
    // We track which lotIds we've already counted to avoid double-counting
    const lotIdsFromLots = new Set(allLots.map(lot => lot.id));
    
    for (const sale of allSales) {
      // Skip if this sale's lot still exists in current lots (already counted via lot.size)
      if (lotIdsFromLots.has(sale.lotId)) {
        continue;
      }
      
      // This is a historical sale (lot was deleted after season reset)
      // Try to find chamber by name if ID doesn't exist
      let existingOriginal = Array.from(chamberMapOriginal.values()).find(c => c.chamberName === sale.chamberName);
      if (!existingOriginal) {
        // Create entry for historical chamber
        const historyKey = `history-${sale.chamberName}`;
        existingOriginal = {
          chamberId: historyKey,
          chamberName: sale.chamberName,
          poor: 0,
          medium: 0,
          good: 0,
        };
        chamberMapOriginal.set(historyKey, existingOriginal);
      }
      if (sale.quality === "poor") existingOriginal.poor += sale.quantitySold;
      else if (sale.quality === "medium") existingOriginal.medium += sale.quantitySold;
      else if (sale.quality === "good") existingOriginal.good += sale.quantitySold;
    }
    
    const chamberQualityRemaining = Array.from(chamberMapRemaining.values()).filter(c => c.poor > 0 || c.medium > 0 || c.good > 0);
    const chamberQuality = Array.from(chamberMapOriginal.values()).filter(c => c.poor > 0 || c.medium > 0 || c.good > 0);
    
    // Calculate totals - remaining
    let totalPoorRemaining = 0, totalMediumRemaining = 0, totalGoodRemaining = 0;
    for (const lot of allLots) {
      if (lot.quality === "poor") totalPoorRemaining += lot.remainingSize;
      else if (lot.quality === "medium") totalMediumRemaining += lot.remainingSize;
      else if (lot.quality === "good") totalGoodRemaining += lot.remainingSize;
    }
    
    // Calculate totals - original (from lots + historical sales only)
    let totalPoor = 0, totalMedium = 0, totalGood = 0;
    for (const lot of allLots) {
      if (lot.quality === "poor") totalPoor += lot.size;
      else if (lot.quality === "medium") totalMedium += lot.size;
      else if (lot.quality === "good") totalGood += lot.size;
    }
    // Only add sales from lots that no longer exist (historical data after reset)
    for (const sale of allSales) {
      if (lotIdsFromLots.has(sale.lotId)) {
        continue; // Skip - already counted via lot.size
      }
      if (sale.quality === "poor") totalPoor += sale.quantitySold;
      else if (sale.quality === "medium") totalMedium += sale.quantitySold;
      else if (sale.quality === "good") totalGood += sale.quantitySold;
    }

    return {
      chamberQualityRemaining,
      chamberQuality,
      totalPoorRemaining,
      totalMediumRemaining,
      totalGoodRemaining,
      totalPoor,
      totalMedium,
      totalGood,
    };
  }

  async getPaymentStats(coldStorageId: string, year?: number): Promise<PaymentStats> {
    // Read from salesHistory table (permanent records) instead of lots
    // This ensures analytics survive season resets
    const allSales = await this.getSalesHistory(coldStorageId, year ? { year } : undefined);
    
    let totalPaid = 0;
    let totalDue = 0;
    let totalHammali = 0;
    let totalGradingCharges = 0;
    let totalExtraDueToMerchant = 0;
    
    // Group sales by lotId to count unique lots, not individual partial sales
    const lotPaymentMap = new Map<string, { paidAmount: number; dueAmount: number }>();
    
    for (const sale of allSales) {
      // coldStorageCharge already includes base + kata + extraHammali + grading
      // Do NOT add them again to avoid double-counting
      const totalCharges = sale.coldStorageCharge || 0;
      
      // Calculate base hammali proportionally from coldStorageCharge (same as CSV export)
      // coldStorageCharge = base charges + extras (kata + extraHammali + grading)
      const extras = (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
      const baseChargesTotal = Math.max(0, (sale.coldStorageCharge || 0) - extras); // Clamp to prevent negative
      let baseHammali = 0;
      if (sale.coldCharge && sale.hammali) {
        // Both rates present - use proportional split
        const totalRate = sale.coldCharge + sale.hammali;
        if (totalRate > 0) {
          baseHammali = (baseChargesTotal * sale.hammali) / totalRate;
        }
      } else if (sale.hammali && sale.hammali > 0 && !sale.coldCharge) {
        // Only hammali rate present (no cold charge) - all base is hammali
        baseHammali = baseChargesTotal;
      }
      // Note: If neither rate present, baseHammali stays 0 (legacy data without rates)
      
      // Total hammali = base hammali (from coldStorageCharge) + extra hammali (bilty cut) + hammali to merchant
      totalHammali += baseHammali + (sale.extraHammali || 0) + (sale.extraDueHammaliMerchant || 0);
      totalGradingCharges += (sale.gradingCharges || 0) + (sale.extraDueGradingMerchant || 0);
      
      // Track extraDueToMerchant (remaining due, already reduced by FIFO payments)
      totalExtraDueToMerchant += (sale.extraDueToMerchant || 0);
      
      // Use paidAmount from sale, calculate due as remainder to ensure consistency
      const salePaid = sale.paidAmount || 0;
      const saleDue = Math.max(0, totalCharges - salePaid);
      
      totalPaid += salePaid;
      totalDue += saleDue;
      
      // Track payment status by lot for counting unique lots
      const existing = lotPaymentMap.get(sale.lotId) || { paidAmount: 0, dueAmount: 0 };
      existing.paidAmount += salePaid;
      existing.dueAmount += saleDue;
      lotPaymentMap.set(sale.lotId, existing);
    }
    
    // Add extraDueToMerchant to totalDue for consistency with Merchant Analysis
    totalDue += totalExtraDueToMerchant;
    
    // Count unique lots: a lot is "paid" only if all tranches are paid
    let paidCount = 0;
    let dueCount = 0;
    Array.from(lotPaymentMap.values()).forEach((lotStatus) => {
      if (lotStatus.dueAmount > 0) {
        dueCount++; // Has any due amount = lot is due
      } else if (lotStatus.paidAmount > 0) {
        paidCount++; // All paid = lot is paid
      }
    });

    // Subtract expenses already paid for hammali and grading
    // This makes the dropdown show remaining due instead of total
    // Filter expenses by year only when year filter is provided (consistent with sales filtering)
    let expenseQuery = db.select()
      .from(expenses)
      .where(and(
        eq(expenses.coldStorageId, coldStorageId),
        eq(expenses.isReversed, 0)
      ));
    
    const allExpenses = await expenseQuery;
    
    // Sum expenses by type, optionally filtered by year
    let hammaliExpensesPaid = 0;
    let gradingExpensesPaid = 0;
    
    for (const expense of allExpenses) {
      // When year filter is provided, only include expenses from that year
      // When no year filter, include all expenses (matches sales behavior)
      if (year) {
        const expenseYear = new Date(expense.paidAt).getFullYear();
        if (expenseYear !== year) continue;
      }
      
      if (expense.expenseType === "hammali") {
        hammaliExpensesPaid += expense.amount;
      } else if (expense.expenseType === "grading_charges") {
        gradingExpensesPaid += expense.amount;
      }
    }
    
    // Reduce totals by amounts already paid (show remaining due)
    const hammaliDue = Math.max(0, totalHammali - hammaliExpensesPaid);
    const gradingDue = Math.max(0, totalGradingCharges - gradingExpensesPaid);

    return {
      totalPaid,
      totalDue,
      paidCount,
      dueCount,
      totalHammali: hammaliDue,
      totalGradingCharges: gradingDue,
    };
  }

  async getMerchantStats(coldStorageId: string, year?: number): Promise<MerchantStats> {
    const allSales = await this.getSalesHistory(coldStorageId, year ? { year } : undefined);
    
    // Group sales by buyer name (case-insensitive with trimming)
    const merchantMap = new Map<string, {
      displayName: string; // Canonical display name (first occurrence)
      bagsPurchased: number;
      totalValue: number;
      totalChargePaid: number;
      totalChargeDue: number;
      cashPaid: number;
      accountPaid: number;
    }>();
    
    // Separate map for extraDueToMerchant - tracked by ORIGINAL buyerName (not transferred)
    const extraDueByOriginalBuyer = new Map<string, number>();
    
    for (const sale of allSales) {
      // Use CurrentDueBuyerName logic: transferToBuyerName if set, else buyerName
      // This ensures transferred liabilities show under the correct buyer
      const trimmedName = (sale.transferToBuyerName?.trim() || sale.buyerName?.trim()) || "Unknown";
      const normalizedKey = trimmedName.toLowerCase(); // Case-insensitive key
      
      const existing = merchantMap.get(normalizedKey) || {
        displayName: trimmedName, // Use first occurrence as canonical name
        bagsPurchased: 0,
        totalValue: 0,
        totalChargePaid: 0,
        totalChargeDue: 0,
        cashPaid: 0,
        accountPaid: 0,
      };
      
      // Bags sold in this sale (using correct field name from schema)
      existing.bagsPurchased += sale.quantitySold || 0;
      
      // Total value = pricePerKg * actual weight (netWeight)
      // Use actual netWeight if available, otherwise estimate using originalBags * 50kg
      if (sale.pricePerKg) {
        if (sale.netWeight && sale.netWeight > 0) {
          // Use actual net weight
          existing.totalValue += sale.pricePerKg * sale.netWeight;
        } else if (sale.quantitySold) {
          // Fallback: estimate ~50kg per bag for potato bags
          existing.totalValue += sale.pricePerKg * sale.quantitySold * 50;
        }
      }
      
      // coldStorageCharge already includes base + kata + extraHammali + grading
      // Do NOT add them again to avoid double-counting
      const totalCharges = sale.coldStorageCharge || 0;
      
      // Use paidAmount from sale, calculate due as remainder to ensure consistency
      const salePaid = sale.paidAmount || 0;
      existing.totalChargePaid += salePaid;
      existing.totalChargeDue += Math.max(0, totalCharges - salePaid);
      
      // Track payment by mode (cash vs account)
      const paidAmt = sale.paidAmount || 0;
      if (sale.paymentMode === "cash") {
        existing.cashPaid += paidAmt;
      } else if (sale.paymentMode === "account") {
        existing.accountPaid += paidAmt;
      }
      // If paymentMode is null (legacy records), we don't split it
      
      merchantMap.set(normalizedKey, existing);
      
      // Track extraDueToMerchant separately by ORIGINAL buyerName (not affected by transfers)
      if (sale.extraDueToMerchant && sale.extraDueToMerchant > 0) {
        const originalBuyer = (sale.buyerName?.trim()) || "Unknown";
        const originalKey = originalBuyer.toLowerCase();
        const currentExtra = extraDueByOriginalBuyer.get(originalKey) || 0;
        extraDueByOriginalBuyer.set(originalKey, currentExtra + sale.extraDueToMerchant);
      }
    }
    
    // Add extraDueToMerchant to the totalChargeDue for each merchant
    // This is added based on original buyerName, not CurrentDueBuyerName
    for (const [normalizedKey, extraDue] of Array.from(extraDueByOriginalBuyer.entries())) {
      const merchant = merchantMap.get(normalizedKey);
      if (merchant) {
        merchant.totalChargeDue += extraDue;
      } else {
        // If original buyer doesn't exist in map (all sales transferred), create entry
        // Find the display name from sales
        const sale = allSales.find(s => (s.buyerName?.trim().toLowerCase()) === normalizedKey);
        const displayName = sale?.buyerName?.trim() || normalizedKey;
        merchantMap.set(normalizedKey, {
          displayName,
          bagsPurchased: 0,
          totalValue: 0,
          totalChargePaid: 0,
          totalChargeDue: extraDue,
          cashPaid: 0,
          accountPaid: 0,
        });
      }
    }
    
    // Extract unique buyer display names (sorted case-insensitively)
    const merchantEntries = Array.from(merchantMap.values());
    merchantEntries.sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));
    
    const buyers = merchantEntries.map(e => e.displayName);
    
    // Build merchant data array
    const merchantData = merchantEntries.map(entry => ({
      buyerName: entry.displayName,
      bagsPurchased: entry.bagsPurchased,
      totalValue: entry.totalValue,
      totalChargePaid: entry.totalChargePaid,
      totalChargeDue: entry.totalChargeDue,
      cashPaid: entry.cashPaid,
      accountPaid: entry.accountPaid,
    }));
    
    return {
      buyers,
      merchantData,
    };
  }

  async getAnalyticsYears(coldStorageId: string): Promise<number[]> {
    // Combine years from both lots (current season) and salesHistory (historical)
    // This ensures both current and historical years are shown
    const allLots = await this.getAllLots(coldStorageId);
    const salesYears = await this.getSalesYears(coldStorageId);
    
    const yearSet = new Set<number>(salesYears);
    allLots.forEach((lot) => {
      const entryYear = new Date(lot.createdAt).getFullYear();
      yearSet.add(entryYear);
    });
    
    return Array.from(yearSet).sort((a, b) => b - a);
  }

  async checkResetEligibility(coldStorageId: string): Promise<{ canReset: boolean; remainingBags: number; remainingLots: number }> {
    const allLots = await this.getAllLots(coldStorageId);
    const lotsWithRemaining = allLots.filter((lot) => lot.remainingSize > 0);
    const remainingBags = lotsWithRemaining.reduce((sum, lot) => sum + lot.remainingSize, 0);
    const remainingLots = lotsWithRemaining.length;
    
    return {
      canReset: remainingBags === 0 && remainingLots === 0,
      remainingBags,
      remainingLots,
    };
  }

  async resetSeason(coldStorageId: string): Promise<void> {
    // Delete all lots for the cold storage
    await db.delete(lots).where(eq(lots.coldStorageId, coldStorageId));
    
    // NOTE: The following data is intentionally PRESERVED across season resets:
    // - salesHistory (sale records)
    // - cashReceipts (payment receipts)
    // - expenses (expense records)
    // - cashTransfers (cash transfer records)
    // - discounts (discount records)
    // - openingReceivables (receivables from settings)
    // - openingPayables (payables from settings)
    // - cashOpeningBalances (opening balance records)
    
    // Get all chambers for this cold storage to delete their floors
    const allChambers = await this.getChambers(coldStorageId);
    
    // Delete all floor configurations for each chamber
    for (const chamber of allChambers) {
      await db.delete(chamberFloors).where(eq(chamberFloors.chamberId, chamber.id));
    }
    
    // Reset all chamber fills to zero
    await db.update(chambers)
      .set({ currentFill: 0 })
      .where(eq(chambers.coldStorageId, coldStorageId));
    
    // Get the starting lot numbers for this cold storage
    const coldStorage = await this.getColdStorage(coldStorageId);
    const startingWaferLotNumber = coldStorage?.startingWaferLotNumber || 1;
    const startingRationSeedLotNumber = coldStorage?.startingRationSeedLotNumber || 1;

    // Reset all bill number counters to 1, and lot counters to their starting values
    await db.update(coldStorages)
      .set({ 
        nextExitBillNumber: 1,
        nextColdStorageBillNumber: 1,
        nextSalesBillNumber: 1,
        nextEntryBillNumber: 1,
        nextWaferLotNumber: startingWaferLotNumber,
        nextRationSeedLotNumber: startingRationSeedLotNumber,
      })
      .where(eq(coldStorages.id, coldStorageId));
  }

  async finalizeSale(lotId: string, paymentStatus: "due" | "paid" | "partial", buyerName?: string, pricePerKg?: number, paidAmount?: number, dueAmount?: number, paymentMode?: "cash" | "account", kataCharges?: number, extraHammali?: number, gradingCharges?: number, netWeight?: number, customColdCharge?: number, customHammali?: number): Promise<Lot | undefined> {
    const lot = await this.getLot(lotId);
    if (!lot || lot.saleStatus === "sold") return undefined;

    const coldStorage = await this.getColdStorage(lot.coldStorageId);
    if (!coldStorage) return undefined;

    // Wafer uses wafer rates, Seed and Ration bags use seed rates
    const useWaferRates = lot.bagType === "wafer";
    
    // Use custom rates if provided, otherwise use cold storage defaults
    const defaultRate = useWaferRates ? coldStorage.waferRate : coldStorage.seedRate;
    const defaultHammali = useWaferRates ? (coldStorage.waferHammali || 0) : (coldStorage.seedHammali || 0);
    const defaultColdCharge = defaultRate - defaultHammali;
    
    const hammaliRate = customHammali !== undefined ? customHammali : defaultHammali;
    const coldChargeRate = customColdCharge !== undefined ? customColdCharge : defaultColdCharge;
    const rate = coldChargeRate + hammaliRate;
    
    // If baseColdChargesBilled is already set, skip base charges (only extras apply)
    let saleCharge: number;
    if (lot.baseColdChargesBilled === 1) {
      saleCharge = 0;
    } else if (coldStorage.chargeUnit === "quintal" && lot.netWeight && lot.size > 0) {
      // Quintal mode: cold charges (per quintal) + hammali (per bag)
      const coldChargeQuintal = (lot.netWeight * lot.remainingSize * coldChargeRate) / (lot.size * 100);
      const hammaliPerBag = hammaliRate * lot.remainingSize;
      saleCharge = coldChargeQuintal + hammaliPerBag;
    } else {
      // Bag mode
      saleCharge = rate * lot.remainingSize;
    }
    
    // Calculate total charge including all extra charges
    const kata = kataCharges || 0;
    const extraHammaliTotal = extraHammali || 0;
    const grading = gradingCharges || 0;
    // Proportional entry deductions using shared helper
    const proportionalDeductions = calculateProportionalEntryDeductions({
      quantitySold: lot.remainingSize,
      originalLotSize: lot.size,
      advanceDeduction: lot.advanceDeduction || 0,
      freightDeduction: lot.freightDeduction || 0,
      otherDeduction: lot.otherDeduction || 0,
    });
    const totalChargeWithExtras = saleCharge + kata + extraHammaliTotal + grading + proportionalDeductions;

    // Calculate paid/due amounts based on payment status (include all charges)
    let salePaidAmount = 0;
    let saleDueAmount = 0;
    if (paymentStatus === "paid") {
      salePaidAmount = totalChargeWithExtras;
    } else if (paymentStatus === "due") {
      saleDueAmount = totalChargeWithExtras;
    } else if (paymentStatus === "partial") {
      const rawPaid = Math.max(0, paidAmount || 0);
      salePaidAmount = Math.min(rawPaid, totalChargeWithExtras);
      saleDueAmount = totalChargeWithExtras - salePaidAmount;
    }

    const bagsToRemove = lot.remainingSize;
    const [updatedLot] = await db.update(lots).set({
      saleStatus: "sold",
      paymentStatus,
      saleCharge,
      soldAt: new Date(),
      upForSale: 0,
      remainingSize: 0,
      totalPaidCharge: (lot.totalPaidCharge || 0) + salePaidAmount,
      totalDueCharge: (lot.totalDueCharge || 0) + saleDueAmount,
    }).where(eq(lots.id, lotId)).returning();

    // Create edit history for the final sale
    await this.createEditHistory({
      lotId: lot.id,
      changeType: "final_sale",
      previousData: JSON.stringify({ remainingSize: lot.remainingSize }),
      newData: JSON.stringify({ remainingSize: 0, saleStatus: "sold" }),
      soldQuantity: bagsToRemove,
      pricePerBag: rate,
      coldCharge: coldChargeRate,
      hammali: hammaliRate,
      pricePerKg: pricePerKg || null,
      buyerName: buyerName || null,
      totalPrice: saleCharge,
      salePaymentStatus: paymentStatus,
      saleCharge: saleCharge,
    });

    const chamber = await this.getChamber(lot.chamberId);
    if (chamber) {
      await this.updateChamberFill(chamber.id, Math.max(0, chamber.currentFill - bagsToRemove));
    }

    // Create permanent sales history record for full sale
    // For full sales, chargeBasis is always "actual" since we're selling all remaining bags
    await this.createSalesHistory({
      coldStorageId: lot.coldStorageId,
      farmerName: lot.farmerName,
      village: lot.village,
      tehsil: lot.tehsil,
      district: lot.district,
      state: lot.state,
      contactNumber: lot.contactNumber,
      lotNo: lot.lotNo,
      lotId: lot.id,
      chamberName: chamber?.name || "Unknown",
      floor: lot.floor,
      position: lot.position,
      potatoType: lot.type,
      bagType: lot.bagType,
      bagTypeLabel: lot.bagTypeLabel || null,
      quality: lot.quality,
      originalLotSize: lot.size,
      saleType: "full",
      quantitySold: bagsToRemove,
      pricePerBag: rate,
      coldCharge: coldChargeRate,
      hammali: hammaliRate,
      coldStorageCharge: totalChargeWithExtras, // Total charge including all extras (base + kata + extraHammali + grading)
      kataCharges: kataCharges || 0,
      extraHammali: extraHammali || 0,
      gradingCharges: gradingCharges || 0,
      netWeight: netWeight || null,
      buyerName: buyerName || null,
      pricePerKg: pricePerKg || null,
      paymentStatus,
      paymentMode: (paymentStatus === "paid" || paymentStatus === "partial") ? paymentMode : null,
      paidAmount: salePaidAmount,
      dueAmount: saleDueAmount,
      entryDate: lot.createdAt,
      saleYear: new Date().getFullYear(),
      // Charge calculation context for edit dialog
      chargeBasis: "actual", // Full sales always use "actual" (selling all remaining)
      chargeUnitAtSale: coldStorage.chargeUnit || "bag", // Preserve charge unit used at sale time
      initialNetWeightKg: lot.netWeight || null,
      baseChargeAmountAtSale: saleCharge, // Base charge (cold+hammali) before extras; if 0, base already billed
      remainingSizeAtSale: lot.remainingSize, // Remaining bags before this sale (for totalRemaining basis)
      // Entry-time deductions (copy from lot)
      advanceDeduction: lot.advanceDeduction || 0,
      freightDeduction: lot.freightDeduction || 0,
      otherDeduction: lot.otherDeduction || 0,
    });

    return updatedLot;
  }

  // Sales History Methods
  async createSalesHistory(data: InsertSalesHistory): Promise<SalesHistory> {
    const id = await generateSequentialId('sales');
    const [sale] = await db.insert(salesHistory).values({
      ...data,
      id,
    }).returning();
    return sale;
  }

  async getSalesHistory(coldStorageId: string, filters?: {
    year?: number;
    farmerName?: string;
    village?: string;
    contactNumber?: string;
    paymentStatus?: "paid" | "due";
    buyerName?: string;
  }): Promise<SalesHistory[]> {
    let conditions = [eq(salesHistory.coldStorageId, coldStorageId)];
    
    if (filters?.year) {
      conditions.push(eq(salesHistory.saleYear, filters.year));
    }
    if (filters?.farmerName) {
      const normalizedName = filters.farmerName.trim().toLowerCase();
      conditions.push(sql`lower(trim(${salesHistory.farmerName})) LIKE ${`%${normalizedName}%`}`);
    }
    if (filters?.village) {
      const normalizedVillage = filters.village.trim().toLowerCase();
      conditions.push(sql`lower(trim(${salesHistory.village})) = ${normalizedVillage}`);
    }
    if (filters?.contactNumber) {
      const normalizedContact = filters.contactNumber.trim();
      conditions.push(sql`trim(${salesHistory.contactNumber}) LIKE ${`%${normalizedContact}%`}`);
    }
    if (filters?.paymentStatus) {
      conditions.push(eq(salesHistory.paymentStatus, filters.paymentStatus));
    }
    if (filters?.buyerName) {
      // Search by CurrentDueBuyerName: COALESCE(NULLIF(transferToBuyerName, ''), buyerName)
      // This filters by the effective buyer - transferToBuyerName if available, else buyerName
      conditions.push(
        sql`COALESCE(NULLIF(${salesHistory.transferToBuyerName}, ''), ${salesHistory.buyerName}) ILIKE ${`%${filters.buyerName}%`}`
      );
    }

    return db.select()
      .from(salesHistory)
      .where(and(...conditions))
      .orderBy(desc(salesHistory.soldAt));
  }

  async markSaleAsPaid(saleId: string): Promise<SalesHistory | undefined> {
    const [updated] = await db.update(salesHistory)
      .set({ 
        paymentStatus: "paid",
        paidAt: new Date()
      })
      .where(eq(salesHistory.id, saleId))
      .returning();
    return updated;
  }

  async markSaleAsDue(saleId: string): Promise<SalesHistory | undefined> {
    const [updated] = await db.update(salesHistory)
      .set({ 
        paymentStatus: "due",
        paidAt: null
      })
      .where(eq(salesHistory.id, saleId))
      .returning();
    return updated;
  }

  async updateSalesHistoryForTransfer(saleId: string, updates: {
    clearanceType: string;
    transferToBuyerName: string;
    transferGroupId: string;
    transferDate: Date;
    transferRemarks: string | null;
    transferTransactionId?: string;
    paymentStatus?: string;
    paidAmount?: number;
    dueAmount?: number;
  }): Promise<SalesHistory | undefined> {
    // Build update object - only include payment fields if provided
    const updateData: any = {
      clearanceType: updates.clearanceType,
      transferToBuyerName: updates.transferToBuyerName,
      transferGroupId: updates.transferGroupId,
      transferDate: updates.transferDate,
      transferRemarks: updates.transferRemarks,
    };
    
    // Add CF transaction ID for buyer-to-buyer transfers
    if (updates.transferTransactionId) {
      updateData.transferTransactionId = updates.transferTransactionId;
    }
    
    // Only update payment fields if explicitly provided (for liability transfers, we don't update these)
    if (updates.paymentStatus !== undefined) {
      updateData.paymentStatus = updates.paymentStatus;
      updateData.paidAt = updates.paymentStatus === 'paid' ? new Date() : null;
    }
    if (updates.paidAmount !== undefined) {
      updateData.paidAmount = updates.paidAmount;
    }
    if (updates.dueAmount !== undefined) {
      updateData.dueAmount = updates.dueAmount;
    }
    
    const [updated] = await db.update(salesHistory)
      .set(updateData)
      .where(eq(salesHistory.id, saleId))
      .returning();
    return updated;
  }

  async updateSalesHistory(saleId: string, updates: {
    buyerName?: string;
    pricePerKg?: number;
    paymentStatus?: "paid" | "due" | "partial";
    paidAmount?: number;
    dueAmount?: number;
    paymentMode?: "cash" | "account";
    netWeight?: number | null;
    coldCharge?: number;
    hammali?: number;
    kataCharges?: number;
    extraHammali?: number;
    gradingCharges?: number;
    coldStorageCharge?: number;
    chargeBasis?: "actual" | "totalRemaining";
    extraDueToMerchant?: number;
    extraDueHammaliMerchant?: number;
    extraDueGradingMerchant?: number;
    extraDueOtherMerchant?: number;
  }): Promise<SalesHistory | undefined> {
    const sale = await db.select().from(salesHistory).where(eq(salesHistory.id, saleId)).then(rows => rows[0]);
    if (!sale) return undefined;

    const updateData: Record<string, unknown> = {};
    
    if (updates.buyerName !== undefined) {
      updateData.buyerName = updates.buyerName || null;
    }
    if (updates.pricePerKg !== undefined) {
      updateData.pricePerKg = updates.pricePerKg || null;
    }
    if (updates.paymentStatus !== undefined) {
      updateData.paymentStatus = updates.paymentStatus;
      if (updates.paymentStatus === "paid") {
        updateData.paidAt = new Date();
        // Keep or set payment mode for paid status
        if (updates.paymentMode) {
          updateData.paymentMode = updates.paymentMode;
        }
      } else if (updates.paymentStatus === "due") {
        // Clear paidAt and paymentMode when marking as due
        updateData.paidAt = null;
        updateData.paymentMode = null;
      } else if (updates.paymentStatus === "partial") {
        // Set paidAt for partial payments and keep payment mode
        updateData.paidAt = new Date();
        if (updates.paymentMode) {
          updateData.paymentMode = updates.paymentMode;
        }
      }
    }
    if (updates.paidAmount !== undefined) {
      updateData.paidAmount = updates.paidAmount;
    }
    if (updates.dueAmount !== undefined) {
      updateData.dueAmount = updates.dueAmount;
    }
    if (updates.netWeight !== undefined) {
      updateData.netWeight = updates.netWeight;
    }

    // Handle charge field updates
    if (updates.coldCharge !== undefined) {
      updateData.coldCharge = updates.coldCharge;
    }
    if (updates.hammali !== undefined) {
      updateData.hammali = updates.hammali;
    }
    if (updates.kataCharges !== undefined) {
      updateData.kataCharges = updates.kataCharges;
    }
    if (updates.extraHammali !== undefined) {
      updateData.extraHammali = updates.extraHammali;
    }
    if (updates.gradingCharges !== undefined) {
      updateData.gradingCharges = updates.gradingCharges;
    }
    if (updates.extraDueToMerchant !== undefined) {
      updateData.extraDueToMerchant = updates.extraDueToMerchant;
      // Also set the original value for recompute - user is setting the base value
      updateData.extraDueToMerchantOriginal = updates.extraDueToMerchant;
    }
    // Handle sub-fields for extraDueToMerchant breakdown
    if (updates.extraDueHammaliMerchant !== undefined) {
      updateData.extraDueHammaliMerchant = updates.extraDueHammaliMerchant;
    }
    if (updates.extraDueGradingMerchant !== undefined) {
      updateData.extraDueGradingMerchant = updates.extraDueGradingMerchant;
    }
    if (updates.extraDueOtherMerchant !== undefined) {
      updateData.extraDueOtherMerchant = updates.extraDueOtherMerchant;
    }

    // Handle coldStorageCharge - use provided value if present, otherwise recalculate
    if (updates.coldStorageCharge !== undefined) {
      // Client-provided coldStorageCharge (from chargeBasis calculation)
      updateData.coldStorageCharge = updates.coldStorageCharge;
      // Also update pricePerBag based on individual rates
      const coldCharge = updates.coldCharge ?? sale.coldCharge ?? 0;
      const hammali = updates.hammali ?? sale.hammali ?? 0;
      updateData.pricePerBag = coldCharge + hammali;
    } else if (updates.coldCharge !== undefined || updates.hammali !== undefined) {
      // Recalculate coldStorageCharge from updated rates (legacy behavior)
      const coldCharge = updates.coldCharge ?? sale.coldCharge ?? 0;
      const hammali = updates.hammali ?? sale.hammali ?? 0;
      const ratePerBag = coldCharge + hammali;
      updateData.coldStorageCharge = ratePerBag * (sale.quantitySold || 0);
      updateData.pricePerBag = ratePerBag;
    }

    const [updated] = await db.update(salesHistory)
      .set(updateData)
      .where(eq(salesHistory.id, saleId))
      .returning();

    // Note: FIFO recomputation is triggered in routes.ts after update
    return updated;
  }

  async getSalesYears(coldStorageId: string): Promise<number[]> {
    const results = await db.select({ year: salesHistory.saleYear })
      .from(salesHistory)
      .where(eq(salesHistory.coldStorageId, coldStorageId));
    
    const yearSet = new Set<number>();
    results.forEach(r => yearSet.add(r.year));
    const uniqueYears = Array.from(yearSet).sort((a, b) => b - a);
    return uniqueYears;
  }

  async reverseSale(saleId: string): Promise<{ success: boolean; lot?: Lot; message?: string; errorType?: string; buyerName?: string; coldStorageId?: string }> {
    const sale = await db.select().from(salesHistory).where(eq(salesHistory.id, saleId)).then(rows => rows[0]);
    if (!sale) {
      return { success: false, message: "Sale not found", errorType: "not_found" };
    }

    const lot = await this.getLot(sale.lotId);
    if (!lot) {
      return { success: false, message: "Associated lot not found", errorType: "not_found" };
    }

    const quantityToRestore = sale.quantitySold;
    const paidToReverse = sale.paidAmount || 0;
    const dueToReverse = sale.dueAmount || 0;

    const newRemainingSize = lot.remainingSize + quantityToRestore;
    const wasFullSale = sale.saleType === "full";

    const otherSales = await db.select().from(salesHistory)
      .where(and(eq(salesHistory.lotId, sale.lotId), sql`${salesHistory.id} != ${saleId}`));
    
    let newSaleStatus: "stored" | "partial" | "sold" = "stored";
    if (otherSales.length > 0) {
      newSaleStatus = "partial";
    } else {
      newSaleStatus = "stored";
    }

    const newTotalPaid = Math.max(0, (lot.totalPaidCharge || 0) - paidToReverse);
    const newTotalDue = Math.max(0, (lot.totalDueCharge || 0) - dueToReverse);

    let newPaymentStatus: string | null = null;
    if (newSaleStatus === "partial") {
      if (newTotalDue > 0 && newTotalPaid > 0) {
        newPaymentStatus = "partial";
      } else if (newTotalDue > 0) {
        newPaymentStatus = "due";
      } else if (newTotalPaid > 0) {
        newPaymentStatus = "paid";
      }
    }

    // Reset baseColdChargesBilled if this sale was the one that originally billed base charges
    const shouldResetBaseBilled = (sale.baseChargeAmountAtSale || 0) > 0;

    const lotUpdateData: any = {
      remainingSize: newRemainingSize,
      saleStatus: newSaleStatus,
      upForSale: 0,
      soldAt: newSaleStatus === "stored" ? null : lot.soldAt,
      totalPaidCharge: newTotalPaid,
      totalDueCharge: newTotalDue,
      paymentStatus: newPaymentStatus,
    };

    // Reset the baseColdChargesBilled flag if this sale billed the base charges
    if (shouldResetBaseBilled) {
      lotUpdateData.baseColdChargesBilled = 0;
    }

    const [updatedLot] = await db.update(lots).set(lotUpdateData).where(eq(lots.id, sale.lotId)).returning();

    if (lot.chamberId) {
      const chamber = await this.getChamber(lot.chamberId);
      if (chamber) {
        const newFill = Math.min(chamber.capacity, chamber.currentFill + quantityToRestore);
        await this.updateChamberFill(lot.chamberId, newFill);
      }
    }

    await db.delete(salesHistory).where(eq(salesHistory.id, saleId));

    await this.createEditHistory({
      lotId: lot.id,
      changeType: "sale_reversed",
      previousData: JSON.stringify({ 
        saleStatus: lot.saleStatus, 
        remainingSize: lot.remainingSize,
        saleId: saleId 
      }),
      newData: JSON.stringify({ 
        saleStatus: newSaleStatus, 
        remainingSize: newRemainingSize,
        reversedQuantity: quantityToRestore 
      }),
    });

    // Return buyer name for FIFO recomputation (use CurrentDueBuyerName logic)
    const effectiveBuyerName = (sale.transferToBuyerName && sale.transferToBuyerName.trim()) 
      ? sale.transferToBuyerName.trim() 
      : (sale.buyerName || "");

    return { 
      success: true, 
      lot: updatedLot, 
      buyerName: effectiveBuyerName,
      coldStorageId: sale.coldStorageId 
    };
  }

  async getMaintenanceRecords(coldStorageId: string): Promise<MaintenanceRecord[]> {
    return db.select()
      .from(maintenanceRecords)
      .where(eq(maintenanceRecords.coldStorageId, coldStorageId))
      .orderBy(maintenanceRecords.createdAt);
  }

  async createMaintenanceRecord(data: InsertMaintenanceRecord): Promise<MaintenanceRecord> {
    const [record] = await db.insert(maintenanceRecords)
      .values({ id: randomUUID(), ...data })
      .returning();
    return record;
  }

  async updateMaintenanceRecord(id: string, updates: Partial<MaintenanceRecord>): Promise<MaintenanceRecord | undefined> {
    const [updated] = await db.update(maintenanceRecords)
      .set(updates)
      .where(eq(maintenanceRecords.id, id))
      .returning();
    return updated;
  }

  async deleteMaintenanceRecord(id: string): Promise<boolean> {
    const result = await db.delete(maintenanceRecords)
      .where(eq(maintenanceRecords.id, id))
      .returning();
    return result.length > 0;
  }

  async getSaleEditHistory(saleId: string): Promise<SaleEditHistory[]> {
    return db.select()
      .from(saleEditHistory)
      .where(eq(saleEditHistory.saleId, saleId))
      .orderBy(desc(saleEditHistory.changedAt));
  }

  async createSaleEditHistory(data: InsertSaleEditHistory): Promise<SaleEditHistory> {
    const [record] = await db.insert(saleEditHistory)
      .values({ id: randomUUID(), ...data })
      .returning();
    return record;
  }

  // Exit History methods
  async createExit(data: InsertExitHistory): Promise<ExitHistory> {
    // Get the current bill number (before incrementing)
    const coldStorage = await this.getColdStorage(data.coldStorageId);
    if (!coldStorage) {
      throw new Error("Cold storage not found");
    }
    const billNumber = coldStorage.nextExitBillNumber ?? 1;
    
    // Increment the counter for the next exit
    await db.update(coldStorages)
      .set({ nextExitBillNumber: sql`COALESCE(${coldStorages.nextExitBillNumber}, 0) + 1` })
      .where(eq(coldStorages.id, data.coldStorageId));
    
    // Create the exit record with the bill number
    const [record] = await db.insert(exitHistory)
      .values({ id: randomUUID(), billNumber, ...data })
      .returning();
    return record;
  }

  async getExitsForSale(salesHistoryId: string): Promise<ExitHistory[]> {
    return db.select()
      .from(exitHistory)
      .where(eq(exitHistory.salesHistoryId, salesHistoryId))
      .orderBy(desc(exitHistory.exitDate));
  }

  async getTotalExitedBags(salesHistoryId: string): Promise<number> {
    const exits = await db.select()
      .from(exitHistory)
      .where(and(
        eq(exitHistory.salesHistoryId, salesHistoryId),
        eq(exitHistory.isReversed, 0)
      ));
    return exits.reduce((sum, exit) => sum + exit.bagsExited, 0);
  }

  async getTotalBagsExited(coldStorageId: string, year?: number): Promise<number> {
    // Get all exit history for this cold storage
    const exits = await db.select()
      .from(exitHistory)
      .where(and(
        eq(exitHistory.coldStorageId, coldStorageId),
        eq(exitHistory.isReversed, 0)
      ));
    
    // Filter by year if provided
    let filteredExits = exits;
    if (year) {
      filteredExits = exits.filter(exit => {
        const exitYear = new Date(exit.exitDate).getFullYear();
        return exitYear === year;
      });
    }
    
    return filteredExits.reduce((sum, exit) => sum + exit.bagsExited, 0);
  }

  async reverseLatestExit(salesHistoryId: string): Promise<{ success: boolean; message?: string }> {
    // Get the latest non-reversed exit
    const exits = await db.select()
      .from(exitHistory)
      .where(and(
        eq(exitHistory.salesHistoryId, salesHistoryId),
        eq(exitHistory.isReversed, 0)
      ))
      .orderBy(desc(exitHistory.exitDate));

    if (exits.length === 0) {
      return { success: false, message: "No exits to reverse" };
    }

    const latestExit = exits[0];

    // Mark the exit as reversed
    await db.update(exitHistory)
      .set({ 
        isReversed: 1, 
        reversedAt: new Date() 
      })
      .where(eq(exitHistory.id, latestExit.id));

    return { success: true };
  }

  // Cash Receipts methods
  async getBuyersWithDues(coldStorageId: string): Promise<{ buyerName: string; totalDue: number }[]> {
    // Get all sales with due or partial payment status that have a buyer name
    // Include sales where either buyerName or transferToBuyerName is set
    // NOTE: Using raw SQL instead of Drizzle ORM's eq() because eq() combined with sql`` 
    // template literals in and() clauses was not reliably filtering by coldStorageId
    const rawResult = await db.execute(sql`
      SELECT * FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
      AND payment_status IN ('due', 'partial')
      AND ((buyer_name IS NOT NULL AND buyer_name != '') OR (transfer_to_buyer_name IS NOT NULL AND transfer_to_buyer_name != ''))
    `);
    const sales = rawResult.rows as any[];

    // Group by CurrentDueBuyerName (transferToBuyerName if set, else buyerName) and sum the due amounts
    const buyerDues = new Map<string, { displayName: string; totalDue: number }>();
    
    // Separate map for extraDueToMerchant - tracked by ORIGINAL buyerName (not transferred)
    const extraDueByOriginalBuyer = new Map<string, number>();
    
    for (const sale of sales) {
      // Raw SQL returns snake_case - access via any cast
      const saleRow = sale as any;
      // CurrentDueBuyerName logic: use transferToBuyerName if not blank, else buyerName
      const transferTo = (saleRow.transfer_to_buyer_name || saleRow.transferToBuyerName || "").trim();
      const buyer = (saleRow.buyer_name || saleRow.buyerName || "").trim();
      const currentDueBuyerName = transferTo || buyer;
      if (!currentDueBuyerName) continue;
      const normalizedKey = currentDueBuyerName.toLowerCase();
      
      // coldStorageCharge already includes base + kata + extraHammali + grading
      // Do NOT add them again to avoid double-counting
      const totalCharges = saleRow.cold_storage_charge || saleRow.coldStorageCharge || 0;
      const dueAmount = totalCharges - (saleRow.paid_amount || saleRow.paidAmount || 0);
      if (dueAmount > 0) {
        const existing = buyerDues.get(normalizedKey);
        if (existing) {
          existing.totalDue += dueAmount;
        } else {
          buyerDues.set(normalizedKey, { displayName: currentDueBuyerName, totalDue: dueAmount });
        }
      }
      
      // Track extraDueToMerchant separately by ORIGINAL buyerName (not affected by transfers)
      const extraDueToMerchant = saleRow.extra_due_to_merchant || saleRow.extraDueToMerchant || 0;
      if (extraDueToMerchant > 0 && buyer) {
        const originalKey = buyer.toLowerCase();
        const currentExtra = extraDueByOriginalBuyer.get(originalKey) || 0;
        extraDueByOriginalBuyer.set(originalKey, currentExtra + extraDueToMerchant);
      }
    }
    
    // Also get extraDueToMerchant from ALL sales (not just due/partial) by original buyer
    // since this is a separate charge that may exist even when cold charges are paid
    const extraDueResult = await db.execute(sql`
      SELECT * FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
      AND extra_due_to_merchant > 0
      AND buyer_name IS NOT NULL AND buyer_name != ''
    `);
    const allSalesForExtraDue = extraDueResult.rows as any[];
    
    for (const sale of allSalesForExtraDue) {
      const buyer = (sale.buyer_name || "").trim();
      if (!buyer) continue;
      const originalKey = buyer.toLowerCase();
      // Check if not already added (avoid double counting)
      if (!sales.some(s => s.id === sale.id)) {
        const currentExtra = extraDueByOriginalBuyer.get(originalKey) || 0;
        extraDueByOriginalBuyer.set(originalKey, currentExtra + (sale.extra_due_to_merchant || 0));
      }
    }
    
    // Add extraDueToMerchant to buyer dues by original buyer name
    for (const [normalizedKey, extraDue] of Array.from(extraDueByOriginalBuyer.entries())) {
      const existing = buyerDues.get(normalizedKey);
      if (existing) {
        existing.totalDue += extraDue;
      } else {
        // Find display name from sales
        const sale = allSalesForExtraDue.find(s => (s.buyer_name?.trim().toLowerCase()) === normalizedKey) ||
                     sales.find(s => (s.buyer_name?.trim().toLowerCase()) === normalizedKey);
        const displayName = sale?.buyer_name?.trim() || normalizedKey;
        buyerDues.set(normalizedKey, { displayName, totalDue: extraDue });
      }
    }

    // Add opening receivables for current year (cold_merchant type)
    const currentYear = new Date().getFullYear();
    const receivables = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.year, currentYear),
        eq(openingReceivables.payerType, "cold_merchant"),
        sql`${openingReceivables.buyerName} IS NOT NULL AND ${openingReceivables.buyerName} != ''`
      ));

    // Add receivables to buyer dues (using remaining amount after FIFO payments)
    for (const receivable of receivables) {
      const trimmedName = (receivable.buyerName || "").trim();
      if (!trimmedName) continue;
      const normalizedKey = trimmedName.toLowerCase();
      // Use remaining due amount (dueAmount - paidAmount) after FIFO allocation
      const remainingDue = (receivable.dueAmount || 0) - (receivable.paidAmount || 0);
      
      if (remainingDue > 0) {
        const existing = buyerDues.get(normalizedKey);
        if (existing) {
          existing.totalDue += remainingDue;
        } else {
          buyerDues.set(normalizedKey, { displayName: trimmedName, totalDue: remainingDue });
        }
      }
    }

    return Array.from(buyerDues.values())
      .map(({ displayName, totalDue }) => ({ buyerName: displayName, totalDue }))
      .sort((a, b) => a.buyerName.toLowerCase().localeCompare(b.buyerName.toLowerCase()));
  }

  async getCashReceipts(coldStorageId: string): Promise<CashReceipt[]> {
    return db.select()
      .from(cashReceipts)
      .where(eq(cashReceipts.coldStorageId, coldStorageId))
      .orderBy(desc(cashReceipts.receivedAt));
  }

  async getSalesGoodsBuyers(coldStorageId: string): Promise<string[]> {
    // Get distinct buyer names from cash receipts where payerType is 'sales_goods'
    const receipts = await db.select({ buyerName: cashReceipts.buyerName })
      .from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.payerType, "sales_goods"),
        sql`${cashReceipts.buyerName} IS NOT NULL`
      ));
    
    // Get unique buyer names (case-insensitive)
    const uniqueNames = new Map<string, string>();
    for (const r of receipts) {
      if (r.buyerName) {
        const trimmed = r.buyerName.trim();
        if (trimmed && !uniqueNames.has(trimmed.toLowerCase())) {
          uniqueNames.set(trimmed.toLowerCase(), trimmed);
        }
      }
    }
    
    return Array.from(uniqueNames.values()).sort((a, b) => 
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }

  async createCashReceiptWithFIFO(data: InsertCashReceipt): Promise<{ receipt: CashReceipt; salesUpdated: number }> {
    let remainingAmount = data.amount;
    let appliedAmount = 0;
    let salesUpdated = 0;
    const paymentMode = data.receiptType as "cash" | "account";
    const currentYear = new Date().getFullYear();

    // PASS 0: Apply to opening receivables first (FIFO by createdAt)
    // These are prior year balances that should be settled before current year charges
    if (remainingAmount > 0) {
      const buyerReceivables = await db.select()
        .from(openingReceivables)
        .where(and(
          eq(openingReceivables.coldStorageId, data.coldStorageId),
          eq(openingReceivables.year, currentYear),
          eq(openingReceivables.payerType, "cold_merchant"),
          sql`LOWER(TRIM(${openingReceivables.buyerName})) = LOWER(TRIM(${data.buyerName}))`,
          sql`(${openingReceivables.dueAmount} - ${openingReceivables.paidAmount}) > 0`
        ))
        .orderBy(openingReceivables.createdAt); // FIFO - oldest first

      for (const receivable of buyerReceivables) {
        if (remainingAmount <= 0) break;

        const receivableDue = (receivable.dueAmount || 0) - (receivable.paidAmount || 0);
        if (receivableDue <= 0) continue;

        if (remainingAmount >= receivableDue) {
          // Can fully pay this receivable
          await db.update(openingReceivables)
            .set({ paidAmount: receivable.dueAmount })
            .where(eq(openingReceivables.id, receivable.id));
          
          remainingAmount -= receivableDue;
          appliedAmount += receivableDue;
        } else {
          // Can only partially pay this receivable
          const newPaidAmount = (receivable.paidAmount || 0) + remainingAmount;
          await db.update(openingReceivables)
            .set({ paidAmount: newPaidAmount })
            .where(eq(openingReceivables.id, receivable.id));
          
          appliedAmount += remainingAmount;
          remainingAmount = 0;
        }
      }
    }

    // PASS 1: Apply to cold storage dues (FIFO by soldAt)
    // Use CurrentDueBuyerName logic: match transferToBuyerName first, else buyerName
    const sales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, data.coldStorageId),
        sql`LOWER(TRIM(COALESCE(NULLIF(${salesHistory.transferToBuyerName}, ''), ${salesHistory.buyerName}))) = LOWER(TRIM(${data.buyerName}))`,
        sql`${salesHistory.paymentStatus} IN ('due', 'partial')`
      ))
      .orderBy(salesHistory.soldAt); // FIFO - oldest first

    for (const sale of sales) {
      if (remainingAmount <= 0) break;

      // coldStorageCharge already includes base + kata + extraHammali + grading
      // Do NOT add them again to avoid double-counting
      const totalCharges = sale.coldStorageCharge || 0;
      const saleDueAmount = totalCharges - (sale.paidAmount || 0);
      
      if (saleDueAmount <= 0) continue;

      if (remainingAmount >= saleDueAmount) {
        // Can fully pay this sale
        await db.update(salesHistory)
          .set({
            paymentStatus: "paid",
            paidAmount: totalCharges,
            dueAmount: 0,
            paymentMode: paymentMode,
            paidAt: data.receivedAt,
          })
          .where(eq(salesHistory.id, sale.id));
        
        remainingAmount -= saleDueAmount;
        appliedAmount += saleDueAmount;
        salesUpdated++;
      } else {
        // Can only partially pay this sale
        const newPaidAmount = (sale.paidAmount || 0) + remainingAmount;
        const newDueAmount = totalCharges - newPaidAmount;
        
        await db.update(salesHistory)
          .set({
            paymentStatus: "partial",
            paidAmount: newPaidAmount,
            dueAmount: newDueAmount,
            paymentMode: paymentMode,
          })
          .where(eq(salesHistory.id, sale.id));
        
        appliedAmount += remainingAmount;
        remainingAmount = 0;
        salesUpdated++;
      }
    }

    // PASS 2: Apply remaining surplus to extraDueToMerchant (by ORIGINAL buyerName only)
    // This is separate from cold storage dues and tracks buyer-specific surcharges
    if (remainingAmount > 0) {
      // Get sales with extraDueToMerchant > 0 for the ORIGINAL buyerName (not CurrentDueBuyerName)
      const salesWithExtraDue = await db.select()
        .from(salesHistory)
        .where(and(
          eq(salesHistory.coldStorageId, data.coldStorageId),
          sql`LOWER(TRIM(${salesHistory.buyerName})) = LOWER(TRIM(${data.buyerName}))`,
          sql`${salesHistory.extraDueToMerchant} > 0`
        ))
        .orderBy(salesHistory.soldAt); // FIFO - oldest first

      for (const sale of salesWithExtraDue) {
        if (remainingAmount <= 0) break;

        const extraDue = sale.extraDueToMerchant || 0;
        if (extraDue <= 0) continue;

        if (remainingAmount >= extraDue) {
          // Can fully pay this extra due
          await db.update(salesHistory)
            .set({ extraDueToMerchant: 0 })
            .where(eq(salesHistory.id, sale.id));
          
          remainingAmount -= extraDue;
          appliedAmount += extraDue;
          salesUpdated++;
        } else {
          // Can only partially pay this extra due
          const newExtraDue = extraDue - remainingAmount;
          await db.update(salesHistory)
            .set({ extraDueToMerchant: newExtraDue })
            .where(eq(salesHistory.id, sale.id));
          
          appliedAmount += remainingAmount;
          remainingAmount = 0;
          salesUpdated++;
        }
      }
    }

    // Generate transaction ID (CF + YYYYMMDD + natural number) - unique per cold store
    const transactionId = await generateSequentialId('cash_flow', data.coldStorageId);

    // Calculate remaining dues for this buyer after transaction (for cold_merchant type)
    let dueBalanceAfter: number | null = null;
    if (data.payerType === "cold_merchant" && data.buyerName) {
      dueBalanceAfter = await this.getBuyerDueBalance(data.coldStorageId, data.buyerName);
    }

    // Create the receipt record
    const [receipt] = await db.insert(cashReceipts)
      .values({
        id: randomUUID(),
        transactionId,
        ...data,
        appliedAmount: appliedAmount,
        unappliedAmount: remainingAmount,
        dueBalanceAfter: dueBalanceAfter,
      })
      .returning();

    // Update lot totals for all affected lots
    const affectedLotIds = Array.from(new Set(sales.map(s => s.lotId)));
    for (const lotId of affectedLotIds) {
      await this.recalculateLotTotals(lotId);
    }

    return { receipt, salesUpdated };
  }

  // Helper function to get total remaining dues for a specific buyer
  private async getBuyerDueBalance(coldStorageId: string, buyerName: string): Promise<number> {
    const normalizedBuyer = buyerName.trim().toLowerCase();
    let totalDue = 0;
    const currentYear = new Date().getFullYear();

    // 1. Get cold storage dues from salesHistory (using CurrentDueBuyerName logic)
    const salesResult = await db.execute(sql`
      SELECT 
        COALESCE(cold_storage_charge, 0) as cold_storage_charge,
        COALESCE(paid_amount, 0) as paid_amount,
        COALESCE(extra_due_to_merchant, 0) as extra_due_to_merchant,
        buyer_name,
        transfer_to_buyer_name
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
      AND payment_status IN ('due', 'partial')
      AND LOWER(TRIM(COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name))) = ${normalizedBuyer}
    `);
    
    for (const row of salesResult.rows as any[]) {
      const charges = row.cold_storage_charge || 0;
      const paid = row.paid_amount || 0;
      const dueAmount = charges - paid;
      if (dueAmount > 0) {
        totalDue += dueAmount;
      }
    }

    // 2. Get extraDueToMerchant from salesHistory (by ORIGINAL buyerName only)
    const extraDueResult = await db.execute(sql`
      SELECT COALESCE(extra_due_to_merchant, 0) as extra_due_to_merchant
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
      AND extra_due_to_merchant > 0
      AND LOWER(TRIM(buyer_name)) = ${normalizedBuyer}
    `);
    
    for (const row of extraDueResult.rows as any[]) {
      totalDue += row.extra_due_to_merchant || 0;
    }

    // 3. Get opening receivables for this buyer (current year, cold_merchant type)
    const receivables = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.year, currentYear),
        eq(openingReceivables.payerType, "cold_merchant"),
        sql`LOWER(TRIM(${openingReceivables.buyerName})) = ${normalizedBuyer}`
      ));

    for (const receivable of receivables) {
      const remaining = (receivable.dueAmount || 0) - (receivable.paidAmount || 0);
      if (remaining > 0) {
        totalDue += remaining;
      }
    }

    return totalDue;
  }

  private async recalculateLotTotals(lotId: string): Promise<void> {
    // Get all sales for this lot
    const lotSales = await db.select()
      .from(salesHistory)
      .where(eq(salesHistory.lotId, lotId));

    let totalPaidCharge = 0;
    let totalDueCharge = 0;

    for (const sale of lotSales) {
      // coldStorageCharge already includes base + kata + extraHammali + grading
      // Do NOT add them again to avoid double-counting
      const charges = sale.coldStorageCharge || 0;
      
      if (sale.paymentStatus === "paid") {
        totalPaidCharge += charges;
      } else if (sale.paymentStatus === "due") {
        totalDueCharge += charges;
      } else if (sale.paymentStatus === "partial") {
        totalPaidCharge += sale.paidAmount || 0;
        totalDueCharge += sale.dueAmount || 0;
      }
    }

    // Calculate correct paymentStatus based on totals
    // 'paid' = fully paid (paid > 0 AND due <= 0)
    // 'due' = any amount due (due > 0)
    // null = no charges yet (paid == 0 AND due == 0)
    let newPaymentStatus: string | null = null;
    if (totalPaidCharge > 0 && totalDueCharge <= 0) {
      newPaymentStatus = "paid";
    } else if (totalDueCharge > 0) {
      newPaymentStatus = "due";
    } else {
      newPaymentStatus = null;
    }

    await db.update(lots)
      .set({
        totalPaidCharge,
        totalDueCharge,
        paymentStatus: newPaymentStatus,
      })
      .where(eq(lots.id, lotId));
  }

  async getExpenses(coldStorageId: string): Promise<Expense[]> {
    return db.select().from(expenses)
      .where(eq(expenses.coldStorageId, coldStorageId))
      .orderBy(desc(expenses.paidAt));
  }

  async createExpense(data: InsertExpense): Promise<Expense> {
    // Generate transaction ID (CF + YYYYMMDD + natural number) - unique per cold store
    const transactionId = await generateSequentialId('cash_flow', data.coldStorageId);

    const [expense] = await db.insert(expenses)
      .values({
        id: randomUUID(),
        transactionId,
        ...data,
      })
      .returning();
    return expense;
  }

  async getCashTransfers(coldStorageId: string): Promise<CashTransfer[]> {
    return db.select().from(cashTransfers)
      .where(eq(cashTransfers.coldStorageId, coldStorageId))
      .orderBy(desc(cashTransfers.transferredAt));
  }

  async createCashTransfer(data: InsertCashTransfer): Promise<CashTransfer> {
    if (data.fromAccountType === data.toAccountType) {
      throw new Error("Source and destination accounts must be different");
    }
    if (data.amount <= 0) {
      throw new Error("Transfer amount must be greater than 0");
    }
    // Generate transaction ID (CF + YYYYMMDD + natural number) - unique per cold store
    const transactionId = await generateSequentialId('cash_flow', data.coldStorageId);

    const [transfer] = await db.insert(cashTransfers)
      .values({
        id: randomUUID(),
        transactionId,
        ...data,
      })
      .returning();
    return transfer;
  }

  async reverseCashTransfer(transferId: string): Promise<{ success: boolean; message?: string }> {
    const [transfer] = await db.select()
      .from(cashTransfers)
      .where(eq(cashTransfers.id, transferId));

    if (!transfer) {
      return { success: false, message: "Transfer not found" };
    }

    if (transfer.isReversed === 1) {
      return { success: false, message: "Transfer is already reversed" };
    }

    await db.update(cashTransfers)
      .set({
        isReversed: 1,
        reversedAt: new Date(),
      })
      .where(eq(cashTransfers.id, transferId));

    return { success: true };
  }

  async reverseCashReceipt(receiptId: string): Promise<{ success: boolean; message?: string }> {
    // Get the receipt to reverse
    const [receipt] = await db.select()
      .from(cashReceipts)
      .where(eq(cashReceipts.id, receiptId));

    if (!receipt) {
      return { success: false, message: "Receipt not found" };
    }

    if (receipt.isReversed === 1) {
      return { success: false, message: "Receipt is already reversed" };
    }

    // Mark the receipt as reversed
    await db.update(cashReceipts)
      .set({
        isReversed: 1,
        reversedAt: new Date(),
      })
      .where(eq(cashReceipts.id, receiptId));

    // Use unified recomputeBuyerPayments to properly handle both receipts AND discounts
    // This replaces the old custom FIFO replay that only considered receipts
    if (receipt.buyerName && receipt.coldStorageId) {
      await this.recomputeBuyerPayments(receipt.buyerName, receipt.coldStorageId);
    }

    return { success: true, message: "Receipt reversed and payments recalculated" };
  }

  async reverseExpense(expenseId: string): Promise<{ success: boolean; message?: string }> {
    // Get the expense to reverse
    const [expense] = await db.select()
      .from(expenses)
      .where(eq(expenses.id, expenseId));

    if (!expense) {
      return { success: false, message: "Expense not found" };
    }

    if (expense.isReversed === 1) {
      return { success: false, message: "Expense is already reversed" };
    }

    // Mark the expense as reversed
    await db.update(expenses)
      .set({
        isReversed: 1,
        reversedAt: new Date(),
      })
      .where(eq(expenses.id, expenseId));

    return { success: true, message: "Expense reversed" };
  }

  async recomputeBuyerPayments(buyerName: string, coldStorageId: string): Promise<{ salesUpdated: number; receiptsUpdated: number }> {
    // Step 1: Reset all sales for this buyer to "due" status with 0 paidAmount
    // Calculate proper dueAmount using all surcharges
    // Use CurrentDueBuyerName logic: match transferToBuyerName first, else buyerName
    const buyerSales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(COALESCE(NULLIF(${salesHistory.transferToBuyerName}, ''), ${salesHistory.buyerName}))) = LOWER(TRIM(${buyerName}))`
      ))
      .orderBy(salesHistory.soldAt);

    // Reset each sale's payment info and recalculate dueAmount from current charges
    for (const sale of buyerSales) {
      // coldStorageCharge already includes base + kata + extraHammali + grading
      // Do NOT add them again to avoid double-counting
      const totalCharges = sale.coldStorageCharge || 0;
      await db.update(salesHistory)
        .set({
          paymentStatus: "due",
          paidAmount: 0,
          dueAmount: totalCharges,
          discountAllocated: 0,
          paymentMode: null,
          paidAt: null,
        })
        .where(eq(salesHistory.id, sale.id));
    }

    // Also reset extraDueToMerchant to original values (for sales where original buyerName matches)
    // This is separate from cold storage dues - only reset for sales where ORIGINAL buyer matches
    // Handles both extraDueToMerchantOriginal and legacy records (use extraDueToMerchant as fallback)
    const salesByOriginalBuyer = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${salesHistory.buyerName})) = LOWER(TRIM(${buyerName}))`,
        sql`(${salesHistory.extraDueToMerchantOriginal} > 0 OR ${salesHistory.extraDueToMerchant} > 0)`
      ));
    
    for (const sale of salesByOriginalBuyer) {
      // Use extraDueToMerchantOriginal if set, otherwise use current extraDueToMerchant as the baseline
      const originalValue = (sale.extraDueToMerchantOriginal && sale.extraDueToMerchantOriginal > 0) 
        ? sale.extraDueToMerchantOriginal 
        : (sale.extraDueToMerchant || 0);
      
      // If we're using extraDueToMerchant as fallback, also set extraDueToMerchantOriginal for future recomputes
      await db.update(salesHistory)
        .set({
          extraDueToMerchant: originalValue,
          extraDueToMerchantOriginal: originalValue,
        })
        .where(eq(salesHistory.id, sale.id));
    }

    // Reset opening receivables paidAmount to 0 for this buyer (current year, cold_merchant type)
    const currentYear = new Date().getFullYear();
    await db.update(openingReceivables)
      .set({ paidAmount: 0 })
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.year, currentYear),
        eq(openingReceivables.payerType, "cold_merchant"),
        sql`LOWER(TRIM(${openingReceivables.buyerName})) = LOWER(TRIM(${buyerName}))`
      ));

    // Step 2: Get all non-reversed receipts for this buyer, ordered by receivedAt (FIFO)
    const activeReceipts = await db.select()
      .from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${cashReceipts.buyerName})) = LOWER(TRIM(${buyerName}))`,
        eq(cashReceipts.isReversed, 0)
      ))
      .orderBy(cashReceipts.receivedAt);

    let salesUpdated = 0;
    let receiptsUpdated = 0;

    // Step 3: Get all non-reversed discounts that affect this buyer
    // Discounts are allocated by farmer+village+contact+buyer, so we need to find discounts
    // where any buyer allocation matches this buyer name
    const activeDiscounts = await db.select()
      .from(discounts)
      .where(and(
        eq(discounts.coldStorageId, coldStorageId),
        eq(discounts.isReversed, 0)
      ));
    
    // Filter discounts to only those with allocations matching this buyer
    const relevantDiscounts: { discount: typeof activeDiscounts[0]; allocation: { buyerName: string; amount: number } }[] = [];
    for (const discount of activeDiscounts) {
      const allocations: { buyerName: string; amount: number }[] = JSON.parse(discount.buyerAllocations);
      for (const allocation of allocations) {
        if (allocation.buyerName.trim().toLowerCase() === buyerName.trim().toLowerCase()) {
          relevantDiscounts.push({ discount, allocation });
        }
      }
    }

    // Step 4: Merge receipts and discounts into a unified timeline and sort by date
    type Transaction = 
      | { type: 'receipt'; data: typeof activeReceipts[0]; date: Date }
      | { type: 'discount'; data: typeof relevantDiscounts[0]; date: Date };
    
    const transactions: Transaction[] = [];
    
    for (const receipt of activeReceipts) {
      transactions.push({
        type: 'receipt',
        data: receipt,
        date: new Date(receipt.receivedAt || receipt.createdAt)
      });
    }
    
    for (const rd of relevantDiscounts) {
      transactions.push({
        type: 'discount',
        data: rd,
        date: new Date(rd.discount.discountDate || rd.discount.createdAt)
      });
    }
    
    // Sort by date to replay in chronological order
    transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Step 5: Re-apply each transaction in chronological order
    for (const txn of transactions) {
      if (txn.type === 'receipt') {
        const receipt = txn.data;
        await this.applyReceiptFIFO(receipt, coldStorageId, buyerName, currentYear);
        receiptsUpdated++;
        salesUpdated++;
      } else {
        const { discount, allocation } = txn.data;
        await this.applyDiscountAllocation(discount, allocation, coldStorageId);
        salesUpdated++;
      }
    }

    // Update lot totals for all affected lots
    const affectedLotIds = Array.from(new Set(buyerSales.map(s => s.lotId)));
    for (const lotId of affectedLotIds) {
      await this.recalculateLotTotals(lotId);
    }

    return { salesUpdated, receiptsUpdated };
  }

  // Helper: Apply a single receipt using FIFO logic
  private async applyReceiptFIFO(
    receipt: CashReceipt,
    coldStorageId: string,
    buyerName: string,
    currentYear: number
  ): Promise<void> {
    let remainingAmount = receipt.amount;
    let appliedAmount = 0;
    const paymentMode = receipt.receiptType as "cash" | "account";

    // PASS 0: Apply to opening receivables first (FIFO by createdAt)
    if (remainingAmount > 0) {
      const buyerReceivables = await db.select()
        .from(openingReceivables)
        .where(and(
          eq(openingReceivables.coldStorageId, coldStorageId),
          eq(openingReceivables.year, currentYear),
          eq(openingReceivables.payerType, "cold_merchant"),
          sql`LOWER(TRIM(${openingReceivables.buyerName})) = LOWER(TRIM(${buyerName}))`,
          sql`(${openingReceivables.dueAmount} - ${openingReceivables.paidAmount}) > 0`
        ))
        .orderBy(openingReceivables.createdAt);

      for (const receivable of buyerReceivables) {
        if (remainingAmount <= 0) break;

        const receivableDue = (receivable.dueAmount || 0) - (receivable.paidAmount || 0);
        if (receivableDue <= 0) continue;

        if (remainingAmount >= receivableDue) {
          await db.update(openingReceivables)
            .set({ paidAmount: receivable.dueAmount })
            .where(eq(openingReceivables.id, receivable.id));
          
          remainingAmount -= receivableDue;
          appliedAmount += receivableDue;
        } else {
          const newPaidAmount = (receivable.paidAmount || 0) + remainingAmount;
          await db.update(openingReceivables)
            .set({ paidAmount: newPaidAmount })
            .where(eq(openingReceivables.id, receivable.id));
          
          appliedAmount += remainingAmount;
          remainingAmount = 0;
        }
      }
    }

    // PASS 1: Apply to cold storage dues (FIFO by soldAt)
    if (remainingAmount > 0) {
      const sales = await db.select()
        .from(salesHistory)
        .where(and(
          eq(salesHistory.coldStorageId, coldStorageId),
          sql`LOWER(TRIM(COALESCE(NULLIF(${salesHistory.transferToBuyerName}, ''), ${salesHistory.buyerName}))) = LOWER(TRIM(${buyerName}))`,
          sql`${salesHistory.paymentStatus} IN ('due', 'partial')`
        ))
        .orderBy(salesHistory.soldAt);

      for (const sale of sales) {
        if (remainingAmount <= 0) break;

        const totalCharges = sale.coldStorageCharge || 0;
        const saleDueAmount = totalCharges - (sale.paidAmount || 0);
        
        if (saleDueAmount <= 0) continue;

        if (remainingAmount >= saleDueAmount) {
          await db.update(salesHistory)
            .set({
              paymentStatus: "paid",
              paidAmount: totalCharges,
              dueAmount: 0,
              paymentMode: paymentMode,
              paidAt: receipt.receivedAt,
            })
            .where(eq(salesHistory.id, sale.id));
          
          remainingAmount -= saleDueAmount;
          appliedAmount += saleDueAmount;
        } else {
          const newPaidAmount = (sale.paidAmount || 0) + remainingAmount;
          const newDueAmount = totalCharges - newPaidAmount;
          
          await db.update(salesHistory)
            .set({
              paymentStatus: "partial",
              paidAmount: newPaidAmount,
              dueAmount: newDueAmount,
              paymentMode: paymentMode,
            })
            .where(eq(salesHistory.id, sale.id));
          
          appliedAmount += remainingAmount;
          remainingAmount = 0;
        }
      }
    }

    // PASS 2: Apply remaining surplus to extraDueToMerchant (by ORIGINAL buyerName only)
    if (remainingAmount > 0) {
      const salesWithExtraDue = await db.select()
        .from(salesHistory)
        .where(and(
          eq(salesHistory.coldStorageId, coldStorageId),
          sql`LOWER(TRIM(${salesHistory.buyerName})) = LOWER(TRIM(${buyerName}))`,
          sql`${salesHistory.extraDueToMerchant} > 0`
        ))
        .orderBy(salesHistory.soldAt);

      for (const sale of salesWithExtraDue) {
        if (remainingAmount <= 0) break;

        const extraDue = sale.extraDueToMerchant || 0;
        if (extraDue <= 0) continue;

        if (remainingAmount >= extraDue) {
          await db.update(salesHistory)
            .set({ extraDueToMerchant: 0 })
            .where(eq(salesHistory.id, sale.id));
          
          remainingAmount -= extraDue;
          appliedAmount += extraDue;
        } else {
          const newExtraDue = extraDue - remainingAmount;
          await db.update(salesHistory)
            .set({ extraDueToMerchant: newExtraDue })
            .where(eq(salesHistory.id, sale.id));
          
          appliedAmount += remainingAmount;
          remainingAmount = 0;
        }
      }
    }

    // Update the receipt's applied/unapplied amounts
    await db.update(cashReceipts)
      .set({
        appliedAmount: appliedAmount,
        unappliedAmount: remainingAmount,
      })
      .where(eq(cashReceipts.id, receipt.id));
  }

  // Helper: Apply a single discount allocation
  private async applyDiscountAllocation(
    discount: Discount,
    allocation: { buyerName: string; amount: number },
    coldStorageId: string
  ): Promise<void> {
    let remainingAmount = allocation.amount;
    
    // Get sales for this farmer from this buyer, ordered by oldest first (FIFO)
    const salesResult = await db.execute(sql`
      SELECT id, due_amount
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND farmer_name = ${discount.farmerName}
        AND village = ${discount.village}
        AND contact_number = ${discount.contactNumber}
        AND LOWER(TRIM(COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name))) = LOWER(TRIM(${allocation.buyerName}))
        AND due_amount > 0
      ORDER BY sold_at ASC
    `);
    
    for (const row of salesResult.rows as { id: string; due_amount: number }[]) {
      if (remainingAmount <= 0) break;
      
      const saleId = row.id;
      const currentDue = row.due_amount;
      const discountToApply = Math.min(remainingAmount, currentDue);
      
      await db.execute(sql`
        UPDATE sales_history
        SET 
          due_amount = due_amount - ${discountToApply},
          paid_amount = paid_amount + ${discountToApply},
          discount_allocated = COALESCE(discount_allocated, 0) + ${discountToApply},
          payment_status = CASE 
            WHEN due_amount - ${discountToApply} <= 0 THEN 'paid'
            ELSE 'partial'
          END
        WHERE id = ${saleId}
      `);
      
      remainingAmount -= discountToApply;
    }
  }

  async recalculateSalesCharges(coldStorageId: string): Promise<{ updated: number; message: string }> {
    // Get all sales for the cold storage
    const allSales = await this.getSalesHistory(coldStorageId);
    
    let updated = 0;
    
    for (const sale of allSales) {
      // coldStorageCharge already includes base + kata + extraHammali + grading
      // Do NOT add them again to avoid double-counting
      const totalCharges = sale.coldStorageCharge || 0;
      
      // Calculate what the paid/due amounts should be based on payment status
      let newPaidAmount = 0;
      let newDueAmount = 0;
      
      if (sale.paymentStatus === "paid") {
        newPaidAmount = totalCharges;
        newDueAmount = 0;
      } else if (sale.paymentStatus === "due") {
        newPaidAmount = 0;
        newDueAmount = totalCharges;
      } else if (sale.paymentStatus === "partial") {
        // Keep the existing paid amount ratio but recalculate based on total charges
        const existingPaid = sale.paidAmount || 0;
        const existingTotal = existingPaid + (sale.dueAmount || 0);
        
        if (existingTotal > 0) {
          // Preserve the paid ratio
          newPaidAmount = Math.min(existingPaid, totalCharges);
          newDueAmount = totalCharges - newPaidAmount;
        } else {
          // Default to all due
          newDueAmount = totalCharges;
        }
      }
      
      // Only update if values are different
      const currentTotal = (sale.paidAmount || 0) + (sale.dueAmount || 0);
      if (Math.abs(currentTotal - totalCharges) > 0.01) {
        await db.update(salesHistory)
          .set({
            paidAmount: newPaidAmount,
            dueAmount: newDueAmount,
          })
          .where(eq(salesHistory.id, sale.id));
        updated++;
      }
    }
    
    // Also update lot totals
    const allLots = await this.getAllLots(coldStorageId);
    for (const lot of allLots) {
      // Get all sales for this lot
      const lotSales = allSales.filter(s => s.lotId === lot.id);
      
      let totalPaidCharge = 0;
      let totalDueCharge = 0;
      
      for (const sale of lotSales) {
        // coldStorageCharge already includes base + kata + extraHammali + grading
        // Do NOT add them again to avoid double-counting
        const charges = sale.coldStorageCharge || 0;
        
        if (sale.paymentStatus === "paid") {
          totalPaidCharge += charges;
        } else if (sale.paymentStatus === "due") {
          totalDueCharge += charges;
        } else if (sale.paymentStatus === "partial") {
          totalPaidCharge += sale.paidAmount || 0;
          totalDueCharge += (sale.dueAmount || 0);
        }
      }
      
      // Calculate correct paymentStatus based on totals
      // 'paid' = fully paid (paid > 0 AND due <= 0)
      // 'due' = any amount due (due > 0)
      // null = no charges yet (paid == 0 AND due == 0)
      let newPaymentStatus: string | null = null;
      if (totalPaidCharge > 0 && totalDueCharge <= 0) {
        newPaymentStatus = "paid";
      } else if (totalDueCharge > 0) {
        newPaymentStatus = "due";
      } else {
        newPaymentStatus = null;
      }
      
      // Update lot if totals OR paymentStatus differs
      const statusDiffers = newPaymentStatus !== lot.paymentStatus;
      const totalsDiffer = lot.totalPaidCharge !== totalPaidCharge || lot.totalDueCharge !== totalDueCharge;
      
      if (totalsDiffer || statusDiffers) {
        await db.update(lots)
          .set({
            totalPaidCharge,
            totalDueCharge,
            paymentStatus: newPaymentStatus,
          })
          .where(eq(lots.id, lot.id));
      }
    }
    
    return { 
      updated, 
      message: `Recalculated ${updated} sales records and updated lot totals` 
    };
  }

  async assignBillNumber(saleId: string, billType: "coldStorage" | "sales"): Promise<number> {
    // Get the sale to find its coldStorageId
    const [sale] = await db.select()
      .from(salesHistory)
      .where(eq(salesHistory.id, saleId));
    
    if (!sale) {
      throw new Error("Sale not found");
    }
    
    // Check if bill number already assigned
    const existingBillNumber = billType === "coldStorage" 
      ? sale.coldStorageBillNumber 
      : sale.salesBillNumber;
    
    if (existingBillNumber) {
      return existingBillNumber;
    }
    
    // Get the current bill number (before incrementing)
    const coldStorage = await this.getColdStorage(sale.coldStorageId);
    if (!coldStorage) {
      throw new Error("Cold storage not found");
    }
    
    const billNumber = billType === "coldStorage" 
      ? (coldStorage.nextColdStorageBillNumber ?? 1)
      : (coldStorage.nextSalesBillNumber ?? 1);
    
    // Increment the counter for the next assignment
    await db.update(coldStorages)
      .set(
        billType === "coldStorage" 
          ? { nextColdStorageBillNumber: sql`COALESCE(${coldStorages.nextColdStorageBillNumber}, 0) + 1` }
          : { nextSalesBillNumber: sql`COALESCE(${coldStorages.nextSalesBillNumber}, 0) + 1` }
      )
      .where(eq(coldStorages.id, sale.coldStorageId));
    
    // Update the sale with the assigned bill number
    await db.update(salesHistory)
      .set(
        billType === "coldStorage" 
          ? { coldStorageBillNumber: billNumber }
          : { salesBillNumber: billNumber }
      )
      .where(eq(salesHistory.id, saleId));
    
    return billNumber;
  }

  async assignLotBillNumber(lotId: string): Promise<number> {
    // Get the lot to find its coldStorageId
    const [lot] = await db.select()
      .from(lots)
      .where(eq(lots.id, lotId));
    
    if (!lot) {
      throw new Error("Lot not found");
    }
    
    // Check if bill number already assigned
    if (lot.entryBillNumber) {
      return lot.entryBillNumber;
    }
    
    // Get the current bill number (before incrementing)
    const coldStorage = await this.getColdStorage(lot.coldStorageId);
    if (!coldStorage) {
      throw new Error("Cold storage not found");
    }
    const billNumber = coldStorage.nextEntryBillNumber ?? 1;
    
    // Increment the counter for the next assignment
    await db.update(coldStorages)
      .set({ nextEntryBillNumber: sql`COALESCE(${coldStorages.nextEntryBillNumber}, 0) + 1` })
      .where(eq(coldStorages.id, lot.coldStorageId));
    
    // Update the lot with the assigned bill number
    await db.update(lots)
      .set({ entryBillNumber: billNumber })
      .where(eq(lots.id, lotId));
    
    return billNumber;
  }

  // Admin - Cold Storage Management
  async getAllColdStorages(): Promise<ColdStorage[]> {
    return await db.select().from(coldStorages);
  }

  async createColdStorage(data: InsertColdStorage): Promise<ColdStorage> {
    const id = await generateSequentialId('cold_storage');
    const [newStorage] = await db.insert(coldStorages)
      .values({ ...data, id })
      .returning();
    return newStorage;
  }

  async archiveColdStorage(id: string): Promise<boolean> {
    // Use updateColdStorageStatus to ensure session invalidation happens
    return this.updateColdStorageStatus(id, 'archived');
  }

  async updateColdStorageStatus(id: string, status: 'active' | 'inactive' | 'archived'): Promise<boolean> {
    await db.update(coldStorages)
      .set({ status })
      .where(eq(coldStorages.id, id));
    
    // If status is inactive or archived, invalidate all user sessions for this cold storage
    // This forces all logged-in users to re-authenticate and see the appropriate error
    if (status === 'inactive' || status === 'archived') {
      await db.delete(userSessions).where(eq(userSessions.coldStorageId, id));
    }
    
    return true;
  }

  async resetColdStorage(id: string): Promise<boolean> {
    // Delete all data for this cold storage (factory reset)
    
    // First, invalidate all user sessions to force logout
    await db.delete(userSessions).where(eq(userSessions.coldStorageId, id));
    
    // Delete lots and related data
    const lotsToDelete = await db.select({ id: lots.id }).from(lots).where(eq(lots.coldStorageId, id));
    const lotIds = lotsToDelete.map(l => l.id);
    
    if (lotIds.length > 0) {
      // Delete lot edit history
      await db.delete(lotEditHistory).where(inArray(lotEditHistory.lotId, lotIds));
      // Get sales history IDs to delete sale edit history first
      const salesToDelete = await db.select({ id: salesHistory.id }).from(salesHistory).where(inArray(salesHistory.lotId, lotIds));
      const saleIds = salesToDelete.map(s => s.id);
      if (saleIds.length > 0) {
        // Delete sale edit history (changes to sales records)
        await db.delete(saleEditHistory).where(inArray(saleEditHistory.saleId, saleIds));
      }
      // Delete sales history
      await db.delete(salesHistory).where(inArray(salesHistory.lotId, lotIds));
    }
    // Delete exit history (by coldStorageId to catch all records)
    await db.delete(exitHistory).where(eq(exitHistory.coldStorageId, id));
    // Delete lots
    await db.delete(lots).where(eq(lots.coldStorageId, id));
    
    // Delete cash flow data
    await db.delete(cashReceipts).where(eq(cashReceipts.coldStorageId, id));
    await db.delete(expenses).where(eq(expenses.coldStorageId, id));
    await db.delete(cashTransfers).where(eq(cashTransfers.coldStorageId, id));
    await db.delete(discounts).where(eq(discounts.coldStorageId, id));
    await db.delete(cashOpeningBalances).where(eq(cashOpeningBalances.coldStorageId, id));
    await db.delete(openingReceivables).where(eq(openingReceivables.coldStorageId, id));
    await db.delete(openingPayables).where(eq(openingPayables.coldStorageId, id));
    
    // Delete maintenance records
    await db.delete(maintenanceRecords).where(eq(maintenanceRecords.coldStorageId, id));
    
    // Delete chambers and their floors
    const chambersToDelete = await db.select({ id: chambers.id }).from(chambers).where(eq(chambers.coldStorageId, id));
    const chamberIds = chambersToDelete.map(c => c.id);
    if (chamberIds.length > 0) {
      await db.delete(chamberFloors).where(inArray(chamberFloors.chamberId, chamberIds));
    }
    await db.delete(chambers).where(eq(chambers.coldStorageId, id));
    
    // Reset bill number counters and set status to active
    await db.update(coldStorages)
      .set({
        nextExitBillNumber: 1,
        nextColdStorageBillNumber: 1,
        nextSalesBillNumber: 1,
        nextEntryBillNumber: 1,
        nextWaferLotNumber: 1,
        nextRationSeedLotNumber: 1,
        startingWaferLotNumber: 1,
        startingRationSeedLotNumber: 1,
        status: 'active',
      })
      .where(eq(coldStorages.id, id));
    
    return true;
  }

  // Cold Storage Users
  async getColdStorageUsers(coldStorageId: string): Promise<ColdStorageUser[]> {
    return await db.select()
      .from(coldStorageUsers)
      .where(eq(coldStorageUsers.coldStorageId, coldStorageId));
  }

  async createColdStorageUser(data: InsertColdStorageUser): Promise<ColdStorageUser> {
    const id = `user-${randomUUID()}`;
    const [newUser] = await db.insert(coldStorageUsers)
      .values({ ...data, id })
      .returning();
    return newUser;
  }

  async updateColdStorageUser(id: string, updates: Partial<ColdStorageUser>): Promise<ColdStorageUser | undefined> {
    const [updated] = await db.update(coldStorageUsers)
      .set(updates)
      .where(eq(coldStorageUsers.id, id))
      .returning();
    return updated;
  }

  async deleteColdStorageUser(id: string): Promise<boolean> {
    await db.delete(coldStorageUsers).where(eq(coldStorageUsers.id, id));
    return true;
  }

  async resetUserPassword(userId: string, newPassword: string): Promise<boolean> {
    const [updated] = await db.update(coldStorageUsers)
      .set({ password: newPassword })
      .where(eq(coldStorageUsers.id, userId))
      .returning();
    return !!updated;
  }

  // Authentication
  async authenticateUser(mobileNumber: string, password: string): Promise<{ user: ColdStorageUser; coldStorage: ColdStorage; blocked?: string } | null> {
    const [user] = await db.select()
      .from(coldStorageUsers)
      .where(eq(coldStorageUsers.mobileNumber, mobileNumber));
    
    if (!user || user.password !== password) {
      return null;
    }

    const [coldStorage] = await db.select()
      .from(coldStorages)
      .where(eq(coldStorages.id, user.coldStorageId));

    if (!coldStorage) {
      return null;
    }

    // Block login for inactive or archived cold stores
    if (coldStorage.status === 'inactive') {
      return { user, coldStorage, blocked: 'inactive' };
    }
    if (coldStorage.status === 'archived') {
      return { user, coldStorage, blocked: 'archived' };
    }

    return { user, coldStorage };
  }

  async getUserById(userId: string): Promise<ColdStorageUser | undefined> {
    const [user] = await db.select()
      .from(coldStorageUsers)
      .where(eq(coldStorageUsers.id, userId));
    return user;
  }

  // Session Management
  async createSession(token: string, userId: string, coldStorageId: string): Promise<UserSession> {
    const [session] = await db.insert(userSessions)
      .values({ id: token, userId, coldStorageId })
      .returning();
    return session;
  }

  async getSession(token: string): Promise<UserSession | undefined> {
    const [session] = await db.select()
      .from(userSessions)
      .where(eq(userSessions.id, token));
    return session;
  }

  async deleteSession(token: string): Promise<void> {
    await db.delete(userSessions).where(eq(userSessions.id, token));
  }

  async updateSessionLastAccess(token: string): Promise<void> {
    await db.update(userSessions)
      .set({ lastAccessedAt: new Date() })
      .where(eq(userSessions.id, token));
  }

  // Export methods
  async getLotsForExport(coldStorageId: string, fromDate: Date, toDate: Date): Promise<Lot[]> {
    return db.select()
      .from(lots)
      .where(
        and(
          eq(lots.coldStorageId, coldStorageId),
          gte(lots.createdAt, fromDate),
          lte(lots.createdAt, toDate)
        )
      )
      .orderBy(desc(lots.createdAt));
  }

  async getSalesForExport(coldStorageId: string, fromDate: Date, toDate: Date, filters?: { year?: string; farmerName?: string; village?: string; contactNumber?: string; buyerName?: string; paymentStatus?: string }): Promise<SalesHistory[]> {
    const conditions: SQL[] = [eq(salesHistory.coldStorageId, coldStorageId)];
    
    // If year filter is provided and not "all", filter by year instead of date range
    if (filters?.year && filters.year !== "all") {
      const yearNum = parseInt(filters.year, 10);
      const yearStart = new Date(yearNum, 0, 1);
      const yearEnd = new Date(yearNum, 11, 31, 23, 59, 59, 999);
      conditions.push(gte(salesHistory.soldAt, yearStart));
      conditions.push(lte(salesHistory.soldAt, yearEnd));
    } else {
      // Use date range filter
      conditions.push(gte(salesHistory.soldAt, fromDate));
      conditions.push(lte(salesHistory.soldAt, toDate));
    }
    
    // Apply optional filters
    if (filters?.farmerName) {
      conditions.push(ilike(salesHistory.farmerName, `%${filters.farmerName}%`));
    }
    if (filters?.village) {
      conditions.push(eq(salesHistory.village, filters.village));
    }
    if (filters?.contactNumber) {
      conditions.push(eq(salesHistory.contactNumber, filters.contactNumber));
    }
    if (filters?.buyerName) {
      conditions.push(ilike(salesHistory.buyerName, `%${filters.buyerName}%`));
    }
    if (filters?.paymentStatus) {
      if (filters.paymentStatus === "paid") {
        conditions.push(eq(salesHistory.paymentStatus, "paid"));
      } else if (filters.paymentStatus === "due") {
        const dueCondition = or(eq(salesHistory.paymentStatus, "due"), eq(salesHistory.paymentStatus, "partial"));
        if (dueCondition) conditions.push(dueCondition);
      }
    }
    
    return db.select()
      .from(salesHistory)
      .where(and(...conditions))
      .orderBy(desc(salesHistory.soldAt));
  }

  async getCashDataForExport(coldStorageId: string, fromDate: Date, toDate: Date): Promise<{ receipts: CashReceipt[]; expenses: Expense[]; transfers: CashTransfer[] }> {
    const receiptsData = await db.select()
      .from(cashReceipts)
      .where(
        and(
          eq(cashReceipts.coldStorageId, coldStorageId),
          eq(cashReceipts.isReversed, 0),
          gte(cashReceipts.receivedAt, fromDate),
          lte(cashReceipts.receivedAt, toDate)
        )
      )
      .orderBy(desc(cashReceipts.receivedAt));

    const expensesData = await db.select()
      .from(expenses)
      .where(
        and(
          eq(expenses.coldStorageId, coldStorageId),
          eq(expenses.isReversed, 0),
          gte(expenses.paidAt, fromDate),
          lte(expenses.paidAt, toDate)
        )
      )
      .orderBy(desc(expenses.paidAt));

    const transfersData = await db.select()
      .from(cashTransfers)
      .where(
        and(
          eq(cashTransfers.coldStorageId, coldStorageId),
          eq(cashTransfers.isReversed, 0),
          gte(cashTransfers.transferredAt, fromDate),
          lte(cashTransfers.transferredAt, toDate)
        )
      )
      .orderBy(desc(cashTransfers.transferredAt));

    return { receipts: receiptsData, expenses: expensesData, transfers: transfersData };
  }

  async getFarmerRecords(coldStorageId: string, year?: number): Promise<{ farmerName: string; village: string; tehsil: string; district: string; state: string; contactNumber: string }[]> {
    const currentYear = year || new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear + 1, 0, 1);

    const allLots = await db.select({
      farmerName: lots.farmerName,
      village: lots.village,
      tehsil: lots.tehsil,
      district: lots.district,
      state: lots.state,
      contactNumber: lots.contactNumber,
    })
      .from(lots)
      .where(
        and(
          eq(lots.coldStorageId, coldStorageId),
          gte(lots.createdAt, startOfYear),
          sql`${lots.createdAt} < ${endOfYear}`
        )
      );

    // Deduplicate by normalized key (lowercase trimmed contactNumber + farmerName + village)
    const seen = new Map<string, { farmerName: string; village: string; tehsil: string; district: string; state: string; contactNumber: string }>();
    for (const lot of allLots) {
      const key = `${lot.contactNumber.trim().toLowerCase()}|${lot.farmerName.trim().toLowerCase()}|${lot.village.trim().toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, {
          farmerName: lot.farmerName.trim(),
          village: lot.village.trim(),
          tehsil: lot.tehsil.trim(),
          district: lot.district.trim(),
          state: lot.state.trim(),
          contactNumber: lot.contactNumber.trim(),
        });
      }
    }

    return Array.from(seen.values());
  }

  async getBuyerRecords(coldStorageId: string): Promise<{ buyerName: string }[]> {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const allSales = await db.select({
      buyerName: salesHistory.buyerName,
    })
      .from(salesHistory)
      .where(
        and(
          eq(salesHistory.coldStorageId, coldStorageId),
          gte(salesHistory.soldAt, twoYearsAgo),
          sql`${salesHistory.buyerName} IS NOT NULL AND ${salesHistory.buyerName} != ''`
        )
      );

    // Deduplicate by normalized buyer name
    const seen = new Map<string, { buyerName: string }>();
    for (const sale of allSales) {
      if (sale.buyerName) {
        const key = sale.buyerName.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, { buyerName: sale.buyerName.trim() });
        }
      }
    }

    return Array.from(seen.values()).sort((a, b) => a.buyerName.localeCompare(b.buyerName));
  }

  // Bag type label lookup
  async getBagTypeLabels(coldStorageId: string): Promise<{ label: string }[]> {
    const allLots = await db.select({
      bagTypeLabel: lots.bagTypeLabel,
    })
      .from(lots)
      .where(
        and(
          eq(lots.coldStorageId, coldStorageId),
          sql`${lots.bagTypeLabel} IS NOT NULL AND ${lots.bagTypeLabel} != ''`
        )
      );

    // Deduplicate by normalized label
    const seen = new Map<string, { label: string }>();
    for (const lot of allLots) {
      if (lot.bagTypeLabel) {
        const key = lot.bagTypeLabel.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, { label: lot.bagTypeLabel.trim() });
        }
      }
    }

    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }

  // Opening Balances
  async getOpeningBalance(coldStorageId: string, year: number): Promise<CashOpeningBalance | undefined> {
    const [balance] = await db.select()
      .from(cashOpeningBalances)
      .where(
        and(
          eq(cashOpeningBalances.coldStorageId, coldStorageId),
          eq(cashOpeningBalances.year, year)
        )
      );
    return balance;
  }

  async upsertOpeningBalance(data: InsertCashOpeningBalance): Promise<CashOpeningBalance> {
    // Check if exists
    const existing = await this.getOpeningBalance(data.coldStorageId, data.year);
    if (existing) {
      // Update
      const [updated] = await db.update(cashOpeningBalances)
        .set({
          cashInHand: data.cashInHand,
          limitBalance: data.limitBalance,
          currentBalance: data.currentBalance,
          updatedAt: new Date(),
        })
        .where(eq(cashOpeningBalances.id, existing.id))
        .returning();
      return updated;
    } else {
      // Insert
      const [created] = await db.insert(cashOpeningBalances)
        .values({
          id: randomUUID(),
          ...data,
        })
        .returning();
      return created;
    }
  }

  // Opening Receivables
  async getOpeningReceivables(coldStorageId: string, year: number): Promise<OpeningReceivable[]> {
    return db.select()
      .from(openingReceivables)
      .where(
        and(
          eq(openingReceivables.coldStorageId, coldStorageId),
          eq(openingReceivables.year, year)
        )
      )
      .orderBy(desc(openingReceivables.createdAt));
  }

  async createOpeningReceivable(data: InsertOpeningReceivable): Promise<OpeningReceivable> {
    const [receivable] = await db.insert(openingReceivables)
      .values({
        id: randomUUID(),
        ...data,
      })
      .returning();
    return receivable;
  }

  async deleteOpeningReceivable(id: string): Promise<OpeningReceivable | undefined> {
    // Get the receivable first before deleting (for FIFO recomputation trigger)
    const [receivable] = await db.select()
      .from(openingReceivables)
      .where(eq(openingReceivables.id, id));
    
    if (!receivable) return undefined;
    
    await db.delete(openingReceivables)
      .where(eq(openingReceivables.id, id));
    
    return receivable;
  }

  // Opening Payables
  async getOpeningPayables(coldStorageId: string, year: number): Promise<OpeningPayable[]> {
    return db.select()
      .from(openingPayables)
      .where(
        and(
          eq(openingPayables.coldStorageId, coldStorageId),
          eq(openingPayables.year, year)
        )
      )
      .orderBy(desc(openingPayables.createdAt));
  }

  async createOpeningPayable(data: InsertOpeningPayable): Promise<OpeningPayable> {
    const [payable] = await db.insert(openingPayables)
      .values({
        id: randomUUID(),
        ...data,
      })
      .returning();
    return payable;
  }

  async deleteOpeningPayable(id: string): Promise<boolean> {
    const result = await db.delete(openingPayables)
      .where(eq(openingPayables.id, id));
    return true;
  }

  // Discounts - Get farmers with outstanding dues
  async getFarmersWithDues(coldStorageId: string): Promise<{ farmerName: string; village: string; contactNumber: string; totalDue: number }[]> {
    const result = await db.execute(sql`
      SELECT 
        farmer_name as "farmerName",
        village,
        contact_number as "contactNumber",
        COALESCE(SUM(due_amount), 0)::float as "totalDue"
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND due_amount > 0
      GROUP BY farmer_name, village, contact_number
      HAVING SUM(due_amount) > 0
      ORDER BY farmer_name
    `);
    return result.rows as { farmerName: string; village: string; contactNumber: string; totalDue: number }[];
  }

  // Get buyer dues for a specific farmer (sorted by latest sale date)
  async getBuyerDuesForFarmer(coldStorageId: string, farmerName: string, village: string, contactNumber: string): Promise<{ buyerName: string; totalDue: number; latestSaleDate: Date }[]> {
    const result = await db.execute(sql`
      SELECT 
        COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) as "buyerName",
        COALESCE(SUM(due_amount), 0)::float as "totalDue",
        MAX(sold_at) as "latestSaleDate"
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND farmer_name = ${farmerName}
        AND village = ${village}
        AND contact_number = ${contactNumber}
        AND due_amount > 0
        AND COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) IS NOT NULL
      GROUP BY COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name)
      HAVING SUM(due_amount) > 0
      ORDER BY MAX(sold_at) DESC
    `);
    return result.rows as { buyerName: string; totalDue: number; latestSaleDate: Date }[];
  }

  // Create discount with FIFO allocation to reduce sales dues
  async createDiscountWithFIFO(data: InsertDiscount): Promise<{ discount: Discount; salesUpdated: number }> {
    // Generate transaction ID unique per cold store
    const transactionId = await generateSequentialId('cash_flow', data.coldStorageId);
    const discountId = randomUUID();
    
    // Parse buyer allocations
    const allocations: { buyerName: string; amount: number }[] = JSON.parse(data.buyerAllocations);
    
    let totalSalesUpdated = 0;
    
    // Apply FIFO discount for each buyer allocation
    for (const allocation of allocations) {
      let remainingAmount = allocation.amount;
      const buyerName = allocation.buyerName;
      
      // Get sales for this farmer from this buyer, ordered by oldest first (FIFO)
      const salesResult = await db.execute(sql`
        SELECT id, due_amount
        FROM sales_history
        WHERE cold_storage_id = ${data.coldStorageId}
          AND farmer_name = ${data.farmerName}
          AND village = ${data.village}
          AND contact_number = ${data.contactNumber}
          AND COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) = ${buyerName}
          AND due_amount > 0
        ORDER BY sold_at ASC
      `);
      
      for (const row of salesResult.rows as { id: string; due_amount: number }[]) {
        if (remainingAmount <= 0) break;
        
        const saleId = row.id;
        const currentDue = row.due_amount;
        const discountToApply = Math.min(remainingAmount, currentDue);
        
        // Update the sale's due and paid amounts, and track discount allocation
        await db.execute(sql`
          UPDATE sales_history
          SET 
            due_amount = due_amount - ${discountToApply},
            paid_amount = paid_amount + ${discountToApply},
            discount_allocated = COALESCE(discount_allocated, 0) + ${discountToApply},
            payment_status = CASE 
              WHEN due_amount - ${discountToApply} <= 0 THEN 'paid'
              ELSE 'partial'
            END
          WHERE id = ${saleId}
        `);
        
        remainingAmount -= discountToApply;
        totalSalesUpdated++;
      }
    }
    
    // Calculate remaining farmer dues after discount
    const remainingDuesResult = await db.execute(sql`
      SELECT COALESCE(SUM(due_amount), 0) as total_due
      FROM sales_history
      WHERE cold_storage_id = ${data.coldStorageId}
        AND farmer_name = ${data.farmerName}
        AND village = ${data.village}
        AND contact_number = ${data.contactNumber}
        AND due_amount > 0
    `);
    const dueBalanceAfter = (remainingDuesResult.rows[0] as any)?.total_due || 0;

    // Insert the discount record
    const [discount] = await db.insert(discounts)
      .values({
        id: discountId,
        transactionId,
        ...data,
        dueBalanceAfter: dueBalanceAfter,
      })
      .returning();
    
    return { discount, salesUpdated: totalSalesUpdated };
  }

  // Get all discounts for a cold storage
  async getDiscounts(coldStorageId: string): Promise<Discount[]> {
    return db.select()
      .from(discounts)
      .where(eq(discounts.coldStorageId, coldStorageId))
      .orderBy(desc(discounts.createdAt));
  }

  // Reverse a discount (add back dues to sales and recompute FIFO for affected buyers)
  async reverseDiscount(discountId: string): Promise<{ success: boolean; message?: string }> {
    const [discount] = await db.select()
      .from(discounts)
      .where(eq(discounts.id, discountId));
    
    if (!discount) {
      return { success: false, message: "Discount not found" };
    }
    
    if (discount.isReversed === 1) {
      return { success: false, message: "Discount already reversed" };
    }
    
    // Mark discount as reversed first
    await db.update(discounts)
      .set({
        isReversed: 1,
        reversedAt: new Date(),
      })
      .where(eq(discounts.id, discountId));
    
    // Parse buyer allocations to get list of affected buyers
    const allocations: { buyerName: string; amount: number }[] = JSON.parse(discount.buyerAllocations);
    
    // Collect unique buyer names (normalized for case-insensitivity)
    const affectedBuyers = new Set<string>();
    for (const allocation of allocations) {
      affectedBuyers.add(allocation.buyerName.trim());
    }
    
    // Trigger FIFO recomputation for each affected buyer
    // This properly replays both receipts AND remaining discounts in chronological order
    for (const buyerName of Array.from(affectedBuyers)) {
      await this.recomputeBuyerPayments(buyerName, discount.coldStorageId);
    }
    
    return { success: true };
  }

  // Get total discount allocated for a specific farmer+buyer combination
  async getDiscountForFarmerBuyer(
    coldStorageId: string, 
    farmerName: string, 
    village: string, 
    contactNumber: string, 
    buyerName: string
  ): Promise<number> {
    // Get all active (non-reversed) discounts for this farmer
    const discountRows = await db.select()
      .from(discounts)
      .where(and(
        eq(discounts.coldStorageId, coldStorageId),
        eq(discounts.farmerName, farmerName),
        eq(discounts.village, village),
        eq(discounts.contactNumber, contactNumber),
        eq(discounts.isReversed, 0)
      ));
    
    let totalDiscountForBuyer = 0;
    const normalizedBuyer = buyerName.trim().toLowerCase();
    
    for (const discount of discountRows) {
      try {
        const allocations: { buyerName: string; amount: number }[] = JSON.parse(discount.buyerAllocations);
        for (const allocation of allocations) {
          // Match buyer name (case-insensitive)
          if (allocation.buyerName.trim().toLowerCase() === normalizedBuyer) {
            totalDiscountForBuyer += allocation.amount;
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }
    
    return totalDiscountForBuyer;
  }
}

export const storage = new DatabaseStorage();
