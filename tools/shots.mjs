import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN;
const URL_ = process.env.TARGET_URL || 'http://127.0.0.1:8099/index.html';
const OUTDIR = process.env.OUTDIR || '.';
const userDir = mkdtempSync(join(tmpdir(), 'sh-'));
const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9338', `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader', '--window-size=960,540', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9338/json/list')).json();
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
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }, 40000)).result.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await sleep(12000);
await ev(`document.getElementById('enter')?.click()`);
await sleep(2500);
// hide the console panel so the shot fills the frame
await ev(`document.getElementById('panel')?.classList.remove('on')`);

const N = Number(process.env.SHOTS || 4);
for (let i = 0; i < N; i++) {
  await ev(`(() => { const d = window.__pelican.director; d.setShot(${i}); return d.shotName; })()`);
  await sleep(4200);
  const name = await ev(`window.__pelican.director.shotName`);
  const t = await ev(`+window.__pelican.runtime.filmTime.toFixed(2)`);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, 150000);
  const file = join(OUTDIR, `shot-${i}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`shot ${i}: ${name} (t=${t}) -> ${file}`);
}
ws.close(); proc.kill(); process.exit(0);
