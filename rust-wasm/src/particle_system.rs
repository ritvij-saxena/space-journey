use crate::curl_noise::CurlNoiseField;
use crate::physics::{Particle, PhysicsParams};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;

/// ParticleSystem manages a collection of particles and their physics simulation.
///
/// Each frame, particles are influenced by:
/// 1. Spring forces pulling them toward target positions (from art data)
/// 2. Curl noise providing organic, flowing motion
/// 3. Verlet integration for stable, realistic dynamics
///
/// The system uses multiple substeps per frame for improved stability.
pub struct ParticleSystem {
    particles: Vec<Particle>,
    curl_noise: CurlNoiseField,
    params: PhysicsParams,
    time: f64,
}

impl ParticleSystem {
    /// Create a new particle system with the specified number of particles.
    ///
    /// Particles are initialized at random positions within a [-2, 2] cube
    /// with zero initial velocity. Each particle gets a random phase offset
    /// for staggered motion patterns.
    pub fn new(num_particles: usize, seed: u32) -> Self {
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

        ParticleSystem {
            particles,
            curl_noise,
            params: PhysicsParams::default(),
            time: 0.0,
        }
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
    /// Uses 2 substeps per frame for improved stability with the given timestep.
    /// Each particle samples curl noise at its current position and combines
    /// it with spring forces to compute acceleration.
    pub fn update(&mut self, dt: f32) {
        // Use 2 substeps for better stability
        let substep_dt = dt / 2.0;

        for _ in 0..2 {
            for particle in &mut self.particles {
                // Sample curl noise at particle position
                // Cast f32 position to f64 for noise sampling
                let pos_f64 = [
                    particle.position[0] as f64,
                    particle.position[1] as f64,
                    particle.position[2] as f64,
                ];

                let curl_f64 = self.curl_noise.sample_curl(pos_f64, self.time);

                // Cast curl back to f32 for physics
                let curl = [
                    curl_f64[0] as f32,
                    curl_f64[1] as f32,
                    curl_f64[2] as f32,
                ];

                // Update particle with combined forces
                particle.update(curl, &self.params);
            }

            // Advance time
            self.time += substep_dt as f64;
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
    /// Currently returns white for all particles (placeholder).
    /// Phase 3 will implement actual color mapping from art data.
    ///
    /// Returns: [r, g, b, r, g, b, ...] where each component is 0-1
    pub fn get_colors(&self) -> Box<[f32]> {
        let mut colors = Vec::with_capacity(self.particles.len() * 3);
        for _ in &self.particles {
            colors.push(1.0);  // R
            colors.push(1.0);  // G
            colors.push(1.0);  // B
        }
        colors.into_boxed_slice()
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn particle_system_creates_particles() {
        let system = ParticleSystem::new(100, 42);
        assert_eq!(system.particle_count(), 100);
    }

    #[test]
    fn get_positions_returns_correct_length() {
        let system = ParticleSystem::new(100, 42);
        let positions = system.get_positions();
        assert_eq!(positions.len(), 300);  // 100 particles * 3 components
    }

    #[test]
    fn get_colors_returns_correct_length() {
        let system = ParticleSystem::new(100, 42);
        let colors = system.get_colors();
        assert_eq!(colors.len(), 300);  // 100 particles * 3 components
    }

    #[test]
    fn set_targets_updates_particle_targets() {
        let mut system = ParticleSystem::new(2, 42);
        let targets = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];

        system.set_targets(&targets);

        // Verify particles have new targets (check via spring force)
        let force = system.particles[0].spring_force(1.0);

        // Force should point toward target
        assert_ne!(force[0], 0.0);  // Some force exists
    }

    #[test]
    fn set_targets_wraps_around() {
        let mut system = ParticleSystem::new(4, 42);
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
        let mut system = ParticleSystem::new(10, 42);
        let initial_time = system.get_time();

        system.update(1.0 / 60.0);

        let new_time = system.get_time();
        assert!(new_time > initial_time);
    }

    #[test]
    fn update_moves_particles() {
        let mut system = ParticleSystem::new(10, 42);
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
        let mut system = ParticleSystem::new(10, 42);

        system.set_physics_params(2.0, 0.5, 0.1);

        assert_eq!(system.params.spring_stiffness, 2.0);
        assert_eq!(system.params.damping, 0.5);
        assert_eq!(system.params.curl_strength, 0.1);
    }

    #[test]
    fn empty_targets_handled_gracefully() {
        let mut system = ParticleSystem::new(10, 42);
        system.set_targets(&[]);
        // Should not panic
    }
}
