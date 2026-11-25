/** #83: a filled objective's wavefront error (focus.aberration). */
import { expect, test } from "@playwright/test";
import { frequencies, open, selectPart, setField, settled, shot } from "./helpers";

const kHz = (s: string) => parseFloat(s) * (s.includes("MHz") ? 1000 : 1);

for (const scheme of ["light", "dark"] as const) {
  test(`spherical aberration softens the trap along the beam, and is kept through the filling (${scheme})`, async ({ page }) => {
    test.setTimeout(240_000);
    await open(page, "preset=tweezer", "desktop", scheme);
    await settled(page);
    await selectPart(page, "lens:0");
    await page.getByTestId("advanced").locator("summary").click();
    // the aberration belongs to a filled objective: none for the Gaussian of an NA
    await expect(page.getByTestId("field-lens0-aberration-spherical")).toHaveCount(0);
    await page.getByTestId("field-lens0-model").selectOption("objective");
    await expect(page.getByTestId("field-lens0-aberration-spherical")).toHaveValue("0");
    await settled(page);
    // frequencies are listed x, y, z
    const [x0, y0, z0] = (await frequencies(page)).map(kHz);

    await setField(page, "lens0-aberration-spherical", "0.09");
    await expect(page.getByTestId("advanced").locator("summary")).toContainText("spherical 0.09 λ");
    await settled(page);
    const [x1, y1, z1] = (await frequencies(page)).map(kHz);
    // the focus dims as a whole, and most along the beam: f_y/f_z rises, f_y/f_x stays
    expect(y1).toBeLessThan(y0);
    expect(y1 / z1).toBeGreaterThan(1.04 * (y0 / z0));
    expect(Math.abs(y1 / x1 / (y0 / x0) - 1)).toBeLessThan(0.02);
    await shot(page, `lens-aberration-desktop-${scheme}`);

    // a new filling keeps the aberration; a value past a wave is refused
    await setField(page, "lens0-filling", "1.25");
    await expect(page.getByTestId("field-lens0-aberration-spherical")).toHaveValue("0.09");
    await page.getByTestId("field-lens0-aberration-coma_x").fill("1.5");
    await page.getByTestId("field-lens0-aberration-coma_x").press("Enter");
    await expect(page.getByText("Must be between −1 and 1 waves.")).toBeVisible();

    // back to zero: the objective's own numbers
    await page.getByTestId("field-lens0-aberration-coma_x").press("Escape");
    await setField(page, "lens0-filling", "1");
    await setField(page, "lens0-aberration-spherical", "0");
    await expect(page.getByTestId("advanced").locator("summary")).not.toContainText("spherical");
    await settled(page);
    expect((await frequencies(page)).map(kHz)).toEqual([x0, y0, z0]);
  });
}
