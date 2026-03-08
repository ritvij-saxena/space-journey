use wasm_bindgen::prelude::*;
use web_sys::console;
use noise::{NoiseFn, Perlin, Fbm};

mod art_data;
pub use art_data::{ArtData, ArtState};

mod curl_noise;
mod physics;
mod particle_system;
pub use particle_system::ParticleSystem;
mod morph_controller;
pub use morph_controller::{MorphController, MorphPhase, MorphConfig, TransitionPattern};
mod weather_params;
pub use weather_params::{WeatherData, WeatherInfluence, WeatherMapper};

/// WASM-bindgen wrapper for ParticleSystem
/// Provides JavaScript-compatible API for the particle physics engine
#[wasm_bindgen]
pub struct WasmParticleSystem {
    inner: ParticleSystem,
}

#[wasm_bindgen]
impl WasmParticleSystem {
    /// Create a new particle system
    ///
    /// # Arguments
    /// * `num_particles` - Number of particles to create
    /// * `seed` - Random seed for deterministic behavior
    /// * `num_states` - Number of art states for morphing
    #[wasm_bindgen(constructor)]
    pub fn new(num_particles: u32, seed: u32, num_states: u32) -> WasmParticleSystem {
        console::log_1(&format!("Creating ParticleSystem with {} particles, {} states", num_particles, num_states).into());
        WasmParticleSystem {
            inner: ParticleSystem::new(num_particles as usize, seed, num_states as usize),
        }
    }

    /// Load art state positions for morphing
    ///
    /// # Arguments
    /// * `state_index` - Index of the art state (0-based)
    /// * `positions` - Flattened array of positions [x,y,z,x,y,z,...]
    pub fn load_art_state(&mut self, state_index: u32, positions: &[f32]) {
        self.inner.load_art_state(state_index as usize, positions);
    }

    /// Load art state colors for morphing
    ///
    /// # Arguments
    /// * `state_index` - Index of the art state (0-based)
    /// * `colors` - Flattened array of RGB colors [r,g,b,r,g,b,...] in [0,1]
    pub fn load_art_colors(&mut self, state_index: u32, colors: &[f32]) {
        self.inner.load_art_colors(state_index as usize, colors);
    }

    /// Update particle simulation for one frame
    ///
    /// # Arguments
    /// * `dt` - Time delta in seconds (typically 1/60 for 60fps)
    pub fn update(&mut self, dt: f32) {
        self.inner.update(dt);
    }

    /// Get all particle positions as a flat array
    ///
    /// Returns: [x,y,z,x,y,z,...] for all particles
    pub fn get_positions(&self) -> Box<[f32]> {
        self.inner.get_positions()
    }

    /// Get all particle colors as a flat array
    ///
    /// Returns: [r,g,b,r,g,b,...] for all particles (currently white)
    pub fn get_colors(&self) -> Box<[f32]> {
        self.inner.get_colors()
    }

    /// Update weather data affecting physics
    ///
    /// # Arguments
    /// * `temperature` - Temperature in Celsius
    /// * `humidity` - Humidity percentage (0-100)
    /// * `wind_speed` - Wind speed in km/h
    /// * `wind_direction` - Wind direction in degrees (0-360)
    pub fn set_weather(&mut self, temperature: f32, humidity: f32, wind_speed: f32, wind_direction: f32) {
        self.inner.set_weather(temperature, humidity, wind_speed, wind_direction);
    }

    /// Update physics parameters manually
    ///
    /// # Arguments
    /// * `spring_stiffness` - Spring force strength
    /// * `damping` - Velocity damping factor
    /// * `curl_strength` - Curl noise influence strength
    pub fn set_physics_params(&mut self, spring_stiffness: f32, damping: f32, curl_strength: f32) {
        self.inner.set_physics_params(spring_stiffness, damping, curl_strength);
    }

    /// Get number of particles in the system
    pub fn particle_count(&self) -> u32 {
        self.inner.particle_count() as u32
    }

    /// Get current morph phase
    ///
    /// Returns: 0=Coalescing, 1=Holding, 2=Dissolving, 3=Reforming
    pub fn get_morph_phase(&self) -> u8 {
        self.inner.get_morph_phase()
    }

