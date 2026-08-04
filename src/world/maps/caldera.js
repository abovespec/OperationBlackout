// CALDERA — a live volcanic crater under an ash sky.
//
// Terrain identity: one big landform instead of many small ones. Ash slopes
// climb from the map edge to a raised rim ring, then drop into the crater
// bowl. The rim is the high ground the whole map fights over — it is lowest
// at two saddles (north-east and south-west), which are the natural routes
// in, and both teams can see anyone silhouetted crossing it. Inside the bowl:
// lava pools (bright, walled off by basalt rims), column clusters for cover,
// and an abandoned drill rig in the middle.
//
// Light is nothing like the other maps: a dim, red, smoke-filtered sun plus
// the orange glow of the lava itself — the only map lit from below.
import * as THREE from 'three';
import { MapBuilder, crateStack } from '../builder.js';

const R = 50;

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

const noise = makeNoise(66051234);

// lava pools: [x, z, radius]. Surfaces sit at LAVA_Y; each pool is ringed by
// basalt blocks so nothing can walk in (there is no damage-volume system, so
// the fiction is protected by collision instead).
const POOLS = [[-10, 6, 4.2], [12, -2, 3.4], [-2, -13, 2.8]];
const LAVA_Y = -3.4;

/**
 * Terrain height. Pure function shared by physics, navmesh and the mesh —
 * see the note in coldharbor.js for why this must never be a baked grid.
 */
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);

  // the rim: a raised ring at radius 32. Two saddles cut it down to an easy
  // crossing height — cos(2θ) gives opposite low points, rotated so they land
  // NE and SW. Grade stays under the nav limit everywhere (ring sigma 9).
  const saddle = 0.55 + 0.45 * Math.cos(2 * theta - 1.5);
  const ring = Math.exp(-((r - 32) * (r - 32)) / 81) * 6.0 * saddle;

  // the bowl: inside the rim the floor settles toward -2.6
  const bowl = (1 - smooth01((r - 26) / 10)) * -2.6;

  // outer slopes fall away from the rim toward the map edge
  const outer = smooth01((r - 32) / 16) * -1.8;

  let h = ring + bowl + outer;
  h += noise(x * 0.03, z * 0.03) * 1.7;        // flow lobes
  h += noise(x * 0.09, z * 0.09) * 0.6;        // clinker
  h += noise(x * 0.2, z * 0.2) * 0.22;         // cinder grain

  // each lava pool sits in its own steep-ish little sink
  for (const [px, pz, pr] of POOLS) {
    const d = Math.hypot(x - px, z - pz);
    const t = 1 - smooth01((d - pr) / 5);
    h = h * (1 - t * 0.5) + t * (LAVA_Y - 0.5) * smooth01(1 - d / (pr + 1));
    if (d < pr) h = Math.min(h, LAVA_Y - 0.4);
  }

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

function smooth01(t) {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

// pads: [x, z, radius, height]
const PADS = [
  [2, 8, 8, -2.0],         // drill rig, crater floor
  [-24, -20, 7, 1.2],      // west shack terrace on the outer slope
  [26, 18, 7, 1.0],        // east shack terrace
  [22, -22, 6, 3.4],       // NE saddle checkpoint
  [-22, 22, 6, 3.4],       // SW saddle checkpoint
];

export const INFO = {
  name: 'CALDERA',
  bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R },
  nav: { minX: -R, maxX: R, minZ: -R, maxZ: R, cell: 1.2 },
  spawns: {
    // outside the rim, each team nearest its own saddle
    blue: [[38, -34], [42, -28], [32, -40], [44, -36], [36, -42], [28, -36]],
    red: [[-38, 34], [-42, 28], [-32, 40], [-44, 36], [-36, 42], [-28, 36]],
  },
  hotspots: [
    [2, 8], [-10, -6], [8, 14], [-6, 16], [14, 6],     // crater floor
    [22, -22], [-22, 22],                              // the saddles
    [0, -32], [0, 32], [-32, 0], [32, 0],              // rim high points
    [-24, -20], [26, 18],                              // outer shacks
    [-40, -8], [40, 8],
    [2, 8, 2.6],                                       // rig deck
    [2, 8, 6.2],                                       // rig upper platform
    [22, -22, 4.3], [-22, 22, 4.3],                    // checkpoint roofs
  ],
};

