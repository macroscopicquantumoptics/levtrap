"use client";

/**
 * The trap in 3D (D3): react-three-fiber, an orthographic camera, drawn in
 * micrometres. Drag turns the view, the wheel or a pinch zooms (from the
 * focus to the electrodes and back), right-drag pans. Click a thing to select
 * it; hover names it. Loaded on demand: the SVG drawing stands in until it is.
 */
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Matrix4, Vector3, type OrthographicCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BeamField, FieldShare, GravityField, PaulField, Vec3 } from "../../engine/types.ts";
import { environmentOf, gravityOf, partsOf, type Part, type PartId } from "../model.ts";
import { beamRadius, scaleBar, unit } from "../scene/geometry.ts";
import { lightColor } from "../scene/light.ts";
import { beamGeometry, electrodeExtent, fitScene, lensDistance, toWorld, viewDirection, WORLD, type Fit, type ViewName } from "../scene/space.ts";
import type { SceneProps } from "../Scene.tsx";
import { usePalette } from "./palette.ts";
import { Beam, ForceArrows, PaulTrap, Particle, TrapAxes, type Picking } from "./parts.tsx";
import base from "../Scene.module.css";
import styles from "./Scene3D.module.css";

export interface Overlays {
  /** draw the particle at its true size even when that is under a few pixels */
  trueSize: boolean;
  /** the trap's eigen-axes through the equilibrium */
  axes: boolean;
  /** each field's force on the particle */
  forces: boolean;
}

export interface Scene3DProps extends Omit<SceneProps, "thumbnail"> {
  width: number;
  height: number;
  overlays: Overlays;
  /** the first frame is drawn */
  onReady?(): void;
}

/** What the HTML over the canvas needs to know of the camera. */
interface CameraState {
  pxPerMetre: number;
  /** world (scene units) to clip space */
  viewProj: Matrix4;
  /** the camera's right and up, in the lab frame */
  right: Vector3;
  up: Vector3;
}

const MIN_PARTICLE_PX = 4.5;
const VIEWS: { name: ViewName; label: string; title: string }[] = [
  { name: "fit", label: "Fit", title: "Show the whole trap" },
  { name: "along", label: "Along", title: "Look along the beam" },
  { name: "side", label: "Side", title: "Look from the side" },
];

