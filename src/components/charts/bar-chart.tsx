import { compact, niceScale, toPlotNumber } from "./format";

export type BarSeries = {
  label: string;
  color: string;
  /** Fixed-scale amount strings, one per row, in the rows' order. */
  values: string[];
  /** What the tooltip shows — full precision, unlike the tip label. */
  format: (value: string) => string;
};

/**
 * Horizontal bars, one row per item, one or two measures per row.
 *
 * Horizontal because the labels are names (clients, reps): vertical columns would
 * force them to rotate, and a rotated label is harder to read than a longer chart.
 *
 * Server-rendered SVG, no chart library and no client JavaScript. The hover layer
 * is a `<title>` on each bar, which every browser renders as a tooltip and every
 * screen reader announces; a crosshair would need a client bundle for a page whose
 * whole job is to be read.
 */
export function BarChart({
  rows,
  series,
  barHeight = 18,
}: {
  rows: Array<{ key: string; label: string }>;
  series: BarSeries[];
  barHeight?: number;
}) {
  const LABEL_W = 132;
  const VALUE_W = 64;
  const PLOT_W = 360;
  const GAP = 2; // the surface gap between touching bars
  const ROW_GAP = 14;
  const rowHeight = series.length * barHeight + (series.length - 1) * GAP;
  const height = rows.length * (rowHeight + ROW_GAP) + 24;
  const width = LABEL_W + PLOT_W + VALUE_W;

  const max = Math.max(
    ...series.flatMap((s) => s.values.map(toPlotNumber)),
    0,
  );
  const scale = niceScale(max);
  const x = (value: number) => (value / scale.max) * PLOT_W;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="Grafik me shtylla; vlerat e sakta janë në tabelën poshtë"
    >
      {/* Gridlines: hairline, solid, one step off the surface — recessive. */}
      {scale.values.map((tick) => (
        <g key={tick}>
          <line
            x1={LABEL_W + x(tick)}
            x2={LABEL_W + x(tick)}
            y1={0}
            y2={height - 20}
            stroke="var(--viz-grid)"
            strokeWidth={1}
          />
          <text
            x={LABEL_W + x(tick)}
            y={height - 6}
            textAnchor="middle"
            className="fill-[var(--muted)] text-[10px] tabular-nums"
          >
            {compact(tick)}
          </text>
        </g>
      ))}

      {rows.map((row, rowIndex) => {
        const top = rowIndex * (rowHeight + ROW_GAP);
        return (
          <g key={row.key}>
            <text
              x={LABEL_W - 8}
              y={top + rowHeight / 2 + 4}
              textAnchor="end"
              className="fill-[var(--foreground)] text-[11px]"
            >
              {truncate(row.label, 20)}
            </text>

            {series.map((s, seriesIndex) => {
              const raw = s.values[rowIndex] ?? "0";
              const value = toPlotNumber(raw);
              const barWidth = Math.max(x(value), value > 0 ? 2 : 0);
              const y = top + seriesIndex * (barHeight + GAP);
              return (
                <g key={s.label}>
                  {/* 4px rounded data-end, square at the baseline: the rect is
                      rounded on all corners, then the baseline end is squared off
                      by a small rect over it. */}
                  <rect
                    x={LABEL_W}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    fill={s.color}
                  />
                  {barWidth > 4 && (
                    <rect x={LABEL_W} y={y} width={4} height={barHeight} fill={s.color} />
                  )}
                  <title>{`${row.label} · ${s.label}: ${s.format(raw)}`}</title>
                  {/* Value at the tip — the axis carries the rest. */}
                  <text
                    x={LABEL_W + barWidth + 6}
                    y={y + barHeight / 2 + 4}
                    className="fill-[var(--muted)] text-[10px] tabular-nums"
                  >
                    {compact(value)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
