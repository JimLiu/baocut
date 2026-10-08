//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2SemanticCodec.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! MaskGCT 语义码本（对照 speech-swift `IndexTTS2SemanticCodec.swift`）。
//!
//! 编码器：Vocos ConvNeXt 骨干（1024 → 384，12 块，LN eps 1e-6，精确 GELU，
//! `gamma` 缩放）+ 384 → 1024 投影；量化器：weight-norm 的 in/out_project
//! （k=1 卷积）与 `[8192, 8]` 码本，L2 归一化后按最近邻取码。

use super::layers::{Conv1d, LayerNorm, Linear, act};
use super::v25_weights;
use super::weights::WeightMap;
use crate::synthesize::tensor::ops::indexing::{IndexOp, argmax_axis};
use crate::synthesize::tensor::{Array, Dtype, ops};
use anyhow::{Result, ensure};

const DIM: i32 = 384;
const LN_EPS: f32 = 1e-6;
const NUM_BLOCKS: usize = 12;

struct ConvNeXtBlock {
    dwconv: Conv1d,
    norm: LayerNorm,
    pwconv1: Linear,
    pwconv2: Linear,
    gamma: Array,
}

impl ConvNeXtBlock {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            dwconv: Conv1d::load(w, &format!("{prefix}.dwconv"))?.with_padding(3).with_groups(DIM),
            norm: LayerNorm::load(w, &format!("{prefix}.norm"), LN_EPS)?,
            pwconv1: Linear::load(w, &format!("{prefix}.pwconv1"))?,
            pwconv2: Linear::load(w, &format!("{prefix}.pwconv2"))?,
            gamma: w.take_f32(&format!("{prefix}.gamma"))?,
        })
    }

    /// 输入 / 输出 `[B, T, C]`（内部等价于 Swift 的 NCL 布局往返）。
    fn forward(&self, x: &Array) -> Result<Array> {
        let h = self.dwconv.forward_nlc(x)?;
        let h = self.norm.forward(&h)?;
        let h = self.pwconv1.forward(&h)?;
        let h = act::gelu(&h)?;
        let h = self.pwconv2.forward(&h)?;
        Ok(x + &self.gamma * h)
    }
}

pub struct SemanticEncoder {
    embed: Conv1d,
    norm: LayerNorm,
    blocks: Vec<ConvNeXtBlock>,
    final_layer_norm: LayerNorm,
    projection: Linear,
}

impl SemanticEncoder {
    /// `{prefix}.0` 是 Vocos 骨干、`{prefix}.1` 是 384 → 1024 投影（编码器与 2.5 解码器同构）。
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        let mut blocks = Vec::with_capacity(NUM_BLOCKS);
        for i in 0..NUM_BLOCKS {
            blocks.push(ConvNeXtBlock::load(w, &format!("{prefix}.0.convnext.{i}"))?);
        }
        Ok(Self {
            embed: Conv1d::load(w, &format!("{prefix}.0.embed"))?.with_padding(3),
            norm: LayerNorm::load(w, &format!("{prefix}.0.norm"), LN_EPS)?,
            blocks,
            final_layer_norm: LayerNorm::load(w, &format!("{prefix}.0.final_layer_norm"), LN_EPS)?,
            projection: Linear::load(w, &format!("{prefix}.1"))?,
        })
    }

    /// 输入 `[B, T, 1024]`，输出 `[B, T, 1024]`。
    pub fn forward(&self, hidden: &Array) -> Result<Array> {
        let mut h = self.embed.forward_nlc(hidden)?;
        h = self.norm.forward(&h)?;
        for block in &self.blocks {
            h = block.forward(&h)?;
        }
        let h = self.final_layer_norm.forward(&h)?;
        self.projection.forward(&h)
    }
}

pub struct SemanticQuantizer {
    in_project: Conv1d,
    out_project: Conv1d,
    codebook: Array,
}

impl SemanticQuantizer {
    fn load(w: &mut WeightMap) -> Result<Self> {
        let prefix = "quantizer.quantizers.0";
        Ok(Self {
            in_project: Conv1d::load_weight_norm(w, &format!("{prefix}.in_project"))?,
            out_project: Conv1d::load_weight_norm(w, &format!("{prefix}.out_project"))?,
            codebook: w.take_f32(&format!("{prefix}.codebook.weight"))?,
        })
    }

