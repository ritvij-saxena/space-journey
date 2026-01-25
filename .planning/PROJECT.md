# Unsupervised Tribute

## What This Is

A web-based tribute to Refik Anadol's "Unsupervised" installation at MoMA — fluid particles that coalesce into art forms, dissolve, and reform into new shapes. Built with Rust WASM for physics and Three.js for rendering, deployable to static GitHub Pages.

## Core Value

Particles visibly flow between art forms with liquid motion — the signature "data pigments" aesthetic where 3D coordinates from art become a living, breathing sculpture.

## Requirements

### Validated

<!-- Shipped and confirmed working -->

- ✓ Rust WASM + Three.js pipeline with wasm-bindgen — existing
- ✓ Particle rendering (15K particles) via BufferGeometry — existing
- ✓ Post-processing effects (UnrealBloomPass, chromatic aberration) — existing
- ✓ Procedural noise generation (Perlin/FBM) in Rust — existing
- ✓ Weather-influenced visual parameters (temperature, humidity, wind) — existing
- ✓ YouTube ambient audio integration — existing
- ✓ GitHub Pages deployment (static, no backend) — existing
- ✓ JavaScript fallback if WASM fails — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Python preprocessing pipeline: extract features from art images → UMAP to 3D coordinates → export as JSON/binary
- [ ] Multiple art states: 5-10 pre-computed target positions representing different "artworks"
- [ ] Fluid particle dynamics in Rust: curl noise for organic flow + elastic tether pulling particles toward targets
- [ ] State morphing: smooth interpolation between art states (the "coalesce → dissolve → reform" cycle)
- [ ] Afterimage trails: AfterimagePass or similar for the "liquid silk" trailing effect
- [ ] Performance optimization: maximize particle count while maintaining 60fps
- [ ] Documented Python pipeline for adding more art to the dataset

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Real-time AI/StyleGAN generation — requires GPU server, incompatible with static hosting
- External weather APIs — staying fully client-side for offline capability
- Mobile app — web-first, responsive design sufficient
- VR/AR mode — out of scope for v1, possible future enhancement

## Context

**Existing codebase state:**
- Rust WASM generates particle positions using FBM noise
- Three.js renders 15K particles with custom shaders
- Post-processing chain: RenderPass → UnrealBloomPass → ChromaticAberrationShaderPass
- Weather parameters influence colors/movement but are procedurally generated (no external API)
- Currently renders as "white blob with rotating waveform" — not the Unsupervised aesthetic

**The gap:**
Current particles move with procedural noise but have no "target" — they don't form recognizable shapes. The Unsupervised effect requires particles to:
1. Flow toward target positions (forming art)
2. Hold briefly in formation
3. Dissolve with fluid motion
4. Reform into new art state

**Reference implementation (from PLAN.md):**
- Offline: Python extracts features (ResNet/CLIP), reduces to 3D via UMAP, saves coordinates
- Runtime: Rust loads targets, applies curl noise + elastic tether, particles flow between states
- Post-processing: AfterimagePass for trails, UnrealBloomPass for glow

## Constraints

- **Hosting**: Static GitHub Pages only — no server-side computation
- **Performance**: Must maintain 60fps on modern browsers
- **Stack**: Rust WASM + Three.js (existing architecture, don't rebuild)
- **Offline**: All computation client-side, no external API calls at runtime
- **Dataset**: User has art images available for preprocessing

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pre-computed art states (not real-time AI) | Static hosting constraint, browser can't run StyleGAN | — Pending |
| 5-10 art states with morphing | Balance between variety and data size | — Pending |
| Curl noise + elastic tether | Organic flow while maintaining shape coherence | — Pending |
| Keep weather influence | Matches original MoMA installation behavior | — Pending |
| Keep YouTube audio | Enhances meditative experience | — Pending |

---
*Last updated: 2026-01-25 after initialization*
