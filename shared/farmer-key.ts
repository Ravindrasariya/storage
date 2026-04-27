// Canonical farmer-grouping key shared by the Stock Register
// (client view + print view) and the server's pagination boundary.
//
// Without canonicalization, the raw `lots.farmer_name` /
// `lots.contact_number` text drifts across receipts (whitespace,
// NBSP, casing, "+91" prefix) and the same farmer is rendered as
// multiple cards. Two lots with the SAME `farmer_ledger_id` must
// always group into the SAME card; lots that pre-date farmer-ledger
// linking (legacy NULL `farmer_ledger_id`) fall back to a
// normalized phone+name+village key so they still group cleanly.

export function normalizeText(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\u00A0/g, " ") // NBSP -> regular space
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizePhone(p: string | null | undefined): string {
  // Strip all non-digit characters, then drop a leading "91"
  // country prefix when the remainder is a 10-digit Indian mobile.
  const digits = String(p ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

export interface FarmerKeyInput {
  farmerLedgerId?: string | null;
  farmerName?: string | null;
  contactNumber?: string | null;
  village?: string | null;
}

export function farmerGroupKey(lot: FarmerKeyInput): string {
  if (lot.farmerLedgerId) return `lid:${lot.farmerLedgerId}`;
  return `nk:${normalizePhone(lot.contactNumber)}|${normalizeText(lot.farmerName)}|${normalizeText(lot.village)}`;
}
