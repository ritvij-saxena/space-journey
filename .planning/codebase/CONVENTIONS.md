# Coding Conventions

**Analysis Date:** 2026-01-25

## Naming Patterns

**Files:**
- Rust library uses single file structure: `lib.rs` is the primary module

**Functions:**
- Snake case for all function names: `generate_noise_slice`, `sample_fbm`, `weather_to_params`, `generate_particles`
- Public functions exposed via `#[wasm_bindgen]` for WebAssembly interop
- Private helper functions use standard snake_case: `sample_fbm`

**Variables:**
- Snake case for local variables and bindings: `perlin`, `fbm`, `time`, `size_f`, `time_offset`, `slice_x`
- Single letter abbreviated variables for loop counters: `x`, `y`, `z`, `i`
- Descriptive names for complex calculations: `noise_x`, `noise_y`, `noise_z`, `displacement`, `temp_norm`

**Types:**
- Struct names use PascalCase: `NoiseField`
- Generic types in trait implementations: `Fbm<Perlin>`

**Constants:**
- Magic numbers used inline with explanatory comments (e.g., `2.0` for scale, `0.05` for time_offset multiplier)
- No formal constant definitions observed

## Code Style

**Formatting:**
- Follows Rust 2021 edition style
- Uses default rustfmt formatting (stable 1.8.0)
- 4-space indentation (Rust standard)
- Lines are reasonably concise, max observed ~90 characters

**Linting:**
- No clippy configuration present
- Relies on default Rust compiler checks

**Documentation:**
- Doc comments with `///` used for public functions and structures
- Example: `/// NoiseField generates procedural noise for the visualization.`
- Comments use `//` for inline explanations within function bodies
- Format comments explain what values represent (e.g., `// R`, `// G`, `// B`, `// A`)

## Import Organization

**Order:**
1. Crate imports: `use wasm_bindgen::prelude::*;`
2. Standard library/external crates: `use web_sys::console;`
3. Trait imports: `use noise::{NoiseFn, Perlin, Fbm};`

**Path Aliases:**
- None observed; direct module imports used

## Error Handling

**Patterns:**
- No explicit error handling observed in current codebase
- Relies on Rust's type system for validation
- Bounds checking used in array indexing: `if dst_idx + 3 < data.len() && src_idx + 3 < slice_data.len()`
- Uses `.clamp()` for parameter normalization: `temperature.clamp(-20.0, 45.0)`

## Logging

**Framework:** `web_sys::console`

**Patterns:**
- Console logging used in initialization: `console::log_1(&"NoiseField initialized".into());`
- String formatting for log messages: `format!("Hello, {}! Welcome to Unsupervised.", name)`
- Limited logging in production code; only initialization and greeting functions

## Comments

**When to Comment:**
- Document non-obvious algorithmic decisions
- Explain mathematical transformations
- Clarify RGBA channel meanings
- Example from `generate_noise_atlas`: `// Copy slice into atlas`

**JSDoc/TSDoc:**
- Uses Rust doc comments `///` with description
- Parameter meanings documented inline with comments
- Example: `/// Returns a 2D slice of 3D noise (size x size) at given z-depth`

## Function Design

**Size:**
- Functions range from 2 lines (getters) to ~50 lines (complex generators)
- Large functions like `generate_noise_atlas` break complex logic into clear sections with comments

**Parameters:**
- Public API functions take primitive types: `u32`, `f32`
- Constructor (`new`) takes single seed parameter
- Conversion functions take weather parameters: `temperature: f32, humidity: f32, wind_speed: f32`

**Return Values:**
- Returns `Vec<f32>` for bulk data (noise textures, particles)
- Returns primitive types for simple queries: `f32` for time
- No `Option` or `Result` types; assumes valid inputs

## Module Design

**Exports:**
- Single struct `NoiseField` is primary public API
- Uses `#[wasm_bindgen]` macro to expose Rust to JavaScript
- Free function `greet` for simple demo usage
- All public functions/methods exposed to WebAssembly

**Barrel Files:**
- Single-file library structure; no barrel exports needed

## Struct Implementation Pattern

**Pattern observed in `NoiseField`:**
```rust
pub struct NoiseField {
    perlin: Perlin,
    fbm: Fbm<Perlin>,
    time: f32,
}

#[wasm_bindgen]
impl NoiseField {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> NoiseField { }

    pub fn method_name(&mut self, param: type) -> return_type { }
}
```

Constructor uses `#[wasm_bindgen(constructor)]` for JavaScript interop.

## Type Safety Patterns

**Numeric types:**
- Uses `f32` for floating point calculations (WebAssembly-friendly)
- Uses `u32` for dimensions and counts
- Explicit casting between types: `x as f32`, `x as f64`

**Array/Vector handling:**
- Pre-allocates capacity: `Vec::with_capacity(total)`
- Initializes with default values: `vec![0.0; total]`
- Always bounds-checks before indexing when unsafe

---

*Convention analysis: 2026-01-25*
