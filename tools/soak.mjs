// Soak test: plays the game with deliberately chaotic input for several minutes
// and reports any uncaught error, plus memory / frame-time drift over the run.
// Meant to reproduce "it crashed while I was playing".
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8129;
const MINUTES = Number(process.env.MINUTES || 5);
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
  args: ['--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--mute-audio',
         '--js-flags=--expose-gc', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });

const fatal = [];
page.on('pageerror', e => fatal.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
page.on('console', m => { if (m.type() === 'error') fatal.push('[console] ' + m.text()); });
page.on('crash', () => fatal.push('[PAGE CRASHED]'));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.GAME && window.GAME.loaded, null, { timeout: 180000 });

await page.evaluate(() => {
  window.DEPLOY();
  const g = window.GAME;
  g.applyQuality(0);

  // Count every error thrown out of the frame loop, and keep going so one bad
  // frame does not hide everything that follows.
  window.LOOP_ERRORS = [];
  const origUpdate = g.update.bind(g);
  const origRender = g.render.bind(g);
  g.update = (dt) => {
    try { window.CHAOS && window.CHAOS(dt); } catch (e) { window.LOOP_ERRORS.push('chaos: ' + e.message + '\\n' + e.stack); }
    try { origUpdate(dt); } catch (e) { window.LOOP_ERRORS.push('update: ' + e.message + '\\n' + e.stack); throw e; }
  };
  g.render = () => {
    try { origRender(); } catch (e) { window.LOOP_ERRORS.push('render: ' + e.message + '\\n' + e.stack); throw e; }
  };

  // ---- chaos monkey: everything a real player does, faster and in worse order
  const p = g.player;
  let t = 0, act = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  window.CHAOS = (dt) => {
    t += dt; act -= dt;
    if (!p.alive) return;

    // constant look + movement
    p.onMouseMove(Math.sin(t * 2.3) * 22, Math.cos(t * 1.7) * 9);
    p.keys.KeyW = Math.sin(t * 0.7) > -0.4;
    p.keys.KeyA = Math.sin(t * 1.1) > 0.6;
    p.keys.KeyD = Math.cos(t * 0.9) > 0.6;
    p.keys.ShiftLeft = Math.sin(t * 0.5) > 0.3;
    p.keys.ControlLeft = Math.sin(t * 1.9) > 0.85;
    p.keys.Space = Math.sin(t * 3.1) > 0.95;

    // fire and aim most of the time
    p.mouse.left = Math.sin(t * 4.7) > -0.2;
    p.mouse.right = Math.sin(t * 1.3) > 0.1;

    if (act > 0) return;
    act = rnd(0.05, 0.35);
    const r = Math.random();
    if (r < 0.30) {
      // the interesting case: slam weapon slots while aiming down sights
      p.onKey(['Digit1', 'Digit2', 'Digit3', 'KeyG', 'KeyQ'][(Math.random() * 5) | 0], true);
    } else if (r < 0.45) {
      p.onKey('KeyR', true);
    } else if (r < 0.52) {
      p.onWheel(Math.random() > 0.5 ? 1 : -1);
    } else if (r < 0.58) {
      // grenade spam
      p.switchSlot('grenade');
      p.mouse.left = true;
    } else if (r < 0.62) {
      // teleport somewhere random, including onto rooftops
      const n = (Math.random() * g.nav.nx.length) | 0;
      p.pos.set(g.nav.nx[n], g.nav.ny[n] + 0.1, g.nav.nz[n]);
      p.vel.set(0, 0, 0);
    } else if (r < 0.65) {
      // die
      g.damagePlayer(999, null, p.pos);
    }
  };
});

console.log(`soaking for ${MINUTES} min…`);
const t0 = Date.now();
let last = null;
const samples = [];
while ((Date.now() - t0) / 60000 < MINUTES) {
  await page.waitForTimeout(15000);
  const s = await page.evaluate(() => {
    const g = window.GAME;
    return {
      t: Math.round(g.time), alive: g.player.alive, running: g.running, over: g.over,
      score: `${g.score.blue}-${g.score.red}`,
      kd: `${g.player.kills}/${g.player.deaths}`,
      slot: g.player.slot,
      grenades: g.grenades.length,
      loopErrors: (window.LOOP_ERRORS || []).length,
      firstError: (window.LOOP_ERRORS || [])[0] || null,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      geometries: g.renderer.info.memory.geometries,
      textures: g.renderer.info.memory.textures,
      programs: g.renderer.info.programs ? g.renderer.info.programs.length : null,
      sceneChildren: g.scene.children.length,
      audioNodes: g.audio.ctx ? g.audio.ctx.currentTime.toFixed(0) : 'n/a',
      chars: g.characters.length,
    };
  }).catch(e => ({ dead: String(e).slice(0, 200) }));
  samples.push(s);
  console.log(' ', JSON.stringify(s));
  if (s.dead || s.loopErrors) break;
  last = s;
}

const errs = await page.evaluate(() => window.LOOP_ERRORS || []).catch(() => []);
console.log('\n--- RESULT ---');
if (errs.length) {
  console.log(`LOOP ERRORS (${errs.length}); first 3:`);
  console.log([...new Set(errs)].slice(0, 3).join('\n\n'));
} else console.log('no errors thrown out of the frame loop');
if (fatal.length) {
  console.log('\nPAGE ERRORS:');
  console.log([...new Set(fatal)].slice(0, 6).join('\n\n'));
} else console.log('no page-level errors');

if (samples.length > 1) {
  const a = samples[0], b = samples[samples.length - 1];
  console.log(`\nheap ${a.heapMB} -> ${b.heapMB} MB   geometries ${a.geometries} -> ${b.geometries}   ` +
              `textures ${a.textures} -> ${b.textures}   programs ${a.programs} -> ${b.programs}   ` +
              `sceneChildren ${a.sceneChildren} -> ${b.sceneChildren}`);
}

await browser.close();
server.close();
