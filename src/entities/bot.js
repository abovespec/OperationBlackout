// NPC combatants. Perception -> decision -> steering -> gunplay, all scaled by a
// difficulty profile so the same brain can play like a rookie or like a machine.
import * as THREE from 'three';
import { Character } from './character.js';
import { WEAPONS, WeaponInstance, PRIMARIES } from './weapons.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export const DIFFICULTIES = [
  {
    id: 0, name: 'RECRUIT',
    blurb: 'Conscripts. Slow to notice you, slow to aim, and they give up the moment you break contact.\n<b>Reaction 1.2s · Accuracy 20% · Sees 38m</b>',
    // Deliberately forgiving: long reaction, wide cone, short sight range and
    // low damage, so a new player can win a fight they walked into badly.
    reaction: [0.85, 1.7], aimError: 0.140, aimErrorMoving: 0.098, aimSpeed: 2.0, aimJitter: 0.030,
    fov: 78, view: 38, hearing: 12, burst: [2, 4], burstPause: [0.85, 2.0],
    leadFactor: 0.0, damageMult: 0.36, healthMult: 1.0, aggression: 0.26,
    coverUse: 0.10, strafe: 0.22, crouchChance: 0.08, grenades: 0, reactionLoss: 1.0,
    preferWeapons: ['mp5k', 'm4a1'], moveSpeed: 0.74, retreatHealth: 0,
  },
  {
    id: 1, name: 'REGULAR',
    blurb: 'Trained infantry. They take cover, fire in bursts and can track a moving target.\n<b>Reaction 0.45s · Accuracy 52% · Basic cover</b>',
    reaction: [0.34, 0.62], aimError: 0.048, aimErrorMoving: 0.032, aimSpeed: 5.0, aimJitter: 0.013,
    fov: 115, view: 75, hearing: 30, burst: [3, 6], burstPause: [0.3, 0.7],
    leadFactor: 0.35, damageMult: 0.78, healthMult: 1.0, aggression: 0.5,
    coverUse: 0.4, strafe: 0.5, crouchChance: 0.25, grenades: 1, reactionLoss: 0.7,
    preferWeapons: ['m4a1', 'ak74', 'mp5k'], moveSpeed: 0.95, retreatHealth: 18,
  },
  {
    id: 2, name: 'HARDENED',
    blurb: 'Veterans of District 7. Disciplined bursts, real cover discipline, they will flank you.\n<b>Reaction 0.30s · Accuracy 68% · Flanks & grenades</b>',
    reaction: [0.22, 0.42], aimError: 0.030, aimErrorMoving: 0.021, aimSpeed: 7.0, aimJitter: 0.009,
    fov: 130, view: 95, hearing: 40, burst: [4, 8], burstPause: [0.22, 0.5],
    leadFactor: 0.65, damageMult: 1.0, healthMult: 1.0, aggression: 0.62,
    coverUse: 0.6, strafe: 0.7, crouchChance: 0.35, grenades: 2, reactionLoss: 0.55,
    preferWeapons: ['m4a1', 'ak74', 'scarh', 'mp5k'], moveSpeed: 1.0, retreatHealth: 28,
  },
  {
    id: 3, name: 'VETERAN',
    blurb: 'Special forces. Fast target acquisition, aggressive angles, punishing accuracy.\n<b>Reaction 0.18s · Accuracy 82% · Suppression & flanks</b>',
    reaction: [0.13, 0.26], aimError: 0.018, aimErrorMoving: 0.013, aimSpeed: 9.5, aimJitter: 0.006,
    fov: 150, view: 120, hearing: 52, burst: [5, 10], burstPause: [0.16, 0.34],
    leadFactor: 0.85, damageMult: 1.15, healthMult: 1.0, aggression: 0.75,
    coverUse: 0.7, strafe: 0.85, crouchChance: 0.4, grenades: 2, reactionLoss: 0.4,
    preferWeapons: ['ak74', 'scarh', 'm4a1', 'awm'], moveSpeed: 1.05, retreatHealth: 35,
  },
  {
    id: 4, name: 'ELITE',
    blurb: 'Black-programme operators. Near-instant reaction, laser bursts, relentless pressure.\n<b>Reaction 0.09s · Accuracy 93% · Full tactics</b>',
    reaction: [0.06, 0.14], aimError: 0.0075, aimErrorMoving: 0.006, aimSpeed: 13.0, aimJitter: 0.0028,
    fov: 175, view: 150, hearing: 70, burst: [6, 14], burstPause: [0.10, 0.24],
    leadFactor: 1.0, damageMult: 1.3, healthMult: 1.1, aggression: 0.88,
    coverUse: 0.75, strafe: 0.95, crouchChance: 0.45, grenades: 3, reactionLoss: 0.25,
    preferWeapons: ['scarh', 'ak74', 'awm', 'm4a1'], moveSpeed: 1.12, retreatHealth: 40,
  },
];

