/**
 * Backfill Farmer Ledger IDs for Existing Lots
 * 
 * This script:
 * 1. Scans all lots that don't have a farmerLedgerId
 * 2. For each unique farmer (name + contact + village), creates/finds farmer ledger entry
 * 3. Updates the lot with the farmerLedgerId
 * 
 * Usage:
 *   DRY_RUN=true npx tsx scripts/backfill-farmer-ids.ts   # Preview changes
 *   npx tsx scripts/backfill-farmer-ids.ts                 # Apply changes
 * 
 * Environment variables:
 *   DATABASE_URL - PostgreSQL connection string
 *   DRY_RUN      - Set to "true" to preview without making changes
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

// Schema definitions (inline to avoid import issues)
import { pgTable, varchar, text, integer, real, timestamp } from "drizzle-orm/pg-core";

const lots = pgTable("lots", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  farmerName: text("farmer_name").notNull(),
  village: text("village").notNull(),
  tehsil: text("tehsil").notNull(),
  district: text("district").notNull(),
  state: text("state").notNull(),
  contactNumber: text("contact_number").notNull(),
  lotNo: text("lot_no").notNull(),
  entrySequence: integer("entry_sequence"),
  size: integer("size").notNull(),
  netWeight: real("net_weight"),
  remainingSize: integer("remaining_size").notNull(),
  chamberId: varchar("chamber_id").notNull(),
  floor: integer("floor").notNull(),
  position: text("position").notNull(),
  type: text("type").notNull(),
  bagType: text("bag_type").notNull(),
  bagTypeLabel: text("bag_type_label"),
  quality: text("quality").notNull(),
  potatoSize: text("potato_size").notNull(),
  assayingType: text("assaying_type").notNull(),
  assayerImage: text("assayer_image"),
  reducingSugar: real("reducing_sugar"),
  dm: real("dm"),
  remarks: text("remarks"),
  upForSale: integer("up_for_sale").notNull(),
  saleStatus: text("sale_status").notNull(),
  paymentStatus: text("payment_status"),
  saleCharge: real("sale_charge"),
  totalPaidCharge: real("total_paid_charge"),
  totalDueCharge: real("total_due_charge"),
  soldAt: timestamp("sold_at"),
  createdAt: timestamp("created_at").notNull(),
  entryBillNumber: integer("entry_bill_number"),
  baseColdChargesBilled: integer("base_cold_charges_billed").notNull(),
  advanceDeduction: real("advance_deduction"),
  freightDeduction: real("freight_deduction"),
  otherDeduction: real("other_deduction"),
  farmerLedgerId: varchar("farmer_ledger_id"),
});

const farmerLedger = pgTable("farmer_ledger", {
  id: varchar("id").primaryKey(),
  coldStorageId: varchar("cold_storage_id").notNull(),
  farmerId: text("farmer_id").notNull(),
  name: text("name").notNull(),
  contactNumber: text("contact_number").notNull(),
  village: text("village").notNull(),
  tehsil: text("tehsil"),
  district: text("district"),
  state: text("state"),
  isFlagged: integer("is_flagged").notNull(),
  isArchived: integer("is_archived").notNull(),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull(),
});

// Helper functions
function getFarmerCompositeKey(name: string, contactNumber: string, village: string): string {
  return `${name.trim().toLowerCase()}_${contactNumber.trim()}_${village.trim().toLowerCase()}`;
}

async function generateFarmerId(db: any, coldStorageId: string): Promise<string> {
  const now = new Date();
  const dateKey = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  
  const existingFarmers = await db.select({ farmerId: farmerLedger.farmerId })
    .from(farmerLedger)
    .where(and(
      eq(farmerLedger.coldStorageId, coldStorageId),
      sql`${farmerLedger.farmerId} LIKE ${'FM' + dateKey + '%'}`
    ));
  
  let maxCounter = 0;
  for (const f of existingFarmers) {
    const numPart = f.farmerId.replace('FM' + dateKey, '');
    const counter = parseInt(numPart, 10);
    if (!isNaN(counter) && counter > maxCounter) {
      maxCounter = counter;
    }
  }
  
  return `FM${dateKey}${maxCounter + 1}`;
}

async function main() {
  const dryRun = process.env.DRY_RUN === 'true';
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required");
    process.exit(1);
  }
  
  console.log(`\n=== Farmer Ledger Backfill Script ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (changes will be applied)'}`);
  console.log(`Database: ${databaseUrl.substring(0, 30)}...`);
  console.log(`Started at: ${new Date().toISOString()}\n`);
  
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  
  try {
    // Step 1: Get all lots without farmerLedgerId
    console.log("Step 1: Finding lots without farmer ledger links...");
    const lotsWithoutFarmerId = await db.select()
      .from(lots)
      .where(isNull(lots.farmerLedgerId));
    
    console.log(`Found ${lotsWithoutFarmerId.length} lots without farmerLedgerId\n`);
    
    if (lotsWithoutFarmerId.length === 0) {
      console.log("No lots need updating. Exiting.");
      await pool.end();
      return;
    }
    
    // Step 2: Group lots by cold storage and farmer composite key
    const coldStorageGroups = new Map<string, Map<string, {
      lots: typeof lotsWithoutFarmerId;
      farmerData: {
        name: string;
        contactNumber: string;
        village: string;
        tehsil: string;
        district: string;
        state: string;
      };
    }>>();
    
    for (const lot of lotsWithoutFarmerId) {
      const key = getFarmerCompositeKey(lot.farmerName, lot.contactNumber, lot.village);
      
      if (!coldStorageGroups.has(lot.coldStorageId)) {
        coldStorageGroups.set(lot.coldStorageId, new Map());
      }
      
      const farmerMap = coldStorageGroups.get(lot.coldStorageId)!;
      
      if (!farmerMap.has(key)) {
        farmerMap.set(key, {
          lots: [],
          farmerData: {
            name: lot.farmerName,
            contactNumber: lot.contactNumber,
            village: lot.village,
            tehsil: lot.tehsil,
            district: lot.district,
            state: lot.state,
          }
        });
      }
      
      farmerMap.get(key)!.lots.push(lot);
    }
    
    console.log(`Step 2: Grouped into ${coldStorageGroups.size} cold storages\n`);
    
    let totalFarmersCreated = 0;
    let totalFarmersLinked = 0;
    let totalLotsUpdated = 0;
    
    // Step 3: Process each cold storage
    for (const [coldStorageId, farmerMap] of Array.from(coldStorageGroups.entries())) {
      console.log(`\nProcessing cold storage: ${coldStorageId}`);
      console.log(`  Unique farmers: ${farmerMap.size}`);
      
      // Get existing farmer ledger entries for this cold storage
      const existingFarmers = await db.select()
        .from(farmerLedger)
        .where(eq(farmerLedger.coldStorageId, coldStorageId));
      
      const existingFarmerKeys = new Map<string, string>();
      for (const f of existingFarmers) {
        const key = getFarmerCompositeKey(f.name, f.contactNumber, f.village);
        existingFarmerKeys.set(key, f.id);
      }
      
      console.log(`  Existing farmer ledger entries: ${existingFarmers.length}`);
      
      for (const [farmerKey, { lots: farmerLots, farmerData }] of Array.from(farmerMap.entries())) {
        let farmerLedgerId: string;
        
        if (existingFarmerKeys.has(farmerKey)) {
          // Farmer already exists
          farmerLedgerId = existingFarmerKeys.get(farmerKey)!;
          totalFarmersLinked++;
          console.log(`    LINK: ${farmerData.name} (${farmerData.contactNumber}, ${farmerData.village}) -> existing ${farmerLedgerId.substring(0, 8)}...`);
        } else {
          // Create new farmer
          const farmerId = await generateFarmerId(db, coldStorageId);
          farmerLedgerId = randomUUID();
          
          if (!dryRun) {
            await db.insert(farmerLedger).values({
              id: farmerLedgerId,
              coldStorageId,
              farmerId,
              name: farmerData.name.trim(),
              contactNumber: farmerData.contactNumber.trim(),
              village: farmerData.village.trim(),
              tehsil: farmerData.tehsil?.trim() || null,
              district: farmerData.district?.trim() || null,
              state: farmerData.state?.trim() || null,
              isFlagged: 0,
              isArchived: 0,
            } as any);
          }
          
          existingFarmerKeys.set(farmerKey, farmerLedgerId);
          totalFarmersCreated++;
          console.log(`    CREATE: ${farmerData.name} (${farmerData.contactNumber}, ${farmerData.village}) -> ${farmerId}`);
        }
        
        // Update all lots for this farmer
        for (const lot of farmerLots) {
          if (!dryRun) {
            await db.update(lots)
              .set({ farmerLedgerId })
              .where(eq(lots.id, lot.id));
          }
          totalLotsUpdated++;
        }
        
        console.log(`      Updated ${farmerLots.length} lots`);
      }
    }
    
    console.log(`\n=== Summary ===`);
    console.log(`Farmers created: ${totalFarmersCreated}`);
    console.log(`Farmers linked (already existed): ${totalFarmersLinked}`);
    console.log(`Lots updated: ${totalLotsUpdated}`);
    console.log(`Completed at: ${new Date().toISOString()}`);
    
    if (dryRun) {
      console.log(`\n*** DRY RUN - No changes were made ***`);
      console.log(`Run without DRY_RUN=true to apply changes.`);
    }
    
  } catch (error) {
    console.error("\nERROR during backfill:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
