import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { lotFormSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const DEFAULT_COLD_STORAGE_ID = "cs-default";

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
      
      const validTypes = ["phone", "lotNoSize", "filter"];
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

  app.patch("/api/lots/:id", async (req, res) => {
    try {
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
      }

      const previousData = {
        farmerName: lot.farmerName,
        village: lot.village,
        tehsil: lot.tehsil,
        district: lot.district,
        contactNumber: lot.contactNumber,
        remarks: lot.remarks,
      };

      const updatedLot = await storage.updateLot(req.params.id, req.body);

      await storage.createEditHistory({
        lotId: lot.id,
        changeType: "edit",
        previousData: JSON.stringify(previousData),
        newData: JSON.stringify(req.body),
      });

      res.json(updatedLot);
    } catch (error) {
      res.status(500).json({ error: "Failed to update lot" });
    }
  });

  app.post("/api/lots/:id/partial-sale", async (req, res) => {
    try {
      const lot = await storage.getLot(req.params.id);
      if (!lot) {
        return res.status(404).json({ error: "Lot not found" });
      }

      const { quantitySold, pricePerBag, paymentStatus } = req.body;

      if (typeof quantitySold !== "number" || quantitySold <= 0) {
        return res.status(400).json({ error: "Invalid quantity sold" });
      }

      if (quantitySold > lot.remainingSize) {
        return res.status(400).json({ error: "Quantity exceeds remaining size" });
      }

      const previousData = {
        remainingSize: lot.remainingSize,
      };

      const newRemainingSize = lot.remainingSize - quantitySold;
      const totalPrice = quantitySold * pricePerBag;

      const updateData: { remainingSize: number; paymentStatus?: string } = {
        remainingSize: newRemainingSize,
      };
      
      if (paymentStatus && (paymentStatus === "due" || paymentStatus === "paid")) {
        updateData.paymentStatus = paymentStatus;
      }
      
      await storage.updateLot(req.params.id, updateData);

      await storage.createEditHistory({
        lotId: lot.id,
        changeType: "partial_sale",
        previousData: JSON.stringify(previousData),
        newData: JSON.stringify({ remainingSize: newRemainingSize }),
        soldQuantity: quantitySold,
        pricePerBag,
        totalPrice,
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
    paymentStatus: z.enum(["due", "paid"]),
  });

  app.post("/api/lots/:id/finalize-sale", async (req, res) => {
    try {
      const validatedData = finalizeSaleSchema.parse(req.body);
      
      const lot = await storage.finalizeSale(req.params.id, validatedData.paymentStatus);
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
      const stats = await storage.getQualityStats(DEFAULT_COLD_STORAGE_ID);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch quality stats" });
    }
  });

  app.get("/api/analytics/payments", async (req, res) => {
    try {
      const stats = await storage.getPaymentStats(DEFAULT_COLD_STORAGE_ID);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch payment stats" });
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

  return httpServer;
}
