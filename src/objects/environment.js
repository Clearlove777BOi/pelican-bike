import * as THREE from 'three';
import {
  clamp, lerp, smoothstep, TAU, DEG, rng, fbm2, ridged2, noise2, noise3,
  mergeGeometries, taperBetween, tubeBetween, makeTube, curve, easeInOutSine,
} from '../lib/core.js';
import { groundMaps, foliageAlpha, skyGradientTexture, asphaltMaps, paintLineTexture } from '../lib/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function seaHeight(x, z, t) {
  const a = fbm2(x * 0.02 + t * 0.06, z * 0.02, 4, 3);
  const b = fbm2(x * 0.07 - t * 0.11, z * 0.07 + t * 0.05, 3, 11);
  const c = Math.sin(x * 0.16 + t * 1.1) * 0.035 + Math.sin(z * 0.21 - t * 1.4) * 0.03;
  return (a - 0.5) * 0.42 + (b - 0.5) * 0.16 + c;
}

function terrainHeight(x, z) {
  const d = z;
  const shore = smoothstep(-6, 40, d);
  let h = 0;
  const roll = fbm2(x * 0.0055, d * 0.0058, 5, 21) - 0.5;
  h += roll * 30 * shore;
  h += (fbm2(x * 0.021, d * 0.021, 4, 47) - 0.5) * 5.2 * shore;
  h += (fbm2(x * 0.085, d * 0.085, 3, 71) - 0.5) * 1.1 * shore;
  const cliff = smoothstep(10, 34, d);
  h += cliff * (3.4 + 2.6 * fbm2(x * 0.04, d * 0.04, 3, 91));
  const rd = roadHeight(x, z);
  const k = smoothstep(11, 3.4, Math.abs(d - 8.5));
  h = lerp(h, rd, k * 0.94);
  // the beach and the water beyond: land stays at or above sea level until the waterline
  const water = 1 - smoothstep(-1.5, 13, d);
  h = lerp(h, -3.2, water * 0.98);
  if (d > 0.5 && d < 60) h = Math.max(h, 0.55);
  return h;
}

function roadHeight(x, z) {
  const centre = 8.5;
  const drop = Math.abs(z - centre);
  const crown = -drop * drop * 0.0032;
  const along = fbm2(x * 0.006, 0.3, 3, 5) * 2.4;
  const undulate = Math.sin(x * 0.0125) * 1.35 + Math.sin(x * 0.0061 + 1.4) * 0.9;
  return 5.4 + along + undulate + crown;
}

