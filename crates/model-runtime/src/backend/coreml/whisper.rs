//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/WhisperASR/WhisperCoreMLRuntime.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Whisper large-v3 / large-v3 Turbo 的原生 CoreML 流水线（从 v2 `bcut-speech` 原样移植）。
//!
//! 张量名、KV 缓存布局与解码策略逐项对应 BaoCut 早先 Swift 版的
//! `WhisperCoreMLRuntime`。本模块只在 Apple Silicon macOS 且启用
//! `backend-coreml` feature 时编译。
//!
//! v3 的边界：文件由 Runtime 显式列出（[`WhisperFiles`]，取自 [`crate::bundle::VerifiedFiles`]），
//! 不再按目录找；识别经 [`SpeechRecognizer`] 接进转写流水线，提示（`hint`）作 initial prompt。
#![allow(deprecated)] // CoreML 传统模型仍以 MLMultiArray.dataPointer 交换定长缓存。

use std::path::{Path, PathBuf};

use crate::speech::whisper_decoding::{
    DECODER_TOKEN_BUDGET, GenerationConfig, WINDOW_SAMPLES, WhisperTokenizer, prompt_tokens, should_stop_for_repeated_words,
};
use crate::speech::{Recognition, RecognitionRequest, SpeechRecognizer};
use anyhow::{Context, Result, anyhow};
use half::f16;
use objc2::AnyThread;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2_core_ml::{
    MLComputeUnits, MLDictionaryFeatureProvider, MLFeatureProvider, MLFeatureValue, MLModel, MLModelConfiguration, MLMultiArray,
    MLMultiArrayDataType,
};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSURL};

const SAMPLE_RATE: u32 = 16_000;
const MAX_AUDIO_SAMPLES: usize = WINDOW_SAMPLES;
const DEFAULT_CACHE_DIM: usize = 5_120;
const DEFAULT_CACHE_LENGTH: usize = DECODER_TOKEN_BUDGET;
const DEFAULT_VOCAB_SIZE: usize = 51_866;
/// context prefill 模型写进缓存的 token 数：`<|startoftranscript|><|lang|><|transcribe|>`。
const PREFILL_CACHE_TOKEN_COUNT: usize = 3;
/// context prefill 模型的 `task` 输入：它按 `(language − 50259) × 2 + task` 查表，每种语言两行，
/// 第 0 行是 `<|transcribe|>`、第 1 行是 `<|translate|>`（与 token id 的次序相反）。v2 用
/// `transcribe − 50359`（large-v3 上是 1），查到的其实是翻译那一行；见
/// `turbo_prefill_task_index_selects_transcribe` 的实测。
const TRANSCRIBE_TASK_INDEX: i32 = 0;

/// CoreML Whisper 的句级转录器。词级时间由统一 forced aligner 补齐。
pub struct WhisperCoreMl {
    mel_model: Retained<MLModel>,
    encoder_model: Retained<MLModel>,
    decoder_prefill_model: Option<Retained<MLModel>>,
    decoder_model: Retained<MLModel>,
    tokenizer: WhisperTokenizer,
    generation: GenerationConfig,
    cache_dim: usize,
    cache_length: usize,
    vocab_size: usize,
}

/// 一个 Whisper CoreML 模型包要的文件：三只（Turbo 是四只）`.mlmodelc` 目录、`generation_config.json`
/// 与取自 `openai/whisper-large-v3` 的 `tokenizer.json`。v2 按「权重目录 + 分词器目录」拼出这些路径，
/// v3 由加载器从清单里取（[`super::whisper_files`]）。
#[derive(Debug, Clone)]
pub struct WhisperFiles {
    pub mel: PathBuf,
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    /// `TextDecoderContextPrefill.mlmodelc`：Turbo 有，标准 large-v3 的 WhisperKit 导出没有。
    pub decoder_prefill: Option<PathBuf>,
    pub generation_config: PathBuf,
    pub tokenizer: PathBuf,
}

