//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/VoxCPM2TTS/Configuration.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! `config.json`（aufklarer VoxCPM2 MLX 导出）。对照 speech-swift `Configuration.swift`。

use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct VoxCpm2Config {
    pub lm_config: LmConfig,
    #[serde(default = "default_patch_size")]
    pub patch_size: usize,
    #[serde(default = "default_feat_dim")]
    pub feat_dim: usize,
    #[serde(default = "default_fsq_latent")]
    pub scalar_quantization_latent_dim: usize,
    #[serde(default = "default_fsq_scale")]
    pub scalar_quantization_scale: usize,
    #[serde(default = "default_residual_layers")]
    pub residual_lm_num_layers: usize,
    #[serde(default = "default_true")]
    pub residual_lm_no_rope: bool,
    pub encoder_config: BlockConfig,
    pub dit_config: DitConfig,
    pub audio_vae_config: AudioVaeConfig,
    #[serde(default)]
    pub quantization: Option<Quantization>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LmConfig {
    pub hidden_size: usize,
    pub intermediate_size: usize,
    pub max_position_embeddings: usize,
    pub num_attention_heads: usize,
    pub num_hidden_layers: usize,
    pub num_key_value_heads: usize,
    pub rms_norm_eps: f32,
    pub rope_theta: f32,
    #[serde(default)]
    pub kv_channels: Option<usize>,
    pub vocab_size: usize,
    #[serde(default)]
    pub use_mup: bool,
    #[serde(default = "default_one")]
    pub scale_emb: f32,
    #[serde(default = "default_one")]
    pub scale_depth: f32,
    #[serde(default)]
    pub rope_scaling: Option<RopeScaling>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RopeScaling {
    #[serde(default)]
    pub short_factor: Vec<f32>,
    #[serde(default)]
    pub long_factor: Vec<f32>,
    pub original_max_position_embeddings: usize,
}

/// 局部编码器 / 局部 DiT 的 MiniCPM 尺寸（头数与 kv 头数沿用 `lm_config`）。
#[derive(Debug, Clone, Deserialize)]
pub struct BlockConfig {
    pub hidden_dim: usize,
    pub ffn_dim: usize,
    pub num_heads: usize,
    pub num_layers: usize,
    #[serde(default)]
    pub kv_channels: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DitConfig {
    #[serde(flatten)]
    pub block: BlockConfig,
    #[serde(default)]
    pub mean_mode: bool,
    #[serde(default)]
    pub cfm_config: CfmConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CfmConfig {
    #[serde(default = "default_cfg")]
    pub inference_cfg_rate: f32,
}

impl Default for CfmConfig {
    fn default() -> Self {
        Self {
            inference_cfg_rate: default_cfg(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AudioVaeConfig {
    pub encoder_dim: usize,
    pub encoder_rates: Vec<usize>,
    pub latent_dim: usize,
    pub decoder_dim: usize,
    pub decoder_rates: Vec<usize>,
    #[serde(default)]
    pub sr_bin_boundaries: Vec<u32>,
    pub sample_rate: u32,
    pub out_sample_rate: u32,
    #[serde(default = "default_true")]
    pub depthwise: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Quantization {
    pub bits: u32,
    pub group_size: usize,
}

impl VoxCpm2Config {
    /// 读清单列出的 `config.json`。
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("读取 VoxCPM2 配置 {}", path.display()))?;
        serde_json::from_str(&text).with_context(|| format!("解析 VoxCPM2 配置 {}", path.display()))
    }

    pub fn quant(&self) -> (usize, u32) {
        self.quantization.as_ref().map_or((64, 0), |q| (q.group_size, q.bits))
    }
}

impl LmConfig {
    pub fn head_dim(&self) -> usize {
        self.kv_channels.unwrap_or(self.hidden_size / self.num_attention_heads)
    }
}

fn default_patch_size() -> usize {
    4
}
fn default_feat_dim() -> usize {
    64
}
fn default_fsq_latent() -> usize {
    512
}
fn default_fsq_scale() -> usize {
    9
}
fn default_residual_layers() -> usize {
    8
}
fn default_true() -> bool {
    true
}
fn default_one() -> f32 {
    1.0
}
fn default_cfg() -> f32 {
    super::DEFAULT_CFG
}
