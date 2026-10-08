//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/QuantizedTextDecoder.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3 文本解码器（candle），镜像 mlx 后端 `qwen3/text_decoder.rs`。

use super::layers::{Dense, RmsNorm, RopeCache, TokenEmbedding, causal_mask, scaled_dot_product_attention};
use super::thinker_weights::ThinkerWeights;
use super::weights::WeightStore;
use anyhow::{Result, bail};
use candle_core::Tensor;
use std::sync::Arc;

const KV_CACHE_STEP: usize = 256;

/// 按固定步长扩容的 KV cache，避免自回归生成时每个 token 都复制整段缓存。
pub struct KvCache {
    keys: Option<Tensor>,
    values: Option<Tensor>,
    offset: usize,
}

impl KvCache {
    fn new() -> Self {
        Self {
            keys: None,
            values: None,
            offset: 0,
        }
    }

    pub fn offset(&self) -> usize {
        self.offset
    }

    fn update(&mut self, keys: Tensor, values: Tensor) -> Result<(Tensor, Tensor)> {
        let previous = self.offset;
        let incoming = keys.dim(2)?;
        if keys.dim(0)? != 1 || values.dim(0)? != 1 {
            bail!("the KV cache only supports batch size 1");
        }
        let required = previous + incoming;
        let capacity = self.keys.as_ref().map(|current| current.dim(2).unwrap_or(0)).unwrap_or(0);
        if required > capacity {
            let (batch, heads, _, key_width) = keys.dims4()?;
            let value_width = values.dim(3)?;
            // 按步长向上取整，同时至少翻倍：长上下文下避免每 KV_CACHE_STEP 个
            // token 就整段重新分配并拷贝一次缓存。
            let grown = required.div_ceil(KV_CACHE_STEP) * KV_CACHE_STEP;
            let grown = grown.max(capacity * 2);
            let device = keys.device();
            let dtype = keys.dtype();
            let grown_keys = Tensor::zeros((batch, heads, grown, key_width), dtype, device)?;
            let grown_values = Tensor::zeros((batch, heads, grown, value_width), dtype, device)?;
            if let (Some(current_keys), Some(current_values)) = (self.keys.take(), self.values.take())
                && previous > 0
            {
                grown_keys.slice_set(&current_keys.narrow(2, 0, previous)?.contiguous()?, 2, 0)?;
                grown_values.slice_set(&current_values.narrow(2, 0, previous)?.contiguous()?, 2, 0)?;
            }
            self.keys = Some(grown_keys);
            self.values = Some(grown_values);
        }
        self.offset = required;
        self.keys
            .as_ref()
            .expect("KV cache keys are initialized")
            .slice_set(&keys.contiguous()?, 2, previous)?;
        self.values
            .as_ref()
            .expect("KV cache values are initialized")
            .slice_set(&values.contiguous()?, 2, previous)?;
        Ok((
            self.keys.as_ref().expect("KV cache keys are initialized").narrow(2, 0, required)?,
            self.values
                .as_ref()
                .expect("KV cache values are initialized")
                .narrow(2, 0, required)?,
        ))
    }
}

#[derive(Debug, Clone, Copy)]
pub struct TextDecoderConfig {
    pub hidden_size: usize,
    pub layers: usize,
    pub heads: usize,
    pub kv_heads: usize,
    pub head_dim: usize,
    pub intermediate_size: usize,
    pub group_size: usize,
    pub bits: usize,
    pub rope_theta: f32,
    pub rms_eps: f32,
    /// Qwen3 uses per-head q/k RMSNorm; Qwen2.5-Omni Thinker omits it.
    pub qk_norm: bool,
}

impl TextDecoderConfig {
    pub fn small(bits: usize) -> Self {
        Self {
            hidden_size: 1024,
            layers: 28,
            heads: 16,
            kv_heads: 8,
            head_dim: 128,
            intermediate_size: 3072,
            group_size: 64,
            bits,
            rope_theta: 1_000_000.0,
            rms_eps: 1e-6,
            qk_norm: true,
        }
    }

    pub fn large(bits: usize) -> Self {
        Self {
            hidden_size: 2048,
            intermediate_size: 6144,
            ..Self::small(bits)
        }
    }
}

