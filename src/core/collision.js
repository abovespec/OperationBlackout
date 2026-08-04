// Collision world: yaw-aligned oriented boxes, character sweep resolution and hitscan rays.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Collider {
  /**
   * @param {THREE.Vector3} center world center
   * @param {THREE.Vector3} half half-extents in local space
   * @param {number} yaw rotation about +Y
   * @param {object} opts { surface, climbable, opaque }
   */
  constructor(center, half, yaw = 0, opts = {}) {
    this.c = center.clone();
    this.h = half.clone();
    this.yaw = yaw;
    this.cos = Math.cos(-yaw);
    this.sin = Math.sin(-yaw);
    this.surface = opts.surface || 'concrete';
    this.opaque = opts.opaque !== false;   // blocks line of sight / bullets
    this.walkable = opts.walkable !== false;
    // conservative world AABB for broadphase
    const ax = Math.abs(Math.cos(yaw)), az = Math.abs(Math.sin(yaw));
    const ex = this.h.x * ax + this.h.z * az;
    const ez = this.h.x * az + this.h.z * ax;
    this.min = new THREE.Vector3(this.c.x - ex, this.c.y - this.h.y, this.c.z - ez);
    this.max = new THREE.Vector3(this.c.x + ex, this.c.y + this.h.y, this.c.z + ez);
  }
  /** world point -> box-local point */
  toLocal(p, out) {
    const dx = p.x - this.c.x, dz = p.z - this.c.z;
    return out.set(dx * this.cos - dz * this.sin, p.y - this.c.y, dx * this.sin + dz * this.cos);
  }
  /** box-local vector -> world vector */
  toWorldDir(v, out) {
    const c = this.cos, s = this.sin; // inverse rotation
    return out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
  }
}

export class PhysicsWorld {
  constructor() {
    this.colliders = [];
    this.grid = null;
    this.cell = 10;
    this.terrain = null;
  }

  /**
   * Attach a heightfield. Boxes handle buildings; this handles ground that is
   * not flat, which the box world cannot express without thousands of steps.
   * @param {{heightAt:(x:number,z:number)=>number, minX,maxX,minZ,maxZ, maxHeight:number}} t
   */
  setTerrain(t) {
    this.terrain = t;
    return this;
  }

