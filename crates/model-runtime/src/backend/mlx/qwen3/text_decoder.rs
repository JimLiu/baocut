//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/QuantizedTextDecoder.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3 文本解码器：GQA 注意力 + Q/K RMSNorm + RoPE + SwiGLU，按 256 步扩容的 KV cache。
//!
//! 除转写用的 `decode` 外，`large`、`load_with_prefix`、`forward_hidden*`、`final_norm`、`into_hidden_prenorm`、
//! `forward_fused_hidden` 移植自 v2：1.7B 配置给 Qwen3-ASR 1.7B，其余给 Thinker 层融合与本地文生图（Qwen 文本编码器）
//! 批次。

use super::WeightStore;
use super::layers::{Projection, RmsNorm, TokenEmbedding};
use anyhow::{Result, bail, ensure};
use mlx_rs::Array;
use mlx_rs::fast;
use mlx_rs::fast::ScaledDotProductAttentionMask;
use mlx_rs::nn::silu;
use mlx_rs::ops;
use mlx_rs::ops::indexing::{IndexOp, TryIndexMutOp, take_axis};
use mlx_rs::transforms;

const KV_CACHE_STEP: i32 = 256;

/// 按固定步长扩容的 KV cache，避免自回归生成时每个 token 都复制整段缓存。
pub struct KvCache {
    keys: Option<Array>,
    values: Option<Array>,
    offset: i32,
}

impl KvCache {
    pub(crate) fn new() -> Self {
        Self {
            keys: None,
            values: None,
            offset: 0,
        }
    }

    pub fn offset(&self) -> i32 {
        self.offset
    }

    pub(crate) fn update(&mut self, keys: Array, values: Array) -> Result<(Array, Array)> {
        let previous = self.offset;
        let incoming = keys.dim(2);
        if keys.dim(0) != 1 || values.dim(0) != 1 {
            bail!("the KV cache only supports batch size 1");
        }
        let required = previous + incoming;
        let needs_growth = self.keys.as_ref().is_none_or(|current| required > current.dim(2));
        if needs_growth {
            let batch = keys.dim(0);
            let heads = keys.dim(1);
            let key_width = keys.dim(3);
            let value_width = values.dim(3);
            let growth = ((KV_CACHE_STEP + incoming - 1) / KV_CACHE_STEP) * KV_CACHE_STEP;
            let new_keys = ops::zeros_dtype(&[batch, heads, growth, key_width], keys.dtype())?;
            let new_values = ops::zeros_dtype(&[batch, heads, growth, value_width], values.dtype())?;
            match (self.keys.take(), self.values.take()) {
                (Some(current_keys), Some(current_values)) => {
                    let current_keys = if previous % KV_CACHE_STEP == 0 {
                        current_keys
                    } else {
                        current_keys.index((.., .., ..previous, ..))
                    };
                    let current_values = if previous % KV_CACHE_STEP == 0 {
                        current_values
                    } else {
                        current_values.index((.., .., ..previous, ..))
                    };
                    self.keys = Some(ops::concatenate_axis(&[current_keys, new_keys], 2)?);
                    self.values = Some(ops::concatenate_axis(&[current_values, new_values], 2)?);
                }
                (None, None) => {
                    self.keys = Some(new_keys);
                    self.values = Some(new_values);
                }
                _ => bail!("inconsistent KV cache key/value state"),
            }
        }

        self.offset = required;
        let key_update = keys.squeeze_axes(&[0])?;
        let value_update = values.squeeze_axes(&[0])?;
        self.keys
            .as_mut()
            .expect("KV cache keys 已初始化")
            .try_index_mut((0, .., previous..required, ..), &key_update)?;
        self.values
            .as_mut()
            .expect("KV cache values 已初始化")
            .try_index_mut((0, .., previous..required, ..), &value_update)?;
        Ok((
            self.keys.as_ref().expect("KV cache keys 已初始化").index((.., .., ..required, ..)),
            self.values
                .as_ref()
                .expect("KV cache values 已初始化")
                .index((.., .., ..required, ..)),
        ))
    }

    /// 已写的部分，左边补 `left`、右边补 `right` 个空位。
    fn into_padded(self, left: i32, right: i32) -> Result<(Array, Array)> {
        let offset = self.offset;
        let pad = |array: Option<Array>| -> Result<Array> {
            let Some(array) = array else {
                bail!("the KV cache has not been filled");
            };
            let filled = array.index((.., .., ..offset, ..));
            let empty = |count: i32| ops::zeros_dtype(&[filled.dim(0), filled.dim(1), count, filled.dim(3)], filled.dtype());
            let mut pieces = Vec::with_capacity(3);
            if left > 0 {
                pieces.push(empty(left)?);
            }
            pieces.push(filled.clone());
            if right > 0 {
                pieces.push(empty(right)?);
            }
            Ok(ops::concatenate_axis(&pieces, 2)?)
        };
        Ok((pad(self.keys)?, pad(self.values)?))
    }
}

/// 一层的多行 KV：`[B, heads, capacity, head_dim]`。
struct BatchLayerCache {
    keys: Array,
    values: Array,
}

impl BatchLayerCache {
    /// 写进第 `end` 个位置，返回写到这里为止的 K、V。
    fn update(&mut self, keys: &Array, values: &Array, end: i32) -> Result<(Array, Array)> {
        self.keys.try_index_mut((.., .., end..end + 1, ..), keys)?;
        self.values.try_index_mut((.., .., end..end + 1, ..), values)?;
        Ok((self.keys.index((.., .., ..end + 1, ..)), self.values.index((.., .., ..end + 1, ..))))
    }

