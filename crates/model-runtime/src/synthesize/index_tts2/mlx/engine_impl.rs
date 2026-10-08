//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2NativeRuntime.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! `IndexTts2` 引擎：把权重加载（对照 speech-swift `IndexTTS2NativeRuntime.swift`）、
//! 参考条件（`IndexTTS2ReferenceConditioning.swift`）与逐段合成
//! （`IndexTTS2Synthesis.swift` / `IndexTTS2TTSModel.swift`）接到 `TtsEngine` 上。
//!
//! 推理流程以官方 `indextts/infer_v2.py`（2.0）/ `infer_v2_5.py`（2.5）的 `infer()` 为准，
//! 参数层照官方网页 `webui.py`；与 Swift 的差异都按官方改过：
//! - 不加载 `qwen0.6bemo4-merge`（文本情感模型）：本地目录没有该权重，
//!   `EmotionSpec` 只支持参考音频与 8 维向量两种来源。
//! - 音色潜变量与情感向量每次合成只算一次并复用到各段（官方同样缓存）。
//! - 情感：官方 `merge_emovec` 的 `base + alpha × (emo − base)`（base 是音色参考的
//!   情感向量）；显式向量先过网页 `normalize_emo_vec` 与 `infer()` 的 alpha 缩放
//!   （[`crate::synthesize::index_tts2::emotion`]），再 `mat + (1 − Σw) × emovec`。
//! - S2Mel 流匹配两代都是官方的 25 步（Swift 2.0 用 15 步）。
//! - 不做 PauseCompressor（Swift 只在 `maxInternalPauseDuration` 给出时启用）。
//!
//! w2v-BERT / CAM++ / BigVGAN / 统计量（`SharedAux`）与请求解析、情感合成、逐段拼接
//! 这些步骤 IndexTTS 2.5（`engine_v25`）原样复用。
//!
//! 显存：w2v-BERT（前 17 层约 0.8 GB）只在算参考条件时用，不随引擎常驻——缓存
//! 未命中时现装、算完即卸并清 MLX 缓存；参考条件按音色 / 情感参考文件缓存
//! （[`ConditioningCache`]），批量合成同一音色只跑一次 w2v-BERT。
//!
//! 文件一律经 [`VerifiedFiles`] 按清单取：全部必需文件在碰 Metal 之前查齐，缺了是
//! `MODEL_NOT_INSTALLED`；`config.yaml` 没列出时 2.0 用内置默认配置（与 v2 相同）。

use super::bigvgan::BigVgan;
use super::campplus::CampPlus;
use super::conditioning::{
    CONDITIONING_CACHE_CAPACITY, ConditioningCache, ConditioningKey, ConditioningModels, ReferenceConditioning, emotion_source,
    explicit_emotion,
};
use super::gpt::{ABORT_MESSAGE, SemanticGpt};
use super::s2mel::S2Mel;
use super::semantic_codec::SemanticCodec;
use super::w2v_bert::Wav2Vec2Bert;
use super::weights::WeightMap;
use crate::bundle::VerifiedFiles;
use crate::synthesize::index_tts2::config::RuntimeConfig;
use crate::synthesize::index_tts2::emotion::EmotionControl;
use crate::synthesize::index_tts2::sampling::GenerationOptions;
use crate::synthesize::index_tts2::segmenter::TextSegmenter;
use crate::synthesize::index_tts2::tokenizer::Tokenizer;
use crate::synthesize::tensor::host::ModelMemoryCacheGuard;
use crate::synthesize::tensor::host::{clear_memory_cache, configure_memory_cache};
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, ops};
use crate::synthesize::types::{EmotionSpec, SamplingOptions, TtsAudio, TtsEngineKind, TtsProgress, TtsRequest};
use crate::synthesize::voices::{self, ReferenceAudio};
use crate::synthesize::{ProgressSink, TtsEngine};
use anyhow::{Context, Result, bail, ensure};
use std::path::PathBuf;

