"""Setup files: parse, validate and migrate (``docs/ARCHITECTURE.md`` §4).

A *setup* is everything the engine needs: a particle, an environment and a
trap made of fields.  It is plain JSON, SI units throughout (charge in
elementary charges).  :func:`parse` returns a normalised copy with every
default filled in, so ``parse(parse(x)) == parse(x)`` and the result
survives a JSON round trip unchanged.

Unknown keys are kept in place and listed by :func:`unknown_keys`; they are
never dropped, so a file written by a newer version is not damaged by an
older one.
"""

from __future__ import annotations

import copy
import json
import math
from typing import Any, Callable

from .materials import MATERIALS

__all__ = ["VERSION", "SetupError", "parse", "unknown_keys", "loads", "dumps", "DEFAULT_SETUP"]

VERSION = 1

GASES = ("N2", "He", "air")
POLARISATIONS = ("x", "y", "circular+", "circular-")
#: Zernike terms ``focus.aberration`` may name (#83; :data:`levtrap.bsc.ZERNIKE`), and their limit in waves rms.
ABERRATIONS = ("spherical", "astigmatism_0", "astigmatism_45", "coma_x", "coma_y")
ABERRATION_MAX = 1.0

#: Real lenses a beam can be focused by (``focus.kind = "asphere"``, :mod:`levtrap.lens`).
LENSES = ("354330-C",)


class SetupError(ValueError):
    """An invalid setup.  ``path`` names the offending key, e.g. ``trap.fields[0].power``."""

    def __init__(self, path: str, message: str):
        self.path = path
        self.message = message
        super().__init__(f"{path}: {message}" if path else message)


# ---------------------------------------------------------------------------
# small validators
# ---------------------------------------------------------------------------


def _obj(v: Any, path: str) -> dict:
    if not isinstance(v, dict):
        raise SetupError(path, "must be an object")
    return v


def _num(v: Any, path: str, *, min: float | None = None, exclusive_min: float | None = None,
         max: float | None = None) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise SetupError(path, "must be a finite number")
    if min is not None and v < min:
        raise SetupError(path, f"must be at least {min:g}")
    if exclusive_min is not None and v <= exclusive_min:
        raise SetupError(path, f"must be greater than {exclusive_min:g}")
    if max is not None and v > max:
        raise SetupError(path, f"must be at most {max:g}")
    return float(v)


def _vec3(v: Any, path: str, *, nonzero: bool = False) -> list[float]:
    if not isinstance(v, (list, tuple)) or len(v) != 3:
        raise SetupError(path, "must be a list of three numbers")
    out = [_num(c, f"{path}[{i}]") for i, c in enumerate(v)]
    if nonzero and not any(out):
        raise SetupError(path, "must not be the zero vector")
    return out


def _choice(v: Any, path: str, options) -> Any:
    if v not in options:
        raise SetupError(path, "must be one of " + ", ".join(repr(o) for o in options))
    return v


def _get(d: dict, key: str, path: str, default: Any = ...):
    if key in d and d[key] is not None:
        return d[key]
    if default is ...:
        raise SetupError(f"{path}.{key}" if path else key, "is required")
    return default


# ---------------------------------------------------------------------------
# sections
# ---------------------------------------------------------------------------


def _particle(p: dict, path: str) -> dict:
    out = dict(p)
    out["radius"] = _num(_get(p, "radius", path), f"{path}.radius", exclusive_min=0)
    material = p.get("material")
    if material is not None:
        _choice(material, f"{path}.material", tuple(MATERIALS))
    out["material"] = material
    for key, kw in (("n", dict(exclusive_min=0)), ("k", dict(min=0)), ("density", dict(exclusive_min=0))):
        if p.get(key) is not None:
            out[key] = _num(p[key], f"{path}.{key}", **kw)
        elif material is None:
            if key == "k":
                out[key] = 0.0
            else:
                raise SetupError(f"{path}.{key}", "is required when no material is given")
        else:
            out[key] = None  # taken from the material at the beam's wavelength
    out["charge"] = _num(p.get("charge", 0) or 0, f"{path}.charge")
    return out


