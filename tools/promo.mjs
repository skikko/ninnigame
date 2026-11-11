// Crea copertine e video per CrazyGames usando la modalità vetrina del gioco (?promo=1).
// Uso: node tools/promo.mjs <url del gioco> <cartella di uscita> [misure, es. 630x500,512x384]
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

async function cover(name, w, h) {
  await open(w, h);
  await js('__promo.prepare([4, 5]); __promo.run(260); __promo.frame(0, 1)');
  save(join(OUT, name), await js("__promo.shot('image/png')"));
  console.log('copertina', name);
}

async function video(name, w, h, seconds) {
  await open(w, h);
  const dir = mkdtempSync(join(tmpdir(), 'hoop-frames-'));
  await js('__promo.prepare([1, 2]); __promo.run(30)');
  const total = seconds * 30;
  for (let f = 0; f < total; f++) {
    // primo secondo: la copertina ferma, poi il titolo sfuma e parte il gioco
    const alpha = f < 30 ? 1 : f < 50 ? 1 - (f - 30) / 20 : 0;
    const steps = f < 30 ? 0 : 2;
    save(join(dir, String(f).padStart(5, '0') + '.jpg'), await js(`__promo.frame(${steps}, ${alpha}); __promo.shot('image/jpeg', 0.92)`));
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '30', '-i', join(dir, '%05d.jpg'), '-an',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', join(OUT, name)]);
  rmSync(dir, { recursive: true, force: true });
  console.log('video', name);
}

try {
  await connect();
  await cdp('Page.enable'); await cdp('Runtime.enable');
  // solo copertine nelle misure indicate, es: node tools/promo.mjs <url> <cartella> 630x500,512x384
  const only = process.argv[4];
  if (only) {
    for (const sz of only.split(',')) { const [w, h] = sz.split('x').map(Number); await cover(`cover-${w}x${h}.png`, w, h); }
    process.exit(0);
  }
  await cover('cover-landscape-1920x1080.png', 1920, 1080);
  await cover('cover-portrait-800x1200.png', 800, 1200);
  await cover('cover-square-800x800.png', 800, 800);
  await video('video-landscape-1920x1080.mp4', 1920, 1080, 18);
  await video('video-portrait-1080x1620.mp4', 1080, 1620, 18);
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
