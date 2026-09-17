"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTable } from "@tanstack/react-table";
import { listFeatures, NO_ROWS } from "@/lib/table/features";
import { toListQuery, type TableUrlConfig } from "@/lib/table/table-url-state";
import { useTableUrlState } from "@/lib/table/use-table-url-state";
import { contractKeys } from "@/lib/query/keys";
import { fetchJson, toQueryString } from "@/lib/api/fetch-json";
import { CONTRACT_SORTABLE } from "@/lib/validation/contracts";
import type { ContractRow } from "@/lib/queries/contracts";
import type { Paginated } from "@/lib/validation/list-query";
import { DataTable } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { CONTRACT_COLUMN_COUNT, contractColumns } from "./contracts-columns";

const URL_CONFIG: TableUrlConfig = {
  sortable: CONTRACT_SORTABLE,
  filterKeys: ["status", "clientId", "salesOwner"],
  defaultSort: "createdAt:desc",
};

const STATUSES = ["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"] as const;

export function ContractsTable() {
  const url = useTableUrlState(URL_CONFIG);
  const params = toListQuery(url.state);

  const query = useQuery({
    queryKey: contractKeys.list(params),
    queryFn: () => fetchJson<Paginated<ContractRow>>(`/api/contracts${toQueryString(params)}`),
    placeholderData: keepPreviousData,
  });

  const table = useTable({
    features: listFeatures,
    columns: contractColumns,
    data: query.data?.data ?? (NO_ROWS as ContractRow[]),
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
      </FilterBar>

      <DataTable
        table={table}
        columnCount={CONTRACT_COLUMN_COUNT}
        isLoading={query.isFetching}
        error={query.isError ? "Lista nuk u ngarkua dot." : null}
        emptyMessage="Asnjë kontratë me këta filtra."
      />
      <DataTablePagination table={table} total={query.data?.total ?? 0} />
    </>
  );
}
