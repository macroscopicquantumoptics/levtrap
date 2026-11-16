"""Paul trap field: ideal quadrupole potentials, Mathieu a/q, secular
frequencies and stability.

Convention: Leibfried, Blatt, Monroe & Wineland, Rev. Mod. Phys. 75, 281
(2003), Sec. II.A.  The potential is

    Phi(r, t) = 1/2 sum_i c_i x_i^2  +  1/2 cos(Omega t) sum_i c'_i x_i^2

with curvatures c_i (static) and c'_i (RF amplitude) in V/m^2 and
Omega = 2 pi * rf_frequency.  For a charge Q and mass m each axis obeys the
Mathieu equation  d^2x/dxi^2 + (a_i - 2 q_i cos 2 xi) x = 0,  xi = Omega t / 2,
with

    a_i = 4 Q c_i  / (m Omega^2),        q_i = -2 Q c'_i / (m Omega^2).

(Leibfried write c_i = U alpha_i, c'_i = U~ alpha'_i.)  Only |q| matters
for stability and frequencies; the sign follows from the equation above.

Geometries (r0, z0 in m, kappa_r, kappa_z the geometry factors; the trap
centre is the origin):

* ``linear``: RF and the DC offset ``dc_voltage`` U on the rod pairs,
  Phi = kappa_r (U + V cos Omega t)(x^2 - y^2) / (2 r0^2), so
  a_x = -a_y = 4 Q kappa_r U / (m r0^2 Omega^2) and
  q_x = -q_y = -2 Q kappa_r V / (m r0^2 Omega^2), q_z = 0.  The end caps
  (``endcap_voltage`` U_ec) add the static axial well
  Phi = kappa_z U_ec (2 z^2 - x^2 - y^2) / (2 z0^2), i.e. omega_z^2 =
  2 kappa_z Q U_ec / (m z0^2), with the radial anti-confinement Laplace
  requires.  The trap axis is the lab z axis.
* ``ring`` (also wheel / 3D quadrupole): Phi = kappa_r (U + V cos Omega t)
  (x^2 + y^2 - 2 z^2) / (r0^2 + 2 z0^2), so a_z = -2 a_r and q_z = -2 q_r.
  ``endcap_voltage`` and ``geometry_factors.axial`` are not used.

Secular frequencies, two ways:

* pseudopotential: omega_i = (Omega / 2) sqrt(a_i + q_i^2 / 2), valid for
  |a|, q^2 << 1 (Leibfried Sec. II.A);
* exact: omega_i = beta_i Omega / 2 with the characteristic exponent beta
  from the monodromy matrix of the Mathieu equation over one RF period,
  cos(pi beta) = tr(M) / 2.

Stability means every axis lies in the first stability region,
a_0(q) < a < b_1(q) with the Mathieu characteristic values a_0, b_1.
"""

from __future__ import annotations

import math

import numpy as np

from . import ModelInfo, _positions

__all__ = ["PaulField", "mathieu_beta", "in_first_region", "PSEUDO_Q_LIMIT", "E_CHARGE"]

E_CHARGE = 1.602176634e-19  # C
PSEUDO_Q_LIMIT = 0.4        # |q| above which the pseudopotential is flagged as inaccurate


def mathieu_beta(a: float, q: float, steps: int = 600) -> float | None:
    """Characteristic exponent beta in [0, 1] of x'' + (a - 2 q cos 2 xi) x = 0
    for the first stability region, from the monodromy matrix over xi in
    [0, pi] (classical RK4, ``steps`` steps).  ``None`` when unstable."""
    if q == 0:
        return math.sqrt(a) if 0 < a < 1 else None
    h = math.pi / steps
    Y = np.array([[1.0, 0.0], [0.0, 1.0]])  # columns: two solutions (x, x')

    def f(xi, Y):
        return np.array([Y[1], -(a - 2 * q * math.cos(2 * xi)) * Y[0]])

    xi = 0.0
    for _ in range(steps):
        k1 = f(xi, Y)
        k2 = f(xi + h / 2, Y + h / 2 * k1)
        k3 = f(xi + h / 2, Y + h / 2 * k2)
        k4 = f(xi + h, Y + h * k3)
        Y = Y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        xi += h
    half_trace = 0.5 * (Y[0, 0] + Y[1, 1])
    if abs(half_trace) >= 1 or not in_first_region(a, q):
        return None
    return math.acos(half_trace) / math.pi


