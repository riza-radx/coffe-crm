/**
 * The URL is the single source of truth for table state, so filters and pages are
 * shareable and bookmarkable. This module is the pure, React-free core of that
 * contract — everything interesting is testable under vitest's node environment.
 */
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/validation/list-query";

export type SortingState = Array<{ id: string; desc: boolean }>;
export type PaginationState = { pageIndex: number; pageSize: number };

export type TableUrlConfig = {
  readonly sortable: readonly string[];
  readonly filterKeys: readonly string[];
  readonly defaultSort: string;
  readonly defaultPageSize?: number;
};

export type TableUrlState = {
  pagination: PaginationState;
  sorting: SortingState;
  filters: Record<string, string>;
  /** The `sort` value to send to the API, always an allowlisted field. */
  sort: string;
};

/** "createdAt:desc" -> [{ id: "createdAt", desc: true }] */
export function parseSortParam(raw: string | null, allowed: readonly string[]): SortingState {
  const [id, direction] = (raw ?? "").split(":");
  if (!id || !allowed.includes(id)) return [];
  return [{ id, desc: direction !== "asc" }];
}

export function serializeSortParam(sorting: SortingState): string | null {
  const first = sorting[0];
  return first ? `${first.id}:${first.desc ? "desc" : "asc"}` : null;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  // Number(null) and Number("") are 0, which is an integer — so absence has to be
  // checked before the numeric test, or a missing pageSize would clamp to `min`.
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export function parseTableUrlState(queryString: string, config: TableUrlConfig): TableUrlState {
  const params = new URLSearchParams(queryString);
  const defaultPageSize = config.defaultPageSize ?? DEFAULT_PAGE_SIZE;

  const page = clampInt(params.get("page"), 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(params.get("pageSize"), defaultPageSize, 1, MAX_PAGE_SIZE);

  const sorting = parseSortParam(params.get("sort"), config.sortable);
  const sort = serializeSortParam(sorting) ?? config.defaultSort;

  const filters: Record<string, string> = {};
  for (const key of config.filterKeys) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }

  return { pagination: { pageIndex: page - 1, pageSize }, sorting, filters, sort };
}

/** The exact query object the API (and the TanStack Query key) receives. */
export function toListQuery(state: TableUrlState): Record<string, string | number> {
  return {
    page: state.pagination.pageIndex + 1,
    pageSize: state.pagination.pageSize,
    sort: state.sort,
    ...state.filters,
  };
}
