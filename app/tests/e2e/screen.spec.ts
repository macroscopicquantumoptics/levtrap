/** The screen's rules (docs/ARCHITECTURE.md §7, app/DESIGN.md), one test each. */
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoSidewaysScroll, frequencies, open, partButton, selectPart, setField, settled, shot, VIEWS } from "./helpers";

const TWEEZER = ["227 kHz", "285 kHz", "96.8 kHz"];

test("every number explains itself", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("freq-x").click();
  const explain = page.getByTestId("explain");
  await expect(explain).toContainText("Trap frequency along x");
  await expect(explain).toContainText("f = √(k / m) / 2π");
  await expect(explain).toContainText("18.8 µN/m");
  await expect(explain).toContainText("9.22 fg");
  await expect(explain).toContainText("Mie theory (T-matrix): exact for a homogeneous sphere of any size. Valid here.");
  await shot(page, "explain-frequency-desktop-light");
  await page.keyboard.press("Escape");
  await expect(explain).toHaveCount(0);

  await page.getByTestId("depth").click();
  await expect(explain).toContainText("Trap depth");
  await expect(explain).toContainText("116 kK");
});

test("a Paul-trap frequency is explained by a, q and the RF frequency", async ({ page }) => {
  await open(page, "preset=paul-linear");
  await page.getByTestId("freq-y").click();
  const explain = page.getByTestId("explain");
  await expect(explain).toContainText("f = (f_RF / 2) · √(a + q² / 2)");
  await expect(explain).toContainText("0.317");
  await expect(explain).toContainText("5 kHz");
  await expect(explain).toContainText("Pseudopotential approximation of the RF field");
});

test("More shows the numbers behind the headline ones", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("more").click();
  const more = page.getByTestId("more-numbers");
  await expect(more).toContainText("0 · 0 · 216 nm");
  await expect(more).toContainText("18.8 µN/m · 29.5 µN/m · 3.41 µN/m");
  await expect(more).toContainText("296 µW");
  await expect(more).toContainText("Recoil exceeds gas heating below");
  await shot(page, "more-desktop-light");
});

test("the plots drawer opens on demand", async ({ page }) => {
  await open(page, "preset=tweezer");
  await expect(page.getByTestId("drawer")).toHaveCount(0);
  await page.getByTestId("tab-forces").click();
  const plot = page.getByTestId("force-plot");
  await expect(plot).toBeVisible();
  await expect(plot.locator("path[data-axis]")).toHaveCount(3);
  // the hover readout lists every series
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6);
  await expect(page.getByTestId("plot-tooltip")).toContainText("along x");
  await expect(page.getByTestId("plot-tooltip")).toContainText("pN");
  await shot(page, "forces-desktop-light");
  // the same values without hovering: the table
  await page.getByTestId("plot-table-toggle").click();
  await expect(page.getByTestId("plot-table").locator("tbody tr")).toHaveCount(61);

  await page.getByTestId("tab-heating").click();
  await expect(page.getByTestId("heating").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("heating")).toContainText("1e-6 mbar");
  await shot(page, "heating-desktop-light");

  await page.getByTestId("tab-potential").click();
  await expect(page.getByTestId("drawer")).toContainText("Not built yet");
  // the open tab closes the drawer
  await page.getByTestId("tab-potential").click();
  await expect(page.getByTestId("drawer")).toHaveCount(0);
});

test("while a result is computed the old numbers stay, dimmed", async ({ page }) => {
  // hold the engine's answer back for a moment
  await page.route("**/api", async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    await route.continue();
  });
  await open(page, "preset=tweezer");
  await selectPart(page, "field:0");
  await setField(page, "beam0-power", "100 mW");
  const results = page.getByTestId("results");
  await expect(results).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("busy")).toHaveText("Computing");
  expect(await frequencies(page)).toEqual(TWEEZER); // still the 200 mW numbers, never blank
  await expect(page.getByTestId("freq-x").locator("xpath=..")).toBeVisible();
  await shot(page, "recomputing-desktop-light");
  await settled(page);
  expect(await frequencies(page)).toEqual(["161 kHz", "201 kHz", "68.5 kHz"]);
  await expect(page.getByTestId("busy")).toHaveCount(0);
});

test("an unstable trap is a sentence in the strip", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "lens:0");
  await setField(page, "lens0-NA", "0.3");
  await settled(page);
  const verdict = page.getByTestId("verdict");
  await expect(verdict).toContainText("No stable trap: the force along the beam axis (z) never restores the particle.");
  await expect(verdict).toHaveAttribute("data-tone", "bad");
  for (const axis of ["x", "y", "z"]) await expect(page.getByTestId(`freq-${axis}`)).toContainText("—");
  await expect(page.getByTestId("depth")).toContainText("—");
  await shot(page, "unstable-tweezer-desktop-light");
});

test("an invalid setup names the thing to fix", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("add-field").click();
  await page.getByTestId("add-paul-linear").click();
  await settled(page);
  const verdict = page.getByTestId("verdict");
  await expect(verdict).toContainText("Particle: a Paul trap needs a charged particle; set the charge (in elementary charges).");
  await shot(page, "invalid-desktop-light");
  await verdict.getByRole("button", { name: "Show the particle" }).click();
  const inspector = page.getByTestId("inspector");
  await expect(inspector).toHaveAttribute("data-part", "particle");
  await expect(inspector.getByRole("alert")).toContainText("a Paul trap needs a charged particle");
  // with the charge set the setup is valid; a Paul trap with a beam is the next ticket
  await setField(page, "particle-charge", "30");
  await settled(page);
  await expect(verdict).toContainText("Not computed yet: a Paul trap together with a beam.");
  await expect(verdict.getByRole("link", { name: "Issue #12" })).toBeVisible();
});

