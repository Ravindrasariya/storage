import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { lotFormSchema, insertChamberFloorSchema } from "@shared/schema";
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
      const lots = await storage.getAllLots(coldStorageId);
      res.json(lots);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lots" });
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
      type: z.string().min(1),
      bagType: z.enum(["wafer", "seed", "Ration"]),
      chamberId: z.string().min(1),
      floor: z.number().int().positive(),
      position: z.string().min(1),
      quality: z.enum(["poor", "medium", "good"]),
      potatoSize: z.enum(["large", "small"]).default("large"),
      assayingType: z.string().min(1),
      assayerImage: z.string().optional(),
      reducingSugar: z.number().optional(),
      dm: z.number().optional(),
      remarks: z.string().optional(),
    })).min(1),
  });

  app.post("/api/lots/batch", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { farmer, lots: lotDataArray } = batchLotSchema.parse(req.body);
      
      // Prepare lots with farmer data (lotNo will be auto-assigned by storage)
      const lotsToCreate = lotDataArray.map(lotData => ({
        ...farmer,
        ...lotData,
        lotNo: "", // Will be set by createBatchLots
        coldStorageId: coldStorageId,
        remainingSize: lotData.size,
      }));
      
      const result = await storage.createBatchLots(lotsToCreate, coldStorageId);
      
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
      const nextSequence = coldStorage?.nextEntryBillNumber ?? 1;
      res.json({ nextSequence });
    } catch (error) {
      res.status(500).json({ error: "Failed to get next entry sequence" });
    }
  });

  app.get("/api/lots/search", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const { type, query, lotNo, size, quality, paymentDue } = req.query;
      
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
        lots = await storage.searchLotsByFarmerName(
          query as string,
          coldStorageId
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
      
      // Apply payment due filter (lots that are sold with payment status "due")
      if (paymentDue === "true") {
        lots = lots.filter((lot) => lot.saleStatus === "sold" && lot.paymentStatus === "due");
      }
      
      // Sort by lot number in ascending order
      lots = lots.sort((a, b) => parseInt(a.lotNo, 10) - parseInt(b.lotNo, 10));
      
      res.json(lots);
    } catch (error) {
      res.status(500).json({ error: "Failed to search lots" });
    }
  });

  // Get all lots with the same entry sequence (for printing entry receipt)
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
    floor: z.number().int().positive().optional(),
    position: z.string().optional(),
    quality: z.enum(["poor", "medium", "good"]).optional(),
    // Allow upForSale for toggle functionality
    upForSale: z.number().int().min(0).max(1).optional(),
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
      
      // Only create edit history if location/quality fields are being changed (not just upForSale toggle)
      const isLocationOrQualityEdit = validated.chamberId !== undefined || 
                                       validated.floor !== undefined || 
                                       validated.position !== undefined || 
                                       validated.quality !== undefined;

      const previousData = {
        chamberId: lot.chamberId,
        floor: lot.floor,
        position: lot.position,
        quality: lot.quality,
      };

      const updatedLot = await storage.updateLot(req.params.id, validated);

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

      const { quantitySold, pricePerBag, paymentStatus, paymentMode, buyerName, pricePerKg, paidAmount, dueAmount, position, kataCharges, extraHammali, gradingCharges, netWeight, customColdCharge, customHammali } = req.body;

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
      // Wafer and Ration bags use wafer rates, Seed bags use seed rates
      const coldStorage = await storage.getColdStorage(lot.coldStorageId);
      const useWaferRates = lot.bagType === "wafer" || lot.bagType === "Ration";
      
      // Use custom rates if provided, otherwise use cold storage defaults
      const defaultRate = coldStorage ? (useWaferRates ? coldStorage.waferRate : coldStorage.seedRate) : 0;
      const defaultHammali = coldStorage ? (useWaferRates ? (coldStorage.waferHammali || 0) : (coldStorage.seedHammali || 0)) : 0;
      const defaultColdCharge = defaultRate - defaultHammali;
      
      const hammaliRate = customHammali !== undefined ? customHammali : defaultHammali;
      const coldChargeRate = customColdCharge !== undefined ? customColdCharge : defaultColdCharge;
      const rate = coldChargeRate + hammaliRate;
      const storageCharge = quantitySold * rate;
      
      // Calculate total charge including all extra charges for lot tracking
      const kata = kataCharges || 0;
      const extraHammaliTotal = extraHammali || 0;
      const grading = gradingCharges || 0;
      const totalChargeForLot = storageCharge + kata + extraHammaliTotal + grading;

      const updateData: { 
        remainingSize: number; 
        totalPaidCharge?: number; 
        totalDueCharge?: number;
      } = {
        remainingSize: newRemainingSize,
      };
      
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
        quality: lot.quality,
        originalLotSize: lot.size,
        saleType: "partial",
        quantitySold,
        pricePerBag: rate,
        coldCharge: coldChargeRate,
        hammali: hammaliRate,
        coldStorageCharge: storageCharge,
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

      const updatedLot = await storage.getLot(req.params.id);
      res.json(updatedLot);
    } catch (error) {
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
      const { year, farmerName, contactNumber, paymentStatus, buyerName } = req.query;
      
      const filters: {
        year?: number;
        farmerName?: string;
        contactNumber?: string;
        paymentStatus?: "paid" | "due";
        buyerName?: string;
      } = {};
      
      if (year) filters.year = parseInt(year as string);
      if (farmerName) filters.farmerName = farmerName as string;
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
      
      const updated = await storage.updateSalesHistory(req.params.id, validatedData);
      if (!updated) {
        return res.status(404).json({ error: "Sale not found" });
      }
      
      // Log changes to edit history
      if (currentSale) {
        const fieldsToTrack = ['buyerName', 'pricePerKg', 'paymentStatus', 'paidAmount', 'dueAmount', 'paymentMode', 'netWeight', 'coldCharge', 'hammali', 'kataCharges', 'extraHammali', 'gradingCharges', 'coldStorageCharge'] as const;
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
      const result = await storage.reverseSale(req.params.id);
      if (!result.success) {
        const statusCode = result.errorType === "not_found" ? 404 : 400;
        return res.status(statusCode).json({ error: result.message });
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

  app.get("/api/cash-receipts", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const receipts = await storage.getCashReceipts(coldStorageId);
      res.json(receipts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cash receipts" });
    }
  });

  const createCashReceiptSchema = z.object({
    buyerName: z.string().min(1),
    receiptType: z.enum(["cash", "account"]),
    amount: z.number().positive(),
    receivedAt: z.string().transform((val) => new Date(val)),
    notes: z.string().optional(),
  });

  app.post("/api/cash-receipts", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = createCashReceiptSchema.parse(req.body);
      const result = await storage.createCashReceiptWithFIFO({
        coldStorageId: coldStorageId,
        buyerName: validatedData.buyerName,
        receiptType: validatedData.receiptType,
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

  const createExpenseSchema = z.object({
    expenseType: z.enum(["salary", "hammali", "grading_charges", "general_expenses"]),
    paymentMode: z.enum(["cash", "account"]),
    amount: z.number().positive(),
    paidAt: z.string().transform((val) => new Date(val)),
    remarks: z.string().optional(),
  });

  app.post("/api/expenses", requireAuth, requireEditAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const coldStorageId = getColdStorageId(req);
      const validatedData = createExpenseSchema.parse(req.body);
      const expense = await storage.createExpense({
        coldStorageId: coldStorageId,
        expenseType: validatedData.expenseType,
        paymentMode: validatedData.paymentMode,
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

      // Verify CAPTCHA if secret key is configured
      if (process.env.RECAPTCHA_SECRET_KEY) {
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

  // Delete cold storage (protected)
  app.delete("/api/admin/cold-storages/:id", verifyAdminSession, async (req, res) => {
    try {
      await storage.deleteColdStorage(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete cold storage" });
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
      const chamberMap = new Map(chambers.map(c => [c.id, c.name]));

      // Column headers (English / Hindi)
      const headers = language === "hi" 
        ? ["तारीख", "लॉट नंबर", "किसान का नाम", "मोबाइल", "गाँव", "तहसील", "जिला", "राज्य", "चैम्बर", "फ्लोर", "पोजीशन", "बैग का प्रकार", "कुल बोरे", "बचे हुए बोरे", "आलू का प्रकार", "गुणवत्ता", "आलू का आकार", "टिप्पणी", "स्थिति"]
        : ["Date", "Lot #", "Farmer Name", "Mobile", "Village", "Tehsil", "District", "State", "Chamber", "Floor", "Position", "Bag Type", "Total Bags", "Remaining Bags", "Potato Type", "Quality", "Potato Size", "Remarks", "Status"];

      const csvRows = [headers.map(escapeCSV).join(",")];
      
      for (const lot of lots) {
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
          lot.size,
          lot.remainingSize,
          lot.type,
          lot.quality,
          lot.potatoSize,
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
      
      const from = new Date(fromDate);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);

      const sales = await storage.getSalesForExport(coldStorageId, from, to);

      const headers = language === "hi"
        ? ["बिक्री तिथि", "प्रवेश तिथि", "लॉट नंबर", "कोल्ड स्टोरेज बिल", "बिक्री बिल", "किसान का नाम", "मोबाइल", "गाँव", "खरीदार का नाम", "चैम्बर", "फ्लोर", "पोजीशन", "बैग का प्रकार", "मूल बोरे", "बेचे गए बोरे", "कोल्ड चार्ज/बोरी", "हम्माली/बोरी", "कुल दर/बोरी", "कोल्ड स्टोरेज चार्ज", "काटा चार्ज", "अतिरिक्त हम्माली", "ग्रेडिंग चार्ज", "कुल चार्ज", "भुगतान स्थिति", "भुगतान राशि", "बकाया राशि", "नेट वजन (Kg)", "दर/Kg"]
        : ["Sale Date", "Entry Date", "Lot #", "CS Bill #", "Sales Bill #", "Farmer Name", "Mobile", "Village", "Buyer Name", "Chamber", "Floor", "Position", "Bag Type", "Original Bags", "Bags Sold", "Cold Charge/Bag", "Hammali/Bag", "Total Rate/Bag", "Cold Storage Charge", "Kata Charges", "Extra Hammali", "Grading Charges", "Total Charges", "Payment Status", "Paid Amount", "Due Amount", "Net Weight (Kg)", "Rate/Kg"];

      const csvRows = [headers.map(escapeCSV).join(",")];
      
      for (const sale of sales) {
        const totalCharges = (sale.coldStorageCharge || 0) + (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
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
          sale.chamberName,
          sale.floor,
          sale.position,
          sale.bagType,
          sale.originalLotSize,
          sale.quantitySold,
          sale.coldCharge || "",
          sale.hammali || "",
          sale.pricePerBag,
          sale.coldStorageCharge,
          sale.kataCharges || 0,
          sale.extraHammali || 0,
          sale.gradingCharges || 0,
          totalCharges,
          sale.paymentStatus,
          sale.paidAmount || 0,
          totalCharges - (sale.paidAmount || 0),
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

      const { receipts, expenses } = await storage.getCashDataForExport(coldStorageId, from, to);

      // Headers with all columns for both types
      const headers = language === "hi"
        ? ["तारीख", "प्रकार", "खरीदार का नाम", "खर्च प्रकार", "भुगतान मोड", "राशि", "नोट्स/टिप्पणी", "स्थिति", "रद्द तारीख"]
        : ["Date", "Type", "Buyer Name", "Expense Type", "Payment Mode", "Amount", "Notes/Remarks", "Status", "Reversal Date"];

      // Expense type labels
      const expenseTypeMap: Record<string, { en: string; hi: string }> = {
        salary: { en: "Salary", hi: "वेतन" },
        hammali: { en: "Hammali", hi: "हम्माली" },
        grading_charges: { en: "Grading Charges", hi: "ग्रेडिंग चार्ज" },
        general_expenses: { en: "General Expenses", hi: "सामान्य खर्च" },
      };

      // Combine and sort by date (latest first)
      interface CashEntry {
        date: Date;
        type: string;
        buyerName: string;
        expenseType: string;
        mode: string;
        amount: number;
        notes: string;
        status: string;
        reversalDate: string;
      }
      const allEntries: CashEntry[] = [];
      
      for (const r of receipts) {
        const isReversed = r.isReversed === 1;
        allEntries.push({
          date: new Date(r.receivedAt),
          type: language === "hi" ? "आवक" : "Inward",
          buyerName: r.buyerName,
          expenseType: "", // Not applicable for inward
          mode: r.receiptType === "cash" ? (language === "hi" ? "नकद" : "Cash") : (language === "hi" ? "खाता" : "Account"),
          amount: r.amount,
          notes: r.notes || "",
          status: isReversed ? (language === "hi" ? "रद्द" : "Reversed") : (language === "hi" ? "सक्रिय" : "Active"),
          reversalDate: isReversed && r.reversedAt ? formatDateForExport(new Date(r.reversedAt)) : "",
        });
      }
      
      for (const e of expenses) {
        const isReversed = e.isReversed === 1;
        const expenseLabel = expenseTypeMap[e.expenseType] || { en: e.expenseType, hi: e.expenseType };
        
        allEntries.push({
          date: new Date(e.paidAt),
          type: language === "hi" ? "खर्च" : "Expense",
          buyerName: "", // Not applicable for expense
          expenseType: language === "hi" ? expenseLabel.hi : expenseLabel.en,
          mode: e.paymentMode === "cash" ? (language === "hi" ? "नकद" : "Cash") : (language === "hi" ? "खाता" : "Account"),
          amount: e.amount,
          notes: e.remarks || "",
          status: isReversed ? (language === "hi" ? "रद्द" : "Reversed") : (language === "hi" ? "सक्रिय" : "Active"),
          reversalDate: isReversed && e.reversedAt ? formatDateForExport(new Date(e.reversedAt)) : "",
        });
      }

      // Sort by date descending (latest first)
      allEntries.sort((a, b) => b.date.getTime() - a.date.getTime());

      const csvRows = [headers.map(escapeCSV).join(",")];
      
      for (const entry of allEntries) {
        const row = [
          formatDateForExport(entry.date),
          entry.type,
          entry.buyerName,
          entry.expenseType,
          entry.mode,
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
