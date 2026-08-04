// RED MESA — a desert canyon under a hard midday sun.
//
// Terrain identity: dunes, not drifts. A dry riverbed (the wadi) snakes west
// to east across the middle — sunken ground you can move through unseen but
// where you fight uphill to get out. Two flat-topped mesas overlook it from
// opposite corners; whoever holds a mesa top owns the wadi below. A small
// adobe village sits in the centre where the two mesa shadows cross.
//
// Palette and light are the opposite of Cold Harbor: white-hot sun almost
// overhead, short shadows, thin dusty haze, everything warm.
import * as THREE from 'three';
import { MapBuilder, crateStack, truck } from '../builder.js';
import { skyMaterial } from '../textures.js';

const R = 54;

// ---------------------------------------------------------------- heightfield

/** Deterministic value noise, same construction as Cold Harbor's. */
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const x1 = grad(aa, xf, yf) * (1 - u) + grad(ba, xf - 1, yf) * u;
    const x2 = grad(ab, xf, yf - 1) * (1 - u) + grad(bb, xf - 1, yf - 1) * u;
    return (x1 * (1 - v) + x2 * v) * 0.7;
  };
}

const noise = makeNoise(19870411);

const smooth = (a, b, t) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** A flat-topped mesa: full height inside rTop, long gentle skirt outside.
 *  The skirt is 16 m for ~6 m of height — under the 0.52 grade the nav grid
 *  can connect, so bots can walk up any face, not just the stairs. */
function mesaBump(x, z, cx, cz, rTop, h) {
  const d = Math.hypot(x - cx, z - cz);
  return h * (1 - smooth(rTop, rTop + 16, d));
}

/**
 * Terrain height. Pure function shared by physics, navmesh and the mesh —
 * see the note in coldharbor.js for why this must never be a baked grid.
 */
export function heightAt(x, z) {
  let h = 0;
  h += noise(x * 0.020, z * 0.020) * 3.4;      // broad dune rolls
  h += noise(x * 0.052, z * 0.052) * 1.3;      // ripples
  h += noise(x * 0.13, z * 0.13) * 0.4;        // surface grain

  // the two mesas, opposite corners
  const m1 = mesaBump(x, z, -28, -24, 8, 6.2);
  const m2 = mesaBump(x, z, 30, 26, 8, 5.6);
  // damp the dunes on the mesa tops so they stay usable firing platforms
  const mesaT = Math.max(m1 / 6.2, m2 / 5.6);
  h = h * (1 - mesaT * 0.75) + m1 + m2;

  // the wadi: a dry riverbed snaking west-east across the middle.
  // Gentle banks on purpose — a sharp rim strands the navmesh (see coldharbor).
  const c = 7 * Math.sin(x * 0.045) + 3 * Math.sin(x * 0.11 + 1.7);
  const d = z - c;
  const wadi = Math.exp(-(d * d) / 130);
  h = h * (1 - wadi * 0.6) - wadi * 2.6;

  // flat pads under the built areas
  for (const [px, pz, pr, ph] of PADS) {
    const dd = Math.hypot(x - px, z - pz);
    if (dd < pr + 4) {
      const t = 1 - Math.min(1, Math.max(0, (dd - pr) / 4));
      h = h * (1 - t) + ph * t;
    }
  }
  return h;
}

// pads: [x, z, radius, height]
const PADS = [
  [0, -16, 12, 1.6],       // village, north bank of the wadi
  [-6, 20, 9, 1.2],        // fuel stop, south bank
  [34, -18, 8, 1.4],       // ruin, east
  [-34, 22, 8, 1.0],       // ruin, west
  [-28, -24, 7, 6.4],      // NW mesa top
  [30, 26, 7, 5.8],        // SE mesa top
];

