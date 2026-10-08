//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/Qwen3TTS/CodePredictor.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Code Predictor：5 层 Qwen3 解码器 + 15 张 codec 嵌入表 + 15 个 lm_head，
//! 从 Talker 的隐状态与第一个 codebook 逐组预测其余 15 个 codebook。

use crate::synthesize::tensor::ops;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype};
use anyhow::{Result, bail};

use super::config::CodePredictorConfig;
use super::layers::{AttentionDims, DecoderLayer, Embedding, KvCache, Linear, RmsNorm, token_array};
use super::sampling::{Rng, SamplingConfig, sample_frame_token};
use super::weights::Weights;

pub struct CodePredictor {
    codec_embeddings: Vec<Embedding>,
    layers: Vec<DecoderLayer>,
    norm: RmsNorm,
    lm_heads: Vec<Linear>,
    small_to_mtp_projection: Option<Linear>,
    num_groups: usize,
}

impl CodePredictor {
    /// `weights` 已剥掉 `talker.code_predictor.` 前缀。
    pub fn load(weights: &mut Weights, config: &CodePredictorConfig) -> Result<Self> {
        let dims = AttentionDims {
            num_heads: config.num_heads,
            num_kv_heads: config.num_kv_heads,
            head_dim: config.head_dim,
            rope_theta: config.rope_theta,
            rms_norm_eps: config.rms_norm_eps,
        };
        let group_size = config.group_size;
        let bits = config.bits;
        let num_groups = config.num_code_groups - 1;
        let mut codec_embeddings = Vec::with_capacity(num_groups);
        let mut lm_heads = Vec::with_capacity(num_groups);
        for index in 0..num_groups {
            codec_embeddings.push(Embedding::load(weights, &format!("model.codec_embedding.{index}"))?);
            lm_heads.push(Linear::load(weights, &format!("lm_head.{index}"), group_size, bits)?);
        }
        let mut layers = Vec::with_capacity(config.num_layers);
        for index in 0..config.num_layers {
            layers.push(DecoderLayer::load(
                weights,
                &format!("model.layers.{index}"),
                &dims,
                group_size,
                bits,
            )?);
        }
        let small_to_mtp_projection = if config.needs_projection() {
            Some(Linear::load(weights, "small_to_mtp_projection", group_size, bits)?)
        } else {
            None
        };
        Ok(Self {
            codec_embeddings,
            layers,
            norm: RmsNorm::load(weights, "model.norm", config.rms_norm_eps)?,
            lm_heads,
            small_to_mtp_projection,
            num_groups,
        })
    }

    pub fn num_groups(&self) -> usize {
        self.num_groups
    }

    /// 第 `group` 组（0 = codebook 2）的嵌入：`ids [B, S]` → `[B, S, D]`。
    pub fn embed_group(&self, ids: &Array, group: usize) -> Array {
        self.codec_embeddings[group].forward(ids)
    }

    /// 15 个 token（每组一个）的嵌入之和：`[1, 1, D]`。
    pub fn batch_embed_all_groups(&self, tokens: &[i32]) -> Result<Array> {
        if tokens.len() != self.num_groups {
            bail!("Code Predictor 需要 {} 个 token，实际 {}", self.num_groups, tokens.len());
        }
        let mut sum = self.embed_group(&token_array(&tokens[..1]), 0);
        for (group, &token) in tokens.iter().enumerate().skip(1) {
            sum = sum.add(&self.embed_group(&token_array(&[token]), group))?;
        }
        Ok(sum)
    }

    /// 单组前向：返回 `(logits [B,S,vocab], cache)`。
    fn forward(&self, inputs_embeds: &Array, group: usize, cache: Option<&[KvCache]>) -> Result<(Array, Vec<KvCache>)> {
        let mut hidden = match &self.small_to_mtp_projection {
            Some(proj) => proj.forward(inputs_embeds)?,
            None => inputs_embeds.clone(),
        };
        let offset = cache.and_then(|cache| cache.first()).map_or(0, KvCache::len);
        let mut new_cache = Vec::with_capacity(self.layers.len());
        for (index, layer) in self.layers.iter().enumerate() {
            let layer_cache = cache.map(|cache| &cache[index]);
            let (output, updated) = layer.forward(&hidden, offset, None, layer_cache)?;
            hidden = output;
            new_cache.push(updated);
        }
        let hidden = self.norm.forward(&hidden)?;
        let logits = self.lm_heads[group].forward(&hidden)?;
        Ok((logits, new_cache))
    }

    /// 输入 Talker 最后隐状态
    /// `[1,1,D]` 与第一个 codebook 的嵌入 `[1,1,D]`，逐组自回归采样 15 个 token。
    pub fn predict_frame(
        &self,
        hidden_state: &Array,
        first_code_embed: &Array,
        sampling: &SamplingConfig,
        rng: &mut Rng,
    ) -> Result<Vec<i32>> {
        let prefill = ops::concatenate_axis(&[hidden_state, first_code_embed], 1)?;
        let (logits, mut cache) = self.forward(&prefill, 0, None)?;
        let last = logits.dim(1) - 1;
        let mut token = sample_group(&logits.index((.., last..last + 1, ..)), sampling, rng)?;
        let mut tokens = Vec::with_capacity(self.num_groups);
        tokens.push(token);
        for group in 1..self.num_groups {
            let embedding = self.embed_group(&token_array(&[token]), group - 1);
            let (logits, new_cache) = self.forward(&embedding, group, Some(&cache))?;
            cache = new_cache;
            token = sample_group(&logits, sampling, rng)?;
            tokens.push(token);
        }
        Ok(tokens)
    }
}

/// 在 host 侧对单组 logits 采样（`[1,1,vocab]` → token）。
fn sample_group(logits: &Array, sampling: &SamplingConfig, rng: &mut Rng) -> Result<i32> {
    let flat = logits.as_dtype(Dtype::Float32)?;
    flat.eval()?;
    let mut scores = flat.as_slice::<f32>().to_vec();
    Ok(sample_frame_token(&mut scores, sampling, rng))
}
