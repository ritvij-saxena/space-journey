use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use noise::{NoiseFn, Perlin};

const TAU: f32 = std::f32::consts::TAU;

/// Dispatch to scene generator. Returns interleaved [x,y,z,r,g,b, ...] per particle.
pub fn generate_scene(scene_type: u8, count: usize, seed: u32) -> Vec<f32> {
    match scene_type {
        0 => generate_starfield(count, seed),
        1 => generate_nebula(count, seed),
        2 => generate_black_hole(count, seed),
        3 => generate_galaxy(count, seed),
        4 => generate_wormhole(count, seed),
        5 => generate_cloud(count, seed),
        _ => generate_starfield(count, seed),
    }
}

// ─── Scene 0: Starfield ──────────────────────────────────────────────────────

fn generate_starfield(count: usize, seed: u32) -> Vec<f32> {
    let mut rng = StdRng::seed_from_u64(seed as u64);
    let mut data = Vec::with_capacity(count * 6);

    for _ in 0..count {
        // Random sphere with galactic-plane Y-flattening
        let theta = rng.gen_range(0.0..TAU);
        let cos_phi: f32 = rng.gen_range(-1.0..1.0);
        let sin_phi = (1.0 - cos_phi * cos_phi).sqrt();
        let r: f32 = rng.gen_range(0.3..1.6);

        let x = r * sin_phi * theta.cos();
        let y = r * cos_phi * 0.3; // galactic plane flattening
        let z = r * sin_phi * theta.sin();

        let class_roll: f32 = rng.gen();
        let brightness: f32 = rng.gen_range(0.4..1.0);
        let (rc, gc, bc) = if class_roll < 0.04 {
            // O class: hot blue-white
            (0.7 * brightness, 0.85 * brightness, brightness)
        } else if class_roll < 0.15 {
            // B class: blue-white
            (0.8 * brightness, 0.9 * brightness, brightness)
        } else if class_roll < 0.30 {
            // A/F class: white-yellow
            (brightness, brightness, 0.88 * brightness)
        } else if class_roll < 0.50 {
            // G class: sun-yellow
            (brightness, 0.92 * brightness, 0.55 * brightness)
        } else if class_roll < 0.72 {
            // K class: orange
            (brightness, 0.65 * brightness, 0.28 * brightness)
        } else {
            // M class: red-orange (most common)
            (brightness, 0.38 * brightness, 0.12 * brightness)
        };

        data.extend_from_slice(&[x, y, z, rc, gc, bc]);
    }
    data
}

// ─── Scene 1: Emission Nebula ─────────────────────────────────────────────────

fn generate_nebula(count: usize, seed: u32) -> Vec<f32> {
    let mut rng = StdRng::seed_from_u64(seed as u64);
    let perlin = Perlin::new(seed);
    let mut data = Vec::with_capacity(count * 6);

    // Sub-palette driven by seed: 0=HII classic, 1=planetary, 2=supernova remnant
    let palette: u8 = (seed % 3) as u8;

    let mut placed = 0;
    let mut attempts = 0;
    while placed < count && attempts < count * 20 {
        attempts += 1;
        // Sample from a sphere (not a box) so the distribution projects as a circle from any angle
        let x: f32 = rng.gen_range(-1.3..1.3);
        let y: f32 = rng.gen_range(-1.3..1.3);
        let z: f32 = rng.gen_range(-1.3..1.3);
        if x * x + y * y + z * z > 1.3 * 1.3 { continue; } // spherical rejection

        let density = nebula_density(x, y, z, &perlin);
        if rng.gen::<f32>() < density {
            let (rc, gc, bc) = nebula_color(density, palette, &mut rng);
            data.extend_from_slice(&[x, y, z, rc, gc, bc]);
            placed += 1;
        }
    }
    // Sparse fill for any remaining slots — also spherically bounded
    while placed < count {
        let x: f32 = rng.gen_range(-1.4..1.4);
        let y: f32 = rng.gen_range(-1.4..1.4);
        let z: f32 = rng.gen_range(-1.4..1.4);
        if x * x + y * y + z * z > 1.4 * 1.4 { continue; }
        let dim: f32 = rng.gen_range(0.05..0.15);
        let (rc, gc, bc) = nebula_color(0.1, palette, &mut rng);
        data.extend_from_slice(&[x, y, z, rc * dim * 2.0, gc * dim * 2.0, bc * dim * 2.0]);
        placed += 1;
    }
    data
}

