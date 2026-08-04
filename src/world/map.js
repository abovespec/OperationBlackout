// District 7 — the arena. Everything here is built from boxes and cylinders, merged
// per-material into a handful of draw calls, with a matching set of physics colliders.
import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, flat, skyMaterial } from './textures.js';

const TEXEL = 2.0; // metres per texture tile

export class MapBuilder {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.buckets = new Map();   // materialKey -> { material, geoms[] }
    this.lights = [];
  }

  _push(key, material, geo) {
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, b = { material, geoms: [] });
    b.geoms.push(geo);
  }

  /** Scale box UVs so every face shares one texel density. */
  _uvBox(geo, w, h, d, scale = TEXEL) {
    const uv = geo.attributes.uv;
    const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const [fw, fh] = faces[f];
      for (let i = 0; i < 4; i++) {
        const idx = f * 4 + i;
        uv.setXY(idx, uv.getX(idx) * fw / scale, uv.getY(idx) * fh / scale);
      }
    }
    return geo;
  }

  /**
   * Add a (optionally rotated) box of geometry + collider.
   * @param {string|THREE.Material} m material key or material
   */
  box(m, o) {
    const { x = 0, y = 0, z = 0, w = 1, h = 1, d = 1, yaw = 0 } = o;
    const material = typeof m === 'string' ? this.matFor(m, o) : m;
    const key = (typeof m === 'string' ? m + (o.tint || '') + (o.scale || '') : material.uuid);
    const geo = this._uvBox(new THREE.BoxGeometry(w, h, d), w, h, d, o.scale || TEXEL);
    geo.rotateY(yaw);
    geo.translate(x, y + h / 2, z);
    this._push(key, material, geo);
    if (o.collide !== false) {
      this.physics.addBox(x, y + h / 2, z, w, h, d, yaw, {
        surface: typeof m === 'string' ? m : 'concrete',
        opaque: o.opaque !== false,
        walkable: o.walkable !== false,
      });
    }
    return this;
  }

  cyl(m, o) {
    const { x = 0, y = 0, z = 0, r = 1, rTop = null, h = 1, seg = 16, yaw = 0 } = o;
    const material = typeof m === 'string' ? this.matFor(m, o) : m;
    const key = (typeof m === 'string' ? m + (o.tint || '') + 'c' : material.uuid);
    const geo = new THREE.CylinderGeometry(rTop ?? r, r, h, seg, 1, false);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / TEXEL, uv.getY(i) * h / TEXEL);
    geo.rotateY(yaw);
    geo.translate(x, y + h / 2, z);
    this._push(key, material, geo);
    if (o.collide !== false) {
      this.physics.addBox(x, y + h / 2, z, r * 1.75, h, r * 1.75, yaw, {
        opaque: o.opaque !== false, walkable: o.walkable !== false,
      });
    }
    return this;
  }

  matFor(kind, o = {}) {
    return mat(kind, { repeat: 1, seed: o.seed ?? 1337, color: o.tint, size: o.texSize ?? 512 });
  }

  /**
   * A wall from (x1,z1) to (x2,z2) with door / window openings.
   * openings: [{ at (metres along wall from start), w, y0, y1 }]
   */
  wall(m, x1, z1, x2, z2, height, thick, openings = [], opts = {}) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz) + Math.PI / 2; // wall runs along local X
    const base = opts.base ?? 0;
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const ux = dx / len, uz = dz / len;
    const at = (t, y, w, h) => {
      if (w <= 0.02 || h <= 0.02) return;
      const px = x1 + ux * (t + w / 2), pz = z1 + uz * (t + w / 2);
      this.box(m, { x: px, y, z: pz, w, h, d: thick, yaw, ...opts });
    };
    const sorted = [...openings].sort((a, b) => a.at - b.at);
    let cursor = 0;
    for (const op of sorted) {
      const s = op.at, e = op.at + op.w;
      at(cursor, base, s - cursor, height);
      const y0 = op.y0 ?? 0, y1 = op.y1 ?? height;
      if (y0 > 0.02) at(s, base, op.w, y0);                       // sill
      if (height - y1 > 0.02) at(s, base + y1, op.w, height - y1); // lintel
      cursor = e;
    }
    at(cursor, base, len - cursor, height);
    return { cx, cz, yaw, len };
  }

  /**
   * A horizontal slab with rectangular holes punched through it — stairwells,
   * roof hatches, bomb damage. Holes are [x0, z0, x1, z1] in world space.
   * The remaining area is emitted as axis-aligned rectangles.
   */
  slab(m, x0, z0, x1, z1, y, thick, holes = [], opts = {}) {
    let rects = [[x0, z0, x1, z1]];
    for (const h of holes) {
      const out = [];
      for (const r of rects) {
        const [ax0, az0, ax1, az1] = r;
        if (h[2] <= ax0 || h[0] >= ax1 || h[3] <= az0 || h[1] >= az1) { out.push(r); continue; }
        const cx0 = Math.max(ax0, h[0]), cx1 = Math.min(ax1, h[2]);
        const cz0 = Math.max(az0, h[1]), cz1 = Math.min(az1, h[3]);
        if (az0 < cz0 - 0.01) out.push([ax0, az0, ax1, cz0]);
        if (cz1 < az1 - 0.01) out.push([ax0, cz1, ax1, az1]);
        if (ax0 < cx0 - 0.01) out.push([ax0, cz0, cx0, cz1]);
        if (cx1 < ax1 - 0.01) out.push([cx1, cz0, ax1, cz1]);
      }
      rects = out;
    }
    for (const [ax0, az0, ax1, az1] of rects) {
      const w = ax1 - ax0, d = az1 - az0;
      if (w <= 0.05 || d <= 0.05) continue;
      this.box(m, { x: (ax0 + ax1) / 2, y, z: (az0 + az1) / 2, w, h: thick, d, ...opts });
    }
    return this;
  }

  /**
   * Straight run of steps. dir: '+x','-x','+z','-z'
   * Also records the run so the navmesh can stitch an explicit walkable spine
   * along it — sampling alone is not reliable enough on narrow staircases.
   */
  stairs(m, x, y, z, dir, steps, rise, run, width) {
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      const off = run * (i + 0.5);
      let px = x, pz = z, w = width, d = run;
      if (dir === '+x') { px = x + off; w = run; d = width; }
      else if (dir === '-x') { px = x - off; w = run; d = width; }
      else if (dir === '+z') { pz = z + off; }
      else { pz = z - off; }
      this.box(m, { x: px, y, z: pz, w, h, d, seed: 91 });
    }
    const len = run * steps;
    const sx = dir === '+x' ? 1 : dir === '-x' ? -1 : 0;
    const sz = dir === '+z' ? 1 : dir === '-z' ? -1 : 0;
    (this.stairRuns ||= []).push({
      // half a tread before the first step and after the last, so the spine
      // overlaps the floor at both ends
      x0: x - sx * run * 0.9, z0: z - sz * run * 0.9, y0: y,
      x1: x + sx * (len + run * 0.4), z1: z + sz * (len + run * 0.4), y1: y + rise * steps,
      width,
    });
    return this;
  }

  /** Finalise: merge every bucket into one mesh per material. */
  commit() {
    const meshes = [];
    for (const [key, b] of this.buckets) {
      const merged = BGU.mergeGeometries(b.geoms, false);
      if (!merged) { console.warn('merge failed for', key); continue; }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      meshes.push(mesh);
      b.geoms.length = 0;
    }
    this.buckets.clear();
    return meshes;
  }
}

