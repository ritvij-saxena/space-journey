#!/usr/bin/env python3
"""
Art States Data Pipeline

Transforms art images into dense 3D point clouds using:
1. CLIP feature extraction for morph ordering
2. MiDaS monocular depth estimation for Z coordinates
3. Uniform sampling for per-pixel positions and colors
4. Greedy nearest-neighbor CLIP ordering for smooth transitions
5. Binary v2 export for WASM consumption
"""

import argparse
import struct
import sys
from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np
import torch
import yaml
from PIL import Image
from sklearn.metrics.pairwise import cosine_similarity
from tqdm import tqdm
from transformers import CLIPModel, CLIPProcessor


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


def load_midas_model(model_type: str, device: str):
    """
    Load MiDaS depth estimation model via PyTorch Hub.

    Args:
        model_type: MiDaS model variant (e.g. "DPT_Large", "DPT_Hybrid", "MiDaS_small")
        device: 'cpu' or 'cuda'

    Returns:
        (model, transform) tuple
    """
    print(f"Loading MiDaS model: {model_type}")
    model = torch.hub.load("intel-isl/MiDaS", model_type)
    model.to(device).eval()

    midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
    if model_type in ("DPT_Large", "DPT_Hybrid"):
        transform = midas_transforms.dpt_transform
    else:
        transform = midas_transforms.small_transform

    return model, transform


def extract_depth_map(image_rgb_np: np.ndarray, midas_model, midas_transform, device: str) -> np.ndarray:
    """
    Extract normalized depth map from an RGB image using MiDaS.

    Args:
        image_rgb_np: numpy array (H, W, 3) in RGB uint8
        midas_model: loaded MiDaS model
        midas_transform: MiDaS preprocessing transform
        device: 'cpu' or 'cuda'

    Returns:
        Normalized depth map as numpy array (H, W) in [0, 1] range
    """
    # MiDaS expects BGR input (cv2 format)
    img_bgr = cv2.cvtColor(image_rgb_np, cv2.COLOR_RGB2BGR)

    input_batch = midas_transform(img_bgr).to(device)

    with torch.inference_mode():
        prediction = midas_model(input_batch)

        # Resize to original image dimensions
        prediction = torch.nn.functional.interpolate(
            prediction.unsqueeze(1),
            size=image_rgb_np.shape[:2],
            mode="bicubic",
            align_corners=False,
        ).squeeze()

    depth_map = prediction.cpu().numpy()

    # Normalize depth to [0, 1]
    d_min = depth_map.min()
    d_max = depth_map.max()
    if d_max - d_min > 0:
        depth_normalized = (depth_map - d_min) / (d_max - d_min)
    else:
        depth_normalized = np.zeros_like(depth_map)

    return depth_normalized


