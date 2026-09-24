import * as THREE from 'three';
import {
  clamp, lerp, smoothstep, noise1, noise2, noise3, rng, TAU, DEG,
  easeInOutSine, taperBetween, mergeGeometries, twoBoneIK, fbm2,
} from '../lib/core.js';
import { featherAlpha, birdSkinMaps, featherMaps } from '../lib/textures.js';

const UP = new THREE.Vector3(0, 1, 0);

function aimSegment(group, dir, out = new THREE.Quaternion()) {
  out.setFromUnitVectors(UP, dir.clone().normalize());
  group.quaternion.copy(out);
  return out;
}

function makeSegment(len, r0, r1, radial = 12, bend = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 6, false);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = clamp(y / Math.max(len, 1e-5));
    const b = bend * Math.sin(t * Math.PI);
    p.setX(i, p.getX(i) + b);
    p.setY(i, y);
  }
  g.computeVertexNormals();
  return g;
}

function ellipsoid(rx, ry, rz, ws = 24, hs = 18, noiseAmt = 0, seed = 0) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noiseAmt ? 1 + noiseAmt * (fbm2(x * 2.4 + seed, y * 2.1 + z * 1.7, 3, seed | 0) - 0.5) * 2 : 1;
    p.setXYZ(i, x * rx * n, y * ry * n, z * rz * n);
  }
  g.computeVertexNormals();
  return g;
}

function beakProfile(t) {
  const s = [
    [0.0, 0.062, 0.05], [0.06, 0.056, 0.046], [0.16, 0.045, 0.038],
    [0.32, 0.034, 0.03], [0.5, 0.026, 0.024], [0.7, 0.019, 0.019],
    [0.86, 0.013, 0.014], [1.0, 0.006, 0.007],
  ];
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const u = (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return [
        lerp(s[i - 1][1], s[i][1], u),
        lerp(s[i - 1][2], s[i][2], u),
      ];
    }
  }
  return [s[s.length - 1][1], s[s.length - 1][2]];
}

