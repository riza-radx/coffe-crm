import { csvHeaders, toCsv } from "./csv";
import { pdfHeaders, renderReportPdf, type PdfColumn } from "./pdf";

/**
 * The three reports of section 8 — commission statements per rep, revenue per
 * client, the contract expiry list — described once and rendered as either
 * format. The alternative, a CSV builder and a PDF builder per report, is six
 * places for the same column list to drift.
 */
export type ExportFormat = "csv" | "pdf";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["csv", "pdf"];

export type ReportTable = {
  /** Without an extension; the format adds its own. */
  filename: string;
  title: string;
  subtitle?: string;
  columns: readonly PdfColumn[];
  rows: readonly (readonly string[])[];
  footer?: string;
  emptyMessage?: string;
  /** Extra response headers, e.g. the truncation marker. */
  headers?: Record<string, string>;
};

export async function reportResponse(
  table: ReportTable,
  format: ExportFormat,
): Promise<Response> {
  if (format === "csv") {
    const body = toCsv(
      table.columns.map((column) => column.header),
      table.rows,
    );
    return new Response(body, {
      headers: { ...csvHeaders(`${table.filename}.csv`), ...table.headers },
    });
  }

  const buffer = await renderReportPdf(table);
  // A Uint8Array view, not the Buffer itself: Response accepts both, but the view
  // is what the Web types actually declare.
  return new Response(new Uint8Array(buffer), {
    headers: { ...pdfHeaders(`${table.filename}.pdf`), ...table.headers },
  });
}

/** Every report says when it was produced; a report without that is a rumour. */
export function generatedAt(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