// ---------------------------------------------------------------------------

export const MAP_INFO = {
  name: 'DISTRICT 7',
  bounds: { minX: -62, maxX: 62, minZ: -62, maxZ: 62 },
  // team spawn clusters
  // open ground only — never inside a building footprint
  spawns: {
    blue: [[-44, 14], [-52, 6], [-36, 6], [-16, 44], [-8, 54], [-19, 28], [-58, 24], [-30, 14]],
    red: [[44, -14], [52, -6], [36, -6], [16, -44], [8, -54], [19, -28], [58, -24], [30, -14]],
  },
  // Points of interest the bots patrol and fight over. The third element is a
  // height hint, which is what sends them up onto the catwalks and rooftops.
  hotspots: [
    [0, 0], [10, -8], [-10, 8], [-24, -26], [26, 30], [0, -26], [0, 26],
    [-26, 0], [26, 0], [30, -30], [-30, 30], [-2, -14], [14, 14], [-14, -14],
    [-15, -8, 4.45],   // plaza overpass
    [-17, 4.4, 2.7],   // container roof
    [-30, -34, 4.2],   // office second floor
    [-36, -44, 8.4],   // office roof
    [24.6, 38, 4.76],  // warehouse catwalk
    [37, 48, 4.76],
    [52, -32, 9.2],    // water tower
    [30, -51, 4.5],    // market shop roofs
    [48, -51, 4.5],
    [-46, 30, 7.7],    // apartment roof
    [-29, 37, 3.9],
  ],
};

export function buildMap(scene, physics) {
  const B = new MapBuilder(scene, physics);
  const sunDir = new THREE.Vector3(0.50, 0.40, -0.77).normalize();

  // ---------------------------------------------------------------- sky + light
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 72, 44), skyMaterial(sunDir));
  sky.matrixAutoUpdate = false;
  sky.frustumCulled = false;
  scene.add(sky);

  scene.fog = new THREE.FogExp2(0xc6ac86, 0.0048);

  const sun = new THREE.DirectionalLight(0xffdcac, 4.3);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // The frustum follows the player (Game.update), so it only has to cover what
  // is on screen — 55 m puts roughly 2.5x the texel density on near geometry
  // than the old map-sized 85 m box did, which is where shadow edges are read.
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x93b8e0, 0x94805c, 1.45);
  scene.add(hemi);
  // warm bounce from the sunlit ground, cool fill from the opposite side
  const bounce = new THREE.DirectionalLight(0xffc98a, 0.55);
  bounce.position.set(-0.5, -0.45, 0.7).multiplyScalar(60);
  scene.add(bounce);
  const fill = new THREE.DirectionalLight(0x94b6e0, 0.42);
  fill.position.set(-0.6, 0.55, 0.55).multiplyScalar(60);
  scene.add(fill);

  // ---------------------------------------------------------------- ground
  // sand base
  const sandGeo = new THREE.PlaneGeometry(300, 300, 1, 1);
  sandGeo.rotateX(-Math.PI / 2);
  const sandUV = sandGeo.attributes.uv;
  for (let i = 0; i < sandUV.count; i++) sandUV.setXY(i, sandUV.getX(i) * 60, sandUV.getY(i) * 60);
  const sandMesh = new THREE.Mesh(sandGeo, mat('sand', { seed: 4, size: 512 }));
  sandMesh.receiveShadow = true;
  sandMesh.matrixAutoUpdate = false;
  scene.add(sandMesh);
  physics.addBox(0, -1, 0, 400, 2, 400, 0, { surface: 'sand' });

  // asphalt streets: a big plus-shaped road network + central plaza
  const road = (x, z, w, d) => B.box('asphalt', { x, y: -0.06, z, w, h: 0.14, d, collide: false, seed: 77, scale: 4 });
  road(0, 0, 44, 44);         // plaza
  road(0, -38, 22, 34);       // north street
  road(0, 38, 22, 34);        // south street
  road(-38, 0, 34, 22);       // west street
  road(38, 0, 34, 22);        // east street
  road(-34, -34, 26, 12);
  road(34, 34, 26, 12);

  // sidewalks around the plaza
  const curb = (x, z, w, d) => B.box('concrete', { x, y: 0, z, w, h: 0.17, d, seed: 12, scale: 2, tint: 0xb8b2a6, walkable: true });
  curb(0, -23, 46, 1.7); curb(0, 23, 46, 1.7);
  curb(-23, 0, 1.7, 44); curb(23, 0, 1.7, 44);
  // faded road markings, so the streets read as streets
  const line = (x, z, w, d) => B.box('concrete', { x, y: 0.02, z, w, h: 0.03, d, collide: false, seed: 13, scale: 1.2, tint: 0xd8cfa8 });
  for (let i = -5; i <= 5; i++) {
    if (Math.abs(i) < 2) continue;
    line(0, i * 5.5 - 38, 0.28, 2.6);
    line(0, i * 5.5 + 38, 0.28, 2.6);
    line(i * 5.5 - 38, 0, 2.6, 0.28);
    line(i * 5.5 + 38, 0, 2.6, 0.28);
  }
  // plaza hatching around the fountain
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    line(Math.cos(a) * 16, Math.sin(a) * 16, i % 2 ? 0.3 : 14, i % 2 ? 14 : 0.3);
  }

  // ---------------------------------------------------------------- perimeter
  const PW = 62, PH = 9;
  for (const [x1, z1, x2, z2] of [
    [-PW, -PW, PW, -PW], [PW, -PW, PW, PW], [PW, PW, -PW, PW], [-PW, PW, -PW, -PW],
  ]) B.wall('concrete', x1, z1, x2, z2, PH, 2, [], { seed: 5, scale: 4 });

  // ============================================================== CENTRAL PLAZA
  buildPlaza(B);
  // ============================================================== OFFICE (NW)
  buildOffice(B);
  // ============================================================== WAREHOUSE (SE)
  buildWarehouse(B);
  // ============================================================== MARKET (NE)
  buildMarket(B);
  // ============================================================== APARTMENTS (SW)
  buildApartments(B);
  // ============================================================== ODDS AND ENDS
  buildStreetDetails(B);

  // Static interior lights. Created here, never added or removed later — the
  // interiors are otherwise unreadable black boxes under a low sun.
  const lamp = (x, y, z, color, intensity, dist) => {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  };
  // warehouse
  lamp(30, 7.5, 30, 0xffe6bd, 42, 26);
  lamp(44, 7.5, 32, 0xffe6bd, 42, 26);
  lamp(30, 7.5, 46, 0xffdcae, 36, 24);
  lamp(44, 6.0, 46, 0xffdcae, 30, 22);
  // office block, both floors
  lamp(-30, 3.4, -44, 0xffe0b8, 26, 20);
  lamp(-42, 3.4, -32, 0xffe0b8, 26, 20);
  lamp(-30, 7.4, -34, 0xffe0b8, 24, 20);
  lamp(-44, 7.4, -44, 0xffe0b8, 22, 18);
  // apartment ruins
  lamp(-46, 2.6, 30, 0xffd7a4, 20, 17);
  lamp(-28, 2.6, 36, 0xffd7a4, 18, 16);
  // market shop row
  lamp(38, 3.2, -51, 0xffd090, 18, 16);

  const meshes = B.commit();
  physics.build();

  return { sun, hemi, sky, meshes, sunDir, stairRuns: B.stairRuns || [] };
}

