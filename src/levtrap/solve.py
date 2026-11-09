"""``solve(setup) -> result``: the one entry point of the engine.

See ``docs/ARCHITECTURE.md`` §4 (Setup) and §6 (Result).  Everything is SI.

This first version covers what the OTT port already computes: one beam, or
one coherent group of two beams, travelling along +z with the focus at the
origin.  It delegates to :func:`levtrap.api.analyse`, so the numbers are
those of the validated engine.  Other setups raise :class:`UnsupportedSetup`
naming what is missing; the generic field solver replaces this path.
"""

from __future__ import annotations

import json
from typing import Any, Iterable

from . import __version__
from .materials import get_material
from .setup import SetupError, parse, unknown_keys

__all__ = ["solve", "solve_json", "UnsupportedSetup", "RESULT_VERSION", "WANTS"]

RESULT_VERSION = 1
WANTS = ("curves",)
AXES = {"x": [1.0, 0.0, 0.0], "y": [0.0, 1.0, 0.0], "z": [0.0, 0.0, 1.0]}


class UnsupportedSetup(NotImplementedError):
    """The setup is valid but this version of the engine cannot compute it yet."""


def _legacy_request(s: dict, warnings: list[str]) -> dict:
    """Translate a setup into the request of :func:`levtrap.api.analyse`."""
    fields = s["trap"]["fields"]
    others = sorted({f["kind"] for f in fields if f["kind"] != "beam"})
    if others:
        raise UnsupportedSetup(f"{', '.join(others)} fields are not computed yet")
    beams = fields
    if len(beams) > 2:
        raise UnsupportedSetup("more than two beams are not computed yet")
    for i, b in enumerate(beams):
        dx, dy, dz = b["direction"]
        if dx or dy or dz <= 0:
            raise UnsupportedSetup(f"trap.fields[{i}].direction: only beams along +z are computed yet")
        if any(b["position"]):
            raise UnsupportedSetup(f"trap.fields[{i}].position: only a focus at the origin is computed yet")
    if len(beams) == 2:
        a, b = beams
        linked = (a["coherent_with"] is not None and a["coherent_with"] == b.get("id")) or \
                 (b["coherent_with"] is not None and b["coherent_with"] == a.get("id"))
        if not linked:
            raise UnsupportedSetup("two beams that are not coherent with each other are not computed yet")
    wl = beams[0]["wavelength"]

    p = s["particle"]
    n, k, density = p["n"], p["k"], p["density"]
    if p["material"] is not None and (n is None or k is None or density is None):
        m = get_material(p["material"], wl)
        if not m["valid"] and n is None:
            raise SetupError("particle.material", f"no refractive-index data for {p['material']} at "
                                                  f"{wl * 1e9:.0f} nm; give n and k")
        n = m["n"] if n is None else n
        k = m["k"] if k is None else k
        density = m["density"] if density is None else density

    def beam(b: dict) -> dict:
        f = b["focus"]
        spec = dict(type=b["mode"]["type"], mode=b["mode"]["indices"], power=b["power"],
                    polarisation=b["polarisation"], phase=b["phase"])
        spec.update({key: f[key] for key in ("NA", "waist", "angle_deg") if f.get(key) is not None})
        return spec

    return dict(wavelength=wl, medium_index=s["environment"]["medium_index"],
                temperature=s["environment"]["temperature"],
                particle=dict(radius=p["radius"], n=n, k=k, density=density),
                beams=[beam(b) for b in beams])


