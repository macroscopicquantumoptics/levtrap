# levtrap 2 — architecture

Status: draft, 2026-11-09. Supersedes `PLAN.md` §6 (web UI) and extends §2 (scope).
`PLAN.md` stays as the record of the OTT port.

## 1. What it is for

A trap simulator an experimentalist can use without a tutorial and a theorist
can trust. Pick a trap, pick a particle, read the numbers.

Three goals, in priority order when they conflict:

1. **Correct.** Every number is traceable to a model, a formula and a test.
2. **Obvious.** One screen. The trap is drawn; you click the thing you want to
   change. No panel hunting.
3. **Broad.** Optical, Paul and hybrid traps share one particle, one
   environment and one set of outputs.

Audience: levitated-optomechanics labs (optical tweezers in vacuum, Paul
traps, hybrid traps). First users know the physics but not the T-matrix
method.

## 2. Vocabulary

| Term | Meaning | Avoid |
|---|---|---|
| **Setup** | Everything needed to compute: particle, trap, environment. Saved as a setup file. | scene, config, request |
| **Particle** | A homogeneous sphere: radius, material (n, k, density), charge. | bead, object |
| **Trap** | A list of **fields** acting on the particle. | potential |
| **Field** | One source of force: a beam, a Paul trap, gravity. | component |
| **Beam** | A focused laser beam with a direction, a focus position and a focusing optic. | laser |
| **Environment** | Gas species, pressure, temperature. | bath |
| **Result** | What the engine returns for a setup: equilibrium, frequencies, depth, rates, each with its model and validity. | output |
| **Model** | The approximation behind a number (`mie`, `dipole`, `pseudopotential`, …). | method |
| **Preset** | A named setup with a literature citation. | example |

## 3. Layers

```
app/ (Next static export, React, three.js)     the screen
      │  Setup JSON  ▲ Result JSON
      ▼              │
engine client (TS)  ── Web Worker ──  Pyodide + levtrap wheel
                                         │
src/levtrap/setup.py     parse, validate, migrate a Setup
src/levtrap/solve.py     Setup -> Result; picks models, runs them
src/levtrap/fields/      one module per field kind (optical, paul, gravity)
src/levtrap/rates.py     gas damping, recoil, heating
src/levtrap/spectrum.py  displacement spectrum, occupation, effective temperature (E4)
src/levtrap/pattern.py   scattered far field, collection efficiency
src/levtrap/{bsc,tmatrix,force,translate,…}.py   the OTT port (unchanged)
```

Rules:

* The engine knows nothing about the UI; the UI does no physics. The only
  contract is Setup in, Result out, both plain JSON, both SI.
* `src/levtrap` imports numpy, scipy and the standard library only.
* `api.py` keeps the engine's JSON entry points (`solve`, `field3d`, the asphere's
  `lens_trap`), dispatched by `api.handle`; the old site's `compute`, `sweep` and
  `presets` went with `web/` (E2).
* Static site, no server, ever.

## 4. Setup file (version 1)

