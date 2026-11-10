import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The Pyodide worker is a classic script loaded with importScripts.
    files: ["public/engine/worker.js"],
    languageOptions: { sourceType: "script", globals: { self: "readonly", importScripts: "readonly", loadPyodide: "readonly" } },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/wheels/**", "test-results/**", "playwright-report/**"]),
]);
