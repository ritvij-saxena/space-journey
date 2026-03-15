/**
 * Space Journey
 *
 * First-person auto-pilot flight through procedurally generated infinite space.
 * Stars, planets (9 biomes), moons, asteroid belts, and nebulae are spawned
 * in 600-unit sectors along the flight path. Camera glides on a cinematic
 * auto-pilot that curves toward interesting objects.
 */

import * as THREE from 'three';
import { FlightController }       from './flight-controller.js';
import { SpaceWorld }             from './space-world.js';
import { createBackgroundStars }  from './background-stars.js';
import { PostProcessor }          from './post-processing.js';
import { texLib }                 from './texture-library.js';
import { initWasm }               from './wasm-loader.js';
import { getGPUTier }           from 'detect-gpu';
import Stats                     from 'stats-gl';
import { WasmMemoryBridge, createWasmBridge } from './wasm-loader.js';
import { ParticleRenderer }      from './particle-renderer.js';

/**
 * FpsAdaptor
 *
 * Monitors a rolling 90-frame FPS average. When sustained FPS drops below
 * 83% of target (50fps at 60fps target), reduces draw count by 20% via
 * geometry.setDrawRange(). Applies a 120-frame cooldown between reductions
 * to prevent oscillation. Calls wasmParticleSystem.set_active_count() in sync
 * so WASM physics simulation matches the reduced GPU draw count.
 */
class FpsAdaptor {
  constructor(geometry, wasmSystem, maxCount) {
    this.geometry      = geometry;
    this.wasmSystem    = wasmSystem;
    this.targetFps     = 60;
    this.windowSize    = 90;
    this.samples       = [];
    this.currentCount  = maxCount;
    this.maxCount      = maxCount;
    this.minCount      = Math.max(1000, Math.floor(maxCount * 0.1));
    this.cooldownFrames = 0;
  }

  update(deltaTime) {
    if (deltaTime <= 0 || deltaTime > 1) return;

    const fps = 1 / deltaTime;
    this.samples.push(fps);
    if (this.samples.length > this.windowSize) this.samples.shift();

    if (this.cooldownFrames > 0) { this.cooldownFrames--; return; }
    if (this.samples.length < this.windowSize) return;

    const avgFps = this.samples.reduce((a, b) => a + b) / this.samples.length;

    if (avgFps < this.targetFps * 0.83 && this.currentCount > this.minCount) {
      this.currentCount = Math.max(this.minCount, Math.floor(this.currentCount * 0.8));
      this.geometry.setDrawRange(0, this.currentCount);
      if (this.wasmSystem) {
        this.wasmSystem.set_active_count(this.currentCount);
      }
      this.cooldownFrames = 120;
      console.log(`[FpsAdaptor] ${this.currentCount} particles (avg ${avgFps.toFixed(1)} fps)`);
    }
  }

  getCurrentCount() { return this.currentCount; }
}

class SpaceJourneyApp {
  constructor() {
    this.canvas       = document.getElementById('canvas');
    this.startOverlay = document.getElementById('start-overlay');
    this.startButton  = document.getElementById('start-button');
    this.audioHint    = document.getElementById('audio-hint');

    this.isStarted = false;
    this.ytPlayer  = null;
    this.volume    = 50;
    this.isMuted   = false;
    this.isPaused  = false;

    // ── Three.js core ───────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005); // near-black deep space

    // 60° FOV gives an immersive first-person view.
    // Far plane 5000 ensures background stars (r ≈ 700-1000 from camera) render.
    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.5, 5000,
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas:          this.canvas,
      antialias:       true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Scene-wide lighting for standard materials (asteroids, satellites)
    this.scene.add(new THREE.AmbientLight(0x111118, 4));
    const sunLight = new THREE.DirectionalLight(0xfffaf0, 0.8);
    sunLight.position.set(1, 0.8, 0.5);
    this.scene.add(sunLight);

    this.clock = new THREE.Clock();

    this.init();
  }

