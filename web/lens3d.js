/* 3D view for the lens-tilt page (lens.html): the tilted asphere, traced rays
 * and, in a magnified inset, the focus and the particle.
 *
 * The rays are traced here in JavaScript (same method and prescription as
 * src/levtrap/lens.py, tests/test_lens.py checks the numbers match) so the
 * lens and rays follow the inputs instantly.  The focus shift and particle
 * position in the inset come from the Python result once it arrives.
 *
 * Loaded lazily by lens.js with import("./lens3d.js").
 * Main view units: mm.  Inset units: um about the aligned focus.
 * Lab frame: z = optical axis (light travels +z), S1 vertex of the aligned lens at z = 0.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Thorlabs 354330-C, copied from levtrap.lens.THORLABS_354330
export const LENS = {
  s1: { c: 0.36692108501490123, k: -0.5421234096046, sd: 2.5,
        A: [-2.077710281508e-5, -1.373929859525e-4, 2.029327872896e-5, -2.961194418229e-6] },
  s2: { c: -0.33567844058620466, k: -12.10285287639, sd: 1.920176352261,
        A: [8.068904748567e-3, -1.725894132603e-3, 1.839071992368e-4, -8.936267158057e-6] },
  t: 3.214106073867,
  indexOffset: -0.002665926317537358,
  sellmeier: [1.33936811, 0.00760612309, 0.148690268, 0.0238444644, 1.00954033, 89.0419787],  // CDGM D-ZK3
};

// ---------------------------------------------------------------- ray trace
function nGlass(um) {
  const [B1, C1, B2, C2, B3, C3] = LENS.sellmeier, l2 = um * um;
  return Math.sqrt(1 + B1 * l2 / (l2 - C1) + B2 * l2 / (l2 - C2) + B3 * l2 / (l2 - C3)) + LENS.indexOffset;
}
function sag(s, r2) {
  let z = s.c * r2 / (1 + Math.sqrt(Math.max(1 - (1 + s.k) * s.c * s.c * r2, 0))), p = r2 * r2;
  for (const a of s.A) { z += a * p; p *= r2; }
  return z;
}
function dsag(s, r2) {  // d sag / d(r^2)
  const q = Math.sqrt(Math.max(1 - (1 + s.k) * s.c * s.c * r2, 1e-300));
  let d = s.c / (1 + q) + s.c * r2 * ((1 + s.k) * s.c * s.c / (2 * q)) / ((1 + q) * (1 + q)), p = r2;
  for (let i = 0; i < s.A.length; i++) { d += (i + 2) * s.A[i] * p; p *= r2; }
  return d;
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a) => scl(a, 1 / Math.hypot(a[0], a[1], a[2]));
// R = Ry(ty) Rx(tx): about x first, then y (lens._rot)
function rotation(txDeg, tyDeg) {
  const a = txDeg * Math.PI / 180, b = tyDeg * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  return [cb, sb * sa, sb * ca, 0, ca, -sa, -sb, cb * sa, cb * ca];
}
const mul = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mulT = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];

function intersect(s, z0, P, U) {
  let t = (z0 - P[2]) / U[2];
  for (let i = 0; i < 40; i++) {
    const x = P[0] + t * U[0], y = P[1] + t * U[1], r2 = x * x + y * y;
    const dt = (P[2] + t * U[2] - z0 - sag(s, r2)) / (U[2] - dsag(s, r2) * 2 * (x * U[0] + y * U[1]));
    t -= dt;
    if (Math.abs(dt) < 1e-12) break;
  }
  const X = add(P, scl(U, t)), r2 = X[0] * X[0] + X[1] * X[1], d = dsag(s, r2);
  return { X, t, N: unit([-2 * d * X[0], -2 * d * X[1], 1]), ok: r2 <= s.sd * s.sd && isFinite(t) };
}
function refract(U, N, n1, n2) {
  let ci = -dot(U, N);
  if (ci < 0) { N = scl(N, -1); ci = -ci; }
  const eta = n1 / n2, k = 1 - eta * eta * (1 - ci * ci);
  return k < 0 ? null : unit(add(scl(U, eta), scl(N, eta * ci - Math.sqrt(k))));
}
function geometry(p) {
  return { R: rotation(p.tx, p.ty), pz: { S1: 0, centre: LENS.t / 2, S2: LENS.t }[p.pivot] ?? LENS.t / 2,
           dx: p.dx, dy: p.dy, n: nGlass(p.lam_nm * 1e-3) };
}
// One collimated ray at (x, y).  through = false if an aperture blocks it; A = S1 hit, Q = S2 exit.
function traceRay(x, y, G) {
  const piv = [0, 0, G.pz], sh = [G.dx, G.dy, 0];
  const toLab = (X) => add(add(mul(G.R, sub(X, piv)), piv), sh);
  const Pl = add(mulT(G.R, sub(sub([x, y, -1], piv), sh)), piv), Ul = mulT(G.R, [0, 0, 1]);
  const h1 = intersect(LENS.s1, 0, Pl, Ul);
  const U1 = h1.ok ? refract(Ul, h1.N, 1, G.n) : null;
  if (!U1) return { through: false, A: toLab(h1.X) };
  const h2 = intersect(LENS.s2, LENS.t, h1.X, U1);
  const U2 = h2.ok ? refract(U1, h2.N, G.n, 1) : null;
  if (!U2) return { through: false, A: toLab(h1.X) };
  return { through: true, A: toLab(h1.X), Q: toLab(h2.X), U: mul(G.R, U2), L: h1.t + h2.t * G.n };
}
// Best focus: least squares on the wavefront W = L + u.(P - Q) over a ray grid (lens.best_focus)
function bestFocus(p) {
  const G = geometry(p), w = p.D / 2, half = Math.max(LENS.s1.sd, 1.6 * w), N = 31;
  const M = Array.from({ length: 4 }, () => [0, 0, 0, 0]), b = [0, 0, 0, 0];
  let ubar = [0, 0, 0];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -half + 2 * half * i / (N - 1), y = -half + 2 * half * j / (N - 1);
    const r = traceRay(x, y, G);
    if (!r.through) continue;
    const wt = Math.exp(-2 * (x * x + y * y) / (w * w)), a = r.L - dot(r.U, r.Q), row = [...r.U, -1];
    for (let m = 0; m < 4; m++) { b[m] -= wt * a * row[m]; for (let n = 0; n < 4; n++) M[m][n] += wt * row[m] * row[n]; }
    ubar = add(ubar, scl(r.U, wt));
  }
  // Gauss-Jordan on the 4x4 normal equations
  const A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 4; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 5; k++) A[r][k] -= f * A[c][k]; }
  }
  return { P: [A[0][4] / A[0][0], A[1][4] / A[1][1], A[2][4] / A[2][2]], ubar: unit(ubar), G };
}

// ---------------------------------------------------------------- scene helpers
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const color = (n) => new THREE.Color(css(n) || "#888");
function dispose(group) {
  while (group.children.length) {
    group.children.pop().traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }
}
function lensProfile(nr) {  // (r, z) outline of the moulded lens for a LatheGeometry
  const { s1, s2 } = LENS, zEdge = LENS.t + sag(s2, s2.sd * s2.sd), rFlange = 2.62, pts = [];
  for (let i = 0; i <= nr; i++) { const r = s1.sd * i / nr; pts.push(new THREE.Vector2(r, sag(s1, r * r))); }
  pts.push(new THREE.Vector2(rFlange, sag(s1, s1.sd * s1.sd)), new THREE.Vector2(rFlange, zEdge), new THREE.Vector2(s2.sd, zEdge));
  for (let i = nr; i >= 0; i--) { const r = s2.sd * i / nr; pts.push(new THREE.Vector2(r, LENS.t + sag(s2, r * r))); }
  return pts;
}
function lines(pts, cols, opacity = 0.9) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity }));
}
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

// ---------------------------------------------------------------- view
export function createLensView(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);
  const frame = document.createElement("div");
  frame.className = "l3-inset";
  frame.innerHTML = '<span class="l3-inset-title">focus, magnified</span><span class="l3-scale"><span></span><i></i></span>';
  container.appendChild(frame);

  const scene = new THREE.Scene(), iscene = new THREE.Scene();
  for (const s of [scene, iscene]) {
    s.add(new THREE.AmbientLight(0xffffff, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(3, 5, 4); s.add(d);
  }
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 500);
  const icam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.addEventListener("change", render);

  const lab = new THREE.Group(), ilab = new THREE.Group();  // lab frame inside each scene
  scene.add(lab); iscene.add(ilab);
  const fixed = new THREE.Group(), moving = new THREE.Group(), rays = new THREE.Group(), inset = new THREE.Group();
  lab.add(fixed, moving, rays); ilab.add(inset);
  const tilt = new THREE.Group(); tilt.rotation.order = "YXZ";  // matrix Ry Rx, as in the trace
  const body = new THREE.Group(); tilt.add(body); moving.add(tilt);
  const lensGeo = new THREE.LatheGeometry(lensProfile(28), 64);

  let horizontal = true, params = null, result = null, stale = false, insetRect = { x: 0, y: 0, s: 0 };

  function buildFixed() {
    dispose(fixed); dispose(body);
    const glass = color("--accent"), muted = color("--text-muted");
    const lens = new THREE.Mesh(lensGeo, new THREE.MeshStandardMaterial({ color: glass, roughness: 0.15, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(lensGeo, 25), new THREE.LineBasicMaterial({ color: glass, transparent: true, opacity: 0.6 }));
    for (const o of [lens, edges]) { o.rotation.x = Math.PI / 2; body.add(o); }  // lathe axis (y) -> lab z
    const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -4), new THREE.Vector3(0, 0, LENS.t + 3)]),
      new THREE.LineDashedMaterial({ color: glass, dashSize: 0.2, gapSize: 0.14 }));
    axis.computeLineDistances(); body.add(axis);
    const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.LatheGeometry(lensProfile(10), 24), 20),
      new THREE.LineBasicMaterial({ color: muted, transparent: true, opacity: 0.4 }));
    ghost.rotation.x = Math.PI / 2; fixed.add(ghost);
    fixed.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -8), new THREE.Vector3(0, 0, 8)]),
      new THREE.LineBasicMaterial({ color: muted, transparent: true, opacity: 0.6 })));
    const pivot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshBasicMaterial({ color: glass }));
    pivot.name = "pivot"; fixed.add(pivot);  // marks the point the lens rotates about
  }

  function setOrientation() {
    // horizontal: lab z -> screen right (scene +x); vertical: lab z -> up (scene +y)
    for (const g of [lab, ilab]) g.rotation.set(horizontal ? 0 : -Math.PI / 2, horizontal ? Math.PI / 2 : 0, 0);
  }
  const toScene = (v) => (horizontal ? new THREE.Vector3(v[2], v[1], -v[0]) : new THREE.Vector3(v[0], v[2], -v[1]));

  function rebuild() {
    if (!params) return;
    dispose(rays); dispose(inset);
    const ray = color("--series-2"), muted = color("--text-muted"), bg = color("--surface-2");

    const bf = bestFocus(params), bf0 = bestFocus({ ...params, tx: 0, ty: 0, dx: 0, dy: 0 }), G = bf.G;
    tilt.position.set(G.dx, G.dy, G.pz);
    tilt.rotation.set(params.tx * Math.PI / 180, params.ty * Math.PI / 180, 0);
    body.position.set(0, 0, -G.pz);
    fixed.getObjectByName("pivot").position.set(G.dx, G.dy, G.pz);

    // focus (um about the aligned focus) and particle: Python result when present and current
    const fs = result && !stale ? result.focus_shift_um : sub(bf.P, bf0.P).map((v) => v * 1e3);
    const eq = result?.eq_um ?? null;
    const d = Math.max(Math.hypot(...fs), eq ? Math.hypot(...eq) : 0);
    const H = NICE.find((s) => s >= Math.max(1.25 * d, 2)) ?? 1e4;  // inset half-width (um)
    const toI = (X) => sub(X, bf0.P).map((v) => v * 1e3 / H);

    // rays: fans in the x-z and y-z planes
    const w = params.D / 2, span = Math.min(1.5 * w, 3), n = 13, zEnd = bf.P[2] + 1.5;
    const pos = [], col = [], ipos = [], icol = [];
    for (let i = 0; i < n; i++) {
      const s = -span + 2 * span * i / (n - 1);
      for (const [x, y] of s === 0 ? [[0, 0]] : [[s, 0], [0, s]]) {
        const r = traceRay(x, y, G), c = bg.clone().lerp(ray, 0.2 + 0.8 * Math.exp(-(x * x + y * y) / (w * w)));
        const seg = (a, b, cc) => { pos.push(...a, ...b); col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b); };
        seg([x, y, -8], r.A, r.through ? c : muted);
        if (!r.through) continue;
        seg(r.A, r.Q, c);
        seg(r.Q, add(r.Q, scl(r.U, (zEnd - r.Q[2]) / r.U[2])), c);
        // near-focus piece for the inset
        const ud = dot(r.U, bf.ubar), s0 = dot(sub(bf.P, r.Q), bf.ubar) / ud, ds = 1.3 * H * 1e-3 / ud;
        ipos.push(...toI(add(r.Q, scl(r.U, s0 - ds))), ...toI(add(r.Q, scl(r.U, s0 + ds))));
        icol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    rays.add(lines(pos, col));
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.4, 0.4, 0.4)), new THREE.LineBasicMaterial({ color: muted }));
    box.position.set(...bf.P); rays.add(box);

    // inset: aligned focus (cross), best focus (dot), particle (sphere + arrow)
    inset.add(lines(ipos, icol, 0.7));
    const L = 0.25, cross = [-L, 0, 0, L, 0, 0, 0, -L, 0, 0, L, 0, 0, 0, -L, 0, 0, L];
    inset.add(lines(cross, Array(18).fill(0).map((_, i) => [muted.r, muted.g, muted.b][i % 3]), 1));
    const focus = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 10), new THREE.MeshBasicMaterial({ color: ray }));
    focus.position.set(...fs.map((v) => v / H)); inset.add(focus);
    if (eq) {
      const pc = color(result.stable ? "--good" : "--bad");
      const p = new THREE.Mesh(new THREE.SphereGeometry(Math.max(params.a_nm * 1e-3 / H, 0.02), 24, 16),
        new THREE.MeshStandardMaterial({ color: pc, transparent: true, opacity: stale ? 0.35 : 1 }));
      const v = new THREE.Vector3(...eq.map((x) => x / H));
      p.position.copy(v); inset.add(p);
      if (v.length() > 0.08) inset.add(new THREE.ArrowHelper(v.clone().normalize(), new THREE.Vector3(), v.length(), pc.getHex(), 0.07, 0.045));
    }
    inset.userData = { H, centre: eq ? eq.map((x) => x / (2 * H)) : fs.map((x) => x / (2 * H)) };
    controls.target.copy(toScene([0, 0, 3.5]));
    render();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const s = Math.round(Math.min(w * 0.42, h * 0.6, 300)), m = 10;
    insetRect = { x: w - s - m, y: m, s };
    Object.assign(frame.style, { width: `${s}px`, height: `${s}px`, right: `${m}px`, bottom: `${m}px` });
    render();
  }

  function render() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
    renderer.setClearColor(color("--surface-2"), 1); renderer.clear();
    renderer.render(scene, camera);
    const { x, y, s } = insetRect, H = inset.userData.H;
    if (!H || s < 60) return;
    // the inset looks from the same direction as the main camera
    const dir = camera.position.clone().sub(controls.target).normalize();
    const c = toScene(inset.userData.centre), dist = 4.4;
    icam.position.copy(c).addScaledVector(dir, dist); icam.up.copy(camera.up); icam.lookAt(c);
    renderer.setScissorTest(true); renderer.setScissor(x, y, s, s); renderer.setViewport(x, y, s, s);
    renderer.setClearColor(color("--surface-1"), 1); renderer.clear();
    renderer.render(iscene, icam);
    renderer.setScissorTest(false);
    const pxPerUnit = s / (2 * dist * Math.tan(15 * Math.PI / 180));
    const bar = [0.1, 0.2, 0.5, ...NICE].filter((b) => b <= 0.6 * H).pop() ?? 0.1;
    frame.querySelector(".l3-scale span").textContent = `${bar} µm`;
    frame.querySelector(".l3-scale i").style.width = `${Math.round(bar / H * pxPerUnit)}px`;
  }

  new ResizeObserver(resize).observe(container);
  buildFixed(); setOrientation(); resize();

  return {
    /** p: {tx, ty (deg), pivot, dx, dy (mm), D (mm), lam_nm, a_nm}; marks the last result stale */
    setLens(p) { params = p; stale = true; rebuild(); },
    /** r: lens_trap result for the current lens */
    setResult(r) { result = r; stale = false; rebuild(); },
    setHorizontal(hz) { horizontal = hz; setOrientation(); this.resetCamera(); },
    resetCamera() {
      controls.target.copy(toScene([0, 0, 3.5]));
      camera.up.set(0, 1, 0);
      const t = controls.target;
      camera.position.set(t.x + (horizontal ? -6 : 9), t.y + (horizontal ? 7 : 3), t.z + 13);
      controls.update(); render();
    },
    themeChanged() { buildFixed(); rebuild(); },
  };
}
