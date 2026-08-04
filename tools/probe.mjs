// Quick interactive probe: boots the game and evaluates an expression.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8124;
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

const EXPR = process.argv[2] || '1';
const WAIT = +(process.argv[3] || 1500);

await new Promise(r => server.listen(PORT, r));
const browser = await chromium.launch({
  headless: true, executablePath: '/usr/bin/google-chrome',
  args: ['--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--mute-audio', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.GAME && window.GAME.loaded, null, { timeout: 120000 });
} catch (e) {
  const st = await page.evaluate(() => ({
    hasGame: !!window.GAME, loaded: window.GAME?.loaded,
    loadText: document.getElementById('load-text')?.textContent,
  })).catch(() => null);
  console.log('LOAD TIMEOUT', JSON.stringify(st), '\n' + [...new Set(errs)].slice(0, 8).join('\n'));
  await browser.close(); server.close(); process.exit(1);
}
await page.evaluate(() => window.DEPLOY());
await page.waitForTimeout(WAIT);
const out = await page.evaluate(EXPR);
console.log(JSON.stringify(out, null, 2));
if (errs.length) console.log('ERRORS:\n' + [...new Set(errs)].slice(0, 10).join('\n'));
await browser.close();
server.close();
