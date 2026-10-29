import { calculateTotalColdCharges } from "@shared/schema";

export type SalesSort = {
  field: "soldAt" | "farmerName" | "coldStorageCharge";
  direction: "asc" | "desc";
};

export type SalesSortRow = {
  soldAt: Date | string;
  farmerName: string;
  coldStorageCharge: number;
};

export function nextSalesSort(current: SalesSort | null, field: SalesSort["field"]): SalesSort {
  return {
    field,
    direction: current?.field === field
      ? current.direction === "asc" ? "desc" : "asc"
      : field === "farmerName" ? "asc" : "desc",
  };
}

export function sortSalesHistory<T extends SalesSortRow>(
  rows: readonly T[],
  sort: SalesSort | null,
  language: string,
): T[] {
  if (!sort) return [...rows];
  const collator = new Intl.Collator(language, { sensitivity: "base" });
  const sign = sort.direction === "asc" ? 1 : -1;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    let comparison: number;
    if (sort.field === "farmerName") {
      comparison = collator.compare(a.row.farmerName.trim(), b.row.farmerName.trim());
    } else {
      const value = (row: T) => sort.field === "soldAt"
        ? new Date(row.soldAt).getTime()
        : calculateTotalColdCharges(row);
      const left = value(a.row);
      const right = value(b.row);
      // Unusable legacy values stay last in either direction.
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return Number.isFinite(left) ? -1 : Number.isFinite(right) ? 1 : a.index - b.index;
      }
      comparison = left - right;
    }
    return comparison * sign || a.index - b.index;
  }).map(({ row }) => row);
}
