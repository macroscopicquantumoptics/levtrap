import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * Static export, served from a sub-path on GitHub Pages.
 *
 *   BASE_PATH=/levtrap/next npm run build   ->  out/, served at /levtrap/next/
 *   npm run build                           ->  out/, served at /
 *
 * The base path is baked into the bundle at build time, and so is the build
 * of the staged wheel (`npm run wheel` writes public/wheels/manifest.json):
 * the screen compares it with the build the worker installed (#96,
 * src/engine/build.ts). No wheel staged: no build, no comparison.
 */
const basePath = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");

function stagedBuild(): string {
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "public", "wheels", "manifest.json"), "utf8")) as { build?: unknown };
    return typeof manifest.build === "string" ? manifest.build : "";
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_ENGINE_BUILD: stagedBuild() },
  images: { unoptimized: true },
  // The screen has controls in every corner; the dev badge would sit on one of them.
  devIndicators: false,
};

export default nextConfig;
