/**
 * Unsupervised Tribute
 * Blobs emerge from center, display art colors, disperse outward
 */

precision highp float;

varying vec2 vUv;
varying vec3 vRayDir;

uniform float uTime;
uniform vec3 uCameraPos;
uniform float uAnimSpeed;
uniform float uColorWarmth;
uniform sampler2D uNoiseTexture;
uniform float uNoiseTextureSize;
uniform float uAtlasSlices;

const int MAX_STEPS = 64;
const float MAX_DIST = 15.0;
const float SURF_DIST = 0.004;
const float PI = 3.14159265;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash31(i);
    float b = hash31(i + vec3(1,0,0));
    float c = hash31(i + vec3(0,1,0));
    float d = hash31(i + vec3(1,1,0));
    float e = hash31(i + vec3(0,0,1));
    float g = hash31(i + vec3(1,0,1));
    float h = hash31(i + vec3(0,1,1));
    float k = hash31(i + vec3(1,1,1));

    return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y),
               mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}

// Sample art from atlas
vec3 sampleArt(vec3 p, float phase) {
    float t = uTime * 0.015 + phase;

    vec3 fp = p + vec3(sin(t * 0.7), cos(t * 0.5), sin(t * 0.6)) * 0.3;
    vec3 np = fract(fp * 0.08 + 0.5);

    float z = np.z * 15.0;
    float zLow = floor(z);
    float zHigh = min(zLow + 1.0, 15.0);

    vec2 sliceUvLow = vec2(mod(zLow, 4.0), floor(zLow / 4.0)) / 4.0;
    vec2 sliceUvHigh = vec2(mod(zHigh, 4.0), floor(zHigh / 4.0)) / 4.0;
    vec2 localUv = np.xy / 4.0;

    vec3 cLow = texture2D(uNoiseTexture, sliceUvLow + localUv).rgb;
    vec3 cHigh = texture2D(uNoiseTexture, sliceUvHigh + localUv).rgb;

    return mix(cLow, cHigh, fract(z));
}

// Smooth min for blob merging
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Single blob SDF
float blob(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

// Scene: multiple blobs emerging from center and dispersing
float map(vec3 p) {
    float t = uTime * uAnimSpeed * 0.12;
    float d = 1000.0;

    // Central core - always present
    float core = length(p) - 0.3 - sin(t * 2.0) * 0.1;
    d = core;

    // Multiple blob waves emanating outward
    for (int wave = 0; wave < 3; wave++) {
        float waveTime = t + float(wave) * 2.5;
        float wavePhase = fract(waveTime * 0.15);

        // Blobs expand outward over time
        float expandRadius = wavePhase * 4.0;
        float blobSize = 0.4 + sin(wavePhase * PI) * 0.3; // Grow then shrink
        float opacity = sin(wavePhase * PI); // Fade in/out

        if (opacity > 0.1) {
            // Multiple blobs per wave, distributed spherically
            for (int i = 0; i < 6; i++) {
                float fi = float(i);
                float angle1 = fi * 1.047 + float(wave) * 0.5 + t * 0.1;
                float angle2 = fi * 0.8 + float(wave) * 0.7 + sin(t * 0.3) * 0.5;

                vec3 dir = vec3(
                    sin(angle1) * cos(angle2),
                    sin(angle2) * 0.7,
                    cos(angle1) * cos(angle2)
                );

                // Add organic wobble
                dir += vec3(
                    sin(t * 0.5 + fi) * 0.2,
                    cos(t * 0.4 + fi * 1.3) * 0.15,
                    sin(t * 0.6 + fi * 0.7) * 0.2
                );
                dir = normalize(dir);

                vec3 blobPos = dir * expandRadius;

                // Add noise displacement
                float noiseDisp = noise(blobPos * 2.0 + t) * 0.3;
                blobPos += dir * noiseDisp;

                float b = blob(p, blobPos, blobSize * opacity);
                d = smin(d, b, 0.4);
            }
        }
    }

    // Add surface detail
    float detail = noise(p * 3.0 + t * 0.5) * 0.08;
    d += detail;

    return d;
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.005, 0.0);
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
    float minDist = 1000.0;

    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * totalDist;
        float d = map(p);

        minDist = min(minDist, d);

        if (d < SURF_DIST || totalDist > MAX_DIST) break;
        totalDist += d * 0.8;
    }

    vec3 col = vec3(0.0);
    float t = uTime * uAnimSpeed * 0.12;

    if (totalDist < MAX_DIST) {
        vec3 p = ro + rd * totalDist;
        vec3 n = calcNormal(p);
        vec3 v = -rd;

        float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.5);

        // Sample art colors - multiple layers
        vec3 art1 = sampleArt(p * 1.5, 0.0);
        vec3 art2 = sampleArt(p * 1.2 + n, 1.0);
        vec3 art3 = sampleArt(p * 0.8 + 3.0, 2.0);

        // Blend based on position from center (inner = one color, outer = another)
        float distFromCenter = length(p);
        float radialBlend = smoothstep(0.0, 3.0, distFromCenter);

        vec3 artColor = mix(art1, art2, radialBlend);
        artColor = mix(artColor, art3, fresnel * 0.5);

        // Boost saturation
        float lum = dot(artColor, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(lum), artColor, 1.6);
        col = clamp(col, 0.0, 1.0);

        // Lighting
        vec3 lightDir = normalize(vec3(0.3, 1.0, 0.5));
        float diff = max(dot(n, lightDir), 0.0);
        float ambient = 0.3;
        col *= ambient + diff * 0.7;

        // Rim glow - uses art color
        col += artColor * fresnel * 0.5;

        // Subsurface scattering look
        float sss = pow(max(dot(rd, lightDir), 0.0), 2.0);
        col += artColor * sss * 0.2;

        // Distance fade (closer to center = brighter)
        float depthFade = exp(-distFromCenter * 0.15);
        col *= 0.7 + depthFade * 0.3;

    } else {
        // Background glow from nearby blobs
        float glow = exp(-minDist * 3.0);
        vec3 bgArt = sampleArt(rd * 2.0, t * 0.1);
        col = bgArt * glow * 0.15;
    }

    // Tone mapping
    col = col / (col + vec3(0.6));
    col = pow(col, vec3(0.9));

    // Subtle warmth
    col = mix(col, col * vec3(1.05, 1.0, 0.95), uColorWarmth * 0.2);

    gl_FragColor = vec4(col, 1.0);
}
