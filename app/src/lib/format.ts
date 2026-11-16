/** Number formatting for the screen. */

const SI_PREFIXES: [number, string][] = [
  [1e12, "T"],
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
  [1e-15, "f"],
  [1e-18, "a"],
  [1e-21, "z"],
];

export interface Formatted {
  /** The number, e.g. "227"; "—" when there is none. */
  value: string;
  /** Prefix and unit, e.g. "kHz". */
  unit: string;
}

const minus = (text: string) => text.replace("-", "−");

/** `v` with `sig` significant figures, no exponent; `trim` drops trailing zeros. */
function fixedSig(v: number, sig: number, trim: boolean): string {
  const places = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v) || 1)));
  const text = v.toFixed(places);
  return minus(trim ? Number(text).toString() : text);
}

/**
 * 227499.7, "Hz" -> { value: "227", unit: "kHz" }: an SI prefix and `sig`
 * significant figures. Results keep their trailing zeros ("48.0 kHz"); pass
 * `trim` for inputs and labels ("200 mW", "1 µm"). null or non-finite: "—".
 */
export function siParts(x: number | null | undefined, unit: string, sig = 3, trim = false): Formatted {
  if (x == null || !Number.isFinite(x)) return { value: "—", unit };
  const rounded = Number(x.toPrecision(sig)); // 999.6 -> 1000, so it reads "1.00 k"
  const abs = Math.abs(rounded);
  const [scale, prefix] =
    abs === 0 ? [1, ""] : (SI_PREFIXES.find(([s]) => abs >= s) ?? SI_PREFIXES[SI_PREFIXES.length - 1]);
  return { value: fixedSig(rounded / scale, sig, trim), unit: prefix + unit };
}

/** 227499.7, "Hz" -> "227 kHz"; "—" when there is no value. See {@link siParts}. */
export function formatSI(x: number | null | undefined, unit: string, sig = 3, trim = false): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const p = siParts(x, unit, sig, trim);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

/**
 * A bare number with `sig` significant figures: 386.25 -> "386",
 * 0.5312 -> "0.531", 115876 -> "116000", 1.2e-7 -> "1.20e−7".
 */
export function formatNumber(x: number | null | undefined, sig = 3, trim = false): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs >= 1e6 || abs < 1e-3) {
    const [m, e] = x.toExponential(sig - 1).split("e");
    return `${minus(trim ? Number(m).toString() : m)}e${minus(e.replace("+", ""))}`;
  }
  return fixedSig(Number(x.toPrecision(sig)), sig, trim);
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/**
 * For values that span many orders of magnitude (rates, pressures):
 * 137305 -> "1.37 × 10⁵", 3.3e-6 -> "3.30 × 10⁻⁶", 42.5 -> "42.5".
 */
export function formatSci(x: number | null | undefined, sig = 3): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs >= 1e-2 && abs < 1e4) return fixedSig(Number(x.toPrecision(sig)), sig, false);
  const [m, e] = x.toExponential(sig - 1).split("e");
  const power = Number(e);
  const digits = String(Math.abs(power)).replace(/\d/g, (d) => SUPERSCRIPT[Number(d)]);
  return `${minus(m)} × 10${power < 0 ? "⁻" : ""}${digits}`;
}

/** A mass in grams with an SI prefix: 9.215e-18 kg -> "9.22 fg". */
export function formatMass(kg: number | null | undefined, sig = 3): string {
  return formatSI(kg == null ? kg : kg * 1e3, "g", sig);
}

/** 152_340 -> "152 kHz"; 3 significant figures; "—" for null or non-finite. */
export function formatFrequency(hz: number | null | undefined): string {
  return formatSI(hz, "Hz");
}
