# levtrap: the screen

Status: **prototype for review** (issue #17, D1). The layout, the look and
the wording below are proposals until a human approves them. D2 to D6 build
on what is approved; section 12 lists the decisions that are open.

The prototype is clickable and runs on the real engine. Try it with
`npm run dev` (see the README), or look at the screenshots in
[`design/screens/`](design/screens/): section 13 says what each one shows.

![The tweezer preset: the trap drawn, its parts labelled, the answer at the bottom](design/screens/w1-2-answer-desktop-light.webp)

## 1. The idea

One screen. The trap is drawn; you click the thing you want to change; the
answer stays at the bottom and follows every change.

| Region | What it holds |
|---|---|
| **Scene** | The trap, drawn from the setup. Fills the screen. |
| **Islands** | Small groups of controls floating over the scene: file menu and name (top left), undo · show · redo (top centre), help and theme (top right), "Add field" and the environment (bottom left). |
| **Inspector** | The inputs of the selected thing. Shown only while something is selected. |
| **Results strip** | Three frequencies, the depth and the verdict. Always visible. |
| **Plots drawer** | One tab per plot, under the strip. Closed until a tab is clicked. |

The strip and the drawer form the **dock**. The dock sits under the scene and
never covers it: when the drawer opens, the scene gets shorter and is drawn
again to fit.

## 2. Vocabulary

The words of `docs/ARCHITECTURE.md` §2, used the same way everywhere (code,
labels, tests): **setup**, **particle**, **trap**, **field**, **beam**,
**environment**, **result**, **model**, **preset**.

The screen adds four:

| Term | Meaning | Avoid |
|---|---|---|
| **Part** | A thing that can be selected: the particle, a beam, a lens, a Paul trap, gravity, the environment. | object, element, component |
| **Lens** | The focusing optic of one beam. A part of its own, although the setup stores it inside the beam (`focus`). | objective, optic |
| **Label** | The pill beside a part with its name and its key values. | tag, chip |
| **Verdict** | The sentence in the strip that says whether the trap holds. | status, message |

## 3. The rules, and how the prototype keeps them

These are the rules of `docs/ARCHITECTURE.md` §7. Each has a test in
`tests/e2e/`.

| Rule | In the prototype |
|---|---|
| **Start from a preset, never from an empty form.** | A first visit opens the tweezer with its numbers on screen, and the preset picker over it. Every field added later arrives with working values. |
| **At most six inputs per selected thing.** | The largest inspector (the Paul trap) has six. Everything else is in one Advanced fold. Its summary names what differs from the default ("LG₀₁", "axial factor 0.3"), so a closed fold hides nothing that matters. |
| **The strip is always visible and always current.** | The strip is outside the scene, so nothing covers it. While a new result is computed the old numbers are dimmed, not removed. |
| **Every number explains itself.** | Click a number: its formula, the values that went in, the model and its validity, and a Copy button. There is no glossary page. |
| **Fields take units as typed.** | `200 mW`, `0.2 W`, `1e-6 mbar`. Enter or leaving the field applies; Esc puts the old value back. The unit selector changes how the value reads, not the value. A mistake is answered with a sentence under the field. |
| **Warnings are sentences in the strip.** | "No stable trap: outside the first Mathieu stability region along x, y." No banners, no pop-ups. |
| **Plots are inline SVG in the theme's colours.** | The Forces tab. No Plotly. |
| **Undo and redo, light and dark.** | One step per edit; Ctrl Z and Ctrl Shift Z. Autosave and the share link are D2 and D6. |

Three more rules came out of building it:

* **Every number on screen comes from the engine.** A preset shows the
  result the engine recorded for it; anything else is computed. For a setup
  the engine cannot compute yet, the strip shows no numbers and says why,
  with the issue that will change it. Nothing is made up.
* **An invalid setup names the thing to fix.** "Particle: a Paul trap needs
  a charged particle…" with a "Show the particle" button that selects it.
* **Nothing is reachable by the mouse only.** Every part has a label that is
  a button; the drawing itself is decoration for a screen reader.

## 4. The scene

The scene is drawn from the setup, one drawing per kind of field, in SVG.
It stands in for the three.js scene of D3 (see decision 1 in section 12).

* **View.** z, the axis of the first beam, runs to the right; y is up; x
  recedes up and to the right at half length. The axes in the corner say so.
* **To scale:** the particle, the beam's waist and its cone angle, the
  electrodes of a Paul trap, and the particle's position (the computed
  equilibrium: in the tweezer it sits 216 nm downstream of the focus, and
  the drawing shows it). The scale bar is a round length and changes with
  the view.
