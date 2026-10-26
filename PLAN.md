# PLAN — Browser optical-trapping simulator (OTT subset → Python + Pyodide)

You are an autonomous agent building this project end to end. Read this whole file before writing code. Work milestone by milestone; do not start a milestone until the previous one's acceptance criteria pass.

## 1. Goal

A static website (GitHub Pages, no server) where our levitated-optomechanics team can simulate optical forces on a sphere in vacuum/air, see the results as interactive plots, and understand what is going on in a group meeting.

Physics runs in Python inside the browser via Pyodide (NumPy/SciPy only). The UI is plain HTML/JS with Plotly. The same Python package must also be pip-installable and usable locally for research scripts.

The physics is a port of a subset of the MATLAB Optical Tweezers Toolbox v1 (OTT): https://github.com/ilent2/ott

## 2. Scope

### In scope (this handoff)

* Homogeneous sphere (Mie T-matrix), complex refractive index, medium index default 1.0 (vacuum/air), but keep it a parameter.
* Beams: focused Gaussian (point-matched, as OTT `BscPmGauss`), LG and HG modes, linear/circular/arbitrary polarisation, NA or focusing angle, wavelength, power.
* Coherent superposition of two beams with power ratio, waists/NA and relative phase (needed for "bottle beam" dark traps: two LG/Gaussian beams with a π relative phase).
* Plane wave (needed for validation tests).
* Outputs: force vs x/y/z, xz force map over intensity, equilibrium z_eq, trap stiffness → trap frequencies (needs particle density), trap depth (in k_B·T and K), scattering/absorption efficiencies, multipole decomposition (ED/MD/EQ/MQ from a₁,b₁,a₂,b₂), recoil heating ratio Γ/Ω₀ = ω·P_sca / (5·m·c²·Ω₀), absorbed power.
* Parameter sweeps (radius, wavelength, power) with "no stable trap" regions shaded.
* Teaching toggles: switch individual multipole orders on/off in the T-matrix; overlay the dipole (Rayleigh) approximation against full Mie.
* Static web UI (see §6).

### Out of scope (do NOT build)

* Non-spherical particles (DDA, EBCM, point-matched T-matrices, SMARTIES, STL shapes).
* Bessel/annular beams, SLM tools, layered spheres, liquid/viscous-drag physics.
* Dynamics / Langevin / PSD (v2), shareable URLs and exports (v2), internal particle temperature (v2).
* Any server, database, or account system.

## 3. Licence — mandatory

OTT v1 is CC BY-NC 4.0 (© University of Queensland). This port is a derivative work:

* License the repo CC BY-NC 4.0, keep the original copyright notice, and credit OTT + its paper (Nieminen et al., J. Opt. A 9, S196 (2007)) in README and in the site footer.
* Non-commercial use only. Do not add any dependency with a licence incompatible with that.

## 4. Architecture & repo layout

```
/
├── PLAN.md                  (this file — keep the progress log at the bottom updated)
├── LICENSE.md               CC BY-NC 4.0 + OTT attribution
├── README.md                what it is, quick start (local + web), credits
├── pyproject.toml           pure-Python package, deps: numpy, scipy only
├── src/levtrap/             (package name is a placeholder; keep it unless told otherwise)
│   ├── special.py           spherical Bessel/Hankel, associated Legendre, spherical harmonics
│   ├── vswf.py              vector spherical wave functions, combined index helpers
│   ├── bsc.py               beam shape coefficients: plane wave, point-matched Gaussian/LG/HG, superposition
│   ├── translate.py         z-translation (addition theorem), Wigner rotations
│   ├── tmatrix.py           Mie T-matrix for a sphere, multipole masking
│   ├── force.py             force/torque from incident + scattered coefficients
│   ├── traps.py             find_traps, axial_equilibrium, stiffness, depth
│   ├── derived.py           trap frequencies, Γ/Ω₀, efficiencies, multipoles, absorbed power
│   ├── dipole.py            Rayleigh/dipole reference model for the overlay
│   ├── materials.py         presets: SiO2, Si, WS2, MoS2 (index + density at given λ; cite sources in comments)
│   └── api.py               JSON-in / JSON-out functions the web worker calls
├── tests/                   pytest; ported OTT tests + analytic checks (see §5)
├── web/
│   ├── index.html
│   ├── app.js               UI, Plotly rendering
│   ├── worker.js            loads Pyodide + the levtrap wheel, runs api.py calls
│   └── style.css
└── .github/workflows/
    ├── test.yml             pytest on push/PR
    └── pages.yml            build wheel → copy into web/ → deploy to GitHub Pages
```

