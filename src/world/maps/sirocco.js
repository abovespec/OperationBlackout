// SIROCCO — a sun-bleached desert town in the classic three-lane mould.
//
// The archetype (long lane / mid / tunnels feeding two objectives) is the
// Dust 2 school of layout; the geometry here is our own. Design rules:
//   * Three parallel north-south lanes, walled off from each other by solid
//     building masses, crossing only at deliberate cuts.
//   * WEST — "the boulevard": the map's long open lane, one straight ~50 m
//     sightline broken by a single archway. Rifle country.
//   * MID: a street watched end-to-end through a 2.6 m gate door. Peeking it
//     is a choice, not an accident.
//   * EAST — "the arcade": a covered market tunnel, dark and tight. SMG and
//     shotgun country, feeding the CISTERN yard.
//   * Two objectives: the TERRACE, a raised north-west plaza fed by the
//     boulevard and overlooked by the one climbable roof; and the CISTERN,
//     an enclosed north-east courtyard with exactly two doors.
//   * GHOST spawns along the south courtyard, VIPER along the north strip —
//     VIPER sits closer to both objectives, GHOST picks a lane and pushes.
import * as THREE from 'three';
import { MapBuilder, crateStack, truck, car } from '../builder.js';
import { mat, skyMaterial } from '../textures.js';

const R = 50;

export const INFO = {
  name: 'SIROCCO',
  bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R },
  nav: { minX: -R, maxX: R, minZ: -R, maxZ: R, cell: 1.0 },
  fog: { color: 0xd8c09a, density: 0.005 },
  spawns: {
    blue: [[-20, 44], [0, 45], [20, 44], [-38, 45], [38, 44], [8, 41]],
    red: [[-30, -44], [-15, -45], [0, -44], [12, -45], [-42, -44], [6, -41]],
  },
  hotspots: [
    [0, -10],                 // mid doors
    [0, 20],                  // mid, south of the gate
    [-43, 30], [-43, 12],     // the boulevard, south and at the arch
    [-43, -6],                // boulevard north, under the terrace steps
    [-35, -26, 1.8],          // TERRACE objective
    [30, -31],                // CISTERN objective (beside the tank)
    [41, 10],                 // inside the arcade
    [20, 6],                  // the block-B tunnel
    [-21, 18],                // the crossover cut
    [-14, -25],               // top mid, in front of the terrace
    [40, -17],                // north yard between arcade and cistern
    [0, 42], [-15, -44],      // spawn streets
    [-18, -8, 4.2],           // block-A roof — the map's one high position
  ],
};

export function build(scene, physics) {
  const B = new MapBuilder(scene, physics);
  // late-afternoon sun out of the south-west: long shadows rake across mid
  // and the boulevard, and the arcade interior falls into real shade
  const sunDir = new THREE.Vector3(0.55, 0.52, 0.42).normalize();

  // ---------------------------------------------------------------- sky/light
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 72, 44), skyMaterial(sunDir));
  sky.matrixAutoUpdate = false;
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0xd8c09a, 0.005);

  const sun = new THREE.DirectionalLight(0xfff0d2, 3.8);
  sun.position.copy(sunDir).multiplyScalar(110);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 280;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x9ec4e8, 0xb08c55, 1.05);
  scene.add(hemi);
  const bounce = new THREE.DirectionalLight(0xffd9a0, 0.4);
  bounce.position.set(-0.4, -0.5, -0.6).multiplyScalar(60);
  scene.add(bounce);

  // ---------------------------------------------------------------- ground
  const g = new THREE.PlaneGeometry(240, 240, 1, 1);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 48, uv.getY(i) * 48);
  const ground = new THREE.Mesh(g, mat('sand', { seed: 11, size: 512 }));
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  scene.add(ground);
  physics.addBox(0, -1, 0, 300, 2, 300, 0, { surface: 'sand' });

  // packed-dirt aprons so the lanes read as streets against the open sand
  B.box('concrete', { x: 0, y: -0.06, z: 10, w: 15, h: 0.1, d: 58, collide: false, seed: 21, scale: 4, tint: 0xb59e78 });
  B.box('concrete', { x: -43, y: -0.06, z: 10, w: 13, h: 0.1, d: 56, collide: false, seed: 22, scale: 4, tint: 0xb59e78 });

  // ---------------------------------------------------------------- perimeter
  const P = { seed: 5, scale: 4, tint: 0xc09a6e };
  B.wall('plaster', -R, -R, R, -R, 7, 1.0, [], P);
  B.wall('plaster', R, -R, R, R, 7, 1.0, [], P);
  B.wall('plaster', R, R, -R, R, 7, 1.0, [], P);
  B.wall('plaster', -R, R, -R, -R, 7, 1.0, [], P);

  blockA(B);      // west building mass: crossover cut, stairwell, roof
  blockB(B);      // east building mass: the covered tunnel
  arcade(B);      // covered market lane
  terrace(B);     // north-west objective
  cistern(B);     // north-east objective
  laneDressing(B);

  const meshes = B.commit();
  physics.build();
  return { sun, hemi, sky, meshes, sunDir, stairRuns: B.stairRuns || [] };
}

