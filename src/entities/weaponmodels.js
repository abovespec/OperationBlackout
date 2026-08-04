// Weapon view models.
//
// Built from a small vocabulary of shapes (receiver bodies, rails, tubes, sight
// posts, mags) so every gun can carry the details that read at first-person
// range: charging handles, ejection ports, rail slots, sling loops, floor
// plates, trigger guards, sight posts and apertures.
//
// Parts that move are collected into named groups on `userData`:
//   bolt   - reciprocates on each shot
//   mag    - drops out and returns during a reload
//   pump   - shotgun fore-end
// Everything else is merged into a single mesh per material to keep the weapon
// at a handful of draw calls.
import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { flat, mat } from '../world/textures.js';

// ---------------------------------------------------------------- materials

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    // parkerised steel — dark, slightly glossy, clearly metal
    steel: flat(0x33373b, 0.38, 0.92),
    // blued / phosphate on barrels and small parts
    blued: flat(0x1e2124, 0.30, 0.95),
    // moulded polymer furniture
    poly: flat(0x24262a, 0.72, 0.04),
    tan: flat(0x8d7c58, 0.70, 0.03),
    wood: flat(0x6b4326, 0.62, 0.02),
    // anodised aluminium: rails, optic bodies
    alu: flat(0x4a4e52, 0.42, 0.85),
    brass: flat(0xb8892f, 0.34, 0.95),
    // Sight glass must actually be glass. An opaque lens meant that aiming down
    // sights covered the target with a dark disc.
    glass: flat(0x9fc6d8, 0.05, 0.25, {
      transparent: true, opacity: 0.17, depthWrite: false,
      emissive: 0x16404f, emissiveIntensity: 0.25,
    }),
    red: flat(0xff3524, 0.35, 0.1, { emissive: 0xff2a18, emissiveIntensity: 1.6 }),
    glove: flat(0x35322c, 0.94, 0.0),
    knuckle: flat(0x232019, 0.9, 0.05),
    sleeve: mat('camo', { seed: 21, size: 256, color: 0x8d97a1 }),
    cuff: flat(0x2b3038, 0.95, 0.0),
  };
  return MATS;
}

// ---------------------------------------------------------------- primitives

const CACHE = new Map();
const keyed = (k, make) => { let g = CACHE.get(k); if (!g) CACHE.set(k, g = make()); return g; };
const boxG = (w, h, d) => keyed(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cylG = (rt, rb, h, s = 10) => keyed(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sphG = (r, s = 8) => keyed(`s${r},${s}`, () => new THREE.SphereGeometry(r, s, s >> 1));
const torG = (r, t, s = 12) => keyed(`t${r},${t},${s}`, () => new THREE.TorusGeometry(r, t, 6, s));

/** Collects geometry per material, then merges. */
class Parts {
  constructor() { this.byMat = new Map(); }
  add(matKey, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = geo.clone();
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    let l = this.byMat.get(matKey);
    if (!l) this.byMat.set(matKey, l = []);
    l.push(g);
    return this;
  }
  box(m, w, h, d, x, y, z, rx, ry, rz) { return this.add(m, boxG(w, h, d), x, y, z, rx, ry, rz); }
  /** Tube along Z (weapons point down -Z). */
  tube(m, r, len, x, y, z, seg = 10) { return this.add(m, cylG(r, r, len, seg), x, y, z, Math.PI / 2); }
  cone(m, rt, rb, len, x, y, z, seg = 10) { return this.add(m, cylG(rt, rb, len, seg), x, y, z, Math.PI / 2); }

  /** A run of picatinny slots — the single most legible "gun" detail there is. */
  rail(m, x, y, z, len, w = 0.038) {
    this.box(m, w, 0.016, len, x, y, z);
    const n = Math.max(2, Math.round(len / 0.022));
    for (let i = 0; i < n; i++) {
      const zz = z - len / 2 + 0.011 + i * (len / n);
      this.box(m, w * 0.92, 0.013, 0.008, x, y + 0.012, zz);
    }
    return this;
  }
  /** Tapered segment from point a to point b — arms, wrists, forearms. */
  limb(m, r0, r1, ax, ay, az, bx, by, bz, seg = 10) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return this;
    const g = cylG(r1, r0, len, seg).clone();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    g.applyQuaternion(q);
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    let l = this.byMat.get(m);
    if (!l) this.byMat.set(m, l = []);
    l.push(g);
    return this;
  }

  /** Screw / pin head. */
  pin(m, x, y, z, r = 0.007) { return this.add(m, cylG(r, r, 0.006, 6), x, y, z, 0, 0, Math.PI / 2); }

  commit(group) {
    const M = mats();
    for (const [k, geoms] of this.byMat) {
      const merged = geoms.length === 1 ? geoms[0] : BGU.mergeGeometries(geoms, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, M[k]);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    return group;
  }
}

/** Iron sights: front post in a hood, rear aperture. */
function ironSights(P, frontZ, rearZ, y) {
  P.box('blued', 0.026, 0.012, 0.030, 0, y, frontZ);
  P.box('blued', 0.006, 0.030, 0.008, 0, y + 0.020, frontZ);            // post
  P.box('blued', 0.005, 0.028, 0.006, -0.013, y + 0.019, frontZ);       // hood ears
  P.box('blued', 0.005, 0.028, 0.006, 0.013, y + 0.019, frontZ);
  P.box('blued', 0.030, 0.010, 0.020, 0, y, rearZ);
  P.add('blued', torG(0.011, 0.004, 10), 0, y + 0.019, rearZ, Math.PI / 2);
}

/** Compact red-dot / holo sight on a mount. */
function redDot(P, group, z, y, tall = 0.052) {
  P.box('alu', 0.030, tall, 0.026, 0, y - tall * 0.5 - 0.004, z);        // mount foot
  P.box('alu', 0.040, 0.010, 0.086, 0, y + 0.002, z);                    // lower body
  P.box('alu', 0.008, 0.044, 0.086, -0.017, y + 0.024, z);               // left rail
  P.box('alu', 0.008, 0.044, 0.086, 0.017, y + 0.024, z);                // right rail
  P.box('alu', 0.042, 0.009, 0.086, 0, y + 0.045, z);                    // top bridge
  P.box('alu', 0.014, 0.016, 0.014, 0.024, y + 0.026, z + 0.018);        // windage turret
  P.box('alu', 0.016, 0.014, 0.014, 0, y + 0.044, z + 0.018);            // elevation turret
  // Lens faces the shooter (+Z); the reticle must sit in front of it or the
  // glass hides the dot.
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.032), mats().glass);
  lens.position.set(0, y + 0.022, z - 0.030);
  group.add(lens);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0020, 12), mats().red);
  dot.position.set(0, y + 0.022, z - 0.028);
  dot.renderOrder = 12;
  dot.material.depthTest = false;
  group.add(dot);
}