/// 语义码 → 梅尔帧数的扩展系数（Swift `frameExpansion = 1.72 / speakingRate`）。
const FRAME_EXPANSION: f32 = 1.72;
/// S2Mel 流匹配步数 / CFG 比例 / 温度（官方 `infer()` 的 `diffusion_steps = 25`、
/// `inference_cfg_rate = 0.7`；两代相同）。
pub(super) const S2MEL_STEPS: usize = 25;
const S2MEL_CFG_RATE: f32 = 0.7;
const S2MEL_TEMPERATURE: f32 = 1.0;
/// 段间静音秒数（Swift `segmentIntervalSilence`）。
const SEGMENT_INTERVAL_SILENCE: f32 = 0.2;
const ENGINE_NAME: &str = "IndexTTS2";

/// 共用辅助权重里 w2v-BERT 的相对路径；也用来判断一个目录是否带齐辅助权重。
pub(super) const W2V_BERT_FILE: &str = "aux/w2v-bert-2.0/model.safetensors";

pub struct IndexTts2 {
    config: RuntimeConfig,
    tokenizer: Tokenizer,
    gpt: SemanticGpt,
    s2mel: S2Mel,
    semantic_codec: SemanticCodec,
    aux: SharedAux,
    /// 最后一个字段：权重先析构，再等 GPU 并清缓存。
    _cache_guard: ModelMemoryCacheGuard,
}

/// 把已求值的一维 / 二维张量拷到 host。
fn to_host_f32(array: &Array) -> Result<Vec<f32>> {
    let array = array.as_dtype(crate::synthesize::tensor::Dtype::Float32)?;
    array.eval()?;
    Ok(array.as_slice::<f32>().to_vec())
}

/// `N` 个 25 Hz 内容帧 → 梅尔帧数。`speaking_rate` 只缩放长度规整的目标帧数：语义码不变，
/// 同一串码铺到更少（快）或更多（慢）的梅尔帧上，音高不变。
pub(super) fn target_frames(content_frames: usize, speaking_rate: f32) -> i32 {
    ((content_frames as f32) * FRAME_EXPANSION / speaking_rate).floor().max(1.0) as i32
}

/// 请求里的语速倍率：省略为 `1.0`，越界报错（参数门已按能力表拦过，这里防远端 / 直调）。
pub(super) fn speaking_rate(speed: Option<f32>, engine: &str) -> Result<f32> {
    let rate = speed.unwrap_or(1.0);
    let (min, max) = crate::synthesize::index_tts2::SPEAKING_RATE_RANGE;
    ensure!(
        rate.is_finite() && (min..=max).contains(&rate),
        "{engine} 语速倍率须在 {min}–{max}，收到 {rate}"
    );
    Ok(rate)
}

/// [`SharedAux`] 要读的文件，在碰 Metal 之前从清单里查齐。
pub(super) struct SharedAuxFiles {
    w2v_bert: PathBuf,
    campplus: PathBuf,
    bigvgan: PathBuf,
    stats: PathBuf,
    feat1: PathBuf,
    feat2: PathBuf,
}

impl SharedAuxFiles {
    /// 文件布局同 `aufklarer/IndexTTS2-MLX-fp16`（2.0 的主模型组件、2.5 的 `aux` 组件）；缺哪个都是 `MODEL_NOT_INSTALLED`。
    pub(super) fn resolve(files: &VerifiedFiles) -> Result<Self> {
        let path = |relative: &str| -> Result<PathBuf> { Ok(files.require(relative)?.to_path_buf()) };
        Ok(Self {
            w2v_bert: path(W2V_BERT_FILE)?,
            campplus: path("aux/campplus/campplus_cn_common.safetensors")?,
            bigvgan: path("aux/bigvgan/bigvgan_generator.safetensors")?,
            stats: path("wav2vec2bert_stats.safetensors")?,
            feat1: path("feat1.safetensors")?,
            feat2: path("feat2.safetensors")?,
        })
    }
}

