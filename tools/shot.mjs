// Screenshot harness: boots the game in a real Chromium with GPU, drives it via
// the exposed window.GAME handle, and writes PNGs + a console-error report.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Pick a free port rather than a fixed one: the player's own `npm start` may
// already be on the default.
async function freePort(from) {
  for (let p = from; p < from + 40; p++) {
    const ok = await new Promise(res => {
      const srv = http.createServer();
      srv.once('error', () => res(false));
      srv.once('listening', () => srv.close(() => res(true)));
      srv.listen(p);
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  // no-store: otherwise Chrome serves stale modules and tests silently
  // validate code that is no longer on disk
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  fs.createReadStream(file).pipe(res);
});

// ---------------------------------------------------------------- views

// Each view is an eye position plus a world point to look at — much easier to
// reason about than raw yaw values.
const VIEWS = [
  { name: 'plaza-south', pos: [0, 1.7, 26], look: [0, 2.5, 0] },
  { name: 'plaza-containers', pos: [10, 1.7, 12], look: [-17, 3, 6] },
  { name: 'office-approach', pos: [-10, 1.7, -8], look: [-30, 4, -30] },
  { name: 'overpass', pos: [-15, 6.0, -8], look: [10, 1, -6] },
  { name: 'warehouse-in', pos: [27, 1.7, 30], look: [48, 3, 44] },
  { name: 'market', pos: [30, 1.7, -30], look: [50, 2.5, -44] },
  { name: 'watertower', pos: [52, 11.0, -34], look: [0, 0, 0] },
  { name: 'apartments', pos: [-26, 1.7, 36], look: [-46, 3, 44] },
  { name: 'office-roof', pos: [-34, 10.2, -36], look: [8, 0, 8] },
  { name: 'street-north', pos: [0, 1.7, -40], look: [0, 2, 0] },
  { name: 'warehouse-catwalk', pos: [24.2, 6.3, 40], look: [50, 2, 30] },
  { name: 'fountain-close', pos: [-9, 1.7, 9], look: [0, 2.2, 0] },
];


const COLD_VIEWS = [
  { name: 'station-yard', pos: [0, 3.0, 22], look: [0, 3, -4] },
  { name: 'ridge-look-down', pos: [0, 14.9, -30], look: [0, 1, 6] },
  { name: 'from-west', pos: [-40, 3.5, 4], look: [0, 3, -2] },
  { name: 'hut-approach', pos: [-14, 3.6, -14], look: [-26, 4, -12] },
  { name: 'inlet', pos: [-6, 1.5, 44], look: [-6, 3, 26] },
  { name: 'hull', pos: [10, 2.5, 34], look: [-10, 3, 29] },
  { name: 'ridge-from-yard', pos: [0, 2.6, -6], look: [0, 9, -30] },
  { name: 'tank-walkway', pos: [-2.5, 7.6, 5], look: [26, 5, -10] },
  { name: 'east-slope', pos: [34, 4.0, 12], look: [4, 3, -4] },
  { name: 'hut-roof', pos: [-26, 7.5, -12], look: [4, 2, 4] },
];

const FOUNDRY_VIEWS = [
  { name: 'yard-approach', pos: [0, 1.7, 22], look: [0, 3, 0] },
  { name: 'centre-room', pos: [-8, 1.7, -8], look: [8, 1.5, 6] },
  { name: 'centre-corridor', pos: [-9, 1.7, 0], look: [9, 1.6, 0] },
  { name: 'centre-1f', pos: [-8, 6.0, -8], look: [8, 5.4, 4] },
  { name: 'centre-roof', pos: [-9, 10.3, -9], look: [24, 4, 24] },
  { name: 'hall-north', pos: [-16, 1.7, -30], look: [16, 1.6, -30] },
  { name: 'shed-nw', pos: [-24, 1.7, -20], look: [-24, 1.5, -28] },
  { name: 'shed-upper', pos: [-24, 6.0, -20], look: [-8, 3, -8] },
  { name: 'container-lane', pos: [-20, 3.4, -14], look: [-20, 2, 2] },
  { name: 'hall-corner', pos: [-30, 1.7, -14], look: [-30, 1.6, 12] },
];

async function main() {
  const only = process.argv.slice(2);
  const PORT = await freePort(8140);
  await new Promise(r => server.listen(PORT, r));

  // Headful gives real GPU rendering; set HEADLESS=1 to run without a display
  // (or when something else is occupying it — an occluded window stops producing
  // frames and screenshots time out).
  const browser = await chromium.launch({
    headless: process.env.HEADLESS === '1',
    executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
    args: [
      '--enable-gpu', '--use-gl=angle', '--use-angle=gl',
      '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
      '--window-position=0,0', '--hide-scrollbars', '--mute-audio',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

  // wait for the world to finish building
  try {
    await page.waitForFunction(() => window.GAME && window.GAME.loaded, null, { timeout: 90000 });
  } catch (e) {
    console.log('--- LOAD FAILED ---');
    console.log([...new Set(errors)].slice(0, 30).join('\n') || '(no console output)');
    await page.screenshot({ path: path.join(OUT, 'load-failure.png') }).catch(() => {});
    await browser.close(); server.close();
    process.exit(1);
  }

  const t0 = Date.now();
  // menu shot
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '00-menu.png') });

  // start a match (goes through the real deploy path so the menu is dismissed)
  const MAP = process.env.MAP || 'district7';
  await page.evaluate(async (m) => {
    window.GAME.settings.map = m;
    await window.DEPLOY();
    window.GAME.godMode = true;
  }, MAP);
  await page.waitForTimeout(2500);

  // scripted camera views (freeze the player, place him, let a frame settle)
  let i = 1;
  const VIEWSET = process.env.MAP === 'foundry' ? FOUNDRY_VIEWS
    : process.env.MAP === 'coldharbor' ? COLD_VIEWS : VIEWS;
  for (const v of VIEWSET) {
    if (only.length && !only.includes(v.name)) { i++; continue; }
    await page.evaluate((v) => {
      const g = window.GAME, p = g.player;
      p.pos.set(v.pos[0], v.pos[1] - 1.62, v.pos[2]);
      p.vel.set(0, 0, 0);
      const dx = v.look[0] - v.pos[0], dy = v.look[1] - v.pos[1], dz = v.look[2] - v.pos[2];
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      p.recoilPitch = p.recoilYaw = 0;
      p.keys = {};
    }, v);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${String(i).padStart(2, '0')}-${v.name}.png`) });
    i++;
  }

  // bot close-ups: park two enemies and an ally in front of the camera
  await page.evaluate(() => {
    const g = window.GAME, p = g.player;
    p.pos.set(0, 0.9, 12); p.yaw = 0; p.pitch = -0.06;
    const reds = g.bots.filter(b => b.team === 'red').slice(0, 2);
    const blues = g.bots.filter(b => b.team === 'blue').slice(0, 1);
    const place = (b, x, z, yaw) => {
      b.alive = true; b.health = 100; b.object.visible = true;
      b.pos.set(x, 0, z); b.vel.set(0, 0, 0); b.yaw = yaw; b.aimYaw = yaw;
      b.pitch = 0; b.aimPitch = 0; b.state = 'patrol'; b.target = null;
      b.deadTime = 0; b.crouch = 0;
    };
    if (reds[0]) place(reds[0], -0.95, 9.1, Math.PI - 0.30);
    if (reds[1]) place(reds[1], 1.15, 9.3, Math.PI + 0.35);
    if (blues[0]) place(blues[0], 0.1, 10.4, 0.15);
    g.freezeBots = true;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '19-soldiers.png') });
  // tight portrait so the kit is actually legible
  await page.evaluate(() => {
    const g = window.GAME, p = g.player;
    const b = g.bots.find(x => x.team === 'red');
    if (b) { b.pos.set(0, 0, 9.2); b.yaw = Math.PI + 0.5; b.aimYaw = b.yaw; b.pitch = 0; b.aimPitch = 0; }
    p.pos.set(0.7, 0.62, 10.9); p.yaw = 0.42; p.pitch = -0.05;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '19b-soldier-closeup.png') });
  await page.evaluate(() => { window.GAME.freezeBots = false; });

  // combat shot: let the bots fight for a while near the player, then capture
  await page.evaluate(() => {
    const g = window.GAME, p = g.player;
    p.pos.set(0, 0, 26);
    p.yaw = Math.PI; p.pitch = 0;
    // pull every bot toward the plaza so there is something to look at
    for (const b of g.bots) {
      const a = Math.random() * 6.28, r = 8 + Math.random() * 14;
      b.pos.set(Math.cos(a) * r, 0.2, Math.sin(a) * r);
      b.vel.set(0, 0, 0);
    }
  });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(OUT, '20-combat.png') });

  // firing shot: hold the trigger for a moment
  await page.evaluate(() => {
    const g = window.GAME;
    g.player.mouse.left = true;
  });
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(OUT, '21-firing.png') });
  await page.evaluate(() => { window.GAME.player.mouse.left = false; window.GAME.player.mouse.right = true; });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '22-ads.png') });
  await page.evaluate(() => { window.GAME.player.mouse.right = false; });

  // ---- weapon showcase: every gun, hip and ADS, in even light
  await page.evaluate(() => {
    const g = window.GAME, p = g.player;
    g.freezeBots = true;
    for (const b of g.bots) { b.alive = false; b.object.visible = false; }
    // snap onto the navmesh: a hardcoded y is underground on a terrain map
    const n = g.nav.nodeAt(-6.5, 2, 6.5, 8);
    if (n >= 0) p.pos.set(g.nav.nx[n], g.nav.ny[n] + 0.05, g.nav.nz[n]);
    else p.pos.set(-6.5, 2, 6.5);
    p.yaw = 0.72; p.pitch = 0.02;
    p.vel.set(0, 0, 0); p.keys = {};
  });
  const GUNS = ['m4a1', 'ak74', 'mp5k', 'scarh', 'spas12', 'awm', 'deagle'];
  for (let k = 0; k < GUNS.length; k++) {
    await page.evaluate((id) => {
      const p = window.GAME.player;
      p.setLoadout(id, 'g18');
      p.mouse.right = false;
    }, GUNS[k]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `3${k}-gun-${GUNS[k]}.png`) });
  }
  // one ADS frame to check the sight picture
  await page.evaluate(() => {
    const p = window.GAME.player;
    p.setLoadout('m4a1', 'g18');
    p.mouse.right = true;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '39-gun-ads.png') });
  await page.evaluate(() => { window.GAME.player.mouse.right = false; window.GAME.freezeBots = false; });

  // ADS sight picture: the target must stay visible through the optic
  await page.evaluate(() => {
    const g = window.GAME, p = g.player;
    g.freezeBots = true;
    const b = g.bots.find(x => x.team === 'red');
    if (b) {
      b.alive = true; b.object.visible = true; b.health = 100;
      const f = new (p.pos.constructor)(0, 0, -1).applyEuler(new (g.camera.rotation.constructor)(0, p.yaw, 0, 'YXZ'));
      const bx = p.pos.x + f.x * 16, bz = p.pos.z + f.z * 16;
      const bn = g.nav.nodeAt(bx, p.pos.y, bz, 8);
      b.pos.set(bx, bn >= 0 ? g.nav.ny[bn] : p.pos.y, bz);
      b.yaw = p.yaw + Math.PI; b.aimYaw = b.yaw; b.pitch = 0; b.aimPitch = 0; b.deadTime = 0;
    }
    p.setLoadout('m4a1', 'g18');
    p.mouse.right = true;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '40-ads-check.png') });
  await page.evaluate(() => { window.GAME.player.mouse.right = false; window.GAME.freezeBots = false; });

  // stats
  const stats = await page.evaluate(() => {
    const g = window.GAME;
    return {
      calls: g.renderer.info.render.calls,
      tris: g.renderer.info.render.triangles,
      navNodes: g.nav.nx.length,
      colliders: g.physics.colliders.length,
      bots: g.bots.length,
      score: g.score,
      botStates: g.bots.slice(0, 8).map(b => `${b.name}:${b.state}:${b.alive ? Math.round(b.health) : 'dead'}`),
      playerPos: [g.player.pos.x, g.player.pos.y, g.player.pos.z].map(v => +v.toFixed(1)),
    };
  });

  // let a longer sim run so we can check the bots actually fight each other
  await page.evaluate(() => { window.GAME.player.pos.set(0, 20, 0); window.GAME.player.alive = false; });
  await page.waitForTimeout(6000);
  const sim = await page.evaluate(() => {
    const g = window.GAME;
    return {
      score: { ...g.score },
      states: g.bots.map(b => b.state),
      alive: g.bots.filter(b => b.alive).length,
      kills: g.bots.map(b => b.kills).reduce((a, c) => a + c, 0),
      shots: g.bots.map(b => b.shotsFired).reduce((a, c) => a + c, 0),
      hits: g.bots.map(b => b.shotsHit).reduce((a, c) => a + c, 0),
      positions: g.bots.slice(0, 6).map(b => [b.name, +b.pos.x.toFixed(0), +b.pos.y.toFixed(1), +b.pos.z.toFixed(0)].join(',')),
    };
  });

  console.log('--- STATS ---');
  console.log(JSON.stringify({ stats, sim }, null, 2));
  console.log(`--- took ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
  if (errors.length) {
    console.log('--- CONSOLE ISSUES ---');
    console.log([...new Set(errors)].slice(0, 30).join('\n'));
  } else {
    console.log('--- no console errors ---');
  }

  await browser.close();
  server.close();
}

main().catch(e => { console.error(e); process.exit(1); });
