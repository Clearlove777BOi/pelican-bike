import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
export const remap = (x, a, b, c, d) => lerp(c, d, clamp(invLerp(a, b, x)));
export const smoothstep = (a, b, x) => { const t = clamp(invLerp(a, b, x)); return t * t * (3 - 2 * t); };
export const smootherstep = (a, b, x) => { const t = clamp(invLerp(a, b, x)); return t * t * t * (t * (t * 6 - 15) + 10); };

export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t) => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export const easeOutElastic = (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1);

export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * Math.max(dt, 0)));

export function envelope(x, a, b, rise = 0.5, fall = 0.5) {
  return smoothstep(a, a + rise, x) * (1 - smoothstep(b - fall, b, x));
}

export function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rng(seed) { return mulberry32(typeof seed === 'string' ? hashStr(seed) : seed); }

export function hash1(n) {
  n = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1;
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const a = hash1(i * 7919 + seed * 104729) * 2 - 1;
  const b = hash1((i + 1) * 7919 + seed * 104729) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => hash1((a * 374761393 + b * 668265263 + seed * 1442695041) | 0);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const h = (a, b, c) => hash1((a * 374761393 + b * 668265263 + c * 2147483647 + seed * 1442695041) | 0);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c000 = h(xi, yi, zi), c100 = h(xi + 1, yi, zi), c010 = h(xi, yi + 1, zi), c110 = h(xi + 1, yi + 1, zi);
  const c001 = h(xi, yi, zi + 1), c101 = h(xi + 1, yi, zi + 1), c011 = h(xi, yi + 1, zi + 1), c111 = h(xi + 1, yi + 1, zi + 1);
  const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u), x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

export function fbm1(x, oct = 4, seed = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise1(x, seed + i * 17); n += a; x = x * 2.03 + 11.7; a *= 0.5; }
  return s / n;
}

export function fbm2(x, y, oct = 4, seed = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x, y, seed + i * 17); n += a; x = x * 2.03 + 11.7; y = y * 2.03 + 5.3; a *= 0.5; }
  return s / n;
}

export function fbm3(x, y, z, oct = 4, seed = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z, seed + i * 17); n += a; x = x * 2.03 + 11.7; y = y * 2.03 + 5.3; z = z * 2.03 + 3.1; a *= 0.5; }
  return s / n;
}

export function ridged2(x, y, oct = 4, seed = 0) {
  let s = 0, a = 0.5, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise2(x, y, seed + i * 23));
    n *= n * w; w = clamp(n * 1.7);
    s += a * n;
    x = x * 2.1 + 5.3; y = y * 2.1 + 1.9; a *= 0.5;
  }
  return s;
}

export function bsearch(arr, x, key = (e) => e) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (key(arr[m]) <= x) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

export function sampleKeys(keys, t, ease = 'smooth') {
  if (!keys || !keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  const i = bsearch(keys, t, (k) => k[0]);
  const k0 = keys[i], k1 = keys[i + 1];
  let u = invLerp(k0[0], k1[0], t);
  if (ease === 'step') return k0[1];
  if (ease === 'smooth') u = u * u * (3 - 2 * u);
  const v0 = k0[1], v1 = k1[1];
  if (Array.isArray(v0)) return v0.map((a, j) => lerp(a, v1[j], u));
  return lerp(v0, v1, u);
}

export function curve(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
  const m = new Array(n).fill(0);
  if (n > 1) {
    const d = [];
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const tau = 3 / Math.sqrt(s); m[i] = tau * a * d[i]; m[i + 1] = tau * b * d[i]; }
    }
  }
  const f = (t) => {
    if (!n) return 0;
    if (t <= xs[0]) return ys[0];
    if (t >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= t) lo = mid; else hi = mid; }
    const h = xs[hi] - xs[lo], u = (t - xs[lo]) / h;
    const h00 = (1 + 2 * u) * (1 - u) * (1 - u), h10 = u * (1 - u) * (1 - u);
    const h01 = u * u * (3 - 2 * u), h11 = u * u * (u - 1);
    return h00 * ys[lo] + h10 * h * m[lo] + h01 * ys[hi] + h11 * h * m[hi];
  };
  f.keys = keys;
  return f;
}

export function xorshift(seed) {
  let x = seed >>> 0 || 88172645;
  return function () {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

export function shuffle(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

export function makeTube(points, radius, tubular = 64, radial = 10, closed = false) {
  const curveObj = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]))), closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curveObj, tubular, radius, radial, closed);
}

export function tubeBetween(a, b, radius, radial = 8, target) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(radius, radius, Math.max(len, 1e-4), radial, 1, false);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const m = new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  if (target) { target.copy(g); return target; }
  return g;
}

export function taperBetween(a, b, r0, r1, radial = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, Math.max(len, 1e-4), radial, 1, false);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

export function mergeGeometries(list) {
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (const g of list) {
    const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
    const gi = g.index;
    const count = gi ? gi.count : gp.count;
    for (let i = 0; i < count; i++) {
      const k = gi ? gi.getX(i) : i;
      pos.push(gp.getX(k), gp.getY(k), gp.getZ(k));
      if (gn) nor.push(gn.getX(k), gn.getY(k), gn.getZ(k)); else nor.push(0, 1, 0);
      if (gu) uv.push(gu.getX(k), gu.getY(k)); else uv.push(0, 0);
    }
    for (let i = 0; i < count; i++) idx.push(base + i);
    base += count;
  }
  v.set(0, 0, 0); n.set(0, 1, 0);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

export function twoBoneIK(hip, target, l1, l2, bendSign, outKnee = new THREE.Vector3()) {
  const d = new THREE.Vector3().subVectors(target, hip);
  let len = d.length();
  const minLen = Math.abs(l1 - l2) + 1e-3;
  const maxLen = l1 + l2 - 1e-3;
  const clamped = clamp(len, minLen, maxLen);
  if (len > 1e-6) d.multiplyScalar(clamped / len);
  const dir = d.clone().normalize();
  const cosA = clamp((clamped * clamped + l1 * l1 - l2 * l2) / (2 * clamped * l1), -1, 1);
  const a = Math.acos(cosA);
  let axis = new THREE.Vector3(0, 0, 1);
  if (Math.abs(dir.dot(axis)) > 0.98) axis = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(dir, axis).normalize();
  const kneeDir = dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a) * bendSign);
  outKnee.copy(hip).addScaledVector(kneeDir, l1);
  return outKnee;
}

export function colorLerp(a, b, t) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return ca.lerp(cb, t);
}

export const srgb = (hex) => new THREE.Color(hex).convertSRGBToLinear();

export function formatInt(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
