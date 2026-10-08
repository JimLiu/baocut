//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/Qwen3TTS/Qwen3TTS.swift / Sources/Qwen3TTS/Qwen3TTS+ICL.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! `Qwen3Tts`：把 Talker / Code Predictor / codec 解码器 / 音色克隆串成
//! [`TtsEngine`]：预置说话人 / 声音描述 / x-vector 克隆走普通 prefill，带参考原文的克隆走 ICL prefill。

use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::synthesize::tensor::ops;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype};
use anyhow::{Context, Result, bail};

use crate::bundle::VerifiedFiles;
use crate::speech::tokenizer::Qwen3Tokenizer;
use crate::synthesize::tensor::host::{ModelMemoryCacheGuard, configure_memory_cache, ensure_device};

use crate::synthesize::types::{TtsAudio, TtsEngineKind, TtsProgress, TtsRequest, VoiceSpec};
use crate::synthesize::{ProgressSink, TtsEngine};

use super::code_predictor::CodePredictor;
use super::codec_decoder::CodecDecoder;
use super::codec_encoder::CodecEncoder;
use super::config::{ModelVariant, Qwen3TtsConfig};
use super::layers::token_array;
use super::mel;
use super::prompt::{self, IclTrailing};
use super::sampling::{Rng, SamplingConfig, sample_token};
use super::speaker_encoder::SpeakerEncoder;
use super::talker::Talker;
use super::tokens::{
    CODEC_BOS, CODEC_EOS, NUM_CODEBOOKS, SAMPLE_RATE, SUPPRESS_END, SUPPRESS_START, TTS_BOS, TTS_EOS, TTS_PAD, language_id,
    normalize_language,
};
use super::weights::Weights;
use crate::synthesize::resample::resample;
use crate::synthesize::stitch::Stitcher;

/// 参考音频解码用的中间采样率：先解到 48 kHz，再用 [`resample`] 降到 24 kHz（与 v2 同一条路）。
const REFERENCE_DECODE_RATE: u32 = 48_000;

/// 已加载的 Qwen3-TTS 12 Hz 模型（Base / CustomVoice / VoiceDesign）。
pub struct Qwen3Tts {
    config: Qwen3TtsConfig,
    tokenizer: Qwen3Tokenizer,
    talker: Talker,
    code_predictor: CodePredictor,
    codec_decoder: CodecDecoder,
    /// Base 模型才有（克隆用 x-vector）。
    speaker_encoder: Option<SpeakerEncoder>,
    /// ICL 克隆时才加载（Base + 参考文本）。
    codec_encoder: Option<CodecEncoder>,
    /// 语音分词器（codec 组件）的权重文件，ICL 克隆时按需再读一次编码器部分。
    codec_files: Vec<PathBuf>,
    /// 最后一个字段：权重先析构，再等 GPU 并清缓存。
    _cache_guard: ModelMemoryCacheGuard,
}

/// 一次生成用的 prefill 产物。
struct Prefill {
    embeds: Array,
    trailing: Array,
    tts_pad: Array,
}

/// 一次生成的结果。
struct Generated {
    /// `[1, 16, frames]` Int32；`frames == 0` 时为空。
    codes: Option<Array>,
    frames: usize,
}

