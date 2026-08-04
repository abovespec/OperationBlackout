// Procedural texture generation — everything is drawn on 2D canvases at load time,
// so the game ships with zero binary assets but still gets grimy, believable surfaces.
import * as THREE from 'three';

const CACHE = new Map();

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  // Claim the context up front with willReadFrequently: these canvases are all
  // read back with getImageData, and without the hint Chrome keeps them on the
  // GPU and pays a full readback each time.
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

/** Value-noise field, tileable, sampled into an ImageData-friendly float array. */
function noiseField(size, cells, seed, octaves = 4) {
  const rand = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const grid = new Float32Array(n * n);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const scale = size / n;
    for (let y = 0; y < size; y++) {
      const fy = y / scale, y0 = Math.floor(fy) % n, y1 = (y0 + 1) % n;
      const ty = fy - Math.floor(fy), sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = x / scale, x0 = Math.floor(fx) % n, x1 = (x0 + 1) % n;
        const tx = fx - Math.floor(fx), sx = tx * tx * (3 - 2 * tx);
        const a = grid[y0 * n + x0] * (1 - sx) + grid[y0 * n + x1] * sx;
        const b = grid[y1 * n + x0] * (1 - sx) + grid[y1 * n + x1] * sx;
        out[y * size + x] += (a * (1 - sy) + b * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Derive the normal and roughness maps together. Both are functions of the same
 * luminance field, and each separate pass costs a full getImageData plus a
 * loop over every texel — at 512² that is the single most expensive thing in
 * the load.
 */
function derivedMaps(src, strength = 2.0, lo = 0.4, hi = 0.95) {
  const size = src.width;
  const sd = src.getContext('2d').getImageData(0, 0, size, size).data;
  const n = size * size;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    raw[i] = (sd[i * 4] * 0.299 + sd[i * 4 + 1] * 0.587 + sd[i * 4 + 2] * 0.114) / 255;
  }
  // Soften before differencing. Per-texel normals derived straight from a noisy
  // albedo produce single-texel facets, and once those minify they alias into
  // crawling specular sparkle across floors.
  const h = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, y0 = y * size, yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      h[y0 + x] = (raw[ym + xm] + raw[ym + x] + raw[ym + xp] +
                   raw[y0 + xm] + raw[y0 + x] * 2 + raw[y0 + xp] +
                   raw[yp + xm] + raw[yp + x] + raw[yp + xp]) / 10;
    }
  }
  const nrm = canvas(size), rgh = canvas(size);
  const nctx = nrm.getContext('2d'), rctx = rgh.getContext('2d');
  const ni = nctx.createImageData(size, size);
  const ri = rctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      ni.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      ni.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      ni.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      ni.data[i + 3] = 255;
      const v = (lo + (1 - raw[y * size + x]) * (hi - lo)) * 255;
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = v;
      ri.data[i + 3] = 255;
    }
  }
  nctx.putImageData(ni, 0, 0);
  rctx.putImageData(ri, 0, 0);
  return { nrm, rgh };
}

/** Derive a tangent-space normal map from the luminance of a source canvas. */
function normalFromCanvas(src, strength = 2.0) {
  const size = src.width;
  const sctx = src.getContext('2d');
  const sd = sctx.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    h[i] = (sd[i * 4] * 0.299 + sd[i * 4 + 1] * 0.587 + sd[i * 4 + 2] * 0.114) / 255;
  }
  const out = canvas(size);
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Grayscale roughness map from a canvas' luminance, remapped into [lo,hi]. */
function roughFromCanvas(src, lo = 0.4, hi = 0.95, invert = false) {
  const size = src.width;
  const sd = src.getContext('2d').getImageData(0, 0, size, size).data;
  const out = canvas(size);
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    let l = (sd[i * 4] * 0.299 + sd[i * 4 + 1] * 0.587 + sd[i * 4 + 2] * 0.114) / 255;
    if (invert) l = 1 - l;
    const v = (lo + l * (hi - lo)) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function tex(cv, repeat = 1, aniso = 8) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function texLinear(cv, repeat = 1, aniso = 8) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  return t;
}

