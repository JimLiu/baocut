//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2SemanticGPT.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 语义 GPT（对照 speech-swift `IndexTTS2SemanticGPT.swift`）。
//!
//! 组成：
//! - 说话人条件：Conformer 编码器（`conditioning_encoder`，8 头 / FF 2048）→
//!   Perceiver 重采样（`perceiver_encoder`，32 个潜变量）→ `[1, 32, 1280]`；
//! - 情感向量：Conformer（`emo_conditioning_encoder`，4 头 / FF 1024）→ Perceiver
//!   （1 个潜变量，dim 1024）→ `emovec_layer` → `emo_layer` → `[1, 1280]`；
//! - 24 层 GPT-2（conv1D 布局线性层 `x @ W + b`），带分块预分配的 f32 KV 缓存；
//! - 采样：单束 Gumbel-max、束采样（默认宽 3）、贪心束搜索（宿主端纯逻辑在
//!   `index_tts2::sampling`）；
//! - `latent_for_s2mel`：整段无缓存前向，取梅尔段隐状态过 `final_norm`。
//!
//! IndexTTS 2.5（`load_v25`）共用同一个 GPT-2 与情感分支，但没有说话人
//! Conformer / Perceiver 与语速嵌入：条件是 `spk_emb_proj(CAM++ 风格) + 情感向量`
//! 加两个零位置，每个文本位置另加 `lang_embedding[语言 id]`。
//!
//! dtype 策略与 Swift 一致：权重按 safetensors 的 f16 驻留，前向时转成输入 dtype。
//! 说话人 / 情感隐状态是 f32，因此条件编码、预填充与整段前向都在 f32 上跑；
//! 逐 token 解码的输入是 f16 嵌入，块内在 f16 上跑，KV 历史与注意力在 f32 上。

use super::layers::{Conv1d, Conv2d, LayerNorm, Linear, act, ids_1d};
use super::v25_weights;
use super::weights::WeightMap;
use crate::synthesize::index_tts2::config::GptConfig;
use crate::synthesize::index_tts2::sampling::{
    Beam, GenerationOptions, SeededRng, apply_repetition_penalty, apply_temperature, apply_top_k, apply_top_p, best_beams,
    is_beam_sample_done, log_softmax, sample_indices_without_replacement, sample_token, top_log_probs,
};
use crate::synthesize::tensor::fast::{self, ScaledDotProductAttentionMask};
use crate::synthesize::tensor::ops::indexing::{IndexMutOp, IndexOp};
use crate::synthesize::tensor::{Array, Dtype, ops};
use anyhow::{Result, bail, ensure};

/// 调用方返回 false 取消生成时的错误信息。
pub const ABORT_MESSAGE: &str = "IndexTTS2 合成已被调用方取消";

const LN_EPS: f32 = 1e-5;
const SUBSAMPLE_CHANNELS: i32 = 512;
const PERCEIVER_DIM_HEAD: i32 = 64;
const KV_CHUNK: i32 = 256;

/// 保持输入 dtype 的 LayerNorm（Swift `layerNorm` 把仿射参数转成 `x.dtype`）。
fn layer_norm(x: &Array, ln: &LayerNorm) -> Result<Array> {
    let dtype = x.dtype();
    let weight = match &ln.weight {
        Some(w) => Some(w.as_dtype(dtype)?),
        None => None,
    };
    let bias = match &ln.bias {
        Some(b) => Some(b.as_dtype(dtype)?),
        None => None,
    };
    Ok(fast::layer_norm(x, weight.as_ref(), bias.as_ref(), ln.eps)?)
}

fn transpose_0213(x: &Array) -> Result<Array> {
    Ok(x.transpose_axes(&[0, 2, 1, 3])?)
}

/// GPT-2 conv1D 布局的线性层：`y = x @ W + b`，权重 `[in, out]`。
struct ConvLinear {
    weight: Array,
    bias: Option<Array>,
}

impl ConvLinear {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            weight: w.take(&format!("{prefix}.weight"))?,
            bias: w.take_optional(&format!("{prefix}.bias")),
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        #[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
        return crate::synthesize::tensor::linear(x, &self.weight.t(), self.bias.as_ref());
        #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
        {
            let mut y = ops::matmul(x, self.weight.as_dtype(x.dtype())?)?;
            if let Some(bias) = &self.bias {
                y = y + bias.as_dtype(x.dtype())?;
            }
            Ok(y)
        }
    }
}

// ---------------------------------------------------------------------------
// Conformer 条件编码器
// ---------------------------------------------------------------------------

struct RelPosAttention {
    linear_q: Linear,
    linear_k: Linear,
    linear_v: Linear,
    linear_out: Linear,
    linear_pos: Linear,
    pos_bias_u: Array,
    pos_bias_v: Array,
    heads: i32,
}

impl RelPosAttention {
    fn load(w: &mut WeightMap, prefix: &str, heads: i32) -> Result<Self> {
        Ok(Self {
            linear_q: Linear::load(w, &format!("{prefix}.linear_q"))?,
            linear_k: Linear::load(w, &format!("{prefix}.linear_k"))?,
            linear_v: Linear::load(w, &format!("{prefix}.linear_v"))?,
            linear_out: Linear::load(w, &format!("{prefix}.linear_out"))?,
            linear_pos: Linear::load_no_bias(w, &format!("{prefix}.linear_pos"))?,
            pos_bias_u: w.take_f32(&format!("{prefix}.pos_bias_u"))?,
            pos_bias_v: w.take_f32(&format!("{prefix}.pos_bias_v"))?,
            heads,
        })
    }

