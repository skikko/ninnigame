// Crea 3 screenshot di gioco vero (con interfaccia) per le schede dei portali.
// Uso: node tools/promo.mjs <url del gioco> <cartella di uscita>
// Richiede Google Chrome e ffmpeg installati.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL_GAME = process.argv[2] || 'http://localhost:8765/index.html';
const OUT = process.argv[3] || 'promo';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'hoop-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, id = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('Chrome non risponde');
}
function cdp(method, params = {}) {
  return new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
}
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
}
async function open(w, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: URL_GAME + (URL_GAME.includes('?') ? '&' : '?') + 'promo=1' });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await js('!!window.__promo').catch(() => false)) break; }
  await sleep(300);
}
const save = (file, dataUrl) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

async function shot(name, level, seconds, pattern) {
  await open(1920, 1080);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: URL_GAME });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await js('!!window.__game').catch(() => false)) break; }
  await sleep(500);
  await js(`(() => { const g = __game; g.start(${level}); const [pa, ha, pb, hb] = ${JSON.stringify(pattern)};
    for (let f = 0; f < ${seconds} * 60; f++) { if (f % pa === 0) g.down(0, 'a'); if (f % pa === ha) g.up('a'); if (f % pb === 7) g.down(1, 'b'); if (f % pb === 7 + hb) g.up('b'); g.step(); }
    g.down(0, 'a'); g.down(1, 'b'); for (let i = 0; i < 12; i++) g.step(); })()`);
  await sleep(400);
  save(join(OUT, name), await js("document.getElementById('c').toDataURL('image/png')"));
  console.log('screenshot', name);
}
try {
  await connect();
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await shot('screenshot-1.png', 0, 40, [50, 25, 60, 30]);
  await shot('screenshot-2.png', 1, 30, [40, 20, 45, 22]);
  await shot('screenshot-3.png', 4, 45, [50, 25, 60, 30]);
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
