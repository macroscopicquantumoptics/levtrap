/**
 * #109: layout follow-ups to #101 and #103, on the WS2 dark trap and the other presets.
 * 1. An explanation stays in the window, wherever its number is (a plot tab open, under More).
 * 2. No formula scrolls sideways in its explanation, including the ones no preset shows.
 * 3. On Heating, the shaded band's label and the markers' labels never overlap (400–1280 px);
 *    a band zoomed out of view has no label. On Spectrum the direct labels clear the markers'.
 * 4. At 320 px the top bar fits, with a touch screen's larger buttons too.
 * 5. On a phone the verdict shows its first sentence; "Details" unfolds the rest. A verdict
 *    with a link stays unfolded.
 */
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { FORMULAS } from "../../src/screen/formulas.ts";
import { expectNoSidewaysScroll, open, settled, shot, VIEWS, type Scheme, type View } from "./helpers";

const PRESETS = ["tweezer", "counter", "paul-linear", "paul-ring", "ws2-bottle", "ws2-counter-bottle"];

/** Every number that explains itself, the headline ones and those under More (More open). */
async function explainable(page: Page): Promise<string[]> {
  const ids = ["freq-x", "freq-y", "freq-z", "depth"];
  const more = await page
    .getByTestId("more-numbers")
    .locator('button[data-testid^="more-"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid!));
  const out: string[] = [];
  for (const id of [...ids, ...more]) if (await page.getByTestId(id).isEnabled()) out.push(id);
  return out;
}

/** Open each explanation in turn: it is inside the window, and its formula does not scroll sideways. */
async function expectExplanationsFit(page: Page, label: string) {
  const bad: string[] = [];
  let n = 0;
  for (const id of await explainable(page)) {
    await page.getByTestId(id).click();
    const explain = page.getByTestId("explain");
    await expect(explain).toBeVisible();
    // KaTeX's fonts are in by now; wait for the placement after them
    await page.evaluate(() => document.fonts.ready);
    const r = await explain.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const f = el.querySelector<HTMLElement>('[data-testid="formula"]')!;
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, scroll: f.scrollWidth, width: f.clientWidth, formula: f.dataset.formula, style: el.getAttribute("style") };
    });
    const view = page.viewportSize()!;
    if (r.top < -0.5 || r.bottom > view.height + 0.5 || r.left < -0.5 || r.right > view.width + 0.5)
      bad.push(`${label} ${id}: spans ${r.left.toFixed(0)}–${r.right.toFixed(0)} × ${r.top.toFixed(0)}–${r.bottom.toFixed(0)} in ${view.width}×${view.height} (${r.style})`);
    if (r.scroll > r.width + 1) bad.push(`${label} ${id}: formula ${r.formula} is ${r.scroll} px in a ${r.width} px box`);
    await page.keyboard.press("Escape");
    await expect(explain).toHaveCount(0);
    n += 1;
  }
  expect(bad, bad.join("\n")).toEqual([]);
  return n;
}

async function heating(page: Page) {
  await page.getByTestId("tab-heating").click();
  await expect(page.getByTestId("drawer")).toHaveAttribute("data-tab", "heating");
}

