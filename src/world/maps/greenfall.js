// GREENFALL — a highland farm valley on a bright, wet morning.
//
// Terrain identity: green rolling hills split by a shallow river running
// west-east through the middle. The river is ankle-deep and crossable
// anywhere, but the banks drop you below the grass line — crossing is the
// exposed move, and the wooden bridge in the centre is the fast, obvious,
// contested one. A farm compound holds the north slope, a stone ruin the
// south, and hedgerows and stone field walls carve the open grass into lanes.
//
// Light is low morning sun from the east with a cool green bounce — different
// hour and palette from District 7's amber afternoon and Mesa's noon glare.
import * as THREE from 'three';
import { MapBuilder, crateStack, car } from '../builder.js';
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

const noise = makeNoise(20010915);

/** Centreline of the river: z as a function of x. Shared by heightAt, the
 *  water mesh and the bridge placement so all three stay in agreement. */
function riverZ(x) {
  return 5 * Math.sin(x * 0.05) + 2.5 * Math.sin(x * 0.13 + 2.1);
}

const WATER_Y = -1.05;   // water surface; river bed dips ~0.7 m below it

/**
 * Terrain height. Pure function shared by physics, navmesh and the mesh —
 * see the note in coldharbor.js for why this must never be a baked grid.
 */
export function heightAt(x, z) {
  let h = 0;
  h += noise(x * 0.017, z * 0.017) * 4.6;      // big soft hills
  h += noise(x * 0.043, z * 0.043) * 1.6;      // hummocks
  h += noise(x * 0.12, z * 0.12) * 0.4;        // turf grain

  // both far banks rise toward the map edges, cupping the valley
  h += Math.abs(z) * 0.055;

  // the river: gentle banks (nav connectivity — see coldharbor). The bed must
  // sit clearly below WATER_Y everywhere or the water plane pokes through as
  // dry mud — the first cut at -1.75 with weak damping did exactly that.
  const d = z - riverZ(x);
  const river = Math.exp(-(d * d) / 55);
  h = h * (1 - river * 0.9) - river * 2.35;

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
  [-18, -24, 13, 1.9],     // the farm: house + barn share one big pad
  [14, -30, 7, 2.3],       // windmill knoll
  [20, 26, 9, 1.6],        // stone ruin, south bank
  [-26, 28, 8, 2.0],       // orchard terrace, south-west
  [40, -8, 6, 0.9],        // east ford marker stones
];

export const INFO = {
  name: 'GREENFALL',
  bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R },
  nav: { minX: -R, maxX: R, minZ: -R, maxZ: R, cell: 1.2 },
  spawns: {
    // blue behind the farm on the north rim, red behind the ruin on the south
    blue: [[-40, -42], [-32, -46], [-46, -36], [-24, -44], [-44, -44], [-36, -38]],
    red: [[40, 42], [32, 46], [46, 36], [24, 44], [44, 44], [36, 38]],
  },
  hotspots: [
    [0, 0],                                     // the bridge
    [-18, -24], [14, -30], [20, 26], [-26, 28], // farm, windmill, ruin, orchard
    [-40, 4], [42, -4],                         // the fords
    [-8, -12], [10, 14], [-30, 8], [34, 12],    // hedgerow lanes
    [0, -38], [0, 40],
    [-13, -20, 5.9],                            // farmhouse roofline walk
    [-24, -28, 4.8],                            // barn loft
    [14, -30, 8.0],                             // windmill balcony
    [20, 26, 4.4],                              // ruin upper floor
  ],
};

