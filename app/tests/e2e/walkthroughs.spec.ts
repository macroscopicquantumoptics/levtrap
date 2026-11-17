/**
 * D1: three tasks a first-time user should manage without a tutorial, each
 * as a script. Their screenshots are what the design review looks at: every
 * step on a desktop in light, and the key frames in dark and at 375 px
 * (`npm run shots` copies them to design/screens/).
 */
import { expect, test } from "@playwright/test";
import { drawnPart, expectNoSidewaysScroll, frequencies, local, open, partButton, selectPart, setField, settled, shot, VIEWS, type Scheme, type View } from "./helpers";

interface Variant {
  name: string;
  view: View;
  scheme: Scheme;
  /** every step is photographed; otherwise only the key frames */
  all: boolean;
}

const VARIANTS: Variant[] = [
  { name: "desktop-light", view: "desktop", scheme: "light", all: true },
  { name: "desktop-dark", view: "desktop", scheme: "dark", all: false },
  { name: "phone-light", view: "phone", scheme: "light", all: false },
  { name: "phone-dark", view: "phone", scheme: "dark", all: false },
];

const TWEEZER = ["227 kHz", "285 kHz", "96.8 kHz"];
const COUNTER = ["329 kHz", "412 kHz", "139 kHz"];

for (const v of VARIANTS) {
  const frame = async (page: Parameters<typeof shot>[0], name: string, key = false) => {
    if (v.all || key) await shot(page, `${name}-${v.name}`);
  };

  test.describe(v.name, () => {
    // the page starts at its size and theme: nothing is resized during a test
    test.use({ viewport: VIEWS[v.view], colorScheme: v.scheme });

    test("what are my trap frequencies at 200 mW?", async ({ page }) => {
      // a first visit: a working tweezer with its numbers, and the choice of trap over it
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(local());
      await expect(page.getByTestId("presets")).toBeVisible();
      await expect(page.getByTestId("preset-tweezer")).toContainText("open now");
      await frame(page, "w1-1-first-visit", true);

      await page.getByTestId("preset-tweezer").click();
      await expect(page.getByTestId("presets")).toBeHidden();

      // the answer needs no click: the beam says 200 mW and the strip gives the frequencies
      await expect(partButton(page, "field:0")).toContainText("200 mW");
      expect(await frequencies(page)).toEqual(TWEEZER);
      await expect(page.getByTestId("verdict")).toContainText("Stable trap.");
      await expectNoSidewaysScroll(page);
      await frame(page, "w1-2-answer", true);

      // to change the power: click the beam
      await selectPart(page, "field:0");
      await expect(page.getByTestId("field-beam0-power")).toHaveValue("200");
      await expect(page.getByTestId("unit-beam0-power")).toHaveValue("mW");
      await frame(page, "w1-3-beam-selected", v.view === "phone");

      await setField(page, "beam0-power", "100 mW");
      await settled(page);
      expect(await frequencies(page)).toEqual(["161 kHz", "201 kHz", "68.5 kHz"]);
      await expect(page.getByTestId("engine-status")).toContainText("Computed in");
      await frame(page, "w1-4-power-changed");

      // units as typed: 0.2 W is the 200 mW we started from, and the field keeps the unit
      await setField(page, "beam0-power", "0.2 W");
      await settled(page);
      expect(await frequencies(page)).toEqual(TWEEZER);
      await expect(page.getByTestId("field-beam0-power")).toHaveValue("0.2");
      await expect(page.getByTestId("unit-beam0-power")).toHaveValue("W");
    });

    test("add a counter-propagating beam", async ({ page }) => {
      await open(page, "preset=tweezer", v.view, v.scheme);
      await page.getByTestId("add-field").click();
      await expect(page.getByTestId("add-counter-beam")).toBeVisible();
      await frame(page, "w2-1-add-field");

      // the new beam arrives with working values, selected, its inputs open
      await page.getByTestId("add-counter-beam").click();
      const inspector = page.getByTestId("inspector");
      await expect(inspector).toHaveAttribute("data-part", "field:1");
      await expect(inspector).toContainText("Beam 2");
      await expect(page.getByTestId("field-beam1-direction")).toHaveValue("against");
      await expect(page.getByTestId("field-beam1-power")).toHaveValue("200");
      await expect(drawnPart(page, "lens:1")).toHaveCount(1);

      // the scattering forces cancel: the particle moves back to the focus, and the trap is stiffer
      const verdict = page.getByTestId("verdict");
      await expect(verdict).toContainText("Stable trap. The particle rests at the focus.");
      expect(await frequencies(page)).toEqual(COUNTER);
      await expectNoSidewaysScroll(page);
      await frame(page, "w2-2-beam-added", true);

      // make them interfere: a standing wave, much stiffer along the beams
      await page.getByTestId("field-beam1-coherent").selectOption("0");
      await settled(page);
      await expect(page.getByTestId("engine-status")).toContainText("Computed in");
      await expect(verdict).toContainText("Stable trap. The particle rests at the focus.");
      // along the beams 1.06 MHz, against 139 kHz without interference
      expect(await frequencies(page)).toEqual(["519 kHz", "568 kHz", "1.06 MHz"]);
      await frame(page, "w2-3-standing-wave");

      // undo takes the interference away, a second undo the beam
      await page.getByTestId("undo").click();
      expect(await frequencies(page)).toEqual(COUNTER);
      await page.getByTestId("undo").click();
      await expect(inspector).toHaveCount(0);
      expect(await frequencies(page)).toEqual(TWEEZER);
      await page.getByTestId("redo").click();
      await expect(drawnPart(page, "field:1")).toHaveCount(1);
      expect(await frequencies(page)).toEqual(COUNTER);
    });

    test("is my Paul trap stable at 5 kHz?", async ({ page }) => {
      await open(page, "preset=tweezer", v.view, v.scheme);
      await page.getByTestId("file-menu").click();
      await page.getByTestId("open-presets").click();
      await expect(page.getByTestId("presets")).toBeVisible();
      await frame(page, "w3-1-presets");

      await page.getByTestId("preset-paul-linear").click();
      await expect(page.getByTestId("presets")).toBeHidden();

      // the answer is on screen: the trap runs at 5 kHz and the verdict is a sentence
      await expect(partButton(page, "field:0")).toContainText("5 kHz");
      const verdict = page.getByTestId("verdict");
      await expect(verdict).toContainText("Stable trap. Mathieu q = 0.32 on x and y. The particle rests 804 nm below the trap centre.");
      expect(await frequencies(page)).toEqual(["556 Hz", "556 Hz", "99.5 Hz"]);
      await expectNoSidewaysScroll(page);
      await frame(page, "w3-2-answer", true);

      // and at half the RF frequency it is not
      await selectPart(page, "field:0");
      await expect(page.getByTestId("field-paul0-rf_frequency")).toHaveValue("5");
      await expect(page.getByTestId("unit-paul0-rf_frequency")).toHaveValue("kHz");
      await setField(page, "paul0-rf_frequency", "2.5 kHz");
      await settled(page);
      await expect(verdict).toContainText("No stable trap along x and y: outside the first Mathieu stability region.");
      await expect(verdict).toHaveAttribute("data-tone", "bad");
      await expect(page.getByTestId("freq-x")).toContainText("—");
      await expect(page.getByTestId("freq-z")).toContainText("99.5 Hz");
      await frame(page, "w3-3-unstable", true);

      await setField(page, "paul0-rf_frequency", "5 kHz");
      await settled(page);
      await expect(verdict).toContainText("Stable trap. Mathieu q = 0.32 on x and y.");
    });
  });
}