impl WhisperCoreMl {
    pub fn load(files: &WhisperFiles) -> Result<Self> {
        let mel_model = load_model(&files.mel, MLComputeUnits::CPUAndGPU)?;
        let encoder_model = load_model(&files.encoder, MLComputeUnits::CPUAndNeuralEngine)?;
        let decoder_prefill_model = files
            .decoder_prefill
            .as_deref()
            .map(|path| load_model(path, MLComputeUnits::CPUAndNeuralEngine))
            .transpose()?;
        let decoder_model = load_model(&files.decoder, MLComputeUnits::CPUAndNeuralEngine)?;

        let cache_dim = model_dimension(&decoder_model, true, "key_cache", 1).unwrap_or(DEFAULT_CACHE_DIM);
        let cache_length = model_dimension(&decoder_model, true, "key_cache", 3).unwrap_or(DEFAULT_CACHE_LENGTH);
        let vocab_size = model_dimension(&decoder_model, false, "logits", usize::MAX).unwrap_or(DEFAULT_VOCAB_SIZE);

        Ok(Self {
            mel_model,
            encoder_model,
            decoder_prefill_model,
            decoder_model,
            tokenizer: WhisperTokenizer::load(&files.tokenizer)?,
            generation: GenerationConfig::load(&files.generation_config)?,
            cache_dim,
            cache_length,
            vocab_size,
        })
    }

    fn transcribe_audio(&self, audio: &[f32], language_hint: Option<&str>, prompt: Option<&str>) -> Result<TranscriptionResult> {
        if audio.is_empty() {
            return Ok(TranscriptionResult {
                text: String::new(),
                language: language_hint.map(str::to_owned),
            });
        }
        let prompt_tokens = self.prompt_tokens(prompt);

        let mut texts = Vec::new();
        let mut resolved_language = None;
        for chunk in audio.chunks(MAX_AUDIO_SAMPLES) {
            let hint = language_hint.or(resolved_language.as_deref());
            let (text, language) = self.transcribe_chunk(chunk, hint, &prompt_tokens)?;
            if !text.is_empty() {
                texts.push(text);
            }
            if resolved_language.is_none() {
                resolved_language = language;
            }
        }
        Ok(TranscriptionResult {
            text: texts.join(" ").trim().to_owned(),
            language: resolved_language.or_else(|| language_hint.map(str::to_owned)),
        })
    }

    /// 预热（v3 新增）：在一秒静音上把 mel、编码器、一步解码器（Turbo 还有 context prefill）各跑一遍，
    /// 让 CoreML 在加载阶段完成首次推理的设备特化，而不是拖到第一段识别。
    pub fn warmup(&self) -> Result<()> {
        let audio_array = make_audio_array(&vec![0.0; SAMPLE_RATE as usize])?;
        let mel_output = predict(&self.mel_model, &[("audio", &audio_array)])?;
        let mel = output_array(&mel_output, "melspectrogram_features")?;
        let encoder_output = predict(&self.encoder_model, &[("melspectrogram_features", &mel)])?;
        let encoder_embeds = output_array(&encoder_output, "encoder_output_embeds")?;
        let language_token = self.detect_language_token(&encoder_embeds)?;
        self.make_decoder_state(&encoder_embeds, language_token, &[])?;
        Ok(())
    }

    /// 识别提示 → 解码器前缀 token（规则见 [`prompt_tokens`]，预算是这只解码器的缓存长度）。
    fn prompt_tokens(&self, prompt: Option<&str>) -> Vec<i32> {
        prompt_tokens(&self.tokenizer, &self.generation, prompt, self.cache_length)
    }

    fn transcribe_chunk(&self, audio: &[f32], language_hint: Option<&str>, prompt_tokens: &[i32]) -> Result<(String, Option<String>)> {
        let audio_array = make_audio_array(audio)?;
        let mel_output = predict(&self.mel_model, &[("audio", &audio_array)])?;
        let mel = output_array(&mel_output, "melspectrogram_features")?;

        let encoder_output = predict(&self.encoder_model, &[("melspectrogram_features", &mel)])?;
        let encoder_embeds = output_array(&encoder_output, "encoder_output_embeds")?;

        let language_token = language_hint
            .and_then(|hint| self.generation.language_token(hint))
            .map(Ok)
            .unwrap_or_else(|| self.detect_language_token(&encoder_embeds))?;
        let language = self.generation.language_code(language_token);
        let (state, seeded) = self.make_decoder_state(&encoder_embeds, language_token, prompt_tokens)?;
        let generated = self.decode_greedy(&encoder_embeds, state, seeded)?;
        Ok((self.tokenizer.decode(&generated).trim().to_owned(), language))
    }

