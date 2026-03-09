/**
 * Unsupervised Tribute
 *
 * High-performance particle-based visualization inspired by Refik Anadol's Unsupervised.
 * Uses Rust/WASM for particle computation, WebGL for rendering.
 */

import * as THREE from "three";
import { WeatherManager } from "./weather.js";
import { ParticleRenderer } from "./particle-renderer.js";
import { PostProcessor } from "./post-processing.js";
import {
  initWasm,
  createNoiseField,
  updateNoiseField,
  generateParticles,
  getVisualParams,
  isWasmReady,
  getWasmModule,
  createWasmBridge,
} from "./wasm-loader.js";
import { WeatherService, detectUserLocation } from "./weatherService.js";
import { getGPUTier } from 'detect-gpu';
import Stats from 'stats-gl';

const CONFIG = {
  particleCount: 5000,  // Match art data points per state
  sdTextureUrl: "/textures/sd_atlas.png",
  artDataUrl: "/data/art_states.bin",
};

/**
 * FpsAdaptor
 *
 * Monitors a rolling 90-frame FPS average. If sustained FPS drops below
 * 83% of target (50fps at 60fps target), reduces particle count by 20%
 * via setDrawRange. Applies a 120-frame (2s) cooldown between adjustments
 * to prevent oscillation. Also calls set_active_count() on the WASM system
 * so physics simulation matches the reduced draw count.
 */
class FpsAdaptor {
  constructor(geometry, wasmSystem, maxCount) {
    this.geometry = geometry;
    this.wasmSystem = wasmSystem;
    this.targetFps = 60;
    this.windowSize = 90;
    this.samples = [];
    this.currentCount = maxCount;
    this.maxCount = maxCount;
    this.minCount = Math.max(1000, Math.floor(maxCount * 0.1));
    this.cooldownFrames = 0;
  }

  update(deltaTime) {
    if (deltaTime <= 0 || deltaTime > 1) return; // Skip invalid deltas

    const fps = 1 / deltaTime;
    this.samples.push(fps);
    if (this.samples.length > this.windowSize) this.samples.shift();

    if (this.cooldownFrames > 0) {
      this.cooldownFrames--;
      return;
    }

    if (this.samples.length < this.windowSize) return;

    const avgFps = this.samples.reduce((a, b) => a + b) / this.samples.length;

    if (avgFps < this.targetFps * 0.83 && this.currentCount > this.minCount) {
      this.currentCount = Math.max(this.minCount, Math.floor(this.currentCount * 0.8));
      this.geometry.setDrawRange(0, this.currentCount);
      if (this.wasmSystem) {
        this.wasmSystem.set_active_count(this.currentCount);
      }
      this.cooldownFrames = 120;
      console.log(`[FpsAdaptor] Reduced to ${this.currentCount} particles (avg ${avgFps.toFixed(1)}fps)`);
    }
  }

  getCurrentCount() {
    return this.currentCount;
  }
}

class UnsupervisedApp {
  constructor() {
    this.container = document.getElementById("container");
    this.canvas = document.getElementById("canvas");
    this.startOverlay = document.getElementById("start-overlay");
    this.startButton = document.getElementById("start-button");
    this.audioHint = document.getElementById("audio-hint");
    this.infoPanel = document.getElementById("info-panel");
    this.infoToggle = document.getElementById("info-toggle");

    this.isStarted = false;
    this.ytPlayer = null;
    this.volume = 50;
    this.isMuted = false;
    this.isPaused = false;

    // Three.js setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020204);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 4);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Components
    this.weatherManager = new WeatherManager();
    this.particleRenderer = null;
    this.postProcessor = null;
    this.artTexture = null;

    // State
    this.wasmReady = false;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.frameCount = 0;

    // New particle physics system
    this.wasmParticleSystem = null;
    this.weatherService = null;

    // Performance optimization state
    this.wasmBridge = null;
    this.fpsAdaptor = null;
    this.statsGl = null;
    this.lastMorphPhase = -1;
    this._pendingBridgeInit = null;

    this.init();
  }