export const INFO = {
  name: 'RED MESA',
  bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R },
  nav: { minX: -R, maxX: R, minZ: -R, maxZ: R, cell: 1.2 },
  spawns: {
    // both teams start in open dunes, diagonal from each other, off the wadi
    blue: [[-44, -38], [-38, -44], [-48, -30], [-30, -46], [-46, -44], [-40, -30]],
    red: [[44, 38], [38, 44], [48, 30], [30, 46], [46, 44], [40, 30]],
  },
  hotspots: [
    [0, -16], [-6, 20], [0, 2],                 // village, fuel stop, wadi centre
    [34, -18], [-34, 22],                       // the ruins
    [-20, -4], [22, 8], [-40, 6], [44, -6],     // wadi bends and open dunes
    [0, 40], [0, -42],
    [-28, -24, 6.5], [30, 26, 5.9],             // mesa tops
    [-28, -24, 11.6],                           // NW watchtower platform
    [4, -13, 5.3], [-7, -19, 5.0],              // village roofs
    [-6, 20, 4.6],                              // fuel stop canopy
  ],
};

export function build(scene, physics) {
  const B = new MapBuilder(scene, physics);
  // high sun, but tilted enough to rake the dunes — straight overhead left the
  // terrain shadowless and the whole map read as one flat white sheet
  const sunDir = new THREE.Vector3(0.48, 0.60, 0.34).normalize();

  // ---------------------------------------------------------------- sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 72, 44), skyMaterial(sunDir));
  sky.matrixAutoUpdate = false;
  sky.frustumCulled = false;
  scene.add(sky);
  // thin heat haze, warm — legibility first, same rule as Cold Harbor's fog fix
  scene.fog = new THREE.FogExp2(0xd8c09a, 0.0052);

  const sun = new THREE.DirectionalLight(0xfff2d8, 4.0);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // re-centred on the player per frame (Game.update), so keep the box tight
  sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  // sand bounces warm light into shadows; keep ambient below the sun so
  // terrain relief still reads (the Cold Harbor flatness lesson)
  const hemi = new THREE.HemisphereLight(0x9ec4e8, 0xb08c55, 1.0);
  scene.add(hemi);
  const bounce = new THREE.DirectionalLight(0xffd9a0, 0.4);
  bounce.position.set(-0.4, -0.5, -0.6).multiplyScalar(60);
  scene.add(bounce);

  // ---------------------------------------------------------------- terrain
  physics.setTerrain({
    heightAt, minX: -R - 40, maxX: R + 40, minZ: -R - 40, maxZ: R + 40, surface: 'sand',
  });
  const terrainMesh = buildTerrainMesh();
  scene.add(terrainMesh);

  village(B);
  fuelStop(B);
  mesaTops(B);
  ruins(B);
  wadiProps(B);
  scatter(B);

  const meshes = B.commit();
  meshes.push(terrainMesh);
  physics.build();
  return { sun, hemi, sky, meshes, sunDir, stairRuns: B.stairRuns || [] };
}

