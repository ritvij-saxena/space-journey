#!/usr/bin/env python3
"""
Art States Data Pipeline

Transforms art images into 3D particle target coordinates using:
1. CLIP feature extraction
2. UMAP dimensionality reduction to 3D
3. K-means color extraction
4. Binary export for WASM consumption
"""

import argparse
import struct
import sys
from pathlib import Path
from typing import List, Tuple

import numpy as np
import torch
import yaml
from PIL import Image
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from tqdm import tqdm
from transformers import CLIPModel, CLIPProcessor
from umap import UMAP


def load_config(config_path: Path) -> dict:
    """Load configuration from YAML file."""
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)


def discover_images(input_dir: Path) -> List[Path]:
    """
    Discover all image files in input directory.

    Returns:
        Sorted list of image paths for reproducibility.
    """
    extensions = ['*.jpg', '*.jpeg', '*.png', '*.webp', '*.JPG', '*.JPEG', '*.PNG', '*.WEBP']
    images = []
    for ext in extensions:
        images.extend(input_dir.glob(ext))

    if not images:
        raise ValueError(f"No images found in {input_dir}")

    # Sort alphabetically for reproducibility
    return sorted(images)


def extract_clip_features(
    image_paths: List[Path],
    model_name: str,
    device: str = 'cpu'
) -> np.ndarray:
    """
    Extract CLIP embeddings from images.

    Args:
        image_paths: List of paths to image files
        model_name: HuggingFace model identifier
        device: 'cpu' or 'cuda'

    Returns:
        Array of shape (N, 512) containing CLIP embeddings
    """
    print(f"Loading CLIP model: {model_name}")
    model = CLIPModel.from_pretrained(model_name).to(device)
    processor = CLIPProcessor.from_pretrained(model_name)

    features = []

    print("Extracting CLIP features...")
    with torch.inference_mode():
        for img_path in tqdm(image_paths):
            # Load and process image
            image = Image.open(img_path).convert('RGB')
            inputs = processor(images=image, return_tensors="pt").to(device)

            # Extract features
            image_features = model.get_image_features(**inputs)
            features.append(image_features.cpu().numpy().squeeze())

    return np.array(features)


