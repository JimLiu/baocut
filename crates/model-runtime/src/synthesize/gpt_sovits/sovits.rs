//! SoVITS v2 解码器（`s2G2333k`），对照 `GPT_SoVITS/module/models.py::SynthesizerTrn`
//! 的 `decode` / `extract_latent`，以及 `attentions.py`、`modules.py`、`mrte_model.py`。
//!
//! 内部统一用 NLC 布局（`[1, T, C]`）：通道维上的 split / flip / LayerNorm 都落在
//! 最后一维。batch 恒为 1，上游的长度掩码全是 1，这里省略。

use super::layers::{Conv1d, LayerNorm, Linear, act};
use super::spec::Spectrogram;
use super::weights::WeightMap;
use crate::synthesize::tensor::ops::indexing::{IndexOp, argmin_axis};
use crate::synthesize::tensor::{Array, Dtype, fast, ops, random};
use anyhow::{Context, Result, ensure};

const INTER: i32 = 192;
const HIDDEN: i32 = 192;
const HALF: i32 = INTER / 2;
const ENCODER_HEADS: i32 = 2;
const ENCODER_LAYERS: usize = 6;
/// 相对位置注意力的窗口（`emb_rel_k` 第 1 维 = 2·4 + 1）。
const WINDOW: i32 = 4;
const LAYER_NORM_EPS: f32 = 1e-5;
const SSL_DIM: i32 = 768;
const CODEBOOK_SIZE: usize = 1024;
const MRTE_HIDDEN: i32 = 512;
const MRTE_HEADS: i32 = 4;
/// v2 的 `ref_enc` 只看线性谱的前 704 个频点。
const STYLE_BINS: usize = 704;
const STYLE_HIDDEN: i32 = 128;
const STYLE_HEADS: i32 = 2;
const WN_LAYERS: usize = 4;
const FLOW_COUPLINGS: [usize; 4] = [0, 2, 4, 6];
const UPSAMPLE_RATES: [i32; 5] = [10, 8, 2, 2, 2];
const UPSAMPLE_KERNELS: [i32; 5] = [16, 16, 8, 2, 2];
const RESBLOCK_KERNELS: [i32; 3] = [3, 7, 11];
const RESBLOCK_DILATIONS: [i32; 3] = [1, 3, 5];
const LRELU_SLOPE: f32 = 0.1;
/// `SynthesizerTrn.decode` 的默认 `noise_scale`。
pub const NOISE_SCALE: f32 = 0.5;

fn leaky_relu(x: &Array, slope: f32) -> Result<Array> {
    Ok(ops::maximum(x, &(x * slope))?)
}

/// 沿最后一维切成 `[..at]` 与 `[at..]`。
fn split_last(x: &Array, at: i32) -> (Array, Array) {
    (x.index((.., .., ..at)), x.index((.., .., at..)))
}

/// `[1, T, C]` → `[1, heads, T, C / heads]`。
fn to_heads(x: &Array, heads: i32) -> Result<Array> {
    let (t, c) = (x.dim(1), x.dim(2));
    Ok(x.reshape(&[1, t, heads, c / heads])?.transpose_axes(&[0, 2, 1, 3])?)
}

fn from_heads(x: &Array) -> Result<Array> {
    let (heads, t, d) = (x.dim(1), x.dim(2), x.dim(3));
    Ok(x.transpose_axes(&[0, 2, 1, 3])?.reshape(&[1, t, heads * d])?)
}

/// `modules.LayerNorm`（通道维，参数名 gamma / beta）。
fn channel_norm(w: &mut WeightMap, prefix: &str) -> Result<LayerNorm> {
    Ok(LayerNorm {
        weight: Some(w.take_f32(&format!("{prefix}.gamma"))?),
        bias: Some(w.take_f32(&format!("{prefix}.beta"))?),
        eps: LAYER_NORM_EPS,
    })
}

/// 与卷积核匹配的 same padding（奇数核两侧对称）。
fn same_padding(conv: Conv1d) -> Conv1d {
    let kernel = conv.weight.dim(1);
    let dilation = conv.dilation;
    conv.with_padding((kernel - 1) * dilation / 2)
}

// ---------------------------------------------------------------------------
// 相对位置自注意力（`attentions.MultiHeadAttention`，window_size = 4，heads_share）