// ---------------------------------------------------------------------------

function buildPlaza(B) {
  // dry fountain in the middle — hard cover you can crouch behind and vault
  B.cyl('concrete', { x: 0, y: 0, z: 0, r: 6.4, h: 0.9, seg: 24, seed: 31 });
  B.cyl('tile', { x: 0, y: 0.9, z: 0, r: 5.5, h: 0.12, seg: 24, seed: 32, walkable: true });
  B.cyl('concrete', { x: 0, y: 0.9, z: 0, r: 1.6, h: 2.2, seg: 12, seed: 33 });
  B.cyl('concrete', { x: 0, y: 3.1, z: 0, r: 2.4, rTop: 0.4, h: 0.6, seg: 12, seed: 34 });

  // jersey barriers ringing the plaza
  const barrier = (x, z, yaw) => {
    B.box('concrete', { x, y: 0, z, w: 3.2, h: 1.0, d: 0.75, yaw, seed: 41, scale: 1.6 });
    B.box('concrete', { x, y: 1.0, z, w: 3.0, h: 0.12, d: 0.55, yaw, seed: 42, scale: 1.6 });
  };
  const ring = [
    [-11, -13, 0], [-7.6, -13, 0], [11, 13, 0], [7.6, 13, 0],
    [-13, 11, Math.PI / 2], [-13, 7.6, Math.PI / 2], [13, -11, Math.PI / 2], [13, -7.6, Math.PI / 2],
    [14, 14, Math.PI / 4], [-14, -14, Math.PI / 4], [15, -15, -Math.PI / 4], [-15, 15, -Math.PI / 4],
  ];
  for (const [x, z, y] of ring) barrier(x, z, y);

  // shipping containers — the main plaza cover, climbable
  const container = (x, z, yaw, tint, seed) => {
    B.box('corrugated', { x, y: 0, z, w: 6.1, h: 2.6, d: 2.44, yaw, tint, seed, scale: 1.2 });
    B.box('metal', { x, y: 2.6, z, w: 6.2, h: 0.1, d: 2.5, yaw, tint: 0x6e6e70, seed: seed + 1, walkable: true });
  };
  // NB: keep these footprints clear of each other — overlapping colliders wedge
  // characters in the gap between them.
  container(-17, 4.4, 0, 0xd06a3a, 51);
  container(-17, 7.6, 0, 0x3a6ea8, 52);
  container(18, -4.4, 0, 0x9aa2a8, 54);
  container(18, -7.6, 0, 0xc03a3a, 55);
  container(6, 17, Math.PI / 2, 0x4a7d3a, 56);
  container(-6, -17, Math.PI / 2, 0xb08a30, 57);
  // Ramp up onto the container roof — a plaza firing position. The ramp must sit
  // clear of the container footprint or it ends up buried inside it.
  B.stairs('metal', -9.6, 0, 4.4, '-x', 8, 0.345, 0.40, 3.0);
  B.box('metal', { x: -13.4, y: 2.6, z: 4.4, w: 1.6, h: 0.1, d: 3.0, tint: 0x6e6e70, seed: 58, walkable: true });
  // a separate stack elsewhere, pure cover
  B.box('corrugated', { x: 18, y: 2.7, z: -4.4, w: 6.1, h: 2.6, d: 2.44, tint: 0x8a5030, seed: 59, scale: 1.2 });
  B.box('metal', { x: 18, y: 5.3, z: -4.4, w: 6.2, h: 0.1, d: 2.5, tint: 0x6e6e70, seed: 60, walkable: true });

  // sandbag nests
  const nest = (x, z, yaw) => {
    for (let r = 0; r < 3; r++) for (let i = -2; i <= 2; i++) {
      if (r === 2 && Math.abs(i) === 2) continue;
      B.box('sandbag', {
        x: x + Math.cos(yaw) * i * 0.62, y: r * 0.34, z: z + Math.sin(yaw) * i * 0.62,
        w: 0.66, h: 0.35, d: 0.42, yaw: yaw + (i % 2) * 0.1, seed: 60 + r, scale: 0.8,
      });
    }
  };
  nest(-3, -20, 0); nest(3, 20, 0); nest(20, 3, Math.PI / 2); nest(-20, -3, Math.PI / 2);

  // burnt-out truck
  truck(B, 11, -11, 0.6);
  car(B, -13, 17, 2.2, 0x5a6a58);

  // overpass: catwalk from the office balcony out over the plaza
  B.box('metal', { x: -15, y: 4.2, z: -8, w: 14, h: 0.25, d: 3.2, tint: 0x77797c, seed: 71, scale: 2 });
  for (let i = 0; i < 8; i++) {
    B.box('metal', { x: -21.5 + i * 1.9, y: 4.45, z: -6.55, w: 0.12, h: 1.0, d: 0.12, tint: 0x77797c, seed: 72, collide: false });
    B.box('metal', { x: -21.5 + i * 1.9, y: 4.45, z: -9.45, w: 0.12, h: 1.0, d: 0.12, tint: 0x77797c, seed: 72, collide: false });
  }
  B.box('metal', { x: -15, y: 5.45, z: -6.55, w: 14, h: 0.1, d: 0.1, tint: 0x77797c, seed: 73, collide: false });
  B.box('metal', { x: -15, y: 5.45, z: -9.45, w: 14, h: 0.1, d: 0.1, tint: 0x77797c, seed: 73, collide: false });
  B.box('metal', { x: -8.4, y: 0, z: -9.6, w: 0.35, h: 4.2, d: 0.35, tint: 0x5c5e60, seed: 74 });
  B.box('metal', { x: -8.4, y: 0, z: -6.4, w: 0.35, h: 4.2, d: 0.35, tint: 0x5c5e60, seed: 74 });
  // ramp up to the catwalk, ascending toward it
  B.stairs('metal', -3.6, 0, -8, '-x', 13, 0.34, 0.36, 3.2);
}

