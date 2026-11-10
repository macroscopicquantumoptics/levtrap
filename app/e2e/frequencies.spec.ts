import { test, expect } from "@playwright/test";

const SHOTS = process.env.SCREENSHOT_DIR ?? "screenshots";

for (const theme of ["light", "dark"] as const) {
  for (const [label, viewport] of [
    ["desktop", { width: 1280, height: 800 }],
    ["mobile", { width: 375, height: 760 }],
  ] as const) {
    test(`default setup shows three frequencies (${theme}, ${label})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      await page.goto("/next/?backend=local");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      for (const axis of ["x", "y", "z"]) {
        const tile = page.getByTestId(`freq-${axis}`);
        await expect(tile).toContainText(/\d/);
        await expect(tile).toContainText("kHz");
      }
      await expect(page.getByTestId("verdict")).toContainText("Stable trap");

      // No sideways scroll at phone width.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);

      await page.screenshot({ path: `${SHOTS}/a3-${label}-${theme}.png`, fullPage: true });
    });
  }
}

test("theme toggle switches and remembers the theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/next/?backend=local");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("static assets resolve under the sub-path", async ({ request }) => {
  expect((await request.get("/next/engine/worker.js")).ok()).toBe(true);
});