/** Displaced grid coloured by slope and height: sand, red rock, wadi gravel. */
function buildTerrainMesh() {
  const N = 200, SIZE = (R + 40) * 2;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const col = new Float32Array(pos.count * 3);
  const nrm = geo.attributes.normal;
  // Colours run darker than the real-world sand you would pick from a swatch:
  // under a 4.0 sun plus warm hemisphere the first attempt (0xd9b886) blew out
  // to plain white and the map lost all its relief.
  const sand = new THREE.Color(0xbf9c62), redrock = new THREE.Color(0x8e4630);
  const gravel = new THREE.Color(0x8a765a), bleached = new THREE.Color(0xcdb17c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const slope = 1 - nrm.getY(i);
    const y = pos.getY(i);
    c.copy(sand);
    if (y < -0.8) c.lerp(gravel, Math.min(1, (-0.8 - y) / 1.4));       // wadi floor
    if (y > 4.0) c.lerp(bleached, Math.min(1, (y - 4.0) / 2.5) * 0.6); // mesa tops
    if (slope > 0.18) c.lerp(redrock, Math.min(1, (slope - 0.18) / 0.26));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ---------------------------------------------------------------------------

/** Adobe house: thick plaster walls, flat roof with parapet, external stair.
 *  Same reachability rules as the Cold Harbor hut: floor slab, doors on two
 *  faces, stair arriving at a parapet gap. */
function adobe(B, cx, cz, w, d, h, seed) {
  const y = heightAt(cx, cz);
  const hw = w / 2, hd = d / 2;
  const door = (at) => ({ at, w: 2.0, y0: 0, y1: 2.3 });
  const win = (at) => ({ at, w: 1.4, y0: 1.2, y1: 2.3 });
  const O = { seed, scale: 2.5, base: y, tint: 0xc8a578 };

  B.box('concrete', { x: cx, y: y - 0.22, z: cz, w: w + 0.5, h: 0.28, d: d + 0.5, tint: 0xb0906a, seed: seed + 9, scale: 3 });
  B.wall('plaster', cx - hw, cz - hd, cx + hw, cz - hd, h, 0.42, [door(w * 0.5)], O);
  B.wall('plaster', cx - hw, cz + hd, cx + hw, cz + hd, h, 0.42, [door(w * 0.5)], O);
  B.wall('plaster', cx - hw, cz - hd, cx - hw, cz + hd, h, 0.42, [win(d * 0.3), win(d * 0.7)], O);
  B.wall('plaster', cx + hw, cz - hd, cx + hw, cz + hd, h, 0.42, [win(d * 0.3), win(d * 0.7)], O);
  B.box('concrete', { x: cx, y: y + h, z: cz, w: w + 0.6, h: 0.28, d: d + 0.6, tint: 0xbd9c74, seed: seed + 1, scale: 3 });
  // parapet, gap on the +x face where the stair arrives
  for (const [x1, z1, x2, z2] of [[cx - hw, cz - hd, cx + hw, cz - hd], [cx + hw, cz + hd, cx - hw, cz + hd],
                                  [cx - hw, cz + hd, cx - hw, cz - hd]])
    B.wall('plaster', x1, z1, x2, z2, 0.85, 0.3, [], { seed: seed + 2, base: y + h + 0.28, tint: 0xbd9c74 });
  B.wall('plaster', cx + hw, cz - hd, cx + hw, cz + hd, 0.85, 0.3,
    [{ at: d * 0.5 - 1.6, w: 3.2, y0: 0, y1: 0.85 }], { seed: seed + 3, base: y + h + 0.28, tint: 0xbd9c74 });
  const steps = Math.max(6, Math.round((h + 0.28) / 0.34));
  B.stairs('wood', cx + hw + 0.9 + steps * 0.4, y, cz, '-x', steps, (h + 0.28) / steps, 0.4, 2.8);
  // interior cover
  B.box('crate', { x: cx - w * 0.26, y, z: cz + d * 0.22, w: 1.3, h: 1.3, d: 1.3, seed: seed + 4, scale: 1.5 });
  B.box('wood', { x: cx + w * 0.24, y, z: cz - d * 0.2, w: 1.8, h: 0.8, d: 1.0, seed: seed + 5, scale: 1.4 });
}

/** The village: three adobe houses around a well, market awnings, low walls. */
function village(B) {
  adobe(B, 4, -13, 10, 8, 3.4, 600);
  adobe(B, -7, -19, 9, 8, 3.2, 620);
  adobe(B, 3, -23, 8, 7, 3.0, 640);

  const y0 = heightAt(-2, -13);
  // the well — hard round cover in the middle of the village square
  B.cyl('brick', { x: -2, y: y0, z: -12, r: 1.5, h: 1.0, seg: 14, tint: 0xb08a60, seed: 660 });
  for (const sx of [-1, 1])
    B.box('wood', { x: -2 + sx * 1.3, y: y0 + 1.0, z: -12, w: 0.18, h: 1.6, d: 0.18, tint: 0x6a5138, seed: 661, collide: false });
  B.box('wood', { x: -2, y: y0 + 2.5, z: -12, w: 3.2, h: 0.14, d: 1.2, tint: 0x6a5138, seed: 662, collide: false });

  // market stalls: wood counters under cloth awnings (soft cover)
  const stall = (x, z, yaw, color, seed) => {
    const y = heightAt(x, z);
    B.box('wood', { x, y, z, w: 2.4, h: 0.95, d: 1.3, yaw, seed, scale: 1.2 });
    for (const s of [-1, 1])
      B.box('wood', { x: x + Math.cos(yaw) * 1.05 * s, y: y + 0.95, z: z + Math.sin(yaw) * 1.05 * s, w: 0.1, h: 1.5, d: 0.1, yaw, seed, collide: false });
    B.box('sandbag', { x, y: y + 2.4, z, w: 3.0, h: 0.08, d: 1.9, yaw, tint: color, seed: seed + 1, scale: 1.2, collide: false });
  };
  stall(-4, -7, 0.2, 0xc05a38, 670);
  stall(1, -6, -0.15, 0x3f7a95, 673);
  stall(8, -19, 1.5, 0xc9a63e, 676);

  // low mud-brick walls giving cover on the village edges
  for (const [x, z, yaw] of [[-10, -10, 0.3], [10, -8, -0.2], [-3, -28, 0], [11, -25, 1.4]]) {
    B.box('brick', { x, y: heightAt(x, z), z, w: 5.5, h: 1.25, d: 0.6, yaw, seed: 680, scale: 2, tint: 0xb5906a });
  }
  crateStack(B, -9, -25, 3, 690);
}

/** The fuel stop, south of the wadi: pumps, a canopy you can climb, a truck. */
function fuelStop(B) {
  const y = heightAt(-6, 20);
  // kiosk
  const O = { seed: 700, scale: 2.5, base: y, tint: 0xcac0b0 };
  B.wall('plaster', -11, 16, -3, 16, 3.0, 0.35, [{ at: 3, w: 2.0, y0: 0, y1: 2.3 }], O);
  B.wall('plaster', -11, 24, -3, 24, 3.0, 0.35, [{ at: 3, w: 1.6, y0: 1.0, y1: 2.3 }], O);
  B.wall('plaster', -11, 16, -11, 24, 3.0, 0.35, [{ at: 3, w: 1.6, y0: 1.0, y1: 2.3 }], O);
  B.wall('plaster', -3, 16, -3, 24, 3.0, 0.35, [{ at: 3, w: 2.0, y0: 0, y1: 2.3 }], O);
  B.box('concrete', { x: -7, y: y + 3.0, z: 20, w: 8.6, h: 0.25, d: 8.6, tint: 0xb8ae9e, seed: 701, scale: 3 });
  // parapet with a stair gap
  for (const [x1, z1, x2, z2] of [[-11, 16, -3, 16], [-3, 24, -11, 24], [-11, 24, -11, 16]])
    B.wall('concrete', x1, z1, x2, z2, 0.8, 0.25, [], { seed: 702, base: y + 3.25, tint: 0xb0a696 });
  B.wall('concrete', -3, 16, -3, 24, 0.8, 0.25, [{ at: 2.4, w: 3.2, y0: 0, y1: 0.8 }], { seed: 703, base: y + 3.25, tint: 0xb0a696 });
  const steps = 10;
  B.stairs('metal', -2.1 + steps * 0.4, y, 20, '-x', steps, 3.25 / steps, 0.4, 2.8);

  // pump island + high canopy (visual roof, held up by posts)
  B.box('concrete', { x: 3, y, z: 20, w: 1.6, h: 0.22, d: 6.5, tint: 0xb8b0a0, seed: 704 });
  for (const oz of [-2, 2])
    B.box('metal', { x: 3, y: y + 0.22, z: 20 + oz, w: 0.9, h: 1.9, d: 0.7, tint: 0x9a3a2a, seed: 705, scale: 1.2 });
  for (const [ox, oz] of [[1.4, -2.6], [4.6, -2.6], [1.4, 2.6], [4.6, 2.6]])
    B.box('metal', { x: 3 + ox - 3, y, z: 20 + oz, w: 0.25, h: 4.6, d: 0.25, tint: 0x8a8078, seed: 706 });
  B.box('metal', { x: 3, y: y + 4.6, z: 20, w: 7.5, h: 0.2, d: 8.5, tint: 0xc0b8a8, seed: 707, walkable: true });

  truck(B, 8, 27, 2.6);
  for (let i = 0; i < 5; i++)
    B.cyl('metal', { x: -12 + i * 1.1, y: heightAt(-12 + i * 1.1, 27), z: 27, r: 0.44, h: 1.1, seg: 10, tint: [0x9a3a2a, 0x7a6a2a, 0x4a4a4c][i % 3], seed: 710 + i });
}

/** Mesa tops: a watchtower on the NW mesa, sandbag ring on the SE one. */
function mesaTops(B) {
  // NW mesa: wooden watchtower — the map's highest position
  const y1 = heightAt(-28, -24);
  for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]])
    B.box('wood', { x: -28 + ox, y: y1, z: -24 + oz, w: 0.35, h: 5.0, d: 0.35, tint: 0x7a5f42, seed: 720 });
  B.box('wood', { x: -28, y: y1 + 5.0, z: -24, w: 5.6, h: 0.22, d: 5.6, tint: 0x8a6f50, seed: 721, scale: 2 });
  for (const [x1, z1, x2, z2] of [[-30.8, -26.8, -25.2, -26.8], [-25.2, -26.8, -25.2, -21.2],
                                  [-25.2, -21.2, -30.8, -21.2]])
    B.wall('wood', x1, z1, x2, z2, 1.0, 0.12, [], { seed: 722, base: y1 + 5.22, opaque: false, tint: 0x7a5f42 });
  B.wall('wood', -30.8, -21.2, -30.8, -26.8, 1.0, 0.12,
    [{ at: 1.6, w: 2.4, y0: 0, y1: 1.0 }], { seed: 723, base: y1 + 5.22, opaque: false, tint: 0x7a5f42 });
  // two-flight stair to the platform
  B.stairs('wood', -35.4, y1, -24, '+x', 8, 0.33, 0.4, 2.6);
  B.box('wood', { x: -30.9, y: y1 + 2.64, z: -24, w: 1.6, h: 0.2, d: 2.6, tint: 0x8a6f50, seed: 724 });
  B.stairs('wood', -30.6, y1 + 2.84, -24.9, '-z', 7, 0.34, 0.4, 2.2);
  // sandbags on the mesa lip facing the wadi
  for (let i = -3; i <= 3; i++)
    B.box('sandbag', { x: -24 + i * 0.62, y: y1, z: -18.5, w: 0.66, h: 0.35, d: 0.42, yaw: (i % 2) * 0.1, seed: 726, scale: 0.8 });

  // SE mesa: dug-in ring, no tower — lower but closer to the village
  const y2 = heightAt(30, 26);
  for (const [sx, sz, yaw] of [[30, 20.5, 0], [24.5, 26, Math.PI / 2], [30, 31.5, 0]]) {
    for (let r = 0; r < 2; r++) for (let i = -2; i <= 2; i++)
      B.box('sandbag', {
        x: sx + Math.cos(yaw) * i * 0.62, y: y2 + r * 0.34, z: sz + Math.sin(yaw) * i * 0.62,
        w: 0.66, h: 0.35, d: 0.42, yaw: yaw + (i % 2) * 0.1, seed: 730 + r, scale: 0.8,
      });
  }
  crateStack(B, 32, 24, 2, 734);
}

