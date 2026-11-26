/**
 * Every number explains itself: what it is, the formula (formulas.ts), the
 * values that went in, and the model behind it with its validity. Entries
 * are data, so a test can check each one and typeset every formula.
 */
import type { ModelInfo, Multipoles, PaulField, Result, Setup } from "../engine/types.ts";
import { formatMass, formatNumber, formatSci, formatSI } from "../lib/format.ts";
import { toFieldText } from "../lib/units.ts";
import { shownFrequency } from "./answer.ts";
import type { FormulaId } from "./formulas.ts";
import { environmentOf, subscript } from "./model.ts";

export interface Explanation {
  /** "Trap frequency along x" */
  title: string;
  /** the value as shown, with its unit */
  value: string;
  /** the full SI value, for the clipboard */
  copy: string;
  formula: FormulaId;
  /** symbols are TeX */
  inputs: { symbol: string; value: string; note: string }[];
  model: { name: string; validity: string; notes: string[] } | null;
}

const MODELS: Record<string, string> = {
  mie: "Mie theory (T-matrix): exact for a homogeneous sphere of any size",
  mathieu: "Mathieu equation: exact secular frequency",
  pseudopotential: "Pseudopotential approximation of the RF field",
  "knudsen-interpolation": "Knudsen-number interpolation from the free-molecular to the continuum limit",
  "dipole-pattern": "Photon recoil with the scattered light's dipole pattern",
};

const VALIDITY: Record<string, string> = { ok: "Valid here", approximate: "Approximate here" };

function describeModel(info: ModelInfo | undefined): Explanation["model"] {
  if (!info) return null;
  return { name: MODELS[info.model] ?? info.model, validity: VALIDITY[info.validity] ?? info.validity, notes: info.notes };
}

const model = (result: Result, quantity: string) => describeModel(result.models.find((m) => m.quantity === quantity));
const AXES = ["x", "y", "z"] as const;
type Axis = (typeof AXES)[number];
const triple = (values: (number | null | undefined)[], format: (v: number | null | undefined) => string) => values.map(format).join(" · ");
const copyTriple = (values: (number | null | undefined)[], unit: string) => values.map((v) => (v == null ? "" : `${v} ${unit}`)).join(", ");
const KB = 1.380649e-23;

/** The multipoles of the scattered light, in the order Mie theory counts them (#80). */
export const MULTIPOLES: { key: keyof Multipoles; name: string }[] = [
  { key: "ED", name: "electric dipole" },
  { key: "MD", name: "magnetic dipole" },
  { key: "EQ", name: "electric quadrupole" },
  { key: "MQ", name: "magnetic quadrupole" },
  { key: "EO", name: "electric octupole" },
  { key: "MO", name: "magnetic octupole" },
  { key: "higher", name: "all orders from n = 4 up" },
];

export interface MultipoleShare {
  key: keyof Multipoles;
  name: string;
  /** W, scattered by the beams at the equilibrium */
  power: number;
  /** of the scattered power */
  share: number;
  /** the same share for a plane wave (Q_sca per multipole over Q_sca) */
  planeWave: number;
}

/** Each multipole's share of the scattered power, largest first (#80): the
 * beams' own split at the equilibrium, beside a plane wave's. A focused or
 * structured beam excites each order with its own weight: the dark trap of
 * arXiv:2607.09896 puts most of the light into the magnetic quadrupole,
 * where a plane wave on the same sphere scatters mostly into the magnetic
 * dipole. Empty without the split (a Result from before #80, or no light). */
export function multipoleShares(result: Result): MultipoleShare[] {
  const o = result.optical;
  const P = o?.P_sca_multipoles;
  const Q = o?.Qsca_multipoles;
  if (!o || !P || !Q) return [];
  const total = MULTIPOLES.reduce((sum, m) => sum + P[m.key], 0);
  const qTotal = MULTIPOLES.reduce((sum, m) => sum + Q[m.key], 0);
  if (!(total > 0) || !(qTotal > 0)) return [];
  return MULTIPOLES.map((m) => ({ ...m, power: P[m.key], share: P[m.key] / total, planeWave: Q[m.key] / qTotal })).sort((a, b) => b.share - a.share);
}

