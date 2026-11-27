/**
 * #101: a trap the force holds can still spiral out. The WS2 dark trap's
 * circularly polarised light has a curl (K_xy = −K_yx): at 1e-6 mbar the gas
 * damps too little and the motion along x and y grows. The verdict says so,
 * the Heating tab shades the pressures below the threshold, and More explains it.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, open, selectPart, setField, settled, shot, type Scheme } from "./helpers";

async function heating(page: Page) {
  await page.getByTestId("tab-heating").click();
  await expect(page.getByTestId("drawer")).toHaveAttribute("data-tab", "heating");
}

for (const scheme of ["light", "dark"] as Scheme[]) {
  test(`the WS2 dark trap spirals out in vacuum: the verdict and the Heating marker (${scheme})`, async ({ page }) => {
    await open(page, "preset=ws2-bottle", "desktop", scheme);
    const verdict = page.getByTestId("verdict");
    await expect(verdict).toContainText("Stable without the curl, but at this pressure the particle spirals out: its motion along x and y grows by a factor e every 103 µs.");
    await expect(verdict).toHaveAttribute("data-tone", "bad");
    await expect(page.getByTestId("verdict-hint")).toContainText("The gas damps it enough above 65.4 mbar.");
    await expect(page.getByTestId("verdict-hint")).toContainText("circularly polarised light");
    await expect(verdict).toContainText("The particle rests 237 nm downstream of the focus.");
    await expect(verdict).not.toContainText("Stable trap.");
    await shot(page, `dynamics-ws2-verdict-desktop-${scheme}`);

    await heating(page);
    const markers = page.getByTestId("plot-heating-marker");
    await expect(markers).toHaveCount(2);
    await expect(markers.filter({ hasText: "spirals out below 65.4 mbar" })).toHaveCount(1);
    await expect(page.getByTestId("plot-heating-band")).toHaveCount(1);
    await expect(page.getByTestId("plot-heating-band")).toContainText("the particle spirals out");
    await shot(page, `dynamics-ws2-heating-desktop-${scheme}`);
  });
}

test("More explains the curl: per block in the stiffness, and the motion with the gas damping", async ({ page }) => {
  await open(page, "preset=ws2-bottle");
  await page.getByTestId("more").click();
  await expect(page.getByTestId("more-dynamics")).toHaveText("spirals out below 65.4 mbar");
  await page.getByTestId("more-stiffness").click();
  await expect(page.getByTestId("explain")).toContainText("the curl about z, which pushes the particle round that axis");
  await expect(page.getByTestId("explain")).toContainText("−3.11 µN/m");
  await shot(page, "dynamics-ws2-stiffness-desktop-light");
  await page.keyboard.press("Escape");
  await page.getByTestId("more-dynamics").click();
  await expect(page.getByTestId("formula")).toHaveAttribute("data-formula", "dynamics");
  await expect(page.getByTestId("explain")).toContainText("grows along x: a factor e every 103 µs");
  await shot(page, "dynamics-ws2-explain-desktop-light");
});

test("above the threshold pressure the gas holds it: a stable trap again", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "preset=ws2-bottle");
  await selectPart(page, "environment");
  await setField(page, "environment-pressure", "100");
  await settled(page);
  await expect(page.getByTestId("verdict")).toContainText("Stable trap. The particle rests 237 nm downstream of the focus.");
  await heating(page);
  // the threshold is still marked: the curl does not depend on the gas
  await expect(page.getByTestId("plot-heating-marker").filter({ hasText: "spirals out below 65.4 mbar" })).toHaveCount(1);
  await shot(page, "dynamics-ws2-held-desktop-light");
});

test("linear polarisation has no curl: a stable trap, nothing shaded", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "preset=ws2-bottle");
  for (const i of [0, 1]) {
    await selectPart(page, `field:${i}`);
    await page.getByTestId(`field-beam${i}-polarisation`).selectOption("x");
  }
  await settled(page);
  await expect(page.getByTestId("verdict")).toContainText("Stable trap.");
  await heating(page);
  await expect(page.getByTestId("plot-heating-marker")).toHaveCount(1);
  await expect(page.getByTestId("plot-heating-band")).toHaveCount(0);
});

test("the spiral verdict fits a phone", async ({ page }) => {
  await open(page, "preset=ws2-bottle", "phone");
  await expect(page.getByTestId("verdict")).toContainText("spirals out");
  await expectNoSidewaysScroll(page);
  await shot(page, "dynamics-ws2-verdict-phone-light");
});
