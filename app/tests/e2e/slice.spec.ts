/** #48: the light's intensity on the plane through the trap that faces the camera. */
import { expect, test, type Page } from "@playwright/test";
import { open, selectPart, settled, shot } from "./helpers";

async function showSlice(page: Page) {
  await page.getByTestId("show-menu").click();
  await page.getByTestId("show-slice").click();
  await page.keyboard.press("Escape");
}

test("the intensity slice faces the camera and follows the view", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "preset=tweezer");
  await showSlice(page);
  const note = page.getByTestId("slice-note");
  await expect(note).toContainText(/Intensity on the .–. plane · peak [\d.]+ [GT]W\/m²/, { timeout: 60_000 });
  // from the side the slice is a plane along the beam (z), through the focus
  await page.getByTestId("view-side").click();
  await expect(note).toHaveAttribute("data-plane", /^(xz|yz)$/);
  await expect(note).toContainText(/[xy]–z plane/);
  await shot(page, "slice-side-desktop-light");
  // looking along the beam (z) it is the x–y plane, the beam's cross-section
  await page.getByTestId("view-along").click();
  await expect(note).toHaveAttribute("data-plane", "xy");
  await shot(page, "slice-along-desktop-light");
  // off again: no note
  await showSlice(page);
  await expect(note).toHaveCount(0);
});

test("a standing wave shows its fringes", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "preset=counter");
  // make beam 2 interfere with beam 1: a standing wave
  await selectPart(page, "field:1");
  await page.getByTestId("field-beam1-coherent").selectOption("0");
  await settled(page);
  await page.keyboard.press("Escape");
  await showSlice(page);
  await page.getByTestId("view-side").click();
  await expect(page.getByTestId("slice-note")).toHaveAttribute("data-plane", /^(xz|yz)$/, { timeout: 60_000 });
  await expect(page.getByTestId("slice-note")).toContainText("peak");
  await shot(page, "slice-counter-desktop-light");
});

test("a Paul trap has no light to slice", async ({ page }) => {
  await open(page, "preset=paul-linear");
  await showSlice(page);
  await expect(page.getByTestId("slice-note")).toContainText("No light to show", { timeout: 60_000 });
});
