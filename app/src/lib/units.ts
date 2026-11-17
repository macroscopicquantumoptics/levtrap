/**
 * Units as typed: "200 mW", "100nm", "1e-6 mbar". A field has a physical
 * quantity; the text may carry any unit of that quantity, and the value is
 * stored in SI. The unit-aware fields of D2 replace this prototype version.
 */

export type Quantity =
  | "length"
  | "power"
  | "pressure"
  | "frequency"
  | "voltage"
  | "temperature"
  | "density"
  | "charge"
  | "angle"
  | "phase"
  | "acceleration"
  | "number";

interface UnitDef {
  symbol: string;
  /** SI value = typed value × factor */
  factor: number;
  aliases?: string[];
}

/** Units per quantity; the first one is the SI unit. */
export const UNITS: Record<Quantity, UnitDef[]> = {
  length: [
    { symbol: "m", factor: 1 },
    { symbol: "mm", factor: 1e-3 },
    { symbol: "µm", factor: 1e-6, aliases: ["um", "μm", "micron"] },
    { symbol: "nm", factor: 1e-9 },
  ],
  power: [
    { symbol: "W", factor: 1 },
    { symbol: "mW", factor: 1e-3 },
    { symbol: "µW", factor: 1e-6, aliases: ["uW", "μW"] },
  ],
  pressure: [
    { symbol: "Pa", factor: 1 },
    { symbol: "mbar", factor: 100, aliases: ["hPa"] },
    { symbol: "bar", factor: 1e5 },
    { symbol: "Torr", factor: 101325 / 760, aliases: ["mmHg"] },
  ],
  frequency: [
    { symbol: "Hz", factor: 1 },
    { symbol: "kHz", factor: 1e3 },
    { symbol: "MHz", factor: 1e6 },
  ],
  voltage: [
    { symbol: "V", factor: 1 },
    { symbol: "mV", factor: 1e-3 },
    { symbol: "kV", factor: 1e3 },
  ],
  temperature: [{ symbol: "K", factor: 1 }],
  density: [
    { symbol: "kg/m³", factor: 1, aliases: ["kg/m3", "kg/m^3"] },
    { symbol: "g/cm³", factor: 1e3, aliases: ["g/cm3", "g/cm^3", "g/cc"] },
  ],
  charge: [{ symbol: "e", factor: 1 }],
  angle: [
    { symbol: "°", factor: 1, aliases: ["deg", "degrees"] },
    { symbol: "rad", factor: 180 / Math.PI },
  ],
  phase: [
    { symbol: "rad", factor: 1 },
    { symbol: "π rad", factor: Math.PI, aliases: ["π", "pi", "pi rad"] },
    { symbol: "°", factor: Math.PI / 180, aliases: ["deg", "degrees"] },
  ],
  acceleration: [{ symbol: "m/s²", factor: 1, aliases: ["m/s2", "m/s^2"] }],
  number: [],
};

export function unitSymbols(quantity: Quantity): string[] {
  return UNITS[quantity].map((u) => u.symbol);
}

function findUnit(quantity: Quantity, text: string): UnitDef | undefined {
  const units = UNITS[quantity];
  const exact = units.find((u) => u.symbol === text || u.aliases?.includes(text));
  if (exact) return exact;
  // "khz", "MBAR": accept another case when it names exactly one unit
  const lower = text.toLowerCase();
  const loose = units.filter((u) => [u.symbol, ...(u.aliases ?? [])].some((s) => s.toLowerCase() === lower));
  return loose.length === 1 ? loose[0] : undefined;
}

/** SI value = value × unitFactor(...). Throws on a unit the quantity does not have. */
export function unitFactor(quantity: Quantity, unit: string): number {
  if (quantity === "number" || unit === "") return 1;
  const u = findUnit(quantity, unit);
  if (!u) throw new Error(`${quantity} has no unit ${unit}`);
  return u.factor;
}

export type Parsed = { ok: true; value: number; unit: string } | { ok: false; error: string };

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

/**
 * Parse what was typed into a field of `quantity`. Without a unit the text is
 * in `defaultUnit` (the unit the field shows). Returns the SI value and the
 * unit that was used, or a sentence saying what is wrong.
 */
export function parseQuantity(text: string, quantity: Quantity, defaultUnit = ""): Parsed {
  const cleaned = text.trim().replace(/−/g, "-").replace(/×\s*10\^?/g, "e");
  if (!cleaned) return { ok: false, error: "Type a number." };
  const m = NUMBER.exec(cleaned);
  if (!m) return { ok: false, error: "Start with a number." };
  const number = Number(m[0]);
  if (!Number.isFinite(number)) return { ok: false, error: "Start with a number." };
  const rest = cleaned.slice(m[0].length).trim();
  if (!rest) return { ok: true, value: number * unitFactor(quantity, defaultUnit), unit: defaultUnit };
  if (quantity === "number") return { ok: false, error: "This value has no unit." };
  const unit = findUnit(quantity, rest);
  if (!unit) {
    const known = unitSymbols(quantity);
    const list = known.length > 1 ? `${known.slice(0, -1).join(", ")} or ${known[known.length - 1]}` : known[0];
    return { ok: false, error: `Unknown unit “${rest}”. Use ${list}.` };
  }
  return { ok: true, value: number * unit.factor, unit: unit.symbol };
}

/**
 * The SI value as the number shown in a field with `unit`: up to `sig`
 * significant figures, no trailing zeros, exponent form outside 1e-3…1e6
 * ("1e-6"). Plain ASCII, so it can be edited and parsed again.
 */
export function toFieldText(si: number, quantity: Quantity, unit: string, sig = 6): string {
  const v = si / unitFactor(quantity, unit);
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs < 1e-3 || abs >= 1e6) {
    const [m, e] = v.toExponential(sig - 1).split("e");
    return `${Number(m)}e${Number(e)}`;
  }
  return Number(v.toPrecision(sig)).toString();
}
