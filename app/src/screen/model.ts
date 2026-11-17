/**
 * The setup as the screen sees it: a list of named parts (the things you can
 * select), and the edits the screen makes. No physics here; a Setup goes to
 * the engine as it is.
 */
import { DEFAULT_SETUP } from "../engine/setup.ts";
import type { BeamField, Environment, Field, Focus, GravityField, Particle, PaulField, Setup, Vec3 } from "../engine/types.ts";
import { formatNumber, formatSI } from "../lib/format.ts";
import { toFieldText } from "../lib/units.ts";

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/** What can be selected. A beam's focusing optic is its own part. */
export type PartId = "particle" | "environment" | `field:${number}` | `lens:${number}`;
export type PartKind = "particle" | "environment" | "beam" | "lens" | "paul" | "gravity";

export interface Part {
  id: PartId;
  kind: PartKind;
  /** "Beam 1", "Lens", "Particle" */
  name: string;
  /** the values worth seeing without selecting: "1064 nm · 200 mW" */
  summary: string;
  /** index into trap.fields, for field and lens parts */
  index?: number;
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
/** "SiO2" -> "SiO₂" */
export const subscript = (text: string) => text.replace(/\d/g, (d) => SUBSCRIPT[Number(d)]);

export const DEFAULT_DIRECTION: Vec3 = [0, 0, 1];
export const DEFAULT_G: Vec3 = [0, -9.81, 0];
export const DEFAULT_ENVIRONMENT: Required<Environment> = { pressure: 1e-4, temperature: 300, gas: "N2", medium_index: 1 };

export const directionOf = (b: BeamField): Vec3 => b.direction ?? DEFAULT_DIRECTION;
export const positionOf = (b: BeamField): Vec3 => b.position ?? [0, 0, 0];
export const gravityOf = (g: GravityField): Vec3 => g.g ?? DEFAULT_G;
export const environmentOf = (s: Setup): Required<Environment> => ({ ...DEFAULT_ENVIRONMENT, ...s.environment });

export function focusSummary(focus: Focus): string {
  if (focus.kind === "asphere") {
    const [tx, ty] = focus.tilt_deg ?? [0, 0];
    const [dx, dy] = focus.decentre ?? [0, 0];
    const off = [tx || ty ? `tilted ${formatNumber(Math.hypot(tx, ty), 3, true)}°` : "", dx || dy ? "decentred" : ""].filter(Boolean);
    return [`${focus.lens ?? "354330-C"}`, `${formatSI(focus.beam_diameter, "m", 3, true)} beam`, ...off].join(" · ");
  }
  if (focus.NA != null) return `NA ${formatNumber(focus.NA, 3, true)}`;
  if (focus.waist != null) return `w₀ ${formatSI(focus.waist, "m", 3, true)}`;
  return `half-angle ${formatNumber(focus.angle_deg, 3, true)}°`;
}

export function modeLabel(b: BeamField): string {
  const type = b.mode?.type ?? "lg";
  const [i, j] = b.mode?.indices ?? [0, 0];
  if (i === 0 && j === 0) return "Gaussian";
  return `${type.toUpperCase()}${subscript(String(i))}${j < 0 ? "₋" : ""}${subscript(String(Math.abs(j)))}`;
}

export function particleSummary(p: Particle): string {
  const what = p.material ? subscript(p.material) : `n ${formatNumber(p.n, 3, true)}`;
  const charge = p.charge ? ` · ${p.charge > 0 ? "+" : "−"}${Math.abs(p.charge)} e` : "";
  return `${what} · ${formatSI(p.radius, "m", 3, true)}${charge}`;
}

/** Wavelengths read in nm, as on a laser's label ("1064 nm"); in µm from 3 µm up. */
export function wavelengthText(m: number): string {
  return m < 3e-6 ? `${toFieldText(m, "length", "nm", 5)} nm` : `${toFieldText(m, "length", "µm", 4)} µm`;
}

export function pressureText(pa: number): string {
  return `${toFieldText(pa, "pressure", "mbar", 3)} mbar`;
}

function gravitySummary(g: Vec3): string {
  const size = Math.hypot(...g);
  const [x, y, z] = g.map((c) => c / (size || 1));
  const along = y < -0.99 ? "down (−y)" : y > 0.99 ? "up (+y)" : z > 0.99 ? "along +z" : z < -0.99 ? "along −z" : x > 0.99 ? "along +x" : x < -0.99 ? "along −x" : "tilted";
  return `${formatNumber(size, 3, true)} m/s² ${along}`;
}

/** The selectable parts of a setup, in reading order. */
export function partsOf(setup: Setup): Part[] {
  const fields = setup.trap.fields;
  const count = (kind: Field["kind"]) => fields.filter((f) => f.kind === kind).length;
  const numbered = (kind: Field["kind"], label: string, n: number) => (count(kind) > 1 ? `${label} ${n}` : label);
  const env = environmentOf(setup);
  const parts: Part[] = [{ id: "particle", kind: "particle", name: "Particle", summary: particleSummary(setup.particle) }];
  let beams = 0;
  let pauls = 0;
  fields.forEach((f, index) => {
    if (f.kind === "beam") {
      beams += 1;
      const mode = modeLabel(f) === "Gaussian" ? "" : ` · ${modeLabel(f)}`;
      parts.push({
        id: `field:${index}`,
        kind: "beam",
        name: numbered("beam", "Beam", beams),
        summary: `${wavelengthText(f.wavelength)} · ${formatSI(f.power, "W", 3, true)}${mode}`,
        index,
      });
      parts.push({ id: `lens:${index}`, kind: "lens", name: numbered("beam", "Lens", beams), summary: focusSummary(f.focus), index });
    } else if (f.kind === "paul") {
      pauls += 1;
      parts.push({
        id: `field:${index}`,
        kind: "paul",
        name: numbered("paul", "Paul trap", pauls),
        summary: `${f.geometry} · ${formatSI(f.rf_frequency, "Hz", 3, true)} · ${formatSI(f.rf_voltage, "V", 3, true)}`,
        index,
      });
    } else {
      parts.push({ id: `field:${index}`, kind: "gravity", name: "Gravity", summary: gravitySummary(gravityOf(f)), index });
    }
  });
  parts.push({
    id: "environment",
    kind: "environment",
    name: "Environment",
    summary: `${pressureText(env.pressure)} · ${subscript(env.gas)} · ${formatNumber(env.temperature, 3, true)} K`,
  });
  return parts;
}

export function partById(setup: Setup, id: PartId | null): Part | undefined {
  return id ? partsOf(setup).find((p) => p.id === id) : undefined;
}

/** The part an engine error path points at: "trap.fields[1].focus.NA" -> "lens:1". */
export function partForPath(path: string | undefined): PartId | null {
  if (!path) return null;
  if (path.startsWith("particle")) return "particle";
  if (path.startsWith("environment")) return "environment";
  const m = /^trap\.fields\[(\d+)\](\.focus)?/.exec(path);
  if (m) return m[2] ? `lens:${Number(m[1])}` : `field:${Number(m[1])}`;
  return null;
}

// ---------------------------------------------------------------------------
// Edits (each returns a new Setup)
// ---------------------------------------------------------------------------

export function withParticle(setup: Setup, patch: Partial<Particle>): Setup {
  return { ...setup, particle: { ...setup.particle, ...patch } };
}

export function withEnvironment(setup: Setup, patch: Partial<Environment>): Setup {
  return { ...setup, environment: { ...setup.environment, ...patch } };
}

export function withField<T extends Field>(setup: Setup, index: number, patch: Partial<T>): Setup {
  const fields = setup.trap.fields.map((f, i) => (i === index ? ({ ...f, ...patch } as Field) : f));
  return { ...setup, trap: { ...setup.trap, fields } };
}

export function addField(setup: Setup, field: Field): Setup {
  return { ...setup, trap: { ...setup.trap, fields: [...setup.trap.fields, field] } };
}

/** Remove a field; beams that interfered with it stop doing so. */
export function removeField(setup: Setup, index: number): Setup {
  const gone = setup.trap.fields[index];
  const fields = setup.trap.fields
    .filter((_, i) => i !== index)
    .map((f) => (f.kind === "beam" && gone?.id && f.coherent_with === gone.id ? { ...f, coherent_with: null } : f));
  return { ...setup, trap: { ...setup.trap, fields } };
}

// ---------------------------------------------------------------------------
// New fields, with working values (never an empty form)
// ---------------------------------------------------------------------------

function freeId(setup: Setup, base: string): string {
  const used = new Set(setup.trap.fields.map((f) => f.id));
  for (let n = 1; ; n += 1) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

const negate = (v: Vec3): Vec3 => [v[0] === 0 ? 0 : -v[0], v[1] === 0 ? 0 : -v[1], v[2] === 0 ? 0 : -v[2]];

/**
 * A second beam like the first one: same wavelength, power, focus and
 * polarisation, travelling against it ("counter") or with it ("co").
 * It does not interfere with the first until `coherent_with` is set.
 */
export function newBeam(setup: Setup, relation: "counter" | "co"): BeamField {
  const first = setup.trap.fields.find((f): f is BeamField => f.kind === "beam");
  if (!first) return { ...(DEFAULT_SETUP.trap.fields[0] as BeamField), id: freeId(setup, "beam") };
  const direction = relation === "counter" ? negate(directionOf(first)) : directionOf(first);
  return {
    kind: "beam",
    id: freeId(setup, "beam"),
    wavelength: first.wavelength,
    power: first.power,
    focus: { ...first.focus },
    mode: first.mode ? { ...first.mode } : undefined,
    polarisation: first.polarisation,
    direction,
    position: positionOf(first),
    phase: 0,
    coherent_with: null,
  };
}

/**
 * Working example values. Linear: those of docs/ARCHITECTURE.md §4. Ring:
 * the same electrodes scaled to a ring, at an RF frequency that keeps the
 * axial q (twice the radial one) well inside the stability region.
 */
export function newPaulTrap(geometry: PaulField["geometry"]): PaulField {
  return geometry === "linear"
    ? { kind: "paul", geometry, rf_voltage: 300, rf_frequency: 5e3, dc_voltage: 0, endcap_voltage: 5, r0: 1e-3, z0: 2e-3, geometry_factors: { radial: 1, axial: 0.3 } }
    : { kind: "paul", geometry, rf_voltage: 300, rf_frequency: 8e3, dc_voltage: 0, endcap_voltage: 0, r0: 1e-3, z0: 0.7e-3, geometry_factors: { radial: 1, axial: 1 } };
}

export function newGravity(): GravityField {
  return { kind: "gravity", g: [...DEFAULT_G] };
}

export const hasKind = (setup: Setup, kind: Field["kind"]) => setup.trap.fields.some((f) => f.kind === kind);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** JSON with sorted keys and no undefined values: equal setups give equal text. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}