    /// `x [B, T, D]`，`pos [1, T, D]`。掩码在 Swift 里恒为全 1（整段有效），故省略。
    fn forward(&self, x: &Array, pos: &Array) -> Result<Array> {
        let b = x.dim(0);
        let t = x.dim(1);
        let d = x.dim(2);
        let heads = self.heads;
        let dk = d / heads;
        let dtype = x.dtype();

        let q = self.linear_q.forward(x)?.reshape(&[b, t, heads, dk])?;
        let k = transpose_0213(&self.linear_k.forward(x)?.reshape(&[b, t, heads, dk])?)?;
        let v = transpose_0213(&self.linear_v.forward(x)?.reshape(&[b, t, heads, dk])?)?;
        let p = transpose_0213(&self.linear_pos.forward(pos)?.reshape(&[pos.dim(0), pos.dim(1), heads, dk])?)?;

        let q_u = transpose_0213(&(&q + self.pos_bias_u.as_dtype(dtype)?))?;
        let q_v = transpose_0213(&(&q + self.pos_bias_v.as_dtype(dtype)?))?;
        let scale = 1.0 / (dk as f32).sqrt();
        let scores = (ops::matmul(&q_u, k.transpose_axes(&[0, 1, 3, 2])?)? + ops::matmul(&q_v, p.transpose_axes(&[0, 1, 3, 2])?)?) * scale;
        let attn = ops::softmax_axis(scores.as_dtype(Dtype::Float32)?, -1, None)?.as_dtype(dtype)?;
        let out = transpose_0213(&ops::matmul(&attn, &v)?)?.reshape(&[b, t, d])?;
        self.linear_out.forward(&out)
    }
}

struct ConvolutionModule {
    pointwise_conv1: Conv1d,
    depthwise_conv: Conv1d,
    norm: LayerNorm,
    pointwise_conv2: Conv1d,
}

impl ConvolutionModule {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            pointwise_conv1: Conv1d::load(w, &format!("{prefix}.pointwise_conv1"))?,
            depthwise_conv: Conv1d::load(w, &format!("{prefix}.depthwise_conv"))?
                .with_padding(7)
                .with_groups(SUBSAMPLE_CHANNELS),
            norm: LayerNorm::load(w, &format!("{prefix}.norm"), LN_EPS)?,
            pointwise_conv2: Conv1d::load(w, &format!("{prefix}.pointwise_conv2"))?,
        })
    }

    /// `[B, T, C]` 进出（Swift 在 NCL 上做，等价）。
    fn forward(&self, x: &Array) -> Result<Array> {
        let h = self.pointwise_conv1.forward_nlc(x)?;
        let parts = ops::split(&h, 2, -1)?;
        let h = &parts[0] * ops::sigmoid(&parts[1])?;
        let h = self.depthwise_conv.forward_nlc(&h)?;
        let h = layer_norm(&h, &self.norm)?;
        let h = act::silu(&h)?;
        self.pointwise_conv2.forward_nlc(&h)
    }
}

struct ConformerLayer {
    norm_mha: LayerNorm,
    norm_conv: LayerNorm,
    norm_ff: LayerNorm,
    norm_final: LayerNorm,
    self_attn: RelPosAttention,
    conv_module: ConvolutionModule,
    w_1: Linear,
    w_2: Linear,
}

impl ConformerLayer {
    fn load(w: &mut WeightMap, prefix: &str, heads: i32) -> Result<Self> {
        Ok(Self {
            norm_mha: LayerNorm::load(w, &format!("{prefix}.norm_mha"), LN_EPS)?,
            norm_conv: LayerNorm::load(w, &format!("{prefix}.norm_conv"), LN_EPS)?,
            norm_ff: LayerNorm::load(w, &format!("{prefix}.norm_ff"), LN_EPS)?,
            norm_final: LayerNorm::load(w, &format!("{prefix}.norm_final"), LN_EPS)?,
            self_attn: RelPosAttention::load(w, &format!("{prefix}.self_attn"), heads)?,
            conv_module: ConvolutionModule::load(w, &format!("{prefix}.conv_module"))?,
            w_1: Linear::load(w, &format!("{prefix}.feed_forward.w_1"))?,
            w_2: Linear::load(w, &format!("{prefix}.feed_forward.w_2"))?,
        })
    }

    fn forward(&self, x: &Array, pos: &Array) -> Result<Array> {
        let h = x + self.self_attn.forward(&layer_norm(x, &self.norm_mha)?, pos)?;
        let h = &h + self.conv_module.forward(&layer_norm(&h, &self.norm_conv)?)?;
        let ff = self.w_2.forward(&act::silu(&self.w_1.forward(&layer_norm(&h, &self.norm_ff)?)?)?)?;
        let h = h + ff;
        layer_norm(&h, &self.norm_final)
    }
}

struct ConformerEncoder {
    subsample_conv: Conv2d,
    subsample_out: Linear,
    pos_enc: Array,
    layers: Vec<ConformerLayer>,
    after_norm: LayerNorm,
}

impl ConformerEncoder {
    fn load(w: &mut WeightMap, prefix: &str, blocks: usize, heads: i32) -> Result<Self> {
        let mut layers = Vec::with_capacity(blocks);
        for i in 0..blocks {
            layers.push(ConformerLayer::load(w, &format!("{prefix}.encoders.{i}"), heads)?);
        }
        Ok(Self {
            subsample_conv: Conv2d::load(w, &format!("{prefix}.embed.conv.0"))?.with_stride((2, 2)),
            subsample_out: Linear::load(w, &format!("{prefix}.embed.out.0"))?,
            pos_enc: w.take(&format!("{prefix}.embed.pos_enc.pe"))?,
            layers,
            after_norm: LayerNorm::load(w, &format!("{prefix}.after_norm"), LN_EPS)?,
        })
    }

    /// `hidden [B, T, 1024]` → `[B, T', 512]`（T' = (T-3)/2+1）。
    fn forward(&self, hidden: &Array) -> Result<Array> {
        // Swift：NCHW `[B, 1, T, C]` 做 3×3/步长 2 卷积；这里用 NHWC `[B, T, C, 1]`。
        let x = hidden.expand_dims(-1)?;
        let h = self.subsample_conv.forward_nhwc(&x)?; // [B, T', C', 512]
        let h = ops::maximum(&h, Array::from_f32(0.0))?;
        let b = h.dim(0);
        let t = h.dim(1);
        let f = h.dim(2);
        let c = h.dim(3);
        // NCHW 的 transposed(0,2,1,3).reshaped([b, t, c*f]) 等价于 NHWC 交换后两轴再展平。
        let h = h.swap_axes(2, 3)?.reshape(&[b, t, c * f])?;
        let mut h = self.subsample_out.forward(&h)? * (SUBSAMPLE_CHANNELS as f32).sqrt();
        ensure!(
            t <= self.pos_enc.dim(1),
            "参考音频过长：Conformer 位置编码只有 {} 帧，收到 {t}",
            self.pos_enc.dim(1)
        );
        let pos = self.pos_enc.index((.., ..t, ..)).as_dtype(h.dtype())?;
        for layer in &self.layers {
            h = layer.forward(&h, &pos)?;
        }
        let h = layer_norm(&h, &self.after_norm)?;
        h.eval()?;
        Ok(h)
    }
}