export function build(scene, physics) {
  const B = new MapBuilder(scene, physics);
  // low morning sun from the east
  const sunDir = new THREE.Vector3(0.80, 0.36, 0.20).normalize();

  // ---------------------------------------------------------------- sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 72, 44), skyMaterial(sunDir));
  sky.matrixAutoUpdate = false;
  sky.frustumCulled = false;
  scene.add(sky);
  // cool damp morning haze — thin enough to read the far bank (coldharbor rule)
  scene.fog = new THREE.FogExp2(0xbccec2, 0.0060);

  const sun = new THREE.DirectionalLight(0xfff0d0, 4.1);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // re-centred on the player per frame (Game.update) — keep the box tight
  sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  // grass bounce is green and dim; sky fill is cool blue. Ambient kept under
  // the sun so the hillsides keep their lit/shadow contrast.
  const hemi = new THREE.HemisphereLight(0xa8c4e0, 0x5a7048, 1.3);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x9ab8d8, 0.35);
  fill.position.set(-0.7, 0.5, -0.4).multiplyScalar(60);
  scene.add(fill);

  // ---------------------------------------------------------------- terrain
  physics.setTerrain({
    heightAt, minX: -R - 40, maxX: R + 40, minZ: -R - 40, maxZ: R + 40, surface: 'sand',
  });
  const terrainMesh = buildTerrainMesh();
  scene.add(terrainMesh);
  const waterMesh = buildWaterMesh();
  scene.add(waterMesh);

  bridge(B);
  farm(B);
  windmill(B);
  ruin(B);
  orchard(B);
  fieldWalls(B);
  scatter(B);

  const meshes = B.commit();
  meshes.push(terrainMesh, waterMesh);
  physics.build();
  return { sun, hemi, sky, meshes, sunDir, stairRuns: B.stairRuns || [] };
}

/** Displaced grid coloured by slope and height: turf, mud banks, grey stone. */
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
  const grass = new THREE.Color(0x5f7d3c), lush = new THREE.Color(0x46683a);
  const mud = new THREE.Color(0x6e5a40), stone = new THREE.Color(0x777972);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const slope = 1 - nrm.getY(i);
    const y = pos.getY(i);
    c.copy(grass);
    // subtle patchiness so the fields aren't one flat green
    const patch = noise(pos.getX(i) * 0.06 + 9, pos.getZ(i) * 0.06 - 4);
    c.lerp(lush, Math.max(0, patch) * 0.6);
    if (y < -0.5) c.lerp(mud, Math.min(1, (-0.5 - y) / 1.0));         // river banks
    // high thresholds — see the Cold Harbor note on slope-tint creep
    if (slope > 0.28) c.lerp(stone, Math.min(1, (slope - 0.28) / 0.30));
    else if (slope > 0.17) c.lerp(mud, (slope - 0.17) / 0.11 * 0.4);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9, metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** The river surface: a ribbon of translucent water following riverZ.
 *  Visual only (no collider) — you wade the bed underneath, ankle-deep. */
