//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/AudioEncoder.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3-ASR 的音频塔：三层 stride-2 卷积 + Transformer 编码器（分块注意力）+ 两层投影。
//!
//! `LARGE`（Qwen3-ASR 1.7B）与 `FORCED_ALIGNER`（Qwen3-ForcedAligner，卷积权重是 PyTorch 布局）移植自 v2。

use super::WeightStore;
use super::layers::gelu_same_dtype;
use super::layers::{Dense, LayerNorm};
use anyhow::{Result, bail};
use mlx_rs::Array;
use mlx_rs::fast;
use mlx_rs::module::{Module, Param};
use mlx_rs::nn::Conv2d;
use mlx_rs::ops;
use mlx_rs::ops::indexing::IndexOp;

use crate::speech::decoding::{downsampled_length, input_chunk_lengths};
use crate::speech::mel::TimeMajorMelFeatures;

pub use crate::speech::qwen3_asr::AudioEncoderConfig;

struct AudioAttention {
    q_proj: Dense,
    k_proj: Dense,
    v_proj: Dense,
    out_proj: Dense,
    heads: usize,
}

impl AudioAttention {
    fn load(store: &mut WeightStore, prefix: &str, heads: usize) -> Result<Self> {
        Ok(Self {
            q_proj: Dense::load(store, &format!("{prefix}.q_proj"))?,
            k_proj: Dense::load(store, &format!("{prefix}.k_proj"))?,
            v_proj: Dense::load(store, &format!("{prefix}.v_proj"))?,
            out_proj: Dense::load(store, &format!("{prefix}.out_proj"))?,
            heads,
        })
    }

    fn forward(&self, input: &Array, mask: &Array) -> Result<Array> {
        let batch = input.dim(0);
        let sequence = input.dim(1);
        let hidden = input.dim(2);
        let head_dim = hidden / self.heads as i32;
        let query = self
            .q_proj
            .forward(input)?
            .reshape(&[batch, sequence, self.heads as i32, head_dim])?
            .transpose_axes(&[0, 2, 1, 3])?;
        let key = self
            .k_proj
            .forward(input)?
            .reshape(&[batch, sequence, self.heads as i32, head_dim])?
            .transpose_axes(&[0, 2, 1, 3])?;
        let value = self
            .v_proj
            .forward(input)?
            .reshape(&[batch, sequence, self.heads as i32, head_dim])?
            .transpose_axes(&[0, 2, 1, 3])?;
        let attended = fast::scaled_dot_product_attention(&query, &key, &value, (head_dim as f32).sqrt().recip(), mask, None)?;
        let merged = attended.transpose_axes(&[0, 2, 1, 3])?.reshape(&[batch, sequence, hidden])?;
        self.out_proj.forward(&merged)
    }
}

struct AudioLayer {
    attention: AudioAttention,
    attention_norm: LayerNorm,
    fc1: Dense,
    fc2: Dense,
    final_norm: LayerNorm,
}

impl AudioLayer {
    fn load(store: &mut WeightStore, prefix: &str, heads: usize) -> Result<Self> {
        Ok(Self {
            attention: AudioAttention::load(store, &format!("{prefix}.self_attn"), heads)?,
            attention_norm: LayerNorm::load(store, &format!("{prefix}.self_attn_layer_norm"), 1e-5)?,
            fc1: Dense::load(store, &format!("{prefix}.fc1"))?,
            fc2: Dense::load(store, &format!("{prefix}.fc2"))?,
            final_norm: LayerNorm::load(store, &format!("{prefix}.final_layer_norm"), 1e-5)?,
        })
    }

    fn forward(&self, input: &Array, mask: &Array) -> Result<Array> {
        let normalized = self.attention_norm.forward(input)?;
        let mut hidden = input + &self.attention.forward(&normalized, mask)?;
        let residual = hidden.clone();
        hidden = self.final_norm.forward(&hidden)?;
        hidden = self.fc1.forward(&hidden)?;
        hidden = gelu_same_dtype(&hidden)?;
        hidden = self.fc2.forward(&hidden)?;
        Ok(&residual + &hidden)
    }
}

pub struct Qwen3AudioEncoder {
    config: AudioEncoderConfig,
    conv1: Conv2d,
    conv2: Conv2d,
    conv3: Conv2d,
    conv_out: Dense,
    layers: Vec<AudioLayer>,
    ln_post: LayerNorm,
    proj1: Dense,
    proj2: Dense,
}

impl Qwen3AudioEncoder {
    pub fn load(store: &mut WeightStore, config: AudioEncoderConfig) -> Result<Self> {
        let prefix = "audio_tower";
        let conv1 = load_conv2d(store, &format!("{prefix}.conv2d1"), config.transpose_pytorch_conv)?;
        let conv2 = load_conv2d(store, &format!("{prefix}.conv2d2"), config.transpose_pytorch_conv)?;
        let conv3 = load_conv2d(store, &format!("{prefix}.conv2d3"), config.transpose_pytorch_conv)?;
        let mut layers = Vec::with_capacity(config.layers);
        for index in 0..config.layers {
            layers.push(AudioLayer::load(store, &format!("{prefix}.layers.{index}"), config.heads)?);
        }
        Ok(Self {
            config,
            conv1,
            conv2,
            conv3,
            conv_out: Dense::load(store, &format!("{prefix}.conv_out"))?,
            layers,
            ln_post: LayerNorm::load(store, &format!("{prefix}.ln_post"), 1e-5)?,
            proj1: Dense::load(store, &format!("{prefix}.proj1"))?,
            proj2: Dense::load(store, &format!("{prefix}.proj2"))?,
        })
    }

