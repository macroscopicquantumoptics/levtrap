import { test, expect } from "@playwright/test";

// The real browser path: Pyodide from the CDN + the levtrap wheel in
// app/out/wheels. Needs network, so it runs in CI only (E2E_PYODIDE=1).
test.skip(!process.env.E2E_PYODIDE, "set E2E_PYODIDE=1 (needs the Pyodide CDN and a built wheel)");

test("default setup computes in the browser with Pyodide", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/next/");
  await expect(page.getByTestId("freq-z")).toContainText("kHz", { timeout: 240_000 });
  await expect(page.getByTestId("verdict")).toContainText("Stable trap");
  await expect(page.getByText(/Pyodide \d/)).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: `${process.env.SCREENSHOT_DIR ?? "screenshots"}/a3-pyodide.png` });
});