function truck(B, x, z, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const at = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];
  const [bx, bz] = at(0, 0);
  B.box('metal', { x: bx, y: 0.75, z: bz, w: 6.4, h: 0.6, d: 2.5, yaw, tint: 0x4a4038, seed: 81 });
  const [cx2, cz2] = at(-2.0, 0);
  B.box('metal', { x: cx2, y: 1.35, z: cz2, w: 2.2, h: 1.5, d: 2.3, yaw, tint: 0x53483d, seed: 82 });
  const [tx, tz] = at(1.6, 0);
  B.box('corrugated', { x: tx, y: 1.35, z: tz, w: 3.6, h: 2.2, d: 2.4, yaw, tint: 0x6a5f52, seed: 83, scale: 1.2 });
  for (const [lx, lz] of [[-2.2, 1.25], [-2.2, -1.25], [1.6, 1.25], [1.6, -1.25]]) {
    const [wx, wz] = at(lx, lz);
    B.cyl('metal', { x: wx, y: 0, z: wz, r: 0.72, h: 0.45, seg: 12, yaw: yaw + Math.PI / 2, tint: 0x1a1a1c, seed: 84, collide: false });
  }
  // wheels lie flat: rotate by making a rotated cylinder is awkward; approximate with dark boxes
  for (const [lx, lz] of [[-2.2, 1.3], [-2.2, -1.3], [1.6, 1.3], [1.6, -1.3]]) {
    const [wx, wz] = at(lx, lz);
    B.box('metal', { x: wx, y: 0, z: wz, w: 1.4, h: 1.4, d: 0.5, yaw, tint: 0x18181a, seed: 85, scale: 0.8 });
  }
}

function car(B, x, z, yaw, tint) {
  B.box('metal', { x, y: 0.42, z, w: 4.3, h: 0.72, d: 1.85, yaw, tint, seed: 86, scale: 2 });
  B.box('glass', { x: x - Math.cos(yaw) * 0.25, y: 1.14, z: z - Math.sin(yaw) * 0.25, w: 2.1, h: 0.68, d: 1.7, yaw, tint: 0x2a3335, seed: 87 });
  for (const s of [-1, 1]) {
    B.box('metal', {
      x: x + Math.cos(yaw) * 1.5, y: 0, z: z + Math.sin(yaw) * 1.5,
      w: 1.2, h: 1.2, d: 0.42, yaw, tint: 0x141416, seed: 88, collide: false,
    });
  }
}

// ---------------------------------------------------------------------------

