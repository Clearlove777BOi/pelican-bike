import * as THREE from 'three';
import {
  clamp, lerp, TAU, DEG, taperBetween, tubeBetween, mergeGeometries, makeTube, rng,
} from '../lib/core.js';
import { rubberMaps, woodMaps } from '../lib/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function torusRing(major, minor, seg = 96, tube = 16) {
  return new THREE.TorusGeometry(major, minor, tube, seg);
}

function spokeSet(count, hubR, rimR, thickness = 0.0022) {
  const list = [];
  const r = rng('spokes');
  for (let i = 0; i < count; i++) {
    const a0 = (i / count) * TAU;
    const a1 = a0 + Math.PI + (r() - 0.5) * 0.24;
    const flange = i % 2 === 0 ? 0.028 : -0.028;
    const p0 = V(Math.cos(a0) * hubR, Math.sin(a0) * hubR, flange);
    const p1 = V(Math.cos(a1) * rimR, Math.sin(a1) * rimR, 0);
    const g = taperBetween(p0, p1, thickness, thickness * 0.62, 5);
    list.push(g);
  }
  return mergeGeometries(list);
}

function rimGeometry(radius, depth, width, seg = 96) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -depth / 2);
  shape.lineTo(width / 2, -depth / 2);
  shape.lineTo(width / 2 * 0.86, depth / 2);
  shape.lineTo(-width / 2 * 0.86, depth / 2);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0, bevelEnabled: false, steps: 1 });
  const ring = [];
  const pos = g.attributes.position;
  const n = pos.count;
  const out = new THREE.BufferGeometry();
  const arr = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < n; k++) {
      const x = pos.getX(k), y = pos.getY(k);
      arr.push(c * (radius + y), s * (radius + y), x);
    }
  }
  const M = n;
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < M; k++) {
      const k2 = (k + 1) % M;
      const a = i * M + k, b = (i + 1) * M + k, c = (i + 1) * M + k2, d = i * M + k2;
      idx.push(a, b, c, a, c, d);
    }
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  g.dispose();
  return out;
}

function hubGeometry(flangeR = 0.032, width = 0.06, axleR = 0.009, freehub = false, cogCount = 7) {
  const parts = [];
  parts.push(new THREE.CylinderGeometry(0.017, 0.019, width * 0.72, 20).rotateZ(Math.PI / 2));
  parts.push(new THREE.CylinderGeometry(flangeR, flangeR * 0.94, 0.006, 24).rotateZ(Math.PI / 2).translate(-width * 0.34, 0, 0));
  parts.push(new THREE.CylinderGeometry(flangeR, flangeR * 0.94, 0.006, 24).rotateZ(Math.PI / 2).translate(width * 0.34, 0, 0));
  parts.push(new THREE.CylinderGeometry(axleR, axleR, width * 1.4, 12).rotateZ(Math.PI / 2));
  if (freehub) {
    parts.push(new THREE.CylinderGeometry(0.028, 0.026, 0.05, 20).rotateZ(Math.PI / 2).translate(width * 0.52, 0, 0));
    for (let i = 0; i < cogCount; i++) {
      const r = 0.05 + (i / (cogCount - 1)) * 0.062;
      const cog = new THREE.CylinderGeometry(r, r, 0.0032, 30).rotateZ(Math.PI / 2).translate(width * 0.52 + 0.028 + i * 0.0062, 0, 0);
      parts.push(cog);
    }
  }
  return mergeGeometries(parts);
}