    /// 末尾再加 `extra` 个空位。
    fn grow(&mut self, extra: i32) -> Result<()> {
        let empty = |array: &Array| ops::zeros_dtype(&[array.dim(0), array.dim(1), extra, array.dim(3)], array.dtype());
        self.keys = ops::concatenate_axis(&[&self.keys, &empty(&self.keys)?], 2)?;
        self.values = ops::concatenate_axis(&[&self.values, &empty(&self.values)?], 2)?;
        Ok(())
    }
}

/// 多行同时逐 token 解码的 KV 状态（[`TextDecoder::decode_batch`]）。各行分别预填充（[`KvCache`]），长度可以不同：所有行的
/// 末尾对齐，短的行在左边补空位、由掩码挡住；RoPE 按每行自己的位置算，所以补多少空位不改变这一行的注意力。
pub struct BatchDecodeState {
    layers: Vec<BatchLayerCache>,
    /// 每行下一个 token 的位置。
    positions: Vec<i32>,
    /// 每行左边的空位数。
    paddings: Vec<i32>,
    /// 数组里已用的长度。
    end: i32,
    /// `[B, 1, 1, capacity]`，`true` 是真实位置。没有空位时不要掩码。
    mask: Option<Array>,
}

impl BatchDecodeState {
    /// 合并各行预填充好的 KV（外层是行，内层是层）。逐层求值：合并的峰值只比各行之和多一层。
    pub fn from_rows(rows: Vec<Vec<KvCache>>) -> Result<Self> {
        ensure!(!rows.is_empty(), "a decode batch needs at least one row");
        let layer_count = rows[0].len();
        ensure!(
            rows.iter()
                .all(|row| row.len() == layer_count && row.iter().all(|cache| cache.offset == row[0].offset)),
            "the rows of a decode batch must have the same layers"
        );
        let positions: Vec<i32> = rows.iter().map(|row| row.first().map_or(0, |cache| cache.offset)).collect();
        let end = positions.iter().copied().max().unwrap_or(0);
        ensure!(
            positions.iter().all(|position| *position > 0),
            "a decode batch row has not been prefilled"
        );
        let paddings: Vec<i32> = positions.iter().map(|position| end - position).collect();
        let capacity = (end / KV_CACHE_STEP + 1) * KV_CACHE_STEP;

        let mut rows: Vec<_> = rows.into_iter().map(Vec::into_iter).collect();
        let mut layers = Vec::with_capacity(layer_count);
        for _ in 0..layer_count {
            let (mut keys, mut values) = (Vec::with_capacity(rows.len()), Vec::with_capacity(rows.len()));
            for (row, padding) in rows.iter_mut().zip(&paddings) {
                let Some(cache) = row.next() else {
                    bail!("the rows of a decode batch must have the same layers");
                };
                let (row_keys, row_values) = cache.into_padded(*padding, capacity - end)?;
                keys.push(row_keys);
                values.push(row_values);
            }
            let layer = BatchLayerCache {
                keys: ops::concatenate_axis(&keys, 0)?,
                values: ops::concatenate_axis(&values, 0)?,
            };
            transforms::eval([&layer.keys, &layer.values])?;
            layers.push(layer);
        }
        let mask = padding_mask(&paddings, capacity);
        Ok(Self {
            layers,
            positions,
            paddings,
            end,
            mask,
        })
    }

    /// 只留下 `keep` 这些行（按现在的行序，严格递增）。它们共有的左边空位一并去掉：长的行结束后注意力不再扫这一段。
    pub fn retain(&mut self, keep: &[usize]) -> Result<()> {
        ensure!(!keep.is_empty(), "a decode batch needs at least one row");
        let indices: Vec<i32> = keep.iter().map(|row| *row as i32).collect();
        let indices = Array::from_slice(&indices, &[keep.len() as i32]);
        self.positions = keep.iter().map(|row| self.positions[*row]).collect();
        self.paddings = keep.iter().map(|row| self.paddings[*row]).collect();
        let shared = self.paddings.iter().copied().min().unwrap_or(0);
        for layer in &mut self.layers {
            layer.keys = take_axis(&layer.keys, &indices, 0)?;
            layer.values = take_axis(&layer.values, &indices, 0)?;
            if shared > 0 {
                layer.keys = layer.keys.index((.., .., shared.., ..));
                layer.values = layer.values.index((.., .., shared.., ..));
            }
        }
        for padding in &mut self.paddings {
            *padding -= shared;
        }
        self.end -= shared;
        self.mask = padding_mask(&self.paddings, self.capacity());
        Ok(())
    }

    fn capacity(&self) -> i32 {
        self.layers.first().map_or(0, |layer| layer.keys.dim(2))
    }

    /// 给下一步留出位置，返回这一步的掩码。
    fn prepare_step(&mut self) -> Result<Option<Array>> {
        if self.end >= self.capacity() {
            for layer in &mut self.layers {
                layer.grow(KV_CACHE_STEP)?;
            }
            self.mask = padding_mask(&self.paddings, self.capacity());
        }
        Ok(self.mask.as_ref().map(|mask| mask.index((.., .., .., ..self.end + 1))))
    }

    fn finish_step(&mut self) {
        self.end += 1;
        for position in &mut self.positions {
            *position += 1;
        }
    }
}

/// `paddings` 全是 0 时不要掩码。
fn padding_mask(paddings: &[i32], capacity: i32) -> Option<Array> {
    if paddings.iter().all(|padding| *padding == 0) {
        return None;
    }
    let values: Vec<bool> = paddings
        .iter()
        .flat_map(|padding| (0..capacity).map(move |column| column >= *padding))
        .collect();
    Some(Array::from_slice(&values, &[paddings.len() as i32, 1, 1, capacity]))
}

#[derive(Debug, Clone, Copy)]
pub struct TextDecoderConfig {
    pub hidden_size: usize,
    pub layers: usize,
    pub heads: usize,
    pub kv_heads: usize,
    pub head_dim: usize,
    pub intermediate_size: usize,
    pub group_size: i32,
    pub bits: i32,
    pub rope_theta: f32,
    pub rms_eps: f32,
    /// Qwen3/MOSS 在 RoPE 前使用 Q/K RMSNorm；Qwen2.5-Omni 不使用。
    pub qk_norm: bool,
}