fn nebula_density(x: f32, y: f32, z: f32, perlin: &Perlin) -> f32 {
    // Radial Gaussian falloff: density highest at center, smooth falloff to edge.
    // This makes the cloud one smooth sphere rather than multiple Perlin clumps.
    let r = (x * x + y * y + z * z).sqrt();
    let radial = (-r * r / (2.0 * 0.55 * 0.55)).exp(); // sigma=0.55 Gaussian

    // Perlin adds internal wispy filament structure within the Gaussian envelope
    let s = 1.6f64;
    let n1 = perlin.get([x as f64 * s,               y as f64 * s,           z as f64 * s          ]) as f32;
    let n2 = perlin.get([x as f64 * s * 2.1 + 7.3,   y as f64 * s * 2.1,     z as f64 * s * 2.1 + 3.1]) as f32;
    let combined = n1 * 0.6 + n2 * 0.4;
    let noise_density = (combined + 1.0) * 0.5;

    // Multiply: Perlin texture inside Gaussian envelope
    (noise_density * radial * 2.0).clamp(0.0, 1.0)
}

fn nebula_color(density: f32, palette: u8, rng: &mut StdRng) -> (f32, f32, f32) {
    let j: f32 = rng.gen_range(-0.06..0.06);
    match palette {
        0 => {
            // Hubble HII: H-alpha pink, O-III teal, S-II orange
            if density > 0.70 {
                ((0.92 + j).clamp(0.0, 1.0), (0.28 + j).clamp(0.0, 1.0), (0.52 + j).clamp(0.0, 1.0))
            } else if density > 0.42 {
                ((0.18 + j).clamp(0.0, 1.0), (0.85 + j).clamp(0.0, 1.0), (0.82 + j).clamp(0.0, 1.0))
            } else {
                ((0.92 + j).clamp(0.0, 1.0), (0.55 + j).clamp(0.0, 1.0), (0.18 + j).clamp(0.0, 1.0))
            }
        }
        1 => {
            // Planetary nebula: blue-green core, red shell
            if density > 0.60 {
                ((0.35 + j).clamp(0.0, 1.0), (0.68 + j).clamp(0.0, 1.0), 1.0)
            } else {
                ((0.90 + j).clamp(0.0, 1.0), (0.28 + j).clamp(0.0, 1.0), (0.18 + j).clamp(0.0, 1.0))
            }
        }
        _ => {
            // Supernova remnant: magenta/purple
            if density > 0.50 {
                ((0.82 + j).clamp(0.0, 1.0), 0.15, (0.90 + j).clamp(0.0, 1.0))
            } else {
                ((0.45 + j).clamp(0.0, 1.0), 0.08, (0.60 + j).clamp(0.0, 1.0))
            }
        }
    }
}

// ─── Scene 2: Black Hole ─────────────────────────────────────────────────────

