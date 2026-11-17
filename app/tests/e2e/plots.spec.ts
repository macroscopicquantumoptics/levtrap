/** The plots drawer (D5, issue #21): one tab per plot, each with its own data. */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoSidewaysScroll, open, shot, VIEWS, type Scheme } from "./helpers";

async function tab(page: Page, id: string) {
  await page.getByTestId(`tab-${id}`).click();
  await expect(page.getByTestId("drawer")).toHaveAttribute("data-tab", id);
}

/** A short sweep: four values of the beam's power. */
async function sweep(page: Page, points = "4") {
  await tab(page, "sweep");
  await page.getByTestId("field-sweep-param").selectOption("beam0-power");
  const count = page.getByTestId("field-sweep-count");
  await count.fill(points);
  await count.press("Enter");
  await page.getByTestId("sweep-run").click();
}

for (const scheme of ["light", "dark"] as Scheme[]) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test("every tab draws its plot", async ({ page }) => {
      test.setTimeout(240_000);
      const errors = collectErrors(page);
      await open(page, "preset=tweezer", "desktop", scheme);

      await tab(page, "forces");
      await expect(page.getByTestId("plot-forces").locator("path[data-series]")).toHaveCount(3);
      await shot(page, `plot-forces-desktop-${scheme}`);

      await tab(page, "potential");
      // each axis, and the harmonic trap of the same stiffness dashed
      await expect(page.getByTestId("plot-potential").locator("path[data-series]")).toHaveCount(6);
      await expect(page.getByTestId("plot-potential")).toContainText("harmonic, same stiffness");
      await shot(page, `plot-potential-desktop-${scheme}`);

      await tab(page, "heating");
      // the setup's pressure marked, and where recoil overtakes the gas on each axis
      await expect(page.getByTestId("plot-heating-marker")).toHaveCount(1);
      await expect(page.getByTestId("plot-heating-dot")).toHaveCount(3);
      await shot(page, `plot-heating-desktop-${scheme}`);

      await tab(page, "radiation");
      await expect(page.getByTestId("plot-radiation").locator("path[data-series]")).toHaveCount(2, { timeout: 90_000 });
      await shot(page, `plot-radiation-desktop-${scheme}`);
      await page.getByTestId("field-radiation-view").selectOption("collection");
      await expect(page.getByTestId("plot-radiation-marker")).toContainText("trapping lens: NA 0.8");
      await shot(page, `plot-collection-desktop-${scheme}`);

      await sweep(page);
      await expect(page.getByTestId("sweep-progress")).toContainText("4 solves", { timeout: 90_000 });
      await expect(page.getByTestId("plot-sweep").locator("path[data-series]")).toHaveCount(3);
      await shot(page, `plot-sweep-desktop-${scheme}`);
      expect(errors).toEqual([]);
    });
  });
}

test("the dipole approximation is drawn over the Mie force on request", async ({ page }) => {
  await open(page, "preset=tweezer");
  await tab(page, "forces");
  await page.getByTestId("forces-dipole").check();
  await expect(page.getByTestId("plot-forces").locator('path[data-series="x-dipole"]')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId("plot-forces")).toContainText("dipole approximation");
  await shot(page, "plot-forces-dipole-desktop-light");
});

test("a sweep shows its progress, shades where there is no trap, and can be cancelled", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "preset=tweezer");
  await tab(page, "sweep");
  // NA from 0.3: the scattering force wins at the low end
  await page.getByTestId("field-sweep-param").selectOption("lens0-NA");
  const count = page.getByTestId("field-sweep-count");
  await count.fill("5");
  await count.press("Enter");
  await page.getByTestId("sweep-run").click();
  await expect(page.getByTestId("sweep-progress")).toContainText(/\d of 5/);
  await expect(page.getByTestId("sweep-progress")).toContainText("5 solves", { timeout: 90_000 });
  await expect(page.getByTestId("plot-sweep-band").first()).toContainText("no stable trap");
  // a long one, stopped
  await count.fill("40");
  await count.press("Enter");
  await page.getByTestId("sweep-run").click();
  await expect(page.getByTestId("sweep-progress")).toContainText(/\d+ of 40/);
  await page.getByTestId("sweep-cancel").click();
  await expect(page.getByTestId("sweep-progress")).toContainText("Stopped at");
  await expect(page.getByTestId("sweep-run")).toBeVisible();
});

test("drag zooms, Fit shows all of it again", async ({ page }) => {
  await open(page, "preset=tweezer");
  await tab(page, "forces");
  const chart = page.getByTestId("plot-forces-chart");
  const box = (await chart.boundingBox())!;
  const ticks = async () => (await chart.locator("text").allTextContents()).join(" ");
  const before = await ticks();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("plot-forces-fit")).toBeVisible();
  expect(await ticks()).not.toEqual(before);
  await page.getByTestId("plot-forces-fit").click();
  await expect(page.getByTestId("plot-forces-fit")).toHaveCount(0);
  expect(await ticks()).toEqual(before);
});

test("a plot exports as CSV, SVG and PNG", async ({ page }) => {
  await open(page, "preset=tweezer");
  await tab(page, "forces");
  const save = async (kind: "csv" | "svg" | "png") => {
    await page.getByTestId("plot-forces-export").click();
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`plot-forces-${kind}`).click()]);
    expect(file.suggestedFilename()).toBe(`levtrap-forces.${kind}`);
    return readFileSync((await file.path())!);
  };
  const csv = (await save("csv")).toString("utf8").split("\n");
  expect(csv[0]).toBe("series,Displacement from the equilibrium [m],Force [N]");
  expect(csv.length).toBe(1 + 3 * 61 + 1);
  expect(csv[1]).toMatch(/^along x,-0\.0000015,[-\d.e]+$/);
  const svg = (await save("svg")).toString("utf8");
  expect(svg).toContain("<svg");
  // the theme's colours are written in: the file stands alone
  expect(svg).not.toContain("var(--");
  expect(svg).toMatch(/stroke:rgb\(235, 104, 52\)/); // --axis-x, light
  const png = await save("png");
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(png.length).toBeGreaterThan(10_000);
});

test("a Paul trap has no light to scatter, and no heating by light", async ({ page }) => {
  await open(page, "preset=paul-linear");
  await tab(page, "radiation");
  await expect(page.getByTestId("tab-note")).toContainText("There is no light in this trap");
  await tab(page, "heating");
  await expect(page.getByTestId("tab-note")).toContainText("Heating rates are computed for traps with a beam");
  // its forces are drawn, at the electrodes' scale
  await tab(page, "forces");
  await expect(page.getByTestId("plot-forces").locator("path[data-series]")).toHaveCount(3);
  await expect(page.getByTestId("plot-forces-chart")).toContainText("mm");
});

test.describe("at 375 px", () => {
  test.use({ viewport: VIEWS.phone });
  test("every tab fits without sideways scroll", async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, "preset=tweezer", "phone");
    for (const id of ["forces", "potential", "heating", "sweep", "radiation"]) {
      await tab(page, id);
      await expectNoSidewaysScroll(page);
    }
    await expect(page.getByTestId("plot-radiation")).toBeVisible({ timeout: 90_000 });
    await expectNoSidewaysScroll(page);
    await shot(page, "plot-radiation-phone-light");
    await tab(page, "potential");
    await shot(page, "plot-potential-phone-light");
  });
});
