/// Real-world weather data from external API
#[derive(Debug, Clone, Copy)]
pub struct WeatherData {
    pub temperature: f32,    // Celsius
    pub humidity: f32,       // 0-100 percentage
    pub wind_speed: f32,     // km/h
    pub wind_direction: f32, // degrees 0-360
}

impl WeatherData {
    /// Default weather conditions for fallback
    pub fn default() -> Self {
        WeatherData {
            temperature: 20.0,
            humidity: 50.0,
            wind_speed: 5.0,
            wind_direction: 0.0,
        }
    }
}

/// Physics parameters influenced by weather
#[derive(Debug, Clone, Copy)]
pub struct WeatherInfluence {
    pub curl_strength: f32,        // Affects particle flow intensity
    pub spring_stiffness: f32,     // Affects formation stability
    pub damping: f32,              // Affects particle momentum retention
    pub turbulence_frequency: f32, // Affects noise sampling rate
    pub wind_force: [f32; 3],      // Directional force vector
}

/// Maps weather data to physics parameters
pub struct WeatherMapper {
    // Could hold configuration or calibration data in the future
}

impl WeatherMapper {
    /// Create a new weather mapper
    pub fn new() -> Self {
        WeatherMapper {}
    }

    /// Convert weather data into physics influence parameters
    ///
    /// Temperature mapping (-20°C to 45°C):
    /// - Higher temp = faster, more energetic motion
    /// - Affects curl strength and turbulence frequency
    ///
    /// Wind mapping (0 to 30 km/h):
    /// - Higher wind = more drift, less stability
    /// - Converts direction to 3D force vector
    /// - Reduces spring stiffness (harder to hold formation)
    ///
    /// Humidity mapping (0% to 100%):
    /// - Higher humidity = more damping (particles slow down faster)
    /// - Simulates "heavier air" feeling
    pub fn map_to_physics(&self, weather: &WeatherData) -> WeatherInfluence {
        // Normalize temperature: -20°C to 45°C -> 0.0 to 1.0
        let temp_norm = ((weather.temperature.clamp(-20.0, 45.0) + 20.0) / 65.0)
            .clamp(0.0, 1.0);

        // Normalize humidity: 0% to 100% -> 0.0 to 1.0
        let humidity_norm = (weather.humidity.clamp(0.0, 100.0) / 100.0)
            .clamp(0.0, 1.0);

        // Normalize wind speed: 0 to 30 km/h -> 0.0 to 1.0
        let wind_norm = (weather.wind_speed.clamp(0.0, 30.0) / 30.0)
            .clamp(0.0, 1.0);

        // Temperature affects speed and turbulence
        // Warmer = more energetic motion, but keep it gentle for meditative feel
        let curl_strength = 0.6 + temp_norm * 0.6; // Range: 0.6 to 1.2 (gentle swirling)
        let turbulence_frequency = 0.3 + temp_norm * 0.3; // Range: 0.3 to 0.6 (larger, slower swirls)

        // Wind affects drift and stability
        // Convert wind direction to unit vector in XZ plane (Y is up)
        let wind_rad = weather.wind_direction.to_radians();
        let wind_x = wind_rad.cos();
        let wind_z = wind_rad.sin();

        // Scale by wind strength (max force = 0.15)
        let wind_force_magnitude = wind_norm * 0.15;
        let wind_force = [
            wind_x * wind_force_magnitude,
            0.0, // No vertical wind force
            wind_z * wind_force_magnitude,
        ];

        // Very soft springs — particles drift gently toward targets, never snap
        let spring_stiffness = 0.05 + wind_norm * 0.03; // Range: 0.05 to 0.08 (liquid drift)

        // Very low damping for fluid, flowing motion with more momentum
        let damping = 0.008 + humidity_norm * 0.015; // Range: 0.008 to 0.023

        WeatherInfluence {
            curl_strength,
            spring_stiffness,
            damping,
            turbulence_frequency,
            wind_force,
        }
    }

    /// Get default weather influence for testing/fallback
    pub fn default_influence(&self) -> WeatherInfluence {
        self.map_to_physics(&WeatherData::default())
    }
}

