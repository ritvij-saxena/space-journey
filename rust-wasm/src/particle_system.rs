use crate::curl_noise::CurlNoiseField;
use crate::physics::{Particle, PhysicsParams};
use crate::morph_controller::{MorphController, MorphPhase};
use crate::weather_params::{WeatherData, WeatherMapper};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;

/// Scene-specific extra force (black hole gravity, galaxy rotation, wormhole vortex).
/// Extracted as a free function to avoid borrow-checker conflicts inside the particle loop.
fn space_scene_force(scene_type: u8, position: [f32; 3]) -> [f32; 3] {
    match scene_type {
        2 => {
            // Black hole: radial gravity F = -k/r² inward, event horizon at r < 0.15
            let (x, y, z) = (position[0], position[1], position[2]);
            let r = (x * x + y * y + z * z).sqrt();
            if r < 0.15 { return [0.0, 0.0, 0.0]; }
            let k = 0.008;
            let f = -k / (r * r);
            [f * x / r, f * y / r, f * z / r]
        }
        3 => {
            // Galaxy: Keplerian tangential rotation in XY plane
            let (x, y) = (position[0], position[1]);
            let r_xy = (x * x + y * y).sqrt().max(0.01);
            let omega = 0.040 / r_xy.sqrt(); // differential rotation
            // Tangential: (-y/r, x/r) × omega × r_xy
            [-y / r_xy * omega * r_xy, x / r_xy * omega * r_xy, 0.0]
        }
        4 => {
            // Wormhole: vortex F = [-y, x, -z*0.1] * strength/(r+0.1)
            let (x, y, z) = (position[0], position[1], position[2]);
            let r = (x * x + y * y + z * z).sqrt();
            let s = 0.040 / (r + 0.10);
            [-y * s, x * s, -z * 0.10 * s]
        }
        _ => [0.0, 0.0, 0.0],
    }
}

/// ParticleSystem manages a collection of particles and their physics simulation.
///
/// Each frame, particles are influenced by:
/// 1. Spring forces pulling them toward target positions (from art data)
/// 2. Curl noise providing organic, flowing motion
/// 3. Morph controller cycling through art states
/// 4. Weather data affecting physics parameters
/// 5. Verlet integration for stable, realistic dynamics
///
/// The system uses multiple substeps per frame for improved stability.
pub struct ParticleSystem {
    particles: Vec<Particle>,
    curl_noise: CurlNoiseField,
    params: PhysicsParams,
    time: f64,
    morph: MorphController,
    weather_mapper: WeatherMapper,
    weather: WeatherData,
    art_positions: Vec<Vec<f32>>,  // Cloned art state positions for morph interpolation
    art_colors: Vec<Vec<f32>>,    // Per-point RGB colors for each art state
    positions_flat: Vec<f32>,     // maintained in-place for zero-copy JS export
    colors_flat: Vec<f32>,        // maintained in-place for zero-copy JS export
    pub scene_type: u8,           // Current scene type (auto-synced from morph state)
}

impl ParticleSystem {
    /// Create a new particle system with the specified number of particles.
    ///
    /// Particles are initialized at random positions within a [-2, 2] cube
    /// with zero initial velocity. Each particle gets a random phase offset
    /// for staggered motion patterns.
    ///
    /// # Arguments
    /// * `num_particles` - Number of particles in the system
    /// * `seed` - Random seed for deterministic initialization
    /// * `num_states` - Number of art states for morph controller
    pub fn new(num_particles: usize, seed: u32, num_states: usize) -> Self {
        let mut rng = StdRng::seed_from_u64(seed as u64);

        let mut particles = Vec::with_capacity(num_particles);
        for _ in 0..num_particles {
            let position = [
                rng.gen_range(-2.0..2.0),
                rng.gen_range(-2.0..2.0),
                rng.gen_range(-2.0..2.0),
            ];
            let phase_offset = rng.gen_range(0.0..(2.0 * std::f32::consts::PI));
            particles.push(Particle::new(position, phase_offset));
        }

        let curl_noise = CurlNoiseField::new(seed);
        let morph = MorphController::new(num_states);
        let weather_mapper = WeatherMapper::new();
        let weather = WeatherData::default();

        ParticleSystem {
            particles,
            curl_noise,
            params: PhysicsParams::default(),
            time: 0.0,
            morph,
            weather_mapper,
            weather,
            art_positions: Vec::new(),
            art_colors: Vec::new(),
            positions_flat: vec![0.0_f32; num_particles * 3],
            colors_flat: vec![1.0_f32; num_particles * 3],
            scene_type: 0,
        }
    }

