// THE FOUNDRY — a close-quarters map.
//
// Design rules this level is built to, in contrast with District 7:
//   * 76 x 76 m instead of 124 x 124 — you are never far from a fight.
//   * No sightline longer than about 24 m. The centre is a solid building mass
//     rather than an open plaza, so nothing can be crossed in a straight line.
//   * Every room has at least two ways in, so nobody can hold a dead end and
//     nobody gets cornered without an option.
//   * Three levels everywhere: ground, a catwalk/first floor ring, and roofs,
//     connected by eight staircases spread around the map.
//   * Doorways, not gates: 1.6–2.4 m openings that force point-blank contact.
import * as THREE from 'three';
import { MapBuilder, crateStack, car } from '../builder.js';
import { mat, flat, skyMaterial } from '../textures.js';

const R = 38;           // half-extent of the playable area

export const INFO = {
  name: 'THE FOUNDRY',
  bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R },
  nav: { minX: -R, maxX: R, minZ: -R, maxZ: R, cell: 0.9 },
  fog: { color: 0x8e8578, density: 0.0125 },
  spawns: {
    blue: [[-30, 30], [-33, 22], [-22, 32], [-30, 14], [-14, 32], [-33, 33]],
    red: [[30, -30], [33, -22], [22, -32], [30, -14], [14, -32], [33, -33]],
  },
  hotspots: [
    [0, 0], [0, -12], [0, 12], [-12, 0], [12, 0],
    [-20, -20], [20, 20], [-20, 20], [20, -20],
    [0, -26], [0, 26], [-26, 0], [26, 0],
    [-8, -8, 4.3], [8, 8, 4.3],          // first floor of the central block
    [0, 0, 8.6],                          // central roof
    [-24, 6, 4.3], [24, -6, 4.3],         // side-building upper floors
    [-6, 24, 4.3], [6, -24, 4.3],
  ],
};

export function build(scene, physics) {
  const B = new MapBuilder(scene, physics);
  const sunDir = new THREE.Vector3(0.36, 0.52, -0.78).normalize();

  // ---------------------------------------------------------------- sky/light
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 72, 44), skyMaterial(sunDir));
  sky.matrixAutoUpdate = false;
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0x8e8578, 0.0125);

  const sun = new THREE.DirectionalLight(0xffe6c4, 3.6);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // follows the player each frame — see the same note in world/map.js
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 240;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x9db6cf, 0x6a5f50, 1.35);
  scene.add(hemi);
  const bounce = new THREE.DirectionalLight(0xffcf9a, 0.5);
  bounce.position.set(-0.4, -0.5, 0.7).multiplyScalar(50);
  scene.add(bounce);

  // ---------------------------------------------------------------- ground
  const g = new THREE.PlaneGeometry(240, 240, 1, 1);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 48, uv.getY(i) * 48);
  const ground = new THREE.Mesh(g, mat('asphalt', { seed: 3, size: 512 }));
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  scene.add(ground);
  physics.addBox(0, -1, 0, 300, 2, 300, 0, { surface: 'asphalt' });

  // concrete apron under the central block so the middle reads as a yard
  B.box('concrete', { x: 0, y: -0.05, z: 0, w: 46, h: 0.12, d: 46, collide: false, seed: 9, scale: 4, apron: true });

  // ---------------------------------------------------------------- perimeter
  for (const [x1, z1, x2, z2] of [
    [-R, -R, R, -R], [R, -R, R, R], [R, R, -R, R], [-R, R, -R, -R],
  ]) B.wall('corrugated', x1, z1, x2, z2, 8, 1.2, [], { seed: 5, scale: 4, tint: 0x8a8074 });

  centralBlock(B);
  cornerSheds(B);
  perimeterHalls(B);
  yardClutter(B);
  interiorLights(scene);

  const meshes = B.commit();
  meshes.push(ground);     // tracked so a map switch can remove it
  physics.build();
  return { sun, hemi, sky, meshes, sunDir, stairRuns: B.stairRuns || [] };
}

// ---------------------------------------------------------------------------
// The centre: a solid two-storey foundry hall, cut into small rooms. This is the
// piece that makes the map close-quarters — there is no way to see across the
// level, only through it.