// ---------------------------------------------------------------------------
// Perceiver 重采样
// ---------------------------------------------------------------------------

struct PerceiverLayer {
    to_q: Linear,
    to_kv: Linear,
    to_out: Linear,
    ff_in: Linear,
    ff_out: Linear,
}

struct Perceiver {
    latents: Array,
    proj_context: Linear,
    layers: Vec<PerceiverLayer>,
    gamma: Array,
    heads: i32,
    dim: i32,
    num_latents: i32,
}

impl Perceiver {
    fn load(w: &mut WeightMap, prefix: &str, heads: i32) -> Result<Self> {
        let latents = w.take(&format!("{prefix}.latents"))?;
        let dim = latents.dim(1);
        let num_latents = latents.dim(0);
        let mut layers = Vec::with_capacity(2);
        for i in 0..2 {
            layers.push(PerceiverLayer {
                to_q: Linear::load_no_bias(w, &format!("{prefix}.layers.{i}.0.to_q"))?,
                to_kv: Linear::load_no_bias(w, &format!("{prefix}.layers.{i}.0.to_kv"))?,
                to_out: Linear::load_no_bias(w, &format!("{prefix}.layers.{i}.0.to_out"))?,
                ff_in: Linear::load(w, &format!("{prefix}.layers.{i}.1.0"))?,
                ff_out: Linear::load(w, &format!("{prefix}.layers.{i}.1.2"))?,
            });
        }
        Ok(Self {
            latents,
            proj_context: Linear::load(w, &format!("{prefix}.proj_context"))?,
            layers,
            gamma: w.take_f32(&format!("{prefix}.norm.gamma"))?,
            heads,
            dim,
            num_latents,
        })
    }

    fn attention(&self, layer: &PerceiverLayer, x: &Array, context: &Array) -> Result<Array> {
        let b = x.dim(0);
        let q_len = x.dim(1);
        let heads = self.heads;
        let full_context = ops::concatenate_axis(&[x, context], 1)?;
        let context_len = full_context.dim(1);
        let q = transpose_0213(&layer.to_q.forward(x)?.reshape(&[b, q_len, heads, PERCEIVER_DIM_HEAD])?)?;
        let kv = layer.to_kv.forward(&full_context)?;
        let parts = ops::split(&kv, 2, -1)?;
        let k = transpose_0213(&parts[0].reshape(&[b, context_len, heads, PERCEIVER_DIM_HEAD])?)?;
        let v = transpose_0213(&parts[1].reshape(&[b, context_len, heads, PERCEIVER_DIM_HEAD])?)?;
        let attn = fast::scaled_dot_product_attention(
            &q,
            &k,
            &v,
            1.0 / (PERCEIVER_DIM_HEAD as f32).sqrt(),
            None::<ScaledDotProductAttentionMask<'_>>,
            None,
        )?;
        let out = transpose_0213(&attn)?.reshape(&[b, q_len, heads * PERCEIVER_DIM_HEAD])?;
        layer.to_out.forward(&out)
    }

    fn feed_forward(&self, layer: &PerceiverLayer, x: &Array) -> Result<Array> {
        let projected = layer.ff_in.forward(x)?;
        let parts = ops::split(&projected, 2, -1)?;
        let activated = act::gelu_tanh(&parts[1])? * &parts[0];
        layer.ff_out.forward(&activated)
    }

    fn rms_norm(&self, x: &Array) -> Result<Array> {
        let norm = ((x * x).sum_axis(-1, true)? + 1e-12f32).sqrt()?;
        let scale = (x.dim(-1) as f32).sqrt();
        Ok(x / norm * scale * self.gamma.as_dtype(x.dtype())?)
    }

    /// `x [B, T, 512]` → `[B, latents, dim]`。
    fn forward(&self, x: &Array) -> Result<Array> {
        let batch = x.dim(0);
        let context = self.proj_context.forward(x)?;
        let mut h = ops::broadcast_to(
            &self.latents.expand_dims(0)?.as_dtype(context.dtype())?,
            &[batch, self.num_latents, self.dim],
        )?;
        for layer in &self.layers {
            h = &h + self.attention(layer, &h, &context)?;
            h = &h + self.feed_forward(layer, &h)?;
        }
        self.rms_norm(&h)
    }
}

// ---------------------------------------------------------------------------
// KV 缓存
// ---------------------------------------------------------------------------

trait KvCache {
    /// 追加本层本步的 `[B, heads, T, headDim]` 键值，返回可注意的全部历史（f32）。
    fn update(&mut self, layer: usize, keys: Array, values: Array) -> Result<(Array, Array)>;
    /// 每次前向结束后推进偏移。
    fn commit(&mut self, tokens: i32);
}

/// 逐步拼接的缓存（值语义，可克隆分叉），用于贪心束搜索。
#[derive(Clone)]
struct ConcatKvCache {
    layers: Vec<Option<(Array, Array)>>,
}

impl ConcatKvCache {
    fn new(layer_count: usize) -> Self {
        Self {
            layers: vec![None; layer_count],
        }
    }
}

impl KvCache for ConcatKvCache {
    fn update(&mut self, layer: usize, keys: Array, values: Array) -> Result<(Array, Array)> {
        let keys = keys.as_dtype(Dtype::Float32)?;
        let values = values.as_dtype(Dtype::Float32)?;
        let (k, v) = match &self.layers[layer] {
            Some((pk, pv)) => (ops::concatenate_axis(&[pk, &keys], 2)?, ops::concatenate_axis(&[pv, &values], 2)?),
            None => (keys, values),
        };
        self.layers[layer] = Some((k.clone(), v.clone()));
        Ok((k, v))
    }

    fn commit(&mut self, _tokens: i32) {}
}

/// 批量采样路径的缓存：按 256 步分块预分配、原地写入；`reorder_rows` 按父束重排行。
/// 历史与注意力都在 f32 上（与 Swift 一致）。
struct BatchedKvCache {
    buffers: Vec<Option<(Array, Array)>>,
    offset: i32,
}

impl BatchedKvCache {
    fn new(layer_count: usize) -> Self {
        Self {
            buffers: vec![None; layer_count],
            offset: 0,
        }
    }