const SAND = 0xc8a578;

/**
 * Block A fills the ground between the boulevard and mid. Cut in three:
 * a south chunk, a middle chunk whose flat top is the map's one accessible
 * roof, and an open-air crossover alley between them linking the two lanes.
 * A roofless stairwell on the boulevard side climbs to the roof.
 */
function blockA(B) {
  // south chunk: z +20..+34, solid and tall — no one fights on top of it
  B.box('plaster', { x: -22, y: 0, z: 27, w: 28, h: 6, d: 14, seed: 30, scale: 3, tint: SAND });
  // middle chunk: z -6..+16 — its top IS the roof position (h 4.2)
  B.box('plaster', { x: -21, y: 0, z: 5, w: 26, h: 4.2, d: 22, seed: 31, scale: 3, tint: 0xc4a074 });
  // north chunk beside the stairwell: z -14..-6
  B.box('plaster', { x: -18, y: 0, z: -10, w: 20, h: 4.2, d: 8, seed: 32, scale: 3, tint: 0xc4a074 });

  // stairwell: x -34..-28, z -14..-6, roofless, door onto the boulevard
  B.wall('plaster', -34, -14, -28, -14, 4.2, 0.4, [], { seed: 33, scale: 3, tint: SAND });
  B.wall('plaster', -34, -6, -34, -14, 4.2, 0.4, [{ at: 3.0, w: 2.2, y0: 0, y1: 2.5 }], { seed: 34, scale: 3, tint: SAND });
  B.stairs('wood', -33.4, 0, -10, '+x', 12, 0.35, 0.42, 2.6);

  // roof parapets — knee walls with fighting gaps. The north gap over the
  // terrace lets you drop down onto the objective (one-way: 4.2 -> 1.8).
  const RP = { seed: 36, base: 4.2, tint: 0xb8946a };
  B.wall('plaster', -34, -6, -34, 16, 0.9, 0.3, [{ at: 8, w: 3 }], RP);          // over the boulevard
  B.wall('plaster', -8, -14, -8, 16, 0.9, 0.3, [{ at: 5, w: 3 }, { at: 20, w: 3 }], RP); // over mid
  B.wall('plaster', -28, -14, -8, -14, 0.9, 0.3, [{ at: 4, w: 3 }], RP);         // over top mid / terrace
  B.wall('plaster', -34, 16, -8, 16, 0.9, 0.3, [], RP);                          // back edge
  // sandbags at the mid-facing gaps
  for (let i = -1; i <= 1; i++)
    B.box('sandbag', { x: -8.6, y: 4.2, z: -8 + i * 0.62, w: 0.42, h: 0.35, d: 0.66, seed: 37, scale: 0.8 });

  // the crossover: open cut z +16..+20 linking boulevard and mid.
  // A low barricade in the middle keeps it from being a free wallbang lane.
  B.box('crate', { x: -21, y: 0, z: 18, w: 1.5, h: 1.5, d: 1.5, seed: 38, scale: 1.5 });
}

/** Block B fills mid-to-arcade, split by the covered tunnel at z +4..+8. */
function blockB(B) {
  B.box('plaster', { x: 20, y: 0, z: 21, w: 24, h: 4.2, d: 26, seed: 40, scale: 3, tint: SAND });
  B.box('plaster', { x: 20, y: 0, z: -5, w: 24, h: 4.2, d: 18, seed: 41, scale: 3, tint: 0xc4a074 });
  // tunnel ceiling: a slab over the cut, low enough to feel like a tunnel
  B.box('concrete', { x: 20, y: 3.0, z: 6, w: 24, h: 0.5, d: 4.8, seed: 42, scale: 3, tint: 0xa8895f, walkable: false });
  // props inside the tunnel — hard cover at the two mouths
  B.box('crate', { x: 10.5, y: 0, z: 7, w: 1.4, h: 1.4, d: 1.4, seed: 43, scale: 1.5 });
  B.cyl('metal', { x: 29, y: 0, z: 5, r: 0.44, h: 1.1, seg: 10, tint: 0x7a6a2a, seed: 44 });
}

/** The arcade: a covered market lane along the east wall, x +34..+49. */
function arcade(B) {
  // west wall with a door at each end and one mid-lane window
  B.wall('plaster', 34, -14, 34, 34, 4.0, 0.45, [
    { at: 3.0, w: 2.4, y0: 0, y1: 2.6 },
    { at: 24, w: 1.8, y0: 1.1, y1: 2.4 },
    { at: 43, w: 2.4, y0: 0, y1: 2.6 },
  ], { seed: 50, scale: 3, tint: SAND });
  // roof, resting on the west wall and the perimeter
  B.box('concrete', { x: 42, y: 3.6, z: 10, w: 16.5, h: 0.4, d: 48, seed: 51, scale: 4, tint: 0xa8895f, walkable: false });
  // pillars down the middle
  for (const z of [-8, 0, 8, 16, 24])
    B.box('brick', { x: 41, y: 0, z, w: 0.8, h: 3.6, d: 0.8, seed: 52, scale: 2, tint: 0xb08a60 });
  // market stalls: counters with cloth shades
  const stall = (x, z, color, seed) => {
    B.box('wood', { x, y: 0, z, w: 2.4, h: 0.95, d: 1.3, seed, scale: 1.2 });
    B.box('sandbag', { x, y: 2.4, z, w: 3.0, h: 0.08, d: 1.9, tint: color, seed: seed + 1, scale: 1.2, collide: false });
  };
  stall(45, -4, 0xc05a38, 53);
  stall(37, 6, 0x3f7a95, 55);
  stall(45, 14, 0xc9a63e, 57);
  stall(37, 22, 0x7a5f8a, 59);
}

