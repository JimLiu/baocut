//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/AudioEncoder.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3 音频塔（candle），镜像 mlx 后端 `qwen3/audio_encoder.rs`。
//!
//! candle 卷积使用 NCHW 布局；MLX checkpoint 的 Conv2d 权重为
//! [out, kh, kw, in]，加载时转为 candle 的 [out, in, kh, kw]。

use super::layers::{Dense, LayerNorm, gelu, mask_bias, scaled_dot_product_attention};
use super::weights::WeightStore;
use anyhow::{Result, bail};
use candle_core::{DType, IndexOp, Tensor};

use crate::speech::decoding::{downsampled_length, input_chunk_lengths};
use crate::speech::mel::TimeMajorMelFeatures;
pub use crate::speech::qwen3_asr::AudioEncoderConfig;

struct Conv2d {
    weight: Tensor,
    bias: Option<Tensor>,
}

impl Conv2d {
    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let output = input.conv2d(&self.weight, 1, 2, 1, 1)?;
        Ok(match &self.bias {
            Some(bias) => {
                let out_channels = bias.dim(0)?;
                output.broadcast_add(&bias.reshape((1, out_channels, 1, 1))?)?
            }
            None => output,
        })
    }
}

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

    fn forward(&self, input: &Tensor, mask: &Tensor) -> Result<Tensor> {
        let (batch, sequence, hidden) = input.dims3()?;
        let head_dim = hidden / self.heads;
        let shape = (batch, sequence, self.heads, head_dim);
        // SDPA 直接把张量交给 gemm，音频塔没有 KV cache 视图，需自行连续化。
        let query = self.q_proj.forward(input)?.reshape(shape)?.transpose(1, 2)?.contiguous()?;
        let key = self.k_proj.forward(input)?.reshape(shape)?.transpose(1, 2)?.contiguous()?;
        let value = self.v_proj.forward(input)?.reshape(shape)?.transpose(1, 2)?.contiguous()?;
        let attended = scaled_dot_product_attention(&query, &key, &value, (head_dim as f64).sqrt().recip(), Some(mask))?;
        let merged = attended.transpose(1, 2)?.reshape((batch, sequence, hidden))?;
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

    fn forward(&self, input: &Tensor, mask: &Tensor) -> Result<Tensor> {
        let normalized = self.attention_norm.forward(input)?;
        let mut hidden = (input + self.attention.forward(&normalized, mask)?)?;
        let residual = hidden.clone();
        hidden = self.final_norm.forward(&hidden)?;
        hidden = self.fc1.forward(&hidden)?;
        hidden = gelu(&hidden)?;
        hidden = self.fc2.forward(&hidden)?;
        Ok((residual + hidden)?)
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

    /// 输出 [total_tokens, output_dim]。
    pub fn encode(&self, features: &TimeMajorMelFeatures) -> Result<Tensor> {
        if features.time_frames == 0 || features.mel_bins != 128 {
            bail!(
                "the Qwen3 audio tower needs a non-empty 128-bin mel, got {}×{}",
                features.time_frames,
                features.mel_bins
            );
        }
        let device = self.conv_out.device().clone();
        let dtype = self.conv_out.dtype();
        let chunk_lengths = input_chunk_lengths(features.time_frames, 100);
        let maximum_chunk = chunk_lengths.iter().copied().max().unwrap_or(100);
        // NCHW：[chunks, 1, mel, time]，与 mlx NHWC 的 [chunks, mel, time, 1] 等价。
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
        let mut hidden = Tensor::from_vec(padded, (chunk_lengths.len(), 1, features.mel_bins, maximum_chunk), &device)?.to_dtype(dtype)?;
        hidden = gelu(&self.conv1.forward(&hidden)?)?;
        hidden = gelu(&self.conv2.forward(&hidden)?)?;
        hidden = gelu(&self.conv3.forward(&hidden)?)?;

        // [b, c, f, t] → [b, t, c, f] → [b, t, c*f]（与 mlx 的通道在外、频率在内一致）。
        let (batch, channels, frequency, time) = hidden.dims4()?;
        hidden = hidden.permute((0, 3, 1, 2))?.reshape((batch, time, channels * frequency))?;
        hidden = self.conv_out.forward(&hidden)?;
        hidden = hidden.broadcast_add(&sinusoidal_positions(time, self.config.d_model, &device, dtype)?)?;

        let valid_lengths = chunk_lengths.iter().copied().map(downsampled_length).collect::<Vec<_>>();
        let mut valid_chunks = Vec::with_capacity(valid_lengths.len());
        for (index, length) in valid_lengths.iter().copied().enumerate() {
            valid_chunks.push(hidden.i((index, 0..length, ..))?);
        }
        let mut hidden = Tensor::cat(&valid_chunks, 0)?;
        let total_tokens = hidden.dim(0)?;
        let maximum_after_cnn = valid_lengths.iter().copied().max().unwrap_or(13);
        let window_after_cnn = maximum_after_cnn * 8;
        let mask = block_attention_mask(total_tokens, window_after_cnn, &device, dtype)?;
        hidden = hidden.unsqueeze(0)?;
        for layer in &self.layers {
            hidden = layer.forward(&hidden, &mask)?;
        }
        hidden = hidden.squeeze(0)?;
        hidden = self.ln_post.forward(&hidden)?;
        hidden = gelu(&self.proj1.forward(&hidden)?)?;
        self.proj2.forward(&hidden)
    }

    pub fn output_dim(&self) -> usize {
        self.config.output_dim
    }
}

fn load_conv2d(store: &mut WeightStore, prefix: &str, pytorch_layout: bool) -> Result<Conv2d> {
    let mut weight = store.take_compute(&format!("{prefix}.weight"))?;
    // MLX 布局 [out, kh, kw, in] → candle [out, in, kh, kw]；
    // PyTorch 布局（对齐器 checkpoint）本身就是 candle 需要的。
    if !pytorch_layout {
        weight = weight.permute((0, 3, 1, 2))?;
    }
    Ok(Conv2d {
        weight: weight.contiguous()?,
        bias: store.take_optional_compute(&format!("{prefix}.bias"))?,
    })
}

fn sinusoidal_positions(sequence: usize, dimensions: usize, device: &candle_core::Device, dtype: DType) -> Result<Tensor> {
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
    Ok(Tensor::from_vec(values, (1, sequence, dimensions), device)?.to_dtype(dtype)?)
}

fn block_attention_mask(sequence: usize, window: usize, device: &candle_core::Device, dtype: DType) -> Result<Tensor> {
    let bias = mask_bias(dtype) as f32;
    let mut values = vec![0.0_f32; sequence * sequence];
    for row in 0..sequence {
        for column in 0..sequence {
            if row / window != column / window {
                values[row * sequence + column] = bias;
            }
        }
    }
    Ok(Tensor::from_vec(values, (1, 1, sequence, sequence), device)?.to_dtype(dtype)?)
}