impl Qwen3Tts {
    /// 按清单加载。`model` 是主模型组件（`config.json` + `*.safetensors` + `vocab.json`，
    /// `merges.txt` / `tokenizer_config.json` 列了就用）；`codec` 是语音分词器组件
    /// （`Qwen/Qwen3-TTS-Tokenizer-12Hz` 的 `*.safetensors`）。缺文件是 `MODEL_NOT_INSTALLED`，
    /// 在碰 Metal 之前就报。
    pub fn load(model: &VerifiedFiles, codec: &VerifiedFiles) -> Result<Self> {
        let config_path = model.require("config.json")?;
        let vocabulary = model.require("vocab.json")?;
        let model_weights = model.require_extension_in("", "safetensors")?;
        let codec_files: Vec<PathBuf> = codec
            .require_extension_in("", "safetensors")?
            .into_iter()
            .map(Path::to_path_buf)
            .collect();

        ensure_device()?;
        configure_memory_cache()?;
        // 先建守卫：后面任何一步加载失败，展开时也会等 GPU 并清掉已分配的缓存。
        let cache_guard = ModelMemoryCacheGuard;

        let config_text = std::fs::read_to_string(config_path).with_context(|| format!("读取 {}", config_path.display()))?;
        let config = Qwen3TtsConfig::parse(&config_text)?;
        let tokenizer = Qwen3Tokenizer::load(vocabulary, model.path("merges.txt"), model.path("tokenizer_config.json"))?;

        let mut weights = Weights::load(&model_weights, !config.is_quantized())?;
        let mut cp_weights = weights.split_prefix("talker.code_predictor.");
        let mut talker_weights = weights.split_prefix("talker.");
        let code_predictor = CodePredictor::load(&mut cp_weights, &config.code_predictor)?;
        let talker = Talker::load(&mut talker_weights, &config.talker)?;
        let speaker_encoder = if weights.contains("speaker_encoder.blocks.0.conv.weight") {
            let mut spk_weights = weights.split_prefix("speaker_encoder.");
            Some(SpeakerEncoder::load(&mut spk_weights)?)
        } else {
            None
        };

        let mut codec_weights = Weights::load(&path_refs(&codec_files), false)?;
        let mut decoder_weights = codec_weights.split_prefix("decoder.");
        let codec_decoder = CodecDecoder::load(&mut decoder_weights)?;

        Ok(Self {
            config,
            tokenizer,
            talker,
            code_predictor,
            codec_decoder,
            speaker_encoder,
            codec_encoder: None,
            codec_files,
            _cache_guard: cache_guard,
        })
    }

    /// 模型配置（含说话人表）。
    pub fn config(&self) -> &Qwen3TtsConfig {
        &self.config
    }

    /// 是否具备克隆能力（Base 变体带 speaker_encoder）。
    pub fn supports_cloning(&self) -> bool {
        self.speaker_encoder.is_some()
    }

    fn ensure_codec_encoder(&mut self) -> Result<&CodecEncoder> {
        if self.codec_encoder.is_none() {
            let mut codec_weights = Weights::load(&path_refs(&self.codec_files), false)?;
            let mut encoder_weights = codec_weights.split_prefix("encoder.");
            self.codec_encoder = Some(CodecEncoder::load(&mut encoder_weights)?);
        }
        Ok(self.codec_encoder.as_ref().expect("刚加载"))
    }

    // ---- 嵌入辅助 ----

    fn hidden(&self) -> i32 {
        self.talker.hidden_size as i32
    }

    fn embed_text_tokens(&self, tokens: &[i32]) -> Result<Array> {
        self.talker.embed_text(&token_array(tokens))
    }

    fn embed_codec_tokens(&self, tokens: &[i32]) -> Array {
        self.talker.embed_codec(&token_array(tokens))
    }

    /// `[1, n, D]` 的 tts_pad 重复。
    fn pad_block(&self, tts_pad: &Array, count: usize) -> Result<Array> {
        Ok(ops::broadcast_to(tts_pad, &[1, count as i32, self.hidden()])?)
    }

    /// 在 codec 前缀嵌入的 `insert_at` 位置插入说话人向量 `[1, 1024]`。
    fn inject_speaker(&self, codec_embeds: &Array, speaker: &Array, insert_at: usize) -> Result<Array> {
        let spk = speaker.reshape(&[1, 1, self.hidden()])?.as_dtype(codec_embeds.dtype())?;
        let at = insert_at as i32;
        let part0 = codec_embeds.index((.., ..at, ..));
        let part1 = codec_embeds.index((.., at.., ..));
        Ok(ops::concatenate_axis(&[&part0, &spk, &part1], 1)?)
    }

