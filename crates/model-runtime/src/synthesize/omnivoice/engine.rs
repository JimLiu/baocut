//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/OmniVoiceTTS/OmniVoiceModel.swift / Sources/OmniVoiceTTS/OmniVoiceTTSModel.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! `OmniVoice` 引擎：把 Qwen3 主干、Higgs 音频分词器接到 `TtsEngine`。
//! 生成流程对照官方 `omnivoice/models/omnivoice.py`（`generate` → `_preprocess_all` →
//! `_generate_iterative` / `_generate_chunked` → `_decode_and_post_process`），
//! 默认值对照 `OmniVoiceGenerationConfig`：32 步、引导 2.0、`t_shift = 0.1`、
//! `layer_penalty_factor = 5`、`position_temperature = 5`、`class_temperature = 0`（贪心）、
//! 去噪 token 开、后处理开（去长静音、音量归一、淡入淡出 0.1 s、两侧各补 0.1 s）。
//!
//! 音色三条路：
//! - `Default` 且带 `instruct` → 官方「音色设计」：不带参考音频，只凭 instruct；
//! - `Default` 不带 `instruct` → 该语言的内置音色作参考（官方此时是「auto」随机音色，
//!   BaoCut 要求同一请求音色稳定，所以改用内置音色）；
//! - `Preset` / `Clone` → 参考音频克隆（参考文本可缺；官方缺参考文本时会跑 Whisper
//!   转写，这里不转写，按「无参考文本」估时长与拼文本）；也可同时带 `instruct`。

use super::audio;
use super::backbone::{Backbone, predict};
use super::codec::Codec;
use super::config::{CodecConfig, OmniVoiceConfig};
use super::instruct::resolve_instruct;
use super::text::{add_punctuation, combine_text, contains_zh, estimate_target_tokens, resolve_language, split_nonverbal};
use super::tokenizer::Tokenizer;
use super::{DEFAULT_CFG, DEFAULT_STEPS, MAX_TARGET_SECONDS};
use crate::bundle::VerifiedFiles;
use crate::synthesize::qwen3_tts::sampling::Rng;
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::Array;
use crate::synthesize::tensor::host::{ModelMemoryCacheGuard, ensure_device};
use crate::synthesize::tensor::host::{clear_memory_cache, configure_memory_cache};
use crate::synthesize::tensor::ops;
use crate::synthesize::types::{TtsAudio, TtsEngineKind, TtsProgress, TtsRequest, VoiceSpec};
use crate::synthesize::voices::ReferenceAudio;
use crate::synthesize::{ProgressSink, TtsEngine};
use anyhow::{Context, Result, bail, ensure};

pub const ENGINE_NAME: &str = "OmniVoice";
pub const SAMPLE_RATE: u32 = 24_000;
const ABORT_MESSAGE: &str = "合成已取消";
/// 官方 `OmniVoiceGenerationConfig` 的其余默认。
const T_SHIFT: f32 = 0.1;
const LAYER_PENALTY: f32 = 5.0;
const POSITION_TEMPERATURE: f32 = 5.0;
const PAD_SECONDS: f64 = 0.1;
const FADE_SECONDS: f64 = 0.1;

pub struct OmniVoice {
    tokenizer: Tokenizer,
    backbone: Backbone,
    codec: Codec,
    /// 最后一个字段：权重先析构，再等 GPU 并清缓存。
    _cache_guard: ModelMemoryCacheGuard,
}

/// 已编码的参考：`[codebooks, frames]` token、参考文本、原始 RMS（音量归一用）。
pub(crate) struct VoicePrompt {
    codes: Vec<u32>,
    frames: usize,
    text: Option<String>,
    rms: Option<f32>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Sampling {
    pub cfg: f32,
    pub steps: usize,
    /// 每段目标 token 上限（25 Hz）。
    pub max_tokens: usize,
}

impl OmniVoice {
    /// 按清单加载：`config.json`、`tokenizer.json`、`model.safetensors`，以及同一组件里
    /// `audio_tokenizer/` 下的 `config.json`、`model.safetensors`。缺文件是 `MODEL_NOT_INSTALLED`，
    /// 在碰 Metal 之前就报。
    pub fn load(model: &VerifiedFiles) -> Result<Self> {
        Self::load_with_progress(model, &mut |_| true)
    }

