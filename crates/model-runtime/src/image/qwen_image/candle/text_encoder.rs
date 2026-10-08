//! 给图像做条件的 Qwen3-VL 语言模型部分，逐层求值，36 层的权重从不整份留在设备上（移植自 v2
//! `bcut-image-local::candle::text_encoder`）。分词换成与 MLX 路径共用的 [`super::super::prompt::Prompter`]（v2 用 HF
//! `tokenizers` 读同一份 `processor/tokenizer.json`）。

use anyhow::{Context, Result, bail};
use candle_core::{DType, Device, Tensor};
use std::path::Path;

use super::super::prompt::Prompter;
use super::weights::ShardedWeights;
use crate::backend::candle::layers::{RopeCache, scaled_dot_product_attention};
use crate::image::Cancelled;

const HIDDEN: usize = 4096;
const INTERMEDIATE: usize = 12288;
const HEADS: usize = 32;
const KV_HEADS: usize = 8;
const HEAD_DIM: usize = 128;
const LAYERS: usize = 36;
const ROPE_THETA: f32 = 5_000_000.0;
const EPS: f32 = 1e-6;
/// 语言模型权重的键前缀：mlx-community 4-bit 包是 `language_model.model`，保留 transformers 原名的包是 `model.language_model`。
const PREFIXES: [&str; 2] = ["language_model.model", "model.language_model"];
/// 提示词（含模板）的 token 上限。
const MAX_TOKENS: usize = 1024;

fn rms(x: &Tensor, w: &Tensor) -> Result<Tensor> {
    Ok(candle_nn::ops::rms_norm(&x.contiguous()?, w, EPS)?)
}

fn linear(x: &Tensor, w: &Tensor) -> Result<Tensor> {
    Ok(x.to_dtype(w.dtype())?.broadcast_matmul(&w.t()?.contiguous()?)?)
}

fn projection(weights: &ShardedWeights, prefix: &str, x: &Tensor, input: usize, device: &Device, dtype: DType) -> Result<Tensor> {
    let w = weights.linear(prefix, input, device, dtype)?;
    let mut out = linear(x, &w)?;
    let bias = format!("{prefix}.bias");
    if weights.contains(&bias) {
        out = out.broadcast_add(&weights.load(&bias, device)?.to_dtype(dtype)?)?;
    }
    Ok(out)
}

fn attention(
    weights: &ShardedWeights,
    prefix: &str,
    x: &Tensor,
    rope: &RopeCache,
    mask: &Tensor,
    device: &Device,
    dtype: DType,
) -> Result<Tensor> {
    let (batch, sequence, _) = x.dims3()?;
    let proj = |name: &str, output: usize| -> Result<Tensor> {
        let y = projection(weights, &format!("{prefix}.{name}"), x, HIDDEN, device, dtype)?;
        if y.dim(2)? != output {
            bail!("{prefix}.{name} 输出维度不符");
        }
        Ok(y)
    };
    let q = proj("q_proj", HIDDEN)?.reshape((batch, sequence, HEADS, HEAD_DIM))?;
    let k = proj("k_proj", KV_HEADS * HEAD_DIM)?.reshape((batch, sequence, KV_HEADS, HEAD_DIM))?;
    let v = proj("v_proj", KV_HEADS * HEAD_DIM)?
        .reshape((batch, sequence, KV_HEADS, HEAD_DIM))?
        .transpose(1, 2)?;
    let q_norm = weights.load(&format!("{prefix}.q_norm.weight"), device)?.to_dtype(dtype)?;
    let k_norm = weights.load(&format!("{prefix}.k_norm.weight"), device)?.to_dtype(dtype)?;
    let q = rope.apply(&rms(&q, &q_norm)?.transpose(1, 2)?, 0)?;
    let k = rope.apply(&rms(&k, &k_norm)?.transpose(1, 2)?, 0)?;
    let attended = scaled_dot_product_attention(&q, &k.contiguous()?, &v.contiguous()?, (HEAD_DIM as f64).sqrt().recip(), Some(mask))?;
    let merged = attended.transpose(1, 2)?.reshape((batch, sequence, HIDDEN))?;
    projection(weights, &format!("{prefix}.o_proj"), &merged, HIDDEN, device, dtype)
}

/// 返回末层 decoder 的残差（不过最终 RMSNorm，QwenImage21Pipeline 要的就是它），并丢掉系统提示那段前缀。
/// 每层之前看一次 `cancel`。`files` 是 `text_encoder/` 下按清单取出的 safetensors。
pub fn encode(
    files: &[&Path],
    prompter: &Prompter,
    prompt: &str,
    device: &Device,
    dtype: DType,
    cancel: &dyn Fn() -> bool,
) -> Result<Tensor> {
    let ids = prompter.t2i_ids(prompt);
    let drop_idx = prompter.drop_idx();
    if ids.len() <= drop_idx || ids.len() > MAX_TOKENS {
        bail!("文本编码器 token 数 {} 超出支持范围", ids.len());
    }
    let weights = ShardedWeights::open(files)?;
    let prefix = PREFIXES
        .into_iter()
        .find(|prefix| weights.contains(&format!("{prefix}.embed_tokens.weight")))
        .context("找不到 Qwen3-VL 词嵌入权重")?;
    let mut hidden = weights
        .embedding_rows(&format!("{prefix}.embed_tokens"), &ids, HIDDEN, device, dtype)?
        .unsqueeze(0)?;
    let rope = RopeCache::new(ROPE_THETA, HEAD_DIM, dtype, device);
    let mut causal = vec![0.0_f32; ids.len() * ids.len()];
    for row in 0..ids.len() {
        for col in row + 1..ids.len() {
            causal[row * ids.len() + col] = f32::NEG_INFINITY;
        }
    }
    let mask = Tensor::from_vec(causal, (1, 1, ids.len(), ids.len()), device)?.to_dtype(dtype)?;
    for i in 0..LAYERS {
        if cancel() {
            return Err(Cancelled.into());
        }
        let p = format!("{prefix}.layers.{i}");
        let input_norm = weights.load(&format!("{p}.input_layernorm.weight"), device)?.to_dtype(dtype)?;
        let normalized = rms(&hidden, &input_norm)?;
        let a = attention(&weights, &format!("{p}.self_attn"), &normalized, &rope, &mask, device, dtype)?;
        hidden = (&hidden + &a)?;
        let post_norm = weights
            .load(&format!("{p}.post_attention_layernorm.weight"), device)?
            .to_dtype(dtype)?;
        let normalized = rms(&hidden, &post_norm)?;
        let gated = (candle_nn::ops::silu(&projection(
            &weights,
            &format!("{p}.mlp.gate_proj"),
            &normalized,
            HIDDEN,
            device,
            dtype,
        )?)? * projection(&weights, &format!("{p}.mlp.up_proj"), &normalized, HIDDEN, device, dtype)?)?;
        hidden = (&hidden + &projection(&weights, &format!("{p}.mlp.down_proj"), &gated, INTERMEDIATE, device, dtype)?)?;
    }
    Ok(hidden.narrow(1, drop_idx, ids.len() - drop_idx)?)
}
