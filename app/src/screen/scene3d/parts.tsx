"use client";

/**
 * The drawables of the 3D scene, one per kind of thing: beam (with its lens),
 * Paul-trap electrodes, particle, and the optional overlays. Everything is
 * built in scene units (micrometres, space.ts WORLD) from the Setup.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  ArrowHelper,
  BufferAttribute,
  BufferGeometry,
  type Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LinearFilter,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  Quaternion,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import type { FieldShare, PaulField, TrapMode, Vec3 } from "../../engine/types.ts";
import type { PartId } from "../model.ts";
import { beamRadius } from "../scene/geometry.ts";
import { lightColor } from "../scene/light.ts";
import { sag, type LensData } from "../../engine/lenses.ts";
import { mirrorSag } from "../../engine/mirrors.ts";
import type { FieldBlock, MirrorFocus, SlicePlane } from "../../engine/types.ts";
import { sliceCorners, sliceImage } from "../scene/slice.ts";
import { beamProfile, beamToLab, type BeamGeometry, electrodes, type Electrode, lensToLab, type LensPlacement, toWorld, WORLD } from "../scene/space.ts";
import type { Palette } from "./palette.ts";

/** What a drawable needs to answer the pointer. */
export interface Picking {
  selected: PartId | null;
  hover: PartId | null;
  onHover(id: PartId | null, at?: { x: number; y: number }): void;
  onPick(id: PartId): void;
}

/**
 * Pointer handlers for a part. A ray through the scene meets several things
 * (the light surrounds the particle; the lens covers the focus when looked
 * at along the beam): the one with the highest priority answers.
 */
function handlers(id: PartId, priority: number, picking: Picking) {
  const outranked = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.intersections.some((i) => ((i.object.userData.priority as number | undefined) ?? -1) > priority && i.object.userData.part !== id);
  return {
    userData: { part: id, priority },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (outranked(e)) return;
      e.stopPropagation();
      picking.onHover(id, { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (outranked(e)) return;
      e.stopPropagation();
      picking.onHover(id, { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    },
    onPointerOut: () => picking.onHover(null),
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (outranked(e)) return;
      e.stopPropagation();
      if (e.delta > 4) return; // the end of a drag that turned the view
      picking.onPick(id);
    },
  };
}

/** Rotation that turns +y (the axis of three's lathes and cylinders) onto `axis`. */
function alongY(axis: Vec3): Quaternion {
  return new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...axis).normalize());
}

const noRaycast = () => null;

// --- beam ------------------------------------------------------------------------

const BEAM_VERTEX = /* glsl */ `
attribute float alpha;
varying float vAlpha;
varying float vFacing;
void main() {
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(n.z);
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BEAM_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform vec3 select;
uniform float gain;
uniform float highlight;
varying float vAlpha;
varying float vFacing;
void main() {
  // the light is a volume: brightest where the ray crosses most of it
  float body = vAlpha * gain * mix(0.22, 1.0, vFacing);
  float rim = highlight * pow(1.0 - vFacing, 6.0) * step(0.03, vAlpha);
  gl_FragColor = vec4(mix(color, select, min(1.0, 2.0 * rim)), clamp(body + rim, 0.0, 1.0));
}`;

export interface BeamProps {
  id: PartId;
  lensId: PartId;
  geometry: BeamGeometry;
  wavelength: number;
  /** distance of the lens upstream of the focus [m] */
  lens: number;
  /** how far the collimated light is drawn before the lens [m] */
  run: number;
  palette: Palette;
  picking: Picking;
  /** px per scene unit, for the dashes of the optical axis */
  pxPerUnit: number;
  /** draw the symbolic lens (an ideal lens); a real lens is drawn by AsphereLens */
  symbol?: boolean;
  /** draw the light's volume; off while the intensity slice shows the light itself */
  light?: boolean;
}

