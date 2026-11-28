"use client";

/**
 * One plot of the drawer: inline SVG in the theme's colours (no Plotly).
 * Linear or log axes with SI-prefixed ticks, a crosshair readout (pointer or
 * arrow keys), drag to zoom and Fit to go back, shaded bands and marked
 * values, a direct label on each line, a table of the same data, and export
 * as PNG, SVG or CSV.
 */
import { useRef, useState, type ReactNode } from "react";
import { formatNumber, formatSci, formatSI } from "../../lib/format.ts";
import { niceTicks, siPrefix } from "../../lib/ticks.ts";
import { useSize } from "../hooks.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import ui from "../ui/ui.module.css";
import { csvText, download, pngBlob, svgText } from "./export.ts";
import { placeLineLabels, rowBaseline, topBoxes, topLabels } from "./labels.ts";
import styles from "./Plot.module.css";

/** Series colours: the three axes, or two series that are not axes; each set validated for colour-vision deficiency in both themes. */
export type Tone = "x" | "y" | "z" | "a" | "b" | "light" | "ink";

export interface PlotSeries {
  id: string;
  /** legend and readout name */
  label: string;
  tone: Tone;
  /** a second line of the same quantity (a model, a fit): dashed */
  dashed?: boolean;
  /** [x, y] in SI, sorted by x */
  points: [number, number][];
}

export interface AxisSpec {
  label: string;
  /** SI unit symbol ("m", "N", "Hz"); "" for a pure number */
  unit: string;
  log?: boolean;
  /** show the values in another unit, without an SI prefix: v / factor */
  display?: { unit: string; factor: number };
}

export interface PlotProps {
  /** test ids and file names */
  id: string;
  title: string;
  x: AxisSpec;
  y: AxisSpec;
  series: PlotSeries[];
  /** shaded ranges of x, e.g. where there is no stable trap */
  bands?: { from: number; to: number; label: string }[];
  /** marked values of x */
  markers?: { x: number; label: string }[];
  /** marked points, e.g. where two effects are equal */
  dots?: { x: number; y: number; tone: Tone; label: string }[];
  /** what the dashed lines are, said once in the legend ("harmonic fit") */
  dashed?: string;
  /** fit y to these series only (the others may run off the plot) */
  fitTo?: string[];
  /** controls of the tab, beside the title */
  controls?: ReactNode;
  /** the name of the readout's position, e.g. "from the equilibrium" */
  at?: string;
}

const MARGIN = { top: 16, right: 22, bottom: 38, left: 62 };
const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const power10 = (n: number) => `10${String(n).replace("-", "⁻").replace(/\d/g, (d) => SUPERSCRIPT[Number(d)])}`;

interface Scale {
  /** to plot coordinates (log10 for a log axis) */
  t(v: number): number;
  inv(u: number): number;
  /** the unit shown with the ticks */
  unit: string;
  tick(v: number): string;
  /** a value in the readout */
  value(v: number): string;
  ticks(lo: number, hi: number, count: number): number[];
}

function scaleOf(axis: AxisSpec, maxAbs: number): Scale {
  const t = axis.log ? (v: number) => Math.log10(v) : (v: number) => v;
  const inv = axis.log ? (u: number) => 10 ** u : (u: number) => u;
  if (axis.display) {
    const { unit, factor } = axis.display;
    return {
      t,
      inv,
      unit,
      tick: (v) => (axis.log ? power10(Math.round(Math.log10(v / factor))) : formatNumber(v / factor, 3, true)),
      value: (v) => `${axis.log ? formatSci(v / factor, 3) : formatNumber(v / factor, 3)}${unit ? ` ${unit}` : ""}`,
      ticks: (lo, hi, count) => (axis.log ? decades(lo, hi, factor) : niceTicks(lo / factor, hi / factor, count).map((x) => x * factor)),
    };
  }
  if (axis.log) {
    return {
      t,
      inv,
      unit: axis.unit,
      tick: (v) => formatSI(v, axis.unit, 3, true).replace(axis.unit ? ` ${axis.unit}` : "", "").replace(/ /g, "") || "1",
      value: (v) => formatSI(v, axis.unit, 3),
      ticks: (lo, hi) => decades(lo, hi, 1),
    };
  }
  // a pure number (an NA, a ratio) takes no SI prefix
  const { factor, prefix } = axis.unit ? siPrefix(maxAbs) : { factor: 1, prefix: "" };
  return {
    t,
    inv,
    unit: `${prefix}${axis.unit}`,
    tick: (v) => formatNumber(v / factor, 3, true),
    value: (v) => (axis.unit ? formatSI(v, axis.unit, 3) : formatNumber(v, 3)),
    ticks: (lo, hi, count) => niceTicks(lo, hi, count),
  };
}

