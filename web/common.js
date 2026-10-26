/* Shared by index.html (trap simulator) and lens.html (lens tilt):
 * Python backend (Pyodide worker or local dev server), formatting, Plotly
 * styling, help tooltips. */
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

function helpIcon(text) {
  const span = document.createElement("span");
  span.className = "help";
  span.tabIndex = 0;
  span.setAttribute("role", "note");
  span.setAttribute("aria-label", text);
  span.innerHTML = 'ⓘ<span class="tip"></span>';
  span.querySelector(".tip").textContent = text;
  return span;
}
const helpHTML = (text) => `<span class="help" tabindex="0" role="note" aria-label="${text.replace(/"/g, "&quot;")}">ⓘ<span class="tip">${text}</span></span>`;

function attachHelp(root, HELP) {
  root.querySelectorAll("label.field, label.check").forEach((lab) => {
    const input = lab.querySelector("input, select");
    if (!input || lab.querySelector(".help")) return;
    const key = input.id || input.dataset.b;
    if (!HELP[key]) return;
    if (lab.classList.contains("check")) { lab.appendChild(helpIcon(HELP[key])); return; }
    // keep the caption and its icon on one line: wrap them in a row
    const first = lab.firstChild;
    const row = document.createElement("span");
    row.className = "cap";
    lab.insertBefore(row, first);
    row.appendChild(first);
    row.appendChild(helpIcon(HELP[key]));
  });
}

// ---------------------------------------------------------------- plotting
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

// keep tooltips inside the viewport (position: fixed, clamped)
function placeTip(ev) {
  const help = ev.target.closest && ev.target.closest(".help");
  if (!help) return;
  const tip = help.querySelector(".tip");
  const r = help.getBoundingClientRect();
  const w = Math.min(260, window.innerWidth - 24);
  tip.style.position = "fixed";
  tip.style.width = `${w}px`;
  tip.style.transform = "none";
  tip.style.left = `${Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12))}px`;
  tip.style.top = `${r.bottom + 6}px`;
}
document.addEventListener("mouseover", placeTip);
document.addEventListener("focusin", placeTip);


// ---------------------------------------------------------------- theme
function initTheme(onChange) {
  try { const t = localStorage.getItem("levtrap-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const t = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("levtrap-theme", t); } catch (e) { /* storage unavailable */ }
    onChange();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
}

const isDark = () => document.documentElement.dataset.theme === "dark" ||
  (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

function showVersion() {
  fetch("version.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((v) => {
    if (v) document.getElementById("ver").textContent = `${v.version} · commit ${String(v.commit).slice(0, 7)} · built ${v.date}`;
  }).catch(() => {});
}