function centralBlock(B) {
  const X0 = -13, X1 = 13, Z0 = -13, Z1 = 13;
  const F1 = 0, F2 = 4.3, ROOF = 8.6;
  const W = 0.35;
  const S = { seed: 101, scale: 3 };
  const door = (at, w = 2.0) => ({ at, w, y0: 0, y1: 2.3 });
  const win = (at, w = 1.8) => ({ at, w, y0: 1.05, y1: 2.5 });

  // ---- ground floor shell: a door on every face, plus windows to shoot through
  B.wall('brick', X0, Z0, X1, Z0, F2, W, [door(5), win(11), door(19)], S);
  B.wall('brick', X0, Z1, X1, Z1, F2, W, [door(5), win(11), door(19)], S);
  B.wall('brick', X0, Z0, X0, Z1, F2, W, [door(5), win(11), door(19)], S);
  B.wall('brick', X1, Z0, X1, Z1, F2, W, [door(5), win(11), door(19)], S);

  // ---- ground floor partitions: a pinwheel of four rooms around a core
  //      Offset doorways mean you can never see straight through the building.
  B.wall('plaster', X0, -4.5, -4.5, -4.5, F2, 0.3, [door(4)], { seed: 102, scale: 3 });
  B.wall('plaster', 4.5, -4.5, X1, -4.5, F2, 0.3, [door(3)], { seed: 103, scale: 3 });
  B.wall('plaster', X0, 4.5, -4.5, 4.5, F2, 0.3, [door(3)], { seed: 104, scale: 3 });
  B.wall('plaster', 4.5, 4.5, X1, 4.5, F2, 0.3, [door(4)], { seed: 105, scale: 3 });
  B.wall('plaster', -4.5, Z0, -4.5, -4.5, F2, 0.3, [door(4)], { seed: 106, scale: 3 });
  B.wall('plaster', -4.5, 4.5, -4.5, Z1, F2, 0.3, [door(3)], { seed: 107, scale: 3 });
  B.wall('plaster', 4.5, Z0, 4.5, -4.5, F2, 0.3, [door(3)], { seed: 108, scale: 3 });
  B.wall('plaster', 4.5, 4.5, 4.5, Z1, F2, 0.3, [door(4)], { seed: 109, scale: 3 });

  // the core: a furnace room, open at two corners
  B.box('concrete', { x: 0, y: 0, z: 0, w: 4.4, h: 3.4, d: 4.4, tint: 0x7a6a58, seed: 110, scale: 2 });
  B.cyl('metal', { x: 0, y: 3.4, z: 0, r: 1.1, h: 5.2, seg: 12, tint: 0x5a4c40, seed: 111, scale: 2 });
  B.box('metal', { x: -3.4, y: 0, z: -3.4, w: 1.2, h: 1.1, d: 1.2, tint: 0x7a6a55, seed: 112 });
  B.box('metal', { x: 3.4, y: 0, z: 3.4, w: 1.2, h: 1.1, d: 1.2, tint: 0x7a6a55, seed: 112 });

  // ---- first floor slab with a stairwell hole in two opposite corners
  B.slab('tile', X0, Z0, X1, Z1, F2 - 0.3, 0.3, [
    [X0 - 0.1, Z0 - 0.1, X0 + 6.6, Z0 + 5.2],
    [X1 - 6.6, Z1 - 5.2, X1 + 0.1, Z1 + 0.1],
    [-2.6, -2.6, 2.6, 2.6],                      // open above the furnace
  ], { seed: 113, scale: 3 });

  // stairs up, one in each hole, climbing in opposite directions
  B.stairs('concrete', X0 + 1.4, 0, Z0 + 1.0, '+z', 12, 0.36, 0.40, 3.2);
  B.stairs('concrete', X1 - 1.4, 0, Z1 - 1.0, '-z', 12, 0.36, 0.40, 3.2);

  // ---- first floor: an open gallery ring with waist-high rails over the core
  B.wall('brick', X0, Z0, X1, Z0, ROOF - F2, W, [win(4), win(9), win(14), win(19)], { ...S, base: F2 });
  B.wall('brick', X0, Z1, X1, Z1, ROOF - F2, W, [win(4), win(9), win(14), win(19)], { ...S, base: F2 });
  B.wall('brick', X0, Z0, X0, Z1, ROOF - F2, W, [win(4), win(9), win(14), win(19)], { ...S, base: F2 });
  B.wall('brick', X1, Z0, X1, Z1, ROOF - F2, W, [win(4), win(9), win(14), win(19)], { ...S, base: F2 });
  // two cross walls upstairs, doors offset from the ones below
  B.wall('plaster', X0, 0, -3.0, 0, ROOF - F2, 0.3, [door(6)], { seed: 114, scale: 3, base: F2 });
  B.wall('plaster', 3.0, 0, X1, 0, ROOF - F2, 0.3, [door(4)], { seed: 115, scale: 3, base: F2 });
  // rails around the open core
  for (const [x, z, w, d] of [[0, -2.8, 5.6, 0.12], [0, 2.8, 5.6, 0.12],
                              [-2.8, 0, 0.12, 5.6], [2.8, 0, 0.12, 5.6]]) {
    B.box('metal', { x, y: F2, z, w, h: 1.05, d, tint: 0x6e7378, seed: 116, opaque: false });
  }

  // ---- roof: reachable, with parapet and vents for cover
  B.slab('concrete', X0, Z0, X1, Z1, ROOF - 0.3, 0.3, [[-2.6, -2.6, 2.6, 2.6]], { seed: 117, scale: 4 });
  B.stairs('metal', X1 - 1.6, F2, Z0 + 1.2, '+z', 12, 0.36, 0.40, 3.0);
  for (const [x1, z1, x2, z2] of [[X0, Z0, X1, Z0], [X1, Z0, X1, Z1], [X1, Z1, X0, Z1], [X0, Z1, X0, Z0]])
    B.wall('concrete', x1, z1, x2, z2, 1.0, 0.3, [], { seed: 118, scale: 3, base: ROOF });
  for (const [vx, vz] of [[-7, -7], [7, -7], [-7, 7], [7, 7], [0, -9], [0, 9]]) {
    B.box('metal', { x: vx, y: ROOF, z: vz, w: 2.0, h: 1.2, d: 1.6, tint: 0x8d9296, seed: 119, scale: 1.5 });
  }

  // machinery on the ground floor: cover inside every room
  for (const [mx, mz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
    B.box('metal', { x: mx, y: 0, z: mz, w: 2.6, h: 1.25, d: 1.8, tint: 0x5f6a70, seed: 120, scale: 1.5 });
    B.cyl('metal', { x: mx + 1.6, y: 0, z: mz, r: 0.42, h: 1.05, seg: 10, tint: 0x7a5a2a, seed: 121 });
  }
  crateStack(B, -11, 0.5, 3, 130);
  crateStack(B, 9.5, -1.5, 3, 134);
}

// ---------------------------------------------------------------------------
// Four corner sheds. Each is a small two-storey building that overlooks a
// spawn approach, close enough to the centre to be contested immediately.

function cornerSheds(B) {
  const sheds = [
    { cx: -24, cz: -24, rot: 0 },
    { cx: 24, cz: -24, rot: 0 },
    { cx: -24, cz: 24, rot: 0 },
    { cx: 24, cz: 24, rot: 0 },
  ];
  let seed = 200;
  for (const { cx, cz } of sheds) {
    const X0 = cx - 6, X1 = cx + 6, Z0 = cz - 6, Z1 = cz + 6;
    const F2 = 4.3;
    const door = (at, w = 2.0) => ({ at, w, y0: 0, y1: 2.3 });
    const win = (at, w = 1.7) => ({ at, w, y0: 1.05, y1: 2.5 });
    const S = { seed: seed++, scale: 3 };

    // doors on the two faces pointing at the centre, windows on the others
    const inX = cx < 0 ? 1 : -1, inZ = cz < 0 ? 1 : -1;
    B.wall('plaster', X0, Z0, X1, Z0, F2, 0.35, inZ > 0 ? [win(3), win(8)] : [door(4), win(9)], S);
    B.wall('plaster', X0, Z1, X1, Z1, F2, 0.35, inZ > 0 ? [door(4), win(9)] : [win(3), win(8)], S);
    B.wall('plaster', X0, Z0, X0, Z1, F2, 0.35, inX > 0 ? [win(3), win(8)] : [door(4), win(9)], S);
    B.wall('plaster', X1, Z0, X1, Z1, F2, 0.35, inX > 0 ? [door(4), win(9)] : [win(3), win(8)], S);

    // upper floor with a hole for the stair, and window slits all round
    B.slab('tile', X0, Z0, X1, Z1, F2 - 0.3, 0.3,
      [[X0 - 0.1, Z0 - 0.1, X0 + 4.2, Z0 + 4.4]], { seed: seed++, scale: 3 });
    B.stairs('concrete', X0 + 1.2, 0, Z0 + 0.8, '+z', 12, 0.36, 0.34, 2.6);
    for (const [x1, z1, x2, z2] of [[X0, Z0, X1, Z0], [X0, Z1, X1, Z1], [X0, Z0, X0, Z1], [X1, Z0, X1, Z1]])
      B.wall('plaster', x1, z1, x2, z2, 3.0, 0.35, [win(3.2, 2.4), win(7.4, 2.4)], { seed: seed++, scale: 3, base: F2 });
    B.box('concrete', { x: cx, y: F2 + 3.0, z: cz, w: 12.7, h: 0.3, d: 12.7, seed: seed++, scale: 4 });

    // interior cover
    B.box('crate', { x: cx + inX * 2.5, y: 0, z: cz + inZ * 2.0, w: 1.4, h: 1.4, d: 1.4, seed: seed++, scale: 1.5 });
    B.box('metal', { x: cx - inX * 3.0, y: 0, z: cz - inZ * 2.4, w: 2.0, h: 1.1, d: 1.2, tint: 0x5f6a70, seed: seed++, scale: 1.5 });
    B.box('crate', { x: cx - inX * 1.0, y: F2, z: cz + inZ * 3.2, w: 1.3, h: 1.3, d: 1.3, seed: seed++, scale: 1.5 });
  }
}

// ---------------------------------------------------------------------------
// Long narrow halls down the four sides, linking the corner sheds. These are
// the flanking routes: covered, tight, and full of doorways onto the yard.

function perimeterHalls(B) {
  const halls = [
    { a: [-18, -30], b: [18, -30], horiz: true },
    { a: [-18, 30], b: [18, 30], horiz: true },
    { a: [-30, -18], b: [-30, 18], horiz: false },
    { a: [30, -18], b: [30, 18], horiz: false },
  ];
  let seed = 300;
  for (const { a, b, horiz } of halls) {
    const half = 3.2;
    const x0 = horiz ? a[0] : a[0] - half, x1 = horiz ? b[0] : a[0] + half;
    const z0 = horiz ? a[1] - half : a[1], z1 = horiz ? a[1] + half : b[1];
    const H = 4.4;
    const door = (at, w = 2.2) => ({ at, w, y0: 0, y1: 2.4 });
    const win = (at, w = 1.6) => ({ at, w, y0: 1.1, y1: 2.4 });
    const len = horiz ? (x1 - x0) : (z1 - z0);
    // openings onto the yard on the inner face, small windows on the outer
    const inner = [door(len * 0.18), door(len * 0.5), door(len * 0.82)];
    const outer = [win(len * 0.28), win(len * 0.62)];
    const facingIn = horiz ? (a[1] < 0 ? z1 : z0) : (a[0] < 0 ? x1 : x0);

    if (horiz) {
      B.wall('corrugated', x0, z0, x1, z0, H, 0.4, z0 === facingIn ? inner : outer, { seed: seed++, scale: 3 });
      B.wall('corrugated', x0, z1, x1, z1, H, 0.4, z1 === facingIn ? inner : outer, { seed: seed++, scale: 3 });
      B.wall('corrugated', x0, z0, x0, z1, H, 0.4, [door(2.2)], { seed: seed++, scale: 3 });
      B.wall('corrugated', x1, z0, x1, z1, H, 0.4, [door(2.2)], { seed: seed++, scale: 3 });
    } else {
      B.wall('corrugated', x0, z0, x0, z1, H, 0.4, x0 === facingIn ? inner : outer, { seed: seed++, scale: 3 });
      B.wall('corrugated', x1, z0, x1, z1, H, 0.4, x1 === facingIn ? inner : outer, { seed: seed++, scale: 3 });
      B.wall('corrugated', x0, z0, x1, z0, H, 0.4, [door(2.2)], { seed: seed++, scale: 3 });
      B.wall('corrugated', x0, z1, x1, z1, H, 0.4, [door(2.2)], { seed: seed++, scale: 3 });
    }
    // roof, walkable, reached from the corner sheds
    B.box('corrugated', { x: (x0 + x1) / 2, y: H, z: (z0 + z1) / 2, w: x1 - x0, h: 0.3, d: z1 - z0, seed: seed++, scale: 4 });

    // pillars and crates inside break the hall into a series of duels
    const n = Math.floor(len / 7);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const px = horiz ? x0 + (x1 - x0) * t : (x0 + x1) / 2;
      const pz = horiz ? (z0 + z1) / 2 : z0 + (z1 - z0) * t;
      B.box('concrete', { x: px, y: 0, z: pz, w: 0.8, h: H, d: 0.8, seed: seed++, scale: 2 });
      B.box('crate', { x: px + (horiz ? 2.2 : 1.6), y: 0, z: pz + (horiz ? 1.6 : 2.2), w: 1.3, h: 1.3, d: 1.3, seed: seed++, scale: 1.5 });
    }
  }
}

