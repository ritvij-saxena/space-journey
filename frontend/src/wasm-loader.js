/**
 * WASM Loader
 *
 * Handles loading and initialization of the Rust/WASM noise field system.
 */

let wasmModule = null;
let noiseField = null;

/**
 * Initialize the WASM module
 */
export async function initWasm() {
  if (wasmModule) return wasmModule;

  try {
    const wasm = await import("unsupervised-wasm/unsupervised_wasm.js");
    await wasm.default();
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
