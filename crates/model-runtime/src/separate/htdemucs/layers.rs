//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/SourceSeparation/HTDemucs/HTDemucsLayers.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! HTDemucs 的卷积 / 编码器 / 解码器构件，逐一对照 speech-swift `HTDemucsLayers.swift`
//! 与 `DemucsPrimitives.swift`。
//!
//! 张量沿用 demucs 的 channels-first 布局（NCL / NCHW）；MLX 卷积是 channels-last，
//! 所以每个卷积前后各转置一次。htdemucs 的 `norm_starts == depth`，HEnc/HDec 里没有
//! GroupNorm，只有 DConv 带 GroupNorm。权重文件已是 MLX 布局：Conv1d `[C_out, K, C_in]`、
//! Conv2d `[C_out, H, W, C_in]`、转置卷积同形（`C_out` 在前）。

use super::tensor::ops::indexing::IndexOp;
use super::tensor::{Array, gelu_same_dtype, nn, ops};
use super::weights::WeightStore;
use anyhow::{Result, bail};

/// 通道维上的 GLU：前一半 × sigmoid(后一半)，对应 PyTorch `F.glu`。
pub fn glu_axis1(x: &Array) -> Result<Array> {
    let halves = ops::split(x, 2, 1)?;
    let gate = nn::sigmoid(&halves[1])?;
    Ok(halves[0].multiply(&gate)?)
}

pub fn gelu(x: &Array) -> Result<Array> {
    gelu_same_dtype(x)
}

/// Conv1d（channels-first 输入 `[N, C, L]`）。
pub struct Conv1dW {
    weight: Array,
    bias: Array,
    stride: i32,
    padding: i32,
    dilation: i32,
}

impl Conv1dW {
    #[allow(clippy::too_many_arguments)]
    pub fn load(
        store: &mut WeightStore,
        prefix: &str,
        chin: i32,
        chout: i32,
        kernel: i32,
        stride: i32,
        padding: i32,
        dilation: i32,
    ) -> Result<Self> {
        let weight = store.take_shape(&format!("{prefix}.weight"), &[chout, kernel, chin])?;
        let bias = store.take_shape(&format!("{prefix}.bias"), &[chout])?;
        Ok(Self {
            weight,
            bias,
            stride,
            padding,
            dilation,
        })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let nlc = x.transpose_axes(&[0, 2, 1])?;
        let y = ops::conv1d(&nlc, &self.weight, self.stride, self.padding, self.dilation, 1)?;
        Ok(y.add(&self.bias)?.transpose_axes(&[0, 2, 1])?)
    }
}

/// Conv2d（channels-first 输入 `[N, C, H, W]`，H 是频率轴、W 是时间轴）。
pub struct Conv2dW {
    weight: Array,
    bias: Array,
    stride: (i32, i32),
    padding: (i32, i32),
}

impl Conv2dW {
    pub fn load(
        store: &mut WeightStore,
        prefix: &str,
        chin: i32,
        chout: i32,
        kernel: (i32, i32),
        stride: (i32, i32),
        padding: (i32, i32),
    ) -> Result<Self> {
        let weight = store.take_shape(&format!("{prefix}.weight"), &[chout, kernel.0, kernel.1, chin])?;
        let bias = store.take_shape(&format!("{prefix}.bias"), &[chout])?;
        Ok(Self {
            weight,
            bias,
            stride,
            padding,
        })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let nhwc = x.transpose_axes(&[0, 2, 3, 1])?;
        let y = ops::conv2d(&nhwc, &self.weight, self.stride, self.padding, (1, 1), 1)?;
        Ok(y.add(&self.bias)?.transpose_axes(&[0, 3, 1, 2])?)
    }
}

/// ConvTranspose1d（channels-first，无 padding）。
pub struct ConvT1dW {
    weight: Array,
    bias: Array,
    stride: i32,
}

impl ConvT1dW {
    pub fn load(store: &mut WeightStore, prefix: &str, chin: i32, chout: i32, kernel: i32, stride: i32) -> Result<Self> {
        let weight = store.take_shape(&format!("{prefix}.weight"), &[chout, kernel, chin])?;
        let bias = store.take_shape(&format!("{prefix}.bias"), &[chout])?;
        Ok(Self { weight, bias, stride })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let nlc = x.transpose_axes(&[0, 2, 1])?;
        let y = ops::conv_transpose1d(&nlc, &self.weight, self.stride, 0, 1, 0, 1)?;
        Ok(y.add(&self.bias)?.transpose_axes(&[0, 2, 1])?)
    }
}