* **Not to scale:** the distance from a lens to its focus (the lens is a
  symbol, placed where it fits), and a particle that would be smaller than
  4.5 px. Such a particle is drawn larger inside a dotted ring, and its
  label says "enlarged".
* **Two scales.** A trap with light only is drawn at the scale of the focus
  (micrometres). A trap with electrodes is drawn at their scale
  (millimetres). A smooth zoom between the two is D3.
* **Labels.** Every part has a label with its name and the values worth
  seeing without a click: "Beam 1064 nm · 200 mW", "Lens NA 0.8",
  "Particle SiO₂ · 100 nm". So the setup can be read off the drawing.
  A label and the drawn thing both select the part.
* **Selecting.** The selected part gets a blue outline and its label turns
  blue. Clicking the table deselects, and so does Esc.
* **Narrow screens.** There is no room for labels, so the parts become a row
  of buttons under the results.

## 5. The inspector: what each thing shows

"Visible" inputs are the ones a lab changes between one experiment and the
next. The reason each one is visible is in the last column.

**Particle**

| Input | Where | Why visible |
|---|---|---|
| Material | visible | It fixes n, k and density; most users know the material, not the index. The values it gives are shown under it. |
| Radius | visible | The quantity every frequency and rate depends on most strongly. |
| Charge | visible when the trap has a Paul field or the charge is not zero; otherwise Advanced | A Paul trap does nothing without it; a tweezer does not use it. |
| n, k, density | Advanced; editable when Material is Custom | They follow the material. |

**Beam**

| Input | Where | Why visible |
|---|---|---|
| Power | visible | The knob turned most often. |
| Wavelength | visible | A lab names its laser by wavelength and power. |
| Polarisation | visible | It is why f_x and f_y differ. |
| Direction | visible on a second beam | "Against beam 1" or "with beam 1": the difference between a counter-propagating trap and a superposition. |
| Interferes with | visible when there is another beam | Whether the forces add or the fields do (a standing wave). |
| Phase | visible when the beam interferes with another | Only then does it mean anything. |
| Mode (Gaussian, LG, HG) and its indices; focus position x, y, z | Advanced | Most traps use a Gaussian beam focused at the origin. |

**Lens**

| Input | Where | Why visible |
|---|---|---|
| Type | visible | Ideal lens today; the asphere (E1) and the parabolic mirror (E3) appear here. |
| Focus given by | visible | NA, half-angle or waist: three descriptions of one focus. Switching converts the value. |
| NA (or half-angle, or waist) | visible | It sets the trap's geometry, and with it every frequency. |

**Paul trap**

| Input | Where | Why visible |
|---|---|---|
| Geometry | visible | Linear or ring: two different traps. |
| RF voltage, RF frequency | visible | They set q, and so whether the trap is stable. |
| Radius r₀, half-length z₀ | visible | The size of the trap; q goes as 1/r₀². |
| End-cap voltage | visible for a linear trap | It makes the axial confinement. A ring trap does not use it. |
| DC voltage, geometry factors | Advanced | Zero and one for an ideal trap. |

**Gravity:** Direction visible (down, along the beam, against the beam: how
the trap stands in the lab). The acceleration is Advanced.

