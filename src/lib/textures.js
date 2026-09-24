import * as THREE from 'three';
import { clamp, lerp, smoothstep, fbm2, ridged2, noise2, rng } from './core.js';

function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d', { willReadFrequently: false }) };
}

function toTexture(canvas, { repeat = 1, srgb: isSrgb = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (isSrgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function heightToNormal(height, size, strength = 2) {
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * size + x) * 4;
      img.data[o] = (-dx * len * 0.5 + 0.5) * 255;
      img.data[o + 1] = (-dy * len * 0.5 + 0.5) * 255;
      img.data[o + 2] = (len * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function asphaltMaps(size = 512) {
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const h = new Float32Array(size * size);
  const r = rng('asphalt');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * 8, v = y / size * 8;
      const grain = fbm2(u * 6, v * 6, 4, 11);
      const grit = Math.pow(noise2(u * 34, v * 34, 5), 3);
      const patch = fbm2(u * 1.4, v * 1.4, 3, 3);
      const crack = 1 - Math.abs(fbm2(u * 3.1, v * 3.1, 3, 19) - 0.5) * 2;
      const crackline = Math.pow(clamp(crack), 14);
      let v0 = 0.24 + 0.2 * grain + 0.24 * grit - 0.06 * patch;
      v0 -= 0.16 * crackline;
      const o = (y * size + x) * 4;
      const k = clamp(v0);
      img.data[o] = k * 255 * 1.02;
      img.data[o + 1] = k * 255;
      img.data[o + 2] = k * 255 * 1.05;
      img.data[o + 3] = 255;
      h[y * size + x] = k + 0.5 * grit - 0.4 * crackline;
    }
  }
  g.putImageData(img, 0, 0);
  return {
    map: toTexture(c, { repeat: 1, srgb: true }),
    normalMap: toTexture(heightToNormal(h, size, 1.6), { repeat: 1 }),
  };
}

export function paintLineTexture(size = 128) {
  const { c, g } = canvas2d(size);
  g.fillStyle = '#efe7d8';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const r = rng('paint');
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 34;
    img.data[i] = clamp(img.data[i] + n, 0, 255);
    img.data[i + 1] = clamp(img.data[i + 1] + n, 0, 255);
    img.data[i + 2] = clamp(img.data[i + 2] + n * 0.8, 0, 255);
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(90,84,74,${0.05 + r() * 0.12})`;
    const w = 4 + r() * 26, hh = 2 + r() * 10;
    g.fillRect(r() * size, r() * size, w, hh);
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat: 1, srgb: true });
}

export function featherMaps(size = 512) {
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const h = new Float32Array(size * size);
  const CX = size / 2, CY = size * 0.5;
  const barbCount = 46;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - CX) / (size * 0.5);
      const dy = (y - CY) / (size * 0.5);
      const along = clamp(dy * 0.5 + 0.5);
      const across = dx / Math.max(0.16, 1 - along * 0.62);
      const taper = Math.pow(Math.sin(Math.PI * clamp(along * 0.94 + 0.03)), 0.62);
      const span = taper * 0.92;
      const inFeather = clamp((span - Math.abs(across)) / 0.05, 0, 1);
      const barb = Math.abs(Math.sin((across * barbCount * 0.5 + along * 0.6) * Math.PI));
      const barbMod = lerp(0.66, 1, Math.pow(barb, 0.7));
      const shaft = clamp(1 - Math.abs(across) / 0.035, 0, 1);
      const sheen = fbm2(across * 5 + 3, along * 12, 3, 7);
      const edgeFray = 1 - Math.pow(clamp(Math.abs(across) / Math.max(0.05, span)), 8) * 0.35;
      let v0 = inFeather * edgeFray * barbMod * (0.74 + 0.24 * sheen);
      v0 = lerp(v0, Math.min(1, v0 + 0.32), shaft);
      const o = (y * size + x) * 4;
      const base = v0;
      img.data[o] = clamp(base * 1.0) * 255;
      img.data[o + 1] = clamp(base * 0.99) * 255;
      img.data[o + 2] = clamp(base * 1.02) * 255;
      img.data[o + 3] = clamp(inFeather * 255);
      h[y * size + x] = v0 + shaft * 0.35;
    }
  }
  g.putImageData(img, 0, 0);
  return { map: toTexture(c, { repeat: 1, srgb: true }), height: h, normalMap: toTexture(heightToNormal(h, size, 1.1), { repeat: 1 }) };
}

function featerAlphaCanvas(size, opts) {
  const { c, g } = canvas2d(size);
  g.clearRect(0, 0, size, size);
  const r = rng(opts.seed || 'feather');
  const CX = size / 2;
  const barbs = opts.barbs || 44;
  const grad = g.createLinearGradient(0, size, 0, 0);
  grad.addColorStop(0, opts.tip || 'rgba(255,255,255,0.0)');
  grad.addColorStop(0.16, opts.mid || 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, opts.base || 'rgba(255,255,255,0.55)');
  g.fillStyle = grad;
  g.beginPath();
  for (let y = size; y >= 0; y--) {
    const along = 1 - y / size;
    const taper = Math.pow(Math.sin(Math.PI * clamp(along * 0.92 + 0.04)), 0.6);
    const span = taper * size * 0.47;
    const wob = (noise2(along * 9, 0, 3) - 0.5) * size * 0.012;
    g.lineTo(CX - span + wob, y);
  }
  for (let y = 0; y <= size; y++) {
    const along = 1 - y / size;
    const taper = Math.pow(Math.sin(Math.PI * clamp(along * 0.92 + 0.04)), 0.6);
    const span = taper * size * 0.47;
    const wob = (noise2(along * 9, 9, 3) - 0.5) * size * 0.012;
    g.lineTo(CX + span + wob, y);
  }
  g.closePath();
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = size * 0.004;
  for (let i = 0; i < barbs; i++) {
    const along = i / (barbs - 1);
    const y = size * (1 - along);
    const taper = Math.pow(Math.sin(Math.PI * clamp(along * 0.92 + 0.04)), 0.6);
    const span = taper * size * 0.47;
    g.beginPath();
    g.moveTo(CX, y);
    g.lineTo(CX - span * (0.96 + r() * 0.1), y - size * 0.022 * (0.6 + r() * 0.7));
    g.moveTo(CX, y);
    g.lineTo(CX + span * (0.96 + r() * 0.1), y - size * 0.022 * (0.6 + r() * 0.7));
    g.stroke();
  }
  for (let i = 0; i < 60; i++) {
    const along = r();
    const y = size * (1 - along);
    const taper = Math.pow(Math.sin(Math.PI * clamp(along * 0.92 + 0.04)), 0.6);
    const span = taper * size * (0.7 + r() * 0.32);
    g.beginPath();
    g.moveTo(CX + (r() < 0.5 ? -1 : 1) * span, y);
    g.lineTo(CX + (r() < 0.5 ? -1 : 1) * span * 0.82, y - size * 0.01 * r());
    g.lineWidth = size * (0.002 + r() * 0.004);
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  const shaft = g.createLinearGradient(0, size, 0, 0);
  shaft.addColorStop(0, 'rgba(0,0,0,1)');
  shaft.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = shaft;
  g.fillRect(CX - size * 0.006, 0, size * 0.012, size);
  return c;
}

export function featherAlpha(opts = {}) {
  const c = featerAlphaCanvas(opts.size || 512, opts);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function groundMaps(size = 1024) {
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const grass = fbm2(u * 20, v * 20, 4, 41);
      const clump = fbm2(u * 5.5, v * 5.5, 4, 9);
      const dry = smoothstep(0.42, 0.72, fbm2(u * 2.6, v * 2.6, 3, 61));
      const sand = clamp((v - 0.62) / 0.3, 0, 1);
      let rr = lerp(0.24, 0.42, grass) * lerp(0.72, 1.06, clump);
      let gg = lerp(0.31, 0.52, grass) * lerp(0.74, 1.08, clump);
      let bb = lerp(0.16, 0.24, grass) * lerp(0.7, 1.04, clump);
      rr = lerp(rr, 0.6, dry * 0.55); gg = lerp(gg, 0.52, dry * 0.5); bb = lerp(bb, 0.3, dry * 0.5);
      rr = lerp(rr, 0.72, sand); gg = lerp(gg, 0.66, sand); bb = lerp(bb, 0.5, sand);
      const o = (y * size + x) * 4;
      img.data[o] = clamp(rr) * 255;
      img.data[o + 1] = clamp(gg) * 255;
      img.data[o + 2] = clamp(bb) * 255;
      img.data[o + 3] = 255;
      h[y * size + x] = grass * 0.6 + clump * 0.5;
    }
  }
  g.putImageData(img, 0, 0);
  return {
    map: toTexture(c, { repeat: 1, srgb: true, aniso: 16 }),
    normalMap: toTexture(heightToNormal(h, size, 0.7), { repeat: 1, aniso: 16 }),
  };
}

export function woodMaps(size = 512) {
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const grain = Math.sin((v * 34 + fbm2(u * 2.6, v * 9, 4, 23) * 5.5) * Math.PI * 2);
      const rings = Math.pow(Math.abs(grain), 0.45);
      const fibre = fbm2(u * 40, v * 160, 3, 71);
      const tone = clamp(0.36 + 0.34 * rings + 0.14 * fibre);
      const o = (y * size + x) * 4;
      img.data[o] = tone * 232;
      img.data[o + 1] = tone * 186;
      img.data[o + 2] = tone * 132;
      img.data[o + 3] = 255;
      h[y * size + x] = rings * 0.5 + fibre * 0.5;
    }
  }
  g.putImageData(img, 0, 0);
  return {
    map: toTexture(c, { repeat: 1, srgb: true }),
    normalMap: toTexture(heightToNormal(h, size, 0.9), { repeat: 1 }),
  };
}

export function birdSkinMaps(size = 512) {
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const plume = fbm2(u * 26, v * 26, 4, 13);
      const soft = fbm2(u * 7, v * 7, 3, 31);
      const sheen = smoothstep(0.45, 0.8, fbm2(u * 3.2, v * 3.2, 3, 57));
      let rr = 0.86, gg = 0.87, bb = 0.9;
      rr = lerp(rr, 0.94, sheen); gg = lerp(gg, 0.94, sheen); bb = lerp(bb, 0.96, sheen);
      const grime = clamp(plume * 0.42 + soft * 0.3);
      rr = lerp(rr, 0.7, grime * 0.5);
      gg = lerp(gg, 0.71, grime * 0.5);
      bb = lerp(bb, 0.73, grime * 0.5);
      const o = (y * size + x) * 4;
      img.data[o] = clamp(rr) * 255;
      img.data[o + 1] = clamp(gg) * 255;
      img.data[o + 2] = clamp(bb) * 255;
      img.data[o + 3] = 255;
      h[y * size + x] = plume * 0.55 + soft * 0.45;
    }
  }
  g.putImageData(img, 0, 0);
  return {
    map: toTexture(c, { repeat: 1, srgb: true }),
    normalMap: toTexture(heightToNormal(h, size, 0.8), { repeat: 1 }),
  };
}

export function rubberMaps(size = 256) {
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const tread = Math.sin(u * Math.PI * 26);
      const block = clamp(Math.pow(Math.abs(tread), 0.4));
      const grain = fbm2(u * 30, v * 30, 3, 5);
      const shape = lerp(0.1, 0.3, block) + grain * 0.1;
      const o = (y * size + x) * 4;
      img.data[o] = shape * 255;
      img.data[o + 1] = shape * 255 * 1.01;
      img.data[o + 2] = shape * 255 * 1.03;
      img.data[o + 3] = 255;
      h[y * size + x] = block * 0.7 + grain * 0.3;
    }
  }
  g.putImageData(img, 0, 0);
  return { map: toTexture(c, { repeat: 1, srgb: true }), normalMap: toTexture(heightToNormal(h, size, 1.4), { repeat: 1 }) };
}

export function skyGradientTexture() {
  const { c, g } = canvas2d(256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.0, '#0b1a33');
  grd.addColorStop(0.34, '#255070');
  grd.addColorStop(0.56, '#6f8ba0');
  grd.addColorStop(0.72, '#d9a273');
  grd.addColorStop(0.84, '#f6c489');
  grd.addColorStop(1.0, '#fbe0bd');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.needsUpdate = true;
  return t;
}

export function foliageAlpha(size = 256, seed = 'foliage') {
  const { c, g } = canvas2d(size);
  g.clearRect(0, 0, size, size);
  const r = rng(seed);
  for (let i = 0; i < 190; i++) {
    const x = r() * size, y = r() * size;
    const rr = size * (0.012 + r() * 0.045);
    g.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
    g.beginPath();
    const pts = 5 + Math.floor(r() * 4);
    for (let k = 0; k < pts; k++) {
      const a = (k / pts) * Math.PI * 2 + r();
      const rad = rr * (0.6 + r() * 0.6);
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
