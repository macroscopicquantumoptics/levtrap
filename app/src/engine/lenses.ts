/**
 * The real lenses a beam can be focused by (focus.kind "asphere"), for
 * drawing them and for their equivalent cone. The prescription is
 * levtrap.lens.THORLABS_354330 (Thorlabs Zemax file); lenses.test.ts checks
 * the copy against the Python.
 */

export interface EvenAsphere {
  /** curvature [1/mm] */
  c: number;
  /** conic constant */
  k: number;
  /** A4, A6, A8, A10 [mm^(1-2i)] */
  A: number[];
  /** semi-diameter [mm] */
  sd: number;
}

export interface LensData {
  name: string;
  /** effective focal length [m] */
  efl: number;
  /** NA of the lens's full aperture */
  NA: number;
  s1: EvenAsphere;
  s2: EvenAsphere;
  /** centre thickness [m] */
  thickness: number;
  /** back focal length at the design wavelength [m] */
  bfl: number;
}

export const LENSES: Record<"354330-C", LensData> = {
  "354330-C": {
    name: "Thorlabs 354330-C",
    efl: 3.1e-3,
    NA: 0.68,
    s1: { c: 0.36692108501490123, k: -0.5421234096046, A: [-2.077710281508e-5, -1.373929859525e-4, 2.029327872896e-5, -2.961194418229e-6], sd: 2.5 },
    s2: { c: -0.33567844058620466, k: -12.10285287639, A: [8.068904748567e-3, -1.725894132603e-3, 1.839071992368e-4, -8.936267158057e-6], sd: 1.920176352261 },
    thickness: 3.214106073867e-3,
    bfl: 1.760004021584e-3,
  },
};

/** Sag z(r) of an even asphere [mm] at radius r [mm]. */
export function sag(s: EvenAsphere, r: number): number {
  const r2 = r * r;
  let z = (s.c * r2) / (1 + Math.sqrt(Math.max(1 - (1 + s.k) * s.c * s.c * r2, 0)));
  let p = r2 * r2;
  for (const a of s.A) {
    z += a * p;
    p *= r2;
  }
  return z;
}

/**
 * The cone of a Gaussian beam of diameter D (1/e² intensity) focused by a
 * lens of focal length f: tan θ = (D/2) / f, the paraxial 1/e² half-angle,
 * capped at the lens's NA. For drawing and for the linked fields; the force
 * comes from the ray trace.
 */
export function asphereHalfAngle(lens: LensData, beamDiameter: number): number {
  return Math.min(Math.atan(beamDiameter / 2 / lens.efl), Math.asin(lens.NA));
}
