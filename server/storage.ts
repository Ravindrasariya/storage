import { randomUUID } from "crypto";
import type {
  ColdStorage,
  InsertColdStorage,
  Chamber,
  InsertChamber,
  Lot,
  InsertLot,
  LotEditHistory,
  InsertLotEditHistory,
  DashboardStats,
  QualityStats,
  PaymentStats,
} from "@shared/schema";

export interface IStorage {
  // Cold Storage
  getColdStorage(id: string): Promise<ColdStorage | undefined>;
  getDefaultColdStorage(): Promise<ColdStorage>;
  
  // Chambers
  getChambers(coldStorageId: string): Promise<Chamber[]>;
  getChamber(id: string): Promise<Chamber | undefined>;
  updateChamberFill(id: string, fill: number): Promise<void>;
  
  // Lots
  createLot(lot: InsertLot): Promise<Lot>;
  getLot(id: string): Promise<Lot | undefined>;
  updateLot(id: string, updates: Partial<Lot>): Promise<Lot | undefined>;
  searchLots(type: "phone", query: string, coldStorageId: string): Promise<Lot[]>;
  searchLotsByLotNoAndSize(lotNo: string, size: string, coldStorageId: string): Promise<Lot[]>;
  getAllLots(coldStorageId: string): Promise<Lot[]>;
  
  // Lot Edit History
  createEditHistory(history: InsertLotEditHistory): Promise<LotEditHistory>;
  getLotHistory(lotId: string): Promise<LotEditHistory[]>;
  
  // Dashboard Stats
  getDashboardStats(coldStorageId: string): Promise<DashboardStats>;
  
  // Quality Stats
  getQualityStats(coldStorageId: string): Promise<QualityStats>;
  
  // Payment Stats
  getPaymentStats(coldStorageId: string): Promise<PaymentStats>;
  
  // Sale Operations
  finalizeSale(lotId: string, paymentStatus: "due" | "paid"): Promise<Lot | undefined>;
  
  // Cold Storage Management
  updateColdStorage(id: string, updates: Partial<ColdStorage>): Promise<ColdStorage | undefined>;
  
