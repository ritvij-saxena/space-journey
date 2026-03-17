/**
 * Skybox
 *
 * A large sphere (r = 2000) with BackSide rendering that wraps the entire
 * scene in the Milky Way texture.  Falls back to the 40 000-point procedural
 * star field when the texture has not been downloaded yet.
 *
 * The sphere follows the camera every frame so it never moves relative to
 * the viewer — exactly like a true celestial sphere.
 */
import * as THREE from 'three';
import { createBackgroundStars } from './background-stars.js';
import { texLib } from './texture-library.js';

export async function createSkybox() {
  // Attempt to load the Milky Way texture
  const mwTex = await texLib.get('milky_way');

  if (mwTex) {
    // Full photorealistic Milky Way dome
    const geo = new THREE.SphereGeometry(2000, 64, 32);
    const mat = new THREE.MeshBasicMaterial({
      map:       mwTex,
      side:      THREE.BackSide,
      depthWrite: false,
    });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.renderOrder = -1;
    sphere.name = 'skybox';
    return sphere;
  }

  // Fallback: procedural star field
  console.log('[Skybox] Milky Way texture not found — using procedural stars. '
    + 'Run: node scripts/download-textures.mjs');
  return createBackgroundStars(40000);
}
