// Under-floor test.
//
// Drops the player from height, runs them down steep slopes, and sprints them
// across every map, checking after each frame that they are never below the
// surface they should be standing on. Falling faster than the step height in a
// single frame is the classic way to end up under a heightfield.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(8136, r));

const browser = await chromium.launch({
  headless: true, executablePath: '/usr/bin/google-chrome',
  args: ['--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:8136/', { waitUntil: 'load' });
await page.waitForFunction(() => window.GAME && window.GAME.loaded, null, { timeout: 180000 });

for (const map of ['district7', 'foundry', 'coldharbor']) {
  const r = await page.evaluate(async (map) => {
    const g = window.GAME;
    g.settings.map = map;
    await window.DEPLOY();
    g.godMode = true;
    g.freezeBots = true;
    const p = g.player;

    // The lowest legitimate standing height at an XZ: the heightfield if the map
    // has one, otherwise the ground plane. Casting down from overhead is wrong —
    // indoors it hits the roof and reports a player on the ground floor as
    // being ten metres underground.
    const floorAt = (x, z) => (g.physics.terrain ? g.physics.terrainHeight(x, z) : 0);

    let belowFrames = 0, worstDepth = 0, samples = 0, fellOut = 0;
    const check = () => {
      samples++;
      const f = floorAt(p.pos.x, p.pos.z);
      if (p.pos.y < f - 0.5) {
        belowFrames++;
        worstDepth = Math.max(worstDepth, f - p.pos.y);
      }
      if (p.pos.y < -25) fellOut++;
    };

    // --- 1. drops from height all over the map
    const B = g.mapInfo.bounds;
    for (let i = 0; i < 26; i++) {
      const x = B.minX + Math.random() * (B.maxX - B.minX);
      const z = B.minZ + Math.random() * (B.maxZ - B.minZ);
      p.pos.set(x, 40, z);
      p.vel.set(0, -30, 0);            // deliberately faster than the step height
      p.keys = {};
      for (let f = 0; f < 60; f++) {
        await new Promise(r => setTimeout(r, 16));
        check();
      }
    }

    // --- 2. sprint across the map in several directions
    for (const yaw of [0, 1.05, 2.1, 3.14, 4.2, 5.25]) {
      const n = (Math.random() * g.nav.nx.length) | 0;
      p.pos.set(g.nav.nx[n], g.nav.ny[n] + 0.2, g.nav.nz[n]);
      p.vel.set(0, 0, 0);
      p.yaw = yaw;
      p.keys = { KeyW: true, ShiftLeft: true };
      for (let f = 0; f < 110; f++) {
        await new Promise(r => setTimeout(r, 16));
        check();
      }
      p.keys = {};
    }

    // --- 3. jump repeatedly while running (landing hard on slopes)
    for (let i = 0; i < 6; i++) {
      const n = (Math.random() * g.nav.nx.length) | 0;
      p.pos.set(g.nav.nx[n], g.nav.ny[n] + 0.2, g.nav.nz[n]);
      p.vel.set(0, 0, 0);
      p.yaw = Math.random() * 6.28;
      for (let f = 0; f < 90; f++) {
        p.keys = { KeyW: true, ShiftLeft: true, Space: f % 22 === 0 };
        await new Promise(r => setTimeout(r, 16));
        check();
      }
      p.keys = {};
    }

    return { map, samples, belowFrames, worstDepth: +worstDepth.toFixed(2), fellOut,
             pct: +(belowFrames / samples * 100).toFixed(2) };
  }, map);
  console.log(`  ${r.map.padEnd(11)} samples=${String(r.samples).padStart(5)}  ` +
              `under-floor frames=${String(r.belowFrames).padStart(4)} (${r.pct}%)  ` +
              `worst depth=${r.worstDepth}m  fell out of world=${r.fellOut}`);
}

if (errs.length) console.log('ERRORS:\n' + [...new Set(errs)].slice(0, 5).join('\n'));
else console.log('no runtime errors');
await browser.close();
server.close();
