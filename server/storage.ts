import { randomUUID } from "crypto";
import { eq, and, like, ilike, desc } from "drizzle-orm";
import { db } from "./db";
import {
  coldStorages,
  chambers,
  chamberFloors,
  lots,
  lotEditHistory,
  salesHistory,
  maintenanceRecords,
  type ColdStorage,
  type InsertColdStorage,
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
  type MaintenanceRecord,
  type InsertMaintenanceRecord,
  type DashboardStats,
  type QualityStats,
  type PaymentStats,
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
  getAllChamberFloors(coldStorageId: string): Promise<Record<string, ChamberFloor[]>>;
  createChamberFloor(data: InsertChamberFloor): Promise<ChamberFloor>;
  updateChamberFloor(id: string, updates: Partial<ChamberFloor>): Promise<ChamberFloor | undefined>;
  deleteChamberFloor(id: string): Promise<boolean>;
  deleteFloorsByChamber(chamberId: string): Promise<void>;
  updateChamberFill(id: string, fill: number): Promise<void>;
  createLot(lot: InsertLot): Promise<Lot>;
  getLot(id: string): Promise<Lot | undefined>;
  updateLot(id: string, updates: Partial<Lot>): Promise<Lot | undefined>;
  searchLots(type: "phone", query: string, coldStorageId: string): Promise<Lot[]>;
  searchLotsByLotNoAndSize(lotNo: string, size: string, coldStorageId: string): Promise<Lot[]>;
  searchLotsByFarmerName(query: string, coldStorageId: string): Promise<Lot[]>;
  getAllLots(coldStorageId: string): Promise<Lot[]>;
  createEditHistory(history: InsertLotEditHistory): Promise<LotEditHistory>;
  getLotHistory(lotId: string): Promise<LotEditHistory[]>;
  deleteEditHistory(historyId: string): Promise<void>;
  getDashboardStats(coldStorageId: string): Promise<DashboardStats>;
  getQualityStats(coldStorageId: string, year?: number): Promise<QualityStats>;
  getPaymentStats(coldStorageId: string, year?: number): Promise<PaymentStats>;
  getAnalyticsYears(coldStorageId: string): Promise<number[]>;
  checkResetEligibility(coldStorageId: string): Promise<{ canReset: boolean; remainingBags: number; remainingLots: number }>;
  resetSeason(coldStorageId: string): Promise<void>;
  finalizeSale(lotId: string, paymentStatus: "due" | "paid" | "partial", buyerName?: string, pricePerKg?: number, paidAmount?: number, dueAmount?: number): Promise<Lot | undefined>;
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
  }): Promise<SalesHistory[]>;
  markSaleAsPaid(saleId: string): Promise<SalesHistory | undefined>;
  getSalesYears(coldStorageId: string): Promise<number[]>;
  // Maintenance Records
  getMaintenanceRecords(coldStorageId: string): Promise<MaintenanceRecord[]>;
  createMaintenanceRecord(data: InsertMaintenanceRecord): Promise<MaintenanceRecord>;
  updateMaintenanceRecord(id: string, updates: Partial<MaintenanceRecord>): Promise<MaintenanceRecord | undefined>;
  deleteMaintenanceRecord(id: string): Promise<boolean>;
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
    const uniqueFarmers = new Set(allLots.map((lot) => lot.contactNumber));
    
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
        const isWafer = lot.bagType === "wafer";
        const coldCharge = isWafer ? (coldStorage?.waferColdCharge || coldStorage?.waferRate || 0) : (coldStorage?.seedColdCharge || coldStorage?.seedRate || 0);
        const hammali = isWafer ? (coldStorage?.waferHammali || 0) : (coldStorage?.seedHammali || 0);
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
          rate: isWafer ? (coldStorage?.waferRate || 0) : (coldStorage?.seedRate || 0),
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
      totalLots: allLots.length,
      remainingLots,
      totalWaferBags,
      remainingWaferBags,
      totalSeedBags,
      remainingSeedBags,
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
    
    // Add sold quantities from salesHistory to original distribution only
    for (const sale of allSales) {
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
    
    // Calculate totals - original (from lots + sales history)
    let totalPoor = 0, totalMedium = 0, totalGood = 0;
    for (const lot of allLots) {
      if (lot.quality === "poor") totalPoor += lot.size;
      else if (lot.quality === "medium") totalMedium += lot.size;
      else if (lot.quality === "good") totalGood += lot.size;
    }
    for (const sale of allSales) {
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
    
    // Group sales by lotId to count unique lots, not individual partial sales
    const lotPaymentMap = new Map<string, { paidAmount: number; dueAmount: number }>();
    
    for (const sale of allSales) {
      // Use actual paidAmount and dueAmount fields from each sale record
      // This correctly handles full payments, full due, and partial payments
      const salePaid = sale.paidAmount || 0;
      const saleDue = sale.dueAmount || 0;
      
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
    
    // Reset all chamber fills to zero
    await db.update(chambers)
      .set({ currentFill: 0 })
      .where(eq(chambers.coldStorageId, coldStorageId));
  }

  async finalizeSale(lotId: string, paymentStatus: "due" | "paid" | "partial", buyerName?: string, pricePerKg?: number, paidAmount?: number, dueAmount?: number): Promise<Lot | undefined> {
    const lot = await this.getLot(lotId);
    if (!lot || lot.saleStatus === "sold") return undefined;

    const coldStorage = await this.getColdStorage(lot.coldStorageId);
    if (!coldStorage) return undefined;

    const rate = lot.bagType === "wafer" ? coldStorage.waferRate : coldStorage.seedRate;
    const hammaliRate = lot.bagType === "wafer" ? (coldStorage.waferHammali || 0) : (coldStorage.seedHammali || 0);
    const coldChargeRate = rate - hammaliRate; // Cold storage charge is rate minus hammali
    const saleCharge = rate * lot.remainingSize;

    // Calculate paid/due amounts based on payment status (normalize to ensure sum equals total)
    let salePaidAmount = 0;
    let saleDueAmount = 0;
    if (paymentStatus === "paid") {
      salePaidAmount = saleCharge;
    } else if (paymentStatus === "due") {
      saleDueAmount = saleCharge;
    } else if (paymentStatus === "partial") {
      const rawPaid = Math.max(0, paidAmount || 0);
      salePaidAmount = Math.min(rawPaid, saleCharge);
      saleDueAmount = saleCharge - salePaidAmount;
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
      buyerName: buyerName || null,
      pricePerKg: pricePerKg || null,
      paymentStatus,
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

    return db.select()
      .from(salesHistory)
      .where(and(...conditions))
      .orderBy(salesHistory.soldAt);
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

  async getSalesYears(coldStorageId: string): Promise<number[]> {
    const results = await db.select({ year: salesHistory.saleYear })
      .from(salesHistory)
      .where(eq(salesHistory.coldStorageId, coldStorageId));
    
    const yearSet = new Set<number>();
    results.forEach(r => yearSet.add(r.year));
    const uniqueYears = Array.from(yearSet).sort((a, b) => b - a);
    return uniqueYears;
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
}

export const storage = new DatabaseStorage();