    fn reorder_rows(&mut self, parents: &[i32]) -> Result<()> {
        if let Some((k, _)) = self.buffers.iter().flatten().next()
            && k.dim(0) == parents.len() as i32
            && parents.iter().enumerate().all(|(i, &p)| i as i32 == p)
        {
            return Ok(());
        }
        let ids = ids_1d(parents);
        for entry in self.buffers.iter_mut() {
            if let Some((k, v)) = entry {
                *entry = Some((k.take_axis(&ids, 0)?, v.take_axis(&ids, 0)?));
            }
        }
        Ok(())
    }
}

impl KvCache for BatchedKvCache {
    fn update(&mut self, layer: usize, keys: Array, values: Array) -> Result<(Array, Array)> {
        let keys = keys.as_dtype(Dtype::Float32)?;
        let values = values.as_dtype(Dtype::Float32)?;
        let end = self.offset + keys.dim(2);
        let rounded = (end + KV_CHUNK - 1) / KV_CHUNK * KV_CHUNK;
        match &self.buffers[layer] {
            None => {
                let shape = [keys.dim(0), keys.dim(1), rounded, keys.dim(3)];
                self.buffers[layer] = Some((ops::zeros_dtype(&shape, Dtype::Float32)?, ops::zeros_dtype(&shape, Dtype::Float32)?));
            }
            Some((k, v)) if end > k.dim(2) => {
                let pad = [k.dim(0), k.dim(1), rounded - k.dim(2), k.dim(3)];
                let zeros = ops::zeros_dtype(&pad, Dtype::Float32)?;
                self.buffers[layer] = Some((ops::concatenate_axis(&[k, &zeros], 2)?, ops::concatenate_axis(&[v, &zeros], 2)?));
            }
            _ => {}
        }
        let (bk, bv) = self.buffers[layer].as_mut().expect("缓存已分配");
        bk.index_mut((.., .., self.offset..end, ..), &keys);
        bv.index_mut((.., .., self.offset..end, ..), &values);
        Ok((bk.index((.., .., ..end, ..)), bv.index((.., .., ..end, ..))))
    }

    fn commit(&mut self, tokens: i32) {
        self.offset += tokens;
    }
}

// ---------------------------------------------------------------------------
// GPT-2 块
// ---------------------------------------------------------------------------

struct GptBlock {
    ln_1: LayerNorm,
    ln_2: LayerNorm,
    c_attn: ConvLinear,
    c_proj: ConvLinear,
    c_fc: ConvLinear,
    mlp_proj: ConvLinear,
}

impl GptBlock {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            ln_1: LayerNorm::load(w, &format!("{prefix}.ln_1"), LN_EPS)?,
            ln_2: LayerNorm::load(w, &format!("{prefix}.ln_2"), LN_EPS)?,
            c_attn: ConvLinear::load(w, &format!("{prefix}.attn.c_attn"))?,
            c_proj: ConvLinear::load(w, &format!("{prefix}.attn.c_proj"))?,
            c_fc: ConvLinear::load(w, &format!("{prefix}.mlp.c_fc"))?,
            mlp_proj: ConvLinear::load(w, &format!("{prefix}.mlp.c_proj"))?,
        })
    }

    fn mlp(&self, x: &Array) -> Result<Array> {
        self.mlp_proj.forward(&act::gelu_tanh(&self.c_fc.forward(x)?)?)
    }
}

/// 语义 GPT 及其条件编码器。
pub struct SemanticGpt {
    layers: usize,
    heads: i32,
    head_dim: i32,
    model_dim: i32,
    codebook_size: i32,
    start_mel_token: i32,
    stop_mel_token: i32,
    start_text_token: i32,
    stop_text_token: i32,
    /// 说话人 Conformer / Perceiver 与语速嵌入：只有 2.0 检查点有。
    conditioning_encoder: Option<ConformerEncoder>,
    perceiver: Option<Perceiver>,
    emo_conditioning_encoder: ConformerEncoder,
    emo_perceiver: Perceiver,
    emovec_layer: Linear,
    emo_layer: Linear,
    blocks: Vec<GptBlock>,
    ln_f: LayerNorm,
    final_norm: LayerNorm,
    mel_head: Linear,
    mel_embedding: Array,
    mel_pos_embedding: Array,
    text_embedding: Array,
    text_pos_embedding: Array,
    speed_emb: Option<Array>,
    /// CAM++ 风格 192 → 1280 投影与语言嵌入表：只有 2.5 检查点有。
    spk_emb_proj: Option<Linear>,
    lang_embedding: Option<Array>,
}

impl SemanticGpt {
    /// IndexTTS2 检查点（`aufklarer/IndexTTS2-MLX-fp16`）。
    pub fn load(w: WeightMap, config: &GptConfig, codebook_size: usize) -> Result<Self> {
        Self::load_checkpoint(w, config, codebook_size, false)
    }

    /// IndexTTS 2.5 检查点（`mlx-community/IndexTTS-2.5-fp16`）：先重映射到 2.0 布局。
    pub fn load_v25(mut w: WeightMap, config: &GptConfig, codebook_size: usize) -> Result<Self> {
        v25_weights::remap_gpt(&mut w)?;
        Self::load_checkpoint(w, config, codebook_size, true)
    }