    /// Load art data positions for a specific state.
    ///
    /// The positions array should be flat: [x, y, z, x, y, z, ...]
    /// This method stores a clone of the positions for morph interpolation.
    ///
    /// # Arguments
    /// * `state_index` - Index of the art state
    /// * `positions` - Flattened array of 3D positions
    pub fn load_art_state(&mut self, state_index: usize, positions: &[f32]) {
        // Ensure art_positions has enough capacity
        while self.art_positions.len() <= state_index {
            self.art_positions.push(Vec::new());
        }

        // Store cloned positions for this state
        self.art_positions[state_index] = positions.to_vec();
    }

    /// Load art data colors for a specific state.
    ///
    /// The colors array should be flat: [r, g, b, r, g, b, ...]
    /// Values should be in [0, 1] range.
    ///
    /// # Arguments
    /// * `state_index` - Index of the art state
    /// * `colors` - Flattened array of RGB colors
    pub fn load_art_colors(&mut self, state_index: usize, colors: &[f32]) {
        while self.art_colors.len() <= state_index {
            self.art_colors.push(Vec::new());
        }
        self.art_colors[state_index] = colors.to_vec();
    }

    /// Set target positions for all particles.
    ///
    /// The positions array should be flat: [x, y, z, x, y, z, ...]
    /// If there are fewer positions than particles, targets wrap around.
    pub fn set_targets(&mut self, positions: &[f32]) {
        if positions.is_empty() {
            return;
        }

        let num_positions = positions.len() / 3;
        for (i, particle) in self.particles.iter_mut().enumerate() {
            let target_idx = (i % num_positions) * 3;
            if target_idx + 2 < positions.len() {
                particle.set_target([
                    positions[target_idx],
                    positions[target_idx + 1],
                    positions[target_idx + 2],
                ]);
            }
        }
    }

