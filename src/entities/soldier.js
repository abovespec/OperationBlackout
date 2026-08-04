// Soldier mesh construction.
//
// Parts are authored in bone-local space and then merged per (bone, material),
// so a full figure with ~60 pieces of kit still costs about a dozen draw calls
// and the animation rig only has to move eleven groups.
import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, flat, makeAtlas, remapUV } from '../world/textures.js';

// The two sides need to be separable at a glance across the whole map, so the
// palettes are pushed apart: GHOST is cold urban grey, VIPER is warm desert tan.
export const TEAM = {
  blue: {
    id: 'blue', name: 'GHOST', color: 0x57c8ff,
    palette: ['#7c8792', '#636e7a', '#48525d', '#333b44', '#9aa5b0'],
    vest: 0x2f353c, hard: 0x3a424a, strap: 0x23282e, patch: 0x57c8ff,
  },
  red: {
    id: 'red', name: 'VIPER', color: 0xff5a52,
    palette: ['#a8946a', '#8a7550', '#6a583a', '#463a26', '#c2b189'],
    vest: 0x4a3f2e, hard: 0x574a36, strap: 0x2e271c, patch: 0xff5a52,
  },
};

// ---------------------------------------------------------------- geometry

const GEO = new Map();
function keyed(key, make) {
  let g = GEO.get(key);
  if (!g) GEO.set(key, g = make());
  return g;
}
/** Capsule along +Y, centred. */
function capsule(r, len, seg = 10) {
  return keyed(`cap${r},${len},${seg}`, () => new THREE.CapsuleGeometry(r, len, 3, seg));
}
function boxG(w, h, d) { return keyed(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)); }
function sphereG(r, seg = 12) { return keyed(`sph${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1))); }
function coneG(rt, rb, h, seg = 10) {
  return keyed(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1));
}

/** Clone + place a cached geometry into bone-local space. */
function place(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = geo.clone();
  if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

class RigBuilder {
  constructor() { this.parts = new Map(); }   // boneName -> [{ matKey, geo, repeat }]
  add(bone, matKey, geo, repeat = 1) {
    let list = this.parts.get(bone);
    if (!list) this.parts.set(bone, list = []);
    list.push({ matKey, geo, repeat });
  }
  /** Merge into one geometry per bone. Returns boneName -> BufferGeometry. */
  bake(rects) {
    const out = {};
    for (const [boneName, list] of this.parts) {
      const geoms = [];
      for (const { matKey, geo, repeat } of list) {
        const r = rects[matKey];
        if (r) remapUV(geo, r, repeat);
        // merging needs a consistent attribute set
        if (geo.attributes.uv2) geo.deleteAttribute('uv2');
        geoms.push(geo);
      }
      const merged = geoms.length === 1 ? geoms[0] : BGU.mergeGeometries(geoms, false);
      if (merged) out[boneName] = merged;
    }
    return out;
  }
}

// ---------------------------------------------------------------- materials

const MATS = new Map();

/**
 * One atlas, one material, per team. Every surface a soldier needs lives in a
 * tile; parts have their UVs remapped into the right tile at build time. Without
 * this a figure costs a draw call per bone *per material* — about fifty.
 */
function soldierMaterial(teamId) {
  if (MATS.has(teamId)) return MATS.get(teamId);
  const T = TEAM[teamId];
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  const atlas = makeAtlas([
    { key: 'camo', kind: 'camo', seed: teamId === 'blue' ? 21 : 57, opts: { palette: T.palette } },
    { key: 'vest', kind: 'nylon', seed: 31, tint: hex(T.vest) },
    { key: 'hard', kind: 'hardkit', seed: 41, tint: hex(T.hard) },
    { key: 'skin', kind: 'skin', seed: 11 },
    { key: 'strap', color: hex(T.strap), rough: [0.85, 1.0] },
    { key: 'glove', color: '#2e2c28', rough: [0.85, 1.0] },
    { key: 'boot', color: '#191917', rough: [0.55, 0.8] },
    { key: 'metal', color: '#6a6d70', rough: [0.3, 0.55] },
    { key: 'lens', color: '#14232b', rough: [0.05, 0.2] },
    { key: 'patch', color: hex(T.patch), rough: [0.4, 0.6] },
  ], 256);

  const material = new THREE.MeshStandardMaterial({
    map: atlas.map,
    normalMap: atlas.normalMap,
    roughnessMap: atlas.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
  });
  const out = { material, rects: atlas.rects };
  MATS.set(teamId, out);
  return out;
}

// ---------------------------------------------------------------- the figure

/**
 * Build a soldier. Origin at the feet, facing -Z, roughly 1.78 m tall.
 * Returns the bone groups the animation code drives.
 */
/**
 * Baked bone geometry per team. Every soldier on a side is identical, so the
 * merge is done once and each instance just references the result — otherwise
 * each spawn allocates a dozen fresh buffers that are never freed.
 */
const BAKED = new Map();

export function buildSoldier(teamId) {
  const { material, rects } = soldierMaterial(teamId);
  const B = new RigBuilder();

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);
  const neck = new THREE.Group();
  neck.position.y = 0.585;
  torso.add(neck);

  const bones = { hips, torso, neck };
  const legs = {}, arms = {};

  // ---- pelvis / belt kit
  B.add('hips', 'camo', place(capsule(0.145, 0.13, 12), 0, -0.05, 0, 0, 0, 0, 1.25, 1, 0.95));
  B.add('hips', 'vest', place(boxG(0.30, 0.075, 0.21), 0, 0.03, 0));            // belt
  B.add('hips', 'strap', place(boxG(0.33, 0.028, 0.235), 0, 0.055, 0));         // belt edge
  // dump pouch + holster + canteen
  B.add('hips', 'vest', place(boxG(0.10, 0.13, 0.075), -0.155, -0.03, 0.015, 0, 0, -0.12));
  B.add('hips', 'vest', place(boxG(0.085, 0.15, 0.065), 0.155, -0.05, 0.01, 0, 0, 0.1));
  B.add('hips', 'hard', place(boxG(0.055, 0.11, 0.05), 0.163, -0.10, 0.012, 0, 0, 0.1));
  B.add('hips', 'vest', place(coneG(0.045, 0.045, 0.12, 10), -0.10, -0.03, 0.13));

  // ---- legs
  for (const side of ['l', 'r']) {
    const s = side === 'l' ? -1 : 1;
    const up = new THREE.Group();
    up.position.set(s * 0.098, -0.02, 0);
    hips.add(up);
    const lo = new THREE.Group();
    lo.position.y = -0.42;
    up.add(lo);
    bones[`leg_${side}_up`] = up;
    bones[`leg_${side}_lo`] = lo;
    legs[side] = { up, lo };

    // thigh: tapered capsule
    B.add(`leg_${side}_up`, 'camo', place(capsule(0.098, 0.26, 10), 0, -0.19, 0, 0, 0, 0, 1, 1, 0.92));
    // cargo pocket
    B.add(`leg_${side}_up`, 'camo', place(boxG(0.10, 0.13, 0.055), s * 0.085, -0.22, 0.01, 0, 0, s * 0.06));
    B.add(`leg_${side}_up`, 'strap', place(boxG(0.10, 0.016, 0.058), s * 0.085, -0.163, 0.011));

    // knee pad sits on the shin bone so it tracks the joint
    B.add(`leg_${side}_lo`, 'hard', place(sphereG(0.072, 10), 0, 0.015, -0.045, 0, 0, 0, 1.1, 0.95, 0.7));
    // shin
    B.add(`leg_${side}_lo`, 'camo', place(capsule(0.079, 0.24, 10), 0, -0.19, 0, 0, 0, 0, 1, 1, 0.9));
    // boot: upper, foot, sole
    B.add(`leg_${side}_lo`, 'boot', place(boxG(0.105, 0.12, 0.115), 0, -0.375, 0.004));
    B.add(`leg_${side}_lo`, 'boot', place(boxG(0.108, 0.075, 0.235), 0, -0.425, -0.045));
    B.add(`leg_${side}_lo`, 'boot', place(boxG(0.116, 0.028, 0.245), 0, -0.457, -0.05));
  }

  // ---- torso: ribcage, plate carrier, pouches, pack
  B.add('torso', 'camo', place(capsule(0.152, 0.20, 12), 0, 0.30, 0, 0, 0, 0, 1.28, 1, 0.80));
  B.add('torso', 'camo', place(boxG(0.30, 0.16, 0.20), 0, 0.14, 0));            // waist join
  // plate carrier front and back
  B.add('torso', 'vest', place(boxG(0.315, 0.335, 0.115), 0, 0.325, -0.055, 0, 0, 0, 1, 1, 1));
  B.add('torso', 'vest', place(boxG(0.305, 0.32, 0.09), 0, 0.325, 0.075));
  B.add('torso', 'vest', place(boxG(0.135, 0.30, 0.19), -0.155, 0.32, 0.01));   // cummerbund
  B.add('torso', 'vest', place(boxG(0.135, 0.30, 0.19), 0.155, 0.32, 0.01));
  // shoulder straps
  B.add('torso', 'strap', place(boxG(0.085, 0.10, 0.24), -0.105, 0.475, 0.005, -0.12));
  B.add('torso', 'strap', place(boxG(0.085, 0.10, 0.24), 0.105, 0.475, 0.005, -0.12));
  // triple mag pouches across the chest
  for (let i = -1; i <= 1; i++) {
    B.add('torso', 'vest', place(boxG(0.082, 0.135, 0.062), i * 0.09, 0.275, -0.135));
    B.add('torso', 'strap', place(boxG(0.084, 0.02, 0.066), i * 0.09, 0.345, -0.136));
  }
  // admin pouch, radio, grenade
  B.add('torso', 'vest', place(boxG(0.10, 0.085, 0.05), -0.10, 0.415, -0.13));
  B.add('torso', 'vest', place(boxG(0.075, 0.115, 0.055), 0.115, 0.40, -0.125, 0, 0, 0.12));
  B.add('torso', 'hard', place(coneG(0.026, 0.03, 0.085, 8), 0.155, 0.44, 0.06));
  B.add('torso', 'metal', place(coneG(0.004, 0.004, 0.20, 5), 0.155, 0.565, 0.06, 0.12));
  // team patch on the shoulder
  B.add('torso', 'patch', place(boxG(0.05, 0.05, 0.012), 0.152, 0.46, -0.10));
  // back pack
  B.add('torso', 'vest', place(boxG(0.26, 0.30, 0.135), 0, 0.335, 0.16, 0, 0, 0, 1, 1, 1));
  B.add('torso', 'strap', place(boxG(0.27, 0.022, 0.14), 0, 0.415, 0.162));
  B.add('torso', 'strap', place(boxG(0.27, 0.022, 0.14), 0, 0.265, 0.162));
  B.add('torso', 'vest', place(boxG(0.16, 0.10, 0.07), 0, 0.20, 0.20));         // bedroll

  // ---- head
  B.add('neck', 'camo', place(coneG(0.055, 0.062, 0.07, 10), 0, -0.02, 0));     // neck
  B.add('neck', 'strap', place(sphereG(0.093, 14), 0, 0.075, 0.004, 0, 0, 0, 1.0, 1.06, 1.02)); // balaclava
  B.add('neck', 'skin', place(sphereG(0.088, 14), 0, 0.078, -0.012, 0, 0, 0, 0.95, 1.0, 1.0));
  // helmet: dome + brim + rails + NVG mount
  B.add('neck', 'hard', place(sphereG(0.108, 16), 0, 0.088, 0.004, 0, 0, 0, 1.0, 0.95, 1.04));
  B.add('neck', 'hard', place(boxG(0.215, 0.03, 0.075), 0, 0.062, -0.086, 0.22));
  B.add('neck', 'hard', place(boxG(0.018, 0.05, 0.15), -0.105, 0.078, 0.01));
  B.add('neck', 'hard', place(boxG(0.018, 0.05, 0.15), 0.105, 0.078, 0.01));
  B.add('neck', 'hard', place(boxG(0.05, 0.045, 0.04), 0, 0.115, -0.095));
  B.add('neck', 'metal', place(coneG(0.012, 0.012, 0.05, 6), 0, 0.128, -0.115, Math.PI / 2));
  // goggles pushed up on the helmet
  B.add('neck', 'strap', place(boxG(0.20, 0.028, 0.10), 0, 0.115, 0.01));
  B.add('neck', 'lens', place(boxG(0.155, 0.048, 0.03), 0, 0.038, -0.088, 0.1));
  B.add('neck', 'hard', place(boxG(0.165, 0.016, 0.032), 0, 0.062, -0.089, 0.1));
  // chin strap
  B.add('neck', 'strap', place(boxG(0.02, 0.09, 0.018), -0.082, 0.03, -0.03, 0.2));
  B.add('neck', 'strap', place(boxG(0.02, 0.09, 0.018), 0.082, 0.03, -0.03, 0.2));

  // ---- arms
  for (const side of ['l', 'r']) {
    const s = side === 'l' ? -1 : 1;
    const up = new THREE.Group();
    up.position.set(s * 0.205, 0.475, 0);
    torso.add(up);
    const lo = new THREE.Group();
    lo.position.y = -0.275;
    up.add(lo);
    bones[`arm_${side}_up`] = up;
    bones[`arm_${side}_lo`] = lo;
    arms[side] = { up, lo };

    B.add(`arm_${side}_up`, 'vest', place(sphereG(0.082, 10), 0, -0.015, 0, 0, 0, 0, 1.0, 0.95, 1.0)); // shoulder cap
    B.add(`arm_${side}_up`, 'camo', place(capsule(0.062, 0.17, 10), 0, -0.145, 0));
    B.add(`arm_${side}_lo`, 'hard', place(sphereG(0.055, 8), 0, 0.01, -0.018, 0, 0, 0, 1.0, 0.9, 0.8)); // elbow pad
    B.add(`arm_${side}_lo`, 'camo', place(capsule(0.052, 0.15, 10), 0, -0.115, 0));
    // glove: palm + a suggestion of fingers
    B.add(`arm_${side}_lo`, 'glove', place(boxG(0.062, 0.075, 0.10), 0, -0.225, -0.008));
    B.add(`arm_${side}_lo`, 'glove', place(boxG(0.058, 0.045, 0.055), 0, -0.272, -0.028, 0.35));
    B.add(`arm_${side}_lo`, 'glove', place(boxG(0.024, 0.05, 0.045), s * -0.036, -0.238, -0.045, 0, 0, s * 0.5));
  }

  // weapon mount rides on the torso, aimed by the animation code
  const weaponMount = new THREE.Group();
  weaponMount.position.set(0.15, 0.42, -0.20);
  torso.add(weaponMount);

  let baked = BAKED.get(teamId);
  if (!baked) BAKED.set(teamId, baked = B.bake(rects));

  let headMesh = null;
  for (const [boneName, geo] of Object.entries(baked)) {
    const bone = bones[boneName];
    if (!bone) continue;
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    bone.add(m);
    if (bone === neck) headMesh = m;
  }

  return { root, hips, torso, neck, legs, arms, weaponMount, headMesh, material };
}