impl TextDecoderConfig {
    pub fn small(bits: i32) -> Self {
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

    pub fn large(bits: i32) -> Self {
        Self {
            hidden_size: 2048,
            intermediate_size: 6144,
            ..Self::small(bits)
        }
    }
}

/// 预先算好的 rotate-half 旋转表，替代按顺序位置的 `fast::rope`：Qwen3-VL 的 M-RoPE 给图像 token 三轴不同的位置，
/// 不是单一偏移能表达的。`cos`/`sin` 是 `[S, head_dim]`（两半相同），dtype 与 hidden 相同（transformers 也是把表转成
/// q/k 的 dtype 再乘）。
pub struct RopeTable {
    pub cos: Array,
    pub sin: Array,
}

impl RopeTable {
    /// `x` 是 `[B, H, S, D]`。
    fn apply(&self, x: &Array) -> Result<Array> {
        let half = x.dim(-1) / 2;
        let rotated = ops::concatenate_axis(&[x.index((.., .., .., half..)).negative()?, x.index((.., .., .., ..half))], -1)?;
        Ok(x.multiply(&self.cos)?.add(&rotated.multiply(&self.sin)?)?)
    }
}

struct TextAttention {
    q_proj: Projection,
    k_proj: Projection,
    v_proj: Projection,
    o_proj: Projection,
    q_norm: Option<RmsNorm>,
    k_norm: Option<RmsNorm>,
    config: TextDecoderConfig,
}

impl TextAttention {
    fn load(store: &mut WeightStore, prefix: &str, config: TextDecoderConfig) -> Result<Self> {
        Ok(Self {
            q_proj: Projection::load(store, &format!("{prefix}.q_proj"), config.group_size, config.bits)?,
            k_proj: Projection::load(store, &format!("{prefix}.k_proj"), config.group_size, config.bits)?,
            v_proj: Projection::load(store, &format!("{prefix}.v_proj"), config.group_size, config.bits)?,
            o_proj: Projection::load(store, &format!("{prefix}.o_proj"), config.group_size, config.bits)?,
            q_norm: config
                .qk_norm
                .then(|| RmsNorm::load(store, &format!("{prefix}.q_norm"), config.rms_eps))
                .transpose()?,
            k_norm: config
                .qk_norm
                .then(|| RmsNorm::load(store, &format!("{prefix}.k_norm"), config.rms_eps))
                .transpose()?,
            config,
        })
    }

    /// Q、K、V（归一化之后，`[B, heads, S, head_dim]`），还没有 RoPE。
    fn project(&self, input: &Array) -> Result<(Array, Array, Array)> {
        let batch = input.dim(0);
        let sequence = input.dim(1);
        let mut query = self
            .q_proj
            .forward(input)?
            .reshape(&[batch, sequence, self.config.heads as i32, self.config.head_dim as i32])?;
        let mut key = self
            .k_proj
            .forward(input)?
            .reshape(&[batch, sequence, self.config.kv_heads as i32, self.config.head_dim as i32])?;
        let value = self
            .v_proj
            .forward(input)?
            .reshape(&[batch, sequence, self.config.kv_heads as i32, self.config.head_dim as i32])?;
        if let Some(norm) = &self.q_norm {
            query = norm.forward(&query)?;
        }
        if let Some(norm) = &self.k_norm {
            key = norm.forward(&key)?;
        }
        Ok((
            query.transpose_axes(&[0, 2, 1, 3])?,
            key.transpose_axes(&[0, 2, 1, 3])?,
            value.transpose_axes(&[0, 2, 1, 3])?,
        ))
    }

    /// 缩放点积注意力，合并头后过输出投影。`query` 是 `[B, heads, S, head_dim]`。
    fn attend(&self, query: &Array, keys: &Array, values: &Array, mask: Option<ScaledDotProductAttentionMask<'_>>) -> Result<Array> {
        let (batch, sequence) = (query.dim(0), query.dim(2));
        let scale = (self.config.head_dim as f32).sqrt().recip();
        let attended = fast::scaled_dot_product_attention(query, keys, values, scale, mask, None)?;
        let merged =
            attended
                .transpose_axes(&[0, 2, 1, 3])?
                .reshape(&[batch, sequence, (self.config.heads * self.config.head_dim) as i32])?;
        self.o_proj.forward(&merged)
    }

    fn forward(
        &self,
        input: &Array,
        mask: Option<&Array>,
        causal: bool,
        cache: Option<&mut KvCache>,
        rope: Option<&RopeTable>,
    ) -> Result<Array> {
        let (mut query, mut key, value) = self.project(input)?;
        if let Some(table) = rope {
            query = table.apply(&query)?;
            key = table.apply(&key)?;
        } else {
            let offset = cache.as_ref().map(|cache| cache.offset()).unwrap_or(0);
            query = fast::rope(
                &query,
                self.config.head_dim as i32,
                false,
                self.config.rope_theta,
                1.0,
                offset,
                None,
            )?;
            key = fast::rope(&key, self.config.head_dim as i32, false, self.config.rope_theta, 1.0, offset, None)?;
        }
        let (cached_key, cached_value) = if let Some(cache) = cache {
            cache.update(key, value)?
        } else {
            (key, value)
        };
        // causal 模式由 MLX 内核自行推导 query 相对 key 末尾的偏移，无需在 host 侧物化掩码。
        let mask_mode = match (mask, causal) {
            (Some(mask), _) => Some(ScaledDotProductAttentionMask::Array(mask)),
            (None, true) => Some(ScaledDotProductAttentionMask::Causal),
            (None, false) => None,
        };
        self.attend(&query, &cached_key, &cached_value, mask_mode)
    }

