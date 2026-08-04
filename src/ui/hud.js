// All DOM-side HUD wiring plus the canvas minimap.
import { TEAM } from '../entities/character.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), chLines: $('ch-lines').children, chOut: $('ch-out').children, chDot: $('ch-dot'),
      hitmarker: $('hitmarker'), vignette: $('damage-vignette'), hitDirs: $('hit-dirs'),
      scoreBlue: $('score-blue'), scoreRed: $('score-red'), timer: $('timer'),
      killfeed: $('killfeed'), healthFill: $('health-fill'), healthNum: $('health-num'),
      armorFill: $('armor-fill'), armorNum: $('armor-num'),
      weaponName: $('weapon-name'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
      firemode: $('firemode'), reloadHint: $('reload-hint'), grenadeCount: $('grenade-count'),
      inventory: $('inventory'), centerMsg: $('center-msg'), respawnMsg: $('respawn-msg'),
      respawnSec: $('respawn-sec'), killerName: $('killer-name'),
      scoreboard: $('scoreboard'), sbBlue: $('sb-blue'), sbRed: $('sb-red'),
      sbBlueScore: $('sb-blue-score'), sbRedScore: $('sb-red-score'), sbTarget: $('sb-target'),
      scope: $('scope-overlay'), fps: $('fps-counter'), minimap: $('minimap'),
      pickup: $('pickup-prompt'),
    };
    this.mmCtx = this.el.minimap.getContext('2d');
    this.hitDirEls = [];
    this.lastAmmo = -1;
    this.lastHealth = -1;
    this.feed = [];
    this.mmStatic = null;
  }

  pickupPrompt(html) {
    if (html !== this._pickupHtml) {
      this._pickupHtml = html;
      if (html) this.el.pickup.innerHTML = html;
      this.el.pickup.classList.toggle('on', !!html);
    }
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  buildInventory(player) {
    const items = [
      { key: '1', label: () => player.weapons.primary.def.name, slot: 'primary' },
      { key: '2', label: () => player.weapons.secondary.def.name, slot: 'secondary' },
      { key: '3', label: () => 'COMBAT KNIFE', slot: 'knife' },
      { key: '4', label: () => `FRAG × ${player.grenades}`, slot: 'grenade' },
    ];
    this.el.inventory.innerHTML = '';
    this.invEls = items.map(it => {
      const d = document.createElement('div');
      d.className = 'inv-item';
      d.innerHTML = `<span class="key">${it.key}</span><span class="lbl"></span>`;
      this.el.inventory.appendChild(d);
      return { el: d, lbl: d.querySelector('.lbl'), it };
    });
  }

  hitmarker(kill = false) {
    const el = this.el.hitmarker;
    el.classList.remove('show', 'kill');
    void el.offsetWidth;
    el.classList.add('show');
    if (kill) el.classList.add('kill');
  }

  /** Red screen edge on taking a hit. Called with 0 to clear it (on respawn). */
  damageFlash(amount) {
    clearTimeout(this._vigT);
    if (amount <= 0) { this.el.vignette.style.opacity = 0; return; }
    this.el.vignette.style.opacity = Math.min(0.9, 0.18 + amount / 70);
    this._vigT = setTimeout(() => { this.el.vignette.style.opacity = 0; }, 90);
  }

  centerMessage(text, sub = '', duration = 2.2) {
    this.el.centerMsg.innerHTML = text + (sub ? `<div class="sub">${sub}</div>` : '');
    this.el.centerMsg.classList.add('show');
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => this.el.centerMsg.classList.remove('show'), duration * 1000);
  }

  addKill(killerName, killerTeam, victimName, victimTeam, weaponName, headshot, involvesPlayer) {
    const d = document.createElement('div');
    d.className = 'kf' + (involvesPlayer ? ' you' : '');
    d.innerHTML =
      `<span class="n-${killerTeam}">${killerName}</span>` +
      `<span class="ic">${headshot ? '<span class="hs">✚</span>' : ''} ${weaponName} ▸</span>` +
      `<span class="n-${victimTeam}">${victimName}</span>`;
    this.el.killfeed.appendChild(d);
    const entry = { el: d, t: 5.5 };
    this.feed.push(entry);
    while (this.feed.length > 6) {
      const old = this.feed.shift();
      old.el.remove();
    }
  }

  update(dt, game) {
    const p = game.player;

    // ---- killfeed ageing
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t -= dt;
      if (f.t < 0.6) f.el.classList.add('fade');
      if (f.t <= 0) { f.el.remove(); this.feed.splice(i, 1); }
    }

    // ---- vitals
    const hp = Math.max(0, Math.round(p.health));
    if (hp !== this.lastHealth) {
      this.lastHealth = hp;
      this.el.healthFill.style.width = hp + '%';
      this.el.healthNum.textContent = hp;
      this.el.healthFill.classList.toggle('low', hp <= 30);
      this.el.healthNum.classList.toggle('low', hp <= 30);
    }
    const ar = Math.max(0, Math.round(p.armor));
    this.el.armorFill.style.width = ar + '%';
    this.el.armorNum.textContent = ar;

    // ---- ammo
    if (p.slot === 'grenade') {
      this.el.weaponName.textContent = 'FRAG GRENADE';
      this.el.ammoMag.textContent = p.grenades;
      this.el.ammoReserve.textContent = '';
      document.getElementById('ammo-sep').style.display = 'none';
      this.el.firemode.textContent = 'THROW';
      this.el.reloadHint.classList.add('hidden');
    } else if (p.slot === 'knife') {
      // A knife has no ammo to count, so the big number is dropped entirely
      // rather than shown as a meaningless zero.
      this.el.weaponName.textContent = 'COMBAT KNIFE';
      this.el.ammoMag.textContent = '';
      this.el.ammoReserve.textContent = '';
      document.getElementById('ammo-sep').style.display = 'none';
      this.el.ammoMag.classList.remove('low');
      this.el.firemode.textContent = 'LMB SLASH · RMB STAB';
      this.el.reloadHint.classList.add('hidden');
    } else {
      const w = p.weapon;
      document.getElementById('ammo-sep').style.display = '';
      this.el.weaponName.textContent = w.def.name;
      this.el.ammoMag.textContent = w.ammo;
      this.el.ammoReserve.textContent = w.reserve;
      this.el.ammoMag.classList.toggle('low', w.ammo <= w.def.mag * 0.25);
      this.el.firemode.textContent = w.def.auto ? 'AUTO' : (w.def.boltTime ? 'BOLT' : 'SEMI');
      this.el.reloadHint.classList.toggle('hidden', !(w.ammo <= 0 && w.reserve > 0 && w.reloading <= 0));
    }
    this.el.grenadeCount.textContent = '✚ ' + p.grenades;

    // ---- inventory highlight
    if (this.invEls) {
      for (const v of this.invEls) {
        v.el.classList.toggle('on', v.it.slot === p.slot);
        v.lbl.textContent = v.it.label();
      }
    }

    // ---- crosshair
    //
    // The gap tracks the *square root* of the spread rather than the spread
    // itself. Inaccuracy now spans three orders of magnitude between a planted
    // AWM-S and a running shotgun, and a linear mapping either pins the reticle
    // shut at the bottom of that range or throws it off screen at the top.
    // The knife has no cone, so it gets Counter-Strike's fixed wide reticle
    // instead — a reminder that you are holding something with 1.4 m of reach.
    const spread = (p.currentSpread ?? 0.02);
    const gap = p.slot === 'knife' ? 13 : Math.min(34, 2.6 + Math.sqrt(spread) * 96);
    const len = 4.6;
    const L = this.el.chLines, O = this.el.chOut;
    // top, bottom, left, right — bars grow outward from the gap
    for (const g of [L, O]) {
      g[0].setAttribute('y1', 50 - gap); g[0].setAttribute('y2', 50 - gap - len);
      g[1].setAttribute('y1', 50 + gap); g[1].setAttribute('y2', 50 + gap + len);
      g[2].setAttribute('x1', 50 - gap); g[2].setAttribute('x2', 50 - gap - len);
      g[3].setAttribute('x1', 50 + gap); g[3].setAttribute('x2', 50 + gap + len);
    }
    const chOpacity = p.scoped > 0.5 ? 0 : (1 - (p.sprintPose ?? 0) * 0.85);
    document.getElementById('crosshair').style.opacity = p.alive ? chOpacity : 0;

    // ---- scope
    this.el.scope.classList.toggle('on', p.scoped > 0.8);

    // ---- hit direction arrows
    while (this.hitDirEls.length < p.hitDirs.length) {
      const d = document.createElement('div');
      d.className = 'hitdir';
      this.el.hitDirs.appendChild(d);
      this.hitDirEls.push(d);
    }
    for (let i = 0; i < this.hitDirEls.length; i++) {
      const el = this.hitDirEls[i], h = p.hitDirs[i];
      if (!h) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.transform = `rotate(${h.angle + Math.PI}rad)`;
      el.style.opacity = Math.min(1, h.life / 0.7);
    }

    // ---- score / timer
    this.el.scoreBlue.textContent = game.score.blue;
    this.el.scoreRed.textContent = game.score.red;
    const t = Math.max(0, game.timeLeft);
    this.el.timer.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

    // ---- respawn overlay
    if (!p.alive && game.respawnIn > 0) {
      this.el.respawnMsg.classList.remove('hidden');
      this.el.respawnSec.textContent = Math.ceil(game.respawnIn);
      this.el.killerName.textContent = game.lastKiller ? `KILLED BY ${game.lastKiller}` : '';
    } else {
      this.el.respawnMsg.classList.add('hidden');
    }

    this.drawMinimap(game);
  }

  // ---------------------------------------------------------------- minimap

  /** Rasterise static map geometry once — colliders projected top-down. */
  buildMinimapStatic(game) {
    const S = 320;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    // fit the drawing to whatever map is loaded
    const b = game.mapInfo ? game.mapInfo.bounds : { minX: -64, maxX: 64 };
    const R = this.mmRange = Math.max(Math.abs(b.minX), Math.abs(b.maxX)) + 2;
    const toPx = (v) => (v / (R * 2) + 0.5) * S;

    ctx.fillStyle = '#0b1013';
    ctx.fillRect(0, 0, S, S);

    // walkable surfaces from the nav grid, so the map reads as rooms and streets
    const nav = game.nav;
    const cell = nav.cell / (R * 2) * S;
    ctx.fillStyle = 'rgba(120,150,140,0.16)';
    for (let i = 0; i < nav.nx.length; i++) {
      if (nav.ny[i] > 1.2) continue;
      ctx.fillRect(toPx(nav.nx[i]) - cell / 2, toPx(nav.nz[i]) - cell / 2, cell + 0.6, cell + 0.6);
    }
    ctx.fillStyle = 'rgba(150,190,180,0.24)';
    for (let i = 0; i < nav.nx.length; i++) {
      if (nav.ny[i] <= 1.2) continue;
      ctx.fillRect(toPx(nav.nx[i]) - cell / 2, toPx(nav.nz[i]) - cell / 2, cell + 0.6, cell + 0.6);
    }

    // wall outlines
    ctx.strokeStyle = 'rgba(190,215,205,0.30)';
    ctx.lineWidth = 1;
    for (const col of game.physics.colliders) {
      const hy = col.c.y + col.h.y;
      if (hy < 0.9 || col.h.x > 60) continue;
      ctx.save();
      ctx.translate(toPx(col.c.x), toPx(col.c.z));
      ctx.rotate(col.yaw);
      const w = col.h.x * 2 / (R * 2) * S, h = col.h.z * 2 / (R * 2) * S;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    this.mmStatic = c;
  }

  drawMinimap(game) {
    const ctx = this.mmCtx;
    const S = 320, R = this.mmRange || 64;
    const p = game.player;
    ctx.clearRect(0, 0, S, S);
    // Counter-Strike's radar is a disc, not a rectangle: everything the map
    // draws is clipped to it so geometry fades out at a constant range in
    // every direction instead of reaching further along the diagonals.
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.save();
    // rotate the world so the player always faces up
    ctx.translate(S / 2, S / 2);
    const zoom = Math.max(1.6, 140 / R);
    ctx.scale(zoom, zoom);
    ctx.rotate(p.yaw);
    ctx.translate(-((p.pos.x / (R * 2) + 0.5) * S), -((p.pos.z / (R * 2) + 0.5) * S));
    if (this.mmStatic) ctx.drawImage(this.mmStatic, 0, 0);

    const toPx = (v) => (v / (R * 2) + 0.5) * S;
    // characters
    for (const c of game.characters) {
      if (!c.alive || c === p) continue;
      const known = c.team === p.team || game.isVisibleToPlayer(c);
      if (!known) continue;
      ctx.fillStyle = c.team === p.team ? '#8ad2ff' : '#ff4b3e';
      ctx.beginPath();
      ctx.arc(toPx(c.pos.x), toPx(c.pos.z), 3.0, 0, 7);
      ctx.fill();
      // facing tick
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(toPx(c.pos.x), toPx(c.pos.z));
      ctx.lineTo(toPx(c.pos.x) - Math.sin(c.yaw) * 7, toPx(c.pos.z) - Math.cos(c.yaw) * 7);
      ctx.stroke();
    }
    ctx.restore();

    // player arrow, fixed at the centre
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.fillStyle = '#eef6ff';
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();   // end of the disc clip

    // Rim only. The compass letters that used to ride this edge are gone: the
    // radar is player-up, so a rotating N/E/S/W ring is four moving labels that
    // never answer the question the radar is for — where the enemy is.
    ctx.strokeStyle = 'rgba(190,225,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- scoreboard

  showScoreboard(game) {
    this.el.scoreboard.classList.remove('hidden');
    this.renderScoreboard(game);
  }
  hideScoreboard() { this.el.scoreboard.classList.add('hidden'); }

  renderScoreboard(game) {
    this.el.sbBlueScore.textContent = game.score.blue;
    this.el.sbRedScore.textContent = game.score.red;
    this.el.sbTarget.textContent = `SCORE LIMIT ${game.scoreLimit}`;
    for (const team of ['blue', 'red']) {
      const rows = game.characters
        .filter(c => c.team === team)
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const tbody = team === 'blue' ? this.el.sbBlue : this.el.sbRed;
      tbody.innerHTML = rows.map(c => {
        const acc = c.shotsFired > 0 ? Math.round(c.shotsHit / c.shotsFired * 100) : 0;
        return `<tr class="${c.isPlayer ? 'me' : ''}${c.alive ? '' : ' dead'}">` +
          `<td>${c.name}</td><td>${c.kills}</td><td>${c.deaths}</td><td>${acc}%</td>` +
          `<td>${c.isPlayer ? 8 : c.ping}</td></tr>`;
      }).join('');
    }
  }

  setFps(v, extra = '') {
    this.el.fps.textContent = `${v} FPS ${extra}`;
  }
}