export function build(scene, physics) {
  const B = new MapBuilder(scene, physics);
  // a smoke-dimmed sun, low in the west
  const sunDir = new THREE.Vector3(-0.72, 0.30, 0.22).normalize();

  // ---------------------------------------------------------------- sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 72, 44), ashSky(sunDir));
  sky.matrixAutoUpdate = false;
  sky.frustumCulled = false;
  scene.add(sky);
  // warm grey ash haze — kept thin enough to read the far rim (coldharbor rule)
  scene.fog = new THREE.FogExp2(0x4d4340, 0.0095);

  const sun = new THREE.DirectionalLight(0xff9a62, 2.6);
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

  // dim, warm ambient: sky is smoke, ground is hot rock. The map is meant to
  // be the darkest of the set — the lava lights carry the crater floor.
  const hemi = new THREE.HemisphereLight(0x5a5257, 0x4a322a, 0.9);
  scene.add(hemi);

  // static lava glow — created once at build, never touched again
  // (the runtime never adds or removes lights; see district7's interior lamps)
  for (const [px, pz, pr] of POOLS) {
    const glow = new THREE.PointLight(0xff6a22, 60 * (pr / 4), pr * 9, 2);
    glow.position.set(px, LAVA_Y + 1.2, pz);
    scene.add(glow);
  }

  // ---------------------------------------------------------------- terrain
  physics.setTerrain({
    heightAt, minX: -R - 40, maxX: R + 40, minZ: -R - 40, maxZ: R + 40, surface: 'concrete',
  });
  const terrainMesh = buildTerrainMesh();
  scene.add(terrainMesh);
  const lavaMeshes = buildLavaMeshes();
  for (const m of lavaMeshes) scene.add(m);

  poolRims(B);
  drillRig(B);
  saddleCheckpoints(B);
  shacks(B);
  columns(B);
  scatter(B);

  const meshes = B.commit();
  meshes.push(terrainMesh, ...lavaMeshes);
  physics.build();
  return { sun, hemi, sky, meshes, sunDir, stairRuns: B.stairRuns || [] };
}

/** Displaced grid coloured by slope and height: ash, basalt, hot rock. */
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
  const ash = new THREE.Color(0x635c56), basalt = new THREE.Color(0x2e2c30);
  const scoria = new THREE.Color(0x5c352a), ember = new THREE.Color(0xb44420);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const slope = 1 - nrm.getY(i);
    const y = pos.getY(i);
    const x = pos.getX(i), z = pos.getZ(i);
    c.copy(ash);
    if (y > 3.0) c.lerp(scoria, Math.min(1, (y - 3.0) / 3.0) * 0.7);  // rim burn
    // high thresholds — see the Cold Harbor note on slope-tint creep
    if (slope > 0.26) c.lerp(basalt, Math.min(1, (slope - 0.26) / 0.28));
    // rock heats up toward the pools: an emissive-looking gradient baked into
    // the vertex colours, cheap and static
    for (const [px, pz, pr] of POOLS) {
      const d = Math.hypot(x - px, z - pz);
      if (d < pr + 6) c.lerp(ember, (1 - Math.max(0, d - pr) / 6) * 0.8);
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** The lava surfaces: emissive discs floating just above the pool floors. */
function buildLavaMeshes() {
  const meshes = [];
  const m = new THREE.MeshBasicMaterial({ color: 0xff7a1e, fog: false });
  for (const [px, pz, pr] of POOLS) {
    const geo = new THREE.CircleGeometry(pr + 0.8, 26);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(px, LAVA_Y, pz);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
  }
  return meshes;
}

/** Smoke-brown gradient sky with a dull red sun and an ember horizon. */
function ashSky(sunDir) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: sunDir.clone().normalize() } },
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 top = vec3(0.13,0.10,0.11);
        vec3 mid = vec3(0.30,0.22,0.19);
        vec3 horizon = vec3(0.48,0.30,0.20);
        vec3 ground = vec3(0.24,0.18,0.16);
        vec3 col;
        if (h > 0.0) {
          col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
          col = mix(col, top, smoothstep(0.15, 0.8, pow(clamp(h,0.0,1.0), 0.6)));
        } else {
          col = mix(horizon, ground, smoothstep(0.0, 0.25, -h));
        }
        float sd = max(dot(d, uSun), 0.0);
        // a dull red disc barely burning through the smoke
        col += vec3(1.0,0.42,0.18) * pow(sd, 260.0) * 1.5;
        col += vec3(0.9,0.45,0.22) * pow(sd, 10.0) * 0.22;
        // ember glow all along the horizon band
        col += vec3(0.55,0.20,0.08) * exp(-abs(h) * 9.0) * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------

