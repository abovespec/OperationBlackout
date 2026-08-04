// Map construction toolkit.
//
// Levels are authored as boxes, cylinders, walls-with-openings and slabs-with-
// holes; everything is merged per material into a handful of draw calls, with a
// matching set of physics colliders and a record of every staircase so the
// navmesh can stitch the floors together.
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
    const key = (typeof m === 'string' ? m + (o.tint || '') + (o.scale || '') + (o.metalness ?? '') : material.uuid);
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
    const key = (typeof m === 'string' ? m + (o.tint || '') + 'c' + (o.metalness ?? '') : material.uuid);
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
    return mat(kind, {
      repeat: 1, seed: o.seed ?? 1337, color: o.tint, size: o.texSize ?? 512,
      metalness: o.metalness,
    });
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

// ---------------------------------------------------------------- shared props

export function truck(B, x, z, yaw) {
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

export function car(B, x, z, yaw, tint) {
  B.box('metal', { x, y: 0.42, z, w: 4.3, h: 0.72, d: 1.85, yaw, tint, seed: 86, scale: 2 });
  B.box('glass', { x: x - Math.cos(yaw) * 0.25, y: 1.14, z: z - Math.sin(yaw) * 0.25, w: 2.1, h: 0.68, d: 1.7, yaw, tint: 0x2a3335, seed: 87 });
  for (const s of [-1, 1]) {
    B.box('metal', {
      x: x + Math.cos(yaw) * 1.5, y: 0, z: z + Math.sin(yaw) * 1.5,
      w: 1.2, h: 1.2, d: 0.42, yaw, tint: 0x141416, seed: 88, collide: false,
    });
  }
}

export function crateStack(B, x, z, n, seed) {
  const layout = [
    [0, 0, 0], [1.55, 0, 0], [0, 0, 1.55], [0.78, 1.5, 0.78], [1.55, 0, 1.55], [0, 1.5, 0],
  ];
  for (let i = 0; i < Math.min(n, layout.length); i++) {
    const [ox, oy, oz] = layout[i];
    B.box('crate', { x: x + ox, y: oy, z: z + oz, w: 1.5, h: 1.5, d: 1.5, yaw: (i * 0.23) % 0.5, seed: seed + i, scale: 1.5 });
  }
}
