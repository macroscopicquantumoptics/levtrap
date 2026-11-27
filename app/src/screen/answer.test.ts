import assert from "node:assert/strict";
import { test } from "node:test";
import { EngineError } from "../engine/client.ts";
import { DEFAULT_SETUP } from "../engine/setup.ts";
import type { BeamField, Result } from "../engine/types.ts";
import { answerFromError, instantAnswer, pending, shownFrequency, verdict } from "./answer.ts";
import { addField, newBeam, newPaulTrap, withField, withParticle } from "./model.ts";
import { PRESETS } from "./presets.ts";

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.setup;

test("a computed preset answers at once with its recorded result", () => {
  for (const id of ["tweezer", "paul-linear", "paul-ring"]) {
    const a = instantAnswer(preset(id));
    assert.equal(a?.origin, "preset", id);
    assert.equal(a?.result?.stable, true, `${id} is a working trap`);
    assert.equal(a?.result?.modes.length, 3);
    assert.deepEqual(a?.result?.warnings, [], `${id} starts without warnings`);
    assert.ok(a?.result?.curves, `${id} has its force curves`);
    assert.equal(a?.notice, null);
  }
  assert.equal(instantAnswer(DEFAULT_SETUP, false), null, "recorded results can be switched off");
});

test("an edited setup asks the engine", () => {
  assert.equal(instantAnswer(withField<BeamField>(DEFAULT_SETUP, 0, { power: 0.1 })), null);
});

test("every preset is computed by the engine and answers at once", () => {
  for (const p of PRESETS) {
    assert.equal(p.pending, undefined, p.id);
    assert.equal(instantAnswer(p.setup)?.origin, "preset", p.id);
  }
  // two opposing beams (B1): the scattering forces cancel and the particle sits at the focus
  const counter = instantAnswer(preset("counter"))!.result!;
  assert.equal(counter.stable, true);
  assert.ok(Math.hypot(...counter.equilibrium!) < 1e-12);
});

test("the engine's refusals become sentences", () => {
  const paul = addField(DEFAULT_SETUP, newPaulTrap("linear"));
  const invalid = answerFromError(
    new EngineError("setup", "a Paul trap needs a charged particle; set the charge (in elementary charges)", "particle.charge"),
    paul,
  );
  assert.deepEqual(invalid.notice, {
    kind: "invalid",
    text: "Particle: a Paul trap needs a charged particle; set the charge (in elementary charges).",
    part: "particle",
  });
  const range = answerFromError(new EngineError("setup", "must be smaller than the medium index (1)", "trap.fields[0].focus.NA"), DEFAULT_SETUP);
  assert.deepEqual(range.notice, { kind: "invalid", text: "Lens: NA must be smaller than the medium index (1).", part: "lens:0" });
  const two = addField(withParticle(paul, { charge: 50 }), newPaulTrap("ring"));
  const refused = answerFromError(new EngineError("unsupported", "more than one Paul trap is not computed yet"), two);
  assert.deepEqual(refused.notice, { kind: "pending", text: "Not computed yet: more than one Paul trap." });
  const crash = answerFromError(new Error("boom"), DEFAULT_SETUP);
  assert.deepEqual(crash.notice, { kind: "failed", text: "The engine failed: boom." });
});

test("what the engine cannot compute yet, with its ticket", () => {
  const two = addField(addField(withParticle(DEFAULT_SETUP, { charge: 30 }), newPaulTrap("linear")), newPaulTrap("ring"));
  assert.deepEqual(pending(two), { kind: "pending", text: "Not computed yet: more than one Paul trap." });
  const none = { ...DEFAULT_SETUP, trap: { fields: [] } };
  assert.deepEqual(pending(none), { kind: "pending", text: "Nothing holds the particle: add a beam or a Paul trap." });
  assert.deepEqual(pending(DEFAULT_SETUP, "trap.fields[0].mode: this mode is not computed yet"), {
    kind: "pending",
    text: "Not computed yet: this mode is not computed yet.",
  });
  // beams in any direction are computed now (B1): only an engine message would make one pending
  const co = addField(DEFAULT_SETUP, newBeam(DEFAULT_SETUP, "co"));
  assert.equal(pending(co, "x: something new").text, "Not computed yet: something new.");
});

