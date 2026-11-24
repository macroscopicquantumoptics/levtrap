/** The 3D scene (D3, issue #19): every trap drawn, to scale, clickable. */
import { expect, test, type Page } from "@playwright/test";
import { clickInScene, collectErrors, drawnPart, open, partAt, partButton, selectPart, setField, settled, shot, type Scheme } from "./helpers";

/** A tweezer inside a linear Paul trap, built the way a user would. */
async function hybrid(page: Page) {
  await page.getByTestId("add-field").click();
  await page.getByTestId("add-paul-linear").click();
  await selectPart(page, "particle");
  await setField(page, "particle-charge", "30");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settled(page);
}

/** px per metre and the scale bar as drawn. */
async function scale(page: Page) {
  // read together, from one frame: during a zoom the next frame may already differ
  return page.evaluate(() => {
    const label = document.querySelector('[data-testid="scene"] [data-testid="scale-bar"]')!;
    const line = document.querySelector('[data-testid="scene"] [data-testid="scale-bar-line"]')!;
    return {
      pxPerMetre: Number(label.getAttribute("data-px-per-metre")),
      text: label.textContent!.replace(/\s+/g, " ").trim(),
      // the bar's drawn length, from its path "M x y v6 h<length> v-6" (a box
      // measured on the page would add the stroke and the corners)
      px: Number(/h([\d.e+-]+)/.exec(line.getAttribute("d")!)![1]),
    };
  });
}

const metres = (text: string) => {
  const [, value, prefix] = /^([\d.]+) ?(n|µ|m|)m$/.exec(text)!;
  return Number(value) * { n: 1e-9, µ: 1e-6, m: 1e-3, "": 1 }[prefix as "n" | "µ" | "m" | ""];
};

const TRAPS: { name: string; preset: string; parts: string[]; build?: (page: Page) => Promise<void> }[] = [
  { name: "tweezer", preset: "tweezer", parts: ["field:0", "lens:0", "particle"] },
  { name: "counter", preset: "counter", parts: ["field:0", "lens:0", "field:1", "lens:1", "particle"] },
  { name: "paul-linear", preset: "paul-linear", parts: ["field:0", "field:1", "particle"] },
  { name: "paul-ring", preset: "paul-ring", parts: ["field:0", "field:1", "particle"] },
  { name: "hybrid", preset: "tweezer", parts: ["field:0", "lens:0", "field:1", "particle"], build: hybrid },
];

for (const scheme of ["light", "dark"] as Scheme[]) {
  test.describe(`${scheme}`, () => {
    test.use({ colorScheme: scheme });
    for (const trap of TRAPS) {
      test(`the ${trap.name} is drawn in 3D`, async ({ page }) => {
        const errors = collectErrors(page);
        await open(page, `preset=${trap.preset}`, "desktop", scheme);
        if (trap.build) await trap.build(page);
        await expect(page.getByTestId("scene")).toHaveAttribute("data-renderer", "webgl");
        for (const id of trap.parts) await expect(drawnPart(page, id)).toHaveCount(1);
        await shot(page, `scene-${trap.name}-desktop-${scheme}`);
        expect(errors).toEqual([]);
      });
    }
  });
}

test("the scale bar tells the truth from the focus to the electrodes", async ({ page }) => {
  await open(page, "preset=tweezer");
  await hybrid(page);
  const seen = new Set<string>();
  const check = async () => {
    const s = await scale(page);
    // the bar is as long as its label says, at the drawn scale
    expect(Math.abs(s.px - metres(s.text) * s.pxPerMetre), JSON.stringify(s)).toBeLessThan(1.5);
    seen.add(s.text.replace(/^[\d.]+ ?/, ""));
    return s;
  };
  const start = await check();
  expect(start.text).toMatch(/mm$/);
  // zoom in at the particle, across three decades
  const at = await partAt(page, "particle");
  await page.mouse.move(at.x, at.y);
  let last = start.pxPerMetre;
  for (let i = 0; i < 6; i += 1) {
    for (let k = 0; k < 5; k += 1) await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await scale(page)).pxPerMetre).toBeGreaterThan(last * 1.5);
    last = (await check()).pxPerMetre;
  }
  expect(last / start.pxPerMetre).toBeGreaterThan(500);
  expect([...seen]).toEqual(expect.arrayContaining(["mm", "µm"]));
  // the zoom is about the pointer: the particle moves away from it only by the
  // pointer's sub-pixel offset from its centre, magnified by the zoom
  const now = await partAt(page, "particle");
  expect(Math.hypot(now.x - at.x, now.y - at.y) / (last / start.pxPerMetre)).toBeLessThan(1);
  await shot(page, "scene-hybrid-zoomed-desktop-light");
  // Fit brings the whole trap back
  await page.getByTestId("view-fit").click();
  await expect.poll(async () => (await scale(page)).pxPerMetre).toBeCloseTo(start.pxPerMetre, 0);
});

