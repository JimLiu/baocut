//! IndexTTS2 / IndexTTS 2.5 共用的模型图（目录名沿用 MLX 来源，张量后端由 `synthesize::tensor` 分派）。

pub mod bigvgan;
pub mod campplus;
pub mod conditioning;
pub mod engine_impl;
pub mod engine_v25;
pub mod gpt;
pub mod layers;
pub mod s2mel;
pub mod semantic_codec;
pub mod v25_weights;
pub mod w2v_bert;
pub mod weights;