    pub fn encode(&mut self, features: &TimeMajorMelFeatures) -> Result<Array> {
        if features.time_frames == 0 || features.mel_bins != 128 {
            bail!(
                "the Qwen3 audio tower needs non-empty 128-bin mel features, got {}x{}",
                features.time_frames,
                features.mel_bins
            );
        }
        let chunk_lengths = input_chunk_lengths(features.time_frames, 100);
        let maximum_chunk = chunk_lengths.iter().copied().max().unwrap_or(100);
        let mut padded = vec![0.0_f32; chunk_lengths.len() * features.mel_bins * maximum_chunk];
        let mut source_time = 0;
        for (chunk, length) in chunk_lengths.iter().copied().enumerate() {
            for time in 0..length {
                for mel in 0..features.mel_bins {
                    let source = (source_time + time) * features.mel_bins + mel;
                    let destination = (chunk * features.mel_bins + mel) * maximum_chunk + time;
                    padded[destination] = features.data[source];
                }
            }
            source_time += length;
        }
        let mut hidden = Array::from_slice(
            &padded,
            &[chunk_lengths.len() as i32, features.mel_bins as i32, maximum_chunk as i32, 1],
        );
        hidden = gelu_same_dtype(&self.conv1.forward(&hidden)?)?;
        hidden = gelu_same_dtype(&self.conv2.forward(&hidden)?)?;
        hidden = gelu_same_dtype(&self.conv3.forward(&hidden)?)?;

        let batch = hidden.dim(0);
        let frequency = hidden.dim(1);
        let time = hidden.dim(2);
        let channels = hidden.dim(3);
        hidden = hidden
            .transpose_axes(&[0, 2, 3, 1])?
            .reshape(&[batch, time, channels * frequency])?;
        hidden = self.conv_out.forward(&hidden)?;
        hidden = &hidden + &sinusoidal_positions(time as usize, self.config.d_model)?;

        let valid_lengths = chunk_lengths.iter().copied().map(downsampled_length).collect::<Vec<_>>();
        let mut valid_chunks = Vec::with_capacity(valid_lengths.len());
        for (index, length) in valid_lengths.iter().copied().enumerate() {
            valid_chunks.push(hidden.index((index as i32, 0..length as i32, ..)));
        }
        hidden = ops::concatenate_axis(&valid_chunks, 0)?;
        let total_tokens = hidden.dim(0) as usize;
        let maximum_after_cnn = valid_lengths.iter().copied().max().unwrap_or(13);
        let window_after_cnn = maximum_after_cnn * 8;
        let mask = block_attention_mask(total_tokens, window_after_cnn)?.as_dtype(hidden.dtype())?;
        hidden = hidden.expand_dims(0)?;
        for layer in &self.layers {
            hidden = layer.forward(&hidden, &mask)?;
        }
        hidden = hidden.squeeze_axes(&[0])?;
        hidden = self.ln_post.forward(&hidden)?;
        hidden = gelu_same_dtype(&self.proj1.forward(&hidden)?)?;
        self.proj2.forward(&hidden)
    }

    pub fn output_dim(&self) -> usize {
        self.config.output_dim
    }
}

fn load_conv2d(store: &mut WeightStore, prefix: &str, transpose_pytorch: bool) -> Result<Conv2d> {
    let mut weight = store.take(&format!("{prefix}.weight"))?;
    if transpose_pytorch {
        weight = weight.transpose_axes(&[0, 2, 3, 1])?;
    }
    Ok(Conv2d {
        weight: Param::new(weight),
        bias: Param::new(store.take_optional(&format!("{prefix}.bias"))),
        stride: (2, 2),
        padding: (1, 1),
        dilation: (1, 1),
        groups: 1,
    })
}

fn sinusoidal_positions(sequence: usize, dimensions: usize) -> Result<Array> {
    let half = dimensions / 2;
    let increment = 10_000.0_f32.ln() / (half - 1) as f32;
    let inverse = (0..half).map(|index| (-increment * index as f32).exp()).collect::<Vec<_>>();
    let mut values = vec![0.0_f32; sequence * dimensions];
    for position in 0..sequence {
        for index in 0..half {
            let scaled = position as f32 * inverse[index];
            values[position * dimensions + index] = scaled.sin();
            values[position * dimensions + half + index] = scaled.cos();
        }
    }
    Ok(Array::from_slice(&values, &[1, sequence as i32, dimensions as i32]))
}

fn block_attention_mask(sequence: usize, window: usize) -> Result<Array> {
    let mut values = vec![0.0_f32; sequence * sequence];
    for row in 0..sequence {
        for column in 0..sequence {
            if row / window != column / window {
                values[row * sequence + column] = -1e9;
            }
        }
    }
    Ok(Array::from_slice(&values, &[1, 1, sequence as i32, sequence as i32]))
}