function buildWaterMesh() {
  const SEGS = 60, HALF_W = 9;
  const geo = new THREE.PlaneGeometry(1, 1, SEGS, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // built as a strip in x with the two long edges at y = ±0.5
    const t = pos.getX(i) + 0.5;
    const x = -R - 8 + t * (2 * R + 16);
    const side = pos.getY(i) > 0 ? 1 : -1;
    pos.setXYZ(i, x, WATER_Y, riverZ(x) + side * HALF_W);
  }
  geo.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({
    color: 0x3e6a72, roughness: 0.15, metalness: 0.0,
    transparent: true, opacity: 0.72,
    // the strip's winding faces -Y after the remap above; double-sided is
    // cheaper to reason about than getting the vertex order right
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ---------------------------------------------------------------------------

/** The wooden bridge over the river at x = 0 — the contested centre. */
function bridge(B) {
  const zc = riverZ(0);
  const deckY = 0.55;                      // just above both banks' grass line
  // deck: walkable planks
  B.box('wood', { x: 0, y: deckY, z: zc, w: 4.2, h: 0.3, d: 10.5, tint: 0x8a6f4e, seed: 900, scale: 1.4, walkable: true });
  // approach steps anchored to the actual bank height on each side — fixed
  // slabs left a bigger-than-step-height jump onto the deck, and a stair run
  // is also what stitches the bridge into the navmesh for the bots
  for (const s of [-1, 1]) {
    const ze = zc + s * 8.4;
    const ye = heightAt(0, ze);
    const climb = (deckY + 0.3) - ye;
    const n = Math.max(3, Math.ceil(climb / 0.32));
    B.stairs('wood', 0, ye, ze, s > 0 ? '-z' : '+z', n, climb / n, Math.min(0.5, 3.1 / n), 4.0);
  }
  // rails: chest-high hard cover for anyone holding the bridge
  for (const s of [-1, 1]) {
    B.box('wood', { x: s * 2.0, y: deckY + 0.3, z: zc, w: 0.18, h: 1.0, d: 10.5, tint: 0x74593c, seed: 903 });
    for (const oz of [-5.8, 5.8])
      B.box('wood', { x: s * 2.0, y: deckY + 0.02, z: zc + oz, w: 0.22, h: 1.1, d: 0.22, tint: 0x74593c, seed: 904 });
  }
  // piers standing in the water
  for (const oz of [-2.6, 2.6]) for (const s of [-1, 1])
    B.box('wood', { x: s * 1.6, y: -2.2, z: zc + oz, w: 0.4, h: 2.8, d: 0.4, tint: 0x5f4a32, seed: 905 });
}

/** The farm: a two-storey farmhouse and an open barn with a loft. */
function farm(B) {
  const y = heightAt(-18, -24);

  // ---- farmhouse (-13,-20), stone ground floor, plaster upper, roof walk
  const H1 = 3.0, H2 = 5.6;
  const FO = { seed: 920, scale: 2.5, base: y, tint: 0x9a938a };
  const door = (at) => ({ at, w: 2.0, y0: 0, y1: 2.3 });
  const win = (at) => ({ at, w: 1.5, y0: 1.1, y1: 2.4 });
  B.wall('brick', -18, -16, -8, -16, H1, 0.4, [door(4), win(7.5)], FO);
  B.wall('brick', -18, -24, -8, -24, H1, 0.4, [win(2.5), door(6.5)], FO);
  B.wall('brick', -18, -24, -18, -16, H1, 0.4, [win(3.5)], FO);
  B.wall('brick', -8, -24, -8, -16, H1, 0.4, [win(3.5)], FO);
  // upper floor
  B.box('wood', { x: -13, y: y + H1, z: -20, w: 10.4, h: 0.25, d: 8.4, tint: 0x8a6f50, seed: 921, scale: 2, walkable: true });
  const UO = { seed: 922, scale: 2.5, base: y + H1 + 0.25, tint: 0xc8bfae };
  B.wall('plaster', -18, -16, -8, -16, H2 - H1 - 0.25, 0.35, [win(2.5), win(6.5)], UO);
  B.wall('plaster', -18, -24, -8, -24, H2 - H1 - 0.25, 0.35, [win(4.5)], UO);
  B.wall('plaster', -18, -24, -18, -16, H2 - H1 - 0.25, 0.35, [win(3.5)], UO);
  B.wall('plaster', -8, -24, -8, -16, H2 - H1 - 0.25, 0.35, [{ at: 3, w: 2.2, y0: 0, y1: 2.3 }], UO);
  // flat roof with parapet — the farm's overwatch
  B.box('wood', { x: -13, y: y + H2, z: -20, w: 10.8, h: 0.25, d: 8.8, tint: 0x7c6248, seed: 923, scale: 2, walkable: true });
  for (const [x1, z1, x2, z2] of [[-18, -16, -8, -16], [-18, -24, -8, -24], [-18, -24, -18, -16]])
    B.wall('brick', x1, z1, x2, z2, 0.8, 0.25, [], { seed: 924, base: y + H2 + 0.25, tint: 0x8f8880 });
  B.wall('brick', -8, -24, -8, -16, 0.8, 0.25, [{ at: 3, w: 2.6, y0: 0, y1: 0.8 }], { seed: 925, base: y + H2 + 0.25, tint: 0x8f8880 });
  // interior stair to the upper floor, then external stair upper -> roof
  B.stairs('wood', -16.5, y, -23.2, '+z', 9, (H1 + 0.25) / 9, 0.42, 1.6);
  B.stairs('wood', -6.9 + 9 * 0.4, y + H1 + 0.25, -18, '-x', 9, (H2 - H1) / 9, 0.4, 2.4);
  // NB the upper-floor slab needs a gap where the interior stair arrives:
  // punch it by narrowing the slab? Cheaper: the stair tops out at the slab
  // edge outside the south wall line — the slab above starts at z=-24+0.4.

  // ---- barn (-24,-28): big open wooden shell, loft over half of it
  const BO = { seed: 930, scale: 2.8, base: y, tint: 0x8a4a34 };
  B.wall('wood', -29, -32, -19, -32, 4.6, 0.3, [{ at: 3, w: 3.8, y0: 0, y1: 3.4 }], BO);
  B.wall('wood', -29, -24, -19, -24, 4.6, 0.3, [{ at: 4, w: 2.4, y0: 0, y1: 2.4 }], BO);
  B.wall('wood', -29, -32, -29, -24, 4.6, 0.3, [{ at: 3, w: 1.6, y0: 1.2, y1: 2.6 }], BO);
  B.wall('wood', -19, -32, -19, -24, 4.6, 0.3, [{ at: 2, w: 2.2, y0: 0, y1: 2.4 }], BO);
  B.box('wood', { x: -24, y: y + 4.6, z: -28, w: 10.6, h: 0.25, d: 8.6, tint: 0x6e3c2a, seed: 931, scale: 3 });
  // loft over the west half, open edge facing the big door
  B.box('wood', { x: -26.5, y: y + 2.5, z: -28, w: 5.0, h: 0.22, d: 7.6, tint: 0x8a6f50, seed: 932, scale: 2, walkable: true });
  B.stairs('wood', -22.5, y, -30.8, '-x', 8, 2.72 / 8, 0.4, 1.8);
  // hay bales inside and out — soft-looking hard cover
  const bale = (x, z, yaw, seed) => B.cyl('sandbag', {
    x, y: heightAt(x, z), z, r: 0.75, h: 1.3, seg: 10, yaw, tint: 0xc9a852, seed, scale: 1.2,
  });
  bale(-26, -26, 0, 934); bale(-21, -30, 0.5, 935); bale(-14, -28, 1.1, 936);
  bale(-10, -30.5, 0.2, 937); bale(-25.5, -30.5, 0.9, 938);

  // farmyard clutter
  car(B, -8, -28, 1.2, 0x5a6a58);
  crateStack(B, -19, -18, 3, 940);
  for (let i = 0; i < 4; i++)
    B.cyl('metal', { x: -28 + i * 1.1, y: heightAt(-28 + i * 1.1, -21), z: -21, r: 0.4, h: 1.0, seg: 10, tint: 0x6a7078, seed: 944 + i });
}

/** The windmill on its knoll: a fat stone tower with a high balcony. */
function windmill(B) {
  const y = heightAt(14, -30);
  B.cyl('brick', { x: 14, y, z: -30, r: 3.2, rTop: 2.5, h: 7.2, seg: 14, tint: 0x9a9288, seed: 950, scale: 2.5 });
  // balcony ring at 7.2 — walkable, with a rail
  B.cyl('wood', { x: 14, y: y + 7.2, z: -30, r: 4.2, h: 0.25, seg: 14, tint: 0x7c6248, seed: 951, walkable: true });
  B.cyl('wood', { x: 14, y: y + 7.45, z: -30, r: 4.2, rTop: 4.2, h: 0.9, seg: 14, tint: 0x74593c, seed: 952, opaque: false, collide: false });
  // cap and idle sails (visual only)
  B.cyl('wood', { x: 14, y: y + 7.45, z: -30, r: 2.6, rTop: 0.6, h: 2.2, seg: 12, tint: 0x6e5138, seed: 953, collide: false });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.4;
    B.box('wood', {
      x: 14 + Math.cos(a) * 3.4, y: y + 8.1 + Math.sin(a) * 3.4, z: -27.6,
      w: 0.25 + Math.abs(Math.cos(a)) * 6.4, h: 0.25 + Math.abs(Math.sin(a)) * 6.4, d: 0.18,
      tint: 0x8a7658, seed: 954 + i, collide: false,
    });
  }
  // switchback stair up the outside
  B.stairs('wood', 8.2, y, -27.5, '+x', 10, 0.36, 0.4, 2.2);
  B.box('wood', { x: 13.2, y: y + 3.6, z: -27.5, w: 2.0, h: 0.2, d: 2.2, tint: 0x7c6248, seed: 958 });
  B.stairs('wood', 14.2, y + 3.8, -28.4, '-z', 10, 0.34, 0.35, 2.0);
  // ground door
  // (the tower is solid; the door is decorative shadow — fights happen on the stair)
  B.box('wood', { x: 14, y, z: -26.9, w: 1.6, h: 2.2, d: 0.2, tint: 0x4e3a28, seed: 959, collide: false });
  // sandbags on the knoll lip
  for (let i = -2; i <= 2; i++)
    B.box('sandbag', { x: 14 + i * 0.62, y, z: -25.4, w: 0.66, h: 0.35, d: 0.42, yaw: (i % 2) * 0.1, seed: 960, scale: 0.8 });
}

/** The stone ruin on the south bank — red's forward strongpoint. */
function ruin(B) {
  const y = heightAt(20, 26);
  const O = { seed: 970, scale: 2.5, base: y, tint: 0x8f8a80 };
  const door = (at) => ({ at, w: 2.0, y0: 0, y1: 2.3 });
  const win = (at) => ({ at, w: 1.5, y0: 1.0, y1: 2.4 });
  // shell walls, roofless
  B.wall('brick', 15, 21, 25, 21, 4.2, 0.45, [door(4), win(7.5)], O);
  B.wall('brick', 15, 31, 25, 31, 3.2, 0.45, [win(3), door(6.5)], O);
  B.wall('brick', 15, 21, 15, 31, 4.2, 0.45, [win(3), win(6.5)], O);
  B.wall('brick', 25, 21, 25, 31, 2.2, 0.45, [door(4)], O);
  // a surviving corner of the upper floor, reachable by stair
  B.box('wood', { x: 17.5, y: y + 4.0, z: 23.5, w: 5.0, h: 0.25, d: 5.0, tint: 0x7c6248, seed: 971, scale: 2, walkable: true });
  B.stairs('wood', 20.2 + 8 * 0.42, y, 25.5, '-x', 8, 4.0 / 8, 0.42, 2.0);
  // rubble spill where the east wall fell
  for (let i = 0; i < 6; i++) {
    B.box('concrete', {
      x: 26 + (i % 3) * 0.9, y: heightAt(26, 24 + i), z: 23 + i * 1.1,
      w: 1.1 + (i % 2) * 0.5, h: 0.4 + (i % 3) * 0.3, d: 1.0, yaw: i * 0.6,
      seed: 973 + i, scale: 1.4, tint: 0x8a857c,
    });
  }
  crateStack(B, 17, 28.5, 2, 980);
}

/** Orchard terrace: rows of fruit trees on the south-west rise. */
function orchard(B) {
  const y = heightAt(-26, 28);
  // low retaining wall along the downhill edge
  B.wall('brick', -33, 23, -19, 23, 1.1, 0.4, [{ at: 6, w: 2.2, y0: 0, y1: 1.1 }], { seed: 990, base: y - 0.1, tint: 0x8a857c });
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) {
    const x = -32 + i * 4.2 + (r % 2) * 2, z = 25.5 + r * 3.6;
    const ty = heightAt(x, z);
    B.cyl('wood', { x, y: ty, z, r: 0.22, rTop: 0.14, h: 2.2, seg: 7, tint: 0x5c4732, seed: 992 + r * 4 + i });
    B.cyl('sandbag', { x, y: ty + 1.8, z, r: 1.5, rTop: 0.3, h: 2.0, seg: 8, tint: 0x4e7a36, seed: 1000 + r * 4 + i, collide: false, scale: 1.5 });
  }
  crateStack(B, -21, 27, 2, 1012);
}

/** Dry-stone field walls and hedgerows: the lanes of the open ground.
 *  Walls are hard cover; hedges block sight but not movement realism-wise —
 *  here they are solid too, but thin, so they read as lanes not boxes. */
function fieldWalls(B) {
  const wallRun = (x1, z1, x2, z2, seed) => {
    // follow the terrain in short segments so the wall hugs the hillside
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.round(len / 5));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const ax = x1 + (x2 - x1) * t0, az = z1 + (z2 - z1) * t0;
      const bx = x1 + (x2 - x1) * t1, bz = z1 + (z2 - z1) * t1;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const y = Math.min(heightAt(ax, az), heightAt(bx, bz)) - 0.15;
      B.box('brick', {
        x: mx, y, z: mz, w: Math.hypot(bx - ax, bz - az) + 0.3, h: 1.25, d: 0.55,
        yaw: Math.atan2(bx - ax, bz - az) + Math.PI / 2, tint: 0x84807a, seed: seed + i, scale: 1.6,
      });
    }
  };
  // north field lanes (gaps between runs are the gates)
  wallRun(-44, -14, -26, -10, 1020);
  wallRun(-18, -8, 2, -12, 1030);
  wallRun(10, -16, 30, -12, 1040);
  wallRun(34, -24, 46, -30, 1050);
  // south field lanes
  wallRun(-46, 16, -32, 12, 1060);
  wallRun(-14, 14, 6, 18, 1070);
  wallRun(12, 32, 12, 44, 1080);
  wallRun(30, 18, 44, 22, 1090);

  // hedgerows: dense, sight-blocking green runs
  const hedge = (x1, z1, x2, z2, seed) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      B.cyl('sandbag', {
        x, y: heightAt(x, z) - 0.2, z, r: 1.3, rTop: 0.9, h: 2.1 + (i % 3) * 0.25, seg: 7,
        tint: 0x44622e, seed: seed + i, scale: 1.5,
      });
    }
  };
  hedge(-8, -34, 8, -36, 1100);
  hedge(-38, -2, -28, 4, 1110);
  hedge(28, 2, 38, -2, 1120);
  hedge(-4, 30, 8, 34, 1130);
}

