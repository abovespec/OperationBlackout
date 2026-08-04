// The local player: input, Quake-flavoured movement, and the first-person weapon rig.
import * as THREE from 'three';
import { Character } from './character.js';
import { WEAPONS, WeaponInstance, buildViewModel } from './weapons.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

const WALK = 5.6, SPRINT = 8.6, CROUCH_SPEED = 2.9, ACCEL = 62, AIR_ACCEL = 9, FRICTION = 11;
const JUMP_VEL = 6.4, GRAVITY = 22;
// First-person weapon scale (see setLoadout). The tactical rig runs smaller:
// Counter-Strike's view model occupies roughly the bottom-right sixth of the
// screen, where ours filled most of the right-hand third and hid anything
// crouched behind cover on that side. That is a real competitive cost, not a
// styling preference — you cannot clear an angle you cannot see.
const VM_SCALE = 0.60, VM_SCALE_CS = 0.49;

// Tactical ruleset speeds, in the Counter-Strike proportions. There is no
// sprint: the run above IS the top speed, SHIFT drops you to a slow silent
// walk, and crouching is slower still than walking. The ratios (0.52 walk,
// 0.38 crouch) are what make holding an angle a real trade rather than a
// free action — you give up the ability to reposition quickly to stay quiet.
const CS_WALK_MULT = 0.52, CS_CROUCH_MULT = 0.38;

export class Player extends Character {
  constructor(scene, camera, game, teamId = 'blue') {
    super(scene, teamId, 'YOU', false);
    this.camera = camera;
    this.game = game;
    this.object.visible = false;   // never draw our own body
    this.isPlayer = true;

    this.keys = {};
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.sensitivity = 1.0;
    this.invertY = false;
    this.baseFov = 90;

    // the weapon rig lives in the dedicated view-model scene, in view space
    this.rigRoot = new THREE.Group();
    game.vmScene.add(this.rigRoot);
    this.rigOffset = new THREE.Group();
    this.rigRoot.add(this.rigOffset);
    this.models = {};

    // The knife is always carried and never configurable, so it lives in the
    // loadout as a fixed entry rather than being a menu choice.
    this.loadout = { primary: 'm4a1', secondary: 'g18', knife: 'knife' };
    this.weapons = {};
    this.slot = 'primary';
    this.lastSlot = 'secondary';
    this.meleeAnim = 0;        // 0..1 through the current swing
    this.meleeTotal = 0;
    this.meleeHeavy = false;
    this.meleeSwung = false;   // the damage tick has already fired this swing
    this.grenades = 2;
    this.grenadeCharge = 0;

    // view state
    this.ads = 0;              // 0..1
    this.adsTarget = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.sway = new THREE.Vector2();
    this.swayVel = new THREE.Vector2();
    this.lastLookDx = 0;
    this.lastLookDy = 0;
    this.lean = 0;
    this.sprintPose = 0;
    this.reloadTotal = 1;
    this.currentSpread = 0.02;
    this.recoilPitch = 0;      // spring "punch", visual only
    this.recoilYaw = 0;
    this.recoilVelP = 0;
    this.recoilVelY = 0;
    this.sprayP = 0;           // where the spray pattern has walked the aim
    this.sprayY = 0;
    this.sprayTargetP = 0;
    this.sprayTargetY = 0;
    this.viewKick = 0;
    this.viewKickVel = 0;
    this.spread = 0;
    this.switching = 0;
    this.switchTo = null;
    this.reloadAnim = 0;
    this.landDip = 0;
    this.landDipVel = 0;
    this.stepAccum = 0;
    this.sprinting = false;
    this.cs = true;            // tactical ruleset: no sprint, no ADS, footwork accuracy
    this.vmScale = VM_SCALE_CS;
    this.slowWalking = false;  // SHIFT held under the tactical ruleset — silent
    this.quiet = false;        // making no footstep noise this frame (read by Bot)
    this.onGround = true;
    this.crouchHeld = false;
    this.lastFireTime = -99;
    this.fireHeld = false;
    this.semiLatch = false;
    this.shakeTime = 0;
    this.shakeMag = 0;
    this.regenTimer = 0;
    this.lastDamageTime = -99;
    this.scoped = 0;

    this.hitDirs = [];
  }

  setLoadout(primary, secondary) {
    this.loadout.primary = primary;
    this.loadout.secondary = secondary;
    // View models are cached across matches, so the scale has to be re-applied
    // here rather than only at build time — the ruleset can change between them.
    this.vmScale = this.cs ? VM_SCALE_CS : VM_SCALE;
    this.weapons.primary = new WeaponInstance(primary);
    this.weapons.secondary = new WeaponInstance(secondary);
    this.weapons.knife = new WeaponInstance('knife');
    for (const id of [primary, secondary, 'knife', 'grenade']) {
      if (!this.models[id]) {
        const m = buildViewModel(id, { hands: true });
        m.visible = false;
        this.rigOffset.add(m);
        this.models[id] = m;
      }
    }
    for (const id of Object.keys(this.models)) {
      const m = this.models[id];
      // view models are deliberately under-scaled — full-size guns eat the
      // screen — but a weapon may opt out (the knife is far shorter than a
      // rifle and disappears at the shared scale), and may carry a rest pose.
      m.scale.setScalar(this.vmScale * (m.userData.vmScaleMult ?? 1));
      const r = m.userData.restRot;
      if (r) m.rotation.set(r[0], r[1], r[2]);
      m.visible = false;
    }
    this.slot = 'primary';
    this.lastSlot = 'secondary';
    this.models[primary].visible = true;
    this.setWeaponModel(primary);
  }