```jsonc
{
  "version": 1,
  "particle": {"radius": 1e-7, "material": "SiO2",   // or n, k, density given
               "n": 1.45, "k": 0.0, "density": 2200, "charge": 0},  // charge in e
  "environment": {"pressure": 1e-6,                   // Pa
                  "temperature": 300, "gas": "N2", "medium_index": 1.0},
  "trap": {"fields": [
    {"kind": "beam", "wavelength": 1.064e-6, "power": 0.1,
     "focus": {"kind": "lens", "NA": 0.8},            // + optional "filling": the beam fills an aplanatic
                                                      //  objective's aperture (1/e^2 radius / aperture, #61);
                                                      //  + optional "mapping": "ott" (default, tan theta, as
                                                      //  OTT-based papers) or "sine" (textbook Gaussian, #64);
                                                      //  + optional "aberration" with "filling": Zernike terms
                                                      //  in waves rms over the pupil, {"spherical", "coma_x",
                                                      //  "coma_y", "astigmatism_0", "astigmatism_45"} (#83);
                                                      // or {"kind": "asphere", "lens": "354330-C",
                                                      //  "beam_diameter": 2.5e-3, "tilt_deg": [0, 0],
                                                      //  "decentre": [0, 0]} (E1); or {"kind": "parabolic_mirror",
                                                      //  "focal_length": 3e-3, "rim_radius": 9e-3, "hole_radius": 0,
                                                      //  "beam_diameter": 10e-3} (E3, levtrap.mirror)
     "mode": {"type": "lg", "indices": [0, 0]},
     "polarisation": "x",
     "direction": [0, 0, 1], "position": [0, 0, 0],   // propagation axis, focus point [m]
     "phase": 0.0, "coherent_with": null},            // id of another beam, or null
    {"kind": "paul", "geometry": "linear",            // "linear" | "ring"
     "rf_voltage": 300, "rf_frequency": 5e3,          // V (amplitude), Hz
     "dc_voltage": 0, "endcap_voltage": 5,
     "r0": 1e-3, "z0": 2e-3,                          // m
     "geometry_factors": {"radial": 1.0, "axial": 0.3}},
    {"kind": "gravity", "g": [0, -9.81, 0]}
  ]}
}
```

* A setup file saved by any released version keeps opening in every later
  one. Migrations live in `setup.py`, one function per version step.
* Unknown keys are kept and reported, not dropped.
* Lab frame: z is the optical axis of the first beam, y is up. A Paul trap
  is centred at the origin; a linear trap's axis is z.
* A beam's `polarisation` and `phase` are in its own frame (#71,
  `src/levtrap/optics.py`): the beam is built along +z and turned the
  shortest way to its `direction`; one along −z is turned by π about x, so
  its y is the lab's −y and `"circular+"` on it turns the other way in the
  lab. `phase` multiplies the beam's coefficients by e^{iφ} about its own
  focus. Beams linked by `coherent_with` are rescaled together to the sum of
  their `power`s; the others keep their own.
* Paul trap a and q follow Leibfried et al., RMP 75, 281 (2003) (see
  `src/levtrap/fields/paul.py` for the per-geometry formulas).

## 5. Field interface

```python
class Field(Protocol):
    def force(self, r: np.ndarray) -> np.ndarray: ...        # (N,3) m -> (N,3) N, time-averaged
    def model(self) -> ModelInfo: ...                        # name, validity, warnings
```

`solve.py` sums the forces of all fields and, on the summed force:

* finds the equilibrium (3D Newton from a coarse scan),
* takes the 3×3 stiffness matrix by central differences, diagonalises it,
  and reports eigen-frequencies and eigen-axes,
* integrates the depth along each eigen-axis to the nearest barrier.

So any new trap type is one new `Field`; frequencies, depth and stability
come for free. Coherent beams are grouped into a single optical field before
the force is taken (interference matters); incoherent ones are separate
fields.

Models per field:

| Field | Model | Valid when | Source |
|---|---|---|---|
| beam | `mie` (T-matrix) | sphere, any size | OTT port |
| beam | `dipole` (overlay only) | radius ≪ λ | `dipole.py` |
| paul | `pseudopotential` | Mathieu \|q\| ≲ 0.4 | Mathieu equation |
| paul | `mathieu` (exact secular frequency) | inside first stability region | Floquet exponent |
| gravity | exact | — | — |

## 6. Result (version 1)