    /// 多行的一步：每行一个 token，`positions` 是每行的位置，KV 写进数组的第 `end` 个位置。
    fn forward_batch_step(
        &self,
        input: &Array,
        cache: &mut BatchLayerCache,
        positions: &Array,
        end: i32,
        mask: Option<&Array>,
    ) -> Result<Array> {
        let (query, key, value) = self.project(input)?;
        let (dimensions, theta) = (self.config.head_dim as i32, self.config.rope_theta);
        let query = fast::rope_dynamic(&query, dimensions, false, theta, 1.0, positions, None)?;
        let key = fast::rope_dynamic(&key, dimensions, false, theta, 1.0, positions, None)?;
        let (cached_key, cached_value) = cache.update(&key, &value, end)?;
        self.attend(&query, &cached_key, &cached_value, mask.map(ScaledDotProductAttentionMask::Array))
    }

    fn append_quantized_arrays<'a>(&'a self, arrays: &mut Vec<&'a Array>) {
        self.q_proj.append_quantized_arrays(arrays);
        self.k_proj.append_quantized_arrays(arrays);
        self.v_proj.append_quantized_arrays(arrays);
        self.o_proj.append_quantized_arrays(arrays);
    }
}

struct TextMlp {
    gate: Projection,
    up: Projection,
    down: Projection,
}

impl TextMlp {
    fn load(store: &mut WeightStore, prefix: &str, config: TextDecoderConfig) -> Result<Self> {
        Ok(Self {
            gate: Projection::load(store, &format!("{prefix}.gate_proj"), config.group_size, config.bits)?,
            up: Projection::load(store, &format!("{prefix}.up_proj"), config.group_size, config.bits)?,
            down: Projection::load(store, &format!("{prefix}.down_proj"), config.group_size, config.bits)?,
        })
    }

    fn forward(&self, input: &Array) -> Result<Array> {
        let gate = silu(self.gate.forward(input)?)?;
        self.down.forward(&(&gate * &self.up.forward(input)?))
    }

    fn append_quantized_arrays<'a>(&'a self, arrays: &mut Vec<&'a Array>) {
        self.gate.append_quantized_arrays(arrays);
        self.up.append_quantized_arrays(arrays);
        self.down.append_quantized_arrays(arrays);
    }
}

struct TextLayer {
    attention: TextAttention,
    mlp: TextMlp,
    input_norm: RmsNorm,
    post_attention_norm: RmsNorm,
}

impl TextLayer {
    fn load(store: &mut WeightStore, prefix: &str, config: TextDecoderConfig) -> Result<Self> {
        Ok(Self {
            attention: TextAttention::load(store, &format!("{prefix}.self_attn"), config)?,
            mlp: TextMlp::load(store, &format!("{prefix}.mlp"), config)?,
            input_norm: RmsNorm::load(store, &format!("{prefix}.input_layernorm"), config.rms_eps)?,
            post_attention_norm: RmsNorm::load(store, &format!("{prefix}.post_attention_layernorm"), config.rms_eps)?,
        })
    }

    fn forward(
        &self,
        input: &Array,
        mask: Option<&Array>,
        causal: bool,
        cache: Option<&mut KvCache>,
        rope: Option<&RopeTable>,
    ) -> Result<Array> {
        let normalized = self.input_norm.forward(input)?;
        let attention = self.attention.forward(&normalized, mask, causal, cache, rope)?;
        self.after_attention(input, &attention)
    }

    fn forward_batch_step(
        &self,
        input: &Array,
        cache: &mut BatchLayerCache,
        positions: &Array,
        end: i32,
        mask: Option<&Array>,
    ) -> Result<Array> {
        let normalized = self.input_norm.forward(input)?;
        let attention = self.attention.forward_batch_step(&normalized, cache, positions, end, mask)?;
        self.after_attention(input, &attention)
    }

    fn after_attention(&self, input: &Array, attention: &Array) -> Result<Array> {
        let mut hidden = input + attention;
        let residual = hidden.clone();
        hidden = self.post_attention_norm.forward(&hidden)?;
        hidden = self.mlp.forward(&hidden)?;
        Ok(&residual + &hidden)
    }

