/**
 * Setup validation: the rules of src/levtrap/setup.py (`parse`), in
 * TypeScript, so a setup the app loads (autosave, later a file or a share
 * link) is checked before it reaches the engine. Same key paths, same
 * messages: validate.test.ts runs a set of setups through both and compares.
 *
 * Returns a normalised copy with every default filled in, as `parse` does.
 */
import { paraxialBeamWaist } from "../lib/linked.ts";
import { MATERIAL_NAMES } from "./materials.ts";
import type { Setup } from "./types.ts";

export const SETUP_VERSION = 1;
const GASES = ["N2", "He", "air"];
const POLARISATIONS = ["x", "y", "circular+", "circular-"];

export class SetupError extends Error {
  readonly path: string;
  readonly detail: string;
  constructor(path: string, detail: string) {
    super(path ? `${path}: ${detail}` : detail);
    this.name = "SetupError";
    this.path = path;
    this.detail = detail;
  }
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Python's `{x:g}`: up to six significant figures, no trailing zeros. */
function g(x: number): string {
  if (x === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(x)));
  if (exp < -4 || exp >= 6) {
    const [m, e] = x.toExponential(5).split("e");
    const mant = m.replace(/\.?0+$/, "");
    const n = Number(e);
    return `${mant}e${n < 0 ? "-" : "+"}${String(Math.abs(n)).padStart(2, "0")}`;
  }
  return String(Number(x.toPrecision(6)));
}

/** Python's repr of a string or number, for "must be one of" lists. */
const repr = (v: unknown) => (typeof v === "string" ? `'${v}'` : String(v));

function obj(v: unknown, path: string): Json {
  if (!isObj(v)) throw new SetupError(path, "must be an object");
  return v;
}

interface Limits {
  min?: number;
  exclusiveMin?: number;
  max?: number;
}

function num(v: unknown, path: string, lim: Limits = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new SetupError(path, "must be a finite number");
  if (lim.min !== undefined && v < lim.min) throw new SetupError(path, `must be at least ${g(lim.min)}`);
  if (lim.exclusiveMin !== undefined && v <= lim.exclusiveMin) throw new SetupError(path, `must be greater than ${g(lim.exclusiveMin)}`);
  if (lim.max !== undefined && v > lim.max) throw new SetupError(path, `must be at most ${g(lim.max)}`);
  return v;
}

function vec3(v: unknown, path: string, nonzero = false): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) throw new SetupError(path, "must be a list of three numbers");
  const out = v.map((c, i) => num(c, `${path}[${i}]`)) as [number, number, number];
  if (nonzero && !out.some((c) => c !== 0)) throw new SetupError(path, "must not be the zero vector");
  return out;
}

function choice<T>(v: unknown, path: string, options: readonly T[]): T {
  if (!options.includes(v as T)) throw new SetupError(path, `must be one of ${options.map(repr).join(", ")}`);
  return v as T;
}

const MISSING = Symbol("missing");

function get(d: Json, key: string, path: string, fallback: unknown = MISSING): unknown {
  if (key in d && d[key] !== null && d[key] !== undefined) return d[key];
  if (fallback === MISSING) throw new SetupError(path ? `${path}.${key}` : key, "is required");
  return fallback;
}

function particle(p: Json, path: string): Json {
  const out: Json = { ...p };
  out.radius = num(get(p, "radius", path), `${path}.radius`, { exclusiveMin: 0 });
  const material = p.material ?? null;
  if (material !== null) choice(material, `${path}.material`, MATERIAL_NAMES);
  out.material = material;
  const rules: [string, Limits][] = [
    ["n", { exclusiveMin: 0 }],
    ["k", { min: 0 }],
    ["density", { exclusiveMin: 0 }],
  ];
  for (const [key, lim] of rules) {
    if (p[key] !== null && p[key] !== undefined) out[key] = num(p[key], `${path}.${key}`, lim);
    else if (material === null) {
      if (key === "k") out[key] = 0;
      else throw new SetupError(`${path}.${key}`, "is required when no material is given");
    } else out[key] = null;
  }
  out.charge = num(p.charge || 0, `${path}.charge`);
  return out;
}

