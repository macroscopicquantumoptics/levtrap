import type { NextConfig } from "next";

/**
 * Static export, served from a sub-path on GitHub Pages.
 *
 *   BASE_PATH=/levtrap/next npm run build   ->  out/, served at /levtrap/next/
 *   npm run build                           ->  out/, served at /
 *
 * The base path is baked into the bundle at build time.
 */
const basePath = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: { unoptimized: true },
};

export default nextConfig;