test("the verdict is a sentence", () => {
  assert.deepEqual(verdict(instantAnswer(DEFAULT_SETUP)!, DEFAULT_SETUP), {
    tone: "ok",
    text: "Stable trap. The particle rests 216 nm downstream of the focus.",
    more: [],
  });
  assert.deepEqual(verdict(instantAnswer(preset("paul-linear"))!, preset("paul-linear")), {
    tone: "ok",
    text: "Stable trap. Mathieu q = 0.32 on x and y. The particle rests 804 nm below the trap centre.",
    more: [],
  });
  assert.deepEqual(verdict(instantAnswer(preset("paul-ring"))!, preset("paul-ring")), {
    tone: "ok",
    text: "Stable trap. Mathieu q = 0.25 on z. The particle rests 1.98 µm below the trap centre.",
    more: [],
  });
  assert.deepEqual(verdict(instantAnswer(preset("counter"))!, preset("counter")), {
    tone: "ok",
    text: "Stable trap. The particle rests at the focus.",
    more: [],
  });
});

test("a trap whose curl outgrows the gas damping is not called stable (#101)", () => {
  const ws2 = preset("ws2-bottle");
  const a = instantAnswer(ws2)!;
  assert.equal(a.result!.stable, true, "the force alone holds it");
  assert.equal(a.result!.dynamics!.unstable, true);
  const v = verdict(a, ws2);
  assert.equal(v.tone, "bad");
  assert.match(v.text, /^Stable without the curl, but at this pressure the particle spirals out: its motion along x and y grows by a factor e every 103 µs\.$/);
  assert.match(v.hint!, /^The gas damps it enough above 65\.4 mbar\. Usually the spin of circularly polarised light/);
  // where it rests, and the 3 % note on the depth and frequencies, still follow; the engine's spiral warning does not repeat
  assert.equal(v.more[0], "The particle rests 237 nm downstream of the focus.");
  assert.ok(v.more.some((s) => s.startsWith("The force is not conservative here")));
  assert.ok(!v.more.some((s) => s.includes("spirals out")));
  // with linear polarisation there is no curl: a stable trap
  const linear = { ...a.result!, warnings: [], dynamics: { ...a.result!.dynamics!, unstable: false, damping_needed: 0, pressure_threshold: null } };
  assert.match(verdict({ ...a, result: linear }, ws2).text, /^Stable trap\./);
});

test("an unstable trap says along which axis, the usual cause, and the other warnings with their advice", () => {
  const recorded = instantAnswer(DEFAULT_SETUP)!.result!;
  const unstable: Result = {
    ...recorded,
    stable: false,
    equilibrium: null,
    modes: [],
    warnings: ["The equilibrium search did not converge inside the scanned region.", "No stable trap: the force along the beam axis (z) never restores the particle."],
  };
  assert.deepEqual(verdict({ result: unstable, origin: "engine", notice: null }, DEFAULT_SETUP), {
    tone: "bad",
    text: "No stable trap along z: the force along the beam never pulls the particle back.",
    hint: "Usually the scattering force pushes the particle out faster than the gradient force pulls it in: focus tighter (a larger NA), or add a counter-propagating beam.",
    more: [
      "The equilibrium search did not converge inside the scanned region. The numbers may be missing or rough. A smaller step between setups, or a setup closer to a known trap, usually helps.",
    ],
  });
});

test("a Paul axis outside the stability region has no frequency", () => {
  const stable = instantAnswer(preset("paul-linear"))!.result!;
  assert.equal(shownFrequency(stable, stable.modes[0]), stable.modes[0].frequency);
  // what the engine returns at 2 kHz: pseudopotential values kept in modes, exact is null on x and y
  const unstable: Result = {
    ...stable,
    stable: false,
    paul: { ...stable.paul!, stable: false, secular: { ...stable.paul!.secular, exact: { x: null, y: null, z: 99.5 } } },
  };
  assert.equal(shownFrequency(unstable, unstable.modes[0]), null);
  assert.equal(shownFrequency(unstable, unstable.modes[2]), unstable.modes[2].frequency);
  const optical = instantAnswer(DEFAULT_SETUP)!.result!;
  assert.equal(shownFrequency(optical, optical.modes[0]), optical.modes[0].frequency);
});