    /// 普通 / x-vector 路径的 prefill。
    fn build_prefill(
        &self,
        text_tokens: &[i32],
        codec_prefix: &[i32],
        instruct_tokens: Option<&[i32]>,
        speaker_embedding: Option<&Array>,
    ) -> Result<Prefill> {
        let text_embeds = self.embed_text_tokens(text_tokens)?;
        let mut codec_embeds = self.embed_codec_tokens(codec_prefix);
        if let Some(spk) = speaker_embedding {
            codec_embeds = self.inject_speaker(&codec_embeds, spk, 4)?;
        }
        let tts_pad = self.embed_text_tokens(&[TTS_PAD])?;
        let tts_bos = self.embed_text_tokens(&[TTS_BOS])?;
        let tts_eos = self.embed_text_tokens(&[TTS_EOS])?;

        let codec_len = codec_embeds.dim(1);
        let pad_count = (codec_len - 2) as usize;
        let text_overlay = ops::concatenate_axis(&[&self.pad_block(&tts_pad, pad_count)?, &tts_bos], 1)?;
        let combined = text_overlay.add(&codec_embeds.index((.., ..codec_len - 1, ..)))?;
        let role_embed = text_embeds.index((.., ..3, ..));
        let first_text_plus_codec = text_embeds
            .index((.., 3..4, ..))
            .add(&codec_embeds.index((.., codec_len - 1.., ..)))?;

        let embeds = match instruct_tokens {
            Some(instruct) => {
                let instruct_embeds = self.embed_text_tokens(instruct)?;
                ops::concatenate_axis(&[&instruct_embeds, &role_embed, &combined, &first_text_plus_codec], 1)?
            }
            None => ops::concatenate_axis(&[&role_embed, &combined, &first_text_plus_codec], 1)?,
        };

        let trailing = match prompt::trailing_text_range(text_tokens.len()) {
            Some(range) => {
                let slice = text_embeds.index((.., range.start as i32..range.end as i32, ..));
                ops::concatenate_axis(&[&slice, &tts_eos], 1)?
            }
            None => tts_eos,
        };
        crate::synthesize::tensor::transforms::eval([&embeds, &trailing, &tts_pad])?;
        Ok(Prefill { embeds, trailing, tts_pad })
    }

    /// ICL 路径的 prefill。
    fn build_icl_prefill(
        &self,
        ref_codes: &Array,
        reference_text: &str,
        target_text: &str,
        language: Option<i32>,
        speaker_embedding: &Array,
    ) -> Result<Prefill> {
        let hidden = self.hidden();
        let mut combined_ids = self.tokenizer.encode(reference_text);
        combined_ids.extend(self.tokenizer.encode(target_text));

        let tts_pad = self.embed_text_tokens(&[TTS_PAD])?;
        let tts_bos = self.embed_text_tokens(&[TTS_BOS])?;
        let tts_eos = self.embed_text_tokens(&[TTS_EOS])?;

        let text_embed = self.embed_text_tokens(&combined_ids)?;
        let text_with_eos = ops::concatenate_axis(&[&text_embed, &tts_eos], 1)?;
        let text_len = text_with_eos.dim(1) as usize;

        // codec_bos + Σ 各 codebook 嵌入(ref_codes)
        let mut ref_codec_embed = self.talker.embed_codec(&ref_codes.index((.., 0, ..)));
        for group in 0..self.code_predictor.num_groups() {
            let ids = ref_codes.index((.., (group + 1) as i32, ..));
            ref_codec_embed = ref_codec_embed.add(&self.code_predictor.embed_group(&ids, group))?;
        }
        let codec_bos = self.embed_codec_tokens(&[CODEC_BOS]);
        let codec_icl = ops::concatenate_axis(&[&codec_bos, &ref_codec_embed], 1)?;
        let codec_len = codec_icl.dim(1) as usize;

        let (icl_input, trailing) = match prompt::icl_alignment(text_len, codec_len) {
            IclTrailing::TextFrom(from) => (
                text_with_eos.index((.., ..from as i32, ..)).add(&codec_icl)?,
                text_with_eos.index((.., from as i32.., ..)),
            ),
            IclTrailing::Padded { pad_count } => {
                let padded = if pad_count > 0 {
                    ops::concatenate_axis(&[&text_with_eos, &self.pad_block(&tts_pad, pad_count)?], 1)?
                } else {
                    text_with_eos
                };
                (padded.add(&codec_icl)?, tts_pad.clone())
            }
        };

        let (prefix_tokens, insert_at) = prompt::icl_codec_prefix(language);
        let codec_prefix = self.embed_codec_tokens(&prefix_tokens);
        let codec_prefix = self.inject_speaker(&codec_prefix, speaker_embedding, insert_at)?;
        let prefix_len = codec_prefix.dim(1);
        let pad_count = (prefix_len - 2) as usize;
        let combined_prefix = ops::concatenate_axis(&[&self.pad_block(&tts_pad, pad_count)?, &tts_bos], 1)?.add(&codec_prefix.index((
            ..,
            ..prefix_len - 1,
            ..,
        )))?;

        let role_embed = self.embed_text_tokens(&prompt::role_tokens())?;
        let embeds = ops::concatenate_axis(&[&role_embed, &combined_prefix, &icl_input], 1)?;
        debug_assert_eq!(embeds.dim(2), hidden);
        crate::synthesize::tensor::transforms::eval([&embeds, &trailing, &tts_pad])?;
        Ok(Prefill { embeds, trailing, tts_pad })
    }