function buildUpperMandible(len) {
  const NX = 30, NR = 14;
  const pos = [], idx = [], uv = [];
  for (let i = 0; i <= NX; i++) {
    const t = i / NX;
    const [ry, rz] = beakProfile(t);
    const y = 0.012 + 0.004 * (1 - t);
    for (let j = 0; j <= NR; j++) {
      const a = (j / NR) * Math.PI;
      const taper = Math.pow(Math.sin(Math.PI * clamp(t * 0.96 + 0.04)), 0.5);
      const arch = 1 - 0.55 * Math.pow(Math.abs(Math.cos(a)), 2);
      const px = Math.sin(a) * rz * taper * (i > NX - 2 ? 0.2 : 1);
      const py = lerp(y, y + ry * arch, 1) - Math.cos(a) * ry * 0.55;
      const x = len * t;
      pos.push(x, py, px);
      uv.push(t, j / NR);
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NR; j++) {
      const a = i * (NR + 1) + j, b = a + NR + 1, c = a + 1, d = b + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildPouch(len) {
  const NX = 34, NA = 22;
  const pos = [], idx = [], uv = [], base = [], inf = [];
  for (let i = 0; i <= NX; i++) {
    const t = i / NX;
    const [ry, rz] = beakProfile(t);
    const along = smoothstep(0.02, 0.5, t) * (1 - smoothstep(0.82, 1.0, t));
    const dropMax = 0.135;
    const roomMax = 1.62;
    for (let j = 0; j <= NA; j++) {
      const a = (j / NA) * Math.PI - Math.PI / 2;
      const s = Math.cos(a), c = Math.sin(a);
      const xv = len * t;
      const yv = -0.006 - Math.abs(c) * 0.004;
      const zv = s * rz * 0.94;
      base.push(xv, yv, zv);
      const drop = dropMax * along * Math.pow(Math.abs(c), 0.62);
      const widen = 1 + (roomMax - 1) * along * Math.pow(Math.abs(s), 0.8);
      inf.push(xv, yv - drop - 0.004 * along, zv * widen);
      uv.push(t, j / NA);
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NA; j++) {
      const a = i * (NA + 1) + j, b = a + NA + 1, c = a + 1, d = b + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
  g.setAttribute('aInflate', new THREE.Float32BufferAttribute(inf, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.basePos = new Float32Array(base);
  g.userData.infPos = new Float32Array(inf);
  return g;
}

function buildFeatherGeo(w, l, curve = 0.12, segs = 6) {
  const g = new THREE.PlaneGeometry(w, l, 1, segs);
  g.translate(0, l / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = clamp(y / l);
    p.setZ(i, p.getZ(i) + curve * l * t * t);
    p.setX(i, p.getX(i) * (1 - 0.15 * t));
  }
  g.computeVertexNormals();
  return g;
}

export function createPelican(renderer) {
  const skin = birdSkinMaps(512);
  const featherTex = featherMaps(512);
  const alphaPrim = featherAlpha({ seed: 'primary', barbs: 40, size: 512 });
  const alphaSec = featherAlpha({ seed: 'secondary', barbs: 52, size: 512, mid: 'rgba(255,255,255,0.85)' });
  const alphaTail = featherAlpha({ seed: 'tail', barbs: 34, size: 512, mid: 'rgba(255,255,255,0.8)' });
  const alphaBody = featherAlpha({ seed: 'body', barbs: 60, size: 512, mid: 'rgba(255,255,255,0.7)', base: 'rgba(255,255,255,0.4)' });

  const matSkin = new THREE.MeshStandardMaterial({
    map: skin.map, normalMap: skin.normalMap, normalScale: new THREE.Vector2(0.35, 0.35),
    color: 0xffffff, roughness: 0.62, metalness: 0.0,
  });
  const matBeak = new THREE.MeshStandardMaterial({ color: 0xe8a35a, roughness: 0.42, metalness: 0.02 });
  const matPouchSkin = new THREE.MeshStandardMaterial({ color: 0xf0b877, roughness: 0.55, metalness: 0.0, side: THREE.DoubleSide });
  const matFoot = new THREE.MeshStandardMaterial({ color: 0xd98b45, roughness: 0.5, metalness: 0.02 });
  const matEye = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.08, metalness: 0.1 });
  const matIris = new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.22, metalness: 0.0 });
  const matPupilDark = new THREE.MeshBasicMaterial({ color: 0x08090b });
  const matCrest = new THREE.MeshStandardMaterial({
    map: featherTex.map, alphaMap: alphaBody, transparent: true, alphaTest: 0.32,
    side: THREE.DoubleSide, roughness: 0.72, metalness: 0.0, color: 0xf2f0ec,
  });
  const matWingTop = new THREE.MeshStandardMaterial({
    map: featherTex.map, alphaMap: alphaSec, transparent: true, alphaTest: 0.3,
    side: THREE.DoubleSide, roughness: 0.66, metalness: 0.0, color: 0xf6f4f0,
  });
  const matWingPrim = new THREE.MeshStandardMaterial({
    map: featherTex.map, alphaMap: alphaPrim, transparent: true, alphaTest: 0.28,
    side: THREE.DoubleSide, roughness: 0.6, metalness: 0.0, color: 0xe9e6e0,
  });
  const matTail = new THREE.MeshStandardMaterial({
    map: featherTex.map, alphaMap: alphaTail, transparent: true, alphaTest: 0.3,
    side: THREE.DoubleSide, roughness: 0.7, metalness: 0.0, color: 0xeae7e1,
  });

  const group = new THREE.Group();
  group.name = 'pelican';

  const bones = {};
  const body = new THREE.Group();
  body.name = 'pelican.body';
  group.add(body);
  bones.body = body;

  const bodyMesh = new THREE.Mesh(ellipsoid(0.19, 0.155, 0.135, 32, 22, 0.06, 3), matSkin);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  body.add(bodyMesh);
  bones.bodyMesh = bodyMesh;

  const chest = new THREE.Mesh(ellipsoid(0.145, 0.115, 0.115, 24, 16, 0.05, 9), matSkin);
  chest.position.set(0.045, 0.018, 0);
  chest.castShadow = true;
  body.add(chest);

  const rump = new THREE.Mesh(ellipsoid(0.11, 0.105, 0.095, 20, 14, 0.05, 17), matSkin);
  rump.position.set(-0.09, 0.01, 0);
  rump.castShadow = true;
  body.add(rump);

  const neckRoot = new THREE.Group();
  neckRoot.name = 'pelican.neckRoot';
  neckRoot.position.set(0.088, 0.062, 0);
  body.add(neckRoot);
  bones.neckRoot = neckRoot;

  const NECK_SEGS = 4;
  const NECK_LEN = 0.072;
  const neckBones = [];
  let parent = neckRoot;
  for (let i = 0; i < NECK_SEGS; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.01 : NECK_LEN, 0);
    const r0 = lerp(0.05, 0.034, i / NECK_SEGS);
    const r1 = lerp(0.048, 0.032, (i + 1) / NECK_SEGS);
    const m = new THREE.Mesh(makeSegment(NECK_LEN, r0, r1, 14), matSkin);
    m.castShadow = true;
    seg.add(m);
    parent.add(seg);
    parent = seg;
    neckBones.push(seg);
  }
  bones.neck = neckBones;

  const head = new THREE.Group();
  head.name = 'pelican.head';
  head.position.set(0, NECK_LEN, 0);
  parent.add(head);
  bones.head = head;

  const skull = new THREE.Mesh(ellipsoid(0.062, 0.052, 0.05, 24, 16, 0.05, 23), matSkin);
  skull.position.set(0.006, 0.004, 0);
  skull.castShadow = true;
  head.add(skull);
  bones.skull = skull;

  const beakLen = 0.34;
  const upperBeak = new THREE.Mesh(buildUpperMandible(beakLen), matBeak);
  upperBeak.position.set(0.03, 0.0, 0);
  upperBeak.castShadow = true;
  head.add(upperBeak);
  bones.upperBeak = upperBeak;

  const pouchGeo = buildPouch(beakLen);
  const pouch = new THREE.Mesh(pouchGeo, matPouchSkin);
  pouch.position.set(0.03, 0.0, 0);
  pouch.castShadow = true;
  pouch.frustumCulled = false;
  head.add(pouch);
  bones.pouch = pouch;

  const pouchMorphU = { value: 0.15 };
  matPouchSkin.onBeforeCompile = (sh) => {
    sh.uniforms.uPouch = pouchMorphU;
    sh.vertexShader = 'attribute vec3 aInflate; uniform float uPouch; varying vec2 vPouchUv;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed = mix(transformed, aInflate, uPouch);`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vPouchUv = uv;`);
    sh.fragmentShader = 'uniform float uPouch; varying vec2 vPouchUv;\n' + sh.fragmentShader
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          float vein = 1.0 - smoothstep(0.0, 0.9, abs(sin(vPouchUv.x * 26.0 + vPouchUv.y * 6.0)));
          float flush = mix(0.86, 1.0, uPouch);
          gl_FragColor.rgb *= vec3(1.0, 0.94, 0.9);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(1.14, 0.9, 0.82), vein * 0.25 * flush);
        }`);
  };
  matPouchSkin.customProgramCacheKey = () => 'pelican-pouch';

  const jaw = new THREE.Group();
  jaw.position.set(0.014, -0.006, 0);
  head.add(jaw);
  bones.jaw = jaw;

  const crestCount = 14;
  const crests = [];
  const crestRoot = new THREE.Group();
  crestRoot.position.set(-0.03, 0.028, 0);
  head.add(crestRoot);
  const crestGeo = buildFeatherGeo(0.016, 0.058, 0.18);
  for (let i = 0; i < crestCount; i++) {
    const t = i / (crestCount - 1);
    const f = new THREE.Mesh(crestGeo, matCrest);
    f.position.set(0, 0, 0);
    f.rotation.set(0, 0, 0);
    f.userData.t = t;
    crestRoot.add(f);
    crests.push(f);
  }
  bones.crests = crests;

  function buildEye(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.022, 0.016, side * 0.043);
    head.add(pivot);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 18, 14), matEye);
    pivot.add(ball);
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.0115, 20), matIris);
    iris.position.set(0.0075, 0.001, side * 0.0092);
    iris.rotation.y = side > 0 ? 0.42 : -0.42;
    iris.rotation.z = -0.1;
    pivot.add(iris);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.0056, 16), matPupilDark);
    pupil.position.set(0.0088, 0.0012, side * 0.0104);
    pupil.rotation.y = side > 0 ? 0.42 : -0.42;
    pupil.rotation.z = -0.1;
    pivot.add(pupil);
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.0026, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glint.position.set(0.0094, 0.0062, side * 0.0108);
    glint.rotation.y = side > 0 ? 0.42 : -0.42;
    pivot.add(glint);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0158, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.44), matSkin);
    lid.position.copy(pivot.position);
    lid.rotation.z = -0.35;
    head.add(lid);
    pivot.userData.lid = lid;
    return pivot;
  }
  bones.eyeL = buildEye(-1);
  bones.eyeR = buildEye(1);

  function buildWing(side) {
    const shoulder = new THREE.Group();
    shoulder.name = 'pelican.wing' + (side > 0 ? 'R' : 'L');
    shoulder.position.set(0.045, 0.072, side * 0.098);
    body.add(shoulder);
    const humerus = new THREE.Group();
    shoulder.add(humerus);
    const HUM_L = 0.215;
    const humM = new THREE.Mesh(makeSegment(HUM_L, 0.056, 0.044, 14, 0.004), matSkin);
    humM.castShadow = true;
    humerus.add(humM);
    const elbow = new THREE.Group();
    elbow.position.set(0, HUM_L, 0);
    humerus.add(elbow);
    const FOR_L = 0.245;
    const forM = new THREE.Mesh(makeSegment(FOR_L, 0.044, 0.03, 14, 0.005), matSkin);
    forM.castShadow = true;
    elbow.add(forM);
    const wrist = new THREE.Group();
    wrist.position.set(0, FOR_L, 0);
    elbow.add(wrist);
    const HAND_L = 0.28;
    const handM = new THREE.Mesh(makeSegment(HAND_L, 0.028, 0.012, 12, 0.008), matSkin);
    handM.castShadow = true;
    wrist.add(handM);

    const coverts = [];
    const secGeo = buildFeatherGeo(0.038, 0.16, 0.1, 3);
    for (let i = 0; i < 13; i++) {
      const t = i / 12;
      const f = new THREE.Mesh(secGeo, matWingTop);
      f.position.set(0, lerp(0.02, FOR_L * 0.94, t), 0);
      f.userData = { t, base: 'forearm' };
      elbow.add(f);
      coverts.push(f);
    }
    const primaries = [];
    const primGeo = buildFeatherGeo(0.042, 0.30, 0.14, 4);
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const f = new THREE.Mesh(primGeo, matWingPrim);
      f.position.set(0, lerp(0.016, HAND_L * 0.95, t), 0);
      f.userData = { t, base: 'hand' };
      wrist.add(f);
      primaries.push(f);
    }
    const shoulderCoverts = [];
    const covGeo = buildFeatherGeo(0.05, 0.13, 0.06, 2);
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const f = new THREE.Mesh(covGeo, matWingTop);
      f.position.set(0, lerp(0.02, HUM_L * 0.9, t), 0);
      f.userData = { t, base: 'humerus' };
      humerus.add(f);
      shoulderCoverts.push(f);
    }
    return { side, shoulder, humerus, elbow, wrist, coverts, primaries, shoulderCoverts, HUM_L, FOR_L, HAND_L };
  }
  bones.wingL = buildWing(-1);
  bones.wingR = buildWing(1);

  const tail = new THREE.Group();
  tail.name = 'pelican.tail';
  tail.position.set(-0.145, 0.012, 0);
  body.add(tail);
  bones.tail = tail;
  const tailFeathers = [];
  const tailGeo = buildFeatherGeo(0.05, 0.235, 0.05, 4);
  for (let i = 0; i < 13; i++) {
    const t = i / 12;
    const f = new THREE.Mesh(tailGeo, matTail);
    f.userData = { t };
    tail.add(f);
    tailFeathers.push(f);
  }
  bones.tailFeathers = tailFeathers;

  function buildLeg(side) {
    const hip = new THREE.Group();
    hip.name = 'pelican.leg' + (side > 0 ? 'R' : 'L');
    hip.position.set(-0.05, -0.062, side * 0.085);
    body.add(hip);
    const THIGH = 0.205, SHANK = 0.265, FOOT = 0.11;
    const thigh = new THREE.Group();
    hip.add(thigh);
    const thighM = new THREE.Mesh(makeSegment(THIGH, 0.042, 0.032, 12), matSkin);
    thighM.castShadow = true;
    thigh.add(thighM);
    const knee = new THREE.Group();
    knee.position.set(0, THIGH, 0);
    thigh.add(knee);
    const shankM = new THREE.Mesh(makeSegment(SHANK, 0.03, 0.02, 10), matFoot);
    shankM.castShadow = true;
    knee.add(shankM);
    const ankle = new THREE.Group();
    ankle.position.set(0, SHANK, 0);
    knee.add(ankle);
    const footG = makeSegment(FOOT, 0.02, 0.014, 8);
    const footM = new THREE.Mesh(footG, matFoot);
    footM.castShadow = true;
    ankle.add(footM);
    const toes = new THREE.Group();
    toes.position.set(0, FOOT, 0);
    ankle.add(toes);
    const webGeo = [];
    for (let i = -2; i <= 2; i++) {
      const a = (i / 2) * 0.55;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.075);
      const t = taperBetween(new THREE.Vector3(0, 0, 0), dir, 0.014, 0.005, 6);
      webGeo.push(t);
    }
    const web = new THREE.Mesh(mergeGeometries(webGeo), matFoot);
    web.castShadow = true;
    toes.add(web);
    return { side, hip, thigh, knee, ankle, toes, THIGH, SHANK, FOOT };
  }
  bones.legL = buildLeg(-1);
  bones.legR = buildLeg(1);

  const saddleContact = new THREE.Vector3(0.0, -0.05, 0);

  const state = {
    pouch: 0.15, pouchTarget: 0.15,
    flap: 0, flapPhase: 0, bob: 0, lean: 0, headYaw: 0, headPitch: 0,
    blink: 0, nextBlink: 2.4, breath: 0,
    wingPose: 0,
  };

  const _tmpA = new THREE.Vector3(), _tmpB = new THREE.Vector3(), _tmpC = new THREE.Vector3();
  const _legA = new THREE.Vector3(), _legB = new THREE.Vector3(), _legC = new THREE.Vector3();
  const _legM = new THREE.Matrix4();
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
  const _e1 = new THREE.Euler();

  // Ridden at rest: wings tucked (fold ~0.88). Flapping opens them (fold -> 0.12).
  function wingFoldAmount(speed, flapAmt) {
    const restFold = clamp(0.84 + 0.08 * smoothstep(0, 1.6, speed), 0, 0.95);
    return clamp(restFold - flapAmt * 0.78, 0.08, 0.95);
  }

  // A folded wing is humerus back, forearm forward, primaries back — the classic tucked bird
  // silhouette. `fold` blends between that and the flight pose (blended around f = 0.5).
  function poseWing(w, fold, flap, t, side) {
    const f = clamp(fold, 0, 1);
    const s = side;

    const humSpread = _tmpA.set(0.60, 0.05, s * 0.80).normalize();
    const humFold = _tmpB.set(-0.70, 0.30, s * 0.64).normalize();
    const hum = _tmpC.copy(humSpread).lerp(humFold, f).normalize();

    const foreSpread = new THREE.Vector3(0.52, -0.05, s * 0.85).normalize();
    const foreFold = new THREE.Vector3(0.70, -0.66, s * 0.28).normalize();
    const fore = foreSpread.multiplyScalar(1 - f).addScaledVector(foreFold, f).normalize();

    const handSpread = new THREE.Vector3(0.48, -0.02, s * 0.88).normalize();
    const handFold = new THREE.Vector3(-0.88, 0.10, s * 0.46).normalize();
    const hand = handSpread.multiplyScalar(1 - f).addScaledVector(handFold, f).normalize();

    if (flap !== 0) {
      const lift = flap * 0.4 * (1 - f);
      hum.y += lift; fore.y += lift * 0.6; hand.y += lift * 0.35;
      hum.normalize(); fore.normalize(); hand.normalize();
    }

    aimSegment(w.humerus, hum);
    aimSegment(w.elbow, fore);
    aimSegment(w.wrist, hand);

    // feathers lie flat along the limb when tucked; they fan out only in flight
    for (const ft of w.shoulderCoverts) {
      const k = ft.userData.t;
      const zOut = lerp(0.95, 0.06, f);
      const yOut = lerp(0.10 + k * 0.55, (k - 0.5) * 0.42, f);
      const xOut = lerp(-0.05 + k * 0.1, -0.02 + k * 0.05, f);
      ft.rotation.set(xOut, s * yOut, s * zOut + flap * 0.2 * (1 - f));
    }
    for (const ft of w.coverts) {
      const k = ft.userData.t;
      const zOut = lerp(1.02 - k * 0.26, 0.05 + k * 0.04, f);
      const yOut = lerp(0.16 + k * 0.6, (k - 0.5) * 0.5, f);
      const xOut = lerp(-0.06 + k * 0.12, -0.02 + k * 0.05, f);
      ft.rotation.set(xOut, s * yOut, s * zOut + flap * 0.22 * (1 - f));
    }
    for (const ft of w.primaries) {
      const k = ft.userData.t;
      const zOut = lerp(1.16 - k * 0.44, 0.04 + k * 0.09, f);
      const yOut = lerp(0.22 + k * 0.72, (k - 0.5) * 0.62, f);
      const xOut = lerp(-0.1 + k * 0.24, -0.02 + k * 0.06, f);
      ft.rotation.set(xOut, s * yOut, s * zOut + flap * 0.26 * (1 - f));
    }
  }

  function poseLeg(leg, footTarget, kneeSign) {
    const hipWorld = _legA.setFromMatrixPosition(leg.hip.matrixWorld);
    const knee = twoBoneIK(hipWorld, footTarget, leg.THIGH, leg.SHANK, kneeSign, _legB);

    const hipInv = _legM.copy(leg.hip.parent.matrixWorld).invert();
    const thighDir = _legC.copy(knee).sub(hipWorld).normalize();
    thighDir.transformDirection(hipInv);
    aimSegment(leg.thigh, thighDir);
    leg.thigh.updateMatrixWorld(true);

    const kneeWorld = _legA.setFromMatrixPosition(leg.knee.matrixWorld);
    const kneeInv = _legM.copy(leg.knee.parent.matrixWorld).invert();
    const shankDir = _legC.copy(footTarget).sub(kneeWorld).normalize();
    shankDir.transformDirection(kneeInv);
    aimSegment(leg.knee, shankDir);
    leg.knee.updateMatrixWorld(true);

    // the foot stays level with the world, not with the shank
    const ankleInv = _legM.copy(leg.ankle.parent.matrixWorld).invert();
    const footDir = _legC.set(0, 1, 0);
    footDir.transformDirection(ankleInv);
    aimSegment(leg.ankle, footDir);
  }

  let ready = false;

  function update(t, dt, ctx) {
    state.breath += dt;
    const speed = ctx.speed || 0;
    const tempo = clamp(speed / 1.1, 0, 2.4);
    const pedalPhase = ctx.pedalPhase || 0;

    state.blink -= dt;
    if (state.blink <= 0 && state.nextBlink > 0) {
      state.blink = 0;
      state.nextBlink -= dt;
      if (state.nextBlink <= 0) {
        state.blink = 1;
        state.nextBlink = 2.2 + Math.random() * 4.6;
      }
    }
    let blinkAmt = 0;
    if (ctx.blinkOverride != null) blinkAmt = ctx.blinkOverride;
    else if (state.nextBlink <= 0) blinkAmt = smoothstep(0, 0.06, state.blink) * (1 - smoothstep(0.09, 0.18, state.blink));
    if (ctx.blinkOverride != null) {
      const lidRot = -0.35 - blinkAmt * 1.05;
      for (const k of ['eyeL', 'eyeR']) bones[k].userData.lid.rotation.z = lidRot;
    } else {
      const lidRot = -0.35 - blinkAmt * 1.05;
      bones.eyeL.userData.lid.rotation.z = lidRot;
      bones.eyeR.userData.lid.rotation.z = lidRot;
    }

    state.pouchTarget = ctx.pouch != null ? ctx.pouch : state.pouchTarget;
    state.pouch = lerp(state.pouch, state.pouchTarget, 1 - Math.exp(-6 * dt));
    pouchMorphU.value = state.pouch;

    const breath = Math.sin(state.breath * 1.35) * 0.5 + 0.5;
    const bobAmt = Math.sin(pedalPhase * TAU * 2) * 0.012 * clamp(tempo, 0.2, 1.6);
    const sideSway = Math.sin(pedalPhase * TAU) * 0.02 * clamp(tempo, 0.2, 1.6);

    bones.body.position.set(0, bobAmt + (ctx.bodyLift || 0), sideSway);
    bones.body.rotation.set(
      (ctx.bodyPitch || 0) + Math.sin(pedalPhase * TAU * 2) * 0.012 * tempo,
      (ctx.bodyYaw || 0),
      (ctx.bodyRoll || 0) + Math.sin(pedalPhase * TAU) * 0.03 * tempo,
    );

    const neckBase = _e1.set(
      (ctx.neckPitch || 0) + 0.06 + Math.sin(t * 0.7) * 0.02,
      0,
      0,
    );
    for (let i = 0; i < NECK_SEGS; i++) {
      const k = i / (NECK_SEGS - 1);
      const curl = (ctx.neckCurl != null ? ctx.neckCurl : 0.5);
      const seg = bones.neck[i];
      const droop = lerp(-0.12, 0.2, curl);
      const spread = lerp(0.14, 0.3, curl);
      seg.rotation.set(
        droop * (1 - k * 0.4) + Math.sin(t * 1.1 + i * 0.5) * 0.012,
        (ctx.neckYaw || 0) * k * 0.4 + Math.sin(t * 0.9 + i) * 0.014,
        Math.sin(t * 0.8 + i * 0.7) * spread * 0.1,
      );
    }

    bones.head.rotation.set(
      (ctx.headPitch != null ? ctx.headPitch : 0.05),
      (ctx.headYaw != null ? ctx.headYaw : 0),
      Math.sin(t * 1.3) * 0.03,
    );
    bones.jaw.rotation.z = (ctx.jawOpen || 0) * 0.34;

    for (const f of crests) {
      const k = f.userData.t;
      f.rotation.set(
        (ctx.crestLift || 0) * 0.5,
        (k - 0.5) * 1.5,
        -0.5 - k * 0.5 + (1 - k) * 0.3 * (ctx.crestLift || 0),
      );
      f.position.set(-0.006 - k * 0.012, -k * 0.006, (k - 0.5) * 0.04);
      f.scale.setScalar(lerp(1.0, 0.72, k));
    }

    for (const f of tailFeathers) {
      const k = f.userData.t;
      f.rotation.set(
        -0.16 - (ctx.tailLift || 0) * 0.4,
        (k - 0.5) * 0.85,
        (k - 0.5) * 0.22,
      );
      f.position.set(0, 0, (k - 0.5) * 0.012);
    }
    bones.tail.rotation.z = (ctx.tailLift || 0) * 0.35;

    const fold = wingFoldAmount(speed) * (ctx.wingFold != null ? ctx.wingFold : 1);
    const flapAmp = (ctx.flap != null ? ctx.flap : state.flap);
    let flap = 0;
    if (flapAmp > 0.001) {
      state.flapPhase += dt * (1.6 + flapAmp * 4.5);
      flap = Math.sin(state.flapPhase * TAU) * flapAmp;
    } else {
      state.flapPhase = 0;
    }
    poseWing(bones.wingL, fold, flap, t, -1);
    poseWing(bones.wingR, fold, flap, t, 1);

    bones.body.updateMatrixWorld(true);
    const crank = ctx.pedalTargets;
    if (crank) {
      const lift = ctx.footLift || 0;
      poseLeg(bones.legL, _tmpFootL.copy(crank.left).addScaledVector(UP, lift), -1);
      poseLeg(bones.legR, _tmpFootR.copy(crank.right).addScaledVector(UP, lift), -1);
    }

    if (ctx.gripLeft && ctx.gripRight) {
      const l = _tmpA.copy(ctx.gripLeft);
      const r = _tmpB.copy(ctx.gripRight);
      if (wingsGrip(bones.wingL, l, -1)) {}
      if (wingsGrip(bones.wingR, r, 1)) {}
    }
    ready = true;
  }

  const _tmpFootL = new THREE.Vector3(), _tmpFootR = new THREE.Vector3();

  function wingsGrip(w, target, side) {
    const world = w.humerus.parent;
    world.updateMatrixWorld(true);
    const from = _tmpA.setFromMatrixPosition(w.wrist.matrixWorld);
    const inv = w.elbow.parent.matrixWorld.clone().invert();
    const dir = _tmpB.copy(target).sub(from);
    const dist = dir.length();
    const reach = w.HAND_L * 0.72;
    if (dist > reach * 1.6) return false;
    dir.normalize();
    const localDir = dir.clone().transformDirection(inv);
    aimSegment(w.wrist, localDir);
    return true;
  }

  return {
    group, bones, state,
    update,
    materialMorph: pouchMorphU,
    set flap(v) { state.flap = clamp(v, 0, 1.6); },
    get flap() { return state.flap; },
    isReady: () => ready,
  };
}
