import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { lotFormSchema, insertChamberFloorSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const DEFAULT_COLD_STORAGE_ID = "cs-default";

  // Initialize default data in database
  await storage.initializeDefaultData();

  // Dashboard stats
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats(DEFAULT_COLD_STORAGE_ID);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Chambers
  app.get("/api/chambers", async (req, res) => {
    try {
      const chambers = await storage.getChambers(DEFAULT_COLD_STORAGE_ID);
      res.json(chambers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chambers" });
    }
  });

  // Floor-wise capacity for chambers (current fill by floor from lots data)
  app.get("/api/chambers/floor-capacity", async (req, res) => {
    try {
      const floorData = await storage.getFloorCapacityByChamber(DEFAULT_COLD_STORAGE_ID);
      res.json(floorData);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch floor capacity" });
    }
  });

  // Chamber floors (configured capacity per floor)
  app.get("/api/chamber-floors", async (req, res) => {
    try {
      const floors = await storage.getAllChamberFloors(DEFAULT_COLD_STORAGE_ID);
      res.json(floors);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chamber floors" });
    }
  });

  app.get("/api/chambers/:chamberId/floors", async (req, res) => {
    try {
      const floors = await storage.getChamberFloors(req.params.chamberId);
      res.json(floors);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chamber floors" });
    }
  });

  app.post("/api/chamber-floors", async (req, res) => {
    try {
      const validated = insertChamberFloorSchema.parse(req.body);
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

  app.patch("/api/chamber-floors/:id", async (req, res) => {
    try {
      const validated = updateFloorSchema.parse(req.body);
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

  app.delete("/api/chamber-floors/:id", async (req, res) => {
    try {
      await storage.deleteChamberFloor(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete chamber floor" });
    }
  });

  // Lots
  app.get("/api/lots", async (req, res) => {
    try {
      const lots = await storage.getAllLots(DEFAULT_COLD_STORAGE_ID);
      res.json(lots);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lots" });
    }
  });

  app.post("/api/lots", async (req, res) => {
    try {
      const validatedData = lotFormSchema.parse(req.body);
      
      const lot = await storage.createLot({
        ...validatedData,
        coldStorageId: DEFAULT_COLD_STORAGE_ID,
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

  app.get("/api/lots/search", async (req, res) => {
    try {
      const { type, query, lotNo, size, quality, paymentDue } = req.query;
      
      const validTypes = ["phone", "lotNoSize", "filter", "farmerName"];
      if (!validTypes.includes(type as string)) {
        return res.status(400).json({ error: "Invalid search type" });
      }
      
      let lots;
      if (type === "filter") {
        // Get all lots and apply filters
        lots = await storage.getAllLots(DEFAULT_COLD_STORAGE_ID);
      } else if (type === "lotNoSize") {
        lots = await storage.searchLotsByLotNoAndSize(
          lotNo as string || "",
          size as string || "",
          DEFAULT_COLD_STORAGE_ID
        );
      } else if (type === "farmerName") {
        if (!query) {
          return res.status(400).json({ error: "Missing query parameter" });
        }
        lots = await storage.searchLotsByFarmerName(
          query as string,
          DEFAULT_COLD_STORAGE_ID
        );
      } else {
        if (!query) {
          return res.status(400).json({ error: "Missing query parameter" });
        }
        lots = await storage.searchLots(
          type as "phone",
          query as string,
          DEFAULT_COLD_STORAGE_ID
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

  app.get("/api/lots/:id", async (req, res) => {
    try {
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
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

  app.patch("/api/lots/:id", async (req, res) => {
    try {
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
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
  app.post("/api/lots/:id/reverse-edit", async (req, res) => {
    try {
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
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

  app.post("/api/lots/:id/partial-sale", async (req, res) => {
    try {
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
      }

      const { quantitySold, pricePerBag, paymentStatus, paymentMode, buyerName, pricePerKg, paidAmount, dueAmount, position, kataCharges, extraHammali, gradingCharges, netWeight } = req.body;

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
      const coldStorage = await storage.getColdStorage(lot.coldStorageId);
      const rate = coldStorage ? (lot.bagType === "wafer" ? coldStorage.waferRate : coldStorage.seedRate) : 0;
      const hammaliRate = coldStorage ? (lot.bagType === "wafer" ? (coldStorage.waferHammali || 0) : (coldStorage.seedHammali || 0)) : 0;
      const coldChargeRate = rate - hammaliRate; // Cold storage charge is rate minus hammali
      const storageCharge = quantitySold * rate;

      const updateData: { 
        remainingSize: number; 
        totalPaidCharge?: number; 
        totalDueCharge?: number;
      } = {
        remainingSize: newRemainingSize,
      };
      
      // Track paid and due charges separately
      if (paymentStatus === "paid") {
        updateData.totalPaidCharge = (lot.totalPaidCharge || 0) + storageCharge;
      } else if (paymentStatus === "due") {
        updateData.totalDueCharge = (lot.totalDueCharge || 0) + storageCharge;
      } else if (paymentStatus === "partial") {
        // Validate and normalize partial payment amounts
        const rawPaid = Math.max(0, paidAmount || 0);
        const actualPaid = Math.min(rawPaid, storageCharge); // Clamp to max charge
        const actualDue = storageCharge - actualPaid; // Calculate due as remainder to ensure sum equals total
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
      
      // Calculate total charge including all extra charges
      const kata = kataCharges || 0;
      const extraHammaliTotal = extraHammali || 0;
      const grading = gradingCharges || 0;
      const totalChargeWithExtras = storageCharge + kata + extraHammaliTotal + grading;
      
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

  app.get("/api/lots/:id/history", async (req, res) => {
    try {
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
  });

  app.post("/api/lots/:id/finalize-sale", async (req, res) => {
    try {
      const validatedData = finalizeSaleSchema.parse(req.body);
      
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
        validatedData.netWeight
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
  app.get("/api/analytics/quality", async (req, res) => {
    try {
      const { year } = req.query;
      const yearNum = year ? parseInt(year as string) : undefined;
      const stats = await storage.getQualityStats(DEFAULT_COLD_STORAGE_ID, yearNum);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch quality stats" });
    }
  });

  app.get("/api/analytics/payments", async (req, res) => {
    try {
      const { year } = req.query;
      const yearNum = year ? parseInt(year as string) : undefined;
      const stats = await storage.getPaymentStats(DEFAULT_COLD_STORAGE_ID, yearNum);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch payment stats" });
    }
  });

  app.get("/api/analytics/merchants", async (req, res) => {
    try {
      const { year } = req.query;
      const yearNum = year ? parseInt(year as string) : undefined;
      const stats = await storage.getMerchantStats(DEFAULT_COLD_STORAGE_ID, yearNum);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch merchant stats" });
    }
  });

  app.get("/api/analytics/years", async (req, res) => {
    try {
      const years = await storage.getAnalyticsYears(DEFAULT_COLD_STORAGE_ID);
      res.json(years);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch analytics years" });
    }
  });

  // Reset Season
  app.get("/api/reset-season/check", async (req, res) => {
    try {
      const result = await storage.checkResetEligibility(DEFAULT_COLD_STORAGE_ID);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to check reset eligibility" });
    }
  });

  app.post("/api/reset-season", async (req, res) => {
    try {
      const eligibility = await storage.checkResetEligibility(DEFAULT_COLD_STORAGE_ID);
      if (!eligibility.canReset) {
        return res.status(400).json({ 
          error: "Cannot reset season", 
          remainingBags: eligibility.remainingBags,
          remainingLots: eligibility.remainingLots
        });
      }
      await storage.resetSeason(DEFAULT_COLD_STORAGE_ID);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset season" });
    }
  });

  // Cold Storage Settings
  app.get("/api/cold-storage", async (req, res) => {
    try {
      const coldStorage = await storage.getColdStorage(DEFAULT_COLD_STORAGE_ID);
      res.json(coldStorage);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cold storage" });
    }
  });

  app.patch("/api/cold-storage", async (req, res) => {
    try {
      const updated = await storage.updateColdStorage(DEFAULT_COLD_STORAGE_ID, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update cold storage" });
    }
  });

  // Chamber management
  app.post("/api/chambers", async (req, res) => {
    try {
      const { name, capacity, coldStorageId } = req.body;
      const chamber = await storage.createChamber({
        name,
        capacity,
        coldStorageId: coldStorageId || DEFAULT_COLD_STORAGE_ID,
      });
      res.status(201).json(chamber);
    } catch (error) {
      res.status(500).json({ error: "Failed to create chamber" });
    }
  });

  app.patch("/api/chambers/:id", async (req, res) => {
    try {
      const updated = await storage.updateChamber(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update chamber" });
    }
  });

  app.delete("/api/chambers/:id", async (req, res) => {
    try {
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
  app.get("/api/sales-history", async (req, res) => {
    try {
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
      
      const salesHistory = await storage.getSalesHistory(DEFAULT_COLD_STORAGE_ID, filters);
      res.json(salesHistory);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sales history" });
    }
  });

  app.get("/api/sales-history/years", async (req, res) => {
    try {
      const years = await storage.getSalesYears(DEFAULT_COLD_STORAGE_ID);
      res.json(years);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sales years" });
    }
  });

  app.patch("/api/sales-history/:id/mark-paid", async (req, res) => {
    try {
      const updated = await storage.markSaleAsPaid(req.params.id);
      if (!updated) {
        return res.status(404).json({ error: "Sale not found" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to mark sale as paid" });
    }
  });

  app.patch("/api/sales-history/:id/mark-due", async (req, res) => {
    try {
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
  });

  app.patch("/api/sales-history/:id", async (req, res) => {
    try {
      const validatedData = updateSalesHistorySchema.parse(req.body);
      const updated = await storage.updateSalesHistory(req.params.id, validatedData);
      if (!updated) {
        return res.status(404).json({ error: "Sale not found" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid update data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update sale" });
    }
  });

  app.post("/api/sales-history/:id/reverse", async (req, res) => {
    try {
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

  app.get("/api/maintenance", async (req, res) => {
    try {
      const records = await storage.getMaintenanceRecords(DEFAULT_COLD_STORAGE_ID);
      res.json(records);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch maintenance records" });
    }
  });

  app.post("/api/maintenance", async (req, res) => {
    try {
      const validatedData = createMaintenanceSchema.parse(req.body);
      const record = await storage.createMaintenanceRecord({
        coldStorageId: DEFAULT_COLD_STORAGE_ID,
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

  app.patch("/api/maintenance/:id", async (req, res) => {
    try {
      const validatedData = updateMaintenanceSchema.parse(req.body);
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

  app.delete("/api/maintenance/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteMaintenanceRecord(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Maintenance record not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete maintenance record" });
    }
  });

  return httpServer;
}
