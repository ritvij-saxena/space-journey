# Deployment to GitHub Pages

## Prerequisites

1. Create a GitHub repository
2. Enable GitHub Pages in repository settings
3. Set source to `gh-pages` branch

## GitHub Actions Workflow

The `.github/workflows/deploy.yml` file automatically:

1. Installs Rust and wasm-pack
2. Builds the Rust WASM module
3. Installs Node.js dependencies
4. Builds the frontend
5. Deploys to GitHub Pages

## Steps

### 1. Initialize Git Repository

```bash
cd /Users/ritvijsaxena/Documents/coding_projects/rust_projects/unsupervised_moma_replica
git init
git add .
git commit -m "Initial commit: Unsupervised generative art installation"
```

### 2. Add Remote Repository

```bash
git remote add origin https://github.com/YOUR_USERNAME/unsupervised_moma_replica.git
git branch -M main
git push -u origin main
```

### 3. Enable GitHub Pages

1. Go to your repository on GitHub
2. Click Settings → Pages
3. Select Source: `Deploy from a branch`
4. Select Branch: `gh-pages`
5. Save

### 4. Push and Deploy

The GitHub Actions workflow will automatically:

- Run on every push to `main`
- Build WASM and frontend
- Deploy to GitHub Pages

Check the "Actions" tab to see build progress.

## Configuration

**No API keys needed!** The system uses procedural randomization exclusively.

However, you can optionally enable browser features:

1. **Device motion sensors** (optional): Ask for permission to use accelerometer/gyroscope
2. **Geolocation** (optional): For location-aware future expansions

Both are disabled by default and completely optional.

## Custom Domain

To use a custom domain:

1. Add `CNAME` file to repository root:

```
yourdomain.com
```

2. Configure DNS settings with your registrar:

```
CNAME yourdomain.com github.io
```

3. Update GitHub Pages settings to use custom domain

## Troubleshooting

**Build fails in Actions:**

- Check Actions logs for errors
- Verify Cargo.toml syntax
- Ensure all dependencies are correct

**Site not updating:**

- Clear browser cache (Cmd+Shift+R)
- Check that `gh-pages` branch is created
- Verify Actions workflow completed successfully

**WASM not loading:**

- Check browser console for CORS errors
- Verify WASM files are in `pkg/` after build
- Ensure correct URL paths

**Environmental factors not changing:**

- Check console for any errors
- Refresh page to reset factors
- Verify JavaScript is enabled
- Check that time is updating on your device

## Local Testing Before Deploy

```bash
# Build everything locally
cd rust-wasm && wasm-pack build --target web --release
cd ../frontend && npm run build

# Test build locally
npx serve dist
```

Then visit `http://localhost:3000` to verify everything works.
