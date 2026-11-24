"use client";

import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import type { BeamField, GravityField, PaulField, Result, Setup, Vec3 } from "../engine/types.ts";
import { useSize } from "./hooks.ts";
import { directionOf, environmentOf, gravityOf, partsOf, positionOf, type Part, type PartId } from "./model.ts";
import {
  beamRadius,
  beamShape,
  cylinder,
  discPoints,
  fitView,
  pathOf,
  project,
  projectVector,
  scaleBar,
  unit,
  type Box,
  type Point,
} from "./scene/geometry.ts";
import { lightColor } from "./scene/light.ts";
import type { Overlays, PatternData, RayData, SliceData } from "./scene3d/Scene3D.tsx";
import styles from "./Scene.module.css";

export interface SceneProps {
  setup: Setup;
  /** for the particle's position; null: draw it at the trap centre */
  result: Result | null;
  selected: PartId | null;
  onSelect(id: PartId | null): void;
  /** px kept free of the drawing on each side (islands, inspector) */
  inset: Box["inset"];
  /** name every part beside it */
  labels: boolean;
  grid: boolean;
  /** a small still picture (preset cards): no scale bar, no axes, nothing to click */
  thumbnail?: boolean;
  /** the 3D scene's overlays (Show menu) */
  overlays?: Overlays;
  /** the intensity slice's data, while it is shown (Show → Intensity slice) */
  field?: SliceData | null;
  /** traced rays, while shown (Show → Traced rays) */
  rays?: RayData | null;
  /** the radiation pattern, while shown (Show → Radiation pattern) */
  pattern?: PatternData | null;
  /** the "Not to scale" toggle in the corner was pressed */
  onScale?(toScale: boolean): void;
}

interface LabelSpot {
  part: Part;
  x: number;
  y: number;
  /** a line from the label to its part */
  leader?: [Point, Point];
}

const MIN_PARTICLE_PX = 4.5;

const Scene3D = lazy(() => import("./scene3d/Scene3D.tsx"));

const NO_OVERLAYS: Overlays = { toScale: false, axes: false, forces: false };

