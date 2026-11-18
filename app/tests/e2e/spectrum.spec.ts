/** E4 (issue #26): the displacement spectrum and each mode's occupation. */
import { expect, test, type Page } from "@playwright/test";
import { open, shot } from "./helpers";

async function spectrumTab(page: Page) {
  await page.getByTestId("tab-spectrum").click();
  await expect(page.getByTestId("drawer")).toHaveAttribute("data-tab", "spectrum");
}

test("the spectrum shows a peak per mode, and feedback cools them", async ({ page }) => {
  await open(page, "preset=tweezer");
  await spectrumTab(page);
  const plot = page.getByTestId("plot-spectrum");
  await expect(plot.locator("path[data-series]")).toHaveCount(3);
  await expect(page.getByTestId("plot-spectrum-marker")).toHaveCount(3);
  // at 1e-6 mbar photon recoil heats each mode above room temperature
  await expect(page.getByTestId("plot-spectrum-marker").first()).toContainText(/T_eff [\d.]+ K/);
  await shot(page, "plot-spectrum-desktop-light");

  await page.getByTestId("spectrum-table-toggle").click();
  const x = page.getByTestId("spectrum-row-x");
  await expect(x).toContainText(/\d+ K/);
  // 10 Hz of feedback linewidth: the x mode falls from about 440 K to tens of mK
  const field = page.getByTestId("field-spectrum-feedback");
  await field.fill("10");
  await field.press("Enter");
  await expect(x).toContainText("mK");
  await expect(x).toContainText("10.0 Hz");
  await expect(page.getByTestId("spectrum")).toContainText("feedback adding 10 Hz of linewidth");
  await shot(page, "spectrum-table-desktop-light");
});

test("a Paul trap without light has no heating rates, so no spectrum yet", async ({ page }) => {
  await open(page, "preset=paul-linear");
  await spectrumTab(page);
  await expect(page.getByTestId("tab-note")).toContainText("computed for traps with a beam");
});