def _environment(e: dict, path: str) -> dict:
    out = dict(e)
    out["pressure"] = _num(_get(e, "pressure", path, 1e-4), f"{path}.pressure", min=0)
    out["temperature"] = _num(_get(e, "temperature", path, 300.0), f"{path}.temperature", exclusive_min=0)
    out["gas"] = _choice(_get(e, "gas", path, "N2"), f"{path}.gas", GASES)
    out["medium_index"] = _num(_get(e, "medium_index", path, 1.0), f"{path}.medium_index", min=1)
    return out


def _vec2(v: Any, path: str, *, max_abs: float) -> list[float]:
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        raise SetupError(path, "must be a list of two numbers")
    return [_num(c, f"{path}[{i}]", min=-max_abs, max=max_abs) for i, c in enumerate(v)]


def _asphere(f: dict, path: str) -> dict:
    """A real lens (ray traced, :func:`levtrap.lens.focused_beam`): the beam
    is collimated, ``beam_diameter`` [m] across (1/e^2 intensity) on the
    lens; ``tilt_deg`` [deg] about x and y, about the lens's centre;
    ``decentre`` [m] along x and y. The beam's ``position`` is where the
    untilted, centred lens focuses."""
    out = dict(f)
    extra = [k for k in ("NA", "waist", "angle_deg") if f.get(k) is not None]
    if extra:
        raise SetupError(f"{path}.{extra[0]}", "is set by the lens and the beam diameter for an asphere; remove it")
    out["lens"] = _choice(_get(f, "lens", path, LENSES[0]), f"{path}.lens", LENSES)
    out["beam_diameter"] = _num(_get(f, "beam_diameter", path), f"{path}.beam_diameter", exclusive_min=0, max=0.02)
    out["tilt_deg"] = _vec2(_get(f, "tilt_deg", path, [0.0, 0.0]), f"{path}.tilt_deg", max_abs=20)
    out["decentre"] = _vec2(_get(f, "decentre", path, [0.0, 0.0]), f"{path}.decentre", max_abs=2.5e-3)
    for key in ("NA", "waist", "angle_deg"):
        out.pop(key, None)
    return out


def _parabolic_mirror(f: dict, path: str) -> dict:
    """A parabolic mirror (:mod:`levtrap.mirror`): the collimated beam,
    ``beam_diameter`` [m] across (1/e^2 intensity), is reflected to the focus
    by a paraboloid of ``focal_length`` [m] with its rim ``rim_radius`` [m]
    from the axis and a central hole of ``hole_radius`` [m]. A rim beyond
    twice the focal length is above the focal plane (a deep mirror). The
    beam's ``position`` is the focus; its ``direction`` points from the
    mirror's vertex through the focus."""
    out = dict(f)
    extra = [k for k in ("NA", "waist", "angle_deg") if f.get(k) is not None]
    if extra:
        raise SetupError(f"{path}.{extra[0]}", "is set by the mirror and the beam diameter; remove it")
    out["focal_length"] = _num(_get(f, "focal_length", path), f"{path}.focal_length", exclusive_min=0, max=0.1)
    out["rim_radius"] = _num(_get(f, "rim_radius", path), f"{path}.rim_radius", exclusive_min=0, max=0.1)
    out["hole_radius"] = _num(_get(f, "hole_radius", path, 0.0), f"{path}.hole_radius", min=0)
    if out["hole_radius"] >= out["rim_radius"]:
        raise SetupError(f"{path}.hole_radius", "must be smaller than the rim radius")
    out["beam_diameter"] = _num(_get(f, "beam_diameter", path), f"{path}.beam_diameter", exclusive_min=0, max=0.1)
    for key in ("NA", "waist", "angle_deg"):
        out.pop(key, None)
    return out