    pub fn load_with_progress(model: &VerifiedFiles, progress: &mut dyn FnMut(TtsProgress) -> bool) -> Result<Self> {
        let config_path = model.require("config.json")?;
        let tokenizer_path = model.require("tokenizer.json")?;
        let weights_path = model.require("model.safetensors")?;
        let codec_files = model.require_subdirectory("audio_tokenizer")?;
        let codec_config_path = codec_files.require("config.json")?;
        let codec_weights_path = codec_files.require("model.safetensors")?;
        let mut stage = |name: &str| -> Result<()> {
            if !progress(TtsProgress::Loading { stage: name.to_string() }) {
                bail!(ABORT_MESSAGE);
            }
            Ok(())
        };
        stage("config")?;
        let config = OmniVoiceConfig::load(config_path)?;
        let codec_config = CodecConfig::load(codec_config_path)?;
        let tokenizer = Tokenizer::load(tokenizer_path)?;
        ensure_device()?;
        configure_memory_cache()?;
        // 先建守卫：后面任何一步加载失败，展开时也会等 GPU 并清掉已分配的缓存。
        let cache_guard = ModelMemoryCacheGuard;
        stage("weights")?;
        let mut weights =
            Weights::load(&[weights_path], false).with_context(|| format!("加载 {ENGINE_NAME} 权重 {}", weights_path.display()))?;
        let backbone = Backbone::load(&mut weights, &config)?;
        let leftover = weights.keys();
        ensure!(leftover.is_empty(), "{ENGINE_NAME} 有未使用的权重：{}", leftover.join(", "));
        drop(weights);
        stage("audio_tokenizer")?;
        let mut codec_weights = Weights::load(&[codec_weights_path], false)
            .with_context(|| format!("加载 {ENGINE_NAME} 音频分词器 {}", codec_weights_path.display()))?;
        let codec = Codec::load(&mut codec_weights, &codec_config)?;
        let leftover = codec_weights.keys();
        ensure!(
            leftover.is_empty(),
            "{ENGINE_NAME} 音频分词器有未使用的权重：{}",
            leftover.join(", ")
        );
        drop(codec_weights);
        let model = Self::assemble(tokenizer, backbone, codec)?;
        // 加载期的守卫在这里析构：等 GPU 并清缓存（v2 在这里调 `clear_memory_cache`）；模型自己的守卫管卸载。
        drop(cache_guard);
        Ok(model)
    }

    pub(crate) fn assemble(tokenizer: Tokenizer, backbone: Backbone, codec: Codec) -> Result<Self> {
        ensure!(
            codec.sample_rate == SAMPLE_RATE,
            "{ENGINE_NAME} 音频分词器采样率是 {}，预期 {SAMPLE_RATE}",
            codec.sample_rate
        );
        ensure!(
            codec.num_codebooks() == backbone.codebooks,
            "{ENGINE_NAME} 分词器 {} 个码本与主干 {} 个不符",
            codec.num_codebooks(),
            backbone.codebooks
        );
        for token in [
            "<|denoise|>",
            "<|lang_start|>",
            "<|lang_end|>",
            "<|instruct_start|>",
            "<|instruct_end|>",
            "<|text_start|>",
            "<|text_end|>",
        ] {
            ensure!(tokenizer.added_id(token).is_some(), "{ENGINE_NAME} 分词表缺少特殊 token {token}");
        }
        Ok(Self {
            tokenizer,
            backbone,
            codec,
            _cache_guard: ModelMemoryCacheGuard,
        })
    }

    fn frame_rate(&self) -> f64 {
        f64::from(SAMPLE_RATE) / self.codec.hop() as f64
    }

    /// 官方 `create_voice_clone_prompt`（`preprocess_prompt = True`）：记下原始 RMS、
    /// 过轻的参考先放大到 0.1；没有参考文本时截短超长参考；去长静音；裁到整帧；编码。
    pub(crate) fn prompt_from_samples(&self, samples: &[f32], text: Option<&str>) -> Result<VoicePrompt> {
        let rms = audio::rms(samples);
        let mut wav: Vec<f32> = if rms > 0.0 && rms < 0.1 {
            samples.iter().map(|s| s * 0.1 / rms).collect()
        } else {
            samples.to_vec()
        };
        if text.is_none() {
            wav = audio::trim_long_audio(&wav, SAMPLE_RATE);
        }
        wav = audio::remove_silence(&wav, SAMPLE_RATE, 200, 100, 200);
        ensure!(!wav.is_empty(), "{ENGINE_NAME} 参考音频去掉静音后为空");
        let hop = self.codec.hop();
        let frames = wav.len() / hop;
        ensure!(
            frames > 0,
            "{ENGINE_NAME} 参考音频太短（去静音后不足 {:.2} 秒）",
            hop as f64 / f64::from(SAMPLE_RATE)
        );
        wav.truncate(frames * hop);
        let codes = self.codec.encode(&wav)?.into_iter().map(|c| c as u32).collect();
        Ok(VoicePrompt {
            codes,
            frames,
            text: text.map(add_punctuation),
            rms: Some(rms),
        })
    }