  async init() {
    // Initialize WASM
    try {
      console.log("Initializing WASM...");
      const wasmModule = await initWasm();
      createNoiseField(Math.floor(Math.random() * 1000000));
      this.wasmReady = true;
      console.log("WASM ready - using Rust for particle computation");

      // Initialize new particle physics system
      await this.initParticlePhysics(wasmModule);
    } catch (error) {
      console.warn("WASM init failed, using JS fallback:", error);
    }

    // Load art texture
    await this.loadArtTexture();

    // Initialize weather
    await this.weatherManager.init();

    // Create particle renderer
    this.particleRenderer = new ParticleRenderer(this.camera, this.artTexture);
    this.scene.add(this.particleRenderer.getMesh());

    // Wire WASM memory bridge to ParticleRenderer (deferred from initParticlePhysics)
    if (this._pendingBridgeInit) {
      const { bridge, count } = this._pendingBridgeInit;
      this.particleRenderer.initFromWasmBridge(bridge, count);
      this.fpsAdaptor = new FpsAdaptor(
        this.particleRenderer.geometry,
        this.wasmParticleSystem,
        count
      );
      this._pendingBridgeInit = null;
      console.log('[Renderer] WASM bridge wired, FpsAdaptor ready');
    }

    // stats-gl overlay (only when ?debug is in URL)
    if (new URLSearchParams(window.location.search).has('debug')) {
      this.statsGl = new Stats({ trackGPU: true });
      this.statsGl.init(this.renderer);
      document.body.appendChild(this.statsGl.dom);
      this.statsGl.dom.style.position = 'fixed';
      this.statsGl.dom.style.top = '0';
      this.statsGl.dom.style.left = '0';
      console.log('[Debug] stats-gl overlay active');
    }

    // Create post processor
    this.postProcessor = new PostProcessor(
      this.renderer,
      this.scene,
      this.camera
    );

    this.setupEventListeners();

    // Start animation loop
    this.animate();

    console.log("Unsupervised Tribute initialized");
  }