def _focus(f: dict, path: str) -> dict:
    out = dict(f)
    out["kind"] = _choice(_get(f, "kind", path, "lens"), f"{path}.kind", ("lens", "asphere", "parabolic_mirror"))
    if out["kind"] == "asphere":
        return _asphere(f, path)
    if out["kind"] == "parabolic_mirror":
        return _parabolic_mirror(f, path)
    given = [k for k in ("NA", "waist", "angle_deg") if f.get(k) is not None]
    if len(given) != 1:
        raise SetupError(path, "give exactly one of NA, waist or angle_deg")
    key = given[0]
    limits = dict(NA=dict(exclusive_min=0), waist=dict(exclusive_min=0),
                  angle_deg=dict(exclusive_min=0, max=90))[key]
    out[key] = _num(f[key], f"{path}.{key}", **limits)
    if f.get("filling") is not None:
        # an objective's back aperture filled by a Gaussian (issue #61): needs the aperture, i.e. the NA
        if key != "NA":
            raise SetupError(f"{path}.filling", "needs the objective's NA (the aperture it fills); remove it or give NA")
        out["filling"] = _num(f["filling"], f"{path}.filling", exclusive_min=0, max=10)
    if f.get("aberration") is not None:
        # a real objective's wavefront error (#83): Zernike terms, rms waves, over its pupil (rho = sin theta / NA)
        if out.get("filling") is None:
            raise SetupError(f"{path}.aberration", "needs a filled objective (NA and filling): the pupil it is measured over")
        ab = _obj(f["aberration"], f"{path}.aberration")
        unknown = [k for k in ab if k not in ABERRATIONS]
        if unknown:
            raise SetupError(f"{path}.aberration.{unknown[0]}", f"unknown term; known: {', '.join(ABERRATIONS)}")
        out["aberration"] = {k: _num(v, f"{path}.aberration.{k}", min=-ABERRATION_MAX, max=ABERRATION_MAX)
                             for k, v in ab.items()}
    if f.get("mapping") is not None:
        # how the paraxial beam meets the far field (#64): OTT's tan(theta) (default) or the textbook sine
        out["mapping"] = _choice(f["mapping"], f"{path}.mapping", ("ott", "sine"))
        if out.get("filling") is not None and out["mapping"] != "sine":
            raise SetupError(f"{path}.mapping", "a filled objective maps by the sine condition; remove mapping")
    return out


def _mode(m: dict, path: str) -> dict:
    out = dict(m)
    out["type"] = _choice(_get(m, "type", path, "lg"), f"{path}.type", ("lg", "hg"))
    idx = _get(m, "indices", path, [0, 0])
    if (not isinstance(idx, (list, tuple)) or len(idx) != 2
            or any(isinstance(i, bool) or not isinstance(i, int) for i in idx)):
        raise SetupError(f"{path}.indices", "must be two integers")
    if idx[0] < 0 or (out["type"] == "hg" and idx[1] < 0):
        raise SetupError(f"{path}.indices", "mode indices must not be negative (LG azimuthal index may be)")
    out["indices"] = [int(idx[0]), int(idx[1])]
    return out


def _polarisation(p: Any, path: str):
    if isinstance(p, str):
        return _choice(p, path, POLARISATIONS)
    # Jones vector as [[re, im], [re, im]] in the beam's own (x, y) frame
    if (isinstance(p, (list, tuple)) and len(p) == 2
            and all(isinstance(c, (list, tuple)) and len(c) == 2 for c in p)):
        out = [[_num(c[0], f"{path}[{i}][0]"), _num(c[1], f"{path}[{i}][1]")] for i, c in enumerate(p)]
        if not any(v for c in out for v in c):
            raise SetupError(path, "must not be zero")
        return out
    raise SetupError(path, "must be 'x', 'y', 'circular+', 'circular-' or [[re, im], [re, im]]")


def _beam(f: dict, path: str) -> dict:
    out = dict(f)
    out["wavelength"] = _num(_get(f, "wavelength", path), f"{path}.wavelength", exclusive_min=0)
    out["power"] = _num(_get(f, "power", path), f"{path}.power", min=0)
    out["focus"] = _focus(_obj(_get(f, "focus", path), f"{path}.focus"), f"{path}.focus")
    out["mode"] = _mode(_obj(_get(f, "mode", path, {}), f"{path}.mode"), f"{path}.mode")
    out["polarisation"] = _polarisation(_get(f, "polarisation", path, "x"), f"{path}.polarisation")
    out["direction"] = _vec3(_get(f, "direction", path, [0, 0, 1]), f"{path}.direction", nonzero=True)
    out["position"] = _vec3(_get(f, "position", path, [0, 0, 0]), f"{path}.position")
    out["phase"] = _num(_get(f, "phase", path, 0.0), f"{path}.phase")
    cw = f.get("coherent_with")
    if cw is not None and not isinstance(cw, str):
        raise SetupError(f"{path}.coherent_with", "must be the id of another beam, or null")
    out["coherent_with"] = cw
    return out