test.describe("1, 2: explanations", () => {
  for (const scheme of ["light", "dark"] as Scheme[]) {
    test(`with Heating open, "Motion with the curl" and the stiffness open inside the window (${scheme})`, async ({ page }) => {
      await open(page, "preset=ws2-bottle", "desktop", scheme);
      await heating(page);
      await page.getByTestId("more").click();
      for (const id of ["dynamics", "stiffness"]) {
        await page.getByTestId(`more-${id}`).click();
        const explain = page.getByTestId("explain");
        await expect(explain).toBeInViewport({ ratio: 1 });
        // the title, value and formula are on screen, and the formula is on two or more lines, not scrolling
        await expect(explain.getByTestId("formula")).toHaveAttribute("data-formula", id);
        const f = await explain.getByTestId("formula").evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth }));
        expect(f.scroll).toBeLessThanOrEqual(f.width + 1);
        await shot(page, `layout-explain-${id}-desktop-${scheme}`);
        await page.keyboard.press("Escape");
      }
    });
  }

  for (const [view, size] of [
    ["desktop", VIEWS.desktop],
    ["narrow", VIEWS.narrow],
  ] as [View, { width: number; height: number }][]) {
    test.describe(`at ${size.width}×${size.height}`, () => {
      test.use({ viewport: size });

      test("every preset: every explanation, with a plot tab and More open, is inside the window and no formula scrolls sideways", async ({ page }) => {
        test.setTimeout(600_000);
        let n = 0;
        for (const preset of PRESETS) {
          await open(page, `preset=${preset}`, view);
          await settled(page);
          if (view === "desktop") await heating(page);
          await page.getByTestId("more").click();
          n += await expectExplanationsFit(page, preset);
        }
        expect(n).toBeGreaterThan(50);
      });
    });
  }

  for (const [view, size] of [
    ["desktop", VIEWS.desktop],
    ["narrow", VIEWS.narrow],
  ] as [View, { width: number; height: number }][]) {
    test.describe(`at ${size.width}×${size.height}`, () => {
      test.use({ viewport: size });

      test("every formula on the sheet fits its explanation's box, also those no preset shows", async ({ page }) => {
        await open(page, "preset=tweezer", view);
        await page.getByTestId("freq-x").click();
        const formula = page.getByTestId("explain").getByTestId("formula");
        await expect(formula).toBeVisible();
        // typeset each formula in the real box, with the page's KaTeX fonts and sizes
        await page.addScriptTag({ path: fileURLToPath(import.meta.resolve("katex/dist/katex.min.js")) });
        const bad = await formula.evaluate(async (el, all) => {
          const katex = (window as unknown as { katex: { renderToString(tex: string, o: object): string } }).katex;
          const tex = el.firstElementChild as HTMLElement;
          const out: string[] = [];
          for (const [id, t] of Object.entries(all)) {
            tex.innerHTML = katex.renderToString(t, { throwOnError: false, displayMode: true, output: "htmlAndMathml" });
            await document.fonts.ready;
            if (el.scrollWidth > el.clientWidth + 1) out.push(`${id}: ${el.scrollWidth} px in a ${el.clientWidth} px box`);
          }
          return out;
        }, Object.fromEntries(Object.entries(FORMULAS).map(([id, f]) => [id, f.tex])));
        expect(bad, bad.join("\n")).toEqual([]);
      });
    });
  }

  test("at 1280×800 with nothing open, a headline number still opens upwards", async ({ page }) => {
    await open(page, "preset=ws2-bottle");
    await page.getByTestId("freq-x").click();
    const explain = page.getByTestId("explain");
    await expect(explain).toHaveAttribute("data-side", "up");
    const [e, n] = [(await explain.boundingBox())!, (await page.getByTestId("freq-x").boundingBox())!];
    expect(e.y + e.height).toBeLessThanOrEqual(n.y);
  });
});

