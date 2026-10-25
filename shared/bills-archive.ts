/** Wire format for the tracking-only archive. Missing legacy fields stay absent. */
export interface ArchiveRecord {
  id: string;
  originalId: string;
  coldStorageId: string;
  reversedAt: string | null;
  archivedAt: string;
  operatorName: string | null;
  source: "reversal" | "legacy";
  sale: Record<string, any> | null;
  exit: Record<string, any> | null;
  lot: Record<string, any> | null;
  display: Record<string, any>;
}
