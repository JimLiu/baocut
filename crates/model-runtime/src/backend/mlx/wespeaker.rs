//! WeSpeaker ResNet34-LM 声纹嵌入（Apple Silicon / MLX）。移植自 v2 `bcut-speech` 的 `wespeaker.rs`。
//!
//! fbank 前端、网络形状常量与余弦距离都在 [`crate::speech::wespeaker_fbank`]，各后端共用；这里只有 MLX 的
//! ResNet34 主干与权重加载。v3 只改边界：权重按模型包清单取（[`VerifiedFiles`]），不扫描目录。
//!
//! 网络是 BN 已折叠进卷积的 ResNet34：conv1 + [3,4,6,3] BasicBlock +
//! 统计池化（mean‖std）+ Linear(5120→256) + L2 归一化。权重按 mlx-rs Conv2d
//! 原生 NHWC 布局 `[O, kH, kW, Cin]` 存放，加载时无需转置。

use std::collections::HashMap;

use anyhow::{Context, Result, bail};
use mlx_rs::module::{Module, Param};
use mlx_rs::nn::{Conv2d, Linear, relu};
use mlx_rs::{Array, ops};

use super::runtime::{self, MemoryCacheGuard, ModelMemoryCacheGuard, load_safetensors};
use crate::bundle::VerifiedFiles;
use crate::speech::SpeakerEmbedding;
pub use crate::speech::wespeaker_fbank::{
    EMBEDDING_DIM, HOP_LENGTH, MINIMUM_SAMPLES, N_FFT, N_MELS, POOLED_FREQUENCY, POOLING_OUTPUT_DIM, RESNET_PLAN, SAMPLE_RATE,
    WeSpeakerFbank, cosine_distance,
};

// ---------------------------------------------------------------------------
// ResNet34 网络
// ---------------------------------------------------------------------------

/// BN 已折叠进卷积的 ResNet BasicBlock：两个带 bias 的 3×3 卷积，
/// stride≠1 或通道变化时 residual 走 1×1 shortcut 卷积（同样带 bias）。
struct BasicBlock {
    conv1: Conv2d,
    conv2: Conv2d,
    shortcut: Option<Conv2d>,
}

impl BasicBlock {
    fn load(weights: &mut HashMap<String, Array>, prefix: &str, input_channels: i32, output_channels: i32, stride: i32) -> Result<Self> {
        let conv1 = take_conv2d(weights, &format!("{prefix}.conv1"), input_channels, output_channels, 3, stride, 1)?;
        let conv2 = take_conv2d(weights, &format!("{prefix}.conv2"), output_channels, output_channels, 3, 1, 1)?;
        let shortcut = if stride != 1 || input_channels != output_channels {
            Some(take_conv2d(
                weights,
                &format!("{prefix}.shortcut"),
                input_channels,
                output_channels,
                1,
                stride,
                0,
            )?)
        } else {
            None
        };
        Ok(Self { conv1, conv2, shortcut })
    }

    fn forward(&mut self, x: &Array) -> Result<Array> {
        let mut out = relu(self.conv1.forward(x)?)?;
        out = self.conv2.forward(&out)?;
        let residual = match self.shortcut.as_mut() {
            Some(shortcut) => shortcut.forward(x)?,
            None => x.clone(),
        };
        Ok(relu(ops::add(&out, &residual)?)?)
    }
}

struct WeSpeakerNetwork {
    conv1: Conv2d,
    layers: Vec<Vec<BasicBlock>>,
    embedding: Linear,
}

impl WeSpeakerNetwork {
    fn load(weights: &mut HashMap<String, Array>) -> Result<Self> {
        let conv1 = take_conv2d(weights, "conv1", 1, 32, 3, 1, 1)?;
        let mut layers = Vec::with_capacity(RESNET_PLAN.len());
        for (index, input_channels, output_channels, block_count) in RESNET_PLAN {
            let (input_channels, output_channels) = (input_channels as i32, output_channels as i32);
            let mut blocks = Vec::with_capacity(block_count);
            for block in 0..block_count {
                let first = block == 0;
                blocks.push(BasicBlock::load(
                    weights,
                    &format!("layer{index}.{block}"),
                    if first { input_channels } else { output_channels },
                    output_channels,
                    if first && input_channels != output_channels { 2 } else { 1 },
                )?);
            }
            layers.push(blocks);
        }
        let embedding_weight = take_weight(weights, "embedding.weight")?;
        let embedding_bias = take_weight(weights, "embedding.bias")?;
        expect_shape(
            "embedding.weight",
            &embedding_weight,
            &[EMBEDDING_DIM as i32, POOLING_OUTPUT_DIM as i32],
        )?;
        expect_shape("embedding.bias", &embedding_bias, &[EMBEDDING_DIM as i32])?;
        Ok(Self {
            conv1,
            layers,
            embedding: Linear {
                weight: Param::new(embedding_weight),
                bias: Param::new(Some(embedding_bias)),
            },
        })
    }

