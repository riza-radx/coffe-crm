import { cn } from "@/lib/utils";

/**
 * The shell every chart in the app shares: a title, an optional legend, the plot,
 * and a table view underneath.
 *
 * The table is not a nicety. Three things depend on it: a reader who cannot
 * separate the hues, a reader who needs the exact figure rather than a bar's
 * length, and the two chart colors that sit below 3:1 on the light surface. It is
 * a `<details>` rather than a toggle so it works with no JavaScript at all.
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  children,
  table,
  className,
}: {
  title: string;
  subtitle?: string;
  /** Present for two or more series. A single-series chart needs none — the title names it. */
  legend?: Array<{ label: string; color: string }>;
  children: React.ReactNode;
  table: { columns: string[]; rows: Array<Array<string>> };
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5",
        className,
      )}
    >
      <figcaption>
        <h3 className="text-sm font-medium">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
      </figcaption>

      {legend && legend.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-4">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-xs text-[var(--muted)]">
              {/* Identity rides a colored mark beside the text; the text itself
                  stays in an ink token, never in the series color. */}
              <span
                aria-hidden
                className="inline-block h-2 w-4 rounded-full"
                style={{ background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">{children}</div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-[var(--muted)]">Të dhënat në tabelë</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                {table.columns.map((column) => (
                  <th key={column} className="py-1 pr-4 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {table.rows.map((row, index) => (
                <tr key={index} className="border-b border-[var(--border)] last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="py-1 pr-4">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export function EmptyPlot({ children = "Asnjë e dhënë për këtë periudhë" }: { children?: string }) {
  return (
    <p className="py-8 text-center text-sm text-[var(--muted)]">{children}</p>
  );
}
