/**
 * Which build of the engine the page runs (#96).
 *
 * `npm run wheel` (scripts/stage-wheel.mjs) puts the wheel at
 * `wheels/<build>/<wheel file>`, where `<build>` is the start of the sha256
 * of the wheel's bytes, and writes `wheels/manifest.json`:
 * `{"wheel": "<build>/<wheel file>", "build": "<build>"}`. A new wheel has a
 * new address, so a browser never installs a cached old one under a new page.
 *
 * `next.config.ts` reads the same manifest at build time and bakes its
 * `build` into the page as NEXT_PUBLIC_ENGINE_BUILD (read in the screen, not
 * here: the worker imports this module too). The worker reports the
 * build it installed; when the two differ (a page from before a deploy, with
 * the engine from after it), the screen offers a reload.
 */

export interface WheelManifest {
  /** Path of the wheel, relative to the manifest's folder. */
  wheel: string;
  /** Short content hash of the wheel; absent in a manifest from before #96. */
  build?: string;
}

/** Reads `wheels/manifest.json`; throws with a plain message when it is not one. */
export function parseManifest(data: unknown): WheelManifest {
  if (!data || typeof data !== "object") throw new Error("wheels/manifest.json is not an object");
  const { wheel, build } = data as Record<string, unknown>;
  if (typeof wheel !== "string" || !wheel.endsWith(".whl")) throw new Error("wheels/manifest.json names no wheel");
  if (wheel.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(wheel) || wheel.split("/").includes("..")) {
    throw new Error(`wheels/manifest.json: the wheel must be a path inside wheels/, not ${wheel}`);
  }
  if (build !== undefined && typeof build !== "string") throw new Error("wheels/manifest.json: build is not a string");
  return build ? { wheel, build } : { wheel };
}

/**
 * True when the page and its engine come from different builds. Unknown on
 * either side (no wheel staged at build time, an old manifest, the local
 * engine) is not a mismatch.
 */
export function engineMismatch(appBuild: string | undefined, engineBuild: string | undefined): boolean {
  return !!appBuild && !!engineBuild && appBuild !== engineBuild;
}
