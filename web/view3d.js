/* 3D view of the beam and the particle (visual aid).
 *
 * Renders the intensity |E|^2 (or |grad I|) computed by levtrap.api.field3d
 * as a glowing volume (ray marching through a 3D texture), with movable cut
 * planes that show the cross-section as a heat map, the particle drawn to
 * scale at its equilibrium, and optional force arrows.
 *
 * Loaded lazily by app.js with import("./view3d.js").
 * Scene units are micrometres; z (beam axis) points up.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const RAMP = [ // dark -> blue -> cyan -> white (sequential, one hue family)
  [0.0, [0.02, 0.03, 0.08]], [0.25, [0.06, 0.26, 0.51]], [0.5, [0.16, 0.47, 0.84]],
  [0.75, [0.53, 0.71, 0.94]], [1.0, [1.0, 1.0, 1.0]],
];
const GLSL_RAMP = `
vec3 ramp(float v) {
  vec3 c0 = vec3(${RAMP[0][1]}), c1 = vec3(${RAMP[1][1]}), c2 = vec3(${RAMP[2][1]}),
       c3 = vec3(${RAMP[3][1]}), c4 = vec3(${RAMP[4][1]});
  if (v < 0.25) return mix(c0, c1, v / 0.25);
  if (v < 0.5) return mix(c1, c2, (v - 0.25) / 0.25);
  if (v < 0.75) return mix(c2, c3, (v - 0.5) / 0.25);
  return mix(c3, c4, (v - 0.75) / 0.25);
}`;

const VOLUME_VERT = /* glsl */ `
out vec3 vOrigin;
out vec3 vDirection;
void main() {
  vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vDirection = position - vOrigin;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const VOLUME_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec3 vOrigin;
in vec3 vDirection;
out vec4 color;
uniform sampler3D uData;
uniform vec3 uHalf;        // box half-size (um)
uniform vec3 uClip;        // cut positions (um); 1e9 = no cut
uniform vec3 uSide;        // +1: hide coordinates above the cut, -1: below
uniform vec4 uSphere;      // xyz centre (um), w radius (um); w <= 0: none
uniform float uOpacity;
uniform float uGamma;
uniform float uThreshold;
uniform float uLog;
${GLSL_RAMP}
float tf(float v) { return uLog > 0.5 ? log(1.0 + 99.0 * v) / log(100.0) : v; }
vec2 hitBox(vec3 o, vec3 d) {
  vec3 inv = 1.0 / d;
  vec3 t0 = (-uHalf - o) * inv, t1 = (uHalf - o) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
void main() {
  vec3 d = normalize(vDirection);
  vec2 b = hitBox(vOrigin, d);
  if (b.x > b.y) discard;
  b.x = max(b.x, 0.0);
  // stop at the particle so it occludes what lies behind it
  if (uSphere.w > 0.0) {
    vec3 oc = vOrigin - uSphere.xyz;
    float bb = dot(oc, d), cc = dot(oc, oc) - uSphere.w * uSphere.w, h = bb * bb - cc;
    if (h > 0.0) { float ts = -bb - sqrt(h); if (ts > b.x) b.y = min(b.y, ts); }
  }
  float len = length(2.0 * uHalf);
  float dt = len / 260.0;
  vec4 acc = vec4(0.0);
  for (float t = b.x; t < b.y; t += dt) {
    vec3 p = vOrigin + t * d;
    if (any(greaterThan((p - uClip) * uSide, vec3(0.0)))) continue;
    float v = tf(texture(uData, p / (2.0 * uHalf) + 0.5).r);
    if (v < uThreshold) continue;
    float s = pow(v, uGamma);
    float a = clamp(s * uOpacity * dt / len * 40.0, 0.0, 1.0);
    vec3 c = ramp(s);
    acc.rgb += (1.0 - acc.a) * a * c;
    acc.a += (1.0 - acc.a) * a;
    if (acc.a > 0.97) break;
  }
  if (acc.a < 0.003) discard;
  color = acc;
}`;

