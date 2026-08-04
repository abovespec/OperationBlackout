// Weapon definitions + procedurally-modelled view models.
import * as THREE from 'three';

export const WEAPONS = {
  m4a1: {
    id: 'm4a1', name: 'M4A1 CARBINE', slot: 'primary', cls: 'ASSAULT RIFLE',
    auto: true, rpm: 750, damage: 27, headMult: 3.0, legMult: 0.82,
    mag: 30, reserve: 150, reload: 2.15, reloadEmpty: 2.75,
    spreadHip: 0.030, spreadAds: 0.0045, bloom: 0.0038, spreadMax: 0.075, spreadDecay: 0.10,
    recoilV: 0.0075, recoilH: 0.0030, recoilRise: 1.35, kickBack: 0.020,
    adsTime: 0.22, adsFov: 0.72, moveMult: 0.94, adsMove: 0.55,
    range: 90, falloff: 0.62, pellets: 1, penetration: 1,
    muzzleFlash: 1.0, shellSize: 1.0,
    stats: { damage: 0.55, rate: 0.72, accuracy: 0.78, control: 0.72, mobility: 0.66 },
    sound: { freq: 190, noise: 0.85, punch: 1.0, len: 0.19 },
  },
  ak74: {
    id: 'ak74', name: 'AK-74', slot: 'primary', cls: 'ASSAULT RIFLE',
    auto: true, rpm: 620, damage: 35, headMult: 2.8, legMult: 0.85,
    mag: 30, reserve: 150, reload: 2.45, reloadEmpty: 3.1,
    spreadHip: 0.038, spreadAds: 0.0058, bloom: 0.0058, spreadMax: 0.095, spreadDecay: 0.09,
    recoilV: 0.0115, recoilH: 0.0052, recoilRise: 1.5, kickBack: 0.030,
    adsTime: 0.27, adsFov: 0.72, moveMult: 0.90, adsMove: 0.50,
    range: 100, falloff: 0.66, pellets: 1, penetration: 1.3,
    muzzleFlash: 1.35, shellSize: 1.2,
    stats: { damage: 0.72, rate: 0.6, accuracy: 0.66, control: 0.5, mobility: 0.58 },
    sound: { freq: 150, noise: 0.9, punch: 1.25, len: 0.24 },
  },
  mp5k: {
    id: 'mp5k', name: 'MP5K', slot: 'primary', cls: 'SUBMACHINE GUN',
    auto: true, rpm: 900, damage: 21, headMult: 2.6, legMult: 0.88,
    mag: 32, reserve: 192, reload: 1.85, reloadEmpty: 2.35,
    spreadHip: 0.024, spreadAds: 0.0075, bloom: 0.0042, spreadMax: 0.085, spreadDecay: 0.13,
    recoilV: 0.0056, recoilH: 0.0034, recoilRise: 1.2, kickBack: 0.014,
    adsTime: 0.16, adsFov: 0.82, moveMult: 1.0, adsMove: 0.66,
    range: 48, falloff: 0.45, pellets: 1, penetration: 0.7,
    muzzleFlash: 0.8, shellSize: 0.8,
    stats: { damage: 0.35, rate: 0.9, accuracy: 0.6, control: 0.8, mobility: 0.92 },
    sound: { freq: 240, noise: 0.7, punch: 0.8, len: 0.13 },
  },
  spas12: {
    id: 'spas12', name: 'SPAS-12', slot: 'primary', cls: 'SHOTGUN',
    auto: false, rpm: 85, damage: 15, headMult: 1.7, legMult: 0.9,
    mag: 8, reserve: 40, reload: 0.62, reloadEmpty: 0.62, shellReload: true,
    spreadHip: 0.052, spreadAds: 0.034, bloom: 0.006, spreadMax: 0.09, spreadDecay: 0.2,
    recoilV: 0.030, recoilH: 0.008, recoilRise: 2.4, kickBack: 0.075,
    adsTime: 0.24, adsFov: 0.85, moveMult: 0.92, adsMove: 0.55,
    range: 22, falloff: 0.22, pellets: 9, penetration: 0.4,
    muzzleFlash: 2.0, shellSize: 1.6,
    stats: { damage: 0.95, rate: 0.2, accuracy: 0.25, control: 0.3, mobility: 0.62 },
    sound: { freq: 95, noise: 1.0, punch: 1.7, len: 0.34 },
  },
  awm: {
    id: 'awm', name: 'AWM-S', slot: 'primary', cls: 'SNIPER RIFLE',
    auto: false, rpm: 45, damage: 125, headMult: 1.6, legMult: 0.65,
    mag: 5, reserve: 25, reload: 2.9, reloadEmpty: 3.4,
    spreadHip: 0.075, spreadAds: 0.0002, bloom: 0.02, spreadMax: 0.12, spreadDecay: 0.25,
    recoilV: 0.038, recoilH: 0.006, recoilRise: 3.0, kickBack: 0.09,
    adsTime: 0.42, adsFov: 0.25, moveMult: 0.84, adsMove: 0.32, scope: true, scopeFov: 0.13,
    range: 200, falloff: 0.95, pellets: 1, penetration: 2.5,
    muzzleFlash: 1.8, shellSize: 1.5, boltTime: 1.15,
    stats: { damage: 1.0, rate: 0.1, accuracy: 1.0, control: 0.2, mobility: 0.4 },
    sound: { freq: 78, noise: 1.0, punch: 2.0, len: 0.5 },
  },
  scarh: {
    id: 'scarh', name: 'SCAR-H', slot: 'primary', cls: 'MARKSMAN RIFLE',
    auto: false, rpm: 380, damage: 48, headMult: 2.5, legMult: 0.8,
    mag: 20, reserve: 120, reload: 2.35, reloadEmpty: 2.95,
    spreadHip: 0.040, spreadAds: 0.0016, bloom: 0.010, spreadMax: 0.09, spreadDecay: 0.16,
    recoilV: 0.017, recoilH: 0.004, recoilRise: 1.9, kickBack: 0.042,
    adsTime: 0.3, adsFov: 0.5, moveMult: 0.9, adsMove: 0.48,
    range: 140, falloff: 0.85, pellets: 1, penetration: 1.8,
    muzzleFlash: 1.5, shellSize: 1.3,
    stats: { damage: 0.85, rate: 0.4, accuracy: 0.9, control: 0.45, mobility: 0.55 },
    sound: { freq: 120, noise: 0.9, punch: 1.5, len: 0.3 },
  },
  g18: {
    id: 'g18', name: 'G18 MACHINE PISTOL', slot: 'secondary', cls: 'SIDEARM',
    auto: true, rpm: 1150, damage: 17, headMult: 2.4, legMult: 0.9,
    mag: 20, reserve: 120, reload: 1.55, reloadEmpty: 2.0,
    spreadHip: 0.034, spreadAds: 0.010, bloom: 0.0060, spreadMax: 0.10, spreadDecay: 0.16,
    recoilV: 0.0062, recoilH: 0.0044, recoilRise: 1.1, kickBack: 0.013,
    adsTime: 0.13, adsFov: 0.86, moveMult: 1.06, adsMove: 0.74,
    range: 34, falloff: 0.4, pellets: 1, penetration: 0.5,
    muzzleFlash: 0.7, shellSize: 0.7,
    stats: { damage: 0.28, rate: 1.0, accuracy: 0.45, control: 0.55, mobility: 1.0 },
    sound: { freq: 280, noise: 0.65, punch: 0.7, len: 0.11 },
  },
  deagle: {
    id: 'deagle', name: 'DESERT EAGLE', slot: 'secondary', cls: 'SIDEARM',
    auto: false, rpm: 260, damage: 62, headMult: 2.6, legMult: 0.78,
    mag: 7, reserve: 42, reload: 1.9, reloadEmpty: 2.4,
    spreadHip: 0.030, spreadAds: 0.0035, bloom: 0.018, spreadMax: 0.10, spreadDecay: 0.2,
    recoilV: 0.026, recoilH: 0.009, recoilRise: 2.2, kickBack: 0.055,
    adsTime: 0.19, adsFov: 0.78, moveMult: 1.02, adsMove: 0.68,
    range: 55, falloff: 0.7, pellets: 1, penetration: 1.4,
    muzzleFlash: 1.6, shellSize: 1.2,
    stats: { damage: 0.9, rate: 0.28, accuracy: 0.7, control: 0.3, mobility: 0.95 },
    sound: { freq: 130, noise: 0.85, punch: 1.6, len: 0.3 },
  },
  // The knife is a melee weapon, not a gun: no ammo, no reload, no spray, and
  // it resolves through Game.melee() rather than the hitscan path. It carries
  // only the fields the shared code actually reads (name, cls, slot, moveMult)
  // plus its own melee block. `melee` is the flag every gun-shaped code path
  // branches on, so nothing has to special-case the id.
  knife: {
    id: 'knife', name: 'COMBAT KNIFE', slot: 'knife', cls: 'MELEE',
    melee: true, auto: false, mag: 0, reserve: 0, damage: 0,
    // Carrying a knife instead of a rifle is the fastest you ever move — the
    // reason to draw it is not always that you are out of bullets.
    moveMult: 1.12, adsTime: 0.2, adsFov: 1, adsMove: 1,
    // light = left mouse, heavy = right mouse, the Counter-Strike split:
    // fast and weak versus slow and lethal. `back` applies from behind.
    light: { damage: 42, back: 180, range: 1.35, rate: 0.42, windup: 0.075 },
    heavy: { damage: 68, back: 195, range: 1.45, rate: 1.05, windup: 0.20 },
    headMult: 1.0, legMult: 1.0, falloff: 1, pellets: 0, penetration: 0,
    stats: { damage: 0.45, rate: 0.5, accuracy: 0.3, control: 1.0, mobility: 1.0 },
  },
};

