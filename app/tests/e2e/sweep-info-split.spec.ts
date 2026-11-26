/** #79: a coherent pair's phase and power split as sweep inputs, the information a lens collects as an output, and "Darken the focus". */
import { expect, test } from "@playwright/test";
import { open, selectPart, setField, settled, shot } from "./helpers";

test("the WS2 bottle beam is already dark; unbalanced, Darken the focus restores its split", async ({ page }) => {
  await open(page, "preset=ws2-bottle");
  await settled(page);
  await selectPart(page, "field:1");
  // the preset uses the split that darkens the focus: the button has nothing to do
  await expect(page.getByTestId("beam1-darken")).toBeDisabled();
  await expect(page.getByTestId("beam1-darken-note")).toContainText("The focus is dark: 62.92 % of the pair's power in beam 2.");
  await shot(page, "darken-ws2-desktop-light");
  // 300 mW in beam 2: 0.2966 + 0.3 W, unbalanced
  await setField(page, "beam1-power", "300");
  await settled(page);
  await expect(page.getByTestId("beam1-darken")).toBeEnabled();
  await expect(page.getByTestId("beam1-darken-note")).toContainText("the two beams then cancel at the focus");
  await page.getByTestId("beam1-darken").click();
  await settled(page);
  // the same total (596.6 mW), split as the engine says: 62.92 % in beam 2, 375.4 mW
  expect(Number.parseFloat(await page.getByTestId("field-beam1-power").inputValue())).toBeCloseTo(375.4, 0);
  await expect(page.getByTestId("beam1-darken")).toBeDisabled();
  await expect(page.getByTestId("beam1-darken-note")).toContainText("The focus is dark");
});

test("Darken the focus, in the dark scheme", async ({ page }) => {
  await open(page, "preset=ws2-bottle", "desktop", "dark");
  await settled(page);
  await selectPart(page, "field:1");
  await setField(page, "beam1-phase", "0");
  await settled(page);
  // in phase the two beams cannot cancel: the sentence says how bright the focus stays
  await expect(page.getByTestId("beam1-darken-note")).toContainText("they do not cancel there");
  await shot(page, "darken-ws2-desktop-dark");
});

test("a sweep of the pair's split plots the information the trapping lens collects", async ({ page }) => {
  test.setTimeout(400_000);
  await open(page, "preset=ws2-bottle");
  await settled(page);
  await page.getByTestId("tab-sweep").click();
  await page.getByTestId("field-sweep-param").selectOption("pair0-1-split");
  await page.getByTestId("field-sweep-output").selectOption("information");
  await expect(page.getByTestId("field-sweep-info-lens")).toHaveValue("backward");
  await expect(page.getByTestId("field-sweep-info-na")).toHaveValue("trap");
  await setField(page, "sweep-from", "0.4");
  await setField(page, "sweep-to", "0.8");
  await setField(page, "sweep-count", "3");
  await page.getByTestId("sweep-run").click();
  await expect(page.getByTestId("sweep-progress")).toContainText("3 solves", { timeout: 380_000 });
  await expect(page.getByTestId("tab-note")).toHaveCount(0);
  await shot(page, "sweep-info-split-desktop-light");
});

test("the phase of the second beam sweeps over a full turn, and a frequency sweep asks to run again for information", async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, "preset=ws2-bottle");
  await settled(page);
  await page.getByTestId("tab-sweep").click();
  await page.getByTestId("field-sweep-param").selectOption("beam1-phase");
  await setField(page, "sweep-from", "0.8");
  await setField(page, "sweep-to", "1.2");
  await setField(page, "sweep-count", "3");
  await page.getByTestId("sweep-run").click();
  await expect(page.getByTestId("sweep-progress")).toContainText("3 solves", { timeout: 280_000 });
  await shot(page, "sweep-phase-desktop-light");
  // the run solved without the pattern: the information output asks for another run
  await page.getByTestId("field-sweep-output").selectOption("information");
  await expect(page.getByTestId("tab-note")).toContainText("Run it again to plot the information collected.");
});

test("the information output is greyed out where nothing is scattered (a Paul trap alone)", async ({ page }) => {
  await open(page, "preset=paul-linear");
  await settled(page);
  await page.getByTestId("tab-sweep").click();
  await expect(page.getByTestId("field-sweep-output").locator('option[value="information"]')).toBeDisabled();
});