**Environment:** Pressure, gas and temperature visible (they set the damping
and heating rates, and the depth in k_BT). The medium index is Advanced: it
is 1 in vacuum.

## 6. The results strip

| State | What the strip shows |
|---|---|
| Stable | Numbers, a green dot, "Stable trap." and where the particle rests. For a Paul trap also the largest Mathieu q. |
| Not stable | A red diamond and the engine's sentence. An axis without a restoring force shows a dash. |
| Recomputing | The previous numbers, dimmed, and "Computing" on the right. |
| Engine starting | The same, with "Starting the engine 35%". A preset's numbers are on screen before the engine is ready. |
| Not computed yet | Dashes, an empty ring, the reason, and a link to the issue. |
| Invalid setup | Dashes, the reason in the engine's words, and a button that selects the part to fix. |
| Engine failed | The reason. |

Numbers have three significant figures and an SI prefix ("96.8 kHz").
Each frequency carries a short line in its axis colour; the text itself
stays in the text colour. **More** opens the numbers behind the headline
ones: position, stiffness, mass, scattered power, gas damping, reheating,
and for a Paul trap q, a and the micromotion amplitude.

The line at the right of the tabs says where the numbers came from:
"Recorded from the engine for this preset" or "Computed in 240 ms".

## 7. The plots drawer

| Tab | In the prototype |
|---|---|
| Forces | Real. The force along x, y and z through the equilibrium; hover or arrow keys read the values; the Table button lists them. |
| Heating | Real, as a table: the rates the engine returns. The plot against pressure is D5. |
| Potential, Sweep, Radiation | One sentence saying what the tab will show, and its issue. |

## 8. Tokens

All colours, sizes and fonts are CSS variables in `src/app/globals.css`;
components use nothing else. Light and dark are two sets of values, switched
by `data-theme` on `<html>`. The palette is the one A3 gave levtrap, extended
for the scene.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--scene` | `#e9ecf1` | `#090c11` | the table the trap is drawn on |
| `--surface`, `--island` | `#ffffff` | `#151a22` | islands, inspector, dock |
| `--surface-2` | `#eceef2` | `#1c222c` | hover, field units, table heads |
| `--border` | `#d5d9e0` | `#2b3340` | hairlines |
| `--text`, `--text-muted`, `--text-faint` | `#171a21`, `#5a6170`, `#8a92a0` | `#e6e8ee`, `#98a0b0`, `#6b7484` | text; never a data colour |
| `--accent` | `#c42a3b` | `#ff5c6c` | the wordmark |
| `--light` | `#d0303f` | `#ff4d5e` | laser light in the scene (infrared; a visible wavelength takes its own colour) |
| `--glass` | `#5fa8c4` | `#6fc3e0` | lenses |
| `--metal`, `--metal-rf` | `#aeb6c2`, `#7fb8c8` | `#4a5361`, `#2f6f86` | electrodes; the two rod pairs |
| `--particle` | `#6d28d9` | `#a78bfa` | the particle |
| `--select` | `#2563eb` | `#60a5fa` | selection, focus ring, links |
| `--ok`, `--warn`, `--danger` | `#15803d`, `#b45309`, `#b91c1c` | `#4ade80`, `#fbbf24`, `#f87171` | the verdict; always with a shape and a sentence |
| `--axis-x`, `--axis-y`, `--axis-z` | `#eb6834`, `#1baf7a`, `#2a78d6` | `#d95926`, `#199e70`, `#3987e5` | the three axes: scene axes, strip, plots |

The three axis colours were checked as a set, against both surfaces, for
colour-blind separation (worst pair ΔE 9.2 light, 9.4 dark, target 8),
normal-vision separation (24.0 and 20.9, floor 15) and contrast. The green
is below 3:1 on white, so it never carries meaning alone: every series is
also named in text, and the plot has a table.