    fn load_checkpoint(mut w: WeightMap, config: &GptConfig, codebook_size: usize, v25: bool) -> Result<Self> {
        ensure!(
            config.condition_type == "conformer_perceiver",
            "IndexTTS2 仅支持 conformer_perceiver 条件类型，收到 {}",
            config.condition_type
        );
        let model_dim = config.model_dim as i32;
        let heads = config.heads as i32;
        ensure!(heads > 0 && model_dim % heads == 0, "GPT model_dim 必须能被 heads 整除");
        let mut blocks = Vec::with_capacity(config.layers);
        for i in 0..config.layers {
            blocks.push(GptBlock::load(&mut w, &format!("gpt.h.{i}"))?);
        }
        Ok(Self {
            layers: config.layers,
            heads,
            head_dim: model_dim / heads,
            model_dim,
            codebook_size: codebook_size as i32,
            start_mel_token: config.start_mel_token as i32,
            stop_mel_token: config.stop_mel_token as i32,
            start_text_token: config.start_text_token as i32,
            stop_text_token: config.stop_text_token as i32,
            conditioning_encoder: if v25 {
                None
            } else {
                Some(ConformerEncoder::load(
                    &mut w,
                    "conditioning_encoder",
                    config.condition_num_blocks,
                    8,
                )?)
            },
            perceiver: if v25 {
                None
            } else {
                Some(Perceiver::load(&mut w, "perceiver_encoder", 8)?)
            },
            emo_conditioning_encoder: ConformerEncoder::load(&mut w, "emo_conditioning_encoder", config.emo_condition_num_blocks, 4)?,
            emo_perceiver: Perceiver::load(&mut w, "emo_perceiver_encoder", 4)?,
            emovec_layer: Linear::load(&mut w, "emovec_layer")?,
            emo_layer: Linear::load(&mut w, "emo_layer")?,
            blocks,
            ln_f: LayerNorm::load(&mut w, "gpt.ln_f", LN_EPS)?,
            final_norm: LayerNorm::load(&mut w, "final_norm", LN_EPS)?,
            mel_head: Linear::load(&mut w, "mel_head")?,
            mel_embedding: w.take("mel_embedding.weight")?,
            mel_pos_embedding: w.take("mel_pos_embedding.emb.weight")?,
            text_embedding: w.take("text_embedding.weight")?,
            text_pos_embedding: w.take("text_pos_embedding.emb.weight")?,
            speed_emb: if v25 { None } else { Some(w.take("speed_emb.weight")?) },
            spk_emb_proj: if v25 { Some(Linear::load(&mut w, "spk_emb_proj")?) } else { None },
            lang_embedding: if v25 { Some(w.take("lang_embedding.weight")?) } else { None },
        })
    }

    // ---- 条件 ------------------------------------------------------------

    /// 说话人语义隐状态 `[1, T, 1024]` → 潜变量 `[1, 32, 1280]`。
    pub fn speaker_conditioning(&self, hidden: &Array) -> Result<Array> {
        let (Some(encoder), Some(perceiver)) = (&self.conditioning_encoder, &self.perceiver) else {
            bail!("IndexTTS 2.5 GPT 没有说话人 Conformer 条件");
        };
        let encoded = encoder.forward(hidden)?;
        let latent = perceiver.forward(&encoded)?;
        latent.eval()?;
        Ok(latent)
    }

    /// 情感语义隐状态 `[1, T, 1024]` → 情感向量 `[1, 1280]`。
    pub fn emotion_vector(&self, hidden: &Array) -> Result<Array> {
        let encoded = self.emo_conditioning_encoder.forward(hidden)?;
        let latent = self.emo_perceiver.forward(&encoded)?.squeeze_axes(&[1])?;
        let vector = self.emo_layer.forward(&self.emovec_layer.forward(&latent)?)?;
        vector.eval()?;
        Ok(vector)
    }

    /// 合并显式情感向量：`override + (1 − weightSum) · base`（官方 `infer()` 原式，不夹取）。
    pub fn resolved_emotion_vector(base: &Array, override_vector: Option<&Array>, weight_sum: f32) -> Result<Array> {
        match override_vector {
            Some(v) => {
                let residual = 1.0 - weight_sum;
                Ok(v.as_dtype(base.dtype())? + base * residual)
            }
            None => Ok(base.clone()),
        }
    }

    /// `[speakerLatent + emotion, speed_emb[1], speed_emb[0]]` → `[1, 34, 1280]`。
    fn prefix_conditioning(&self, speaker_latent: &Array, emotion: &Array) -> Result<Array> {
        let Some(speed_emb) = &self.speed_emb else {
            bail!("IndexTTS 2.5 GPT 没有语速嵌入，应走 generate_semantic_codes_v25");
        };
        let dtype = speaker_latent.dtype();
        let conditioned = speaker_latent + emotion.as_dtype(dtype)?.expand_dims(1)?;
        let fast_speed = speed_emb.index((1..2, ..)).expand_dims(0)?.as_dtype(dtype)?;
        let slow_speed = speed_emb.index((0..1, ..)).expand_dims(0)?.as_dtype(dtype)?;
        Ok(ops::concatenate_axis(&[&conditioned, &fast_speed, &slow_speed], 1)?)
    }

    /// 2.5 条件（官方 `UnifiedVoice.inference_speech`）：
    /// `[spk_emb_proj(style) + emotion, 0, 0]` → `[1, 3, 1280]`。
    fn style_conditioning(&self, style: &Array, emotion: &Array) -> Result<Array> {
        let Some(projection) = &self.spk_emb_proj else {
            bail!("GPT 检查点没有 spk_emb_proj，不是 IndexTTS 2.5");
        };
        let speaker = projection.forward(&style.reshape(&[1, -1])?)?; // [1, 1280]
        let dtype = speaker.dtype();
        let conditioned = (speaker + emotion.as_dtype(dtype)?.reshape(&[1, -1])?).expand_dims(1)?;
        let padding = ops::zeros_dtype(&[1, 2, self.model_dim], dtype)?;
        Ok(ops::concatenate_axis(&[&conditioned, &padding], 1)?)
    }

    /// 2.5 文本嵌入：token + 位置 + 该段语言的 `lang_embedding` 行（加到每个文本位置）。
    fn text_embeddings_v25(&self, ids: &[i32], language_id: usize) -> Result<Array> {
        let Some(table) = &self.lang_embedding else {
            bail!("GPT 检查点没有 lang_embedding，不是 IndexTTS 2.5");
        };
        let row = language_id as i32;
        ensure!(row < table.dim(0), "语言 id {row} 超出 lang_embedding 表（{} 行）", table.dim(0));
        let text = self.text_embeddings(ids)?;
        let language = table.index((row..row + 1, ..)).expand_dims(0)?.as_dtype(text.dtype())?;
        Ok(text + language)
    }

    fn text_input(&self, text_tokens: &[i32]) -> Vec<i32> {
        let mut ids = Vec::with_capacity(text_tokens.len() + 2);
        ids.push(self.start_text_token);
        ids.extend_from_slice(text_tokens);
        ids.push(self.stop_text_token);
        ids
    }

    fn embed(table: &Array, ids: &[i32]) -> Result<Array> {
        Ok(table.index(&ids_1d(ids)).expand_dims(0)?)
    }

    fn embeddings_with_positions(table: &Array, pos_table: &Array, ids: &[i32]) -> Result<Array> {
        let token = Self::embed(table, ids)?;
        let n = ids.len() as i32;
        ensure!(n <= pos_table.dim(0), "序列长度 {n} 超过位置表容量 {}", pos_table.dim(0));
        let pos = pos_table.index((..n, ..)).expand_dims(0)?.as_dtype(token.dtype())?;
        Ok(token + pos)
    }

