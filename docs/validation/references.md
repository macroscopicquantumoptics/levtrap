# Literature reference values

Published experiments that levtrap should reproduce: one per trap type, each
with the parameters to build a Setup and the measured numbers to compare
against. They feed the validation tests (milestone C) and the presets (D6).
Machine-readable copy: [`references.json`](references.json).

## Status: no verified entries yet

**Every entry below is under "wanted". None has numbers yet.**

The rule for this file is that every parameter and measured value must be
read from the paper itself, with its page, figure or table. When this file
was written, the session's network policy blocked every full-text source
that was tried: `arxiv.org`, `export.arxiv.org` and `ar5iv.labs.arxiv.org`
were refused or did not resolve. Publisher sites were blocked in the same way.
Web search worked, but it returns index snippets and summaries, not the
paper's text. Those were used **only** for bibliographic data (authors,
title, journal, DOI, arXiv id) and for a rough trap description. They were
not used for any number. Each entry says where its bibliographic data came
from.

To finish this ticket, someone with access to the papers (or a session with
`arxiv.org` allowed) reads each paper and, for each entry:

1. fills the "needed" parameters, marking each one **stated** (printed in
   the paper) or **inferred** (worked out from what is printed, with the
   working shown), and noting the page, figure or table;
2. reads the measured values and their uncertainties, with their
   source location;
3. moves the entry from `wanted` to `verified` in `references.json`, writing
   a full Setup file. `tests/test_references.py` then checks it through
   `levtrap.setup.parse`.

Do not fill a gap from memory or from a review article's table. If a
parameter is not in the paper, write "not stated" and say how the
comparison is weakened.

## How to read an entry

| Field | Meaning |
|---|---|
| Slot | Which trap type from issue #15 the entry covers |
| Setup support | `current` if today's Setup schema (ARCHITECTURE.md section 4) can express it. `future` if it needs a key that is planned but not yet implemented |
| Needed | Parameters to read from the paper |
| Expected | Measured quantities to read from the paper |
| Agreement | What agreement to expect, and why |

The current schema already has `paul` fields (linear and ring), beam
`direction`, `position` and `coherent_with`. The only planned key the
entries need that it lacks is `focus.kind = "parabolic_mirror"`
(ARCHITECTURE.md section 4 comment, milestone E). That entry writes it the
way the architecture document gives it and lists it under `schema_gaps`.

## Coverage

| Slot | Entry | Setup support | Status |
|---|---|---|---|
| Single-beam high-NA tweezer, silica, vacuum | Jain 2016 | current | wanted |
| Counter-propagating / standing wave | Yoneda and Aikawa 2017 | current | wanted |
| Linear Paul trap, nanoparticle | Dania 2024 | current | wanted |
| Ring / wheel Paul trap | Millen 2015 (geometry unconfirmed) | current (Paul part) | wanted; may need replacing |
| Hybrid Paul + optical | Conangla 2020; Bonvin 2024 | current | wanted |
| Parabolic mirror | Vovrosh 2017 | future (`parabolic_mirror`) | wanted |

## Wanted entries

### 1. Single-beam tweezer: Jain *et al.* 2016