    fn detect_language_token(&self, encoder_embeds: &MLMultiArray) -> Result<i32> {
        let state = self.make_empty_decoder_state()?;
        write_i32(&state.input_ids, 0, self.generation.start_of_transcript());
        write_i32(&state.cache_length, 0, 0);
        write_f16(&state.kv_cache_update_mask, 0, 1.0);
        write_f16(&state.decoder_key_padding_mask, 0, 0.0);
        let output = self.predict_decoder(encoder_embeds, &state)?;
        let logits = output_array(&output, "logits")?;
        Ok(self
            .argmax(&logits, |token| !self.generation.is_language_token(token as i32))
            .unwrap_or(self.generation.english_token()))
    }

    /// 播种解码器的 KV 缓存，返回 `(state, 已播种的 token 数)`。
    ///
    /// 没有识别提示时与接提示通道之前逐值相同（优先走 context prefill 模型）。
    /// 有提示时必须走手工播种那一支：prefill 模型只会吐固定的三个 token，塞不进
    /// `<|startofprev|> … <|startoftranscript|>` 这条更长的前缀。
    fn make_decoder_state(
        &self,
        encoder_embeds: &MLMultiArray,
        language_token: i32,
        prompt_tokens: &[i32],
    ) -> Result<(DecoderState, usize)> {
        let state = self.make_empty_decoder_state()?;
        let seeded = prompt_tokens.len() + PREFILL_CACHE_TOKEN_COUNT;
        if prompt_tokens.is_empty()
            && let Some(prefill_model) = self.decoder_prefill_model.as_ref()
        {
            let language = scalar_i32(language_token)?;
            let task = scalar_i32(TRANSCRIBE_TASK_INDEX)?;
            let output = predict(prefill_model, &[("language", &language), ("task", &task)])?;
            let key_prefill = output_array(&output, "key_cache_prefill")?;
            let value_prefill = output_array(&output, "value_cache_prefill")?;
            copy_cache_slice(&key_prefill, &state.key_cache, PREFILL_CACHE_TOKEN_COUNT);
            copy_cache_slice(&value_prefill, &state.value_cache, PREFILL_CACHE_TOKEN_COUNT);
        } else {
            // The standard WhisperKit large-v3 export has no dedicated context
            // prefill model. Seed the prompt tokens through the decoder one at
            // a time and retain their KV updates. `prompt_tokens` 为空时这正是
            // 原来的三个 token；带识别提示时前面多一段 `<|startofprev|> …`。
            let seed = prompt_tokens
                .iter()
                .copied()
                .chain(self.generation.task_tokens(language_token))
                .collect::<Vec<_>>();
            for (token_index, token) in seed.into_iter().enumerate() {
                write_i32(&state.input_ids, 0, token);
                write_i32(&state.cache_length, 0, token_index as i32);
                write_f16(&state.decoder_key_padding_mask, token_index, 0.0);
                write_f16(&state.kv_cache_update_mask, token_index, 1.0);
                let output = self.predict_decoder(encoder_embeds, &state)?;
                let key_update = output_array(&output, "key_cache_updates")?;
                let value_update = output_array(&output, "value_cache_updates")?;
                copy_cache_update(&key_update, &state.key_cache, token_index);
                copy_cache_update(&value_update, &state.value_cache, token_index);
                write_f16(&state.kv_cache_update_mask, token_index, 0.0);
            }
        }
        for index in 0..=seeded {
            write_f16(&state.decoder_key_padding_mask, index, 0.0);
        }
        write_f16(&state.kv_cache_update_mask, seeded, 1.0);
        Ok((state, seeded))
    }