test.describe("3: Heating's labels", () => {
  test("the band's label and the markers' labels never overlap, from 400 to 1280 px", async ({ page }) => {
    test.setTimeout(240_000);
    await open(page, "preset=ws2-bottle");
    await heating(page);
    const chart = page.getByTestId("plot-heating-chart");
    for (let width = 400; width <= 1280; width += 40) {
      await page.setViewportSize({ width, height: 800 });
      await expect(async () => {
        const hits = await chart.evaluate((el) => {
          const boxes = [...el.querySelectorAll('[data-testid="plot-heating-band"] text, [data-testid="plot-heating-marker"] text')].map((t) => ({
            text: t.textContent,
            b: t.getBoundingClientRect(),
          }));
          const out: string[] = [];
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
              const [a, b] = [boxes[i].b, boxes[j].b];
              if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(`"${boxes[i].text}" on "${boxes[j].text}"`);
            }
          return { n: boxes.length, out };
        });
        expect(hits.n).toBe(3);
        expect(hits.out, `at ${width} px: ${hits.out.join("; ")}`).toEqual([]);
      }).toPass({ timeout: 10_000 });
    }
  });

  test("zoomed to the right of the threshold, the band out of view has no label", async ({ page }) => {
    await open(page, "preset=ws2-bottle");
    await heating(page);
    const chart = page.getByTestId("plot-heating-chart");
    const band = page.getByTestId("plot-heating-band");
    await expect(band.locator("text")).toHaveText("the particle spirals out");
    // drag from just right of the threshold's line to near the right edge
    const line = page.getByTestId("plot-heating-marker").filter({ hasText: "spirals out below" }).locator("line");
    const [b, l] = [(await chart.boundingBox())!, (await line.boundingBox())!];
    const y = b.y + b.height / 2;
    await page.mouse.move(l.x + 20, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 40, y, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId("plot-heating-fit")).toBeVisible();
    // the band is still drawn (clipped away), but its label is gone with it
    await expect(band).toHaveCount(1);
    await expect(band.locator("text")).toHaveCount(0);
    await page.getByTestId("plot-heating-fit").click();
    await expect(band.locator("text")).toHaveText("the particle spirals out");
  });

  test("on Spectrum the direct labels clear the markers' labels, from 400 to 1280 px", async ({ page }) => {
    test.setTimeout(600_000);
    for (const preset of ["tweezer", "counter", "ws2-bottle"]) {
      await open(page, `preset=${preset}`);
      await settled(page);
      await page.getByTestId("tab-spectrum").click();
      await expect(page.getByTestId("drawer")).toHaveAttribute("data-tab", "spectrum");
      const chart = page.getByTestId("plot-spectrum-chart");
      for (let width = 400; width <= 1280; width += 20) {
        await page.setViewportSize({ width, height: 800 });
        await expect(async () => {
          const hits = await chart.evaluate((el) => {
            const boxes = [...el.querySelectorAll('[data-testid="plot-spectrum-marker"] text, [data-testid="plot-spectrum-label"]')].map((t) => ({
              text: t.textContent,
              b: t.getBoundingClientRect(),
            }));
            const out: string[] = [];
            for (let i = 0; i < boxes.length; i++)
              for (let j = i + 1; j < boxes.length; j++) {
                const [a, b] = [boxes[i].b, boxes[j].b];
                if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(`"${boxes[i].text}" on "${boxes[j].text}"`);
              }
            return out;
          });
          expect(hits, `${preset} at ${width} px: ${hits.join("; ")}`).toEqual([]);
        }).toPass({ timeout: 10_000 });
      }
    }
  });

  for (const scheme of ["light", "dark"] as Scheme[]) {
    test(`at 600 px the shading's label clears "now: 1e-6 mbar" (${scheme})`, async ({ page }) => {
      await open(page, "preset=ws2-bottle", "small", scheme);
      await heating(page);
      const band = page.getByTestId("plot-heating-band").locator("text");
      const now = page.getByTestId("plot-heating-marker").filter({ hasText: "now: 1e-6 mbar" }).locator("text");
      await expect(async () => {
        const [a, b] = [(await band.boundingBox())!, (await now.boundingBox())!];
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }).toPass({ timeout: 10_000 });
      await shot(page, `layout-heating-labels-small-${scheme}`);
    });
  }
});

test.describe("4: the top bar at 320 px", () => {
  for (const touch of [false, true]) {
    test.describe(touch ? "with a touch screen (38 px buttons)" : "with a mouse", () => {
      test.use({ viewport: VIEWS.narrow, hasTouch: touch, isMobile: touch });

      for (const scheme of ["light", "dark"] as Scheme[]) {
        test(`every control is inside the window and works (${scheme})`, async ({ page }) => {
          await open(page, "preset=ws2-bottle", "narrow", scheme);
          const controls = page.locator("header").getByRole("button");
          const boxes = await controls.evaluateAll((els) =>
            els.map((e) => ({ name: e.getAttribute("aria-label") ?? e.textContent, left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right })),
          );
          expect(boxes.length).toBeGreaterThanOrEqual(6);
          for (const b of boxes) {
            expect(b.left, `${b.name}`).toBeGreaterThanOrEqual(0);
            expect(b.right, `${b.name}`).toBeLessThanOrEqual(320);
          }
          if (touch) expect((await page.getByTestId("theme-toggle").boundingBox())!.width).toBe(38);
          // none covers another
          for (let i = 1; i < boxes.length; i++) expect(boxes[i].left, `${boxes[i].name}`).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5);
          await expectNoSidewaysScroll(page);
          await shot(page, `layout-topbar-${touch ? "touch" : "mouse"}-narrow-${scheme}`);

          // the theme button and Help are reachable
          await page.getByTestId("theme-toggle").click();
          await expect(page.locator("html")).toHaveAttribute("data-theme", scheme === "light" ? "dark" : "light");
          await page.getByTestId("help").click();
          await expect(page.getByRole("dialog", { name: "Help" })).toBeInViewport();
        });
      }
    });
  }
});