```jsonc
{
  "version": 1,
  "stable": true,
  "equilibrium": [0, 0, 4.0e-7],
  "modes": [{"axis": [1,0,0], "frequency": 1.5e5, "stiffness": 1e-6, "depth": 3e-19}, …],
  "depth": {"J": 3e-19, "K": 2.2e4, "kT": 72},
  "optical": {"P_sca": …, "P_abs": …, "Qsca": …, "Qabs": …,
              "Qsca_multipoles": {"ED": …, "MD": …, "EQ": …, "MQ": …, "EO": …, "MO": …, "higher": …},  // plane wave (#80)
              "P_sca_multipoles": {"ED": …, …}},   // W: the beams' own split of P_sca at the equilibrium (#80)
  "paul": {"q": {...}, "a": {...}, "stable": true, "secular": {...}, "micromotion": [...]},
  "rates": {"gas_damping": …, "recoil_heating": [...], "reheating_phonons_per_s": [...],
            "modes": [{"recoil_scattered": …, "recoil_incident": …, "recoil_cross": …, …}],  // recoil split (#78, #95)
            "scattered_moments": {"mean": [...], "second": [[...]]}},  // <n>, <n n> of the Mie pattern (#78)
  "lenses": [{"field": 0, "focus_shift": [...], "clipping_loss": …, …,      // per beam through an asphere (E1)
              "rays": [...], "wavefront": {...}}],                         // with want "lens": traced rays, W map (#49)
  "mirrors": [{"field": 0, "reflected": 0.98, "rim_angle_deg": 112.6,     // per beam from a parabolic mirror (E3)
               "hole_angle_deg": 9.5, "deep": true, "clipping_loss": …, "Nmax": 25}],
  "coherent": [{"fields": [0, 1],         // per coherent pair of beams (indices into trap.fields), if any (#79):
                "dark_split": 0.629,      //  the fraction of the pair's power in the second beam that darkens
                "residual": 0.0}],        //  the first beam's focus, and |E|² left there over the two intensities
                                          //  added (0: a null; levtrap.optics.dark_split)
  "pattern": {...,                        // on request: lab frame, every optical field (#76)
              "trap_NA": 0.8, "trap_axis": [0, 0, 1],   // the first beam's lens and direction
              "at_trap_NA": {"forward": {...}, "backward": {...}}},  // cones of trap_NA about ±trap_axis
  "field": {"centre": [...], "planes": {"xz": {"u": [...], "v": [...], "I": [[...]]}, "yz": …, "xy": …},
            "max": …},                    // on request: intensity [W/m²] on the lab planes (#48)
  "curves": {...},                        // on request: force cuts, potential, map
  "followed": {"start": [...], "jumped": false},  // with solve(..., start=r): the trap followed from r, or a jump (#50)
  "models": [{"quantity": "modes", "model": "mie", "validity": "ok", "notes": []}],
  "warnings": ["Paul q = 0.62: pseudopotential is inaccurate, using Mathieu"]
}
```

`curves` and `pattern` are computed only when asked for, so the headline
numbers stay fast.

The radiation pattern (#76) is computed for every optical field, in the lab
frame: a coherent group (beams in any direction, through any focus) scatters
its summed incident beam, the same one the force uses; fields that do not
interfere add their patterns, collected powers and position information, and
the fractions are those of the sums. `trap_NA` and `trap_axis` are the first
beam's lens and direction ("the trapping lens", also when other beams have
lenses of their own); `at_trap_NA.backward` is a cone of that NA about
−`trap_axis` (looking back through the trapping lens), `forward` one about
+`trap_axis`. The collection and information curves (`collection`,
`information_efficiency`) are about the fixed lab directions ±z, ±x, ±y. A beam
focused by an asphere or a parabolic mirror has no pattern yet.

