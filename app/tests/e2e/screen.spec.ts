/** The screen's rules (docs/ARCHITECTURE.md §7, app/DESIGN.md), one test each. */
import { expect, test } from "@playwright/test";
import { clickInScene, collectErrors, expectNoSidewaysScroll, frequencies, local, open, partButton, selectPart, setField, settled, shot, VIEWS } from "./helpers";

const TWEEZER = ["227 kHz", "285 kHz", "96.8 kHz"];

test("every number explains itself", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("freq-x").click();
  const explain = page.getByTestId("explain");
  await expect(explain).toContainText("Trap frequency along x");
  // the formula, typeset (KaTeX), with its plain-text form for screen readers
  const formula = page.getByTestId("formula");
  await expect(formula).toHaveAttribute("data-formula", "optical-frequency");
  await expect(formula.locator(".katex-display")).toBeVisible();
  await expect(formula.locator("[aria-label]").first()).toHaveAttribute("aria-label", "f = √(k / m) / 2π");
  await expect(explain).toContainText("18.8 µN/m");
  await expect(explain).toContainText("9.22 fg");
  await expect(explain).toContainText("Mie theory (T-matrix): exact for a homogeneous sphere of any size. Valid here.");
  await shot(page, "explain-frequency-desktop-light");
  await page.keyboard.press("Escape");
  await expect(explain).toHaveCount(0);

  // the depth, in k_BT and in kelvin
  await expect(page.getByTestId("depth-also")).toHaveText("116 kK");
  await page.getByTestId("depth").click();
  await expect(explain).toContainText("Trap depth");
  await expect(explain).toContainText("116 kK");
});

test("Copy puts the full SI value on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "preset=tweezer");
  await page.getByTestId("freq-z").click();
  await page.getByTestId("copy-value").click();
  await expect(page.getByTestId("copy-value")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("96842.81 Hz");
});

test("the numbers of the second row explain themselves too", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("more").click();
  await page.getByTestId("more-absorbed").click();
  const explain = page.getByTestId("explain");
  await expect(explain).toContainText("Absorbed power");
  await expect(explain).toContainText("14.2 aW");
  await expect(page.getByTestId("formula")).toHaveAttribute("data-formula", "absorbed-power");
  await page.keyboard.press("Escape");
  await page.getByTestId("more-damping").click();
  await expect(page.getByTestId("formula")).toHaveAttribute("data-formula", "gas-damping");
  await expect(explain).toContainText("Beresnev, Chernyak & Fomyagin");
  await expect(explain).toContainText("Knudsen-number interpolation");
  await shot(page, "explain-damping-desktop-light");
});

test("a Paul-trap frequency is explained by a, q and the RF frequency", async ({ page }) => {
  await open(page, "preset=paul-linear");
  await page.getByTestId("freq-y").click();
  const explain = page.getByTestId("explain");
  await expect(page.getByTestId("formula")).toHaveAttribute("data-formula", "paul-pseudopotential");
  await expect(page.getByTestId("formula")).toContainText("Leibfried et al.");
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
  const plot = page.getByTestId("plot-forces");
  await expect(plot).toBeVisible();
  await expect(plot.locator("path[data-series]")).toHaveCount(3);
  // the hover readout lists every series
  const box = (await page.getByTestId("plot-forces-chart").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6);
  await expect(page.getByTestId("plot-tooltip")).toContainText("along x");
  await expect(page.getByTestId("plot-tooltip")).toContainText("pN");
  await shot(page, "forces-desktop-light");
  // the same values without hovering: the table, one row per sample and series
  await page.getByTestId("plot-forces-table-toggle").click();
  await expect(page.getByTestId("plot-forces-table").locator("tbody tr")).toHaveCount(3 * 61);
  // the open tab closes the drawer
  await page.getByTestId("tab-forces").click();
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
  // along which axis, and the usual cause with what to change
  await expect(verdict).toContainText("No stable trap along z: the force along the beam never pulls the particle back.");
  await expect(page.getByTestId("verdict-hint")).toContainText("focus tighter (a larger NA), or add a counter-propagating beam");
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
  await setField(page, "particle-charge", "30");
  await settled(page);
  // with a charge the setup is valid: a tweezer inside a Paul trap (B3), held by the light
  await expect(verdict).toContainText("Stable trap.");
  await expect(verdict).toContainText("Mathieu q = 0.32 on x and y.");
  await expect(page.getByTestId("freq-x")).toContainText("kHz");
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

test("NA, waist and half-angle are one focus", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "lens:0");
  await expect(page.getByTestId("field-lens0-NA")).toHaveValue("0.8");
  await expect(page.getByTestId("field-lens0-waist")).toHaveValue("0.254011");
  // the waist typed back is the same lens: the same numbers
  await setField(page, "lens0-waist", "0.254011 µm");
  await settled(page);
  expect(await frequencies(page)).toEqual(TWEEZER);
  await expect(page.getByTestId("field-lens0-NA")).toHaveValue("0.8");
  // a wider waist: a smaller NA, a softer trap
  await setField(page, "lens0-waist", "0.3 µm");
  await expect(page.getByTestId("field-lens0-NA")).not.toHaveValue("0.8");
  await settled(page);
  expect(await frequencies(page)).not.toEqual(TWEEZER);
  await page.getByTestId("advanced").locator("summary").click();
  await setField(page, "lens0-angle", "53.1301");
  await expect(page.getByTestId("field-lens0-NA")).toHaveValue("0.8");
  await settled(page);
  expect(await frequencies(page)).toEqual(TWEEZER);
});

