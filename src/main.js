// Boot, menu wiring, input plumbing and the render loop.
import { Game } from './core/game.js';
import { DIFFICULTIES } from './entities/bot.js';
import { WEAPONS, PRIMARIES, SECONDARIES } from './entities/weapons.js';
import { MAPS } from './world/maps/index.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const game = new Game(canvas);
window.GAME = game;   // handy for debugging / automated screenshots

const settings = game.settings;

// ---------------------------------------------------------------- menu setup

function seg(containerId, key, onChange) {
  const el = $(containerId);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...el.querySelectorAll('button')].forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const v = b.dataset.v;
    settings[key] = isNaN(Number(v)) ? v : Number(v);
    game.audio.init();
    game.audio.ui('tick');
    onChange?.(settings[key]);
  });
}

function buildWeaponPicker(containerId, ids, key) {
  const el = $(containerId);
  el.innerHTML = ids.map(id =>
    `<button data-v="${id}" class="${settings[key] === id ? 'on' : ''}">${WEAPONS[id].name.split(' ')[0]}</button>`
  ).join('');
  seg(containerId, key, renderGunStats);
}

function renderGunStats() {
  const p = WEAPONS[settings.primary], s = WEAPONS[settings.secondary];
  const bar = (n, v) => `<div class="stat-line"><span class="sn">${n}</span>
    <span class="stat-meter"><i style="width:${Math.round(v * 100)}%"></i></span></div>`;
  $('gun-stats').innerHTML =
    `<div style="opacity:.9;margin-bottom:4px">${p.name} · ${p.cls}</div>` +
    bar('DAMAGE', p.stats.damage) + bar('RATE', p.stats.rate) + bar('ACCURACY', p.stats.accuracy) +
    bar('CONTROL', p.stats.control) + bar('MOBILITY', p.stats.mobility) +
    `<div style="opacity:.55;margin-top:6px">${p.mag} rnd mag · ${Math.round(p.rpm)} RPM · ${p.damage} dmg` +
    `<br>SIDEARM: ${s.name}</div>`;
}

function renderMapDesc() {
  const m = MAPS[settings.map];
  $('map-desc').innerHTML = `<b>${m.name}</b><br>${m.tagline}<br><br>` +
    ({
      foundry: 'A compact industrial warren. No sightline longer than about 24m, three storeys everywhere, and every room has at least two ways in.',
      coldharbor: 'Rolling snow terrain at dusk. Elevation is the cover here — a northern ridge, a frozen inlet, and scattered prefabs across open ground.',
      mesa: 'Desert dunes under a noon sun. A dry riverbed snakes across the middle — sunken and hidden — while two flat-topped mesas overlook it and an adobe village holds the centre.',
      greenfall: 'A green highland valley on a wet morning. A shallow river splits the map; wade it anywhere or take the contested bridge. Farm to the north, ruin to the south, walled lanes between.',
      caldera: 'A live volcanic crater under an ash sky. Climb to the rim ring, cross at one of two saddles, and fight through basalt columns and lava-light for the drill rig on the crater floor.',
      sirocco: 'A desert town in the classic three-lane mould. A long open boulevard west, a gate-door sightline down mid, a covered market arcade east — feeding a raised terrace and a walled cistern yard.',
    }[m.id] || 'A wide urban block: open plaza, long approaches, rooftops and a water tower overlooking the whole map.');
}

const HINTS = {
  1: 'WASD move · SHIFT walk (silent) · CTRL crouch · SPACE jump · LMB fire · RMB scope · R reload · 1 rifle · 2 pistol · 3 knife · 4 frag · TAB scores · ESC menu',
  0: 'WASD move · SHIFT sprint · CTRL crouch · SPACE jump · LMB fire · RMB aim · R reload · 1 rifle · 2 pistol · 3 knife · 4 frag · TAB scores · ESC menu',
};

function renderRulesDesc() {
  const cs = settings.csRules ? 1 : 0;
  $('rules-desc').innerHTML = cs
    ? '<b>TACTICAL</b><br>No sprint and no aim-down-sights. SHIFT is a slow, silent walk. ' +
      'Accuracy is decided by your feet: planted is pinpoint, running is not a shot. Only the AWM-S scopes.'
    : '<b>ARCADE</b><br>SHIFT sprints, right mouse aims down sights on every weapon, and movement costs you far less accuracy.';
  $('hint-bar').textContent = HINTS[cs];
}

