/** #61: an objective whose back aperture the beam fills (focus.filling). */
import { expect, test } from "@playwright/test";
import { frequencies, open, selectPart, setField, settled, shot } from "./helpers";

const kHz = (s: string) => parseFloat(s) * (s.includes("MHz") ? 1000 : 1);

test("an objective's filled aperture softens the trap, and the Gaussian comes back", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "preset=tweezer");
  await settled(page);
  const gaussian = (await frequencies(page)).map(kHz);

  await selectPart(page, "lens:0");
  await page.getByTestId("advanced").locator("summary").click();
  await page.getByTestId("field-lens0-model").selectOption("objective");
  // the waist gives way to the filling; NA is now the aperture
  await expect(page.getByTestId("field-lens0-filling")).toHaveValue("1");
  await expect(page.getByTestId("field-lens0-waist")).toHaveCount(0);
  await expect(page.getByTestId("advanced").locator("summary")).toContainText("objective, filling 1");
  await settled(page);
  const filled = (await frequencies(page)).map(kHz);
  // the aperture cuts the wide-angle light the Gaussian of the same NA has: every axis is softer
  filled.forEach((f, i) => expect(f).toBeLessThan(gaussian[i]));
  await shot(page, "lens-filling-desktop-light");

  // underfilled: softer still
  await setField(page, "lens0-filling", "0.5");
  await settled(page);
  const under = (await frequencies(page)).map(kHz);
  under.forEach((f, i) => expect(f).toBeLessThan(filled[i]));

  // and back to the Gaussian of this NA: the numbers it started with
  await page.getByTestId("field-lens0-model").selectOption("gaussian");
  await expect(page.getByTestId("field-lens0-waist")).toBeVisible();
  await settled(page);
  expect((await frequencies(page)).map(kHz)).toEqual(gaussian);
});
