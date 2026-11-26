# arXiv:2607.09896: every result, and where levtrap stands

P. Illetschek *et al.*, "Dark optical trapping of resonant transition-metal
dichalcogenide particles" (v1, 10 Jul 2026; main text pp. 1–7, supplement pp. 8–11).

This is step 1 of "replicate all the results in the paper": is the math right,
and does levtrap reproduce the paper? Companion files: `README.md` (figure table, open
questions), `paper_figures.json` (data), `examples/paper_2607_09896.py` (script).

## How to read this

**Status** (one per row):

| Status | Meaning |
|---|---|
| **PINNED** | levtrap reproduces it and a test asserts it (test name and tolerance given) |
| **EYE** | levtrap computes it and it matches the paper, but only in a plot or the JSON. No assertion |
| **PARTLY** | computed, but a different quantity, a different range, or a qualitative match only |
| **NOT DONE** | levtrap does not compute it yet |
| **OUT** | out of scope. The *Still valid?* note says whether the reason still holds |

**Agreement** compares the numbers whenever both sides have one. *ok* means within the
accuracy of reading the figure (about 5–10 %). Otherwise it gives the factor.

**Where the numbers come from.** Paper values are stated in the text or read by eye
from figures rendered at 5×. Read values are marked ≈. levtrap values come from
`paper_figures.json`. On 2026-11-25 I spot-checked it against the current engine
(after #64/#66) at R = 292, 298, 300 and 305 nm, and every digit was identical. Values
marked † are new: computed for this checklist with the script's own `setup()`,
`dark_split()` and `solve()` and not stored in the repo (see "Extra checks" at the end).

**Tests.** Today no test asserts any number from this paper. The only overlap is
`tests/test_api.py::test_materials`, which asserts WS₂ n = 3.79 and SiO₂ n = 1.44 at 1550 nm (`pytest.approx`,
rel 1e-6). `tests/test_literature.py` has no dark-trap entry:
`docs/validation/references.json` lists this paper as wanted, not verified
(`illetschek2026_ws2_dark_trap`: the power split is not stated), and has no entry for Magrini 2021 (Ref. [2]).
`app/tests/e2e/ws2-preset.spec.ts` only checks that the preset traps "downstream of
the focus". I ran `pytest tests/test_literature.py tests/test_examples.py
tests/test_lens_mapping.py tests/test_references.py`: 32 passed, 2 xfailed (Jain 2016
and Zheng 2020, not this paper).

**Setup levtrap assumes** (unchanged since M9): WS₂ n = 3.79 + 2.83×10⁻¹⁰ i,
ρ = 7500 kg/m³, vacuum. Two coherent circular(+) LG beams at 1550 nm:
- LG₀₀ with w = 1.59 µm, and LG₁₀ with w = 0.866 µm and phase π.
- Each waist is mapped to an OTT angle by tan θ = λ w_p/(π w), with w_p(LG₁₀) = 1.774. This gives 17.2° and 45.3°.
- The power split is the one that nulls the focal field: P₁ : P₂ = 0.371 : 0.629.
- 0.8 W is the power of the combined coherent beam. That beam carries 1.25 × (P₁ + P₂), so P₁ + P₂ = 0.64 W.

---

## Fig. 1: the dark trap (WS₂, R = 300 nm)

| # | Result | Paper | levtrap | Status | Agreement |
|---|---|---|---|---|---|
| 1a.1 | Bottle-beam intensity, xz plane | Dark core on axis from z ≈ −2λ to +1.3λ; side walls at \|x\| ≈ 1λ; bright on-axis plug at z ≈ 2–3λ. Plotted over x ±2λ, z ±3λ | `fig1a_S1.png` covers only x ±0.65λ, z ±0.77λ. In that window the walls are at \|x\| ≈ 0.6λ and the plugs at z ≈ ±0.75λ | PARTLY | **Bottle is about 1.6× narrower and about 2× shorter.** Suggests the paper's beams converge less than the stated waists give under levtrap's mapping (see ambiguity A3). The plot range does not cover the paper's |
| 1a.2 | Stable axial point (inset, S1a) | z ≈ 0.05–0.1λ (circle centres; Fig. 2a gives 0.047λ at 300 nm) | 0.153λ (`map_all.z_eq`) | EYE (JSON, no test) | **about 3× higher** |
| 1a.3 | Unstable axial point (inset, S1a) | z ≈ 0.85–0.9λ | 0.826λ† | NOT DONE in repo (I computed it) | ok |
| 1b.1 | Multipole content vs λ, 1450–1700 nm | Signed Im of the normalised amplitudes at the **focus** (z = 0). MQ dominates; ED and MD are suppressed; EQ is small and positive | `fig1b.png`: scattered **power** per multipole at **z_eq** (or the focus where unstable), index fixed at 3.79 | PARTLY | Different quantity and different position. MQ dominance is qualitatively the same |
| 1b.2 | MQ resonance position | Dispersive feature with its zero crossing at ≈ 1605–1610 nm (extremes at ≈ 1598 and 1620) | Peak MQ power at ≈ 1630–1640 nm (10 nm grid) | PARTLY | ≈ 25 nm apart. This may be a plotting convention (Im of the amplitude vs \|amplitude\|²), so it is not established |
| 1b.3 | Stable wavelength band (green) at R = 300 nm | ≈ 1465–1590 nm | 1520–1590 nm stable on a 10 nm grid (edges 1510–1520 and 1590–1600)† | NOT DONE in repo (I computed it) | The red edge agrees. **The blue edge is ≈ 50 nm narrower** |

## Table I / Table S1, and quoted inputs

| # | Result | Paper | levtrap | Status | Agreement |
|---|---|---|---|---|---|
| T.1 | n, k, ρ at 1550 nm for WS₂, MoS₂, Si, SiO₂, WSe₂, MoTe₂, MoSe₂ | Table I, Table S1 | `src/levtrap/materials.py`, transcribed. The 1550 nm table values win over SiO₂'s Malitson Sellmeier | PINNED for WS₂ n = 3.79 and SiO₂ n = 1.44 (`tests/test_api.py::test_materials`, `pytest.approx`, rel 1e-6). The other materials' n, k, ρ are transcribed but not asserted | ok |
| T.2 | Mass of WS₂ at R = 298 nm: 0.5×10¹² amu | stated | 5.007×10¹¹ amu (ρ = 7.5) | EYE (arithmetic) | ok |
| T.3 | Mass of SiO₂ at R = 71.5 nm: 1.7×10⁹ amu | stated | 2.03×10⁹ amu with Table I's ρ = 2.20 | NOT DONE | **The paper's own inconsistency:** 1.7×10⁹ needs ρ ≈ 1.84 g/cm³ |
| T.4 | "Densities up to 5× SiO₂" (conclusion) | stated | 9.32/2.20 = 4.2; 9.32/1.85 = 5.0 | — | Holds only with ρ_SiO₂ ≈ 1.85 (as T.3) |

## Fig. 2: stable trapping conditions (WS₂, 0.8 W, radius sweep)

| # | Result | Paper | levtrap | Status | Agreement |
|---|---|---|---|---|---|
| 2a.1 | 3D-stable radius window | 289–307.5 nm (Fig. 2); 288–308 (Fig. 3); 288–307 (Fig. 4) | 292–305 nm (1 nm grid) | EYE (`fig2.png`) | **3 nm narrower at each end.** The window is centred at the same radius (≈ 298.5 nm) |
| 2a.2 | z_eq vs R | U shape: 0.18λ at the edges, flat 0.047λ over ≈ 294–300 nm | U shape: 0.278λ at 292 nm, minimum 0.152λ at 299 nm, 0.224λ at 305 nm | EYE | Shape ok. **The minimum is 3.2× higher** |
| 2b.1 | Axial Ω_z/2π vs R | ≈ 14 kHz at 289 nm, peak ≈ 19 at 291–293, ≈ 16 at 298, ≈ 15 at 300, ≈ 7 at 307 | 24.4 at 292, peak 28.1 at 294–295, 26.0 at 298, 23.8 at 300, 13.2 at 305 | EYE | **1.5–1.8× higher** |
| 2b.2 | Radial Ω_x/2π vs R | ≈ 28 kHz at 289 nm, ≈ 13 at 298, ≈ 11 at 300, ≈ 5 at 307 | 43.3 at 292, 32.9 at 298, 29.9 at 300, 23.6 at 305 | EYE | **1.5–4× higher.** The gap grows with R |
| 2b.3 | "The dark trap has a higher axial frequency than radial" (p. 4) | Text says axial > radial. In the paper's own Fig. 2b that holds only for R ≳ 293.5 nm | Radial > axial at every stable radius (Ω_z/Ω_x = 0.56–0.80) | EYE | **Disagrees** |
| 2c.1 | Q_sca per multipole at z_eq (z = 0 where unstable) | At 298 nm: MQ ≈ 3.5e-5, MD ≈ 4.5e-5, ED ≈ 1.2e-5, EQ ≈ 6.5e-6; sum ≈ 1.0e-4. MQ > MD only for R ≲ 294 nm | P_sca/P per multipole at 298 nm: MQ 1.6e-3, MD 4.4e-4, EQ 3.0e-4, ED 1.1e-4; sum 2.4e-3. MQ ≥ MD across the window | EYE | **About 24× higher in total.** OTT's 4Σ\|p\|² convention (ambiguity A4) accounts for 4×; ≈ 6× remains. MQ dominance lasts longer. ED vanishing near the blue edge matches (paper ≈ 303–307 nm, levtrap ≈ 305) |
| 2c.2 | Jump in Q at the stable/unstable border (z_eq → 0) | yes | yes (same convention in the script) | EYE | ok |
| 2d.1 | Radial depth U_x/k_BT | ≈ 7300 at 289 nm, ≈ 3800 at 300, ≈ 2200 at 307 | 7739 at 292, 5125 at 300, 3810 at 305 | EYE | Left edge ok. **≈ 1.35× higher at 300 nm** |
| 2d.2 | Axial depth U_z/k_BT | Peak ≈ 800 at ≈ 295 nm; ≈ 500 at 300 ("local harmonic approximation", range not stated) | Peak 1367 at 296 nm; 842 at 300 (force integrated to the barrier) | EYE | **≈ 1.7× higher.** The definitions differ (ambiguity A6) |
| 2.t1 | Stable window ≈ region where Re(α_MQ) < 0 (p. 4) | stated | not computed | NOT DONE | — |

## Fig. 3: photon recoil, Γ/Ω_z

| # | Result | Paper | levtrap | Status | Agreement |
|---|---|---|---|---|---|
| 3.1 | WS₂ Γ/Ω_z vs R (red solid) | ≈ 0.45 at 288 nm; minimum ≈ 0.02–0.025; ≈ 0.7 at 308 | 0.94 at 292 nm; minimum 0.235 at 299; 0.84 at 305 (`fig3.png`) | EYE | **≈ 10× higher at the minimum** |
| 3.2 | **Γ/Ω_z = 0.025 at R = 298 nm** (also abstract "≃ 0.02", conclusion "≃ 0.025") | stated | 0.237 | EYE (JSON) | **9.5× higher.** The power cancels in Γ/Ω, so the 0.8 W ambiguity cannot cause this |
| 3.3 | Compensated trap (red dashed), minimum **Γ/Ω_z = 0.0092**; wider stable range | stated; dashed curve spans ≈ 288–310+ nm | Not in the repo. Estimate with the particle held at z = 0 (stiffness and P_sca at the focus)†: minimum 0.154 at ≈ 300 nm (0.038 if P_sca is divided by 4); k_z > 0 from 286 to ≥ 314 nm | NOT DONE (README: "out of scope") | **≈ 17× higher** (4× under the Q/4 convention). *Still valid?* No. A constant force needs no electrostatics model: evaluate at z = 0, or add a uniform force to the Setup |
| 3.4 | SiO₂ at the same radius, bright trap (black solid) | ≈ 4.4 at 285 nm to ≈ 5.65 at 310, ∝ R³ | not computed | NOT DONE | The trap parameters (λ, NA, P) are not stated |
| 3.5 | SiO₂ R = 71.5 nm reference, Γ/Ω_z = 0.18 (Ref. [2], Magrini 2021) | stated | `derived.recoil_ratio` docstring and PLAN note 5 say it is reproduced. No test, no recorded setup | NOT DONE (claimed, not pinned) | — |
| 3.6 | "Nearly an order of magnitude" below Ref. [2] (0.18/0.025 = 7.2); "> two orders" vs SiO₂ of the same radius (≈ 5/0.025 = 200); "≈ 300× lighter" (294) | stated | With levtrap's 0.237, WS₂ is **above** the 0.18 reference | — | **The headline claim does not reproduce** |
| 3.7 | Conclusion: SiO₂ of the same mass has Γ/Ω_z = 20.4, so "3 orders of magnitude" (816×) | stated | not computed. Extrapolating the paper's own SiO₂ line (∝ R³) to the same mass gives 20.4 with ρ = 1.85 g/cm³ (R = 475 nm), or 17.1 with ρ = 2.20 | NOT DONE | Paper consistent only with ρ_SiO₂ ≈ 1.85 (T.3). Its SiO₂ line gives 0.069 at 71.5 nm, not 0.18, so it is a different trap from Ref. [2] |
| 3.8 | Far-field scattering patterns overlaid at R = 290, 295, 300, 305 nm | figure | not computed. The engine has the Mie far field (`pattern`, C2) | NOT DONE | — |
| 3.9 | Γ = ωP_sca/(5mc²Ω₀), with Γ/Ω plotted | formula | `derived.recoil_rate`, `recoil_ratio` = ωP_sca/(5mc²Ω²) | EYE | The convention is confirmed by the paper's own numbers: 0.025 at Ω_z/2π ≈ 16 kHz implies P_sca ≈ 7.8e-5 W = 0.8 W × 0.97e-4, which matches Σ Q in Fig. 2c. So the paper takes **P_sca = P₀·Σ(\|p\|²+\|q\|²) with no factor 4** |

## Fig. 4: internal heating (WS₂, 0.8 W)

| # | Result | Paper | levtrap | Status | Agreement |
|---|---|---|---|---|---|
| 4a | T_eq vs R for k = 2.8e-10, 1e-11, 1e-12, 1e-13 | ≈ 1130→990 K, 900→840, 830→760, 770→690 across the window; melting point 1520 K (the dotted line is drawn at ≈ 1450) | — | OUT ("internal temperature is v2", PLAN §2) | *Still valid?* Only as a plan decision. Two other "v2" items (PSD, share links) have been built since. Needs C_abs(λ) from dispersive k(λ) and a Planck balance (Eq. S1). The goal "replicate all results" puts it back in scope |
| 4b | Absorbed power vs R | ≈ 5.7 nW peak at 284 nm (unstable); ≈ 3 nW at 288; ≈ 0.5 at 295; ≈ 0.3 at 300–305 | 0.23 nW peak at 284–285; 0.04 at 292; 0.010 at 300 (`fig4b.png`) | EYE | **levtrap is 25–30× lower.** levtrap's P_abs/P_sca = 5.7e-9 equals Mie Q_abs/Q_sca for k = 2.83e-10. The paper's ratio (≈ 0.3 nW / 78 µW ≈ 4e-6) is ≈ 600× that. levtrap's P_abs is independently tested (volume integral, `test_analytic`), so the paper's value is the suspect one (ambiguity A9) |

## Supplement

| # | Result | Paper | levtrap | Status | Agreement |
|---|---|---|---|---|---|
| S1a | Total-force map (r, z), stable and unstable points | stable ≈ 0.03–0.05λ, unstable ≈ 0.85λ | stable 0.153λ, unstable 0.826λ† (`fig1a_S1.png` left) | EYE | Stable point **3–5× higher**; unstable point ok |
| S1b | MQ-only force: stable ≈ 0.1λ, unstable ≈ 0.78λ | figure | `map_mq.stable = false`: F_z > 0 everywhere on axis from −0.39λ to 1.29λ† | EYE | **Disagrees.** levtrap finds no trap with MQ alone |
| S2a | z_eq vs R for 5 TMDs | Windows (nm): MoTe₂ 226–239, MoSe₂ 259–276, WSe₂ 274–292, WS₂ 289–308, MoS₂ 291–311. Minimum z_eq/λ: ≈ 0.017, 0.025, 0.03, 0.047, 0.047 | Windows: 228–239, 261–275, 276–291, 292–305, 294–307. Minimum z_eq/λ: 0.051, 0.090, 0.116, 0.152, 0.159 (`figS2.png`) | EYE | Windows within 1–4 nm. **Minimum z_eq 2.5–4× higher** |
| S2b | Axial (solid) and radial (dashed) frequency vs R | Peak axial ≈ 24.5, 22.5, 18, 19, 22 kHz; peak radial ≈ 47, 40, 31, 31, 37 (same order as S2a) | Peak axial 39.1, 35.6, 28.2, 28.1, 33.5; peak radial 58.0, 55.7, 43.0, 43.3, 51.7 | EYE | **1.4–1.6× higher.** The paper draws radial curves also where z is unstable; levtrap does not |
| S3 | Γ/Ω_z vs R for 5 TMDs, with a SiO₂ R = 73 nm reference (≈ 0.17) | Minima ≈ 0.07 (MoTe₂), 0.1 (MoSe₂), 0.04 (WSe₂), 0.02 (WS₂), 0.01–0.015 (MoS₂) | Minima 0.054, 0.106, 0.151, 0.235, 0.255 (JSON only, no plot) | PARTLY (no figure) | MoTe₂ and MoSe₂ ok. **WSe₂ ≈ 4×, WS₂ ≈ 10×, MoS₂ ≈ 20× higher** |
| S4 | C_abs(λ) and spectral emitted power, WS₂ R = 300 nm, 400–1600 nm | C_abs peak ≈ 3e-13 m² near 620 nm, ≈ 0 beyond ≈ 940 nm; emission peak ≈ 0.84e-5 W/m at ≈ 870 nm | — | OUT (needs dispersive n,k data) | *Still valid?* The data are the blocker, not the physics: Mie C_abs(λ) is one T-matrix per λ |
| S5 | T_eq vs R for MoS₂, MoSe₂, MoTe₂, WSe₂ at several k | e.g. MoSe₂ (k = 1e-7) ≈ 1300–1700 K, **above its stated > 1470 K limit** at large R; MoTe₂ (k = 3e-8) ≈ 900 K vs 1000 K decomposition | — | OUT | as 4a |

---

## Counts

38 rows. Two (T.4 and 3.6) are the paper's arithmetic with no levtrap computation, so they have no status.

| Status | Rows | Which |
|---|---|---|
| PINNED | **1** | T.1, and only for WS₂ n and SiO₂ n at 1550 nm. **No figure value from the paper is asserted anywhere** |
| EYE | 19 | 3 agree (T.2, 2c.2, 3.9). 2 are mixed: 2a.1, where the window is 3 nm narrower at each end, and S1a, where the unstable point is ok and the stable point is off. **14 disagree** beyond reading tolerance: 1a.2, 2a.2, 2b.1, 2b.2, 2b.3, 2c.1, 2d.1, 2d.2, 3.1, 3.2, 4b, S1b, S2a (z_eq), S2b |
| PARTLY | 4 | 1a.1, 1b.1, 1b.2, S3 |
| NOT DONE | 9 | 1a.3, 1b.3, T.3, 2.t1, 3.3, 3.4, 3.5, 3.7, 3.8 |
| OUT | 3 | 4a, S4, S5 |

What agrees: the qualitative picture and the stable windows (within 1–4 nm at each end, for all five TMDs):
- a finite radius window on the blue side of the MQ resonance;
- z_eq traces a U shape across it;
- the unstable axial point sits at ≈ 0.83λ;
- radial depths are several thousand k_BT.

What disagrees, in rough order of how much of the paper rests on it:
- Γ/Ω (9.5× at 298 nm). This is the paper's headline;
- z_eq (3×);
- Q_sca (24×, or 6× after the factor 4);
- P_abs (25–30×, the other way);
- MQ-only trap absent;
- axial vs radial ordering;
- frequencies (1.5–4×);
- bottle size.

## Ambiguities in the paper, and what the repo assumed

| | Not specified | levtrap assumes | Sensitivity (checked †) |
|---|---|---|---|
| A1 | Power split between LG₀₀ and LG₁₀ | Split that nulls the focal field, 0.371 : 0.629 | **Large.** 50/50: window 295–301 nm, z_eq min 0.32λ, Γ/Ω min 1.12. Paraxial null ratio (w₁/w₂)² (0.771 : 0.229): no stable radius. The dark split is the best of the three |
| A2 | Is "0.8 W" P₁ + P₂, or the combined beam? | Combined coherent beam (= 1.25 (P₁+P₂) for this split) | Frequencies scale as √P and depths as P. **z_eq, the window and Γ/Ω do not depend on it.** Reading it as P₁+P₂ = 0.8 W would raise levtrap's frequencies 1.25×, away from the paper |
| A3 | How a waist becomes an OTT `BscPmGauss` beam | tan θ = λ w_p/(π w), w_p(LG₁₀) = 1.774 → 17.2°, 45.3° | Frequencies sensitive: at 298 nm Ω_z/Ω_x = 26.0/32.9 kHz (levtrap), 9.2/13.4 (no w_p, 29.7°), 13.9/19.3 (sin θ = λ/πw, 34.7°). **z_eq (0.15–0.16λ), window (292–305) and Γ/Ω (0.24–0.27) barely move.** Fig. 1a's larger bottle points at a different beam |
| A4 | Normalisation of Q_sca = Σ(\|p\|²+\|q\|²) | Physical power, 4Σ\|p\|² (OTT's outgoing amplitude is 2p) | 4× on P_sca and Γ/Ω. The paper's own numbers imply no factor 4 (row 3.9). Even with it removed levtrap is 2.4× (Γ/Ω) to 6× (Q) higher |
| A5 | Γ convention | Γ/Ω = ωP_sca/(5mc²Ω²) | Confirmed by the paper's internal consistency (row 3.9) |
| A6 | Axial depth "local harmonic approximation", over what Δz | Force integrated to the barrier | ≈ 1.7× at the peak |
| A7 | Circular handedness of each beam; relative phase reference | Both circular+, phase π on LG₁₀ | Not checked |
| A8 | Index vs wavelength in Fig. 1b | n fixed at 3.79 + 2.83e-10 i (no dispersion data) | Shifts the resonance position; would move 1b.2 and 1b.3 |
| A9 | Which k, and which method, gives P_abs (Fig. 4b) | k = 2.83e-10, P_abs from the beam and T-matrix | The paper's P_abs/P_sca is ≈ 600× the Mie ratio |
| A10 | SiO₂ bright-trap parameters (λ, NA, P) for Fig. 3 and the "20.4" | — | The SiO₂ line ∝ R³ fits 20.4 only with ρ ≈ 1.85 g/cm³, against Table I's 2.20 |
| A11 | The SiO₂ reference radius | — | 71.5 nm in the main text, 73 nm in Supp. Fig. S3. The S3 label says Ref[7] (Lepeshov), the caption says [6] (Magrini) |
| A12 | MoS₂ k | Table k = 2.37e-11 | Fig. S5's top MoS₂ curve is labelled 1.9e-10 |
| A13 | OTT version, Nmax, and the force/stress-tensor surface | OTT 1.5 port, Nmax beam 22 / particle 5 | Not checked |
| A14 | Fig. 3 dashed line: what the compensating force is and where it holds the particle | (not modelled) | Estimate †: assume z = 0 |

## levtrap agrees with OTT on this trap (2026-11-25)

The paper's trap was run in OTT itself (MATLAB R2025a, OTT v1 master @ e6736643, the
commit levtrap ports) with the inputs levtrap uses, WS₂ at R = 298 nm. OTT did every
step on its own: the waist → angle mapping, the split that darkens the focus, the
coherent LG₀₀ + LG₁₀ sum with phase π, the Mie T-matrix and the forces. levtrap matches it:

| Quantity | levtrap vs OTT |
|---|---|
| Beam angles (17.24°, 45.30°) and dark split (0.3708 : 0.6292) | rel 1e-12 / 1e-9 |
| The 528 beam coefficients of the combined beam (Nmax 22) | rel ≈ 3e-15 |
| Axial force, z = ±1.5 µm (61 points); radial force at z = 0.236 µm (25 points) | rel ≈ 1e-14 |
| Solver's z_eq vs the zero of OTT's axial force | within 0.01λ (the grid) |

**So the disagreements with the paper are not in levtrap's code.** OTT, given the
same inputs, gives the same trap. They come from what went into OTT (the beams,
split, Nmax) or from how the outputs became the reported numbers (the factor 4 in
P_sca, P_abs), or from errors in the paper. This rules out gap 1(c) below. Pinned
by `tests/test_ott_dark_trap.py` against `tests/fixtures/ott_dark_trap.json`, which
`scripts/ott/dark_trap_reference.m` regenerates.

## Gaps, ranked by importance (to close step 1)

Hoang's issues #72, #78, #79 and #80 (all closed) are linked from the gap they help with.

1. **Find why z_eq, Q_sca and Γ/Ω are off.** These gaps survive every split, mapping and
   power reading tried above, so they are not just ambiguity. They are also not in levtrap's
   code: real OTT gives the same trap (section above). In order:
   - **(a)** Ask the authors for their OTT script, or at least the beam calls, the split and Nmax. This is the cheapest path (`README.md` already lists the questions; add A9, A10 and the Fig. 1a bottle size).
   - **(b)** Meanwhile, reproduce Fig. 1a's *intensity* over the paper's full ±2λ × ±3λ. Fit the beam angles and split so that the wall and plug positions match. Then rerun Fig. 2. The app's Sweep can now scan a coherent pair's split and phase, and "Darken the focus" sets the dark split (#79); an NA sweep keeps the lens's mapping and starts from the actual NA of a lens given by its waist, as the WS₂ preset's are (#72). The intensity alone, with no particle, is the cleanest fingerprint of their beam.
   - **(c)** ~~Test whether levtrap's LG p = 1 mode or coherent sum differs from OTT's.~~ Done: identical to OTT 1.5 (section above). What's left is whether the authors used another OTT version, for example a draft 1.6 with `mergeBeams`.
   - **(d)** Re-derive Q with and without the factor 4 in the JSON, and label the plots with the convention.
   - **(e)** Compare Γ/Ω like for like. The paper uses only the scattered-photon formula ωP_sca/(5mc²Ω²) (row 3.9). The app's recoil (#78) uses the Mie pattern's ⟨n n⟩ and adds the beam photons and a cross term, so its Γ/Ω is not the paper's quantity; for the WS₂ preset along z it shows 0.72 in total (0.20 from the scattered photons), where ωP_sca/(5mc²Ω_z²) gives 0.24.
2. **Pin what exists.** Add `tests/test_paper_2607.py`, fast because each point solves in about 1 s:
   - regression checks of today's numbers (window 292–305 nm; z_eq(300) = 0.153λ; Ω(300) = 23.8/29.9 kHz; Γ/Ω(298) = 0.237; MQ-only has no trap; ±2 % or ±1 nm);
   - the paper's values as `xfail` with an issue number.
   
   Alternatively, add a `dark_trap` entry to `references.json` with `known_disagreement`, so C4 reports it. Today nothing stops the numbers drifting: `paper_figures.json` is regenerated only by hand.
3. **Open an issue for the P_abs discrepancy (4b).** levtrap matches Mie; the paper is ≈ 600× above Mie relative to its own P_sca. Ask the authors.
4. **Compute what is cheap and missing:**
   - compensated trap, 3.3: constant force, or evaluate at z = 0;
   - stable wavelength band, 1b.3, into the script and JSON;
   - unstable axial point, 1a.3;
   - far-field patterns, 3.8, with the existing `pattern`;
   - the Fig. S3 plot;
   - signed Im amplitudes at z = 0 for Fig. 1b, to match the paper's quantity. The scattered power per multipole is now in a Result at the equilibrium and under More in the app (#80); the signed amplitudes are not;
   - Re(α_MQ) < 0 against the window, 2.t1.
5. **SiO₂ bright-trap comparisons (3.4, 3.5, 3.7).** Needs Magrini 2021's trap parameters from that paper (C3-style read), then a verified `references.json` entry for the 0.18. The 20.4 then follows from the same-mass radius, provided the density question (T.3) is settled.
6. **Decide on scope for internal temperature (4a, S4, S5).** It needs:
   - dispersive n,k(λ) for each TMD over ≈ 0.4–20 µm (refs [46, 48] in the paper);
   - C_abs(λ) from Mie at each λ;
   - a Planck balance, P_abs(1550) = ∫ C_abs B_λ(T) dλ (Eq. S1).

   The physics is small; the data are the work. Without it, step 1 cannot claim "all results".

## Extra checks (†) and how they were made

All with `examples/paper_2607_09896.py` imported as a module, the current engine, on 2026-11-25:

- **A1 and A3:** radius sweeps 280–315 nm with `split` replaced, or with each beam's focus replaced by `angle_deg`.
- **Axial zeros (1a.3, S1b):** F_z along the axis on 261 points from −0.6 to 2.0 µm (`forcetorque`, with and without the MQ-only multipole mask).
- **Stable wavelength band (1b.3):** `solve` at R = 300 nm, 1440–1710 nm, 10 nm steps.
- **Compensated trap (3.3):**
  - k_z, k_x by central difference (±5 nm) at the focus;
  - P_sca at z = 0 from `multipole_powers`;
  - Γ/Ω from `recoil_ratio`.

  The force needed to hold the particle at the focus is 4.3 pN at 300 nm, ≈ 500× its weight.
- **Mass and density checks (T.2–T.4, 3.7):** by hand.
