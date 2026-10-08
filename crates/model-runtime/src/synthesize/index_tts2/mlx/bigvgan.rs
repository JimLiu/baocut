//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2BigVGAN.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! BigVGAN v2 声码器（对照 speech-swift `IndexTTS2BigVGAN.swift`）。
//!
//! 结构：`conv_pre`(80→1536, k7) → 6 级转置卷积上采样（4,4,2,2,2,2）×
//! 每级 3 个 AMPBlock1（核 3/7/11，膨胀 1/3/5）取平均 → `activation_post`
//! → `conv_post`(24→1, k7) → clamp [-1, 1]。抗混叠激活 `Activation1d`：
//! FIR 2 倍上采样 → SnakeBeta → FIR 2 倍下采样。所有权重先按 `weight_norm`
//! 融合成 f32；全程 `[B, T, C]` 布局。

use super::layers::Conv1d;
use super::weights::WeightMap;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype, ops};
use anyhow::Result;

const NUM_MELS: i32 = 80;
const INITIAL_CHANNELS: i32 = 1536;
const UPSAMPLE_RATES: [i32; 6] = [4, 4, 2, 2, 2, 2];
const UPSAMPLE_KERNELS: [i32; 6] = [8, 8, 4, 4, 4, 4];
const RESBLOCK_KERNELS: [i32; 3] = [3, 7, 11];
const DILATIONS: [i32; 3] = [1, 3, 5];
const FIR_FACTOR: i32 = 2;
/// SnakeBeta：`x + 1/(exp(beta)+1e-9) · sin²(x · exp(alpha))`。
struct SnakeBeta {
    alpha_exp: Array,
    beta_inv: Array,
}

impl SnakeBeta {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        let alpha = w.take_f32(&format!("{prefix}.alpha"))?;
        let beta = w.take_f32(&format!("{prefix}.beta"))?;
        let alpha_exp = ops::exp(&alpha)?;
        let beta_inv = ops::reciprocal(&(ops::exp(&beta)? + 1e-9f32))?;
        Ok(Self { alpha_exp, beta_inv })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let s = ops::sin(&(x * &self.alpha_exp))?;
        Ok((x + &self.beta_inv * (&s * &s)).as_dtype(x.dtype())?)
    }
}

/// 逐通道同一 FIR 核：以 depthwise 卷积实现（等价于 Swift 把通道折进 batch 的写法）。
struct FirFilter {
    /// `[C, K, 1]`
    weight: Array,
}

impl FirFilter {
    fn new(filter: &Array, channels: i32, gain: f32) -> Result<Self> {
        let kernel = filter.dim(-1);
        let flat = (filter.as_dtype(Dtype::Float32)? * gain).reshape(&[1, kernel, 1])?;
        let weight = ops::broadcast_to(&flat, &[channels, kernel, 1])?;
        Ok(Self { weight })
    }

    fn apply(&self, x: &Array, stride: i32) -> Result<Array> {
        let channels = x.dim(2);
        Ok(ops::conv1d(x, &self.weight, stride, 0, 1, channels)?)
    }
}

/// 时间轴复制填充。
fn replicate_pad_time(x: &Array, left: i32, right: i32) -> Result<Array> {
    if left == 0 && right == 0 {
        return Ok(x.clone());
    }
    let b = x.dim(0);
    let t = x.dim(1);
    let c = x.dim(2);
    let mut parts: Vec<Array> = Vec::with_capacity(3);
    if left > 0 {
        parts.push(ops::broadcast_to(&x.index((.., 0..1, ..)), &[b, left, c])?);
    }
    parts.push(x.clone());
    if right > 0 {
        parts.push(ops::broadcast_to(&x.index((.., (t - 1)..t, ..)), &[b, right, c])?);
    }
    let refs: Vec<&Array> = parts.iter().collect();
    Ok(ops::concatenate_axis(&refs, 1)?)
}

struct Activation1d {
    act: SnakeBeta,
    upsample: FirFilter,
    downsample: FirFilter,
    kernel: i32,
}

