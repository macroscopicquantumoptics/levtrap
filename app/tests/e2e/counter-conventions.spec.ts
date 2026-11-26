/**
 * #71: the conventions of a counter-propagating trap. Polarisation is in each
 * beam's own frame and circular light keeps its helicity, so the counter beam
 * of a Circular + beam is added as Circular − (the same rotation in the lab);
 * the inspector says which frame polarisation and phase are in; Help has a
 * Conventions section.
 */
import { expect, test } from "@playwright/test";
import { expectNoSidewaysScroll, frequencies, open, selectPart, settled, shot } from "./helpers";

const kHz = (s: string) => parseFloat(s) * (s.includes("MHz") ? 1000 : 1);

test("the counter beam of a circular beam turns the same way in the lab and makes a standing wave", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "preset=tweezer");
  await selectPart(page, "field:0");
  await page.getByTestId("field-beam0-polarisation").selectOption("circular+");
  await settled(page);

  await page.getByTestId("add-field").click();
  await page.getByTestId("add-counter-beam").click();
  const inspector = page.getByTestId("inspector");
  await expect(inspector).toHaveAttribute("data-part", "field:1");
  // the other sign in its own frame: the same rotation in the lab
  await expect(page.getByTestId("field-beam1-polarisation")).toHaveValue("circular-");
  await expect(inspector).toContainText("In this beam's own frame");
  await expect(inspector).toContainText("Circular + here turns the other way in the lab");
  await settled(page);
  const travelling = (await frequencies(page)).map(kHz);

  // interfering, they make a standing wave: round in x-y and much stiffer along the beams
  await page.getByTestId("field-beam1-coherent").selectOption("0");
  await settled(page);
  await expect(inspector).toContainText("at its own focus, in its own frame");
  const standing = await frequencies(page);
  expect(standing[0]).toEqual(standing[1]);
  expect(kHz(standing[2])).toBeGreaterThan(5 * travelling[2]);
  await shot(page, "counter-conventions-desktop-light");

  // Circular + on the counter beam is σ⁺σ⁻ light: no standing wave, and f_x ≠ f_y
  await page.getByTestId("field-beam1-polarisation").selectOption("circular+");
  await settled(page);
  const opposite = await frequencies(page);
  expect(opposite[0]).not.toEqual(opposite[1]);
  expect(kHz(opposite[2])).toBeLessThan(kHz(standing[2]) / 5);
});

for (const scheme of ["light", "dark"] as const) {
  test(`Help has a folded Conventions section (${scheme})`, async ({ page }) => {
    await open(page, "preset=tweezer", "desktop", scheme);
    await page.getByTestId("help").click();
    const conventions = page.getByTestId("help-conventions");
    await expect(conventions).toBeVisible();
    await expect(conventions).not.toHaveAttribute("open", "");
    await conventions.locator("summary").click();
    for (const term of ["Frames", "Phase", "Power", "NA and waist", "Depth", "Reheating"]) {
      await expect(conventions.locator("dt", { hasText: term })).toBeVisible();
    }
    await shot(page, `help-conventions-desktop-${scheme}`);
  });
}

test("the Conventions section fits a phone", async ({ page }) => {
  await open(page, "preset=tweezer", "phone");
  await page.getByTestId("help").click();
  await page.getByTestId("help-conventions").locator("summary").click();
  await expect(page.getByTestId("help-conventions").locator("dt", { hasText: "Frames" })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await shot(page, "help-conventions-phone-light");
});
