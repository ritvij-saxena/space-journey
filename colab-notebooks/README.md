# Google Colab Notebooks

This directory contains Jupyter notebooks for generating art using generative models.

## Notebooks

### 1. `unsupervised-generation.ipynb`
Main notebook for generating images using Stable Diffusion.

**Setup:**
1. Open the notebook in Google Colab: https://colab.research.google.com
2. Upload this notebook or copy it to your Colab
3. Run all cells to install dependencies and generate images
4. Download generated images to local `frontend/assets/generated/`

**Usage:**
- Modify prompts in the generation cell
- Adjust weather parameters for style variations
- Export images in different resolutions

### 2. `model-training.ipynb` (Optional)
For fine-tuning models on custom datasets.

## Output Format

Generated images should be:
- **Resolution**: 512x512 or 1024x1024
- **Format**: PNG with transparency
- **Naming**: `generated_[timestamp].png`

## Weather-based Prompts

The system generates different prompts based on weather:
- **Hot (>25°C)**: Warm, energetic colors
- **Cold (<5°C)**: Cool, icy aesthetics
- **Humid (>70%)**: Dense, flowing patterns
- **Windy (>15 m/s)**: Dynamic, chaotic compositions

## API Keys Required

- HuggingFace API token (for model access)
- OpenWeather API key (optional, for weather-based prompts)
