// Frame-difference imager.
//
// Captures consecutive frames while the camera creeps forward and writes an
// amplified difference image. Aggregate numbers hide the *pattern* of a
// flicker: z-fighting shows as moiré banding, shadow swim as bright edges
// along shadow boundaries, AO noise as soft blotches.
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
await new Promise(r => server.listen(8134, r));

const MAP = process.env.MAP || 'foundry';
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true, executablePath: '/usr/bin/google-chrome',
  args: ['--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--mute-audio'],
});
// full-ish resolution: depth precision and shadow texel density both scale
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8134/', { waitUntil: 'load' });
await page.waitForFunction(() => window.GAME && window.GAME.loaded, null, { timeout: 180000 });

await page.evaluate(async (m) => {
  window.GAME.settings.map = m;
  await window.DEPLOY();
  const g = window.GAME;
  g.godMode = true;
  g.freezeBots = true;
  for (const b of g.bots) { b.alive = false; b.object.visible = false; }
  g.player.rigRoot.visible = false;      // exclude the weapon idle sway

  const gl = g.renderer.getContext();
  window.CAP = { shots: [], on: false, w: 0, h: 0 };
  const orig = g.render.bind(g);
  g.render = (dt) => {
    orig(dt);
    if (!window.CAP.on) return;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    window.CAP.w = w; window.CAP.h = h;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    window.CAP.shots.push(buf);
    if (window.CAP.shots.length > 3) window.CAP.shots.shift();
  };
}, MAP);

const SPOTS = {
  foundry: [
    { name: 'yard', pos: [0, 24], yaw: 0, pitch: -0.18 },
    { name: 'inside-centre', pos: [-8, -6], yaw: 0.3, pitch: -0.22 },
    { name: 'hall', pos: [0, -30], yaw: -1.5, pitch: -0.15 },
  ],
  district7: [
    { name: 'plaza', pos: [0, 26], yaw: 0, pitch: -0.18 },
    { name: 'street', pos: [0, -40], yaw: 3.14, pitch: -0.15 },
  ],
};

async function shoot(spot, label, setup) {
  const info = await page.evaluate(async ({ spot, setup }) => {
    const g = window.GAME, p = g.player;
    if (setup) new Function('g', setup)(g);
    p.pos.set(spot.pos[0], 0, spot.pos[1]);
    p.vel.set(0, 0, 0); p.keys = {};
    p.yaw = spot.yaw; p.pitch = spot.pitch;
    await new Promise(r => setTimeout(r, 400));
    window.CAP.shots.length = 0;
    window.CAP.on = true;
    // creep forward at a walking pace for a few frames
    await new Promise(res => {
      let n = 0;
      const iv = setInterval(() => {
        n++;
        p.pos.z = spot.pos[1] - n * 0.012;    // ~0.7 m/s at 60fps
        if (n > 6) { clearInterval(iv); res(); }
      }, 16);
    });
    window.CAP.on = false;

    const { shots, w, h } = window.CAP;
    if (shots.length < 2) return null;
    const a = shots[shots.length - 2], b = shots[shots.length - 1];
    // amplified absolute difference, flipped upright
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    let changed = 0, total = 0, maxd = 0;
    for (let y = 0; y < h; y++) {
      const sy = h - 1 - y;
      for (let x = 0; x < w; x++) {
        const si = (sy * w + x) * 4, di = (y * w + x) * 4;
        const d = Math.max(Math.abs(a[si] - b[si]), Math.abs(a[si + 1] - b[si + 1]),
                           Math.abs(a[si + 2] - b[si + 2]));
        maxd = Math.max(maxd, d);
        if (d > 6) changed++;
        total++;
        const v = Math.min(255, d * 10);
        img.data[di] = v; img.data[di + 1] = v; img.data[di + 2] = v; img.data[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { url: cv.toDataURL('image/png'), pctChanged: +(changed / total * 100).toFixed(2), maxd };
  }, { spot, setup: setup || '' });
  if (!info) { console.log(`  ${label}: no frames`); return; }
  const file = path.join(OUT, `diff-${spot.name}-${label}.png`);
  fs.writeFileSync(file, Buffer.from(info.url.split(',')[1], 'base64'));
  console.log(`  ${spot.name}/${label.padEnd(16)} pixels changed >6: ${String(info.pctChanged).padStart(6)}%  max delta ${info.maxd}`);
}

console.log(`frame-diff on ${MAP} — after the stale-ground-plane fix`);
for (const spot of SPOTS[MAP] || SPOTS.foundry) {
  await shoot(spot, 'walking', '');
}

// How many ground planes are actually in the scene? Two coplanar ones z-fight.
const planes = await page.evaluate(() => {
  const g = window.GAME;
  const out = [];
  g.scene.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const p = o.geometry.attributes.position;
    if (!p || p.count > 60000) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    const w = b.max.x - b.min.x, d = b.max.z - b.min.z, h = b.max.y - b.min.y;
    if (w > 150 && d > 150 && h < 1) out.push({ w: +w.toFixed(0), d: +d.toFixed(0), y: +b.min.y.toFixed(2) });
  });
  return out;
});
console.log('  large flat ground planes in scene:', JSON.stringify(planes));

await browser.close();
server.close();
