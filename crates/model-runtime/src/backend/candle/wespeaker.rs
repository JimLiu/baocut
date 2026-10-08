//! WeSpeaker ResNet34-LM 声纹嵌入（跨平台 candle 后端）。
//!
//! fbank 前端、形状常量与余弦距离共用 [`crate::speech::wespeaker_fbank`]，与 MLX 后端
//! 逐值一致；这里只是同一个 ResNet34 主干的 candle 实现。v3 只改边界（同 MLX）：权重按模型包清单取
//! （[`VerifiedFiles`]），不扫描目录。
//!
//! 布局差异是移植的全部难点：模型仓库的卷积权重按 mlx-rs Conv2d 的原生 NHWC
//! 布局 `[O, kH, kW, Cin]` 存放，candle 要 `[O, Cin, kH, kW]`；激活也从 MLX 的
//! `[B, H, W, C]` 换成 candle 的 `[B, C, H, W]`。统计池化前的展平顺序必须仍是
//! C·F（见 `forward`），否则嵌入依然是 256 维、依然归一化，只是数值全错。

use anyhow::{Result, bail};
use candle_core::{D, Device, Tensor};

use super::weights::WeightStore;
use crate::bundle::VerifiedFiles;
use crate::speech::SpeakerEmbedding;
pub use crate::speech::wespeaker_fbank::{
    EMBEDDING_DIM, HOP_LENGTH, MINIMUM_SAMPLES, N_FFT, N_MELS, POOLED_FREQUENCY, POOLING_OUTPUT_DIM, RESNET_PLAN, SAMPLE_RATE,
    WeSpeakerFbank, cosine_distance,
};

struct Conv2d {
    weight: Tensor,
    bias: Tensor,
    stride: usize,
    padding: usize,
}

impl Conv2d {
    fn load(
        store: &mut WeightStore,
        prefix: &str,
        input_channels: usize,
        output_channels: usize,
        kernel: usize,
        stride: usize,
        padding: usize,
    ) -> Result<Self> {
        let weight = store.take_f32(&format!("{prefix}.weight"))?;
        let bias = store.take_f32(&format!("{prefix}.bias"))?;
        expect_shape(
            &format!("{prefix}.weight"),
            &weight,
            &[output_channels, kernel, kernel, input_channels],
        )?;
        expect_shape(&format!("{prefix}.bias"), &bias, &[output_channels])?;
        Ok(Self {
            // NHWC `[O, kH, kW, Cin]` → candle NCHW `[O, Cin, kH, kW]`。
            // `contiguous()` 在这里既是性能也是正确性要求：candle 0.11 的 CPU 卷积走 im2col 时，非连续的
            // kernel 会被按原始字节当成目标布局读（整理出的连续拷贝没有被用上），结果静默读错。
            weight: weight.permute((0, 3, 1, 2))?.contiguous()?,
            bias,
            stride,
            padding,
        })
    }

    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let output = input.conv2d(&self.weight, self.padding, self.stride, 1, 1)?;
        Ok(output.broadcast_add(&self.bias.reshape((1, self.bias.elem_count(), 1, 1))?)?)
    }
}

/// BN 已折叠进卷积的 ResNet BasicBlock：两个带 bias 的 3×3 卷积，
/// stride≠1 或通道变化时 residual 走 1×1 shortcut 卷积（同样带 bias）。
struct BasicBlock {
    conv1: Conv2d,
    conv2: Conv2d,
    shortcut: Option<Conv2d>,
}

impl BasicBlock {
    fn load(store: &mut WeightStore, prefix: &str, input_channels: usize, output_channels: usize, stride: usize) -> Result<Self> {
        Ok(Self {
            conv1: Conv2d::load(store, &format!("{prefix}.conv1"), input_channels, output_channels, 3, stride, 1)?,
            conv2: Conv2d::load(store, &format!("{prefix}.conv2"), output_channels, output_channels, 3, 1, 1)?,
            shortcut: if stride != 1 || input_channels != output_channels {
                Some(Conv2d::load(
                    store,
                    &format!("{prefix}.shortcut"),
                    input_channels,
                    output_channels,
                    1,
                    stride,
                    0,
                )?)
            } else {
                None
            },
        })
    }

    fn forward(&self, x: &Tensor) -> Result<Tensor> {
        let mut out = self.conv1.forward(x)?.relu()?;
        out = self.conv2.forward(&out)?;
        let residual = match &self.shortcut {
            Some(shortcut) => shortcut.forward(x)?,
            None => x.clone(),
        };
        Ok((out + residual)?.relu()?)
    }
}

struct Linear {
    weight: Tensor,
    bias: Tensor,
}

impl Linear {
    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        Ok(input.matmul(&self.weight.t()?.contiguous()?)?.broadcast_add(&self.bias)?)
    }
}

struct WeSpeakerNetwork {
    conv1: Conv2d,
    layers: Vec<Vec<BasicBlock>>,
    embedding: Linear,
}