    fn decode_greedy(&self, encoder_embeds: &MLMultiArray, state: DecoderState, seeded: usize) -> Result<Vec<i32>> {
        let mut generated = Vec::new();
        let mut next_token = self.generation.no_timestamps();
        let mut token_index = seeded;
        let maximum_token_index = self.cache_length.saturating_sub(1);

        while token_index < maximum_token_index {
            write_i32(&state.input_ids, 0, next_token);
            write_i32(&state.cache_length, 0, token_index as i32);
            let output = self.predict_decoder(encoder_embeds, &state)?;
            let logits = output_array(&output, "logits")?;
            let key_update = output_array(&output, "key_cache_updates")?;
            let value_update = output_array(&output, "value_cache_updates")?;
            let generated_count = generated.len();
            let sampled = self
                .argmax(&logits, |token| self.generation.should_suppress(token as i32, generated_count))
                .unwrap_or(self.generation.end_token());
            if sampled == self.generation.end_token() {
                break;
            }
            if sampled < self.generation.special_token_begin() {
                let mut candidate = generated.clone();
                candidate.push(sampled);
                if should_stop_for_repeated_words(&self.tokenizer, &candidate) {
                    break;
                }
                generated = candidate;
            }

            copy_cache_update(&key_update, &state.key_cache, token_index);
            copy_cache_update(&value_update, &state.value_cache, token_index);
            write_f16(&state.decoder_key_padding_mask, token_index + 1, 0.0);
            write_f16(&state.kv_cache_update_mask, token_index, 0.0);
            write_f16(&state.kv_cache_update_mask, token_index + 1, 1.0);
            next_token = sampled;
            token_index += 1;
        }
        Ok(generated)
    }

    fn predict_decoder(
        &self,
        encoder_embeds: &MLMultiArray,
        state: &DecoderState,
    ) -> Result<Retained<ProtocolObject<dyn MLFeatureProvider>>> {
        predict(
            &self.decoder_model,
            &[
                ("input_ids", &state.input_ids),
                ("cache_length", &state.cache_length),
                ("key_cache", &state.key_cache),
                ("value_cache", &state.value_cache),
                ("kv_cache_update_mask", &state.kv_cache_update_mask),
                ("encoder_output_embeds", encoder_embeds),
                ("decoder_key_padding_mask", &state.decoder_key_padding_mask),
            ],
        )
    }

    fn make_empty_decoder_state(&self) -> Result<DecoderState> {
        let cache_shape = [1, self.cache_dim, 1, self.cache_length];
        let key_cache = make_array(&cache_shape, MLMultiArrayDataType::Float16)?;
        let value_cache = make_array(&cache_shape, MLMultiArrayDataType::Float16)?;
        let kv_cache_update_mask = make_array(&[1, self.cache_length], MLMultiArrayDataType::Float16)?;
        let decoder_key_padding_mask = make_array(&[1, self.cache_length], MLMultiArrayDataType::Float16)?;
        let input_ids = make_array(&[1], MLMultiArrayDataType::Int32)?;
        let cache_length = make_array(&[1], MLMultiArrayDataType::Int32)?;
        fill_f16(&key_cache, 0.0);
        fill_f16(&value_cache, 0.0);
        fill_f16(&kv_cache_update_mask, 0.0);
        fill_f16(&decoder_key_padding_mask, -10_000.0);
        write_i32(&input_ids, 0, 0);
        write_i32(&cache_length, 0, 0);
        Ok(DecoderState {
            input_ids,
            cache_length,
            key_cache,
            value_cache,
            kv_cache_update_mask,
            decoder_key_padding_mask,
        })
    }

    fn argmax(&self, logits: &MLMultiArray, should_skip: impl Fn(usize) -> bool) -> Option<i32> {
        let shape = dimensions(logits);
        let count = self.vocab_size.min(shape.last().copied().unwrap_or_else(|| array_count(logits)));
        let stride = strides(logits).last().copied().unwrap_or(1);
        let mut best = None;
        let mut best_value = f32::NEG_INFINITY;
        unsafe {
            match logits.dataType() {
                MLMultiArrayDataType::Float16 => {
                    let pointer = logits.dataPointer().as_ptr().cast::<f16>();
                    for token in 0..count {
                        if should_skip(token) {
                            continue;
                        }
                        let value = (*pointer.add(token * stride)).to_f32();
                        if !value.is_nan() && value > best_value {
                            best_value = value;
                            best = Some(token as i32);
                        }
                    }
                }
                MLMultiArrayDataType::Float32 => {
                    let pointer = logits.dataPointer().as_ptr().cast::<f32>();
                    for token in 0..count {
                        if should_skip(token) {
                            continue;
                        }
                        let value = *pointer.add(token * stride);
                        if !value.is_nan() && value > best_value {
                            best_value = value;
                            best = Some(token as i32);
                        }
                    }
                }
                _ => {
                    for token in 0..count {
                        if should_skip(token) {
                            continue;
                        }
                        let value = logits.objectAtIndexedSubscript((token * stride) as isize).floatValue();
                        if !value.is_nan() && value > best_value {
                            best_value = value;
                            best = Some(token as i32);
                        }
                    }
                }
            }
        }
        best
    }
}

