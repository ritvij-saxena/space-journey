# Deployment to GitHub Pages

## GitHub Actions Workflow

The `.github/workflows/deploy.yml` file automatically:

1. Installs Rust and wasm-pack
2. Builds the Rust WASM module (`wasm-pack build --target web --release`)
3. Installs Node.js dependencies
4. Builds the frontend (`npm run build`)
5. Deploys to GitHub Pages

## Steps

### 1. Initialize Repository

```bash
git init
git add .
git commit -m "Initial commit: Space Journey"
```

### 2. Add Remote and Push

```bash
git remote add origin https://github.com/YOUR_USERNAME/space-journey.git
git branch -M main
git push -u origin main
```

### 3. Enable GitHub Pages

1. Go to your repository on GitHub
2. Settings → Pages
3. Source: `Deploy from a branch`
4. Branch: `gh-pages`
5. Save

The Actions workflow will build and deploy on every push to `main`.

## Local Production Test

```bash
cd rust-wasm && wasm-pack build --target web --release
cd ../frontend && npm run build
npx serve dist
# Visit http://localhost:3000
```

## Troubleshooting

**Build fails in Actions:**
- Check Actions logs
- Verify Cargo.toml syntax
- Ensure all dependencies resolve

**Site not updating:**
- Clear browser cache (Cmd+Shift+R)
- Verify the `gh-pages` branch was created
- Check the Actions workflow completed

**WASM not loading:**
- Check browser console for CORS errors
- Verify WASM files are in `pkg/` after build