    fn prompt_from_reference(&self, audio: &ReferenceAudio, text: Option<&str>) -> Result<VoicePrompt> {
        let samples = audio.samples(SAMPLE_RATE).with_context(|| format!("{ENGINE_NAME} 参考音频"))?;
        self.prompt_from_samples(&samples, text)
    }

    fn encode_text(&self, text: &str) -> Vec<u32> {
        split_nonverbal(text)
            .into_iter()
            .flat_map(|part| self.tokenizer.encode(part))
            .collect()
    }

    /// 官方 `_prepare_inference_inputs` 的前缀（目标之前的部分）：风格 token、
    /// `<|text_start|>参考文本 目标文本<|text_end|>`、参考音频 token。
    pub(crate) fn prefix_ids(
        &self,
        text: &str,
        ref_text: Option<&str>,
        has_reference: bool,
        language: Option<&str>,
        instruct: Option<&str>,
    ) -> Vec<u32> {
        let mut style = String::new();
        if has_reference {
            style.push_str("<|denoise|>");
        }
        style.push_str(&format!(
            "<|lang_start|>{}<|lang_end|><|instruct_start|>{}<|instruct_end|>",
            language.unwrap_or("None"),
            instruct.unwrap_or("None")
        ));
        let mut ids = self.tokenizer.encode(&style);
        let wrapped = format!("<|text_start|>{}<|text_end|>", combine_text(text, ref_text));
        ids.extend(self.encode_text(&wrapped));
        ids
    }

