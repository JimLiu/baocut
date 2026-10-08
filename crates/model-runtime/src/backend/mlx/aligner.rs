//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/ForcedAligner.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3-ForcedAligner（0.6B，MLX 量化）：已知文本 + 音频 → 词时间。移植自 v2 `bcut-speech` 的 `aligner.rs`。
//!
//! 一次非自回归前向：音频塔编码、文本里每个词后面放两个时间戳槽，分类头在槽上给出 0.08 秒一格的时间，再单调化。
//! 长音频（> 240 秒）的分段驱动在 [`crate::speech::align_common`]。
//!
//! v3 只改边界：文件按模型包清单取（[`VerifiedFiles`]），量化位数从 `quantize_config.json` 读，不再从仓库名推断。

use anyhow::{Context, Result};
use mlx_rs::Array;
use mlx_rs::ops::indexing::{IndexOp, argmax_axis};

use super::qwen3::{AudioEncoderConfig, Qwen3AudioEncoder, TextDecoder, TextDecoderConfig, WeightStore};
use super::runtime::{self, MemoryCacheGuard, ModelMemoryCacheGuard};
use crate::bundle::VerifiedFiles;
use crate::speech::mel::WhisperFeaturePipeline;
use crate::speech::qwen3_asr::aligner_quantization_bits;
use crate::speech::text_prep::{alignment_input, prepare_for_alignment};
use crate::speech::timestamp::enforce_monotonicity;
use crate::speech::tokenizer::Qwen3Tokenizer;
use crate::speech::{AlignedWord, ForcedAlignment};

const TIMESTAMP_SECONDS: f32 = 0.08;

pub struct ForcedAligner {
    audio_encoder: Qwen3AudioEncoder,
    text_decoder: TextDecoder,
    classify_weight: Array,
    classify_bias: Option<Array>,
    tokenizer: Qwen3Tokenizer,
    feature_pipeline: WhisperFeaturePipeline,
    // Fields drop in declaration order: release weights before flushing their buffers.
    _memory_cache_guard: ModelMemoryCacheGuard,
}

impl ForcedAligner {
    /// 从 `aligner` 组件的文件加载：目录顶层的 `*.safetensors`、`vocab.json`（必需），`merges.txt`、
    /// `tokenizer_config.json`、`quantize_config.json`（列出了才读）。
    pub fn load(files: &VerifiedFiles) -> Result<Self> {
        runtime::ensure_metal_device()?;
        let bits = aligner_quantization_bits(files.path("quantize_config.json"))?;
        let weights = files.require_extension_in("", "safetensors")?;
        let vocabulary = files.require("vocab.json")?;
        // Also flush partially loaded weights on an early error.
        let memory_cache_guard = ModelMemoryCacheGuard;
        let mut store = WeightStore::load(&weights)?;
        let audio_encoder = Qwen3AudioEncoder::load(&mut store, AudioEncoderConfig::FORCED_ALIGNER)?;
        let text_decoder = TextDecoder::load(&mut store, TextDecoderConfig::small(bits))?;
        let classify_weight = store.take("lm_head.weight")?;
        let classify_bias = store.take_optional("lm_head.bias");
        let tokenizer = Qwen3Tokenizer::load(vocabulary, files.path("merges.txt"), files.path("tokenizer_config.json"))
            .context("无法加载对齐器 tokenizer")?;
        let _unused_checkpoint_metadata = store.remaining();
        Ok(Self {
            audio_encoder,
            text_decoder,
            classify_weight,
            classify_bias,
            tokenizer,
            feature_pipeline: WhisperFeaturePipeline::new(128),
            _memory_cache_guard: memory_cache_guard,
        })
    }

