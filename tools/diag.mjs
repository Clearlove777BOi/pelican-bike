import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN;
const URL_ = process.env.TARGET_URL || 'http://127.0.0.1:8099/index.html';
const userDir = mkdtempSync(join(tmpdir(), 'dg-'));
const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9337', `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader', '--window-size=800,450', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9337/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  throw new Error('no cdp');
}
const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const thrown = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    thrown.push((d.exception && d.exception.description) || d.text);
  }
};
function send(method, params = {}, to = 60000) {
  const mid = ++id;
  return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, to); });
}
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }, 30000)).result.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await sleep(12000);
await ev(`document.getElementById('enter')?.click()`);
await sleep(2500);

console.log('CAM AUTO: ' + await ev(`String(window.__pelican.runtime.camAuto)`));
console.log('DIRECTOR ERR (manual call):');
console.log(await ev(`(() => {
  const p = window.__pelican;
  try {
    p.director.update(p.runtime.realTime, 0.016, {
      rigPos: new p.THREE.Vector3(0,8,8.5),
      shake: 0, speed: 1,
      groundAt: (x,z) => p.env.terrainHeight(x,z),
    });
    return 'OK total=' + p.director.state.total;
  } catch (e) { return 'THREW: ' + (e && e.stack ? e.stack.split('\\n').slice(0,4).join(' >> ') : String(e)); }
})()`));

console.log('THROWN COUNT: ' + thrown.length);
for (const t of thrown.slice(0, 3)) console.log('  ' + String(t).split('\n').slice(0, 4).join(' >> '));

ws.close(); proc.kill(); process.exit(0);