def reduce_to_3d(
    features: np.ndarray,
    n_neighbors: int,
    min_dist: float,
    random_state: int
) -> np.ndarray:
    """
    Reduce high-dimensional features to 3D using UMAP.

    Args:
        features: Array of shape (N, D) where D is feature dimension
        n_neighbors: UMAP n_neighbors parameter (will be adapted)
        min_dist: UMAP min_dist parameter
        random_state: Random seed for reproducibility

    Returns:
        Array of shape (N, 3) containing 3D coordinates
    """
    n_samples = features.shape[0]

    # Adapt n_neighbors based on dataset size
    # UMAP requires n_neighbors < n_samples
    adaptive_neighbors = max(3, min(n_samples // 2, n_neighbors))

    print(f"Normalizing features with StandardScaler...")
    scaler = StandardScaler()
    features_normalized = scaler.fit_transform(features)

    print(f"Reducing to 3D with UMAP (n_neighbors={adaptive_neighbors})...")
    reducer = UMAP(
        n_components=3,
        n_neighbors=adaptive_neighbors,
        min_dist=min_dist,
        random_state=random_state,
        verbose=True
    )

    coords_3d = reducer.fit_transform(features_normalized)

    # Normalize coordinates to [-1, 1] range for each axis
    print("Normalizing 3D coordinates to [-1, 1] range...")
    for axis in range(3):
        min_val = coords_3d[:, axis].min()
        max_val = coords_3d[:, axis].max()
        coords_3d[:, axis] = 2 * (coords_3d[:, axis] - min_val) / (max_val - min_val) - 1

    return coords_3d


def extract_dominant_colors(
    image_paths: List[Path],
    n_colors: int,
    random_state: int
) -> np.ndarray:
    """
    Extract dominant colors from each image using K-means.

    Args:
        image_paths: List of paths to image files
        n_colors: Number of dominant colors to extract per image
        random_state: Random seed for K-means

    Returns:
        Array of shape (N, n_colors, 3) containing RGB colors in [0, 1] range
    """
    colors_list = []

    print(f"Extracting {n_colors} dominant colors per image...")
    for img_path in tqdm(image_paths):
        # Load image and convert to RGB
        image = Image.open(img_path).convert('RGB')

        # Reshape to pixel array: (width * height, 3)
        pixels = np.array(image).reshape(-1, 3)

        # Apply K-means
        kmeans = KMeans(n_clusters=n_colors, random_state=random_state, n_init=10)
        kmeans.fit(pixels)

        # Get cluster centers (dominant colors)
        dominant_colors = kmeans.cluster_centers_

        # Normalize to [0, 1] range
        dominant_colors = dominant_colors / 255.0

        colors_list.append(dominant_colors)

    return np.array(colors_list)


def export_binary(
    output_path: Path,
    coords_3d: np.ndarray,
    colors: np.ndarray,
    version: int = 1
) -> None:
    """
    Export data to binary format for WASM consumption.

    Binary format:
    - Header: [version: i32, num_states: i32, points_per_state: i32, colors_per_state: i32]
    - Positions: flattened 3D coords as f32 (x,y,z for each state)
    - Colors: flattened RGB as f32 (r,g,b for each color for each state)

    All values are little-endian.

    Args:
        output_path: Path to output binary file
        coords_3d: Array of shape (N, 3) containing 3D coordinates
        colors: Array of shape (N, n_colors, 3) containing RGB colors
        version: Binary format version
    """
    num_states = coords_3d.shape[0]
    points_per_state = 1  # For now, one seed point per art state
    colors_per_state = colors.shape[1]

    print(f"Exporting binary data...")
    print(f"  Version: {version}")
    print(f"  Num states: {num_states}")
    print(f"  Points per state: {points_per_state}")
    print(f"  Colors per state: {colors_per_state}")

    with open(output_path, 'wb') as f:
        # Write header (4 x i32 = 16 bytes)
        header = struct.pack('<4i', version, num_states, points_per_state, colors_per_state)
        f.write(header)

        # Write positions (N * 3 * f32)
        # Convert to little-endian float32
        positions_bytes = coords_3d.astype('<f4').tobytes()
        f.write(positions_bytes)

        # Write colors (N * colors_per_state * 3 * f32)
        # Flatten colors array and convert to little-endian float32
        colors_flattened = colors.reshape(-1, 3)
        colors_bytes = colors_flattened.astype('<f4').tobytes()
        f.write(colors_bytes)

    file_size = output_path.stat().st_size
    print(f"Binary file written: {output_path} ({file_size} bytes)")


def main():
    """Main pipeline execution."""
    parser = argparse.ArgumentParser(description='Process art images into 3D particle data')
    parser.add_argument(
        '--config',
        type=Path,
        default=Path(__file__).parent.parent / 'config.yaml',
        help='Path to config.yaml'
    )
    parser.add_argument(
        '--input-dir',
        type=Path,
        help='Override input directory from config'
    )
    parser.add_argument(
        '--output-dir',
        type=Path,
        help='Override output directory from config'
    )

    args = parser.parse_args()

    # Load configuration
    config = load_config(args.config)

    # Resolve directories
    base_dir = args.config.parent
    input_dir = args.input_dir or base_dir / config['input_dir']
    output_dir = args.output_dir or base_dir / config['output_dir']
    output_file = output_dir / config['output_file']

    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("Art States Data Pipeline")
    print("=" * 60)
    print(f"Input directory: {input_dir}")
    print(f"Output file: {output_file}")
    print()

    # Step 1: Discover images
    image_paths = discover_images(input_dir)
    print(f"Found {len(image_paths)} images")
    print()

    # Step 2: Extract CLIP features
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Using device: {device}")
    features = extract_clip_features(
        image_paths,
        config['clip_model'],
        device
    )
    print(f"Extracted features shape: {features.shape}")
    print()

    # Step 3: Reduce to 3D
    coords_3d = reduce_to_3d(
        features,
        n_neighbors=config['umap']['n_neighbors'],
        min_dist=config['umap']['min_dist'],
        random_state=config['umap']['random_state']
    )
    print(f"3D coordinates shape: {coords_3d.shape}")
    print(f"3D coordinates range: [{coords_3d.min():.3f}, {coords_3d.max():.3f}]")
    print()

    # Step 4: Extract dominant colors
    colors = extract_dominant_colors(
        image_paths,
        n_colors=config['colors']['n_colors'],
        random_state=config['colors']['random_state']
    )
    print(f"Colors shape: {colors.shape}")
    print(f"Colors range: [{colors.min():.3f}, {colors.max():.3f}]")
    print()

    # Step 5: Export to binary
    export_binary(
        output_file,
        coords_3d,
        colors,
        version=config['binary']['version']
    )

    print()
    print("=" * 60)
    print("Pipeline complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()
