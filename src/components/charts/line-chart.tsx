import { compact, niceScale, toPlotNumber } from "./format";

/**
 * A single-series trend over months. One measure over time is a line: the slope
 * between points is the thing being read, and bars would hide it behind their own
 * area.
 *
 * One series, so no legend — the title says what is plotted. Only the last point
 * is labelled; a number on every point is noise and goes unread. Each point
 * carries an oversized transparent hit rect with a `<title>`, so hovering anywhere
 * in a month's column gives its figure without a client bundle.
 */
export function LineChart({
  points,
  format,
}: {
  points: Array<{ key: string; label: string; value: string }>;
  format: (value: string) => string;
}) {
  const PAD_L = 44;
  const PAD_R = 52;
  const PAD_T = 12;
  const PLOT_H = 150;
  const PLOT_W = 420;
  const width = PAD_L + PLOT_W + PAD_R;
  const height = PAD_T + PLOT_H + 26;

  const values = points.map((p) => toPlotNumber(p.value));
  const scale = niceScale(Math.max(...values, 0));

  const x = (index: number) =>
    PAD_L + (points.length === 1 ? PLOT_W / 2 : (index / (points.length - 1)) * PLOT_W);
  const y = (value: number) => PAD_T + PLOT_H - (value / scale.max) * PLOT_H;

  const path = points.map((_, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(values[i])}`).join(" ");
  const last = points.length - 1;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="Grafik linje; vlerat e sakta janë në tabelën poshtë"
    >
      {scale.values.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD_L}
            x2={PAD_L + PLOT_W}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--viz-grid)"
            strokeWidth={1}
          />
          <text
            x={PAD_L - 8}
            y={y(tick) + 3}
            textAnchor="end"
            className="fill-[var(--muted)] text-[10px] tabular-nums"
          >
            {compact(tick)}
          </text>
        </g>
      ))}

      {/* The area wash is the series hue at ~10%, never a saturated block. */}
      {points.length > 1 && (
        <path
          d={`${path} L${x(last)} ${PAD_T + PLOT_H} L${x(0)} ${PAD_T + PLOT_H} Z`}
          fill="var(--viz-series-1)"
          fillOpacity={0.1}
        />
      )}

      <path
        d={path}
        fill="none"
        stroke="var(--viz-series-1)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {points.map((point, index) => (
        <g key={point.key}>
          {/* The hit target is the whole column, not the 8px dot. */}
          <rect
            x={x(index) - PLOT_W / Math.max(points.length * 2, 2)}
            y={PAD_T}
            width={PLOT_W / Math.max(points.length, 1)}
            height={PLOT_H}
            fill="transparent"
          >
            <title>{`${point.label}: ${format(point.value)}`}</title>
          </rect>
          {index === last && (
            <>
              {/* 2px surface ring keeps the end marker legible over the line. */}
              <circle
                cx={x(index)}
                cy={y(values[index])}
                r={4}
                fill="var(--viz-series-1)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
              <text
                x={x(index) + 10}
                y={y(values[index]) + 4}
                className="fill-[var(--foreground)] text-[11px] tabular-nums"
              >
                {compact(values[index])}
              </text>
            </>
          )}
        </g>
      ))}

      {points.map((point, index) =>
        // Every label would collide on a 24-month range; show the ends and the
        // midpoint and let the table carry the rest.
        index === 0 || index === last || index === Math.floor(last / 2) ? (
          <text
            key={`${point.key}-tick`}
            x={x(index)}
            y={height - 6}
            textAnchor={index === 0 ? "start" : index === last ? "end" : "middle"}
            className="fill-[var(--muted)] text-[10px]"
          >
            {point.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