Type: IBM Plex Sans for text, JetBrains Mono for values typed or read as
data (fields, labels, tables). Sizes: 12 to 13 px for controls, 15 px for
text, 23 px for the headline numbers. Controls are 32 px high, 38 px on a
touch screen. Islands have a 12 px radius and one shadow.

## 9. Copy

* **A label is a few words.** "Power", "RF frequency", "Interferes with".
  No colon, no unit in the label: the unit is in the field.
* **A note is one sentence.** It says what the reader needs to do or know,
  nothing else.
* **Sentence case** everywhere. No exclamation marks.
* **Say what is, not what went wrong inside.** "Not computed yet: Paul traps
  together with a beam." Not "UnsupportedSetup".
* **The engine's sentences are shown as they are.** The screen adds the name
  of the part in front, and nothing else.
* **Numbers:** three significant figures, SI prefix, a real minus sign, a
  thin "·" between values of a triple.
* **Names:** parts are named by kind and numbered only when there are two
  ("Beam", then "Beam 1" and "Beam 2").

## 10. Where every input of the old site goes

`web/index.html` (trap simulator):

| Old input | Now | Note |
|---|---|---|
| Preset | visible: preset picker | On a first visit and in the file menu. |
| Material | visible: Particle | |
| Radius | visible: Particle | |
| n, k, density | Advanced: Particle | Follow the material. |
| Medium index | Advanced: Environment | |
| Wavelength | visible: Beam | Per beam now. |
| Total power | visible: Beam, as Power | Each beam has its own power. |
| Mode family, mode indices | Advanced: Beam | |
| Polarisation | visible: Beam | |
| Focus given by; NA or waist | visible: Lens | |
| Add a second, coherent beam | visible: Add field, then Beam: Interferes with | A beam is a field like any other. |
| Component ratio P₂/P₁ | removed | Replaced by each beam's own power. |
| Relative phase | visible when beams interfere: Beam | |
| Auto power split for a dark focus | removed | A helper, not an input. Decision 6. |
| Multipole switches (ED, MD, EQ, MQ, n ≥ 3) | removed | Unphysical switches for teaching. Decision 6. |
| Overlay dipole approximation | Plots drawer: Forces (D5) | A plot option, not part of the setup. |
| z range, x and y range, points per line | removed | The engine chooses the scan; the plot gets a Fit button (D5). |
| Temperature | visible: Environment | |
| Draw the optical axis horizontal or vertical | removed | z is horizontal; gravity's direction says how the trap stands. |
| 3D view: build, intensity or gradient, three cut planes, glow, contrast, log brightness, show particle, force arrows, reset | Show menu (D3): intensity slice, force arrows, trap axes | The scene is always there; nothing to build. The sliders go. |
| Sweep: vary, from, to, steps, show, run, cancel | Plots drawer: Sweep (D5) | |
| "Start here" panel, "What am I looking at?" notes, glossary | removed | Every number explains itself; the help is three lines. |

`web/lens.html` (lens tilt), all in E1:

| Old input | Now |
|---|---|
| Tilt about x, tilt about y, decentre x | visible: Lens, when its type is the asphere |
| Pivot point | Advanced: Lens |
| Beam diameter | visible: Lens (asphere) |
| Wavelength, power, polarisation | visible: Beam |
| Particle inputs, temperature | Particle, Environment |
| Sweep | Plots drawer: Sweep |

Old outputs: z_eq is in the verdict and under More; f_x, f_y, f_z and the
depth are the strip; scattered power and mass are under More; the recoil
ratio became the Heating tab; Q_sca, Q_abs, absorbed power and N_max move
into the explanations (D4). The force curves are the Forces tab; the force
map becomes an overlay of the scene (D3); the multipole bars wait for
decision 6.

New inputs with no old counterpart: charge, pressure, gas, the Paul trap,
gravity, a beam's direction and focus position.

## 11. What the prototype is not

