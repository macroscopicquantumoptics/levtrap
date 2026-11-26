/**
 * The Sweep tab's model: which inputs of a setup can be swept, which numbers
 * can be read off each result, and the values to try. Pure; sweep.test.ts.
 */
import type { BeamField, PaulField, Result, Setup, Vec3 } from "../../engine/types.ts";
import type { Quantity } from "../../lib/units.ts";
import { angleFromWaist, modeOrder, naFromAngle } from "../../lib/linked.ts";
import { shownFrequency } from "../answer.ts";
import { directionOf, environmentOf, partsOf, positionOf, withEnvironment, withField, withParticle } from "../model.ts";

export interface SweepParam {
  id: string;
  /** "Beam 1 · power" */
  label: string;
  quantity: Quantity;
  /** the unit its fields start in */
  unit: string;
  /** SI */
  get(setup: Setup): number;
  set(setup: Setup, value: number): Setup;
  /** its default range spans decades (×1/10 to ×10); log spacing then starts on (logByDefault, #72) */
  log: boolean;
  /** a sentence when a value cannot be used */
  check(value: number): string | null;
}

const positive = (v: number) => (v > 0 ? null : "Must be greater than 0.");

/** The inputs of this setup worth sweeping, in the order of its parts. */
export function sweepParams(setup: Setup): SweepParam[] {
  const out: SweepParam[] = [];
  const parts = partsOf(setup);
  const name = (id: string) => parts.find((p) => p.id === id)?.name ?? id;
  const n = environmentOf(setup).medium_index;
  setup.trap.fields.forEach((f, index) => {
    if (f.kind === "beam") {
      const beam = name(`field:${index}`);
      const at = (patch: Partial<BeamField>) => (s: Setup) => withField<BeamField>(s, index, patch);
      out.push({
        id: `beam${index}-power`,
        label: `${beam} · power`,
        quantity: "power",
        unit: "mW",
        get: (s) => (s.trap.fields[index] as BeamField).power,
        set: (s, v) => at({ power: v })(s),
        log: false,
        check: positive,
      });
      out.push({
        id: `beam${index}-wavelength`,
        label: `${beam} · wavelength`,
        quantity: "length",
        unit: "nm",
        get: (s) => (s.trap.fields[index] as BeamField).wavelength,
        set: (s, v) => at({ wavelength: v })(s),
        log: false,
        check: positive,
      });
      const focus = f.focus;
      if (focus.kind === "parabolic_mirror") {
        // a parabolic mirror (E3): its size, its hole and the beam on it
        const mirrorName = name(`lens:${index}`);
        type M = typeof focus;
        const of = (s: Setup) => (s.trap.fields[index] as BeamField).focus as M;
        const mirror = (key: "beam_diameter" | "focal_length" | "rim_radius" | "hole_radius", label: string): SweepParam => ({
          id: `lens${index}-${key}`,
          label: `${mirrorName} · ${label}`,
          quantity: "length",
          unit: "mm",
          get: (s) => of(s)[key] ?? 0,
          set: (s, v) => withField<BeamField>(s, index, { focus: { ...of(s), [key]: v } }),
          log: false,
          check: key === "hole_radius" ? (v) => (v >= 0 ? null : "Must be 0 or more.") : (v) => (v > 0 && v <= 0.1 ? null : "Between 0 and 100 mm."),
        });
        out.push(mirror("beam_diameter", "beam diameter"), mirror("focal_length", "focal length"), mirror("rim_radius", "rim radius"), mirror("hole_radius", "hole radius"));
        return;
      }
      if (focus.kind === "asphere") {
        // a real lens: its beam diameter and its tilts (E1)
        const lensName = name(`lens:${index}`);
        const asphere = (patch: Record<string, unknown>) => (s: Setup) => {
          const b = s.trap.fields[index] as BeamField;
          return withField<BeamField>(s, index, { focus: { ...(b.focus as typeof focus), ...patch } });
        };
        const tilt = (s: Setup) => ((s.trap.fields[index] as BeamField).focus as typeof focus).tilt_deg ?? [0, 0];
        const within20 = (v: number) => (Math.abs(v) <= 20 ? null : "At most 20° either way.");
        out.push({
          id: `lens${index}-beam_diameter`,
          label: `${lensName} · beam diameter`,
          quantity: "length",
          unit: "mm",
          get: (s) => ((s.trap.fields[index] as BeamField).focus as typeof focus).beam_diameter,
          set: (s, v) => asphere({ beam_diameter: v })(s),
          log: false,
          check: (v) => (v > 0 && v <= 0.02 ? null : "Between 0 and 20 mm."),
        });
        out.push({ id: `lens${index}-tilt_x`, label: `${lensName} · tilt about x`, quantity: "angle", unit: "°", get: (s) => tilt(s)[0], set: (s, v) => asphere({ tilt_deg: [v, tilt(s)[1]] })(s), log: false, check: within20 });
        out.push({ id: `lens${index}-tilt_y`, label: `${lensName} · tilt about y`, quantity: "angle", unit: "°", get: (s) => tilt(s)[1], set: (s, v) => asphere({ tilt_deg: [tilt(s)[0], v] })(s), log: false, check: within20 });
        return;
      }
      // an ideal lens (#72): the sweep varies its NA and keeps the rest of the lens model
      // (its mapping, #64, and its filling, #61); a lens given by waist or half-angle
      // starts from the NA of that same focus and becomes an NA lens
      out.push({
        id: `lens${index}-NA`,
        label: `${name(`lens:${index}`)} · NA`,
        quantity: "number",
        unit: "",
        get: (s) => idealNA(s.trap.fields[index] as BeamField, environmentOf(s).medium_index),
        set: (s, v) => {
          // drop only the other ways of giving the focus (one of NA, waist, angle_deg)
          const given = new Set(["NA", "waist", "angle_deg"]);
          const rest = Object.fromEntries(Object.entries((s.trap.fields[index] as BeamField).focus).filter(([k]) => !given.has(k)));
          return at({ focus: { ...rest, kind: "lens", NA: v } as BeamField["focus"] })(s);
        },
        log: false,
        check: (v) => (v > 0 && v < n ? null : `Must be between 0 and the medium index (${n}).`),
      });
    } else if (f.kind === "paul") {
      const trap = name(`field:${index}`);
      const at = (patch: Partial<PaulField>) => (s: Setup) => withField<PaulField>(s, index, patch);
      const get = (key: "rf_voltage" | "rf_frequency" | "endcap_voltage" | "dc_voltage") => (s: Setup) => (s.trap.fields[index] as PaulField)[key] ?? 0;
      out.push({ id: `paul${index}-rf_voltage`, label: `${trap} · RF voltage`, quantity: "voltage", unit: "V", get: get("rf_voltage"), set: (s, v) => at({ rf_voltage: v })(s), log: false, check: positive });
      out.push({ id: `paul${index}-rf_frequency`, label: `${trap} · RF frequency`, quantity: "frequency", unit: "kHz", get: get("rf_frequency"), set: (s, v) => at({ rf_frequency: v })(s), log: true, check: positive });
      if (f.geometry === "linear") {
        out.push({ id: `paul${index}-endcap_voltage`, label: `${trap} · end-cap voltage`, quantity: "voltage", unit: "V", get: get("endcap_voltage"), set: (s, v) => at({ endcap_voltage: v })(s), log: false, check: () => null });
      }
      out.push({ id: `paul${index}-dc_voltage`, label: `${trap} · DC voltage`, quantity: "voltage", unit: "V", get: get("dc_voltage"), set: (s, v) => at({ dc_voltage: v })(s), log: false, check: () => null });
    }
  });
  out.push({
    id: "particle-radius",
    label: "Particle · radius",
    quantity: "length",
    unit: "nm",
    get: (s) => s.particle.radius,
    set: (s, v) => withParticle(s, { radius: v }),
    log: true,
    check: positive,
  });
  if (setup.trap.fields.some((f) => f.kind === "paul")) {
    out.push({
      id: "particle-charge",
      label: "Particle · charge",
      quantity: "charge",
      unit: "e",
      get: (s) => s.particle.charge ?? 0,
      set: (s, v) => withParticle(s, { charge: Math.round(v) }),
      log: false,
      check: positive,
    });
  }
  out.push({
    id: "environment-pressure",
    label: "Environment · pressure",
    quantity: "pressure",
    unit: "mbar",
    get: (s) => environmentOf(s).pressure,
    set: (s, v) => withEnvironment(s, { pressure: v }),
    log: true,
    check: positive,
  });
  out.push({
    id: "environment-temperature",
    label: "Environment · temperature",
    quantity: "temperature",
    unit: "K",
    get: (s) => environmentOf(s).temperature,
    set: (s, v) => withEnvironment(s, { temperature: v }),
    log: false,
    check: positive,
  });
  return out;
}

