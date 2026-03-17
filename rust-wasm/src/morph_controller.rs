use rand::Rng;

/// Phases of the morphing state machine
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MorphPhase {
    Coalescing,  // Particles moving toward target positions
    Holding,     // Particles maintaining formation with subtle breathing
    Dissolving,  // Particles drifting away from formation
    Reforming,   // Particles transitioning to next art state
}

/// Pattern for staggering particle transitions
#[derive(Debug, Clone, Copy)]
pub enum TransitionPattern {
    Cascade,       // Sequential wave from first to last particle
    RandomScatter, // Random per-particle delays
    CenterOut,     // Radiates from center of formation
}

impl TransitionPattern {
    /// Randomly select a transition pattern
    fn random<R: Rng>(rng: &mut R) -> Self {
        match rng.gen_range(0..3) {
            0 => TransitionPattern::Cascade,
            1 => TransitionPattern::RandomScatter,
            _ => TransitionPattern::CenterOut,
        }
    }
}

/// Configuration for morph timing and behavior
#[derive(Debug, Clone)]
pub struct MorphConfig {
    pub coalesce_duration: f32,
    pub hold_duration_base: f32,
    pub hold_duration_variance: f32,
    pub dissolve_duration: f32,
    pub reform_duration: f32,
}

impl Default for MorphConfig {
    fn default() -> Self {
        MorphConfig {
            coalesce_duration: 8.0,
            hold_duration_base: 18.0,   // Space: longer scenic holds
            hold_duration_variance: 12.0, // 18–30s random range
            dissolve_duration: 6.0,
            reform_duration: 8.0,
        }
    }
}

/// Controls morphing between art states with organic timing and transitions
pub struct MorphController {
    current_state_index: usize,
    next_state_index: usize,
    phase: MorphPhase,
    transition_progress: f32,  // 0.0 to 1.0 during transitions
    hold_timer: f32,
    hold_target: f32,          // Randomized each hold phase
    num_states: usize,
    transition_pattern: TransitionPattern,
    config: MorphConfig,
    time_accumulator: f32,     // For breathing motion
}

impl MorphController {
    /// Create a new morph controller
    /// Starts in Coalescing phase toward state 0
    pub fn new(num_states: usize) -> Self {
        let mut rng = rand::thread_rng();

        let next_state_index = if num_states > 1 {
            rng.gen_range(1..num_states)
        } else {
            0
        };

        MorphController {
            current_state_index: 0,
            next_state_index,
            phase: MorphPhase::Coalescing,
            transition_progress: 0.0,
            hold_timer: 0.0,
            hold_target: 0.0,
            num_states,
            transition_pattern: TransitionPattern::random(&mut rng),
            config: MorphConfig::default(),
            time_accumulator: 0.0,
        }
    }

    /// Update the state machine
    pub fn update(&mut self, dt: f32) {
        self.time_accumulator += dt;

        match self.phase {
            MorphPhase::Coalescing => {
                self.transition_progress += dt / self.config.coalesce_duration;
                if self.transition_progress >= 1.0 {
                    self.transition_progress = 1.0;
                    self.enter_holding();
                }
            }
            MorphPhase::Holding => {
                self.hold_timer += dt;
                if self.hold_timer >= self.hold_target {
                    self.enter_dissolving();
                }
            }
            MorphPhase::Dissolving => {
                self.transition_progress += dt / self.config.dissolve_duration;
                if self.transition_progress >= 1.0 {
                    self.transition_progress = 1.0;
                    self.enter_reforming();
                }
            }
            MorphPhase::Reforming => {
                self.transition_progress += dt / self.config.reform_duration;
                if self.transition_progress >= 1.0 {
                    self.transition_progress = 1.0;
                    self.current_state_index = self.next_state_index;
                    self.enter_holding();
                }
            }
        }
    }

    /// Enter the Holding phase
    fn enter_holding(&mut self) {
        self.phase = MorphPhase::Holding;
        self.hold_timer = 0.0;

        let mut rng = rand::thread_rng();
        self.hold_target = self.config.hold_duration_base
            + rng.gen::<f32>() * self.config.hold_duration_variance;
    }