    fn align_once(&mut self, audio: &[f32], text: &str, language: &str) -> Result<Vec<AlignedWord>> {
        // 与 Qwen3 ASR 一样，对齐器按 VAD 片段反复执行。只释放本轮已经不用的
        // Metal 临时缓冲区，权重仍留在 `self`，以限制峰值而不牺牲后续片段的加载时间。
        let _memory_cache_guard = MemoryCacheGuard::new();
        if audio.is_empty() || text.trim().is_empty() {
            return Ok(Vec::new());
        }
        let mel = self.feature_pipeline.extract(audio)?;
        let audio_embeddings = self.audio_encoder.encode(&mel)?.expand_dims(0)?;
        let slotted = prepare_for_alignment(text, &self.tokenizer, language);
        if slotted.words.is_empty() {
            return Ok(Vec::new());
        }
        let audio_tokens = audio_embeddings.dim(1) as usize;
        let input = alignment_input(&slotted, audio_tokens);
        let audio_begin = input.audio_range.start;
        let audio_end = input.audio_range.end;
        let ids = input.token_ids;

        let input_ids = Array::from_slice(&ids, &[1, ids.len() as i32]);
        let input_embeddings = self.text_decoder.embed(&input_ids)?;
        let typed_audio = audio_embeddings.as_dtype(input_embeddings.dtype())?;
        let before = input_embeddings.index((.., 0..audio_begin as i32, ..));
        let after = input_embeddings.index((.., audio_end as i32.., ..));
        let input_embeddings = mlx_rs::ops::concatenate_axis(&[before, typed_audio, after], 1)?;
        let (hidden, _) = self.text_decoder.decode(&input_embeddings, None, None)?;
        // 只在时间戳位置上计算分类 logits：先按位置取 hidden 再投影，
        // 避免整个序列 × 词表的大 matmul,也避免逐位置的 GPU 同步。
        let positions = input
            .timestamp_positions
            .iter()
            .map(|position| *position as i32)
            .collect::<Vec<_>>();
        let position_index = Array::from_slice(&positions, &[positions.len() as i32]);
        let position_hidden = mlx_rs::ops::indexing::take_axis(hidden.index((0, .., ..)), &position_index, 0)?;
        let mut position_logits = mlx_rs::ops::matmul(&position_hidden, self.classify_weight.t())?;
        if let Some(bias) = &self.classify_bias {
            position_logits = &position_logits + bias;
        }
        let best = argmax_axis(&position_logits, -1, false)?.as_dtype(mlx_rs::Dtype::Uint32)?;
        best.eval()?;
        let raw = best.as_slice::<u32>().iter().map(|value| *value as usize).collect::<Vec<_>>();
        let corrected = enforce_monotonicity(&raw);
        if std::env::var_os("ALIGN_DEBUG").as_deref() == Some(std::ffi::OsStr::new("1")) {
            eprintln!("[align-debug] indices={} audio_tokens={audio_tokens}", raw.len());
            eprintln!("[align-debug] first raw={:?}", &raw[..raw.len().min(10)]);
            eprintln!("[align-debug] first corrected={:?}", &corrected[..corrected.len().min(10)]);
        }
        Ok(slotted
            .words
            .into_iter()
            .zip(corrected.chunks_exact(2))
            .map(|(text, pair)| {
                let start = pair[0] as f32 * TIMESTAMP_SECONDS;
                let end = (pair[1] as f32 * TIMESTAMP_SECONDS).max(start);
                AlignedWord { text, start, end }
            })
            .collect())
    }
}

impl ForcedAlignment for ForcedAligner {
    fn align(&mut self, audio: &[f32], text: &str, language: Option<&str>) -> Result<Vec<AlignedWord>> {
        self.align_once(audio, text, language.unwrap_or("English"))
    }

    fn align_long(&mut self, audio: &[f32], text: &str, language: Option<&str>) -> Result<Vec<AlignedWord>> {
        let language = language.unwrap_or("English");
        crate::speech::align_common::align_long_with(
            |audio, text, language| self.align_once(audio, text, language),
            audio,
            text,
            language,
        )
    }
}

pub use crate::speech::align_common::trailing_plateau_start;