/** Magazine well + a detachable magazine group that the reload animates. */
function magazine(group, def) {
  const mag = new THREE.Group();
  mag.name = 'mag';
  const MP = new Parts();
  const { w = 0.052, h = 0.15, d = 0.085, curve = 0, mat = 'poly' } = def;
  if (curve) {
    // banana mag: three stacked segments, each leaning a little further
    const seg = h / 3;
    for (let i = 0; i < 3; i++) {
      MP.box(mat, w, seg * 1.06, d, 0, -seg * i - seg * 0.5, i * curve * 0.5, curve * i * 0.55);
    }
    MP.box('blued', w * 1.08, 0.012, d * 1.04, 0, -h - 0.004, curve * 1.1, curve * 1.1);
  } else {
    MP.box(mat, w, h, d, 0, -h * 0.5, 0);
    MP.box('blued', w * 1.10, 0.013, d * 1.06, 0, -h - 0.005, 0);        // floor plate
    MP.box(mat, w * 1.02, 0.010, d * 1.02, 0, -h * 0.32, 0);             // witness rib
  }
  MP.commit(mag);
  group.add(mag);
  return mag;
}

/**
 * First-person hands. Placed from the weapon's own grip/fore anchors so they
 * land correctly on every gun, with forearms running back toward the shoulders.
 * Third-person models skip these — the soldier rig has real arms.
 */