  terrainHeight(x, z) {
    const t = this.terrain;
    if (!t) return -Infinity;
    if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) return -Infinity;
    return t.heightAt(x, z);
  }

  /**
   * March a ray against the heightfield. Fixed-step sampling then a bisection
   * refine — cheap, and accurate enough for foot placement and bullet impacts.
   * Returns the distance along the ray, or -1.
   */
  _terrainRay(origin, dir, maxDist) {
    const t = this.terrain;
    if (!t) return -1;
    const step = 0.35;
    let prevT = 0;
    let prevAbove = origin.y - this.terrainHeight(origin.x, origin.z);
    if (prevAbove < 0) return 0;              // started underground
    for (let d = step; d <= maxDist; d += step) {
      const x = origin.x + dir.x * d, y = origin.y + dir.y * d, z = origin.z + dir.z * d;
      const h = this.terrainHeight(x, z);
      const above = y - h;
      if (above < 0 && prevAbove >= 0) {
        // bisect between the last two samples
        let lo = prevT, hi = d;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) * 0.5;
          const my = origin.y + dir.y * mid;
          const mh = this.terrainHeight(origin.x + dir.x * mid, origin.z + dir.z * mid);
          if (my - mh < 0) hi = mid; else lo = mid;
        }
        return hi;
      }
      prevAbove = above;
      prevT = d;
    }
    return -1;
  }

  addBox(cx, cy, cz, sx, sy, sz, yaw = 0, opts = {}) {
    const col = new Collider(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(sx / 2, sy / 2, sz / 2), yaw, opts);
    col.id = this.colliders.length;
    this.colliders.push(col);
    return col;
  }

  /** Build a uniform XZ grid for broadphase. Call once the map is finished. */
  build() {
    const cell = this.cell;
    const map = new Map();
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const c of this.colliders) {
      minX = Math.min(minX, c.min.x); minZ = Math.min(minZ, c.min.z);
      maxX = Math.max(maxX, c.max.x); maxZ = Math.max(maxZ, c.max.z);
    }
    this.gx0 = Math.floor(minX / cell); this.gz0 = Math.floor(minZ / cell);
    this.gw = Math.floor(maxX / cell) - this.gx0 + 1;
    this.gh = Math.floor(maxZ / cell) - this.gz0 + 1;
    for (const c of this.colliders) {
      const x0 = Math.floor(c.min.x / cell) - this.gx0, x1 = Math.floor(c.max.x / cell) - this.gx0;
      const z0 = Math.floor(c.min.z / cell) - this.gz0, z1 = Math.floor(c.max.z / cell) - this.gz0;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const k = z * this.gw + x;
        let arr = map.get(k);
        if (!arr) map.set(k, arr = []);
        arr.push(c);
      }
    }
    this.grid = map;
    // stamp buffer for O(1) duplicate rejection during broadphase queries
    this._stampBuf = new Int32Array(this.colliders.length);
    this._queryToken = 0;
    return this;
  }

  /** Colliders potentially overlapping the given world AABB. */
  query(minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    if (!this.grid) { for (const c of this.colliders) out.push(c); return out; }
    const cell = this.cell;
    const x0 = Math.floor(minX / cell) - this.gx0, x1 = Math.floor(maxX / cell) - this.gx0;
    const z0 = Math.floor(minZ / cell) - this.gz0, z1 = Math.floor(maxZ / cell) - this.gz0;
    const stamp = this._stampBuf;
    const token = ++this._queryToken;
    const gw = this.gw, grid = this.grid;
    const cx0 = Math.max(0, x0), cx1 = Math.min(this.gw - 1, x1);
    const cz0 = Math.max(0, z0), cz1 = Math.min(this.gh - 1, z1);
    for (let z = cz0; z <= cz1; z++) {
      const row = z * gw;
      for (let x = cx0; x <= cx1; x++) {
        const arr = grid.get(row + x);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (stamp[c.id] === token) continue;
          stamp[c.id] = token;
          const cmin = c.min, cmax = c.max;
          if (cmax.x < minX || cmin.x > maxX || cmax.z < minZ || cmin.z > maxZ ||
              cmax.y < minY || cmin.y > maxY) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Resolve a vertical-cylinder character against the world.
   * @param pos feet position (mutated)
   * @param radius cylinder radius
   * @param height cylinder height
   * @param stepHeight max ledge the character can walk over
   * @returns {{ground:boolean, groundY:number, hitWall:boolean, ceiling:boolean}}
   */
  resolve(pos, radius, height, stepHeight = 0.45) {
    const res = { ground: false, groundY: 0, hitWall: false, ceiling: false };
    const list = this._list || (this._list = []);
    const lp = _v, out = _v2;

    // ---- vertical: find the highest support under/at the feet
    this.query(
      pos.x - radius - 0.6, pos.y - 2.2, pos.z - radius - 0.6,
      pos.x + radius + 0.6, pos.y + height + 0.6, pos.z + radius + 0.6, list);

    let support = -Infinity;
    for (const c of list) {
      if (!c.walkable) continue;
      c.toLocal(pos, lp);
      // horizontal overlap with a small skin so we don't fall off edges we're standing on
      const dx = Math.max(Math.abs(lp.x) - c.h.x, 0);
      const dz = Math.max(Math.abs(lp.z) - c.h.z, 0);
      if (dx * dx + dz * dz > radius * radius) continue;
      const top = c.c.y + c.h.y;
      if (top <= pos.y + stepHeight + 0.02 && top > support) support = top;
    }
    // The heightfield is another candidate support surface — and, crucially, a
    // hard floor. A fast fall can move further in one frame than the step
    // height, which would leave the character below the surface with nothing to
    // stand on and no way back up: they simply keep falling under the map.
    const th = this.terrainHeight(pos.x, pos.z);
    if (th > -Infinity) {
      if (pos.y < th - 0.001) {
        pos.y = th;                 // tunnelled through: lift back onto it
        res.ground = true;
        res.groundY = th;
        res.pushedUp = true;
      } else if (th <= pos.y + stepHeight + 0.02 && th > support) {
        support = th;
      }
    }

    if (support > -Infinity && pos.y <= support + stepHeight + 0.02) {
      res.ground = true;
      res.groundY = support;
    }

    // ---- horizontal: push out of every overlapping box (2 passes for corners)
    const eyeLo = () => pos.y + 0.12, eyeHi = () => pos.y + height - 0.05;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const c of list) {
        const boxTop = c.c.y + c.h.y, boxBot = c.c.y - c.h.y;
        if (boxTop < eyeLo() || boxBot > eyeHi()) continue;
        // low obstacle we can step onto: don't push, we'll be lifted instead
        if (c.walkable && boxTop <= pos.y + stepHeight + 0.02) continue;
        c.toLocal(pos, lp);
        const dx = c.h.x - Math.abs(lp.x);
        const dz = c.h.z - Math.abs(lp.z);
        if (dx + radius <= 0 || dz + radius <= 0) continue;
        if (dx > 0 && dz > 0) {
          // center inside the box footprint: push along the shallow axis
          if (dx < dz) out.set(Math.sign(lp.x) * (dx + radius), 0, 0);
          else out.set(0, 0, Math.sign(lp.z) * (dz + radius));
        } else {
          // nearest point on the rectangle to the circle center
          const nx = Math.max(-c.h.x, Math.min(c.h.x, lp.x));
          const nz = Math.max(-c.h.z, Math.min(c.h.z, lp.z));
          let ox = lp.x - nx, oz = lp.z - nz;
          const d = Math.hypot(ox, oz);
          if (d >= radius || d === 0) continue;
          const push = radius - d;
          out.set(ox / d * push, 0, oz / d * push);
        }
        c.toWorldDir(out, out);
        pos.x += out.x; pos.z += out.z;
        res.hitWall = true;
        moved = true;
      }
      if (!moved) break;
    }

    // ---- ceiling check
    for (const c of list) {
      const boxBot = c.c.y - c.h.y, boxTop = c.c.y + c.h.y;
      if (boxBot >= pos.y + height || boxTop <= pos.y + height - 0.3) continue;
      c.toLocal(pos, lp);
      if (Math.abs(lp.x) < c.h.x + radius * 0.7 && Math.abs(lp.z) < c.h.z + radius * 0.7) {
        res.ceiling = true;
        break;
      }
    }
    return res;
  }

  /** Ground height directly under a point (for spawn placement / bot nav). */
  groundAt(x, z, fromY = 40) {
    const hit = this.raycast(_v.set(x, fromY, z), _v2.set(0, -1, 0), fromY + 5);
    return hit ? hit.point.y : 0;
  }

  /**
   * Slab-test ray against every candidate collider.
   * @returns {{dist:number, point:THREE.Vector3, normal:THREE.Vector3, collider:Collider}|null}
   */
  raycast(origin, dir, maxDist = 500, opaqueOnly = true) {
    if (!this._trace(origin, dir, maxDist, opaqueOnly)) return null;
    const best = this._hitDist, bestC = this._hitC;
    const point = new THREE.Vector3(origin.x + dir.x * best, origin.y + dir.y * best, origin.z + dir.z * best);
    const ln = new THREE.Vector3(
      this._hitAxis === 0 ? this._hitSign : 0,
      this._hitAxis === 1 ? this._hitSign : 0,
      this._hitAxis === 2 ? this._hitSign : 0
    );
    const normal = new THREE.Vector3();
    bestC.toWorldDir(ln, normal);
    return { dist: best, point, normal, collider: bestC };
  }

  /** Allocation-free core trace. Results land on this._hit* fields. */
  _trace(origin, dir, maxDist = 500, opaqueOnly = true) {
    let best = maxDist, bestC = null, bestAxis = 0, bestSign = 1;
    const list = this._rlist || (this._rlist = []);
    // broadphase: AABB of the whole ray
    const ex = origin.x + dir.x * maxDist, ey = origin.y + dir.y * maxDist, ez = origin.z + dir.z * maxDist;
    this.query(
      Math.min(origin.x, ex) - 0.1, Math.min(origin.y, ey) - 0.1, Math.min(origin.z, ez) - 0.1,
      Math.max(origin.x, ex) + 0.1, Math.max(origin.y, ey) + 0.1, Math.max(origin.z, ez) + 0.1, list);

    for (const c of list) {
      if (opaqueOnly && !c.opaque) continue;
      // ray into box-local space
      const dx = origin.x - c.c.x, dz = origin.z - c.c.z;
      const ox = dx * c.cos - dz * c.sin, oy = origin.y - c.c.y, oz = dx * c.sin + dz * c.cos;
      const ddx = dir.x * c.cos - dir.z * c.sin, ddy = dir.y, ddz = dir.x * c.sin + dir.z * c.cos;

      let tmin = 0, tmax = best, axis = 0, sign = 1;
      // X slab
      let t1, t2;
      if (Math.abs(ddx) < 1e-8) { if (Math.abs(ox) > c.h.x) continue; }
      else {
        t1 = (-c.h.x - ox) / ddx; t2 = (c.h.x - ox) / ddx;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (Math.abs(ddy) < 1e-8) { if (Math.abs(oy) > c.h.y) continue; }
      else {
        t1 = (-c.h.y - oy) / ddy; t2 = (c.h.y - oy) / ddy;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (Math.abs(ddz) < 1e-8) { if (Math.abs(oz) > c.h.z) continue; }
      else {
        t1 = (-c.h.z - oz) / ddz; t2 = (c.h.z - oz) / ddz;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (tmin < best && tmin >= 0) { best = tmin; bestC = c; bestAxis = axis; bestSign = sign; }
    }
    // terrain competes with the box hit
    if (this.terrain) {
      const td = this._terrainRay(origin, dir, Math.min(best, maxDist));
      if (td >= 0 && td < best) {
        this._hitDist = td;
        this._hitC = this._terrainCollider || (this._terrainCollider = {
          surface: this.terrain.surface || 'sand', opaque: true, walkable: true,
          toWorldDir: (v, out) => out.copy(v),
        });
        this._hitAxis = 1; this._hitSign = 1;   // treat as an upward-facing surface
        return true;
      }
    }
    if (!bestC) return false;
    this._hitDist = best; this._hitC = bestC; this._hitAxis = bestAxis; this._hitSign = bestSign;
    return true;
  }

  /** Cheap boolean line-of-sight test — no allocation. */
  visible(a, b, pad = 0) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.001) return true;
    _v.set(dx / d, dy / d, dz / d);
    return !this._trace(a, _v, d - pad, true);
  }
}
