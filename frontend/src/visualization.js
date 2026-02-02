import * as THREE from "three";
import { WeatherService, detectUserLocation } from "./weatherService.js";

/**
 * VisualizationEngine integrates WASM particle physics with Three.js rendering.
 *
 * Architecture:
 * - WASM ParticleSystem handles all physics simulation
 * - Three.js BufferGeometry displays particle positions
 * - WeatherService feeds real-time weather to physics
 * - Morph controller cycles through art states continuously
 */
export class VisualizationEngine {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.particleGeometry = null;
    this.particleMaterial = null;
    this.particleSystem = null;
    this.wasmParticleSystem = null;
    this.weatherService = null;
    this.wasmModule = null;
  }

  /**
   * Initialize the visualization engine
   *
   * @param {Object} wasmModule - Loaded WASM module from rust-wasm/pkg
   * @param {Array<Object>} artStates - Array of art state data with positions
   */
  async init(wasmModule, artStates = []) {
    this.wasmModule = wasmModule;

    // Create WASM particle system
    const particleCount = 5000;
    const seed = 42;
    const numStates = Math.max(artStates.length, 1); // At least 1 state

    console.log(`Initializing ParticleSystem: ${particleCount} particles, ${numStates} states`);

    this.wasmParticleSystem = new wasmModule.WasmParticleSystem(
      particleCount,
      seed,
      numStates
    );

    // Load art states into WASM
    for (let i = 0; i < artStates.length; i++) {
      const state = artStates[i];
      if (state.positions && state.positions.length > 0) {
        this.wasmParticleSystem.load_art_state(i, state.positions);
        console.log(`Loaded art state ${i}: ${state.positions.length / 3} points`);
      }
    }

    // Create Three.js particle system
    this.createParticleSystem(particleCount);

    // Initialize weather service
    await this.initWeather();

    console.log("VisualizationEngine initialized");
  }

  /**
   * Create Three.js particle system for rendering
   */
  createParticleSystem(particleCount) {
    const geometry = new THREE.BufferGeometry();

    // Create position buffer (will be updated from WASM)
    const positions = new Float32Array(particleCount * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // Create color buffer (white for now, Phase 3 handles color mapping)
    const colors = new Float32Array(particleCount * 3);
    for (let i = 0; i < colors.length; i++) {
      colors[i] = 1.0; // White
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Create size buffer
    const sizes = new Float32Array(particleCount);
    for (let i = 0; i < sizes.length; i++) {
      sizes[i] = 0.02 + Math.random() * 0.03;
    }
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.015,
      sizeAttenuation: true,
      transparent: true,
      vertexColors: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particleSystem = new THREE.Points(geometry, material);
    this.scene.add(this.particleSystem);

    this.particleGeometry = geometry;
    this.particleMaterial = material;
  }

  /**
   * Initialize weather service and start periodic updates
   */
  async initWeather() {
    try {
      // Detect user location
      const location = await detectUserLocation();
      console.log(`Location detected: ${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`);

      // Create weather service
      this.weatherService = new WeatherService(location.latitude, location.longitude);

      // Start periodic updates (every 15 minutes)
      this.weatherService.startPeriodicUpdates((weatherData) => {
        if (this.wasmParticleSystem) {
          this.wasmParticleSystem.set_weather(
            weatherData.temperature,
            weatherData.humidity,
            weatherData.windSpeed,
            weatherData.windDirection
          );

          console.log("Weather applied to physics:", weatherData);
        }
      });
    } catch (error) {
      console.warn("Weather service initialization failed:", error);
    }
  }

  /**
   * Update particle system for one frame
   *
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    if (!this.wasmParticleSystem || !this.particleGeometry) {
      return;
    }

    // Update WASM physics simulation
    this.wasmParticleSystem.update(deltaTime);

    // Get updated positions from WASM
    const wasmPositions = this.wasmParticleSystem.get_positions();

    // Update Three.js buffer geometry
    const positions = this.particleGeometry.attributes.position.array;
    positions.set(wasmPositions);
    this.particleGeometry.attributes.position.needsUpdate = true;

    // Optional: Get morph phase for visual feedback
    const phase = this.wasmParticleSystem.get_morph_phase();
    this.updateMaterialForPhase(phase);
  }

  /**
   * Update material properties based on morph phase
   *
   * @param {number} phase - 0=Coalescing, 1=Holding, 2=Dissolving, 3=Reforming
   */
  updateMaterialForPhase(phase) {
    if (!this.particleMaterial) return;

    // Subtle visual changes during different morph phases
    switch (phase) {
      case 0: // Coalescing
        this.particleMaterial.opacity = 0.9;
        this.particleMaterial.size = 0.015;
        break;
      case 1: // Holding
        this.particleMaterial.opacity = 1.0;
        this.particleMaterial.size = 0.02;
        break;
      case 2: // Dissolving
        this.particleMaterial.opacity = 0.7;
        this.particleMaterial.size = 0.012;
        break;
      case 3: // Reforming
        this.particleMaterial.opacity = 0.85;
        this.particleMaterial.size = 0.018;
        break;
    }
  }

  /**
   * Update physics parameters manually
   *
   * @param {Object} params - Physics parameters (springStiffness, damping, curlStrength)
   */
  setPhysicsParams(params) {
    if (!this.wasmParticleSystem) return;

    this.wasmParticleSystem.set_physics_params(
      params.springStiffness || 1.0,
      params.damping || 0.08,
      params.curlStrength || 0.8
    );
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.weatherService) {
      this.weatherService.stopPeriodicUpdates();
    }

    if (this.particleGeometry) {
      this.particleGeometry.dispose();
    }

    if (this.particleMaterial) {
      this.particleMaterial.dispose();
    }

    if (this.particleSystem) {
      this.scene.remove(this.particleSystem);
    }

    if (this.wasmParticleSystem) {
      this.wasmParticleSystem.free();
    }
  }
}
