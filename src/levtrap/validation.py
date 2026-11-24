"""Validation against the literature, and cross-checks between models (C4, issue #16).

* :func:`compare_reference`: run a *verified* entry of
  ``docs/validation/references.json`` (C3) through :func:`levtrap.solve.solve`
  and compare each expected value with the computed one, at the entry's
  stated tolerance.
* :func:`mie_vs_dipole`: the same optical tweezer solved with Mie theory and
  with the light as a point dipole, for growing spheres: the stiffness along
  each axis agrees for small spheres and parts as the size parameter grows.
* :func:`pseudo_vs_exact`: a ring Paul trap at growing q: the
  pseudopotential secular frequency against the exact Mathieu one; they part
  as q^2.

``python3 -m levtrap.validation`` writes ``docs/validation/README.md``, the
table of all three.
"""

from __future__ import annotations

import copy
import json
import math
import pathlib
from typing import Any

import numpy as np

from .setup import DEFAULT_SETUP
from .solve import solve

__all__ = [
    "REFERENCES",
    "compare_reference",
    "load_references",
    "mie_vs_dipole",
    "model_of",
    "pseudo_vs_exact",
    "quantity",
    "write_readme",
]

ROOT = pathlib.Path(__file__).resolve().parents[2]
REFERENCES = ROOT / "docs" / "validation" / "references.json"
README = ROOT / "docs" / "validation" / "README.md"


def load_references(path: pathlib.Path = REFERENCES) -> dict:
    return json.loads(pathlib.Path(path).read_text())


# --- reading a computed quantity -----------------------------------------------------------

def quantity(result: dict, name: str) -> float | None:
    """A number of a Result by the names references.json uses in ``expected``:

    * ``frequency.x`` / ``.y`` / ``.z``: a mode's frequency [Hz], by name;
    * ``frequency.max`` / ``frequency.min``: the highest / lowest mode;
    * ``depth.kT``, ``depth.K``: the trap depth;
    * ``gas_damping``: [1/s];
    * ``secular.exact.<axis>`` / ``secular.pseudopotential.<axis>``: Paul secular frequencies [Hz];
    * ``recoil_heating.<axis>``: [phonons/s], photon recoil alone;
    * ``reheating.<axis>``: [phonons/s], recoil plus gas, what a reheating
      measurement with the feedback off sees.
    """
    head, _, tail = name.partition(".")
    if head == "frequency":
        freqs = {m["name"]: m["frequency"] for m in result["modes"] if m.get("frequency")}
        if tail == "max":
            return max(freqs.values(), default=None)
        if tail == "min":
            return min(freqs.values(), default=None)
        return freqs.get(tail)
    if head == "depth":
        return result["depth"].get(tail)
    if head == "gas_damping":
        return (result.get("rates") or {}).get("gas_damping")
    if head == "secular":
        kind, _, axis = tail.partition(".")
        return ((result.get("paul") or {}).get("secular") or {}).get(kind, {}).get(axis)
    if head in ("recoil_heating", "reheating"):
        rates = result.get("rates") or {}
        return next((m[head] for m in rates.get("modes", []) if m["name"] == tail), None)
    raise KeyError(f"unknown quantity {name!r}")


#: The entries of a Result's ``models`` each quantity is computed with: a
#: reheating rate is recoil plus gas, so it names both.
_MODELS_OF = {"frequency": ("modes",), "depth": ("modes",), "gas_damping": ("gas_damping",),
              "recoil_heating": ("recoil_heating",), "reheating": ("recoil_heating", "gas_damping")}


def model_of(result: dict, name: str) -> str:
    """The model(s) behind a quantity of :func:`quantity`, as the Result names
    them, e.g. ``mie`` or ``dipole-pattern + knudsen-interpolation``. A Paul
    secular frequency is the model it names (``secular.exact.z``: ``mathieu``)."""
    head, _, tail = name.partition(".")
    if head == "secular":
        kind = tail.partition(".")[0]
        return "mathieu" if kind == "exact" else kind
    models = {m["quantity"]: m["model"] for m in result.get("models", [])}
    return " + ".join(models[q] for q in _MODELS_OF.get(head, ()) if q in models)


