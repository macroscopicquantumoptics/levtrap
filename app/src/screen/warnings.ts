/**
 * The engine's warnings (Result.warnings, plain sentences) as codes, each
 * with the sentence shown and, where there is one, the usual cause and what
 * to change. The engine's wording is matched by its fixed opening words;
 * warnings.test.ts checks every pattern against the engine's source, so a
 * reworded warning fails a test instead of losing its advice.
 */

export type WarningCode =
  | "no-trap-axial"
  | "no-trap-nowhere"
  | "no-trap-loose"
  | "no-trap-mathieu"
  | "no-trap-paul"
  | "no-trap-parametric"
  | "micromotion"
  | "not-converged"
  | "nonconservative"
  | "pseudopotential-inaccurate"
  | "ring-endcap"
  | "other";

export interface Warning {
  code: WarningCode;
  /** a trap is not there */
  fatal: boolean;
  /** the sentence shown */
  text: string;
  /** the usual cause and what to change */
  hint?: string;
}

interface Rule {
  code: Exclude<WarningCode, "other">;
  /** matches the engine's text; groups feed `text` */
  pattern: RegExp;
  fatal: boolean;
  text?(m: RegExpMatchArray): string;
  hint?(m: RegExpMatchArray): string;
}

const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/** "x, y" → "x and y" */
const axes = (list: string) => {
  const a = list.split(/,\s*/).filter(Boolean);
  return a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0];
};

export const RULES: Rule[] = [
  {
    code: "no-trap-axial",
    pattern: /^No stable trap: the force along the beam axis \((\w)\) never restores the particle\.?$/,
    fatal: true,
    text: (m) => `No stable trap along ${m[1]}: the force along the beam never pulls the particle back.`,
    hint: () =>
      "Usually the scattering force pushes the particle out faster than the gradient force pulls it in: focus tighter (a larger NA), or add a counter-propagating beam.",
  },
  {
    code: "no-trap-nowhere",
    pattern: /^No stable trap: nowhere in the searched region does the force vanish/,
    fatal: true,
    hint: () => "Usually gravity or the light's push is stronger than the restoring force: more power or charge, a tighter focus, or a beam pointing up against gravity.",
  },
  {
    code: "no-trap-loose",
    pattern: /^No stable trap: the particle is pushed away along ([\w, ]+)\.?$/,
    fatal: true,
    text: (m) => `No stable trap along ${axes(m[1])}: the force there pushes the particle away.`,
    hint: () => "Usually a field that repels along that axis wins: a dark centre in the beam's mode, an aberrated focus (a tilted or decentred lens), a DC voltage of the wrong sign, or end caps without a voltage.",
  },
  {
    code: "no-trap-mathieu",
    pattern: /^No stable trap: outside the first Mathieu stability region along ([\w, ]+)\.?$/,
    fatal: true,
    text: (m) => `No stable trap along ${axes(m[1])}: outside the first Mathieu stability region.`,
    hint: () => "Usually q is too large (above 0.908) or a too negative: raise the RF frequency, or lower the RF voltage or the DC voltage.",
  },
  {
    code: "no-trap-paul",
    pattern: /^No stable trap: the Paul trap does not confine the particle here\.?$/,
    fatal: true,
    hint: () => "Usually gravity pulls the particle out of a shallow trap: raise the RF voltage or the charge, or make the particle lighter.",
  },
  {
    code: "no-trap-parametric",
    pattern: /^No stable trap: the RF drives a parametric resonance along ([\w, ]+), even with the light's restoring force\.?$/,
    fatal: true,
    text: (m) => `No stable trap along ${axes(m[1])}: the RF drives a parametric resonance, even with the light's restoring force.`,
    hint: () => "The light's trap frequency is close to half the RF frequency, or a multiple of it: change the RF frequency or the beam's power.",
  },
  {
    code: "micromotion",
    pattern: /^The particle sits (\d+) nm from the Paul trap's centre along (\w)/,
    fatal: false,
    hint: () => "Move the focus onto the Paul trap's axis, where the RF field is zero.",
  },
  {
    code: "not-converged",
    pattern: /^The equilibrium search did not converge inside the scanned region\.?$/,
    fatal: false,
    hint: () => "The numbers may be missing or rough. A smaller step between setups, or a setup closer to a known trap, usually helps.",
  },
  {
    code: "nonconservative",
    pattern: /^The force is not conservative here/,
    fatal: false,
  },
  {
    code: "pseudopotential-inaccurate",
    pattern: /^Paul q = ([\d.]+): pseudopotential is inaccurate, using Mathieu$/,
    fatal: false,
    text: (m) => `Mathieu q = ${m[1]} is too large for the pseudopotential: the frequencies are the exact Mathieu ones.`,
  },
  {
    code: "ring-endcap",
    pattern: /^endcap_voltage is not used by a ring trap; use dc_voltage$/,
    fatal: false,
    text: () => "A ring trap does not use the end-cap voltage: set the DC voltage instead.",
  },
];

/** One engine warning, classified. */
export function describeWarning(raw: string): Warning {
  for (const rule of RULES) {
    const m = raw.trim().match(rule.pattern);
    if (m) return { code: rule.code, fatal: rule.fatal, text: sentence(rule.text ? rule.text(m) : raw), hint: rule.hint?.(m) };
  }
  // an unknown warning is still shown, as the engine wrote it
  const fatal = raw.startsWith("No stable trap");
  return { code: "other", fatal, text: sentence(raw.charAt(0).toUpperCase() + raw.slice(1)) };
}
