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
} from "./wasm-loader.js";

const CONFIG = {
  particleCount: 15000,
  sdTextureUrl: "/textures/sd_atlas.png",
};

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

    this.init();
  }

  async init() {
    // Initialize WASM
    try {
      console.log("Initializing WASM...");
      await initWasm();
      createNoiseField(Math.floor(Math.random() * 1000000));
      this.wasmReady = true;
      console.log("WASM ready - using Rust for particle computation");
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
      updateNoiseField(deltaTime);

      // Generate particle positions in Rust/WASM
      try {
        const particleData = generateParticles(CONFIG.particleCount);
        this.particleRenderer.updateFromWasm(particleData, this.time);
      } catch (error) {
        // Fallback to JS animation
        this.particleRenderer.updateFallback(this.time);
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
    this.postProcessor.render();
  }
}

// Initialize
new UnsupervisedApp();