/** Lone trees, troughs and boulders across the open grass. */
function scatter(B) {
  let s = 1150;
  const rnd = (() => { let v = 555444333; return () => { v = (v * 1103515245 + 12345) & 0x7fffffff; return v / 0x7fffffff; }; })();

  // big lone trees — landmark cover on the open hillsides
  for (let i = 0; i < 14; i++) {
    const a = rnd() * 6.283, r = 18 + rnd() * 32;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(z - riverZ(x)) < 9) continue;                        // not in the river
    if (PADS.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr + 3)) continue;
    const y = heightAt(x, z);
    const th = 3.0 + rnd() * 2.0;
    B.cyl('wood', { x, y, z, r: 0.35, rTop: 0.22, h: th, seg: 8, tint: 0x5c4732, seed: s++ });
    B.cyl('sandbag', { x, y: y + th - 0.6, z, r: 2.4 + rnd() * 1.2, rTop: 0.5, h: 2.8 + rnd(), seg: 8, tint: 0x466c30, seed: s++, collide: false, scale: 1.8 });
  }

  // boulders
  for (let i = 0; i < 12; i++) {
    const a = rnd() * 6.283, r = 14 + rnd() * 36;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (PADS.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr + 2)) continue;
    const y = heightAt(x, z);
    const sc = 0.7 + rnd() * 1.4;
    B.box('concrete', {
      x, y: y - sc * 0.3, z, w: sc * 1.8, h: sc * 1.3, d: sc * 1.5,
      yaw: rnd() * 3.14, tint: 0x787a72, seed: s++, scale: 2,
    });
  }

  // water troughs and a hay cart near the fords
  for (const [x, z, yaw] of [[-40, 6, 0.3], [42, -6, 1.8]]) {
    B.box('wood', { x, y: heightAt(x, z), z, w: 2.6, h: 0.8, d: 1.1, yaw, tint: 0x6e5a40, seed: s++, scale: 1.2 });
  }
}