    /// Update all particles for one frame.
    ///
    /// Integrates morph controller, weather influence, and physics simulation:
    /// 1. Update morph state machine
    /// 2. Compute interpolated targets from current and next art states
    /// 3. Map weather to physics parameters
    /// 4. Apply curl noise and spring forces with weather influence
    /// 5. Use 2 substeps for improved stability
    pub fn update(&mut self, dt: f32) {
        // 1. Update morph controller state machine
        self.morph.update(dt);

        // 2. Get weather influence on physics parameters
        let weather_influence = self.weather_mapper.map_to_physics(&self.weather);

        // Apply weather to physics params
        self.params.curl_strength = weather_influence.curl_strength;
        self.params.spring_stiffness = weather_influence.spring_stiffness;
        self.params.damping = weather_influence.damping;

        // Update curl noise frequency based on weather turbulence
        self.curl_noise.set_frequency(weather_influence.turbulence_frequency as f64);

        // Get tether strength from morph controller
        let tether_strength = self.morph.get_tether_strength();

        // 3. Get current and next art state positions for interpolation
        // Only update targets if we have art data loaded
        if !self.art_positions.is_empty() {
            let current_state_idx = self.morph.current_state_index();
            let next_state_idx = self.morph.next_state_index();

            // Get position arrays (or use empty if not loaded)
            let current_positions: &[f32] = if current_state_idx < self.art_positions.len() {
                &self.art_positions[current_state_idx]
            } else if !self.art_positions.is_empty() {
                &self.art_positions[0]
            } else {
                &[]
            };

            let next_positions: &[f32] = if next_state_idx < self.art_positions.len() {
                &self.art_positions[next_state_idx]
            } else if !self.art_positions.is_empty() {
                &self.art_positions[0]
            } else {
                &[]
            };

            // Update targets for each particle based on morph interpolation
            if !current_positions.is_empty() && !next_positions.is_empty() {
                let num_particles = self.particles.len();
                let num_art_positions = current_positions.len() / 3;

                for (i, particle) in self.particles.iter_mut().enumerate() {
                    // Wrap particle index to available art positions
                    let art_idx = i % num_art_positions;
                    let target = self.morph.get_target_positions(
                        art_idx,
                        num_art_positions,
                        current_positions,
                        next_positions,
                    );
                    particle.set_target(target);
                }
            }
        }

        // Sync scene_type from current morph state (auto-follows scene transitions)
        self.scene_type = self.morph.current_state_index() as u8;
        let scene_type = self.scene_type;

        // 4. Physics substeps
        let substep_dt = dt / 2.0;

        for _ in 0..2 {
            for particle in &mut self.particles {
                // Sample curl noise at particle position
                let pos_f64 = [
                    particle.position[0] as f64,
                    particle.position[1] as f64,
                    particle.position[2] as f64,
                ];

                let curl_f64 = self.curl_noise.sample_curl(pos_f64, self.time);

                let curl = [
                    curl_f64[0] as f32,
                    curl_f64[1] as f32,
                    curl_f64[2] as f32,
                ];

                // Compute spring force with tether strength modulation
                let spring = particle.spring_force(self.params.spring_stiffness * tether_strength);

                // Attenuate curl when tether is active — at full tether (1.0), curl drops to 10%
                // so spring force wins and sculptures visibly form. At tether=0, full curl drift.
                let curl_attenuation = 1.0 - tether_strength * 0.90;

                // Scene-specific extra force (gravity, rotation, vortex)
                let sf = space_scene_force(scene_type, particle.position);

                // Combine forces: spring + attenuated curl + wind + scene
                let total_acceleration = [
                    spring[0] + curl[0] * self.params.curl_strength * curl_attenuation + weather_influence.wind_force[0] + sf[0],
                    spring[1] + curl[1] * self.params.curl_strength * curl_attenuation + weather_influence.wind_force[1] + sf[1],
                    spring[2] + curl[2] * self.params.curl_strength * curl_attenuation + weather_influence.wind_force[2] + sf[2],
                ];

                // Integrate position
                particle.verlet_integrate(total_acceleration, self.params.dt, self.params.damping);
            }

            // Advance time
            self.time += substep_dt as f64;
        }

        // 5. Update flat buffers in-place for zero-copy JS export (no allocation)
        for (i, particle) in self.particles.iter().enumerate() {
            let i3 = i * 3;
            self.positions_flat[i3]     = particle.position[0];
            self.positions_flat[i3 + 1] = particle.position[1];
            self.positions_flat[i3 + 2] = particle.position[2];
        }

        // Update colors_flat from current morph state (interpolate during transitions)
        let current_state_idx = self.morph.current_state_index();
        let next_state_idx = self.morph.next_state_index();
        let morph_t = self.morph.get_transition_progress();  // 0.0..=1.0 within current phase

        for i in 0..self.particles.len() {
            let i3 = i * 3;
            let (r, g, b) = if !self.art_colors.is_empty() {
                let cur_colors = if current_state_idx < self.art_colors.len() {
                    &self.art_colors[current_state_idx]
                } else {
                    &self.art_colors[0]
                };
                let nxt_colors = if next_state_idx < self.art_colors.len() {
                    &self.art_colors[next_state_idx]
                } else {
                    &self.art_colors[0]
                };
                let num_art = cur_colors.len() / 3;
                let ci = (i % num_art) * 3;
                let ni = (i % (nxt_colors.len() / 3)) * 3;
                let t = morph_t.clamp(0.0, 1.0);
                (
                    cur_colors[ci]     + (nxt_colors[ni]     - cur_colors[ci])     * t,
                    cur_colors[ci + 1] + (nxt_colors[ni + 1] - cur_colors[ci + 1]) * t,
                    cur_colors[ci + 2] + (nxt_colors[ni + 2] - cur_colors[ci + 2]) * t,
                )
            } else {
                (1.0, 1.0, 1.0)
            };
            self.colors_flat[i3]     = r;
            self.colors_flat[i3 + 1] = g;
            self.colors_flat[i3 + 2] = b;
        }
    }

    /// Get all particle positions as a flat array for zero-copy transfer to JS.
    ///
    /// Returns: [x, y, z, x, y, z, ...]
    pub fn get_positions(&self) -> Box<[f32]> {
        let mut positions = Vec::with_capacity(self.particles.len() * 3);
        for particle in &self.particles {
            positions.push(particle.position[0]);
            positions.push(particle.position[1]);
            positions.push(particle.position[2]);
        }
        positions.into_boxed_slice()
    }

