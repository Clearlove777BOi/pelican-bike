import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN;
const URL_ = process.env.TARGET_URL || 'http://127.0.0.1:8099/index.html';
const userDir = mkdtempSync(join(tmpdir(), 'ad-'));
const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9340', `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader', '--window-size=960,540', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wsUrl() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9340/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  throw new Error('no cdp');
}
const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
function send(method, params = {}, to = 60000) {
  const mid = ++id;
  return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, to); });
}
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 60000)).result.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await sleep(12000);
for (let i = 0; i < 40 && !(await ev(`!!window.__pelican`)); i++) await sleep(1000);
await ev(`document.getElementById('enter')?.click()`);
await sleep(2000);

console.log('ADAPT ALIVE? ' + await ev(`typeof window.__pelican.adapt`));
for (let i = 0; i < 7; i++) {
  const s = await ev(`(() => {
    const p = window.__pelican;
    return JSON.stringify({
      level: p.adapt ? p.adapt.level : 'n/a',
      cooldown: p.adapt ? +p.adapt.cooldown.toFixed(1) : 'n/a',
      dofOn: p.runtime.dofOn,
      shadows: p.renderer.shadowMap.enabled,
      dpr: +p.renderer.getPixelRatio().toFixed(2),
      grassCount: p.scene.getObjectByName('grass')?.count,
      adaptive: p.settings.adaptive,
    });
  })()`);
  console.log(`  t+${i * 3}s  ${s}`);
  await sleep(3000);
}
console.log('ERRORS: ' + errs.slice(0, 3).join(' | '));
ws.close(); proc.kill(); process.exit(0);
