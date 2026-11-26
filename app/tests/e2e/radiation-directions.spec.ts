/** #75: the Radiation tab's other lenses (forward, side, both) and its pattern in the results export. */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, open, shot, type Scheme } from "./helpers";

async function saved(page: Page, item: string) {
  await page.getByTestId("file-menu").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(item).click()]);
  return readFileSync((await file.path())!).toString("utf8");
}

for (const scheme of ["light", "dark"] as Scheme[]) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test("a lens in each direction, and forward + backward together", async ({ page }) => {
      test.setTimeout(180_000);
      const errors = collectErrors(page);
      await open(page, "preset=tweezer", "desktop", scheme);
      await page.getByTestId("tab-radiation").click();
      const plot = page.getByTestId("plot-radiation");
      await expect(plot.locator("path[data-series]")).toHaveCount(2, { timeout: 90_000 });

      // collection: forward, backward, and the two added
      await page.getByTestId("field-radiation-view").selectOption("collection");
      await expect(plot.locator("path[data-series]")).toHaveCount(3);
      await expect(plot.locator('path[data-series="both"]')).toHaveCount(1);
      const atTrap = page.getByTestId("radiation-at-trap");
      await expect(atTrap).toContainText("At the trapping lens's NA 0.8");
      await expect(atTrap).toContainText("the two together");
      await shot(page, `radiation-collection-desktop-${scheme}`);

      // information: backward by default, then the lens chosen per direction
      await page.getByTestId("field-radiation-view").selectOption("information");
      await expect(page.getByTestId("field-radiation-direction")).toHaveValue("backward");
      await expect(plot.locator("path[data-series]")).toHaveCount(3);
      await expect(atTrap).toContainText("the trapping lens collects");
      await page.getByTestId("field-radiation-direction").selectOption("both");
      await expect(plot).toContainText("a forward and a backward lens of the same NA");
      await expect(atTrap).toContainText("the trapping lens and a forward lens of the same NA collect");
      await shot(page, `radiation-information-both-desktop-${scheme}`);
      // a side lens: the engine gives no value at the trapping lens's NA there
      await page.getByTestId("field-radiation-direction").selectOption("side_x");
      await expect(plot).toContainText("a side lens on the x axis");
      await expect(plot.locator("path[data-series]")).toHaveCount(3);
      await expect(atTrap).toHaveCount(0);
      await shot(page, `radiation-information-side-desktop-${scheme}`);
      expect(errors).toEqual([]);
    });
  });
}

test("the results export carries the pattern the Radiation tab computed", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "preset=tweezer");
  // before the pattern is computed, the export is the main answer alone
  expect(JSON.parse(await saved(page, "file-results-json")).result.pattern).toBeUndefined();
  await page.getByTestId("tab-radiation").click();
  await expect(page.getByTestId("plot-radiation").locator("path[data-series]")).toHaveCount(2, { timeout: 90_000 });
  const json = JSON.parse(await saved(page, "file-results-json"));
  expect(Object.keys(json.result.pattern.collection).sort()).toEqual(["backward", "forward", "side_x", "side_y"]);
  expect(json.result.pattern.trap_NA).toBe(0.8);
  expect(json.result.modes[2].frequency).toBe(96842.81);
  const csv = (await saved(page, "file-results-csv")).split("\n");
  expect(csv.some((l) => l.startsWith("light collected by forward + backward lenses at NA 0.8,"))).toBe(true);
  expect(csv.some((l) => l.startsWith("position information collected by side lens (+y) at NA 0.5,z,"))).toBe(true);
  expect(csv.some((l) => l.startsWith("light collected by backward lens (-z) at the trapping lens's NA 0.8,"))).toBe(true);
});