struct TextAttention {
    q_proj: Dense,
    k_proj: Dense,
    v_proj: Dense,
    o_proj: Dense,
    q_norm: Option<RmsNorm>,
    k_norm: Option<RmsNorm>,
    rope: Arc<RopeCache>,
    config: TextDecoderConfig,
}

impl TextAttention {
    fn load(store: &mut WeightStore, prefix: &str, config: TextDecoderConfig, rope: Arc<RopeCache>) -> Result<Self> {
        let load = |store: &mut WeightStore, name: &str| {
            Dense::load_dequantized(store, &format!("{prefix}.{name}"), config.group_size, config.bits)
        };
        Ok(Self {
            q_proj: load(store, "q_proj")?,
            k_proj: load(store, "k_proj")?,
            v_proj: load(store, "v_proj")?,
            o_proj: load(store, "o_proj")?,
            q_norm: config
                .qk_norm
                .then(|| RmsNorm::load(store, &format!("{prefix}.q_norm"), config.rms_eps))
                .transpose()?,
            k_norm: config
                .qk_norm
                .then(|| RmsNorm::load(store, &format!("{prefix}.k_norm"), config.rms_eps))
                .transpose()?,
            rope,
            config,
        })
    }

    fn forward(&self, input: &Tensor, mask: Option<&Tensor>, cache: Option<&mut KvCache>) -> Result<Tensor> {
        let (batch, sequence, _) = input.dims3()?;
        let query = self
            .q_proj
            .forward(input)?
            .reshape((batch, sequence, self.config.heads, self.config.head_dim))?;
        let key = self
            .k_proj
            .forward(input)?
            .reshape((batch, sequence, self.config.kv_heads, self.config.head_dim))?;
        let value = self
            .v_proj
            .forward(input)?
            .reshape((batch, sequence, self.config.kv_heads, self.config.head_dim))?;
        let mut query = match &self.q_norm {
            Some(norm) => norm.forward(&query)?,
            None => query,
        }
        .transpose(1, 2)?;
        let mut key = match &self.k_norm {
            Some(norm) => norm.forward(&key)?,
            None => key,
        }
        .transpose(1, 2)?;
        let value = value.transpose(1, 2)?;
        let offset = cache.as_ref().map(|cache| cache.offset()).unwrap_or(0);
        query = self.rope.apply(&query, offset)?;
        key = self.rope.apply(&key, offset)?;
        let (cached_key, cached_value) = if let Some(cache) = cache {
            cache.update(key, value)?
        } else {
            // 无 cache 时 key/value 还是 `transpose(1, 2)` 的视图；candle 的批量
            // matmul 只接受连续的 rhs（batch > 1 时直接报 MatMulUnexpectedStriding）。
            // 走 cache 的路径由 `KvCache::update` 里的 `contiguous()` 保证，这里补上。
            (key.contiguous()?, value.contiguous()?)
        };
        let scale = (self.config.head_dim as f64).sqrt().recip();
        let attended = scaled_dot_product_attention(&query, &cached_key, &cached_value, scale, mask)?;
        let merged = attended
            .transpose(1, 2)?
            .reshape((batch, sequence, self.config.heads * self.config.head_dim))?;
        self.o_proj.forward(&merged)
    }
}

struct TextMlp {
    gate: Dense,
    up: Dense,
    down: Dense,
}

impl TextMlp {
    fn load(store: &mut WeightStore, prefix: &str, config: TextDecoderConfig) -> Result<Self> {
        Ok(Self {
            gate: Dense::load_dequantized(store, &format!("{prefix}.gate_proj"), config.group_size, config.bits)?,
            up: Dense::load_dequantized(store, &format!("{prefix}.up_proj"), config.group_size, config.bits)?,
            down: Dense::load_dequantized(store, &format!("{prefix}.down_proj"), config.group_size, config.bits)?,
        })
    }

    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let gate = candle_nn::ops::silu(&self.gate.forward(input)?)?;
        self.down.forward(&(gate * self.up.forward(input)?)?)
    }
}

struct TextLayer {
    attention: TextAttention,
    mlp: TextMlp,
    input_norm: RmsNorm,
    post_attention_norm: RmsNorm,
}