Rules:

* `src/levtrap` must import only numpy, scipy and the standard library (Pyodide compatibility). No numba, no compiled extensions.
* All public functions take and return SI units. Internally you may use OTT's convention (lengths in medium wavelengths, forces as efficiency Q); convert at the API boundary. Document the conversion (F = Q · n_medium · P / c). Verify OTT's units by reading its source, don't assume.
* Python runs in a Web Worker so the UI never freezes. Load Pyodide and Plotly from a pinned CDN version (jsDelivr), not "latest".

### OTT source files to port (read these, port behaviour faithfully)

`Bsc.m`, `BscPointmatch.m`, `BscPmGauss.m`, `BscPlane.m`, `Tmatrix.m` (only what `Tmatrix.simple('sphere', …)` needs), `TmatrixMie.m`, `forcetorque.m`, `axial_equilibrium.m`, `find_equilibrium.m`, `find_traps.m`, `trap_stiffness.m`, and whatever they call in `+ott/+utils/` (e.g. `ka2nmax.m` → `Nmax = ceil(ka + 3·ka^(1/3))`, `vswf`, `translate_z`, `wigner_rotation_matrix`, `combined_index`, spherical Bessel functions, Legendre rows, paraxial beam waist). Trace the call graph yourself and list the final set in the progress log.

## 5. Validation (only OTT's built-in test values + analytic checks)

Port these OTT tests to pytest, with the same tolerances. A milestone isn't done until its tests pass.

From `tests/testExamples.m` (sphere end-to-end — the key benchmark): n_medium = 1.34, n_particle = 1.59, λ₀ = 1064 nm, radius = 1.5·λ₀/n_medium, `BscPmGauss` with angle_deg = 50, polarisation [1 0], power 1.0. Find axial equilibrium, translate beam there, rotate beam by π/2 about y, find x equilibrium. Expect:

* z = 4.023474767793779e-07 (abs tol 1e-9)
* kz = −6.258368435930368e+04 (rel tol 1 %)
* x = 0 (abs tol 1e-9)
* kx = −2.450214062064871e+05 (rel tol 1 %)

From `tests/testForceTorque.m`:

* Non-contrasting sphere (radius 1.0, n_rel 1.0) in a circularly polarised plane wave, Nmax = 12, random rotations: |F| = 0 (tol 1e-3).
* Identity T-matrix of 'scattered' type (−0.5·I) with the same plane wave: |F| = 0.9231, |τ| = 1, |spin| = 0.9231 (tol 1e-3).
* Multi-beam / coherent consistency: force from a packed set of beams equals the individual results; coherent sum equals force on the merged beam (tol 1e-6). This guards the bottle-beam superposition.
* Uneven/larger Nmax gives the same force (tol 1e-6).

From `tests/testTmatrixMie.m`:

* Non-contrasting particle: internal field = incident field; external scattered field ≈ 0 (tol 1e-6).
* Boundary conditions on a sphere R = 0.5, n_rel = 1.2: tangential E and normal D continuous at random surface points (tol 1e-6).

From `tests/testFindTraps.m`: port all cases (single/double/negative sinusoid, sawtooth, flat-centre, poly3) with their expected positions, stiffness, depth, min/max force, range.

From `tests/utils/`: port `testTranslateZ`, `testVswfCart`, `testWignerRotationMatrix`, `testRotations`, `testCol3to1` where they apply to the ported code.

Analytic/self-consistency checks (add these; no OTT values needed):