fn generate_black_hole(count: usize, seed: u32) -> Vec<f32> {
    let mut rng = StdRng::seed_from_u64(seed as u64);
    let mut data = Vec::with_capacity(count * 6);

    let disk_tilt: f32 = rng.gen_range(0.0..0.35);
    let jet_brightness: f32 = rng.gen_range(0.55..1.0);

    let disk_count  = (count as f32 * 0.60) as usize;
    let jet_count   = (count as f32 * 0.10) as usize;
    let star_count  = count - disk_count - jet_count;

    // Accretion disk: torus in xz plane
    for _ in 0..disk_count {
        let angle = rng.gen_range(0.0..TAU);
        let r: f32 = rng.gen_range(0.18..0.88);
        let thickness: f32 = rng.gen_range(-0.06..0.06) * (1.0 - r / 0.88).max(0.0);

        let x_base = r * angle.cos();
        let z_base = r * angle.sin();
        let y_base = thickness;

        // Slight tilt (Doppler tilt)
        let x = x_base;
        let y = y_base * disk_tilt.cos() - z_base * disk_tilt.sin() * 0.15;
        let z = z_base;

        let norm_r = ((r - 0.18) / 0.70).clamp(0.0, 1.0);
        let (rc, gc, bc) = if norm_r < 0.20 {
            // Inner: near-white hot
            (0.90 + rng.gen::<f32>() * 0.10, 0.88 + rng.gen::<f32>() * 0.12, 1.0)
        } else if norm_r < 0.60 {
            // Mid: orange-yellow (Doppler peak)
            let f = (norm_r - 0.20) / 0.40;
            (1.0, 0.55 + f * 0.25, 0.08 + f * 0.15)
        } else {
            // Outer: dim red
            let dim: f32 = rng.gen_range(0.25..0.50);
            (dim, dim * 0.18, 0.0)
        };
        data.extend_from_slice(&[x, y, z, rc, gc, bc]);
    }

    // Relativistic jets along ±y axis
    for _ in 0..jet_count {
        let sign: f32 = if rng.gen::<bool>() { 1.0 } else { -1.0 };
        let y: f32 = sign * rng.gen_range(0.25..1.45);
        let spread = rng.gen_range(0.0..0.06) * (1.0 - y.abs() / 1.45).max(0.0);
        let jet_angle = rng.gen_range(0.0..TAU);
        let x = spread * jet_angle.cos();
        let z = spread * jet_angle.sin();
        let b = jet_brightness;
        data.extend_from_slice(&[x, y, z, 0.65 * b, 0.82 * b, b]);
    }

    // Background stars
    for _ in 0..star_count {
        let theta = rng.gen_range(0.0..TAU);
        let cos_phi: f32 = rng.gen_range(-1.0..1.0);
        let sin_phi = (1.0 - cos_phi * cos_phi).sqrt();
        let r: f32 = rng.gen_range(1.0..1.9);
        let x = r * sin_phi * theta.cos();
        let y = r * cos_phi;
        let z = r * sin_phi * theta.sin();
        let dim: f32 = rng.gen_range(0.08..0.30);
        data.extend_from_slice(&[x, y, z, dim, dim, dim]);
    }

    data
}

// ─── Scene 3: Spiral Galaxy ──────────────────────────────────────────────────