function environment(e: Json, path: string): Json {
  return {
    ...e,
    pressure: num(get(e, "pressure", path, 1e-4), `${path}.pressure`, { min: 0 }),
    temperature: num(get(e, "temperature", path, 300.0), `${path}.temperature`, { exclusiveMin: 0 }),
    gas: choice(get(e, "gas", path, "N2"), `${path}.gas`, GASES),
    medium_index: num(get(e, "medium_index", path, 1.0), `${path}.medium_index`, { min: 1 }),
  };
}

/** Real lenses a beam can be focused by (setup.LENSES). */
export const LENSES = ["354330-C"] as const;

function vec2(v: unknown, path: string, maxAbs: number): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw new SetupError(path, "must be a list of two numbers");
  return v.map((c, i) => num(c, `${path}[${i}]`, { min: -maxAbs, max: maxAbs })) as [number, number];
}

/** setup._asphere: a ray-traced lens, the beam's diameter on it, its tilt [deg] and decentre [m]. */
function asphere(f: Json, path: string): Json {
  const out: Json = { ...f };
  const extra = ["NA", "waist", "angle_deg"].filter((k) => f[k] !== null && f[k] !== undefined);
  if (extra.length) throw new SetupError(`${path}.${extra[0]}`, "is set by the lens and the beam diameter for an asphere; remove it");
  out.lens = choice(get(f, "lens", path, LENSES[0]), `${path}.lens`, LENSES);
  out.beam_diameter = num(get(f, "beam_diameter", path), `${path}.beam_diameter`, { exclusiveMin: 0, max: 0.02 });
  out.tilt_deg = vec2(get(f, "tilt_deg", path, [0, 0]), `${path}.tilt_deg`, 20);
  out.decentre = vec2(get(f, "decentre", path, [0, 0]), `${path}.decentre`, 2.5e-3);
  for (const key of ["NA", "waist", "angle_deg"]) delete out[key];
  return out;
}

/** setup._parabolic_mirror: focal length, rim and hole radii [m], the beam's diameter on it. */
function parabolicMirror(f: Json, path: string): Json {
  const out: Json = { ...f };
  const extra = ["NA", "waist", "angle_deg"].filter((k) => f[k] !== null && f[k] !== undefined);
  if (extra.length) throw new SetupError(`${path}.${extra[0]}`, "is set by the mirror and the beam diameter; remove it");
  out.focal_length = num(get(f, "focal_length", path), `${path}.focal_length`, { exclusiveMin: 0, max: 0.1 });
  out.rim_radius = num(get(f, "rim_radius", path), `${path}.rim_radius`, { exclusiveMin: 0, max: 0.1 });
  out.hole_radius = num(get(f, "hole_radius", path, 0), `${path}.hole_radius`, { min: 0 });
  if ((out.hole_radius as number) >= (out.rim_radius as number)) throw new SetupError(`${path}.hole_radius`, "must be smaller than the rim radius");
  out.beam_diameter = num(get(f, "beam_diameter", path), `${path}.beam_diameter`, { exclusiveMin: 0, max: 0.1 });
  for (const key of ["NA", "waist", "angle_deg"]) delete out[key];
  return out;
}

function focus(f: Json, path: string): Json {
  const out: Json = { ...f };
  out.kind = choice(get(f, "kind", path, "lens"), `${path}.kind`, ["lens", "asphere", "parabolic_mirror"]);
  if (out.kind === "asphere") return asphere(f, path);
  if (out.kind === "parabolic_mirror") return parabolicMirror(f, path);
  const given = ["NA", "waist", "angle_deg"].filter((k) => f[k] !== null && f[k] !== undefined);
  if (given.length !== 1) throw new SetupError(path, "give exactly one of NA, waist or angle_deg");
  const key = given[0];
  const lim: Record<string, Limits> = { NA: { exclusiveMin: 0 }, waist: { exclusiveMin: 0 }, angle_deg: { exclusiveMin: 0, max: 90 } };
  out[key] = num(f[key], `${path}.${key}`, lim[key]);
  if (f.filling !== null && f.filling !== undefined) {
    // an objective's back aperture filled by the beam (#61): it needs the aperture, i.e. the NA
    if (key !== "NA") throw new SetupError(`${path}.filling`, "needs the objective's NA (the aperture it fills); remove it or give NA");
    out.filling = num(f.filling, `${path}.filling`, { exclusiveMin: 0, max: 10 });
  }
  return out;
}