    /// Return raw pointer to flat positions buffer for zero-copy JS access.
    /// Reconstruct Float32Array view each frame: new Float32Array(memory.buffer, ptr, len)
    pub fn get_positions_ptr(&self) -> u32 {
        self.inner.positions_ptr() as u32
    }

    /// Return element count of positions buffer (num_particles * 3)
    pub fn get_positions_len(&self) -> u32 {
        self.inner.positions_len() as u32
    }

    /// Return raw pointer to flat colors buffer for zero-copy JS access.
    pub fn get_colors_ptr(&self) -> u32 {
        self.inner.colors_ptr() as u32
    }

    /// Return element count of colors buffer (num_particles * 3)
    pub fn get_colors_len(&self) -> u32 {
        self.inner.colors_len() as u32
    }

    /// Limit physics simulation and flat buffer size to n particles.
    /// Combined with geometry.setDrawRange(0, n), reduces both CPU and GPU cost.
    pub fn set_active_count(&mut self, n: u32) {
        self.inner.set_active_count(n as usize);
    }
}

/// NoiseField generates procedural noise for the visualization.
/// This will be supplemented/replaced by SD-generated textures.
#[wasm_bindgen]
pub struct NoiseField {
    perlin: Perlin,
    fbm: Fbm<Perlin>,
    time: f32,
}

#[wasm_bindgen]
impl NoiseField {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> NoiseField {
        console::log_1(&"NoiseField initialized".into());

        let perlin = Perlin::new(seed);
        let mut fbm = Fbm::<Perlin>::new(seed);
        fbm.octaves = 6;
        fbm.frequency = 1.0;
        fbm.lacunarity = 2.0;
        fbm.persistence = 0.5;

        NoiseField {
            perlin,
            fbm,
            time: 0.0,
        }
    }

    /// Update time for animation
    pub fn update(&mut self, dt: f32) {
        self.time += dt;
    }

    /// Get current time
    pub fn get_time(&self) -> f32 {
        self.time
    }

    /// Generate a 3D noise texture slice for shader sampling
    /// Returns a 2D slice of 3D noise (size x size) at given z-depth
    /// Format: RGBA where RGB encodes 3 offset noise samples, A is primary
    pub fn generate_noise_slice(&self, size: u32, z_offset: f32) -> Vec<f32> {
        let total = (size * size * 4) as usize; // RGBA
        let mut data = Vec::with_capacity(total);

        let size_f = size as f32;
        let scale = 2.0;
        let time_offset = self.time * 0.05;

        for y in 0..size {
            for x in 0..size {
                let nx = ((x as f32 / size_f) * 2.0 - 1.0) * scale;
                let ny = ((y as f32 / size_f) * 2.0 - 1.0) * scale;
                let nz = z_offset * scale;

                // Primary noise (used for SDF)
                let n1 = self.sample_fbm(
                    nx + time_offset,
                    ny + time_offset * 0.7,
                    nz + time_offset * 0.5,
                );

                // Offset samples (for variation/flow)
                let n2 = self.sample_fbm(
                    nx + 100.0 + time_offset * 0.3,
                    ny + time_offset * 0.5,
                    nz + time_offset * 0.8,
                );

                let n3 = self.sample_fbm(
                    nx + time_offset * 0.6,
                    ny + 100.0 + time_offset * 0.4,
                    nz + time_offset * 0.3,
                );

                // Normalize to 0-1 range
                data.push((n1 + 1.0) * 0.5); // R
                data.push((n2 + 1.0) * 0.5); // G
                data.push((n3 + 1.0) * 0.5); // B
                data.push((n1 + 1.0) * 0.5); // A (duplicate of primary)
            }
        }

        data
    }

