/** #52: the WS2 bottle-beam dark trap, as an illustrative preset. */
import { expect, test } from "@playwright/test";
import { open, partButton, shot } from "./helpers";

test("the WS2 bottle beam is offered as illustrative, and opens a dark trap", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("file-menu").click();
  await page.getByTestId("open-presets").click();
  await expect(page.getByTestId("preset-ws2-bottle-illustrative")).toContainText("illustrative");
  await expect(page.getByTestId("preset-ws2-bottle-source")).toContainText("Illustrative, not validated: after Illetschek et al., arXiv:2607.09896");
  await shot(page, "presets-ws2-desktop-light");
  await page.getByTestId("preset-ws2-bottle").click();
  await expect(page.getByTestId("presets")).toBeHidden();
  // the recorded result: held above the dark focus
  await expect(page.getByTestId("verdict")).toContainText("Stable trap.");
  await expect(page.getByTestId("verdict")).toContainText("downstream of the focus");
  await expect(partButton(page, "field:1")).toContainText("LG");
  await shot(page, "scene-ws2-desktop-light");
});
