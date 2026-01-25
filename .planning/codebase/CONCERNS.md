# Codebase Concerns

**Analysis Date:** 2026-01-25

## Tech Debt

**WASM Fallback Path Under-tested:**
- Issue: WASM module failure silently falls back to JavaScript-only animation. The fallback is caught but not systematically tested.
- Files: `frontend/src/main.js` (lines 79-87), `frontend/src/wasm-loader.js` (lines 13-26)
- Impact: If WASM fails to load, application still runs but with significantly degraded particle quality and performance. Users experience different visuals without indication.
- Fix approach: Implement explicit fallback detection, add user notification of fallback state, create integration tests that verify fallback behavior works correctly.

**Unused/Dead Code Components:**
- Issue: `VisualizationEngine` class exists but is not imported or used in the main application.
- Files: `frontend/src/visualization.js` (unused; 108 lines)
- Impact: Increases bundle size unnecessarily and creates maintenance confusion.
- Fix approach: Remove dead code or integrate `VisualizationEngine` into the main application flow. Decision needed: is this for future feature or legacy code?

**Hardcoded Magic Numbers Throughout:**
- Issue: Particle count, animation speeds, noise parameters, color ranges, and physics constants are hardcoded without explanation.
- Files: `frontend/src/main.js` (line 22: `particleCount: 15000`), `particle-renderer.js` (lines 96, 142: size multipliers), `rust-wasm/src/lib.rs` (lines 22-25: FBM parameters, line 170: `base_r = 1.2`, line 176: `noise_scale = 0.8`)
- Impact: Makes it difficult to tune performance, adjust visual output, or understand design decisions. Makes the system opaque and hard to configure.
- Fix approach: Extract constants to configuration objects with meaningful names and comments explaining their purpose.

**Global State in WASM Loader:**
- Issue: WASM module and NoiseField instances are stored as module-level globals.
- Files: `frontend/src/wasm-loader.js` (lines 7-8)
- Impact: Makes testing difficult, prevents multiple instances, creates tight coupling, and potential state pollution if module is loaded multiple times.
- Fix approach: Refactor to use a singleton pattern or module/class-based initialization, add state validation.

## Known Bugs

**TextureDrawn Flag Never Reset:**
- Issue: In `ParticleRenderer.sampleArtColor()`, the canvas texture is drawn once and cached, but `_textureDrawn` flag persists across texture updates.
- Files: `frontend/src/particle-renderer.js` (lines 175-181)
- Impact: If art texture is changed via `setArtTexture()`, the old texture data is still used because the flag prevents redrawing.
- Workaround: Currently none - texture switching won't work correctly.

**Array Bounds Check Logic Fragile:**
- Issue: In `generate_noise_atlas()`, bounds checking relies on manual index calculation that could silently fail.
- Files: `rust-wasm/src/lib.rs` (lines 115-120)
- Impact: If atlas configuration is changed, out-of-bounds writes could occur silently, corrupting texture data. No panic or error - data corruption happens quietly.
- Fix approach: Use safe index calculation, add validation of input parameters, or use Rust slices instead of manual indexing.

**Time Accumulation Without Bounds:**
- Issue: `time` field in NoiseField accumulates indefinitely via `update()` without normalization or wrapping.
- Files: `rust-wasm/src/lib.rs` (lines 35-36), `frontend/src/wasm-loader.js` (lines 43-46)
- Impact: After ~24 hours of continuous operation, floating-point precision loss causes animation artifacts. Very large time values could cause numerical instability in noise calculations.
- Fix approach: Implement time wrapping (e.g., `time %= LARGE_VALUE`) to keep values in a reasonable range.

**Canvas Element Lifetime Unmanaged:**
- Issue: `ParticleRenderer` creates a hidden canvas element but never disposes it.
- Files: `frontend/src/particle-renderer.js` (lines 213-218)
- Impact: Memory leak if multiple ParticleRenderer instances are created/destroyed. Canvas and its 2D context hold image data in memory.
- Fix approach: Add canvas cleanup in the `dispose()` method.