def solve(setup: dict | str, want: Iterable[str] = ()) -> dict:
    """Compute the result of a setup.

    Parameters
    ----------
    setup : dict or JSON text, see :mod:`levtrap.setup`.
    want : extra blocks to compute, from :data:`WANTS`.  ``"curves"`` adds the
        force along x, y and z through the equilibrium.

    Returns
    -------
    dict (``json.dumps``-able):

    * ``stable`` — a restoring force along all three axes.
    * ``equilibrium`` — [x, y, z] in m, or ``None``.
    * ``modes`` — per axis: ``axis`` (unit vector), ``frequency`` [Hz],
      ``stiffness`` [N/m], ``depth`` [J].  ``frequency`` is ``None`` where
      the stiffness is not positive.
    * ``depth`` — the smallest of the three, as ``J``, ``K`` and ``kT`` (at
      the environment temperature); zero when not stable.
    * ``particle`` — resolved ``n``, ``k``, ``density`` and ``mass`` [kg].
    * ``optical`` — scattered and absorbed power [W] at the equilibrium, and
      the plane-wave Mie efficiencies.
    * ``models``, ``warnings`` — what was used and what to be careful about.
    """
    from .api import analyse  # late import: api imports the whole engine

    want = tuple(want)
    bad = [w for w in want if w not in WANTS]
    if bad:
        raise SetupError("want", f"unknown block {bad[0]!r}; choose from {', '.join(WANTS)}")
    raw = json.loads(setup) if isinstance(setup, str) else setup
    s = parse(raw)
    warnings = [f"{path}: unknown key, ignored" for path in unknown_keys(raw)]
    req = _legacy_request(s, warnings)
    r = analyse(req, detail=False)
    warnings += r.get("notes", [])

    z_eq = r["z_eq"]
    depth = r.get("depth") or {}
    modes = [dict(name=a, axis=AXES[a], frequency=r["freq"][a], stiffness=r["stiffness"][a],
                  depth=depth.get(a))
             for a in "xyz"]
    if z_eq is None:
        warnings.append("No stable trap: the force along the beam axis (z) never restores the particle.")
    elif not r["stable"]:
        loose = [m["name"] for m in modes if m["stiffness"] is None or m["stiffness"] <= 0]
        warnings.append("No stable trap: the particle is pushed away along " + ", ".join(loose) + ".")

    result: dict[str, Any] = dict(
        version=RESULT_VERSION,
        engine=__version__,
        stable=bool(r["stable"]),
        equilibrium=None if z_eq is None else [0.0, 0.0, z_eq],
        modes=modes,
        depth=dict(J=depth.get("U", 0.0), K=depth.get("K", 0.0), kT=depth.get("kT", 0.0)),
        particle=dict(n=req["particle"]["n"], k=req["particle"]["k"],
                      density=req["particle"]["density"], mass=r["mass"]),
        optical=dict(P_sca=r["at"]["P_sca"], P_abs=r["at"]["P_abs"], power=r["power"],
                     Qext=r["mie"]["Qext"], Qsca=r["mie"]["Qsca"], Qabs=r["mie"]["Qabs"],
                     size_parameter=r["mie"]["x"], Nmax=r["Nmax"]),
        models=[dict(quantity="modes", model="mie", validity="ok", notes=[]),
                dict(quantity="optical", model="mie", validity="ok", notes=[])],
        warnings=warnings,
        time=r["time"],
    )
    if "curves" in want:
        ln = r["lines"]
        result["curves"] = dict(
            x=dict(position=ln["x"], force=ln["Fx"][0]),
            y=dict(position=ln["y"], force=ln["Fy"][1]),
            z=dict(position=ln["z"], force=ln["Fz"][2]),
        )
    return result


def solve_json(setup_json: str, want_json: str = "[]") -> str:
    """JSON wrapper for the web worker: ``{"ok": true, "result": …}`` or
    ``{"ok": false, "error": …, "kind": "setup" | "unsupported" | "internal", "path": …}``."""
    try:
        return json.dumps(dict(ok=True, result=solve(setup_json, json.loads(want_json))))
    except SetupError as exc:
        return json.dumps(dict(ok=False, kind="setup", path=exc.path, error=exc.message))
    except UnsupportedSetup as exc:
        return json.dumps(dict(ok=False, kind="unsupported", error=str(exc)))
    except Exception as exc:  # report to the UI rather than crash the worker
        return json.dumps(dict(ok=False, kind="internal", error=f"{type(exc).__name__}: {exc}"))
