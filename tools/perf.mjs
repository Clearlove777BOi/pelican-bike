import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN;
const URL_ = process.env.TARGET_URL || 'http://127.0.0.1:8099/index.html';
const userDir = mkdtempSync(join(tmpdir(), 'perf-'));
const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9339', `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader', '--window-size=960,540', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9339/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  throw new Error('no cdp');
}
const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
function send(method, params = {}, to = 90000) {
  const mid = ++id;
  return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, to); });
}
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 60000)).result.value;

// measure average frame time for `ms` milliseconds
const measure = async (ms) => ev(`new Promise((resolve) => {
  let n = 0; const t0 = performance.now();
  const tick = () => {
    n++;
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
    else resolve(+((performance.now() - t0) / n).toFixed(1));
  };
  requestAnimationFrame(tick);
})`);

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await sleep(12000);
await ev(`document.getElementById('enter')?.click()`);
await sleep(2500);
await ev(`document.getElementById('panel')?.classList.remove('on')`);

const rows = [];
const base = await measure(3000);
rows.push(['baseline (everything on)', base]);

await ev(`window.__pelican.post.enabled = false`);
rows.push(['post-processing OFF', await measure(2500)]);
await ev(`window.__pelican.post.enabled = true`);

await ev(`(() => { const p = window.__pelican; p.renderer.shadowMap.enabled = false; p.scene.traverse(o => { if (o.isMesh) o.material && (o.material.needsUpdate = true); }); })()`);
rows.push(['shadows OFF', await measure(2500)]);
await ev(`(() => { const p = window.__pelican; p.renderer.shadowMap.enabled = true; p.scene.traverse(o => { if (o.isMesh) o.material && (o.material.needsUpdate = true); }); })()`);

await ev(`(() => { const p = window.__pelican; p.scene.getObjectByName('grass').visible = false; })()`);
rows.push(['grass (5000 tufts) OFF', await measure(2500)]);
await ev(`(() => { const p = window.__pelican; p.scene.getObjectByName('grass').visible = true; })()`);

await ev(`(() => { const p = window.__pelican; p.scene.getObjectByName('sea').visible = false; })()`);
rows.push(['sea OFF', await measure(2500)]);
await ev(`(() => { const p = window.__pelican; p.scene.getObjectByName('sea').visible = true; })()`);

// DoF specifically: pin aperture to 0 (shader becomes a straight copy)
await ev(`window.__pelican.director._savedAuto = null; window.__pelican.camera.userData.aperture = 0;`);
rows.push(['DoF OFF (aperture=0)', await measure(2500)]);

console.log('FRAME TIME (ms, lower is better)');
for (const [k, v] of rows) console.log('  ' + String(v).padStart(7) + ' ms   ' + k);

const info = await ev(`JSON.stringify({
  drawCalls: window.__pelican.renderer.info.render.calls,
  tris: window.__pelican.renderer.info.render.triangles,
  dpr: window.__pelican.renderer.getPixelRatio(),
  size: [window.innerWidth, window.innerHeight],
})`);
console.log('RENDER: ' + info);

ws.close(); proc.kill(); process.exit(0);
