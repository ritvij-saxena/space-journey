# Unsupervised: Generative Art Installation

A generative AI art installation inspired by Refik Anadol's "Unsupervised" at MoMa. This project uses machine learning to create continuously evolving visual compositions, influenced by real-time weather data.

## Architecture

- **Rust WASM**: Image processing, noise generation, and compute-intensive operations
- **JavaScript Frontend**: Real-time visualization with Three.js and weather integration
- **Python/Google Colab**: Model training and image generation
- **GitHub Pages**: Static deployment

## Project Structure

```
.
├── rust-wasm/              # Rust WASM module for processing
├── frontend/               # JavaScript + HTML frontend
│   ├── src/               # JS source files
│   └── assets/            # Images, styles
├── colab-notebooks/        # Google Colab notebooks
├── docs/                   # Documentation & deployment
└── README.md
```

## Quick Start

### 1. Setup Rust WASM

```bash
cd rust-wasm
wasm-pack build --target web
```

### 2. Setup Frontend

```bash
cd frontend
npm install
npm run dev
```

### 3. Generate Art via Google Colab

- Open `colab-notebooks/unsupervised-generation.ipynb`
- Follow instructions to generate images
- Export results to `frontend/assets/generated/`

## External Factors

**Procedural Randomization** (No API keys required!): The system generates environmental factors using:

- **Time-based patterns**: Hour/day/season cycles create natural variations
- **Device motion sensors**: Accelerometer/gyroscope data (if available) adds user interaction
- **Deterministic randomization**: Seeded pseudo-random functions for reproducible yet varied output
- **Screen properties**: Display characteristics create unique patterns per viewer

These factors map to visual parameters:

- Temperature → Color palette (blue to red)
- Humidity → Particle density (sparse to dense)
- Wind speed → Animation speed (calm to turbulent)
- Overall intensity → Complexity scaling

## Technologies

- **Rust**: WASM compilation, performance-critical code
- **WebAssembly**: Browser-based computation
- **Three.js**: 3D visualization
- **Stable Diffusion**: Image generation
- **JavaScript**: Procedural environmental generation (no external APIs)
- **GitHub Pages**: Static deployment

## License

MIT

## References

- [Unsupervised by Refik Anadol](https://www.moma.org/)
- [Stable Diffusion](https://huggingface.co/stabilityai/stable-diffusion-2)