impl TextLayer {
    fn load(store: &mut WeightStore, prefix: &str, config: TextDecoderConfig, rope: Arc<RopeCache>) -> Result<Self> {
        Ok(Self {
            attention: TextAttention::load(store, &format!("{prefix}.self_attn"), config, rope)?,
            mlp: TextMlp::load(store, &format!("{prefix}.mlp"), config)?,
            input_norm: RmsNorm::load(store, &format!("{prefix}.input_layernorm"), config.rms_eps)?,
            post_attention_norm: RmsNorm::load(store, &format!("{prefix}.post_attention_layernorm"), config.rms_eps)?,
        })
    }

    fn forward(&self, input: &Tensor, mask: Option<&Tensor>, cache: Option<&mut KvCache>) -> Result<Tensor> {
        let normalized = self.input_norm.forward(input)?;
        let attention = self.attention.forward(&normalized, mask, cache)?;
        let mut hidden = (input + attention)?;
        let residual = hidden.clone();
        hidden = self.post_attention_norm.forward(&hidden)?;
        hidden = self.mlp.forward(&hidden)?;
        Ok((residual + hidden)?)
    }
}

pub struct TextDecoder {
    pub embedding: TokenEmbedding,
    layers: Vec<TextLayer>,
    norm: RmsNorm,
}

impl TextDecoder {
    pub fn load(store: &mut WeightStore, config: TextDecoderConfig) -> Result<Self> {
        Self::load_with_prefix(store, config, "model")
    }

    pub fn load_with_prefix(store: &mut WeightStore, config: TextDecoderConfig, prefix: &str) -> Result<Self> {
        if config.hidden_size == 0
            || config.intermediate_size == 0
            || config.heads == 0
            || config.kv_heads == 0
            || !config.heads.is_multiple_of(config.kv_heads)
        {
            bail!("invalid Qwen3 text decoder configuration");
        }
        let dtype = store.compute_dtype();
        let rope = Arc::new(RopeCache::new(config.rope_theta, config.head_dim, dtype, store.device()));
        let embedding = TokenEmbedding::load(store, &format!("{prefix}.embed_tokens"), config.group_size, config.bits)?;
        let mut layers = Vec::with_capacity(config.layers);
        for index in 0..config.layers {
            layers.push(TextLayer::load(
                store,
                &format!("{prefix}.layers.{index}"),
                config,
                Arc::clone(&rope),
            )?);
        }
        Ok(Self {
            embedding,
            layers,
            norm: RmsNorm::load(store, &format!("{prefix}.norm"), config.rms_eps)?,
        })
    }

    pub fn decode(
        &self,
        input_embeddings: &Tensor,
        attention_mask: Option<&Tensor>,
        cache: Option<Vec<KvCache>>,
    ) -> Result<(Tensor, Vec<KvCache>)> {
        let sequence = input_embeddings.dim(1)?;
        let mut cache = cache.unwrap_or_else(|| (0..self.layers.len()).map(|_| KvCache::new()).collect::<Vec<_>>());
        if cache.len() != self.layers.len() {
            bail!(
                "Qwen3 KV cache layer count mismatch: expected {}, got {}",
                self.layers.len(),
                cache.len()
            );
        }
        let generated_mask = if attention_mask.is_none() && sequence > 1 {
            let cache_length = cache.first().map(KvCache::offset).unwrap_or(0);
            Some(causal_mask(
                sequence,
                cache_length,
                input_embeddings.device(),
                input_embeddings.dtype(),
            )?)
        } else {
            None
        };
        let mask = attention_mask.or(generated_mask.as_ref());
        let mut hidden = input_embeddings.clone();
        for (layer, layer_cache) in self.layers.iter().zip(cache.iter_mut()) {
            hidden = layer.forward(&hidden, mask, Some(layer_cache))?;
        }
        Ok((self.norm.forward(&hidden)?, cache))
    }

    /// 无 KV cache 的一次性 prefill，返回末层归一化后的 hidden（**不过** lm_head）。
    ///
    /// 供 embedding / reranker 这类"只前向一次、只读某个位置"的用法：`decode`
    /// 走 [`KvCache`]，而 KV cache 只支持 batch size 1，无法批量左 padding。
    /// `attention_mask` 是可广播到 `[batch, heads, sequence, sequence]` 的**加性**
    /// 掩码（自带因果与 padding 语义）；为 `None` 时按纯因果掩码处理。
    pub fn forward_hidden(&self, input_embeddings: &Tensor, attention_mask: Option<&Tensor>) -> Result<Tensor> {
        let sequence = input_embeddings.dim(1)?;
        let generated_mask = if attention_mask.is_none() && sequence > 1 {
            Some(causal_mask(sequence, 0, input_embeddings.device(), input_embeddings.dtype())?)
        } else {
            None
        };
        let mask = attention_mask.or(generated_mask.as_ref());
        let mut hidden = input_embeddings.clone();
        for layer in &self.layers {
            hidden = layer.forward(&hidden, mask, None)?;
        }
        self.norm.forward(&hidden)
    }

