"""Material presets: refractive index n + ik and mass density.

Values are only provided where a source is cited.  Outside the tabulated
wavelength(s) a preset returns ``valid=False`` and the UI asks for a
custom index.

Sources
-------
[P26] P. Illetschek et al., "Dark optical trapping of resonant
      transition-metal dichalcogenide particles", arXiv:2607.09896 (2026),
      Table I and Table S1 (values at 1550 nm; their refs: WS2 n,k Vyshnevyy
      et al. Nano Lett. 23, 8057 (2023); MoS2/WSe2/MoTe2/MoSe2 k Munkhbat
      et al. ACS Photonics 9, 2398 (2022); Si k Degallaix et al. Opt. Lett.
      38, 2047 (2013); SiO2 k Franta et al. Proc. SPIE 9890 (2016);
      densities CRC Handbook 105th ed., Eagleson (1994), Brown (1966)).
      The k values in the paper are upper bounds ("<").
[M65] I. H. Malitson, "Interspecimen comparison of the refractive index of
      fused silica", J. Opt. Soc. Am. 55, 1205 (1965): Sellmeier fit,
      valid 0.21-3.71 um.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

__all__ = ["Material", "MATERIALS", "get_material"]


@dataclass(frozen=True)
class Material:
    name: str
    density: float  # kg/m^3
    table: dict  # wavelength [m] -> complex index
    sellmeier: tuple | None = None  # (B1,C1,B2,C2,B3,C3) with C in um^2
    sellmeier_range: tuple = (0.0, 0.0)  # metres
    source: str = ""

    def index(self, wavelength: float, rtol: float = 2e-3):
        """Complex refractive index at ``wavelength`` [m] and validity flag."""
        for wl, n in self.table.items():
            if abs(wavelength - wl) <= rtol * wl:
                return complex(n), True
        if self.sellmeier and self.sellmeier_range[0] <= wavelength <= self.sellmeier_range[1]:
            lu2 = (wavelength * 1e6) ** 2
            B1, C1, B2, C2, B3, C3 = self.sellmeier
            n2 = 1 + B1 * lu2 / (lu2 - C1) + B2 * lu2 / (lu2 - C2) + B3 * lu2 / (lu2 - C3)
            k = 0.0
            for wl, nn in self.table.items():  # keep tabulated tiny absorption if any
                k = max(k, complex(nn).imag)
            return complex(np.sqrt(n2), k), True
        return complex("nan"), False


_MALITSON = (0.6961663, 0.0684043**2, 0.4079426, 0.1162414**2, 0.8974794, 9.896161**2)

MATERIALS = {
    "SiO2": Material("SiO2", 2200.0, {1550e-9: 1.44 + 2.55e-16j}, _MALITSON, (0.21e-6, 3.71e-6),
                     "n: Malitson (1965) Sellmeier; k (1550 nm) and density: arXiv:2607.09896 Table I"),
    "Si": Material("Si", 2330.0, {1550e-9: 3.48 + 5.30e-11j}, None, (0, 0),
                   "arXiv:2607.09896 Table I (1550 nm only)"),
    "WS2": Material("WS2", 7500.0, {1550e-9: 3.79 + 2.83e-10j}, None, (0, 0),
                    "arXiv:2607.09896 Table I (1550 nm only; k is an upper bound)"),
    "MoS2": Material("MoS2", 5060.0, {1550e-9: 3.76 + 2.37e-11j}, None, (0, 0),
                     "arXiv:2607.09896 Table I (1550 nm only; k is an upper bound)"),
    "WSe2": Material("WSe2", 9320.0, {1550e-9: 3.99 + 6.0e-9j}, None, (0, 0),
                     "arXiv:2607.09896 Table S1 (1550 nm only; k is an upper bound)"),
    "MoTe2": Material("MoTe2", 7990.0, {1550e-9: 4.84 + 3.0e-8j}, None, (0, 0),
                      "arXiv:2607.09896 Table S1 (1550 nm only; k is an upper bound)"),
    "MoSe2": Material("MoSe2", 6990.0, {1550e-9: 4.22 + 1.0e-7j}, None, (0, 0),
                      "arXiv:2607.09896 Table S1 (1550 nm only; k is an upper bound)"),
}


def get_material(name: str, wavelength: float) -> dict:
    """Index and density of a preset at ``wavelength`` [m].

    Returns ``{'n': float, 'k': float, 'density': kg/m^3, 'valid': bool,
    'source': str}``.
    """
    m = MATERIALS[name]
    idx, ok = m.index(wavelength)
    return dict(n=idx.real, k=idx.imag, density=m.density, valid=ok, source=m.source)