/// v2 `TranscriptionResult` 里 Whisper 用到的两项：句级文本与识别出的语言码。
struct TranscriptionResult {
    text: String,
    language: Option<String>,
}

/// 转写流水线的一段：断言的语言作语言 token，识别提示作 initial prompt（v2 的 `HintKind::Prompt`）。
/// Whisper 报的是语言码（`en`、`yue`），不是 Qwen3-ASR 那样的语言名。
impl SpeechRecognizer for WhisperCoreMl {
    fn recognize(&mut self, audio: &[f32], request: &RecognitionRequest<'_>) -> Result<Recognition> {
        let result = self.transcribe_audio(audio, request.language, request.context)?;
        Ok(Recognition {
            text: result.text,
            language_name: result.language,
            degenerate: false,
        })
    }
}

struct DecoderState {
    input_ids: Retained<MLMultiArray>,
    cache_length: Retained<MLMultiArray>,
    key_cache: Retained<MLMultiArray>,
    value_cache: Retained<MLMultiArray>,
    kv_cache_update_mask: Retained<MLMultiArray>,
    decoder_key_padding_mask: Retained<MLMultiArray>,
}

fn load_model(path: &Path, units: MLComputeUnits) -> Result<Retained<MLModel>> {
    let configuration = unsafe { MLModelConfiguration::new() };
    unsafe {
        configuration.setComputeUnits(units);
    }
    let path_text = path
        .to_str()
        .with_context(|| format!("CoreML 路径不是 UTF-8：{}", path.display()))?;
    let ns_path = NSString::from_str(path_text);
    let url = NSURL::fileURLWithPath(&ns_path);
    unsafe { MLModel::modelWithContentsOfURL_configuration_error(&url, &configuration) }
        .map_err(|error| anyhow!("加载 CoreML 模型 {} 失败：{error:?}", path.display()))
}

fn model_dimension(model: &MLModel, input: bool, feature_name: &str, axis: usize) -> Option<usize> {
    unsafe {
        let description = model.modelDescription();
        let features = if input {
            description.inputDescriptionsByName()
        } else {
            description.outputDescriptionsByName()
        };
        let key = NSString::from_str(feature_name);
        let feature = features.objectForKey(&key)?;
        let shape = feature.multiArrayConstraint()?.shape();
        let dimensions = number_array(&shape);
        if axis == usize::MAX {
            dimensions.last().copied()
        } else {
            dimensions.get(axis).copied()
        }
    }
}

fn predict(model: &MLModel, inputs: &[(&str, &MLMultiArray)]) -> Result<Retained<ProtocolObject<dyn MLFeatureProvider>>> {
    let keys = inputs.iter().map(|(name, _)| NSString::from_str(name)).collect::<Vec<_>>();
    let values = inputs
        .iter()
        .map(|(_, value)| unsafe { Retained::<AnyObject>::from(MLFeatureValue::featureValueWithMultiArray(value)) })
        .collect::<Vec<_>>();
    let key_refs = keys.iter().map(|key| key.as_ref() as &NSString).collect::<Vec<_>>();
    let dictionary = NSDictionary::<NSString, AnyObject>::from_retained_objects(&key_refs, &values);
    let provider = unsafe { MLDictionaryFeatureProvider::initWithDictionary_error(MLDictionaryFeatureProvider::alloc(), &dictionary) }
        .map_err(|error| anyhow!("构造 CoreML 输入失败：{error:?}"))?;
    let protocol: &ProtocolObject<dyn MLFeatureProvider> = ProtocolObject::from_ref::<MLDictionaryFeatureProvider>(&provider);
    unsafe { model.predictionFromFeatures_error(protocol) }.map_err(|error| anyhow!("CoreML 推理失败：{error:?}"))
}

fn output_array(provider: &ProtocolObject<dyn MLFeatureProvider>, name: &str) -> Result<Retained<MLMultiArray>> {
    let name = NSString::from_str(name);
    let value = unsafe { provider.featureValueForName(&name) }.with_context(|| format!("CoreML 输出缺少 {name}"))?;
    unsafe { value.multiArrayValue() }.with_context(|| format!("CoreML 输出 {name} 不是 MLMultiArray"))
}

