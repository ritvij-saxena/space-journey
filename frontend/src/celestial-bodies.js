/**
 * Celestial Bodies
 *
 * Factory functions for every space object type.  All surfaces use custom
 * ShaderMaterials so everything looks procedurally generated on the GPU —
 * no pre-baked textures required.  When textures ARE available (downloaded
 * via scripts/download-textures.mjs) they override the procedural look for
 * extra realism.
 *
 * Exports:
 *   createStar            — emissive sphere + corona + PointLight
 *   createBlackHole       — event horizon + accretion disk + relativistic jets
 *   createPlanet          — 11 biomes, texture-aware
 *   createRings           — Saturn-style ring system
 *   createMoon            — rocky grey sphere
 *   createAsteroidBelt    — point-cloud ring
 *   createNebula          — Gaussian particle cloud (3 emission palettes)
 *   createInterstellarCloud — dark molecular cloud / pillar
 *   createComet           — icy nucleus + ion + dust tail
 *   createSatellite       — box body + solar panels
 */
import * as THREE from 'three';
import { texLib } from './texture-library.js';

// ─── Shared GLSL ──────────────────────────────────────────────────────────────

const GLSL_NOISE = /* glsl */`
  float h3(vec3 p){
    p=fract(p*vec3(0.1031,0.1030,0.0973)); p+=dot(p,p.yxz+33.33);
    return fract((p.x+p.y)*p.z);
  }
  float n3(vec3 p){
    vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(
      mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),
      f.z);
  }
  float fbm(vec3 p){
    return 0.500*n3(p)
          +0.250*n3(p*2.01+vec3(5.2,1.3,8.7))
          +0.125*n3(p*4.02+vec3(3.1,4.8,2.2))
          +0.063*n3(p*8.04+vec3(7.4,2.9,5.1));
  }
`;

// ─── Shared vertex shaders ────────────────────────────────────────────────────

const PLANET_VERT = /* glsl */`
  ${GLSL_NOISE}
  varying vec3 vPos, vWorldPos, vWorldNormal;
  uniform float uBump;
  void main(){
    vPos = position;
    float bump = (uBump > 0.0) ? fbm(position * 2.5) * uBump : 0.0;
    vec3 disp = position + normal * bump;
    vec4 wp = modelMatrix * vec4(disp, 1.0);
    vWorldPos    = wp.xyz;
    vWorldNormal = normalize(mat3(transpose(inverse(modelMatrix))) * normal);
    gl_Position  = projectionMatrix * viewMatrix * wp;
  }
`;

const TEXPLANET_VERT = /* glsl */`
  varying vec3 vWorldPos, vWorldNormal;
  varying vec2 vUv;
  void main(){
    vUv          = uv;
    vec4 wp      = modelMatrix * vec4(position, 1.0);
    vWorldPos    = wp.xyz;
    vWorldNormal = normalize(mat3(transpose(inverse(modelMatrix))) * normal);
    gl_Position  = projectionMatrix * viewMatrix * wp;
  }
`;

const ATM_VERT = /* glsl */`
  varying vec3 vWorldNormal, vWorldPos;
  void main(){
    vWorldNormal = normalize(mat3(transpose(inverse(modelMatrix))) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Atmosphere: physically-inspired Rayleigh + Mie + sharp terminator
const ATM_FRAG = /* glsl */`
  uniform vec3  uAtmColor;
  uniform float uAtmStr;
  uniform vec3  uLightDir;
  varying vec3  vWorldNormal, vWorldPos;

  void main(){
    vec3  V   = normalize(cameraPosition - vWorldPos);
    vec3  N   = normalize(vWorldNormal);
    vec3  L   = normalize(uLightDir);

    float NdV = abs(dot(N, V));
    float NdL = dot(N, L);

    // Fresnel rim thickness — high exponent confines glow to limb only
    float rim = pow(1.0 - NdV, 5.5);

    // Rayleigh scatter (angle-dependent)
    float cosTheta = dot(V, L);
    float rayleigh = 0.75 * (1.0 + cosTheta * cosTheta);

    // Mie forward-scatter haze
    float g   = 0.74;
    float mie = (1.0 - g*g) / pow(max(0.001, 1.0 + g*g - 2.0*g*cosTheta), 1.5) * 0.07;

    // Sharp terminator: narrow twilight band, dark night limb
    float dayLit   = clamp(NdL * 2.2 + 0.22, 0.0, 1.0);
    float twilight = clamp(NdL * 5.0 + 1.8, 0.0, 1.0);  // narrow orange band at terminator
    float nightLim = clamp(-NdL * 1.8 + 0.1, 0.0, 1.0); // dark limb on night side

    // Sunset tint at terminator
    float horizonT  = pow(1.0 - NdV, 3.2);
    float termT     = (1.0 - abs(NdL * 2.5)) * clamp(NdL * 8.0 + 1.0, 0.0, 1.0);
    vec3  sunsetCol = vec3(1.0, 0.38, 0.06);
    vec3  col = mix(uAtmColor * rayleigh, sunsetCol, termT * 0.65 + horizonT * dayLit * 0.35);
    col += vec3(1.0, 0.80, 0.55) * mie * twilight;

    // Night-side scatter: faint dark blue
    col += uAtmColor * 0.08 * nightLim;

    float alpha = rim * uAtmStr * (0.18 + rayleigh * 0.82);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// Separate rotating cloud layer — used by terran and ocean planets
const CLOUD_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime;
  uniform vec3  uLightDir;
  varying vec3  vPos, vWorldPos, vWorldNormal;

  void main(){
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uLightDir);

    // Two FBM layers moving independently (atmosphere moves faster than surface)
    vec3 p1 = vPos + vec3(uTime * 0.024, uTime * 0.006, 0.0);
    vec3 p2 = vPos * 1.7 + vec3(-uTime * 0.016, 0.0, uTime * 0.009);
    float c1 = fbm(p1 * 2.0);
    float c2 = fbm(p2 * 3.5);
    float cloud = c1 * 0.60 + c2 * 0.40;

    float coverage = smoothstep(0.46, 0.64, cloud);
    if (coverage < 0.008) discard;

    float NdL   = dot(N, L);
    float diff  = clamp(NdL, 0.0, 1.0) * 0.88 + 0.06;
    float night = clamp(-NdL * 2.2, 0.0, 1.0);

    // Bright white day-side clouds, dark grey night-side
    vec3 col = mix(vec3(0.90, 0.92, 0.96), vec3(0.07, 0.08, 0.11), night);

    // Thick cloud shadows on cloud base
    float thick = smoothstep(0.60, 0.78, cloud);
    col = mix(col, col * 0.65, thick * 0.45);

    // Twilight: clouds lit orange-pink at terminator
    float twi = (1.0 - abs(NdL * 3.0)) * clamp(NdL * 6.0 + 1.2, 0.0, 1.0);
    col = mix(col, vec3(1.0, 0.62, 0.32), twi * 0.30);

    gl_FragColor = vec4(col * diff, coverage * 0.88);
  }
`;

// ─── Star shaders ─────────────────────────────────────────────────────────────

const STAR_VERT = /* glsl */`
  ${GLSL_NOISE}
  varying vec3 vPos, vWorldPos, vWorldNormal;
  void main(){
    vPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos    = wp.xyz;
    vWorldNormal = normalize(mat3(transpose(inverse(modelMatrix))) * normal);
    gl_Position  = projectionMatrix * viewMatrix * wp;
  }
