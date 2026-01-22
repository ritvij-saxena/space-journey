/**
 * Raymarcher Vertex Shader
 * Simple fullscreen quad for raymarching
 */

varying vec2 vUv;
varying vec3 vRayDir;

uniform float uAspect;
uniform float uFov;
uniform vec3 uCameraPos;
uniform mat4 uCameraMatrix;

void main() {
    vUv = uv;

    // Calculate ray direction for this pixel
    vec2 screenPos = (uv * 2.0 - 1.0);
    screenPos.x *= uAspect;

    // Field of view scaling
    float fovScale = tan(uFov * 0.5);

    // Ray direction in camera space
    vec3 rayDir = normalize(vec3(screenPos * fovScale, -1.0));

    // Transform to world space
    vRayDir = (uCameraMatrix * vec4(rayDir, 0.0)).xyz;

    gl_Position = vec4(position, 1.0);
}
