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
* **Paper reproduction:** figures of arXiv:2607.09896 (dark trapping of
  WS₂): see [`docs/paper/`](docs/paper/README.md).

## Quick start — web

Open the website and pick a preset. The first visit downloads ~25 MB
(Python, NumPy, SciPy); later visits use the browser cache.

To run the site locally from a clean clone:

```bash
git clone https://github.com/macroscopicquantumoptics/levtrap && cd levtrap
pip install build
python -m build --wheel --outdir web/wheels
python - <<'EOF'
import glob, json, os
whl = os.path.basename(glob.glob("web/wheels/*.whl")[0])
json.dump({"wheel": whl}, open("web/wheels/manifest.json", "w"))
EOF
python -m http.server -d web 8000      # open http://localhost:8000
```

If you want to work on the UI without Pyodide or internet access, use the
native backend:

```bash
pip install -e .
python scripts/devserver.py            # open http://localhost:8000/?backend=local
```

(Plotly is still loaded from the CDN.)

## Quick start — Python

```bash
pip install -e ".[test]"   # numpy + scipy only
pytest -q                  # ~85 tests, ~30 s
```

```python
import json
from levtrap import api

req = {
    "wavelength": 1064e-9, "medium_index": 1.0,
    "particle": {"radius": 100e-9, "n": 1.45, "k": 0.0, "density": 2200},
    "beams": [{"type": "lg", "mode": [0, 0], "NA": 0.9, "power": 0.2, "polarisation": "x"}],
}
r = api.analyse(req, detail=False)          # SI in, SI out
print(r["stable"], r["z_eq"], r["freq"], r["depth"]["kT"], r["recoil_ratio"])
```

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
               traps.py derived.py dipole.py materials.py api.py
tests/         ported OTT tests + analytic checks (pytest)
web/           index.html app.js worker.js style.css (static site, Plotly + Pyodide from jsDelivr)
scripts/       devserver.py (native backend), pyodide_check.mjs, ui_check.js (CI)
ci/workflows/  test.yml, pages.yml — copy to .github/workflows/ (see below)
examples/      paper_2607_09896.py
docs/paper/    reproduced figures and notes
```

### Enabling CI and the website

GitHub only accepts workflow files that are pushed with the `workflow`
permission, so they live in `ci/workflows/`. Enable them once:

```bash
mkdir -p .github/workflows && cp ci/workflows/*.yml .github/workflows/
git add .github && git commit -m "Enable CI and Pages" && git push
```

Then, in **Settings → Pages**, set **Source = GitHub Actions**. `pages.yml`
runs on every push to `main`: it runs the tests, builds the wheel, checks it
in Pyodide (OTT benchmark) and in a headless browser, and deploys `web/`.

## Adding a feature

1. **Physics first, in Python.** Add or extend a module in `src/levtrap/`.
   Use only NumPy, SciPy and the standard library, so it keeps working in
   Pyodide. If you port OTT code, cite the OTT file in the docstring and add
   a `# OTT:` comment wherever you follow a quirk of the original.
2. **Test it.** Add a pytest in `tests/` with a reference: an OTT test value,
   an analytic result, or an independent implementation. Don't invent
   reference numbers.
3. **Expose it.** Add the result to `api.analyse` (SI units, plain lists and
   floats) or add a new function to `api.handle`. Add a round-trip check to
   `tests/test_api.py`.
4. **Show it.** In `web/app.js`, read the new field in `render()`. Add a
   tile, a trace or a plot, and add a "What am I looking at?" note in
   `index.html`. Add an ⓘ explanation to `HELP` or `TILE_HELP` and a
   glossary entry if a newcomer wouldn't know the term.
5. **Check it.** Run `pytest -q` and `python scripts/devserver.py` for a
   quick look. CI then runs the Pyodide and browser checks.

## Credits and licence

levtrap is a derivative work of the **Optical Tweezers Toolbox v1**,
© 2007–2018 The University of Queensland, and is distributed under the same
licence: **CC BY-NC 4.0, non-commercial use only** (see
[LICENSE.md](LICENSE.md)). Please cite:

> T. A. Nieminen, V. L. Y. Loke, A. B. Stilgoe, G. Knöner, A. M. Brańczyk,
> N. R. Heckenberg and H. Rubinsztein-Dunlop, "Optical tweezers
> computational toolbox", *J. Opt. A* **9**, S196–S203 (2007).
