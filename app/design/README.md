# The prototype, in pictures

The screenshots of the D1 review (issue #17), in the order of the three
walkthroughs. The rules and reasons are in [`../DESIGN.md`](../DESIGN.md).
`npm run test:e2e` takes the pictures; `npm run shots` copies them here.

## 1. "What are my trap frequencies at 200 mW?"

A first visit: a working tweezer with its numbers, and the choice of trap
over it.

![First visit](screens/w1-1-first-visit-desktop-light.webp)

The answer needs no click. The beam's label says 200 mW and the strip gives
the three frequencies, the depth and the verdict.

![The tweezer](screens/w1-2-answer-desktop-light.webp)

![The tweezer, dark](screens/w1-2-answer-desktop-dark.webp)

To change the power, click the beam. Its inspector has three inputs; the
rest is under Advanced.

![The beam selected](screens/w1-3-beam-selected-desktop-light.webp)

`100 mW` typed, with its unit. The strip has followed: every frequency is
lower by √2.

![100 mW](screens/w1-4-power-changed-desktop-light.webp)

While the engine computes, the old numbers stay, dimmed.

![Recomputing](screens/recomputing-desktop-light.webp)

At 375 px: first visit, the answer, and the beam selected (the inspector is
a sheet under the results).

<img width="250" alt="First visit, phone" src="screens/w1-1-first-visit-phone-light.webp"> <img width="250" alt="The tweezer, phone" src="screens/w1-2-answer-phone-light.webp"> <img width="250" alt="The beam selected, phone" src="screens/w1-3-beam-selected-phone-light.webp">

<img width="250" alt="First visit, phone, dark" src="screens/w1-1-first-visit-phone-dark.webp"> <img width="250" alt="The tweezer, phone, dark" src="screens/w1-2-answer-phone-dark.webp"> <img width="250" alt="The beam selected, phone, dark" src="screens/w1-3-beam-selected-phone-dark.webp">

## 2. "Add a counter-propagating beam"

Add field, bottom left.

![The Add field menu](screens/w2-1-add-field-desktop-light.webp)

The second beam and its lens arrive with working values, selected. The
scattering forces of the two beams cancel: the particle moves back to the
focus, and the trap is stiffer (329, 412, 139 kHz against 227, 285, 96.8).

![The beam added](screens/w2-2-beam-added-desktop-light.webp)

![The beam added, dark](screens/w2-2-beam-added-desktop-dark.webp)

<img width="250" alt="The beam added, phone" src="screens/w2-2-beam-added-phone-light.webp"> <img width="250" alt="The beam added, phone, dark" src="screens/w2-2-beam-added-phone-dark.webp">

"Interferes with: Beam 1" makes a standing wave: the trap along the beams
goes from 139 kHz to 1.06 MHz.

![The standing wave](screens/w2-3-standing-wave-desktop-light.webp)

## 3. "Is my Paul trap stable at 5 kHz?"

The picker, opened from the file menu.

![The preset picker](screens/w3-1-presets-desktop-light.webp)

The linear Paul trap at 5 kHz. The verdict is a sentence, with the largest
Mathieu q.

![Stable at 5 kHz](screens/w3-2-answer-desktop-light.webp)

![Stable at 5 kHz, dark](screens/w3-2-answer-desktop-dark.webp)

The trap selected, and 2.5 kHz typed: not stable, in the engine's words.
The axes without a trap frequency show a dash.

![Not stable at 2.5 kHz](screens/w3-3-unstable-desktop-light.webp)

![Not stable at 2.5 kHz, dark](screens/w3-3-unstable-desktop-dark.webp)

<img width="250" alt="Stable, phone" src="screens/w3-2-answer-phone-light.webp"> <img width="250" alt="Stable, phone, dark" src="screens/w3-2-answer-phone-dark.webp"> <img width="250" alt="Not stable, phone" src="screens/w3-3-unstable-phone-light.webp"> <img width="250" alt="Not stable, phone, dark" src="screens/w3-3-unstable-phone-dark.webp">

## 4. The scene in 3D (D3)

Every trap is drawn to scale, in 3D, with an orthographic camera, so the
scale bar is true everywhere in the picture. The tweezer, the counter-propagating
pair, the linear and the ring Paul trap:

![Tweezer](screens/scene-tweezer-desktop-light.webp)

![Counter-propagating](screens/scene-counter-desktop-light.webp)

![Linear Paul trap](screens/scene-paul-linear-desktop-light.webp)

![Ring Paul trap](screens/scene-paul-ring-desktop-light.webp)

A tweezer inside a linear Paul trap: the electrodes set the scale (mm) and
the focus is a point in it.

![Hybrid](screens/scene-hybrid-desktop-light.webp)

The wheel zooms about the pointer, from the electrodes down to the focus,
and the scale bar follows. Zoomed in this far the electrodes are drawn
faint.

![Hybrid, zoomed to the focus](screens/scene-hybrid-zoomed-desktop-light.webp)

Show → Trap axes and Force arrows: the eigen-axes through the equilibrium,
and the force of the light and of the Paul trap on the particle (log length).

![Overlays](screens/scene-overlays-desktop-light.webp)

Along and Side. From the side of a linear trap the rod in front of the
centre is drawn faint, and clicks pass through it.

![Along the beam](screens/scene-tweezer-along-desktop-light.webp) ![From the side](screens/scene-tweezer-side-desktop-light.webp)

![Linear Paul trap from the side](screens/scene-paul-linear-side-desktop-light.webp)

Dark:

![Tweezer, dark](screens/scene-tweezer-desktop-dark.webp)

![Counter-propagating, dark](screens/scene-counter-desktop-dark.webp)

![Linear Paul trap, dark](screens/scene-paul-linear-desktop-dark.webp)

![Ring Paul trap, dark](screens/scene-paul-ring-desktop-dark.webp)

![Hybrid, dark](screens/scene-hybrid-desktop-dark.webp)

## 5. The plots drawer (D5)

Forces along each eigen-axis, and with the dipole approximation dashed.

![Forces](screens/plot-forces-desktop-light.webp)

![Forces with the dipole approximation](screens/plot-forces-dipole-desktop-light.webp)

The potential in k_BT, with the harmonic trap of the same stiffness dashed.

![Potential](screens/plot-potential-desktop-light.webp)

A sweep of the beam's power: four solves, the three frequencies.

![Sweep](screens/plot-sweep-desktop-light.webp)

Where the scattered light goes, and how much a lens of each NA collects.

![Radiation](screens/plot-radiation-desktop-light.webp)

![Collection](screens/plot-collection-desktop-light.webp)

Reheating against pressure: the setup's pressure marked, a dot where recoil
and gas heat equally.

![Heating](screens/plot-heating-desktop-light.webp)

The displacement spectrum (E4): a peak per mode, each marked with its
effective temperature; and, with 10 Hz of feedback linewidth, each mode's
occupation.

![Spectrum](screens/plot-spectrum-desktop-light.webp)

![Occupation with feedback](screens/spectrum-table-desktop-light.webp)

Dark:

![Forces, dark](screens/plot-forces-desktop-dark.webp)

![Potential, dark](screens/plot-potential-desktop-dark.webp)

![Sweep, dark](screens/plot-sweep-desktop-dark.webp)

![Radiation, dark](screens/plot-radiation-desktop-dark.webp)

![Heating, dark](screens/plot-heating-desktop-dark.webp)

At 375 px:

<img width="250" alt="Potential, phone" src="screens/plot-potential-phone-light.webp"> <img width="250" alt="Radiation, phone" src="screens/plot-radiation-phone-light.webp">

## 6. Presets, files and links (D6)

The picker says where each preset's values come from: example values for
now, and the paper each will be checked against (C3).

![Preset sources](screens/presets-sources-desktop-light.webp)

File → Copy as Python: the code that computes the same numbers.

![Copy as Python](screens/python-desktop-light.webp)

## 7. A real lens (E1)

The lens set to the ray-traced Thorlabs 354330-C, tilted 0.3° about y: the
inspector says what the lens does to the focus.

![The asphere, tilted](screens/asphere-inspector-desktop-light.webp)

Zoomed out to millimetres: the lens at its true size and distance, the light
converging from its back surface to the focus.

![The asphere in the scene](screens/asphere-scene-desktop-light.webp)

## 8. A parabolic mirror (E3)

The lens set to a deep parabolic mirror (f 3 mm, 18 mm across, a 0.5 mm
hole), filled by a 10 mm beam: the inspector says how much light reaches the
focus and from which angles.

![The parabolic mirror](screens/mirror-inspector-desktop-light.webp)

Zoomed out to millimetres from the side: the paraboloid about the focus, its
rim 3.75 mm above it.

![The mirror in the scene](screens/mirror-scene-desktop-light.webp)

## 9. An illustrative preset: the WS₂ bottle beam (#52)

The picker's fifth card, tagged "illustrative": not validated, after
arXiv:2607.09896, with the power split that darkens the focus.

![The WS₂ card](screens/presets-ws2-desktop-light.webp)

Opened: two coherent LG beams, the sphere held 237 nm above the dark focus.

![The WS₂ bottle beam](screens/scene-ws2-desktop-light.webp)

## Other states

A number explaining itself: the formula, the values that went in, the model
and its validity.

![A frequency explained](screens/explain-frequency-desktop-light.webp)

More: the numbers behind the headline ones.

![More](screens/more-desktop-light.webp)

The Forces tab, with the hover readout.

![Forces](screens/forces-desktop-light.webp)

A tweezer at NA 0.3: no stable trap.

![No stable trap](screens/unstable-tweezer-desktop-light.webp)

A Paul trap added to a neutral particle: the setup is invalid, and the strip
names the part to fix.

![An invalid setup](screens/invalid-desktop-light.webp)

The drawer at 375 px.

<img width="250" alt="The drawer, phone" src="screens/drawer-phone-light.webp">