export interface SweepOutput {
  id: string;
  label: string;
  /** SI unit of the values, "" for a pure number */
  unit: string;
  /** one value per series (by name); null where there is none */
  read(result: Result, setup: Setup): { name: string; value: number | null }[];
}

export const OUTPUTS: SweepOutput[] = [
  {
    id: "frequencies",
    label: "Trap frequencies",
    unit: "Hz",
    read: (r) => r.modes.map((m) => ({ name: m.name, value: r.stable ? shownFrequency(r, m) : null })),
  },
  {
    id: "depth",
    label: "Depth (k_BT)",
    unit: "",
    read: (r) => [{ name: "depth", value: r.stable ? r.depth.kT : null }],
  },
  {
    id: "position",
    label: "Equilibrium along the beam",
    unit: "m",
    read: (r, s) => {
      const beam = s.trap.fields.find((f): f is BeamField => f.kind === "beam");
      if (!r.equilibrium || !beam) return [{ name: "position", value: r.equilibrium ? r.equilibrium[1] : null }];
      const d = directionOf(beam);
      const p = positionOf(beam);
      const len = Math.hypot(...d) || 1;
      return [{ name: "position", value: r.equilibrium.reduce((sum, c, i) => sum + ((c - p[i]) * d[i]) / len, 0) }];
    },
  },
  {
    id: "scattered",
    label: "Scattered power",
    unit: "W",
    read: (r) => [{ name: "scattered", value: r.optical?.P_sca ?? null }],
  },
  {
    id: "absorbed",
    label: "Absorbed power",
    unit: "W",
    read: (r) => [{ name: "absorbed", value: r.optical?.P_abs ?? null }],
  },
  {
    id: "recoil",
    label: "Recoil heating (phonons/s)",
    unit: "",
    read: (r) => (r.rates?.modes ?? []).map((m) => ({ name: m.name, value: r.stable ? m.recoil_heating : null })),
  },
];