* The scene is an SVG drawing with a fixed view. D3 replaces it.
* The store has undo and redo but no autosave and no file load (D2).
* The unit-aware fields are a small local version. D2 ports the ones from
  QUOP, with linked pairs for radius, diameter and mass.
* Formulas are plain text. D4 typesets them.
* Presets are example values. `docs/validation/references.md` has no
  verified paper yet (C3), so no preset names one. D6 replaces them.
* The file menu's four file actions and three overlays in the Show menu are
  listed, greyed, with their issue.

## 12. Decisions for a human

1. **The scene: a drawing or a free 3D view?** The prototype draws the trap
   in one fixed view, like an optics diagram. It reads at a glance and
   everything is clickable. D3 plans three.js. Options: (a) keep a fixed
   drawn view as the default and add 3D as a second view; (b) 3D only.
2. **Labels as the navigation.** Every part is named in the drawing, with
   its key values. The alternative is a list of parts in a side panel. The
   labels keep the screen to one place to look.
3. **The lens is its own part.** Its inputs (NA today; tilt, decentre and
   beam diameter with E1) are not mixed with the beam's.
4. **A first visit opens the picker over a working tweezer.** The
   alternative is no picker until asked for.
5. **Pressure reads in mbar** (the setup stores Pa). Pa and Torr are in the
   unit selector.
6. **Teaching switches and the dark-focus helper are gone from the screen.**
   E2 asks for a human decision on the multipole switches. The dark-focus
   power split could come back as an action on a pair of interfering beams.
7. **Example presets.** Is it right to ship presets marked "Example values,
   not from a paper yet" until C3 has verified entries? The Paul presets
   use 30 elementary charges so that the linear trap of ARCHITECTURE §4
   (300 V, 5 kHz, r₀ 1 mm) is stable with q = 0.32.
8. **The look.** Colours, type and density as in the screenshots.

## 13. The screenshots

`npm run test:e2e` photographs the walkthroughs; `npm run shots` copies them
here as lossless WebP. Names end in the view and the theme.

| File | Shows |
|---|---|
| `w1-1-first-visit-*` | Task 1, "what are my trap frequencies at 200 mW?": a first visit, the picker over the tweezer. |
| `w1-2-answer-*` | The answer without a click: the beam's label says 200 mW, the strip gives the frequencies. |
| `w1-3-beam-selected-*` | The beam selected, its three inputs. |
| `w1-4-power-changed-*` | 100 mW typed with its unit; the strip has followed. |
| `w2-1-add-field-*` | Task 2, "add a counter-propagating beam": the Add field menu. |
| `w2-2-beam-added-*` | The second beam and its lens, selected. The engine cannot compute it yet (issue #10): no numbers, and the strip says why. |
| `w3-1-presets-*` | Task 3, "is my Paul trap stable at 5 kHz?": the picker, opened from the file menu. |
| `w3-2-answer-*` | The linear Paul trap at 5 kHz: "Stable trap. Mathieu q = 0.32 on x and y." |
| `w3-3-unstable-*` | At 2.5 kHz: not stable, in the engine's words. |
| `explain-frequency-*` | A number explaining itself. |
| `more-*` | The numbers behind the headline ones. |
| `forces-*`, `heating-*` | The two real tabs of the drawer. |
| `recomputing-*` | A result on its way: the old numbers stay, dimmed. |
| `unstable-tweezer-*` | A tweezer at NA 0.3: no stable trap. |
| `invalid-*` | A Paul trap added to a neutral particle: the setup is invalid and the strip names the part to fix. |
| `drawer-phone-*` | The drawer at 375 px. |

## 14. What this was built without

The ticket asks to read `BUILDER.md` and `DESIGN.md` of QUOP
(`kakitkelvinho/quop`) for the patterns. That repository was not readable
from the session that built this, so the patterns were taken from their
description in `docs/ARCHITECTURE.md` §7: islands, an inspector only for the
selection, progressive disclosure, snapshot undo. Someone who knows QUOP
should check the prototype against it.
