/**
 * TextureLibrary
 *
 * Loads planet / space textures from /textures/ (downloaded by
 * scripts/download-textures.mjs) with graceful fallback to null.
 *
 * Usage:
 *   const lib = new TextureLibrary();
 *   const tex = await lib.get('earth');
 *   if (tex) mesh.material.map = tex;
 */
import * as THREE from 'three';

// Maps logical names to filenames under /textures/
const CATALOG = {
  milky_way:    'milky_way.jpg',
  sun:          'sun.jpg',
  mercury:      'mercury.jpg',
  venus:        'venus.jpg',
  earth:        'earth.jpg',
  earth_night:  'earth_night.jpg',
  earth_clouds: 'earth_clouds.jpg',
  moon:         'moon.jpg',
  mars:         'mars.jpg',
  jupiter:      'jupiter.jpg',
  saturn:       'saturn.jpg',
  saturn_ring:  'saturn_ring.png',
  uranus:       'uranus.jpg',
  neptune:      'neptune.jpg',
};

export class TextureLibrary {
  constructor() {
    this._loader  = new THREE.TextureLoader();
    this._cache   = new Map();   // name → Promise<THREE.Texture|null>
    this._ready   = new Map();   // name → THREE.Texture|null (resolved)
    this._missing = new Set();   // names known to be absent
  }

  /**
   * Async: resolves with Texture or null (if file not found / download pending).
   */
  get(name) {
    if (this._cache.has(name)) return this._cache.get(name);

    const file = CATALOG[name];
    if (!file) return Promise.resolve(null);

    const promise = new Promise((resolve) => {
      this._loader.load(
        `/textures/${file}`,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          this._ready.set(name, tex);
          resolve(tex);
        },
        undefined,
        () => {
          this._missing.add(name);
          this._ready.set(name, null);
          resolve(null);
        },
      );
    });

    this._cache.set(name, promise);
    return promise;
  }

  /**
   * Sync: returns the texture if already resolved, null otherwise.
   * Safe to call in render loops after initial async `get()` has been called.
   */
  getSync(name) {
    return this._ready.get(name) ?? null;
  }

  isAvailable(name) {
    return this._ready.has(name) && !this._missing.has(name);
  }

  /**
   * Preload a set of textures. Returns promise that resolves when all done.
   */
  preload(names) {
    return Promise.all(names.map(n => this.get(n)));
  }
}

// Singleton shared across the app
export const texLib = new TextureLibrary();
