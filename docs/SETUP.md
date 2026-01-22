# Setup Guide

## Prerequisites

- Rust 1.70+ with `wasm32-unknown-unknown` target
- Node.js 18+
- Google Colab account
- Git

## Step 1: Setup Rust WASM

```bash
# Install wasm-pack
curl https://rustwasm.org/wasm-pack/installer/init.sh -sSf | sh

# Navigate to rust-wasm directory
cd rust-wasm

# Build WASM module
wasm-pack build --target web

# This creates pkg/ directory with compiled WASM
```

## Step 2: Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:3000`

## Step 3: Generate Art via Google Colab

1. Go to [Google Colab](https://colab.research.google.com)
2. Upload `colab-notebooks/unsupervised-generation.ipynb`
3. Install dependencies:
```python
!pip install diffusers transformers torch pillow
!huggingface-cli login  # Add your HuggingFace token
```

4. Run generation cells
5. Download generated images

## Step 4: Setup Weather Integration

1. Get a free API key from [Open-Meteo](https://open-meteo.com) (no key needed!)
2. Or use [OpenWeatherMap](https://openweathermap.org) if you prefer

## Step 5: Deploy to GitHub Pages

1. Push code to GitHub
2. Enable GitHub Pages in repository settings
3. Set source to `gh-pages` branch
4. GitHub Actions will automatically build and deploy

## Configuration

### Weather API
Edit `frontend/src/weather.js`:
```javascript
this.apiKey = 'YOUR_API_KEY'; // Optional for Open-Meteo
```

### Image Generation Parameters
Edit `colab-notebooks/unsupervised-generation.ipynb`:
- Model: `stabilityai/stable-diffusion-2`
- Steps: 50 (higher = better quality, slower)
- Guidance scale: 7.5 (higher = more text-adherence)

## Building for Production

```bash
# Build Rust WASM
cd rust-wasm && wasm-pack build --target web --release

# Build frontend
cd ../frontend && npm run build

# Deploy frontend/dist to your server
```

## Troubleshooting

**WASM module not loading:**
- Ensure `wasm-pack` is installed: `wasm-pack --version`
- Check browser console for CORS errors
- Verify `pkg/` directory exists in `rust-wasm/`

**Weather data not updating:**
- Check Open-Meteo API status
- Ensure browser geolocation is enabled
- Check browser console for errors

**Slow generation in Colab:**
- Ensure T4/P100 GPU is selected
- Reduce image resolution to 512x512
- Use smaller model: `stabilityai/stable-diffusion-2-base`