struct RelAttention {
    q: Conv1d,
    k: Conv1d,
    v: Conv1d,
    o: Conv1d,
    rel_k: Array,
    rel_v: Array,
}

impl RelAttention {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            q: Conv1d::load(w, &format!("{prefix}.conv_q"))?,
            k: Conv1d::load(w, &format!("{prefix}.conv_k"))?,
            v: Conv1d::load(w, &format!("{prefix}.conv_v"))?,
            o: Conv1d::load(w, &format!("{prefix}.conv_o"))?,
            rel_k: w.take_f32(&format!("{prefix}.emb_rel_k"))?,
            rel_v: w.take_f32(&format!("{prefix}.emb_rel_v"))?,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let t = x.dim(1);
        let k_channels = HIDDEN / ENCODER_HEADS;
        let span = 2 * t - 1;
        let query = to_heads(&self.q.forward_nlc(x)?, ENCODER_HEADS)? * (1.0 / (k_channels as f32).sqrt());
        let key = to_heads(&self.k.forward_nlc(x)?, ENCODER_HEADS)?;
        let value = to_heads(&self.v.forward_nlc(x)?, ENCODER_HEADS)?;

        let rel_k = relative_embeddings(&self.rel_k, t)?
            .swap_axes(1, 2)?
            .reshape(&[1, 1, k_channels, span])?;
        let rel_k = ops::broadcast_to(&rel_k, &[1, ENCODER_HEADS, k_channels, span])?;
        let scores = ops::matmul(&query, &key.swap_axes(2, 3)?)? + relative_to_absolute(&ops::matmul(&query, &rel_k)?)?;
        let weights = ops::softmax_axis(&scores, -1, None)?;

        let rel_v = relative_embeddings(&self.rel_v, t)?.reshape(&[1, 1, span, k_channels])?;
        let rel_v = ops::broadcast_to(&rel_v, &[1, ENCODER_HEADS, span, k_channels])?;
        let out = ops::matmul(&weights, &value)? + ops::matmul(&absolute_to_relative(&weights)?, &rel_v)?;
        self.o.forward_nlc(&from_heads(&out)?)
    }
}

/// `_get_relative_embeddings`：`[1, 2W+1, d]` → `[1, 2T-1, d]`（先补零再切片）。
fn relative_embeddings(embeddings: &Array, length: i32) -> Result<Array> {
    let pad = (length - (WINDOW + 1)).max(0);
    let start = ((WINDOW + 1) - length).max(0);
    let end = start + 2 * length - 1;
    let padded = if pad > 0 {
        ops::pad(embeddings, &[(0, 0), (pad, pad), (0, 0)], None, None)?
    } else {
        embeddings.clone()
    };
    Ok(padded.index((.., start..end, ..)))
}

/// `_relative_position_to_absolute_position`：`[b, h, l, 2l-1]` → `[b, h, l, l]`，
/// 即 `abs[i][j] = rel[i][j - i + l - 1]`。
fn relative_to_absolute(x: &Array) -> Result<Array> {
    let (b, h, l) = (x.dim(0), x.dim(1), x.dim(2));
    let x = ops::pad(x, &[(0, 0), (0, 0), (0, 0), (0, 1)], None, None)?;
    let flat = x.reshape(&[b, h, l * 2 * l])?;
    let flat = ops::pad(&flat, &[(0, 0), (0, 0), (0, l - 1)], None, None)?;
    Ok(flat.reshape(&[b, h, l + 1, 2 * l - 1])?.index((.., .., ..l, (l - 1)..)))
}

/// `_absolute_position_to_relative_position`：`[b, h, l, l]` → `[b, h, l, 2l-1]`。
fn absolute_to_relative(x: &Array) -> Result<Array> {
    let (b, h, l) = (x.dim(0), x.dim(1), x.dim(2));
    let x = ops::pad(x, &[(0, 0), (0, 0), (0, 0), (0, l - 1)], None, None)?;
    let flat = x.reshape(&[b, h, l * (2 * l - 1)])?;
    let flat = ops::pad(&flat, &[(0, 0), (0, 0), (l, 0)], None, None)?;
    Ok(flat.reshape(&[b, h, l, 2 * l])?.index((.., .., .., 1..)))
}

// ---------------------------------------------------------------------------
// attentions.Encoder

