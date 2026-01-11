import { pgTable, text, varchar, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Cold Storage Configuration
export const coldStorages = pgTable("cold_storages", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  totalCapacity: integer("total_capacity").notNull(), // Total bags capacity
  waferRate: real("wafer_rate").notNull(), // Per bag rate for wafer (total)
  seedRate: real("seed_rate").notNull(), // Per bag rate for seed (total)
  waferColdCharge: real("wafer_cold_charge"), // Cold storage charge for wafer
  waferHammali: real("wafer_hammali"), // Hammali charge for wafer
  seedColdCharge: real("seed_cold_charge"), // Cold storage charge for seed
  seedHammali: real("seed_hammali"), // Hammali charge for seed
  linkedPhones: text("linked_phones").array().notNull(), // Mobile numbers with access
  nextExitBillNumber: integer("next_exit_bill_number").notNull().default(1), // Auto-increment counter for exit bills
  nextColdStorageBillNumber: integer("next_cold_storage_bill_number").notNull().default(1), // Counter for cold storage deduction bills
  nextSalesBillNumber: integer("next_sales_bill_number").notNull().default(1), // Counter for sales bills
  nextEntryBillNumber: integer("next_entry_bill_number").notNull().default(1), // Counter for lot entry receipts
});

// Chambers in cold storage
export const chambers = pgTable("chambers", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(), // Max bags
  currentFill: integer("current_fill").notNull().default(0),
});

// Floor capacities per chamber
export const chamberFloors = pgTable("chamber_floors", {
  id: varchar("id").primaryKey(),
  chamberId: varchar("chamber_id").notNull(),
  floorNumber: integer("floor_number").notNull(),
  capacity: integer("capacity").notNull(), // Max bags for this floor
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
  potatoSize: text("potato_size").notNull().default("large"), // large or small
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
  entryBillNumber: integer("entry_bill_number"), // Bill number for lot entry receipt (assigned on first print)
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
  pricePerBag: real("price_per_bag").notNull(), // Combined rate per bag (coldCharge + hammali)
  coldCharge: real("cold_charge"), // Cold storage charge component per bag
  hammali: real("hammali"), // Hammali charge component per bag
  coldStorageCharge: real("cold_storage_charge").notNull(), // Total charge for this sale
  kataCharges: real("kata_charges").default(0), // Kata (weighing) charges
  extraHammali: real("extra_hammali").default(0), // Extra hammali per bag * quantity (for bilty)
  gradingCharges: real("grading_charges").default(0), // Grading charges (for bilty)
  netWeight: real("net_weight"), // Optional net weight of the lot in kg
  buyerName: text("buyer_name"),
  pricePerKg: real("price_per_kg"), // Selling price per kg
  // Payment tracking
  paymentStatus: text("payment_status").notNull(), // 'paid', 'due', or 'partial'
  paymentMode: text("payment_mode"), // 'cash' or 'account' (only when paid/partial)
  paidAmount: real("paid_amount").default(0), // Amount paid for this sale
  dueAmount: real("due_amount").default(0), // Amount due for this sale
  paidAt: timestamp("paid_at"), // When marked as paid
  // Timestamps
  entryDate: timestamp("entry_date"), // When lot was originally entered in cold storage (nullable for existing records)
  saleYear: integer("sale_year").notNull(),
  soldAt: timestamp("sold_at").notNull().defaultNow(),
  // Bill numbers (assigned on first print, null means never printed)
  coldStorageBillNumber: integer("cold_storage_bill_number"), // Bill number for cold storage deduction receipt
  salesBillNumber: integer("sales_bill_number"), // Bill number for sales bill
});

