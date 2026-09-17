"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTable } from "@tanstack/react-table";
import { listFeatures, NO_ROWS } from "@/lib/table/features";
import { toListQuery, type TableUrlConfig } from "@/lib/table/table-url-state";
import { useTableUrlState } from "@/lib/table/use-table-url-state";
import { auditLogKeys } from "@/lib/query/keys";
import { fetchJson, toQueryString } from "@/lib/api/fetch-json";
import { AUDIT_SORTABLE } from "@/lib/validation/audit-logs";
import type { AuditLogRow } from "@/lib/queries/audit-logs";
import type { Paginated } from "@/lib/validation/list-query";
import { DataTable } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { FilterBar, FilterSelect, FilterText } from "@/components/ui/filter-bar";
import { AUDIT_COLUMN_COUNT, auditLogColumns } from "./audit-logs-columns";

const URL_CONFIG: TableUrlConfig = {
  sortable: AUDIT_SORTABLE,
  filterKeys: ["entityType", "entityId", "actorId", "action", "dateFrom", "dateTo"],
  defaultSort: "createdAt:desc",
};

const ENTITY_TYPES = ["CONTRACT", "BILL", "CLIENT", "USER", "COMMISSION"] as const;
const ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "STATUS_CHANGE",
  "VERIFY",
  "DISPUTE",
  "VOID",
  "APPROVE",
  "PAY",
] as const;

export function AuditLogsTable() {
  const url = useTableUrlState(URL_CONFIG);
  const params = toListQuery(url.state);

  const query = useQuery({
    queryKey: auditLogKeys.list(params),
    queryFn: () => fetchJson<Paginated<AuditLogRow>>(`/api/audit-logs${toQueryString(params)}`),
    placeholderData: keepPreviousData,
  });

  const table = useTable({
    features: listFeatures,
    columns: auditLogColumns,
    data: query.data?.data ?? (NO_ROWS as AuditLogRow[]),
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
          label="Entiteti"
          value={url.state.filters.entityType ?? ""}
          onChange={(value) => url.setFilter("entityType", value)}
          options={ENTITY_TYPES}
        />
        <FilterSelect
          label="Veprimi"
          value={url.state.filters.action ?? ""}
          onChange={(value) => url.setFilter("action", value)}
          options={ACTIONS}
        />
        <FilterText
          label="ID e entitetit"
          value={url.state.filters.entityId ?? ""}
          onChange={(value) => url.setFilter("entityId", value)}
        />
        <FilterText
          label="ID e aktorit"
          value={url.state.filters.actorId ?? ""}
          onChange={(value) => url.setFilter("actorId", value)}
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
        columnCount={AUDIT_COLUMN_COUNT}
        isLoading={query.isFetching}
        error={query.isError ? "Gjurmët nuk u ngarkuan dot." : null}
        emptyMessage="Asnjë gjurmë me këta filtra."
      />
      <DataTablePagination table={table} total={query.data?.total ?? 0} />
    </>
  );
}