def in_first_region(a: float, q: float) -> bool:
    """Inside the first Mathieu stability region: a_0(|q|) < a < b_1(|q|)."""
    from scipy.special import mathieu_a, mathieu_b
    q = abs(q)
    if q == 0:
        return 0 < a < 1
    return bool(mathieu_a(0, q) < a < mathieu_b(1, q))


class PaulField:
    """Time-averaged force of a Paul trap on a particle of charge Q and mass m:
    the pseudopotential plus the static (DC, end-cap) force,
    F_i = -m (Omega/2)^2 (a_i + q_i^2 / 2) x_i."""

    kind = "paul"

    def __init__(self, f: dict, charge: float, mass: float):
        """``f``: a parsed ``paul`` field of a setup; ``charge`` in C; ``mass`` in kg."""
        self.geometry = f["geometry"]
        self.Q, self.m = float(charge), float(mass)
        self.Omega = 2 * math.pi * float(f["rf_frequency"])
        V, U = float(f["rf_voltage"]), float(f["dc_voltage"])
        r0, z0 = float(f["r0"]), float(f["z0"])
        kr = float(f["geometry_factors"]["radial"])
        kz = float(f["geometry_factors"]["axial"])
        self.notes: list[str] = []
        if self.geometry == "linear":
            s = kr / r0**2
            c_rf = np.array([s, -s, 0.0]) * V
            c_dc = np.array([s, -s, 0.0]) * U
            Uec = float(f["endcap_voltage"])
            e = kz * Uec / z0**2
            c_dc = c_dc + np.array([-e, -e, 2 * e])
            self.length_scale = min(r0, z0)
        else:  # ring
            s = 2 * kr / (r0**2 + 2 * z0**2)
            c_rf = np.array([s, s, -2 * s]) * V
            c_dc = np.array([s, s, -2 * s]) * U
            if f["endcap_voltage"]:
                self.notes.append("endcap_voltage is not used by a ring trap; use dc_voltage")
            self.length_scale = min(r0, z0)
        self.c_rf, self.c_dc = c_rf, c_dc
        k = self.Q / (self.m * self.Omega**2)
        self.a = 4 * k * c_dc
        self.q = -2 * k * c_rf
        self.r0, self.z0 = r0, z0

    # --- force ---------------------------------------------------------------
    @property
    def omega2_pseudo(self) -> np.ndarray:
        """(Omega/2)^2 (a + q^2/2) per axis [rad^2/s^2]; negative = anti-confining."""
        return (self.Omega / 2) ** 2 * (self.a + self.q**2 / 2)

    def force(self, r) -> np.ndarray:
        r = _positions(r)
        return -self.m * self.omega2_pseudo * r

    # --- frequencies and stability -----------------------------------------
    def secular(self) -> dict:
        """Per axis x, y, z: Mathieu a, q, pseudopotential and exact secular
        frequency [Hz] (``None`` where not confining / unstable), and whether
        the axis lies in the first stability region."""
        out = dict(a={}, q={}, pseudopotential={}, exact={}, stable={})
        for i, ax in enumerate("xyz"):
            a, q = float(self.a[i]), float(self.q[i])
            w2 = (self.Omega / 2) ** 2 * (a + q**2 / 2)
            beta = mathieu_beta(a, q)
            out["a"][ax], out["q"][ax] = a, q
            out["pseudopotential"][ax] = math.sqrt(w2) / (2 * math.pi) if w2 > 0 else None
            out["exact"][ax] = beta * self.Omega / (4 * math.pi) if beta is not None else None
            out["stable"][ax] = beta is not None
        out["all_stable"] = all(out["stable"].values())
        return out

    def micromotion(self, r) -> list[float]:
        """Micromotion amplitude [m] per axis for a particle held at r (e.g.
        sagging under gravity): |q_i x_i| / 2 (lowest order in q, Leibfried Sec. II.A)."""
        r = np.asarray(r, dtype=float)
        return [float(abs(self.q[i] * r[i]) / 2) for i in range(3)]

    def model(self) -> ModelInfo:
        qmax = float(np.max(np.abs(self.q)))
        if qmax > PSEUDO_Q_LIMIT:
            return ModelInfo("mathieu", "approximate",
                             [f"Paul q = {qmax:.2f}: pseudopotential is inaccurate, using Mathieu"] + self.notes)
        return ModelInfo("pseudopotential", "ok", list(self.notes))
