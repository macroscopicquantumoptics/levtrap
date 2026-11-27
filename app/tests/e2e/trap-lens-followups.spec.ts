/** #97: the trapping lens's NA and whose it is, side lenses in the information sweep, a coherent group's power, and the counter-propagating bottle beams. */
import { expect, test } from "@playwright/test";
import { open, selectPart, setField, settled, shot } from "./helpers";

test("the WS2 bottle beam's trapping lens has Beam 2's NA, and the sentence says so", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "preset=ws2-bottle");
  await settled(page);
  await page.getByTestId("tab-radiation").click();
  await page.getByTestId("field-radiation-view").selectOption("information");
  const atTrap = page.getByTestId("radiation-at-trap");
  await expect(atTrap).toContainText("At the trapping lens's NA 0.71 (Beam 2's: Beam 1 and Beam 2 go the same way through one lens", { timeout: 90_000 });
  await expect(atTrap).toContainText("the trapping lens collects this share of the position information: x ");
  await shot(page, "radiation-ws2-trap-lens-desktop-light");
});

test("the information sweep offers the side lenses, on the engine's NAs", async ({ page }) => {
  await open(page, "preset=ws2-bottle");
  await settled(page);
  await page.getByTestId("tab-sweep").click();
  await page.getByTestId("field-sweep-output").selectOption("information");
  const lens = page.getByTestId("field-sweep-info-lens");
  await expect(lens.locator("option")).toHaveText(["Backward (−z)", "Forward (+z)", "Forward + backward", "Side, on the x axis", "Side, on the y axis"]);
  await lens.selectOption("side_x");
  // a side lens has no value at the trapping lens's NA: the NA moves to 0.5, and that choice is greyed out
  await expect(page.getByTestId("field-sweep-info-na")).toHaveValue("0.5");
  await expect(page.getByTestId("field-sweep-info-na").locator('option[value="trap"]')).toBeDisabled();
  await shot(page, "sweep-info-side-desktop-light");
});

test("the counter-propagating bottle beams: a preset, held at the dark focus; the group's power scales all four beams", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("file-menu").click();
  await page.getByTestId("open-presets").click();
  await expect(page.getByTestId("preset-ws2-counter-bottle-illustrative")).toContainText("illustrative");
  await expect(page.getByTestId("preset-ws2-counter-bottle-source")).toContainText("Illustrative, not validated: the mirror-symmetric trap of #71");
  await page.getByTestId("preset-ws2-counter-bottle").click();
  await expect(page.getByTestId("presets")).toBeHidden();
  // held at the dark focus by the force; the light's spin spirals it out in vacuum (#101)
  await expect(page.getByTestId("verdict")).toContainText("Stable without the curl");
  await expect(page.getByTestId("verdict")).toContainText("The particle rests at the focus.");
  await settled(page);
  await selectPart(page, "field:0");
  const total = page.getByTestId("field-beam0-group-power");
  expect(Number.parseFloat(await total.inputValue())).toBeCloseTo(800, 6);
  await shot(page, "counter-bottle-group-power-desktop-light");
  await setField(page, "beam0-group-power", "1000");
  await settled(page);
  // each beam scaled by 1000 / 800, the split kept
  expect(Number.parseFloat(await page.getByTestId("field-beam0-power").inputValue())).toBeCloseTo(185.375, 2);
  await selectPart(page, "field:3");
  expect(Number.parseFloat(await page.getByTestId("field-beam3-power").inputValue())).toBeCloseTo(314.625, 2);
  expect(Number.parseFloat(await page.getByTestId("field-beam3-group-power").inputValue())).toBeCloseTo(1000, 6);
});