/// ConvTranspose2d（channels-first，无 padding）。
pub struct ConvT2dW {
    weight: Array,
    bias: Array,
    stride: (i32, i32),
}

impl ConvT2dW {
    pub fn load(store: &mut WeightStore, prefix: &str, chin: i32, chout: i32, kernel: (i32, i32), stride: (i32, i32)) -> Result<Self> {
        let weight = store.take_shape(&format!("{prefix}.weight"), &[chout, kernel.0, kernel.1, chin])?;
        let bias = store.take_shape(&format!("{prefix}.bias"), &[chout])?;
        Ok(Self { weight, bias, stride })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let nhwc = x.transpose_axes(&[0, 2, 3, 1])?;
        let y = ops::conv_transpose2d(&nhwc, &self.weight, self.stride, (0, 0), (1, 1), (0, 0), 1)?;
        Ok(y.add(&self.bias)?.transpose_axes(&[0, 3, 1, 2])?)
    }
}

/// 频域 / 时域两种卷积的统一封装。
pub enum ConvAny {
    Freq(Conv2dW),
    Time(Conv1dW),
}

impl ConvAny {
    pub fn forward(&self, x: &Array) -> Result<Array> {
        match self {
            ConvAny::Freq(c) => c.forward(x),
            ConvAny::Time(c) => c.forward(x),
        }
    }
}

pub enum ConvTAny {
    Freq(ConvT2dW),
    Time(ConvT1dW),
}

impl ConvTAny {
    pub fn forward(&self, x: &Array) -> Result<Array> {
        match self {
            ConvTAny::Freq(c) => c.forward(x),
            ConvTAny::Time(c) => c.forward(x),
        }
    }
}

/// `x * scale`（逐通道）。`channel_last` 为假时按 `[B, C, T]` 广播（DConv），
/// 为真时按 `[B, ..., C]` 广播（transformer 的 gamma）。
pub struct LayerScale {
    scale: Array,
    channel_last: bool,
}

impl LayerScale {
    pub fn load(store: &mut WeightStore, prefix: &str, channels: i32, channel_last: bool) -> Result<Self> {
        let scale = store.take_shape(&format!("{prefix}.scale"), &[channels])?;
        let scale = if channel_last { scale } else { scale.reshape(&[1, channels, 1])? };
        Ok(Self { scale, channel_last })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let _ = self.channel_last;
        Ok(x.multiply(&self.scale)?)
    }
}

/// `nn.GroupNorm(1, C)` 作用在 channels-first `[B, C, L]`：每个样本在 (C, L) 上统计。
pub struct GroupNormNCL {
    weight: Array,
    bias: Array,
    eps: f32,
}

impl GroupNormNCL {
    pub fn load(store: &mut WeightStore, prefix: &str, channels: i32) -> Result<Self> {
        let weight = store
            .take_shape(&format!("{prefix}.weight"), &[channels])?
            .reshape(&[1, channels, 1])?;
        let bias = store
            .take_shape(&format!("{prefix}.bias"), &[channels])?
            .reshape(&[1, channels, 1])?;
        Ok(Self { weight, bias, eps: 1e-5 })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let mean = x.mean_axes(&[1, 2], true)?;
        let var = x.var_axes(&[1, 2], true, 0)?;
        let normalized = x.subtract(&mean)?.multiply(&ops::rsqrt(&var.add(Array::from_f32(self.eps))?)?)?;
        Ok(normalized.multiply(&self.weight)?.add(&self.bias)?)
    }
}

/// DConv 的一个残差块：`[conv(k3, dilation), GN, gelu, conv1x1 → 2C, GN, glu, LayerScale]`。
struct DConvBlock {
    conv1: Conv1dW,
    norm1: GroupNormNCL,
    conv2: Conv1dW,
    norm2: GroupNormNCL,
    scale: LayerScale,
}

/// 残差膨胀卷积分支，作用在 channels-first `[B, C, T]`。
pub struct DConv {
    blocks: Vec<DConvBlock>,
}