    /// Enter the Dissolving phase
    fn enter_dissolving(&mut self) {
        self.phase = MorphPhase::Dissolving;
        self.transition_progress = 0.0;

        let mut rng = rand::thread_rng();
        self.transition_pattern = TransitionPattern::random(&mut rng);
    }

    /// Enter the Reforming phase (transition to next state)
    fn enter_reforming(&mut self) {
        self.phase = MorphPhase::Reforming;
        self.transition_progress = 0.0;

        // Pick a random next state (avoid repeating current)
        let mut rng = rand::thread_rng();
        if self.num_states > 1 {
            loop {
                let candidate = rng.gen_range(0..self.num_states);
                if candidate != self.next_state_index {
                    self.next_state_index = candidate;
                    break;
                }
            }
        }
    }

    /// Get interpolated target position for a particle
    ///
    /// # Arguments
    /// * `particle_index` - Index of the particle
    /// * `num_particles` - Total number of particles
    /// * `current_positions` - Flattened array of current state positions [x,y,z,x,y,z,...]
    /// * `next_positions` - Flattened array of next state positions [x,y,z,x,y,z,...]
    ///
    /// # Returns
    /// [x, y, z] target position with staggering and breathing applied
    pub fn get_target_positions(
        &self,
        particle_index: usize,
        num_particles: usize,
        current_positions: &[f32],
        next_positions: &[f32],
    ) -> [f32; 3] {
        let base_idx = particle_index * 3;

        // Extract positions
        let curr = [
            current_positions[base_idx],
            current_positions[base_idx + 1],
            current_positions[base_idx + 2],
        ];

        let next = [
            next_positions[base_idx],
            next_positions[base_idx + 1],
            next_positions[base_idx + 2],
        ];

        // Calculate staggered progress
        let stagger_offset = match self.transition_pattern {
            TransitionPattern::Cascade => {
                (particle_index as f32) / (num_particles as f32)
            }
            TransitionPattern::RandomScatter => {
                // Deterministic hash-based randomization
                simple_hash(particle_index)
            }
            TransitionPattern::CenterOut => {
                // Calculate distance from center
                let center = [0.0, 0.0, 0.0]; // Could compute actual center
                let dx = curr[0] - center[0];
                let dy = curr[1] - center[1];
                let dz = curr[2] - center[2];
                let dist = (dx * dx + dy * dy + dz * dz).sqrt();
                (dist * 0.5).min(1.0) // Normalize to 0-1 range
            }
        };

        // Apply stagger to transition progress
        let stagger_amount = 0.5; // Max delay as fraction of transition — more organic spread
        let staggered_progress = ((self.transition_progress - stagger_offset * stagger_amount) / (1.0 - stagger_offset * stagger_amount))
            .clamp(0.0, 1.0);

        // Apply easing
        let eased_progress = match self.phase {
            MorphPhase::Coalescing | MorphPhase::Reforming => {
                ease_in_out_cubic(staggered_progress)
            }
            MorphPhase::Dissolving => {
                ease_in_out_cubic(staggered_progress)
            }
            MorphPhase::Holding => {
                1.0 // Fully at current position during hold
            }
        };

        // Interpolate between states
        let mut result = [
            curr[0] + (next[0] - curr[0]) * eased_progress,
            curr[1] + (next[1] - curr[1]) * eased_progress,
            curr[2] + (next[2] - curr[2]) * eased_progress,
        ];

        // Add breathing motion during hold phase
        if self.phase == MorphPhase::Holding {
            let breath_amount = 0.04; // Subtle displacement for living feel
            let breath_speed = 0.3;  // Slower breathing cycle
            let breath = (self.time_accumulator * breath_speed).sin() * breath_amount;

            // Apply breathing based on particle position (creates organic variation)
            let particle_phase = simple_hash(particle_index) * std::f32::consts::PI * 2.0;
            result[0] += breath * (particle_phase).cos();
            result[1] += breath * (particle_phase + 2.0).cos();
            result[2] += breath * (particle_phase + 4.0).cos();
        }

        result
    }

    /// Get current phase
    pub fn phase(&self) -> &MorphPhase {
        &self.phase
    }

    /// Get current art state index
    pub fn current_state_index(&self) -> usize {
        self.current_state_index
    }

    /// Get next art state index
    pub fn next_state_index(&self) -> usize {
        self.next_state_index
    }