/** Basalt block rims around each pool: cover that doubles as the fence
 *  keeping everyone out of the lava. Two gaps per pool would invite people
 *  in, so the ring is closed. */
function poolRims(B) {
  let s = 1200;
  for (const [px, pz, pr] of POOLS) {
    const n = Math.max(9, Math.round(pr * 2.6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = pr + 1.6;
      const x = px + Math.cos(a) * rr, z = pz + Math.sin(a) * rr;
      const y = heightAt(x, z);
      const sc = 0.9 + ((i * 7) % 5) * 0.14;
      B.box('concrete', {
        x, y: y - 0.3, z, w: sc * 1.5, h: 1.15 + ((i * 3) % 4) * 0.22, d: sc * 1.3,
        yaw: a + 0.4, tint: 0x2c292d, seed: s++, scale: 1.8,
      });
    }
  }
}

/** The drill rig: the crater-floor strongpoint. A steel derrick with a deck
 *  at 2.6 and a small crow's nest at 6.2, plus generator sheds around it. */
function drillRig(B) {
  const y = heightAt(2, 8);
  // deck on legs
  for (const [ox, oz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]])
    B.box('metal', { x: 2 + ox, y, z: 8 + oz, w: 0.5, h: 2.6, d: 0.5, tint: 0x53504e, seed: 1300 });
  B.box('metal', { x: 2, y: y + 2.6, z: 8, w: 10, h: 0.25, d: 10, tint: 0x5e5a56, seed: 1301, scale: 2 });
  // deck rail with two gaps (stair arrival + a drop toward the west pool)
  for (const [x1, z1, x2, z2] of [[-3, 3, 7, 3], [7, 13, -3, 13]])
    B.wall('metal', x1, z1, x2, z2, 0.95, 0.12, [{ at: 4, w: 2.2, y0: 0, y1: 0.95 }],
      { seed: 1302, base: y + 2.85, opaque: false, tint: 0x53504e });
  B.wall('metal', -3, 3, -3, 13, 0.95, 0.12, [], { seed: 1303, base: y + 2.85, opaque: false, tint: 0x53504e });
  B.wall('metal', 7, 3, 7, 13, 0.95, 0.12, [{ at: 4, w: 2.6, y0: 0, y1: 0.95 }], { seed: 1304, base: y + 2.85, opaque: false, tint: 0x53504e });
  // stair to the deck
  B.stairs('metal', 8.1 + 8 * 0.42, y, 8, '-x', 8, 2.85 / 8, 0.42, 2.6);
  // derrick above the deck with a crow's nest
  for (const [ox, oz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]])
    B.box('metal', { x: 2 + ox, y: y + 2.85, z: 8 + oz, w: 0.3, h: 3.35, d: 0.3, tint: 0x484543, seed: 1306 });
  B.box('metal', { x: 2, y: y + 6.2, z: 8, w: 4.6, h: 0.2, d: 4.6, tint: 0x5e5a56, seed: 1307, scale: 2 });
  for (const [x1, z1, x2, z2] of [[-0.3, 5.7, 4.3, 5.7], [4.3, 10.3, -0.3, 10.3], [-0.3, 10.3, -0.3, 5.7]])
    B.wall('metal', x1, z1, x2, z2, 0.9, 0.1, [], { seed: 1308, base: y + 6.4, opaque: false, tint: 0x484543 });
  B.wall('metal', 4.3, 5.7, 4.3, 10.3, 0.9, 0.1, [{ at: 1.2, w: 2.0, y0: 0, y1: 0.9 }], { seed: 1309, base: y + 6.4, opaque: false, tint: 0x484543 });
  B.stairs('metal', 5.4, y + 2.85, 6.2, '-x', 10, 3.55 / 10, 0.34, 1.6);
  // drill string dropping through the deck (visual)
  B.cyl('metal', { x: 2, y, z: 8, r: 0.4, h: 6.2, seg: 10, tint: 0x3c3a38, seed: 1310, collide: false });

  // generator sheds + pipe run on the floor around the rig
  B.box('corrugated', { x: -5, y: heightAt(-5, 14), z: 14, w: 5, h: 2.6, d: 3.6, tint: 0x6a5646, seed: 1312, scale: 2 });
  B.box('metal', { x: -5, y: heightAt(-5, 14) + 2.6, z: 14, w: 5.4, h: 0.2, d: 4.0, tint: 0x53504e, seed: 1313, walkable: true });
  B.box('corrugated', { x: 10, y: heightAt(10, 2), z: 2, w: 4, h: 2.4, d: 3.2, tint: 0x5c584e, seed: 1314, scale: 2 });
  for (let i = 0; i < 4; i++)
    B.cyl('metal', { x: -2 + i * 1.1, y: heightAt(-2 + i * 1.1, 17), z: 17, r: 0.44, h: 1.1, seg: 10, tint: [0x8a4a2a, 0x4a4a4c][i % 2], seed: 1316 + i });
  crateStack(B, 8, 12.5, 3, 1320);
}