export function createEnvironment(scene, renderer) {
  const group = new THREE.Group();
  group.name = 'environment';
  scene.add(group);

  const quality = { level: 'high' };
  const resources = [];

  // ---------- SKY ----------
  const skyGeo = new THREE.SphereGeometry(900, 64, 40);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0.16, -0.34).normalize() },
      uTime: { value: 0 },
      uSunElev: { value: 0.18 },
      uHaze: { value: 1 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uSunDir; uniform float uTime; uniform float uSunElev; uniform float uHaze;
      varying vec3 vDir;
      float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fb(vec2 p, int oct){ float s=0.0,a=0.5,n=0.0; for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*vn(p); n+=a; p=p*2.03+vec2(11.7,5.3); a*=0.5; } return s/n; }
      void main(){
        vec3 d = normalize(vDir);
        float elev = clamp(d.y, -0.12, 1.0);
        float sunD = max(dot(d, normalize(uSunDir)), 0.0);
        vec3 zenith = vec3(0.055, 0.12, 0.26);
        vec3 mid    = vec3(0.20, 0.36, 0.53);
        vec3 horizon= vec3(0.72, 0.66, 0.60);
        vec3 sunLow = vec3(1.0, 0.62, 0.30);
        vec3 warm   = vec3(1.0, 0.80, 0.55);
        float t = pow(clamp(elev, 0.0, 1.0), 0.52);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.36, t));
        col = mix(col, zenith, smoothstep(0.30, 1.0, t));
        float glow = pow(sunD, 8.0) * (1.0 - smoothstep(0.0, 0.45, elev)) * 0.55;
        col += warm * glow;
        col += sunLow * pow(sunD, 90.0) * 0.5 * (1.0 - smoothstep(0.0, 0.35, elev));
        col += vec3(1.0, 0.96, 0.88) * pow(sunD, 6000.0) * 2.4;
        float band = exp(-pow((elev - 0.015) / 0.075, 2.0));
        col += vec3(1.0, 0.68, 0.42) * band * 0.28 * (1.0 - uSunElev * 0.4);
        float az = atan(d.z, d.x);
        float cn = fb(vec2(az * 2.6 + uTime * 0.004, (1.0 - elev) * 2.2), 5);
        float cm = smoothstep(0.5, 0.78, cn) * smoothstep(0.03, 0.28, elev) * (1.0 - smoothstep(0.42, 0.78, elev));
        vec3 cloudCol = mix(vec3(0.46, 0.44, 0.47), vec3(1.0, 0.86, 0.72), clamp(dot(d, normalize(uSunDir)) * 0.6 + 0.42, 0.0, 1.0));
        cloudCol = mix(cloudCol, vec3(1.0, 0.72, 0.5), pow(sunD, 3.0) * 0.5);
        col = mix(col, cloudCol, cm * 0.72);
        float str = fb(vec2(az * 9.0, (1.0 - elev) * 5.0 + uTime * 0.0016), 4);
        col += vec3(0.9, 0.85, 0.8) * smoothstep(0.62, 0.85, str) * (1.0 - smoothstep(0.06, 0.3, elev)) * 0.22;
        float ground = smoothstep(0.0, -0.08, d.y);
        col = mix(col, vec3(0.10, 0.13, 0.16), ground);
        gl_FragColor = vec4(col * uHaze, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  group.add(sky);
  resources.push(skyGeo, skyMat);

  const envTex = skyGradientTexture();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(envTex);
  scene.environment = envRT.texture;
  resources.push(envTex, envRT, pmrem);

  // ---------- TERRAIN ----------
  const SIZE = 620, SEG = 200;
  const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  terrainGeo.rotateX(-Math.PI / 2);
  const tp = terrainGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    tp.setY(i, terrainHeight(x, z));
  }
  terrainGeo.computeVertexNormals();
  const gm = groundMaps(1024);
  gm.map.repeat.set(46, 46);
  gm.normalMap.repeat.set(46, 46);
  const terrainMat = new THREE.MeshStandardMaterial({
    map: gm.map, normalMap: gm.normalMap, normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.94, metalness: 0.0,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.name = 'terrain';
  terrain.receiveShadow = true;
  terrain.position.set(0, 0, 0);
  group.add(terrain);
  resources.push(terrainGeo, terrainMat, gm.map, gm.normalMap);

  // ---------- ROAD ----------
  const roadPts = [];
  for (let x = -300; x <= 300; x += 2) roadPts.push(V(x, 0, 8.5));
  const roadGeo = (() => {
    const pos = [], uv = [], idx = [];
    const half = 3.3;
    for (let i = 0; i < roadPts.length; i++) {
      const p = roadPts[i];
      const y = roadHeight(p.x, 8.5) + 0.035;
      pos.push(p.x, y, 8.5 - half, p.x, y, 8.5 + half);
      uv.push(p.x / 4.4, 0, p.x / 4.4, 1);
    }
    for (let i = 0; i < roadPts.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })();
  const asphalt = asphaltMaps(512);
  asphalt.map.repeat.set(1, 1);
  asphalt.normalMap.repeat.set(1, 1);
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphalt.map, normalMap: asphalt.normalMap, normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: 0.86, metalness: 0.02, color: 0x9a9a9e,
  });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.name = 'road';
  road.receiveShadow = true;
  road.renderOrder = 1;
  group.add(road);
  resources.push(roadGeo, roadMat, asphalt.map, asphalt.normalMap);

  // centre line dashes
  const dashParts = [];
  for (let x = -300; x < 300; x += 7) {
    const y = roadHeight(x + 1.6, 8.5) + 0.055;
    const g = new THREE.BoxGeometry(3.0, 0.012, 0.14);
    g.translate(x + 1.5, y, 8.5);
    dashParts.push(g);
  }
  const dashGeo = mergeGeometries(dashParts);
  const paintTex = paintLineTexture(128);
  paintTex.repeat.set(1, 1);
  const dashMat = new THREE.MeshStandardMaterial({ map: paintTex, color: 0xf2ead9, roughness: 0.7, metalness: 0.0 });
  const dashes = new THREE.Mesh(dashGeo, dashMat);
  dashes.name = 'roadLines';
  dashes.receiveShadow = true;
  dashes.renderOrder = 2;
  group.add(dashes);
  resources.push(dashGeo, dashMat, paintTex);

  // ---------- SEA ----------
  // Waves live in a shader (analytic normals) instead of being displaced on the CPU every
  // frame: the surface stays smooth at any distance and costs nothing to animate.
  const seaGeo = new THREE.PlaneGeometry(3000, 3000, 200, 200);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = new THREE.ShaderMaterial({
    transparent: false, fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0.16, -0.34).normalize() },
      uSunCol: { value: new THREE.Color(1.0, 0.72, 0.42) },
      uDeep: { value: new THREE.Color(0.035, 0.085, 0.115) },
      uShallow: { value: new THREE.Color(0.10, 0.24, 0.30) },
      uSky: { value: new THREE.Color(0.42, 0.52, 0.62) },
      uShoreZ: { value: -22.0 },
      uChoppy: { value: 1.0 },
    }),
    vertexShader: `
      #include <fog_pars_vertex>
      uniform float uTime; uniform vec3 uSunDir; uniform float uChoppy; uniform float uShoreZ;
      varying vec3 vWorld; varying vec3 vNormalW; varying float vShore;
      vec3 waveDisp(vec2 p, float t, out vec3 nrm){
        vec3 acc = vec3(0.0);
        vec3 n = vec3(0.0, 1.0, 0.0);
        const int N = 5;
        float amp[5]; float len[5]; vec2 dir[5]; float spd[5];
        amp[0]=0.20; len[0]=42.0; dir[0]=normalize(vec2(0.86,0.51)); spd[0]=0.55;
        amp[1]=0.13; len[1]=23.0; dir[1]=normalize(vec2(-0.62,0.78)); spd[1]=0.72;
        amp[2]=0.07; len[2]=12.5; dir[2]=normalize(vec2(0.42,-0.91)); spd[2]=0.95;
        amp[3]=0.038; len[3]=7.0; dir[3]=normalize(vec2(-0.88,-0.47)); spd[3]=1.2;
        amp[4]=0.018; len[4]=4.0; dir[4]=normalize(vec2(0.29,0.96)); spd[4]=1.5;
        for (int i = 0; i < N; i++) {
          float a = amp[i] * uChoppy;
          float k = 6.2831853 / len[i];
          float f = dot(dir[i], p) * k - uTime * spd[i] * k * 1.6;
          float s = sin(f), c = cos(f);
          acc.y += a * s;
          acc.x += dir[i].x * a * c * 0.35;
          acc.z += dir[i].y * a * c * 0.35;
          n.x -= dir[i].x * a * k * c;
          n.z -= dir[i].y * a * k * c;
        }
        nrm = normalize(n);
        return acc;
      }
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 nrm;
        vec3 d = waveDisp(wp.xz, uTime, nrm);
        wp.xyz += d;
        vWorld = wp.xyz;
        vNormalW = nrm;
        vShore = smoothstep(uShoreZ - 26.0, uShoreZ + 6.0, wp.z);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol;
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky;
      varying vec3 vWorld; varying vec3 vNormalW; varying float vShore;
      void main(){
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 body = mix(uDeep, uShallow, clamp(vShore, 0.0, 1.0));
        // subsurface glow: light gets into the crests and scatters back out
        float sss = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        body += vec3(0.02, 0.06, 0.055) * pow(sss, 2.2);
        // grazing angles show sky; steep angles show water
        vec3 refl = uSky * (1.0 + 0.6 * pow(max(dot(N, uSunDir), 0.0), 3.0));
        vec3 col = mix(body, refl, fres * 0.9);
        // one narrow sun glint plus a wide sheen, both following the wave normals
        vec3 H = normalize(uSunDir + V);
        float nh = max(dot(N, H), 0.0);
        col += uSunCol * pow(nh, 380.0) * 3.0;
        col += uSunCol * pow(nh, 42.0) * 0.16;
        // sparkle: tiny facets turning to the sun, animated in the wave frame
        float chirp = sin(vWorld.x * 3.1 + uTime * 2.3) * sin(vWorld.z * 2.7 - uTime * 1.9);
        col += uSunCol * pow(max(chirp, 0.0), 26.0) * pow(nh, 8.0) * 0.5;
        // foam where the waves get steep, and a foam line along the shore
        float steep = 1.0 - clamp(N.y, 0.0, 1.0);
        float foam = smoothstep(0.16, 0.34, steep) * 0.55;
        foam += smoothstep(0.62, 1.0, vShore) * 0.6;
        col = mix(col, vec3(0.84, 0.88, 0.9), clamp(foam, 0.0, 0.8));
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.name = 'sea';
  sea.position.set(0, 0, -46);
  sea.receiveShadow = false;
  sea.frustumCulled = false;
  group.add(sea);
  resources.push(seaGeo, seaMat);

  // ---------- CLIFFS / ROCKS ----------
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b6659, roughness: 0.92, metalness: 0.02, flatShading: true });
  const rockParts = [];
  const rr = rng('rocks');
  for (let i = 0; i < 34; i++) {
    const x = -260 + rr() * 520;
    const z = -18 + rr() * 22;
    const s = 0.6 + Math.pow(rr(), 2) * 3.4;
    const g = new THREE.IcosahedronGeometry(s, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const px = p.getX(k), py = p.getY(k), pz = p.getZ(k);
      const n = 1 + 0.4 * (noise3(px * 1.4, py * 1.4, pz * 1.4, i) - 0.5) * 2;
      p.setXYZ(k, px * n, py * n * 0.72, pz * n);
    }
    g.computeVertexNormals();
    g.translate(x, terrainHeight(x, z) - s * 0.2, z);
    g.rotateY(rr() * TAU);
    rockParts.push(g);
  }
  const rocksGeo = mergeGeometries(rockParts);
  const rocks = new THREE.Mesh(rocksGeo, rockMat);
  rocks.name = 'rocks';
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);
  resources.push(rocksGeo, rockMat);

  // ---------- VEGETATION ----------
  const foliageTex = foliageAlpha(256, 'grass');
  const grassMat = new THREE.MeshStandardMaterial({
    map: foliageTex, alphaMap: foliageTex, transparent: true, alphaTest: 0.42,
    side: THREE.DoubleSide, roughness: 0.86, metalness: 0.0, color: 0x8fa05e,
  });
  const grassTuft = (() => {
    const parts = [];
    const N = 7;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + 0.4;
      const h = 0.34 + (i % 3) * 0.13;
      const g = new THREE.PlaneGeometry(0.26, h, 1, 3);
      g.translate(0, h / 2, 0);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const yy = p.getY(k);
        const bend = 0.14 * Math.pow(yy / h, 2);
        p.setX(k, p.getX(k) + bend * Math.cos(a));
        p.setZ(k, p.getZ(k) + bend * Math.sin(a));
      }
      g.rotateY(a);
      parts.push(g);
    }
    return mergeGeometries(parts);
  })();
  const GRASS_N = 5200;
  const grass = new THREE.InstancedMesh(grassTuft, grassMat, GRASS_N);
  grass.name = 'grass';
  grass.castShadow = true;
  grass.receiveShadow = true;
  grass.frustumCulled = false;
  const rgi = rng('grass-instance');
  const gm4 = new THREE.Matrix4();
  const gq = new THREE.Quaternion();
  const gs = new THREE.Vector3();
  const gp = new THREE.Vector3();
  const gc = new THREE.Color();
  let gi = 0;
  while (gi < GRASS_N) {
    const x = -190 + rgi() * 380;
    const z = -4 + Math.pow(rgi(), 1.4) * 150;
    const distRoad = Math.abs(z - 8.5);
    if (distRoad < 3.6) continue;
    const y = terrainHeight(x, z);
    if (y < 1.6) continue;
    gp.set(x, y - 0.02, z);
    gq.setFromAxisAngle(V(0, 1, 0), rgi() * TAU);
    const s = 0.6 + Math.pow(rgi(), 2) * 1.1;
    gs.set(s, s * (0.7 + rgi() * 0.9), s);
    gm4.compose(gp, gq, gs);
    grass.setMatrixAt(gi, gm4);
    const t = rgi();
    gc.setRGB(0.42 + t * 0.22, 0.5 + t * 0.2, 0.24 + t * 0.12);
    grass.setColorAt(gi, gc);
    gi++;
  }
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  group.add(grass);
  resources.push(grassTuft, grassMat, foliageTex);

  // shrubs + trees
  function bushGeo(seed) {
    const r = rng(seed);
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.IcosahedronGeometry(0.4 + r() * 0.5, 1);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const n = 1 + 0.34 * (noise3(p.getX(k) * 2, p.getY(k) * 2, p.getZ(k) * 2, i + seed.length) - 0.5) * 2;
        p.setXYZ(k, p.getX(k) * n, p.getY(k) * n * 0.82, p.getZ(k) * n);
      }
      g.computeVertexNormals();
      g.translate((r() - 0.5) * 0.9, 0.32 + r() * 0.3, (r() - 0.5) * 0.9);
      parts.push(g);
    }
    return mergeGeometries(parts);
  }
  const bushMat = new THREE.MeshStandardMaterial({
    map: foliageTex, alphaMap: foliageTex, transparent: true, alphaTest: 0.34,
    roughness: 0.88, metalness: 0.0, color: 0x6f8a4e, side: THREE.DoubleSide,
  });
  const bushTuft = bushGeo('bush');
  const BUSH_N = 150;
  const bush = new THREE.InstancedMesh(bushTuft, bushMat, BUSH_N);
  bush.name = 'bushes';
  bush.castShadow = true;
  bush.receiveShadow = true;
  let bi = 0;
  while (bi < BUSH_N) {
    const x = -200 + rgi() * 400;
    const z = 12 + Math.pow(rgi(), 1.2) * 130;
    if (Math.abs(z - 8.5) < 5.5) continue;
    const y = terrainHeight(x, z);
    if (y < 2) continue;
    gp.set(x, y - 0.1, z);
    gq.setFromAxisAngle(V(0, 1, 0), rgi() * TAU);
    const s = 0.7 + rgi() * 1.2;
    gs.set(s, s * (0.8 + rgi() * 0.5), s);
    bush.setMatrixAt(bi, gm4.compose(gp, gq, gs));
    gc.setRGB(0.36 + rgi() * 0.2, 0.48 + rgi() * 0.18, 0.22 + rgi() * 0.12);
    bush.setColorAt(bi, gc);
    bi++;
  }
  bush.instanceMatrix.needsUpdate = true;
  if (bush.instanceColor) bush.instanceColor.needsUpdate = true;
  group.add(bush);
  resources.push(bushGeo, bushMat);

  function cypressGeo(height = 3.4) {
    const parts = [];
    const layers = 9;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const r = 0.62 * Math.pow(Math.sin(Math.PI * clamp(t * 0.86 + 0.1)), 0.85);
      const y = height * t;
      const g = new THREE.SphereGeometry(r, 10, 6, 0, TAU, 0, Math.PI * 0.6);
      g.scale(1, 0.72, 1);
      g.translate(0, y + height * 0.05, 0);
      parts.push(g);
    }
    const trunk = new THREE.CylinderGeometry(0.055, 0.085, height * 0.5, 8);
    trunk.translate(0, height * 0.24, 0);
    parts.push(trunk);
    return mergeGeometries(parts);
  }
  const cypressMat = new THREE.MeshStandardMaterial({ color: 0x3f5636, roughness: 0.9, metalness: 0.0, flatShading: true });
  const cypGeo = cypressGeo(3.6);
  const CYP_N = 46;
  const cyp = new THREE.InstancedMesh(cypGeo, cypressMat, CYP_N);
  cyp.name = 'cypress';
  cyp.castShadow = true;
  cyp.receiveShadow = true;
  let ci = 0;
  while (ci < CYP_N) {
    const x = -170 + rgi() * 340;
    const z = 26 + rgi() * 96;
    const y = terrainHeight(x, z);
    if (y < 3) continue;
    gp.set(x, y, z);
    gq.setFromAxisAngle(V(0, 1, 0), rgi() * TAU);
    const s = 0.8 + rgi() * 0.8;
    gs.set(s, s * (0.9 + rgi() * 0.5), s);
    cyp.setMatrixAt(ci, gm4.compose(gp, gq, gs));
    ci++;
  }
  cyp.instanceMatrix.needsUpdate = true;
  group.add(cyp);
  resources.push(cypGeo, cypressMat);

  // ---------- ROADSIDE PROPS ----------
  const postMat = new THREE.MeshStandardMaterial({ color: 0xcfc8b6, roughness: 0.72, metalness: 0.02 });
  const postParts = [];
  for (let x = -220; x < 220; x += 9) {
    const y = roadHeight(x, 5.4);
    const g = new THREE.BoxGeometry(0.075, 0.72, 0.075);
    g.translate(x, y + 0.36, 5.35);
    postParts.push(g);
    const cap = new THREE.BoxGeometry(0.095, 0.05, 0.095);
    cap.translate(x, y + 0.74, 5.35);
    postParts.push(cap);
  }
  const postGeo = mergeGeometries(postParts);
  const posts = new THREE.Mesh(postGeo, postMat);
  posts.name = 'posts';
  posts.castShadow = true;
  posts.receiveShadow = true;
  group.add(posts);
  resources.push(postGeo, postMat);

  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x6d6355, roughness: 0.9, metalness: 0.02 });
  const fenceParts = [];
  for (let x = -180; x < 180; x += 2.4) {
    const z = 42 + Math.sin(x * 0.02) * 3;
    const y = terrainHeight(x, z);
    const g = new THREE.BoxGeometry(0.06, 1.0, 0.06);
    g.translate(x, y + 0.5, z);
    fenceParts.push(g);
  }
  for (let x = -180; x < 180; x += 6) {
    const z = 42 + Math.sin(x * 0.02) * 3;
    const y = terrainHeight(x, z);
    const g = new THREE.BoxGeometry(6, 0.05, 0.05);
    g.translate(x + 3, y + 0.78, z + Math.cos(x * 0.02) * 0.6);
    fenceParts.push(g);
    const g2 = new THREE.BoxGeometry(6, 0.05, 0.05);
    g2.translate(x + 3, y + 0.42, z + Math.cos(x * 0.02) * 0.6);
    fenceParts.push(g2);
  }
  const fenceGeo = mergeGeometries(fenceParts);
  const fence = new THREE.Mesh(fenceGeo, fenceMat);
  fence.name = 'fence';
  fence.castShadow = true;
  fence.receiveShadow = true;
  group.add(fence);
  resources.push(fenceGeo, fenceMat);

  // windmill
  const windmill = new THREE.Group();
  windmill.name = 'windmill';
  const wmX = -62, wmZ = 62;
  windmill.position.set(wmX, terrainHeight(wmX, wmZ), wmZ);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xb8ad97, roughness: 0.86, metalness: 0.02 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.15, 8.2, 16), towerMat);
  tower.position.y = 4.1;
  tower.castShadow = true;
  tower.receiveShadow = true;
  windmill.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.5, 16), towerMat);
  cap.position.y = 8.9;
  cap.castShadow = true;
  windmill.add(cap);
  const blades = new THREE.Group();
  blades.position.set(0, 8.4, 1.35);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x8c7350, roughness: 0.8, metalness: 0.03 });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.2, 0.06), bladeMat);
    b.position.y = 2.1;
    b.castShadow = true;
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * TAU;
    arm.add(b);
    blades.add(arm);
  }
  windmill.add(blades);
  group.add(windmill);
  towerMat.dispose && resources.push(towerMat, bladeMat);

  // ---------- CLOUDS ----------
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95, metalness: 0.0, transparent: true, opacity: 0.82, depthWrite: false,
  });
  cloudMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      float f = 1.0 - abs(normalize(vNormal).y);
      gl_FragColor.a *= mix(1.0, 0.25, f);`);
  };
  cloudMat.customProgramCacheKey = () => 'cloud-soft';
  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'clouds';
  const clouds = [];
  const rc = rng('clouds');
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    const blobs = 4 + Math.floor(rc() * 5);
    for (let k = 0; k < blobs; k++) {
      const s = 8 + rc() * 16;
      const g = new THREE.IcosahedronGeometry(s, 2);
      const p = g.attributes.position;
      for (let q = 0; q < p.count; q++) {
        const n = 1 + 0.24 * (noise3(p.getX(q) * 0.06, p.getY(q) * 0.06, p.getZ(q) * 0.06, i * 7 + k) - 0.5) * 2;
        p.setXYZ(q, p.getX(q) * n, p.getY(q) * n * 0.62, p.getZ(q) * n);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, cloudMat);
      m.position.set((rc() - 0.5) * 60, (rc() - 0.5) * 12, (rc() - 0.5) * 34);
      c.add(m);
    }
    c.position.set(-420 + rc() * 840, 88 + rc() * 68, -320 + rc() * 260);
    c.userData.speed = 1.2 + rc() * 2.2;
    cloudGroup.add(c);
    clouds.push(c);
  }
  group.add(cloudGroup);

  // ---------- SEAGULLS ----------
  const gullMat = new THREE.MeshStandardMaterial({ color: 0xf1f2f4, roughness: 0.62, metalness: 0.0, side: THREE.DoubleSide });
  const gullBody = (() => {
    const parts = [];
    const b = new THREE.SphereGeometry(0.24, 10, 8);
    b.scale(2.0, 0.8, 0.8);
    parts.push(b);
    const tail = new THREE.BoxGeometry(0.5, 0.03, 0.22);
    tail.translate(-0.62, 0, 0);
    parts.push(tail);
    const head = new THREE.SphereGeometry(0.13, 10, 8);
    head.translate(0.46, 0.08, 0);
    parts.push(head);
    const beak = new THREE.ConeGeometry(0.05, 0.2, 6);
    beak.rotateZ(-Math.PI / 2);
    beak.translate(0.66, 0.06, 0);
    parts.push(beak);
    return mergeGeometries(parts);
  })();
  // tapered swept wings with real thickness (a flat plane reads as a white card from behind)
  const gullWing = (() => {
    const parts = [];
    for (const s of [-1, 1]) {
      const segs = 5;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const span0 = 0.18 + t0 * 0.62, span1 = 0.18 + t1 * 0.62;
        const chord0 = lerp(0.34, 0.1, t0), chord1 = lerp(0.34, 0.1, t1);
        const sweep0 = t0 * 0.5, sweep1 = t1 * 0.5;
        const g = new THREE.BoxGeometry(1, 0.022, 1);
        const w = (span0 + span1) * 0.5;
        const c = (chord0 + chord1) * 0.5;
        g.scale(w, 1, c);
        g.translate(0, 0.02 * (1 - t0) - 0.02 * t0, 0);
        g.rotateY(-sweep0 * s * 0.6);
        g.translate(0.18 * 0 + (span0 + span1) * 0.5, 0, -(sweep0 + sweep1) * 0.25 * s);
        g.rotateZ(s > 0 ? 0 : Math.PI);
        g.translate(0, 0.06, s * 0.12);
        parts.push(g);
      }
    }
    return mergeGeometries(parts);
  })();
  const gulls = [];
  for (let i = 0; i < 11; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(gullBody, gullMat);
    body.castShadow = true;
    g.add(body);
    const wings = new THREE.Mesh(gullWing, gullMat);
    wings.castShadow = true;
    g.add(wings);
    g.userData = {
      wings,
      r: 26 + rc() * 62,
      speed: 0.14 + rc() * 0.14,
      phase: rc() * TAU,
      height: 7 + rc() * 14,
      flap: 0.5 + rc() * 0.7,
      cx: -40 + rc() * 120,
      cz: -34 + rc() * 40,
      dir: rc() < 0.5 ? 1 : -1,
    };
    gulls.push(g);
    group.add(g);
  }

  const sunDir = new THREE.Vector3(1, 0.16, -0.34).normalize();
  const sun = new THREE.DirectionalLight(0xffd9ac, 2.6);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.level === 'high' ? 2048 : 1024, quality.level === 'high' ? 2048 : 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.024;
  scene.add(sun);
  const sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sun.target = sunTarget;

  const hemi = new THREE.HemisphereLight(0xbcd2e8, 0x6b6047, 0.62);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xa8c4e0, 0.34);
  fill.position.set(-40, 26, 30);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffc98a, 0.5);
  rim.position.set(-30, 14, -50);
  scene.add(rim);

  const fog = new THREE.FogExp2(0xb9c3cb, 0.0016);
  scene.fog = fog;

  const state = { dayT: 0.38, tempo: 1, wind: 1, time: 0 };

  function update(t, dt, ctx) {
    state.time = t;
    const sunPhase = state.dayT;
    const elev = lerp(0.03, 0.62, Math.sin(Math.PI * clamp(sunPhase)));
    const azim = lerp(-0.9, 1.5, sunPhase);
    sunDir.set(Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim)).normalize();
    skyMat.uniforms.uSunDir.value.copy(sunDir);
    skyMat.uniforms.uSunElev.value = elev;
    skyMat.uniforms.uTime.value = t;
    sun.position.copy(sunDir).multiplyScalar(90);
    sun.color.setHSL(lerp(0.09, 0.13, clamp(elev * 2.2)), lerp(0.72, 0.32, clamp(elev * 2.4)), lerp(0.56, 0.72, clamp(elev * 2.0)));
    sun.intensity = lerp(1.5, 3.1, clamp(elev * 2.6));
    hemi.intensity = lerp(0.42, 0.72, clamp(elev * 2.2));
    const hazeCol = new THREE.Color().setHSL(lerp(0.06, 0.56, clamp(elev * 1.6)), lerp(0.30, 0.20, clamp(elev * 1.8)), lerp(0.60, 0.70, clamp(elev * 1.4)));
    skyMat.uniforms.uHaze.value = 1;
    scene.fog.color.copy(hazeCol);
    scene.fog.density = lerp(0.0026, 0.0005, clamp(elev * 2.6));
    seaMat.uniforms.uDeep.value.setHSL(lerp(0.56, 0.53, clamp(elev)), lerp(0.42, 0.34, clamp(elev)), lerp(0.075, 0.14, clamp(elev * 2)));
    seaMat.uniforms.uShallow.value.setHSL(lerp(0.53, 0.51, clamp(elev)), lerp(0.46, 0.36, clamp(elev)), lerp(0.13, 0.26, clamp(elev * 2)));
    seaMat.uniforms.uSky.value.copy(hazeCol).multiplyScalar(lerp(0.5, 0.9, clamp(elev * 2)));

    const cx = ctx.focusX != null ? ctx.focusX : 0;
    const cz = ctx.focusZ != null ? ctx.focusZ : 0;
    terrain.position.x = Math.round(cx / 20) * 20;
    terrain.position.z = Math.round(cz / 20) * 20;
    sky.position.set(ctx.cameraX || cx, 0, ctx.cameraZ || 0);
    sea.position.x = Math.round(cx / 40) * 40;
    sea.position.z = -46;

    seaMat.uniforms.uTime.value = t;
    seaMat.uniforms.uSunDir.value.copy(sunDir);
    seaMat.uniforms.uSunCol.value.setRGB(1.0, 0.72, 0.42).multiplyScalar(lerp(0.7, 1.5, clamp(elev * 2.4)));

    for (const c of clouds) {
      c.position.x += c.userData.speed * dt * state.wind;
      if (c.position.x > 460) c.position.x = -460;
    }

    for (const g of gulls) {
      const u = g.userData;
      const a = t * u.speed + u.phase;
      const r = u.r;
      gp.set(u.cx + Math.cos(a) * r * u.dir, u.height + Math.sin(a * 2.2) * 1.6, u.cz + Math.sin(a) * r * 0.55);
      g.position.copy(gp);
      g.rotation.y = -a + (u.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      u.wings.rotation.z = Math.sin(t * u.flap * 3.2 + u.phase) * 0.5;
      const bank = Math.cos(a) * 0.3 * u.dir;
      g.rotation.z = bank;
    }

    blades.rotation.z += dt * (0.5 + state.wind * 1.4);
    if (ctx.speed != null) {
      const wobble = Math.sin(ctx.speed * 4) * 0.02;
      blades.rotation.z += wobble * dt;
    }
  }

  function setQuality(level) {
    quality.level = level;
    const m = level === 'high' ? 2048 : level === 'medium' ? 1024 : 512;
    sun.shadow.mapSize.set(m, m);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    grass.visible = level !== 'low';
    cloudGroup.visible = true;
  }

  return {
    group, sun, hemi, fill, rim, fog, sea, terrain, road, windmill,
    state, update, setQuality, sunDir,
    roadHeight, terrainHeight,
    fogColor: () => scene.fog.color,
  };
}