    fn append_quantized_arrays<'a>(&'a self, arrays: &mut Vec<&'a Array>) {
        self.attention.append_quantized_arrays(arrays);
        self.mlp.append_quantized_arrays(arrays);
    }

    /// 让本层的量化权重开始异步求值（惰性权重即开始从文件读入）。
    fn prefetch(&self) -> Result<()> {
        let mut arrays = Vec::new();
        self.append_quantized_arrays(&mut arrays);
        mlx_rs::transforms::async_eval(arrays)?;
        Ok(())
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
            bail!("invalid Qwen3 text decoder config");
        }
        let embedding = TokenEmbedding::load(store, &format!("{prefix}.embed_tokens"), config.group_size, config.bits)?;
        let mut layers = Vec::with_capacity(config.layers);
        for index in 0..config.layers {
            layers.push(TextLayer::load(store, &format!("{prefix}.layers.{index}"), config)?);
        }
        Ok(Self {
            embedding,
            layers,
            norm: RmsNorm::load(store, &format!("{prefix}.norm"), config.rms_eps)?,
        })
    }

    pub fn decode(
        &self,
        input_embeddings: &Array,
        attention_mask: Option<&Array>,
        cache: Option<Vec<KvCache>>,
    ) -> Result<(Array, Vec<KvCache>)> {
        let sequence = input_embeddings.dim(1);
        let mut cache = cache.unwrap_or_else(|| (0..self.layers.len()).map(|_| KvCache::new()).collect::<Vec<_>>());
        if cache.len() != self.layers.len() {
            bail!(
                "Qwen3 KV cache layer count mismatch: expected {}, got {}",
                self.layers.len(),
                cache.len()
            );
        }
        // 单 token 解码天然无需掩码；多 token prefill 交给 MLX 的 causal 模式，不再物化掩码数组。
        let causal = attention_mask.is_none() && sequence > 1;
        let mut hidden = input_embeddings.clone();
        for (layer, layer_cache) in self.layers.iter().zip(cache.iter_mut()) {
            hidden = layer.forward(&hidden, attention_mask, causal, Some(layer_cache), None)?;
        }
        Ok((self.norm.forward(&hidden)?, cache))
    }

    /// 多行同时走一步：`input_embeddings` 是 `[B, 1, hidden]`，每行一个 token，接在 `state` 里各行已有的位置之后。
    /// 返回 `[B, 1, hidden]`。
    pub fn decode_batch(&self, input_embeddings: &Array, state: &mut BatchDecodeState) -> Result<Array> {
        ensure!(
            input_embeddings.dim(0) as usize == state.positions.len() && input_embeddings.dim(1) == 1,
            "decode_batch expects one token per row of the batch"
        );
        ensure!(state.layers.len() == self.layers.len(), "Qwen3 batch KV cache layer count mismatch");
        let mask = state.prepare_step()?;
        let positions = Array::from_slice(&state.positions, &[state.positions.len() as i32]);
        let end = state.end;
        let mut hidden = input_embeddings.clone();
        for (layer, cache) in self.layers.iter().zip(state.layers.iter_mut()) {
            hidden = layer.forward_batch_step(&hidden, cache, &positions, end, mask.as_ref())?;
        }
        state.finish_step();
        self.norm.forward(&hidden)
    }

    /// 无 KV cache 的一次性 prefill，返回末层归一化后的 hidden（**不过** lm_head）。
    ///
    /// 供 embedding / reranker 这类"只前向一次、只读某个位置"的用法：`decode`
    /// 走 [`KvCache`]，而 KV cache 只支持 batch size 1，无法批量左 padding。
    /// `attention_mask` 是可广播到 `[batch, heads, sequence, sequence]` 的**加性**
    /// 掩码（自带因果与 padding 语义）；为 `None` 时交给 MLX 的 causal 模式。
    pub fn forward_hidden(&self, input_embeddings: &Array, attention_mask: Option<&Array>) -> Result<Array> {
        let sequence = input_embeddings.dim(1);
        let causal = attention_mask.is_none() && sequence > 1;
        let mut hidden = input_embeddings.clone();
        for layer in &self.layers {
            hidden = layer.forward(&hidden, attention_mask, causal, None, None)?;
        }
        self.norm.forward(&hidden)
    }

    /// 与 [`Self::forward_hidden`] 相同，但返回末层 decoder 的原始输出，**不过**最终 RMSNorm。
    /// Qwen-Image 的文本条件取的就是这一层。
    pub fn forward_hidden_prenorm(&self, input_embeddings: &Array) -> Result<Array> {
        let causal = input_embeddings.dim(1) > 1;
        let mut hidden = input_embeddings.clone();
        for layer in &self.layers {
            hidden = layer.forward(&hidden, None, causal, None, None)?;
        }
        Ok(hidden)
    }

    pub fn final_norm(&self, hidden: &Array) -> Result<Array> {
        self.norm.forward(hidden)
    }

    /// 流式版 [`Self::forward_hidden_prenorm`]：消耗 decoder，嵌入后先丢掉嵌入表，之后逐层
    /// 求值、立即丢掉该层。配合尚未求值的惰性 safetensors 权重，同时常驻的只有相邻两层；
    /// 下一层的量化权重在当前层计算时由 CPU stream 异步读入。
    pub fn into_hidden_prenorm(self, input_ids: &Array) -> Result<Array> {
        let Self { embedding, layers, .. } = self;
        let mut hidden = embedding.forward(input_ids)?;
        hidden.eval()?;
        drop(embedding);
        let causal = hidden.dim(1) > 1;
        let mut layers = layers.into_iter().peekable();
        if let Some(first) = layers.peek() {
            first.prefetch()?;
        }
        while let Some(layer) = layers.next() {
            if let Some(next) = layers.peek() {
                next.prefetch()?;
            }
            hidden = layer.forward(&hidden, None, causal, None, None)?;
            hidden.eval()?;
        }
        Ok(hidden)
    }

    /// 多模态版 [`Self::into_hidden_prenorm`]（Qwen3-VL）：输入已是嵌入（图像 token 已换成视觉特征，见 [`Self::embed`]），
    /// 位置用 `rope` 表；第 i 层之后的 hidden 交给 `after(i, hidden)` 改写（DeepStack 往图像 token 上加特征）。
    /// 注意力仍是因果的。同样消耗 decoder、逐层求值后丢掉该层。
    pub fn into_hidden_prenorm_with(
        self,
        embeddings: Array,
        rope: &RopeTable,
        mut after: impl FnMut(usize, Array) -> Result<Array>,
    ) -> Result<Array> {
        let Self { layers, .. } = self;
        let causal = embeddings.dim(1) > 1;
        let mut hidden = embeddings;
        let mut layers = layers.into_iter().enumerate().peekable();
        if let Some((_, first)) = layers.peek() {
            first.prefetch()?;
        }
        while let Some((index, layer)) = layers.next() {
            if let Some((_, next)) = layers.peek() {
                next.prefetch()?;
            }
            hidden = after(index, layer.forward(&hidden, None, causal, None, Some(rope))?)?;
            hidden.eval()?;
        }
        Ok(hidden)
    }

    /// Qwen2.5-Omni Thinker 的 ELMo 层融合：36 个 decoder hidden state
    /// 分别做无仿射 LayerNorm，再以 checkpoint 中的 softmax 权重求和。
    /// 文本-only 输入的位置三元组相同，普通 Qwen RoPE 与 MRoPE 数值等价。
    pub fn forward_fused_hidden(&self, input_embeddings: &Array, layer_weights: &Array, layer_scale: &Array) -> Result<Array> {
        if layer_weights.dim(0) != self.layers.len() as i32 {
            bail!(
                "Qwen layer-fusion weight count mismatch: expected {}, got {}",
                self.layers.len(),
                layer_weights.dim(0)
            );
        }
        let weights = mlx_rs::ops::softmax_axis(layer_weights, 0, true)?;
        let sequence = input_embeddings.dim(1);
        let mut hidden = input_embeddings.clone();
        let mut fused: Option<Array> = None;
        for (index, layer) in self.layers.iter().enumerate() {
            hidden = layer.forward(&hidden, None, sequence > 1, None, None)?;
            let state = if index + 1 == self.layers.len() {
                self.norm.forward(&hidden)?
            } else {
                hidden.clone()
            };
            let normalized = fast::layer_norm(&state, None, None, 1e-5)?;
            let weighted = normalized.multiply(&weights.index(index as i32))?;
            fused = Some(match fused {
                Some(sum) => sum.add(&weighted)?,
                None => weighted,
            });
        }
        fused.expect("TextDecoder 至少一层").multiply(layer_scale).map_err(Into::into)
    }

    pub fn embed(&self, ids: &Array) -> Result<Array> {
        self.embedding.forward(ids)
    }

    pub fn logits(&self, hidden: &Array) -> Result<Array> {
        self.embedding.as_linear(hidden)
    }

    /// 提前物化运行时量化的权重，使原始 bf16 权重在首轮 prefill 前即可释放。
    pub fn eval_quantized(&self) -> Result<()> {
        let mut arrays = Vec::new();
        self.embedding.append_quantized_arrays(&mut arrays);
        for layer in &self.layers {
            layer.append_quantized_arrays(&mut arrays);
        }
        if !arrays.is_empty() {
            transforms::eval(arrays)?;
        }
        Ok(())
    }
}

