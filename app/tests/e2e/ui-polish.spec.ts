/** #81: UI polish found while building multi-beam traps. */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { open, selectPart, shot, VIEWS, type Scheme } from "./helpers";

type Rect = { x: number; y: number; width: number; height: number };

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The boxes of the visible elements a locator finds. */
async function boxes(list: Locator): Promise<{ name: string; box: Rect }[]> {
  const out: { name: string; box: Rect }[] = [];
  for (const el of await list.all()) {
    const box = await el.boundingBox();
    if (box) out.push({ name: (await el.textContent()) ?? "", box });
  }
  return out;
}

async function expectNoOverlap(list: Locator) {
  const all = await boxes(list);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) expect(overlap(all[i].box, all[j].box), `"${all[i].name}" covers "${all[j].name}"`).toBe(false);
  return all.length;
}

const sceneLabels = (page: Page) => page.getByTestId("scene").locator("button[data-part]");

for (const scheme of ["light", "dark"] as Scheme[]) {
  test(`two coherent beams on one axis: every scene label readable (${scheme})`, async ({ page }) => {
    await open(page, "preset=ws2-bottle", "desktop", scheme);
    await expect(page.getByTestId("scene").locator('button[data-part="field:1"]')).toBeVisible();
    expect(await expectNoOverlap(sceneLabels(page))).toBeGreaterThanOrEqual(4);
    await shot(page, `ui-polish-labels-desktop-${scheme}`);
  });
}

test("tabs that cannot compute are greyed, with the reason as the tooltip", async ({ page }) => {
  await open(page, "preset=counter");
  const radiation = page.getByTestId("tab-radiation");
  await expect(radiation).toHaveAttribute("data-unavailable", "");
  await expect(radiation).toHaveAttribute("title", /along \+z through one focus/);
  await expect(page.getByTestId("tab-wavefront")).toHaveAttribute("title", /Asphere 354330-C/);
  await expect(page.getByTestId("tab-forces")).not.toHaveAttribute("data-unavailable");
  // it still opens, to say why
  await radiation.hover();
  await shot(page, "ui-polish-tabs-desktop-light");
  await radiation.click();
  await expect(page.getByTestId("drawer")).toHaveAttribute("data-tab", "radiation");
});

test("the Forces tab's line labels sit off each other, and the spectrum's peak labels too", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("tab-forces").click();
  const labels = page.getByTestId("plot-forces-label");
  await expect(labels.first()).toBeVisible();
  await expectNoOverlap(labels);
  await shot(page, "ui-polish-forces-desktop-light");

  await page.getByTestId("tab-spectrum").click();
  await expect(page.getByTestId("plot-spectrum-marker")).toHaveCount(3);
  await expectNoOverlap(page.getByTestId("plot-spectrum").locator("[data-testid=plot-spectrum-marker] text"));
  await shot(page, "ui-polish-spectrum-desktop-light");
});

test.describe("at 375 px", () => {
  test.use({ viewport: VIEWS.phone });

  test("the parts row stays while a part is selected, so the next part is one tap away", async ({ page }) => {
    await open(page, "preset=counter", "phone");
    await selectPart(page, "field:0");
    const parts = page.getByTestId("parts");
    await expect(parts).toBeVisible();
    await expect(parts.locator('button[data-part="field:0"]')).toHaveAttribute("aria-pressed", "true");
    // the row sits above the settings
    const row = (await parts.boundingBox())!;
    const inspector = (await page.getByTestId("inspector").boundingBox())!;
    expect(row.y + row.height).toBeLessThanOrEqual(inspector.y + 1);
    await shot(page, "ui-polish-parts-phone-light");
    await parts.locator('button[data-part="lens:1"]').click();
    await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", "lens:1");
  });
});