export function Beam({ id, lensId, geometry: g, wavelength, lens: L, run, palette, picking, pxPerUnit, symbol = true, light = true }: BeamProps) {
  const color = palette.color(lightColor(wavelength));
  const dark = palette.theme === "dark";

  const mesh = useMemo(() => {
    const profile = beamProfile(g.w0, g.theta, -L, 1.3 * L, 120);
    const rL = beamRadius(-L, g.w0, g.theta);
    // the collimated light into the lens, then the focused cone through the focus
    const samples: [number, number][] = [[-L - run, rL], [-L - 0.66 * run, rL], [-L - 0.33 * run, rL], [-L - 1e-3 * L, rL], ...profile];
    const glow = (zeta: number) => {
      const intensity = 0.1 + 0.5 * Math.min(1, (g.w0 / beamRadius(zeta, g.w0, g.theta)) ** 1.1);
      const t = zeta / L;
      return t <= 0.45 ? intensity : intensity * Math.max(0, (1.12 - t) / 0.67);
    };
    const points = samples.map(([zeta, r]) => new Vector2(r * WORLD, zeta * WORLD));
    const segments = 64;
    const lathe = new LatheGeometry(points, segments);
    const alpha = new Float32Array((segments + 1) * points.length);
    // the collimated light fades out upstream, so the lens and the focus carry the picture
    const upstream = (zeta: number) => 0.7 * glow(-L) * Math.max(0, 1 + (zeta + L) / run);
    for (let i = 0; i <= segments; i += 1) samples.forEach(([zeta], j) => (alpha[i * points.length + j] = zeta < -L ? upstream(zeta) : glow(zeta)));
    lathe.setAttribute("alpha", new BufferAttribute(alpha, 1));
    return lathe;
  }, [g.w0, g.theta, L, run]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        uniforms: { color: { value: new Vector3() }, select: { value: new Vector3() }, gain: { value: 1 }, highlight: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    [],
  );
  material.uniforms.color.value.set(color.r, color.g, color.b);
  const sel = palette.color("select");
  material.uniforms.select.value.set(sel.r, sel.g, sel.b);
  material.uniforms.gain.value = dark ? 0.62 : 0.55;
  material.uniforms.highlight.value = picking.selected === id ? 1 : picking.hover === id ? 0.5 : 0;
  material.blending = dark ? AdditiveBlending : NormalBlending;

  const q = useMemo(() => alongY(g.direction), [g.direction]);
  const focus = toWorld(g.focus);

  // the optical axis: a dashed line through the focus, the length of the drawn light
  const axis = useMemo(() => {
    const geo = new BufferGeometry().setFromPoints([new Vector3(0, (-L - run) * WORLD, 0), new Vector3(0, 2 * L * WORLD, 0)]);
    const line = new Line(geo, new LineDashedMaterial({ transparent: true, opacity: 0.38 }));
    line.computeLineDistances();
    line.raycast = noRaycast;
    return line;
  }, [L, run]);
  const dash = axis.material as LineDashedMaterial;
  dash.color.copy(palette.color("scene-ink"));
  dash.dashSize = 14 / pxPerUnit;
  dash.gapSize = 6 / pxPerUnit;

  return (
    <group position={focus} quaternion={q}>
      <primitive object={axis} />
      <mesh geometry={mesh} material={material} renderOrder={2} visible={light} {...handlers(id, 0, picking)} />
      {symbol && <Lens id={lensId} at={-L} radius={1.12 * beamRadius(-L, g.w0, g.theta)} palette={palette} picking={picking} />}
    </group>
  );
}

/** A biconvex lens across the beam, `at` metres along it from the focus. */
function Lens({ id, at, radius, palette, picking }: { id: PartId; at: number; radius: number; palette: Palette; picking: Picking }) {
  const geometry = useMemo(() => {
    const R = radius * WORLD;
    const sag = 0.11 * R;
    const rim = 0.02 * R;
    const points: Vector2[] = [];
    const n = 24;
    for (let i = 0; i <= n; i += 1) points.push(new Vector2((R * i) / n, -rim - sag * (1 - (i / n) ** 2)));
    for (let i = n; i >= 0; i -= 1) points.push(new Vector2((R * i) / n, rim + sag * (1 - (i / n) ** 2)));
    return new LatheGeometry(points, 64);
  }, [radius]);
  const glass = palette.color("glass");
  const state = picking.selected === id ? 1 : picking.hover === id ? 0.5 : 0;
  return (
    <mesh geometry={geometry} position={[0, at * WORLD, 0]} renderOrder={3} {...handlers(id, 1, picking)}>
      <meshStandardMaterial
        color={glass}
        transparent
        opacity={0.3 + 0.2 * state}
        roughness={0.15}
        metalness={0}
        depthWrite={false}
        emissive={palette.color("select")}
        emissiveIntensity={0.55 * state}
        side={DoubleSide}
      />
    </mesh>
  );
}

/**
 * A real lens (focus.kind "asphere"): its two even-aspheric surfaces from the
 * prescription, at its true size and distance, tilted and decentred as the
 * engine traces it (scene/space.ts lensToLab).
 */
export function AsphereLens({ id, data, placement, beam, palette, picking }: { id: PartId; data: LensData; placement: LensPlacement; beam: { direction: Vec3; position: Vec3 }; palette: Palette; picking: Picking }) {
  // rebuilt only when the lens or where it stands changes (the objects are made afresh each render)
  const where = JSON.stringify([placement, beam]);
  const geometry = useMemo(() => {
    const [place, at] = JSON.parse(where) as [LensPlacement, { direction: Vec3; position: Vec3 }];
    const t = data.thickness * 1e3; // mm
    const points: Vector2[] = [];
    const n = 32;
    for (let i = 0; i <= n; i += 1) {
      const r = (data.s1.sd * i) / n;
      points.push(new Vector2(r, sag(data.s1, r)));
    }
    for (let i = n; i >= 0; i -= 1) {
      const r = (data.s2.sd * i) / n;
      // the flange from the front surface's rim to the back surface's
      if (i === n) points.push(new Vector2(data.s1.sd, t + sag(data.s2, r)));
      points.push(new Vector2(r, t + sag(data.s2, r)));
    }
    const lathe = new LatheGeometry(points, 64);
    // lathe (x, y, z), axis y, in mm -> the lens's own frame in m (axis z) -> the lab, in scene units
    const pos = lathe.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) {
      const lab = lensToLab([pos.getX(i) * 1e-3, pos.getZ(i) * 1e-3, pos.getY(i) * 1e-3], at, place);
      pos.setXYZ(i, lab[0] * WORLD, lab[1] * WORLD, lab[2] * WORLD);
    }
    lathe.computeVertexNormals();
    return lathe;
  }, [data, where]);
  const state = picking.selected === id ? 1 : picking.hover === id ? 0.5 : 0;
  return (
    <mesh geometry={geometry} renderOrder={3} {...handlers(id, 1, picking)} data-lens="asphere">
      <meshStandardMaterial
        color={palette.color("glass")}
        transparent
        opacity={0.38 + 0.2 * state}
        roughness={0.12}
        metalness={0}
        depthWrite={false}
        emissive={palette.color("select")}
        emissiveIntensity={0.55 * state}
        side={DoubleSide}
      />
    </mesh>
  );
}

