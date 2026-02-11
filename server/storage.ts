import { randomUUID } from "crypto";
import { eq, and, or, like, ilike, desc, sql, gte, lte, inArray, isNull, type SQL } from "drizzle-orm";
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
  farmerToBuyerTransfers,
  bankAccounts,
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
  type FarmerToBuyerTransfer,
  type BankAccount,
  type InsertBankAccount,
  farmerAdvanceFreight,
  type FarmerAdvanceFreight,
  type InsertFarmerAdvanceFreight,
  farmerLedger,
  farmerLedgerEditHistory,
  type FarmerLedgerEntry,
  type InsertFarmerLedger,
  type FarmerLedgerEditHistoryEntry,
  type InsertFarmerLedgerEditHistory,
  buyerLedger,
  buyerLedgerEditHistory,
  type BuyerLedgerEntry,
  type InsertBuyerLedger,
  type BuyerLedgerEditHistoryEntry,
  type InsertBuyerLedgerEditHistory,
  type DashboardStats,
  type QualityStats,
  type PaymentStats,
  type MerchantStats,
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
  getDashboardStats(coldStorageId: string, year?: number): Promise<DashboardStats>;
  getQualityStats(coldStorageId: string, year?: number): Promise<QualityStats>;
  getPaymentStats(coldStorageId: string, year?: number): Promise<PaymentStats>;
  getMerchantStats(coldStorageId: string, year?: number): Promise<MerchantStats>;
  getAnalyticsYears(coldStorageId: string): Promise<number[]>;
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
    transferAmount?: number;
    paymentStatus?: string;
    paidAmount?: number;
    dueAmount?: number;
  }): Promise<SalesHistory | undefined>;
  reverseBuyerToBuyerTransfer(saleId: string): Promise<{ success: boolean; message?: string; fromBuyer?: string; toBuyer?: string; coldStorageId?: string }>;
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
  getFarmerReceivablesWithDues(coldStorageId: string, year: number): Promise<{ id: string; farmerName: string; contactNumber: string; village: string; totalDue: number }[]>;
  createFarmerReceivablePayment(data: { coldStorageId: string; farmerReceivableId: string; farmerDetails: { farmerName: string; contactNumber: string; village: string } | null; buyerName: string | null; receiptType: string; accountType: string | null; accountId: string | null; amount: number; receivedAt: Date; notes: string | null }): Promise<{ receipt: CashReceipt; salesUpdated: number }>;
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
  recomputeFarmerPayments(coldStorageId: string, buyerDisplayName: string | null): Promise<{ receivablesUpdated: number }>;
  recomputeFarmerPaymentsWithDiscounts(coldStorageId: string, farmerName: string, contactNumber: string, village: string): Promise<{ receivablesUpdated: number; selfSalesUpdated: number }>;
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
  getBuyerRecords(coldStorageId: string): Promise<{ buyerName: string; isSelfSale: boolean }[]>;
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
  getFarmersWithAllDues(coldStorageId: string): Promise<{ farmerName: string; village: string; contactNumber: string; totalDue: number; farmerLiableDue: number; buyerLiableDue: number }[]>;
  getBuyerDuesForFarmer(coldStorageId: string, farmerName: string, village: string, contactNumber: string): Promise<{ buyerName: string; totalDue: number; latestSaleDate: Date; isFarmerSelf?: boolean }[]>;
  createDiscountWithFIFO(data: InsertDiscount): Promise<{ discount: Discount; salesUpdated: number }>;
  getDiscounts(coldStorageId: string): Promise<Discount[]>;
  reverseDiscount(discountId: string): Promise<{ success: boolean; message?: string }>;
  getDiscountForFarmerBuyer(coldStorageId: string, farmerName: string, village: string, contactNumber: string, buyerName: string): Promise<number>;
  // Farmer to Buyer debt transfer - only transfers specific self-sale (not receivables)
  getFarmerToBuyerTransfers(coldStorageId: string): Promise<FarmerToBuyerTransfer[]>;
  createFarmerToBuyerTransfer(data: {
    coldStorageId: string;
    saleId: string;
    farmerName: string;
    village: string;
    contactNumber: string;
    toBuyerName: string;
    transferDate: Date;
    remarks?: string | null;
  }): Promise<{ success: boolean; selfSalesTransferred: number; transactionId: string }>;
  reverseFarmerToBuyerTransfer(transferId: string): Promise<{ success: boolean; message?: string }>;
  // Update farmer details in all salesHistory entries for a given lotId
  // Also updates buyerName if it matches the "self" pattern (farmer as buyer)
  updateSalesHistoryFarmerDetails(
    lotId: string, 
    updates: { farmerName?: string; village?: string; tehsil?: string; district?: string; state?: string; contactNumber?: string },
    oldFarmerDetails: { farmerName: string; village: string; contactNumber: string }
  ): Promise<number>;
  // Bank Accounts
  getBankAccounts(coldStorageId: string, year: number): Promise<BankAccount[]>;
  createBankAccount(data: InsertBankAccount): Promise<BankAccount>;
  updateBankAccount(id: string, updates: Partial<BankAccount>): Promise<BankAccount | undefined>;
  deleteBankAccount(id: string): Promise<boolean>;
  // Farmer Advance & Freight
  createFarmerAdvanceFreight(data: InsertFarmerAdvanceFreight): Promise<FarmerAdvanceFreight>;
  getFarmerAdvanceFreight(coldStorageId: string, farmerLedgerId?: string): Promise<FarmerAdvanceFreight[]>;
  accrueInterestForAll(coldStorageId: string): Promise<number>;
  // Farmer Ledger
  getFarmerLedger(coldStorageId: string, includeArchived?: boolean): Promise<{
    farmers: (FarmerLedgerEntry & {
      pyReceivables: number;
      selfDue: number;
      merchantDue: number;
      advanceDue: number;
      freightDue: number;
      totalDue: number;
    })[];
    summary: {
      totalFarmers: number;
      pyReceivables: number;
      selfDue: number;
      merchantDue: number;
      advanceDue: number;
      freightDue: number;
      totalDue: number;
    };
  }>;
  syncFarmersFromTouchpoints(coldStorageId: string): Promise<{ added: number; updated: number; lotsLinked: number; receivablesLinked: number }>;
  generateFarmerId(coldStorageId: string): Promise<string>;
  checkPotentialMerge(id: string, updates: Partial<FarmerLedgerEntry>): Promise<{
    willMerge: boolean;
    targetFarmer?: FarmerLedgerEntry;
    lotsCount: number;
    receivablesCount: number;
    salesCount: number;
    totalDues: number;
  }>;
  updateFarmerLedger(id: string, updates: Partial<FarmerLedgerEntry>, modifiedBy: string, confirmMerge?: boolean): Promise<{ farmer: FarmerLedgerEntry | undefined; merged: boolean; mergedFromId?: string; needsConfirmation?: boolean }>;
  archiveFarmerLedger(id: string, modifiedBy: string): Promise<boolean>;
  reinstateFarmerLedger(id: string, modifiedBy: string): Promise<boolean>;
  toggleFarmerFlag(id: string, modifiedBy: string): Promise<FarmerLedgerEntry | undefined>;
  getFarmerLedgerEditHistory(farmerLedgerId: string): Promise<FarmerLedgerEditHistoryEntry[]>;
  ensureFarmerLedgerEntry(coldStorageId: string, farmerData: {
    name: string;
    contactNumber: string;
    village: string;
    tehsil?: string;
    district?: string;
    state?: string;
  }): Promise<{ id: string; farmerId: string }>;
  // Buyer Ledger
  getBuyerLedger(coldStorageId: string, includeArchived?: boolean): Promise<{
    buyers: (BuyerLedgerEntry & {
      pyReceivables: number;
      dueTransferOut: number;
      dueTransferIn: number;
      salesDue: number;
      buyerExtras: number;
      netDue: number;
    })[];
    summary: {
      totalBuyers: number;
      pyReceivables: number;
      dueTransferOut: number;
      dueTransferIn: number;
      salesDue: number;
      buyerExtras: number;
      netDue: number;
    };
  }>;
  syncBuyersFromTouchpoints(coldStorageId: string): Promise<{ added: number; updated: number }>;
  generateBuyerId(coldStorageId: string): Promise<string>;
  checkBuyerPotentialMerge(id: string, updates: Partial<BuyerLedgerEntry>): Promise<{
    willMerge: boolean;
    targetBuyer?: BuyerLedgerEntry;
    salesCount: number;
    transfersCount: number;
    totalDues: number;
  }>;
  updateBuyerLedger(id: string, updates: Partial<BuyerLedgerEntry>, modifiedBy: string, confirmMerge?: boolean): Promise<{ buyer: BuyerLedgerEntry | undefined; merged: boolean; mergedFromId?: string; needsConfirmation?: boolean }>;
  archiveBuyerLedger(id: string, modifiedBy: string): Promise<boolean>;
  reinstateBuyerLedger(id: string, modifiedBy: string): Promise<boolean>;
  toggleBuyerFlag(id: string, modifiedBy: string): Promise<BuyerLedgerEntry | undefined>;
  getBuyerLedgerEditHistory(buyerLedgerId: string): Promise<BuyerLedgerEditHistoryEntry[]>;
  ensureBuyerLedgerEntry(coldStorageId: string, buyerData: {
    buyerName: string;
    address?: string;
    contactNumber?: string;
  }): Promise<{ id: string; buyerId: string }>;
}

/**
 * Global utility function to round amounts to 1 decimal place.
 * This prevents floating-point precision issues across all financial calculations.
 * @param amount The amount to round
 * @returns Amount rounded to 1 decimal place
 */