struct EncoderLayer {
    attn: RelAttention,
    norm1: LayerNorm,
    conv1: Conv1d,
    conv2: Conv1d,
    norm2: LayerNorm,
}

struct Encoder {
    layers: Vec<EncoderLayer>,
}

impl Encoder {
    fn load(w: &mut WeightMap, prefix: &str, layers: usize) -> Result<Self> {
        let layers = (0..layers)
            .map(|i| -> Result<EncoderLayer> {
                Ok(EncoderLayer {
                    attn: RelAttention::load(w, &format!("{prefix}.attn_layers.{i}"))?,
                    norm1: channel_norm(w, &format!("{prefix}.norm_layers_1.{i}"))?,
                    conv1: same_padding(Conv1d::load(w, &format!("{prefix}.ffn_layers.{i}.conv_1"))?),
                    conv2: same_padding(Conv1d::load(w, &format!("{prefix}.ffn_layers.{i}.conv_2"))?),
                    norm2: channel_norm(w, &format!("{prefix}.norm_layers_2.{i}"))?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self { layers })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let mut x = x.clone();
        for layer in &self.layers {
            x = layer.norm1.forward(&(&x + layer.attn.forward(&x)?))?;
            let hidden = ops::maximum(&layer.conv1.forward_nlc(&x)?, &Array::from_f32(0.0))?;
            x = layer.norm2.forward(&(&x + layer.conv2.forward_nlc(&hidden)?))?;
        }
        Ok(x)
    }
}

// ---------------------------------------------------------------------------
// MRTE：语义特征对文本做交叉注意力，再叠加音色向量。

struct Mrte {
    c_pre: Conv1d,
    text_pre: Conv1d,
    c_post: Conv1d,
    q: Conv1d,
    k: Conv1d,
    v: Conv1d,
    o: Conv1d,
}

impl Mrte {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            c_pre: Conv1d::load(w, &format!("{prefix}.c_pre"))?,
            text_pre: Conv1d::load(w, &format!("{prefix}.text_pre"))?,
            c_post: Conv1d::load(w, &format!("{prefix}.c_post"))?,
            q: Conv1d::load(w, &format!("{prefix}.cross_attention.conv_q"))?,
            k: Conv1d::load(w, &format!("{prefix}.cross_attention.conv_k"))?,
            v: Conv1d::load(w, &format!("{prefix}.cross_attention.conv_v"))?,
            o: Conv1d::load(w, &format!("{prefix}.cross_attention.conv_o"))?,
        })
    }

    fn forward(&self, ssl: &Array, text: &Array, ge: &Array) -> Result<Array> {
        let ssl = self.c_pre.forward_nlc(ssl)?;
        let text = self.text_pre.forward_nlc(text)?;
        let q = to_heads(&self.q.forward_nlc(&ssl)?, MRTE_HEADS)?;
        let k = to_heads(&self.k.forward_nlc(&text)?, MRTE_HEADS)?;
        let v = to_heads(&self.v.forward_nlc(&text)?, MRTE_HEADS)?;
        let scale = 1.0 / ((MRTE_HIDDEN / MRTE_HEADS) as f32).sqrt();
        let attn = fast::scaled_dot_product_attention(&q, &k, &v, scale, None, None)?;
        let x = self.o.forward_nlc(&from_heads(&attn)?)? + &ssl + ge;
        self.c_post.forward_nlc(&x)
    }
}

// ---------------------------------------------------------------------------
// TextEncoder（enc_p）

struct TextEncoder {
    ssl_proj: Conv1d,
    encoder_ssl: Encoder,
    text_embedding: Array,
    encoder_text: Encoder,
    mrte: Mrte,
    encoder2: Encoder,
    proj: Conv1d,
}

impl TextEncoder {
    fn load(w: &mut WeightMap) -> Result<Self> {
        Ok(Self {
            ssl_proj: Conv1d::load(w, "enc_p.ssl_proj")?,
            encoder_ssl: Encoder::load(w, "enc_p.encoder_ssl", ENCODER_LAYERS / 2)?,
            text_embedding: w.take_f32("enc_p.text_embedding.weight")?,
            encoder_text: Encoder::load(w, "enc_p.encoder_text", ENCODER_LAYERS)?,
            mrte: Mrte::load(w, "enc_p.mrte")?,
            encoder2: Encoder::load(w, "enc_p.encoder2", ENCODER_LAYERS / 2)?,
            proj: Conv1d::load(w, "enc_p.proj")?,
        })
    }

