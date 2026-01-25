# Architecture

**Analysis Date:** 2026-01-25

## Pattern Overview

**Overall:** Hybrid Rust/WASM + JavaScript/WebGL pipeline for real-time generative visualization

**Key Characteristics:**
- Compute-heavy particle generation delegated to Rust/WASM (performance-critical)
- JavaScript orchestrates Three.js scene, shader management, and UI state
- Procedural environmental parameters generated client-side (no external APIs)
- Modular component architecture with clear separation of rendering concerns
- Shader-based post-processing for visual effects (bloom, chromatic aberration)

## Layers

**Presentation Layer (WebGL/Shader):**
- Purpose: Render particles and apply post-processing effects
- Location: `frontend/src/particle-renderer.js`, `frontend/src/post-processing.js`, `frontend/src/raymarcher.js`
- Contains: Three.js components, shader materials, effect composers
- Depends on: Three.js library, WASM particle data
- Used by: Main application for frame rendering

**Computation Layer (Rust/WASM):**
- Purpose: High-performance noise generation and particle position computation
- Location: `rust-wasm/src/lib.rs`
- Contains: NoiseField struct with Perlin/FBM noise, particle generation algorithms, weather-to-param mapping
- Depends on: noise crate (v0.9), wasm-bindgen bindings
- Used by: JavaScript front-end via wasm-loader

**Application Orchestration (JavaScript):**
- Purpose: Coordinate all components, manage lifecycle, handle user input
- Location: `frontend/src/main.js`
- Contains: UnsupervisedApp class managing scene setup, event handling, animation loop
- Depends on: Three.js, ParticleRenderer, PostProcessor, WeatherManager, WASM loader
- Used by: HTML entry point

**Environmental/State Management:**
- Purpose: Generate procedural "weather" parameters based on time, device motion, screen properties
- Location: `frontend/src/weather.js`
- Contains: WeatherManager class with deterministic randomization, smooth interpolation, device motion listeners
- Depends on: Browser APIs (DeviceMotionEvent, DeviceOrientationEvent)
- Used by: Main app for visual parameter generation

**Utility/Bridge Layers:**
- Purpose: Abstract WASM loading and provide stable JavaScript API
- Location: `frontend/src/wasm-loader.js`
- Contains: Singleton pattern for WASM module, function wrappers for noise field operations
- Depends on: Dynamically loaded WASM module from `unsupervised-wasm` package
- Used by: Main app, requires initialization before particle generation

## Data Flow

**Initialization Flow:**

1. HTML (`frontend/index.html`) loads YouTube API and `frontend/src/main.js`
2. UnsupervisedApp constructor initializes Three.js scene, canvas, camera, renderer
3. `init()` method:
   - Calls `initWasm()` to load Rust/WASM module asynchronously
   - Creates NoiseField with random seed via `createNoiseField()`
   - Loads art texture asynchronously (SD-generated or fallback)
   - Initializes WeatherManager to start procedural parameter generation
   - Creates ParticleRenderer with camera and art texture
   - Creates PostProcessor with effect composer (bloom, chromatic aberration)
   - Attaches event listeners (resize, keyboard)
   - Calls `animate()` to start render loop

**Per-Frame Animation Flow:**

1. `animate()` called via requestAnimationFrame
2. Delta time calculated from THREE.Clock
3. WeatherManager provides current interpolated weather data (temperature, humidity, wind)
4. If WASM ready:
   - Update NoiseField time via `updateNoiseField(deltaTime)`
   - Generate particle positions via `generateParticles(15000)` → returns Float32Array [x,y,z,size,...]
   - Call `ParticleRenderer.updateFromWasm()` with WASM data and time
   - Sample colors from art texture based on particle positions
   - Get visual parameters via `getVisualParams()` (maps weather to shader uniforms)
   - Update PostProcessor parameters (bloom strength, chromatic aberration)
5. ParticleRenderer updates mesh rotation and shader uniforms
6. PostProcessor renders scene through effect chain (render → bloom → aberration)
7. Loop continues

**Fallback Path (if WASM init fails):**
- ParticleRenderer.updateFallback() generates positions using JavaScript sine/noise approximation
- Visual parameters still derive from weather data
- Post-processing effects still applied

**State Management:**
- WeatherManager maintains current smoothed values and target values
- Smooth interpolation via lerp toward targets (updated every 5 seconds)
- Device motion data influences environmental variability (real-time)
- Time-based patterns (hour/day/season cycles) ensure deterministic but varying output