    /// Return the final decoder state before the output RMSNorm. Conditional
    /// models such as Qwen-Image consume this state rather than token logits.
    pub fn forward_hidden_prenorm(&self, input_embeddings: &Tensor) -> Result<Tensor> {
        let sequence = input_embeddings.dim(1)?;
        let mask = (sequence > 1)
            .then(|| causal_mask(sequence, 0, input_embeddings.device(), input_embeddings.dtype()))
            .transpose()?;
        let mut hidden = input_embeddings.clone();
        for layer in &self.layers {
            hidden = layer.forward(&hidden, mask.as_ref(), None)?;
        }
        Ok(hidden)
    }

    /// AuK's Qwen2.5-Omni ELMo conditioner combines all 36 decoder states.
    /// Each state gets an affine-free LayerNorm; the final state first passes
    /// through the decoder's output RMSNorm. Layer weights are softmaxed over
    /// the depth axis and the sum is multiplied by the checkpoint scale.
    pub fn forward_fused_hidden(&self, input_embeddings: &Tensor, layer_weights: &Tensor, layer_scale: &Tensor) -> Result<Tensor> {
        if layer_weights.elem_count() != self.layers.len() {
            bail!(
                "AuK Qwen layer fusion weight count mismatch: expected {}, got {}",
                self.layers.len(),
                layer_weights.elem_count()
            );
        }
        let sequence = input_embeddings.dim(1)?;
        let mask = (sequence > 1)
            .then(|| causal_mask(sequence, 0, input_embeddings.device(), input_embeddings.dtype()))
            .transpose()?;
        let weights = candle_nn::ops::softmax(&layer_weights.flatten_all()?, 0)?;
        let mut hidden = input_embeddings.clone();
        let mut fused: Option<Tensor> = None;
        for (index, layer) in self.layers.iter().enumerate() {
            hidden = layer.forward(&hidden, mask.as_ref(), None)?;
            let state = if index + 1 == self.layers.len() {
                self.norm.forward(&hidden)?
            } else {
                hidden.clone()
            };
            let dtype = state.dtype();
            let state_f32 = state.to_dtype(candle_core::DType::F32)?;
            let centered = state_f32.broadcast_sub(&state_f32.mean_keepdim(candle_core::D::Minus1)?)?;
            let variance = centered.sqr()?.mean_keepdim(candle_core::D::Minus1)?;
            let normalized = centered.broadcast_div(&(variance + 1e-5)?.sqrt()?)?.to_dtype(dtype)?;
            let weight = weights.narrow(0, index, 1)?.squeeze(0)?.to_dtype(dtype)?;
            let weighted = normalized.broadcast_mul(&weight)?;
            fused = Some(match fused {
                Some(sum) => (sum + weighted)?,
                None => weighted,
            });
        }
        Ok(fused
            .ok_or_else(|| anyhow::anyhow!("AuK Qwen has no decoder layers"))?
            .broadcast_mul(&layer_scale.to_dtype(input_embeddings.dtype())?)?)
    }

    pub fn embed(&self, ids: &Tensor) -> Result<Tensor> {
        self.embedding.forward(ids)
    }

    pub fn logits(&self, hidden: &Tensor) -> Result<Tensor> {
        self.embedding.as_linear(hidden)
    }
}