    /// 返回先验分布的均值与对数标准差（各 `[1, T, 192]`）。
    fn forward(&self, quantized: &Array, phones: &[i32], ge: &Array) -> Result<(Array, Array)> {
        let y = self.encoder_ssl.forward(&self.ssl_proj.forward_nlc(quantized)?)?;
        let n = phones.len() as i32;
        let text = self
            .text_embedding
            .take_axis(&Array::from_slice(phones, &[n]), 0)?
            .reshape(&[1, n, HIDDEN])?;
        let text = self.encoder_text.forward(&text)?;
        let y = self.mrte.forward(&y, &text, ge)?;
        let y = self.encoder2.forward(&y)?;
        Ok(split_last(&self.proj.forward_nlc(&y)?, INTER))
    }
}

// ---------------------------------------------------------------------------
// MelStyleEncoder（ref_enc）

struct StyleEncoder {
    spectral0: Linear,
    spectral1: Linear,
    temporal: Vec<Conv1d>,
    w_qs: Linear,
    w_ks: Linear,
    w_vs: Linear,
    attn_fc: Linear,
    fc: Linear,
}

impl StyleEncoder {
    fn load(w: &mut WeightMap) -> Result<Self> {
        Ok(Self {
            spectral0: Linear::load(w, "ref_enc.spectral.0.fc")?,
            spectral1: Linear::load(w, "ref_enc.spectral.3.fc")?,
            temporal: (0..2)
                .map(|i| Ok(same_padding(Conv1d::load(w, &format!("ref_enc.temporal.{i}.conv1.conv"))?)))
                .collect::<Result<Vec<_>>>()?,
            w_qs: Linear::load(w, "ref_enc.slf_attn.w_qs")?,
            w_ks: Linear::load(w, "ref_enc.slf_attn.w_ks")?,
            w_vs: Linear::load(w, "ref_enc.slf_attn.w_vs")?,
            attn_fc: Linear::load(w, "ref_enc.slf_attn.fc")?,
            fc: Linear::load(w, "ref_enc.fc.fc")?,
        })
    }

    /// 参考线性谱 → 音色向量 `ge`（`[1, 1, 512]`）。
    fn forward(&self, spec: &Spectrogram) -> Result<Array> {
        let frames = spec.frames;
        ensure!(frames > 0, "参考音频频谱为空");
        let mut data = vec![0.0f32; frames * STYLE_BINS];
        for bin in 0..STYLE_BINS {
            for frame in 0..frames {
                data[frame * STYLE_BINS + bin] = spec.data[bin * frames + frame];
            }
        }
        let x = Array::from_slice(&data, &[1, frames as i32, STYLE_BINS as i32]);
        let x = act::mish(&self.spectral0.forward(&x)?)?;
        let mut x = act::mish(&self.spectral1.forward(&x)?)?;
        for conv in &self.temporal {
            let (gate_in, gate) = split_last(&conv.forward_nlc(&x)?, STYLE_HIDDEN);
            x = &x + gate_in * ops::sigmoid(&gate)?;
        }
        let q = to_heads(&self.w_qs.forward(&x)?, STYLE_HEADS)?;
        let k = to_heads(&self.w_ks.forward(&x)?, STYLE_HEADS)?;
        let v = to_heads(&self.w_vs.forward(&x)?, STYLE_HEADS)?;
        // `ScaledDotProductAttention(temperature = d_model ** 0.5)`。
        let scale = 1.0 / (STYLE_HIDDEN as f32).sqrt();
        let attn = fast::scaled_dot_product_attention(&q, &k, &v, scale, None, None)?;
        let x = self.attn_fc.forward(&from_heads(&attn)?)? + &x;
        let x = self.fc.forward(&x)?;
        Ok(x.mean_axis(1, true)?)
    }
}

// ---------------------------------------------------------------------------
// ResidualCouplingBlock（mean_only，只做逆变换）

struct Wn {
    cond: Conv1d,
    in_layers: Vec<Conv1d>,
    res_skip: Vec<Conv1d>,
}