## Key Abstractions

**NoiseField (Rust):**
- Purpose: Encapsulates Perlin/FBM noise with time animation
- Examples: `rust-wasm/src/lib.rs` lines 8-211
- Pattern: Class-like struct via `#[wasm_bindgen]` macro for JavaScript interop
- Methods: `new()`, `update()`, `generate_noise_slice()`, `generate_particles()`, `weather_to_params()`

**ParticleRenderer (JavaScript):**
- Purpose: Manages particle geometry, materials, and attribute updates
- Examples: `frontend/src/particle-renderer.js` lines 60-288
- Pattern: Class with init, update, and resource cleanup
- Key methods:
  - `updateFromWasm()`: Updates position/size/color attributes from WASM data
  - `updateFallback()`: JavaScript animation fallback
  - `sampleArtColor()`: Maps 3D position to 2D UV on art texture

**PostProcessor (JavaScript):**
- Purpose: Applies visual effects through EffectComposer pipeline
- Examples: `frontend/src/post-processing.js` lines 14-130
- Pattern: Decorator pattern wrapping Three.js EffectComposer
- Effects chained: RenderPass → UnrealBloomPass → ChromaticAberrationShaderPass

**WeatherManager (JavaScript):**
- Purpose: Generates procedural environmental parameters without external APIs
- Examples: `frontend/src/weather.js` lines 11-220
- Pattern: Singleton-like manager with state interpolation
- Inputs: Time, device motion (if available), screen properties
- Outputs: temperature (20-45°C), humidity (0-100%), windSpeed (0-25 m/s)

## Entry Points

**Browser Entry (`frontend/index.html`):**
- Location: `frontend/index.html` lines 1-51
- Triggers: Page load
- Responsibilities:
  - Defines DOM structure (canvas, info panel, overlay, YouTube player container)
  - Loads YouTube iframe API for audio
  - Imports and runs `frontend/src/main.js`

**Application Initialization (`frontend/src/main.js`):**
- Location: `frontend/src/main.js` lines 385-388
- Triggers: Module load (ES module, executed immediately)
- Responsibilities:
  - Instantiates UnsupervisedApp which bootstraps entire system
  - No parameters (class handles its own initialization)

**WASM Module Entry (`rust-wasm/src/lib.rs`):**
- Location: `rust-wasm/src/lib.rs` lines 7-216
- Triggers: Loaded via dynamic import in `wasm-loader.js`
- Responsibilities:
  - Exports `NoiseField` class via `#[wasm_bindgen]` for JavaScript instantiation
  - Exports `greet()` utility function (not critical)

## Error Handling

**Strategy:** Graceful degradation with JavaScript fallbacks

**Patterns:**

1. **WASM Loading Failure** (main.js lines 77-87):
   - Wrapped in try/catch
   - Logs warning, sets `this.wasmReady = false`
   - ParticleRenderer switches to updateFallback() for animation
   - Shaders and post-processing still functional

2. **Texture Loading** (main.js lines 114-133):
   - Uses Promise-based loader with error callback
   - Logs to console if SD texture missing
   - Falls back to procedural colors in ParticleRenderer

3. **YouTube Player** (main.js lines 190-247):
   - Tries multiple video sources sequentially
   - Fallback: display "running without audio" message
   - CORS handling via origin parameter in player config

4. **Runtime Bounds Checking** (wasm/lib.rs lines 115-120):
   - Buffer index validation before array access in noise atlas generation
   - Prevents out-of-bounds writes

5. **Particle Data Validation** (main.js lines 360-366):
   - Try/catch around WASM particle generation
   - Falls back to JavaScript animation if WASM fails mid-frame

## Cross-Cutting Concerns

**Logging:**
- Console.log throughout for development debugging
- No production logger integration
- Key events: "WASM ready", "Art texture loaded", "Unsupervised Tribute initialized"

**Validation:**
- Weather parameter clamping in WeatherManager (humidity: 0-100%, temperature: -20-45°C)
- Particle count limits (15000 particles for performance)
- Smooth interpolation prevents jarring visual changes

**Animation Synchronization:**
- Uses THREE.Clock for consistent delta time calculation
- requestAnimationFrame ensures 60fps target on capable devices
- Time state accumulated per-frame for smooth transitions

**Resource Management:**
- Texture disposal in Raymarcher and PostProcessor
- Geometry/material disposal in ParticleRenderer
- WASM module singleton pattern prevents multiple loads

---

*Architecture analysis: 2026-01-25*
