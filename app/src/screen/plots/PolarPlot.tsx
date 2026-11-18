"use client";

/**
 * A polar plot: a quantity against the angle from the beam axis, the axis
 * pointing up. Linear in the value, so the shape of the pattern reads true.
 * The same export and table as Plot.
 */
import { useRef, useState, type ReactNode } from "react";
import { formatNumber, formatSI } from "../../lib/format.ts";
import { niceTicks } from "../../lib/ticks.ts";
import { useSize } from "../hooks.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import ui from "../ui/ui.module.css";
import { csvText, download, pngBlob, svgText } from "./export.ts";
import type { Tone } from "./Plot.tsx";
import styles from "./Plot.module.css";

export interface PolarSeries {
  id: string;
  label: string;
  tone: Tone;
  /** from the axis [rad], −π … π, sorted */
  angle: number[];
  value: number[];
}

export interface PolarPlotProps {
  id: string;
  title: string;
  /** SI unit of the values */
  unit: string;
  series: PolarSeries[];
  controls?: ReactNode;
}

const deg = (rad: number) => (rad * 180) / Math.PI;

export function PolarPlot({ id, title, unit, series, controls }: PolarPlotProps) {
  const [table, setTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const exportAs = async (kind: "png" | "svg" | "csv") => {
    setError(null);
    try {
      if (kind === "csv") {
        const rows = series.flatMap((s) => s.angle.map((a, i) => [s.label, deg(a), s.value[i]]));
        download(`levtrap-${id}.csv`, new Blob([csvText(["series", "angle from the beam axis [deg]", `value [${unit}]`], rows)], { type: "text/csv" }));
      } else if (!svgRef.current) {
        throw new Error("show the plot to export it");
      } else if (kind === "svg") {
        download(`levtrap-${id}.svg`, new Blob([svgText(svgRef.current)], { type: "image/svg+xml" }));
      } else {
        download(`levtrap-${id}.png`, await pngBlob(svgRef.current, 2));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <figure className={styles.figure} data-testid={`plot-${id}`} data-plot>
      <figcaption className={styles.caption}>
        <span className={styles.title}>{title}</span>
        <ul className={styles.legend} aria-label="Series">
          {series.map((s) => (
            <li key={s.id}>
              <span className={styles.key} data-tone={s.tone} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
        <span className={styles.spacer} />
        {controls}
        <button type="button" className={ui.button} aria-pressed={table} onClick={() => setTable((t) => !t)} data-testid={`plot-${id}-table-toggle`}>
          <Icon name="table" />
          {table ? "Plot" : "Table"}
        </button>
        <Menu
          label="Export"
          align="end"
          side="above"
          button={(p) => (
            <button type="button" className={ui.button} data-testid={`plot-${id}-export`} {...p}>
              Export
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem title="PNG" note="Image, twice the size on screen" testId={`plot-${id}-png`} onSelect={() => (close(), void exportAs("png"))} />
              <MenuItem title="SVG" note="Vector image, in the theme's colours" testId={`plot-${id}-svg`} onSelect={() => (close(), void exportAs("svg"))} />
              <MenuItem title="CSV" note="The data, in SI units" testId={`plot-${id}-csv`} onSelect={() => (close(), void exportAs("csv"))} />
            </>
          )}
        </Menu>
      </figcaption>
      {error && (
        <p className={styles.error} role="alert">
          Could not export: {error}.
        </p>
      )}
      {table ? (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="The plot's data as a table">
          <table className={styles.table} data-testid={`plot-${id}-table`}>
            <thead>
              <tr>
                <th scope="col">Series</th>
                <th scope="col">Angle from the beam axis</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {series.flatMap((s) =>
                s.angle.map((a, i) => (
                  <tr key={`${s.id}-${i}`}>
                    <th scope="row">
                      <span className={styles.key} data-tone={s.tone} aria-hidden="true" /> {s.label}
                    </th>
                    <td>{formatNumber(deg(a), 3)}°</td>
                    <td>{formatSI(s.value[i], unit)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <Polar id={id} unit={unit} series={series} svgRef={svgRef} title={title} />
      )}
    </figure>
  );
}

function Polar({ id, unit, series, svgRef, title }: Omit<PolarPlotProps, "controls"> & { svgRef: React.RefObject<SVGSVGElement | null> }) {
  const [ref, size] = useSize();
  const [cursor, setCursor] = useState<number | null>(null);
  const width = Math.max(size.width, 220);
  const height = Math.max(size.height, 160);
  const cx = width / 2;
  const cy = height / 2 + 4;
  const R = Math.max(40, Math.min(width / 2 - 70, height / 2 - 22));
  const max = Math.max(...series.flatMap((s) => s.value), 0) || 1;
  const rings = niceTicks(0, max, 3).filter((t) => t > 0 && t <= max * 1.001);
  const r = (v: number) => (R * v) / max;
  // the angle from the axis, axis up, positive to the right
  const pt = (a: number, v: number): [number, number] => [cx + r(v) * Math.sin(a), cy - r(v) * Math.cos(a)];
  const path = (s: PolarSeries) => s.angle.map((a, i) => pt(a, s.value[i])).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z";
  const nearest = (s: PolarSeries, a: number) =>
    s.angle.reduce((best, x, i) => (Math.abs(x - a) < Math.abs(s.angle[best] - a) ? i : best), 0);
  return (
    <div
      ref={ref}
      className={styles.chart}
      tabIndex={0}
      role="img"
      aria-label={`${title}. The Table button lists the values.`}
      data-testid={`plot-${id}-chart`}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const [dx, dy] = [e.clientX - box.left - cx, -(e.clientY - box.top - cy)];
        setCursor(Math.hypot(dx, dy) > 6 ? Math.atan2(dx, dy) : null);
      }}
      onPointerLeave={() => setCursor(null)}
    >
      <svg ref={svgRef} width={width} height={height} className={styles.svg} aria-hidden="true">
        {rings.map((t) => (
          <g key={t}>
            <circle className={styles.grid} cx={cx} cy={cy} r={r(t)} fill="none" />
            {/* along 112°, between the marked directions */}
            <text className={styles.tick} x={cx + r(t) * Math.sin(1.96) + 3} y={cy - r(t) * Math.cos(1.96) + 12}>
              {formatSI(t, unit, 2, true)}
            </text>
          </g>
        ))}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => {
          const a = (d * Math.PI) / 180;
          const [x, y] = pt(a, max * 1.0);
          const [lx, ly] = pt(a, max * 1.16);
          return (
            <g key={d}>
              <line className={d % 90 === 0 ? styles.zero : styles.grid} x1={cx} y1={cy} x2={x} y2={y} />
              <text className={styles.tick} x={lx} y={ly + 4} textAnchor="middle">
                {d === 0 ? "+z" : d === 180 ? "−z" : `${d > 180 ? d - 360 : d}°`}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <path key={s.id} className={styles.line} data-tone={s.tone} data-series={s.id} d={path(s)} />
        ))}
        {cursor !== null &&
          series.map((s) => {
            const i = nearest(s, cursor);
            const [x, y] = pt(s.angle[i], s.value[i]);
            return <circle key={s.id} className={styles.marker} data-tone={s.tone} cx={x} cy={y} r={4} />;
          })}
      </svg>
      {cursor !== null && (
        <div className={`${ui.island} ${styles.tooltip}`} style={{ left: 8 }} data-testid="plot-tooltip">
          <p className={styles.tooltipAt}>{formatNumber(deg(cursor), 3)}° from +z</p>
          {series.map((s) => (
            <p key={s.id} className={styles.tooltipRow}>
              <span className={styles.key} data-tone={s.tone} aria-hidden="true" />
              <span className={styles.tooltipValue}>{formatSI(s.value[nearest(s, cursor)], unit)}</span>
              <span className={styles.tooltipName}>{s.label}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
