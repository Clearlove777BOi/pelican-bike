import * as THREE from 'three';
import { clamp, lerp, smoothstep, DEG, noise1, easeInOutSine } from '../lib/core.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// Every shot is authored RELATIVE to the rider: `f.y` is the rig's world height,
// so a camera 1.2 m up is 1.2 m above the road wherever the road happens to be.
const SHOTS = [
  {
    name: '建立镜头', dur: 12, lens: 34,
    desc: '远景，从海岸线外推近，主角沿公路骑行',
    fn(t, u, f, cam) {
      const a = t * 0.045 + 2.15;
      const dist = lerp(14.5, 7.2, easeInOutSine(clamp(u * 1.25)));
      cam.position.set(f.x + Math.cos(a) * dist, f.y + lerp(3.4, 1.7, easeInOutSine(clamp(u * 1.2))), f.z + Math.sin(a) * dist * 0.8 - 1.2);
      cam.target.set(f.x + 0.35, f.y + 0.66, f.z);
      cam.roll = Math.sin(t * 0.21) * 0.6;
      cam.fovBias = lerp(1.06, 1.0, u);
    },
  },
  {
    name: '侧跟', dur: 14, lens: 40,
    desc: '与车并行的低位侧跟，看腿和曲柄的循环',
    fn(t, u, f, cam) {
      const dist = lerp(2.35, 2.05, Math.sin(u * Math.PI));
      cam.position.set(f.x + Math.sin(t * 0.06) * 0.35, f.y + lerp(0.82, 0.66, u), f.z - dist);
      cam.target.set(f.x + 0.12, f.y + 0.5, f.z + 0.06);
      cam.roll = Math.sin(t * 0.34) * 0.8 - 0.5;
      cam.fovBias = 1.0;
    },
  },
  {
    name: '长喙特写', dur: 11, lens: 52,
    desc: '低机位仰拍喙与喉囊，逆着海光',
    fn(t, u, f, cam) {
      const swing = Math.sin(t * 0.16) * 0.5;
      cam.position.set(f.x + lerp(1.75, 1.25, u), f.y + lerp(0.55, 0.86, Math.sin(u * Math.PI)), f.z + lerp(1.5, 1.05, u) + swing * 0.25);
      cam.target.set(f.x + 0.34, f.y + 0.68, f.z + 0.04);
      cam.roll = -1.0 + Math.sin(t * 0.27) * 0.6;
      cam.fovBias = 0.96;
    },
  },
  {
    name: '后视', dur: 9, lens: 36,
    desc: '从车后追，看尾羽与木箱一起颠',
    fn(t, u, f, cam) {
      cam.position.set(f.x - lerp(2.5, 1.85, u), f.y + lerp(0.95, 1.15, u), f.z + Math.sin(t * 0.3) * 0.45);
      cam.target.set(f.x + 0.25, f.y + 0.42, f.z + Math.sin(t * 0.3) * 0.18);
      cam.roll = Math.sin(t * 0.5) * 1.0;
      cam.fovBias = 1.02;
    },
  },
  {
    name: '掠地', dur: 13, lens: 30,
    desc: '机位几乎贴地，公路从镜头下流过去',
    fn(t, u, f, cam) {
      const a = t * 0.08;
      cam.position.set(f.x + Math.cos(a) * 5.6, f.y + 0.26 + Math.sin(t * 0.9) * 0.04, f.z + Math.sin(a) * 3.2 - 2.4);
      cam.target.set(f.x + 0.4, f.y + 0.66, f.z - 1.6);
      cam.roll = Math.sin(t * 0.22) * 1.3;
      cam.fovBias = 1.12;
    },
  },
  {
    name: '仰视', dur: 10, lens: 44,
    desc: '低角度仰拍，云和天空在背后',
    fn(t, u, f, cam) {
      cam.position.set(f.x + lerp(0.95, 1.35, u), f.y + 0.22, f.z + 2.1);
      cam.target.set(f.x + 0.08, f.y + 0.78, f.z);
      cam.roll = 0.7 + Math.sin(t * 0.19) * 0.8;
      cam.fovBias = 0.95;
    },
  },
  {
    name: '绕行', dur: 15, lens: 33,
    desc: '半环绕，看两侧羽翼的轮廓',
    fn(t, u, f, cam) {
      const a = lerp(-1.15, 1.55, u) + Math.sin(t * 0.1) * 0.18;
      const dist = 3.1 + Math.sin(u * Math.PI) * 0.65;
      cam.position.set(f.x + Math.cos(a) * dist, f.y + 1.05 + Math.sin(u * Math.PI) * 0.42, f.z + Math.sin(a) * dist);
      cam.target.set(f.x + 0.08, f.y + 0.54, f.z);
      cam.roll = Math.sin(u * Math.PI) * 2.0;
      cam.fovBias = 1.0;
    },
  },
  {
    name: '远推', dur: 13, lens: 46,
    desc: '拉远收尾，露出整条海岸线和雾',
    fn(t, u, f, cam) {
      const a = t * 0.035 + 0.7;
      const dist = lerp(3.8, 20, easeInOutSine(u));
      cam.position.set(f.x + Math.cos(a) * dist, f.y + lerp(1.1, 6.2, u), f.z + Math.sin(a) * dist * 0.72 - lerp(0.8, 4, u));
      cam.target.set(f.x + lerp(0.08, -1.2, u), f.y + lerp(0.55, 2.6, u), f.z - lerp(0, 2.4, u));
      cam.roll = Math.sin(t * 0.14) * 1.1;
      cam.fovBias = lerp(1.0, 1.12, u);
    },
  },
];

