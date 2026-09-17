/**
 * CSV writing, kept as a pure function so the escaping rules can be tested
 * directly rather than through a route.
 *
 * Two rules that matter for a file someone opens in Excel:
 *
 *  - RFC 4180 quoting: a field containing a comma, a quote or a newline is
 *    wrapped in quotes and its own quotes are doubled. CRLF line endings, because
 *    that is what the spec says and what Windows Excel expects.
 *  - Formula injection: a field starting with = + - @ (or a tab/CR, which some
 *    parsers strip before looking) is prefixed with a single quote. A client
 *    named "=cmd|..." is a spreadsheet exploit, not a client name.
 */
const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (NEEDS_QUOTING.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvField).join(",");
}

/** The UTF-8 BOM: without it Excel reads "Përfaqësuesi" as mojibake. */
export const BOM = "﻿";

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return BOM + [csvRow(headers), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

/** `Content-Disposition` with a filename that is safe to put in a header. */
export function csvHeaders(filename: string): Record<string, string> {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "-");
  return {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${safe}"`,
    "cache-control": "no-store",
  };
}