/// 旧的 host 侧掩码构造，仅保留给 causal 模式的数值对拍测试使用。
#[cfg(test)]
fn causal_mask(sequence: i32, cache_length: i32) -> Result<Array> {
    let total = sequence + cache_length;
    let mut values = vec![0.0_f32; (sequence * total) as usize];
    for row in 0..sequence {
        for column in 0..total {
            if column > row + cache_length {
                values[(row * total + column) as usize] = -1e9;
            }
        }
    }
    Ok(Array::from_slice(&values, &[1, 1, sequence, total]))
}

#[cfg(test)]
mod tests {
    use super::{BatchDecodeState, KV_CACHE_STEP, KvCache, TextDecoder, TextDecoderConfig, causal_mask};
    use crate::backend::mlx::qwen3::WeightStore;
    use mlx_rs::fast::{self, ScaledDotProductAttentionMask};
    use mlx_rs::ops::indexing::IndexOp;
    use mlx_rs::{Array, Dtype, ops};
    use std::collections::HashMap;

    /// 伪随机但确定的权重，范围约 ±0.5。
    fn weight(seed: &mut u64, shape: &[i32]) -> Array {
        let count: i32 = shape.iter().product();
        let values: Vec<f32> = (0..count)
            .map(|_| {
                *seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
                ((*seed >> 40) as f32 / (1_u64 << 24) as f32) - 0.5
            })
            .collect();
        Array::from_slice(&values, shape)
    }

    /// 两层的小解码器：不量化，形状与 Qwen3 的一样，只是窄。
    fn tiny_decoder() -> TextDecoder {
        let config = TextDecoderConfig {
            hidden_size: 32,
            layers: 2,
            heads: 4,
            kv_heads: 2,
            head_dim: 8,
            intermediate_size: 64,
            group_size: 64,
            bits: 0,
            rope_theta: 10_000.0,
            rms_eps: 1e-6,
            qk_norm: true,
        };
        let mut seed = 7;
        let mut values = HashMap::new();
        values.insert("model.embed_tokens.weight".to_owned(), weight(&mut seed, &[50, 32]));
        values.insert("model.norm.weight".to_owned(), ops::ones::<f32>(&[32]).unwrap());
        for layer in 0..2 {
            let prefix = format!("model.layers.{layer}");
            for (name, shape) in [
                ("self_attn.q_proj", [32, 32]),
                ("self_attn.k_proj", [16, 32]),
                ("self_attn.v_proj", [16, 32]),
                ("self_attn.o_proj", [32, 32]),
                ("mlp.gate_proj", [64, 32]),
                ("mlp.up_proj", [64, 32]),
                ("mlp.down_proj", [32, 64]),
            ] {
                values.insert(format!("{prefix}.{name}.weight"), weight(&mut seed, &shape));
            }
            for (name, width) in [
                ("self_attn.q_norm", 8),
                ("self_attn.k_norm", 8),
                ("input_layernorm", 32),
                ("post_attention_layernorm", 32),
            ] {
                values.insert(format!("{prefix}.{name}.weight"), ops::ones::<f32>(&[width]).unwrap());
            }
        }
        let mut store = WeightStore::from_arrays(values).unwrap();
        TextDecoder::load(&mut store, config).unwrap()
    }

    fn token_ids(seed: i32, count: i32) -> Vec<i32> {
        (0..count).map(|index| (seed * 7 + index * 3) % 50).collect()
    }

    /// 每行分别预填充（可以多步），返回 KV 与预填充之后的单行逐步解码要用的状态。
    fn prefilled(decoder: &TextDecoder, ids: &[i32]) -> Vec<KvCache> {
        let mut cache = None;
        for piece in ids.chunks(4) {
            let embeddings = decoder.embed(&Array::from_slice(piece, &[1, piece.len() as i32])).unwrap();
            let (hidden, updated) = decoder.decode(&embeddings, None, cache.take()).unwrap();
            hidden.eval().unwrap();
            cache = Some(updated);
        }
        cache.unwrap()
    }

