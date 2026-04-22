import { randomUUID } from "crypto";
import { eq, and, or, like, ilike, desc, asc, sql, gte, lte, inArray, isNull, type SQL } from "drizzle-orm";
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
  cashReceiptApplications,
  expenses,
  cashTransfers,
  cashOpeningBalances,
  openingReceivables,
  openingPayables,
  dailyIdCounters,
  discounts,
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
  type SalesHistoryWithLastPayment,
  type InsertSalesHistory,
  type SaleEditHistory,
  type InsertSaleEditHistory,
  type MaintenanceRecord,
  type InsertMaintenanceRecord,
  type ExitHistory,
  type InsertExitHistory,
  type CashReceipt,
  type InsertCashReceipt,
  type CashReceiptApplication,
  type SalePayment,
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
  type BankAccount,
  type InsertBankAccount,
  farmerAdvanceFreight,
  type FarmerAdvanceFreight,
  type InsertFarmerAdvanceFreight,
  merchantAdvance,
  merchantAdvanceEvents,
  type MerchantAdvance,
  type InsertMerchantAdvance,
  farmerLoan,
  farmerLoanEvents,
  type FarmerLoan,
  type FarmerLoanEvent,
  type InsertFarmerLoan,
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
  assets,
  assetDepreciationLog,
  liabilities,
  liabilityPayments,
  type Asset,
  type InsertAsset,
  type AssetDepreciationLog,
  type InsertAssetDepreciationLog,
  type Liability,
  type InsertLiability,
  type LiabilityPayment,
  type InsertLiabilityPayment,
  getFinancialYear,
  getFYDateRange,
  type DashboardStats,
  type QualityStats,
  type PaymentStats,
  type MerchantStats,
  type ExitRegisterResponse,
} from "@shared/schema";

// Entity type prefixes for sequential IDs
export type EntityType = 'cold_storage' | 'lot' | 'sales' | 'cash_flow' | 'buyer' | 'farmer';
const ENTITY_PREFIXES: Record<EntityType, string> = {
  cold_storage: 'CS',
  lot: 'LT',
  sales: 'SL',
  cash_flow: 'CF',
  buyer: 'BY',
  farmer: 'FM',
};

const COLD_STORAGE_SCOPED_ENTITIES: EntityType[] = ['cash_flow', 'buyer', 'farmer'];

