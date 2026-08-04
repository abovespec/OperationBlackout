// Post-processing pipeline.
//
// Order matters here:
//   world  -> GTAO (needs world depth/normals only)
//          -> view model (drawn after AO so the gun is not self-occluded,
//             with depth cleared so it never intersects the level)
//          -> bloom      (both world and gun should glow)
//          -> output     (tone map + colour space; must be last)
//   -> SMAA (needs sRGB input, so it follows OutputPass)
//
// Tone mapping is left on the renderer: three skips it in materials when
// drawing into a render target and OutputPass applies it once at the end.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Filmic grade: lift/gamma/gain, slight desaturation of shadows, vignette. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.34 },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.05 },
    uLift: { value: new THREE.Vector3(0.008, 0.010, 0.018) },
    uGain: { value: new THREE.Vector3(1.02, 1.0, 0.965) },
    uGrain: { value: 0.006 },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSaturation, uContrast, uGrain, uTime;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      // lift / gain: cool the shadows, warm the highlights
      c = c * uGain + uLift * (1.0 - c);

      // contrast about mid grey
      c = (c - 0.5) * uContrast + 0.5;

      // saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);

      // vignette
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.4;
      c *= clamp(v, 0.0, 1.0);

      // A fixed dither to break up banding on flat gradients.
      //
      // Deliberately NOT animated: re-seeding the noise every frame is
      // full-screen static, and on a large evenly-lit floor that reads as the
      // surface crawling. A static pattern kills banding just as well and is
      // completely stable when you stand still.
      float n = fract(sin(dot(vUv * 1024.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * uGrain;

      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class Pipeline {
  constructor(renderer, scene, camera, vmScene, vmCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.vmScene = vmScene;
    this.vmCamera = vmCamera;
    this.enabled = true;
    this.quality = 2;
    this.time = 0;
    this._build();
  }

  _build() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const dpr = r.getPixelRatio();
    const w = Math.max(2, Math.floor(size.x * dpr));
    const h = Math.max(2, Math.floor(size.y * dpr));

    // A plain WebGLRenderTarget gets a 16-bit depth renderbuffer, which is not
    // enough range for a 0.2..700 frustum and shows up as z-fighting on large
    // flat surfaces. Attach an explicit 24-bit depth texture instead.
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type);
    depth.format = THREE.DepthStencilFormat;
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,                       // MSAA inside the composer
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: true,
      depthTexture: depth,
    });
    this.composer = new EffectComposer(r, target);
    this.composer.setSize(size.x, size.y);
    this.composer.setPixelRatio(dpr);

    this.worldPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.worldPass);

    this.gtao = new GTAOPass(this.scene, this.camera, w, h);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.updateGtaoMaterial({
      radius: 0.55,
      distanceExponent: 1.6,
      thickness: 0.6,
      scale: 1.0,
      samples: 12,
      screenSpaceRadius: false,
    });
    // wide denoise: GTAO's per-pixel noise is otherwise a second source of
    // floor shimmer once the camera moves
    this.gtao.updatePdMaterial({ lumaPhi: 12, depthPhi: 3, normalPhi: 4, radius: 5, rings: 3, samples: 16 });
    this.composer.addPass(this.gtao);

    // the weapon: no clear of colour, but depth is wiped so it draws on top
    this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    this.composer.addPass(this.vmPass);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.7, 0.85);
    this.composer.addPass(this.bloom);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);

    this.applyQuality(this.quality);
  }

  applyQuality(q) {
    this.quality = q;
    // LOW draws straight to the screen and skips the composer entirely
    this.enabled = q >= 1;
    this.gtao.enabled = q >= 2;
    this.bloom.enabled = q >= 1;
    this.smaa.enabled = q >= 2;
    this.grade.enabled = q >= 1;
    if (q >= 3) {
      this.gtao.updateGtaoMaterial({ radius: 0.55, samples: 24, thickness: 0.75, distanceExponent: 1.5, scale: 0.9 });
      this.bloom.strength = 0.48;
    } else if (q >= 2) {
      this.gtao.updateGtaoMaterial({ radius: 0.5, samples: 16, thickness: 0.7, distanceExponent: 1.5, scale: 0.9 });
      this.bloom.strength = 0.42;
    } else {
      this.bloom.strength = 0.34;
    }
  }

  setSize(width, height) {
    const dpr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    this.gtao.setSize(width * dpr, height * dpr);
    this.bloom.setSize(width * dpr, height * dpr);
  }

  render(dt, drawWeapon) {
    this.time += dt;
    // uTime is kept for other effects; the dither deliberately does not use it
    this.grade.uniforms.uTime.value = this.time;
    this.vmPass.enabled = !!drawWeapon;

    if (!this.enabled) {
      // unprocessed path: world, then the weapon over a cleared depth buffer
      const r = this.renderer;
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
      if (drawWeapon) {
        r.autoClear = false;
        r.clearDepth();
        r.render(this.vmScene, this.vmCamera);
        r.autoClear = true;
      }
      return;
    }
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose?.();
  }
}