impl Wn {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        let cond = Conv1d::load_weight_norm(w, &format!("{prefix}.cond_layer"))?;
        let mut in_layers = Vec::with_capacity(WN_LAYERS);
        let mut res_skip = Vec::with_capacity(WN_LAYERS);
        for i in 0..WN_LAYERS {
            in_layers.push(same_padding(Conv1d::load_weight_norm(w, &format!("{prefix}.in_layers.{i}"))?));
            res_skip.push(Conv1d::load_weight_norm(w, &format!("{prefix}.res_skip_layers.{i}"))?);
        }
        Ok(Self { cond, in_layers, res_skip })
    }

    fn forward(&self, x: &Array, ge: &Array) -> Result<Array> {
        let g = self.cond.forward_nlc(ge)?;
        let mut x = x.clone();
        let mut output: Option<Array> = None;
        for (i, (in_layer, res_skip)) in self.in_layers.iter().zip(&self.res_skip).enumerate() {
            let offset = i as i32 * 2 * HIDDEN;
            let g_l = g.index((.., .., offset..offset + 2 * HIDDEN));
            let (a, b) = split_last(&(in_layer.forward_nlc(&x)? + g_l), HIDDEN);
            let acts = ops::tanh(&a)? * ops::sigmoid(&b)?;
            let res_skip = res_skip.forward_nlc(&acts)?;
            let skip = if i + 1 < WN_LAYERS {
                let (res, skip) = split_last(&res_skip, HIDDEN);
                x = x + res;
                skip
            } else {
                res_skip
            };
            output = Some(match output {
                Some(sum) => sum + skip,
                None => skip,
            });
        }
        output.context("WN 没有层")
    }
}

struct Coupling {
    pre: Conv1d,
    enc: Wn,
    post: Conv1d,
}

impl Coupling {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            pre: Conv1d::load(w, &format!("{prefix}.pre"))?,
            enc: Wn::load(w, &format!("{prefix}.enc"))?,
            post: Conv1d::load(w, &format!("{prefix}.post"))?,
        })
    }

    fn reverse(&self, x: &Array, ge: &Array) -> Result<Array> {
        let (x0, x1) = split_last(x, HALF);
        let h = self.enc.forward(&self.pre.forward_nlc(&x0)?, ge)?;
        let mean = self.post.forward_nlc(&h)?;
        Ok(ops::concatenate_axis(&[&x0, &(x1 - mean)], 2)?)
    }
}

struct Flow {
    couplings: Vec<Coupling>,
    flip: Array,
}

impl Flow {
    fn load(w: &mut WeightMap) -> Result<Self> {
        let couplings = FLOW_COUPLINGS
            .iter()
            .map(|i| Coupling::load(w, &format!("flow.flows.{i}")))
            .collect::<Result<Vec<_>>>()?;
        let flip: Vec<i32> = (0..INTER).rev().collect();
        Ok(Self {
            couplings,
            flip: Array::from_slice(&flip, &[INTER]),
        })
    }

    /// `flows = [C0, F, C2, F, C4, F, C6, F]` 倒序执行：每个耦合层之前先翻转通道。
    fn reverse(&self, x: &Array, ge: &Array) -> Result<Array> {
        let mut x = x.clone();
        for coupling in self.couplings.iter().rev() {
            x = x.take_axis(&self.flip, 2)?;
            x = coupling.reverse(&x, ge)?;
        }
        Ok(x)
    }
}

// ---------------------------------------------------------------------------
// HiFi-GAN Generator（dec）

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

struct ResBlock {
    convs1: Vec<Conv1d>,
    convs2: Vec<Conv1d>,
}

impl ResBlock {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        let mut convs1 = Vec::with_capacity(RESBLOCK_DILATIONS.len());
        let mut convs2 = Vec::with_capacity(RESBLOCK_DILATIONS.len());
        for (j, dilation) in RESBLOCK_DILATIONS.into_iter().enumerate() {
            convs1.push(same_padding(
                Conv1d::load_weight_norm(w, &format!("{prefix}.convs1.{j}"))?.with_dilation(dilation),
            ));
            convs2.push(same_padding(Conv1d::load_weight_norm(w, &format!("{prefix}.convs2.{j}"))?));
        }
        Ok(Self { convs1, convs2 })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let mut x = x.clone();
        for (c1, c2) in self.convs1.iter().zip(&self.convs2) {
            let h = c1.forward_nlc(&leaky_relu(&x, LRELU_SLOPE)?)?;
            let h = c2.forward_nlc(&leaky_relu(&h, LRELU_SLOPE)?)?;
            x = h + x;
        }
        Ok(x)
    }
}