    /// Check if currently transitioning between states
    pub fn is_transitioning(&self) -> bool {
        matches!(self.phase, MorphPhase::Coalescing | MorphPhase::Reforming)
    }

    /// Get current transition progress (0.0..=1.0 within the current phase).
    /// Used for color interpolation in the flat buffer update path.
    pub fn get_transition_progress(&self) -> f32 {
        self.transition_progress
    }

    /// Get tether strength multiplier
    /// Controls how strongly particles are pulled toward target positions
    ///
    /// Returns:
    /// - 1.0 during Coalescing and Holding (strong tether)
    /// - 0.0 at peak of Dissolving (free drift)
    /// - Ramping during transitions
    pub fn get_tether_strength(&self) -> f32 {
        match self.phase {
            MorphPhase::Coalescing => {
                // Ramp up from 0 to 1 during coalescing
                ease_in_out_cubic(self.transition_progress)
            }
            MorphPhase::Holding => 1.0,
            MorphPhase::Dissolving => {
                // Ramp down from 1 to 0 during dissolving
                1.0 - ease_in_out_cubic(self.transition_progress)
            }
            MorphPhase::Reforming => {
                // Ramp up from 0 to 1 during reforming
                ease_in_out_cubic(self.transition_progress)
            }
        }
    }
}

/// Cubic ease-in-out function
/// Input and output are in range [0, 1]
fn ease_in_out_cubic(t: f32) -> f32 {
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}

/// Simple deterministic hash for per-particle randomization
/// Returns value in range [0, 1]
fn simple_hash(index: usize) -> f32 {
    // Simple multiplicative hash
    let h = index.wrapping_mul(2654435761);
    ((h ^ (h >> 16)) & 0xFFFF) as f32 / 65535.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ease_in_out_cubic() {
        assert!((ease_in_out_cubic(0.0) - 0.0).abs() < 0.001);
        assert!((ease_in_out_cubic(0.5) - 0.5).abs() < 0.001);
        assert!((ease_in_out_cubic(1.0) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_simple_hash() {
        let h1 = simple_hash(0);
        let h2 = simple_hash(1);
        let h3 = simple_hash(100);

        assert!(h1 >= 0.0 && h1 <= 1.0);
        assert!(h2 >= 0.0 && h2 <= 1.0);
        assert!(h3 >= 0.0 && h3 <= 1.0);
        assert_ne!(h1, h2);
        assert_ne!(h2, h3);
    }

    #[test]
    fn test_morph_controller_initialization() {
        let controller = MorphController::new(5);
        assert_eq!(*controller.phase(), MorphPhase::Coalescing);
        assert_eq!(controller.transition_progress, 0.0);
        assert!(controller.is_transitioning());
    }

    #[test]
    fn test_phase_transitions() {
        let mut controller = MorphController::new(3);

        // Start in Coalescing
        assert_eq!(*controller.phase(), MorphPhase::Coalescing);

        // Advance through coalescing (8s duration)
        controller.update(8.0);
        assert_eq!(*controller.phase(), MorphPhase::Holding);

        // Advance through holding
        controller.update(controller.hold_target);
        assert_eq!(*controller.phase(), MorphPhase::Dissolving);

        // Advance through dissolving (6s duration)
        controller.update(6.0);
        assert_eq!(*controller.phase(), MorphPhase::Reforming);

        // Advance through reforming (8s duration)
        controller.update(8.0);
        assert_eq!(*controller.phase(), MorphPhase::Holding);
    }

    #[test]
    fn test_tether_strength() {
        let mut controller = MorphController::new(3);

        // At start of coalescing
        assert!((controller.get_tether_strength() - 0.0).abs() < 0.001);

        // Halfway through coalescing
        controller.transition_progress = 0.5;
        assert!(controller.get_tether_strength() > 0.0);

        // At end of coalescing
        controller.transition_progress = 1.0;
        assert!((controller.get_tether_strength() - 1.0).abs() < 0.001);

        // During holding
        controller.phase = MorphPhase::Holding;
        assert_eq!(controller.get_tether_strength(), 1.0);

        // During dissolving
        controller.phase = MorphPhase::Dissolving;
        controller.transition_progress = 0.5;
        assert!(controller.get_tether_strength() > 0.0 && controller.get_tether_strength() < 1.0);
    }
}
