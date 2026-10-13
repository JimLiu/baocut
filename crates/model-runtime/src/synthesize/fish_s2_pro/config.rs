//! Adapted from soniqo/speech-swift Sources/FishAudioTTS (Apache-2.0).
//! Copyright 2025 Ivan Digital; Rust/MLX/Candle changes. License and scope: mod.rs.
use anyhow::{Result, ensure};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct BlockConfig {
    pub dim: usize,
    pub n_layer: usize,
    pub n_head: usize,
    pub n_local_heads: usize,
    pub head_dim: usize,
    pub intermediate_size: usize,
    pub max_seq_len: usize,
    pub rope_base: f32,
    pub norm_eps: f32,
    pub vocab_size: usize,
    #[serde(default)]
    pub attention_qk_norm: bool,
    #[serde(default)]
    pub tie_word_embeddings: bool,
    #[serde(default)]
    pub num_codebooks: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub model_type: String,
    pub eos_token_id: i32,
    pub semantic_start_token_id: i32,
    pub semantic_end_token_id: i32,
    #[serde(default)]
    pub quantization: Option<Quantization>,
    pub text_config: BlockConfig,
    pub audio_decoder_config: BlockConfig,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Quantization {
    pub group_size: usize,
    pub bits: u32,
    pub mode: String,
}
impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let config: Self = serde_json::from_slice(&std::fs::read(path)?)?;
        config.validate()?;
        Ok(config)
    }
    pub fn validate(&self) -> Result<()> {
        if let Some(q) = &self.quantization {
            ensure!(
                matches!(q.bits, 4 | 8) && matches!(q.group_size, 32 | 64 | 128) && q.mode == "affine",
                "unsupported Fish quantization"
            );
        }
        ensure!(
            self.model_type == "fish_qwen3_omni",
            "unsupported Fish model type: {}",
            self.model_type
        );
        for c in [&self.text_config, &self.audio_decoder_config] {
            ensure!(
                c.dim > 0 && c.n_layer > 0 && c.n_head > 0 && c.n_local_heads > 0,
                "invalid Fish transformer dimensions"
            );
            ensure!(
                c.n_head % c.n_local_heads == 0 && c.head_dim > 0 && c.head_dim % 2 == 0,
                "invalid Fish attention dimensions"
            );
            ensure!(
                c.intermediate_size > 0 && c.max_seq_len > 0 && c.rope_base.is_finite() && c.rope_base > 0.0 && c.norm_eps > 0.0,
                "invalid Fish transformer configuration"
            );
        }
        ensure!(
            self.text_config.dim == self.audio_decoder_config.dim,
            "Fish fast projection is not supported"
        );
        ensure!(
            self.audio_decoder_config.num_codebooks == super::CODEBOOKS && self.audio_decoder_config.vocab_size == super::CODEBOOK_SIZE,
            "unsupported Fish codebook dimensions"
        );
        ensure!(
            self.semantic_start_token_id >= 0
                && self.semantic_end_token_id - self.semantic_start_token_id + 1 == super::CODEBOOK_SIZE as i32,
            "invalid Fish semantic token range"
        );
        ensure!(
            self.semantic_end_token_id < self.text_config.vocab_size as i32
                && self.eos_token_id >= 0
                && self.eos_token_id < self.text_config.vocab_size as i32,
            "Fish token outside vocabulary"
        );
        ensure!(
            self.eos_token_id < self.semantic_start_token_id || self.eos_token_id > self.semantic_end_token_id,
            "Fish EOS overlaps semantic tokens"
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Config {
        serde_json::from_str(include_str!("../../../tests/fixtures/fish-s2-pro-config.json")).unwrap()
    }
    #[test]
    fn pinned_s2_pro_configuration_is_valid() {
        let c = config();
        c.validate().unwrap();
        assert_eq!(c.text_config.n_layer, 36);
        assert_eq!(c.audio_decoder_config.num_codebooks, 10);
    }
    #[test]
    fn rejects_other_models_and_incompatible_codebooks() {
        let mut c = config();
        c.model_type = "drama3".into();
        assert!(c.validate().is_err());
        let mut c = config();
        c.audio_decoder_config.num_codebooks = 8;
        assert!(c.validate().is_err());
        let mut c = config();
        c.semantic_end_token_id = 0;
        assert!(c.validate().is_err());
    }
}