    /// `mel`：`[1, T, 80, 1]`；返回 `[1, 256]` 的 L2 归一化嵌入。
    fn forward(&mut self, mel: &Array) -> Result<Array> {
        // Python WeSpeaker 的输入编排是 (B,T,F) → (B,F,T) → (B,1,F,T)（NCHW）；
        // MLX 的 NHWC 对应 [B, F, T, C]，所以这里把频率换到 H、时间换到 W。
        let mut x = mel.transpose_axes(&[0, 2, 1, 3])?;
        x = relu(self.conv1.forward(&x)?)?;
        for layer in self.layers.iter_mut() {
            for block in layer.iter_mut() {
                x = block.forward(&x)?;
            }
        }
        // x: [B, F'=10, T'=T/8, C=256]（NHWC），对应 Python 的 [B, 256, 10, T']。
        let shape = x.shape().to_vec();
        if shape.len() != 4 || shape[1] != POOLED_FREQUENCY as i32 {
            bail!("WeSpeaker 主干输出形状异常：{shape:?}");
        }
        let batch = shape[0];
        let time = shape[2];
        if time < 1 {
            bail!("WeSpeaker 池化前时间轴为空");
        }
        // 展平顺序必须是 C·F（Python reshape [B,256,10,T'] → [B,2560,T']）。
        x = x.transpose_axes(&[0, 2, 3, 1])?.reshape(&[batch, time, -1])?;

        // 统计池化（沿时间轴）。mlx-rs 没有 variance 绑定，手算 E[x²]-E[x]² 并夹到 ≥0。
        let mean = x.mean_axis(1, false)?;
        let mean_square = ops::square(&x)?.mean_axis(1, false)?;
        let variance = ops::maximum(ops::subtract(&mean_square, &ops::square(&mean)?)?, Array::from_f32(0.0))?;
        let deviation = ops::sqrt(ops::add(&variance, Array::from_f32(1e-10))?)?;
        let pooled = ops::concatenate_axis(&[&mean, &deviation], -1)?;

        let embedding = self.embedding.forward(&pooled)?;
        let norm = ops::sqrt(ops::add(&ops::square(&embedding)?.sum_axis(-1, true)?, Array::from_f32(1e-10))?)?;
        Ok(ops::divide(&embedding, &norm)?)
    }
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/// WeSpeaker ResNet34-LM 声纹嵌入器。
pub struct WeSpeakerEmbedder {
    fbank: WeSpeakerFbank,
    network: WeSpeakerNetwork,
    // Fields drop in declaration order: release weights before flushing their buffers.
    _memory_cache_guard: ModelMemoryCacheGuard,
}

impl WeSpeakerEmbedder {
    /// 从 `speaker` 组件的文件加载权重（组件顶层列出的全部 safetensors 分片）。
    pub fn load(files: &VerifiedFiles) -> Result<Self> {
        runtime::ensure_metal_device()?;
        let shards = files.require_extension_in("", "safetensors")?;
        // Also flush partially loaded weights on an early error.
        let memory_cache_guard = ModelMemoryCacheGuard;
        let mut weights = load_safetensors(&shards)?;
        let network = WeSpeakerNetwork::load(&mut weights)?;
        if !weights.is_empty() {
            let mut unused = weights.keys().cloned().collect::<Vec<_>>();
            unused.sort();
            bail!("WeSpeaker 存在未使用权重：{}", unused.join("、"));
        }
        Ok(Self {
            fbank: WeSpeakerFbank::new(),
            network,
            _memory_cache_guard: memory_cache_guard,
        })
    }

    /// fbank 前端（测试与诊断用）。
    pub fn fbank(&self) -> &WeSpeakerFbank {
        &self.fbank
    }

    /// 对 16 kHz 单声道样本求 256 维 L2 归一化嵌入。
    ///
    /// 少于 0.5 秒直接报错——统计池化在这种长度上没有意义，调用方应先过滤。
    pub fn embed(&mut self, samples: &[f32]) -> Result<Vec<f32>> {
        if samples.len() < MINIMUM_SAMPLES {
            bail!("WeSpeaker 需要至少 {MINIMUM_SAMPLES} 个样本（0.5 秒），实际 {}", samples.len());
        }
        let _cache_guard = MemoryCacheGuard::new();
        let features = self.fbank.extract(samples)?;
        let frames = i32::try_from(features.time_frames).context("fbank 帧数超出 i32")?;
        let mel = Array::from_slice(&features.data, &[1, frames, N_MELS as i32, 1]);
        let embedding = self.network.forward(&mel)?;
        embedding.eval()?;
        let values = embedding.as_slice::<f32>().to_vec();
        if values.len() != EMBEDDING_DIM {
            bail!("WeSpeaker 嵌入维度异常：{}", values.len());
        }
        Ok(values)
    }
}

impl SpeakerEmbedding for WeSpeakerEmbedder {
    fn embed(&mut self, samples: &[f32]) -> Result<Vec<f32>> {
        WeSpeakerEmbedder::embed(self, samples)
    }
}

// ---------------------------------------------------------------------------
// 权重提取
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn take_conv2d(
    weights: &mut HashMap<String, Array>,
    prefix: &str,
    input_channels: i32,
    output_channels: i32,
    kernel: i32,
    stride: i32,
    padding: i32,
) -> Result<Conv2d> {
    let weight = take_weight(weights, &format!("{prefix}.weight"))?;
    let bias = take_weight(weights, &format!("{prefix}.bias"))?;
    expect_shape(
        &format!("{prefix}.weight"),
        &weight,
        &[output_channels, kernel, kernel, input_channels],
    )?;
    expect_shape(&format!("{prefix}.bias"), &bias, &[output_channels])?;
    Ok(Conv2d {
        weight: Param::new(weight),
        bias: Param::new(Some(bias)),
        stride: (stride, stride),
        padding: (padding, padding),
        dilation: (1, 1),
        groups: 1,
    })
}

fn take_weight(weights: &mut HashMap<String, Array>, key: &str) -> Result<Array> {
    weights.remove(key).with_context(|| format!("缺少 WeSpeaker 权重：{key}"))
}

fn expect_shape(key: &str, array: &Array, expected: &[i32]) -> Result<()> {
    if array.shape() != expected {
        bail!("WeSpeaker 权重 {key} 形状为 {:?}，期望 {expected:?}", array.shape());
    }
    Ok(())
}
