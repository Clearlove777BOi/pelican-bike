import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN;
const URL_ = process.env.TARGET_URL || 'http://127.0.0.1:8099/index.html';
const OUT = process.env.SHOT || 'shot.png';
const WAIT_MS = Number(process.env.WAIT_MS || 18000);

const userDir = mkdtempSync(join(tmpdir(), 'cc-'));
const args = [
  '--headless=new',
  '--remote-debugging-port=9333',
  `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1280,720',
  '--hide-scrollbars',
  '--mute-audio',
  'about:blank',
];

const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeErr = '';
proc.stderr.on('data', (d) => { chromeErr += d.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9333/json/list');
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  throw new Error('CDP page target not reachable.\n' + chromeErr.slice(-1500));
}

const ws = new WebSocket(await getWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const logs = [];
const errors = [];
const netFails = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    logs.push(`[${msg.params.type}] ${text}`);
    if (msg.params.type === 'error') errors.push(text);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    if (e.level === 'error') {
      if (e.source === 'network') netFails.push(e.text + ' ' + (e.url || ''));
      else errors.push(`[${e.source}] ${e.text}`);
    }
  } else if (msg.method === 'Network.loadingFailed') {
    netFails.push(`${msg.params.errorText} ${msg.params.type}`);
  }
};

function send(method, params = {}, timeoutMs = 45000) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error('timeout ' + method)); } }, timeoutMs);
  });
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: URL_ });
await sleep(WAIT_MS);

// click through the entry gate so the 3D scene renders
if (process.env.ENTER === '1') {
  try {
    await send('Runtime.evaluate', { expression: `document.getElementById('enter')?.click()`, returnByValue: true }, 25000);
  } catch (e) { /* continue */ }
  await sleep(Number(process.env.ENTER_WAIT || 9000));
}

// probe scene state
let probe = null;
try {
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const p = window.__pelican;
      if (!p) return JSON.stringify({ ready:false, boot: document.getElementById('boot-msg')?.textContent, err: document.getElementById('boot-err')?.textContent });
      const info = p.renderer.info.render;
      const v = (o) => { const x=new p.THREE.Vector3(); o.getWorldPosition(x); return x.toArray().map(n=>+n.toFixed(3)); };
      const B = p.bicycle.bones || {};
      const pb = p.pelican.bones;
      const out = {
        ready: true,
        pelicanRoot: v(p.pelican.group),
        bicycleRoot: v(p.bicycle.group),
        rigRoot: v(p.rig.group),
        pelicanHipL: v(pb.legL.hip),
        pelicanFootL: v(pb.legL.ankle),
        pelicanHead: v(pb.head),
        saddle: v(p.bicycle.geo.seatTop ? {getWorldPosition:(t)=>{const c=new p.THREE.Vector3(p.bicycle.geo.seatTop.x+0.045,p.bicycle.geo.seatTop.y+0.108,0);return p.bicycle.group.localToWorld(c)}} : pb.head),
        pedalL: null, pedalR: null,
        kids: p.pelican.group.children.length,
        pelicanPosLocal: p.pelican.group.position.toArray().map(n=>+n.toFixed(3)),
        bicyclePosLocal: p.bicycle.group.position.toArray().map(n=>+n.toFixed(3)),
      };
      return JSON.stringify(out);
    })()`,
    returnByValue: true,
  });
  probe = r.result.value;
} catch (e) {
  probe = JSON.stringify({ probeError: String(e) });
}

// advance time and re-check for render errors after animation
await sleep(2500);

let probe2 = null;
try {
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const p = window.__pelican;
      if (!p) return 'no';
      const info = p.renderer.info.render;
      return JSON.stringify({ shot: p.camera.userData.shot, t: +p.runtime.realTime.toFixed(2), calls: info.calls, tris: info.triangles });
    })()`,
    returnByValue: true,
  }, 90000);
  probe2 = r.result.value;
} catch (e) { probe2 = 'err ' + e; }

const shot = await send('Page.captureScreenshot', { format: 'png' }, 150000);
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

console.log('=== PROBE1 ===\n' + probe);
console.log('=== PROBE2 ===\n' + probe2);
console.log('=== CONSOLE (' + logs.length + ') ===');
for (const l of logs.slice(0, 40)) console.log(l);
console.log('=== ERRORS (' + errors.length + ') ===');
for (const e of errors.slice(0, 25)) console.log(e);
console.log('=== NET FAIL (' + netFails.length + ') ===');
for (const n of netFails.slice(0, 15)) console.log(n);
console.log('=== SHOT === ' + OUT);

ws.close();
proc.kill();
process.exit(errors.length ? 1 : 0);