function addFirstPersonHands(group, ud) {
  const P = new Parts();
  const g = ud.grip.position, f = ud.fore.position;

  // ---- trigger hand: fist on the grip, knuckles over the top
  P.box('glove', 0.076, 0.098, 0.088, g.x + 0.006, g.y - 0.014, g.z + 0.014);
  for (let i = 0; i < 4; i++) {
    P.box('knuckle', 0.017, 0.030, 0.048,
      g.x - 0.024 + i * 0.017, g.y + 0.030, g.z - 0.012, 0.22);
  }
  P.box('glove', 0.030, 0.036, 0.056, g.x - 0.038, g.y + 0.010, g.z + 0.004, 0, 0, -0.45); // thumb
  // wrist -> elbow, running back and out to the shooter's right
  const wR = [g.x + 0.020, g.y - 0.055, g.z + 0.060];
  const eR = [g.x + 0.150, g.y - 0.140, g.z + 0.360];
  P.limb('glove', 0.050, 0.056, g.x + 0.008, g.y - 0.030, g.z + 0.020, wR[0], wR[1], wR[2]);
  P.limb('cuff', 0.058, 0.062, wR[0], wR[1], wR[2],
    wR[0] + (eR[0] - wR[0]) * 0.18, wR[1] + (eR[1] - wR[1]) * 0.18, wR[2] + (eR[2] - wR[2]) * 0.18);
  P.limb('sleeve', 0.062, 0.086, wR[0] + (eR[0] - wR[0]) * 0.16, wR[1] + (eR[1] - wR[1]) * 0.16,
    wR[2] + (eR[2] - wR[2]) * 0.16, eR[0], eR[1], eR[2]);

  // ---- support hand: wrapped over the handguard, forearm back to the left.
  // Skipped for one-handed weapons — a knife has nothing to support, and
  // clamping a second rifle-sized fist onto a 2 cm handle produced a block of
  // glove that hid the blade entirely.
  if (ud.oneHanded) {
    const mesh1 = new THREE.Group();
    mesh1.name = 'hands';
    P.commit(mesh1);
    group.add(mesh1);
    return mesh1;
  }
  P.box('glove', 0.082, 0.080, 0.100, f.x - 0.002, f.y - 0.008, f.z);
  for (let i = 0; i < 4; i++) {
    P.box('knuckle', 0.018, 0.052, 0.026,
      f.x - 0.026 + i * 0.018, f.y + 0.020, f.z - 0.028, -0.3);
  }
  P.box('glove', 0.030, 0.038, 0.058, f.x + 0.040, f.y + 0.004, f.z + 0.010, 0, 0, 0.45);
  const wL = [f.x - 0.045, f.y - 0.060, f.z + 0.075];
  const eL = [f.x - 0.215, f.y - 0.175, f.z + 0.470];
  P.limb('glove', 0.050, 0.056, f.x - 0.014, f.y - 0.026, f.z + 0.024, wL[0], wL[1], wL[2]);
  P.limb('cuff', 0.058, 0.062, wL[0], wL[1], wL[2],
    wL[0] + (eL[0] - wL[0]) * 0.18, wL[1] + (eL[1] - wL[1]) * 0.18, wL[2] + (eL[2] - wL[2]) * 0.18);
  P.limb('sleeve', 0.062, 0.088, wL[0] + (eL[0] - wL[0]) * 0.16, wL[1] + (eL[1] - wL[1]) * 0.16,
    wL[2] + (eL[2] - wL[2]) * 0.16, eL[0], eL[1], eL[2]);

  const mesh = new THREE.Group();
  mesh.name = 'hands';
  P.commit(mesh);
  group.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------- weapons

function buildWeaponPrototype(id, opts = {}) {
  const g = new THREE.Group();
  const P = new Parts();
  const ud = g.userData;
  ud.muzzle = new THREE.Object3D(); ud.muzzle.name = 'muzzle';
  ud.ejector = new THREE.Object3D(); ud.ejector.name = 'ejector';
  ud.grip = new THREE.Object3D(); ud.grip.name = 'grip';
  ud.fore = new THREE.Object3D(); ud.fore.name = 'fore';
  const bolt = new THREE.Group();      // reciprocating parts
  bolt.name = 'bolt';
  const BP = new Parts();

  switch (id) {
    // ---------------------------------------------------------- AR-15 family
    case 'm4a1': {
      // upper receiver with a flat-top rail, dust cover and forward assist
      P.box('steel', 0.044, 0.055, 0.30, 0, 0.028, -0.10);
      P.rail('alu', 0, 0.060, -0.14, 0.34);
      P.box('steel', 0.012, 0.028, 0.075, 0.024, 0.020, -0.03);          // dust cover
      P.box('steel', 0.016, 0.018, 0.018, 0.026, 0.038, 0.020);          // forward assist
      P.box('blued', 0.010, 0.020, 0.030, 0.026, 0.028, -0.02);          // brass deflector
      // lower receiver, mag well, trigger group
      P.box('poly', 0.040, 0.052, 0.155, 0, -0.020, -0.015);
      P.box('poly', 0.046, 0.062, 0.075, 0, -0.030, -0.075);             // mag well
      P.box('blued', 0.010, 0.024, 0.030, 0, -0.052, -0.010);            // trigger
      P.add('blued', torG(0.022, 0.004, 10), 0, -0.062, -0.006, 0, Math.PI / 2, 0);
      P.box('blued', 0.052, 0.010, 0.012, 0, -0.008, 0.008);             // selector
      P.pin('blued', 0.023, -0.010, -0.062); P.pin('blued', -0.023, -0.010, -0.062);
      // pistol grip
      P.box('poly', 0.036, 0.115, 0.055, 0, -0.088, 0.030, 0.30);
      P.box('poly', 0.038, 0.020, 0.050, 0, -0.142, 0.047, 0.30);
      // free-float handguard with rail slots and vent holes
      P.box('alu', 0.048, 0.048, 0.26, 0, 0.014, -0.36);
      P.rail('alu', 0, 0.040, -0.36, 0.24);
      P.rail('alu', 0, -0.012, -0.34, 0.16);
      for (let i = 0; i < 6; i++) {
        const z = -0.27 - i * 0.032;
        P.box('blued', 0.050, 0.014, 0.012, 0, 0.014, z);
      }
      // barrel, gas block, flash hider
      P.tube('blued', 0.0105, 0.30, 0, 0.014, -0.55);
      P.box('blued', 0.024, 0.028, 0.036, 0, 0.020, -0.49);              // gas block
      P.tube('blued', 0.004, 0.16, 0, 0.030, -0.42);                     // gas tube
      P.cone('blued', 0.016, 0.013, 0.055, 0, 0.014, -0.715);
      for (let i = 0; i < 4; i++) P.box('blued', 0.034, 0.006, 0.010, 0, 0.014, -0.70 + i * 0.012);
      // buffer tube + stock
      P.tube('alu', 0.017, 0.20, 0, 0.020, 0.14);
      P.box('poly', 0.052, 0.070, 0.115, 0, 0.008, 0.185);
      P.box('poly', 0.056, 0.090, 0.026, 0, 0.000, 0.250);               // butt pad
      P.box('poly', 0.030, 0.024, 0.070, 0, 0.052, 0.175);               // cheek riser
      P.add('alu', torG(0.014, 0.005, 8), 0.026, 0.020, 0.096, 0, Math.PI / 2, 0); // sling loop
      // charging handle rides with the bolt
      BP.box('alu', 0.070, 0.014, 0.020, 0, 0.048, 0.098);
      BP.box('alu', 0.020, 0.012, 0.045, 0, 0.048, 0.078);
      ironSights(P, -0.46, 0.06, 0.062);
      redDot(P, g, -0.055, 0.062);
      ud.muzzle.position.set(0, 0.014, -0.745);
      ud.ejector.position.set(0.032, 0.028, -0.02);
      ud.sightY = 0.084;
      ud.mag = magazine(g, { w: 0.048, h: 0.145, d: 0.078, mat: 'poly' });
      ud.mag.position.set(0, -0.052, -0.075);
      ud.grip.position.set(0, -0.105, -0.005);
      ud.fore.position.set(0, -0.030, -0.36);
      ud.boltThrow = 0.030;
      break;
    }

    case 'ak74': {
      P.box('steel', 0.046, 0.062, 0.26, 0, 0.020, -0.06);               // receiver
      P.box('steel', 0.050, 0.020, 0.27, 0, 0.052, -0.06);               // top cover
      for (let i = 0; i < 7; i++) P.box('steel', 0.052, 0.008, 0.010, 0, 0.060, -0.16 + i * 0.032);
      P.box('steel', 0.014, 0.030, 0.090, 0.026, 0.030, -0.02);          // ejection port
      P.box('wood', 0.052, 0.050, 0.20, 0, -0.004, -0.28);               // lower handguard
      P.box('wood', 0.036, 0.032, 0.155, 0, 0.052, -0.27);               // upper handguard
      P.box('steel', 0.030, 0.034, 0.040, 0, 0.044, -0.36);              // gas block
      P.box('steel', 0.026, 0.030, 0.050, 0, 0.038, -0.19);              // rear sight block
      P.tube('blued', 0.0115, 0.34, 0, 0.014, -0.50);
      P.cone('blued', 0.019, 0.017, 0.075, 0, 0.014, -0.685);            // brake
      P.box('blued', 0.040, 0.008, 0.056, 0, 0.014, -0.675);
      P.box('blued', 0.008, 0.040, 0.056, 0, 0.014, -0.675);
      P.box('poly', 0.038, 0.115, 0.055, 0, -0.090, 0.020, 0.28);        // grip
      P.box('wood', 0.048, 0.075, 0.24, 0, 0.005, 0.20, 0.05);           // fixed stock
      P.box('wood', 0.052, 0.095, 0.026, 0, -0.005, 0.315, 0.05);
      P.box('steel', 0.014, 0.048, 0.014, 0.030, 0.004, 0.010, 0, 0, 0.5); // selector lever
      P.box('blued', 0.010, 0.022, 0.028, 0, -0.046, -0.020);            // trigger
      P.add('blued', torG(0.021, 0.004, 10), 0, -0.056, -0.016, 0, Math.PI / 2, 0);
      BP.box('steel', 0.020, 0.016, 0.055, 0.030, 0.044, -0.05);         // charging handle
      ironSights(P, -0.37, -0.14, 0.070);
      ud.muzzle.position.set(0, 0.014, -0.725);
      ud.ejector.position.set(0.034, 0.030, -0.02);
      ud.sightY = 0.088;
      ud.mag = magazine(g, { w: 0.046, h: 0.135, d: 0.082, curve: 0.16, mat: 'tan' });
      ud.mag.position.set(0, -0.038, -0.115);
      ud.grip.position.set(0, -0.108, -0.005);
      ud.fore.position.set(0, -0.038, -0.30);
      ud.boltThrow = 0.034;
      break;
    }

    case 'mp5k': {
      P.box('steel', 0.040, 0.048, 0.20, 0, 0.020, -0.03);
      P.tube('steel', 0.021, 0.19, 0, 0.030, -0.05);                     // receiver tube
      P.box('steel', 0.014, 0.022, 0.060, 0.022, 0.026, -0.01);
      P.rail('alu', 0, 0.050, -0.05, 0.16, 0.032);
      P.box('poly', 0.044, 0.046, 0.115, 0, -0.008, -0.20);              // fore-end
      for (let i = 0; i < 4; i++) P.box('blued', 0.046, 0.010, 0.010, 0, -0.008, -0.17 - i * 0.026);
      P.tube('blued', 0.010, 0.11, 0, 0.014, -0.30);
      P.cone('blued', 0.014, 0.012, 0.030, 0, 0.014, -0.372);
      P.box('poly', 0.034, 0.105, 0.050, 0, -0.078, 0.045, 0.26);        // grip
      P.box('blued', 0.009, 0.020, 0.026, 0, -0.040, 0.020);
      P.add('blued', torG(0.019, 0.004, 10), 0, -0.048, 0.024, 0, Math.PI / 2, 0);
      P.box('poly', 0.048, 0.052, 0.055, 0, 0.020, 0.100);               // end cap
      P.box('alu', 0.030, 0.030, 0.16, 0, 0.030, 0.150);                 // folding stock rails
      P.box('alu', 0.050, 0.060, 0.020, 0, 0.024, 0.228);
      BP.box('alu', 0.016, 0.014, 0.048, -0.026, 0.042, -0.12);          // cocking lever
      ironSights(P, -0.26, 0.04, 0.058);
      P.add('blued', torG(0.014, 0.005, 10), 0, 0.062, 0.04, Math.PI / 2); // drum rear sight
      ud.muzzle.position.set(0, 0.014, -0.392);
      ud.ejector.position.set(0.030, 0.026, -0.01);
      ud.sightY = 0.074;
      ud.mag = magazine(g, { w: 0.040, h: 0.185, d: 0.062, curve: 0.10, mat: 'poly' });
      ud.mag.position.set(0, -0.030, -0.085);
      ud.grip.position.set(0, -0.098, 0.018);
      ud.fore.position.set(0, -0.055, -0.115);
      ud.boltThrow = 0.026;
      break;
    }

    case 'scarh': {
      P.box('tan', 0.050, 0.058, 0.30, 0, 0.024, -0.09);                 // receiver
      P.rail('alu', 0, 0.058, -0.14, 0.40);
      P.box('tan', 0.056, 0.052, 0.24, 0, 0.010, -0.34);                 // handguard
      P.rail('alu', 0.030, 0.012, -0.34, 0.20, 0.030);
      P.rail('alu', -0.030, 0.012, -0.34, 0.20, 0.030);
      for (let i = 0; i < 5; i++) P.box('blued', 0.058, 0.012, 0.012, 0, 0.010, -0.26 - i * 0.034);
      P.tube('blued', 0.012, 0.26, 0, 0.014, -0.54);
      P.cone('blued', 0.018, 0.015, 0.060, 0, 0.014, -0.695);
      P.box('poly', 0.038, 0.115, 0.055, 0, -0.086, 0.020, 0.30);
      P.box('blued', 0.010, 0.022, 0.028, 0, -0.044, -0.006);
      P.add('blued', torG(0.021, 0.004, 10), 0, -0.054, -0.002, 0, Math.PI / 2, 0);
      P.box('tan', 0.052, 0.075, 0.22, 0, 0.012, 0.185);                 // folding stock
      P.box('tan', 0.056, 0.100, 0.026, 0, 0.004, 0.300);
      P.box('poly', 0.034, 0.028, 0.090, 0, 0.056, 0.180);               // cheek piece
      P.box('poly', 0.014, 0.075, 0.030, 0, -0.062, -0.34, 0.10);        // fore grip
      BP.box('alu', 0.018, 0.014, 0.050, -0.030, 0.040, -0.06);
      redDot(P, g, -0.06, 0.060, 0.060);
      ironSights(P, -0.40, 0.02, 0.058);
      ud.muzzle.position.set(0, 0.014, -0.73);
      ud.ejector.position.set(0.034, 0.030, -0.03);
      ud.sightY = 0.086;
      ud.mag = magazine(g, { w: 0.050, h: 0.155, d: 0.090, curve: 0.10, mat: 'poly' });
      ud.mag.position.set(0, -0.046, -0.10);
      ud.grip.position.set(0, -0.104, -0.005);
      ud.fore.position.set(0, -0.050, -0.36);
      ud.boltThrow = 0.032;
      break;
    }

    case 'spas12': {
      P.box('steel', 0.046, 0.062, 0.28, 0, 0.016, -0.08);               // receiver
      P.box('steel', 0.014, 0.030, 0.080, 0.026, 0.024, -0.02);
      P.tube('blued', 0.0205, 0.52, 0, 0.030, -0.42);                    // barrel
      P.tube('blued', 0.0165, 0.42, 0, -0.016, -0.36);                   // mag tube
      P.box('blued', 0.030, 0.052, 0.030, 0, 0.008, -0.58);              // barrel band
      P.cone('blued', 0.026, 0.023, 0.045, 0, 0.030, -0.70);             // muzzle
      P.box('poly', 0.036, 0.110, 0.052, 0, -0.078, 0.028, 0.26);        // grip
      P.box('blued', 0.010, 0.024, 0.030, 0, -0.040, 0.000);
      P.add('blued', torG(0.022, 0.004, 10), 0, -0.050, 0.004, 0, Math.PI / 2, 0);
      P.box('alu', 0.040, 0.048, 0.20, 0, 0.020, 0.180);                 // folding stock
      P.box('alu', 0.060, 0.075, 0.022, 0, 0.020, 0.290);
      ironSights(P, -0.60, -0.02, 0.078);
      // the pump rides on its own group
      BP.box('poly', 0.062, 0.050, 0.155, 0, -0.006, -0.34);
      for (let i = 0; i < 6; i++) BP.box('blued', 0.064, 0.010, 0.010, 0, -0.006, -0.28 - i * 0.022);
      ud.muzzle.position.set(0, 0.030, -0.735);
      ud.ejector.position.set(0.034, 0.026, -0.03);
      ud.sightY = 0.090;
      ud.grip.position.set(0, -0.098, 0.005);
      ud.fore.position.set(0, -0.048, -0.34);
      ud.pumpThrow = 0.075;
      break;
    }

    case 'awm': {
      P.box('steel', 0.046, 0.056, 0.34, 0, 0.026, -0.06);               // action
      P.box('tan', 0.086, 0.100, 0.62, 0, -0.030, -0.10);                // chassis
      P.box('tan', 0.052, 0.060, 0.32, 0, 0.006, -0.44);                 // fore-end
      for (let i = 0; i < 5; i++) P.box('blued', 0.054, 0.012, 0.014, 0, 0.006, -0.36 - i * 0.040);
      P.rail('alu', 0, 0.058, -0.10, 0.30);
      P.tube('blued', 0.0135, 0.60, 0, 0.018, -0.60);                    // heavy barrel
      for (let i = 0; i < 8; i++) P.box('blued', 0.030, 0.006, 0.012, 0, 0.018, -0.42 - i * 0.030); // flutes
      P.cone('blued', 0.020, 0.017, 0.075, 0, 0.018, -0.93);             // brake
      for (let i = 0; i < 3; i++) P.box('blued', 0.042, 0.008, 0.012, 0, 0.018, -0.91 + i * 0.016);
      P.box('tan', 0.038, 0.120, 0.055, 0, -0.096, 0.030, 0.26);         // grip
      P.box('blued', 0.010, 0.024, 0.028, 0, -0.048, 0.004);
      P.add('blued', torG(0.022, 0.004, 10), 0, -0.058, 0.008, 0, Math.PI / 2, 0);
      P.box('tan', 0.070, 0.105, 0.28, 0, -0.010, 0.240, 0.03);          // stock
      P.box('poly', 0.040, 0.032, 0.110, 0, 0.062, 0.220);               // cheek rest
      P.box('blued', 0.074, 0.026, 0.026, 0, -0.055, 0.360);             // monopod
      // scope: tube, bells, turrets, mounts
      P.tube('blued', 0.021, 0.30, 0, 0.112, -0.10, 14);
      P.cone('blued', 0.032, 0.026, 0.085, 0, 0.112, -0.29, 14);
      P.cone('blued', 0.030, 0.024, 0.070, 0, 0.112, 0.075, 14);
      P.box('blued', 0.030, 0.028, 0.030, 0, 0.146, -0.10);              // elevation turret
      P.box('blued', 0.028, 0.030, 0.028, 0.030, 0.112, -0.10);          // windage turret
      P.box('alu', 0.036, 0.052, 0.028, 0, 0.082, -0.20);
      P.box('alu', 0.036, 0.052, 0.028, 0, 0.082, 0.010);
      {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16), mats().glass);
        lens.position.set(0, 0.112, -0.3325);
        g.add(lens);
      }
      // bipod
      P.box('blued', 0.012, 0.14, 0.012, -0.048, -0.135, -0.52, 0, 0, -0.32);
      P.box('blued', 0.012, 0.14, 0.012, 0.048, -0.135, -0.52, 0, 0, 0.32);
      P.box('blued', 0.028, 0.014, 0.030, 0, -0.072, -0.52);
      BP.box('steel', 0.016, 0.016, 0.070, 0.030, 0.036, 0.010);         // bolt body
      BP.add('steel', sphG(0.014, 8), 0.052, 0.030, 0.038);              // bolt knob
      ud.muzzle.position.set(0, 0.018, -0.975);
      ud.ejector.position.set(0.034, 0.034, 0.0);
      ud.sightY = 0.112;
      ud.mag = magazine(g, { w: 0.046, h: 0.090, d: 0.085, mat: 'blued' });
      ud.mag.position.set(0, -0.070, -0.155);
      ud.grip.position.set(0, -0.112, 0.008);
      ud.fore.position.set(0, -0.070, -0.44);
      ud.boltThrow = 0.055;
      break;
    }

    // ------------------------------------------------------------- sidearms
    case 'g18': {
      BP.box('poly', 0.030, 0.048, 0.185, 0, 0.006, -0.03);              // slide
      BP.box('blued', 0.032, 0.010, 0.180, 0, 0.028, -0.03);
      for (let i = 0; i < 6; i++) BP.box('blued', 0.033, 0.020, 0.006, 0, 0.004, 0.030 - i * 0.011);
      BP.box('blued', 0.010, 0.014, 0.030, 0.016, 0.014, -0.02);         // ejection port
      BP.box('blued', 0.006, 0.008, 0.006, 0, 0.032, -0.112);            // front sight
      BP.box('blued', 0.022, 0.009, 0.008, 0, 0.032, 0.050);             // rear sight
      P.box('poly', 0.028, 0.030, 0.150, 0, -0.030, -0.010);             // frame
      P.rail('alu', 0, -0.046, -0.070, 0.048, 0.024);                    // accessory rail
      P.box('poly', 0.030, 0.115, 0.048, 0, -0.100, 0.048, 0.22);        // grip
      for (let i = 0; i < 4; i++) P.box('blued', 0.031, 0.008, 0.036, 0, -0.070 - i * 0.020, 0.038 + i * 0.008, 0.22);
      P.box('blued', 0.008, 0.020, 0.020, 0, -0.046, 0.012);             // trigger
      P.add('blued', torG(0.019, 0.0035, 10), 0, -0.054, 0.016, 0, Math.PI / 2, 0);
      P.tube('blued', 0.0075, 0.030, 0, 0.006, -0.132);
      ud.muzzle.position.set(0, 0.006, -0.148);
      ud.ejector.position.set(0.022, 0.016, -0.02);
      ud.sightY = 0.038;
      ud.mag = magazine(g, { w: 0.026, h: 0.140, d: 0.042, mat: 'blued' });
      ud.mag.position.set(0, -0.075, 0.040);
      ud.grip.position.set(0, -0.120, 0.052);
      ud.fore.position.set(-0.045, -0.100, 0.020);
      ud.boltThrow = 0.028;
      break;
    }

    case 'deagle': {
      BP.box('alu', 0.034, 0.056, 0.235, 0, 0.010, -0.05);               // slide
      BP.box('alu', 0.020, 0.014, 0.230, 0, 0.040, -0.05);               // top rib
      for (let i = 0; i < 9; i++) BP.box('blued', 0.021, 0.016, 0.005, 0, 0.046, -0.14 + i * 0.020);
      BP.box('blued', 0.012, 0.018, 0.040, 0.019, 0.018, -0.03);
      BP.box('blued', 0.007, 0.010, 0.007, 0, 0.048, -0.158);
      BP.box('blued', 0.024, 0.010, 0.009, 0, 0.048, 0.052);
      P.box('blued', 0.032, 0.034, 0.170, 0, -0.030, -0.020);            // frame
      P.box('poly', 0.034, 0.130, 0.055, 0, -0.108, 0.052, 0.20);        // grip
      P.box('blued', 0.009, 0.022, 0.022, 0, -0.048, 0.010);
      P.add('blued', torG(0.021, 0.004, 10), 0, -0.058, 0.014, 0, Math.PI / 2, 0);
      P.tube('blued', 0.010, 0.040, 0, 0.010, -0.175);
      P.box('alu', 0.014, 0.016, 0.030, 0.020, 0.000, 0.040);            // safety
      ud.muzzle.position.set(0, 0.010, -0.198);
      ud.ejector.position.set(0.024, 0.020, -0.02);
      ud.sightY = 0.048;
      ud.mag = magazine(g, { w: 0.030, h: 0.100, d: 0.050, mat: 'blued' });
      ud.mag.position.set(0, -0.078, 0.048);
      ud.grip.position.set(0, -0.128, 0.056);
      ud.fore.position.set(-0.048, -0.104, 0.024);
      ud.boltThrow = 0.034;
      break;
    }

    // A drop-point fighting knife. Held blade-forward and canted, so at first
    // person you read the edge and the point rather than a flat grey sliver.
    case 'knife': {
      // blade: a spine that tapers to the point, with a bevelled edge below it
      // and a short fuller, all in bright steel so it separates from the grip
      P.box('alu', 0.006, 0.019, 0.150, 0, 0.007, -0.115);               // spine
      P.box('alu', 0.004, 0.013, 0.125, 0, -0.006, -0.102);              // edge bevel
      P.box('blued', 0.0035, 0.005, 0.090, 0, 0.008, -0.100);            // fuller
      P.box('alu', 0.005, 0.015, 0.045, 0, 0.004, -0.204, 0.10);         // drop point
      P.cone('alu', 0.0015, 0.008, 0.030, 0, 0.000, -0.236, 6);          // tip
      // serrations along the spine, near the guard
      for (let i = 0; i < 5; i++) P.box('blued', 0.007, 0.005, 0.008, 0, 0.017, -0.055 - i * 0.014);
      // guard + ricasso
      P.box('steel', 0.034, 0.010, 0.014, 0, 0.004, -0.030);
      P.box('steel', 0.010, 0.024, 0.020, 0, 0.004, -0.020);
      // grip: stacked scales with a finger groove, then a pommel
      P.box('poly', 0.020, 0.030, 0.090, 0, 0.000, 0.030, -0.06);
      for (let i = 0; i < 5; i++) P.box('knuckle', 0.021, 0.006, 0.009, 0, -0.012 + i * 0.001, 0.002 + i * 0.018, -0.06);
      P.box('steel', 0.016, 0.020, 0.014, 0, 0.004, 0.082, -0.06);       // pommel
      P.add('steel', torG(0.006, 0.002, 8), 0, 0.004, 0.092, 0, Math.PI / 2, 0); // lanyard loop
      P.pin('steel', 0, 0.000, 0.020, 0.004);
      P.pin('steel', 0, 0.000, 0.055, 0.004);
      // No muzzle or ejection port on a knife; the anchors still have to exist
      // because the shared view-model code reads them unconditionally.
      ud.muzzle.position.set(0, 0, -0.24);
      ud.sightY = 0;
      ud.grip.position.set(0, -0.014, 0.040);
      ud.fore.position.set(-0.030, -0.030, -0.020);
      ud.oneHanded = true;
      // A knife is a fraction of a rifle's length, so at the shared view-model
      // scale it reads as a splinter. These two put it on screen at the size a
      // blade actually occupies when you are holding one.
      ud.vmScaleMult = 1.42;
      // Canted across the view so the profile of the blade is visible. Pointed
      // straight down -Z the camera sees a 6 mm edge and nothing else.
      ud.restRot = [0.10, 0.62, -0.30];
      break;
    }

    case 'grenade': {
      P.add('poly', sphG(0.036, 12), 0, 0, 0);
      for (let i = 0; i < 4; i++)
        P.add('poly', torG(0.036, 0.004, 12), 0, -0.012 + i * 0.008, 0, Math.PI / 2);
      P.box('alu', 0.016, 0.022, 0.016, 0, 0.044, 0);                    // fuse assembly
      P.box('alu', 0.008, 0.070, 0.010, 0.016, 0.020, 0, 0, 0, 0.06);    // spoon
      P.add('alu', torG(0.011, 0.0025, 10), -0.014, 0.048, 0, 0, 0, Math.PI / 2); // pin ring
      ud.muzzle.position.set(0, 0, 0);
      ud.sightY = 0;
      ud.grip.position.set(0, -0.030, 0.020);
      ud.fore.position.set(-0.070, -0.070, -0.010);
      break;
    }
  }

  P.commit(g);
  BP.commit(bolt);
  g.add(bolt);
  ud.bolt = bolt;
  g.add(ud.muzzle); g.add(ud.ejector); g.add(ud.grip); g.add(ud.fore);

  if (opts.hands) ud.hands = addFirstPersonHands(g, ud);

  g.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 10; } });
  return g;
}


// ---------------------------------------------------------------- instancing

/**
 * Prototype cache. Building a weapon merges a dozen geometries; doing that per
 * bot and per loadout change leaked hundreds of GPU buffers across a session.
 * Object3D.clone() shares geometry and material, so every instance is nearly
 * free — only the named anchors need re-resolving, because clone() copies
 * userData shallowly and would otherwise point every instance at the
 * prototype's objects.
 */
const PROTO = new Map();

export function buildWeaponModel(id, opts = {}) {
  const key = `${id}|${opts.hands ? 'h' : ''}`;
  let proto = PROTO.get(key);
  if (!proto) PROTO.set(key, proto = buildWeaponPrototype(id, opts));

  const g = proto.clone(true);
  const ud = g.userData = { ...proto.userData };
  ud.muzzle = g.getObjectByName('muzzle');
  ud.ejector = g.getObjectByName('ejector');
  ud.grip = g.getObjectByName('grip');
  ud.fore = g.getObjectByName('fore');
  ud.bolt = g.getObjectByName('bolt');
  ud.mag = g.getObjectByName('mag') || null;
  delete ud.magY;                       // per-instance animation state
  return g;
}