test("a field takes units as typed and answers mistakes with a sentence", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "field:0");
  const power = page.getByTestId("field-beam0-power");
  await setField(page, "beam0-power", "200 nm");
  await expect(page.getByTestId("inspector").getByRole("alert")).toHaveText("Unknown unit “nm”. Use W, mW or µW.");
  await expect(power).toHaveAttribute("aria-invalid", "true");
  // Esc puts the old value back; nothing was applied
  await power.press("Escape");
  await expect(power).toHaveValue("200");
  await expect(page.getByTestId("undo")).toBeDisabled();
  // the unit selector changes how the value reads, not the value
  await page.getByTestId("unit-beam0-power").selectOption("W");
  await expect(power).toHaveValue("0.2");
  await expect(page.getByTestId("undo")).toBeDisabled();
  expect(await frequencies(page)).toEqual(TWEEZER);
  // a value is applied on leaving the field, too
  await power.fill("150 mW");
  await page.getByTestId("field-beam0-wavelength").focus();
  await settled(page);
  await expect(partButton(page, "field:0")).toContainText("150 mW");
  await expect(page.getByTestId("undo")).toBeEnabled();
});

test("the two descriptions of a focus are the same lens", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "lens:0");
  await page.getByTestId("field-lens0-by").selectOption("angle");
  await expect(page.getByTestId("field-lens0-angle")).toHaveValue("53.1301");
  await settled(page);
  expect(await frequencies(page)).toEqual(TWEEZER);
  await page.getByTestId("field-lens0-by").selectOption("waist");
  await expect(page.getByTestId("field-lens0-waist")).toHaveValue("0.254011");
  await settled(page);
  expect(await frequencies(page)).toEqual(TWEEZER);
});

test("the Advanced fold names what differs from the default", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "field:0");
  const advanced = page.getByTestId("advanced");
  await expect(advanced.locator("summary")).toHaveText("Advanced");
  await expect(page.getByTestId("inspector").locator("input:visible, select:visible")).toHaveCount(5); // 3 inputs, 2 of them with a unit
  await advanced.locator("summary").click();
  await page.getByTestId("field-beam0-mode").selectOption("lg");
  await advanced.locator("summary").click();
  await expect(advanced.locator("summary")).toContainText("LG₀₁");
  await expect(partButton(page, "field:0")).toContainText("LG₀₁");
});

test("no thing shows more than six inputs", async ({ page }) => {
  const count = async () => page.getByTestId("inspector").locator("[data-testid^='field-']:visible").count();
  await open(page, "preset=counter");
  for (const id of ["particle", "field:0", "lens:0", "field:1", "lens:1", "environment"]) {
    await selectPart(page, id);
    expect(await count(), id).toBeLessThanOrEqual(6);
  }
  await open(page, "preset=paul-linear");
  for (const id of ["particle", "field:0", "field:1", "environment"]) {
    await selectPart(page, id);
    expect(await count(), id).toBeLessThanOrEqual(6);
  }
  expect(await count()).toBeGreaterThan(0);
});

test("everything is reachable from the keyboard", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "preset=tweezer");
  // the labels in the drawing are buttons, in reading order
  await partButton(page, "field:0").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", "field:0");
  await page.getByTestId("field-beam0-power").focus();
  await page.keyboard.type(" ");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("120 mW");
  await page.keyboard.press("Enter");
  await settled(page);
  await expect(partButton(page, "field:0")).toContainText("120 mW");
  // Esc leaves the field, then deselects; Ctrl+Z undoes the edit
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inspector")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(partButton(page, "field:0")).toContainText("200 mW");
  expect(await frequencies(page)).toEqual(TWEEZER);
  await page.keyboard.press("Control+Shift+z");
  await expect(partButton(page, "field:0")).toContainText("120 mW");
  expect(errors).toEqual([]);
});

test("Show hides the labels and keeps every part reachable", async ({ page }) => {
  await open(page, "preset=tweezer");
  await expect(page.getByTestId("scene").locator("button[data-part]")).toHaveCount(3);
  await page.getByTestId("show-menu").click();
  await page.getByTestId("show-labels").click();
  await expect(page.getByTestId("scene").locator("button[data-part]")).toHaveCount(0);
  await expect(page.getByTestId("parts").locator("button[data-part]")).toHaveCount(4);
});

test("clicking a thing in the drawing selects it, clicking the table deselects", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("scene").locator('g[data-part="particle"]').click();
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", "particle");
  await page.getByTestId("scene").locator('g[data-part="lens:0"]').click();
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", "lens:0");
  await page.getByTestId("scene").locator("svg").click({ position: { x: 250, y: 610 } }); // the table, below the beam
  await expect(page.getByTestId("inspector")).toHaveCount(0);
});

test.describe("at 375 px", () => {
  test.use({ viewport: VIEWS.phone });

  test("nothing scrolls sideways", async ({ page }) => {
    for (const preset of ["tweezer", "counter", "paul-linear", "paul-ring"]) {
      await open(page, `preset=${preset}`, "phone");
      await expectNoSidewaysScroll(page);
      await selectPart(page, "particle");
      await expectNoSidewaysScroll(page);
      await page.getByTestId("inspector").getByRole("button", { name: "Close settings" }).click();
      await page.getByTestId("more").isEnabled().then(async (enabled) => enabled && page.getByTestId("more").click());
      await page.getByTestId("tab-forces").click();
      await expectNoSidewaysScroll(page);
    }
    await shot(page, "drawer-phone-light");
  });
});
