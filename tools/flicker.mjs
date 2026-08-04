// Flicker probe.
//
// Renders a slow camera move and reads the framebuffer back each frame, then
// reports how much each screen cell changes between consecutive frames. Runs
// the same move with individual effects disabled so the cause can be isolated
// rather than guessed at.
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
const PORT = 8133;
await new Promise(r => server.listen(PORT, r));

const MAP = process.env.MAP || 'foundry';
const browser = await chromium.launch({
  headless: true, executablePath: '/usr/bin/google-chrome',
  args: ['--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.GAME && window.GAME.loaded, null, { timeout: 180000 });

await page.evaluate(async (m) => {
  window.GAME.settings.map = m;
  await window.DEPLOY();
  const g = window.GAME;
  g.godMode = true;
  g.freezeBots = true;
  for (const b of g.bots) { b.alive = false; b.object.visible = false; }

  // Read the framebuffer straight after render, downsample to a coarse grid,
  // and keep the last N frames so consecutive ones can be differenced.
  const gl = g.renderer.getContext();
  const GW = 40, GH = 22;
  window.FLICK = { frames: [], on: false, grid: [GW, GH] };
  const origRender = g.render.bind(g);
  g.render = (dt) => {
    origRender(dt);
    if (!window.FLICK.on) return;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const cell = new Float32Array(GW * GH);
    const cnt = new Float32Array(GW * GH);
    for (let y = 0; y < h; y += 2) {
      const gy = Math.min(GH - 1, Math.floor(y / h * GH));
      for (let x = 0; x < w; x += 2) {
        const gx = Math.min(GW - 1, Math.floor(x / w * GW));
        const i = (y * w + x) * 4;
        cell[gy * GW + gx] += buf[i] * 0.299 + buf[i + 1] * 0.587 + buf[i + 2] * 0.114;
        cnt[gy * GW + gx]++;
      }
    }
    for (let i = 0; i < cell.length; i++) cell[i] /= Math.max(1, cnt[i]);
    window.FLICK.frames.push(cell);
  };
}, MAP);

/**
 * Run one scenario and return per-cell flicker statistics.
 * opts: { move (camera translates), sunFollow (sun tracks a moving player),
 *         setup (JS run against `g` before the take) }
 */
async function measure(label, opts = {}) {
  const stats = await page.evaluate(async ({ move, sunFollow, setup }) => {
    const g = window.GAME, p = g.player;
    if (setup) new Function('g', setup)(g);
    window.FLICK.frames.length = 0;
    p.pos.set(0, 0, 24); p.vel.set(0, 0, 0); p.keys = {};
    p.yaw = 0; p.pitch = -0.10;
    await new Promise(r => setTimeout(r, 500));
    window.FLICK.on = true;
    const t0 = performance.now();
    await new Promise(res => {
      const iv = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        if (move) { p.pos.set(0, 0, 24 - t * 0.35); p.yaw = Math.sin(t * 0.20) * 0.05; }
        else { p.pos.set(0, 0, 24); p.yaw = 0; }
        // the sun rig follows the player every frame, so shadow texels swim as
        // you walk; drive it independently of the camera to isolate that
        if (sunFollow) g._sunTrack = 24 - t * 1.2;
        else g._sunTrack = undefined;
        if (t > 4) { clearInterval(iv); res(); }
      }, 16);
    });
    window.FLICK.on = false;

    const [GW, GH] = window.FLICK.grid;
    const f = window.FLICK.frames;
    const diff = new Float32Array(GW * GH);
    for (let k = 1; k < f.length; k++) {
      for (let i = 0; i < diff.length; i++) diff[i] += Math.abs(f[k][i] - f[k - 1][i]);
    }
    const n = Math.max(1, f.length - 1);
    for (let i = 0; i < diff.length; i++) diff[i] /= n;
    const cells = [];
    for (let i = 0; i < diff.length; i++) cells.push({ v: diff[i], gx: i % GW, gy: Math.floor(i / GW) });
    cells.sort((a, b) => b.v - a.v);
    const floor = cells.filter(c => c.gy < GH * 0.42);
    const avg = (a) => a.length ? a.reduce((s, c) => s + c.v, 0) / a.length : 0;
    return {
      frames: f.length,
      floor: +avg(floor).toFixed(3),
      peak: +cells[0].v.toFixed(2),
      worst: cells.slice(0, 4).map(c => `(${c.gx},${c.gy})=${c.v.toFixed(1)}`),
    };
  }, { move: !!opts.move, sunFollow: !!opts.sunFollow, setup: opts.setup || '' });
  console.log(`  ${label.padEnd(34)} floorAvg=${String(stats.floor).padStart(6)}  ` +
              `peak=${String(stats.peak).padStart(5)}  worst ${stats.worst.join(' ')}`);
  return stats;
}

console.log(`flicker probe on ${MAP} — frame-to-frame luminance change (0 = perfectly stable)`);
console.log('  --- camera completely still ---');
await measure('static, sun still', {});
await measure('static, sun tracking a walker', { sunFollow: true });
await measure('static, no grain', { setup: 'g.pipeline.grade.uniforms.uGrain.value = 0;' });
await measure('static, no grain + no GTAO', { setup: 'g.pipeline.gtao.enabled = false;' });
console.log('  --- camera moving (real image change is expected) ---');
await measure('moving, all on', { move: true, setup: 'g.pipeline.gtao.enabled = true; g.pipeline.grade.uniforms.uGrain.value = 0.022;' });
await measure('moving, no concrete apron', { move: true, setup: `
  g.scene.traverse(o => { if (o.userData && o.userData.isApron) o.visible = false; });` });
await measure('moving, sun frozen', { move: true, setup: 'g._freezeSun = true;' });
await measure('moving, restored', { move: true, setup: 'g._freezeSun = false;' });
console.log('  --- is the residual hot spot the weapon idle sway? ---');
await measure('static, weapon hidden', { setup: 'g.player.rigRoot.visible = false;' });
await measure('static, weapon back', { setup: 'g.player.rigRoot.visible = true;' });

await browser.close();
server.close();