    /// 自回归生成。
    fn generate(
        &self,
        prefill: &Prefill,
        sampling: &SamplingConfig,
        rng: &mut Rng,
        chunk_index: usize,
        progress: &mut ProgressSink<'_>,
    ) -> Result<Generated> {
        let safe_max_tokens = sampling.max_tokens.min(prompt::SAFE_MAX_TOKENS);
        // Code Predictor 只继承温度与 top-k。
        let cp_sampling = SamplingConfig {
            temperature: sampling.temperature,
            top_k: sampling.top_k,
            ..SamplingConfig::default()
        };
        let num_groups = self.code_predictor.num_groups();
        let mut first_codebook: Vec<i32> = Vec::new();
        let mut all_codebooks: Vec<Vec<i32>> = vec![Vec::new(); num_groups + 1];

        let prefill_len = prefill.embeds.dim(1);
        let (logits, hidden, mut cache) = self.talker.forward(&prefill.embeds, 0, None, None)?;
        let last_logits = logits.index((.., prefill_len - 1..prefill_len, ..));
        let mut next = self.sample_first_codebook(&last_logits, sampling, &first_codebook, rng)?;
        if next == CODEC_EOS {
            return Ok(Generated { codes: None, frames: 0 });
        }
        first_codebook.push(next);
        all_codebooks[0].push(next);
        let last_hidden = hidden.index((.., prefill_len - 1..prefill_len, ..));
        let mut code_tokens = self.predict_frame(&last_hidden, next, &cp_sampling, rng)?;
        for (group, &token) in code_tokens.iter().enumerate() {
            all_codebooks[group + 1].push(token);
        }

        let trailing_len = prefill.trailing.dim(1);
        let mut trailing_idx = 0i32;
        let mut step = prefill_len;
        let mut hit_eos = false;
        for _ in 1..safe_max_tokens {
            if !progress(TtsProgress::Tokens {
                index: chunk_index,
                generated: first_codebook.len(),
            }) {
                bail!("合成已取消");
            }
            let text_embed = if trailing_idx < trailing_len {
                let embed = prefill.trailing.index((.., trailing_idx..trailing_idx + 1, ..));
                trailing_idx += 1;
                embed
            } else {
                prefill.tts_pad.clone()
            };
            let codec_embed = self
                .embed_codec_tokens(&[next])
                .add(&self.code_predictor.batch_embed_all_groups(&code_tokens)?)?;
            let step_embeds = text_embed.add(&codec_embed)?;

            let (logits, hidden, new_cache) = self.talker.forward(&step_embeds, step, None, Some(&cache))?;
            cache = new_cache;
            next = self.sample_first_codebook(&logits, sampling, &first_codebook, rng)?;
            if next == CODEC_EOS {
                hit_eos = true;
                break;
            }
            first_codebook.push(next);
            all_codebooks[0].push(next);
            code_tokens = self.predict_frame(&hidden, next, &cp_sampling, rng)?;
            for (group, &token) in code_tokens.iter().enumerate() {
                all_codebooks[group + 1].push(token);
            }
            step += 1;
        }
        drop(cache);

        let frames = first_codebook.len();
        if frames >= safe_max_tokens && !hit_eos {
            eprintln!(
                "[qwen3-tts] 达到安全上限 {safe_max_tokens} 个 token（约 {:.1}s），输出可能被截断",
                frames as f64 / 12.5
            );
        }
        let codes = stack_codebooks(&all_codebooks, frames);
        Ok(Generated {
            codes: Some(codes),
            frames,
        })
    }

