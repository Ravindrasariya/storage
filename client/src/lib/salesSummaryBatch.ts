/**
 * Keep sales-summary requests comfortably below both the API's 1,000-ID
 * safety limit and ordinary proxy/request-line limits. UUID lot IDs make a
 * 1,000-ID GET URL roughly 37KB, so respecting only the API count limit is
 * not sufficient.
 */
export const SALES_SUMMARY_BATCH_SIZE = 200;

export type SalesSummaryMap<T> = Record<string, T[]>;

export async function loadSalesSummaryBatches<T>(
  lotIds: string[],
  fetchBatch: (lotIds: string[]) => Promise<SalesSummaryMap<T>>,
  batchSize = SALES_SUMMARY_BATCH_SIZE,
): Promise<SalesSummaryMap<T>> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error("Sales-summary batch size must be between 1 and 1000");
  }

  const uniqueLotIds = Array.from(new Set(lotIds.filter(Boolean))).sort();
  const merged: SalesSummaryMap<T> = {};

  // Deliberately sequential: a broad filter may span many thousands of lots.
  // Bounded request size should not turn into an unbounded burst of concurrent
  // database queries.
  for (let offset = 0; offset < uniqueLotIds.length; offset += batchSize) {
    const batch = uniqueLotIds.slice(offset, offset + batchSize);
    const summary = await fetchBatch(batch);
    Object.assign(merged, summary);
  }

  return merged;
}