    fn text_embeddings(&self, ids: &[i32]) -> Result<Array> {
        Self::embeddings_with_positions(&self.text_embedding, &self.text_pos_embedding, ids)
    }

    fn mel_embeddings(&self, ids: &[i32]) -> Result<Array> {
        Self::embeddings_with_positions(&self.mel_embedding, &self.mel_pos_embedding, ids)
    }

    /// 生成期的梅尔位置：索引 0 → 位置 0，其后 `melIndex + 1`。
    fn mel_position_embedding(&self, mel_index: i32, dtype: Dtype) -> Result<Array> {
        let position = if mel_index == 0 { 0 } else { mel_index + 1 };
        ensure!(
            position < self.mel_pos_embedding.dim(0),
            "生成的语义 token 数超过梅尔位置表容量 {}",
            self.mel_pos_embedding.dim(0)
        );
        Ok(self
            .mel_pos_embedding
            .index((position..position + 1, ..))
            .expand_dims(0)?
            .as_dtype(dtype)?)
    }

    fn mel_token_embedding(&self, token: i32, mel_index: i32) -> Result<Array> {
        let tok = Self::embed(&self.mel_embedding, &[token])?;
        let pos = self.mel_position_embedding(mel_index, tok.dtype())?;
        Ok(tok + pos)
    }

    // ---- GPT 前向 ----------------------------------------------------------

    fn attention_cached<C: KvCache>(&self, block: &GptBlock, x: &Array, layer: usize, cache: &mut C) -> Result<Array> {
        let b = x.dim(0);
        let t = x.dim(1);
        let qkv = block.c_attn.forward(x)?;
        let parts = ops::split(&qkv, 3, -1)?;
        let q = transpose_0213(&parts[0].reshape(&[b, t, self.heads, self.head_dim])?)?;
        let k = transpose_0213(&parts[1].reshape(&[b, t, self.heads, self.head_dim])?)?;
        let v = transpose_0213(&parts[2].reshape(&[b, t, self.heads, self.head_dim])?)?;
        let (k, v) = cache.update(layer, k, v)?;
        // 预填充是空缓存上的方阵因果掩码；单 token 步注意全部历史。
        let mask = if t > 1 { Some(ScaledDotProductAttentionMask::Causal) } else { None };
        let out = fast::scaled_dot_product_attention(q.as_dtype(k.dtype())?, &k, &v, 1.0 / (self.head_dim as f32).sqrt(), mask, None)?;
        let merged = transpose_0213(&out.as_dtype(x.dtype())?)?.reshape(&[b, t, self.model_dim])?;
        block.c_proj.forward(&merged)
    }

    fn cached_forward<C: KvCache>(&self, x: &Array, cache: &mut C) -> Result<Array> {
        let mut h = x.clone();
        for (i, block) in self.blocks.iter().enumerate() {
            let a = self.attention_cached(block, &layer_norm(&h, &block.ln_1)?, i, cache)?;
            h = &h + a;
            let m = block.mlp(&layer_norm(&h, &block.ln_2)?)?;
            h = &h + m;
        }
        cache.commit(x.dim(1));
        layer_norm(&h, &self.ln_f)
    }

    fn attention_full(&self, block: &GptBlock, x: &Array) -> Result<Array> {
        let b = x.dim(0);
        let t = x.dim(1);
        let qkv = block.c_attn.forward(x)?;
        let parts = ops::split(&qkv, 3, -1)?;
        let q = transpose_0213(&parts[0].reshape(&[b, t, self.heads, self.head_dim])?)?;
        let k = transpose_0213(&parts[1].reshape(&[b, t, self.heads, self.head_dim])?)?;
        let v = transpose_0213(&parts[2].reshape(&[b, t, self.heads, self.head_dim])?)?;
        let out = fast::scaled_dot_product_attention(
            &q,
            &k,
            &v,
            1.0 / (self.head_dim as f32).sqrt(),
            Some(ScaledDotProductAttentionMask::Causal),
            None,
        )?;
        let merged = transpose_0213(&out)?.reshape(&[b, t, self.model_dim])?;
        block.c_proj.forward(&merged)
    }

    /// 整段无缓存前向。
    fn forward_full(&self, embeddings: &Array) -> Result<Array> {
        let mut h = embeddings.clone();
        for block in &self.blocks {
            let a = self.attention_full(block, &layer_norm(&h, &block.ln_1)?)?;
            h = &h + a;
            let m = block.mlp(&layer_norm(&h, &block.ln_2)?)?;
            h = &h + m;
        }
        layer_norm(&h, &self.ln_f)
    }

    /// 最后一个位置的隐状态 → `final_norm` → `mel_head` → `[B, 8194]`。
    fn mel_logits(&self, hidden: &Array) -> Result<Array> {
        let t = hidden.dim(1);
        let last = hidden.index((.., (t - 1)..t, ..));
        let normalized = layer_norm(&last, &self.final_norm)?;
        Ok(self.mel_head.forward(&normalized)?.squeeze_axes(&[1])?)
    }

    fn prefill_mel_logits<C: KvCache>(&self, prefix_text: &Array, cache: &mut C) -> Result<Array> {
        let start = self.mel_token_embedding(self.start_mel_token, 0)?;
        let hidden = self.cached_forward(&ops::concatenate_axis(&[prefix_text, &start], 1)?, cache)?;
        self.mel_logits(&hidden)
    }

    fn step_mel_logits<C: KvCache>(&self, token: i32, mel_index: i32, cache: &mut C) -> Result<Array> {
        let hidden = self.cached_forward(&self.mel_token_embedding(token, mel_index)?, cache)?;
        self.mel_logits(&hidden)
    }

    /// 每束一个 token（同一梅尔索引）批量前向，返回 `[beams, vocab]`。
    fn batched_step_mel_logits(&self, tokens: &[i32], mel_index: i32, cache: &mut BatchedKvCache) -> Result<Array> {
        let tok = Self::embed(&self.mel_embedding, tokens)?.transpose_axes(&[1, 0, 2])?;
        let pos = self.mel_position_embedding(mel_index, tok.dtype())?;
        let hidden = self.cached_forward(&(tok + pos), cache)?;
        self.mel_logits(&hidden)
    }

