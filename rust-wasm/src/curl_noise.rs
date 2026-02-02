use noise::{Fbm, NoiseFn, Perlin};

/// CurlNoiseField generates divergence-free flow fields using curl noise.
///
/// Curl noise is computed by taking the curl of a 3D vector potential field F = (Fx, Fy, Fz),
/// where each component is an independent fractal noise function. The result is smooth,
/// swirling flow patterns that naturally avoid singularities.
pub struct CurlNoiseField {
    noise_x: Fbm<Perlin>,
    noise_y: Fbm<Perlin>,
    noise_z: Fbm<Perlin>,
}

impl CurlNoiseField {
    /// Create a new curl noise field with the given seed.
    ///
    /// Uses three independent FBM noise fields with different seeds to ensure
    /// each component of the potential field is uncorrelated.
    pub fn new(seed: u32) -> Self {
        let mut noise_x = Fbm::<Perlin>::new(seed);
        noise_x.octaves = 6;
        noise_x.frequency = 1.0;
        noise_x.lacunarity = 2.0;
        noise_x.persistence = 0.5;

        let mut noise_y = Fbm::<Perlin>::new(seed.wrapping_add(1));
        noise_y.octaves = 6;
        noise_y.frequency = 1.0;
        noise_y.lacunarity = 2.0;
        noise_y.persistence = 0.5;

        let mut noise_z = Fbm::<Perlin>::new(seed.wrapping_add(2));
        noise_z.octaves = 6;
        noise_z.frequency = 1.0;
        noise_z.lacunarity = 2.0;
        noise_z.persistence = 0.5;

        CurlNoiseField {
            noise_x,
            noise_y,
            noise_z,
        }
    }

    /// Sample the curl noise field at a given position and time.
    ///
    /// Returns a divergence-free 3D vector representing the flow direction and magnitude.
    /// Time is added to the z-coordinate to create evolving flow patterns.
    pub fn sample_curl(&self, pos: [f64; 3], time: f64) -> [f64; 3] {
        let epsilon = 0.001;
        let [x, y, z] = pos;
        let z_time = z + time;

        // Sample potential field F = (Fx, Fy, Fz) and compute partial derivatives
        // using central differences

        // Fx derivatives
        let fx_yp = self.noise_x.get([x, y + epsilon, z_time]);
        let fx_yn = self.noise_x.get([x, y - epsilon, z_time]);
        let fx_zp = self.noise_x.get([x, y, z_time + epsilon]);
        let fx_zn = self.noise_x.get([x, y, z_time - epsilon]);

        let dfx_dy = (fx_yp - fx_yn) / (2.0 * epsilon);
        let dfx_dz = (fx_zp - fx_zn) / (2.0 * epsilon);

        // Fy derivatives
        let fy_xp = self.noise_y.get([x + epsilon, y, z_time]);
        let fy_xn = self.noise_y.get([x - epsilon, y, z_time]);
        let fy_zp = self.noise_y.get([x, y, z_time + epsilon]);
        let fy_zn = self.noise_y.get([x, y, z_time - epsilon]);

        let dfy_dx = (fy_xp - fy_xn) / (2.0 * epsilon);
        let dfy_dz = (fy_zp - fy_zn) / (2.0 * epsilon);

        // Fz derivatives
        let fz_xp = self.noise_z.get([x + epsilon, y, z_time]);
        let fz_xn = self.noise_z.get([x - epsilon, y, z_time]);
        let fz_yp = self.noise_z.get([x, y + epsilon, z_time]);
        let fz_yn = self.noise_z.get([x, y - epsilon, z_time]);

        let dfz_dx = (fz_xp - fz_xn) / (2.0 * epsilon);
        let dfz_dy = (fz_yp - fz_yn) / (2.0 * epsilon);

        // Curl formula: ∇ × F = (∂Fz/∂y - ∂Fy/∂z, ∂Fx/∂z - ∂Fz/∂x, ∂Fy/∂x - ∂Fx/∂y)
        [
            dfz_dy - dfy_dz,
            dfx_dz - dfz_dx,
            dfy_dx - dfx_dy,
        ]
    }

    /// Adjust the frequency of the noise field to control turbulence scale.
    ///
    /// Higher frequency = more turbulent, smaller-scale features
    /// Lower frequency = smoother, larger-scale flow
    pub fn set_frequency(&mut self, freq: f64) {
        self.noise_x.frequency = freq;
        self.noise_y.frequency = freq;
        self.noise_z.frequency = freq;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curl_noise_is_divergence_free_approximately() {
        let field = CurlNoiseField::new(42);
        let pos = [0.5, 0.5, 0.5];
        let epsilon = 0.01;
        let time = 0.0;

        // Sample curl at position and neighboring points
        let curl_c = field.sample_curl(pos, time);
        let curl_xp = field.sample_curl([pos[0] + epsilon, pos[1], pos[2]], time);
        let curl_xn = field.sample_curl([pos[0] - epsilon, pos[1], pos[2]], time);
        let curl_yp = field.sample_curl([pos[0], pos[1] + epsilon, pos[2]], time);
        let curl_yn = field.sample_curl([pos[0], pos[1] - epsilon, pos[2]], time);
        let curl_zp = field.sample_curl([pos[0], pos[1], pos[2] + epsilon], time);
        let curl_zn = field.sample_curl([pos[0], pos[1], pos[2] - epsilon], time);

        // Compute divergence using central differences
        let dcx_dx = (curl_xp[0] - curl_xn[0]) / (2.0 * epsilon);
        let dcy_dy = (curl_yp[1] - curl_yn[1]) / (2.0 * epsilon);
        let dcz_dz = (curl_zp[2] - curl_zn[2]) / (2.0 * epsilon);
        let divergence = dcx_dx + dcy_dy + dcz_dz;

        // Divergence should be very small (numerical errors only)
        assert!(divergence.abs() < 0.1, "Divergence: {}", divergence);
    }

    #[test]
    fn curl_noise_varies_with_time() {
        let field = CurlNoiseField::new(42);
        let pos = [0.5, 0.5, 0.5];

        let curl_t0 = field.sample_curl(pos, 0.0);
        let curl_t1 = field.sample_curl(pos, 1.0);

        // Flow should change over time
        let diff = [
            curl_t1[0] - curl_t0[0],
            curl_t1[1] - curl_t0[1],
            curl_t1[2] - curl_t0[2],
        ];
        let magnitude = (diff[0]*diff[0] + diff[1]*diff[1] + diff[2]*diff[2]).sqrt();
        assert!(magnitude > 0.01, "Flow should evolve with time");
    }

    #[test]
    fn set_frequency_affects_output() {
        let mut field = CurlNoiseField::new(42);
        let pos = [0.5, 0.5, 0.5];

        field.set_frequency(1.0);
        let curl_freq1 = field.sample_curl(pos, 0.0);

        field.set_frequency(2.0);
        let curl_freq2 = field.sample_curl(pos, 0.0);

        // Different frequencies should produce different results
        assert_ne!(curl_freq1[0], curl_freq2[0]);
    }
}