`;

const STAR_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime;
  uniform vec3  uColor;
  varying vec3  vPos, vWorldPos, vWorldNormal;

  // Approximate cellular granulation: bright cell centers, dark intergranular lanes
  float granulation(vec3 p) {
    // Stack two FBM layers at different scales to mimic convection cells
    float f1 = fbm(p * 2.8 + vec3(uTime*0.018, uTime*0.014, 0.0));
    float f2 = fbm(p * 5.6 - vec3(uTime*0.009, 0.0, uTime*0.011));
    // Sharpen to cell-like contrast
    return pow(f1 * 0.6 + f2 * 0.4, 1.8);
  }

  void main(){
    vec3 V  = normalize(cameraPosition - vWorldPos);
    vec3 N  = normalize(vWorldNormal);
    float mu = max(dot(N, V), 0.0);

    // Limb darkening — quadratic law (u=0.60, v=0.15)
    float limb = 1.0 - 0.60*(1.0 - mu) - 0.15*(1.0 - mu)*(1.0 - mu);

    // Plasma turbulence + granulation
    float p1   = fbm(vPos * 1.8 + vec3(uTime*0.09, uTime*0.06, uTime*0.05));
    float p2   = fbm(vPos * 3.5 - vec3(uTime*0.04, uTime*0.07, 0.0));
    float gran = granulation(vPos);

    float plasma = p1*0.30 + p2*0.18 + gran*0.08;

    // Surface temperature: subtle granulation — star reads as a clean sphere
    vec3 col = uColor * (0.80 + plasma * 0.35);

    // Hot faculae near limb (bright magnetic regions)
    float facula = pow(1.0 - mu, 2.5) * n3(vPos * 3.0 + uTime * 0.004) * 0.22;
    col += uColor * facula;

    gl_FragColor = vec4(col * limb, 1.0);
  }
`;

// ─── Black hole shaders ───────────────────────────────────────────────────────

// Interstellar-style accretion disk — Doppler-dominated, white-hot ISCO
const ACCRETION_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime;
  varying vec2  vUv; // x=radius 0..1, y=angle 0..1

  void main(){
    float r = vUv.x;
    float a = vUv.y * 6.2832;

    // Temperature gradient: white-hot ISCO → orange → brick red → invisible
    vec3 isco = vec3(1.00, 0.97, 0.88);
    vec3 hot  = vec3(1.00, 0.50, 0.05);
    vec3 warm = vec3(0.75, 0.10, 0.01);
    vec3 col;
    if      (r < 0.20) col = mix(isco, hot,  r / 0.20);
    else if (r < 0.55) col = mix(hot,  warm, (r - 0.20) / 0.35);
    else               col = warm * (1.0 - (r - 0.55) / 0.45);

    // Relativistic Doppler beaming — β=0.55, factor ~20× between approaching/receding
    // sin(a) > 0 → approaching side → bright; sin(a) < 0 → receding → faint
    float beta    = 0.55;
    float sinA    = sin(a - uTime * 0.18);
    float D       = pow(1.0 / max(0.01, 1.0 - beta * sinA), 3.0);
    D             = clamp(D * 0.12, 0.0, 4.5);
    col          *= D;

    // Fine radial plasma filaments (magnetic turbulence)
    float turb = fbm(vec3(r * 7.0 + uTime * 0.022, a * 0.5, 0.0));
    col *= 0.55 + turb * 0.80;

    // ISCO inner-edge brightening
    col += isco * pow(max(0.0, 0.06 - r) / 0.06, 2.0) * 2.5 * D;

    float opacity = smoothstep(0.98, 0.50, r) * smoothstep(0.0, 0.03, r) * 0.95;
    if (opacity < 0.005) discard;
    gl_FragColor = vec4(col, opacity);
  }
`;

// Lensed arc above shadow — gravitationally bent image of the disk underside
const LENSED_ARC_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime;
  varying vec2  vUv;
  void main(){
    float r = vUv.x;
    float a = vUv.y * 6.2832;

    // Phase-shifted Doppler (lensed image inverts approaching/receding)
    float beta    = 0.55;
    float sinA    = sin(a + 3.14159 - uTime * 0.18);
    float D       = pow(1.0 / max(0.01, 1.0 - beta * sinA), 3.0);
    D             = clamp(D * 0.08, 0.0, 2.5);

    vec3 col  = mix(vec3(1.0, 0.75, 0.3), vec3(0.8, 0.3, 0.05), r);
    float turb = fbm(vec3(r * 5.0 + uTime * 0.018, a * 0.4, 1.5));
    col *= (0.4 + turb * 0.7) * D;

    float opacity = smoothstep(1.0, 0.1, r) * smoothstep(0.0, 0.08, r) * 0.70;
    if (opacity < 0.004) discard;
    gl_FragColor = vec4(col, opacity);
  }
`;

// Jet particles: gl_PointSize + soft glow
const JET_VERT = /* glsl */`
  attribute float aAlong;
  attribute float aSize;
  varying   float vAlong;
  uniform   float uPixelRatio;
  void main(){
    vAlong = aAlong;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uPixelRatio * (280.0 / -mv.z), 256.0);
    gl_Position  = projectionMatrix * mv;
  }
`;
const JET_FRAG = /* glsl */`
  varying float vAlong;
  uniform float uTime;
  void main(){
    vec2  c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float glow  = exp(-d*10.0)*0.90 + exp(-d*4.0)*0.10;
    float fade  = pow(1.0 - vAlong, 1.4);
    float pulse = 0.55 + 0.45*sin(vAlong*11.0 - uTime*4.2);
    // Base is hot white, tip fades to electric blue
    vec3  col   = mix(vec3(0.08, 0.28, 1.00), vec3(1.00, 0.98, 1.00), pow(1.0-vAlong, 0.6));
    float alpha = glow * fade * pulse;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

// ─── Planet surface fragment shaders ──────────────────────────────────────────

const ROCKY_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform vec3  uC1, uC2, uC3, uC4;
  uniform vec3  uLightDir;
  varying vec3  vPos, vWorldPos, vWorldNormal;

  // Procedural impact craters: bright rim + dark floor
  float craterAt(vec3 p, vec3 c, float r){
    float d = length(p - c);
    if(d > r) return 0.0;
    float t = d / r;
    float rim   = smoothstep(0.0,0.25,t) * smoothstep(1.0,0.62,t); // bright rim ring
    float floor_ = smoothstep(0.30,0.0,t) * 0.18;                  // darker interior
    return rim * 0.28 + floor_;
  }

  void main(){
    vec3 np = normalize(vPos);
    float h = fbm(vPos*2.2);
    float d = n3(vPos*9.0)*0.12;
    vec3 col = h < 0.36 ? uC1 : h < 0.44 ? mix(uC1,uC2,(h-0.36)/0.08)
             : h < 0.68 ? mix(uC2,uC3,(h-0.44)/0.24) : uC4;
    col *= 0.82+d;

    // Polar frost cap
    float lat = abs(np.y);
    col = mix(col, vec3(0.93,0.95,0.98), smoothstep(0.70,0.90,max(lat, h*0.9)));

    // Impact craters — fixed positions seeded by noise hashes
    float cr = 0.0;
    cr += craterAt(np, normalize(vec3( 0.52, 0.68,-0.52)), 0.22);
    cr += craterAt(np, normalize(vec3(-0.70,-0.32, 0.62)), 0.15);
    cr += craterAt(np, normalize(vec3( 0.20,-0.80, 0.56)), 0.18);
    cr += craterAt(np, normalize(vec3(-0.40, 0.55, 0.73)), 0.10);
    cr += craterAt(np, normalize(vec3( 0.80, 0.22,-0.56)), 0.13);
    cr += craterAt(np, normalize(vec3(-0.12,-0.48,-0.87)), 0.09);
    col = mix(col, col * (1.0 - cr * 0.55) + vec3(0.28,0.26,0.22) * cr * 0.30, clamp(cr*3.0,0.0,1.0));

    float diff = max(dot(normalize(vWorldNormal),uLightDir),0.0)*0.90+0.02;
    gl_FragColor = vec4(col*diff, 1.0);
  }
`;

