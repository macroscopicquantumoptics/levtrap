# Literature reference values

Published experiments that levtrap should reproduce: one per trap type, each
with the parameters to build a Setup and the measured numbers to compare
against. They feed the validation tests (C4) and the presets (D6).
Machine-readable copy: [`references.json`](references.json).

## Status

All seven candidate papers were read in full (C3, issue #15), from their
arXiv full text. C4 (#16) read about thirty more, listed at the end; five
are recorded here. The journal versions were not available here; where a
journal version may differ, the entry says so.

| Slot | Entry | Status |
|---|---|---|
| Single-beam high-NA tweezer, silica, vacuum | Jain 2016 | **verified** (two entries); disagrees, issue #61 |
| Single-beam high-NA tweezer, silica, vacuum | Zheng 2020 | **verified**, frequency ratios only; f_y/f_x agrees, f_y/f_z disagrees, issue #70 |
| Counter-propagating / standing wave | Yoneda and Aikawa 2017 | read; not verifiable: elliptical focus, return pass not described |
| Linear Paul trap, nanoparticle | Dania 2024 | read; not verifiable: trap drive and geometry not reported |
| Ring / wheel Paul trap | Millen 2015 | read; not verifiable, and not a ring trap: a better paper is wanted |
| Hybrid Paul + optical | Conangla 2020 | read; not verifiable: parameter ranges only |
| Hybrid Paul + optical | Bonvin 2024 | read; not verifiable: no combined-trap frequencies |
| Parabolic mirror | Vovrosh 2017 | read; not verifiable: input beam and focal power not stated |
| Counter-propagating / standing wave | Kamba and Aikawa 2023 | read (C4); not verifiable: focal power, returned fraction, focus positions |
| Linear Paul trap, nanoparticle | Bykov 2019 | read (C4); not verifiable: charge from the radial frequencies; a factor of two in the end-cap term |
| Parabolic mirror | Dinter 2024 | read (C4); not verifiable: beam diameter only as an undefined filling factor |
| Dark trap (WS₂, two LG beams) | Illetschek 2026 | read (C4); not verifiable: the power split is not stated |

**What "verified" means.** Every parameter of the Setup and every expected
value was read from the paper, with its page, figure or table. Each one is
flagged:
- **stated**: printed in the paper;
- **inferred**: worked out from printed values, with the working shown;
- **assumed**: not in the paper, but levtrap needs a value; the entry says
  why the expected quantities do not depend on it.

**The papers that are only "read".** They lack parameters a Setup needs.
Their stated values are below, with locations, so a later session (or a
better paper) can complete them. No gap was filled from memory.

The rule stays: if a parameter is not in the paper, it is "not stated", and
the entry says how that weakens the comparison.

## Validation (C4)

- **Tests.** `tests/test_literature.py` solves every verified entry and
  compares it at its tolerance.
- **The table.** `README.md` in this folder is generated
  (`python3 -m levtrap.validation`), alongside the cross-checks between
  levtrap's own models.
- **Disagreements.** An entry that disagrees gets an issue and
  `"known_disagreement": {"issue": N}`, which marks its test xfail. Its
  tolerance is never widened to make it pass. Both Jain entries carry #61.

## Verified

### Jain *et al.* 2016: single-beam tweezer

**Citation.** V. Jain, J. Gieseler, C. Moritz, C. Dellago, R. Quidant,
L. Novotny, "Direct Measurement of Photon Recoil from a Levitated
Nanoparticle".
- Phys. Rev. Lett. **116**, 243601 (2016),
  DOI [10.1103/PhysRevLett.116.243601](https://doi.org/10.1103/PhysRevLett.116.243601).
- Read from arXiv [1603.03420](https://arxiv.org/abs/1603.03420) v2,
  including the supplement (PDF pp. 6–9). The title and authors were checked
  on the PDF. The preprint does not print the journal or the DOI.

**Setup** (`jain2016_recoil`, and `jain2016_recoil_r527` for the second
particle):

| Parameter | Value | Flag | Where |
|---|---|---|---|
| Wavelength | 1064 nm | stated | p. 2 |
| Power | 70 mW, called "focal power" | stated | p. 2; Fig. 3, 4 captions. Where it was measured is not stated |
| Focus | objective, NA 0.9 | stated | p. 2. Filling factor and effective NA not stated |
| Polarisation | along x (z along the beam) | stated | p. 2 |
| Particle | fused silica, n = 1.45, ρ = 2200 kg/m³ | stated | p. 2–3 |
| Radius | 49.8 nm (Figs. 2, 3); 52.7 nm and 71.6 nm (Fig. 4a); 68.0 nm (Fig. 4b) | stated | captions, p. 3–4. No uncertainty or method given |
| Mass | 1.14 × 10⁻¹⁸ kg at 49.8 nm | stated | p. 3. levtrap gets 1.138 × 10⁻¹⁸ |
| Pressure | 2 × 10⁻⁸ mbar (Fig. 2); 3 × 10⁻⁸ mbar (Fig. 4a), i.e. 2 × 10⁻⁶ and 3 × 10⁻⁶ Pa in the Setup | stated | captions. C3 first entered the mbar values as Pa, 100× too low (fixed for #61) |
| Gas, temperature, mode | N₂, 300 K, Gaussian | assumed | not stated. Gas and temperature set the gas heating, which the R = 52.7 nm entry compares (He instead of N₂ lowers it 2.6×) |

**Measured:**

| Quantity | Value | Conditions | Where |
|---|---|---|---|
| fx, fy, fz | 123, 150, 49 kHz | R = 49.8 nm | p. 2 |
| fy | 148.8 kHz; 151.2 kHz | R = 52.7 nm; R = 71.6 nm | p. 4 |
| Reheating, y (the paper's "Γrecoil") | (20.9 ± 0.2) × 10³ /s; (29.4 ± 0.3) × 10³ /s | R = 52.7 nm; R = 71.6 nm; 70 mW; 3 × 10⁻⁸ mbar | p. 4, Fig. 4a |
| Reheating, y | (19.4 ± 0.1) × 10³ /s at 30.5 mW; (38.0 ± 0.3) × 10³ /s at 80 mW | R = 68.0 nm; powers "inferred" by the authors; 7 × 10⁻⁹ mbar | p. 4, Fig. 4b |
| Gas damping | γth ≈ 15.8 R² P_gas / (m v_rms) | below 10 mbar | Eq. 7. levtrap's agrees to 2 % (`test_rates.py`) |

**The paper's own theory.** Its paraxial predictions are 15.5 and
38.2 × 10³ /s for the Fig. 4a particles, and 21.5 and 35.8 × 10³ /s for
Fig. 4b. So the paper agrees with its own model to about 30 %.

**Agreement.** levtrap's lens is an ideal aplanatic focus filled to NA 0.9,
with all 70 mW at the focus.
- **Frequencies.** Expected within tens of percent; the tolerance is ±20 %.
- **Reheating.** What the paper measures is the total reheating with the
  feedback off (Eq. 12): recoil plus gas. The paper calls it Γrecoil because
  it takes the gas heating to be negligible below 10⁻⁷ mbar. levtrap's gas
  heating at 3 × 10⁻⁸ mbar (N₂) is 5.7 × 10³ /s, about as large as its
  recoil (6.2 × 10³ /s). So the entry compares `reheating.y`, gas plus
  recoil; the tolerance is ±35 %.
- **Result.** levtrap is 23–57 % stiffer (151, 210, 77 kHz). Its reheating is
  11.9 × 10³ /s against the measured 20.9 × 10³, 0.57×.
  - The focus explains most of the rest: with the frequencies matched (a
    filled objective at 0.7, #63), levtrap gives 14.8 × 10³ /s.
  - The gas is not stated: He instead of N₂ would lower the gas heating 2.6×.
  - Both are tracked in issue #61.
- **Ratios.** fx/fy = 0.820 and fz/fy = 0.327 do not depend on the power.
  levtrap gives 0.719 and 0.367 with the stated focus. No filling of an ideal
  NA 0.9 objective matches both: 0.7 gives 0.824 and 0.356, 1.0 gives 0.781
  and 0.353, and fz/fy reaches 0.332 only at 0.5, where fx/fy is 0.883. The
  axial is 7–10 % too stiff, as for Zheng 2020 (#70).
- **The sources for the filling (#61).** None states it:
  - Jain's thesis (V. Jain, "Levitated optomechanics at the photon recoil
    limit", Diss. ETH No. 24440, 2017) describes the same data (ch. 4) but
    no beam diameter or objective model: the fibre output "is then fed
    directly into the trapping objective in the vacuum chamber" (p. 32).
    Its only statement on the focus is a model: "For an objective with
    NA = 0.90, the waist is 1.7 times larger than the paraxial estimate"
    (p. 96). It gives x = 129 kHz for the data the PRL gives as 123 kHz
    (p. 73).
  - Gas: "a combination Pirani and ion gauge (InstruTech Hornet and IGM402
    Module)" (p. 33); the chamber was baked, backfilled with dry nitrogen
    and pumped to 3 × 10⁻⁸ mbar (p. 34). No composition was measured, so
    N₂ stays an assumption.
  - Frimmer et al. (arXiv 1608.00998, 1704.02289) on a 100× NA 0.9 objective
    in the same lab: 46/115/141 kHz at "≈ 50 mW", the same ratios as Jain
    to 0.5 %, but their power is 24 % off Jain's calibration
    (f²/P = 398 against 315–331 kHz²/mW), so only the ratios carry over.
  - Gieseler's thesis (ICFO 2014) is a different trap (Nikon 50×, NA 0.8);
    Tebbenjohanns' thesis (ETH 2020) is Jain's apparatus with a later
    objective (Olympus NA 0.85, "overfilled").

### Zheng *et al.* 2020: single-beam tweezer, frequency ratios

**Citation.** Y. Zheng, L.-M. Zhou, Y. Dong, C.-W. Qiu, X.-D. Chen,
G.-C. Guo, F.-W. Sun, "Robust optical-levitation-based metrology of
nanoparticle's position and mass". Read from arXiv
[2002.02320](https://arxiv.org/abs/2002.02320) v1, with its supplement; the
journal version was not available here.

**Stated (supplement p. 7–8 unless noted):**
- 1064 nm, "linearly polarized along X axis";
- a Nikon CFI LU Plan Fluor EPI 100X, "the numerical aperture (NA) of the
  objective was 0.9";
- "a Gaussian intensity distribution with a beam diameter of 4.5 mm which
  was measured with a CCD camera beam profiler", and "The back pupil
  diameter of the objective was 3.6 mm";
- R = 75.4 ± 1.5 nm and ρ = 2.02 ± 0.10 g/cm³ (p. 4, Table II), from the gas
  damping with an independently calibrated mass; air at 298 K (Table II);
- "∼ 200 mW" of laser (p. 5), where it was measured not stated.

**Inferred.** `filling` = 4.5 / 3.6 = 1.25, the diameter taken as the 1/e²
one.

**Measured.** "the natural frequency ratio between X, Y, and Z should be
1.31 : 1 : 2.93, comparing with the experimental result 1.27 : 1 : 3.07"
(p. 8). These are f_Y/f_i: with f_X = 135 450 Hz (Table II), f_Y = 172 kHz,
where Fig. 6b's Y sweep lies.

**Assumed.** n = 1.45 and the pressure (1e-3 Pa, the pressure of Fig. 6);
the power is the stated 200 mW. Frequency ratios depend on none of them.

**Comparison.** Only `frequency.y/frequency.x` and `frequency.y/frequency.z`:
the power at the focus is not stated, and the ratios depend on the shape of
the focus alone. The tolerance, ±5 %, is how far the paper's own model of an
ideal objective (1.31, 2.93) misses its measurement; levtrap models the same
ideal objective.

**Result.** levtrap gives 1.302 (+2.5 %, agrees) and 2.859 (−6.9 %,
disagrees): its axial frequency is too stiff, as for Jain 2016 (z/y 7–10 %
high at any filling). In the dipole limit levtrap gives 1.311 and 2.879,
next to the paper's model. Tracked in issue #70.

## Read, not verifiable

### Yoneda and Aikawa 2017: standing wave

**Citation.** M. Yoneda, K. Aikawa, "Thermal broadening of the power spectra
of laser-trapped particles in vacuum", J. Phys. B **50**, 245501 (2017),
DOI 10.1088/1361-6455/aa95ab. Read from arXiv
[1708.07572](https://arxiv.org/abs/1708.07572) v1. The journal and DOI are
not printed on it.

**Trap.** A single 1550 nm beam is retro-reflected into a standing wave, a
one-dimensional lattice (p. 1). So it does fill the standing-wave slot.

**Stated:**
- about 300 mW (p. 1);
- elliptical waists of about 1.7 µm and 2.0 µm in x and y, made with a pair
  of cylindrical lenses (p. 1, Fig. 1);
- a "high-numerical-aperture lens", NA not given;
- silica, εr = 2.1, radii "of about 60 nm", individually 20–120 nm (p. 2, 7;
  Fig. 8);
- air, 0.6–600 Pa.

**Measured:**
- frequencies "about 36, 54, and 230 kHz × 2π" in x, y, z, with z along the
  lattice (p. 1–2);
- thermal broadening exponents −0.44(1), −0.39(1) and −0.44(2) (p. 8, Fig. 9);
- peak intensity 21 MW/cm² (p. 8).

**Missing:**
- the power and focus position of the returning pass, and the fringe contrast;
- the NA of either pass;
- polarisation;
- density;
- the radius of the particle whose frequencies are quoted.

**Why it is not verified.**
- The elliptical focus cannot be expressed in the Setup.
- The reader also noted that the frequency ratio fy/fx = 1.5 does not match
  the stated waist ratio of 1.18 (inferred). That suggests the waists, or
  their x/y labels, are approximate.

### Dania *et al.* 2024: linear Paul trap

**Citation.** L. Dania, D. S. Bykov, F. Goschin, M. Teller, A. Kassid,
T. E. Northup, "Ultrahigh Quality Factor of a Levitated Nanomechanical
Oscillator", Phys. Rev. Lett. **132**, 133602 (2024),
DOI 10.1103/PhysRevLett.132.133602. Read from arXiv
[2304.02408](https://arxiv.org/abs/2304.02408) v2, with its supplement.

**Stated:**
- four rods of 1 mm diameter and two end caps (Suppl. App. A, E);
- a particle-to-electrode distance of 0.92 mm (p. 4; 0.9 mm in App. E);
- silica, nominal diameter 300 nm, likely a dumbbell (p. 2);
- m = 4.3(4) × 10⁻¹⁷ kg and q = +300(30) e (p. 2);
- pressures from 1.2 × 10⁻⁴ down to 7 × 10⁻¹¹ mbar (p. 2).

**Measured:**
- Ωz/2π = 1.28 kHz (p. 2);
- γ/2π = 69(22) nHz at 7 × 10⁻¹¹ mbar, Q = 1.8(6) × 10¹⁰ (p. 2–3);
- a gas-damping slope of 0.9(2) kHz/mbar (Fig. 3).

**Missing:**
- RF amplitude and frequency;
- DC and end-cap voltages;
- r0 and z0 (0.92 mm is not said to be either), and geometry factors;
- radial frequencies.

**Why it is not verified.** The paper does not report its trap drive. The
group's earlier papers (Bykov 2019, Dania 2021) may, for a related trap.

### Millen *et al.* 2015: Paul trap in a cavity (not a ring trap)

**Citation.** J. Millen, P. Z. G. Fonseca, T. Mavrogordatos, T. S. Monteiro,
P. F. Barker, "Cavity Cooling a Single Charged Levitated Nanosphere", Phys.
Rev. Lett. **114**, 123602 (2015), DOI 10.1103/PhysRevLett.114.123602. Read
from arXiv [1407.3595](https://arxiv.org/abs/1407.3595) v3 (titled "Cavity
cooling a single charged nanoparticle"), with its supplement.

**Trap.** "Two rounded electrodes separated by 1 mm", enclosed by grounded
cylindrical shields (p. 2, Fig. 1a). It is neither a ring nor a linear trap.

**Stated:**
- RF amplitude 300–900 V (p. 2), although Fig. 2b reads "600 Vp-p";
- ωd = 2π × 1500 Hz and zero DC (p. 2; Suppl. p. 5);
- silica, radius 209 nm (p. 2), with 200 nm in Suppl. p. 6;
- 1–3 elementary charges;
- pressures from 10⁻⁶ to 0.2 mbar.

**Measured.** Secular frequencies only "of order 100 Hz" (Suppl. p. 6). The
model in Fig. 5a uses 2π × 100 Hz. A peak near 0.13 kHz can be read from
Fig. 3b, with the cavity light on.

**Missing:**
- r0 or any electrode dimension besides the gap, and the geometry factor;
- density;
- an RF amplitude, charge and secular frequency for the same run.

**Why it is not verified.** The geometry is not a ring trap, and r0 is not
given. A better-documented ring or wheel trap paper is wanted for this slot.

### Conangla *et al.* 2020: hybrid Paul + optical

**Citation.** G. P. Conangla, R. A. Rica, R. Quidant, "Extending vacuum
trapping to absorbing objects with hybrid Paul-optical traps", Nano Lett.
**20**, 6018 (2020), DOI 10.1021/acs.nanolett.0c02025. Read from arXiv
[2005.05486](https://arxiv.org/abs/2005.05486) v1, with its supplement.

**Stated:**
- an end-cap Paul trap of two steel electrodes (p. 2);
- RF 0.6–2 kVpp at 1–30 kHz (p. 2), with 20 kHz for Fig. 5;
- 532 nm, P ≤ 20 mW, NA 0.8 (p. 2);
- particles: gold nanorods, nanodiamonds and silica of 143 nm diameter;
- 50 < n < 1000 charges (Suppl. p. 7);
- 50 mbar for Fig. 5.

**Measured.** Hybrid frequencies "in the range of hundreds of kHz" (p. 4).
From the log-scale Fig. 5c, by eye: about 130 kHz at 10 mW and about
190 kHz at 20 mW.

**Missing:**
- electrode dimensions, r0, z0, geometry factors and DC voltages;
- polarisation;
- the density and refractive index of the nanodiamonds;
- the charge of the measured particle;
- frequencies with each trap alone.

**Why it is not verified.** Only parameter ranges are given; no run records
a complete set.

### Bonvin *et al.* 2024: hybrid Paul + optical

**Citation.** E. Bonvin, L. Devaud, M. Rossi, A. Militaru, L. Dania,
D. S. Bykov, M. Teller, T. E. Northup, L. Novotny, M. Frimmer, "Hybrid
Paul-optical trap with large optical access for levitated optomechanics",
Phys. Rev. Research **6**, 043129 (2024),
DOI 10.1103/PhysRevResearch.6.043129. Read from arXiv
[2312.10131](https://arxiv.org/abs/2312.10131) v1, which has no appendices.
The journal version may add material.

**Stated (p. 2):**
- a planar "wheel" trap with RF tips 250 µm from the trap centre, and lens
  holders 1.6 mm away serving as end caps;
- "typical" drive: Ωd = 2π × 33 kHz, Vrf = 200 V, Voff = 5 mV, Vcap = 70 V;
- 1565 nm, 500 mW (where it was measured is not stated), NA 0.77, polarised
  along x;
- silica, 177 nm diameter;
- q/m of 4–5 C/kg, about 150 charges.

**Measured (p. 2):**
- tweezer alone: 2π × (69, 74, 15) kHz in x, y, z;
- Paul trap alone: 2π × (5.5, 6, 3) kHz in u, v, z, with u and v at 45° to
  x and y.

**Missing:**
- frequencies with both traps on (only "67 to 69 kHz" during recapture,
  under feedback, Fig. 3b);
- the wheel trap's geometry factors;
- power at the focus;
- density.

**Why it is not verified.**
- The hybrid slot needs the combined trap.
- The tweezer-alone numbers could become a second tweezer entry once the
  power at the focus and the density are known.

### Vovrosh *et al.* 2017: parabolic mirror

**Citation.** J. Vovrosh, M. Rashid, D. Hempston, J. Bateman, M. Paternostro,
H. Ulbricht, "Parametric feedback cooling of levitated optomechanics in a
parabolic mirror trap", J. Opt. Soc. Am. B **34**, 1421 (2017). Read from
arXiv [1603.02917](https://arxiv.org/abs/1603.02917) v3. The DOI is not
printed; 10.1364/JOSAB.34.001421 is unconfirmed.

**Stated:**
- 1550 nm, with an amplifier of up to 1 W (Suppl. S3);
- a mirror with f = 3.1 mm and r0 = 12.7 mm, "which gives a NA of 0.995"
  (S4), for "the majority of experiments";
- silica, radii from 13 to 80 nm, individually stated per figure;
- pressures from 10⁻⁶ to 7 × 10⁻² mbar.

**Measured.** Spectral peaks from Fig. 2a, by eye: about 92, 152 and
168 kHz uncooled. But the axis labels disagree between Figs. 1c, 2a and 4.

**Missing:**
- the input beam diameter at the mirror and the power at the focus;
- polarisation;
- density;
- which peak is which axis.

The stated NA also does not follow from the stated f and r0 with the
paper's Eq. 21 (inferred), so the mirror may differ between datasets.

**Why it is not verified.** The trap frequencies cannot be predicted
without the input beam and the focal power.

### Kamba and Aikawa 2023: standing wave (read in C4)

**Citation.** M. Kamba, K. Aikawa, "Revealing the velocity uncertainties
of a levitated particle in the quantum ground state", arXiv
[2306.16598](https://arxiv.org/abs/2306.16598) v2.

**Stated.** 1550 nm; "a power of 176 mW is focused with an objective lens
(NA= 0.85) to a beam waist of around 1.2 µm"; "Approximately a quarter of
the incident power is retro-reflected ... to form a standing-wave optical
trap"; "The reflected light has a beam waist of around 1.7 µm" (p. 5);
R = 174(3) nm, m = 4.9(3) × 10⁻¹⁷ kg; 2 × 10⁻⁶ Pa; "{Ωx, Ωy} = 2π × {62, 74}
kHz" and "Ωz/2π = 209 kHz" (p. 2).

**Missing.** The power at the focus (the objective's transmission), the
exact returned fraction, where the two foci sit and which antinode holds
the particle, the polarisation axis.

**Why it is not verified.** The axial frequency depends on all of those.
It is still the best standing-wave paper found: unlike Yoneda 2017, both
waists and the returned fraction are printed.

### Bykov *et al.* 2019: linear Paul trap (read in C4)

**Citation.** D. S. Bykov, P. Mestres, L. Dania, L. Schmöger, T. E. Northup,
"Direct loading of nanoparticles under high vacuum into a Paul trap for
levitodynamical experiments", arXiv
[1905.04204](https://arxiv.org/abs/1905.04204) v2.

**Stated (p. 2–3).** 2r0 = 1.8 mm, 2z0 = 2.8 mm; "ΩRF = 2π × 7.7 kHz";
"VRF = 830 V is the RF drive amplitude"; "VDC = 130 V is the voltage on the
end-cap electrodes"; kRF = 0.93, kDC = 0.38; silica R = (150 ± 20) nm,
2.0 g/cm³; 7 × 10⁻³ mbar; "the charge is between 85 and 95 elementary
charges"; damping (890 ± 50) Hz/mbar from the spectra.

**Measured.** Spectra only (Fig. 2): about 700 Hz along the axis, and two
radial peaks near 910 and 1038 Hz, read by eye.

**Why it is not verified.**
- The charge was found from the radial frequencies, so they cannot test
  levtrap.
- The axial frequency could, but the printed end-cap term (Eq. 2) and the
  quoted charge disagree by a factor of two: with kDC as printed, levtrap's
  κ_z is 0.19 and gives 571 Hz; with the factor that reproduces 85–95 e it is
  0.38 and gives 807 Hz, against about 700 Hz.
- No other Paul-trap paper read in C4 counts the charge independently and
  prints the drive of the same run.

### Dinter *et al.* 2024: parabolic mirror (read in C4)

**Citation.** T. J. Dinter, R. Roberts, T. Volz, M. K. Schmidt, C. Laplane,
"Three-Dimensional and Selective Displacement Sensing of a Levitated
Nanoparticle via Spatial Mode Decomposition", arXiv
[2409.08827](https://arxiv.org/abs/2409.08827) v4 (v1 and v2 hold a
different dataset; do not mix them).

**Stated.** 1550 nm, "a power of 160 mW"; the mirror's "focal length (1 mm)
and radius (2 mm)"; "a filling factor of ≈ 1"; x polarised;
"(Ωz, Ωx, Ωy)/2π ≈ (91, 111, 207) kHz"; ≈ 130 nm radius; 1.8 × 10⁻³ mbar.

**Why it is not verified.** The beam diameter is given only as a filling
factor of about one, undefined, with an iris in front of the mirror. levtrap's
weak transverse frequency depends strongly on it: f_y/f_x is 1.95 with a 3 mm
and 2.45 with a 4 mm beam (measured 1.86), while f_y/f_z stays at 2.14
(measured 2.27).

### Illetschek *et al.* 2026: WS₂ dark trap (read in C4)

**Citation.** P. Illetschek, G. Fedorovich, A. Seredin, G. Tselikov,
V. S. Volkov, N. Kiesel, M. Aspelmeyer, M. Petrov, A. V. Zasedatelev, "Dark
Optical Trapping of Resonant Transition-Metal Dichalcogenide Particles",
arXiv [2607.09896](https://arxiv.org/abs/2607.09896) v1. A computed trap
(optical tweezers toolbox), not an experiment; the app's WS₂ preset follows it.

**Stated (p. 2–4).** 1550 nm; an LG(0,0) beam of waist 1.59 µm and an LG(1,0)
beam of 0.866 µm, "relative phase relation of π", both circularly polarised;
"total power P0 = 0.8 W"; WS₂ n = 3.79, 7.50 g/cm³.

**Read from Fig. 2.** Stable for radii of about 288.8–307.8 nm; z_eq/λ of
0.114, 0.048, 0.049, 0.091 at 290, 295, 300, 305 nm; axial 17.9, 17.6, 14.6,
10.6 and radial 25.5, 15.9, 10.3, 6.5 "Ω (kHz)" at the same radii.

**Missing.** The power split between the two beams, the waist convention,
whether "Ω (kHz)" is angular.

**What levtrap gives.** With the preset's split (0.30 / 0.50 W, the one that
darkens the focus) levtrap is stable from 291.2 to 305.7 nm, with z_eq three
times the paper's and the radial frequency above the axial everywhere. A
split of about 0.22 : 0.78 (LG00 : LG10) reproduces the stable range
(288.9–307.6 nm) and the axial-to-radial ratios within 1.5 %, but every
frequency is then 1.8 times the paper's under the Ω/2π reading (11.5 times
under the angular one), and z_eq is 20–30 nm further downstream.

**Why it is not verified.** The power split is not stated.

## Candidates for the open slots

Seen in searches and not yet read:
- **Paul traps:** arXiv 1906.09580 and 1907.06046 (Barker group), and
  arXiv 2007.04434 and 2102.01060 (silica, feedback cooling). Any of these
  might state a full trap drive for the linear or ring slot.
- **Linear Paul trap:** Dania's earlier papers (Bykov 2019, APL 115, 034101;
  Dania 2021, PRR 3, 013018) may give the drive of the trap in Dania 2024.
- **Standing wave:** arXiv 1207.1567 (nanospheres in a standing wave and a
  cavity).
- **Dual-beam:** arXiv 2208.02032 (a dual-beam fibre trap with silica).

Read in C4 (#16) and not recorded, with what each lacks:
- **Paul traps:** Bullier 2020 (1906.09580; no drive; a dumbbell),
  Pontin 2020 (1907.06046), Dania 2021 (2007.04434; drive given as ranges),
  Penny 2021 (2102.01060), Bykov 2023 (2210.07583; two particles),
  Bykov 2025 (2403.02034; charge method not stated, a second, fast drive),
  Dania 2022 (2112.14990), Penny 2023 (2111.03123), Bullier 2019
  (1905.00884), Message 2025 (2501.03677), Nagornykh 2015 (1503.08170),
  Delord 2018 (1801.07798). In each, the charge comes from the measured
  frequencies or the drive of the measured run is missing.
- **Dual beam / standing wave:** Ranjit 2016 (1603.02122) and 2015
  (1503.08799), Harvey 2022 (2208.02032), Dana 2026 (2609.29829), Monteiro
  2013 (1207.1567), Li 2011 (1101.1283), Kamba 2025 (2504.17944): power per
  beam, return pass or focus positions missing.
- **Tweezer:** Grinin 2025 (2504.18389; where the power is measured), Shen 2021
  (2107.09659; a metalens), Tebbenjohanns 2019 (1812.09875; filling).
- **Jain's own apparatus (#61):** Jain's thesis (ETH 2017) gives no beam
  diameter or objective model; Frimmer 2016/2017 (1608.00998, 1704.02289)
  report the same frequency ratios on a 100× NA 0.9 objective.