struct Generator {
    conv_pre: Conv1d,
    cond: Conv1d,
    ups: Vec<ConvTranspose1d>,
    resblocks: Vec<ResBlock>,
    conv_post: Conv1d,
}

impl Generator {
    fn load(w: &mut WeightMap) -> Result<Self> {
        let conv_pre = same_padding(Conv1d::load(w, "dec.conv_pre")?);
        let cond = Conv1d::load(w, "dec.cond")?;
        let ups = UPSAMPLE_RATES
            .iter()
            .zip(UPSAMPLE_KERNELS)
            .enumerate()
            .map(|(i, (&rate, kernel))| ConvTranspose1d::load_weight_norm(w, &format!("dec.ups.{i}"), rate, (kernel - rate) / 2))
            .collect::<Result<Vec<_>>>()?;
        let resblocks = (0..UPSAMPLE_RATES.len() * RESBLOCK_KERNELS.len())
            .map(|n| ResBlock::load(w, &format!("dec.resblocks.{n}")))
            .collect::<Result<Vec<_>>>()?;
        let conv_post = same_padding(Conv1d::load(w, "dec.conv_post")?);
        Ok(Self {
            conv_pre,
            cond,
            ups,
            resblocks,
            conv_post,
        })
    }

    fn forward(&self, z: &Array, ge: &Array) -> Result<Array> {
        let mut x = self.conv_pre.forward_nlc(z)? + self.cond.forward_nlc(ge)?;
        let kernels = RESBLOCK_KERNELS.len();
        for (i, up) in self.ups.iter().enumerate() {
            x = up.forward_nlc(&leaky_relu(&x, LRELU_SLOPE)?)?;
            let mut sum: Option<Array> = None;
            for block in &self.resblocks[i * kernels..(i + 1) * kernels] {
                let y = block.forward(&x)?;
                sum = Some(match sum {
                    Some(s) => s + y,
                    None => y,
                });
            }
            x = sum.context("Generator 缺少残差块")? / kernels as f32;
        }
        // `F.leaky_relu` 默认斜率 0.01。
        let x = self.conv_post.forward_nlc(&leaky_relu(&x, 0.01)?)?;
        Ok(ops::tanh(&x)?)
    }
}

// ---------------------------------------------------------------------------

pub struct Sovits {
    ref_enc: StyleEncoder,
    ssl_proj: Conv1d,
    codebook: Array,
    enc_p: TextEncoder,
    flow: Flow,
    dec: Generator,
}

impl Sovits {
    pub fn load(mut w: WeightMap) -> Result<Self> {
        let codebook = w.take_f32("quantizer.vq.layers.0._codebook.embed")?;
        ensure!(
            codebook.dim(0) as usize == CODEBOOK_SIZE && codebook.dim(1) == SSL_DIM,
            "SoVITS 码本形状不对：[{}, {}]",
            codebook.dim(0),
            codebook.dim(1)
        );
        Ok(Self {
            ref_enc: StyleEncoder::load(&mut w)?,
            // 25 Hz：`Conv1d(768, 768, 2, stride=2)`。
            ssl_proj: Conv1d::load(&mut w, "ssl_proj")?.with_stride(2),
            codebook,
            enc_p: TextEncoder::load(&mut w)?,
            flow: Flow::load(&mut w)?,
            dec: Generator::load(&mut w)?,
        })
    }

    /// `extract_latent`：HuBERT `last_hidden_state`（`[1, T, 768]`）→ 25 Hz 语义码。
    pub fn extract_codes(&self, hubert: &Array) -> Result<Vec<u32>> {
        let x = self.ssl_proj.forward_nlc(hubert)?.reshape(&[-1, SSL_DIM])?;
        let distance = x.square()?.sum_axis(-1, true)? - ops::matmul(&x, &self.codebook.t())? * 2.0f32
            + self.codebook.square()?.sum_axis(-1, false)?;
        let codes = argmin_axis(&distance, -1, false)?;
        codes.eval()?;
        Ok(codes.as_slice::<u32>().to_vec())
    }

