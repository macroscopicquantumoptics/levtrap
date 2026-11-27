import assert from "node:assert/strict";
import { test } from "node:test";
import { explainDepth, explainFrequency, multipoleShares, secondaryNumbers } from "./explain.ts";
import { PRESETS } from "./presets.ts";
import { RECORDED } from "./recorded.ts";
import { formatSci } from "../lib/format.ts";

const tweezer = PRESETS.find((p) => p.id === "tweezer")!;
const paul = PRESETS.find((p) => p.id === "paul-linear")!;

test("every number of every recorded preset has an explanation with real values", () => {
  for (const preset of PRESETS) {
    const result = RECORDED[preset.id];
    if (!result) continue;
    const all = [
      ...result.modes.map((_, i) => explainFrequency(result, preset.setup, i)),
      explainDepth(result, preset.setup),
      ...secondaryNumbers(result, preset.setup).map((s) => s.explain()),
    ];
    for (const e of all) {
      assert.ok(e.title && e.formula, `${preset.id}: ${e.title}`);
      assert.doesNotMatch(e.value, /—|NaN|undefined/, `${preset.id}: ${e.title} value`);
      assert.ok(e.copy.length > 0);
      assert.ok(e.inputs.length >= 1);
      for (const input of e.inputs) assert.doesNotMatch(input.value, /—|NaN|undefined|Infinity/, `${preset.id}: ${e.title}: ${input.symbol}`);
      if (e.title !== "Mass") assert.ok(e.model, `${preset.id}: ${e.title} names its model`);
    }
  }
});

test("an optical frequency is explained by stiffness and mass", () => {
  const e = explainFrequency(RECORDED.tweezer!, tweezer.setup, 0);
  assert.equal(e.title, "Trap frequency along x");
  assert.equal(e.value, "227 kHz");
  assert.equal(e.formula, "optical-frequency");
  assert.deepEqual(
    e.inputs.map((i) => [i.symbol, i.value]),
    [
      ["k_x", "18.8 µN/m"],
      ["m", "9.22 fg"],
    ],
  );
  assert.equal(e.model?.name, "Mie theory (T-matrix): exact for a homogeneous sphere of any size");
  assert.equal(e.model?.validity, "Valid here");
  // the formula holds for the numbers shown
  const r = RECORDED.tweezer!;
  const f = Math.sqrt(r.modes[0].stiffness! / r.particle.mass) / (2 * Math.PI);
  assert.ok(Math.abs(f - r.modes[0].frequency!) < 1e-6 * f);
});

test("a Paul-trap frequency is explained by a, q and the RF frequency", () => {
  const r = RECORDED["paul-linear"]!;
  const e = explainFrequency(r, paul.setup, 0);
  assert.equal(e.value, "556 Hz");
  assert.equal(e.formula, "paul-pseudopotential");
  assert.deepEqual(
    e.inputs.map((i) => i.symbol),
    ["a_x", "q_x", String.raw`f_\mathrm{RF}`],
  );
  assert.equal(e.inputs[2].value, "5 kHz");
  // the formula holds for the numbers shown
  const f = (5000 / 2) * Math.sqrt(r.paul!.a.x + r.paul!.q.x ** 2 / 2);
  assert.ok(Math.abs(f - r.modes[0].frequency!) < 1e-6 * f, `${f} vs ${r.modes[0].frequency}`);
});

test("the depth is explained in joules, kelvin and per axis", () => {
  const e = explainDepth(RECORDED.tweezer!, tweezer.setup);
  assert.equal(e.value, "386 k_BT");
  assert.deepEqual(
    e.inputs.map((i) => [i.symbol, i.value]),
    [
      ["U", "1.60 aJ"],
      [String.raw`U / k_\mathrm{B}`, "116 kK"],
      ["T", "300 K"],
      ["U_x", "574 k_BT"],
      ["U_y", "574 k_BT"],
      ["U_z", "386 k_BT"],
    ],
  );
});


test("the second row: every number of a tweezer and of a Paul trap, explained", () => {
  const ids = (id: "tweezer" | "paul-linear") => secondaryNumbers(RECORDED[id]!, PRESETS.find((p) => p.id === id)!.setup).map((s) => s.id);
  assert.deepEqual(ids("tweezer"), ["position", "stiffness", "mass", "scattered", "multipoles", "absorbed", "damping", "reheating", "recoil", "crossover"]);
  assert.deepEqual(ids("paul-linear"), ["position", "stiffness", "mass", "mathieu-q", "mathieu-a", "micromotion"]);
  const rows = secondaryNumbers(RECORDED.tweezer!, tweezer.setup);
  const row = (id: string) => rows.find((r) => r.id === id)!;
  assert.equal(row("absorbed").value, "14.2 aW");
  assert.equal(row("scattered").explain().formula, "scattered-power");
  assert.equal(row("damping").explain().formula, "gas-damping");
  // the mass formula holds for the numbers shown
  const m = (4 / 3) * Math.PI * tweezer.setup.particle.radius ** 3 * 2200;
  assert.ok(Math.abs(m - RECORDED.tweezer!.particle.mass) < 1e-6 * m);
  // the micromotion formula holds: A = |q x0| / 2 along y
  const r = RECORDED["paul-linear"]!;
  const A = Math.abs(r.paul!.q.y * r.equilibrium![1]) / 2;
  assert.ok(Math.abs(A - r.paul!.micromotion![1]) < 1e-6 * A);
});

