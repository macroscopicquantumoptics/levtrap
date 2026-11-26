/**
 * The share link where the clipboard is refused (#74): an embedded browser
 * pane or an iframe without the permission. The link (600 to 900 characters
 * with no place to break) is shown in a read-only field with a Copy button,
 * under the scene; it must never widen the screen, and nothing afterwards
 * (a tab, an inspector) may scroll the screen sideways.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, open, selectPart, shot, VIEWS, type Scheme, type View } from "./helpers";

/** A browser that refuses the clipboard: the API rejects, and copying a selection does nothing. */
async function denyClipboard(page: Page) {
  await page.addInitScript(() => {
    const refuse = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: refuse, readText: refuse, write: refuse, read: refuse } });
    document.execCommand = () => false;
  });
}

/** The screen has not moved sideways, and the page is as wide as the window. */
async function stillInPlace(page: Page) {
  await expectNoSidewaysScroll(page);
  expect(await page.getByTestId("screen").evaluate((el) => el.scrollLeft)).toBe(0);
}

async function share(page: Page) {
  await page.getByTestId("file-menu").click();
  await page.getByTestId("file-share").click();
}

for (const [view, scheme] of [
  ["desktop", "light"],
  ["desktop", "dark"],
  ["phone", "light"],
] as [View, Scheme][]) {
  test.describe(`${view}, ${scheme}`, () => {
    test.use({ viewport: VIEWS[view], colorScheme: scheme });

    test("without the clipboard the link is shown in a field, and the screen never moves sideways", async ({ page }) => {
      await denyClipboard(page);
      await open(page, "preset=tweezer", view, scheme);
      await share(page);

      const notice = page.getByTestId("link-shown");
      await expect(notice).toContainText("The clipboard is not available here");
      const field = page.getByTestId("link-field");
      await expect(field).toHaveValue(/#setup=/);
      await stillInPlace(page);

      // under the scene, so it covers none of the scene's labels
      const sceneBox = (await page.getByTestId("scene").boundingBox())!;
      const noticeBox = (await notice.boundingBox())!;
      expect(noticeBox.y).toBeGreaterThanOrEqual(sceneBox.y + sceneBox.height - 1);
      expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(VIEWS[view].width);

      // focus selects the whole link, ready to copy by hand
      await field.focus();
      const value = await field.inputValue();
      expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, value.length]);
      await stillInPlace(page);

      // Copy cannot reach the clipboard either: it says how to copy the selected link
      await page.getByTestId("link-copy").click();
      await expect(page.getByTestId("link-by-hand")).toContainText("The link is selected");
      await stillInPlace(page);

      // a neutral notice: it is not an error, and it waits until dismissed
      await page.waitForTimeout(4500);
      await expect(notice).toBeVisible();
      await shot(page, `share-notice-${view}-${scheme}`);

      // what scrolled the screen sideways before: a tab, and an inspector
      await page.getByTestId("tab-wavefront").click();
      await stillInPlace(page);
      await selectPart(page, "field:0");
      await stillInPlace(page);

      await notice.getByRole("button", { name: "Dismiss" }).click();
      await expect(notice).toHaveCount(0);
      await stillInPlace(page);
    });
  });
}