/** Ticks at the powers of ten (in display units) inside [lo, hi], thinned to at most 7. */
function decades(lo: number, hi: number, factor: number): number[] {
  const a = Math.ceil(Math.log10(lo / factor) - 1e-9);
  const b = Math.floor(Math.log10(hi / factor) + 1e-9);
  const step = Math.max(1, Math.ceil((b - a + 1) / 7));
  const out: number[] = [];
  for (let n = a; n <= b; n += step) out.push(10 ** n * factor);
  return out;
}

/** Linear interpolation in plot coordinates; null outside the series. */
function at(points: [number, number][], u: number, sx: Scale, sy: Scale): number | null {
  const pts = points.filter(([x, y]) => Number.isFinite(sx.t(x)) && Number.isFinite(sy.t(y)));
  if (!pts.length || u < sx.t(pts[0][0]) || u > sx.t(pts[pts.length - 1][0])) return null;
  for (let i = 1; i < pts.length; i += 1) {
    const [u0, u1] = [sx.t(pts[i - 1][0]), sx.t(pts[i][0])];
    if (u <= u1) {
      const [v0, v1] = [sy.t(pts[i - 1][1]), sy.t(pts[i][1])];
      return sy.inv(u1 === u0 ? v0 : v0 + ((v1 - v0) * (u - u0)) / (u1 - u0));
    }
  }
  return null;
}

