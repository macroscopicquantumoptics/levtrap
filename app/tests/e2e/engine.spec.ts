/**
 * The engine behind the screen: the local Python engine in every run, and
 * Pyodide in the browser when E2E_PYODIDE=1 (the Pages build does that).
 */
import { expect, test } from "@playwright/test";
import { collectErrors, frequencies, local, open, settled } from "./helpers";

test("the engine solves the default setup", async ({ page }) => {
  const errors = collectErrors(page);
  // recorded=0: the preset's numbers must come from the engine, not from the recording
  await open(page, "preset=tweezer&recorded=0");
  await settled(page);
  await expect(page.getByTestId("engine-status")).toContainText("Computed in");
  expect(await frequencies(page)).toEqual(["227 kHz", "285 kHz", "96.8 kHz"]);
  await expect(page.getByTestId("verdict")).toContainText("Stable trap. The particle rests 216 nm downstream of the focus.");
  await expect(page.getByTestId("depth")).toContainText("386");
  expect(errors).toEqual([]);
});

test("a preset shows its recorded numbers without the engine", async ({ page }) => {
  await page.route("**/api", (route) => route.abort());
  await open(page, "preset=tweezer");
  expect(await frequencies(page)).toEqual(["227 kHz", "285 kHz", "96.8 kHz"]);
  await expect(page.getByTestId("engine-status")).toContainText("Recorded from the engine for this preset");
  await expect(page.getByTestId("results")).toHaveAttribute("aria-busy", "false");
});

test("recorded and computed numbers are the same", async ({ page }) => {
  for (const preset of ["tweezer", "paul-linear", "paul-ring"]) {
    await open(page, `preset=${preset}`);
    const recorded = [...(await frequencies(page)), await page.getByTestId("verdict").innerText()];
    await open(page, `preset=${preset}&recorded=0`);
    await settled(page);
    await expect(page.getByTestId("engine-status")).toContainText("Computed in");
    expect([...(await frequencies(page)), await page.getByTestId("verdict").innerText()], preset).toEqual(recorded);
  }
});

test("theme toggle switches and remembers the theme", async ({ page }) => {
  await open(page, "preset=tweezer");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

// The real thing: Pyodide from the CDN and the wheel from public/wheels/
// (stage it with `npm run wheel` before building). Slow and needs the
// network, so only when asked: E2E_PYODIDE=1.
test("the default setup solves in the Pyodide worker", async ({ page }) => {
  test.skip(!process.env.E2E_PYODIDE, "set E2E_PYODIDE=1 (needs the CDN and a staged wheel)");
  test.setTimeout(300_000);
  await page.goto("./?preset=tweezer&recorded=0");
  await expect(page.getByTestId("engine-status")).toContainText("Computed in", { timeout: 240_000 });
  expect(await frequencies(page)).toEqual(["227 kHz", "285 kHz", "96.8 kHz"]);
  await expect(page.getByTestId("verdict")).toContainText("Stable trap");
});

test("assets load from the sub-path", async ({ page }) => {
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(local("preset=tweezer&recorded=0"));
  await settled(page);
  await expect(page.getByTestId("freq-x")).toContainText("kHz");
  expect(failed).toEqual([]);
});
