/**
 * The intensity slice (#48): which lab plane faces the camera, the image of
 * the light's intensity on it, and where its corners are. Pure; slice.test.ts.
 * The intensity comes from the engine (solve's "field" block).
 */
import type { FieldBlock, SlicePlane, Vec3 } from "../../engine/types.ts";

/** The lab axes a plane spans: [along u, along v, its normal]. */
export const PLANE_AXES: Record<SlicePlane, [number, number, number]> = { xz: [0, 2, 1], yz: [1, 2, 0], xy: [0, 1, 2] };

/** The lab plane most nearly facing a camera that looks along `view` (any length). */
export function facingPlane(view: Vec3): SlicePlane {
  const a = view.map(Math.abs);
  const normal = a.indexOf(Math.max(...a));
  return normal === 0 ? "yz" : normal === 1 ? "xz" : "xy";
}

/**
 * RGBA pixels (row 0 = the first v), the light's colour with an opacity
 * growing with the intensity: alpha = maxAlpha (I / I_max)^gamma, so the dim
 * wings show and the focus does not hide the particle.
 */
export function sliceImage(field: FieldBlock, plane: SlicePlane, rgb: [number, number, number], maxAlpha = 0.9, gamma = 0.8): { data: Uint8Array; width: number; height: number } {
  const P = field.planes[plane];
  const height = P.v.length;
  const width = P.u.length;
  const data = new Uint8Array(width * height * 4);
  const top = field.max > 0 ? field.max : 1;
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const k = 4 * (j * width + i);
      const t = Math.min(1, Math.max(0, P.I[j][i] / top));
      data[k] = rgb[0];
      data[k + 1] = rgb[1];
      data[k + 2] = rgb[2];
      data[k + 3] = Math.round(255 * maxAlpha * t ** gamma);
    }
  }
  return { data, width, height };
}

/** The plane's corners in the lab [m]: (u0, v0), (u1, v0), (u1, v1), (u0, v1), at the centre's third coordinate. */
export function sliceCorners(field: FieldBlock, plane: SlicePlane): [Vec3, Vec3, Vec3, Vec3] {
  const P = field.planes[plane];
  const [a, b] = PLANE_AXES[plane];
  const at = (u: number, v: number): Vec3 => {
    const r: Vec3 = [...field.centre] as Vec3;
    r[a] = u;
    r[b] = v;
    return r;
  };
  const [u0, u1, v0, v1] = [P.u[0], P.u[P.u.length - 1], P.v[0], P.v[P.v.length - 1]];
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

/** "x–z" */
export const planeName = (plane: SlicePlane) => `${plane[0]}–${plane[1]}`;
