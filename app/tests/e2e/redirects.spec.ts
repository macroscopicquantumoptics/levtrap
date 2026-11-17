/**
 * The old site's addresses lead to the app (E2, issue #24). The redirect
 * pages are written by scripts/redirects.ts into the static export; the Pages
 * workflow writes them, so these run there (and locally after the script).
 */
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { partButton, sceneDrawn } from "./helpers";
import { LOCAL_API } from "./ports";

const local = `?backend=local&api=${encodeURIComponent(LOCAL_API)}`;
test.skip(!existsSync("out/lens.html"), "no redirect pages in this build (node scripts/redirects.ts out <base>)");

test("the lens-tilt page opens the app on the tilted asphere", async ({ page }) => {
  await page.goto(`lens.html${local}`);
  await expect(page.getByTestId("screen")).toBeVisible();
  await sceneDrawn(page);
  await expect(partButton(page, "lens:0")).toContainText("354330-C · 5 mm beam · tilted 1°");
  // the query came along: the local engine answers
  await expect(page.getByTestId("engine-status")).toContainText(/Computed in|Engine ready/, { timeout: 60_000 });
});

test("the preview address of levtrap 2 leads to the main one", async ({ page }) => {
  await page.goto(`next/${local}`);
  await expect(page.getByTestId("screen")).toBeVisible();
  expect(new URL(page.url()).pathname.endsWith("/next/")).toBe(false);
});
