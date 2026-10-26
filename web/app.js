/* levtrap web UI.  Talks to the Python engine through a Web Worker
 * (Pyodide), or to a local dev server with ?backend=local
 * (scripts/devserver.py) for development without the CDN. */
"use strict";

// ---------------------------------------------------------------- backend
const params = new URLSearchParams(location.search);
const LOCAL = params.get("backend") === "local";

const backend = (() => {
  let worker = null;
  let nextId = 1;
  const pending = new Map();
  const listeners = { progress: () => {}, ready: () => {}, fatal: () => {} };

  function start() {
    if (LOCAL) {
      setTimeout(() => listeners.ready({ backend: "local dev server (native Python)" }), 0);
      return;
    }
    worker = new Worker("worker.js");
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type) { (listeners[m.type] || (() => {}))(m.type === "ready" ? m.versions : m); return; }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(JSON.parse(m.result)); else p.reject(new Error(m.error));
    };
    worker.onerror = (e) => listeners.fatal({ error: e.message || "Worker failed to start" });
  }

  async function call(method, ...args) {
    if (LOCAL) {
      const r = await fetch("/api", { method: "POST", body: JSON.stringify({ method, args }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      return JSON.parse(j.result);
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, args });
    });
  }
  return { start, call, on: (k, f) => { listeners[k] = f; } };
})();

// ---------------------------------------------------------------- helpers
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 3) => (v === null || v === undefined || !isFinite(v)) ? "—" : Number(v).toPrecision(d);
const fmtE = (v, d = 2) => (v === null || v === undefined || !isFinite(v)) ? "—" :
  (Math.abs(v) >= 1e-2 && Math.abs(v) < 1e4 ? Number(v).toPrecision(d + 1) : Number(v).toExponential(d));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const clone = (o) => JSON.parse(JSON.stringify(o));

let PRESETS = {};
let MATERIALS = {};
let MATERIAL_NAMES = ["SiO2", "Si", "WS2", "MoS2", "WSe2", "MoTe2", "MoSe2"];
let lastResult = null;
let lastReq = null;
let busy = false;
let queued = false;

// ---------------------------------------------------------------- beam fieldsets
function beamFieldset(el, key) {
  el.insertAdjacentHTML("beforeend", `
    <div class="grid2">
      <label class="field">Mode family
        <select data-b="type">
          <option value="gauss">Gaussian (LG₀₀)</option>
          <option value="lg">Laguerre–Gauss LGₚₗ</option>
          <option value="hg">Hermite–Gauss HGₘₙ</option>
        </select>
      </label>
      <label class="field">Polarisation
        <select data-b="pol">
          <option value="x">linear x</option>
          <option value="y">linear y</option>
          <option value="circular+">circular +</option>
          <option value="circular-">circular −</option>
        </select>
      </label>
      <label class="field" data-show="mode"><span data-b="m1label">p</span>
        <input data-b="m1" type="number" step="1" min="0" value="0">
      </label>
      <label class="field" data-show="mode"><span data-b="m2label">ℓ</span>
        <input data-b="m2" type="number" step="1" value="0">
      </label>
      <label class="field">Focus given by
        <select data-b="focus">
          <option value="NA">numerical aperture</option>
          <option value="waist">waist w₀ (µm)</option>
        </select>
      </label>
      <label class="field"><span data-b="focuslabel">NA</span>
        <input data-b="focusval" type="number" step="any" min="0">
      </label>
    </div>`);
  const q = (k) => el.querySelector(`[data-b="${k}"]`);
  const sync = () => {
    const t = q("type").value;
    el.querySelectorAll('[data-show="mode"]').forEach((n) => { n.hidden = t === "gauss"; });
    q("m1label").textContent = t === "hg" ? "m (x)" : "p (radial)";
    q("m2label").textContent = t === "hg" ? "n (y)" : "ℓ (azimuthal)";
    q("m2").min = t === "hg" ? 0 : "";
    q("focuslabel").textContent = q("focus").value === "NA" ? "NA" : "waist w₀ (µm)";
  };
  el.addEventListener("change", sync);
  sync();
  return {
    read() {
      const t = q("type").value;
      const spec = {
        type: t === "hg" ? "hg" : "lg",
        mode: t === "gauss" ? [0, 0] : [parseInt(q("m1").value || 0, 10), parseInt(q("m2").value || 0, 10)],
        polarisation: q("pol").value,
      };
      const v = parseFloat(q("focusval").value);
      if (q("focus").value === "NA") spec.NA = v; else spec.waist = v * 1e-6;
      return spec;
    },
    write(spec) {
      const gauss = spec.type === "lg" && spec.mode[0] === 0 && spec.mode[1] === 0;
      q("type").value = gauss ? "gauss" : spec.type;
      q("m1").value = spec.mode[0];
      q("m2").value = spec.mode[1];
      q("pol").value = typeof spec.polarisation === "string" ? spec.polarisation : "x";
      if (spec.waist) { q("focus").value = "waist"; q("focusval").value = +(spec.waist * 1e6).toPrecision(6); }
      else { q("focus").value = "NA"; q("focusval").value = spec.NA ?? 0.9; }
      sync();
    },
  };
}