    fn sample_first_codebook(&self, logits: &Array, sampling: &SamplingConfig, generated: &[i32], rng: &mut Rng) -> Result<i32> {
        let flat = logits.as_dtype(Dtype::Float32)?;
        flat.eval()?;
        let mut scores = flat.as_slice::<f32>().to_vec();
        Ok(sample_token(
            &mut scores,
            sampling,
            generated,
            Some((SUPPRESS_START, SUPPRESS_END)),
            CODEC_EOS,
            rng,
        ))
    }

    fn predict_frame(&self, hidden: &Array, first_token: i32, cp_sampling: &SamplingConfig, rng: &mut Rng) -> Result<Vec<i32>> {
        let code0 = self.embed_codec_tokens(&[first_token]);
        self.code_predictor.predict_frame(hidden, &code0, cp_sampling, rng)
    }

    // ---- 参考音频 ----

    /// 解码参考音频为 24 kHz 单声道。
    fn load_reference_audio(path: &Path) -> Result<Vec<f32>> {
        let samples = crate::audio::decode_mono(path, REFERENCE_DECODE_RATE).with_context(|| format!("解码参考音频 {}", path.display()))?;
        if samples.is_empty() {
            bail!("参考音频 {} 没有可用采样", path.display());
        }
        Ok(resample(&samples, REFERENCE_DECODE_RATE, SAMPLE_RATE))
    }

    /// 参考音频 → x-vector `[1, 1024]`。
    fn speaker_embedding(&self, audio_24k: &[f32]) -> Result<Array> {
        let Some(encoder) = &self.speaker_encoder else {
            bail!("当前模型没有 speaker_encoder，无法克隆音色（需要 Qwen3-TTS Base 变体）");
        };
        let mel = mel::compute(audio_24k);
        if mel.frames == 0 {
            bail!("参考音频太短，无法提取说话人特征");
        }
        let mels = Array::from_slice(&mel.data, &[1, mel.frames as i32, mel::N_MELS as i32]);
        let embed = encoder.forward(&mels)?;
        embed.eval()?;
        Ok(embed)
    }

    /// 解码 codes 为 24 kHz 波形。
    fn decode(&self, codes: &Array) -> Result<Vec<f32>> {
        self.codec_decoder.decode_to_samples(codes)
    }

    // ---- 单块合成 ----

