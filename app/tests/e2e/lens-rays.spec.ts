/** #49: rays traced through the real lens, and its wavefront error map. */
import { expect, test, type Page } from "@playwright/test";
import { open, selectPart, setField, settled, shot } from "./helpers";

async function toAsphere(page: Page) {
  await open(page, "preset=tweezer");
  await selectPart(page, "lens:0");
  await page.getByTestId("field-lens0-kind").selectOption("asphere");
  await settled(page);
}

async function toggleRays(page: Page) {
  await page.getByTestId("show-menu").click();
  await page.getByTestId("show-rays").click();
  await page.keyboard.press("Escape");
}

test("the rays run through the lens to its focus", async ({ page }) => {
  test.setTimeout(150_000);
  await toAsphere(page);
  await setField(page, "lens0-tilt_y", "0.3");
  await settled(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await toggleRays(page);
  await expect(page.getByTestId("rays-note")).toContainText("18 rays traced through the lens", { timeout: 60_000 });
  // zoomed out to millimetres from the side: the rays cross both surfaces and meet at the focus
  await page.getByTestId("view-side").click();
  const box = (await page.getByTestId("scene").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i += 1) await page.mouse.wheel(0, 400);
  await expect(page.getByTestId("scale-bar")).toContainText("mm");
  await shot(page, "lens-rays-desktop-light");
});

test("the wavefront map has the lens's rms", async ({ page }) => {
  test.setTimeout(150_000);
  await toAsphere(page);
  await setField(page, "lens0-tilt_y", "0.3");
  await settled(page);
  const readout = page.getByTestId("lens0-readout");
  await expect(readout).toContainText(/Wavefront error\s*0\.237 waves rms/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByTestId("tab-wavefront").click();
  await expect(page.getByTestId("wavefront-map-0")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("wavefront-numbers-0")).toContainText("0.237 λ");
  await shot(page, "plot-wavefront-desktop-light");
});

test("without a real lens there are no rays and no wavefront", async ({ page }) => {
  await open(page, "preset=tweezer");
  await toggleRays(page);
  await expect(page.getByTestId("rays-note")).toContainText("No real lens to trace");
  await page.getByTestId("tab-wavefront").click();
  await expect(page.getByTestId("tab-note")).toContainText("traced for a real lens");
});
