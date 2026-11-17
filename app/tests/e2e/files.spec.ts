/** Presets, save/open and the share link (D6, issue #22). */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { frequencies, local, open, partButton, sceneDrawn, selectPart, setField, settled, shot } from "./helpers";

async function fileMenu(page: Page, item: string) {
  await page.getByTestId("file-menu").click();
  await page.getByTestId(item).click();
}

async function saved(page: Page, item: string) {
  await page.getByTestId("file-menu").click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(item).click()]);
  return { name: file.suggestedFilename(), data: readFileSync((await file.path())!) };
}

/** The tweezer at 120 mW: a setup no preset has. */
async function edited(page: Page) {
  await open(page, "preset=tweezer");
  await selectPart(page, "field:0");
  await setField(page, "beam0-power", "120 mW");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settled(page);
  return frequencies(page);
}

test("save, then open: the identical setup, and the same numbers", async ({ page }) => {
  const numbers = await edited(page);
  const file = await saved(page, "file-save");
  expect(file.name).toBe("levtrap-optical-tweezer-edited.json");
  const setup = JSON.parse(file.data.toString("utf8"));
  expect(setup.trap.fields[0].power).toBe(0.12);

  // somewhere else entirely, then open the file
  await open(page, "preset=paul-ring");
  await page.getByTestId("file-input").setInputFiles({ name: file.name, mimeType: "application/json", buffer: file.data });
  await expect(page.getByTestId("file-opened")).toContainText(`Opened ${file.name}.`);
  await expect(partButton(page, "field:0")).toContainText("120 mW");
  await settled(page);
  expect(await frequencies(page)).toEqual(numbers);
  // opening is an edit: undo goes back to the ring trap
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("setup-name")).toHaveText("Ring Paul trap");
  // and the file saved again is the file opened
  await page.getByTestId("redo").click();
  expect(JSON.parse((await saved(page, "file-save")).data.toString("utf8"))).toEqual(setup);
});

test("a file that is not a setup is refused, and says why", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("file-input").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"version": 1, "particle": {"radius": -1}}') });
  await expect(page.getByTestId("file-refused")).toContainText("notes.json could not be opened: particle.radius must be greater than 0.");
  await expect(page.getByTestId("setup-name")).toHaveText("Optical tweezer");
});

test("share, then load the link: the identical setup, in a fresh browser", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const numbers = await edited(page);
  await fileMenu(page, "file-share");
  await expect(page.getByTestId("link-copied")).toContainText("A link to this setup is on the clipboard");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/#setup=/);
  expect(url).not.toMatch(/preset=/);

  // a colleague's browser: no autosave, never welcomed
  const other = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await other.goto(url);
  await expect(other.getByTestId("screen")).toBeVisible();
  await sceneDrawn(other);
  await expect(other.getByTestId("presets")).not.toBeVisible();
  await expect(partButton(other, "field:0")).toContainText("120 mW");
  await settled(other);
  expect(await frequencies(other)).toEqual(numbers);
  // the setup leaves the address once it has arrived; autosave keeps it from there
  await expect.poll(() => other.evaluate(() => window.location.hash)).toBe("");
  await other.reload();
  await expect(partButton(other, "field:0")).toContainText("120 mW");
});

test("a damaged link opens the default trap and says why", async ({ page }) => {
  await page.goto(`${local("")}#setup=not-a-setup`);
  await expect(page.getByTestId("link-refused")).toContainText("The shared link could not be opened: the link is cut short or damaged.");
  await expect(page.getByTestId("setup-name")).toHaveText("Optical tweezer");
});

test("Copy as Python shows the code for this setup and copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await edited(page);
  await fileMenu(page, "file-python");
  const code = page.getByTestId("python-code");
  await expect(code).toContainText("from levtrap.solve import solve");
  await expect(code).toContainText('"power": 0.12,');
  await expect(code).toContainText("# Optical tweezer · edited:");
  await shot(page, "python-desktop-light");
  await page.getByTestId("python-copy").click();
  await expect(page.getByTestId("python-copy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("result = solve(setup)");
});

test("results export as CSV and JSON, the scene as PNG", async ({ page }) => {
  await open(page, "preset=tweezer");
  const csv = await saved(page, "file-results-csv");
  expect(csv.name).toBe("levtrap-optical-tweezer-results.csv");
  const lines = csv.data.toString("utf8").split("\n");
  expect(lines[0]).toBe("quantity,axis,value,unit,model");
  expect(lines).toContain("trap frequency,x,227499.7,Hz,mie (ok)");
  const json = JSON.parse((await saved(page, "file-results-json")).data.toString("utf8"));
  expect(json.result.modes[2].frequency).toBe(96842.81);
  const png = await saved(page, "file-scene-png");
  expect(png.name).toBe("levtrap-optical-tweezer-scene.png");
  expect(png.data.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(png.data.length).toBeGreaterThan(20_000);
});

test("the picker says where each preset's values come from", async ({ page }) => {
  await open(page, "preset=tweezer");
  await fileMenu(page, "open-presets");
  await expect(page.getByTestId("preset-tweezer-source")).toContainText("Example values, not from a paper yet");
  await expect(page.getByTestId("preset-tweezer-source")).toContainText("to be checked against Jain et al., Phys. Rev. Lett. 116, 243601 (2016)");
  await expect(page.getByTestId("presets-sources").locator("a")).toHaveCount(4);
  await shot(page, "presets-sources-desktop-light");
});
