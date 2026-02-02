/**
 * WeatherService fetches real-time weather data from Open-Meteo API
 * and provides it to the particle physics system.
 *
 * Open-Meteo is a free, open-source weather API that requires no API key.
 * https://open-meteo.com/
 */
export class WeatherService {
  constructor(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
    this.updateInterval = null;
    this.lastWeatherData = null;
  }

  /**
   * Fetch current weather conditions
   *
   * @returns {Promise<Object>} Weather data with temperature, humidity, windSpeed, windDirection
   */
  async getCurrentWeather() {
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.append("latitude", this.latitude);
      url.searchParams.append("longitude", this.longitude);
      url.searchParams.append("current", [
        "temperature_2m",
        "relative_humidity_2m",
        "wind_speed_10m",
        "wind_direction_10m",
      ].join(","));

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Weather API returned ${response.status}`);
      }

      const data = await response.json();

      if (!data.current) {
        throw new Error("Invalid weather data format");
      }

      const weatherData = {
        temperature: data.current.temperature_2m || 20.0,
        humidity: data.current.relative_humidity_2m || 50.0,
        windSpeed: data.current.wind_speed_10m || 5.0,
        windDirection: data.current.wind_direction_10m || 0.0,
      };

      this.lastWeatherData = weatherData;
      console.log("Weather updated:", weatherData);

      return weatherData;
    } catch (error) {
      console.warn("Weather fetch failed, using defaults:", error);

      // Return default weather conditions on error
      const defaultWeather = {
        temperature: 20.0,
        humidity: 50.0,
        windSpeed: 5.0,
        windDirection: 0.0,
      };

      this.lastWeatherData = defaultWeather;
      return defaultWeather;
    }
  }

  /**
   * Start periodic weather updates
   *
   * @param {Function} callback - Called with weather data on each update
   * @param {number} intervalMinutes - Update interval in minutes (default: 15)
   * @returns {number} Interval ID for cleanup
   */
  startPeriodicUpdates(callback, intervalMinutes = 15) {
    // Fetch immediately
    this.getCurrentWeather().then(callback);

    // Then periodically
    const intervalMs = intervalMinutes * 60 * 1000;
    this.updateInterval = setInterval(() => {
      this.getCurrentWeather().then(callback);
    }, intervalMs);

    return this.updateInterval;
  }

  /**
   * Stop periodic updates
   */
  stopPeriodicUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Get last fetched weather data (cached)
   *
   * @returns {Object|null} Last weather data or null if never fetched
   */
  getLastWeather() {
    return this.lastWeatherData;
  }
}

/**
 * Detect user's geographic location
 *
 * @returns {Promise<{latitude: number, longitude: number}>}
 */
export async function detectUserLocation() {
  return new Promise((resolve) => {
    // Default to New York City
    const defaultLocation = {
      latitude: 40.7128,
      longitude: -74.0060,
    };

    if (!navigator.geolocation) {
      console.warn("Geolocation not supported, using default location");
      resolve(defaultLocation);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        console.warn("Geolocation permission denied or failed, using default location:", error);
        resolve(defaultLocation);
      },
      {
        timeout: 5000,
        maximumAge: 300000, // Cache location for 5 minutes
      }
    );
  });
}
