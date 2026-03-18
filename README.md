# Space Journey

A cinematic, first-person flight through infinite procedurally generated space — built to unwind.

I made this because I love music and space. There's something about drifting through the cosmos with ambient sound that just quiets everything down. So I vibe-coded this over a few sessions as a way to relax, explore Rust/WASM in the browser, and make something that feels good to look at.

**[Live Demo →](https://ritvij-saxena.github.io/space-journey/)**

---

## What it is

An infinite, looping space flight. The camera glides on auto-pilot, curving toward whatever looks interesting — black holes, nebulae, binary stars, asteroid belts, wormholes. Ambient music plays underneath. You just watch.

Every object is procedurally generated. No two journeys are the same.

## Space objects

| Object | Notes |
|--------|-------|
| Star systems | HR diagram spectral classes, Keplerian orbiting planets |
| Binary stars | Two stars orbiting a barycenter with circumbinary planets |
| Nebulae | Particle emission clouds |
| Interstellar clouds | Dark molecular clouds |
| Black holes | Opaque shadow, Doppler-shifted accretion disk, gravitational lensing arc |
| Wormholes | Vortex particle physics |
| Asteroid fields | Real-time n-body Kepler simulation |
| Neutron stars / pulsars | Rotating beam cone, X-ray jets |

## Controls

| Key | Action |
|-----|--------|
| Space | Play / Pause music |
| M | Mute / Unmute |
| ↑ / ↓ | Volume |
| 1 / 2 | Bloom strength — controls how much bright objects (stars, nebulae, accretion disks) bleed light into the surrounding area, like a long-exposure astrophotograph |

## How it's built

- **Rust → WASM** — particle physics (Verlet integration, curl noise, spring forces), Keplerian orbital mechanics, n-body asteroid simulation, procedural space scene generators
- **Three.js** — custom ShaderMaterials for every celestial body type, AdditiveBlending particle renderer, bloom + afterimage + chromatic aberration + gravitational lensing post-processing
- **Vite** — dev server, WASM bundling

## Run locally

```bash
# 1. Build WASM
cd rust-wasm
wasm-pack build --target web --release

# 2. Start frontend
cd ../frontend
npm install
npm run dev
```

Open `http://localhost:3000` → click **Begin Journey**.

## License

MIT
