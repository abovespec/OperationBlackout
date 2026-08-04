// Multi-layer navigation grid, sampled straight out of the collision world.
// Handles the map's stacked surfaces (ground / catwalks / rooftops) by storing
// several nodes per XZ cell and linking them only where a character could step.
import * as THREE from 'three';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class NavGrid {
  /**
   * @param {PhysicsWorld} physics
   * @param {object} opts { cell, minX, maxX, minZ, maxZ, agentHeight, stepHeight }
   */
  constructor(physics, opts = {}) {
    this.physics = physics;
    this.cell = opts.cell ?? 2.0;
    this.minX = opts.minX ?? -60; this.maxX = opts.maxX ?? 60;
    this.minZ = opts.minZ ?? -60; this.maxZ = opts.maxZ ?? 60;
    this.agentH = opts.agentHeight ?? 1.75;
    this.step = opts.stepHeight ?? 0.62;
    this.w = Math.round((this.maxX - this.minX) / this.cell);
    this.h = Math.round((this.maxZ - this.minZ) / this.cell);
    this.cells = new Array(this.w * this.h);  // each: array of node indices
    this.nx = []; this.ny = []; this.nz = []; // node positions
    this.nbr = [];                            // node index -> [neighbour, cost]
    this.cover = [];                          // node index -> exposure score 0..1
  }

  async build(onProgress = null) {
    const P = this.physics;
    const c = this.cell, ceilY = 26;
    const yieldEvery = 12;
    const UPV = new THREE.Vector3(0, 1, 0);
    // ---- sample surfaces
    for (let gz = 0; gz < this.h; gz++) {
      for (let gx = 0; gx < this.w; gx++) {
        const x = this.minX + (gx + 0.5) * c;
        const z = this.minZ + (gz + 0.5) * c;
        const idxs = [];
        let y = ceilY;
        for (let iter = 0; iter < 5; iter++) {
          if (!P._trace(_o.set(x, y, z), _d, y + 2, true)) break;
          const sy = y - P._hitDist;
          if (sy < -1.5) break;
          // upward-facing surface only, and enough headroom for a standing agent
          if (P._hitAxis === 1 && P._hitSign === 1) {
            if (!P._trace(_o.set(x, sy + 0.12, z), UPV, this.agentH, true)) {
              const id = this.nx.length;
              this.nx.push(x); this.ny.push(sy); this.nz.push(z);
              this.nbr.push([]);
              this.cover.push(0);
              idxs.push(id);
            }
          }
          y = sy - 0.35;
          if (y < -1) break;
        }
        this.cells[gz * this.w + gx] = idxs;
      }
      if (onProgress && gz % yieldEvery === 0) {
        onProgress(`SAMPLING NAVIGATION SURFACES… ${Math.round(gz / this.h * 100)}%`);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ---- link neighbours
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let gz = 0; gz < this.h; gz++) {
      for (let gx = 0; gx < this.w; gx++) {
        const here = this.cells[gz * this.w + gx];
        if (!here.length) continue;
        for (const [dx, dz] of DIRS) {
          const ox = gx + dx, oz = gz + dz;
          if (ox < 0 || oz < 0 || ox >= this.w || oz >= this.h) continue;
          const there = this.cells[oz * this.w + ox];
          if (!there.length) continue;
          const diag = dx && dz;
          for (const a of here) {
            for (const b of there) {
              const dy = this.ny[b] - this.ny[a];
              // A staircase climbs far more than one step per grid cell, so a
              // plain |dy| <= stepHeight test disconnects every upper floor.
              // Anything steeper than ~45 degrees is unwalkable regardless.
              let ramp = false;
              if (Math.abs(dy) > this.step) {
                if (Math.abs(dy) > this.cell * 1.15) continue;
                if (!this._rampOk(a, b)) continue;
                ramp = true;
              }
              // torso-height clearance between the two nodes
              _a.set(this.nx[a], this.ny[a] + 1.25, this.nz[a]);
              _b.set(this.nx[b], this.ny[b] + 1.25, this.nz[b]);
              if (!this.physics.visible(_a, _b)) continue;
              if (!ramp) {
                // Low-obstacle test for railings and parapets. Measured from the
                // HIGHER of the two surfaces plus one step, so that the tread of a
                // staircase entrance does not read as an obstruction — that bug
                // silently disconnected every upper floor in the map.
                const kneeY = Math.max(this.ny[a], this.ny[b]) + 0.55;
                _a.y = kneeY; _b.y = kneeY;
                if (!this.physics.visible(_a, _b)) continue;
              }
              if (diag) {
                // require both orthogonal cells so agents don't clip wall corners
                const c1 = this.cells[gz * this.w + ox], c2 = this.cells[oz * this.w + gx];
                if (!c1.length || !c2.length) continue;
              }
              const cost = (diag ? 1.4142 : 1) * this.cell + Math.abs(dy) * 1.5 + (ramp ? 1.2 : 0);
              this.nbr[a].push(b, cost);
            }
          }
        }
      }
      if (onProgress && gz % yieldEvery === 0) {
        onProgress(`LINKING NAVIGATION GRAPH… ${Math.round(gz / this.h * 100)}%`);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ---- exposure: how much of the map can see this node (used to pick cover)
    const N = 10;
    const samples = [];
    for (let i = 0; i < N; i++) {
      const ang = i / N * Math.PI * 2;
      samples.push([Math.cos(ang), Math.sin(ang)]);
    }
    for (let i = 0; i < this.nx.length; i++) {
      let open = 0;
      _a.set(this.nx[i], this.ny[i] + 1.5, this.nz[i]);
      for (let s = 0; s < N; s++) {
        _b.set(samples[s][0], 0, samples[s][1]);
        if (!this.physics._trace(_a, _b, 14, true)) open++;
      }
      this.cover[i] = open / N;
      if (onProgress && (i & 1023) === 0) {
        onProgress(`EVALUATING COVER… ${Math.round(i / this.nx.length * 100)}%`);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ---- explicit stair spines (declared by the map)
    if (this.stairRuns) this.stitchStairs(this.stairRuns);

    this._open = new Int32Array(this.nx.length);
    this._g = new Float32Array(this.nx.length);
    this._f = new Float32Array(this.nx.length);
    this._from = new Int32Array(this.nx.length);
    this._stamp = new Int32Array(this.nx.length);
    this._token = 0;
    return this;
  }

  /** Append a node to the grid at runtime (used by the stair stitcher). */
  _addNode(x, y, z) {
    const gx = Math.floor((x - this.minX) / this.cell);
    const gz = Math.floor((z - this.minZ) / this.cell);
    if (gx < 0 || gz < 0 || gx >= this.w || gz >= this.h) return -1;
    const id = this.nx.length;
    this.nx.push(x); this.ny.push(y); this.nz.push(z);
    this.nbr.push([]);
    this.cover.push(0.5);
    (this.cells[gz * this.w + gx] ||= []).push(id);
    return id;
  }

  _link(a, b, cost) {
    if (a < 0 || b < 0 || a === b) return;
    const na = this.nbr[a];
    for (let i = 0; i < na.length; i += 2) if (na[i] === b) return;
    na.push(b, cost);
    this.nbr[b].push(a, cost);
  }

  /**
   * Walk each declared staircase and guarantee a connected chain of nav nodes
   * along it, joining onto whatever is walkable at the top and bottom.
   *
   * Sampling a grid cannot be relied on here: stair treads are narrow, they sit
   * under landings and floor slabs, and a single missing node severs an entire
   * upper level from the graph.
   */
  stitchStairs(runs) {
    const P = this.physics;
    for (const r of runs) {
      const dx = r.x1 - r.x0, dz = r.z1 - r.z0;
      const len = Math.hypot(dx, dz);
      const steps = Math.max(2, Math.ceil(len / 0.55));
      const chain = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = r.x0 + dx * t, z = r.z0 + dz * t;
        const wantY = r.y0 + (r.y1 - r.y0) * t;
        // find the real surface closest to the expected height
        let y = wantY + 1.4, best = null;
        for (let k = 0; k < 6; k++) {
          if (!P._trace(_o.set(x, y, z), _d, y + 2.5, true)) break;
          const sy = y - P._hitDist;
          if (sy < -1.5) break;
          if (P._hitAxis === 1 && P._hitSign === 1 &&
              (best === null || Math.abs(sy - wantY) < Math.abs(best - wantY))) best = sy;
          if (sy < wantY - 1.4) break;
          y = sy - 0.2;
          if (y < -1) break;
        }
        if (best === null || Math.abs(best - wantY) > 1.2) continue;
        // reuse an existing node in this cell at that height, else make one
        let node = -1;
        const gx = Math.floor((x - this.minX) / this.cell);
        const gz = Math.floor((z - this.minZ) / this.cell);
        if (gx >= 0 && gz >= 0 && gx < this.w && gz < this.h) {
          for (const n of this.cells[gz * this.w + gx] || []) {
            if (Math.abs(this.ny[n] - best) < 0.3) { node = n; break; }
          }
        }
        if (node < 0) node = this._addNode(x, best, z);
        if (node >= 0) chain.push(node);
      }
      for (let i = 1; i < chain.length; i++) {
        const a = chain[i - 1], b = chain[i];
        this._link(a, b, 0.7 + Math.abs(this.ny[b] - this.ny[a]) * 1.5);
      }
      // splice both ends into the surrounding walkable surfaces
      for (const end of [chain[0], chain[chain.length - 1]]) {
        if (end === undefined) continue;
        const ex = this.nx[end], ey = this.ny[end], ez = this.nz[end];
        const gx = Math.floor((ex - this.minX) / this.cell);
        const gz = Math.floor((ez - this.minZ) / this.cell);
        const reach = Math.max(2, Math.ceil((r.width * 0.5 + 1.0) / this.cell));
        for (let oz = gz - reach; oz <= gz + reach; oz++) {
          for (let ox = gx - reach; ox <= gx + reach; ox++) {
            if (ox < 0 || oz < 0 || ox >= this.w || oz >= this.h) continue;
            for (const n of this.cells[oz * this.w + ox] || []) {
              if (n === end) continue;
              const hd = Math.hypot(this.nx[n] - ex, this.nz[n] - ez);
              if (hd > reach * this.cell) continue;
              if (Math.abs(this.ny[n] - ey) > this.step + 0.25) continue;
              _a.set(ex, ey + 1.2, ez);
              _b.set(this.nx[n], this.ny[n] + 1.2, this.nz[n]);
              if (!P.visible(_a, _b)) continue;
              this._link(end, n, hd + 0.4);
            }
          }
        }
      }
    }
  }

  /** Nearest walkable node to a world position (prefers matching height). */
  nodeAt(x, y, z, maxCells = 3) {
    const gx = Math.floor((x - this.minX) / this.cell);
    const gz = Math.floor((z - this.minZ) / this.cell);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= maxCells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const cx = gx + dx, cz = gz + dz;
          if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) continue;
          const list = this.cells[cz * this.w + cx];
          if (!list) continue;
          for (const n of list) {
            const d = (this.nx[n] - x) ** 2 + (this.nz[n] - z) ** 2 + ((this.ny[n] - y) * 3) ** 2;
            if (d < bestD) { bestD = d; best = n; }
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  /**
   * A* between two node indices. maxNodes must comfortably exceed the graph
   * size — a cap below it silently fails long cross-map routes, which reads as
   * "the bots never go upstairs".
   */
  path(start, goal, maxNodes = 30000) {
    // the scratch arrays only exist once build() has finished
    if (!this._g || start < 0 || goal < 0) return null;
    if (start === goal) return [start];
    const token = ++this._token;
    const { _g, _f, _from, _stamp } = this;
    const heap = [start];
    _g[start] = 0;
    _f[start] = this._h(start, goal);
    _from[start] = -1;
    _stamp[start] = token;
    const closed = new Set();
    let expanded = 0;

    const push = (n) => {
      heap.push(n);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (_f[heap[p]] <= _f[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let s = i;
          if (l < heap.length && _f[heap[l]] < _f[heap[s]]) s = l;
          if (r < heap.length && _f[heap[r]] < _f[heap[s]]) s = r;
          if (s === i) break;
          [heap[s], heap[i]] = [heap[i], heap[s]];
          i = s;
        }
      }
      return top;
    };

    while (heap.length && expanded++ < maxNodes) {
      const cur = pop();
      if (cur === goal) {
        const out = [];
        let n = cur;
        while (n !== -1) { out.push(n); n = _from[n]; }
        return out.reverse();
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const nb = this.nbr[cur];
      for (let i = 0; i < nb.length; i += 2) {
        const n = nb[i], cost = nb[i + 1];
        const ng = _g[cur] + cost;
        if (_stamp[n] === token && ng >= _g[n]) continue;
        _stamp[n] = token;
        _g[n] = ng;
        _f[n] = ng + this._h(n, goal);
        _from[n] = cur;
        push(n);
      }
    }
    return null;
  }

  /**
   * Why is (or isn't) there an edge between two nodes? Diagnostic only — mirrors
   * the tests in build() so map problems can be traced without guesswork.
   */
  explainLink(a, b) {
    if (a < 0 || b < 0) return 'bad node';
    const nb = this.nbr[a];
    for (let i = 0; i < nb.length; i += 2) if (nb[i] === b) return 'LINKED';
    const dy = this.ny[b] - this.ny[a];
    let ramp = false;
    if (Math.abs(dy) > this.step) {
      if (Math.abs(dy) > this.cell * 1.15) return `too steep (dy=${dy.toFixed(2)})`;
      if (!this._rampOk(a, b)) return `ramp probe failed (dy=${dy.toFixed(2)})`;
      ramp = true;
    }
    _a.set(this.nx[a], this.ny[a] + 1.25, this.nz[a]);
    _b.set(this.nx[b], this.ny[b] + 1.25, this.nz[b]);
    if (!this.physics.visible(_a, _b)) return 'torso blocked';
    if (!ramp) {
      const kneeY = Math.max(this.ny[a], this.ny[b]) + 0.55;
      _a.y = kneeY; _b.y = kneeY;
      if (!this.physics.visible(_a, _b)) return 'knee blocked';
    }
    const gx = Math.round((this.nx[a] - this.minX) / this.cell - 0.5);
    const gz = Math.round((this.nz[a] - this.minZ) / this.cell - 0.5);
    const ox = Math.round((this.nx[b] - this.minX) / this.cell - 0.5);
    const oz = Math.round((this.nz[b] - this.minZ) / this.cell - 0.5);
    if (Math.abs(gx - ox) > 1 || Math.abs(gz - oz) > 1) return 'not adjacent cells';
    if (gx !== ox && gz !== oz) {
      const c1 = this.cells[gz * this.w + ox], c2 = this.cells[oz * this.w + gx];
      if (!c1?.length || !c2?.length) return 'diagonal corner blocked';
    }
    return 'should link (unexplained)';
  }

  /**
   * Is the surface between two nodes a walkable ramp/staircase? Samples the
   * ground profile along the segment and requires every consecutive rise to be
   * within one step.
   */
  _rampOk(a, b) {
    const P = this.physics;
    const N = 6;
    const ax = this.nx[a], ay = this.ny[a], az = this.nz[a];
    const bx = this.nx[b], by = this.ny[b], bz = this.nz[b];
    const topY = Math.max(ay, by) + 1.6;
    let prevY = ay;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      let found = null, y = topY;
      for (let k = 0; k < 5; k++) {
        if (!P._trace(_o.set(x, y, z), _d, y + 2, true)) break;
        const sy = y - P._hitDist;
        if (sy < -1.5) break;
        if (P._hitAxis === 1 && P._hitSign === 1 && Math.abs(sy - prevY) <= this.step + 0.08) { found = sy; break; }
        y = sy - 0.25;
        if (y < -1) break;
      }
      if (found === null) return false;
      // No headroom probe here: stair treads are solid columns, so a vertical ray
      // launched near a tread boundary clips the next step and reports a ceiling.
      // Both endpoints are nav nodes, which were already headroom-checked.
      prevY = found;
    }
    return Math.abs(prevY - by) <= this.step + 0.08;
  }

  _h(a, b) {
    return Math.abs(this.nx[a] - this.nx[b]) + Math.abs(this.nz[a] - this.nz[b]) + Math.abs(this.ny[a] - this.ny[b]) * 2;
  }

  pos(n, out) { return out.set(this.nx[n], this.ny[n], this.nz[n]); }

  /** Smooth a node path into world waypoints, dropping nodes we can walk straight past. */
  toWaypoints(nodes) {
    if (!nodes || !nodes.length) return [];
    const pts = nodes.map(n => new THREE.Vector3(this.nx[n], this.ny[n], this.nz[n]));
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) {
        if (Math.abs(pts[j].y - pts[i].y) > 0.4) continue;
        _a.copy(pts[i]); _a.y += 1.0;
        _b.copy(pts[j]); _b.y += 1.0;
        if (!this.physics.visible(_a, _b)) continue;
        _a.y = pts[i].y + 0.35; _b.y = pts[j].y + 0.35;
        if (this.physics.visible(_a, _b)) break;
      }
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  /** A random reachable node, optionally biased toward cover or toward a point. */
  randomNode(rand = Math.random) {
    return (rand() * this.nx.length) | 0;
  }

  /** Find a node near `from` that breaks line of sight to `threat`. */
  findCover(fromNode, threat, radius = 18) {
    let best = -1, bestScore = -Infinity;
    const fx = this.nx[fromNode], fz = this.nz[fromNode];
    for (let i = 0; i < 42; i++) {
      const n = (Math.random() * this.nx.length) | 0;
      const dx = this.nx[n] - fx, dz = this.nz[n] - fz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius || d2 < 9) continue;
      _a.set(this.nx[n], this.ny[n] + 1.4, this.nz[n]);
      const hidden = !this.physics.visible(_a, threat);
      const score = (hidden ? 100 : 0) - Math.sqrt(d2) * 0.5 - this.cover[n] * 20;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }
}