test.describe("5: the verdict on a phone", () => {
  for (const [view, size] of [
    ["phone", VIEWS.phone],
    ["narrow", VIEWS.narrow],
  ] as [View, { width: number; height: number }][]) {
    test.describe(`at ${size.width} px`, () => {
      test.use({ viewport: size });

      for (const scheme of ["light", "dark"] as Scheme[]) {
        test(`the spiral verdict shows its first sentence; Details unfolds the pressure, the cause and the notes (${scheme})`, async ({ page }) => {
          await open(page, "preset=ws2-bottle", view, scheme);
          const verdict = page.getByTestId("verdict");
          await expect(verdict).toContainText("Stable without the curl, but at this pressure the particle spirals out");
          const hint = page.getByTestId("verdict-hint");
          await expect(hint).toBeHidden();
          await expect(verdict.getByText("The particle rests 237 nm downstream of the focus.")).toBeHidden();
          const folded = (await verdict.boundingBox())!.height;
          // was 300 px (39 %) at 320 × 760, with a mouse or a touch screen
          expect(folded).toBeLessThanOrEqual(0.2 * size.height);
          await shot(page, `layout-verdict-${view}-${scheme}`);

          const details = page.getByTestId("verdict-details");
          await expect(details).toHaveText("Details");
          await details.click();
          await expect(details).toHaveAttribute("aria-expanded", "true");
          await expect(hint).toBeVisible();
          await expect(hint).toContainText("The gas damps it enough above 65.4 mbar.");
          await expect(verdict.getByText("The particle rests 237 nm downstream of the focus.")).toBeVisible();
          await expectNoSidewaysScroll(page);
          await shot(page, `layout-verdict-unfolded-${view}-${scheme}`);
          await details.click();
          await expect(hint).toBeHidden();
        });
      }

      test("a verdict with a link is not folded: the link stays in sight", async ({ page }) => {
        await open(page, "preset=tweezer", view);
        await page.getByTestId("add-field").click();
        await page.getByTestId("add-paul-linear").click();
        await settled(page);
        const verdict = page.getByTestId("verdict");
        await expect(verdict).toContainText("a Paul trap needs a charged particle");
        await expect(verdict.getByRole("button", { name: "Show the particle" })).toBeInViewport();
        await expect(page.getByTestId("verdict-details")).toHaveCount(0);
      });

      test("a stable trap shows \"Stable trap.\" and folds where the particle rests", async ({ page }) => {
        await open(page, "preset=tweezer", view);
        const verdict = page.getByTestId("verdict");
        await expect(verdict.getByText("Stable trap.", { exact: true })).toBeVisible();
        await expect(page.getByTestId("verdict-rest")).toBeHidden();
        await page.getByTestId("verdict-details").click();
        await expect(page.getByTestId("verdict-rest")).toBeVisible();
      });
    });
  }

  test("the desktop verdict is unchanged: every sentence, no Details", async ({ page }) => {
    await open(page, "preset=ws2-bottle");
    await expect(page.getByTestId("verdict-hint")).toBeVisible();
    await expect(page.getByTestId("verdict").getByText("The particle rests 237 nm downstream of the focus.")).toBeVisible();
    await expect(page.getByTestId("verdict-details")).toBeHidden();
  });
});
