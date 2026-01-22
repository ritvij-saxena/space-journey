/**
 * Raymarcher
 *
 * Three.js wrapper for the noise-field raymarching shader.
 * Supports both procedural noise (from WASM) and pre-generated SD textures.
 */

import * as THREE from "three";
import vertexShader from "./shaders/raymarcher.vert.glsl";
import fragmentShader from "./shaders/raymarcher.frag.glsl";

const DEFAULT_ATLAS_SIZE = 256;
const DEFAULT_SLICE_COUNT = 16; // 4x4 grid of slices

export class Raymarcher {
  constructor(camera) {
    this.camera = camera;
    this.mesh = null;
    this.material = null;
    this.noiseTexture = null;
    this.atlasSize = DEFAULT_ATLAS_SIZE;
    this.sliceCount = DEFAULT_SLICE_COUNT;
    this.useExternalTexture = false;

    this.init();
  }

  init() {
    // Create fullscreen quad
    const geometry = new THREE.PlaneGeometry(2, 2);

    // Create initial procedural noise texture
    this.createProceduralNoiseTexture();

    // Create shader material
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        // Core
        uTime: { value: 0 },
        uAspect: { value: window.innerWidth / window.innerHeight },
        uFov: { value: this.camera.fov * (Math.PI / 180) },
        uCameraPos: { value: this.camera.position.clone() },
        uCameraMatrix: { value: this.camera.matrixWorld.clone() },

        // Noise texture
        uNoiseTexture: { value: this.noiseTexture },
        uNoiseTextureSize: { value: this.atlasSize },
        uAtlasSlices: { value: this.sliceCount },

        // Visual parameters
        uColorWarmth: { value: 0.5 },
        uGlossiness: { value: 0.5 },
        uThreshold: { value: 0.0 },
        uNoiseScale: { value: 0.6 },
        uSubsurface: { value: 0.3 },
        uAnimSpeed: { value: 1.0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  /**
   * Create procedural noise texture (fallback when no SD textures)
   */
  createProceduralNoiseTexture() {
    const size = this.atlasSize;
    const data = new Float32Array(size * size * 4);

    // Generate multi-octave noise
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Simple procedural noise (will be replaced by WASM or SD textures)
        const nx = x / size;
        const ny = y / size;

        const n1 = this.simplexNoise2D(nx * 4, ny * 4);
        const n2 = this.simplexNoise2D(nx * 8 + 100, ny * 8);
        const n3 = this.simplexNoise2D(nx * 2, ny * 2 + 100);

        data[idx] = (n1 + 1) * 0.5;
        data[idx + 1] = (n2 + 1) * 0.5;
        data[idx + 2] = (n3 + 1) * 0.5;
        data[idx + 3] = (n1 + 1) * 0.5;
      }
    }

    this.noiseTexture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.noiseTexture.wrapS = THREE.RepeatWrapping;
    this.noiseTexture.wrapT = THREE.RepeatWrapping;
    this.noiseTexture.minFilter = THREE.LinearFilter;
    this.noiseTexture.magFilter = THREE.LinearFilter;
    this.noiseTexture.needsUpdate = true;
  }

  /**
   * Simple 2D noise for fallback (replaced by WASM in production)
   */
  simplexNoise2D(x, y) {
    // Basic value noise
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const hash = (px, py) => {
      const n = Math.sin(px * 127.1 + py * 311.7) * 43758.5453;
      return (n - Math.floor(n)) * 2 - 1;
    };

    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);

    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  /**
   * Update noise texture from WASM-generated data
   * @param {Float32Array} noiseData - RGBA noise atlas data
   * @param {number} size - Atlas size
   * @param {number} slices - Number of depth slices
   */
  updateNoiseFromWasm(noiseData, size, slices) {
    if (!noiseData || noiseData.length === 0) return;

    this.atlasSize = size;
    this.sliceCount = slices;

    if (this.noiseTexture) {
      this.noiseTexture.dispose();
    }

    this.noiseTexture = new THREE.DataTexture(
      noiseData,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.noiseTexture.wrapS = THREE.RepeatWrapping;
    this.noiseTexture.wrapT = THREE.RepeatWrapping;
    this.noiseTexture.minFilter = THREE.LinearFilter;
    this.noiseTexture.magFilter = THREE.LinearFilter;
    this.noiseTexture.needsUpdate = true;

    this.material.uniforms.uNoiseTexture.value = this.noiseTexture;
    this.material.uniforms.uNoiseTextureSize.value = size;
    this.material.uniforms.uAtlasSlices.value = slices;
  }

  /**
   * Load pre-generated SD texture atlas
   * @param {string} url - URL to the texture image
   * @param {number} slices - Number of depth slices in the atlas
   */
  async loadSDTexture(url, slices = 16) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;

          if (this.noiseTexture) {
            this.noiseTexture.dispose();
          }

          this.noiseTexture = texture;
          this.atlasSize = texture.image.width;
          this.sliceCount = slices;
          this.useExternalTexture = true;

          this.material.uniforms.uNoiseTexture.value = texture;
          this.material.uniforms.uNoiseTextureSize.value = texture.image.width;
          this.material.uniforms.uAtlasSlices.value = slices;

          console.log(`Loaded SD texture: ${texture.image.width}x${texture.image.height}, ${slices} slices`);
          resolve(texture);
        },
        undefined,
        (error) => {
          console.error("Failed to load SD texture:", error);
          reject(error);
        }
      );
    });
  }

  /**
   * Update visual parameters from weather data
   * @param {Object} params - Visual parameters
   */
  updateVisualParams(params) {
    if (!params) return;

    const uniforms = this.material.uniforms;

    if (params.colorWarmth !== undefined) uniforms.uColorWarmth.value = params.colorWarmth;
    if (params.glossiness !== undefined) uniforms.uGlossiness.value = params.glossiness;
    if (params.threshold !== undefined) uniforms.uThreshold.value = params.threshold;
    if (params.noiseScale !== undefined) uniforms.uNoiseScale.value = params.noiseScale;
    if (params.subsurface !== undefined) uniforms.uSubsurface.value = params.subsurface;
    if (params.animSpeed !== undefined) uniforms.uAnimSpeed.value = params.animSpeed;
  }

  /**
   * Update every frame
   * @param {number} time - Total elapsed time
   */
  update(time) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
    this.material.uniforms.uCameraPos.value.copy(this.camera.position);
    this.material.uniforms.uCameraMatrix.value.copy(this.camera.matrixWorld);
    this.material.uniforms.uFov.value = this.camera.fov * (Math.PI / 180);
  }

  /**
   * Handle window resize
   */
  onResize() {
    this.material.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
  }

  /**
   * Get the mesh for adding to scene
   */
  getMesh() {
    return this.mesh;
  }

  /**
   * Check if using external SD texture
   */
  isUsingSDTexture() {
    return this.useExternalTexture;
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.material) this.material.dispose();
    if (this.mesh?.geometry) this.mesh.geometry.dispose();
    if (this.noiseTexture) this.noiseTexture.dispose();
  }
}
