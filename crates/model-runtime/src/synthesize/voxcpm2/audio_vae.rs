//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/VoxCPM2TTS/AudioVAE.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! VoxCPM2 AudioVAE：16 kHz 波形 → 64 维 latent（每帧 640 样本）→ 48 kHz 波形
//! （每帧 1920 样本）。对照 speech-swift `AudioVAE.swift`。
//!
//! 全部走通道在后（`[B, T, C]`）的 MLX 卷积布局；权重已是融合过 weight-norm 的 F32，
//! 卷积核就是 MLX 布局 `[out, k, in/groups]`，不用再转置。
//! 与 Swift 的差别：采样率条件（`sr_cond_layers`）按 48 kHz 在加载时查好表，
//! 推理时只剩一次乘加；不带 `NoiseBlock`（这份 checkpoint 没有它）。

use crate::synthesize::qwen3_tts::layers::{CausalConv1d, CausalConvTranspose1d};
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::ops;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype};
use anyhow::{Result, ensure};

use super::config::AudioVaeConfig;

fn take_f32(weights: &mut Weights, key: &str) -> Result<Array> {
    Ok(weights.take(key)?.as_dtype(Dtype::Float32)?)
}

/// `Snake1d`：`x + 1/(α+1e-9) · sin²(αx)`，`α` 形状 `[1, 1, C]`。
struct Snake {
    alpha: Array,
    inv_alpha: Array,
}

impl Snake {
    fn load(weights: &mut Weights, prefix: &str) -> Result<Self> {
        let alpha = take_f32(weights, &format!("{prefix}.alpha"))?;
        let inv_alpha = Array::from_f32(1.0).divide(&alpha.add(Array::from_f32(1e-9))?)?;
        Ok(Self { alpha, inv_alpha })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let s = x.multiply(&self.alpha)?.sin()?;
        Ok(x.add(&s.square()?.multiply(&self.inv_alpha)?)?)
    }
}

/// speech-swift 的 `CausalConv1d`：`padding > 0` 时左侧补 `max(0, 2·padding − output_padding)` 个零。
struct Conv {
    conv: CausalConv1d,
    left_pad: i32,
}

