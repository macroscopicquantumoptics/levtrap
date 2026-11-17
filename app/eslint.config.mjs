import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // three.js is imperative: cameras, controls and materials are mutated in
    // place, and the camera rig keeps the latest props in a ref for its effects
    files: ["src/screen/scene3d/**"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/wheels/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
