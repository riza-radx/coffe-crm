import { prisma } from "@/lib/db";
import { bodyWithLink, sendMail } from "@/lib/email/mailer";
import { renderReportPdf } from "@/lib/export/pdf";
import { periodRange } from "@/lib/validation/period";
import { monthKey, rollupMonth } from "./rollup";

/**
 * Section 8: "Scheduled monthly report generation via pg-boss, emailed to Super
 * Admin".
 *
 * The report reads `revenue_summaries` rather than the bills: the nightly rollup
 * already answers "revenue per client per month, commission per rep per month",
 * and asking the question a second way is how two documents about the same month
 * end up disagreeing. The month is rolled once more first — the run happens on
 * the 1st, and a bill entered on the 31st should be in it.
 */
export type MonthlyReportResult = {
  month: string;
  recipients: number;
  clients: number;
  reps: number;
};

/** The month that has just closed, relative to `now`. */
export function closedMonth(now: Date = new Date()): string {
  return monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

type SummaryRow = {
  subjectId: string;
  revenue: { toFixed(dp: number): string };
  billCount: number;
  commissionAmount: { toFixed(dp: number): string };
  commissionCount: number;
};

const MAX_ROWS = 200;

export async function sendMonthlyReport(
  month: string = closedMonth(),
): Promise<MonthlyReportResult> {
  await rollupMonth(month);

  const periodMonth = periodRange(month).gte;

  const [clientRows, repRows, admins] = await Promise.all([
    prisma.revenueSummary.findMany({
      where: { grain: "CLIENT", periodMonth },
      orderBy: [{ revenue: "desc" }, { subjectId: "asc" }],
      take: MAX_ROWS,
    }) as Promise<SummaryRow[]>,
    prisma.revenueSummary.findMany({
      where: { grain: "SALES_REP", periodMonth },
      orderBy: [{ commissionAmount: "desc" }, { subjectId: "asc" }],
      take: MAX_ROWS,
    }) as Promise<SummaryRow[]>,
    prisma.user.findMany({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      select: { email: true, name: true },
    }) as Promise<Array<{ email: string; name: string }>>,
  ]);

  const [clients, reps] = await Promise.all([
    names(prisma.client, clientRows),
    names(prisma.user, repRows),
  ]);

  const revenueTotal = sum(clientRows.map((row) => row.revenue.toFixed(2)));
  const commissionTotal = sum(repRows.map((row) => row.commissionAmount.toFixed(2)));

  const pdf = await renderReportPdf({
    title: `Rei CRM — raporti i ${month}`,
    subtitle: `Muaji i mbyllur ${month} · burimi: revenue_summaries`,
    sections: [
      {
        heading: "Të ardhurat sipas klientit",
        columns: [
          { header: "Klienti", width: 45 },
          { header: "Të ardhurat", width: 20, align: "right" },
          { header: "Fatura", width: 12, align: "right" },
        ],
        rows: clientRows.map((row) => [
          clients.get(row.subjectId) ?? row.subjectId,
          row.revenue.toFixed(2),
          String(row.billCount),
        ]),
        footer: `Gjithsej: ${revenueTotal}`,
        emptyMessage: "Asnjë faturë në këtë muaj.",
      },
      {
        heading: "Komisionet sipas përfaqësuesit",
        columns: [
          { header: "Përfaqësuesi", width: 45 },
          { header: "Të ardhurat", width: 20, align: "right" },
          { header: "Komisioni", width: 20, align: "right" },
          { header: "Komisione", width: 12, align: "right" },
        ],
        rows: repRows.map((row) => [
          reps.get(row.subjectId) ?? row.subjectId,
          row.revenue.toFixed(2),
          row.commissionAmount.toFixed(2),
          String(row.commissionCount),
        ]),
        footer: `Gjithsej komision: ${commissionTotal}`,
        emptyMessage: "Asnjë komision në këtë muaj.",
      },
    ],
  });

  for (const admin of admins) {
    await sendMail({
      to: admin.email,
      subject: `Rei CRM — raporti i ${month}`,
      text: bodyWithLink(
        `Përshëndetje ${admin.name},\n\nRaporti i muajit ${month} është bashkangjitur.\n` +
          `Të ardhura: ${revenueTotal} · komisione: ${commissionTotal} · ` +
          `${clientRows.length} klientë, ${repRows.length} përfaqësues.`,
        "/reports",
      ),
      attachments: [
        {
          filename: `rei-crm-${month}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });
  }

  return {
    month,
    recipients: admins.length,
    clients: clientRows.length,
    reps: repRows.length,
  };
}

/** One id → name lookup per grain, so the PDF shows names and not cuids. */
async function names(
  model: { findMany: (args: unknown) => Promise<unknown> },
  rows: readonly SummaryRow[],
): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();
  const found = (await model.findMany({
    where: { id: { in: rows.map((row) => row.subjectId) } },
    select: { id: true, name: true },
  })) as Array<{ id: string; name: string }>;
  return new Map(found.map((row) => [row.id, row.name]));
}

/** Plain string addition on scale-2 decimals, via integers. */
function sum(values: readonly string[]): string {
  const total = values.reduce((acc, value) => acc + BigInt(value.replace(".", "")), 0n);
  const digits = total.toString().padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