## Security Considerations

**No Input Validation on WASM Data:**
- Risk: Generated particle and atlas data from WASM is used directly without validation of dimensions or buffer sizes.
- Files: `frontend/src/particle-renderer.js` (lines 130-156), `frontend/src/wasm-loader.js` (line 111)
- Current mitigation: Data comes from trusted Rust/WASM code only
- Recommendations: Add runtime validation of returned array sizes, defensive checks before array indexing, or type safety through WebAssembly type system.

**YouTube Embed Without Sandbox Restrictions:**
- Risk: YouTube player is embedded with hardcoded video IDs but without explicit sandbox attributes or origin validation in fallback video loader.
- Files: `frontend/src/main.js` (lines 198-246), HTML (implied with youtube-player div)
- Current mitigation: Player uses YouTube's cross-origin protection, specific video IDs only
- Recommendations: Add explicit CSP (Content Security Policy) headers for YouTube domain, validate origin headers, consider using YouTube nocookie embed domain.

**Device Motion/Orientation Access:**
- Risk: Application requests device motion and orientation permissions but doesn't check if permissions were granted or validate the data before use.
- Files: `frontend/src/weather.js` (lines 56-75)
- Current mitigation: DeviceMotionEvent and DeviceOrientationEvent require user permission on modern browsers
- Recommendations: Check permission status before accessing sensor data, handle permission denial gracefully, validate accelerometer values before normalization.

**External Texture Loading Without Origin Validation:**
- Risk: `loadArtTexture()` and `loadSDTexture()` load images from URLs without verifying CORS or origin.
- Files: `frontend/src/main.js` (lines 114-133), `frontend/src/raymarcher.js` (lines 174-208)
- Current mitigation: URLs are hardcoded and relative (same origin)
- Recommendations: If dynamic URLs are added, implement origin validation, CORS checks, or content-type verification.

## Performance Bottlenecks

**Particle Color Sampling from Canvas on Every Frame:**
- Problem: In `ParticleRenderer.sampleArtColor()`, texture sampling uses `getImageData()` on a hidden canvas every frame for color lookup. This is very slow.
- Files: `frontend/src/particle-renderer.js` (lines 166-211)
- Cause: Reading pixel data from canvas forces a GPU→CPU round-trip and is inherently slow. Called once per particle per frame.
- Improvement path: Cache image data as typed array at initialization, use WebGL texture sampling instead of canvas pixel access, or pre-bake color lookup tables. Consider rendering colors directly in shader using texture coordinates.

**Floating-Point Texture Atlas Overhead:**
- Problem: Noise atlas is generated in Rust as Float32Array, creating very large texture (256x256x4 at 32-bit float = 1MB per atlas).
- Files: `rust-wasm/src/lib.rs` (lines 94-126), `frontend/src/raymarcher.js` (lines 95-107, 151-162)
- Cause: Full precision float textures not needed for visual purposes; Float16 or 8-bit compressed formats would reduce memory 50-75%.
- Improvement path: Switch to Float16 or compressed formats (R11F_G11F_B10F), implement texture compression in WASM, or use procedural noise in shader instead of pre-computed atlas.

**Smooth Interpolation in Weather Manager Runs Every Frame:**
- Problem: `WeatherManager.startSmoothUpdate()` runs via recursive `requestAnimationFrame` with no throttling or batching.
- Files: `frontend/src/weather.js` (lines 41-50)
- Cause: Simple lerp happens at full frame rate even when target values haven't changed. Creates unnecessary computation.
- Improvement path: Only update when target changes, batch lerp updates, or use CSS animations for the interpolation.

**Particle Update Bottleneck in Large Particle Counts:**
- Problem: With 15,000 particles, updating positions, colors, and sizes every frame on the CPU (JavaScript) before sending to GPU becomes expensive.
- Files: `frontend/src/particle-renderer.js` (lines 130-160)
- Cause: Full data transfer to GPU each frame, no GPU-resident updates, no compute shader offloading.
- Improvement path: Use compute shaders for particle updates, implement GPU-persistent buffers, or reduce update frequency and interpolate client-side.