/**
 * A parabolic mirror (focus.kind "parabolic_mirror"): the paraboloid between
 * its hole and its rim, at its true size about the focus. Faint, so the trap
 * inside a deep mirror stays in view.
 */
export function ParabolicMirror({ id, focus, beam, palette, picking }: { id: PartId; focus: MirrorFocus; beam: { direction: Vec3; position: Vec3 }; palette: Palette; picking: Picking }) {
  const where = JSON.stringify([focus, beam]);
  const { geometry, edges } = useMemo(() => {
    const [m, at] = JSON.parse(where) as [MirrorFocus, { direction: Vec3; position: Vec3 }];
    const inner = m.hole_radius ?? 0;
    const toScene = (p: Vec3) => beamToLab(p, at).map((c) => c * WORLD) as Vec3;
    const n = 48;
    const points: Vector2[] = [];
    for (let i = 0; i <= n; i += 1) {
      const rho = inner + ((m.rim_radius - inner) * i) / n;
      points.push(new Vector2(rho, mirrorSag(m, rho)));
    }
    const lathe = new LatheGeometry(points, 72);
    // lathe (x, y, z), axis y -> the beam's own frame (axis z) -> the lab, in scene units
    const pos = lathe.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) {
      const lab = toScene([pos.getX(i), pos.getZ(i), pos.getY(i)]);
      pos.setXYZ(i, lab[0], lab[1], lab[2]);
    }
    lathe.computeVertexNormals();
    // the rim and the hole's edge, as segments: they carry the outline and the selection
    const segs: number[] = [];
    for (const rho of inner > 0 ? [m.rim_radius, inner] : [m.rim_radius]) {
      for (let i = 0; i < 96; i += 1) {
        const [a, b] = [(2 * Math.PI * i) / 96, (2 * Math.PI * (i + 1)) / 96];
        const z = mirrorSag(m, rho);
        segs.push(...toScene([rho * Math.cos(a), rho * Math.sin(a), z]), ...toScene([rho * Math.cos(b), rho * Math.sin(b), z]));
      }
    }
    const edges = new BufferGeometry();
    edges.setAttribute("position", new Float32BufferAttribute(segs, 3));
    return { geometry: lathe, edges };
  }, [where]);
  const state = picking.selected === id ? 1 : picking.hover === id ? 0.5 : 0;
  const edge = useMemo(() => new LineSegments(edges, new LineBasicMaterial({ transparent: true })), [edges]);
  const material = edge.material as LineBasicMaterial;
  material.color = state ? palette.color("select") : palette.color("metal-edge");
  material.opacity = 0.7 + 0.3 * state;
  return (
    <group>
      {/* faint: a deep mirror stands all round the trap, which stays in view through it */}
      <mesh geometry={geometry} renderOrder={3} {...handlers(id, 1, picking)} data-mirror="parabolic">
        <meshStandardMaterial color={palette.color("metal")} transparent opacity={0.16 + 0.08 * state} roughness={0.3} metalness={0.5} depthWrite={false} side={DoubleSide} />
      </mesh>
      <primitive object={edge} />
    </group>
  );
}

