/**
 * Unsupervised Tribute - Minimal Raymarcher
 */

precision highp float;

varying vec2 vUv;
varying vec3 vRayDir;

uniform float uTime;
uniform vec3 uCameraPos;
uniform float uAnimSpeed;
uniform float uColorWarmth;

const int MAX_STEPS = 50;
const float MAX_DIST = 20.0;
const float SURF_DIST = 0.01;

// Simple hash
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Simple 3D noise
float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
        f.z
    );
}

// FBM
float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.0;
        a *= 0.5;
    }
    return v;
}

// Scene SDF - flowing noise blobs
float map(vec3 p) {
    // Slow animation
    float t = uTime * uAnimSpeed * 0.1;

    // Domain warping for organic flow
    vec3 q = p;
    q += 0.5 * vec3(
        fbm(p + vec3(0.0, 0.0, t)),
        fbm(p + vec3(5.2, 1.3, t * 0.8)),
        fbm(p + vec3(2.1, 3.1, t * 0.6))
    );

    // Noise field
    float n = fbm(q * 0.8);

    // Create surface where noise crosses threshold
    float d = n - 0.45;

    // Keep it bounded but not spherical
    float bounds = length(p) - 4.0;
    d = max(d, bounds);

    return d;
}

// Normal calculation
vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.01, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

void main() {
    vec3 ro = uCameraPos;
    vec3 rd = normalize(vRayDir);

    // Raymarch
    float t = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * t;
        float d = map(p);

        if (d < SURF_DIST) break;
        if (t > MAX_DIST) break;

        t += d;
    }

    vec3 col;

    if (t < MAX_DIST) {
        // Hit surface
        vec3 p = ro + rd * t;
        vec3 n = calcNormal(p);
        vec3 v = -rd;

        // Fresnel
        float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);

        // Base colors - deep blues and purples
        vec3 col1 = vec3(0.05, 0.02, 0.15);  // Deep purple
        vec3 col2 = vec3(0.15, 0.05, 0.25);  // Purple
        vec3 col3 = vec3(0.3, 0.1, 0.3);     // Bright purple/pink

        // Warm shift
        col1 = mix(col1, vec3(0.1, 0.02, 0.05), uColorWarmth);
        col2 = mix(col2, vec3(0.25, 0.05, 0.1), uColorWarmth);
        col3 = mix(col3, vec3(0.4, 0.15, 0.1), uColorWarmth);

        // Mix based on fresnel
        col = mix(col1, col2, fresnel);
        col = mix(col, col3, fresnel * fresnel);

        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diff = max(dot(n, lightDir), 0.0);
        col *= 0.3 + diff * 0.7;

        // Rim glow
        col += vec3(0.1, 0.05, 0.15) * fresnel;

        // Depth fade
        float fog = 1.0 - exp(-t * 0.1);
        col = mix(col, vec3(0.01, 0.005, 0.02), fog);

    } else {
        // Background
        col = vec3(0.01, 0.005, 0.02);
    }

    // Gamma
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
