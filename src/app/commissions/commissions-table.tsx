"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTable } from "@tanstack/react-table";
import { listFeatures, NO_ROWS } from "@/lib/table/features";
import { toListQuery, type TableUrlConfig } from "@/lib/table/table-url-state";
import { useTableUrlState } from "@/lib/table/use-table-url-state";
import { commissionKeys } from "@/lib/query/keys";
import { fetchJson, postJson, toQueryString, ApiRequestError } from "@/lib/api/fetch-json";
import { formatDecimal } from "@/lib/api/decimal";
import { COMMISSION_SORTABLE } from "@/lib/validation/commissions";
import type { CommissionRow, CommissionTotals } from "@/lib/queries/commissions";
import type { Paginated } from "@/lib/validation/list-query";
import { DataTable } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { FilterBar, FilterSelect, FilterText } from "@/components/ui/filter-bar";
import { Button, Card, FieldError } from "@/components/ui/field";
import { commissionColumns } from "./commissions-columns";

const URL_CONFIG: TableUrlConfig = {
  sortable: COMMISSION_SORTABLE,
  filterKeys: ["status", "salesUserId", "period"],
  defaultSort: "createdAt:desc",
};

const STATUSES = ["PENDING", "APPROVED", "PAID"] as const;

type CommissionPage = Paginated<CommissionRow> & { totals: CommissionTotals };

export function CommissionsTable({ canApprove }: { canApprove: boolean }) {
  const url = useTableUrlState(URL_CONFIG);
  const params = toListQuery(url.state);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: commissionKeys.list(params),
    queryFn: () => fetchJson<CommissionPage>(`/api/commissions${toQueryString(params)}`),
    placeholderData: keepPreviousData,
  });

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns = useMemo(
    () => commissionColumns({ canApprove, selected, onToggle: toggle }),
    [canApprove, selected],
  );

  const batch = useMutation({
    mutationFn: () =>
      postJson<{ approved: number; skipped: Array<{ id: string }> }>(
        "/api/commissions/batch-approve",
        { ids: [...selected] },
      ),
    onSuccess: async (result) => {
      setSelected(new Set());
      setMessage(
        result.skipped.length
          ? `U aprovuan ${result.approved}; ${result.skipped.length} u anashkaluan.`
          : null,
      );
      await queryClient.invalidateQueries({ queryKey: commissionKeys.all });
      router.refresh();
    },
    onError: (error) => {
      setMessage(
        error instanceof ApiRequestError && error.code === "BATCH_TOO_LARGE"
          ? "Shumë komisione njëherësh — ngushto filtrat."
          : "Aprovimi në grup nuk u krye dot.",
      );
    },
  });

  const table = useTable({
    features: listFeatures,
    columns,
    data: query.data?.data ?? (NO_ROWS as CommissionRow[]),
    rowCount: query.data?.total ?? 0,
    manualPagination: true,
    manualSorting: true,
    state: { pagination: url.state.pagination, sorting: url.state.sorting },
    onPaginationChange: url.onPaginationChange,
    onSortingChange: url.onSortingChange,
  });

  const totals = query.data?.totals ?? {};

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {STATUSES.map((status) => (
          <Card key={status}>
            <p className="text-sm text-[var(--muted)]">{status}</p>
            <p className="mt-2 text-xl font-semibold">
              {formatDecimal(totals[status]?.amount ?? "0.00")}
            </p>
            <p className="text-sm text-[var(--muted)]">{totals[status]?.count ?? 0} komisione</p>
          </Card>
        ))}
      </div>

      <FilterBar>
        <FilterSelect
          label="Statusi"
          value={url.state.filters.status ?? ""}
          onChange={(value) => url.setFilter("status", value)}
          options={STATUSES}
        />
        <FilterText
          label="Periudha"
          value={url.state.filters.period ?? ""}
          onChange={(value) => url.setFilter("period", value)}
          placeholder="YYYY-MM"
        />
        {canApprove && (
          <FilterText
            label="Përfaqësuesi (id)"
            value={url.state.filters.salesUserId ?? ""}
            onChange={(value) => url.setFilter("salesUserId", value)}
            placeholder="id e përdoruesit"
          />
        )}
        {canApprove && (
          <Button
            type="button"
            onClick={() => batch.mutate()}
            disabled={selected.size === 0 || batch.isPending}
          >
            {batch.isPending ? "Duke aprovuar…" : `Aprovo të zgjedhurat (${selected.size})`}
          </Button>
        )}
      </FilterBar>

      <FieldError>{message}</FieldError>

      <DataTable
        table={table}
        columnCount={columns.length}
        isLoading={query.isFetching}
        error={query.isError ? "Lista nuk u ngarkua dot." : null}
        emptyMessage="Asnjë komision me këta filtra."
      />
      <DataTablePagination table={table} total={query.data?.total ?? 0} />
    </>
  );
}