let webgl: boolean | undefined;
/** Whether this browser draws WebGL (asked once). `?scene=svg` asks for the flat drawing. */
function canDraw3D(): boolean {
  if (webgl === undefined) {
    try {
      const wanted = new URLSearchParams(window.location.search).get("scene") !== "svg";
      webgl = wanted && Boolean(document.createElement("canvas").getContext("webgl2"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/** Falls back to the flat drawing if the 3D scene fails (a lost or refused WebGL context). */
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The scene: the trap, drawn from the Setup. Click a thing to select it.
 * In 3D (scene3d/Scene3D.tsx) where WebGL works; as a flat SVG drawing while
 * that loads, where it does not, and for the preset cards' thumbnails.
 */
export function Scene(props: SceneProps) {
  const { setup, result, selected, onSelect, inset, labels, grid, thumbnail, overlays, field, rays, pattern, onScale } = props;
  const [ref, size] = useSize();
  const [hover, setHover] = useState<PartId | null>(null);
  const [drawn, setDrawn] = useState(false);
  const ready = size.width > 0 && size.height > 0;
  const three = !thumbnail && ready && canDraw3D();

  const flat = ready && (
    <Drawing
      setup={setup}
      result={result}
      selected={selected}
      onSelect={onSelect}
      labels={labels}
      grid={grid}
      thumbnail={thumbnail}
      box={{ width: size.width, height: size.height, inset }}
      hover={hover}
      setHover={setHover}
    />
  );

  return (
    <div
      ref={ref}
      className={styles.scene}
      data-testid={thumbnail ? undefined : "scene"}
      data-thumbnail={thumbnail || undefined}
      data-renderer={thumbnail ? undefined : three ? (drawn ? "webgl" : "loading") : "svg"}
    >
      {three ? (
        <Fallback fallback={flat}>
          <Suspense fallback={flat}>
            <Scene3D
              setup={setup}
              result={result}
              selected={selected}
              onSelect={onSelect}
              inset={inset}
              labels={labels}
              grid={grid}
              width={size.width}
              height={size.height}
              overlays={overlays ?? NO_OVERLAYS}
              field={thumbnail ? null : (field ?? null)}
              rays={thumbnail ? null : (rays ?? null)}
              pattern={thumbnail ? null : (pattern ?? null)}
              onScale={onScale}
              onReady={() => setDrawn(true)}
            />
          </Suspense>
        </Fallback>
      ) : (
        flat
      )}
    </div>
  );
}

interface DrawingProps extends Omit<SceneProps, "inset"> {
  box: Box;
  hover: PartId | null;
  setHover(id: PartId | null): void;
}

function Drawing({ setup, result, selected, onSelect, labels, grid, thumbnail, box, hover, setHover }: DrawingProps) {
  const view = fitView(setup, box);
  const parts = partsOf(setup);
  const part = (id: PartId) => parts.find((p) => p.id === id)!;
  const nMedium = environmentOf(setup).medium_index;
  const fields = setup.trap.fields;
  const spots: LabelSpot[] = [];
  const left = box.inset.left;
  const right = box.width - box.inset.right;
  const top = box.inset.top;
  const bottom = box.height - box.inset.bottom;

  /** Props that make an SVG group select its part on click. */
  const pick = (id: PartId) => ({
    className: styles.part,
    "data-part": id,
    "data-selected": selected === id || undefined,
    "data-hover": hover === id || undefined,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(id);
    },
    onPointerEnter: () => setHover(id),
    onPointerLeave: () => setHover(null),
  });

  // ---- beams and their lenses ------------------------------------------------
  const beamLayers: ReactNode[] = [];
  const lensLayers: ReactNode[] = [];
  const axisLines: ReactNode[] = [];
  const defs: ReactNode[] = [];
  const far = box.width + box.height;

  fields.forEach((f, index) => {
    if (f.kind !== "beam") return;
    const beam: BeamField = f;
    const shape = beamShape(beam, nMedium, view, box);
    const d = unit(directionOf(beam));
    const focus = positionOf(beam);
    const F = project(view, focus);
    const A = projectVector(view.scale, d);
    const len = Math.hypot(A[0], A[1]) || 1;
    const a: Point = [A[0] / len, A[1] / len];
    const n: Point = [-a[1], a[0]];
    // The beam is drawn in the picture plane: an hourglass around its axis, true to the scale bar.
    const radiusPx = (zetaPx: number) => view.scale * beamRadius(zetaPx / len, shape.w0, shape.theta);
    const at = (zetaPx: number, side: number): Point => [
      F[0] + a[0] * zetaPx + n[0] * side * radiusPx(zetaPx),
      F[1] + a[1] * zetaPx + n[1] * side * radiusPx(zetaPx),
    ];
    const L = shape.lensDistance * len; // px from the focus to the lens (len is px per metre along the beam)
    const rL = radiusPx(-L);
    const out = 1.3 * L; // the light is drawn this far past the focus, fading out

    // collimated, into the lens
    const collimated: Point[] = [
      [F[0] - a[0] * (L + far) + n[0] * rL, F[1] - a[1] * (L + far) + n[1] * rL],
      at(-L, 1),
      at(-L, -1),
      [F[0] - a[0] * (L + far) - n[0] * rL, F[1] - a[1] * (L + far) - n[1] * rL],
    ];
    // the focused cone: lens, waist, and on through the focus
    const edgeA: Point[] = [];
    const edgeB: Point[] = [];
    const samples = 120;
    for (let i = 0; i <= samples; i += 1) {
      const zeta = -L + ((out + L) * i) / samples;
      edgeA.push(at(zeta, 1));
      edgeB.push(at(zeta, -1));
    }
    const cone = [...edgeA, ...edgeB.slice().reverse()];

    const color = lightColor(beam.wavelength);
    const gradientId = `light-${index}`;
    const w0px = shape.w0 * view.scale;
    // brightness follows the intensity on the axis, 1 / radius²; past the focus it fades to nothing
    const BASE = 0.06;
    const glow = (zeta: number) => BASE + 0.5 * Math.min(1, (w0px / radiusPx(zeta)) ** 1.1);
    const stops: [number, number][] = [-1, -0.45, -0.2, 0, 0.2, 0.45, 0.8, 1.12, 1.3].map((t) => [
      (t + 1) / 2.3,
      glow(t * L) * (t <= 0.45 ? 1 : Math.max(0, (1.12 - t) / 0.67)),
    ]);
    defs.push(
      <linearGradient
        key={gradientId}
        id={gradientId}
        gradientUnits="userSpaceOnUse"
        x1={F[0] - a[0] * L}
        y1={F[1] - a[1] * L}
        x2={F[0] + a[0] * out}
        y2={F[1] + a[1] * out}
      >
        {stops.map(([offset, opacity]) => (
          <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
        ))}
      </linearGradient>,
    );

    // the outline shown on hover and selection: the two edges of the light, fading out with it
    const edgeId = `edge-${index}`;
    defs.push(
      <linearGradient key={edgeId} id={edgeId} gradientUnits="userSpaceOnUse" x1={F[0] + a[0] * 0.45 * L} y1={F[1] + a[1] * 0.45 * L} x2={F[0] + a[0] * 1.12 * L} y2={F[1] + a[1] * 1.12 * L}>
        <stop offset={0} className={styles.edgeStop} stopOpacity={1} />
        <stop offset={1} className={styles.edgeStop} stopOpacity={0} />
      </linearGradient>,
    );
    const beamId: PartId = `field:${index}`;
    beamLayers.push(
      <g key={beamId} {...pick(beamId)}>
        <path d={pathOf(collimated)} fill={color} fillOpacity={glow(-L)} />
        <path d={pathOf(cone)} fill={`url(#${gradientId})`} />
        <path className={styles.edge} d={pathOf([collimated[0], ...edgeA], false)} stroke={`url(#${edgeId})`} />
        <path className={styles.edge} d={pathOf([collimated[3], ...edgeB], false)} stroke={`url(#${edgeId})`} />
      </g>,
    );
    axisLines.push(
      <line
        key={`axis-${index}`}
        className={styles.opticalAxis}
        x1={F[0] - a[0] * far}
        y1={F[1] - a[1] * far}
        x2={F[0] + a[0] * far}
        y2={F[1] + a[1] * far}
      />,
    );

    // the lens: the biconvex symbol of an optics drawing, across the beam, upstream of the focus
    const C: Point = [F[0] - a[0] * L, F[1] - a[1] * L];
    const halfHeight = shape.lensRadius * view.scale;
    const sag = Math.min(40, Math.max(6, 0.17 * halfHeight));
    const curve = (halfHeight * halfHeight + sag * sag) / (2 * sag);
    const tip = (sign: number): Point => [C[0] + sign * n[0] * halfHeight, C[1] + sign * n[1] * halfHeight];
    const [t0, t1] = [tip(-1), tip(1)];
    const arc = (to: Point) => `A${curve.toFixed(1)} ${curve.toFixed(1)} 0 0 1 ${to[0].toFixed(1)} ${to[1].toFixed(1)}`;
    const lensPath = `M${t0[0].toFixed(1)} ${t0[1].toFixed(1)}${arc(t1)}${arc(t0)}Z`;
    const lensId: PartId = `lens:${index}`;
    lensLayers.push(
      <g key={lensId} {...pick(lensId)}>
        <path className={`${styles.shape} ${styles.glass}`} d={lensPath} />
      </g>,
    );

    // labels: the beam on its collimated part, the lens beyond its upper tip
    const upper = t0[1] <= t1[1] ? -1 : 1;
    const upperTip = tip(upper);
    const upstream = Math.abs(a[0]) > 0.5 ? (a[0] > 0 ? C[0] - left : right - C[0]) : a[1] > 0 ? C[1] - top : bottom - C[1];
    const back = Math.max(26, Math.min(upstream / 2, 150));
    spots.push({ part: part(beamId), x: C[0] - a[0] * back, y: C[1] - a[1] * back });
    spots.push({ part: part(lensId), x: upperTip[0] + upper * n[0] * 18, y: Math.max(top + 14, upperTip[1] + upper * n[1] * 18) });
  });

  // ---- Paul trap electrodes ----------------------------------------------------
  const behind: ReactNode[] = [];
  const inFront: ReactNode[] = [];
  fields.forEach((f, index) => {
    if (f.kind !== "paul") return;
    const paul: PaulField = f;
    const id: PartId = `field:${index}`;
    const { r0, z0 } = paul;
    const rod = (c0: Vec3, c1: Vec3, radius: number, tone: string, key: string) => {
      const c = cylinder(view, c0, c1, radius);
      return (
        <g key={key} className={tone}>
          <path className={`${styles.shape} ${styles.metal}`} d={pathOf(c.body)} />
          <path className={`${styles.shape} ${styles.metalFace}`} d={pathOf(c.face)} />
        </g>
      );
    };
    if (paul.geometry === "linear") {
      const a = 0.3 * r0;
      const rho = r0 + a;
      const half = z0 + r0;
      const cap = 0.3 * r0;
      behind.push(
        <g key={`${id}-back`} {...pick(id)}>
          {rod([rho, 0, -half], [rho, 0, half], a, styles.rf, "x+")}
          {rod([0, rho, -half], [0, rho, half], a, "", "y+")}
          {rod([0, -rho, -half], [0, -rho, half], a, "", "y-")}
          {rod([0, 0, -z0 - 0.45 * r0], [0, 0, -z0], cap, styles.cap, "cap-")}
          {rod([0, 0, z0], [0, 0, z0 + 0.45 * r0], cap, styles.cap, "cap+")}
        </g>,
      );
      inFront.push(
        <g key={`${id}-front`} {...pick(id)}>
          {rod([-rho, 0, -half], [-rho, 0, half], a, styles.rf, "x-")}
        </g>,
      );
      const topRod = project(view, [0, rho + a, 0]);
      spots.push({ part: part(id), x: topRod[0], y: Math.max(top + 14, topRod[1] - 22) });
    } else {
      const outer = 1.5 * r0;
      const t = 0.3 * r0;
      const ring = cylinder(view, [0, 0, -t / 2], [0, 0, t / 2], outer);
      const holeNear = discPoints(view, [0, 0, t / 2], [0, 0, 1], r0);
      const holeFar = discPoints(view, [0, 0, -t / 2], [0, 0, 1], r0);
      const clipId = `hole-${index}`;
      defs.push(
        <clipPath key={clipId} id={clipId}>
          <path d={pathOf(holeNear)} />
        </clipPath>,
      );
      const cap = 0.35 * r0;
      behind.push(
        <g key={`${id}-back`} {...pick(id)}>
          {rod([0, 0, -z0 - 0.6 * r0], [0, 0, -z0], cap, styles.cap, "cap-")}
          <g className={styles.rf}>
            <path className={`${styles.shape} ${styles.metal}`} d={pathOf(ring.body)} />
            <path className={`${styles.shape} ${styles.metalFace}`} d={pathOf(ring.face)} />
            <path className={`${styles.shape} ${styles.metal}`} d={pathOf(holeNear)} />
            <path className={styles.hole} d={pathOf(holeFar)} clipPath={`url(#${clipId})`} />
          </g>
        </g>,
      );
      inFront.push(
        <g key={`${id}-front`} {...pick(id)}>
          {rod([0, 0, z0], [0, 0, z0 + 0.6 * r0], cap, styles.cap, "cap+")}
        </g>,
      );
      const ringTop = project(view, [0, outer, 0]);
      spots.push({ part: part(id), x: ringTop[0], y: Math.max(top + 14, ringTop[1] - 26) });
    }
  });

  // ---- particle ------------------------------------------------------------------
  const firstBeam = fields.find((f): f is BeamField => f.kind === "beam");
  const centre: Vec3 = result?.equilibrium ?? (firstBeam ? positionOf(firstBeam) : [0, 0, 0]);
  const P = project(view, centre);
  const truePx = setup.particle.radius * view.scale;
  const particlePx = Math.max(truePx, MIN_PARTICLE_PX);
  const enlarged = truePx < MIN_PARTICLE_PX;
  const below = firstBeam ? Math.max(particlePx, view.scale * beamShape(firstBeam, nMedium, view, box).w0) : particlePx;
  const particleLabelY = Math.min(bottom - 14, P[1] + below + 30);
  spots.push({
    part: part("particle"),
    x: P[0],
    y: particleLabelY,
    leader: [
      [P[0], P[1] + particlePx + 3],
      [P[0], particleLabelY - 13],
    ],
  });

  // ---- corner: scale bar, axes, gravity ----------------------------------------------
  const bar = scaleBar(view.scale, Math.min(110, 0.22 * (right - left)));
  const axesAt: Point = [right - 44, bottom - 18];
  const axisTip = (v: Vec3, length = 30): Point => {
    const [u, w] = projectVector(length, v);
    return [axesAt[0] + u, axesAt[1] + w];
  };
  const barRight = axesAt[0] - 34;
  const gravityIndex = fields.findIndex((f) => f.kind === "gravity");
  let gravity: ReactNode = null;
  if (gravityIndex >= 0) {
    const id: PartId = `field:${gravityIndex}`;
    const g = unit(gravityOf(fields[gravityIndex] as GravityField));
    const [gu, gv] = projectVector(1, g);
    const gl = Math.hypot(gu, gv) || 1;
    const from: Point = [barRight - bar.px - 44, bottom - 46];
    const to: Point = [from[0] + (gu / gl) * 30, from[1] + (gv / gl) * 30];
    const wing = (sign: number): Point => [to[0] - (gu / gl) * 8 + sign * (gv / gl) * 5, to[1] - (gv / gl) * 8 - sign * (gu / gl) * 5];
    gravity = (
      <g {...pick(id)}>
        <circle className={styles.hit} cx={(from[0] + to[0]) / 2} cy={(from[1] + to[1]) / 2} r={24} />
        <line className={styles.gravity} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />
        <path className={styles.gravityHead} d={pathOf([to, wing(1), wing(-1)])} />
        <text className={styles.cornerText} x={from[0] + 9} y={from[1] + 9}>
          g
        </text>
      </g>
    );
    spots.push({ part: part(id), x: from[0], y: Math.max(top + 14, from[1] - 22) });
  }

  const dot = Math.max(18, bar.px / 2);

  return (
    <>
      <svg className={styles.svg} width={box.width} height={box.height} aria-hidden="true" onClick={() => onSelect(null)}>
        <defs>
          <pattern id="scene-dots" width={dot} height={dot} patternUnits="userSpaceOnUse" x={view.cx - dot / 2} y={view.cy - dot / 2}>
            <circle cx={dot / 2} cy={dot / 2} r={1.25} className={styles.dot} />
          </pattern>
          <radialGradient id="particle-fill" cx="35%" cy="32%" r="75%">
            <stop offset="0" className={styles.particleLight} />
            <stop offset="1" className={styles.particleDark} />
          </radialGradient>
          {defs}
        </defs>
        {grid && <rect width={box.width} height={box.height} fill="url(#scene-dots)" />}
        {axisLines}
        {behind}
        {beamLayers}
        {lensLayers}
        {inFront}
        <g {...pick("particle")}>
          <circle className={styles.hit} cx={P[0]} cy={P[1]} r={Math.max(14, particlePx + 4)} />
          {enlarged && <circle className={styles.enlarged} cx={P[0]} cy={P[1]} r={particlePx + 4} />}
          <circle className={`${styles.shape} ${styles.particle}`} cx={P[0]} cy={P[1]} r={particlePx} fill="url(#particle-fill)" />
        </g>
        {spots.map(
          (s) =>
            labels &&
            s.leader && (
              <line key={`leader-${s.part.id}`} className={styles.leader} x1={s.leader[0][0]} y1={s.leader[0][1]} x2={s.leader[1][0]} y2={s.leader[1][1]} />
            ),
        )}
        <g className={styles.corner} display={thumbnail ? "none" : undefined}>
          <path d={`M${barRight - bar.px} ${bottom - 22}v6h${bar.px}v-6`} className={styles.scaleBar} />
          <text className={styles.cornerText} x={barRight - bar.px / 2} y={bottom - 26} textAnchor="middle" data-testid={thumbnail ? undefined : "scale-bar"}>
            {bar.label}
          </text>
          {(
            [
              ["x", [1, 0, 0], styles.axisX],
              ["y", [0, 1, 0], styles.axisY],
              ["z", [0, 0, 1], styles.axisZ],
            ] as const
          ).map(([name, v, cls]) => {
            const tip = axisTip([...v]);
            const lab = axisTip([...v], name === "x" ? 52 : 40);
            return (
              <g key={name}>
                <line className={cls} x1={axesAt[0]} y1={axesAt[1]} x2={tip[0]} y2={tip[1]} />
                <text className={styles.cornerText} x={lab[0]} y={lab[1] + 4} textAnchor="middle">
                  {name}
                </text>
              </g>
            );
          })}
          {gravity}
        </g>
      </svg>
      {labels && (
        <div className={styles.labels}>
          {spots.map((s) => {
            const text = `${s.part.name} ${s.part.summary}`;
            const half = Math.min(150, 12 + 3.4 * text.length);
            const x = Math.min(Math.max(s.x, left + half), right - half);
            return (
              <button
                key={s.part.id}
                type="button"
                className={styles.label}
                style={{ left: x, top: s.y }}
                data-part={s.part.id}
                data-kind={s.part.kind}
                data-selected={selected === s.part.id || undefined}
                data-hover={hover === s.part.id || undefined}
                aria-pressed={selected === s.part.id}
                onClick={() => onSelect(selected === s.part.id ? null : s.part.id)}
                onPointerEnter={() => setHover(s.part.id)}
                onPointerLeave={() => setHover(null)}
              >
                <span className={styles.labelName}>{s.part.name}</span>
                <span className={styles.labelSummary}>
                  {s.part.summary}
                  {s.part.kind === "particle" && enlarged ? " · enlarged" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