fn generate_galaxy(count: usize, seed: u32) -> Vec<f32> {
    let mut rng = StdRng::seed_from_u64(seed as u64);
    let mut data = Vec::with_capacity(count * 6);

    // Face-on inclination (0) → edge-on (~1.4)
    let inclination: f32 = rng.gen_range(0.0..1.35);
    let arm_count: u32 = if seed % 2 == 0 { 2 } else { 4 };

    let bulge_n = (count as f32 * 0.30) as usize;
    let arm_n   = (count as f32 * 0.60) as usize;
    let halo_n  = count - bulge_n - arm_n;

    // Bulge: compact oblate spheroid
    for _ in 0..bulge_n {
        let theta = rng.gen_range(0.0..TAU);
        let cos_phi: f32 = rng.gen_range(-1.0..1.0);
        let sin_phi = (1.0 - cos_phi * cos_phi).sqrt();
        let u: f32 = rng.gen::<f32>().max(1e-6);
        let v: f32 = rng.gen();
        let gauss = (-2.0 * u.ln()).sqrt() * (TAU * v).cos();
        let r = (gauss.abs() * 0.18).min(0.42);

        let x0 = r * sin_phi * theta.cos();
        let y0 = r * sin_phi * theta.sin() * 0.55;
        let z0 = r * cos_phi * 0.28;

        let (x, y, z) = tilt_xz(x0, y0, z0, inclination);

        let w: f32 = rng.gen_range(0.65..1.0);
        data.extend_from_slice(&[x, y, z, w, w * 0.84, w * 0.38]);
    }

    // Spiral arms in XY plane (camera at +z sees face-on view)
    let a = 0.14f32;
    let b = 0.26f32;
    for _ in 0..arm_n {
        let arm_idx = rng.gen_range(0..arm_count) as f32;
        let arm_offset = arm_idx * TAU / arm_count as f32;
        let theta_arm: f32 = rng.gen_range(0.4..4.8);
        let r_base = a * (b * theta_arm).exp();

        let scatter_r: f32 = rng.gen_range(-0.08..0.08);
        let scatter_t: f32 = rng.gen_range(-0.09..0.09);
        let r = (r_base + scatter_r).clamp(0.1, 1.25);
        let angle = theta_arm + arm_offset + scatter_t;

        let x0 = r * angle.cos();
        let y0 = r * angle.sin();
        let z0: f32 = rng.gen_range(-0.04..0.04);

        let (x, y, z) = tilt_xz(x0, y0, z0, inclination);

        let arm_type: f32 = rng.gen();
        let (rc, gc, bc) = if arm_type < 0.65 {
            // Blue-white young stars
            let br: f32 = rng.gen_range(0.45..0.90);
            (br * 0.72, br * 0.86, br)
        } else {
            // Pink HII regions
            (0.90, 0.38 + rng.gen::<f32>() * 0.18, 0.52 + rng.gen::<f32>() * 0.20)
        };
        data.extend_from_slice(&[x, y, z, rc, gc, bc]);
    }

    // Halo: large diffuse sphere
    for _ in 0..halo_n {
        let theta = rng.gen_range(0.0..TAU);
        let cos_phi: f32 = rng.gen_range(-1.0..1.0);
        let sin_phi = (1.0 - cos_phi * cos_phi).sqrt();
        let r: f32 = rng.gen_range(0.85..1.55);
        let x = r * sin_phi * theta.cos();
        let y = r * cos_phi;
        let z = r * sin_phi * theta.sin();
        let dim: f32 = rng.gen_range(0.07..0.22);
        data.extend_from_slice(&[x, y, z, dim, dim * 0.72, 0.0]);
    }

    data
}

/// Tilt a point in the XY plane by rotating around the X axis.
/// inclination=0 → face-on (xy plane), inclination=π/2 → edge-on.
fn tilt_xz(x: f32, y: f32, z: f32, inclination: f32) -> (f32, f32, f32) {
    let c = inclination.cos();
    let s = inclination.sin();
    (x, y * c - z * s, y * s + z * c)
}

// ─── Scene 4: Wormhole ────────────────────────────────────────────────────────

fn generate_wormhole(count: usize, seed: u32) -> Vec<f32> {
    let mut rng = StdRng::seed_from_u64(seed as u64);
    let mut data = Vec::with_capacity(count * 6);

    let ring_n  = (count as f32 * 0.65) as usize;
    let swirl_n = (count as f32 * 0.25) as usize;
    let glow_n  = count - ring_n - swirl_n;

    // Einstein rings in XY plane, shrinking as z decreases toward throat
    for i in 0..ring_n {
        let t = i as f32 / ring_n as f32; // 0=entrance, 1=throat
        let z = 0.80 * (1.0 - t);        // z: 0.8 (entrance) → 0.0 (throat)
        let ring_r = 0.88 * (1.0 - t * 0.96).max(0.02);

        let angle: f32 = rng.gen_range(0.0..TAU);
        let r_s: f32 = rng.gen_range(-0.03..0.03);
        let r = (ring_r + r_s).max(0.02);
        let x = r * angle.cos();
        let y = r * angle.sin();

        let (rc, gc, bc) = if t < 0.35 {
            let br: f32 = 0.5 + rng.gen::<f32>() * 0.5;
            (br * 0.28, br * 0.60, br)                 // blue lensing
        } else if t < 0.70 {
            (0.50 + t * 0.30, 0.10, 0.80 - t * 0.55)  // purple transition
        } else {
            (0.90 + rng.gen::<f32>() * 0.10, 0.42 + rng.gen::<f32>() * 0.28, 0.04) // orange exit
        };
        data.extend_from_slice(&[x, y, z, rc, gc, bc]);
    }

    // Swirl: spiral trajectories entering the throat
    for _ in 0..swirl_n {
        let t: f32 = rng.gen();
        let theta = t * TAU * 3.0;
        let r = ((1.0 - t) * 0.85 + rng.gen_range(-0.04..0.04f32)).max(0.0);
        let x = r * theta.cos();
        let y = r * theta.sin();
        let z = (1.0 - t) * 0.78 + rng.gen_range(-0.03..0.03f32);
        let rc = 0.28 + t * 0.62;
        let gc = 0.08;
        let bc = (0.82 - t * 0.72).max(0.0);
        data.extend_from_slice(&[x, y, z, rc, gc, bc]);
    }

    // Outer diffuse lensing glow ring at entrance (z ≈ 0.75)
    for _ in 0..glow_n {
        let angle = rng.gen_range(0.0..TAU);
        let r: f32 = rng.gen_range(0.86..1.30);
        let x = r * angle.cos() + rng.gen_range(-0.08..0.08f32);
        let y = r * angle.sin() + rng.gen_range(-0.08..0.08f32);
        let z: f32 = rng.gen_range(0.50..0.85);
        let dim: f32 = rng.gen_range(0.12..0.35);
        data.extend_from_slice(&[x, y, z, 0.18 * dim, 0.48 * dim, dim]);
    }

    data
}

