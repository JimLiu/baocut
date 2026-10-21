//! Optional browser GPU binding for fully resolved caption scene input.
#[cfg(target_arch = "wasm32")]
mod web;
#[cfg(target_arch = "wasm32")]
pub use web::*;