// ---------------------------------------------------------------------------

function yardClutter(B) {
  // container pairs forming short lanes between the centre and the halls
  const container = (x, z, yaw, tint, seed) => {
    B.box('corrugated', { x, y: 0, z, w: 6.1, h: 2.6, d: 2.44, yaw, tint, seed, scale: 1.2 });
    B.box('metal', { x, y: 2.6, z, w: 6.2, h: 0.1, d: 2.5, yaw, tint: 0x6e6e70, seed: seed + 1, walkable: true });
  };
  container(-20, -8, 0, 0xc0603a, 400);
  container(20, 8, 0, 0x3a6ea8, 402);
  container(-8, 20, Math.PI / 2, 0x4a7d3a, 404);
  container(8, -20, Math.PI / 2, 0xb08a30, 406);
  container(-19, 17, Math.PI / 4, 0x9aa2a8, 408);
  container(19, -17, Math.PI / 4, 0xc03a3a, 410);

  // ramps onto the containers so the yard has a second level too
  B.stairs('metal', -16.2, 0, -8, '-x', 8, 0.345, 0.40, 2.6);
  B.stairs('metal', 16.2, 0, 8, '+x', 8, 0.345, 0.40, 2.6);

  // sandbag nests covering the doorways into the centre
  const nest = (x, z, yaw) => {
    for (let r = 0; r < 2; r++) for (let i = -2; i <= 2; i++) {
      B.box('sandbag', {
        x: x + Math.cos(yaw) * i * 0.62, y: r * 0.34, z: z + Math.sin(yaw) * i * 0.62,
        w: 0.66, h: 0.35, d: 0.42, yaw: yaw + (i % 2) * 0.1, seed: 420 + r, scale: 0.8,
      });
    }
  };
  nest(-16, 0, Math.PI / 2); nest(16, 0, Math.PI / 2);
  nest(0, -16, 0); nest(0, 16, 0);

  // barrels and wrecks, kept low so they never block a doorway
  for (let i = 0; i < 20; i++) {
    const a = i * 2.399, r = 15 + (i % 5) * 3.5;
    B.cyl('metal', {
      x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, r: 0.44, h: 1.1, seg: 10,
      tint: [0x9a3a2a, 0x2a5a8a, 0x4a4a4c, 0x7a6a2a][i % 4], seed: 440 + i, scale: 1,
    });
  }
  car(B, -28, 4, 1.2, 0x5a6a58);
  car(B, 28, -4, 2.0, 0x7a4a3a);
  crateStack(B, -14, -20, 4, 460);
  crateStack(B, 14, 20, 4, 464);
}

function interiorLights(scene) {
  // Everything here is enclosed, so the interiors need their own light or they
  // read as black holes. Created once at build time, never toggled.
  const lamp = (x, y, z, color, intensity, dist) => {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(x, y, z);
    scene.add(l);
  };
  // central block, both floors
  for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
    lamp(x, 3.3, z, 0xffe0b4, 16, 14);
    lamp(x, 7.6, z, 0xffe0b4, 14, 13);
  }
  // just outside the furnace shell, not inside it
  lamp(0, 5.4, 0, 0xffb070, 22, 14);
  lamp(-3.6, 2.2, -3.6, 0xff9a55, 10, 8);
  lamp(3.6, 2.2, 3.6, 0xff9a55, 10, 8);
  // corner sheds
  for (const [x, z] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]) {
    lamp(x, 3.2, z, 0xffd9a6, 13, 12);
    lamp(x, 6.6, z, 0xffd9a6, 11, 11);
  }
  // perimeter halls
  for (const [x, z] of [[-9, -30], [9, -30], [-9, 30], [9, 30],
                        [-30, -9], [-30, 9], [30, -9], [30, 9]]) {
    lamp(x, 3.4, z, 0xffd090, 11, 12);
  }
}
