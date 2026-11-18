# levtrap

**Optical forces on a sphere, in your browser.** levtrap calculates the
force a focused laser beam exerts on a dielectric (or weakly absorbing)
sphere in vacuum, air or liquid. It finds where the particle is trapped,
the trap frequencies, the trap depth, how much light is scattered and
absorbed, and the photon-recoil heating. It is aimed at levitated
optomechanics.

The physics is a Python/NumPy port of a subset of the
[Optical Tweezers Toolbox v1](https://github.com/ilent2/ott) (OTT): the Mie
T-matrix, point-matched focused Gaussian, LG and HG beams, and the
closed-form force/torque expressions. The same package runs in the browser
through [Pyodide](https://pyodide.org) and locally for research scripts.

* **Website:** <https://macroscopicquantumoptics.github.io/levtrap/> (after the Pages workflow has run)
* **Validation:** the OTT test values are reproduced: the `testExamples.m`
  sphere benchmark (z_eq = 4.0234748e-7 m, k_z, k_x), the Gaussian/LG₀₃/HG₂₃
  force curves, and the force/torque, T-matrix, translation and rotation
  tests. Analytic checks cover an independent Bohren & Huffman Mie code,
  energy conservation via a volume integral of the internal field, the
  dipole limit, power scaling, symmetry and convergence. See `tests/` and
  the progress log in `PLAN.md`.
* **Optical, Paul and hybrid traps on one screen:** any number of beams
  (direction, focus, mode, polarisation, interference), linear and ring Paul
  traps, gravity. Every number explains itself; plots of the forces,
  potential, sweeps, radiation pattern and heating; setups saved as files or
  shared as links.
* **A real lens:** a beam can be focused by the ray-traced Thorlabs
  354330-C asphere (prescription from the Thorlabs Zemax file), tilted and
  decentred: the focus shift, clipping loss and trap-axis tilt follow.
* **Paper reproduction:** figures of arXiv:2607.09896 (dark trapping of
  WS₂): see [`docs/paper/`](docs/paper/README.md).

> **levtrap 2.** The screen is `app/` (design in
> [`app/DESIGN.md`](app/DESIGN.md)), served at the site's root; the engine's
> entry point is `levtrap.solve.solve(setup)` (architecture in
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), work in
> [issue #6](https://github.com/macroscopicquantumoptics/levtrap/issues/6)).
> The old site (`web/`) is retired; what it did and where that went is in
> [`docs/PARITY.md`](docs/PARITY.md). Its addresses (`/next/`, `/classic/`,
> `lens.html`) lead to the app.

## Quick start — web

Open the website and pick a trap. The first visit downloads ~25 MB
(Python, NumPy, SciPy); later visits use the browser cache.

To run the screen locally from a clean clone, with the engine as native
Python (fast, no Pyodide):

```bash
git clone https://github.com/macroscopicquantumoptics/levtrap && cd levtrap
pip install -e .
python scripts/devserver.py            # the engine on :8000
```

```bash
cd app && npm ci && npm run dev        # open http://localhost:3000/?backend=local
```

Without `?backend=local` the page runs the engine in the browser (Pyodide);
for that, build the wheel and stage it with `npm run wheel` first. Checks:
`npm run typecheck`, `npm run lint`, `npm test` (unit tests; some call the
Python engine) and `npm run test:e2e` (builds, then drives a browser).

## Quick start — Python

```bash
pip install -e ".[test]"   # numpy + scipy only
pytest -q                  # ~280 tests, ~2 min
```

```python
from levtrap.solve import solve

setup = {
    "version": 1,
    "particle": {"radius": 100e-9, "n": 1.45, "k": 0.0, "density": 2200},
    "trap": {"fields": [{"kind": "beam", "wavelength": 1064e-9, "power": 0.2,
                         "focus": {"NA": 0.9}, "polarisation": "x"}]},
}
r = solve(setup)                               # SI in, SI out
print(r["stable"], r["equilibrium"], [m["frequency"] for m in r["modes"]], r["depth"]["kT"])
```

The setup file is described in `docs/ARCHITECTURE.md` §4 and checked by
`levtrap.setup`. The screen sends the same setup to `levtrap.solve.solve_json`
(in a Pyodide worker, or to `scripts/devserver.py`); File → Copy as Python
gives the code for the setup on screen.

Lower-level, OTT-style:

```python
import numpy as np
from levtrap.bsc import BscPmGauss
from levtrap.tmatrix import TmatrixMie
from levtrap.force import forcetorque
from levtrap.traps import axial_equilibrium

beam = BscPmGauss("lg", (0, 0), NA=0.9, index_medium=1.0, wavelength0=1064e-9,
                  polarisation=(1, 0), power=1.0)
T = TmatrixMie(100e-9, index_medium=1.0, index_particle=1.45, wavelength0=1064e-9)
z_eq, kz = axial_equilibrium(T, beam)             # metres, (n P / c) per metre
f, torque, spin = forcetorque(beam, T, position=np.array([[0, 0, z_eq]]).T)
```

### Units

Public functions in `levtrap.api` and `levtrap.derived` take and return
SI units. Internally the code uses OTT conventions:

* Lengths are in metres; `k_medium = 2π n_medium / λ₀`.
* `forcetorque` returns the dimensionless efficiency **Q**, in units of
  `n_medium P / c`, so **F = Q · n_medium · P / c**. Here P is the beam power
  `Σ(|a|²+|b|²)`, normalised to 1 W or scaled to watts.
* A beam with OTT power `P_ott` and field `E` has intensity
  `I = (P / P_ott) · 4k²|E|²`. This is checked against Mie theory in
  `tests/test_analytic.py`.

## Repository layout

```
src/levtrap/   special.py vswf.py translate.py bsc.py tmatrix.py force.py
               traps.py derived.py dipole.py materials.py lens.py api.py
tests/         ported OTT tests + analytic checks (pytest)
app/           the screen: Next static export, React, TypeScript, three.js.
               src/engine (typed engine client, Pyodide worker, setup
               validation), src/screen (the one screen), tests/e2e
               (Playwright), DESIGN.md
scripts/       devserver.py (the native engine for ?backend=local), pyodide_check.mjs (CI)
ci/workflows/  test.yml, app.yml, pages.yml — a copy of .github/workflows/
examples/      paper_2607_09896.py
docs/paper/    reproduced figures and notes
```

### CI and the website

GitHub only accepts workflow files that are pushed with the `workflow`
permission. A session without it changes `ci/workflows/` only; someone with
the permission then copies the files over:

```bash
cp ci/workflows/*.yml .github/workflows/
```

In **Settings → Pages**, **Source** is **GitHub Actions**. `pages.yml` runs
on every push to `main`: it runs the tests, builds the wheel, checks it in
Pyodide (OTT benchmark), builds `app/` for the site's root with the
redirects of the old addresses (`/next/`, `/classic/`, `lens.html`;
`app/scripts/redirects.ts`), checks it in a headless browser with the
engine in Pyodide, and deploys it.
`app.yml` checks `app/` on every push and pull request.

## Adding a feature

A new kind of field (a trap, a force) or a new number goes through the
same five places:

1. **Physics first, in Python.** Add a field in `src/levtrap/fields/` (a
   class with `force(r)` and `model()`, like `GravityField` or
   `PaulField`) or a module beside the others. Use only NumPy, SciPy and the
   standard library, so it keeps working in Pyodide. If you port OTT code,
   cite the OTT file in the docstring and add a `# OTT:` comment wherever you
   follow a quirk of the original.
2. **The setup and the result.** Add the field's keys to `levtrap.setup`
   (validated, defaults filled, unknown keys kept) and build it in
   `levtrap.solve`; put new numbers in the Result in SI units. Describe both
   in `docs/ARCHITECTURE.md` §4 and §6.
3. **Test it.** Add a pytest in `tests/` with a reference: an OTT test value,
   an analytic result, a limit it must reduce to, or an independent
   implementation. Don't invent reference numbers.
4. **The screen.** Mirror the setup keys in `app/src/engine/types.ts` and
   `validate.ts` (its test compares with `levtrap.setup.parse` case by case);
   add an inspector in `app/src/screen/Inspector.tsx`, a part in `model.ts`,
   a drawable in `scene3d/parts.tsx`, and an entry in the Add field menu.
   A new number gets a row under More and an explanation with its formula in
   `explain.ts` and `formulas.ts` (the formula test typesets it).
5. **Check it.** `pytest -q`; in `app/`, `npm run typecheck`, `npm run lint`,
   `npm test` and `npm run test:e2e`. CI then runs them again, and the
   Pyodide checks.

## Credits and licence

levtrap is a derivative work of the **Optical Tweezers Toolbox v1**,
© 2007–2018 The University of Queensland, and is distributed under the same
licence: **CC BY-NC 4.0, non-commercial use only** (see
[LICENSE.md](LICENSE.md)). Please cite:

> T. A. Nieminen, V. L. Y. Loke, A. B. Stilgoe, G. Knöner, A. M. Brańczyk,
> N. R. Heckenberg and H. Rubinsztein-Dunlop, "Optical tweezers
> computational toolbox", *J. Opt. A* **9**, S196–S203 (2007).