function buildOffice(B) {
  // Two-storey concrete office block, NW quadrant. x -52..-22, z -52..-24
  const X0 = -52, X1 = -22, Z0 = -52, Z1 = -24;
  const F1 = 0, F2 = 4.2, ROOF = 8.4;
  const W = 0.4;
  const S = { seed: 101, scale: 3 };

  // Floors are slabs with holes punched for the stairwell and the roof hatch —
  // a solid slab would cap the stairs and strand the whole upper level.
  B.slab('tile', X0, Z0, X1, Z1, F2 - 0.3, 0.3, [[X0 - 0.1, Z0 - 0.1, X0 + 5.2, Z0 + 8.6]],
    { seed: 102, scale: 3 });
  B.slab('concrete', X0, Z0, X1, Z1, ROOF - 0.3, 0.3, [[X1 - 11.2, Z0 - 0.1, X1 - 1.2, Z0 + 4.6]],
    { seed: 103, scale: 4 });

  // ---- exterior walls, ground floor
  const win = (at, w = 2.2) => ({ at, w, y0: 1.1, y1: 2.9 });
  const door = (at, w = 2.0) => ({ at, w, y0: 0, y1: 2.4 });
  // south face (z = Z1) faces the plaza
  B.wall('plaster', X0, Z1, X1, Z1, F2, W, [win(3), door(9), win(14), win(19), door(25)], S);
  B.wall('plaster', X0, Z1, X1, Z1, ROOF - F2, W, [win(3), win(8), win(13), win(18), win(24)], { ...S, base: F2 });
  // east face (x = X1) also faces the plaza
  B.wall('plaster', X1, Z0, X1, Z1, F2, W, [win(4), win(10), door(16, 2.4), win(22)], S);
  B.wall('plaster', X1, Z0, X1, Z1, ROOF - F2, W, [win(4), win(10), { at: 15, w: 4.5, y0: 0, y1: 2.6 }, win(22)], { ...S, base: F2 });
  // north / west faces are mostly solid
  B.wall('plaster', X0, Z0, X1, Z0, F2, W, [win(6), win(21)], S);
  B.wall('plaster', X0, Z0, X1, Z0, ROOF - F2, W, [win(6), win(14), win(21)], { ...S, base: F2 });
  B.wall('plaster', X0, Z0, X0, Z1, F2, W, [door(12, 2.2), win(20)], S);
  B.wall('plaster', X0, Z0, X0, Z1, ROOF - F2, W, [win(6), win(14), win(20)], { ...S, base: F2 });

  // ---- interior partitions, ground floor
  B.wall('plaster', X0 + 12, Z0, X0 + 12, Z1 - 8, F2, 0.3, [door(6)], { seed: 104, scale: 3 });
  B.wall('plaster', X0 + 12, Z0 + 10, X1, Z0 + 10, F2, 0.3, [door(4), door(13)], { seed: 105, scale: 3 });
  B.wall('plaster', X0 + 21, Z0 + 10, X0 + 21, Z1, F2, 0.3, [door(5)], { seed: 106, scale: 3 });

  // ---- stairwell in the NW corner, ground -> 2F (under the slab hole above)
  B.stairs('concrete', X0 + 2.4, 0, Z0 + 1.2, '+z', 12, 0.35, 0.42, 3.2);
  B.box('concrete', { x: X0 + 2.4, y: F2 - 0.3, z: Z0 + 7.4, w: 3.2, h: 0.3, d: 2.4, seed: 107, scale: 3 });
  B.box('metal', { x: X0 + 4.1, y: F2, z: Z0 + 7.4, w: 0.12, h: 1.0, d: 2.4, tint: 0x6b6d70, seed: 108, collide: false });

  // ---- 2F partitions + balcony
  B.wall('plaster', X0 + 10, Z0, X0 + 10, Z1 - 6, ROOF - F2, 0.3, [door(7)], { seed: 109, scale: 3, base: F2 });
  B.wall('plaster', X0 + 10, Z0 + 14, X1 - 7, Z0 + 14, ROOF - F2, 0.3, [door(6)], { seed: 110, scale: 3, base: F2 });
  // balcony slab hanging over the plaza, reachable from the big 2F opening
  B.box('concrete', { x: X1 + 1.6, y: F2 - 0.3, z: Z0 + 17.2, w: 3.6, h: 0.3, d: 5.0, seed: 111, scale: 3 });
  B.box('metal', { x: X1 + 3.3, y: F2, z: Z0 + 17.2, w: 0.14, h: 1.05, d: 5.0, tint: 0x6b6d70, seed: 112 });
  B.box('metal', { x: X1 + 1.6, y: F2, z: Z0 + 19.6, w: 3.6, h: 1.05, d: 0.14, tint: 0x6b6d70, seed: 113 });
  B.box('metal', { x: X1 + 1.6, y: F2, z: Z0 + 14.8, w: 3.6, h: 1.05, d: 0.14, tint: 0x6b6d70, seed: 114 });

  // roof access stair from 2F, ascending into the roof hatch
  B.stairs('concrete', X1 - 1.8, F2, Z0 + 2.4, '-x', 12, 0.35, 0.42, 3.4);
  B.box('concrete', { x: X1 - 9.0, y: ROOF - 0.3, z: Z0 + 2.4, w: 3.6, h: 0.3, d: 3.4, seed: 115, scale: 3 });
  // roof parapet
  for (const [x1, z1, x2, z2] of [[X0, Z0, X1, Z0], [X1, Z0, X1, Z1], [X1, Z1, X0, Z1], [X0, Z1, X0, Z0]])
    B.wall('concrete', x1, z1, x2, z2, 1.1, 0.35, [], { seed: 116, scale: 3, base: ROOF });
  // firing notches cut into the parapet
  for (const [nx, nz, w, d] of [[X0 + 9, Z1, 3.0, 0.5], [X0 + 20, Z1, 3.0, 0.5],
                                [X1, Z0 + 9, 0.5, 3.0], [X1, Z0 + 19, 0.5, 3.0]]) {
    B.box('concrete', { x: nx, y: ROOF + 0.45, z: nz, w, h: 0.65, d, seed: 116, scale: 2, collide: false, opaque: false });
  }
  // rooftop AC units for cover
  for (const [ax, az] of [[X0 + 8, Z0 + 8], [X0 + 20, Z0 + 6], [X0 + 14, Z0 + 20], [X0 + 24, Z0 + 18]]) {
    B.box('metal', { x: ax, y: ROOF, z: az, w: 2.4, h: 1.4, d: 1.8, tint: 0x8d9296, seed: 117, scale: 1.5 });
  }

  // office clutter
  for (let i = 0; i < 8; i++) {
    const dx = X0 + 14 + (i % 4) * 4, dz = Z0 + 3 + Math.floor(i / 4) * 5;
    B.box('wood', { x: dx, y: 0, z: dz, w: 1.7, h: 0.76, d: 0.9, yaw: (i * 0.7) % 1.2, seed: 118 + i, scale: 1.4 });
  }
  crateStack(B, X0 + 4, Z1 - 4, 3, 130);
}

// ---------------------------------------------------------------------------

