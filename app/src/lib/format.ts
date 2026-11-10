/** Number formatting for the screen. */

const PREFIXES: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
];

/** 152_340 -> "152 kHz"; 3 significant figures; "—" for null or non-finite. */
export function formatFrequency(hz: number | null | undefined): string {
  if (hz == null || !Number.isFinite(hz)) return "—";
  const rounded = Number(hz.toPrecision(3)); // 999.6 -> 1000, so it reads "1.00 kHz"
  const [scale, prefix] = PREFIXES.find(([s]) => Math.abs(rounded) >= s) ?? [1, ""];
  const v = rounded / scale;
  const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(v) || 1)));
  return `${v.toFixed(digits)} ${prefix}Hz`;
}