impl WeSpeakerNetwork {
    fn load(store: &mut WeightStore) -> Result<Self> {
        let conv1 = Conv2d::load(store, "conv1", 1, 32, 3, 1, 1)?;
        let mut layers = Vec::with_capacity(RESNET_PLAN.len());
        for (index, input_channels, output_channels, block_count) in RESNET_PLAN {
            let mut blocks = Vec::with_capacity(block_count);
            for block in 0..block_count {
                let first = block == 0;
                blocks.push(BasicBlock::load(
                    store,
                    &format!("layer{index}.{block}"),
                    if first { input_channels } else { output_channels },
                    output_channels,
                    if first && input_channels != output_channels { 2 } else { 1 },
                )?);
            }
            layers.push(blocks);
        }
        let weight = store.take_f32("embedding.weight")?;
        let bias = store.take_f32("embedding.bias")?;
        expect_shape("embedding.weight", &weight, &[EMBEDDING_DIM, POOLING_OUTPUT_DIM])?;
        expect_shape("embedding.bias", &bias, &[EMBEDDING_DIM])?;
        Ok(Self {
            conv1,
            layers,
            embedding: Linear { weight, bias },
        })
    }

    /// `mel`：`[1, T, 80]`；返回 `[1, 256]` 的 L2 归一化嵌入。
    fn forward(&self, mel: &Tensor) -> Result<Tensor> {
        // Python WeSpeaker 的输入编排是 (B,T,F) → (B,F,T) → (B,1,F,T)：
        // 频率进 H、时间进 W、通道数 1。candle 本来就是 NCHW，直接 unsqueeze。
        let mut x = mel.transpose(1, 2)?.unsqueeze(1)?.contiguous()?;
        x = self.conv1.forward(&x)?.relu()?;
        for layer in &self.layers {
            for block in layer {
                x = block.forward(&x)?;
            }
        }
        // x: [B, C=256, F'=10, T'=T/8]，与 Python 的张量布局完全一致。
        let shape = x.dims().to_vec();
        if shape.len() != 4 || shape[2] != POOLED_FREQUENCY {
            bail!("WeSpeaker 主干输出形状异常：{shape:?}");
        }
        let (batch, time) = (shape[0], shape[3]);
        if time < 1 {
            bail!("WeSpeaker 池化前时间轴为空");
        }
        // 展平顺序必须是 C·F（Python reshape [B,256,10,T'] → [B,2560,T']），
        // 之后换到时间主序 [B, T', 2560] 以便沿时间轴统计池化。
        x = x
            .contiguous()?
            .reshape((batch, POOLING_OUTPUT_DIM / 2, time))?
            .transpose(1, 2)?
            .contiguous()?;

        // 统计池化（沿时间轴）：手算 E[x²]-E[x]² 并夹到 ≥0，与 MLX 侧同式。
        let mean = x.mean(1)?;
        let mean_square = x.sqr()?.mean(1)?;
        let variance = (mean_square - mean.sqr()?)?.maximum(0.0_f64)?;
        let deviation = (variance + 1e-10)?.sqrt()?;
        let pooled = Tensor::cat(&[&mean, &deviation], D::Minus1)?;

        let embedding = self.embedding.forward(&pooled)?;
        let norm = (embedding.sqr()?.sum_keepdim(D::Minus1)? + 1e-10)?.sqrt()?;
        Ok(embedding.broadcast_div(&norm)?)
    }
}

/// WeSpeaker ResNet34-LM 声纹嵌入器。
pub struct WeSpeakerEmbedder {
    fbank: WeSpeakerFbank,
    network: WeSpeakerNetwork,
    device: Device,
}

impl WeSpeakerEmbedder {
    /// 从 `speaker` 组件的文件加载：目录顶层的全部 safetensors 分片。
    pub fn load(files: &VerifiedFiles, device: &Device) -> Result<Self> {
        let shards = files.require_extension_in("", "safetensors")?;
        let mut store = WeightStore::load(&shards, device)?;
        let network = WeSpeakerNetwork::load(&mut store)?;
        let unused = store.remaining();
        if !unused.is_empty() {
            bail!("WeSpeaker 存在未使用权重：{}", unused.join("、"));
        }
        Ok(Self {
            fbank: WeSpeakerFbank::new(),
            network,
            device: device.clone(),
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
        let features = self.fbank.extract(samples)?;
        let mel = Tensor::from_slice(&features.data, (1, features.time_frames, N_MELS), &self.device)?;
        let embedding = self.network.forward(&mel)?;
        let values = embedding.flatten_all()?.to_vec1::<f32>()?;
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

fn expect_shape(key: &str, tensor: &Tensor, expected: &[usize]) -> Result<()> {
    if tensor.dims() != expected {
        bail!("WeSpeaker 权重 {key} 形状为 {:?}，期望 {expected:?}", tensor.dims());
    }
    Ok(())
}
