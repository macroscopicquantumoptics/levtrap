import type { NextConfig } from "next";

// The site is served from a sub-path on GitHub Pages (e.g. /levtrap/next).
// NEXT_BASE_PATH sets it at build time; empty for local development.
const basePath = process.env.NEXT_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: { unoptimized: true },
};

export default nextConfig;