const GAS_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform vec3  uC1, uC2, uC3;
  uniform vec3  uLightDir;
  uniform float uTime;
  varying vec3  vPos, vWorldPos, vWorldNormal;

  void main(){
    vec3  p   = normalize(vPos);
    float lat = p.y;

    // Differential rotation: equator 40% faster than poles (real Jupiter value)
    float omega = 1.0 + (1.0 - lat * lat) * 0.42;
    float t     = uTime * 0.0028 * omega;

    // Sharp atmospheric bands — high contrast like Cassini images
    float turb1 = fbm(vec3(t,        lat * 8.0,  0.0) + vPos * 1.8);
    float turb2 = fbm(vec3(t * 0.85, lat * 18.0, 2.3) + vPos * 3.5);
    // pow sharpens band edges (more contrast between zones and belts)
    float band  = pow(sin(lat * 16.0 + turb1 * 3.2 + turb2 * 1.4) * 0.5 + 0.5, 0.55);
    float detail = fbm(vPos * 5.0 + vec3(t * 1.5, 0.0, t * 0.9)) * 0.22;

    // Primary Great Red Spot (southern hemisphere, oval)
    float stormLon = t * 0.14;
    float sa       = atan(p.z, p.x) + stormLon;
    vec2  stormUV  = vec2(sa / 6.2832, lat);
    vec2  stormOff = (stormUV - vec2(0.0, -0.26)) * vec2(1.9, 1.0);
    float storm    = smoothstep(0.15, 0.06, length(stormOff));
    float swirl    = atan(stormOff.y, stormOff.x) - uTime * 0.10;
    float swirlN   = fbm(vec3(cos(swirl)*3.5, sin(swirl)*3.5, uTime*0.06)) * storm;

    // Secondary smaller storm oval (northern hemisphere)
    vec2  storm2Off = (stormUV - vec2(0.32, 0.40)) * vec2(2.2, 1.0);
    float storm2    = smoothstep(0.09, 0.03, length(storm2Off));
    float swirl2    = atan(storm2Off.y, storm2Off.x) + uTime * 0.14;
    float swirlN2   = fbm(vec3(cos(swirl2)*4.0, sin(swirl2)*4.0, uTime*0.07)) * storm2;

    // Compose: bands → detail → storms
    vec3  col = mix(uC1, uC2, band);
    col       = mix(col, uC3, clamp(detail + fbm(vPos * 2.5 + t) * 0.20, 0.0, 1.0));
    col       = mix(col, vec3(0.74, 0.25, 0.10), storm  * (0.60 + swirlN  * 0.40));
    col       = mix(col, vec3(0.55, 0.72, 0.90), storm2 * (0.55 + swirlN2 * 0.45));

    // Polar hexagon vortex (Saturn north pole)
    float pole = smoothstep(0.82, 0.96, abs(lat));
    float hex  = sin(atan(p.x, p.z) * 6.0 + uTime * 0.004) * 0.5 + 0.5;
    col        = mix(col, uC3 * 1.4, pole * hex * 0.38);

    // Polar bright cap
    float poleCap = smoothstep(0.93, 1.0, abs(lat));
    col = mix(col, vec3(0.88, 0.80, 0.72) * (uC1 * 0.6 + uC2 * 0.4), poleCap * 0.5);

    float diff = max(dot(normalize(vWorldNormal), uLightDir), 0.0) * 0.88 + 0.08;
    gl_FragColor = vec4(col * diff, 1.0);
  }
`;

const OCEAN_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform vec3  uLightDir;
  uniform float uTime;
  varying vec3  vPos, vWorldPos, vWorldNormal;
  void main(){
    float h = fbm(vPos*2.8);
    vec3 col;
    if      (h < 0.50) col = mix(vec3(0.03,0.08,0.32),vec3(0.04,0.22,0.62),h/0.5);
    else if (h < 0.55) col = mix(vec3(0.04,0.22,0.62),vec3(0.60,0.70,0.38),(h-0.50)/0.05);
    else if (h < 0.68) col = mix(vec3(0.20,0.42,0.10),vec3(0.38,0.52,0.18),(h-0.55)/0.13);
    else               col = vec3(0.92,0.94,0.98);
    float cloud = n3(vPos*2.8+vec3(uTime*0.014,0.0,0.0));
    col = mix(col, vec3(0.92,0.94,0.98), smoothstep(0.58,0.74,cloud)*0.55);
    vec3 N = normalize(vWorldNormal); vec3 V = normalize(cameraPosition-vWorldPos);
    float spec = (h < 0.50) ? pow(max(dot(V,reflect(-uLightDir,N)),0.0),30.0)*0.5 : 0.0;
    float diff = max(dot(N,uLightDir),0.0)*0.84+0.04;
    gl_FragColor = vec4(col*diff+vec3(spec), 1.0);
  }
`;

// Earth-like with visible continents, forests, snow, city lights on night side
// Cloud layer is handled by the separate CLOUD_FRAG sphere
const TERRAN_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform vec3  uLightDir;
  uniform float uTime;
  varying vec3  vPos, vWorldPos, vWorldNormal;
  void main(){
    float h = fbm(vPos*2.5);
    float d = n3(vPos*8.0)*0.11;
    vec3 col;
    // Deep ocean → shallow → beach → lowland forest → highland → mountain → snow
    if      (h < 0.28) col = mix(vec3(0.01,0.04,0.22), vec3(0.02,0.12,0.46), h/0.28);
    else if (h < 0.34) col = mix(vec3(0.02,0.12,0.46), vec3(0.03,0.22,0.52), (h-0.28)/0.06);
    else if (h < 0.38) col = mix(vec3(0.72,0.62,0.36), vec3(0.16,0.36,0.08), (h-0.34)/0.04);
    else if (h < 0.62) col = mix(vec3(0.16,0.36,0.08), vec3(0.10,0.22,0.06), (h-0.38)/0.24);
    else if (h < 0.80) col = mix(vec3(0.28,0.24,0.21), vec3(0.58,0.54,0.52), (h-0.62)/0.18);
    else               col = vec3(0.96,0.97,1.00);
    col *= 0.86 + d;

    // Ocean specular highlights (only for water pixels)
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uLightDir);
    float diff     = max(dot(N, L), 0.0) * 0.90 + 0.03;
    float spec     = (h < 0.34) ? pow(max(dot(V, reflect(-L, N)), 0.0), 48.0) * 0.55 : 0.0;

    // City lights on night side (only on continental land)
    float nightFace = max(0.0, -dot(N, L) + 0.06);
    float land      = smoothstep(0.36, 0.40, h);
    float city      = pow(n3(vPos * 18.0), 10.0) * land * nightFace * 0.80;

    gl_FragColor = vec4(col * diff + vec3(spec) + vec3(1.0, 0.85, 0.45) * city, 1.0);
  }
`;

// Venus-like: dense swirling sulphur clouds, no surface visible
const CLOUDY_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform vec3  uLightDir;
  uniform float uTime;
  varying vec3  vPos, vWorldPos, vWorldNormal;
  void main(){
    float c1 = fbm(vPos*2.0+vec3(uTime*0.008,0.0,0.0));
    float c2 = fbm(vPos*4.5-vec3(uTime*0.005,0.0,0.0));
    float cloud = c1*0.55+c2*0.45;
    vec3 col = mix(vec3(0.68,0.52,0.24),vec3(0.92,0.76,0.44),cloud);
    col = mix(col, vec3(0.52,0.28,0.08), pow(1.0-cloud,3.0)*0.7);
    float lat  = normalize(vPos).y;
    float band = sin(lat*7.0+c1*3.0)*0.5+0.5;
    col = mix(col, vec3(0.88,0.66,0.28), band*0.12);
    float diff = max(dot(normalize(vWorldNormal),uLightDir),0.0)*0.82+0.08;
    gl_FragColor = vec4(col*diff, 1.0);
  }
`;

const ICE_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform vec3  uLightDir;
  varying vec3  vPos, vWorldPos, vWorldNormal;
  void main(){
    float n1 = fbm(vPos*2.0);
    float n2 = n3(vPos*6.0+vec3(1.5,2.3,0.8));
    float crack = pow(abs(sin(vPos.x*4.0+n1*3.0)*sin(vPos.z*4.0+n1*4.0)),2.0);
    vec3 col = mix(mix(vec3(0.62,0.78,0.96),vec3(0.84,0.93,1.00),n1),vec3(0.28,0.42,0.82),crack*0.65);
    col *= 0.82+n2*0.32;
    float diff = max(dot(normalize(vWorldNormal),uLightDir),0.0)*0.82+0.12;
    gl_FragColor = vec4(col*diff, 1.0);
  }