// ---------------------------------------------------------------- painters

function paintNoiseOverlay(ctx, size, seed, cells, alpha, dark = true, octaves = 5) {
  const n = noiseField(size, cells, seed, octaves);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const v = (n[i] - 0.5) * alpha * 255;
    const d = dark ? v : Math.abs(v);
    img.data[i * 4] = Math.max(0, Math.min(255, img.data[i * 4] + d));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, img.data[i * 4 + 1] + d));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, img.data[i * 4 + 2] + d));
  }
  ctx.putImageData(img, 0, 0);
}

/** Weathering: vertical grime streaks, common on every outdoor surface. */
function paintStreaks(ctx, size, seed, count, alpha) {
  const rand = rng(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const w = 2 + rand() * 16;
    const y0 = rand() * size * 0.7;
    const len = size * (0.15 + rand() * 0.6);
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    const a = alpha * (0.3 + rand() * 0.7);
    g.addColorStop(0, `rgba(30,26,22,${a})`);
    g.addColorStop(0.35, `rgba(35,30,25,${a * 0.6})`);
    g.addColorStop(1, 'rgba(40,35,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, w, len);
  }
  ctx.restore();
}

function paintSpeckles(ctx, size, seed, count, colors, rMin = 0.5, rMax = 3) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(rand() * colors.length) | 0];
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, rMin + rand() * (rMax - rMin), 0, 7);
    ctx.fill();
  }
}