/// 两代 IndexTTS 共用的参考编码器、声码器与统计量（文件布局同
/// `aufklarer/IndexTTS2-MLX-fp16`）。w2v-BERT 不在这里常驻，见模块文档。
pub(super) struct SharedAux {
    /// w2v-BERT 权重文件；缓存未命中时按需装载。
    w2v_bert_file: PathBuf,
    conditioning_cache: ConditioningCache<ReferenceConditioning>,
    campplus: CampPlus,
    vocoder: BigVgan,
    w2v_mean: Vec<f32>,
    w2v_var: Vec<f32>,
    speaker_rows: Vec<f32>,
    emotion_rows: Vec<f32>,
}

impl SharedAux {
    /// CAM++ → BigVGAN → 统计量 / 情感特征表；`stage` 报告阶段并可取消。w2v-BERT 只
    /// 确认文件在，不装载。
    pub(super) fn load(files: SharedAuxFiles, config: &RuntimeConfig, stage: &mut dyn FnMut(&str) -> Result<()>) -> Result<Self> {
        let w2v_bert_file = files.w2v_bert;

        stage("campplus")?;
        let campplus = CampPlus::load(WeightMap::load_file(&files.campplus)?).context("加载 CAM++")?;
        stage("bigvgan")?;
        let vocoder = BigVgan::load(WeightMap::load_file(&files.bigvgan)?).context("加载 BigVGAN")?;

        stage("stats")?;
        let mut stats = WeightMap::load_file(&files.stats)?;
        let w2v_mean = to_host_f32(&stats.take_f32("mean")?)?;
        let w2v_var = to_host_f32(&stats.take_f32("var")?)?;
        ensure!(
            w2v_mean.len() == 1024 && w2v_var.len() == 1024,
            "wav2vec2bert_stats 形状不符：mean {} / var {}",
            w2v_mean.len(),
            w2v_var.len()
        );
        let mut feat1 = WeightMap::load_file(&files.feat1)?;
        let speaker_table = feat1.take_f32("tensor")?;
        let mut feat2 = WeightMap::load_file(&files.feat2)?;
        let emotion_table = feat2.take_f32("tensor")?;
        let bucket_total: usize = config.emo_num.iter().sum();
        ensure!(
            speaker_table.ndim() == 2 && speaker_table.dim(0) as usize == bucket_total && speaker_table.dim(1) == 192,
            "feat1.safetensors 期望 [{bucket_total}, 192]，收到 {:?}",
            speaker_table.shape()
        );
        ensure!(
            emotion_table.ndim() == 2
                && emotion_table.dim(0) as usize == bucket_total
                && emotion_table.dim(1) as usize == config.gpt.model_dim,
            "feat2.safetensors 期望 [{bucket_total}, {}]，收到 {:?}",
            config.gpt.model_dim,
            emotion_table.shape()
        );
        Ok(Self {
            w2v_bert_file,
            conditioning_cache: ConditioningCache::new(CONDITIONING_CACHE_CAPACITY),
            campplus,
            vocoder,
            w2v_mean,
            w2v_var,
            speaker_rows: to_host_f32(&speaker_table)?,
            emotion_rows: to_host_f32(&emotion_table)?,
        })
    }

