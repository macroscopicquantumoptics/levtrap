"""Reproduce the figures of arXiv:2607.09896 (Illetschek et al., "Dark optical
trapping of resonant transition-metal dichalcogenide particles") with levtrap.

    pip install -e . matplotlib
    python examples/paper_2607_09896.py [outdir]

Writes PNGs (fig1a_S1.png, fig1b.png, fig2.png, fig3.png, fig4b.png,
figS2.png) and data (paper_figures.json) to ``outdir`` (default docs/paper).

Beam: two coherent, circularly polarised LG beams at 1550 nm in vacuum,
(p=0, l=0, w=1.59 um) and (p=1, l=0, w=0.866 um), relative phase pi, total
0.8 W.  The paper does not state how the power is split between the two
beams or how a waist maps onto OTT's BscPmGauss; here the split nulls the
field at the focus (:func:`dark_split`) and waists use OTT's paraxial
far-field mapping (see levtrap.api._beam_angle).  These are assumptions —
see docs/paper/README.md.

Everything a trap is (equilibrium, frequencies, depths, scattered and
absorbed power) comes from :func:`levtrap.solve.solve`. The force map over
the intensity (Fig. 1a/S1) is not in a Result and is computed here from the
same beam and T-matrix. The scattered power per multipole (Figs. 1b, 2c) is
in a Result at the equilibrium (``optical.P_sca_multipoles``, #80; the WS2
case is checked against this script in tests/test_multipoles.py); the script
keeps its own :func:`multipole_powers` so that a wavelength with no
equilibrium is taken at the focus.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from levtrap.api import _single_beam, build_beam, build_tmatrix  # noqa: E402
from levtrap.derived import C, recoil_ratio  # noqa: E402
from levtrap.force import forcetorque  # noqa: E402
from levtrap.materials import get_material  # noqa: E402
from levtrap.setup import parse  # noqa: E402
from levtrap.solve import resolve_particle, solve  # noqa: E402

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

WL = 1550e-9
P_TOTAL = 0.8
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "docs", "paper")
C_MQ, C_MD, C_EQ, C_ED = "#2a78d6", "#eb6834", "#1baf7a", "#7a7974"
C_AX, C_RAD = "#c62f2e", "#2a78d6"
KT = 1.380649e-23 * 300


# --- the setup -------------------------------------------------------------------------------

def _beams(split=(0.5, 0.5), wavelength=WL):
    common = dict(kind="beam", wavelength=wavelength, polarisation="circular+", direction=[0, 0, 1], position=[0, 0, 0])
    return [dict(common, id="b1", power=P_TOTAL * split[0], focus=dict(kind="lens", waist=1.59e-6),
                 mode=dict(type="lg", indices=[0, 0]), phase=0.0),
            dict(common, id="b2", coherent_with="b1", power=P_TOTAL * split[1], focus=dict(kind="lens", waist=0.866e-6),
                 mode=dict(type="lg", indices=[1, 0]), phase=math.pi)]


def dark_split(wavelength=WL):
    """The power split (P1, P2) / P that nulls the field at the focus:
    P1 |E1(0)|^2 = P2 |E2(0)|^2 for unit-power beams (in OTT's non-paraxial
    beams it is about 0.37 : 0.63)."""
    beams = parse(setup("WS2", 300e-9, (0.5, 0.5), wavelength))["trap"]["fields"]
    e = [float(np.sum(np.abs(_single_beam(b, 1.0).em_field_xyz(np.zeros((1, 3)))) ** 2)) for b in beams]
    return e[1] / (e[0] + e[1]), e[0] / (e[0] + e[1])


def setup(material="WS2", radius=300e-9, split=None, wavelength=WL):
    """The paper's bottle beam on a TMD sphere. WS2 at 1550 nm takes the
    paper's index 3.79 + 2.83e-10 i, kept at every wavelength (no dispersion
    data); other materials come from levtrap.materials."""
    split = split or SPLIT
    if material == "WS2":
        particle = dict(material="WS2", radius=radius, n=3.79, k=2.83e-10, density=7500.0)
    else:
        m = get_material(material, WL)
        particle = dict(material=material, radius=radius, n=m["n"], k=m["k"], density=m["density"])
    return dict(version=1, particle=particle, environment=dict(medium_index=1.0, temperature=300.0),
                trap=dict(fields=_beams(split, wavelength)))


SPLIT = (0.5, 0.5)  # replaced by dark_split() in main()


# --- what a Result does not carry ---------------------------------------------------------------

def _beam_and_T(s, multipoles=None):
    s = parse(s)
    resolve_particle(s)
    beam, P = build_beam(s)
    T, _ = build_tmatrix(s, dict(multipoles=multipoles) if multipoles else None)
    return s, beam, P, T


def multipole_powers(s, z):
    """Scattered power per multipole over the beam power, the particle at (0, 0, z):
    4 sum_m |p_nm|^2 / P for the electric (N) and magnetic (M) waves of each order."""
    _, beam, _, T = _beam_and_T(s)
    b = beam.translate_z(z) if z else beam
    sbeam, _ = b.scatter(T)
    n, _ = sbeam.get_mode_indices()
    pm = 4 * np.sum(np.abs(sbeam.a) ** 2, axis=1)
    pe = 4 * np.sum(np.abs(sbeam.b) ** 2, axis=1)
    out = {}
    for order, (le, lm) in {1: ("ED", "MD"), 2: ("EQ", "MQ"), 3: ("EO", "MO")}.items():
        out[le] = float(pe[n == order].sum() / b.power)
        out[lm] = float(pm[n == order].sum() / b.power)
    out["higher"] = float((pe[n > 3].sum() + pm[n > 3].sum()) / b.power)
    return out


def force_map(s, x_range=1.0e-6, z_range=1.2e-6, nx=21, nz=25, ni=80, multipoles=None):
    """Force [N] on an x-z grid and the intensity [W/m^2] on a finer one."""
    s, beam, _, T = _beam_and_T(s, multipoles)
    unit = float(s["environment"]["medium_index"]) / C
    mx, mz = np.linspace(-x_range, x_range, nx), np.linspace(-z_range, z_range, nz)
    FX, FZ = np.zeros((nz, nx)), np.zeros((nz, nx))
    for i, zz in enumerate(mz):
        f = forcetorque(beam.translate_z(zz) if zz else beam, T, position=np.vstack([mx, 0 * mx, 0 * mx]))[0]
        FX[i], FZ[i] = f[0] * unit, f[2] * unit
    ix, iz = np.linspace(-x_range, x_range, ni), np.linspace(-z_range, z_range, int(ni * 1.4))
    XX, ZZ = np.meshgrid(ix, iz)
    E = beam.em_field_xyz(np.stack([XX.ravel(), 0 * XX.ravel(), ZZ.ravel()], axis=1))
    I = 4 * beam.k_medium**2 * np.sum(np.abs(E) ** 2, axis=1).reshape(XX.shape)
    return dict(x=mx, z=mz, Fx=FX, Fz=FZ, Ix=ix, Iz=iz, I=I)


def axial_trap(fz, z):
    """A stable axial zero of the force along the axis (F_z crossing from + to -), or None."""
    for i in range(len(z) - 1):
        if fz[i] > 0 >= fz[i + 1]:
            return float(z[i] - fz[i] * (z[i + 1] - z[i]) / (fz[i + 1] - fz[i]))
    return None


# --- one point ----------------------------------------------------------------------------------

def point(material="WS2", radius=300e-9):
    """solve() for one particle, in the shape the figures read."""
    s = setup(material, radius)
    r = solve(s)
    modes = {m["name"]: m for m in r["modes"]}
    z_eq = r["equilibrium"][2] if r["equilibrium"] else None
    freq = {a: (modes[a]["frequency"] if a in modes else None) for a in "xyz"}
    depth = {a: (modes[a].get("depth") if a in modes else None) for a in "xyz"}
    mass = r["particle"]["mass"]
    P_sca = r["optical"]["P_sca"]
    recoil = {a: (recoil_ratio(P_sca, WL, mass, 2 * math.pi * f) if f else None) for a, f in freq.items()}
    return dict(radius=radius, stable=r["stable"], z_eq=z_eq, freq=freq, depth=depth, recoil=recoil,
                P_sca=P_sca, P_abs=r["optical"]["P_abs"],
                multipoles=multipole_powers(s, z_eq or 0.0) if material == "WS2" else None)


def radius_sweep(material="WS2", radii=None):
    radii = np.arange(280, 311, 1) * 1e-9 if radii is None else radii
    return [point(material, float(rr)) for rr in radii]


def shade_unstable(ax, xs, stable):
    xs = np.asarray(xs)
    h = (xs[1] - xs[0]) / 2
    for x, s in zip(xs, stable):
        if not s:
            ax.axvspan(x - h, x + h, color="0.85", lw=0, zorder=0)


def _finite(x):
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_finite(v) for v in x]
    if isinstance(x, np.ndarray):
        return _finite(x.tolist())
    if isinstance(x, float) and not math.isfinite(x):
        return None
    return x


def main():
    global SPLIT
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    SPLIT = dark_split()
    data = dict(split=SPLIT)

    # ---- Fig 1a / S1: force map over intensity, full and MQ-only ---------
    fig, axs = plt.subplots(1, 2, figsize=(10, 5.2), constrained_layout=True)
    mq_only = dict(ED=False, MD=False, EQ=False, MQ=True, higher=False)
    for ax, (title, mp) in zip(axs, [("all multipoles", None), ("magnetic quadrupole only", mq_only)]):
        M = force_map(setup(radius=300e-9), multipoles=mp)
        if mp:  # solve() takes no multipole mask: the axial zero from the map's centre column
            zs = np.linspace(-1.2e-6, 1.2e-6, 121)
            s, beam, _, T = _beam_and_T(setup(radius=300e-9), mp)
            fz = forcetorque(beam, T, position=np.vstack([0 * zs, 0 * zs, zs]))[0][2]
            z_eq = axial_trap(fz, zs)
        else:
            z_eq = point("WS2", 300e-9)["z_eq"]
        I = np.array(M["I"])
        ax.imshow(I / I.max(), extent=[M["Ix"][0] / WL, M["Ix"][-1] / WL, M["Iz"][0] / WL, M["Iz"][-1] / WL],
                  origin="lower", cmap="Blues", aspect="equal")
        X, Z = np.meshgrid(np.array(M["x"]) / WL, np.array(M["z"]) / WL)
        mag = np.hypot(M["Fx"], M["Fz"])
        ax.quiver(X, Z, M["Fx"] / mag, M["Fz"] / mag, color="#c62f2e", scale=28, width=0.004)
        if z_eq is not None:
            ax.add_patch(plt.Circle((0, z_eq / WL), 300e-9 / WL, fill=False, color="k", lw=1.5))
        ax.set_title(f"WS$_2$, R = 300 nm, {title}")
        ax.set_xlabel("x / $\\lambda_0$")
        ax.set_ylabel("z / $\\lambda_0$")
        data[f"map_{'mq' if mp else 'all'}"] = dict(z_eq=z_eq, stable=z_eq is not None)
    fig.savefig(os.path.join(OUT, "fig1a_S1.png"), dpi=130)
    plt.close(fig)

    # ---- Fig 1b: multipoles vs wavelength, particle at its equilibrium (or the focus) -------
    wls = np.arange(1450, 1701, 10) * 1e-9
    mp_rows = []
    for wl in wls:
        s = setup(radius=300e-9, wavelength=float(wl))  # index kept at 3.79 + 2.83e-10 i
        r = solve(s)
        mp_rows.append(multipole_powers(s, r["equilibrium"][2] if r["equilibrium"] else 0.0))
    fig, ax = plt.subplots(figsize=(6, 3.6), constrained_layout=True)
    for k, c in (("MQ", C_MQ), ("MD", C_MD), ("EQ", C_EQ), ("ED", C_ED)):
        ax.semilogy(wls * 1e9, [m[k] for m in mp_rows], color=c, lw=2, label=k)
    ax.axvline(1550, color="k", ls="--", lw=1)
    ax.set_xlabel("wavelength (nm)")
    ax.set_ylabel("scattered power / beam power")
    ax.set_title("WS$_2$ R = 300 nm in the bottle beam (at z$_{eq}$ or focus)")
    ax.legend()
    fig.savefig(os.path.join(OUT, "fig1b.png"), dpi=130)
    plt.close(fig)
    data["fig1b"] = dict(wavelength=wls.tolist(), multipoles=mp_rows)

    # ---- Fig 2 / 3 / 4b: radius sweep -------------------------------------
    rows = radius_sweep()
    data["ws2_radius_sweep"] = rows
    R = np.array([r["radius"] for r in rows]) * 1e9
    st = [r["stable"] for r in rows]
    sel = lambda f: np.array([f(r) if r["stable"] else np.nan for r in rows], dtype=float)  # noqa: E731
    fig, axs = plt.subplots(4, 1, figsize=(5.5, 9), sharex=True, constrained_layout=True)
    axs[0].plot(R, sel(lambda r: r["z_eq"] / WL), color=C_AX, lw=2)
    axs[0].set_ylabel("$z_{eq}/\\lambda_0$")
    axs[1].plot(R, sel(lambda r: r["freq"]["z"] / 1e3), color=C_AX, lw=2, label="axial $\\Omega_z/2\\pi$")
    axs[1].plot(R, sel(lambda r: r["freq"]["x"] / 1e3), color=C_RAD, lw=2, label="radial $\\Omega_x/2\\pi$")
    axs[1].set_ylabel("frequency (kHz)")
    axs[1].legend(fontsize=8)
    for k, c in (("MQ", C_MQ), ("MD", C_MD), ("EQ", C_EQ), ("ED", C_ED)):
        axs[2].semilogy(R, [r["multipoles"][k] for r in rows], color=c, lw=2, label=k)
    axs[2].set_ylabel("$P_{sca}/P$ at $z_{eq}$")
    axs[2].set_ylim(1e-7, 1e-2)
    axs[2].legend(fontsize=8, ncol=4)
    axs[3].plot(R, sel(lambda r: r["depth"]["x"] / KT), color=C_RAD, lw=2, label="radial")
    axs[3].plot(R, sel(lambda r: r["depth"]["z"] / KT), color=C_AX, lw=2, label="axial")
    axs[3].set_ylabel("depth $U/k_BT$")
    axs[3].legend(fontsize=8)
    axs[3].set_xlabel("particle radius (nm)")
    for ax in axs:
        shade_unstable(ax, R, st)
    fig.savefig(os.path.join(OUT, "fig2.png"), dpi=130)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(5.5, 3.4), constrained_layout=True)
    ax.plot(R, sel(lambda r: r["recoil"]["z"]), color=C_AX, lw=2, label="WS$_2$ dark trap")
    shade_unstable(ax, R, st)
    ax.set_yscale("log")
    ax.set_xlabel("particle radius (nm)")
    ax.set_ylabel("$\\Gamma/\\Omega_z$")
    ax.legend()
    fig.savefig(os.path.join(OUT, "fig3.png"), dpi=130)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(5.5, 2.8), constrained_layout=True)
    ax.plot(R, [r["P_abs"] * 1e9 for r in rows], color=C_RAD, lw=2)
    shade_unstable(ax, R, st)
    ax.set_xlabel("particle radius (nm)")
    ax.set_ylabel("$P_{abs}$ (nW)")
    fig.savefig(os.path.join(OUT, "fig4b.png"), dpi=130)
    plt.close(fig)

    # ---- Fig S2: other TMDs -------------------------------------------------
    fig, axs = plt.subplots(1, 2, figsize=(11, 3.6), constrained_layout=True)
    data["figS2"] = {}
    palette = dict(MoTe2="#008300", MoSe2="#2a78d6", WSe2="#e87ba4", WS2="#c62f2e", MoS2="#6250d6")
    ranges = dict(MoTe2=(220, 250), MoSe2=(250, 280), WSe2=(265, 300), WS2=(280, 312), MoS2=(280, 315))
    for mat, (a, b) in ranges.items():
        rr = np.arange(a, b + 1, 1) * 1e-9
        rows_m = radius_sweep(mat, rr)
        data["figS2"][mat] = rows_m
        Rm = rr * 1e9
        axs[0].plot(Rm, [r["z_eq"] / WL if r["stable"] else np.nan for r in rows_m], color=palette[mat], lw=2, label=mat)
        axs[1].plot(Rm, [r["freq"]["z"] / 1e3 if r["stable"] else np.nan for r in rows_m], color=palette[mat], lw=2, label=f"{mat} axial")
        axs[1].plot(Rm, [r["freq"]["x"] / 1e3 if r["stable"] else np.nan for r in rows_m], color=palette[mat], lw=1.5, ls="--")
    axs[0].set_ylabel("$z_{eq}/\\lambda_0$")
    axs[1].set_ylabel("$\\Omega/2\\pi$ (kHz)  (solid axial, dashed radial)")
    for ax in axs:
        ax.set_xlabel("particle radius (nm)")
        ax.legend(fontsize=8)
    fig.savefig(os.path.join(OUT, "figS2.png"), dpi=130)
    plt.close(fig)

    with open(os.path.join(OUT, "paper_figures.json"), "w") as f:
        json.dump(_finite(data), f)
    print(f"done in {time.time() - t0:.0f} s -> {OUT}")


if __name__ == "__main__":
    main()