    fn assert_close(left: &Array, right: &Array, context: &str) {
        left.eval().unwrap();
        right.eval().unwrap();
        assert_eq!(left.shape(), right.shape(), "{context}");
        for (a, b) in left.as_slice::<f32>().iter().zip(right.as_slice::<f32>()) {
            assert!((a - b).abs() < 1e-4, "{context}: {a} vs {b}");
        }
    }

    /// 长度不同的几行一起解码，与每行单独解码给出同样的 hidden，中途去掉一行、跨过 KV 扩容都不变。
    #[test]
    fn batch_decode_matches_decoding_each_row_alone() {
        let _mlx_test_guard = crate::backend::mlx::runtime::MLX_TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if crate::backend::mlx::runtime::ensure_metal_device().is_err() {
            return;
        }
        let decoder = tiny_decoder();
        // 最长的一行差 3 步到 KV 的扩容边界；中间那行最长，去掉它之后共有的左边空位要被裁掉。
        let lengths = [KV_CACHE_STEP - 20, KV_CACHE_STEP - 3, KV_CACHE_STEP - 11];
        let prompts: Vec<Vec<i32>> = lengths
            .iter()
            .enumerate()
            .map(|(row, length)| token_ids(row as i32 + 1, *length))
            .collect();

        let mut alone: Vec<Option<Vec<KvCache>>> = prompts.iter().map(|ids| Some(prefilled(&decoder, ids))).collect();
        let mut state = BatchDecodeState::from_rows(prompts.iter().map(|ids| prefilled(&decoder, ids)).collect()).unwrap();
        assert_eq!(state.end, KV_CACHE_STEP - 3);
        assert_eq!(state.paddings, [17, 0, 8]);
        assert_eq!(state.positions, lengths);
        assert!(state.mask.is_some());

        let mut active = vec![0_usize, 1, 2];
        for step in 0..8_i32 {
            if step == 5 {
                state.retain(&[0, 2]).unwrap();
                active = vec![0, 2];
                assert_eq!(state.paddings, [9, 0]);
                assert_eq!(state.positions, [lengths[0] + 5, lengths[2] + 5]);
            }
            let ids: Vec<i32> = active.iter().map(|row| (*row as i32 + step * 5) % 50).collect();
            let embeddings = decoder.embed(&Array::from_slice(&ids, &[ids.len() as i32, 1])).unwrap();
            let batched = decoder.decode_batch(&embeddings, &mut state).unwrap();
            batched.eval().unwrap();
            for (position, row) in active.iter().enumerate() {
                let one = decoder.embed(&Array::from_slice(&[ids[position]], &[1, 1])).unwrap();
                let (hidden, updated) = decoder.decode(&one, None, alone[*row].take()).unwrap();
                alone[*row] = Some(updated);
                let context = format!("row {row}, step {step}");
                let position = position as i32;
                assert_close(&batched.index((position..position + 1, .., ..)), &hidden, &context);
            }
        }
        assert!(
            state.capacity() > KV_CACHE_STEP - 9,
            "the batch must have grown past the first step"
        );
    }

    /// 一样长的行不要掩码，只剩一行时也不要。
    #[test]
    fn batch_state_uses_a_mask_only_while_rows_differ_in_length() {
        let _mlx_test_guard = crate::backend::mlx::runtime::MLX_TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if crate::backend::mlx::runtime::ensure_metal_device().is_err() {
            return;
        }
        let decoder = tiny_decoder();
        let rows = |lengths: &[i32]| -> Vec<Vec<KvCache>> {
            lengths
                .iter()
                .enumerate()
                .map(|(row, length)| prefilled(&decoder, &token_ids(row as i32 + 1, *length)))
                .collect()
        };
        assert!(BatchDecodeState::from_rows(rows(&[6, 6])).unwrap().mask.is_none());
        assert!(BatchDecodeState::from_rows(rows(&[6])).unwrap().mask.is_none());

        let mut state = BatchDecodeState::from_rows(rows(&[6, 9])).unwrap();
        assert!(state.mask.is_some());
        state.retain(&[0]).unwrap();
        assert!(state.mask.is_none());
        assert_eq!(
            (state.end, state.paddings.as_slice(), state.positions.as_slice()),
            (6, &[0][..], &[6][..])
        );
        assert!(BatchDecodeState::from_rows(Vec::new()).is_err());
    }

    /// 每行自己的 RoPE 位置与单行的 `fast::rope` 逐值相同。
    #[test]
    fn rope_positions_apply_per_row() {
        let _mlx_test_guard = crate::backend::mlx::runtime::MLX_TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if crate::backend::mlx::runtime::ensure_metal_device().is_err() {
            return;
        }
        let mut seed = 11;
        let input = weight(&mut seed, &[3, 2, 1, 8]);
        let positions = Array::from_slice(&[3_i32, 4_001, 77], &[3]);
        let rotated = fast::rope_dynamic(&input, 8, false, 10_000.0, 1.0, &positions, None).unwrap();
        rotated.eval().unwrap();
        for (row, position) in [3, 4_001, 77].into_iter().enumerate() {
            let row = row as i32;
            let alone = fast::rope(input.index((row..row + 1, .., .., ..)), 8, false, 10_000.0, 1.0, position, None).unwrap();
            alone.eval().unwrap();
            let picked = rotated.index((row..row + 1, .., .., ..));
            picked.eval().unwrap();
            assert_eq!(picked.as_slice::<f32>(), alone.as_slice::<f32>(), "row {row}");
        }
    }