/**
 * The intensity slice (#48): the light's intensity on a lab plane through
 * the trap, as a texture in the light's colour whose opacity follows the
 * intensity. Drawn behind the particle, without writing depth.
 */
export function IntensitySlice({ field, plane, color }: { field: FieldBlock; plane: SlicePlane; color: Color }) {
  const rgb = [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)] as [number, number, number];
  const key = `${rgb.join(",")}|${plane}`;
  const { geometry, texture } = useMemo(() => {
    const img = sliceImage(field, plane, rgb);
    const tex = new DataTexture(img.data, img.width, img.height, RGBAFormat);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.needsUpdate = true;
    const corners = sliceCorners(field, plane).map(toWorld);
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(corners.flat(), 3));
    g.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return { geometry: g, texture: tex };
    // rgb is in key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, key]);
  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshBasicMaterial map={texture} transparent depthWrite={false} side={DoubleSide} toneMapped={false} />
    </mesh>
  );
}

// --- Paul trap -----------------------------------------------------------------------

function electrodeGeometry(e: Electrode): { geometry: BufferGeometry; position: Vec3; quaternion: Quaternion } {
  if (e.shape === "rod") {
    const from = toWorld(e.from);
    const to = toWorld(e.to);
    const axis: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(...axis);
    const r = e.radius * WORLD;
    // a rod with rounded ends
    const points: Vector2[] = [];
    const n = 10;
    for (let i = 0; i <= n; i += 1) {
      const a = (Math.PI / 2) * (i / n);
      points.push(new Vector2(r * Math.sin(a) + 1e-6, -length / 2 - 0.12 * r * Math.cos(a)));
    }
    for (let i = n; i >= 0; i -= 1) {
      const a = (Math.PI / 2) * (i / n);
      points.push(new Vector2(r * Math.sin(a) + 1e-6, length / 2 + 0.12 * r * Math.cos(a)));
    }
    return {
      geometry: new LatheGeometry(points, 48),
      position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      quaternion: alongY(axis),
    };
  }
  const [ri, ro, t] = [e.inner * WORLD, e.outer * WORLD, (e.thickness * WORLD) / 2];
  const bevel = 0.15 * Math.min(t, ro - ri);
  const points = [
    new Vector2(ri, -t + bevel),
    new Vector2(ri + bevel, -t),
    new Vector2(ro - bevel, -t),
    new Vector2(ro, -t + bevel),
    new Vector2(ro, t - bevel),
    new Vector2(ro - bevel, t),
    new Vector2(ri + bevel, t),
    new Vector2(ri, t - bevel),
    new Vector2(ri, -t + bevel),
  ];
  return { geometry: new LatheGeometry(points, 96), position: toWorld(e.centre), quaternion: alongY(e.axis) };
}

export function PaulTrap({ id, paul, palette, picking }: { id: PartId; paul: PaulField; palette: Palette; picking: Picking }) {
  const parts = useMemo(() => electrodes(paul).map((e) => ({ e, ...electrodeGeometry(e) })), [paul]);
  const state = picking.selected === id ? 1 : picking.hover === id ? 0.5 : 0;
  const meshes = useRef<(Mesh | null)[]>([]);

  // an electrode between the camera and the trap centre is drawn faint, so the centre stays in view
  useFrame(({ camera, size }) => {
    // zoomed in far below the electrodes' scale, they would only be a backdrop: all are drawn faint
    const zoomedIn = size.width / (camera as import("three").OrthographicCamera).zoom < 0.5 * paul.r0 * WORLD;
    const toCamera = new Vector3().subVectors(camera.position, new Vector3(0, 0, 0)).normalize();
    meshes.current.forEach((m, i) => {
      if (!m) return;
      const { e } = parts[i];
      let inTheWay = false;
      if (e.shape === "rod") {
        // a rod hides the centre when the line of sight through the centre passes through it
        // (the rods run along z: the distance between the two lines is along v × z)
        const c = new Vector3(...toWorld(e.from)).setZ(0);
        const n = new Vector3().crossVectors(toCamera, new Vector3(0, 0, 1));
        const off = n.length() > 1e-3 ? Math.abs(c.dot(n)) / n.length() : Infinity;
        inTheWay = c.dot(toCamera) > 0 && off < 1.1 * e.radius * WORLD;
      }
      inTheWay ||= zoomedIn;
      const mat = m.material as MeshStandardMaterial;
      const opacity = zoomedIn ? 0.07 : inTheWay ? 0.16 : 1;
      if (mat.opacity !== opacity) {
        mat.opacity = opacity;
        mat.transparent = inTheWay;
        mat.depthWrite = !inTheWay;
        mat.needsUpdate = true;
      }
      m.userData.priority = inTheWay ? -1 : 1;
    });
  });

  const tone = (role: Electrode["role"]) =>
    role === "rf" ? palette.color("metal-rf") : role === "endcap" ? palette.color("metal").clone().lerp(palette.color("metal-edge"), 0.35) : palette.color("metal");

  return (
    <group>
      {parts.map(({ e, geometry, position, quaternion }, i) => (
        <mesh
          key={e.name}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={geometry}
          position={position}
          quaternion={quaternion}
          {...handlers(id, 1, picking)}
          name={e.name}
        >
          <meshStandardMaterial color={tone(e.role)} metalness={0.35} roughness={0.42} emissive={palette.color("select")} emissiveIntensity={0.45 * state} />
        </mesh>
      ))}
    </group>
  );
}

