use wasm_bindgen::prelude::*;
use web_sys::console;

/// Binary format header for art_states.bin
#[derive(Debug, Clone)]
struct ArtDataHeader {
    version: i32,
    num_states: i32,
    points_per_state: i32,
    colors_per_state: i32,
}

impl ArtDataHeader {
    /// Parse header from first 16 bytes of binary data
    fn from_bytes(data: &[u8]) -> Result<Self, JsValue> {
        if data.len() < 16 {
            return Err(JsValue::from_str("Insufficient data for header (expected 16 bytes)"));
        }

        let version = i32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        let num_states = i32::from_le_bytes([data[4], data[5], data[6], data[7]]);
        let points_per_state = i32::from_le_bytes([data[8], data[9], data[10], data[11]]);
        let colors_per_state = i32::from_le_bytes([data[12], data[13], data[14], data[15]]);

        // Validate header values
        if num_states <= 0 || points_per_state <= 0 || colors_per_state <= 0 {
            return Err(JsValue::from_str(&format!(
                "Invalid header: num_states={}, points_per_state={}, colors_per_state={}",
                num_states, points_per_state, colors_per_state
            )));
        }

        Ok(ArtDataHeader {
            version,
            num_states,
            points_per_state,
            colors_per_state,
        })
    }
}

/// Single art state containing positions and colors
#[wasm_bindgen]
#[derive(Clone)]
pub struct ArtState {
    positions: Vec<f32>,
    colors: Vec<f32>,
}

#[wasm_bindgen]
impl ArtState {
    /// Get positions as Float32Array accessible from JavaScript
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Box<[f32]> {
        self.positions.clone().into_boxed_slice()
    }

    /// Get colors as Float32Array accessible from JavaScript
    #[wasm_bindgen(getter)]
    pub fn colors(&self) -> Box<[f32]> {
        self.colors.clone().into_boxed_slice()
    }

    /// Number of points in this state
    pub fn num_points(&self) -> usize {
        self.positions.len() / 3
    }
}

/// Main container for all art states parsed from binary data
#[wasm_bindgen]
pub struct ArtData {
    states: Vec<ArtState>,
    header: ArtDataHeader,
}

#[wasm_bindgen]
impl ArtData {
    /// Parse art data from binary format
    ///
    /// Binary format:
    /// - Header (16 bytes): [version: i32][num_states: i32][points_per_state: i32][colors_per_state: i32]
    /// - Positions: f32 * (num_states * points_per_state * 3)
    /// - Colors: f32 * (num_states * colors_per_state * 3)
    ///
    /// All integers and floats are little-endian (WebAssembly native format)
    pub fn from_bytes(data: &[u8]) -> Result<ArtData, JsValue> {
        if data.is_empty() {
            return Err(JsValue::from_str("Cannot parse empty data"));
        }

        // Parse header
        let header = ArtDataHeader::from_bytes(data)?;

        console::log_1(&format!(
            "Parsing art data: version={}, num_states={}, points_per_state={}, colors_per_state={}",
            header.version, header.num_states, header.points_per_state, header.colors_per_state
        ).into());

        // Calculate expected data sizes
        let num_states = header.num_states as usize;
        let points_per_state = header.points_per_state as usize;
        let colors_per_state = header.colors_per_state as usize;

        let total_positions = num_states * points_per_state * 3; // x, y, z
        let total_colors = num_states * colors_per_state * 3;    // r, g, b

        let positions_bytes = total_positions * 4; // 4 bytes per f32
        let colors_bytes = total_colors * 4;
        let expected_total = 16 + positions_bytes + colors_bytes;

        if data.len() < expected_total {
            return Err(JsValue::from_str(&format!(
                "Insufficient data: expected {} bytes, got {} bytes",
                expected_total, data.len()
            )));
        }

        // Parse positions data
        let mut positions_offset = 16;
        let mut all_positions = Vec::with_capacity(total_positions);

        for _ in 0..total_positions {
            if positions_offset + 4 > data.len() {
                return Err(JsValue::from_str("Incomplete positions data"));
            }

            let bytes = [
                data[positions_offset],
                data[positions_offset + 1],
                data[positions_offset + 2],
                data[positions_offset + 3],
            ];
            all_positions.push(f32::from_le_bytes(bytes));
            positions_offset += 4;
        }

        // Parse colors data
        let mut colors_offset = positions_offset;
        let mut all_colors = Vec::with_capacity(total_colors);

        for _ in 0..total_colors {
            if colors_offset + 4 > data.len() {
                return Err(JsValue::from_str("Incomplete colors data"));
            }

            let bytes = [
                data[colors_offset],
                data[colors_offset + 1],
                data[colors_offset + 2],
                data[colors_offset + 3],
            ];
            all_colors.push(f32::from_le_bytes(bytes));
            colors_offset += 4;
        }

        // Split data into individual states
        let mut states = Vec::with_capacity(num_states);
        let positions_per_state = points_per_state * 3;
        let colors_per_state_values = colors_per_state * 3;

        for i in 0..num_states {
            let pos_start = i * positions_per_state;
            let pos_end = pos_start + positions_per_state;
            let positions = all_positions[pos_start..pos_end].to_vec();

            let col_start = i * colors_per_state_values;
            let col_end = col_start + colors_per_state_values;
            let colors = all_colors[col_start..col_end].to_vec();

            states.push(ArtState { positions, colors });
        }

        console::log_1(&format!(
            "Successfully parsed {} art states with {} points each",
            num_states, points_per_state
        ).into());

        Ok(ArtData { states, header })
    }

    /// Get total number of art states
    pub fn num_states(&self) -> usize {
        self.states.len()
    }

    /// Get a specific art state by index
    pub fn get_state(&self, index: usize) -> Option<ArtState> {
        self.states.get(index).cloned()
    }

    /// Get positions for a specific state as Float32Array
    pub fn get_positions(&self, state_index: usize) -> Result<Box<[f32]>, JsValue> {
        self.states
            .get(state_index)
            .map(|state| state.positions.clone().into_boxed_slice())
            .ok_or_else(|| JsValue::from_str(&format!("State index {} out of bounds", state_index)))
    }

    /// Get colors for a specific state as Float32Array
    pub fn get_colors(&self, state_index: usize) -> Result<Box<[f32]>, JsValue> {
        self.states
            .get(state_index)
            .map(|state| state.colors.clone().into_boxed_slice())
            .ok_or_else(|| JsValue::from_str(&format!("State index {} out of bounds", state_index)))
    }

    /// Get the number of points per state
    pub fn points_per_state(&self) -> i32 {
        self.header.points_per_state
    }

    /// Get the data format version
    pub fn version(&self) -> i32 {
        self.header.version
    }
}