    /// 参考条件（音色 / 情感 / 提示梅尔 / 风格），阶段转成 `Loading` 进度。先查缓存；
    /// 未命中时现装 w2v-BERT，算完即卸并把它的 Metal 缓冲还给系统。
    pub(super) fn prepare_conditioning(
        &mut self,
        config: &RuntimeConfig,
        s2mel: &S2Mel,
        semantic_codec: Option<&SemanticCodec>,
        reference_audio: &ReferenceAudio,
        plan: &EmotionPlan,
        progress: &mut dyn FnMut(TtsProgress) -> bool,
    ) -> Result<ReferenceConditioning> {
        let mut loading = |stage: &str| -> Result<()> {
            if !progress(TtsProgress::Loading { stage: stage.to_string() }) {
                bail!(ABORT_MESSAGE);
            }
            Ok(())
        };
        let control = plan.control.as_ref();
        let key = ConditioningKey::new(reference_audio, emotion_source(reference_audio, plan.audio.as_ref(), control));
        if let Some(mut cached) = key.as_ref().and_then(|key| self.conditioning_cache.get(key)) {
            cached.explicit_emotion = explicit_emotion(config, &self.speaker_rows, &self.emotion_rows, control, &cached.style)?;
            loading("参考条件就绪（缓存）")?;
            return Ok(cached);
        }

        loading("w2v-bert")?;
        let w2v_bert = Wav2Vec2Bert::load(WeightMap::load_file(&self.w2v_bert_file)?).context("加载 w2v-BERT 2.0")?;
        let models = ConditioningModels {
            config,
            w2v_bert: &w2v_bert,
            semantic_codec,
            campplus: &self.campplus,
            s2mel,
            w2v_mean: &self.w2v_mean,
            w2v_var: &self.w2v_var,
            speaker_rows: &self.speaker_rows,
            emotion_rows: &self.emotion_rows,
        };
        let prepared = models.prepare(reference_audio, plan.audio.as_ref(), control, &mut |_fraction, stage| {
            progress(TtsProgress::Loading { stage: stage.to_string() })
        });
        // 条件里的数组都已求值（eval 同步等 GPU 完成），不再引用 w2v-BERT 权重。
        drop(w2v_bert);
        clear_memory_cache()?;
        let conditioning = prepared?;
        if let Some(key) = key {
            let mut entry = conditioning.clone();
            entry.explicit_emotion = None;
            self.conditioning_cache.insert(key, entry);
        }
        Ok(conditioning)
    }

    /// 生成段条件 `[1, T, 512]` 接在提示条件后 → 流匹配梅尔（去掉提示段）→ BigVGAN 波形。
    pub(super) fn render(
        &self,
        s2mel: &S2Mel,
        generated_condition: &Array,
        conditioning: &ReferenceConditioning,
        steps: usize,
    ) -> Result<Vec<f32>> {
        let condition = ops::concatenate_axis(&[&conditioning.prompt_condition, generated_condition], 1)?;
        let mel = s2mel.inference(
            &condition,
            &conditioning.prompt_mel,
            &conditioning.style,
            steps,
            S2MEL_CFG_RATE,
            S2MEL_TEMPERATURE,
        )?;
        let prompt_frames = conditioning.prompt_mel.dim(2);
        let generated_mel = mel.index((.., .., prompt_frames..)); // [1, 80, T]
        let waveform = self.vocoder.forward(&generated_mel.swap_axes(1, 2)?)?; // [1, T·256]
        to_host_f32(&waveform)
    }
}

impl IndexTts2 {
    /// 对照 Swift `IndexTTS2NativeRuntime.load`：GPT → S2Mel → 语义码本 → w2v-BERT →
    /// CAM++ + BigVGAN → 统计量 / 情感特征表；跳过 Qwen 文本情感模型。
    ///
    /// `model` 是模型包的唯一组件（`config.yaml`、`bpe.model`、`gpt.safetensors`、`s2mel.safetensors`、
    /// `aux/…`、统计量与两张情感特征表）。缺文件是 `MODEL_NOT_INSTALLED`，在碰 Metal 之前就报。
    pub fn load(model: &VerifiedFiles) -> Result<Self> {
        Self::load_with_progress(model, &mut |_| true)
    }

