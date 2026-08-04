// Procedural audio: every sound is synthesised from noise bursts and oscillators,
// spatialised with the WebAudio panner and pushed through a small convolution tail.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
  }

  /**
   * Voice budget. A busy firefight asks for ~70 WebAudio nodes a second across
   * a dozen shooters; past a point the extra voices are inaudible but still cost
   * an HRTF panner each. Distant, low-priority sounds are dropped instead.
   */
  _voice(priority = 1) {
    const now = this.ctx.currentTime;
    if (now !== this._voiceAt) { this._voiceAt = now; this._voices = 0; }
    const cap = priority >= 2 ? 24 : 14;
    if (this._voices >= cap) return false;
    this._voices++;
    return true;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // gentle limiter so a full-auto burst does not clip
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 9;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.18;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // outdoor reverb tail
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(1.7, 2.6);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.32;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    // pre-baked noise
    this.noise = this._noiseBuffer(2.0);
    this.listener = ctx.listener;
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = (ctx.sampleRate * seconds) | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = w * 0.85 + last * 3.2;
    }
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = (ctx.sampleRate * seconds) | 0;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // sparse early reflections then a smooth tail
        const early = (i < ctx.sampleRate * 0.09 && Math.random() > 0.985) ? 3 : 1;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * early;
      }
    }
    return buf;
  }

  /** Update the 3D listener from the camera each frame. */
  setListener(pos, forward, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.01);
      l.positionY.setTargetAtTime(pos.y, t, 0.01);
      l.positionZ.setTargetAtTime(pos.z, t, 0.01);
      l.forwardX.setTargetAtTime(forward.x, t, 0.01);
      l.forwardY.setTargetAtTime(forward.y, t, 0.01);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.01);
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  _panner(pos, refDist = 6, maxDist = 260) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.maxDistance = maxDist;
    p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  _out(node, pos, verbAmount = 0.45) {
    if (pos) {
      const p = this._panner(pos);
      node.connect(p);
      p.connect(this.master);
      if (verbAmount > 0) {
        const g = this.ctx.createGain();
        g.gain.value = verbAmount;
        p.connect(g); g.connect(this.verb);
      }
    } else {
      node.connect(this.master);
      if (verbAmount > 0) {
        const g = this.ctx.createGain();
        g.gain.value = verbAmount * 0.7;
        node.connect(g); g.connect(this.verb);
      }
    }
  }

  _noiseSrc(playbackRate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = playbackRate;
    s.start(this.ctx.currentTime, Math.random() * 1.5);
    return s;
  }

  /**
   * Gunshot: a bright transient crack + a filtered body thump + a mechanical click.
   * @param def weapon definition (uses def.sound)
   * @param pos world position, or null for the local player's own weapon
   * @param gain overall level
   */
  shoot(def, pos = null, gain = 1) {
    if (!this.enabled) return;
    this.init();
    if (!this._voice(pos ? 1 : 3)) return;   // our own weapon is never dropped
    const ctx = this.ctx, t = ctx.currentTime;
    const S = def.sound;
    const len = S.len;

    // --- crack (high band noise, very short)
    const n1 = this._noiseSrc(1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.7;
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0, t);
    g1.gain.linearRampToValueAtTime(0.55 * gain * S.punch, t + 0.001);
    g1.gain.exponentialRampToValueAtTime(0.0008, t + len * 0.55);
    n1.connect(bp); bp.connect(g1);
    this._out(g1, pos, 0.4);
    n1.stop(t + len + 0.05);

    // --- body (low-passed noise sweeping down)
    const n2 = this._noiseSrc(0.75);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(S.freq * 9, t);
    lp.frequency.exponentialRampToValueAtTime(S.freq * 1.6, t + len);
    lp.Q.value = 3.5;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.85 * gain * S.punch, t + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.0008, t + len);
    n2.connect(lp); lp.connect(g2);
    this._out(g2, pos, 0.75);
    n2.stop(t + len + 0.1);

    // --- sub thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(S.freq * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(S.freq * 0.45, t + len * 0.9);
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.55 * gain * S.punch, t);
    g3.gain.exponentialRampToValueAtTime(0.001, t + len * 1.1);
    o.connect(g3);
    this._out(g3, pos, 0.3);
    o.start(t); o.stop(t + len * 1.2 + 0.02);

    // --- action / bolt clack (local only, keeps distant fire clean)
    if (!pos) {
      const n3 = this._noiseSrc(1.8);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 3800;
      const g4 = ctx.createGain();
      g4.gain.setValueAtTime(0, t + 0.012);
      g4.gain.linearRampToValueAtTime(0.11 * gain, t + 0.016);
      g4.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
      n3.connect(hp); hp.connect(g4);
      this._out(g4, null, 0.1);
      n3.stop(t + 0.1);
    }
  }

  /** Supersonic snap of a round passing close by. */
  whizz(pos, close = 1) {
    if (!this.enabled) return;
    this.init();
    if (!this._voice(2)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSrc(1.4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.09);
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.20 * close, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.10);
    n.connect(bp); bp.connect(g);
    this._out(g, pos, 0.2);
    n.stop(t + 0.15);
  }

  impact(pos, surface = 'concrete') {
    if (!this.enabled) return;
    this.init();
    if (!this._voice(0)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const metal = surface === 'metal' || surface === 'corrugated';
    const n = this._noiseSrc(metal ? 1.6 : 1);
    const f = ctx.createBiquadFilter();
    f.type = metal ? 'bandpass' : 'lowpass';
    f.frequency.value = metal ? 2400 + Math.random() * 1800 : 900 + Math.random() * 700;
    f.Q.value = metal ? 6 : 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(metal ? 0.28 : 0.20, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, t + (metal ? 0.24 : 0.10));
    n.connect(f); f.connect(g);
    this._out(g, pos, 0.35);
    n.stop(t + 0.3);
  }

  flesh(pos) {
    if (!this.enabled) return;
    this.init();
    if (!this._voice(2)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSrc(0.55);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.34, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.13);
    n.connect(f); f.connect(g);
    this._out(g, pos, 0.2);
    n.stop(t + 0.2);
  }

  explosion(pos) {
    if (!this.enabled) return;
    this.init();
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSrc(0.55);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.35, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.3);
    n.connect(lp); lp.connect(g);
    this._out(g, pos, 1.0);
    n.stop(t + 1.5);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.85);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(1.1, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
    o.connect(g2);
    this._out(g2, pos, 0.4);
    o.start(t); o.stop(t + 1.0);
  }

  /** Short mechanical tick — reload steps, weapon swap, pin pull. */
  click(kind = 'mag', gain = 1) {
    if (!this.enabled) return;
    this.init();
    const ctx = this.ctx, t = ctx.currentTime;
    const cfg = {
      mag: [1400, 0.045, 0.22], bolt: [900, 0.07, 0.28], pin: [2600, 0.03, 0.2],
      dry: [3200, 0.035, 0.3], swap: [700, 0.06, 0.18], shell: [1900, 0.04, 0.2],
    }[kind] || [1400, 0.05, 0.2];
    const n = this._noiseSrc(1.5);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = cfg[0]; f.Q.value = 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(cfg[2] * gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0004, t + cfg[1]);
    n.connect(f); f.connect(g);
    this._out(g, null, 0.12);
    n.stop(t + cfg[1] + 0.05);
  }

  /**
   * Knife swing: a band of noise swept downward in pitch, which is what a
   * blade passing the ear actually sounds like. The heavy stab is lower,
   * longer and louder than the light slash.
   */
  swing(heavy = false) {
    if (!this.enabled) return;
    this.init();
    const ctx = this.ctx, t = ctx.currentTime;
    const len = heavy ? 0.26 : 0.16;
    const n = this._noiseSrc(heavy ? 0.8 : 1.15);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.6;
    f.frequency.setValueAtTime(heavy ? 1500 : 2300, t);
    f.frequency.exponentialRampToValueAtTime(heavy ? 260 : 430, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((heavy ? 0.26 : 0.19), t + len * 0.28);
    g.gain.exponentialRampToValueAtTime(0.0004, t + len);
    n.connect(f); f.connect(g);
    this._out(g, null, 0.14);
    n.stop(t + len + 0.05);
  }

  footstep(surface = 'concrete', gain = 1, pos = null) {
    if (!this.enabled) return;
    this.init();
    if (!this._voice(0)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSrc(surface === 'sand' ? 0.6 : 1.2);
    const f = ctx.createBiquadFilter();
    const soft = surface === 'sand' || surface === 'sandbag';
    f.type = soft ? 'lowpass' : 'bandpass';
    f.frequency.value = soft ? 700 : (surface === 'metal' ? 1800 : 950) * (0.85 + Math.random() * 0.3);
    f.Q.value = soft ? 1 : 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0004, t + (soft ? 0.13 : 0.09));
    n.connect(f); f.connect(g);
    this._out(g, pos, 0.15);
    n.stop(t + 0.2);
  }

  /** Hit confirmation blip for the local player. */
  hitmarker(kill = false) {
    if (!this.enabled) return;
    this.init();
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(kill ? 880 : 1500, t);
    if (kill) o.frequency.setValueAtTime(1320, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.10, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + (kill ? 0.14 : 0.045));
    o.connect(g);
    this._out(g, null, 0);
    o.start(t); o.stop(t + 0.2);
  }

  /** Player took damage — a dull thud plus a short ringing if it was heavy. */
  hurt(amount) {
    if (!this.enabled) return;
    this.init();
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.12 + amount * 0.008), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g);
    this._out(g, null, 0.1);
    o.start(t); o.stop(t + 0.3);
    if (amount > 35) {
      const r = ctx.createOscillator();
      r.type = 'sine'; r.frequency.value = 5200;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.05, t);
      rg.gain.exponentialRampToValueAtTime(0.0005, t + 2.4);
      r.connect(rg); rg.connect(this.master);
      r.start(t); r.stop(t + 2.5);
    }
  }

  ui(kind = 'tick') {
    if (!this.enabled) return;
    this.init();
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const f = { tick: 620, ok: 880, deploy: 300 }[kind] || 620;
    o.frequency.setValueAtTime(f, t);
    if (kind === 'deploy') o.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + (kind === 'deploy' ? 0.6 : 0.08));
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.7);
  }
}
