import { z } from "zod";

/** `<input type="date">` and our JSON both use YYYY-MM-DD; one schema for both sides. */
export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Datë e pavlefshme (YYYY-MM-DD)" })
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`)), { error: "Datë e pavlefshme" });

export function toUtcDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

export function toDateOnly(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

/** Trimmed, and "" becomes undefined so an empty form field clears rather than stores "". */
export const OptionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const CUID = z.string().min(1).max(64);