// Generate a sequential ID in format: PREFIX + YYYYMMDD + counter (no zero-padding)
// Example: LT202601251, LT202601252, ... LT20260125100
// For cold-storage-scoped entities (cash_flow, buyer, farmer), coldStorageId is required
// initialCounter allows seeding the counter on first use (e.g., to continue from existing max after migration)
export async function generateSequentialId(entityType: EntityType, coldStorageId?: string, initialCounter?: number): Promise<string> {
  if (COLD_STORAGE_SCOPED_ENTITIES.includes(entityType) && !coldStorageId) {
    throw new Error(`coldStorageId is required for ${entityType} entity type`);
  }
  
  const now = new Date();
  const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const rowId = COLD_STORAGE_SCOPED_ENTITIES.includes(entityType) && coldStorageId 
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

  // No existing row - try to insert
  // Use initialCounter to seed from existing max (handles mid-day migration)
  // ON CONFLICT: if another request raced and inserted first, take the GREATEST counter
  // to ensure we never go backwards
  const seedCounter = initialCounter ?? 0;
  await db.execute(sql`
    INSERT INTO daily_id_counters (id, entity_type, date_key, counter)
    VALUES (${rowId}, ${entityType}, ${dateKey}, ${seedCounter})
    ON CONFLICT (id) DO UPDATE SET counter = GREATEST(daily_id_counters.counter, ${seedCounter})
  `);

  // Now do the atomic update to get the counter
  const finalResult = await db
    .update(dailyIdCounters)
    .set({ counter: sql`${dailyIdCounters.counter} + 1` })
    .where(eq(dailyIdCounters.id, rowId))
    .returning({ counter: dailyIdCounters.counter });

  return `${prefix}${dateKey}${finalResult[0]?.counter || (seedCounter + 1)}`;
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
  createBatchLots(lots: InsertLot[], coldStorageId: string, bagTypeCategory?: "wafer" | "rationSeed", manualLotNo?: number, entryDate?: string): Promise<{ lots: Lot[]; entrySequence: number }>;
  getNextEntrySequence(coldStorageId: string): Promise<number>;
  getLot(id: string): Promise<Lot | undefined>;
  updateLot(id: string, updates: Partial<Lot>): Promise<Lot | undefined>;
  searchLots(type: "phone", query: string, coldStorageId: string): Promise<Lot[]>;
  searchLotsByLotNoAndSize(lotNoFrom: string, lotNoTo: string, size: string, coldStorageId: string): Promise<Lot[]>;
  searchLotsByFarmerName(query: string, coldStorageId: string, village?: string, contactNumber?: string): Promise<Lot[]>;
  getAllLots(coldStorageId: string): Promise<Lot[]>;
  getLotsByEntrySequence(entrySequence: number, coldStorageId: string): Promise<Lot[]>;
  createEditHistory(history: InsertLotEditHistory): Promise<LotEditHistory>;
  getLotHistory(lotId: string): Promise<LotEditHistory[]>;
  deleteEditHistory(historyId: string): Promise<void>;
  getDashboardStats(coldStorageId: string, year?: number): Promise<DashboardStats>;
  getSaleLotInfo(coldStorageId: string, lotId: string): Promise<import("@shared/schema").SaleLotInfo | undefined>;
  getQualityStats(coldStorageId: string, year?: number): Promise<QualityStats>;
  getPaymentStats(coldStorageId: string, year?: number): Promise<PaymentStats>;
  getMerchantStats(coldStorageId: string, year?: number): Promise<MerchantStats>;
  getAnalyticsYears(coldStorageId: string): Promise<number[]>;

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
  }): Promise<SalesHistoryWithLastPayment[]>;
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
  getExitsByBillNumber(coldStorageId: string, billNumber: number): Promise<Array<{
    exitId: string;
    exitDate: Date;
    billNumber: number;
    bagsExited: number;
    isReversed: number;
    saleId: string;
    lotNo: string;
    marka: string | null;
    bagType: string;
    chamberName: string;
    floor: number;
    position: string;
    farmerName: string;
    village: string;
    contactNumber: string;
    farmerLedgerId: string | null;
  }>>;
  getTotalBagsExited(coldStorageId: string, year?: number): Promise<number>;
  getExitRegister(coldStorageId: string, filters: { year?: number; months?: number[]; days?: number[]; farmerName?: string; farmerContact?: string; buyerName?: string; village?: string; bagType?: string }): Promise<ExitRegisterResponse>;
  getExitRegisterYears(coldStorageId: string): Promise<number[]>;
  reverseLatestExit(salesHistoryId: string): Promise<{ success: boolean; message?: string }>;
  getSalesWithExitsByLotIds(coldStorageId: string, lotIds: string[]): Promise<Record<string, Array<{
    saleId: string;
    soldAt: Date;
    quantitySold: number;
    coldStorageBillNumber: number | null;
    totalExited: number;
    exits: Array<{ exitDate: Date; billNumber: number; bagsExited: number }>;
  }>>>;
  // Cash Receipts
  getBuyersWithDues(coldStorageId: string): Promise<{ buyerName: string; totalDue: number }[]>;
  getFarmerReceivablesWithDues(coldStorageId: string, year: number): Promise<{ id: string; farmerLedgerId: string | null; farmerName: string; contactNumber: string; village: string; totalDue: number }[]>;
  createFarmerReceivablePayment(data: { coldStorageId: string; farmerReceivableId: string; farmerLedgerId: string | null; farmerDetails: { farmerName: string; contactNumber: string; village: string } | null; buyerName: string | null; receiptType: string; accountType: string | null; accountId: string | null; amount: number; roundOff?: number; receivedAt: Date; notes: string | null }): Promise<{ receipt: CashReceipt; salesUpdated: number }>;
  getCashReceipts(coldStorageId: string): Promise<CashReceipt[]>;
  getSalesGoodsBuyers(coldStorageId: string): Promise<string[]>;
  createCashReceiptWithFIFO(data: InsertCashReceipt): Promise<{ receipt: CashReceipt; salesUpdated: number }>;
  createManualSalePayment(data: { coldStorageId: string; saleId: string; receiptType: string; accountType: string | null; accountId: string | null; amount: number; roundOff?: number; receivedAt: Date; notes: string | null }): Promise<{ receipt: CashReceipt; salesUpdated: number }>;
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
  recomputeFarmerPayments(coldStorageId: string, farmerLedgerId: string | null, buyerDisplayName: string | null): Promise<{ receivablesUpdated: number }>;
  recomputeFarmerPaymentsWithDiscounts(coldStorageId: string, farmerLedgerId: string | null, farmerName: string, contactNumber: string, village: string): Promise<{ receivablesUpdated: number; selfSalesUpdated: number }>;
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
  getFarmerRecords(coldStorageId: string, year?: number, includeArchived?: boolean): Promise<{ farmerName: string; village: string; tehsil: string; district: string; state: string; contactNumber: string; farmerLedgerId: string; farmerId: string; entityType: string; customColdChargeRate: number | null; customHammaliRate: number | null }[]>;
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
  updateOpeningReceivable(id: string, updates: { dueAmount?: number; rateOfInterest?: number; effectiveDate?: Date | null; remarks?: string | null }): Promise<OpeningReceivable | undefined>;
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
  updateFarmerPaymentStatus(saleId: string, status: string, paidAt: string | null): Promise<SalesHistory | undefined>;
  // Update farmer details in all salesHistory entries for a given lotId
  // Also updates buyerName if it matches the "self" pattern (farmer as buyer)
  updateSalesHistoryFarmerDetails(
    lotId: string, 
    updates: { farmerName?: string; village?: string; tehsil?: string; district?: string; state?: string; contactNumber?: string; farmerLedgerId?: string; farmerId?: string },
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
  // Merchant Advance
  createMerchantAdvance(data: InsertMerchantAdvance): Promise<MerchantAdvance>;
  getMerchantAdvances(coldStorageId: string, buyerLedgerId?: string): Promise<MerchantAdvance[]>;
  getBuyersWithAdvanceDues(coldStorageId: string): Promise<{ buyerLedgerId: string; buyerId: string; buyerName: string; advanceDue: number }[]>;
  payMerchantAdvance(coldStorageId: string, buyerLedgerId: string, amount: number): Promise<{ totalApplied: number; recordsUpdated: number }>;
  payMerchantAdvanceSelected(coldStorageId: string, buyerLedgerId: string, amount: number, selectedAdvanceIds: string[]): Promise<{ totalApplied: number; recordsUpdated: number; appliedAdvanceIds: string[] }>;
  getOutstandingAdvancesForBuyer(coldStorageId: string, buyerLedgerId: string): Promise<{ id: string; effectiveDate: Date; amount: number; rateOfInterest: number; finalAmount: number; paidAmount: number; remainingDue: number; expenseId: string | null; createdAt: Date }[]>;
  createPYMerchantAdvance(data: { coldStorageId: string; buyerLedgerId: string; buyerId: string; amount: number; rateOfInterest: number; effectiveDate: Date; remarks?: string | null }): Promise<MerchantAdvance>;
  updatePYMerchantAdvance(coldStorageId: string, id: string, updates: { amount?: number; rateOfInterest?: number; effectiveDate?: Date; remarks?: string | null }): Promise<MerchantAdvance | undefined>;
  deletePYMerchantAdvance(coldStorageId: string, id: string): Promise<boolean>;
  getPYMerchantAdvances(coldStorageId: string): Promise<MerchantAdvance[]>;
  createMerchantAdvanceReceipt(data: { coldStorageId: string; transactionId: string; payerType: string; buyerName: string; buyerLedgerId: string; buyerId: string; receiptType: string; accountId: string | null; amount: number; receivedAt: Date; notes: string | null; appliedAmount?: number; unappliedAmount?: number; appliedAdvanceIds?: string[] }): Promise<CashReceipt>;
  updateMerchantAdvanceReceipt(receiptId: string, updates: { appliedAmount?: number; unappliedAmount?: number; appliedAdvanceIds?: string[] }): Promise<void>;
  deleteMerchantAdvanceReceipt(receiptId: string): Promise<void>;
  accrueInterestForAll(coldStorageId: string): Promise<number>;
  computeYearlySimpleInterest(latestPrincipal: number, effectiveDate: Date, annualRate: number, today: Date): { finalAmount: number; latestPrincipal: number; effectiveDate: Date };
  calculateSimpleInterest(principal: number, annualRate: number, fromDate: Date, toDate: Date): number;
  // Farmer Loan
  createFarmerLoan(data: { coldStorageId: string; farmerLedgerId: string; farmerId: string; amount: number; rateOfInterest: number; effectiveDate: Date; finalAmount: number; latestPrincipal: number; lastAccrualDate: Date; expenseId: string | null; remarks?: string | null; originalEffectiveDate?: Date }): Promise<FarmerLoan>;
  getFarmerLoans(coldStorageId: string, farmerLedgerId?: string): Promise<FarmerLoan[]>;
  getFarmersWithLoanDues(coldStorageId: string): Promise<{ farmerLedgerId: string; farmerId: string; farmerName: string; loanDue: number }[]>;
  getOutstandingLoansForFarmer(coldStorageId: string, farmerLedgerId: string): Promise<{ id: string; effectiveDate: Date; amount: number; rateOfInterest: number; finalAmount: number; paidAmount: number; remainingDue: number; expenseId: string | null; createdAt: Date }[]>;
  payFarmerLoanSelected(coldStorageId: string, farmerLedgerId: string, amount: number, selectedLoanIds: string[], receiptId?: string, eventDate?: Date): Promise<{ totalApplied: number; recordsUpdated: number; appliedLoanIds: string[] }>;
  createFarmerLoanReceipt(data: { coldStorageId: string; transactionId: string; payerType: string; farmerName: string; farmerLedgerId: string; farmerId: string; receiptType: string; accountId: string | null; amount: number; receivedAt: Date; notes: string | null; appliedAmount?: number; unappliedAmount?: number; appliedLoanIds?: string[] }): Promise<CashReceipt>;
  deleteFarmerLoanReceipt(receiptId: string): Promise<void>;
  createPYFarmerLoan(data: { coldStorageId: string; farmerLedgerId: string; farmerId: string; amount: number; rateOfInterest: number; effectiveDate: Date; remarks?: string | null }): Promise<FarmerLoan>;
  updatePYFarmerLoan(coldStorageId: string, id: string, updates: { amount?: number; rateOfInterest?: number; effectiveDate?: Date; remarks?: string | null }): Promise<FarmerLoan | undefined>;
  reverseFarmerLoan(coldStorageId: string, loanId: string): Promise<boolean>;
  // Farmer Ledger
  getFarmerLedger(coldStorageId: string, includeArchived?: boolean): Promise<{
    farmers: (FarmerLedgerEntry & {
      pyReceivables: number;
      selfDue: number;
      merchantDue: number;
      advanceDue: number;
      freightDue: number;
      loanDue: number;
      totalDue: number;
    })[];
    summary: {
      totalFarmers: number;
      pyReceivables: number;
      selfDue: number;
      merchantDue: number;
      advanceDue: number;
      freightDue: number;
      loanDue: number;
      totalDue: number;
    };
  }>;
  getFarmerDuesByLedgerId(farmerLedgerId: string, coldStorageId: string): Promise<{ pyReceivables: number; selfDue: number; merchantDue: number; advanceDue: number; freightDue: number; loanDue: number; totalDue: number }>;
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
  createManualFarmer(coldStorageId: string, farmerData: {
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
      advanceDue: number;
      dueTransferOut: number;
      dueTransferIn: number;
      salesDue: number;
      buyerExtras: number;
      netDue: number;
    })[];
    summary: {
      totalBuyers: number;
      pyReceivables: number;
      advanceDue: number;
      dueTransferOut: number;
      dueTransferIn: number;
      salesDue: number;
      buyerExtras: number;
      netDue: number;
    };
  }>;
  getBuyerTransactions(buyerLedgerId: string, coldStorageId: string, fyStartYear: number): Promise<{
    openingBalance: number;
    transactions: {
      type: string;
      date: string;
      debit: number;
      credit: number;
      refId?: string;
      meta?: Record<string, string>;
    }[];
  }>;
  getFarmerTransactions(farmerLedgerId: string, coldStorageId: string, fyStartYear: number): Promise<{
    openingBalance: number;
    transactions: {
      type: string;
      date: string;
      debit: number;
      credit: number;
      refId?: string;
      meta?: Record<string, string>;
    }[];
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
  createManualBuyer(coldStorageId: string, buyerData: {
    buyerName: string;
    address?: string;
    contactNumber?: string;
  }): Promise<{ id: string; buyerId: string }>;
  // Assets
  getAssets(coldStorageId: string): Promise<Asset[]>;
  createAsset(data: InsertAsset): Promise<Asset>;
  updateAsset(id: string, updates: Partial<Asset>): Promise<Asset | undefined>;
  disposeAsset(id: string, disposalAmount: number, disposedAt: Date): Promise<Asset | undefined>;
  getDepreciationLog(coldStorageId: string, financialYear: string): Promise<AssetDepreciationLog[]>;
  runDepreciation(coldStorageId: string, financialYear: string): Promise<AssetDepreciationLog[]>;
  // Liabilities
  getLiabilities(coldStorageId: string): Promise<Liability[]>;
  createLiability(data: InsertLiability): Promise<Liability>;
  updateLiability(id: string, updates: Partial<Liability>): Promise<Liability | undefined>;
  settleLiability(id: string): Promise<Liability | undefined>;
  getLiabilityPayments(liabilityId: string): Promise<LiabilityPayment[]>;
  createLiabilityPayment(data: InsertLiabilityPayment): Promise<LiabilityPayment>;
  reverseLiabilityPayment(id: string): Promise<LiabilityPayment | undefined>;
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

function toISTDateString(date: Date): string {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  return istDate.toISOString().slice(0, 10);
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

  async createBatchLots(insertLots: InsertLot[], coldStorageId: string, bagTypeCategory?: "wafer" | "rationSeed", manualLotNo?: number, entryDate?: string): Promise<{ lots: Lot[]; entrySequence: number }> {
    const isWaferCategory = bagTypeCategory === "wafer";
    const currentYear = entryDate ? new Date(entryDate + "T00:00:00").getFullYear() : new Date().getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    
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
    
    // If caller supplied a manual lot#, validate no duplicate exists for same category+year
    if (manualLotNo !== undefined && manualLotNo > 0) {
      const isDuplicate = allLots.some((lot) => {
        const lotIsWafer = lot.bagType === "wafer";
        if (lotIsWafer !== isWaferCategory) return false;
        const lotYear = lot.createdAt ? new Date(lot.createdAt).getFullYear() : currentYear;
        if (lotYear !== currentYear) return false;
        return parseInt(lot.lotNo, 10) === manualLotNo;
      });
      if (isDuplicate) {
        throw new Error(`Receipt # ${manualLotNo} already exists for this category.`);
      }
    }

    // Next sequence is max + 1, or 1 if no lots exist for current year.
    // If caller supplied a manual lot#, use it instead of the auto-calculated value.
    const entrySequence = (manualLotNo !== undefined && manualLotNo > 0) ? manualLotNo : maxLotNo + 1;
    
    const createdLots: Lot[] = [];
    
    for (const insertLot of insertLots) {
      const id = await generateSequentialId('lot');
      const lotData = {
        ...insertLot,
        id,
        coldStorageId,
        lotNo: String(entrySequence),
        entrySequence,
        ...(entryDate ? { createdAt: new Date(entryDate + "T00:00:00") } : {}),
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

  async getSaleLotInfo(coldStorageId: string, lotId: string): Promise<import("@shared/schema").SaleLotInfo | undefined> {
    const lot = await this.getLot(lotId);
    if (!lot || lot.coldStorageId !== coldStorageId) return undefined;
    const coldStorage = await this.getColdStorage(coldStorageId);
    const chamber = await this.getChamber(lot.chamberId);
    const farmerRecords = await this.getFarmerRecords(coldStorageId, undefined, true);
    const farmer = lot.farmerLedgerId ? farmerRecords.find(f => f.farmerLedgerId === lot.farmerLedgerId) : undefined;
    const useWaferRates = lot.bagType === "wafer";
    const globalColdCharge = useWaferRates
      ? (coldStorage?.waferColdCharge || coldStorage?.waferRate || 0)
      : (coldStorage?.seedColdCharge || coldStorage?.seedRate || 0);
    const globalHammali = useWaferRates
      ? (coldStorage?.waferHammali || 0)
      : (coldStorage?.seedHammali || 0);
    const isCompany = farmer?.entityType === "company";
    const effectiveChargeUnit = isCompany ? "quintal" : (coldStorage?.chargeUnit || "bag");
    const coldCharge = farmer?.customColdChargeRate ?? globalColdCharge;
    const hammali = farmer?.customHammaliRate ?? globalHammali;
    const rate = coldCharge + hammali;
    return {
      id: lot.id,
      lotNo: lot.lotNo,
      farmerName: lot.farmerName,
      contactNumber: lot.contactNumber,
      village: lot.village,
      farmerLedgerId: lot.farmerLedgerId || null,
      chamberName: chamber?.name || "Unknown",
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
      chargeUnit: effectiveChargeUnit,
      baseColdChargesBilled: lot.baseColdChargesBilled || 0,
    };
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

  async searchLotsByLotNoAndSize(lotNoFrom: string, lotNoTo: string, size: string, coldStorageId: string): Promise<Lot[]> {
    const allLots = await db.select().from(lots).where(eq(lots.coldStorageId, coldStorageId));
    
    return allLots.filter((lot) => {
      const lotNum = parseInt(lot.lotNo, 10);
      const fromNum = lotNoFrom ? parseInt(lotNoFrom, 10) : NaN;
      const toNum = lotNoTo ? parseInt(lotNoTo, 10) : NaN;
      let matchesLotNo = true;
      if (!isNaN(fromNum) && !isNaN(toNum)) {
        matchesLotNo = !isNaN(lotNum) && lotNum >= fromNum && lotNum <= toNum;
      } else if (!isNaN(fromNum)) {
        matchesLotNo = !isNaN(lotNum) && lotNum === fromNum;
      } else if (!isNaN(toNum)) {
        matchesLotNo = !isNaN(lotNum) && lotNum <= toNum;
      }
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
    const saleFarmerRecords = await this.getFarmerRecords(coldStorageId, undefined, true);
    const saleFarmerMap = new Map(saleFarmerRecords.map(f => [f.farmerLedgerId, f]));
    const saleLots = allLots
      .filter((lot) => lot.upForSale === 1 && lot.remainingSize > 0 && lot.saleStatus !== "sold")
      .map((lot) => {
        const useWaferRates = lot.bagType === "wafer";
        const globalColdCharge = useWaferRates 
          ? (coldStorage?.waferColdCharge || coldStorage?.waferRate || 0) 
          : (coldStorage?.seedColdCharge || coldStorage?.seedRate || 0);
        const globalHammali = useWaferRates 
          ? (coldStorage?.waferHammali || 0) 
          : (coldStorage?.seedHammali || 0);
        const farmer = lot.farmerLedgerId ? saleFarmerMap.get(lot.farmerLedgerId) : undefined;
        const isCompany = farmer?.entityType === "company";
        const effectiveChargeUnit = isCompany ? "quintal" : (coldStorage?.chargeUnit || "bag");
        const coldCharge = farmer?.customColdChargeRate ?? globalColdCharge;
        const hammali = farmer?.customHammaliRate ?? globalHammali;
        const rate = coldCharge + hammali;
        return {
          id: lot.id,
          lotNo: lot.lotNo,
          farmerName: lot.farmerName,
          contactNumber: lot.contactNumber,
          village: lot.village,
          farmerLedgerId: lot.farmerLedgerId || null,
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
          chargeUnit: effectiveChargeUnit,
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
    let totalAdjSelfDue = 0;
    
    // Group sales by lotId to count unique lots, not individual partial sales
    const lotPaymentMap = new Map<string, { paidAmount: number; dueAmount: number }>();
    
    for (const sale of allSales) {
      // coldStorageCharge already includes base + kata + extraHammali + grading
      // Do NOT add them again to avoid double-counting
      const totalCharges = sale.coldStorageCharge || 0;
      
      // Use stored baseHammaliAmount (computed at sale time) instead of re-deriving
      // For legacy sales without the field, fall back to proportional split
      let baseHammali = 0;
      if (sale.baseHammaliAmount != null) {
        baseHammali = sale.baseHammaliAmount;
      } else {
        const extras = (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
        const baseChargesTotal = Math.max(0, (sale.coldStorageCharge || 0) - extras - (sale.adjReceivableSelfDueAmount || 0));
        if (sale.coldCharge && sale.hammali) {
          const totalRate = sale.coldCharge + sale.hammali;
          if (totalRate > 0) {
            baseHammali = (baseChargesTotal * sale.hammali) / totalRate;
          }
        } else if (sale.hammali && sale.hammali > 0 && !sale.coldCharge) {
          baseHammali = baseChargesTotal;
        }
      }
      
      // Total hammali = base hammali + extra hammali (bilty cut) + hammali to merchant
      totalHammali += baseHammali + (sale.extraHammali || 0) + (sale.extraDueHammaliMerchant || 0);
      totalGradingCharges += (sale.gradingCharges || 0) + (sale.extraDueGradingMerchant || 0);
      
      // Track extraDueToMerchant (remaining due, already reduced by FIFO payments)
      totalExtraDueToMerchant += (sale.extraDueToMerchant || 0);
      
      const salePaid = sale.paidAmount || 0;
      const saleDue = Math.max(0, totalCharges - salePaid);
      
      totalPaid += salePaid;
      totalDue += saleDue;
      totalAdjSelfDue += sale.adjSelfDue || 0;
      
      // Track payment status by lot for counting unique lots
      const existing = lotPaymentMap.get(sale.lotId) || { paidAmount: 0, dueAmount: 0 };
      existing.paidAmount += salePaid;
      existing.dueAmount += saleDue;
      lotPaymentMap.set(sale.lotId, existing);
    }
    
    // Add extraDueToMerchant to totalDue for consistency with Merchant Analysis
    totalDue += totalExtraDueToMerchant;
    
    // Subtract adjSelfDue globally to avoid double-counting:
    // adjSelfDue inflates coldStorageCharge on the new sale (billed side)
    // AND the FIFO system inflates paidAmount on the original self-sale (paid side)
    totalPaid = Math.max(0, totalPaid - totalAdjSelfDue);
    
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
    // Farmer: PY Receivables + Advance Due + Freight Due
    // Buyer: PY Receivables + Advance Due
    const farmerLedgerData = await this.getFarmerLedger(coldStorageId);
    let farmerReceivableDue = 0;
    for (const farmer of farmerLedgerData.farmers) {
      farmerReceivableDue += (farmer.pyReceivables || 0) + (farmer.advanceDue || 0) + (farmer.freightDue || 0);
    }
    
    const buyerLedgerData = await this.getBuyerLedger(coldStorageId);
    let buyerReceivableDue = 0;
    for (const buyer of buyerLedgerData.buyers) {
      buyerReceivableDue += (buyer.pyReceivables || 0) + (buyer.advanceDue || 0);
    }
    
    const totalReceivableDue = farmerReceivableDue + buyerReceivableDue;

    // Calculate original receivable totals (before payments)
    // Farmer: PY Receivables original + Advance original + Freight original
    const farmerPYOriginal = await db.select({
      total: sql<number>`COALESCE(SUM(COALESCE(${openingReceivables.finalAmount}, ${openingReceivables.dueAmount})), 0)`
    }).from(openingReceivables).where(and(
      eq(openingReceivables.coldStorageId, coldStorageId),
      eq(openingReceivables.payerType, "farmer")
    ));

    const farmerAdvFreightOriginal = await db.select({
      total: sql<number>`COALESCE(SUM(${farmerAdvanceFreight.finalAmount}), 0)`
    }).from(farmerAdvanceFreight).where(and(
      eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
      eq(farmerAdvanceFreight.isReversed, 0)
    ));

    const farmerReceivableTotal = (farmerPYOriginal[0]?.total || 0) + (farmerAdvFreightOriginal[0]?.total || 0);

    // Buyer: PY Receivables original + Merchant Advance original
    const buyerPYOriginal = await db.select({
      total: sql<number>`COALESCE(SUM(COALESCE(${openingReceivables.finalAmount}, ${openingReceivables.dueAmount})), 0)`
    }).from(openingReceivables).where(and(
      eq(openingReceivables.coldStorageId, coldStorageId),
      eq(openingReceivables.payerType, "cold_merchant")
    ));

    const merchantAdvOriginal = await db.select({
      total: sql<number>`COALESCE(SUM(${merchantAdvance.finalAmount}), 0)`
    }).from(merchantAdvance).where(and(
      eq(merchantAdvance.coldStorageId, coldStorageId),
      eq(merchantAdvance.isReversed, 0)
    ));

    const buyerReceivableTotal = (buyerPYOriginal[0]?.total || 0) + (merchantAdvOriginal[0]?.total || 0);

    return {
      totalPaid,
      totalDue,
      paidCount,
      dueCount,
      totalHammali,
      totalGradingCharges,
      hammaliDue,
      gradingDue,
      totalReceivableDue,
      farmerReceivableDue,
      buyerReceivableDue,
      farmerReceivableTotal,
      buyerReceivableTotal,
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



  // Sales History Methods
  async createSalesHistory(data: InsertSalesHistory): Promise<SalesHistory> {
    const id = await generateSequentialId('sales');
    // Seed paidCash / paidAccount counters from inline payment, if any.
    // Sales created with a non-zero paidAmount and an explicit paymentMode
    // (e.g. "paid at sale time") get the whole paid portion credited to the
    // matching bucket so the per-sale split is correct from day one.
    const seedPaid = (data as any).paidAmount as number | undefined;
    const seedMode = (data as any).paymentMode as string | undefined;
    let seedCash = 0;
    let seedAccount = 0;
    if (seedPaid && seedPaid > 0) {
      if (seedMode === "cash") seedCash = seedPaid;
      else if (seedMode === "account") seedAccount = seedPaid;
    }
    // Ensure extraDueToMerchantOriginal is always seeded from extraDueToMerchant at creation
    // so that FIFO recomputes (e.g. on payment reversal) can restore the correct baseline.
    const seedExtraDueOriginal =
      (data.extraDueToMerchantOriginal && data.extraDueToMerchantOriginal > 0)
        ? data.extraDueToMerchantOriginal
        : (data.extraDueToMerchant ?? 0);

    const [sale] = await db.insert(salesHistory).values({
      ...data,
      id,
      paidCash: seedCash,
      paidAccount: seedAccount,
      extraDueToMerchantOriginal: seedExtraDueOriginal,
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
  }): Promise<SalesHistoryWithLastPayment[]> {
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

    const sales = await db.select()
      .from(salesHistory)
      .where(and(...conditions))
      .orderBy(desc(salesHistory.soldAt));

    if (sales.length === 0) return [];

    // Enrich each sale with `lastPaymentAt` and a `payments` list — derived
    // from the cash_receipt_applications junction table. Each row records a
    // (cash_receipt → sales_history, amount_applied) allocation; reversal &
    // recompute paths delete/re-insert so this is always in sync with the
    // current set of non-reversed receipts.
    const saleIds = sales.map(s => s.id);
    const appRows = await db.select({
      saleId: cashReceiptApplications.salesHistoryId,
      receiptId: cashReceiptApplications.cashReceiptId,
      amountApplied: cashReceiptApplications.amountApplied,
      appliedAt: cashReceiptApplications.appliedAt,
      receivedAt: cashReceipts.receivedAt,
      receiptType: cashReceipts.receiptType,
      transactionId: cashReceipts.transactionId,
    })
      .from(cashReceiptApplications)
      .innerJoin(cashReceipts, eq(cashReceiptApplications.cashReceiptId, cashReceipts.id))
      .where(and(
        eq(cashReceiptApplications.coldStorageId, coldStorageId),
        eq(cashReceipts.isReversed, 0),
        inArray(cashReceiptApplications.salesHistoryId, saleIds),
      ));

    const paymentsBySale = new Map<string, SalePayment[]>();
    const lastPaymentBySale = new Map<string, Date>();
    for (const row of appRows) {
      const when = (row.receivedAt ?? row.appliedAt) as Date | null;
      if (!when) continue;
      const whenDate = new Date(when as unknown as string);
      const list = paymentsBySale.get(row.saleId) ?? [];
      list.push({
        receiptId: row.receiptId,
        transactionId: row.transactionId ?? null,
        receivedAt: whenDate,
        amount: Number(row.amountApplied || 0),
        receiptType: row.receiptType ?? null,
      });
      paymentsBySale.set(row.saleId, list);
      const cur = lastPaymentBySale.get(row.saleId);
      if (!cur || whenDate > cur) lastPaymentBySale.set(row.saleId, whenDate);
    }

    // Sort each sale's payments oldest → newest for stable display.
    Array.from(paymentsBySale.values()).forEach(list => {
      list.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    });

    return sales.map((sale): SalesHistoryWithLastPayment => ({
      ...sale,
      lastPaymentAt: lastPaymentBySale.get(sale.id) ?? null,
      payments: paymentsBySale.get(sale.id),
    }));
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
      // Direct overwrite — credit the entire new paidAmount to the matching
      // bucket based on the row's current paymentMode (or the explicit one
      // being set in the same call). Better than leaving stale counters.
      const newPaid = updates.paidAmount || 0;
      const mode = updates.paymentStatus !== undefined && (updateData as any).paymentMode
        ? (updateData as any).paymentMode as string
        : null;
      // Fall back to existing paymentMode by re-reading the sale row.
      const [existing] = await db.select({ paymentMode: salesHistory.paymentMode })
        .from(salesHistory)
        .where(eq(salesHistory.id, saleId));
      const effMode = mode || existing?.paymentMode || null;
      updateData.paidCash = effMode === "cash" ? newPaid : 0;
      updateData.paidAccount = effMode === "account" ? newPaid : 0;
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
    baseHammaliAmount?: number;
    chargeBasis?: "actual" | "totalRemaining";
    extraDueToMerchant?: number;
    extraDueHammaliMerchant?: number;
    extraDueGradingMerchant?: number;
    extraDueOtherMerchant?: number;
    adjReceivableSelfDueAmount?: number;
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
      // Snapshot the new paidAmount into the cash/account counters using
      // the explicit paymentMode in this update, falling back to the row's
      // existing paymentMode. Editing a sale directly is a manual override,
      // so we treat the entire paid total as a single bucket.
      const newPaid = updates.paidAmount || 0;
      const effMode = updates.paymentMode || sale.paymentMode || null;
      updateData.paidCash = effMode === "cash" ? newPaid : 0;
      updateData.paidAccount = effMode === "account" ? newPaid : 0;
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
    if (updates.adjReceivableSelfDueAmount !== undefined) {
      updateData.adjReceivableSelfDueAmount = updates.adjReceivableSelfDueAmount;
    }
    if (updates.baseHammaliAmount !== undefined) {
      updateData.baseHammaliAmount = updates.baseHammaliAmount;
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
      const adjAmt = updates.adjReceivableSelfDueAmount ?? sale.adjReceivableSelfDueAmount ?? 0;
      updateData.coldStorageCharge = ratePerBag * (sale.quantitySold || 0) + adjAmt;
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

  // Master Nikasi — bulk self-sale + exit for one farmer/company. All rows
  // share a single freshly-allocated exit bill number and exit date.
  async createMasterNikasi(args: {
    coldStorageId: string;
    farmerLedgerId: string;
    exitDate: Date;
    rows: Array<{
      lotId: string;
      exitBags: number;
      kataCharges: number;
      extraHammaliPerBag: number;
      gradingCharges: number;
    }>;
  }): Promise<{
    sharedExitBillNumber: number;
    exitDate: Date;
    sales: Array<{
      saleId: string;
      lotId: string;
      lotNo: string;
      marka: string | null;
      bagsExited: number;
      baseColdCharge: number;
      kataCharges: number;
      extraHammaliPerBag: number;
      extraHammali: number;
      gradingCharges: number;
      totalColdStorageCharge: number;
      coldStorageBillNumber: number | null;
      potatoType: string;
      bagType: string;
      chamberName: string;
      floor: number;
      position: string;
    }>;
    farmer: {
      farmerName: string;
      contactNumber: string;
      village: string;
      tehsil: string;
      district: string;
      state: string;
      entityType: string;
    };
  }> {
    const { coldStorageId, farmerLedgerId, exitDate, rows } = args;

    if (rows.length === 0) {
      throw new Error("No rows provided");
    }

    // Disallow duplicate lotId in the batch (the dialog also blocks this).
    const seenLot = new Set<string>();
    for (const r of rows) {
      if (seenLot.has(r.lotId)) throw new Error("Duplicate lot in master nikasi batch");
      seenLot.add(r.lotId);
    }
    // Resolve lots up-front so we can also enforce the business key
    // (Receipt# + Marka#) is unique within the batch.
    const resolvedLots = await Promise.all(rows.map(async (r) => {
      const l = await this.getLot(r.lotId);
      if (!l) throw new Error(`Lot ${r.lotId} not found`);
      return l;
    }));
    const seenReceiptMarka = new Set<string>();
    for (const lot of resolvedLots) {
      const key = `${(lot.lotNo || "").trim()}::${(lot.marka || "").trim()}`;
      if (seenReceiptMarka.has(key)) {
        throw new Error(`Duplicate Receipt#/Marka# in batch: ${lot.lotNo}/${lot.marka || "-"}`);
      }
      seenReceiptMarka.add(key);
    }

    const coldStorage = await this.getColdStorage(coldStorageId);
    if (!coldStorage) throw new Error("Cold storage not found");

    // Look up farmer entity / custom rates once.
    const farmerRecords = await this.getFarmerRecords(coldStorageId, undefined, true);
    const farmerRecord = farmerRecords.find(f => f.farmerLedgerId === farmerLedgerId);
    if (!farmerRecord) throw new Error("Farmer not found");
    const farmerEntityType = farmerRecord.entityType || "farmer";
    const effectiveChargeUnit = farmerEntityType === "company" ? "quintal" : (coldStorage.chargeUnit || "bag");

    return await db.transaction(async (tx) => {
      // Atomically reserve ONE exit bill number to be shared across every row.
      const counterRow = await tx.update(coldStorages)
        .set({ nextExitBillNumber: sql`COALESCE(${coldStorages.nextExitBillNumber}, 1) + 1` })
        .where(eq(coldStorages.id, coldStorageId))
        .returning({ next: coldStorages.nextExitBillNumber });
      if (counterRow.length === 0 || counterRow[0].next == null) {
        throw new Error("Cold storage not found");
      }
      const sharedExitBillNumber = (counterRow[0].next as number) - 1;

      const createdSales: Array<{
        saleId: string;
        lotId: string;
        lotNo: string;
        marka: string | null;
        bagsExited: number;
        baseColdCharge: number;
        kataCharges: number;
        extraHammali: number;
        gradingCharges: number;
        totalColdStorageCharge: number;
        coldStorageBillNumber: number | null;
        potatoType: string;
        bagType: string;
        chamberName: string;
        floor: number;
        position: string;
      }> = [];

      for (const row of rows) {
        const [lot] = await tx.select().from(lots).where(eq(lots.id, row.lotId));
        if (!lot) throw new Error(`Lot ${row.lotId} not found`);
        if (lot.coldStorageId !== coldStorageId) throw new Error("Lot does not belong to this cold storage");
        if (lot.farmerLedgerId !== farmerLedgerId) throw new Error("Lot does not belong to this farmer");
        if (row.exitBags <= 0) throw new Error("Exit bags must be > 0");
        if (row.exitBags > lot.remainingSize) {
          throw new Error(`Lot ${lot.lotNo}: only ${lot.remainingSize} bag(s) remaining`);
        }

        const useWaferRates = lot.bagType === "wafer";
        const defaultColdCharge = useWaferRates ? (coldStorage.waferColdCharge || 0) : (coldStorage.seedColdCharge || 0);
        const defaultHammali = useWaferRates ? (coldStorage.waferHammali || 0) : (coldStorage.seedHammali || 0);
        const coldChargeRate = farmerRecord.customColdChargeRate ?? defaultColdCharge;
        const hammaliRate = farmerRecord.customHammaliRate ?? defaultHammali;

        // Auto-detect charge basis: clearing the lot → totalRemaining (so we
        // mark base charges billed and never double-charge later).
        const clearingLot = row.exitBags === lot.remainingSize;
        const chargeBasis = clearingLot ? "totalRemaining" : "actual";
        const chargeQuantity = row.exitBags; // exit equals sold for master nikasi

        let storageCharge = 0;
        let baseHammaliAmount = 0;
        if (lot.baseColdChargesBilled === 1) {
          storageCharge = 0;
          baseHammaliAmount = 0;
        } else if (effectiveChargeUnit === "quintal") {
          const coldChargeQuintal = (lot.netWeight && lot.size > 0)
            ? (lot.netWeight * chargeQuantity * coldChargeRate) / (lot.size * 100)
            : 0;
          const hammaliPerBag = hammaliRate * chargeQuantity;
          storageCharge = coldChargeQuintal + hammaliPerBag;
          baseHammaliAmount = hammaliPerBag;
        } else {
          storageCharge = chargeQuantity * (coldChargeRate + hammaliRate);
          baseHammaliAmount = hammaliRate * chargeQuantity;
        }

        const kata = row.kataCharges || 0;
        const extraPerBag = row.extraHammaliPerBag || 0;
        const extraTotal = extraPerBag * row.exitBags;
        const grading = row.gradingCharges || 0;
        const totalChargeForLot = storageCharge + kata + extraTotal + grading;

        // Atomic, race-safe stock decrement: WHERE clause asserts current
        // remainingSize is sufficient. If any concurrent write reduced stock
        // below row.exitBags, the UPDATE affects 0 rows and we abort the txn.
        const decUpdate: Record<string, unknown> = {
          remainingSize: sql`${lots.remainingSize} - ${row.exitBags}`,
          totalDueCharge: sql`COALESCE(${lots.totalDueCharge}, 0) + ${totalChargeForLot}`,
        };
        if (clearingLot && lot.baseColdChargesBilled !== 1) {
          decUpdate.baseColdChargesBilled = 1;
        }
        const updatedLotRows = await tx.update(lots)
          .set(decUpdate)
          .where(and(
            eq(lots.id, lot.id),
            gte(lots.remainingSize, row.exitBags),
          ))
          .returning({ remainingSize: lots.remainingSize });
        if (updatedLotRows.length === 0) {
          throw new Error(`Lot ${lot.lotNo}: insufficient remaining bags (concurrent change)`);
        }
        const newRemainingSize = updatedLotRows[0].remainingSize;
        const isLotFullySold = newRemainingSize === 0;

        if (isLotFullySold) {
          await tx.update(lots).set({
            saleStatus: "sold",
            paymentStatus: "due",
            saleCharge: storageCharge,
            soldAt: new Date(),
            upForSale: 0,
          }).where(eq(lots.id, lot.id));
        }

        // Lot edit history (mirrors partial-sale path)
        await tx.insert(lotEditHistory).values({
          id: randomUUID(),
          lotId: lot.id,
          changeType: isLotFullySold ? "final_sale" : "partial_sale",
          previousData: JSON.stringify({ remainingSize: lot.remainingSize }),
          newData: JSON.stringify(isLotFullySold
            ? { remainingSize: 0, saleStatus: "sold" }
            : { remainingSize: newRemainingSize }),
          soldQuantity: row.exitBags,
          pricePerBag: 0,
          coldCharge: coldChargeRate,
          hammali: hammaliRate,
          pricePerKg: null,
          buyerName: null,
          totalPrice: 0,
          salePaymentStatus: "due",
          saleCharge: storageCharge,
        });

        // Get chamber name and update fill if fully sold
        const chamber = await this.getChamber(lot.chamberId);
        if (isLotFullySold && chamber) {
          await tx.update(chambers)
            .set({ currentFill: Math.max(0, chamber.currentFill - row.exitBags) })
            .where(eq(chambers.id, chamber.id));
        }

        // Create sales_history row (self-sale, due, no buyer)
        const saleId = await generateSequentialId('sales');
        const [createdSale] = await tx.insert(salesHistory).values({
          id: saleId,
          coldStorageId: lot.coldStorageId,
          farmerName: lot.farmerName,
          village: lot.village,
          tehsil: lot.tehsil,
          district: lot.district,
          state: lot.state,
          contactNumber: lot.contactNumber,
          lotNo: lot.lotNo,
          marka: lot.marka || null,
          lotId: lot.id,
          chamberName: chamber?.name || "Unknown",
          floor: lot.floor,
          position: lot.position,
          potatoType: lot.type,
          bagType: lot.bagType,
          bagTypeLabel: lot.bagTypeLabel || null,
          quality: lot.quality,
          originalLotSize: lot.size,
          saleType: isLotFullySold ? "full" : "partial",
          quantitySold: row.exitBags,
          pricePerBag: coldChargeRate + hammaliRate,
          coldCharge: coldChargeRate,
          hammali: hammaliRate,
          coldStorageCharge: totalChargeForLot,
          kataCharges: kata,
          extraHammali: extraTotal,
          gradingCharges: grading,
          netWeight: null,
          buyerName: null,
          pricePerKg: null,
          paymentStatus: "due",
          paymentMode: null,
          paidAmount: 0,
          dueAmount: totalChargeForLot,
          entryDate: lot.createdAt,
          saleYear: new Date().getFullYear(),
          chargeBasis,
          chargeUnitAtSale: effectiveChargeUnit,
          initialNetWeightKg: lot.netWeight || null,
          baseChargeAmountAtSale: storageCharge,
          baseHammaliAmount,
          remainingSizeAtSale: lot.remainingSize,
          isSelfSale: 1,
          adjReceivableSelfDueAmount: 0,
          farmerLedgerId: lot.farmerLedgerId || null,
          farmerId: lot.farmerId || null,
          buyerLedgerId: null,
          buyerId: null,
          soldAt: new Date(),
        } as InsertSalesHistory).returning();

        // Atomically allocate this sale's coldStorageBillNumber.
        const csBillRow = await tx.update(coldStorages)
          .set({ nextColdStorageBillNumber: sql`COALESCE(${coldStorages.nextColdStorageBillNumber}, 1) + 1` })
          .where(eq(coldStorages.id, coldStorageId))
          .returning({ next: coldStorages.nextColdStorageBillNumber });
        const coldStorageBillNumber = csBillRow.length > 0 && csBillRow[0].next != null
          ? (csBillRow[0].next as number) - 1
          : null;
        if (coldStorageBillNumber != null) {
          await tx.update(salesHistory)
            .set({ coldStorageBillNumber })
            .where(eq(salesHistory.id, saleId));
        }

        // Create exit_history row sharing the master bill number / date.
        await tx.insert(exitHistory).values({
          id: randomUUID(),
          salesHistoryId: saleId,
          lotId: lot.id,
          coldStorageId: lot.coldStorageId,
          bagsExited: row.exitBags,
          billNumber: sharedExitBillNumber,
          exitDate,
        } as InsertExitHistory);

        // Denormalize exit summary onto the sale row (single exit per sale here).
        const dd = String(exitDate.getDate()).padStart(2, "0");
        const mm = String(exitDate.getMonth() + 1).padStart(2, "0");
        const yyyy = exitDate.getFullYear();
        await tx.update(salesHistory)
          .set({
            exitBillNumbers: String(sharedExitBillNumber),
            exitDates: `${dd}/${mm}/${yyyy}`,
          })
          .where(eq(salesHistory.id, saleId));

        createdSales.push({
          saleId,
          lotId: lot.id,
          lotNo: lot.lotNo,
          marka: lot.marka || null,
          bagsExited: row.exitBags,
          baseColdCharge: storageCharge,
          kataCharges: kata,
          extraHammaliPerBag: extraPerBag,
          extraHammali: extraTotal,
          gradingCharges: grading,
          totalColdStorageCharge: totalChargeForLot,
          coldStorageBillNumber,
          potatoType: lot.type,
          bagType: lot.bagType,
          chamberName: chamber?.name || "Unknown",
          floor: lot.floor,
          position: lot.position,
        });
      }

      return {
        sharedExitBillNumber,
        exitDate,
        sales: createdSales,
        farmer: {
          farmerName: farmerRecord.farmerName,
          contactNumber: farmerRecord.contactNumber,
          village: farmerRecord.village,
          tehsil: farmerRecord.tehsil,
          district: farmerRecord.district,
          state: farmerRecord.state,
          entityType: farmerEntityType,
        },
      };
    });
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

    // Refresh denormalised exit info on the parent sale row
    await this.syncSaleExitSummary(data.salesHistoryId);

    return record;
  }

  // Recompute and persist comma-separated exit bill numbers / dates
  // on the parent sales_history row from live (non-reversed) exit_history rows.
  private async syncSaleExitSummary(salesHistoryId: string): Promise<void> {
    const exits = await db.select({
      billNumber: exitHistory.billNumber,
      exitDate: exitHistory.exitDate,
    })
      .from(exitHistory)
      .where(and(
        eq(exitHistory.salesHistoryId, salesHistoryId),
        eq(exitHistory.isReversed, 0),
      ))
      .orderBy(asc(exitHistory.exitDate));

    const billNumbersStr = exits.length > 0
      ? exits.map(e => String(e.billNumber)).join(", ")
      : null;
    const datesStr = exits.length > 0
      ? exits.map(e => {
          const d = new Date(e.exitDate);
          const dd = String(d.getDate()).padStart(2, "0");
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const yyyy = d.getFullYear();
          return `${dd}/${mm}/${yyyy}`;
        }).join(", ")
      : null;

    await db.update(salesHistory)
      .set({ exitBillNumbers: billNumbersStr, exitDates: datesStr })
      .where(eq(salesHistory.id, salesHistoryId));
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

  async getExitsByBillNumber(coldStorageId: string, billNumber: number) {
    const rows = await db.select({
      exitId: exitHistory.id,
      exitDate: exitHistory.exitDate,
      billNumber: exitHistory.billNumber,
      bagsExited: exitHistory.bagsExited,
      isReversed: exitHistory.isReversed,
      saleId: salesHistory.id,
      lotNo: salesHistory.lotNo,
      marka: salesHistory.marka,
      bagType: salesHistory.bagType,
      chamberName: salesHistory.chamberName,
      floor: salesHistory.floor,
      position: salesHistory.position,
      farmerName: salesHistory.farmerName,
      village: salesHistory.village,
      contactNumber: salesHistory.contactNumber,
      farmerLedgerId: salesHistory.farmerLedgerId,
    })
      .from(exitHistory)
      .innerJoin(salesHistory, eq(salesHistory.id, exitHistory.salesHistoryId))
      .where(and(
        eq(exitHistory.coldStorageId, coldStorageId),
        eq(exitHistory.billNumber, billNumber),
      ))
      .orderBy(asc(salesHistory.lotNo));
    return rows;
  }

  async getSalesWithExitsByLotIds(coldStorageId: string, lotIds: string[]): Promise<Record<string, Array<{
    saleId: string;
    soldAt: Date;
    quantitySold: number;
    coldStorageBillNumber: number | null;
    totalExited: number;
    exits: Array<{ exitDate: Date; billNumber: number; bagsExited: number }>;
  }>>> {
    const result: Record<string, Array<{
      saleId: string;
      soldAt: Date;
      quantitySold: number;
      coldStorageBillNumber: number | null;
      totalExited: number;
      exits: Array<{ exitDate: Date; billNumber: number; bagsExited: number }>;
    }>> = {};
    if (lotIds.length === 0) return result;

    // Fetch all sales for the given lots, tenanted by coldStorageId.
    const sales = await db.select({
      id: salesHistory.id,
      lotId: salesHistory.lotId,
      soldAt: salesHistory.soldAt,
      quantitySold: salesHistory.quantitySold,
      coldStorageBillNumber: salesHistory.coldStorageBillNumber,
    })
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        inArray(salesHistory.lotId, lotIds),
      ))
      .orderBy(asc(salesHistory.soldAt));

    if (sales.length === 0) {
      // Pre-populate empty arrays for each requested lot so the client
      // can distinguish "no sales" from "lot not present".
      for (const lotId of lotIds) result[lotId] = [];
      return result;
    }

    // Fetch all active (non-reversed) exits for those sales in one go.
    const saleIds = sales.map(s => s.id);
    const exits = await db.select({
      salesHistoryId: exitHistory.salesHistoryId,
      exitDate: exitHistory.exitDate,
      billNumber: exitHistory.billNumber,
      bagsExited: exitHistory.bagsExited,
    })
      .from(exitHistory)
      .where(and(
        eq(exitHistory.coldStorageId, coldStorageId),
        inArray(exitHistory.salesHistoryId, saleIds),
        eq(exitHistory.isReversed, 0),
      ))
      .orderBy(asc(exitHistory.exitDate));

    const exitsBySale: Record<string, Array<{ exitDate: Date; billNumber: number; bagsExited: number }>> = {};
    for (const ex of exits) {
      if (!exitsBySale[ex.salesHistoryId]) exitsBySale[ex.salesHistoryId] = [];
      exitsBySale[ex.salesHistoryId].push({
        exitDate: ex.exitDate,
        billNumber: ex.billNumber,
        bagsExited: ex.bagsExited,
      });
    }

    for (const lotId of lotIds) result[lotId] = [];
    for (const s of sales) {
      const saleExits = exitsBySale[s.id] || [];
      const totalExited = saleExits.reduce((sum, e) => sum + e.bagsExited, 0);
      result[s.lotId].push({
        saleId: s.id,
        soldAt: s.soldAt,
        quantitySold: s.quantitySold,
        coldStorageBillNumber: s.coldStorageBillNumber,
        totalExited,
        exits: saleExits,
      });
    }
    return result;
  }

  async getExitRegister(
    coldStorageId: string,
    filters: {
      year?: number;
      months?: number[]; // 1..12
      days?: number[]; // 1..31
      farmerName?: string;
      farmerContact?: string;
      buyerName?: string;
      village?: string;
      bagType?: string;
    }
  ): Promise<{
    rows: Array<{
      exitId: string;
      exitDate: Date;
      billNumber: number;
      bagsExited: number;
      saleId: string;
      farmerName: string;
      village: string;
      contactNumber: string;
      lotNo: string;
      marka: string | null;
      coldStorageBillNumber: number | null;
      potatoType: string;
      buyerName: string | null;
      transferToBuyerName: string | null;
      isTransferReversed: number;
      isSelfSale: number;
      paymentStatus: string;
      paymentMode: string | null;
      quantitySold: number;
      coldStorageCharge: number;
      paidAmount: number;
      paidCash: number;
      paidAccount: number;
      discountAllocated: number;
      adjPyReceivables: number;
      adjAdvance: number;
      adjFreight: number;
      adjSelfDue: number;
      dueAmount: number;
      coldChargeShare: number;
      paidShare: number;
      dueShare: number;
      discountShare: number;
    }>;
    summary: {
      totalBagsExited: number;
      farmers: number;
      exitsWithDue: number;
      coldChargesTotal: number;
      cashReceived: number;
      accountReceived: number;
      discountReceived: number;
      roundOffReceived: number;
      receivableAdjReceived: number;
      amountDue: number;
    };
  }> {
    const where: SQL[] = [
      eq(exitHistory.coldStorageId, coldStorageId),
      eq(exitHistory.isReversed, 0),
    ];

    if (filters.year) {
      where.push(sql`EXTRACT(YEAR FROM (${exitHistory.exitDate} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int = ${filters.year}`);
    }
    if (filters.months && filters.months.length > 0) {
      where.push(sql`EXTRACT(MONTH FROM (${exitHistory.exitDate} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int IN (${sql.join(filters.months.map(m => sql`${m}`), sql`, `)})`);
    }
    if (filters.days && filters.days.length > 0) {
      where.push(sql`EXTRACT(DAY FROM (${exitHistory.exitDate} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int IN (${sql.join(filters.days.map(d => sql`${d}`), sql`, `)})`);
    }
    if (filters.farmerName && filters.farmerName.trim()) {
      where.push(ilike(salesHistory.farmerName, `%${filters.farmerName.trim()}%`));
    }
    if (filters.farmerContact && filters.farmerContact.trim()) {
      where.push(eq(salesHistory.contactNumber, filters.farmerContact.trim()));
    }
    if (filters.village && filters.village.trim()) {
      const v = filters.village.trim().toLowerCase();
      where.push(sql`lower(trim(${salesHistory.village})) = ${v}`);
    }
    if (filters.bagType && filters.bagType.trim() && filters.bagType !== "all") {
      const b = filters.bagType.trim().toLowerCase();
      where.push(sql`lower(${salesHistory.bagType}) = ${b}`);
    }
    if (filters.buyerName && filters.buyerName.trim()) {
      const b = filters.buyerName.trim();
      // Effective buyer:
      //   - if isTransferReversed=1 → original buyerName (or self)
      //   - else if transferToBuyerName is non-empty → transferToBuyerName
      //   - else → buyerName (or self if isSelfSale)
      const effectiveBuyer = sql`CASE
        WHEN ${salesHistory.isTransferReversed} = 1 THEN ${salesHistory.buyerName}
        WHEN ${salesHistory.transferToBuyerName} IS NOT NULL AND ${salesHistory.transferToBuyerName} <> '' THEN ${salesHistory.transferToBuyerName}
        ELSE ${salesHistory.buyerName}
      END`;
      if (b.toLowerCase() === "self") {
        // Self only when self-sale AND no active transfer to a different buyer
        where.push(sql`${salesHistory.isSelfSale} = 1 AND (${salesHistory.transferToBuyerName} IS NULL OR ${salesHistory.transferToBuyerName} = '' OR ${salesHistory.isTransferReversed} = 1)`);
      } else {
        where.push(sql`${effectiveBuyer} ILIKE ${`%${b}%`}`);
      }
    }

    const rows = await db
      .select({
        exitId: exitHistory.id,
        exitDate: exitHistory.exitDate,
        billNumber: exitHistory.billNumber,
        bagsExited: exitHistory.bagsExited,
        saleId: salesHistory.id,
        farmerName: salesHistory.farmerName,
        village: salesHistory.village,
        contactNumber: salesHistory.contactNumber,
        lotNo: salesHistory.lotNo,
        marka: salesHistory.marka,
        coldStorageBillNumber: salesHistory.coldStorageBillNumber,
        potatoType: salesHistory.potatoType,
        bagType: salesHistory.bagType,
        buyerName: salesHistory.buyerName,
        transferToBuyerName: salesHistory.transferToBuyerName,
        isTransferReversed: salesHistory.isTransferReversed,
        isSelfSale: salesHistory.isSelfSale,
        paymentStatus: salesHistory.paymentStatus,
        paymentMode: salesHistory.paymentMode,
        quantitySold: salesHistory.quantitySold,
        coldStorageCharge: salesHistory.coldStorageCharge,
        paidAmount: salesHistory.paidAmount,
        paidCash: salesHistory.paidCash,
        paidAccount: salesHistory.paidAccount,
        discountAllocated: salesHistory.discountAllocated,
        adjPyReceivables: salesHistory.adjPyReceivables,
        adjAdvance: salesHistory.adjAdvance,
        adjFreight: salesHistory.adjFreight,
        adjSelfDue: salesHistory.adjSelfDue,
        dueAmount: salesHistory.dueAmount,
        farmerId: salesHistory.farmerId,
        buyerId: salesHistory.buyerId,
      })
      .from(exitHistory)
      .innerJoin(salesHistory, eq(salesHistory.id, exitHistory.salesHistoryId))
      .where(and(...where))
      .orderBy(desc(exitHistory.exitDate), desc(exitHistory.billNumber));

    const enriched = rows.map((r) => {
      const qty = r.quantitySold || 0;
      const share = qty > 0 ? r.bagsExited / qty : 0;
      const coldChargeShare = (r.coldStorageCharge || 0) * share;
      const paidShare = (r.paidAmount || 0) * share;
      const dueShare = (r.dueAmount || 0) * share;
      const discountShare = (r.discountAllocated || 0) * share;
      return {
        ...r,
        isTransferReversed: r.isTransferReversed ?? 0,
        isSelfSale: r.isSelfSale ?? 0,
        paidAmount: r.paidAmount ?? 0,
        paidCash: r.paidCash ?? 0,
        paidAccount: r.paidAccount ?? 0,
        discountAllocated: r.discountAllocated ?? 0,
        adjPyReceivables: r.adjPyReceivables ?? 0,
        adjAdvance: r.adjAdvance ?? 0,
        adjFreight: r.adjFreight ?? 0,
        adjSelfDue: r.adjSelfDue ?? 0,
        dueAmount: r.dueAmount ?? 0,
        coldChargeShare,
        paidShare,
        dueShare,
        discountShare,
      };
    });

    // Cash vs account attribution.
    // Per-row decision:
    //   1) If the sale has non-zero per-sale counters (paid_cash / paid_account),
    //      use them — prorated by bags_exited / quantity_sold like paidShare.
    //      These are kept in lockstep with paid_amount at every receipt
    //      application, so they're accurate for any payment recorded after
    //      the per-sale-split feature shipped.
    //   2) Otherwise (legacy rows whose counters are still zero), fall back
    //      to the sale's payment_mode field, same as before. This preserves
    //      historical reporting without requiring a backfill.
    // Per-sale round-off applied so far, sourced from the
    // cash_receipt_applications junction table. Each application's share of
    // its parent receipt's gross is (amount_applied / (amount + round_off));
    // multiply by round_off to get the round-off slice attributable to this
    // sale. Reattributing this from "Cash Received" to "Discount" lets the
    // exit register surface round-off as a concession instead of bundling it
    // into cash totals.
    const saleIdsForRoundOff = enriched.map((r) => r.saleId);
    const roundOffCashBySale = new Map<string, number>();
    const roundOffAccountBySale = new Map<string, number>();
    if (saleIdsForRoundOff.length > 0) {
      const roundOffRows = await db
        .select({
          saleId: cashReceiptApplications.salesHistoryId,
          // Split by receipt type so we can subtract each slice from the
          // matching bucket (cashReceived / accountReceived) and preserve the
          // exit-register invariant: cash + account + discount + due == coldCharges.
          cashRoundOff: sql<number>`COALESCE(SUM(CASE WHEN ${cashReceipts.receiptType} = 'cash' THEN
            ${cashReceiptApplications.amountApplied}
            * ${cashReceipts.roundOff}
            / NULLIF(${cashReceipts.amount} + ${cashReceipts.roundOff}, 0)
          ELSE 0 END), 0)`,
          accountRoundOff: sql<number>`COALESCE(SUM(CASE WHEN ${cashReceipts.receiptType} = 'account' THEN
            ${cashReceiptApplications.amountApplied}
            * ${cashReceipts.roundOff}
            / NULLIF(${cashReceipts.amount} + ${cashReceipts.roundOff}, 0)
          ELSE 0 END), 0)`,
        })
        .from(cashReceiptApplications)
        .innerJoin(cashReceipts, eq(cashReceipts.id, cashReceiptApplications.cashReceiptId))
        .where(and(
          eq(cashReceiptApplications.coldStorageId, coldStorageId),
          inArray(cashReceiptApplications.salesHistoryId, saleIdsForRoundOff),
          eq(cashReceipts.isReversed, 0),
          sql`${cashReceipts.roundOff} > 0`,
        ))
        .groupBy(cashReceiptApplications.salesHistoryId);
      for (const r of roundOffRows) {
        roundOffCashBySale.set(r.saleId, Number(r.cashRoundOff) || 0);
        roundOffAccountBySale.set(r.saleId, Number(r.accountRoundOff) || 0);
      }
    }

    const farmerSet = new Set<string>();
    let totalBagsExited = 0;
    let exitsWithDue = 0;
    let coldChargesTotal = 0;
    let cashReceived = 0;
    let accountReceived = 0;
    let discountReceived = 0;
    let roundOffCashTotal = 0;
    let roundOffAccountTotal = 0;
    let receivableAdjTotal = 0;
    let cashSelfDueNet = 0;
    let accountSelfDueNet = 0;
    let adjSelfDueTotal = 0;
    let amountDue = 0;
    for (const r of enriched) {
      farmerSet.add(r.contactNumber);
      totalBagsExited += r.bagsExited;
      if (r.dueShare > 0) exitsWithDue += 1;
      coldChargesTotal += r.coldChargeShare;
      amountDue += r.dueShare;

      const qty = r.quantitySold || 0;
      const share = qty > 0 ? r.bagsExited / qty : 0;
      const counterTotal = (r.paidCash || 0) + (r.paidAccount || 0);
      if (counterTotal > 0) {
        cashReceived += (r.paidCash || 0) * share;
        accountReceived += (r.paidAccount || 0) * share;
      } else if (r.paymentMode === "cash") {
        cashReceived += r.paidShare;
      } else if (r.paymentMode === "account") {
        accountReceived += r.paidShare;
      }

      // Discount portion: per-sale discount from sales_history.discount_allocated
      // (sale-linked, prorated by bags_exited / quantity_sold). The receipt's
      // gross amount (amount + roundOff) flows into sales_history.paid_amount
      // during FIFO application, so the round-off slice is currently part of
      // cashReceived above. We pull it back out here and add it to the
      // discount total so round-off concessions are surfaced as discount-like
      // adjustments rather than cash.
      discountReceived += r.discountShare;
      roundOffCashTotal += (roundOffCashBySale.get(r.saleId) || 0) * share;
      roundOffAccountTotal += (roundOffAccountBySale.get(r.saleId) || 0) * share;

      // Receivable adjustments: FIFO allocations of this sale's payments to
      // other receivables (PY receivables / advance / freight) and self-sale
      // due transfers. All four feed the informational "Receivable Adj" card.
      // Only adjSelfDue inflates this sale's paid_amount AND coldStorageCharge
      // (the self-due transfer is paid here and re-billed on the other side),
      // so net it out of cash/account and cold-charges to keep the invariant
      // cash + account + discount + due == coldCharges intact.
      const adjPyShare = (r.adjPyReceivables || 0) * share;
      const adjAdvanceShare = (r.adjAdvance || 0) * share;
      const adjFreightShare = (r.adjFreight || 0) * share;
      const adjSelfDueShare = (r.adjSelfDue || 0) * share;
      receivableAdjTotal += adjPyShare + adjAdvanceShare + adjFreightShare + adjSelfDueShare;
      // adjSelfDue always inflates this sale's coldStorageCharge (the self-due
      // transfer is re-billed on this side), so unconditionally net it out of
      // cold-charges to keep the aggregate invariant
      // cash + account + discount + due == coldCharges. The matching cash
      // inflow lives on the partner self-sale row whose paid_amount is the
      // real cash collected — those two rows balance each other in the totals.
      // The cash/account net-out, however, only fires when we can attribute
      // the self-due payment to a bucket (counters or explicit paymentMode);
      // legacy rows with neither leave cash/account untouched so we don't
      // double-debit a bucket that never received the inflow on this row.
      adjSelfDueTotal += adjSelfDueShare;
      if (counterTotal > 0) {
        cashSelfDueNet += adjSelfDueShare * ((r.paidCash || 0) / counterTotal);
        accountSelfDueNet += adjSelfDueShare * ((r.paidAccount || 0) / counterTotal);
      } else if (r.paymentMode === "cash") {
        cashSelfDueNet += adjSelfDueShare;
      } else if (r.paymentMode === "account") {
        accountSelfDueNet += adjSelfDueShare;
      }
    }

    const roundOffTotal = roundOffCashTotal + roundOffAccountTotal;
    // Subtract each receipt-type's round-off slice from its matching bucket
    // and roll the combined amount into discount. This keeps the invariant
    // cash + account + discount + due == coldCharges (modulo rounding).
    const cashNet = Math.max(0, cashReceived - roundOffCashTotal - cashSelfDueNet);
    const accountNet = Math.max(0, accountReceived - roundOffAccountTotal - accountSelfDueNet);
    const coldChargesNet = Math.max(0, coldChargesTotal - adjSelfDueTotal);
    const discountWithRoundOff = discountReceived + roundOffTotal;

    return {
      rows: enriched,
      summary: {
        totalBagsExited,
        farmers: farmerSet.size,
        exitsWithDue,
        coldChargesTotal: roundAmount(coldChargesNet),
        cashReceived: roundAmount(cashNet),
        accountReceived: roundAmount(accountNet),
        discountReceived: roundAmount(discountWithRoundOff),
        roundOffReceived: roundAmount(roundOffTotal),
        receivableAdjReceived: roundAmount(receivableAdjTotal),
        amountDue: roundAmount(amountDue),
      },
    };
  }

  async getExitRegisterYears(coldStorageId: string): Promise<number[]> {
    const rows = await db.execute<{ year: number }>(sql`
      SELECT DISTINCT EXTRACT(YEAR FROM (${exitHistory.exitDate} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int AS year
      FROM ${exitHistory}
      WHERE ${exitHistory.coldStorageId} = ${coldStorageId} AND ${exitHistory.isReversed} = 0
      ORDER BY year DESC
    `);
    return (rows.rows as Array<{ year: number }>).map(r => Number(r.year)).filter(n => Number.isFinite(n));
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

    // Refresh denormalised exit info on the parent sale row
    await this.syncSaleExitSummary(salesHistoryId);

    return { success: true };
  }

  // Cash Receipts methods
  async getBuyersWithDues(coldStorageId: string): Promise<{ buyerName: string; totalDue: number }[]> {
    // Use Buyer Ledger's netDue for consistent dues across the application
    // netDue = pyReceivables + salesDue + dueTransferIn - dueTransferOut
    // Only include buyers with positive net due (actual dues to collect)
    const ledgerData = await this.getBuyerLedger(coldStorageId, false);
    
    return ledgerData.buyers
      .map(buyer => ({
        buyerName: buyer.buyerName,
        totalDue: buyer.netDue - (buyer.advanceDue || 0)
      }))
      .filter(buyer => buyer.totalDue > 0)
      .sort((a, b) => a.buyerName.toLowerCase().localeCompare(b.buyerName.toLowerCase()));
  }

  async getFarmerReceivablesWithDues(coldStorageId: string, year: number): Promise<{ id: string; farmerLedgerId: string | null; farmerName: string; contactNumber: string; village: string; totalDue: number }[]> {
    const farmers = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.year, year),
        eq(openingReceivables.payerType, "farmer")
      ));

    const selfSalesResult = await db.execute(sql`
      SELECT 
        TRIM(farmer_name) as farmer_name,
        TRIM(contact_number) as contact_number,
        TRIM(village) as village,
        farmer_ledger_id,
        COALESCE(SUM(COALESCE(due_amount, 0) + COALESCE(extra_due_to_merchant, 0)), 0)::float as total_due
      FROM sales_history
      WHERE cold_storage_id = ${coldStorageId}
        AND is_self_sale = 1
        AND sale_year = ${year}
        AND (due_amount > 0 OR extra_due_to_merchant > 0)
        AND (transfer_to_buyer_name IS NULL OR transfer_to_buyer_name = '')
      GROUP BY farmer_ledger_id, TRIM(farmer_name), TRIM(village), TRIM(contact_number)
      HAVING SUM(COALESCE(due_amount, 0) + COALESCE(extra_due_to_merchant, 0)) >= 1
    `);
    const selfSales = selfSalesResult.rows as { farmer_name: string; contact_number: string; village: string; farmer_ledger_id: string | null; total_due: number }[];

    const farmerDuesMap = new Map<string, { id: string; farmerLedgerId: string | null; farmerName: string; contactNumber: string; village: string; totalDue: number }>();

    for (const f of farmers) {
      if (!f.farmerName || !f.contactNumber || !f.village) continue;
      const remainingDue = f.dueAmount - (f.paidAmount || 0);
      if (remainingDue < 1) continue;
      
      const key = f.farmerLedgerId || `composite_${f.farmerName.trim().toLowerCase()}_${f.contactNumber.trim()}_${f.village.trim().toLowerCase()}`;
      const existing = farmerDuesMap.get(key);
      if (existing) {
        existing.totalDue += remainingDue;
      } else {
        farmerDuesMap.set(key, {
          id: f.id,
          farmerLedgerId: f.farmerLedgerId || null,
          farmerName: f.farmerName.trim(),
          contactNumber: f.contactNumber.trim(),
          village: f.village.trim(),
          totalDue: remainingDue
        });
      }
    }

    for (const sale of selfSales) {
      if (!sale.farmer_name || !sale.contact_number || !sale.village) continue;
      const key = sale.farmer_ledger_id || `composite_${sale.farmer_name.trim().toLowerCase()}_${sale.contact_number.trim()}_${sale.village.trim().toLowerCase()}`;
      const existing = farmerDuesMap.get(key);
      if (existing) {
        existing.totalDue += sale.total_due;
      } else {
        farmerDuesMap.set(key, {
          id: `self_sale_${sale.farmer_name.trim()}_${sale.contact_number.trim()}_${sale.village.trim()}`,
          farmerLedgerId: sale.farmer_ledger_id || null,
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

  async createFarmerReceivablePayment(data: { coldStorageId: string; farmerReceivableId: string; farmerLedgerId: string | null; farmerDetails: { farmerName: string; contactNumber: string; village: string } | null; buyerName: string | null; receiptType: string; accountType: string | null; accountId: string | null; amount: number; roundOff?: number; receivedAt: Date; notes: string | null }): Promise<{ receipt: CashReceipt; salesUpdated: number }> {
    if (!data.farmerDetails) {
      throw new Error("Farmer details are required for farmer payments");
    }
    
    const farmerIdentity = {
      farmerName: data.farmerDetails.farmerName,
      contactNumber: data.farmerDetails.contactNumber,
      village: data.farmerDetails.village,
    };
    
    let farmerLedgerEntry;
    if (data.farmerLedgerId) {
      const [entry] = await db.select().from(farmerLedger)
        .where(eq(farmerLedger.id, data.farmerLedgerId)).limit(1);
      farmerLedgerEntry = entry;
    }
    if (!farmerLedgerEntry) {
      const [entry] = await db.select().from(farmerLedger)
        .where(and(
          eq(farmerLedger.coldStorageId, data.coldStorageId),
          sql`LOWER(TRIM(${farmerLedger.name})) = LOWER(TRIM(${farmerIdentity.farmerName}))`,
          sql`TRIM(${farmerLedger.contactNumber}) = TRIM(${farmerIdentity.contactNumber})`,
          sql`LOWER(TRIM(${farmerLedger.village})) = LOWER(TRIM(${farmerIdentity.village}))`
        )).limit(1);
      farmerLedgerEntry = entry;
    }
    const resolvedFarmerLedgerId = farmerLedgerEntry?.id || null;
    
    let totalDueBefore = 0;
    
    const allFarmerReceivables = await db.select()
      .from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, data.coldStorageId),
        sql`LOWER(TRIM(${openingReceivables.payerType})) = 'farmer'`,
        sql`(
          (${openingReceivables.farmerLedgerId} IS NOT NULL AND ${openingReceivables.farmerLedgerId} = ${resolvedFarmerLedgerId})
          OR (${openingReceivables.farmerLedgerId} IS NULL 
            AND LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerIdentity.farmerName}))
            AND TRIM(${openingReceivables.contactNumber}) = TRIM(${farmerIdentity.contactNumber})
            AND LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${farmerIdentity.village})))
        )`
      ))
      .orderBy(openingReceivables.createdAt);
    
    for (const receivable of allFarmerReceivables) {
      const remainingDue = (receivable.finalAmount ?? receivable.dueAmount) - (receivable.paidAmount || 0);
      if (remainingDue > 0) {
        totalDueBefore += remainingDue;
      }
    }
    
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
        AND COALESCE(fifo_exclusion, 0) = 0
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
    // Self-sale applications get inserted into cash_receipt_applications
    // after the receipt id is generated below.
    const pendingSelfSaleApplications: { saleId: string; amount: number }[] = [];
    
    // First apply to receivables (if any)
    for (const receivable of allFarmerReceivables) {
      if (remainingAmount <= 0) break;
      const remainingDue = roundAmount((receivable.finalAmount ?? receivable.dueAmount) - (receivable.paidAmount || 0));
      if (remainingDue <= 0) continue;
      
      const amountToApply = Math.min(remainingAmount, remainingDue);
      
      if (amountToApply > 0) {
        const newPaid = roundAmount((receivable.paidAmount || 0) + amountToApply);
        const interestFields = this.computeInterestAwarePaymentFields(receivable, newPaid, receivable.dueAmount);
        await db.update(openingReceivables)
          .set({ paidAmount: newPaid, ...interestFields })
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
          const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
          const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount);
          await db.update(farmerAdvanceFreight)
            .set({ paidAmount: newPaid, ...interestFields })
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
          const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
          const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount);
          await db.update(farmerAdvanceFreight)
            .set({ paidAmount: newPaid, ...interestFields })
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
        // Credit cash/account counters by the actual increment to paid_amount
        // (applyToDue only — extra_due_to_merchant doesn't flow into paid_amount).
        const cashDelta = data.receiptType === "cash" ? applyToDue : 0;
        const accountDelta = data.receiptType === "account" ? applyToDue : 0;

        await db.execute(sql`
          UPDATE sales_history
          SET 
            due_amount = (${newDueAmount})::real,
            paid_amount = (${newPaidAmount})::real,
            paid_cash = COALESCE(paid_cash, 0) + (${cashDelta})::real,
            paid_account = COALESCE(paid_account, 0) + (${accountDelta})::real,
            extra_due_to_merchant = (${newExtraDue})::real,
            payment_status = CASE 
              WHEN (${newDueAmount})::real + (${newExtraDue})::real < 1.0 THEN 'paid'
              WHEN (${newPaidAmount})::real > 0 THEN 'partial'
              ELSE payment_status
            END
          WHERE id = ${sale.id}
        `);
        
        // Only the portion that flowed into paid_amount counts as a sale-payment
        // application (extra_due_to_merchant doesn't go into paid_amount).
        if (applyToDue > 0) {
          pendingSelfSaleApplications.push({ saleId: sale.id, amount: applyToDue });
        }
        remainingAmount = roundAmount(remainingAmount - amountToApply);
        totalApplied = roundAmount(totalApplied + amountToApply);
        recordsUpdated++;
      }
    }
    
    // Calculate total due after payment
    const totalDueAfter = roundAmount(Math.max(0, totalDueBefore - totalApplied));
    
    // Generate transaction ID
    const transactionId = await generateSequentialId('cash_flow', data.coldStorageId);
    
    const farmerEntry = farmerLedgerEntry || await this.ensureFarmerLedgerEntry(data.coldStorageId, {
      name: farmerIdentity.farmerName,
      contactNumber: farmerIdentity.contactNumber,
      village: farmerIdentity.village,
    });
    
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
        roundOff: data.roundOff || 0,
        receivedAt: data.receivedAt,
        notes: data.notes,
        transactionId,
        dueBalanceAfter: totalDueAfter,
        farmerLedgerId: farmerEntry.id,
        farmerId: farmerEntry.farmerId,
      })
      .returning();

    for (const app of pendingSelfSaleApplications) {
      await this.recordReceiptApplication(
        data.coldStorageId,
        receipt.id,
        app.saleId,
        app.amount,
        data.receivedAt,
      );
    }

    return { receipt, salesUpdated: recordsUpdated };
  }

  async createManualSalePayment(data: { coldStorageId: string; saleId: string; receiptType: string; accountType: string | null; accountId: string | null; amount: number; roundOff?: number; receivedAt: Date; notes: string | null }): Promise<{ receipt: CashReceipt; salesUpdated: number }> {
    // Fetch the target sale
    const [sale] = await db.select().from(salesHistory)
      .where(and(eq(salesHistory.id, data.saleId), eq(salesHistory.coldStorageId, data.coldStorageId)))
      .limit(1);
    if (!sale) throw new Error("Sale not found");

    const gross = roundAmount(data.amount); // amount already includes roundOff (route layer composes it)
    const billedAmount = sale.coldStorageCharge || 0;
    const currentDue = roundAmount(sale.dueAmount || 0);

    if (currentDue <= 0) throw new Error("This sale has no outstanding due");
    if (gross <= 0) throw new Error("Payment amount must be greater than zero");
    if (gross > currentDue) throw new Error(`Payment amount (₹${gross}) exceeds current due (₹${currentDue})`);

    // Enforce the same lifecycle guard the UI shows — block when FIFO has already
    // partially paid into this sale (flag=0 AND due < billed). Direct API callers must
    // reverse those FIFO receipts first. Allowed when flag=1 (already manually closed).
    const flag = sale.fifoExclusion || 0;
    if (flag === 0 && currentDue < billedAmount - 0.5) {
      throw new Error("FIFO has already paid into this sale — reverse those receipts before recording a manual payment");
    }

    // Apply payment to this single sale only — no FIFO hop
    const newPaidAmount = roundAmount((sale.paidAmount || 0) + gross);
    const newDueAmount = roundAmount(currentDue - gross);
    const paymentMode = data.receiptType as "cash" | "account";
    const cashDelta = paymentMode === "cash" ? gross : 0;
    const accountDelta = paymentMode === "account" ? gross : 0;
    // Mirror existing FIFO semantics from createCashReceiptWithFIFO: status flips to "paid"
    // once remaining due is < ₹1 (petty-balance threshold), but we PRESERVE the actual
    // rounded due so reversal stays symmetric (avoids losing a fractional residual).
    const newStatus = newDueAmount < 1 ? "paid" : "partial";

    await db.update(salesHistory)
      .set({
        paidAmount: newPaidAmount,
        dueAmount: newDueAmount,
        paidCash: sql`COALESCE(${salesHistory.paidCash}, 0) + ${cashDelta}`,
        paidAccount: sql`COALESCE(${salesHistory.paidAccount}, 0) + ${accountDelta}`,
        paymentStatus: newStatus,
        paymentMode: paymentMode,
        paidAt: newStatus === "paid" ? data.receivedAt : sale.paidAt,
        // Stamp the sale as FIFO-excluded so future receipts don't allocate to it
        fifoExclusion: 1,
      })
      .where(eq(salesHistory.id, data.saleId));

    // Recompute lot totals so Stock Register row reflects the new state
    if (sale.lotId) {
      await this.recalculateLotTotals(sale.lotId);
    }

    // Determine display fields & ledger references for the receipt row
    const isSelf = (sale.isSelfSale || 0) === 1;
    let payerType: string;
    let buyerDisplayName: string;
    let farmerLedgerId: string | null = null;
    let farmerId: string | null = null;
    let buyerLedgerId: string | null = null;
    let buyerId: string | null = null;
    let dueBalanceAfter: number | null = null;

    if (isSelf) {
      payerType = "farmer";
      buyerDisplayName = `${sale.farmerName} (${sale.village})`;
      if (sale.farmerLedgerId) {
        farmerLedgerId = sale.farmerLedgerId;
        farmerId = sale.farmerId || null;
      } else {
        const farmerEntry = await this.ensureFarmerLedgerEntry(data.coldStorageId, {
          name: sale.farmerName,
          contactNumber: sale.contactNumber,
          village: sale.village,
        });
        farmerLedgerId = farmerEntry.id;
        farmerId = farmerEntry.farmerId;
      }
    } else {
      payerType = "cold_merchant";
      const useTransferred = !!sale.transferToBuyerName && (sale.isTransferReversed || 0) === 0;
      buyerDisplayName = (useTransferred ? sale.transferToBuyerName! : (sale.buyerName || "")) || "";
      buyerLedgerId = sale.buyerLedgerId || null;
      buyerId = sale.buyerId || null;
      if (buyerDisplayName) {
        try {
          dueBalanceAfter = await this.getBuyerDueBalance(data.coldStorageId, buyerDisplayName);
        } catch {
          dueBalanceAfter = null;
        }
      }
    }

    const transactionId = await generateSequentialId('cash_flow', data.coldStorageId);

    const [receipt] = await db.insert(cashReceipts)
      .values({
        id: randomUUID(),
        coldStorageId: data.coldStorageId,
        payerType,
        buyerName: buyerDisplayName || null,
        receiptType: data.receiptType,
        accountType: data.accountType,
        accountId: data.accountId,
        amount: gross,
        roundOff: data.roundOff || 0,
        receivedAt: data.receivedAt,
        notes: data.notes,
        appliedAmount: gross,
        unappliedAmount: 0,
        transactionId,
        dueBalanceAfter,
        farmerLedgerId,
        farmerId,
        buyerLedgerId,
        buyerId,
        appliesToSaleId: data.saleId,
      })
      .returning();

    // Persist the application row for this manual single-sale payment.
    await this.recordReceiptApplication(
      data.coldStorageId,
      receipt.id,
      data.saleId,
      gross,
      data.receivedAt,
    );

    // Suppress unused var lint — billedAmount kept for clarity / future use
    void billedAmount;

    return { receipt, salesUpdated: 1 };
  }

  async getCashReceipts(coldStorageId: string): Promise<CashReceipt[]> {
    return await db.select()
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

  // ---- Cash Receipt Application helpers ----------------------------------
  // The cash_receipt_applications table records each (cash_receipt → sales_history,
  // amount_applied) pair as receipts are applied. Reversal & recompute paths
  // delete and re-insert so the table always reflects active allocations.
  private async recordReceiptApplication(
    coldStorageId: string,
    cashReceiptId: string,
    salesHistoryId: string,
    amountApplied: number,
    appliedAt?: Date | null,
  ): Promise<void> {
    const amt = roundAmount(amountApplied || 0);
    if (amt <= 0) return;
    await db.insert(cashReceiptApplications).values({
      id: randomUUID(),
      coldStorageId,
      cashReceiptId,
      salesHistoryId,
      amountApplied: amt,
      ...(appliedAt ? { appliedAt } : {}),
    });
  }

  private async clearApplicationsForReceipt(receiptId: string): Promise<void> {
    await db.delete(cashReceiptApplications)
      .where(eq(cashReceiptApplications.cashReceiptId, receiptId));
  }

  // Clear applications for any receipt belonging to a buyer in a given cs.
  // Called at the start of recomputeBuyerPayments so the subsequent FIFO
  // replay can re-create the rows from scratch.
  private async clearApplicationsForBuyer(coldStorageId: string, buyerName: string): Promise<void> {
    const receiptIds = await db.select({ id: cashReceipts.id })
      .from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${cashReceipts.buyerName})) = LOWER(TRIM(${buyerName}))`,
      ));
    if (receiptIds.length === 0) return;
    await db.delete(cashReceiptApplications)
      .where(inArray(cashReceiptApplications.cashReceiptId, receiptIds.map(r => r.id)));
  }

  // Clear applications for farmer receipts matching this farmer identity.
  // Called at the start of recomputeFarmerPayments / WithDiscounts.
  private async clearApplicationsForFarmer(
    coldStorageId: string,
    farmerLedgerId: string | null,
    farmerName: string,
    village: string,
  ): Promise<void> {
    const buyerDisplayName = `${farmerName.trim()} (${village.trim()})`;
    const receiptIds = await db.select({ id: cashReceipts.id })
      .from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.payerType, "farmer"),
        sql`(
          (${cashReceipts.farmerLedgerId} IS NOT NULL AND ${cashReceipts.farmerLedgerId} = ${farmerLedgerId})
          OR (${cashReceipts.farmerLedgerId} IS NULL AND LOWER(TRIM(${cashReceipts.buyerName})) = LOWER(TRIM(${buyerDisplayName})))
        )`,
      ));
    if (receiptIds.length === 0) return;
    await db.delete(cashReceiptApplications)
      .where(inArray(cashReceiptApplications.cashReceiptId, receiptIds.map(r => r.id)));
  }

  async createCashReceiptWithFIFO(data: InsertCashReceipt): Promise<{ receipt: CashReceipt; salesUpdated: number }> {
    let remainingAmount = data.amount;
    let appliedAmount = 0;
    let salesUpdated = 0;
    const paymentMode = data.receiptType as "cash" | "account";
    const currentYear = new Date().getFullYear();
    // Track per-sale paidAmount contributions so we can write
    // cash_receipt_applications rows after the receipt id is created.
    const pendingApplications: { saleId: string; amount: number }[] = [];

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
          sql`(COALESCE(${openingReceivables.finalAmount}, ${openingReceivables.dueAmount}) - ${openingReceivables.paidAmount}) > 0`
        ))
        .orderBy(openingReceivables.createdAt); // FIFO - oldest first

      for (const receivable of buyerReceivables) {
        if (remainingAmount <= 0) break;

        const receivableDue = roundAmount((receivable.finalAmount ?? receivable.dueAmount ?? 0) - (receivable.paidAmount || 0));
        if (receivableDue <= 0) continue;

        if (remainingAmount >= receivableDue) {
          const newPaid = roundAmount((receivable.paidAmount || 0) + receivableDue);
          const interestFields = this.computeInterestAwarePaymentFields(receivable, newPaid, receivable.dueAmount);
          await db.update(openingReceivables)
            .set({ paidAmount: newPaid, ...interestFields })
            .where(eq(openingReceivables.id, receivable.id));
          
          remainingAmount = roundAmount(remainingAmount - receivableDue);
          appliedAmount = roundAmount(appliedAmount + receivableDue);
        } else {
          const newPaidAmount = roundAmount((receivable.paidAmount || 0) + remainingAmount);
          const interestFields = this.computeInterestAwarePaymentFields(receivable, newPaidAmount, receivable.dueAmount);
          await db.update(openingReceivables)
            .set({ paidAmount: newPaidAmount, ...interestFields })
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
        sql`${salesHistory.paymentStatus} IN ('due', 'partial')`,
        sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
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
        // Can fully pay this sale — credit the cash/account counter by the
        // increment we just added (saleDueAmount), not by the new total.
        const cashDelta = paymentMode === "cash" ? saleDueAmount : 0;
        const accountDelta = paymentMode === "account" ? saleDueAmount : 0;
        await db.update(salesHistory)
          .set({
            paymentStatus: "paid",
            paidAmount: totalCharges,
            paidCash: sql`COALESCE(${salesHistory.paidCash}, 0) + ${cashDelta}`,
            paidAccount: sql`COALESCE(${salesHistory.paidAccount}, 0) + ${accountDelta}`,
            dueAmount: 0,
            paymentMode: paymentMode,
            paidAt: data.receivedAt,
          })
          .where(eq(salesHistory.id, sale.id));
        
        pendingApplications.push({ saleId: sale.id, amount: saleDueAmount });
        remainingAmount = roundAmount(remainingAmount - saleDueAmount);
        appliedAmount = roundAmount(appliedAmount + saleDueAmount);
        salesUpdated++;
      } else {
        // Can only partially pay this sale
        const newPaidAmount = roundAmount((sale.paidAmount || 0) + remainingAmount);
        const newDueAmount = roundAmount(totalCharges - newPaidAmount);
        const cashDelta = paymentMode === "cash" ? remainingAmount : 0;
        const accountDelta = paymentMode === "account" ? remainingAmount : 0;
        
        // If remaining due is less than ₹1, treat as fully paid (petty balance threshold)
        const paymentStatusToSet = newDueAmount < 1 ? "paid" : "partial";
        
        await db.update(salesHistory)
          .set({
            paymentStatus: paymentStatusToSet,
            paidAmount: newPaidAmount,
            paidCash: sql`COALESCE(${salesHistory.paidCash}, 0) + ${cashDelta}`,
            paidAccount: sql`COALESCE(${salesHistory.paidAccount}, 0) + ${accountDelta}`,
            dueAmount: newDueAmount,
            paymentMode: paymentMode,
          })
          .where(eq(salesHistory.id, sale.id));
        
        pendingApplications.push({ saleId: sale.id, amount: remainingAmount });
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
          sql`${salesHistory.extraDueToMerchant} > 0`,
          sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
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

    // Persist per-sale application rows so reports/bills can show exactly
    // which payment closed which sale.
    for (const app of pendingApplications) {
      await this.recordReceiptApplication(
        data.coldStorageId,
        receipt.id,
        app.saleId,
        app.amount,
        data.receivedAt,
      );
    }

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
      const remaining = (receivable.finalAmount ?? receivable.dueAmount ?? 0) - (receivable.paidAmount || 0);
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

  async getExpenses(coldStorageId: string): Promise<(Expense & { advanceRateOfInterest?: number; advanceEffectiveDate?: Date | null })[]> {
    const expenseList = await db.select().from(expenses)
      .where(eq(expenses.coldStorageId, coldStorageId))
      .orderBy(desc(expenses.paidAt));

    const advanceExpenseIds = expenseList
      .filter(e => e.expenseType === "merchant_advance" || e.expenseType === "farmer_advance" || e.expenseType === "farmer_freight")
      .map(e => e.id);

    if (advanceExpenseIds.length === 0) {
      return expenseList;
    }

    const farmerRows = await db.select({
      expenseId: farmerAdvanceFreight.expenseId,
      rateOfInterest: farmerAdvanceFreight.rateOfInterest,
      effectiveDate: farmerAdvanceFreight.effectiveDate,
    }).from(farmerAdvanceFreight)
      .where(inArray(farmerAdvanceFreight.expenseId, advanceExpenseIds));

    const merchantRows = await db.select({
      expenseId: merchantAdvance.expenseId,
      rateOfInterest: merchantAdvance.rateOfInterest,
      effectiveDate: merchantAdvance.effectiveDate,
    }).from(merchantAdvance)
      .where(inArray(merchantAdvance.expenseId, advanceExpenseIds));

    const advanceMetaMap = new Map<string, { roi: number; effDate: Date | null }>();
    for (const r of farmerRows) {
      if (r.expenseId) advanceMetaMap.set(r.expenseId, { roi: r.rateOfInterest, effDate: r.effectiveDate });
    }
    for (const r of merchantRows) {
      if (r.expenseId && !advanceMetaMap.has(r.expenseId)) advanceMetaMap.set(r.expenseId, { roi: r.rateOfInterest, effDate: r.effectiveDate });
    }

    return expenseList.map(e => {
      const meta = advanceMetaMap.get(e.id);
      if (!meta) return e;
      return { ...e, advanceRateOfInterest: meta.roi, advanceEffectiveDate: meta.effDate };
    });
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

    // Drop any application rows that pointed sales at this receipt; if a
    // recompute path runs below it will reinsert fresh rows for the surviving
    // (still non-reversed) receipts in the buyer/farmer pool.
    await this.clearApplicationsForReceipt(receiptId);

    // ---- Manual single-sale closure receipts: reverse only the targeted sale (no FIFO replay) ----
    if (receipt.appliesToSaleId && receipt.coldStorageId) {
      const [sale] = await db.select().from(salesHistory)
        .where(and(eq(salesHistory.id, receipt.appliesToSaleId), eq(salesHistory.coldStorageId, receipt.coldStorageId)))
        .limit(1);
      if (sale) {
        const gross = receipt.amount || 0;
        const billed = sale.coldStorageCharge || 0;
        const currentPaid = sale.paidAmount || 0;
        const currentDue = sale.dueAmount || 0;
        const newPaid = roundAmount(Math.max(0, currentPaid - gross));
        const newDue = roundAmount(currentDue + gross);
        const cashDelta = receipt.receiptType === "cash" ? gross : 0;
        const accountDelta = receipt.receiptType === "account" ? gross : 0;

        // If due returns to original billed amount → reset fifoExclusion so the sale rejoins FIFO.
        // Safety: only reset when no OTHER unreversed manual-closure receipts are still active on this sale
        // (handles out-of-order reversals when multiple manual payments exist).
        const dueReturnedToBilled = Math.abs(newDue - billed) < 1;
        let otherActiveManualReceipts = 0;
        if (dueReturnedToBilled) {
          const others = await db.select({ id: cashReceipts.id })
            .from(cashReceipts)
            .where(and(
              eq(cashReceipts.appliesToSaleId, receipt.appliesToSaleId),
              eq(cashReceipts.coldStorageId, receipt.coldStorageId),
              eq(cashReceipts.isReversed, 0),
              sql`${cashReceipts.id} <> ${receipt.id}`
            ));
          otherActiveManualReceipts = others.length;
        }
        const newFifoExclusion = (dueReturnedToBilled && otherActiveManualReceipts === 0) ? 0 : 1;

        let newStatus: string;
        if (newDue < 1) newStatus = "paid";
        else if (newPaid > 0) newStatus = "partial";
        else newStatus = "due";

        await db.update(salesHistory)
          .set({
            paidAmount: newPaid,
            dueAmount: newDue,
            paidCash: sql`GREATEST(COALESCE(${salesHistory.paidCash}, 0) - ${cashDelta}, 0)`,
            paidAccount: sql`GREATEST(COALESCE(${salesHistory.paidAccount}, 0) - ${accountDelta}, 0)`,
            paymentStatus: newStatus,
            fifoExclusion: newFifoExclusion,
            paidAt: newStatus === "paid" ? sale.paidAt : null,
          })
          .where(eq(salesHistory.id, receipt.appliesToSaleId));

        if (sale.lotId) {
          await this.recalculateLotTotals(sale.lotId);
        }
      }
      return { success: true, message: "Receipt reversed and sale due restored" };
    }

    // Handle recomputation based on payer type
    if (receipt.payerType === "farmer_loan" && receipt.coldStorageId && receipt.buyerLedgerId) {
      const appliedIds: string[] = receipt.appliedAdvanceIds ? JSON.parse(receipt.appliedAdvanceIds) : [];
      for (const loanId of appliedIds) {
        const [loan] = await db.select().from(farmerLoan).where(eq(farmerLoan.id, loanId));
        if (loan) {
          await db.insert(farmerLoanEvents).values({
            id: randomUUID(),
            farmerLoanId: loanId,
            eventType: 'payment_reversal',
            eventDate: new Date(),
            amount: loan.amount,
            rateOfInterest: loan.rateOfInterest,
            latestPrincipalBefore: loan.latestPrincipal,
            latestPrincipalAfter: loan.latestPrincipal,
            effectiveDateBefore: loan.effectiveDate,
            effectiveDateAfter: loan.effectiveDate,
            finalAmountBefore: loan.finalAmount,
            finalAmountAfter: loan.finalAmount,
            paidAmountBefore: loan.paidAmount,
            paidAmountAfter: loan.paidAmount,
            paymentAmount: receipt.amount,
            receiptId: receipt.id,
          });
        }
      }
      await this.recomputeFarmerLoanPayments(receipt.coldStorageId, receipt.buyerLedgerId);
    } else if (receipt.payerType === "cold_merchant_advance" && receipt.coldStorageId && receipt.buyerLedgerId) {
      await this.recomputeMerchantAdvancePayments(receipt.coldStorageId, receipt.buyerLedgerId);
    } else if (receipt.payerType === "farmer" && receipt.coldStorageId && receipt.buyerName) {
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
          await this.recomputeFarmerPaymentsWithDiscounts(receipt.coldStorageId, receipt.farmerLedgerId || null, farmerName, contactNumber, village);
        } else {
          // Fallback to old method if contactNumber not found
          await this.recomputeFarmerPayments(receipt.coldStorageId, receipt.farmerLedgerId || null, receipt.buyerName);
        }
      } else {
        // buyerName doesn't match expected "FarmerName (Village)" format - use old method as fallback
        await this.recomputeFarmerPayments(receipt.coldStorageId, receipt.farmerLedgerId || null, receipt.buyerName);
      }
    } else if (receipt.buyerName && receipt.coldStorageId) {
      // Use unified recomputeBuyerPayments to properly handle both receipts AND discounts
      // This replaces the old custom FIFO replay that only considered receipts
      await this.recomputeBuyerPayments(receipt.buyerName, receipt.coldStorageId);
    }

    return { success: true, message: "Receipt reversed and payments recalculated" };
  }

  async recomputeFarmerPayments(coldStorageId: string, farmerLedgerId: string | null, buyerDisplayName: string | null): Promise<{ receivablesUpdated: number }> {
    let farmerName: string;
    let contactNumber: string;
    let village: string;
    let resolvedLedgerId = farmerLedgerId;

    if (farmerLedgerId) {
      const [entry] = await db.select()
        .from(farmerLedger)
        .where(eq(farmerLedger.id, farmerLedgerId))
        .limit(1);
      if (!entry) return { receivablesUpdated: 0 };
      farmerName = entry.name;
      contactNumber = entry.contactNumber;
      village = entry.village;
    } else {
      if (!buyerDisplayName) return { receivablesUpdated: 0 };
      const match = buyerDisplayName.match(/^(.+?)\s*\((.+?)\)$/);
      if (!match) return { receivablesUpdated: 0 };
      farmerName = match[1].trim();
      village = match[2].trim();

      let foundContact: string | null = null;
      const farmerReceivables = await db.select()
        .from(openingReceivables)
        .where(and(
          eq(openingReceivables.coldStorageId, coldStorageId),
          eq(openingReceivables.payerType, "farmer"),
          sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName}))`,
          sql`LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`
        ))
        .limit(1);

      if (farmerReceivables.length > 0) {
        foundContact = farmerReceivables[0].contactNumber;
      } else {
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
          foundContact = selfSalesForFarmer[0].contactNumber;
        }
      }

      if (!foundContact) return { receivablesUpdated: 0 };
      contactNumber = foundContact;

      const [ledgerEntry] = await db.select()
        .from(farmerLedger)
        .where(and(
          eq(farmerLedger.coldStorageId, coldStorageId),
          sql`LOWER(TRIM(${farmerLedger.name})) = LOWER(TRIM(${farmerName}))`,
          sql`TRIM(${farmerLedger.contactNumber}) = TRIM(${contactNumber})`,
          sql`LOWER(TRIM(${farmerLedger.village})) = LOWER(TRIM(${village}))`
        ))
        .limit(1);
      if (ledgerEntry) {
        resolvedLedgerId = ledgerEntry.id;
      }
    }

    const selfSalePattern = `${farmerName.trim()} - ${contactNumber.trim()} - ${village.trim()}`;

    // Wipe stale per-sale application rows for this farmer's receipts so the
    // FIFO replay below can repopulate them deterministically.
    await this.clearApplicationsForFarmer(coldStorageId, resolvedLedgerId, farmerName, village);

    // Step 1: Reset all farmer receivables paidAmount to 0, restore previous interest state
    const fallbackReceivables = await db.select().from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.payerType, "farmer"),
        resolvedLedgerId
          ? or(eq(openingReceivables.farmerLedgerId, resolvedLedgerId), and(isNull(openingReceivables.farmerLedgerId), sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName})) AND TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber}) AND LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`))
          : and(isNull(openingReceivables.farmerLedgerId), sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName})) AND TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber}) AND LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`)
      ));
    const todayFallback = new Date();
    todayFallback.setHours(0, 0, 0, 0);
    for (const recv of fallbackReceivables) {
      const resetFields: Record<string, unknown> = { paidAmount: 0, previousEffectiveDate: null, previousLatestPrincipal: null };
      if (recv.previousEffectiveDate && recv.rateOfInterest > 0) {
        const accrualTarget = recv.lastAccrualDate ? new Date(recv.lastAccrualDate) : todayFallback;
        accrualTarget.setHours(0, 0, 0, 0);
        const recomputed = this.computeYearlySimpleInterest(
          recv.previousLatestPrincipal ?? recv.dueAmount,
          recv.previousEffectiveDate,
          recv.rateOfInterest,
          accrualTarget
        );
        resetFields.effectiveDate = recomputed.effectiveDate;
        resetFields.latestPrincipal = recomputed.latestPrincipal;
        resetFields.finalAmount = recomputed.finalAmount;
      }
      await db.update(openingReceivables).set(resetFields).where(eq(openingReceivables.id, recv.id));
    }

    // Step 1b: Reset farmer advance/freight paidAmount to 0, restore previous interest state
    if (resolvedLedgerId) {
      const fallbackAdvances = await db.select().from(farmerAdvanceFreight)
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, resolvedLedgerId),
          eq(farmerAdvanceFreight.isReversed, 0)
        ));
      for (const adv of fallbackAdvances) {
        const resetFields: Record<string, unknown> = { paidAmount: 0, previousEffectiveDate: null, previousLatestPrincipal: null };
        if (adv.previousEffectiveDate && adv.rateOfInterest > 0) {
          const accrualTarget = adv.lastAccrualDate ? new Date(adv.lastAccrualDate) : todayFallback;
          accrualTarget.setHours(0, 0, 0, 0);
          const recomputed = this.computeYearlySimpleInterest(
            adv.previousLatestPrincipal ?? adv.amount,
            adv.previousEffectiveDate,
            adv.rateOfInterest,
            accrualTarget
          );
          resetFields.effectiveDate = recomputed.effectiveDate;
          resetFields.latestPrincipal = recomputed.latestPrincipal;
          resetFields.finalAmount = recomputed.finalAmount;
        }
        await db.update(farmerAdvanceFreight).set(resetFields).where(eq(farmerAdvanceFreight.id, adv.id));
      }
    }

    // Step 2: Reset all self-sales for this farmer to original due amounts
    await db.execute(sql`
      UPDATE sales_history
      SET 
        paid_amount = 0,
        paid_cash = 0,
        paid_account = 0,
        due_amount = cold_storage_charge,
        extra_due_to_merchant = COALESCE(extra_due_to_merchant_original, 0),
        payment_status = CASE 
          WHEN cold_storage_charge + COALESCE(extra_due_to_merchant_original, 0) < 1 THEN 'paid'
          ELSE 'due'
        END
      WHERE cold_storage_id = ${coldStorageId}
        AND COALESCE(fifo_exclusion, 0) = 0
        AND (
          (COALESCE(is_self_sale, 0) = 1 
           AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
           AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
           AND TRIM(contact_number) = TRIM(${contactNumber}))
          OR
          (LOWER(TRIM(CASE WHEN is_transfer_reversed = 1 THEN buyer_name ELSE COALESCE(NULLIF(transfer_to_buyer_name, ''), buyer_name) END)) = LOWER(TRIM(${selfSalePattern})))
        )
    `);

    // Step 3: Get farmer receipts for this farmer, ordered chronologically
    const buyerDisplayNameForMatch = `${farmerName.trim()} (${village.trim()})`;

    const activeReceipts = await db.select()
      .from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.payerType, "farmer"),
        eq(cashReceipts.isReversed, 0),
        sql`(
          (${cashReceipts.farmerLedgerId} IS NOT NULL AND ${cashReceipts.farmerLedgerId} = ${resolvedLedgerId})
          OR (${cashReceipts.farmerLedgerId} IS NULL AND LOWER(TRIM(${cashReceipts.buyerName})) = LOWER(TRIM(${buyerDisplayNameForMatch})))
        )`
      ))
      .orderBy(cashReceipts.receivedAt);

    let receivablesUpdated = 0;

    // Step 4: Apply each receipt in FIFO order: receivables → freight → advance → self-sales
    for (const receipt of activeReceipts) {
      let remainingAmount = receipt.amount;

      // Pass 1: Farmer receivables
      const currentReceivables = await db.select()
        .from(openingReceivables)
        .where(and(
          eq(openingReceivables.coldStorageId, coldStorageId),
          eq(openingReceivables.payerType, "farmer"),
          sql`(
            (${openingReceivables.farmerLedgerId} IS NOT NULL AND ${openingReceivables.farmerLedgerId} = ${resolvedLedgerId})
            OR (${openingReceivables.farmerLedgerId} IS NULL AND LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName})) AND TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber}) AND LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village})))
          )`,
          sql`(COALESCE(${openingReceivables.finalAmount}, ${openingReceivables.dueAmount}) - COALESCE(${openingReceivables.paidAmount}, 0)) > 0`
        ))
        .orderBy(openingReceivables.createdAt);

      for (const receivable of currentReceivables) {
        if (remainingAmount <= 0) break;
        const remainingDue = roundAmount((receivable.finalAmount ?? receivable.dueAmount ?? 0) - (receivable.paidAmount || 0));
        const amountToApply = Math.min(remainingAmount, remainingDue);
        if (amountToApply > 0) {
          const newPaid = roundAmount((receivable.paidAmount || 0) + amountToApply);
          const interestFields = this.computeInterestAwarePaymentFields(receivable, newPaid, receivable.dueAmount, receipt.receivedAt);
          await db.update(openingReceivables)
            .set({ paidAmount: newPaid, ...interestFields })
            .where(eq(openingReceivables.id, receivable.id));
          remainingAmount = roundAmount(remainingAmount - amountToApply);
          receivablesUpdated++;
        }
      }

      // Pass 2: Farmer FREIGHT records
      if (remainingAmount > 0 && resolvedLedgerId) {
        const freightRecords = await db.select()
          .from(farmerAdvanceFreight)
          .where(and(
            eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
            eq(farmerAdvanceFreight.farmerLedgerId, resolvedLedgerId),
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
            const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
            const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, receipt.receivedAt);
            await db.update(farmerAdvanceFreight)
              .set({ paidAmount: newPaid, ...interestFields })
              .where(eq(farmerAdvanceFreight.id, record.id));
            remainingAmount = roundAmount(remainingAmount - amountToApply);
            receivablesUpdated++;
          }
        }
      }

      // Pass 3: Farmer ADVANCE records
      if (remainingAmount > 0 && resolvedLedgerId) {
        const advanceRecords = await db.select()
          .from(farmerAdvanceFreight)
          .where(and(
            eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
            eq(farmerAdvanceFreight.farmerLedgerId, resolvedLedgerId),
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
            const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
            const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, receipt.receivedAt);
            await db.update(farmerAdvanceFreight)
              .set({ paidAmount: newPaid, ...interestFields })
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
            sql`(due_amount > 0 OR extra_due_to_merchant > 0)`,
            sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
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
          // Bump the cash/account counter by the same delta added to paidAmount.
          const paidDelta = applyToDue + applyToExtra;
          const cashDelta = receipt.receiptType === "cash" ? paidDelta : 0;
          const accountDelta = receipt.receiptType === "account" ? paidDelta : 0;

          await db.update(salesHistory)
            .set({
              dueAmount: newDueAmount,
              paidAmount: newPaidAmount,
              paidCash: sql`COALESCE(${salesHistory.paidCash}, 0) + ${cashDelta}`,
              paidAccount: sql`COALESCE(${salesHistory.paidAccount}, 0) + ${accountDelta}`,
              extraDueToMerchant: newExtraDue,
              paymentStatus
            })
            .where(eq(salesHistory.id, sale.id));

          // Only the portion that flowed into paid_amount counts as a sale-payment
          // application (extra_due_to_merchant doesn't go into paid_amount).
          if (applyToDue > 0) {
            await this.recordReceiptApplication(coldStorageId, receipt.id, sale.id, applyToDue, receipt.receivedAt);
          }
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

    // If this is a merchant_advance expense, also reverse the linked merchantAdvance record
    if (expense.expenseType === "merchant_advance") {
      await db.update(merchantAdvance)
        .set({
          isReversed: 1,
          reversedAt: new Date(),
        })
        .where(eq(merchantAdvance.expenseId, expenseId));
    }

    if (expense.expenseType === "farmer_loan") {
      const [linkedLoan] = await db.select().from(farmerLoan)
        .where(eq(farmerLoan.expenseId, expenseId));
      if (linkedLoan) {
        await db.update(farmerLoan)
          .set({ isReversed: 1, reversedAt: new Date() })
          .where(eq(farmerLoan.id, linkedLoan.id));
        await this.recomputeFarmerLoanPayments(linkedLoan.coldStorageId, linkedLoan.farmerLedgerId);
      }
    }

    // If this is a loan_principal expense, also reverse the linked liability payment
    if (expense.expenseType === "loan_principal") {
      const [linkedPayment] = await db.select()
        .from(liabilityPayments)
        .where(and(
          eq(liabilityPayments.linkedExpenseId, expenseId),
          eq(liabilityPayments.isReversed, 0),
        ));
      if (linkedPayment) {
        await this.reverseLiabilityPayment(linkedPayment.id);
      }
    }

    return { success: true, message: "Expense reversed" };
  }

  async recomputeBuyerPayments(buyerName: string, coldStorageId: string): Promise<{ salesUpdated: number; receiptsUpdated: number }> {
    // Wipe stale application rows for this buyer's receipts; the FIFO replay
    // below will repopulate them with the correct (receipt → sale) mappings.
    await this.clearApplicationsForBuyer(coldStorageId, buyerName);

    // Step 1: Reset all sales for this buyer to "due" status with 0 paidAmount
    // Calculate proper dueAmount using all surcharges
    // Use CurrentDueBuyerName logic: match transferToBuyerName first, else buyerName
    // BUT if transfer is reversed (isTransferReversed = 1), use original buyerName
    const buyerSales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(CASE WHEN ${salesHistory.isTransferReversed} = 1 THEN ${salesHistory.buyerName} ELSE COALESCE(NULLIF(${salesHistory.transferToBuyerName}, ''), ${salesHistory.buyerName}) END)) = LOWER(TRIM(${buyerName}))`,
        sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
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
          paidCash: 0,
          paidAccount: 0,
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
        sql`(${salesHistory.extraDueToMerchantOriginal} > 0 OR ${salesHistory.extraDueToMerchant} > 0)`,
        sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
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
    // Also restore previousEffectiveDate/previousLatestPrincipal if saved
    const currentYear = new Date().getFullYear();
    const receivables = await db.select().from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.year, currentYear),
        eq(openingReceivables.payerType, "cold_merchant"),
        sql`LOWER(TRIM(${openingReceivables.buyerName})) = LOWER(TRIM(${buyerName}))`
      ));
    for (const recv of receivables) {
      const resetFields: Record<string, unknown> = { paidAmount: 0, previousEffectiveDate: null, previousLatestPrincipal: null };
      if (recv.previousEffectiveDate && recv.rateOfInterest > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const recomputed = this.computeYearlySimpleInterest(
          recv.previousLatestPrincipal ?? recv.dueAmount,
          recv.previousEffectiveDate,
          recv.rateOfInterest,
          today
        );
        resetFields.effectiveDate = recomputed.effectiveDate;
        resetFields.latestPrincipal = recomputed.latestPrincipal;
        resetFields.finalAmount = recomputed.finalAmount;
      }
      await db.update(openingReceivables).set(resetFields).where(eq(openingReceivables.id, recv.id));
    }

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
          sql`(COALESCE(${openingReceivables.finalAmount}, ${openingReceivables.dueAmount}) - ${openingReceivables.paidAmount}) > 0`
        ))
        .orderBy(openingReceivables.createdAt);

      for (const receivable of buyerReceivables) {
        if (remainingAmount <= 0) break;

        const receivableDue = roundAmount((receivable.finalAmount ?? receivable.dueAmount ?? 0) - (receivable.paidAmount || 0));
        if (receivableDue <= 0) continue;

        if (remainingAmount >= receivableDue) {
          const newPaid = roundAmount((receivable.paidAmount || 0) + receivableDue);
          const interestFields = this.computeInterestAwarePaymentFields(receivable, newPaid, receivable.dueAmount, receipt.receivedAt);
          await db.update(openingReceivables)
            .set({ paidAmount: newPaid, ...interestFields })
            .where(eq(openingReceivables.id, receivable.id));
          
          remainingAmount = roundAmount(remainingAmount - receivableDue);
          appliedAmount = roundAmount(appliedAmount + receivableDue);
        } else {
          const newPaidAmount = roundAmount((receivable.paidAmount || 0) + remainingAmount);
          const interestFields = this.computeInterestAwarePaymentFields(receivable, newPaidAmount, receivable.dueAmount, receipt.receivedAt);
          await db.update(openingReceivables)
            .set({ paidAmount: newPaidAmount, ...interestFields })
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
          sql`${salesHistory.paymentStatus} IN ('due', 'partial')`,
          sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
        ))
        .orderBy(salesHistory.soldAt);

      for (const sale of sales) {
        if (remainingAmount <= 0) break;

        const totalCharges = sale.coldStorageCharge || 0;
        const saleDueAmount = roundAmount(totalCharges - (sale.paidAmount || 0));
        
        if (saleDueAmount <= 0) continue;

        if (remainingAmount >= saleDueAmount) {
          const cashDelta = paymentMode === "cash" ? saleDueAmount : 0;
          const accountDelta = paymentMode === "account" ? saleDueAmount : 0;
          await db.update(salesHistory)
            .set({
              paymentStatus: "paid",
              paidAmount: totalCharges,
              paidCash: sql`COALESCE(${salesHistory.paidCash}, 0) + ${cashDelta}`,
              paidAccount: sql`COALESCE(${salesHistory.paidAccount}, 0) + ${accountDelta}`,
              dueAmount: 0,
              paymentMode: paymentMode,
              paidAt: receipt.receivedAt,
            })
            .where(eq(salesHistory.id, sale.id));
          
          await this.recordReceiptApplication(coldStorageId, receipt.id, sale.id, saleDueAmount, receipt.receivedAt);
          remainingAmount = roundAmount(remainingAmount - saleDueAmount);
          appliedAmount = roundAmount(appliedAmount + saleDueAmount);
        } else {
          const newPaidAmount = roundAmount((sale.paidAmount || 0) + remainingAmount);
          const newDueAmount = roundAmount(totalCharges - newPaidAmount);
          const cashDelta = paymentMode === "cash" ? remainingAmount : 0;
          const accountDelta = paymentMode === "account" ? remainingAmount : 0;
          
          // If remaining due is less than ₹1, treat as fully paid (petty balance threshold)
          const paymentStatusToSet = newDueAmount < 1 ? "paid" : "partial";
          
          await db.update(salesHistory)
            .set({
              paymentStatus: paymentStatusToSet,
              paidAmount: newPaidAmount,
              paidCash: sql`COALESCE(${salesHistory.paidCash}, 0) + ${cashDelta}`,
              paidAccount: sql`COALESCE(${salesHistory.paidAccount}, 0) + ${accountDelta}`,
              dueAmount: newDueAmount,
              paymentMode: paymentMode,
            })
            .where(eq(salesHistory.id, sale.id));
          
          await this.recordReceiptApplication(coldStorageId, receipt.id, sale.id, remainingAmount, receipt.receivedAt);
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
          sql`${salesHistory.extraDueToMerchant} > 0`,
          sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
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
        AND COALESCE(fifo_exclusion, 0) = 0
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
        // Keep paid_cash / paid_account in sync with the new paidAmount.
        // If the existing counters sum > 0, scale them proportionally so the
        // cash:account ratio is preserved. If counters are zero (legacy rows),
        // leave them at zero — the Exit Register fallback will use payment_mode.
        const existingCash = sale.paidCash || 0;
        const existingAccount = sale.paidAccount || 0;
        const counterTotal = existingCash + existingAccount;
        const setFields: Record<string, unknown> = {
          paidAmount: newPaidAmount,
          dueAmount: newDueAmount,
        };
        if (counterTotal > 0) {
          if (newPaidAmount <= 0) {
            setFields.paidCash = 0;
            setFields.paidAccount = 0;
          } else {
            const scale = newPaidAmount / counterTotal;
            setFields.paidCash = roundAmount(existingCash * scale);
            setFields.paidAccount = roundAmount(existingAccount * scale);
          }
        }
        await db.update(salesHistory)
          .set(setFields)
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
    // Concurrency-safe assignment: wraps the (read existing → atomically
    // bump counter → conditionally write back) trio in a single
    // transaction. The counter increment uses UPDATE … RETURNING so two
    // concurrent calls cannot both read the same value and produce
    // duplicate bill numbers across different sales.
    return await db.transaction(async (tx) => {
      const [sale] = await tx.select()
        .from(salesHistory)
        .where(eq(salesHistory.id, saleId));
      if (!sale) {
        throw new Error("Sale not found");
      }

      const existingBillNumber = billType === "coldStorage"
        ? sale.coldStorageBillNumber
        : sale.salesBillNumber;
      if (existingBillNumber) {
        return existingBillNumber;
      }

      // Atomic increment — returns the post-increment counter value.
      // Postgres serialises updates on the same row, so concurrent
      // callers each receive a unique value here.
      const counterRow = billType === "coldStorage"
        ? await tx.update(coldStorages)
            .set({ nextColdStorageBillNumber: sql`COALESCE(${coldStorages.nextColdStorageBillNumber}, 1) + 1` })
            .where(eq(coldStorages.id, sale.coldStorageId))
            .returning({ next: coldStorages.nextColdStorageBillNumber })
        : await tx.update(coldStorages)
            .set({ nextSalesBillNumber: sql`COALESCE(${coldStorages.nextSalesBillNumber}, 1) + 1` })
            .where(eq(coldStorages.id, sale.coldStorageId))
            .returning({ next: coldStorages.nextSalesBillNumber });

      if (counterRow.length === 0 || counterRow[0].next == null) {
        throw new Error("Cold storage not found");
      }
      const billNumber = (counterRow[0].next as number) - 1;

      // Conditional write — only assign if still null. If two callers
      // race for the SAME saleId, the loser's increment is wasted (a
      // skipped number) but no duplicate bill is ever assigned.
      const wrote = billType === "coldStorage"
        ? await tx.update(salesHistory)
            .set({ coldStorageBillNumber: billNumber })
            .where(and(eq(salesHistory.id, saleId), isNull(salesHistory.coldStorageBillNumber)))
            .returning({ id: salesHistory.id })
        : await tx.update(salesHistory)
            .set({ salesBillNumber: billNumber })
            .where(and(eq(salesHistory.id, saleId), isNull(salesHistory.salesBillNumber)))
            .returning({ id: salesHistory.id });

      if (wrote.length > 0) {
        return billNumber;
      }

      // Lost the race — re-read and return whichever number won.
      const [refetched] = await tx.select()
        .from(salesHistory)
        .where(eq(salesHistory.id, saleId));
      const winner = billType === "coldStorage"
        ? refetched?.coldStorageBillNumber
        : refetched?.salesBillNumber;
      if (winner == null) {
        throw new Error("Bill number assignment failed");
      }
      return winner;
    });
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
    await db.delete(bankAccounts).where(eq(bankAccounts.coldStorageId, id));
    
    // Delete assets and depreciation log
    await db.delete(assetDepreciationLog).where(eq(assetDepreciationLog.coldStorageId, id));
    await db.delete(assets).where(eq(assets.coldStorageId, id));
    
    // Delete liabilities and payments
    await db.delete(liabilityPayments).where(eq(liabilityPayments.coldStorageId, id));
    await db.delete(liabilities).where(eq(liabilities.coldStorageId, id));
    
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

  async getFarmerRecords(coldStorageId: string, year?: number, includeArchived?: boolean): Promise<{ farmerName: string; village: string; tehsil: string; district: string; state: string; contactNumber: string; farmerLedgerId: string; farmerId: string; entityType: string; customColdChargeRate: number | null; customHammaliRate: number | null }[]> {
    const conditions = [eq(farmerLedger.coldStorageId, coldStorageId)];
    if (!includeArchived) {
      conditions.push(eq(farmerLedger.isArchived, 0));
    }
    const farmers = await db.select({
      farmerLedgerId: farmerLedger.id,
      farmerId: farmerLedger.farmerId,
      farmerName: farmerLedger.name,
      village: farmerLedger.village,
      tehsil: farmerLedger.tehsil,
      district: farmerLedger.district,
      state: farmerLedger.state,
      contactNumber: farmerLedger.contactNumber,
      entityType: farmerLedger.entityType,
      customColdChargeRate: farmerLedger.customColdChargeRate,
      customHammaliRate: farmerLedger.customHammaliRate,
    })
      .from(farmerLedger)
      .where(and(...conditions))
      .orderBy(farmerLedger.name);

    return farmers.map(f => ({
      farmerLedgerId: f.farmerLedgerId || "",
      farmerId: f.farmerId || "",
      farmerName: f.farmerName || "",
      village: f.village || "",
      tehsil: f.tehsil || "",
      district: f.district || "",
      state: f.state || "",
      contactNumber: f.contactNumber || "",
      entityType: f.entityType || "farmer",
      customColdChargeRate: f.customColdChargeRate ?? null,
      customHammaliRate: f.customHammaliRate ?? null,
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
    
    let computedFinalAmount: number = data.dueAmount;
    let computedLatestPrincipal: number = data.dueAmount;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let computedLastAccrualDate: Date = today;
    let computedEffectiveDate: Date | undefined;
    
    if (data.rateOfInterest && data.rateOfInterest > 0 && data.effectiveDate) {
      const result = this.computeYearlySimpleInterest(
        data.dueAmount,
        new Date(data.effectiveDate),
        data.rateOfInterest,
        today
      );
      computedFinalAmount = result.finalAmount;
      computedLatestPrincipal = result.latestPrincipal;
      computedEffectiveDate = result.effectiveDate;
    }
    
    const [receivable] = await db.insert(openingReceivables)
      .values({
        id: randomUUID(),
        ...data,
        buyerLedgerId,
        buyerId,
        finalAmount: computedFinalAmount,
        latestPrincipal: computedLatestPrincipal,
        lastAccrualDate: computedLastAccrualDate,
        ...(computedEffectiveDate ? { effectiveDate: computedEffectiveDate } : {}),
      })
      .returning();
    return receivable;
  }

  async updateOpeningReceivable(id: string, updates: { dueAmount?: number; rateOfInterest?: number; effectiveDate?: Date | null; remarks?: string | null }): Promise<OpeningReceivable | undefined> {
    const [existing] = await db.select()
      .from(openingReceivables)
      .where(eq(openingReceivables.id, id));
    
    if (!existing) return undefined;

    const newDueAmount = updates.dueAmount ?? existing.dueAmount;
    const newRateOfInterest = updates.rateOfInterest ?? existing.rateOfInterest;
    const newEffectiveDate = updates.effectiveDate !== undefined ? updates.effectiveDate : existing.effectiveDate;
    const newRemarks = updates.remarks !== undefined ? updates.remarks : existing.remarks;

    let computedFinalAmount = newDueAmount;
    let computedLatestPrincipal = newDueAmount;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let computedLastAccrualDate = today;
    let computedEffectiveDate: Date | null = newEffectiveDate;

    if (newRateOfInterest > 0 && newEffectiveDate) {
      const result = this.computeYearlySimpleInterest(
        newDueAmount,
        new Date(newEffectiveDate),
        newRateOfInterest,
        today
      );
      computedFinalAmount = result.finalAmount;
      computedLatestPrincipal = result.latestPrincipal;
      computedEffectiveDate = result.effectiveDate;
    }

    const [updated] = await db.update(openingReceivables)
      .set({
        dueAmount: newDueAmount,
        rateOfInterest: newRateOfInterest,
        effectiveDate: computedEffectiveDate,
        remarks: newRemarks,
        finalAmount: computedFinalAmount,
        latestPrincipal: computedLatestPrincipal,
        lastAccrualDate: computedLastAccrualDate,
      })
      .where(eq(openingReceivables.id, id))
      .returning();

    return updated;
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
          SELECT id, due_amount, paid_amount, final_amount, rate_of_interest, latest_principal, effective_date
          FROM opening_receivables
          WHERE cold_storage_id = ${data.coldStorageId}
            AND LOWER(TRIM(payer_type)) = 'farmer'
            AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${data.farmerName}))
            AND LOWER(TRIM(village)) = LOWER(TRIM(${data.village}))
            AND TRIM(contact_number) = TRIM(${data.contactNumber})
            AND (COALESCE(final_amount, due_amount) - COALESCE(paid_amount, 0)) > 0
          ORDER BY created_at ASC
        `);
        
        for (const row of receivablesResult.rows as { id: string; due_amount: number; paid_amount: number | null; final_amount: number | null; rate_of_interest: number | null; latest_principal: number | null; effective_date: string | null }[]) {
          if (remainingAmount <= 0) break;
          
          const receivableId = row.id;
          const currentDue = (row.final_amount ?? row.due_amount) - (row.paid_amount || 0);
          const discountToApply = Math.min(remainingAmount, currentDue);
          
          if (discountToApply > 0) {
            const newPaid = roundAmount((row.paid_amount || 0) + discountToApply);
            const interestFields = this.computeInterestAwarePaymentFields({ latestPrincipal: row.latest_principal ?? null, effectiveDate: row.effective_date ?? null, rateOfInterest: row.rate_of_interest || 0, finalAmount: row.final_amount ?? row.due_amount, paidAmount: row.paid_amount ?? null }, newPaid, row.due_amount);
            await db.update(openingReceivables)
              .set({ paidAmount: newPaid, ...interestFields })
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
                const newPaid = roundAmount((record.paidAmount || 0) + discountToApply);
                const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount);
                await db.update(farmerAdvanceFreight)
                  .set({ paidAmount: newPaid, ...interestFields })
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
                  const newPaid = roundAmount((record.paidAmount || 0) + discountToApply);
                  const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount);
                  await db.update(farmerAdvanceFreight)
                    .set({ paidAmount: newPaid, ...interestFields })
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
              AND COALESCE(fifo_exclusion, 0) = 0
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
            AND COALESCE(fifo_exclusion, 0) = 0
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
        discount.farmerLedgerId || null,
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
    farmerLedgerId: string | null,
    farmerName: string, 
    contactNumber: string, 
    village: string
  ): Promise<{ receivablesUpdated: number; selfSalesUpdated: number }> {
    // Wipe stale per-sale application rows for this farmer's receipts so the
    // FIFO replay below can repopulate them deterministically.
    await this.clearApplicationsForFarmer(coldStorageId, farmerLedgerId, farmerName, village);

    // Step 1: Reset all farmer receivables paidAmount to 0, restore previous interest state
    const farmerReceivables = await db.select().from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.payerType, "farmer"),
        farmerLedgerId
          ? or(eq(openingReceivables.farmerLedgerId, farmerLedgerId), and(isNull(openingReceivables.farmerLedgerId), sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName})) AND TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber}) AND LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`))
          : and(isNull(openingReceivables.farmerLedgerId), sql`LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName})) AND TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber}) AND LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village}))`)
      ));
    for (const recv of farmerReceivables) {
      const resetFields: Record<string, unknown> = { paidAmount: 0, previousEffectiveDate: null, previousLatestPrincipal: null };
      if (recv.previousEffectiveDate && recv.rateOfInterest > 0) {
        const accrualTarget = recv.lastAccrualDate ? new Date(recv.lastAccrualDate) : new Date();
        accrualTarget.setHours(0, 0, 0, 0);
        const recomputed = this.computeYearlySimpleInterest(
          recv.previousLatestPrincipal ?? recv.dueAmount,
          recv.previousEffectiveDate,
          recv.rateOfInterest,
          accrualTarget
        );
        resetFields.effectiveDate = recomputed.effectiveDate;
        resetFields.latestPrincipal = recomputed.latestPrincipal;
        resetFields.finalAmount = recomputed.finalAmount;
      }
      await db.update(openingReceivables).set(resetFields).where(eq(openingReceivables.id, recv.id));
    }
    
    // Step 1b: Reset all farmer advance/freight paidAmount to 0
    let farmerLedgerEntryForDiscount;
    if (farmerLedgerId) {
      const [entry] = await db.select()
        .from(farmerLedger)
        .where(eq(farmerLedger.id, farmerLedgerId))
        .limit(1);
      farmerLedgerEntryForDiscount = entry;
    } else {
      const [entry] = await db.select()
        .from(farmerLedger)
        .where(and(
          eq(farmerLedger.coldStorageId, coldStorageId),
          sql`LOWER(TRIM(${farmerLedger.name})) = LOWER(TRIM(${farmerName}))`,
          sql`TRIM(${farmerLedger.contactNumber}) = TRIM(${contactNumber})`,
          sql`LOWER(TRIM(${farmerLedger.village})) = LOWER(TRIM(${village}))`
        ))
        .limit(1);
      farmerLedgerEntryForDiscount = entry;
    }
    
    if (farmerLedgerEntryForDiscount) {
      const farmerAdvances = await db.select().from(farmerAdvanceFreight)
        .where(and(
          eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
          eq(farmerAdvanceFreight.farmerLedgerId, farmerLedgerEntryForDiscount.id),
          eq(farmerAdvanceFreight.isReversed, 0)
        ));
      for (const adv of farmerAdvances) {
        const resetFields: Record<string, unknown> = { paidAmount: 0, previousEffectiveDate: null, previousLatestPrincipal: null };
        if (adv.previousEffectiveDate && adv.rateOfInterest > 0) {
          const accrualTarget = adv.lastAccrualDate ? new Date(adv.lastAccrualDate) : new Date();
          accrualTarget.setHours(0, 0, 0, 0);
          const recomputed = this.computeYearlySimpleInterest(
            adv.previousLatestPrincipal ?? adv.amount,
            adv.previousEffectiveDate,
            adv.rateOfInterest,
            accrualTarget
          );
          resetFields.effectiveDate = recomputed.effectiveDate;
          resetFields.latestPrincipal = recomputed.latestPrincipal;
          resetFields.finalAmount = recomputed.finalAmount;
        }
        await db.update(farmerAdvanceFreight).set(resetFields).where(eq(farmerAdvanceFreight.id, adv.id));
      }
    }
    
    // Step 2: Reset all self-sales for this farmer to original due amounts
    // Match by farmer composite key (name + phone + village)
    // Also match by buyer pattern which contains these elements
    const selfSalePattern = `${farmerName.trim()} - ${contactNumber.trim()} - ${village.trim()}`;
    
    await db.execute(sql`
      UPDATE sales_history
      SET 
        paid_amount = 0,
        paid_cash = 0,
        paid_account = 0,
        discount_allocated = 0,
        due_amount = cold_storage_charge,
        extra_due_to_merchant = COALESCE(extra_due_to_merchant_original, 0),
        payment_status = CASE 
          WHEN cold_storage_charge + COALESCE(extra_due_to_merchant_original, 0) < 1 THEN 'paid'
          ELSE 'due'
        END
      WHERE cold_storage_id = ${coldStorageId}
        AND COALESCE(fifo_exclusion, 0) = 0
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
    // Match by farmerLedgerId first, then fallback to buyerName pattern
    const buyerDisplayName = `${farmerName.trim()} (${village.trim()})`;
    
    const activeReceipts = await db.select()
      .from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.payerType, "farmer"),
        eq(cashReceipts.isReversed, 0),
        sql`(
          (${cashReceipts.farmerLedgerId} IS NOT NULL AND ${cashReceipts.farmerLedgerId} = ${farmerLedgerId})
          OR (${cashReceipts.farmerLedgerId} IS NULL AND LOWER(TRIM(${cashReceipts.buyerName})) = LOWER(TRIM(${buyerDisplayName})))
        )`
      ))
      .orderBy(cashReceipts.receivedAt);
    
    // Step 4: Get non-reversed discounts for this farmer that affect self-sales
    const activeDiscounts = await db.select()
      .from(discounts)
      .where(and(
        eq(discounts.coldStorageId, coldStorageId),
        eq(discounts.isReversed, 0),
        sql`(
          (${discounts.farmerLedgerId} IS NOT NULL AND ${discounts.farmerLedgerId} = ${farmerLedgerId})
          OR (${discounts.farmerLedgerId} IS NULL AND LOWER(TRIM(${discounts.farmerName})) = LOWER(TRIM(${farmerName})) AND LOWER(TRIM(${discounts.village})) = LOWER(TRIM(${village})) AND TRIM(${discounts.contactNumber}) = TRIM(${contactNumber}))
        )`
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
    
    // Step 4b: Reset adj allocation fields on non-self sales for this farmer
    await db.execute(sql`
      UPDATE sales_history
      SET adj_py_receivables = 0, adj_freight = 0, adj_advance = 0, adj_self_due = 0
      WHERE cold_storage_id = ${coldStorageId}
        AND COALESCE(fifo_exclusion, 0) = 0
        AND (COALESCE(is_self_sale, 0) != 1)
        AND COALESCE(adj_receivable_self_due_amount, 0) > 0
        AND (
          (farmer_ledger_id IS NOT NULL AND farmer_ledger_id = ${farmerLedgerEntryForDiscount?.id || ''})
          OR (
            farmer_ledger_id IS NULL
            AND LOWER(TRIM(farmer_name)) = LOWER(TRIM(${farmerName}))
            AND TRIM(contact_number) = TRIM(${contactNumber})
            AND LOWER(TRIM(village)) = LOWER(TRIM(${village}))
          )
        )
    `);
    
    // Step 4c: Get non-self sales with adj amounts for this farmer (for FIFO timeline)
    const adjSales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        sql`(COALESCE(is_self_sale, 0) != 1)`,
        sql`COALESCE(adj_receivable_self_due_amount, 0) > 0`,
        sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`,
        sql`(
          (${salesHistory.farmerLedgerId} IS NOT NULL AND ${salesHistory.farmerLedgerId} = ${farmerLedgerEntryForDiscount?.id || ''})
          OR (
            ${salesHistory.farmerLedgerId} IS NULL
            AND LOWER(TRIM(${salesHistory.farmerName})) = LOWER(TRIM(${farmerName}))
            AND TRIM(${salesHistory.contactNumber}) = TRIM(${contactNumber})
            AND LOWER(TRIM(${salesHistory.village})) = LOWER(TRIM(${village}))
          )
        )`
      ))
      .orderBy(salesHistory.soldAt);
    
    // Step 5: Merge receipts, discounts, and adj allocations into timeline and sort by date
    type Transaction = 
      | { type: 'receipt'; data: typeof activeReceipts[0]; date: Date }
      | { type: 'discount'; data: DiscountWithAllocation; date: Date }
      | { type: 'adj'; data: typeof adjSales[0]; date: Date };
    
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
    
    for (const adjSale of adjSales) {
      transactions.push({
        type: 'adj',
        data: adjSale,
        date: new Date(adjSale.soldAt || adjSale.createdAt)
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
            sql`(
              (${openingReceivables.farmerLedgerId} IS NOT NULL AND ${openingReceivables.farmerLedgerId} = ${farmerLedgerId})
              OR (${openingReceivables.farmerLedgerId} IS NULL AND LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName})) AND TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber}) AND LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village})))
            )`,
            sql`(COALESCE(${openingReceivables.finalAmount}, ${openingReceivables.dueAmount}) - COALESCE(${openingReceivables.paidAmount}, 0)) > 0`
          ))
          .orderBy(openingReceivables.createdAt);
        
        for (const receivable of currentReceivables) {
          if (remainingAmount <= 0) break;
          const remainingDue = roundAmount((receivable.finalAmount ?? receivable.dueAmount ?? 0) - (receivable.paidAmount || 0));
          const amountToApply = Math.min(remainingAmount, remainingDue);
          
          if (amountToApply > 0) {
            const newPaid = roundAmount((receivable.paidAmount || 0) + amountToApply);
            const interestFields = this.computeInterestAwarePaymentFields(receivable, newPaid, receivable.dueAmount, txn.date);
            await db.update(openingReceivables)
              .set({ paidAmount: newPaid, ...interestFields })
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
              const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
              const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, txn.date);
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: newPaid, ...interestFields })
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
              const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
              const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, txn.date);
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: newPaid, ...interestFields })
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
              sql`(due_amount > 0 OR extra_due_to_merchant > 0)`,
              sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
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
            // Bump the cash/account counter by the same delta added to paidAmount.
            const paidDelta = applyToDue + applyToExtra;
            const cashDelta = txn.data.receiptType === "cash" ? paidDelta : 0;
            const accountDelta = txn.data.receiptType === "account" ? paidDelta : 0;
            
            await db.update(salesHistory)
              .set({
                dueAmount: newDueAmount,
                paidAmount: newPaidAmount,
                paidCash: sql`COALESCE(${salesHistory.paidCash}, 0) + ${cashDelta}`,
                paidAccount: sql`COALESCE(${salesHistory.paidAccount}, 0) + ${accountDelta}`,
                extraDueToMerchant: newExtraDue,
                paymentStatus
              })
              .where(eq(salesHistory.id, sale.id));

            // Only the portion that flowed into paid_amount counts as a sale-payment
            // application (extra_due_to_merchant doesn't go into paid_amount).
            if (applyToDue > 0) {
              await this.recordReceiptApplication(coldStorageId, txn.data.id, sale.id, applyToDue, txn.data.receivedAt);
            }
            remainingAmount = roundAmount(remainingAmount - amountToApply);
            selfSalesUpdated++;
          }
        }
      } else if (txn.type === 'adj') {
        // Apply adj allocation FIFO: PY Receivables → Freight → Advance → Self Due
        let remainingAmount = txn.data.adjReceivableSelfDueAmount || 0;
        let adjPy = 0, adjFreight = 0, adjAdvance = 0, adjSelfDue = 0;
        
        // Pass 1: PY Receivables
        const adjReceivables = await db.select()
          .from(openingReceivables)
          .where(and(
            eq(openingReceivables.coldStorageId, coldStorageId),
            eq(openingReceivables.payerType, "farmer"),
            sql`(
              (${openingReceivables.farmerLedgerId} IS NOT NULL AND ${openingReceivables.farmerLedgerId} = ${farmerLedgerId})
              OR (${openingReceivables.farmerLedgerId} IS NULL AND LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName})) AND TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber}) AND LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village})))
            )`,
            sql`(COALESCE(${openingReceivables.finalAmount}, ${openingReceivables.dueAmount}) - COALESCE(${openingReceivables.paidAmount}, 0)) > 0`
          ))
          .orderBy(openingReceivables.createdAt);
        
        for (const receivable of adjReceivables) {
          if (remainingAmount <= 0) break;
          const remainingDue = roundAmount((receivable.finalAmount ?? receivable.dueAmount ?? 0) - (receivable.paidAmount || 0));
          const amountToApply = Math.min(remainingAmount, remainingDue);
          if (amountToApply > 0) {
            const newPaid = roundAmount((receivable.paidAmount || 0) + amountToApply);
            const interestFields = this.computeInterestAwarePaymentFields(receivable, newPaid, receivable.dueAmount, txn.date);
            await db.update(openingReceivables)
              .set({ paidAmount: newPaid, ...interestFields })
              .where(eq(openingReceivables.id, receivable.id));
            remainingAmount = roundAmount(remainingAmount - amountToApply);
            adjPy = roundAmount(adjPy + amountToApply);
            receivablesUpdated++;
          }
        }
        
        // Pass 2: Freight
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
              const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
              const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, txn.date);
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: newPaid, ...interestFields })
                .where(eq(farmerAdvanceFreight.id, record.id));
              remainingAmount = roundAmount(remainingAmount - amountToApply);
              adjFreight = roundAmount(adjFreight + amountToApply);
            }
          }
        }
        
        // Pass 3: Advance
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
              const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
              const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, txn.date);
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: newPaid, ...interestFields })
                .where(eq(farmerAdvanceFreight.id, record.id));
              remainingAmount = roundAmount(remainingAmount - amountToApply);
              adjAdvance = roundAmount(adjAdvance + amountToApply);
            }
          }
        }
        
        // Pass 4: Self Due
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
              sql`(due_amount > 0 OR extra_due_to_merchant > 0)`,
              sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
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
            adjSelfDue = roundAmount(adjSelfDue + amountToApply);
            selfSalesUpdated++;
          }
        }
        
        // Update the per-bucket allocation fields on this sale record
        await db.update(salesHistory)
          .set({
            adjPyReceivables: adjPy,
            adjFreight: adjFreight,
            adjAdvance: adjAdvance,
            adjSelfDue: adjSelfDue,
          })
          .where(eq(salesHistory.id, txn.data.id));
        
      } else {
        // Apply discount FIFO: receivables first, then self-sales
        let remainingAmount = txn.data.amount;
        
        // Pass 1: Apply discount to farmer receivables first
        const discountReceivables = await db.select()
          .from(openingReceivables)
          .where(and(
            eq(openingReceivables.coldStorageId, coldStorageId),
            eq(openingReceivables.payerType, "farmer"),
            sql`(
              (${openingReceivables.farmerLedgerId} IS NOT NULL AND ${openingReceivables.farmerLedgerId} = ${farmerLedgerId})
              OR (${openingReceivables.farmerLedgerId} IS NULL AND LOWER(TRIM(${openingReceivables.farmerName})) = LOWER(TRIM(${farmerName})) AND TRIM(${openingReceivables.contactNumber}) = TRIM(${contactNumber}) AND LOWER(TRIM(${openingReceivables.village})) = LOWER(TRIM(${village})))
            )`,
            sql`(COALESCE(${openingReceivables.finalAmount}, ${openingReceivables.dueAmount}) - COALESCE(${openingReceivables.paidAmount}, 0)) > 0`
          ))
          .orderBy(openingReceivables.createdAt);
        
        for (const receivable of discountReceivables) {
          if (remainingAmount <= 0) break;
          const remainingDue = roundAmount((receivable.finalAmount ?? receivable.dueAmount ?? 0) - (receivable.paidAmount || 0));
          const amountToApply = Math.min(remainingAmount, remainingDue);
          
          if (amountToApply > 0) {
            const newPaid = roundAmount((receivable.paidAmount || 0) + amountToApply);
            const interestFields = this.computeInterestAwarePaymentFields(receivable, newPaid, receivable.dueAmount, txn.date);
            await db.update(openingReceivables)
              .set({ paidAmount: newPaid, ...interestFields })
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
              const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
              const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, txn.date);
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: newPaid, ...interestFields })
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
              const newPaid = roundAmount((record.paidAmount || 0) + amountToApply);
              const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, txn.date);
              await db.update(farmerAdvanceFreight)
                .set({ paidAmount: newPaid, ...interestFields })
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
              sql`due_amount > 0`,
              sql`COALESCE(${salesHistory.fifoExclusion}, 0) = 0`
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

  async updateFarmerPaymentStatus(saleId: string, status: string, paidAt: string | null): Promise<SalesHistory | undefined> {
    const [updated] = await db.update(salesHistory)
      .set({ farmerPaymentStatus: status, farmerPaidAt: paidAt })
      .where(eq(salesHistory.id, saleId))
      .returning();
    return updated;
  }

  async updateSalesHistoryFarmerDetails(
    lotId: string,
    updates: { farmerName?: string; village?: string; tehsil?: string; district?: string; state?: string; contactNumber?: string; farmerLedgerId?: string; farmerId?: string },
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
    if (updates.farmerLedgerId !== undefined) filteredUpdates.farmerLedgerId = updates.farmerLedgerId;
    if (updates.farmerId !== undefined) filteredUpdates.farmerId = updates.farmerId;

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

  async createMerchantAdvance(data: InsertMerchantAdvance): Promise<MerchantAdvance> {
    const [record] = await db.insert(merchantAdvance)
      .values({
        id: randomUUID(),
        ...data,
      })
      .returning();

    await db.insert(merchantAdvanceEvents).values({
      id: randomUUID(),
      merchantAdvanceId: record.id,
      eventType: 'creation',
      eventDate: record.effectiveDate,
      amount: record.amount,
      rateOfInterest: record.rateOfInterest,
      latestPrincipalBefore: null,
      latestPrincipalAfter: record.latestPrincipal ?? record.amount,
      effectiveDateBefore: null,
      effectiveDateAfter: record.effectiveDate,
      finalAmountBefore: null,
      finalAmountAfter: record.finalAmount,
      paidAmountBefore: null,
      paidAmountAfter: 0,
    });

    return record;
  }

  async getMerchantAdvances(coldStorageId: string, buyerLedgerId?: string): Promise<MerchantAdvance[]> {
    if (buyerLedgerId) {
      return db.select().from(merchantAdvance)
        .where(and(
          eq(merchantAdvance.coldStorageId, coldStorageId),
          eq(merchantAdvance.buyerLedgerId, buyerLedgerId),
          eq(merchantAdvance.isReversed, 0)
        ))
        .orderBy(desc(merchantAdvance.createdAt));
    }
    return db.select().from(merchantAdvance)
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        eq(merchantAdvance.isReversed, 0)
      ))
      .orderBy(desc(merchantAdvance.createdAt));
  }

  async getBuyersWithAdvanceDues(coldStorageId: string): Promise<{ buyerLedgerId: string; buyerId: string; buyerName: string; advanceDue: number }[]> {
    const records = await db.select()
      .from(merchantAdvance)
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        eq(merchantAdvance.isReversed, 0)
      ));

    const grouped = new Map<string, { buyerLedgerId: string; buyerId: string; advanceDue: number }>();
    for (const r of records) {
      const remaining = (r.finalAmount || 0) - (r.paidAmount || 0);
      if (remaining <= 0) continue;
      const existing = grouped.get(r.buyerLedgerId);
      if (existing) {
        existing.advanceDue += remaining;
      } else {
        grouped.set(r.buyerLedgerId, {
          buyerLedgerId: r.buyerLedgerId,
          buyerId: r.buyerId,
          advanceDue: remaining,
        });
      }
    }

    const buyerLedgerRecords = await db.select()
      .from(buyerLedger)
      .where(eq(buyerLedger.coldStorageId, coldStorageId));

    const buyerNameMap = new Map<string, string>();
    for (const bl of buyerLedgerRecords) {
      buyerNameMap.set(bl.id, bl.buyerName);
    }

    const result: { buyerLedgerId: string; buyerId: string; buyerName: string; advanceDue: number }[] = [];
    for (const [ledgerId, data] of grouped) {
      const name = buyerNameMap.get(ledgerId);
      if (name && data.advanceDue > 0) {
        result.push({
          buyerLedgerId: ledgerId,
          buyerId: data.buyerId,
          buyerName: name,
          advanceDue: Math.round(data.advanceDue * 100) / 100,
        });
      }
    }

    return result.sort((a, b) => a.buyerName.toLowerCase().localeCompare(b.buyerName.toLowerCase()));
  }

  async payMerchantAdvance(coldStorageId: string, buyerLedgerId: string, amount: number): Promise<{ totalApplied: number; recordsUpdated: number }> {
    const records = await db.select()
      .from(merchantAdvance)
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        eq(merchantAdvance.buyerLedgerId, buyerLedgerId),
        eq(merchantAdvance.isReversed, 0)
      ))
      .orderBy(asc(merchantAdvance.effectiveDate));

    let remaining = amount;
    let totalApplied = 0;
    let recordsUpdated = 0;

    for (const record of records) {
      if (remaining <= 0) break;
      const due = (record.finalAmount || 0) - (record.paidAmount || 0);
      if (due <= 0) continue;

      const applyAmount = Math.min(remaining, due);
      const newPaid = roundAmount((record.paidAmount || 0) + applyAmount);
      const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount);
      await db.update(merchantAdvance)
        .set({ paidAmount: newPaid, ...interestFields })
        .where(eq(merchantAdvance.id, record.id));

      totalApplied += applyAmount;
      remaining -= applyAmount;
      recordsUpdated++;
    }

    return { totalApplied: Math.round(totalApplied * 100) / 100, recordsUpdated };
  }

  async createMerchantAdvanceReceipt(data: { coldStorageId: string; transactionId: string; payerType: string; buyerName: string; buyerLedgerId: string; buyerId: string; receiptType: string; accountId: string | null; amount: number; roundOff?: number; receivedAt: Date; notes: string | null; appliedAmount?: number; unappliedAmount?: number; appliedAdvanceIds?: string[] }): Promise<CashReceipt> {
    const [receipt] = await db.insert(cashReceipts)
      .values({
        id: randomUUID(),
        transactionId: data.transactionId,
        coldStorageId: data.coldStorageId,
        payerType: data.payerType,
        buyerName: data.buyerName,
        buyerLedgerId: data.buyerLedgerId,
        buyerId: data.buyerId,
        receiptType: data.receiptType,
        accountId: data.accountId,
        amount: data.amount,
        roundOff: data.roundOff || 0,
        receivedAt: data.receivedAt,
        notes: data.notes,
        appliedAmount: data.appliedAmount ?? data.amount,
        unappliedAmount: data.unappliedAmount ?? 0,
        appliedAdvanceIds: data.appliedAdvanceIds ? JSON.stringify(data.appliedAdvanceIds) : null,
      })
      .returning();
    return receipt;
  }

  async updateMerchantAdvanceReceipt(receiptId: string, updates: { appliedAmount?: number; unappliedAmount?: number; appliedAdvanceIds?: string[] }): Promise<void> {
    const setValues: Record<string, unknown> = {};
    if (updates.appliedAmount !== undefined) setValues.appliedAmount = updates.appliedAmount;
    if (updates.unappliedAmount !== undefined) setValues.unappliedAmount = updates.unappliedAmount;
    if (updates.appliedAdvanceIds !== undefined) setValues.appliedAdvanceIds = JSON.stringify(updates.appliedAdvanceIds);
    if (Object.keys(setValues).length > 0) {
      await db.update(cashReceipts).set(setValues).where(eq(cashReceipts.id, receiptId));
    }
  }

  async deleteMerchantAdvanceReceipt(receiptId: string): Promise<void> {
    await db.delete(cashReceipts).where(eq(cashReceipts.id, receiptId));
  }

  async payMerchantAdvanceSelected(coldStorageId: string, buyerLedgerId: string, amount: number, selectedAdvanceIds: string[], receiptId?: string, eventDate?: Date): Promise<{ totalApplied: number; recordsUpdated: number; appliedAdvanceIds: string[] }> {
    const records = await db.select()
      .from(merchantAdvance)
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        eq(merchantAdvance.buyerLedgerId, buyerLedgerId),
        eq(merchantAdvance.isReversed, 0),
        inArray(merchantAdvance.id, selectedAdvanceIds)
      ));

    const orderedRecords = selectedAdvanceIds
      .map(id => records.find(r => r.id === id))
      .filter((r): r is NonNullable<typeof r> => r != null);

    let remaining = amount;
    let totalApplied = 0;
    let recordsUpdated = 0;
    const appliedAdvanceIds: string[] = [];

    return await db.transaction(async (tx) => {
      for (const record of orderedRecords) {
        if (remaining <= 0) break;
        const due = (record.finalAmount || 0) - (record.paidAmount || 0);
        if (due <= 0) continue;

        const applyAmount = Math.min(remaining, due);
        const newPaid = roundAmount((record.paidAmount || 0) + applyAmount);
        const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount);
        await tx.update(merchantAdvance)
          .set({ paidAmount: newPaid, ...interestFields })
          .where(eq(merchantAdvance.id, record.id));

        await tx.insert(merchantAdvanceEvents).values({
          id: randomUUID(),
          merchantAdvanceId: record.id,
          eventType: 'payment',
          eventDate: eventDate || new Date(),
          amount: record.amount,
          rateOfInterest: record.rateOfInterest,
          latestPrincipalBefore: record.latestPrincipal ?? record.amount,
          latestPrincipalAfter: interestFields?.latestPrincipal ?? record.latestPrincipal ?? record.amount,
          effectiveDateBefore: record.effectiveDate,
          effectiveDateAfter: interestFields?.effectiveDate ?? record.effectiveDate,
          finalAmountBefore: record.finalAmount ?? record.amount,
          finalAmountAfter: record.finalAmount ?? record.amount,
          paidAmountBefore: record.paidAmount || 0,
          paidAmountAfter: newPaid,
          paymentAmount: applyAmount,
          receiptId: receiptId || null,
        });

        totalApplied += applyAmount;
        remaining -= applyAmount;
        recordsUpdated++;
        appliedAdvanceIds.push(record.id);
      }

      return { totalApplied: Math.round(totalApplied * 100) / 100, recordsUpdated, appliedAdvanceIds };
    });
  }

  async recomputeMerchantAdvancePayments(coldStorageId: string, buyerLedgerId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const advances = await db.select().from(merchantAdvance)
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        eq(merchantAdvance.buyerLedgerId, buyerLedgerId),
        eq(merchantAdvance.isReversed, 0)
      ))
      .orderBy(asc(merchantAdvance.effectiveDate));

    for (const adv of advances) {
      const resetFields: Record<string, unknown> = { paidAmount: 0, previousEffectiveDate: null, previousLatestPrincipal: null };
      const accrualTarget = adv.lastAccrualDate ? new Date(adv.lastAccrualDate) : today;
      accrualTarget.setHours(0, 0, 0, 0);
      if (adv.previousEffectiveDate && adv.rateOfInterest > 0) {
        const recomputed = this.computeYearlySimpleInterest(
          adv.previousLatestPrincipal ?? adv.amount,
          adv.previousEffectiveDate,
          adv.rateOfInterest,
          accrualTarget
        );
        resetFields.effectiveDate = recomputed.effectiveDate;
        resetFields.latestPrincipal = recomputed.latestPrincipal;
        resetFields.finalAmount = recomputed.finalAmount;
      } else if (adv.rateOfInterest > 0 && adv.effectiveDate) {
        const recomputed = this.computeYearlySimpleInterest(
          adv.latestPrincipal ?? adv.amount,
          adv.effectiveDate,
          adv.rateOfInterest,
          accrualTarget
        );
        resetFields.finalAmount = recomputed.finalAmount;
        resetFields.latestPrincipal = recomputed.latestPrincipal;
        resetFields.effectiveDate = recomputed.effectiveDate;
      }
      await db.update(merchantAdvance).set(resetFields).where(eq(merchantAdvance.id, adv.id));
    }

    const activeReceipts = await db.select().from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.buyerLedgerId, buyerLedgerId),
        eq(cashReceipts.payerType, "cold_merchant_advance"),
        eq(cashReceipts.isReversed, 0)
      ))
      .orderBy(cashReceipts.receivedAt);

    for (const rcpt of activeReceipts) {
      const freshAdvances = await db.select().from(merchantAdvance)
        .where(and(
          eq(merchantAdvance.coldStorageId, coldStorageId),
          eq(merchantAdvance.buyerLedgerId, buyerLedgerId),
          eq(merchantAdvance.isReversed, 0)
        ))
        .orderBy(asc(merchantAdvance.effectiveDate));

      let remaining = rcpt.amount;
      for (const record of freshAdvances) {
        if (remaining <= 0) break;
        const due = (record.finalAmount || record.amount) - (record.paidAmount || 0);
        if (due <= 0) continue;
        const applyAmount = Math.min(remaining, due);
        const newPaid = roundAmount((record.paidAmount || 0) + applyAmount);
        const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, rcpt.receivedAt);
        await db.update(merchantAdvance)
          .set({ paidAmount: newPaid, ...interestFields })
          .where(eq(merchantAdvance.id, record.id));
        remaining -= applyAmount;
      }
    }
  }

  async getOutstandingAdvancesForBuyer(coldStorageId: string, buyerLedgerId: string): Promise<{ id: string; effectiveDate: Date; amount: number; rateOfInterest: number; finalAmount: number; paidAmount: number; remainingDue: number; expenseId: string | null; createdAt: Date }[]> {
    const records = await db.select()
      .from(merchantAdvance)
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        eq(merchantAdvance.buyerLedgerId, buyerLedgerId),
        eq(merchantAdvance.isReversed, 0)
      ))
      .orderBy(asc(merchantAdvance.effectiveDate));

    return records
      .map(r => ({
        id: r.id,
        effectiveDate: r.effectiveDate,
        amount: r.amount,
        rateOfInterest: r.rateOfInterest,
        finalAmount: r.finalAmount,
        paidAmount: r.paidAmount,
        remainingDue: roundAmount((r.finalAmount || 0) - (r.paidAmount || 0)),
        expenseId: r.expenseId,
        createdAt: r.createdAt,
      }))
      .filter(r => r.remainingDue > 0);
  }

  async createPYMerchantAdvance(data: { coldStorageId: string; buyerLedgerId: string; buyerId: string; amount: number; rateOfInterest: number; effectiveDate: Date; remarks?: string | null }): Promise<MerchantAdvance> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let finalAmount = data.amount;
    let latestPrincipal = data.amount;
    let computedEffectiveDate = data.effectiveDate;

    if (data.rateOfInterest > 0) {
      const result = this.computeYearlySimpleInterest(data.amount, data.effectiveDate, data.rateOfInterest, today);
      finalAmount = result.finalAmount;
      latestPrincipal = result.latestPrincipal;
      computedEffectiveDate = result.effectiveDate;
    }

    const [record] = await db.insert(merchantAdvance)
      .values({
        id: randomUUID(),
        coldStorageId: data.coldStorageId,
        buyerLedgerId: data.buyerLedgerId,
        buyerId: data.buyerId,
        amount: data.amount,
        rateOfInterest: data.rateOfInterest,
        effectiveDate: computedEffectiveDate,
        originalEffectiveDate: data.effectiveDate,
        finalAmount,
        latestPrincipal,
        lastAccrualDate: today,
        paidAmount: 0,
        expenseId: null,
        remarks: data.remarks || null,
      })
      .returning();

    await db.insert(merchantAdvanceEvents).values({
      id: randomUUID(),
      merchantAdvanceId: record.id,
      eventType: 'creation',
      eventDate: data.effectiveDate,
      amount: record.amount,
      rateOfInterest: record.rateOfInterest,
      latestPrincipalBefore: null,
      latestPrincipalAfter: record.latestPrincipal ?? record.amount,
      effectiveDateBefore: null,
      effectiveDateAfter: record.effectiveDate,
      finalAmountBefore: null,
      finalAmountAfter: record.finalAmount,
      paidAmountBefore: null,
      paidAmountAfter: 0,
    });

    return record;
  }

  async updatePYMerchantAdvance(coldStorageId: string, id: string, updates: { amount?: number; rateOfInterest?: number; effectiveDate?: Date; remarks?: string | null }): Promise<MerchantAdvance | undefined> {
    const existing = await db.select().from(merchantAdvance).where(and(eq(merchantAdvance.id, id), eq(merchantAdvance.coldStorageId, coldStorageId)));
    if (!existing.length || existing[0].expenseId !== null) return undefined;

    const record = existing[0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newAmount = updates.amount ?? record.amount;
    const newRate = updates.rateOfInterest ?? record.rateOfInterest;
    const newEffDate = updates.effectiveDate ?? record.effectiveDate;

    let finalAmount = newAmount;
    let latestPrincipal = newAmount;
    let computedEffectiveDate = newEffDate;

    if (newRate > 0) {
      const result = this.computeYearlySimpleInterest(newAmount, newEffDate, newRate, today);
      finalAmount = result.finalAmount;
      latestPrincipal = result.latestPrincipal;
      computedEffectiveDate = result.effectiveDate;
    }

    const computedFinalAmount = roundAmount(finalAmount);
    if (computedFinalAmount < (record.paidAmount || 0)) {
      return undefined;
    }

    const setFields: Record<string, any> = {
        amount: newAmount,
        rateOfInterest: newRate,
        effectiveDate: computedEffectiveDate,
        finalAmount: computedFinalAmount,
        latestPrincipal,
        lastAccrualDate: today,
        remarks: updates.remarks !== undefined ? updates.remarks : record.remarks,
    };
    if (updates.effectiveDate) {
      setFields.originalEffectiveDate = updates.effectiveDate;
    }

    const [updated] = await db.update(merchantAdvance)
      .set(setFields)
      .where(eq(merchantAdvance.id, id))
      .returning();
    return updated;
  }

  async deletePYMerchantAdvance(coldStorageId: string, id: string): Promise<boolean> {
    const existing = await db.select().from(merchantAdvance).where(and(eq(merchantAdvance.id, id), eq(merchantAdvance.coldStorageId, coldStorageId)));
    if (!existing.length || existing[0].expenseId !== null) return false;

    await db.update(merchantAdvance)
      .set({ isReversed: 1, reversedAt: new Date() })
      .where(eq(merchantAdvance.id, id));
    return true;
  }

  async getPYMerchantAdvances(coldStorageId: string): Promise<(MerchantAdvance & { buyerName: string | null; remainingDue: number })[]> {
    const rows = await db.select({
      advance: merchantAdvance,
      buyerName: buyerLedger.buyerName,
    }).from(merchantAdvance)
      .leftJoin(buyerLedger, eq(merchantAdvance.buyerLedgerId, buyerLedger.id))
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        isNull(merchantAdvance.expenseId),
        eq(merchantAdvance.isReversed, 0)
      ))
      .orderBy(desc(merchantAdvance.createdAt));
    return rows.map(r => ({
      ...r.advance,
      buyerName: r.buyerName,
      remainingDue: Math.max(0, (r.advance.finalAmount || r.advance.amount) - (r.advance.paidAmount || 0)),
    }));
  }

  async accrueInterestForAll(coldStorageId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let updatedCount = 0;

    const records = await db.select().from(farmerAdvanceFreight)
      .where(and(
        eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
        eq(farmerAdvanceFreight.isReversed, 0)
      ));

    for (const record of records) {
      if (record.rateOfInterest <= 0) continue;

      const paid = record.paidAmount || 0;
      const grossFinal = record.finalAmount || record.amount;
      if (grossFinal - paid <= 0) continue;

      const lastAccrual = new Date(record.lastAccrualDate);
      lastAccrual.setHours(0, 0, 0, 0);
      if (lastAccrual >= today) continue;

      const curPrincipal = record.latestPrincipal ?? record.amount;
      let curEffective = new Date(record.effectiveDate);
      curEffective.setHours(0, 0, 0, 0);

      const result = this.computeYearlySimpleInterest(curPrincipal, curEffective, record.rateOfInterest, today);

      await db.update(farmerAdvanceFreight)
        .set({
          finalAmount: roundAmount(result.finalAmount + paid),
          latestPrincipal: result.latestPrincipal,
          effectiveDate: result.effectiveDate,
          lastAccrualDate: today,
        })
        .where(eq(farmerAdvanceFreight.id, record.id));
      updatedCount++;
    }

    const orRecords = await db.select().from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        sql`${openingReceivables.rateOfInterest} > 0`
      ));

    for (const orRecord of orRecords) {
      if (orRecord.rateOfInterest <= 0) continue;
      if (!orRecord.effectiveDate) continue;

      const paid = orRecord.paidAmount || 0;
      const grossFinal = orRecord.finalAmount ?? orRecord.dueAmount;
      if (grossFinal - paid <= 0) continue;

      if (orRecord.lastAccrualDate) {
        const lastAccrual = new Date(orRecord.lastAccrualDate);
        lastAccrual.setHours(0, 0, 0, 0);
        if (lastAccrual >= today) continue;
      }

      const curPrincipal = orRecord.latestPrincipal ?? orRecord.dueAmount;
      let curEffective = new Date(orRecord.effectiveDate);
      curEffective.setHours(0, 0, 0, 0);

      const result = this.computeYearlySimpleInterest(curPrincipal, curEffective, orRecord.rateOfInterest, today);

      await db.update(openingReceivables)
        .set({
          finalAmount: roundAmount(result.finalAmount + paid),
          latestPrincipal: result.latestPrincipal,
          effectiveDate: result.effectiveDate,
          lastAccrualDate: today,
        })
        .where(eq(openingReceivables.id, orRecord.id));
      updatedCount++;
    }

    const maRecords = await db.select().from(merchantAdvance)
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        eq(merchantAdvance.isReversed, 0)
      ));

    for (const maRecord of maRecords) {
      if (maRecord.rateOfInterest <= 0) continue;

      const paid = maRecord.paidAmount || 0;
      const grossFinal = maRecord.finalAmount || maRecord.amount;
      if (grossFinal - paid <= 0) continue;

      const lastAccrual = new Date(maRecord.lastAccrualDate);
      lastAccrual.setHours(0, 0, 0, 0);
      if (lastAccrual >= today) continue;

      const curPrincipal = maRecord.latestPrincipal ?? maRecord.amount;
      let curEffective = new Date(maRecord.effectiveDate);
      curEffective.setHours(0, 0, 0, 0);

      const result = this.computeYearlySimpleInterest(curPrincipal, curEffective, maRecord.rateOfInterest, today);

      const newFinalAmount = roundAmount(result.finalAmount + paid);

      if (result.latestPrincipal !== curPrincipal) {
        const interestCompounded = roundAmount(result.latestPrincipal - curPrincipal);
        await db.insert(merchantAdvanceEvents).values({
          id: randomUUID(),
          merchantAdvanceId: maRecord.id,
          eventType: 'annual_compounding',
          eventDate: result.effectiveDate,
          amount: maRecord.amount,
          rateOfInterest: maRecord.rateOfInterest,
          latestPrincipalBefore: curPrincipal,
          latestPrincipalAfter: result.latestPrincipal,
          effectiveDateBefore: curEffective,
          effectiveDateAfter: result.effectiveDate,
          finalAmountBefore: grossFinal,
          finalAmountAfter: newFinalAmount,
          paidAmountBefore: paid,
          paidAmountAfter: paid,
          interestCompounded,
        });
      }

      await db.update(merchantAdvance)
        .set({
          finalAmount: newFinalAmount,
          latestPrincipal: result.latestPrincipal,
          effectiveDate: result.effectiveDate,
          lastAccrualDate: today,
        })
        .where(eq(merchantAdvance.id, maRecord.id));
      updatedCount++;
    }

    const flRecords = await db.select().from(farmerLoan)
      .where(and(
        eq(farmerLoan.coldStorageId, coldStorageId),
        eq(farmerLoan.isReversed, 0)
      ));

    for (const flRecord of flRecords) {
      if (flRecord.rateOfInterest <= 0) continue;

      const paid = flRecord.paidAmount || 0;
      const grossFinal = flRecord.finalAmount || flRecord.amount;
      if (grossFinal - paid <= 0) continue;

      const lastAccrual = new Date(flRecord.lastAccrualDate);
      lastAccrual.setHours(0, 0, 0, 0);
      if (lastAccrual >= today) continue;

      const curPrincipal = flRecord.latestPrincipal ?? flRecord.amount;
      let curEffective = new Date(flRecord.effectiveDate);
      curEffective.setHours(0, 0, 0, 0);

      const result = this.computeYearlySimpleInterest(curPrincipal, curEffective, flRecord.rateOfInterest, today);

      const newFinalAmount = roundAmount(result.finalAmount + paid);

      if (result.latestPrincipal !== curPrincipal) {
        const interestCompounded = roundAmount(result.latestPrincipal - curPrincipal);
        await db.insert(farmerLoanEvents).values({
          id: randomUUID(),
          farmerLoanId: flRecord.id,
          eventType: 'annual_compounding',
          eventDate: result.effectiveDate,
          amount: flRecord.amount,
          rateOfInterest: flRecord.rateOfInterest,
          latestPrincipalBefore: curPrincipal,
          latestPrincipalAfter: result.latestPrincipal,
          effectiveDateBefore: curEffective,
          effectiveDateAfter: result.effectiveDate,
          finalAmountBefore: grossFinal,
          finalAmountAfter: newFinalAmount,
          paidAmountBefore: paid,
          paidAmountAfter: paid,
          interestCompounded,
        });
      }

      await db.update(farmerLoan)
        .set({
          finalAmount: newFinalAmount,
          latestPrincipal: result.latestPrincipal,
          effectiveDate: result.effectiveDate,
          lastAccrualDate: today,
        })
        .where(eq(farmerLoan.id, flRecord.id));
      updatedCount++;
    }

    return updatedCount;
  }

  computeInterestAwarePaymentFields(
    record: { latestPrincipal: number | null; effectiveDate: Date | string | null; rateOfInterest: number; finalAmount: number | null; paidAmount: number | null; dueAmount?: number | null; previousEffectiveDate?: Date | string | null; previousLatestPrincipal?: number | null },
    newPaidAmount: number,
    defaultPrincipal: number,
    paymentDate?: Date
  ): { latestPrincipal?: number; effectiveDate?: Date; previousEffectiveDate?: Date | null; previousLatestPrincipal?: number | null } | null {
    if (record.rateOfInterest <= 0) return null;
    const prevPrincipal = record.latestPrincipal ?? defaultPrincipal;
    const grossFinal = record.finalAmount ?? record.dueAmount ?? defaultPrincipal;
    const netFinal = grossFinal - newPaidAmount;
    if (netFinal <= 0) return null;
    const newPrincipal = Math.min(prevPrincipal, netFinal);
    if (newPrincipal < prevPrincipal) {
      const effectivePaymentDate = paymentDate ? new Date(paymentDate) : new Date();
      effectivePaymentDate.setHours(0, 0, 0, 0);
      const result: { latestPrincipal: number; effectiveDate: Date; previousEffectiveDate?: Date | null; previousLatestPrincipal?: number | null } = {
        latestPrincipal: roundAmount(newPrincipal),
        effectiveDate: effectivePaymentDate,
      };
      if (!record.previousEffectiveDate) {
        result.previousEffectiveDate = record.effectiveDate ? new Date(record.effectiveDate) : null;
        result.previousLatestPrincipal = prevPrincipal;
      }
      return result;
    }
    return null;
  }

  computeYearlySimpleInterest(
    latestPrincipal: number,
    effectiveDate: Date,
    annualRate: number,
    today: Date
  ): { finalAmount: number; latestPrincipal: number; effectiveDate: Date } {
    let curPrincipal = latestPrincipal;
    let curEffective = new Date(effectiveDate);
    curEffective.setHours(0, 0, 0, 0);
    const rate = annualRate / 100;

    let yearBoundary = new Date(curEffective);
    yearBoundary.setFullYear(yearBoundary.getFullYear() + 1);

    while (today >= yearBoundary) {
      const daysInSegment = (yearBoundary.getTime() - curEffective.getTime()) / (24 * 60 * 60 * 1000);
      const segmentInterest = roundAmount(curPrincipal * rate * daysInSegment / 365);
      curPrincipal = roundAmount(curPrincipal + segmentInterest);
      curEffective = new Date(yearBoundary);
      curEffective.setHours(0, 0, 0, 0);
      yearBoundary = new Date(curEffective);
      yearBoundary.setFullYear(yearBoundary.getFullYear() + 1);
    }

    const diffMs = today.getTime() - curEffective.getTime();
    const days = Math.max(0, diffMs / (24 * 60 * 60 * 1000));

    let curFinal = curPrincipal;
    if (days > 0) {
      const interest = roundAmount(curPrincipal * rate * days / 365);
      curFinal = roundAmount(curPrincipal + interest);
    }

    return {
      finalAmount: curFinal,
      latestPrincipal: curPrincipal,
      effectiveDate: curEffective,
    };
  }

  calculateSimpleInterest(
    principal: number,
    annualRate: number,
    fromDate: Date,
    toDate: Date
  ): number {
    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(toDate);
    endDate.setHours(0, 0, 0, 0);

    const diffMs = endDate.getTime() - startDate.getTime();
    if (diffMs <= 0) return principal;

    const days = diffMs / (24 * 60 * 60 * 1000);
    const rate = annualRate / 100;
    return Math.round((principal + (principal * rate * days / 365)) * 100) / 100;
  }

  // ============ FARMER LOAN ============

  async createFarmerLoan(data: { coldStorageId: string; farmerLedgerId: string; farmerId: string; amount: number; rateOfInterest: number; effectiveDate: Date; finalAmount: number; latestPrincipal: number; lastAccrualDate: Date; expenseId: string | null; remarks?: string | null; originalEffectiveDate?: Date }): Promise<FarmerLoan> {
    const [record] = await db.insert(farmerLoan)
      .values({
        id: randomUUID(),
        coldStorageId: data.coldStorageId,
        farmerLedgerId: data.farmerLedgerId,
        farmerId: data.farmerId,
        amount: data.amount,
        rateOfInterest: data.rateOfInterest,
        effectiveDate: data.effectiveDate,
        originalEffectiveDate: data.originalEffectiveDate || data.effectiveDate,
        finalAmount: data.finalAmount,
        latestPrincipal: data.latestPrincipal,
        lastAccrualDate: data.lastAccrualDate,
        expenseId: data.expenseId,
        remarks: data.remarks || null,
        paidAmount: 0,
      })
      .returning();

    await db.insert(farmerLoanEvents).values({
      id: randomUUID(),
      farmerLoanId: record.id,
      eventType: 'creation',
      eventDate: record.effectiveDate,
      amount: record.amount,
      rateOfInterest: record.rateOfInterest,
      latestPrincipalBefore: null,
      latestPrincipalAfter: record.latestPrincipal ?? record.amount,
      effectiveDateBefore: null,
      effectiveDateAfter: record.effectiveDate,
      finalAmountBefore: null,
      finalAmountAfter: record.finalAmount,
      paidAmountBefore: null,
      paidAmountAfter: 0,
    });

    return record;
  }

  async getFarmerLoans(coldStorageId: string, farmerLedgerId?: string): Promise<FarmerLoan[]> {
    if (farmerLedgerId) {
      return db.select().from(farmerLoan)
        .where(and(
          eq(farmerLoan.coldStorageId, coldStorageId),
          eq(farmerLoan.farmerLedgerId, farmerLedgerId),
          eq(farmerLoan.isReversed, 0)
        ))
        .orderBy(desc(farmerLoan.createdAt));
    }
    return db.select().from(farmerLoan)
      .where(and(
        eq(farmerLoan.coldStorageId, coldStorageId),
        eq(farmerLoan.isReversed, 0)
      ))
      .orderBy(desc(farmerLoan.createdAt));
  }

  async getFarmersWithLoanDues(coldStorageId: string): Promise<{ farmerLedgerId: string; farmerId: string; farmerName: string; loanDue: number }[]> {
    const records = await db.select()
      .from(farmerLoan)
      .where(and(
        eq(farmerLoan.coldStorageId, coldStorageId),
        eq(farmerLoan.isReversed, 0)
      ));

    const grouped = new Map<string, { farmerLedgerId: string; farmerId: string; loanDue: number }>();
    for (const r of records) {
      const remaining = (r.finalAmount || 0) - (r.paidAmount || 0);
      if (remaining <= 0) continue;
      const existing = grouped.get(r.farmerLedgerId);
      if (existing) {
        existing.loanDue += remaining;
      } else {
        grouped.set(r.farmerLedgerId, {
          farmerLedgerId: r.farmerLedgerId,
          farmerId: r.farmerId,
          loanDue: remaining,
        });
      }
    }

    const farmerLedgerRecords = await db.select()
      .from(farmerLedger)
      .where(eq(farmerLedger.coldStorageId, coldStorageId));

    const farmerNameMap = new Map<string, string>();
    for (const fl of farmerLedgerRecords) {
      farmerNameMap.set(fl.id, fl.name);
    }

    const result: { farmerLedgerId: string; farmerId: string; farmerName: string; loanDue: number }[] = [];
    for (const [ledgerId, data] of grouped) {
      const name = farmerNameMap.get(ledgerId);
      if (name && data.loanDue > 0) {
        result.push({
          farmerLedgerId: ledgerId,
          farmerId: data.farmerId,
          farmerName: name,
          loanDue: Math.round(data.loanDue * 100) / 100,
        });
      }
    }

    return result.sort((a, b) => a.farmerName.toLowerCase().localeCompare(b.farmerName.toLowerCase()));
  }

  async getOutstandingLoansForFarmer(coldStorageId: string, farmerLedgerId: string): Promise<{ id: string; effectiveDate: Date; amount: number; rateOfInterest: number; finalAmount: number; paidAmount: number; remainingDue: number; expenseId: string | null; createdAt: Date }[]> {
    const records = await db.select()
      .from(farmerLoan)
      .where(and(
        eq(farmerLoan.coldStorageId, coldStorageId),
        eq(farmerLoan.farmerLedgerId, farmerLedgerId),
        eq(farmerLoan.isReversed, 0)
      ))
      .orderBy(asc(farmerLoan.effectiveDate));

    return records
      .map(r => ({
        id: r.id,
        effectiveDate: r.effectiveDate,
        amount: r.amount,
        rateOfInterest: r.rateOfInterest,
        finalAmount: r.finalAmount,
        paidAmount: r.paidAmount,
        remainingDue: roundAmount((r.finalAmount || 0) - (r.paidAmount || 0)),
        expenseId: r.expenseId,
        createdAt: r.createdAt,
      }))
      .filter(r => r.remainingDue > 0);
  }

  async payFarmerLoanSelected(coldStorageId: string, farmerLedgerId: string, amount: number, selectedLoanIds: string[], receiptId?: string, eventDate?: Date): Promise<{ totalApplied: number; recordsUpdated: number; appliedLoanIds: string[] }> {
    const records = await db.select()
      .from(farmerLoan)
      .where(and(
        eq(farmerLoan.coldStorageId, coldStorageId),
        eq(farmerLoan.farmerLedgerId, farmerLedgerId),
        eq(farmerLoan.isReversed, 0),
        inArray(farmerLoan.id, selectedLoanIds)
      ));

    const orderedRecords = selectedLoanIds
      .map(id => records.find(r => r.id === id))
      .filter((r): r is NonNullable<typeof r> => r != null);

    let remaining = amount;
    let totalApplied = 0;
    let recordsUpdated = 0;
    const appliedLoanIds: string[] = [];

    return await db.transaction(async (tx) => {
      for (const record of orderedRecords) {
        if (remaining <= 0) break;
        const due = (record.finalAmount || 0) - (record.paidAmount || 0);
        if (due <= 0) continue;

        const applyAmount = Math.min(remaining, due);
        const newPaid = roundAmount((record.paidAmount || 0) + applyAmount);
        const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, eventDate);
        await tx.update(farmerLoan)
          .set({ paidAmount: newPaid, ...interestFields })
          .where(eq(farmerLoan.id, record.id));

        await tx.insert(farmerLoanEvents).values({
          id: randomUUID(),
          farmerLoanId: record.id,
          eventType: 'payment',
          eventDate: eventDate || new Date(),
          amount: record.amount,
          rateOfInterest: record.rateOfInterest,
          latestPrincipalBefore: record.latestPrincipal ?? record.amount,
          latestPrincipalAfter: interestFields?.latestPrincipal ?? record.latestPrincipal ?? record.amount,
          effectiveDateBefore: record.effectiveDate,
          effectiveDateAfter: interestFields?.effectiveDate ?? record.effectiveDate,
          finalAmountBefore: record.finalAmount ?? record.amount,
          finalAmountAfter: record.finalAmount ?? record.amount,
          paidAmountBefore: record.paidAmount || 0,
          paidAmountAfter: newPaid,
          paymentAmount: applyAmount,
          receiptId: receiptId || null,
        });

        totalApplied += applyAmount;
        remaining -= applyAmount;
        recordsUpdated++;
        appliedLoanIds.push(record.id);
      }

      return { totalApplied: Math.round(totalApplied * 100) / 100, recordsUpdated, appliedLoanIds };
    });
  }

  async createFarmerLoanReceipt(data: { coldStorageId: string; transactionId: string; payerType: string; farmerName: string; farmerLedgerId: string; farmerId: string; receiptType: string; accountId: string | null; amount: number; roundOff?: number; receivedAt: Date; notes: string | null; appliedAmount?: number; unappliedAmount?: number; appliedLoanIds?: string[] }): Promise<CashReceipt> {
    const [receipt] = await db.insert(cashReceipts)
      .values({
        id: randomUUID(),
        transactionId: data.transactionId,
        coldStorageId: data.coldStorageId,
        payerType: data.payerType,
        buyerName: data.farmerName,
        buyerLedgerId: data.farmerLedgerId,
        buyerId: data.farmerId,
        receiptType: data.receiptType,
        accountId: data.accountId,
        amount: data.amount,
        roundOff: data.roundOff || 0,
        receivedAt: data.receivedAt,
        notes: data.notes,
        appliedAmount: data.appliedAmount ?? data.amount,
        unappliedAmount: data.unappliedAmount ?? 0,
        appliedAdvanceIds: data.appliedLoanIds ? JSON.stringify(data.appliedLoanIds) : null,
      })
      .returning();
    return receipt;
  }

  async updateFarmerLoanReceipt(receiptId: string, updates: { appliedAmount?: number; unappliedAmount?: number; appliedLoanIds?: string[] }): Promise<void> {
    const setValues: Record<string, unknown> = {};
    if (updates.appliedAmount !== undefined) setValues.appliedAmount = updates.appliedAmount;
    if (updates.unappliedAmount !== undefined) setValues.unappliedAmount = updates.unappliedAmount;
    if (updates.appliedLoanIds !== undefined) setValues.appliedAdvanceIds = JSON.stringify(updates.appliedLoanIds);
    if (Object.keys(setValues).length > 0) {
      await db.update(cashReceipts).set(setValues).where(eq(cashReceipts.id, receiptId));
    }
  }

  async deleteFarmerLoanReceipt(receiptId: string): Promise<void> {
    await db.delete(cashReceipts).where(eq(cashReceipts.id, receiptId));
  }

  async recomputeFarmerLoanPayments(coldStorageId: string, farmerLedgerId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const loans = await db.select().from(farmerLoan)
      .where(and(
        eq(farmerLoan.coldStorageId, coldStorageId),
        eq(farmerLoan.farmerLedgerId, farmerLedgerId),
        eq(farmerLoan.isReversed, 0)
      ))
      .orderBy(asc(farmerLoan.effectiveDate));

    for (const loan of loans) {
      const resetFields: Record<string, unknown> = { paidAmount: 0, previousEffectiveDate: null, previousLatestPrincipal: null };
      const accrualTarget = loan.lastAccrualDate ? new Date(loan.lastAccrualDate) : today;
      accrualTarget.setHours(0, 0, 0, 0);
      if (loan.previousEffectiveDate && loan.rateOfInterest > 0) {
        const recomputed = this.computeYearlySimpleInterest(
          loan.previousLatestPrincipal ?? loan.amount,
          loan.previousEffectiveDate,
          loan.rateOfInterest,
          accrualTarget
        );
        resetFields.effectiveDate = recomputed.effectiveDate;
        resetFields.latestPrincipal = recomputed.latestPrincipal;
        resetFields.finalAmount = recomputed.finalAmount;
      } else if (loan.rateOfInterest > 0 && loan.effectiveDate) {
        const recomputed = this.computeYearlySimpleInterest(
          loan.latestPrincipal ?? loan.amount,
          loan.effectiveDate,
          loan.rateOfInterest,
          accrualTarget
        );
        resetFields.finalAmount = recomputed.finalAmount;
        resetFields.latestPrincipal = recomputed.latestPrincipal;
        resetFields.effectiveDate = recomputed.effectiveDate;
      }
      await db.update(farmerLoan).set(resetFields).where(eq(farmerLoan.id, loan.id));
    }

    const activeReceipts = await db.select().from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.buyerLedgerId, farmerLedgerId),
        eq(cashReceipts.payerType, "farmer_loan"),
        eq(cashReceipts.isReversed, 0)
      ))
      .orderBy(cashReceipts.receivedAt);

    for (const rcpt of activeReceipts) {
      const freshLoans = await db.select().from(farmerLoan)
        .where(and(
          eq(farmerLoan.coldStorageId, coldStorageId),
          eq(farmerLoan.farmerLedgerId, farmerLedgerId),
          eq(farmerLoan.isReversed, 0)
        ))
        .orderBy(asc(farmerLoan.effectiveDate));

      let remaining = rcpt.amount;
      for (const record of freshLoans) {
        if (remaining <= 0) break;
        const due = (record.finalAmount || record.amount) - (record.paidAmount || 0);
        if (due <= 0) continue;
        const applyAmount = Math.min(remaining, due);
        const newPaid = roundAmount((record.paidAmount || 0) + applyAmount);
        const interestFields = this.computeInterestAwarePaymentFields(record, newPaid, record.amount, rcpt.receivedAt);
        await db.update(farmerLoan)
          .set({ paidAmount: newPaid, ...interestFields })
          .where(eq(farmerLoan.id, record.id));
        remaining -= applyAmount;
      }
    }
  }

  async createPYFarmerLoan(data: { coldStorageId: string; farmerLedgerId: string; farmerId: string; amount: number; rateOfInterest: number; effectiveDate: Date; remarks?: string | null }): Promise<FarmerLoan> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let finalAmount = data.amount;
    let latestPrincipal = data.amount;
    let computedEffectiveDate = data.effectiveDate;

    if (data.rateOfInterest > 0) {
      const result = this.computeYearlySimpleInterest(data.amount, data.effectiveDate, data.rateOfInterest, today);
      finalAmount = result.finalAmount;
      latestPrincipal = result.latestPrincipal;
      computedEffectiveDate = result.effectiveDate;
    }

    const [record] = await db.insert(farmerLoan)
      .values({
        id: randomUUID(),
        coldStorageId: data.coldStorageId,
        farmerLedgerId: data.farmerLedgerId,
        farmerId: data.farmerId,
        amount: data.amount,
        rateOfInterest: data.rateOfInterest,
        effectiveDate: computedEffectiveDate,
        originalEffectiveDate: data.effectiveDate,
        finalAmount,
        latestPrincipal,
        lastAccrualDate: today,
        paidAmount: 0,
        expenseId: null,
        remarks: data.remarks || null,
      })
      .returning();

    await db.insert(farmerLoanEvents).values({
      id: randomUUID(),
      farmerLoanId: record.id,
      eventType: 'creation',
      eventDate: data.effectiveDate,
      amount: record.amount,
      rateOfInterest: record.rateOfInterest,
      latestPrincipalBefore: null,
      latestPrincipalAfter: record.latestPrincipal ?? record.amount,
      effectiveDateBefore: null,
      effectiveDateAfter: record.effectiveDate,
      finalAmountBefore: null,
      finalAmountAfter: record.finalAmount,
      paidAmountBefore: null,
      paidAmountAfter: 0,
    });

    return record;
  }

  async updatePYFarmerLoan(coldStorageId: string, id: string, updates: { amount?: number; rateOfInterest?: number; effectiveDate?: Date; remarks?: string | null }): Promise<FarmerLoan | undefined> {
    const existing = await db.select().from(farmerLoan).where(and(eq(farmerLoan.id, id), eq(farmerLoan.coldStorageId, coldStorageId)));
    if (!existing.length || existing[0].expenseId !== null) return undefined;

    const record = existing[0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newAmount = updates.amount ?? record.amount;
    const newRate = updates.rateOfInterest ?? record.rateOfInterest;
    const newOriginalEffDate = updates.effectiveDate ?? (record.originalEffectiveDate || record.effectiveDate);

    let finalAmount = newAmount;
    let latestPrincipal = newAmount;
    let computedEffectiveDate = newOriginalEffDate;

    if (newRate > 0) {
      const result = this.computeYearlySimpleInterest(newAmount, newOriginalEffDate, newRate, today);
      finalAmount = result.finalAmount;
      latestPrincipal = result.latestPrincipal;
      computedEffectiveDate = result.effectiveDate;
    }

    if (roundAmount(finalAmount) < roundAmount(record.paidAmount || 0)) {
      return undefined;
    }

    const setValues: Record<string, unknown> = {
      amount: newAmount,
      rateOfInterest: newRate,
      effectiveDate: computedEffectiveDate,
      originalEffectiveDate: newOriginalEffDate,
      finalAmount,
      latestPrincipal,
      lastAccrualDate: today,
    };
    if (updates.remarks !== undefined) setValues.remarks = updates.remarks;

    const [updated] = await db.update(farmerLoan)
      .set(setValues)
      .where(eq(farmerLoan.id, id))
      .returning();

    await this.recomputeFarmerLoanPayments(coldStorageId, record.farmerLedgerId);

    return updated;
  }

  async getPYFarmerLoans(coldStorageId: string): Promise<(FarmerLoan & { farmerName: string; remainingDue: number })[]> {
    const records = await db.select().from(farmerLoan)
      .where(and(
        eq(farmerLoan.coldStorageId, coldStorageId),
        eq(farmerLoan.isReversed, 0),
        isNull(farmerLoan.expenseId)
      ))
      .orderBy(desc(farmerLoan.createdAt));

    const farmerLedgerRecords = await db.select()
      .from(farmerLedger)
      .where(eq(farmerLedger.coldStorageId, coldStorageId));

    const farmerNameMap = new Map<string, string>();
    for (const fl of farmerLedgerRecords) {
      farmerNameMap.set(fl.id, fl.name);
    }

    return records.map(r => ({
      ...r,
      farmerName: farmerNameMap.get(r.farmerLedgerId) || 'Unknown',
      remainingDue: roundAmount((r.finalAmount || 0) - (r.paidAmount || 0)),
    }));
  }

  async reverseFarmerLoan(coldStorageId: string, loanId: string): Promise<boolean> {
    const [record] = await db.select().from(farmerLoan)
      .where(and(eq(farmerLoan.id, loanId), eq(farmerLoan.coldStorageId, coldStorageId)));
    if (!record) return false;

    await db.update(farmerLoan)
      .set({ isReversed: 1, reversedAt: new Date() })
      .where(eq(farmerLoan.id, loanId));

    await db.insert(farmerLoanEvents).values({
      id: randomUUID(),
      farmerLoanId: loanId,
      eventType: 'reversal',
      eventDate: new Date(),
      amount: record.amount,
      rateOfInterest: record.rateOfInterest,
      latestPrincipalBefore: record.latestPrincipal,
      latestPrincipalAfter: 0,
      effectiveDateBefore: record.effectiveDate,
      effectiveDateAfter: record.effectiveDate,
      finalAmountBefore: record.finalAmount,
      finalAmountAfter: 0,
      paidAmountBefore: record.paidAmount,
      paidAmountAfter: record.paidAmount,
    });

    await this.recomputeFarmerLoanPayments(coldStorageId, record.farmerLedgerId);
    return true;
  }

  // ============ FARMER LEDGER ============

  // Generate farmer composite key for deduplication
  private getFarmerCompositeKey(name: string, contactNumber: string, village: string): string {
    return `${name.trim().toLowerCase()}_${contactNumber.trim()}_${village.trim().toLowerCase()}`;
  }

  // Generate unique farmer ID in format FMYYYYMMDD1, FMYYYYMMDD2, etc.
  // Uses atomic dailyIdCounters table to prevent ID reuse even after merges/deletion
  // Safety: unique constraint on farmer_ledger.farmerId + retry logic ensures no duplicates
  async generateFarmerId(coldStorageId: string): Promise<string> {
    const now = new Date();
    const dateKey = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    
    // Compute current max from existing records to seed the counter on first use
    // This ensures continuity when transitioning from the old approach
    const datePrefix = 'FM' + dateKey;
    const existingFarmers = await db.select({ farmerId: farmerLedger.farmerId })
      .from(farmerLedger)
      .where(and(
        eq(farmerLedger.coldStorageId, coldStorageId),
        sql`${farmerLedger.farmerId} LIKE ${datePrefix + '%'}`
      ));
    
    let maxCounter = 0;
    for (const f of existingFarmers) {
      const numPart = f.farmerId.replace(datePrefix, '');
      const counter = parseInt(numPart, 10);
      if (!isNaN(counter) && counter > maxCounter) {
        maxCounter = counter;
      }
    }
    
    return generateSequentialId('farmer', coldStorageId, maxCounter);
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
    entityType?: string;
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
          entityType: farmerData.entityType || "farmer",
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

  // Create farmer manually — rejects if same name+contactNumber+village already exists
  async createManualFarmer(coldStorageId: string, farmerData: {
    name: string;
    contactNumber: string;
    village: string;
    tehsil?: string;
    district?: string;
    state?: string;
    entityType?: string;
    customColdChargeRate?: number | null;
    customHammaliRate?: number | null;
  }): Promise<{ id: string; farmerId: string }> {
    const [existing] = await db.select({ id: farmerLedger.id })
      .from(farmerLedger)
      .where(and(
        eq(farmerLedger.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${farmerLedger.name})) = ${farmerData.name.trim().toLowerCase()}`,
        sql`TRIM(${farmerLedger.contactNumber}) = ${farmerData.contactNumber.trim()}`,
        sql`LOWER(TRIM(${farmerLedger.village})) = ${farmerData.village.trim().toLowerCase()}`
      ));

    if (existing) {
      const err = new Error('A farmer with this name, contact number, and village already exists') as any;
      err.code = 'DUPLICATE_FARMER';
      throw err;
    }

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
          entityType: farmerData.entityType || "farmer",
          customColdChargeRate: farmerData.customColdChargeRate ?? null,
          customHammaliRate: farmerData.customHammaliRate ?? null,
          isFlagged: 0,
          isArchived: 0,
        });
        return { id: newId, farmerId };
      } catch (error: any) {
        if (error?.code === '23505' && (error?.constraint?.includes('farmer_id') || error?.constraint?.includes('cs_fid'))) {
          continue;
        }
        throw error;
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
      loanDue: number;
      totalDue: number;
    })[];
    summary: {
      totalFarmers: number;
      pyReceivables: number;
      selfDue: number;
      merchantDue: number;
      advanceDue: number;
      freightDue: number;
      loanDue: number;
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
        finalAmount: openingReceivables.finalAmount,
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
      
      const pyReceivables = pyReceivablesData.reduce((sum, r) => sum + ((r.finalAmount ?? r.dueAmount) - (r.paidAmount || 0)), 0);
      
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
        adjReceivableSelfDueAmount: salesHistory.adjReceivableSelfDueAmount,
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
      
      const merchantDue = merchantSalesDue;

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

      const farmerLoanData = await db.select({
        finalAmount: farmerLoan.finalAmount,
        paidAmount: farmerLoan.paidAmount,
      })
        .from(farmerLoan)
        .where(and(
          eq(farmerLoan.coldStorageId, coldStorageId),
          eq(farmerLoan.farmerLedgerId, farmer.id),
          eq(farmerLoan.isReversed, 0)
        ));

      const loanDue = farmerLoanData
        .reduce((sum, r) => sum + Math.max(0, (r.finalAmount || 0) - (r.paidAmount || 0)), 0);
      
      const totalDue = pyReceivables + selfDue + merchantDue + advanceDue + freightDue + loanDue;
      
      return {
        ...farmer,
        pyReceivables: roundAmount(pyReceivables),
        selfDue: roundAmount(selfDue),
        merchantDue: roundAmount(merchantDue),
        advanceDue: roundAmount(advanceDue),
        freightDue: roundAmount(freightDue),
        loanDue: roundAmount(loanDue),
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
      loanDue: roundAmount(farmersWithDues.reduce((sum, f) => sum + f.loanDue, 0)),
      totalDue: roundAmount(farmersWithDues.reduce((sum, f) => sum + f.totalDue, 0)),
    };
    
    return { farmers: farmersWithDues, summary };
  }

  async getFarmerDuesByLedgerId(farmerLedgerId: string, coldStorageId: string): Promise<{ pyReceivables: number; selfDue: number; merchantDue: number; advanceDue: number; freightDue: number; loanDue: number; totalDue: number }> {
    const zero = { pyReceivables: 0, selfDue: 0, merchantDue: 0, advanceDue: 0, freightDue: 0, loanDue: 0, totalDue: 0 };
    const [farmer] = await db.select().from(farmerLedger).where(and(eq(farmerLedger.id, farmerLedgerId), eq(farmerLedger.coldStorageId, coldStorageId)));
    if (!farmer) return zero;

    const pyReceivablesData = await db.select({
      dueAmount: openingReceivables.dueAmount,
      finalAmount: openingReceivables.finalAmount,
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
    const pyReceivables = pyReceivablesData.reduce((sum, r) => sum + ((r.finalAmount ?? r.dueAmount) - (r.paidAmount || 0)), 0);

    const selfSalesData = await db.select({ dueAmount: salesHistory.dueAmount })
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

    const merchantSalesData = await db.select({
      coldStorageCharge: salesHistory.coldStorageCharge,
      paidAmount: salesHistory.paidAmount,
      adjReceivableSelfDueAmount: salesHistory.adjReceivableSelfDueAmount,
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
    const merchantDue = merchantSalesData.reduce((sum, s) => {
      const charge = s.coldStorageCharge || 0;
      const paid = s.paidAmount || 0;
      return sum + Math.max(0, charge - paid);
    }, 0);

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
    const advanceDue = advFreightData.filter(r => r.type === 'advance').reduce((sum, r) => sum + Math.max(0, (r.finalAmount || 0) - (r.paidAmount || 0)), 0);
    const freightDue = advFreightData.filter(r => r.type === 'freight').reduce((sum, r) => sum + Math.max(0, (r.finalAmount || 0) - (r.paidAmount || 0)), 0);

    const farmerLoanData = await db.select({
      finalAmount: farmerLoan.finalAmount,
      paidAmount: farmerLoan.paidAmount,
    })
      .from(farmerLoan)
      .where(and(
        eq(farmerLoan.coldStorageId, coldStorageId),
        eq(farmerLoan.farmerLedgerId, farmer.id),
        eq(farmerLoan.isReversed, 0)
      ));
    const loanDue = farmerLoanData.reduce((sum, r) => sum + Math.max(0, (r.finalAmount || 0) - (r.paidAmount || 0)), 0);

    const totalDue = pyReceivables + selfDue + merchantDue + advanceDue + freightDue + loanDue;
    return {
      pyReceivables: roundAmount(pyReceivables),
      selfDue: roundAmount(selfDue),
      merchantDue: roundAmount(merchantDue),
      advanceDue: roundAmount(advanceDue),
      freightDue: roundAmount(freightDue),
      loanDue: roundAmount(loanDue),
      totalDue: roundAmount(totalDue),
    };
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
              farmerId: survivorFarmerId,
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
              farmerId: survivorFarmerId,
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
              farmerId: survivorFarmerId,
              farmerName: survivorFarmerEntry.name,
              contactNumber: survivorFarmerEntry.contactNumber,
              village: survivorFarmerEntry.village,
            })
            .where(eq(salesHistory.farmerLedgerId, mergedId));
        }
        
        // Transfer cash receipts from merged farmer to survivor
        const mergedCashReceipts = await db.select()
          .from(cashReceipts)
          .where(eq(cashReceipts.farmerLedgerId, mergedId));
        if (mergedCashReceipts.length > 0) {
          await db.update(cashReceipts)
            .set({
              farmerLedgerId: survivorId,
              farmerId: survivorFarmerId,
            })
            .where(eq(cashReceipts.farmerLedgerId, mergedId));
        }
        
        // Transfer farmer advance/freight entries from merged farmer to survivor
        const mergedAdvances = await db.select()
          .from(farmerAdvanceFreight)
          .where(eq(farmerAdvanceFreight.farmerLedgerId, mergedId));
        if (mergedAdvances.length > 0) {
          await db.update(farmerAdvanceFreight)
            .set({
              farmerLedgerId: survivorId,
              farmerId: survivorFarmerId,
            })
            .where(eq(farmerAdvanceFreight.farmerLedgerId, mergedId));
        }

        const mergedFarmerLoans = await db.select()
          .from(farmerLoan)
          .where(eq(farmerLoan.farmerLedgerId, mergedId));
        if (mergedFarmerLoans.length > 0) {
          await db.update(farmerLoan)
            .set({
              farmerLedgerId: survivorId,
              farmerId: survivorFarmerId,
            })
            .where(eq(farmerLoan.farmerLedgerId, mergedId));
        }

        const mergedFarmerLoanReceipts = await db.select()
          .from(cashReceipts)
          .where(and(
            eq(cashReceipts.buyerLedgerId, mergedId),
            eq(cashReceipts.payerType, 'farmer_loan')
          ));
        if (mergedFarmerLoanReceipts.length > 0) {
          await db.update(cashReceipts)
            .set({
              buyerLedgerId: survivorId,
              buyerId: survivorFarmerId,
            })
            .where(and(
              eq(cashReceipts.buyerLedgerId, mergedId),
              eq(cashReceipts.payerType, 'farmer_loan')
            ));
        }

        // Transfer discounts from merged farmer to survivor
        const mergedDiscounts = await db.select()
          .from(discounts)
          .where(eq(discounts.farmerLedgerId, mergedId));
        if (mergedDiscounts.length > 0) {
          const newSelfName = `${survivorFarmerEntry.name.trim()} - ${survivorFarmerEntry.contactNumber.trim()} - ${survivorFarmerEntry.village.trim()}`;
          for (const d of mergedDiscounts) {
            const oldSelfName = `${d.farmerName.trim()} - ${d.contactNumber.trim()} - ${d.village.trim()}`;
            let updatedAllocations = d.buyerAllocations;
            try {
              const allocations = JSON.parse(d.buyerAllocations || '[]');
              const updated = allocations.map((a: { buyerName?: string; isFarmerSelf?: boolean; amount?: number }) => {
                if (a.isFarmerSelf || (a.buyerName || '').trim().toLowerCase() === oldSelfName.toLowerCase()) {
                  return { ...a, buyerName: newSelfName };
                }
                return a;
              });
              updatedAllocations = JSON.stringify(updated);
            } catch (e) {
              console.warn(`[farmerMerge] Failed to parse buyerAllocations for discount ${d.id}:`, e);
            }
            await db.update(discounts)
              .set({
                farmerLedgerId: survivorId,
                farmerId: survivorFarmerId,
                farmerName: survivorFarmerEntry.name,
                contactNumber: survivorFarmerEntry.contactNumber,
                village: survivorFarmerEntry.village,
                buyerAllocations: updatedAllocations,
              })
              .where(eq(discounts.id, d.id));
          }
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
        const totalRecordsTransferred = mergedLots.length + mergedReceivables.length + mergedSales.length + mergedDiscounts.length;
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
    
    // Update buyerName on farmer-type cash receipts (stored as "FarmerName (Village)")
    const farmerDisplayName = `${farmer.name} (${farmer.village})`;
    await db.update(cashReceipts)
      .set({ buyerName: farmerDisplayName })
      .where(eq(cashReceipts.farmerLedgerId, farmerLedgerId));

    // Update discounts — top-level fields + self-allocation buyerName in JSON
    const farmerDiscountRecords = await db.select()
      .from(discounts)
      .where(eq(discounts.farmerLedgerId, farmerLedgerId));
    const newSelfBuyerName = `${farmer.name.trim()} - ${farmer.contactNumber.trim()} - ${farmer.village.trim()}`;
    for (const d of farmerDiscountRecords) {
      const oldSelfBuyerName = `${d.farmerName.trim()} - ${d.contactNumber.trim()} - ${d.village.trim()}`;
      let updatedAllocations = d.buyerAllocations;
      try {
        const allocations = JSON.parse(d.buyerAllocations || '[]');
        const updated = allocations.map((a: { buyerName?: string; isFarmerSelf?: boolean; amount?: number }) => {
          if (a.isFarmerSelf || (a.buyerName || '').trim().toLowerCase() === oldSelfBuyerName.toLowerCase()) {
            return { ...a, buyerName: newSelfBuyerName };
          }
          return a;
        });
        updatedAllocations = JSON.stringify(updated);
      } catch (e) {
        console.warn(`[propagateFarmerDetails] Failed to parse buyerAllocations for discount ${d.id}:`, e);
      }
      await db.update(discounts)
        .set({
          farmerName: farmer.name,
          contactNumber: farmer.contactNumber,
          village: farmer.village,
          buyerAllocations: updatedAllocations,
        })
        .where(eq(discounts.id, d.id));
    }
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
    
    // Compute current max from existing records to seed the counter on first use
    // This ensures continuity when transitioning from the old approach
    const existingBuyers = await db.select({ buyerId: buyerLedger.buyerId })
      .from(buyerLedger)
      .where(and(
        eq(buyerLedger.coldStorageId, coldStorageId),
        sql`${buyerLedger.buyerId} LIKE ${datePrefix + '%'}`
      ));
    
    let maxSeq = 0;
    for (const buyer of existingBuyers) {
      const seq = parseInt(buyer.buyerId.substring(datePrefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
    
    return generateSequentialId('buyer', coldStorageId, maxSeq);
  }

  // Get buyer ledger with calculated dues
  async getBuyerLedger(coldStorageId: string, includeArchived: boolean = false): Promise<{
    buyers: (BuyerLedgerEntry & {
      pyReceivables: number;
      advanceDue: number;
      dueTransferOut: number;
      dueTransferIn: number;
      salesDue: number;
      buyerExtras: number;
      netDue: number;
    })[];
    summary: {
      totalBuyers: number;
      pyReceivables: number;
      advanceDue: number;
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

    // Get merchant advances (non-reversed)
    const allMerchantAdvances = await db.select()
      .from(merchantAdvance)
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        eq(merchantAdvance.isReversed, 0)
      ));
    
    // Get sales history to calculate sales dues (non-self-sales, including transferred)
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
        .reduce((sum, r) => sum + ((r.finalAmount ?? r.dueAmount) - (r.paidAmount || 0)), 0);

      // Merchant Advance Due: Sum of unpaid merchant advances for this buyer
      const advanceDue = allMerchantAdvances
        .filter(ma => ma.buyerLedgerId === buyer.id)
        .reduce((sum, ma) => sum + ((ma.finalAmount || 0) - (ma.paidAmount || 0)), 0);
      
      // Sales Due: Sum of unpaid sales to this buyer (including transferred sales)
      // Transfer Out offsets these in netDue calculation
      const buyerSales = allSales
        .filter(s => matchesBuyer(s));
      
      // dueAmount already represents the remaining unpaid amount (updated when payments are made)
      // adjReceivableSelfDueAmount: farmer dues adjusted through this sale, also owed by buyer
      const salesDue = buyerSales.reduce((sum, s) => sum + (s.dueAmount || 0), 0);
      
      // Buyer Extras: Use extraDueToMerchant (the FIFO-maintained remaining due), NOT the
      // sub-fields (extraDueHammaliMerchant etc.) which are set once at sale time and never
      // reduced by payments. extraDueToMerchant is correctly decremented by recomputeBuyerPayments.
      const buyerExtras = buyerSales.reduce((sum, s) => sum + (s.extraDueToMerchant || 0), 0);
      
      // Transfer In from buyer-to-buyer transfers (salesHistory with transferToBuyerName)
      const buyerTransferIn = allTransferredSales
        .filter(s => s.transferToBuyerName!.trim().toLowerCase() === buyerNameLower)
        .reduce((sum, s) => sum + (s.dueAmount || 0), 0);
      
      // Transfer Out: When this buyer is the source (buyerName/buyerLedgerId matches, and isSelfSale=0)
      const buyerTransferOut = allTransferredSales
        .filter(s => matchesBuyer(s) && s.isSelfSale === 0)
        .reduce((sum, s) => sum + (s.dueAmount || 0), 0);
      
      const dueTransferIn = buyerTransferIn - buyerTransferOut;
      const dueTransferOut = 0;
      
      // Net Due = Receivables + Sales Due + Transfer (net)
      // salesDue includes transferred sales; net transfer offsets sender's transferred amount
      const netDue = roundAmount(pyReceivables + advanceDue + salesDue + buyerExtras + dueTransferIn);
      
      return {
        ...buyer,
        pyReceivables: roundAmount(pyReceivables),
        advanceDue: roundAmount(advanceDue),
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
      advanceDue: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.advanceDue, 0)),
      dueTransferOut: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.dueTransferOut, 0)),
      dueTransferIn: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.dueTransferIn, 0)),
      salesDue: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.salesDue, 0)),
      buyerExtras: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.buyerExtras, 0)),
      netDue: roundAmount(buyersWithDues.reduce((sum, b) => sum + b.netDue, 0)),
    };
    
    return { buyers: buyersWithDues, summary };
  }

  async getBuyerTransactions(buyerLedgerId: string, coldStorageId: string, fyStartYear: number): Promise<{
    openingBalance: number;
    transactions: {
      type: string;
      date: string;
      debit: number;
      credit: number;
      refId?: string;
      meta?: Record<string, string>;
    }[];
  }> {
    const fyStart = new Date(fyStartYear, 3, 1);
    const fyEnd = new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999);

    const buyer = await db.select().from(buyerLedger)
      .where(and(eq(buyerLedger.id, buyerLedgerId), eq(buyerLedger.coldStorageId, coldStorageId)))
      .then(rows => rows[0]);
    if (!buyer) return { openingBalance: 0, transactions: [] };
    const buyerNameLower = buyer.buyerName.trim().toLowerCase();

    const matchesBuyer = (record: { buyerLedgerId?: string | null; buyerName?: string | null }) => {
      if (record.buyerLedgerId && buyer.id) return record.buyerLedgerId === buyer.id;
      return record.buyerName?.trim().toLowerCase() === buyerNameLower;
    };

    const allSales = await db.select().from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        eq(salesHistory.isSelfSale, 0)
      ));

    const allReceipts = await db.select().from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.isReversed, 0)
      ));

    const allBankAccounts = await db.select().from(bankAccounts)
      .where(eq(bankAccounts.coldStorageId, coldStorageId));
    const accountMap = new Map(allBankAccounts.map(a => [a.id, a.accountName]));

    const allReceivables = await db.select().from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.payerType, 'cold_merchant')
      ));

    const allAdvances = await db.select().from(merchantAdvance)
      .where(and(
        eq(merchantAdvance.coldStorageId, coldStorageId),
        eq(merchantAdvance.isReversed, 0)
      ));

    const allDiscounts = await db.select().from(discounts)
      .where(and(
        eq(discounts.coldStorageId, coldStorageId),
        eq(discounts.isReversed, 0)
      ));

    const allTransferredSales = await db.select().from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        sql`${salesHistory.transferToBuyerName} IS NOT NULL AND TRIM(${salesHistory.transferToBuyerName}) != ''`,
        sql`(${salesHistory.isTransferReversed} IS NULL OR ${salesHistory.isTransferReversed} = 0)`
      ));

    const buyerSales = allSales.filter(s => matchesBuyer(s));
    const buyerReceipts = allReceipts.filter(r =>
      (r.payerType === 'cold_merchant' || r.payerType === 'cold_merchant_advance') && matchesBuyer(r)
    );
    const buyerReceivables = allReceivables.filter(r => matchesBuyer(r));
    const buyerAdvances = allAdvances.filter(ma => ma.buyerLedgerId === buyer.id);
    const transfersIn = allTransferredSales.filter(s =>
      s.transferToBuyerName?.trim().toLowerCase() === buyerNameLower
    );
    const transfersOut = allTransferredSales.filter(s =>
      matchesBuyer(s) && s.isSelfSale === 0
    );

    const saleDebitAmount = (s: typeof allSales[0]) => {
      return (s.coldStorageCharge || 0) + (s.extraDueToMerchantOriginal || 0);
    };

    let openingBalance = 0;

    const priorReceivables = buyerReceivables.filter(r => {
      return r.createdAt < fyStart;
    });
    openingBalance += priorReceivables.reduce((sum, r) => sum + (r.finalAmount ?? r.dueAmount), 0);

    const priorSales = buyerSales.filter(s => s.soldAt < fyStart);
    openingBalance += priorSales.reduce((sum, s) => sum + saleDebitAmount(s), 0);

    const priorReceipts = buyerReceipts.filter(r => r.receivedAt < fyStart);
    openingBalance -= priorReceipts.reduce((sum, r) => sum + r.amount, 0);

    const priorTransfersIn = transfersIn.filter(s => {
      const tDate = s.transferDate || s.soldAt;
      return tDate < fyStart;
    });
    openingBalance += priorTransfersIn.reduce((sum, s) => sum + (s.transferAmount || s.dueAmount || 0), 0);

    const priorTransfersOut = transfersOut.filter(s => {
      const tDate = s.transferDate || s.soldAt;
      return tDate < fyStart;
    });
    openingBalance -= priorTransfersOut.reduce((sum, s) => sum + (s.transferAmount || s.dueAmount || 0), 0);

    const priorAdvances = buyerAdvances.filter(ma => (ma.originalEffectiveDate || ma.effectiveDate) < fyStart);
    openingBalance += priorAdvances.reduce((sum, ma) => sum + (ma.finalAmount || ma.amount), 0);

    const priorDiscounts = allDiscounts.filter(d => {
      if (d.discountDate >= fyStart) return false;
      try {
        const allocations = JSON.parse(d.buyerAllocations || '[]');
        return allocations.some((a: { buyerName?: string }) =>
          a.buyerName?.trim().toLowerCase() === buyerNameLower
        );
      } catch { return false; }
    });
    for (const d of priorDiscounts) {
      const allocations = JSON.parse(d.buyerAllocations || '[]');
      const buyerAlloc = allocations.find((a: { buyerName?: string }) =>
        a.buyerName?.trim().toLowerCase() === buyerNameLower
      );
      if (buyerAlloc) openingBalance -= buyerAlloc.amount || 0;
    }

    type TxnEntry = { type: string; date: string; debit: number; credit: number; refId?: string; meta?: Record<string, string>; sortDate: Date; sortOrder: number };
    const transactions: TxnEntry[] = [];

    const fyReceivables = buyerReceivables.filter(r => r.createdAt >= fyStart && r.createdAt <= fyEnd);
    for (const r of fyReceivables) {
      const amt = (r.finalAmount ?? r.dueAmount);
      const principalAmt = roundAmount(r.dueAmount);
      const meta: Record<string, string> = {};
      if (r.remarks) meta.remarks = r.remarks;
      if (r.rateOfInterest > 0) {
        const totalDebit = roundAmount(amt);
        const interestAmt = roundAmount(totalDebit - principalAmt);
        transactions.push({
          type: 'py_receivable',
          date: `${fyStartYear}-04-01`,
          meta: Object.keys(meta).length > 0 ? { ...meta } : undefined,
          debit: principalAmt,
          credit: 0,
          refId: r.id,
          sortDate: fyStart,
          sortOrder: 1,
        });
        if (interestAmt > 0) {
          const intMeta: Record<string, string> = {
            advanceAmount: String(roundAmount(r.dueAmount)),
            principal: String(roundAmount(r.latestPrincipal ?? r.dueAmount)),
            rateOfInterest: String(r.rateOfInterest),
            effectiveDate: r.effectiveDate ? toISTDateString(new Date(r.effectiveDate)) : '',
            outstandingDue: String(roundAmount(Math.max(0, amt - (r.paidAmount || 0)))),
          };
          transactions.push({
            type: 'py_receivable_interest',
            date: `${fyStartYear}-04-01`,
            meta: intMeta,
            debit: interestAmt,
            credit: 0,
            refId: r.id,
            sortDate: fyStart,
            sortOrder: 1,
          });
        }
      } else {
        transactions.push({
          type: 'py_receivable',
          date: `${fyStartYear}-04-01`,
          meta: Object.keys(meta).length > 0 ? meta : undefined,
          debit: principalAmt,
          credit: 0,
          refId: r.id,
          sortDate: fyStart,
          sortOrder: 1,
        });
      }
    }

    const fySales = buyerSales.filter(s => s.soldAt >= fyStart && s.soldAt <= fyEnd);
    for (const s of fySales) {
      const amt = saleDebitAmount(s);
      transactions.push({
        type: 'sale',
        date: toISTDateString(s.soldAt),
        meta: {
          lotNo: String(s.lotNo),
          farmerName: s.farmerName,
          bags: String(s.quantitySold),
          marka: s.marka || '',
          coldBillNo: s.coldStorageBillNumber != null ? String(s.coldStorageBillNumber) : '',
        },
        debit: roundAmount(amt),
        credit: 0,
        refId: s.id,
        sortDate: s.soldAt,
        sortOrder: 3,
      });
    }

    const advancePaymentMetaMap = new Map<string, Record<string, string>>();
    {
      const advanceMap = new Map(buyerAdvances.map(ma => [ma.id, ma]));
      const advanceIds = buyerAdvances.map(ma => ma.id);
      const paymentEvents = advanceIds.length > 0
        ? await db.select().from(merchantAdvanceEvents)
            .where(and(
              inArray(merchantAdvanceEvents.merchantAdvanceId, advanceIds),
              eq(merchantAdvanceEvents.eventType, 'payment')
            ))
        : [];
      const eventsByReceiptId = new Map<string, typeof paymentEvents>();
      for (const evt of paymentEvents) {
        if (!evt.receiptId) continue;
        const arr = eventsByReceiptId.get(evt.receiptId) || [];
        arr.push(evt);
        eventsByReceiptId.set(evt.receiptId, arr);
      }

      const totalFinalAll = buyerAdvances.reduce((s, ma) => s + (ma.finalAmount || ma.amount), 0);
      const allAdvanceReceipts = buyerReceipts
        .filter(r => r.payerType === 'cold_merchant_advance' && !r.isReversed)
        .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
      let cumulativePaid = 0;
      for (const r of allAdvanceReceipts) {
        cumulativePaid += r.amount;
        const outstandingAfter = roundAmount(Math.max(0, totalFinalAll - cumulativePaid));
        const meta: Record<string, string> = { outstandingDue: String(outstandingAfter) };

        const receiptEvents = eventsByReceiptId.get(r.id);
        if (receiptEvents && receiptEvents.length > 0) {
          if (receiptEvents.length === 1) {
            const evt = receiptEvents[0];
            meta.advanceAmount = String(roundAmount(evt.amount));
            meta.principal = String(roundAmount(evt.latestPrincipalBefore ?? evt.amount));
            meta.rateOfInterest = String(evt.rateOfInterest);
            meta.effectiveDate = evt.effectiveDateBefore ? toISTDateString(evt.effectiveDateBefore) : '';
            meta.outstandingDue = String(roundAmount(Math.max(0, (evt.finalAmountBefore ?? evt.amount) - (evt.paidAmountBefore ?? 0))));
          } else {
            const details = receiptEvents.map(evt => {
              const parts = [`₹${roundAmount(evt.amount)}`];
              if (evt.rateOfInterest > 0) parts.push(`${evt.rateOfInterest}%`);
              return parts.join('@');
            });
            meta.advanceDetails = details.join(' + ');
            meta.advanceAmount = String(roundAmount(receiptEvents.reduce((s, evt) => s + evt.amount, 0)));
            meta.outstandingDue = String(roundAmount(Math.max(0, receiptEvents.reduce((s, evt) => s + (evt.finalAmountBefore ?? evt.amount) - (evt.paidAmountBefore ?? 0), 0))));
          }
        } else {
          let appliedIds: string[] = [];
          try { appliedIds = r.appliedAdvanceIds ? JSON.parse(r.appliedAdvanceIds) : []; } catch {}
          const matchedAdvances = appliedIds.map(id => advanceMap.get(id)).filter((ma): ma is NonNullable<typeof ma> => ma != null);
          if (matchedAdvances.length === 1) {
            const ma = matchedAdvances[0];
            meta.advanceAmount = String(roundAmount(ma.amount));
            meta.principal = String(roundAmount(ma.latestPrincipal ?? ma.amount));
            meta.rateOfInterest = String(ma.rateOfInterest);
            meta.effectiveDate = toISTDateString(ma.effectiveDate);
            meta.outstandingDue = String(roundAmount(Math.max(0, (ma.finalAmount || ma.amount) - (ma.paidAmount || 0))));
          } else if (matchedAdvances.length > 1) {
            const details = matchedAdvances.map(ma => {
              const parts = [`₹${roundAmount(ma.amount)}`];
              if (ma.rateOfInterest > 0) parts.push(`${ma.rateOfInterest}%`);
              return parts.join('@');
            });
            meta.advanceDetails = details.join(' + ');
            meta.advanceAmount = String(roundAmount(matchedAdvances.reduce((s, ma) => s + ma.amount, 0)));
            meta.outstandingDue = String(roundAmount(Math.max(0, matchedAdvances.reduce((s, ma) => s + (ma.finalAmount || ma.amount) - (ma.paidAmount || 0), 0))));
          } else {
            const withInterest = buyerAdvances.filter(ma => ma.rateOfInterest > 0);
            if (withInterest.length === 1) {
              const ma = withInterest[0];
              meta.advanceAmount = String(roundAmount(ma.amount));
              meta.principal = String(roundAmount(ma.latestPrincipal ?? ma.amount));
              meta.rateOfInterest = String(ma.rateOfInterest);
              meta.effectiveDate = toISTDateString(ma.effectiveDate);
            } else if (withInterest.length > 1) {
              const details = withInterest.map(ma => {
                const parts = [`₹${roundAmount(ma.amount)}`];
                if (ma.rateOfInterest > 0) parts.push(`${ma.rateOfInterest}%`);
                return parts.join('@');
              });
              meta.advanceDetails = details.join(' + ');
              meta.advanceAmount = String(roundAmount(withInterest.reduce((s, ma) => s + ma.amount, 0)));
            }
          }
        }
        advancePaymentMetaMap.set(r.id, meta);
      }
    }

    const fyReceipts = buyerReceipts.filter(r => r.receivedAt >= fyStart && r.receivedAt <= fyEnd);
    for (const r of fyReceipts) {
      const isCmAdvance = r.payerType === 'cold_merchant_advance';
      const acctName = r.accountId ? (accountMap.get(r.accountId) || '') : '';
      const receiptMeta: Record<string, string> = { transactionId: r.transactionId || '', mode: r.receiptType || 'cash', accountName: acctName };
      if (isCmAdvance) {
        const advMeta = advancePaymentMetaMap.get(r.id);
        if (advMeta) Object.assign(receiptMeta, advMeta);
      }
      transactions.push({
        type: isCmAdvance ? 'cm_advance_payment' : 'payment',
        date: toISTDateString(r.receivedAt),
        meta: receiptMeta,
        debit: 0,
        credit: roundAmount(r.amount),
        refId: r.id,
        sortDate: r.receivedAt,
        sortOrder: 5,
      });
    }

    const fyTransfersIn = transfersIn.filter(s => {
      const tDate = s.transferDate || s.soldAt;
      return tDate >= fyStart && tDate <= fyEnd;
    });
    for (const s of fyTransfersIn) {
      const tDate = s.transferDate || s.soldAt;
      const amt = s.transferAmount || s.dueAmount || 0;
      transactions.push({
        type: 'transfer_in',
        date: toISTDateString(tDate),
        meta: { fromBuyer: s.buyerName || '?', transactionId: s.transferTransactionId || '' },
        debit: roundAmount(amt),
        credit: 0,
        refId: s.id,
        sortDate: tDate,
        sortOrder: 4,
      });
    }

    const fyTransfersOut = transfersOut.filter(s => {
      const tDate = s.transferDate || s.soldAt;
      return tDate >= fyStart && tDate <= fyEnd;
    });
    for (const s of fyTransfersOut) {
      const tDate = s.transferDate || s.soldAt;
      const amt = s.transferAmount || s.dueAmount || 0;
      transactions.push({
        type: 'transfer_out',
        date: toISTDateString(tDate),
        meta: { toBuyer: s.transferToBuyerName || '?', transactionId: s.transferTransactionId || '' },
        debit: 0,
        credit: roundAmount(amt),
        refId: s.id,
        sortDate: tDate,
        sortOrder: 4,
      });
    }

    const fyAdvances = buyerAdvances.filter(ma => {
      const origDate = ma.originalEffectiveDate || ma.effectiveDate;
      return origDate >= fyStart && origDate <= fyEnd;
    });
    for (const ma of fyAdvances) {
      const principalAmt = roundAmount(ma.amount);
      const totalAmt = roundAmount(ma.finalAmount || ma.amount);
      const origDate = ma.originalEffectiveDate || ma.effectiveDate;
      const advDateStr = toISTDateString(origDate);
      transactions.push({
        type: 'advance',
        date: advDateStr,
        meta: { amount: String(principalAmt) },
        debit: principalAmt,
        credit: 0,
        refId: ma.id,
        sortDate: origDate,
        sortOrder: 4,
      });
      if (ma.rateOfInterest > 0) {
        const interestAmt = roundAmount(totalAmt - principalAmt);
        if (interestAmt > 0) {
          const intMeta: Record<string, string> = {
            advanceAmount: String(roundAmount(ma.amount)),
            principal: String(roundAmount(ma.latestPrincipal ?? ma.amount)),
            rateOfInterest: String(ma.rateOfInterest),
            effectiveDate: advDateStr,
            outstandingDue: String(roundAmount(Math.max(0, totalAmt - (ma.paidAmount || 0)))),
          };
          transactions.push({
            type: 'advance_interest',
            date: advDateStr,
            meta: intMeta,
            debit: interestAmt,
            credit: 0,
            refId: ma.id,
            sortDate: origDate,
            sortOrder: 4,
          });
        }
      }
    }

    const fyDiscounts = allDiscounts.filter(d => {
      if (d.discountDate < fyStart || d.discountDate > fyEnd) return false;
      try {
        const allocations = JSON.parse(d.buyerAllocations || '[]');
        return allocations.some((a: { buyerName?: string }) =>
          a.buyerName?.trim().toLowerCase() === buyerNameLower
        );
      } catch { return false; }
    });
    for (const d of fyDiscounts) {
      const allocations = JSON.parse(d.buyerAllocations || '[]');
      const buyerAlloc = allocations.find((a: { buyerName?: string }) =>
        a.buyerName?.trim().toLowerCase() === buyerNameLower
      );
      if (buyerAlloc) {
        transactions.push({
          type: 'discount',
          date: toISTDateString(d.discountDate),
          meta: { transactionId: d.transactionId || '', farmerName: d.farmerName },
          debit: 0,
          credit: roundAmount(buyerAlloc.amount || 0),
          refId: d.id,
          sortDate: d.discountDate,
          sortOrder: 5,
        });
      }
    }

    transactions.sort((a, b) => {
      const dayA = a.date;
      const dayB = b.date;
      if (dayA < dayB) return -1;
      if (dayA > dayB) return 1;
      return a.sortOrder - b.sortOrder;
    });

    return {
      openingBalance: roundAmount(openingBalance),
      transactions: transactions.map(({ sortDate, sortOrder, ...rest }) => rest),
    };
  }

  async getFarmerTransactions(farmerLedgerId: string, coldStorageId: string, fyStartYear: number): Promise<{
    openingBalance: number;
    transactions: {
      type: string;
      date: string;
      debit: number;
      credit: number;
      refId?: string;
      meta?: Record<string, string>;
    }[];
  }> {
    const fyStart = new Date(fyStartYear, 3, 1);
    const fyEnd = new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999);

    const farmer = await db.select().from(farmerLedger)
      .where(and(eq(farmerLedger.id, farmerLedgerId), eq(farmerLedger.coldStorageId, coldStorageId)))
      .then(rows => rows[0]);
    if (!farmer) return { openingBalance: 0, transactions: [] };

    const matchesFarmer = (record: { farmerLedgerId?: string | null; farmerName?: string | null; contactNumber?: string | null; village?: string | null }) => {
      if (record.farmerLedgerId) return record.farmerLedgerId === farmer.id;
      return (
        record.farmerName?.trim().toLowerCase() === farmer.name.trim().toLowerCase() &&
        record.contactNumber?.trim() === farmer.contactNumber.trim() &&
        record.village?.trim().toLowerCase() === farmer.village.trim().toLowerCase()
      );
    };

    const farmerSelfBuyerName = `${farmer.name.trim()} - ${farmer.contactNumber.trim()} - ${farmer.village.trim()}`;

    const allReceivables = await db.select().from(openingReceivables)
      .where(and(
        eq(openingReceivables.coldStorageId, coldStorageId),
        eq(openingReceivables.payerType, 'farmer')
      ));

    const allAdvFreight = await db.select().from(farmerAdvanceFreight)
      .where(and(
        eq(farmerAdvanceFreight.coldStorageId, coldStorageId),
        eq(farmerAdvanceFreight.isReversed, 0)
      ));

    const allSelfSales = await db.select().from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        eq(salesHistory.isSelfSale, 1)
      ));

    const allReceipts = await db.select().from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.payerType, 'farmer'),
        eq(cashReceipts.isReversed, 0)
      ));

    const allBankAccounts = await db.select().from(bankAccounts)
      .where(eq(bankAccounts.coldStorageId, coldStorageId));
    const accountMap = new Map(allBankAccounts.map(a => [a.id, a.accountName]));

    const allDiscounts = await db.select().from(discounts)
      .where(and(
        eq(discounts.coldStorageId, coldStorageId),
        eq(discounts.isReversed, 0)
      ));

    const allAdjSales = await db.select().from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        sql`(COALESCE(is_self_sale, 0) != 1)`,
        sql`COALESCE(adj_receivable_self_due_amount, 0) > 0`,
      ));

    const allFarmerLoans = await db.select().from(farmerLoan)
      .where(and(
        eq(farmerLoan.coldStorageId, coldStorageId),
        eq(farmerLoan.isReversed, 0)
      ));

    const allFarmerLoanEventRows = allFarmerLoans.length > 0
      ? await db.select().from(farmerLoanEvents)
          .where(sql`${farmerLoanEvents.farmerLoanId} IN (${sql.join(allFarmerLoans.map(fl => sql`${fl.id}`), sql`, `)})`)
          .orderBy(farmerLoanEvents.eventDate)
      : [];
    const loanEventsMap = new Map<string, FarmerLoanEvent[]>();
    for (const ev of allFarmerLoanEventRows) {
      if (!loanEventsMap.has(ev.farmerLoanId)) loanEventsMap.set(ev.farmerLoanId, []);
      loanEventsMap.get(ev.farmerLoanId)!.push(ev);
    }

    const allFarmerLoanReceipts = await db.select().from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, coldStorageId),
        eq(cashReceipts.payerType, 'farmer_loan'),
        eq(cashReceipts.isReversed, 0)
      ));

    const farmerReceivables = allReceivables.filter(r => matchesFarmer(r));
    const farmerAdvFreight = allAdvFreight.filter(af => af.farmerLedgerId === farmer.id);
    const farmerSelfSales = allSelfSales.filter(s => {
      if (!matchesFarmer(s)) return false;
      if (s.transferToBuyerName && s.transferToBuyerName.trim() !== '' && (s.isTransferReversed === null || s.isTransferReversed === 0)) return false;
      return true;
    });
    const farmerReceipts = allReceipts.filter(r => matchesFarmer(r));

    const getSelfAllocAmount = (d: typeof allDiscounts[0]): number => {
      try {
        const allocations = JSON.parse(d.buyerAllocations || '[]');
        const discountSelfName = `${d.farmerName.trim()} - ${d.contactNumber.trim()} - ${d.village.trim()}`.toLowerCase();
        const selfAlloc = allocations.find((a: { buyerName?: string; isFarmerSelf?: boolean }) => {
          if (a.isFarmerSelf) return true;
          const allocName = (a.buyerName || '').trim().toLowerCase();
          return allocName === farmerSelfBuyerName.toLowerCase() || allocName === discountSelfName;
        });
        return selfAlloc ? (selfAlloc.amount || 0) : 0;
      } catch { return 0; }
    };

    const farmerDiscounts = allDiscounts.filter(d => {
      if (!matchesFarmer(d)) return false;
      return getSelfAllocAmount(d) > 0;
    });

    const farmerAdjSales = allAdjSales.filter(s => matchesFarmer(s));

    const farmerLoans = allFarmerLoans.filter(fl => fl.farmerLedgerId === farmer.id);
    const farmerLoanRcpts = allFarmerLoanReceipts.filter(r => r.buyerLedgerId === farmer.id);

    let openingBalance = 0;

    const priorReceivables = farmerReceivables.filter(r => r.createdAt < fyStart);
    openingBalance += priorReceivables.reduce((sum, r) => sum + (r.finalAmount ?? r.dueAmount), 0);

    const priorAdvFreight = farmerAdvFreight.filter(af => af.effectiveDate < fyStart);
    openingBalance += priorAdvFreight.reduce((sum, af) => sum + (af.finalAmount || af.amount), 0);

    const priorSelfSales = farmerSelfSales.filter(s => s.soldAt < fyStart);
    openingBalance += priorSelfSales.reduce((sum, s) => sum + (s.coldStorageCharge || 0), 0);

    const priorFarmerLoans = farmerLoans.filter(fl => (fl.originalEffectiveDate || fl.effectiveDate) < fyStart);
    openingBalance += priorFarmerLoans.reduce((sum, fl) => sum + (fl.finalAmount || fl.amount), 0);

    const priorReceipts = farmerReceipts.filter(r => r.receivedAt < fyStart);
    openingBalance -= priorReceipts.reduce((sum, r) => sum + r.amount, 0);

    const priorFarmerLoanRcpts = farmerLoanRcpts.filter(r => r.receivedAt < fyStart);
    openingBalance -= priorFarmerLoanRcpts.reduce((sum, r) => sum + r.amount, 0);

    const priorDiscounts = farmerDiscounts.filter(d => d.discountDate < fyStart);
    for (const d of priorDiscounts) {
      openingBalance -= getSelfAllocAmount(d);
    }

    const priorAdjSales = farmerAdjSales.filter(s => s.soldAt < fyStart);
    openingBalance -= priorAdjSales.reduce((sum, s) => sum + (s.adjReceivableSelfDueAmount || 0), 0);

    type TxnEntry = { type: string; date: string; debit: number; credit: number; refId?: string; meta?: Record<string, string>; sortDate: Date; sortOrder: number };
    const transactions: TxnEntry[] = [];

    const fyReceivables = farmerReceivables.filter(r => r.createdAt >= fyStart && r.createdAt <= fyEnd);
    for (const r of fyReceivables) {
      const amt = r.finalAmount ?? r.dueAmount;
      transactions.push({
        type: 'py_receivable',
        date: `${fyStartYear}-04-01`,
        meta: r.remarks ? { remarks: r.remarks } : undefined,
        debit: roundAmount(amt),
        credit: 0,
        refId: r.id,
        sortDate: fyStart,
        sortOrder: 1,
      });
    }

    const fyAdvFreight = farmerAdvFreight.filter(af => af.effectiveDate >= fyStart && af.effectiveDate <= fyEnd);
    for (const af of fyAdvFreight) {
      transactions.push({
        type: af.type === 'freight' ? 'freight' : 'advance',
        date: toISTDateString(af.effectiveDate),
        meta: { amount: String(roundAmount(af.finalAmount || af.amount)) },
        debit: roundAmount(af.finalAmount || af.amount),
        credit: 0,
        refId: af.id,
        sortDate: af.effectiveDate,
        sortOrder: 3,
      });
    }

    const fySelfSales = farmerSelfSales.filter(s => s.soldAt >= fyStart && s.soldAt <= fyEnd);
    for (const s of fySelfSales) {
      transactions.push({
        type: 'self_sale',
        date: toISTDateString(s.soldAt),
        meta: {
          lotNo: String(s.lotNo),
          buyerName: s.buyerName || '',
          bags: String(s.quantitySold),
          marka: s.marka || '',
          coldBillNo: s.coldStorageBillNumber != null ? String(s.coldStorageBillNumber) : '',
        },
        debit: roundAmount(s.coldStorageCharge || 0),
        credit: 0,
        refId: s.id,
        sortDate: s.soldAt,
        sortOrder: 3,
      });
    }

    const fyFarmerLoans = farmerLoans.filter(fl => {
      const origDate = fl.originalEffectiveDate || fl.effectiveDate;
      return origDate >= fyStart && origDate <= fyEnd;
    });
    for (const fl of fyFarmerLoans) {
      const events = loanEventsMap.get(fl.id) || [];
      const creationEvent = events.find(e => e.eventType === 'creation');
      const interestAmount = roundAmount((fl.finalAmount || fl.amount) - fl.amount);

      transactions.push({
        type: 'farmer_loan',
        date: toISTDateString(fl.originalEffectiveDate || fl.effectiveDate),
        meta: {
          amount: String(roundAmount(fl.amount)),
          principal: String(roundAmount(fl.amount)),
          rateOfInterest: String(fl.rateOfInterest || 0),
          eventType: creationEvent ? 'creation' : 'disbursement',
        },
        debit: roundAmount(fl.amount),
        credit: 0,
        refId: fl.id,
        sortDate: fl.originalEffectiveDate || fl.effectiveDate,
        sortOrder: 3,
      });

      if (interestAmount > 0) {
        const originDate = fl.originalEffectiveDate || fl.effectiveDate;
        transactions.push({
          type: 'farmer_loan_interest',
          date: toISTDateString(originDate),
          meta: {
            loanAmount:     String(roundAmount(fl.amount)),
            principal:      String(roundAmount(fl.latestPrincipal ?? fl.amount)),
            interest:       String(interestAmount),
            rateOfInterest: String(fl.rateOfInterest || 0),
            effectiveDate:  toISTDateString(fl.originalEffectiveDate || fl.effectiveDate),
            outstandingDue: String(roundAmount(Math.max(0, (fl.finalAmount || fl.amount) - (fl.paidAmount || 0)))),
            loanId:         fl.id,
          },
          debit: interestAmount,
          credit: 0,
          refId: fl.id,
          sortDate: originDate,
          sortOrder: 4,
        });
      }

      const compoundingEvents = events.filter(e => e.eventType === 'annual_compounding' && e.eventDate >= fyStart && e.eventDate <= fyEnd);
      for (const ce of compoundingEvents) {
        const compoundedAmt = roundAmount(ce.interestCompounded || 0);
        if (compoundedAmt > 0) {
          transactions.push({
            type: 'farmer_loan_interest',
            date: toISTDateString(ce.eventDate),
            meta: {
              interest: String(compoundedAmt),
              rateOfInterest: String(ce.rateOfInterest || 0),
              eventType: 'annual_compounding',
              loanId: fl.id,
            },
            debit: compoundedAmt,
            credit: 0,
            refId: ce.id,
            sortDate: ce.eventDate,
            sortOrder: 4,
          });
        }
      }
    }

    const loanPaymentMetaMap = new Map<string, Record<string, string>>();
    {
      const loanMap = new Map(farmerLoans.map(fl => [fl.id, fl]));
      const loanIds = farmerLoans.map(fl => fl.id);
      const paymentEvents = loanIds.length > 0
        ? await db.select().from(farmerLoanEvents)
            .where(and(
              inArray(farmerLoanEvents.farmerLoanId, loanIds),
              eq(farmerLoanEvents.eventType, 'payment')
            ))
        : [];
      const eventsByReceiptId = new Map<string, typeof paymentEvents>();
      for (const evt of paymentEvents) {
        if (!evt.receiptId) continue;
        const arr = eventsByReceiptId.get(evt.receiptId) || [];
        arr.push(evt);
        eventsByReceiptId.set(evt.receiptId, arr);
      }

      const totalFinalAll = farmerLoans.reduce((s, fl) => s + (fl.finalAmount || fl.amount), 0);
      const allLoanReceipts = [...farmerLoanRcpts].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
      let cumulativePaid = 0;
      for (const r of allLoanReceipts) {
        cumulativePaid += r.amount;
        const outstandingAfter = roundAmount(Math.max(0, totalFinalAll - cumulativePaid));
        const meta: Record<string, string> = { outstandingDue: String(outstandingAfter) };

        const receiptEvents = eventsByReceiptId.get(r.id);
        if (receiptEvents && receiptEvents.length > 0) {
          if (receiptEvents.length === 1) {
            const evt = receiptEvents[0];
            meta.loanAmount    = String(roundAmount(evt.amount));
            meta.principal     = String(roundAmount(evt.latestPrincipalBefore ?? evt.amount));
            meta.rateOfInterest = String(evt.rateOfInterest);
            meta.effectiveDate = evt.effectiveDateBefore ? toISTDateString(evt.effectiveDateBefore) : '';
            meta.outstandingDue = String(roundAmount(Math.max(0, (evt.finalAmountBefore ?? evt.amount) - (evt.paidAmountBefore ?? 0))));
          } else {
            const details = receiptEvents.map(evt => {
              const parts = [`₹${roundAmount(evt.amount)}`];
              if (evt.rateOfInterest > 0) parts.push(`${evt.rateOfInterest}%`);
              return parts.join('@');
            });
            meta.loanDetails   = details.join(' + ');
            meta.loanAmount    = String(roundAmount(receiptEvents.reduce((s, evt) => s + evt.amount, 0)));
            meta.outstandingDue = String(roundAmount(Math.max(0, receiptEvents.reduce((s, evt) => s + (evt.finalAmountBefore ?? evt.amount) - (evt.paidAmountBefore ?? 0), 0))));
          }
        } else {
          let appliedIds: string[] = [];
          try { appliedIds = r.appliedAdvanceIds ? JSON.parse(r.appliedAdvanceIds) : []; } catch {}
          const matchedLoans = appliedIds.map(id => loanMap.get(id)).filter((fl): fl is NonNullable<typeof fl> => fl != null);
          if (matchedLoans.length === 1) {
            const fl = matchedLoans[0];
            meta.loanAmount    = String(roundAmount(fl.amount));
            meta.principal     = String(roundAmount(fl.latestPrincipal ?? fl.amount));
            meta.rateOfInterest = String(fl.rateOfInterest);
            meta.effectiveDate = toISTDateString(fl.originalEffectiveDate || fl.effectiveDate);
            meta.outstandingDue = String(roundAmount(Math.max(0, (fl.finalAmount || fl.amount) - (fl.paidAmount || 0))));
          } else if (matchedLoans.length > 1) {
            const details = matchedLoans.map(fl => {
              const parts = [`₹${roundAmount(fl.amount)}`];
              if (fl.rateOfInterest > 0) parts.push(`${fl.rateOfInterest}%`);
              return parts.join('@');
            });
            meta.loanDetails   = details.join(' + ');
            meta.loanAmount    = String(roundAmount(matchedLoans.reduce((s, fl) => s + fl.amount, 0)));
            meta.outstandingDue = String(roundAmount(Math.max(0, matchedLoans.reduce((s, fl) => s + (fl.finalAmount || fl.amount) - (fl.paidAmount || 0), 0))));
          }
        }
        loanPaymentMetaMap.set(r.id, meta);
      }
    }

    const fyFarmerLoanRcpts = farmerLoanRcpts.filter(r => r.receivedAt >= fyStart && r.receivedAt <= fyEnd);
    for (const r of fyFarmerLoanRcpts) {
      const acctName = r.accountId ? (accountMap.get(r.accountId) || '') : '';
      const loanMeta = loanPaymentMetaMap.get(r.id);
      const payMeta: Record<string, string> = { transactionId: r.transactionId || '', mode: r.receiptType || 'cash', accountName: acctName };
      if (loanMeta) Object.assign(payMeta, loanMeta);
      transactions.push({
        type: 'farmer_loan_payment',
        date: toISTDateString(r.receivedAt),
        meta: payMeta,
        debit: 0,
        credit: roundAmount(r.amount),
        refId: r.id,
        sortDate: r.receivedAt,
        sortOrder: 5,
      });
    }

    const fyReceipts = farmerReceipts.filter(r => r.receivedAt >= fyStart && r.receivedAt <= fyEnd);
    for (const r of fyReceipts) {
      const acctName = r.accountId ? (accountMap.get(r.accountId) || '') : '';
      transactions.push({
        type: 'payment',
        date: toISTDateString(r.receivedAt),
        meta: { transactionId: r.transactionId || '', mode: r.receiptType || 'cash', accountName: acctName },
        debit: 0,
        credit: roundAmount(r.amount),
        refId: r.id,
        sortDate: r.receivedAt,
        sortOrder: 5,
      });
    }

    const fyDiscounts = farmerDiscounts.filter(d => d.discountDate >= fyStart && d.discountDate <= fyEnd);
    for (const d of fyDiscounts) {
      const selfAmt = getSelfAllocAmount(d);
      transactions.push({
        type: 'discount',
        date: toISTDateString(d.discountDate),
        meta: { transactionId: d.transactionId || '' },
        debit: 0,
        credit: roundAmount(selfAmt),
        refId: d.id,
        sortDate: d.discountDate,
        sortOrder: 5,
      });
    }

    const fyAdjSales = farmerAdjSales.filter(s => s.soldAt >= fyStart && s.soldAt <= fyEnd);
    for (const s of fyAdjSales) {
      transactions.push({
        type: 'sale_adj',
        date: toISTDateString(s.soldAt),
        meta: {
          lotNo: String(s.lotNo),
          buyerName: s.buyerName || '',
          marka: s.marka || '',
          coldBillNo: s.coldStorageBillNumber != null ? String(s.coldStorageBillNumber) : '',
        },
        debit: 0,
        credit: roundAmount(s.adjReceivableSelfDueAmount || 0),
        refId: s.id,
        sortDate: s.soldAt,
        sortOrder: 4,
      });
    }

    transactions.sort((a, b) => {
      const dayA = a.date;
      const dayB = b.date;
      if (dayA < dayB) return -1;
      if (dayA > dayB) return 1;
      return a.sortOrder - b.sortOrder;
    });

    return {
      openingBalance: roundAmount(openingBalance),
      transactions: transactions.map(({ sortDate, sortOrder, ...rest }) => rest),
    };
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
        
        const transfersCount = [{ count: 0 }];
        
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
      
      // Transfer sales history to target buyer (by buyerLedgerId)
      await db.update(salesHistory)
        .set({ 
          buyerName: targetBuyer.buyerName,
          buyerLedgerId: targetBuyer.id,
          buyerId: targetBuyer.buyerId,
        })
        .where(and(
          eq(salesHistory.coldStorageId, currentBuyer.coldStorageId),
          eq(salesHistory.buyerLedgerId, currentBuyer.id)
        ));
      
      // Also transfer legacy sales (no buyerLedgerId) matched by name
      await db.update(salesHistory)
        .set({ 
          buyerName: targetBuyer.buyerName,
          buyerLedgerId: targetBuyer.id,
          buyerId: targetBuyer.buyerId,
        })
        .where(and(
          eq(salesHistory.coldStorageId, currentBuyer.coldStorageId),
          isNull(salesHistory.buyerLedgerId),
          sql`LOWER(TRIM(${salesHistory.buyerName})) = ${buyerNameLower}`
        ));
      
      // Transfer cash receipts to target buyer (by buyerLedgerId)
      await db.update(cashReceipts)
        .set({
          buyerName: targetBuyer.buyerName,
          buyerLedgerId: targetBuyer.id,
          buyerId: targetBuyer.buyerId,
        })
        .where(and(
          eq(cashReceipts.coldStorageId, currentBuyer.coldStorageId),
          eq(cashReceipts.buyerLedgerId, currentBuyer.id)
        ));
      
      // Also transfer legacy cash receipts (no buyerLedgerId) matched by name
      await db.update(cashReceipts)
        .set({
          buyerName: targetBuyer.buyerName,
          buyerLedgerId: targetBuyer.id,
          buyerId: targetBuyer.buyerId,
        })
        .where(and(
          eq(cashReceipts.coldStorageId, currentBuyer.coldStorageId),
          isNull(cashReceipts.buyerLedgerId),
          sql`LOWER(TRIM(${cashReceipts.buyerName})) = ${buyerNameLower}`
        ));
      
      // Transfer opening receivables to target buyer (by buyerLedgerId)
      await db.update(openingReceivables)
        .set({
          buyerName: targetBuyer.buyerName,
          buyerLedgerId: targetBuyer.id,
          buyerId: targetBuyer.buyerId,
        })
        .where(and(
          eq(openingReceivables.coldStorageId, currentBuyer.coldStorageId),
          eq(openingReceivables.buyerLedgerId, currentBuyer.id)
        ));
      
      // Also transfer legacy opening receivables (no buyerLedgerId) matched by name
      await db.update(openingReceivables)
        .set({
          buyerName: targetBuyer.buyerName,
          buyerLedgerId: targetBuyer.id,
          buyerId: targetBuyer.buyerId,
        })
        .where(and(
          eq(openingReceivables.coldStorageId, currentBuyer.coldStorageId),
          isNull(openingReceivables.buyerLedgerId),
          sql`LOWER(TRIM(${openingReceivables.buyerName})) = ${buyerNameLower}`
        ));
      
      // Transfer merchant advances to target buyer
      await db.update(merchantAdvance)
        .set({
          buyerLedgerId: targetBuyer.id,
          buyerId: targetBuyer.buyerId,
        })
        .where(and(
          eq(merchantAdvance.coldStorageId, currentBuyer.coldStorageId),
          eq(merchantAdvance.buyerLedgerId, currentBuyer.id)
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
      
      // Propagate buyer name changes to all related tables
      if (currentBuyer.buyerName !== updated.buyerName) {
        const oldNameLower = currentBuyer.buyerName.trim().toLowerCase();
        
        await db.update(salesHistory)
          .set({ buyerName: updated.buyerName })
          .where(and(
            eq(salesHistory.coldStorageId, currentBuyer.coldStorageId),
            eq(salesHistory.buyerLedgerId, id)
          ));
        
        await db.update(cashReceipts)
          .set({ buyerName: updated.buyerName })
          .where(and(
            eq(cashReceipts.coldStorageId, currentBuyer.coldStorageId),
            eq(cashReceipts.buyerLedgerId, id)
          ));
        
        await db.update(openingReceivables)
          .set({ buyerName: updated.buyerName })
          .where(and(
            eq(openingReceivables.coldStorageId, currentBuyer.coldStorageId),
            eq(openingReceivables.buyerLedgerId, id)
          ));
        
        // Also update salesHistory where buyerName matches but buyerLedgerId might be null (legacy)
        await db.update(salesHistory)
          .set({ buyerName: updated.buyerName })
          .where(and(
            eq(salesHistory.coldStorageId, currentBuyer.coldStorageId),
            isNull(salesHistory.buyerLedgerId),
            sql`LOWER(TRIM(${salesHistory.buyerName})) = ${oldNameLower}`
          ));
        
        // Also update cashReceipts where buyerLedgerId might be null (legacy)
        await db.update(cashReceipts)
          .set({ buyerName: updated.buyerName })
          .where(and(
            eq(cashReceipts.coldStorageId, currentBuyer.coldStorageId),
            isNull(cashReceipts.buyerLedgerId),
            sql`LOWER(TRIM(${cashReceipts.buyerName})) = ${oldNameLower}`
          ));
        
        // Also update openingReceivables where buyerLedgerId might be null (legacy)
        await db.update(openingReceivables)
          .set({ buyerName: updated.buyerName })
          .where(and(
            eq(openingReceivables.coldStorageId, currentBuyer.coldStorageId),
            isNull(openingReceivables.buyerLedgerId),
            sql`LOWER(TRIM(${openingReceivables.buyerName})) = ${oldNameLower}`
          ));
      }
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

  // Create buyer manually — rejects if name already exists (unlike ensureBuyerLedgerEntry)
  async createManualBuyer(coldStorageId: string, buyerData: {
    buyerName: string;
    address?: string;
    contactNumber?: string;
  }): Promise<{ id: string; buyerId: string }> {
    // Reject if a buyer with this name already exists
    const [existing] = await db.select({ id: buyerLedger.id })
      .from(buyerLedger)
      .where(and(
        eq(buyerLedger.coldStorageId, coldStorageId),
        sql`LOWER(TRIM(${buyerLedger.buyerName})) = ${buyerData.buyerName.trim().toLowerCase()}`
      ));

    if (existing) {
      const err = new Error('A buyer with this name already exists') as any;
      err.code = 'DUPLICATE_NAME';
      throw err;
    }

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
        if (error?.code === '23505' && (error?.constraint?.includes('buyer_id') || error?.constraint?.includes('cs_bid'))) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Failed to generate unique buyer ID after multiple attempts');
  }

  // ==================== Assets ====================

  async getAssets(coldStorageId: string): Promise<Asset[]> {
    return await db.select().from(assets)
      .where(eq(assets.coldStorageId, coldStorageId))
      .orderBy(desc(assets.createdAt));
  }

  async createAsset(data: InsertAsset): Promise<Asset> {
    const id = randomUUID();
    const [asset] = await db.insert(assets).values({
      ...data,
      id,
      isDisposed: 0,
    }).returning();
    return asset;
  }

  async updateAsset(id: string, updates: Partial<Asset>): Promise<Asset | undefined> {
    const [updated] = await db.update(assets)
      .set(updates)
      .where(eq(assets.id, id))
      .returning();
    return updated;
  }

  async disposeAsset(id: string, disposalAmount: number, disposedAt: Date): Promise<Asset | undefined> {
    const [updated] = await db.update(assets)
      .set({
        isDisposed: 1,
        disposedAt,
        disposalAmount,
      })
      .where(eq(assets.id, id))
      .returning();
    return updated;
  }

  async getDepreciationLog(coldStorageId: string, financialYear: string): Promise<AssetDepreciationLog[]> {
    return await db.select().from(assetDepreciationLog)
      .where(and(
        eq(assetDepreciationLog.coldStorageId, coldStorageId),
        eq(assetDepreciationLog.financialYear, financialYear),
      ))
      .orderBy(asc(assetDepreciationLog.calculatedAt));
  }

  async runDepreciation(coldStorageId: string, financialYear: string): Promise<AssetDepreciationLog[]> {
    const { start: fyStart, end: fyEnd } = getFYDateRange(financialYear);
    
    const allAssets = await db.select().from(assets)
      .where(and(
        eq(assets.coldStorageId, coldStorageId),
        lte(assets.purchaseDate, fyEnd),
        sql`(${assets.isDisposed} = 0 OR ${assets.disposedAt} >= ${fyStart})`,
      ));

    const results: AssetDepreciationLog[] = [];

    for (const asset of allAssets) {
      const purchaseDate = new Date(asset.purchaseDate);
      if (purchaseDate > fyEnd) continue;

      let startMonth: number;
      if (purchaseDate >= fyStart) {
        startMonth = purchaseDate.getMonth();
      } else {
        startMonth = 3; // April
      }

      let endMonth = 2; // March of next year
      let endYear = fyStart.getFullYear() + 1;

      if (asset.isDisposed && asset.disposedAt) {
        const disposedDate = new Date(asset.disposedAt);
        if (disposedDate >= fyStart && disposedDate <= fyEnd) {
          endMonth = disposedDate.getMonth();
          endYear = disposedDate.getFullYear();
        }
      }

      let monthsUsed: number;
      const startDate = new Date(startMonth >= 3 ? fyStart.getFullYear() : fyStart.getFullYear() + 1, startMonth, 1);
      const endDate = new Date(endMonth >= 3 ? fyStart.getFullYear() : fyStart.getFullYear() + 1, endMonth + 1, 0);
      
      if (startMonth >= 3) {
        // April onwards in first calendar year
        if (endMonth >= 3) {
          monthsUsed = endMonth - startMonth + 1;
        } else {
          monthsUsed = (12 - startMonth) + (endMonth + 1);
        }
      } else {
        // Jan-March in second calendar year
        monthsUsed = endMonth - startMonth + 1;
      }

      monthsUsed = Math.max(1, Math.min(12, monthsUsed));

      // Check for an existing log BEFORE computing opening value so re-runs
      // are anchored to the original opening value stored in the log, not the
      // already-reduced currentBookValue.
      const existing = await db.select().from(assetDepreciationLog)
        .where(and(
          eq(assetDepreciationLog.assetId, asset.id),
          eq(assetDepreciationLog.financialYear, financialYear),
        ));

      // For a re-run use the opening value from the existing log so the result
      // is identical every time (idempotent). For the first run, use the live
      // book value as usual.
      const openingValue = existing.length > 0
        ? existing[0].openingValue
        : asset.currentBookValue;

      const depreciationAmount = roundAmount(openingValue * (asset.depreciationRate / 100) * (monthsUsed / 12));
      const closingValue = roundAmount(openingValue - depreciationAmount);

      let logEntry: AssetDepreciationLog;
      if (existing.length > 0) {
        const oldDepAmount = existing[0].depreciationAmount;
        const [updated] = await db.update(assetDepreciationLog)
          .set({
            openingValue,
            depreciationAmount,
            closingValue,
            monthsUsed,
            calculatedAt: new Date(),
          })
          .where(eq(assetDepreciationLog.id, existing[0].id))
          .returning();
        logEntry = updated;

        // Adjust currentBookValue relatively: undo the old depreciation that
        // was already applied, then apply the newly calculated amount.
        const adjustedBookValue = roundAmount(asset.currentBookValue + oldDepAmount - depreciationAmount);
        await db.update(assets)
          .set({ currentBookValue: adjustedBookValue })
          .where(eq(assets.id, asset.id));
      } else {
        const [inserted] = await db.insert(assetDepreciationLog).values({
          id: randomUUID(),
          assetId: asset.id,
          coldStorageId,
          financialYear,
          openingValue,
          depreciationAmount,
          closingValue,
          monthsUsed,
        }).returning();
        logEntry = inserted;

        await db.update(assets)
          .set({ currentBookValue: closingValue })
          .where(eq(assets.id, asset.id));
      }

      results.push(logEntry);
    }

    return results;
  }

  // ==================== Liabilities ====================

  async getLiabilities(coldStorageId: string): Promise<Liability[]> {
    return await db.select().from(liabilities)
      .where(eq(liabilities.coldStorageId, coldStorageId))
      .orderBy(desc(liabilities.createdAt));
  }

  async createLiability(data: InsertLiability): Promise<Liability> {
    const id = randomUUID();
    const [liability] = await db.insert(liabilities).values({
      ...data,
      id,
      isSettled: 0,
    }).returning();
    return liability;
  }

  async updateLiability(id: string, updates: Partial<Liability>): Promise<Liability | undefined> {
    const [updated] = await db.update(liabilities)
      .set(updates)
      .where(eq(liabilities.id, id))
      .returning();
    return updated;
  }

  async settleLiability(id: string): Promise<Liability | undefined> {
    const [updated] = await db.update(liabilities)
      .set({
        isSettled: 1,
        settledAt: new Date(),
        outstandingAmount: 0,
      })
      .where(eq(liabilities.id, id))
      .returning();
    return updated;
  }

  async getLiabilityPayments(liabilityId: string): Promise<LiabilityPayment[]> {
    return await db.select().from(liabilityPayments)
      .where(eq(liabilityPayments.liabilityId, liabilityId))
      .orderBy(desc(liabilityPayments.paidAt));
  }

  async createLiabilityPayment(data: InsertLiabilityPayment): Promise<LiabilityPayment> {
    const id = randomUUID();
    const [payment] = await db.insert(liabilityPayments).values({
      ...data,
      id,
      isReversed: 0,
    }).returning();

    await db.update(liabilities)
      .set({
        outstandingAmount: sql`${liabilities.outstandingAmount} - ${data.principalComponent}`,
      })
      .where(eq(liabilities.id, data.liabilityId));

    return payment;
  }

  async reverseLiabilityPayment(id: string): Promise<LiabilityPayment | undefined> {
    const [payment] = await db.select().from(liabilityPayments)
      .where(eq(liabilityPayments.id, id));
    if (!payment || payment.isReversed) return undefined;

    const [updated] = await db.update(liabilityPayments)
      .set({ isReversed: 1 })
      .where(eq(liabilityPayments.id, id))
      .returning();

    await db.update(liabilities)
      .set({
        outstandingAmount: sql`${liabilities.outstandingAmount} + ${payment.principalComponent}`,
        isSettled: 0,
        settledAt: null,
      })
      .where(eq(liabilities.id, payment.liabilityId));

    return updated;
  }
}

export const storage = new DatabaseStorage();