    /// Generate a 3D noise volume as a texture atlas
    /// Stores depth slices in a grid layout
    pub fn generate_noise_atlas(&self, slice_size: u32, depth_slices: u32) -> Vec<f32> {
        let slices_per_row = (depth_slices as f32).sqrt().ceil() as u32;
        let atlas_size = slice_size * slices_per_row;
        let total = (atlas_size * atlas_size * 4) as usize;
        let mut data = vec![0.0; total];

        for z in 0..depth_slices {
            let slice_x = (z % slices_per_row) * slice_size;
            let slice_y = (z / slices_per_row) * slice_size;
            let z_offset = (z as f32 / depth_slices as f32) * 2.0 - 1.0;

            let slice_data = self.generate_noise_slice(slice_size, z_offset);

            // Copy slice into atlas
            for y in 0..slice_size {
                for x in 0..slice_size {
                    let src_idx = ((y * slice_size + x) * 4) as usize;
                    let dst_x = slice_x + x;
                    let dst_y = slice_y + y;
                    let dst_idx = ((dst_y * atlas_size + dst_x) * 4) as usize;

                    if dst_idx + 3 < data.len() && src_idx + 3 < slice_data.len() {
                        data[dst_idx] = slice_data[src_idx];
                        data[dst_idx + 1] = slice_data[src_idx + 1];
                        data[dst_idx + 2] = slice_data[src_idx + 2];
                        data[dst_idx + 3] = slice_data[src_idx + 3];
                    }
                }
            }
        }

        data
    }

    /// Get atlas dimensions for a given configuration
    pub fn get_atlas_size(slice_size: u32, depth_slices: u32) -> u32 {
        let slices_per_row = (depth_slices as f32).sqrt().ceil() as u32;
        slice_size * slices_per_row
    }

    fn sample_fbm(&self, x: f32, y: f32, z: f32) -> f32 {
        self.fbm.get([x as f64, y as f64, z as f64]) as f32
    }

    /// Convert weather parameters to shader uniforms
    pub fn weather_to_params(&self, temperature: f32, humidity: f32, wind_speed: f32) -> Vec<f32> {
        // Normalize inputs
        let temp_norm = (temperature.clamp(-20.0, 45.0) + 20.0) / 65.0;
        let humidity_norm = humidity.clamp(0.0, 100.0) / 100.0;
        let wind_norm = wind_speed.clamp(0.0, 30.0) / 30.0;

        vec![
            temp_norm,                           // 0: color warmth
            humidity_norm,                       // 1: surface glossiness
            0.5 + wind_norm * 1.5,              // 2: animation speed
            0.3 + wind_norm * 0.5,              // 3: noise threshold offset
            0.5 + temp_norm * 0.3,              // 4: noise scale
            humidity_norm * 0.4,                 // 5: subsurface intensity
        ]
    }

    /// Generate particle positions for fluid simulation
    /// Returns flattened array: [x, y, z, size, x, y, z, size, ...]
    pub fn generate_particles(&self, count: u32) -> Vec<f32> {
        let mut particles = Vec::with_capacity((count * 4) as usize);
        let t = self.time;

        for i in 0..count {
            let fi = i as f32;
            let ratio = fi / count as f32;

            // Spherical distribution with noise displacement
            let theta = ratio * std::f32::consts::PI * 2.0 * 13.0; // Golden angle spiral
            let phi = (1.0 - 2.0 * ratio).acos();

            // Base spherical position
            let base_r = 1.2;
            let mut x = base_r * phi.sin() * theta.cos();
            let mut y = base_r * phi.sin() * theta.sin();
            let mut z = base_r * phi.cos();

            // Add flowing noise displacement
            let noise_scale = 0.8;
            let noise_x = self.fbm.get([
                (x * noise_scale + t * 0.1) as f64,
                (y * noise_scale) as f64,
                (z * noise_scale + t * 0.05) as f64
            ]) as f32;
            let noise_y = self.fbm.get([
                (x * noise_scale) as f64,
                (y * noise_scale + t * 0.08) as f64,
                (z * noise_scale + 100.0) as f64
            ]) as f32;
            let noise_z = self.fbm.get([
                (x * noise_scale + 200.0) as f64,
                (y * noise_scale + t * 0.12) as f64,
                (z * noise_scale) as f64
            ]) as f32;

            // Apply displacement
            let displacement = 0.6 + (t * 0.2).sin() * 0.15;
            x += noise_x * displacement;
            y += noise_y * displacement;
            z += noise_z * displacement;

            // Particle size varies with position and time
            let size = 0.015 + (noise_x.abs() + noise_y.abs()) * 0.01
                + ((t * 0.3 + fi * 0.01).sin() * 0.5 + 0.5) * 0.008;

            particles.push(x);
            particles.push(y);
            particles.push(z);
            particles.push(size);
        }

        particles
    }
}

#[wasm_bindgen]
pub fn greet(name: &str) {
    console::log_1(&format!("Hello, {}! Welcome to Unsupervised.", name).into());
}
