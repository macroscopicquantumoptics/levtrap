// SI-prefixed number formatting: 227499.37 Hz -> "227 kHz".

const PREFIXES: [number, string][] = [
  [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""],
  [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"], [1e-18, "a"],
];

export interface Formatted {
  value: string;
  unit: string;
}

/** Split a value into a mantissa with `sig` significant figures and a prefixed unit. */
export function siParts(x: number | null | undefined, unit: string, sig = 3): Formatted {
  if (x === null || x === undefined || !Number.isFinite(x)) return { value: "—", unit };
  if (x === 0) return { value: "0", unit };
  const abs = Math.abs(x);
  let [scale, prefix] = PREFIXES[PREFIXES.length - 1];
  for (const [s, p] of PREFIXES) {
    if (abs >= s * (1 - 0.5 * 10 ** -sig)) {
      [scale, prefix] = [s, p];
      break;
    }
  }
  let m = x / scale;
  let text = Number(m.toPrecision(sig)).toString();
  // 999.7 k rounds to "1000"; move up a prefix.
  if (Math.abs(Number(text)) >= 1000 && scale < 1e12) {
    const i = PREFIXES.findIndex(([s]) => s === scale);
    [scale, prefix] = PREFIXES[i - 1];
    m = x / scale;
    text = Number(m.toPrecision(sig)).toString();
  }
  return { value: text.replace("-", "−"), unit: prefix + unit };
}

export function si(x: number | null | undefined, unit: string, sig = 3): string {
  const { value, unit: u } = siParts(x, unit, sig);
  return u ? `${value} ${u}` : value;
}