function mode(m: Json, path: string): Json {
  const out: Json = { ...m };
  out.type = choice(get(m, "type", path, "lg"), `${path}.type`, ["lg", "hg"]);
  const idx = get(m, "indices", path, [0, 0]);
  if (!Array.isArray(idx) || idx.length !== 2 || idx.some((i) => typeof i !== "number" || !Number.isInteger(i))) {
    throw new SetupError(`${path}.indices`, "must be two integers");
  }
  if (idx[0] < 0 || (out.type === "hg" && idx[1] < 0)) {
    throw new SetupError(`${path}.indices`, "mode indices must not be negative (LG azimuthal index may be)");
  }
  out.indices = [idx[0], idx[1]];
  return out;
}

function polarisation(p: unknown, path: string): unknown {
  if (typeof p === "string") return choice(p, path, POLARISATIONS);
  if (Array.isArray(p) && p.length === 2 && p.every((c) => Array.isArray(c) && c.length === 2)) {
    const out = p.map((c: unknown[], i) => [num(c[0], `${path}[${i}][0]`), num(c[1], `${path}[${i}][1]`)]);
    if (!out.flat().some((v) => v !== 0)) throw new SetupError(path, "must not be zero");
    return out;
  }
  throw new SetupError(path, "must be 'x', 'y', 'circular+', 'circular-' or [[re, im], [re, im]]");
}

function beam(f: Json, path: string): Json {
  const out: Json = { ...f };
  out.wavelength = num(get(f, "wavelength", path), `${path}.wavelength`, { exclusiveMin: 0 });
  out.power = num(get(f, "power", path), `${path}.power`, { min: 0 });
  out.focus = focus(obj(get(f, "focus", path), `${path}.focus`), `${path}.focus`);
  out.mode = mode(obj(get(f, "mode", path, {}), `${path}.mode`), `${path}.mode`);
  out.polarisation = polarisation(get(f, "polarisation", path, "x"), `${path}.polarisation`);
  out.direction = vec3(get(f, "direction", path, [0, 0, 1]), `${path}.direction`, true);
  out.position = vec3(get(f, "position", path, [0, 0, 0]), `${path}.position`);
  out.phase = num(get(f, "phase", path, 0.0), `${path}.phase`);
  const cw = f.coherent_with ?? null;
  if (cw !== null && typeof cw !== "string") throw new SetupError(`${path}.coherent_with`, "must be the id of another beam, or null");
  out.coherent_with = cw;
  return out;
}

function paul(f: Json, path: string): Json {
  const gf = obj(get(f, "geometry_factors", path, {}), `${path}.geometry_factors`);
  return {
    ...f,
    geometry: choice(get(f, "geometry", path), `${path}.geometry`, ["linear", "ring"]),
    rf_voltage: num(get(f, "rf_voltage", path), `${path}.rf_voltage`, { min: 0 }),
    rf_frequency: num(get(f, "rf_frequency", path), `${path}.rf_frequency`, { exclusiveMin: 0 }),
    dc_voltage: num(get(f, "dc_voltage", path, 0.0), `${path}.dc_voltage`),
    endcap_voltage: num(get(f, "endcap_voltage", path, 0.0), `${path}.endcap_voltage`),
    r0: num(get(f, "r0", path), `${path}.r0`, { exclusiveMin: 0 }),
    z0: num(get(f, "z0", path), `${path}.z0`, { exclusiveMin: 0 }),
    geometry_factors: {
      ...gf,
      radial: num(gf.radial ?? 1.0, `${path}.geometry_factors.radial`, { exclusiveMin: 0 }),
      axial: num(gf.axial ?? 1.0, `${path}.geometry_factors.axial`, { exclusiveMin: 0 }),
    },
  };
}

