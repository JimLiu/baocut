//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/OmniVoiceTTS/OmniVoiceCodec.swift / Sources/OmniVoiceTTS/OmniVoiceCodecEncoder.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Higgs Audio v2 音频分词器（OmniVoice 的 `audio_tokenizer/`）：24 kHz 波形 ↔ 8 码本
//! 25 Hz token。对照 transformers `HiggsAudioV2TokenizerModel`（`encode` / `decode`）、
//! `DacEncoder` / `DacDecoder`（改过的：转置卷积 `output_padding = stride % 2`、去掉 tanh）
//! 与 `HubertModel`（group-norm 特征提取 + post-norm 编码层）。
//!
//! 全部走通道在后（`[B, T, C]`）布局。权重是 PyTorch 布局的 F16，加载时一律转 F32 并把卷积核
//! 转成 `[out, k, in]`；HuBERT 位置卷积的 weight-norm 在加载时合成。
//! 转置卷积按「全长计算后切 `[ceil(s/2), +L·s)`」实现，与 PyTorch 的 `padding = ceil(s/2)`、
//! `output_padding = s % 2` 逐样本等价，也不依赖两个后端 `padding` 语义是否一致。
//!
//! `decoder_semantic.*`、`fc1.*` 只在训练时用；码本的 `cluster_size` / `embed_avg` / `inited`
//! 是 EMA 统计量：加载时取走丢弃，免得算作未使用的权重。

use crate::synthesize::qwen3_tts::layers::Linear;
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::fast;
use crate::synthesize::tensor::gelu_same_dtype;
use crate::synthesize::tensor::ops;
use crate::synthesize::tensor::ops::indexing::{IndexOp, argmax_axis};
use crate::synthesize::tensor::{Array, Dtype};
use anyhow::{Result, ensure};

use super::config::CodecConfig;

fn f32_weight(weights: &mut Weights, key: &str) -> Result<Array> {
    Ok(weights.take(key)?.as_dtype(Dtype::Float32)?)
}

fn f32_optional(weights: &mut Weights, key: &str) -> Result<Option<Array>> {
    weights
        .take_optional(key)
        .map(|w| w.as_dtype(Dtype::Float32))
        .transpose()
        .map_err(Into::into)
}

fn dense(weights: &mut Weights, prefix: &str) -> Result<Linear> {
    Ok(Linear::Float {
        weight: f32_weight(weights, &format!("{prefix}.weight"))?,
        bias: f32_optional(weights, &format!("{prefix}.bias"))?,
    })
}

/// `x > 0 ? x : exp(x) − 1`（`nn.ELU`，α = 1）。
fn elu(x: &Array) -> Result<Array> {
    let negative = x.exp()?.subtract(Array::from_f32(1.0))?;
    Ok(ops::which(&x.gt(&Array::from_f32(0.0))?, x, &negative)?)
}

/// 带对称补零的 Conv1d（PyTorch `nn.Conv1d(padding=p)`）。
struct Conv {
    weight: Array,
    bias: Option<Array>,
    stride: i32,
    padding: i32,
    dilation: i32,
    groups: i32,
}

impl Conv {
    fn load(weights: &mut Weights, prefix: &str, stride: usize, padding: usize, dilation: usize) -> Result<Self> {
        let weight = weights.take_conv1d(&format!("{prefix}.weight"), false)?.as_dtype(Dtype::Float32)?;
        Ok(Self {
            weight,
            bias: f32_optional(weights, &format!("{prefix}.bias"))?,
            stride: stride as i32,
            padding: padding as i32,
            dilation: dilation as i32,
            groups: 1,
        })
    }

    fn kernel(&self) -> i32 {
        self.weight.dim(1)
    }

    fn out_len(&self, len: i32) -> i32 {
        (len + 2 * self.padding - self.dilation * (self.kernel() - 1) - 1) / self.stride + 1
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let out = ops::conv1d(x, &self.weight, self.stride, self.padding, self.dilation, self.groups)?;
        Ok(match &self.bias {
            Some(bias) => out.add(bias)?,
            None => out,
        })
    }
}