// --- particle ----------------------------------------------------------------------------

export function Particle({ centre, radius, palette, picking, hitRadius }: { centre: Vec3; radius: number; hitRadius: number; palette: Palette; picking: Picking }) {
  const id: PartId = "particle";
  const state = picking.selected === id ? 1 : picking.hover === id ? 0.5 : 0;
  const p = toWorld(centre);
  return (
    <group position={p}>
      <mesh scale={radius * WORLD} renderOrder={1}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshStandardMaterial color={palette.color("particle")} roughness={0.35} metalness={0.05} emissive={palette.color("select")} emissiveIntensity={0.5 * state} />
      </mesh>
      {state > 0 && (
        <mesh scale={radius * WORLD * 1.25} raycast={noRaycast}>
          <sphereGeometry args={[1, 32, 16]} />
          <meshBasicMaterial color={palette.color("select")} transparent opacity={0.35 * state} side={1} depthWrite={false} />
        </mesh>
      )}
      {/* an invisible, larger target: a 200 nm sphere is a few pixels */}
      <mesh scale={hitRadius * WORLD} {...handlers(id, 2, picking)}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  );
}

// --- overlays -------------------------------------------------------------------------------

/** The trap's eigen-axes through the equilibrium, in the axis colours. */
export function TrapAxes({ centre, modes, length, palette }: { centre: Vec3; modes: TrapMode[]; length: number; palette: Palette }) {
  const lines = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    for (const m of modes) {
      const a = new Vector3(...m.axis).normalize().multiplyScalar(length * WORLD);
      positions.push(-a.x, -a.y, -a.z, a.x, a.y, a.z);
      const c = palette.color(m.name === "x" ? "axis-x" : m.name === "y" ? "axis-y" : "axis-z");
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const seg = new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    seg.renderOrder = 10;
    seg.raycast = noRaycast;
    return seg;
  }, [modes, length, palette]);
  return <primitive object={lines} position={toWorld(centre)} />;
}

/**
 * Each field's force on the particle at the equilibrium, as arrows. Lengths
 * go with the logarithm of the force (the forces span decades); the largest
 * is `length` long.
 */
export function ForceArrows({ centre, shares, length, colorOf }: { centre: Vec3; shares: FieldShare[]; length: number; colorOf(share: FieldShare): import("three").Color }) {
  const group = useMemo(() => {
    const g = new Group();
    const sizes = shares.map((s) => Math.hypot(...s.force));
    const largest = Math.max(...sizes, 0);
    shares.forEach((s, i) => {
      if (!(sizes[i] > 0) || !(largest > 0)) return;
      const decades = Math.max(0, 3 + Math.log10(sizes[i] / largest)); // 0 … 3
      const L = length * WORLD * (0.3 + (0.7 * decades) / 3);
      const arrow = new ArrowHelper(new Vector3(...s.force).normalize(), new Vector3(), L, colorOf(s), 0.22 * L, 0.12 * L);
      arrow.traverse((o) => {
        o.raycast = noRaycast;
        o.renderOrder = 11;
        const m = (o as Mesh).material as Material | undefined;
        if (m) m.depthTest = false;
      });
      g.add(arrow);
    });
    return g;
  }, [shares, length, colorOf]);
  return <primitive object={group} position={toWorld(centre)} />;
}