// ---------------------------------------------------------------- recoil

/**
 * Deterministic spray patterns, the Counter-Strike model: the crosshair walks a
 * fixed path while you hold the trigger, so the pattern can be learned and
 * pulled against. Random-only recoil can never be mastered, which is what makes
 * automatic fire feel arbitrary.
 *
 * Shape: a steep initial climb for the first few rounds, then the rise tapers
 * and the muzzle wanders horizontally.
 */
function makeSpray(seed, len, drift) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  let x = 0, y = 0;
  for (let i = 0; i < len; i++) {
    const t = i / Math.max(1, len - 1);
    // climb hard for ~4 rounds, then flatten out
    const climb = i < 4 ? 1.0 : Math.max(0.18, 1.0 - t * 1.25);
    y += climb;
    if (i >= 3) {
      const swing = Math.sin(i * 0.42 + seed * 0.7) + Math.sin(i * 0.19 + seed);
      x += drift * swing * 0.5 + (rnd() - 0.5) * drift * 0.5;
    } else {
      x += (rnd() - 0.5) * drift * 0.25;
    }
    out.push([x, y]);
  }
  return out;
}

for (const [id, def] of Object.entries(WEAPONS)) {
  if (def.melee) continue;              // nothing to recoil against
  const len = Math.max(6, Math.min(def.mag, 30));
  const seedFromId = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  def.spray = makeSpray(seedFromId, len, def.auto ? 1.0 : 0.45);
}

export const PRIMARIES = ['m4a1', 'ak74', 'mp5k', 'scarh', 'spas12', 'awm'];
export const SECONDARIES = ['g18', 'deagle'];

// ---------------------------------------------------------------- view models

export { buildWeaponModel as buildViewModel } from './weaponmodels.js';

/** Runtime state for one carried weapon. */
export class WeaponInstance {
  constructor(id) {
    this.def = WEAPONS[id];
    this.id = id;
    this.ammo = this.def.mag;
    this.reserve = this.def.reserve;
    this.lastShot = -99;
    this.reloading = 0;
    this.bolt = 0;
    this.sprayIndex = 0;   // position along the recoil pattern
  }
  get full() { return this.ammo >= this.def.mag; }
  get empty() { return this.ammo <= 0; }
}