    fn synthesize_chunk(
        &mut self,
        text: &str,
        plan: &VoicePlan,
        sampling: &SamplingConfig,
        rng: &mut Rng,
        chunk_index: usize,
        progress: &mut ProgressSink<'_>,
    ) -> Result<Vec<f32>> {
        let started = Instant::now();
        let samples = match plan {
            VoicePlan::Prompt {
                speaker_token,
                language,
                instruct,
                speaker_embedding,
            } => {
                let text_ids = self.tokenizer.encode(text);
                let text_tokens = prompt::text_tokens(&text_ids);
                let codec_prefix = prompt::codec_prefix(*language, *speaker_token);
                let instruct_tokens = instruct.as_deref().map(|s| prompt::instruct_tokens(&self.tokenizer.encode(s)));
                let prefill = self.build_prefill(&text_tokens, &codec_prefix, instruct_tokens.as_deref(), speaker_embedding.as_ref())?;
                let mut capped = sampling.clone();
                capped.max_tokens = prompt::max_token_cap(text_ids.len(), sampling.max_tokens);
                let generated = self.generate(&prefill, &capped, rng, chunk_index, progress)?;
                match generated.codes {
                    Some(codes) if generated.frames > 0 => self.decode(&codes)?,
                    _ => Vec::new(),
                }
            }
            VoicePlan::Icl {
                ref_codes,
                reference_text,
                language,
                speaker_embedding,
            } => {
                let prefill = self.build_icl_prefill(ref_codes, reference_text, text, *language, speaker_embedding)?;
                let mut icl_sampling = sampling.clone();
                if icl_sampling.temperature > 0.0 && icl_sampling.repetition_penalty < 1.5 {
                    icl_sampling.repetition_penalty = 1.5;
                }
                let target_count = self.tokenizer.encode(text).len();
                icl_sampling.max_tokens = prompt::icl_max_token_cap(target_count, sampling.max_tokens);
                let generated = self.generate(&prefill, &icl_sampling, rng, chunk_index, progress)?;
                match generated.codes {
                    Some(codes) if generated.frames > 0 => {
                        let ref_frames = ref_codes.dim(2) as usize;
                        let for_decode = ops::concatenate_axis(&[ref_codes, &codes], 2)?;
                        let total_frames = ref_frames + generated.frames;
                        let full = self.decode(&for_decode)?;
                        let cut = prompt::icl_reference_cut(ref_frames, total_frames, full.len());
                        full[cut..].to_vec()
                    }
                    _ => Vec::new(),
                }
            }
        };
        let elapsed = started.elapsed().as_secs_f64();
        let audio_seconds = samples.len() as f64 / SAMPLE_RATE as f64;
        eprintln!(
            "[qwen3-tts] 块 {chunk_index}: {} 字符 → {:.2}s 音频，用时 {elapsed:.2}s（RTF {:.2}）",
            text.chars().count(),
            audio_seconds,
            if audio_seconds > 0.0 { elapsed / audio_seconds } else { 0.0 }
        );
        Ok(samples)
    }

