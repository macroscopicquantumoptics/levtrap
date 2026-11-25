"""C4 (issue #16): levtrap against published experiments, and its models
against each other.

* Every *verified* entry of docs/validation/references.json is solved and
  compared at its stated tolerance. An entry that disagrees is not fixed by
  loosening the tolerance: it gets an issue, and ``known_disagreement:
  {"issue": N}`` in the entry marks its test xfail with that number.
* Every *wanted* entry has a documented reason it is not tested yet.
* docs/validation/README.md is the generated table (``python3 -m
  levtrap.validation``); it must list every reference.
"""

import re

import pytest

from levtrap import validation as V

REFS = V.load_references()


@pytest.mark.parametrize("entry", REFS["verified"], ids=lambda e: e["id"])
def test_verified_reference_agrees(entry, request):
    known = entry.get("known_disagreement")
    if known:
        # still compared: once the disagreement is resolved the test XPASSes, which fails a
        # strict xfail, so the entry's known_disagreement cannot outlive it
        request.applymarker(pytest.mark.xfail(reason=f"known disagreement, issue #{known['issue']}", strict=True))
    rows = V.compare_reference(entry)
    assert rows, "a verified entry must expect something"
    bad = [r for r in rows if not r["ok"]]
    assert not bad, "; ".join(f"{r['quantity']}: paper {r['reference']} {r['unit']}, levtrap {r['computed']} "
                              f"(tolerance ±{100 * r['tolerance_rel']:.3g} %)" for r in bad)


@pytest.mark.parametrize("entry", REFS["wanted"], ids=lambda e: e["id"])
def test_untested_reference_says_why(entry):
    assert V.untested_reason(entry).removeprefix("read: ").strip()


def test_an_untested_reference_without_a_reason_is_refused():
    with pytest.raises(KeyError):
        V.untested_reason({"id": "x"})
    with pytest.raises(ValueError):
        V.untested_reason({"id": "x", "why_not_verified": " "})


NUMBER = re.compile(r"[-+]?\d[\d.]*(e[-+]?\d+)?")


def test_the_table_is_current():
    """The README is what the script writes now: the same text, and the same numbers
    up to their last printed digit (which may differ between numpy builds)."""
    old, new = V.README.read_text(), V.readme()
    assert NUMBER.sub("#", old) == NUMBER.sub("#", new), "run: python3 -m levtrap.validation"
    for a, b in zip(NUMBER.finditer(old), NUMBER.finditer(new)):
        x, y = float(a.group().rstrip(".")), float(b.group().rstrip("."))
        assert x == pytest.approx(y, rel=0.01, abs=1e-12), f"{a.group()} is now {b.group()}: run python3 -m levtrap.validation"
    for e in REFS["verified"] + REFS["wanted"]:
        assert e["id"] in V.README.read_text()


def test_quantity_names():
    r = {"modes": [{"name": "x", "frequency": 2.0}, {"name": "z", "frequency": 1.0}], "depth": {"kT": 5.0},
         "rates": {"gas_damping": 3.0, "modes": [{"name": "x", "recoil_heating": 7.0, "reheating": 8.0}]},
         "paul": {"secular": {"exact": {"z": 9.0}}}}
    assert [V.quantity(r, q) for q in ("frequency.x", "frequency.max", "frequency.min", "depth.kT", "gas_damping",
                                       "recoil_heating.x", "reheating.x", "secular.exact.z", "frequency.y",
                                       "frequency.x/frequency.z", "frequency.x/frequency.y")] == [2, 2, 1, 5, 3, 7, 8, 9, None, 2, None]
    with pytest.raises(KeyError):
        V.quantity(r, "colour")



def test_each_quantity_names_its_own_model():
    """The table's Model column: a reheating rate is recoil plus gas, not the modes' model."""
    r = {"models": [{"quantity": "modes", "model": "mie"}, {"quantity": "gas_damping", "model": "knudsen"},
                    {"quantity": "recoil_heating", "model": "dipole-pattern"}]}
    assert [V.model_of(r, q) for q in ("frequency.y", "depth.kT", "gas_damping", "recoil_heating.y", "reheating.y",
                                       "secular.exact.z", "secular.pseudopotential.x", "frequency.y/frequency.z")] == \
        ["mie", "mie", "knudsen", "dipole-pattern", "dipole-pattern + knudsen", "mathieu", "pseudopotential", "mie"]

# --- cross-checks between models -----------------------------------------------------------

@pytest.fixture(scope="module")
def dipole_rows():
    return V.mie_vs_dipole(radii=(20e-9, 50e-9, 200e-9))


def test_small_spheres_agree_with_the_dipole_approximation(dipole_rows):
    for row in dipole_rows[:2]:
        assert row["stable"]
        for axis, ratio in row["dipole_over_mie"].items():
            assert ratio == pytest.approx(1, abs=0.02), (row["radius"], axis)
    # the agreement tightens as the sphere shrinks: the gap goes as (k a)^2
    small, mid = (max(abs(q - 1) for q in r["dipole_over_mie"].values()) for r in dipole_rows[:2])
    assert small < mid / 3


def test_large_spheres_part_from_the_dipole_approximation(dipole_rows):
    """The cross-check has teeth: at k a = 1.2 the dipole stiffness is off by tens of percent."""
    big = dipole_rows[2]
    assert big["size_parameter"] > 1
    assert max(abs(q - 1) for q in big["dipole_over_mie"].values()) > 0.2


def test_pseudopotential_against_exact_mathieu():
    rows = V.pseudo_vs_exact(qs=(0.05, 0.1, 0.2, 0.3, 0.5))
    for row in rows:
        p, x = row["pseudo"]["x"], row["exact"]["x"]
        # a = 0: the exact frequency is above the pseudopotential, by at most q^2 (relative)
        assert x > p and x / p - 1 <= row["q_radial"] ** 2
    small = [r for r in rows if r["q_z"] <= 0.4]
    assert all(r["model"] == "pseudopotential" for r in small)
    assert all(r["model"] == "mathieu" for r in rows if r["q_z"] > 0.4)
    # the gap grows as q^2: halving q quarters it
    gap = {r["q_radial"]: r["exact"]["z"] / r["pseudo"]["z"] - 1 for r in rows if r["exact"]["z"]}
    assert gap[0.1] / gap[0.05] == pytest.approx(4, rel=0.1)
    # |q_z| = 1.0, beyond 0.908: no stable solution along z
    last = rows[-1]
    assert last["q_z"] == pytest.approx(1.0) and last["exact"]["z"] is None and not last["stable"]