export default function Scene3D({ setup, result, selected, onSelect, inset, labels, grid, width, height, overlays, onReady }: Scene3DProps) {
  const palette = usePalette();
  const [camera, setCamera] = useState<CameraState | null>(null);
  const [hover, setHover] = useState<{ id: PartId; x: number; y: number } | null>(null);
  const [view, setView] = useState<{ name: ViewName; tick: number }>({ name: "fit", tick: 0 });
  const down = useRef<{ x: number; y: number } | null>(null);

  const room = { width: width - inset.left - inset.right, height: height - inset.top - inset.bottom };
  const centre = { x: inset.left + room.width / 2, y: inset.top + room.height / 2 };
  // the scale and the view are fitted to the stage without the inspector, so selecting a part does not move the camera
  const fit = fitScene(setup, { width: width - inset.left - 14, height: room.height });
  const fitKey = `${fit.mode}:${fit.pxPerMetre.toPrecision(4)}:${fit.target.join(",")}`;

  const n = environmentOf(setup).medium_index;
  const fields = setup.trap.fields;
  const parts = partsOf(setup);
  const firstBeam = fields.find((f): f is BeamField => f.kind === "beam");
  const equilibrium: Vec3 = result?.equilibrium ?? (firstBeam ? (firstBeam.position ?? [0, 0, 0]) : [0, 0, 0]);
  const pxPerMetre = camera?.pxPerMetre ?? fit.pxPerMetre;
  const pxPerUnit = pxPerMetre / WORLD;

  const picking: Picking = {
    selected,
    hover: hover?.id ?? null,
    onHover: (id, at) => setHover(id && at ? { id, ...at } : null),
    onPick: (id) => onSelect(id),
  };

  const beams = fields
    .map((f, index) => ({ f, index }))
    .filter((b): b is { f: BeamField; index: number } => b.f.kind === "beam")
    .map(({ f, index }) => {
      const g = beamGeometry(f, n);
      return { beam: f, index, g, lens: lensDistance(g.w0, g.theta, fit.halfView) };
    });
  const pauls = fields.map((f, index) => ({ f, index })).filter((p): p is { f: PaulField; index: number } => p.f.kind === "paul");

  const trueRadius = setup.particle.radius;
  const enlarged = !overlays.trueSize && trueRadius * pxPerMetre < MIN_PARTICLE_PX;
  const drawnRadius = enlarged ? MIN_PARTICLE_PX / pxPerMetre : trueRadius;

  // ---- screen positions -----------------------------------------------------------
  const project = useCallback(
    (p: Vec3): [number, number] => {
      if (!camera) return [centre.x, centre.y];
      const v = new Vector3(...toWorld(p)).applyMatrix4(camera.viewProj);
      return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
    },
    [camera, width, height, centre.x, centre.y],
  );

  const shareColor = useCallback(
    (s: FieldShare) => {
      const f = fields[s.fields[0]];
      if (f?.kind === "beam") return palette.color(lightColor(f.wavelength));
      if (f?.kind === "paul") return palette.color("metal-rf");
      return palette.color("scene-ink");
    },
    [fields, palette],
  );

  // ---- labels ----------------------------------------------------------------------
  const part = (id: PartId) => parts.find((p) => p.id === id)!;
  const spots: { part: Part; x: number; y: number; anchor: [number, number]; leader?: [[number, number], [number, number]] }[] = [];
  const top = inset.top;
  const bottom = height - inset.bottom;
  const left = inset.left;
  const right = width - inset.right;
  const upScreen = camera?.up ?? new Vector3(0, 1, 0);
  const plus = (p: Vec3, v: Vector3, s: number): Vec3 => [p[0] + v.x * s, p[1] + v.y * s, p[2] + v.z * s];
  for (const { beam, index, g, lens } of beams) {
    const lensCentre: Vec3 = plus(g.focus, new Vector3(...g.direction), -lens);
    const lensR = 1.12 * beamRadius(-lens, g.w0, g.theta);
    const [lx, ly] = project(lensCentre);
    const [tx, ty] = project(plus(lensCentre, upScreen, lensR));
    let beamAt = project(plus(g.focus, new Vector3(...g.direction), -lens - 0.45 * fit.halfView));
    // looked at along the beam, that point is the focus: put the label on the light's edge instead
    if (Math.hypot(beamAt[0] - lx, beamAt[1] - ly) < 0.3 * lensR * pxPerMetre) beamAt = project(plus(lensCentre, upScreen, -0.8 * lensR));
    spots.push({ part: part(`field:${index}`), x: beamAt[0], y: beamAt[1], anchor: beamAt });
    spots.push({ part: part(`lens:${index}`), x: tx, y: Math.min(ty, ly) - 18, anchor: [lx, ly] });
    void beam;
  }
  for (const { f, index } of pauls) {
    const ext = electrodeExtent(f);
    const [x, y] = project(plus([0, 0, 0], upScreen, Math.max(ext[0], ext[1])));
    spots.push({ part: part(`field:${index}`), x, y: y - 20, anchor: project([0, 0, 0]) });
  }
  const P = project(equilibrium);
  const particlePx = drawnRadius * pxPerMetre;
  const below = firstBeam ? Math.max(particlePx, (beams[0]?.g.w0 ?? 0) * pxPerMetre) : particlePx;
  const labelY = Math.min(bottom - 14, P[1] + below + 30);
  spots.push({ part: part("particle"), x: P[0], y: labelY, anchor: P, leader: [[P[0], P[1] + particlePx + 3], [P[0], labelY - 13]] });

  // ---- corner: scale bar, axes, gravity ---------------------------------------------
  const bar = scaleBar(pxPerMetre, Math.min(110, 0.22 * room.width));
  const axesAt: [number, number] = [right - 40, bottom - 30];
  const barRight = axesAt[0] - 44;
  const onScreen = (v: Vec3, length: number): [number, number] => {
    const r = camera?.right ?? new Vector3(0, 0, 1);
    const u = camera?.up ?? new Vector3(0, 1, 0);
    const w = new Vector3(...v);
    return [w.dot(r) * length, -w.dot(u) * length];
  };
  const gravityIndex = fields.findIndex((f) => f.kind === "gravity");
  let gravity: ReactNode = null;
  if (gravityIndex >= 0) {
    const id: PartId = `field:${gravityIndex}`;
    const g = unit(gravityOf(fields[gravityIndex] as GravityField));
    const [gu, gv] = onScreen(g, 1);
    const gl = Math.hypot(gu, gv) || 1;
    const from: [number, number] = [barRight - bar.px - 40, bottom - 44];
    const to: [number, number] = [from[0] + (gu / gl) * 26 * Math.min(1, gl * 1.2), from[1] + (gv / gl) * 26 * Math.min(1, gl * 1.2)];
    const wing = (s: number): [number, number] => [to[0] - (gu / gl) * 7 + s * (gv / gl) * 4.5, to[1] - (gv / gl) * 7 - s * (gu / gl) * 4.5];
    gravity = (
      <g
        className={base.part}
        data-part={id}
        data-selected={selected === id || undefined}
        data-hover={hover?.id === id || undefined}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
        onPointerEnter={() => setHover({ id, x: from[0], y: from[1] - 20 })}
        onPointerLeave={() => setHover(null)}
      >
        <circle className={base.hit} cx={from[0]} cy={from[1]} r={22} />
        <line className={base.gravity} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />
        <path className={base.gravityHead} d={`M${to[0]} ${to[1]}L${wing(1)[0]} ${wing(1)[1]}L${wing(-1)[0]} ${wing(-1)[1]}Z`} />
        <text className={base.cornerText} x={from[0] + 9} y={from[1] + 16}>
          g
        </text>
      </g>
    );
    spots.push({ part: part(id), x: from[0], y: from[1] - 30, anchor: from });
  }

  const target = project(fit.target);
  const dot = Math.max(18, bar.px / 2);
  const hoverPart = hover ? parts.find((p) => p.id === hover.id) : undefined;

  return (
    <div
      className={styles.stage}
      style={grid ? { backgroundSize: `${dot}px ${dot}px`, backgroundPosition: `${target[0] - dot / 2}px ${target[1] - dot / 2}px` } : undefined}
      data-grid={grid || undefined}
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
    >
      <Canvas
        className={styles.canvas}
        orthographic
        flat
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ manual: true, position: [0, 0, 100], near: 0.001, far: 1000 }}
        onCreated={() => requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()))}
        onPointerMissed={(e) => {
          const d = down.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // a drag, not a click
          onSelect(null);
        }}
      >
        <CameraRig setup={setup} fit={fit} fitKey={fitKey} view={view} offset={{ x: centre.x - width / 2, y: centre.y - height / 2 }} onCamera={setCamera} />
        <hemisphereLight args={["#ffffff", "#8090a0", 1.6]} />
        <directionalLight position={[-3, 5, -2]} intensity={2.2} />
        <directionalLight position={[4, -1, 3]} intensity={0.6} />
        {pauls.map(({ f, index }) => (
          <PaulTrap key={index} id={`field:${index}`} paul={f} palette={palette} picking={picking} />
        ))}
        {beams.map(({ beam, index, g, lens }) => (
          <Beam
            key={index}
            id={`field:${index}`}
            lensId={`lens:${index}`}
            geometry={g}
            wavelength={beam.wavelength}
            lens={lens}
            run={4 * fit.halfView}
            palette={palette}
            picking={picking}
            pxPerUnit={pxPerUnit}
          />
        ))}
        <Particle centre={equilibrium} radius={drawnRadius} hitRadius={Math.max(drawnRadius, 12 / pxPerMetre)} palette={palette} picking={picking} />
        {overlays.axes && result?.equilibrium && result.modes.length > 0 && (
          <TrapAxes centre={result.equilibrium} modes={result.modes} length={70 / pxPerMetre} palette={palette} />
        )}
        {/* with one field the force at the equilibrium is zero by definition: arrows only when fields share the load */}
        {overlays.forces && result?.equilibrium && result.breakdown && result.breakdown.length > 1 && (
          <ForceArrows centre={result.equilibrium} shares={result.breakdown} length={90 / pxPerMetre} colorOf={shareColor} />
        )}
      </Canvas>

      <svg className={styles.hud} width={width} height={height} aria-hidden="true">
        {labels &&
          spots.map(
            (s) =>
              s.leader && <line key={`leader-${s.part.id}`} className={base.leader} x1={s.leader[0][0]} y1={s.leader[0][1]} x2={s.leader[1][0]} y2={s.leader[1][1]} />,
          )}
        {enlarged && <circle className={base.enlarged} cx={P[0]} cy={P[1]} r={particlePx + 4} />}
        <g className={base.corner}>
          <path d={`M${barRight - bar.px} ${bottom - 22}v6h${bar.px}v-6`} className={base.scaleBar} data-testid="scale-bar-line" />
          <text className={base.cornerText} x={barRight - bar.px / 2} y={bottom - 26} textAnchor="middle" data-testid="scale-bar" data-px-per-metre={pxPerMetre}>
            {bar.label}
          </text>
          {(
            [
              ["x", [1, 0, 0], base.axisX],
              ["y", [0, 1, 0], base.axisY],
              ["z", [0, 0, 1], base.axisZ],
            ] as const
          ).map(([name, v, cls]) => {
            const [u, w] = onScreen([...v], 26);
            const [lu, lw] = onScreen([...v], 38);
            return (
              <g key={name} data-axis={name}>
                <line className={cls} x1={axesAt[0]} y1={axesAt[1]} x2={axesAt[0] + u} y2={axesAt[1] + w} />
                <text className={base.cornerText} x={axesAt[0] + lu} y={axesAt[1] + lw + 4} textAnchor="middle">
                  {name}
                </text>
              </g>
            );
          })}
          {gravity}
        </g>
      </svg>

      <div className={styles.views} role="group" aria-label="View" style={{ right: inset.right + 8, top: inset.top + 4 }}>
        {VIEWS.map((v) => (
          <button
            key={v.name}
            type="button"
            className={styles.view}
            title={v.title}
            data-testid={`view-${v.name}`}
            aria-pressed={view.name === v.name}
            onClick={() => setView((s) => ({ name: v.name, tick: s.tick + 1 }))}
          >
            {v.label}
          </button>
        ))}
      </div>

      {labels && (
        <div className={base.labels}>
          {spots.map((s) => {
            // a part out of the room (zoomed or turned away) has no label
            if (s.anchor[0] < left - 8 || s.anchor[0] > right + 8 || s.anchor[1] < top - 8 || s.anchor[1] > bottom + 8) return null;
            const text = `${s.part.name} ${s.part.summary}`;
            const half = Math.min(150, 12 + 3.4 * text.length);
            const x = Math.min(Math.max(s.x, left + half), right - half);
            const y = Math.min(Math.max(s.y, top + 14), bottom - 14);
            return (
              <button
                key={s.part.id}
                type="button"
                className={base.label}
                style={{ left: x, top: y }}
                data-part={s.part.id}
                data-kind={s.part.kind}
                data-anchor={`${s.anchor[0].toFixed(1)},${s.anchor[1].toFixed(1)}`}
                data-selected={selected === s.part.id || undefined}
                data-hover={hover?.id === s.part.id || undefined}
                aria-pressed={selected === s.part.id}
                onClick={() => onSelect(selected === s.part.id ? null : s.part.id)}
                onPointerEnter={() => setHover({ id: s.part.id, x, y })}
                onPointerLeave={() => setHover(null)}
              >
                <span className={base.labelName}>{s.part.name}</span>
                <span className={base.labelSummary}>
                  {s.part.summary}
                  {s.part.kind === "particle" && enlarged ? " · enlarged" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* hover names the thing, when the labels do not */}
      {!labels && hoverPart && (
        <div className={styles.tip} style={{ left: hover!.x, top: hover!.y }} data-testid="scene-tip">
          {hoverPart.name}
        </div>
      )}
      {/* the anchors, for tests and for anyone reading the page without the canvas */}
      <ul className={styles.anchors} data-testid="scene-anchors">
        {spots.map((s) => (
          <li key={s.part.id} data-part={s.part.id} data-x={s.anchor[0].toFixed(1)} data-y={s.anchor[1].toFixed(1)}>
            {s.part.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- camera ----------------------------------------------------------------------------

interface RigProps {
  setup: SceneProps["setup"];
  fit: Fit;
  /** the view is fitted again when this changes */
  fitKey: string;
  view: { name: ViewName; tick: number };
  /** px from the canvas centre to where the trap centre is drawn */
  offset: { x: number; y: number };
  onCamera(state: CameraState): void;
}

function CameraRig({ setup, fit, fitKey, view, offset, onCamera }: RigProps) {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControls | null>(null);
  const frame = useRef(0);
  const latest = useRef({ setup, fit, view });
  latest.current = { setup, fit, view };

  const report = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      camera.updateMatrixWorld();
      const viewProj = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      onCamera({ pxPerMetre: camera.zoom * WORLD, viewProj, right, up });
    });
  }, [camera, onCamera]);

  // made before the fit below runs (layout effects run in order), so the fit can set its target
  useLayoutEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = false;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.zoomSpeed = 1.2;
    const onChange = () => {
      invalidate();
      report();
    };
    c.addEventListener("change", onChange);
    controls.current = c;
    return () => {
      c.removeEventListener("change", onChange);
      c.dispose();
      controls.current = null;
      cancelAnimationFrame(frame.current);
    };
  }, [camera, gl, invalidate, report]);

  // the frustum is the canvas in px; the zoom is px per scene unit
  useLayoutEffect(() => {
    const { width: w, height: h } = size;
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.setViewOffset(w, h, -offset.x, -offset.y, w, h);
    camera.updateProjectionMatrix();
    invalidate();
    report();
  }, [camera, size, offset.x, offset.y, invalidate, report]);

  // fit: on a new setup scale, and on Fit / Along / Side
  useLayoutEffect(() => {
    const { setup: s, fit: f, view: v } = latest.current;
    const dir = viewDirection(v.name, s);
    const target = new Vector3(...toWorld(f.target));
    const distance = 40 * f.halfView * WORLD;
    camera.up.set(0, 1, 0);
    camera.position.copy(target).addScaledVector(new Vector3(...dir), distance);
    camera.near = distance * 1e-3;
    camera.far = 2 * distance;
    camera.zoom = f.pxPerMetre / WORLD;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    const c = controls.current;
    if (c) {
      c.target.copy(target);
      // from 2 px per nm (a waist fills the view) to 10 px per mm (a whole vacuum chamber), whatever the trap
      c.minZoom = 1e4 / WORLD;
      c.maxZoom = 2e9 / WORLD;
      c.update();
    }
    invalidate();
    report();
  }, [camera, fitKey, view.tick, invalidate, report]);

  return null;
}