let beam1, beam2;

// ---------------------------------------------------------------- form <-> request
function readRequest() {
  const wl = parseFloat($("wavelength").value) * 1e-9;
  const Ptot = parseFloat($("power").value) * 1e-3;
  const b1 = beam1.read();
  const beams = [b1];
  let dark = false;
  if ($("beam2-on").checked) {
    const r = Math.max(parseFloat($("ratio").value) || 0, 0);
    const b2 = beam2.read();
    b1.power = Ptot / (1 + r);
    b2.power = Ptot * r / (1 + r);
    b1.phase = 0;
    b2.phase = (parseFloat($("phase").value) || 0) * Math.PI;
    beams.push(b2);
    dark = $("dark-focus").checked;
  } else {
    b1.power = Ptot;
    b1.phase = 0;
  }
  const mp = {};
  document.querySelectorAll("[data-mp]").forEach((c) => { mp[c.dataset.mp] = c.checked; });
  const npts = parseInt($("npts").value, 10) || 41;
  const zr = parseFloat($("zrange").value) * 1e-6;
  const xr = parseFloat($("xrange").value) * 1e-6;
  return {
    wavelength: wl,
    medium_index: parseFloat($("medium").value),
    particle: {
      material: $("material").value === "custom" ? null : $("material").value,
      radius: parseFloat($("radius").value) * 1e-9,
      n: parseFloat($("n").value),
      k: parseFloat($("k").value) || 0,
      density: parseFloat($("density").value),
    },
    beams,
    dark_focus: dark,
    multipoles: mp,
    dipole_overlay: $("dipole").checked,
    temperature: parseFloat($("temperature").value) || 300,
    scan: { z_range: zr, x_range: xr, z_points: Math.round(npts * 1.5) | 1, x_points: npts,
            map_nx: 13, map_nz: 17, intensity_n: 60 },
  };
}

function applyRequest(req) {
  $("wavelength").value = +(req.wavelength * 1e9).toPrecision(6);
  $("medium").value = req.medium_index ?? 1.0;
  const p = req.particle;
  $("material").value = p.material || "custom";
  $("radius").value = +(p.radius * 1e9).toPrecision(6);
  $("n").value = +Number(p.n).toPrecision(6);
  $("k").value = p.k ?? 0;
  $("density").value = p.density;
  const P = req.beams.reduce((s, b) => s + (b.power ?? 0), 0);
  $("power").value = +(P * 1e3).toPrecision(6);
  beam1.write(req.beams[0]);
  const two = req.beams.length > 1;
  $("beam2-on").checked = two;
  if (two) {
    beam2.write(req.beams[1]);
    $("ratio").value = +((req.beams[1].power || 0) / (req.beams[0].power || 1)).toPrecision(4);
    $("phase").value = +(((req.beams[1].phase || 0) - (req.beams[0].phase || 0)) / Math.PI).toPrecision(4);
  }
  $("dark-focus").checked = !!req.dark_focus;
  document.querySelectorAll("[data-mp]").forEach((c) => { c.checked = true; });
  $("dipole").checked = !!req.dipole_overlay;
  const sc = req.scan || {};
  $("zrange").value = +((sc.z_range ?? 3e-6) * 1e6).toPrecision(4);
  $("xrange").value = +((sc.x_range ?? 1.5e-6) * 1e6).toPrecision(4);
  $("npts").value = sc.x_points ?? 41;
  $("temperature").value = req.temperature ?? 300;
  syncBeam2();
}