* Mie efficiencies Q_ext, Q_sca vs the textbook Bohren & Huffman algorithm, implemented independently in the test file (not reusing `tmatrix.py`). Include absorbing spheres.
* Optical theorem / energy: Q_ext = Q_sca + Q_abs.
* Small-sphere limit: Mie force on a sphere with radius ≪ λ in a focused Gaussian → dipole-model gradient force (within a few %).
* Force scales linearly with power; zero radial force on axis by symmetry; LG beam with ℓ ≠ 0 gives on-axis intensity ≈ 0.
* Convergence: doubling Nmax beyond `ka2nmax` changes forces by < 1e-4 relative.

Do not invent reference numbers. If a test can't be ported because a feature is out of scope, note it in the progress log and skip it.

## 6. Web UI spec

Single page, four regions:

1. Parameters panel: presets dropdown (Silica bright tweezer @1064 nm; Silica bright tweezer @1550 nm; WS₂ bottle-beam dark trap @1550 nm), particle (material preset or custom n, k, density; radius), beam(s) (type, mode indices, NA, λ, power, polarisation; second beam toggle with power ratio & relative phase), multipole toggles, dipole overlay toggle.
2. Summary card: z_eq, f_z, f_r, trap depth (k_B·T and K at 300 K), Q_sca, Q_abs, Γ/Ω₀, absorbed power, Nmax. Show "No stable trap" clearly when there's none.
3. Plots (Plotly): F_x, F_y, F_z line cuts through the trap; xz force map (quiver) over beam intensity; multipole contribution bar chart; sweep plot with unstable regions shaded.
4. "What am I looking at" collapsible note under each plot: one paragraph + the key equation.

Behaviour:

* Debounced live recompute on parameter change; show a spinner and timing.
* Sweeps run on an explicit "Run sweep" button and can be cancelled.
* Works in current Chrome/Firefox/Safari; usable on a laptop screen; light and dark mode.
* First load shows a progress bar while Pyodide loads.
* Footer: OTT credit, licence, version/commit hash.

For the WS₂ preset, use n = 3.79 + small absorption at 1550 nm, two coherent circularly polarised beams at 1550 nm, waists 1.59 µm and 0.866 µm, relative phase π. Mark this preset "illustrative, not validated" in the UI since no OTT reference value covers it.

## 7. Milestones & acceptance criteria

