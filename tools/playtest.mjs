// Automated playtest: drives the player around with synthetic input, then runs a
// bot-only simulation at every difficulty and reports the resulting metrics.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8125;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  // no-store: otherwise Chrome serves stale modules and tests silently
  // validate code that is no longer on disk
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  fs.createReadStream(file).pipe(res);
});

await new Promise(r => server.listen(PORT, r));
// Headless on purpose: this is a logic/AI test, and running headless keeps it
// independent of whatever else is using the display.
const browser = await chromium.launch({
  headless: true, executablePath: '/usr/bin/google-chrome',
  args: ['--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--mute-audio', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message + '\n' + (e.stack || '').split('\n')[1]));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.GAME && window.GAME.loaded, null, { timeout: 180000 });

// ---------------------------------------------------------------- 1. movement
console.log('=== MOVEMENT TEST (60s of synthetic input) ===');
await page.evaluate(() => {
  window.DEPLOY();
  const g = window.GAME;
  g.godMode = true;
  g.applyQuality(0);

  // A tiny autopilot: walk toward a series of waypoints across the whole map,
  // jumping when blocked, firing at anything it sees.
  const WPS = [
    [0, 0], [-30, -30], [-40, -40], [-26, -26], [0, -26], [30, -30], [50, -34],
    [26, 30], [40, 40], [-30, 30], [-44, 44], [0, 26], [12, 12], [-17, 6],
  ];
  const st = window.AUTOPILOT = {
    wp: 0, samples: [], stuck: 0, stuckEvents: 0, distance: 0,
    maxY: -99, minY: 99, last: null, jumps: 0, fired: 0,
  };
  const p = g.player;
  g._autopilot = (dt) => {
    if (!p.alive) return;
    const t = WPS[st.wp % WPS.length];
    const dx = t[0] - p.pos.x, dz = t[1] - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 3) { st.wp++; return; }
    // steer: face the waypoint, hold W
    const want = Math.atan2(-dx, -dz);
    let diff = want - p.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.yaw += Math.max(-4 * dt, Math.min(4 * dt, diff));
    p.keys.KeyW = true;
    p.keys.ShiftLeft = Math.abs(diff) < 0.4;

    if (st.last) {
      const moved = Math.hypot(p.pos.x - st.last[0], p.pos.z - st.last[1]);
      st.distance += moved;
      if (moved < 0.004 && p.onGround) {
        st.stuck += dt;
        if (st.stuck > 0.8) {
          st.stuckEvents++;
          st.stuck = 0;
          p.keys.Space = true;
          st.jumps++;
          setTimeout(() => { p.keys.Space = false; }, 120);
          p.yaw += 1.4;
        }
      } else if (moved > 0.02) st.stuck = 0;
    }
    st.last = [p.pos.x, p.pos.z];
    st.maxY = Math.max(st.maxY, p.pos.y);
    st.minY = Math.min(st.minY, p.pos.y);

    // shoot at any enemy in the crosshair-ish cone
    let target = null;
    for (const c of g.characters) {
      if (c === p || !c.alive || c.team === p.team) continue;
      const ddx = c.pos.x - p.pos.x, ddz = c.pos.z - p.pos.z;
      const dd = Math.hypot(ddx, ddz);
      if (dd > 55) continue;
      const ang = Math.atan2(-ddx, -ddz);
      let a = ang - p.yaw;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      const eye = { x: p.pos.x, y: p.pos.y + 1.62, z: p.pos.z };
      const tgt = { x: c.pos.x, y: c.pos.y + 1.3, z: c.pos.z };
      if (Math.abs(a) < 0.9 && g.physics.visible(eye, tgt, 0.1)) { target = c; break; }
    }
    if (target) {
      const ddx = target.pos.x - p.pos.x, ddz = target.pos.z - p.pos.z;
      const dd = Math.hypot(ddx, ddz);
      p.yaw = Math.atan2(-ddx, -ddz);
      p.pitch = Math.atan2((target.pos.y + 1.3) - (p.pos.y + 1.62), dd) - p.recoilPitch;
      p.mouse.left = true;
      p.mouse.right = dd > 18;
      st.fired++;
    } else {
      p.mouse.left = false;
      p.mouse.right = false;
      p.pitch *= 0.9;
    }
  };
  // hook into the update loop
  const origUpdate = g.update.bind(g);
  g.update = (dt) => { if (g._autopilot && g.running && !g.paused) g._autopilot(dt); origUpdate(dt); };
});

