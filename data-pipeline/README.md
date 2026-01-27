# Data Pipeline

Transforms art images into 3D particle target coordinates for the visualization.

**Input:** Art images (JPG, PNG, WebP)
**Output:** Binary data file with 3D positions and colors (`output/art_states.bin`)

This pipeline uses CLIP for semantic feature extraction and UMAP for dimensionality reduction to 3D space, creating target coordinates for particles to flow between different art states.

See the [main project README](../README.md) for the full visualization context.

## Prerequisites

- **Python 3.9+** required
- **pip** package manager
- **~2GB disk space** for ML models (CLIP weights)
- **Optional:** GPU for faster processing (CPU works fine for 5-10 images)

## Installation

```bash
cd data-pipeline
pip install -r requirements.txt
```

On first run, the CLIP model (~350MB) will be automatically downloaded from HuggingFace.

## Quick Start

```bash
# 1. Add your art images
cp /path/to/your/art/*.jpg input/

# 2. Run the pipeline
python scripts/process_art.py

# 3. Output is in output/art_states.bin
```

## Adding New Art Images

The pipeline is designed to work with your own art collection. Here's how to add new images:

### Supported Formats

- `.jpg`, `.jpeg`, `.png`, `.webp` (case insensitive)

### Image Recommendations

- **Size:** 512x512 or larger for best feature extraction
- **Count:** 5-10 images optimal (UMAP manifold learning works best in this range)
- **Quality:** High-resolution images produce better color extraction
- **Diversity:** More visually distinct images create better morphing transitions

### Adding Process

1. **Place images in the `input/` directory:**
   ```bash
   cp ~/Downloads/my-art/*.jpg input/
   ```

2. **Images are processed alphabetically** - naming affects the order in the visualization:
   ```bash
   # Example naming for intentional ordering:
   01-starry-night.jpg
   02-mona-lisa.jpg
   03-the-scream.jpg
   ```

3. **Re-run the pipeline:**
   ```bash
   python scripts/process_art.py
   ```

4. **The output file `output/art_states.bin` is regenerated** with the new art states

### What Happens During Processing

For each image:
1. **CLIP extraction:** Creates a 512-dimensional semantic embedding
2. **UMAP reduction:** Projects embeddings into 3D space (normalized to [-1, 1])
3. **Color extraction:** K-means clustering finds dominant colors
4. **Binary export:** Writes positions and colors in WASM-friendly format

## Configuration Reference

Edit `config.yaml` to customize processing:

```yaml
# Input/Output
input_dir: "input"           # Where to find art images
output_dir: "output"         # Where to write binary output
output_file: "art_states.bin" # Output filename

# CLIP model settings
clip_model: "openai/clip-vit-base-patch32"  # HuggingFace model ID

# UMAP settings
umap:
  n_components: 3            # Always 3 for visualization (x, y, z)
  n_neighbors: 15            # Locality of manifold (higher = more global structure)
  min_dist: 0.1              # Minimum distance between points (higher = more spread)
  random_state: 42           # Seed for reproducibility

# Color extraction
colors:
  n_colors: 5                # Dominant colors per image (4-8 recommended)
  random_state: 42           # Seed for reproducibility

# Binary format
binary:
  version: 1                 # Format version for forward compatibility
  endian: "little"           # WebAssembly native endianness
```

### UMAP Parameter Effects

- **n_neighbors (default: 15)**
  - **Lower (3-5):** Emphasizes local structure, tighter clusters
  - **Higher (15-30):** Emphasizes global structure, broader patterns
  - **Adaptive:** Automatically reduced if fewer than 2×n_neighbors images

- **min_dist (default: 0.1)**
  - **Lower (0.0-0.1):** Points can be closer, denser clusters
  - **Higher (0.2-0.5):** Points more spread out, looser arrangement
  - **Affects visual flow:** Lower values create tighter transitions

### Color Parameter Effects

- **n_colors (default: 5)**
  - **Lower (3-4):** Simpler color palettes, faster K-means
  - **Higher (6-8):** More nuanced palettes, slower processing
  - **Diminishing returns:** Beyond 8 colors adds little visual value

## Binary Format Specification

The output file `output/art_states.bin` uses a compact binary format optimized for WebAssembly parsing.

### Header (16 bytes)

```
Offset | Type | Field            | Description
-------|------|------------------|----------------------------------
0      | i32  | version          | Format version (currently 1)
4      | i32  | num_states       | Number of art states
8      | i32  | points_per_state | 3D points per state (currently 1)
12     | i32  | colors_per_state | Colors per state (from config)
```

### Positions Section

```
Offset: 16 bytes from start
Size: num_states × points_per_state × 3 × 4 bytes
Format: f32 (little-endian) for each x, y, z coordinate
Range: [-1.0, 1.0] (normalized)

Layout:
[x0, y0, z0, x1, y1, z1, ..., xN, yN, zN]
```