/** Two half-collapsed ruins east and west — waypoints on the long flanks. */
function ruins(B) {
  const ruin = (cx, cz, seed) => {
    const y = heightAt(cx, cz);
    const O = { seed, scale: 2.5, base: y, tint: 0xbb9770 };
    // three walls of varying height, no roof
    B.wall('brick', cx - 4, cz - 3.5, cx + 4, cz - 3.5, 2.8, 0.45, [{ at: 3, w: 2.0, y0: 0, y1: 2.2 }], O);
    B.wall('brick', cx - 4, cz - 3.5, cx - 4, cz + 3.5, 2.2, 0.45, [{ at: 2.2, w: 1.4, y0: 0.9, y1: 2.0 }], O);
    B.wall('brick', cx - 4, cz + 3.5, cx + 4, cz + 3.5, 1.4, 0.45, [], O);
    // rubble
    for (let i = 0; i < 5; i++) {
      B.box('concrete', {
        x: cx + 2 + (i % 3) * 0.9, y, z: cz + 1 - i * 0.8, w: 1.0 + (i % 2) * 0.5,
        h: 0.4 + (i % 3) * 0.25, d: 0.9, yaw: i * 0.7, seed: seed + 10 + i, scale: 1.4, tint: 0xb09272,
      });
    }
  };
  ruin(34, -18, 740);
  ruin(-34, 22, 760);
}