// ─── Scene 5: Interstellar Cloud ─────────────────────────────────────────────

fn generate_cloud(count: usize, seed: u32) -> Vec<f32> {
    let mut rng = StdRng::seed_from_u64(seed as u64);
    let perlin = Perlin::new(seed);
    let mut data = Vec::with_capacity(count * 6);

    // Pillar offsets: 2-3 column structures in xz
    let pillar_x: [f32; 2] = [-0.42, 0.42];
    let pillar_z: [f32; 2] = [0.0,   0.1];

    let mut placed = 0;
    let mut attempts = 0;
    while placed < count && attempts < count * 16 {
        attempts += 1;
        let x: f32 = rng.gen_range(-1.3..1.3);
        let y: f32 = rng.gen_range(-1.3..1.3);
        let z: f32 = rng.gen_range(-0.55..0.55);

        // Column pillar bias: proximity to pillar axes
        let column_bias = pillar_x.iter().zip(pillar_z.iter()).map(|(&px, &pz)| {
            let d = ((x - px).powi(2) + (z - pz).powi(2)).sqrt();
            (0.35 - d * 0.55).max(0.0)
        }).fold(0.0f32, f32::max);

        let scale = 2.2f64;
        let n1 = perlin.get([x as f64 * scale,           y as f64 * scale,          z as f64 * scale          ]) as f32;
        let n2 = perlin.get([x as f64 * scale * 2.0 + 5.7, y as f64 * scale * 2.0, z as f64 * scale * 2.0]) as f32;
        let density = ((n1 * 0.6 + n2 * 0.4 + 1.0) * 0.5 + column_bias).min(0.98);

        if rng.gen::<f32>() < density {
            let (rc, gc, bc) = if density > 0.82 {
                // Dense core: dark reddish-brown
                let d: f32 = rng.gen_range(0.28..0.48);
                (d, d * 0.28, d * 0.08)
            } else if density > 0.62 {
                // Ionized edge: bright pink
                (0.90 + rng.gen::<f32>() * 0.10, 0.28, 0.48 + rng.gen::<f32>() * 0.22)
            } else if rng.gen::<f32>() < 0.06 {
                // Embedded stars: blue-white
                let br: f32 = rng.gen_range(0.65..1.0);
                (br * 0.78, br * 0.90, br)
            } else {
                // Diffuse gas: dim orange-red
                let d: f32 = rng.gen_range(0.18..0.38);
                (d, d * 0.42, d * 0.18)
            };
            data.extend_from_slice(&[x, y, z, rc, gc, bc]);
            placed += 1;
        }
    }

    // Sparse background fill
    while placed < count {
        let x: f32 = rng.gen_range(-1.6..1.6);
        let y: f32 = rng.gen_range(-1.6..1.6);
        let z: f32 = rng.gen_range(-0.8..0.8);
        let d: f32 = rng.gen_range(0.04..0.14);
        data.extend_from_slice(&[x, y, z, d, d * 0.38, d * 0.12]);
        placed += 1;
    }

    data
}
