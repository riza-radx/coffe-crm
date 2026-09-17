import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { getLeaderboard } from "@/lib/queries/analytics";
import { LeaderboardQuerySchema } from "@/lib/validation/analytics";
import { BarChart } from "@/components/charts/bar-chart";
import { ChartFrame, EmptyPlot } from "@/components/charts/chart-frame";
import { StatTile } from "@/components/charts/stat-tile";
import { money } from "@/components/charts/format";
import { PeriodFilter, periodOptions } from "./period-filter";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const options = periodOptions(new Date());
  const raw = typeof params.period === "string" ? params.period : options[0].value;
  // A period typed into the URL by hand falls back to this month rather than
  // throwing — the same schema the API uses decides what is valid.
  const parsed = LeaderboardQuerySchema.safeParse({ period: raw });
  const period = parsed.success ? parsed.data.period : options[0].value;

  // The service redacts for the caller's role; the page renders whatever comes
  // back. An Outside Sales rep gets exactly one row, and no other rep's name is
  // ever loaded into this component.
  const board = await getLeaderboard(user, { period });
  const own = board.scope === "own" ? board.rows[0] : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Renditja</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--muted)]">
        {board.scope === "all"
          ? "Të ardhurat e faturuara dhe komisioni i fituar për periudhën, sipas përfaqësuesit."
          : "Shifrat e tua dhe vendi yt në renditje. Emrat dhe shifrat e të tjerëve nuk kthehen nga API-ja."}
      </p>

      <PeriodFilter current={period} options={options} />

      {board.scope === "own" && own ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Vendi"
            value={board.self ? `#${board.self.rank} nga ${board.self.of}` : "—"}
            note={board.self ? undefined : "Pa faturë në këtë periudhë"}
          />
          <StatTile
            label="Të ardhura të faturuara"
            value={money(own.revenue)}
            note={`${own.billCount} fatura`}
            accent="var(--viz-series-1)"
          />
          <StatTile
            label="Komision i fituar"
            value={money(own.commission)}
            note={`${own.commissionCount} komisione`}
            accent="var(--viz-series-2)"
          />
        </div>
      ) : board.rows.length === 0 ? (
        <ChartFrame
          title={`Renditja — ${period}`}
          table={{ columns: ["Përfaqësuesi"], rows: [] }}
        >
          <EmptyPlot />
        </ChartFrame>
      ) : (
        <ChartFrame
          title={`Renditja — ${period}`}
          subtitle="Renditur sipas të ardhurave të faturuara (fatura jo-VOID)."
          legend={[
            { label: "Të ardhura", color: "var(--viz-series-1)" },
            { label: "Komision", color: "var(--viz-series-2)" },
          ]}
          table={{
            columns: ["#", "Përfaqësuesi", "Të ardhura", "Fatura", "Komision", "Komisione"],
            rows: board.rows.map((row) => [
              String(row.rank),
              row.salesUser.name,
              money(row.revenue),
              String(row.billCount),
              money(row.commission),
              String(row.commissionCount),
            ]),
          }}
        >
          <BarChart
            rows={board.rows.map((row) => ({
              key: row.salesUser.id,
              label: `${row.rank}. ${row.salesUser.name}`,
            }))}
            series={[
              {
                label: "Të ardhura",
                color: "var(--viz-series-1)",
                values: board.rows.map((row) => row.revenue),
                format: (value) => money(value),
              },
              {
                label: "Komision",
                color: "var(--viz-series-2)",
                values: board.rows.map((row) => row.commission),
                format: (value) => money(value),
              },
            ]}
          />
        </ChartFrame>
      )}
    </main>
  );
}