const PAINTERS = {
  concrete(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#8c8a84';
    ctx.fillRect(0, 0, size, size);
    paintNoiseOverlay(ctx, size, seed, 5, 0.20);
    paintNoiseOverlay(ctx, size, seed + 7, 34, 0.14);
    paintSpeckles(ctx, size, seed + 11, size * 2.5, ['rgba(60,58,54,.35)', 'rgba(180,178,172,.3)', 'rgba(40,38,36,.25)'], 0.4, 1.7);
    // form-work seams
    const rand = rng(seed + 3);
    ctx.strokeStyle = 'rgba(50,48,45,.4)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const y = (i + 0.5) * size / 3 + (rand() - 0.5) * 20;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    }
    // spalled patches showing aggregate
    for (let i = 0; i < 5; i++) {
      const x = rand() * size, y = rand() * size, r = 10 + rand() * 40;
      ctx.fillStyle = `rgba(120,116,108,${0.10 + rand() * 0.14})`;
      ctx.beginPath();
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2, rr = r * (0.6 + rand() * 0.6);
        ctx[a ? 'lineTo' : 'moveTo'](x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
      }
      ctx.closePath(); ctx.fill();
    }
    // cast-panel seams: a strong readable grid beats mushy noise at distance
    ctx.strokeStyle = 'rgba(58,56,52,.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
    ctx.strokeStyle = 'rgba(210,206,196,.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, size - 8, size - 8);
    paintStreaks(ctx, size, seed + 21, 18, 0.22);
    return { c, rough: [0.80, 0.99], normal: 1.0 };
  },

  plaster(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#c9bda8';
    ctx.fillRect(0, 0, size, size);
    paintNoiseOverlay(ctx, size, seed, 6, 0.34);
    paintNoiseOverlay(ctx, size, seed + 5, 40, 0.14);
    // exposed brick through broken render
    const rand = rng(seed + 2);
    for (let p = 0; p < 4; p++) {
      const px = rand() * size, py = rand() * size, pr = 26 + rand() * 60;
      ctx.save();
      ctx.beginPath();
      for (let a = 0; a < 14; a++) {
        const ang = a / 14 * Math.PI * 2, rr = pr * (0.55 + rand() * 0.7);
        ctx[a ? 'lineTo' : 'moveTo'](px + Math.cos(ang) * rr, py + Math.sin(ang) * rr);
      }
      ctx.closePath(); ctx.clip();
      ctx.fillStyle = '#6d4436';
      ctx.fillRect(px - pr * 1.5, py - pr * 1.5, pr * 3, pr * 3);
      const bh = size / 28;
      for (let r = -20; r < 20; r++) {
        for (let k = -6; k < 6; k++) {
          const bx = px + k * bh * 2.4 + (r % 2 ? bh * 1.2 : 0);
          ctx.fillStyle = `rgb(${118 + rand() * 24 | 0},${70 + rand() * 18 | 0},${56 + rand() * 14 | 0})`;
          ctx.fillRect(bx, py + r * bh, bh * 2.2, bh * 0.86);
        }
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(90,80,64,.5)'; ctx.lineWidth = 2;
      ctx.stroke();
    }
    paintStreaks(ctx, size, seed + 31, 30, 0.34);
    return { c, rough: [0.80, 0.99], normal: 1.2 };
  },

  brick(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    ctx.fillStyle = '#3b342f';
    ctx.fillRect(0, 0, size, size);
    const rows = 16, bh = size / rows, bw = size / 8;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let k = -1; k < 9; k++) {
        const x = k * bw + off + 2, y = r * bh + 2;
        const base = 92 + rand() * 40;
        ctx.fillStyle = `rgb(${base | 0},${(base * 0.68 + rand() * 12) | 0},${(base * 0.58 + rand() * 10) | 0})`;
        ctx.fillRect(x, y, bw - 4, bh - 4);
        ctx.fillStyle = `rgba(255,255,255,${0.02 + rand() * 0.05})`;
        ctx.fillRect(x, y, bw - 4, 2);
      }
    }
    paintNoiseOverlay(ctx, size, seed + 9, 24, 0.2);
    paintStreaks(ctx, size, seed + 17, 22, 0.4);
    return { c, rough: [0.82, 0.99], normal: 1.8 };
  },

  asphalt(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#3a3a3c';
    ctx.fillRect(0, 0, size, size);
    paintNoiseOverlay(ctx, size, seed, 8, 0.34);
    paintSpeckles(ctx, size, seed + 4, size * 8, ['rgba(20,20,22,.5)', 'rgba(110,110,112,.35)', 'rgba(70,70,74,.4)'], 0.4, 2.2);
    // cracks
    const rand = rng(seed + 6);
    ctx.strokeStyle = 'rgba(14,14,16,.7)';
    for (let i = 0; i < 9; i++) {
      ctx.lineWidth = 0.8 + rand() * 2.4;
      let x = rand() * size, y = rand() * size;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 18; s++) {
        x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // oil stains
    for (let i = 0; i < 4; i++) {
      const x = rand() * size, y = rand() * size, r = 20 + rand() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(12,12,14,.55)');
      g.addColorStop(1, 'rgba(12,12,14,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return { c, rough: [0.78, 0.98], normal: 1.1 };
  },

  sand(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#b9a179';
    ctx.fillRect(0, 0, size, size);
    paintNoiseOverlay(ctx, size, seed, 5, 0.28);
    paintNoiseOverlay(ctx, size, seed + 3, 48, 0.2);
    paintSpeckles(ctx, size, seed + 8, size * 6, ['rgba(90,74,54,.3)', 'rgba(214,196,166,.35)', 'rgba(60,50,38,.22)'], 0.4, 2);
    // scattered gravel
    const rand = rng(seed + 12);
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = `rgba(${120 + rand() * 60 | 0},${104 + rand() * 50 | 0},${82 + rand() * 40 | 0},.55)`;
      ctx.beginPath();
      ctx.ellipse(rand() * size, rand() * size, 1.5 + rand() * 4, 1.2 + rand() * 3, rand() * 3, 0, 7);
      ctx.fill();
    }
    return { c, rough: [0.86, 1.0], normal: 1.3 };
  },

  tile(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    ctx.fillStyle = '#4a4a48';
    ctx.fillRect(0, 0, size, size);
    const n = 6, s = size / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 150 + rand() * 40;
      ctx.fillStyle = `rgb(${v | 0},${(v * 0.98) | 0},${(v * 0.92) | 0})`;
      ctx.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
      if (rand() > 0.82) { // cracked / missing tile
        ctx.fillStyle = 'rgba(50,46,42,.75)';
        ctx.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
      }
    }
    paintNoiseOverlay(ctx, size, seed + 2, 20, 0.16);
    paintStreaks(ctx, size, seed + 5, 10, 0.2);
    return { c, rough: [0.55, 0.90], normal: 1.5 };
  },

  metal(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    ctx.fillStyle = '#6a6f74';
    ctx.fillRect(0, 0, size, size);
    // brushed streaks
    for (let i = 0; i < size * 3; i++) {
      ctx.strokeStyle = `rgba(${rand() > 0.5 ? 255 : 0},${rand() > 0.5 ? 255 : 0},255,${rand() * 0.05})`;
      ctx.lineWidth = rand() * 2;
      const y = rand() * size;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + (rand() - 0.5) * 6); ctx.stroke();
    }
    // rust blooms
    for (let i = 0; i < 7; i++) {
      const x = rand() * size, y = rand() * size, r = 12 + rand() * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${140 + rand() * 40 | 0},70,32,.6)`);
      g.addColorStop(0.6, 'rgba(120,62,30,.28)');
      g.addColorStop(1, 'rgba(120,62,30,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // rivets
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const px = (x + 0.5) * size / 4, py = (y + 0.5) * size / 4;
      const g = ctx.createRadialGradient(px - 1.5, py - 1.5, 0, px, py, 5);
      g.addColorStop(0, 'rgba(220,224,228,.7)');
      g.addColorStop(1, 'rgba(40,42,46,.6)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill();
    }
    paintNoiseOverlay(ctx, size, seed + 13, 30, 0.12);
    return { c, rough: [0.26, 0.72], normal: 1.6, metal: 0.35 };
  },

  wood(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    const planks = 5, ph = size / planks;
    for (let p = 0; p < planks; p++) {
      const base = 118 + rand() * 34;
      ctx.fillStyle = `rgb(${base | 0},${(base * 0.68) | 0},${(base * 0.42) | 0})`;
      ctx.fillRect(0, p * ph, size, ph);
      // grain
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = `rgba(${60 + rand() * 40 | 0},${36 + rand() * 26 | 0},${18 + rand() * 16 | 0},${0.08 + rand() * 0.18})`;
        ctx.lineWidth = 0.6 + rand() * 2.2;
        const y = p * ph + rand() * ph;
        ctx.beginPath(); ctx.moveTo(0, y);
        for (let x = 0; x < size; x += 24) ctx.lineTo(x, y + Math.sin(x * 0.04 + i) * 2.5);
        ctx.stroke();
      }
      // knots
      if (rand() > 0.5) {
        const kx = rand() * size, ky = p * ph + ph * 0.5;
        for (let r = 12; r > 0; r -= 2) {
          ctx.strokeStyle = `rgba(70,42,20,${0.1 + (12 - r) * 0.03})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.ellipse(kx, ky, r, r * 0.6, 0, 0, 7); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(30,18,8,.5)';
      ctx.fillRect(0, p * ph, size, 2.5);
    }
    paintNoiseOverlay(ctx, size, seed + 4, 24, 0.14);
    return { c, rough: [0.55, 0.95], normal: 1.8 };
  },

  crate(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    const w = PAINTERS.wood(size, seed).c;
    ctx.drawImage(w, 0, 0);
    // frame
    ctx.strokeStyle = 'rgba(70,44,20,.85)';
    ctx.lineWidth = size * 0.055;
    ctx.strokeRect(0, 0, size, size);
    ctx.lineWidth = size * 0.04;
    ctx.beginPath();
    ctx.moveTo(size * 0.06, size * 0.06); ctx.lineTo(size * 0.94, size * 0.94);
    ctx.moveTo(size * 0.94, size * 0.06); ctx.lineTo(size * 0.06, size * 0.94);
    ctx.stroke();
    // stencil
    ctx.save();
    ctx.translate(size / 2, size * 0.3);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#20180c';
    ctx.font = `bold ${size * 0.11}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(['AMMO 7.62', 'FRAGILE', 'MEDICAL', 'RATIONS'][(rand() * 4) | 0], 0, 0);
    ctx.restore();
    return { c, rough: [0.6, 0.96], normal: 2.0 };
  },

  sandbag(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    ctx.fillStyle = '#9a8a63';
    ctx.fillRect(0, 0, size, size);
    // burlap weave
    for (let i = 0; i < size; i += 3) {
      ctx.fillStyle = `rgba(${60 + rand() * 40 | 0},${52 + rand() * 30 | 0},${34 + rand() * 20 | 0},.16)`;
      ctx.fillRect(i, 0, 1.6, size);
      ctx.fillRect(0, i, size, 1.6);
    }
    paintNoiseOverlay(ctx, size, seed, 10, 0.3);
    paintNoiseOverlay(ctx, size, seed + 5, 60, 0.24);
    return { c, rough: [0.82, 1.0], normal: 2.4 };
  },

  corrugated(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    const bands = 16;
    for (let i = 0; i < bands; i++) {
      const t = i / bands;
      const g = ctx.createLinearGradient(i * size / bands, 0, (i + 1) * size / bands, 0);
      g.addColorStop(0, '#4d5359'); g.addColorStop(0.5, '#8b939a'); g.addColorStop(1, '#4d5359');
      ctx.fillStyle = g;
      ctx.fillRect(i * size / bands, 0, size / bands + 1, size);
    }
    for (let i = 0; i < 10; i++) {
      const x = rand() * size, y = rand() * size, r = 10 + rand() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(150,72,32,.62)');
      g.addColorStop(1, 'rgba(150,72,32,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    paintNoiseOverlay(ctx, size, seed + 2, 40, 0.14);
    return { c, rough: [0.38, 0.86], normal: 1.2, metal: 0.22 };
  },

  /**
   * Disruptive-pattern camo. `opts.palette` is a list of colours, darkest last;
   * the first entry is the base coat. Blob sizes are deliberately small: each
   * part maps one tile across its whole surface, so a large pattern reads as
   * blotches the size of a thigh.
   */
  camo(size, seed, opts = {}) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    const pal = opts.palette || ['#8a8468', '#6f6c52', '#4c4f3c', '#33322a', '#a49b78'];
    ctx.fillStyle = pal[0];
    ctx.fillRect(0, 0, size, size);
    const layers = [[pal[1], size * 0.085, 34], [pal[2], size * 0.058, 44],
                    [pal[3], size * 0.040, 46], [pal[4], size * 0.030, 34]];
    for (const [col, r0, count] of layers) {
      ctx.fillStyle = col;
      for (let i = 0; i < count; i++) {
        const cx = rand() * size, cy = rand() * size;
        const pts = 7 + (rand() * 4 | 0);
        // pre-roll the radii so the wrapped copies match the original exactly
        const radii = [];
        for (let a = 0; a <= pts; a++) radii.push(r0 * (0.45 + rand() * 0.95));
        for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
          ctx.beginPath();
          for (let a = 0; a <= pts; a++) {
            const ang = a / pts * Math.PI * 2, rr = radii[a];
            const x = cx + ox + Math.cos(ang) * rr, y = cy + oy + Math.sin(ang) * rr;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath(); ctx.fill();
        }
      }
    }
    for (let i = 0; i < size; i += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.03})`;
      ctx.fillRect(i, 0, 1, size);
      ctx.fillRect(0, i, size, 1);
    }
    paintNoiseOverlay(ctx, size, seed + 3, 40, 0.09);
    return { c, rough: [0.80, 1.0], normal: 1.1 };
  },

  /** Ballistic nylon / cordura webbing for vests and pouches. */
  nylon(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    ctx.fillStyle = '#4a4a42';
    ctx.fillRect(0, 0, size, size);
    // cordura basket weave
    const cell = 8;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const v = 62 + rand() * 26;
        ctx.fillStyle = `rgb(${v | 0},${(v * 0.98) | 0},${(v * 0.86) | 0})`;
        const horiz = ((x / cell + y / cell) & 1) === 0;
        ctx.fillRect(x + 0.5, y + 0.5, horiz ? cell - 1 : cell - 3, horiz ? cell - 3 : cell - 1);
      }
    }
    // stitching rows
    ctx.strokeStyle = 'rgba(28,28,24,.55)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      const y = (i + 0.5) * size / 6;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    paintNoiseOverlay(ctx, size, seed + 1, 30, 0.14);
    paintStreaks(ctx, size, seed + 5, 8, 0.16);
    return { c, rough: [0.75, 1.0], normal: 1.6 };
  },

  /** Scuffed painted composite: helmets, knee pads, hard kit. */
  hardkit(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    ctx.fillStyle = '#4c4d47';
    ctx.fillRect(0, 0, size, size);
    paintNoiseOverlay(ctx, size, seed, 8, 0.16);
    // scuffs down to a lighter substrate
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(150,148,138,${0.06 + rand() * 0.16})`;
      ctx.lineWidth = 0.6 + rand() * 2.2;
      const x = rand() * size, y = rand() * size, a = rand() * 6.28, l = 6 + rand() * 40;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    paintSpeckles(ctx, size, seed + 2, size, ['rgba(30,30,28,.3)', 'rgba(170,168,158,.16)'], 0.4, 1.6);
    return { c, rough: [0.45, 0.9], normal: 1.3 };
  },

  /** Skin with pore break-up, for hands and the strip of face on show. */
  skin(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#9c7657';
    ctx.fillRect(0, 0, size, size);
    paintNoiseOverlay(ctx, size, seed, 12, 0.12);
    paintSpeckles(ctx, size, seed + 4, size * 2, ['rgba(120,86,60,.22)', 'rgba(190,156,126,.18)'], 0.3, 1.3);
    return { c, rough: [0.6, 0.9], normal: 0.8 };
  },

  glass(size, seed) {
    const c = canvas(size), ctx = c.getContext('2d');
    const rand = rng(seed);
    ctx.fillStyle = '#8fb0b8';
    ctx.fillRect(0, 0, size, size);
    paintNoiseOverlay(ctx, size, seed, 6, 0.16);
    ctx.strokeStyle = 'rgba(230,245,250,.35)';
    for (let i = 0; i < 14; i++) {
      ctx.lineWidth = 0.6 + rand() * 1.6;
      let x = rand() * size, y = rand() * size;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += (rand() - 0.5) * 90; y += (rand() - 0.5) * 90; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return { c, rough: [0.03, 0.25], normal: 0.6, metal: 0.1 };
  },
};

/**
 * Build (and cache) a PBR material from a procedural painter.
 * @param {string} kind key of PAINTERS
 * @param {object} opts { repeat, seed, size, color, metalness, roughness, side }
 */
const TEX_CACHE = new Map();

/**
 * Build (and cache) the map/normal/roughness trio for a surface.
 *
 * Deliberately keyed WITHOUT the tint: a tint is just `material.color`, which
 * the shader multiplies over the map, so every tinted variant can share one
 * texture set. The seed is also quantised — the map hands out a different seed
 * per object for variety, and honouring all of them meant generating ninety-odd
 * 512² sets at load.
 */
function textureSet(kind, size, seed, repeat, extra) {
  const variant = ((seed | 0) % 3 + 3) % 3;
  const key = `${kind}|${size}|${variant}|${repeat}|${extra ? JSON.stringify(extra) : ''}`;
  let set = TEX_CACHE.get(key);
  if (set) return set;

  const painter = PAINTERS[kind];
  if (!painter) throw new Error('unknown texture kind: ' + kind);
  const r = painter(size, 1337 + variant * 977, extra);
  const { nrm, rgh } = derivedMaps(r.c, r.normal ?? 1.5, r.rough[0], r.rough[1]);
  set = {
    map: tex(r.c, repeat),
    normalMap: texLinear(nrm, repeat),
    roughnessMap: texLinear(rgh, repeat),
    metal: r.metal ?? 0,
  };
  TEX_CACHE.set(key, set);
  return set;
}

/**
 * PBR material from a procedural painter. Materials are cheap; the textures
 * behind them are not, so those are shared across every tint of a surface.
 * @param {string} kind key of PAINTERS
 * @param {object} opts { repeat, seed, size, color, metalness, side, opts }
 */
export function mat(kind, opts = {}) {
  const size = opts.size ?? 512;
  const seed = opts.seed ?? 1337;
  const repeat = opts.repeat ?? 1;
  const key = `${kind}|${size}|${seed}|${repeat}|${opts.color ?? ''}|${opts.metalness ?? ''}|` +
              `${opts.side ?? ''}|${opts.transparent ?? ''}|${opts.opts ? JSON.stringify(opts.opts) : ''}`;
  if (CACHE.has(key)) return CACHE.get(key);

  const set = textureSet(kind, size, seed, repeat, opts.opts);
  const m = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    metalness: opts.metalness ?? set.metal,
    roughness: 1.0,
    color: opts.color ?? 0xffffff,
    side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
  });
  m.normalScale.set(opts.normalScale ?? 1, opts.normalScale ?? 1);
  CACHE.set(key, m);
  return m;
}

/** Plain colored PBR material, cached. */
export function flat(color, roughness = 0.85, metalness = 0.0, extra = {}) {
  const key = `flat|${color}|${roughness}|${metalness}|${JSON.stringify(extra)}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  CACHE.set(key, m);
  return m;
}