/** The saddle checkpoints: a concrete pillbox on each rim crossing. */
function saddleCheckpoints(B) {
  const box = (cx, cz, seed) => {
    const y = heightAt(cx, cz);
    const O = { seed, scale: 2.5, base: y, tint: 0x6e6a64 };
    const slit = (at) => ({ at, w: 2.0, y0: 1.2, y1: 1.9 });
    B.wall('concrete', cx - 3.5, cz - 3, cx + 3.5, cz - 3, 2.6, 0.45, [slit(2.5)], O);
    B.wall('concrete', cx - 3.5, cz + 3, cx + 3.5, cz + 3, 2.6, 0.45, [slit(2.5)], O);
    B.wall('concrete', cx - 3.5, cz - 3, cx - 3.5, cz + 3, 2.6, 0.45, [{ at: 2, w: 2.0, y0: 0, y1: 2.2 }], O);
    B.wall('concrete', cx + 3.5, cz - 3, cx + 3.5, cz + 3, 2.6, 0.45, [{ at: 2, w: 2.0, y0: 0, y1: 2.2 }], O);
    B.box('concrete', { x: cx, y: y + 2.6, z: cz, w: 7.6, h: 0.3, d: 6.6, tint: 0x625e58, seed: seed + 1, scale: 3 });
    // roof parapet, gap over the stair
    for (const [x1, z1, x2, z2] of [[cx - 3.5, cz - 3, cx + 3.5, cz - 3], [cx + 3.5, cz + 3, cx - 3.5, cz + 3],
                                    [cx - 3.5, cz + 3, cx - 3.5, cz - 3]])
      B.wall('concrete', x1, z1, x2, z2, 0.75, 0.25, [], { seed: seed + 2, base: y + 2.9, tint: 0x5c5852 });
    B.wall('concrete', cx + 3.5, cz - 3, cx + 3.5, cz + 3, 0.75, 0.25,
      [{ at: 1.8, w: 2.6, y0: 0, y1: 0.75 }], { seed: seed + 3, base: y + 2.9, tint: 0x5c5852 });
    B.stairs('metal', cx + 3.6 + 8 * 0.4, y, cz, '-x', 8, 2.9 / 8, 0.4, 2.4);
    // dragon-teeth blocks flanking the saddle road
    for (const s2 of [-1, 1]) for (let i = 0; i < 3; i++) {
      const bx = cx + s2 * (6 + i * 2.2), bz = cz - s2 * (5 + i * 1.4);
      B.box('concrete', { x: bx, y: heightAt(bx, bz), z: bz, w: 1.2, h: 1.1, d: 1.2, yaw: i * 0.5, tint: 0x565258, seed: seed + 10 + i, scale: 1.5 });
    }
  };
  box(22, -22, 1400);
  box(-22, 22, 1430);
}

