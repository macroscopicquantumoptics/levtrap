/** #64: the ideal lens's mapping, OTT's tan θ (default) or the textbook sine. */
import { expect, test } from "@playwright/test";
import { frequencies, open, selectPart, settled, shot } from "./helpers";

const kHz = (s: string) => parseFloat(s) * (s.includes("MHz") ? 1000 : 1);

test("the sine mapping focuses more tightly than OTT's, and OTT's comes back", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "preset=tweezer");
  await settled(page);
  const ott = (await frequencies(page)).map(kHz);

  await selectPart(page, "lens:0");
  await page.getByTestId("advanced").locator("summary").click();
  await page.getByTestId("field-lens0-model").selectOption("sine");
  await expect(page.getByTestId("advanced").locator("summary")).toContainText("sine mapping");
  // the waist the NA means is now the textbook λ / (π NA): 423 nm at NA 0.8
  await expect(page.getByTestId("field-lens0-waist")).toHaveValue(/^0\.423/);
  await settled(page);
  const sine = (await frequencies(page)).map(kHz);
  // OTT's tan θ mapping cuts the wide-angle light: the sine mapping's focus is tighter on every axis
  sine.forEach((f, i) => expect(f).toBeGreaterThan(ott[i]));
  await shot(page, "lens-mapping-desktop-light");

  await page.getByTestId("field-lens0-model").selectOption("gaussian");
  await settled(page);
  expect((await frequencies(page)).map(kHz)).toEqual(ott);
});
