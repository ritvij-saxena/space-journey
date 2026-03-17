/**
 * Cinematic background star field.
 *
 * Spectral-class colors · magnitude-based size distribution ·
 * 6-ray diffraction spikes for bright stars · gentle twinkle.
 *
 * Exports a THREE.Points whose material has uniforms.uTime so the caller
 * can animate it each frame.
 */
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aBright;
  attribute vec3  aColor;
  varying   float vBright;
  varying   vec3  vColor;
  uniform   float uPixelRatio;

  void main() {
    vBright = aBright;
    vColor  = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Bright stars get larger point size so spikes are visible
    float sz = (0.5 + aBright * 8.0) * uPixelRatio;
    gl_PointSize = clamp(sz * (320.0 / -mv.z), 2.5, 256.0);
    gl_Position  = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  varying float vBright;
  varying vec3  vColor;
  uniform float uTime;

  void main() {
    vec2  c    = gl_PointCoord - 0.5;
    float dist = length(c);
    if (dist > 0.5) discard;

    // Bright Gaussian core
    float core = exp(-dist * 14.0);
    // Soft outer halo
    float halo = exp(-dist * 4.5) * 0.28;

    // 6-ray diffraction spikes (telescope optics: primary + 2 secondary)
    float sp_h  = exp(-abs(c.y) * 55.0) * exp(-dist * 2.5);
    float sp_v  = exp(-abs(c.x) * 55.0) * exp(-dist * 2.5);
    float sp_d1 = exp(-abs(c.x - c.y) * 80.0) * exp(-dist * 4.0) * 0.40;
    float sp_d2 = exp(-abs(c.x + c.y) * 80.0) * exp(-dist * 4.0) * 0.40;
    float spikes = (sp_h + sp_v + sp_d1 + sp_d2) * vBright * vBright;

    // Subtle twinkle on the brightest stars only
    float twinkle = 1.0 + 0.10 * sin(uTime * 3.3 + vBright * 191.7)
                        * step(0.75, vBright);

    vec3  col   = vColor * ((core + halo) * twinkle + spikes * 0.9);
    float alpha = min(1.0, (core + halo * 0.45 + spikes * 0.55) * twinkle);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

// Spectral-type color table  (O B A F G K M)
const SPECTRAL = [
  { w: 0.03, r: 0.55, g: 0.70, b: 1.00 },  // O  hot blue
  { w: 0.09, r: 0.78, g: 0.88, b: 1.00 },  // B  blue-white
  { w: 0.14, r: 0.96, g: 0.97, b: 1.00 },  // A  white
  { w: 0.18, r: 1.00, g: 0.96, b: 0.72 },  // F  yellow-white
  { w: 0.23, r: 1.00, g: 0.88, b: 0.50 },  // G  yellow (sun)
  { w: 0.20, r: 1.00, g: 0.62, b: 0.20 },  // K  orange
  { w: 0.13, r: 1.00, g: 0.32, b: 0.06 },  // M  red
];
const CUM_W = (() => { let c = 0; return SPECTRAL.map(s => (c += s.w)); })();

export function createBackgroundStars(count = 40000) {
  const pos    = new Float32Array(count * 3);
  const col    = new Float32Array(count * 3);
  const bright = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Uniform sphere surface at r = 700–1000
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = 700 + Math.random() * 300;
    pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = r * Math.cos(phi);

    // Power-law magnitude: most stars dim, few very bright
    const b = Math.pow(Math.random(), 2.0);
    bright[i] = b;

    // Spectral type
    const rnd = Math.random();
    let sc = SPECTRAL[SPECTRAL.length - 1];
    for (let k = 0; k < CUM_W.length; k++) {
      if (rnd < CUM_W[k]) { sc = SPECTRAL[k]; break; }
    }
    const lum = 0.30 + b * 0.70;
    col[i*3]   = sc.r * lum;
    col[i*3+1] = sc.g * lum;
    col[i*3+2] = sc.b * lum;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,    3));
  geo.setAttribute('aColor',   new THREE.BufferAttribute(col,    3));
  geo.setAttribute('aBright',  new THREE.BufferAttribute(bright, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms:       { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
                      uTime:       { value: 0 } },
    vertexShader:   VERT,
    fragmentShader: FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.name  = 'backgroundStars';
  return points;
}