### Colors Section

```
Offset: 16 + (num_states × points_per_state × 3 × 4) bytes
Size: num_states × colors_per_state × 3 × 4 bytes
Format: f32 (little-endian) for each r, g, b value
Range: [0.0, 1.0] (normalized)

Layout:
[r0_c0, g0_c0, b0_c0, r0_c1, g0_c1, b0_c1, ...]
```

### Example Parsing (Rust)

```rust
use std::io::Read;

struct Header {
    version: i32,
    num_states: i32,
    points_per_state: i32,
    colors_per_state: i32,
}

fn parse_header(data: &[u8]) -> Header {
    Header {
        version: i32::from_le_bytes(data[0..4].try_into().unwrap()),
        num_states: i32::from_le_bytes(data[4..8].try_into().unwrap()),
        points_per_state: i32::from_le_bytes(data[8..12].try_into().unwrap()),
        colors_per_state: i32::from_le_bytes(data[12..16].try_into().unwrap()),
    }
}
```

## Troubleshooting

### "No images found in input"

**Cause:** No supported image files in the input directory

**Solutions:**
- Check that images are in `data-pipeline/input/` (not a subdirectory)
- Verify file extensions: `.jpg`, `.jpeg`, `.png`, `.webp`
- Check file permissions (readable)

### "CUDA out of memory"

**Cause:** GPU doesn't have enough memory for CLIP model

**Solutions:**
- Force CPU mode: `CUDA_VISIBLE_DEVICES="" python scripts/process_art.py`
- Use a smaller batch size (process fewer images)
- Close other GPU-intensive applications

### "UMAP convergence warning"

**Cause:** UMAP having difficulty finding manifold structure

**Solutions:**
- Try fewer images (< 10 works best)
- Reduce `n_neighbors` in config (try 5-10)
- Increase `min_dist` (try 0.2-0.3)
- Ensure images are visually distinct

### "ImportError: No module named 'transformers'"

**Cause:** Dependencies not installed or virtual environment not activated

**Solutions:**
- Reinstall: `pip install -r requirements.txt`
- Upgrade: `pip install transformers torch --upgrade`
- Verify Python version: `python --version` (must be 3.9+)

### "Output file too small or corrupt"

**Cause:** Pipeline failed partway through or images corrupted

**Solutions:**
- Check all images open correctly: `python -c "from PIL import Image; Image.open('input/test.jpg')"`
- Delete output and re-run: `rm output/art_states.bin && python scripts/process_art.py`
- Check terminal output for errors during processing
- Try with just 1-2 images to isolate the problem

### Pipeline runs but visualization doesn't update

**Cause:** Binary file not copied to visualization assets

**Solutions:**
- Copy to Rust project: `cp output/art_states.bin ../assets/art_states.bin`
- Verify file size matches: `ls -lh output/art_states.bin`
- Check binary format version matches Rust parser

## Development Notes

### Why CLIP Instead of ResNet?

CLIP embeddings capture semantic similarity (artistic style, subject matter) rather than just pixel-level features. This creates more meaningful transitions between art states in the visualization.

### How UMAP Parameters Affect Visualization

- **n_neighbors:** Controls how "liquid" the transitions feel. Higher values create smoother, more gradual morphing.
- **min_dist:** Controls particle spread. Lower values create tighter, more defined shapes.
- **random_state:** Ensures reproducible results. Change this to try different 3D arrangements.

### Memory Requirements

For 10 images:
- CLIP model: ~350MB (one-time download)
- Feature extraction: ~100MB peak RAM
- UMAP processing: ~500MB peak RAM
- Total: ~2GB recommended

### Visualizing Intermediate Results

To inspect 3D coordinates before binary export:

```python
# Add after reduce_to_3d() in process_art.py
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D

fig = plt.figure()
ax = fig.add_subplot(111, projection='3d')
ax.scatter(coords_3d[:, 0], coords_3d[:, 1], coords_3d[:, 2])
plt.show()
```

### Extending the Pipeline

Common modifications:

1. **More points per state:** Modify `points_per_state` in `export_binary()` to create multiple seed points
2. **Custom embeddings:** Replace CLIP with another model (ResNet, DINO, etc.)
3. **Alternative dimensionality reduction:** Try t-SNE instead of UMAP (though UMAP is faster)
4. **Dynamic color schemes:** Extract colors based on image regions instead of K-means

## Pipeline Performance

**Typical processing time (5 images, CPU):**
- CLIP feature extraction: ~30 seconds
- UMAP dimensionality reduction: ~10 seconds
- Color extraction: ~15 seconds
- Total: ~1 minute

**With GPU:** ~10-15 seconds total

## Next Steps

After running the pipeline:
1. Copy `output/art_states.bin` to the Rust project's assets directory
2. Run the visualization to see particles morph between your art states
3. Experiment with different config values to tune the visual effect
4. Add more images for richer transitions