function buildWarehouse(B) {
  // Big open steel warehouse with an internal catwalk. x 22..52, z 24..52
  const X0 = 22, X1 = 52, Z0 = 24, Z1 = 52;
  const H = 10;
  const S = { seed: 201, scale: 3 };

  B.box('concrete', { x: (X0 + X1) / 2, y: 0, z: (Z0 + Z1) / 2, w: X1 - X0, h: 0.12, d: Z1 - Z0, seed: 202, scale: 4 });

  // walls with big roller-door openings toward the plaza (west + north)
  B.wall('corrugated', X0, Z0, X0, Z1, H, 0.5, [{ at: 6, w: 5.5, y0: 0, y1: 4.5 }, { at: 18, w: 5.5, y0: 0, y1: 4.5 }], S);
  B.wall('corrugated', X0, Z0, X1, Z0, H, 0.5, [{ at: 8, w: 6, y0: 0, y1: 4.5 }, { at: 20, w: 3, y0: 0, y1: 2.6 }], S);
  B.wall('corrugated', X1, Z0, X1, Z1, H, 0.5, [{ at: 12, w: 2.4, y0: 0, y1: 2.4 }], S);
  B.wall('corrugated', X0, Z1, X1, Z1, H, 0.5, [{ at: 14, w: 3, y0: 0, y1: 2.6 }], S);
  // clerestory windows high up (light shafts)
  B.wall('glass', X0 - 0.001, Z0 + 2, X0 - 0.001, Z1 - 2, 1.6, 0.16, [], { seed: 203, base: H - 2.4, opaque: false });

  // roof with a gap that lets the sun in
  B.box('corrugated', { x: (X0 + X1) / 2 - 4, y: H, z: (Z0 + Z1) / 2, w: X1 - X0 - 8, h: 0.35, d: Z1 - Z0, seed: 204, scale: 4 });
  B.box('corrugated', { x: X1 - 2, y: H, z: (Z0 + Z1) / 2, w: 4, h: 0.35, d: Z1 - Z0, seed: 205, scale: 4 });
  // roof trusses
  for (let i = 0; i < 7; i++) {
    const z = Z0 + 2 + i * 4;
    B.box('metal', { x: (X0 + X1) / 2, y: H - 0.9, z, w: X1 - X0, h: 0.25, d: 0.25, tint: 0x53585c, seed: 206, collide: false });
  }

  // catwalk ring at 4.6 m
  const CY = 4.6;
  const cw = (x, z, w, d) => {
    B.box('metal', { x, y: CY, z, w, h: 0.16, d, tint: 0x74787c, seed: 207, scale: 2 });
  };
  cw(X0 + 2.6, (Z0 + Z1) / 2, 3.2, Z1 - Z0 - 4);
  cw((X0 + X1) / 2, Z1 - 3.4, X1 - X0 - 4, 3.2);
  cw(X1 - 2.6, (Z0 + Z1) / 2, 3.2, Z1 - Z0 - 4);
  // railings
  const rail = (x, z, w, d) => B.box('metal', { x, y: CY + 0.16, z, w, h: 1.0, d, tint: 0x74787c, seed: 208, opaque: false });
  rail(X0 + 4.3, (Z0 + Z1) / 2, 0.1, Z1 - Z0 - 4);
  rail(X1 - 4.3, (Z0 + Z1) / 2, 0.1, Z1 - Z0 - 4);
  rail((X0 + X1) / 2, Z1 - 5.1, X1 - X0 - 4, 0.1);
  // catwalk stair — climbs back toward the catwalk, not away from it
  B.stairs('metal', X0 + 10.4, 0, Z0 + 4.4, '-x', 14, 0.34, 0.4, 3.2);
  B.box('metal', { x: X0 + 2.9, y: CY - 0.16, z: Z0 + 4.4, w: 3.8, h: 0.16, d: 3.2, tint: 0x74787c, seed: 209 });

  // pallet racking + crate stacks
  for (let r = 0; r < 3; r++) {
    const x = X0 + 10 + r * 8;
    for (let lvl = 0; lvl < 2; lvl++) {
      B.box('metal', { x, y: 1.0 + lvl * 2.2, z: (Z0 + Z1) / 2, w: 2.6, h: 0.16, d: 16, tint: 0xa8622c, seed: 210 + r });
    }
    for (const zz of [-7, -3.5, 0, 3.5, 7]) {
      B.box('metal', { x, y: 0, z: (Z0 + Z1) / 2 + zz, w: 2.6, h: 4.4, d: 0.16, tint: 0xa8622c, seed: 212 });
    }
    for (let i = 0; i < 5; i++) {
      if ((r + i) % 3 === 0) continue;
      B.box('crate', { x: x + (i % 2 ? 0.3 : -0.3), y: 1.16 + (i % 2) * 2.2, z: (Z0 + Z1) / 2 - 6 + i * 3.2, w: 1.5, h: 1.5, d: 1.5, seed: 214 + i, scale: 1.5 });
    }
  }
  crateStack(B, X0 + 5, Z1 - 6, 4, 220);
  crateStack(B, X1 - 6, Z0 + 6, 3, 224);
  for (let i = 0; i < 6; i++) {
    B.cyl('metal', {
      x: X0 + 4 + (i % 3) * 1.4, y: 0, z: Z0 + 12 + Math.floor(i / 3) * 1.5,
      r: 0.42, h: 1.05, seg: 12, tint: [0x2f6ea0, 0xa03a2a, 0x3a7a45][i % 3], seed: 230 + i, scale: 1,
    });
  }
}

// ---------------------------------------------------------------------------

