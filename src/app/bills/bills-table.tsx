"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTable } from "@tanstack/react-table";
import { listFeatures, NO_ROWS } from "@/lib/table/features";
import { toListQuery, type TableUrlConfig } from "@/lib/table/table-url-state";
import { useTableUrlState } from "@/lib/table/use-table-url-state";
import { billKeys } from "@/lib/query/keys";
import { fetchJson, toQueryString } from "@/lib/api/fetch-json";
import { BILL_SORTABLE } from "@/lib/validation/bills";
import type { BillRow } from "@/lib/queries/bills";
import type { Paginated } from "@/lib/validation/list-query";
import { DataTable } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { FilterBar, FilterSelect, FilterText } from "@/components/ui/filter-bar";
import { BILL_COLUMN_COUNT, billColumns } from "./bills-columns";

const URL_CONFIG: TableUrlConfig = {
  sortable: BILL_SORTABLE,
  filterKeys: ["status", "contractId", "clientId", "dateFrom", "dateTo"],
  defaultSort: "billDate:desc",
};

const STATUSES = ["PENDING", "VERIFIED", "DISPUTED", "VOID"] as const;

export function BillsTable() {
  const url = useTableUrlState(URL_CONFIG);
  const params = toListQuery(url.state);

  const query = useQuery({
    queryKey: billKeys.list(params),
    queryFn: () => fetchJson<Paginated<BillRow>>(`/api/bills${toQueryString(params)}`),
    placeholderData: keepPreviousData,
  });

  const table = useTable({
    features: listFeatures,
    columns: billColumns,
    data: query.data?.data ?? (NO_ROWS as BillRow[]),
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
        <FilterSelect
          label="Statusi"
          value={url.state.filters.status ?? ""}
          onChange={(value) => url.setFilter("status", value)}
          options={STATUSES}
        />
        <FilterText
          label="Nga data"
          value={url.state.filters.dateFrom ?? ""}
          onChange={(value) => url.setFilter("dateFrom", value)}
          placeholder="YYYY-MM-DD"
        />
        <FilterText
          label="Deri më"
          value={url.state.filters.dateTo ?? ""}
          onChange={(value) => url.setFilter("dateTo", value)}
          placeholder="YYYY-MM-DD"
        />
      </FilterBar>

      <DataTable
        table={table}
        columnCount={BILL_COLUMN_COUNT}
        isLoading={query.isFetching}
        error={query.isError ? "Lista nuk u ngarkua dot." : null}
        emptyMessage="Asnjë faturë me këta filtra."
      />
      <DataTablePagination table={table} total={query.data?.total ?? 0} />
    </>
  );
}
