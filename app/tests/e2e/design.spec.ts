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
