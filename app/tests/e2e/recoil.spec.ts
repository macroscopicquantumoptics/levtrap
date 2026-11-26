/**
 * #78, #95: the photon recoil per oscillation, Γ/Ω, under More, from the
 * position information in the scattered light, split into scattered photons,
 * beam photons and their cross term.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { open, settled, shot, type Scheme } from "./helpers";

for (const scheme of ["light", "dark"] as Scheme[]) {
  test(`photon recoil Γ/Ω explains its parts (${scheme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, "preset=tweezer", "desktop", scheme);
    await settled(page);
    await page.getByTestId("more").click();
    const recoil = page.getByTestId("more-recoil");
    // the row's label is its <dt>; the button holds the three values, x · y · z
    await expect(page.getByTestId("more-numbers")).toContainText("Photon recoil Γ/Ω");
    await expect(recoil).toHaveText(/^[\d.]+ · [\d.]+ · [\d.]+$/);
    await recoil.click();
    const explain = page.getByTestId("explain");
    await expect(page.getByTestId("formula")).toHaveAttribute("data-formula", "recoil");
    await expect(explain).toContainText("position information");
    await expect(explain).toContainText("scattered photons, along z");
    await expect(explain).toContainText("photons taken from the beam (the field's gradient at the sphere), along z");
    // the 100 nm silica sphere scatters slightly forwards: a cross term along the beam
    await expect(explain).toContainText("forward scattering gives back part of the beam photon's kick, along z");
    await expect(explain).toContainText("mean direction of the scattered photons");
    await shot(page, `recoil-explain-desktop-${scheme}`);
  });
}

test("the results file carries the recoil split per mode", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "preset=tweezer");
  await settled(page);
  await page.getByTestId("file-menu").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("file-results-csv").click()]);
  const csv = readFileSync((await file.path())!, "utf8");
  expect(csv).toMatch(/^recoil heating by scattered photons,z,[\d.e+]+,phonons\/s,information \(ok\)$/m);
  expect(csv).toMatch(/^recoil heating by beam photons,z,[\d.e+]+,phonons\/s,information \(ok\)$/m);
  expect(csv).toMatch(/^recoil heating cross term,z,-[\d.e+]+,phonons\/s,information \(ok\)$/m);
});