    /// 一段文本的迭代解码，返回 `[codebooks, target]` 行主序 token。
    /// `on_step(已完成步数)` 返回 `false` 即取消。
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn generate(
        &self,
        text: &str,
        target: usize,
        prompt: Option<(&[u32], usize, Option<&str>)>,
        language: Option<&str>,
        instruct: Option<&str>,
        sampling: Sampling,
        rng: &mut Rng,
        on_step: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<u32>> {
        let codebooks = self.backbone.codebooks;
        let mask = self.backbone.mask_id as u32;
        let ids = self.prefix_ids(text, prompt.and_then(|p| p.2), prompt.is_some(), language, instruct);
        let mut prefix = self.backbone.embed_text(&ids)?;
        if let Some((codes, frames, _)) = prompt {
            let audio = self.backbone.embed_audio(codes, frames)?;
            prefix = ops::concatenate_axis(&[&prefix, &audio], 1)?;
        }
        crate::synthesize::tensor::transforms::eval([&prefix])?;

        let total = target * codebooks;
        let schedule = unmask_schedule(total, sampling.steps);
        let mut tokens = vec![mask; total];
        let mut uniforms = vec![0f32; total];
        for (step, &count) in schedule.iter().enumerate() {
            if count > 0 {
                let target_embeds = self.backbone.embed_audio(&tokens, target)?;
                let cond = ops::concatenate_axis(&[&prefix, &target_embeds], 1)?;
                let cond = self.backbone.logits(&cond, target)?;
                let uncond: Option<Array> = if sampling.cfg != 0.0 {
                    Some(self.backbone.logits(&target_embeds, target)?)
                } else {
                    None
                };
                let (pred, score) = predict(&cond, uncond.as_ref(), sampling.cfg, mask as usize)?;
                for u in uniforms.iter_mut() {
                    *u = rng.next_f64() as f32;
                }
                unmask_top(&mut tokens, &pred, &score, &uniforms, target, count, mask);
            }
            if !on_step(step + 1) {
                bail!(ABORT_MESSAGE);
            }
        }
        debug_assert!(tokens.iter().all(|&t| t != mask));
        Ok(tokens)
    }

    /// 官方 `_post_process_audio`：去长静音 → 按参考 RMS 或峰值归一音量 → 淡入淡出补边。
    fn post_process(&self, audio: &[f32], ref_rms: Option<f32>) -> Vec<f32> {
        let mut out = audio::remove_silence(audio, SAMPLE_RATE, 500, 100, 100);
        match ref_rms {
            Some(rms) if rms < 0.1 => out.iter_mut().for_each(|s| *s *= rms / 0.1),
            Some(_) => {}
            None => {
                let peak = out.iter().fold(0f32, |m, s| m.max(s.abs()));
                if peak > 1e-6 {
                    out.iter_mut().for_each(|s| *s = *s / peak * 0.5);
                }
            }
        }
        audio::fade_and_pad(&out, PAD_SECONDS, FADE_SECONDS, SAMPLE_RATE)
    }

    /// 按块合成并后处理。`voice` 为空即音色设计：第 0 块不带参考，其余块以第 0 块的
    /// 生成结果与原文作参考（官方 `_generate_chunked` 无参考分支）。
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn synthesize_chunks(
        &self,
        chunks: &[String],
        voice: Option<&VoicePrompt>,
        language: Option<&str>,
        instruct: Option<&str>,
        duration: Option<f64>,
        speed: f64,
        sampling: Sampling,
        rng: &mut Rng,
        progress: ProgressSink<'_>,
    ) -> Result<Vec<f32>> {
        let ref_text = voice.and_then(|v| v.text.as_deref());
        let ref_frames = voice.map(|v| v.frames);
        let frame_rate = self.frame_rate();
        // 有目标时长：单块直接定 token 数；多块按「整段估计 / 目标」折成语速，各块照语速估。
        let (fixed_target, speed) = match duration {
            Some(seconds) => {
                let target = ((seconds * frame_rate) as usize).max(1);
                if chunks.len() == 1 {
                    (Some(target), 1.0)
                } else {
                    let whole = chunks.join("");
                    let est = estimate_target_tokens(&whole, ref_text, ref_frames, 1.0);
                    (None, est as f64 / target as f64)
                }
            }
            None => (None, speed),
        };

        let count = chunks.len();
        let mut decoded: Vec<Vec<f32>> = Vec::with_capacity(count);
        let mut first: Option<(Vec<u32>, usize, String)> = None;
        for (index, chunk) in chunks.iter().enumerate() {
            if !progress(TtsProgress::ChunkStarted { index, count }) {
                bail!(ABORT_MESSAGE);
            }
            let prompt: Option<(&[u32], usize, Option<&str>)> = match (voice, &first) {
                (Some(v), _) => Some((v.codes.as_slice(), v.frames, v.text.as_deref())),
                (None, Some((codes, frames, text))) if index > 0 => Some((codes.as_slice(), *frames, Some(text.as_str()))),
                _ => None,
            };
            let target = fixed_target
                .unwrap_or_else(|| estimate_target_tokens(chunk, prompt.and_then(|p| p.2), prompt.map(|p| p.1), speed))
                .min(sampling.max_tokens);
            let tokens = self.generate(chunk, target, prompt, language, instruct, sampling, rng, &mut |generated| {
                progress(TtsProgress::Tokens { index, generated })
            })?;
            let audio = self.codec.decode(&tokens.iter().map(|&t| t as i32).collect::<Vec<_>>(), target)?;
            if voice.is_none() && index == 0 && count > 1 {
                first = Some((tokens, target, chunk.clone()));
            }
            decoded.push(audio);
            clear_memory_cache()?;
            let seconds = decoded.iter().map(Vec::len).sum::<usize>() as f64 / f64::from(SAMPLE_RATE);
            if !progress(TtsProgress::ChunkFinished { index, seconds }) {
                bail!(ABORT_MESSAGE);
            }
        }
        let merged = audio::cross_fade_chunks(&decoded, SAMPLE_RATE);
        Ok(self.post_process(&merged, voice.and_then(|v| v.rms)))
    }
}

/// 官方 `_get_time_steps`：`torch.linspace(0, 1, n+1)`（float32，前半从起点累加、
/// 后半从终点倒推）再做 `t_shift·t / (1 + (t_shift − 1)·t)`。
pub(crate) fn time_steps(steps: usize, t_shift: f32) -> Vec<f32> {
    let n = steps + 1;
    let step = (1.0f32 - 0.0) / steps as f32;
    let halfway = n / 2;
    (0..n)
        .map(|i| {
            let t = if i < halfway {
                step * i as f32
            } else {
                1.0 - step * (n - 1 - i) as f32
            };
            t_shift * t / (1.0 + (t_shift - 1.0) * t)
        })
        .collect()
}

/// 官方每步揭开的 token 数：`ceil(total·(t[s+1] − t[s]))`，不超过剩余；最后一步收尾。
pub(crate) fn unmask_schedule(total: usize, steps: usize) -> Vec<usize> {
    let t = time_steps(steps, T_SHIFT);
    let mut rem = total;
    (0..steps)
        .map(|s| {
            let num = if s + 1 == steps {
                rem
            } else {
                let delta = f64::from(t[s + 1]) - f64::from(t[s]);
                ((total as f64 * delta).ceil() as usize).min(rem)
            };
            rem -= num;
            num
        })
        .collect()
}

/// 官方一步里的位置选择：置信度减去 `码本序号 × 5`，除以位置温度 5 再加 Gumbel 噪声，
/// 已揭开的位置记 −∞，取前 `k` 个位置写入预测。`uniforms` 是与 token 同序的 `[0,1)` 均匀数。
pub(crate) fn unmask_top(tokens: &mut [u32], pred: &[u32], score: &[f32], uniforms: &[f32], frames: usize, k: usize, mask: u32) {
    let mut keyed: Vec<(f32, usize)> = (0..tokens.len())
        .map(|i| {
            if tokens[i] != mask {
                return (f32::NEG_INFINITY, i);
            }
            let layer = (i / frames) as f32;
            let scaled = (score[i] - layer * LAYER_PENALTY) / POSITION_TEMPERATURE;
            let gumbel = -(-(uniforms[i] + 1e-10).ln() + 1e-10).ln();
            (scaled + gumbel, i)
        })
        .collect();
    keyed.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    for &(_, i) in keyed.iter().take(k) {
        tokens[i] = pred[i];
    }
}

pub(crate) fn sampling_for(request: &TtsRequest) -> Result<Sampling> {
    let cfg = request.sampling.cfg.unwrap_or(DEFAULT_CFG);
    let steps = request.sampling.steps.unwrap_or(DEFAULT_STEPS);
    // 官方 `guidance_scale = 0` 表示不做引导（跳过无条件分支），是合法取值。
    ensure!(cfg.is_finite() && cfg >= 0.0, "{ENGINE_NAME} cfg 必须是非负数，收到 {cfg}");
    ensure!(steps > 0, "{ENGINE_NAME} steps 必须大于 0");
    let max_tokens = request.sampling.max_tokens.unwrap_or((MAX_TARGET_SECONDS * 25.0) as usize);
    ensure!(max_tokens > 0, "{ENGINE_NAME} max_tokens 必须大于 0");
    Ok(Sampling { cfg, steps, max_tokens })
}

/// 目标时长与语速：时长优先（官方 `duration` 覆盖 `speed`），限 (0, 60] 秒；语速须为正。
fn duration_and_speed(request: &TtsRequest) -> Result<(Option<f64>, f64)> {
    if let Some(seconds) = request.target_duration_seconds {
        ensure!(
            seconds.is_finite() && seconds > 0.0 && seconds <= MAX_TARGET_SECONDS,
            "{ENGINE_NAME} 目标时长须在 0–{MAX_TARGET_SECONDS} 秒之间，收到 {seconds}"
        );
        return Ok((Some(seconds), 1.0));
    }
    let speed = f64::from(request.speed.unwrap_or(1.0));
    ensure!(speed.is_finite() && speed > 0.0, "{ENGINE_NAME} 语速必须是正数，收到 {speed}");
    Ok((None, speed))
}

impl TtsEngine for OmniVoice {
    fn kind(&self) -> TtsEngineKind {
        TtsEngineKind::OmniVoice
    }

    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    /// 模型没有说话人表；露出来的是随包的内置音色（`VoiceSpec::Preset` 的取值）。
    fn preset_speakers(&self) -> Vec<String> {
        crate::synthesize::voices::ids()
    }

    fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio> {
        let text = request.text.trim();
        ensure!(!text.is_empty(), "合成文本为空");
        let chunks: Vec<String> = crate::synthesize::text::chunk(text, crate::synthesize::text::DEFAULT_MAX_UNITS)
            .into_iter()
            .filter(|c| !c.trim().is_empty())
            .collect();
        ensure!(!chunks.is_empty(), "合成文本切块后为空");
        let sampling = sampling_for(request)?;
        let (duration, speed) = duration_and_speed(request)?;
        let instruct = resolve_instruct(request.instruct.as_deref(), contains_zh(text))?;
        let language = resolve_language(request.language.as_deref());
        let voice = if matches!(request.voice, VoiceSpec::Default) && instruct.is_some() {
            None
        } else {
            let reference = crate::synthesize::voices::reference_for(request, ENGINE_NAME)?;
            if !progress(TtsProgress::Loading {
                stage: "reference".to_string(),
            }) {
                bail!(ABORT_MESSAGE);
            }
            Some(self.prompt_from_reference(&reference.audio, reference.text.as_deref())?)
        };
        let mut rng = Rng::from_optional_seed(request.sampling.seed);
        let samples = self.synthesize_chunks(
            &chunks,
            voice.as_ref(),
            language.as_deref(),
            instruct.as_deref(),
            duration,
            speed,
            sampling,
            &mut rng,
            progress,
        )?;
        Ok(TtsAudio {
            samples,
            sample_rate: SAMPLE_RATE,
            readings_dropped: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_steps_match_torch_linspace_and_shift() {
        // torch: _get_time_steps(0, 1, 4, 0.1).tolist()
        let t = time_steps(4, 0.1);
        assert_eq!(t.len(), 5);
        assert_eq!(t[0], 0.0);
        // f32 下 0.1 / (1 − 0.9) 落在 0.99999976（torch float32 同值），不是精确的 1。
        assert!((t[4] - 1.0).abs() < 1e-6, "{t:?}");
        // 0.1·0.25 / (1 − 0.9·0.25) = 0.025 / 0.775
        assert!((t[1] - 0.025 / 0.775).abs() < 1e-7, "{t:?}");
        assert!((t[2] - 0.05 / 0.55).abs() < 1e-7, "{t:?}");
        assert!(t.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn schedule_unmasks_everything_front_light() {
        for (total, steps) in [(200, 32), (8, 32), (1600, 16), (9, 1)] {
            let s = unmask_schedule(total, steps);
            assert_eq!(s.len(), steps);
            assert_eq!(s.iter().sum::<usize>(), total, "{total}/{steps}: {s:?}");
        }
        // t_shift = 0.1 让早期每步揭开得少、后期多。
        let s = unmask_schedule(1600, 32);
        assert!(s[0] < s[31], "{s:?}");
    }

    #[test]
    fn unmask_prefers_confident_early_codebooks_and_skips_revealed() {
        let mask = 1024;
        // 2 个码本 × 3 帧；第 1 帧码本 0 已揭开。
        let mut tokens = vec![mask, 7, mask, mask, mask, mask];
        let pred = vec![10, 11, 12, 13, 14, 15];
        let score = vec![-0.1, 0.0, -3.0, -0.1, -0.2, -0.3];
        // 均匀数取中值：Gumbel 噪声对所有位置相同，只比置信度与码本惩罚。
        let uniforms = vec![0.5; 6];
        unmask_top(&mut tokens, &pred, &score, &uniforms, 3, 2, mask);
        // 码本 1 惩罚 5：码本 0 的两个空位（-0.1、-3.0）都优先于码本 1。
        assert_eq!(tokens, vec![10, 7, 12, mask, mask, mask]);
        unmask_top(&mut tokens, &pred, &score, &uniforms, 3, 3, mask);
        assert_eq!(tokens, vec![10, 7, 12, 13, 14, 15]);
    }

    #[test]
    fn sampling_defaults_and_validation() {
        let mut request = TtsRequest::new("hi", VoiceSpec::Default);
        let s = sampling_for(&request).unwrap();
        assert_eq!((s.cfg, s.steps, s.max_tokens), (2.0, 32, 1500));
        request.sampling.cfg = Some(0.0);
        assert_eq!(sampling_for(&request).unwrap().cfg, 0.0);
        request.sampling.cfg = Some(-1.0);
        assert!(sampling_for(&request).is_err());
        request.sampling.cfg = Some(f32::NAN);
        assert!(sampling_for(&request).is_err());
        request.sampling.cfg = None;
        request.sampling.steps = Some(0);
        assert!(sampling_for(&request).is_err());
    }

    #[test]
    fn duration_overrides_speed_and_is_bounded() {
        let mut request = TtsRequest::new("hi", VoiceSpec::Default);
        assert_eq!(duration_and_speed(&request).unwrap(), (None, 1.0));
        request.speed = Some(1.5);
        assert_eq!(duration_and_speed(&request).unwrap(), (None, 1.5));
        request.target_duration_seconds = Some(4.0);
        assert_eq!(duration_and_speed(&request).unwrap(), (Some(4.0), 1.0));
        request.target_duration_seconds = Some(61.0);
        assert!(duration_and_speed(&request).is_err());
        request.target_duration_seconds = Some(0.0);
        assert!(duration_and_speed(&request).is_err());
        request.target_duration_seconds = None;
        request.speed = Some(0.0);
        assert!(duration_and_speed(&request).is_err());
    }
}
