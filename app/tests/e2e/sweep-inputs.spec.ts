/** #72: the Sweep's inputs: an NA sweep starts from the lens's own NA, and log spacing starts on only over a decade. */
import { expect, test, type Page } from "@playwright/test";
import { open, settled, shot } from "./helpers";

const numberIn = async (page: Page, id: string) => Number.parseFloat(await page.getByTestId(`field-${id}`).inputValue());

test("a lens given by its waist starts its NA sweep from its own NA, not 0.8", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "preset=ws2-bottle");
  await settled(page);
  await page.getByTestId("tab-sweep").click();
  await page.getByTestId("field-sweep-param").selectOption("lens0-NA");
  // the 1.59 µm waist at 1550 nm is NA ≈ 0.30 (OTT's tan mapping): the range is 0.1 to 0.45
  expect(await numberIn(page, "sweep-from")).toBeCloseTo(0.1, 5);
  const to = await numberIn(page, "sweep-to");
  expect(to).toBeGreaterThan(0.4);
  expect(to).toBeLessThan(0.5);
  await expect(page.getByTestId("sweep-log")).not.toBeChecked();
  const count = page.getByTestId("field-sweep-count");
  await count.fill("3");
  await count.press("Enter");
  await page.getByTestId("sweep-run").click();
  await expect(page.getByTestId("sweep-progress")).toContainText("3 solves", { timeout: 200_000 });
  await shot(page, "plot-sweep-na-waist-desktop-light");
});

test("a radius sweep over a decade starts in log, and a 290–310 nm scan is linear", async ({ page }) => {
  await open(page, "preset=tweezer");
  await settled(page);
  await page.getByTestId("tab-sweep").click();
  await page.getByTestId("field-sweep-param").selectOption("particle-radius");
  // the default range, ×1/10 to ×10, spans two decades
  await expect(page.getByTestId("sweep-log")).toBeChecked();
  for (const [id, text] of [
    ["sweep-from", "290"],
    ["sweep-to", "310"],
  ]) {
    const field = page.getByTestId(`field-${id}`);
    await field.fill(text);
    await field.press("Enter");
  }
  await expect(page.getByTestId("sweep-log")).not.toBeChecked();
  await shot(page, "sweep-radius-linear-desktop-light");
  // the box still overrides it
  await page.getByTestId("sweep-log").click();
  await expect(page.getByTestId("sweep-log")).toBeChecked();
});