    pub fn load_with_progress(model: &VerifiedFiles, progress: &mut dyn FnMut(TtsProgress) -> bool) -> Result<Self> {
        let config = RuntimeConfig::load(model.path("config.yaml"))?;
        ensure!(!config.is_v25(), "这是 IndexTTS 2.5 权重，请用 index-tts2.5 引擎加载");
        let bpe_model = model.require(&config.bpe_model)?;
        let gpt_file = model.require("gpt.safetensors")?;
        let s2mel_file = model.require("s2mel.safetensors")?;
        let semantic_codec_file = model.require("aux/maskgct/semantic_codec/model.safetensors")?;
        let aux_files = SharedAuxFiles::resolve(model)?;

        configure_memory_cache()?;
        // 先建守卫：后面任何一步加载失败，展开时也会等 GPU 并清掉已分配的缓存。
        let cache_guard = ModelMemoryCacheGuard;
        let tokenizer = Tokenizer::load(bpe_model).with_context(|| format!("加载 IndexTTS2 分词器 {}", config.bpe_model))?;

        let mut stage = |name: &str| -> Result<()> {
            if !progress(TtsProgress::Loading { stage: name.to_string() }) {
                bail!(ABORT_MESSAGE);
            }
            Ok(())
        };

        stage("gpt")?;
        let gpt = SemanticGpt::load(WeightMap::load_file(gpt_file)?, &config.gpt, config.semantic_codec.codebook_size)
            .context("加载 IndexTTS2 GPT")?;

        stage("s2mel")?;
        let s2mel = S2Mel::load(WeightMap::load_file(s2mel_file)?, config.s2mel.n_mels as i32).context("加载 IndexTTS2 S2Mel")?;

        stage("semantic-codec")?;
        let semantic_codec = SemanticCodec::load(WeightMap::load_file(semantic_codec_file)?).context("加载 MaskGCT 语义码本")?;

        let aux = SharedAux::load(aux_files, &config, &mut stage)?;
        clear_memory_cache()?;

        Ok(Self {
            config,
            tokenizer,
            gpt,
            s2mel,
            semantic_codec,
            aux,
            _cache_guard: cache_guard,
        })
    }

