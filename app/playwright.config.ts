import { defineConfig, devices } from "@playwright/test";
import { API_PORT, BASE, PORT } from "./tests/e2e/ports";

/**
 * Browser tests against the static export served from a sub-path, with the
 * engine answered by scripts/devserver.py (`?backend=local`). Build first:
 *   BASE_PATH=/levtrap/next npm run build     (npm run test:e2e does both)
 * Set PW_CHROMIUM to use a preinstalled Chromium instead of Playwright's.
 */
const python = process.env.PYTHON ?? "python3";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE}/`,
    viewport: { width: 1100, height: 640 },
    trace: "off",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1100, height: 640 } } }],
  webServer: [
    {
      command: `${python} ../scripts/devserver.py ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `node scripts/serve-static.mjs out ${PORT} ${BASE}`,
      url: `http://127.0.0.1:${PORT}${BASE}/`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
