/**
 * SolarJourney — scripted Pluto → Sun → Beyond experience.
 *
 * Pre-places every solar system body at compressed-AU distances along -Z.
 * The FlightController auto-pilot naturally curves toward each POI.
 *
 * SpaceWorld must skip sectors whose center z > JOURNEY_END_Z so there is
 * no overlap between the scripted prologue and the procedural deep-space.
 */
import * as THREE from 'three';
import {
  createStar,
  createPlanetSync,
  createRings,
  createMoon,
  createAsteroidBelt,
} from './celestial-bodies.js';
import { texLib } from './texture-library.js';

/** SpaceWorld skips any sector whose centerZ > this value */
export const JOURNEY_END_Z = -3200;

// Camera flies in -Z. Each waypoint has a scripted Z position and a slight
// lateral offset so every fly-past is cinematic rather than head-on.
const WAYPOINTS = [
  { name: 'PLUTO',         z:  -380, x:  55, y:  18, r:  0.9, biome: 'ice',         hasRings: false, hasMoon: false, attractW:  3 },
  { name: 'NEPTUNE',       z:  -650, x: -80, y: -15, r:  4.0, biome: 'gas_neptune', hasRings: false, hasMoon: false, attractW:  5 },
  { name: 'URANUS',        z:  -900, x:  70, y:  22, r:  3.6, biome: 'ice',         hasRings: true,  hasMoon: false, attractW:  5 },
  { name: 'SATURN',        z: -1200, x: -65, y: -18, r:  6.0, biome: 'gas_jupiter', hasRings: true,  hasMoon: true,  attractW:  9 },
  { name: 'JUPITER',       z: -1500, x:  50, y:  28, r:  7.5, biome: 'gas_jupiter', hasRings: false, hasMoon: true,  attractW:  9 },
  { name: 'ASTEROID BELT', z: -1720, x:   0, y:   0, r:  0,   biome: null,          hasRings: false, hasMoon: false, attractW:  2, isBelt: true },
  { name: 'MARS',          z: -1920, x: -50, y: -10, r:  1.5, biome: 'rocky_red',   hasRings: false, hasMoon: false, attractW:  4 },
  { name: 'EARTH',         z: -2080, x:  65, y:  15, r:  2.5, biome: 'terran',      hasRings: false, hasMoon: true,  attractW:  6 },
  { name: 'VENUS',         z: -2240, x: -45, y:  -8, r:  2.3, biome: 'cloudy',      hasRings: false, hasMoon: false, attractW:  4 },
  { name: 'MERCURY',       z: -2380, x:  38, y:  12, r:  1.0, biome: 'rocky_grey',  hasRings: false, hasMoon: false, attractW:  3 },
  { name: 'THE SUN',       z: -2650, x:   0, y:   0, r: 24,   biome: null,          hasRings: false, hasMoon: false, attractW: 20, isSun: true },
];

// ─── Sun glow sprite ──────────────────────────────────────────────────────────

