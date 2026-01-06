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
  state: text("state").notNull(),
  contactNumber: text("contact_number").notNull(),
  lotNo: text("lot_no").notNull(),
  size: integer("size").notNull(), // Original lot size (bags)
  remainingSize: integer("remaining_size").notNull(), // After partial sales
  chamberId: varchar("chamber_id").notNull(),
  floor: integer("floor").notNull(),
  position: text("position").notNull(), // Position like "12/5", "12A/5"
  type: text("type").notNull(), // Jyoti, SC3, etc.
  bagType: text("bag_type").notNull(), // wafer or seed
  quality: text("quality").notNull(), // poor, medium, good
  assayingType: text("assaying_type").notNull(), // Quality Check, Visual
  assayerImage: text("assayer_image"), // Only if Quality Check
  reducingSugar: real("reducing_sugar"), // Only if Quality Check
  dm: real("dm"), // Only if Quality Check (Dry Matter)
  remarks: text("remarks"),
  upForSale: integer("up_for_sale").notNull().default(0), // 0 = not for sale, 1 = up for sale
  saleStatus: text("sale_status").notNull().default("available"), // available, sold
  paymentStatus: text("payment_status"), // due, paid (only set when fully sold)
  saleCharge: real("sale_charge"), // Total storage charge when fully sold
  totalPaidCharge: real("total_paid_charge").default(0), // Accumulated paid charges from partial sales
  totalDueCharge: real("total_due_charge").default(0), // Accumulated due charges from partial sales
  soldAt: timestamp("sold_at"), // When the lot was sold
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Sales History - permanent record of all sales
export const salesHistory = pgTable("sales_history", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  // Farmer/Lot details (copied from lot at time of sale)
  farmerName: text("farmer_name").notNull(),
  village: text("village").notNull(),
  tehsil: text("tehsil").notNull(),
  district: text("district").notNull(),
  state: text("state").notNull(),
  contactNumber: text("contact_number").notNull(),
  lotNo: text("lot_no").notNull(),
  lotId: varchar("lot_id").notNull(),
  chamberName: text("chamber_name").notNull(),
  floor: integer("floor").notNull(),
  position: text("position").notNull(),
  potatoType: text("potato_type").notNull(),
  bagType: text("bag_type").notNull(),
  quality: text("quality").notNull(),
  originalLotSize: integer("original_lot_size").notNull(),
  // Sale details
  saleType: text("sale_type").notNull(), // 'partial' or 'full'
  quantitySold: integer("quantity_sold").notNull(),
  pricePerBag: real("price_per_bag").notNull(), // Cold storage charge per bag
  coldStorageCharge: real("cold_storage_charge").notNull(), // Total charge for this sale
  buyerName: text("buyer_name"),
  pricePerKg: real("price_per_kg"), // Selling price per kg
  // Payment tracking
  paymentStatus: text("payment_status").notNull(), // 'paid' or 'due'
  paidAt: timestamp("paid_at"), // When marked as paid
  // Timestamps
  saleYear: integer("sale_year").notNull(),
  soldAt: timestamp("sold_at").notNull().defaultNow(),
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
  pricePerKg: real("price_per_kg"), // Selling price per kg (optional)
  buyerName: text("buyer_name"), // Buyer name (optional)
  totalPrice: real("total_price"), // For partial sales
  salePaymentStatus: text("sale_payment_status"), // For partial sales: 'paid' or 'due'
  saleCharge: real("sale_charge"), // Storage charge for this partial sale
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

// Insert schemas
export const insertColdStorageSchema = createInsertSchema(coldStorages).omit({ id: true });
export const insertChamberSchema = createInsertSchema(chambers).omit({ id: true });
export const insertLotSchema = createInsertSchema(lots).omit({ id: true, createdAt: true });
export const insertLotEditHistorySchema = createInsertSchema(lotEditHistory).omit({ id: true, changedAt: true });
export const insertSalesHistorySchema = createInsertSchema(salesHistory).omit({ id: true, soldAt: true });

// Types
export type ColdStorage = typeof coldStorages.$inferSelect;
export type InsertColdStorage = z.infer<typeof insertColdStorageSchema>;
export type Chamber = typeof chambers.$inferSelect;
export type InsertChamber = z.infer<typeof insertChamberSchema>;
export type Lot = typeof lots.$inferSelect;
export type InsertLot = z.infer<typeof insertLotSchema>;
export type LotEditHistory = typeof lotEditHistory.$inferSelect;
export type InsertLotEditHistory = z.infer<typeof insertLotEditHistorySchema>;
export type SalesHistory = typeof salesHistory.$inferSelect;
export type InsertSalesHistory = z.infer<typeof insertSalesHistorySchema>;

// Form validation schema for lot entry
export const lotFormSchema = z.object({
  farmerName: z.string().min(1, "Farmer name is required"),
  village: z.string().min(1, "Village is required"),
  tehsil: z.string().min(1, "Tehsil is required"),
  district: z.string().min(1, "District is required"),
  state: z.string().min(1, "State is required"),
  contactNumber: z.string().regex(/^\d{10}$/, "Contact number must be exactly 10 digits"),
  lotNo: z.string().min(1, "Lot number is required"),
  size: z.number().min(1, "Size must be at least 1"),
  chamberId: z.string().min(1, "Chamber is required"),
  floor: z.number().min(1, "Floor is required"),
  position: z.string().min(1, "Position is required"),
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
  rate: number;
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

// Payment stats type for analytics
export interface PaymentStats {
  totalPaid: number;
  totalDue: number;
  paidCount: number;
  dueCount: number;
}
