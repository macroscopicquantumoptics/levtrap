/* levtrap lens-tilt page (lens.html).  Shared helpers: common.js. */
"use strict";

const MATERIAL_NAMES = ["SiO2", "Si", "WS2", "MoS2", "WSe2", "MoTe2", "MoSe2"];
let MATERIALS = {};
let lastResult = null;
let busy = false;
let queued = false;

const HELP = {
  tilt_x: "Rotation of the lens about the horizontal x axis, in degrees. Hand placement typically leaves a few tenths of a degree.",
  tilt_y: "Rotation of the lens about the y axis, in degrees.",
  pivot: "Point on the lens axis about which it is tilted. It changes how far the focus moves sideways (a tilt about the lens's rear nodal point barely moves it).",
  dec_x: "Sideways shift of the lens relative to the beam (mm). A decentred lens also deflects and aberrates the focus.",
  wavelength: "Laser wavelength. The lens was designed for 830 nm; other wavelengths focus slightly further away and with some spherical aberration.",
  power: "Laser power arriving at the lens. Light outside the clear aperture is lost (see the transmitted fraction).",
  diameter: "Diameter of the collimated input beam where the intensity falls to 13.5% (1/e²). Bigger beam: tighter focus but more tilt sensitivity; above ~4 mm the lens edge starts to clip it.",
  pol: "Polarisation of the input beam.",
  material: "Fills in the refractive index and density at the current wavelength, where tabulated.",
  radius: "Particle radius.",
  n: "Refractive index of the particle.",
  k: "Absorption part of the refractive index.",
  density: "Mass density (sets the mass and hence the trap frequencies).",
  temperature: "Temperature used to express the trap depth in units of k_BT.",
};
const TILE_HELP = {
  focus: "How far the best focus moved compared with a perfectly aligned lens: x, y across the beam and z along it (positive = away from the lens).",
  particle: "How far the particle's equilibrium moved compared with the aligned lens. It can differ from the focus shift because aberrations change the balance of gradient and scattering forces.",
  freqs: "Trap frequencies of the three oscillation modes (the axes of the 3×3 stiffness matrix), compared with the aligned lens.",
  axis: "Angle between the axial oscillation mode and the optical axis z. A tilted lens tilts the trap.",
  rms: "Root-mean-square wavefront error about the best focus, in wavelengths. Below 0.07 waves the focus is essentially perfect (Maréchal criterion).",
  trans: "Fraction of the beam power that passes both lens apertures. Less than 1 means the beam overfills the lens.",
  depth: "Smallest escape barrier along the three trap axes, in units of k_BT.",
  pointing: "Direction of the transmitted beam relative to z (mrad): a tilted or decentred lens steers the beam.",
  bfl: "Distance from the lens's back surface to the focus of the aligned lens at this wavelength (design: 1.760 mm at 830 nm).",
  psca: "Laser power scattered by the particle at its equilibrium (this is what you detect, and what causes recoil heating).",
};

function readRequest() {
  return {
    wavelength: parseFloat($("wavelength").value) * 1e-9,
    power: parseFloat($("power").value) * 1e-3,
    temperature: parseFloat($("temperature").value) || 300,
    particle: { radius: parseFloat($("radius").value) * 1e-9, n: parseFloat($("n").value),
                k: parseFloat($("k").value) || 0, density: parseFloat($("density").value) },
    lens: { diameter_mm: parseFloat($("diameter").value), tilt_x_deg: parseFloat($("tilt_x").value) || 0,
            tilt_y_deg: parseFloat($("tilt_y").value) || 0, pivot: $("pivot").value,
            decenter_x_mm: parseFloat($("dec_x").value) || 0, polarisation: $("pol").value },
  };
}

async function refreshMaterial() {
  const wl = parseFloat($("wavelength").value) * 1e-9;
  const key = wl.toPrecision(8);
  if (!MATERIALS[key]) {
    try { MATERIALS[key] = await backend.call("materials", String(wl)); } catch (e) { return; }
  }
  const m = MATERIALS[key][$("material").value];
  if (m && m.valid) { $("n").value = +m.n.toPrecision(6); $("k").value = m.k; $("density").value = m.density; }
  else if (m) $("density").value = m.density;
}