def sample_points_content_aware(
    image_rgb: np.ndarray,
    depth_map: np.ndarray,
    num_points: int,
    edge_weight: float = 0.5,
    saliency_weight: float = 0.3,
    uniform_floor: float = 0.2,
    rng: np.random.Generator = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Sample points weighted by visual interest: edges + color saliency.

    Dense clusters appear along contours and vivid areas, creating
    particle formations that reflect the actual artwork composition.

    Args:
        image_rgb: (H, W, 3) uint8 RGB
        depth_map: (H, W) float32 in [0, 1]
        num_points: Number of points to sample
        edge_weight: Contribution of edge map to interest (0-1)
        saliency_weight: Contribution of color saliency to interest (0-1)
        uniform_floor: Minimum baseline probability for all pixels (0-1)
        rng: numpy random generator (for reproducibility)

    Returns:
        (positions, colors) as float32 arrays of shape (num_points, 3)
    """
    if rng is None:
        rng = np.random.default_rng()

    H, W = depth_map.shape

    # Edge map: Canny edges blurred for soft probability gradient
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 40, 120).astype(np.float32)
    edges = cv2.GaussianBlur(edges, (9, 9), 3)

    # Color saliency: saturation × brightness in HSV
    # High saturation + high brightness = visually interesting area
    hsv = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2HSV).astype(np.float32)
    saliency = (hsv[:, :, 1] / 255.0) * (hsv[:, :, 2] / 255.0)

    # Normalize each map to [0, 1]
    edge_norm = edges / (edges.max() + 1e-8)
    sal_norm = saliency / (saliency.max() + 1e-8)

    # Combine: weighted sum + uniform floor so sparse backgrounds still sample
    interest = (edge_weight * edge_norm +
                saliency_weight * sal_norm +
                uniform_floor)

    # Convert to sampling probability distribution
    prob = interest.flatten()
    prob = prob / prob.sum()

    # Sample pixel indices according to interest distribution
    total_pixels = H * W
    indices = rng.choice(
        total_pixels,
        size=num_points,
        replace=(num_points > total_pixels),
        p=prob,
    )

    # Convert flat indices to 2D coordinates
    y_sampled = (indices // W).astype(np.float32)
    x_sampled = (indices % W).astype(np.float32)
    z_sampled = depth_map.flat[indices].astype(np.float32)

    r_sampled = image_rgb[:, :, 0].flat[indices]
    g_sampled = image_rgb[:, :, 1].flat[indices]
    b_sampled = image_rgb[:, :, 2].flat[indices]

    # Normalize positions to [-1, 1]
    x_norm = 2.0 * (x_sampled / W) - 1.0
    y_norm = -(2.0 * (y_sampled / H) - 1.0)  # flip Y so image-top = +Y
    z_norm = 2.0 * z_sampled - 1.0

    positions = np.stack([x_norm, y_norm, z_norm], axis=-1).astype(np.float32)
    colors = np.stack([r_sampled, g_sampled, b_sampled], axis=-1).astype(np.float32) / 255.0

    return positions, colors


def compute_greedy_order(embeddings: np.ndarray) -> List[int]:
    """
    Compute greedy nearest-neighbor tour through CLIP embedding space.

    Args:
        embeddings: (N, D) array of CLIP embeddings

    Returns:
        List of indices representing tour order
    """
    similarity_matrix = cosine_similarity(embeddings)

    N = len(embeddings)
    visited = [False] * N
    order = [0]
    visited[0] = True

    for _ in range(N - 1):
        current = order[-1]
        similarities = similarity_matrix[current].copy()

        # Mask visited images
        for idx in range(N):
            if visited[idx]:
                similarities[idx] = -2.0

        next_idx = int(np.argmax(similarities))
        order.append(next_idx)
        visited[next_idx] = True

    return order


def export_binary_v2(
    output_path: Path,
    all_positions: List[np.ndarray],
    all_colors: List[np.ndarray],
    version: int = 2
) -> None:
    """
    Export enhanced art states to binary format v2.

    Binary format:
    - Header (16 bytes): [version: i32, num_states: i32, points_per_state: i32, colors_per_state: i32]
    - Positions: f32 * (num_states * points_per_state * 3)
    - Colors: f32 * (num_states * colors_per_state * 3)

    All values are little-endian.
    """
    num_states = len(all_positions)
    points_per_state = all_positions[0].shape[0]
    colors_per_state = all_colors[0].shape[0]

    print(f"Exporting binary v2...")
    print(f"  Version: {version}")
    print(f"  Num states: {num_states}")
    print(f"  Points per state: {points_per_state}")
    print(f"  Colors per state: {colors_per_state}")

    with open(output_path, 'wb') as f:
        # Write header (4 x i32 = 16 bytes)
        header = struct.pack('<4i', version, num_states, points_per_state, colors_per_state)
        f.write(header)

        # Write all positions (flattened)
        for positions in all_positions:
            f.write(positions.astype('<f4').tobytes())

        # Write all colors (flattened)
        for colors in all_colors:
            f.write(colors.astype('<f4').tobytes())

    # Calculate and report file size
    header_size = 16
    positions_size = num_states * points_per_state * 3 * 4
    colors_size = num_states * colors_per_state * 3 * 4
    total_size = header_size + positions_size + colors_size

    print(f"  File size: {total_size:,} bytes ({total_size / 1024:.1f} KB)")
    print(f"  Written to: {output_path}")


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
    print("Art States Data Pipeline (Enhanced v2)")
    print("=" * 60)
    print(f"Input directory: {input_dir}")
    print(f"Output file: {output_file}")
    print()

    # Step 1: Discover images
    image_paths = discover_images(input_dir)
    print(f"Found {len(image_paths)} images:")
    for p in image_paths:
        print(f"  - {p.name}")
    print()

    # Setup device
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Using device: {device}")
    print()

    # Step 2: Extract CLIP features for morph ordering
    features = extract_clip_features(
        image_paths,
        config['clip_model'],
        device
    )
    print(f"CLIP features shape: {features.shape}")
    print()

    # Step 3: Load MiDaS model once
    midas_model, midas_transform = load_midas_model(
        config['depth']['model'],
        device
    )
    print()

    # Step 4: For each image, extract depth map and sample points
    num_points = config['sampling']['num_points']
    all_positions = []
    all_colors = []

    rng = np.random.default_rng(config.get('sampling', {}).get('seed', 42))

    print(f"Processing images (sampling {num_points} points each)...")
    for img_path in tqdm(image_paths):
        # Load image as RGB numpy array
        image_rgb = np.array(Image.open(img_path).convert('RGB'))

        # Extract depth map with MiDaS
        depth_map = extract_depth_map(image_rgb, midas_model, midas_transform, device)

        # Sample points weighted by visual interest (edges + color saliency)
        positions, colors = sample_points_content_aware(image_rgb, depth_map, num_points, rng=rng)

        all_positions.append(positions)
        all_colors.append(colors)

    print(f"Processed {len(all_positions)} images")
    print()

    # Step 5: Compute greedy morph order from CLIP embeddings
    print("Computing morph order (greedy nearest-neighbor on CLIP cosine similarity)...")
    order = compute_greedy_order(features)

    print("Morph order:")
    for rank, idx in enumerate(order):
        print(f"  {rank + 1}. {image_paths[idx].name}")
    print()

    # Reorder positions AND colors by morph order
    positions_ordered = [all_positions[i] for i in order]
    colors_ordered = [all_colors[i] for i in order]

    # Step 6: Export to binary v2
    export_binary_v2(
        output_file,
        positions_ordered,
        colors_ordered,
        version=config['binary']['version']
    )

    print()
    print("=" * 60)
    print("Pipeline complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()
