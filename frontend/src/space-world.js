/**
 * SpaceWorld — procedural infinite space.
 *
 * Physics improvements:
 *   • Keplerian elliptical orbits (Kepler equation solved via Newton-Raphson)
 *   • HR diagram: spectral class → realistic star radius / color / luminosity
 *   • Binary star systems (20 % of star sectors) with circumbinary planets
 *   • Neutron stars / pulsars (2 % of sectors)
 *   • Rust/WASM n-body: WasmKeplerSim integrates asteroid belt positions
 *     each frame under gravitational attraction of the central star
 *
 * Sector types (weighted):
 *   48 %  Single star system
 *   20 %  Binary (or triple) star system
 *   17 %  Emission nebula
 *   10 %  Interstellar molecular cloud
 *    8 %  Black hole
 *    4 %  Asteroid field (with WASM physics)
 *    2 %  Neutron star / pulsar
 *    2 %  Wormhole
 *    1 %  Empty void
 */
import * as THREE from 'three';
import {
  createStar,
  createBlackHole,
  createPlanetSync,
  createRings,
  createMoon,
  createAsteroidBelt,
  createNebula,
  createInterstellarCloud,
  createComet,
  createSatellite,
  createWormhole,
  createSpaceDust,
  createNeutronStar,
} from './celestial-bodies.js';
import { getWasmModule } from './wasm-loader.js';
import { texLib } from './texture-library.js';

// Reusable vector — avoids per-frame allocation in the animation loop
const _tmpVec = new THREE.Vector3();

const SECTOR_SIZE = 900;
const LOAD_AHEAD  = 2;
const KEEP_BEHIND = 1;

const BIOME_LIST = [
  'rocky_grey', 'rocky_red', 'gas_jupiter', 'gas_neptune',
  'ocean', 'terran', 'ice', 'lava', 'cloudy', 'desert_sand', 'desert_rust',
];

// ─── HR Diagram: spectral class → physical properties ─────────────────────────
// cumulative probability weights (OBAFGKM abundance from stellar census)
const HR_CLASSES = [
  { cumWeight:   3, rMin: 12.0, rMax: 22.0, hex: 0x6699ff, name: 'O' },  // hot blue giants
  { cumWeight:  16, rMin:  8.0, rMax: 16.0, hex: 0x99bbff, name: 'B' },  // blue-white
  { cumWeight:  76, rMin:  5.5, rMax:  9.0, hex: 0xccddff, name: 'A' },  // white
  { cumWeight: 106, rMin:  5.0, rMax:  8.0, hex: 0xfff4ee, name: 'F' },  // yellow-white
  { cumWeight: 182, rMin:  4.0, rMax:  7.0, hex: 0xffeea0, name: 'G' },  // sun-like yellow
  { cumWeight: 303, rMin:  3.0, rMax:  5.5, hex: 0xffb060, name: 'K' },  // orange
  { cumWeight:1000, rMin:  2.0, rMax:  4.0, hex: 0xff6644, name: 'M' },  // red dwarf
];

/**
 * Sample a spectral class from the HR diagram using realistic stellar abundances.
 * @returns {{ rMin, rMax, hex }}
 */
function sampleHRClass(rng) {
  const roll = rng.next() * 1000;
  for (const cls of HR_CLASSES) {
    if (roll < cls.cumWeight) return cls;
  }
  return HR_CLASSES[HR_CLASSES.length - 1];
}

// ─── Keplerian orbit math ──────────────────────────────────────────────────────

/**
 * Solve Kepler's equation  M = E − e·sin(E)  for eccentric anomaly E.
 * Uses Newton-Raphson; converges in ≤5 iterations for e < 0.98.
 */
