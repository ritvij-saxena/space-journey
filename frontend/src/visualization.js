import * as THREE from "three";

export class VisualizationEngine {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.particles = [];
    this.particleGeometry = null;
    this.particleMaterial = null;
    this.particleSystem = null;
  }

  init() {
    this.createParticleSystem();
  }

  createParticleSystem() {
    const particleCount = 5000;
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 20; // x
      positions[i + 1] = (Math.random() - 0.5) * 20; // y
      positions[i + 2] = (Math.random() - 0.5) * 20; // z

      colors[i] = Math.random() * 0.5 + 0.5; // r
      colors[i + 1] = Math.random() * 0.5 + 0.5; // g
      colors[i + 2] = Math.random() * 0.5 + 0.5; // b

      sizes[i / 3] = Math.random() * 2 + 1;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.1,
      sizeAttenuation: true,
      transparent: true,
      vertexColors: true,
      opacity: 0.8,
    });

    this.particleSystem = new THREE.Points(geometry, material);
    this.scene.add(this.particleSystem);

    this.particleGeometry = geometry;
    this.particleMaterial = material;
  }

  update(time, weatherData) {
    if (!this.particleSystem) return;

    const positions = this.particleGeometry.attributes.position.array;
    const colors = this.particleGeometry.attributes.color.array;

    // Get visual parameters from weather
    const visuals = this.getVisualParameters(weatherData);

    for (let i = 0; i < positions.length; i += 3) {
      // Animate positions based on time and weather
      const index = i / 3;
      const speed = visuals.speed;

      positions[i] += Math.sin(time * speed + index) * 0.02;
      positions[i + 1] += Math.cos(time * speed * 0.7 + index) * 0.02;
      positions[i + 2] += Math.sin(time * speed * 0.5 + index) * 0.01;

      // Keep particles within bounds
      if (Math.abs(positions[i]) > 10) positions[i] *= -0.9;
      if (Math.abs(positions[i + 1]) > 10) positions[i + 1] *= -0.9;
      if (Math.abs(positions[i + 2]) > 10) positions[i + 2] *= -0.9;

      // Update colors based on weather
      const hueShift = visuals.hue;
      colors[i] = (Math.sin(time * 0.5 + hueShift) + 1) / 2; // r
      colors[i + 1] = (Math.cos(time * 0.3 + hueShift) + 1) / 2; // g
      colors[i + 2] = (Math.sin(time * 0.7 + hueShift + Math.PI / 2) + 1) / 2; // b
    }

    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;

    // Rotate scene slightly
    this.particleSystem.rotation.x += 0.0001;
    this.particleSystem.rotation.y += 0.0002;

    // Update material opacity based on humidity
    this.particleMaterial.opacity = visuals.density;
  }

  getVisualParameters(weatherData) {
    const { temperature, humidity, windSpeed } = weatherData;

    return {
      hue: ((temperature || 20) / 40) * 2, // Color hue
      density: ((humidity || 50) / 100) * 0.6 + 0.4, // Opacity
      speed: ((windSpeed || 5) / 20) * 1.5 + 0.5, // Animation speed
      intensity:
        ((temperature || 20) + (humidity || 50) + (windSpeed || 5) * 2) / 120,
    };
  }
}
