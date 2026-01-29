import { pgTable, text, varchar, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Cold Storage Configuration
export const coldStorages = pgTable("cold_storages", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"), // Cold storage address
  tehsil: text("tehsil"), // Tehsil
  district: text("district"), // District
  state: text("state"), // State
  pincode: text("pincode"), // Pincode
  totalCapacity: integer("total_capacity").notNull(), // Total bags capacity
  waferRate: real("wafer_rate").notNull(), // Per bag rate for wafer (total)
  seedRate: real("seed_rate").notNull(), // Per bag rate for seed (total)
  waferColdCharge: real("wafer_cold_charge"), // Cold storage charge for wafer
  waferHammali: real("wafer_hammali"), // Hammali charge for wafer
  seedColdCharge: real("seed_cold_charge"), // Cold storage charge for seed
  seedHammali: real("seed_hammali"), // Hammali charge for seed
  chargeUnit: text("charge_unit").notNull().default("bag"), // 'bag' or 'quintal'
  linkedPhones: text("linked_phones").array().notNull(), // Mobile numbers with access
  nextExitBillNumber: integer("next_exit_bill_number").notNull().default(1), // Auto-increment counter for exit bills
  nextColdStorageBillNumber: integer("next_cold_storage_bill_number").notNull().default(1), // Counter for cold storage deduction bills
  nextSalesBillNumber: integer("next_sales_bill_number").notNull().default(1), // Counter for sales bills
  nextEntryBillNumber: integer("next_entry_bill_number").notNull().default(1), // Counter for lot entry receipts
  nextWaferLotNumber: integer("next_wafer_lot_number").notNull().default(1), // Counter for wafer lot numbers
  nextRationSeedLotNumber: integer("next_ration_seed_lot_number").notNull().default(1), // Counter for ration/seed lot numbers
  startingWaferLotNumber: integer("starting_wafer_lot_number").notNull().default(1), // Starting lot number for wafer (set at year start)
  startingRationSeedLotNumber: integer("starting_ration_seed_lot_number").notNull().default(1), // Starting lot number for ration/seed (set at year start)
  status: text("status").notNull().default("active"), // 'active', 'inactive', 'archived'
});