function solveKepler(M, e) {
  let E = M + e * Math.sin(M);          // initial guess (good for small e)
  for (let i = 0; i < 6; i++) {
    const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  return E;
}

/**
 * Compute position in the orbital plane (XZ) from eccentric anomaly, e, and semi-major axis.
 * Returns { x, z } in the orbital plane frame.
 */
function keplerXZ(E, e, a) {
  return {
    x: a * (Math.cos(E) - e),
    z: a * Math.sqrt(1 - e * e) * Math.sin(E),
  };
}

/**
 * Circular orbital velocity for a test particle at distance r from a body with GM.
 */
function circularVelocity(r, gm) {
  return Math.sqrt(gm / r);
}

// ─── Seeded PRNG ─────────────────────────────────────────────────────────────

class SeededRandom {
  constructor(seed) { this.s = ((seed | 0) >>> 0) || 1; }
  next() {
    let s = this.s;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.s = s;
    return ((s >>> 0) / 0xFFFFFFFF);
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b)   { return Math.floor(this.range(a, b + 0.999)); }
}

function sectorSeed(sz) {
  let h = (sz ^ 0xdeadbeef) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ─── SpaceWorld ───────────────────────────────────────────────────────────────

export class SpaceWorld {
  constructor(scene) {
    this.scene   = scene;
    this.sectors = new Map();
    this._poi    = [];
  }

  async preload() {
    await texLib.preload([
      'milky_way', 'earth', 'earth_night', 'moon',
      'mars', 'venus', 'mercury', 'jupiter', 'neptune',
      'saturn', 'saturn_ring', 'sun',
    ]);
  }

  update(dt, camPos) {
    const sz = Math.floor(camPos.z / SECTOR_SIZE);

    for (let i = sz - LOAD_AHEAD; i <= sz + KEEP_BEHIND; i++) {
      if (!this.sectors.has(i)) this._loadSector(i);
    }
    for (const [key] of this.sectors) {
      if (key < sz - LOAD_AHEAD || key > sz + KEEP_BEHIND) {
        this._unloadSector(key);
      }
    }

    const t = performance.now() * 0.001;
    this._frame = ((this._frame ?? 0) + 1) % 2;
    const updateShaders = this._frame === 0; // shader animations at 30 fps — imperceptible difference
    for (const [, sector] of this.sectors) {
      // Shader time uniforms
      if (updateShaders) {
        for (const mat of sector.animMats) mat.uniforms.uTime.value = t;
      }

      // ── Keplerian orbital animation ───────────────────────────────────────
      for (const orb of sector.animOrbiters) {
        // Advance mean anomaly
        orb.M = (orb.M + orb.n * dt) % (Math.PI * 2);
        const center = orb.centerObj ? orb.centerObj.position : orb.center;

        let px, py, pz;
        if (orb.e > 0.005) {
          // True Keplerian elliptical orbit
          const E    = solveKepler(orb.M, orb.e);
          const cosE = Math.cos(E);
          const { x: x0, z: z0 } = keplerXZ(E, orb.e, orb.a);
          // Rotate by argument of periapsis (ω) in the orbital plane
          const cosW = Math.cos(orb.omega), sinW = Math.sin(orb.omega);
          const x1   = x0 * cosW - z0 * sinW;
          const z1   = x0 * sinW + z0 * cosW;
          // Distance for inclination scaling
          const r    = orb.a * (1 - orb.e * cosE);
          px = center.x + x1;
          py = center.y + Math.sin(orb.incline) * r * 0.14;
          pz = center.z + z1;
        } else {
          // Circular orbit (moons, satellites)
          px = center.x + Math.cos(orb.M) * orb.a;
          py = center.y + Math.sin(orb.incline) * orb.a * 0.12;
          pz = center.z + Math.sin(orb.M) * orb.a;
        }

        orb.obj.position.set(px, py, pz);

        if (orb.selfRotY) orb.obj.rotation.y += orb.selfRotY * dt;

        // Update light direction for this orbiting body
        if (orb.lightMats?.length) {
          _tmpVec.subVectors(orb.lightCenter, orb.obj.position).normalize();
          for (const mat of orb.lightMats) mat.uniforms.uLightDir.value.copy(_tmpVec);
        }
      }

      // ── WASM Keplerian belt physics ───────────────────────────────────────
      // Update physics every frame but only upload GPU matrices every 3rd frame
      for (const belt of sector.animBelts) {
        belt.sim.step(dt);
        belt._skipFrame = ((belt._skipFrame ?? 0) + 1) % 3;
        if (belt._skipFrame !== 0) continue;
        const positions = belt.sim.get_positions();
        const count     = belt.sim.particle_count();
        const ox = belt.offset.x, oy = belt.offset.y, oz = belt.offset.z;
        for (let i = 0; i < count; i++) {
          belt.dummy.position.set(
            positions[i * 3]     + ox,
            positions[i * 3 + 1] + oy,
            positions[i * 3 + 2] + oz,
          );
          belt.dummy.updateMatrix();
          belt.mesh.setMatrixAt(i, belt.dummy.matrix);
        }
        belt.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    this._poi = [];
    for (const [, sector] of this.sectors) {
      for (const poi of sector.poi) this._poi.push(poi);
    }
  }

  getInterestingObjects() { return this._poi; }

  // ─── Sector lifecycle ──────────────────────────────────────────────────────

  _loadSector(sz) {
    const cZ = sz * SECTOR_SIZE;
    // Solar system journey zone — SolarJourney owns all content here
    if (cZ > -3200) return;

    const rng    = new SeededRandom(sectorSeed(sz));
    const sector = { objects: [], poi: [], animMats: [], animOrbiters: [], animBelts: [] };

    const roll = rng.next();
    // Deep space after solar journey — sparse, dramatic, no clutter
    if      (roll < 0.22) this._spawnStarSystem      (cZ, rng, sector); // 22 %
    else if (roll < 0.34) this._spawnNebula           (cZ, rng, sector); // 12 %
    else if (roll < 0.46) this._spawnInterstellarCloud(cZ, rng, sector); // 12 %
    else if (roll < 0.58) this._spawnBlackHole        (cZ, rng, sector); // 12 %
    else if (roll < 0.68) this._spawnBinarySystem     (cZ, rng, sector); // 10 %
    else if (roll < 0.76) this._spawnWormhole         (cZ, rng, sector); //  8 %
    else if (roll < 0.80) this._spawnNeutronStar      (cZ, rng, sector); //  4 %
    // else: empty void (20 %) — sparse deep space feels right

    // Volumetric space dust in every sector
    const dust = createSpaceDust(sectorSeed(sz) ^ 0xdeadbeef);
    dust.position.set(0, 0, cZ);
    sector.objects.push(dust);

    for (const obj of sector.objects) this.scene.add(obj);
    this.sectors.set(sz, sector);
  }

  _unloadSector(sz) {
    const sector = this.sectors.get(sz);
    if (!sector) return;

    // Free Rust/WASM belt sims to avoid memory leaks
    for (const belt of sector.animBelts) {
      try { belt.sim.free(); } catch (_) {}
    }

    for (const obj of sector.objects) {
      this.scene.remove(obj);
      obj.traverse(child => {
        child.geometry?.dispose();
        const mats = child.material
          ? (Array.isArray(child.material) ? child.material : [child.material])
          : [];
        for (const m of mats) m.dispose();
      });
    }
    this.sectors.delete(sz);
  }

  // ─── Single star system ────────────────────────────────────────────────────

  _spawnStarSystem(cZ, rng, sector) {
    const hrClass    = sampleHRClass(rng);
    const starRadius = rng.range(hrClass.rMin, hrClass.rMax);
    const starColor  = hrClass.hex;

    const starPos = new THREE.Vector3(
      rng.range(-140, 140),
      rng.range(-40, 40),
      cZ + rng.range(-SECTOR_SIZE * 0.35, SECTOR_SIZE * 0.35),
    );

    this._buildStarSystem(starPos, starRadius, starColor, rng, sector, null);
  }

  /**
   * Shared helper: build a star + planetary system around a position.
   * `extraMassGM` adds additional gravitational influence for binary pairs
   * (slightly spreads orbits to avoid instability).
   */
  _buildStarSystem(starPos, starRadius, starColor, rng, sector, extraMassGM) {
    const starGroup = createStar(starRadius, starColor);
    starGroup.position.copy(starPos);
    sector.objects.push(starGroup);
    sector.poi.push({ position: starPos.clone(), attractWeight: 4.0 + starRadius * 0.2 });

    const starMesh = starGroup.children[0];
    if (starMesh?.material?.uniforms?.uTime) sector.animMats.push(starMesh.material);

    // GM for this star: scales with radius³ (proxy for mass via L ∝ M⁴, R ∝ M)
    // Tuned so at r=50 units, period ≈ 40 s (visually satisfying)
    const baseMassGM = 1800 * Math.pow(starRadius / 5, 1.5);
    const totalGM    = baseMassGM + (extraMassGM ?? 0);

    // Kepler's 3rd law: T = 2π √(a³/GM) → n = 2π/T = √(GM/a³)
    const numPlanets = rng.int(0, 2);
    for (let p = 0; p < numPlanets; p++) {
      const a          = starRadius * 4 + 50 + p * rng.range(35, 70);
      const e          = rng.range(0.01, 0.55);                            // eccentricity
      const omega      = rng.next() * Math.PI * 2;                        // arg of periapsis
      const M0         = rng.next() * Math.PI * 2;                        // initial mean anomaly
      const n          = Math.sqrt(totalGM / (a * a * a));                // mean motion (rad/s)
      const incline    = rng.range(-0.22, 0.22);
      const selfRotY   = rng.range(0.05, 0.22) * (rng.next() < 0.5 ? 1 : -1);

      // Initial position on orbit for first-frame consistency
      const E0   = solveKepler(M0, e);
      const { x: x0, z: z0 } = keplerXZ(E0, e, a);
      const cosW = Math.cos(omega), sinW = Math.sin(omega);
      const initX = starPos.x + x0 * cosW - z0 * sinW;
      const initY = starPos.y + Math.sin(incline) * a * 0.14;
      const initZ = starPos.z + x0 * sinW + z0 * cosW;
      const planetPos = new THREE.Vector3(initX, initY, initZ);

      const biome   = BIOME_LIST[rng.int(0, BIOME_LIST.length - 1)];
      const pRadius = rng.range(1.8, 6.5);
      const pGroup  = createPlanetSync(biome, pRadius);
      pGroup.position.copy(planetPos);

      const pMesh  = pGroup.children[0];
      const pAtm   = pGroup.children[1];
      const pCloud = pGroup.children[2]; // cloud sphere (terran / ocean biomes)
      const ld     = starPos.clone().sub(planetPos).normalize();
      if (pMesh?.material?.uniforms?.uLightDir)  pMesh.material.uniforms.uLightDir.value.copy(ld);
      if (pAtm?.material?.uniforms?.uLightDir)   pAtm.material.uniforms.uLightDir.value.copy(ld);
      if (pCloud?.material?.uniforms?.uLightDir) pCloud.material.uniforms.uLightDir.value.copy(ld);
      if (pMesh?.material?.uniforms?.uTime)  sector.animMats.push(pMesh.material);
      if (pCloud?.material?.uniforms?.uTime) sector.animMats.push(pCloud.material);

      sector.objects.push(pGroup);
      sector.poi.push({ position: planetPos.clone(), attractWeight: 2.2 + pRadius * 0.28 });

      const pLightMats = [pMesh?.material, pAtm?.material, pCloud?.material]
        .filter(m => m?.uniforms?.uLightDir);

      sector.animOrbiters.push({
        obj:         pGroup,
        center:      starPos.clone(),
        a, e, M: M0, n, omega, incline, selfRotY,
        lightMats:   pLightMats,
        lightCenter: starPos.clone(),
      });

      // Rings on gas giants
      if ((biome === 'gas_jupiter' || biome === 'gas_neptune') && rng.next() < 0.35) {
        const satRingTex = texLib.getSync('saturn_ring');
        const ringsObj   = createRings(
          pRadius * 1.5, pRadius * 3.0,
          new THREE.Color(0xd4a06a), new THREE.Color(0x9a7050),
          satRingTex,
        );
        ringsObj.rotation.x = Math.PI / 2.5 + rng.range(-0.4, 0.4);
        pGroup.add(ringsObj);
      }

      // Moons orbit planet on near-circular orbits
      const numMoons = rng.int(0, 1);
      for (let m = 0; m < numMoons; m++) {
        const mA      = pRadius * 2.5 + m * pRadius * 1.5;
        const mM0     = rng.next() * Math.PI * 2;
        const mIncline= rng.range(-0.35, 0.35);
        const mN      = 0.40 + rng.next() * 0.40; // moons orbit fast
        const mR      = pRadius * rng.range(0.10, 0.28);
        const moon    = createMoon(mR);

        moon.position.set(
          initX + Math.cos(mM0) * mA,
          initY + Math.sin(mIncline) * mA * 0.12,
          initZ + Math.sin(mM0) * mA,
        );
        const mLd = starPos.clone().sub(moon.position).normalize();
        if (moon.material?.uniforms?.uLightDir) moon.material.uniforms.uLightDir.value.copy(mLd);

        sector.objects.push(moon);
        sector.animOrbiters.push({
          obj:         moon,
          centerObj:   pGroup,
          a: mA, e: 0.002, M: mM0, n: mN, omega: 0, incline: mIncline,
          selfRotY:    0.04,
          lightMats:   moon.material?.uniforms?.uLightDir ? [moon.material] : [],
          lightCenter: starPos.clone(),
        });
      }

    }

  }

  // ─── Binary / triple star system ───────────────────────────────────────────

  _spawnBinarySystem(cZ, rng, sector) {
    const numStars    = rng.next() < 0.15 ? 3 : 2;        // 15 % chance of triple
    const separation  = rng.range(28, 70);                  // distance between stars

    // Barycenter of the system
    const bary = new THREE.Vector3(
      rng.range(-120, 120),
      rng.range(-35, 35),
      cZ + rng.range(-SECTOR_SIZE * 0.35, SECTOR_SIZE * 0.35),
    );

    const starDefs = [];
    let combinedGM = 0;
    for (let s = 0; s < numStars; s++) {
      const hr  = sampleHRClass(rng);
      const r   = rng.range(hr.rMin, hr.rMax);
      const gm  = 1800 * Math.pow(r / 5, 1.5);
      starDefs.push({ hr, r, gm });
      combinedGM += gm;
    }

    const totalGM = combinedGM;
    const totalMass = starDefs.reduce((s, d) => s + d.gm, 0);

    // Orbital parameters for the mutual star orbit
    const binaryA = separation;
    const binaryE = rng.range(0.02, 0.45);
    const binaryN = Math.sqrt(totalGM / (binaryA * binaryA * binaryA)) * 0.55; // slower mutual orbit
    let binaryM   = rng.next() * Math.PI * 2;

    for (let s = 0; s < numStars; s++) {
      const def    = starDefs[s];
      const massF  = def.gm / totalMass;          // fractional mass
      // Stars on opposite sides of barycenter (for binary)
      const sign   = s % 2 === 0 ? 1 : -1;
      const offset = sign * separation * (1 - massF); // heavier star closer to bary

      // Compute initial position
      const E0     = solveKepler(binaryM + s * Math.PI, binaryE);
      const { x: x0, z: z0 } = keplerXZ(E0, binaryE, binaryA * (1 - massF));
      const omega  = rng.next() * Math.PI * 2;
      const cosW   = Math.cos(omega), sinW = Math.sin(omega);

      const starPos = new THREE.Vector3(
        bary.x + x0 * cosW * sign - z0 * sinW,
        bary.y + rng.range(-4, 4),
        bary.z + x0 * sinW * sign + z0 * cosW,
      );

      const starGroup = createStar(def.r, def.hr.hex);
      starGroup.position.copy(starPos);
      sector.objects.push(starGroup);
      sector.poi.push({ position: starPos.clone(), attractWeight: 3.5 + def.r * 0.2 });

      if (starGroup.children[0]?.material?.uniforms?.uTime) {
        sector.animMats.push(starGroup.children[0].material);
      }

      // Stars orbit barycenter
      sector.animOrbiters.push({
        obj:      starGroup,
        center:   bary.clone(),
        a: binaryA * (1 - massF) + offset * 0.5,
        e: binaryE,
        M: binaryM + s * Math.PI,
        n: binaryN,
        omega,
        incline:  rng.range(-0.15, 0.15),
        selfRotY: 0,
        lightMats: [],
        lightCenter: bary.clone(),
      });
    }

    // Circumbinary planets on stable outer orbits (a > 3 * separation)
    const numPlanets = rng.int(1, 3);
    for (let p = 0; p < numPlanets; p++) {
      const a       = separation * 3.2 + p * rng.range(25, 50);
      const e       = rng.range(0.005, 0.35);
      const omega   = rng.next() * Math.PI * 2;
      const M0      = rng.next() * Math.PI * 2;
      const n       = Math.sqrt(totalGM / (a * a * a));
      const incline = rng.range(-0.20, 0.20);

      const E0      = solveKepler(M0, e);
      const { x: x0, z: z0 } = keplerXZ(E0, e, a);
      const cosW    = Math.cos(omega), sinW = Math.sin(omega);
      const planetPos = new THREE.Vector3(
        bary.x + x0 * cosW - z0 * sinW,
        bary.y + Math.sin(incline) * a * 0.14,
        bary.z + x0 * sinW + z0 * cosW,
      );

      const biome   = BIOME_LIST[rng.int(0, BIOME_LIST.length - 1)];
      const pRadius = rng.range(2.0, 5.5);
      const pGroup  = createPlanetSync(biome, pRadius);
      pGroup.position.copy(planetPos);

      const pMesh  = pGroup.children[0];
      const pAtm   = pGroup.children[1];
      const pCloud = pGroup.children[2];
      const ld     = bary.clone().sub(planetPos).normalize();
      if (pMesh?.material?.uniforms?.uLightDir)  pMesh.material.uniforms.uLightDir.value.copy(ld);
      if (pAtm?.material?.uniforms?.uLightDir)   pAtm.material.uniforms.uLightDir.value.copy(ld);
      if (pCloud?.material?.uniforms?.uLightDir) pCloud.material.uniforms.uLightDir.value.copy(ld);
      if (pMesh?.material?.uniforms?.uTime)  sector.animMats.push(pMesh.material);
      if (pCloud?.material?.uniforms?.uTime) sector.animMats.push(pCloud.material);

      sector.objects.push(pGroup);
      sector.poi.push({ position: planetPos.clone(), attractWeight: 1.8 + pRadius * 0.25 });

      sector.animOrbiters.push({
        obj:         pGroup,
        center:      bary.clone(),
        a, e, M: M0, n, omega, incline, selfRotY: rng.range(0.05, 0.18) * (rng.next() < 0.5 ? 1 : -1),
        lightMats:   [pMesh?.material, pAtm?.material].filter(m => m?.uniforms?.uLightDir),
        lightCenter: bary.clone(),
      });
    }
  }

  // ─── Nebula ────────────────────────────────────────────────────────────────

  _spawnNebula(cZ, rng, sector) {
    const pos = new THREE.Vector3(
      rng.range(-170, 170),
      rng.range(-55, 55),
      cZ + rng.range(-SECTOR_SIZE * 0.4, SECTOR_SIZE * 0.4),
    );
    const nebula = createNebula(3500, rng.int(0, 99999));
    nebula.position.copy(pos);
    sector.objects.push(nebula);
    sector.poi.push({ position: pos.clone(), attractWeight: 2.0 });
  }

  // ─── Interstellar cloud ────────────────────────────────────────────────────

  _spawnInterstellarCloud(cZ, rng, sector) {
    const pos = new THREE.Vector3(
      rng.range(-120, 120),
      rng.range(-40, 40),
      cZ + rng.range(-SECTOR_SIZE * 0.4, SECTOR_SIZE * 0.4),
    );
    const cloud = createInterstellarCloud(rng.int(0, 99999));
    cloud.position.copy(pos);
    sector.objects.push(cloud);
    sector.poi.push({ position: pos.clone(), attractWeight: 1.8 });
  }

  // ─── Black hole ────────────────────────────────────────────────────────────

  _spawnBlackHole(cZ, rng, sector) {
    const bhRadius = rng.range(6, 14);
    const pos = new THREE.Vector3(
      rng.range(-100, 100),
      rng.range(-30, 30),
      cZ + rng.range(-SECTOR_SIZE * 0.35, SECTOR_SIZE * 0.35),
    );

    const bh = createBlackHole(bhRadius);
    bh.position.copy(pos);
    sector.objects.push(bh);
    sector.poi.push({ position: pos.clone(), attractWeight: 5.0, isBH: true, bhRadius });

    if (bh.userData.animMats) {
      for (const mat of bh.userData.animMats) sector.animMats.push(mat);
    }

    // Companion stars in tight relativistic orbits
    const numStars = rng.int(1, 3);
    for (let i = 0; i < numStars; i++) {
      const d      = bhRadius * 10 + rng.range(30, 80);
      const e      = rng.range(0.05, 0.50);                // noticeable eccentricity
      const M0     = rng.next() * Math.PI * 2;
      const omega  = rng.next() * Math.PI * 2;
      const bhGM   = 8000 * Math.pow(bhRadius / 8, 2.0);  // BH mass ≫ stars
      const n      = Math.sqrt(bhGM / (d * d * d));
      const sColor = [0x8fc0ff, 0xffffff, 0xffd97a][rng.int(0, 2)];
      const sR     = rng.range(1.5, 4);
      const sg     = createStar(sR, sColor);
      const E0     = solveKepler(M0, e);
      const { x: x0, z: z0 } = keplerXZ(E0, e, d);
      sg.position.set(pos.x + x0, pos.y + rng.range(-15, 15), pos.z + z0);

      sector.objects.push(sg);
      if (sg.children[0]?.material?.uniforms?.uTime) sector.animMats.push(sg.children[0].material);
      sector.animOrbiters.push({
        obj: sg, center: pos.clone(),
        a: d, e, M: M0, n, omega, incline: rng.range(-0.3, 0.3),
        selfRotY: 0, lightMats: [], lightCenter: pos.clone(),
      });
    }
  }

  // ─── Asteroid field (WASM physics) ────────────────────────────────────────

  _spawnAsteroidField(cZ, rng, sector) {
    const pos = new THREE.Vector3(
      rng.range(-110, 110),
      rng.range(-28, 28),
      cZ + rng.range(-SECTOR_SIZE * 0.38, SECTOR_SIZE * 0.38),
    );
    const innerR   = rng.range(25, 55);
    const outerR   = innerR + rng.range(38, 78);
    const count    = rng.int(300, 500);           // particle-physics belt size
    const starGM   = rng.range(1500, 3000);       // gravitational parameter

    sector.poi.push({ position: pos.clone(), attractWeight: 1.2 });

    // Try to use WASM Keplerian integrator
    const wasmMod = getWasmModule();
    if (wasmMod?.WasmKeplerSim) {
      const sim = new wasmMod.WasmKeplerSim();
      sim.add_attractor(0, 0, 0, starGM);       // star at belt-local origin

      // Build InstancedMesh (same geometry as static belt)
      const geo   = new THREE.OctahedronGeometry(1, 0);
      const mat   = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh  = new THREE.InstancedMesh(geo, mat, count);
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      const localRng = new SeededRandom(rng.int(0, 0xffffff));

      for (let i = 0; i < count; i++) {
        // Random angle and radius in belt
        const angle   = localRng.next() * Math.PI * 2;
        const r       = innerR + localRng.next() * (outerR - innerR);
        const x       = r * Math.cos(angle);
        const z       = r * Math.sin(angle);
        const y       = (localRng.next() - 0.5) * (outerR - innerR) * 0.06;

        // Circular orbital velocity + small eccentricity kick
        const vCirc   = Math.sqrt(starGM / r);
        const vx      = -vCirc * Math.sin(angle) * (1 + (localRng.next() - 0.5) * 0.06);
        const vy      = (localRng.next() - 0.5) * vCirc * 0.02;
        const vz      =  vCirc * Math.cos(angle) * (1 + (localRng.next() - 0.5) * 0.06);

        sim.add_particle(x, y, z, vx, vy, vz);

        // Initial matrix
        dummy.position.set(pos.x + x, pos.y + y, pos.z + z);
        dummy.rotation.set(
          localRng.next() * Math.PI * 2,
          localRng.next() * Math.PI * 2,
          localRng.next() * Math.PI * 2,
        );
        dummy.scale.set(
          0.10 + localRng.next() * 0.65,
          0.08 + localRng.next() * 0.50,
          0.10 + localRng.next() * 0.60,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        const v = 0.35 + localRng.next() * 0.30;
        color.setRGB(v * 0.82, v * 0.72, v * 0.58);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      sector.objects.push(mesh);
      sector.animBelts.push({ sim, mesh, dummy: new THREE.Object3D(), offset: pos.clone() });
    } else {
      // Fallback: static belt
      const belt = createAsteroidBelt(count, innerR, outerR);
      belt.position.copy(pos);
      sector.objects.push(belt);
    }
  }

  // ─── Neutron star / pulsar ─────────────────────────────────────────────────

  _spawnNeutronStar(cZ, rng, sector) {
    const pos = new THREE.Vector3(
      rng.range(-90, 90),
      rng.range(-25, 25),
      cZ + rng.range(-SECTOR_SIZE * 0.35, SECTOR_SIZE * 0.35),
    );

    const ns = createNeutronStar(rng.int(0, 99999));
    ns.position.copy(pos);
    sector.objects.push(ns);
    sector.poi.push({ position: pos.clone(), attractWeight: 3.8 });

    if (ns.userData.animMats) {
      for (const mat of ns.userData.animMats) sector.animMats.push(mat);
    }

    // Optionally: companion star in tight X-ray binary
    if (rng.next() < 0.45) {
      const hr      = sampleHRClass(rng);
      const compR   = rng.range(hr.rMin, hr.rMax);
      const compA   = rng.range(18, 45);
      const compE   = rng.range(0.02, 0.40);
      const compM0  = rng.next() * Math.PI * 2;
      const compOmega = rng.next() * Math.PI * 2;
      const compN   = Math.sqrt(5000 / (compA * compA * compA));
      const E0      = solveKepler(compM0, compE);
      const { x: x0, z: z0 } = keplerXZ(E0, compE, compA);
      const cosW = Math.cos(compOmega), sinW = Math.sin(compOmega);
      const compPos = new THREE.Vector3(
        pos.x + x0 * cosW - z0 * sinW,
        pos.y,
        pos.z + x0 * sinW + z0 * cosW,
      );
      const comp = createStar(compR, hr.hex);
      comp.position.copy(compPos);
      sector.objects.push(comp);
      if (comp.children[0]?.material?.uniforms?.uTime) sector.animMats.push(comp.children[0].material);
      sector.animOrbiters.push({
        obj: comp, center: pos.clone(),
        a: compA, e: compE, M: compM0, n: compN,
        omega: compOmega, incline: rng.range(-0.2, 0.2),
        selfRotY: 0, lightMats: [], lightCenter: pos.clone(),
      });
    }
  }

  // ─── Wormhole ──────────────────────────────────────────────────────────────

  _spawnWormhole(cZ, rng, sector) {
    const radius = rng.range(8, 18);
    const pos    = new THREE.Vector3(
      rng.range(-120, 120),
      rng.range(-35, 35),
      cZ + rng.range(-SECTOR_SIZE * 0.35, SECTOR_SIZE * 0.35),
    );

    const wh = createWormhole(radius);
    wh.position.copy(pos);
    wh.rotation.x = rng.range(-0.9, 0.9);
    wh.rotation.y = rng.range(-Math.PI, Math.PI);

    if (wh.userData.animMats) {
      for (const mat of wh.userData.animMats) sector.animMats.push(mat);
    }

    sector.objects.push(wh);
    sector.poi.push({ position: pos.clone(), attractWeight: 3.5 });
  }
}