    /// Get particle colors as a flat array.
    ///
    /// Returns per-particle colors from the current art state.
    /// Falls back to white if no art colors are loaded.
    ///
    /// Returns: [r, g, b, r, g, b, ...] where each component is 0-1
    pub fn get_colors(&self) -> Box<[f32]> {
        let mut colors = Vec::with_capacity(self.particles.len() * 3);
        let current_state_idx = self.morph.current_state_index();

        let art_colors = if current_state_idx < self.art_colors.len()
            && !self.art_colors[current_state_idx].is_empty()
        {
            Some(&self.art_colors[current_state_idx])
        } else {
            None
        };

        for i in 0..self.particles.len() {
            if let Some(ac) = art_colors {
                let num_art_colors = ac.len() / 3;
                let color_idx = (i % num_art_colors) * 3;
                colors.push(ac[color_idx]);
                colors.push(ac[color_idx + 1]);
                colors.push(ac[color_idx + 2]);
            } else {
                colors.push(1.0);
                colors.push(1.0);
                colors.push(1.0);
            }
        }
        colors.into_boxed_slice()
    }

    /// Return raw pointer to flat positions buffer (stable address, no allocation)
    pub fn positions_ptr(&self) -> *const f32 {
        self.positions_flat.as_ptr()
    }

    /// Return element count of flat positions buffer
    pub fn positions_len(&self) -> usize {
        self.positions_flat.len()
    }

    /// Return raw pointer to flat colors buffer
    pub fn colors_ptr(&self) -> *const f32 {
        self.colors_flat.as_ptr()
    }

    /// Return element count of flat colors buffer
    pub fn colors_len(&self) -> usize {
        self.colors_flat.len()
    }

    /// Limit simulation to first n particles (adaptive count reduction)
    pub fn set_active_count(&mut self, n: usize) {
        let clamped = n.min(self.particles.len());
        self.positions_flat.truncate(clamped * 3);
        self.colors_flat.truncate(clamped * 3);
        self.particles.truncate(clamped);
    }

    /// Update weather data, which will affect physics parameters on next update.
    ///
    /// # Arguments
    /// * `temperature` - Temperature in Celsius
    /// * `humidity` - Humidity percentage (0-100)
    /// * `wind_speed` - Wind speed in km/h
    /// * `wind_direction` - Wind direction in degrees (0-360)
    pub fn set_weather(&mut self, temperature: f32, humidity: f32, wind_speed: f32, wind_direction: f32) {
        self.weather = WeatherData {
            temperature,
            humidity,
            wind_speed,
            wind_direction,
        };
    }

    /// Get current morph phase as a numeric value.
    ///
    /// Returns:
    /// - 0: Coalescing
    /// - 1: Holding
    /// - 2: Dissolving
    /// - 3: Reforming
    pub fn get_morph_phase(&self) -> u8 {
        match self.morph.phase() {
            MorphPhase::Coalescing => 0,
            MorphPhase::Holding => 1,
            MorphPhase::Dissolving => 2,
            MorphPhase::Reforming => 3,
        }
    }

    /// Update physics parameters at runtime.
    ///
    /// Allows tweaking of particle behavior without recreating the system:
    /// - spring_stiffness: How strongly particles pull toward targets
    /// - damping: How quickly particles lose velocity
    /// - curl_strength: How much curl noise affects motion
    pub fn set_physics_params(&mut self, spring_stiffness: f32, damping: f32, curl_strength: f32) {
        self.params.spring_stiffness = spring_stiffness;
        self.params.damping = damping;
        self.params.curl_strength = curl_strength;
    }

    /// Get the number of particles in the system.
    pub fn particle_count(&self) -> usize {
        self.particles.len()
    }

    /// Set the frequency of the curl noise field.
    ///
    /// Higher frequency = more turbulent, smaller-scale features.
    pub fn set_curl_frequency(&mut self, freq: f64) {
        self.curl_noise.set_frequency(freq);
    }

    /// Get current simulation time.
    pub fn get_time(&self) -> f64 {
        self.time
    }

    /// Reset simulation time (useful for testing or restarting).
    pub fn reset_time(&mut self) {
        self.time = 0.0;
    }

    /// Set scene type for scene-specific physics forces.
    /// Auto-synced each frame from morph controller; manual override available via this method.
    pub fn set_scene_type(&mut self, scene_type: u8) {
        self.scene_type = scene_type;
    }

    /// Get current scene type.
    pub fn get_scene_type(&self) -> u8 {
        self.scene_type
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn particle_system_creates_particles() {
        let system = ParticleSystem::new(100, 42, 3);
        assert_eq!(system.particle_count(), 100);
    }

    #[test]
    fn get_positions_returns_correct_length() {
        let system = ParticleSystem::new(100, 42, 3);
        let positions = system.get_positions();
        assert_eq!(positions.len(), 300);  // 100 particles * 3 components
    }

    #[test]
    fn get_colors_returns_correct_length() {
        let system = ParticleSystem::new(100, 42, 3);
        let colors = system.get_colors();
        assert_eq!(colors.len(), 300);  // 100 particles * 3 components
    }

    #[test]
    fn set_targets_updates_particle_targets() {
        let mut system = ParticleSystem::new(2, 42, 3);
        let targets = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];

        system.set_targets(&targets);

        // Verify particles have new targets (check via spring force)
        let force = system.particles[0].spring_force(1.0);

        // Force should point toward target
        assert_ne!(force[0], 0.0);  // Some force exists
    }