impl DConv {
    pub fn load(store: &mut WeightStore, prefix: &str, channels: i32, depth: usize, compress: i32) -> Result<Self> {
        let hidden = channels / compress;
        let kernel = 3;
        let mut blocks = Vec::with_capacity(depth);
        for d in 0..depth {
            let dilation = 1 << d;
            let p = format!("{prefix}.layers.{d}");
            blocks.push(DConvBlock {
                conv1: Conv1dW::load(
                    store,
                    &format!("{p}.0"),
                    channels,
                    hidden,
                    kernel,
                    1,
                    dilation * (kernel / 2),
                    dilation,
                )?,
                norm1: GroupNormNCL::load(store, &format!("{p}.1"), hidden)?,
                conv2: Conv1dW::load(store, &format!("{p}.3"), hidden, 2 * channels, 1, 1, 0, 1)?,
                norm2: GroupNormNCL::load(store, &format!("{p}.4"), 2 * channels)?,
                scale: LayerScale::load(store, &format!("{p}.6"), channels, false)?,
            });
        }
        Ok(Self { blocks })
    }

    pub fn forward(&self, x0: &Array) -> Result<Array> {
        let mut x = x0.clone();
        for b in &self.blocks {
            let mut y = b.conv1.forward(&x)?;
            y = gelu(&b.norm1.forward(&y)?)?;
            y = b.conv2.forward(&y)?;
            y = b.norm2.forward(&y)?;
            y = glu_axis1(&y)?;
            y = b.scale.forward(&y)?;
            x = x.add(&y)?;
        }
        Ok(x)
    }
}

/// 频域层把 `[B, C, Fr, T]` 折成 `[B*Fr, C, T]` 跑 DConv 再折回。
fn dconv_over_freq(dconv: &DConv, y: &Array, freq: bool) -> Result<Array> {
    if !freq {
        return dconv.forward(y);
    }
    let (b, c, fr, t) = (y.dim(0), y.dim(1), y.dim(2), y.dim(3));
    let folded = y.transpose_axes(&[0, 2, 1, 3])?.reshape(&[b * fr, c, t])?;
    let out = dconv.forward(&folded)?;
    Ok(out.reshape(&[b, fr, c, t])?.transpose_axes(&[0, 2, 1, 3])?)
}

/// 混合编码器层：`freq` 为真时沿 (freq, time) 做 Conv2d，否则沿 time 做 Conv1d。
/// 本移植只覆盖 `empty == false`（htdemucs_ft 频率轴不会塌到 1，没有 inject 合并层）。
pub struct HEncLayer {
    freq: bool,
    stride: i32,
    conv: ConvAny,
    rewrite: Option<ConvAny>,
    dconv: Option<DConv>,
}

pub struct HEncSpec<'a> {
    pub prefix: &'a str,
    pub chin: i32,
    pub chout: i32,
    pub kernel: i32,
    pub stride: i32,
    pub pad: i32,
    pub freq: bool,
    pub rewrite: bool,
    pub context: i32,
    pub dconv: Option<(usize, i32)>,
}

impl HEncLayer {
    pub fn load(store: &mut WeightStore, spec: &HEncSpec<'_>) -> Result<Self> {
        let conv_key = format!("{}.conv", spec.prefix);
        let conv = if spec.freq {
            ConvAny::Freq(Conv2dW::load(
                store,
                &conv_key,
                spec.chin,
                spec.chout,
                (spec.kernel, 1),
                (spec.stride, 1),
                (spec.pad, 0),
            )?)
        } else {
            ConvAny::Time(Conv1dW::load(
                store,
                &conv_key,
                spec.chin,
                spec.chout,
                spec.kernel,
                spec.stride,
                spec.pad,
                1,
            )?)
        };
        let rewrite = if spec.rewrite {
            let k = 1 + 2 * spec.context;
            let key = format!("{}.rewrite", spec.prefix);
            Some(if spec.freq {
                ConvAny::Freq(Conv2dW::load(
                    store,
                    &key,
                    spec.chout,
                    2 * spec.chout,
                    (k, 1),
                    (1, 1),
                    (spec.context, 0),
                )?)
            } else {
                ConvAny::Time(Conv1dW::load(store, &key, spec.chout, 2 * spec.chout, k, 1, spec.context, 1)?)
            })
        } else {
            None
        };
        let dconv = match spec.dconv {
            Some((depth, compress)) => Some(DConv::load(store, &format!("{}.dconv", spec.prefix), spec.chout, depth, compress)?),
            None => None,
        };
        Ok(Self {
            freq: spec.freq,
            stride: spec.stride,
            conv,
            rewrite,
            dconv,
        })
    }

