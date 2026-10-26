"""Reproduce the figures of arXiv:2607.09896 (Illetschek et al., "Dark optical
trapping of resonant transition-metal dichalcogenide particles") with levtrap.

    pip install matplotlib
    python examples/paper_2607_09896.py [outdir]

Writes PNGs (fig1a.png, fig1b.png, fig2.png, fig3.png, fig4b.png,
figS1.png, figS2.png) and data (paper_figures.json) to ``outdir``
(default docs/paper).

Beam: two coherent, circularly polarised LG beams at 1550 nm in vacuum,
(p=0, l=0, w=1.59 um) and (p=1, l=0, w=0.866 um), relative phase pi, total
0.8 W.  The paper does not state how the power is split between the two
beams or how a waist maps onto OTT's BscPmGauss; here the split nulls the
field at the focus and waists use OTT's paraxial far-field mapping (see
levtrap.api._beam_angle).  These are assumptions — see docs/paper/README.md.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from levtrap import api  # noqa: E402
from levtrap.materials import get_material  # noqa: E402

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

WL = 1550e-9
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "docs", "paper")
os.makedirs(OUT, exist_ok=True)

BASE = json.loads(api.presets())["ws2_bottle_1550"]["request"]
BASE["scan"] = dict(z_range=1.2e-6, z_points=61, x_range=1.0e-6, x_points=41,
                    map_nx=21, map_nz=25, intensity_n=80)
C_MQ, C_MD, C_EQ, C_ED = "#2a78d6", "#eb6834", "#1baf7a", "#7a7974"
C_AX, C_RAD = "#c62f2e", "#2a78d6"


def req_with(**kw):
    r = json.loads(json.dumps(BASE))
    for k, v in kw.items():
        if k == "radius":
            r["particle"]["radius"] = v
        elif k == "material":
            m = get_material(v, WL)
            r["particle"].update(material=v, n=m["n"], k=m["k"], density=m["density"])
        else:
            r[k] = v
    return r


def analyse(r, detail=False):
    return api.analyse(r, detail=detail)


def shade_unstable(ax, xs, stable):
    xs = np.asarray(xs)
    h = (xs[1] - xs[0]) / 2
    for x, s in zip(xs, stable):
        if not s:
            ax.axvspan(x - h, x + h, color="0.85", lw=0, zorder=0)


def radius_sweep(material="WS2", radii=None):
    radii = np.arange(280, 311, 1) * 1e-9 if radii is None else radii
    rows = []
    for rr in radii:
        r = analyse(req_with(material=material, radius=float(rr)))
        rows.append(dict(radius=float(rr), stable=r["stable"], z_eq=r["z_eq"], freq=r["freq"],
                         depth=r["depth"], recoil=r["recoil_ratio"], at=r["at"]))
    return rows


def main():
    t0 = time.time()
    data = {}

    # ---- Fig 1a / S1: force map over intensity, full and MQ-only ---------
    fig, axs = plt.subplots(1, 2, figsize=(10, 5.2), constrained_layout=True)
    for ax, (title, mp) in zip(axs, [("all multipoles", None),
                                     ("magnetic quadrupole only", dict(ED=False, MD=False, EQ=False, MQ=True, higher=False))]):
        r = req_with(radius=300e-9)
        if mp:
            r["multipoles"] = mp
        res = analyse(r, detail=True)
        M = res["map"]
        I = np.array(M["I"])
        ax.imshow(I / I.max(), extent=[M["Ix"][0] / WL, M["Ix"][-1] / WL, M["Iz"][0] / WL, M["Iz"][-1] / WL],
                  origin="lower", cmap="Blues", aspect="equal")
        X, Z = np.meshgrid(np.array(M["x"]) / WL, np.array(M["z"]) / WL)
        FX, FZ = np.array(M["Fx"]), np.array(M["Fz"])
        mag = np.hypot(FX, FZ)
        ax.quiver(X, Z, FX / mag, FZ / mag, color="#c62f2e", scale=28, width=0.004)
        if res["z_eq"] is not None:
            ax.add_patch(plt.Circle((0, res["z_eq"] / WL), 300e-9 / WL, fill=False, color="k", lw=1.5))
        ax.set_title(f"WS$_2$, R = 300 nm, {title}")
        ax.set_xlabel("x / $\\lambda_0$")
        ax.set_ylabel("z / $\\lambda_0$")
        data[f"map_{'mq' if mp else 'all'}"] = dict(z_eq=res["z_eq"], stable=res["stable"])
    fig.savefig(os.path.join(OUT, "fig1a_S1.png"), dpi=130)
    plt.close(fig)

    # ---- Fig 1b: multipoles vs wavelength, particle at the focus -----------
    wls = np.arange(1450, 1701, 10) * 1e-9
    mp_rows = []
    for wl in wls:
        r = req_with(radius=300e-9)
        r["wavelength"] = float(wl)  # index kept at 3.79 + 2.83e-10 i (no dispersion data)
        res = analyse(r)
        mp_rows.append(res["at"]["multipoles"])
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
        axs[2].semilogy(R, [r["at"]["multipoles"][k] for r in rows], color=c, lw=2, label=k)
    axs[2].set_ylabel("$P_{sca}/P$ at $z_{eq}$")
    axs[2].set_ylim(1e-7, 1e-2)
    axs[2].legend(fontsize=8, ncol=4)
    axs[3].plot(R, sel(lambda r: r["depth"]["x"] / (1.380649e-23 * 300)), color=C_RAD, lw=2, label="radial")
    axs[3].plot(R, sel(lambda r: r["depth"]["z"] / (1.380649e-23 * 300)), color=C_AX, lw=2, label="axial")
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
    ax.plot(R, [r["at"]["P_abs"] * 1e9 for r in rows], color=C_RAD, lw=2)
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
        zz = [r["z_eq"] / WL if r["stable"] else np.nan for r in rows_m]
        fz = [r["freq"]["z"] / 1e3 if r["stable"] else np.nan for r in rows_m]
        fx = [r["freq"]["x"] / 1e3 if r["stable"] else np.nan for r in rows_m]
        axs[0].plot(Rm, zz, color=palette[mat], lw=2, label=mat)
        axs[1].plot(Rm, fz, color=palette[mat], lw=2, label=f"{mat} axial")
        axs[1].plot(Rm, fx, color=palette[mat], lw=1.5, ls="--")
    axs[0].set_ylabel("$z_{eq}/\\lambda_0$")
    axs[1].set_ylabel("$\\Omega/2\\pi$ (kHz)  (solid axial, dashed radial)")
    for ax in axs:
        ax.set_xlabel("particle radius (nm)")
        ax.legend(fontsize=8)
    fig.savefig(os.path.join(OUT, "figS2.png"), dpi=130)
    plt.close(fig)

    with open(os.path.join(OUT, "paper_figures.json"), "w") as f:
        json.dump(api._finite(data), f)
    print(f"done in {time.time() - t0:.0f} s -> {OUT}")


if __name__ == "__main__":
    main()
