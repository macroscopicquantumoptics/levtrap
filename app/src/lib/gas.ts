/**
 * Gas damping and heating against pressure: a port of levtrap.rates
 * (gas_damping, mean_free_path, gas_heating), so the Heating tab can draw a
 * whole pressure range from one Result. gas.test.ts checks it against the
 * engine's numbers.
 */

export const KB = 1.380649e-23; // J/K
export const HBAR = 1.054571817e-34; // J s

/** The Knudsen interpolation constants of levtrap.rates (Beresnev et al. 1990). */
const A = 0.619;
const CK = [0.31, 0.785, 1.152] as const;

/** Mean free path [m] of a gas of molecules of mass `gasMass` [kg] with viscosity η [Pa s]. */
export function meanFreePath(pressure: number, viscosity: number, gasMass: number, temperature: number): number {
  if (pressure <= 0) return Infinity;
  return (viscosity / pressure) * Math.sqrt((Math.PI * KB * temperature) / (2 * gasMass));
}

/**
 * Gas damping rate γ [1/s] of a sphere of radius R [m] and mass m [kg]:
 *   γ = (6πηR / m) · 0.619 / (0.619 + Kn) · (1 + c_K),  c_K = 0.31 Kn / (0.785 + 1.152 Kn + Kn²).
 */
export function gasDamping(pressure: number, radius: number, mass: number, viscosity: number, gasMass: number, temperature: number): number {
  if (pressure <= 0) return 0;
  const kn = meanFreePath(pressure, viscosity, gasMass, temperature) / radius;
  const [a, b, c] = CK;
  const ck = (a * kn) / (b + c * kn + kn * kn);
  return ((6 * Math.PI * viscosity * radius) / mass) * (A / (A + kn)) * (1 + ck);
}

/** Heating by the gas [phonons/s]: γ k_B T / (ħ Ω), Ω the mode's angular frequency. */
export function gasHeating(gamma: number, temperature: number, omega: number): number {
  return (gamma * KB * temperature) / (HBAR * omega);
}

/** n points spaced evenly in log between lo and hi. */
export function logSpace(lo: number, hi: number, n: number): number[] {
  const a = Math.log10(lo);
  const b = Math.log10(hi);
  return Array.from({ length: n }, (_, i) => 10 ** (a + ((b - a) * i) / (n - 1)));
}