function syncBeam2() {
  const on = $("beam2-on").checked;
  $("beam2").hidden = !on;
  $("beam2-extra").hidden = !on;
  $("ratio").disabled = on && $("dark-focus").checked;
}

async function refreshMaterial(fill) {
  const wl = parseFloat($("wavelength").value) * 1e-9;
  const key = wl.toPrecision(8);
  if (!MATERIALS[key]) {
    try { MATERIALS[key] = await backend.call("materials", String(wl)); } catch (e) { return; }
  }
  const name = $("material").value;
  const note = $("material-note");
  if (name === "custom") { note.hidden = true; return; }
  const m = MATERIALS[key][name];
  if (m && m.valid) {
    if (fill) { $("n").value = +m.n.toPrecision(6); $("k").value = m.k; $("density").value = m.density; }
    note.hidden = false;
    note.className = "note small";
    note.textContent = m.source;
  } else {
    note.hidden = false;
    note.className = "note small warn";
    note.textContent = `No tabulated index for ${name} at ${$("wavelength").value} nm — n and k are kept as entered (edit them, or choose “custom”). ${m ? m.source : ""}`;
    if (fill && m) $("density").value = m.density;
  }
}

// ---------------------------------------------------------------- compute loop
let debounceTimer = null;
function schedule() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(run, 450);
}

async function run() {
  if (busy) { queued = true; return; }
  busy = true;
  queued = false;
  $("spinner").hidden = false;
  $("error").hidden = true;
  const req = readRequest();
  const t0 = performance.now();
  try {
    const out = await backend.call("compute", JSON.stringify(req));
    if (!out.ok) throw new Error(out.error);
    lastResult = out.result;
    lastReq = req;
    render(lastResult, req);
    $("timing").textContent = `computed in ${((performance.now() - t0) / 1000).toFixed(2)} s`;
  } catch (err) {
    $("error").hidden = false;
    $("error").textContent = String(err.message || err);
  } finally {
    busy = false;
    $("spinner").hidden = true;
    if (queued) run();
  }
}

// ---------------------------------------------------------------- rendering
function baseLayout(extra = {}) {
  const text = css("--text-secondary");
  const grid = css("--border");
  return Object.assign({
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", size: 12, color: text },
    margin: { l: 60, r: 16, t: 28, b: 44 },
    hoverlabel: { bgcolor: css("--surface-1"), bordercolor: grid, font: { color: css("--text-primary") } },
  }, extra);
}
const axis = (title, extra = {}) => Object.assign({
  title: { text: title, standoff: 6 }, gridcolor: css("--border"), zerolinecolor: css("--text-muted"),
  linecolor: css("--border"), ticks: "outside", tickcolor: css("--border"),
}, extra);
const PLOT_CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] };

