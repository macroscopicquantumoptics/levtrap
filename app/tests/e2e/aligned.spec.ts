/** #51: a real lens compared with the aligned lens. */
import { expect, test } from "@playwright/test";
import { open, selectPart, setField, settled, shot } from "./helpers";

test("a tilted lens shows how far the particle moved and how each frequency changed", async ({ page }) => {
  test.setTimeout(150_000);
  await open(page, "preset=tweezer");
  await selectPart(page, "lens:0");
  await page.getByTestId("field-lens0-kind").selectOption("asphere");
  await settled(page);
  // aligned: nothing to compare
  await expect(page.getByTestId("lens0-compare")).toBeDisabled();
  await setField(page, "lens0-tilt_y", "0.3");
  await settled(page);
  await page.getByTestId("lens0-compare").click();
  const box = page.getByTestId("lens0-comparison");
  await expect(box).toContainText(/Particle moved\s*[1-9][\d.]* (nm|µm)/, { timeout: 60_000 });
  await expect(box).toContainText(/fx against aligned\s*[+−][\d.]+ %/);
  await expect(box).toContainText(/fz against aligned\s*[+−][\d.]+ %/);
  // the headline numbers settle while the comparison solves: the two requests do not cancel each other
  await expect(page.getByTestId("verdict")).toContainText("Stable trap.");
  await shot(page, "aligned-compare-desktop-light");
  // a further edit updates the comparison
  await setField(page, "lens0-tilt_y", "0.2");
  await settled(page);
  await expect(box).toContainText(/Particle moved\s*[1-9][\d.]* (nm|µm)/, { timeout: 60_000 });
  // back to aligned: the comparison goes, the button is disabled
  await setField(page, "lens0-tilt_y", "0");
  await settled(page);
  await expect(page.getByTestId("lens0-comparison")).toHaveCount(0);
  await expect(page.getByTestId("lens0-compare")).toBeDisabled();
});