/** Outer-slope shacks: half-way cover between the spawns and the saddles. */
function shacks(B) {
  const shack = (cx, cz, seed) => {
    const y = heightAt(cx, cz);
    const O = { seed, scale: 2.5, base: y, tint: 0x6a5c50 };
    B.wall('corrugated', cx - 4, cz - 3, cx + 4, cz - 3, 2.8, 0.25, [{ at: 3, w: 2.0, y0: 0, y1: 2.3 }], O);
    B.wall('corrugated', cx - 4, cz + 3, cx + 4, cz + 3, 2.8, 0.25, [{ at: 1.5, w: 1.5, y0: 1.1, y1: 2.3 }], O);
    B.wall('corrugated', cx - 4, cz - 3, cx - 4, cz + 3, 2.8, 0.25, [{ at: 2, w: 1.8, y0: 0, y1: 2.3 }], O);
    B.wall('corrugated', cx + 4, cz - 3, cx + 4, cz + 3, 2.8, 0.25, [{ at: 2, w: 1.5, y0: 1.1, y1: 2.3 }], O);
    B.box('corrugated', { x: cx, y: y + 2.8, z: cz, w: 8.6, h: 0.22, d: 6.6, tint: 0x585048, seed: seed + 1, scale: 3 });
    B.box('crate', { x: cx - 2, y, z: cz + 1, w: 1.3, h: 1.3, d: 1.3, seed: seed + 2, scale: 1.5 });
    crateStack(B, cx + 5.5, cz - 1.5, 2, seed + 4);
  };
  shack(-24, -20, 1500);
  shack(26, 18, 1520);
}

/** Basalt column clusters: the crater floor's cover, in place of buildings. */
function columns(B) {
  let s = 1600;
  const cluster = (cx, cz, n, baseR) => {
    for (let i = 0; i < n; i++) {
      const a = i * 2.399 + cx;
      const r = (i % 3) * 1.1 + ((i * 13) % 7) * 0.3;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = heightAt(x, z);
      const h = 1.2 + ((i * 11) % 9) * 0.45;
      B.cyl('concrete', {
        x, y: y - 0.4, z, r: baseR + ((i * 5) % 3) * 0.14, h: h + 0.4, seg: 6,
        yaw: a, tint: 0x35323a, seed: s++, scale: 1.6,
      });
    }
  };
  cluster(-12, -8, 7, 0.85);
  cluster(10, 16, 6, 0.9);
  cluster(-4, 18, 5, 0.8);
  cluster(16, -12, 6, 0.85);
  cluster(-18, 4, 5, 0.9);
}

/** Cinder heaps and fumarole stones on the outer slopes. */
function scatter(B) {
  let s = 1700;
  const rnd = (() => { let v = 192837465; return () => { v = (v * 1103515245 + 12345) & 0x7fffffff; return v / 0x7fffffff; }; })();

  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.283, r = 34 + rnd() * 16;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (PADS.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr + 3)) continue;
    const y = heightAt(x, z);
    const sc = 0.8 + rnd() * 1.8;
    B.box('concrete', {
      x, y: y - sc * 0.3, z, w: sc * 1.7, h: sc * 1.3, d: sc * 1.5,
      yaw: rnd() * 3.14, tint: 0x3a363c, seed: s++, scale: 2,
    });
  }

  // dead snags: burnt trunks, no canopy
  for (let i = 0; i < 12; i++) {
    const a = rnd() * 6.283, r = 38 + rnd() * 12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (PADS.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr + 2)) continue;
    const y = heightAt(x, z);
    B.cyl('wood', { x, y, z, r: 0.2, rTop: 0.06, h: 3.0 + rnd() * 2.5, seg: 6, tint: 0x241f1c, seed: s++ });
  }
}
