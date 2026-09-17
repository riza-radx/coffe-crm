"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  parseTableUrlState,
  serializeSortParam,
  type PaginationState,
  type SortingState,
  type TableUrlConfig,
} from "./table-url-state";

type Updater<T> = T | ((old: T) => T);

function resolve<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function" ? (updater as (old: T) => T)(current) : updater;
}

/**
 * Table state derived from the URL — never mirrored into React state, never written
 * from an effect. That is what keeps it from looping: `state` is a pure function of
 * the query string, memoized on that string, and the only writers are event handlers.
 *
 * `config` must be a module-scope constant so its identity is stable.
 */
export function useTableUrlState(config: TableUrlConfig) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // searchParams gets a new identity on every navigation; the string does not.
  const queryString = searchParams.toString();

  const state = useMemo(() => parseTableUrlState(queryString, config), [queryString, config]);

  const write = useCallback(
    (mutate: (params: URLSearchParams) => void, replace = false) => {
      const params = new URLSearchParams(queryString);
      mutate(params);
      const next = params.toString();
      if (next === queryString) return; // no-op guard, cuts any residual loop
      const url = next ? `${pathname}?${next}` : pathname;
      // history API rather than router.push: TanStack Query does the fetching, so
      // there is nothing new for the server component to render on a page change.
      if (replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    },
    [queryString, pathname],
  );

  const onPaginationChange = useCallback(
    (updater: Updater<PaginationState>) => {
      const next = resolve(updater, state.pagination);
      write((params) => {
        params.set("page", String(next.pageIndex + 1)); // URL is 1-based, table is 0-based
        params.set("pageSize", String(next.pageSize));
      });
    },
    [state.pagination, write],
  );

  const onSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const next = resolve(updater, state.sorting);
      write((params) => {
        const serialized = serializeSortParam(next);
        if (serialized) params.set("sort", serialized);
        else params.delete("sort");
        params.set("page", "1");
      });
    },
    [state.sorting, write],
  );

  const setFilter = useCallback(
    (key: string, value: string | null) => {
      write((params) => {
        if (value) params.set(key, value);
        else params.delete(key);
        params.set("page", "1");
      }, true);
    },
    [write],
  );

  return { state, onPaginationChange, onSortingChange, setFilter };
}
