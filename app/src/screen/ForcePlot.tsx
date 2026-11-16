"use client";

import { useState } from "react";
import type { Result } from "../engine/types.ts";
import { formatNumber } from "../lib/format.ts";
import { interpolate, niceTicks, siPrefix } from "../lib/ticks.ts";
import { useSize } from "./hooks.ts";
import { Icon } from "./ui/Icon.tsx";
import ui from "./ui/ui.module.css";
import styles from "./ForcePlot.module.css";

const AXES = ["x", "y", "z"] as const;
type Axis = (typeof AXES)[number];
const MARGIN = { top: 12, right: 18, bottom: 38, left: 58 };

interface Series {
  axis: Axis;
  /** displacement from the equilibrium [m], force along the axis [N] */
  points: [number, number][];
}

/** Displacement along each axis from the equilibrium, against the force along that axis. */
function seriesOf(result: Result): Series[] {
  if (!result.curves) return [];
  return AXES.map((axis, i) => {
    const curve = result.curves![axis];
    const centre = result.equilibrium ? result.equilibrium[i] : (curve.position[0] + curve.position[curve.position.length - 1]) / 2;
    return { axis, points: curve.position.map((p, j) => [p - centre, curve.force[j]] as [number, number]) };
  });
}

/** The Forces tab: the force along x, y and z through the equilibrium. */
export function ForcePlot({ result }: { result: Result }) {
  const [table, setTable] = useState(false);
  const series = seriesOf(result);
  if (!series.length) return <p className={styles.empty}>The force curves were not computed for this result.</p>;
  const xMax = Math.max(...series.flatMap((s) => s.points.map((p) => Math.abs(p[0]))));
  const yMax = Math.max(...series.flatMap((s) => s.points.map((p) => Math.abs(p[1]))));
  const xUnit = siPrefix(xMax);
  const yUnit = siPrefix(yMax);
  return (
    <figure className={styles.figure} data-testid="force-plot">
      <figcaption className={styles.caption}>
        <span className={styles.title}>Force along each axis, through the equilibrium</span>
        <ul className={styles.legend} aria-label="Series">
          {AXES.map((axis) => (
            <li key={axis}>
              <span className={styles.key} data-axis={axis} aria-hidden="true" />
              along {axis}
            </li>
          ))}
        </ul>
        <button type="button" className={ui.button} aria-pressed={table} onClick={() => setTable((t) => !t)} data-testid="plot-table-toggle">
          <Icon name="table" />
          {table ? "Plot" : "Table"}
        </button>
      </figcaption>
      {table ? <Table series={series} xUnit={xUnit} yUnit={yUnit} /> : <Chart series={series} xUnit={xUnit} yUnit={yUnit} />}
    </figure>
  );
}

interface Unit {
  factor: number;
  prefix: string;
}

/** One label per line at its highest point; labels that would overlap are merged ("x, y"). */
function directLabels(series: Series[], sx: (x: number) => number, sy: (y: number) => number): { text: string; x: number; y: number }[] {
  const labels: { text: string; x: number; y: number }[] = [];
  for (const s of series) {
    const peak = s.points.reduce((best, p) => (p[1] > best[1] ? p : best));
    const [x, y] = [sx(peak[0]), sy(peak[1])];
    const near = labels.find((l) => Math.abs(l.x - x) < 22 && Math.abs(l.y - y) < 14);
    if (near) near.text += `, ${s.axis}`;
    else labels.push({ text: s.axis, x, y });
  }
  return labels;
}

