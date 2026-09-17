import { rowPaginationFeature, rowSortingFeature, tableFeatures } from "@tanstack/react-table";

/**
 * Server-driven table: the sorting and pagination features are registered for their
 * state and APIs, but none of the client-side row models are — Postgres does the
 * sorting and slicing, and `data` is already exactly the page.
 *
 * Module scope on purpose: a new object here rebuilds the table's models every render.
 */
export const listFeatures = tableFeatures({ rowSortingFeature, rowPaginationFeature });

/** Stable fallback; `?? []` would allocate a new array on every render. */
export const NO_ROWS: never[] = [];
