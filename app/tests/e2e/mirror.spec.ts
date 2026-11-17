/** E3 (issue #25): a beam focused by a parabolic mirror. */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { open, partButton, selectPart, setField, settled, shot } from "./helpers";

async function toMirror(page: Page) {
  await open(page, "preset=tweezer");
  await selectPart(page, "lens:0");
  await page.getByTestId("field-lens0-kind").selectOption("parabolic_mirror");
  await settled(page);
}

test("a lens becomes a deep parabolic mirror, which says how much light it sends to the focus", async ({ page }) => {
  test.setTimeout(180_000);
  await toMirror(page);
  // the new mirror: f 3 mm, 18 mm across, a 10 mm beam; its rim is above the focus
  await expect(partButton(page, "lens:0")).toContainText("Mirror");
  await expect(partButton(page, "lens:0")).toContainText("f 3 mm · Ø 18 mm · 10 mm beam");
  await expect(page.getByTestId("field-lens0-focal_length")).toHaveValue("3");
  await expect(page.getByTestId("inspector")).toContainText("a deep mirror");
  const readout = page.getByTestId("lens0-readout");
  await expect(readout).toContainText("Reflected to the focus");
  await expect(readout).toContainText("99.8 %");
  await expect(page.getByTestId("verdict")).toContainText("Stable trap.");
  // a hole: less light, none from near the axis
  await page.getByTestId("advanced").locator("summary").click();
  await setField(page, "lens0-hole_radius", "0.5");
  await settled(page);
  await expect(partButton(page, "lens:0")).toContainText("hole 1 mm");
  await expect(readout).toContainText("97.9 %");
  await expect(readout).toContainText("9.527° to 112.6°");
  await expect(page.getByTestId("verdict")).toContainText("Stable trap.");
  await shot(page, "mirror-inspector-desktop-light");
  // the numbers under More explain themselves
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByTestId("more").click();
  await page.getByTestId("more-mirror0-reflected").click();
  await expect(page.getByTestId("formula")).toHaveAttribute("data-formula", "mirror-reflected");
  await expect(page.getByTestId("explain")).toContainText("Lieb & Meixner");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("more-mirror0-rim")).toContainText("112.6°");
  // and are in the results file
  await page.getByTestId("file-menu").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("file-results-csv").click()]);
  const csv = readFileSync((await file.path())!, "utf8");
  expect(csv).toMatch(/^reflected by mirror 1,,0\.978\d+,,paraboloid far field \(ok\)$/m);
  expect(csv).toMatch(/^rim angle of mirror 1,,112\.6\d+,deg,paraboloid far field \(ok\)$/m);
});

test("the mirror is drawn at its true size around the focus, and back to an ideal lens", async ({ page }) => {
  test.setTimeout(120_000);
  await toMirror(page);
  await page.getByTestId("view-side").click();
  const scene = page.getByTestId("scene");
  const box = (await scene.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 70; i += 1) await page.mouse.wheel(0, 400);
  await expect(page.getByTestId("scale-bar")).toContainText("mm");
  await page.keyboard.press("Escape");
  await shot(page, "mirror-scene-desktop-light");
  // back to an ideal lens of the drawn cone: the beam's 1/e² edge on the mirror, 79.6°
  await selectPart(page, "lens:0");
  await page.getByTestId("field-lens0-kind").selectOption("lens");
  await expect(page.getByTestId("field-lens0-NA")).toHaveValue("0.984");
  await expect(partButton(page, "lens:0")).toContainText("Lens");
});

test("the mirror is offered for a Gaussian beam only", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "field:0");
  await page.getByTestId("advanced").locator("summary").click();
  await page.getByTestId("field-beam0-mode").selectOption({ index: 1 });
  await selectPart(page, "lens:0");
  const option = page.getByTestId("field-lens0-kind").locator('option[value="parabolic_mirror"]');
  await expect(option).toBeDisabled();
  await expect(option).toContainText("for a Gaussian beam");
});
