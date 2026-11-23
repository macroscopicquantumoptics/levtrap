/** #50: the Sweep follows one trap from value to value and marks where it jumped; two more outputs. */
import { expect, test, type Page } from "@playwright/test";
import { open, selectPart, settled, shot } from "./helpers";

async function tiltSweep(page: Page, follow: boolean) {
  await open(page, "preset=tweezer");
  await selectPart(page, "lens:0");
  await page.getByTestId("field-lens0-kind").selectOption("asphere");
  await settled(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("tab-sweep").click();
  await page.getByTestId("field-sweep-param").selectOption("lens0-tilt_y");
  const count = page.getByTestId("field-sweep-count");
  await count.fill("7");
  await count.press("Enter");
  const box = page.getByTestId("sweep-follow");
  if ((await box.isChecked()) !== follow) await box.click();
  await page.getByTestId("sweep-run").click();
  await expect(page.getByTestId("sweep-progress")).toContainText("7 solves", { timeout: 150_000 });
}

test("a tilt sweep of the real lens follows one trap and marks the jumps", async ({ page }) => {
  test.setTimeout(240_000);
  await tiltSweep(page, true);
  // the tilt moves the focus off the trap it was following: the jumps are counted and drawn
  await expect(page.getByTestId("sweep-progress")).toContainText(/the trap jumped \d+×/);
  await expect(page.getByTestId("plot-sweep-marker").first()).toBeVisible();
  // and where the followed trap vanished, the fresh search found another (#59): every value holds one
  // (before #59 the search missed the traps beside the axis at ±1/3° and ±1°, shaded "no stable trap")
  await expect(page.getByTestId("plot-sweep")).not.toContainText("no stable trap");
  await shot(page, "plot-sweep-follow-desktop-light");
  // the new outputs read the same run
  await page.getByTestId("field-sweep-output").selectOption("recoil");
  await expect(page.getByTestId("plot-sweep").locator("path[data-series]")).toHaveCount(3);
  await page.getByTestId("field-sweep-output").selectOption("absorbed");
  await expect(page.getByTestId("plot-sweep").locator("path[data-series]")).toHaveCount(1);
});

test("without following, each value is searched afresh and nothing is marked", async ({ page }) => {
  test.setTimeout(240_000);
  await tiltSweep(page, false);
  await expect(page.getByTestId("sweep-progress")).not.toContainText("jumped");
  await expect(page.getByTestId("plot-sweep-marker")).toHaveCount(0);
});
