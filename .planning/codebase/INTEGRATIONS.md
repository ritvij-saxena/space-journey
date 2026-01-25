# External Integrations

**Analysis Date:** 2026-01-25

## APIs & External Services

**Audio/Media:**
- YouTube IFrame API - Embedded audio playback for soundtrack
  - Implementation: Script injection (`https://www.youtube.com/iframe_api`)
  - Client: YT.Player API called from `frontend/src/main.js`
  - Auth: None (public videos)
  - Purpose: Play ambient music during visualization
  - Video IDs hardcoded in `main.js` (lines 199-202):
    - "UfcAVejslrU" - Marconi Union - Weightless
    - "jfKfPfyJRdk" - lofi beats
    - "lE6RYpe9IT0" - Relaxing ambient

## Data Storage

**Databases:**
- None - This is a client-side only application

**File Storage:**
- Local filesystem only (static assets)
  - Textures: `frontend/textures/sd_atlas.png` (SD-generated texture atlas for art overlay)
  - Built artifacts: `frontend/dist/` directory

**In-Memory State:**
- NoiseField instance (Rust/WASM) - Procedural noise state for particle animation
  - Seeded at runtime from session
  - Persists across frames for temporal coherence
  - Location: `frontend/src/wasm-loader.js` (global variable `noiseField`)

**Caching:**
- Browser HTTP cache for static assets (Vite-configured asset hashing)
- No explicit API caching (no server calls)

## Authentication & Identity

**Auth Provider:**
- None - No user authentication required
- No login system implemented
- Public/anonymous experience

## Monitoring & Observability

**Error Tracking:**
- None - No error tracking service integrated

**Logs:**
- Browser console logging only
  - `console.log()` calls in:
    - `frontend/src/main.js` - Initialization and control flow
    - `frontend/src/wasm-loader.js` - WASM module loading
    - `rust-wasm/src/lib.rs` - Rust/WASM startup (line 18: `console::log_1()`)
  - Error logs via `console.error()` and `console.warn()`
  - No persistent log storage

## Weather & Environmental Data

**Weather Integration:**
- No external weather API used
- Fully synthetic environmental simulation in `frontend/src/weather.js`:
  - Time-based patterns (hour, minute, second, day of year)
  - Device motion/orientation sensors (if available on mobile)
  - Deterministic pseudo-randomization seeded by user session
  - Screen properties (width, height, devicePixelRatio) for per-device variation
  - Output: Temperature, humidity, wind speed values fed to visualization

**Data Flow:**
- `WeatherManager.getCurrentWeather()` returns local state
- Passed to WASM via `wasm-loader.js` `getVisualParams(weather)` (line 72)
- WASM method `weather_to_params()` normalizes values for shaders (rust-wasm/src/lib.rs lines 139-153)

## CI/CD & Deployment

**Hosting:**
- Static file hosting (GitHub Pages, Netlify, Vercel, etc.)
- No server infrastructure required
- Built output directory: `frontend/dist/`

**CI Pipeline:**
- Not detected (no GitHub Actions, GitLab CI, Travis CI config found)
- Manual build required: `npm run build:all`

## Environment Configuration

**Required environment variables:**
- None detected - Application runs without environment configuration

**Optional environment variables:**
- `.env` file support exists in `.gitignore` but no `.env*` files present
- No dotenv loader imported in source code
- Configuration is hardcoded (e.g., particle count, port, base path in vite.config.js)

**Secrets location:**
- No secrets management - No API keys, passwords, or credentials in codebase
- YouTube videos are public (no authentication required)
- Safe to commit entire repository

## Webhooks & Callbacks

**Incoming:**
- None - Client-side only application

**Outgoing:**
- None - No HTTP requests to external services
- Application is fully client-side with no backend communication

## Texture & Asset Loading

**Remote Assets:**
- YouTube video thumbnails/metadata loaded via YouTube IFrame API (implicit)
- SD-generated texture atlas: `/textures/sd_atlas.png` (optional, runtime)
  - Loaded via Three.js TextureLoader (main.js lines 114-133)
  - Missing texture gracefully handled - falls back to procedural colors

## Third-Party Services Summary

**Count of external dependencies:** 1 (YouTube for audio only)

**Architecture:**
- Completely client-side rendering
- Zero backend API calls
- Offline-capable except for YouTube audio playback
- All computation happens in browser (JavaScript + WASM)

---

*Integration audit: 2026-01-25*
