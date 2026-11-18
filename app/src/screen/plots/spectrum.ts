/**
 * The Spectrum tab's model: per mode, the occupation, effective temperature
 * and displacement spectrum from a Result's rates, with an optional feedback
 * damping. levtrap.spectrum is the reference; spectrum.test.ts checks this
 * copy against it.
 */
import type { Result } from "../../engine/types.ts";
import { HBAR, KB } from "../../lib/gas.ts";

export interface SpectrumMode {
  name: string;
  /** Hz */
  frequency: number;
  /** total damping γ_gas + γ_fb [1/s] */
  gamma: number;
  /** full width of the peak, γ / 2π [Hz] */
  linewidth: number;
  /** mean phonon number */
  occupation: number;
  /** K */
  temperature: number;
  /** √⟨x²⟩ [m] */
  rms: number;
  /** m²/Hz, single-sided, on the shared grid */
  psd: number[];
}

export interface Spectrum {
  /** Hz */
  frequency: number[];
  modes: SpectrumMode[];
  /** gas damping [1/s] */
  gasDamping: number;
}

/** S_x(f) = 4 γ k_B T / m / ((Ω² − ω²)² + γ² ω²), ω = 2π f [m²/Hz]. */
export function psd(f: number, omega: number, gamma: number, mass: number, temperature: number): number {
  const w = 2 * Math.PI * f;
  return (4 * gamma * KB * temperature) / mass / ((omega * omega - w * w) ** 2 + (gamma * w) ** 2);
}

const geom = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo * (hi / lo) ** (i / (n - 1)));

/**
 * 0 to fMax: an even grid, and around each peak (centre, full width [Hz])
 * points spaced in log of the detuning, from a hundredth of the half width.
 */
export function frequencyGrid(peaks: [number, number][], fMax: number, n = 400, perPeak = 160): number[] {
  const pts: number[] = Array.from({ length: n }, (_, i) => (fMax * i) / (n - 1));
  for (const [f0, width] of peaks) {
    const hw = Math.max(width / 2, f0 * 1e-15);
    const reach = Math.max(f0, fMax - f0);
    if (reach <= hw * 1e-2) continue;
    pts.push(f0);
    for (const d of geom(hw * 1e-2, reach, perPeak)) pts.push(f0 - d, f0 + d);
  }
  return [...new Set(pts.filter((f) => f >= 0 && f <= fMax))].sort((a, b) => a - b);
}

/** levtrap.spectrum.spectrum_block: null without rates (no light) or without a stable trap. `feedback` [1/s], per mode. */
export function spectrum(result: Result, feedback: number[] | number = 0, points = 400): Spectrum | null {
  const rates = result.rates;
  if (!rates || !result.stable) return null;
  const mass = result.particle.mass;
  const g = rates.gas_damping;
  const fb = Array.isArray(feedback) ? feedback : rates.modes.map(() => feedback);
  const modes: Omit<SpectrumMode, "psd">[] = [];
  rates.modes.forEach((m, i) => {
    const frequency = result.modes.find((x) => x.name === m.name)?.frequency;
    if (!frequency || m.reheating == null) return;
    const omega = 2 * Math.PI * frequency;
    const gamma = g + (fb[i] ?? 0);
    const occupation = gamma > 0 ? m.reheating / gamma : Infinity;
    const temperature = (occupation * HBAR * omega) / KB;
    modes.push({ name: m.name, frequency, gamma, linewidth: gamma / (2 * Math.PI), occupation, temperature, rms: Math.sqrt((KB * temperature) / (mass * omega * omega)) });
  });
  if (!modes.length) return null;
  const fMax = 1.5 * Math.max(...modes.map((m) => m.frequency));
  const frequency = frequencyGrid(
    modes.map((m) => [m.frequency, m.linewidth]),
    fMax,
    points,
  );
  return {
    frequency,
    gasDamping: g,
    modes: modes.map((m) => ({ ...m, psd: frequency.map((f) => psd(f, 2 * Math.PI * m.frequency, m.gamma, mass, m.temperature)) })),
  };
}

/** ∫ y df by the trapezoid rule. */
export function area(f: number[], y: number[]): number {
  let s = 0;
  for (let i = 1; i < f.length; i += 1) s += 0.5 * (y[i] + y[i - 1]) * (f[i] - f[i - 1]);
  return s;
}
