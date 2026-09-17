import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { searchParamsToObject } from "@/lib/validation/list-query";
import { ExportRevenueQuerySchema, RevenueQuerySchema } from "@/lib/validation/analytics";
import { getRevenueReport } from "@/lib/queries/analytics";
import { generatedAt, reportResponse } from "@/lib/export/reports";

export const runtime = "nodejs";

const GROUP_LABEL: Record<string, string> = {
  client: "Klienti",
  salesRep: "Përfaqësuesi",
  month: "Muaji",
};

const TITLE: Record<string, string> = {
  client: "Të ardhurat sipas klientit",
  salesRep: "Të ardhurat sipas përfaqësuesit",
  month: "Të ardhurat sipas muajit",
};

/** Revenue follows contract visibility; the rep's own scope is injected in SQL. */
export const GET = withAuth("viewAll", "contract", async (request, { actor }) => {
  const params = searchParamsToObject(new URL(request.url));

  if (params.format) {
    const parsed = ExportRevenueQuerySchema.safeParse(params);
    if (!parsed.success) return validationError(parsed.error.issues);

    const report = await getRevenueReport(actor, parsed.data);
    const { groupBy, from, to } = parsed.data;

    return reportResponse(
      {
        filename: `te-ardhurat-${groupBy}-${from}_${to}`,
        title: TITLE[groupBy],
        subtitle: `${from} → ${to} · gjeneruar më ${generatedAt()}`,
        columns: [
          { header: GROUP_LABEL[groupBy], width: 40 },
          { header: "Të ardhurat", width: 20, align: "right" },
          { header: "Fatura", width: 12, align: "right" },
        ],
        rows: report.rows.map((row) => [row.label, row.revenue, String(row.billCount)]),
        // The total is the whole filtered set, which is why a truncated report
        // still adds up to more than the rows it shows — and says so.
        footer: report.truncated
          ? `Gjithsej (i plotë): ${report.total.revenue} · ${report.total.billCount} fatura — të shfaqura ${report.rows.length} nga më shumë`
          : `Gjithsej: ${report.total.revenue} · ${report.total.billCount} fatura`,
        emptyMessage: "Asnjë faturë në këtë interval.",
        headers: report.truncated ? { "x-export-truncated": "true" } : undefined,
      },
      parsed.data.format,
    );
  }

  const parsed = RevenueQuerySchema.safeParse(params);
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await getRevenueReport(actor, parsed.data));
});