    /// 对照 Swift 每段 `synthesize`：GPT 生成语义码 → S2Mel 潜变量 → 长度规整 →
    /// 流匹配梅尔 → BigVGAN 波形。
    fn synthesize_segment(
        &self,
        text_tokens: &[i32],
        conditioning: &ReferenceConditioning,
        speaker_latent: &Array,
        emotion: &Array,
        options: &GenerationOptions,
        token_progress: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<f32>> {
        let codes = self
            .gpt
            .generate_semantic_codes(text_tokens, speaker_latent, emotion, options, token_progress)?;
        if codes.is_empty() {
            bail!("IndexTTS2 语义 GPT 没有生成任何语音 token");
        }
        let latent = self.gpt.latent_for_s2mel(text_tokens, &codes, speaker_latent, emotion)?;
        let latent = self.s2mel.gpt_latent(&latent)?; // [1, N, 1024]

        let code_tensor = Array::from_slice(&codes, &[1, codes.len() as i32]);
        let semantic_prompt = self.semantic_codec.quantizer.vq2emb(&code_tensor)?.swap_axes(1, 2)?; // [1, N, 1024]
        let semantic_prompt = semantic_prompt + latent;

        let generated_condition = self
            .s2mel
            .length_regulator
            .forward(&semantic_prompt, target_frames(codes.len(), 1.0))?; // [1, target, 512]
        self.aux.render(&self.s2mel, &generated_condition, conditioning, S2MEL_STEPS)
    }
}

/// 这一次合成拿哪段参考音频：调用方给的文件，或内置音色（`Preset` 按 id、
/// `Default` 按语言）。两代 IndexTTS 模型里都没有说话人嵌入表，选内置音色
/// 走的也是克隆——判断全在 `crate::synthesize::voices`，这里不再自己分支。
pub(super) fn clone_reference(request: &TtsRequest, engine: &str) -> Result<ReferenceAudio> {
    Ok(voices::reference_for(request, engine)?.audio)
}

/// 把 `SamplingOptions` 映射到 GPT 采样参数：`None` 一律取 speech-swift 默认值。
pub(super) fn generation_options(sampling: &SamplingOptions, engine: &str) -> Result<GenerationOptions> {
    let mut options = GenerationOptions::default();
    if let Some(t) = sampling.temperature {
        ensure!(t.is_finite() && t > 0.0, "{engine} temperature 必须为正有限值，收到 {t}");
        options.temperature = t;
    }
    if let Some(k) = sampling.top_k {
        options.top_k = k;
    }
    if let Some(p) = sampling.top_p {
        ensure!(p.is_finite() && p > 0.0 && p <= 1.0, "{engine} top_p 必须在 (0, 1]，收到 {p}");
        options.top_p = p;
    }
    if let Some(r) = sampling.repetition_penalty {
        ensure!(r.is_finite() && r > 0.0, "{engine} repetition_penalty 必须为正有限值，收到 {r}");
        options.repetition_penalty = r;
    }
    if let Some(n) = sampling.max_tokens {
        ensure!(n > 0, "{engine} max_tokens 必须大于 0");
        options.max_semantic_tokens = n;
    }
    if let Some(seed) = sampling.seed {
        options.seed = seed;
    }
    Ok(options)
}

/// 请求里的情感规格拆成：情感参考音频（及混合系数）与显式向量控制。
/// 对照官方 `infer()`：给了向量就不用情感参考音频；没有外部情感参考时拿音色参考当情感
/// 参考，并且 `emo_alpha` 固定为 1。
pub(super) struct EmotionPlan {
    audio: Option<ReferenceAudio>,
    alpha: f32,
    control: Option<EmotionControl>,
}

pub(super) fn emotion_plan(spec: Option<&EmotionSpec>, engine: &str) -> Result<EmotionPlan> {
    match spec {
        None => Ok(EmotionPlan {
            audio: None,
            alpha: 1.0,
            control: None,
        }),
        Some(EmotionSpec::Audio { reference_audio, alpha }) => {
            ensure!(
                alpha.is_finite() && (0.0..=1.0).contains(alpha),
                "{engine} 情感音频混合系数 alpha 必须在 [0, 1]，收到 {alpha}"
            );
            ensure!(
                reference_audio.is_file(),
                "{engine} 情感参考音频不存在：{}",
                reference_audio.display()
            );
            Ok(EmotionPlan {
                audio: Some(ReferenceAudio::File(reference_audio.clone())),
                alpha: *alpha,
                control: None,
            })
        }
        Some(EmotionSpec::Vector { weights, alpha }) => Ok(EmotionPlan {
            audio: None,
            alpha: 1.0,
            control: Some(EmotionControl::from_sliders(*weights, *alpha).with_context(|| format!("{engine} 情感向量无效"))?),
        }),
    }
}

/// 情感向量 `[1, 1280]`，对照官方 `infer()`：
/// `emovec = merge_emovec(音色, 情感参考, alpha)`，给了显式向量再
/// `emovec = mat + (1 − Σw) × emovec`。
pub(super) fn resolve_emotion(gpt: &SemanticGpt, conditioning: &ReferenceConditioning, plan: &EmotionPlan) -> Result<Array> {
    let emotion_from_audio = gpt.emotion_vector(&conditioning.emotion_hidden)?;
    // `merge_emovec`：`base + alpha × (emo − base)`；alpha 为 1 时就是 `emo`。
    let merged = if plan.alpha == 1.0 {
        emotion_from_audio
    } else {
        let base = gpt.emotion_vector(&conditioning.speaker_hidden)?;
        &base + (&emotion_from_audio - &base) * plan.alpha
    };
    let emotion = match &conditioning.explicit_emotion {
        Some((vector, weight_sum)) => SemanticGpt::resolved_emotion_vector(&merged, Some(vector), *weight_sum)?,
        None => merged,
    };
    emotion.eval()?;
    Ok(emotion)
}

/// 逐段合成并以 200 ms 静音拼接；每段后释放 MLX 缓冲缓存，让长文本内存有界。
pub(super) fn run_segments(
    count: usize,
    sample_rate: u32,
    progress: &mut dyn FnMut(TtsProgress) -> bool,
    mut segment: impl FnMut(usize, &mut dyn FnMut(usize) -> bool) -> Result<Vec<f32>>,
) -> Result<TtsAudio> {
    let silence_len = (sample_rate as f32 * SEGMENT_INTERVAL_SILENCE) as usize;
    let mut output: Vec<f32> = Vec::new();
    for index in 0..count {
        if !progress(TtsProgress::ChunkStarted { index, count }) {
            bail!(ABORT_MESSAGE);
        }
        let mut token_progress = |generated: usize| -> bool { progress(TtsProgress::Tokens { index, generated }) };
        let audio = segment(index, &mut token_progress)?;
        if index > 0 {
            output.extend(std::iter::repeat_n(0.0f32, silence_len));
        }
        output.extend_from_slice(&audio);
        clear_memory_cache()?;
        let seconds = output.len() as f64 / sample_rate as f64;
        if !progress(TtsProgress::ChunkFinished { index, seconds }) {
            bail!(ABORT_MESSAGE);
        }
    }
    Ok(TtsAudio {
        samples: output,
        sample_rate,
        readings_dropped: Vec::new(),
    })
}

impl TtsEngine for IndexTts2 {
    fn kind(&self) -> TtsEngineKind {
        TtsEngineKind::IndexTts2
    }

