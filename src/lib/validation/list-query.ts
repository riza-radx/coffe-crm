import { z } from "zod";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Query-string values arrive as "" when a filter input is cleared. Dropping the
 * empty ones lets every schema keep plain `.default()`s instead of coercing "" to 0.
 */
export function searchParamsToObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (value !== "") out[key] = value;
  }
  return out;
}

export type SortDirection = "asc" | "desc";
export type ParsedSort = { field: string; direction: SortDirection };

/**
 * `sort` is "<field>" or "<field>:asc|desc". The field must be on an allowlist —
 * it goes straight into Prisma's `orderBy`, so a free-form string is not acceptable.
 */
export function sortParamSchema<const F extends readonly [string, ...string[]]>(
  sortable: F,
  fallback: `${F[number]}:${SortDirection}`,
) {
  const pattern = new RegExp(`^(${sortable.join("|")})(:(asc|desc))?$`);
  return z
    .string()
    .regex(pattern, { error: "Fushë renditjeje e panjohur" })
    .default(fallback);
}

export function parseSort(raw: string): ParsedSort {
  const [field, direction] = raw.split(":");
  return { field, direction: direction === "asc" ? "asc" : "desc" };
}

export function orderByFromSort(raw: string): Record<string, SortDirection> {
  const { field, direction } = parseSort(raw);
  return { [field]: direction };
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export function pageSlice(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export type Paginated<T> = { data: T[]; page: number; pageSize: number; total: number };