export function createDirector(camera) {
  const cam = { position: new THREE.Vector3(), target: new THREE.Vector3(), roll: 0, fovBias: 1, focus: 3, aperture: 0 };
  const focus = new THREE.Vector3();
  const state = { shot: 0, shotTime: 0, total: 0, playing: true, shake: 1, manual: false };
  const TOTAL = SHOTS.reduce((s, x) => s + x.dur, 0);

  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _m = new THREE.Matrix4();

  function shotAt(time) {
    let acc = 0;
    for (let i = 0; i < SHOTS.length; i++) {
      if (time < acc + SHOTS[i].dur) return { i, local: time - acc };
      acc += SHOTS[i].dur;
    }
    const last = SHOTS.length - 1;
    return { i: last, local: SHOTS[last].dur };
  }

  function update(t, dt, ctx) {
    const p = ctx.rigPos;
    focus.set(p.x, p.y, p.z);
    const { i, local } = shotAt(state.total);
    state.shot = i;
    const s = SHOTS[i];
    const u = clamp(local / s.dur);
    state.shotTime = local;

    cam.position.copy(focus);
    cam.target.copy(focus);
    cam.roll = 0;
    cam.fovBias = 1;
    s.fn(state.total, u, focus, cam);

    const shakeAmt = state.shake * (ctx.shake || 0);
    if (shakeAmt > 0.001) {
      const k = 0.013 * shakeAmt;
      cam.position.x += noise1(t * 8.1, 1) * k;
      cam.position.y += noise1(t * 9.3, 2) * k * 0.7;
      cam.position.z += noise1(t * 7.7, 3) * k;
      cam.roll += noise1(t * 6.3, 4) * 0.32 * shakeAmt;
    }

    // never let a camera sink into the ground
    if (ctx.groundAt) {
      const g = ctx.groundAt(cam.position.x, cam.position.z);
      if (g != null && isFinite(g)) cam.position.y = Math.max(cam.position.y, g + 0.32);
    }

    camera.position.copy(cam.position);
    _m.lookAt(cam.position, cam.target, UP);
    camera.quaternion.setFromRotationMatrix(_m);
    _e.set(0, 0, cam.roll * DEG, 'YXZ');
    camera.quaternion.multiply(_q.setFromEuler(_e));

    const targetFov = clamp(32 * s.lens / 40 * cam.fovBias, 16, 78);
    camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-4 * dt));
    camera.updateProjectionMatrix();

    camera.userData.focus = camera.position.distanceTo(cam.target);
    camera.userData.aperture = s.lens > 46 ? 0.3 : s.lens > 40 ? 0.2 : 0.1;
    camera.userData.shot = s.name;

    if (state.playing) {
      state.total += dt;
      if (state.total > TOTAL) state.total -= TOTAL;
    }
  }

  function setShot(idx) {
    let acc = 0;
    for (let i = 0; i < clamp(idx, 0, SHOTS.length - 1); i++) acc += SHOTS[i].dur;
    state.total = acc;
  }

  return {
    update, state, cam, shots: SHOTS, setShot,
    get shotName() { return SHOTS[state.shot].name; },
    get shotDesc() { return SHOTS[state.shot].desc; },
    get progress() { return { total: state.total, duration: TOTAL, index: state.shot, count: SHOTS.length }; },
    next() { setShot(state.shot + 1 >= SHOTS.length ? 0 : state.shot + 1); },
    toggle() { state.playing = !state.playing; },
  };
}