    fn logits_to_host(logits: &Array) -> Result<Vec<f32>> {
        let values = logits.as_dtype(Dtype::Float32)?;
        values.eval()?;
        Ok(values.as_slice::<f32>().to_vec())
    }

    // ---- 生成 --------------------------------------------------------------

    /// 生成语义码（`generateSemanticCodes`）。`progress(已生成 token 数)` 返回 false 则取消。
    pub fn generate_semantic_codes(
        &self,
        text_tokens: &[i32],
        speaker_latent: &Array,
        emotion: &Array,
        options: &GenerationOptions,
        progress: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<i32>> {
        ensure!(!text_tokens.is_empty(), "IndexTTS2 文本 token 为空");
        let prefix = self.prefix_conditioning(speaker_latent, emotion)?;
        let text_emb = self.text_embeddings(&self.text_input(text_tokens))?;
        let prefix_text = ops::concatenate_axis(&[&prefix, &text_emb], 1)?;
        self.generate_from_prefix(&prefix_text, options, progress)
    }

    /// IndexTTS 2.5 生成语义码。`text_tokens` 是 tiktoken 输出（含 `<|lang|> ` 前缀，
    /// 可带起止 token）；与官方一致先剔除起止 token 再补 `[start, …, stop]`。
    pub fn generate_semantic_codes_v25(
        &self,
        text_tokens: &[i32],
        language_id: usize,
        style: &Array,
        emotion: &Array,
        options: &GenerationOptions,
        progress: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<i32>> {
        let content: Vec<i32> = text_tokens
            .iter()
            .copied()
            .filter(|&t| t != self.start_text_token && t != self.stop_text_token)
            .collect();
        ensure!(!content.is_empty(), "IndexTTS 2.5 文本 token 为空");
        let text_emb = self.text_embeddings_v25(&self.text_input(&content), language_id)?;
        let prefix = self.style_conditioning(style, emotion)?.as_dtype(text_emb.dtype())?;
        let prefix_text = ops::concatenate_axis(&[&prefix, &text_emb], 1)?;
        self.generate_from_prefix(&prefix_text, options, progress)
    }

    fn generate_from_prefix(
        &self,
        prefix_text: &Array,
        options: &GenerationOptions,
        progress: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<i32>> {
        let prefix_text = prefix_text.clone();
        if options.beam_width > 1 {
            if options.greedy {
                self.beam_search_semantic_codes(&prefix_text, options, progress)
            } else {
                self.beam_sample_semantic_codes(&prefix_text, options, progress)
            }
        } else {
            self.sample_semantic_codes(&prefix_text, options, progress)
        }
    }

    fn sample_semantic_codes(
        &self,
        prefix_text: &Array,
        options: &GenerationOptions,
        progress: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<i32>> {
        let mut rng = SeededRng::new(options.seed);
        let mut cache = BatchedKvCache::new(self.layers);
        let mut logits = self.prefill_mel_logits(prefix_text, &mut cache)?;
        let mut generated: Vec<i32> = Vec::new();
        for _ in 0..options.max_semantic_tokens {
            let values = Self::logits_to_host(&logits)?;
            let next = sample_token(values, &generated, options, &mut rng);
            if next == self.stop_mel_token || next < 0 || next >= self.codebook_size {
                break;
            }
            generated.push(next);
            if !progress(generated.len()) {
                bail!(ABORT_MESSAGE);
            }
            logits = self.step_mel_logits(next, generated.len() as i32, &mut cache)?;
        }
        Ok(generated)
    }

    /// 束采样（默认路径）：所有活跃束共享一个批量缓存，按父束重排行。
    fn beam_sample_semantic_codes(
        &self,
        prefix_text: &Array,
        options: &GenerationOptions,
        progress: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<i32>> {
        let width = options.beam_width.max(1);
        let stop = self.stop_mel_token;
        let samples_per_step = (width * 2).max(2);
        let mut rng = SeededRng::new(options.seed);
        let mut active = vec![Beam::empty()];
        let mut cache = BatchedKvCache::new(self.layers);
        let mut batched_logits = self.prefill_mel_logits(prefix_text, &mut cache)?;
        let mut completed: Vec<Beam> = Vec::new();

        for _ in 0..options.max_semantic_tokens {
            let vocab = batched_logits.dim(-1) as usize;
            let float_logits = batched_logits.as_dtype(Dtype::Float32)?;
            let log_probs = &float_logits - float_logits.logsumexp_axis(-1, true)?;
            let all_scores = Self::logits_to_host(&log_probs)?;

            struct Candidate {
                beam_index: usize,
                token: i32,
                score: f32,
            }
            let mut candidates: Vec<Candidate> = Vec::new();
            for (beam_index, beam) in active.iter().enumerate() {
                let mut scores = all_scores[beam_index * vocab..(beam_index + 1) * vocab].to_vec();
                apply_repetition_penalty(&mut scores, &beam.tokens, options.repetition_penalty);
                apply_temperature(&mut scores, options.temperature);
                apply_top_k(&mut scores, options.top_k, 2);
                apply_top_p(&mut scores, options.top_p, 2);
                for (token, &score) in scores.iter().enumerate() {
                    if score.is_finite() {
                        candidates.push(Candidate {
                            beam_index,
                            token: token as i32,
                            score: beam.score + score,
                        });
                    }
                }
            }
            if candidates.is_empty() {
                break;
            }

            let candidate_scores: Vec<f32> = candidates.iter().map(|c| c.score).collect();
            let sampled_indices = sample_indices_without_replacement(&candidate_scores, samples_per_step, &mut rng);
            let mut sampled: Vec<usize> = sampled_indices.clone();
            if sampled.len() < samples_per_step {
                let taken: std::collections::HashSet<usize> = sampled_indices.iter().copied().collect();
                let mut rest: Vec<usize> = (0..candidates.len()).filter(|i| !taken.contains(i)).collect();
                rest.sort_by(|&a, &b| {
                    candidates[b]
                        .score
                        .partial_cmp(&candidates[a].score)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                sampled.extend(rest.into_iter().take(samples_per_step - sampled.len()));
            }
            sampled.sort_by(|&a, &b| {
                candidates[b]
                    .score
                    .partial_cmp(&candidates[a].score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

            let mut next_active: Vec<Beam> = Vec::with_capacity(width);
            let mut parents: Vec<i32> = Vec::with_capacity(width);
            let mut step_tokens: Vec<i32> = Vec::with_capacity(width);
            for (rank, &index) in sampled.iter().enumerate() {
                let candidate = &candidates[index];
                let source = &active[candidate.beam_index];
                if candidate.token == stop {
                    if rank < width {
                        completed.push(Beam {
                            tokens: source.tokens.clone(),
                            score: candidate.score,
                            ended: true,
                        });
                    }
                    continue;
                }
                if candidate.token < 0 || candidate.token >= self.codebook_size {
                    continue;
                }
                let mut tokens = source.tokens.clone();
                tokens.push(candidate.token);
                next_active.push(Beam {
                    tokens,
                    score: candidate.score,
                    ended: false,
                });
                parents.push(candidate.beam_index as i32);
                step_tokens.push(candidate.token);
                if next_active.len() == width {
                    break;
                }
            }

            active = next_active;
            completed = best_beams(&completed, width, options.length_penalty);
            if active.is_empty() || is_beam_sample_done(&active, &completed, width, options.length_penalty) {
                break;
            }
            let generated = active[0].tokens.len();
            if !progress(generated) {
                bail!(ABORT_MESSAGE);
            }
            cache.reorder_rows(&parents)?;
            batched_logits = self.batched_step_mel_logits(&step_tokens, generated as i32, &mut cache)?;
        }

        let mut pool = completed;
        pool.extend(active);
        let best = best_beams(&pool, 1, options.length_penalty);
        Ok(best.into_iter().next().map(|b| b.tokens).unwrap_or_default())
    }

    /// 贪心束搜索（`greedy && beamWidth > 1`）：每束各自持有可分叉的拼接缓存。
    fn beam_search_semantic_codes(
        &self,
        prefix_text: &Array,
        options: &GenerationOptions,
        progress: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<i32>> {
        let width = options.beam_width.max(1);
        let stop = self.stop_mel_token;
        struct State {
            beam: Beam,
            cache: ConcatKvCache,
            logits: Option<Array>,
        }
        let mut states = vec![State {
            beam: Beam::empty(),
            cache: ConcatKvCache::new(self.layers),
            logits: None,
        }];

        for _ in 0..options.max_semantic_tokens {
            struct Candidate {
                state: usize,
                token: i32,
                score: f32,
            }
            let mut candidates: Vec<Candidate> = Vec::new();
            let mut all_ended = true;
            for (index, state) in states.iter_mut().enumerate() {
                if state.beam.ended {
                    candidates.push(Candidate {
                        state: index,
                        token: stop,
                        score: state.beam.score,
                    });
                    continue;
                }
                all_ended = false;
                let logits = match state.logits.take() {
                    Some(l) => l,
                    None => self.prefill_mel_logits(prefix_text, &mut state.cache)?,
                };
                let mut values = Self::logits_to_host(&logits)?;
                apply_repetition_penalty(&mut values, &state.beam.tokens, options.repetition_penalty);
                let log_probs = log_softmax(&values);
                for (token, log_prob) in top_log_probs(&log_probs, width * 2) {
                    candidates.push(Candidate {
                        state: index,
                        token,
                        score: state.beam.score + log_prob,
                    });
                }
            }
            if all_ended || candidates.is_empty() {
                break;
            }
            let ranked: Vec<(usize, Beam)> = {
                let mut items: Vec<(usize, Beam)> = candidates
                    .iter()
                    .map(|c| {
                        let source = &states[c.state].beam;
                        if source.ended {
                            return (c.state, source.clone());
                        }
                        let mut tokens = source.tokens.clone();
                        let ended = c.token == stop || c.token < 0 || c.token >= self.codebook_size;
                        if !ended {
                            tokens.push(c.token);
                        }
                        (
                            c.state,
                            Beam {
                                tokens,
                                score: c.score,
                                ended,
                            },
                        )
                    })
                    .collect();
                items.sort_by(|a, b| {
                    let lhs = a.1.ranking_score(options.length_penalty);
                    let rhs = b.1.ranking_score(options.length_penalty);
                    if lhs != rhs {
                        rhs.partial_cmp(&lhs).unwrap_or(std::cmp::Ordering::Equal)
                    } else {
                        b.1.tokens.len().cmp(&a.1.tokens.len())
                    }
                });
                items.truncate(width);
                items
            };
            let mut next_states = Vec::with_capacity(ranked.len());
            for (source, beam) in ranked {
                let mut cache = states[source].cache.clone();
                let logits = if beam.ended {
                    None
                } else {
                    let token = *beam.tokens.last().expect("未结束的束至少有一个 token");
                    Some(self.step_mel_logits(token, beam.tokens.len() as i32, &mut cache)?)
                };
                next_states.push(State { beam, cache, logits });
            }
            states = next_states;
            let longest = states.iter().map(|s| s.beam.tokens.len()).max().unwrap_or(0);
            if !progress(longest) {
                bail!(ABORT_MESSAGE);
            }
            if states.iter().all(|s| s.beam.ended) {
                break;
            }
        }
        let beams: Vec<Beam> = states.into_iter().map(|s| s.beam).collect();
        let best = best_beams(&beams, 1, options.length_penalty);
        Ok(best.into_iter().next().map(|b| b.tokens).unwrap_or_default())
    }

    /// 生成码对应的 GPT 潜变量 `[1, N, 1280]`（`latentForS2Mel`）。
    pub fn latent_for_s2mel(&self, text_tokens: &[i32], codes: &[i32], speaker_latent: &Array, emotion: &Array) -> Result<Array> {
        let prefix = self.prefix_conditioning(speaker_latent, emotion)?;
        let text_emb = self.text_embeddings(&self.text_input(text_tokens))?;
        let mut mel_input = Vec::with_capacity(codes.len() + 2);
        mel_input.push(self.start_mel_token);
        mel_input.extend_from_slice(codes);
        mel_input.push(self.stop_mel_token);
        let mel_emb = self.mel_embeddings(&mel_input)?;
        let hidden = self.forward_full(&ops::concatenate_axis(&[&prefix, &text_emb, &mel_emb], 1)?)?;
        let start = prefix.dim(1) + text_emb.dim(1);
        let mel_hidden = hidden.index((.., start.., ..));
        let normalized = layer_norm(&mel_hidden, &self.final_norm)?;
        let latent = normalized.index((.., ..(codes.len() as i32), ..));
        latent.eval()?;
        Ok(latent)
    }
}