function tile(label, value, sub) {
  return `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub2">${sub}</div>` : ""}</div>`;
}

function render(r, req) {
  const banner = $("trap-banner");
  banner.hidden = false;
  const wl = req.wavelength;
  if (r.stable) {
    banner.className = "banner good";
    banner.textContent = "✓ Stable 3D trap";
  } else {
    banner.className = "banner bad";
    banner.textContent = r.z_eq === null ? "✕ No stable trap — no restoring zero crossing along the beam axis in the scanned range"
      : "✕ No stable trap — axial equilibrium found, but it is laterally unstable";
  }
  const kHz = (v) => (v === null ? "—" : fmt(v / 1e3, 3));
  const tiles = [];
  tiles.push(tile("z<sub>eq</sub>", r.z_eq === null ? "—" : `${fmt(r.z_eq * 1e9, 4)} nm`,
    r.z_eq === null ? "" : `${fmt(r.z_eq / wl, 3)} λ₀ from focus`));
  tiles.push(tile("f<sub>z</sub> (axial)", `${kHz(r.freq.z)} kHz`, r.stiffness.z !== null ? `κ = ${fmtE(r.stiffness.z)} N/m` : ""));
  tiles.push(tile("f<sub>x</sub>, f<sub>y</sub> (radial)", `${kHz(r.freq.x)}, ${kHz(r.freq.y)} kHz`,
    r.stiffness.x !== null ? `κ = ${fmtE(r.stiffness.x)}, ${fmtE(r.stiffness.y)} N/m` : ""));
  const d = r.depth || {};
  tiles.push(tile(`Trap depth (${d.temperature ?? req.temperature} K)`,
    d.kT !== undefined && d.kT !== null && r.stable ? `${fmtE(d.kT)} k<sub>B</sub>T` : "—",
    d.K !== undefined && r.stable ? `${fmtE(d.K)} K${d.bounded && !(d.bounded.x && d.bounded.y && d.bounded.z) ? " · lower bound (scan edge)" : ""}` : ""));
  tiles.push(tile("Q<sub>sca</sub>, Q<sub>abs</sub> (plane wave)", `${fmtE(r.mie.Qsca)}, ${fmtE(r.mie.Qabs)}`, `size parameter x = ${fmt(r.mie.x, 3)}`));
  tiles.push(tile("Scattered power at z<sub>eq</sub>", `${fmtE(r.at.P_sca * 1e3)} mW`, `${fmtE(r.at.Qsca_beam)} of beam`));
  tiles.push(tile("Absorbed power", `${fmtE(r.at.P_abs * 1e9)} nW`, ""));
  tiles.push(tile("Γ/Ω (recoil)", r.recoil_ratio.z === null ? "—" : `${fmtE(r.recoil_ratio.z)} (z)`,
    r.recoil_ratio.x === null ? "" : `${fmtE(r.recoil_ratio.x)} (x), ${fmtE(r.recoil_ratio.y)} (y)`));
  tiles.push(tile("Mass", `${fmtE(r.mass)} kg`, `${fmtE(r.mass / 1.66053906660e-27)} amu`));
  tiles.push(tile("N<sub>max</sub> beam / particle", `${r.Nmax.beam} / ${r.Nmax.particle}`, `P = ${fmt(r.power * 1e3, 4)} mW${r.beam_powers && r.beam_powers.length > 1 ? ` (${r.beam_powers.map((p) => fmt(p * 1e3, 3)).join(" + ")} mW)` : ""}`));
  $("tiles").innerHTML = tiles.join("");
  renderLines(r);
  renderMap(r, req);
  renderMultipoles(r);
}

function renderLines(r) {
  const L = r.lines;
  const pN = (a) => a.map((v) => v * 1e12);
  const um = (a) => a.map((v) => v * 1e6);
  const cols = [css("--series-1"), css("--series-2"), css("--series-3")];
  const traces = [
    { x: um(L.x), y: pN(L.Fx[0]), name: "Fₓ (Mie)", xaxis: "x", yaxis: "y", line: { color: cols[0], width: 2 } },
    { x: um(L.y), y: pN(L.Fy[1]), name: "F_y (Mie)", xaxis: "x2", yaxis: "y2", line: { color: cols[1], width: 2 } },
    { x: um(L.z), y: pN(L.Fz[2]), name: "F_z (Mie)", xaxis: "x3", yaxis: "y3", line: { color: cols[2], width: 2 } },
  ];
  traces.forEach((t) => { t.mode = "lines"; t.hovertemplate = "%{x:.3f} µm<br>%{y:.4g} pN<extra>%{fullData.name}</extra>"; });
  let legend = false;
  if (L.dipole) {
    legend = true;
    traces.push(
      { x: um(L.x), y: pN(L.dipole.Fx), name: "dipole approx.", xaxis: "x", yaxis: "y", line: { color: cols[0], width: 2, dash: "dash" }, mode: "lines", legendgroup: "dip" },
      { x: um(L.y), y: pN(L.dipole.Fy), name: "dipole F_y", xaxis: "x2", yaxis: "y2", line: { color: cols[1], width: 2, dash: "dash" }, mode: "lines", showlegend: false },
      { x: um(L.z), y: pN(L.dipole.Fz), name: "dipole F_z", xaxis: "x3", yaxis: "y3", line: { color: cols[2], width: 2, dash: "dash" }, mode: "lines", showlegend: false });
    traces.slice(0, 3).forEach((t) => { t.showlegend = t.yaxis === "y"; t.name = t.yaxis === "y" ? "full Mie" : t.name; });
  }
  const shapes = [];
  if (r.z_eq !== null) {
    shapes.push({ type: "line", xref: "x3", yref: "y3 domain", x0: r.z_eq * 1e6, x1: r.z_eq * 1e6, y0: 0, y1: 1,
                  line: { color: css("--text-muted"), width: 1, dash: "dot" } });
  }
  const ann = [
    { text: `Fₓ along x at z = ${fmt(L.z_ref * 1e9, 3)} nm`, xref: "x domain", yref: "paper", x: 0.5, y: 1.07, showarrow: false },
    { text: "F_y along y", xref: "x2 domain", yref: "paper", x: 0.5, y: 1.07, showarrow: false },
    { text: "F_z along the beam axis", xref: "x3 domain", yref: "paper", x: 0.5, y: 1.07, showarrow: false },
  ];
  const layout = baseLayout({
    showlegend: legend, legend: { orientation: "h", y: -0.2, x: 0 },
    xaxis: axis("x (µm)", { domain: [0, 0.29] }), yaxis: axis("force (pN)"),
    xaxis2: axis("y (µm)", { domain: [0.355, 0.645] }), yaxis2: axis("", { anchor: "x2" }),
    xaxis3: axis("z (µm)", { domain: [0.71, 1] }), yaxis3: axis("", { anchor: "x3" }),
    shapes, annotations: ann, hovermode: "closest", margin: { l: 60, r: 16, t: 34, b: legend ? 70 : 44 },
  });
  Plotly.react("plot-lines", traces, layout, PLOT_CONFIG);
}

function renderMap(r, req) {
  const M = r.map;
  const um = (a) => a.map((v) => v * 1e6);
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const ramp = dark
    ? [[0, "#1a1a19"], [0.25, "#104281"], [0.5, "#256abf"], [0.75, "#5598e7"], [1, "#b7d3f6"]]
    : [[0, "#fcfcfb"], [0.2, "#cde2fb"], [0.45, "#86b6ef"], [0.7, "#2a78d6"], [1, "#104281"]];
  const I = M.I.map((row) => row.map((v) => v * 1e-9)); // W/m² -> mW/µm²
  const heat = {
    type: "heatmap", x: um(M.Ix), y: um(M.Iz), z: I, colorscale: ramp, zsmooth: "best",
    colorbar: { title: { text: "I (mW/µm²)", side: "right" }, thickness: 12, outlinewidth: 0 },
    hovertemplate: "x %{x:.2f} µm, z %{y:.2f} µm<br>I = %{z:.3g} mW/µm²<extra></extra>",
  };
  // normalised arrows
  const xs = um(M.x), zs = um(M.z);
  const dx = xs.length > 1 ? xs[1] - xs[0] : 1, dz = zs.length > 1 ? zs[1] - zs[0] : 1;
  const len = 0.42 * Math.min(Math.abs(dx), Math.abs(dz));
  const lx = [], lz = [], hx = [], hz = [], ang = [], txt = [];
  for (let i = 0; i < zs.length; i++) {
    for (let j = 0; j < xs.length; j++) {
      const fx = M.Fx[i][j], fz = M.Fz[i][j];
      const mag = Math.hypot(fx, fz);
      if (!(mag > 0)) continue;
      const ux = fx / mag, uz = fz / mag;
      const x0 = xs[j] - ux * len / 2, z0 = zs[i] - uz * len / 2;
      const x1 = xs[j] + ux * len / 2, z1 = zs[i] + uz * len / 2;
      lx.push(x0, x1, null); lz.push(z0, z1, null);
      hx.push(x1); hz.push(z1);
      ang.push(Math.atan2(ux, uz) * 180 / Math.PI);
      txt.push(`|F| = ${(mag * 1e12).toPrecision(3)} pN`);
    }
  }
  const arrowCol = dark ? "#f0efec" : "#0b0b0b";
  const shafts = { type: "scatter", mode: "lines", x: lx, y: lz, line: { color: arrowCol, width: 1.4 }, hoverinfo: "skip", showlegend: false };
  const heads = { type: "scatter", mode: "markers", x: hx, y: hz, text: txt,
    marker: { symbol: "triangle-up", size: 7, angle: ang, color: arrowCol },
    hovertemplate: "%{text}<extra></extra>", showlegend: false };
  const shapes = [];
  if (r.z_eq !== null) {
    const rad = req.particle.radius * 1e6, z0 = r.z_eq * 1e6;
    shapes.push({ type: "circle", x0: -rad, x1: rad, y0: z0 - rad, y1: z0 + rad,
      line: { color: r.stable ? css("--good") : css("--bad"), width: 2 },
      fillcolor: "rgba(127,127,127,0.25)" });
  }
  const layout = baseLayout({
    xaxis: axis("x (µm)", { constrain: "domain" }), yaxis: axis("z (µm)  — beam propagates ↑", { scaleanchor: "x" }),
    shapes, margin: { l: 60, r: 16, t: 10, b: 44 },
  });
  Plotly.react("plot-map", [heat, shafts, heads], layout, PLOT_CONFIG);
}

function renderMultipoles(r) {
  const keys = ["ED", "MD", "EQ", "MQ", "EO", "MO", "higher"];
  const names = ["ED", "MD", "EQ", "MQ", "EO", "MO", "n ≥ 4"];
  const atv = keys.map((k) => r.at.multipoles[k]);
  const pwv = keys.map((k) => r.mie.multipoles[k]);
  const floor = (arr) => arr.map((v) => (v > 0 ? v : null));
  const col = css("--series-1");
  const traces = [
    { type: "bar", x: names, y: floor(atv), name: "in beam", marker: { color: col }, xaxis: "x", yaxis: "y",
      hovertemplate: "%{x}: %{y:.3g} of beam power<extra></extra>" },
    { type: "bar", x: names, y: floor(pwv), name: "plane wave", marker: { color: col }, xaxis: "x2", yaxis: "y2",
      hovertemplate: "%{x}: Q = %{y:.3g}<extra></extra>" },
  ];
  const layout = baseLayout({
    showlegend: false, bargap: 0.35,
    xaxis: axis("", { domain: [0, 1], anchor: "y" }), yaxis: axis("P<sub>sca</sub>/P at z<sub>eq</sub>", { type: "log", domain: [0.56, 1], exponentformat: "power" }),
    xaxis2: axis("", { domain: [0, 1], anchor: "y2" }), yaxis2: axis("Q<sub>sca</sub> (plane wave)", { type: "log", domain: [0, 0.42], exponentformat: "power" }),
    margin: { l: 70, r: 16, t: 10, b: 30 },
  });
  Plotly.react("plot-mp", traces, layout, PLOT_CONFIG);
}

// ---------------------------------------------------------------- sweep
let sweepCancel = false;
let sweepData = null;

function sweepDefaults() {
  const v = $("sw-var").value;
  if (v === "radius") { const r = parseFloat($("radius").value); $("sw-from").value = +(r * 0.5).toPrecision(3); $("sw-to").value = +(r * 1.5).toPrecision(3); }
  if (v === "wavelength") { const w = parseFloat($("wavelength").value); $("sw-from").value = +(w * 0.9).toPrecision(4); $("sw-to").value = +(w * 1.1).toPrecision(4); }
  if (v === "power") { const p = parseFloat($("power").value); $("sw-from").value = +(p * 0.2).toPrecision(3); $("sw-to").value = +(p * 2).toPrecision(3); }
}

async function runSweep() {
  const variable = $("sw-var").value;
  const a = parseFloat($("sw-from").value), b = parseFloat($("sw-to").value);
  const n = Math.max(2, Math.min(200, parseInt($("sw-n").value, 10) || 21));
  const scale = variable === "power" ? 1e-3 : 1e-9;
  const req = readRequest();
  req.dipole_overlay = false;
  sweepCancel = false;
  $("sw-run").disabled = true;
  $("sw-cancel").disabled = false;
  $("sw-progress-wrap").hidden = false;
  sweepData = { variable, points: [] };
  for (let i = 0; i < n && !sweepCancel; i++) {
    const v = a + (b - a) * i / (n - 1);
    try {
      const out = await backend.call("sweep", JSON.stringify(req), variable, JSON.stringify([v * scale]));
      sweepData.points.push(Object.assign(out.points[0], { ui: v }));
    } catch (err) {
      sweepData.points.push({ ui: v, stable: false, error: String(err) });
    }
    $("sw-progress").style.width = `${100 * (i + 1) / n}%`;
    renderSweep();
  }
  $("sw-run").disabled = false;
  $("sw-cancel").disabled = true;
  setTimeout(() => { $("sw-progress-wrap").hidden = true; }, 600);
}

function renderSweep() {
  if (!sweepData) return;
  const P = sweepData.points;
  const qty = $("sw-qty").value;
  const xs = P.map((p) => p.ui);
  const cols = [css("--series-1"), css("--series-2"), css("--series-3")];
  const st = (p, v) => (p.stable && v !== null && v !== undefined ? v : null);
  let traces = [];
  let ylab = "";
  const line = (name, ys, c) => ({ x: xs, y: ys, name, mode: "lines+markers", line: { color: c, width: 2 }, marker: { size: 8, color: c }, connectgaps: false });
  if (qty === "freq") {
    traces = [line("f_x", P.map((p) => st(p, p.freq && p.freq.x !== null ? p.freq.x / 1e3 : null)), cols[0]),
              line("f_y", P.map((p) => st(p, p.freq && p.freq.y !== null ? p.freq.y / 1e3 : null)), cols[1]),
              line("f_z", P.map((p) => st(p, p.freq && p.freq.z !== null ? p.freq.z / 1e3 : null)), cols[2])];
    ylab = "trap frequency (kHz)";
  } else if (qty === "z_eq") { traces = [line("z_eq", P.map((p) => st(p, p.z_eq !== null && p.z_eq !== undefined ? p.z_eq * 1e9 : null)), cols[0])]; ylab = "z_eq (nm)"; }
  else if (qty === "depth") { traces = [line("depth", P.map((p) => st(p, p.depth_kT)), cols[0])]; ylab = "trap depth (k_BT)"; }
  else if (qty === "recoil") { traces = [line("Γ/Ω_z", P.map((p) => st(p, p.recoil_ratio && p.recoil_ratio.z)), cols[0])]; ylab = "Γ/Ω_z"; }
  else if (qty === "psca") { traces = [line("P_sca", P.map((p) => (p.P_sca ?? null) !== null ? p.P_sca * 1e3 : null), cols[0])]; ylab = "scattered power at z_eq (mW)"; }
  else if (qty === "pabs") { traces = [line("P_abs", P.map((p) => (p.P_abs ?? null) !== null ? p.P_abs * 1e9 : null), cols[0])]; ylab = "absorbed power (nW)"; }
  traces.forEach((t) => { t.hovertemplate = `%{x:.4g}: %{y:.4g}<extra>${t.name}</extra>`; });
  // shade unstable regions
  const shapes = [];
  const half = xs.length > 1 ? Math.abs(xs[1] - xs[0]) / 2 : 0.5;
  P.forEach((p) => {
    if (!p.stable) shapes.push({ type: "rect", xref: "x", yref: "paper", x0: p.ui - half, x1: p.ui + half, y0: 0, y1: 1,
                                 fillcolor: css("--unstable"), line: { width: 0 }, layer: "below" });
  });
  const xlab = { radius: "particle radius (nm)", wavelength: "wavelength (nm)", power: "total power (mW)" }[sweepData.variable];
  const layout = baseLayout({
    shapes, xaxis: axis(xlab), yaxis: axis(ylab, { type: qty === "recoil" || qty === "pabs" || qty === "psca" ? "log" : "linear", exponentformat: "power" }),
    showlegend: traces.length > 1, legend: { orientation: "h", y: 1.12, x: 0 },
    annotations: shapes.length ? [{ text: "grey: no stable trap", xref: "paper", yref: "paper", x: 1, y: 1.08, showarrow: false, xanchor: "right", font: { size: 11 } }] : [],
    margin: { l: 70, r: 16, t: 34, b: 44 },
  });
  Plotly.react("plot-sweep", traces, layout, PLOT_CONFIG);
}

// ---------------------------------------------------------------- theme
function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { if (t) localStorage.setItem("levtrap-theme", t); else localStorage.removeItem("levtrap-theme"); } catch (e) { /* storage unavailable */ }
  if (lastResult) render(lastResult, lastReq);
  renderSweep();
}

// ---------------------------------------------------------------- init
async function init() {
  try { const t = localStorage.getItem("levtrap-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
  $("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(cur === "dark" ? "light" : "dark");
  });
  beam1 = beamFieldset($("beam1"), 1);
  beam2 = beamFieldset($("beam2"), 2);
  $("material").innerHTML = MATERIAL_NAMES.map((m) => `<option value="${m}">${m.replace(/(\d)/g, "<sub>$1</sub>")}</option>`).join("") +
    '<option value="custom">custom</option>';

  // version footer
  fetch("version.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((v) => {
    if (v) $("ver").textContent = `${v.version} · commit ${String(v.commit).slice(0, 7)} · built ${v.date}`;
  }).catch(() => {});

  $("plot-sweep").innerHTML = '<div class="placeholder">Choose a parameter and range above, then press “Run sweep”. Each point is a full trap calculation, so 20 points take a little while.</div>';
  backend.on("progress", (m) => { $("loader-stage").textContent = m.stage; $("loader-bar").style.width = `${Math.round(m.fraction * 100)}%`; });
  backend.on("fatal", (m) => { $("loader-stage").textContent = `Failed to start: ${m.error}`; $("status").textContent = "engine failed"; });
  backend.on("ready", async (versions) => {
    $("loader").hidden = true;
    $("status").textContent = LOCAL ? "local backend" : `Python ${versions.python} · NumPy ${versions.numpy} · SciPy ${versions.scipy} (Pyodide ${versions.pyodide})`;
    PRESETS = await backend.call("presets");
    $("preset").innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join("");
    const first = params.get("preset") && PRESETS[params.get("preset")] ? params.get("preset") : Object.keys(PRESETS)[0];
    $("preset").value = first;
    loadPreset(first);
  });
  if (LOCAL) $("loader").hidden = true;
  backend.start();

  $("preset").addEventListener("change", () => loadPreset($("preset").value));
  $("material").addEventListener("change", async () => { await refreshMaterial(true); schedule(); });
  $("wavelength").addEventListener("change", async () => { await refreshMaterial(true); schedule(); });
  $("beam2-on").addEventListener("change", () => { syncBeam2(); schedule(); });
  $("dark-focus").addEventListener("change", () => { syncBeam2(); schedule(); });
  document.querySelector(".params").addEventListener("input", (e) => {
    if (e.target.id === "preset" || e.target.id === "material" || e.target.id === "wavelength") return;
    if (["n", "k"].includes(e.target.id) && $("material").value !== "custom") {
      $("material").value = "custom";
      $("material-note").hidden = true;
    }
    schedule();
  });
  document.querySelector(".params").addEventListener("change", (e) => {
    if (e.target.tagName === "SELECT" && !["preset", "material"].includes(e.target.id)) schedule();
  });
  $("sw-var").addEventListener("change", sweepDefaults);
  $("sw-qty").addEventListener("change", renderSweep);
  $("sw-run").addEventListener("click", runSweep);
  $("sw-cancel").addEventListener("click", () => { sweepCancel = true; });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (lastResult) render(lastResult, lastReq); renderSweep(); });
}

async function loadPreset(key) {
  const p = PRESETS[key];
  applyRequest(clone(p.request));
  const note = $("preset-note");
  note.hidden = !p.note && p.validated !== false;
  note.textContent = (p.validated === false ? "⚠ Illustrative, not validated. " : "") + (p.note || "");
  await refreshMaterial(false);
  sweepDefaults();
  run();
}

document.addEventListener("DOMContentLoaded", init);