    /// 注音换成词表里的大写拼音片（哨兵包住，分词时整片进）；词表没有的片原字照送、报 dropped。
    fn render_readings(&self, annotated: &crate::synthesize::readings::Annotated) -> crate::synthesize::readings::Rendered {
        crate::synthesize::readings::render_inline_pinyin(annotated, Some(self.tokenizer.pinyin_pieces()))
    }

    fn sample_rate(&self) -> u32 {
        self.config.output_sample_rate()
    }

    /// 模型自己没有说话人表；露出来的是随包的内置音色（`VoiceSpec::Preset` 的取值）。
    fn preset_speakers(&self) -> Vec<String> {
        voices::ids()
    }

    fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio> {
        let reference_audio = clone_reference(request, ENGINE_NAME)?;
        let plan = emotion_plan(request.emotion.as_ref(), ENGINE_NAME)?;
        let options = generation_options(&request.sampling, ENGINE_NAME)?;

        // 分词（内部已做文本归一化）→ 按 ≤120 token 切段。
        let tokens = self.tokenizer.tokenize(&request.text)?;
        let segments = TextSegmenter::split(&tokens, TextSegmenter::DEFAULT_MAX_TOKENS);
        if segments.is_empty() {
            bail!("IndexTTS2 文本没有产生任何 token：{:?}", request.text);
        }

        let conditioning = self.aux.prepare_conditioning(
            &self.config,
            &self.s2mel,
            Some(&self.semantic_codec),
            &reference_audio,
            &plan,
            &mut *progress,
        )?;
        let engine = &*self;

        // 音色潜变量与情感向量：一次合成只算一次。
        let speaker_latent = engine.gpt.speaker_conditioning(&conditioning.speaker_hidden)?;
        speaker_latent.eval()?;
        let emotion = resolve_emotion(&engine.gpt, &conditioning, &plan)?;

        run_segments(
            segments.len(),
            engine.config.output_sample_rate(),
            progress,
            |index, token_progress| {
                let text_tokens: Vec<i32> = segments[index].iter().map(|t| t.id as i32).collect();
                engine.synthesize_segment(&text_tokens, &conditioning, &speaker_latent, &emotion, &options, token_progress)
            },
        )
    }
}
