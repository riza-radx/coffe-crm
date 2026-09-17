import PDFDocument from "pdfkit";

/**
 * One table renderer for all three reports of section 8 (commission statements,
 * revenue per client, contract expiry list). A report is a title, a period, a
 * table and a total — there is no second layout to build, and one renderer means
 * the three reports cannot drift apart typographically.
 *
 * Font: pdfkit's built-in Helvetica, whose WinAnsi encoding covers ë, ç and the
 * rest of Albanian. No embedded font file, so nothing has to be shipped into the
 * standalone image beyond pdfkit's own metrics.
 */
export type PdfColumn = {
  header: string;
  /** Relative width; the columns are scaled to fill the page. */
  width: number;
  align?: "left" | "right";
};

export type PdfSection = {
  /** Omitted on the first section of a single-table report. */
  heading?: string;
  columns: readonly PdfColumn[];
  rows: readonly (readonly string[])[];
  /** Rendered in bold under the table — a total, a count, a caveat. */
  footer?: string;
  /** Shown when `rows` is empty, instead of an empty grid. */
  emptyMessage?: string;
};

/**
 * A report is one table, or — the monthly report — a few. `columns`/`rows` are
 * the one-table shorthand, so the three exports stay as short as they were.
 */
export type PdfReport = {
  title: string;
  subtitle?: string;
  sections?: readonly PdfSection[];
} & Partial<PdfSection>;

const PAGE = { size: "A4" as const, layout: "landscape" as const, margin: 36 };
const FONT = { regular: "Helvetica", bold: "Helvetica-Bold" };
const ROW_HEIGHT = 18;
const HEADER_GAP = 6;

export function renderReportPdf(report: PdfReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...PAGE, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const sections: PdfSection[] =
      report.sections?.map((section) => ({ ...section })) ??
      [{ columns: report.columns ?? [], rows: report.rows ?? [], footer: report.footer, emptyMessage: report.emptyMessage }];

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.font(FONT.bold).fontSize(16).text(report.title, left, doc.page.margins.top);
    if (report.subtitle) {
      doc.font(FONT.regular).fontSize(9).fillColor("#555555").text(report.subtitle);
      doc.fillColor("#000000");
    }
    doc.moveDown(0.8);

    const bottom = doc.page.height - doc.page.margins.bottom - ROW_HEIGHT;

    for (const [index, section] of sections.entries()) {
      const totalWidth = section.columns.reduce((sum, column) => sum + column.width, 0) || 1;
      const widths = section.columns.map((column) => (column.width / totalWidth) * usable);
      const offsets = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b, 0));

      if (index > 0) doc.moveDown(1.2);
      if (section.heading) {
        if (doc.y > bottom - ROW_HEIGHT) doc.addPage();
        doc.font(FONT.bold).fontSize(12).text(section.heading, left, doc.y);
        doc.moveDown(0.3);
      }

      const drawHeader = () => {
        const y = doc.y;
        doc.font(FONT.bold).fontSize(9);
        section.columns.forEach((column, i) => {
          doc.text(column.header, offsets[i], y, {
            width: widths[i] - HEADER_GAP,
            align: column.align ?? "left",
            lineBreak: false,
          });
        });
        doc.y = y + ROW_HEIGHT - 4;
        doc
          .moveTo(left, doc.y)
          .lineTo(left + usable, doc.y)
          .strokeColor("#999999")
          .lineWidth(0.5)
          .stroke();
        doc.y += 4;
        doc.font(FONT.regular).fontSize(9);
      };

      drawHeader();

      if (section.rows.length === 0) {
        doc.font(FONT.regular).fontSize(10).fillColor("#555555");
        doc.text(section.emptyMessage ?? "Asnjë rresht për këtë periudhë.", left, doc.y + 6);
        doc.fillColor("#000000");
        doc.y += ROW_HEIGHT;
      }

      for (const row of section.rows) {
        if (doc.y > bottom) {
          doc.addPage();
          // A table that runs onto a second page without its header is a table
          // nobody can read; repeat it rather than making the reader scroll back.
          drawHeader();
        }
        const y = doc.y;
        section.columns.forEach((column, i) => {
          doc.text(row[i] ?? "", offsets[i], y, {
            width: widths[i] - HEADER_GAP,
            align: column.align ?? "left",
            lineBreak: false,
            ellipsis: true,
          });
        });
        doc.y = y + ROW_HEIGHT - 4;
      }

      if (section.footer) {
        doc.moveDown(0.5);
        doc
          .moveTo(left, doc.y)
          .lineTo(left + usable, doc.y)
          .strokeColor("#999999")
          .stroke();
        doc.moveDown(0.4);
        doc.font(FONT.bold).fontSize(10).text(section.footer, left, doc.y);
      }
    }

    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      // Writing into the bottom margin is what makes pdfkit start a new page —
      // and a new page needs a footer, which starts another one. Dropping the
      // margin for the length of the write is the documented way out.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font(FONT.regular).fontSize(8).fillColor("#555555");
      doc.text(
        `Faqja ${index + 1} nga ${range.count}`,
        left,
        doc.page.height - bottomMargin + 8,
        { width: usable, align: "right", lineBreak: false },
      );
      doc.page.margins.bottom = bottomMargin;
    }

    doc.end();
  });
}

export function pdfHeaders(filename: string): Record<string, string> {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "-");
  return {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="${safe}"`,
    "cache-control": "no-store",
  };
}
