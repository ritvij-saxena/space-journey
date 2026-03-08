/**
 * Particle Renderer
 *
 * High-performance particle system for Unsupervised-like fluid visuals.
 * Uses WASM for particle position computation, GPU for rendering.
 */

import * as THREE from "three";

const PARTICLE_COUNT = 5000;  // Must match CONFIG.particleCount in main.js

// Vertex shader for particles
const vertexShader = `
  attribute float size;
  attribute vec3 customColor;

  varying vec3 vColor;
  varying float vSize;
  varying float vDepth;

  uniform float uTime;
  uniform float uPixelRatio;

  void main() {
    vColor = customColor;
    vSize = size;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mvPosition.z;
    gl_PointSize = size * uPixelRatio * (160.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Fragment shader for soft, glowing particles
const fragmentShader = `
  varying vec3 vColor;
  varying float vSize;
  varying float vDepth;

  uniform float uTime;

  void main() {
    // Soft circular particle with glow
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    // Soft falloff
    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
    alpha *= alpha; // Softer edges

    // Depth fade: distant particles appear dimmer
    float depthFade = 1.0 - smoothstep(1.5, 6.0, vDepth);
    alpha *= mix(0.35, 1.0, depthFade);

    // Subtle glow that doesn't wash out color
    float glow = exp(-dist * 6.0) * 0.2;

    vec3 col = vColor + vColor * glow;

    if (alpha < 0.005) discard;

    gl_FragColor = vec4(col, alpha * 0.07);
  }
