/** #76: counter-propagating beams have a radiation pattern: the Radiation tab and the scene's lobe. */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, open, partButton, shot, type Scheme } from "./helpers";

async function saved(page: Page, item: string) {
  await page.getByTestId("file-menu").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(item).click()]);
  return readFileSync((await file.path())!).toString("utf8");
}

for (const scheme of ["light", "dark"] as Scheme[]) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test("counter-propagating beams: the Radiation tab opens on their pattern", async ({ page }) => {
      test.setTimeout(180_000);
      const errors = collectErrors(page);
      await open(page, "preset=counter", "desktop", scheme);
      const tab = page.getByTestId("tab-radiation");
      await expect(tab).not.toHaveAttribute("data-unavailable");
      await tab.click();
      const plot = page.getByTestId("plot-radiation");
      await expect(plot.locator("path[data-series]")).toHaveCount(2, { timeout: 90_000 });
      await shot(page, `radiation-counter-pattern-desktop-${scheme}`);

      // two equal opposing beams that do not interfere: as much light forward as backward
      await page.getByTestId("field-radiation-view").selectOption("collection");
      await expect(plot.locator("path[data-series]")).toHaveCount(3);
      const atTrap = page.getByTestId("radiation-at-trap");
      await expect(atTrap).toContainText("At the trapping lens's NA 0.8");
      const text = (await atTrap.textContent()) ?? "";
      const m = text.match(/collects ([\d.]+) % of the scattered light looking back, a lens of the same NA opposite it ([\d.]+) %/);
      expect(m).not.toBeNull();
      expect(m![1]).toBe(m![2]);
      await shot(page, `radiation-counter-collection-desktop-${scheme}`);

      await page.getByTestId("field-radiation-view").selectOption("information");
      await expect(plot.locator("path[data-series]")).toHaveCount(3);
      await expect(atTrap).toContainText("the trapping lens collects");
      expect(errors).toEqual([]);
    });
  });
}

test("counter-propagating beams: the scene draws the pattern lobe", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await open(page, "preset=counter");
  await partButton(page, "particle").click();
  await page.getByTestId("particle-show-pattern").check();
  await expect(page.getByTestId("pattern-note")).toContainText("Radiation pattern: scattered power per solid angle, peak", { timeout: 90_000 });
  await shot(page, "radiation-counter-lobe-desktop-light");
  expect(errors).toEqual([]);
});

test("counter-propagating beams: the exported pattern is mirror-symmetric", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "preset=counter");
  await page.getByTestId("tab-radiation").click();
  await expect(page.getByTestId("plot-radiation").locator("path[data-series]")).toHaveCount(2, { timeout: 90_000 });
  const { pattern } = JSON.parse(await saved(page, "file-results-json")).result;
  expect(pattern.trap_axis).toEqual([0, 0, 1]);
  const { forward, backward } = pattern.collection as Record<string, number[]>;
  forward.forEach((f, i) => expect(f).toBeCloseTo(backward[i], 6));
  expect(pattern.information_efficiency.forward.z.at(-1)).toBeCloseTo(pattern.information_efficiency.backward.z.at(-1), 6);
});