impl Activation1d {
    fn load(w: &mut WeightMap, prefix: &str, channels: i32) -> Result<Self> {
        let up = w.take(&format!("{prefix}.upsample.filter"))?;
        let down = w.take(&format!("{prefix}.downsample.lowpass.filter"))?;
        let kernel = up.dim(-1);
        Ok(Self {
            act: SnakeBeta::load(w, &format!("{prefix}.act"))?,
            upsample: FirFilter::new(&up, channels, FIR_FACTOR as f32)?,
            downsample: FirFilter::new(&down, channels, 1.0)?,
            kernel,
        })
    }

    fn fir_upsample(&self, x: &Array) -> Result<Array> {
        let kernel = self.kernel;
        let factor = FIR_FACTOR;
        let pad = kernel / factor - 1;
        let pad_left = pad * factor + (kernel - factor) / 2;
        let pad_right = pad * factor + (kernel - factor + 1) / 2;

        let padded = replicate_pad_time(x, pad, pad)?;
        let b = padded.dim(0);
        let t = padded.dim(1);
        let c = padded.dim(2);
        // 零插值：在时间维后插 factor-1 个零帧，再裁到 (T-1)·factor+1。
        let zeros = ops::zeros_like(&padded)?;
        let stretched = ops::stack_axis(&[&padded, &zeros], 2)?.reshape(&[b, t * factor, c])?;
        let trimmed = stretched.index((.., ..((t - 1) * factor + 1), ..));
        let conv_input = ops::pad(&trimmed, &[(0, 0), (kernel - 1, kernel - 1), (0, 0)], Array::from_f32(0.0), None)?;
        let out = self.upsample.apply(&conv_input, 1)?;
        let len = out.dim(1);
        Ok(out.index((.., pad_left..(len - pad_right), ..)))
    }

    fn fir_downsample(&self, x: &Array) -> Result<Array> {
        let kernel = self.kernel;
        let even = kernel % 2 == 0;
        let (pad_left, pad_right) = (kernel / 2 - if even { 1 } else { 0 }, kernel / 2);
        let padded = replicate_pad_time(x, pad_left, pad_right)?;
        self.downsample.apply(&padded, FIR_FACTOR)
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let h = self.fir_upsample(x)?;
        let h = self.act.forward(&h)?;
        self.fir_downsample(&h)
    }
}

struct AmpBlock1 {
    convs1: Vec<Conv1d>,
    convs2: Vec<Conv1d>,
    activations: Vec<Activation1d>,
}