/// AuK consumes the ELMo fusion of Qwen2.5-Omni's 36 Thinker states. Read
/// the embedding and one decoder layer at a time from mapped checkpoint
/// shards, so the unused vision/audio towers never occupy GPU memory. This
/// also releases each layer before the next is loaded on a 12 GiB NVIDIA GPU.
pub fn fused_thinker_hidden(
    shards: &ThinkerWeights,
    ids: &Tensor,
    config: TextDecoderConfig,
    layer_weights: &Tensor,
    layer_scale: &Tensor,
    check_continue: &mut dyn FnMut(usize) -> bool,
) -> Result<Tensor> {
    let device = ids.device();
    let dtype = if device.is_cuda() {
        candle_core::DType::BF16
    } else {
        candle_core::DType::F32
    };
    let mut embedding_store = WeightStore::from_values(shards.module("model.embed_tokens", device, dtype)?, device, dtype);
    let embedding = TokenEmbedding::load(&mut embedding_store, "model.embed_tokens", config.group_size, config.bits)?;
    let mut hidden = embedding.forward(ids)?;
    drop(embedding);
    let sequence = hidden.dim(1)?;
    let mask = (sequence > 1).then(|| causal_mask(sequence, 0, device, dtype)).transpose()?;
    let weights = candle_nn::ops::softmax(&layer_weights.flatten_all()?.to_dtype(dtype)?, 0)?;
    if weights.elem_count() != config.layers {
        bail!(
            "AuK Qwen layer fusion weight count mismatch: {} / {}",
            weights.elem_count(),
            config.layers
        );
    }
    let rope = Arc::new(RopeCache::new(config.rope_theta, config.head_dim, dtype, device));
    let mut fused: Option<Tensor> = None;
    for index in 0..config.layers {
        if !check_continue(index) {
            bail!("AuK Base synthesis was cancelled");
        }
        let prefix = format!("model.layers.{index}");
        let mut store = WeightStore::from_values(shards.module(&prefix, device, dtype)?, device, dtype);
        let layer = TextLayer::load(&mut store, &prefix, config, Arc::clone(&rope))?;
        hidden = layer.forward(&hidden, mask.as_ref(), None)?;
        drop(layer);
        let state = if index + 1 == config.layers {
            let mut store = WeightStore::from_values(shards.module("model.norm", device, dtype)?, device, dtype);
            RmsNorm::load(&mut store, "model.norm", config.rms_eps)?.forward(&hidden)?
        } else {
            hidden.clone()
        };
        let state_f32 = state.to_dtype(candle_core::DType::F32)?;
        let centered = state_f32.broadcast_sub(&state_f32.mean_keepdim(candle_core::D::Minus1)?)?;
        let variance = centered.sqr()?.mean_keepdim(candle_core::D::Minus1)?;
        let normalized = centered.broadcast_div(&(variance + 1e-5)?.sqrt()?)?.to_dtype(dtype)?;
        let weight = weights.narrow(0, index, 1)?.squeeze(0)?;
        let weighted = normalized.broadcast_mul(&weight)?;
        fused = Some(match fused {
            Some(sum) => (sum + weighted)?,
            None => weighted,
        });
    }
    Ok(fused
        .ok_or_else(|| anyhow::anyhow!("AuK Qwen has no decoder layers"))?
        .broadcast_mul(&layer_scale.to_dtype(dtype)?)?)
}

#[cfg(test)]
mod tests {
    use super::{KV_CACHE_STEP, KvCache, TextDecoder, TextDecoderConfig};
    use crate::backend::candle::weights::WeightStore;
    use candle_core::{Device, IndexOp, Tensor};
    use std::collections::HashMap;

    fn tiny_decoder(qk_norm: bool) -> TextDecoder {
        let device = Device::Cpu;
        let mut values = HashMap::new();
        let mut put = |name: &str, data: &[f32], dims: Vec<usize>| {
            values.insert(name.to_owned(), Tensor::from_slice(data, dims, &device).unwrap());
        };
        let identity = &[1., 0., 0., 1.];
        put("model.embed_tokens.weight", &[1., 0., 0., 2.], vec![2, 2]);
        for projection in ["q_proj", "k_proj", "v_proj", "o_proj"] {
            put(&format!("model.layers.0.self_attn.{projection}.weight"), identity, vec![2, 2]);
        }
        if qk_norm {
            put("model.layers.0.self_attn.q_norm.weight", &[3., 0.5], vec![2]);
            put("model.layers.0.self_attn.k_norm.weight", &[0.5, 3.], vec![2]);
        }
        for projection in ["gate_proj", "up_proj"] {
            put(&format!("model.layers.0.mlp.{projection}.weight"), &[0.; 8], vec![4, 2]);
        }
        put("model.layers.0.mlp.down_proj.weight", &[0.; 8], vec![2, 4]);
        for norm in ["input_layernorm", "post_attention_layernorm"] {
            put(&format!("model.layers.0.{norm}.weight"), &[1., 1.], vec![2]);
        }
        put("model.norm.weight", &[1., 1.], vec![2]);
        let mut store = WeightStore::from_values(values, &device, candle_core::DType::F32);
        TextDecoder::load(
            &mut store,
            TextDecoderConfig {
                hidden_size: 2,
                layers: 1,
                heads: 1,
                kv_heads: 1,
                head_dim: 2,
                intermediate_size: 4,
                group_size: 2,
                bits: 0,
                rope_theta: 10_000.,
                rms_eps: 1e-6,
                qk_norm,
            },
        )
        .unwrap()
    }