  init() {
    // Load WASM concurrently — WasmKeplerSim becomes available for sectors
    // that spawn after it resolves; earlier sectors fall back to static meshes.
    initWasm().catch(e => console.warn('WASM unavailable — asteroid belt physics disabled', e));

    // Bright foreground stars (spectral colors, diffraction spikes)
    this.stars = createBackgroundStars(40000);
    this.scene.add(this.stars);

    // Milky Way photorealistic dome (async — loads after first frame)
    texLib.get('milky_way').then(tex => {
      if (!tex) return;
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(1800, 64, 32),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false }),
      );
      dome.renderOrder = -1;
      dome.name = 'milky_way_dome';
      this.scene.add(dome);
      this.skyDome = dome;
    });

    // Procedural infinite world
    this.world = new SpaceWorld(this.scene);

    // Auto-pilot flight controller
    this.flight = new FlightController(this.camera);

    // Post-processing (bloom + afterimage + chromatic aberration)
    this.postProcessor = new PostProcessor(this.renderer, this.scene, this.camera);

    this.setupEventListeners();
    this.animate();
  }

  // ── Event listeners ────────────────────────────────────────────────────────

  setupEventListeners() {
    window.addEventListener('resize',  () => this.onWindowResize());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.startButton?.addEventListener('click', () => this.start());
    this.startOverlay?.addEventListener('click', (e) => {
      if (e.target === this.startOverlay || e.target === this.startButton) {
        this.start();
      }
    });
  }

  start() {
    if (this.isStarted) return;
    this.isStarted = true;

    this.startOverlay?.classList.add('hidden');
    this.initYouTubePlayer();

    setTimeout(() => this.audioHint?.classList.add('fade'), 5000);
  }

  // ── YouTube ambient audio ─────────────────────────────────────────────────

  initYouTubePlayer() {
    if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
      window.onYouTubeIframeAPIReady = () => this.createYouTubePlayer();
    } else {
      this.createYouTubePlayer();
    }
  }

  createYouTubePlayer() {
    const videoIds = [
      'UfcAVejslrU', // Marconi Union — Weightless
      'jfKfPfyJRdk', // lofi beats
      'lE6RYpe9IT0', // ambient
    ];

    const tryVideo = (index) => {
      if (index >= videoIds.length) {
        this.updateAudioHint();
        return;
      }
      const videoId = videoIds[index];
      this.ytPlayer = new YT.Player('youtube-player', {
        videoId,
        playerVars: {
          autoplay: 1, loop: 1, playlist: videoId,
          controls: 0, showinfo: 0, modestbranding: 1,
          fs: 0, rel: 0, origin: window.location.origin,
        },
        events: {
          onReady:       (e) => { e.target.setVolume(this.volume); e.target.playVideo(); this.updateAudioHint(); },
          onStateChange: (e) => { if (e.data === 0) { e.target.seekTo(0); e.target.playVideo(); } },
          onError:       ()  => { this.ytPlayer?.destroy(); tryVideo(index + 1); },
        },
      });
    };
    tryVideo(0);
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(100, vol));
    this.ytPlayer?.setVolume?.(this.volume);
    this.updateAudioHint();
  }

  toggleMute() {
    if (!this.ytPlayer) return;
    if (this.isMuted) { this.ytPlayer.unMute(); this.isMuted = false; }
    else              { this.ytPlayer.mute();   this.isMuted = true;  }
    this.updateAudioHint();
  }

  togglePause() {
    if (!this.ytPlayer) return;
    if (this.isPaused) { this.ytPlayer.playVideo();  this.isPaused = false; }
    else               { this.ytPlayer.pauseVideo(); this.isPaused = true;  }
    this.updateAudioHint();
  }

  updateAudioHint() {
    if (!this.audioHint) return;
    const status = this.isPaused ? 'PAUSED' : this.isMuted ? 'MUTED' : `${this.volume}%`;
    this.audioHint.textContent = `Space: Play/Pause | M: Mute | ↑↓: Volume | ${status}`;
  }

  // ── Window & keyboard ──────────────────────────────────────────────────────

  onWindowResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postProcessor.onResize();
  }

  onKeyDown(e) {
    switch (e.key) {
      case 'm': case 'M':
        this.toggleMute();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.setVolume(this.volume + 10);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.setVolume(this.volume - 10);
        break;
      case ' ':
        e.preventDefault();
        if (!this.isStarted) this.start();
        else this.togglePause();
        break;
      case '1':
        this.postProcessor.setBloomStrength(
          Math.max(0, this.postProcessor.getBloomPass().strength - 0.2)
        );
        break;
      case '2':
        this.postProcessor.setBloomStrength(
          Math.min(3, this.postProcessor.getBloomPass().strength + 0.2)
        );
        break;
    }
  }

  // ── Render loop ────────────────────────────────────────────────────────────

  _updateGravLensing() {
    const poi = this.world.getInterestingObjects();
    const bhList = [];
    for (const p of poi) {
      if (!p.isBH) continue;
      const ndc = p.position.clone().project(this.camera);
      if (ndc.z >= 1.0) continue; // behind camera
      const screenPos = new THREE.Vector2((ndc.x + 1) * 0.5, (ndc.y + 1) * 0.5);
      // Estimate screen-space Einstein radius from 3D BH radius and distance
      const dist        = p.position.distanceTo(this.camera.position);
      const fovFactor   = Math.tan((this.camera.fov * Math.PI / 360));
      const screenRadius = (p.bhRadius ?? 8) / (dist * fovFactor * 2.0);
      bhList.push({ screenPos, depth: ndc.z, screenRadius });
    }
    this.postProcessor.updateLensing(bhList);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // Cap delta at 50 ms to prevent large jumps after tab switch
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // 1. Update world: load/unload sectors, animate shaders
    this.world.update(dt, this.camera.position);

    // 2. Move camera via auto-pilot, attracted by nearby objects
    this.flight.update(dt, this.world.getInterestingObjects());

    // 3. Background stars follow camera so they always surround it
    this.stars.position.copy(this.camera.position);

    // Animate background star twinkle
    if (this.stars.material?.uniforms?.uTime) {
      this.stars.material.uniforms.uTime.value = this.clock.elapsedTime ?? (performance.now() * 0.001);
    }

    // Milky Way dome follows camera (never moves relative to viewer)
    if (this.skyDome) this.skyDome.position.copy(this.camera.position);

    // Gravitational lensing — project BH positions to screen space
    this._updateGravLensing();

    // 4. Render with post-processing
    this.postProcessor.render();
  }
}

new SpaceJourneyApp();