impl Conv {
    fn load(
        weights: &mut Weights,
        prefix: &str,
        stride: i32,
        dilation: i32,
        padding: i32,
        output_padding: i32,
        groups: i32,
    ) -> Result<Self> {
        let weight = take_f32(weights, &format!("{prefix}.weight"))?;
        let bias = weights
            .take_optional(&format!("{prefix}.bias"))
            .map(|b| b.as_dtype(Dtype::Float32))
            .transpose()?;
        Ok(Self {
            conv: CausalConv1d::new(weight, bias, stride, dilation, groups),
            left_pad: if padding > 0 { (2 * padding - output_padding).max(0) } else { 0 },
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        if self.left_pad == 0 {
            return self.conv.forward_padded(x);
        }
        let padded = ops::pad(x, &[(0, 0), (self.left_pad, 0), (0, 0)], Array::from_f32(0.0), None)?;
        self.conv.forward_padded(&padded)
    }
}

/// `CausalResidualUnit`：snake → k7 空洞卷积（`groups`）→ snake → 1×1 卷积，残差相加。
struct ResidualUnit {
    snake1: Snake,
    conv1: Conv,
    snake2: Snake,
    conv2: Conv,
}

impl ResidualUnit {
    fn load(weights: &mut Weights, prefix: &str, dilation: i32, groups: i32) -> Result<Self> {
        let pad = (6 * dilation) / 2;
        Ok(Self {
            snake1: Snake::load(weights, &format!("{prefix}.snake1"))?,
            conv1: Conv::load(weights, &format!("{prefix}.conv1"), 1, dilation, pad, 0, groups)?,
            snake2: Snake::load(weights, &format!("{prefix}.snake2"))?,
            conv2: Conv::load(weights, &format!("{prefix}.conv2"), 1, 1, 0, 0, 1)?,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let h = self.conv1.forward(&self.snake1.forward(x)?)?;
        let h = self.conv2.forward(&self.snake2.forward(&h)?)?;
        Ok(x.add(&h)?)
    }
}

fn residual_triple(weights: &mut Weights, prefix: &str, groups: i32) -> Result<[ResidualUnit; 3]> {
    Ok([
        ResidualUnit::load(weights, &format!("{prefix}.res1"), 1, groups)?,
        ResidualUnit::load(weights, &format!("{prefix}.res2"), 3, groups)?,
        ResidualUnit::load(weights, &format!("{prefix}.res3"), 9, groups)?,
    ])
}

struct EncoderBlock {
    res: [ResidualUnit; 3],
    snake: Snake,
    conv: Conv,
}

struct DecoderBlock {
    /// 采样率条件：`h · scale + bias`，按输出采样率在加载时取好行。
    sr_scale: Array,
    sr_bias: Array,
    snake: Snake,
    conv_t: CausalConvTranspose1d,
    res: [ResidualUnit; 3],
}

pub struct AudioVae {
    enc_conv_in: Conv,
    enc_blocks: Vec<EncoderBlock>,
    fc_mu: Conv,
    dec_conv_in: [Conv; 2],
    dec_blocks: Vec<DecoderBlock>,
    snake_out: Snake,
    conv_out: Conv,
    /// 编码一帧 latent 对应的输入样本数（16 kHz 下 640）。
    pub hop: usize,
    /// 解码一帧 latent 产出的输出样本数（48 kHz 下 1920）。
    pub decode_hop: usize,
    pub latent_dim: usize,
    pub sample_rate: u32,
    pub out_sample_rate: u32,
}

impl AudioVae {
    /// `weights` 是去掉 `audio_vae.` 前缀后的子集。
    pub fn load(weights: &mut Weights, config: &AudioVaeConfig) -> Result<Self> {
        let enc_conv_in = Conv::load(weights, "encoder.conv_in", 1, 1, 3, 0, 1)?;
        let mut enc_blocks = Vec::new();
        let mut dim = config.encoder_dim as i32;
        for (i, &stride) in config.encoder_rates.iter().enumerate() {
            let stride = stride as i32;
            let p = format!("encoder.blocks.layers.{i}");
            let groups = if config.depthwise { dim } else { 1 };
            enc_blocks.push(EncoderBlock {
                res: residual_triple(weights, &p, groups)?,
                snake: Snake::load(weights, &format!("{p}.snake"))?,
                conv: Conv::load(weights, &format!("{p}.conv"), stride, 1, (stride + 1) / 2, stride % 2, 1)?,
            });
            dim *= 2;
        }
        let fc_mu = Conv::load(weights, "encoder.fc_mu", 1, 1, 1, 0, 1)?;

        let latent = config.latent_dim as i32;
        let dec_conv_in = [
            Conv::load(
                weights,
                "decoder.conv_in.layers.0",
                1,
                1,
                3,
                0,
                if config.depthwise { latent } else { 1 },
            )?,
            Conv::load(weights, "decoder.conv_in.layers.1", 1, 1, 0, 0, 1)?,
        ];
        let sr_index = config.sr_bin_boundaries.iter().filter(|&&b| config.out_sample_rate >= b).count() as i32;
        let mut dec_blocks = Vec::new();
        for (i, &stride) in config.decoder_rates.iter().enumerate() {
            let stride = stride as i32;
            let input = (config.decoder_dim >> i) as i32;
            let output = (config.decoder_dim >> (i + 1)) as i32;
            let p = format!("decoder.blocks.layers.{i}");
            let row = |weights: &mut Weights, key: &str| -> Result<Array> {
                let table = take_f32(weights, &format!("decoder.sr_cond_layers.{i}.{key}.weight"))?.reshape(&[-1, input])?;
                Ok(table.index((sr_index..sr_index + 1, ..)).reshape(&[1, 1, input])?)
            };
            let sr_scale = row(weights, "scale_embed")?;
            let sr_bias = row(weights, "bias_embed")?;
            let weight = take_f32(weights, &format!("{p}.conv_t.weight"))?;
            let bias = weights
                .take_optional(&format!("{p}.conv_t.bias"))
                .map(|b| b.as_dtype(Dtype::Float32))
                .transpose()?;
            ensure!(weight.dim(1) == 2 * stride, "AudioVAE 解码块 {i} 转置卷积核应为 2×stride");
            dec_blocks.push(DecoderBlock {
                sr_scale,
                sr_bias,
                snake: Snake::load(weights, &format!("{p}.snake"))?,
                // 右侧裁 `2·ceil(s/2) − s%2 = s` 个样本，与核长 − stride 相同。
                conv_t: CausalConvTranspose1d::new(weight, bias, stride),
                res: residual_triple(weights, &p, if config.depthwise { output } else { 1 })?,
            });
        }
        let snake_out = Snake::load(weights, "decoder.snake_out")?;
        let conv_out = Conv::load(weights, "decoder.conv_out", 1, 1, 3, 0, 1)?;
        // 仅 Swift 端用来算 sr 下标的常量；这里已按配置算好。
        let _ = weights.take_optional("decoder._sr_boundaries");
        Ok(Self {
            enc_conv_in,
            enc_blocks,
            fc_mu,
            dec_conv_in,
            dec_blocks,
            snake_out,
            conv_out,
            hop: config.encoder_rates.iter().product(),
            decode_hop: config.decoder_rates.iter().product(),
            latent_dim: config.latent_dim,
            sample_rate: config.sample_rate,
            out_sample_rate: config.out_sample_rate,
        })
    }

    /// `[B, T, 1]` 16 kHz 波形（T 已是 `hop` 的整数倍）→ `[B, T/hop, latent]`。
    pub fn encode(&self, x: &Array) -> Result<Array> {
        let mut h = self.enc_conv_in.forward(x)?;
        for block in &self.enc_blocks {
            for unit in &block.res {
                h = unit.forward(&h)?;
            }
            h = block.conv.forward(&block.snake.forward(&h)?)?;
        }
        self.fc_mu.forward(&h)
    }

    /// `[B, T, latent]` → `[B, T·decode_hop]` 输出采样率波形。
    pub fn decode(&self, z: &Array) -> Result<Array> {
        let mut h = z.clone();
        for conv in &self.dec_conv_in {
            h = conv.forward(&h)?;
        }
        for block in &self.dec_blocks {
            h = h.multiply(&block.sr_scale)?.add(&block.sr_bias)?;
            h = block.conv_t.forward(&block.snake.forward(&h)?)?;
            for unit in &block.res {
                h = unit.forward(&h)?;
            }
        }
        let h = self.conv_out.forward(&self.snake_out.forward(&h)?)?;
        let b = h.dim(0);
        Ok(ops::tanh(&h)?.reshape(&[b, -1])?)
    }
}
