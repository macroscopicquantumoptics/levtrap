import { expect, test, type Page } from "@playwright/test";
import { LOCAL_API } from "./ports";

const SHOTS = "tests/screenshots";
const url = `./?backend=local&api=${encodeURIComponent(LOCAL_API)}`;

async function expectThreeFrequencies(page: Page) {
  for (const axis of ["x", "y", "z"]) {
    await expect(page.getByTestId(`freq-${axis}`)).toContainText(/\d+(\.\d+)? [kM]?Hz/, { timeout: 60_000 });
  }
  await expect(page.getByTestId("engine-status")).toContainText("stable");
}

for (const scheme of ["light", "dark"] as const) {
  test(`default setup shows f_x, f_y, f_z (${scheme})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(url);
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    await expectThreeFrequencies(page);
    // the transverse frequencies are of order 100 kHz for this tweezer
    await expect(page.getByTestId("freq-x")).toContainText("kHz");
    await page.screenshot({ path: `${SHOTS}/frequencies-${scheme}.png` });
    expect(errors).toEqual([]);
  });
}

test("theme toggle switches and remembers the theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(url);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

// The real thing: Pyodide from the CDN and the wheel from public/wheels/
// (stage it with `npm run wheel` before building). Slow and needs the
// network, so only when asked: E2E_PYODIDE=1.
test("default setup solves in the Pyodide worker", async ({ page }) => {
  test.skip(!process.env.E2E_PYODIDE, "set E2E_PYODIDE=1 (needs the CDN and a staged wheel)");
  test.setTimeout(300_000);
  await page.goto("./");
  for (const axis of ["x", "y", "z"]) {
    await expect(page.getByTestId(`freq-${axis}`)).toContainText(/\d+(\.\d+)? [kM]?Hz/, { timeout: 240_000 });
  }
  await expect(page.getByTestId("engine-status")).toContainText("stable");
});

test("assets load from the sub-path", async ({ page }) => {
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(url);
  await expectThreeFrequencies(page);
  expect(failed).toEqual([]);
});
