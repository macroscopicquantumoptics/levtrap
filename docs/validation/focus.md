# The focus of a real NA 0.9 objective (#70)

Both tweezer papers levtrap is compared with show the same pattern:

- Jain *et al.* 2016 (#61)
- Zheng *et al.* 2020 (#70)

The particle's frequency along the beam is lower, relative to the transverse
ones, than levtrap's ideal NA 0.9 objective predicts. The two papers'
measured f_y/f_z are 3.06 and 3.07. levtrap gives 2.81–2.88 for any filling,
so its axial frequency is 7–10 % too stiff. This page traces where the gap
comes from. The checks are in `tests/test_focus_richards_wolf.py`.

## 1. levtrap's ideal objective is right

The textbook Richards–Wolf (Debye) integral of an aplanatic lens was
integrated directly. The setup is the same as levtrap's `focus.filling`
(#63), which reaches the same far field through a vector spherical wave
expansion:

- x polarisation;
- the pupil filled by a Gaussian of 1/e² radius `filling` × the aperture
  radius.

At filling 0.7 and 1.25 the two give the same focal intensity to 2 × 10⁻⁵ of
the peak. This holds along all three axes and the diagonal, out to ±0.6 µm
across and ±1.2 µm along the beam. The dipole frequency ratios agree to
10⁻⁴.

| filling | f_y/f_x (RW, levtrap) | f_y/f_z (RW, levtrap) |
|---|---|---|
| 0.7 | 1.2165, 1.2165 | 2.8117, 2.8118 |
| 1.0 | 1.2835, 1.2835 | 2.8420, 2.8422 |
| 1.25 | 1.3111, 1.3111 | 2.8789, 2.8791 |

Zheng's own estimate for their objective is 1.31 : 1 : 2.93. Its f_y/f_x is
the same as levtrap's. Its f_y/f_z is 1.7 % higher because it comes from a
Lorentzian fitted to the axial intensity profile, not from its curvature at
the focus.

## 2. The gap is the real objective

A real objective is not ideal. Zheng's was "designed for visible light", and
the paper names that as one reason for the difference. Primary spherical
aberration lowers the curvature along the beam much more than across it. It
also moves the intensity maximum a little upstream.

The scan below adds primary spherical aberration, in waves rms with the
Zernike normalisation, to the same Richards–Wolf pupil. Each ratio is taken
at the intensity maximum.

| | spherical aberration | f_y/f_x (measured) | f_y/f_z (measured) |
|---|---|---|---|
| Zheng, filling 1.25 | 0 | 1.311 (1.27) | 2.879 (3.07) |
| | 0.08 | 1.301 | 3.013 |
| | 0.09 | 1.298 | 3.059 |
| Jain, filling 0.7 | 0 | 1.216 (1.22) | 2.812 (3.06) |
| | 0.08 | 1.193 | 3.041 |
| | 0.09 | 1.185 | 3.139 |

About 0.08–0.09 waves rms brings both papers' axial ratio to the
measurement, within 2 %. The transverse ratio moves by less than 2 % at the
same time. That much aberration is just past the Maréchal criterion for a
diffraction-limited system (0.07 waves rms). It is plausible for an
objective used outside its design wavelength, or at a cover-glass
correction it was not made for.

## What this does and does not settle

- **It settles where the gap is.** The disagreement in #61 and #70 is not an
  error in levtrap's focus. levtrap models an ideal objective, and these
  objectives are measurably not ideal.
- **It does not make either entry pass.** Neither paper states an
  aberration, so a fitted 0.085 waves would be an *assumed* parameter that
  the compared quantities depend on, which references.md does not allow.
  Both entries keep their `known_disagreement`.
- **A lens aberration in the Setup is possible, but not part of #70.**
  A `focus.aberration` (Zernike, waves rms) for the ideal lens would let a
  user model a real objective. The far field can already be projected onto
  the beam (`lens.project_farfield`, used for the asphere), so the field
  side exists. It would be a schema and app change of its own.
