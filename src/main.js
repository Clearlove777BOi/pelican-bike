import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, DEG, noise1, easeInOutSine, rng, damp, formatInt } from './lib/core.js';
import { createPelican } from './objects/pelican.js';
import { createBicycle } from './objects/bicycle.js';
import { createEnvironment } from './objects/environment.js';
import { createRig } from './objects/rig.js';
import { createDirector } from './core/camera.js';
import { createAudio } from './core/audio.js';
import { createPost } from './core/post.js';

const boot = document.getElementById('boot');
const bootBar = document.querySelector('#bar i');
const bootMsg = document.getElementById('boot-msg');
const bootErr = document.getElementById('boot-err');
const enterBtn = document.getElementById('enter');
const enterK = document.getElementById('enter-k');
const hud = document.getElementById('hud');
const panel = document.getElementById('panel');
const toggleBtn = document.getElementById('toggle');

const statFps = document.getElementById('s-fps');
const statMs = document.getElementById('s-ms');
const statTri = document.getElementById('s-tri');
const statDraw = document.getElementById('s-draw');

const ui = {
  hour: document.getElementById('c-hour'),
  tempo: document.getElementById('c-tempo'),
  flap: document.getElementById('c-flap'),
  wind: document.getElementById('c-wind'),
  vol: document.getElementById('c-vol'),
  tilt: document.getElementById('c-tilt'),
  oHour: document.getElementById('o-hour'),
  oTempo: document.getElementById('o-tempo'),
  oFlap: document.getElementById('o-flap'),
  oWind: document.getElementById('o-wind'),
  oVol: document.getElementById('o-vol'),
  oTilt: document.getElementById('o-tilt'),
  camBtn: document.getElementById('b-cam'),
  shakeBtn: document.getElementById('b-shake'),
  shadowBtn: document.getElementById('b-shadow'),
  bloomBtn: document.getElementById('b-bloom'),
  qualityBtn: document.getElementById('b-quality'),
  helpBtn: document.getElementById('b-help'),
  hint: document.getElementById('panel-hint'),
};

let progress = 0;
function setProgress(p, msg) {
  progress = Math.max(progress, clamp(p));
  bootBar.style.transform = `scaleX(${progress.toFixed(3)})`;
  if (msg) bootMsg.textContent = msg;
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function fail(err) {
  console.error(err);
  bootErr.classList.add('on');
  bootErr.textContent = '场景装配失败：' + (err && err.message ? err.message : String(err)) +
    '\n\n请确认能访问 cdn.jsdelivr.net（three.js 由 CDN 提供），或改用本地 three。';
  bootMsg.textContent = '出了点问题';
}

const settings = {
  hour: 0.38,
  tempo: 1,
  flap: 0.5,
  wind: 1,
  volume: 0.55,
  tilt: 0.35,
  shake: true,
  shadows: true,
  bloom: true,
  quality: 'high',
  camAuto: true,
};

const runtime = {
  speed: 1.05,
  lean: 0,
  leanAmt: 0.35,
  shake: 0,
  fade: 0,
  realTime: 0,
  mouse: { x: 0, y: 0 },
  orbit: { yaw: 0.5, pitch: 0.25, dist: 5.2, manual: false },
};

let renderer, scene, camera, post, env, pelican, bicycle, rig, director, audio;
let clock;

async function build() {
  await setProgress(0.04, '创建渲染器…');  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.08, 2200);
  camera.position.set(6, 3, 6);
  camera.userData = { focus: 3, aperture: 0.15, shot: '' };
  scene.add(camera);

  await setProgress(0.16, '搭建海岸、天空和海…');
  env = createEnvironment(scene, renderer);

  await setProgress(0.44, '编织羽毛…');
  pelican = createPelican(renderer);

  await setProgress(0.60, '组装自行车…');
  bicycle = createBicycle();

  await setProgress(0.70, '绑定骑手与坐骑…');
  rig = createRig(pelican, bicycle);
  const startX = 0;
  rig.group.position.set(startX, env.roadHeight(startX, 8.5) + 0.02, 8.5);
  scene.add(rig.group);

  await setProgress(0.80, '注册镜头…');
  director = createDirector(camera);

  await setProgress(0.88, '准备声音…');
  audio = createAudio();

  await setProgress(0.94, '编译着色器…');
  post = createPost(renderer, scene, camera);
  post.setSize(window.innerWidth, window.innerHeight);
  bindControls();

  await setProgress(1.0, '就绪');
  enterBtn.disabled = false;
  enterK.textContent = 'Press Enter';
  clock = new THREE.Clock();
  window.__pelican = { renderer, scene, camera, post, env, pelican, bicycle, rig, director, audio, settings, runtime, THREE };
  requestAnimationFrame(loop);
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  post.setSize(w, h);
}

