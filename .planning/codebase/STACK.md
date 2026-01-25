# Technology Stack

**Analysis Date:** 2026-01-25

## Languages

**Primary:**
- Rust 2021 edition - High-performance computation in WASM modules (`rust-wasm/`)
- JavaScript (ES6+) - Frontend application code (`frontend/src/`)

**Secondary:**
- GLSL - WebGL shader code for rendering and post-processing
- HTML5 - Markup structure in `frontend/index.html`
- CSS3 - Styling in `frontend/src/styles.css`

## Runtime

**Environment:**
- Node.js - Frontend development and builds
- Browser runtime - WebGL/WebAssembly execution (Chrome, Firefox, Safari, Edge)
- WASM target: wasm32-unknown-unknown

**Package Manager:**
- npm 10+ (inferred from package-lock.json presence in frontend)
- Cargo (Rust package manager for `rust-wasm/`)
- Lockfiles: `frontend/package-lock.json`, `rust-wasm/Cargo.lock`

## Frameworks

**Core:**
- Three.js 0.160.0 - 3D graphics library for particle rendering and scene management
- Vite 5.0.0 - Frontend build tool and dev server
- wasm-pack - Rust-to-WASM bundler (invoked via `npm run wasm:build`)

**WASM/Compute:**
- wasm-bindgen 0.2 - JavaScript/Rust FFI binding generation
- web-sys 0.3 - Browser API bindings (Canvas, ImageData, Window, Document, console)
- js-sys 0.3 - JavaScript interop layer

**Testing:**
- Not detected

**Build/Dev:**
- Vite plugins:
  - vite-plugin-wasm 3.3.0 - WASM loading and bundling
  - vite-plugin-glsl 1.3.0 - GLSL shader compilation
  - vite-plugin-top-level-await 1.4.1 - Top-level await support
  - @vitejs/plugin-basic-ssl 1.0.1 - HTTPS support for dev server
- Terser 5.46.0 - JavaScript minification
- @rollup/pluginutils 5.3.0 - Rollup utility functions

## Key Dependencies

**Critical:**
- three 0.160.0 - Required for all 3D rendering, particle visualization, camera, scene management
- wasm-bindgen 0.2 - Essential for Rust-JavaScript boundary and type marshaling
- vite 5.0.0 - Build system for bundling Rust WASM with JavaScript frontend

**Algorithms & Utilities:**
- noise 0.9.0 - Perlin and Fractional Brownian Motion (FBM) noise generation in Rust for procedural particle animation
- rand 0.8 - Random number generation for noise seeding and fallback JS calculations
- getrandom 0.2 (with "js" feature) - WASM-compatible RNG initialization

**Serialization:**
- serde 1.0 (with "derive" feature) - Serialization/deserialization framework
- serde-wasm-bindgen 0.4 - Rust-side serialization for passing complex types to JavaScript

**Infrastructure (transitive):**
- futures-util 0.3.31 - Async utilities used by wasm-bindgen-futures
- wasm-bindgen-futures 0.4 - Promise/async bridging between Rust and JavaScript
- bumpalo 3.19.1 - Memory allocation for WASM
- once_cell 1.21.3 - Lazy static initialization (used by js-sys)

## Configuration

**Environment:**
- No required environment variables detected for runtime operation
- Optional: Texture assets expected at `/textures/sd_atlas.png` for art texture overlay
- YouTube API key: Embedded via script tag (`https://www.youtube.com/iframe_api`), no explicit key required (uses embedded player)

**Build:**
- `vite.config.js` - Entry point for build configuration
  - WASM alias: Points to `../rust-wasm/pkg` for module resolution
  - Base path: Dynamically set for GitHub Pages deployment (`/unsupervised_moma_replica/`)
  - Port: 3000 (dev server)
  - Asset inlining: Disabled for WASM files (line 47)
  - Output minifier: Terser with esnext target
- `rust-wasm/Cargo.toml` - Rust library configuration
  - crate-type: `cdylib` (dynamic library/WASM)
  - Profile: Release mode with LTO enabled, optimization level "z" (size)

## Platform Requirements

**Development:**
- Node.js 16+ (for npm/Vite)
- Rust toolchain (rustc, cargo)
- wasm-pack tool (`npm run wasm:build` requires it)
- macOS/Linux/Windows development environment

**Production:**
- Modern browser with WebGL 2.0 support
- WebAssembly (WASM) support
- JavaScript ES2015+ support
- No backend server required (client-side rendering only)

**Browser Compatibility:**
- Chrome/Chromium 51+
- Firefox 52+
- Safari 11+
- Edge 16+

## Deployment

**Hosting:**
- Static file hosting (GitHub Pages, Netlify, Vercel, S3, etc.)
- Built output: `frontend/dist/` directory
- Entry file: `dist/index.html`

**Build Process:**
- Two-stage build defined in `frontend/package.json`:
  1. `npm run wasm:build` - Builds Rust to WASM via wasm-pack
  2. `npm run build` - Vite bundles JavaScript and WASM together
  - Combined: `npm run build:all` runs both sequentially

---

*Stack analysis: 2026-01-25*
