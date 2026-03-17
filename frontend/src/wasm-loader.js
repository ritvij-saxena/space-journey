/**
 * WASM Loader
 *
 * Handles loading and initialization of the Rust/WASM noise field system.
 */

let wasmModule = null;      // JS namespace (for WasmParticleSystem, NoiseField classes)
let wasmInstance = null;    // instance.exports — has .memory for zero-copy buffer access
let noiseField = null;
let wasmBridge = null;

/**
 * WasmMemoryBridge
 *
 * Provides zero-copy Float32Array views directly into WASM linear memory.
 * Pointers are captured once (stable across frames). Views are reconstructed
 * each frame because wasmModule.memory.buffer is replaced on WASM memory growth.
 */
export class WasmMemoryBridge {
  constructor(wasmModule, wasmSystem) {
    this.wasmModule = wasmModule;
    this.wasmSystem = wasmSystem;

    // Capture pointer offsets — stable even if memory grows
    this.posPtr = wasmSystem.get_positions_ptr();
    this.posLen = wasmSystem.get_positions_len();
    this.colPtr = wasmSystem.get_colors_ptr();
    this.colLen = wasmSystem.get_colors_len();
  }

  /**
   * Return a Float32Array view of positions in WASM memory.
   * Called each frame to handle potential memory growth.
   * O(1) — no copy.
   */
  getPositions() {
    return new Float32Array(
      this.wasmModule.memory.buffer,
      this.posPtr,
      this.posLen
    );
  }

  /**
   * Return a Float32Array view of colors in WASM memory.
   * Called each frame to handle potential memory growth.
   * O(1) — no copy.
   */
  getColors() {
    return new Float32Array(
      this.wasmModule.memory.buffer,
      this.colPtr,
      this.colLen
    );
  }
}

/**
 * Create and return a WasmMemoryBridge for zero-copy position/color access.
 * Must be called after initWasm() and after WasmParticleSystem is constructed.
 */
export function createWasmBridge(wasmSystem) {
  if (!wasmInstance) throw new Error('WASM instance not initialized');
  wasmBridge = new WasmMemoryBridge(wasmInstance, wasmSystem);
  return wasmBridge;
}

/**
 * Get the current WasmMemoryBridge instance.
 */
export function getWasmBridge() {
  return wasmBridge;
}

/**
 * Initialize the WASM module
 */
export async function initWasm() {
  if (wasmModule) return wasmModule;

  try {
    const wasm = await import("space-journey-wasm/space_journey_wasm.js");
    wasmInstance = await wasm.default(); // instance.exports — has .memory for zero-copy access
    wasmModule = wasm;
    console.log("WASM module loaded successfully");
    return wasmModule;
  } catch (error) {
    console.error("Failed to load WASM module:", error);
    throw error;
  }
}

/**
 * Create the noise field generator
 */
export function createNoiseField(seed = Date.now()) {
  if (!wasmModule) {
    throw new Error("WASM module not initialized");
  }
  noiseField = new wasmModule.NoiseField(seed);
  console.log("NoiseField created");
  return noiseField;
}

/**
 * Update the noise field time
 */
export function updateNoiseField(dt) {
  if (!noiseField) return;
  noiseField.update(dt);
}

/**
 * Generate a noise atlas texture
 * @param {number} sliceSize - Size of each depth slice (e.g., 64)
 * @param {number} depthSlices - Number of depth slices (e.g., 16)
 * @returns {Object} { data: Float32Array, size: number, slices: number }
 */
export function generateNoiseAtlas(sliceSize = 64, depthSlices = 16) {
  if (!noiseField) {
    throw new Error("NoiseField not created");
  }

  const atlasSize = wasmModule.NoiseField.get_atlas_size(sliceSize, depthSlices);
  const data = noiseField.generate_noise_atlas(sliceSize, depthSlices);

  return {
    data: new Float32Array(data),
    size: atlasSize,
    slices: depthSlices,
  };
}

/**
 * Get visual parameters from weather
 */
export function getVisualParams(weather) {
  if (!noiseField) return null;

  const { temperature = 20, humidity = 50, windSpeed = 5 } = weather;
  const params = noiseField.weather_to_params(temperature, humidity, windSpeed);

  return {
    colorWarmth: params[0],
    glossiness: params[1],
    animSpeed: params[2],
    threshold: params[3] - 0.3, // Center around 0
    noiseScale: params[4],
    subsurface: params[5],
  };
}

/**
 * Get the noise field instance
 */
export function getNoiseField() {
  return noiseField;
}

/**
 * Check if WASM is ready
 */
export function isWasmReady() {
  return wasmModule !== null && noiseField !== null;
}

/**
 * Get the raw WASM module for direct access to WasmParticleSystem
 */
export function getWasmModule() {
  return wasmModule;
}

/**
 * Generate particle positions using WASM
 * @param {number} count - Number of particles
 * @returns {Float32Array} Particle data [x, y, z, size, ...]
 */
export function generateParticles(count = 10000) {
  if (!noiseField) {
    throw new Error("NoiseField not created");
  }
  return new Float32Array(noiseField.generate_particles(count));
}