function bindControls() {
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); director.toggle(); }
    else if (e.code === 'KeyC') { director.next(); }
    else if (e.code === 'KeyH') { togglePanel(); }
    else if (e.code === 'KeyF') { toggleFullscreen(); }
    else if (e.code === 'KeyB') { audio.chime(); }
    else if (e.code === 'KeyG') { audio.gullCry(); }
  });
  let drag = false, lastX = 0, lastY = 0;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0 || e.pointerType === 'touch') {
      drag = true;
      lastX = e.clientX; lastY = e.clientY;
      runtime.orbit.manual = true;
      runtime.camAuto = false;
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    runtime.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    runtime.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    if (!drag) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    runtime.orbit.yaw -= dx * 0.006;
    runtime.orbit.pitch = clamp(runtime.orbit.pitch + dy * 0.004, -0.5, 1.3);
  });
  const endDrag = (e) => {
    drag = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    runtime.orbit.dist = clamp(runtime.orbit.dist * (1 + e.deltaY * 0.0009), 1.6, 26);
    runtime.orbit.manual = true;
    runtime.camAuto = false;
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    runtime.camAuto = true;
    runtime.orbit.manual = false;
  });

  ui.hour.addEventListener('input', () => {
    settings.hour = parseFloat(ui.hour.value);
    env.state.dayT = settings.hour;
  });
  ui.tempo.addEventListener('input', () => {
    settings.tempo = parseFloat(ui.tempo.value);
  });
  ui.flap.addEventListener('input', () => {
    settings.flap = parseFloat(ui.flap.value);
    pelican.flap = settings.flap;
  });
  ui.wind.addEventListener('input', () => {
    settings.wind = parseFloat(ui.wind.value);
    env.state.wind = settings.wind;
  });
  ui.vol.addEventListener('input', () => {
    settings.volume = parseFloat(ui.vol.value);
    audio.setVolume(settings.volume);
  });
  ui.tilt.addEventListener('input', () => {
    settings.tilt = parseFloat(ui.tilt.value);
    runtime.leanAmt = settings.tilt;
  });
  ui.camBtn.addEventListener('click', () => { director.next(); switchHint('机位：' + director.shotName + ' — ' + director.shotDesc); });
  ui.shakeBtn.addEventListener('click', () => {
    settings.shake = !settings.shake;
    ui.shakeBtn.setAttribute('aria-pressed', String(settings.shake));
  });
  ui.shadowBtn.addEventListener('click', () => {
    settings.shadows = !settings.shadows;
    renderer.shadowMap.enabled = settings.shadows;
    ui.shadowBtn.setAttribute('aria-pressed', String(settings.shadows));
    scene.traverse((o) => { if (o.isMesh) o.material && (o.material.needsUpdate = true); });
  });
  ui.bloomBtn.addEventListener('click', () => {
    settings.bloom = !settings.bloom;
    post.enabled = settings.bloom;
    ui.bloomBtn.setAttribute('aria-pressed', String(settings.bloom));
  });
  ui.qualityBtn.addEventListener('click', () => {
    const order = ['high', 'medium', 'low'];
    const i = order.indexOf(settings.quality);
    settings.quality = order[(i + 1) % order.length];
    post.setQuality(settings.quality);
    env.setQuality(settings.quality);
    const label = { high: '高', medium: '中', low: '低' }[settings.quality];
    ui.qualityBtn.textContent = '画质 ' + label;
    const pr = settings.quality === 'high' ? 1.6 : settings.quality === 'medium' ? 1.25 : 1.0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pr));
    onResize();
  });
  ui.helpBtn.addEventListener('click', () => {
    switchHint('Space 播放/暂停 · C 换机位 · H 收起面板 · F 全屏 · B 铃铛 · G 海鸥 · 拖拽旋转 · 滚轮缩放 · 双击回到自动镜头');
  });

  ui.hour.value = String(settings.hour);
  ui.tempo.value = String(settings.tempo);
  ui.flap.value = String(settings.flap);
  ui.wind.value = String(settings.wind);
  ui.vol.value = String(settings.volume);
  ui.tilt.value = String(settings.tilt);
  pelican.flap = settings.flap;
  env.state.wind = settings.wind;

  toggleBtn.addEventListener('click', togglePanel);
}