  async loadArtTexture() {
    return new Promise((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        CONFIG.sdTextureUrl,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          this.artTexture = texture;
          console.log("Art texture loaded");
          resolve(texture);
        },
        undefined,
        () => {
          console.log("Art texture not found, using procedural colors");
          resolve(null);
        }
      );
    });
  }

  /**
   * Initialize the new WASM particle physics system
   */
  async initParticlePhysics(wasmModule) {
    try {
      // 1. Detect GPU tier (async, runs before first frame)
      let particleCount = CONFIG.particleCount; // fallback
      try {
        const gpuTier = await getGPUTier();
        const countByTier = { 0: 1000, 1: 5000, 2: 20000, 3: 50000 };
        particleCount = countByTier[gpuTier.tier] ?? 5000;
        console.log(`[GPU] tier=${gpuTier.tier}, gpu="${gpuTier.gpu}", count=${particleCount}`);
      } catch (gpuErr) {
        console.warn('[GPU] detect-gpu failed, using default count:', gpuErr);
      }

      // 2. Load art data
      const artData = await this.loadArtData();
      const numStates = artData ? artData.numStates : 3;
      const seed = 42;

      // Cap particle count to art data points per state — extra particles have no tether targets
      if (artData && artData.pointsPerState < particleCount) {
        console.log(`[GPU] Capping particle count to art data points: ${particleCount} → ${artData.pointsPerState}`);
        particleCount = artData.pointsPerState;
      }

      console.log(`[WASM] Creating WasmParticleSystem: ${particleCount} particles, ${numStates} states`);
      this.wasmParticleSystem = new wasmModule.WasmParticleSystem(particleCount, seed, numStates);

      if (artData) {
        for (let i = 0; i < artData.numStates; i++) {
          this.wasmParticleSystem.load_art_state(i, artData.positions[i]);
          this.wasmParticleSystem.load_art_colors(i, artData.colors[i]);
        }
        CONFIG.particleCount = particleCount;
        console.log(`[WASM] Loaded ${numStates} art states, ${particleCount} points each`);
      } else {
        console.warn("No art data found, particles will float freely");
      }

      // 3. Create zero-copy memory bridge
      this.wasmBridge = createWasmBridge(this.wasmParticleSystem);

      // 4. Wire ParticleRenderer to WASM memory (must happen after particleRenderer is created)
      // particleRenderer is created in init() after this call — defer wiring to a flag
      this._pendingBridgeInit = { bridge: this.wasmBridge, count: particleCount };

      // 5. Initialize weather service for physics influence
      await this.initWeatherService();

      console.log('[WASM] Particle physics initialized');
    } catch (error) {
      console.warn('[WASM] Particle physics init failed:', error);
      this.wasmParticleSystem = null;
    }
  }

  /**
   * Load art states from binary file (art_states.bin)
   * Binary format v2: header (16 bytes) + positions + colors
   */
  async loadArtData() {
    try {
      const response = await fetch(CONFIG.artDataUrl);
      if (!response.ok) {
        console.warn(`Art data not found at ${CONFIG.artDataUrl} (${response.status})`);
        return null;
      }

      const buffer = await response.arrayBuffer();
      const view = new DataView(buffer);

      // Parse header (16 bytes: version, numStates, pointsPerState, colorsPerState)
      const version = view.getInt32(0, true);
      const numStates = view.getInt32(4, true);
      const pointsPerState = view.getInt32(8, true);
      const colorsPerState = view.getInt32(12, true);

      console.log(`Art data header: v${version}, ${numStates} states, ${pointsPerState} pts, ${colorsPerState} colors, ${buffer.byteLength} bytes`);

      // Parse positions
      const positions = [];
      let offset = 16;
      for (let i = 0; i < numStates; i++) {
        const floatCount = pointsPerState * 3;
        const statePositions = new Float32Array(buffer, offset, floatCount);
        positions.push(statePositions);
        offset += floatCount * 4;
      }

      // Parse colors
      const colors = [];
      for (let i = 0; i < numStates; i++) {
        const floatCount = colorsPerState * 3;
        const stateColors = new Float32Array(buffer, offset, floatCount);
        colors.push(stateColors);
        offset += floatCount * 4;
      }

      return { version, numStates, pointsPerState, colorsPerState, positions, colors };
    } catch (error) {
      console.warn("Failed to load art data:", error);
      return null;
    }
  }

  /**
   * Initialize weather service for real-time physics influence
   */
  async initWeatherService() {
    try {
      const location = await detectUserLocation();
      console.log(`Location: ${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`);

      this.weatherService = new WeatherService(location.latitude, location.longitude);

      // Start periodic weather updates
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
      console.warn("Weather service init failed, using defaults:", error);
    }
  }

  setupEventListeners() {
    window.addEventListener("resize", () => this.onWindowResize());
    window.addEventListener("keydown", (e) => this.onKeyDown(e));

    // Info panel toggle
    if (this.infoToggle) {
      this.infoToggle.addEventListener("click", () => this.toggleInfoPanel());
    }

    // Start button
    if (this.startButton) {
      this.startButton.addEventListener("click", () => this.start());
    }

    // Also allow clicking anywhere on overlay
    if (this.startOverlay) {
      this.startOverlay.addEventListener("click", (e) => {
        if (e.target === this.startOverlay || e.target === this.startButton) {
          this.start();
        }
      });
    }
  }

  toggleInfoPanel() {
    if (this.infoPanel) {
      this.infoPanel.classList.toggle("collapsed");
      if (this.infoToggle) {
        this.infoToggle.textContent = this.infoPanel.classList.contains("collapsed") ? "+" : "−";
      }
    }
  }

  start() {
    if (this.isStarted) return;
    this.isStarted = true;

    // Hide overlay
    if (this.startOverlay) {
      this.startOverlay.classList.add("hidden");
    }

    // Initialize YouTube player
    this.initYouTubePlayer();

    // Fade out audio hint after 5 seconds
    setTimeout(() => {
      if (this.audioHint) {
        this.audioHint.classList.add("fade");
      }
    }, 5000);

    console.log("Experience started");
  }

  initYouTubePlayer() {
    if (typeof YT === "undefined" || typeof YT.Player === "undefined") {
      window.onYouTubeIframeAPIReady = () => this.createYouTubePlayer();
    } else {
      this.createYouTubePlayer();
    }
  }

  createYouTubePlayer() {
    const videoIds = [
      "UfcAVejslrU", // Marconi Union - Weightless
      "jfKfPfyJRdk", // lofi beats
      "lE6RYpe9IT0", // Relaxing ambient
    ];

    const tryVideo = (index) => {
      if (index >= videoIds.length) {
        console.log("All video sources failed, running without audio");
        this.updateAudioHint();
        return;
      }

      const videoId = videoIds[index];
      this.ytPlayer = new YT.Player("youtube-player", {
        videoId: videoId,
        playerVars: {
          autoplay: 1,
          loop: 1,
          playlist: videoId,
          controls: 0,
          showinfo: 0,
          modestbranding: 1,
          fs: 0,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            event.target.setVolume(this.volume);
            event.target.playVideo();
            this.updateAudioHint();
          },
          onStateChange: (event) => {
            if (event.data === 0) {
              event.target.seekTo(0);
              event.target.playVideo();
            }
          },
          onError: () => {
            if (this.ytPlayer) this.ytPlayer.destroy();
            tryVideo(index + 1);
          },
        },
      });
    };

    tryVideo(0);
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(100, vol));
    if (this.ytPlayer && this.ytPlayer.setVolume) {
      this.ytPlayer.setVolume(this.volume);
    }
    this.updateAudioHint();
  }

  toggleMute() {
    if (!this.ytPlayer) return;
    if (this.isMuted) {
      this.ytPlayer.unMute();
      this.isMuted = false;
    } else {
      this.ytPlayer.mute();
      this.isMuted = true;
    }
    this.updateAudioHint();
  }

  updateAudioHint() {
    if (this.audioHint) {
      let status = this.isPaused
        ? "PAUSED"
        : this.isMuted
          ? "MUTED"
          : `${this.volume}%`;
      this.audioHint.textContent = `Space: Play/Pause | M: Mute | ↑↓: Volume | ${status}`;
    }
  }

  togglePause() {
    if (!this.ytPlayer) return;
    if (this.isPaused) {
      this.ytPlayer.playVideo();
      this.isPaused = false;
    } else {
      this.ytPlayer.pauseVideo();
      this.isPaused = true;
    }
    this.updateAudioHint();
  }

  onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    this.particleRenderer?.onResize();
    this.postProcessor?.onResize();
  }

  onKeyDown(e) {
    switch (e.key) {
      case "1":
        this.postProcessor?.setBloomStrength(
          Math.max(0, this.postProcessor.getBloomPass().strength - 0.2)
        );
        break;
      case "2":
        this.postProcessor?.setBloomStrength(
          Math.min(3, this.postProcessor.getBloomPass().strength + 0.2)
        );
        break;
      case "r":
        if (this.wasmReady) {
          createNoiseField(Math.floor(Math.random() * 1000000));
          console.log("Noise field reset");
        }
        break;
      case "m":
      case "M":
        this.toggleMute();
        break;
      case "ArrowUp":
        e.preventDefault();
        this.setVolume(this.volume + 10);
        break;
      case "ArrowDown":
        e.preventDefault();
        this.setVolume(this.volume - 10);
        break;
      case " ":
        e.preventDefault();
        if (!this.isStarted) {
          this.start();
        } else {
          this.togglePause();
        }
        break;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const deltaTime = this.clock.getDelta();
    this.time += deltaTime;
    this.frameCount++;

    // Get weather data
    const weatherData = this.weatherManager.getCurrentWeather();

    // Update particles using WASM
    if (this.wasmReady) {
      // Use new particle physics system if available
      if (this.wasmParticleSystem) {
        try {
          // Update physics simulation
          this.wasmParticleSystem.update(deltaTime);

          // Gate color uploads to morph phase changes only (reduces GPU bandwidth)
          const morphPhase = this.wasmParticleSystem.get_morph_phase();
          const colorsChanged = morphPhase !== this.lastMorphPhase;
          if (colorsChanged) this.lastMorphPhase = morphPhase;

          // Use zero-copy bridge if available, otherwise fall back to copy path
          if (this.wasmBridge && this.particleRenderer.wasmBridge) {
            this.particleRenderer.updateFromWasmBridge(colorsChanged);
          } else {
            const positions = this.wasmParticleSystem.get_positions();
            const colors = this.wasmParticleSystem.get_colors();
            const particleData = this.convertPositionsToParticleData(positions);
            this.particleRenderer.updateFromWasm(particleData, this.time, colors);
          }

          // Adaptive FPS: reduce count if sustained below 50fps
          if (this.fpsAdaptor) {
            this.fpsAdaptor.update(deltaTime);
          }
        } catch (error) {
          console.error("Physics update error:", error);
          this.particleRenderer.updateFallback(this.time);
        }
      } else {
        // Fallback to old noise-based generation
        try {
          updateNoiseField(deltaTime);
          const particleData = generateParticles(CONFIG.particleCount);
          this.particleRenderer.updateFromWasm(particleData, this.time);
        } catch (error) {
          this.particleRenderer.updateFallback(this.time);
        }
      }

      // Update visual parameters from weather
      const visualParams = getVisualParams(weatherData);
      this.postProcessor?.updateParams({
        intensity: visualParams?.animSpeed || 1.0,
        warmth: visualParams?.colorWarmth || 0.5,
      });
    } else {
      // JS fallback
      this.particleRenderer.updateFallback(this.time);
    }

    // Update particle renderer
    this.particleRenderer.update(this.time);

    // Render
    if (this.statsGl) this.statsGl.begin();
    this.postProcessor.render();
    if (this.statsGl) this.statsGl.end();
  }

  /**
   * Convert positions array [x,y,z,...] to particle data [x,y,z,size,...]
   */
  convertPositionsToParticleData(positions) {
    const numParticles = positions.length / 3;
    const particleData = new Float32Array(numParticles * 4);

    for (let i = 0; i < numParticles; i++) {
      const srcIdx = i * 3;
      const dstIdx = i * 4;

      particleData[dstIdx] = positions[srcIdx];         // x
      particleData[dstIdx + 1] = positions[srcIdx + 1]; // y
      particleData[dstIdx + 2] = positions[srcIdx + 2]; // z

      // Calculate size based on position (particles near center are larger)
      const dist = Math.sqrt(
        positions[srcIdx] ** 2 +
        positions[srcIdx + 1] ** 2 +
        positions[srcIdx + 2] ** 2
      );
      particleData[dstIdx + 3] = 0.015 + Math.max(0, 0.01 - dist * 0.002); // size
    }

    return particleData;
  }
}

// Initialize
new UnsupervisedApp();