    /// 把请求的音色解析成生成计划（一次请求只做一次参考音频处理）。
    fn plan_voice(&mut self, request: &TtsRequest, progress: &mut ProgressSink<'_>) -> Result<VoicePlan> {
        let (language_name, language_explicit) = match request.language.as_deref() {
            Some(tag) if !tag.trim().is_empty() && tag.trim() != "auto" => (normalize_language(tag), true),
            _ => (normalize_language(crate::synthesize::text::guess_language(&request.text)), false),
        };

        // VoiceDesign 只会按一句描述造声：`--instruct` 就是那句描述；没给时内置音色在它身上
        // 是那一句**描述**（`voices::style_for`），点名内置音色又给了 `--instruct` 时两句都说。
        if self.config.variant == ModelVariant::VoiceDesign {
            let described = match &request.voice {
                VoiceSpec::Clone { .. } => bail!("Qwen3-TTS VoiceDesign 不接受参考音频，声音只由一句描述（--instruct）决定"),
                VoiceSpec::Default if request.instruct.as_deref().is_some_and(|text| !text.trim().is_empty()) => request.clone(),
                _ => {
                    let style = crate::synthesize::voices::style_for(request, "Qwen3-TTS VoiceDesign")?;
                    let mut described = request.clone();
                    described.instruct = style.instruct;
                    described
                }
            };
            return self.plan_prompt(None, &described, &language_name, language_explicit);
        }

        // Base 没有说话人表：`Preset` / `Default` 都落到随包的内置音色，用它的录音
        // 算 x-vector（`crate::voices`，与 IndexTTS / GPT-SoVITS 同一张表同一组 id）。
        // CustomVoice 有自己的 9 只说话人，随包录音在它身上用不上。
        let voice = if self.config.speaker.is_none() && self.speaker_encoder.is_some() {
            match &request.voice {
                VoiceSpec::Clone { .. } => None,
                _ => Some(crate::synthesize::voices::builtin_for(request, "Qwen3-TTS Base")?.expect("非 Clone")),
            }
        } else {
            None
        };
        if let Some(voice) = voice {
            if !progress(TtsProgress::Loading {
                stage: format!("内置音色 {}", voice.id),
            }) {
                bail!("合成已取消");
            }
            // 随包录音在内存里解码并重采样到 24 kHz，不落盘。
            let audio = crate::synthesize::voices::builtin(voice).audio.samples(SAMPLE_RATE)?;
            let speaker_embedding = self.speaker_embedding(&audio)?;
            return Ok(VoicePlan::Prompt {
                speaker_token: None,
                language: language_id(&language_name).unwrap_or_else(|| {
                    eprintln!("[qwen3-tts] 未知语言 {language_name:?}，回退英语");
                    super::tokens::LANGUAGE_ENGLISH
                }),
                instruct: None,
                speaker_embedding: Some(speaker_embedding),
            });
        }

        match &request.voice {
            VoiceSpec::Clone {
                reference_audio,
                reference_text,
            } => {
                if self.speaker_encoder.is_none() {
                    bail!(
                        "当前模型（{}）不支持音色克隆，请使用 Qwen3-TTS Base 变体，或改用预置说话人 / 声音描述",
                        self.config.variant.label()
                    );
                }
                if !progress(TtsProgress::Loading {
                    stage: "解码参考音频".into(),
                }) {
                    bail!("合成已取消");
                }
                let audio = Self::load_reference_audio(reference_audio)?;
                let speaker_embedding = self.speaker_embedding(&audio)?;
                let language = language_id(&language_name);
                match reference_text.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    Some(reference_text) => {
                        if !progress(TtsProgress::Loading {
                            stage: "编码参考音频".into(),
                        }) {
                            bail!("合成已取消");
                        }
                        let ref_codes = self.ensure_codec_encoder()?.encode(&audio)?;
                        // ICL 只在调用方显式指定语言时带语言 token（未指定时按 "auto"）。
                        let language = if language_explicit { language } else { None };
                        Ok(VoicePlan::Icl {
                            ref_codes,
                            reference_text: reference_text.to_string(),
                            language,
                            speaker_embedding,
                        })
                    }
                    None => Ok(VoicePlan::Prompt {
                        speaker_token: None,
                        language: language.unwrap_or_else(|| {
                            eprintln!("[qwen3-tts] 未知语言 {language_name:?}，回退英语");
                            super::tokens::LANGUAGE_ENGLISH
                        }),
                        instruct: None,
                        speaker_embedding: Some(speaker_embedding),
                    }),
                }
            }
            VoiceSpec::Preset { speaker } => self.plan_prompt(Some(speaker), request, &language_name, language_explicit),
            VoiceSpec::Default => {
                // CustomVoice：按语言挑默认那只说话人（日语 Ono_Anna、韩语 Sohee…），
                // 不再拿说话人表里字母序的第一只顶。
                let pick = prompt::default_speaker(&language_name, self.config.speaker.as_ref());
                self.plan_prompt(pick.as_deref(), request, &language_name, language_explicit)
            }
        }
    }

    fn plan_prompt(&self, speaker: Option<&str>, request: &TtsRequest, language_name: &str, language_explicit: bool) -> Result<VoicePlan> {
        let resolved = prompt::resolve_speaker(speaker, self.config.speaker.as_ref(), language_name, language_explicit);
        if let Some(warning) = &resolved.warning {
            if speaker.is_some() && self.config.speaker.is_some() {
                bail!("{warning}");
            }
            eprintln!("[qwen3-tts] {warning}");
        }
        let language = match language_id(&resolved.language) {
            Some(id) => id,
            None => {
                eprintln!("[qwen3-tts] 未知语言 {:?}，回退英语", resolved.language);
                super::tokens::LANGUAGE_ENGLISH
            }
        };
        // CustomVoice 没给 instruct 时补默认指令。
        let instruct = match request.instruct.as_deref().map(str::trim) {
            Some(s) if !s.is_empty() => Some(s.to_string()),
            _ => self.config.speaker.as_ref().map(|_| prompt::DEFAULT_INSTRUCT.to_string()),
        };
        Ok(VoicePlan::Prompt {
            speaker_token: resolved.token,
            language,
            instruct,
            speaker_embedding: None,
        })
    }
}