`;

const LAVA_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform vec3  uLightDir;
  uniform float uTime;
  varying vec3  vPos, vWorldPos, vWorldNormal;
  void main(){
    vec3 p = vPos+vec3(uTime*0.003,0.0,uTime*0.002);
    float rock = fbm(p*2.5);
    vec3 darkRock = mix(vec3(0.04,0.02,0.01),vec3(0.10,0.06,0.03),rock);
    float crack = pow(max(0.0, sin(p.x*5.2+rock*3.0)*sin(p.z*4.8+rock*4.0)), 3.5);
    vec3 lava = mix(vec3(1.00,0.18,0.00),vec3(1.00,0.75,0.05),crack);
    vec3 col  = mix(darkRock,lava,crack*0.85);
    float diff = max(dot(normalize(vWorldNormal),uLightDir),0.0)*0.65+0.18;
    col *= diff;
    col += lava*crack*0.60;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const DESERT_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform vec3  uC1, uC2;
  uniform vec3  uLightDir;
  varying vec3  vPos, vWorldPos, vWorldNormal;
  void main(){
    float n1 = fbm(vPos*2.0);
    float n2 = n3(vPos*5.5+vec3(2.1,0.3,4.7));
    float dune = sin(vPos.x*3.0+n1*4.0)*sin(vPos.z*2.5+n1*3.0)*0.5+0.5;
    vec3 col = mix(uC1,uC2,dune*0.6+n2*0.4)*(0.80+n2*0.38);
    float diff = max(dot(normalize(vWorldNormal),uLightDir),0.0)*0.90+0.05;
    gl_FragColor = vec4(col*diff, 1.0);
  }
`;

// Textured planet surface — just lighting, texture provides color
const TEXPLANET_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform sampler2D uMap;
  uniform sampler2D uNightMap;
  uniform vec3      uLightDir;
  uniform float     uTime;
  uniform float     uHasNight;
  varying vec3      vWorldNormal, vWorldPos;
  varying vec2      vUv;
  void main(){
    vec3 N    = normalize(vWorldNormal);
    vec3 L    = normalize(uLightDir);
    float NdL = dot(N, L);
    float diff  = clamp(NdL, 0.0, 1.0);
    float diffS = diff*0.90 + 0.04;   // day: full lit
    vec3 day   = texture2D(uMap, vUv).rgb;
    vec3 col   = day * diffS;
    // Night-side city lights (Earth only)
    if (uHasNight > 0.5) {
      float nightBlend = clamp(-NdL*1.5, 0.0, 1.0);
      vec3  nightCol   = texture2D(uNightMap, vUv).rgb;
      col = mix(col, nightCol * 0.8, nightBlend);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ─── Nebula shaders ───────────────────────────────────────────────────────────

const NEBULA_VERT = /* glsl */`
  attribute vec3  customColor;
  attribute float size;
  varying vec3    vColor;
  uniform float   uPixelRatio;
  void main(){
    vColor = customColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * uPixelRatio * (300.0 / -mv.z), 1.5, 256.0);
    gl_Position  = projectionMatrix * mv;
  }
`;
const NEBULA_FRAG = /* glsl */`
  varying vec3 vColor;
  void main(){
    vec2 c = gl_PointCoord-0.5; float d=length(c);
    if (d > 0.5) discard;
    float a = exp(-d*4.0)*0.18;
    gl_FragColor = vec4(vColor, a);
  }
`;

// ─── Comet tail shaders ───────────────────────────────────────────────────────

const COMET_VERT = /* glsl */`
  attribute float aAlong;
  attribute float aSize;
  varying   float vAlong;
  uniform   float uPixelRatio;
  void main(){
    vAlong = aAlong;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uPixelRatio * (200.0 / -mv.z), 256.0);
    gl_Position  = projectionMatrix * mv;
  }
`;
const COMET_ION_FRAG = /* glsl */`
  varying float vAlong;
  void main(){
    vec2 c=gl_PointCoord-0.5; float d=length(c);
    if(d>0.5) discard;
    float glow = exp(-d*10.0)*0.9 + exp(-d*4.0)*0.1;
    float fade = pow(1.0-vAlong, 1.2);
    vec3 col = mix(vec3(0.4,0.7,1.0), vec3(0.9,0.95,1.0), (1.0-vAlong)*0.6);
    gl_FragColor = vec4(col, glow*fade*0.7);
  }
`;
const COMET_DUST_FRAG = /* glsl */`
  varying float vAlong;
  void main(){
    vec2 c=gl_PointCoord-0.5; float d=length(c);
    if(d>0.5) discard;
    float glow = exp(-d*6.0)*0.6 + exp(-d*2.5)*0.15;
    float fade = pow(1.0-vAlong, 0.9);
    vec3 col = mix(vec3(1.0,0.75,0.3), vec3(0.7,0.45,0.15), vAlong);
    gl_FragColor = vec4(col, glow*fade*0.5);
  }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function boxMuller(rng) {
  const u = Math.max(rng.next(), 1e-7);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

function makePlanetMat(fragGlsl, uniforms = {}, bump = 0.0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLightDir: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
      uTime:     { value: 0 },
      uBump:     { value: bump },
      ...uniforms,
    },
    vertexShader:   PLANET_VERT,
    fragmentShader: fragGlsl,
  });
}

function colorU(hex) { return { value: new THREE.Color(hex) }; }

// ─── Star glow sprite ─────────────────────────────────────────────────────────

function _makeStarGlow(radius) {
  const size   = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx  = canvas.getContext('2d');
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.00, 'rgba(255, 255, 230, 1.0)');
  grad.addColorStop(0.08, 'rgba(255, 230, 150, 0.75)');
  grad.addColorStop(0.25, 'rgba(255, 180,  60, 0.30)');
  grad.addColorStop(0.55, 'rgba(200, 100,  20, 0.08)');
  grad.addColorStop(1.00, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(radius * 16);
  return sprite;
}

// ─── Star ─────────────────────────────────────────────────────────────────────

export function createStar(radius, color) {
  const mat  = new THREE.ShaderMaterial({
    uniforms:       { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader:   STAR_VERT,
    fragmentShader: STAR_FRAG,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);

  // Fresnel corona — FrontSide shader so no hard BackSide edge
  const coronaMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: ATM_VERT,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying vec3 vWorldNormal, vWorldPos;
      void main(){
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 N = normalize(vWorldNormal);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.2);
        gl_FragColor = vec4(uColor * 1.4, rim * 0.35);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const corona = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.35, 32, 16), coronaMat);

  // Second larger diffuse halo
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: ATM_VERT,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying vec3 vWorldNormal, vWorldPos;
      void main(){
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 N = normalize(vWorldNormal);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        gl_FragColor = vec4(uColor * 0.8, rim * 0.12);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.80, 32, 16), haloMat);

  const light = new THREE.PointLight(new THREE.Color(color), 2.0, radius * 40, 1.5);

  const group = new THREE.Group();
  group.add(mesh, corona, halo, light);
  group.add(_makeStarGlow(radius));
  group.userData = { type: 'star', mat };
  return group;
}

// ─── Black Hole ───────────────────────────────────────────────────────────────

/** Build a UV-mapped RingGeometry where uv.x = radial 0..1, uv.y = angular 0..1 */
function _makeRingGeo(inner, outer, segments = 256, rings = 6) {
  const geo = new THREE.RingGeometry(inner, outer, segments, rings);
  const pos = geo.attributes.position;
  const uv  = geo.attributes.uv;
  const v   = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    uv.setXY(i,
      (v.length() - inner) / (outer - inner),
      (Math.atan2(v.y, v.x) / (Math.PI * 2) + 1) % 1,
    );
  }
  uv.needsUpdate = true;
  return geo;
}

function _makeJetPoints(bhRadius, jetLen, dir, mat) {
  const count = 750;
  const pos   = new Float32Array(count * 3);
  const along = new Float32Array(count);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = Math.pow(Math.random(), 0.50);
    // Collimated near base, flares open farther out
    const spread = bhRadius * 0.35 * (1 - t * 0.70) + bhRadius * 0.12 * t;
    const r      = spread * Math.random();
    const a      = Math.random() * Math.PI * 2;
    pos[i*3]   = Math.cos(a) * r;
    pos[i*3+1] = dir * (bhRadius * 1.2 + t * jetLen);
    pos[i*3+2] = Math.sin(a) * r;
    along[i] = t;
    sizes[i] = (1 - t) * 6.0 + 0.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,   3));
  geo.setAttribute('aAlong',   new THREE.BufferAttribute(along, 1));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
  return new THREE.Points(geo, mat);
}

export function createBlackHole(radius = 8) {
  const group = new THREE.Group();
  group.userData = { type: 'black_hole' };

  const DISK_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const ADD_MAT   = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  // ── Event horizon — solid black sphere ────────────────────────────────────
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  ));

  // ── Shadow sphere — opaque, defines the Gargantua black silhouette ────────
  // Schwarzschild photon sphere ≈ 2.6r; shadow apparent radius ≈ 2.6r
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius * 2.55, 64, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: false }),
  ));

  // ── Photon rings — razor thin, stacked tori at ~2.6r ─────────────────────
  const ringData = [
    { r: 2.60, t: 0.028, color: 0xfff8e0, opacity: 0.95 },
    { r: 2.70, t: 0.018, color: 0xffcc88, opacity: 0.50 },
    { r: 2.85, t: 0.012, color: 0xff9933, opacity: 0.22 },
  ];
  for (const rd of ringData) {
    group.add(new THREE.Mesh(
      new THREE.TorusGeometry(radius * rd.r, radius * rd.t, 8, 256),
      new THREE.MeshBasicMaterial({ color: rd.color, transparent: true,
        opacity: rd.opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
    ));
  }

  // ── Main accretion disk — single thin flat plane (Interstellar style) ─────
  const diskInner = radius * 2.70;
  const diskOuter = radius * 7.0;
  const diskMat   = new THREE.ShaderMaterial({
    uniforms:       { uTime: { value: 0 } },
    vertexShader:   DISK_VERT,
    fragmentShader: ACCRETION_FRAG,
    side: THREE.DoubleSide, ...ADD_MAT,
  });
  // Slight tilt so the disk is visible from camera (~7° from edge-on)
  const disk = new THREE.Mesh(_makeRingGeo(diskInner, diskOuter, 256, 4), diskMat);
  disk.rotation.x = -Math.PI * 0.07;
  group.add(disk);

  // ── Lensed arc — bent image of disk that appears above the shadow ─────────
  // Two arcs (top and bottom) rotated to ~42° from disk plane
  const arcInner = radius * 2.62;
  const arcOuter = radius * 4.5;
  const arcMat   = new THREE.ShaderMaterial({
    uniforms:       { uTime: { value: 0 } },
    vertexShader:   DISK_VERT,
    fragmentShader: LENSED_ARC_FRAG,
    side: THREE.DoubleSide, ...ADD_MAT,
  });
  const lensedTop = new THREE.Mesh(_makeRingGeo(arcInner, arcOuter, 192, 2), arcMat);
  lensedTop.rotation.x = Math.PI * 0.462;
  group.add(lensedTop);
  const lensedBot = new THREE.Mesh(_makeRingGeo(arcInner, arcOuter, 192, 2), arcMat);
  lensedBot.rotation.x = -Math.PI * 0.462;
  group.add(lensedBot);

  // ── Faint orange glow shell (scattered light near shadow edge) ─────────────
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius * 2.80, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: ATM_VERT,
      fragmentShader: /* glsl */`
        varying vec3 vWorldNormal, vWorldPos;
        void main(){
          vec3 V = normalize(cameraPosition - vWorldPos);
          float rim = pow(1.0 - abs(dot(normalize(vWorldNormal), V)), 2.2);
          gl_FragColor = vec4(0.90, 0.42, 0.04, rim * 0.30);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  ));

  // ── Warm orange-gold light from accretion disk ─────────────────────────────
  group.add(new THREE.PointLight(0xff7700, 3.0, radius * 50, 1.6));

  group.userData.animMats = [diskMat, arcMat];
  return group;
}

