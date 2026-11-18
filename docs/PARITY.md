# Retiring `web/`: the parity checklist (E2, issue #24)

Every capability of the old site (`web/index.html`, the trap simulator, and
`web/lens.html`, the lens-tilt page) against the new screen (`app/`). Each
row is one of:

* **In the app**: where it is, and the pull request that built it (merged,
  or still open).
* **Dropped**: on purpose, with the reason.
* **To ticket**: worth having, not built; an issue to open.
* **Decided**: the issue asked a human to decide; the decision is recorded.

**Approved** by the maintainer on 2026-11-18, with the four proposals
accepted as written (issue #24's acceptance). `web/` and the old site's
engine entry points are deleted; its addresses (`/next/`, `/classic/`,
`lens.html`) redirect to the app. The rows to ticket are issues
[#48](https://github.com/macroscopicquantumoptics/levtrap/issues/48), [#49](https://github.com/macroscopicquantumoptics/levtrap/issues/49), [#50](https://github.com/macroscopicquantumoptics/levtrap/issues/50) and [#51](https://github.com/macroscopicquantumoptics/levtrap/issues/51); the WS₂ preset waits on
[#52](https://github.com/macroscopicquantumoptics/levtrap/issues/52).

The pull requests this list counts on are merged: D5, the plots drawer
([#41](https://github.com/macroscopicquantumoptics/levtrap/pull/41)), and E1,
the asphere ([#43](https://github.com/macroscopicquantumoptics/levtrap/pull/43)).
Since then the app has also gained what the old site never had: the parabolic
mirror (E3, [#45](https://github.com/macroscopicquantumoptics/levtrap/pull/45))
and the displacement spectrum with feedback cooling (E4,
[#46](https://github.com/macroscopicquantumoptics/levtrap/pull/46)).

## The trap simulator (`web/index.html`)

### Inputs

| Old | Status | Where, or why |
|---|---|---|
| Preset: silica 1064 nm, NA 0.9 | In the app | Preset "Optical tweezer" (NA 0.8). NA 0.9 is one edit away. |
| Preset: silica 1550 nm | In the app | The same preset with the wavelength changed; not a preset of its own. |
| Preset: WS₂ bottle-beam dark trap (illustrative, not validated) | **Decided** | Not a preset yet: added when C3 verifies a dark-trap reference ([#52](https://github.com/macroscopicquantumoptics/levtrap/issues/52)). The setup can be built in the app (two coherent LG beams, circular, phase π). |
| Material, radius, n, k, density | In the app | Particle; n, k, density under Advanced, following the material (D2). |
| Medium index | In the app | Environment, Advanced. |
| Wavelength, total power | In the app | Beam: wavelength and power per beam. |
| Mode family and indices | In the app | Beam, Advanced. |
| Polarisation (x, y, circular, Jones) | In the app | Beam. |
| NA or waist | In the app | Lens: NA and waist linked, half-angle under Advanced (D2). |
| Second coherent beam, relative phase | In the app | Add field → beam, "Interferes with", phase (D1). |
| Component ratio P₂/P₁ | Dropped | Each beam has its own power. |
| Dark-focus auto power split | **Decided: dropped** | A helper, not an input; it could return as an action on a pair of interfering beams ("make the focus dark"). The paper example computes its split itself. |
| Multipole switches (ED, MD, EQ, MQ, n ≥ 3) | **Decided: dropped** | Teaching toggles; they make the physics wrong on purpose. The engine keeps the option for scripts (`api.build_tmatrix(s, {"multipoles": …})`; the paper example uses it for Fig. S1). |
| Dipole-approximation overlay | In the app | Plots → Forces → "Dipole approximation" (D5, #41). |
| z range, x/y range, points per line | Dropped | The engine chooses the scan; plots zoom and Fit (D5). |
| Temperature | In the app | Environment. |
| Optical axis drawn horizontal or vertical | Dropped | The 3D view turns freely (Fit, Along, Side; D3). |

### Outputs

| Old | Status | Where, or why |
|---|---|---|
| z_eq | In the app | The verdict ("rests 216 nm downstream of the focus") and More → Position (D1, D4). |
| f_x, f_y, f_z and stiffness | In the app | The strip; stiffness under More; each explains itself (D4). |
| Trap depth | In the app | The strip, in k_BT and K (D4). |
| Q_sca, Q_abs (plane wave), size parameter | In the app | In the explanations of scattered and absorbed power (D4). |
| Scattered and absorbed power at z_eq | In the app | More (D4). |
| Γ/Ω (recoil heating over trap frequency) | In the app | Plots → Heating, as phonons/s and the oscillations before one phonon (D1, D5). |
| Mass | In the app | More (D4). |
| N_max of beam and particle | Dropped | A convergence detail; it stays in the Result (`optical.Nmax`) and the results JSON (D6). |
| Plot: force through the trap along x, y, z | In the app | Plots → Forces, along the eigen-axes (D5, #41). |
| Plot: force map over the beam intensity (xz) | **To ticket: [#48](https://github.com/macroscopicquantumoptics/levtrap/issues/48)** | "Intensity slice" is in the Show menu, greyed. The engine has `api.field3d`; the scene needs the overlay. |
| Plot: multipole contributions at z | **Decided: dropped** | Goes with the multipole switches (above). |
| 3D view: intensity volume, cut planes, glow, log brightness, force arrows, particle | In the app, in part | The scene is always 3D (D3); force arrows and trap axes are Show options. The intensity volume is the same ticket as the intensity slice. |
| Sweep of radius, wavelength or power | In the app | Plots → Sweep, any numeric input (D5, #41). |
| Sweep outputs: frequencies, z_eq, depth, scattered power | In the app | Plots → Sweep (D5). |
| Sweep outputs: recoil ratio, absorbed power, multipole fractions | **To ticket: [#50](https://github.com/macroscopicquantumoptics/levtrap/issues/50)** | More outputs for the Sweep (recoil and absorbed power; the multipoles were dropped above). |
| Sweep: unstable values greyed | In the app | Shaded "no stable trap" (D5). |
| Summary tiles with ⓘ help, "What am I looking at?" notes, glossary, "Start here" | Dropped | Every number explains itself, with formula, inputs and model (D4); the help is three lines. |
| Loader with stages and progress | In the app | "Starting the engine 35%" in the strip, engine status line (D1). |
| Light/dark theme | In the app | Top bar (D1). |
| Versions (levtrap, Pyodide, commit) | In the app | Help popover and the engine status line's title (D1). |
| `?preset=` and `?backend=local` | In the app | The same parameters (D1). |

## The lens-tilt page (`web/lens.html`)

| Old | Status | Where, or why |
|---|---|---|
| Lens 354330-C, beam diameter, tilt about x and y, decentre x | In the app | Lens → Asphere 354330-C (E1, #43); decentre y too. |
| Tilt pivot (S1, centre, S2) | Dropped | The lens tilts about its centre (the old default). The engine's `lens.trace` keeps the option. |
| Wavelength, power, polarisation, particle, temperature | In the app | Beam, Particle, Environment. |
| Focus shift, transmitted fraction, wavefront error, trap-axis tilt | In the app | Lens inspector and More, each explained (E1, #43). |
| Trap frequencies, depth, scattered power, recoil ratio | In the app | The strip, More, Heating. |
| Particle shift relative to the aligned lens | **To ticket: [#51](https://github.com/macroscopicquantumoptics/levtrap/issues/51)** | The app shows where the particle is; the shift needs a second solve with the lens aligned. A "compare with aligned" action. |
| Beam pointing, back focal distance, Strehl ratio | In the app, in part | Pointing is in the trap-axis explanation; the back focal length is in the Result; the Strehl estimate is not shown (drop: the wavefront error is the number). |
| 3D view: tilted lens, traced rays, magnified focus | In the app, in part | The real lens at true size and distance, tilted, and the light to the traced focus (E1, #43). **To ticket: [#49](https://github.com/macroscopicquantumoptics/levtrap/issues/49)**: the individual rays. |
| Wavefront-error map across the lens | **To ticket: [#49](https://github.com/macroscopicquantumoptics/levtrap/issues/49)** | The engine has it (`lens_trap` → `wavefront`); a plot in the drawer. |
| Sweep of tilt, diameter, decentre, power, with continuation and "jump" flags | **To ticket: [#50](https://github.com/macroscopicquantumoptics/levtrap/issues/50)** | The Sweep covers the beam diameter, the tilts and the power of a real lens (E1 and D5, merged), but it does not follow one equilibrium from value to value (continuation) or flag jumps. |
| "Model and limitations" text | In the app | The lens explanation names the model and source (E1); `src/levtrap/lens.py` documents the rest. |

## Outside `web/`

| Old | Status | Where, or why |
|---|---|---|
| Paper reproduction, arXiv:2607.09896 (`examples/paper_2607_09896.py`, `docs/paper/`) | **Decided: kept** | A Python example, now on `levtrap.solve` (E2); it reproduces the old numbers (stable window 292–305 nm, z_eq and frequencies to 1e-5); the depths are 7–25 % larger because `solve` follows each mode to its barrier rather than stopping at a fixed scan. |
| `api.compute`, `api.sweep`, `api.presets` (the old site's engine entry) | Deleted with `web/` | With `api.analyse`, `sweep_point` and the old presets. The Pyodide check now runs `solve`; `tests/test_solve.py` keeps `analyse`'s numbers for the default setup, recorded before it went. `api._single_beam`, `_tmatrix`, `build_beam`, `build_tmatrix`, `field3d` (for [#48](https://github.com/macroscopicquantumoptics/levtrap/issues/48)), `lens_trap` and `asphere_focus` stay. |
| Plotly (from the CDN) | Deleted with `web/` | The app draws its plots itself (D5). |

## Done (E2, part 2)

1. Deleted `web/` (with Plotly) and `scripts/ui_check.js`; `pages.yml`
   deploys the app alone and checks the wheel in Pyodide through `solve`.
2. Deleted `api.compute`, `api.sweep`, `api.presets`, `api.analyse` and
   `api.sweep_point` and the dark-focus option; `api.handle` keeps `solve`,
   `field3d`, `lens_trap`, `lens_sweep`, `materials` and `benchmark`.
   `tests/test_solve.py` compares `solve` with `analyse`'s recorded
   numbers; the paper example runs on `solve`.
3. `/classic/` redirects to the app, as `/next/` and `lens.html` do.