    #[test]
    fn kv_cache_grows_in_steps_without_changing_values() {
        let _mlx_test_guard = crate::backend::mlx::runtime::MLX_TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut cache = KvCache::new();
        let keys = Array::from_iter(0..24, &[1, 2, 3, 4]);
        let values = Array::from_iter(24..48, &[1, 2, 3, 4]);
        let (returned_keys, returned_values) = cache.update(keys, values).unwrap();
        returned_keys.eval().unwrap();
        returned_values.eval().unwrap();

        assert_eq!(cache.offset(), 3);
        assert_eq!(cache.keys.as_ref().unwrap().dim(2), KV_CACHE_STEP);
        assert_eq!(returned_keys.shape(), &[1, 2, 3, 4]);
        assert_eq!(returned_keys.index((0, 0, .., ..)).as_slice::<i32>(), &(0..12).collect::<Vec<_>>());
        assert_eq!(returned_keys.index((0, 1, .., ..)).as_slice::<i32>(), &(12..24).collect::<Vec<_>>());
        assert_eq!(
            returned_values.index((0, 0, .., ..)).as_slice::<i32>(),
            &(24..36).collect::<Vec<_>>()
        );
        assert_eq!(
            returned_values.index((0, 1, .., ..)).as_slice::<i32>(),
            &(36..48).collect::<Vec<_>>()
        );

        let next_keys = Array::from_iter(48..56, &[1, 2, 1, 4]);
        let next_values = Array::from_iter(56..64, &[1, 2, 1, 4]);
        let (returned_keys, returned_values) = cache.update(next_keys, next_values).unwrap();
        returned_keys.eval().unwrap();
        returned_values.eval().unwrap();

        assert_eq!(cache.offset(), 4);
        assert_eq!(cache.keys.as_ref().unwrap().dim(2), KV_CACHE_STEP);
        assert_eq!(returned_keys.shape(), &[1, 2, 4, 4]);
        assert_eq!(
            returned_keys.index((0, 0, 3..4, ..)).as_slice::<i32>(),
            &(48..52).collect::<Vec<_>>()
        );
        assert_eq!(
            returned_keys.index((0, 1, 3..4, ..)).as_slice::<i32>(),
            &(52..56).collect::<Vec<_>>()
        );
        assert_eq!(
            returned_values.index((0, 0, 3..4, ..)).as_slice::<i32>(),
            &(56..60).collect::<Vec<_>>()
        );
        assert_eq!(
            returned_values.index((0, 1, 3..4, ..)).as_slice::<i32>(),
            &(60..64).collect::<Vec<_>>()
        );
    }

    /// causal 模式与 host 侧掩码在带 cache offset（query 对齐到 key 末尾）时必须逐元素一致。
    /// dtype 需覆盖生产的 bf16：MLX 的 SDPA 按 dtype 分派内核，f32 通过不代表 bf16 通过。
    fn assert_causal_matches_array_mask(
        heads: i32,
        kv_heads: i32,
        sequence: i32,
        cache_length: i32,
        head_dim: i32,
        dtype: Dtype,
        tolerance: f32,
    ) {
        let total = sequence + cache_length;
        let query = mlx_rs::random::normal::<f32>(&[1, heads, sequence, head_dim], None, None, None)
            .unwrap()
            .as_dtype(dtype)
            .unwrap();
        let key = mlx_rs::random::normal::<f32>(&[1, kv_heads, total, head_dim], None, None, None)
            .unwrap()
            .as_dtype(dtype)
            .unwrap();
        let value = mlx_rs::random::normal::<f32>(&[1, kv_heads, total, head_dim], None, None, None)
            .unwrap()
            .as_dtype(dtype)
            .unwrap();
        let scale = (head_dim as f32).sqrt().recip();
        let mask = causal_mask(sequence, cache_length).unwrap().as_dtype(dtype).unwrap();
        let reference =
            fast::scaled_dot_product_attention(&query, &key, &value, scale, ScaledDotProductAttentionMask::Array(&mask), None).unwrap();
        let actual = fast::scaled_dot_product_attention(&query, &key, &value, scale, ScaledDotProductAttentionMask::Causal, None).unwrap();
        assert_eq!(reference.shape(), actual.shape());
        // 统一升到 f32 再比较，避免 bf16 下的规约与 item 取值精度损失掩盖真实偏差。
        let reference = reference.as_dtype(Dtype::Float32).unwrap();
        let actual = actual.as_dtype(Dtype::Float32).unwrap();
        let deviation = ops::abs(ops::subtract(&reference, &actual).unwrap())
            .unwrap()
            .max(None)
            .unwrap()
            .item::<f32>();
        assert!(
            deviation < tolerance,
            "causal 模式与掩码数组在 heads={heads} sequence={sequence} cache={cache_length} dtype={dtype:?} 下偏差 {deviation}"
        );
    }

    #[test]
    fn causal_mask_mode_matches_materialized_mask() {
        let _mlx_test_guard = crate::backend::mlx::runtime::MLX_TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        // 小尺寸：无 cache、有 cache 两种 offset。
        assert_causal_matches_array_mask(4, 2, 5, 0, 8, Dtype::Float32, 1e-4);
        assert_causal_matches_array_mask(4, 2, 5, 7, 8, Dtype::Float32, 1e-4);
        // 生产几何：GQA 16/8、head_dim 128、prefill 512 且带非零 cache。
        assert_causal_matches_array_mask(16, 8, 512, 1_024, 128, Dtype::Float32, 1e-4);
        // 生产 dtype：bf16 只有 8 位尾数，容差放到 2e-2；若 causal 对齐到 key 起点而非末尾，
        // 偏差会是 1 量级，远超该阈值，足以判别语义错误。
        assert_causal_matches_array_mask(4, 2, 5, 7, 8, Dtype::Bfloat16, 2e-2);
        assert_causal_matches_array_mask(16, 8, 512, 1_024, 128, Dtype::Bfloat16, 2e-2);
    }
}
