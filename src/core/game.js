// Match orchestration: world setup, combat resolution, scoring and the frame loop.
import * as THREE from 'three';
import { PhysicsWorld } from './collision.js';
import { NavGrid } from './nav.js';
import { MAPS, DEFAULT_MAP } from '../world/maps/index.js';
import { Player } from '../entities/player.js';
import { Bot, DIFFICULTIES, botName, resetNames } from '../entities/bot.js';
import { TEAM } from '../entities/character.js';
import { Effects, softDot } from '../fx/effects.js';
import { Pipeline } from '../fx/pipeline.js';
import { AudioEngine } from '../fx/audio.js';
import { HUD } from '../ui/hud.js';
import { WEAPONS, buildViewModel } from '../entities/weapons.js';
import { flat } from '../world/textures.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const GRENADE_GEO = new THREE.SphereGeometry(0.075, 10, 8);

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    // near is deliberately not tiny: depth precision scales with far/near, and
    // the first-person weapon lives in its own scene with its own near plane, so
    // the world camera never has to resolve anything closer than 20 cm.
    this.camera = new THREE.PerspectiveCamera(90, 1, 0.2, 700);
    this.scene.add(this.camera);

    // The first-person weapon lives in its own scene with a narrow FOV so it
    // never fisheyes when the world FOV is cranked up, and never clips a wall.
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(52, 1, 0.008, 12);
    this.vmScene.add(this.vmCamera);
    this.vmKey = new THREE.DirectionalLight(0xfff0d8, 2.7);
    this.vmScene.add(this.vmKey);
    this.vmFill = new THREE.HemisphereLight(0xa9c6e8, 0x6b5a42, 1.9);
    this.vmScene.add(this.vmFill);
    // A camera-side key so the weapon never silhouettes into a black slab when
    // the player faces into the sun. Standard practice: view models get their
    // own lighting rig rather than inheriting the world's.
    this.vmRim = new THREE.DirectionalLight(0xcfe0ff, 1.35);
    this.vmRim.position.set(0.55, 0.45, 1.0);
    this.vmScene.add(this.vmRim);
    this.vmRim2 = new THREE.DirectionalLight(0xffe3bd, 0.7);
    this.vmRim2.position.set(-0.8, 0.15, 0.5);
    this.vmScene.add(this.vmRim2);
    this.vmMuzzleLight = new THREE.PointLight(0xffc070, 0, 3.5, 2);
    this.vmScene.add(this.vmMuzzleLight);
    const flashTex = softDot(64, 0.05);
    this.vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, color: 0xffd694, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false,
    }));
    this.vmFlashStar = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: flashTex, color: 0xfff0c0, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
    );
    this.vmFlashStar.visible = false;
    this.vmFlashStar.renderOrder = 31;
    this.vmScene.add(this.vmFlashStar);
    this.vmFlash.visible = false;
    this.vmFlash.renderOrder = 30;
    this.vmScene.add(this.vmFlash);
    this.vmFlashLife = 0;

    this.audio = new AudioEngine();
    this.hud = new HUD(this);

    this.characters = [];
    this.bots = [];
    this.grenades = [];
    this.drops = [];
    this.score = { blue: 0, red: 0 };
    this.scoreLimit = 50;
    this.timeLeft = 900;
    this.respawnIn = 0;
    this.running = false;
    this.paused = false;
    this.over = false;
    this.time = 0;
    this.lastCombat = null;
    this.hotspots = [];
    this.mapId = null;
    this.worldObjects = [];
    this.settings = {
      map: DEFAULT_MAP, difficulty: 2, enemies: 5, allies: 4, scoreLimit: 120,
      primary: 'm4a1', secondary: 'g18', quality: 2, fov: 90, sens: 100, invert: 0,
      csRules: 1,
    };

    this._fpsAcc = 0; this._fpsFrames = 0; this._fps = 0;
    addEventListener('resize', () => this.resize());
  }

  // ---------------------------------------------------------------- setup

  async load(onProgress = () => {}) {
    this.physics = new PhysicsWorld();
    await this.buildWorld(this.settings.map, onProgress);

    onProgress('SPAWNING EFFECTS…');
    await frame();
    this.effects = new Effects(this.scene, this.camera, this.settings.quality);

    onProgress('DEPLOYING SQUADS…');
    await frame();
    this.player = new Player(this.scene, this.camera, this, 'blue');
    this.player.setLoadout(this.settings.primary, this.settings.secondary);

    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.vmScene, this.vmCamera);
    this.resize();
    this.loaded = true;
  }

  /**
   * Build (or rebuild) the level: geometry, colliders and navmesh.
   *
   * Everything the previous map put in the scene is tracked so a map change can
   * take it back out — merged level geometry is unique per map and must be
   * disposed, while materials come from the shared texture cache and must not.
   */
  async buildWorld(mapId, onProgress = () => {}) {
    const entry = MAPS[mapId] || MAPS[DEFAULT_MAP];
    // Stop simulating while the world is swapped. buildWorld awaits the navmesh
    // bake, and the frame loop keeps running across those awaits — bots would
    // path against a half-built graph and against colliders that no longer exist.
    const wasRunning = this.running;
    this.running = false;
    const T = this.loadTimings = {};
    const mark = (k, t0) => { T[k] = Math.round(performance.now() - t0); };

    // ---- tear the old one down
    for (const o of this.worldObjects) {
      this.scene.remove(o);
      if (o.isMesh && o.geometry) o.geometry.dispose();
    }
    this.worldObjects.length = 0;
    this.physics = new PhysicsWorld();

    let t0 = performance.now();
    onProgress(`BUILDING ${entry.name}…`);
    await frame();
    const world = entry.build(this.scene, this.physics);
    mark('map', t0);

    this.sun = world.sun;
    this.sky = world.sky;
    this.sunDir = world.sunDir;
    this.mapId = entry.id;
    this.mapInfo = entry.info;
    this.hotspots = entry.info.hotspots;
    // everything the level added, so the next map can clear it
    this.worldObjects = [...world.meshes, world.sky, world.sun, world.sun.target, world.hemi];
    for (const c of this.scene.children) {
      if (c.isLight && c !== world.sun && c !== world.hemi && !this.worldObjects.includes(c)) {
        if (!this.effects || !this.effects.lights.some(l => l.light === c)) this.worldObjects.push(c);
      }
    }

    const nav = entry.info.nav || {};
    this.nav = new NavGrid(this.physics, {
      cell: nav.cell ?? 1.0,
      minX: nav.minX ?? entry.info.bounds.minX, maxX: nav.maxX ?? entry.info.bounds.maxX,
      minZ: nav.minZ ?? entry.info.bounds.minZ, maxZ: nav.maxZ ?? entry.info.bounds.maxZ,
      agentHeight: 1.75, stepHeight: 0.62,
    });
    this.nav.stairRuns = world.stairRuns;
    const navT0 = performance.now();
    await this.nav.build(onProgress);
    this.navBuildMs = Math.round(performance.now() - navT0);
    mark('nav', navT0);

    this.buildEnvironment(world.sky);

    this.hud.buildMinimapStatic(this);
    T.total = Object.values(T).reduce((a, b) => a + b, 0);
    // characters from the previous map hold stale positions; startMatch will
    // respawn them, so only resume if we were mid-match (a quality change, say)
    if (wasRunning) {
      for (const c of this.characters) if (c.alive) this.respawnCharacter(c);
      this.running = true;
    }
  }

  /**
   * Pre-filter the sky into an environment map.
   *
   * Without one, every metallic surface renders black: a metal has no diffuse
   * term, so with nothing to reflect there is nothing to see. Indoors, where
   * only point lights reach, barrels and machinery were solid black boxes.
   */
  buildEnvironment(sky) {
    if (!sky) return;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const tmp = new THREE.Scene();
    const parent = sky.parent;
    tmp.add(sky);                       // borrow it for one render
    const rt = pmrem.fromScene(tmp, 0.04, 1, 1200);
    if (parent) parent.add(sky);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.9;
    this.vmScene.environment = rt.texture;
    this.vmScene.environmentIntensity = 0.75;
    // materials compiled before the environment existed need a recompile to
    // pick up the envMap branch in their shader
    for (const root of [this.scene, this.vmScene]) {
      root.traverse(o => {
        const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of ms) if (m.isMeshStandardMaterial) m.needsUpdate = true;
      });
    }
    pmrem.dispose();
  }

  applyQuality(q) {
    this.settings.quality = q;
    const r = this.renderer;
    r.shadowMap.enabled = q >= 1;
    // With post-processing on, the pixel ratio multiplies through every render
    // target in the chain (composer x2, GTAO, the bloom mip chain, SMAA). At
    // 1.5x on a large display that is hundreds of megabytes of half-float
    // buffers, so it is capped at native resolution except on ULTRA.
    r.setPixelRatio(q >= 3 ? Math.min(devicePixelRatio, 1.5) : 1);
    if (this.pipeline) { this.pipeline.applyQuality(q); this.pipeline.setSize(innerWidth, innerHeight); }
    if (this.sun) {
      const size = q >= 3 ? 4096 : q >= 2 ? 2048 : 1024;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
    }
    // NB: don't latch castShadow off here — it can never be restored when the
    // player raises the quality again. The shadow map toggle above is enough.
  }

  startMatch(settings) {
    Object.assign(this.settings, settings);
    this.applyQuality(this.settings.quality);

    // Tear the previous match down properly. Dropping the arrays alone leaves
    // bot rigs and in-flight grenade meshes attached to the scene.
    for (const b of this.bots) b.dispose(this.scene);
    this.bots.length = 0;
    this.characters.length = 0;
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades.length = 0;
    for (const d of this.drops) this.scene.remove(d.mesh);
    this.drops.length = 0;
    resetNames();

    this.score.blue = 0;
    this.score.red = 0;
    this.scoreLimit = this.settings.scoreLimit;
    this.timeLeft = 900;
    this.over = false;
    this.respawnIn = 0;
    this.lastKiller = null;
    this.time = 0;

    this.player.team = 'blue';
    this.player.kills = 0; this.player.deaths = 0;
    this.player.shotsFired = 0; this.player.shotsHit = 0;
    this.player.baseFov = this.settings.fov;
    this.player.sensitivity = this.settings.sens / 100;
    this.player.invertY = !!this.settings.invert;
    this.player.cs = !!this.settings.csRules;
    this.player.setLoadout(this.settings.primary, this.settings.secondary);
    this.characters.push(this.player);

    const d = this.settings.difficulty;
    for (let i = 0; i < this.settings.enemies; i++) {
      const b = new Bot(this.scene, 'red', botName(), d, this);
      this.bots.push(b); this.characters.push(b);
    }
    // allies are a notch below the enemy skill so the player still carries
    const allyDiff = Math.max(0, Math.min(4, d - (d >= 3 ? 1 : 0)));
    for (let i = 0; i < this.settings.allies; i++) {
      const b = new Bot(this.scene, 'blue', botName(), allyDiff, this);
      this.bots.push(b); this.characters.push(b);
    }

    for (const c of this.characters) this.respawnCharacter(c, true);
    this.hud.buildInventory(this.player);
    this.hud.show();
    this.hud.centerMessage(MAPS[this.mapId].name, 'TEAM DEATHMATCH · ELIMINATE VIPER CELL', 3.2);
    this.running = true;
    this.paused = false;
    this.audio.init();
    this.audio.ui('deploy');
  }

  // ---------------------------------------------------------------- spawning

  spawnPoint(team) {
    const pts = this.mapInfo.spawns[team];
    let best = null, bestScore = -Infinity;
    for (const [x, z] of pts) {
      // Snap onto the navmesh so nobody spawns on a roof or inside terrain.
      // NB: no absolute height cut-off — that is only valid on flat maps, and on
      // a heightfield it rejects every legitimate spawn on high ground.
      const n = this.nav.nodeAt(x, 0, z, 5);
      if (n < 0) continue;
      const y = this.nav.ny[n];
      let score = Math.random() * 6;
      for (const c of this.characters) {
        if (!c.alive) continue;
        const d = Math.hypot(c.pos.x - x, c.pos.z - z);
        if (c.team === team) score += Math.min(8, d * 0.05);
        else score += Math.min(40, d) * 1.4;      // stay away from enemies
      }
      // prefer low, open ground for a spawn over a rooftop that happens to be near
      score -= Math.max(0, y - 2) * 3;
      if (score > bestScore) { bestScore = score; best = [this.nav.nx[n], y, this.nav.nz[n]]; }
    }
    if (!best) {
      // fall back to any reachable navmesh node, never a hardcoded position:
      // (0, 1, 0) is underground on a terrain map
      const n = (Math.random() * this.nav.nx.length) | 0;
      best = [this.nav.nx[n], this.nav.ny[n], this.nav.nz[n]];
    }
    return best;
  }

  respawnCharacter(c, initial = false) {
    const [x, y, z] = this.spawnPoint(c.team);
    const yaw = Math.atan2(-(0 - x), -(0 - z)) + (Math.random() - 0.5) * 0.6;
    if (c.isPlayer) {
      c.respawn(x, y + 0.05, z, yaw);
      c.deathCamT = 0;
      this.hud.damageFlash(0);
    } else {
      c.respawn(x, y + 0.05, z, yaw);
    }
  }

  // ---------------------------------------------------------------- combat

  /**
   * Resolve a shot. Handles pellets, spread, hit zones, damage and all the
   * visual/audio feedback for both the player and the bots.
   */
  fireWeapon(shooter, origin, dir, def, spread, isBot) {
    const from = _v.copy(origin);
    for (let p = 0; p < def.pellets; p++) {
      const d = _v2.copy(dir);
      if (spread > 0) {
        // uniform disc in the spread cone
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * spread;
        const up = Math.abs(d.y) > 0.9 ? _v3.set(1, 0, 0) : _v3.set(0, 1, 0);
        const right = _v4.crossVectors(d, up).normalize();
        d.addScaledVector(right, Math.cos(a) * r);
        d.addScaledVector(up.crossVectors(right, d).normalize(), Math.sin(a) * r);
        d.normalize();
      }
      this.traceBullet(shooter, from, d, def, isBot);
    }
    this.lastCombat = new THREE.Vector3(shooter.pos.x, shooter.pos.y, shooter.pos.z);
    if (isBot) {
      shooter.muzzleWorld(_v3);
      this.effects.muzzleFlash(_v3, dir, def.muzzleFlash * 0.9);
      const dist = _v3.distanceTo(this.camera.position);
      this.audio.shoot(def, _v3.clone(), Math.max(0.25, 1 - dist / 200));
      const right = _v4.set(Math.cos(shooter.yaw), 0, -Math.sin(shooter.yaw));
      this.effects.shell(_v3, right, new THREE.Vector3(0, 1, 0), def.shellSize);
    }
  }

  /**
   * Resolve one knife swing. Melee deliberately does not go through
   * fireWeapon(): there is no tracer, no casing, no muzzle flash and no
   * falloff, and the hit test has to be forgiving in a way a bullet must not be.
   *
   * A single ray from the crosshair would demand pixel-accurate aim at a range
   * where the target fills the screen, so this sweeps a small cone — the cheap
   * approximation of the hull trace a real melee attack uses.
   *
   * @param swing one of def.light / def.heavy
   * @returns {boolean} whether anything was hit (the caller picks the sound)
   */
  melee(attacker, origin, dir, def, swing) {
    const range = swing.range;
    const wall = this.physics.raycast(origin, dir, range);
    const maxDist = wall ? wall.dist : range;

    // centre ray first, then a ring of four at ~7 degrees; nearest wins
    let best = null, bestDist = maxDist, victim = null;
    const up = Math.abs(dir.y) > 0.9 ? _v3.set(1, 0, 0) : _v3.set(0, 1, 0);
    const right = _v4.crossVectors(dir, up).normalize();
    up.crossVectors(right, dir).normalize();
    for (let i = 0; i < 5; i++) {
      const d = _v2.copy(dir);
      if (i > 0) {
        const a = (i - 1) * Math.PI / 2;
        d.addScaledVector(right, Math.cos(a) * 0.12).addScaledVector(up, Math.sin(a) * 0.12).normalize();
      }
      for (const c of this.characters) {
        if (c === attacker || !c.alive || c.team === attacker.team) continue;
        const h = c.hitTest(origin, d, bestDist);
        if (h && h.dist < bestDist) { bestDist = h.dist; best = h; victim = c; }
      }
    }

    if (!victim) {
      if (wall) {
        this.effects.impact(wall.point, wall.normal, wall.collider.surface, 0.5);
        this.audio.impact(wall.point.clone(), wall.collider.surface);
      }
      return false;
    }

    // Backstab: is the attacker behind the victim's facing? A knife in the back
    // is a kill, which is the whole reason to ever choose the knife on purpose.
    const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw);
    const toVictim = Math.hypot(victim.pos.x - attacker.pos.x, victim.pos.z - attacker.pos.z) || 1;
    const ax = (victim.pos.x - attacker.pos.x) / toVictim, az = (victim.pos.z - attacker.pos.z) / toVictim;
    const behind = (ax * fx + az * fz) > 0.42;   // within ~65 degrees of straight behind
    const dmg = behind ? swing.back : swing.damage;

    attacker.shotsHit++;
    this.effects.bloodBurst(best.point, dir, behind ? 1.8 : 1.2);
    this.audio.flesh(best.point.clone());
    if (victim.isPlayer) this.damagePlayer(dmg, attacker, origin);
    else this.damageBot(victim, dmg, attacker, false, def);
    if (attacker.isPlayer) {
      this.hud.hitmarker(!victim.alive);
      this.audio.hitmarker(!victim.alive);
      // overrides the generic elimination message onDeath() just queued
      if (behind && !victim.alive) this.hud.centerMessage('+100 BACKSTAB', `${victim.name} DOWN`, 1.4);
    }
    this.lastCombat = new THREE.Vector3(attacker.pos.x, attacker.pos.y, attacker.pos.z);
    return true;
  }

  traceBullet(shooter, origin, dir, def, isBot) {
    const range = def.range * 2.2;
    const worldHit = this.physics.raycast(origin, dir, range);
    const worldDist = worldHit ? worldHit.dist : range;

    let charHit = null, charDist = worldDist, victim = null;
    for (const c of this.characters) {
      if (c === shooter || !c.alive || c.team === shooter.team) continue;
      const h = c.hitTest(origin, dir, charDist);
      if (h && h.dist < charDist) { charDist = h.dist; charHit = h; victim = c; }
    }

    const endPoint = charHit ? charHit.point
      : (worldHit ? worldHit.point : _v3.copy(origin).addScaledVector(dir, range).clone());

    // tracer — only some rounds, and never on the very first metre of a shotgun blast
    const showTracer = def.pellets > 1 ? Math.random() < 0.4 : true;
    if (showTracer) {
      const start = _v4.copy(origin).addScaledVector(dir, isBot ? 0.2 : 0.9);
      this.effects.tracer(start, endPoint, def.pellets > 1 ? 0xffbb70 : 0xffd28a, def.pellets > 1 ? 0.7 : 1);
    }

    // supersonic snap past the player's head
    if (isBot) {
      const toP = _v4.subVectors(this.camera.position, origin);
      const along = toP.dot(dir);
      if (along > 1 && along < charDist + 2) {
        const perp = toP.addScaledVector(dir, -along).length();
        if (perp < 2.6) {
          this.audio.whizz(_v4.copy(origin).addScaledVector(dir, along).clone(), 1 - perp / 2.6);
        }
      }
    }

    if (charHit && victim) {
      shooter.shotsHit++;
      const dist = charDist;
      const falloffStart = def.range * 0.4;
      let mult = 1;
      if (dist > falloffStart) {
        const t = Math.min(1, (dist - falloffStart) / Math.max(1, def.range - falloffStart));
        mult = 1 - t * (1 - def.falloff);
      }
      let zoneMult = 1;
      if (charHit.mult === 'head') zoneMult = def.headMult;
      else if (charHit.mult === 'leg') zoneMult = def.legMult;
      else if (charHit.mult === 'limb') zoneMult = 0.85;
      let dmg = def.damage * mult * zoneMult;
      if (isBot) dmg *= shooter.D.damageMult;

      this.effects.bloodBurst(charHit.point, dir, charHit.mult === 'head' ? 1.7 : 1);
      this.audio.flesh(charHit.point.clone());

      if (victim.isPlayer) {
        this.damagePlayer(dmg, shooter, origin);
      } else {
        this.damageBot(victim, dmg, shooter, charHit.zone === 'head', def);
      }
      if (shooter.isPlayer) {
        this.hud.hitmarker(!victim.alive);
        this.audio.hitmarker(!victim.alive);
      }
    } else if (worldHit) {
      this.effects.impact(worldHit.point, worldHit.normal, worldHit.collider.surface, def.pellets > 1 ? 0.4 : 1);
      if (def.pellets === 1 || Math.random() < 0.4) {
        this.audio.impact(worldHit.point.clone(), worldHit.collider.surface);
      }
    }
  }

  damagePlayer(amount, from, fromPos) {
    const p = this.player;
    if (!p.alive || this.godMode) return;
    let dmg = amount;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, dmg * 0.55);
      p.armor -= absorbed;
      dmg -= absorbed;
    }
    p.health -= dmg;
    p.lastDamageTime = this.time;
    this.hud.damageFlash(amount);
    this.audio.hurt(amount);
    p.shake(0.006 + amount * 0.0004, 0.16);
    if (fromPos) p.addHitDir(fromPos);
    if (p.health <= 0) {
      p.health = 0;
      this.onDeath(p, from);
    }
  }

  damageBot(bot, amount, from, headshot, def) {
    if (!bot.alive) return;
    let dmg = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, dmg * 0.5);
      bot.armor -= absorbed;
      dmg -= absorbed;
    }
    bot.health -= dmg;
    bot.onDamaged?.(from, this.time);
    if (bot.health <= 0) this.onDeath(bot, from, headshot, def);
  }

  onDeath(victim, killer, headshot = false, def = null) {
    victim.kill();
    const weaponName = def ? def.name : (killer && killer.weapon ? killer.weapon.def.name : 'FRAG');
    if (killer && killer !== victim && killer.team !== victim.team) {
      killer.kills++;
      this.score[killer.team]++;
      if (killer.isPlayer) {
        this.hud.centerMessage(headshot ? '+150 HEADSHOT' : '+100 ELIMINATION',
          `${victim.name} DOWN`, 1.4);
      }
    } else if (killer === null) {
      // suicide / falling
      this.score[victim.team === 'blue' ? 'red' : 'blue']++;
    }
    this.hud.addKill(
      killer ? killer.name : 'WORLD', killer ? killer.team : 'red',
      victim.name, victim.team, weaponName, headshot,
      victim.isPlayer || (killer && killer.isPlayer)
    );

    // blood pool under the body
    const g = this.physics.raycast(_v.set(victim.pos.x, victim.pos.y + 0.5, victim.pos.z), _v2.set(0, -1, 0), 3);
    if (g) this.effects.bloodPool(g.point, g.normal);

    // dead bots drop their gun with whatever rounds they had left
    if (!victim.isPlayer && victim.weapon && !victim.weapon.def.melee &&
        victim.weapon.ammo + victim.weapon.reserve > 0) {
      this.spawnDrop(victim.weapon.id, victim.weapon.ammo, victim.weapon.reserve, victim.pos);
    }

    if (victim.isPlayer) {
      this.respawnIn = 3.0;
      this.lastKiller = killer ? `${killer.name} · ${weaponName}` : 'THE FALL';
      victim.deathCamT = 0;
    } else {
      // Slow respawns on purpose: with nine bots a 3-second timer produced
      // ~22 kills a minute between them, ending the match in a few minutes and
      // drowning out the player's own contribution.
      victim.respawnTimer = 6.0 + Math.random() * 5.0;
    }
    this.checkEnd();
  }

  // ------------------------------------------------------------ weapon drops

  spawnDrop(id, ammo, reserve, pos) {
    // view models share geometry through the build caches, so a drop costs a
    // handful of Object3Ds, not GPU memory — but keep the count sane anyway
    if (this.drops.length >= 12) this.scene.remove(this.drops.shift().mesh);
    const mesh = buildViewModel(id);
    mesh.scale.setScalar(0.85);
    const g = this.physics.raycast(_v.set(pos.x, pos.y + 0.6, pos.z), _v2.set(0, -1, 0), 4);
    const y = g ? g.point.y : pos.y;
    mesh.position.set(pos.x, y + 0.07, pos.z);
    mesh.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);   // lying on its side
    mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(mesh);
    this.drops.push({ mesh, id, ammo, reserve, life: 30 });
  }

  nearestDrop() {
    let best = null, bestD = 2.2;
    for (const d of this.drops) {
      const dist = Math.hypot(d.mesh.position.x - this.player.pos.x, d.mesh.position.z - this.player.pos.z);
      const dy = Math.abs(d.mesh.position.y - this.player.pos.y);
      if (dist < bestD && dy < 1.8) { best = d; bestD = dist; }
    }
    return best;
  }

  tryPickup() {
    if (!this.player.alive || this.over) return;
    const d = this.nearestDrop();
    if (!d) return;
    const p = this.player;
    const slotKey = WEAPONS[d.id].slot === 'secondary' ? 'secondary' : 'primary';
    if (p.loadout[slotKey] === d.id) {
      // same gun — just take the ammo
      const w = p.weapons[slotKey];
      w.reserve = Math.min(w.def.reserve, w.reserve + d.ammo + d.reserve);
      this.scene.remove(d.mesh);
      this.drops.splice(this.drops.indexOf(d), 1);
      this.audio.click('mag', 0.8);
    } else {
      const old = p.pickupWeapon(d.id, d.ammo, d.reserve);
      const at = d.mesh.position;
      this.scene.remove(d.mesh);
      this.drops.splice(this.drops.indexOf(d), 1);
      // your old gun goes down where the new one was
      if (old.ammo + old.reserve > 0) this.spawnDrop(old.id, old.ammo, old.reserve, _v.set(at.x, at.y, at.z));
      this.audio.click('swap');
    }
    this.hud.buildInventory(p);
  }

  updateDrops(dt) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      // blink for the last few seconds so the despawn is not a surprise
      if (d.life < 4) d.mesh.visible = (d.life * 4 | 0) % 2 === 0;
      if (d.life <= 0) { this.scene.remove(d.mesh); this.drops.splice(i, 1); }
    }
    const near = this.player.alive ? this.nearestDrop() : null;
    if (near) {
      const def = WEAPONS[near.id];
      const slotKey = def.slot === 'secondary' ? 'secondary' : 'primary';
      const same = this.player.loadout[slotKey] === near.id;
      this.hud.pickupPrompt(
        `<span class="key">E</span> ${same ? 'TAKE AMMO' : 'PICK UP'} · ${def.name} ${near.ammo}/${near.reserve}`);
    } else this.hud.pickupPrompt(null);
  }

  spawnGrenade(owner, origin, velocity) {
    const mesh = new THREE.Mesh(GRENADE_GEO, flat(0x39472f, 0.75, 0.25));
    mesh.castShadow = true;
    mesh.scale.set(1, 1.25, 1);
    this.scene.add(mesh);
    this.grenades.push({
      mesh, owner,
      pos: origin.clone().addScaledVector(_v.copy(velocity).normalize(), 0.5),
      vel: velocity.clone(),
      fuse: 2.7,
      spin: new THREE.Vector3(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7),
    });
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 20 * dt;
      const step = _v.copy(g.vel).multiplyScalar(dt);
      const len = step.length();
      if (len > 0.0001) {
        const dir = _v2.copy(step).divideScalar(len);
        const hit = this.physics.raycast(g.pos, dir, len + 0.09);
        if (hit) {
          g.pos.copy(hit.point).addScaledVector(hit.normal, 0.09);
          const vn = g.vel.dot(hit.normal);
          g.vel.addScaledVector(hit.normal, -1.55 * vn);
          g.vel.multiplyScalar(0.55);
          g.spin.multiplyScalar(0.6);
          if (g.vel.lengthSq() > 1) this.audio.click('shell', 0.5);
        } else {
          g.pos.add(step);
        }
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.spin.x * dt;
      g.mesh.rotation.z += g.spin.z * dt;

      if (g.fuse <= 0) {
        this.explode(g.pos, g.owner);
        this.scene.remove(g.mesh);   // geometry is shared, do not dispose
        this.grenades.splice(i, 1);
      }
    }
  }

  explode(pos, owner) {
    const R = 8.5;
    this.effects.explosion(pos, 3.0);
    this.audio.explosion(pos.clone());
    for (const c of this.characters) {
      if (!c.alive) continue;
      const cp = _v.set(c.pos.x, c.pos.y + 0.9, c.pos.z);
      const d = cp.distanceTo(pos);
      if (d > R) continue;
      // walls soak the blast
      if (!this.physics.visible(pos, cp, 0.1)) continue;
      const falloff = 1 - d / R;
      const dmg = 24 + 105 * falloff * falloff;
      if (c.isPlayer) {
        this.damagePlayer(dmg, owner === c ? null : owner, pos);
        this.player.shake(0.05 * falloff, 0.5);
      } else {
        this.damageBot(c, dmg, owner, false, { name: 'FRAG GRENADE' });
        if (!c.alive && owner && owner !== c && owner.team !== c.team) { /* scored in onDeath */ }
      }
    }
    // scorch the ground
    const gh = this.physics.raycast(_v.copy(pos).setY(pos.y + 0.2), _v2.set(0, -1, 0), 3);
    if (gh) this.effects.decal(this.effects.bloodDecals, gh.point, gh.normal, 0);
  }

  checkEnd() {
    if (this.over) return;
    if (this.score.blue >= this.scoreLimit || this.score.red >= this.scoreLimit) {
      this.endMatch(this.score.blue > this.score.red);
    }
  }

  endMatch(win) {
    this.over = true;
    this.running = false;
    this.hud.hide();
    document.exitPointerLock?.();
    const el = document.getElementById('endscreen');
    const title = document.getElementById('end-title');
    title.textContent = win ? 'VICTORY' : 'DEFEAT';
    title.className = win ? 'win' : 'lose';
    document.getElementById('end-sub').textContent =
      `GHOST ${this.score.blue} — ${this.score.red} VIPER`;
    const p = this.player;
    const acc = p.shotsFired ? Math.round(p.shotsHit / p.shotsFired * 100) : 0;
    document.getElementById('end-stats').innerHTML = `
      <div><span class="k">ELIMINATIONS</span><span class="v">${p.kills}</span></div>
      <div><span class="k">DEATHS</span><span class="v">${p.deaths}</span></div>
      <div><span class="k">K/D RATIO</span><span class="v">${(p.kills / Math.max(1, p.deaths)).toFixed(2)}</span></div>
      <div><span class="k">ACCURACY</span><span class="v">${acc}%</span></div>
      <div><span class="k">SHOTS FIRED</span><span class="v">${p.shotsFired}</span></div>
      <div><span class="k">DIFFICULTY</span><span class="v">${DIFFICULTIES[this.settings.difficulty].name}</span></div>`;
    el.classList.remove('hidden');
  }

  isVisibleToPlayer(c) {
    // used by the minimap: enemies show only while they are actually seen
    this.player.eyePos(_v);
    _v2.set(c.pos.x, c.pos.y + 1.3, c.pos.z);
    const d = _v.distanceTo(_v2);
    if (d > 80) return false;
    _v3.subVectors(_v2, _v).normalize();
    const fwd = _v4.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (_v3.dot(fwd) < 0.35) return c.lastFireTime !== undefined && this.time - c.lastFireTime < 1.5 && d < 45;
    return this.physics.visible(_v, _v2, 0.05);
  }

  // ---------------------------------------------------------------- loop

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    if (this.pipeline) this.pipeline.setSize(w, h);
  }

  /** Muzzle flash rendered in the weapon scene, in view space. */
  viewMuzzleFlash(localPos, scale) {
    this.vmFlash.position.copy(localPos);
    this.vmFlash.scale.setScalar(0.14 * scale);
    this.vmFlash.material.rotation = Math.random() * 6.28;
    this.vmFlash.material.opacity = 1;
    this.vmFlash.visible = true;
    this.vmFlashStar.position.copy(localPos);
    this.vmFlashStar.position.z -= 0.05 * scale;
    this.vmFlashStar.scale.set(0.26 * scale, 0.045 * scale, 1);
    this.vmFlashStar.rotation.z = (Math.random() - 0.5) * 0.9;
    this.vmFlashStar.material.opacity = 0.9;
    this.vmFlashStar.visible = true;
    this.vmFlashLife = 0.045;
    this.vmMuzzleLight.position.copy(localPos);
    this.vmMuzzleLight.intensity = 5 * scale;
  }

  update(dt) {
    if (!this.running || this.paused) return;
    this.time += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.endMatch(this.score.blue >= this.score.red); return; }

    this.player.update(dt, this.time);

    if (!this.player.alive) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawnCharacter(this.player);
    }

    for (const b of this.bots) {
      if (!b.alive) {
        b.respawnTimer -= dt;
        b.animate(dt, this.time);
        if (b.respawnTimer <= 0) {
          const [x, y, z] = this.spawnPoint(b.team);
          b.respawn(x, y + 0.05, z, Math.random() * 6.28);
        }
      } else if (this.freezeBots) {
        b.animate(dt, this.time);
      } else {
        b.update(dt, this.time);
      }
    }

    this.updateGrenades(dt);
    this.updateDrops(dt);
    this.effects.update(dt, innerHeight);

    // keep the shadow frustum centred on the action
    const p = this.player.pos;
    // debug hooks for tools/flicker.mjs
    const trackZ = this._sunTrack !== undefined ? this._sunTrack : p.z;
    const trackX = this._sunTrack !== undefined ? 0 : p.x;
    if (!this._freezeSun) {
      this.sun.position.set(trackX + this.sunDir.x * 90, this.sunDir.y * 90, trackZ + this.sunDir.z * 90);
      this.sun.target.position.set(trackX, 0, trackZ);
    }
    this.sun.target.updateMatrixWorld();
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.sky.updateMatrix();
    this.sky.updateMatrixWorld();

    // audio listener follows the camera
    _v.copy(this.camera.position);
    _v2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _v3.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.audio.setListener(_v, _v2, _v3);

    this.updateViewLights(dt);
    this.hud.update(dt, this);
  }

  render(dt = 0.016) {
    const drawWeapon = !!(this.player && this.player.alive);
    if (this.pipeline) this.pipeline.render(dt, drawWeapon);
    else this.renderer.render(this.scene, this.camera);
    this.renderStats = {
      calls: this.renderer.info.render.calls,
      tris: this.renderer.info.render.triangles,
    };
  }

  updateViewLights(dt) {
    // keep the weapon lit consistently with the world by rotating the sun
    // direction into view space
    _q.copy(this.camera.quaternion).invert();
    _v.copy(this.sunDir).applyQuaternion(_q);
    this.vmKey.position.copy(_v).multiplyScalar(3);
    if (this.vmFlashLife > 0) {
      this.vmFlashLife -= dt;
      const k = Math.max(0, this.vmFlashLife / 0.045);
      this.vmFlash.material.opacity = k;
      this.vmFlashStar.material.opacity = k * 0.9;
      this.vmMuzzleLight.intensity *= k;
      if (this.vmFlashLife <= 0) {
        this.vmFlash.visible = false; this.vmFlashStar.visible = false; this.vmMuzzleLight.intensity = 0;
      }
    }
  }
}

// Yield to the browser between load steps. Deliberately setTimeout rather than
// requestAnimationFrame: rAF is throttled to a crawl when the window is occluded
// or backgrounded, which would stall loading indefinitely.
function frame() {
  return new Promise(r => setTimeout(r, 0));
}
