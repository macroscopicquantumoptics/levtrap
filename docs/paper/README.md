# Reproducing arXiv:2607.09896 with levtrap

P. Illetschek *et al.*, "Dark optical trapping of resonant transition-metal
dichalcogenide particles", arXiv:2607.09896 (2026).

Regenerate everything with

```bash
pip install -e . matplotlib
python examples/paper_2607_09896.py      # ~6 min, writes docs/paper/*.png + paper_figures.json
```

The script computes every trap with `levtrap.solve.solve` (equilibrium,
frequencies, depths, scattered and absorbed power). The force map over the
intensity (Fig. 1a/S1) is not part of a Result; the script computes it from
the same beam and T-matrix (`levtrap.api.build_beam`, `build_tmatrix`), and
the MQ-only case with the engine's multipole mask, which the app does not
offer. The scattered power per multipole (Figs. 1b, 2c) is in a Result at the
equilibrium (`optical.P_sca_multipoles`, #80) and under More in the app;
the script computes it itself so that a wavelength with no equilibrium is
taken at the focus, and `tests/test_multipoles.py` checks that the two agree
for the 300 nm sphere. The power split that darkens the focus is computed
in the script (`dark_split`); the app has no such helper.

The trap itself can be built in the app (two coherent LG beams, circular
polarisation, phase π), and it is the preset "WS₂ bottle beam (dark trap)"
(#52). The preset is marked illustrative: the paper does not give the power
split, so the preset uses the one that darkens the focus, and no dark-trap
number is checked against the paper in docs/validation.

| Paper figure | levtrap output | In scope? |
|---|---|---|
| 1(a) intensity + force arrows | `fig1a_S1.png` (left); in the app later (#48) | yes |
| 1(b) multipole amplitudes vs λ | `fig1b.png` (scattered **power** per multipole, not signed Im amplitudes) | yes |
| 2(a–d) z_eq, Ω, Q_sca by multipole, depth vs radius | `fig2.png` | yes |
| 3 Γ/Ω_z vs radius (WS₂) | `fig3.png` (WS₂ only) | partly — the SiO₂ bright-trap comparison needs its beam parameters; the electrostatic compensating force is out of scope |
| 4(a) equilibrium temperature | — | no (internal temperature is v2) |
| 4(b) absorbed power | `fig4b.png` | yes |
| S1 total vs MQ-only force | `fig1a_S1.png` | yes |
| S2 other TMDs: z_eq, Ω | `figS2.png` | yes |
| S3 Γ/Ω for TMDs | data in `paper_figures.json` | yes |
| S4, S5 spectra / temperatures | — | no (needs dispersive k(λ) data and thermal model) |

## How close is it?

**levtrap and OTT give the same trap.** Run in OTT itself (MATLAB, OTT v1 @
e6736643) with the same inputs, the beam coefficients and the axial and radial
forces agree with levtrap to about 1e-14, and the solver's z_eq sits on OTT's
force zero (`tests/test_ott_dark_trap.py`). The differences from the paper listed
below are therefore not in levtrap's code: they come from the inputs or conventions
the paper doesn't state, or from the paper. The result-by-result audit is in
[`CHECKLIST.md`](CHECKLIST.md).

The values below are approximate readings from the published figures, not
numbers stated in the text.

* **Same structure.** A finite window of radii gives a 3D-stable dark trap
  above the focus. The window sits on the blue side of the MQ resonance, and
  z_eq traces a U-shape across it. The MQ term dominates the scattering, and
  radial depths are several thousand k_BT.
* **Stable window:** levtrap ≈ 292–305 nm; paper ≈ 289–307 nm.
* **z_eq:** levtrap minimum ≈ 0.15 λ₀; paper ≈ 0.05 λ₀.
* **Frequencies (0.8 W):** levtrap gives radial > axial (≈ 24–43 kHz radial,
  ≈ 13–28 kHz axial). The paper reports axial > radial (≈ 18 kHz axial).
* **Depths:** levtrap radial ≈ 3800–7700 k_BT and axial up to ≈ 1370 k_BT;
  paper radial ≈ 6000–7000 k_BT and axial ≈ 1000 k_BT.
* **Γ/Ω_z at R = 298 nm:** levtrap ≈ 0.24; paper 0.025.
* **MQ-only map (S1b):** the paper finds a stable point with MQ alone. In
  levtrap the MQ-only force has no stable axial zero for this beam.

## Open questions for the authors

The quantitative differences most likely come from beam details the paper
doesn't specify:

1. **Power split** between the LG₀₀ (w = 1.59 µm) and LG₁₀ (w = 0.866 µm)
   beams, and what "0.8 W" refers to. levtrap chooses the split that nulls
   the field at the focus (component ratio P₁ : P₂ ≈ 0.37 : 0.63 with OTT's
   non-paraxial beams). It takes 0.8 W as the power of the combined coherent
   beam; the two beams are not orthogonal, so this differs from P₁ + P₂. Was
   the split 50/50, the paraxial dark-focus ratio (w₁/w₂)² ≈ 3.37, or
   something else? And is 0.8 W the power of the combined beam, or P₁ + P₂?
2. **How the waists entered OTT.** Was it `BscPmGauss` with `angle` from
   tan θ = λ w_p/(π w₀) (levtrap's mapping, w_p = `paraxial_beam_waist`), or
   with NA? Was the plain LG waist used for the p = 1 mode?
3. **Q_sca normalisation.** In Fig. 2(c), is Q_sca = Σ(|p|²+|q|²) taken
   directly from OTT's 'scattered' coefficients? OTT's physical outgoing
   amplitude is 2p, so the scattered power is 4Σ|p|². This factor feeds
   into P_sca and Γ.
4. **Axial depth.** The paper describes "a local harmonic approximation based
   on the axial stiffness". Over what distance? levtrap integrates the force
   along z up to the barrier.
5. **Γ convention.** Is Γ/Ω = ωP_sca/(5mc²Ω²)? That is Γ = ωP_sca/(5mc²Ω)
   from the text, divided by Ω.
