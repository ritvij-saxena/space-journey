/**
 * WasmKeplerSim — test-particle gravitational integrator
 *
 * Simulates N "test particles" (asteroids) orbiting one or more fixed
 * attractors (stars).  Attractors are not moved by particle gravity —
 * they are externally updated each frame for binary-star support.
 *
 * Integration: symplectic (leapfrog) Euler — preserves energy much
 * better than naive Euler for orbital mechanics.
 *
 * Typical use: 300-500 asteroid belt particles orbiting a star.
 * For N=500, one step() call does ~1500 FMAs — trivial in WASM.
 */
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmKeplerSim {
    /// Flat [x, y, z, gm,  x, y, z, gm, ...] per attractor
    attractors: Vec<f32>,
    /// Flat [x,y,z, x,y,z, ...] particle positions
    pos: Vec<f32>,
    /// Flat [vx,vy,vz, ...] particle velocities
    vel: Vec<f32>,
}

#[wasm_bindgen]
impl WasmKeplerSim {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmKeplerSim {
        WasmKeplerSim {
            attractors: Vec::new(),
            pos: Vec::new(),
            vel: Vec::new(),
        }
    }

    /// Add a fixed gravitational attractor (star).
    /// `gm` = G * M in world-unit³ / s² (caller chooses consistent units).
    pub fn add_attractor(&mut self, x: f32, y: f32, z: f32, gm: f32) {
        self.attractors.extend_from_slice(&[x, y, z, gm]);
    }

    /// Move an existing attractor (used for binary star system animation).
    pub fn update_attractor(&mut self, index: u32, x: f32, y: f32, z: f32) {
        let i = (index as usize) * 4;
        if i + 2 < self.attractors.len() {
            self.attractors[i]     = x;
            self.attractors[i + 1] = y;
            self.attractors[i + 2] = z;
        }
    }

    /// Add a test particle (asteroid) with world-space initial pos + vel.
    pub fn add_particle(&mut self, x: f32, y: f32, z: f32, vx: f32, vy: f32, vz: f32) {
        self.pos.extend_from_slice(&[x, y, z]);
        self.vel.extend_from_slice(&[vx, vy, vz]);
    }

    /// Advance all particles by `dt` seconds (symplectic Euler).
    /// Call once per frame; typical dt ≈ 0.016 (60 fps) or 0.033 (30 fps).
    pub fn step(&mut self, dt: f32) {
        let n_att = self.attractors.len() / 4;
        let n_par = self.pos.len() / 3;

        for i in 0..n_par {
            let px = self.pos[i * 3];
            let py = self.pos[i * 3 + 1];
            let pz = self.pos[i * 3 + 2];

            let mut ax = 0.0f32;
            let mut ay = 0.0f32;
            let mut az = 0.0f32;

            for j in 0..n_att {
                let ax_ = self.attractors[j * 4];
                let ay_ = self.attractors[j * 4 + 1];
                let az_ = self.attractors[j * 4 + 2];
                let gm  = self.attractors[j * 4 + 3];

                let dx = ax_ - px;
                let dy = ay_ - py;
                let dz = az_ - pz;

                // Plummer softening: replace r² with r²+ε² where ε=0.5
                let r2      = dx * dx + dy * dy + dz * dz + 0.25;
                let inv_r3  = gm / (r2 * r2.sqrt());

                ax += inv_r3 * dx;
                ay += inv_r3 * dy;
                az += inv_r3 * dz;
            }

            // Symplectic Euler: update velocity FIRST, then position
            self.vel[i * 3]     += ax * dt;
            self.vel[i * 3 + 1] += ay * dt;
            self.vel[i * 3 + 2] += az * dt;

            self.pos[i * 3]     += self.vel[i * 3]     * dt;
            self.pos[i * 3 + 1] += self.vel[i * 3 + 1] * dt;
            self.pos[i * 3 + 2] += self.vel[i * 3 + 2] * dt;
        }
    }

    /// Returns flat [x,y,z, ...] of all particles.  O(n) — allocates.
    pub fn get_positions(&self) -> Box<[f32]> {
        self.pos.clone().into_boxed_slice()
    }

    /// Pointer into WASM linear memory for zero-copy access.
    pub fn get_positions_ptr(&self) -> u32 {
        self.pos.as_ptr() as u32
    }

    /// Element count of the positions flat array (particle_count * 3).
    pub fn get_positions_len(&self) -> u32 {
        self.pos.len() as u32
    }

    pub fn particle_count(&self) -> u32 {
        (self.pos.len() / 3) as u32
    }

    /// Clear all bodies — reuse the sim for a new sector.
    pub fn clear(&mut self) {
        self.attractors.clear();
        self.pos.clear();
        self.vel.clear();
    }
}