function createSunGlowSprite(radius) {
  // Soft radial gradient canvas → large additive-blended sprite
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx  = canvas.getContext('2d');
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.00, 'rgba(255, 255, 220, 1.0)');
  grad.addColorStop(0.08, 'rgba(255, 240, 160, 0.85)');
  grad.addColorStop(0.20, 'rgba(255, 200,  80, 0.45)');
  grad.addColorStop(0.45, 'rgba(255, 140,  30, 0.15)');
  grad.addColorStop(0.75, 'rgba(200,  80,  10, 0.04)');
  grad.addColorStop(1.00, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex  = new THREE.CanvasTexture(canvas);
  const mat  = new THREE.SpriteMaterial({
    map:        tex,
    transparent: true,
    blending:   THREE.AdditiveBlending,
    depthWrite: false,
    depthTest:  false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(radius * 18); // large warm halo
  return sprite;
}

export class SolarJourney {
  constructor(scene) {
    this.scene          = scene;
    this._poi           = [];
    this._bodies        = [];
    this._moonOrbiters  = [];
    this._sunMat        = null; // star surface ShaderMaterial — needs uTime update
    this._built         = false;
  }

  /**
   * Build all solar system objects.
   * Must be called after texture preloading is complete.
   */
  build() {
    if (this._built) return;
    this._built = true;

    for (const wp of WAYPOINTS) {
      if      (wp.isBelt) this._buildBelt(wp);
      else if (wp.isSun)  this._buildSun(wp);
      else                this._buildPlanet(wp);
    }
  }

  _buildPlanet(wp) {
    const group = createPlanetSync(wp.biome, wp.r);
    group.position.set(wp.x, wp.y, wp.z);

    if (wp.name === 'URANUS') {
      // Thin ice-blue rings, tilted 90° (Uranus's extreme axial tilt)
      const ring = createRings(wp.r * 1.4, wp.r * 2.1, 0x88ccdd, 0x4499bb);
      ring.rotation.x = Math.PI * 0.12;
      group.add(ring);
    }

    if (wp.name === 'SATURN') {
      const satTex = texLib.getSync('saturn_ring');
      const ring   = createRings(wp.r * 1.25, wp.r * 2.6, 0xc8a050, 0x7a6030, satTex ?? null);
      group.add(ring);
    }

    this.scene.add(group);
    this._bodies.push(group);

    if (wp.hasMoon) {
      const moonR  = wp.r * 0.24;
      const moon   = createMoon(moonR);
      const orbitR = wp.r * 2.4;
      const M0     = Math.random() * Math.PI * 2;
      moon.position.set(wp.x + orbitR, wp.y, wp.z);
      this.scene.add(moon);
      this._bodies.push(moon);
      // Store parent's world position vector for orbit updates
      this._moonOrbiters.push({ moon, center: group.position, orbitR, M: M0, n: 0.45 + Math.random() * 0.35 });
    }
    // POI stores a reference to the live position so flight controller stays current
    this._poi.push({ position: group.position, attractWeight: wp.attractW, name: wp.name });
  }

  _buildSun(wp) {
    const group = createStar(wp.r, 0xfffae0);
    group.position.set(wp.x, wp.y, wp.z);

    // Grab the surface material for uTime animation
    this._sunMat = group.userData.mat ?? null;

    // Extra-large outer glow for the Sun specifically (star is r=24, need even bigger halo)
    const sunOuterGlow = createSunGlowSprite(wp.r * 1.4);
    group.add(sunOuterGlow);

    this.scene.add(group);
    this._bodies.push(group);
    this._poi.push({ position: group.position, attractWeight: wp.attractW, name: wp.name });
  }

  _buildBelt(wp) {
    const belt = createAsteroidBelt(350, 28, 60);
    belt.position.set(wp.x, wp.y, wp.z);
    this.scene.add(belt);
    this._bodies.push(belt);
    this._poi.push({ position: belt.position, attractWeight: wp.attractW, name: wp.name });
  }

  update(dt) {
    // Animate sun surface granulation
    if (this._sunMat?.uniforms?.uTime) {
      this._sunMat.uniforms.uTime.value += dt;
    }

    // Slow self-rotation for planet groups
    for (const b of this._bodies) {
      if (b.userData?.type === 'planet') b.rotation.y += dt * 0.07;
    }

    // Moon orbits — positions set in world space relative to planet center
    for (const orb of this._moonOrbiters) {
      orb.M = (orb.M + orb.n * dt) % (Math.PI * 2);
      orb.moon.position.set(
        orb.center.x + Math.cos(orb.M) * orb.orbitR,
        orb.center.y + Math.sin(0.15)  * orb.orbitR * 0.07,
        orb.center.z + Math.sin(orb.M) * orb.orbitR,
      );
    }
  }

  /**
   * Returns the name of the nearest waypoint within 350 units of camZ.
   * Used to drive the HUD label.
   * @param {number} camZ
   * @returns {string|null}
   */
  getNearestLabel(camZ) {
    let best = null, bestDist = 350;
    for (const wp of WAYPOINTS) {
      const d = Math.abs(camZ - wp.z);
      if (d < bestDist) { bestDist = d; best = wp.name; }
    }
    return best;
  }

  getInterestingObjects() { return this._poi; }

  dispose() {
    for (const obj of this._bodies) {
      this.scene.remove(obj);
      obj.traverse(child => {
        child.geometry?.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) m?.dispose();
      });
    }
    this._bodies       = [];
    this._poi          = [];
    this._moonOrbiters = [];
  }
}
