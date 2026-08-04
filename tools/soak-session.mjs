// Session-level soak: repeatedly restarts matches, changes loadouts and quality,
// and pauses/resumes — the flow a real player goes through between rounds.
// Watches GPU resource counts for growth that a single-match soak cannot see.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8130;
const ROUNDS = Number(process.env.ROUNDS || 12);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({
  headless: process.env.HEADLESS !== '0', executablePath: '/usr/bin/google-chrome',
  args: ['--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--mute-audio', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const fatal = [];
page.on('pageerror', e => fatal.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`));
page.on('console', m => { if (m.type() === 'error') fatal.push('[console] ' + m.text()); });
page.on('crash', () => fatal.push('[PAGE CRASHED]'));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.GAME && window.GAME.loaded, null, { timeout: 180000 });
await page.evaluate(() => { window.GAME.applyQuality(0); });

const PRIMARIES = ['m4a1', 'ak74', 'mp5k', 'scarh', 'spas12', 'awm'];
const SECONDARIES = ['g18', 'deagle'];
const stat = () => page.evaluate(() => {
  const g = window.GAME;
  return {
    geo: g.renderer.info.memory.geometries,
    tex: g.renderer.info.memory.textures,
    prog: g.renderer.info.programs ? g.renderer.info.programs.length : null,
    kids: g.scene.children.length,
    map: g.mapId,
    chars: g.characters.length,
    nades: g.grenades.length,
    heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  };
});

console.log(`restarting ${ROUNDS} matches…`);
const first = [];
for (let i = 0; i < ROUNDS; i++) {
  await page.evaluate(async ({ i, PRIMARIES, SECONDARIES }) => {
    const g = window.GAME;
    Object.assign(g.settings, {
      // alternate maps so the rebuild path is exercised, not just restarts
      map: i % 2 === 0 ? 'district7' : 'foundry',
      primary: PRIMARIES[i % PRIMARIES.length],
      secondary: SECONDARIES[i % SECONDARIES.length],
      difficulty: i % 5,
      enemies: [3, 5, 7, 9][i % 4],
      allies: [0, 2, 4, 6][i % 4],
      quality: i % 2,
    });
    await window.DEPLOY();
    g.godMode = false;
    // throw a few grenades so some are in flight when the match restarts
    for (let k = 0; k < 3; k++) {
      g.player.switchSlot('grenade', true);
      g.player.grenades = 3;
      g.player.throwGrenade();
    }
    g.player.switchSlot('primary', true);
  }, { i, PRIMARIES, SECONDARIES });
  await page.waitForTimeout(3500);
  // pause / resume churn
  await page.evaluate(() => { window.GAME.paused = true; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.GAME.paused = false; });
  await page.waitForTimeout(1500);
  const s = await stat();
  if (i === 0) Object.assign(first, s);
  console.log(`  round ${String(i + 1).padStart(2)} ${JSON.stringify(s)}`);
}

console.log('\n--- RESULT ---');
if (fatal.length) console.log('PAGE ERRORS:\n' + [...new Set(fatal)].slice(0, 5).join('\n\n'));
else console.log('no page-level errors');

await browser.close();
server.close();