test("a radius edit changes the frequencies and undo brings both back", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "particle");
  await setField(page, "particle-radius", "150 nm");
  await settled(page);
  const bigger = await frequencies(page);
  expect(bigger).not.toEqual(TWEEZER);
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("field-particle-radius")).toHaveValue("100");
  await settled(page);
  expect(await frequencies(page)).toEqual(TWEEZER);
  await page.getByTestId("redo").click();
  await expect(page.getByTestId("field-particle-radius")).toHaveValue("150");
  await settled(page);
  expect(await frequencies(page)).toEqual(bigger);
});

test("diameter and mass are the radius, said differently", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "particle");
  // the material's values and their source, before any result
  await expect(page.getByTestId("inspector")).toContainText("n = 1.450");
  await expect(page.getByTestId("inspector")).toContainText("Source:");
  await page.getByTestId("advanced").locator("summary").click();
  await expect(page.getByTestId("field-particle-diameter")).toHaveValue("200");
  await expect(page.getByTestId("field-particle-mass")).toHaveValue("9.21534");
  await setField(page, "particle-diameter", "300 nm");
  await expect(page.getByTestId("field-particle-radius")).toHaveValue("150");
  await setField(page, "particle-mass", "9.21534 fg");
  await expect(page.getByTestId("field-particle-radius")).toHaveValue("100");
});

test("the setup being edited survives a reload", async ({ page }) => {
  await open(page, "preset=tweezer");
  await selectPart(page, "field:0");
  await setField(page, "beam0-power", "120 mW");
  await settled(page);
  const edited = await frequencies(page);
  await page.goto(local());
  await expect(page.getByTestId("screen")).toBeVisible();
  await expect(page.getByTestId("presets")).not.toBeVisible();
  await expect(partButton(page, "field:0")).toContainText("120 mW");
  await settled(page);
  expect(await frequencies(page)).toEqual(edited);
});

test("a saved setup that no longer validates is not opened, and the screen says why", async ({ page }) => {
  await page.addInitScript(() => {
    const setup = { version: 1, particle: { radius: -1e-7, material: "SiO2" }, trap: { fields: [{ kind: "gravity" }] } };
    window.localStorage.setItem("levtrap.setup", JSON.stringify({ format: 1, setup, preset: "tweezer" }));
  });
  await open(page, "");
  const notice = page.getByTestId("autosave-refused");
  await expect(notice).toContainText("Your last setup could not be opened: particle.radius must be greater than 0.");
  await expect(partButton(page, "field:0")).toContainText("200 mW");
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
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
  // the particle sits inside the light: the click goes to the particle
  await clickInScene(page, "particle");
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", "particle");
  await clickInScene(page, "lens:0");
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", "lens:0");
  await clickInScene(page, "field:0");
  await expect(page.getByTestId("inspector")).toHaveAttribute("data-part", "field:0");
  await page.mouse.click(250, 160); // the table, above the beam
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