impl Default for WeatherMapper {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_weather() {
        let weather = WeatherData::default();
        assert_eq!(weather.temperature, 20.0);
        assert_eq!(weather.humidity, 50.0);
        assert_eq!(weather.wind_speed, 5.0);
        assert_eq!(weather.wind_direction, 0.0);
    }

    #[test]
    fn test_weather_mapper_default() {
        let mapper = WeatherMapper::new();
        let influence = mapper.default_influence();

        // Check reasonable ranges
        assert!(influence.curl_strength > 0.0);
        assert!(influence.spring_stiffness > 0.0);
        assert!(influence.damping > 0.0);
        assert!(influence.turbulence_frequency > 0.0);
    }

    #[test]
    fn test_temperature_mapping() {
        let mapper = WeatherMapper::new();

        // Cold weather
        let cold = WeatherData {
            temperature: -20.0,
            humidity: 50.0,
            wind_speed: 5.0,
            wind_direction: 0.0,
        };
        let cold_influence = mapper.map_to_physics(&cold);
        assert!((cold_influence.curl_strength - 0.6).abs() < 0.01);

        // Hot weather
        let hot = WeatherData {
            temperature: 45.0,
            humidity: 50.0,
            wind_speed: 5.0,
            wind_direction: 0.0,
        };
        let hot_influence = mapper.map_to_physics(&hot);
        assert!((hot_influence.curl_strength - 1.2).abs() < 0.01);
    }

    #[test]
    fn test_wind_mapping() {
        let mapper = WeatherMapper::new();

        // No wind
        let calm = WeatherData {
            temperature: 20.0,
            humidity: 50.0,
            wind_speed: 0.0,
            wind_direction: 0.0,
        };
        let calm_influence = mapper.map_to_physics(&calm);
        assert!((calm_influence.spring_stiffness - 0.05).abs() < 0.01);
        assert!((calm_influence.wind_force[0]).abs() < 0.01);

        // Strong wind from north (0 degrees)
        let windy = WeatherData {
            temperature: 20.0,
            humidity: 50.0,
            wind_speed: 30.0,
            wind_direction: 0.0,
        };
        let windy_influence = mapper.map_to_physics(&windy);
        assert!((windy_influence.spring_stiffness - 0.08).abs() < 0.01);
        assert!(windy_influence.wind_force[0].abs() > 0.0);

        // Wind from east (90 degrees)
        let east_wind = WeatherData {
            temperature: 20.0,
            humidity: 50.0,
            wind_speed: 15.0,
            wind_direction: 90.0,
        };
        let east_influence = mapper.map_to_physics(&east_wind);
        assert!(east_influence.wind_force[2].abs() > 0.0);
    }

    #[test]
    fn test_humidity_mapping() {
        let mapper = WeatherMapper::new();

        // Dry air
        let dry = WeatherData {
            temperature: 20.0,
            humidity: 0.0,
            wind_speed: 5.0,
            wind_direction: 0.0,
        };
        let dry_influence = mapper.map_to_physics(&dry);
        assert!((dry_influence.damping - 0.008).abs() < 0.002);

        // Very humid
        let humid = WeatherData {
            temperature: 20.0,
            humidity: 100.0,
            wind_speed: 5.0,
            wind_direction: 0.0,
        };
        let humid_influence = mapper.map_to_physics(&humid);
        assert!((humid_influence.damping - 0.023).abs() < 0.002);
    }

    #[test]
    fn test_value_clamping() {
        let mapper = WeatherMapper::new();

        // Extreme values should be clamped
        let extreme = WeatherData {
            temperature: 100.0, // Way too hot
            humidity: 200.0,    // Invalid humidity
            wind_speed: 500.0,  // Hurricane force
            wind_direction: 720.0, // Multiple rotations
        };

        let influence = mapper.map_to_physics(&extreme);

        // Should not panic and should produce reasonable values
        assert!(influence.curl_strength >= 0.6 && influence.curl_strength <= 1.2);
        assert!(influence.spring_stiffness >= 0.05 && influence.spring_stiffness <= 0.08);
        assert!(influence.damping >= 0.008 && influence.damping <= 0.023);
        assert!(influence.wind_force[0].abs() <= 0.2);
        assert!(influence.wind_force[2].abs() <= 0.2);
    }
}
