"""T-matrices: generic container and Mie (homogeneous sphere).

Ports of OTT v1 ``ott.Tmatrix`` (resizing, type conversion) and
``ott.TmatrixMie`` (single-layer sphere only; layered spheres are out of
scope).  Adds multipole masking for teaching.

Convention (OTT): the T-matrix is block diagonal with the first block
acting on the M (TE / "magnetic") coefficients and the second on the N
(TM / "electric") coefficients.  For a sphere the 'scattered' T-matrix
entries are ``-b_n`` (first block) and ``-a_n`` (second block), where
``a_n, b_n`` are the Bohren & Huffman Mie coefficients.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import sparse

from .special import combined_index, ka2nmax, sbesselh1, sbesselj

__all__ = ["Tmatrix", "TmatrixMie", "mie_coefficients"]


def _ntot(nmax: int) -> int:
    return nmax * nmax + 2 * nmax


@dataclass
class Tmatrix:
    """Generic T-matrix (``ott.Tmatrix``).

    ``data`` is a sparse ``(2*Ntot1, 2*Ntot2)`` matrix; ``type`` is one of
    'scattered', 'total', 'internal'.
    """

    data: sparse.spmatrix
    type: str = "scattered"
    k_medium: float = 2 * np.pi
    k_particle: complex = 2 * np.pi
    info: dict = field(default_factory=dict)

    def __post_init__(self):
        self.data = sparse.csr_matrix(self.data, dtype=complex)

    @property
    def Nmax(self) -> tuple[int, int]:
        n1 = combined_index(self.data.shape[0] // 2)[0]
        n2 = combined_index(self.data.shape[1] // 2)[0]
        return int(n1), int(n2)

    def _like(self, data, type_=None) -> "Tmatrix":
        return Tmatrix(data, type_ or self.type, self.k_medium, self.k_particle, dict(self.info))

    def set_Nmax(self, nmax) -> "Tmatrix":
        """Resize (port of ``Tmatrix.set_Nmax``; power-loss warnings dropped)."""
        if np.ndim(nmax) == 0:
            n1 = n2 = int(nmax)
        else:
            n1, n2 = int(nmax[0]), int(nmax[1])
        if (n1, n2) == self.Nmax:
            return self._like(self.data)
        t1, t2 = _ntot(n1), _ntot(n2)
        mid1, mid2 = self.data.shape[0] // 2, self.data.shape[1] // 2
        old_type = self.type
        T = self
        # OTT: growing a 'total' T-matrix converts via 'scattered' so the
        # new diagonal is the identity (Tmatrix.set_Nmax)
        if t1 > mid1 or (t2 > mid2 and old_type == "total"):
            if old_type == "total":
                T = self.to_type("scattered")
        D = T.data.tocsr()
        blocks = [[D[:mid1, :mid2], D[:mid1, mid2:]], [D[mid1:, :mid2], D[mid1:, mid2:]]]

        def resize(X):
            X = X.tocoo()
            keep = (X.row < t1) & (X.col < t2)
            return sparse.csr_matrix((X.data[keep], (X.row[keep], X.col[keep])), shape=(t1, t2))

        data = sparse.bmat([[resize(blocks[0][0]), resize(blocks[0][1])],
                            [resize(blocks[1][0]), resize(blocks[1][1])]], format="csr")
        out = Tmatrix(data, T.type, self.k_medium, self.k_particle, dict(self.info))
        if out.type != old_type:
            out = out.to_type(old_type)
        return out

    def to_type(self, type_: str) -> "Tmatrix":
        """Convert between 'scattered' and 'total' (``Tmatrix.set_type``)."""
        if type_ == self.type:
            return self._like(self.data)
        eye = sparse.eye(*self.data.shape, dtype=complex, format="csr")
        if self.type == "scattered" and type_ == "total":
            return self._like(2.0 * self.data + eye, "total")
        if self.type == "total" and type_ == "scattered":
            return self._like(0.5 * (self.data - eye), "scattered")
        raise ValueError("No known conversion")

    def __mul__(self, beam):
        return beam.scatter(self)[0]


def mie_coefficients(radius: float, k_medium: complex, k_particle: complex, nmax: int,
                     mu_relative: float = 1.0):
    """Mie coefficients from OTT's ``TmatrixMie.tmatrix_mie``.

    Returns ``(t_M, t_N, c_M, c_N)`` for n = 1..nmax where ``t_M``, ``t_N``
    are the scattered T-matrix entries (OTT's ``a`` and ``b`` variables;
    ``t_M = -b_n^BH``, ``t_N = -a_n^BH``) and ``c_M``, ``c_N`` the internal
    ones (OTT's ``c`` and ``d``).
    """
    n = np.arange(1, nmax + 1)
    m = k_particle / k_medium
    mu = mu_relative
    r0 = k_medium * radius
    r1 = k_particle * radius
    j0 = sbesselj(n, r0)[0]
    j1 = sbesselj(n, r1)[0]
    h0 = sbesselh1(n, r0)[0]
    j0d = sbesselj(n - 1, r0)[0] - n * sbesselj(n, r0)[0] / r0
    j1d = sbesselj(n - 1, r1)[0] - n * sbesselj(n, r1)[0] / r1
    h0d = sbesselh1(n - 1, r0)[0] - n * sbesselh1(n, r0)[0] / r0
    b = -(mu * j1d * j0 - m * j0d * j1) / (mu * j1d * h0 - m * h0d * j1)
    a = -(mu * j0d * j1 - m * j1d * j0) / (mu * h0d * j1 - m * j1d * h0)
    d = (h0d * j0 - j0d * h0) / (m * j1 * h0d - j1d * h0)
    c = (j0d * h0 - h0d * j0) / (m * j1d * h0 - h0d * j1)
    return a, b, c, d


def TmatrixMie(radius: float, *, k_medium=None, k_particle=None, index_relative=None,
               wavelength0=None, index_medium=None, index_particle=None,
               wavelength_medium=None, wavelength_particle=None,
               Nmax: int | None = None, internal: bool = False, mu_relative: float = 1.0,
               multipoles=None) -> Tmatrix:
    """T-matrix of a homogeneous sphere (port of ``ott.TmatrixMie``).

    Parameters
    ----------
    radius : float
        Sphere radius [m] (or in the same units as ``1/k``).
    k_medium, k_particle : float/complex, optional
        Wavenumbers; alternatively give ``index_medium``/``index_particle``
        with ``wavelength0``, or ``index_relative`` (OTT
        ``Tmatrix.parser_wavenumber``).  If nothing sets ``k_medium`` it is
        2*pi (lengths in medium wavelengths).
    Nmax : int, optional
        Truncation, default ``ka2nmax(k_medium*radius)``.
    internal : bool
        Return the internal-field T-matrix.
    multipoles : callable or None
        Teaching mask: ``multipoles(n, kind) -> bool`` with kind 'E'
        (electric, N-waves, ``a_n``) or 'M' (magnetic, M-waves, ``b_n``).
        Masked orders get a zero T-matrix entry (no scattering).
    """
    km = k_medium
    if km is None:
        if wavelength_medium is not None:
            km = 2 * np.pi / wavelength_medium
        elif index_medium is not None:
            if wavelength0 is None:
                raise ValueError("wavelength0 must be specified to use index_medium")
            km = index_medium * 2 * np.pi / wavelength0
    kp = k_particle
    if kp is None:
        if wavelength_particle is not None:
            kp = 2 * np.pi / wavelength_particle
        elif index_particle is not None:
            if wavelength0 is None:
                raise ValueError("wavelength0 must be specified to use index_particle")
            kp = index_particle * 2 * np.pi / wavelength0
    if km is None and kp is None:
        km = 2 * np.pi
    if index_relative is not None:
        if km is None:
            km = kp / index_relative
        elif kp is None:
            kp = km * index_relative
        else:
            raise ValueError("index_relative specified but both indices already known")
    elif kp is None:
        raise ValueError("Unable to determine particle wavenumber from inputs")
    if km is None:
        raise ValueError("Unable to determine medium wavenumber from inputs")
    if Nmax is None:
        Nmax = ka2nmax(abs(km * radius) if not internal else abs(kp * radius))
    a, b, c, d = mie_coefficients(radius, km, kp, Nmax, mu_relative)
    first, second = (c, d) if internal else (a, b)
    if multipoles is not None:
        n = np.arange(1, Nmax + 1)
        keepM = np.array([bool(multipoles(int(k), "M")) for k in n])
        keepN = np.array([bool(multipoles(int(k), "E")) for k in n])
        first = np.where(keepM, first, 0)
        second = np.where(keepN, second, 0)
    nidx, _ = combined_index(np.arange(1, _ntot(Nmax) + 1))
    diag = np.concatenate([first[nidx - 1], second[nidx - 1]])
    T = Tmatrix(sparse.diags(diag, format="csr"), "internal" if internal else "scattered",
                k_medium=km, k_particle=kp)
    T.info = dict(radius=radius, mu_relative=mu_relative, kind="mie")
    return T