let hintTimer = null;
function switchHint(text) {
  ui.hint.textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    ui.hint.textContent = '拖拽旋转 · 滚轮缩放 · 右键平移';
  }, 6000);
}

function togglePanel() {
  panel.classList.toggle('on');
}

function toggleFullscreen() {
  const d = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen();
  else if (d.requestFullscreen) d.requestFullscreen();
}

function start() {
  boot.classList.add('done');
  hud.classList.add('on');
  panel.classList.add('on');
  audio.init();
  audio.resume();
  audio.setVolume(settings.volume);
  director.state.playing = true;
}

let frames = 0, fpsAcc = 0, fpsTimer = 0, msAcc = 0;
function loop() {
  requestAnimationFrame(loop);
  if (!clock) clock = new THREE.Clock();
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  runtime.realTime = t;

  runtime.speed = damp(runtime.speed, 1.05 * settings.tempo, 2.0, dt);
  runtime.leanAmt = settings.tilt;

  const rigState = rig.update(t, dt, {
    speedTarget: runtime.speed,
    lean: runtime.leanAmt,
    steerAmt: 0.5,
    flap: settings.flap,
    pouch: 0.15 + 0.1 * Math.sin(t * 0.4),
    jawOpen: Math.max(0, Math.sin(t * 0.31) - 0.85) * 2.6,
    wingFold: 1,
    roadHeight: env.roadHeight,
    roadSlope: (x, z) => {
      const d = 0.6;
      return (env.roadHeight(x + d, z) - env.roadHeight(x - d, z)) / (2 * d);
    },
  });

  const pos = new THREE.Vector3();
  rig.group.getWorldPosition(pos);

  runtime.shake = clamp(Math.abs(runtime.speed - 1.05) * 0.5 + 0.12, 0, 0.5);

  if (runtime.camAuto) {
    director.update(t, dt, {
      rigPos: pos,
      shake: settings.shake ? runtime.shake : 0,
      speed: runtime.speed,
      groundAt: (x, z) => env.terrainHeight(x, z),
      focusX: pos.x,
      focusZ: pos.z,
    });
  } else {
    const o = runtime.orbit;
    const target = pos.clone().add(new THREE.Vector3(0, 0.75, 0));
    const px = target.x + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist;
    const pz = target.z + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist;
    const py = target.y + Math.sin(o.pitch) * o.dist;
    camera.position.lerp(new THREE.Vector3(px, py, pz), 1 - Math.exp(-8 * dt));
    camera.lookAt(target);
    camera.userData.focus = camera.position.distanceTo(target);
    camera.userData.aperture = 0.22;
    camera.fov = lerp(camera.fov, 36, 1 - Math.exp(-5 * dt));
    camera.updateProjectionMatrix();
  }

  env.update(t, dt, {
    cameraX: camera.position.x,
    cameraZ: camera.position.z,
    focusX: pos.x,
    focusZ: pos.z,
    speed: runtime.speed,
  });

  audio.update(dt, { speed: runtime.speed, wind: settings.wind });

  if (settings.shadows) {
    env.sun.position.copy(env.sunDir).multiplyScalar(90).add(pos);
    env.sun.target.position.copy(pos);
    env.sun.target.updateMatrixWorld();
  }

  post.render({ realTime: t, fade: runtime.fade });

  frames++;
  fpsAcc += dt;
  fpsTimer += dt;
  msAcc += dt;
  if (fpsTimer > 0.5) {
    const info = renderer.info.render;
    statFps.textContent = String(Math.round(frames / fpsAcc));
    statMs.textContent = (msAcc / frames * 1000).toFixed(1);
    statTri.textContent = formatInt(info.triangles);
    statDraw.textContent = String(info.calls);
    frames = 0; fpsAcc = 0; fpsTimer = 0; msAcc = 0;
  }
}

enterBtn.addEventListener('click', start);
window.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !enterBtn.disabled && boot && !boot.classList.contains('done')) {
    e.preventDefault();
    start();
  }
});

build().catch(fail);
