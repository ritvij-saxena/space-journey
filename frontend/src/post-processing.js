/**
 * Post Processing
 *
 * Manages bloom and chromatic aberration effects using Three.js EffectComposer
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { ChromaticAberrationShader } from "./shaders/chromatic-aberration.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ─── Gravitational lensing shader ─────────────────────────────────────────────
// Screen-space Schwarzschild lensing: distorts UVs near black hole projections.
// up to 4 simultaneous black holes via uBH0..uBH3 (vec4: screenUV.xy, depth.z, screenRadius.w)
const GravLensShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uBH0:        { value: new THREE.Vector4(0.5, 0.5, -1.0, 0.0) },
    uBH1:        { value: new THREE.Vector4(0.5, 0.5, -1.0, 0.0) },
    uBH2:        { value: new THREE.Vector4(0.5, 0.5, -1.0, 0.0) },
    uBH3:        { value: new THREE.Vector4(0.5, 0.5, -1.0, 0.0) },
    uBHCount:    { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec4  uBH0, uBH1, uBH2, uBH3;
    uniform int   uBHCount;
    uniform vec2  uResolution;
    varying vec2  vUv;

    // Returns UV offset (toward BH center) for a single black hole
    vec2 bhLens(vec2 uv, vec4 bh) {
      if (bh.z <= 0.0) return vec2(0.0);        // behind camera
      vec2  aspect  = vec2(uResolution.x / uResolution.y, 1.0);
      vec2  delta   = (uv - bh.xy) * aspect;     // aspect-correct direction
      float dist2   = dot(delta, delta);
      float rs      = bh.w;                       // Einstein radius in screen-UV units

      // Schwarzschild: deflection ∝ rs² / dist   (capped to avoid singularity)
      float defl = (rs * rs) / (dist2 + rs * 0.40);
      defl = min(defl, 0.14);

      // Einstein ring amplification band at dist ≈ 2.0 * rs
      float ringR   = rs * 2.0;
      float ringDist = sqrt(dist2);
      float ring    = exp(-pow((ringDist / max(ringR, 0.001) - 1.0) * 7.0, 2.0)) * rs * 0.55;
      defl += ring;

      // Deflect TOWARD the BH (negative = inward)
      return normalize(delta) * (-defl) / aspect;
    }

    void main(){
      if (uBHCount == 0){ gl_FragColor = texture2D(tDiffuse, vUv); return; }

      vec2 offset = vec2(0.0);
      if (uBHCount > 0) offset += bhLens(vUv, uBH0);
      if (uBHCount > 1) offset += bhLens(vUv, uBH1);
      if (uBHCount > 2) offset += bhLens(vUv, uBH2);
      if (uBHCount > 3) offset += bhLens(vUv, uBH3);

      vec2 lensed = clamp(vUv + offset, 0.001, 0.999);
      gl_FragColor = texture2D(tDiffuse, lensed);
    }
  `,
};

export class PostProcessor {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.bloomPass = null;
    this.chromaticPass = null;
    this.afterimagePass = null;
    this.outputPass = null;

    this.init();
  }

  init() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    // Pass 1: Render the 3D scene
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Pass 2: Gravitational lensing (distort scene around black holes)
    this.lensingPass = new ShaderPass(GravLensShader);
    this.lensingPass.uniforms.uResolution.value.set(width, height);
    this.composer.addPass(this.lensingPass);

    // Pass 3: Afterimage trails — disabled by default, enabled only on tier 3
    this.afterimagePass = new AfterimagePass(0.88);
    this.afterimagePass.enabled = false;
    this.composer.addPass(this.afterimagePass);

    // Pass 4: Bloom at half resolution — UnrealBloomPass does 5+ internal passes
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width * 0.5, height * 0.5),
      0.6,   // strength
      0.75,  // radius
      0.45   // threshold
    );
    this.composer.addPass(this.bloomPass);

    // Pass 5: Chromatic aberration — disabled by default, enabled only on tier 2+
    this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
    this.chromaticPass.uniforms.uIntensity.value = 0.006;
    this.chromaticPass.uniforms.uRadialFalloff.value = 1.5;
    this.chromaticPass.enabled = false;
    this.composer.addPass(this.chromaticPass);

    // Pass 6: REQUIRED — sRGB color space conversion (Three.js r152+ requirement)
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  /**
   * Update bloom parameters based on visual state
   * @param {Object} params - Visual parameters
   */
  updateParams(params = {}) {
    const { intensity = 0.5, warmth = 0.5 } = params;

    if (this.bloomPass) {
      this.bloomPass.strength = 0.2 + intensity * 0.15;
      this.bloomPass.radius = 0.1 + warmth * 0.1;
    }

    if (this.chromaticPass) {
      this.chromaticPass.uniforms.uIntensity.value = 0.003 + intensity * 0.003;
    }
  }

  /**
   * Handle window resize
   */
  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.composer.setSize(width, height);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    if (this.lensingPass) {
      this.lensingPass.uniforms.uResolution.value.set(width, height);
    }

    if (this.bloomPass) {
      this.bloomPass.resolution.set(width * 0.5, height * 0.5);
    }
  }

  /**
   * Update gravitational lensing pass with current black hole screen positions.
   * @param {Array<{screenPos: THREE.Vector2, depth: number, screenRadius: number}>} bhList
   */
  updateLensing(bhList) {
    if (!this.lensingPass) return;
    const u = this.lensingPass.uniforms;
    const slots = [u.uBH0, u.uBH1, u.uBH2, u.uBH3];
    let count = 0;
    for (let i = 0; i < Math.min(bhList.length, 4); i++) {
      const bh = bhList[i];
      if (bh.depth > 1.0) continue; // behind camera
      slots[count].value.set(bh.screenPos.x, bh.screenPos.y, bh.depth, bh.screenRadius);
      count++;
    }
    // Zero out unused slots
    for (let i = count; i < 4; i++) slots[i].value.set(0.5, 0.5, -1.0, 0.0);
    u.uBHCount.value = count;
  }

  /**
   * Render the post-processed frame
   */
  render() {
    this.composer.render();
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.composer) {
      this.composer.dispose();
    }
  }

  /**
   * Scale post-processing quality to GPU capability.
   * tier 0: minimal (no trails, no CA, quarter-res bloom)
   * tier 1: reduced (short trails, no CA, third-res bloom)
   * tier 2+: full quality
   */
  setQualityTier(tier) {
    // Defaults (set in init): afterimage OFF, chromatic OFF, bloom at 0.25x, composer at 1.0x
    if (tier <= 1) {
      // Disable grav lensing too (passthrough draw call not free on low-end)
      if (this.lensingPass) this.lensingPass.enabled = false;
      if (this.bloomPass)   this.bloomPass.strength = 0.5;
    }
    // chromatic aberration disabled for all tiers — full-screen pass cost not worth it
  }

  /**
   * Get bloom pass for external adjustments
   * @returns {UnrealBloomPass}
   */
  getBloomPass() {
    return this.bloomPass;
  }

  /**
   * Set bloom strength directly
   * @param {number} strength - Bloom strength (0-3)
   */
  setBloomStrength(strength) {
    if (this.bloomPass) {
      this.bloomPass.strength = strength;
    }
  }

  /**
   * Set chromatic aberration intensity
   * @param {number} intensity - Aberration intensity (0-0.01)
   */
  setChromaticIntensity(intensity) {
    if (this.chromaticPass) {
      this.chromaticPass.uniforms.uIntensity.value = intensity;
    }
  }

  /**
   * Set afterimage trail persistence
   * @param {number} damp - Trail damp factor (0.0=no trail, 0.98=very long trail)
   */
  setTrailDamp(damp) {
    if (this.afterimagePass) {
      this.afterimagePass.uniforms['damp'].value = Math.max(0, Math.min(0.98, damp));
    }
  }

  /**
   * Get current trail damp value
   * @returns {number}
   */
  getTrailDamp() {
    if (this.afterimagePass) {
      return this.afterimagePass.uniforms['damp'].value;
    }
    return 0;
  }
}