/**
 * Pack several surface types into one atlas so a whole character can be drawn
 * with a single material (one draw call per bone instead of one per bone *and*
 * material). Returns the three maps plus the UV rect for each entry.
 *
 * entries: [{ key, kind?, seed?, tint?, color?, rough? }]
 *   kind  - a PAINTERS name, or omit and give `color` for a plain surface
 *   tint  - multiplied over the painted result
 */
export function makeAtlas(entries, tile = 256) {
  const cols = Math.ceil(Math.sqrt(entries.length));
  const rows = Math.ceil(entries.length / cols);
  const W = cols * tile, H = rows * tile;
  const mk = (fill) => {
    const c = canvas(1); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = fill; x.fillRect(0, 0, W, H);
    return c;
  };
  const colC = mk('#808080'), nrmC = mk('#8080ff'), rghC = mk('#bfbfbf');
  const cx = colC.getContext('2d'), nx = nrmC.getContext('2d'), rx = rghC.getContext('2d');
  const rects = {};

  entries.forEach((e, i) => {
    const gx = (i % cols) * tile, gy = Math.floor(i / cols) * tile;
    let src, nrm, rgh;
    if (e.kind) {
      const r = PAINTERS[e.kind](tile, e.seed ?? 7, e.opts);
      src = r.c;
      const d = derivedMaps(src, r.normal ?? 1.4, (e.rough || r.rough)[0], (e.rough || r.rough)[1]);
      nrm = d.nrm; rgh = d.rgh;
    } else {
      src = canvas(tile);
      const c2 = src.getContext('2d');
      c2.fillStyle = e.color || '#888';
      c2.fillRect(0, 0, tile, tile);
      // a touch of break-up so flat surfaces still catch the light
      paintNoiseOverlay(c2, tile, e.seed ?? 3, 20, 0.06);
      const d = derivedMaps(src, 0.5, (e.rough || [0.7, 0.85])[0], (e.rough || [0.7, 0.85])[1]);
      nrm = d.nrm; rgh = d.rgh;
    }
    cx.drawImage(src, gx, gy);
    if (e.tint) {
      cx.save();
      cx.globalCompositeOperation = 'multiply';
      cx.fillStyle = e.tint;
      cx.fillRect(gx, gy, tile, tile);
      cx.restore();
    }
    nx.drawImage(nrm, gx, gy);
    rx.drawImage(rgh, gx, gy);
    // Inset by a texel so bilinear filtering never samples the neighbouring
    // tile. NB: the tile is drawn in canvas space (Y down) but sampled in UV
    // space (V up) — with the default flipY upload the row order inverts, so
    // the rect has to be measured from the bottom.
    const padU = 1.5 / W, padV = 1.5 / H;
    rects[e.key] = {
      x: gx / W + padU,
      y: 1 - (gy + tile) / H + padV,
      w: tile / W - 2 * padU,
      h: tile / H - 2 * padV,
    };
  });

  const t = (cv, srgb) => {
    const tx = new THREE.CanvasTexture(cv);
    tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
    tx.anisotropy = 8;
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  };
  return { map: t(colC, true), normalMap: t(nrmC, false), roughnessMap: t(rghC, false), rects };
}

