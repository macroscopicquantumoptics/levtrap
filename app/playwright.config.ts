import { defineConfig } from "@playwright/test";

// Serves app/out at /next/ with the native Python engine behind /api
// (scripts/devserver.py). Build first: NEXT_BASE_PATH=/next npm run build.
const PORT = Number(process.env.E2E_PORT ?? 8765);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  webServer: {
    command: `python ../scripts/devserver.py ${PORT}`,
    url: `http://127.0.0.1:${PORT}/next/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