`;

export class ParticleRenderer {
  constructor(camera, artTexture) {
    this.camera = camera;
    this.artTexture = artTexture;
    this.particles = null;
    this.geometry = null;
    this.material = null;
    this.mesh = null;
    this.particleCount = PARTICLE_COUNT;

    this.init();
  }

  init() {
    this.geometry = new THREE.BufferGeometry();

    // Initialize arrays
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);
    const sizes = new Float32Array(this.particleCount);

    // Initial random positions
    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.2 + Math.random() * 0.5;

      positions[i3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = r * Math.cos(phi);

      colors[i3] = 0.5 + Math.random() * 0.5;
      colors[i3 + 1] = 0.3 + Math.random() * 0.4;
      colors[i3 + 2] = 0.4 + Math.random() * 0.5;

      sizes[i] = 2 + Math.random() * 2;
    }

    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', posAttr);

    const colAttr = new THREE.BufferAttribute(colors, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('customColor', colAttr);

    const sizeAttr = new THREE.BufferAttribute(sizes, 1);
    sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('size', sizeAttr);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
  }

  /**
   * Rewire BufferGeometry attributes to use WASM memory views directly.
   * Call this once after WasmParticleSystem is created and WasmMemoryBridge is available.
   *
   * @param {WasmMemoryBridge} wasmBridge - Bridge providing getPositions() / getColors()
   * @param {number} particleCount - Number of particles to render
   */
  initFromWasmBridge(wasmBridge, particleCount) {
    this.wasmBridge = wasmBridge;
    this.particleCount = particleCount;

    // Get initial views (will be refreshed each frame)
    const posView = wasmBridge.getPositions();
    const colView = wasmBridge.getColors();

    // Separate size array — constant 0.015 per particle, scaled in vertex shader
    const sizeArray = new Float32Array(particleCount).fill(0.015);

    // Replace geometry attributes with WASM-backed views + DynamicDrawUsage
    const posAttr = new THREE.BufferAttribute(posView, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', posAttr);

    const colAttr = new THREE.BufferAttribute(colView, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('customColor', colAttr);

    const sizeAttr = new THREE.BufferAttribute(sizeArray, 1);
    sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('size', sizeAttr);

    // Set initial draw range
    this.geometry.setDrawRange(0, particleCount);
  }

  /**
   * Update particle data from WASM memory bridge.
   * Called every frame. Re-wraps typed array views to handle WASM memory growth.
   * No data is copied — GPU reads directly from WASM linear memory.
   *
   * @param {boolean} colorsChanged - Whether to upload color buffer (gate to morph transitions)
   */
  updateFromWasmBridge(colorsChanged = true) {
    if (!this.wasmBridge) return;

    // Re-wrap each frame in case WASM memory grew (buffer reference may have changed)
    this.geometry.attributes.position.array = this.wasmBridge.getPositions();
    this.geometry.attributes.position.needsUpdate = true;

    // Only upload colors when they actually changed (morph transitions)
    if (colorsChanged) {
      this.geometry.attributes.customColor.array = this.wasmBridge.getColors();
      this.geometry.attributes.customColor.needsUpdate = true;
    }

    // Sizes are constant — never re-upload unless explicitly changed
  }

  /**
   * Update particle positions from WASM-generated data
   * @param {Float32Array} wasmData - Particle data [x, y, z, size, ...]
   * @param {number} time - Current time for color animation
   * @param {Float32Array} [wasmColors] - Optional per-particle colors [r,g,b,...] from WASM
   */
  updateFromWasm(wasmData, time, wasmColors) {
    if (!wasmData || wasmData.length === 0) return;

    const positions = this.geometry.attributes.position.array;
    const colors = this.geometry.attributes.customColor.array;
    const sizes = this.geometry.attributes.size.array;

    const count = Math.min(this.particleCount, wasmData.length / 4);

    for (let i = 0; i < count; i++) {
      const i4 = i * 4;
      const i3 = i * 3;

      // Position from WASM
      positions[i3] = wasmData[i4];
      positions[i3 + 1] = wasmData[i4 + 1];
      positions[i3 + 2] = wasmData[i4 + 2];

      // Size from WASM — tuned for 5000-particle AdditiveBlending density
      // *80 → ~150px particles, ~180 overlaps/px → white saturation
      // *8  → ~15px particles, ~2 overlaps/px → visible as individual flies
      // *20 → ~37px particles, ~12 overlaps/px → soft cloud with visible colors
      sizes[i] = wasmData[i4 + 3] * 20;
    }

    // Use WASM art colors if provided, otherwise keep existing colors
    if (wasmColors && wasmColors.length >= count * 3) {
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        colors[i3] = wasmColors[i3];
        colors[i3 + 1] = wasmColors[i3 + 1];
        colors[i3 + 2] = wasmColors[i3 + 2];
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.customColor.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }

  /**
   * Sample color from art texture atlas
   */
  sampleArtColor(x, y, z, time) {
    if (!this.artTexture || !this.artTexture.image) {
      return { r: 0.6, g: 0.4, b: 0.5 };
    }

    const img = this.artTexture.image;
    const canvas = this._getCanvas();
    const ctx = canvas.getContext('2d');

    if (!this._textureDrawn) {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      this._imageData = ctx.getImageData(0, 0, img.width, img.height);
      this._textureDrawn = true;
    }

    // Map 3D position to 2D UV with flowing animation
    const flowX = Math.sin(time * 0.1 + z * 0.5) * 0.1;
    const flowY = Math.cos(time * 0.08 + x * 0.5) * 0.1;

    let u = ((x * 0.2 + 0.5 + flowX) % 1 + 1) % 1;
    let v = ((y * 0.2 + 0.5 + flowY) % 1 + 1) % 1;

    // Select slice based on z and time
    const sliceFloat = (((z * 0.15 + time * 0.02) % 1) + 1) % 1 * 15.99;
    const slice = Math.floor(sliceFloat);

    // Atlas is 4x4 grid
    const sliceX = slice % 4;
    const sliceY = Math.floor(slice / 4);

    const finalU = (sliceX + u) / 4;
    const finalV = (sliceY + v) / 4;

    const px = Math.floor(finalU * img.width) % img.width;
    const py = Math.floor(finalV * img.height) % img.height;
    const idx = (py * img.width + px) * 4;

    const data = this._imageData.data;
    return {
      r: data[idx] / 255,
      g: data[idx + 1] / 255,
      b: data[idx + 2] / 255,
    };
  }

  _getCanvas() {
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
    }
    return this._canvas;
  }

  /**
   * Fallback update without WASM (JS-based animation)
   */
  updateFallback(time) {
    const positions = this.geometry.attributes.position.array;
    const colors = this.geometry.attributes.customColor.array;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;
      const ratio = i / this.particleCount;

      // Animated spherical position
      const theta = ratio * Math.PI * 2 * 13 + time * 0.05;
      const phi = Math.acos(1 - 2 * ratio);
      const r = 1.2 + Math.sin(time * 0.2 + ratio * 10) * 0.3;

      // Add noise-like displacement
      const noiseX = Math.sin(time * 0.3 + i * 0.01) * 0.4;
      const noiseY = Math.cos(time * 0.25 + i * 0.015) * 0.4;
      const noiseZ = Math.sin(time * 0.35 + i * 0.02) * 0.4;

      positions[i3] = r * Math.sin(phi) * Math.cos(theta) + noiseX;
      positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta) + noiseY;
      positions[i3 + 2] = r * Math.cos(phi) + noiseZ;

      // Animate colors
      if (this.artTexture && this.artTexture.image) {
        const color = this.sampleArtColor(
          positions[i3],
          positions[i3 + 1],
          positions[i3 + 2],
          time
        );
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.customColor.needsUpdate = true;
  }

  update(time) {
    this.material.uniforms.uTime.value = time;

    // Very slow drift — keeps 3D depth perceptible without destroying art shapes
    this.mesh.rotation.y = Math.sin(time * 0.04) * 0.12;
    this.mesh.rotation.x = Math.sin(time * 0.03) * 0.06;
  }

  getMesh() {
    return this.mesh;
  }

  setArtTexture(texture) {
    this.artTexture = texture;
    this._textureDrawn = false;
  }

  onResize() {
    this.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
  }

  dispose() {
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
  }
}
