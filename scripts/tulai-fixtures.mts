// Synthetic development-only fixtures shared by Tulai API and browser checks.
import pg from "pg";
import { requireDevelopmentFixtures } from "./require-development-fixtures.mts";
requireDevelopmentFixtures();
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const id = `__tulai_${Date.now()}_${process.pid}`;
export const token = `${id}_session`;
export const farmerId = `${id}_farmer`;
export const auth = { "x-auth-token": token, "Content-Type": "application/json" };

export async function setup() {
  const { initializeSauda } = await import("../server/sauda-migration.ts");
  await initializeSauda();
  for (const cs of [id, `${id}_other`]) {
    await pool.query(`INSERT INTO cold_storages
      (id,name,total_capacity,wafer_rate,seed_rate,seed_cold_charge,seed_hammali,
       wafer_cold_charge,wafer_hammali,charge_unit,linked_phones,status)
      VALUES ($1,'Tulai Test',10000,60,60,50,10,50,10,'bag','{}','active')`, [cs]);
  }
  await pool.query(`INSERT INTO chambers (id,cold_storage_id,name,capacity,current_fill)
    VALUES ($1,$2,'Tulai Chamber',10000,1000)`, [`${id}_chamber`, id]);
  await pool.query(`INSERT INTO farmer_ledger
    (id,cold_storage_id,farmer_id,name,contact_number,village,tehsil,district,state,entity_type)
    VALUES ($1,$2,$3,'Tulai Farmer','0000000000','Tulai Village','T','D','S','farmer')`,
    [farmerId, id, `${id}_FM`]);
  await pool.query(`INSERT INTO cold_storage_users
    (id,cold_storage_id,name,mobile_number,password,access_type)
    VALUES ($1,$2,'Tulai Operator',$3,'fixture','edit')`,
    [`${id}_user`, id, `9${Date.now().toString().slice(-9)}`]);
  await pool.query(`INSERT INTO user_sessions (id,user_id,cold_storage_id)
    VALUES ($1,$2,$3)`, [token, `${id}_user`, id]);
}

export async function lot(name: string, baseBilled = 0) {
  const lotId = `${id}_lot_${name}`;
  await pool.query(`INSERT INTO lots
    (id,cold_storage_id,farmer_name,village,tehsil,district,state,contact_number,
     lot_no,marka,size,remaining_size,chamber_id,floor,position,type,bag_type,quality,
     potato_size,assaying_type,up_for_sale,sale_status,base_cold_charges_billed,
     farmer_ledger_id,net_weight,created_at)
    VALUES ($1,$2,'Tulai Farmer','Tulai Village','T','D','S','0000000000',
      $3,$3,100,100,$4,0,'P1','seed','seed','good','large','self',0,'available',$5,$6,5000,
      '2016-03-01T12:00:00+05:30')`,
    [lotId, id, name, `${id}_chamber`, baseBilled, farmerId]);
  return lotId;
}

export async function cleanup() {
  await pool.query(`DELETE FROM sale_edit_history WHERE sale_id IN
    (SELECT id FROM sales_history WHERE cold_storage_id=$1)`, [id]);
  await pool.query(`DELETE FROM lot_edit_history WHERE lot_id IN
    (SELECT id FROM lots WHERE cold_storage_id=$1)`, [id]);
  for (const table of ["reversed_sales_archive", "reversed_exits_archive", "cash_receipt_applications", "cash_receipts", "expenses",
    "exit_history", "sales_history", "lots", "chambers", "farmer_ledger",
    "buyer_ledger", "bank_accounts", "cash_transfers"]) {
    await pool.query(`DELETE FROM ${table} WHERE cold_storage_id IN ($1,$2)`, [id, `${id}_other`]);
  }
  await pool.query(`DELETE FROM user_sessions WHERE id=$1`, [token]);
  await pool.query(`DELETE FROM cold_storage_users WHERE id=$1`, [`${id}_user`]);
  await pool.query(`DELETE FROM cold_storages WHERE id IN ($1,$2)`, [id, `${id}_other`]);
  await pool.end();
}

// Historical, pre-Sauda sale fixture with no physical exit. This is deliberately
// not an HTTP endpoint: production cannot use it to create individual sales.
export async function legacySaleFixture(lotId: string, options: { tulaiCharges?: number; remarks?: string; netWeight?: number; pricePerKg?: number } = {}) {
  requireDevelopmentFixtures();
  const saleId = `${id}_legacy_${lotId}`;
  const tulai = options.tulaiCharges ?? 50;
  await pool.query(`INSERT INTO sales_history
    (id,cold_storage_id,lot_id,farmer_name,village,tehsil,district,state,contact_number,
     lot_no,marka,chamber_name,floor,position,potato_type,bag_type,quality,original_lot_size,
     sale_type,quantity_sold,price_per_bag,cold_charge,hammali,cold_storage_charge,payment_status,
     paid_amount,due_amount,entry_date,sale_year,sold_at,is_self_sale,farmer_ledger_id,
     kata_charges,tulai_charges,extra_hammali,grading_charges,remarks,net_weight,price_per_kg,
     base_charge_amount_at_sale,base_hammali_amount,remaining_size_at_sale,charge_basis,charge_unit_at_sale,
     cold_storage_bill_number)
    SELECT $1,cold_storage_id,id,farmer_name,village,tehsil,district,state,contact_number,
      lot_no,marka,'Tulai Chamber',floor,position,type,bag_type,quality,size,
      'partial',10,60,50,10,690+$2,'due',0,690+$2,created_at,2016,'2016-06-15T12:00:00+05:30',1,farmer_ledger_id,
      20,$2,30,40,$3,$4,$5,600,100,100,'actual','bag',
      (SELECT COALESCE(MAX(cold_storage_bill_number),0)+1 FROM sales_history WHERE cold_storage_id=$6)
    FROM lots WHERE id=$7 AND cold_storage_id=$6`,
    [saleId, tulai, options.remarks ?? null, options.netWeight ?? 500, options.pricePerKg ?? 20, id, lotId]);
  await pool.query(`UPDATE lots SET remaining_size=90,total_due_charge=690+$1 WHERE id=$2 AND cold_storage_id=$3`, [tulai, lotId, id]);
  return (await pool.query(`SELECT * FROM sales_history WHERE id=$1`, [saleId])).rows[0];
}