    #[test]
    fn set_targets_wraps_around() {
        let mut system = ParticleSystem::new(4, 42, 3);
        let targets = vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0];  // Only 2 targets

        system.set_targets(&targets);

        // All 4 particles should have targets (wrapped around)
        for particle in &system.particles {
            // Target should not be at origin unless explicitly set
            let target_magnitude = (particle.target[0] * particle.target[0] +
                                   particle.target[1] * particle.target[1] +
                                   particle.target[2] * particle.target[2]).sqrt();
            assert!(target_magnitude > 0.9);  // Close to 1.0
        }
    }

    #[test]
    fn update_advances_time() {
        let mut system = ParticleSystem::new(10, 42, 3);
        let initial_time = system.get_time();

        system.update(1.0 / 60.0);

        let new_time = system.get_time();
        assert!(new_time > initial_time);
    }

    #[test]
    fn update_moves_particles() {
        let mut system = ParticleSystem::new(10, 42, 3);
        let initial_positions = system.get_positions();

        // Set targets away from initial positions
        let targets: Vec<f32> = (0..30).map(|i| {
            if i % 3 == 0 { 5.0 } else { 0.0 }
        }).collect();
        system.set_targets(&targets);

        // Run simulation
        for _ in 0..60 {
            system.update(1.0 / 60.0);
        }

        let final_positions = system.get_positions();

        // Particles should have moved
        let mut total_movement = 0.0;
        for i in (0..30).step_by(3) {
            let dx = final_positions[i] - initial_positions[i];
            let dy = final_positions[i+1] - initial_positions[i+1];
            let dz = final_positions[i+2] - initial_positions[i+2];
            total_movement += (dx*dx + dy*dy + dz*dz).sqrt();
        }

        assert!(total_movement > 1.0, "Particles should move toward targets");
    }

    #[test]
    fn set_physics_params_updates_behavior() {
        let mut system = ParticleSystem::new(10, 42, 3);

        system.set_physics_params(2.0, 0.5, 0.1);

        assert_eq!(system.params.spring_stiffness, 2.0);
        assert_eq!(system.params.damping, 0.5);
        assert_eq!(system.params.curl_strength, 0.1);
    }

    #[test]
    fn empty_targets_handled_gracefully() {
        let mut system = ParticleSystem::new(10, 42, 3);
        system.set_targets(&[]);
        // Should not panic
    }

    #[test]
    fn load_art_state_stores_positions() {
        let mut system = ParticleSystem::new(10, 42, 3);
        let positions = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];

        system.load_art_state(0, &positions);

        assert_eq!(system.art_positions[0], positions);
    }

    #[test]
    fn load_art_colors_stores_colors() {
        let mut system = ParticleSystem::new(10, 42, 3);
        let colors = vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0];

        system.load_art_colors(0, &colors);

        assert_eq!(system.art_colors[0], colors);
    }

    #[test]
    fn get_colors_returns_art_colors_when_loaded() {
        let mut system = ParticleSystem::new(3, 42, 2);
        let colors = vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

        system.load_art_colors(0, &colors);

        let result = system.get_colors();
        // Should return art colors (wrapping if needed)
        assert_eq!(result[0], 1.0); // R of first art color
        assert_eq!(result[1], 0.0); // G of first art color
        assert_eq!(result[2], 0.0); // B of first art color
    }

    #[test]
    fn set_weather_updates_weather_data() {
        let mut system = ParticleSystem::new(10, 42, 3);

        system.set_weather(25.0, 60.0, 10.0, 180.0);

        assert_eq!(system.weather.temperature, 25.0);
        assert_eq!(system.weather.humidity, 60.0);
        assert_eq!(system.weather.wind_speed, 10.0);
        assert_eq!(system.weather.wind_direction, 180.0);
    }

    #[test]
    fn get_morph_phase_returns_correct_value() {
        let system = ParticleSystem::new(10, 42, 3);
        let phase = system.get_morph_phase();
        assert_eq!(phase, 0);  // Starts in Coalescing
    }
}