function renderDiffDesc() {
  const d = DIFFICULTIES[settings.difficulty];
  $('diff-desc').innerHTML = d.blurb.replace('\n', '<br>');
}

seg('sel-map', 'map', renderMapDesc);
seg('sel-difficulty', 'difficulty', renderDiffDesc);
seg('sel-enemies', 'enemies');
seg('sel-allies', 'allies');
seg('sel-scorelimit', 'scoreLimit');
seg('sel-csrules', 'csRules', (v) => {
  renderRulesDesc();
  if (game.player) game.player.cs = !!v;
});
seg('sel-quality', 'quality', v => game.loaded && game.applyQuality(v));
seg('sel-invert', 'invert');
buildWeaponPicker('sel-primary', PRIMARIES, 'primary');
buildWeaponPicker('sel-secondary', SECONDARIES, 'secondary');
renderDiffDesc();
renderMapDesc();
renderGunStats();
renderRulesDesc();

$('sel-fov').addEventListener('input', e => {
  settings.fov = +e.target.value;
  $('fov-val').textContent = settings.fov;
  if (game.player) game.player.baseFov = settings.fov;
});
$('sel-sens').addEventListener('input', e => {
  settings.sens = +e.target.value;
  $('sens-val').textContent = (settings.sens / 100).toFixed(2);
  if (game.player) game.player.sensitivity = settings.sens / 100;
  $('pause-sens').value = settings.sens;
  $('pause-sens-val').textContent = (settings.sens / 100).toFixed(2);
});
$('pause-sens').addEventListener('input', e => {
  settings.sens = +e.target.value;
  $('pause-sens-val').textContent = (settings.sens / 100).toFixed(2);
  $('sel-sens').value = settings.sens;
  $('sens-val').textContent = (settings.sens / 100).toFixed(2);
  if (game.player) game.player.sensitivity = settings.sens / 100;
});
$('pause-sens').value = settings.sens;
$('pause-sens-val').textContent = (settings.sens / 100).toFixed(2);

// ---------------------------------------------------------------- flow

let started = false;

async function boot() {
  await game.load((t) => { $('load-text').textContent = t; });
  $('loading').classList.add('done');
  setTimeout(() => $('loading').style.display = 'none', 600);
  loop();
}

let deploying = false;
async function deploy() {
  if (deploying) return;
  deploying = true;
  $('menu').style.display = 'none';
  $('endscreen').classList.add('hidden');

  // switching maps rebuilds geometry, colliders and the navmesh
  if (settings.map !== game.mapId) {
    const load = $('loading');
    load.style.display = '';
    load.classList.remove('done');
    await game.buildWorld(settings.map, (t) => { $('load-text').textContent = t; });
    load.classList.add('done');
    setTimeout(() => { load.style.display = 'none'; }, 500);
  }

  game.startMatch(settings);
  started = true;
  deploying = false;
  requestPointerLock();
}

function requestPointerLock() {
  // unadjustedMovement (raw input) is not supported everywhere; fall back quietly
  try {
    const r = canvas.requestPointerLock({ unadjustedMovement: true });
    if (r && r.catch) r.catch(() => { try { canvas.requestPointerLock(); } catch {} });
  } catch {
    try { canvas.requestPointerLock(); } catch {}
  }
  // In fullscreen this captures Ctrl+W / Ctrl+T etc. so crouch+forward can't
  // close the tab. Outside fullscreen it is a harmless no-op.
  navigator.keyboard?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD']).catch(() => {});
}

window.DEPLOY = deploy;   // used by the screenshot harness
$('btn-play').addEventListener('click', deploy);
$('btn-again').addEventListener('click', deploy);
$('btn-resume').addEventListener('click', () => { $('pause').classList.add('hidden'); requestPointerLock(); });
$('btn-restart').addEventListener('click', () => { $('pause').classList.add('hidden'); deploy(); });
$('btn-quit').addEventListener('click', () => {
  $('pause').classList.add('hidden');
  game.running = false;
  game.hud.hide();
  $('menu').style.display = '';
  started = false;
});