  get weapon() { return this.weapons[this.slot]; }
  get model() { return this.models[this.slot === 'grenade' ? 'grenade' : this.loadout[this.slot]]; }

  respawn(x, y, z, yaw) {
    this.spawn(x, y, z, yaw);
    this.object.visible = false;
    this.pitch = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.ads = this.adsTarget = 0;
    this.grenades = 2;
    for (const k of ['primary', 'secondary']) {
      const w = this.weapons[k];
      w.ammo = w.def.mag;
      w.reserve = w.def.reserve;
      w.reloading = 0;
    }
    this.switchSlot('primary', true);
    this.health = 100;
    this.armor = 100;
    this.hitDirs.length = 0;
  }

  // ------------------------------------------------------------------ input

  onKey(code, down) {
    this.keys[code] = down;
    if (!down || !this.alive) return;
    // Counter-Strike's slot order: 1 primary, 2 pistol, 3 knife, 4 grenade.
    // G stays a direct grenade shortcut so the old muscle memory still works.
    if (code === 'Digit1') this.switchSlot('primary');
    else if (code === 'Digit2') this.switchSlot('secondary');
    else if (code === 'Digit3') this.switchSlot('knife');
    else if (code === 'Digit4' || code === 'KeyG') this.switchSlot('grenade');
    else if (code === 'KeyQ') this.switchSlot(this.lastSlot);
    else if (code === 'KeyR') this.startReload();
    else if (code === 'KeyE') this.game.tryPickup();
  }

  onWheel(dir) {
    if (!this.alive) return;
    const order = ['primary', 'secondary', 'knife', 'grenade'];
    let i = order.indexOf(this.slot);
    i = (i + (dir > 0 ? 1 : -1) + order.length) % order.length;
    if (order[i] === 'grenade' && this.grenades <= 0) i = (i + (dir > 0 ? 1 : -1) + order.length) % order.length;
    this.switchSlot(order[i]);
  }

  switchSlot(slot, instant = false) {
    if (slot === this.slot) return;
    if (slot === 'grenade' && this.grenades <= 0) return;
    if (this.switching > 0 && !instant) return;
    this.lastSlot = this.slot === 'grenade' ? this.lastSlot : this.slot;
    this.switchTo = slot;
    // The knife comes up fast — that speed is most of why you would draw it
    // when a reload would get you killed.
    this.switching = this.switchTotal = instant ? 0.001 : (slot === 'knife' ? 0.26 : 0.42);
    this.meleeAnim = 0;
    this.meleeSwung = false;
    this.adsTarget = 0;
    if (this.weapon) this.weapon.reloading = 0;
    this.game.audio.click('swap');
  }

  /**
   * Swap a dropped weapon into the slot its class belongs to and draw it.
   * Returns the replaced weapon's {id, ammo, reserve} so the caller can put
   * it on the ground where the pickup was.
   */
  pickupWeapon(id, ammo, reserve) {
    const def = WEAPONS[id];
    const slotKey = def.slot === 'secondary' ? 'secondary' : 'primary';
    const old = this.weapons[slotKey];
    const oldState = { id: old.id, ammo: old.ammo, reserve: old.reserve };

    this.loadout[slotKey] = id;
    const w = new WeaponInstance(id);
    w.ammo = ammo;
    w.reserve = reserve;
    this.weapons[slotKey] = w;

    if (!this.models[id]) {
      const m = buildViewModel(id, { hands: true });
      m.scale.setScalar(this.vmScale * (m.userData.vmScaleMult ?? 1));
      const r = m.userData.restRot;
      if (r) m.rotation.set(r[0], r[1], r[2]);
      m.visible = false;
      this.rigOffset.add(m);
      this.models[id] = m;
    }

    // draw the new gun through the normal switch animation
    if (this.slot !== slotKey) this.lastSlot = this.slot === 'grenade' ? this.lastSlot : this.slot;
    this.switchTo = slotKey;
    this.switching = this.switchTotal = 0.42;
    this.meleeAnim = 0;
    this.meleeSwung = false;
    this.adsTarget = 0;
    return oldState;
  }

  startReload() {
    if (this.slot === 'grenade') return;
    const w = this.weapon;
    if (!w || w.reloading > 0 || w.full || w.reserve <= 0 || this.switching > 0) return;
    if (w.def.shellReload && w.ammo >= w.def.mag) return;
    w.reloading = w.def.shellReload ? w.def.reload : (w.ammo <= 0 ? w.def.reloadEmpty : w.def.reload);
    w.sprayIndex = 0;
    this.reloadAnim = w.reloading;
    this.reloadTotal = w.reloading;
    this.adsTarget = 0;
    this.game.audio.click('mag', 0.9);
  }

  // ------------------------------------------------------------------ update