    pub fn forward(&self, x0: &Array) -> Result<Array> {
        let mut x = x0.clone();
        if !self.freq {
            if x.ndim() == 4 {
                let (b, t) = (x.dim(0), x.dim(3));
                x = x.reshape(&[b, -1, t])?;
            }
            let le = x.dim(-1);
            if le % self.stride != 0 {
                let extra = self.stride - le % self.stride;
                x = ops::pad(&x, &[(0, 0), (0, 0), (0, extra)], None, None)?;
            }
        }
        let mut y = self.conv.forward(&x)?;
        y = gelu(&y)?; // norm1 == Identity
        if let Some(dconv) = &self.dconv {
            y = dconv_over_freq(dconv, &y, self.freq)?;
        }
        if let Some(rewrite) = &self.rewrite {
            return glu_axis1(&rewrite.forward(&y)?); // norm2 == Identity
        }
        Ok(y)
    }
}

/// 混合解码器层：转置卷积镜像 `HEncLayer`。
pub struct HDecLayer {
    freq: bool,
    last: bool,
    pad: i32,
    chin: i32,
    conv_tr: ConvTAny,
    rewrite: Option<ConvAny>,
    dconv: Option<DConv>,
}

pub struct HDecSpec<'a> {
    pub prefix: &'a str,
    pub chin: i32,
    pub chout: i32,
    pub kernel: i32,
    pub stride: i32,
    pub pad: i32,
    pub last: bool,
    pub freq: bool,
    pub rewrite: bool,
    pub context: i32,
    pub dconv: Option<(usize, i32)>,
}

impl HDecLayer {
    pub fn load(store: &mut WeightStore, spec: &HDecSpec<'_>) -> Result<Self> {
        let key = format!("{}.conv_tr", spec.prefix);
        let conv_tr = if spec.freq {
            ConvTAny::Freq(ConvT2dW::load(
                store,
                &key,
                spec.chin,
                spec.chout,
                (spec.kernel, 1),
                (spec.stride, 1),
            )?)
        } else {
            ConvTAny::Time(ConvT1dW::load(store, &key, spec.chin, spec.chout, spec.kernel, spec.stride)?)
        };
        let rewrite = if spec.rewrite {
            let k = 1 + 2 * spec.context;
            let key = format!("{}.rewrite", spec.prefix);
            // 解码器的 rewrite 是方形 (k, k) 卷积、(context, context) padding。
            Some(if spec.freq {
                ConvAny::Freq(Conv2dW::load(
                    store,
                    &key,
                    spec.chin,
                    2 * spec.chin,
                    (k, k),
                    (1, 1),
                    (spec.context, spec.context),
                )?)
            } else {
                ConvAny::Time(Conv1dW::load(store, &key, spec.chin, 2 * spec.chin, k, 1, spec.context, 1)?)
            })
        } else {
            None
        };
        let dconv = match spec.dconv {
            Some((depth, compress)) => Some(DConv::load(store, &format!("{}.dconv", spec.prefix), spec.chin, depth, compress)?),
            None => None,
        };
        Ok(Self {
            freq: spec.freq,
            last: spec.last,
            pad: spec.pad,
            chin: spec.chin,
            conv_tr,
            rewrite,
            dconv,
        })
    }

    /// 返回 `(输出, pre)`：`pre` 是送进转置卷积的张量（频 / 时分支分叉时用）。
    pub fn forward(&self, x0: &Array, skip: Option<&Array>, length: i32) -> Result<(Array, Array)> {
        let mut x = x0.clone();
        if self.freq && x.ndim() == 3 {
            let (b, t) = (x.dim(0), x.dim(2));
            x = x.reshape(&[b, self.chin, -1, t])?;
        }
        if let Some(skip) = skip {
            x = x.add(skip)?;
        }
        let mut y = match &self.rewrite {
            Some(rewrite) => glu_axis1(&rewrite.forward(&x)?)?, // norm1 == Identity
            None => x,
        };
        if let Some(dconv) = &self.dconv {
            y = dconv_over_freq(dconv, &y, self.freq)?;
        }
        let mut z = self.conv_tr.forward(&y)?; // norm2 == Identity
        if self.freq {
            if self.pad > 0 {
                let h = z.dim(2);
                z = z.index((.., .., self.pad..h - self.pad, ..));
            }
        } else {
            let l = z.dim(2);
            if self.pad + length > l {
                bail!("时域解码输出长度 {l} 不足以裁出 [{}, +{length})", self.pad);
            }
            z = z.index((.., .., self.pad..self.pad + length));
        }
        if !self.last {
            z = gelu(&z)?;
        }
        Ok((z, y))
    }
}