**Atlas Grid Calculation Inefficient:**
- Problem: `generate_noise_atlas()` uses floating-point sqrt and modulo for grid layout calculation, done every generation.
- Files: `rust-wasm/src/lib.rs` (lines 95-96)
- Cause: Recalculates grid dimensions even though they depend only on `depth_slices` parameter.
- Improvement path: Pre-calculate grid dimensions, add memoization, or accept grid dimensions as parameters.

## Fragile Areas

**WASM/JavaScript Boundary Data Transfer:**
- Files: `frontend/src/wasm-loader.js`, `frontend/src/particle-renderer.js`, `rust-wasm/src/lib.rs`
- Why fragile: Data is passed as raw Float32Arrays across the WASM boundary. If array format or size expectations change, silent data corruption occurs.
- Safe modification: Create a protocol/schema for WASM→JS data exchange, add versioning, include metadata with returned data (size, format, version). Document expected array layouts clearly.
- Test coverage: No tests of WASM→JS data transfer format or bounds.

**Three.js Render Loop Integration:**
- Files: `frontend/src/main.js` (lines 345-384), `frontend/src/post-processing.js`
- Why fragile: Main animation loop manually orchestrates timing, state updates, and rendering without a clear separation of concerns or state machine.
- Safe modification: Clarify state update vs. render phases, add assertions for expected state, use a state machine pattern to prevent invalid state transitions.
- Test coverage: No unit tests of animation loop behavior or state transitions.

**Canvas Texture Image Caching:**
- Files: `frontend/src/particle-renderer.js` (lines 172-182)
- Why fragile: `_textureDrawn` flag and `_imageData` cache must stay synchronized with `artTexture`. No validation that data is still valid.
- Safe modification: Create a TextureCache class that encapsulates this state, add getters that validate cache validity, store texture reference alongside cache.
- Test coverage: No tests of texture switching or cache invalidation.

**Noise Parameter Constants Magic Values:**
- Files: `rust-wasm/src/lib.rs` (lines 22-25, 52-53, 166, 176-181, 194)
- Why fragile: FBM octaves, lacunarity, persistence, and scale values are hardcoded. Changing one without understanding others causes visual artifacts.
- Safe modification: Create a configuration struct `NoiseConfig` with parameter ranges and validation, document parameter relationships, add comments explaining visual effects.
- Test coverage: No parameterized tests of noise with different configurations.

## Scaling Limits

**Particle Count Hard Limit:**
- Current capacity: 15,000 particles in primary scene
- Limit: GPU memory (~30-50MB for position/color/size buffers) and CPU update time (<16ms per frame to maintain 60 FPS)
- Scaling path: Implement LOD (level-of-detail) rendering, use compute shaders for GPU-side updates, implement frustum culling, or use instancing with fewer draw calls.

**Atlas Texture Memory:**
- Current capacity: 256x256x4 float32 = 1MB per instance
- Limit: Browser texture memory budgets (varies by device, typically 1-4GB total for WebGL)
- Scaling path: Use compressed texture formats (BC, ETC, or WebP), reduce float precision (float16), implement streaming/lazy loading, or use procedural generation instead.

**Browser Animation Frame Rate:**
- Current capacity: 60 FPS on 60Hz displays
- Limit: Physics/computation time and rendering time must stay under 16ms
- Scaling path: Offload computation to Web Workers, use OffscreenCanvas, implement frame skipping, or reduce visual quality on slower devices.

**WASM Module Size:**
- Current capacity: Unknown (typical ~200-500KB for noise library + bindgen overhead)
- Limit: Initial load time and browser compilation time; limits deployment to browsers with WebAssembly support
- Scaling path: Tree-shake unused noise functions, use `wasm-opt` aggressively, implement lazy loading of WASM, or pre-compile for multiple targets.

## Dependencies at Risk

