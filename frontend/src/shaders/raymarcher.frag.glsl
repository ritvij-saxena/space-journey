/**
 * Unsupervised Tribute
 * Fluid data sculpture showing art colors flowing and morphing
 */

precision highp float;

varying vec2 vUv;
varying vec3 vRayDir;

uniform float uTime;
uniform vec3 uCameraPos;
uniform float uAnimSpeed;
uniform float uColorWarmth;
uniform sampler2D uNoiseTexture;

const int MAX_STEPS = 50;
const float MAX_DIST = 12.0;
const float SURF_DIST = 0.004;
const float PI = 3.14159265;

// Simple hash
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Smooth 3D noise
float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    vec2 uv = i.xy + vec2(37.0, 239.0) * i.z;
    float a = hash(uv);
    float b = hash(uv + vec2(1.0, 0.0));
    float c = hash(uv + vec2(0.0, 1.0));
    float d = hash(uv + vec2(1.0, 1.0));
    float ab = mix(a, b, f.x);
    float cd = mix(c, d, f.x);
    float abcd = mix(ab, cd, f.y);

    uv += vec2(37.0, 239.0);
    float e = hash(uv);
    float g = hash(uv + vec2(1.0, 0.0));
    float h = hash(uv + vec2(0.0, 1.0));
    float j = hash(uv + vec2(1.0, 1.0));
    float eg = mix(e, g, f.x);
    float hj = mix(h, j, f.x);
    float eghj = mix(eg, hj, f.y);

    return mix(abcd, eghj, f.z);
}

// Sample art texture - optimized for showing actual art
vec3 sampleArt(vec3 p, float timeOffset) {
    float t = uTime * 0.02 + timeOffset;

    // Smooth flowing UV animation
    vec2 flowUV = vec2(
        sin(t * 0.3 + p.z * 0.5) * 0.1,
        cos(t * 0.25 + p.x * 0.5) * 0.1
    );

    // Map 3D position to 2D UV for the atlas
    vec2 baseUV = p.xy * 0.15 + 0.5 + flowUV;
    baseUV = fract(baseUV); // Wrap to 0-1

    // Select slice based on z and time (creates depth morphing)
    float sliceFloat = fract(p.z * 0.1 + t * 0.05) * 15.99;
    float slice1 = floor(sliceFloat);
    float slice2 = mod(slice1 + 1.0, 16.0);
    float sliceMix = fract(sliceFloat);

    // Convert slice index to atlas UV (4x4 grid)
    vec2 atlas1 = vec2(mod(slice1, 4.0), floor(slice1 / 4.0)) / 4.0;
    vec2 atlas2 = vec2(mod(slice2, 4.0), floor(slice2 / 4.0)) / 4.0;

    // Sample from atlas with proper UV scaling
    vec2 localUV = baseUV / 4.0;
    vec3 col1 = texture2D(uNoiseTexture, atlas1 + localUV).rgb;
    vec3 col2 = texture2D(uNoiseTexture, atlas2 + localUV).rgb;

    // Smooth blend between slices
    return mix(col1, col2, smoothstep(0.0, 1.0, sliceMix));
}

// Fluid SDF - organic morphing blob
float fluidSDF(vec3 p, float t) {
    // Gentle breathing
    float breathe = sin(t * 0.15) * 0.1 + sin(t * 0.1) * 0.06;
    float baseRadius = 1.5 + breathe;

    // Flowing displacement for organic movement
    vec3 flow = vec3(
        sin(p.y * 0.6 + t * 0.2) * cos(p.z * 0.5 + t * 0.15),
        cos(p.x * 0.5 + t * 0.18) * sin(p.z * 0.4 + t * 0.12),
        sin(p.x * 0.4 + t * 0.22) * cos(p.y * 0.5 + t * 0.14)
    ) * 0.3;

    vec3 q = p + flow;
    float dist = length(q);

    // Layered noise for organic surface
    float n1 = noise(p * 0.6 + t * 0.04) * 0.5;
    float n2 = noise(p * 1.2 + t * 0.06) * 0.25;
    float surface = n1 + n2;

    // Soft tendrils
    float angle = atan(p.y, p.x);
    float tendril = sin(angle * 3.0 + t * 0.2) * 0.12;
    tendril *= smoothstep(1.0, 2.0, dist);

    return dist - baseRadius - surface - tendril;
}

float map(vec3 p) {
    float t = uTime * uAnimSpeed * 0.35;
    return fluidSDF(p, t);
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.008, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

void main() {
    vec3 ro = uCameraPos;
    vec3 rd = normalize(vRayDir);

    float totalDist = 0.0;
    float minDist = 100.0;
    vec3 closestPoint = ro;

    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * totalDist;
        float d = map(p);

        if (d < minDist) {
            minDist = d;
            closestPoint = p;
        }

        if (d < SURF_DIST || totalDist > MAX_DIST) break;
        totalDist += d * 0.7;
    }

    vec3 col = vec3(0.0);
    float t = uTime * uAnimSpeed * 0.35;

    if (totalDist < MAX_DIST) {
        vec3 p = ro + rd * totalDist;
        vec3 n = calcNormal(p);
        vec3 v = -rd;

        // Fresnel for glowing edges
        float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);

        // Sample art at different scales for rich color mixing
        vec3 art1 = sampleArt(p, 0.0);
        vec3 art2 = sampleArt(p * 0.8 + n * 0.3, 2.0);
        vec3 art3 = sampleArt(p * 1.2 - n * 0.2, 4.0);

        // Dynamic color mixing based on surface properties
        float colorMix = noise(p * 0.3 + t * 0.02);
        vec3 artColor = mix(art1, art2, colorMix);
        artColor = mix(artColor, art3, fresnel * 0.4);

        // Vibrant saturation boost
        float lum = dot(artColor, vec3(0.299, 0.587, 0.114));
        artColor = mix(vec3(lum), artColor, 1.6);

        // Soft multi-directional lighting
        vec3 light1 = normalize(vec3(0.5, 0.7, 0.4));
        vec3 light2 = normalize(vec3(-0.3, 0.4, -0.5));

        float diff1 = max(dot(n, light1), 0.0);
        float diff2 = max(dot(n, light2), 0.0) * 0.4;
        float ambient = 0.25;

        col = artColor * (ambient + diff1 * 0.5 + diff2 * 0.25);

        // Subsurface scattering - makes it glow
        float sss = pow(max(dot(v, light1), 0.0), 2.0);
        col += artColor * sss * 0.35;

        // Rim glow with art colors
        col += artColor * fresnel * 0.6;

        // Soft specular
        vec3 h = normalize(light1 + v);
        float spec = pow(max(dot(n, h), 0.0), 20.0);
        col += vec3(1.0, 0.98, 0.95) * spec * 0.12;

    } else {
        // Background: soft glow
        float glow = exp(-minDist * 1.5);
        vec3 bgArt = sampleArt(closestPoint * 0.5, t * 0.01);
        col = bgArt * glow * 0.3;
        col += vec3(0.005, 0.003, 0.008);
    }

    // Tone mapping
    col = col / (col + vec3(0.5));
    col = pow(col, vec3(0.95));

    // Warmth adjustment
    col = mix(col, col * vec3(1.03, 1.0, 0.97), uColorWarmth * 0.2);

    // Vignette
    float vig = 1.0 - dot(vUv - 0.5, vUv - 0.5) * 0.4;
    col *= vig;

    gl_FragColor = vec4(col, 1.0);
}
