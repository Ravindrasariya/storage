import { z } from "zod";

export const SALE_REMARK_MAX_LENGTH = 500;

// Validate before trimming so API callers cannot hide line breaks at the ends.
// Optional preserves PATCH omission; null/blank explicitly clears the remark.
export const saleRemarkSchema = z.string()
  .max(SALE_REMARK_MAX_LENGTH)
  .regex(/^[^\r\n\u0085\u2028\u2029\u0000]*$/, "Remarks must be a single line")
  .transform(value => value.trim() || null)
  .nullable()
  .optional();
