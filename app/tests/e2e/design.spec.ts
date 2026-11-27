/** Design: type the trap you want, and levtrap finds the inputs that give it. */
import { expect, test } from "@playwright/test";
import { open, partButton, settled, shot } from "./helpers";

test("the power that makes f_z 110 kHz is found, and applied", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "preset=tweezer");
  await page.getByTestId("tab-design").click();
  // only f_z, only the power: every frequency goes as √P, so P = 200 mW × (110 / 96.8)²
  await page.getByTestId("design-use-x").uncheck();
  await page.getByTestId("design-use-y").uncheck();
  await page.getByTestId("design-vary-lens0-NA").uncheck();
  const fz = page.getByTestId("field-design-z");
  await fz.fill("110 kHz");
  await fz.press("Enter");
  await page.getByTestId("design-find").click();
  await expect(page.getByTestId("design-apply")).toBeVisible({ timeout: 200_000 });
  const found = await page.getByTestId("design-table").locator('tr[data-knob="beam0-power"] td').last().textContent();
  const mW = Number(/([\d.]+) mW/.exec(found!)![1]);
  expect(mW).toBeGreaterThan(250);
  expect(mW).toBeLessThan(268);
  await shot(page, "design-desktop-light");
  await page.getByTestId("design-apply").click();
  await settled(page);
  await expect(partButton(page, "field:0")).toContainText(`${Math.round(mW)} mW`);
});

test("a power alone is set in one step: f_x 150 kHz on the tweezer is 86.9 mW (#102)", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "preset=tweezer");
  await page.getByTestId("tab-design").click();
  // with light only, f ∝ √P: P = 200 mW × (150 / 227.5)², and one solve checks it
  await page.getByTestId("design-use-y").uncheck();
  await page.getByTestId("design-use-z").uncheck();
  await page.getByTestId("design-vary-lens0-NA").uncheck();
  const fx = page.getByTestId("field-design-x");
  await fx.fill("150 kHz");
  await fx.press("Enter");
  await page.getByTestId("design-find").click();
  await expect(page.getByTestId("design-apply")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("design-progress")).toContainText(/^[12] trials? · power scaled in one step/);
  await expect(page.getByTestId("design-scale-note")).toBeVisible();
  const table = page.getByTestId("design-table");
  const watts = Number(await table.locator('tr[data-knob="beam0-power"] td').last().getAttribute("data-value"));
  expect(Math.abs(watts / 0.0869 - 1)).toBeLessThan(1e-3);
  const hz = Number(await table.locator('tr[data-target="x"] td').last().getAttribute("data-value"));
  expect(Math.abs(hz / 150e3 - 1)).toBeLessThan(1e-3);
  await shot(page, "design-power-scale");
});
