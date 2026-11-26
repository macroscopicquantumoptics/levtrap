"""levtrap against OTT itself on the dark (bottle-beam) trap of arXiv:2607.09896.

tests/fixtures/ott_dark_trap.json was computed in MATLAB by OTT v1 (master @
e6736643, the commit levtrap ports) with scripts/ott/dark_trap_reference.m.
OTT did every step on its own: the waist -> angle mapping, the power split
that darkens the focus, the coherent LG00 + LG10 sum with phase pi, the beam
coefficients, the Mie T-matrix and the forces.  Agreement here means the
paper/levtrap differences (docs/paper/CHECKLIST.md) are not in levtrap's
code: OTT given the same inputs gives the same trap.
"""

import json
import math
import pathlib

import numpy as np
import pytest

from levtrap.api import _beam_angle, _single_beam, build_beam, build_tmatrix
from levtrap.force import forcetorque
from levtrap.setup import parse
from levtrap.solve import resolve_particle, solve

REF = json.loads((pathlib.Path(__file__).parent / "fixtures" / "ott_dark_trap.json").read_text())
INP = REF["inputs"]


def _setup(split):
    common = dict(kind="beam", wavelength=INP["wavelength"], polarisation="circular+",
                  direction=[0, 0, 1], position=[0, 0, 0])
    fields = []
    for i, (w, mode, phase, frac) in enumerate(zip(INP["waists"], INP["modes"], INP["phases"], split)):
        f = dict(common, id=f"b{i + 1}", power=INP["power"] * frac, focus=dict(kind="lens", waist=w),
                 mode=dict(type="lg", indices=list(mode)), phase=phase)
        if i:
            f["coherent_with"] = "b1"
        fields.append(f)
    s = parse(dict(version=1,
                   particle=dict(material="WS2", radius=INP["radius"], n=INP["n"], k=INP["k"], density=7500.0),
                   environment=dict(medium_index=INP["medium_index"], temperature=300.0),
                   trap=dict(fields=fields)))
    resolve_particle(s)
    return s


@pytest.fixture(scope="module")
def trap():
    s = _setup(REF["split"])
    beam, _ = build_beam(s)
    T, _ = build_tmatrix(s)
    return s, beam, T


def test_angles_and_dark_split():
    s = _setup((0.5, 0.5))
    fields = s["trap"]["fields"]
    angles = [_beam_angle(b["focus"], INP["wavelength"], INP["medium_index"],
                          2 * b["mode"]["indices"][0] + abs(b["mode"]["indices"][1])) for b in fields]
    assert angles == pytest.approx(REF["angles"], rel=1e-12)
    e = [float(np.sum(np.abs(_single_beam(b, 1.0).em_field_xyz(np.zeros((1, 3)))) ** 2)) for b in fields]
    assert [e[1] / (e[0] + e[1]), e[0] / (e[0] + e[1])] == pytest.approx(REF["split"], rel=1e-9)


def test_beam_coefficients(trap):
    _, beam, _ = trap
    assert beam.Nmax == REF["Nmax"]
    for ours, re, im in ((beam.a[:, 0], REF["a_re"], REF["a_im"]), (beam.b[:, 0], REF["b_re"], REF["b_im"])):
        ott = np.asarray(re) + 1j * np.asarray(im)
        assert np.linalg.norm(ours - ott) / np.linalg.norm(ott) < 1e-12


@pytest.mark.parametrize("cut", ["axial", "radial"])
def test_forces(trap, cut):
    _, beam, T = trap
    ref = REF[cut]
    if cut == "axial":
        z = np.asarray(ref["z"])
        pos = np.vstack([np.zeros_like(z), np.zeros_like(z), z])
    else:
        x = np.asarray(ref["x"])
        pos = np.vstack([x, np.zeros_like(x), np.full_like(x, ref["z"])])
    f = np.real(np.asarray(forcetorque(beam, T, position=pos)[0]))
    ott = np.asarray(ref["force"])
    assert np.max(np.abs(f - ott)) / np.max(np.abs(ott)) < 1e-10


def test_solver_equilibrium_is_otts_force_zero():
    """The solver's z_eq is where OTT's axial force crosses zero going down."""
    z = np.asarray(REF["axial"]["z"])
    fz = np.asarray(REF["axial"]["force"])[2]
    i = next(i for i in range(len(z) - 1) if fz[i] > 0 >= fz[i + 1])
    z0 = z[i] - fz[i] * (z[i + 1] - z[i]) / (fz[i + 1] - fz[i])
    r = solve(_setup(REF["split"]))
    assert r["equilibrium"] is not None
    assert r["equilibrium"][2] == pytest.approx(z0, abs=0.01 * INP["wavelength"])
    assert math.hypot(*r["equilibrium"][:2]) < 1e-9