/// 一次请求解析出的生成方式。
enum VoicePlan {
    /// 预置说话人 / 默认 / x-vector 克隆：codec 前缀 + 可选说话人向量。
    Prompt {
        speaker_token: Option<i32>,
        language: i32,
        instruct: Option<String>,
        speaker_embedding: Option<Array>,
    },
    /// ICL 克隆：参考 codec + 参考文本进入上下文。
    Icl {
        ref_codes: Array,
        reference_text: String,
        language: Option<i32>,
        speaker_embedding: Array,
    },
}

impl TtsEngine for Qwen3Tts {
    fn kind(&self) -> TtsEngineKind {
        TtsEngineKind::Qwen3Tts
    }

    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    fn preset_speakers(&self) -> Vec<String> {
        // CustomVoice 报模型自己的 9 只；Base 没有说话人表，报随包的内置音色。
        self.config
            .speaker
            .as_ref()
            .map(SpeakerConfigExt::display_names)
            .unwrap_or_else(crate::synthesize::voices::ids)
    }

    fn synthesize(&mut self, request: &TtsRequest, mut progress: ProgressSink<'_>) -> Result<TtsAudio> {
        let text = request.text.trim();
        if text.is_empty() {
            bail!("合成文本为空");
        }
        let chunks = crate::synthesize::text::chunk_with_breaks(text, crate::synthesize::text::DEFAULT_MAX_UNITS);
        if chunks.is_empty() {
            bail!("合成文本切块后为空");
        }
        let sampling = SamplingConfig::from_options(&request.sampling);
        let mut rng = Rng::from_optional_seed(request.sampling.seed);
        let plan = self.plan_voice(request, &mut progress)?;

        // 块与块之间的停顿与响度由拼接统一定（`synthesize::stitch`），不用模型在块首尾自带的静音。
        let count = chunks.len();
        let mut stitcher = Stitcher::new(SAMPLE_RATE, count);
        for (index, chunk) in chunks.iter().enumerate() {
            if !progress(TtsProgress::ChunkStarted { index, count }) {
                bail!("合成已取消");
            }
            let chunk_samples = self.synthesize_chunk(&chunk.text, &plan, &sampling, &mut rng, index, &mut progress)?;
            stitcher.push(&chunk_samples, chunk.after);
            let seconds = stitcher.seconds();
            if !progress(TtsProgress::ChunkFinished { index, seconds }) {
                bail!("合成已取消");
            }
        }
        Ok(TtsAudio {
            samples: stitcher.finish(),
            sample_rate: SAMPLE_RATE,
            readings_dropped: Vec::new(),
        })
    }
}

/// 说话人展示名：配置里是小写键，这里首字母大写（`vivian` → `Vivian`）。
trait SpeakerConfigExt {
    fn display_names(&self) -> Vec<String>;
}

impl SpeakerConfigExt for super::config::SpeakerConfig {
    fn display_names(&self) -> Vec<String> {
        self.available_speakers()
            .into_iter()
            .map(|name| {
                let mut chars = name.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => name,
                }
            })
            .collect()
    }
}

/// `Vec<PathBuf>` → `Weights::load` 要的 `&[&Path]`。
fn path_refs(paths: &[PathBuf]) -> Vec<&Path> {
    paths.iter().map(PathBuf::as_path).collect()
}

/// `[[codebook0...], [codebook1...], ...]` → `[1, 16, frames]` Int32。
fn stack_codebooks(all: &[Vec<i32>], frames: usize) -> Array {
    let mut flat = Vec::with_capacity(NUM_CODEBOOKS * frames);
    for codebook in all {
        flat.extend_from_slice(&codebook[..frames]);
    }
    Array::from_slice(&flat, &[1, all.len() as i32, frames as i32])
}