/** Remap a geometry's UVs into an atlas rect (assumes source UVs in 0..1). */
export function remapUV(geo, rect, repeat = 1) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i) * repeat, v = uv.getY(i) * repeat;
    u = u - Math.floor(u); v = v - Math.floor(v);
    uv.setXY(i, rect.x + u * rect.w, rect.y + v * rect.h);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Sky dome shader — a hazy late-afternoon desert sky with a warm sun bloom. */
export function skyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSun: { value: sunDir.clone().normalize() },
      uTop: { value: new THREE.Color(0x1d4f8c) },
      uMid: { value: new THREE.Color(0x86a8c4) },
      uHorizon: { value: new THREE.Color(0xf0cb99) },
      uGround: { value: new THREE.Color(0x7a6750) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uSun,uTop,uMid,uHorizon,uGround;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col;
        if(h > 0.0){
          float t = pow(clamp(h,0.0,1.0), 0.55);
          col = mix(uHorizon, uMid, smoothstep(0.0,0.30,h));
          col = mix(col, uTop, smoothstep(0.16,0.85,t));
        } else {
          col = mix(uHorizon, uGround, smoothstep(0.0,0.35,-h));
        }
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(1.0,0.90,0.72) * smoothstep(0.99988, 0.99996, sd) * 5.5;  // disc (~0.5 deg)
        col += vec3(1.0,0.74,0.44) * pow(sd, 1400.0) * 1.2;                   // inner glow
        col += vec3(1.0,0.68,0.38) * pow(sd, 90.0) * 0.30;                    // halo
        col += vec3(1.0,0.66,0.36) * pow(sd, 9.0) * 0.14;                     // scatter
        col += vec3(1.0,0.80,0.55) * pow(sd, 2.5) * 0.06 * max(0.0, 1.0-abs(h));
        // faint cloud banding near the horizon
        float band = sin(d.x*7.0 + d.z*4.0)*0.5+0.5;
        col += vec3(0.05,0.045,0.04) * band * smoothstep(0.35,0.02,abs(h-0.12));
        gl_FragColor = vec4(col,1.0);
      }`,
  });
}
