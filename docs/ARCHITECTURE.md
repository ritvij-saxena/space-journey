# Architecture Overview

## System Design

```
┌─────────────────────────────────────────────────────┐
│                  Web Browser                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │         JavaScript Frontend (Three.js)        │  │
│  │  - Real-time visualization                    │  │
│  │  - Weather data integration                   │  │
│  │  - Particle system animation                  │  │
│  └──────────────────────────────────────────────┘  │
│                    ↕                                │
│  ┌──────────────────────────────────────────────┐  │
│  │    Rust WASM Module (Image Processing)       │  │
│  │  - Perlin noise generation                    │  │
│  │  - Flow field calculations                    │  │
│  │  - Weather-to-color mapping                   │  │
│  └──────────────────────────────────────────────┘  │
│                    ↕                                │
│  ┌──────────────────────────────────────────────┐  │
│  │       External APIs                          │  │
│  │  - Open-Meteo Weather API                     │  │
│  │  - Pre-generated image storage (CDN/Assets)   │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                        ↑
                        │
        ┌───────────────┴────────────────┐
        │                                │
┌───────┴────────┐         ┌────────────┴──────┐
│  Google Colab  │         │  Generated Images  │
│                │         │  Storage/CDN       │
│ - Training     │         │                    │
│ - Generation   │────────→│ - 512x512 PNG      │
│ - Exporting    │         │ - 1024x1024 PNG    │
└────────────────┘         └────────────────────┘
```

## Component Details

### 1. Frontend (JavaScript + Three.js)

**Responsibilities:**
- Render 3D particle system
- Fetch and display weather data
- Coordinate with WASM module
- Handle user interactions
- Responsive canvas rendering

**Key Files:**
- `main.js`: App initialization and animation loop
- `weather.js`: Weather API integration
- `visualization.js`: Three.js scene and particle system

### 2. Rust WASM Module

**Responsibilities:**
- High-performance noise generation
- Flow field calculations
- Weather parameter processing
- Image post-processing

**Key Functions:**
- `perlin_noise()`: Generate smooth noise values
- `generate_flow_field()`: Create vector field for particle flow
- `weather_to_colors()`: Map weather data to RGB values

**Benefits:**
- 10-100x faster than JavaScript
- Enables complex calculations
- Seamless browser integration

### 3. Google Colab Pipeline

**Process:**
1. Load Stable Diffusion model
2. Generate prompts based on weather parameters
3. Generate images with various seeds
4. Post-process with style transfer (optional)
5. Export to storage

**Weather-based Generation:**
- Temperature → Color palette
- Humidity → Density/complexity
- Wind speed → Motion/flow patterns

### 4. Weather Integration

**Data Source:** Open-Meteo (free, no API key needed)

**Parameters Used:**
- Temperature: 0-40°C
- Humidity: 0-100%
- Wind speed: 0-30 m/s
- Weather condition: clear/cloudy/rain/storm

**Influence on Visuals:**
- Color shifts with temperature
- Particle density with humidity
- Animation speed with wind
- Overall intensity with conditions

## Data Flow

```
1. User opens website
   ↓
2. Browser requests weather data
   ↓
3. Weather API responds with current conditions
   ↓
4. UI updates with weather display
   ↓
5. Visualization engine converts weather to visual params
   ↓
6. WASM computes noise/flow fields
   ↓
7. Three.js renders particles with weather-influenced colors
   ↓
8. Animation loop updates at 60 FPS
```

## Performance Considerations

- **Particle count**: 5000 (adjustable)
- **Render resolution**: Native viewport
- **Update frequency**: 60 FPS target
- **Weather refresh**: 5 minutes
- **WASM overhead**: ~1ms per frame

## Scalability

- **Multiple viewers**: Stateless (each browser independent)
- **Different locations**: Geolocation-based weather
- **Gallery mode**: Batch image display
- **Archive**: Store historical weather + images

## Security

- No sensitive data transmission
- Read-only weather API
- No user tracking
- Static deployment ready
- Open-source (no proprietary code)
