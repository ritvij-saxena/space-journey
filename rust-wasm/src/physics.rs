/// Physics parameters controlling particle motion.
#[derive(Debug, Clone)]
pub struct PhysicsParams {
    /// Stiffness of the spring tether to the target position (Hooke's law constant)
    pub spring_stiffness: f32,
    /// Velocity damping factor (0 = no damping, 1 = full damping)
    pub damping: f32,
    /// Strength of curl noise influence on particle motion
    pub curl_strength: f32,
    /// Time step for physics integration
    pub dt: f32,
}

impl Default for PhysicsParams {
    fn default() -> Self {
        PhysicsParams {
            spring_stiffness: 0.06,  // Very soft springs - liquid drift toward targets
            damping: 0.012,          // Low damping - particles carry momentum
            curl_strength: 0.8,      // Gentle curl noise - smooth flowing turbulence
            dt: 1.0 / 60.0,
        }
    }
}

/// A particle with position-based dynamics using Verlet integration.
///
/// Each particle has a current position, previous position (for velocity computation),
/// and a target position it's tethered to via a spring force.
#[derive(Debug, Clone)]
pub struct Particle {
    pub position: [f32; 3],
    pub prev_position: [f32; 3],
    pub target: [f32; 3],
    /// Random phase offset for staggered motion (0 to 2π)
    pub phase_offset: f32,
}

impl Particle {
    /// Create a new particle at the given position with zero initial velocity.
    pub fn new(position: [f32; 3], phase_offset: f32) -> Self {
        Particle {
            position,
            prev_position: position,  // Zero initial velocity
            target: [0.0, 0.0, 0.0],
            phase_offset,
        }
    }

    /// Compute spring force toward the target position using Hooke's law.
    ///
    /// F = -k * displacement
    pub fn spring_force(&self, stiffness: f32) -> [f32; 3] {
        [
            (self.target[0] - self.position[0]) * stiffness,
            (self.target[1] - self.position[1]) * stiffness,
            (self.target[2] - self.position[2]) * stiffness,
        ]
    }

    /// Update particle position using Verlet integration with damping.
    ///
    /// Verlet integration: x(t+dt) = x(t) + v(t)*dt + a(t)*dt^2
    /// Where velocity v(t) = (x(t) - x(t-dt)) * (1 - damping)
    ///
    /// This method is stable, energy-conserving, and doesn't require explicit velocity storage.
    pub fn verlet_integrate(&mut self, acceleration: [f32; 3], dt: f32, damping: f32) {
        // Compute velocity from position difference, apply damping
        let velocity = [
            (self.position[0] - self.prev_position[0]) * (1.0 - damping),
            (self.position[1] - self.prev_position[1]) * (1.0 - damping),
            (self.position[2] - self.prev_position[2]) * (1.0 - damping),
        ];

        // Store current position
        let current_position = self.position;

        // Integrate: new_position = position + velocity + acceleration * dt^2
        self.position = [
            self.position[0] + velocity[0] + acceleration[0] * dt * dt,
            self.position[1] + velocity[1] + acceleration[1] * dt * dt,
            self.position[2] + velocity[2] + acceleration[2] * dt * dt,
        ];

        // Update previous position
        self.prev_position = current_position;
    }

    /// Update particle for one physics step.
    ///
    /// Combines spring force (toward target) and curl force (organic flow),
    /// then integrates using Verlet method.
    pub fn update(&mut self, curl: [f32; 3], params: &PhysicsParams) {
        // Compute spring force toward target
        let spring = self.spring_force(params.spring_stiffness);

        // Combine forces: spring pulls toward target, curl adds organic flow
        let total_acceleration = [
            spring[0] + curl[0] * params.curl_strength,
            spring[1] + curl[1] * params.curl_strength,
            spring[2] + curl[2] * params.curl_strength,
        ];

        // Integrate position
        self.verlet_integrate(total_acceleration, params.dt, params.damping);
    }

    /// Set the target position this particle is tethered to.
    pub fn set_target(&mut self, target: [f32; 3]) {
        self.target = target;
    }

    /// Get current velocity (computed from position difference).
    pub fn velocity(&self) -> [f32; 3] {
        [
            self.position[0] - self.prev_position[0],
            self.position[1] - self.prev_position[1],
            self.position[2] - self.prev_position[2],
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn particle_starts_at_rest() {
        let particle = Particle::new([1.0, 2.0, 3.0], 0.0);
        let velocity = particle.velocity();
        assert_eq!(velocity, [0.0, 0.0, 0.0]);
    }

    #[test]
    fn spring_force_pulls_toward_target() {
        let mut particle = Particle::new([0.0, 0.0, 0.0], 0.0);
        particle.set_target([1.0, 0.0, 0.0]);

        let force = particle.spring_force(2.0);
        assert_eq!(force[0], 2.0);  // Should pull in +x direction
        assert_eq!(force[1], 0.0);
        assert_eq!(force[2], 0.0);
    }

    #[test]
    fn verlet_integration_moves_particle() {
        let mut particle = Particle::new([0.0, 0.0, 0.0], 0.0);
        let acceleration = [1.0, 0.0, 0.0];
        let dt = 0.1;

        particle.verlet_integrate(acceleration, dt, 0.0);

        // Position should change
        assert!(particle.position[0] > 0.0);

        // Velocity should exist
        let velocity = particle.velocity();
        assert!(velocity[0] > 0.0);
    }

    #[test]
    fn damping_reduces_velocity() {
        let mut particle = Particle::new([0.0, 0.0, 0.0], 0.0);

        // Give it some velocity
        particle.prev_position = [-0.1, 0.0, 0.0];
        particle.position = [0.0, 0.0, 0.0];

        let initial_velocity = particle.velocity();

        // Integrate with high damping
        particle.verlet_integrate([0.0, 0.0, 0.0], 0.1, 0.5);

        let damped_velocity = particle.velocity();

        // Velocity magnitude should decrease
        let initial_speed = initial_velocity[0].abs();
        let damped_speed = damped_velocity[0].abs();
        assert!(damped_speed < initial_speed);
    }

    #[test]
    fn update_combines_spring_and_curl() {
        let mut particle = Particle::new([0.0, 0.0, 0.0], 0.0);
        particle.set_target([1.0, 0.0, 0.0]);

        let params = PhysicsParams::default();
        let curl = [0.0, 0.5, 0.0];

        particle.update(curl, &params);

        // Particle should move toward target (spring) and up (curl)
        assert!(particle.position[0] > 0.0);  // Spring pulls right
        assert!(particle.position[1] > 0.0);  // Curl pushes up
    }
}
