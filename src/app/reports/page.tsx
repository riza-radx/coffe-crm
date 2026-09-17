import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { getRevenueReport } from "@/lib/queries/analytics";
import { exportContracts } from "@/lib/queries/contracts";
import { exportCommissions } from "@/lib/queries/commissions";
import { toQueryString } from "@/lib/api/fetch-json";
import { Card } from "@/components/ui/field";
import { money } from "@/components/charts/format";
import { EXPIRY_HORIZONS, horizonDate, monthOptions, monthRange } from "./period";
import { ReportFilters } from "./report-filters";

export const dynamic = "force-dynamic";

const PREVIEW_ROWS = 10;

/**
 * Step 18's page. Every figure here comes from the same scoped services the API
 * and the export use, so what a rep sees on screen, downloads as CSV and
 * downloads as PDF are three renderings of one query — not three queries.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const now = new Date();
  const months = monthOptions(now);
  const month = pick(params.month, months.map((option) => option.value), months[0].value);
  const horizon = Number(
    pick(params.horizon, EXPIRY_HORIZONS.map(String), String(EXPIRY_HORIZONS[0])),
  );

  const range = monthRange(month);
  const expiringBefore = horizonDate(now, horizon);

  const [revenue, contracts, commissions] = await Promise.all([
    getRevenueReport(user, { groupBy: "client", ...range, limit: 100 }),
    exportContracts(user, {
      format: "csv",
      status: "ACTIVE",
      expiringBefore,
      page: 1,
      pageSize: 25,
      sort: "endDate:asc",
    }),
    exportCommissions(user, { format: "csv", period: month, page: 1, pageSize: 25, sort: "createdAt:desc" }),
  ]);

  // Each href is completed with `csv` or `pdf` below; the trailing `format=` is
  // why these are built here rather than inline.
  const links = {
    revenue: `/api/analytics/revenue${toQueryString({ groupBy: "client", ...range })}&format=`,
    contracts: `/api/contracts${toQueryString({ status: "ACTIVE", expiringBefore })}&format=`,
    commissions: `/api/commissions${toQueryString({ period: month })}&format=`,
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/dashboard" className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
        ← Paneli
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Raportet</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Tri raportet e planit, në CSV ose PDF. Çdo shkarkim ndjek të njëjtin akses si
        ekrani: një përfaqësues merr vetëm rreshtat e vet.
      </p>

      <ReportFilters
        month={month}
        months={months}
        horizon={horizon}
        horizons={[...EXPIRY_HORIZONS]}
      />

      <ReportCard
        title="Të ardhurat sipas klientit"
        subtitle={`${range.from} → ${range.to}`}
        href={links.revenue}
        columns={["Klienti", "Të ardhurat", "Fatura"]}
        rows={revenue.rows
          .slice(0, PREVIEW_ROWS)
          .map((row) => [row.label, money(row.revenue), String(row.billCount)])}
        total={revenue.rows.length}
        footer={`Gjithsej: ${money(revenue.total.revenue)} · ${revenue.total.billCount} fatura`}
        empty="Asnjë faturë në këtë muaj."
      />

      <ReportCard
        title="Kontratat që skadojnë"
        subtitle={`Aktive, me mbarim deri më ${expiringBefore}`}
        href={links.contracts}
        columns={["Mbaron më", "Klienti", "Përfaqësuesi", "Ditë"]}
        rows={contracts.rows
          .slice(0, PREVIEW_ROWS)
          .map((row) => [row[0], row[1], row[2], row[6]])}
        total={contracts.rows.length}
        footer={`${contracts.rows.length} kontrata brenda ${horizon} ditësh`}
        empty="Asnjë kontratë nuk skadon në këtë interval."
      />

      <ReportCard
        title="Pasqyra e komisioneve"
        subtitle={`Periudha ${month}`}
        href={links.commissions}
        columns={["Data", "Nr. faturës", "Klienti", "Komisioni", "Statusi"]}
        rows={commissions.rows
          .slice(0, PREVIEW_ROWS)
          .map((row) => [row[0], row[1], row[2], money(row[6]), row[7]])}
        total={commissions.rows.length}
        footer={`Gjithsej: ${money(commissions.total)} · ${commissions.rows.length} komisione`}
        empty="Asnjë komision në këtë periudhë."
      />
    </main>
  );
}

function ReportCard({
  title,
  subtitle,
  href,
  columns,
  rows,
  total,
  footer,
  empty,
}: {
  title: string;
  subtitle: string;
  href: string;
  columns: string[];
  rows: string[][];
  total: number;
  footer: string;
  empty: string;
}) {
  return (
    <Card className="mt-6 overflow-x-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
        </div>
        <div className="flex gap-2 text-sm">
          <a className="underline underline-offset-2" href={`${href}csv`} download>
            CSV
          </a>
          <a className="underline underline-offset-2" href={`${href}pdf`} download>
            PDF
          </a>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <>
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="pb-2 font-normal">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-[var(--border)]">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="py-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {footer}
            {total > rows.length ? ` · ${rows.length} të parët nga ${total} — shkarko për listën e plotë` : ""}
          </p>
        </>
      )}
    </Card>
  );
}

/** A value typed into the URL by hand falls back rather than throwing. */
function pick(raw: string | string[] | undefined, allowed: string[], fallback: string): string {
  const value = typeof raw === "string" ? raw : undefined;
  return value && allowed.includes(value) ? value : fallback;
}