for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(10000);
  const s = await page.evaluate(() => {
    const g = window.GAME, st = window.AUTOPILOT, p = g.player;
    return {
      t: +g.time.toFixed(0), wp: st.wp, dist: +st.distance.toFixed(0), stuck: st.stuckEvents,
      pos: [p.pos.x, p.pos.y, p.pos.z].map(v => +v.toFixed(1)),
      hi: +st.maxY.toFixed(1), kills: p.kills, deaths: p.deaths,
      acc: p.shotsFired ? Math.round(p.shotsHit / p.shotsFired * 100) : 0,
      score: `${g.score.blue}-${g.score.red}`,
      fps: g.renderStats,
    };
  });
  console.log(`  t=${s.t}s wp=${s.wp} travelled=${s.dist}m stuck=${s.stuck} pos=[${s.pos}] maxY=${s.hi} ` +
              `K/D=${s.kills}/${s.deaths} acc=${s.acc}% score=${s.score}`);
}

// ---------------------------------------------------------------- 2. difficulty
console.log('\n=== DIFFICULTY CALIBRATION (bot vs bot, 45s each) ===');
const names = ['RECRUIT', 'REGULAR', 'HARDENED', 'VETERAN', 'ELITE'];
for (let d = 0; d < 5; d++) {
  await page.evaluate((d) => {
    const g = window.GAME;
    g._autopilot = null;
    g.startMatch({ ...g.settings, difficulty: d, enemies: 6, allies: 6, scoreLimit: 999 });
    g.godMode = true;
    // park the player out of the way so the bots fight each other
    g.player.alive = false;
    g.player.pos.set(0, 60, 0);
    g.respawnIn = 1e9;
  }, d);
  await page.waitForTimeout(45000);
  const r = await page.evaluate(() => {
    const g = window.GAME;
    const red = g.bots.filter(b => b.team === 'red');
    const blue = g.bots.filter(b => b.team === 'blue');
    const sum = (a, f) => a.reduce((s, b) => s + f(b), 0);
    const states = {};
    for (const b of g.bots) states[b.state] = (states[b.state] || 0) + 1;
    return {
      score: { ...g.score },
      redShots: sum(red, b => b.shotsFired), redHits: sum(red, b => b.shotsHit),
      redKills: sum(red, b => b.kills),
      blueKills: sum(blue, b => b.kills),
      states,
      spread: (() => {
        const xs = g.bots.map(b => b.pos.x), zs = g.bots.map(b => b.pos.z);
        return [Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...zs) - Math.min(...zs))];
      })(),
      onNav: g.bots.filter(b => b.onGround).length,
      maxBotY: Math.max(...g.bots.map(b => b.pos.y)).toFixed(1),
      botsUpstairs: g.bots.filter(b => b.pos.y > 2).length,
    };
  });
  const acc = r.redShots ? (r.redHits / r.redShots * 100).toFixed(1) : '0';
  console.log(`  ${names[d].padEnd(9)} kills=${(r.redKills + r.blueKills).toString().padStart(3)} ` +
              `(red ${r.redKills} / blue ${r.blueKills})  shots=${String(r.redShots).padStart(4)} ` +
              `hit%=${acc.padStart(5)}  spread=${r.spread}  maxY=${r.maxBotY} upstairs=${r.botsUpstairs}  states=${JSON.stringify(r.states)}`);
}

