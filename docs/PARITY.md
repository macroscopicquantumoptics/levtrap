# Retiring `web/`: the parity checklist (E2, issue #24)

Every capability of the old site (`web/index.html`, the trap simulator, and
`web/lens.html`, the lens-tilt page) against the new screen (`app/`). Each
row is one of:

* **In the app**: where it is, and the pull request that built it (merged,
  or still open).
* **Dropped**: on purpose, with the reason.
* **To ticket**: worth having, not built; an issue to open.
* **Decision**: the issue asks a human to decide.

`web/` is deleted only after this list is approved (issue #24, acceptance).
Until then the old site stays online at `/classic/`.

Open pull requests this list counts on: D5, the plots drawer
([#41](https://github.com/macroscopicquantumoptics/levtrap/pull/41)), and E1,
the asphere ([#43](https://github.com/macroscopicquantumoptics/levtrap/pull/43)).
This one should merge after both.

## The trap simulator (`web/index.html`)

### Inputs

| Old | Status | Where, or why |
|---|---|---|
| Preset: silica 1064 nm, NA 0.9 | In the app | Preset "Optical tweezer" (NA 0.8). NA 0.9 is one edit away. |
| Preset: silica 1550 nm | In the app | The same preset with the wavelength changed; not a preset of its own. |
| Preset: WS₂ bottle-beam dark trap (illustrative, not validated) | **Decision** | The setup can be built (two coherent LG beams, circular, phase π), but it is not a preset. Proposal: add it when C3 verifies a dark-trap reference, not before. |
| Material, radius, n, k, density | In the app | Particle; n, k, density under Advanced, following the material (D2). |
| Medium index | In the app | Environment, Advanced. |
| Wavelength, total power | In the app | Beam: wavelength and power per beam. |
| Mode family and indices | In the app | Beam, Advanced. |
| Polarisation (x, y, circular, Jones) | In the app | Beam. |
| NA or waist | In the app | Lens: NA and waist linked, half-angle under Advanced (D2). |
| Second coherent beam, relative phase | In the app | Add field → beam, "Interferes with", phase (D1). |
| Component ratio P₂/P₁ | Dropped | Each beam has its own power. |
| Dark-focus auto power split | **Decision** | A helper, not an input. Proposal: drop; it could return as an action on a pair of interfering beams ("make the focus dark"). |
| Multipole switches (ED, MD, EQ, MQ, n ≥ 3) | **Decision** | Teaching toggles; they make the physics wrong on purpose. Proposal: drop from the app; the engine keeps the option (`api._tmatrix(..., multipoles=…)`) for scripts. |
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
| Plot: force map over the beam intensity (xz) | **To ticket** | "Intensity slice" is in the Show menu, greyed. The engine has `api.field3d`; the scene needs the overlay. |
| Plot: multipole contributions at z | **Decision** | Goes with the multipole switches (above). Proposal: drop. |
| 3D view: intensity volume, cut planes, glow, log brightness, force arrows, particle | In the app, in part | The scene is always 3D (D3); force arrows and trap axes are Show options. The intensity volume is the same ticket as the intensity slice. |
| Sweep of radius, wavelength or power | In the app | Plots → Sweep, any numeric input (D5, #41). |
| Sweep outputs: frequencies, z_eq, depth, scattered power | In the app | Plots → Sweep (D5). |
| Sweep outputs: recoil ratio, absorbed power, multipole fractions | **To ticket** | More outputs for the Sweep (recoil and absorbed power; the multipoles go with the decision above). |
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
| Particle shift relative to the aligned lens | **To ticket** | The app shows where the particle is; the shift needs a second solve with the lens aligned. A "compare with aligned" action. |
| Beam pointing, back focal distance, Strehl ratio | In the app, in part | Pointing is in the trap-axis explanation; the back focal length is in the Result; the Strehl estimate is not shown (drop: the wavefront error is the number). |
| 3D view: tilted lens, traced rays, magnified focus | In the app, in part | The real lens at true size and distance, tilted, and the light to the traced focus (E1, #43). **To ticket**: the individual rays. |
| Wavefront-error map across the lens | **To ticket** | The engine has it (`lens_trap` → `wavefront`); a plot in the drawer. |
| Sweep of tilt, diameter, decentre, power, with continuation and "jump" flags | **To ticket** | The Sweep covers any input once E1 and D5 are both in, but it does not follow one equilibrium from value to value (continuation) or flag jumps. |
| "Model and limitations" text | In the app | The lens explanation names the model and source (E1); `src/levtrap/lens.py` documents the rest. |

## Outside `web/`

| Old | Status | Where, or why |
|---|---|---|
| Paper reproduction, arXiv:2607.09896 (`examples/paper_2607_09896.py`, `docs/paper/`) | **Decision** | It is Python, not part of the site, and it uses the old `api.presets()` and `api.compute`. Proposal: keep it as a Python example, moved onto `levtrap.solve` when the old API goes. |
| `api.compute`, `api.sweep`, `api.presets`, `api.handle` (the old site's engine entry) | Goes with `web/` | Called only by `web/`, `scripts/ui_check.js`, `scripts/pyodide_check.mjs`, `tests/test_api.py` and the paper example. Deleted with `web/` once nothing calls them (the checks move to `solve`). `api._single_beam`, `_tmatrix`, `build_beam`, `lens_trap` and `asphere_focus` stay: `solve` and the lens tests use them. |
| Plotly (from the CDN) | Goes with `web/` | The app draws its plots itself (D5). |

## What deleting `web/` takes, once approved

1. Delete `web/`, `scripts/ui_check.js` and the old site's checks in
   `pages.yml`; move `scripts/pyodide_check.mjs` onto `solve_json`.
2. Delete `api.compute`, `api.sweep`, `api.presets`, `api.handle`,
   `api.analyse`, `api.sweep_point` and their tests; port
   `tests/test_solve.py`'s comparison with `api.analyse` to the recorded
   OTT benchmark it already checks; move the paper example onto `solve`.
3. Stop serving `/classic/`.