/** A share as a percentage with three figures; below 0.1 % it reads "< 0.1". */
const percent = (share: number) => (share < 1e-3 ? "< 0.1" : formatNumber(100 * share, 3, true));

// --- headline numbers ---------------------------------------------------------------

/** One mode's frequency. */
export function explainFrequency(result: Result, setup: Setup, index: number): Explanation {
  const mode = result.modes[index];
  const frequency = shownFrequency(result, mode);
  const info = result.models.find((m) => m.quantity === "modes");
  const paul = setup.trap.fields.find((f): f is PaulField => f.kind === "paul");
  const base = {
    title: `Trap frequency along ${mode.name}`,
    value: formatSI(frequency, "Hz"),
    copy: frequency == null ? "" : `${frequency} Hz`,
    model: describeModel(info),
  };
  const axis = mode.name as Axis;
  if (result.paul && paul && axis in result.paul.q && !result.optical) {
    const a = { symbol: `a_${axis}`, value: formatNumber(result.paul.a[axis], 3), note: `Mathieu a along ${axis}: the static field` };
    const q = { symbol: `q_${axis}`, value: formatNumber(result.paul.q[axis], 3), note: `Mathieu q along ${axis}: the RF field` };
    const rf = { symbol: String.raw`f_\mathrm{RF}`, value: formatSI(paul.rf_frequency, "Hz", 3, true), note: "RF frequency" };
    if (info?.model === "mathieu") {
      const beta = frequency == null ? null : (2 * frequency) / paul.rf_frequency;
      return {
        ...base,
        formula: "paul-exact",
        inputs: [{ symbol: String.raw`\beta_${axis}`, value: formatNumber(beta, 3), note: "characteristic exponent of the Mathieu equation for a and q" }, a, q, rf],
      };
    }
    return { ...base, formula: "paul-pseudopotential", inputs: [a, q, rf] };
  }
  return {
    ...base,
    formula: "optical-frequency",
    inputs: [
      { symbol: `k_${mode.name}`, value: formatSI(mode.stiffness, "N/m"), note: "stiffness: how fast the restoring force grows away from the equilibrium" },
      { symbol: "m", value: formatMass(result.particle.mass), note: "mass of the sphere, from its radius and density" },
    ],
  };
}

/** The trap depth. */
export function explainDepth(result: Result, setup: Setup): Explanation {
  const temperature = environmentOf(setup).temperature;
  return {
    title: "Trap depth",
    value: `${formatNumber(result.depth.kT, 3)} k_BT`,
    copy: `${result.depth.J} J`,
    formula: "depth",
    inputs: [
      { symbol: "U", value: formatSI(result.depth.J, "J"), note: "the smallest depth over the three axes" },
      { symbol: String.raw`U / k_\mathrm{B}`, value: formatSI(result.depth.K, "K"), note: "the same as a temperature" },
      { symbol: "T", value: `${formatNumber(temperature, 3, true)} K`, note: "temperature of the environment" },
      ...result.modes.map((m) => ({
        symbol: `U_${m.name}`,
        value: m.depth == null ? "—" : `${formatNumber(m.depth / (KB * temperature), 3)} k_BT`,
        note: `depth along ${m.name}`,
      })),
    ],
    model: model(result, "modes"),
  };
}

// --- secondary numbers ----------------------------------------------------------------

export interface Secondary {
  id: string;
  label: string;
  value: string;
  explain(): Explanation;
}