    /// 码 `[B, T]` → 嵌入 `[B, 1024, T]`。
    pub fn vq2emb(&self, codes: &Array) -> Result<Array> {
        let emb = self.codebook.index(codes); // [B, T, 8]
        Ok(self.out_project.forward_nlc(&emb)?.swap_axes(1, 2)?)
    }

    /// 编码隐状态 `[B, T, 1024]` → (码 `[B, T]` i32, 提示嵌入 `[B, T, 1024]`)。
    pub fn quantize(&self, encoded: &Array) -> Result<(Array, Array)> {
        let b = encoded.dim(0);
        let t = encoded.dim(1);
        let projected = self.in_project.forward_nlc(encoded)?; // [B, T, 8]
        let flat = projected.reshape(&[-1, projected.dim(2)])?;
        let encodings = l2_normalize(&flat, 1)?;
        let table = l2_normalize(&self.codebook, 1)?;
        let table_t = table.t();
        let scaled = (&encodings * &encodings).sum_axis(1, true)?;
        let cross = ops::matmul(&encodings, &table_t)?;
        let table_sq = (&table_t * &table_t).sum_axis(0, true)?;
        let dist = -(scaled - cross * 2.0f32 + table_sq);
        let codes = argmax_axis(&dist, -1, None)?.as_dtype(Dtype::Int32)?.reshape(&[b, t])?;
        let quantized = self.out_project.forward_nlc(&self.codebook.index(&codes))?; // [B, T, 1024]
        codes.eval()?;
        quantized.eval()?;
        Ok((codes, quantized))
    }
}

fn l2_normalize(x: &Array, axis: i32) -> Result<Array> {
    Ok(x / ((x * x).sum_axis(axis, true)? + 1e-12f32).sqrt()?)
}

pub struct SemanticCodec {
    pub encoder: SemanticEncoder,
    pub quantizer: SemanticQuantizer,
}

impl SemanticCodec {
    pub fn load(mut w: WeightMap) -> Result<Self> {
        Ok(Self {
            encoder: SemanticEncoder::load(&mut w, "encoder")?,
            quantizer: SemanticQuantizer::load(&mut w)?,
        })
    }
}

/// IndexTTS 2.5 语义码本解码器（官方 `EnhancedCodec.decode`）：码 → 码本嵌入 →
/// Vocos 解码骨干 → 时间轴 ×2 重复 → k=3 卷积，得到 50 Hz 的 S2Mel 内容特征。
pub struct CodecDecoderV25 {
    backbone: SemanticEncoder,
    quantizer: SemanticQuantizer,
    up: Conv1d,
}

impl CodecDecoderV25 {
    /// 读 `mlx-community/IndexTTS-2.5-fp16` 的 `codec.safetensors`（MLX 布局，内部重映射）。
    pub fn load(mut w: WeightMap) -> Result<Self> {
        v25_weights::remap_codec(&mut w)?;
        Ok(Self {
            backbone: SemanticEncoder::load(&mut w, "decoder")?,
            quantizer: SemanticQuantizer::load(&mut w)?,
            up: Conv1d::load(&mut w, "up")?.with_padding(1),
        })
    }

    /// 语义码 `N` 个 → 内容特征 `[1, 2N, 1024]`。
    pub fn decode(&self, codes: &[i32]) -> Result<Array> {
        ensure!(!codes.is_empty(), "IndexTTS 2.5 语义码为空");
        let n = codes.len() as i32;
        let code_tensor = Array::from_slice(codes, &[1, n]);
        let embedded = self.quantizer.vq2emb(&code_tensor)?.swap_axes(1, 2)?; // [1, N, 1024]
        let hidden = self.backbone.forward(&embedded)?;
        let channels = hidden.dim(2);
        let repeated = ops::broadcast_to(&hidden.expand_dims(2)?, &[1, n, 2, channels])?.reshape(&[1, 2 * n, channels])?;
        let content = self.up.forward_nlc(&repeated)?;
        content.eval()?;
        Ok(content)
    }
}