    /// `decode`：语义码 + 目标音素 + 参考线性谱 → 32 kHz 波形（未做峰值归一化）。
    pub fn decode(&self, codes: &[u32], phones: &[i32], refer: &Spectrogram, noise_scale: f32, seed: u64) -> Result<Vec<f32>> {
        ensure!(!codes.is_empty(), "SoVITS 输入语义码为空");
        ensure!(!phones.is_empty(), "SoVITS 输入音素为空");
        ensure!(
            codes.iter().all(|&c| (c as usize) < CODEBOOK_SIZE),
            "语义码越界（码本 {CODEBOOK_SIZE}）"
        );
        let ge = self.ref_enc.forward(refer)?;
        // 25 Hz → 50 Hz 最近邻上采样。
        let ids: Vec<i32> = codes.iter().flat_map(|&c| [c as i32; 2]).collect();
        let frames = ids.len() as i32;
        let quantized = self
            .codebook
            .take_axis(&Array::from_slice(&ids, &[frames]), 0)?
            .reshape(&[1, frames, SSL_DIM])?;
        let (mean, log_std) = self.enc_p.forward(&quantized, phones, &ge)?;
        let key = random::key(seed)?;
        let noise = random::normal::<f32>(&[1, frames, INTER], None, None, &key)?;
        let z_p = &mean + noise * log_std.exp()? * noise_scale;
        let z = self.flow.reverse(&z_p, &ge)?;
        let audio = self.dec.forward(&z, &ge)?.as_dtype(Dtype::Float32)?;
        audio.eval()?;
        Ok(audio.as_slice::<f32>().to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// MLX 单测共用一把锁；没有 Metal 设备（沙箱）时跳过，不让 MLX 的 C++ 异常撞进 Rust。
    fn metal() -> Option<std::sync::MutexGuard<'static, ()>> {
        let lock = crate::synthesize::tensor::host::TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        crate::synthesize::tensor::host::ensure_device().ok().map(|()| lock)
    }

    fn host(array: &Array) -> Vec<f32> {
        // MLX 的 `as_slice` 直接读底层缓冲区，切片视图要先 reshape 成连续数组。
        let array = array.reshape(&[-1]).unwrap().as_dtype(Dtype::Float32).unwrap();
        array.eval().unwrap();
        array.as_slice::<f32>().to_vec()
    }

    #[test]
    fn relative_position_conversions_match_index_definitions() {
        let Some(_metal) = metal() else {
            return;
        };
        let l = 4usize;
        let span = 2 * l - 1;
        let rel: Vec<f32> = (0..l * span).map(|v| v as f32 + 1.0).collect();
        let abs = host(&relative_to_absolute(&Array::from_slice(&rel, &[1, 1, l as i32, span as i32])).unwrap());
        assert_eq!(abs.len(), l * l);
        for i in 0..l {
            for j in 0..l {
                assert_eq!(abs[i * l + j], rel[i * span + (j + l - 1 - i)], "abs[{i}][{j}]");
            }
        }

        let dense: Vec<f32> = (0..l * l).map(|v| v as f32 + 1.0).collect();
        let back = host(&absolute_to_relative(&Array::from_slice(&dense, &[1, 1, l as i32, l as i32])).unwrap());
        assert_eq!(back.len(), l * span);
        for i in 0..l {
            for m in 0..span {
                let j = i as isize + m as isize - (l as isize - 1);
                let expected = if (0..l as isize).contains(&j) {
                    dense[i * l + j as usize]
                } else {
                    0.0
                };
                assert_eq!(back[i * span + m], expected, "rel[{i}][{m}]");
            }
        }
    }

    #[test]
    fn relative_embeddings_center_on_window() {
        let Some(_metal) = metal() else {
            return;
        };
        let window = 2 * WINDOW as usize + 1;
        let values: Vec<f32> = (0..window).map(|v| v as f32).collect();
        let table = Array::from_slice(&values, &[1, window as i32, 1]);
        // 短序列：切出中心 2l-1 个。
        assert_eq!(host(&relative_embeddings(&table, 3).unwrap()), vec![2.0, 3.0, 4.0, 5.0, 6.0]);
        // 长序列：两侧各补 l-5 个零。
        let long = host(&relative_embeddings(&table, 7).unwrap());
        assert_eq!(long.len(), 13);
        assert_eq!(&long[..2], &[0.0, 0.0]);
        assert_eq!(&long[2..11], values.as_slice());
        assert_eq!(&long[11..], &[0.0, 0.0]);
    }
}