* **M0 — Setup.** Repo skeleton, pyproject, CI running pytest, licence/attribution in place. ✅ CI green on an empty test.
* **M1 — Special functions & VSWFs.** Bessel/Hankel, Legendre, VSWF, combined index, `ka2nmax`. ✅ Ported util tests pass; spot-check special functions against SciPy.
* **M2 — Mie T-matrix.** Sphere T-matrix incl. internal fields; multipole masking. ✅ `testTmatrixMie` ports + Bohren-Huffman efficiency checks + energy check pass.
* **M3 — Beams.** Plane wave, point-matched Gaussian/LG/HG, translation along z, rotations, superposition. ✅ Translation/rotation util tests pass; LG on-axis null check passes.
* **M4 — Forces & traps.** `forcetorque`, `find_traps`, `axial_equilibrium`, stiffness, depth. ✅ All §5 tests pass, including the `testExamples` sphere benchmark.
* **M5 — Derived quantities & dipole model.** Trap frequencies, Γ/Ω₀, absorbed power, multipoles, dipole overlay; `api.py` with JSON schemas. ✅ Analytic small-sphere check passes; `api.py` round-trips JSON; docstrings give formulas + units.
* **M6 — Pyodide.** Wheel builds; loads in Pyodide; worker runs the benchmark case. ✅ A headless test (Playwright, or Pyodide's Node runner) loads the wheel and reproduces the `testExamples` z_eq within tolerance. Report single-calc time.
* **M7 — Web UI.** Everything in §6. ✅ Manual checklist in the progress log; a single bright-tweezer calculation updates in < 3 s on a typical laptop (if not, report timings and the bottleneck rather than cutting features silently).
* **M8 — Deploy & docs.** GitHub Pages workflow, README with local + web quick start and an "adding a feature" section. ✅ Site live from the Pages workflow; README quick start works from a clean clone.

## 8. Working rules for the agent

* Commit small, with messages naming the milestone (e.g. `M2: Mie T-matrix internal fields`). Open a PR per milestone if you have repo access; otherwise commit to `main`.
* Port behaviour, not style: idiomatic NumPy, vectorised, type hints, docstrings with units and the OTT function each port corresponds to.
* When OTT's MATLAB is ambiguous, follow OTT's numerical behaviour and leave a `# OTT:` comment citing the file and line.
* Performance: correctness first. Only optimise after M4, guided by profiling.

Stop and ask the human (don't guess) if:

* a ported OTT test fails and you can't find the cause within a reasonable effort — report the expected vs actual numbers;
* you need a dependency beyond numpy/scipy in `src/`;
* something requires going outside the scope in §2;
* Pyodide can't run a required SciPy function.

## 9. Progress log

Append one dated entry per work session: milestone, what was done, test status, open questions, deviations from this plan.

### 2026-10-26 — Session 1 (M0–M8 implemented; M9 paper figures added on request)

**Status:** M0–M5 done, all §5 tests pass locally (85 pytest). M6/M7 are implemented, but the
Pyodide/browser acceptance runs only in CI. This sandbox cannot reach jsDelivr, and CI cannot run
until the workflow files are enabled (see open items). M8 docs are written; the Pages deploy is
pending the same workflow enablement.

**OTT source:** github.com/ilent2/ott master @ e6736643 (v1.5.x, CC BY-NC 4.0).

**Call graph ported** (→ module):
`Bsc.m` (make_beam_vector, power, Nmax/set_Nmax/shrink_Nmax, translateZ/Xyz/Rtp, rotate*, append,
totalField/scatteredField, emFieldXyz, scatter, mtimes/plus/sum) → `bsc.py`;
`BscPlane.m`, `BscPointmatch.m` (bsc_farfield), `BscPmGauss.m` (lg/hg, Default translation) → `bsc.py`;
`Tmatrix.m` (set_Nmax, set_type, mtimes, parser_wavenumber), `TmatrixMie.m` (tmatrix_mie only) → `tmatrix.py`;
`forcetorque.m` → `force.py`; `axial_equilibrium.m`, `find_equilibrium.m`, `find_traps.m`,
`trap_stiffness.m` → `traps.py`;
`+utils`: sbesselj, sbesselh1, sbesselh2, legendrerow, spharm, vsh, vswf, vswfcart, emField,
combined_index, ka2nmax, nmax2ka, laguerre, hermite, paraxial_beam_waist, angulargrid, xyz2rtp,
rtp2xyz, rtpv2xyzv, xyzv2rtpv, rotx/roty/rotz, rotation_matrix, matchsize (implicit), translate_z
(gumerov + calculate_AB), wigner_rotation_matrix, paraxial_transformation_matrix (genLG2HG only)
→ `special.py`, `vswf.py`, `translate.py`, `bsc.py`.

**Tests:**
* testExamples: axial equilibrium benchmark z = 4.0234747677885e-07 m (OTT 4.023474767793779e-07),
  kz = −62583.684 (OTT −62583.684), x ≈ 2e-23, kx = −245021.406 (OTT −245021.406). testSphere is
  also ported: Gaussian, LG03 and HG23 radial force curves within 1 %. testCube skipped (non-spherical).
* testForceTorque (all: simple, uneven/large Nmax, multi-particle, plane wave 0.9231/1/0.9231,
  multi-beam, coherent), testTmatrixMie (fields, boundary conditions), testTmatrix (power/resize),
  testBsc (translations, make_beam_vector, sum), testBscPlane, testBscPmGauss (mode errors),
  testFindTraps (all 8 cases), utils testTranslateZ, testWignerRotationMatrix, testRotations,
  testVswfCart — all pass with OTT tolerances.
* Analytic: Mie vs independent BHMIE (8 cases incl. absorbing); Q_ext = Q_sca + Q_abs, with Q_abs
  also from a volume integral of the internal field (rtol 2e-3); dipole limit (20 nm silica, 3 %);
  power linearity; zero on-axis radial force; Nmax doubling < 1e-4; LG ℓ=1..3 on-axis null; HG
  nodal plane; plane-wave scattered/absorbed power vs Mie (rtol 1e-8); API round trips.

**Deviations / notes:**
1. OTT `testTmatrixMie.testFields` boundary check uses `Esca + Einc`. That is inconsistent with OTT's own
   `totalField` (2·scattered + incident) and fails at n_rel = 1.2, so it is ported with the factor 2.
2. `mergeBeams` (testCoherent) does not exist in OTT 1.5.9 (added in 1.6); implemented as the coherent
   column sum.
3. Not ported: `col3to1/col1to3` (not in v1.5.9 utils); translate_z 'videen' method (only the default
   'gumerov'; that negative-translation sub-check is skipped); layered spheres; BscPmGauss 'ig' modes and
   'NewBeamOffset'.
4. `emFieldXyz` uses the complex particle wavenumber (OTT uses |k|). This is identical for real k and correct
   for absorbing internal fields.
5. **Recoil ratio:** the plan's formula ω·P_sca/(5mc²Ω₀) is the rate Γ itself. levtrap reports
   Γ/Ω = ωP_sca/(5mc²Ω²), which reproduces the paper's SiO₂ reference Γ/Ω ≈ 0.18. Please confirm.
6. In OTT, `BscPlane(theta=0)` travels towards −z (documented in tests).
7. Field normalisation found and tested: I = (P/P_ott)·4k²|E|² (used by the dipole model and the
   intensity map).
8. Two-beam superposition: "total power" is the power of the coherent sum, which includes interference.
   The component ratio and phase are user inputs, and an optional "dark focus" split nulls the focal field.
9. Performance (native CPython, this container): beam construction 0.37 s (was 1.5 s before
   restricting `spharm` to the needed m). Full analysis: 2.3–2.9 s cold, 0.6–1.0 s warm (cached beam,
   translation and Wigner matrices, intensity map). Pyodide timings will come from CI (`pyodide_check.mjs`
   prints them).

**M7 manual checklist** (local, native backend, Chromium via Playwright, 1440×900):
parameters panel ✓, presets ✓ (WS₂ marked "illustrative, not validated") ✓, material presets with
sources ✓, second beam + ratio + phase + dark-focus ✓, multipole toggles ✓, dipole overlay ✓,
summary tiles with "No stable trap" banner ✓, line cuts ✓, xz map + quiver over intensity ✓,
multipole bars ✓, sweep with grey unstable bands, progress and cancel ✓, collapsible notes ✓,
light/dark ✓, loader progress bar (worker path, untested locally) ☐, Firefox/Safari ☐ (not available
here), < 3 s in Pyodide ☐ (CI will report).

**Open items for the human:**
* Copy `ci/workflows/*.yml` to `.github/workflows/`. The session token lacks the `workflow` scope, so the
  CI and Pages workflows cannot be pushed from here.
* A `main` branch is needed for Pages (the workflow deploys on push to `main`). Merge this branch into main.
* Paper questions for the authors: see docs/paper/README.md.

### 2026-10-26 — Session 1, continued (3D view, requested after M8)

* PR #1 merged. The user added the workflows to `.github/workflows/`.
* New: **3D view** (visual aid, three.js 0.160.0 from jsDelivr, lazy-loaded). It shows a ray-marched
  intensity or |∇I| volume, with cut planes (x/y/z) whose face shows a heat map. The part between
  the cut and the camera is removed. The particle is drawn to scale at z_eq, with optional force arrows
  on a 7×7×11 grid, log/linear brightness, and opacity and contrast controls.
* `api.field3d` / `api.intensity_volume`: since E = Σ_m E_m(ρ, z) e^{imφ}, each azimuthal order is
  evaluated once on a 2D (ρ, z) grid and interpolated onto the 64×64×96 volume. Native cost is
  0.4–1.3 s (direct evaluation took 3.4 s), with error ≤ 0.5 % of peak (test asserts < 2 %).
  Force arrows add about 1 s. The 3D view is not computed on every parameter change, only on the button.
* Checked in headless Chromium (SwiftShader WebGL2) with the local backend, for the silica and WS₂
  presets, with cut planes and force arrows.
