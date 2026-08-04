// Box-built soldier with a procedural animation rig and per-zone hitboxes.
import * as THREE from 'three';
import { flat } from '../world/textures.js';
import { buildSoldier, TEAM } from './soldier.js';
import { buildViewModel } from './weapons.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export { TEAM, buildSoldier };

// ---------------------------------------------------------------- arm IK

const UPPER_ARM = 0.275;   // shoulder -> elbow (matches the rig in soldier.js)
const LOWER_ARM = 0.285;   // elbow -> hand

const _ik = {
  target: new THREE.Vector3(), shoulder: new THREE.Vector3(), dir: new THREE.Vector3(),
  pole: new THREE.Vector3(), axis: new THREE.Vector3(), boneY: new THREE.Vector3(),
  zAxis: new THREE.Vector3(), m: new THREE.Matrix4(),
};

/**
 * Point a two-bone limb at a target.
 *
 * `arm.up` is rotated so the chain reaches `targetObj`, and `arm.lo` takes the
 * remaining elbow angle. Bones hang along local -Y; the elbow bends about the
 * bone's local +X, so the basis is built with X as the bend axis.
 *
 * @param side +1 for the right arm, -1 for the left — flips which way the elbow
 *             breaks so they don't both fold inwards.
 */
function solveArm(arm, torso, targetObj, L1, L2, side) {
  if (!targetObj) return;
  const t = _ik.target;
  targetObj.getWorldPosition(t);
  torso.worldToLocal(t);                       // everything below is torso space
  const s = _ik.shoulder.copy(arm.up.position);

  const d = _ik.dir.subVectors(t, s);
  let dist = d.length();
  if (dist < 1e-4) return;
  const min = Math.abs(L1 - L2) + 0.02, max = L1 + L2 - 0.02;
  dist = Math.min(max, Math.max(min, dist));
  d.normalize();

  // shoulder angle off the straight line, and the interior elbow angle
  const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
  const a = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const cosB = (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2);
  const b = Math.acos(Math.min(1, Math.max(-1, cosB)));

  // pole: push elbows out and down, away from the body
  _ik.pole.set(side * 0.85, -0.35, 0.4).normalize();
  _ik.axis.crossVectors(d, _ik.pole);
  if (_ik.axis.lengthSq() < 1e-6) _ik.axis.set(1, 0, 0);
  _ik.axis.normalize();

  // upper arm points along -Y, so its local +Y is the reverse of the limb dir
  _ik.boneY.copy(d).applyAxisAngle(_ik.axis, a).multiplyScalar(-1).normalize();
  _ik.zAxis.crossVectors(_ik.axis, _ik.boneY).normalize();
  _ik.m.makeBasis(_ik.axis, _ik.boneY, _ik.zAxis);
  arm.up.quaternion.setFromRotationMatrix(_ik.m);
  arm.lo.rotation.set(-(Math.PI - b), 0, 0);
}

const HITBOXES = [
  // name, offsetY (from feet, standing), half-extents
  { zone: 'head', y: 1.66, hx: 0.13, hy: 0.15, hz: 0.14, mult: 'head' },
  { zone: 'chest', y: 1.26, hx: 0.25, hy: 0.24, hz: 0.18, mult: 'body' },
  { zone: 'stomach', y: 0.99, hx: 0.22, hy: 0.16, hz: 0.16, mult: 'body' },
  { zone: 'arms', y: 1.22, hx: 0.42, hy: 0.22, hz: 0.14, mult: 'limb' },
  { zone: 'legs', y: 0.45, hx: 0.24, hy: 0.46, hz: 0.18, mult: 'leg' },
];

export class Character {
  constructor(scene, teamId, name, isBot = true) {
    this.team = teamId;
    this.name = name;
    this.isBot = isBot;
    this.rig = buildSoldier(teamId);
    this.object = this.rig.root;
    this.object.visible = false;
    scene.add(this.object);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.armor = 100;
    this.alive = false;
    this.crouch = 0;       // 0..1
    this.height = 1.78;
    this.radius = 0.34;
    this.walkPhase = 0;
    this.speed = 0;
    this.kills = 0;
    this.deaths = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.deadTime = 0;
    this.deathYaw = 0;
    this.lastDamageFrom = null;
    this.weaponModel = null;
    this.weaponId = null;
    this.muzzle = new THREE.Object3D();
    this.object.add(this.muzzle);
    this.recoilKick = 0;
  }