function updateFillNote() {
  const D = parseFloat($("diameter").value);
  const na = Math.sin(Math.atan(D / 2 / 3.1));
  $("fill-note").textContent = `Beam radius / lens aperture radius = ${(D / 5.0).toFixed(2)} (S1 Ø5.0 mm); 1/e² focusing NA ≈ ${na.toFixed(2)} (lens NA 0.68).`;
}

// ---------------------------------------------------------------- compute
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(run, 600); }

async function run() {
  if (busy) { queued = true; return; }
  busy = true; queued = false;
  $("spinner").hidden = false;
  $("error").hidden = true;
  const t0 = performance.now();
  try {
    const out = await backend.call("lens_trap", JSON.stringify(readRequest()));
    if (!out.ok) throw new Error(out.error);
    lastResult = out.result;
    render(lastResult);
    $("timing").textContent = `computed in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  } catch (err) {
    $("error").hidden = false;
    $("error").textContent = String(err.message || err);
  } finally {
    busy = false;
    $("spinner").hidden = true;
    if (queued) run();
  }
}

const vec = (v, d = 2) => (v ? v.map((x) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d)).join(", ") : "—");
const kHz = (f) => (f === null || f === undefined ? "—" : fmt(f / 1e3, 3));

function tile(label, value, sub, help, hint) {
  return `<div class="tile"><div class="label">${label}${help ? helpHTML(TILE_HELP[help]) : ""}</div><div class="value">${value}</div>${sub ? `<div class="sub2">${sub}</div>` : ""}${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
}

function render(r) {
  const b = $("trap-banner");
  b.hidden = false;
  if (r.stable) { b.className = "banner good"; b.textContent = "✓ Stable 3D trap"; }
  else { b.className = "banner bad"; b.textContent = r.freqs ? "✕ No stable trap — an equilibrium exists but at least one direction is not restoring" : "✕ No stable trap — no restoring zero crossing along the beam"; }
  const fs = r.focus_shift_um;
  const strehl = Math.exp(-((2 * Math.PI * r.rms_waves) ** 2));
  const t = [];
  t.push(tile("Focus shift (x, y, z)", `${vec(fs)} µm`, `|Δ| = ${fmt(Math.hypot(...fs), 3)} µm`, "focus"));
  t.push(tile("Particle shift (x, y, z)", r.particle_shift_um ? `${vec(r.particle_shift_um)} µm` : "—",
    r.eq_um ? `particle at ${vec(r.eq_um)} µm from the aligned focus` : "", "particle"));
  const f = r.freqs || [], f0 = r.freqs_untilted || [];
  t.push(tile("Trap frequencies (axial; 2 radial)", `${kHz(f[0])}; ${kHz(f[1])}, ${kHz(f[2])} kHz`,
    `aligned lens: ${kHz(f0[0])}; ${kHz(f0[1])}, ${kHz(f0[2])} kHz`, "freqs",
    f[0] && f0[0] ? `axial ${fmt(100 * f[0] / f0[0], 3)}% of aligned` : ""));
  t.push(tile("Trap axis tilt", r.axial_angle_mrad === null || r.axial_angle_mrad === undefined ? "—" : `${fmt(r.axial_angle_mrad, 3)} mrad`,
    r.axial_angle_mrad ? `${fmt(r.axial_angle_mrad * 0.0572958, 3)}°` : "", "axis"));
  t.push(tile("Wavefront error", `${fmt(r.rms_waves, 3)} waves rms`, `Strehl ≈ ${fmt(strehl, 2)} (aligned: ${fmt(r.rms_waves_untilted, 2)} waves)`,
    "rms", r.rms_waves < 0.0714 ? "diffraction limited" : "noticeably aberrated"));
  t.push(tile("Transmitted", `${fmt(100 * r.transmitted, 3)} %`, r.transmitted < 0.995 ? "beam clipped by the lens aperture" : "no clipping", "trans"));
  t.push(tile("Trap depth", r.depth_kT !== null && r.depth_kT !== undefined ? `${fmtE(r.depth_kT)} k<sub>B</sub>T` : "—", "", "depth",
    r.depth_kT ? (r.depth_kT > 10 ? "deep enough to hold the particle" : "too shallow to hold it") : ""));
  t.push(tile("Beam pointing", `${vec(r.pointing_mrad)} mrad`, "x, y tilt of the transmitted beam", "pointing"));
  t.push(tile("Back focal distance", `${fmt(r.bfl_mm * 1e3, 5)} µm`, `${r.bfl_mm > 1.760004 ? "+" : ""}${fmt((r.bfl_mm - 1.760004) * 1e3, 3)} µm vs 830 nm design`, "bfl"));
  t.push(tile("Scattered power", r.P_sca ? `${fmtE(r.P_sca * 1e3)} mW` : "—", r.recoil_ratio_axial ? `Γ/Ω (axial) = ${fmtE(r.recoil_ratio_axial)}` : "", "psca"));
  $("tiles").innerHTML = t.join("");
  renderFocus(r);
  renderWavefront(r);
}

function ramp() {
  return isDark()
    ? [[0, "#1a1a19"], [0.25, "#104281"], [0.5, "#256abf"], [0.75, "#5598e7"], [1, "#b7d3f6"]]
    : [[0, "#fcfcfb"], [0.2, "#cde2fb"], [0.45, "#86b6ef"], [0.7, "#2a78d6"], [1, "#104281"]];
}

function renderFocus(r) {
  const M = r.maps;
  const H = $("axis-orient").value !== "vertical";
  const um = (a) => a.map((v) => v * 1e6);
  const fx = M.focus_um;  // P* relative to the aligned focus (um); map coordinates are about P*
  const xs = um(M.x).map((v) => v + fx[0]);
  const zs = um(M.z).map((v) => v + fx[2]);
  const ys = um(M.x).map((v) => v + fx[1]);
  const Ixz = M.Ixz.map((row) => row.map((v) => v * 1e-9));  // [iz][ix] mW/um^2
  const Ixy = M.Ixy.map((row) => row.map((v) => v * 1e-9));  // [iy][ix]
  const heat1 = H
    ? { type: "heatmap", x: zs, y: xs, z: Ixz[0].map((_, j) => Ixz.map((row) => row[j])), xaxis: "x", yaxis: "y" }
    : { type: "heatmap", x: xs, y: zs, z: Ixz, xaxis: "x", yaxis: "y" };
  const heat2 = { type: "heatmap", x: xs, y: ys, z: Ixy, xaxis: "x2", yaxis: "y2", showscale: false };
  for (const h of [heat1, heat2]) Object.assign(h, { colorscale: ramp(), zsmooth: "best", hovertemplate: "%{x:.2f}, %{y:.2f} µm<br>I = %{z:.3g} mW/µm²<extra></extra>" });
  heat1.colorbar = { title: { text: "I (mW/µm²)", side: "right" }, thickness: 12, outlinewidth: 0 };
  const shapes = [];
  const marks = [];
  const P = (x, z) => (H ? [z, x] : [x, z]);
  const [fX, fY] = P(fx[0], fx[2]);
  marks.push({ type: "scatter", mode: "markers", x: [fX], y: [fY], xaxis: "x", yaxis: "y", marker: { symbol: "x-thin", size: 12, line: { width: 2, color: css("--series-2") } }, name: "best focus", hovertemplate: "best focus<extra></extra>" });
  marks.push({ type: "scatter", mode: "markers", x: [fx[0]], y: [fx[1]], xaxis: "x2", yaxis: "y2", marker: { symbol: "x-thin", size: 12, line: { width: 2, color: css("--series-2") } }, showlegend: false, hoverinfo: "skip" });
  const [oX, oY] = P(0, 0);
  marks.push({ type: "scatter", mode: "markers", x: [oX], y: [oY], xaxis: "x", yaxis: "y", marker: { symbol: "cross-thin", size: 10, line: { width: 1.5, color: css("--text-muted") } }, name: "aligned focus", hovertemplate: "aligned-lens focus<extra></extra>" });
  if (r.eq_um) {
    const rad = parseFloat($("radius").value) * 1e-3;
    const [cX, cY] = P(r.eq_um[0], r.eq_um[2]);
    const col = r.stable ? css("--good") : css("--bad");
    shapes.push({ type: "circle", xref: "x", yref: "y", x0: cX - rad, x1: cX + rad, y0: cY - rad, y1: cY + rad, line: { color: col, width: 2 } });
    shapes.push({ type: "circle", xref: "x2", yref: "y2", x0: r.eq_um[0] - rad, x1: r.eq_um[0] + rad, y0: r.eq_um[1] - rad, y1: r.eq_um[1] + rad, line: { color: col, width: 2 } });
  }
  const zl = H ? "z (µm) — beam →" : "z (µm) — beam ↑";
  const layout = baseLayout({
    showlegend: true, legend: { orientation: "h", y: -0.12, x: 0 },
    xaxis: axis(H ? zl : "x (µm)", { domain: [0, 1], anchor: "y" }), yaxis: axis(H ? "x (µm)" : zl, { domain: [0.44, 1], scaleanchor: "x" }),
    xaxis2: axis("x (µm)", { domain: [0.25, 0.75], anchor: "y2" }), yaxis2: axis(`y (µm) at z = ${fmt(r.eq_um ? r.eq_um[2] : fx[2], 3)} µm`, { domain: [0, 0.34], scaleanchor: "x2" }),
    shapes, margin: { l: 60, r: 16, t: 10, b: 60 },
  });
  Plotly.react("plot-focus", [heat1, heat2, ...marks], layout, PLOT_CONFIG);
}

function renderWavefront(r) {
  const W = r.wavefront;
  const D = parseFloat($("diameter").value);
  // colour range from the region inside the 1/e^2 radius
  const vals = [];
  W.W.forEach((row, i) => row.forEach((v, j) => {
    if (v !== null && isFinite(v) && Math.hypot(W.x[j], W.y[i]) <= D / 2) vals.push(Math.abs(v));
  }));
  const lim = Math.max(1e-3, ...vals);
  // diverging: blue (lead) - neutral grey - orange (lag)
  const div = [[0, "#2a78d6"], [0.5, isDark() ? "#3a3a38" : "#e7e6e2"], [1, "#eb6834"]];
  const heat = { type: "heatmap", x: W.x, y: W.y, z: W.W, colorscale: div, zmin: -lim, zmax: lim, zsmooth: "best",
    colorbar: { title: { text: "W (waves)", side: "right" }, thickness: 12, outlinewidth: 0 },
    hovertemplate: "x %{x:.2f} mm, y %{y:.2f} mm<br>W = %{z:.3f} waves<extra></extra>" };
  const shapes = [
    { type: "circle", x0: -D / 2, x1: D / 2, y0: -D / 2, y1: D / 2, line: { color: css("--text-muted"), width: 1, dash: "dot" } },
    { type: "circle", x0: -2.5, x1: 2.5, y0: -2.5, y1: 2.5, line: { color: css("--text-secondary"), width: 1 } },
  ];
  const layout = baseLayout({
    xaxis: axis("x at the lens (mm)"), yaxis: axis("y (mm)", { scaleanchor: "x" }), shapes,
    annotations: [{ text: `rms ${fmt(r.rms_waves, 3)} waves · dotted: beam 1/e² · solid: lens aperture`, xref: "paper", yref: "paper", x: 0, y: 1.06, showarrow: false, xanchor: "left", font: { size: 11 } }],
    margin: { l: 60, r: 16, t: 30, b: 44 },
  });
  Plotly.react("plot-wf", [heat], layout, PLOT_CONFIG);
}

// ---------------------------------------------------------------- sweep
let sweepCancel = false;
let sweep = null;

async function runSweep() {
  const variable = $("sw-var").value;
  const a = parseFloat($("sw-from").value), b = parseFloat($("sw-to").value);
  const n = Math.max(2, Math.min(60, parseInt($("sw-n").value, 10) || 11));
  const req = readRequest();
  sweepCancel = false;
  $("sw-run").disabled = true; $("sw-cancel").disabled = false; $("sw-progress-wrap").hidden = false;
  sweep = { variable, points: [] };
  const ph = document.querySelector("#plot-sweep .placeholder");
  if (ph) ph.remove();
  let start = null; // follow the same equilibrium from point to point
  for (let i = 0; i < n && !sweepCancel; i++) {
    const v = a + (b - a) * i / (n - 1);
    try {
      const out = await backend.call("lens_sweep", JSON.stringify(req), variable, JSON.stringify([v]), JSON.stringify(start));
      const pt = out.points[0];
      sweep.points.push(pt);
      if (pt.stable && pt.eq_um) start = pt.eq_um;
    } catch (err) { sweep.points.push({ value: v, stable: false, error: String(err) }); }
    $("sw-progress").style.width = `${100 * (i + 1) / n}%`;
    renderSweep();
  }
  $("sw-run").disabled = false; $("sw-cancel").disabled = true;
  setTimeout(() => { $("sw-progress-wrap").hidden = true; }, 600);
}

function renderSweep() {
  if (!sweep) return;
  const P = sweep.points;
  const xs = P.map((p) => p.value);
  const c = [css("--series-1"), css("--series-2"), css("--series-3")];
  const L = (name, ys, col, dash) => ({ x: xs, y: ys, name, mode: "lines+markers", line: { color: col, width: 2, dash: dash || "solid" }, marker: { size: 7, color: col }, hovertemplate: `%{x:.3g}: %{y:.4g}<extra>${name}</extra>` });
  const qty = $("sw-qty").value;
  let tr = [], yl = "";
  if (qty === "shift") {
    const g = (p, k, i) => (p[k] ? p[k][i] : null);
    tr = [L("focus Δx", P.map((p) => g(p, "focus_shift_um", 0)), c[0]), L("focus Δz", P.map((p) => g(p, "focus_shift_um", 2)), c[1]),
          L("particle Δx", P.map((p) => (p.stable ? g(p, "particle_shift_um", 0) : null)), c[0], "dash"),
          L("particle Δz", P.map((p) => (p.stable ? g(p, "particle_shift_um", 2) : null)), c[1], "dash")];
    if (sweep.variable === "tilt_x_deg") {
      tr[0] = L("focus Δy", P.map((p) => g(p, "focus_shift_um", 1)), c[0]);
      tr[2] = L("particle Δy", P.map((p) => (p.stable ? g(p, "particle_shift_um", 1) : null)), c[0], "dash");
    }
    yl = "displacement from the aligned lens (µm)";
  } else if (qty === "freq") {
    tr = [0, 1, 2].map((i) => L(i === 0 ? "axial" : `radial ${i}`, P.map((p) => (p.stable && p.freqs && p.freqs[i] ? p.freqs[i] / 1e3 : null)), c[i], i === 2 ? "dash" : "solid"));
    yl = "trap frequency (kHz)";
  } else if (qty === "rms") { tr = [L("rms wavefront error", P.map((p) => p.rms_waves), c[0])]; yl = "waves rms"; }
  else if (qty === "trans") { tr = [L("transmitted", P.map((p) => p.transmitted), c[0])]; yl = "transmitted fraction"; }
  const half = xs.length > 1 ? Math.abs(xs[1] - xs[0]) / 2 : 0.5;
  const shapes = P.filter((p) => !p.stable).map((p) => ({ type: "rect", xref: "x", yref: "paper", x0: p.value - half, x1: p.value + half, y0: 0, y1: 1, fillcolor: css("--unstable"), line: { width: 0 }, layer: "below" }));
  const annotations = P.filter((p) => p.jumped && p.stable).map((p) => ({ x: p.value, y: 1, xref: "x", yref: "paper", text: "jump", showarrow: true, arrowhead: 0, ay: -18, font: { size: 10, color: css("--warn") }, arrowcolor: css("--warn") }));
  if (qty === "rms") shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0.0714, y1: 0.0714, line: { color: css("--text-muted"), dash: "dot", width: 1 } });
  const xl = { tilt_y_deg: "tilt about y (°)", tilt_x_deg: "tilt about x (°)", diameter_mm: "beam diameter 1/e² (mm)", decenter_x_mm: "decentre x (mm)" }[sweep.variable];
  Plotly.react("plot-sweep", tr, baseLayout({ shapes, annotations, xaxis: axis(xl), yaxis: axis(yl), showlegend: tr.length > 1, legend: { orientation: "h", y: 1.14, x: 0 }, margin: { l: 70, r: 16, t: 34, b: 44 } }), PLOT_CONFIG);
}