**Noise Crate (0.9):**
- Risk: Active development; breaking changes possible. Perlin noise implementation could be updated.
- Impact: If noise crate updates, particle generation behavior changes, potentially breaking artistic continuity.
- Migration plan: Pin exact version in Cargo.toml, test determinism across versions, or implement custom Perlin noise if stability is critical.

**Three.js Effects (0.160.0):**
- Risk: PostProcessing passes are from examples, not part of core Three.js API stability guarantees.
- Impact: UnrealBloomPass or ShaderPass could change or be removed in future Three.js versions.
- Migration plan: Implement custom bloom shader, test against next major Three.js version, or vendor the effect code locally.

**Vite Build System:**
- Risk: WASM plugin ecosystem is immature; build issues reported with different Vite versions.
- Impact: Build could break on dependency updates; `wasm-pack` output format changes could break build pipeline.
- Migration plan: Lock Vite and wasm-pack versions, add build CI/CD that catches incompatibilities, monitor vite-plugin-wasm issues.

## Missing Critical Features

**Error Recovery & User Feedback:**
- Problem: If WASM fails to load, user sees no indication. If rendering fails mid-experience, no error message appears.
- Blocks: Users can't tell if application is working correctly or degraded. No way to report problems.

**Performance Profiling:**
- Problem: No built-in performance metrics or profiling. Can't detect if application is dropping frames or why.
- Blocks: Optimization work is ad-hoc; can't identify actual bottlenecks. Mobile/low-end device performance unknown.

**Configuration/Customization UI:**
- Problem: No way to adjust bloom, particle count, animation speed, or other visual parameters at runtime.
- Blocks: Art direction changes require code modification; users can't personalize their experience.

**Accessibility:**
- Problem: No keyboard controls documented (some exist: 1, 2, r, m, space, arrows), no screen reader support, no high-contrast mode, no motion-reduced preferences.
- Blocks: Excluded users with visual, motor, or vestibular disabilities.

**State Persistence:**
- Problem: No persistence of user settings, session state, or preferences across page reloads.
- Blocks: Each reload starts fresh; users lose custom configurations.

## Test Coverage Gaps

**WASM Module Initialization:**
- What's not tested: WASM load success/failure paths, multiple initialization attempts, initialization with different seed values
- Files: `frontend/src/wasm-loader.js`
- Risk: WASM fallback doesn't work correctly; re-initialization could fail silently
- Priority: High

**Particle Generation Determinism:**
- What's not tested: Generated particles have expected ranges, seeded generation produces same output for same seed, particle data format consistency
- Files: `rust-wasm/src/lib.rs` (lines 157-210), `frontend/src/wasm-loader.js` (line 107)
- Risk: Particle bounds could be violated; platform differences could cause divergent behavior
- Priority: High

**Noise Atlas Generation:**
- What's not tested: Atlas dimensions calculation, texture data bounds, atlas grid layout with various slice counts
- Files: `rust-wasm/src/lib.rs` (lines 94-126)
- Risk: Out-of-bounds writes, incorrect UV mapping, data corruption silent
- Priority: High

**Weather Data Generation & Smoothing:**
- What's not tested: Deterministic pseudo-random output, lerp smoothing correctness, bounds checking (temp/humidity/wind stay in range), sensor data validation
- Files: `frontend/src/weather.js` (lines 85-153)
- Risk: Invalid parameters sent to shader; animation stutters; sensor access crashes on permission denied
- Priority: Medium

**Post-Processing Chain:**
- What's not tested: Bloom pass effect, chromatic aberration correctness, parameter updates, resize handling, effect composition
- Files: `frontend/src/post-processing.js`
- Risk: Visual effects don't render; parameter changes ineffective; memory leaks from uncleared passes
- Priority: Medium

**Texture Loading & Caching:**
- What's not tested: Fallback when texture missing, texture resampling quality, canvas cache invalidation, color conversion accuracy
- Files: `frontend/src/particle-renderer.js` (lines 114-211)
- Risk: Missing textures cause silent failures; color sampling inaccurate; cache pollution
- Priority: Medium

---

*Concerns audit: 2026-01-25*