def _paul(f: dict, path: str) -> dict:
    out = dict(f)
    out["geometry"] = _choice(_get(f, "geometry", path), f"{path}.geometry", ("linear", "ring"))
    out["rf_voltage"] = _num(_get(f, "rf_voltage", path), f"{path}.rf_voltage", min=0)
    out["rf_frequency"] = _num(_get(f, "rf_frequency", path), f"{path}.rf_frequency", exclusive_min=0)
    out["dc_voltage"] = _num(_get(f, "dc_voltage", path, 0.0), f"{path}.dc_voltage")
    out["endcap_voltage"] = _num(_get(f, "endcap_voltage", path, 0.0), f"{path}.endcap_voltage")
    out["r0"] = _num(_get(f, "r0", path), f"{path}.r0", exclusive_min=0)
    out["z0"] = _num(_get(f, "z0", path), f"{path}.z0", exclusive_min=0)
    gf = _obj(_get(f, "geometry_factors", path, {}), f"{path}.geometry_factors")
    out["geometry_factors"] = {
        **gf,
        "radial": _num(gf.get("radial", 1.0), f"{path}.geometry_factors.radial", exclusive_min=0),
        "axial": _num(gf.get("axial", 1.0), f"{path}.geometry_factors.axial", exclusive_min=0),
    }
    return out


def _gravity(f: dict, path: str) -> dict:
    out = dict(f)
    out["g"] = _vec3(_get(f, "g", path, [0.0, -9.81, 0.0]), f"{path}.g")
    return out


_FIELDS: dict[str, Callable[[dict, str], dict]] = {"beam": _beam, "paul": _paul, "gravity": _gravity}


# ---------------------------------------------------------------------------
# migrations: one function per version step, MIGRATIONS[n] takes n -> n + 1
# ---------------------------------------------------------------------------

MIGRATIONS: dict[int, Callable[[dict], dict]] = {}


def _migrate(setup: dict) -> dict:
    version = setup.get("version", VERSION)
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise SetupError("version", "must be a positive integer")
    if version > VERSION:
        raise SetupError("version", f"this file is version {version}; this levtrap reads up to {VERSION}")
    while version < VERSION:
        setup = MIGRATIONS[version](setup)
        version += 1
    return setup


# ---------------------------------------------------------------------------
# public
# ---------------------------------------------------------------------------


def parse(setup: dict | str) -> dict:
    """Validate ``setup`` and return a normalised deep copy at the current version.

    Raises :class:`SetupError` naming the offending key.
    """
    if isinstance(setup, str):
        try:
            setup = json.loads(setup)
        except json.JSONDecodeError as exc:
            raise SetupError("", f"not valid JSON ({exc.msg}, line {exc.lineno})") from None
    s = _migrate(copy.deepcopy(_obj(setup, "setup")))
    s["version"] = VERSION
    s["particle"] = _particle(_obj(_get(s, "particle", ""), "particle"), "particle")
    s["environment"] = _environment(_obj(s.get("environment") or {}, "environment"), "environment")
    trap = dict(_obj(_get(s, "trap", ""), "trap"))
    fields = _get(trap, "fields", "trap")
    if not isinstance(fields, list) or not fields:
        raise SetupError("trap.fields", "must be a non-empty list")
    out, ids = [], set()
    for i, f in enumerate(fields):
        path = f"trap.fields[{i}]"
        f = _obj(f, path)
        kind = _choice(_get(f, "kind", path), f"{path}.kind", tuple(_FIELDS))
        f = _FIELDS[kind](f, path)
        fid = f.get("id")
        if fid is not None:
            if not isinstance(fid, str) or not fid:
                raise SetupError(f"{path}.id", "must be a non-empty string")
            if fid in ids:
                raise SetupError(f"{path}.id", f"is used twice ({fid!r})")
            ids.add(fid)
        out.append(f)
    for i, f in enumerate(out):
        path = f"trap.fields[{i}]"
        if f["kind"] == "beam" and f["coherent_with"] is not None:
            other = next((g for g in out if g.get("id") == f["coherent_with"]), None)
            if other is None or other is f or other["kind"] != "beam":
                raise SetupError(f"{path}.coherent_with", "must be the id of another beam")
            if other["wavelength"] != f["wavelength"]:
                raise SetupError(f"{path}.coherent_with", "coherent beams must share one wavelength")
        if f["kind"] == "beam" and f["focus"].get("NA") is not None \
                and f["focus"]["NA"] >= s["environment"]["medium_index"]:
            raise SetupError(f"{path}.focus.NA", "must be smaller than the medium index "
                                                f"({s['environment']['medium_index']:g})")
        if f["kind"] == "beam" and f["focus"].get("waist") is not None and f["focus"].get("mapping") == "sine":
            from .special import paraxial_beam_waist
            m = f["mode"]["indices"]
            order = 2 * m[0] + abs(m[1]) if f["mode"]["type"] == "lg" else m[0] + m[1]
            limit = f["wavelength"] / s["environment"]["medium_index"] * paraxial_beam_waist(order) / math.pi
            if f["focus"]["waist"] <= limit:
                raise SetupError(f"{path}.focus.waist", f"must be larger than the diffraction limit ({limit:g} m) "
                                                        "with the sine mapping")
        if f["kind"] == "paul" and s["particle"]["charge"] == 0:
            raise SetupError("particle.charge", "a Paul trap needs a charged particle; set the charge "
                                                "(in elementary charges)")
    trap["fields"] = out
    s["trap"] = trap
    return s