test("the stiffness shows the curl per block, and a trap with a curl explains its motion (#101)", () => {
  const ws2 = PRESETS.find((p) => p.id === "ws2-bottle")!;
  const result = RECORDED["ws2-bottle"]!;
  const rows = secondaryNumbers(result, ws2.setup);
  const stiffness = rows.find((r) => r.id === "stiffness")!.explain();
  const curl = Object.fromEntries(stiffness.inputs.filter((i) => i.symbol.startsWith("a_")).map((i) => [i.symbol, i]));
  assert.deepEqual(Object.keys(curl), ["a_{xy}", "a_{xz}", "a_{yz}"]);
  assert.equal(curl["a_{xy}"].value, "−3.11 µN/m");
  assert.match(curl["a_{xy}"].note, /the curl about z/);
  assert.equal(curl["a_{xz}"].value, "0");
  const motion = rows.find((r) => r.id === "dynamics")!;
  assert.equal(motion.value, "spirals out below 65.4 mbar");
  const e = motion.explain();
  assert.equal(e.formula, "dynamics");
  assert.match(e.inputs.find((i) => i.symbol === String.raw`\sigma_x`)!.note, /grows along x: a factor e every 103 µs/);
  assert.match(e.inputs.find((i) => i.symbol === String.raw`\sigma_z`)!.note, /damped along z/);
  // a tweezer has no curl: no row, and zeros in the stiffness
  const plain = secondaryNumbers(RECORDED.tweezer!, tweezer.setup);
  assert.equal(plain.find((r) => r.id === "dynamics"), undefined);
  assert.ok(plain.find((r) => r.id === "stiffness")!.explain().inputs.filter((i) => i.symbol.startsWith("a_")).every((i) => i.value === "0"));
});

test("photon recoil per oscillation: Γ/Ω per mode, split into scattered photons, beam photons and their cross term (#78, #95)", () => {
  const result = RECORDED.tweezer!;
  const recoil = secondaryNumbers(result, tweezer.setup).find((s) => s.id === "recoil")!;
  const e = recoil.explain();
  assert.equal(e.formula, "recoil");
  assert.match(e.model!.name, /position information/);
  const z = result.rates!.modes.find((m) => m.name === "z")!;
  const Om = 2 * Math.PI * result.modes.find((m) => m.name === "z")!.frequency!;
  // the shown Γ/Ω along z is the engine's recoil over Ω, and its parts add up to it (recorded to 7 figures)
  assert.ok(Math.abs(z.recoil_scattered! + z.recoil_incident! + z.recoil_cross! - z.recoil_heating!) < 1e-6 * z.recoil_heating!);
  assert.equal(recoil.value.split(" · ")[2], formatSci(z.recoil_heating! / Om, 3));
  const symbols = e.inputs.map((i) => i.symbol);
  for (const part of ["sca", "beam"]) assert.ok(symbols.includes(String.raw`\Gamma_{\mathrm{${part}},z}/\Omega_{z}`), part);
  // along the beam the beam photons weigh less than a plane wave's 1 against the scattered photons'
  // 2/5 (the Gouy phase of the NA 0.8 focus): about 1.6 times, not 2.5 (#95)
  const ratio = z.recoil_incident! / z.recoil_scattered!;
  assert.ok(ratio > 1.3 && ratio < 2, `${ratio}`);
  // a slightly forward pattern: the cross term is shown along z, and lowers the heating; across the
  // beam the focus adds a small one (its longitudinal field grows along x, #95)
  assert.ok(symbols.includes(String.raw`\Gamma_{\times,z}/\Omega_{z}`));
  assert.ok(z.recoil_cross! < 0);
  const x = result.rates!.modes.find((m) => m.name === "x")!;
  assert.ok(Math.abs(x.recoil_cross!) < 0.1 * Math.abs(z.recoil_cross!));
  // the cross term is the interference of the two kicks, not forward or backward scattering: the
  // focus gives one across the beam too, where <n_x> is 0 (#95)
  const note = (axis: string) => e.inputs.find((i) => i.symbol === String.raw`\Gamma_{\times,${axis}}/\Omega_{${axis}}`)?.note;
  assert.equal(note("x"), "interference of the scattered and beam photons' kicks, along x");
  assert.equal(note("z"), "interference of the scattered and beam photons' kicks, along z");
  assert.ok(!e.inputs.some((i) => /forward|backward/.test(i.note)));
});

