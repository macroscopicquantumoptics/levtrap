/** #103: at phone width the results strip fits, and the tab and parts rows show that they scroll. */
import { expect, test, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, open, settled, shot, VIEWS, type Scheme, type View } from "./helpers";

const PRESETS = ["tweezer", "counter", "paul-linear", "paul-ring", "ws2-bottle", "ws2-counter-bottle"];

/** Every element of the results strip inside the window, and no tile's text running past its own box. */
async function expectStripFits(page: Page) {
  const out = await page.getByTestId("results").evaluate((strip) => {
    const width = window.innerWidth;
    const bad: string[] = [];
    for (const el of strip.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && (box.left < -0.5 || box.right > width + 0.5))
        bad.push(`"${el.textContent?.trim().slice(0, 24)}" spans ${box.left.toFixed(0)}–${box.right.toFixed(0)} px`);
    }
    for (const el of strip.querySelectorAll("button")) {
      if (el.scrollWidth > el.clientWidth + 1) bad.push(`"${el.textContent?.trim().slice(0, 24)}" is ${el.scrollWidth} px in a ${el.clientWidth} px tile`);
    }
    return bad;
  });
  expect(out, out.join("\n")).toEqual([]);
}

for (const [view, width] of [
  ["phone", 375],
  ["narrow", 320],
] as [View, number][]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: VIEWS[view] });

    test("every preset's results strip fits the window", async ({ page }) => {
      test.setTimeout(360_000);
      for (const preset of PRESETS) {
        await open(page, `preset=${preset}`, view);
        await settled(page);
        await expectStripFits(page);
        await expectNoSidewaysScroll(page);
      }
    });

    test("the dark trap's depth keeps its kelvin figure, under the k_BT", async ({ page }) => {
      await open(page, "preset=ws2-bottle", view);
      await settled(page);
      const also = page.getByTestId("depth-also");
      await expect(also).toBeVisible();
      await expect(also).toHaveText(/K$/);
      const box = (await also.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // on its own line, under the value
      const figureBottom = await also.evaluate((el) => el.parentElement!.firstElementChild!.getBoundingClientRect().bottom);
      expect(box.y).toBeGreaterThanOrEqual(figureBottom - 1);
      await shot(page, `phone-width-strip-${width}-light`);
    });
  });
}

test.describe("at 375 px", () => {
  test.use({ viewport: VIEWS.phone });

  for (const scheme of ["light", "dark"] as Scheme[]) {
    test(`the tab row fades and shows an arrow where more tabs are (${scheme})`, async ({ page }) => {
      await open(page, "preset=ws2-bottle", "phone", scheme);
      const row = page.getByTestId("tabs-scroll");
      const tabs = row.getByRole("tablist");
      const end = row.locator('button[data-side="end"]');
      const start = row.locator('button[data-side="start"]');

      // at the start: more past the right edge only
      await expect(row).toHaveAttribute("data-more-end", "");
      await expect(row).not.toHaveAttribute("data-more-start");
      await expect(end).toBeVisible();
      await expect(start).toHaveCount(0);
      expect(await tabs.evaluate((el) => getComputedStyle(el).maskImage)).toContain("gradient");
      await expect(page.getByTestId("tab-wavefront")).not.toBeInViewport();
      await shot(page, `phone-width-tabs-start-${scheme}`);

      // the arrow scrolls on: now there is more on the left too
      await end.click();
      await expect(row).toHaveAttribute("data-more-start", "");
      await expect(start).toBeVisible();

      // at the end: the right edge no longer fades, and the last tab is in sight
      await tabs.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      await expect(row).not.toHaveAttribute("data-more-end");
      await expect(end).toHaveCount(0);
      await expect(page.getByTestId("tab-wavefront")).toBeInViewport();
      await shot(page, `phone-width-tabs-end-${scheme}`);

      // and back
      await start.click();
      await tabs.evaluate((el) => el.scrollTo({ left: 0 }));
      await expect(row).not.toHaveAttribute("data-more-start");
      await expect(row).toHaveAttribute("data-more-end", "");
    });
  }

  test("a tab reached with the keyboard scrolls into view", async ({ page }) => {
    await open(page, "preset=ws2-bottle", "phone");
    await page.getByTestId("tab-wavefront").focus();
    await expect(page.getByTestId("tab-wavefront")).toBeInViewport();
    await expect(page.getByTestId("tabs-scroll")).toHaveAttribute("data-more-start", "");
  });

  test("the parts row fades where more parts are, the same way", async ({ page }) => {
    await open(page, "preset=ws2-bottle", "phone");
    const row = page.getByTestId("parts-scroll");
    await expect(row).toHaveAttribute("data-more-end", "");
    await expect(row).not.toHaveAttribute("data-more-start");
    await row.locator('button[data-side="end"]').click();
    await expect(row).toHaveAttribute("data-more-start", "");
    await page.getByTestId("parts").evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(row).not.toHaveAttribute("data-more-end");
    await shot(page, "phone-width-parts-end-light");
  });
});

test("on a desktop nothing fades: every tab fits", async ({ page }) => {
  await open(page, "preset=ws2-bottle");
  const row = page.getByTestId("tabs-scroll");
  await expect(row).not.toHaveAttribute("data-more-start");
  await expect(row).not.toHaveAttribute("data-more-end");
  await expect(row.locator("button[data-side]")).toHaveCount(0);
  expect(await row.getByRole("tablist").evaluate((el) => getComputedStyle(el).maskImage)).toBe("none");
});