def compare_reference(entry: dict) -> list[dict]:
    """Solve a verified entry's Setup; per expected value: the reference, the
    computed value, their ratio, whether it is within the tolerance, and the
    model it was computed with."""
    result = solve(entry["setup"])
    out = []
    for e in entry["expected"]:
        got = quantity(result, e["quantity"])
        ok = got is not None and abs(got / e["value"] - 1) <= e["tolerance_rel"]
        out.append(dict(quantity=e["quantity"], reference=e["value"], computed=got, unit=e["unit"],
                        ratio=None if got is None else got / e["value"], tolerance_rel=e["tolerance_rel"],
                        ok=ok, model=model_of(result, e["quantity"])))
    return out


# --- cross-checks between models ------------------------------------------------------------

def _slope(curve: dict, key: str) -> float:
    """-dF/ds at the middle of a cut [N/m], by a central difference."""
    s, f = np.asarray(curve["position"]), np.asarray(curve[key])
    i = len(s) // 2
    return float(-(f[i + 1] - f[i - 1]) / (s[i + 1] - s[i - 1]))


def mie_vs_dipole(radii=(20e-9, 50e-9, 100e-9, 200e-9, 400e-9)) -> list[dict]:
    """The default tweezer (1064 nm, NA 0.8, silica, in vacuum) at each
    radius: the stiffness along each eigen-axis at the Mie equilibrium, from
    Mie theory and from the dipole approximation (same difference scheme),
    and the size parameter k a."""
    rows = []
    for a in radii:
        s = copy.deepcopy(DEFAULT_SETUP)
        s["particle"]["radius"] = a
        r = solve(s, want=["dipole"])
        if not r["stable"]:
            rows.append(dict(radius=a, size_parameter=r["optical"]["size_parameter"], stable=False))
            continue
        ratio = {name: _slope(c, "dipole") / _slope(c, "force") for name, c in r["curves"].items()}
        rows.append(dict(radius=a, size_parameter=r["optical"]["size_parameter"], stable=True, dipole_over_mie=ratio))
    return rows


def _paul_setup(q: float) -> dict:
    """A ring trap (z0 = r0 / sqrt(2)) for a charged 5 um silica sphere, the RF set for radial |q| = q."""
    from .derived import sphere_mass
    from .fields.paul import E_CHARGE
    radius, density, charge, r0, f_rf = 5e-6, 2200.0, 1e4, 1e-3, 500.0
    mass, omega = sphere_mass(radius, density), 2 * math.pi * f_rf
    V = q * mass * omega**2 * r0**2 / (2 * charge * E_CHARGE)
    return dict(version=1, particle=dict(radius=radius, n=1.45, density=density, charge=charge),
                trap=dict(fields=[dict(kind="paul", geometry="ring", rf_voltage=V, rf_frequency=f_rf,
                                       r0=r0, z0=r0 / math.sqrt(2))]))


def pseudo_vs_exact(qs=(0.05, 0.1, 0.2, 0.3, 0.4, 0.45, 0.5)) -> list[dict]:
    """A ring Paul trap at each radial q (|q_z| = 2 q): the secular
    frequencies of the pseudopotential and of the exact Mathieu solution,
    the model solve() picked, and its warnings."""
    rows = []
    for q in qs:
        r = solve(_paul_setup(q))
        sec = r["paul"]["secular"]
        rows.append(dict(q_radial=q, q_z=abs(r["paul"]["q"]["z"]), model=r["models"][0]["model"],
                         pseudo=sec["pseudopotential"], exact=sec["exact"], stable=r["stable"]))
    return rows


# --- the table ------------------------------------------------------------------------------

def _fmt(v: Any, digits: int = 3) -> str:
    if v is None:
        return "—"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, (int, float)):
        return f"{v:.{digits}g}"
    return str(v)