test("the photon picture (a Result without the information) keeps the forward-scattering note (#78)", () => {
  const result = structuredClone(RECORDED.tweezer!);
  result.models = result.models.map((m) => (m.quantity === "recoil_heating" ? { ...m, model: "mie-pattern" } : m));
  const e = secondaryNumbers(result, tweezer.setup).find((s) => s.id === "recoil")!.explain();
  const z = e.inputs.find((i) => i.symbol === String.raw`\Gamma_{\times,z}/\Omega_{z}`)!;
  assert.equal(z.note, "forward scattering gives back part of the beam photon's kick, along z");
});

test("the scattered light by multipole: a small sphere is a dipole, the WS2 dark trap a magnetic quadrupole (#80)", () => {
  const ws2 = PRESETS.find((p) => p.id === "ws2-bottle")!;
  const small = secondaryNumbers(RECORDED.tweezer!, tweezer.setup).find((r) => r.id === "multipoles")!;
  assert.equal(small.label, "Scattered by multipole");
  assert.match(small.value, /^ED 99.8 %/);
  const row = secondaryNumbers(RECORDED["ws2-bottle"]!, ws2.setup).find((r) => r.id === "multipoles")!;
  assert.equal(row.value, "MQ 61.5 % · MD 20.6 % · EQ 15.2 %");
  const e = row.explain();
  assert.equal(e.formula, "multipole-power");
  assert.equal(e.inputs[0].symbol, String.raw`P_\mathrm{MQ}`);
  assert.match(e.inputs[0].note, /^magnetic quadrupole; 32.7 % for a plane wave/);
  // the shares are of the scattered power: they add up to P_sca
  const shares = multipoleShares(RECORDED["ws2-bottle"]!);
  const o = RECORDED["ws2-bottle"]!.optical!;
  const total = shares.reduce((sum, s) => sum + s.power, 0);
  assert.ok(Math.abs(total - o.P_sca) < 1e-5 * o.P_sca);
  assert.ok(Math.abs(shares.reduce((sum, s) => sum + s.share, 0) - 1) < 1e-12);
});

test("no multipole row without the split (a Result from before #80)", () => {
  const r = structuredClone(RECORDED.tweezer!);
  delete r.optical!.P_sca_multipoles;
  assert.equal(multipoleShares(r).length, 0);
  assert.ok(!secondaryNumbers(r, tweezer.setup).some((row) => row.id === "multipoles"));
});

test("a real lens adds what it does to the focus: moved, clipped, the trap axis tilted", async () => {
  const { ASPHERE_RESULT, ASPHERE_SETUP } = await import("./asphere.fixture.ts");
  const rows = secondaryNumbers(ASPHERE_RESULT, ASPHERE_SETUP);
  const row = (id: string) => rows.find((r) => r.id === id)!;
  const lens = ASPHERE_RESULT.lenses![0];
  // a tilt about y moves the focus along x (which way depends on how full the aperture is)
  assert.ok(Math.abs(lens.focus_shift[0]) > 1e-7 && Math.abs(lens.focus_shift[1]) < 1e-12, "along x");
  assert.equal(row("lens0-focus").label, "Focus moved by the lens");
  assert.equal(row("lens0-focus").explain().formula, "lens-focus-shift");
  assert.match(row("lens0-clipping").value, / %$/);
  assert.equal(row("lens0-axis").explain().formula, "trap-axis-tilt");
  assert.match(row("lens0-axis").value, /mrad$/);
});

test("a parabolic mirror adds how much light it reflects and from how far round", async () => {
  const { MIRROR_RESULT, MIRROR_SETUP } = await import("./mirror.fixture.ts");
  const rows = secondaryNumbers(MIRROR_RESULT, MIRROR_SETUP);
  const row = (id: string) => rows.find((r) => r.id === id)!;
  const mirror = MIRROR_RESULT.mirrors![0];
  assert.ok(mirror.deep && mirror.rim_angle_deg > 90);
  assert.equal(row("mirror0-reflected").label, "Reflected by the mirror");
  assert.equal(row("mirror0-reflected").value, "97.9 %");
  assert.equal(row("mirror0-reflected").explain().formula, "mirror-reflected");
  assert.equal(row("mirror0-rim").value, "112.6°");
  assert.match(row("mirror0-rim").explain().title, /deep mirror/);
});
