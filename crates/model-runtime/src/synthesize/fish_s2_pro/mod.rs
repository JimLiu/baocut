//! Fish Audio S2 Pro: dual autoregressive transformer and DAC codec, 44.1 kHz.
//! Adapted from soniqo/speech-swift, Sources/FishAudioTTS (Apache-2.0).
//! Copyright 2025 Ivan Digital. Changes: Rust, verified bundle files, MLX/Candle,
//! seeded sampling, cancellation and BaoCut reference voices.
//! License: crates/model-runtime/licenses/speech-swift.txt; THIRD_PARTY_NOTICES.md.
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod backbone;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod codec;
pub mod config;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod engine;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod memory;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod projection;
pub mod prompt;
pub mod sampling;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod vocabulary;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub use engine::FishS2Pro;
pub const SAMPLE_RATE: u32 = 44_100;
pub const CODEBOOKS: usize = 10;
pub const CODEBOOK_SIZE: usize = 4096;
pub const SAMPLES_PER_FRAME: usize = 2048;
