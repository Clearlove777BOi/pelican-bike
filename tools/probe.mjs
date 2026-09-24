import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN;
const URL_ = process.env.TARGET_URL || 'http://127.0.0.1:8099/index.html';
const userDir = mkdtempSync(join(tmpdir(), 'cc-'));
const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader', '--window-size=960,540', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9334/json/list')).json();
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
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text);
};
function send(method, params = {}, to = 60000) {
  const mid = ++id;
  return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, to); });
}
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await sleep(12000);
await send('Runtime.evaluate', { expression: `document.getElementById('enter')?.click()`, returnByValue: true });
await sleep(9000);

const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const g = (i) => document.getElementById(i)?.textContent;
    return JSON.stringify({
      fps: g('s-fps'), ms: g('s-ms'), tri: g('s-tri'), draw: g('s-draw'),
      loopAlive: window.__pelican ? !!window.__pelican.renderer : false,
      realTime: window.__pelican ? +window.__pelican.runtime.realTime.toFixed(2) : null,
    });
  })()`,
  returnByValue: true,
});
console.log('STATS: ' + r.result.value);
console.log('ERRORS(' + errs.length + '): ' + errs.slice(0, 8).join(' | '));

const shot = await send('Page.captureScreenshot', { format: 'png' }, 120000);
writeFileSync(process.env.SHOT || 'probe.png', Buffer.from(shot.data, 'base64'));
ws.close(); proc.kill(); process.exit(0);
