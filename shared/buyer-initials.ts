import { z } from "zod";

export const BUYER_INITIALS_MAX_LENGTH = 4;
export const normalizeBuyerInitials = (value: string) => value.trim().toUpperCase();
export const buyerInitialsTooLong = (value: string) =>
  normalizeBuyerInitials(value).length > BUYER_INITIALS_MAX_LENGTH;

// Validate after uppercasing: some letters expand (for example, ß → SS).
export const buyerInitialsSchema = z.string()
  .transform(normalizeBuyerInitials)
  .pipe(z.string().max(BUYER_INITIALS_MAX_LENGTH, "Initials must be at most 4 characters."))
  .nullable()
  .optional();
