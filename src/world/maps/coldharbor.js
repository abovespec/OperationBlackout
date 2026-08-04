// COLD HARBOR — a snowbound listening station at dusk.
//
// Deliberately unlike the other two, in terrain and in look:
//   * The ground is a heightfield, not a plane: rolling drifts, a ridge along
//     the north, a frozen inlet cut into the south. Elevation itself is cover,
//     and sightlines break over crests rather than around walls.
//   * Structures are sparse and scattered — prefab huts, fuel tanks, a radar
//     dish — so fights are fought across open snow between islands of cover.
//   * Palette and light are cold: a low blue-white dusk, heavy fog, long
//     shadows, no warm bounce. The other two maps are warm daylight.
import * as THREE from 'three';
import { MapBuilder, crateStack } from '../builder.js';
import { mat, flat } from '../textures.js';

const R = 52;

// ---------------------------------------------------------------- heightfield

/** Deterministic value noise, smooth enough to walk on. */
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

const noise = makeNoise(20260802);

/**
 * Terrain height. Kept as a pure function so physics, the navmesh and the mesh
 * all agree exactly — sampling a baked grid in one place and a function in
 * another is how characters end up hovering or sunk.
 */
export function heightAt(x, z) {
  let h = 0;
  h += noise(x * 0.018, z * 0.018) * 5.2;      // broad rolls
  h += noise(x * 0.045, z * 0.045) * 1.9;      // drifts
  h += noise(x * 0.115, z * 0.115) * 0.55;     // surface texture

  // ridge along the north edge, high ground overlooking the station
  const ridge = Math.exp(-((z + 34) * (z + 34)) / 260) * 6.5;
  h += ridge * (0.6 + 0.4 * noise(x * 0.05, 3.7));

  // frozen inlet to the south: a flat, low basin with soft banks
  // Gentle banks on purpose: a sharp rim turns the basin into a pit the
  // navmesh cannot connect, stranding anything that walks into it.
  const inlet = Math.exp(-((z - 33) * (z - 33)) / 900) * Math.exp(-(x * x) / 2600);
  h = h * (1 - inlet * 0.72) - inlet * 1.5;

  // flat pads under the compound so buildings sit level
  for (const [px, pz, pr, ph] of PADS) {
    const d = Math.hypot(x - px, z - pz);
    if (d < pr + 4) {
      const t = 1 - Math.min(1, Math.max(0, (d - pr) / 4));
      h = h * (1 - t) + ph * t;
    }
  }
  return h;
}

// pads: [x, z, radius, height] — carved flat so structures do not float
const PADS = [
  [0, 0, 15, 1.2],
  [-26, -12, 9, 2.4],
  [26, -10, 9, 2.1],
  [-22, 20, 8, 0.2],
  [24, 22, 8, 0.3],
  [0, -30, 10, 5.0],
];

export const INFO = {
  name: 'COLD HARBOR',
  bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R },
  nav: { minX: -R, maxX: R, minZ: -R, maxZ: R, cell: 1.2 },
  spawns: {
    blue: [[-38, 34], [-44, 26], [-30, 40], [-42, 40], [-24, 34], [-36, 22]],
    red: [[38, -34], [44, -26], [30, -40], [42, -40], [24, -34], [36, -22]],
  },
  hotspots: [
    [0, 0], [0, -14], [0, 14], [-14, 0], [14, 0],
    [-26, -12], [26, -10], [-22, 20], [24, 22],
    [0, -30], [-34, 0], [34, 0], [0, 34], [-16, -26], [16, 26],
    [0, -30, 9.0],       // radar platform
    [-26, -12, 6.1],     // hut roofs
    [26, -10, 5.8],
    [-22, 20, 3.7], [24, 22, 3.8],
  ],
};