/** The numbers behind the headline ones, each with its explanation. */
export function secondaryNumbers(result: Result, setup: Setup): Secondary[] {
  const out: Secondary[] = [];
  const env = environmentOf(setup);
  const modeNames = result.modes.map((m) => m.name).join(", ");

  if (result.equilibrium) {
    const eq = result.equilibrium;
    const value = eq.map((c) => (Math.abs(c) < 1e-15 ? "0" : formatSI(c, "m"))).join(" · ");
    out.push({
      id: "position",
      label: "Position (x, y, z)",
      value,
      explain: () => ({
        title: "Equilibrium position",
        value,
        copy: copyTriple(eq, "m"),
        formula: "equilibrium",
        inputs: [
          { symbol: String.raw`\mathbf{r}_0`, value, note: "where the forces of all the fields add to zero, and pull back from every side" },
          ...(result.breakdown ?? []).map((share, i) => ({
            symbol: String.raw`\mathbf{F}_{${i + 1}}`,
            value: triple(share.force, (v) => formatSI(v, "N")),
            note: `${share.kind === "beam" ? "light" : share.kind === "paul" ? "Paul trap" : "gravity"} (field ${share.fields.map((f) => f + 1).join(", ")})`,
          })),
        ],
        model: model(result, "modes"),
      }),
    });
  }

  if (result.modes.length) {
    const ks = result.modes.map((m) => m.stiffness);
    const value = triple(ks, (v) => formatSI(v, "N/m"));
    out.push({
      id: "stiffness",
      label: `Stiffness (${modeNames})`,
      value,
      explain: () => ({
        title: "Stiffness",
        value,
        copy: copyTriple(ks, "N/m"),
        formula: "stiffness",
        inputs: result.modes.map((m) => ({
          symbol: `k_${m.name}`,
          value: formatSI(m.stiffness, "N/m"),
          note: `along (${m.axis.map((c) => formatNumber(c, 2, true)).join(", ")})`,
        })),
        model: model(result, "modes"),
      }),
    });
  }

  {
    const p = setup.particle;
    const value = formatMass(result.particle.mass);
    out.push({
      id: "mass",
      label: "Mass",
      value,
      explain: () => ({
        title: "Mass",
        value,
        copy: `${result.particle.mass} kg`,
        formula: "mass",
        inputs: [
          { symbol: "R", value: formatSI(p.radius, "m"), note: "radius" },
          { symbol: String.raw`\rho`, value: `${formatNumber(result.particle.density, 4, true)} kg/m³`, note: p.material ? `density of ${subscript(p.material)}` : "density" },
        ],
        model: null,
      }),
    });
  }

  const paul = setup.trap.fields.find((f): f is PaulField => f.kind === "paul");
  if (result.paul && paul) {
    const pb = result.paul;
    const Q = { symbol: "Q", value: `${result.particle.charge ?? setup.particle.charge ?? 0} e`, note: "charge of the particle" };
    const m = { symbol: "m", value: formatMass(result.particle.mass), note: "mass" };
    const rf = { symbol: String.raw`f_\mathrm{RF}`, value: formatSI(paul.rf_frequency, "Hz", 3, true), note: "RF frequency" };
    const qValue = triple(AXES.map((a) => pb.q[a]), (v) => formatNumber(v, 3));
    out.push({
      id: "mathieu-q",
      label: "Mathieu q (x, y, z)",
      value: qValue,
      explain: () => ({
        title: "Mathieu q",
        value: qValue,
        copy: AXES.map((a) => pb.q[a]).join(", "),
        formula: "mathieu-q",
        inputs: [
          Q,
          m,
          rf,
          { symbol: "V", value: `${formatNumber(paul.rf_voltage, 3, true)} V`, note: "RF amplitude" },
          { symbol: "r_0", value: formatSI(paul.r0, "m", 3, true), note: "electrode distance: the curvature c′ goes as V / r₀²" },
        ],
        model: model(result, "modes"),
      }),
    });
    const aValue = triple(AXES.map((a) => pb.a[a]), (v) => formatSci(v, 3));
    out.push({
      id: "mathieu-a",
      label: "Mathieu a (x, y, z)",
      value: aValue,
      explain: () => ({
        title: "Mathieu a",
        value: aValue,
        copy: AXES.map((a) => pb.a[a]).join(", "),
        formula: "mathieu-a",
        inputs: [
          Q,
          m,
          rf,
          { symbol: "U", value: `${formatNumber(paul.dc_voltage ?? 0, 3, true)} V`, note: "DC offset on the electrodes" },
          ...(paul.geometry === "linear"
            ? [{ symbol: String.raw`U_\mathrm{ec}`, value: `${formatNumber(paul.endcap_voltage ?? 0, 3, true)} V`, note: "end-cap voltage: the axial well" }]
            : []),
        ],
        model: model(result, "modes"),
      }),
    });
    if (pb.micromotion) {
      const mm = pb.micromotion;
      const value = formatSI(Math.hypot(...mm), "m");
      out.push({
        id: "micromotion",
        label: "Micromotion amplitude",
        value,
        explain: () => ({
          title: "Micromotion amplitude",
          value,
          copy: `${Math.hypot(...mm)} m`,
          formula: "micromotion",
          inputs: [
            { symbol: String.raw`\mathbf{x}_0`, value: triple(result.equilibrium ?? [0, 0, 0], (v) => formatSI(v, "m")), note: "the equilibrium, away from the RF null" },
            { symbol: "q", value: qValue, note: "Mathieu q per axis" },
            { symbol: "A", value: triple(mm, (v) => formatSI(v, "m")), note: "per axis; the value shown is their length" },
          ],
          model: model(result, "modes"),
        }),
      });
    }
  }

  if (result.optical) {
    const o = result.optical;
    const sca = formatSI(o.P_sca, "W");
    out.push({
      id: "scattered",
      label: "Scattered power",
      value: sca,
      explain: () => ({
        title: "Scattered power",
        value: sca,
        copy: `${o.P_sca} W`,
        formula: "scattered-power",
        inputs: [
          { symbol: "P", value: formatSI(o.power, "W"), note: "the beams' power" },
          { symbol: String.raw`Q_\mathrm{sca}`, value: formatSci(o.Qsca, 3), note: "plane-wave scattering efficiency, for scale" },
          { symbol: "x", value: formatNumber(o.size_parameter, 3), note: "size parameter 2πnR/λ" },
        ],
        model: model(result, "optical"),
      }),
    });
    const shares = multipoleShares(result);
    if (shares.length) {
      const value = shares
        .filter((s, i) => i === 0 || (i < 3 && s.share >= 0.01))
        .map((s) => `${s.key} ${percent(s.share)} %`)
        .join(" · ");
      out.push({
        id: "multipoles",
        label: "Scattered by multipole",
        value,
        explain: () => ({
          title: "Scattered power by multipole",
          value,
          copy: shares.map((s) => `${s.key} ${s.power} W`).join(", "),
          formula: "multipole-power",
          inputs: shares
            .filter((s, i) => i === 0 || s.share >= 1e-3 || s.planeWave >= 1e-3)
            .map((s) => ({
              symbol: s.key === "higher" ? String.raw`P_{n \geq 4}` : String.raw`P_\mathrm{${s.key}}`,
              value: `${formatSI(s.power, "W")} (${percent(s.share)} %)`,
              note: `${s.name}; ${percent(s.planeWave)} % for a plane wave on the same sphere`,
            })),
          model: model(result, "optical"),
        }),
      });
    }
    const abs = formatSI(o.P_abs, "W");
    out.push({
      id: "absorbed",
      label: "Absorbed power",
      value: abs,
      explain: () => ({
        title: "Absorbed power",
        value: abs,
        copy: `${o.P_abs} W`,
        formula: "absorbed-power",
        inputs: [
          { symbol: "P", value: formatSI(o.power, "W"), note: "the beams' power" },
          { symbol: String.raw`Q_\mathrm{abs}`, value: formatSci(o.Qabs, 3), note: "plane-wave absorption efficiency, for scale" },
          { symbol: "k", value: formatSci(result.particle.k, 3), note: "absorption index of the particle" },
        ],
        model: model(result, "optical"),
      }),
    });
  }

  for (const lens of result.lenses ?? []) {
    const beam = setup.trap.fields[lens.field];
    const which = setup.trap.fields.filter((f) => f.kind === "beam").length > 1 ? ` (lens ${lens.field + 1})` : "";
    const focus = beam?.kind === "beam" && beam.focus.kind === "asphere" ? beam.focus : null;
    const tilt = focus?.tilt_deg ?? [0, 0];
    const set = [
      { symbol: String.raw`\theta_x, \theta_y`, value: `${formatNumber(tilt[0], 3, true)}°, ${formatNumber(tilt[1], 3, true)}°`, note: "tilt of the lens about its centre" },
      { symbol: "D", value: focus ? formatSI(focus.beam_diameter, "m", 3, true) : "—", note: "beam diameter on the lens (1/e² intensity)" },
    ];
    const lensModel = model(result, "lens");
    const shift = Math.hypot(...lens.focus_shift);
    out.push({
      id: `lens${lens.field}-focus`,
      label: `Focus moved by the lens${which}`,
      value: formatSI(shift, "m"),
      explain: () => ({
        title: "Focus moved by the lens",
        value: formatSI(shift, "m"),
        copy: copyTriple(lens.focus_shift, "m"),
        formula: "lens-focus-shift",
        inputs: [
          { symbol: String.raw`\Delta\mathbf{r}`, value: triple(lens.focus_shift, (v) => formatSI(v, "m")), note: "x, y, z in the lab" },
          ...set,
          { symbol: String.raw`W_\mathrm{rms}`, value: `${formatNumber(lens.rms_waves, 3)} λ`, note: `wavefront error about the focus (${formatNumber(lens.rms_waves_untilted, 3)} λ aligned)` },
        ],
        model: lensModel,
      }),
    });
    out.push({
      id: `lens${lens.field}-clipping`,
      label: `Clipped by the lens${which}`,
      value: `${formatNumber(100 * lens.clipping_loss, 3)} %`,
      explain: () => ({
        title: "Light clipped by the lens",
        value: `${formatNumber(100 * lens.clipping_loss, 3)} %`,
        copy: String(lens.clipping_loss),
        formula: "lens-clipping",
        inputs: [...set, { symbol: String.raw`n_\mathrm{glass}`, value: formatNumber(lens.n_glass, 5), note: "the lens glass at the beam's wavelength" }],
        model: lensModel,
      }),
    });
    if (lens.trap_axis_tilt_mrad != null) {
      out.push({
        id: `lens${lens.field}-axis`,
        label: `Trap axis tilted${which}`,
        value: `${formatNumber(lens.trap_axis_tilt_mrad, 3)} mrad`,
        explain: () => ({
          title: "Trap axis tilted",
          value: `${formatNumber(lens.trap_axis_tilt_mrad!, 3)} mrad`,
          copy: `${lens.trap_axis_tilt_mrad! / 1e3} rad`,
          formula: "trap-axis-tilt",
          inputs: [
            ...set,
            { symbol: String.raw`\boldsymbol{\delta}`, value: `${formatNumber(lens.pointing_mrad[0], 3)}, ${formatNumber(lens.pointing_mrad[1], 3)} mrad`, note: "the light's mean direction behind the lens, off the axis" },
          ],
          model: model(result, "modes"),
        }),
      });
    }
  }

  for (const mirror of result.mirrors ?? []) {
    const beam = setup.trap.fields[mirror.field];
    const which = setup.trap.fields.filter((f) => f.kind === "beam").length > 1 ? ` (mirror ${mirror.field + 1})` : "";
    const focus = beam?.kind === "beam" && beam.focus.kind === "parabolic_mirror" ? beam.focus : null;
    const mirrorModel = model(result, "mirror");
    const value = `${formatNumber(100 * mirror.reflected, 3)} %`;
    const length = (v: number | undefined) => (v == null ? "—" : formatSI(v, "m", 3, true));
    out.push({
      id: `mirror${mirror.field}-reflected`,
      label: `Reflected by the mirror${which}`,
      value,
      explain: () => ({
        title: "Light reflected to the focus",
        value,
        copy: String(mirror.reflected),
        formula: "mirror-reflected",
        inputs: [
          { symbol: String.raw`\rho_\mathrm{h}`, value: length(focus?.hole_radius ?? 0), note: "radius of the mirror's hole" },
          { symbol: "R", value: length(focus?.rim_radius), note: "radius of the mirror's rim" },
          { symbol: "w", value: length(focus ? focus.beam_diameter / 2 : undefined), note: "the beam's radius (1/e² intensity)" },
        ],
        model: mirrorModel,
      }),
    });
    const rim = `${formatNumber(mirror.rim_angle_deg, 4)}°`;
    out.push({
      id: `mirror${mirror.field}-rim`,
      label: `Light from up to${which}`,
      value: rim,
      explain: () => ({
        title: mirror.deep ? "Rim angle (a deep mirror: light from beyond 90°)" : "Rim angle",
        value: rim,
        copy: `${mirror.rim_angle_deg} deg`,
        formula: "mirror-rim-angle",
        inputs: [
          { symbol: "R", value: length(focus?.rim_radius), note: "radius of the mirror's rim" },
          { symbol: "f", value: length(focus?.focal_length), note: "focal length (vertex to focus)" },
          { symbol: String.raw`\alpha_\mathrm{h}`, value: `${formatNumber(mirror.hole_angle_deg, 4)}°`, note: "the hole's edge, seen from the focus" },
        ],
        model: mirrorModel,
      }),
    });
  }

  if (result.rates) {
    const r = result.rates;
    const value = formatSI(r.gas_damping / (2 * Math.PI), "Hz");
    out.push({
      id: "damping",
      label: `Gas damping γ/2π in ${subscript(env.gas)}`,
      value,
      explain: () => ({
        title: "Gas damping",
        value,
        copy: `${r.gas_damping} 1/s`,
        formula: "gas-damping",
        inputs: [
          { symbol: String.raw`\mathrm{Kn}`, value: formatSci(r.gas.knudsen, 3), note: "Knudsen number: mean free path over radius" },
          { symbol: String.raw`\ell`, value: formatSI(r.gas.mean_free_path, "m"), note: `mean free path in ${subscript(env.gas)} at ${toFieldText(env.pressure, "pressure", "mbar", 3)} mbar` },
          { symbol: String.raw`\eta`, value: `${formatSci(r.gas.viscosity, 3)} Pa s`, note: "viscosity of the gas" },
          { symbol: String.raw`\gamma_\mathrm{Epstein}`, value: `${formatSci(r.epstein_damping, 3)} /s`, note: "the free-molecular limit, for comparison" },
        ],
        model: model(result, "gas_damping"),
      }),
    });
    const reheat = triple(r.reheating_phonons_per_s, (v) => formatSci(v, 3));
    out.push({
      id: "reheating",
      label: `Reheating in phonons/s (${modeNames})`,
      value: reheat,
      explain: () => ({
        title: "Reheating rate",
        value: `${reheat} phonons/s`,
        copy: copyTriple(r.reheating_phonons_per_s, "1/s"),
        formula: "reheating",
        inputs: r.modes.flatMap((m) => [
          { symbol: String.raw`\Gamma_{\mathrm{gas},${m.name}}`, value: `${formatSci(m.gas_heating, 3)} /s`, note: `gas heating along ${m.name}` },
          { symbol: String.raw`\Gamma_{\mathrm{recoil},${m.name}}`, value: `${formatSci(m.recoil_heating, 3)} /s`, note: `photon recoil along ${m.name}` },
        ]),
        model: model(result, "recoil_heating"),
      }),
    });
    const crossover = r.modes.map((m) => m.crossover_pressure);
    if (crossover.every((p) => p != null)) {
      const value = `${crossover.map((p) => toFieldText(p!, "pressure", "mbar", 2)).join(" · ")} mbar`;
      out.push({
        id: "crossover",
        label: `Recoil exceeds gas heating below (${modeNames})`,
        value,
        explain: () => ({
          title: "Recoil-limited below",
          value,
          copy: copyTriple(crossover, "Pa"),
          formula: "crossover",
          inputs: r.modes.map((m) => ({
            symbol: `p_${m.name}`,
            value: `${toFieldText(m.crossover_pressure!, "pressure", "mbar", 3)} mbar`,
            note: `below this, photon recoil heats the ${m.name} mode more than the gas`,
          })),
          model: model(result, "recoil_heating"),
        }),
      });
    }
  }
  return out;
}