export function Plot(props: PlotProps) {
  const { id, title, x, y, series, controls } = props;
  const [table, setTable] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportAs = async (kind: "png" | "svg" | "csv") => {
    setError(null);
    try {
      if (kind === "csv") {
        const header = ["series", `${x.label} [${x.unit || "1"}]`, `${y.label} [${y.unit || "1"}]`];
        const rows = series.flatMap((s) => s.points.map(([px, py]) => [s.label, px, py]));
        download(`levtrap-${id}.csv`, new Blob([csvText(header, rows)], { type: "text/csv" }));
        return;
      }
      const svg = svgRef.current;
      if (!svg) throw new Error("show the plot to export it");
      if (kind === "svg") download(`levtrap-${id}.svg`, new Blob([svgText(svg)], { type: "image/svg+xml" }));
      else download(`levtrap-${id}.png`, await pngBlob(svg, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <figure className={styles.figure} data-testid={`plot-${id}`} data-plot>
      <figcaption className={styles.caption}>
        <span className={styles.title}>{title}</span>
        {series.length > 1 && (
          <ul className={styles.legend} aria-label="Series">
            {series
              .filter((s) => !s.dashed || !props.dashed)
              .map((s) => (
                <li key={s.id}>
                  <span className={styles.key} data-tone={s.tone} data-dashed={s.dashed || undefined} aria-hidden="true" />
                  {s.label}
                </li>
              ))}
            {props.dashed && series.some((s) => s.dashed) && (
              <li>
                <span className={styles.key} data-tone="ink" data-dashed aria-hidden="true" />
                {props.dashed}
              </li>
            )}
          </ul>
        )}
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
      {table ? <Table {...props} /> : <Chart {...props} svgRef={svgRef} />}
    </figure>
  );
}

function Chart({ id, x, y, series, bands = [], markers = [], dots = [], fitTo, at: atName, title, svgRef }: PlotProps & { svgRef: React.RefObject<SVGSVGElement | null> }) {
  const [ref, size] = useSize();
  const [cursor, setCursor] = useState<number | null>(null);
  /** the x range shown, in plot coordinates; null: all of it */
  const [view, setView] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const width = Math.max(size.width, 240);
  const height = Math.max(size.height, 140);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const ok = (axis: AxisSpec, v: number) => Number.isFinite(v) && (!axis.log || v > 0);
  const all = series.flatMap((s) => s.points).filter(([px, py]) => ok(x, px) && ok(y, py));
  const sx0 = scaleOf(x, Math.max(...all.map(([px]) => Math.abs(px)), 0));
  // the x range holds the data and the shaded bands (an unstable run with no data in it still shows)
  const xsT = [...all.map(([px]) => px), ...bands.flatMap((b) => [b.from, b.to])].filter((v) => ok(x, v)).map((v) => sx0.t(v));
  const [fullLo, fullHi] = xsT.length ? [Math.min(...xsT), Math.max(...xsT)] : [0, 1];
  const [u0, u1] = view ?? [fullLo, fullHi === fullLo ? fullLo + 1 : fullHi];
  const visible = all.filter(([px]) => sx0.t(px) >= u0 - 1e-12 && sx0.t(px) <= u1 + 1e-12);
  const sx = scaleOf(x, Math.max(Math.abs(sx0.inv(u0)), Math.abs(sx0.inv(u1))));
  const forY = (fitTo ? series.filter((s) => fitTo.includes(s.id)) : series)
    .flatMap((s) => s.points)
    .filter(([px, py]) => ok(x, px) && ok(y, py) && sx.t(px) >= u0 - 1e-12 && sx.t(px) <= u1 + 1e-12);
  const sy0 = scaleOf(y, Math.max(...(forY.length ? forY : visible).map(([, py]) => Math.abs(py)), 0));
  const ysT = (forY.length ? forY : visible).map(([, py]) => sy0.t(py));
  let [v0, v1] = ysT.length ? [Math.min(...ysT), Math.max(...ysT)] : [0, 1];
  if (v1 === v0) [v0, v1] = [v0 - 1, v1 + 1];
  const pad = (y.log ? 0.06 : 0.08) * (v1 - v0);
  [v0, v1] = [v0 - pad, v1 + pad];
  const sy = sy0;

  const px = (u: number) => MARGIN.left + ((u - u0) / (u1 - u0)) * plotW;
  const py = (v: number) => MARGIN.top + (1 - (v - v0) / (v1 - v0)) * plotH;
  const toU = (clientX: number, box: DOMRect) => u0 + ((clientX - box.left - MARGIN.left) / plotW) * (u1 - u0);

  const xTicks = sx.ticks(sx.inv(u0), sx.inv(u1), Math.max(3, Math.floor(plotW / 90)));
  const yTicks = sy.ticks(sy.inv(v0), sy.inv(v1), Math.max(3, Math.floor(plotH / 40)));

  const path = (s: PlotSeries) => {
    let d = "";
    let pen = false;
    for (const [qx, qy] of s.points) {
      if (!ok(x, qx) || !ok(y, qy)) {
        pen = false;
        continue;
      }
      const [a, b] = [px(sx.t(qx)), py(sy.t(qy))];
      d += `${pen ? "L" : "M"}${a.toFixed(1)} ${Math.max(-1e4, Math.min(1e4, b)).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  // the bands' and markers' labels in rows, so close markers (two peaks, #81) or a band's label and a
  // marker's (#109) do not write over each other
  const top = topLabels(
    bands.map((b) => ({ from: px(sx.t(b.from)), to: px(sx.t(b.to)), text: b.label })),
    markers.map((m) => ({ x: px(sx.t(m.x)), text: m.label })),
    MARGIN.left,
    width - MARGIN.right,
  );
  // a direct label on each line, placed off every line (#81) and the top rows' labels (#109); lines drawn on top
  // of each other share one
  const labels =
    series.length > 1 && series.length <= 4
      ? placeLineLabels(
          series
            .filter((s) => !s.dashed)
            .map((s) => ({
              text: s.label,
              points: s.points
                .filter(([qx, qy]) => ok(x, qx) && ok(y, qy) && sx.t(qx) <= u1 && sx.t(qx) >= u0 && sy.t(qy) >= v0 && sy.t(qy) <= v1)
                .map(([qx, qy]) => [px(sx.t(qx)), py(sy.t(qy))] as [number, number]),
            })),
          { left: MARGIN.left, top: MARGIN.top, right: width - MARGIN.right, bottom: MARGIN.top + plotH },
          topBoxes(top, MARGIN.top),
        )
      : [];
  const markerAt = top.markers;

  const readout = cursor === null ? null : series.map((s) => ({ s, v: at(s.points, cursor, sx, sy) }));
  const tipLeft = cursor === null ? 0 : Math.min(Math.max(px(cursor) + 12, MARGIN.left), width - 196);
  const step = (u1 - u0) / 60;

  return (
    <div
      ref={ref}
      className={styles.chart}
      tabIndex={0}
      role="img"
      aria-label={`${title}. Arrow keys read values; the Table button lists them.`}
      data-testid={`plot-${id}-chart`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const u = toU(e.clientX, e.currentTarget.getBoundingClientRect());
        setDrag([u, u]);
      }}
      onPointerMove={(e) => {
        const u = toU(e.clientX, e.currentTarget.getBoundingClientRect());
        setCursor(u >= u0 && u <= u1 ? u : null);
        if (drag) setDrag([drag[0], Math.min(u1, Math.max(u0, u))]);
      }}
      onPointerUp={() => {
        if (drag && Math.abs(px(drag[1]) - px(drag[0])) > 6) setView([Math.min(...drag), Math.max(...drag)]);
        setDrag(null);
      }}
      onPointerLeave={() => {
        setCursor(null);
        setDrag(null);
      }}
      onFocus={() => setCursor((c) => c ?? (u0 + u1) / 2)}
      onBlur={() => setCursor(null)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        setCursor((c) => Math.min(u1, Math.max(u0, (c ?? (u0 + u1) / 2) + (e.key === "ArrowRight" ? step : -step))));
      }}
    >
      <svg ref={svgRef} width={width} height={height} className={styles.svg} aria-hidden="true">
        <defs>
          <clipPath id={`clip-${id}`}>
            <rect x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line className={!y.log && t === 0 ? styles.zero : styles.grid} x1={MARGIN.left} x2={width - MARGIN.right} y1={py(sy.t(t))} y2={py(sy.t(t))} />
            <text className={styles.tick} x={MARGIN.left - 8} y={py(sy.t(t)) + 4} textAnchor="end">
              {sy.tick(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            {!x.log && t === 0 && <line className={styles.zero} x1={px(0)} x2={px(0)} y1={MARGIN.top} y2={MARGIN.top + plotH} />}
            <line className={styles.axisTick} x1={px(sx.t(t))} x2={px(sx.t(t))} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH + 4} />
            <text className={styles.tick} x={px(sx.t(t))} y={MARGIN.top + plotH + 17} textAnchor="middle">
              {sx.tick(t)}
            </text>
          </g>
        ))}
        <line className={styles.axis} x1={MARGIN.left} x2={width - MARGIN.right} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH} />
        <text className={styles.axisTitle} x={MARGIN.left + plotW / 2} y={height - 4} textAnchor="middle">
          {x.label}
          {sx.unit ? ` (${sx.unit})` : ""}
        </text>
        <text className={styles.axisTitle} transform={`translate(13 ${MARGIN.top + plotH / 2}) rotate(-90)`} textAnchor="middle">
          {y.label}
          {sy.unit ? ` (${sy.unit})` : ""}
        </text>

        <g clipPath={`url(#clip-${id})`}>
          {bands.map((b, i) => {
            const [a, c] = [px(sx.t(b.from)), px(sx.t(b.to))];
            // no label for a band zoomed out of view
            const label = top.bands[i];
            return (
              <g key={`${b.from}-${b.to}`} data-testid={`plot-${id}-band`}>
                <rect className={styles.band} x={Math.min(a, c)} y={MARGIN.top} width={Math.max(2, Math.abs(c - a))} height={plotH} />
                {label && (
                  <text className={styles.bandLabel} x={label.x} y={rowBaseline(MARGIN.top, label.row)} textAnchor="middle" data-row={label.row}>
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}
          {markers.map((m, i) => (
            <g key={`${m.label}-${m.x}`} data-testid={`plot-${id}-marker`}>
              <line className={styles.markerLine} x1={px(sx.t(m.x))} x2={px(sx.t(m.x))} y1={MARGIN.top} y2={MARGIN.top + plotH} />
              <text className={styles.markerLabel} x={markerAt[i].x} y={rowBaseline(MARGIN.top, markerAt[i].row)} textAnchor={markerAt[i].anchor} data-row={markerAt[i].row}>
                {m.label}
              </text>
            </g>
          ))}
          {series.map((s) => (
            <path key={s.id} className={styles.line} data-tone={s.tone} data-dashed={s.dashed || undefined} data-series={s.id} d={path(s)} />
          ))}
          {dots
            .filter((d) => ok(x, d.x) && ok(y, d.y))
            .map((d) => (
              <circle key={`${d.label}-${d.x}`} className={styles.dot} data-tone={d.tone} cx={px(sx.t(d.x))} cy={py(sy.t(d.y))} r={4.5} data-testid={`plot-${id}-dot`}>
                <title>{d.label}</title>
              </circle>
            ))}
          {drag && Math.abs(px(drag[1]) - px(drag[0])) > 2 && (
            <rect className={styles.zoom} x={Math.min(px(drag[0]), px(drag[1]))} y={MARGIN.top} width={Math.abs(px(drag[1]) - px(drag[0]))} height={plotH} />
          )}
        </g>
        {labels.map((l) => (
          <text key={l.text} className={styles.direct} x={l.x} y={l.y} textAnchor="middle" data-testid={`plot-${id}-label`}>
            {l.text}
          </text>
        ))}
        {cursor !== null && readout && (
          <g>
            <line className={styles.crosshair} x1={px(cursor)} x2={px(cursor)} y1={MARGIN.top} y2={MARGIN.top + plotH} />
            {readout.map(({ s, v }) =>
              v === null || !ok(y, v) || sy.t(v) < v0 || sy.t(v) > v1 ? null : (
                <circle key={s.id} className={styles.marker} data-tone={s.tone} cx={px(cursor)} cy={py(sy.t(v))} r={4} />
              ),
            )}
          </g>
        )}
      </svg>
      {view && (
        <button
          type="button"
          className={`${ui.button} ${styles.fit}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setView(null)}
          data-testid={`plot-${id}-fit`}
          title="Show all of it again"
        >
          Fit
        </button>
      )}
      {cursor !== null && readout && (
        <div className={`${ui.island} ${styles.tooltip}`} style={{ left: tipLeft }} data-testid="plot-tooltip">
          <p className={styles.tooltipAt}>
            {sx.value(sx.inv(cursor))}
            {atName ? ` ${atName}` : ""}
          </p>
          {readout.map(({ s, v }) => (
            <p key={s.id} className={styles.tooltipRow}>
              <span className={styles.key} data-tone={s.tone} data-dashed={s.dashed || undefined} aria-hidden="true" />
              <span className={styles.tooltipValue}>{v === null ? "—" : sy.value(v)}</span>
              <span className={styles.tooltipName}>{s.label}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Table({ id, x, y, series }: PlotProps) {
  const sx = scaleOf(x, Math.max(...series.flatMap((s) => s.points.map(([px]) => Math.abs(px))), 0));
  const sy = scaleOf(y, Math.max(...series.flatMap((s) => s.points.map(([, py]) => Math.abs(py))), 0));
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="The plot's data as a table">
      <table className={styles.table} data-testid={`plot-${id}-table`}>
        <thead>
          <tr>
            <th scope="col">Series</th>
            <th scope="col">{x.label}</th>
            <th scope="col">{y.label}</th>
          </tr>
        </thead>
        <tbody>
          {series.flatMap((s) =>
            s.points.map(([px, py], i) => (
              <tr key={`${s.id}-${i}`}>
                <th scope="row">
                  <span className={styles.key} data-tone={s.tone} data-dashed={s.dashed || undefined} aria-hidden="true" /> {s.label}
                </th>
                <td>{sx.value(px)}</td>
                <td>{sy.value(py)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}