export function build(scene, physics) {
  const B = new MapBuilder(scene, physics);
  // low, cold, raking light from the north-west
  // Lifted from 0.17 (~10 degrees) to ~18: at the old grazing angle the snow
  // plane caught almost no direct light, so the terrain relief was invisible
  // and only a big ambient term made the map readable at all. Still low enough
  // for long dusk shadows, high enough that ridges and drifts have a lit side.
  const sunDir = new THREE.Vector3(-0.62, 0.31, -0.77).normalize();

  // ---------------------------------------------------------------- sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 72, 44), duskSky(sunDir));
  sky.matrixAutoUpdate = false;
  sky.frustumCulled = false;
  scene.add(sky);
  // Fog was thick enough (0.0165) that a building at 60 m was a grey smear.
  // Counter-Strike maps stay legible the whole length of their longest angle —
  // you have to be able to identify a shape at the far end of a sightline and
  // decide whether to take the fight. Half the density, and pull the colour
  // down off pure sky-white so distant geometry keeps an edge against it.
  scene.fog = new THREE.FogExp2(0x8ea6ba, 0.0082);

  const sun = new THREE.DirectionalLight(0xdcebff, 3.9);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Tighter than the map: the frustum is re-centred on the player every frame
  // (Game.update), so a 48 m box spends its texels where they are visible
  // instead of smearing them over terrain nobody is looking at.
  sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  // Snow bounces a lot of light back up, but the old 2.2 hemisphere plus a
  // near-white ground colour lifted the shadows almost to the level of the lit
  // faces, so the whole map read as one flat sheet of white and players did not
  // silhouette against it. Ambient now sits well under the sun and the bounce
  // colour is a cold grey-blue, which is what leaves contrast on the terrain.
  const hemi = new THREE.HemisphereLight(0x7d9fc8, 0xa8bccd, 1.05);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x9ab6d4, 0.32);
  fill.position.set(0.7, 0.5, 0.6).multiplyScalar(60);
  scene.add(fill);

  // ---------------------------------------------------------------- terrain
  physics.setTerrain({
    heightAt, minX: -R - 40, maxX: R + 40, minZ: -R - 40, maxZ: R + 40, surface: 'snow',
  });
  const terrainMesh = buildTerrainMesh();
  scene.add(terrainMesh);

  station(B);
  ridgeLine(B);
  inletProps(B);
  scatter(B);

  const meshes = B.commit();
  meshes.push(terrainMesh);
  physics.build();
  return { sun, hemi, sky, meshes, sunDir, stairRuns: B.stairRuns || [] };
}

