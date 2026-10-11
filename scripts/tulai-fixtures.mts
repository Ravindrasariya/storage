// Synthetic development-only fixtures shared by Tulai API and browser checks.
import pg from "pg";
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const id = `__tulai_${Date.now()}_${process.pid}`;
export const token = `${id}_session`;
export const farmerId = `${id}_farmer`;
export const auth = { "x-auth-token": token, "Content-Type": "application/json" };

export async function setup() {
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
  for (const table of ["cash_receipt_applications", "cash_receipts", "expenses",
    "exit_history", "sales_history", "lots", "chambers", "farmer_ledger",
    "buyer_ledger", "bank_accounts", "cash_transfers"]) {
    await pool.query(`DELETE FROM ${table} WHERE cold_storage_id IN ($1,$2)`, [id, `${id}_other`]);
  }
  await pool.query(`DELETE FROM user_sessions WHERE id=$1`, [token]);
  await pool.query(`DELETE FROM cold_storage_users WHERE id=$1`, [`${id}_user`]);
  await pool.query(`DELETE FROM cold_storages WHERE id IN ($1,$2)`, [id, `${id}_other`]);
  await pool.end();
}
