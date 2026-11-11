// Crea le versioni del gioco per ogni portale partendo da index.html.
// Uso: node tools/build.mjs [--gd-id=<id del gioco su GameDistribution>]
// Risultato: dist/<portale>/index.html e dist/<portale>.zip (index.html alla radice dello zip)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const gdId = (process.argv.find(a => a.startsWith('--gd-id=')) || '').slice(8);
const src = readFileSync(join(ROOT, 'index.html'), 'utf8');

const CG_TAG = /<!-- SDK CrazyGames[^\n]*\n<script src="https:\/\/sdk\.crazygames\.com\/crazygames-sdk-v3\.js"><\/script>\n/;
const PWA_LINKS = /<link rel="manifest"[^\n]*\n<link rel="apple-touch-icon"[^\n]*\n<link rel="icon"[^\n]*\n/;

function must(re, text, what) { if (!re.test(text)) throw new Error('non trovato: ' + what); }
must(CG_TAG, src, 'script SDK CrazyGames');
must(PWA_LINKS, src, 'link del manifest');
must(/const PLATFORM = 'auto';/, src, 'costante PLATFORM');
must(/const GD_GAME_ID = '';/, src, 'costante GD_GAME_ID');

function build(name, { platform, keepCG, gameId = '' }) {
  let html = src
    .replace(/const PLATFORM = 'auto';/, `const PLATFORM = '${platform}';`)
    .replace(/const GD_GAME_ID = '';/, `const GD_GAME_ID = '${gameId}';`)
    .replace(PWA_LINKS, '');                       // sui portali niente icone da app: file unico
  if (!keepCG) html = html.replace(CG_TAG, '');   // nessun SDK di altri portali
  const dir = join(DIST, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  rmSync(join(DIST, name + '.zip'), { force: true });
  execFileSync('zip', ['-q', '-X', join('..', name + '.zip'), 'index.html'], { cwd: dir });
  console.log(`${name}: ${(html.length / 1024).toFixed(0)} KB${platform === 'gamedistribution' && !gameId ? '  (manca --gd-id: niente pubblicità)' : ''}`);
}

build('crazygames', { platform: 'crazygames', keepCG: true });
build('gamedistribution', { platform: 'gamedistribution', keepCG: false, gameId: gdId });
build('itch', { platform: 'none', keepCG: false });