// Edit history for tracking changes
export const lotEditHistory = pgTable("lot_edit_history", {
  id: varchar("id").primaryKey(),
  lotId: varchar("lot_id").notNull(),
  changeType: text("change_type").notNull(), // 'edit', 'partial_sale'
  previousData: text("previous_data").notNull(), // JSON string
  newData: text("new_data").notNull(), // JSON string
  soldQuantity: integer("sold_quantity"), // For partial sales
  pricePerBag: real("price_per_bag"), // For partial sales (combined rate)
  coldCharge: real("cold_charge"), // Cold storage charge component per bag
  hammali: real("hammali"), // Hammali charge component per bag
  pricePerKg: real("price_per_kg"), // Selling price per kg (optional)
  buyerName: text("buyer_name"), // Buyer name (optional)
  totalPrice: real("total_price"), // For partial sales
  salePaymentStatus: text("sale_payment_status"), // For partial sales: 'paid' or 'due'
  saleCharge: real("sale_charge"), // Storage charge for this partial sale
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

// Sale Edit History - tracks changes to sales after initial entry
export const saleEditHistory = pgTable("sale_edit_history", {
  id: varchar("id").primaryKey(),
  saleId: varchar("sale_id").notNull(),
  fieldChanged: text("field_changed").notNull(), // e.g., 'buyerName', 'paymentStatus', 'netWeight'
  oldValue: text("old_value"), // Previous value (as string)
  newValue: text("new_value"), // New value (as string)
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

// Maintenance records for cold storage
export const maintenanceRecords = pgTable("maintenance_records", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  taskDescription: text("task_description").notNull(),
  responsiblePerson: text("responsible_person").notNull(),
  nextDueDate: text("next_due_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Exit history - tracks when sold bags are physically removed from cold storage
export const exitHistory = pgTable("exit_history", {
  id: varchar("id").primaryKey(),
  salesHistoryId: varchar("sales_history_id").notNull(),
  lotId: varchar("lot_id").notNull(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  bagsExited: integer("bags_exited").notNull(),
  billNumber: integer("bill_number").notNull().default(0), // Unique bill number for this exit, auto-incremented
  exitDate: timestamp("exit_date").notNull().defaultNow(),
  isReversed: integer("is_reversed").notNull().default(0), // 0 = active, 1 = reversed
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Cash Receipts - tracks inward cash/account payments from buyers
export const cashReceipts = pgTable("cash_receipts", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  buyerName: text("buyer_name").notNull(),
  receiptType: text("receipt_type").notNull(), // 'cash' or 'account'
  amount: real("amount").notNull(),
  receivedAt: timestamp("received_at").notNull(),
  appliedAmount: real("applied_amount").notNull().default(0), // Amount applied to sales
  unappliedAmount: real("unapplied_amount").notNull().default(0), // Remaining amount not yet applied
  notes: text("notes"),
  isReversed: integer("is_reversed").notNull().default(0), // 0 = active, 1 = reversed
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Expenses - tracks outward cash/account payments
export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  expenseType: text("expense_type").notNull(), // 'salary', 'hammali', 'grading_charges', 'general_expenses'
  paymentMode: text("payment_mode").notNull(), // 'cash' or 'account'
  amount: real("amount").notNull(),
  paidAt: timestamp("paid_at").notNull(),
  remarks: text("remarks"),
  isReversed: integer("is_reversed").notNull().default(0), // 0 = active, 1 = reversed
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Insert schemas
export const insertColdStorageSchema = createInsertSchema(coldStorages).omit({ id: true });
export const insertChamberSchema = createInsertSchema(chambers).omit({ id: true });
export const insertChamberFloorSchema = createInsertSchema(chamberFloors).omit({ id: true });
export const insertLotSchema = createInsertSchema(lots).omit({ id: true, createdAt: true });
export const insertLotEditHistorySchema = createInsertSchema(lotEditHistory).omit({ id: true, changedAt: true });
export const insertSalesHistorySchema = createInsertSchema(salesHistory).omit({ id: true, soldAt: true });
export const insertSaleEditHistorySchema = createInsertSchema(saleEditHistory).omit({ id: true, changedAt: true });
export const insertMaintenanceRecordSchema = createInsertSchema(maintenanceRecords).omit({ id: true, createdAt: true });
export const insertExitHistorySchema = createInsertSchema(exitHistory).omit({ id: true, billNumber: true, exitDate: true, createdAt: true, isReversed: true, reversedAt: true });
export const insertCashReceiptSchema = createInsertSchema(cashReceipts).omit({ id: true, createdAt: true, appliedAmount: true, unappliedAmount: true, isReversed: true, reversedAt: true });
export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true, isReversed: true, reversedAt: true });

// Types
export type ColdStorage = typeof coldStorages.$inferSelect;
export type InsertColdStorage = z.infer<typeof insertColdStorageSchema>;
export type Chamber = typeof chambers.$inferSelect;
export type InsertChamber = z.infer<typeof insertChamberSchema>;
export type ChamberFloor = typeof chamberFloors.$inferSelect;
export type InsertChamberFloor = z.infer<typeof insertChamberFloorSchema>;
export type Lot = typeof lots.$inferSelect;
export type InsertLot = z.infer<typeof insertLotSchema>;
export type LotEditHistory = typeof lotEditHistory.$inferSelect;
export type InsertLotEditHistory = z.infer<typeof insertLotEditHistorySchema>;
export type SalesHistory = typeof salesHistory.$inferSelect;
export type InsertSalesHistory = z.infer<typeof insertSalesHistorySchema>;
export type SaleEditHistory = typeof saleEditHistory.$inferSelect;
export type InsertSaleEditHistory = z.infer<typeof insertSaleEditHistorySchema>;
export type MaintenanceRecord = typeof maintenanceRecords.$inferSelect;
export type InsertMaintenanceRecord = z.infer<typeof insertMaintenanceRecordSchema>;
export type ExitHistory = typeof exitHistory.$inferSelect;
export type InsertExitHistory = z.infer<typeof insertExitHistorySchema>;
export type CashReceipt = typeof cashReceipts.$inferSelect;
export type InsertCashReceipt = z.infer<typeof insertCashReceiptSchema>;
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

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
  bagType: z.enum(["wafer", "seed", "ration"]),
  quality: z.enum(["poor", "medium", "good"]),
  potatoSize: z.enum(["large", "small"]),
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
  floor: number;
  position: string;
  originalSize: number; // Original bag count
  remainingSize: number;
  bagType: string;
  type: string;
  quality: string;
  potatoSize: string;
  rate: number;
  coldCharge: number; // Cold storage charge per bag
  hammali: number; // Hammali charge per bag
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
  waferColdCharge: number;
  waferHammali: number;
  seedColdCharge: number;
  seedHammali: number;
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
  // Remaining bags quality per chamber (for cards and bar graph)
  chamberQualityRemaining: {
    chamberId: string;
    chamberName: string;
    poor: number;
    medium: number;
    good: number;
  }[];
  // Original/initial distribution per chamber (for table)
  chamberQuality: {
    chamberId: string;
    chamberName: string;
    poor: number;
    medium: number;
    good: number;
  }[];
  // Remaining totals (for summary cards)
  totalPoorRemaining: number;
  totalMediumRemaining: number;
  totalGoodRemaining: number;
  // Original totals (for table footer)
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

// Merchant stats for analytics
export interface MerchantStats {
  buyers: string[];
  merchantData: {
    buyerName: string;
    bagsPurchased: number;
    totalValue: number; // Based on selling price (pricePerKg * quantity or estimate)
    totalChargePaid: number;
    totalChargeDue: number;
    cashPaid: number;
    accountPaid: number;
  }[];
}

// Helper function to calculate total cold storage charges (includes all surcharges)
export function calculateTotalColdCharges(sale: {
  coldStorageCharge: number;
  kataCharges?: number | null;
  extraHammali?: number | null;
  gradingCharges?: number | null;
}): number {
  return (
    (sale.coldStorageCharge || 0) +
    (sale.kataCharges || 0) +
    (sale.extraHammali || 0) +
    (sale.gradingCharges || 0)
  );
}
