/**
 * Chromatic Aberration Shader
 *
 * Creates a dreamy RGB split effect, stronger toward edges
 */

export const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.003 },
    uRadialFalloff: { value: 2.0 },
  },

  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uRadialFalloff;

    varying vec2 vUv;

    void main() {
      vec2 center = vec2(0.5);
      vec2 dir = vUv - center;
      float dist = length(dir);

      // Radial falloff - stronger at edges
      float strength = pow(dist, uRadialFalloff) * uIntensity;

      // Direction from center for radial aberration
      vec2 offset = normalize(dir) * strength;

      // Sample each color channel with offset
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;

      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};