/// `Snake1d`：`x + 1/(α+1e-9) · sin²(αx)`，`α` 由 `[1, C, 1]` 转成 `[1, 1, C]`。
struct Snake {
    alpha: Array,
    inv_alpha: Array,
}

impl Snake {
    fn load(weights: &mut Weights, prefix: &str) -> Result<Self> {
        let alpha = f32_weight(weights, &format!("{prefix}.alpha"))?.reshape(&[1, 1, -1])?;
        let inv_alpha = Array::from_f32(1.0).divide(&alpha.add(Array::from_f32(1e-9))?)?;
        Ok(Self { alpha, inv_alpha })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let s = x.multiply(&self.alpha)?.sin()?;
        Ok(x.add(&s.square()?.multiply(&self.inv_alpha)?)?)
    }
}

/// DAC `DacResidualUnit`：snake → k7 空洞卷积 → snake → 1×1 卷积，残差相加（长度不变）。
struct DacResidual {
    snake1: Snake,
    conv1: Conv,
    snake2: Snake,
    conv2: Conv,
}

impl DacResidual {
    fn load(weights: &mut Weights, prefix: &str, dilation: usize) -> Result<Self> {
        Ok(Self {
            snake1: Snake::load(weights, &format!("{prefix}.snake1"))?,
            conv1: Conv::load(weights, &format!("{prefix}.conv1"), 1, 3 * dilation, dilation)?,
            snake2: Snake::load(weights, &format!("{prefix}.snake2"))?,
            conv2: Conv::load(weights, &format!("{prefix}.conv2"), 1, 0, 1)?,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let h = self.conv1.forward(&self.snake1.forward(x)?)?;
        let h = self.conv2.forward(&self.snake2.forward(&h)?)?;
        Ok(x.add(&h)?)
    }
}

fn dac_residuals(weights: &mut Weights, prefix: &str) -> Result<[DacResidual; 3]> {
    Ok([
        DacResidual::load(weights, &format!("{prefix}.res_unit1"), 1)?,
        DacResidual::load(weights, &format!("{prefix}.res_unit2"), 3)?,
        DacResidual::load(weights, &format!("{prefix}.res_unit3"), 9)?,
    ])
}

struct DacEncoderBlock {
    res: [DacResidual; 3],
    snake: Snake,
    conv: Conv,
}

struct DacEncoder {
    conv1: Conv,
    blocks: Vec<DacEncoderBlock>,
    snake: Snake,
    conv2: Conv,
}

impl DacEncoder {
    fn load(weights: &mut Weights, ratios: &[usize]) -> Result<Self> {
        let conv1 = Conv::load(weights, "acoustic_encoder.conv1", 1, 3, 1)?;
        let mut blocks = Vec::new();
        for (i, &stride) in ratios.iter().enumerate() {
            let p = format!("acoustic_encoder.block.{i}");
            blocks.push(DacEncoderBlock {
                res: dac_residuals(weights, &p)?,
                snake: Snake::load(weights, &format!("{p}.snake1"))?,
                conv: Conv::load(weights, &format!("{p}.conv1"), stride, stride.div_ceil(2), 1)?,
            });
        }
        Ok(Self {
            conv1,
            blocks,
            snake: Snake::load(weights, "acoustic_encoder.snake1")?,
            conv2: Conv::load(weights, "acoustic_encoder.conv2", 1, 1, 1)?,
        })
    }

    /// HF `_get_conv1d_output_lengths`：残差单元的卷积都保长，只数会改长度的几层。
    fn out_len(&self, len: i32) -> i32 {
        let mut len = self.conv1.out_len(len);
        for block in &self.blocks {
            len = block.conv.out_len(len);
        }
        self.conv2.out_len(len)
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let mut h = self.conv1.forward(x)?;
        for block in &self.blocks {
            for unit in &block.res {
                h = unit.forward(&h)?;
            }
            h = block.conv.forward(&block.snake.forward(&h)?)?;
        }
        self.conv2.forward(&self.snake.forward(&h)?)
    }
}

/// DAC 解码块：snake → 转置卷积（×stride）→ 三个残差单元。
struct DacDecoderBlock {
    snake: Snake,
    weight: Array,
    bias: Array,
    stride: i32,
    res: [DacResidual; 3],
}

impl DacDecoderBlock {
    fn upsample(&self, x: &Array) -> Result<Array> {
        let len = x.dim(1);
        let full = ops::conv_transpose1d(x, &self.weight, self.stride, 0, 1, 0, 1)?;
        let start = (self.stride + 1) / 2;
        Ok(full.index((.., start..start + len * self.stride, ..)).add(&self.bias)?)
    }
}

struct DacDecoder {
    conv1: Conv,
    blocks: Vec<DacDecoderBlock>,
    snake: Snake,
    conv2: Conv,
}

impl DacDecoder {
    fn load(weights: &mut Weights, ratios: &[usize]) -> Result<Self> {
        let conv1 = Conv::load(weights, "acoustic_decoder.conv1", 1, 3, 1)?;
        let mut blocks = Vec::new();
        for (i, &stride) in ratios.iter().enumerate() {
            let p = format!("acoustic_decoder.block.{i}");
            let weight = weights
                .take_conv_transpose1d(&format!("{p}.conv_t1.weight"))?
                .as_dtype(Dtype::Float32)?;
            ensure!(
                weight.dim(1) == 2 * stride as i32,
                "OmniVoice 解码块 {i} 的转置卷积核长 {} 不是 2×stride",
                weight.dim(1)
            );
            blocks.push(DacDecoderBlock {
                snake: Snake::load(weights, &format!("{p}.snake1"))?,
                weight,
                bias: f32_weight(weights, &format!("{p}.conv_t1.bias"))?,
                stride: stride as i32,
                res: dac_residuals(weights, &p)?,
            });
        }
        Ok(Self {
            conv1,
            blocks,
            snake: Snake::load(weights, "acoustic_decoder.snake1")?,
            conv2: Conv::load(weights, "acoustic_decoder.conv2", 1, 3, 1)?,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let mut h = self.conv1.forward(x)?;
        for block in &self.blocks {
            h = block.upsample(&block.snake.forward(&h)?)?;
            for unit in &block.res {
                h = unit.forward(&h)?;
            }
        }
        self.conv2.forward(&self.snake.forward(&h)?)
    }
}

fn layer_norm(x: &Array, weight: &Array, bias: &Array, eps: f32) -> Result<Array> {
    Ok(fast::layer_norm(x, Some(weight), Some(bias), eps)?)
}

struct Norm {
    weight: Array,
    bias: Array,
}

impl Norm {
    fn load(weights: &mut Weights, prefix: &str) -> Result<Self> {
        Ok(Self {
            weight: f32_weight(weights, &format!("{prefix}.weight"))?,
            bias: f32_weight(weights, &format!("{prefix}.bias"))?,
        })
    }
}

struct HubertLayer {
    q: Linear,
    k: Linear,
    v: Linear,
    out: Linear,
    norm: Norm,
    ff_in: Linear,
    ff_out: Linear,
    final_norm: Norm,
}

/// HuBERT base：group-norm 特征提取、weight-norm 位置卷积、12 层 post-norm 编码层。
struct Hubert {
    convs: Vec<Conv>,
    group_norm: Norm,
    projection_norm: Norm,
    projection: Linear,
    pos_conv: Conv,
    encoder_norm: Norm,
    layers: Vec<HubertLayer>,
    heads: i32,
    eps: f32,
}

impl Hubert {
    fn load(weights: &mut Weights, config: &CodecConfig) -> Result<Self> {
        let c = &config.semantic_model_config;
        let mut convs = Vec::new();
        for (i, (&kernel, &stride)) in c.conv_kernel.iter().zip(&c.conv_stride).enumerate() {
            let conv = Conv::load(
                weights,
                &format!("semantic_model.feature_extractor.conv_layers.{i}.conv"),
                stride,
                0,
                1,
            )?;
            ensure!(
                conv.kernel() == kernel as i32,
                "OmniVoice HuBERT 第 {i} 层卷积核长 {} 与配置 {kernel} 不符",
                conv.kernel()
            );
            convs.push(conv);
        }
        let group_norm = Norm::load(weights, "semantic_model.feature_extractor.conv_layers.0.layer_norm")?;
        // weight-norm（dim = 2）：每个核位置 k 上 `w = g · v / ‖v[:, :, k]‖`。
        let prefix = "semantic_model.encoder.pos_conv_embed.conv";
        let g = f32_weight(weights, &format!("{prefix}.parametrizations.weight.original0"))?;
        let v = f32_weight(weights, &format!("{prefix}.parametrizations.weight.original1"))?;
        let norm = v.square()?.sum_axis(0, true)?.sum_axis(1, true)?.sqrt()?;
        let weight = g.multiply(&v)?.divide(&norm)?.transpose_axes(&[0, 2, 1])?;
        let kernel = c.num_conv_pos_embeddings as i32;
        ensure!(
            weight.dim(1) == kernel,
            "OmniVoice HuBERT 位置卷积核长 {} 与配置 {kernel} 不符",
            weight.dim(1)
        );
        let pos_conv = Conv {
            weight,
            bias: f32_optional(weights, &format!("{prefix}.bias"))?,
            stride: 1,
            padding: kernel / 2,
            dilation: 1,
            groups: c.num_conv_pos_embedding_groups as i32,
        };
        let mut layers = Vec::new();
        for i in 0..c.num_hidden_layers {
            let p = format!("semantic_model.encoder.layers.{i}");
            layers.push(HubertLayer {
                q: dense(weights, &format!("{p}.attention.q_proj"))?,
                k: dense(weights, &format!("{p}.attention.k_proj"))?,
                v: dense(weights, &format!("{p}.attention.v_proj"))?,
                out: dense(weights, &format!("{p}.attention.out_proj"))?,
                norm: Norm::load(weights, &format!("{p}.layer_norm"))?,
                ff_in: dense(weights, &format!("{p}.feed_forward.intermediate_dense"))?,
                ff_out: dense(weights, &format!("{p}.feed_forward.output_dense"))?,
                final_norm: Norm::load(weights, &format!("{p}.final_layer_norm"))?,
            });
        }
        Ok(Self {
            convs,
            group_norm,
            projection_norm: Norm::load(weights, "semantic_model.feature_projection.layer_norm")?,
            projection: dense(weights, "semantic_model.feature_projection.projection")?,
            pos_conv,
            encoder_norm: Norm::load(weights, "semantic_model.encoder.layer_norm")?,
            layers,
            heads: c.num_attention_heads as i32,
            eps: c.layer_norm_eps,
        })
    }

    fn attention(&self, layer: &HubertLayer, x: &Array) -> Result<Array> {
        let t = x.dim(1);
        let hidden = x.dim(2);
        let head_dim = hidden / self.heads;
        let split = |h: Array| -> Result<Array> { Ok(h.reshape(&[1, t, self.heads, head_dim])?.transpose_axes(&[0, 2, 1, 3])?) };
        let q = split(layer.q.forward(x)?)?;
        let k = split(layer.k.forward(x)?)?;
        let v = split(layer.v.forward(x)?)?;
        let attended = fast::scaled_dot_product_attention(&q, &k, &v, (head_dim as f32).powf(-0.5), None, None)?;
        let merged = attended.transpose_axes(&[0, 2, 1, 3])?.reshape(&[1, t, hidden])?;
        layer.out.forward(&merged)
    }

    /// `[1, N, 1]` 的 16 kHz 波形 → 全部 13 份 hidden state 的均值 `[1, T, 768]`。
    fn forward(&self, wave: &Array) -> Result<Array> {
        let mut h = wave.clone();
        for (i, conv) in self.convs.iter().enumerate() {
            h = conv.forward(&h)?;
            if i == 0 {
                // GroupNorm(512 组, 512 通道)：每个通道沿时间归一化，再仿射。
                let mean = h.mean_axis(1, true)?;
                let centered = h.subtract(&mean)?;
                let var = centered.square()?.mean_axis(1, true)?;
                h = centered
                    .multiply(&var.add(Array::from_f32(1e-5))?.rsqrt()?)?
                    .multiply(&self.group_norm.weight)?
                    .add(&self.group_norm.bias)?;
            }
            h = gelu_same_dtype(&h)?;
        }
        let h = layer_norm(&h, &self.projection_norm.weight, &self.projection_norm.bias, self.eps)?;
        let h = self.projection.forward(&h)?;
        // 位置卷积（偶数核长）多出的最后一帧去掉（`HubertSamePadLayer`），再 GELU。
        let t = h.dim(1);
        let pos = self.pos_conv.forward(&h)?;
        let pos = gelu_same_dtype(&pos.index((.., ..t, ..)))?;
        let mut h = layer_norm(&h.add(&pos)?, &self.encoder_norm.weight, &self.encoder_norm.bias, self.eps)?;
        let mut sum = h.clone();
        for layer in &self.layers {
            let attn = self.attention(layer, &h)?;
            h = layer_norm(&h.add(&attn)?, &layer.norm.weight, &layer.norm.bias, self.eps)?;
            let ff = layer.ff_out.forward(&gelu_same_dtype(&layer.ff_in.forward(&h)?)?)?;
            h = layer_norm(&h.add(&ff)?, &layer.final_norm.weight, &layer.final_norm.bias, self.eps)?;
            sum = sum.add(&h)?;
        }
        Ok(sum.divide(Array::from_f32((self.layers.len() + 1) as f32))?)
    }
}

/// `HiggsAudioV2TokenizerResidualUnit`：ELU → 卷积（无偏置）→ ELU → 1×1 卷积，残差相加。
struct SemanticResidual {
    conv1: Conv,
    conv2: Conv,
}

struct SemanticBlock {
    res: Vec<SemanticResidual>,
    conv: Conv,
}

struct SemanticEncoder {
    conv: Conv,
    blocks: Vec<SemanticBlock>,
}

impl SemanticEncoder {
    fn load(weights: &mut Weights, config: &CodecConfig) -> Result<Self> {
        let conv = Conv::load(weights, "encoder_semantic.conv", 1, config.kernel_size / 2, 1)?;
        let mut blocks = Vec::new();
        for (i, &stride) in config.strides.iter().enumerate() {
            let p = format!("encoder_semantic.conv_blocks.{i}");
            let mut res = Vec::new();
            for (j, &dilation) in config.block_dilations.iter().enumerate() {
                let r = format!("{p}.res_units.{j}");
                res.push(SemanticResidual {
                    conv1: Conv::load(
                        weights,
                        &format!("{r}.conv1"),
                        1,
                        (config.unit_kernel_size - 1) / 2 * dilation,
                        dilation,
                    )?,
                    conv2: Conv::load(weights, &format!("{r}.conv2"), 1, 0, 1)?,
                });
            }
            let kernel = if stride == 1 { 3 } else { 2 * stride };
            blocks.push(SemanticBlock {
                res,
                conv: Conv::load(weights, &format!("{p}.conv"), stride, (kernel - 1) / 2, 1)?,
            });
        }
        Ok(Self { conv, blocks })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let mut h = self.conv.forward(x)?;
        for block in &self.blocks {
            for unit in &block.res {
                let y = unit.conv1.forward(&elu(&h)?)?;
                let y = unit.conv2.forward(&elu(&y)?)?;
                h = h.add(&y)?;
            }
            h = block.conv.forward(&h)?;
        }
        Ok(h)
    }
}

struct Quantizer {
    /// `[codebook_size, codebook_dim]`。
    embed: Array,
    /// `|e|²`，`[1, codebook_size]`。
    embed_sq: Array,
    project_in: Linear,
    project_out: Linear,
}

impl Quantizer {
    fn decode(&self, codes: &Array) -> Result<Array> {
        self.project_out.forward(&self.embed.take_axis(codes, 0)?)
    }
}

pub struct Codec {
    hubert: Hubert,
    semantic: SemanticEncoder,
    acoustic_encoder: DacEncoder,
    acoustic_decoder: DacDecoder,
    fc: Linear,
    fc2: Linear,
    quantizers: Vec<Quantizer>,
    downsample: usize,
    /// HuBERT 输入两侧补零数。HF 写死 160；它等于 `downsample_factor / 2`（HuBERT 总步长
    /// 320 的一半），这里按后者算，合成小模型单测才能用小步长。
    semantic_pad: usize,
    hop: usize,
    pub sample_rate: u32,
    semantic_rate: u32,
}

impl Codec {
    pub fn load(weights: &mut Weights, config: &CodecConfig) -> Result<Self> {
        let acoustic = &config.acoustic_model_config;
        let hubert = Hubert::load(weights, config)?;
        let semantic = SemanticEncoder::load(weights, config)?;
        let acoustic_encoder = DacEncoder::load(weights, &acoustic.downsampling_ratios)?;
        let acoustic_decoder = DacDecoder::load(weights, &acoustic.upsampling_ratios)?;
        let fc = dense(weights, "fc")?;
        let fc2 = dense(weights, "fc2")?;
        let mut quantizers = Vec::new();
        for i in 0..config.num_quantizers() {
            let p = format!("quantizer.quantizers.{i}");
            let embed = f32_weight(weights, &format!("{p}.codebook.embed"))?;
            let embed_sq = embed.square()?.sum_axis(1, false)?.reshape(&[1, -1])?;
            quantizers.push(Quantizer {
                embed,
                embed_sq,
                project_in: dense(weights, &format!("{p}.project_in"))?,
                project_out: dense(weights, &format!("{p}.project_out"))?,
            });
        }
        // 训练专用的语义解码支路与 EMA 统计量：取走丢弃。
        for key in weights.keys() {
            if key.starts_with("decoder_semantic.")
                || key.starts_with("fc1.")
                || key.ends_with(".codebook.cluster_size")
                || key.ends_with(".codebook.embed_avg")
                || key.ends_with(".codebook.inited")
            {
                weights.take(&key)?;
            }
        }
        Ok(Self {
            hubert,
            semantic,
            acoustic_encoder,
            acoustic_decoder,
            fc,
            fc2,
            quantizers,
            downsample: config.semantic_downsample_factor(),
            semantic_pad: config.downsample_factor / 2,
            hop: config.hop_length(),
            sample_rate: config.sample_rate,
            semantic_rate: config.semantic_sample_rate,
        })
    }

    pub fn num_codebooks(&self) -> usize {
        self.quantizers.len()
    }

    /// 每个 token 帧对应的 24 kHz 样本数。
    pub fn hop(&self) -> usize {
        self.hop
    }

    /// 24 kHz 波形（长度须是 `hop` 的整数倍）→ `[num_codebooks, frames]` 的 token，
    /// 按码本在前的行主序展开。
    pub fn encode(&self, wave: &[f32]) -> Result<Vec<i32>> {
        ensure!(
            !wave.is_empty() && wave.len().is_multiple_of(self.hop),
            "OmniVoice 编码输入长度 {} 不是 {} 的正整数倍",
            wave.len(),
            self.hop
        );
        // 语义支路：重采样到 16 kHz、两侧补 160 个零、HuBERT 13 层均值、隔帧取一。
        let semantic_wave = super::audio::resample(wave, self.sample_rate, self.semantic_rate);
        let mut padded = vec![0.0f32; self.semantic_pad];
        padded.extend_from_slice(&semantic_wave);
        padded.resize(padded.len() + self.semantic_pad, 0.0);
        let input = Array::from_slice(&padded, &[1, padded.len() as i32, 1]);
        let features = self.hubert.forward(&input)?;
        let frames = features.dim(1);
        let keep: Vec<i32> = (0..frames).step_by(self.downsample.max(1)).collect();
        let features = features.take_axis(&Array::from_slice(&keep, &[keep.len() as i32]), 1)?;
        let semantic = self.semantic.forward(&features)?;
        let frames = semantic.dim(1);

        // 声学支路：输出帧数对不上语义帧数时两侧各补 hop/2（HF `encode` 的判定）。
        let mut acoustic_input = wave.to_vec();
        if self.acoustic_encoder.out_len(wave.len() as i32) != frames {
            let pad = self.hop / 2;
            let mut v = vec![0.0f32; pad];
            v.extend_from_slice(wave);
            v.resize(v.len() + pad, 0.0);
            acoustic_input = v;
        }
        let acoustic = self
            .acoustic_encoder
            .forward(&Array::from_slice(&acoustic_input, &[1, acoustic_input.len() as i32, 1]))?;
        ensure!(
            acoustic.dim(1) == frames,
            "OmniVoice 声学帧数 {} 与语义帧数 {frames} 不一致",
            acoustic.dim(1)
        );
        let embeddings = self
            .fc
            .forward(&ops::concatenate_axis(&[&acoustic, &semantic], -1)?)?
            .reshape(&[frames, -1])?;

        // 残差向量量化：`argmax(2·h·eᵀ − |e|²)` 即欧氏最近邻（`|h|²` 对每行是常数）。
        let mut residual = embeddings;
        let mut codes = Vec::with_capacity(self.quantizers.len() * frames as usize);
        for quantizer in &self.quantizers {
            let h = quantizer.project_in.forward(&residual)?;
            let score = ops::matmul(&h, quantizer.embed.t())?
                .multiply(Array::from_f32(2.0))?
                .subtract(&quantizer.embed_sq)?;
            let index = argmax_axis(&score, -1, false)?.as_dtype(Dtype::Uint32)?;
            residual = residual.subtract(&quantizer.decode(&index)?)?;
            crate::synthesize::tensor::transforms::eval([&residual, &index])?;
            codes.extend(index.as_slice::<u32>().iter().map(|&c| c as i32));
        }
        Ok(codes)
    }

    /// `[num_codebooks, frames]` 的 token（行主序）→ 24 kHz 波形。
    pub fn decode(&self, codes: &[i32], frames: usize) -> Result<Vec<f32>> {
        let n = self.quantizers.len();
        ensure!(
            frames > 0 && codes.len() == n * frames,
            "OmniVoice 解码输入形状不对：{} 个 token、{frames} 帧",
            codes.len()
        );
        let mut quantized: Option<Array> = None;
        for (i, quantizer) in self.quantizers.iter().enumerate() {
            let row: Vec<u32> = codes[i * frames..(i + 1) * frames].iter().map(|&c| c as u32).collect();
            let part = quantizer.decode(&Array::from_slice(&row, &[frames as i32]))?;
            quantized = Some(match quantized {
                Some(sum) => sum.add(&part)?,
                None => part,
            });
        }
        let quantized = quantized.expect("至少一个量化器").reshape(&[1, frames as i32, -1])?;
        let audio = self.acoustic_decoder.forward(&self.fc2.forward(&quantized)?)?;
        crate::synthesize::tensor::transforms::eval([&audio])?;
        Ok(audio.as_dtype(Dtype::Float32)?.as_slice::<f32>().to_vec())
    }
}