- **Citation.** V. Jain, J. Gieseler, C. Moritz, C. Dellago, R. Quidant,
  L. Novotny, "Direct Measurement of Photon Recoil from a Levitated
  Nanoparticle", Phys. Rev. Lett. **116**, 243601 (2016).
  DOI [10.1103/PhysRevLett.116.243601](https://doi.org/10.1103/PhysRevLett.116.243601),
  arXiv [1603.03420](https://arxiv.org/abs/1603.03420).
  *Bibliographic data from the web-search index; not checked against the paper.*
- **Trap.** A single beam focused by a high-NA lens holds a silica
  nanosphere in ultrahigh vacuum, with feedback cooling.
- **Needed.** Wavelength. Power at the focus, and whether it is measured
  before or after the objective. Objective NA and filling factor.
  Polarisation. Particle radius and how it was measured. Pressure for each
  measurement.
- **Expected.** Trap frequencies (x, y, z). Recoil heating rate against
  power and against radius. Gas damping against pressure, if given.
- **Agreement.** Papers seldom state the effective NA of an overfilled
  objective, and levtrap's lens is an ideal aplanatic focus. Frequency
  ratios should agree better than the absolute frequencies, which may be off
  by tens of percent. Recoil heating follows scattered power (rate ∝ r⁶), so
  once the frequencies match it should agree within the paper's error bars
  plus the radius uncertainty.

### 2. Standing wave: Yoneda and Aikawa 2017

- **Citation.** M. Yoneda, K. Aikawa, "Thermal broadening of the power
  spectra of laser-trapped particles in vacuum", J. Phys. B **50**, 245501
  (2017). DOI [10.1088/1361-6455/aa95ab](https://doi.org/10.1088/1361-6455/aa95ab),
  arXiv [1708.07572](https://arxiv.org/abs/1708.07572).
  *Bibliographic data from the arXiv listing as shown in the web-search index.*
- **Trap.** A retro-reflected beam forms an optical lattice that holds a
  silica particle in vacuum. Confirm the geometry from the text.
- **Setup sketch.** Two `beam` fields, `coherent_with` each other, with
  opposite `direction`.
- **Needed.** Wavelength. Power in each pass and the loss on the return
  pass. NA or waist of each pass, and the relative focus positions.
  Polarisation of each pass. Particle radius. Pressure.
- **Expected.** Trap frequencies (x, y, z). Linewidths against pressure.
- **Agreement.** The fringe contrast sets the axial frequency. It depends on
  how well the returning beam overlaps the incoming one, which is rarely
  stated, so expect the axial frequency only to within tens of percent.
  Waist and power set the radial frequencies, which should match more
  closely.

### 3. Linear Paul trap: Dania *et al.* 2024

- **Citation.** L. Dania, D. S. Bykov, F. Goschin, M. Teller, A. Kassid,
  T. E. Northup, "Ultrahigh Quality Factor of a Levitated Nanomechanical
  Oscillator", Phys. Rev. Lett. **132**, 133602 (2024).
  DOI [10.1103/PhysRevLett.132.133602](https://doi.org/10.1103/PhysRevLett.132.133602),
  arXiv [2304.02408](https://arxiv.org/abs/2304.02408).
  *Bibliographic data from the web-search index.*
- **Trap.** A linear Paul trap holds a charged silica nanoparticle at room
  temperature in extreme high vacuum.
- **Needed.** RF amplitude and frequency. DC and endcap voltages. r0 and z0.
  Geometry factors, or an electrode drawing to compute them. Particle radius
  and charge. Pressure.
- **Expected.** Secular frequencies. Mathieu a and q, if given. Damping
  rate and Q against pressure.
- **Agreement.** Secular frequencies depend on q/m and on geometry factors
  that only an electrode simulation gives. If the paper states the charge
  and the geometry factors, the Mathieu secular frequency should agree to a
  few percent. Otherwise only the scaling with RF voltage can be tested.
  Compare damping only where gas damping dominates.

### 4. Ring Paul trap (provisional): Millen *et al.* 2015

- **Citation.** J. Millen, P. Z. G. Fonseca, T. Mavrogordatos,
  T. S. Monteiro, P. F. Barker, "Cavity Cooling a Single Charged Levitated
  Nanosphere", Phys. Rev. Lett. **114**, 123602 (2015).
  DOI [10.1103/PhysRevLett.114.123602](https://doi.org/10.1103/PhysRevLett.114.123602),
  arXiv [1407.3595](https://arxiv.org/abs/1407.3595) (preprint title
  "Cavity cooling a single charged nanoparticle").
  *Bibliographic data from the web-search index.*
- **Trap.** A Paul trap inside a single-mode optical cavity holds a charged
  silica nanosphere. **The electrode geometry (ring or not) is not
  confirmed.** Read it before this entry fills the ring slot.
- **Needed.** Electrode geometry and dimensions. RF amplitude and frequency.
  DC voltages. Particle radius and charge. Pressure.
- **Expected.** Secular frequencies with the cavity field off.
- **Agreement.** Only the Paul secular frequencies can be compared; cavity
  cooling is outside levtrap. If a better-documented ring or wheel trap
  paper turns up, it should replace this one.

### 5. Hybrid Paul + optical: Conangla *et al.* 2020

- **Citation.** G. P. Conangla, R. A. Rica, R. Quidant, "Extending vacuum
  trapping to absorbing objects with hybrid Paul-optical traps", Nano Lett.
  **20**, 6018–6023 (2020). DOI
  [10.1021/acs.nanolett.0c02025](https://doi.org/10.1021/acs.nanolett.0c02025),
  arXiv [2005.05486](https://arxiv.org/abs/2005.05486).
  *Bibliographic data from the web-search index.*
- **Trap.** A weak, tightly focused beam is overlaid on a Paul trap, which
  puts a dimple in the pseudopotential.
- **Needed.** Particle material, radius and charge. Paul geometry, RF and DC
  values. Beam wavelength, power and NA. Pressure.
- **Expected.** Frequencies with the Paul trap alone, the beam alone, and
  both. Any depth or stability boundary reported.
- **Agreement.** This directly tests levtrap's "sum the fields" design. The
  combined result should be as accurate as each part on its own. Absolute
  values inherit the NA uncertainty of the optical part and the
  geometry-factor uncertainty of the Paul part.

### 6. Hybrid Paul + optical: Bonvin *et al.* 2024

- **Citation.** E. Bonvin, L. Devaud, M. Rossi, A. Militaru, L. Dania,
  D. S. Bykov, M. Teller, T. E. Northup, L. Novotny, M. Frimmer, "Hybrid
  Paul-optical trap with large optical access for levitated optomechanics",
  Phys. Rev. Research **6**, 043129 (2024). DOI
  [10.1103/PhysRevResearch.6.043129](https://doi.org/10.1103/PhysRevResearch.6.043129),
  arXiv [2312.10131](https://arxiv.org/abs/2312.10131).
  *Bibliographic data from the web-search index (arXiv listing, DOAJ).*
- **Trap.** A Paul trap combined with a high-NA tweezer. The abstract (as
  indexed) says the particle can be held by optical fields, RF fields, or
  both.
- **Needed and expected.** The same as entry 5.
- **Agreement.** Lets each field be checked on its own before the sum is
  checked.

### 7. Parabolic mirror: Vovrosh *et al.* 2017

- **Citation.** J. Vovrosh *et al.* (read the full author list from the
  paper), "Parametric feedback cooling of levitated optomechanics in a
  parabolic mirror trap", J. Opt. Soc. Am. B **34**, 1421–1428 (2017),
  arXiv [1603.02917](https://arxiv.org/abs/1603.02917). The index gave no
  DOI. The Optica URI `josab-34-7-1421` suggests
  10.1364/JOSAB.34.001421, which is **unconfirmed**.
- **Trap.** A single beam focused by a parabolic mirror. One photodiode
  detects the motion, and feedback cools all three axes.
- **Setup support.** `future`: `focus.kind = "parabolic_mirror"` (milestone
  E).
- **Needed.** Wavelength, power, mirror focal length and aperture (or
  effective NA), particle radius, pressure.
- **Expected.** Trap frequencies (x, y, z). Temperatures and Q are reported
  but not modelled by levtrap.
- **Agreement.** A parabolic mirror apodises the focus differently from an
  aplanatic lens and collects a much larger solid angle. A lens stand-in will
  miss the frequencies by tens of percent. Use this entry for milestone E,
  not now.

## Other candidates seen but not assessed

These came up in searches. Nothing about them has been checked:
arXiv 2208.02032 (dual-beam fibre trap, silica), arXiv 1207.1567
(levitated nanospheres in a standing wave and cavity), arXiv 1906.09580 and
1907.06046 (Barker group Paul traps), arXiv 2007.04434 and 2102.01060
(silica in Paul traps, feedback cooling).