// ---------------------------------------------------------------- 3. traversal
// Drive the player along a real nav-mesh route to each elevated position — this
// exercises the same path a bot would take, plus the player's own step-up code.
console.log('\n=== TRAVERSAL TEST (nav route to every elevated position) ===');
const CLIMBS = [
  { name: 'office 2F',          from: [-46, 0, -30], to: [-40, 4.2, -40] },
  { name: 'office roof',        from: [-46, 0, -30], to: [-34, 8.7, -46] },
  { name: 'watertower top',     from: [42, 0, -38],  to: [52, 9.2, -32] },
  { name: 'container stack',    from: [-6, 0, 4],    to: [-17, 5.4, 4.4] },
  { name: 'warehouse catwalk',  from: [36, 0, 34],   to: [24.6, 4.76, 40] },
  { name: 'apartment roof',     from: [-30, 0, 24],  to: [-46, 7.9, 30] },
  { name: 'market shop roof',   from: [30, 0, -44],  to: [30, 4.7, -51] },
  { name: 'plaza overpass',     from: [-4, 0, -8],   to: [-15, 4.45, -8] },
];
await page.evaluate(() => {
  const g = window.GAME;
  g._autopilot = null;
  g.startMatch({ ...g.settings, difficulty: 0, enemies: 0, allies: 0, scoreLimit: 999 });
  g.godMode = true;
});
await page.waitForTimeout(600);
let climbPass = 0;
for (const c of CLIMBS) {
  const r = await page.evaluate(async (c) => {
    const g = window.GAME, p = g.player, nav = g.nav;
    p.alive = true; p.health = 100; p.keys = {};
    p.pos.set(c.from[0], c.from[1], c.from[2]);
    p.vel.set(0, 0, 0);
    await new Promise(r => setTimeout(r, 200));
    const a = nav.nodeAt(p.pos.x, p.pos.y, p.pos.z, 4);
    const b = nav.nodeAt(c.to[0], c.to[1], c.to[2], 4);
    if (a < 0 || b < 0) return { reached: false, why: `no nav node (start=${a} goal=${b})`, best: p.pos.y };
    const nodes = nav.path(a, b);
    if (!nodes) return { reached: false, why: 'no path', best: p.pos.y };
    const wps = nav.toWaypoints(nodes);
    const goalY = nav.ny[b];
    let idx = 0, best = p.pos.y, t = 0, stuck = 0, lastD = 1e9;
    return await new Promise(resolve => {
      const iv = setInterval(() => {
        t += 0.05;
        const wp = wps[Math.min(idx, wps.length - 1)];
        const dx = wp.x - p.pos.x, dz = wp.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.1 && Math.abs(wp.y - p.pos.y) < 1.6) idx++;
        p.yaw = Math.atan2(-dx, -dz);
        p.keys.KeyW = true;
        // hop when a step is too tall to walk up
        if (wp.y - p.pos.y > 0.45 && d < 2.0 && p.onGround) p.keys.Space = true;
        else p.keys.Space = false;
        if (Math.abs(d - lastD) < 0.002) stuck += 0.05; else stuck = 0;
        lastD = d;
        best = Math.max(best, p.pos.y);
        const done = p.pos.y >= goalY - 0.7 && idx >= wps.length - 1;
        if (done || t > 45 || stuck > 6) {
          clearInterval(iv);
          p.keys = {};
          resolve({
            reached: p.pos.y >= goalY - 0.7, best: +best.toFixed(2), goalY: +goalY.toFixed(2),
            t: +t.toFixed(1), wps: wps.length, idx, stuck: stuck > 3.5,
            end: [p.pos.x, p.pos.y, p.pos.z].map(v => +v.toFixed(1)),
          });
        }
      }, 50);
    });
  }, c);
  if (r.reached) climbPass++;
  console.log(`  ${(r.reached ? 'OK  ' : 'FAIL')} ${c.name.padEnd(20)} y=${r.best}/${r.goalY ?? '?'} ` +
              `t=${r.t ?? '-'}s wps=${r.idx ?? '-'}/${r.wps ?? '-'}${r.stuck ? ' STUCK' : ''}` +
              `${r.why ? ' ' + r.why : ''} end=[${r.end ?? ''}]`);
}
console.log(`  --> ${climbPass}/${CLIMBS.length} elevated positions reachable`);


// ---------------------------------------------------------------- 4. lethality
// How long does a stationary player survive in the open at each difficulty?
// This is the number that actually answers "is the easy setting easy?".
console.log('\n=== LETHALITY (player stands in the open, time to death) ===');
const names2 = ['RECRUIT', 'REGULAR', 'HARDENED', 'VETERAN', 'ELITE'];
for (let d = 0; d < 5; d++) {
  const runs = [];
  for (let trial = 0; trial < 3; trial++) {
    const r = await page.evaluate(async (d) => {
      const g = window.GAME;
      g._autopilot = null;
      g.startMatch({ ...g.settings, difficulty: d, enemies: 5, allies: 0, scoreLimit: 999 });
      g.godMode = false;
      const p = g.player;
      // stand in the middle, in the open, facing away from nothing in particular
      p.pos.set(0, 0.2, 20); p.vel.set(0, 0, 0); p.keys = {}; p.yaw = 0; p.pitch = 0;
      p.health = 100; p.armor = 100; p.alive = true;
      const t0 = g.time;
      return await new Promise(res => {
        const iv = setInterval(() => {
          p.keys = {}; p.mouse.left = false;        // never fight back
          if (!p.alive || g.time - t0 > 60) {
            clearInterval(iv);
            res({ t: +(g.time - t0).toFixed(1), died: !p.alive, hp: Math.round(p.health) });
          }
        }, 100);
      });
    }, d);
    runs.push(r);
  }
  const died = runs.filter(r => r.died);
  const avg = died.length ? (died.reduce((a, r) => a + r.t, 0) / died.length).toFixed(1) : '>60';
  console.log(`  ${names2[d].padEnd(9)} survived ${String(avg).padStart(5)}s ` +
              `(${died.length}/3 killed)  ${runs.map(r => r.died ? r.t + 's' : `alive@${r.hp}hp`).join(' ')}`);
}

if (errs.length) console.log('\nERRORS:\n' + [...new Set(errs)].slice(0, 12).join('\n'));
else console.log('\nno runtime errors');
await browser.close();
server.close();