function buildMarket(B) {
  // Open-air market street, NE. x 22..56, z -56..-22
  const S = { seed: 301, scale: 2.5 };

  // low shop fronts along the north edge
  for (let i = 0; i < 4; i++) {
    const x = 25 + i * 8;
    B.wall('brick', x, -54, x + 6.5, -54, 4.2, 0.4, [{ at: 2, w: 2.6, y0: 0, y1: 2.4 }], S);
    B.wall('brick', x, -54, x, -48, 4.2, 0.4, [], S);
    B.wall('brick', x + 6.5, -54, x + 6.5, -48, 4.2, 0.4, [], S);
    B.wall('brick', x, -48, x + 6.5, -48, 4.2, 0.4, [{ at: 1.5, w: 3.5, y0: 0.9, y1: 2.6 }], S);
    B.box('concrete', { x: x + 3.25, y: 4.2, z: -51, w: 8.02, h: 0.3, d: 6.8, seed: 302, scale: 3 });
    // awning
    B.box('corrugated', { x: x + 3.25, y: 3.0, z: -46.6, w: 6.8, h: 0.12, d: 3.4, tint: [0xc0533a, 0x3f7a95, 0xc9a63e, 0x5a8a4a][i], seed: 303 + i, scale: 1.5, walkable: false });
    B.box('metal', { x: x + 0.4, y: 0, z: -45.2, w: 0.12, h: 3.0, d: 0.12, tint: 0x60544a, seed: 304 });
    B.box('metal', { x: x + 6.1, y: 0, z: -45.2, w: 0.12, h: 3.0, d: 0.12, tint: 0x60544a, seed: 304 });
  }
  // stair up to the shop roofs
  B.stairs('concrete', 19.4, 0, -50, '+x', 13, 0.35, 0.42, 3.2);
  for (const [x1, z1, x2, z2] of [[25, -54.4, 56, -54.4], [25, -47.4, 56, -47.4]])
    B.wall('concrete', x1, z1, x2, z2, 1.0, 0.3, [], { seed: 306, scale: 3, base: 4.5 });

  // market stalls with cloth awnings (soft cover — visually blocking, bullets pass)
  const stall = (x, z, yaw, color, seed) => {
    B.box('wood', { x, y: 0, z, w: 2.6, h: 0.95, d: 1.4, yaw, seed, scale: 1.2 });
    for (const s of [-1, 1]) {
      B.box('wood', {
        x: x + Math.cos(yaw) * 1.15 * s, y: 0.95, z: z + Math.sin(yaw) * 1.15 * s,
        w: 0.1, h: 1.5, d: 0.1, yaw, seed, collide: false,
      });
    }
    B.box('sandbag', { x, y: 2.45, z, w: 3.2, h: 0.08, d: 2.0, yaw, tint: color, seed: seed + 1, scale: 1.2, collide: false });
    // produce crates
    B.box('crate', { x: x + 1.6 * Math.cos(yaw + 1.2), y: 0, z: z + 1.6 * Math.sin(yaw + 1.2), w: 0.9, h: 0.9, d: 0.9, yaw, seed: seed + 2, scale: 0.9 });
  };
  const stalls = [
    [27, -40, 0, 0xd05a3a], [33, -41.5, 0.2, 0x3f8aa5], [39, -39.5, -0.15, 0xd8b23e],
    [45, -41, 0.1, 0x5a9a4a], [51, -39.8, -0.2, 0xb04a8a],
    [29, -33, Math.PI / 2, 0xd8b23e], [37, -31.5, Math.PI / 2 + 0.2, 0xd05a3a],
    [45, -33, Math.PI / 2 - 0.1, 0x3f8aa5], [51, -31, Math.PI / 2, 0x5a9a4a],
  ];
  for (let i = 0; i < stalls.length; i++) stall(stalls[i][0], stalls[i][1], stalls[i][2], stalls[i][3], 310 + i * 3);

  // sandbag firing positions facing the plaza
  for (const [sx, sz] of [[26, -26], [34, -25], [42, -27], [50, -25]]) {
    for (let r = 0; r < 2; r++) for (let i = -3; i <= 3; i++) {
      B.box('sandbag', { x: sx + i * 0.62, y: r * 0.34, z: sz, w: 0.66, h: 0.35, d: 0.42, yaw: (i % 2) * 0.12, seed: 340 + r, scale: 0.8 });
    }
  }

  // water tower — the map's highest sniper nest
  const TX = 52, TZ = -34;
  for (const [ox, oz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]])
    B.box('metal', { x: TX + ox, y: 0, z: TZ + oz, w: 0.3, h: 9, d: 0.3, tint: 0x6a5f55, seed: 350 });
  // deck with a stairwell opening — a solid deck caps the switchback below it
  B.slab('metal', TX - 4.3, TZ - 4.3, TX + 4.3, TZ + 4.3, 9, 0.2,
    [[TX - 4.1, TZ - 4.4, TX - 0.1, TZ + 2.2]], { tint: 0x74787c, seed: 351, scale: 2 });
  B.cyl('metal', { x: TX + 1.4, y: 9.2, z: TZ + 1.4, r: 2.2, h: 4.0, seg: 14, tint: 0x8a7060, seed: 352, scale: 2 });
  for (const [x1, z1, x2, z2] of [[TX - 4.3, TZ - 4.3, TX + 4.3, TZ - 4.3], [TX + 4.3, TZ - 4.3, TX + 4.3, TZ + 4.3],
                                  [TX + 4.3, TZ + 4.3, TX - 4.3, TZ + 4.3], [TX - 4.3, TZ + 4.3, TX - 4.3, TZ - 4.3]])
    B.wall('metal', x1, z1, x2, z2, 1.0, 0.12, [{ at: 3.2, w: 2.2, y0: 0, y1: 1.0 }], { seed: 353, base: 9.2, opaque: false, tint: 0x74787c });
  // switchback stairs up the tower
  B.stairs('metal', TX - 8.6, 0, TZ - 4.4, '+x', 13, 0.35, 0.42, 3.0);
  B.box('metal', { x: TX - 1.2, y: 4.39, z: TZ - 4.4, w: 3.4, h: 0.16, d: 3.0, tint: 0x74787c, seed: 354 });
  B.stairs('metal', TX - 2.2, 4.55, TZ - 2.6, '+z', 13, 0.35, 0.42, 3.0);
}

// ---------------------------------------------------------------------------

function buildApartments(B) {
  // Three ruined residential blocks, SW. x -56..-22, z 22..56
  const S = { seed: 401, scale: 3 };
  const blocks = [
    { x0: -54, z0: 24, x1: -40, z1: 38, h: 7.6, roof: true },
    { x0: -36, z0: 30, x1: -22, z1: 44, h: 4.4, roof: true },
    { x0: -52, z0: 42, x1: -34, z1: 56, h: 7.6, roof: false }, // bombed out: no roof
  ];
  let seed = 402;
  for (const b of blocks) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const win = (at, ww = 1.7) => ({ at, w: ww, y0: 1.0, y1: 2.6 });
    const door = (at) => ({ at, w: 2.0, y0: 0, y1: 2.3 });
    const lvls = Math.floor(b.h / 3.8);
    for (let l = 0; l < lvls; l++) {
      const base = l * 3.8;
      const ops = [];
      for (let i = 0; i < Math.floor(w / 4); i++) ops.push(win(2 + i * 4));
      if (l === 0) ops[1] = door(6);
      B.wall('plaster', b.x0, b.z0, b.x1, b.z0, 3.6, 0.4, ops, { ...S, seed: seed++, base });
      const ops2 = [];
      for (let i = 0; i < Math.floor(w / 4); i++) ops2.push(win(2 + i * 4));
      if (l === 0) ops2[Math.min(2, ops2.length - 1)] = door(10);
      B.wall('plaster', b.x0, b.z1, b.x1, b.z1, 3.6, 0.4, ops2, { ...S, seed: seed++, base });
      const ops3 = [];
      for (let i = 0; i < Math.floor(d / 4); i++) ops3.push(win(2 + i * 4));
      B.wall('brick', b.x0, b.z0, b.x0, b.z1, 3.6, 0.4, ops3, { ...S, seed: seed++, base });
      B.wall('brick', b.x1, b.z0, b.x1, b.z1, 3.6, 0.4, [...ops3], { ...S, seed: seed++, base });
      // floor slab above
      if (l < lvls - 1 || b.roof) {
        B.box('concrete', { x: (b.x0 + b.x1) / 2, y: base + 3.6, z: (b.z0 + b.z1) / 2, w, h: 0.3, d, seed: seed++, scale: 4 });
      }
      // interior cross-wall
      if (l === 0) {
        B.wall('plaster', b.x0 + w / 2, b.z0, b.x0 + w / 2, b.z1, 3.6, 0.3, [door(d * 0.45)], { seed: seed++, scale: 3, base });
      } else {
        B.wall('plaster', b.x0, b.z0 + d / 2, b.x1, b.z0 + d / 2, 3.6, 0.3, [door(w * 0.3), door(w * 0.7)], { seed: seed++, scale: 3, base });
      }
    }
    // exterior stair to the roof
    B.stairs('concrete', b.x1 + 1.1, 0, b.z0 + 2.2, '+z', 11, 0.36, 0.42, 3.2);
    if (lvls > 1) {
      B.box('concrete', { x: b.x1 + 1.1, y: 3.66, z: b.z0 + 8.4, w: 3.2, h: 0.3, d: 3.0, seed: seed++, scale: 3 });
      B.stairs('concrete', b.x1 + 1.1, 3.96, b.z0 + 9.9, '+z', 11, 0.36, 0.42, 3.2);
    }
    // rubble pile against one wall
    for (let i = 0; i < 9; i++) {
      const rx = b.x0 - 1.5 + Math.random() * 0, rz = b.z0 + 3 + i * 1.1;
      B.box('concrete', { x: b.x0 - 1.2, y: 0, z: rz, w: 1.4 + (i % 3) * 0.4, h: 0.5 + (i % 4) * 0.28, d: 1.2, yaw: i * 0.4, seed: 460 + i, scale: 1.4 });
    }
    // parapet
    if (b.roof) {
      const base = Math.floor(b.h / 3.8) * 3.8;
      // the east face is left open: that is where the exterior stair arrives
      for (const [x1, z1, x2, z2] of [[b.x0, b.z0, b.x1, b.z0], [b.x1, b.z1, b.x0, b.z1], [b.x0, b.z1, b.x0, b.z0]])
        B.wall('concrete', x1, z1, x2, z2, 1.0, 0.32, [], { seed: seed++, scale: 3, base });
      // the gap lines up with where the exterior stair actually arrives
      B.wall('concrete', b.x1, b.z0, b.x1, b.z1, 1.0, 0.32,
        [{ at: (b.z1 - b.z0) - 3.4, w: 3.2, y0: 0, y1: 1.0 }], { seed: seed++, scale: 3, base });
    }
  }
  // courtyard clutter between the blocks
  crateStack(B, -38, 48, 3, 470);
  car(B, -30, 52, 0.4, 0x7a4a3a);
  car(B, -44, 40, 1.9, 0x3a4a6a);
  for (const [sx, sz] of [[-26, 26], [-33, 22]]) {
    for (let r = 0; r < 2; r++) for (let i = -2; i <= 2; i++)
      B.box('sandbag', { x: sx + i * 0.62, y: r * 0.34, z: sz, w: 0.66, h: 0.35, d: 0.42, seed: 480 + r, scale: 0.8 });
  }
}