// ─── Planet ───────────────────────────────────────────────────────────────────

const BIOME_PARAMS = {
  rocky_grey:  { frag: ROCKY_FRAG,  bump: 0.035, atm: 0x8899bb, atmStr: 0.42,
    u: { uC1: colorU('#1a1a22'), uC2: colorU('#556655'), uC3: colorU('#778877'), uC4: colorU('#aaaaaa') } },
  rocky_red:   { frag: ROCKY_FRAG,  bump: 0.035, atm: 0xdd8855, atmStr: 0.38,
    u: { uC1: colorU('#3d1a0a'), uC2: colorU('#8b3e1a'), uC3: colorU('#c46a35'), uC4: colorU('#e8b090') } },
  gas_jupiter: { frag: GAS_FRAG,    bump: 0.0,   atm: 0xddaa77, atmStr: 0.22,
    u: { uC1: colorU('#c87941'), uC2: colorU('#e8c490'), uC3: colorU('#9c5535') } },
  gas_neptune: { frag: GAS_FRAG,    bump: 0.0,   atm: 0x3355cc, atmStr: 0.50,
    u: { uC1: colorU('#163566'), uC2: colorU('#2255aa'), uC3: colorU('#88aadd') } },
  ocean:       { frag: OCEAN_FRAG,  bump: 0.020, atm: 0x4488ff, atmStr: 0.55, u: {} },
  terran:      { frag: TERRAN_FRAG, bump: 0.030, atm: 0x55aaff, atmStr: 0.65, u: {} },
  ice:         { frag: ICE_FRAG,    bump: 0.015, atm: 0x99ccff, atmStr: 0.45, u: {} },
  lava:        { frag: LAVA_FRAG,   bump: 0.040, atm: 0xff5500, atmStr: 0.35, u: {} },
  cloudy:      { frag: CLOUDY_FRAG, bump: 0.0,   atm: 0xddaa55, atmStr: 0.52, u: {} },
  desert_sand: { frag: DESERT_FRAG, bump: 0.025, atm: 0xddaa55, atmStr: 0.28,
    u: { uC1: colorU('#c8a040'), uC2: colorU('#e8c870') } },
  desert_rust: { frag: DESERT_FRAG, bump: 0.025, atm: 0xcc7733, atmStr: 0.28,
    u: { uC1: colorU('#9a4020'), uC2: colorU('#cc7040') } },
};

// Map biome → texture name (from TextureLibrary catalog)
const BIOME_TEX = {
  ocean:       'earth',
  terran:      'earth',
  rocky_red:   'mars',
  desert_rust: 'mars',
  gas_jupiter: 'jupiter',
  gas_neptune: 'neptune',
  cloudy:      'venus',
  ice:         null,     // procedural only
  lava:        null,
  rocky_grey:  'mercury',
  desert_sand: 'mercury',
};

export async function createPlanet(biome, radius) {
  const BIOMES = Object.keys(BIOME_PARAMS);
  biome = biome ?? BIOMES[Math.floor(Math.random() * BIOMES.length)];
  const bp  = BIOME_PARAMS[biome] ?? BIOME_PARAMS.rocky_grey;
  const geo = new THREE.SphereGeometry(radius, 64, 32);

  let pMesh;
  const texName = BIOME_TEX[biome] ?? null;
  const tex     = texName ? texLib.getSync(texName) : null;

  if (tex) {
    // Textured path — much more realistic
    const nightTex = (biome === 'terran' || biome === 'ocean')
      ? texLib.getSync('earth_night') : null;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap:      { value: tex },
        uNightMap: { value: nightTex ?? tex },
        uLightDir: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
        uTime:     { value: 0 },
        uHasNight: { value: nightTex ? 1.0 : 0.0 },
      },
      vertexShader:   TEXPLANET_VERT,
      fragmentShader: TEXPLANET_FRAG,
    });
    pMesh = new THREE.Mesh(geo, mat);
  } else {
    // Procedural path
    const mat = makePlanetMat(bp.frag, bp.u, bp.bump);
    pMesh = new THREE.Mesh(geo, mat);
  }
  pMesh.userData.type = 'planet';

  // Atmosphere
  const atmMat = new THREE.ShaderMaterial({
    uniforms: {
      uAtmColor: { value: new THREE.Color(bp.atm) },
      uAtmStr:   { value: bp.atmStr },
      uLightDir: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
    },
    vertexShader:   ATM_VERT,
    fragmentShader: ATM_FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    side:           THREE.FrontSide,
  });
  const atm = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.14, 48, 24), atmMat);
  atm.renderOrder = 1;

  const group = new THREE.Group();
  group.add(pMesh, atm);
  group.userData = { type: 'planet', biome };
  return group;
}