function gravity(f: Json, path: string): Json {
  return { ...f, g: vec3(get(f, "g", path, [0.0, -9.81, 0.0]), `${path}.g`) };
}

const FIELDS: Record<string, (f: Json, path: string) => Json> = { beam, paul, gravity };

function migrate(setup: Json): Json {
  const version = setup.version ?? SETUP_VERSION;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new SetupError("version", "must be a positive integer");
  if (version > SETUP_VERSION) throw new SetupError("version", `this file is version ${version}; this levtrap reads up to ${SETUP_VERSION}`);
  // version 1 is the only version: nothing to migrate yet (one function per step, as setup.py)
  return setup;
}

/** Validate a setup (object or JSON text) and return a normalised copy. Throws {@link SetupError}. */
export function validateSetup(input: unknown): Setup {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      throw new SetupError("", `not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  const s: Json = migrate(structuredClone(obj(raw, "setup")));
  s.version = SETUP_VERSION;
  s.particle = particle(obj(get(s, "particle", ""), "particle"), "particle");
  s.environment = environment(obj(s.environment ?? {}, "environment"), "environment");
  const trap: Json = { ...obj(get(s, "trap", ""), "trap") };
  const fields = get(trap, "fields", "trap");
  if (!Array.isArray(fields) || fields.length === 0) throw new SetupError("trap.fields", "must be a non-empty list");
  const out: Json[] = [];
  const ids = new Set<string>();
  fields.forEach((raw_f, i) => {
    const path = `trap.fields[${i}]`;
    let f = obj(raw_f, path);
    const kind = choice(get(f, "kind", path), `${path}.kind`, Object.keys(FIELDS));
    f = FIELDS[kind](f, path);
    const fid = f.id;
    if (fid !== undefined && fid !== null) {
      if (typeof fid !== "string" || !fid) throw new SetupError(`${path}.id`, "must be a non-empty string");
      if (ids.has(fid)) throw new SetupError(`${path}.id`, `is used twice ('${fid}')`);
      ids.add(fid);
    }
    out.push(f);
  });
  const env = s.environment as Json;
  const part = s.particle as Json;
  out.forEach((f, i) => {
    const path = `trap.fields[${i}]`;
    if (f.kind === "beam" && f.coherent_with !== null) {
      const other = out.find((o) => o.id === f.coherent_with);
      if (!other || other === f || other.kind !== "beam") throw new SetupError(`${path}.coherent_with`, "must be the id of another beam");
      if (other.wavelength !== f.wavelength) throw new SetupError(`${path}.coherent_with`, "coherent beams must share one wavelength");
    }
    const fo = f.focus as Json | undefined;
    if (f.kind === "beam" && fo && fo.NA !== null && fo.NA !== undefined && (fo.NA as number) >= (env.medium_index as number)) {
      throw new SetupError(`${path}.focus.NA`, `must be smaller than the medium index (${g(env.medium_index as number)})`);
    }
    if (f.kind === "beam" && fo && fo.waist !== null && fo.waist !== undefined) {
      const m = (f.mode as Json).indices as [number, number];
      const order = (f.mode as Json).type === "lg" ? 2 * m[0] + Math.abs(m[1]) : m[0] + m[1];
      const limit = ((f.wavelength as number) / (env.medium_index as number)) * paraxialBeamWaist(order) / Math.PI;
      if ((fo.waist as number) <= limit) throw new SetupError(`${path}.focus.waist`, `must be larger than the diffraction limit (${g(limit)} m)`);
    }
    if (f.kind === "paul" && part.charge === 0) {
      throw new SetupError("particle.charge", "a Paul trap needs a charged particle; set the charge (in elementary charges)");
    }
  });
  trap.fields = out;
  s.trap = trap;
  return s as unknown as Setup;
}
