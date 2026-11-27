/** #52: the WS2 bottle-beam dark trap, as an illustrative preset. */
import { expect, test } from "@playwright/test";
import { open, partButton, settled, shot } from "./helpers";

test("the WS2 bottle beam is offered as illustrative, and opens a dark trap", async ({ page }) => {
  await open(page, "preset=tweezer");
  await page.getByTestId("file-menu").click();
  await page.getByTestId("open-presets").click();
  await expect(page.getByTestId("preset-ws2-bottle-illustrative")).toContainText("illustrative");
  await expect(page.getByTestId("preset-ws2-bottle-source")).toContainText("Illustrative, not validated: after Illetschek et al., arXiv:2607.09896");
  await shot(page, "presets-ws2-desktop-light");
  await page.getByTestId("preset-ws2-bottle").click();
  await expect(page.getByTestId("presets")).toBeHidden();
  // the recorded result: held above the dark focus by the force, but its circular polarisation spirals it out in vacuum (#101)
  await expect(page.getByTestId("verdict")).toContainText("Stable without the curl, but at this pressure the particle spirals out");
  await expect(page.getByTestId("verdict")).toContainText("downstream of the focus");
  await expect(partButton(page, "field:1")).toContainText("LG");
  await shot(page, "scene-ws2-desktop-light");
});

test("the WS2 dark trap scatters mostly into the magnetic quadrupole, shown under More (#80)", async ({ page }) => {
  await open(page, "preset=ws2-bottle");
  await settled(page);
  await page.getByTestId("more").click();
  const row = page.getByTestId("more-multipoles");
  await expect(page.getByTestId("more-numbers")).toContainText("Scattered by multipole");
  await expect(row).toHaveText(/^MQ 6\d\.\d % · MD 2\d\.\d % · EQ 1\d\.\d %$/);
  await row.click();
  await expect(page.getByTestId("formula")).toHaveAttribute("data-formula", "multipole-power");
  await expect(page.getByTestId("explain")).toContainText("Scattered power by multipole");
  await expect(page.getByTestId("explain")).toContainText("magnetic quadrupole; 32.7 % for a plane wave on the same sphere");
  await shot(page, "multipoles-ws2-desktop-light");
});

test("the multipole shares in the dark scheme (#80)", async ({ page }) => {
  await open(page, "preset=ws2-bottle", "desktop", "dark");
  await settled(page);
  await page.getByTestId("more").click();
  await page.getByTestId("more-multipoles").click();
  await expect(page.getByTestId("explain")).toContainText("Scattered power by multipole");
  await shot(page, "multipoles-ws2-desktop-dark");
});

test("a small silica sphere in the tweezer is an electric dipole (#80)", async ({ page }) => {
  await open(page, "preset=tweezer");
  await settled(page);
  await page.getByTestId("more").click();
  await expect(page.getByTestId("more-multipoles")).toHaveText(/^ED 99\.\d %/);
});
