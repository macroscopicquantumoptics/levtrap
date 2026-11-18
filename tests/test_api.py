"""api.py: the JSON entry points that remain after E2 (the old site's
``compute`` / ``sweep`` / ``presets`` went with web/), and the builders
``solve`` uses."""

import base64
import json

import numpy as np
import pytest

from levtrap import api
from levtrap.materials import get_material

SILICA = dict(setup=dict(version=1, particle=dict(material="SiO2", radius=100e-9),
                         trap=dict(fields=[dict(kind="beam", wavelength=1064e-9, power=0.2, focus=dict(NA=0.9))])),
              options=dict(scan=dict(z_range=2.5e-6, x_range=1.2e-6)))


def test_material_fills_n_and_k():
    """A setup naming only a material gets n, k and density at the beam wavelength."""
    s, _ = api.prepare(dict(setup=dict(
        version=1, particle=dict(material="SiO2", radius=100e-9),
        trap=dict(fields=[dict(kind="beam", wavelength=1550e-9, power=0.1, focus=dict(NA=0.9))]))))
    m = get_material("SiO2", 1550e-9)
    assert (s["particle"]["n"], s["particle"]["k"], s["particle"]["density"]) == (m["n"], m["k"], m["density"])


def test_materials():
    m = get_material("SiO2", 1550e-9)
    assert m["valid"] and m["n"] == pytest.approx(1.44)
    m = get_material("SiO2", 1064e-9)
    assert m["valid"] and m["n"] == pytest.approx(1.4496, abs=2e-4)  # Malitson
    assert not get_material("WS2", 1064e-9)["valid"]
    assert json.loads(api.materials(1550e-9))["WS2"]["n"] == pytest.approx(3.79)


def test_benchmark_endpoint():
    b = json.loads(api.benchmark())
    assert abs(b["z"] - b["expected"]["z"]) < 1e-9


def test_field3d_volume():
    """The field map's data: decodes to the right size and matches direct field evaluation."""
    out = json.loads(api.field3d(json.dumps(SILICA), json.dumps({"nxy": 24, "nz": 32, "forces": True, "force_n": [3, 3]})))
    assert len(base64.b64decode(out["I"])) == 24 * 24 * 32
    assert len(out["forces"]["pos"]) == 27
    beam, _ = api.build_beam(*api.prepare(SILICA))
    I, x, y, z = api.intensity_volume(beam, 1e-6, 2e-6, 48, 64)
    rng = np.random.default_rng(1)
    ijk = [tuple(int(rng.integers(0, s)) for s in I.shape) for _ in range(40)]
    pts = np.array([[x[i], y[j], z[k]] for i, j, k in ijk])
    direct = 4 * beam.k_medium**2 * np.sum(np.abs(beam.em_field_xyz(pts)) ** 2, 1)
    vol = np.array([I[t] for t in ijk])
    assert np.max(np.abs(vol - direct)) < 0.02 * I.max()  # interpolated: visual accuracy


def test_two_coherent_beams_carry_the_total_power():
    """build_beam: the sum of the power entries is the power of the coherent
    superposition (the beams are not orthogonal), split as the entries say."""
    beams = [dict(kind="beam", id="a", wavelength=1550e-9, power=0.3, focus=dict(waist=1.59e-6)),
             dict(kind="beam", id="b", coherent_with="a", wavelength=1550e-9, power=0.5, focus=dict(waist=0.866e-6),
                  mode=dict(type="lg", indices=[1, 0]), phase=np.pi)]
    req = dict(setup=dict(version=1, particle=dict(radius=300e-9, n=3.79, density=7500), trap=dict(fields=beams)))
    beam, P = api.build_beam(*api.prepare(req))
    assert P == pytest.approx(0.8, rel=1e-9)
    p = beam.info["powers"]
    assert p[0] / p[1] == pytest.approx(0.3 / 0.5)


def test_dispatch():
    out = json.loads(api.handle("materials", 1550e-9))
    assert out["SiO2"]["valid"]
    # the old site's entry points are gone
    for gone in ("compute", "sweep", "presets"):
        with pytest.raises(KeyError):
            api.handle(gone)
