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
  searchLots(type: "phone" | "lotNo" | "size", query: string, coldStorageId: string): Promise<Lot[]>;
  getAllLots(coldStorageId: string): Promise<Lot[]>;
  
  // Lot Edit History
  createEditHistory(history: InsertLotEditHistory): Promise<LotEditHistory>;
  getLotHistory(lotId: string): Promise<LotEditHistory[]>;
  
  // Dashboard Stats
  getDashboardStats(coldStorageId: string): Promise<DashboardStats>;
  
  // Quality Stats
  getQualityStats(coldStorageId: string): Promise<QualityStats>;
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
    type: "phone" | "lotNo" | "size",
    query: string,
    coldStorageId: string
  ): Promise<Lot[]> {
    const allLots = Array.from(this.lots.values()).filter(
      (lot) => lot.coldStorageId === coldStorageId
    );

    switch (type) {
      case "phone":
        return allLots.filter((lot) => lot.contactNumber.includes(query));
      case "lotNo":
        return allLots.filter((lot) =>
          lot.lotNo.toLowerCase().includes(query.toLowerCase())
        );
      case "size":
        const sizeQuery = parseFloat(query);
        if (isNaN(sizeQuery)) return [];
        return allLots.filter((lot) => lot.size >= sizeQuery);
      default:
        return [];
    }
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

    const usedCapacity = lots.reduce((sum, lot) => sum + lot.remainingSize, 0);
    const uniqueFarmers = new Set(lots.map((lot) => lot.contactNumber));
    const waferBags = lots
      .filter((lot) => lot.bagType === "wafer")
      .reduce((sum, lot) => sum + lot.remainingSize, 0);
    const seedBags = lots
      .filter((lot) => lot.bagType === "seed")
      .reduce((sum, lot) => sum + lot.remainingSize, 0);

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

    return {
      totalCapacity: coldStorage?.totalCapacity || 0,
      usedCapacity,
      totalFarmers: uniqueFarmers.size,
      totalLots: lots.length,
      totalWaferBags: waferBags,
      totalSeedBags: seedBags,
      waferRate: coldStorage?.waferRate || 0,
      seedRate: coldStorage?.seedRate || 0,
      chamberStats,
    };
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
}

export const storage = new MemStorage();
