/**
 * Linked pairs: two inputs that describe one thing. Editing either sets the
 * other. The relations are the engine's own (so a value typed in one field
 * and read back from the other gives the same result as the engine).
 */

// ---- sphere: radius, diameter, mass ----------------------------------------------

/** kg, from radius [m] and density [kg/m³] (levtrap.derived.sphere_mass). */
export const sphereMass = (radius: number, density: number) => (4 / 3) * Math.PI * radius ** 3 * density;

/** m, the radius of a sphere of this mass and density. */
export const radiusFromMass = (mass: number, density: number) => Math.cbrt((3 * mass) / (4 * Math.PI * density));

// ---- focus: NA, waist, half-angle ------------------------------------------------

/**
 * Normalised waist of an LG/HG mode of paraxial order N (2p + |l| for LG,
 * m + n for HG): levtrap.special.paraxial_beam_waist, OTT's
 * paraxial_beam_waist (Lambert W_-1 by Newton). 1 for a Gaussian.
 */
export function paraxialBeamWaist(order: number): number {
  if (order === 0) return 1;
  const N = Math.abs(order);
  const invL = 1 / N;
  const zz = Math.exp(-(N + 2) * invL);
  let w = -(1 + 2 * Math.sqrt(invL) + invL);
  let w0 = -w;
  while (Math.abs(w - w0) > 0.00001) {
    w0 = w;
    const e = Math.exp(w);
    w = w0 - (w0 * e + zz) / (e + w0 * e);
  }
  return Math.sqrt((-N / 2) * w);
}

/** Paraxial order of a beam mode: 2p + |l| (LG) or m + n (HG). */
export const modeOrder = (type: "lg" | "hg", [i, j]: [number, number]) => (type === "lg" ? 2 * i + Math.abs(j) : i + j);

/** How an ideal lens maps the paraxial beam onto the far field (#64): OTT's tan θ (default) or the textbook sin θ. */
export type Mapping = "ott" | "sine";

/**
 * The engine's relation between the waist W (1/e² radius at the focus) and
 * the convergence half-angle (api._beam_angle): tan θ = λ_m w_p / (π W) with
 * OTT's mapping, sin θ = λ_m w_p / (π W) with the sine one (90° below the
 * diffraction limit); λ_m = λ / n the wavelength in the medium.
 */
export function angleFromWaist(waist: number, wavelength: number, nMedium: number, order = 0, mapping: Mapping = "ott"): number {
  const s = ((wavelength / nMedium) * paraxialBeamWaist(order)) / (Math.PI * waist);
  return mapping === "sine" ? Math.asin(Math.min(1, s)) : Math.atan(s);
}

export function waistFromAngle(angle: number, wavelength: number, nMedium: number, order = 0, mapping: Mapping = "ott"): number {
  return ((wavelength / nMedium) * paraxialBeamWaist(order)) / (Math.PI * (mapping === "sine" ? Math.sin(angle) : Math.tan(angle)));
}

/** NA = n sin θ. */
export const naFromAngle = (angle: number, nMedium: number) => nMedium * Math.sin(angle);
export const angleFromNA = (na: number, nMedium: number) => Math.asin(Math.min(1, na / nMedium));

export const naFromWaist = (waist: number, wavelength: number, nMedium: number, order = 0) =>
  naFromAngle(angleFromWaist(waist, wavelength, nMedium, order), nMedium);
export const waistFromNA = (na: number, wavelength: number, nMedium: number, order = 0) =>
  waistFromAngle(angleFromNA(na, nMedium), wavelength, nMedium, order);

// ---- pressure ----------------------------------------------------------------------
// Pressure is one quantity in several units (Pa, mbar, Torr): the unit selector of
// its field (lib/units.ts), not a linked pair.
