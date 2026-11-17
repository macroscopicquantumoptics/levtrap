/** E1 (issue #23): a beam focused by a real lens, the Thorlabs 354330-C. */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { open, partButton, selectPart, setField, settled, shot } from "./helpers";

async function toAsphere(page: Page) {
  await open(page, "preset=tweezer");
  await selectPart(page, "lens:0");
  await page.getByTestId("field-lens0-kind").selectOption("asphere");
  await settled(page);
}

test("a lens becomes the ray-traced asphere, and says what it does to the focus", async ({ page }) => {
  test.setTimeout(180_000);
  await toAsphere(page);
  // aligned: it focuses where the ideal lens did, and holds the sphere
  await expect(partButton(page, "lens:0")).toContainText("354330-C · 5 mm beam");
  await expect(page.getByTestId("field-lens0-beam_diameter")).toHaveValue("5");
  const readout = page.getByTestId("lens0-readout");
  await expect(readout).toContainText("Focus moved");
  await expect(readout).toContainText("0 m");
  await expect(readout).toContainText("13.6 %");
  await expect(page.getByTestId("verdict")).toContainText("Stable trap.");
  // tilted: the focus moves, the label says so
  await setField(page, "lens0-tilt_y", "0.3");
  await settled(page);
  await expect(partButton(page, "lens:0")).toContainText("tilted 0.3°");
  await expect(readout).toContainText(/Focus moved\s*[1-9][\d.]* (nm|µm)/);
  await shot(page, "asphere-inspector-desktop-light");
  // the numbers under More explain themselves
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByTestId("more").click();
  await page.getByTestId("more-lens0-focus").click();
  await expect(page.getByTestId("formula")).toHaveAttribute("data-formula", "lens-focus-shift");
  await expect(page.getByTestId("explain")).toContainText("ray trace of the Thorlabs Zemax prescription");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("more-lens0-axis")).toContainText("mrad");
  // and are in the results file
  await page.getByTestId("file-menu").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("file-results-csv").click()]);
  const csv = readFileSync((await file.path())!, "utf8");
  expect(csv).toMatch(/^focus shift by lens 1,x,-?[\d.e-]+,m,ray-trace \(ok\)$/m);
  expect(csv).toMatch(/^clipping loss of lens 1,,0\.13\d+,,ray-trace \(ok\)$/m);
});

test("the real lens is drawn at its true distance, and back to an ideal lens of the same cone", async ({ page }) => {
  test.setTimeout(120_000);
  await toAsphere(page);
  // the lens stands one back focal length (1.8 mm) before the focus: zoomed out to millimetres it is in view
  await page.getByTestId("view-side").click();
  const scene = page.getByTestId("scene");
  const box = (await scene.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i += 1) await page.mouse.wheel(0, 400);
  await expect(page.getByTestId("scale-bar")).toContainText("mm");
  await page.keyboard.press("Escape");
  await shot(page, "asphere-scene-desktop-light");
  // back to an ideal lens: the NA of the asphere's cone
  await selectPart(page, "lens:0");
  await page.getByTestId("field-lens0-kind").selectOption("lens");
  await expect(page.getByTestId("field-lens0-NA")).toHaveValue("0.628");
});

test("the asphere is offered in a gas or vacuum only", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "environment");
  await page.getByTestId("advanced").locator("summary").click();
  await setField(page, "environment-medium_index", "1.33");
  await selectPart(page, "lens:0");
  await expect(page.getByTestId("field-lens0-kind").locator('option[value="asphere"]')).toBeDisabled();
  await expect(page.getByTestId("field-lens0-kind").locator('option[value="asphere"]')).toContainText("in a gas or vacuum");
});