/** Where the next solve of a sweep starts (continuation): the last stable equilibrium so far, or null. */
export function followFrom(results: readonly (Result | null)[]): Vec3 | null {
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const r = results[i];
    if (r?.stable && r.equilibrium) return r.equilibrium;
  }
  return null;
}

/** The swept values where the followed trap vanished (the engine searched afresh). */
export function jumpsAt(xs: readonly number[], results: readonly (Result | null)[]): number[] {
  return results.flatMap((r, i) => (r?.followed?.jumped ? [xs[i]] : []));
}

/** `n` values from `from` to `to`, evenly or in log. */
export function sweepValues(from: number, to: number, n: number, log: boolean): number[] {
  const count = Math.max(2, Math.round(n));
  if (log && from > 0 && to > 0) {
    const [a, b] = [Math.log10(from), Math.log10(to)];
    return Array.from({ length: count }, (_, i) => 10 ** (a + ((b - a) * i) / (count - 1)));
  }
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

/** A starting range around the current value: ×½ to ×2 (×1/10 to ×10 in log). */
export function defaultRange(param: SweepParam, setup: Setup): [number, number] {
  const v = param.get(setup);
  if (/-tilt_[xy]$/.test(param.id)) return [-1, 1];
  if (param.id.endsWith("-hole_radius")) {
    const focus = (setup.trap.fields[Number(/^lens(\d+)/.exec(param.id)![1])] as BeamField).focus;
    return [0, focus.kind === "parabolic_mirror" ? focus.rim_radius / 2 : 1e-3];
  }
  if (param.id.endsWith("-NA")) return [Math.max(0.1, v - 0.5), Math.min(0.95 * environmentOf(setup).medium_index, v + 0.15)];
  if (v === 0) return [0, 10];
  return param.log ? [v / 10, v * 10] : [v / 2, v * 2];
}

/**
 * The NA of an ideal lens however it is given (#72): NA itself, or n sin θ of
 * its half-angle, or of the half-angle its waist implies with its mapping and
 * the beam's mode order (the engine's relation, as the Inspector shows it;
 * lib/linked.ts). NaN for a real lens or a mirror, which have no NA input.
 */
export function idealNA(beam: BeamField, nMedium: number): number {
  const focus = beam.focus;
  if (focus.kind === "asphere" || focus.kind === "parabolic_mirror") return Number.NaN;
  if (focus.NA != null) return focus.NA;
  const mapping = focus.mapping === "sine" ? "sine" : "ott";
  const order = modeOrder(beam.mode?.type ?? "lg", beam.mode?.indices ?? [0, 0]);
  const angle = focus.angle_deg != null ? (focus.angle_deg * Math.PI) / 180 : angleFromWaist(focus.waist!, beam.wavelength, nMedium, order, mapping);
  return naFromAngle(angle, nMedium);
}

/**
 * Log spacing starts on only for a range that spans a decade or more (#72): a
 * pressure or RF-frequency scan over decades, not a resonance scan of
 * 290–310 nm, whose points should fall on even steps.
 */
export function logByDefault(from: number, to: number): boolean {
  if (!(from > 0 && to > 0)) return false;
  return Math.max(from, to) / Math.min(from, to) >= 10;
}

/** Contiguous runs of points where the trap is not stable, as [from, to] in the swept value. */
export function unstableRuns(xs: number[], stable: boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  let start: number | null = null;
  xs.forEach((x, i) => {
    // a run reaches halfway to its stable neighbours
    const lo = i > 0 ? (xs[i - 1] + x) / 2 : x;
    const hi = i < xs.length - 1 ? (xs[i + 1] + x) / 2 : x;
    if (!stable[i]) {
      if (start === null) start = lo;
      if (i === xs.length - 1 || stable[i + 1]) {
        runs.push([start, hi]);
        start = null;
      }
    }
  });
  return runs;
}