_KNOWN = {
    "": {"version", "particle", "environment", "trap"},
    "particle": {"radius", "material", "n", "k", "density", "charge"},
    "environment": {"pressure", "temperature", "gas", "medium_index"},
    "trap": {"fields"},
    "beam": {"kind", "id", "wavelength", "power", "focus", "mode", "polarisation", "direction",
             "position", "phase", "coherent_with"},
    "focus": {"kind", "NA", "waist", "angle_deg", "filling", "mapping", "aberration", "lens", "beam_diameter", "tilt_deg", "decentre",
              "focal_length", "rim_radius", "hole_radius"},
    "mode": {"type", "indices"},
    "paul": {"kind", "id", "geometry", "rf_voltage", "rf_frequency", "dc_voltage", "endcap_voltage",
             "r0", "z0", "geometry_factors"},
    "geometry_factors": {"radial", "axial"},
    "gravity": {"kind", "id", "g"},
}


def unknown_keys(setup: dict) -> list[str]:
    """Paths of keys this version does not understand (they are kept, not used)."""
    found: list[str] = []

    def scan(d: Any, table: str, path: str):
        if isinstance(d, dict):
            found.extend(f"{path}.{k}" if path else k for k in d if k not in _KNOWN[table])

    scan(setup, "", "")
    for sec in ("particle", "environment", "trap"):
        scan(setup.get(sec), sec, sec)
    trap = setup.get("trap")
    for i, f in enumerate(trap.get("fields", []) if isinstance(trap, dict) else []):
        if not isinstance(f, dict) or f.get("kind") not in _FIELDS:
            continue
        path = f"trap.fields[{i}]"
        scan(f, f["kind"], path)
        for sub in ("focus", "mode", "geometry_factors"):
            scan(f.get(sub), sub, f"{path}.{sub}")
    return found


def loads(text: str) -> dict:
    """Parse a setup file's text."""
    return parse(text)


def dumps(setup: dict, indent: int | None = 2) -> str:
    """Serialise a setup (validated first)."""
    return json.dumps(parse(setup), indent=indent)


#: The setup the app opens with: a silica nanosphere in a 1064 nm tweezer.
DEFAULT_SETUP: dict = {
    "version": VERSION,
    "particle": {"radius": 1e-7, "material": "SiO2"},
    "environment": {"pressure": 1e-4, "temperature": 300.0, "gas": "N2", "medium_index": 1.0},
    "trap": {"fields": [
        {"kind": "beam", "id": "beam1", "wavelength": 1.064e-6, "power": 0.2,
         "focus": {"kind": "lens", "NA": 0.8}, "mode": {"type": "lg", "indices": [0, 0]},
         "polarisation": "x"},
    ]},
}