/** The TERRACE: raised north-west plaza. Steps up from the boulevard on the
 *  south side, steps down to the north strip, colonnade stubs for cover. */
function terrace(B) {
  B.box('concrete', { x: -35, y: 0, z: -26, w: 30, h: 1.8, d: 24, seed: 60, scale: 3, tint: 0xbfa170 });
  // wide plaza steps: boulevard -> terrace (south edge, z -14)
  B.stairs('concrete', -43, 0, -13.2, '-z', 5, 0.36, 0.5, 10);
  // north steps: terrace -> north strip
  B.stairs('concrete', -35, 0, -40.8, '+z', 5, 0.36, 0.5, 8);
  // broken colonnade along the east lip — cover that faces top mid
  for (const z of [-34, -28, -22])
    B.box('plaster', { x: -21.5, y: 1.8, z, w: 1.1, h: 2.6 - (z % 2 ? 0.6 : 0), d: 1.1, seed: 61, scale: 2, tint: SAND });
  // objective clutter
  crateStack(B, -38, -30, 4, 63);
  for (let i = -2; i <= 2; i++)
    B.box('sandbag', { x: -27 + i * 0.62, y: 1.8, z: -20, w: 0.66, h: 0.35, d: 0.42, yaw: (i % 2) * 0.1, seed: 68, scale: 0.8 });
}

/** The CISTERN: enclosed north-east courtyard. Two doors — west from the
 *  north strip, south from the arcade yard — and a round stone tank inside. */
function cistern(B) {
  const W = { seed: 70, scale: 3, tint: SAND };
  B.wall('plaster', 20, -50, 20, -20, 5, 0.5, [{ at: 14, w: 2.4, y0: 0, y1: 2.6 }], W);
  B.wall('plaster', 20, -20, 49.5, -20, 5, 0.5, [
    { at: 18, w: 2.4, y0: 0, y1: 2.6 },
    { at: 8, w: 1.8, y0: 1.1, y1: 2.4 },   // window the arcade yard can peek
  ], W);
  // the tank itself — hard round cover dominating the middle
  B.cyl('brick', { x: 34, y: 0, z: -35, r: 2.6, h: 1.15, seg: 18, tint: 0xb08a60, seed: 72 });
  crateStack(B, 42, -44, 5, 73);
  crateStack(B, 24, -28, 2, 77);
  for (let i = -2; i <= 2; i++)
    B.box('sandbag', { x: 28 + i * 0.62, y: 0, z: -24, w: 0.66, h: 0.35, d: 0.42, yaw: (i % 2) * 0.1, seed: 79, scale: 0.8 });
}

/** Street furniture: the arch on the boulevard, the mid gate, spawn clutter. */
function laneDressing(B) {
  // the boulevard arch — one doorway breaking the long sightline
  B.wall('plaster', -50, 8, -36, 8, 5, 0.8, [{ at: 5, w: 3.6, y0: 0, y1: 3.4 }], { seed: 80, scale: 3, tint: 0xc09a6e });
  // mid gate: full-height wall with the one 2.6 m door
  B.wall('plaster', -8, -10, 8, -10, 4.2, 0.6, [{ at: 6.7, w: 2.6, y0: 0, y1: 2.8 }], { seed: 82, scale: 3, tint: 0xc09a6e });

  // lane cover
  car(B, 0, 14, 0.12, 0x8a4a3a);                       // mid, south of the gate
  B.box('crate', { x: -46, y: 0, z: 22, w: 1.5, h: 1.5, d: 1.5, seed: 84, scale: 1.5 });
  B.box('crate', { x: -37.5, y: 0, z: -2, w: 1.5, h: 1.5, d: 1.5, seed: 85, scale: 1.5 });  // boulevard north corner
  for (const [x, z] of [[-4, -24], [-14, -33]])        // top mid rocks
    B.box('concrete', { x, y: -0.4, z, w: 2.6, h: 1.9, d: 2.2, yaw: x * 0.3, tint: 0x96604a, seed: 86, scale: 2 });

  // spawn streets
  truck(B, 26, 42, 3.0);
  car(B, -26, 42, -0.2, 0x3f6a95);
  crateStack(B, 44, 38, 3, 88);
  crateStack(B, -47, -45, 3, 92);
  for (let i = 0; i < 4; i++)
    B.cyl('metal', { x: 14 + i * 1.1, y: 0, z: -47, r: 0.44, h: 1.1, seg: 10, tint: [0x9a3a2a, 0x7a6a2a][i % 2], seed: 96 + i });
}
