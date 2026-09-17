import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { can, canAccessPath } from "@/lib/rbac";
import { getCommissionSummary, getLeaderboard, getRevenueReport } from "@/lib/queries/analytics";
import { getMonthlyTrend } from "@/lib/queries/summaries";
import { BarChart } from "@/components/charts/bar-chart";
import { ChartFrame, EmptyPlot } from "@/components/charts/chart-frame";
import { LineChart } from "@/components/charts/line-chart";
import { StatTile } from "@/components/charts/stat-tile";
import { money, monthLabel } from "@/components/charts/format";
import { NotificationBell } from "./notification-bell";
import { SignOutButton } from "./sign-out-button";
import { fillMonths, monthKeys, trendRange } from "./trend";

const NAV = [
  { href: "/clients", label: "Klientët" },
  { href: "/contracts", label: "Kontratat" },
  { href: "/bills", label: "Faturat" },
  { href: "/commissions", label: "Komisionet" },
  { href: "/leaderboard", label: "Renditja" },
  { href: "/reports", label: "Raportet" },
  { href: "/audit-logs", label: "Gjurmët" },
  { href: "/users", label: "Përdoruesit" },
];

const TREND_MONTHS = 12;
const TOP_CLIENTS = 5;

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const now = new Date();
  const range = trendRange(now, TREND_MONTHS);
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const seesEverything = can(user, "viewFull", "leaderboard") && user.role === "SUPER_ADMIN";

  /*
   * Every figure below comes from the same scoped services the API uses, so a rep
   * sees their own numbers here for the same reason they see them through the API:
   * the WHERE clause, not this page. A Super Admin sees the business; a rep sees
   * their own contracts, bills and commissions.
   */
  const [trend, topClients, commissions, board] = await Promise.all([
    // Phase 6: the trend reads the nightly summaries for the closed months and
    // stays live for the current one — 127 ms → 0.8 ms at 600k bills, measured
    // in scripts/benchmark.mjs. It falls back to the live query by itself when
    // the rollup has not run.
    getMonthlyTrend(user, TREND_MONTHS, now),
    getRevenueReport(user, { groupBy: "client", ...range, limit: TOP_CLIENTS }),
    getCommissionSummary(user),
    getLeaderboard(user, { period }),
  ]);

  const series = fillMonths(
    monthKeys(now, TREND_MONTHS),
    trend.rows.map((row) => ({ key: row.key, revenue: row.revenue })),
  );
  const ownRow = board.scope === "own" ? board.rows[0] : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Rei CRM</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {user.name} · {user.role}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <SignOutButton />
        </div>
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={seesEverything ? "Të ardhura (12 muaj)" : "Të ardhurat e tua (12 muaj)"}
          value={money(trend.total.revenue)}
          note={`${trend.total.billCount} fatura`}
          accent="var(--viz-series-1)"
        />
        <StatTile
          label="Komision në pritje"
          value={money(commissions.byStatus.PENDING.amount)}
          note={`${commissions.byStatus.PENDING.count} komisione`}
        />
        <StatTile
          label="I aprovuar, pa paguar"
          value={money(commissions.byStatus.APPROVED.amount)}
          note={`${commissions.byStatus.APPROVED.count} komisione`}
        />
        <StatTile
          label="I paguar"
          value={money(commissions.byStatus.PAID.amount)}
          note={`${commissions.byStatus.PAID.count} komisione`}
        />
      </section>

      {!seesEverything && (
        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          <StatTile
            label={`Vendi yt — ${period}`}
            value={board.self ? `#${board.self.rank} nga ${board.self.of}` : "—"}
            note={board.self ? undefined : "Pa faturë këtë muaj"}
          />
          <StatTile
            label={`Komisioni yt — ${period}`}
            value={money(ownRow?.commission ?? board.rows[0]?.commission ?? "0.00")}
            accent="var(--viz-series-2)"
          />
        </section>
      )}

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title={seesEverything ? "Të ardhurat sipas muajit" : "Të ardhurat e tua sipas muajit"}
          subtitle={`${range.from} → ${range.to}. Fatura jo-VOID, sipas datës së faturës.${
            trend.source === "summaries" ? " Muajt e mbyllur nga përmbledhjet e natës." : ""
          }`}
          table={{
            columns: ["Muaji", "Të ardhura"],
            rows: series.map((point) => [monthLabel(point.key), money(point.revenue)]),
          }}
        >
          {series.some((point) => Number(point.revenue) > 0) ? (
            <LineChart
              points={series.map((point) => ({
                key: point.key,
                label: monthLabel(point.key),
                value: point.revenue,
              }))}
              format={(value) => money(value)}
            />
          ) : (
            <EmptyPlot>Asnjë faturë në 12 muajt e fundit</EmptyPlot>
          )}
        </ChartFrame>

        <ChartFrame
          title={seesEverything ? "Klientët kryesorë" : "Klientët e tu kryesorë"}
          subtitle={`Top ${TOP_CLIENTS} sipas të ardhurave, ${range.from} → ${range.to}.`}
          table={{
            columns: ["Klienti", "Të ardhura", "Fatura"],
            rows: topClients.rows.map((row) => [row.label, money(row.revenue), String(row.billCount)]),
          }}
        >
          {topClients.rows.length > 0 ? (
            <BarChart
              rows={topClients.rows.map((row) => ({ key: row.key, label: row.label }))}
              series={[
                {
                  label: "Të ardhura",
                  color: "var(--viz-series-1)",
                  values: topClients.rows.map((row) => row.revenue),
                  format: (value) => money(value),
                },
              ]}
            />
          ) : (
            <EmptyPlot />
          )}
        </ChartFrame>
      </section>

      <nav className="mt-6 grid gap-2 sm:grid-cols-3">
        {NAV.filter((item) => canAccessPath(user.role, item.href)).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md border border-[var(--border)] px-4 py-3 text-sm"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
