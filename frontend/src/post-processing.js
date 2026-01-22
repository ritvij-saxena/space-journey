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

export class PostProcessor {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.bloomPass = null;
    this.chromaticPass = null;

    this.init();
  }

  init() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Create effect composer
    this.composer = new EffectComposer(this.renderer);

    // Render pass (base scene)
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Bloom pass - subtle glow
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.8, // strength
      0.5, // radius
      0.6  // threshold
    );
    this.composer.addPass(this.bloomPass);

    // Chromatic aberration pass for dreamy effect - boosted
    this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
    this.chromaticPass.uniforms.uIntensity.value = 0.006;
    this.chromaticPass.uniforms.uRadialFalloff.value = 1.5;
    this.composer.addPass(this.chromaticPass);
  }

  /**
   * Update bloom parameters based on visual state
   * @param {Object} params - Visual parameters
   */
  updateParams(params = {}) {
    const { intensity = 0.5, warmth = 0.5 } = params;

    // Adjust bloom based on activity - stronger range
    if (this.bloomPass) {
      this.bloomPass.strength = 1.8 + intensity * 0.6;
      this.bloomPass.radius = 0.5 + warmth * 0.3;
    }

    // More visible chromatic aberration
    if (this.chromaticPass) {
      this.chromaticPass.uniforms.uIntensity.value = 0.004 + intensity * 0.004;
    }
  }

  /**
   * Handle window resize
   */
  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.composer.setSize(width, height);

    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
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
}
