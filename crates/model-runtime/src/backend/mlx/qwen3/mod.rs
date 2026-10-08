//! Qwen3-ASR（0.6B / 1.7B）的 MLX 实现。基础层（`Dense`、`LayerNorm`、`QuantizedDense`、`gelu_same_dtype`）
//! 照 v2 对外导出，供 Whisper、MOSS、本地语音合成等批次复用。

mod audio_encoder;
mod layers;
mod model;
mod text_decoder;
mod weights;

pub use audio_encoder::{AudioEncoderConfig, Qwen3AudioEncoder};
pub use layers::{Dense, LayerNorm, QuantizedDense, gelu_same_dtype};
pub use model::{Qwen3Asr, Qwen3Config, TokenizerFiles};
pub use text_decoder::{KvCache, TextDecoder, TextDecoderConfig};
pub use weights::WeightStore;