// ---------------------------------------------------------------------------

function buildStreetDetails(B) {
  // free-standing cover walls that break up the long perimeter sightlines
  const walls = [
    [-58, -18, -44, -18], [44, 18, 58, 18], [-18, -58, -18, -46], [18, 46, 18, 58],
    [-8, -44, 8, -44], [-8, 44, 8, 44], [-44, -8, -44, 8], [44, -8, 44, 8],
  ];
  for (let i = 0; i < walls.length; i++) {
    const [x1, z1, x2, z2] = walls[i];
    B.wall('brick', x1, z1, x2, z2, 2.6, 0.45, [{ at: 5, w: 2.4, y0: 0, y1: 2.6 }], { seed: 500 + i, scale: 2 });
  }
  // dumpsters
  const dumpster = (x, z, yaw, tint, seed) => {
    B.box('metal', { x, y: 0, z, w: 2.4, h: 1.35, d: 1.3, yaw, tint, seed, scale: 1.4 });
    B.box('metal', { x, y: 1.35, z, w: 2.5, h: 0.1, d: 1.4, yaw, tint: 0x4a4e50, seed: seed + 1, walkable: true });
  };
  dumpster(-24, 14, 0.3, 0x2f6a45, 520);
  dumpster(25, -14, 1.9, 0x6a4a2f, 522);
  dumpster(-15, -30, 0, 0x2f4a6a, 524);
  dumpster(16, 31, 1.2, 0x5a2f2f, 526);
  dumpster(-40, 12, 1.6, 0x2f6a45, 528);
  dumpster(40, -12, 0.2, 0x4a4a2f, 530);

  // barrels
  for (let i = 0; i < 22; i++) {
    const a = i * 2.399, r = 20 + (i % 7) * 5.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    B.cyl('metal', { x, y: 0, z, r: 0.44, h: 1.1, seg: 12, tint: [0x9a3a2a, 0x2a5a8a, 0x4a4a4c, 0x7a6a2a][i % 4], seed: 540 + i, scale: 1 });
  }

  // lamp posts (visual only)
  for (const [x, z] of [[-22, -22], [22, 22], [-22, 22], [22, -22], [0, -34], [0, 34], [-34, 0], [34, 0]]) {
    B.cyl('metal', { x, y: 0, z, r: 0.13, h: 6.4, seg: 8, tint: 0x4a4e52, seed: 560 });
    B.box('metal', { x: x + 0.6, y: 6.4, z, w: 1.6, h: 0.14, d: 0.2, tint: 0x4a4e52, seed: 561, collide: false });
    B.box('glass', { x: x + 1.3, y: 6.1, z, w: 0.7, h: 0.24, d: 0.4, tint: 0xfff0c0, seed: 562, collide: false });
  }

  // chain-link-ish fences (see-through: not opaque to bullets is wrong, but they
  // are thin posts + rails so we make them non-blocking for shots)
  for (const [x, z, len, yaw] of [[-30, -12, 14, 0], [30, 12, 14, 0], [12, -30, 14, Math.PI / 2], [-12, 30, 14, Math.PI / 2]]) {
    for (let i = 0; i <= len / 2.5; i++) {
      const px = x + Math.cos(yaw) * (i * 2.5 - len / 2), pz = z + Math.sin(yaw) * (i * 2.5 - len / 2);
      B.box('metal', { x: px, y: 0, z: pz, w: 0.1, h: 2.4, d: 0.1, tint: 0x585c60, seed: 570, opaque: false });
    }
    B.box('metal', { x, y: 2.3, z, w: yaw ? 0.06 : len, h: 0.06, d: yaw ? len : 0.06, tint: 0x585c60, seed: 571, collide: false });
  }
}

function crateStack(B, x, z, n, seed) {
  const layout = [
    [0, 0, 0], [1.55, 0, 0], [0, 0, 1.55], [0.78, 1.5, 0.78], [1.55, 0, 1.55], [0, 1.5, 0],
  ];
  for (let i = 0; i < Math.min(n, layout.length); i++) {
    const [ox, oy, oz] = layout[i];
    B.box('crate', { x: x + ox, y: oy, z: z + oz, w: 1.5, h: 1.5, d: 1.5, yaw: (i * 0.23) % 0.5, seed: seed + i, scale: 1.5 });
  }
}