/** Displaced grid, coloured by slope and height: snow, rock, ice. */
function buildTerrainMesh() {
  const N = 200, SIZE = (R + 40) * 2;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  // vertex colours: rock on steep faces, blue ice in the basin, snow elsewhere
  const col = new Float32Array(pos.count * 3);
  const nrm = geo.attributes.normal;
  const snow = new THREE.Color(0xdde9f4), rock = new THREE.Color(0x5c6169);
  const ice = new THREE.Color(0x9dc0d4), dirt = new THREE.Color(0x7d8288);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const slope = 1 - nrm.getY(i);
    const y = pos.getY(i);
    c.copy(snow);
    // Thresholds are deliberately high: `1 - normal.y` is nonzero on even gentle
    // ground, and blending dirt in that early turned the whole field brown.
    if (y < -1.0) c.lerp(ice, Math.min(1, (-1.0 - y) / 1.6));
    if (slope > 0.30) c.lerp(rock, Math.min(1, (slope - 0.30) / 0.34));
    else if (slope > 0.16) c.lerp(dirt, (slope - 0.16) / 0.14 * 0.45);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,          // snow is diffuse; anything glossier sparkles
    metalness: 0.0,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Cold dusk gradient with a low sun near the horizon. */
function duskSky(sunDir) {
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
        vec3 top = vec3(0.07,0.13,0.26);
        vec3 mid = vec3(0.36,0.48,0.62);
        vec3 horizon = vec3(0.80,0.83,0.86);
        vec3 ground = vec3(0.52,0.58,0.64);
        vec3 col;
        if (h > 0.0) {
          col = mix(horizon, mid, smoothstep(0.0, 0.26, h));
          col = mix(col, top, smoothstep(0.18, 0.9, pow(clamp(h,0.0,1.0), 0.6)));
        } else {
          col = mix(horizon, ground, smoothstep(0.0, 0.3, -h));
        }
        float sd = max(dot(d, uSun), 0.0);
        // a cold, diffuse sun low on the horizon — no hard disc
        col += vec3(1.0,0.93,0.86) * pow(sd, 420.0) * 1.6;
        col += vec3(0.85,0.90,1.00) * pow(sd, 14.0) * 0.20;
        col += vec3(0.70,0.80,0.95) * pow(sd, 3.0) * 0.10;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------

/** The station itself: prefab huts around a central yard. */
function station(B) {
  // Huts sit flat on their carved pad with a floor slab, doors on two opposite
  // faces, and an external stair to the roof. Earlier they stood on stilts with
  // a stair that landed beside a blank wall — unreachable in practice.
  const hut = (cx, cz, w, d, h, seed) => {
    const y = heightAt(cx, cz);
    const hw = w / 2, hd = d / 2;
    const door = (at) => ({ at, w: 2.2, y0: 0, y1: 2.4 });
    const win = (at) => ({ at, w: 1.7, y0: 1.1, y1: 2.4 });
    const O = { seed, scale: 2.5, base: y, tint: 0x9aa6ae };

    B.box('metal', { x: cx, y: y - 0.25, z: cz, w: w + 0.5, h: 0.3, d: d + 0.5, tint: 0x6a727a, seed: seed + 9, scale: 3 });
    B.wall('corrugated', cx - hw, cz - hd, cx + hw, cz - hd, h, 0.3, [door(w * 0.5)], O);
    B.wall('corrugated', cx - hw, cz + hd, cx + hw, cz + hd, h, 0.3, [door(w * 0.5)], O);
    B.wall('corrugated', cx - hw, cz - hd, cx - hw, cz + hd, h, 0.3, [win(d * 0.32), win(d * 0.68)], O);
    B.wall('corrugated', cx + hw, cz - hd, cx + hw, cz + hd, h, 0.3, [win(d * 0.32), win(d * 0.68)], O);
    B.box('corrugated', { x: cx, y: y + h, z: cz, w: w + 0.7, h: 0.3, d: d + 0.7, tint: 0x7f8b94, seed: seed + 1, scale: 3 });
    // parapet with a gap where the stair arrives
    for (const [x1, z1, x2, z2] of [[cx - hw, cz - hd, cx + hw, cz - hd], [cx + hw, cz + hd, cx - hw, cz + hd],
                                    [cx - hw, cz + hd, cx - hw, cz - hd]])
      B.wall('metal', x1, z1, x2, z2, 0.9, 0.16, [], { seed: seed + 2, base: y + h + 0.3, tint: 0x6d747a });
    B.wall('metal', cx + hw, cz - hd, cx + hw, cz + hd, 0.9, 0.16,
      [{ at: d * 0.5 - 1.6, w: 3.2, y0: 0, y1: 0.9 }], { seed: seed + 3, base: y + h + 0.3, tint: 0x6d747a });
    // outside stair up the +x face
    const steps = Math.max(6, Math.round((h + 0.3) / 0.34));
    B.stairs('metal', cx + hw + 0.9 + steps * 0.4, y, cz, '-x', steps, (h + 0.3) / steps, 0.4, 3.0);
    // interior cover
    B.box('crate', { x: cx - w * 0.28, y, z: cz + d * 0.24, w: 1.4, h: 1.4, d: 1.4, seed: seed + 4, scale: 1.5 });
    B.box('metal', { x: cx + w * 0.26, y, z: cz - d * 0.22, w: 2.2, h: 1.1, d: 1.3, tint: 0x59616a, seed: seed + 5, scale: 1.5 });
  };

  hut(-26, -12, 11, 9, 3.4, 300);
  hut(26, -10, 11, 9, 3.4, 320);
  hut(-22, 20, 10, 8, 3.2, 340);
  hut(24, 22, 10, 8, 3.2, 360);

  // central yard: fuel tanks, a generator shed, cargo
  const y0 = heightAt(0, 0);
  B.cyl('metal', { x: -6, y: y0, z: 4, r: 2.6, h: 5.0, seg: 16, tint: 0x8e9298, seed: 380, scale: 2.5 });
  B.cyl('metal', { x: 1, y: y0, z: 6, r: 2.6, h: 5.0, seg: 16, tint: 0x8e9298, seed: 381, scale: 2.5 });
  B.box('metal', { x: -2.5, y: y0 + 5.0, z: 5, w: 12, h: 0.25, d: 3.2, tint: 0x6d747a, seed: 382, walkable: true });
  B.stairs('metal', 5.4, y0, 6, '-x', 14, 0.36, 0.42, 2.4);

  B.box('corrugated', { x: 7, y: y0, z: -5, w: 7, h: 3.0, d: 5, tint: 0x8a949c, seed: 384, scale: 2.5 });
  B.box('corrugated', { x: 7, y: y0 + 3.0, z: -5, w: 7.6, h: 0.3, d: 5.6, tint: 0x757f87, seed: 385, scale: 3 });
  B.box('metal', { x: -8, y: y0, z: -6, w: 4.5, h: 1.3, d: 2.6, tint: 0x59616a, seed: 386, scale: 1.5 });
  crateStack(B, -11, 1, 4, 390);
  crateStack(B, 9, 3, 3, 394);

  // low blast walls giving cover in the open yard
  for (const [x, z, yaw] of [[-13, -3, 0], [12, 8, 0], [-3, 12, Math.PI / 2], [3, -12, Math.PI / 2]]) {
    B.box('concrete', { x, y: heightAt(x, z), z, w: 6.5, h: 1.35, d: 0.8, yaw, seed: 398, scale: 2, tint: 0xb9c2ca });
  }
}

/** The northern ridge: a radar platform and dug-in positions on high ground. */
function ridgeLine(B) {
  const y = heightAt(0, -30);
  // radar mast with a stair tower
  for (const [ox, oz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]])
    B.box('metal', { x: ox, y, z: -30 + oz, w: 0.4, h: 8.4, d: 0.4, tint: 0x5d646c, seed: 400 });
  B.box('metal', { x: 0, y: y + 8.4, z: -30, w: 8.4, h: 0.25, d: 8.4, tint: 0x6d747a, seed: 401, scale: 2 });
  for (const [x1, z1, x2, z2] of [[-4.2, -34.2, 4.2, -34.2], [4.2, -34.2, 4.2, -25.8],
                                  [4.2, -25.8, -4.2, -25.8], [-4.2, -25.8, -4.2, -34.2]])
    B.wall('metal', x1, z1, x2, z2, 1.0, 0.12, [{ at: 3.2, w: 2.2, y0: 0, y1: 1.0 }],
      { seed: 402, base: y + 8.65, opaque: false, tint: 0x6d747a });
  B.cyl('metal', { x: 1.6, y: y + 8.65, z: -31.5, r: 0.35, h: 3.2, seg: 10, tint: 0x8a9198, seed: 403 });
  B.box('metal', { x: 1.6, y: y + 11.5, z: -31.5, w: 5.2, h: 0.35, d: 3.4, yaw: 0.5, tint: 0xa6adb4, seed: 404, scale: 2, collide: false });
  B.stairs('metal', -7.6, y, -30, '+x', 12, 0.36, 0.40, 3.0);
  B.box('metal', { x: -1.4, y: y + 4.32, z: -30, w: 3.2, h: 0.2, d: 3.0, tint: 0x6d747a, seed: 405 });
  B.stairs('metal', -1.4, y + 4.32, -28.6, '+z', 12, 0.34, 0.40, 3.0);

  // sandbag positions dug into the ridge, facing the station
  for (const [sx, sz] of [[-16, -26], [16, -26], [-30, -24], [30, -24]]) {
    const sy = heightAt(sx, sz);
    for (let r = 0; r < 2; r++) for (let i = -3; i <= 3; i++) {
      B.box('sandbag', {
        x: sx + i * 0.62, y: sy + r * 0.34, z: sz, w: 0.66, h: 0.35, d: 0.42,
        yaw: (i % 2) * 0.1, seed: 410 + r, scale: 0.8, tint: 0xb8bec4,
      });
    }
  }
}

/** The frozen inlet: exposed low ground, with wrecks to hide behind. */
function inletProps(B) {
  // a beached hull, the biggest single piece of cover on the map
  const hy = heightAt(-6, 30);
  B.box('metal', { x: -6, y: hy + 0.1, z: 30, w: 18, h: 3.4, d: 6.0, yaw: 0.22, tint: 0x4f5a62, seed: 420, scale: 3 });
  B.box('metal', { x: -2, y: hy + 3.5, z: 31, w: 6, h: 2.4, d: 4.4, yaw: 0.22, tint: 0x5d6870, seed: 421, scale: 2 });
  B.box('metal', { x: -6, y: hy + 3.5, z: 30, w: 18.4, h: 0.2, d: 6.2, yaw: 0.22, tint: 0x6a757d, seed: 422, walkable: true });
  B.stairs('metal', 6.6, hy, 28.0, '-x', 11, 0.34, 0.42, 3.0);

  // ice-locked containers and drums
  const cont = (x, z, yaw, tint, seed) => {
    const y = heightAt(x, z);
    B.box('corrugated', { x, y, z, w: 6.1, h: 2.6, d: 2.44, yaw, tint, seed, scale: 1.2 });
    B.box('metal', { x, y: y + 2.6, z, w: 6.2, h: 0.1, d: 2.5, yaw, tint: 0x6e6e70, seed: seed + 1, walkable: true });
  };
  cont(-20, 34, 0.4, 0x7a6a5a, 430);
  cont(14, 32, -0.3, 0x5a6a7a, 432);
  cont(2, 40, 1.2, 0x6a7a6a, 434);
  for (let i = 0; i < 10; i++) {
    const a = i * 2.399, r = 8 + (i % 4) * 5;
    const x = Math.cos(a) * r, z = 30 + Math.sin(a) * r * 0.5;
    B.cyl('metal', { x, y: heightAt(x, z), z, r: 0.44, h: 1.1, seg: 10, tint: 0x6a7078, seed: 440 + i });
  }
}

/** Rocks and dead pines across the open ground, to break up the sightlines. */
function scatter(B) {
  let s = 500;
  const rnd = (() => { let v = 987654321; return () => { v = (v * 1103515245 + 12345) & 0x7fffffff; return v / 0x7fffffff; }; })();

  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.283, r = 14 + rnd() * 34;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(z + 30) < 9 && Math.abs(x) < 9) continue;      // keep the radar pad clear
    const y = heightAt(x, z);
    const sc = 0.9 + rnd() * 2.2;
    B.box('concrete', {
      x, y: y - sc * 0.3, z, w: sc * 1.9, h: sc * 1.5, d: sc * 1.6,
      yaw: rnd() * 3.14, tint: 0x6e747c, seed: s++, scale: 2,
    });
    if (rnd() > 0.5) {
      B.box('concrete', {
        x: x + sc * 0.7, y: y - 0.2, z: z + sc * 0.4, w: sc * 1.1, h: sc * 0.9, d: sc * 1.0,
        yaw: rnd() * 3.14, tint: 0x767c84, seed: s++, scale: 2,
      });
    }
  }

  // dead pines: trunk plus a few drooping tiers, snow-loaded
  for (let i = 0; i < 30; i++) {
    const a = rnd() * 6.283, r = 18 + rnd() * 32;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z) < 17) continue;
    const y = heightAt(x, z);
    const th = 4.5 + rnd() * 3.5;
    B.cyl('wood', { x, y, z, r: 0.22, rTop: 0.12, h: th, seg: 7, tint: 0x4a3b30, seed: s++ });
    for (let k = 0; k < 3; k++) {
      const t = 0.42 + k * 0.19;
      B.cyl('sandbag', {
        x, y: y + th * t, z, r: 1.5 - k * 0.36, rTop: 0.1, h: 1.5 - k * 0.25, seg: 8,
        tint: 0xc9d6e0, seed: s++, collide: false, scale: 1.5,
      });
    }
  }
}