// ---------------------------------------------------------------- input

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked) navigator.keyboard?.unlock?.();
  game.paused = !locked && started && !game.over;
  if (game.paused) $('pause').classList.remove('hidden');
  else $('pause').classList.add('hidden');
});

canvas.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  game.player?.onMouseMove(e.movementX, e.movementY);
});

canvas.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas) {
    if (started && !game.over) requestPointerLock();
    return;
  }
  if (e.button === 0) game.player.mouse.left = true;
  if (e.button === 2) game.player.mouse.right = true;
});
addEventListener('mouseup', (e) => {
  if (!game.player) return;
  if (e.button === 0) game.player.mouse.left = false;
  if (e.button === 2) game.player.mouse.right = false;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  if (document.pointerLockElement !== canvas) return;
  game.player?.onWheel(e.deltaY);
}, { passive: true });

addEventListener('keydown', (e) => {
  // Crouch is Ctrl, so crouch+move makes Ctrl+W / Ctrl+D / Ctrl+S combos.
  // Swallow browser shortcuts while playing (bookmark, save, find, ...).
  // Ctrl+W itself can only be blocked in fullscreen via the keyboard lock
  // requested in requestPointerLock(); the beforeunload guard covers the rest.
  if (document.pointerLockElement === canvas && (e.ctrlKey || e.metaKey)) e.preventDefault();
  if (e.code === 'Tab') { e.preventDefault(); if (started) game.hud.showScoreboard(game); return; }
  if (e.code === 'Escape') return;
  if (e.repeat) return;
  game.player?.onKey(e.code, true);
});
addEventListener('keyup', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); game.hud.hideScoreboard(); return; }
  game.player?.onKey(e.code, false);
});
addEventListener('blur', () => {
  if (game.player) { game.player.keys = {}; game.player.mouse.left = game.player.mouse.right = false; }
});

// Ctrl+W outside fullscreen cannot be intercepted at all; make it prompt
// instead of instantly killing the tab mid-match.
addEventListener('beforeunload', (e) => {
  if (started && !game.over && document.pointerLockElement === canvas) e.preventDefault();
});

// ---------------------------------------------------------------- loop

let last = performance.now();
let fpsAcc = 0, fpsFrames = 0;
let loopErrors = 0;

/**
 * Surface a fatal problem instead of leaving the player staring at a frozen
 * frame. requestAnimationFrame is re-armed before update(), so an exception
 * would otherwise repeat silently every frame forever.
 */
function reportCrash(what, err) {
  console.error(what, err);
  let el = $('crash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'crash';
    document.getElementById('app').appendChild(el);
  }
  el.innerHTML =
    `<div class="crash-inner"><h2>SOMETHING BROKE</h2>` +
    `<div class="crash-what">${what}</div>` +
    `<pre>${String(err && err.stack || err).slice(0, 900)}</pre>` +
    `<button id="crash-reload">RELOAD</button></div>`;
  el.style.display = 'flex';
  document.exitPointerLock?.();
  document.getElementById('crash-reload').onclick = () => location.reload();
}

// The GPU can drop the WebGL context (driver reset, VRAM pressure, GPU process
// restart). Without this the canvas just goes black with no explanation.
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  game.running = false;
  reportCrash('The graphics context was lost (GPU driver reset or out of video memory).',
    new Error('webglcontextlost'));
});

addEventListener('error', (e) => {
  if (loopErrors === 0) reportCrash('Unhandled error', e.error || e.message);
  loopErrors++;
});

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  try {
    game.update(dt);
    game.render(dt);
  } catch (err) {
    loopErrors++;
    // one bad frame is survivable; a persistently broken loop is not
    if (loopErrors <= 3) console.error('frame error', err);
    if (loopErrors === 30) reportCrash('The game loop kept failing.', err);
    return;
  }

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    const rs = game.renderStats || { calls: 0, tris: 0 };
    game.hud.setFps(Math.round(fpsFrames / fpsAcc), `· ${rs.calls} calls · ${(rs.tris / 1000) | 0}k tris`);
    fpsAcc = 0; fpsFrames = 0;
  }
}

boot();
