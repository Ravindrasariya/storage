import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage, generateSequentialId } from "./storage";
import { lotFormSchema, insertChamberFloorSchema, calculateProportionalEntryDeductions, Lot } from "@shared/schema";
import { z } from "zod";

// CAPTCHA verification helper
async function verifyCaptcha(token: string): Promise<boolean> {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  if (!secretKey) {
    console.log("RECAPTCHA_SECRET_KEY not configured, skipping captcha verification");
    return true; // Skip verification if not configured
  }

  try {
    const response = await fetch(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`,
      { method: "POST" }
    );
    const data = await response.json() as { success: boolean };
    return data.success;
  } catch (error) {
    console.error("CAPTCHA verification error:", error);
    return false;
  }
}

// Extend Express Request to include auth context
interface AuthContext {
  userId: string;
  coldStorageId: string;
  userName: string;
  accessType: string;
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Authentication middleware - extracts user's coldStorageId from session token
  const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = req.headers['x-auth-token'] as string;
      
      if (!token) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const session = await storage.getSession(token);
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      const user = await storage.getUserById(session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      // Attach auth context to request
      req.authContext = {
        userId: user.id,
        coldStorageId: user.coldStorageId,
        userName: user.name,
        accessType: user.accessType,
      };

      next();
    } catch (error) {
      console.error("Auth middleware error:", error);
      res.status(500).json({ error: "Authentication failed" });
    }
  };

  // Helper to get coldStorageId - throws if auth context is missing (must be used after requireAuth)
  const getColdStorageId = (req: AuthenticatedRequest): string => {
    if (!req.authContext?.coldStorageId) {
      throw new Error("Authentication context missing - route must use requireAuth middleware");
    }
    return req.authContext.coldStorageId;
  };

  // Middleware to require edit access - must be used after requireAuth
  const requireEditAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.authContext?.accessType !== "edit") {
      return res.status(403).json({ error: "Edit access required" });
    }
    next();
  };

  // Initialize default data in database
  await storage.initializeDefaultData();

  // Dashboard stats
  app.get("/api/dashboard/stats", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const stats = await storage.getDashboardStats(coldStorageId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Chambers
  app.get("/api/chambers", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const chambers = await storage.getChambers(coldStorageId);
      res.json(chambers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chambers" });
    }
  });

  // Floor-wise capacity for chambers (current fill by floor from lots data)
  app.get("/api/chambers/floor-capacity", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const floorData = await storage.getFloorCapacityByChamber(coldStorageId);
      res.json(floorData);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch floor capacity" });
    }
  });

  // Chamber floors (configured capacity per floor)
  app.get("/api/chamber-floors", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const floors = await storage.getAllChamberFloors(coldStorageId);
      res.json(floors);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chamber floors" });
    }
  });

  app.get("/api/chambers/:chamberId/floors", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify chamber belongs to user's cold storage
      const chamber = await storage.getChamber(req.params.chamberId);
      if (!chamber) {
        return res.status(404).json({ error: "Chamber not found" });
      }
      if (chamber.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const floors = await storage.getChamberFloors(req.params.chamberId);
      res.json(floors);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chamber floors" });
    }
  });

  app.post("/api/chamber-floors", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validated = insertChamberFloorSchema.parse(req.body);
      // Verify chamber belongs to user's cold storage
      const chamber = await storage.getChamber(validated.chamberId);
      if (!chamber) {
        return res.status(404).json({ error: "Chamber not found" });
      }
      if (chamber.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const floor = await storage.createChamberFloor(validated);
      res.status(201).json(floor);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create chamber floor" });
    }
  });

  const updateFloorSchema = z.object({
    floorNumber: z.number().int().positive().optional(),
    capacity: z.number().int().positive().optional(),
  });

  app.patch("/api/chamber-floors/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validated = updateFloorSchema.parse(req.body);
      // Get floor and verify chamber ownership
      const existingFloor = await storage.getChamberFloor(req.params.id);
      if (!existingFloor) {
        return res.status(404).json({ error: "Chamber floor not found" });
      }
      const chamber = await storage.getChamber(existingFloor.chamberId);
      if (!chamber || chamber.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const floor = await storage.updateChamberFloor(req.params.id, validated);
      if (!floor) {
        return res.status(404).json({ error: "Chamber floor not found" });
      }
      res.json(floor);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update chamber floor" });
    }
  });

  app.delete("/api/chamber-floors/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Get floor and verify chamber ownership
      const existingFloor = await storage.getChamberFloor(req.params.id);
      if (!existingFloor) {
        return res.status(404).json({ error: "Chamber floor not found" });
      }
      const chamber = await storage.getChamber(existingFloor.chamberId);
      if (!chamber || chamber.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteChamberFloor(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete chamber floor" });
    }
  });

  // Lots
  app.get("/api/lots", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      let lots = await storage.getAllLots(coldStorageId);
      
      // Sort by lot number if requested
      if (req.query.sort === "lotNo") {
        lots = [...lots].sort((a, b) => {
          const lotNoA = parseInt(a.lotNo, 10) || 0;
          const lotNoB = parseInt(b.lotNo, 10) || 0;
          return lotNoA - lotNoB;
        });
      }
      
      const totalCount = lots.length;
      
      // Apply offset if requested (for pagination)
      const offset = parseInt(req.query.offset as string, 10);
      if (!isNaN(offset) && offset > 0) {
        lots = lots.slice(offset);
      }
      
      // Limit results if requested
      const limit = parseInt(req.query.limit as string, 10);
      if (!isNaN(limit) && limit > 0) {
        lots = lots.slice(0, limit);
      }
      
      // Return with total count for pagination
      res.json({ lots, totalCount });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lots" });
    }
  });

  // Get summary totals for all lots (for Stock Register summary when no filter applied)
  app.get("/api/lots/summary", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const coldStorage = await storage.getColdStorage(coldStorageId);
      const allLots = await storage.getAllLots(coldStorageId);
      const allSalesHistory = await storage.getSalesHistory(coldStorageId);
      
      // Calculate summary totals for all lots
      let totalBags = 0;
      let remainingBags = 0;
      let chargesPaid = 0;
      let chargesDue = 0;
      let expectedColdCharges = 0;
      
      const lotIds = new Set(allLots.map(lot => lot.id));
      
      // Get paid and due amounts from sales history for these lots
      for (const sale of allSalesHistory) {
        if (lotIds.has(sale.lotId)) {
          chargesPaid += sale.paidAmount || 0;
          chargesDue += sale.dueAmount || 0;
        }
      }
      
      // Calculate expected cold charges and bag totals
      for (const lot of allLots) {
        totalBags += lot.size;
        remainingBags += lot.remainingSize;
        
        // Calculate expected cold charges based on charge unit
        const coldChargeRate = lot.bagType === "wafer" 
          ? (coldStorage?.waferColdCharge || 0)
          : (coldStorage?.seedColdCharge || 0);
        const hammaliRate = lot.bagType === "wafer"
          ? (coldStorage?.waferHammali || 0)
          : (coldStorage?.seedHammali || 0);
        
        let lotCharge: number;
        if (coldStorage?.chargeUnit === "quintal" && lot.netWeight && lot.size > 0) {
          const coldChargeQuintal = (lot.netWeight * coldChargeRate) / 100;
          const hammaliTotal = hammaliRate * lot.size;
          lotCharge = coldChargeQuintal + hammaliTotal;
        } else {
          lotCharge = lot.size * (coldChargeRate + hammaliRate);
        }
        expectedColdCharges += lotCharge;
      }
      
      res.json({
        totalBags,
        remainingBags,
        chargesPaid,
        chargesDue,
        expectedColdCharges,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lots summary" });
    }
  });

  app.post("/api/lots", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = lotFormSchema.parse(req.body);
      
      const lot = await storage.createLot({
        ...validatedData,
        coldStorageId: coldStorageId,
        remainingSize: validatedData.size,
      });
      
      res.status(201).json(lot);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Validation error", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create lot" });
      }
    }
  });

  // Batch create lots with unified entry sequence (Lot # = Receipt # = Bill #)
  const batchLotSchema = z.object({
    farmer: z.object({
      farmerName: z.string().min(1),
      village: z.string().min(1),
      tehsil: z.string().min(1),
      district: z.string().min(1),
      state: z.string().min(1),
      contactNumber: z.string().min(1),
    }),
    lots: z.array(z.object({
      size: z.number().int().positive(),
      netWeight: z.number().optional(),
      type: z.string().min(1),
      bagType: z.enum(["wafer", "seed", "Ration"]),
      bagTypeLabel: z.string().optional().default(""),
      chamberId: z.string().optional().default(""),
      floor: z.number().int().min(0).optional().default(0),
      position: z.string().optional().default(""),
      quality: z.enum(["poor", "medium", "good"]).optional().default("medium"),
      potatoSize: z.enum(["large", "small"]).default("large"),
      assayingType: z.string().min(1),
      assayerImage: z.string().optional(),
      reducingSugar: z.number().optional(),
      dm: z.number().optional(),
      remarks: z.string().optional(),
      deductions: z.array(z.object({
        type: z.enum(["advance", "freight", "other"]),
        amount: z.number().min(0),
      })).optional().default([]),
    })).min(1),
    bagTypeCategory: z.enum(["wafer", "rationSeed"]).optional(), // Category for lot number counter
  });

  app.post("/api/lots/batch", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { farmer, lots: lotDataArray, bagTypeCategory } = batchLotSchema.parse(req.body);
      
      // Prepare lots with farmer data (lotNo will be auto-assigned by storage)
      const lotsToCreate = lotDataArray.map(lotData => {
        // Convert deductions array to separate fields
        let advanceDeduction = 0;
        let freightDeduction = 0;
        let otherDeduction = 0;
        
        if (lotData.deductions) {
          for (const deduction of lotData.deductions) {
            if (deduction.type === "advance") {
              advanceDeduction += deduction.amount;
            } else if (deduction.type === "freight") {
              freightDeduction += deduction.amount;
            } else if (deduction.type === "other") {
              otherDeduction += deduction.amount;
            }
          }
        }
        
        // Destructure to remove deductions from the spread
        const { deductions, ...lotDataWithoutDeductions } = lotData;
        
        return {
          ...farmer,
          ...lotDataWithoutDeductions,
          lotNo: "", // Will be set by createBatchLots
          coldStorageId: coldStorageId,
          remainingSize: lotData.size,
          advanceDeduction,
          freightDeduction,
          otherDeduction,
        };
      });
      
      const result = await storage.createBatchLots(lotsToCreate, coldStorageId, bagTypeCategory);
      
      res.status(201).json({
        lots: result.lots,
        entrySequence: result.entrySequence, // This is the unified Lot # = Receipt # = Bill #
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Validation error", details: error.errors });
      } else {
        console.error("Batch lot creation error:", error);
        res.status(500).json({ error: "Failed to create lots" });
      }
    }
  });

  // Get next entry sequence number (for display before save)
  app.get("/api/next-entry-sequence", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const coldStorage = await storage.getColdStorage(coldStorageId);
      const bagTypeCategory = req.query.bagTypeCategory as string || "wafer";
      const isWaferCategory = bagTypeCategory === "wafer";
      
      // Get stored counter value
      let storedCounter: number;
      if (isWaferCategory) {
        storedCounter = coldStorage?.nextWaferLotNumber ?? 1;
      } else {
        storedCounter = coldStorage?.nextRationSeedLotNumber ?? 1;
      }
      
      // Also calculate actual max lot number from existing lots to ensure counter is valid
      const allLots = await storage.getAllLots(coldStorageId);
      let maxLotNo = 0;
      allLots.forEach((lot: Lot) => {
        const lotIsWafer = lot.bagType === "wafer";
        if (lotIsWafer === isWaferCategory) {
          const num = parseInt(lot.lotNo, 10);
          if (!isNaN(num) && num > maxLotNo) {
            maxLotNo = num;
          }
        }
      });
      
      // Use whichever is higher: stored counter or (max lot number + 1)
      const nextSequence = Math.max(storedCounter, maxLotNo + 1);
      
      // Update counter if it was out of sync
      if (nextSequence > storedCounter) {
        if (isWaferCategory) {
          await storage.updateColdStorage(coldStorageId, { nextWaferLotNumber: nextSequence });
        } else {
          await storage.updateColdStorage(coldStorageId, { nextRationSeedLotNumber: nextSequence });
        }
      }
      
      res.json({ nextSequence });
    } catch (error) {
      res.status(500).json({ error: "Failed to get next entry sequence" });
    }
  });

  // Get farmer records for auto-complete in lot entry
  app.get("/api/farmers/lookup", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const farmers = await storage.getFarmerRecords(coldStorageId, year);
      res.json(farmers);
    } catch (error) {
      console.error("Farmer lookup error:", error);
      res.status(500).json({ error: "Failed to fetch farmer records" });
    }
  });

  // Get unique location names (villages and tehsils) for autocomplete
  app.get("/api/locations/lookup", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const allLots = await storage.getAllLots(coldStorageId);
      
      // Extract unique villages and tehsils
      const villageSet = new Set<string>();
      const tehsilSet = new Set<string>();
      
      allLots.forEach((lot: Lot) => {
        if (lot.village && lot.village.trim()) {
          villageSet.add(lot.village.trim());
        }
        if (lot.tehsil && lot.tehsil.trim()) {
          tehsilSet.add(lot.tehsil.trim());
        }
      });
      
      // Convert to sorted arrays
      const villages = Array.from(villageSet).sort((a, b) => a.localeCompare(b, 'hi'));
      const tehsils = Array.from(tehsilSet).sort((a, b) => a.localeCompare(b, 'hi'));
      
      res.json({ villages, tehsils });
    } catch (error) {
      console.error("Location lookup error:", error);
      res.status(500).json({ error: "Failed to fetch location records" });
    }
  });

  app.get("/api/buyers/lookup", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const buyers = await storage.getBuyerRecords(coldStorageId);
      res.json(buyers);
    } catch (error) {
      console.error("Buyer lookup error:", error);
      res.status(500).json({ error: "Failed to fetch buyer records" });
    }
  });

  app.get("/api/bag-type-labels/lookup", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const labels = await storage.getBagTypeLabels(coldStorageId);
      res.json(labels);
    } catch (error) {
      console.error("Bag type label lookup error:", error);
      res.status(500).json({ error: "Failed to fetch bag type labels" });
    }
  });

  app.get("/api/lots/search", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { type, query, lotNo, size, quality, paymentDue, potatoType } = req.query;
      
      const validTypes = ["phone", "lotNoSize", "filter", "farmerName"];
      if (!validTypes.includes(type as string)) {
        return res.status(400).json({ error: "Invalid search type" });
      }
      
      let lots;
      if (type === "filter") {
        // Get all lots and apply filters
        lots = await storage.getAllLots(coldStorageId);
      } else if (type === "lotNoSize") {
        lots = await storage.searchLotsByLotNoAndSize(
          lotNo as string || "",
          size as string || "",
          coldStorageId
        );
      } else if (type === "farmerName") {
        if (!query) {
          return res.status(400).json({ error: "Missing query parameter" });
        }
        const village = req.query.village as string | undefined;
        const contactNumber = req.query.contactNumber as string | undefined;
        lots = await storage.searchLotsByFarmerName(
          query as string,
          coldStorageId,
          village,
          contactNumber
        );
      } else {
        if (!query) {
          return res.status(400).json({ error: "Missing query parameter" });
        }
        lots = await storage.searchLots(
          type as "phone",
          query as string,
          coldStorageId
        );
      }
      
      // Apply quality filter
      if (quality && ["poor", "medium", "good"].includes(quality as string)) {
        lots = lots.filter((lot) => lot.quality === quality);
      }
      
      // Apply potato type filter
      if (potatoType && typeof potatoType === "string" && potatoType.trim()) {
        lots = lots.filter((lot) => lot.type === potatoType);
      }
      
      // Apply payment due filter (lots that have cold storage charges due)
      if (paymentDue === "true") {
        lots = lots.filter((lot) => lot.totalDueCharge && lot.totalDueCharge > 0);
      }
      
      // Sort by lot number in ascending order
      lots = lots.sort((a, b) => parseInt(a.lotNo, 10) - parseInt(b.lotNo, 10));
      
      res.json(lots);
    } catch (error) {
      res.status(500).json({ error: "Failed to search lots" });
    }
  });

  // Get all lots with the same entry sequence (for printing entry receipt)
  // Check if a lot number already exists for a given bag type (excluding a specific lot)
  // This route must come BEFORE /api/lots/:id to avoid matching "check-lot-number" as an id
  app.get("/api/lots/check-lot-number", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const lotNo = req.query.lotNo as string;
      const bagType = req.query.bagType as string;
      const excludeId = req.query.excludeId as string;
      
      if (!lotNo || !bagType) {
        return res.status(400).json({ error: "Missing lotNo or bagType parameter" });
      }
      
      // Determine the bag type category (wafer vs ration/seed)
      const isWaferCategory = bagType === "wafer";
      
      // Check if any lot with this number exists for the same bag type category
      const allLots = await storage.getAllLots(coldStorageId);
      const isDuplicate = allLots.some((existingLot: Lot) => {
        if (existingLot.id === excludeId) return false; // Exclude the current lot being edited
        if (existingLot.lotNo !== lotNo) return false; // Different lot number
        
        // Check if same bag type category
        const lotIsWafer = existingLot.bagType === "wafer";
        return lotIsWafer === isWaferCategory;
      });
      
      res.json({ isDuplicate, lotNo, bagType });
    } catch (error) {
      console.error("Error checking lot number:", error);
      res.status(500).json({ error: "Failed to check lot number" });
    }
  });

  // This route must come BEFORE /api/lots/:id to avoid matching "by-entry-sequence" as an id
  app.get("/api/lots/by-entry-sequence/:entrySequence", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const entrySequence = parseInt(req.params.entrySequence, 10);
      if (isNaN(entrySequence)) {
        return res.status(400).json({ error: "Invalid entry sequence" });
      }
      const lotsInBatch = await storage.getLotsByEntrySequence(entrySequence, coldStorageId);
      res.json(lotsInBatch);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lots by entry sequence" });
    }
  });

  app.get("/api/lots/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
      }
      // Verify ownership - lot must belong to user's cold storage
      if (lot.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(lot);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lot" });
    }
  });

  // Schema for allowed editable fields only (location & quality)
  const lotEditSchema = z.object({
    chamberId: z.string().optional(),
    floor: z.number().int().min(0).optional(),
    position: z.string().optional(),
    quality: z.enum(["poor", "medium", "good"]).optional(),
    // Allow upForSale for toggle functionality
    upForSale: z.number().int().min(0).max(1).optional(),
    // Net weight for quintal-based charging
    netWeight: z.number().optional(),
    // Entry-time deductions
    advanceDeduction: z.number().min(0).optional(),
    freightDeduction: z.number().min(0).optional(),
    otherDeduction: z.number().min(0).optional(),
    // Lot number (editable with uniqueness validation)
    lotNo: z.string().optional(),
    // Farmer details (editable)
    farmerName: z.string().min(1).optional(),
    village: z.string().optional(),
    tehsil: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    contactNumber: z.string().optional(),
  });

  app.patch("/api/lots/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
      }
      // Verify ownership - lot must belong to user's cold storage
      if (lot.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Validate only allowed fields
      const validated = lotEditSchema.parse(req.body);
      
      // If lotNo is being changed, validate uniqueness
      if (validated.lotNo && validated.lotNo !== lot.lotNo) {
        const isWaferCategory = lot.bagType === "wafer";
        const allLots = await storage.getAllLots(coldStorageId);
        const isDuplicate = allLots.some((existingLot: Lot) => {
          if (existingLot.id === lot.id) return false;
          if (existingLot.lotNo !== validated.lotNo) return false;
          const existingIsWafer = existingLot.bagType === "wafer";
          return existingIsWafer === isWaferCategory;
        });
        
        if (isDuplicate) {
          return res.status(400).json({ error: "Duplicate lot number for this bag type category" });
        }
      }
      
      // Only create edit history if location/quality fields are being changed (not just upForSale toggle)
      const isLocationOrQualityEdit = validated.chamberId !== undefined || 
                                       validated.floor !== undefined || 
                                       validated.position !== undefined || 
                                       validated.quality !== undefined ||
                                       validated.lotNo !== undefined;

      const previousData = {
        chamberId: lot.chamberId,
        floor: lot.floor,
        position: lot.position,
        quality: lot.quality,
        lotNo: lot.lotNo,
      };

      // Update the lot (including lotNo and entrySequence if changed)
      const updateData: Partial<typeof validated & { entrySequence?: number }> = { ...validated };
      if (validated.lotNo && validated.lotNo !== lot.lotNo) {
        updateData.entrySequence = parseInt(validated.lotNo, 10);
      }
      
      const updatedLot = await storage.updateLot(req.params.id, updateData);

      // If farmer details changed, update all related salesHistory entries
      const farmerFieldsChanged = validated.farmerName !== undefined || 
                                   validated.village !== undefined ||
                                   validated.tehsil !== undefined ||
                                   validated.district !== undefined ||
                                   validated.state !== undefined ||
                                   validated.contactNumber !== undefined;
      
      if (farmerFieldsChanged) {
        // Pass old farmer details to also update buyerName for "self" sales
        await storage.updateSalesHistoryFarmerDetails(
          req.params.id, 
          {
            farmerName: validated.farmerName,
            village: validated.village,
            tehsil: validated.tehsil,
            district: validated.district,
            state: validated.state,
            contactNumber: validated.contactNumber,
          },
          {
            farmerName: lot.farmerName,
            village: lot.village,
            contactNumber: lot.contactNumber,
          }
        );
      }

      // If lotNo changed, recalculate the counter for this bag type category
      if (validated.lotNo && validated.lotNo !== lot.lotNo) {
        const isWaferCategory = lot.bagType === "wafer";
        const allLotsForCounter = await storage.getAllLots(coldStorageId);
        
        // Find max lot number for this category (including the one we just updated)
        let maxLotNo = 0;
        allLotsForCounter.forEach((existingLot: Lot) => {
          const existingIsWafer = existingLot.bagType === "wafer";
          if (existingIsWafer === isWaferCategory) {
            const num = parseInt(existingLot.lotNo, 10);
            if (!isNaN(num) && num > maxLotNo) {
              maxLotNo = num;
            }
          }
        });
        
        // Also consider the new lot number we just set
        const newLotNum = parseInt(validated.lotNo, 10);
        if (!isNaN(newLotNum) && newLotNum > maxLotNo) {
          maxLotNo = newLotNum;
        }
        
        // Update the counter to max + 1
        const newCounterValue = maxLotNo + 1;
        if (isWaferCategory) {
          await storage.updateColdStorage(coldStorageId, { nextWaferLotNumber: newCounterValue });
        } else {
          await storage.updateColdStorage(coldStorageId, { nextRationSeedLotNumber: newCounterValue });
        }
      }

      if (isLocationOrQualityEdit) {
        await storage.createEditHistory({
          lotId: lot.id,
          changeType: "edit",
          previousData: JSON.stringify(previousData),
          newData: JSON.stringify(validated),
        });
      }

      res.json(updatedLot);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Error updating lot:", error);
      res.status(500).json({ error: "Failed to update lot" });
    }
  });

  // Reverse the latest edit
  app.post("/api/lots/:id/reverse-edit", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
      }
      // Verify ownership
      if (lot.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { historyId } = req.body;
      if (!historyId) {
        return res.status(400).json({ error: "Missing historyId" });
      }

      // Get the edit history for this lot (sorted by date, newest first)
      const history = await storage.getLotHistory(lot.id);
      if (history.length === 0) {
        return res.status(400).json({ error: "No edit history found" });
      }

      // Find all edit entries (not sales)
      const editEntries = history.filter(h => h.changeType === "edit");
      if (editEntries.length === 0) {
        return res.status(400).json({ error: "No edit history found" });
      }

      // The latest edit is the first one in the sorted list
      const latestEdit = editEntries[0];
      
      // Verify the historyId matches the latest edit entry
      if (latestEdit.id !== historyId) {
        return res.status(400).json({ error: "Can only reverse the latest edit" });
      }

      // Parse previous data and restore it
      const previousData = JSON.parse(latestEdit.previousData);
      
      // Only restore location/quality fields
      const restoreData: Record<string, any> = {};
      if (previousData.chamberId !== undefined) restoreData.chamberId = previousData.chamberId;
      if (previousData.floor !== undefined) restoreData.floor = previousData.floor;
      if (previousData.position !== undefined) restoreData.position = previousData.position;
      if (previousData.quality !== undefined) restoreData.quality = previousData.quality;

      // Check if there's anything to restore
      if (Object.keys(restoreData).length === 0) {
        return res.status(400).json({ error: "This edit cannot be reversed (no location/quality changes)" });
      }

      // Update the lot with previous values
      const updatedLot = await storage.updateLot(lot.id, restoreData);

      // Delete the history entry after successful reversal
      await storage.deleteEditHistory(latestEdit.id);

      res.json(updatedLot);
    } catch (error) {
      res.status(500).json({ error: "Failed to reverse edit" });
    }
  });

  app.post("/api/lots/:id/partial-sale", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
      }
      // Verify ownership
      if (lot.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { quantitySold, pricePerBag, paymentStatus, paymentMode, buyerName, pricePerKg, paidAmount, dueAmount, position, kataCharges, extraHammali, gradingCharges, netWeight, customColdCharge, customHammali, chargeBasis, isSelfSale } = req.body;

      if (typeof quantitySold !== "number" || quantitySold <= 0) {
        return res.status(400).json({ error: "Invalid quantity sold" });
      }

      if (quantitySold > lot.remainingSize) {
        return res.status(400).json({ error: "Quantity exceeds remaining size" });
      }

      // Update position if provided
      if (position) {
        await storage.updateLot(req.params.id, { position });
      }

      const previousData = {
        remainingSize: lot.remainingSize,
      };

      const newRemainingSize = lot.remainingSize - quantitySold;
      const totalPrice = quantitySold * pricePerBag;

      // Get cold storage to calculate storage charge and rate breakdown
      // Wafer uses wafer rates, Seed and Ration bags use seed rates
      const coldStorage = await storage.getColdStorage(lot.coldStorageId);
      const useWaferRates = lot.bagType === "wafer";
      
      // Use custom rates if provided, otherwise use cold storage defaults
      const defaultRate = coldStorage ? (useWaferRates ? coldStorage.waferRate : coldStorage.seedRate) : 0;
      const defaultHammali = coldStorage ? (useWaferRates ? (coldStorage.waferHammali || 0) : (coldStorage.seedHammali || 0)) : 0;
      const defaultColdCharge = defaultRate - defaultHammali;
      
      const hammaliRate = customHammali !== undefined ? customHammali : defaultHammali;
      const coldChargeRate = customColdCharge !== undefined ? customColdCharge : defaultColdCharge;
      const rate = coldChargeRate + hammaliRate;
      
      // When chargeBasis is "totalRemaining", charge for all remaining bags (before this sale)
      const chargeQuantity = chargeBasis === "totalRemaining" ? lot.remainingSize : quantitySold;
      
      // Calculate storage charge based on charge unit mode
      // If baseColdChargesBilled is already set, skip base charges (only extras apply)
      let storageCharge: number;
      if (lot.baseColdChargesBilled === 1) {
        // Base charges already billed in a previous sale, don't charge again
        storageCharge = 0;
      } else if (coldStorage?.chargeUnit === "quintal" && lot.netWeight && lot.size > 0) {
        // Quintal mode: cold charges (per quintal) + hammali (per bag)
        const coldChargeQuintal = (lot.netWeight * chargeQuantity * coldChargeRate) / (lot.size * 100);
        const hammaliPerBag = hammaliRate * chargeQuantity;
        storageCharge = coldChargeQuintal + hammaliPerBag;
      } else {
        // Bag mode: chargeQuantity × rate
        storageCharge = chargeQuantity * rate;
      }
      
      // Calculate total charge including all extra charges for lot tracking
      const kata = kataCharges || 0;
      const extraHammaliTotal = extraHammali || 0;
      const grading = gradingCharges || 0;
      // Proportional entry deductions using shared helper
      const proportionalDeductions = calculateProportionalEntryDeductions({
        quantitySold,
        originalLotSize: lot.size,
        advanceDeduction: lot.advanceDeduction || 0,
        freightDeduction: lot.freightDeduction || 0,
        otherDeduction: lot.otherDeduction || 0,
      });
      const totalChargeForLot = storageCharge + kata + extraHammaliTotal + grading + proportionalDeductions;

      const updateData: { 
        remainingSize: number; 
        totalPaidCharge?: number; 
        totalDueCharge?: number;
        baseColdChargesBilled?: number;
      } = {
        remainingSize: newRemainingSize,
      };
      
      // Set baseColdChargesBilled flag when using totalRemaining charge basis (only if not already set)
      if (chargeBasis === "totalRemaining" && lot.baseColdChargesBilled !== 1) {
        updateData.baseColdChargesBilled = 1;
      }
      
      // Track paid and due charges separately (include all surcharges)
      if (paymentStatus === "paid") {
        updateData.totalPaidCharge = (lot.totalPaidCharge || 0) + totalChargeForLot;
      } else if (paymentStatus === "due") {
        updateData.totalDueCharge = (lot.totalDueCharge || 0) + totalChargeForLot;
      } else if (paymentStatus === "partial") {
        // Validate and normalize partial payment amounts
        const rawPaid = Math.max(0, paidAmount || 0);
        const actualPaid = Math.min(rawPaid, totalChargeForLot); // Clamp to max charge (including surcharges)
        const actualDue = totalChargeForLot - actualPaid; // Calculate due as remainder to ensure sum equals total
        updateData.totalPaidCharge = (lot.totalPaidCharge || 0) + actualPaid;
        updateData.totalDueCharge = (lot.totalDueCharge || 0) + actualDue;
      }
      
      await storage.updateLot(req.params.id, updateData);

      await storage.createEditHistory({
        lotId: lot.id,
        changeType: "partial_sale",
        previousData: JSON.stringify(previousData),
        newData: JSON.stringify({ remainingSize: newRemainingSize }),
        soldQuantity: quantitySold,
        pricePerBag,
        coldCharge: coldChargeRate,
        hammali: hammaliRate,
        pricePerKg: pricePerKg || null,
        buyerName: buyerName || null,
        totalPrice,
        salePaymentStatus: paymentStatus,
        saleCharge: storageCharge,
      });

      // Get chamber for sales history
      const chamber = await storage.getChamber(lot.chamberId);
      
      // Calculate paid/due amounts based on payment status (use totalChargeForLot which includes all charges)
      let salePaidAmount = 0;
      let saleDueAmount = 0;
      if (paymentStatus === "paid") {
        salePaidAmount = totalChargeForLot;
      } else if (paymentStatus === "due") {
        saleDueAmount = totalChargeForLot;
      } else if (paymentStatus === "partial") {
        const rawPaidForSale = Math.max(0, paidAmount || 0);
        salePaidAmount = Math.min(rawPaidForSale, totalChargeForLot);
        saleDueAmount = totalChargeForLot - salePaidAmount;
      }
      
      // Create permanent sales history record
      await storage.createSalesHistory({
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
        saleType: "partial",
        quantitySold,
        pricePerBag: rate,
        coldCharge: coldChargeRate,
        hammali: hammaliRate,
        coldStorageCharge: totalChargeForLot, // Total charge including all extras (base + kata + extraHammali + grading)
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
        chargeBasis: chargeBasis || "actual",
        chargeUnitAtSale: coldStorage?.chargeUnit || "bag", // Preserve charge unit used at sale time
        initialNetWeightKg: lot.netWeight || null,
        baseChargeAmountAtSale: storageCharge, // Base charge (cold+hammali) before extras; if 0, base already billed
        remainingSizeAtSale: lot.remainingSize, // Remaining bags before this sale (for totalRemaining basis)
        // Entry-time deductions (copy from lot)
        advanceDeduction: lot.advanceDeduction || 0,
        freightDeduction: lot.freightDeduction || 0,
        otherDeduction: lot.otherDeduction || 0,
        // Self sale flag (farmer buying own produce)
        isSelfSale: isSelfSale ? 1 : 0,
      });

      const updatedLot = await storage.getLot(req.params.id);
      res.json(updatedLot);
    } catch (error) {
      console.error("Partial sale error:", error);
      res.status(500).json({ error: "Failed to process partial sale" });
    }
  });

  app.get("/api/lots/:id/history", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify lot ownership before showing history
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
      }
      if (lot.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const history = await storage.getLotHistory(req.params.id);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lot history" });
    }
  });

  // Finalize Sale
  const finalizeSaleSchema = z.object({
    paymentStatus: z.enum(["due", "paid", "partial"]),
    paymentMode: z.enum(["cash", "account"]).optional(),
    buyerName: z.string().optional(),
    pricePerKg: z.number().optional(),
    paidAmount: z.number().optional(),
    dueAmount: z.number().optional(),
    position: z.string().optional(),
    kataCharges: z.number().optional(),
    extraHammali: z.number().optional(),
    gradingCharges: z.number().optional(),
    netWeight: z.number().optional(),
    customColdCharge: z.number().optional(),
    customHammali: z.number().optional(),
  });

  app.post("/api/lots/:id/finalize-sale", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = finalizeSaleSchema.parse(req.body);
      
      // Verify lot ownership before allowing sale
      const existingLot = await storage.getLot(req.params.id);
      if (!existingLot) {
        return res.status(404).json({ error: "Lot not found" });
      }
      if (existingLot.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      // Update position if provided
      if (validatedData.position) {
        await storage.updateLot(req.params.id, { position: validatedData.position });
      }
      
      const lot = await storage.finalizeSale(
        req.params.id, 
        validatedData.paymentStatus,
        validatedData.buyerName,
        validatedData.pricePerKg,
        validatedData.paidAmount,
        validatedData.dueAmount,
        validatedData.paymentMode,
        validatedData.kataCharges,
        validatedData.extraHammali,
        validatedData.gradingCharges,
        validatedData.netWeight,
        validatedData.customColdCharge,
        validatedData.customHammali
      );
      if (!lot) {
        return res.status(404).json({ error: "Lot not found or already sold" });
      }
      
      res.json(lot);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid payment status", details: error.errors });
      }
      res.status(500).json({ error: "Failed to finalize sale" });
    }
  });

  // Analytics
  app.get("/api/analytics/quality", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { year } = req.query;
      const yearNum = year ? parseInt(year as string) : undefined;
      const stats = await storage.getQualityStats(coldStorageId, yearNum);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch quality stats" });
    }
  });

  app.get("/api/analytics/payments", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { year } = req.query;
      const yearNum = year ? parseInt(year as string) : undefined;
      const stats = await storage.getPaymentStats(coldStorageId, yearNum);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch payment stats" });
    }
  });

  app.get("/api/analytics/merchants", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { year } = req.query;
      const yearNum = year ? parseInt(year as string) : undefined;
      const stats = await storage.getMerchantStats(coldStorageId, yearNum);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch merchant stats" });
    }
  });

  app.get("/api/analytics/years", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const years = await storage.getAnalyticsYears(coldStorageId);
      res.json(years);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch analytics years" });
    }
  });

  // Reset Season
  app.get("/api/reset-season/check", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const result = await storage.checkResetEligibility(coldStorageId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to check reset eligibility" });
    }
  });

  app.post("/api/reset-season", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const eligibility = await storage.checkResetEligibility(coldStorageId);
      if (!eligibility.canReset) {
        return res.status(400).json({ 
          error: "Cannot reset season", 
          remainingBags: eligibility.remainingBags,
          remainingLots: eligibility.remainingLots
        });
      }
      await storage.resetSeason(coldStorageId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset season" });
    }
  });

  // Cold Storage Settings
  app.get("/api/cold-storage", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const coldStorage = await storage.getColdStorage(coldStorageId);
      res.json(coldStorage);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cold storage" });
    }
  });

  app.patch("/api/cold-storage", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const updated = await storage.updateColdStorage(coldStorageId, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update cold storage" });
    }
  });

  // Chamber management
  app.post("/api/chambers", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { name, capacity } = req.body;
      const chamber = await storage.createChamber({
        name,
        capacity,
        coldStorageId: coldStorageId,
      });
      res.status(201).json(chamber);
    } catch (error) {
      res.status(500).json({ error: "Failed to create chamber" });
    }
  });

  app.patch("/api/chambers/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const chamber = await storage.getChamber(req.params.id);
      if (!chamber) {
        return res.status(404).json({ error: "Chamber not found" });
      }
      // Verify ownership
      if (chamber.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const updated = await storage.updateChamber(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update chamber" });
    }
  });

  app.delete("/api/chambers/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const chamber = await storage.getChamber(req.params.id);
      if (!chamber) {
        return res.status(404).json({ error: "Chamber not found" });
      }
      // Verify ownership
      if (chamber.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const deleted = await storage.deleteChamber(req.params.id);
      if (!deleted) {
        return res.status(400).json({ error: "Cannot delete chamber with existing lots" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete chamber" });
    }
  });

  // Sales History
  app.get("/api/sales-history", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { year, farmerName, village, contactNumber, paymentStatus, buyerName } = req.query;
      
      const filters: {
        year?: number;
        farmerName?: string;
        village?: string;
        contactNumber?: string;
        paymentStatus?: "paid" | "due";
        buyerName?: string;
      } = {};
      
      if (year) filters.year = parseInt(year as string);
      if (farmerName) filters.farmerName = farmerName as string;
      if (village) filters.village = village as string;
      if (contactNumber) filters.contactNumber = contactNumber as string;
      if (paymentStatus === "paid" || paymentStatus === "due") {
        filters.paymentStatus = paymentStatus;
      }
      if (buyerName) filters.buyerName = buyerName as string;
      
      const salesHistory = await storage.getSalesHistory(coldStorageId, filters);
      res.json(salesHistory);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sales history" });
    }
  });

  app.get("/api/sales-history/years", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const years = await storage.getSalesYears(coldStorageId);
      res.json(years);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sales years" });
    }
  });

  // Get total bags exited (Nikasi) for a set of sales
  app.get("/api/sales-history/exits-summary", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { year } = req.query;
      const yearFilter = year ? parseInt(year as string) : undefined;
      const totalBagsExited = await storage.getTotalBagsExited(coldStorageId, yearFilter);
      res.json({ totalBagsExited });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch exits summary" });
    }
  });

  app.patch("/api/sales-history/:id/mark-paid", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify ownership by checking if sale belongs to user's cold storage
      const currentSales = await storage.getSalesHistory(coldStorageId, {});
      const sale = currentSales.find(s => s.id === req.params.id);
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      const updated = await storage.markSaleAsPaid(req.params.id);
      if (!updated) {
        return res.status(404).json({ error: "Sale not found" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to mark sale as paid" });
    }
  });

  app.patch("/api/sales-history/:id/mark-due", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify ownership
      const currentSales = await storage.getSalesHistory(coldStorageId, {});
      const sale = currentSales.find(s => s.id === req.params.id);
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      const updated = await storage.markSaleAsDue(req.params.id);
      if (!updated) {
        return res.status(404).json({ error: "Sale not found" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to mark sale as due" });
    }
  });

  const updateSalesHistorySchema = z.object({
    buyerName: z.string().optional(),
    pricePerKg: z.number().optional(),
    paymentStatus: z.enum(["paid", "due", "partial"]).optional(),
    paidAmount: z.number().optional(),
    dueAmount: z.number().optional(),
    paymentMode: z.enum(["cash", "account"]).optional(),
    netWeight: z.number().nullable().optional(),
    coldCharge: z.number().optional(),
    hammali: z.number().optional(),
    kataCharges: z.number().optional(),
    extraHammali: z.number().optional(),
    gradingCharges: z.number().optional(),
    coldStorageCharge: z.number().optional(),
    chargeBasis: z.enum(["actual", "totalRemaining"]).optional(),
    extraDueToMerchant: z.number().optional(),
    // Sub-fields for extraDueToMerchant breakdown (sum = extraDueToMerchant)
    extraDueHammaliMerchant: z.number().optional(),
    extraDueGradingMerchant: z.number().optional(),
    extraDueOtherMerchant: z.number().optional(),
  });

  app.patch("/api/sales-history/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = updateSalesHistorySchema.parse(req.body);
      
      // Get current sale data before update for logging - also serves as ownership check
      const currentSales = await storage.getSalesHistory(coldStorageId, {});
      const currentSale = currentSales.find(s => s.id === req.params.id);
      
      // Ownership check - sale must belong to user's cold storage
      if (!currentSale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      
      // Server-side computation: if any sub-field is provided, compute extraDueToMerchant as sum
      if (validatedData.extraDueHammaliMerchant !== undefined ||
          validatedData.extraDueGradingMerchant !== undefined ||
          validatedData.extraDueOtherMerchant !== undefined) {
        const hammali = validatedData.extraDueHammaliMerchant ?? (currentSale.extraDueHammaliMerchant || 0);
        const grading = validatedData.extraDueGradingMerchant ?? (currentSale.extraDueGradingMerchant || 0);
        const other = validatedData.extraDueOtherMerchant ?? (currentSale.extraDueOtherMerchant || 0);
        validatedData.extraDueToMerchant = hammali + grading + other;
      }
      
      const updated = await storage.updateSalesHistory(req.params.id, validatedData);
      if (!updated) {
        return res.status(404).json({ error: "Sale not found" });
      }
      
      // Log changes to edit history
      if (currentSale) {
        const fieldsToTrack = ['buyerName', 'pricePerKg', 'paymentStatus', 'paidAmount', 'dueAmount', 'paymentMode', 'netWeight', 'coldCharge', 'hammali', 'kataCharges', 'extraHammali', 'gradingCharges', 'coldStorageCharge', 'extraDueToMerchant', 'extraDueHammaliMerchant', 'extraDueGradingMerchant', 'extraDueOtherMerchant'] as const;
        for (const field of fieldsToTrack) {
          if (validatedData[field as keyof typeof validatedData] !== undefined || field === 'coldStorageCharge') {
            const oldValue = currentSale[field as keyof typeof currentSale];
            const newValue = field === 'coldStorageCharge' 
              ? (updated as typeof currentSale)[field] 
              : validatedData[field as keyof typeof validatedData];
            if (String(oldValue ?? '') !== String(newValue ?? '')) {
              await storage.createSaleEditHistory({
                saleId: req.params.id,
                fieldChanged: field,
                oldValue: oldValue != null ? String(oldValue) : null,
                newValue: newValue != null ? String(newValue) : null,
              });
            }
          }
        }
      }
      
      // If cold storage charges changed, trigger FIFO recalculation
      const chargeFieldsChanged = validatedData.coldStorageCharge !== undefined || 
        validatedData.coldCharge !== undefined || 
        validatedData.hammali !== undefined;
      
      if (chargeFieldsChanged && updated) {
        // Check if this is a self-sale - trigger farmer FIFO instead of buyer FIFO
        if (updated.isSelfSale === 1 && updated.farmerName && updated.village) {
          // For self-sales, trigger farmer FIFO recalculation
          const buyerDisplayName = `${updated.farmerName} (${updated.village})`;
          await storage.recomputeFarmerPayments(coldStorageId, buyerDisplayName);
        } else {
          // Get CurrentDueBuyerName: transferToBuyerName if not blank, else buyerName
          const currentDueBuyerName = (updated.transferToBuyerName && updated.transferToBuyerName.trim() !== '') 
            ? updated.transferToBuyerName 
            : updated.buyerName;
          
          if (currentDueBuyerName) {
            // Trigger FIFO recalculation for this buyer (signature: buyerName, coldStorageId)
            await storage.recomputeBuyerPayments(currentDueBuyerName, coldStorageId);
          }
        }
      }
      
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid update data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update sale" });
    }
  });

  app.get("/api/sales-history/:id/edit-history", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify ownership
      const currentSales = await storage.getSalesHistory(coldStorageId, {});
      const sale = currentSales.find(s => s.id === req.params.id);
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      const history = await storage.getSaleEditHistory(req.params.id);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch edit history" });
    }
  });

  app.post("/api/sales-history/:id/reverse", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify ownership before allowing reversal
      const currentSales = await storage.getSalesHistory(coldStorageId, {});
      const sale = currentSales.find(s => s.id === req.params.id);
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }

      // Check if reversal is blocked due to later sales (for totalRemaining charge basis)
      if (sale.chargeBasis === "totalRemaining" && sale.remainingSizeAtSale != null) {
        const lot = await storage.getLot(sale.lotId);
        if (lot) {
          const expectedRemaining = sale.remainingSizeAtSale - sale.quantitySold;
          if (lot.remainingSize < expectedRemaining) {
            return res.status(400).json({ 
              error: "LATER_SALE_EXISTS",
              message: "There is a sale record which was made post this and billed in this sale record. Please reverse that first in order to reverse this particular sale entry."
            });
          }
        }
      }

      // Check if this is a self-sale before reversing (for farmer FIFO trigger)
      const isSelfSale = sale.isSelfSale === 1;
      const farmerName = sale.farmerName;
      const village = sale.village;
      
      const result = await storage.reverseSale(req.params.id);
      if (!result.success) {
        const statusCode = result.errorType === "not_found" ? 404 : 400;
        return res.status(statusCode).json({ error: result.message });
      }

      // Trigger appropriate FIFO recomputation
      if (isSelfSale && farmerName && village && result.coldStorageId) {
        // For self-sales, trigger farmer FIFO recalculation
        const buyerDisplayName = `${farmerName} (${village})`;
        await storage.recomputeFarmerPayments(result.coldStorageId, buyerDisplayName);
      } else if (result.buyerName && result.coldStorageId) {
        // For regular sales, trigger buyer FIFO recomputation
        await storage.recomputeBuyerPayments(result.buyerName, result.coldStorageId);
      }

      res.json({ success: true, lot: result.lot });
    } catch (error) {
      res.status(500).json({ error: "Failed to reverse sale" });
    }
  });

  // Exit History (Nikasi)
  const createExitSchema = z.object({
    bagsExited: z.number().min(1, "Must exit at least 1 bag"),
  });

  app.get("/api/sales-history/:id/exits", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify ownership
      const currentSales = await storage.getSalesHistory(coldStorageId, {});
      const sale = currentSales.find(s => s.id === req.params.id);
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      const exits = await storage.getExitsForSale(req.params.id);
      const totalExited = await storage.getTotalExitedBags(req.params.id);
      res.json({ exits, totalExited });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch exit history" });
    }
  });

  app.post("/api/sales-history/:id/exits", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { bagsExited } = createExitSchema.parse(req.body);
      
      // Get the sale to verify bags available
      const sales = await storage.getSalesHistory(coldStorageId, {});
      const sale = sales.find(s => s.id === req.params.id);
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      
      // Check how many bags can still be exited
      const totalExited = await storage.getTotalExitedBags(req.params.id);
      const remainingToExit = sale.quantitySold - totalExited;
      
      if (bagsExited > remainingToExit) {
        return res.status(400).json({ 
          error: `Cannot exit ${bagsExited} bags. Only ${remainingToExit} bags remaining.` 
        });
      }
      
      const exit = await storage.createExit({
        salesHistoryId: req.params.id,
        lotId: sale.lotId,
        coldStorageId: sale.coldStorageId,
        bagsExited,
      });
      
      res.status(201).json(exit);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid exit data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create exit" });
    }
  });

  app.post("/api/sales-history/:id/exits/reverse-latest", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify ownership
      const currentSales = await storage.getSalesHistory(coldStorageId, {});
      const sale = currentSales.find(s => s.id === req.params.id);
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      const result = await storage.reverseLatestExit(req.params.id);
      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reverse exit" });
    }
  });

  // Bill number assignment
  const assignBillNumberSchema = z.object({
    billType: z.enum(["coldStorage", "sales"]),
  });

  app.post("/api/sales-history/:id/assign-bill-number", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify ownership
      const currentSales = await storage.getSalesHistory(coldStorageId, {});
      const sale = currentSales.find(s => s.id === req.params.id);
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      const { billType } = assignBillNumberSchema.parse(req.body);
      const billNumber = await storage.assignBillNumber(req.params.id, billType);
      res.json({ billNumber });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid bill type", details: error.errors });
      }
      res.status(500).json({ error: "Failed to assign bill number" });
    }
  });

  // Lot bill number assignment
  app.post("/api/lots/:id/assign-bill-number", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
      }
      // Verify ownership
      if (lot.coldStorageId !== coldStorageId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const billNumber = await storage.assignLotBillNumber(req.params.id);
      res.json({ billNumber });
    } catch (error) {
      res.status(500).json({ error: "Failed to assign lot bill number" });
    }
  });

  // Maintenance Records
  const createMaintenanceSchema = z.object({
    taskDescription: z.string(),
    responsiblePerson: z.string(),
    nextDueDate: z.string(),
  });

  const updateMaintenanceSchema = z.object({
    taskDescription: z.string().optional(),
    responsiblePerson: z.string().optional(),
    nextDueDate: z.string().optional(),
  });

  app.get("/api/maintenance", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const records = await storage.getMaintenanceRecords(coldStorageId);
      res.json(records);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch maintenance records" });
    }
  });

  app.post("/api/maintenance", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = createMaintenanceSchema.parse(req.body);
      const record = await storage.createMaintenanceRecord({
        coldStorageId: coldStorageId,
        taskDescription: validatedData.taskDescription,
        responsiblePerson: validatedData.responsiblePerson,
        nextDueDate: validatedData.nextDueDate,
      });
      res.json(record);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid maintenance data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create maintenance record" });
    }
  });

  app.patch("/api/maintenance/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = updateMaintenanceSchema.parse(req.body);
      // Verify ownership
      const records = await storage.getMaintenanceRecords(coldStorageId);
      const record = records.find(r => r.id === req.params.id);
      if (!record) {
        return res.status(404).json({ error: "Maintenance record not found" });
      }
      const updated = await storage.updateMaintenanceRecord(req.params.id, validatedData);
      if (!updated) {
        return res.status(404).json({ error: "Maintenance record not found" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid maintenance data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update maintenance record" });
    }
  });

  app.delete("/api/maintenance/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      // Verify ownership
      const records = await storage.getMaintenanceRecords(coldStorageId);
      const record = records.find(r => r.id === req.params.id);
      if (!record) {
        return res.status(404).json({ error: "Maintenance record not found" });
      }
      const deleted = await storage.deleteMaintenanceRecord(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Maintenance record not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete maintenance record" });
    }
  });

  // Cash Receipts (Cash Management)
  app.get("/api/cash-receipts/buyers-with-dues", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const buyers = await storage.getBuyersWithDues(coldStorageId);
      res.json(buyers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch buyers with dues" });
    }
  });

  // Get farmers with outstanding dues from receivables
  app.get("/api/farmer-receivables-with-dues", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const farmers = await storage.getFarmerReceivablesWithDues(coldStorageId, year);
      res.json(farmers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch farmers with dues" });
    }
  });

  app.get("/api/cash-receipts", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const receipts = await storage.getCashReceipts(coldStorageId);
      res.json(receipts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cash receipts" });
    }
  });

  // Get distinct buyer names for Sales of Goods payer type (for autocomplete)
  app.get("/api/cash-receipts/sales-goods-buyers", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const buyers = await storage.getSalesGoodsBuyers(coldStorageId);
      res.json(buyers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sales of goods buyers" });
    }
  });

  // Get buyer-to-buyer transfers for cash flow history (salesHistory with transferToBuyerName set)
  app.get("/api/sales-history/buyer-transfers", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const allSales = await storage.getSalesHistory(coldStorageId);
      // Filter to include only records where a buyer-to-buyer transfer was made
      const buyerTransfers = allSales.filter(s => 
        s.clearanceType === 'transfer' && s.transferToBuyerName
      );
      res.json(buyerTransfers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch buyer transfers" });
    }
  });

  // Get sales with dues for a specific buyer (for buyer-to-buyer transfer)
  app.get("/api/sales-history/by-buyer/:buyerName", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const buyerName = decodeURIComponent(req.params.buyerName);
      const allSales = await storage.getSalesHistory(coldStorageId, { buyerName });
      // Filter to only include sales with dues (paymentStatus is 'due' or 'partial')
      const salesWithDues = allSales.filter(s => 
        (s.paymentStatus === 'due' || s.paymentStatus === 'partial') && 
        (s.dueAmount || 0) > 0
      );
      res.json(salesWithDues);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch buyer sales" });
    }
  });

  // Buyer-to-buyer transfer endpoint
  const buyerTransferSchema = z.object({
    saleId: z.string(),
    fromBuyerName: z.string(),
    toBuyerName: z.string(),
    amount: z.number().positive(),
    transferDate: z.string().transform((val) => new Date(val)),
    remarks: z.string().optional(),
  });

  app.post("/api/buyer-transfer", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = buyerTransferSchema.parse(req.body);
      
      // Get the sale to transfer
      const sales = await storage.getSalesHistory(coldStorageId);
      const sale = sales.find(s => s.id === validatedData.saleId);
      
      if (!sale) {
        return res.status(404).json({ error: "Sale not found" });
      }
      
      if ((sale.dueAmount || 0) < validatedData.amount) {
        return res.status(400).json({ error: "Transfer amount exceeds due amount" });
      }
      
      // Generate a transfer group ID to link related records
      const transferGroupId = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Generate a CF transaction ID for this buyer-to-buyer transfer (unique per cold store)
      const transferTransactionId = await generateSequentialId('cash_flow', coldStorageId);
      
      // Update the original sale: record transfer destination (liability transfer only, payment status unchanged)
      // Note: Transfer moves liability from one buyer to another, NOT an actual payment
      await storage.updateSalesHistoryForTransfer(validatedData.saleId, {
        clearanceType: 'transfer',
        transferToBuyerName: validatedData.toBuyerName,
        transferGroupId: transferGroupId,
        transferDate: validatedData.transferDate,
        transferRemarks: validatedData.remarks || null,
        transferTransactionId: transferTransactionId,
        // DO NOT update paymentStatus, paidAmount, or dueAmount - transfer is liability move, not payment
      });
      
      res.json({ 
        success: true, 
        message: "Transfer recorded successfully",
        transferGroupId,
        transferTransactionId
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid transfer data", details: error.errors });
      }
      console.error("Buyer transfer error:", error);
      res.status(500).json({ error: "Failed to record buyer transfer" });
    }
  });

  // Farmer to Buyer debt transfer schema
  const farmerToBuyerTransferSchema = z.object({
    farmerName: z.string().min(1),
    village: z.string().min(1),
    contactNumber: z.string().min(1),
    toBuyerName: z.string().min(1),
    amount: z.number().positive(),
    transferDate: z.string().transform((val) => new Date(val)),
    remarks: z.string().optional(),
  });

  app.post("/api/farmer-to-buyer-transfer", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = farmerToBuyerTransferSchema.parse(req.body);
      
      const result = await storage.createFarmerToBuyerTransfer({
        coldStorageId,
        farmerName: validatedData.farmerName,
        village: validatedData.village,
        contactNumber: validatedData.contactNumber,
        toBuyerName: validatedData.toBuyerName,
        amount: validatedData.amount,
        transferDate: validatedData.transferDate,
        remarks: validatedData.remarks || null,
      });
      
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid transfer data", details: error.errors });
      }
      console.error("Farmer to buyer transfer error:", error);
      res.status(500).json({ error: "Failed to record farmer to buyer transfer" });
    }
  });

  const createCashReceiptSchema = z.object({
    payerType: z.enum(["cold_merchant", "sales_goods", "kata", "others", "farmer"]),
    buyerName: z.string().optional(),
    farmerReceivableId: z.string().optional(),
    receiptType: z.enum(["cash", "account"]),
    accountType: z.enum(["limit", "current"]).optional(),
    accountId: z.string().optional(),
    amount: z.number().positive(),
    receivedAt: z.string().transform((val) => new Date(val)),
    notes: z.string().optional(),
  }).refine(
    (data) => data.receiptType !== "account" || data.accountId !== undefined || data.accountType !== undefined,
    { message: "Account is required when receipt type is account", path: ["accountId"] }
  ).refine(
    (data) => data.payerType === "kata" || data.payerType === "farmer" || (data.buyerName && data.buyerName.trim().length > 0),
    { message: "Buyer name is required for this payer type", path: ["buyerName"] }
  ).refine(
    (data) => data.payerType !== "farmer" || (data.farmerReceivableId && data.farmerReceivableId.trim().length > 0),
    { message: "Farmer receivable selection is required", path: ["farmerReceivableId"] }
  );

  app.post("/api/cash-receipts", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = createCashReceiptSchema.parse(req.body);
      
      // For farmer payer type, handle payment allocation to farmer receivable
      if (validatedData.payerType === "farmer" && validatedData.farmerReceivableId) {
        try {
          // Extract farmerDetails from request body if provided (for self-sale farmers)
          const farmerDetails = req.body.farmerDetails as { farmerName: string; contactNumber: string; village: string } | undefined;
          
          const result = await storage.createFarmerReceivablePayment({
            coldStorageId: coldStorageId,
            farmerReceivableId: validatedData.farmerReceivableId,
            farmerDetails: farmerDetails || null,
            buyerName: validatedData.buyerName || null,
            receiptType: validatedData.receiptType,
            accountType: validatedData.accountType || null,
            accountId: validatedData.accountId || null,
            amount: validatedData.amount,
            receivedAt: validatedData.receivedAt,
            notes: validatedData.notes || null,
          });
          return res.json(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to create farmer payment";
          return res.status(400).json({ error: message });
        }
      }
      
      const result = await storage.createCashReceiptWithFIFO({
        coldStorageId: coldStorageId,
        payerType: validatedData.payerType,
        buyerName: validatedData.payerType === "kata" ? null : (validatedData.buyerName || null),
        receiptType: validatedData.receiptType,
        accountType: validatedData.accountType || null,
        accountId: validatedData.accountId || null,
        amount: validatedData.amount,
        receivedAt: validatedData.receivedAt,
        notes: validatedData.notes || null,
      });
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid cash receipt data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create cash receipt" });
    }
  });

  // Expenses
  app.get("/api/expenses", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const expenseList = await storage.getExpenses(coldStorageId);
      res.json(expenseList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expenses" });
    }
  });

  // Get unique receiver names from previous expenses for autocomplete
  app.get("/api/expenses/receiver-names", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const expenseList = await storage.getExpenses(coldStorageId);
      // Extract unique receiver names
      const namesSet = new Set<string>();
      expenseList.forEach(e => {
        if (e.receiverName && e.receiverName.trim()) {
          namesSet.add(e.receiverName.trim());
        }
      });
      const receiverNames = Array.from(namesSet).sort();
      res.json(receiverNames);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch receiver names" });
    }
  });

  const createExpenseSchema = z.object({
    expenseType: z.enum(["salary", "hammali", "grading_charges", "general_expenses", "cost_of_goods_sold", "tds"]),
    receiverName: z.string().optional(),
    paymentMode: z.enum(["cash", "account"]),
    accountType: z.enum(["limit", "current"]).optional(),
    accountId: z.string().optional(),
    amount: z.number().positive(),
    paidAt: z.string().transform((val) => new Date(val)),
    remarks: z.string().optional(),
  }).refine((data) => {
    // accountId or accountType is required when paymentMode is 'account'
    if (data.paymentMode === "account" && !data.accountId && !data.accountType) {
      return false;
    }
    return true;
  }, { message: "Account is required when paymentMode is 'account'" });

  app.post("/api/expenses", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = createExpenseSchema.parse(req.body);
      const expense = await storage.createExpense({
        coldStorageId: coldStorageId,
        expenseType: validatedData.expenseType,
        receiverName: validatedData.receiverName?.trim() || null,
        paymentMode: validatedData.paymentMode,
        accountType: validatedData.paymentMode === "account" ? validatedData.accountType : null,
        accountId: validatedData.paymentMode === "account" ? validatedData.accountId : null,
        amount: validatedData.amount,
        paidAt: validatedData.paidAt,
        remarks: validatedData.remarks || null,
      });
      res.json(expense);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid expense data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create expense" });
    }
  });

  // Reverse cash receipt
  app.post("/api/cash-receipts/:id/reverse", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { id } = req.params;
      // Verify ownership
      const receipts = await storage.getCashReceipts(coldStorageId);
      const receipt = receipts.find(r => r.id === id);
      if (!receipt) {
        return res.status(404).json({ error: "Cash receipt not found" });
      }
      const result = await storage.reverseCashReceipt(id);
      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to reverse cash receipt" });
    }
  });

  // Reverse expense
  app.post("/api/expenses/:id/reverse", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { id } = req.params;
      // Verify ownership
      const expenseList = await storage.getExpenses(coldStorageId);
      const expense = expenseList.find(e => e.id === id);
      if (!expense) {
        return res.status(404).json({ error: "Expense not found" });
      }
      const result = await storage.reverseExpense(id);
      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to reverse expense" });
    }
  });

  // Cash Transfers (Self)
  app.get("/api/cash-transfers", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const transfers = await storage.getCashTransfers(coldStorageId);
      res.json(transfers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cash transfers" });
    }
  });

  const createCashTransferSchema = z.object({
    fromAccountType: z.string(),
    toAccountType: z.string(),
    fromAccountId: z.string().optional(),
    toAccountId: z.string().optional(),
    amount: z.number().positive(),
    transferredAt: z.string().transform((val) => new Date(val)),
    remarks: z.string().optional(),
  });

  app.post("/api/cash-transfers", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = createCashTransferSchema.parse(req.body);
      
      // Check that source and destination are different (use accountId if provided, fallback to accountType)
      const fromKey = validatedData.fromAccountId || validatedData.fromAccountType;
      const toKey = validatedData.toAccountId || validatedData.toAccountType;
      if (fromKey === toKey) {
        return res.status(400).json({ error: "Source and destination accounts must be different" });
      }
      
      const transfer = await storage.createCashTransfer({
        coldStorageId,
        ...validatedData,
      });
      res.json(transfer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid transfer data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create cash transfer" });
    }
  });

  // Reverse cash transfer
  app.post("/api/cash-transfers/:id/reverse", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { id } = req.params;
      // Verify ownership
      const transfers = await storage.getCashTransfers(coldStorageId);
      const transfer = transfers.find(t => t.id === id);
      if (!transfer) {
        return res.status(404).json({ error: "Cash transfer not found" });
      }
      const result = await storage.reverseCashTransfer(id);
      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to reverse cash transfer" });
    }
  });

  // ==================== DISCOUNT ROUTES ====================

  // Get farmers with outstanding dues
  app.get("/api/farmers-with-dues", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const farmers = await storage.getFarmersWithDues(coldStorageId);
      res.json(farmers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch farmers with dues" });
    }
  });

  // Get buyer dues for a specific farmer
  app.get("/api/buyer-dues", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { farmerName, village, contactNumber } = req.query;
      
      if (!farmerName || !village || !contactNumber) {
        return res.status(400).json({ error: "farmerName, village, and contactNumber are required" });
      }
      
      const buyers = await storage.getBuyerDuesForFarmer(
        coldStorageId,
        farmerName as string,
        village as string,
        contactNumber as string
      );
      res.json(buyers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch buyer dues" });
    }
  });

  // Get all discounts
  app.get("/api/discounts", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const discountList = await storage.getDiscounts(coldStorageId);
      res.json(discountList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch discounts" });
    }
  });

  // Create discount validation schema
  const createDiscountSchema = z.object({
    farmerName: z.string().min(1),
    village: z.string().min(1),
    contactNumber: z.string().min(1),
    totalAmount: z.number().positive(),
    discountDate: z.string().transform((val) => new Date(val)),
    remarks: z.string().optional(),
    buyerAllocations: z.array(z.object({
      buyerName: z.string().min(1),
      amount: z.number().positive(),
    })).min(1),
  });

  // Create discount
  app.post("/api/discounts", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = createDiscountSchema.parse(req.body);
      
      // Validate that allocations sum to totalAmount
      const allocationTotal = validatedData.buyerAllocations.reduce((sum, a) => sum + a.amount, 0);
      if (Math.abs(allocationTotal - validatedData.totalAmount) > 0.01) {
        return res.status(400).json({ 
          error: "Buyer allocations must sum to total discount amount",
          allocationTotal,
          expectedTotal: validatedData.totalAmount
        });
      }
      
      const result = await storage.createDiscountWithFIFO({
        coldStorageId,
        farmerName: validatedData.farmerName,
        village: validatedData.village,
        contactNumber: validatedData.contactNumber,
        totalAmount: validatedData.totalAmount,
        discountDate: validatedData.discountDate,
        remarks: validatedData.remarks || null,
        buyerAllocations: JSON.stringify(validatedData.buyerAllocations),
      });
      
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid discount data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create discount" });
    }
  });

  // Reverse discount
  app.post("/api/discounts/:id/reverse", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { id } = req.params;
      // Verify ownership
      const discountList = await storage.getDiscounts(coldStorageId);
      const discount = discountList.find(d => d.id === id);
      if (!discount) {
        return res.status(404).json({ error: "Discount not found" });
      }
      const result = await storage.reverseDiscount(id);
      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to reverse discount" });
    }
  });

  // Get discount allocated for a specific farmer+buyer combination
  app.get("/api/discounts/farmer-buyer", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { farmerName, village, contactNumber, buyerName } = req.query;
      
      if (!farmerName || !village || !contactNumber || !buyerName) {
        return res.status(400).json({ error: "Missing required parameters" });
      }
      
      const discountAmount = await storage.getDiscountForFarmerBuyer(
        coldStorageId,
        farmerName as string,
        village as string,
        contactNumber as string,
        buyerName as string
      );
      
      res.json({ discountAmount });
    } catch (error) {
      res.status(500).json({ error: "Failed to get discount" });
    }
  });

  // ==================== OPENING SETTINGS ROUTES ====================

  // Get opening balance for a specific year
  app.get("/api/opening-balances/:year", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const year = parseInt(req.params.year);
      if (isNaN(year)) {
        return res.status(400).json({ error: "Invalid year" });
      }
      const balance = await storage.getOpeningBalance(coldStorageId, year);
      res.json(balance || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to get opening balance" });
    }
  });

  // Upsert opening balance
  app.post("/api/opening-balances", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { year, cashInHand, limitBalance, currentBalance } = req.body;
      
      if (!year || typeof year !== 'number') {
        return res.status(400).json({ error: "Year is required" });
      }

      const balance = await storage.upsertOpeningBalance({
        coldStorageId,
        year,
        cashInHand: cashInHand || 0,
        limitBalance: limitBalance || 0,
        currentBalance: currentBalance || 0,
      });
      res.json(balance);
    } catch (error) {
      res.status(500).json({ error: "Failed to save opening balance" });
    }
  });

  // Get opening receivables for a specific year
  app.get("/api/opening-receivables/:year", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const year = parseInt(req.params.year);
      if (isNaN(year)) {
        return res.status(400).json({ error: "Invalid year" });
      }
      const receivables = await storage.getOpeningReceivables(coldStorageId, year);
      res.json(receivables);
    } catch (error) {
      res.status(500).json({ error: "Failed to get opening receivables" });
    }
  });

  // Create opening receivable
  app.post("/api/opening-receivables", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { year, payerType, buyerName, dueAmount, remarks, farmerName, contactNumber, village, tehsil, district, state } = req.body;
      
      if (!year || !payerType || !dueAmount) {
        return res.status(400).json({ error: "Year, payer type, and amount are required" });
      }

      // Validate farmer fields if payer type is farmer
      if (payerType === "farmer") {
        if (!farmerName || !contactNumber || !village || !district || !state) {
          return res.status(400).json({ error: "Farmer name, contact, village, district, and state are required for farmer type" });
        }
      }

      const receivable = await storage.createOpeningReceivable({
        coldStorageId,
        year,
        payerType,
        buyerName: buyerName || null,
        dueAmount,
        remarks: remarks || null,
        // Farmer-specific fields
        farmerName: farmerName || null,
        contactNumber: contactNumber || null,
        village: village || null,
        tehsil: tehsil || null,
        district: district || null,
        state: state || null,
      });

      // Trigger FIFO recomputation for cold_merchant type with buyer name
      // This ensures new receivables are integrated into the 3-pass FIFO allocation
      if (payerType === "cold_merchant" && buyerName) {
        await storage.recomputeBuyerPayments(buyerName, coldStorageId);
      }

      res.json(receivable);
    } catch (error) {
      res.status(500).json({ error: "Failed to create opening receivable" });
    }
  });

  // Delete opening receivable
  app.delete("/api/opening-receivables/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { id } = req.params;
      
      // Delete and get the receivable info for FIFO recomputation
      const deletedReceivable = await storage.deleteOpeningReceivable(id);

      // Trigger FIFO recomputation if this was a cold_merchant receivable with buyer name
      if (deletedReceivable && deletedReceivable.payerType === "cold_merchant" && deletedReceivable.buyerName) {
        await storage.recomputeBuyerPayments(deletedReceivable.buyerName, coldStorageId);
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete opening receivable" });
    }
  });

  // Get opening payables for a specific year
  app.get("/api/opening-payables/:year", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const year = parseInt(req.params.year);
      if (isNaN(year)) {
        return res.status(400).json({ error: "Invalid year" });
      }
      const payables = await storage.getOpeningPayables(coldStorageId, year);
      res.json(payables);
    } catch (error) {
      res.status(500).json({ error: "Failed to get opening payables" });
    }
  });

  // Create opening payable
  app.post("/api/opening-payables", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { year, expenseType, receiverName, dueAmount, remarks } = req.body;
      
      if (!year || !expenseType || !dueAmount) {
        return res.status(400).json({ error: "Year, expense type, and amount are required" });
      }

      const payable = await storage.createOpeningPayable({
        coldStorageId,
        year,
        expenseType,
        receiverName: receiverName || null,
        dueAmount,
        remarks: remarks || null,
      });
      res.json(payable);
    } catch (error) {
      res.status(500).json({ error: "Failed to create opening payable" });
    }
  });

  // Delete opening payable
  app.delete("/api/opening-payables/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      await storage.deleteOpeningPayable(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete opening payable" });
    }
  });

  // ==================== BANK ACCOUNTS ROUTES ====================

  // Get bank accounts for a year
  app.get("/api/bank-accounts/:year", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const year = parseInt(req.params.year);
      if (isNaN(year)) {
        return res.status(400).json({ error: "Invalid year" });
      }
      const accounts = await storage.getBankAccounts(coldStorageId, year);
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ error: "Failed to get bank accounts" });
    }
  });

  // Create bank account
  app.post("/api/bank-accounts", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { accountName, accountType, openingBalance, year } = req.body;
      
      if (!accountName || !accountType || !year) {
        return res.status(400).json({ error: "Account name, type, and year are required" });
      }
      
      const account = await storage.createBankAccount({
        coldStorageId,
        accountName,
        accountType,
        openingBalance: openingBalance || 0,
        year,
      });
      res.json(account);
    } catch (error) {
      res.status(500).json({ error: "Failed to create bank account" });
    }
  });

  // Update bank account
  app.patch("/api/bank-accounts/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const { accountName, accountType, openingBalance } = req.body;
      
      const account = await storage.updateBankAccount(id, {
        ...(accountName !== undefined && { accountName }),
        ...(accountType !== undefined && { accountType }),
        ...(openingBalance !== undefined && { openingBalance }),
      });
      
      if (!account) {
        return res.status(404).json({ error: "Bank account not found" });
      }
      res.json(account);
    } catch (error) {
      res.status(500).json({ error: "Failed to update bank account" });
    }
  });

  // Delete bank account
  app.delete("/api/bank-accounts/:id", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      await storage.deleteBankAccount(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete bank account" });
    }
  });

  // Recalculate all sales records to fix paidAmount/dueAmount
  app.post("/api/admin/recalculate-sales-charges", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const result = await storage.recalculateSalesCharges(coldStorageId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to recalculate sales charges" });
    }
  });

  // ==================== USER AUTH ROUTES ====================
  
  // Generate a simple random token
  const generateUserToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 64; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };

  // User login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { mobileNumber, password, captchaToken } = req.body;
      
      if (!mobileNumber || !password) {
        return res.status(400).json({ error: "Mobile number and password are required" });
      }

      // Verify CAPTCHA if secret key is configured (skip in development)
      const isDevelopment = process.env.NODE_ENV === 'development';
      if (process.env.RECAPTCHA_SECRET_KEY && !isDevelopment) {
        if (!captchaToken) {
          return res.status(400).json({ error: "CAPTCHA verification required" });
        }
        const captchaValid = await verifyCaptcha(captchaToken);
        if (!captchaValid) {
          return res.status(400).json({ error: "CAPTCHA verification failed. Please try again." });
        }
      }

      const result = await storage.authenticateUser(mobileNumber, password);
      
      if (!result) {
        return res.status(401).json({ error: "Invalid mobile number or password" });
      }

      // Check if cold storage is blocked (inactive or archived)
      if (result.blocked === 'inactive') {
        return res.status(403).json({ error: "This cold storage account is currently inactive. Please contact the administrator." });
      }
      if (result.blocked === 'archived') {
        return res.status(403).json({ error: "This cold storage account has been archived. Please contact the administrator." });
      }

      const token = generateUserToken();
      // Store session in database for persistence across server restarts
      await storage.createSession(token, result.user.id, result.coldStorage.id);

      // Return user info (excluding password) and cold storage details
      const { password: _, ...userWithoutPassword } = result.user;
      res.json({ 
        success: true, 
        token,
        user: userWithoutPassword,
        coldStorage: result.coldStorage
      });
    } catch (error) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Verify user session
  app.get("/api/auth/session", async (req, res) => {
    try {
      const token = req.headers['x-auth-token'] as string;
      
      if (!token) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getSession(token);
      
      if (!session) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUserById(session.userId);
      const coldStorage = await storage.getColdStorage(session.coldStorageId);

      if (!user || !coldStorage) {
        await storage.deleteSession(token);
        return res.status(401).json({ error: "Session invalid" });
      }

      // Update last accessed time
      await storage.updateSessionLastAccess(token);

      const { password: _, ...userWithoutPassword } = user;
      res.json({ 
        user: userWithoutPassword, 
        coldStorage 
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to verify session" });
    }
  });

  // User logout
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const token = req.headers['x-auth-token'] as string;
      if (token) {
        await storage.deleteSession(token);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Logout failed" });
    }
  });

  // Change password (user must be authenticated and provide current password)
  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const token = req.headers['x-auth-token'] as string;
      
      if (!token) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getSession(token);
      
      if (!session) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { userId, currentPassword, newPassword } = req.body;
      
      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 characters" });
      }
      
      // Verify user is changing their own password
      if (session.userId !== userId) {
        return res.status(403).json({ error: "Cannot change another user's password" });
      }

      // Get the user and verify current password
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.password !== currentPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      const success = await storage.resetUserPassword(userId, newPassword);
      
      if (!success) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // ==================== ADMIN ROUTES ====================
  
  // Admin password from environment variable (default: "admin123" for development)
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
  
  // Simple session token for admin (in-memory, resets on server restart)
  let adminSessionToken: string | null = null;
  
  // Generate a simple random token
  const generateToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };
  
  // Middleware to verify admin session
  const verifyAdminSession = (req: any, res: any, next: any) => {
    const token = req.headers['x-admin-token'];
    if (!token || token !== adminSessionToken) {
      return res.status(401).json({ error: "Unauthorized - please login" });
    }
    next();
  };

  // Admin login
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { password } = req.body;
      if (password === ADMIN_PASSWORD) {
        adminSessionToken = generateToken();
        res.json({ success: true, token: adminSessionToken });
      } else {
        res.status(401).json({ error: "Invalid password" });
      }
    } catch (error) {
      res.status(500).json({ error: "Login failed" });
    }
  });
  
  // Admin logout
  app.post("/api/admin/logout", (req, res) => {
    adminSessionToken = null;
    res.json({ success: true });
  });

  // Get all cold storages (protected)
  app.get("/api/admin/cold-storages", verifyAdminSession, async (req, res) => {
    try {
      const coldStorages = await storage.getAllColdStorages();
      res.json(coldStorages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cold storages" });
    }
  });

  // Create cold storage (only name and address fields - capacity/rates set from dashboard)
  const createColdStorageSchema = z.object({
    name: z.string().min(1, "Name is required"),
    address: z.string().optional(),
    tehsil: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    linkedPhones: z.array(z.string()).optional(),
  });

  app.post("/api/admin/cold-storages", verifyAdminSession, async (req, res) => {
    try {
      const validated = createColdStorageSchema.parse(req.body);
      // Add default values for capacity and rates (user will configure from dashboard)
      const coldStorage = await storage.createColdStorage({
        ...validated,
        linkedPhones: validated.linkedPhones || [],
        totalCapacity: 10000,
        waferRate: 50,
        seedRate: 55,
      });
      res.status(201).json(coldStorage);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create cold storage" });
    }
  });

  // Update cold storage (protected - only name and address fields, no capacity/rates)
  const updateColdStorageSchema = z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    tehsil: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
  });
  
  app.patch("/api/admin/cold-storages/:id", verifyAdminSession, async (req, res) => {
    try {
      const validated = updateColdStorageSchema.parse(req.body);
      const updated = await storage.updateColdStorage(req.params.id, validated);
      if (!updated) {
        return res.status(404).json({ error: "Cold storage not found" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update cold storage" });
    }
  });

  // Archive cold storage (protected) - no data deletion
  app.delete("/api/admin/cold-storages/:id", verifyAdminSession, async (req, res) => {
    try {
      await storage.archiveColdStorage(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to archive cold storage" });
    }
  });

  // Update cold storage status (inactive/active/archived)
  app.post("/api/admin/cold-storages/:id/status", verifyAdminSession, async (req, res) => {
    try {
      const { status, adminPassword } = req.body;
      if (!['active', 'inactive', 'archived'].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      // Verify admin password
      const expectedPassword = process.env.ADMIN_PASSWORD || "admin123";
      if (adminPassword !== expectedPassword) {
        return res.status(401).json({ error: "Invalid admin password" });
      }
      await storage.updateColdStorageStatus(req.params.id, status);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update cold storage status" });
    }
  });

  // Reset cold storage (factory reset - deletes all data)
  app.post("/api/admin/cold-storages/:id/reset", verifyAdminSession, async (req, res) => {
    try {
      const { adminPassword } = req.body;
      // Verify admin password
      const expectedPassword = process.env.ADMIN_PASSWORD || "admin123";
      if (adminPassword !== expectedPassword) {
        return res.status(401).json({ error: "Invalid admin password" });
      }
      await storage.resetColdStorage(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset cold storage" });
    }
  });

  // Get users for a cold storage (protected)
  app.get("/api/admin/cold-storages/:coldStorageId/users", verifyAdminSession, async (req, res) => {
    try {
      const users = await storage.getColdStorageUsers(req.params.coldStorageId);
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Create user for a cold storage
  const createUserSchema = z.object({
    name: z.string().min(1, "Name is required"),
    mobileNumber: z.string().regex(/^\d{10}$/, "Mobile number must be 10 digits"),
    password: z.string().min(4, "Password must be at least 4 characters"),
    accessType: z.enum(["view", "edit"]),
  });

  app.post("/api/admin/cold-storages/:coldStorageId/users", verifyAdminSession, async (req, res) => {
    try {
      const validated = createUserSchema.parse(req.body);
      const user = await storage.createColdStorageUser({
        ...validated,
        coldStorageId: req.params.coldStorageId,
      });
      res.status(201).json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // Update user (protected)
  const updateUserSchema = z.object({
    name: z.string().optional(),
    mobileNumber: z.string().regex(/^\d{10}$/).optional(),
    accessType: z.enum(["view", "edit"]).optional(),
  });
  
  app.patch("/api/admin/users/:id", verifyAdminSession, async (req, res) => {
    try {
      const validated = updateUserSchema.parse(req.body);
      const updated = await storage.updateColdStorageUser(req.params.id, validated);
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Delete user (protected)
  app.delete("/api/admin/users/:id", verifyAdminSession, async (req, res) => {
    try {
      await storage.deleteColdStorageUser(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Reset user password (protected)
  app.post("/api/admin/users/:id/reset-password", verifyAdminSession, async (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 characters" });
      }
      const success = await storage.resetUserPassword(req.params.id, newPassword);
      if (!success) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ===== EXPORT ENDPOINTS =====
  
  const exportQuerySchema = z.object({
    fromDate: z.string(),
    toDate: z.string(),
    language: z.enum(["en", "hi"]).optional().default("en"),
    downloadToken: z.string().optional(),
  });

  // In-memory store for short-lived download tokens (single-use, 60 second expiry)
  const downloadTokens = new Map<string, { coldStorageId: string; userId: string; expiresAt: number }>();

  // Generate a download token (valid for 60 seconds, single-use)
  app.post("/api/export/token", requireAuth, async (req: AuthenticatedRequest, res) => {
    const coldStorageId = getColdStorageId(req);
    const userId = req.authContext?.userId || "";
    const downloadToken = randomUUID();
    
    downloadTokens.set(downloadToken, {
      coldStorageId,
      userId,
      expiresAt: Date.now() + 60000, // 60 seconds
    });
    
    // Clean up expired tokens
    const tokensToDelete: string[] = [];
    downloadTokens.forEach((data, token) => {
      if (data.expiresAt < Date.now()) {
        tokensToDelete.push(token);
      }
    });
    tokensToDelete.forEach(token => downloadTokens.delete(token));
    
    res.json({ downloadToken });
  });

  // Middleware for export that accepts download token from query param (for mobile download)
  const requireExportAuth = async (req: Request, res: Response, next: NextFunction) => {
    // First try header-based auth
    const headerToken = req.headers["x-auth-token"] as string;
    if (headerToken) {
      const session = await storage.getSession(headerToken);
      if (session) {
        // Validate user still exists and is active
        const user = await storage.getUserById(session.userId);
        if (user) {
          (req as AuthenticatedRequest).authContext = {
            userId: user.id,
            coldStorageId: user.coldStorageId,
            userName: user.name,
            accessType: user.accessType,
          };
          return next();
        }
      }
    }
    
    // Then try download token from query param
    const downloadToken = req.query.downloadToken as string;
    if (downloadToken) {
      const tokenData = downloadTokens.get(downloadToken);
      if (tokenData && tokenData.expiresAt > Date.now()) {
        // Single-use: delete token after use
        downloadTokens.delete(downloadToken);
        
        // Validate user still exists and is active
        const user = await storage.getUserById(tokenData.userId);
        if (user) {
          (req as AuthenticatedRequest).authContext = {
            userId: user.id,
            coldStorageId: user.coldStorageId,
            userName: user.name,
            accessType: user.accessType,
          };
          return next();
        }
      }
    }
    
    return res.status(401).json({ error: "Authentication required" });
  };

  // Helper to format date for CSV
  const formatDateForExport = (date: Date | null | undefined): string => {
    if (!date) return "";
    return new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  // Helper to escape CSV values
  const escapeCSV = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Export Lots Data
  app.get("/api/export/lots", requireExportAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { fromDate, toDate, language } = exportQuerySchema.parse(req.query);
      
      const from = new Date(fromDate);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);

      const lots = await storage.getLotsForExport(coldStorageId, from, to);
      const chambers = await storage.getChambers(coldStorageId);
      const coldStorage = await storage.getColdStorage(coldStorageId);
      const chamberMap = new Map(chambers.map(c => [c.id, c.name]));

      // Calculate expected cold charge based on bag type and charge unit
      // Note: "Ration" bagType uses seed rates (same as UI logic)
      const calculateExpectedCharge = (lot: typeof lots[0]) => {
        if (!coldStorage) return 0;
        const coldChargeRate = (lot.bagType === "wafer" ? coldStorage.waferColdCharge : coldStorage.seedColdCharge) || 0;
        const hammaliRate = (lot.bagType === "wafer" ? coldStorage.waferHammali : coldStorage.seedHammali) || 0;
        // For quintal mode: cold charge (per quintal) + hammali (per bag)
        // For bag mode: (coldCharge + hammali) × lot.size
        if (coldStorage.chargeUnit === "quintal") {
          const coldChargeQuintal = lot.netWeight ? (lot.netWeight * coldChargeRate) / 100 : 0;
          const hammaliPerBag = lot.size * hammaliRate;
          return coldChargeQuintal + hammaliPerBag;
        }
        return lot.size * (coldChargeRate + hammaliRate);
      };

      // Column headers (English / Hindi)
      // "Potato Type" = wafer/seed/Ration classification, "Potato Variety" = CS1/CS3/etc., "Bag Type" = custom label (bagTypeLabel)
      const headers = language === "hi" 
        ? ["तारीख", "लॉट नंबर", "किसान का नाम", "मोबाइल", "गाँव", "तहसील", "जिला", "राज्य", "चैम्बर", "फ्लोर", "पोजीशन", "आलू प्रकार", "बैग का प्रकार", "कुल बोरे", "बचे हुए बोरे", "आलू किस्म", "गुणवत्ता", "आलू का आकार", "प्रारंभिक नेट वजन (Kg)", "अपेक्षित कोल्ड शुल्क", "भुगतान किया गया शुल्क", "बकाया शुल्क", "बेस कोल्ड चार्ज बिल्ड", "टिप्पणी", "स्थिति"]
        : ["Date", "Lot #", "Farmer Name", "Mobile", "Village", "Tehsil", "District", "State", "Chamber", "Floor", "Position", "Potato Type", "Bag Type", "Total Bags", "Remaining Bags", "Potato Variety", "Quality", "Potato Size", "Initial Net Weight (Kg)", "Expected Cold Charges", "Charges Paid", "Charges Due", "Base Cold Charges Billed", "Remarks", "Status"];

      const csvRows = [headers.map(escapeCSV).join(",")];
      
      for (const lot of lots) {
        const expectedCharge = calculateExpectedCharge(lot);
        const chargesPaid = lot.totalPaidCharge || 0;
        const chargesDue = lot.totalDueCharge || 0;
        const baseBilledTag = lot.baseColdChargesBilled === 1 
          ? (language === "hi" ? "हाँ" : "Yes") 
          : (language === "hi" ? "नहीं" : "No");
        
        const row = [
          formatDateForExport(lot.createdAt),
          lot.entrySequence || lot.lotNo,
          lot.farmerName,
          lot.contactNumber,
          lot.village,
          lot.tehsil,
          lot.district,
          lot.state,
          chamberMap.get(lot.chamberId) || "",
          lot.floor,
          lot.position,
          lot.bagType,
          lot.bagTypeLabel || "",
          lot.size,
          lot.remainingSize,
          lot.type,
          lot.quality,
          lot.potatoSize,
          lot.netWeight || "",
          expectedCharge.toFixed(2),
          chargesPaid.toFixed(2),
          chargesDue.toFixed(2),
          baseBilledTag,
          lot.remarks || "",
          lot.saleStatus,
        ];
        csvRows.push(row.map(escapeCSV).join(","));
      }

      const csv = csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="lots_${fromDate}_to_${toDate}.csv"`);
      res.send("\uFEFF" + csv); // BOM for Excel UTF-8 support
    } catch (error) {
      console.error("Export lots error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid date range" });
      }
      res.status(500).json({ error: "Failed to export lots" });
    }
  });

  // Export Sales History
  app.get("/api/export/sales", requireExportAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { fromDate, toDate, language } = exportQuerySchema.parse(req.query);
      
      // Parse additional optional filter parameters
      const year = req.query.year as string | undefined;
      const farmerName = req.query.farmerName as string | undefined;
      const village = req.query.village as string | undefined;
      const contactNumber = req.query.contactNumber as string | undefined;
      const buyerName = req.query.buyerName as string | undefined;
      const paymentStatus = req.query.paymentStatus as string | undefined;
      
      const from = new Date(fromDate);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);

      const sales = await storage.getSalesForExport(coldStorageId, from, to, {
        year,
        farmerName,
        village,
        contactNumber,
        buyerName,
        paymentStatus,
      });

      // "Potato Type" = wafer/seed/Ration classification, "Bag Type" = custom label (bagTypeLabel)
      const headers = language === "hi"
        ? ["बिक्री तिथि", "प्रवेश तिथि", "लॉट नंबर", "कोल्ड स्टोरेज बिल", "बिक्री बिल", "किसान का नाम", "मोबाइल", "गाँव", "खरीदार का नाम", "ट्रांसफर टू खरीदार", "चैम्बर", "फ्लोर", "पोजीशन", "आलू प्रकार", "बैग का प्रकार", "मूल बोरे", "बेचे गए बोरे", "कोल्ड चार्ज/बोरी", "हम्माली/बोरी", "कुल दर/बोरी", "कुल बिल शुल्क", "प्रवेश कटौती", "काटा चार्ज", "अतिरिक्त हम्माली", "ग्रेडिंग चार्ज", "आधार कोल्ड शुल्क", "कुल हम्माली", "भुगतान स्थिति", "भुगतान राशि", "बकाया राशि", "व्यापारी को हम्माली", "व्यापारी को ग्रेडिंग", "व्यापारी को अन्य", "व्यापारी अतिरिक्त बकाया", "नेट वजन (Kg)", "दर/Kg"]
        : ["Sale Date", "Entry Date", "Lot #", "CS Bill #", "Sales Bill #", "Farmer Name", "Mobile", "Village", "Buyer Name", "Transfer To Buyer", "Chamber", "Floor", "Position", "Potato Type", "Bag Type", "Original Bags", "Bags Sold", "Cold Charge/Bag", "Hammali/Bag", "Total Rate/Bag", "Total Billed Charges", "Entry Deductions", "Kata Charges", "Extra Hammali", "Grading Charges", "Base Cold Charges", "Total Hammali", "Payment Status", "Paid Amount", "Due Amount", "Hammali To Merchant", "Grading To Merchant", "Other To Merchant", "Total Extra Due To Merchant", "Net Weight (Kg)", "Rate/Kg"];

      const csvRows = [headers.map(escapeCSV).join(",")];
      
      for (const sale of sales) {
        // coldStorageCharge already includes base charges + all extras (but NOT extraDueToMerchant)
        const totalCharges = sale.coldStorageCharge || 0;
        
        // Calculate Total Hammali: base hammali + extra hammali (bilty cut) + extra hammali to merchant
        const extras = (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
        const baseChargesTotal = (sale.coldStorageCharge || 0) - extras;
        let baseHammali = 0;
        if (sale.coldCharge && sale.hammali) {
          const totalRate = sale.coldCharge + sale.hammali;
          if (totalRate > 0) {
            baseHammali = (baseChargesTotal * sale.hammali) / totalRate;
          }
        }
        const totalHammali = baseHammali + (sale.extraHammali || 0) + (sale.extraDueHammaliMerchant || 0);
        
        // Proportional entry deductions using shared helper
        const proportionalDeductions = calculateProportionalEntryDeductions({
          quantitySold: sale.quantitySold,
          originalLotSize: sale.originalLotSize || 1,
          advanceDeduction: sale.advanceDeduction || 0,
          freightDeduction: sale.freightDeduction || 0,
          otherDeduction: sale.otherDeduction || 0,
        });
        
        const row = [
          formatDateForExport(sale.soldAt),
          formatDateForExport(sale.entryDate),
          sale.lotNo,
          sale.coldStorageBillNumber || "",
          sale.salesBillNumber || "",
          sale.farmerName,
          sale.contactNumber,
          sale.village,
          sale.buyerName || "",
          sale.transferToBuyerName || "",
          sale.chamberName,
          sale.floor,
          sale.position,
          sale.bagType,
          sale.bagTypeLabel || "",
          sale.originalLotSize,
          sale.quantitySold,
          sale.coldCharge || "",
          sale.hammali || "",
          sale.pricePerBag,
          sale.coldStorageCharge,
          proportionalDeductions > 0 ? proportionalDeductions.toFixed(1) : "",
          sale.kataCharges || 0,
          sale.extraHammali || 0,
          sale.gradingCharges || 0,
          baseChargesTotal,
          totalHammali.toFixed(2),
          sale.paymentStatus,
          sale.paidAmount || 0,
          totalCharges - (sale.paidAmount || 0),
          sale.extraDueHammaliMerchant || 0,
          sale.extraDueGradingMerchant || 0,
          sale.extraDueOtherMerchant || 0,
          sale.extraDueToMerchant || 0,
          sale.netWeight || "",
          sale.pricePerKg || "",
        ];
        csvRows.push(row.map(escapeCSV).join(","));
      }

      const csv = csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="sales_${fromDate}_to_${toDate}.csv"`);
      res.send("\uFEFF" + csv);
    } catch (error) {
      console.error("Export sales error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid date range" });
      }
      res.status(500).json({ error: "Failed to export sales" });
    }
  });

  // Export Cash Management Data
  app.get("/api/export/cash", requireExportAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { fromDate, toDate, language } = exportQuerySchema.parse(req.query);
      
      const from = new Date(fromDate);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);

      const { receipts, expenses, transfers } = await storage.getCashDataForExport(coldStorageId, from, to);

      // Headers with all columns for all types (Transaction ID first)
      const headers = language === "hi"
        ? ["ट्रांज़ैक्शन आईडी", "तारीख", "प्रकार", "भुगतानकर्ता प्रकार", "खरीदार/प्राप्तकर्ता का नाम", "खर्च प्रकार", "भुगतान मोड", "खाता प्रकार", "से खाता", "में खाता", "राशि", "नोट्स/टिप्पणी", "स्थिति", "रद्द तारीख"]
        : ["Transaction ID", "Date", "Type", "Payer Type", "Buyer/Receiver Name", "Expense Type", "Payment Mode", "Account Type", "From Account", "To Account", "Amount", "Notes/Remarks", "Status", "Reversal Date"];

      // Payer type labels
      const payerTypeMap: Record<string, { en: string; hi: string }> = {
        cold_merchant: { en: "Cold Merchant", hi: "कोल्ड व्यापारी" },
        sales_goods: { en: "Sales Goods", hi: "बिक्री माल" },
        kata: { en: "Kata", hi: "काटा" },
        others: { en: "Others", hi: "अन्य" },
      };

      // Expense type labels
      const expenseTypeMap: Record<string, { en: string; hi: string }> = {
        salary: { en: "Salary", hi: "वेतन" },
        hammali: { en: "Hammali", hi: "हम्माली" },
        grading_charges: { en: "Grading Charges", hi: "ग्रेडिंग चार्ज" },
        general_expenses: { en: "General Expenses", hi: "सामान्य खर्च" },
      };

      // Account type labels
      const accountTypeMap: Record<string, { en: string; hi: string }> = {
        cash: { en: "Cash", hi: "नकद" },
        limit: { en: "Limit Account", hi: "लिमिट खाता" },
        current: { en: "Current Account", hi: "चालू खाता" },
      };

      // Combine and sort by transactionId descending
      interface CashEntry {
        transactionId: string;
        date: Date;
        type: string;
        payerType: string;
        buyerReceiverName: string;
        expenseType: string;
        paymentMode: string;
        accountType: string;
        fromAccount: string;
        toAccount: string;
        amount: number;
        notes: string;
        status: string;
        reversalDate: string;
      }
      const allEntries: CashEntry[] = [];
      
      // Process receipts (Inward)
      for (const r of receipts) {
        const isReversed = r.isReversed === 1;
        const payerLabel = payerTypeMap[r.payerType] || { en: r.payerType, hi: r.payerType };
        const accountLabel = r.receiptType === "account" && r.accountType 
          ? (accountTypeMap[r.accountType] || { en: r.accountType, hi: r.accountType })
          : { en: "", hi: "" };
        
        allEntries.push({
          transactionId: r.transactionId || "",
          date: new Date(r.receivedAt),
          type: language === "hi" ? "आवक" : "Inward",
          payerType: language === "hi" ? payerLabel.hi : payerLabel.en,
          buyerReceiverName: r.buyerName || "",
          expenseType: "",
          paymentMode: r.receiptType === "cash" ? (language === "hi" ? "नकद" : "Cash") : (language === "hi" ? "खाता" : "Account"),
          accountType: language === "hi" ? accountLabel.hi : accountLabel.en,
          fromAccount: "",
          toAccount: "",
          amount: r.amount,
          notes: r.notes || "",
          status: isReversed ? (language === "hi" ? "रद्द" : "Reversed") : (language === "hi" ? "सक्रिय" : "Active"),
          reversalDate: isReversed && r.reversedAt ? formatDateForExport(new Date(r.reversedAt)) : "",
        });
      }
      
      // Process expenses (Expense)
      for (const e of expenses) {
        const isReversed = e.isReversed === 1;
        const expenseLabel = expenseTypeMap[e.expenseType] || { en: e.expenseType, hi: e.expenseType };
        const accountLabel = e.paymentMode === "account" && e.accountType 
          ? (accountTypeMap[e.accountType] || { en: e.accountType, hi: e.accountType })
          : { en: "", hi: "" };
        
        allEntries.push({
          transactionId: e.transactionId || "",
          date: new Date(e.paidAt),
          type: language === "hi" ? "खर्च" : "Expense",
          payerType: "",
          buyerReceiverName: e.receiverName || "",
          expenseType: language === "hi" ? expenseLabel.hi : expenseLabel.en,
          paymentMode: e.paymentMode === "cash" ? (language === "hi" ? "नकद" : "Cash") : (language === "hi" ? "खाता" : "Account"),
          accountType: language === "hi" ? accountLabel.hi : accountLabel.en,
          fromAccount: "",
          toAccount: "",
          amount: e.amount,
          notes: e.remarks || "",
          status: isReversed ? (language === "hi" ? "रद्द" : "Reversed") : (language === "hi" ? "सक्रिय" : "Active"),
          reversalDate: isReversed && e.reversedAt ? formatDateForExport(new Date(e.reversedAt)) : "",
        });
      }

      // Process transfers (Self Transfer)
      for (const t of transfers) {
        const isReversed = t.isReversed === 1;
        const fromLabel = accountTypeMap[t.fromAccountType] || { en: t.fromAccountType, hi: t.fromAccountType };
        const toLabel = accountTypeMap[t.toAccountType] || { en: t.toAccountType, hi: t.toAccountType };
        
        allEntries.push({
          transactionId: t.transactionId || "",
          date: new Date(t.transferredAt),
          type: language === "hi" ? "स्व-स्थानांतरण" : "Self Transfer",
          payerType: "",
          buyerReceiverName: "",
          expenseType: "",
          paymentMode: "",
          accountType: "",
          fromAccount: language === "hi" ? fromLabel.hi : fromLabel.en,
          toAccount: language === "hi" ? toLabel.hi : toLabel.en,
          amount: t.amount,
          notes: t.remarks || "",
          status: isReversed ? (language === "hi" ? "रद्द" : "Reversed") : (language === "hi" ? "सक्रिय" : "Active"),
          reversalDate: isReversed && t.reversedAt ? formatDateForExport(new Date(t.reversedAt)) : "",
        });
      }

      // Sort by transactionId descending (latest first)
      // Format: CF + YYYYMMDD + natural number (e.g., CF2026012210)
      allEntries.sort((a, b) => {
        const aId = a.transactionId || "";
        const bId = b.transactionId || "";
        
        // If both have transactionId, compare them properly
        if (aId && bId) {
          const aDatePart = aId.slice(2, 10);
          const bDatePart = bId.slice(2, 10);
          if (bDatePart !== aDatePart) {
            return bDatePart.localeCompare(aDatePart);
          }
          // Same date, compare counter (descending)
          const aCounter = parseInt(aId.slice(10), 10) || 0;
          const bCounter = parseInt(bId.slice(10), 10) || 0;
          return bCounter - aCounter;
        }
        
        // If only one has transactionId, prioritize it
        if (aId && !bId) return -1;
        if (!aId && bId) return 1;
        
        // Fallback to date comparison
        return b.date.getTime() - a.date.getTime();
      });

      const csvRows = [headers.map(escapeCSV).join(",")];
      
      for (const entry of allEntries) {
        const row = [
          entry.transactionId,
          formatDateForExport(entry.date),
          entry.type,
          entry.payerType,
          entry.buyerReceiverName,
          entry.expenseType,
          entry.paymentMode,
          entry.accountType,
          entry.fromAccount,
          entry.toAccount,
          entry.amount,
          entry.notes,
          entry.status,
          entry.reversalDate,
        ];
        csvRows.push(row.map(escapeCSV).join(","));
      }

      const csv = csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="cash_${fromDate}_to_${toDate}.csv"`);
      res.send("\uFEFF" + csv);
    } catch (error) {
      console.error("Export cash error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid date range" });
      }
      res.status(500).json({ error: "Failed to export cash data" });
    }
  });

  return httpServer;
}
