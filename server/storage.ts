import { randomUUID } from "crypto";
import { eq, and, like, ilike, desc, sql, gte, lte } from "drizzle-orm";
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
  type DashboardStats,
  type QualityStats,
  type PaymentStats,
  type MerchantStats,
} from "@shared/schema";

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
  createBatchLots(lots: InsertLot[], coldStorageId: string): Promise<{ lots: Lot[]; entrySequence: number }>;
  getNextEntrySequence(coldStorageId: string): Promise<number>;
  getLot(id: string): Promise<Lot | undefined>;
  updateLot(id: string, updates: Partial<Lot>): Promise<Lot | undefined>;
  searchLots(type: "phone", query: string, coldStorageId: string): Promise<Lot[]>;
  searchLotsByLotNoAndSize(lotNo: string, size: string, coldStorageId: string): Promise<Lot[]>;
  searchLotsByFarmerName(query: string, coldStorageId: string): Promise<Lot[]>;
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
  finalizeSale(lotId: string, paymentStatus: "due" | "paid" | "partial", buyerName?: string, pricePerKg?: number, paidAmount?: number, dueAmount?: number, paymentMode?: "cash" | "account"): Promise<Lot | undefined>;
  updateColdStorage(id: string, updates: Partial<ColdStorage>): Promise<ColdStorage | undefined>;
  createChamber(data: { name: string; capacity: number; coldStorageId: string }): Promise<Chamber>;
  updateChamber(id: string, updates: Partial<Chamber>): Promise<Chamber | undefined>;
  deleteChamber(id: string): Promise<boolean>;
  // Sales History
  createSalesHistory(data: InsertSalesHistory): Promise<SalesHistory>;
  getSalesHistory(coldStorageId: string, filters?: {
    year?: number;
    farmerName?: string;
    contactNumber?: string;
    paymentStatus?: "paid" | "due";
    buyerName?: string;
  }): Promise<SalesHistory[]>;
  markSaleAsPaid(saleId: string): Promise<SalesHistory | undefined>;
  getSalesYears(coldStorageId: string): Promise<number[]>;
  reverseSale(saleId: string): Promise<{ success: boolean; lot?: Lot; message?: string; errorType?: string }>;
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
  reverseLatestExit(salesHistoryId: string): Promise<{ success: boolean; message?: string }>;
  // Cash Receipts
  getBuyersWithDues(coldStorageId: string): Promise<{ buyerName: string; totalDue: number }[]>;
  getCashReceipts(coldStorageId: string): Promise<CashReceipt[]>;
  createCashReceiptWithFIFO(data: InsertCashReceipt): Promise<{ receipt: CashReceipt; salesUpdated: number }>;
  // Expenses
  getExpenses(coldStorageId: string): Promise<Expense[]>;
  createExpense(data: InsertExpense): Promise<Expense>;
  // Reversal
  reverseCashReceipt(receiptId: string): Promise<{ success: boolean; message?: string }>;
  reverseExpense(expenseId: string): Promise<{ success: boolean; message?: string }>;
  // Admin
  recalculateSalesCharges(coldStorageId: string): Promise<{ updated: number; message: string }>;
  // Bill number assignment
  assignBillNumber(saleId: string, billType: "coldStorage" | "sales"): Promise<number>;
  assignLotBillNumber(lotId: string): Promise<number>;
  // Admin - Cold Storage Management
  getAllColdStorages(): Promise<ColdStorage[]>;
  createColdStorage(data: InsertColdStorage): Promise<ColdStorage>;
  deleteColdStorage(id: string): Promise<boolean>;
  // Cold Storage Users
  getColdStorageUsers(coldStorageId: string): Promise<ColdStorageUser[]>;
  createColdStorageUser(data: InsertColdStorageUser): Promise<ColdStorageUser>;
  updateColdStorageUser(id: string, updates: Partial<ColdStorageUser>): Promise<ColdStorageUser | undefined>;
  deleteColdStorageUser(id: string): Promise<boolean>;
  resetUserPassword(userId: string, newPassword: string): Promise<boolean>;
  // Authentication
  authenticateUser(mobileNumber: string, password: string): Promise<{ user: ColdStorageUser; coldStorage: ColdStorage } | null>;
  getUserById(userId: string): Promise<ColdStorageUser | undefined>;
  // Session Management
  createSession(token: string, userId: string, coldStorageId: string): Promise<UserSession>;
  getSession(token: string): Promise<UserSession | undefined>;
  deleteSession(token: string): Promise<void>;
  updateSessionLastAccess(token: string): Promise<void>;
  // Export
  getLotsForExport(coldStorageId: string, fromDate: Date, toDate: Date): Promise<Lot[]>;
  getSalesForExport(coldStorageId: string, fromDate: Date, toDate: Date): Promise<SalesHistory[]>;
  getCashDataForExport(coldStorageId: string, fromDate: Date, toDate: Date): Promise<{ receipts: CashReceipt[]; expenses: Expense[] }>;
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
    const id = randomUUID();
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

  async createBatchLots(insertLots: InsertLot[], coldStorageId: string): Promise<{ lots: Lot[]; entrySequence: number }> {
    // Get the current entry sequence (before incrementing)
    const coldStorage = await this.getColdStorage(coldStorageId);
    const entrySequence = coldStorage?.nextEntryBillNumber ?? 1;
    
    // Increment the counter for the next batch (done atomically)
    await db
      .update(coldStorages)
      .set({ nextEntryBillNumber: sql`COALESCE(${coldStorages.nextEntryBillNumber}, 0) + 1` })
      .where(eq(coldStorages.id, coldStorageId));
    
    const createdLots: Lot[] = [];
    
    for (const insertLot of insertLots) {
      const id = randomUUID();
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

  async searchLotsByFarmerName(query: string, coldStorageId: string): Promise<Lot[]> {
    const allLots = await db.select().from(lots).where(eq(lots.coldStorageId, coldStorageId));
    const lowerQuery = query.toLowerCase();
    return allLots.filter((lot) => lot.farmerName.toLowerCase().includes(lowerQuery));
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
        // Wafer and Ration use wafer rates, Seed uses seed rates
        const useWaferRates = lot.bagType === "wafer" || lot.bagType === "Ration";
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
    
    // Group sales by lotId to count unique lots, not individual partial sales
    const lotPaymentMap = new Map<string, { paidAmount: number; dueAmount: number }>();
    
    for (const sale of allSales) {
      // Calculate total charges including all surcharges
      const totalCharges = (sale.coldStorageCharge || 0) + 
                          (sale.kataCharges || 0) + 
                          (sale.extraHammali || 0) + 
                          (sale.gradingCharges || 0);
      
      // Sum up hammali (hammali per bag × bags sold + extra hammali) and grading charges
      totalHammali += ((sale.hammali || 0) * (sale.quantitySold || 0)) + (sale.extraHammali || 0);
      totalGradingCharges += (sale.gradingCharges || 0);
      
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

    return {
      totalPaid,
      totalDue,
      paidCount,
      dueCount,
      totalHammali,
      totalGradingCharges,
    };
  }

  async getMerchantStats(coldStorageId: string, year?: number): Promise<MerchantStats> {
    const allSales = await this.getSalesHistory(coldStorageId, year ? { year } : undefined);
    
    // Group sales by buyer name
    const merchantMap = new Map<string, {
      bagsPurchased: number;
      totalValue: number;
      totalChargePaid: number;
      totalChargeDue: number;
      cashPaid: number;
      accountPaid: number;
    }>();
    
    for (const sale of allSales) {
      const buyerName = sale.buyerName?.trim() || "Unknown";
      
      const existing = merchantMap.get(buyerName) || {
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
      
      // Total charges = cold storage rent + hammali + kata + extra hammali + grading
      const totalCharges = (sale.coldStorageCharge || 0) + 
                          (sale.kataCharges || 0) + 
                          (sale.extraHammali || 0) + 
                          (sale.gradingCharges || 0);
      
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
      
      merchantMap.set(buyerName, existing);
    }
    
    // Extract unique buyer names
    const buyers = Array.from(merchantMap.keys()).sort();
    
    // Build merchant data array
    const merchantData = buyers.map(buyerName => ({
      buyerName,
      ...merchantMap.get(buyerName)!,
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
    
    // Reset all bill number counters to 1
    await db.update(coldStorages)
      .set({ 
        nextExitBillNumber: 1,
        nextColdStorageBillNumber: 1,
        nextSalesBillNumber: 1,
        nextEntryBillNumber: 1,
      })
      .where(eq(coldStorages.id, coldStorageId));
  }

  async finalizeSale(lotId: string, paymentStatus: "due" | "paid" | "partial", buyerName?: string, pricePerKg?: number, paidAmount?: number, dueAmount?: number, paymentMode?: "cash" | "account", kataCharges?: number, extraHammali?: number, gradingCharges?: number, netWeight?: number): Promise<Lot | undefined> {
    const lot = await this.getLot(lotId);
    if (!lot || lot.saleStatus === "sold") return undefined;

    const coldStorage = await this.getColdStorage(lot.coldStorageId);
    if (!coldStorage) return undefined;

    // Wafer and Ration bags use wafer rates, Seed bags use seed rates
    const useWaferRates = lot.bagType === "wafer" || lot.bagType === "Ration";
    const rate = useWaferRates ? coldStorage.waferRate : coldStorage.seedRate;
    const hammaliRate = useWaferRates ? (coldStorage.waferHammali || 0) : (coldStorage.seedHammali || 0);
    const coldChargeRate = rate - hammaliRate; // Cold storage charge is rate minus hammali
    const saleCharge = rate * lot.remainingSize;
    
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
      quality: lot.quality,
      originalLotSize: lot.size,
      saleType: "full",
      quantitySold: bagsToRemove,
      pricePerBag: rate,
      coldCharge: coldChargeRate,
      hammali: hammaliRate,
      coldStorageCharge: saleCharge,
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
    });

    return updatedLot;
  }

  // Sales History Methods
  async createSalesHistory(data: InsertSalesHistory): Promise<SalesHistory> {
    const id = randomUUID();
    const [sale] = await db.insert(salesHistory).values({
      ...data,
      id,
    }).returning();
    return sale;
  }

  async getSalesHistory(coldStorageId: string, filters?: {
    year?: number;
    farmerName?: string;
    contactNumber?: string;
    paymentStatus?: "paid" | "due";
    buyerName?: string;
  }): Promise<SalesHistory[]> {
    let conditions = [eq(salesHistory.coldStorageId, coldStorageId)];
    
    if (filters?.year) {
      conditions.push(eq(salesHistory.saleYear, filters.year));
    }
    if (filters?.farmerName) {
      conditions.push(ilike(salesHistory.farmerName, `%${filters.farmerName}%`));
    }
    if (filters?.contactNumber) {
      conditions.push(like(salesHistory.contactNumber, `%${filters.contactNumber}%`));
    }
    if (filters?.paymentStatus) {
      conditions.push(eq(salesHistory.paymentStatus, filters.paymentStatus));
    }
    if (filters?.buyerName) {
      conditions.push(ilike(salesHistory.buyerName, `%${filters.buyerName}%`));
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

  async updateSalesHistory(saleId: string, updates: {
    buyerName?: string;
    pricePerKg?: number;
    paymentStatus?: "paid" | "due" | "partial";
    paidAmount?: number;
    dueAmount?: number;
    paymentMode?: "cash" | "account";
    netWeight?: number | null;
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

    const [updated] = await db.update(salesHistory)
      .set(updateData)
      .where(eq(salesHistory.id, saleId))
      .returning();
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

  async reverseSale(saleId: string): Promise<{ success: boolean; lot?: Lot; message?: string; errorType?: string }> {
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

    const [updatedLot] = await db.update(lots).set({
      remainingSize: newRemainingSize,
      saleStatus: newSaleStatus,
      upForSale: 0,
      soldAt: newSaleStatus === "stored" ? null : lot.soldAt,
      totalPaidCharge: newTotalPaid,
      totalDueCharge: newTotalDue,
      paymentStatus: newPaymentStatus,
    }).where(eq(lots.id, sale.lotId)).returning();

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

    return { success: true, lot: updatedLot };
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
    const sales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, coldStorageId),
        sql`${salesHistory.paymentStatus} IN ('due', 'partial')`,
        sql`${salesHistory.buyerName} IS NOT NULL AND ${salesHistory.buyerName} != ''`
      ));

    // Group by buyer name and sum the due amounts
    const buyerDues = new Map<string, number>();
    for (const sale of sales) {
      const buyerName = sale.buyerName || "";
      if (!buyerName) continue;
      
      // Calculate total charges including all surcharges
      // Always recalculate from totalCharges - paidAmount to ensure accuracy
      const totalCharges = (sale.coldStorageCharge || 0) + 
                          (sale.kataCharges || 0) + 
                          (sale.extraHammali || 0) + 
                          (sale.gradingCharges || 0);
      const dueAmount = totalCharges - (sale.paidAmount || 0);
      if (dueAmount > 0) {
        const currentDue = buyerDues.get(buyerName) || 0;
        buyerDues.set(buyerName, currentDue + dueAmount);
      }
    }

    return Array.from(buyerDues.entries())
      .map(([buyerName, totalDue]) => ({ buyerName, totalDue }))
      .sort((a, b) => a.buyerName.localeCompare(b.buyerName));
  }

  async getCashReceipts(coldStorageId: string): Promise<CashReceipt[]> {
    return db.select()
      .from(cashReceipts)
      .where(eq(cashReceipts.coldStorageId, coldStorageId))
      .orderBy(desc(cashReceipts.receivedAt));
  }

  async createCashReceiptWithFIFO(data: InsertCashReceipt): Promise<{ receipt: CashReceipt; salesUpdated: number }> {
    // Get all sales for this buyer with due or partial status, ordered by sale date (FIFO)
    // Use case-insensitive matching for buyer name
    const sales = await db.select()
      .from(salesHistory)
      .where(and(
        eq(salesHistory.coldStorageId, data.coldStorageId),
        sql`LOWER(TRIM(${salesHistory.buyerName})) = LOWER(TRIM(${data.buyerName}))`,
        sql`${salesHistory.paymentStatus} IN ('due', 'partial')`
      ))
      .orderBy(salesHistory.soldAt); // FIFO - oldest first

    let remainingAmount = data.amount;
    let appliedAmount = 0;
    let salesUpdated = 0;
    const paymentMode = data.receiptType as "cash" | "account";

    // Apply payment to each sale in FIFO order
    for (const sale of sales) {
      if (remainingAmount <= 0) break;

      // Calculate total charges including all surcharges
      // Always recalculate from totalCharges - paidAmount to ensure accuracy
      const totalCharges = (sale.coldStorageCharge || 0) + 
                          (sale.kataCharges || 0) + 
                          (sale.extraHammali || 0) + 
                          (sale.gradingCharges || 0);
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

    // Create the receipt record
    const [receipt] = await db.insert(cashReceipts)
      .values({
        id: randomUUID(),
        ...data,
        appliedAmount: appliedAmount,
        unappliedAmount: remainingAmount,
      })
      .returning();

    return { receipt, salesUpdated };
  }

  async getExpenses(coldStorageId: string): Promise<Expense[]> {
    return db.select().from(expenses)
      .where(eq(expenses.coldStorageId, coldStorageId))
      .orderBy(desc(expenses.paidAt));
  }

  async createExpense(data: InsertExpense): Promise<Expense> {
    const [expense] = await db.insert(expenses)
      .values({
        id: randomUUID(),
        ...data,
      })
      .returning();
    return expense;
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

    // Reset all sales for this buyer to baseline (due status)
    // Use case-insensitive matching for buyer name
    await db.update(salesHistory)
      .set({
        paymentStatus: "due",
        paidAmount: 0,
        dueAmount: sql`${salesHistory.coldStorageCharge}`,
        paymentMode: null,
        paidAt: null,
      })
      .where(and(
        eq(salesHistory.coldStorageId, receipt.coldStorageId),
        sql`LOWER(TRIM(${salesHistory.buyerName})) = LOWER(TRIM(${receipt.buyerName}))`,
        sql`${salesHistory.paymentStatus} IN ('paid', 'partial')`
      ));

    // Replay all non-reversed receipts for this buyer in order (FIFO)
    // Use case-insensitive matching for buyer name
    const activeReceipts = await db.select()
      .from(cashReceipts)
      .where(and(
        eq(cashReceipts.coldStorageId, receipt.coldStorageId),
        sql`LOWER(TRIM(${cashReceipts.buyerName})) = LOWER(TRIM(${receipt.buyerName}))`,
        eq(cashReceipts.isReversed, 0)
      ))
      .orderBy(cashReceipts.receivedAt);

    // For each active receipt, replay the FIFO allocation
    for (const activeReceipt of activeReceipts) {
      // Get all sales for this buyer ordered by sale date (FIFO)
      // Use case-insensitive matching for buyer name
      const sales = await db.select()
        .from(salesHistory)
        .where(and(
          eq(salesHistory.coldStorageId, activeReceipt.coldStorageId),
          sql`LOWER(TRIM(${salesHistory.buyerName})) = LOWER(TRIM(${activeReceipt.buyerName}))`,
          sql`${salesHistory.paymentStatus} IN ('due', 'partial')`
        ))
        .orderBy(salesHistory.soldAt);

      let remainingAmount = activeReceipt.amount;
      let appliedAmount = 0;
      const paymentMode = activeReceipt.receiptType as "cash" | "account";

      // Apply payment to each sale in FIFO order
      for (const sale of sales) {
        if (remainingAmount <= 0) break;

        // Calculate total charges including all surcharges
        // Always recalculate from totalCharges - paidAmount to ensure accuracy
        const totalCharges = (sale.coldStorageCharge || 0) + 
                            (sale.kataCharges || 0) + 
                            (sale.extraHammali || 0) + 
                            (sale.gradingCharges || 0);
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
              paidAt: activeReceipt.receivedAt,
            })
            .where(eq(salesHistory.id, sale.id));
          
          remainingAmount -= saleDueAmount;
          appliedAmount += saleDueAmount;
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
        }
      }

      // Update the receipt's applied/unapplied amounts
      await db.update(cashReceipts)
        .set({
          appliedAmount: appliedAmount,
          unappliedAmount: remainingAmount,
        })
        .where(eq(cashReceipts.id, activeReceipt.id));
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

  async recalculateSalesCharges(coldStorageId: string): Promise<{ updated: number; message: string }> {
    // Get all sales for the cold storage
    const allSales = await this.getSalesHistory(coldStorageId);
    
    let updated = 0;
    
    for (const sale of allSales) {
      // Calculate total charges (coldStorageCharge + surcharges)
      const totalCharges = (sale.coldStorageCharge || 0) + 
                          (sale.kataCharges || 0) + 
                          (sale.extraHammali || 0) + 
                          (sale.gradingCharges || 0);
      
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
        const charges = (sale.coldStorageCharge || 0) + 
                       (sale.kataCharges || 0) + 
                       (sale.extraHammali || 0) + 
                       (sale.gradingCharges || 0);
        
        if (sale.paymentStatus === "paid") {
          totalPaidCharge += charges;
        } else if (sale.paymentStatus === "due") {
          totalDueCharge += charges;
        } else if (sale.paymentStatus === "partial") {
          totalPaidCharge += sale.paidAmount || 0;
          totalDueCharge += (sale.dueAmount || 0);
        }
      }
      
      // Update lot if needed
      if (lot.totalPaidCharge !== totalPaidCharge || lot.totalDueCharge !== totalDueCharge) {
        await db.update(lots)
          .set({
            totalPaidCharge,
            totalDueCharge,
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
    const id = `cs-${randomUUID()}`;
    const [newStorage] = await db.insert(coldStorages)
      .values({ ...data, id })
      .returning();
    return newStorage;
  }

  async deleteColdStorage(id: string): Promise<boolean> {
    // First delete all users for this cold storage
    await db.delete(coldStorageUsers).where(eq(coldStorageUsers.coldStorageId, id));
    // Then delete chambers and their floors
    const chambersToDelete = await db.select().from(chambers).where(eq(chambers.coldStorageId, id));
    for (const chamber of chambersToDelete) {
      await db.delete(chamberFloors).where(eq(chamberFloors.chamberId, chamber.id));
    }
    await db.delete(chambers).where(eq(chambers.coldStorageId, id));
    // Delete the cold storage
    const result = await db.delete(coldStorages).where(eq(coldStorages.id, id));
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
  async authenticateUser(mobileNumber: string, password: string): Promise<{ user: ColdStorageUser; coldStorage: ColdStorage } | null> {
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

  async getSalesForExport(coldStorageId: string, fromDate: Date, toDate: Date): Promise<SalesHistory[]> {
    return db.select()
      .from(salesHistory)
      .where(
        and(
          eq(salesHistory.coldStorageId, coldStorageId),
          gte(salesHistory.soldAt, fromDate),
          lte(salesHistory.soldAt, toDate)
        )
      )
      .orderBy(desc(salesHistory.soldAt));
  }

  async getCashDataForExport(coldStorageId: string, fromDate: Date, toDate: Date): Promise<{ receipts: CashReceipt[]; expenses: Expense[] }> {
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

    return { receipts: receiptsData, expenses: expensesData };
  }
}

export const storage = new DatabaseStorage();