// Biomes that get a separate rotating cloud sphere
const CLOUD_BIOMES = new Set(['terran', 'ocean']);

export function createPlanetSync(biome, radius) {
  const BIOMES = Object.keys(BIOME_PARAMS);
  biome = biome ?? BIOMES[Math.floor(Math.random() * BIOMES.length)];
  const bp  = BIOME_PARAMS[biome] ?? BIOME_PARAMS.rocky_grey;
  const geo = new THREE.SphereGeometry(radius, 64, 32);

  const texName = BIOME_TEX[biome] ?? null;
  const tex     = texName ? texLib.getSync(texName) : null;

  let pMesh;
  if (tex) {
    const nightTex = (biome === 'terran' || biome === 'ocean') ? texLib.getSync('earth_night') : null;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap:      { value: tex },
        uNightMap: { value: nightTex ?? tex },
        uLightDir: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
        uTime:     { value: 0 },
        uHasNight: { value: nightTex ? 1.0 : 0.0 },
      },
      vertexShader:   TEXPLANET_VERT,
      fragmentShader: TEXPLANET_FRAG,
    });
    pMesh = new THREE.Mesh(geo, mat);
  } else {
    pMesh = new THREE.Mesh(geo, makePlanetMat(bp.frag, bp.u, bp.bump));
  }
  pMesh.userData.type = 'planet';

  // Atmosphere shell
  const atmMat = new THREE.ShaderMaterial({
    uniforms: {
      uAtmColor: { value: new THREE.Color(bp.atm) },
      uAtmStr:   { value: bp.atmStr },
      uLightDir: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
    },
    vertexShader: ATM_VERT, fragmentShader: ATM_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const atm = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.14, 48, 24), atmMat);
  atm.renderOrder = 1;

  const group = new THREE.Group();
  group.add(pMesh, atm);  // children[0] = surface, children[1] = atmosphere

  // ── Separate cloud sphere for terran / ocean planets ──────────────────────
  if (CLOUD_BIOMES.has(biome)) {
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uLightDir: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
      },
      vertexShader:   PLANET_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.NormalBlending,
      side:           THREE.FrontSide,
    });
    // Cloud layer floats 8% above surface, renders over atmosphere
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.06, 48, 24), cloudMat);
    cloud.renderOrder = 2;
    group.add(cloud);  // children[2] = cloud sphere
  }

  group.userData = { type: 'planet', biome };
  return group;
}

// ─── Rings ────────────────────────────────────────────────────────────────────