fn make_array(shape: &[usize], data_type: MLMultiArrayDataType) -> Result<Retained<MLMultiArray>> {
    let numbers = shape
        .iter()
        .map(|dimension| NSNumber::numberWithUnsignedLongLong(*dimension as u64))
        .collect::<Vec<_>>();
    let ns_shape = NSArray::from_retained_slice(&numbers);
    unsafe { MLMultiArray::initWithShape_dataType_error(MLMultiArray::alloc(), &ns_shape, data_type) }
        .map_err(|error| anyhow!("创建 CoreML 张量 {shape:?} 失败：{error:?}"))
}

fn scalar_i32(value: i32) -> Result<Retained<MLMultiArray>> {
    let array = make_array(&[1], MLMultiArrayDataType::Int32)?;
    write_i32(&array, 0, value);
    Ok(array)
}

fn make_audio_array(audio: &[f32]) -> Result<Retained<MLMultiArray>> {
    let array = make_array(&[MAX_AUDIO_SAMPLES], MLMultiArrayDataType::Float16)?;
    fill_f16(&array, 0.0);
    unsafe {
        let pointer = array.dataPointer().as_ptr().cast::<f16>();
        for (index, sample) in audio.iter().take(MAX_AUDIO_SAMPLES).enumerate() {
            *pointer.add(index) = f16::from_f32(sample.clamp(-1.0, 1.0));
        }
    }
    Ok(array)
}

fn fill_f16(array: &MLMultiArray, value: f32) {
    unsafe {
        let pointer = array.dataPointer().as_ptr().cast::<f16>();
        std::ptr::write_bytes(pointer, 0, array_count(array));
        if value != 0.0 {
            for index in 0..array_count(array) {
                *pointer.add(index) = f16::from_f32(value);
            }
        }
    }
}

fn write_f16(array: &MLMultiArray, index: usize, value: f32) {
    if index >= array_count(array) {
        return;
    }
    unsafe {
        *array.dataPointer().as_ptr().cast::<f16>().add(index) = f16::from_f32(value);
    }
}

fn write_i32(array: &MLMultiArray, index: usize, value: i32) {
    if index >= array_count(array) {
        return;
    }
    unsafe {
        *array.dataPointer().as_ptr().cast::<i32>().add(index) = value;
    }
}

fn copy_cache_slice(source: &MLMultiArray, destination: &MLMultiArray, token_count: usize) {
    let source_shape = dimensions(source);
    let destination_shape = dimensions(destination);
    let source_strides = strides(source);
    let destination_strides = strides(destination);
    if source_shape.len() < 4 || destination_shape.len() < 4 || source_strides.len() < 4 || destination_strides.len() < 4 {
        return;
    }
    let dimension = source_shape[1].min(destination_shape[1]);
    let count = token_count.min(source_shape[3]).min(destination_shape[3]);
    unsafe {
        let source = source.dataPointer().as_ptr().cast::<f16>();
        let destination = destination.dataPointer().as_ptr().cast::<f16>();
        for channel in 0..dimension {
            for position in 0..count {
                let source_index = channel * source_strides[1] + position * source_strides[3];
                let destination_index = channel * destination_strides[1] + position * destination_strides[3];
                *destination.add(destination_index) = *source.add(source_index);
            }
        }
    }
}

fn copy_cache_update(source: &MLMultiArray, destination: &MLMultiArray, position: usize) {
    let source_shape = dimensions(source);
    let destination_shape = dimensions(destination);
    let source_strides = strides(source);
    let destination_strides = strides(destination);
    if source_shape.len() < 2
        || destination_shape.len() < 4
        || source_strides.len() < 2
        || destination_strides.len() < 4
        || position >= destination_shape[3]
    {
        return;
    }
    let dimension = source_shape[1].min(destination_shape[1]);
    unsafe {
        let source = source.dataPointer().as_ptr().cast::<f16>();
        let destination = destination.dataPointer().as_ptr().cast::<f16>();
        for channel in 0..dimension {
            let source_index = channel * source_strides[1];
            let destination_index = channel * destination_strides[1] + position * destination_strides[3];
            *destination.add(destination_index) = *source.add(source_index);
        }
    }
}

fn array_count(array: &MLMultiArray) -> usize {
    unsafe { array.count().max(0) as usize }
}