const SLICE_VERT = /* glsl */ `
out vec3 vPos;
void main() {
  vPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
}`;
const SLICE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec3 vPos;
out vec4 color;
uniform sampler3D uData;
uniform vec3 uHalf;
uniform float uGamma;
uniform float uLog;
${GLSL_RAMP}
void main() {
  float v = texture(uData, vPos / (2.0 * uHalf) + 0.5).r;
  if (uLog > 0.5) v = log(1.0 + 99.0 * v) / log(100.0);
  color = vec4(ramp(pow(v, uGamma)), 1.0);
}`;

function b64ToU8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function createView(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  if (!renderer.capabilities.isWebGL2) throw new Error("WebGL2 is not available in this browser");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0d0f14, 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x202030, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, -4, 6);
  scene.add(sun);

  const half = new THREE.Vector3(1, 1, 1);
  const textures = {};
  let mode = "I";
  const volMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VOLUME_VERT, fragmentShader: VOLUME_FRAG,
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false,
    uniforms: {
      uData: { value: null }, uHalf: { value: half }, uClip: { value: new THREE.Vector3(1e9, 1e9, 1e9) },
      uSide: { value: new THREE.Vector3(1, 1, 1) },
      uSphere: { value: new THREE.Vector4(0, 0, 0, 0) }, uOpacity: { value: 0.6 },
      uGamma: { value: 1.4 }, uThreshold: { value: 0.02 }, uLog: { value: 1 },
    },
  });
  const volume = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), volMat);
  volume.renderOrder = 2;
  scene.add(volume);

  const sliceMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: SLICE_VERT, fragmentShader: SLICE_FRAG, side: THREE.DoubleSide,
    uniforms: { uData: { value: null }, uHalf: { value: half }, uGamma: { value: 1.4 }, uLog: { value: 1 } },
  });
  const slices = { x: null, y: null, z: null };
  const sliceGroup = new THREE.Group();
  scene.add(sliceGroup);

  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
    new THREE.LineBasicMaterial({ color: 0x5a6070 }));
  scene.add(box);

  const particle = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32),
    new THREE.MeshPhysicalMaterial({ color: 0xf2f4f8, emissive: 0x585c66, roughness: 0.2, metalness: 0.0,
      clearcoat: 1.0, clearcoatRoughness: 0.1, depthTest: false }));
  // drawn after the volume and always visible: it is the point of the picture
  particle.renderOrder = 3;
  scene.add(particle);

  const beamArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1, 0xeb6834);
  scene.add(beamArrow);
  const focusRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0x8a90a0, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
  scene.add(focusRing);
  let arrows = new THREE.Group();
  scene.add(arrows);

  const state = { clip: { x: null, y: null, z: null }, side: { x: 1, y: 1, z: 1 }, showParticle: true, showForces: true };
  const hidden = (ax, v) => state.clip[ax] !== null && (v - state.clip[ax]) * state.side[ax] > 0;

  function setTexture(key, b64, dims) {
    const tex = new THREE.Data3DTexture(b64ToU8(b64), dims[0], dims[1], dims[2]);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    if (textures[key]) textures[key].dispose();
    textures[key] = tex;
  }

  function rebuildSlices() {
    sliceGroup.clear();
    for (const ax of ["x", "y", "z"]) {
      const c = state.clip[ax];
      if (c === null) continue;
      // PlaneGeometry lies in xy; rotate it so its normal is the cut axis
      const w = ax === "x" ? 2 * half.z : 2 * half.x;
      const h = ax === "y" ? 2 * half.z : 2 * half.y;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sliceMat);
      if (ax === "x") { m.rotation.set(0, Math.PI / 2, 0); m.position.x = c; }
      if (ax === "y") { m.rotation.set(Math.PI / 2, 0, 0); m.position.y = c; }
      if (ax === "z") { m.position.z = c; }
      sliceGroup.add(m);
    }
    volMat.uniforms.uClip.value.set(
      state.clip.x === null ? 1e9 : state.clip.x,
      state.clip.y === null ? 1e9 : state.clip.y,
      state.clip.z === null ? 1e9 : state.clip.z);
    volMat.uniforms.uSide.value.set(state.side.x, state.side.y, state.side.z);
  }

  // remove the part of the volume between the cut and the camera, so the cut
  // face is always seen from the open side
  function updateSides() {
    let changed = false;
    for (const ax of ["x", "y", "z"]) {
      const c = state.clip[ax];
      const s = c === null ? 1 : (camera.position[ax] >= c ? 1 : -1);
      if (s !== state.side[ax]) { state.side[ax] = s; changed = true; }
    }
    if (changed) { rebuildSlices(); setForces(lastForces, lastSpacing); }
  }

  function setForces(f, spacing) {
    scene.remove(arrows);
    arrows = new THREE.Group();
    if (f) {
      const mags = f.vec.map((v) => Math.hypot(v[0], v[1], v[2]));
      const mmax = Math.max(...mags) || 1;
      const len = spacing * 0.8;
      const lo = new THREE.Color(0xd95926), hi = new THREE.Color(0xffd27a);
      f.pos.forEach((p, i) => {
        const m = mags[i];
        if (!(m > 0)) return;
        const pos = new THREE.Vector3(p[0] * 1e6, p[1] * 1e6, p[2] * 1e6);
        if (hidden("x", pos.x) || hidden("y", pos.y) || hidden("z", pos.z)) return;
        const dir = new THREE.Vector3(f.vec[i][0], f.vec[i][1], f.vec[i][2]).normalize();
        const t = Math.log10(1 + 9 * m / mmax); // 0..1, log-ish
        const col = lo.clone().lerp(hi, t);
        const a = new THREE.ArrowHelper(dir, pos.clone().addScaledVector(dir, -len / 2), len, col, len * 0.35, len * 0.22);
        arrows.add(a);
      });
    }
    arrows.visible = state.showForces;
    scene.add(arrows);
  }

  let lastForces = null;
  let lastSpacing = 1;

  function update(data) {
    half.set(data.bounds.x * 1e6, data.bounds.y * 1e6, data.bounds.z * 1e6);
    volume.geometry.dispose();
    volume.geometry = new THREE.BoxGeometry(2 * half.x, 2 * half.y, 2 * half.z);
    box.geometry.dispose();
    box.geometry = new THREE.EdgesGeometry(volume.geometry);
    setTexture("I", data.I, data.dims);
    setTexture("G", data.G, data.dims);
    setMode(mode);
    const r = data.radius * 1e6;
    const z0 = (data.z_eq ?? 0) * 1e6;
    particle.scale.setScalar(r);
    particle.position.set(0, 0, z0);
    volMat.uniforms.uSphere.value.set(0, 0, z0, state.showParticle ? r : 0);
    beamArrow.position.set(-half.x * 1.15, -half.y * 1.15, -half.z);
    beamArrow.setLength(2 * half.z, 0.18 * half.z, 0.08 * half.z);
    focusRing.scale.setScalar(Math.max(half.x, half.y) * 0.08);
    lastForces = data.forces || null;
    lastSpacing = data.forces ? (2 * half.x * 0.85) / 6 : 1;
    setForces(lastForces, lastSpacing);
    rebuildSlices();
  }

  function setMode(m) {
    mode = m;
    volMat.uniforms.uData.value = textures[m] || null;
    sliceMat.uniforms.uData.value = textures[m] || null;
  }

  function resetCamera() {
    const d = Math.max(half.x, half.y, half.z) * 3.4;
    camera.position.set(d * 0.75, -d * 0.95, d * 0.35);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let running = true;
  (function loop() {
    if (!running) return;
    controls.update();
    updateSides();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();

  return {
    update(data) { update(data); },
    resetCamera,
    setMode,
    setClip(ax, value) { state.clip[ax] = value; rebuildSlices(); setForces(lastForces, lastSpacing); },
    setOpacity(v) { volMat.uniforms.uOpacity.value = v; },
    setLog(on) { volMat.uniforms.uLog.value = on ? 1 : 0; sliceMat.uniforms.uLog.value = on ? 1 : 0; },
    setGamma(v) { volMat.uniforms.uGamma.value = v; sliceMat.uniforms.uGamma.value = v; },
    setParticle(on) {
      state.showParticle = on;
      particle.visible = on;
      volMat.uniforms.uSphere.value.w = on ? particle.scale.x : 0;
    },
    setForcesVisible(on) { state.showForces = on; arrows.visible = on; },
    dispose() { running = false; renderer.dispose(); },
  };
}