function sweepDefaults() {
  const v = $("sw-var").value;
  const d = { tilt_y_deg: [0, 1.5, 11], tilt_x_deg: [0, 1.5, 11], diameter_mm: [1.5, 5, 11], decenter_x_mm: [0, 0.2, 9] }[v];
  $("sw-from").value = d[0]; $("sw-to").value = d[1]; $("sw-n").value = d[2];
}

// ---------------------------------------------------------------- init
function init() {
  initTheme(() => { if (lastResult) render(lastResult); renderSweep(); });
  showVersion();
  $("material").innerHTML = MATERIAL_NAMES.map((m) => `<option value="${m}">${m.replace(/(\d)/g, "<sub>$1</sub>")}</option>`).join("") + '<option value="custom">custom</option>';
  attachHelp(document.querySelector(".params"), HELP);
  try { const a = localStorage.getItem("levtrap-axis"); if (a) $("axis-orient").value = a; } catch (e) { /* ignore */ }
  updateFillNote();
  $("plot-sweep").innerHTML = '<div class="placeholder">Choose what to vary and press “Run sweep”. Each point re-traces the lens and recomputes the trap (a few seconds each).</div>';
  backend.on("progress", (m) => { $("loader-stage").textContent = m.stage; $("loader-bar").style.width = `${Math.round(m.fraction * 100)}%`; });
  backend.on("fatal", (m) => { $("loader-stage").textContent = `Failed to start: ${m.error}`; $("status").textContent = "engine failed"; });
  backend.on("ready", async (versions) => {
    $("loader").hidden = true;
    $("status").textContent = LOCAL ? "local backend" : `Python ${versions.python} · NumPy ${versions.numpy} · SciPy ${versions.scipy}`;
    await refreshMaterial();
    run();
  });
  if (LOCAL) $("loader").hidden = true;
  backend.start();
  document.querySelector(".params").addEventListener("input", (e) => {
    if (["n", "k"].includes(e.target.id)) $("material").value = "custom";
    if (e.target.id === "diameter") updateFillNote();
    if (e.target.id === "axis-orient") return;
    schedule();
  });
  document.querySelector(".params").addEventListener("change", async (e) => {
    if (e.target.id === "material" || e.target.id === "wavelength") { await refreshMaterial(); schedule(); }
    else if (e.target.id === "axis-orient") {
      try { localStorage.setItem("levtrap-axis", e.target.value); } catch (err) { /* ignore */ }
      if (lastResult) renderFocus(lastResult);
    } else if (e.target.tagName === "SELECT") schedule();
  });
  $("sw-var").addEventListener("change", sweepDefaults);
  $("sw-qty").addEventListener("change", renderSweep);
  $("sw-run").addEventListener("click", runSweep);
  $("sw-cancel").addEventListener("click", () => { sweepCancel = true; });
}

document.addEventListener("DOMContentLoaded", init);