  setWeaponModel(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.weaponModel) {
      // geometry is shared via the caches — detach only, never dispose
      this.rig.weaponMount.remove(this.weaponModel);
    }
    const vm = buildViewModel(id);
    // strip the first-person hands and shrink into world scale
    vm.scale.setScalar(0.85);
    vm.position.set(0, 0, -0.18);
    vm.rotation.set(0, 0, 0);
    vm.traverse(o => { if (o.isMesh) { o.castShadow = true; o.renderOrder = 0; o.frustumCulled = true; } });
    this.rig.weaponMount.add(vm);
    this.weaponModel = vm;
    this.muzzleLocal = vm.userData.muzzle;
  }

  get eyeHeight() { return (1.62 - this.crouch * 0.48); }

  eyePos(out) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  /** Where this character's shots come from in world space. */
  muzzleWorld(out) {
    if (this.muzzleLocal) {
      this.muzzleLocal.getWorldPosition(out);
      return out;
    }
    return this.eyePos(out);
  }

  spawn(x, y, z, yaw) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = 100;
    this.armor = 100;
    this.alive = true;
    this.crouch = 0;
    this.deadTime = 0;
    this.object.visible = true;
    this.object.rotation.set(0, yaw, 0);
    this.object.position.copy(this.pos);
  }

  kill() {
    this.alive = false;
    this.deaths++;
    this.deadTime = 0;
    this.deathYaw = this.yaw;
  }

  /**
   * Ray against this character's hitboxes.
   * @returns {{dist:number, zone:string, mult:string, point:THREE.Vector3}|null}
   */
  hitTest(origin, dir, maxDist) {
    if (!this.alive) return null;
    // quick reject against a bounding cylinder
    const dx = this.pos.x - origin.x, dz = this.pos.z - origin.z, dy = this.pos.y + 0.9 - origin.y;
    const along = dx * dir.x + dy * dir.y + dz * dir.z;
    if (along < -1.2 || along > maxDist + 1.2) return null;
    const px = origin.x + dir.x * along - this.pos.x;
    const py = origin.y + dir.y * along - (this.pos.y + 0.9);
    const pz = origin.z + dir.z * along - this.pos.z;
    if (px * px + py * py + pz * pz > 1.7 * 1.7) return null;

    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    // ray into character-local space (yaw only)
    const ox = (origin.x - this.pos.x) * c - (origin.z - this.pos.z) * s;
    const oz = (origin.x - this.pos.x) * s + (origin.z - this.pos.z) * c;
    const oy = origin.y - this.pos.y;
    const ddx = dir.x * c - dir.z * s;
    const ddz = dir.x * s + dir.z * c;
    const ddy = dir.y;
    const squash = 1 - this.crouch * 0.30;

    let best = maxDist, bestBox = null;
    for (const hb of HITBOXES) {
      const cy = hb.y * squash;
      let tmin = 0, tmax = best;
      let ok = true;
      const test = (o, d, h) => {
        if (Math.abs(d) < 1e-8) return Math.abs(o) <= h;
        let t1 = (-h - o) / d, t2 = (h - o) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        return tmin <= tmax;
      };
      ok = test(ox, ddx, hb.hx) && test(oy - cy, ddy, hb.hy * squash) && test(oz, ddz, hb.hz);
      if (ok && tmin >= 0 && tmin < best) { best = tmin; bestBox = hb; }
    }
    if (!bestBox) return null;
    return {
      dist: best, zone: bestBox.zone, mult: bestBox.mult,
      point: new THREE.Vector3(origin.x + dir.x * best, origin.y + dir.y * best, origin.z + dir.z * best),
    };
  }

  /** Drive the animation rig. */
  animate(dt, time) {
    const r = this.rig;
    if (!this.alive) {
      // collapse: fold forward and sink, then hold as a body
      this.deadTime += dt;
      const t = Math.min(1, this.deadTime / 0.65);
      const e = 1 - Math.pow(1 - t, 3);
      this.object.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.object.rotation.set(-e * Math.PI * 0.46, this.deathYaw, e * 0.22);
      this.object.position.y = this.pos.y + e * 0.12;
      r.hips.position.y = 0.92 - e * 0.30;
      r.torso.rotation.x = e * 0.5;
      r.neck.rotation.x = -e * 0.5;
      r.arms.l.up.rotation.set(e * 1.3, 0, -e * 0.9);
      r.arms.r.up.rotation.set(e * 1.1, 0, e * 0.7);
      r.legs.l.up.rotation.x = -e * 0.5;
      r.legs.r.up.rotation.x = -e * 0.2;
      r.legs.l.lo.rotation.x = e * 0.9;
      r.legs.r.lo.rotation.x = e * 1.2;
      if (this.weaponModel) this.weaponModel.visible = t < 0.35;
      return;
    }
    if (this.weaponModel) this.weaponModel.visible = true;

    this.object.position.copy(this.pos);
    this.object.rotation.set(0, this.yaw, 0);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.speed = speed;
    const stride = speed > 0.4 ? Math.min(2.4, speed * 0.42) : 0;
    this.walkPhase += dt * (4.0 + speed * 1.05);
    const p = this.walkPhase;
    const crouchDrop = this.crouch * 0.42;

    r.hips.position.y = 0.92 - crouchDrop + Math.sin(p * 2) * 0.022 * stride;
    r.hips.rotation.z = Math.sin(p) * 0.045 * stride;
    r.hips.rotation.y = -Math.sin(p) * 0.10 * stride;

    // legs
    const lift = this.crouch * 0.55;
    r.legs.l.up.rotation.x = Math.sin(p) * 0.62 * stride - lift;
    r.legs.r.up.rotation.x = -Math.sin(p) * 0.62 * stride - lift;
    r.legs.l.lo.rotation.x = Math.max(0, -Math.sin(p - 0.7)) * 0.85 * stride + lift * 1.9;
    r.legs.r.lo.rotation.x = Math.max(0, Math.sin(p - 0.7)) * 0.85 * stride + lift * 1.9;

    // torso leans into the run and turns toward the aim
    r.torso.rotation.x = 0.06 + Math.min(0.22, speed * 0.028) + this.crouch * 0.24;
    r.torso.rotation.y = Math.sin(p) * 0.07 * stride;
    r.neck.rotation.x = -this.pitch * 0.55 - r.torso.rotation.x;
    r.neck.rotation.y = Math.sin(p) * -0.05 * stride;

    // weapon points exactly where the character is aiming
    const kick = this.recoilKick;
    this.recoilKick = Math.max(0, this.recoilKick - dt * 7);
    r.weaponMount.rotation.set(-this.pitch - r.torso.rotation.x + kick * 0.35, 0, 0);
    r.weaponMount.position.z = -0.20 - kick * 0.05;

    // Arms reach the weapon with two-bone IK rather than a canned pose, so the
    // hands stay on the grip and handguard through aim, recoil and lean.
    if (this.weaponModel) {
      const vm = this.weaponModel;
      solveArm(r.arms.r, r.torso, vm.userData.grip, UPPER_ARM, LOWER_ARM, 1);
      solveArm(r.arms.l, r.torso, vm.userData.fore, UPPER_ARM, LOWER_ARM, -1);
    }
    // subtle arm sway while sprinting with the weapon lowered
    if (speed > 5.4) {
      const s = Math.sin(p) * 0.16;
      r.arms.r.up.rotation.x += -0.35 + s;
      r.arms.l.up.rotation.x += -0.35 - s;
      r.arms.r.up.rotation.y += 0.15;
    }
  }

  /** Detach from the scene. Geometry and materials are shared, so nothing is
   *  disposed here — see boxGeo(). */
  dispose(scene) {
    scene.remove(this.object);
    this.object.clear();
    this.weaponModel = null;
    this.muzzleLocal = null;
  }
}
