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
    // Cap render resolution to 1.5x DPR — full 2x/3x DPR adds ~78% GPU cost for imperceptible gain
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    // Pass 1: Render the 3D scene
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Pass 2: Afterimage trails BEFORE bloom (so trails also glow)
    this.afterimagePass = new AfterimagePass(0.82);
    this.composer.addPass(this.afterimagePass);

    // Pass 3: Bloom on accumulated trails + current frame
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width * 0.5, height * 0.5),
      0.6,   // strength — moderate glow on bright clusters
      0.4,   // radius — slightly wider halo
      0.5    // threshold — only bright clusters bloom, not every pixel
    );
    this.composer.addPass(this.bloomPass);

    // Pass 4: Chromatic aberration for dreamy aesthetic
    this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
    this.chromaticPass.uniforms.uIntensity.value = 0.006;
    this.chromaticPass.uniforms.uRadialFalloff.value = 1.5;
    this.composer.addPass(this.chromaticPass);

    // Pass 5: REQUIRED — sRGB color space conversion (Three.js r152+ requirement)
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
      this.bloomPass.strength = 0.3 + intensity * 0.2;
      this.bloomPass.radius = 0.2 + warmth * 0.2;
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

    if (this.bloomPass) {
      // Maintain half-resolution bloom on resize
      this.bloomPass.resolution.set(width * 0.5, height * 0.5);
    }
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