def readme() -> str:
    refs = load_references()
    lines = [
        "# Validation",
        "",
        "Generated by `python3 -m levtrap.validation` (`src/levtrap/validation.py`); do not edit.",
        "`tests/test_literature.py` runs the same comparisons, and checks this file lists every reference.",
        "",
        "## 1. Published experiments",
        "",
        "The references are `references.json` (C3, issue #15; how they were chosen and read: `references.md`).",
        "Only *verified* entries, whose numbers were read from the paper with their page, figure or table,",
        "are compared. A disagreement is not fixed by loosening a tolerance: it gets an issue, and its test",
        "is marked `xfail` with the issue number.",
        "",
    ]
    if refs["verified"]:
        lines += ["| Reference | Quantity | Paper | levtrap | Ratio | Tolerance | Agrees | Model |", "|---|---|---|---|---|---|---|---|"]
        for e in refs["verified"]:
            known = e.get("known_disagreement")
            name = f"{e['id']} (#{known['issue']})" if known else e["id"]
            for c in compare_reference(e):
                lines.append(f"| {name} | {c['quantity']} | {_fmt(c['reference'])} {c['unit']} | {_fmt(c['computed'])} {c['unit']} "
                             f"| {_fmt(c['ratio'])} | ±{_fmt(100 * c['tolerance_rel'], 2)} % | {_fmt(c['ok'])} | {c['model']} |")
        lines.append("")
    else:
        lines += ["No entry is verified yet, so nothing is compared.", ""]
    if refs["wanted"]:
        lines += ["Not tested yet, and why:", "", "| Reference | Slot | Why not yet |", "|---|---|---|"]
        for e in refs["wanted"]:
            lines.append(f"| {e['id']} | {e['slot']} | {untested_reason(e)} |")
        lines.append("")
    lines += [
        "## 2. Mie theory against the dipole approximation",
        "",
        "The default tweezer (1064 nm, 200 mW, NA 0.8, silica, in vacuum) at growing radius: the stiffness along",
        "each eigen-axis at the Mie equilibrium in the dipole approximation, over the Mie stiffness (the same",
        "central difference on the same cut). Small spheres agree to a fraction of a percent; the two part by",
        "a few percent at k a ≈ 0.6 and by tens of percent at k a ≈ 1.2, where the dipole approximation also",
        "misplaces the axial equilibrium. At 400 nm Mie theory finds no stable trap at NA 0.8.",
        "",
        "| Radius | k a | x | y | z |",
        "|---|---|---|---|---|",
    ]
    for row in mie_vs_dipole():
        if not row["stable"]:
            lines.append(f"| {_fmt(row['radius'] * 1e9)} nm | {_fmt(row['size_parameter'])} | no stable trap (Mie) | | |")
            continue
        q = row["dipole_over_mie"]
        lines.append(f"| {_fmt(row['radius'] * 1e9)} nm | {_fmt(row['size_parameter'])} | {_fmt(q.get('x'))} | {_fmt(q.get('y'))} | {_fmt(q.get('z'))} |")
    lines += [
        "",
        "## 3. Pseudopotential against the exact Mathieu solution",
        "",
        "A ring Paul trap (z0 = r0/√2, so |q_z| = 2 q_r) at growing q: the secular frequency along z",
        "from the pseudopotential, (Ω/2)·|q|/√2, and from the Mathieu characteristic exponent, β Ω/2.",
        "They part as q²; above |q| = 0.4 solve() uses the exact one and warns; beyond 0.908 there is no",
        "stable solution.",
        "",
        "| q_r | q_z | Pseudopotential f_z | Exact f_z | Exact / pseudo | Model used |",
        "|---|---|---|---|---|---|",
    ]
    for row in pseudo_vs_exact():
        p, x = row["pseudo"].get("z"), row["exact"].get("z")
        ratio = None if (p is None or x is None) else x / p
        hz = lambda v: "—" if v is None else f"{_fmt(v)} Hz"
        lines.append(f"| {_fmt(row['q_radial'])} | {_fmt(row['q_z'])} | {hz(p)} | {hz(x)} | {_fmt(ratio, 4)} | {row['model']} |")
    lines.append("")
    return "\n".join(lines)


def untested_reason(entry: dict) -> str:
    """Why a wanted entry has no test yet (C4's acceptance: a test or a
    documented reason): its ``why_not_verified``, which every wanted entry
    must carry (a KeyError otherwise)."""
    why = entry["why_not_verified"]
    if not why.strip():
        raise ValueError(f"{entry['id']}: why_not_verified is empty")
    return "read: " + why


def write_readme(path: pathlib.Path = README) -> None:
    pathlib.Path(path).write_text(readme())


if __name__ == "__main__":
    write_readme()
    print(f"wrote {README.relative_to(ROOT)}")
