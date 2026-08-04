// Pooled visual effects: tracers, muzzle flashes, impact sparks, smoke, blood,
// bullet-hole decals, shell casings and explosions.
// Every object is allocated up front — nothing is added to or removed from the
// scene graph at runtime (that would force shader recompiles mid-firefight).
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export function softDot(size = 64, hard = 0.0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * hard * 0.5, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function smokePuff(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.42;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.42;
    const r = size * (0.10 + Math.random() * 0.18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.30)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fade the rim so tiles never show a hard edge
  const v = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function bulletHoleTex(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const R = size / 2;
  // dust ring
  let g = ctx.createRadialGradient(R, R, R * 0.16, R, R, R * 0.95);
  g.addColorStop(0, 'rgba(30,26,22,0.85)');
  g.addColorStop(0.35, 'rgba(60,54,46,0.42)');
  g.addColorStop(1, 'rgba(90,84,74,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  // hole
  g = ctx.createRadialGradient(R, R, 0, R, R, R * 0.24);
  g.addColorStop(0, 'rgba(4,4,5,1)');
  g.addColorStop(0.7, 'rgba(14,12,11,0.95)');
  g.addColorStop(1, 'rgba(30,26,22,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(R, R, R * 0.26, 0, 7); ctx.fill();
  // radial cracks
  ctx.strokeStyle = 'rgba(20,18,16,0.6)';
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * 7;
    ctx.lineWidth = 0.6 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(R + Math.cos(a) * R * 0.2, R + Math.sin(a) * R * 0.2);
    ctx.lineTo(R + Math.cos(a) * R * (0.4 + Math.random() * 0.5), R + Math.sin(a) * R * (0.4 + Math.random() * 0.5));
    ctx.stroke();
  }
  // sRGB: without this the canvas is read as linear and dark red blood
  // comes out as bright orange after the output transform.
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bloodTex(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const R = size / 2;
  const g = ctx.createRadialGradient(R, R, 0, R, R, R * 0.6);
  g.addColorStop(0, 'rgba(120,8,10,0.95)');
  g.addColorStop(0.6, 'rgba(90,6,8,0.6)');
  g.addColorStop(1, 'rgba(70,4,6,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(R, R, R * 0.62, 0, 7); ctx.fill();
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * 7, d = R * (0.4 + Math.random() * 0.55);
    const r = R * (0.04 + Math.random() * 0.11);
    ctx.fillStyle = `rgba(${90 + Math.random() * 40 | 0},6,8,${0.35 + Math.random() * 0.5})`;
    ctx.beginPath(); ctx.arc(R + Math.cos(a) * d, R + Math.sin(a) * d, r, 0, 7); ctx.fill();
  }
  // sRGB: without this the canvas is read as linear and dark red blood
  // comes out as bright orange after the output transform.
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SURFACE_COLORS = {
  concrete: [0xbdb6a8, 0x8a8478], plaster: [0xd6cbb4, 0xa79b84], brick: [0xa8604a, 0x6d4436],
  metal: [0xffd08a, 0xffa040], corrugated: [0xffd08a, 0xffa040], asphalt: [0x6a6a6c, 0x4a4a4c],
  sand: [0xc9b28a, 0x9a8460], wood: [0xa8763e, 0x6b4a2c], crate: [0xa8763e, 0x6b4a2c],
  tile: [0xd8d4c8, 0xa0998c], sandbag: [0xb8a880, 0x8a7a58], glass: [0xcfe6ec, 0x9fc2cc],
};

export class Effects {
  constructor(scene, camera, quality = 2) {
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.time = 0;

    // ---------------- sparks (additive points)
    const SPARKS = quality >= 2 ? 900 : 400;
    this.sparkN = SPARKS;
    this.sparkPos = new Float32Array(SPARKS * 3);
    this.sparkCol = new Float32Array(SPARKS * 3);
    this.sparkSize = new Float32Array(SPARKS);
    this.sparkVel = new Float32Array(SPARKS * 3);
    this.sparkLife = new Float32Array(SPARKS);
    this.sparkMax = new Float32Array(SPARKS);
    this.sparkGrav = new Float32Array(SPARKS);
    this.sparkHead = 0;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    sg.setAttribute('psize', new THREE.BufferAttribute(this.sparkSize, 1));
    sg.setDrawRange(0, SPARKS);
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: { uTex: { value: softDot(48, 0.15) }, uScale: { value: 1 } },
      vertexShader: `
        attribute float psize; attribute vec3 color; varying vec3 vC; varying float vA;
        uniform float uScale;
        void main(){
          vC = color; vA = min(1.0, psize*40.0);
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = psize * uScale / max(0.001,-mv.z);
        }`,
      fragmentShader: `
        uniform sampler2D uTex; varying vec3 vC; varying float vA;
        void main(){
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vC, t.a*vA);
          if(gl_FragColor.a < 0.01) discard;
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);

    // ---------------- smoke / dust (soft alpha points)
    const SMOKE = quality >= 2 ? 420 : 200;
    this.smokeN = SMOKE;
    this.smokePos = new Float32Array(SMOKE * 3);
    this.smokeCol = new Float32Array(SMOKE * 3);
    this.smokeSize = new Float32Array(SMOKE);
    this.smokeVel = new Float32Array(SMOKE * 3);
    this.smokeLife = new Float32Array(SMOKE);
    this.smokeMax = new Float32Array(SMOKE);
    this.smokeGrow = new Float32Array(SMOKE);
    this.smokeAlpha = new Float32Array(SMOKE);
    this.smokeHead = 0;
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    mg.setAttribute('color', new THREE.BufferAttribute(this.smokeCol, 3));
    mg.setAttribute('psize', new THREE.BufferAttribute(this.smokeSize, 1));
    mg.setAttribute('palpha', new THREE.BufferAttribute(this.smokeAlpha, 1));
    mg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.smoke = new THREE.Points(mg, new THREE.ShaderMaterial({
      uniforms: { uTex: { value: smokePuff() }, uScale: { value: 1 } },
      vertexShader: `
        attribute float psize; attribute float palpha; attribute vec3 color;
        varying vec3 vC; varying float vA; uniform float uScale;
        void main(){
          vC = color; vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = psize * uScale / max(0.001,-mv.z);
        }`,
      fragmentShader: `
        uniform sampler2D uTex; varying vec3 vC; varying float vA;
        void main(){
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vC, t.a*vA);
          if(gl_FragColor.a < 0.004) discard;
        }`,
      transparent: true, depthWrite: false,
    }));
    this.smoke.frustumCulled = false;
    scene.add(this.smoke);

    // ---------------- tracers
    const TR = 40;
    this.tracers = [];
    const tracerGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 5, 1, true);
    tracerGeo.rotateX(Math.PI / 2);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffd28a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < TR; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
      m.visible = false; m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 1 });
    }
    this.tracerHead = 0;

    // ---------------- muzzle flashes (billboard + pooled lights)
    this.flashes = [];
    const flashTex = softDot(64, 0.05);
    for (let i = 0; i < 6; i++) {
      // depthTest stays ON here: these are world-space flashes from other
      // shooters, and disabling it makes every distant muzzle blast glow through
      // the walls in front of it (a close one smears across the whole screen).
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, color: 0xffd694, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      spr.visible = false; spr.frustumCulled = false; spr.renderOrder = 20;
      scene.add(spr);
      const star = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: flashTex, color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      star.visible = false; star.frustumCulled = false; star.renderOrder = 21;
      scene.add(star);
      this.flashes.push({ spr, star, life: 0, max: 0.05, scale: 1 });
    }
    this.flashHead = 0;

    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffc070, 0, 26, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, peak: 0 });
    }
    this.lightHead = 0;

    // ---------------- decals
    this.decals = this._makeDecalPool(bulletHoleTex(), quality >= 2 ? 160 : 60, 0.999);
    this.bloodDecals = this._makeDecalPool(bloodTex(), quality >= 2 ? 80 : 30, 0.998);

    // ---------------- shell casings
    const SH = 48;
    this.shells = [];
    const shellGeo = new THREE.CylinderGeometry(0.007, 0.008, 0.028, 6);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.9, roughness: 0.35 });
    for (let i = 0; i < SH; i++) {
      const m = new THREE.Mesh(shellGeo, shellMat);
      m.visible = false; m.castShadow = false;
      scene.add(m);
      this.shells.push({ mesh: m, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    this.shellHead = 0;

    // ---------------- explosion shells
    this.blasts = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      m.visible = false; scene.add(m);
      this.blasts.push({ mesh: m, life: 0 });
    }
    this.blastHead = 0;
  }

  _makeDecalPool(texture, count, depthScale) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, opacity: 1,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) {
      _m.makeScale(0, 0, 0);
      mesh.setMatrixAt(i, _m);
    }
    mesh.count = count;
    this.scene.add(mesh);
    return { mesh, head: 0, count };
  }

  // ---------------------------------------------------------------- spawners

  spark(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 9) {
    const i = this.sparkHead = (this.sparkHead + 1) % this.sparkN;
    this.sparkPos[i * 3] = x; this.sparkPos[i * 3 + 1] = y; this.sparkPos[i * 3 + 2] = z;
    this.sparkVel[i * 3] = vx; this.sparkVel[i * 3 + 1] = vy; this.sparkVel[i * 3 + 2] = vz;
    this.sparkCol[i * 3] = r; this.sparkCol[i * 3 + 1] = g; this.sparkCol[i * 3 + 2] = b;
    this.sparkSize[i] = size; this.sparkLife[i] = life; this.sparkMax[i] = life;
    this.sparkGrav[i] = grav;
  }

  puff(x, y, z, vx, vy, vz, r, g, b, size, life, grow = 1.5, alpha = 0.5) {
    const i = this.smokeHead = (this.smokeHead + 1) % this.smokeN;
    this.smokePos[i * 3] = x; this.smokePos[i * 3 + 1] = y; this.smokePos[i * 3 + 2] = z;
    this.smokeVel[i * 3] = vx; this.smokeVel[i * 3 + 1] = vy; this.smokeVel[i * 3 + 2] = vz;
    this.smokeCol[i * 3] = r; this.smokeCol[i * 3 + 1] = g; this.smokeCol[i * 3 + 2] = b;
    this.smokeSize[i] = size; this.smokeLife[i] = life; this.smokeMax[i] = life;
    this.smokeGrow[i] = grow; this.smokeAlpha[i] = alpha;
  }

  tracer(from, to, color = 0xffd28a, width = 1, speed = 380) {
    const t = this.tracers[this.tracerHead = (this.tracerHead + 1) % this.tracers.length];
    _v.subVectors(to, from);
    const full = _v.length();
    if (full < 0.05) return;
    // A round that hits nothing runs to its full range; drawing that as a single
    // streak paints a bright beam clean across the sky. Show the leading section
    // only, which is all a tracer reads as anyway.
    const len = Math.min(full, 40);
    _v.divideScalar(full);
    t.mesh.position.set(
      from.x + _v.x * len * 0.5,
      from.y + _v.y * len * 0.5,
      from.z + _v.z * len * 0.5);
    t.mesh.scale.set(width, width, len);
    t.mesh.lookAt(to);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.85;
    t.mesh.visible = true;
    t.life = t.max = Math.min(0.085, 0.025 + len / speed);
  }

  muzzleFlash(pos, dir, scale = 1) {
    const f = this.flashes[this.flashHead = (this.flashHead + 1) % this.flashes.length];
    f.spr.position.copy(pos).addScaledVector(dir, 0.05);
    f.spr.scale.setScalar(0.22 * scale);
    f.spr.material.rotation = Math.random() * 6.28;
    f.spr.visible = true;
    f.star.position.copy(pos).addScaledVector(dir, 0.16);
    f.star.quaternion.copy(this.camera.quaternion);
    f.star.scale.set(0.42 * scale, 0.09 * scale, 1);
    f.star.rotation.z += (Math.random() - 0.5) * 0.5;
    f.star.visible = true;
    f.life = f.max = 0.042;
    f.scale = scale;

    this.light(pos.x, pos.y, pos.z, 0xffc070, 9 * scale, 0.055, 16);

    // smoke wisp + a couple of sparks out the muzzle
    for (let i = 0; i < 2; i++) {
      this.puff(pos.x, pos.y, pos.z,
        dir.x * (1.2 + Math.random()) + (Math.random() - .5) * .6,
        dir.y * (1.2 + Math.random()) + 0.4 + Math.random() * .4,
        dir.z * (1.2 + Math.random()) + (Math.random() - .5) * .6,
        0.42, 0.40, 0.36, 0.35 * scale, 0.55 + Math.random() * 0.4, 2.4, 0.16);
    }
    for (let i = 0; i < 3 * scale; i++) {
      this.spark(pos.x, pos.y, pos.z,
        dir.x * (4 + Math.random() * 10) + (Math.random() - .5) * 3,
        dir.y * (4 + Math.random() * 10) + (Math.random() - .5) * 3,
        dir.z * (4 + Math.random() * 10) + (Math.random() - .5) * 3,
        1, 0.72, 0.32, 0.045, 0.08 + Math.random() * 0.1, 12);
    }
  }

  light(x, y, z, color, peak, life, dist = 22) {
    const l = this.lights[this.lightHead = (this.lightHead + 1) % this.lights.length];
    l.light.position.set(x, y, z);
    l.light.color.setHex(color);
    l.light.distance = dist;
    l.peak = peak; l.life = l.max = life;
  }

  impact(point, normal, surface = 'concrete', power = 1) {
    const [c1, c2] = SURFACE_COLORS[surface] || SURFACE_COLORS.concrete;
    const col = new THREE.Color(Math.random() > 0.5 ? c1 : c2);
    const metallic = surface === 'metal' || surface === 'corrugated';
    const n = metallic ? 14 : 8;
    for (let i = 0; i < n * power; i++) {
      const sx = normal.x + (Math.random() - 0.5) * 1.5;
      const sy = normal.y + (Math.random() - 0.5) * 1.5;
      const sz = normal.z + (Math.random() - 0.5) * 1.5;
      const sp = metallic ? 5 + Math.random() * 11 : 2 + Math.random() * 5;
      if (metallic) {
        this.spark(point.x, point.y, point.z, sx * sp, sy * sp + 1.4, sz * sp,
          1, 0.72 + Math.random() * 0.25, 0.32, 0.035, 0.18 + Math.random() * 0.35, 16);
      } else {
        this.spark(point.x, point.y, point.z, sx * sp, sy * sp + 1.0, sz * sp,
          col.r, col.g, col.b, 0.05, 0.2 + Math.random() * 0.3, 13);
      }
    }
    for (let i = 0; i < 2 + power; i++) {
      this.puff(
        point.x + normal.x * 0.05, point.y + normal.y * 0.05, point.z + normal.z * 0.05,
        normal.x * (0.6 + Math.random()) + (Math.random() - .5),
        normal.y * (0.6 + Math.random()) + 0.5,
        normal.z * (0.6 + Math.random()) + (Math.random() - .5),
        col.r * 1.15, col.g * 1.1, col.b * 1.05,
        0.4 + Math.random() * 0.35, 0.5 + Math.random() * 0.6, 2.6, 0.28);
    }
    if (metallic) this.light(point.x + normal.x * .2, point.y + normal.y * .2, point.z + normal.z * .2, 0xffa050, 2.2, 0.06, 5);
    this.decal(this.decals, point, normal, 0.13 + Math.random() * 0.1);
  }

  bloodBurst(point, dir, power = 1) {
    for (let i = 0; i < 12 * power; i++) {
      const sp = 1.5 + Math.random() * 6;
      this.spark(point.x, point.y, point.z,
        dir.x * sp + (Math.random() - .5) * 3,
        dir.y * sp + (Math.random() - .5) * 3 + 1,
        dir.z * sp + (Math.random() - .5) * 3,
        0.55 + Math.random() * 0.25, 0.03, 0.04, 0.055, 0.25 + Math.random() * 0.4, 14);
    }
    for (let i = 0; i < 2; i++) {
      this.puff(point.x, point.y, point.z, (Math.random() - .5) * 1.4, 0.5 + Math.random(), (Math.random() - .5) * 1.4,
        0.35, 0.03, 0.04, 0.32, 0.45, 2.0, 0.30);
    }
  }

  bloodPool(point, normal) {
    this.decal(this.bloodDecals, point, normal, 0.5 + Math.random() * 0.7);
  }

  decal(pool, point, normal, size) {
    const i = pool.head = (pool.head + 1) % pool.count;
    _v.copy(normal);
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28);
    _q.multiply(spin);
    _m.compose(
      new THREE.Vector3(point.x + normal.x * 0.012, point.y + normal.y * 0.012, point.z + normal.z * 0.012),
      _q, new THREE.Vector3(size, size, size)
    );
    pool.mesh.setMatrixAt(i, _m);
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  shell(pos, right, up, size = 1) {
    const s = this.shells[this.shellHead = (this.shellHead + 1) % this.shells.length];
    s.mesh.position.copy(pos);
    s.mesh.scale.setScalar(size);
    s.mesh.visible = true;
    s.vel.copy(right).multiplyScalar(1.6 + Math.random() * 1.4)
      .addScaledVector(up, 1.2 + Math.random() * 1.0);
    s.vel.x += (Math.random() - .5) * .6; s.vel.z += (Math.random() - .5) * .6;
    s.spin.set(Math.random() * 22 - 11, Math.random() * 22 - 11, Math.random() * 22 - 11);
    s.life = 1.6;
  }

  explosion(pos, radius = 6) {
    const b = this.blasts[this.blastHead = (this.blastHead + 1) % this.blasts.length];
    b.mesh.position.copy(pos);
    b.mesh.visible = true;
    b.life = 1;
    b.radius = radius;
    this.light(pos.x, pos.y + 0.4, pos.z, 0xffb060, 60, 0.4, radius * 6);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * 6.283, e = Math.random() * 1.4 - 0.15;
      const sp = 5 + Math.random() * 24;
      this.spark(pos.x, pos.y + 0.2, pos.z,
        Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp,
        1, 0.6 + Math.random() * 0.35, 0.22, 0.07, 0.4 + Math.random() * 0.8, 15);
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.283;
      this.puff(pos.x, pos.y + 0.3, pos.z,
        Math.cos(a) * (1 + Math.random() * 5), 1 + Math.random() * 4, Math.sin(a) * (1 + Math.random() * 5),
        0.28, 0.25, 0.23, 1.1 + Math.random() * 1.4, 1.4 + Math.random() * 1.2, 2.6, 0.5);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.283;
      this.puff(pos.x, pos.y + 0.15, pos.z,
        Math.cos(a) * (3 + Math.random() * 7), 0.4 + Math.random(), Math.sin(a) * (3 + Math.random() * 7),
        0.75, 0.62, 0.45, 1.3, 0.9 + Math.random() * 0.7, 3.0, 0.36);
    }
  }

  // ---------------------------------------------------------------- update

  update(dt, renderHeight) {
    this.time += dt;
    const scale = renderHeight * 0.5;
    this.sparks.material.uniforms.uScale.value = scale;
    this.smoke.material.uniforms.uScale.value = scale;

    // sparks
    for (let i = 0; i < this.sparkN; i++) {
      if (this.sparkLife[i] <= 0) { if (this.sparkSize[i] !== 0) this.sparkSize[i] = 0; continue; }
      this.sparkLife[i] -= dt;
      const t = Math.max(0, this.sparkLife[i] / this.sparkMax[i]);
      const i3 = i * 3;
      this.sparkVel[i3 + 1] -= this.sparkGrav[i] * dt;
      const drag = 1 - Math.min(0.9, 2.2 * dt);
      this.sparkVel[i3] *= drag; this.sparkVel[i3 + 1] *= drag; this.sparkVel[i3 + 2] *= drag;
      this.sparkPos[i3] += this.sparkVel[i3] * dt;
      this.sparkPos[i3 + 1] += this.sparkVel[i3 + 1] * dt;
      this.sparkPos[i3 + 2] += this.sparkVel[i3 + 2] * dt;
      if (this.sparkPos[i3 + 1] < 0.02) { this.sparkPos[i3 + 1] = 0.02; this.sparkVel[i3 + 1] *= -0.32; this.sparkVel[i3] *= .6; this.sparkVel[i3 + 2] *= .6; }
      this.sparkSize[i] = 0.055 * t;
      if (this.sparkLife[i] <= 0) this.sparkSize[i] = 0;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.psize.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;

    // smoke
    for (let i = 0; i < this.smokeN; i++) {
      if (this.smokeLife[i] <= 0) { if (this.smokeAlpha[i] !== 0) this.smokeAlpha[i] = 0; continue; }
      this.smokeLife[i] -= dt;
      const t = Math.max(0, this.smokeLife[i] / this.smokeMax[i]);
      const i3 = i * 3;
      const drag = 1 - Math.min(0.9, 1.6 * dt);
      this.smokeVel[i3] *= drag; this.smokeVel[i3 + 2] *= drag;
      this.smokeVel[i3 + 1] = this.smokeVel[i3 + 1] * drag + 0.5 * dt;
      this.smokePos[i3] += this.smokeVel[i3] * dt;
      this.smokePos[i3 + 1] += this.smokeVel[i3 + 1] * dt;
      this.smokePos[i3 + 2] += this.smokeVel[i3 + 2] * dt;
      this.smokeSize[i] += this.smokeGrow[i] * dt;
      this.smokeAlpha[i] = Math.min(1, t * 2.2) * 0.55 * (this.smokeMax[i] > 1 ? 1 : 0.8);
      if (this.smokeLife[i] <= 0) this.smokeAlpha[i] = 0;
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
    this.smoke.geometry.attributes.psize.needsUpdate = true;
    this.smoke.geometry.attributes.palpha.needsUpdate = true;
    this.smoke.geometry.attributes.color.needsUpdate = true;

    // tracers
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = 0.9 * (t.life / t.max);
    }

    // flashes
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.spr.visible = false; f.star.visible = false; continue; }
      const k = f.life / f.max;
      f.spr.material.opacity = k;
      f.star.material.opacity = k * 0.9;
      f.star.scale.set(0.42 * f.scale * (0.6 + k * 0.6), 0.09 * f.scale * k, 1);
    }

    // lights
    for (const l of this.lights) {
      if (l.life <= 0) { if (l.light.intensity) l.light.intensity = 0; continue; }
      l.life -= dt;
      const k = Math.max(0, l.life / l.max);
      l.light.intensity = l.peak * k * k;
    }

    // shells
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      s.vel.y -= 16 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      if (s.mesh.position.y < 0.02) {
        s.mesh.position.y = 0.02;
        s.vel.y *= -0.35; s.vel.x *= 0.6; s.vel.z *= 0.6;
        s.spin.multiplyScalar(0.5);
      }
    }

    // blasts
    for (const b of this.blasts) {
      if (b.life <= 0) continue;
      b.life -= dt * 3.2;
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      const k = 1 - b.life;
      b.mesh.scale.setScalar(b.radius * (0.20 + k * 0.55));
      b.mesh.material.opacity = b.life * b.life * 0.55;
      b.mesh.material.color.setRGB(1, 0.35 + b.life * 0.5, 0.12 + b.life * 0.2);
    }
  }
}
