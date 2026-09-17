"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTable } from "@tanstack/react-table";
import { listFeatures, NO_ROWS } from "@/lib/table/features";
import { toListQuery, type TableUrlConfig } from "@/lib/table/table-url-state";
import { useTableUrlState } from "@/lib/table/use-table-url-state";
import { clientKeys } from "@/lib/query/keys";
import { fetchJson, toQueryString } from "@/lib/api/fetch-json";
import { CLIENT_SORTABLE } from "@/lib/validation/clients";
import type { ClientRow } from "@/lib/queries/clients";
import type { Paginated } from "@/lib/validation/list-query";
import { DataTable } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { FilterBar, FilterSelect, FilterText } from "@/components/ui/filter-bar";
import { CLIENT_COLUMN_COUNT, clientColumns } from "./clients-columns";

const URL_CONFIG: TableUrlConfig = {
  sortable: CLIENT_SORTABLE,
  filterKeys: ["search", "type", "city", "status", "salesOwner"],
  defaultSort: "createdAt:desc",
};

const TYPES = ["BAR", "RESTAURANT", "HOTEL", "HOME", "OFFICE", "OTHER"] as const;
const STATUSES = ["LEAD", "ACTIVE", "INACTIVE", "LOST"] as const;

export function ClientsTable() {
  const url = useTableUrlState(URL_CONFIG);
  const params = toListQuery(url.state);

  const query = useQuery({
    queryKey: clientKeys.list(params),
    queryFn: () => fetchJson<Paginated<ClientRow>>(`/api/clients${toQueryString(params)}`),
    placeholderData: keepPreviousData,
  });

  const table = useTable({
    features: listFeatures,
    columns: clientColumns,
    data: query.data?.data ?? (NO_ROWS as ClientRow[]),
    rowCount: query.data?.total ?? 0,
    manualPagination: true,
    manualSorting: true,
    state: { pagination: url.state.pagination, sorting: url.state.sorting },
    onPaginationChange: url.onPaginationChange,
    onSortingChange: url.onSortingChange,
  });

  return (
    <>
      <FilterBar>
        <FilterText
          label="Kërko"
          value={url.state.filters.search ?? ""}
          onChange={(value) => url.setFilter("search", value)}
          placeholder="emër, kontakt, qytet"
        />
        <FilterSelect
          label="Tipi"
          value={url.state.filters.type ?? ""}
          onChange={(value) => url.setFilter("type", value)}
          options={TYPES}
        />
        <FilterSelect
          label="Statusi"
          value={url.state.filters.status ?? ""}
          onChange={(value) => url.setFilter("status", value)}
          options={STATUSES}
        />
        <FilterText
          label="Qyteti"
          value={url.state.filters.city ?? ""}
          onChange={(value) => url.setFilter("city", value)}
        />
      </FilterBar>

      <DataTable
        table={table}
        columnCount={CLIENT_COLUMN_COUNT}
        isLoading={query.isFetching}
        error={query.isError ? "Lista nuk u ngarkua dot." : null}
        emptyMessage="Asnjë klient me këta filtra."
      />
      <DataTablePagination table={table} total={query.data?.total ?? 0} />
    </>
  );
}