fn dimensions(array: &MLMultiArray) -> Vec<usize> {
    unsafe { number_array(&array.shape()) }
}

fn strides(array: &MLMultiArray) -> Vec<usize> {
    unsafe { number_array(&array.strides()) }
}

fn number_array(array: &NSArray<NSNumber>) -> Vec<usize> {
    array.iter().map(|number| number.unsignedLongLongValue() as usize).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前 `positions` 个位置的 KV（`[1, dim, 1, n]` 按通道 × 位置展开），布局与 prefill 模型的输出一致。
    fn cache_positions(cache: &MLMultiArray, positions: usize) -> Vec<f32> {
        let (shape, strides) = (dimensions(cache), strides(cache));
        let pointer = unsafe { cache.dataPointer().as_ptr().cast::<f16>() };
        (0..shape[1])
            .flat_map(|channel| (0..positions).map(move |position| (channel, position)))
            .map(|(channel, position)| unsafe { (*pointer.add(channel * strides[1] + position * strides[3])).to_f32() })
            .collect()
    }

    fn mean_abs_difference(a: &[f32], b: &[f32]) -> f32 {
        a.iter().zip(b).map(|(x, y)| (x - y).abs()).sum::<f32>() / a.len() as f32
    }

    /// 真实录音的识别计时（`--release` 跑），与 MLX 版 `transcribes_a_real_recording` 同一口径：加载、预热单独计，
    /// 识别跑两遍。`BAOCUT_WHISPER_COREML_DIR` 是 WhisperKit 的 Turbo 导出目录（只读），`BAOCUT_WHISPER_AUDIO` 是
    /// 16 kHz 单声道 WAV。
    #[test]
    #[ignore = "needs BAOCUT_WHISPER_COREML_DIR and BAOCUT_WHISPER_AUDIO"]
    fn times_a_real_recording() {
        use std::time::Instant;
        let dir = PathBuf::from(std::env::var("BAOCUT_WHISPER_COREML_DIR").expect("set BAOCUT_WHISPER_COREML_DIR"));
        let audio_path = PathBuf::from(std::env::var("BAOCUT_WHISPER_AUDIO").expect("set BAOCUT_WHISPER_AUDIO"));
        let audio = crate::audio::decode_mono(&audio_path, SAMPLE_RATE).unwrap();
        let started = Instant::now();
        let mut model = WhisperCoreMl::load(&WhisperFiles {
            mel: dir.join("MelSpectrogram.mlmodelc"),
            encoder: dir.join("AudioEncoder.mlmodelc"),
            decoder: dir.join("TextDecoder.mlmodelc"),
            decoder_prefill: Some(dir.join("TextDecoderContextPrefill.mlmodelc")),
            generation_config: dir.join("generation_config.json"),
            tokenizer: dir.join("tokenizer.json"),
        })
        .unwrap();
        let load = started.elapsed();
        let started = Instant::now();
        model.warmup().unwrap();
        let warmup = started.elapsed();
        let (language, prompt) = (
            std::env::var("BAOCUT_WHISPER_LANGUAGE").ok(),
            std::env::var("BAOCUT_WHISPER_PROMPT").ok(),
        );
        let request = RecognitionRequest {
            language: language.as_deref(),
            context: prompt.as_deref(),
        };
        let mut runs = Vec::new();
        for _ in 0..2 {
            let started = Instant::now();
            let recognition = model.recognize(&audio, &request).unwrap();
            runs.push((started.elapsed(), recognition));
        }
        let preview = runs[0].1.text.chars().take(200).collect::<String>();
        println!(
            "whisper-coreml: audio {:.1}s, load {:.2}s, warmup {:.2}s, recognize {:.2}s / {:.2}s, language {:?}\n{preview}",
            audio.len() as f64 / SAMPLE_RATE as f64,
            load.as_secs_f64(),
            warmup.as_secs_f64(),
            runs[0].0.as_secs_f64(),
            runs[1].0.as_secs_f64(),
            runs[0].1.language_name,
        );
    }

    /// Turbo 的 context prefill 模型按 `(language − 50259) × 2 + task` 查表。核对 [`TRANSCRIBE_TASK_INDEX`]
    /// 查到的就是 `<|startoftranscript|><|lang|><|transcribe|>` 的 KV：与逐个 token 播种的结果比，第 0 层（只依赖
    /// token，不依赖编码器输出）应当逐值一致，`<|translate|>` 那一行则不一致。实测（en、zh、ja 相同）：task 0 与
    /// transcribe、task 1 与 translate 的第 0 层平均差约 0.0002，交叉比较约 0.16。
    #[test]
    #[ignore = "needs BAOCUT_TEST_MODELS_DIR with Whisper large-v3-turbo (CoreML)"]
    fn turbo_prefill_task_index_selects_transcribe() {
        let root = PathBuf::from(std::env::var("BAOCUT_TEST_MODELS_DIR").expect("set BAOCUT_TEST_MODELS_DIR"));
        let dir = root.join("aufklarer/Whisper-Large-v3-Turbo-CoreML");
        let model = WhisperCoreMl::load(&WhisperFiles {
            mel: dir.join("MelSpectrogram.mlmodelc"),
            encoder: dir.join("AudioEncoder.mlmodelc"),
            decoder: dir.join("TextDecoder.mlmodelc"),
            decoder_prefill: Some(dir.join("TextDecoderContextPrefill.mlmodelc")),
            generation_config: dir.join("generation_config.json"),
            tokenizer: dir.join("tokenizer.json"),
        })
        .unwrap();
        let generation = &model.generation;
        assert_eq!(generation.transcribe_token, 50_360);
        assert_eq!(TRANSCRIBE_TASK_INDEX, 0);
        let translate_token = generation.transcribe_token - 1;
        let layer = model.cache_dim / 4; // Turbo 的解码器 4 层，KV 按层拼在通道上。

        let audio = make_audio_array(&vec![0.0; SAMPLE_RATE as usize]).unwrap();
        let mel = output_array(&predict(&model.mel_model, &[("audio", &audio)]).unwrap(), "melspectrogram_features").unwrap();
        let encoder = predict(&model.encoder_model, &[("melspectrogram_features", &mel)]).unwrap();
        let encoder_embeds = output_array(&encoder, "encoder_output_embeds").unwrap();

        for code in ["en", "zh", "ja"] {
            let language = generation.language_token(code).unwrap();
            let prefill = |task: i32| {
                let output = predict(
                    model.decoder_prefill_model.as_ref().unwrap(),
                    &[("language", &scalar_i32(language).unwrap()), ("task", &scalar_i32(task).unwrap())],
                )
                .unwrap();
                cache_positions(&output_array(&output, "key_cache_prefill").unwrap(), 3)
            };
            let seeded = |task_token: i32| {
                let state = model.make_empty_decoder_state().unwrap();
                for (index, token) in [generation.start_of_transcript(), language, task_token].into_iter().enumerate() {
                    write_i32(&state.input_ids, 0, token);
                    write_i32(&state.cache_length, 0, index as i32);
                    write_f16(&state.decoder_key_padding_mask, index, 0.0);
                    write_f16(&state.kv_cache_update_mask, index, 1.0);
                    let output = model.predict_decoder(&encoder_embeds, &state).unwrap();
                    copy_cache_update(&output_array(&output, "key_cache_updates").unwrap(), &state.key_cache, index);
                    write_f16(&state.kv_cache_update_mask, index, 0.0);
                }
                cache_positions(&state.key_cache, 3)
            };
            let (task0, task1) = (prefill(0), prefill(1));
            let (transcribe, translate) = (seeded(generation.transcribe_token), seeded(translate_token));
            let first = layer * 3;
            let table = [
                ("task 0 vs transcribe", &task0, &transcribe),
                ("task 0 vs translate", &task0, &translate),
                ("task 1 vs transcribe", &task1, &transcribe),
                ("task 1 vs translate", &task1, &translate),
            ]
            .map(|(label, a, b)| {
                let (layer0, all) = (mean_abs_difference(&a[..first], &b[..first]), mean_abs_difference(a, b));
                println!("{code} {label}: layer 0 {layer0:.5}, all layers {all:.5}");
                layer0
            });
            assert!(table[0] < 0.01, "{code}: task 0 must be the transcribe row ({table:?})");
            assert!(table[3] < 0.01, "{code}: task 1 must be the translate row ({table:?})");
            assert!(
                table[0] * 10.0 < table[1].min(table[2]),
                "{code}: the rows must be distinguishable ({table:?})"
            );
        }
    }
}