test("Fit, Along and Side look at the trap from the three useful places", async ({ page }) => {
  await open(page, "preset=tweezer");
  // along the beam: the lens is in front of the focus
  await page.getByTestId("view-along").click();
  await expect(page.getByTestId("view-along")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => {
      const [a, b] = [await partAt(page, "lens:0"), await partAt(page, "particle")];
      return Math.hypot(a.x - b.x, a.y - b.y);
    })
    .toBeLessThan(2);
  await shot(page, "scene-tweezer-along-desktop-light");
  // from the side: the beam runs left to right, so the lens is level with the particle and to its left
  await page.getByTestId("view-side").click();
  await expect.poll(async () => Math.abs((await partAt(page, "lens:0")).y - (await partAt(page, "particle")).y)).toBeLessThan(2);
  expect((await partAt(page, "lens:0")).x).toBeLessThan((await partAt(page, "particle")).x - 50);
  await shot(page, "scene-tweezer-side-desktop-light");
  // the side view of a linear Paul trap: the rod in front of the centre is drawn faint, so the particle can be clicked
  await open(page, "preset=paul-linear");
  await page.getByTestId("view-side").click();
  await clickInScene(page, "particle");
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", "particle");
  await shot(page, "scene-paul-linear-side-desktop-light");
});

test("a drag turns the view and selects nothing", async ({ page }) => {
  await open(page, "preset=tweezer");
  const before = await partAt(page, "lens:0");
  await page.mouse.move(900, 200);
  await page.mouse.down();
  await page.mouse.move(800, 260, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("inspector")).toHaveCount(0);
  await expect.poll(async () => Math.hypot((await partAt(page, "lens:0")).x - before.x, (await partAt(page, "lens:0")).y - before.y)).toBeGreaterThan(10);
});

test("hover names the thing when the labels are hidden", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("show-menu").click();
  await page.getByTestId("show-labels").click();
  await page.keyboard.press("Escape");
  const at = await partAt(page, "particle");
  await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId("scene-tip")).toHaveText("Particle");
  const lens = await partAt(page, "lens:0");
  await page.mouse.move(lens.x, lens.y);
  await expect(page.getByTestId("scene-tip")).toHaveText("Lens");
});

test("a particle too small to see is enlarged, and the scale toggle draws it to scale", async ({ page }) => {
  await open(page, "preset=paul-linear");
  await expect(partButton(page, "particle")).toContainText("enlarged");
  const toggle = page.getByTestId("scale-toggle");
  await expect(toggle).toHaveText("Not to scale");
  await expect(toggle).toHaveAttribute("title", /particle is enlarged/);
  await toggle.click();
  await expect(toggle).toHaveText("To scale");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(partButton(page, "particle")).not.toContainText("enlarged");
  // the Show menu holds the same switch
  await page.getByTestId("show-menu").click();
  await expect(page.getByTestId("show-to-scale")).toHaveAttribute("aria-checked", "true");
});

test("to scale, the ideal lens's symbol is left out and its label waits at the edge", async ({ page }) => {
  await open(page, "preset=tweezer");
  const toggle = page.getByTestId("scale-toggle");
  await expect(toggle).toHaveText("Not to scale");
  await expect(toggle).toHaveAttribute("title", /lens is a symbol/);
  await expect(partButton(page, "lens:0")).not.toHaveAttribute("data-away", "true");
  await toggle.click();
  await expect(partButton(page, "lens:0")).toHaveAttribute("data-away", "true");
  await shot(page, "scale-to-scale-desktop-light");
  await toggle.click();
  await expect(partButton(page, "lens:0")).not.toHaveAttribute("data-away", "true");
});

test("Play moves the particle in the trap, with a trail, and says how much it is slowed and magnified", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "preset=tweezer");
  const play = page.getByTestId("play-motion");
  await expect(play).toBeEnabled();
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  const note = page.getByTestId("motion-note");
  await expect(note).toContainText("Thermal motion at 300 K, slowed down 150");
  await expect(note).toContainText("magnified");
  await expect(page.getByTestId("scale-toggle")).toHaveAttribute("title", /motion is magnified/);
  // to scale, the motion is the thermal motion itself
  await page.getByTestId("scale-toggle").click();
  await expect(note).not.toContainText("magnified");
  await page.waitForTimeout(3000);
  await shot(page, "motion-desktop-light");
  await play.click();
  await expect(note).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the particle's inspector shows its radiation pattern in the scene", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "preset=tweezer");
  await partButton(page, "particle").click();
  await expect(page.getByTestId("particle-views")).toBeVisible();
  await page.getByTestId("particle-show-pattern").check();
  const note = page.getByTestId("pattern-note");
  await expect(note).toContainText("Radiation pattern: scattered power per solid angle, peak", { timeout: 60_000 });
  // the Show menu holds the same switch
  await page.getByTestId("show-menu").click();
  await expect(page.getByTestId("show-pattern")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await shot(page, "radiation-lobe-desktop-light");
  // and the plots are one click away
  await page.getByTestId("particle-radiation-tab").click();
  await expect(page.getByTestId("tab-radiation")).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("trap axes and force arrows are drawn on request", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "preset=tweezer");
  await hybrid(page);
  await page.getByTestId("show-menu").click();
  await page.getByTestId("show-axes").click();
  await page.getByTestId("show-forces").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("view-side").click();
  const at = await partAt(page, "particle");
  await page.mouse.move(at.x, at.y);
  for (let k = 0; k < 25; k += 1) await page.mouse.wheel(0, -400);
  await page.mouse.move(10, 300);
  await shot(page, "scene-overlays-desktop-light");
  expect(errors).toEqual([]);
});

test("without WebGL the flat drawing stands in, and works", async ({ page }) => {
  await open(page, "preset=tweezer&scene=svg");
  await expect(page.getByTestId("scene")).toHaveAttribute("data-renderer", "svg");
  await page.getByTestId("scene").locator('g[data-part="particle"]').click();
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", "particle");
});