The recoil heating (#95) is the backaction of the position information in the
scattered light (Tebbenjohanns, Frimmer & Novotny, PRA 100, 043821 (2019)):
Γ_u = M_uu / (2 m ω Ω_u), with M_uu = ∮ |∂F/∂u|² dΩ the information of the
scattered far field F about the position along u (the `pattern` block's
`information_total`, summed over fields that do not interfere, each at its own
ω). Every solve computes M at the equilibrium (`levtrap.pattern.recoil_information`,
model `information`), without the pattern's sphere grid: seven scatterings and a
small exact quadrature. It splits exactly as ∂F/∂u = G_u − i k n_u F into the
scattered photons (k² P_sca ⟨n n⟩, the Mie pattern), the beam photons (|G_u|²,
what the sphere scatters from the incident field's gradient) and their cross
term (2 Re ∮ G_u*·(−i k n_u F) dΩ, the interference of the two kicks; it is
not tied to ⟨n⟩ and can appear across the beam): `recoil_scattered`,
`recoil_incident`, `recoil_cross`. A plane wave gives
the photon picture of `rates.recoil_heating` (the fallback, `mie-pattern`);
at a focus the beam photons weigh ⟨cos θ⟩² < 1 along the axis (Gouy), and
standing waves and dark foci follow the actual field. Absorbed photons are
not included: above 1 % of P_sca a note says so, above 10 % the recoil is
marked approximate.

## 7. The screen

One page, the Tabletop idea applied to a trap.

```
┌──────────────────────────────────────────────────────────────┐
│ [≡ file]            [undo · show · redo]              [?]    │
│                                                              │
│                                              ┌─ inspector ─┐ │
│        3D scene: the trap, drawn             │ shown only  │ │
│        beams, lens, electrodes, particle     │ when a      │ │
│        click a thing to select it            │ thing is    │ │
│                                              │ selected    │ │
│ [+ field]                                    └─────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ fx 152 kHz   fy 171 kHz   fz 48 kHz   depth 72 kT  ● stable│
│ └──────────────────────────────────────────────────────────┘ │
│ [Forces] [Potential] [Sweep] [Radiation] [Heating] [Spectrum]│
└──────────────────────────────────────────────────────────────┘
```

Rules for every UI issue:

* **Start from a preset, never from an empty form.** First load opens a
  working tweezer with numbers on screen.
* **At most six inputs visible per selected thing.** Everything else sits in
  one "Advanced" fold whose summary shows any non-default value.
* **The results strip is always visible** and always current. A stale value
  is dimmed while recomputing, never blank.
* **Every number explains itself**: click it for the formula, the model used
  and its validity. No separate glossary page.
* **Fields take units as typed** (`100 nm`, `0.1 W`, `1e-6 mbar`); the unit
  selector keeps the physical quantity.
* **Warnings are sentences in the results strip**, not banners: "No stable
  trap: the scattering force pushes the particle out along z."
* Plots are inline SVG, coloured from the theme tokens. Plotly is dropped.
* Undo/redo, autosave to localStorage, share link with the setup in the URL
  hash, light and dark.

Patterns are taken from QUOP (Apache 2.0): the HUD islands, inspector,
number-draft fields, linked unit fields, formula sheet, snapshot undo, share
link. Code copied from QUOP keeps its licence header and is listed in
`app/NOTICE`. levtrap gets its own name and look, not QUOP's brand.

Stack: Next (static export) + React + TypeScript + three.js via
react-three-fiber, KaTeX, Node test runner, Playwright. Lives in `app/`;
`web/` was deleted once `app/` reached parity (E2, `docs/PARITY.md`).

## 8. Trust

* Reference values come from the OTT test-suite, analytic limits, or a
  published paper with the citation in the test. **Never invent a reference
  number**; if none exists, the test is a self-consistency check and says so.
* Each preset names its paper and the measured numbers it should reproduce;
  a test compares them and the tolerance is stated.
* Each quantity in a Result carries its model and validity, and the UI shows
  it.

## 9. Milestones

| | Contents |
|---|---|
| **A — Foundation** | Setup/Result schema, field interface + generic solver, `app/` scaffold with engine client |
| **B — Traps** | beam direction/position (counter-propagating, standing wave), Paul trap, hybrid sum, charge and gravity |
| **C — Numbers** | rates (gas damping, recoil, heating), radiation pattern and collection efficiency, literature validation |
| **D — Screen** | scene, inspector, results strip, plots drawer, presets, share/save |
| **E — Parity and beyond** | lens-tilt as a focusing optic, retire `web/`, parabolic mirror, dynamics/PSD |

A and the engine half of B/C do not depend on the screen and can run in
parallel with D once the schema issue is merged.
