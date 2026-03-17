# Setup Guide

## Prerequisites

- Rust 1.70+ with `wasm32-unknown-unknown` target
- Node.js 18+
- `wasm-pack`

```bash
# Install wasm-pack
curl https://rustwasm.org/wasm-pack/installer/init.sh -sSf | sh
```

## Step 1: Build Rust WASM

```bash
cd rust-wasm
wasm-pack build --target web --release
# Creates rust-wasm/pkg/ with compiled WASM + JS bindings
```

## Step 2: Run Frontend

```bash
cd frontend
npm install
npm run dev
# http://localhost:3000
```

## Step 3: Deploy to GitHub Pages

1. Push code to GitHub
2. Enable GitHub Pages → Settings → Pages → Source: `gh-pages`
3. GitHub Actions builds and deploys on every push to `main`

## Production Build

```bash
cd rust-wasm && wasm-pack build --target web --release
cd ../frontend && npm run build
# Deployable output in frontend/dist/
```

## Troubleshooting

**WASM not loading:**
- Ensure `rust-wasm/pkg/` exists after `wasm-pack build`
- Check browser console for CORS errors

**Build fails:**
- Verify `wasm32-unknown-unknown` target is installed: `rustup target add wasm32-unknown-unknown`
- Check `cargo build` compiles without errors first