/** Inside the wadi: boulders and a wrecked flatbed to break the channel up. */
function wadiProps(B) {
  const rock = (x, z, sc, seed) => {
    const y = heightAt(x, z);
    B.box('concrete', { x, y: y - sc * 0.3, z, w: sc * 1.8, h: sc * 1.4, d: sc * 1.5, yaw: seed * 0.7, tint: 0x96604a, seed, scale: 2 });
  };
  rock(-14, -2, 1.6, 780); rock(-12, 0.5, 1.1, 781);
  rock(16, 7, 1.8, 782); rock(18.5, 5.5, 1.2, 783);
  rock(-38, 2, 1.5, 784); rock(40, -3, 1.7, 785);
  rock(2, 2, 1.3, 786);
  truck(B, 28, 10, 0.9);
}

/** Rock spires and dry scrub across the open dunes. */
function scatter(B) {
  let s = 800;
  const rnd = (() => { let v = 24681357; return () => { v = (v * 1103515245 + 12345) & 0x7fffffff; return v / 0x7fffffff; }; })();

  for (let i = 0; i < 22; i++) {
    const a = rnd() * 6.283, r = 16 + rnd() * 34;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // keep the built pads clear
    if (PADS.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr + 3)) continue;
    const y = heightAt(x, z);
    const sc = 0.8 + rnd() * 2.0;
    B.box('concrete', {
      x, y: y - sc * 0.3, z, w: sc * 1.7, h: sc * 1.6, d: sc * 1.5,
      yaw: rnd() * 3.14, tint: 0x9e6248, seed: s++, scale: 2,
    });
    if (rnd() > 0.55) {
      B.box('concrete', {
        x: x + sc * 0.6, y: y - 0.2, z: z + sc * 0.5, w: sc, h: sc * 2.2, d: sc * 0.9,
        yaw: rnd() * 3.14, tint: 0xa86c50, seed: s++, scale: 2,
      });
    }
  }

  // dry scrub: a stub trunk and a ragged dark-green puff, no collision
  for (let i = 0; i < 24; i++) {
    const a = rnd() * 6.283, r = 12 + rnd() * 38;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (PADS.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr + 2)) continue;
    const y = heightAt(x, z);
    B.cyl('wood', { x, y, z, r: 0.12, rTop: 0.07, h: 0.7 + rnd() * 0.5, seg: 6, tint: 0x5a4632, seed: s++, collide: false });
    B.cyl('sandbag', {
      x, y: y + 0.5, z, r: 0.8 + rnd() * 0.5, rTop: 0.2, h: 0.9 + rnd() * 0.5, seg: 7,
      tint: 0x5f6b3a, seed: s++, collide: false, scale: 1.5,
    });
  }
}