const FIRST = ['Reaper', 'Havoc', 'Wraith', 'Cinder', 'Bishop', 'Talon', 'Rook', 'Mako', 'Vulture', 'Nomad',
  'Ronin', 'Kilo', 'Zulu', 'Delta', 'Sable', 'Onyx', 'Falcon', 'Crow', 'Blitz', 'Ember',
  'Cobra', 'Ghostie', 'Riptide', 'Slate', 'Anvil', 'Hex', 'Vandal', 'Prowler'];
let nameIdx = 0;
export function botName() {
  const base = FIRST[nameIdx % FIRST.length];
  const tag = nameIdx >= FIRST.length ? `-${Math.floor(nameIdx / FIRST.length) + 1}` : '';
  nameIdx++;
  return base + tag;
}
export function resetNames() { nameIdx = 0; }

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export class Bot extends Character {
  constructor(scene, teamId, name, difficulty, game) {
    super(scene, teamId, name, true);
    this.game = game;
    this.D = DIFFICULTIES[difficulty];
    this.state = 'patrol';
    this.target = null;
    this.lastSeen = new THREE.Vector3();
    this.lastSeenTime = -99;
    this.spottedAt = -99;       // when the current target was first seen
    this.reactTime = 0;
    this.path = [];
    this.pathIdx = 0;
    this.repathTimer = 0;
    this.senseTimer = Math.random() * 0.2;
    this.burstLeft = 0;
    this.burstCooldown = 0;
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.desired = new THREE.Vector3();
    this.moveTarget = null;
    this.stuckTimer = 0;
    this.lastPos = new THREE.Vector3();
    this.jumpCooldown = 0;
    this.grenadesLeft = this.D.grenades;
    this.grenadeCooldown = rand(6, 18);
    this.crouchTarget = 0;
    this.ping = 12 + Math.floor(Math.random() * 60);
    this.onGround = true;
    this.behaviourTimer = 0;
    // some operators prefer height: they seek out catwalks, roofs and the tower
    this.likesHeight = Math.random() < 0.38;
    this.perchTimer = 0;

    const wid = pick(this.D.preferWeapons.length ? this.D.preferWeapons : PRIMARIES);
    this.weapon = new WeaponInstance(wid);
    this.setWeaponModel(wid);
    this.health = 100 * this.D.healthMult;
  }

  respawn(x, y, z, yaw) {
    this.spawn(x, y, z, yaw);
    this.health = 100 * this.D.healthMult;
    this.aimYaw = yaw;
    this.aimPitch = 0;
    this.state = 'patrol';
    this.target = null;
    this.path = [];
    this.pathIdx = 0;
    this.weapon.ammo = this.weapon.def.mag;
    this.weapon.reserve = this.weapon.def.reserve;
    this.weapon.reloading = 0;
    this.burstLeft = 0;
    this.grenadesLeft = this.D.grenades;
    this.moveTarget = null;
  }

  // ------------------------------------------------------------- perception

  sense(time) {
    const game = this.game;
    let best = null, bestScore = -Infinity;
    this.eyePos(_v);
    const fwd = _v2.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (const c of game.characters) {
      if (c === this || !c.alive || c.team === this.team) continue;
      c.eyePos(_v3);
      const dist = _v.distanceTo(_v3);
      if (dist > this.D.view) continue;
      const dx = (_v3.x - _v.x) / dist, dz = (_v3.z - _v.z) / dist;
      const dot = dx * fwd.x + dz * fwd.z;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
      const inFov = angle <= this.D.fov / 2;
      // A target moving silently (walking or crouch-walking) is not heard, so
      // it has to be seen — this is what buys the walk key its cost in speed.
      const close = !c.quiet && dist < this.D.hearing * 0.35;
      // loud enemies (firing / sprinting) are noticed outside the view cone
      const loud = c.lastFireTime !== undefined && time - c.lastFireTime < 1.2 && dist < this.D.hearing;
      if (!inFov && !close && !loud) continue;
      if (!game.physics.visible(_v, _v3, 0.05)) {
        // try the chest as well, heads peek less
        _v3.y -= 0.35;
        if (!game.physics.visible(_v, _v3, 0.05)) continue;
      }
      const score = 200 - dist + (inFov ? 60 : 0) + (c === game.player ? 15 : 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }

    if (best) {
      if (this.target !== best) {
        this.spottedAt = time;
        this.reactTime = rand(this.D.reaction[0], this.D.reaction[1]);
        // being shot at recently sharpens the reaction
        if (time - (this.lastHurtTime ?? -99) < 3) this.reactTime *= this.D.reactionLoss;
      }
      this.target = best;
      this.lastSeen.copy(best.pos);
      this.lastSeenTime = time;
      this.hasLos = true;
    } else {
      this.hasLos = false;
      if (this.target && time - this.lastSeenTime > 4.5) this.target = null;
    }
  }

  /** Called by the game when this bot takes a hit — makes them turn and fight back. */
  onDamaged(from, time) {
    this.lastHurtTime = time;
    if (from && from.alive && from.team !== this.team) {
      if (!this.target || !this.hasLos) {
        this.target = from;
        this.lastSeen.copy(from.pos);
        this.lastSeenTime = time - 0.4;
        this.spottedAt = time;
        this.reactTime = rand(this.D.reaction[0], this.D.reaction[1]) * this.D.reactionLoss;
      }
      // flinch: high-skill bots reposition into cover
      if (Math.random() < this.D.coverUse * 0.6) this.wantCover = true;
    }
  }

  // ------------------------------------------------------------- navigation

  setDestination(x, y, z) {
    const nav = this.game.nav;
    const a = nav.nodeAt(this.pos.x, this.pos.y, this.pos.z);
    const b = nav.nodeAt(x, y, z);
    if (a < 0 || b < 0) return false;
    const p = nav.path(a, b);
    if (!p) return false;
    this.path = nav.toWaypoints(p);
    this.pathIdx = 0;
    this.moveTarget = new THREE.Vector3(x, y, z);
    return true;
  }

  pickWanderTarget() {
    const game = this.game;
    // head toward contested ground, biased to where the fighting is
    let x, z, y = 0;
    // height-seekers periodically break off to take an elevated position
    if (this.likesHeight && this.perchTimer <= 0) {
      const high = game.hotspots.filter(h => (h[2] ?? 0) > 2);
      if (high.length) {
        const h = pick(high);
        this.perchTimer = rand(14, 30);
        x = h[0] + (Math.random() - 0.5) * 4;
        z = h[1] + (Math.random() - 0.5) * 4;
        if (this.setDestination(x, h[2], z)) return;
      }
    }
    if (game.lastCombat && Math.random() < 0.5 + this.D.aggression * 0.3) {
      const a = Math.random() * 6.283, r = 6 + Math.random() * 16;
      x = game.lastCombat.x + Math.cos(a) * r;
      z = game.lastCombat.z + Math.sin(a) * r;
      y = game.lastCombat.y;
    } else {
      const h = pick(game.hotspots);
      const spread = h[2] ? 4 : 12;   // rooftop hotspots need a tighter target
      x = h[0] + (Math.random() - 0.5) * spread;
      z = h[1] + (Math.random() - 0.5) * spread;
      y = h[2] ?? 0;
    }
    if (!this.setDestination(x, y, z)) {
      const n = this.game.nav.randomNode();
      this.setDestination(this.game.nav.nx[n], this.game.nav.ny[n], this.game.nav.nz[n]);
    }
  }

  followPath(dt) {
    if (this.pathIdx >= this.path.length) { this.desired.set(0, 0, 0); return false; }
    const wp = this.path[this.pathIdx];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const dy = wp.y - this.pos.y;
    if (d < 1.1 && Math.abs(dy) < 2.4) {
      this.pathIdx++;
      return this.pathIdx < this.path.length;
    }
    this.desired.set(dx / d, 0, dz / d);
    // step up onto ledges
    if (dy > 0.55 && d < 2.0 && this.onGround && this.jumpCooldown <= 0) {
      this.vel.y = 5.2;
      this.jumpCooldown = 0.7;
    }
    return true;
  }

  // ------------------------------------------------------------- main update

  update(dt, time) {
    if (!this.alive) { this.animate(dt, time); return; }
    const game = this.game;
    const D = this.D;

    this.senseTimer -= dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.10 + Math.random() * 0.08;
      this.sense(time);
    }

    this.repathTimer -= dt;
    this.jumpCooldown -= dt;
    this.strafeTimer -= dt;
    this.burstCooldown -= dt;
    this.grenadeCooldown -= dt;
    this.behaviourTimer -= dt;
    this.perchTimer -= dt;

    const tgt = this.target;
    const engaged = tgt && tgt.alive && (this.hasLos || time - this.lastSeenTime < 3.0);
    const distToTarget = tgt ? this.pos.distanceTo(tgt.pos) : Infinity;

    // ---- state selection
    if (this.weapon.reloading > 0) {
      this.state = 'reload';
    } else if (engaged) {
      if (this.health < D.retreatHealth && Math.random() < 0.02) this.wantCover = true;
      this.state = this.hasLos ? 'engage' : 'search';
    } else if (tgt) {
      this.state = 'search';
    } else {
      this.state = 'patrol';
    }

    // ---- movement goal
    if (this.state === 'patrol') {
      const perched = this.likesHeight && this.pos.y > 2.5 && this.perchTimer > 0;
      if (!perched && (this.pathIdx >= this.path.length || this.repathTimer <= 0 && Math.random() < 0.02)) {
        this.pickWanderTarget();
        this.repathTimer = rand(3, 7);
      }
      this.followPath(dt);
      this.crouchTarget = 0;
    } else if (this.state === 'search') {
      if (this.repathTimer <= 0 || this.pathIdx >= this.path.length) {
        const jitter = 4;
        this.setDestination(
          this.lastSeen.x + (Math.random() - 0.5) * jitter,
          this.lastSeen.y,
          this.lastSeen.z + (Math.random() - 0.5) * jitter
        );
        this.repathTimer = rand(1.4, 2.8);
      }
      this.followPath(dt);
      this.crouchTarget = 0;
    } else if (this.state === 'engage') {
      this.updateEngageMovement(dt, time, tgt, distToTarget);
    } else if (this.state === 'reload') {
      // back off while reloading if the skill is there
      if (this.hasLos && Math.random() < D.coverUse * dt * 3) this.wantCover = true;
      if (this.wantCover) this.moveToCover(tgt);
      this.followPath(dt);
      this.crouchTarget = D.crouchChance > Math.random() ? 1 : 0;
    }

    // ---- aiming
    let aimTargetYaw = this.aimYaw, aimTargetPitch = this.aimPitch;
    if (tgt && (this.hasLos || time - this.lastSeenTime < 1.2)) {
      this.muzzleWorld(_v);
      this.eyePos(_v);
      // aim at chest, lead the target based on skill
      _v2.copy(this.hasLos ? tgt.pos : this.lastSeen);
      _v2.y += tgt.eyeHeight - 0.25;
      if (this.hasLos && D.leadFactor > 0) {
        const flight = distToTarget / 400;
        _v2.x += tgt.vel.x * flight * D.leadFactor * 12;
        _v2.z += tgt.vel.z * flight * D.leadFactor * 12;
      }
      _v3.subVectors(_v2, _v);
      const hd = Math.hypot(_v3.x, _v3.z);
      aimTargetYaw = Math.atan2(-_v3.x, -_v3.z);
      aimTargetPitch = Math.atan2(_v3.y, hd);
    } else if (this.desired.lengthSq() > 0.01) {
      aimTargetYaw = Math.atan2(-this.desired.x, -this.desired.z);
      aimTargetPitch *= 0.9;
    }

    const turnRate = D.aimSpeed * (this.state === 'engage' ? 1 : 0.55);
    this.aimYaw = angleLerp(this.aimYaw, aimTargetYaw, 1 - Math.exp(-turnRate * dt));
    this.aimPitch += (aimTargetPitch - this.aimPitch) * (1 - Math.exp(-turnRate * dt));
    this.yaw = this.aimYaw;
    this.pitch = this.aimPitch;

    // ---- shooting
    if (this.state === 'engage' && this.hasLos && tgt) {
      const settled = time - this.spottedAt >= this.reactTime;
      const aimOff = Math.abs(angleDiff(this.aimYaw, aimTargetYaw));
      if (settled && aimOff < 0.22) this.tryFire(dt, time, tgt, distToTarget);
      if (settled && this.grenadesLeft > 0 && this.grenadeCooldown <= 0 &&
          distToTarget > 12 && distToTarget < 34 && Math.random() < 0.5) {
        this.throwGrenade(tgt);
      }
    }

    // ---- reload logic
    const w = this.weapon;
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        const need = w.def.mag - w.ammo;
        const take = Math.min(need, w.reserve);
        w.ammo += take; w.reserve -= take;
      }
    } else if (w.ammo <= 0 || (w.ammo <= w.def.mag * 0.25 && !this.hasLos && w.reserve > 0)) {
      if (w.reserve > 0) {
        w.reloading = (w.ammo <= 0 ? w.def.reloadEmpty : w.def.reload) * (1.25 - this.D.id * 0.05);
      } else {
        w.reserve = w.def.reserve; // bots resupply rather than idle uselessly
      }
    }

    this.applyMovement(dt, time);
    this.animate(dt, time);
  }

  updateEngageMovement(dt, time, tgt, dist) {
    const D = this.D;
    // hold and shoot from cover, or push depending on aggression
    if (this.wantCover) {
      this.moveToCover(tgt);
      this.wantCover = false;
    }
    const wantDist = this.weapon.def.range * 0.45;
    const pushing = Math.random() < D.aggression;

    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(0.5, 1.4);
      if (Math.random() < 0.55) this.strafeDir *= -1;
    }
    if (this.behaviourTimer <= 0) {
      this.behaviourTimer = rand(1.0, 2.5);
      this.crouchTarget = (dist > 16 && Math.random() < D.crouchChance) ? 1 : 0;
    }

    // straight-line approach/retreat plus a strafe component
    _v.subVectors(tgt.pos, this.pos); _v.y = 0;
    const d = _v.length() || 1;
    _v.divideScalar(d);
    const strafeX = -_v.z * this.strafeDir, strafeZ = _v.x * this.strafeDir;
    let ax = 0, az = 0;
    if (dist > wantDist * 1.4 && pushing) { ax += _v.x; az += _v.z; }
    else if (dist < 6.5) { ax -= _v.x * 0.9; az -= _v.z * 0.9; }
    ax += strafeX * D.strafe; az += strafeZ * D.strafe;
    const l = Math.hypot(ax, az) || 1;
    // settle while the burst is going out
    const firing = this.burstLeft > 0 && time - this.lastFireTime < 0.35;
    const gain = firing ? 0.28 : 1;
    this.desired.set(ax / l * gain, 0, az / l * gain);
    this.path.length = 0;

    // if the strafe walks us into a wall, flip direction
    if (this.stuckTimer > 0.35) { this.strafeDir *= -1; this.stuckTimer = 0; }
  }

  moveToCover(tgt) {
    if (!tgt) return;
    const nav = this.game.nav;
    const here = nav.nodeAt(this.pos.x, this.pos.y, this.pos.z);
    if (here < 0) return;
    _v.copy(tgt.pos); _v.y += 1.5;
    const n = nav.findCover(here, _v, 16);
    if (n >= 0) {
      const p = nav.path(here, n);
      if (p) { this.path = nav.toWaypoints(p); this.pathIdx = 0; }
    }
  }

  tryFire(dt, time, tgt, dist) {
    const w = this.weapon;
    const def = w.def;
    if (w.reloading > 0 || w.ammo <= 0) return;
    if (this.burstLeft <= 0) {
      if (this.burstCooldown > 0) return;
      this.burstLeft = Math.round(rand(this.D.burst[0], this.D.burst[1]));
      if (!def.auto) this.burstLeft = Math.min(this.burstLeft, def.id === 'awm' ? 1 : 2);
    }
    const interval = 60 / def.rpm;
    if (time - w.lastShot < interval) return;
    w.lastShot = time;
    w.ammo--;
    this.burstLeft--;
    if (this.burstLeft <= 0) {
      this.burstCooldown = rand(this.D.burstPause[0], this.D.burstPause[1]);
      if (def.id === 'awm') this.burstCooldown += def.boltTime;
    }
    this.recoilKick = 0.35;
    this.lastFireTime = time;
    this.shotsFired += def.pellets;

    // aim error grows with movement and distance, shrinks with skill
    // moving fire is noticeably worse than a planted shot
    const moving = Math.hypot(this.vel.x, this.vel.z) > 1.5;
    let err = moving ? this.D.aimError : this.D.aimErrorMoving;
    err *= 1 + Math.max(0, dist - 30) * 0.0055;
    if (tgt.crouch > 0.5) err *= 1.15;
    err += this.D.aimJitter * Math.sin(time * 9.3 + this.ping);

    this.muzzleWorld(_v);
    // fire from the eye line so shots do not clip our own cover
    this.eyePos(_v2);
    _v.lerp(_v2, 0.55);
    _v2.copy(tgt.pos);
    _v2.y += tgt.eyeHeight - 0.28;
    _v3.subVectors(_v2, _v).normalize();

    this.game.fireWeapon(this, _v, _v3, def, err, true);
  }

  throwGrenade(tgt) {
    this.grenadesLeft--;
    this.grenadeCooldown = rand(9, 22);
    this.eyePos(_v);
    _v2.subVectors(tgt.pos, this.pos);
    const dist = _v2.length();
    _v2.normalize();
    const up = Math.min(0.6, 0.18 + dist * 0.012);
    _v2.y += up;
    _v2.normalize().multiplyScalar(Math.min(24, 10 + dist * 0.5));
    this.game.spawnGrenade(this, _v, _v2);
  }

  applyMovement(dt, time) {
    const D = this.D;
    const speedBase = 6.4 * D.moveSpeed * this.weapon.def.moveMult;
    const crouchMult = 1 - this.crouch * 0.45;
    const maxSpeed = speedBase * crouchMult * (this.state === 'patrol' ? 0.82 : 1);

    this.crouch += (this.crouchTarget - this.crouch) * Math.min(1, dt * 7);

    const accel = this.onGround ? 42 : 8;
    const wish = this.desired;
    if (wish.lengthSq() > 0.001) {
      this.vel.x += wish.x * accel * dt;
      this.vel.z += wish.z * accel * dt;
    }
    // ground friction
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround) {
      const drop = Math.max(0, hs - Math.max(0, hs - 30 * dt));
      if (hs > 0.01 && wish.lengthSq() < 0.001) {
        const f = Math.max(0, hs - 34 * dt) / hs;
        this.vel.x *= f; this.vel.z *= f;
      }
    }
    if (hs > maxSpeed) {
      const f = maxSpeed / hs;
      this.vel.x *= f; this.vel.z *= f;
    }

    this.vel.y -= 22 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const h = 1.78 - this.crouch * 0.55;
    const r = this.game.physics.resolve(this.pos, this.radius, h, 0.55);
    if (r.ground && this.vel.y <= 0.02) {
      this.pos.y = r.groundY;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    if (r.ceiling && this.vel.y > 0) this.vel.y = 0;
    if (this.pos.y < -6) this.pos.set(0, 3, 0);

    // stuck detection
    if (this.lastPos.distanceToSquared(this.pos) < 0.0012 && this.desired.lengthSq() > 0.1) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.1) {
        this.stuckTimer = 0;
        this.path.length = 0;
        this.pathIdx = 0;
        this.repathTimer = 0;
        this.strafeDir *= -1;
        if (this.onGround && Math.random() < 0.4) this.vel.y = 5.0;
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 0.5);
    }
    this.lastPos.copy(this.pos);

    // footstep audio for nearby bots
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.footAccum = (this.footAccum ?? 0) + speed * dt;
    if (this.footAccum > 2.0 && this.onGround) {
      this.footAccum = 0;
      const d = this.pos.distanceTo(this.game.player.pos);
      if (d < 28) this.game.audio.footstep('concrete', 0.5 * (1 - d / 28), this.pos);
    }
  }
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function angleLerp(a, b, t) {
  return a + angleDiff(a, b) * t;
}
