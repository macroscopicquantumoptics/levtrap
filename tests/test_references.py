"""docs/validation/references.json: format, provenance and Setup validity.

Verified entries must carry a source and a stated/inferred flag for every
number and must load through ``levtrap.setup.parse`` (unless they declare a
schema gap).  Wanted entries must not carry numbers at all: a number with no
source is exactly what this file exists to prevent.
"""

import json
import pathlib

import pytest

from levtrap.setup import parse, unknown_keys

REFS = pathlib.Path(__file__).resolve().parents[1] / "docs" / "validation" / "references.json"
DATA = json.loads(REFS.read_text())
SLOTS = {"single_beam_tweezer", "counter_propagating_or_standing_wave", "linear_paul", "ring_paul",
         "hybrid_paul_optical", "parabolic_mirror"}


def _numbers(x, path=""):
    if isinstance(x, bool):
        return []
    if isinstance(x, (int, float)):
        return [path]
    if isinstance(x, dict):
        return [p for k, v in x.items() for p in _numbers(v, f"{path}.{k}")]
    if isinstance(x, list):
        return [p for i, v in enumerate(x) for p in _numbers(v, f"{path}[{i}]")]
    return []


def test_file_shape():
    assert DATA["format"] == "levtrap-references/1"
    assert isinstance(DATA["verified"], list) and isinstance(DATA["wanted"], list)
    ids = [e["id"] for e in DATA["verified"] + DATA["wanted"]]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("entry", DATA["wanted"], ids=lambda e: e["id"])
def test_wanted_entry(entry):
    assert entry["slot"] in SLOTS
    cit = entry["citation"]
    assert cit["title"] and (cit.get("doi") or cit.get("arxiv"))
    assert cit["metadata_source"]
    assert entry["needed"] and entry["expected_quantities"] and entry["agreement_note"]
    assert entry["schema_support"].startswith(("current", "future"))
    assert not _numbers(entry), "a wanted entry must not carry numbers; move it to 'verified' with sources"


@pytest.mark.parametrize("entry", DATA["verified"], ids=lambda e: e["id"])
def test_verified_entry(entry):
    assert entry["slot"] in SLOTS
    assert entry["citation"].get("doi") or entry["citation"].get("arxiv")
    for key, p in entry["provenance"].items():
        assert p["flag"] in ("stated", "inferred"), key
        assert p["source"], key
    for e in entry["expected"]:
        assert e["source"] and e["unit"] and e["why"]
        assert e["tolerance_rel"] > 0
    if not entry["schema_gaps"]:
        s = parse(entry["setup"])
        assert unknown_keys(entry["setup"]) == []
        assert s["version"] == 1


def test_every_slot_has_a_candidate():
    assert {e["slot"] for e in DATA["verified"] + DATA["wanted"]} == SLOTS


def test_current_schema_skeletons_use_known_field_kinds():
    """The field kinds named in each 'current' skeleton exist in today's loader."""
    from levtrap.setup import _FIELDS
    for e in DATA["wanted"]:
        if e["schema_support"] == "current":
            for f in e["skeleton"]["trap"]["fields"]:
                assert f["kind"] in _FIELDS, (e["id"], f["kind"])
