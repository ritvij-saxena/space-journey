/**
 * Unsupervised Tribute
 *
 * Noise-field raymarching visualization inspired by Refik Anadol's Unsupervised.
 */

import * as THREE from "three";
import { WeatherManager } from "./weather.js";
import { Raymarcher } from "./raymarcher.js";
import { PostProcessor } from "./post-processing.js";
import {
  initWasm,
  createNoiseField,
  updateNoiseField,
  generateNoiseAtlas,
  getVisualParams,
  isWasmReady,
} from "./wasm-loader.js";

const CONFIG = {
  noiseSliceSize: 64,
  noiseDepthSlices: 16,
  noiseUpdateInterval: 120,
  useSDTextures: false,
  sdTextureUrl: "./textures/sd_atlas.png",
  sdTextureSlices: 16,
};

class UnsupervisedApp {
  constructor() {
    this.container = document.getElementById("container");
    this.canvas = document.getElementById("canvas");
    this.startOverlay = document.getElementById("start-overlay");
    this.startButton = document.getElementById("start-button");
    this.audioHint = document.getElementById("audio-hint");

    this.isStarted = false;
    this.ytPlayer = null;
    this.volume = 50; // 0-100
    this.isMuted = false;
    this.isPaused = false;

    // Three.js setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010103);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 5);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Components
    this.weatherManager = new WeatherManager();
    this.raymarcher = null;
    this.postProcessor = null;

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
      console.log("WASM ready");
    } catch (error) {
      console.warn("WASM init failed, using fallback:", error);
    }

    // Initialize weather
    await this.weatherManager.init();

    // Create raymarcher
    this.raymarcher = new Raymarcher(this.camera);
    this.scene.add(this.raymarcher.getMesh());

    // Try to load SD textures if configured
    if (CONFIG.useSDTextures) {
      try {
        await this.raymarcher.loadSDTexture(
          CONFIG.sdTextureUrl,
          CONFIG.sdTextureSlices
        );
        console.log("SD texture loaded");
      } catch (error) {
        console.log("SD texture not available, using procedural noise");
      }
    }

    // Initial noise texture from WASM
    if (this.wasmReady && !this.raymarcher.isUsingSDTexture()) {
      this.updateNoiseTexture();
    }

    // Create post processor
    this.postProcessor = new PostProcessor(
      this.renderer,
      this.scene,
      this.camera
    );

    this.setupEventListeners();

    // Start animation loop (renders even before user clicks)
    this.animate();

    console.log("Unsupervised Tribute initialized - waiting for user to start");
  }

  setupEventListeners() {
    window.addEventListener("resize", () => this.onWindowResize());
    window.addEventListener("keydown", (e) => this.onKeyDown(e));

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

  start() {
    if (this.isStarted) return;
    this.isStarted = true;

    // Hide overlay
    if (this.startOverlay) {
      this.startOverlay.classList.add("hidden");
    }

    // Initialize YouTube player
    this.initYouTubePlayer();

    console.log("Experience started");
  }

  initYouTubePlayer() {
    // Wait for YouTube API to be ready
    if (typeof YT === "undefined" || typeof YT.Player === "undefined") {
      window.onYouTubeIframeAPIReady = () => this.createYouTubePlayer();
    } else {
      this.createYouTubePlayer();
    }
  }

  createYouTubePlayer() {
    // Marconi Union - Weightless (Official Video ID)
    this.ytPlayer = new YT.Player("youtube-player", {
      videoId: "UfcAVejslrU", // Weightless by Marconi Union
      playerVars: {
        autoplay: 1,
        loop: 1,
        playlist: "UfcAVejslrU", // Required for looping
        controls: 0,
        showinfo: 0,
        modestbranding: 1,
        fs: 0,
        rel: 0,
      },
      events: {
        onReady: (event) => {
          event.target.setVolume(this.volume);
          event.target.playVideo();
          console.log("YouTube audio started");
        },
        onStateChange: (event) => {
          // YT.PlayerState.ENDED === 0
          if (event.data === 0) {
            // Song ended, restart from beginning
            event.target.seekTo(0);
            event.target.playVideo();
            console.log("Restarting audio from beginning");
          }
        },
        onError: (event) => {
          console.log("YouTube player error:", event.data);
        },
      },
    });
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
      let status = this.isPaused ? "PAUSED" : this.isMuted ? "MUTED" : `${this.volume}%`;
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

    this.raymarcher?.onResize();
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
          this.updateNoiseTexture();
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
          // Space to start if not started
          this.start();
        } else {
          // Space to pause/play audio if started
          this.togglePause();
        }
        break;
    }
  }

  updateNoiseTexture() {
    if (!this.wasmReady || this.raymarcher?.isUsingSDTexture()) return;

    try {
      const { data, size, slices } = generateNoiseAtlas(
        CONFIG.noiseSliceSize,
        CONFIG.noiseDepthSlices
      );
      this.raymarcher.updateNoiseFromWasm(data, size, slices);
    } catch (error) {
      console.warn("Failed to update noise texture:", error);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const deltaTime = this.clock.getDelta();
    this.time += deltaTime;
    this.frameCount++;

    // Get weather data
    const weatherData = this.weatherManager.getCurrentWeather();

    // Update WASM noise field
    if (this.wasmReady) {
      updateNoiseField(deltaTime);

      // Periodically regenerate noise texture
      if (
        !this.raymarcher.isUsingSDTexture() &&
        this.frameCount % CONFIG.noiseUpdateInterval === 0
      ) {
        this.updateNoiseTexture();
      }

      // Update visual parameters from weather
      const visualParams = getVisualParams(weatherData);
      this.raymarcher.updateVisualParams(visualParams);

      // Update post-processing
      this.postProcessor?.updateParams({
        intensity: visualParams?.animSpeed || 1.0,
        warmth: visualParams?.colorWarmth || 0.5,
      });
    }

    // Update raymarcher
    this.raymarcher.update(this.time);

    // Render
    this.postProcessor.render();
  }
}

// Initialize
const app = new UnsupervisedApp();