// Cold Storage Users - users who can access a cold storage
export const coldStorageUsers = pgTable("cold_storage_users", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  name: text("name").notNull(),
  mobileNumber: text("mobile_number").notNull(),
  password: text("password").notNull(), // Stored as plain text for admin viewing (simple system)
  accessType: text("access_type").notNull(), // 'view' or 'edit'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// User Sessions - persistent sessions for logged in users
export const userSessions = pgTable("user_sessions", {
  id: varchar("id").primaryKey(), // This is the token
  userId: varchar("user_id").notNull(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastAccessedAt: timestamp("last_accessed_at").notNull().defaultNow(),
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
  lotNo: text("lot_no").notNull(), // String representation of entrySequence (for backward compat)
  entrySequence: integer("entry_sequence"), // Unified lot/receipt/bill number (auto-assigned)
  size: integer("size").notNull(), // Original lot size (bags)
  netWeight: real("net_weight"), // Net weight in kg (for quintal-based charging)
  remainingSize: integer("remaining_size").notNull(), // After partial sales
  chamberId: varchar("chamber_id").notNull(),
  floor: integer("floor").notNull(),
  position: text("position").notNull(), // Position like "12/5", "12A/5"
  type: text("type").notNull(), // Jyoti, SC3, etc.
  bagType: text("bag_type").notNull(), // wafer or seed
  bagTypeLabel: text("bag_type_label"), // Custom label like "50kg", "Jute", etc.
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
  entryBillNumber: integer("entry_bill_number"), // DEPRECATED: Use entrySequence instead
  baseColdChargesBilled: integer("base_cold_charges_billed").notNull().default(0), // 0 = not billed, 1 = billed (set when partial sale uses totalRemaining charge basis)
  // Entry-time deductions (Advance, Freight/Gadi Bhada, Other)
  advanceDeduction: real("advance_deduction").default(0), // Advance paid to farmer
  freightDeduction: real("freight_deduction").default(0), // Freight / Gadi Bhada charges
  otherDeduction: real("other_deduction").default(0), // Other miscellaneous deductions
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
  bagTypeLabel: text("bag_type_label"), // Custom label like "50kg", "Jute", etc. (copied from lot)
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
  paidAmount: real("paid_amount").default(0), // Amount paid for this sale (includes cash + discount)
  discountAllocated: real("discount_allocated").default(0), // Amount of discount allocated to this sale (actualCashPaid = paidAmount - discountAllocated)
  dueAmount: real("due_amount").default(0), // Amount due for this sale
  paidAt: timestamp("paid_at"), // When marked as paid
  // Timestamps
  entryDate: timestamp("entry_date"), // When lot was originally entered in cold storage (nullable for existing records)
  saleYear: integer("sale_year").notNull(),
  soldAt: timestamp("sold_at").notNull().defaultNow(),
  // Bill numbers (assigned on first print, null means never printed)
  coldStorageBillNumber: integer("cold_storage_bill_number"), // Bill number for cold storage deduction receipt
  salesBillNumber: integer("sales_bill_number"), // Bill number for sales bill
  // Transfer tracking
  clearanceType: text("clearance_type"), // 'cash', 'transfer' - how the payment was cleared
  transferredAmount: real("transferred_amount").default(0), // Amount transferred from previous buyers (liability, not cash)
  transferToBuyerName: text("transfer_to_buyer_name"), // When dues are transferred to another buyer
  transferGroupId: text("transfer_group_id"), // Links transfer-out and transfer-in entries for audit trail
  transferDate: timestamp("transfer_date"), // When the transfer occurred
  transferRemarks: text("transfer_remarks"), // Notes about the transfer
  transferTransactionId: varchar("transfer_transaction_id"), // CF transaction ID for buyer-to-buyer transfers (format: CFYYYYMMDD + natural number)
  transferAmount: real("transfer_amount"), // Original B2B transfer amount (preserved even after FIFO payments)
  // Charge calculation context (recorded at time of sale for edit dialog)
  chargeBasis: text("charge_basis"), // 'actual' or 'totalRemaining' - how charges were calculated
  chargeUnitAtSale: text("charge_unit_at_sale"), // 'bag' or 'quintal' - charge unit used at time of sale (prevents unit mismatch on edit)
  initialNetWeightKg: real("initial_net_weight_kg"), // Lot's net weight at time of sale (for quintal-based charges)
  baseChargeAmountAtSale: real("base_charge_amount_at_sale"), // Base cold charge (cold+hammali portion) at sale time; if 0, base charges already billed
  remainingSizeAtSale: integer("remaining_size_at_sale"), // Remaining bags before this sale (used for totalRemaining charge basis)
  // Extra merchant due (charged to original buyer, not affected by transfers, separate from farmer-centric cold charges)
  extraDueToMerchant: real("extra_due_to_merchant").default(0), // Remaining due (reduced by FIFO payments)
  extraDueToMerchantOriginal: real("extra_due_to_merchant_original").default(0), // Original value set by user (for recompute)
  // Sub-fields for extraDueToMerchant breakdown (sum = extraDueToMerchant)
  extraDueHammaliMerchant: real("extra_due_hammali_merchant").default(0), // Hammali to Merchant
  extraDueGradingMerchant: real("extra_due_grading_merchant").default(0), // Grading Charges to Merchant
  extraDueOtherMerchant: real("extra_due_other_merchant").default(0), // Other Extra to Merchant
  // Entry-time deductions copied from lot at sale time (Advance, Freight/Gadi Bhada, Other)
  advanceDeduction: real("advance_deduction").default(0), // Advance paid to farmer
  freightDeduction: real("freight_deduction").default(0), // Freight / Gadi Bhada charges
  otherDeduction: real("other_deduction").default(0), // Other miscellaneous deductions
  // Self sale flag - when farmer is the buyer (Self checkbox checked)
  isSelfSale: integer("is_self_sale").default(0), // 1 = farmer buying own produce, dues tracked under farmer not cold_merchant
  // Transfer reversal tracking
  isTransferReversed: integer("is_transfer_reversed").default(0), // 0 = active transfer, 1 = reversed
  transferReversedAt: timestamp("transfer_reversed_at"), // When the transfer was reversed
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
  transactionId: varchar("transaction_id"), // Format: CFYYYYMMDD + natural number (e.g., CF202601220)
  coldStorageId: varchar("cold_storage_id").notNull(),
  payerType: text("payer_type").notNull().default("cold_merchant"), // 'cold_merchant', 'sales_goods', 'kata', 'others'
  buyerName: text("buyer_name"), // Required for cold_merchant, sales_goods, others; null for kata
  receiptType: text("receipt_type").notNull(), // 'cash' or 'account'
  accountType: text("account_type"), // DEPRECATED: Use accountId instead. Legacy values: 'limit' or 'current'
  accountId: varchar("account_id"), // Reference to bankAccounts table - new dynamic account system
  amount: real("amount").notNull(),
  receivedAt: timestamp("received_at").notNull(),
  appliedAmount: real("applied_amount").notNull().default(0), // Amount applied to sales
  unappliedAmount: real("unapplied_amount").notNull().default(0), // Remaining amount not yet applied
  dueBalanceAfter: real("due_balance_after"), // Remaining dues for this buyer after this transaction (for cold_merchant type)
  notes: text("notes"),
  isReversed: integer("is_reversed").notNull().default(0), // 0 = active, 1 = reversed
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Expenses - tracks outward cash/account payments
export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey(),
  transactionId: varchar("transaction_id"), // Format: CFYYYYMMDD + natural number (e.g., CF202601220)
  coldStorageId: varchar("cold_storage_id").notNull(),
  expenseType: text("expense_type").notNull(), // 'salary', 'hammali', 'grading_charges', 'general_expenses'
  receiverName: text("receiver_name"), // Name of the person receiving the payment
  paymentMode: text("payment_mode").notNull(), // 'cash' or 'account'
  accountType: text("account_type"), // DEPRECATED: Use accountId instead. Legacy values: 'limit' or 'current'
  accountId: varchar("account_id"), // Reference to bankAccounts table - new dynamic account system
  amount: real("amount").notNull(),
  paidAt: timestamp("paid_at").notNull(),
  remarks: text("remarks"),
  isReversed: integer("is_reversed").notNull().default(0), // 0 = active, 1 = reversed
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Cash Transfers - internal fund movements between account types (self transfers)
export const cashTransfers = pgTable("cash_transfers", {
  id: varchar("id").primaryKey(),
  transactionId: varchar("transaction_id"), // Format: CFYYYYMMDD + natural number (e.g., CF202601220)
  coldStorageId: varchar("cold_storage_id").notNull(),
  fromAccountType: text("from_account_type").notNull(), // 'cash', 'limit', 'current' (or bank account id for new system)
  toAccountType: text("to_account_type").notNull(), // 'cash', 'limit', 'current' (or bank account id for new system)
  fromAccountId: varchar("from_account_id"), // Reference to bankAccounts table - null means 'cash'
  toAccountId: varchar("to_account_id"), // Reference to bankAccounts table - null means 'cash'
  amount: real("amount").notNull(),
  transferredAt: timestamp("transferred_at").notNull(),
  remarks: text("remarks"),
  isReversed: integer("is_reversed").notNull().default(0), // 0 = active, 1 = reversed
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Opening Balances - start of year cash balances
export const cashOpeningBalances = pgTable("cash_opening_balances", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  year: integer("year").notNull(),
  cashInHand: real("cash_in_hand").notNull().default(0),
  limitBalance: real("limit_balance").notNull().default(0),
  currentBalance: real("current_balance").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Opening Receivables - outstanding receivables at start of year
export const openingReceivables = pgTable("opening_receivables", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  year: integer("year").notNull(),
  payerType: text("payer_type").notNull(), // 'cold_merchant', 'sales_goods', 'kata', 'others', 'farmer'
  buyerName: text("buyer_name"),
  // Farmer-specific fields (used when payerType is 'farmer')
  farmerName: text("farmer_name"),
  contactNumber: text("contact_number"),
  village: text("village"),
  tehsil: text("tehsil"),
  district: text("district"),
  state: text("state"),
  dueAmount: real("due_amount").notNull(),
  paidAmount: real("paid_amount").notNull().default(0), // Track FIFO payments against this receivable
  remarks: text("remarks"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Opening Payables - outstanding payables at start of year
export const openingPayables = pgTable("opening_payables", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  year: integer("year").notNull(),
  expenseType: text("expense_type").notNull(), // 'salary', 'hammali', 'grading_charges', 'general_expenses'
  receiverName: text("receiver_name"),
  dueAmount: real("due_amount").notNull(),
  remarks: text("remarks"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Daily ID Counters - tracks sequential counters per entity type per day (globally unique)
export const dailyIdCounters = pgTable("daily_id_counters", {
  id: varchar("id").primaryKey(), // Format: entityType_YYYYMMDD (e.g., "cold_storage_20260125")
  entityType: text("entity_type").notNull(), // 'cold_storage', 'lot', 'sales'
  dateKey: text("date_key").notNull(), // YYYYMMDD format
  counter: integer("counter").notNull().default(0), // Current counter value
});

// Discounts - tracks discount entries to reduce farmer dues via buyer adjustments
export const discounts = pgTable("discounts", {
  id: varchar("id").primaryKey(),
  transactionId: varchar("transaction_id"), // Format: CFYYYYMMDD + natural number (same as other cash flow entries)
  coldStorageId: varchar("cold_storage_id").notNull(),
  // Farmer info
  farmerName: text("farmer_name").notNull(),
  village: text("village").notNull(),
  contactNumber: text("contact_number").notNull(),
  // Discount details
  totalAmount: real("total_amount").notNull(), // Total discount amount
  discountDate: timestamp("discount_date").notNull(),
  remarks: text("remarks"),
  // Buyer allocations stored as JSON array: [{buyerName, amount}]
  buyerAllocations: text("buyer_allocations").notNull(), // JSON string of allocations
  dueBalanceAfter: real("due_balance_after"), // Remaining farmer dues after this discount
  // Status tracking
  isReversed: integer("is_reversed").notNull().default(0), // 0 = active, 1 = reversed
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Farmer to Buyer Transfers - transfers farmer debt (receivables + self-sales) to a buyer
export const farmerToBuyerTransfers = pgTable("farmer_to_buyer_transfers", {
  id: varchar("id").primaryKey(),
  transactionId: varchar("transaction_id"), // Format: CFYYYYMMDD + natural number (same as other cash flow entries)
  coldStorageId: varchar("cold_storage_id").notNull(),
  // Farmer info
  farmerName: text("farmer_name").notNull(),
  village: text("village").notNull(),
  contactNumber: text("contact_number").notNull(),
  // Transfer details
  toBuyerName: text("to_buyer_name").notNull(), // Buyer receiving the debt
  totalAmount: real("total_amount").notNull(), // Total transfer amount
  receivablesTransferred: real("receivables_transferred").notNull().default(0), // Amount from opening_receivables
  selfSalesTransferred: real("self_sales_transferred").notNull().default(0), // Amount from self-sales
  transferDate: timestamp("transfer_date").notNull(),
  remarks: text("remarks"),
  dueBalanceAfter: real("due_balance_after"), // Remaining farmer dues after this transfer
  // Status tracking
  isReversed: integer("is_reversed").notNull().default(0), // 0 = active, 1 = reversed
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Bank Accounts - dynamic bank accounts for cold storage (Current, Limit, Saving)
export const bankAccounts = pgTable("bank_accounts", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  accountName: text("account_name").notNull(), // Free-style name like "SBI-Saving-647567647368"
  accountType: text("account_type").notNull(), // 'current', 'limit', 'saving'
  openingBalance: real("opening_balance").notNull().default(0),
  year: integer("year").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Insert schemas
export const insertColdStorageSchema = createInsertSchema(coldStorages).omit({ id: true });
export const insertColdStorageUserSchema = createInsertSchema(coldStorageUsers).omit({ id: true, createdAt: true });
export const insertChamberSchema = createInsertSchema(chambers).omit({ id: true });
export const insertChamberFloorSchema = createInsertSchema(chamberFloors).omit({ id: true });
export const insertLotSchema = createInsertSchema(lots).omit({ id: true, createdAt: true });
export const insertLotEditHistorySchema = createInsertSchema(lotEditHistory).omit({ id: true, changedAt: true });
export const insertSalesHistorySchema = createInsertSchema(salesHistory).omit({ id: true, soldAt: true });
export const insertSaleEditHistorySchema = createInsertSchema(saleEditHistory).omit({ id: true, changedAt: true });
export const insertMaintenanceRecordSchema = createInsertSchema(maintenanceRecords).omit({ id: true, createdAt: true });
export const insertExitHistorySchema = createInsertSchema(exitHistory).omit({ id: true, billNumber: true, exitDate: true, createdAt: true, isReversed: true, reversedAt: true });
export const insertCashReceiptSchema = createInsertSchema(cashReceipts).omit({ id: true, transactionId: true, createdAt: true, appliedAmount: true, unappliedAmount: true, isReversed: true, reversedAt: true });
export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, transactionId: true, createdAt: true, isReversed: true, reversedAt: true });
export const insertCashTransferSchema = createInsertSchema(cashTransfers).omit({ id: true, transactionId: true, createdAt: true, isReversed: true, reversedAt: true });
export const insertCashOpeningBalanceSchema = createInsertSchema(cashOpeningBalances).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOpeningReceivableSchema = createInsertSchema(openingReceivables).omit({ id: true, createdAt: true });
export const insertOpeningPayableSchema = createInsertSchema(openingPayables).omit({ id: true, createdAt: true });
export const insertDiscountSchema = createInsertSchema(discounts).omit({ id: true, transactionId: true, createdAt: true, isReversed: true, reversedAt: true });
export const insertFarmerToBuyerTransferSchema = createInsertSchema(farmerToBuyerTransfers).omit({ id: true, transactionId: true, createdAt: true, isReversed: true, reversedAt: true });
export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({ id: true, createdAt: true });

// Types
export type ColdStorage = typeof coldStorages.$inferSelect;
export type InsertColdStorage = z.infer<typeof insertColdStorageSchema>;
export type ColdStorageUser = typeof coldStorageUsers.$inferSelect;
export type InsertColdStorageUser = z.infer<typeof insertColdStorageUserSchema>;
export type UserSession = typeof userSessions.$inferSelect;
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
export type CashTransfer = typeof cashTransfers.$inferSelect;
export type InsertCashTransfer = z.infer<typeof insertCashTransferSchema>;
export type CashOpeningBalance = typeof cashOpeningBalances.$inferSelect;
export type InsertCashOpeningBalance = z.infer<typeof insertCashOpeningBalanceSchema>;
export type OpeningReceivable = typeof openingReceivables.$inferSelect;
export type InsertOpeningReceivable = z.infer<typeof insertOpeningReceivableSchema>;
export type OpeningPayable = typeof openingPayables.$inferSelect;
export type InsertOpeningPayable = z.infer<typeof insertOpeningPayableSchema>;
export type DailyIdCounter = typeof dailyIdCounters.$inferSelect;
export type Discount = typeof discounts.$inferSelect;
export type InsertDiscount = z.infer<typeof insertDiscountSchema>;
export type FarmerToBuyerTransfer = typeof farmerToBuyerTransfers.$inferSelect;
export type InsertFarmerToBuyerTransfer = z.infer<typeof insertFarmerToBuyerTransferSchema>;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;

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
  chamberId: z.string().optional().default(""),
  floor: z.number().min(0).optional().default(0),
  position: z.string().optional().default(""),
  type: z.string().min(1, "Type is required"),
  bagType: z.enum(["wafer", "seed", "Ration"]),
  quality: z.enum(["poor", "medium", "good"]).optional().default("medium"),
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
  netWeight: number | null; // Net weight in kg (for quintal-based charging)
  chargeUnit: string; // "bag" or "quintal"
  baseColdChargesBilled: number; // 0 = not billed, 1 = billed (base cold charges already billed)
  // Entry-time deductions from lot
  advanceDeduction: number;
  freightDeduction: number;
  otherDeduction: number;
}

// Dashboard stats type
export interface DashboardStats {
  totalCapacity: number;
  usedCapacity: number;
  peakUtilization: number; // Peak bags ever stored
  currentUtilization: number; // Current bags stored
  totalFarmers: number;
  remainingFarmers: number; // Farmers with lots that still have bags
  totalLots: number;
  remainingLots: number; // Lots with remaining bags
  totalWaferBags: number;
  remainingWaferBags: number;
  totalSeedBags: number;
  remainingSeedBags: number;
  totalRationBags: number;
  remainingRationBags: number;
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
  // Gross totals (for Analytics display)
  totalHammali: number;
  totalGradingCharges: number;
  // Net amounts after expenses (for Cash Management expense dropdowns)
  hammaliDue: number;
  gradingDue: number;
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
  // coldStorageCharge already includes base charges + all extras (kata, extraHammali, grading)
  // Just return it directly - don't add extras again
  return sale.coldStorageCharge || 0;
}

// Canonical helper function to calculate proportional entry deductions
// Formula: (quantitySold / originalLotSize) × totalDeductions
export function calculateProportionalEntryDeductions(params: {
  quantitySold: number;
  originalLotSize: number;
  advanceDeduction: number;
  freightDeduction: number;
  otherDeduction: number;
}): number {
  const totalDeductions = params.advanceDeduction + params.freightDeduction + params.otherDeduction;
  if (params.originalLotSize <= 0 || totalDeductions <= 0) return 0;
  return (params.quantitySold / params.originalLotSize) * totalDeductions;
}