  update(dt, time) {
    if (!this.alive) {
      this.updateDeathCam(dt);
      return;
    }
    const K = this.keys;

    // ---- look
    // this.weapon is undefined while the grenade slot is up — guard the lookup
    const wep = this.weapon;
    const zoom = (wep && this.ads > 0.5) ? (0.45 + wep.def.adsFov * 0.55) : 1;
    const sens = this.sensitivity * 0.0022 * zoom;
    this.yaw -= this.mouse.dx * sens;
    this.pitch -= this.mouse.dy * sens * (this.invertY ? -1 : 1);
    this.mouse.dx = this.mouse.dy = 0;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch));

    // ---- recoil: a short spring punch plus the learned spray offset
    this.recoilVelP += -this.recoilPitch * 46 * dt;
    this.recoilVelP *= Math.exp(-13 * dt);
    this.recoilPitch += this.recoilVelP * dt;
    this.recoilVelY += -this.recoilYaw * 40 * dt;
    this.recoilVelY *= Math.exp(-11 * dt);
    this.recoilYaw += this.recoilVelY * dt;

    // The pattern offset holds while the trigger is down and decays once the
    // player lets go — the same "recover to centre" reset CS players rely on.
    const sinceFire = time - this.lastFireTime;
    if (sinceFire > 0.22) {
      const k = Math.exp(-7 * dt);
      this.sprayTargetP *= k;
      this.sprayTargetY *= k;
      if (sinceFire > 0.35 && this.weapon) this.weapon.sprayIndex = 0;
    }
    const follow = Math.min(1, dt * 26);
    this.sprayP += (this.sprayTargetP - this.sprayP) * follow;
    this.sprayY += (this.sprayTargetY - this.sprayY) * follow;

    // ---- movement
    const wishF = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
    const wishR = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
    const crouching = !!(K.ControlLeft || K.ControlRight || K.KeyC);
    this.crouchTarget = crouching ? 1 : 0;
    // don't stand up under a ceiling
    if (!crouching && this.crouch > 0.05) {
      const r = this.game.physics.resolve(_v.copy(this.pos), this.radius * 0.9, 1.78, 0.1);
      if (r.ceiling) this.crouchTarget = 1;
    }
    this.crouch += (this.crouchTarget - this.crouch) * Math.min(1, dt * 11);

    const wpn = this.weapon;
    const moveMult = wpn ? wpn.def.moveMult : 1;
    const shift = !!(K.ShiftLeft || K.ShiftRight);
    let maxSpeed;
    if (this.cs) {
      // SHIFT is a walk modifier, not a sprint. It applies whether or not you
      // are moving forward, so you can shift-strafe an angle silently.
      this.sprinting = false;
      this.slowWalking = shift;
      maxSpeed = WALK * moveMult;
      // Crouch already is the slow, silent state, so holding the walk key on
      // top of it does nothing — stacking the two multipliers gave a 1 m/s
      // crawl that no one would ever choose over simply crouching.
      if (shift && this.crouch < 0.5) maxSpeed *= CS_WALK_MULT;
      maxSpeed *= 1 - this.crouch * (1 - CS_CROUCH_MULT);
    } else {
      const canSprint = shift && wishF > 0 && this.crouch < 0.4 && this.ads < 0.3;
      this.sprinting = canSprint && Math.hypot(this.vel.x, this.vel.z) > 1.2;
      this.slowWalking = false;
      maxSpeed = (canSprint ? SPRINT : WALK) * moveMult;
      maxSpeed *= 1 - this.crouch * (1 - CROUCH_SPEED / WALK);
    }
    if (this.ads > 0.1 && wpn) maxSpeed *= (1 - this.ads) + this.ads * wpn.def.adsMove;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (-sy * wishF) + (cy * wishR);
    const wz = (-cy * wishF) + (-sy * wishR);
    const wl = Math.hypot(wx, wz);
    const wishDir = _v.set(wl > 0 ? wx / wl : 0, 0, wl > 0 ? wz / wl : 0);

    if (this.onGround) {
      // friction
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0.01) {
        // Quake's stop-speed floor, but scaled to the speed we are actually
        // trying to hold rather than fixed at 3.2 m/s.
        //
        // Acceleration here is ACCEL * maxSpeed / WALK, so it shrinks with the
        // target speed while a constant floor does not. Below a target of about
        // 3.2 m/s the friction drop per frame exceeds everything acceleration
        // can add, velocity is zeroed every frame and immediately re-added, and
        // the result is a stutter that averages ~0.5 m/s. That silently capped
        // crouch-walking (target 2.9) at a sixth of its intended speed, and the
        // walk key would have landed in the same hole.
        //
        // Scaling the floor keeps the run case identical — at full speed
        // maxSpeed * 0.6 is 3.16, within 1% of the old constant — so
        // counter-strafing still stops on a coin.
        const stop = Math.min(3.2, maxSpeed * 0.6);
        const drop = Math.max(sp, stop) * FRICTION * dt;
        const f = Math.max(0, sp - drop) / sp;
        this.vel.x *= f; this.vel.z *= f;
      }
      if (wl > 0) {
        const cur = this.vel.x * wishDir.x + this.vel.z * wishDir.z;
        const add = Math.min(maxSpeed - cur, ACCEL * dt * maxSpeed / WALK);
        if (add > 0) { this.vel.x += wishDir.x * add; this.vel.z += wishDir.z * add; }
      }
      if (K.Space) {
        this.vel.y = JUMP_VEL;
        this.onGround = false;
        this.stepAccum = 1.6;
      }
    } else if (wl > 0) {
      // air control
      const cur = this.vel.x * wishDir.x + this.vel.z * wishDir.z;
      const add = Math.min(Math.max(0, maxSpeed * 0.9 - cur), AIR_ACCEL * dt * 4);
      if (add > 0) { this.vel.x += wishDir.x * add; this.vel.z += wishDir.z * add; }
    }

    this.vel.y -= GRAVITY * dt;
    const prevVelY = this.vel.y;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const h = 1.78 - this.crouch * 0.55;
    const res = this.game.physics.resolve(this.pos, this.radius, h, 0.55);
    const wasAir = !this.onGround;
    if (res.ground && this.vel.y <= 0.05) {
      this.pos.y = res.groundY;
      if (wasAir) {
        const impact = -prevVelY;
        this.landDipVel -= Math.min(0.16, impact * 0.011);
        if (impact > 15) {
          const dmg = Math.round((impact - 15) * 3.2);
          if (dmg > 0) this.game.damagePlayer(dmg, null, this.pos);
        }
        if (impact > 3) this.game.audio.footstep('concrete', Math.min(1, impact / 12));
      }
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    if (res.ceiling && this.vel.y > 0) this.vel.y = 0;
    if (this.pos.y < -8) this.game.damagePlayer(999, null, this.pos);

    // footsteps
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    // Silent movement is the whole point of the walk key: under the tactical
    // ruleset a slow walk or a crouch-walk makes no sound at all, which is also
    // what stops nearby bots from hearing you (see quiet, read by Bot.perceive).
    this.quiet = this.cs && (this.slowWalking || this.crouch > 0.5);
    if (this.onGround) {
      this.stepAccum += hspeed * dt;
      const strideLen = this.sprinting ? 2.35 : (this.crouch > 0.5 ? 2.0 : 1.85);
      if (this.stepAccum > strideLen) {
        this.stepAccum = 0;
        if (!this.quiet) {
          this.game.audio.footstep(res.surface || 'concrete',
            this.sprinting ? 0.85 : (this.crouch > 0.5 ? 0.25 : 0.55));
        }
      }
    }

    // ---- weapon switching
    if (this.switching > 0) {
      this.switching -= dt;
      if (this.switching <= 0.21 && this.switchTo) {
        for (const k of Object.keys(this.models)) this.models[k].visible = false;
        this.slot = this.switchTo;
        this.switchTo = null;
        this.model.visible = true;
        this.setWeaponModel(this.slot === 'grenade' ? 'grenade' : this.loadout[this.slot]);
      }
      if (this.switching < 0) this.switching = 0;
    }

    // ---- aim down sights
    // Under the tactical ruleset there is no aim-down-sights: rifles and pistols
    // fire from one stance and right-click does nothing. Only a weapon that
    // actually carries glass (def.scope) zooms. Removing ADS is what forces the
    // accuracy conversation onto footwork instead of onto a button.
    // On the knife right mouse is the heavy stab, so it must never also zoom.
    const canAds = this.slot !== 'grenade' && this.switching <= 0 &&
                   (!wpn || wpn.reloading <= 0) && !this.sprinting &&
                   !(wpn && wpn.def.melee) &&
                   (!this.cs || !!(wpn && wpn.def.scope));
    this.adsTarget = (this.mouse.right && canAds) ? 1 : 0;
    const adsSpeed = wpn ? (1 / Math.max(0.05, wpn.def.adsTime)) : 5;
    this.ads += (this.adsTarget - this.ads) * Math.min(1, dt * adsSpeed * 2.2);
    if (wpn && wpn.def.scope) {
      this.scoped += ((this.ads > 0.86 ? 1 : 0) - this.scoped) * Math.min(1, dt * 16);
    } else this.scoped += (0 - this.scoped) * Math.min(1, dt * 16);

    // ---- reload / bolt timers
    if (wpn) {
      if (wpn.reloading > 0) {
        const prev = wpn.reloading;
        wpn.reloading -= dt;
        if (wpn.def.shellReload) {
          if (wpn.reloading <= 0) {
            wpn.ammo++; wpn.reserve--;
            this.game.audio.click('shell');
            if (wpn.ammo < wpn.def.mag && wpn.reserve > 0 && !this.mouse.left) {
              wpn.reloading = wpn.def.reload;
              this.reloadAnim = wpn.reloading;
              this.reloadTotal = wpn.reloading;
            }
          }
        } else {
          if (prev > this.reloadTotal * 0.55 && wpn.reloading <= this.reloadTotal * 0.55) this.game.audio.click('mag', 0.7);
          if (wpn.reloading <= 0) {
            const need = wpn.def.mag - wpn.ammo;
            const take = Math.min(need, wpn.reserve);
            wpn.ammo += take; wpn.reserve -= take;
            this.game.audio.click('bolt', 0.8);
          }
        }
      }
      if (wpn.bolt > 0) wpn.bolt -= dt;
      // auto-reload: an empty magazine reloads itself once the action is done cycling
      if (!wpn.def.melee && wpn.ammo <= 0 && wpn.reloading <= 0 && wpn.bolt <= 0 &&
          wpn.reserve > 0 && this.switching <= 0) {
        this.startReload();
      }
    }
    this.reloadAnim = Math.max(0, this.reloadAnim - dt);

    // ---- firing
    this.updateFiring(dt, time);

    // ---- spread recovery
    // Accuracy is dominated by stance, as in CS: planted and crouched is by far
    // the most accurate, running is poor, and firing mid-air is nearly useless.
    // The knife has no cone at all, so it is excluded here rather than being
    // given placeholder spread numbers — reading def.spreadHip off a melee
    // weapon yields undefined and poisons currentSpread with NaN, which the
    // crosshair then renders as a collapsed reticle.
    const gun = (wpn && !wpn.def.melee) ? wpn : null;
    let base;
    if (this.cs && gun) {
      // With no aim-down-sights button, standing still IS the weapon's best
      // number, so spreadAds becomes the planted figure and spreadHip the
      // running one. The ramp between them is convex: a slow walk costs you
      // little, a full run costs almost everything.
      //
      // Calibrated against Counter-Strike's real cones, measured as the radius
      // of the shot group on a target 20 m away — an M4 lands ~9 cm planted
      // (0.3 degrees, matching CS), ~40 cm walking, ~160 cm running. That last
      // figure is the load-bearing one: it is wider than a torso, so running
      // fire is a gamble rather than a slightly worse option.
      const still = gun.def.spreadAds;
      const run = gun.def.spreadHip * 2.6;
      const k = Math.pow(Math.min(1, hspeed / WALK), 1.6);
      base = still + (run - still) * k;
      if (!this.onGround) base = run * 2.4;
      else if (this.crouch > 0.6) base *= 0.7;
      // A scoped rifle fired from the hip is not a rifle. Without this the AWM-S
      // inherits its scoped 0.01-degree cone while unscoped and becomes the best
      // no-scope weapon in the game, which is the opposite of the intent.
      if (gun.def.scope) base += gun.def.spreadHip * 1.2 * (1 - this.ads);
    } else {
      base = gun ? (gun.def.spreadHip * (1 - this.ads) + gun.def.spreadAds * this.ads) : 0.02;
      const moveFrac = Math.min(1, hspeed / SPRINT);
      let stance = 1 + moveFrac * moveFrac * 3.2 * (1 - this.ads * 0.45);
      if (!this.onGround) stance *= 4.5;
      else if (this.crouch > 0.6) stance *= 0.62;
      base *= stance;
    }
    this.spread = Math.max(0, this.spread - (gun ? gun.def.spreadDecay : 0.1) * dt * 2.4);
    // The ceiling has to clear the movement penalty itself, or the jump case
    // gets silently clipped back down to roughly the running case and firing
    // mid-air stops being a mistake.
    const cap = gun ? gun.def.spreadMax * (this.cs ? 5 : 2) : 0.2;
    this.currentSpread = Math.min(cap, base + this.spread);

    // ---- health regen after a lull
    if (time - this.lastDamageTime > 5.5 && this.health < 100) {
      this.health = Math.min(100, this.health + 12 * dt);
    }

    this.updateCamera(dt, time, hspeed);
    this.updateViewModel(dt, time, hspeed);

    // hit direction indicators fade
    for (let i = this.hitDirs.length - 1; i >= 0; i--) {
      this.hitDirs[i].life -= dt;
      if (this.hitDirs[i].life <= 0) this.hitDirs.splice(i, 1);
    }
  }

  /** The slot to fall back to when the current weapon runs completely dry. */
  bestFallbackSlot() {
    for (const s of ['primary', 'secondary']) {
      if (s === this.slot) continue;
      const w = this.weapons[s];
      if (w && !w.def.melee && (w.ammo > 0 || w.reserve > 0)) return s;
    }
    return 'knife';
  }

  /**
   * Knife swings. Left mouse is the fast light slash, right mouse the slow
   * heavy stab — the Counter-Strike split, where the heavy is a coin-flip you
   * take because it kills outright from behind.
   *
   * Damage lands partway through the animation (at `windup`) rather than on the
   * key press, so the hit registers when the blade is actually out in front of
   * the camera. Swinging early and walking into someone should not connect.
   */
  updateMelee(dt, time) {
    const def = this.weapon.def;

    // an in-flight swing runs to completion; the damage tick fires once
    if (this.meleeAnim > 0) {
      const prev = this.meleeAnim;
      this.meleeAnim -= dt;
      const swing = this.meleeHeavy ? def.heavy : def.light;
      const hitAt = this.meleeTotal - swing.windup;
      if (!this.meleeSwung && prev > hitAt && this.meleeAnim <= hitAt) {
        this.meleeSwung = true;
        const origin = _v.copy(this.camera.position);
        const dir = _v2.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize().clone();
        this.shotsFired++;
        this.game.melee(this, origin, dir, def, swing);
      }
      if (this.meleeAnim <= 0) { this.meleeAnim = 0; this.meleeSwung = false; }
      return;
    }

    if (this.switching > 0) return;
    // left = light, right = heavy; left wins if somehow both are down
    const heavy = !this.mouse.left && this.mouse.right;
    if (!this.mouse.left && !this.mouse.right) { this.semiLatch = false; return; }
    if (this.semiLatch) return;          // one swing per click, no auto-repeat
    this.semiLatch = true;

    this.meleeHeavy = heavy;
    this.meleeTotal = this.meleeAnim = (heavy ? def.heavy : def.light).rate;
    this.meleeSwung = false;
    this.lastFireTime = time;
    this.game.audio.swing(heavy);
    this.shake(heavy ? 0.010 : 0.005, 0.07);
  }

  updateFiring(dt, time) {
    const wpn = this.weapon;
    if (this.slot === 'grenade') {
      if (this.mouse.left && !this.fireHeld && this.grenades > 0 && this.switching <= 0) {
        this.fireHeld = true;
        this.throwGrenade();
      }
      if (!this.mouse.left) this.fireHeld = false;
      return;
    }
    if (!wpn) return;
    if (wpn.def.melee) { this.updateMelee(dt, time); return; }
    const def = wpn.def;
    const interval = 60 / def.rpm;

    if (!this.mouse.left) { this.fireHeld = false; this.semiLatch = false; }
    const wantFire = this.mouse.left && (def.auto || !this.semiLatch);
    if (!wantFire) return;
    if (this.switching > 0 || wpn.reloading > 0 || this.sprinting) return;
    if (time - wpn.lastShot < interval) return;
    if (wpn.bolt > 0) return;

    if (wpn.ammo <= 0) {
      if (!this.semiLatch) { this.game.audio.click('dry'); this.semiLatch = true; }
      if (wpn.reserve > 0) this.startReload();
      // Truly dry — no rounds in the gun and none left to load. Fall back to
      // whatever can still hurt someone rather than leaving the player clicking
      // on an empty chamber: the other gun if it has ammo, otherwise the knife.
      else this.switchSlot(this.bestFallbackSlot());
      return;
    }

    this.semiLatch = true;
    this.fireHeld = true;
    wpn.lastShot = time;
    wpn.ammo--;
    this.lastFireTime = time;
    if (def.boltTime) wpn.bolt = def.boltTime;

    // camera recoil: walk the deterministic pattern, plus a small spring punch
    const adsFactor = 1 - this.ads * 0.32;
    const cs = this.crouch > 0.6 ? 0.82 : 1;
    const pat = def.spray[Math.min(wpn.sprayIndex, def.spray.length - 1)];
    wpn.sprayIndex++;
    const scaleP = def.recoilV * def.recoilRise * adsFactor * cs;
    const scaleY = def.recoilH * adsFactor * cs;
    this.sprayTargetP = pat[1] * scaleP;
    this.sprayTargetY = pat[0] * scaleY * 2.2;
    // a touch of randomness so it is not literally identical every magazine
    this.sprayTargetP += (Math.random() - 0.5) * scaleP * 0.22;
    this.sprayTargetY += (Math.random() - 0.5) * scaleY * 0.5;
    this.recoilVelP += scaleP * 22;
    this.recoilVelY += (Math.random() - 0.5) * scaleY * 30;
    this.viewKickVel -= def.kickBack * 42;
    this.spread = Math.min(def.spreadMax, this.spread + def.bloom * (1 + this.ads * -0.35));
    this.shake(def.kickBack * 1.6, 0.09);

    // the shot itself
    const origin = _v.copy(this.camera.position);
    const dir = _v2.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    this.shotsFired += def.pellets;
    this.game.fireWeapon(this, origin, dir, def, this.currentSpread, false);

    // muzzle flash: drawn in the weapon scene, but it also lights the world
    const mv = new THREE.Vector3();
    this.model.userData.muzzle.getWorldPosition(mv);   // already view space
    this.game.viewMuzzleFlash(mv, def.muzzleFlash);
    const worldMuzzle = mv.clone().applyQuaternion(this.camera.quaternion).add(this.camera.position);
    this.game.effects.light(worldMuzzle.x, worldMuzzle.y, worldMuzzle.z, 0xffc070, 7 * def.muzzleFlash, 0.06, 15);
    // Muzzle smoke is pushed well down range and kept small: spawned at the
    // muzzle it sits ~1 m from the lens, where a handful of puffs render as a
    // screen-filling wall of grey.
    if (Math.random() < 0.5) {
      this.game.effects.puff(
        worldMuzzle.x + dir.x * 2.2, worldMuzzle.y + dir.y * 2.2, worldMuzzle.z + dir.z * 2.2,
        dir.x * 1.6, dir.y * 1.6 + 0.4, dir.z * 1.6,
        0.42, 0.40, 0.36, 0.16 * def.muzzleFlash, 0.35, 1.2, 0.07);
    }
    this.game.audio.shoot(def, null, 1);

    // eject a casing into the world so it bounces off the real floor
    const ejv = new THREE.Vector3();
    this.model.userData.ejector.getWorldPosition(ejv);
    const ej = ejv.applyQuaternion(this.camera.quaternion).add(this.camera.position);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.game.effects.shell(ej, right, new THREE.Vector3(0, 1, 0), def.shellSize);
  }

  throwGrenade() {
    this.grenades--;
    const origin = _v.copy(this.camera.position);
    const dir = _v2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    dir.y += 0.14;
    dir.normalize().multiplyScalar(22);
    dir.x += this.vel.x * 0.5; dir.z += this.vel.z * 0.5;
    this.game.spawnGrenade(this, origin, dir);
    this.game.audio.click('pin');
    this.viewKickVel -= 0.5;
    if (this.grenades <= 0) setTimeout(() => this.switchSlot('primary'), 380);
  }

  shake(mag, time) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeTime = Math.max(this.shakeTime, time);
  }

  addHitDir(fromPos) {
    const dx = fromPos.x - this.pos.x, dz = fromPos.z - this.pos.z;
    const ang = Math.atan2(dx, dz) - this.yaw;
    this.hitDirs.push({ angle: ang, life: 1.4 });
  }

  updateCamera(dt, time, hspeed) {
    const cam = this.camera;
    // bob
    const target = this.onGround ? Math.min(1, hspeed / WALK) : 0;
    this.bobAmount += (target - this.bobAmount) * Math.min(1, dt * 7);
    this.bobPhase += dt * (this.sprinting ? 13.5 : 9.6) * Math.max(0.2, this.bobAmount);
    const bobScale = this.bobAmount * (1 - this.ads * 0.75) * (this.sprinting ? 1.35 : 1);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.042 * bobScale;
    const bobX = Math.sin(this.bobPhase * 0.5) * 0.030 * bobScale;
    const bobRoll = Math.sin(this.bobPhase * 0.5) * 0.010 * bobScale;

    // landing dip spring
    this.landDipVel += -this.landDip * 130 * dt;
    this.landDipVel *= Math.exp(-11 * dt);
    this.landDip += this.landDipVel * dt;

    // strafe lean
    const strafe = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    this.lean = (this.lean ?? 0) + (strafe * -0.020 * (1 - this.ads * 0.7) - (this.lean ?? 0)) * Math.min(1, dt * 7);

    // shake
    let shx = 0, shy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime) * 12;
      shx = (Math.random() - 0.5) * this.shakeMag * k;
      shy = (Math.random() - 0.5) * this.shakeMag * k;
      if (this.shakeTime <= 0) this.shakeMag = 0;
    }

    const eye = 1.62 - this.crouch * 0.50;
    cam.position.set(this.pos.x + bobX * 0.4, this.pos.y + eye + bobY + this.landDip, this.pos.z);
    _e.set(this.pitch + this.recoilPitch + this.sprayP + shy,
           this.yaw + this.recoilYaw + this.sprayY + shx,
           bobRoll + this.lean);
    cam.quaternion.setFromEuler(_e);

    // fov: sprint punch + ads zoom
    const wpn = this.weapon;
    const adsFov = wpn && this.slot !== 'grenade'
      ? (wpn.def.scope && this.scoped > 0.5 ? wpn.def.scopeFov : wpn.def.adsFov) : 1;
    const sprintFov = (this.sprinting && !this.cs) ? 1.055 : 1;
    const wantFov = this.baseFov * (1 - this.ads) * sprintFov + this.baseFov * adsFov * this.ads;
    cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 12);
    cam.updateProjectionMatrix();
  }

  updateViewModel(dt, time, hspeed) {
    const rig = this.rigOffset;
    const wpn = this.weapon;
    const def = wpn ? wpn.def : null;

    // mouse sway (lags the look direction)
    const swayTargetX = THREE.MathUtils.clamp(-this.lastLookDx * 0.9, -1, 1);
    const swayTargetY = THREE.MathUtils.clamp(-this.lastLookDy * 0.9, -1, 1);
    this.swayVel.x += (swayTargetX - this.sway.x) * 60 * dt;
    this.swayVel.y += (swayTargetY - this.sway.y) * 60 * dt;
    this.swayVel.multiplyScalar(Math.exp(-9 * dt));
    this.sway.x += this.swayVel.x * dt;
    this.sway.y += this.swayVel.y * dt;
    this.lastLookDx *= Math.exp(-14 * dt);
    this.lastLookDy *= Math.exp(-14 * dt);

    // kick spring (weapon pushed back into the shoulder)
    this.viewKickVel += -this.viewKick * 220 * dt;
    this.viewKickVel *= Math.exp(-14 * dt);
    this.viewKick += this.viewKickVel * dt;

    const ads = this.ads;
    // Counter-Strike sits the weapon low and well off to the right, clear of
    // the centre of the screen — the crosshair, not the gun, is what you read.
    // The arcade rig keeps the old higher, more centred carry.
    const hipX = this.cs ? 0.196 : 0.158;
    const hipY = this.cs ? -0.132 : -0.100;
    const hipZ = this.cs ? -0.425 : -0.50;
    const sightY = (this.model?.userData?.sightY ?? 0.08) * (this.vmScale ?? VM_SCALE);
    const adsX = 0, adsY = -sightY, adsZ = -0.44;

    let px = hipX * (1 - ads) + adsX * ads;
    let py = hipY * (1 - ads) + adsY * ads;
    let pz = hipZ * (1 - ads) + adsZ * ads;

    // bob / sway / breathing
    const bob = Math.min(1, hspeed / WALK) * (1 - ads * 0.85);
    px += Math.sin(this.bobPhase * 0.5) * 0.028 * bob + this.sway.x * 0.034 * (1 - ads * 0.6);
    py += Math.abs(Math.sin(this.bobPhase)) * 0.020 * bob + this.sway.y * 0.032 * (1 - ads * 0.6);
    py += Math.sin(time * 1.6) * 0.0032 * (1 - ads * 0.5);
    pz += this.viewKick;

    let rx = -this.sway.y * 0.10 * (1 - ads * 0.7) + this.viewKick * 1.1;
    let ry = -this.sway.x * 0.14 * (1 - ads * 0.7);
    let rz = this.sway.x * 0.10 * (1 - ads * 0.8) + Math.sin(this.bobPhase * 0.5) * 0.022 * bob;

    // sprint pose: tuck the weapon down and across
    const sprintK = this.sprinting ? 1 : 0;
    this.sprintPose = (this.sprintPose ?? 0) + (sprintK - (this.sprintPose ?? 0)) * Math.min(1, dt * 9);
    px += this.sprintPose * 0.06;
    py -= this.sprintPose * 0.075;
    pz += this.sprintPose * 0.05;
    rx += this.sprintPose * 0.30;
    ry += this.sprintPose * 0.62;
    rz -= this.sprintPose * 0.42;

    // weapon swap: dip out of frame and back. Keyed off the swap's own
    // duration — the knife draws faster than a rifle, and a hardcoded half-way
    // point left it hanging below frame for the back half of its draw.
    if (this.switching > 0) {
      const half = Math.max(0.001, (this.switchTotal ?? 0.42) / 2);
      const k = 1 - Math.abs(this.switching - half) / half;
      py -= k * 0.34;
      rx += k * 0.9;
    }

    // knife swing: wind up across the body, then cut through and recover
    if (this.meleeAnim > 0 && this.meleeTotal > 0) {
      const t = 1 - this.meleeAnim / this.meleeTotal;      // 0..1 through the swing
      const heavy = this.meleeHeavy;
      // wind-up is the first 35%, the cut is fast, then it settles back
      const windup = Math.min(1, t / 0.35);
      const cut = t < 0.35 ? 0 : Math.sin(Math.min(1, (t - 0.35) / 0.4) * Math.PI);
      if (heavy) {
        // straight thrust down the barrel of the view
        pz -= windup * 0.06 - cut * 0.30;
        py += windup * 0.05 - cut * 0.05;
        rx += windup * 0.45 - cut * 0.55;
      } else {
        // diagonal slash from high-right to low-left
        px += windup * 0.10 - cut * 0.26;
        py += windup * 0.07 - cut * 0.16;
        rz -= windup * 0.55 - cut * 1.25;
        ry += windup * 0.30 - cut * 0.60;
      }
    }

    // reload animation
    if (wpn && wpn.reloading > 0 && this.reloadTotal > 0) {
      const t = 1 - wpn.reloading / this.reloadTotal;
      if (def.shellReload) {
        const s = Math.sin(t * Math.PI);
        py -= s * 0.08; rx += s * 0.35; rz += s * 0.30;
      } else {
        const s = Math.sin(Math.min(1, t * 1.15) * Math.PI);
        py -= s * 0.16;
        rx += s * 0.62;
        rz += s * 0.34;
        ry += Math.sin(t * Math.PI * 2) * 0.16;
        px += s * 0.04;
      }
    }
    // bolt cycle for the sniper
    if (wpn && wpn.bolt > 0 && def.boltTime) {
      const t = 1 - wpn.bolt / def.boltTime;
      const s = Math.sin(t * Math.PI);
      rz += s * 0.13; py -= s * 0.03; pz += s * 0.05;
    }

    rig.position.set(px, py, pz);
    rig.rotation.set(rx, ry, rz);

    this.animateWeaponParts(dt, time, wpn, def);
    // hide the model entirely when fully scoped
    const scopedOut = this.scoped > 0.82;
    if (this.model) this.model.visible = !scopedOut;
  }

  /**
   * Drive the weapon's moving parts: the bolt/slide snaps back on each shot and
   * returns, the magazine drops out and is replaced mid-reload, and the shotgun
   * fore-end racks between shells.
   */
  animateWeaponParts(dt, time, wpn, def) {
    const m = this.model;
    if (!m) return;
    const ud = m.userData;

    // ---- bolt / slide
    if (ud.bolt) {
      const throwLen = ud.boltThrow || 0;
      let z = 0;
      if (throwLen) {
        const since = time - this.lastFireTime;
        const cycle = def ? Math.min(0.085, 30 / def.rpm) : 0.06;
        if (since >= 0 && since < cycle) {
          // out fast, back a little slower
          const t = since / cycle;
          z = throwLen * (t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6);
        }
        // held open on an empty magazine
        if (wpn && wpn.ammo <= 0 && wpn.reloading <= 0 && !def?.shellReload) z = throwLen;
        // bolt-action rifles cycle over their whole bolt time
        if (def && def.boltTime && wpn && wpn.bolt > 0) {
          const t = 1 - wpn.bolt / def.boltTime;
          z = throwLen * Math.sin(Math.min(1, t * 1.2) * Math.PI);
        }
      }
      ud.bolt.position.z = z;
    }

    // ---- magazine
    if (ud.mag) {
      let drop = 0, tilt = 0;
      if (wpn && wpn.reloading > 0 && this.reloadTotal > 0 && !def?.shellReload) {
        const t = 1 - wpn.reloading / this.reloadTotal;
        if (t < 0.35) drop = t / 0.35;                       // falls away
        else if (t < 0.6) drop = 1;                          // hand is off-screen
        else drop = 1 - (t - 0.6) / 0.4;                     // new one goes in
        tilt = drop * 0.28;
      }
      ud.mag.position.y = ud.magY ?? (ud.magY = ud.mag.position.y);
      ud.mag.position.y -= drop * 0.22;
      ud.mag.rotation.x = tilt;
    }

    // ---- shotgun pump
    if (ud.pumpThrow && ud.bolt) {
      const since = time - this.lastFireTime;
      const cyc = 0.42;
      let z = 0;
      if (since >= 0.06 && since < cyc) {
        const t = (since - 0.06) / (cyc - 0.06);
        z = ud.pumpThrow * Math.sin(t * Math.PI);
      }
      ud.bolt.position.z = z;
    }
  }

  updateDeathCam(dt) {
    // slump the camera to the ground and look up at the sky
    this.deathCamT = Math.min(1, (this.deathCamT ?? 0) + dt * 1.6);
    const t = this.deathCamT;
    const e = 1 - Math.pow(1 - t, 3);
    this.camera.position.set(this.pos.x, this.pos.y + 1.62 - e * 1.25, this.pos.z);
    _e.set(this.pitch * (1 - e) + e * -0.55, this.yaw + e * 0.35, e * 0.75);
    this.camera.quaternion.setFromEuler(_e);
    this.camera.fov += (this.baseFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
  }

  onMouseMove(dx, dy) {
    this.mouse.dx += dx;
    this.mouse.dy += dy;
    this.lastLookDx = (this.lastLookDx ?? 0) + dx * 0.010;
    this.lastLookDy = (this.lastLookDy ?? 0) + dy * 0.010;
  }
}
