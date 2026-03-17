/**
 * FlightController — auto-pilot camera for space journey.
 *
 * The camera moves continuously in the -Z direction with sinusoidal
 * wandering. When interesting objects (planets, stars) are detected
 * ahead, the path curves toward them so you fly past them closely.
 * Gentle banking adds cinematic feel.
 */
import * as THREE from 'three';

export class FlightController {
  constructor(camera) {
    this.camera = camera;

    this.position  = new THREE.Vector3(0, 0, 0);
    this.speed     = 14; // units per second

    // Smooth look-at (never snap)
    this.lookTarget = new THREE.Vector3(0, 0, -200);

    this.roll       = 0;
    this.time       = 0;

    // Wandering parameters — two prime-ish frequencies so the path never repeats
    this.wx  = 0.061;   // rad/s
    this.wy  = 0.043;
    this.ax  = 90;      // max lateral wander in X
    this.ay  = 45;      // max vertical wander in Y

    camera.position.copy(this.position);
    camera.lookAt(this.lookTarget);
  }

  /**
   * @param {number} dt  - delta time in seconds
   * @param {Array}  poi - array of {position: THREE.Vector3, attractWeight: number}
   */
  update(dt, poi) {
    this.time += dt;

    // Base sinusoidal wander target (ahead of camera on the wander path)
    const wanderX = Math.sin(this.time * this.wx) * this.ax;
    const wanderY = Math.sin(this.time * this.wy) * this.ay;

    let tx = wanderX;
    let ty = wanderY;
    const tz = this.position.z - 250;

    // Attract toward the best nearby point-of-interest
    if (poi && poi.length) {
      let bestScore = 0;
      let bestObj   = null;

      for (const obj of poi) {
        const dz = this.position.z - obj.position.z;
        if (dz < 20 || dz > 700) continue; // not yet ahead, or already passed

        const dx   = obj.position.x - this.position.x;
        const dy   = obj.position.y - this.position.y;
        const lat  = Math.sqrt(dx * dx + dy * dy);
        const score = (obj.attractWeight ?? 1.0) / ((dz + 5) * (lat + 30));

        if (score > bestScore) { bestScore = score; bestObj = obj; }
      }

      if (bestObj) {
        const dz = this.position.z - bestObj.position.z;
        // Blend strength: grows as object gets closer
        const blend = Math.min(1, (700 - dz) / 600) * 0.55;
        tx = tx * (1 - blend) + bestObj.position.x * blend;
        ty = ty * (1 - blend) + bestObj.position.y * blend;
      }
    }

    // Smoothly interpolate look target
    const desired = new THREE.Vector3(tx, ty, tz);
    this.lookTarget.lerp(desired, 0.012);

    // Move toward look target at constant speed
    const dir = new THREE.Vector3()
      .subVectors(this.lookTarget, this.position)
      .normalize();

    this.position.addScaledVector(dir, this.speed * dt);

    // Apply to camera
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookTarget);

    // Cinematic banking roll based on lateral direction
    const targetRoll = -dir.x * 0.22;
    this.roll += (targetRoll - this.roll) * 0.025;
    this.camera.rotation.z = this.roll;
  }

  getPosition() { return this.position; }
}