export function roundAmount(amount: number): number {
  return Math.round(amount * 10) / 10;
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
    // Lot numbers reset to 1 at the start of each calendar year
    // Separate counters: Wafer has its own sequence, Ration/Seed share another
    const isWaferCategory = bagTypeCategory === "wafer";
    const currentYear = new Date().getFullYear();
    const yearStart = new Date(currentYear, 0, 1); // Jan 1 of current year
    
    // Find max lot number from lots created in the current year for this bag type category
    const allLots = await this.getAllLots(coldStorageId);
    let maxLotNo = 0;
    allLots.forEach((lot) => {
      const lotIsWafer = lot.bagType === "wafer";
      if (lotIsWafer === isWaferCategory) {
        // Only consider lots from current year
        const lotYear = lot.createdAt ? new Date(lot.createdAt).getFullYear() : currentYear;
        if (lotYear === currentYear) {
          const num = parseInt(lot.lotNo, 10);
          if (!isNaN(num) && num > maxLotNo) {
            maxLotNo = num;
          }
        }
      }
    });
    
    // Next sequence is max + 1, or 1 if no lots exist for current year
    const entrySequence = maxLotNo + 1;
    
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

  async getDashboardStats(coldStorageId: string, year?: number): Promise<DashboardStats> {
    const coldStorage = await this.getColdStorage(coldStorageId);
    const allChambers = await this.getChambers(coldStorageId);
    let allLots = await this.getAllLots(coldStorageId);
    
    // Filter lots by year if specified (based on createdAt)
    if (year) {
      allLots = allLots.filter(lot => {
        if (!lot.createdAt) return false;
        const lotYear = new Date(lot.createdAt).getFullYear();
        return lotYear === year;
      });
    }

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
    
    // Calculate Total Receivable Due from Farmer and Buyer ledgers
    // This sums PY Receivables (opening receivables) that are still due
    let totalReceivableDue = 0;
    
    // Get Farmer Ledger receivable dues
    const farmerLedgerData = await this.getFarmerLedger(coldStorageId);
    for (const farmer of farmerLedgerData.farmers) {
      totalReceivableDue += farmer.pyReceivables || 0;
    }
    
    // Get Buyer Ledger receivable dues
    const buyerLedgerData = await this.getBuyerLedger(coldStorageId);
    for (const buyer of buyerLedgerData.buyers) {
      totalReceivableDue += buyer.pyReceivables || 0;
    }

    return {
      totalPaid,
      totalDue,
      paidCount,
      dueCount,
      // Gross totals (for Analytics display)
      totalHammali,
      totalGradingCharges,
      // Net amounts after expenses (for Cash Management expense dropdowns)
      hammaliDue,
      gradingDue,
      // Receivable dues from Farmer and Buyer ledgers
      totalReceivableDue,
    };
  }

  async getMerchantStats(coldStorageId: string, year?: number): Promise<MerchantStats> {
    const allSalesRaw = await this.getSalesHistory(coldStorageId, year ? { year } : undefined);
    // Filter out self-sales - farmer names from self-sales should not appear in merchant analysis
    const allSales = allSalesRaw.filter(s => s.isSelfSale !== 1);
    
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
      
      // Use dueAmount directly - this is the authoritative remaining due amount
      // Previously we calculated totalCharges - salePaid which gave wrong values
      // dueAmount is kept up-to-date by FIFO recomputation after payments
      const salePaid = sale.paidAmount || 0;
      const saleDue = sale.dueAmount || 0;
      existing.totalChargePaid += salePaid;
      existing.totalChargeDue += saleDue;
      
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
    
    // Add F2B transfer amounts to buyer dues
    // F2B transfers move farmer liability to buyers, so add transferred amounts to buyer's totalChargeDue
    const f2bTransfers = await this.getFarmerToBuyerTransfers(coldStorageId);
    for (const transfer of f2bTransfers) {
      // Skip reversed transfers
      if (transfer.isReversed === 1) continue;
      
      // Apply year filter if provided
      if (year) {
        const transferYear = new Date(transfer.transferDate).getFullYear();
        if (transferYear !== year) continue;
      }
      
      const buyerName = transfer.toBuyerName?.trim() || "Unknown";
      const normalizedKey = buyerName.toLowerCase();
      const transferAmount = roundAmount(transfer.totalAmount || 0);
      
      const existing = merchantMap.get(normalizedKey);
      if (existing) {
        existing.totalChargeDue += transferAmount;
      } else {
        // Buyer doesn't exist from sales - create new entry for F2B transfer
        merchantMap.set(normalizedKey, {
          displayName: buyerName,
          bagsPurchased: 0,
          totalValue: 0,
          totalChargePaid: 0,
          totalChargeDue: transferAmount,
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
    const totalChargeWithExtras = saleCharge + kata + extraHammaliTotal + grading;

    // Calculate paid/due amounts based on payment status (include all charges)
    let salePaidAmount = 0;
    let saleDueAmount = 0;
    if (paymentStatus === "paid") {
      salePaidAmount = totalChargeWithExtras;
    } else if (paymentStatus === "due") {
      saleDueAmount = totalChargeWithExtras;
    } else if (paymentStatus === "partial") {
      const rawPaid = Math.max(0, paidAmount || 0);
      salePaidAmount = roundAmount(Math.min(rawPaid, totalChargeWithExtras));
      saleDueAmount = roundAmount(totalChargeWithExtras - salePaidAmount);
    }

    const bagsToRemove = lot.remainingSize;
    const [updatedLot] = await db.update(lots).set({
      saleStatus: "sold",
      paymentStatus,
      saleCharge,
      soldAt: new Date(),
      upForSale: 0,
      remainingSize: 0,
      totalPaidCharge: roundAmount((lot.totalPaidCharge || 0) + salePaidAmount),
      totalDueCharge: roundAmount((lot.totalDueCharge || 0) + saleDueAmount),
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
    
    // Ensure buyer exists in buyer ledger and get IDs (if buyer name is provided)
    let buyerEntry: { id: string; buyerId: string } | null = null;
    if (buyerName && buyerName.trim()) {
      buyerEntry = await this.ensureBuyerLedgerEntry(lot.coldStorageId, { buyerName: buyerName.trim() });
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
      // Farmer ledger reference (copy from lot)
      farmerLedgerId: lot.farmerLedgerId || null,
      farmerId: lot.farmerId || null,
      // Buyer ledger reference
      buyerLedgerId: buyerEntry?.id || null,
      buyerId: buyerEntry?.buyerId || null,
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
      // Search by CurrentDueBuyerName: use original buyer if transfer is reversed
      // This filters by the effective buyer - transferToBuyerName if available and not reversed, else buyerName
      conditions.push(
        sql`CASE WHEN ${salesHistory.isTransferReversed} = 1 THEN ${salesHistory.buyerName} ELSE COALESCE(NULLIF(${salesHistory.transferToBuyerName}, ''), ${salesHistory.buyerName}) END ILIKE ${`%${filters.buyerName}%`}`
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
    transferAmount?: number;
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
      // Clear reversal flags when making a new transfer (in case this was previously reversed)
      isTransferReversed: 0,
      transferReversedAt: null,
    };
    
    // Add CF transaction ID for buyer-to-buyer transfers
    if (updates.transferTransactionId) {
      updateData.transferTransactionId = updates.transferTransactionId;
    }
    
    // Store the original transfer amount (preserved for display even after FIFO payments)
    if (updates.transferAmount !== undefined) {
      updateData.transferAmount = updates.transferAmount;
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

  async reverseBuyerToBuyerTransfer(saleId: string): Promise<{ success: boolean; message?: string; fromBuyer?: string; toBuyer?: string; coldStorageId?: string }> {
    // Get the sale record
    const [sale] = await db.select()
      .from(salesHistory)
      .where(eq(salesHistory.id, saleId));
    
    if (!sale) {
      return { success: false, message: "Sale record not found" };
    }
    
    // Check if this sale has a buyer-to-buyer transfer
    if (!sale.transferToBuyerName || sale.clearanceType !== 'transfer') {
      return { success: false, message: "This sale does not have a buyer-to-buyer transfer to reverse" };
    }
    
    // Check if transfer is already reversed
    if (sale.isTransferReversed === 1) {
      return { success: false, message: "This buyer-to-buyer transfer has already been reversed" };
    }
    
    const fromBuyer = sale.buyerName || "";
    const toBuyer = sale.transferToBuyerName;
    const coldStorageId = sale.coldStorageId;
    
    // Mark transfer as reversed (keep fields for history display, just mark as reversed)
    await db.update(salesHistory)
      .set({
        isTransferReversed: 1,
        transferReversedAt: new Date(),
      })
      .where(eq(salesHistory.id, saleId));
    
    // Recompute FIFO for both buyers (from original buyer and to transferred buyer)
    if (fromBuyer && coldStorageId) {
      await this.recomputeBuyerPayments(fromBuyer, coldStorageId);
    }
    if (toBuyer && coldStorageId) {
      await this.recomputeBuyerPayments(toBuyer, coldStorageId);
    }
    
    return { success: true, message: "Buyer-to-buyer transfer reversed successfully", fromBuyer, toBuyer, coldStorageId };
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
    // Use Buyer Ledger's netDue for consistent dues across the application
    // netDue = pyReceivables + salesDue + dueTransferIn - dueTransferOut
    // Only include buyers with positive net due (actual dues to collect)
    const ledgerData = await this.getBuyerLedger(coldStorageId, false);
    
    return ledgerData.buyers
      .filter(buyer => buyer.netDue > 0) // Only include buyers with positive dues
      .map(buyer => ({
        buyerName: buyer.buyerName,
        totalDue: buyer.netDue
      }))
      .sort((a, b) => a.buyerName.toLowerCase().localeCompare(b.buyerName.toLowerCase()));
  }

  async getFarmerReceivablesWithDues(coldStorageId: string, year: number): Promise<{ id: string; farmerName: string; contactNumber: string; village: string; totalDue: number }[]> {
    // Get farmer receivables with outstanding dues for the specified year
    const farmers = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.year, year),
        eq(openingReceivables.payerType, "farmer")
      ));

    // Also get farmer dues from self sales (where farmer is the buyer)
    // EXCLUDE self-sales that have been transferred to a buyer (transfer_to_buyer_name is set)
    // because those debts now belong to the buyer, not the farmer
    // Uses TRIM for space-trimmed grouping, aggregation handles case differences via JavaScript
    const selfSalesResult = await db.execute(sql`
      SELECT 
        TRIM(farmer_name) as farmer_name,
        TRIM(contact_number) as contact_number,
        TRIM(village) as village,
        COALESCE(SUM(COALESCE(due_amount, 0) + COALESCE(extra_due_to_merchant, 0)), 0)::float as total_due
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND is_self_sale = 1
        AND sale_year = ${year}
        AND (due_amount > 0 OR extra_due_to_merchant > 0)
        AND (transfer_to_buyer_name IS NULL OR transfer_to_buyer_name = '')
      GROUP BY TRIM(farmer_name), TRIM(village), TRIM(contact_number)
      HAVING SUM(COALESCE(due_amount, 0) + COALESCE(extra_due_to_merchant, 0)) >= 1
    `);
    const selfSales = selfSalesResult.rows as { farmer_name: string; contact_number: string; village: string; total_due: number }[];

    // Map to track farmer dues by unique key (farmerName + contactNumber + village)
    // Uses LOWER/TRIM for case-insensitive, space-trimmed matching
    const farmerDuesMap = new Map<string, { id: string; farmerName: string; contactNumber: string; village: string; totalDue: number }>();

    // Add receivables from openingReceivables
    for (const f of farmers) {
      if (!f.farmerName || !f.contactNumber || !f.village) continue;
      const remainingDue = f.dueAmount - (f.paidAmount || 0);
      if (remainingDue < 1) continue;
      
      // Normalize key with trim and lowercase for consistent matching
      const key = `${f.farmerName.trim().toLowerCase()}_${f.contactNumber.trim()}_${f.village.trim().toLowerCase()}`;
      const existing = farmerDuesMap.get(key);
      if (existing) {
        existing.totalDue += remainingDue;
      } else {
        farmerDuesMap.set(key, {
          id: f.id,
          farmerName: f.farmerName.trim(),
          contactNumber: f.contactNumber.trim(),
          village: f.village.trim(),
          totalDue: remainingDue
        });
      }
    }

    // Add dues from self sales (already trimmed by SQL query)
    for (const sale of selfSales) {
      if (!sale.farmer_name || !sale.contact_number || !sale.village) continue;
      // Normalize key with trim and lowercase for consistent matching
      const key = `${sale.farmer_name.trim().toLowerCase()}_${sale.contact_number.trim()}_${sale.village.trim().toLowerCase()}`;
      const existing = farmerDuesMap.get(key);
      if (existing) {
        existing.totalDue += sale.total_due;
      } else {
        // Generate a synthetic id for self-sale farmers (they have no receivable entry)
        farmerDuesMap.set(key, {
          id: `self_sale_${sale.farmer_name.trim()}_${sale.contact_number.trim()}_${sale.village.trim()}`,
          farmerName: sale.farmer_name.trim(),
          contactNumber: sale.contact_number.trim(),
          village: sale.village.trim(),
          totalDue: sale.total_due
        });
      }
    }

    return Array.from(farmerDuesMap.values())
      .filter(f => f.totalDue >= 1)
      .sort((a, b) => a.farmerName.toLowerCase().localeCompare(b.farmerName.toLowerCase()));
  }

  async createFarmerReceivablePayment(data: { coldStorageId: string; farmerReceivableId: string; farmerDetails: { farmerName: string; contactNumber: string; village: string } | null; buyerName: string | null; receiptType: string; accountType: string | null; accountId: string | null; amount: number; receivedAt: Date; notes: string | null }): Promise<{ receipt: CashReceipt; salesUpdated: number }> {
    // Farmer details are required (from Farmer Ledger dropdown)
    if (!data.farmerDetails) {
      throw new Error("Farmer details are required for farmer payments");
    }
    
    const farmerIdentity = {
      farmerName: data.farmerDetails.farmerName,
      contactNumber: data.farmerDetails.contactNumber,
      village: data.farmerDetails.village,
    };
    
    let totalDueBefore = 0;
    
    // Get ALL farmer receivables for this farmer (FIFO by createdAt)
    const allFarmerReceivables = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, data.coldStorageId),
        sql`LOWER(TRIM(${openingReceivables.payerType})) = 'farmer'`,
        sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerIdentity.farmerName}))`,
        sql`TRIM(${openingReceivables.contactNumber}) = TRIM(${farmerIdentity.contactNumber})`,
        sql`LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${farmerIdentity.village}))`
      ))
      .orderBy(openingReceivables.createdAt);
    
    // Calculate total due from receivables
    for (const receivable of allFarmerReceivables) {
      const remainingDue = receivable.dueAmount - (receivable.paidAmount || 0);
      if (remainingDue > 0) {
        totalDueBefore += remainingDue;
      }
    }
    
    // Look up farmer ledger entry for advance/freight queries
    const [farmerLedgerEntry] = await db.select()
      .from(farmerLedger)
      .where(and(
        eq(farmerLedger.coldStorageId, data.coldStorageId),
        sql`LOWER(TRIM(${farmerLedger.name})) = LOWER(TRIM(${farmerIdentity.farmerName}))`,
        sql`TRIM(${farmerLedger.contactNumber}) = TRIM(${farmerIdentity.contactNumber})`,
        sql`LOWER(TRIM(${farmerLedger.village})) = LOWER(TRIM(${farmerIdentity.village}))`
      ))
      .limit(1);
    
    // Get advance/freight dues for totalDueBefore
    if (farmerLedgerEntry) {
      const advFreightRecords = await db.select()
        .from(farmerAdvanceFreight)
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, data.coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntry.id),
          eq(farmerAdvanceFreight.isReversed, 0)
        ));
      for (const record of advFreightRecords) {
        const remainingDue = (record.finalAmount || 0) - (record.paidAmount || 0);
        if (remainingDue > 0) {
          totalDueBefore += remainingDue;
        }
      }
    }
    
    // Get self-sales with dues for this farmer (EXCLUDE transferred unless reversed)
    const selfSalesResult = await db.execute(sql`
      SELECT id, due_amount, extra_due_to_merchant, paid_amount
      FROM sales_history
      WHERE cold_storage_id = ${data.coldStorageId}
        AND is_self_sale = 1
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerIdentity.farmerName}))
        AND TRIM(contact_number) = TRIM(${farmerIdentity.contactNumber})
        AND LOWER(TRIM(village)) = LOWER(TRIM(${farmerIdentity.village}))
        AND (due_amount > 0 OR extra_due_to_merchant > 0)
        AND (
          (transfer_to_buyer_name IS NULL OR transfer_to_buyer_name = '')
          OR is_transfer_reversed = 1
        )
      ORDER BY sold_at ASC
    `);
    const selfSalesWithDues = selfSalesResult.rows as { id: string; due_amount: number; extra_due_to_merchant: number; paid_amount: number }[];
    
    // Calculate total due from self-sales
    for (const sale of selfSalesWithDues) {
      totalDueBefore += (sale.due_amount || 0) + (sale.extra_due_to_merchant || 0);
    }
    
    // Validate: reject if no outstanding dues
    if (totalDueBefore <= 0) {
      throw new Error("No outstanding dues for this farmer");
    }
    
    // Validate: reject if payment exceeds total dues (no overpayment allowed)
    if (data.amount > totalDueBefore) {
      throw new Error(`Payment amount (₹${data.amount}) exceeds total outstanding dues (₹${totalDueBefore})`);
    }
    
    // Apply payment in FIFO order
    let remainingAmount = data.amount;
    let recordsUpdated = 0;
    let totalApplied = 0;
    
    // First apply to receivables (if any)
    for (const receivable of allFarmerReceivables) {
      if (remainingAmount <= 0) break;
      const remainingDue = roundAmount(receivable.dueAmount - (receivable.paidAmount || 0));
      if (remainingDue <= 0) continue;
      
      const amountToApply = Math.min(remainingAmount, remainingDue);
      
      if (amountToApply > 0) {
        await db.update(openingReceivables)
          .set({ paidAmount: roundAmount((receivable.paidAmount || 0) + amountToApply) })
          .where(and(
            eq(openingReceivables.id, receivable.id),
            eq(openingReceivables.coldStorageId, data.coldStorageId)
          ));
        
        remainingAmount = roundAmount(remainingAmount - amountToApply);
        totalApplied = roundAmount(totalApplied + amountToApply);
        recordsUpdated++;
      }
    }
    
    // Pass 2: Apply remaining to farmer FREIGHT records (FIFO by createdAt)
    if (remainingAmount > 0 && farmerLedgerEntry) {
      const freightRecords = await db.select()
        .from(farmerAdvanceFreight)
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, data.coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntry.id),
          eq(farmerAdvanceFreight.type, "freight"),
          eq(farmerAdvanceFreight.isReversed, 0)
        ))
        .orderBy(farmerAdvanceFreight.createdAt);
      
      for (const record of freightRecords) {
        if (remainingAmount <= 0) break;
        const remainingDue = roundAmount((record.finalAmount || 0) - (record.paidAmount || 0));
        if (remainingDue <= 0) continue;
        
        const amountToApply = Math.min(remainingAmount, remainingDue);
        if (amountToApply > 0) {
          await db.update(farmerAdvanceFreight)
            .set({ paidAmount: roundAmount((record.paidAmount || 0) + amountToApply) })
            .where(eq(farmerAdvanceFreight.id, record.id));
          
          remainingAmount = roundAmount(remainingAmount - amountToApply);
          totalApplied = roundAmount(totalApplied + amountToApply);
          recordsUpdated++;
        }
      }
    }
    
    // Pass 3: Apply remaining to farmer ADVANCE records (FIFO by createdAt)
    if (remainingAmount > 0 && farmerLedgerEntry) {
      const advanceRecords = await db.select()
        .from(farmerAdvanceFreight)
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, data.coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntry.id),
          eq(farmerAdvanceFreight.type, "advance"),
          eq(farmerAdvanceFreight.isReversed, 0)
        ))
        .orderBy(farmerAdvanceFreight.createdAt);
      
      for (const record of advanceRecords) {
        if (remainingAmount <= 0) break;
        const remainingDue = roundAmount((record.finalAmount || 0) - (record.paidAmount || 0));
        if (remainingDue <= 0) continue;
        
        const amountToApply = Math.min(remainingAmount, remainingDue);
        if (amountToApply > 0) {
          await db.update(farmerAdvanceFreight)
            .set({ paidAmount: roundAmount((record.paidAmount || 0) + amountToApply) })
            .where(eq(farmerAdvanceFreight.id, record.id));
          
          remainingAmount = roundAmount(remainingAmount - amountToApply);
          totalApplied = roundAmount(totalApplied + amountToApply);
          recordsUpdated++;
        }
      }
    }
    
    // Pass 4: Apply remaining to self-sales (FIFO by sold_at)
    for (const sale of selfSalesWithDues) {
      if (remainingAmount <= 0) break;
      
      const saleTotalDue = roundAmount((sale.due_amount || 0) + (sale.extra_due_to_merchant || 0));
      if (saleTotalDue <= 0) continue;
      
      const amountToApply = Math.min(remainingAmount, saleTotalDue);
      
      if (amountToApply > 0) {
        // Apply to due_amount first, then extra_due_to_merchant
        let toApply = amountToApply;
        const dueAmount = sale.due_amount || 0;
        const extraDue = sale.extra_due_to_merchant || 0;
        
        const applyToDue = Math.min(toApply, dueAmount);
        toApply = roundAmount(toApply - applyToDue);
        const applyToExtra = Math.min(toApply, extraDue);
        const newDueAmount = roundAmount(dueAmount - applyToDue);
        const newExtraDue = roundAmount(extraDue - applyToExtra);
        const newPaidAmount = roundAmount((sale.paid_amount || 0) + applyToDue);
        
        await db.execute(sql`
          UPDATE sales_history
          SET 
            due_amount = (${newDueAmount})::real,
            paid_amount = (${newPaidAmount})::real,
            extra_due_to_merchant = (${newExtraDue})::real,
            payment_status = CASE 
              WHEN (${newDueAmount})::real + (${newExtraDue})::real < 1.0 THEN 'paid'
              WHEN (${newPaidAmount})::real > 0 THEN 'partial'
              ELSE payment_status
            END
          WHERE id = ${sale.id}
        `);
        
        remainingAmount = roundAmount(remainingAmount - amountToApply);
        totalApplied = roundAmount(totalApplied + amountToApply);
        recordsUpdated++;
      }
    }
    
    // Calculate total due after payment
    const totalDueAfter = roundAmount(Math.max(0, totalDueBefore - totalApplied));
    
    // Generate transaction ID
    const transactionId = await generateSequentialId('cash_flow', data.coldStorageId);
    
    // Get farmer ledger IDs
    const farmerEntry = await this.ensureFarmerLedgerEntry(data.coldStorageId, {
      name: farmerIdentity.farmerName,
      contactNumber: farmerIdentity.contactNumber,
      village: farmerIdentity.village,
    });
    
    // Create the cash receipt with farmer payer type
    const buyerDisplayName = data.buyerName || `${farmerIdentity.farmerName} (${farmerIdentity.village})`;
    const [receipt] = await db.insert(cashReceipts)
      .values({
        id: randomUUID(),
        coldStorageId: data.coldStorageId,
        payerType: "farmer",
        buyerName: buyerDisplayName,
        receiptType: data.receiptType,
        accountType: data.accountType,
        accountId: data.accountId,
        amount: data.amount,
        receivedAt: data.receivedAt,
        notes: data.notes,
        transactionId,
        dueBalanceAfter: totalDueAfter,
        farmerLedgerId: farmerEntry.id,
        farmerId: farmerEntry.farmerId,
      })
      .returning();
    
    return { receipt, salesUpdated: recordsUpdated };
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

        const receivableDue = roundAmount((receivable.dueAmount || 0) - (receivable.paidAmount || 0));
        if (receivableDue <= 0) continue;

        if (remainingAmount >= receivableDue) {
          // Can fully pay this receivable
          await db.update(openingReceivables)
            .set({ paidAmount: receivable.dueAmount })
            .where(eq(openingReceivables.id, receivable.id));
          
          remainingAmount = roundAmount(remainingAmount - receivableDue);
          appliedAmount = roundAmount(appliedAmount + receivableDue);
        } else {
          // Can only partially pay this receivable
          const newPaidAmount = roundAmount((receivable.paidAmount || 0) + remainingAmount);
          await db.update(openingReceivables)
            .set({ paidAmount: newPaidAmount })
            .where(eq(openingReceivables.id, receivable.id));
          
          appliedAmount = roundAmount(appliedAmount + remainingAmount);
          remainingAmount = 0;
        }
      }
    }

    // PASS 1: Apply to cold storage dues (FIFO by soldAt)
    // Use CurrentDueBuyerName logic: match transferToBuyerName first, else buyerName
    // BUT if transfer is reversed (isTransferReversed = 1), use original buyerName
    const sales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, data.coldStorageId),
        sql`LOWER(TRIM(CASE WHEN ${salesHistory.isTransferReversed} = 1 THEN ${salesHistory.buyerName} ELSE COALESCE(NULLIF(${salesHistory.transferToBuyerName}, ''), ${salesHistory.buyerName}) END)) = LOWER(TRIM(${data.buyerName}))`,
        sql`${salesHistory.paymentStatus} IN ('due', 'partial')`
      ))
      .orderBy(salesHistory.soldAt); // FIFO - oldest first

    for (const sale of sales) {
      if (remainingAmount <= 0) break;

      // coldStorageCharge already includes base + kata + extraHammali + grading
      // Do NOT add them again to avoid double-counting
      const totalCharges = sale.coldStorageCharge || 0;
      const saleDueAmount = roundAmount(totalCharges - (sale.paidAmount || 0));
      
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
        
        remainingAmount = roundAmount(remainingAmount - saleDueAmount);
        appliedAmount = roundAmount(appliedAmount + saleDueAmount);
        salesUpdated++;
      } else {
        // Can only partially pay this sale
        const newPaidAmount = roundAmount((sale.paidAmount || 0) + remainingAmount);
        const newDueAmount = roundAmount(totalCharges - newPaidAmount);
        
        // If remaining due is less than ₹1, treat as fully paid (petty balance threshold)
        const paymentStatusToSet = newDueAmount < 1 ? "paid" : "partial";
        
        await db.update(salesHistory)
          .set({
            paymentStatus: paymentStatusToSet,
            paidAmount: newPaidAmount,
            dueAmount: newDueAmount,
            paymentMode: paymentMode,
          })
          .where(eq(salesHistory.id, sale.id));
        
        appliedAmount = roundAmount(appliedAmount + remainingAmount);
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
          
          remainingAmount = roundAmount(remainingAmount - extraDue);
          appliedAmount = roundAmount(appliedAmount + extraDue);
          salesUpdated++;
        } else {
          // Can only partially pay this extra due
          const newExtraDue = roundAmount(extraDue - remainingAmount);
          await db.update(salesHistory)
            .set({ extraDueToMerchant: newExtraDue })
            .where(eq(salesHistory.id, sale.id));
          
          appliedAmount = roundAmount(appliedAmount + remainingAmount);
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
    
    // Get buyer ledger IDs for cold_merchant payer type
    let buyerLedgerId: string | null = null;
    let buyerId: string | null = null;
    if (data.payerType === "cold_merchant" && data.buyerName) {
      const buyerEntry = await this.ensureBuyerLedgerEntry(data.coldStorageId, { buyerName: data.buyerName.trim() });
      buyerLedgerId = buyerEntry.id;
      buyerId = buyerEntry.buyerId;
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
        buyerLedgerId,
        buyerId,
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
    // BUT if transfer is reversed (is_transfer_reversed = 1), use original buyer_name
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
      AND LOWER(TRIM(CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END)) = ${normalizedBuyer}
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

    // Handle recomputation based on payer type
    if (receipt.payerType === "farmer" && receipt.coldStorageId && receipt.buyerName) {
      // For farmer payments, use recomputeFarmerPaymentsWithDiscounts to properly reset self-sales
      // Parse farmer identity from buyerDisplayName format: "FarmerName (Village)"
      const match = receipt.buyerName.match(/^(.+?)\s*\((.+?)\)$/);
      if (match) {
        const farmerName = match[1].trim();
        const village = match[2].trim();
        
        // Find contactNumber from farmer receivables or self-sales
        let contactNumber: string | null = null;
        
        // Try to get from receivables first
        const receivableResult = await db.select()
          .from(openingReceivables)
          .where(and(
            eq(openingReceivables.coldStorageId, receipt.coldStorageId),
            eq(openingReceivables.payerType, "farmer"),
            sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName}))`,
            sql`LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`
          ))
          .limit(1);
        
        if (receivableResult.length > 0) {
          contactNumber = receivableResult[0].contactNumber;
        } else {
          // Try from self-sales
          const selfSaleResult = await db.select()
            .from(salesHistory)
            .where(and(
              eq(salesHistory.coldStorageId, receipt.coldStorageId),
              eq(salesHistory.isSelfSale, 1),
              sql`LOWER(TRIM(${salesHistory.farmerName})) = LOWER(TRIM(${farmerName}))`,
              sql`LOWER(TRIM(${salesHistory.village})) = LOWER(TRIM(${village}))`
            ))
            .limit(1);
          
          if (selfSaleResult.length > 0) {
            contactNumber = selfSaleResult[0].contactNumber;
          }
        }
        
        if (contactNumber) {
          await this.recomputeFarmerPaymentsWithDiscounts(receipt.coldStorageId, farmerName, contactNumber, village);
        } else {
          // Fallback to old method if contactNumber not found
          await this.recomputeFarmerPayments(receipt.coldStorageId, receipt.buyerName);
        }
      } else {
        // buyerName doesn't match expected "FarmerName (Village)" format - use old method as fallback
        await this.recomputeFarmerPayments(receipt.coldStorageId, receipt.buyerName);
      }
    } else if (receipt.buyerName && receipt.coldStorageId) {
      // Use unified recomputeBuyerPayments to properly handle both receipts AND discounts
      // This replaces the old custom FIFO replay that only considered receipts
      await this.recomputeBuyerPayments(receipt.buyerName, receipt.coldStorageId);
    }

    return { success: true, message: "Receipt reversed and payments recalculated" };
  }

  async recomputeFarmerPayments(coldStorageId: string, buyerDisplayName: string | null): Promise<{ receivablesUpdated: number }> {
    // Parse farmer identity from buyerDisplayName format: "FarmerName (Village)"
    if (!buyerDisplayName) {
      return { receivablesUpdated: 0 };
    }
    
    // Extract farmerName and village from format "FarmerName (Village)"
    const match = buyerDisplayName.match(/^(.+?)\s*\((.+?)\)$/);
    if (!match) {
      return { receivablesUpdated: 0 };
    }
    
    const farmerName = match[1].trim();
    const village = match[2].trim();
    
    // Find farmer receivables matching name and village to get the contactNumber
    // This matches the criteria used in createFarmerReceivablePayment
    const farmerReceivables = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.payerType, "farmer"),
        sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName}))`,
        sql`LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`
      ))
      .orderBy(openingReceivables.createdAt);
    
    // Get the contactNumber - try from receivables first, then from self-sales
    let contactNumber: string | null = null;
    
    if (farmerReceivables.length > 0) {
      contactNumber = farmerReceivables[0].contactNumber;
    } else {
      // No receivables found - try to get contact number from self-sales
      const selfSalesForFarmer = await db.select()
        .from(salesHistory)
        .where(and(
          eq(salesHistory.coldStorageId, coldStorageId),
          eq(salesHistory.isSelfSale, 1),
          sql`LOWER(TRIM(${salesHistory.farmerName})) = LOWER(TRIM(${farmerName}))`,
          sql`LOWER(TRIM(${salesHistory.village})) = LOWER(TRIM(${village}))`
        ))
        .limit(1);
      
      if (selfSalesForFarmer.length > 0) {
        contactNumber = selfSalesForFarmer[0].contactNumber;
      }
    }
    
    // If we couldn't find a contact number from either source, nothing to recompute
    if (!contactNumber) {
      return { receivablesUpdated: 0 };
    }
    
    // Now get all receivables for this exact farmer (name + village + contactNumber)
    // Uses LOWER/TRIM for case-insensitive, space-trimmed matching on composite key
    const allFarmerReceivables = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${openingReceivables.payerType})) = 'farmer'`,
        sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName}))`,
        sql`TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber})`,
        sql`LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`
      ))
      .orderBy(openingReceivables.createdAt);
    
    // Look up farmer ledger entry to get farmerLedgerId for advance/freight queries
    const [farmerLedgerEntry] = await db.select()
      .from(farmerLedger)
      .where(and(
        eq(farmerLedger.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${farmerLedger.name})) = LOWER(TRIM(${farmerName}))`,
        sql`TRIM(${farmerLedger.contactNumber}) = TRIM(${contactNumber})`,
        sql`LOWER(TRIM(${farmerLedger.village})) = LOWER(TRIM(${village}))`
      ))
      .limit(1);
    
    // Step 1: Reset all farmer receivables paidAmount to 0
    for (const receivable of allFarmerReceivables) {
      await db.update(openingReceivables)
        .set({ paidAmount: 0 })
        .where(eq(openingReceivables.id, receivable.id));
    }
    
    // Step 1c: Reset all farmer advance/freight paidAmount to 0
    if (farmerLedgerEntry) {
      await db.update(farmerAdvanceFreight)
        .set({ paidAmount: 0 })
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntry.id),
          eq(farmerAdvanceFreight.isReversed, 0)
        ));
    }
    
    // Step 1b: Reset all self-sales for this farmer to original due amounts
    // Reset due_amount to cold_storage_charge (the original billed amount)
    // Reset extra_due_to_merchant to extra_due_to_merchant_original (original value set at creation)
    await db.execute(sql`
      UPDATE sales_history
      SET 
        paid_amount = 0,
        due_amount = cold_storage_charge,
        extra_due_to_merchant = COALESCE(extra_due_to_merchant_original, 0),
        payment_status = CASE 
          WHEN cold_storage_charge + COALESCE(extra_due_to_merchant_original, 0) < 1 THEN 'paid'
          ELSE 'due'
        END
      WHERE cold_storage_id = ${coldStorageId}
        AND is_self_sale = 1
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
        AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
        AND contact_number = ${contactNumber}
    `);
    
    // Step 2: Get all non-reversed farmer receipts for this farmer
    // Match by buyerName pattern "FarmerName (Village)"
    const activeReceipts = await db.select()
      .from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.payerType, "farmer"),
        eq(cashReceipts.isReversed, 0),
        sql`LOWER(TRIM(${cashReceipts.buyerName})) = LOWER(TRIM(${buyerDisplayName}))`
      ))
      .orderBy(cashReceipts.receivedAt);
    
    // Step 3: Replay all active receipts in FIFO order
    let receivablesUpdated = 0;
    
    for (const receipt of activeReceipts) {
      let remainingAmount = receipt.amount;
      
      // Re-fetch current state of receivables
      // Uses LOWER/TRIM for case-insensitive, space-trimmed matching on composite key
      const currentReceivables = await db.select()
        .from(openingReceivables)
        .where(and(
          eq(openingReceivables.coldStorageId, coldStorageId),
          sql`LOWER(TRIM(${openingReceivables.payerType})) = 'farmer'`,
          sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName}))`,
          sql`TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber})`,
          sql`LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`
        ))
        .orderBy(openingReceivables.createdAt);
      
      for (const receivable of currentReceivables) {
        const remainingDue = roundAmount(receivable.dueAmount - (receivable.paidAmount || 0));
        if (remainingDue <= 0) continue;
        
        const amountToApply = Math.min(remainingAmount, remainingDue);
        
        if (amountToApply > 0) {
          await db.update(openingReceivables)
            .set({ paidAmount: roundAmount((receivable.paidAmount || 0) + amountToApply) })
            .where(eq(openingReceivables.id, receivable.id));
          
          remainingAmount = roundAmount(remainingAmount - amountToApply);
          receivablesUpdated++;
        }
        
        if (remainingAmount <= 0) break;
      }
      
      // Pass 2: Apply remaining to farmer FREIGHT records (FIFO by createdAt)
      if (remainingAmount > 0 && farmerLedgerEntry) {
        const freightRecords = await db.select()
          .from(farmerAdvanceFreight)
          .where(and(
            eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
            eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntry.id),
            eq(farmerAdvanceFreight.type, "freight"),
            eq(farmerAdvanceFreight.isReversed, 0)
          ))
          .orderBy(farmerAdvanceFreight.createdAt);
        
        for (const record of freightRecords) {
          if (remainingAmount <= 0) break;
          const remainingDue = roundAmount(record.finalAmount - (record.paidAmount || 0));
          if (remainingDue <= 0) continue;
          
          const amountToApply = Math.min(remainingAmount, remainingDue);
          if (amountToApply > 0) {
            await db.update(farmerAdvanceFreight)
              .set({ paidAmount: roundAmount((record.paidAmount || 0) + amountToApply) })
              .where(eq(farmerAdvanceFreight.id, record.id));
            
            remainingAmount = roundAmount(remainingAmount - amountToApply);
            receivablesUpdated++;
          }
        }
      }
      
      // Pass 3: Apply remaining to farmer ADVANCE records (FIFO by createdAt)
      if (remainingAmount > 0 && farmerLedgerEntry) {
        const advanceRecords = await db.select()
          .from(farmerAdvanceFreight)
          .where(and(
            eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
            eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntry.id),
            eq(farmerAdvanceFreight.type, "advance"),
            eq(farmerAdvanceFreight.isReversed, 0)
          ))
          .orderBy(farmerAdvanceFreight.createdAt);
        
        for (const record of advanceRecords) {
          if (remainingAmount <= 0) break;
          const remainingDue = roundAmount(record.finalAmount - (record.paidAmount || 0));
          if (remainingDue <= 0) continue;
          
          const amountToApply = Math.min(remainingAmount, remainingDue);
          if (amountToApply > 0) {
            await db.update(farmerAdvanceFreight)
              .set({ paidAmount: roundAmount((record.paidAmount || 0) + amountToApply) })
              .where(eq(farmerAdvanceFreight.id, record.id));
            
            remainingAmount = roundAmount(remainingAmount - amountToApply);
            receivablesUpdated++;
          }
        }
      }
      
      // Pass 4: Apply remaining to self-sales (FIFO by soldAt)
      if (remainingAmount > 0) {
        // Get self-sales for this farmer
        const selfSales = await db.select()
          .from(salesHistory)
          .where(and(
            eq(salesHistory.coldStorageId, coldStorageId),
            eq(salesHistory.isSelfSale, 1),
            sql`LOWER(TRIM(${salesHistory.farmerName})) = LOWER(TRIM(${farmerName}))`,
            sql`LOWER(TRIM(${salesHistory.village})) = LOWER(TRIM(${village}))`,
            sql`${salesHistory.contactNumber} = ${contactNumber}`,
            sql`(${salesHistory.dueAmount} > 0 OR ${salesHistory.extraDueToMerchant} > 0)`
          ))
          .orderBy(salesHistory.soldAt);
        
        for (const sale of selfSales) {
          if (remainingAmount <= 0) break;
          
          const dueAmount = sale.dueAmount || 0;
          const extraDue = sale.extraDueToMerchant || 0;
          const totalSaleDue = roundAmount(dueAmount + extraDue);
          
          if (totalSaleDue <= 0) continue;
          
          const amountToApply = Math.min(remainingAmount, totalSaleDue);
          
          // Apply to due_amount first, then to extra_due_to_merchant
          let toApply = amountToApply;
          const applyToDue = Math.min(toApply, dueAmount);
          toApply = roundAmount(toApply - applyToDue);
          const applyToExtra = Math.min(toApply, extraDue);
          
          const newDueAmount = roundAmount(dueAmount - applyToDue);
          const newExtraDue = roundAmount(extraDue - applyToExtra);
          // paidAmount should include both applied to due and applied to extra (total payment applied)
          const newPaidAmount = roundAmount((sale.paidAmount || 0) + applyToDue + applyToExtra);
          
          // If remaining due is less than ₹1, treat as fully paid (petty balance threshold)
          const paymentStatusToSet = (newDueAmount + newExtraDue) < 1 ? "paid" : "partial";
          
          await db.update(salesHistory)
            .set({
              dueAmount: newDueAmount,
              paidAmount: newPaidAmount,
              extraDueToMerchant: newExtraDue,
              paymentStatus: paymentStatusToSet
            })
            .where(eq(salesHistory.id, sale.id));
          
          remainingAmount = roundAmount(remainingAmount - amountToApply);
          receivablesUpdated++;
        }
      }
    }
    
    return { receivablesUpdated };
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

    // If this is a farmer_advance or farmer_freight expense, also reverse the linked farmerAdvanceFreight record
    if (expense.expenseType === "farmer_advance" || expense.expenseType === "farmer_freight") {
      await db.update(farmerAdvanceFreight)
        .set({
          isReversed: 1,
          reversedAt: new Date(),
        })
        .where(eq(farmerAdvanceFreight.expenseId, expenseId));
    }

    return { success: true, message: "Expense reversed" };
  }

  async recomputeBuyerPayments(buyerName: string, coldStorageId: string): Promise<{ salesUpdated: number; receiptsUpdated: number }> {
    // Step 1: Reset all sales for this buyer to "due" status with 0 paidAmount
    // Calculate proper dueAmount using all surcharges
    // Use CurrentDueBuyerName logic: match transferToBuyerName first, else buyerName
    // BUT if transfer is reversed (isTransferReversed = 1), use original buyerName
    const buyerSales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(CASE WHEN ${salesHistory.isTransferReversed} = 1 THEN ${salesHistory.buyerName} ELSE COALESCE(NULLIF(${salesHistory.transferToBuyerName}, ''), ${salesHistory.buyerName}) END)) = LOWER(TRIM(${buyerName}))`
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

        const receivableDue = roundAmount((receivable.dueAmount || 0) - (receivable.paidAmount || 0));
        if (receivableDue <= 0) continue;

        if (remainingAmount >= receivableDue) {
          await db.update(openingReceivables)
            .set({ paidAmount: receivable.dueAmount })
            .where(eq(openingReceivables.id, receivable.id));
          
          remainingAmount = roundAmount(remainingAmount - receivableDue);
          appliedAmount = roundAmount(appliedAmount + receivableDue);
        } else {
          const newPaidAmount = roundAmount((receivable.paidAmount || 0) + remainingAmount);
          await db.update(openingReceivables)
            .set({ paidAmount: newPaidAmount })
            .where(eq(openingReceivables.id, receivable.id));
          
          appliedAmount = roundAmount(appliedAmount + remainingAmount);
          remainingAmount = 0;
        }
      }
    }

    // PASS 1: Apply to cold storage dues (FIFO by soldAt)
    // Use CurrentDueBuyerName logic: BUT if transfer is reversed (isTransferReversed = 1), use original buyerName
    if (remainingAmount > 0) {
      const sales = await db.select()
        .from(salesHistory)
        .where(and(
          eq(salesHistory.coldStorageId, coldStorageId),
          sql`LOWER(TRIM(CASE WHEN ${salesHistory.isTransferReversed} = 1 THEN ${salesHistory.buyerName} ELSE COALESCE(NULLIF(${salesHistory.transferToBuyerName}, ''), ${salesHistory.buyerName}) END)) = LOWER(TRIM(${buyerName}))`,
          sql`${salesHistory.paymentStatus} IN ('due', 'partial')`
        ))
        .orderBy(salesHistory.soldAt);

      for (const sale of sales) {
        if (remainingAmount <= 0) break;

        const totalCharges = sale.coldStorageCharge || 0;
        const saleDueAmount = roundAmount(totalCharges - (sale.paidAmount || 0));
        
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
          
          remainingAmount = roundAmount(remainingAmount - saleDueAmount);
          appliedAmount = roundAmount(appliedAmount + saleDueAmount);
        } else {
          const newPaidAmount = roundAmount((sale.paidAmount || 0) + remainingAmount);
          const newDueAmount = roundAmount(totalCharges - newPaidAmount);
          
          // If remaining due is less than ₹1, treat as fully paid (petty balance threshold)
          const paymentStatusToSet = newDueAmount < 1 ? "paid" : "partial";
          
          await db.update(salesHistory)
            .set({
              paymentStatus: paymentStatusToSet,
              paidAmount: newPaidAmount,
              dueAmount: newDueAmount,
              paymentMode: paymentMode,
            })
            .where(eq(salesHistory.id, sale.id));
          
          appliedAmount = roundAmount(appliedAmount + remainingAmount);
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
          
          remainingAmount = roundAmount(remainingAmount - extraDue);
          appliedAmount = roundAmount(appliedAmount + extraDue);
        } else {
          const newExtraDue = roundAmount(extraDue - remainingAmount);
          await db.update(salesHistory)
            .set({ extraDueToMerchant: newExtraDue })
            .where(eq(salesHistory.id, sale.id));
          
          appliedAmount = roundAmount(appliedAmount + remainingAmount);
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
    // Uses LOWER/TRIM for case-insensitive, space-trimmed matching on composite key
    const salesResult = await db.execute(sql`
      SELECT id, due_amount
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${discount.farmerName}))
        AND LOWER(TRIM(village)) = LOWER(TRIM(${discount.village}))
        AND TRIM(contact_number) = TRIM(${discount.contactNumber})
        AND LOWER(TRIM(CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END)) = LOWER(TRIM(${allocation.buyerName}))
        AND due_amount > 0
      ORDER BY sold_at ASC
    `);
    
    for (const row of salesResult.rows as { id: string; due_amount: number }[]) {
      if (remainingAmount <= 0) break;
      
      const saleId = row.id;
      const currentDue = row.due_amount;
      const discountToApply = Math.min(remainingAmount, currentDue);
      const newDue = roundAmount(currentDue - discountToApply);
      
      await db.execute(sql`
        UPDATE sales_history
        SET 
          due_amount = (${newDue})::real,
          paid_amount = paid_amount + (${discountToApply})::real,
          discount_allocated = COALESCE(discount_allocated, 0) + (${discountToApply})::real,
          payment_status = CASE 
            WHEN (${newDue})::real < 1.0 THEN 'paid'
            ELSE 'partial'
          END
        WHERE id = ${saleId}
      `);
      
      remainingAmount = roundAmount(remainingAmount - discountToApply);
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
          newPaidAmount = roundAmount(Math.min(existingPaid, totalCharges));
          newDueAmount = roundAmount(totalCharges - newPaidAmount);
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
    await db.delete(farmerToBuyerTransfers).where(eq(farmerToBuyerTransfers.coldStorageId, id));
    await db.delete(bankAccounts).where(eq(bankAccounts.coldStorageId, id));
    
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
    // Fetch all non-archived farmers from Farmer Ledger (single source of truth)
    const farmers = await db.select({
      farmerName: farmerLedger.name,
      village: farmerLedger.village,
      tehsil: farmerLedger.tehsil,
      district: farmerLedger.district,
      state: farmerLedger.state,
      contactNumber: farmerLedger.contactNumber,
    })
      .from(farmerLedger)
      .where(
        and(
          eq(farmerLedger.coldStorageId, coldStorageId),
          eq(farmerLedger.isArchived, 0)
        )
      )
      .orderBy(farmerLedger.name);

    return farmers.map(f => ({
      farmerName: f.farmerName || "",
      village: f.village || "",
      tehsil: f.tehsil || "",
      district: f.district || "",
      state: f.state || "",
      contactNumber: f.contactNumber || "",
    }));
  }

  async getBuyerRecords(coldStorageId: string): Promise<{ buyerName: string; isSelfSale: boolean }[]> {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    // Only fetch non-self-sale records for buyer dropdown
    // Self-sales have farmer names as buyer names which shouldn't appear in "Filter by Buyer"
    const allSales = await db.select({
      buyerName: salesHistory.buyerName,
      isSelfSale: salesHistory.isSelfSale,
    })
      .from(salesHistory)
      .where(
        and(
          eq(salesHistory.coldStorageId, coldStorageId),
          gte(salesHistory.soldAt, twoYearsAgo),
          sql`${salesHistory.buyerName} IS NOT NULL AND ${salesHistory.buyerName} != ''`,
          // Exclude self-sale records - these have farmer names as buyers
          sql`(${salesHistory.isSelfSale} IS NULL OR ${salesHistory.isSelfSale} != 1)`
        )
      );

    // Also fetch cold merchant buyers from opening receivables
    const coldMerchantReceivables = await db.select({
      buyerName: openingReceivables.buyerName,
    })
      .from(openingReceivables)
      .where(
        and(
          eq(openingReceivables.coldStorageId, coldStorageId),
          eq(openingReceivables.payerType, "cold_merchant"),
          sql`${openingReceivables.buyerName} IS NOT NULL AND ${openingReceivables.buyerName} != ''`
        )
      );

    // Deduplicate by normalized buyer name
    const seen = new Map<string, { buyerName: string }>();
    
    // Add buyers from sales history
    for (const sale of allSales) {
      if (sale.buyerName) {
        const key = sale.buyerName.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, { buyerName: sale.buyerName.trim() });
        }
      }
    }
    
    // Add buyers from cold merchant receivables (only if not already in the map)
    for (const rec of coldMerchantReceivables) {
      if (rec.buyerName) {
        const key = rec.buyerName.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, { buyerName: rec.buyerName.trim() });
        }
      }
    }

    // Return unique buyer names (isSelfSale is always false since we filtered them out)
    return Array.from(seen.values())
      .map(({ buyerName }) => ({
        buyerName,
        isSelfSale: false
      }))
      .sort((a, b) => a.buyerName.localeCompare(b.buyerName));
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
    let buyerLedgerId: string | undefined;
    let buyerId: string | undefined;
    
    // For cold_merchant receivables, ensure buyer ledger entry exists
    if (data.payerType === 'cold_merchant' && data.buyerName && data.buyerName.trim()) {
      const buyerEntry = await this.ensureBuyerLedgerEntry(data.coldStorageId, {
        buyerName: data.buyerName.trim(),
      });
      buyerLedgerId = buyerEntry.id;
      buyerId = buyerEntry.buyerId;
    }
    
    const [receivable] = await db.insert(openingReceivables)
      .values({
        id: randomUUID(),
        ...data,
        buyerLedgerId,
        buyerId,
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
  // Combines dues from both sales_history (self-sales) and opening_receivables (farmer type)
  // Aggregates by farmer composite key (name + phone + village)
  // Uses LOWER/TRIM for case-insensitive, space-trimmed matching
  async getFarmersWithDues(coldStorageId: string): Promise<{ farmerName: string; village: string; contactNumber: string; totalDue: number }[]> {
    // Only include farmer's OWN dues: opening receivables + self-sales
    // Excludes regular sales to buyers (those are tracked on buyer side)
    // EXCLUDE self-sales that have been transferred to a buyer (transfer_to_buyer_name is set)
    const result = await db.execute(sql`
      WITH combined_dues AS (
        -- Self-sales only (is_self_sale = 1) - farmer bought their own produce
        -- EXCLUDE self-sales that have been transferred to a buyer (those debts now belong to buyer)
        SELECT 
          TRIM(farmer_name) as farmer_name,
          TRIM(village) as village,
          TRIM(contact_number) as contact_number,
          due_amount as remaining_due
        FROM sales_history
        WHERE cold_storage_id = ${coldStorageId}
          AND COALESCE(is_self_sale, 0) = 1
          AND due_amount > 0
          AND (transfer_to_buyer_name IS NULL OR transfer_to_buyer_name = '')
        
        UNION ALL
        
        -- Opening receivables (farmer type only) - subtract paid_amount from due_amount
        SELECT 
          TRIM(farmer_name) as farmer_name,
          TRIM(village) as village,
          TRIM(contact_number) as contact_number,
          (due_amount - COALESCE(paid_amount, 0)) as remaining_due
        FROM opening_receivables
        WHERE cold_storage_id = ${coldStorageId}
          AND LOWER(TRIM(payer_type)) = 'farmer'
          AND (due_amount - COALESCE(paid_amount, 0)) > 0
      )
      SELECT 
        MAX(farmer_name) as "farmerName",
        MAX(village) as "village",
        MAX(contact_number) as "contactNumber",
        COALESCE(SUM(remaining_due), 0)::float as "totalDue"
      FROM combined_dues
      GROUP BY LOWER(farmer_name), LOWER(village), contact_number
      HAVING SUM(remaining_due) >= 1
      ORDER BY MAX(farmer_name)
    `);
    return result.rows as { farmerName: string; village: string; contactNumber: string; totalDue: number }[];
  }

  // Get farmers with ALL dues (farmer-liable + buyer-liable)
  // Used for Discount mode where total dues matter
  async getFarmersWithAllDues(coldStorageId: string): Promise<{ farmerName: string; village: string; contactNumber: string; totalDue: number; farmerLiableDue: number; buyerLiableDue: number }[]> {
    const result = await db.execute(sql`
      WITH farmer_liable_dues AS (
        -- Self-sales only (is_self_sale = 1) - farmer bought their own produce
        -- EXCLUDE self-sales transferred to buyer UNLESS transfer was reversed
        SELECT 
          TRIM(farmer_name) as farmer_name,
          TRIM(village) as village,
          TRIM(contact_number) as contact_number,
          due_amount as remaining_due
        FROM sales_history
        WHERE cold_storage_id = ${coldStorageId}
          AND COALESCE(is_self_sale, 0) = 1
          AND due_amount > 0
          AND (
            (transfer_to_buyer_name IS NULL OR transfer_to_buyer_name = '')
            OR is_transfer_reversed = 1
          )
        
        UNION ALL
        
        -- Opening receivables (farmer type only)
        SELECT 
          TRIM(farmer_name) as farmer_name,
          TRIM(village) as village,
          TRIM(contact_number) as contact_number,
          (due_amount - COALESCE(paid_amount, 0)) as remaining_due
        FROM opening_receivables
        WHERE cold_storage_id = ${coldStorageId}
          AND LOWER(TRIM(payer_type)) = 'farmer'
          AND (due_amount - COALESCE(paid_amount, 0)) > 0
      ),
      buyer_liable_dues AS (
        -- Regular sales where buyer is liable (is_self_sale != 1)
        SELECT 
          TRIM(farmer_name) as farmer_name,
          TRIM(village) as village,
          TRIM(contact_number) as contact_number,
          due_amount as remaining_due
        FROM sales_history
        WHERE cold_storage_id = ${coldStorageId}
          AND COALESCE(is_self_sale, 0) = 0
          AND due_amount > 0
      ),
      farmer_liable_aggregated AS (
        SELECT 
          LOWER(farmer_name) as farmer_key_name,
          LOWER(village) as farmer_key_village,
          contact_number as farmer_key_contact,
          MAX(farmer_name) as farmer_name,
          MAX(village) as village,
          MAX(contact_number) as contact_number,
          COALESCE(SUM(remaining_due), 0)::float as farmer_liable_due
        FROM farmer_liable_dues
        GROUP BY LOWER(farmer_name), LOWER(village), contact_number
      ),
      buyer_liable_aggregated AS (
        SELECT 
          LOWER(farmer_name) as farmer_key_name,
          LOWER(village) as farmer_key_village,
          contact_number as farmer_key_contact,
          MAX(farmer_name) as farmer_name,
          MAX(village) as village,
          MAX(contact_number) as contact_number,
          COALESCE(SUM(remaining_due), 0)::float as buyer_liable_due
        FROM buyer_liable_dues
        GROUP BY LOWER(farmer_name), LOWER(village), contact_number
      )
      SELECT 
        COALESCE(f.farmer_name, b.farmer_name) as "farmerName",
        COALESCE(f.village, b.village) as "village",
        COALESCE(f.farmer_key_contact, b.farmer_key_contact) as "contactNumber",
        (COALESCE(f.farmer_liable_due, 0) + COALESCE(b.buyer_liable_due, 0))::float as "totalDue",
        COALESCE(f.farmer_liable_due, 0)::float as "farmerLiableDue",
        COALESCE(b.buyer_liable_due, 0)::float as "buyerLiableDue"
      FROM farmer_liable_aggregated f
      FULL OUTER JOIN buyer_liable_aggregated b 
        ON f.farmer_key_name = b.farmer_key_name 
        AND f.farmer_key_village = b.farmer_key_village
        AND f.farmer_key_contact = b.farmer_key_contact
      WHERE (COALESCE(f.farmer_liable_due, 0) + COALESCE(b.buyer_liable_due, 0)) >= 1
      ORDER BY COALESCE(f.farmer_name, b.farmer_name)
    `);
    return result.rows as { farmerName: string; village: string; contactNumber: string; totalDue: number; farmerLiableDue: number; buyerLiableDue: number }[];
  }

  // Get buyer dues for a specific farmer (sorted by latest sale date)
  // Uses LOWER/TRIM for case-insensitive, space-trimmed matching on composite key
  // Returns farmer's own dues (receivables + self-sales) as the first entry
  async getBuyerDuesForFarmer(coldStorageId: string, farmerName: string, village: string, contactNumber: string): Promise<{ buyerName: string; totalDue: number; latestSaleDate: Date; isFarmerSelf?: boolean }[]> {
    // Format farmer's own entry name: "FarmerName - Phone - Village"
    const farmerSelfBuyerName = `${farmerName.trim()} - ${contactNumber.trim()} - ${village.trim()}`;
    
    // First, get farmer's own dues from opening_receivables
    const receivablesDuesResult = await db.execute(sql`
      SELECT COALESCE(SUM(due_amount - COALESCE(paid_amount, 0)), 0)::float as total_due
      FROM opening_receivables
      WHERE cold_storage_id = ${coldStorageId}
        AND LOWER(TRIM(payer_type)) = 'farmer'
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
        AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
        AND TRIM(contact_number) = TRIM(${contactNumber})
        AND (due_amount - COALESCE(paid_amount, 0)) > 0
    `);
    const receivablesDue = (receivablesDuesResult.rows[0] as any)?.total_due || 0;
    
    // Get farmer's self-sale dues (where is_self_sale = 1)
    // EXCLUDE self-sales transferred to buyer UNLESS transfer was reversed
    const selfSalesDuesResult = await db.execute(sql`
      SELECT 
        COALESCE(SUM(due_amount), 0)::float as total_due,
        MAX(sold_at) as latest_date
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND COALESCE(is_self_sale, 0) = 1
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
        AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
        AND TRIM(contact_number) = TRIM(${contactNumber})
        AND due_amount > 0
        AND (
          (transfer_to_buyer_name IS NULL OR transfer_to_buyer_name = '')
          OR is_transfer_reversed = 1
        )
    `);
    const selfSalesDue = (selfSalesDuesResult.rows[0] as any)?.total_due || 0;
    const selfSalesLatestDate = (selfSalesDuesResult.rows[0] as any)?.latest_date || new Date();
    
    // Total farmer's own dues
    const farmerSelfDue = receivablesDue + selfSalesDue;
    
    // Get other buyer dues (excluding self-sales which are farmer's own)
    // Use CurrentDueBuyerName logic: BUT if transfer is reversed (is_transfer_reversed = 1), use original buyer_name
    const result = await db.execute(sql`
      SELECT 
        CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END as "buyerName",
        COALESCE(SUM(due_amount), 0)::float as "totalDue",
        MAX(sold_at) as "latestSaleDate"
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
        AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
        AND TRIM(contact_number) = TRIM(${contactNumber})
        AND due_amount > 0
        AND COALESCE(is_self_sale, 0) = 0
        AND CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END IS NOT NULL
      GROUP BY CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END
      HAVING SUM(due_amount) > 0
      ORDER BY MAX(sold_at) DESC
    `);
    
    const buyers = result.rows as { buyerName: string; totalDue: number; latestSaleDate: Date }[];
    
    // Build result array with farmer self entry first (if has dues)
    const resultArray: { buyerName: string; totalDue: number; latestSaleDate: Date; isFarmerSelf?: boolean }[] = [];
    
    if (farmerSelfDue > 0) {
      resultArray.push({
        buyerName: farmerSelfBuyerName,
        totalDue: farmerSelfDue,
        latestSaleDate: selfSalesLatestDate,
        isFarmerSelf: true
      });
    }
    
    // Add other buyers
    for (const buyer of buyers) {
      resultArray.push({
        ...buyer,
        isFarmerSelf: false
      });
    }
    
    return resultArray;
  }

  // Create discount with FIFO allocation to reduce sales dues
  // For farmer self allocations: receivables first (by createdAt), then self-sales (by soldAt)
  async createDiscountWithFIFO(data: InsertDiscount): Promise<{ discount: Discount; salesUpdated: number }> {
    // Generate transaction ID unique per cold store
    const transactionId = await generateSequentialId('cash_flow', data.coldStorageId);
    const discountId = randomUUID();
    
    // Parse buyer allocations
    const allocations: { buyerName: string; amount: number }[] = JSON.parse(data.buyerAllocations);
    
    let totalSalesUpdated = 0;
    
    // Format the farmer self buyer name for comparison
    const farmerSelfBuyerName = `${data.farmerName.trim()} - ${data.contactNumber.trim()} - ${data.village.trim()}`;
    
    // Apply FIFO discount for each buyer allocation
    for (const allocation of allocations) {
      let remainingAmount = allocation.amount;
      const buyerName = allocation.buyerName;
      
      // Check if this is a farmer self allocation (farmer receiving discount for their own dues)
      const isFarmerSelfAllocation = buyerName.toLowerCase().trim() === farmerSelfBuyerName.toLowerCase();
      
      if (isFarmerSelfAllocation) {
        // Farmer self allocation: apply to receivables first, then self-sales
        
        // Step 1: Apply to opening_receivables (FIFO by createdAt)
        const receivablesResult = await db.execute(sql`
          SELECT id, due_amount, paid_amount
          FROM opening_receivables
          WHERE cold_storage_id = ${data.coldStorageId}
            AND LOWER(TRIM(payer_type)) = 'farmer'
            AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${data.farmerName}))
            AND LOWER(TRIM(village)) = LOWER(TRIM(${data.village}))
            AND TRIM(contact_number) = TRIM(${data.contactNumber})
            AND (due_amount - COALESCE(paid_amount, 0)) > 0
          ORDER BY created_at ASC
        `);
        
        for (const row of receivablesResult.rows as { id: string; due_amount: number; paid_amount: number | null }[]) {
          if (remainingAmount <= 0) break;
          
          const receivableId = row.id;
          const currentDue = row.due_amount - (row.paid_amount || 0);
          const discountToApply = Math.min(remainingAmount, currentDue);
          
          if (discountToApply > 0) {
            await db.update(openingReceivables)
              .set({ paidAmount: roundAmount((row.paid_amount || 0) + discountToApply) })
              .where(eq(openingReceivables.id, receivableId));
            
            remainingAmount = roundAmount(remainingAmount - discountToApply);
            totalSalesUpdated++;
          }
        }
        
        // Step 2: Apply remaining to farmer FREIGHT records (FIFO by createdAt)
        if (remainingAmount > 0) {
          const [farmerLedgerEntryDisc] = await db.select()
            .from(farmerLedger)
            .where(and(
              eq(farmerLedger.coldStorageId, data.coldStorageId),
              sql`LOWER(TRIM(${farmerLedger.name})) = LOWER(TRIM(${data.farmerName}))`,
              sql`TRIM(${farmerLedger.contactNumber}) = TRIM(${data.contactNumber})`,
              sql`LOWER(TRIM(${farmerLedger.village})) = LOWER(TRIM(${data.village}))`
            ))
            .limit(1);
          
          if (farmerLedgerEntryDisc) {
            const freightRecords = await db.select()
              .from(farmerAdvanceFreight)
              .where(and(
                eq(farmerAdvanceFreight.coldStorageId, data.coldStorageId),
                eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntryDisc.id),
                eq(farmerAdvanceFreight.type, "freight"),
                eq(farmerAdvanceFreight.isReversed, 0)
              ))
              .orderBy(farmerAdvanceFreight.createdAt);
            
            for (const record of freightRecords) {
              if (remainingAmount <= 0) break;
              const remainingDue = roundAmount((record.finalAmount || 0) - (record.paidAmount || 0));
              if (remainingDue <= 0) continue;
              
              const discountToApply = Math.min(remainingAmount, remainingDue);
              if (discountToApply > 0) {
                await db.update(farmerAdvanceFreight)
                  .set({ paidAmount: roundAmount((record.paidAmount || 0) + discountToApply) })
                  .where(eq(farmerAdvanceFreight.id, record.id));
                
                remainingAmount = roundAmount(remainingAmount - discountToApply);
                totalSalesUpdated++;
              }
            }
            
            // Step 3: Apply remaining to farmer ADVANCE records (FIFO by createdAt)
            if (remainingAmount > 0) {
              const advanceRecords = await db.select()
                .from(farmerAdvanceFreight)
                .where(and(
                  eq(farmerAdvanceFreight.coldStorageId, data.coldStorageId),
                  eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntryDisc.id),
                  eq(farmerAdvanceFreight.type, "advance"),
                  eq(farmerAdvanceFreight.isReversed, 0)
                ))
                .orderBy(farmerAdvanceFreight.createdAt);
              
              for (const record of advanceRecords) {
                if (remainingAmount <= 0) break;
                const remainingDue = roundAmount((record.finalAmount || 0) - (record.paidAmount || 0));
                if (remainingDue <= 0) continue;
                
                const discountToApply = Math.min(remainingAmount, remainingDue);
                if (discountToApply > 0) {
                  await db.update(farmerAdvanceFreight)
                    .set({ paidAmount: roundAmount((record.paidAmount || 0) + discountToApply) })
                    .where(eq(farmerAdvanceFreight.id, record.id));
                  
                  remainingAmount = roundAmount(remainingAmount - discountToApply);
                  totalSalesUpdated++;
                }
              }
            }
          }
        }
        
        // Step 4: Apply remaining to self-sales (FIFO by soldAt)
        if (remainingAmount > 0) {
          const selfSalesResult = await db.execute(sql`
            SELECT id, due_amount
            FROM sales_history
            WHERE cold_storage_id = ${data.coldStorageId}
              AND COALESCE(is_self_sale, 0) = 1
              AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${data.farmerName}))
              AND LOWER(TRIM(village)) = LOWER(TRIM(${data.village}))
              AND TRIM(contact_number) = TRIM(${data.contactNumber})
              AND due_amount > 0
            ORDER BY sold_at ASC
          `);
          
          for (const row of selfSalesResult.rows as { id: string; due_amount: number }[]) {
            if (remainingAmount <= 0) break;
            
            const saleId = row.id;
            const currentDue = row.due_amount;
            const discountToApply = Math.min(remainingAmount, currentDue);
            const newDue = roundAmount(currentDue - discountToApply);
            
            await db.execute(sql`
              UPDATE sales_history
              SET 
                due_amount = (${newDue})::real,
                paid_amount = paid_amount + (${discountToApply})::real,
                discount_allocated = COALESCE(discount_allocated, 0) + (${discountToApply})::real,
                payment_status = CASE 
                  WHEN (${newDue})::real < 1.0 THEN 'paid'
                  ELSE 'partial'
                END
              WHERE id = ${saleId}
            `);
            
            remainingAmount = roundAmount(remainingAmount - discountToApply);
            totalSalesUpdated++;
          }
        }
      } else {
        // Regular buyer allocation: apply to sales from this buyer
        // Use CurrentDueBuyerName logic: BUT if transfer is reversed (is_transfer_reversed = 1), use original buyer_name
        const salesResult = await db.execute(sql`
          SELECT id, due_amount
          FROM sales_history
          WHERE cold_storage_id = ${data.coldStorageId}
            AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${data.farmerName}))
            AND LOWER(TRIM(village)) = LOWER(TRIM(${data.village}))
            AND TRIM(contact_number) = TRIM(${data.contactNumber})
            AND LOWER(TRIM(CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END)) = LOWER(TRIM(${buyerName}))
            AND due_amount > 0
          ORDER BY sold_at ASC
        `);
        
        for (const row of salesResult.rows as { id: string; due_amount: number }[]) {
          if (remainingAmount <= 0) break;
          
          const saleId = row.id;
          const currentDue = row.due_amount;
          const discountToApply = Math.min(remainingAmount, currentDue);
          const newDue = roundAmount(currentDue - discountToApply);
          
          await db.execute(sql`
            UPDATE sales_history
            SET 
              due_amount = (${newDue})::real,
              paid_amount = paid_amount + (${discountToApply})::real,
              discount_allocated = COALESCE(discount_allocated, 0) + (${discountToApply})::real,
              payment_status = CASE 
                WHEN (${newDue})::real < 1.0 THEN 'paid'
                ELSE 'partial'
              END
            WHERE id = ${saleId}
          `);
          
          remainingAmount = roundAmount(remainingAmount - discountToApply);
          totalSalesUpdated++;
        }
      }
    }
    
    // Calculate remaining farmer dues after discount (includes both receivables and sales)
    const remainingSalesDuesResult = await db.execute(sql`
      SELECT COALESCE(SUM(due_amount), 0)::float as total_due
      FROM sales_history
      WHERE cold_storage_id = ${data.coldStorageId}
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${data.farmerName}))
        AND LOWER(TRIM(village)) = LOWER(TRIM(${data.village}))
        AND TRIM(contact_number) = TRIM(${data.contactNumber})
        AND due_amount > 0
    `);
    const salesDue = (remainingSalesDuesResult.rows[0] as any)?.total_due || 0;
    
    const remainingReceivablesDuesResult = await db.execute(sql`
      SELECT COALESCE(SUM(due_amount - COALESCE(paid_amount, 0)), 0)::float as total_due
      FROM opening_receivables
      WHERE cold_storage_id = ${data.coldStorageId}
        AND LOWER(TRIM(payer_type)) = 'farmer'
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${data.farmerName}))
        AND LOWER(TRIM(village)) = LOWER(TRIM(${data.village}))
        AND TRIM(contact_number) = TRIM(${data.contactNumber})
        AND (due_amount - COALESCE(paid_amount, 0)) > 0
    `);
    const receivablesDue = (remainingReceivablesDuesResult.rows[0] as any)?.total_due || 0;
    
    // Also include advance/freight dues in dueBalanceAfter
    let advFreightDueAfter = 0;
    const [farmerLedgerForDue] = await db.select()
      .from(farmerLedger)
      .where(and(
        eq(farmerLedger.coldStorageId, data.coldStorageId),
        sql`LOWER(TRIM(${farmerLedger.name})) = LOWER(TRIM(${data.farmerName}))`,
        sql`TRIM(${farmerLedger.contactNumber}) = TRIM(${data.contactNumber})`,
        sql`LOWER(TRIM(${farmerLedger.village})) = LOWER(TRIM(${data.village}))`
      ))
      .limit(1);
    
    if (farmerLedgerForDue) {
      const advFreightAfter = await db.select({
        finalAmount: farmerAdvanceFreight.finalAmount,
        paidAmount: farmerAdvanceFreight.paidAmount,
      })
        .from(farmerAdvanceFreight)
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, data.coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerForDue.id),
          eq(farmerAdvanceFreight.isReversed, 0)
        ));
      for (const record of advFreightAfter) {
        const remaining = (record.finalAmount || 0) - (record.paidAmount || 0);
        if (remaining > 0) advFreightDueAfter += remaining;
      }
    }
    
    const dueBalanceAfter = salesDue + receivablesDue + advFreightDueAfter;

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
    // Also track farmers with self-sale allocations for separate recomputation
    const affectedFarmers: { name: string; phone: string; village: string }[] = [];
    
    for (const allocation of allocations) {
      const buyerName = allocation.buyerName.trim();
      affectedBuyers.add(buyerName);
      
      // Check if this is a self-sale pattern: "FarmerName - Phone - Village"
      // Self-sale pattern has exactly 2 " - " separators, phone can be any digits
      const selfSaleMatch = buyerName.match(/^(.+?)\s*-\s*(\d+)\s*-\s*(.+)$/);
      if (selfSaleMatch) {
        // Normalize internal whitespace (multiple spaces to single space)
        const farmerName = selfSaleMatch[1].trim().replace(/\s+/g, ' ');
        const phone = selfSaleMatch[2].trim();
        const village = selfSaleMatch[3].trim().replace(/\s+/g, ' ');
        // Check if we already have this farmer in the list
        const exists = affectedFarmers.some(f => 
          f.name.toLowerCase() === farmerName.toLowerCase() &&
          f.phone === phone &&
          f.village.toLowerCase() === village.toLowerCase()
        );
        if (!exists) {
          affectedFarmers.push({ name: farmerName, phone, village });
        }
      }
    }
    
    // Trigger FIFO recomputation for each affected buyer
    // This properly replays both receipts AND remaining discounts in chronological order
    for (const buyerName of Array.from(affectedBuyers)) {
      await this.recomputeBuyerPayments(buyerName, discount.coldStorageId);
    }
    
    // For self-sale allocations, also recompute farmer dues (receivables + self-sales with discounts)
    // This handles cases where the self-sale buyer pattern doesn't match due to spacing differences
    for (const farmer of affectedFarmers) {
      await this.recomputeFarmerPaymentsWithDiscounts(
        discount.coldStorageId, 
        farmer.name, 
        farmer.phone, 
        farmer.village
      );
    }
    
    return { success: true };
  }
  
  // Recompute farmer payments including both receipts AND discounts for self-sales
  // Uses farmer identity components (name, phone, village) for exact matching
  async recomputeFarmerPaymentsWithDiscounts(
    coldStorageId: string, 
    farmerName: string, 
    contactNumber: string, 
    village: string
  ): Promise<{ receivablesUpdated: number; selfSalesUpdated: number }> {
    // Step 1: Reset all farmer receivables paidAmount to 0
    await db.execute(sql`
      UPDATE opening_receivables
      SET paid_amount = 0
      WHERE cold_storage_id = ${coldStorageId}
        AND payer_type = 'farmer'
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
        AND TRIM(contact_number) = TRIM(${contactNumber})
        AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
    `);
    
    // Step 1b: Reset all farmer advance/freight paidAmount to 0
    const [farmerLedgerEntryForDiscount] = await db.select()
      .from(farmerLedger)
      .where(and(
        eq(farmerLedger.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${farmerLedger.name})) = LOWER(TRIM(${farmerName}))`,
        sql`TRIM(${farmerLedger.contactNumber}) = TRIM(${contactNumber})`,
        sql`LOWER(TRIM(${farmerLedger.village})) = LOWER(TRIM(${village}))`
      ))
      .limit(1);
    
    if (farmerLedgerEntryForDiscount) {
      await db.update(farmerAdvanceFreight)
        .set({ paidAmount: 0 })
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntryForDiscount.id),
          eq(farmerAdvanceFreight.isReversed, 0)
        ));
    }
    
    // Step 2: Reset all self-sales for this farmer to original due amounts
    // Match by farmer composite key (name + phone + village)
    // Also match by buyer pattern which contains these elements
    const selfSalePattern = `${farmerName.trim()} - ${contactNumber.trim()} - ${village.trim()}`;
    
    await db.execute(sql`
      UPDATE sales_history
      SET 
        paid_amount = 0,
        discount_allocated = 0,
        due_amount = cold_storage_charge,
        extra_due_to_merchant = COALESCE(extra_due_to_merchant_original, 0),
        payment_status = CASE 
          WHEN cold_storage_charge + COALESCE(extra_due_to_merchant_original, 0) < 1 THEN 'paid'
          ELSE 'due'
        END
      WHERE cold_storage_id = ${coldStorageId}
        AND (
          (COALESCE(is_self_sale, 0) = 1 
           AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
           AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
           AND TRIM(contact_number) = TRIM(${contactNumber}))
          OR
          (LOWER(TRIM(CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END)) = LOWER(TRIM(${selfSalePattern})))
        )
    `);
    
    // Step 3: Get farmer receipts (payerType = 'farmer') for this farmer
    // Match by buyerName pattern "FarmerName (Village)"
    const buyerDisplayName = `${farmerName.trim()} (${village.trim()})`;
    
    const activeReceipts = await db.select()
      .from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.payerType, "farmer"),
        eq(cashReceipts.isReversed, 0),
        sql`LOWER(TRIM(${cashReceipts.buyerName})) = LOWER(TRIM(${buyerDisplayName}))`
      ))
      .orderBy(cashReceipts.receivedAt);
    
    // Step 4: Get non-reversed discounts for this farmer that affect self-sales
    const activeDiscounts = await db.select()
      .from(discounts)
      .where(and(
        eq(discounts.coldStorageId, coldStorageId),
        eq(discounts.isReversed, 0),
        sql`LOWER(TRIM(${discounts.farmerName})) = LOWER(TRIM(${farmerName}))`,
        sql`LOWER(TRIM(${discounts.village})) = LOWER(TRIM(${village}))`,
        sql`TRIM(${discounts.contactNumber}) = TRIM(${contactNumber})`
      ));
    
    // Find discounts with self-sale allocations
    type DiscountWithAllocation = { discount: typeof activeDiscounts[0]; amount: number };
    const relevantDiscounts: DiscountWithAllocation[] = [];
    
    for (const discount of activeDiscounts) {
      const allocations: { buyerName: string; amount: number }[] = JSON.parse(discount.buyerAllocations);
      for (const allocation of allocations) {
        // Check if allocation is to self-sale pattern (tolerant regex for any digits)
        const allocMatch = allocation.buyerName.trim().match(/^(.+?)\s*-\s*(\d+)\s*-\s*(.+)$/);
        if (allocMatch) {
          // Normalize internal whitespace for comparison
          const allocName = allocMatch[1].trim().replace(/\s+/g, ' ').toLowerCase();
          const allocPhone = allocMatch[2].trim();
          const allocVillage = allocMatch[3].trim().replace(/\s+/g, ' ').toLowerCase();
          // Match against the farmer (normalized)
          const normalizedFarmerName = farmerName.trim().replace(/\s+/g, ' ').toLowerCase();
          const normalizedVillage = village.trim().replace(/\s+/g, ' ').toLowerCase();
          if (allocName === normalizedFarmerName &&
              allocPhone === contactNumber.trim() &&
              allocVillage === normalizedVillage) {
            relevantDiscounts.push({ discount, amount: allocation.amount });
          }
        }
      }
    }
    
    // Step 5: Merge receipts and discounts into timeline and sort by date
    type Transaction = 
      | { type: 'receipt'; data: typeof activeReceipts[0]; date: Date }
      | { type: 'discount'; data: DiscountWithAllocation; date: Date };
    
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
    
    // Sort by date for FIFO order
    transactions.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    let receivablesUpdated = 0;
    let selfSalesUpdated = 0;
    
    // Step 6: Replay transactions in chronological order
    for (const txn of transactions) {
      if (txn.type === 'receipt') {
        // Apply receipt FIFO: receivables first, then self-sales
        let remainingAmount = txn.data.amount;
        
        // Pass 1: Farmer receivables
        const currentReceivables = await db.select()
          .from(openingReceivables)
          .where(and(
            eq(openingReceivables.coldStorageId, coldStorageId),
            eq(openingReceivables.payerType, "farmer"),
            sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName}))`,
            sql`TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber})`,
            sql`LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`,
            sql`(${openingReceivables.dueAmount} - COALESCE(${openingReceivables.paidAmount}, 0)) > 0`
          ))
          .orderBy(openingReceivables.createdAt);
        
        for (const receivable of currentReceivables) {
          if (remainingAmount <= 0) break;
          const remainingDue = roundAmount((receivable.dueAmount || 0) - (receivable.paidAmount || 0));
          const amountToApply = Math.min(remainingAmount, remainingDue);
          
          if (amountToApply > 0) {
            await db.update(openingReceivables)
              .set({ paidAmount: roundAmount((receivable.paidAmount || 0) + amountToApply) })
              .where(eq(openingReceivables.id, receivable.id));
            remainingAmount = roundAmount(remainingAmount - amountToApply);
            receivablesUpdated++;
          }
        }
        
        // Pass 2: Farmer FREIGHT records (FIFO by createdAt)
        if (remainingAmount > 0 && farmerLedgerEntryForDiscount) {
          const freightRecords = await db.select()
            .from(farmerAdvanceFreight)
            .where(and(
              eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
              eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntryForDiscount.id),
              eq(farmerAdvanceFreight.type, "freight"),
              eq(farmerAdvanceFreight.isReversed, 0)
            ))
            .orderBy(farmerAdvanceFreight.createdAt);
          
          for (const record of freightRecords) {
            if (remainingAmount <= 0) break;
            const remainingDue = roundAmount(record.finalAmount - (record.paidAmount || 0));
            if (remainingDue <= 0) continue;
            const amountToApply = Math.min(remainingAmount, remainingDue);
            if (amountToApply > 0) {
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: roundAmount((record.paidAmount || 0) + amountToApply) })
                .where(eq(farmerAdvanceFreight.id, record.id));
              remainingAmount = roundAmount(remainingAmount - amountToApply);
              receivablesUpdated++;
            }
          }
        }
        
        // Pass 3: Farmer ADVANCE records (FIFO by createdAt)
        if (remainingAmount > 0 && farmerLedgerEntryForDiscount) {
          const advanceRecords = await db.select()
            .from(farmerAdvanceFreight)
            .where(and(
              eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
              eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntryForDiscount.id),
              eq(farmerAdvanceFreight.type, "advance"),
              eq(farmerAdvanceFreight.isReversed, 0)
            ))
            .orderBy(farmerAdvanceFreight.createdAt);
          
          for (const record of advanceRecords) {
            if (remainingAmount <= 0) break;
            const remainingDue = roundAmount(record.finalAmount - (record.paidAmount || 0));
            if (remainingDue <= 0) continue;
            const amountToApply = Math.min(remainingAmount, remainingDue);
            if (amountToApply > 0) {
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: roundAmount((record.paidAmount || 0) + amountToApply) })
                .where(eq(farmerAdvanceFreight.id, record.id));
              remainingAmount = roundAmount(remainingAmount - amountToApply);
              receivablesUpdated++;
            }
          }
        }
        
        // Pass 4: Self-sales
        if (remainingAmount > 0) {
          const selfSales = await db.select()
            .from(salesHistory)
            .where(and(
              eq(salesHistory.coldStorageId, coldStorageId),
              sql`(
                (COALESCE(is_self_sale, 0) = 1 
                 AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
                 AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
                 AND TRIM(contact_number) = TRIM(${contactNumber}))
                OR
                (LOWER(TRIM(CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END)) = LOWER(TRIM(${selfSalePattern})))
              )`,
              sql`(due_amount > 0 OR extra_due_to_merchant > 0)`
            ))
            .orderBy(salesHistory.soldAt);
          
          for (const sale of selfSales) {
            if (remainingAmount <= 0) break;
            const dueAmount = sale.dueAmount || 0;
            const extraDue = sale.extraDueToMerchant || 0;
            const totalDue = roundAmount(dueAmount + extraDue);
            if (totalDue <= 0) continue;
            
            const amountToApply = Math.min(remainingAmount, totalDue);
            const applyToDue = Math.min(amountToApply, dueAmount);
            const applyToExtra = Math.min(amountToApply - applyToDue, extraDue);
            
            const newDueAmount = roundAmount(dueAmount - applyToDue);
            const newExtraDue = roundAmount(extraDue - applyToExtra);
            const newPaidAmount = roundAmount((sale.paidAmount || 0) + applyToDue + applyToExtra);
            const paymentStatus = (newDueAmount + newExtraDue) < 1 ? "paid" : "partial";
            
            await db.update(salesHistory)
              .set({
                dueAmount: newDueAmount,
                paidAmount: newPaidAmount,
                extraDueToMerchant: newExtraDue,
                paymentStatus
              })
              .where(eq(salesHistory.id, sale.id));
            
            remainingAmount = roundAmount(remainingAmount - amountToApply);
            selfSalesUpdated++;
          }
        }
      } else {
        // Apply discount FIFO: receivables first, then self-sales
        let remainingAmount = txn.data.amount;
        
        // Pass 1: Apply discount to farmer receivables first
        const discountReceivables = await db.select()
          .from(openingReceivables)
          .where(and(
            eq(openingReceivables.coldStorageId, coldStorageId),
            eq(openingReceivables.payerType, "farmer"),
            sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName}))`,
            sql`TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber})`,
            sql`LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`,
            sql`(${openingReceivables.dueAmount} - COALESCE(${openingReceivables.paidAmount}, 0)) > 0`
          ))
          .orderBy(openingReceivables.createdAt);
        
        for (const receivable of discountReceivables) {
          if (remainingAmount <= 0) break;
          const remainingDue = roundAmount((receivable.dueAmount || 0) - (receivable.paidAmount || 0));
          const amountToApply = Math.min(remainingAmount, remainingDue);
          
          if (amountToApply > 0) {
            await db.update(openingReceivables)
              .set({ paidAmount: roundAmount((receivable.paidAmount || 0) + amountToApply) })
              .where(eq(openingReceivables.id, receivable.id));
            remainingAmount = roundAmount(remainingAmount - amountToApply);
            receivablesUpdated++;
          }
        }
        
        // Pass 2: Apply remaining discount to farmer FREIGHT records (FIFO by createdAt)
        if (remainingAmount > 0 && farmerLedgerEntryForDiscount) {
          const freightRecords = await db.select()
            .from(farmerAdvanceFreight)
            .where(and(
              eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
              eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntryForDiscount.id),
              eq(farmerAdvanceFreight.type, "freight"),
              eq(farmerAdvanceFreight.isReversed, 0)
            ))
            .orderBy(farmerAdvanceFreight.createdAt);
          
          for (const record of freightRecords) {
            if (remainingAmount <= 0) break;
            const remainingDue = roundAmount(record.finalAmount - (record.paidAmount || 0));
            if (remainingDue <= 0) continue;
            const amountToApply = Math.min(remainingAmount, remainingDue);
            if (amountToApply > 0) {
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: roundAmount((record.paidAmount || 0) + amountToApply) })
                .where(eq(farmerAdvanceFreight.id, record.id));
              remainingAmount = roundAmount(remainingAmount - amountToApply);
              receivablesUpdated++;
            }
          }
        }
        
        // Pass 3: Apply remaining discount to farmer ADVANCE records (FIFO by createdAt)
        if (remainingAmount > 0 && farmerLedgerEntryForDiscount) {
          const advanceRecords = await db.select()
            .from(farmerAdvanceFreight)
            .where(and(
              eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
              eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntryForDiscount.id),
              eq(farmerAdvanceFreight.type, "advance"),
              eq(farmerAdvanceFreight.isReversed, 0)
            ))
            .orderBy(farmerAdvanceFreight.createdAt);
          
          for (const record of advanceRecords) {
            if (remainingAmount <= 0) break;
            const remainingDue = roundAmount(record.finalAmount - (record.paidAmount || 0));
            if (remainingDue <= 0) continue;
            const amountToApply = Math.min(remainingAmount, remainingDue);
            if (amountToApply > 0) {
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: roundAmount((record.paidAmount || 0) + amountToApply) })
                .where(eq(farmerAdvanceFreight.id, record.id));
              remainingAmount = roundAmount(remainingAmount - amountToApply);
              receivablesUpdated++;
            }
          }
        }
        
        // Pass 4: Apply remaining discount to self-sales
        if (remainingAmount > 0) {
          const selfSales = await db.select()
            .from(salesHistory)
            .where(and(
              eq(salesHistory.coldStorageId, coldStorageId),
              sql`(
                (COALESCE(is_self_sale, 0) = 1 
                 AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
                 AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
                 AND TRIM(contact_number) = TRIM(${contactNumber}))
                OR
                (LOWER(TRIM(CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END)) = LOWER(TRIM(${selfSalePattern})))
              )`,
              sql`due_amount > 0`
            ))
            .orderBy(salesHistory.soldAt);
          
          for (const sale of selfSales) {
            if (remainingAmount <= 0) break;
            const currentDue = sale.dueAmount || 0;
            if (currentDue <= 0) continue;
            
            const discountToApply = Math.min(remainingAmount, currentDue);
            const newDueAmount = roundAmount(currentDue - discountToApply);
            const newPaidAmount = roundAmount((sale.paidAmount || 0) + discountToApply);
            const newDiscountAllocated = roundAmount((sale.discountAllocated || 0) + discountToApply);
            const paymentStatus = newDueAmount < 1 ? "paid" : "partial";
            
            await db.update(salesHistory)
              .set({
                dueAmount: newDueAmount,
                paidAmount: newPaidAmount,
                discountAllocated: newDiscountAllocated,
                paymentStatus
              })
              .where(eq(salesHistory.id, sale.id));
            
            remainingAmount = roundAmount(remainingAmount - discountToApply);
            selfSalesUpdated++;
          }
        }
      }
    }
    
    return { receivablesUpdated, selfSalesUpdated };
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
    // Uses LOWER/TRIM for case-insensitive, space-trimmed matching on composite key
    const discountRows = await db.select()
      .from(discounts)
      .where(and(
        eq(discounts.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${discounts.farmerName})) = LOWER(TRIM(${farmerName}))`,
        sql`LOWER(TRIM(${discounts.village})) = LOWER(TRIM(${village}))`,
        sql`TRIM(${discounts.contactNumber}) = TRIM(${contactNumber})`,
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

  async updateSalesHistoryFarmerDetails(
    lotId: string,
    updates: { farmerName?: string; village?: string; tehsil?: string; district?: string; state?: string; contactNumber?: string },
    oldFarmerDetails: { farmerName: string; village: string; contactNumber: string }
  ): Promise<number> {
    // Filter out undefined values for farmer detail fields
    const filteredUpdates: Record<string, string> = {};
    if (updates.farmerName !== undefined) filteredUpdates.farmerName = updates.farmerName;
    if (updates.village !== undefined) filteredUpdates.village = updates.village;
    if (updates.tehsil !== undefined) filteredUpdates.tehsil = updates.tehsil;
    if (updates.district !== undefined) filteredUpdates.district = updates.district;
    if (updates.state !== undefined) filteredUpdates.state = updates.state;
    if (updates.contactNumber !== undefined) filteredUpdates.contactNumber = updates.contactNumber;

    if (Object.keys(filteredUpdates).length === 0) {
      return 0;
    }

    // First, update all salesHistory entries for this lot with farmer details
    const result = await db.update(salesHistory)
      .set(filteredUpdates)
      .where(eq(salesHistory.lotId, lotId))
      .returning();

    // Calculate new values (using updated values where available, old values otherwise)
    const newFarmerName = (updates.farmerName ?? oldFarmerDetails.farmerName).trim();
    const newContactNumber = (updates.contactNumber ?? oldFarmerDetails.contactNumber).trim();
    const newVillage = (updates.village ?? oldFarmerDetails.village).trim();
    const newSelfPattern = `${newFarmerName} - ${newContactNumber} - ${newVillage}`;

    // Update buyerName for entries where buyer was "self" 
    // Self-buyer format is: "FarmerName - Phone - Village"
    // Use PostgreSQL regexp_replace to normalize whitespace before comparing
    const oldFarmerNameTrimmed = oldFarmerDetails.farmerName.trim();
    const oldPhone = oldFarmerDetails.contactNumber.trim();
    const oldVillage = oldFarmerDetails.village.trim();
    
    // Build the normalized expected pattern (single spaces, trimmed)
    const normalizedOldPattern = `${oldFarmerNameTrimmed} - ${oldPhone} - ${oldVillage}`;
    
    // Update rows where normalized buyerName matches normalized old pattern
    // regexp_replace(trim(buyer_name), '\\s+', ' ', 'g') collapses all whitespace to single spaces
    await db.execute(sql`
      UPDATE sales_history 
      SET buyer_name = ${newSelfPattern}
      WHERE lot_id = ${lotId}
        AND regexp_replace(trim(buyer_name), '\\s+', ' ', 'g') = ${normalizedOldPattern}
    `);
    
    return result.length;
  }

  // Farmer to Buyer debt transfer - only transfers specific self-sale (not receivables)
  async createFarmerToBuyerTransfer(data: {
    coldStorageId: string;
    saleId: string;
    farmerName: string;
    village: string;
    contactNumber: string;
    toBuyerName: string;
    transferDate: Date;
    remarks?: string | null;
  }): Promise<{ success: boolean; selfSalesTransferred: number; transactionId: string }> {
    // Get the specific self-sale to transfer - validate it belongs to the specified farmer
    const saleResult = await db.execute(sql`
      SELECT id, due_amount, farmer_name, lot_no, quantity_sold, bag_type
      FROM sales_history
      WHERE id = ${data.saleId}
        AND cold_storage_id = ${data.coldStorageId}
        AND COALESCE(is_self_sale, 0) = 1
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${data.farmerName}))
        AND LOWER(TRIM(village)) = LOWER(TRIM(${data.village}))
        AND TRIM(contact_number) = TRIM(${data.contactNumber})
        AND due_amount > 0
    `);
    
    if (saleResult.rows.length === 0) {
      throw new Error("Self-sale not found, doesn't belong to this farmer, or has no dues");
    }
    
    const sale = saleResult.rows[0] as { id: string; due_amount: number; farmer_name: string; lot_no: string; quantity_sold: number; bag_type: string };
    const transferAmount = roundAmount(sale.due_amount);
    
    // Transfer the entire due amount to the new buyer
    // Set due_amount to 0 and update transferToBuyerName
    // Reset is_transfer_reversed to 0 in case this sale was previously transferred and reversed
    await db.execute(sql`
      UPDATE sales_history
      SET 
        due_amount = 0,
        transfer_to_buyer_name = ${data.toBuyerName},
        transfer_date = ${data.transferDate},
        transfer_remarks = ${data.remarks || null},
        clearance_type = 'transfer',
        is_transfer_reversed = 0,
        transfer_reversed_at = NULL
      WHERE id = ${data.saleId}
    `);

    // Generate transaction ID for cash flow record
    const transactionId = await generateSequentialId('cash_flow', data.coldStorageId);

    // Calculate remaining farmer dues after this transfer (only self-sales, not receivables)
    const remainingSelfSalesResult = await db.execute(sql`
      SELECT COALESCE(SUM(due_amount), 0)::float as total
      FROM sales_history
      WHERE cold_storage_id = ${data.coldStorageId}
        AND COALESCE(is_self_sale, 0) = 1
        AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${data.farmerName}))
        AND LOWER(TRIM(village)) = LOWER(TRIM(${data.village}))
        AND TRIM(contact_number) = TRIM(${data.contactNumber})
        AND due_amount > 0
    `);
    const dueBalanceAfter = roundAmount(
      parseFloat((remainingSelfSalesResult.rows[0] as { total: string | number })?.total?.toString() || "0")
    );

    // Store the transfer in the farmer_to_buyer_transfers table for cash flow history
    await db.insert(farmerToBuyerTransfers).values({
      id: randomUUID(),
      transactionId,
      coldStorageId: data.coldStorageId,
      farmerName: data.farmerName.trim(),
      village: data.village.trim(),
      contactNumber: data.contactNumber.trim(),
      toBuyerName: data.toBuyerName,
      totalAmount: transferAmount,
      receivablesTransferred: 0, // No receivables transferred anymore
      selfSalesTransferred: transferAmount,
      transferDate: data.transferDate,
      remarks: data.remarks || null,
      dueBalanceAfter,
    });

    return {
      success: true,
      selfSalesTransferred: transferAmount,
      transactionId,
    };
  }

  // Get all farmer-to-buyer transfers for cash flow history
  async getFarmerToBuyerTransfers(coldStorageId: string): Promise<FarmerToBuyerTransfer[]> {
    return db.select()
      .from(farmerToBuyerTransfers)
      .where(eq(farmerToBuyerTransfers.coldStorageId, coldStorageId))
      .orderBy(desc(farmerToBuyerTransfers.createdAt));
  }

  // Reverse a farmer-to-buyer transfer
  async reverseFarmerToBuyerTransfer(transferId: string): Promise<{ success: boolean; message?: string }> {
    // Get the transfer
    const [transfer] = await db.select()
      .from(farmerToBuyerTransfers)
      .where(eq(farmerToBuyerTransfers.id, transferId));

    if (!transfer) {
      return { success: false, message: "Transfer not found" };
    }

    if (transfer.isReversed === 1) {
      return { success: false, message: "Transfer already reversed" };
    }

    // Restore the farmer's receivables (reduce paid_amount)
    if (transfer.receivablesTransferred > 0) {
      let remainingToRestore = roundAmount(transfer.receivablesTransferred);
      
      // Get receivables in reverse order (most recent first, opposite of FIFO)
      const receivablesResult = await db.execute(sql`
        SELECT id, due_amount, paid_amount
        FROM opening_receivables
        WHERE cold_storage_id = ${transfer.coldStorageId}
          AND payer_type = 'farmer'
          AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${transfer.farmerName}))
          AND LOWER(TRIM(village)) = LOWER(TRIM(${transfer.village}))
          AND TRIM(contact_number) = TRIM(${transfer.contactNumber})
          AND COALESCE(paid_amount, 0) > 0
        ORDER BY created_at DESC
      `);

      for (const row of receivablesResult.rows as { id: string; due_amount: number; paid_amount: number }[]) {
        if (remainingToRestore <= 0) break;

        const currentPaid = row.paid_amount || 0;
        if (currentPaid <= 0) continue; // Skip if nothing to restore from
        
        const amountToRestore = roundAmount(Math.min(remainingToRestore, currentPaid));
        if (amountToRestore <= 0) continue; // Skip if nothing to restore
        
        const newPaidAmount = roundAmount(Math.max(0, currentPaid - amountToRestore)); // Guard against negative

        await db.execute(sql`
          UPDATE opening_receivables
          SET paid_amount = ${newPaidAmount}
          WHERE id = ${row.id}
        `);

        remainingToRestore = roundAmount(remainingToRestore - amountToRestore);
      }
    }

    // Restore the farmer's self-sale dues
    if (transfer.selfSalesTransferred > 0) {
      let remainingToRestore = roundAmount(transfer.selfSalesTransferred);

      // Get self-sales in reverse order (most recent first)
      // These are sales where the farmer bought their own produce and then transferred the debt to a buyer
      const selfSalesResult = await db.execute(sql`
        SELECT id, due_amount, cold_storage_charge
        FROM sales_history
        WHERE cold_storage_id = ${transfer.coldStorageId}
          AND COALESCE(is_self_sale, 0) = 1
          AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${transfer.farmerName}))
          AND LOWER(TRIM(village)) = LOWER(TRIM(${transfer.village}))
          AND TRIM(contact_number) = TRIM(${transfer.contactNumber})
          AND LOWER(TRIM(transfer_to_buyer_name)) = LOWER(TRIM(${transfer.toBuyerName}))
        ORDER BY sold_at DESC
      `);

      for (const row of selfSalesResult.rows as { id: string; due_amount: number; cold_storage_charge: number }[]) {
        if (remainingToRestore <= 0) break;

        const saleId = row.id;
        // maxCanRestore = how much was transferred from this sale (original charge - current due)
        const originalCharge = row.cold_storage_charge || 0;
        const currentDue = row.due_amount || 0;
        
        // Calculate max restorable - this is what was transferred out of this sale
        // Guard against data anomalies where currentDue > originalCharge or missing originalCharge
        let maxCanRestore = roundAmount(originalCharge - currentDue);
        
        // If originalCharge is 0 or missing (legacy records), we can still restore up to remainingToRestore
        // since the sale was marked with transfer_to_buyer_name, it must have been transferred
        if (originalCharge <= 0) {
          maxCanRestore = remainingToRestore; // Allow full restoration for legacy records
        }
        
        // Guard against negative values (data anomalies)
        if (maxCanRestore < 0) maxCanRestore = 0;
        
        const amountToRestore = roundAmount(Math.min(remainingToRestore, maxCanRestore));
        if (amountToRestore <= 0) continue; // Skip if nothing to restore
        
        const newDueAmount = roundAmount(currentDue + amountToRestore);

        await db.execute(sql`
          UPDATE sales_history
          SET 
            due_amount = ${newDueAmount}::real,
            is_transfer_reversed = 1,
            transfer_reversed_at = NOW()
          WHERE id = ${saleId}
        `);

        remainingToRestore = roundAmount(remainingToRestore - amountToRestore);
      }
    }

    // Mark the transfer as reversed
    await db.update(farmerToBuyerTransfers)
      .set({
        isReversed: 1,
        reversedAt: new Date(),
      })
      .where(eq(farmerToBuyerTransfers.id, transferId));

    return { success: true };
  }

  // Bank Accounts
  async getBankAccounts(coldStorageId: string, year: number): Promise<BankAccount[]> {
    return await db.select()
      .from(bankAccounts)
      .where(and(
        eq(bankAccounts.coldStorageId, coldStorageId),
        eq(bankAccounts.year, year)
      ))
      .orderBy(bankAccounts.accountName);
  }

  async createBankAccount(data: InsertBankAccount): Promise<BankAccount> {
    const [account] = await db.insert(bankAccounts)
      .values({
        id: randomUUID(),
        ...data,
      })
      .returning();
    return account;
  }

  async updateBankAccount(id: string, updates: Partial<BankAccount>): Promise<BankAccount | undefined> {
    const [account] = await db.update(bankAccounts)
      .set(updates)
      .where(eq(bankAccounts.id, id))
      .returning();
    return account;
  }

  async deleteBankAccount(id: string): Promise<boolean> {
    await db.delete(bankAccounts)
      .where(eq(bankAccounts.id, id));
    return true;
  }

  // ============ FARMER ADVANCE & FREIGHT ============

  async createFarmerAdvanceFreight(data: InsertFarmerAdvanceFreight): Promise<FarmerAdvanceFreight> {
    const [record] = await db.insert(farmerAdvanceFreight)
      .values({
        id: randomUUID(),
        ...data,
      })
      .returning();
    return record;
  }

  async getFarmerAdvanceFreight(coldStorageId: string, farmerLedgerId?: string): Promise<FarmerAdvanceFreight[]> {
    if (farmerLedgerId) {
      return db.select().from(farmerAdvanceFreight)
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerId),
          eq(farmerAdvanceFreight.isReversed, 0)
        ))
        .orderBy(desc(farmerAdvanceFreight.createdAt));
    }
    return db.select().from(farmerAdvanceFreight)
      .where(and(
        eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
        eq(farmerAdvanceFreight.isReversed, 0)
      ))
      .orderBy(desc(farmerAdvanceFreight.createdAt));
  }

  async accrueInterestForAll(coldStorageId: string): Promise<number> {
    const records = await db.select().from(farmerAdvanceFreight)
      .where(and(
        eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
        eq(farmerAdvanceFreight.isReversed, 0)
      ));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let updatedCount = 0;

    for (const record of records) {
      if (record.rateOfInterest <= 0) continue;

      const lastAccrual = new Date(record.lastAccrualDate);
      lastAccrual.setHours(0, 0, 0, 0);

      if (lastAccrual >= today) continue;

      const newFinalAmount = this.computeCompoundInterest(
        record.amount,
        record.rateOfInterest,
        record.effectiveDate,
        today
      );

      await db.update(farmerAdvanceFreight)
        .set({
          finalAmount: newFinalAmount,
          lastAccrualDate: today,
        })
        .where(eq(farmerAdvanceFreight.id, record.id));

      updatedCount++;
    }

    return updatedCount;
  }

  private computeCompoundInterest(
    principal: number,
    annualRate: number,
    effectiveDate: Date,
    currentDate: Date
  ): number {
    const startDate = new Date(effectiveDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(currentDate);
    endDate.setHours(0, 0, 0, 0);

    const diffMs = endDate.getTime() - startDate.getTime();
    if (diffMs <= 0) return principal;

    const years = diffMs / (365.25 * 24 * 60 * 60 * 1000);
    const rate = annualRate / 100;
    return Math.round(principal * Math.pow(1 + rate, years) * 100) / 100;
  }

  // ============ FARMER LEDGER ============

  // Generate farmer composite key for deduplication
  private getFarmerCompositeKey(name: string, contactNumber: string, village: string): string {
    return `${name.trim().toLowerCase()}_${contactNumber.trim()}_${village.trim().toLowerCase()}`;
  }

  // Generate unique farmer ID in format FMYYYYMMDD1, FMYYYYMMDD2, etc.
  // Uses atomic counter stored in cold_storages.farmerIdSequences to prevent ID reuse even after deletion
  // Safety: unique constraint on farmer_ledger.farmerId + retry logic ensures no duplicates
  async generateFarmerId(coldStorageId: string): Promise<string> {
    const now = new Date();
    const dateKey = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    
    try {
      // Atomically increment and return the next sequence using a single UPDATE + RETURNING
      // This ensures no two concurrent calls get the same sequence number
      const result = await db.execute(sql`
        UPDATE cold_storages 
        SET farmer_id_sequences = (
          CASE 
            WHEN farmer_id_sequences IS NULL OR farmer_id_sequences = '' THEN 
              jsonb_build_object(${dateKey}, 1)::text
            ELSE 
              (COALESCE(farmer_id_sequences::jsonb, '{}'::jsonb) || 
               jsonb_build_object(${dateKey}, COALESCE((farmer_id_sequences::jsonb->${dateKey})::int, 0) + 1))::text
          END
        )
        WHERE id = ${coldStorageId}
        RETURNING (farmer_id_sequences::jsonb->${dateKey})::int as next_sequence
      `);
      
      const nextSequence = (result.rows[0] as { next_sequence: number })?.next_sequence;
      
      if (nextSequence) {
        return `FM${dateKey}${nextSequence}`;
      }
    } catch (error) {
      console.error('Error generating farmer ID via sequence:', error);
    }
    
    // Fallback: compute from existing farmer entries (within transaction for safety)
    // This ensures we never reuse an ID even if sequence update fails
    const existingFarmers = await db.select({ farmerId: farmerLedger.farmerId })
      .from(farmerLedger)
      .where(and(
        eq(farmerLedger.coldStorageId, coldStorageId),
        sql`${farmerLedger.farmerId} LIKE ${'FM' + dateKey + '%'}`
      ));
    
    let maxCounter = 0;
    for (const f of existingFarmers) {
      const numPart = f.farmerId.replace('FM' + dateKey, '');
      const counter = parseInt(numPart, 10);
      if (!isNaN(counter) && counter > maxCounter) {
        maxCounter = counter;
      }
    }
    
    // Unique constraint + retry logic in caller ensures this won't cause duplicates
    return `FM${dateKey}${maxCounter + 1}`;
  }

  // Sync farmers from all touchpoints: lots, receivables
  async syncFarmersFromTouchpoints(coldStorageId: string): Promise<{ added: number; updated: number; lotsLinked: number; receivablesLinked: number }> {
    let added = 0;
    let updated = 0;
    
    // Get existing farmers for deduplication
    const existingFarmers = await db.select()
      .from(farmerLedger)
      .where(eq(farmerLedger.coldStorageId, coldStorageId));
    
    const existingKeys = new Map<string, FarmerLedgerEntry>();
    for (const f of existingFarmers) {
      const key = this.getFarmerCompositeKey(f.name, f.contactNumber, f.village);
      existingKeys.set(key, f);
    }
    
    // Collect all unique farmers from touchpoints
    const farmersToProcess = new Map<string, {
      name: string;
      contactNumber: string;
      village: string;
      tehsil?: string;
      district?: string;
      state?: string;
    }>();
    
    // 1. From lots
    const lotsData = await db.select({
      farmerName: lots.farmerName,
      contactNumber: lots.contactNumber,
      village: lots.village,
      tehsil: lots.tehsil,
      district: lots.district,
      state: lots.state,
    })
      .from(lots)
      .where(eq(lots.coldStorageId, coldStorageId));
    
    for (const lot of lotsData) {
      const key = this.getFarmerCompositeKey(lot.farmerName, lot.contactNumber, lot.village);
      if (!farmersToProcess.has(key)) {
        farmersToProcess.set(key, {
          name: lot.farmerName.trim(),
          contactNumber: lot.contactNumber.trim(),
          village: lot.village.trim(),
          tehsil: lot.tehsil?.trim(),
          district: lot.district?.trim(),
          state: lot.state?.trim(),
        });
      }
    }
    
    // 2. From opening receivables (farmer type)
    const receivables = await db.select({
      farmerName: openingReceivables.farmerName,
      contactNumber: openingReceivables.contactNumber,
      village: openingReceivables.village,
      tehsil: openingReceivables.tehsil,
      district: openingReceivables.district,
      state: openingReceivables.state,
    })
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.payerType, 'farmer')
      ));
    
    for (const rec of receivables) {
      if (rec.farmerName && rec.contactNumber && rec.village) {
        const key = this.getFarmerCompositeKey(rec.farmerName, rec.contactNumber, rec.village);
        if (!farmersToProcess.has(key)) {
          farmersToProcess.set(key, {
            name: rec.farmerName.trim(),
            contactNumber: rec.contactNumber.trim(),
            village: rec.village.trim(),
            tehsil: rec.tehsil?.trim(),
            district: rec.district?.trim(),
            state: rec.state?.trim(),
          });
        }
      }
    }
    
    // Process each farmer - create or update ledger entries
    for (const [key, farmerData] of Array.from(farmersToProcess.entries())) {
      if (!existingKeys.has(key)) {
        // New farmer - add to ledger with retry logic for unique constraint violations
        const maxRetries = 3;
        let created = false;
        for (let attempt = 0; attempt < maxRetries && !created; attempt++) {
          const farmerId = await this.generateFarmerId(coldStorageId);
          const newId = randomUUID();
          try {
            await db.insert(farmerLedger).values({
              id: newId,
              coldStorageId,
              farmerId,
              name: farmerData.name,
              contactNumber: farmerData.contactNumber,
              village: farmerData.village,
              tehsil: farmerData.tehsil || null,
              district: farmerData.district || null,
              state: farmerData.state || null,
              isFlagged: 0,
              isArchived: 0,
            });
            // Add to existingKeys so we can use it for backfilling
            existingKeys.set(key, {
              id: newId,
              coldStorageId,
              farmerId,
              name: farmerData.name,
              contactNumber: farmerData.contactNumber,
              village: farmerData.village,
              tehsil: farmerData.tehsil || null,
              district: farmerData.district || null,
              state: farmerData.state || null,
              isFlagged: 0,
              isArchived: 0,
              archivedAt: null,
              createdAt: new Date(),
            });
            added++;
            created = true;
          } catch (error: any) {
            // Check if it's a unique constraint violation (PostgreSQL error code 23505)
            // Constraint name: farmer_ledger_cs_fid_idx (composite unique on coldStorageId + farmerId)
            if (error?.code === '23505' && (error?.constraint?.includes('farmer_id') || error?.constraint?.includes('cs_fid'))) {
              console.log(`Farmer ID collision detected during sync (attempt ${attempt + 1}/${maxRetries}), retrying...`);
              continue; // Retry with a new ID
            }
            throw error; // Re-throw other errors
          }
        }
        if (!created) {
          console.error(`Failed to create farmer entry for ${farmerData.name} after ${maxRetries} attempts`);
        }
      } else {
        // Farmer exists - update additional fields if they have more complete info
        const existing = existingKeys.get(key)!;
        const updates: Partial<FarmerLedgerEntry> = {};
        
        if (!existing.tehsil && farmerData.tehsil) updates.tehsil = farmerData.tehsil;
        if (!existing.district && farmerData.district) updates.district = farmerData.district;
        if (!existing.state && farmerData.state) updates.state = farmerData.state;
        
        if (Object.keys(updates).length > 0) {
          await db.update(farmerLedger)
            .set(updates)
            .where(eq(farmerLedger.id, existing.id));
          updated++;
        }
      }
    }
    
    // Backfill: Update lots with null farmerLedgerId or farmerId
    let lotsLinked = 0;
    const lotsToLink = await db.select()
      .from(lots)
      .where(and(
        eq(lots.coldStorageId, coldStorageId),
        or(isNull(lots.farmerLedgerId), isNull(lots.farmerId))
      ));
    
    for (const lot of lotsToLink) {
      const key = this.getFarmerCompositeKey(lot.farmerName, lot.contactNumber, lot.village);
      const farmerEntry = existingKeys.get(key);
      if (farmerEntry) {
        const updates: { farmerLedgerId?: string; farmerId?: string } = {};
        if (!lot.farmerLedgerId) updates.farmerLedgerId = farmerEntry.id;
        if (!lot.farmerId) updates.farmerId = farmerEntry.farmerId;
        if (Object.keys(updates).length > 0) {
          await db.update(lots)
            .set(updates)
            .where(eq(lots.id, lot.id));
          lotsLinked++;
        }
      }
    }
    
    // Backfill: Update opening_receivables (farmer type) with null farmerLedgerId or farmerId
    let receivablesLinked = 0;
    const receivablesToLink = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.payerType, 'farmer'),
        or(isNull(openingReceivables.farmerLedgerId), isNull(openingReceivables.farmerId))
      ));
    
    for (const rec of receivablesToLink) {
      if (rec.farmerName && rec.contactNumber && rec.village) {
        const key = this.getFarmerCompositeKey(rec.farmerName, rec.contactNumber, rec.village);
        const farmerEntry = existingKeys.get(key);
        if (farmerEntry) {
          const updates: { farmerLedgerId?: string; farmerId?: string } = {};
          if (!rec.farmerLedgerId) updates.farmerLedgerId = farmerEntry.id;
          if (!rec.farmerId) updates.farmerId = farmerEntry.farmerId;
          if (Object.keys(updates).length > 0) {
            await db.update(openingReceivables)
              .set(updates)
              .where(eq(openingReceivables.id, rec.id));
            receivablesLinked++;
          }
        }
      }
    }
    
    // Note: sales_history backfill removed - new sales get farmerId at creation time
    // This avoids overhead as sales table grows
    
    return { added, updated, lotsLinked, receivablesLinked };
  }

  // Ensure farmer ledger entry exists - find by composite key or create new
  // Returns the farmerLedger.id (UUID) for linking to lots
  async ensureFarmerLedgerEntry(coldStorageId: string, farmerData: {
    name: string;
    contactNumber: string;
    village: string;
    tehsil?: string;
    district?: string;
    state?: string;
  }): Promise<{ id: string; farmerId: string }> {
    const key = this.getFarmerCompositeKey(farmerData.name, farmerData.contactNumber, farmerData.village);
    
    // Check if farmer already exists with this composite key
    const existingFarmers = await db.select()
      .from(farmerLedger)
      .where(and(
        eq(farmerLedger.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${farmerLedger.name})) = ${farmerData.name.trim().toLowerCase()}`,
        sql`TRIM(${farmerLedger.contactNumber}) = ${farmerData.contactNumber.trim()}`,
        sql`LOWER(TRIM(${farmerLedger.village})) = ${farmerData.village.trim().toLowerCase()}`
      ));
    
    if (existingFarmers.length > 0) {
      // Farmer exists - optionally update missing fields
      const existing = existingFarmers[0];
      const updates: Partial<FarmerLedgerEntry> = {};
      
      if (!existing.tehsil && farmerData.tehsil) updates.tehsil = farmerData.tehsil.trim();
      if (!existing.district && farmerData.district) updates.district = farmerData.district.trim();
      if (!existing.state && farmerData.state) updates.state = farmerData.state.trim();
      
      if (Object.keys(updates).length > 0) {
        await db.update(farmerLedger)
          .set(updates)
          .where(eq(farmerLedger.id, existing.id));
      }
      
      return { id: existing.id, farmerId: existing.farmerId };
    }
    
    // Create new farmer ledger entry with retry logic for unique constraint violations
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const farmerId = await this.generateFarmerId(coldStorageId);
      const newId = randomUUID();
      
      try {
        await db.insert(farmerLedger).values({
          id: newId,
          coldStorageId,
          farmerId,
          name: farmerData.name.trim(),
          contactNumber: farmerData.contactNumber.trim(),
          village: farmerData.village.trim(),
          tehsil: farmerData.tehsil?.trim() || null,
          district: farmerData.district?.trim() || null,
          state: farmerData.state?.trim() || null,
          isFlagged: 0,
          isArchived: 0,
        });
        
        return { id: newId, farmerId };
      } catch (error: any) {
        // Check if it's a unique constraint violation (PostgreSQL error code 23505)
        // Constraint name: farmer_ledger_cs_fid_idx (composite unique on coldStorageId + farmerId)
        if (error?.code === '23505' && (error?.constraint?.includes('farmer_id') || error?.constraint?.includes('cs_fid'))) {
          console.log(`Farmer ID collision detected (attempt ${attempt + 1}/${maxRetries}), retrying...`);
          continue; // Retry with a new ID
        }
        throw error; // Re-throw other errors
      }
    }
    
    throw new Error('Failed to generate unique farmer ID after multiple attempts');
  }

  // Get farmer ledger with calculated dues
  async getFarmerLedger(coldStorageId: string, includeArchived: boolean = false): Promise<{
    farmers: (FarmerLedgerEntry & {
      pyReceivables: number;
      selfDue: number;
      merchantDue: number;
      advanceDue: number;
      freightDue: number;
      totalDue: number;
    })[];
    summary: {
      totalFarmers: number;
      pyReceivables: number;
      selfDue: number;
      merchantDue: number;
      advanceDue: number;
      freightDue: number;
      totalDue: number;
    };
  }> {
    // Get all farmers
    let farmers: FarmerLedgerEntry[];
    if (includeArchived) {
      farmers = await db.select()
        .from(farmerLedger)
        .where(eq(farmerLedger.coldStorageId, coldStorageId))
        .orderBy(farmerLedger.farmerId);
    } else {
      farmers = await db.select()
        .from(farmerLedger)
        .where(and(
          eq(farmerLedger.coldStorageId, coldStorageId),
          eq(farmerLedger.isArchived, 0)
        ))
        .orderBy(farmerLedger.farmerId);
    }
    
    // Calculate dues for each farmer
    const farmersWithDues = await Promise.all(farmers.map(async (farmer) => {
      // PY Receivables - from opening receivables (farmer type)
      // Match by farmerLedgerId (primary) or composite key (fallback for old records)
      const pyReceivablesData = await db.select({
        dueAmount: openingReceivables.dueAmount,
        paidAmount: openingReceivables.paidAmount,
      })
        .from(openingReceivables)
        .where(and(
          eq(openingReceivables.coldStorageId, coldStorageId),
          eq(openingReceivables.payerType, 'farmer'),
          sql`(
            (${openingReceivables.farmerLedgerId} IS NOT NULL AND ${openingReceivables.farmerLedgerId} = ${farmer.id})
            OR (
              ${openingReceivables.farmerLedgerId} IS NULL
              AND LOWER(TRIM(${openingReceivables.farmerName})) = ${farmer.name.trim().toLowerCase()}
              AND TRIM(${openingReceivables.contactNumber}) = ${farmer.contactNumber.trim()}
              AND LOWER(TRIM(${openingReceivables.village})) = ${farmer.village.trim().toLowerCase()}
            )
          )`
        ));
      
      const pyReceivables = pyReceivablesData.reduce((sum, r) => sum + (r.dueAmount - (r.paidAmount || 0)), 0);
      
      // Self Due - from self-sales (isSelfSale = 1) where farmer bought their own produce
      // EXCLUDE self-sales that have been transferred to a buyer (those are now buyer dues)
      // BUT INCLUDE if transfer was reversed (isTransferReversed = 1) - farmer owes again
      // Match by farmerLedgerId (primary) or composite key (fallback for old records)
      const selfSalesData = await db.select({
        dueAmount: salesHistory.dueAmount,
      })
        .from(salesHistory)
        .where(and(
          eq(salesHistory.coldStorageId, coldStorageId),
          eq(salesHistory.isSelfSale, 1),
          sql`(
            (${salesHistory.farmerLedgerId} IS NOT NULL AND ${salesHistory.farmerLedgerId} = ${farmer.id})
            OR (
              ${salesHistory.farmerLedgerId} IS NULL
              AND LOWER(TRIM(${salesHistory.farmerName})) = ${farmer.name.trim().toLowerCase()}
              AND TRIM(${salesHistory.contactNumber}) = ${farmer.contactNumber.trim()}
              AND LOWER(TRIM(${salesHistory.village})) = ${farmer.village.trim().toLowerCase()}
            )
          )`,
          sql`(
            (${salesHistory.transferToBuyerName} IS NULL OR TRIM(${salesHistory.transferToBuyerName}) = '')
            OR ${salesHistory.isTransferReversed} = 1
          )`
        ));
      
      const selfDue = selfSalesData.reduce((sum, s) => sum + (s.dueAmount || 0), 0);
      
      // Merchant Due - comprises two components:
      // 1. Cold storage charges from regular sales (buyer owes cold storage, which comes to farmer)
      // 2. F2B transferred amounts (self-sale debt transferred to buyer)
      
      // Component 1: Cold storage charges from regular sales (NOT self-sales)
      // Match by farmerLedgerId (primary) or composite key (fallback for old records)
      const merchantSalesData = await db.select({
        coldStorageCharge: salesHistory.coldStorageCharge,
        paidAmount: salesHistory.paidAmount,
        paymentStatus: salesHistory.paymentStatus,
      })
        .from(salesHistory)
        .where(and(
          eq(salesHistory.coldStorageId, coldStorageId),
          sql`(${salesHistory.isSelfSale} IS NULL OR ${salesHistory.isSelfSale} != 1)`,
          sql`(
            (${salesHistory.farmerLedgerId} IS NOT NULL AND ${salesHistory.farmerLedgerId} = ${farmer.id})
            OR (
              ${salesHistory.farmerLedgerId} IS NULL
              AND LOWER(TRIM(${salesHistory.farmerName})) = ${farmer.name.trim().toLowerCase()}
              AND TRIM(${salesHistory.contactNumber}) = ${farmer.contactNumber.trim()}
              AND LOWER(TRIM(${salesHistory.village})) = ${farmer.village.trim().toLowerCase()}
            )
          )`,
          sql`${salesHistory.paymentStatus} IN ('due', 'partial')`
        ));
      
      const merchantSalesDue = merchantSalesData.reduce((sum, s) => {
        const charge = s.coldStorageCharge || 0;
        const paid = s.paidAmount || 0;
        return sum + Math.max(0, charge - paid);
      }, 0);
      
      // Component 2: F2B transferred amounts (self-sale debt now owed by buyer)
      // Get active (non-reversed) F2B transfers for this farmer
      const f2bTransfers = await db.select({
        selfSalesTransferred: farmerToBuyerTransfers.selfSalesTransferred,
      })
        .from(farmerToBuyerTransfers)
        .where(and(
          eq(farmerToBuyerTransfers.coldStorageId, coldStorageId),
          eq(farmerToBuyerTransfers.isReversed, 0),
          sql`LOWER(TRIM(${farmerToBuyerTransfers.farmerName})) = ${farmer.name.trim().toLowerCase()}`,
          sql`TRIM(${farmerToBuyerTransfers.contactNumber}) = ${farmer.contactNumber.trim()}`,
          sql`LOWER(TRIM(${farmerToBuyerTransfers.village})) = ${farmer.village.trim().toLowerCase()}`
        ));
      
      const f2bTransferredAmount = f2bTransfers.reduce((sum, t) => sum + (t.selfSalesTransferred || 0), 0);
      
      // Total merchant due = regular sales cold charges + F2B transferred amounts
      const merchantDue = merchantSalesDue + f2bTransferredAmount;

      // Advance & Freight dues - from farmerAdvanceFreight table
      const advFreightData = await db.select({
        type: farmerAdvanceFreight.type,
        finalAmount: farmerAdvanceFreight.finalAmount,
        paidAmount: farmerAdvanceFreight.paidAmount,
      })
        .from(farmerAdvanceFreight)
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, farmer.id),
          eq(farmerAdvanceFreight.isReversed, 0)
        ));

      const advanceDue = advFreightData
        .filter(r => r.type === 'advance')
        .reduce((sum, r) => sum + Math.max(0, (r.finalAmount || 0) - (r.paidAmount || 0)), 0);
      const freightDue = advFreightData
        .filter(r => r.type === 'freight')
        .reduce((sum, r) => sum + Math.max(0, (r.finalAmount || 0) - (r.paidAmount || 0)), 0);
      
      const totalDue = pyReceivables + selfDue + merchantDue + advanceDue + freightDue;
      
      return {
        ...farmer,
        pyReceivables: roundAmount(pyReceivables),
        selfDue: roundAmount(selfDue),
        merchantDue: roundAmount(merchantDue),
        advanceDue: roundAmount(advanceDue),
        freightDue: roundAmount(freightDue),
        totalDue: roundAmount(totalDue),
      };
    }));
    
    // Calculate summary
    const summary = {
      totalFarmers: farmersWithDues.filter(f => f.isArchived === 0).length,
      pyReceivables: roundAmount(farmersWithDues.reduce((sum, f) => sum + f.pyReceivables, 0)),
      selfDue: roundAmount(farmersWithDues.reduce((sum, f) => sum + f.selfDue, 0)),
      merchantDue: roundAmount(farmersWithDues.reduce((sum, f) => sum + f.merchantDue, 0)),
      advanceDue: roundAmount(farmersWithDues.reduce((sum, f) => sum + f.advanceDue, 0)),
      freightDue: roundAmount(farmersWithDues.reduce((sum, f) => sum + f.freightDue, 0)),
      totalDue: roundAmount(farmersWithDues.reduce((sum, f) => sum + f.totalDue, 0)),
    };
    
    return { farmers: farmersWithDues, summary };
  }

  // Check if an edit would result in a merge
  async checkPotentialMerge(id: string, updates: Partial<FarmerLedgerEntry>): Promise<{
    willMerge: boolean;
    targetFarmer?: FarmerLedgerEntry;
    lotsCount: number;
    receivablesCount: number;
    salesCount: number;
    totalDues: number;
  }> {
    const [farmer] = await db.select()
      .from(farmerLedger)
      .where(eq(farmerLedger.id, id));
    
    if (!farmer) {
      return { willMerge: false, lotsCount: 0, receivablesCount: 0, salesCount: 0, totalDues: 0 };
    }
    
    const newName = updates.name || farmer.name;
    const newContact = updates.contactNumber || farmer.contactNumber;
    const newVillage = updates.village || farmer.village;
    const newKey = this.getFarmerCompositeKey(newName, newContact, newVillage);
    const oldKey = this.getFarmerCompositeKey(farmer.name, farmer.contactNumber, farmer.village);
    
    if (newKey === oldKey) {
      return { willMerge: false, lotsCount: 0, receivablesCount: 0, salesCount: 0, totalDues: 0 };
    }
    
    const existing = await db.select()
      .from(farmerLedger)
      .where(and(
        eq(farmerLedger.coldStorageId, farmer.coldStorageId),
        sql`LOWER(TRIM(${farmerLedger.name})) = ${newName.trim().toLowerCase()}`,
        sql`TRIM(${farmerLedger.contactNumber}) = ${newContact.trim()}`,
        sql`LOWER(TRIM(${farmerLedger.village})) = ${newVillage.trim().toLowerCase()}`,
        sql`${farmerLedger.id} != ${id}`
      ));
    
    if (existing.length === 0) {
      return { willMerge: false, lotsCount: 0, receivablesCount: 0, salesCount: 0, totalDues: 0 };
    }
    
    const existingFarmer = existing[0];
    
    // Determine which one will be merged (higher farmerId gets merged into lower)
    const mergedId = farmer.farmerId < existingFarmer.farmerId ? existingFarmer.id : farmer.id;
    const targetFarmer = farmer.farmerId < existingFarmer.farmerId ? farmer : existingFarmer;
    
    // Count records and dues from the farmer that will be merged
    const mergedLots = await db.select()
      .from(lots)
      .where(eq(lots.farmerLedgerId, mergedId));
    
    const mergedReceivables = await db.select()
      .from(openingReceivables)
      .where(eq(openingReceivables.farmerLedgerId, mergedId));
    
    const mergedSales = await db.select()
      .from(salesHistory)
      .where(eq(salesHistory.farmerLedgerId, mergedId));
    
    let totalDues = 0;
    for (const lot of mergedLots) {
      totalDues += lot.totalDueCharge || 0;
    }
    for (const rec of mergedReceivables) {
      totalDues += rec.dueAmount || 0;
    }
    for (const sale of mergedSales) {
      if (sale.isSelfSale) {
        totalDues += sale.dueAmount || 0;
      }
    }
    
    return {
      willMerge: true,
      targetFarmer,
      lotsCount: mergedLots.length,
      receivablesCount: mergedReceivables.length,
      salesCount: mergedSales.length,
      totalDues,
    };
  }

  // Update farmer in ledger with merge handling
  async updateFarmerLedger(
    id: string,
    updates: Partial<FarmerLedgerEntry>,
    modifiedBy: string,
    confirmMerge: boolean = false
  ): Promise<{ farmer: FarmerLedgerEntry | undefined; merged: boolean; mergedFromId?: string; needsConfirmation?: boolean }> {
    // Get the farmer being updated
    const [farmer] = await db.select()
      .from(farmerLedger)
      .where(eq(farmerLedger.id, id));
    
    if (!farmer) {
      return { farmer: undefined, merged: false };
    }
    
    // Calculate the new composite key
    const newName = updates.name || farmer.name;
    const newContact = updates.contactNumber || farmer.contactNumber;
    const newVillage = updates.village || farmer.village;
    const newKey = this.getFarmerCompositeKey(newName, newContact, newVillage);
    const oldKey = this.getFarmerCompositeKey(farmer.name, farmer.contactNumber, farmer.village);
    
    // Check if edit would cause a duplicate
    if (newKey !== oldKey) {
      const existing = await db.select()
        .from(farmerLedger)
        .where(and(
          eq(farmerLedger.coldStorageId, farmer.coldStorageId),
          sql`LOWER(TRIM(${farmerLedger.name})) = ${newName.trim().toLowerCase()}`,
          sql`TRIM(${farmerLedger.contactNumber}) = ${newContact.trim()}`,
          sql`LOWER(TRIM(${farmerLedger.village})) = ${newVillage.trim().toLowerCase()}`,
          sql`${farmerLedger.id} != ${id}`
        ));
      
      if (existing.length > 0) {
        // Merge would be needed - check if user confirmed
        if (!confirmMerge) {
          // Return that confirmation is needed - don't proceed with merge
          return { farmer: undefined, merged: false, needsConfirmation: true };
        }
        
        // Merge confirmed - merge this farmer into the existing one with lower ID
        const existingFarmer = existing[0];
        
        // Determine which one survives (lower farmerId number)
        const survivorFarmerId = farmer.farmerId < existingFarmer.farmerId ? farmer.farmerId : existingFarmer.farmerId;
        const mergedFarmerId = farmer.farmerId < existingFarmer.farmerId ? existingFarmer.farmerId : farmer.farmerId;
        const survivorId = farmer.farmerId < existingFarmer.farmerId ? farmer.id : existingFarmer.id;
        const mergedId = farmer.farmerId < existingFarmer.farmerId ? existingFarmer.id : farmer.id;
        const survivorFarmerEntry = farmer.farmerId < existingFarmer.farmerId ? farmer : existingFarmer;
        const mergedFarmerEntry = farmer.farmerId < existingFarmer.farmerId ? existingFarmer : farmer;
        
        // Count records being transferred and calculate dues
        const mergedLots = await db.select()
          .from(lots)
          .where(eq(lots.farmerLedgerId, mergedId));
        
        const mergedReceivables = await db.select()
          .from(openingReceivables)
          .where(eq(openingReceivables.farmerLedgerId, mergedId));
        
        const mergedSales = await db.select()
          .from(salesHistory)
          .where(eq(salesHistory.farmerLedgerId, mergedId));
        
        // Calculate total dues being transferred
        let totalDuesTransferred = 0;
        for (const lot of mergedLots) {
          totalDuesTransferred += lot.totalDueCharge || 0;
        }
        for (const rec of mergedReceivables) {
          totalDuesTransferred += rec.dueAmount || 0;
        }
        for (const sale of mergedSales) {
          if (sale.isSelfSale) {
            totalDuesTransferred += sale.dueAmount || 0;
          }
        }
        
        // Transfer lots from merged farmer to survivor
        if (mergedLots.length > 0) {
          await db.update(lots)
            .set({ 
              farmerLedgerId: survivorId,
              farmerName: survivorFarmerEntry.name,
              contactNumber: survivorFarmerEntry.contactNumber,
              village: survivorFarmerEntry.village,
            })
            .where(eq(lots.farmerLedgerId, mergedId));
        }
        
        // Transfer receivables from merged farmer to survivor
        if (mergedReceivables.length > 0) {
          await db.update(openingReceivables)
            .set({ 
              farmerLedgerId: survivorId,
              farmerName: survivorFarmerEntry.name,
              contactNumber: survivorFarmerEntry.contactNumber,
              village: survivorFarmerEntry.village,
            })
            .where(eq(openingReceivables.farmerLedgerId, mergedId));
        }
        
        // Transfer sales from merged farmer to survivor
        if (mergedSales.length > 0) {
          await db.update(salesHistory)
            .set({ 
              farmerLedgerId: survivorId,
              farmerName: survivorFarmerEntry.name,
              contactNumber: survivorFarmerEntry.contactNumber,
              village: survivorFarmerEntry.village,
            })
            .where(eq(salesHistory.farmerLedgerId, mergedId));
        }
        
        // Archive the merged farmer
        await db.update(farmerLedger)
          .set({
            isArchived: 1,
            archivedAt: new Date(),
          })
          .where(eq(farmerLedger.id, mergedId));
        
        // Update the survivor with any additional details from merged farmer
        const survivorUpdates: Partial<FarmerLedgerEntry> = {};
        if (!survivorFarmerEntry.tehsil && mergedFarmerEntry.tehsil) survivorUpdates.tehsil = mergedFarmerEntry.tehsil;
        if (!survivorFarmerEntry.district && mergedFarmerEntry.district) survivorUpdates.district = mergedFarmerEntry.district;
        if (!survivorFarmerEntry.state && mergedFarmerEntry.state) survivorUpdates.state = mergedFarmerEntry.state;
        
        if (Object.keys(survivorUpdates).length > 0) {
          await db.update(farmerLedger)
            .set(survivorUpdates)
            .where(eq(farmerLedger.id, survivorId));
        }
        
        // Record the merge in edit history with detailed info
        const totalRecordsTransferred = mergedLots.length + mergedReceivables.length + mergedSales.length;
        await db.insert(farmerLedgerEditHistory).values({
          id: randomUUID(),
          farmerLedgerId: survivorId,
          coldStorageId: farmer.coldStorageId,
          editType: 'merge',
          mergedFromId: mergedId,
          mergedFromFarmerId: mergedFarmerId,
          aggregatedRecords: totalRecordsTransferred,
          mergedLotsCount: mergedLots.length,
          mergedReceivablesCount: mergedReceivables.length,
          mergedSalesCount: mergedSales.length,
          mergedTotalDues: totalDuesTransferred.toFixed(2),
          modifiedBy,
        });
        
        const [updatedFarmer] = await db.select()
          .from(farmerLedger)
          .where(eq(farmerLedger.id, survivorId));
        
        return { farmer: updatedFarmer, merged: true, mergedFromId: mergedFarmerId };
      }
    }
    
    // No merge needed - regular update
    const beforeValues = JSON.stringify({
      name: farmer.name,
      contactNumber: farmer.contactNumber,
      village: farmer.village,
      tehsil: farmer.tehsil,
      district: farmer.district,
      state: farmer.state,
    });
    
    const [updatedFarmer] = await db.update(farmerLedger)
      .set(updates)
      .where(eq(farmerLedger.id, id))
      .returning();
    
    const afterValues = JSON.stringify({
      name: updatedFarmer.name,
      contactNumber: updatedFarmer.contactNumber,
      village: updatedFarmer.village,
      tehsil: updatedFarmer.tehsil,
      district: updatedFarmer.district,
      state: updatedFarmer.state,
    });
    
    // Only record the edit in history if there are actual changes
    if (beforeValues !== afterValues) {
      await db.insert(farmerLedgerEditHistory).values({
        id: randomUUID(),
        farmerLedgerId: id,
        coldStorageId: farmer.coldStorageId,
        editType: 'edit',
        beforeValues,
        afterValues,
        modifiedBy,
      });
      
      // Propagate farmer details to all linked touchpoints (lots, receivables, sales)
      await this.propagateFarmerDetailsToTouchpoints(id, updatedFarmer);
    }
    
    return { farmer: updatedFarmer, merged: false };
  }
  
  // Propagate farmer details from farmer_ledger to all linked touchpoints
  private async propagateFarmerDetailsToTouchpoints(
    farmerLedgerId: string,
    farmer: FarmerLedgerEntry
  ): Promise<void> {
    const farmerDetails = {
      farmerName: farmer.name,
      contactNumber: farmer.contactNumber,
      village: farmer.village,
      tehsil: farmer.tehsil || '',
      district: farmer.district || '',
      state: farmer.state || '',
    };
    
    // Update all linked lots
    await db.update(lots)
      .set(farmerDetails)
      .where(eq(lots.farmerLedgerId, farmerLedgerId));
    
    // Update all linked opening receivables (farmer receivables)
    await db.update(openingReceivables)
      .set({
        farmerName: farmer.name,
        contactNumber: farmer.contactNumber,
        village: farmer.village,
        tehsil: farmer.tehsil || '',
        district: farmer.district || '',
        state: farmer.state || '',
      })
      .where(eq(openingReceivables.farmerLedgerId, farmerLedgerId));
    
    // Update all linked sales history
    await db.update(salesHistory)
      .set(farmerDetails)
      .where(eq(salesHistory.farmerLedgerId, farmerLedgerId));
  }

  // Archive a farmer
  async archiveFarmerLedger(id: string, modifiedBy: string): Promise<boolean> {
    const [farmer] = await db.update(farmerLedger)
      .set({
        isArchived: 1,
        archivedAt: new Date(),
      })
      .where(eq(farmerLedger.id, id))
      .returning();
    
    if (farmer) {
      await db.insert(farmerLedgerEditHistory).values({
        id: randomUUID(),
        farmerLedgerId: id,
        coldStorageId: farmer.coldStorageId,
        editType: 'edit',
        beforeValues: JSON.stringify({ isArchived: 0 }),
        afterValues: JSON.stringify({ isArchived: 1 }),
        modifiedBy,
      });
    }
    
    return !!farmer;
  }

  // Reinstate an archived farmer
  async reinstateFarmerLedger(id: string, modifiedBy: string): Promise<boolean> {
    const [farmer] = await db.update(farmerLedger)
      .set({
        isArchived: 0,
        archivedAt: null,
      })
      .where(eq(farmerLedger.id, id))
      .returning();
    
    if (farmer) {
      await db.insert(farmerLedgerEditHistory).values({
        id: randomUUID(),
        farmerLedgerId: id,
        coldStorageId: farmer.coldStorageId,
        editType: 'edit',
        beforeValues: JSON.stringify({ isArchived: 1 }),
        afterValues: JSON.stringify({ isArchived: 0 }),
        modifiedBy,
      });
    }
    
    return !!farmer;
  }

  // Toggle farmer flag
  async toggleFarmerFlag(id: string, modifiedBy: string): Promise<FarmerLedgerEntry | undefined> {
    const [farmer] = await db.select()
      .from(farmerLedger)
      .where(eq(farmerLedger.id, id));
    
    if (!farmer) return undefined;
    
    const newFlagValue = farmer.isFlagged === 1 ? 0 : 1;
    
    const [updated] = await db.update(farmerLedger)
      .set({ isFlagged: newFlagValue })
      .where(eq(farmerLedger.id, id))
      .returning();
    
    await db.insert(farmerLedgerEditHistory).values({
      id: randomUUID(),
      farmerLedgerId: id,
      coldStorageId: farmer.coldStorageId,
      editType: 'edit',
      beforeValues: JSON.stringify({ isFlagged: farmer.isFlagged }),
      afterValues: JSON.stringify({ isFlagged: newFlagValue }),
      modifiedBy,
    });
    
    return updated;
  }

  // Get edit history for a farmer
  async getFarmerLedgerEditHistory(farmerLedgerId: string): Promise<FarmerLedgerEditHistoryEntry[]> {
    return await db.select()
      .from(farmerLedgerEditHistory)
      .where(eq(farmerLedgerEditHistory.farmerLedgerId, farmerLedgerId))
      .orderBy(desc(farmerLedgerEditHistory.modifiedAt));
  }

  // ==================== BUYER LEDGER METHODS ====================

  // Helper to get buyer name normalized key (just name, case-insensitive, trimmed)
  private getBuyerCompositeKey(buyerName: string): string {
    return buyerName.trim().toLowerCase();
  }

  // Generate unique buyer ID: BYYYYYMMDD1, BYYYYYMMDD2, etc.
  async generateBuyerId(coldStorageId: string): Promise<string> {
    const today = new Date();
    const datePrefix = `BY${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    
    // Get the count of buyers created today in this cold storage
    const existingBuyers = await db.select()
      .from(buyerLedger)
      .where(and(
        eq(buyerLedger.coldStorageId, coldStorageId),
        sql`${buyerLedger.buyerId} LIKE ${datePrefix + '%'}`
      ));
    
    // Find the highest sequence number used today
    let maxSeq = 0;
    for (const buyer of existingBuyers) {
      const seq = parseInt(buyer.buyerId.substring(datePrefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
    
    return `${datePrefix}${maxSeq + 1}`;
  }

  // Get buyer ledger with calculated dues
  async getBuyerLedger(coldStorageId: string, includeArchived: boolean = false): Promise<{
    buyers: (BuyerLedgerEntry & {
      pyReceivables: number;
      dueTransferOut: number;
      dueTransferIn: number;
      salesDue: number;
      buyerExtras: number;
      netDue: number;
    })[];
    summary: {
      totalBuyers: number;
      pyReceivables: number;
      dueTransferOut: number;
      dueTransferIn: number;
      salesDue: number;
      buyerExtras: number;
      netDue: number;
    };
  }> {
    // Get all buyers
    let buyersQuery = db.select().from(buyerLedger)
      .where(eq(buyerLedger.coldStorageId, coldStorageId));
    
    if (!includeArchived) {
      buyersQuery = db.select().from(buyerLedger)
        .where(and(
          eq(buyerLedger.coldStorageId, coldStorageId),
          eq(buyerLedger.isArchived, 0)
        ));
    }
    
    const buyers = await buyersQuery;
    
    // Get buyer receivables from openingReceivables where payerType is 'cold_merchant'
    const buyerReceivables = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.payerType, 'cold_merchant')
      ));
    
    // Get sales history to calculate sales dues (non-self-sales without active transfers)
    const allSales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        eq(salesHistory.isSelfSale, 0)
      ));
    
    // Get all sales with active transfers (for tracking transfer amounts)
    // This includes both regular and self-sale transfers
    const allTransferredSales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        sql`${salesHistory.transferToBuyerName} IS NOT NULL AND TRIM(${salesHistory.transferToBuyerName}) != ''`,
        sql`(${salesHistory.isTransferReversed} IS NULL OR ${salesHistory.isTransferReversed} = 0)`
      ));
    
    // Get farmer to buyer transfers (transfers IN = dues from farmers transferred to this buyer)
    const transfersIn = await db.select()
      .from(farmerToBuyerTransfers)
      .where(and(
        eq(farmerToBuyerTransfers.coldStorageId, coldStorageId),
        eq(farmerToBuyerTransfers.isReversed, 0)
      ));
    
    // Calculate dues for each buyer
    const buyersWithDues = buyers.map(buyer => {
      const buyerNameLower = buyer.buyerName.trim().toLowerCase();
      
      // Helper: Match by buyerLedgerId (primary) or buyerName (fallback for old records)
      const matchesBuyer = (record: { buyerLedgerId?: string | null; buyerName?: string | null }) => {
        // Primary: Match by ledger ID if both have it
        if (record.buyerLedgerId && buyer.id) {
          return record.buyerLedgerId === buyer.id;
        }
        // Fallback: Match by name (for old records without ledger ID)
        return record.buyerName?.trim().toLowerCase() === buyerNameLower;
      };
      
      // PY Receivables: Sum of opening receivables for this buyer
      // For cold_merchant type, the buyer name is stored in buyerName field
      const pyReceivables = buyerReceivables
        .filter(r => matchesBuyer(r))
        .reduce((sum, r) => sum + (r.dueAmount - (r.paidAmount || 0)), 0);
      
      // Sales Due: Sum of unpaid NON-TRANSFERRED sales to this buyer
      // Transferred sales are tracked separately in Transfer In
      const buyerSales = allSales
        .filter(s => {
          const hasActiveTransfer = s.transferToBuyerName && s.transferToBuyerName.trim() && (s.isTransferReversed === 0 || s.isTransferReversed === null);
          // Only include if this matches the buyer AND no active transfer
          return matchesBuyer(s) && !hasActiveTransfer;
        });
      
      // dueAmount already represents the remaining unpaid amount (updated when payments are made)
      const salesDue = buyerSales.reduce((sum, s) => sum + (s.dueAmount || 0), 0);
      
      // Buyer Extras: Sum of hammali, grading, and other extras to merchant from sales
      const buyerExtras = buyerSales.reduce((sum, s) => {
        return sum + (s.extraDueHammaliMerchant || 0) + (s.extraDueGradingMerchant || 0) + (s.extraDueOtherMerchant || 0);
      }, 0);
      
      // Transfer In from farmer-to-buyer transfers (separate table)
      const farmerTransferIn = transfersIn
        .filter(t => t.toBuyerName.trim().toLowerCase() === buyerNameLower)
        .reduce((sum, t) => sum + t.totalAmount, 0);
      
      // Transfer In from buyer-to-buyer transfers (salesHistory with transferToBuyerName)
      // Positive: When this buyer is the recipient (transferToBuyerName matches)
      // dueAmount already represents the remaining unpaid amount (updated when payments are made)
      const buyerTransferIn = allTransferredSales
        .filter(s => s.transferToBuyerName!.trim().toLowerCase() === buyerNameLower)
        .reduce((sum, s) => sum + (s.dueAmount || 0), 0);
      
      // Transfer Out: When this buyer is the source (buyerName/buyerLedgerId matches, and isSelfSale=0)
      // dueAmount already represents the remaining unpaid amount
      const buyerTransferOut = allTransferredSales
        .filter(s => matchesBuyer(s) && s.isSelfSale === 0)
        .reduce((sum, s) => sum + (s.dueAmount || 0), 0);
      
      // dueTransferIn = Net of all transfers (positive for received, negative for sent out)
      // For display: shows transfer activity from this buyer's perspective
      const dueTransferIn = farmerTransferIn + buyerTransferIn - buyerTransferOut;
      
      // dueTransferOut is 0 since transfer-out is embedded in dueTransferIn as negative
      const dueTransferOut = 0;
      
      // Net Due = PY Receivables + Sales Due + Buyer Extras + Farmer Transfers + Buyer Transfers Received
      // Source buyer's transfer-out does NOT add to their liability (they don't owe it)
      // Destination buyer's transfer-in IS their liability
      const netDue = roundAmount(pyReceivables + salesDue + buyerExtras + farmerTransferIn + buyerTransferIn);
      
      return {
        ...buyer,
        pyReceivables: roundAmount(pyReceivables),
        dueTransferOut: roundAmount(dueTransferOut),
        dueTransferIn: roundAmount(dueTransferIn),
        salesDue: roundAmount(salesDue),
        buyerExtras: roundAmount(buyerExtras),
        netDue,
      };
    });
    
    // Calculate summary
    const summary = {
      totalBuyers: buyersWithDues.length,
      pyReceivables: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.pyReceivables, 0)),
      dueTransferOut: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.dueTransferOut, 0)),
      dueTransferIn: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.dueTransferIn, 0)),
      salesDue: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.salesDue, 0)),
      buyerExtras: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.buyerExtras, 0)),
      netDue: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.netDue, 0)),
    };
    
    return { buyers: buyersWithDues, summary };
  }

  // Sync buyers from touchpoints (sales history, opening receivables)
  async syncBuyersFromTouchpoints(coldStorageId: string): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;
    
    // Get existing buyers
    const existingBuyers = await db.select()
      .from(buyerLedger)
      .where(eq(buyerLedger.coldStorageId, coldStorageId));
    
    const existingKeys = new Map<string, BuyerLedgerEntry>();
    for (const b of existingBuyers) {
      const key = this.getBuyerCompositeKey(b.buyerName);
      existingKeys.set(key, b);
    }
    
    // Collect unique buyer names from touchpoints
    const buyerNames = new Set<string>();
    
    // From sales history (buyerName field)
    const allSales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        eq(salesHistory.isSelfSale, 0)
      ));
    
    for (const sale of allSales) {
      if (sale.buyerName && sale.buyerName.trim()) {
        buyerNames.add(sale.buyerName.trim());
      }
    }
    
    // From opening receivables where payerType is 'cold_merchant'
    const merchantReceivables = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.payerType, 'cold_merchant')
      ));
    
    for (const rec of merchantReceivables) {
      // cold_merchant receivables store buyer name in buyerName field, not farmerName
      if (rec.buyerName && rec.buyerName.trim()) {
        buyerNames.add(rec.buyerName.trim());
      }
    }
    
    // From farmer to buyer transfers (toBuyerName)
    const transfers = await db.select()
      .from(farmerToBuyerTransfers)
      .where(eq(farmerToBuyerTransfers.coldStorageId, coldStorageId));
    
    for (const transfer of transfers) {
      if (transfer.toBuyerName && transfer.toBuyerName.trim()) {
        buyerNames.add(transfer.toBuyerName.trim());
      }
    }
    
    // Create buyer ledger entries for new buyers
    for (const buyerName of Array.from(buyerNames)) {
      const key = this.getBuyerCompositeKey(buyerName);
      
      if (!existingKeys.has(key)) {
        // New buyer - create entry
        const buyerId = await this.generateBuyerId(coldStorageId);
        const newId = randomUUID();
        
        await db.insert(buyerLedger).values({
          id: newId,
          coldStorageId,
          buyerId,
          buyerName: buyerName.trim(),
          isFlagged: 0,
          isArchived: 0,
        });
        
        // Add to existingKeys so backfill can find it
        existingKeys.set(key, {
          id: newId,
          coldStorageId,
          buyerId,
          buyerName: buyerName.trim(),
          address: null,
          contactNumber: null,
          isFlagged: 0,
          isArchived: 0,
          createdAt: new Date(),
          archivedAt: null,
        });
        
        added++;
      }
    }
    
    // Backfill buyerLedgerId/buyerId on cold_merchant receivables missing these fields
    for (const rec of merchantReceivables) {
      if (!rec.buyerLedgerId && rec.buyerName && rec.buyerName.trim()) {
        const key = this.getBuyerCompositeKey(rec.buyerName);
        const buyerEntry = existingKeys.get(key);
        
        if (buyerEntry) {
          await db.update(openingReceivables)
            .set({
              buyerLedgerId: buyerEntry.id,
              buyerId: buyerEntry.buyerId,
            })
            .where(eq(openingReceivables.id, rec.id));
          updated++;
        }
      }
    }
    
    return { added, updated };
  }

  // Check potential merge before updating buyer
  async checkBuyerPotentialMerge(id: string, updates: Partial<BuyerLedgerEntry>): Promise<{
    willMerge: boolean;
    targetBuyer?: BuyerLedgerEntry;
    salesCount: number;
    transfersCount: number;
    totalDues: number;
  }> {
    const [currentBuyer] = await db.select()
      .from(buyerLedger)
      .where(eq(buyerLedger.id, id));
    
    if (!currentBuyer) {
      return { willMerge: false, salesCount: 0, transfersCount: 0, totalDues: 0 };
    }
    
    const newName = updates.buyerName || currentBuyer.buyerName;
    const newKey = this.getBuyerCompositeKey(newName);
    const currentKey = this.getBuyerCompositeKey(currentBuyer.buyerName);
    
    // Check if new key matches a different buyer
    if (newKey !== currentKey) {
      const [existingBuyer] = await db.select()
        .from(buyerLedger)
        .where(and(
          eq(buyerLedger.coldStorageId, currentBuyer.coldStorageId),
          sql`LOWER(TRIM(${buyerLedger.buyerName})) = ${newName.trim().toLowerCase()}`,
          sql`${buyerLedger.id} != ${id}`
        ));
      
      if (existingBuyer) {
        // Count records that would be merged
        const buyerNameLower = currentBuyer.buyerName.trim().toLowerCase();
        
        const salesCount = await db.select({ count: sql<number>`count(*)::int` })
          .from(salesHistory)
          .where(and(
            eq(salesHistory.coldStorageId, currentBuyer.coldStorageId),
            sql`LOWER(TRIM(${salesHistory.buyerName})) = ${buyerNameLower}`
          ));
        
        const transfersCount = await db.select({ count: sql<number>`count(*)::int` })
          .from(farmerToBuyerTransfers)
          .where(and(
            eq(farmerToBuyerTransfers.coldStorageId, currentBuyer.coldStorageId),
            sql`LOWER(TRIM(${farmerToBuyerTransfers.toBuyerName})) = ${buyerNameLower}`
          ));
        
        // Get dues for the current buyer
        const ledgerData = await this.getBuyerLedger(currentBuyer.coldStorageId, true);
        const currentBuyerData = ledgerData.buyers.find(b => b.id === id);
        const totalDues = currentBuyerData?.netDue || 0;
        
        return {
          willMerge: true,
          targetBuyer: existingBuyer,
          salesCount: salesCount[0]?.count || 0,
          transfersCount: transfersCount[0]?.count || 0,
          totalDues,
        };
      }
    }
    
    return { willMerge: false, salesCount: 0, transfersCount: 0, totalDues: 0 };
  }

  // Update buyer ledger entry with potential merge
  async updateBuyerLedger(id: string, updates: Partial<BuyerLedgerEntry>, modifiedBy: string, confirmMerge: boolean = false): Promise<{
    buyer: BuyerLedgerEntry | undefined;
    merged: boolean;
    mergedFromId?: string;
    needsConfirmation?: boolean;
  }> {
    const [currentBuyer] = await db.select()
      .from(buyerLedger)
      .where(eq(buyerLedger.id, id));
    
    if (!currentBuyer) {
      return { buyer: undefined, merged: false };
    }
    
    const mergeCheck = await this.checkBuyerPotentialMerge(id, updates);
    
    if (mergeCheck.willMerge) {
      if (!confirmMerge) {
        return { buyer: undefined, merged: false, needsConfirmation: true };
      }
      
      // Perform merge - transfer all records to target buyer and archive current
      const targetBuyer = mergeCheck.targetBuyer!;
      const buyerNameLower = currentBuyer.buyerName.trim().toLowerCase();
      
      // Update sales history to new buyer name
      await db.update(salesHistory)
        .set({ buyerName: targetBuyer.buyerName })
        .where(and(
          eq(salesHistory.coldStorageId, currentBuyer.coldStorageId),
          sql`LOWER(TRIM(${salesHistory.buyerName})) = ${buyerNameLower}`
        ));
      
      // Update farmer to buyer transfers
      await db.update(farmerToBuyerTransfers)
        .set({ toBuyerName: targetBuyer.buyerName })
        .where(and(
          eq(farmerToBuyerTransfers.coldStorageId, currentBuyer.coldStorageId),
          sql`LOWER(TRIM(${farmerToBuyerTransfers.toBuyerName})) = ${buyerNameLower}`
        ));
      
      // Archive the current buyer
      await db.update(buyerLedger)
        .set({
          isArchived: 1,
          archivedAt: new Date(),
        })
        .where(eq(buyerLedger.id, id));
      
      // Record merge history
      await db.insert(buyerLedgerEditHistory).values({
        id: randomUUID(),
        buyerLedgerId: targetBuyer.id,
        coldStorageId: currentBuyer.coldStorageId,
        editType: 'merge',
        mergedFromId: id,
        mergedFromBuyerId: currentBuyer.buyerId,
        mergedSalesCount: mergeCheck.salesCount,
        mergedTransfersCount: mergeCheck.transfersCount,
        mergedTotalDues: String(mergeCheck.totalDues),
        modifiedBy,
      });
      
      return { buyer: targetBuyer, merged: true, mergedFromId: currentBuyer.buyerId };
    }
    
    // Regular update (no merge)
    const beforeValues = JSON.stringify({
      buyerName: currentBuyer.buyerName,
      address: currentBuyer.address,
      contactNumber: currentBuyer.contactNumber,
    });
    
    const [updated] = await db.update(buyerLedger)
      .set({
        buyerName: updates.buyerName?.trim() || currentBuyer.buyerName,
        address: updates.address?.trim() || currentBuyer.address,
        contactNumber: updates.contactNumber?.trim() || currentBuyer.contactNumber,
      })
      .where(eq(buyerLedger.id, id))
      .returning();
    
    const afterValues = JSON.stringify({
      buyerName: updated.buyerName,
      address: updated.address,
      contactNumber: updated.contactNumber,
    });
    
    // Only create edit history entry if there are actual changes
    if (beforeValues !== afterValues) {
      await db.insert(buyerLedgerEditHistory).values({
        id: randomUUID(),
        buyerLedgerId: id,
        coldStorageId: currentBuyer.coldStorageId,
        editType: 'edit',
        beforeValues,
        afterValues,
        modifiedBy,
      });
    }
    
    return { buyer: updated, merged: false };
  }

  // Archive a buyer
  async archiveBuyerLedger(id: string, modifiedBy: string): Promise<boolean> {
    const [buyer] = await db.update(buyerLedger)
      .set({
        isArchived: 1,
        archivedAt: new Date(),
      })
      .where(eq(buyerLedger.id, id))
      .returning();
    
    if (buyer) {
      await db.insert(buyerLedgerEditHistory).values({
        id: randomUUID(),
        buyerLedgerId: id,
        coldStorageId: buyer.coldStorageId,
        editType: 'edit',
        beforeValues: JSON.stringify({ isArchived: 0 }),
        afterValues: JSON.stringify({ isArchived: 1 }),
        modifiedBy,
      });
    }
    
    return !!buyer;
  }

  // Reinstate an archived buyer
  async reinstateBuyerLedger(id: string, modifiedBy: string): Promise<boolean> {
    const [buyer] = await db.update(buyerLedger)
      .set({
        isArchived: 0,
        archivedAt: null,
      })
      .where(eq(buyerLedger.id, id))
      .returning();
    
    if (buyer) {
      await db.insert(buyerLedgerEditHistory).values({
        id: randomUUID(),
        buyerLedgerId: id,
        coldStorageId: buyer.coldStorageId,
        editType: 'edit',
        beforeValues: JSON.stringify({ isArchived: 1 }),
        afterValues: JSON.stringify({ isArchived: 0 }),
        modifiedBy,
      });
    }
    
    return !!buyer;
  }

  // Toggle buyer flag
  async toggleBuyerFlag(id: string, modifiedBy: string): Promise<BuyerLedgerEntry | undefined> {
    const [buyer] = await db.select()
      .from(buyerLedger)
      .where(eq(buyerLedger.id, id));
    
    if (!buyer) return undefined;
    
    const newFlagValue = buyer.isFlagged === 1 ? 0 : 1;
    
    const [updated] = await db.update(buyerLedger)
      .set({ isFlagged: newFlagValue })
      .where(eq(buyerLedger.id, id))
      .returning();
    
    await db.insert(buyerLedgerEditHistory).values({
      id: randomUUID(),
      buyerLedgerId: id,
      coldStorageId: buyer.coldStorageId,
      editType: 'edit',
      beforeValues: JSON.stringify({ isFlagged: buyer.isFlagged }),
      afterValues: JSON.stringify({ isFlagged: newFlagValue }),
      modifiedBy,
    });
    
    return updated;
  }

  // Get edit history for a buyer
  async getBuyerLedgerEditHistory(buyerLedgerId: string): Promise<BuyerLedgerEditHistoryEntry[]> {
    return await db.select()
      .from(buyerLedgerEditHistory)
      .where(eq(buyerLedgerEditHistory.buyerLedgerId, buyerLedgerId))
      .orderBy(desc(buyerLedgerEditHistory.modifiedAt));
  }

  // Ensure buyer ledger entry exists - find by name or create new
  async ensureBuyerLedgerEntry(coldStorageId: string, buyerData: {
    buyerName: string;
    address?: string;
    contactNumber?: string;
  }): Promise<{ id: string; buyerId: string }> {
    const key = this.getBuyerCompositeKey(buyerData.buyerName);
    
    // Check if buyer already exists with this name
    const [existingBuyer] = await db.select()
      .from(buyerLedger)
      .where(and(
        eq(buyerLedger.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${buyerLedger.buyerName})) = ${buyerData.buyerName.trim().toLowerCase()}`
      ));
    
    if (existingBuyer) {
      // Buyer exists - optionally update missing fields
      const updates: Partial<BuyerLedgerEntry> = {};
      
      if (!existingBuyer.address && buyerData.address) updates.address = buyerData.address.trim();
      if (!existingBuyer.contactNumber && buyerData.contactNumber) updates.contactNumber = buyerData.contactNumber.trim();
      
      if (Object.keys(updates).length > 0) {
        await db.update(buyerLedger)
          .set(updates)
          .where(eq(buyerLedger.id, existingBuyer.id));
      }
      
      return { id: existingBuyer.id, buyerId: existingBuyer.buyerId };
    }
    
    // Create new buyer ledger entry with retry logic for unique constraint violations
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const buyerId = await this.generateBuyerId(coldStorageId);
      const newId = randomUUID();
      
      try {
        await db.insert(buyerLedger).values({
          id: newId,
          coldStorageId,
          buyerId,
          buyerName: buyerData.buyerName.trim(),
          address: buyerData.address?.trim() || null,
          contactNumber: buyerData.contactNumber?.trim() || null,
          isFlagged: 0,
          isArchived: 0,
        });
        
        return { id: newId, buyerId };
      } catch (error: any) {
        // Check if it's a unique constraint violation
        if (error?.code === '23505' && (error?.constraint?.includes('buyer_id') || error?.constraint?.includes('cs_bid'))) {
          console.log(`Buyer ID collision detected (attempt ${attempt + 1}/${maxRetries}), retrying...`);
          continue;
        }
        throw error;
      }
    }
    
    throw new Error('Failed to generate unique buyer ID after multiple attempts');
  }
}

export const storage = new DatabaseStorage();