export function createRings(innerRadius, outerRadius, colorA, colorB, saturnTex = null) {
  const geo = new THREE.RingGeometry(innerRadius, outerRadius, 192, 4);
  const pos = geo.attributes.position;
  const uv  = geo.attributes.uv;
  const v3  = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    uv.setXY(i, (v3.length() - innerRadius) / (outerRadius - innerRadius), 0);
  }

  let mat;
  if (saturnTex) {
    mat = new THREE.MeshBasicMaterial({
      map: saturnTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  } else {
    mat = new THREE.ShaderMaterial({
      uniforms: { uColorA: { value: new THREE.Color(colorA) }, uColorB: { value: new THREE.Color(colorB) } },
      vertexShader:   /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColorA, uColorB; varying vec2 vUv;
        void main(){
          float t = vUv.x;
          float gap = smoothstep(0.44,0.56, abs(fract(t*5.0+0.5)-0.5)*2.0)*0.80;
          float gap2 = step(0.48, t)*step(t,0.52)*0.95; // Cassini-like gap
          vec3 col = mix(uColorA, uColorB, fract(t*4.8));
          gl_FragColor = vec4(col, (1.0-max(gap,gap2))*0.65);
        }
      `,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = Math.PI * 0.5;
  return ring;
}

// ─── Moon ─────────────────────────────────────────────────────────────────────

export function createMoon(radius) {
  const texN = texLib.getSync('moon');
  let mesh;
  if (texN) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texN }, uNightMap: { value: texN },
        uLightDir: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
        uTime: { value: 0 }, uHasNight: { value: 0.0 } },
      vertexShader: TEXPLANET_VERT, fragmentShader: TEXPLANET_FRAG,
    });
    mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  } else {
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 16),
      makePlanetMat(ROCKY_FRAG, {
        uC1: colorU('#222220'), uC2: colorU('#555550'), uC3: colorU('#777770'), uC4: colorU('#999990'),
      }, 0.03),
    );
  }
  mesh.userData = { type: 'moon' };
  return mesh;
}

// ─── Asteroid Belt ────────────────────────────────────────────────────────────

export function createAsteroidBelt(count, innerR, outerR) {
  const rng   = new SeededRandom(((innerR * 73 + outerR * 31) | 0) >>> 0);
  const geo   = new THREE.OctahedronGeometry(1, 0);
  const mat   = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh  = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const angle = rng.next() * Math.PI * 2;
    const r     = innerR + rng.next() * (outerR - innerR);
    const y     = (rng.next() - 0.5) * (outerR - innerR) * 0.08;
    dummy.position.set(r * Math.cos(angle), y, r * Math.sin(angle));
    dummy.rotation.set(
      rng.next() * Math.PI * 2, rng.next() * Math.PI * 2, rng.next() * Math.PI * 2,
    );
    // Non-uniform scale for irregular shape
    dummy.scale.set(
      0.10 + rng.next() * 0.65,
      0.08 + rng.next() * 0.50,
      0.10 + rng.next() * 0.60,
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const v = 0.35 + rng.next() * 0.30;
    color.setRGB(v * 0.82, v * 0.72, v * 0.58);
    mesh.setColorAt(i, color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// ─── Nebula ───────────────────────────────────────────────────────────────────

const NEBULA_PALETTES = [
  [[1.0,0.25,0.45],[0.15,0.85,0.80],[0.90,0.50,0.15]],  // HII: pink/teal/orange
  [[0.30,0.60,1.00],[0.90,0.20,0.15],[0.80,0.70,0.20]],  // planetary: blue/red/yellow
  [[0.80,0.10,0.90],[0.45,0.05,0.60],[0.90,0.30,0.70]],  // supernova remnant: purples
];

export function createNebula(particleCount, seed) {
  const rng     = new SeededRandom(seed);
  const palette = NEBULA_PALETTES[rng.int(0, NEBULA_PALETTES.length - 1)];
  const count   = particleCount;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);

  // Multiple offset sub-clouds for filamentary structure
  const numClusters = rng.int(3, 6);
  const clusters = Array.from({ length: numClusters }, () => ({
    ox: rng.range(-30, 30),
    oy: rng.range(-15, 15),
    oz: rng.range(-25, 25),
    sigmaScale: rng.range(0.6, 1.4),
  }));

  for (let i = 0; i < count; i++) {
    const cl = clusters[rng.int(0, clusters.length - 1)];
    const sigma = 42 * cl.sigmaScale;

    const gx = cl.ox + boxMuller(rng) * sigma;
    const gy = cl.oy + boxMuller(rng) * sigma * 0.90;
    const gz = cl.oz + boxMuller(rng) * sigma * 0.90;
    pos[i*3] = gx; pos[i*3+1] = gy; pos[i*3+2] = gz;

    // Color by radial zone: hot ionized core → cooler outer shell
    const r  = Math.sqrt(gx*gx + gy*gy + gz*gz) / (sigma * 1.6);
    const c  = palette[Math.min(Math.floor(r * palette.length), palette.length - 1)];

    // Central ionising star brightening (inner 20% very bright)
    const coreBright = Math.exp(-r * 3.5) * 0.8;
    const br = 0.35 + rng.next() * 0.65 + coreBright;
    col[i*3]   = Math.min(c[0] * br, 1.0);
    col[i*3+1] = Math.min(c[1] * br, 1.0);
    col[i*3+2] = Math.min(c[2] * br, 1.0);
    siz[i] = 1.2 + rng.next() * 7 * (0.5 + r * 0.5);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',    new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('customColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size',        new THREE.BufferAttribute(siz, 1));
  return new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: NEBULA_VERT, fragmentShader: NEBULA_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

// ─── Interstellar Cloud ───────────────────────────────────────────────────────

export function createInterstellarCloud(seed, count = 3500) {
  const rng      = new SeededRandom(seed);
  const numPillar = rng.int(2, 4);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Spread particles across pillars
    const p   = rng.int(0, numPillar - 1);
    const px  = (p - numPillar * 0.5) * 28 + rng.range(-4, 4);
    const pz  = rng.range(-18, 18);
    const ht  = 55 + rng.next() * 35;
    const sig = 9 + rng.next() * 5;

    const y  = rng.range(-ht * 0.5, ht * 0.5);
    const r  = sig * Math.sqrt(-2 * Math.log(Math.max(rng.next(), 1e-7)));
    const a  = rng.next() * Math.PI * 2;

    pos[i*3]   = px + Math.cos(a) * r * 0.45;
    pos[i*3+1] = y;
    pos[i*3+2] = pz + Math.sin(a) * r * 0.45;

    const dist = r / (sig * 2);
    // Inner: dark molecular dust  →  outer: ionised hot gas (Pillars of Creation palette)
    if (dist < 0.25) {
      col[i*3]   = 0.08 + rng.next() * 0.06;
      col[i*3+1] = 0.03 + rng.next() * 0.02;
      col[i*3+2] = 0.01;
    } else if (dist < 0.65) {
      col[i*3]   = 0.38 + rng.next() * 0.22;
      col[i*3+1] = 0.08 + rng.next() * 0.08;
      col[i*3+2] = 0.12 + rng.next() * 0.10;
    } else {
      col[i*3]   = 0.75 + rng.next() * 0.25;
      col[i*3+1] = 0.35 + rng.next() * 0.20;
      col[i*3+2] = 0.55 + rng.next() * 0.30;
    }
    siz[i] = 4 + rng.next() * 10;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',    new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('customColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size',        new THREE.BufferAttribute(siz, 1));
  return new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: NEBULA_VERT, fragmentShader: NEBULA_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

// ─── Comet ────────────────────────────────────────────────────────────────────

export function createComet(seed, tailDir = new THREE.Vector3(1, 0.1, 0)) {
  const rng   = new SeededRandom(seed);
  const group = new THREE.Group();
  group.userData = { type: 'comet' };

  const nucleusR = rng.range(0.35, 0.9);
  const td       = tailDir.clone().normalize();

  // Icy nucleus
  const nMesh = new THREE.Mesh(
    new THREE.SphereGeometry(nucleusR, 20, 10),
    makePlanetMat(ICE_FRAG, {}, 0.04),
  );
  group.add(nMesh);

  // Coma (fuzzy glow around nucleus)
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(nucleusR * 4, 16, 8),
    new THREE.ShaderMaterial({
      uniforms: { uAtmColor: { value: new THREE.Color(0xaaddff) }, uAtmStr: { value: 0.7 },
                  uLightDir: { value: new THREE.Vector3(0, 0, 1) } },
      vertexShader: ATM_VERT, fragmentShader: ATM_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  ));

  // Helper: create tail particles
  function _tail(count, lengthFactor, spread, fragShader) {
    const ps  = new Float32Array(count * 3);
    const al  = new Float32Array(count);
    const sz  = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const w = spread * (1 + t * 1.8) * Math.random();
      const perp1 = new THREE.Vector3(-td.z, 0, td.x).normalize();
      const perp2 = td.clone().cross(perp1).normalize();
      const ang = Math.random() * Math.PI * 2;
      const base = td.clone().multiplyScalar(t * lengthFactor);
      const off  = perp1.clone().multiplyScalar(Math.cos(ang)*w)
                    .add(perp2.clone().multiplyScalar(Math.sin(ang)*w));
      ps[i*3]   = base.x + off.x;
      ps[i*3+1] = base.y + off.y;
      ps[i*3+2] = base.z + off.z;
      al[i] = t;
      sz[i] = (1 - t) * 2.5 + 0.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(ps, 3));
    g.setAttribute('aAlong',   new THREE.BufferAttribute(al, 1));
    g.setAttribute('aSize',    new THREE.BufferAttribute(sz, 1));
    return new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: COMET_VERT, fragmentShader: fragShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  }

  group.add(_tail(700, 28, nucleusR * 0.9, COMET_ION_FRAG));   // narrow blue ion tail
  group.add(_tail(500, 22, nucleusR * 2.2, COMET_DUST_FRAG));  // wider yellow dust tail

  return group;
}

// ─── Satellite ────────────────────────────────────────────────────────────────

export function createSatellite(lightDir = new THREE.Vector3(1, 0.5, 0.5)) {
  const group = new THREE.Group();
  group.userData = { type: 'satellite' };

  const LD = lightDir.clone().normalize();
  const litMat  = (col) => new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(col) }, uLightDir: { value: LD } },
    vertexShader:   /* glsl */`varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 uCol,uLightDir; varying vec3 vN;
      void main(){ float d=max(dot(vN,normalize(uLightDir)),0.0)*0.85+0.08; gl_FragColor=vec4(uCol*d,1.0); }`,
  });

  // Body
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.30, 0.65), litMat(0x8899bb)));
  // Solar panels
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1.70, 0.025, 0.42), litMat(0x0a2268)));
  // Antenna dish
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.08, 8), litMat(0xcccccc));
  dish.position.set(0, 0.20, 0.22);
  group.add(dish);
  // Small blinking beacon (tiny bright sphere)
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xff3300 }),
  );
  beacon.position.set(0.22, 0.18, -0.30);
  group.add(beacon);

  return group;
}

// ─── Space Dust ───────────────────────────────────────────────────────────────

/**
 * Volumetric micro-dust filling a sector — gives space depth and atmosphere.
 * @param {number} seed
 * @param {number} span  — half-width of the dust volume
 */
export function createSpaceDust(seed, span = 260) {
  const rng   = new SeededRandom(seed);
  const count = 600;
  const pos   = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i*3]   = rng.range(-span, span);
    pos[i*3+1] = rng.range(-55, 55);
    pos[i*3+2] = rng.range(-span, span);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: /* glsl */`
      uniform float uPixelRatio;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(0.18 * uPixelRatio * (300.0 / -mv.z), 32.0);
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        if (length(c) > 0.5) discard;
        gl_FragColor = vec4(0.40, 0.50, 0.67, 0.09);
      }
    `,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  }));
}

// ─── Wormhole ─────────────────────────────────────────────────────────────────

const WORMHOLE_DISC_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const WORMHOLE_DISC_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime;
  varying vec2  vUv;
  void main(){
    vec2  uv = vUv * 2.0 - 1.0;
    float r  = length(uv);
    if (r > 1.0) discard;
    float a = atan(uv.y, uv.x);

    // Swirling galaxy-like aperture — the "other universe"
    float swirl   = a + (1.0 - r) * 5.0 - uTime * 0.55;
    float pattern = fbm(vec3(cos(swirl) * r * 2.5, sin(swirl) * r * 2.5, uTime * 0.06));

    vec3  deep  = mix(vec3(0.02, 0.04, 0.28), vec3(0.46, 0.08, 0.78), pattern);
    vec3  bright = vec3(0.85, 0.65, 1.00);
    vec3  col = mix(deep, bright, pow(max(0.0, 1.0 - r), 3.0) * 0.55);

    // Radial streaks of light
    float streak = pow(max(0.0, sin(a * 6.0 + uTime * 0.4)), 8.0) * (1.0 - r);
    col += vec3(0.6, 0.4, 1.0) * streak * 0.5;

    float alpha = smoothstep(1.0, 0.82, r);
    gl_FragColor = vec4(col, alpha * 0.94);
  }
`;

/**
 * Creates a wormhole: animated inner disc + glowing throat rings + lensing haze.
 * @param {number} radius
 */
export function createWormhole(radius = 12) {
  const group = new THREE.Group();
  group.userData = { type: 'wormhole' };

  // Inner disc — the window to another universe
  const discMat = new THREE.ShaderMaterial({
    uniforms:       { uTime: { value: 0 } },
    vertexShader:   WORMHOLE_DISC_VERT,
    fragmentShader: WORMHOLE_DISC_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(new THREE.CircleGeometry(radius, 128), discMat));

  // Inner throat ring — bright cyan
  group.add(new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius * 0.045, 8, 128),
    new THREE.MeshBasicMaterial({
      color: 0x99eeff, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  ));

  // Mid glow ring
  group.add(new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.06, radius * 0.12, 8, 128),
    new THREE.MeshBasicMaterial({
      color: 0x4488cc, transparent: true, opacity: 0.45,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  ));

  // Outer gravitational lensing haze (Fresnel sphere)
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.6, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: ATM_VERT,
      fragmentShader: /* glsl */`
        varying vec3 vWorldNormal, vWorldPos;
        void main(){
          vec3 V = normalize(cameraPosition - vWorldPos);
          float rim = pow(1.0 - abs(dot(normalize(vWorldNormal), V)), 2.2);
          gl_FragColor = vec4(0.45, 0.75, 1.00, rim * 0.30);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  ));

  // Teal PointLight — wormhole energy emanation
  group.add(new THREE.PointLight(0x44aaff, 1.8, radius * 22, 2));

  group.userData.animMats = [discMat];
  return group;
}

// ─── Neutron Star / Pulsar ────────────────────────────────────────────────────

/**
 * Neutron star with rotating pulsar beam, magnetosphere glow, and X-ray jet.
 *
 * Physically: neutron stars are ~10 km radius but here scaled for visibility.
 * The pulsar beam rotates at uTime * uPeriod in GLSL — no CPU-side rotation needed.
 */
const NS_SURFACE_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime;
  uniform float uPulseRate;  // rotations/second (typically 0.5-30 Hz)
  varying vec3  vPos, vWorldPos, vWorldNormal;

  void main(){
    vec3 V   = normalize(cameraPosition - vWorldPos);
    vec3 N   = normalize(vWorldNormal);
    float mu = max(dot(N, V), 0.0);

    // Limb darkening (very pronounced on hot compact star)
    float limb = 1.0 - 0.55*(1.0-mu) - 0.20*(1.0-mu)*(1.0-mu);

    // Rapidly flickering hot plasma on surface
    float t  = uTime * uPulseRate * 0.5;
    float p1 = fbm(vPos * 4.0 + vec3(t * 0.22, t * 0.15, 0.0));
    float p2 = fbm(vPos * 9.0 - vec3(0.0, t * 0.18, t * 0.10));

    // Incandescent blue-white core (>1MK surface temperature)
    vec3 col = mix(vec3(0.55, 0.75, 1.00), vec3(1.00, 1.00, 1.00), p1 * 0.6 + p2 * 0.4);
    // Hot-spot magnetic poles glow brighter
    float poleGlow = pow(abs(normalize(vPos).y), 3.0);
    col += vec3(0.70, 0.90, 1.00) * poleGlow * 0.55;
    col *= limb;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const NS_BEAM_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uPulseRate;
  varying vec3  vWorldNormal, vWorldPos;

  void main(){
    vec3 V   = normalize(cameraPosition - vWorldPos);
    vec3 N   = normalize(vWorldNormal);

    // Pulsar rotation: beam sweeps around Y axis at uPulseRate rad/s
    float t      = uTime * uPulseRate;
    // Dual poles: beam1 and beam2 are opposite ends of the rotation axis
    vec3  beam1  = normalize(vec3(sin(t), cos(t * 0.08), cos(t)));
    vec3  beam2  = -beam1;

    // Beam cone half-angle ≈ 8° (cos ≈ 0.990)
    float dot1   = dot(N, beam1);
    float dot2   = dot(N, beam2);
    float cone   = pow(max(0.0, max(dot1, dot2) - 0.90) / 0.10, 2.0);

    // Fresnel rim — very faint, only the sweeping cone should be bright
    float rim    = pow(1.0 - abs(dot(N, V)), 5.0) * 0.04;

    vec3  col    = vec3(0.45, 0.72, 1.00) * (cone * 2.0 + rim);
    float alpha  = rim + cone * 0.80;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export function createNeutronStar(seed) {
  const rng    = new SeededRandom(seed);
  const group  = new THREE.Group();
  group.userData = { type: 'neutron_star' };

  const NS_R       = 1.0 + rng.next() * 0.6;   // visible radius
  const PULSE_RATE = 2.0 + rng.next() * 14.0;  // rotations/s — like real pulsars (0.7-30 Hz)
  const ADD_OPTS   = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  // ── Compact hot surface ────────────────────────────────────────────────────
  const surfMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uPulseRate: { value: PULSE_RATE },
    },
    vertexShader:   STAR_VERT,
    fragmentShader: NS_SURFACE_FRAG,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(NS_R, 48, 24), surfMat));

  // ── Rotating beam volume — tight halo, not a room-filling sphere ──────────
  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uPulseRate: { value: PULSE_RATE },
    },
    vertexShader:   ATM_VERT,
    fragmentShader: NS_BEAM_FRAG,
    ...ADD_OPTS,
    side: THREE.FrontSide,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(NS_R * 9, 32, 16), beamMat));

  // ── Inner magnetosphere glow ───────────────────────────────────────────────
  const magsph = new THREE.Mesh(
    new THREE.SphereGeometry(NS_R * 3.5, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: ATM_VERT,
      fragmentShader: /* glsl */`
        varying vec3 vWorldNormal, vWorldPos;
        void main(){
          vec3 V = normalize(cameraPosition - vWorldPos);
          float rim = pow(1.0 - abs(dot(normalize(vWorldNormal), V)), 2.5);
          gl_FragColor = vec4(0.30, 0.55, 1.00, rim * 0.40);
        }
      `,
      ...ADD_OPTS,
    }),
  );
  group.add(magsph);

  // ── Collimated X-ray jets (relativistic particle outflow) ─────────────────
  const JET_POINTS = 400;
  for (const dir of [+1, -1]) {
    const ps  = new Float32Array(JET_POINTS * 3);
    const al  = new Float32Array(JET_POINTS);
    const sz  = new Float32Array(JET_POINTS);
    for (let i = 0; i < JET_POINTS; i++) {
      const t   = Math.pow(Math.random(), 0.60);
      const sprd = NS_R * 0.5 * (1 - t * 0.80);
      const r   = sprd * Math.random();
      const a   = Math.random() * Math.PI * 2;
      ps[i*3]   = Math.cos(a) * r;
      ps[i*3+1] = dir * (NS_R * 0.8 + t * NS_R * 12);
      ps[i*3+2] = Math.sin(a) * r;
      al[i] = t;
      sz[i] = (1 - t) * 5.0 + 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(ps, 3));
    geo.setAttribute('aAlong',   new THREE.BufferAttribute(al, 1));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sz, 1));
    group.add(new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader:   JET_VERT,
      fragmentShader: /* glsl */`
        varying float vAlong;
        uniform float uTime;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float d = length(c);
          if(d > 0.5) discard;
          float glow  = exp(-d*12.0)*0.95 + exp(-d*5.0)*0.05;
          float fade  = pow(1.0 - vAlong, 1.6);
          float pulse = 0.60 + 0.40*sin(vAlong*16.0 - uTime * PULSE_RATE * 0.8);
          vec3  col   = mix(vec3(0.20, 0.55, 1.00), vec3(1.00, 1.00, 1.00), pow(1.0-vAlong, 0.5));
          gl_FragColor = vec4(col, glow * fade * pulse);
        }
      `.replace('PULSE_RATE', PULSE_RATE.toFixed(2)),
      ...ADD_OPTS,
    })));
  }

  // ── Strong X-ray luminosity light ─────────────────────────────────────────
  group.add(new THREE.PointLight(0x88aaff, 3.5, NS_R * 180, 2.0));

  group.userData.animMats = [surfMat, beamMat];
  return group;
}
