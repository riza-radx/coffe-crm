import { describe, expect, it } from "vitest";
import { BOM, csvField, csvRow, toCsv } from "@/lib/export/csv";

describe("csv escaping", () => {
  it("leaves a plain field alone", () => {
    expect(csvField("Bar Rei")).toBe("Bar Rei");
    expect(csvField("9000.00")).toBe("9000.00");
  });

  it("writes an empty cell for null and undefined", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes a field with a comma, a quote or a newline", () => {
    expect(csvField("Rruga e Durrësit, 12")).toBe('"Rruga e Durrësit, 12"');
    expect(csvField('Bar "Rei"')).toBe('"Bar ""Rei"""');
    expect(csvField("rreshti 1\nrreshti 2")).toBe('"rreshti 1\nrreshti 2"');
    expect(csvField("me\r\nCRLF")).toBe('"me\r\nCRLF"');
  });

  it("defuses a field a spreadsheet would run as a formula", () => {
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1"]) {
      expect(csvField(dangerous).startsWith("'")).toBe(true);
    }
    // A negative number typed as a number is still a number, not a formula —
    // but as text it is indistinguishable, so the guard wins and says so.
    expect(csvField("-500.00")).toBe("'-500.00");
  });

  it("quotes a defused field that also needs quoting", () => {
    expect(csvField('=cmd|"/c calc"!A1')).toBe('"\'=cmd|""/c calc""!A1"');
  });

  it("joins a row with commas and a file with CRLF", () => {
    expect(csvRow(["a", "b,c", 1])).toBe('a,"b,c",1');
    const file = toCsv(["Klienti", "Vlera"], [["Bar Rei", "1000.00"]]);
    expect(file).toBe(`${BOM}Klienti,Vlera\r\nBar Rei,1000.00\r\n`);
  });

  it("starts with the BOM so Excel reads the Albanian characters", () => {
    expect(toCsv(["Përfaqësuesi"], []).startsWith(BOM)).toBe(true);
  });
});
