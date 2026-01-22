/**
 * Environmental Manager
 *
 * Generates randomized "external factors" without requiring any API keys.
 * Uses:
 * - Time-based patterns (hour, day, season)
 * - Device sensors (motion, orientation - if available)
 * - Deterministic randomization (seeded by user session)
 * - Browser capabilities (screen properties)
 */
export class WeatherManager {
  constructor() {
    this.sessionSeed = Date.now() + Math.random() * 1000000;
    this.weatherData = {
      temperature: 20,
      humidity: 50,
      windSpeed: 5,
      description: "generative conditions",
    };
    this.updateInterval = 5000; // Update every 5 seconds for more dynamic variation
    this.motionData = { x: 0, y: 0, z: 0 }; // Device motion
  }

  async init() {
    this.setupDeviceMotion();
    this.updateEnvironmentalFactors();
    // Update environmental factors every 5 seconds
    setInterval(() => this.updateEnvironmentalFactors(), this.updateInterval);
  }

  /**
   * Listen to device motion/orientation if available
   * (creates random variation from user's device movement)
   */
  setupDeviceMotion() {
    if (window.DeviceMotionEvent) {
      window.addEventListener("devicemotion", (event) => {
        this.motionData = {
          x: event.acceleration?.x || 0,
          y: event.acceleration?.y || 0,
          z: event.acceleration?.z || 0,
        };
      });
    }

    if (window.DeviceOrientationEvent) {
      window.addEventListener("deviceorientation", (event) => {
        this.motionData = {
          x: event.alpha || 0,
          y: event.beta || 0,
          z: event.gamma || 0,
        };
      });
    }
  }

  /**
   * Generate environmental factors based on:
   * - Current time (hour, minute, second, day, season)
   * - Device motion/orientation
   * - Deterministic randomization
   * - Screen properties
   */
  updateEnvironmentalFactors() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();
    const dayOfYear = this.getDayOfYear(now);

    // Time-based seed for this update
    const timeSeed =
      hour * 3600 + minute * 60 + second + this.sessionSeed * 0.001;

    // Pseudo-random using sine (deterministic but appears random)
    const pseudoRandom = (seed) =>
      Math.abs(Math.sin(seed * 12.9898) * Math.sin(seed * 78.233)) % 1;

    // Base from time patterns
    const hourFraction = hour / 24;
    const minuteFraction = minute / 60;
    const dayFraction = dayOfYear / 365;

    // Device motion contribution (if available)
    const motionInfluence =
      (Math.abs(this.motionData.x) +
        Math.abs(this.motionData.y) +
        Math.abs(this.motionData.z)) /
      30; // Normalize motion

    // Screen properties (deterministic per device)
    const screenSeed =
      (window.innerWidth + window.innerHeight + window.devicePixelRatio) / 1000;

    // Temperature: cycles through day + randomization
    // Morning (6-12): Cool → Warm
    // Afternoon (12-18): Warm → Cool
    // Night (18-6): Cold → Cooler
    const baseTempCycle = Math.sin((hourFraction - 0.25) * Math.PI * 2) * 15;
    const seasonalTemp = Math.sin(dayFraction * Math.PI * 2) * 10;
    const randomTemp =
      (pseudoRandom(timeSeed + screenSeed) - 0.5) * 20 + motionInfluence * 5;
    this.weatherData.temperature =
      20 + baseTempCycle + seasonalTemp + randomTemp;

    // Humidity: cycles with minute + randomization
    // Creates wave-like patterns
    const baseHumidity =
      (Math.sin(minuteFraction * Math.PI * 2) * 0.3 + 0.5) * 100;
    const randomHumidity = pseudoRandom(timeSeed * 1.5 + screenSeed) * 40 - 20;
    this.weatherData.humidity = Math.max(
      10,
      Math.min(100, baseHumidity + randomHumidity + motionInfluence * 10),
    );

    // Wind Speed: combines day-time cycle + motion influence
    // Peaks mid-day, calm at night
    const baseWind =
      (Math.sin((hourFraction - 0.25) * Math.PI) * 0.5 + 0.5) * 15;
    const randomWind =
      pseudoRandom(timeSeed * 2 + screenSeed) * 10 - 5 + motionInfluence * 8;
    this.weatherData.windSpeed = Math.max(0, baseWind + randomWind);

    // Weather condition based on multiple factors
    this.weatherData.description = this.getConditionDescription(
      this.weatherData.temperature,
      this.weatherData.humidity,
      this.weatherData.windSpeed,
    );

    this.updateUI();
  }

  /**
   * Get day of year (0-365)
   */
  getDayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
  }

  /**
   * Generate poetic condition descriptions based on values
   */
  getConditionDescription(temp, humidity, windSpeed) {
    const conditions = [];

    if (temp > 30) conditions.push("scorching");
    else if (temp > 20) conditions.push("warm");
    else if (temp > 10) conditions.push("cool");
    else conditions.push("cold");

    if (humidity > 70) conditions.push("humid");
    else if (humidity > 40) conditions.push("balanced");
    else conditions.push("dry");

    if (windSpeed > 15) conditions.push("turbulent");
    else if (windSpeed > 7) conditions.push("flowing");
    else conditions.push("calm");

    return conditions.join(", ");
  }

  updateUI() {
    const tempEl = document.getElementById("temp");
    const humidityEl = document.getElementById("humidity");
    const windEl = document.getElementById("wind");

    if (tempEl) tempEl.textContent = this.weatherData.temperature.toFixed(1);
    if (humidityEl)
      humidityEl.textContent = this.weatherData.humidity.toFixed(0);
    if (windEl) windEl.textContent = this.weatherData.windSpeed.toFixed(1);
  }

  getCurrentWeather() {
    return this.weatherData;
  }

  // Map weather to visual parameters
  getVisualParameters() {
    const { temperature, humidity, windSpeed } = this.weatherData;

    return {
      // Temperature (0-40°C) → Color hue
      hue: ((temperature + 10) / 50) * 0.5, // Maps to 0-180 degrees in HSL

      // Humidity → Particle density
      density: (humidity / 100) * 0.6 + 0.4, // Opacity

      // Wind speed → Animation speed
      speed: (windSpeed / 25) * 1.5 + 0.5, // Animation speed

      // Overall intensity
      intensity: (temperature + humidity + windSpeed * 2) / 120,
    };
  }
}
