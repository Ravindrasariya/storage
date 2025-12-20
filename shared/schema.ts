import { pgTable, text, varchar, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Cold Storage Configuration
export const coldStorages = pgTable("cold_storages", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  totalCapacity: integer("total_capacity").notNull(), // Total bags capacity
  waferRate: real("wafer_rate").notNull(), // Per bag rate for wafer
  seedRate: real("seed_rate").notNull(), // Per bag rate for seed
  linkedPhones: text("linked_phones").array().notNull(), // Mobile numbers with access
});

// Chambers in cold storage
export const chambers = pgTable("chambers", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(), // Max bags
  currentFill: integer("current_fill").notNull().default(0),
});

// Lot entries
export const lots = pgTable("lots", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  farmerName: text("farmer_name").notNull(),
  village: text("village").notNull(),
  tehsil: text("tehsil").notNull(),
  district: text("district").notNull(),
  contactNumber: text("contact_number").notNull(),
  lotNo: text("lot_no").notNull(),
  size: integer("size").notNull(), // Original lot size (bags)
  remainingSize: integer("remaining_size").notNull(), // After partial sales
  chamberId: varchar("chamber_id").notNull(),
  floor: integer("floor").notNull(),
  position: real("position").notNull(), // Fractional position
  type: text("type").notNull(), // Jyoti, SC3, etc.
  bagType: text("bag_type").notNull(), // wafer or seed
  quality: text("quality").notNull(), // poor, medium, good
  assayingType: text("assaying_type").notNull(), // Quality Check, Visual
  assayerImage: text("assayer_image"), // Only if Quality Check
  reducingSugar: real("reducing_sugar"), // Only if Quality Check
  dm: real("dm"), // Only if Quality Check (Dry Matter)
  remarks: text("remarks"),
  upForSale: integer("up_for_sale").notNull().default(0), // 0 = not for sale, 1 = up for sale
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Edit history for tracking changes
export const lotEditHistory = pgTable("lot_edit_history", {
  id: varchar("id").primaryKey(),
  lotId: varchar("lot_id").notNull(),
  changeType: text("change_type").notNull(), // 'edit', 'partial_sale'
  previousData: text("previous_data").notNull(), // JSON string
  newData: text("new_data").notNull(), // JSON string
  soldQuantity: integer("sold_quantity"), // For partial sales
  pricePerBag: real("price_per_bag"), // For partial sales
  totalPrice: real("total_price"), // For partial sales
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

// Insert schemas
export const insertColdStorageSchema = createInsertSchema(coldStorages).omit({ id: true });
export const insertChamberSchema = createInsertSchema(chambers).omit({ id: true });
export const insertLotSchema = createInsertSchema(lots).omit({ id: true, createdAt: true });
export const insertLotEditHistorySchema = createInsertSchema(lotEditHistory).omit({ id: true, changedAt: true });

// Types
export type ColdStorage = typeof coldStorages.$inferSelect;
export type InsertColdStorage = z.infer<typeof insertColdStorageSchema>;
export type Chamber = typeof chambers.$inferSelect;
export type InsertChamber = z.infer<typeof insertChamberSchema>;
export type Lot = typeof lots.$inferSelect;
export type InsertLot = z.infer<typeof insertLotSchema>;
export type LotEditHistory = typeof lotEditHistory.$inferSelect;
export type InsertLotEditHistory = z.infer<typeof insertLotEditHistorySchema>;

// Form validation schema for lot entry
export const lotFormSchema = z.object({
  farmerName: z.string().min(1, "Farmer name is required"),
  village: z.string().min(1, "Village is required"),
  tehsil: z.string().min(1, "Tehsil is required"),
  district: z.string().min(1, "District is required"),
  contactNumber: z.string().min(10, "Valid contact number required"),
  lotNo: z.string().min(1, "Lot number is required"),
  size: z.number().min(1, "Size must be at least 1"),
  chamberId: z.string().min(1, "Chamber is required"),
  floor: z.number().min(1, "Floor is required"),
  position: z.number().min(0, "Position must be 0 or greater"),
  type: z.string().min(1, "Type is required"),
  bagType: z.enum(["wafer", "seed"]),
  quality: z.enum(["poor", "medium", "good"]),
  assayingType: z.enum(["Quality Check", "Visual"]),
  assayerImage: z.string().optional(),
  reducingSugar: z.number().optional(),
  dm: z.number().optional(),
  remarks: z.string().optional(),
});

export type LotFormData = z.infer<typeof lotFormSchema>;

// Sale lot info for dashboard
export interface SaleLotInfo {
  id: string;
  lotNo: string;
  farmerName: string;
  contactNumber: string;
  village: string;
  chamberName: string;
  remainingSize: number;
  bagType: string;
  type: string;
}

// Dashboard stats type
export interface DashboardStats {
  totalCapacity: number;
  usedCapacity: number;
  peakUtilization: number; // Peak bags ever stored
  currentUtilization: number; // Current bags stored
  totalFarmers: number;
  totalLots: number;
  remainingLots: number; // Lots with remaining bags
  totalWaferBags: number;
  remainingWaferBags: number;
  totalSeedBags: number;
  remainingSeedBags: number;
  waferRate: number;
  seedRate: number;
  chamberStats: {
    id: string;
    name: string;
    capacity: number;
    currentFill: number;
    fillPercentage: number;
  }[];
  saleLots: SaleLotInfo[];
}

// Quality stats type
export interface QualityStats {
  chamberQuality: {
    chamberId: string;
    chamberName: string;
    poor: number;
    medium: number;
    good: number;
  }[];
  totalPoor: number;
  totalMedium: number;
  totalGood: number;
}