impl AmpBlock1 {
    fn load(w: &mut WeightMap, prefix: &str, channels: i32, kernel: i32) -> Result<Self> {
        let mut convs1 = Vec::with_capacity(DILATIONS.len());
        let mut convs2 = Vec::with_capacity(DILATIONS.len());
        let mut activations = Vec::with_capacity(DILATIONS.len() * 2);
        for (i, &d) in DILATIONS.iter().enumerate() {
            convs1.push(
                Conv1d::load_weight_norm(w, &format!("{prefix}.convs1.{i}"))?
                    .with_dilation(d)
                    .with_padding((kernel * d - d) / 2),
            );
            convs2.push(Conv1d::load_weight_norm(w, &format!("{prefix}.convs2.{i}"))?.with_padding((kernel - 1) / 2));
        }
        for i in 0..DILATIONS.len() * 2 {
            activations.push(Activation1d::load(w, &format!("{prefix}.activations.{i}"), channels)?);
        }
        Ok(Self {
            convs1,
            convs2,
            activations,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let mut x = x.clone();
        for i in 0..self.convs1.len() {
            let h = self.activations[2 * i].forward(&x)?;
            let h = self.convs1[i].forward_nlc(&h)?;
            let h = self.activations[2 * i + 1].forward(&h)?;
            let h = self.convs2[i].forward_nlc(&h)?;
            x = &x + h;
        }
        Ok(x)
    }
}

/// 转置卷积；权重内部布局 `[Cout, K, Cin]`（f32）。
struct ConvTranspose1d {
    weight: Array,
    bias: Option<Array>,
    stride: i32,
    padding: i32,
}

impl ConvTranspose1d {
    fn load_weight_norm(w: &mut WeightMap, prefix: &str, stride: i32, padding: i32) -> Result<Self> {
        // PyTorch 布局 `[Cin, Cout, K]` → `[Cout, K, Cin]`。
        let weight = w.take_weight_norm(prefix)?.transpose_axes(&[1, 2, 0])?;
        let bias = w.take_optional_f32(&format!("{prefix}.bias"))?;
        Ok(Self {
            weight,
            bias,
            stride,
            padding,
        })
    }

    fn forward_nlc(&self, x: &Array) -> Result<Array> {
        let mut y = ops::conv_transpose1d(x, &self.weight, self.stride, self.padding, 1, 0, 1)?;
        if let Some(bias) = &self.bias {
            y = y + bias;
        }
        Ok(y)
    }
}

pub struct BigVgan {
    conv_pre: Conv1d,
    ups: Vec<ConvTranspose1d>,
    resblocks: Vec<AmpBlock1>,
    activation_post: Activation1d,
    conv_post: Conv1d,
    input_channels: i32,
}

impl BigVgan {
    pub fn load(mut w: WeightMap) -> Result<Self> {
        w.retain_prefix("generator.");
        Self::load_arch(w, NUM_MELS, &UPSAMPLE_RATES, &UPSAMPLE_KERNELS)
    }

    fn load_arch(mut w: WeightMap, input_channels: i32, rates: &[i32; 6], kernels: &[i32; 6]) -> Result<Self> {
        let conv_pre = Conv1d::load_weight_norm(&mut w, "conv_pre")?.with_padding(3);
        let mut ups = Vec::with_capacity(rates.len());
        let mut resblocks = Vec::with_capacity(rates.len() * RESBLOCK_KERNELS.len());
        for (i, (&rate, &kernel)) in rates.iter().zip(kernels.iter()).enumerate() {
            ups.push(ConvTranspose1d::load_weight_norm(
                &mut w,
                &format!("ups.{i}.0"),
                rate,
                (kernel - rate) / 2,
            )?);
            let channels = INITIAL_CHANNELS >> (i + 1);
            for (j, &k) in RESBLOCK_KERNELS.iter().enumerate() {
                let index = i * RESBLOCK_KERNELS.len() + j;
                resblocks.push(AmpBlock1::load(&mut w, &format!("resblocks.{index}"), channels, k)?);
            }
        }
        let last_channels = INITIAL_CHANNELS >> rates.len();
        let activation_post = Activation1d::load(&mut w, "activation_post", last_channels)?;
        let conv_post = Conv1d::load_weight_norm(&mut w, "conv_post")?.with_padding(3);
        Ok(Self {
            conv_pre,
            ups,
            resblocks,
            activation_post,
            conv_post,
            input_channels,
        })
    }

    /// 输入梅尔谱 `[B, T, 80]`，输出波形 `[B, T·256]`。
    pub fn forward(&self, mel: &Array) -> Result<Array> {
        debug_assert_eq!(mel.dim(2), self.input_channels);
        let dtype = self.conv_pre.weight.dtype();
        let mut x = self.conv_pre.forward_nlc(&mel.as_dtype(dtype)?)?;
        let n = RESBLOCK_KERNELS.len();
        for (i, up) in self.ups.iter().enumerate() {
            let started = std::time::Instant::now();
            x = up.forward_nlc(&x)?;
            let mut acc: Option<Array> = None;
            for block in &self.resblocks[i * n..(i + 1) * n] {
                let h = block.forward(&x)?;
                acc = Some(match acc {
                    Some(a) => a + h,
                    None => h,
                });
            }
            x = acc
                .expect("至少一个 resblock")
                .divide(&Array::from_f32(n as f32).as_dtype(dtype)?)?;
            x.eval()?;
            if crate::synthesize::tensor::host::speech_timing_enabled() {
                eprintln!("[bigvgan] stage={i} shape={:?} {:.3}s", x.shape(), started.elapsed().as_secs_f64());
            }
        }
        let x = self.activation_post.forward(&x)?;
        let x = self.conv_post.forward_nlc(&x)?;
        let x = ops::clip(&x, (-1.0f32, 1.0f32))?;
        let x = x.squeeze_axes(&[-1])?;
        x.eval()?;
        Ok(x)
    }
}