    #[test]
    fn optional_qk_norm_and_prenorm_conditioner_preserve_distinct_outputs() {
        let device = Device::Cpu;
        let ids = Tensor::from_slice(&[0u32, 1], (1, 2), &device).unwrap();
        let plain = tiny_decoder(false);
        let normalized = tiny_decoder(true);
        let embeddings = plain.embed(&ids).unwrap();
        let raw = plain.forward_hidden_prenorm(&embeddings).unwrap();
        let with_final_norm = plain.forward_hidden(&embeddings, None).unwrap();
        assert_ne!(
            raw.flatten_all().unwrap().to_vec1::<f32>().unwrap(),
            with_final_norm.flatten_all().unwrap().to_vec1::<f32>().unwrap()
        );
        let with_qk_norm = normalized.forward_hidden_prenorm(&embeddings).unwrap();
        assert_ne!(
            raw.flatten_all().unwrap().to_vec1::<f32>().unwrap(),
            with_qk_norm.flatten_all().unwrap().to_vec1::<f32>().unwrap()
        );
        let fused = plain
            .forward_fused_hidden(
                &embeddings,
                &Tensor::from_slice(&[0f32], 1, &device).unwrap(),
                &Tensor::from_slice(&[2f32], 1, &device).unwrap(),
            )
            .unwrap();
        assert_eq!(fused.dims(), &[1, 2, 2]);
        assert!(fused.flatten_all().unwrap().to_vec1::<f32>().unwrap().iter().all(|v| v.is_finite()));
    }

    #[test]
    fn kv_cache_grows_in_steps_without_changing_values() {
        let device = Device::Cpu;
        let mut cache = KvCache::new();
        let keys = Tensor::arange(0.0_f32, 24.0, &device).unwrap().reshape((1, 2, 3, 4)).unwrap();
        let values = Tensor::arange(24.0_f32, 48.0, &device).unwrap().reshape((1, 2, 3, 4)).unwrap();
        let (returned_keys, returned_values) = cache.update(keys, values).unwrap();

        assert_eq!(cache.offset(), 3);
        assert_eq!(cache.keys.as_ref().unwrap().dim(2).unwrap(), KV_CACHE_STEP);
        assert_eq!(returned_keys.dims(), &[1, 2, 3, 4]);
        assert_eq!(
            returned_keys
                .i((0, 0, .., ..))
                .unwrap()
                .flatten_all()
                .unwrap()
                .to_vec1::<f32>()
                .unwrap(),
            (0..12).map(|value| value as f32).collect::<Vec<_>>()
        );
        assert_eq!(
            returned_values
                .i((0, 1, .., ..))
                .unwrap()
                .flatten_all()
                .unwrap()
                .to_vec1::<f32>()
                .unwrap(),
            (36..48).map(|value| value as f32).collect::<Vec<_>>()
        );

        let next_keys = Tensor::arange(48.0_f32, 56.0, &device).unwrap().reshape((1, 2, 1, 4)).unwrap();
        let next_values = Tensor::arange(56.0_f32, 64.0, &device).unwrap().reshape((1, 2, 1, 4)).unwrap();
        let (returned_keys, _returned_values) = cache.update(next_keys, next_values).unwrap();

        assert_eq!(cache.offset(), 4);
        assert_eq!(returned_keys.dims(), &[1, 2, 4, 4]);
        assert_eq!(
            returned_keys
                .i((0, 1, 3, ..))
                .unwrap()
                .flatten_all()
                .unwrap()
                .to_vec1::<f32>()
                .unwrap(),
            (52..56).map(|value| value as f32).collect::<Vec<_>>()
        );
    }
}
