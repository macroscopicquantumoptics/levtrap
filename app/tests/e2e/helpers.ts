import { expect, type Page } from "@playwright/test";
import { LOCAL_API } from "./ports";

/** The page with the local Python engine behind it (scripts/devserver.py). */
export const local = (query = "") => `./?backend=local&api=${encodeURIComponent(LOCAL_API)}${query ? `&${query}` : ""}`;

export const VIEWS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 375, height: 760 },
} as const;

export type View = keyof typeof VIEWS;
export type Scheme = "light" | "dark";

/**
 * Open the page. A test should start at its size (the config's default is
 * the desktop one; `test.use({ viewport })` for another): resizing a page
 * just before a screenshot races with the browser's compositor.
 */
export async function open(page: Page, query: string, view: View = "desktop", scheme: Scheme = "light") {
  const size = VIEWS[view];
  const now = page.viewportSize();
  if (!now || now.width !== size.width || now.height !== size.height) await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto(local(query));
  await expect(page.getByTestId("screen")).toBeVisible();
  await sceneDrawn(page);
}

/** Wait for the scene: the 3D one has loaded and drawn (or the flat one stands in for good). */
export async function sceneDrawn(page: Page) {
  await expect(page.getByTestId("scene")).toHaveAttribute("data-renderer", /^(webgl|svg)$/, { timeout: 30_000 });
}

/** Where a part is drawn, in page px: the 3D scene lists every part's screen position. */
export async function partAt(page: Page, id: string): Promise<{ x: number; y: number }> {
  const li = page.getByTestId("scene-anchors").locator(`li[data-part="${id}"]`);
  const box = (await page.getByTestId("scene").boundingBox())!;
  return { x: box.x + Number(await li.getAttribute("data-x")), y: box.y + Number(await li.getAttribute("data-y")) };
}

/** Click a part where it is drawn (not on its label). */
export async function clickInScene(page: Page, id: string) {
  const { x, y } = await partAt(page, id);
  await page.mouse.click(x, y);
}

/** The parts drawn in the scene. */
export const drawnPart = (page: Page, id: string) => page.getByTestId("scene-anchors").locator(`li[data-part="${id}"]`);

/**
 * Select a part the way a user would: its label in the drawing on a wide
 * screen, its chip under the results on a narrow one.
 */
export async function selectPart(page: Page, id: string) {
  const label = page.getByTestId("scene").locator(`button[data-part="${id}"]`);
  if (await label.count()) await label.click();
  else await page.getByTestId("parts").locator(`button[data-part="${id}"]`).click();
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", id);
}

/** The label of a part: in the drawing on a wide screen, the chip under the results on a narrow one. */
export function partButton(page: Page, id: string) {
  return page.locator(`[data-testid="scene"] button[data-part="${id}"], [data-testid="parts"] button[data-part="${id}"]`).first();
}

/** Screenshots go to the (untracked) test output; `npm run shots` copies them to design/ for review. */
const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";

/**
 * A screenshot for the design review. The browser can only copy a frame it
 * has painted, so wait for the fonts and then for two frames of the page as
 * it is now; asking earlier fails now and then with "Unable to capture
 * screenshot".
 */
export async function shot(page: Page, name: string) {
  await sceneDrawn(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Type into a field and apply it with Enter. */
export async function setField(page: Page, id: string, text: string) {
  const field = page.getByTestId(`field-${id}`);
  await field.fill(text);
  await field.press("Enter");
}

/** The three frequencies as shown, e.g. ["227 kHz", "285 kHz", "96.8 kHz"]. */
export async function frequencies(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const axis of ["x", "y", "z"]) {
    const text = (await page.getByTestId(`freq-${axis}`).innerText()).replace(/\s+/g, " ");
    out.push(text.replace(/^f ?[xyz] /, ""));
  }
  return out;
}

/** Wait until the strip shows the answer to the current setup. */
export async function settled(page: Page) {
  await expect(page.getByTestId("results")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
}

/** No sideways scroll: the page is exactly as wide as the window. */
export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