function crankArmGeometry(len, w, h) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w * 0.36, len);
  shape.lineTo(-w * 0.44, len);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: h * 0.32, bevelSize: h * 0.34, bevelSegments: 2, steps: 1 });
  g.translate(0, 0, -h / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function chainRingGeometry(teeth, pitchR, thickness = 0.004) {
  const parts = [];
  parts.push(new THREE.CylinderGeometry(pitchR * 0.88, pitchR * 0.88, thickness, 48).rotateZ(Math.PI / 2));
  const toothGeo = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU;
    const g = new THREE.BoxGeometry(thickness, 0.009, 0.006);
    g.translate(pitchR, 0, 0);
    g.rotateX(a);
    toothGeo.push(g);
  }
  parts.push(mergeGeometries(toothGeo));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const g = new THREE.BoxGeometry(thickness * 1.2, pitchR * 0.78, 0.01);
    g.translate(pitchR * 0.44, 0, 0);
    g.rotateX(a);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

export function createBicycle(opts = {}) {
  const rubber = rubberMaps(256);
  const wood = woodMaps(512);
  const group = new THREE.Group();
  group.name = 'bicycle';

  const matFrame = new THREE.MeshStandardMaterial({ color: 0x8c3a2e, roughness: 0.32, metalness: 0.55, envMapIntensity: 1.1 });
  const matFrameAccent = new THREE.MeshStandardMaterial({ color: 0xe0c9a6, roughness: 0.38, metalness: 0.3 });
  const matTire = new THREE.MeshStandardMaterial({
    map: rubber.map, normalMap: rubber.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    color: 0x2a2c30, roughness: 0.86, metalness: 0.02,
  });
  const matRim = new THREE.MeshStandardMaterial({ color: 0xd6d2c8, roughness: 0.22, metalness: 0.92, envMapIntensity: 1.4 });
  const matSpoke = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.2, metalness: 0.95, envMapIntensity: 1.6 });
  const matHub = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.24, metalness: 0.9, envMapIntensity: 1.5 });
  const matChrome = new THREE.MeshStandardMaterial({ color: 0xe4e6e8, roughness: 0.12, metalness: 1.0, envMapIntensity: 1.8 });
  const matLeather = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, color: 0x8a5a34, roughness: 0.52, metalness: 0.03 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.25 });
  const matRack = new THREE.MeshStandardMaterial({ map: wood.map, color: 0xb98a52, roughness: 0.5, metalness: 0.05 });
  const matBasket = new THREE.MeshStandardMaterial({ color: 0xa8794a, roughness: 0.72, metalness: 0.02 });
  const matGlass = new THREE.MeshPhysicalMaterial({ color: 0xfff2d8, roughness: 0.08, metalness: 0.0, transmission: 0.55, emissive: 0xffd9a0, emissiveIntensity: 0.35 });

  const RB = 0.335;
  const frontHub = V(RB, RB, 0);
  const rearHub = V(-RB, RB, 0);

  const bb = V(0.02, 0.278, 0);
  const seatTop = V(-0.055, 0.62, 0);
  const headTop = V(0.30, 0.588, 0);
  const headBottom = V(0.375, 0.40, 0);

  const chainRingR = 0.098;
  const cogR = 0.052;
  const rearAxleY = RB;

  const frameParts = [];
  const tubeR = 0.0175;
  const topTube = taperBetween(V(seatTop.x, seatTop.y - 0.02, 0), V(headTop.x - 0.012, headTop.y - 0.016, 0), tubeR, tubeR * 0.94, 12);
  frameParts.push(topTube);
  const downTube = taperBetween(V(bb.x + 0.012, bb.y + 0.006, 0), V(headBottom.x - 0.01, headBottom.y + 0.006, 0), tubeR * 1.16, tubeR * 0.9, 12);
  frameParts.push(downTube);
  const seatTube = taperBetween(V(bb.x, bb.y, 0), V(seatTop.x, seatTop.y, 0), tubeR * 1.12, tubeR * 0.82, 12);
  frameParts.push(seatTube);
  for (const s of [-1, 1]) {
    const chainstay = taperBetween(V(bb.x + 0.01, bb.y, s * 0.028), V(rearHub.x, rearHub.y, s * 0.03), tubeR * 0.66, tubeR * 0.4, 10);
    const seatstay = taperBetween(V(seatTop.x, seatTop.y - 0.03, s * 0.024), V(rearHub.x, rearHub.y, s * 0.03), tubeR * 0.56, tubeR * 0.38, 10);
    frameParts.push(chainstay, seatstay);
  }
  const headTube = taperBetween(V(headTop.x, headTop.y - 0.05, 0), V(headBottom.x, headBottom.y + 0.005, 0), tubeR * 1.2, tubeR * 1.1, 12);
  frameParts.push(headTube);
  const forkCrown = new THREE.CylinderGeometry(tubeR * 1.35, tubeR * 1.15, 0.026, 16);
  forkCrown.translate(headBottom.x, headBottom.y - 0.006, 0);
  frameParts.push(forkCrown);
  for (const s of [-1, 1]) {
    const blade = makeTube([
      V(headBottom.x, headBottom.y - 0.012, s * 0.012),
      V(headBottom.x + 0.022, headBottom.y - 0.1, s * 0.036),
      V(frontHub.x - 0.006, frontHub.y + 0.055, s * 0.045),
      V(frontHub.x, frontHub.y, s * 0.042),
    ], 0.0092, 18, 8);
    frameParts.push(blade);
    const drop = taperBetween(V(frontHub.x, frontHub.y, s * 0.042), V(frontHub.x - 0.012, frontHub.y - 0.028, s * 0.042), 0.009, 0.007, 8);
    frameParts.push(drop);
  }
  for (const s of [-1, 1]) {
    const bridge = taperBetween(V(rearHub.x, rearHub.y, s * 0.03), V(rearHub.x + 0.02, rearHub.y, s * 0.024), 0.007, 0.007, 8);
    frameParts.push(bridge);
  }
  const bbShell = new THREE.CylinderGeometry(0.028, 0.028, 0.072, 20).rotateZ(Math.PI / 2);
  bbShell.translate(bb.x, bb.y, 0);
  frameParts.push(bbShell);
  const headBadge = new THREE.CylinderGeometry(tubeR * 1.24, tubeR * 1.24, 0.02, 16).rotateZ(Math.PI / 2);
  headBadge.translate(headTop.x - 0.004, headTop.y - 0.032, 0);
  const frameStrut = mergeGeometries(frameParts);
  const frameMesh = new THREE.Mesh(frameStrut, matFrame);
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  group.add(frameMesh);

  const badge = new THREE.Mesh(headBadge, matFrameAccent);
  badge.castShadow = true;
  group.add(badge);

  for (const s of [-1, 1]) {
    const brake = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.006, 6, 40, Math.PI * 0.36), matChrome);
    brake.position.set(frontHub.x, frontHub.y, s * 0.028);
    brake.rotation.z = Math.PI * 0.32;
    group.add(brake);
    const brakeR = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.006, 6, 40, Math.PI * 0.36), matChrome);
    brakeR.position.set(rearHub.x, rearHub.y, s * 0.028);
    brakeR.rotation.z = Math.PI * 0.32;
    group.add(brakeR);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.026), matDark);
    pad.position.set(frontHub.x + 0.32, frontHub.y + 0.12, s * 0.03);
    group.add(pad);
    const padR = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.026), matDark);
    padR.position.set(rearHub.x + 0.32, rearHub.y + 0.12, s * 0.03);
    group.add(padR);
  }

  function buildWheel(pos, freehub) {
    const wheel = new THREE.Group();
    wheel.position.copy(pos);
    const tire = new THREE.Mesh(new THREE.TorusGeometry(RB - 0.022, 0.0235, 18, 120), matTire);
    tire.castShadow = true;
    tire.receiveShadow = true;
    wheel.add(tire);
    const rim = new THREE.Mesh(rimGeometry(RB - 0.038, 0.026, 0.028, 96), matRim);
    rim.castShadow = true;
    wheel.add(rim);
    const hub = new THREE.Mesh(hubGeometry(undefined, undefined, undefined, freehub), matHub);
    hub.castShadow = true;
    wheel.add(hub);
    const spokes = new THREE.Mesh(spokeSet(36, 0.03, RB - 0.04), matSpoke);
    wheel.add(spokes);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8), matChrome);
    valve.position.set(0, RB - 0.052, 0);
    wheel.add(valve);
    return wheel;
  }

  const wheelFront = buildWheel(frontHub, false);
  wheelFront.name = 'wheelFront';
  group.add(wheelFront);
  const wheelRear = buildWheel(rearHub, true);
  wheelRear.name = 'wheelRear';
  group.add(wheelRear);

  const chainRing = new THREE.Mesh(chainRingGeometry(48, chainRingR), matChrome);
  const chainRingPivot = new THREE.Group();
  chainRingPivot.position.copy(bb);
  chainRingPivot.add(chainRing);
  group.add(chainRingPivot);

  const cogMesh = new THREE.Mesh(chainRingGeometry(16, cogR, 0.004), matChrome);
  const cogPivot = new THREE.Group();
  cogPivot.position.set(rearHub.x, rearHub.y, 0.052);
  cogPivot.add(cogMesh);
  group.add(cogPivot);

  const CRANK_LEN = 0.115;
  const crankL = new THREE.Mesh(crankArmGeometry(CRANK_LEN, 0.03, 0.013), matChrome);
  const crankLGroup = new THREE.Group();
  crankLGroup.position.copy(bb);
  crankLGroup.add(crankL);
  crankL.position.z = -0.046;
  crankL.rotation.x = 0;
  group.add(crankLGroup);

  const crankR = new THREE.Mesh(crankArmGeometry(CRANK_LEN, 0.03, 0.013), matChrome);
  const crankRGroup = new THREE.Group();
  crankRGroup.position.copy(bb);
  crankRGroup.add(crankR);
  crankR.position.z = 0.046;
  group.add(crankRGroup);

  const pedalL = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.014, 0.048), matDark);
  const pedalLGroup = new THREE.Group();
  pedalLGroup.add(pedalL);
  crankLGroup.add(pedalLGroup);
  const pedalR = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.014, 0.048), matDark);
  const pedalRGroup = new THREE.Group();
  pedalRGroup.add(pedalR);
  crankRGroup.add(pedalRGroup);

  const chainPaths = [];
  const chainN = 90;
  const chainPoints = [];
  const topRun = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = lerp(bb.x + chainRingR * 0.92, rearHub.x + cogR * 0.92, t);
    const y = lerp(bb.y + 0.002, rearHub.y + 0.004, t) + Math.sin(t * Math.PI) * 0.006;
    topRun.push(V(x, y, 0.052));
  }
  const bottomRun = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = lerp(rearHub.x + cogR * 0.92, bb.x + chainRingR * 0.92, t);
    const y = lerp(rearHub.y - 0.006, bb.y - 0.008, t) - Math.sin(t * Math.PI) * 0.01;
    bottomRun.push(V(x, y, 0.052));
  }
  const chainGeo = mergeGeometries([
    ...topRun.slice(0, -1).map((p, i) => tubeBetween(p, topRun[i + 1], 0.0032, 5)),
    ...bottomRun.slice(0, -1).map((p, i) => tubeBetween(p, bottomRun[i + 1], 0.0032, 5)),
  ]);
  const chain = new THREE.Mesh(chainGeo, matDark);
  group.add(chain);
  chain.visible = true;

  const seatPost = new THREE.Mesh(taperBetween(V(seatTop.x, seatTop.y - 0.06, 0), V(seatTop.x, seatTop.y + 0.09, 0), 0.0125, 0.0115, 12), matChrome);
  seatPost.castShadow = true;
  group.add(seatPost);

  const saddleShape = new THREE.Shape();
  saddleShape.moveTo(-0.115, -0.055);
  saddleShape.bezierCurveTo(-0.04, -0.075, 0.06, -0.062, 0.108, -0.03);
  saddleShape.bezierCurveTo(0.13, -0.012, 0.128, 0.026, 0.1, 0.046);
  saddleShape.bezierCurveTo(0.03, 0.072, -0.06, 0.062, -0.115, 0.03);
  saddleShape.bezierCurveTo(-0.128, 0.012, -0.128, -0.04, -0.115, -0.055);
  const saddleGeo = new THREE.ExtrudeGeometry(saddleShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 3, steps: 1, curveSegments: 12 });
  saddleGeo.rotateX(Math.PI / 2);
  saddleGeo.translate(seatTop.x + 0.045, seatTop.y + 0.108, 0);
  const saddle = new THREE.Mesh(saddleGeo, matLeather);
  saddle.castShadow = true;
  saddle.receiveShadow = true;
  group.add(saddle);

  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 10), matChrome);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(seatTop.x + 0.012, seatTop.y + 0.082, s * 0.028);
    group.add(rail);
  }

  const stem = new THREE.Mesh(taperBetween(V(headTop.x, headTop.y - 0.008, 0), V(headTop.x + 0.032, headTop.y + 0.03, 0), 0.0145, 0.0132, 12), matFrame);
  stem.castShadow = true;
  group.add(stem);

  const handlebar = new THREE.Group();
  handlebar.name = 'handlebar';
  const barCenter = V(headTop.x + 0.062, headTop.y + 0.062, 0);
  const barParts = [];
  barParts.push(tubeBetween(V(barCenter.x, barCenter.y, -0.03), V(barCenter.x, barCenter.y, 0.03), 0.0155, 12));
  for (const s of [-1, 1]) {
    const swept = makeTube([
      V(barCenter.x, barCenter.y, s * 0.03),
      V(barCenter.x + 0.048, barCenter.y + 0.004, s * 0.14),
      V(barCenter.x + 0.036, barCenter.y - 0.012, s * 0.235),
      V(barCenter.x - 0.024, barCenter.y - 0.02, s * 0.262),
    ], 0.0152, 26, 10);
    barParts.push(swept);
    const grip = makeTube([
      V(barCenter.x - 0.024, barCenter.y - 0.02, s * 0.262),
      V(barCenter.x - 0.058, barCenter.y - 0.022, s * 0.264),
    ], 0.0175, 10, 10);
    barParts.push(grip);
  }
  const barMesh = new THREE.Mesh(mergeGeometries(barParts), matChrome);
  barMesh.castShadow = true;
  handlebar.add(barMesh);
  group.add(handlebar);

  const gripLeftLocal = V(barCenter.x - 0.048, barCenter.y - 0.022, -0.264);
  const gripRightLocal = V(barCenter.x - 0.048, barCenter.y - 0.022, 0.264);

  const headlamp = new THREE.Group();
  headlamp.position.set(headTop.x + 0.078, headTop.y - 0.006, 0);
  const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.062, 20), matFrame);
  lampBody.rotation.z = Math.PI / 2;
  lampBody.castShadow = true;
  headlamp.add(lampBody);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.031, 24), matGlass);
  lens.position.set(0.032, 0, 0);
  lens.rotation.y = Math.PI / 2;
  headlamp.add(lens);
  const lampRing = new THREE.Mesh(new THREE.TorusGeometry(0.0325, 0.004, 8, 24), matChrome);
  lampRing.position.set(0.03, 0, 0);
  lampRing.rotation.y = Math.PI / 2;
  headlamp.add(lampRing);
  group.add(headlamp);
  const headLight = new THREE.SpotLight(0xffd7a0, 0, 26, 0.36, 0.55, 1.4);
  headLight.position.set(0.05, 0, 0);
  headLight.target.position.set(6, -0.4, 0);
  headlamp.add(headLight);
  headlamp.add(headLight.target);

  const rearStem = new THREE.Mesh(taperBetween(V(seatTop.x, seatTop.y - 0.05, 0), V(seatTop.x - 0.05, seatTop.y - 0.062, 0), 0.01, 0.009, 10), matChrome);
  group.add(rearStem);

  const basket = new THREE.Group();
  basket.name = 'basket';
  basket.position.set(headTop.x + 0.13, headTop.y - 0.055, 0);
  const basketParts = [];
  const bw = 0.15, bh = 0.115, bd = 0.13;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const y = lerp(-bh / 2, bh / 2, t);
    const w = bw * lerp(0.82, 1.0, t), d = bd * lerp(0.82, 1.0, t);
    const ringPts = [];
    const N = 26;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * TAU;
      ringPts.push(V(Math.cos(a) * w * 0.5, y, Math.sin(a) * d * 0.5));
    }
    basketParts.push(makeTube(ringPts, 0.0042, N, 6, false));
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    const x = Math.cos(a) * bw * 0.48, z = Math.sin(a) * bd * 0.48;
    const g = tubeBetween(V(x * 0.86, -bh / 2, z * 0.86), V(x, bh / 2, z), 0.0038, 6);
    basketParts.push(g);
  }
  const basketMesh = new THREE.Mesh(mergeGeometries(basketParts), matBasket);
  basketMesh.castShadow = true;
  basket.add(basketMesh);
  group.add(basket);

  const rack = new THREE.Group();
  rack.name = 'rack';
  const rackParts = [];
  const rackY = RB + 0.11;
  for (const z of [-0.062, 0.062]) {
    rackParts.push(tubeBetween(V(rearHub.x + 0.03, rackY, z), V(seatTop.x - 0.03, rackY, z), 0.006, 6));
    rackParts.push(tubeBetween(V(rearHub.x + 0.012, rearHub.y + 0.02, z * 0.6), V(rearHub.x + 0.06, rackY, z), 0.006, 6));
    rackParts.push(tubeBetween(V(seatTop.x - 0.05, seatTop.y - 0.06, z), V(seatTop.x - 0.02, rackY, z), 0.005, 6));
  }
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    rackParts.push(tubeBetween(
      V(lerp(rearHub.x + 0.03, seatTop.x - 0.03, t), rackY, -0.072),
      V(lerp(rearHub.x + 0.03, seatTop.x - 0.03, t), rackY, 0.072),
      0.0042, 5,
    ));
  }
  const rackMesh = new THREE.Mesh(mergeGeometries(rackParts), matRack);
  rackMesh.castShadow = true;
  rack.add(rackMesh);
  group.add(rack);

  const crate = new THREE.Group();
  crate.name = 'crate';
  crate.position.set(rearHub.x + 0.12, rackY + 0.085, 0);
  const crateParts = [];
  const cw = 0.24, ch = 0.17, cd = 0.2;
  const plankT = 0.008;
  for (const z of [-cd / 2, cd / 2]) {
    for (let i = 0; i < 3; i++) {
      const y = -ch / 2 + 0.03 + i * 0.055;
      const p = new THREE.BoxGeometry(cw, plankT * 3.2, plankT);
      p.translate(0, y, z);
      crateParts.push(p);
    }
  }
  for (const x of [-cw / 2, cw / 2]) {
    for (let i = 0; i < 3; i++) {
      const y = -ch / 2 + 0.03 + i * 0.055;
      const p = new THREE.BoxGeometry(plankT, plankT * 3.2, cd);
      p.translate(x, y, 0);
      crateParts.push(p);
    }
  }
  const bottom = new THREE.BoxGeometry(cw, plankT, cd);
  bottom.translate(0, -ch / 2, 0);
  crateParts.push(bottom);
  for (const z of [-cd / 2, cd / 2]) for (const x of [-cw / 2, cw / 2]) {
    const post = new THREE.BoxGeometry(plankT * 1.4, ch, plankT * 1.6);
    post.translate(x, 0, z);
    crateParts.push(post);
  }
  for (const z of [-cd / 2, cd / 2]) {
    const cap = new THREE.BoxGeometry(cw + plankT, plankT * 1.6, plankT * 1.6);
    cap.translate(0, ch / 2, z);
    crateParts.push(cap);
  }
  const crateMesh = new THREE.Mesh(mergeGeometries(crateParts), matRack);
  crateMesh.castShadow = true;
  crateMesh.receiveShadow = true;
  crate.add(crateMesh);
  group.add(crate);

  const bell = new THREE.Group();
  bell.position.set(barCenter.x + 0.02, barCenter.y + 0.008, -0.09);
  const bellDome = new THREE.Mesh(new THREE.SphereGeometry(0.024, 20, 12, 0, TAU, 0, Math.PI * 0.55), matChrome);
  bellDome.castShadow = true;
  bell.add(bellDome);
  const bellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.008, 20), matDark);
  bell.add(bellBase);
  group.add(bell);

  const fender = new THREE.Group();
  fender.name = 'fender';
  for (const [pos, rot] of [[frontHub, 0], [rearHub, 0]]) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(RB - 0.016, 0.008, 6, 60, Math.PI * 0.72), matFrame);
    f.position.copy(pos);
    f.position.y += 0.012;
    f.rotation.z = Math.PI * 0.14;
    f.rotation.y = Math.PI / 2;
    fender.add(f);
  }
  group.add(fender);

  const lightFrontLocal = V(headTop.x + 0.11, headTop.y - 0.006, 0);
  const lightRearLocal = V(seatTop.x - 0.062, seatTop.y - 0.052, 0);

  const rearLamp = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff4436, emissive: 0x881108, emissiveIntensity: 0.8, roughness: 0.25 }));
  rearLamp.position.copy(lightRearLocal);
  group.add(rearLamp);

  const fw = RB + 0.0235;
  const contactFront = V(frontHub.x, 0, 0);
  const contactRear = V(rearHub.x, 0, 0);

  const geoRefs = { frontHub, rearHub, bb, seatTop, headTop, barCenter };

  function setCrankAngle(theta) {
    crankLGroup.rotation.z = theta;
    pedalLGroup.position.set(0, 0, 0);
    pedalL.position.set(0, 0, 0);
    const lLocal = V(0, CRANK_LEN, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), theta);
    pedalLGroup.position.copy(lLocal);
    const rLocal = V(0, CRANK_LEN, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), theta + Math.PI);
    pedalRGroup.position.copy(rLocal);
    chainRingPivot.rotation.z = theta;
    cogPivot.rotation.z = theta * (chainRingR / cogR) * 0.02;
    return {
      left: V(bb.x, bb.y, -0.046).add(lLocal),
      right: V(bb.x, bb.y, 0.046).add(rLocal),
    };
  }

  function setSpeedWheelSpin(spin) {
    wheelFront.rotation.z = spin;
    wheelRear.rotation.z = spin;
  }

  function update(t, dt, ctx) {
    const speed = ctx.speed || 0;
    const pedalPhase = ctx.pedalPhase || 0;
    const theta = pedalPhase * TAU;
    const targets = setCrankAngle(theta);
    const wheelSpin = (ctx.wheelSpin || 0) * TAU;
    setSpeedWheelSpin(wheelSpin);
    handlebar.rotation.z = (ctx.steer || 0) * 0.5;
    handlebar.rotation.y = (ctx.steer || 0) * 0.18;
    group.position.y = (ctx.bounce || 0);
    group.rotation.z = (ctx.tilt || 0);
    group.rotation.y = (ctx.headingFix || 0);
    return {
      pedalTargets: targets,
      gripLeft: gripLeftLocal.clone().applyMatrix4(group.matrixWorld),
      gripRight: gripRightLocal.clone().applyMatrix4(group.matrixWorld),
    };
  }

  group.updateMatrixWorld(true);

  return {
    group, materials: { matFrame, matChrome, matTire, matRim, matSpoke, matHub, matLeather, matDark, matGlass },
    geo: geoRefs,
    wheels: { front: wheelFront, rear: wheelRear },
    lights: { headLight, rearLamp, headlamp, lens },
    contact: { front: contactFront, rear: contactRear, radius: fw },
    update,
    setCrankAngle,
    RB,
    CRANK_LEN,
  };
}