function Chart({ series, xUnit, yUnit }: { series: Series[]; xUnit: Unit; yUnit: Unit }) {
  const [ref, size] = useSize();
  /** the displacement under the pointer or the keyboard cursor [m] */
  const [cursor, setCursor] = useState<number | null>(null);
  const width = Math.max(size.width, 240);
  const height = Math.max(size.height, 120);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yPad = 0.08 * (Math.max(...ys) - Math.min(...ys) || 1);
  const yMin = Math.min(...ys) - yPad;
  const yMax = Math.max(...ys) + yPad;
  const sx = (x: number) => MARGIN.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const sy = (y: number) => MARGIN.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;
  const xTicks = niceTicks(xMin, xMax, Math.max(3, Math.floor(plotW / 90)));
  const yTicks = niceTicks(yMin, yMax, Math.max(2, Math.floor(plotH / 44)));
  const step = (xMax - xMin) / 60;

  const readout = cursor === null ? null : series.map((s) => ({ axis: s.axis, force: interpolate(s.points, cursor) }));
  const tipLeft = cursor === null ? 0 : Math.min(Math.max(sx(cursor) + 12, MARGIN.left), width - 168);

  return (
    <div
      ref={ref}
      className={styles.chart}
      tabIndex={0}
      role="img"
      aria-label="Force along x, y and z against the displacement from the equilibrium. Arrow keys read values; the Table button lists them."
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = xMin + ((e.clientX - box.left - MARGIN.left) / plotW) * (xMax - xMin);
        setCursor(x >= xMin && x <= xMax ? x : null);
      }}
      onPointerLeave={() => setCursor(null)}
      onFocus={() => setCursor((c) => c ?? 0)}
      onBlur={() => setCursor(null)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        setCursor((c) => Math.min(xMax, Math.max(xMin, (c ?? 0) + (e.key === "ArrowRight" ? step : -step))));
      }}
    >
      <svg width={width} height={height} className={styles.svg} aria-hidden="true">
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line className={t === 0 ? styles.zero : styles.grid} x1={MARGIN.left} x2={width - MARGIN.right} y1={sy(t)} y2={sy(t)} />
            <text className={styles.tick} x={MARGIN.left - 8} y={sy(t) + 4} textAnchor="end">
              {formatNumber(t / yUnit.factor, 3, true)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            {t === 0 && <line className={styles.zero} x1={sx(0)} x2={sx(0)} y1={MARGIN.top} y2={MARGIN.top + plotH} />}
            <line className={styles.axisTick} x1={sx(t)} x2={sx(t)} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH + 4} />
            <text className={styles.tick} x={sx(t)} y={MARGIN.top + plotH + 17} textAnchor="middle">
              {formatNumber(t / xUnit.factor, 3, true)}
            </text>
          </g>
        ))}
        <line className={styles.axis} x1={MARGIN.left} x2={width - MARGIN.right} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH} />
        <text className={styles.axisTitle} x={MARGIN.left + plotW / 2} y={height - 4} textAnchor="middle">
          Displacement from the equilibrium ({xUnit.prefix}m)
        </text>
        <text className={styles.axisTitle} transform={`translate(13 ${MARGIN.top + plotH / 2}) rotate(-90)`} textAnchor="middle">
          Force ({yUnit.prefix}N)
        </text>

        {series.map((s) => (
          <path key={s.axis} className={styles.line} data-axis={s.axis} d={s.points.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join("")} />
        ))}
        {/* each line named at its restoring peak; lines that coincide there share one label */}
        {directLabels(series, sx, sy).map((label) => (
          <text key={label.text} className={styles.direct} x={label.x} y={label.y - 7} textAnchor="middle">
            {label.text}
          </text>
        ))}

        {cursor !== null && readout && (
          <g>
            <line className={styles.crosshair} x1={sx(cursor)} x2={sx(cursor)} y1={MARGIN.top} y2={MARGIN.top + plotH} />
            {readout.map(
              (r) => r.force !== null && <circle key={r.axis} className={styles.marker} data-axis={r.axis} cx={sx(cursor)} cy={sy(r.force)} r={4.5} />,
            )}
          </g>
        )}
      </svg>
      {cursor !== null && readout && (
        <div className={`${ui.island} ${styles.tooltip}`} style={{ left: tipLeft }} data-testid="plot-tooltip">
          <p className={styles.tooltipAt}>
            {formatNumber(cursor / xUnit.factor, 3)} {xUnit.prefix}m from the equilibrium
          </p>
          {readout.map((r) => (
            <p key={r.axis} className={styles.tooltipRow}>
              <span className={styles.key} data-axis={r.axis} aria-hidden="true" />
              <span className={styles.tooltipValue}>{r.force === null ? "—" : `${formatNumber(r.force / yUnit.factor, 3)} ${yUnit.prefix}N`}</span>
              <span className={styles.tooltipName}>along {r.axis}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Table({ series, xUnit, yUnit }: { series: Series[]; xUnit: Unit; yUnit: Unit }) {
  const rows = Math.max(...series.map((s) => s.points.length));
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Force curves as a table">
      <table className={styles.table} data-testid="plot-table">
        <thead>
          <tr>
            {series.map((s) => (
              <th key={s.axis} colSpan={2} scope="colgroup">
                <span className={styles.key} data-axis={s.axis} aria-hidden="true" /> along {s.axis}
              </th>
            ))}
          </tr>
          <tr>
            {series.map((s) => [
              <th key={`${s.axis}-s`} scope="col">
                Displacement ({xUnit.prefix}m)
              </th>,
              <th key={`${s.axis}-f`} scope="col">
                Force ({yUnit.prefix}N)
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              {series.map((s) => [
                <td key={`${s.axis}-s`}>{s.points[i] ? formatNumber(s.points[i][0] / xUnit.factor, 3) : ""}</td>,
                <td key={`${s.axis}-f`}>{s.points[i] ? formatNumber(s.points[i][1] / yUnit.factor, 3) : ""}</td>,
              ])}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