  // Chamber Management
  createChamber(data: { name: string; capacity: number; coldStorageId: string }): Promise<Chamber>;
  updateChamber(id: string, updates: Partial<Chamber>): Promise<Chamber | undefined>;
  deleteChamber(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private coldStorages: Map<string, ColdStorage>;
  private chambers: Map<string, Chamber>;
  private lots: Map<string, Lot>;
  private editHistory: Map<string, LotEditHistory>;

  constructor() {
    this.coldStorages = new Map();
    this.chambers = new Map();
    this.lots = new Map();
    this.editHistory = new Map();
    
    this.initializeDefaultData();
  }

  private initializeDefaultData() {
    const defaultColdStorageId = "cs-default";
    
    const defaultColdStorage: ColdStorage = {
      id: defaultColdStorageId,
      name: "Main Cold Storage",
      totalCapacity: 50000,
      waferRate: 25,
      seedRate: 30,
      linkedPhones: ["8882589392"],
    };
    this.coldStorages.set(defaultColdStorageId, defaultColdStorage);

    const chamberData = [
      { id: "ch-1", name: "Chamber A", capacity: 10000, currentFill: 0 },
      { id: "ch-2", name: "Chamber B", capacity: 12000, currentFill: 0 },
      { id: "ch-3", name: "Chamber C", capacity: 8000, currentFill: 0 },
      { id: "ch-4", name: "Chamber D", capacity: 10000, currentFill: 0 },
      { id: "ch-5", name: "Chamber E", capacity: 10000, currentFill: 0 },
    ];

    chamberData.forEach((ch) => {
      const chamber: Chamber = {
        ...ch,
        coldStorageId: defaultColdStorageId,
      };
      this.chambers.set(ch.id, chamber);
    });
  }

  async getColdStorage(id: string): Promise<ColdStorage | undefined> {
    return this.coldStorages.get(id);
  }

  async getDefaultColdStorage(): Promise<ColdStorage> {
    return this.coldStorages.get("cs-default")!;
  }

  async getChambers(coldStorageId: string): Promise<Chamber[]> {
    return Array.from(this.chambers.values()).filter(
      (ch) => ch.coldStorageId === coldStorageId
    );
  }

  async getChamber(id: string): Promise<Chamber | undefined> {
    return this.chambers.get(id);
  }

  async updateChamberFill(id: string, fill: number): Promise<void> {
    const chamber = this.chambers.get(id);
    if (chamber) {
      chamber.currentFill = fill;
      this.chambers.set(id, chamber);
    }
  }

  async createLot(insertLot: InsertLot): Promise<Lot> {
    const id = randomUUID();
    const lot: Lot = {
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
      soldAt: insertLot.soldAt ?? null,
      createdAt: new Date(),
    };
    this.lots.set(id, lot);

    const chamber = await this.getChamber(lot.chamberId);
    if (chamber) {
      await this.updateChamberFill(chamber.id, chamber.currentFill + lot.size);
    }

    return lot;
  }

  async getLot(id: string): Promise<Lot | undefined> {
    return this.lots.get(id);
  }

  async updateLot(id: string, updates: Partial<Lot>): Promise<Lot | undefined> {
    const lot = this.lots.get(id);
    if (!lot) return undefined;

    const updatedLot = { ...lot, ...updates };
    this.lots.set(id, updatedLot);
    return updatedLot;
  }

  async searchLots(
    type: "phone",
    query: string,
    coldStorageId: string
  ): Promise<Lot[]> {
    const allLots = Array.from(this.lots.values()).filter(
      (lot) => lot.coldStorageId === coldStorageId
    );

    return allLots.filter((lot) => lot.contactNumber.includes(query));
  }

  async searchLotsByLotNoAndSize(
    lotNo: string,
    size: string,
    coldStorageId: string
  ): Promise<Lot[]> {
    const allLots = Array.from(this.lots.values()).filter(
      (lot) => lot.coldStorageId === coldStorageId
    );

    return allLots.filter((lot) => {
      const matchesLotNo = !lotNo || lot.lotNo.toLowerCase().includes(lotNo.toLowerCase());
      const sizeNum = parseInt(size, 10);
      const matchesSize = !size || isNaN(sizeNum) || lot.size === sizeNum;
      return matchesLotNo && matchesSize;
    });
  }

  async getAllLots(coldStorageId: string): Promise<Lot[]> {
    return Array.from(this.lots.values()).filter(
      (lot) => lot.coldStorageId === coldStorageId
    );
  }

  async createEditHistory(insertHistory: InsertLotEditHistory): Promise<LotEditHistory> {
    const id = randomUUID();
    const history: LotEditHistory = {
      ...insertHistory,
      id,
      soldQuantity: insertHistory.soldQuantity ?? null,
      pricePerBag: insertHistory.pricePerBag ?? null,
      totalPrice: insertHistory.totalPrice ?? null,
      changedAt: new Date(),
    };
    this.editHistory.set(id, history);
    return history;
  }

  async getLotHistory(lotId: string): Promise<LotEditHistory[]> {
    return Array.from(this.editHistory.values())
      .filter((h) => h.lotId === lotId)
      .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
  }

  async getDashboardStats(coldStorageId: string): Promise<DashboardStats> {
    const coldStorage = await this.getColdStorage(coldStorageId);
    const chambers = await this.getChambers(coldStorageId);
    const lots = await this.getAllLots(coldStorageId);

    const currentUtilization = lots.reduce((sum, lot) => sum + lot.remainingSize, 0);
    const peakUtilization = lots.reduce((sum, lot) => sum + lot.size, 0);
    const uniqueFarmers = new Set(lots.map((lot) => lot.contactNumber));
    
    const totalWaferBags = lots
      .filter((lot) => lot.bagType === "wafer")
      .reduce((sum, lot) => sum + lot.size, 0);
    const remainingWaferBags = lots
      .filter((lot) => lot.bagType === "wafer")
      .reduce((sum, lot) => sum + lot.remainingSize, 0);
    const totalSeedBags = lots
      .filter((lot) => lot.bagType === "seed")
      .reduce((sum, lot) => sum + lot.size, 0);
    const remainingSeedBags = lots
      .filter((lot) => lot.bagType === "seed")
      .reduce((sum, lot) => sum + lot.remainingSize, 0);
    
    const remainingLots = lots.filter((lot) => lot.remainingSize > 0).length;

    const chamberStats = chambers.map((chamber) => {
      const chamberLots = lots.filter((lot) => lot.chamberId === chamber.id);
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

    const chamberMap = new Map(chambers.map(c => [c.id, c.name]));
    const saleLots = lots
      .filter((lot) => lot.upForSale === 1 && lot.remainingSize > 0 && lot.saleStatus !== "sold")
      .map((lot) => ({
        id: lot.id,
        lotNo: lot.lotNo,
        farmerName: lot.farmerName,
        contactNumber: lot.contactNumber,
        village: lot.village,
        chamberName: chamberMap.get(lot.chamberId) || "Unknown",
        remainingSize: lot.remainingSize,
        bagType: lot.bagType,
        type: lot.type,
        rate: lot.bagType === "wafer" ? (coldStorage?.waferRate || 0) : (coldStorage?.seedRate || 0),
      }));

    return {
      totalCapacity: coldStorage?.totalCapacity || 0,
      usedCapacity: currentUtilization,
      peakUtilization,
      currentUtilization,
      totalFarmers: uniqueFarmers.size,
      totalLots: lots.length,
      remainingLots,
      totalWaferBags,
      remainingWaferBags,
      totalSeedBags,
      remainingSeedBags,
      waferRate: coldStorage?.waferRate || 0,
      seedRate: coldStorage?.seedRate || 0,
      chamberStats,
      saleLots,
    };
  }

  async updateColdStorage(id: string, updates: Partial<ColdStorage>): Promise<ColdStorage | undefined> {
    const coldStorage = this.coldStorages.get(id);
    if (!coldStorage) return undefined;
    const updated = { ...coldStorage, ...updates };
    this.coldStorages.set(id, updated);
    return updated;
  }

  async createChamber(data: { name: string; capacity: number; coldStorageId: string }): Promise<Chamber> {
    const id = `ch-${randomUUID().slice(0, 8)}`;
    const chamber: Chamber = {
      id,
      name: data.name,
      capacity: data.capacity,
      currentFill: 0,
      coldStorageId: data.coldStorageId,
    };
    this.chambers.set(id, chamber);
    return chamber;
  }

  async updateChamber(id: string, updates: Partial<Chamber>): Promise<Chamber | undefined> {
    const chamber = this.chambers.get(id);
    if (!chamber) return undefined;
    const updated = { ...chamber, ...updates };
    this.chambers.set(id, updated);
    return updated;
  }

  async deleteChamber(id: string): Promise<boolean> {
    const lots = Array.from(this.lots.values()).filter((lot) => lot.chamberId === id);
    if (lots.length > 0) {
      return false;
    }
    return this.chambers.delete(id);
  }

  async getQualityStats(coldStorageId: string): Promise<QualityStats> {
    const chambers = await this.getChambers(coldStorageId);
    const lots = await this.getAllLots(coldStorageId);

    const chamberQuality = chambers.map((chamber) => {
      const chamberLots = lots.filter((lot) => lot.chamberId === chamber.id);
      return {
        chamberId: chamber.id,
        chamberName: chamber.name,
        poor: chamberLots
          .filter((lot) => lot.quality === "poor")
          .reduce((sum, lot) => sum + lot.size, 0),
        medium: chamberLots
          .filter((lot) => lot.quality === "medium")
          .reduce((sum, lot) => sum + lot.size, 0),
        good: chamberLots
          .filter((lot) => lot.quality === "good")
          .reduce((sum, lot) => sum + lot.size, 0),
      };
    });

    return {
      chamberQuality,
      totalPoor: lots
        .filter((lot) => lot.quality === "poor")
        .reduce((sum, lot) => sum + lot.size, 0),
      totalMedium: lots
        .filter((lot) => lot.quality === "medium")
        .reduce((sum, lot) => sum + lot.size, 0),
      totalGood: lots
        .filter((lot) => lot.quality === "good")
        .reduce((sum, lot) => sum + lot.size, 0),
    };
  }

  async getPaymentStats(coldStorageId: string): Promise<PaymentStats> {
    const lots = await this.getAllLots(coldStorageId);
    const coldStorage = await this.getColdStorage(coldStorageId);
    
    // Include all lots with payment status (both sold and partial sales)
    const lotsWithPayment = lots.filter((lot) => lot.paymentStatus);

    const paidLots = lotsWithPayment.filter((lot) => lot.paymentStatus === "paid");
    const dueLots = lotsWithPayment.filter((lot) => lot.paymentStatus === "due");

    // Calculate charges - use saleCharge if available, otherwise calculate based on rate and bags sold
    const calculateCharge = (lot: Lot) => {
      if (lot.saleCharge) return lot.saleCharge;
      if (!coldStorage) return 0;
      const rate = lot.bagType === "wafer" ? coldStorage.waferRate : coldStorage.seedRate;
      const bagsSold = lot.size - lot.remainingSize;
      return rate * bagsSold;
    };

    return {
      totalPaid: paidLots.reduce((sum, lot) => sum + calculateCharge(lot), 0),
      totalDue: dueLots.reduce((sum, lot) => sum + calculateCharge(lot), 0),
      paidCount: paidLots.length,
      dueCount: dueLots.length,
    };
  }

  async finalizeSale(lotId: string, paymentStatus: "due" | "paid"): Promise<Lot | undefined> {
    const lot = this.lots.get(lotId);
    if (!lot || lot.saleStatus === "sold") return undefined;

    const coldStorage = await this.getColdStorage(lot.coldStorageId);
    if (!coldStorage) return undefined;

    const rate = lot.bagType === "wafer" ? coldStorage.waferRate : coldStorage.seedRate;
    const saleCharge = rate * lot.remainingSize;

    const bagsToRemove = lot.remainingSize;
    const updatedLot: Lot = {
      ...lot,
      saleStatus: "sold",
      paymentStatus,
      saleCharge,
      soldAt: new Date(),
      upForSale: 0,
      remainingSize: 0,
    };

    this.lots.set(lotId, updatedLot);

    const chamber = await this.getChamber(lot.chamberId);
    if (chamber) {
      await this.updateChamberFill(chamber.id, Math.max(0, chamber.currentFill - bagsToRemove));
    }

    return updatedLot;
  }
}

export const storage = new MemStorage();
