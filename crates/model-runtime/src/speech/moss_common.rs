//! MOSS-Transcribe-Diarize 的后端无关部分：配置、提示词常量、低能量分块、分块转录循环与输出协议渲染。
//! 从 v2 `bcut-speech` 原样移植；引擎在 `backend::mlx::moss` 与 `backend::candle::moss`。v2 的 `MossCallbacks`、`MossCancelled`、
//! `MossTranscription` 就是这里的 [`SegmentingCallbacks`]、[`SegmentingCancelled`]、[`SegmentedTranscription`]。
// 分块循环与流式状态只有 MLX 与 candle 引擎用；两者都没编译的构建里它们没有调用方。
#![cfg_attr(
    not(any(
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"),
        feature = "backend-candle"
    )),
    allow(dead_code, unused_imports)
)]

use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};
use serde_json::Value;

use super::language::{MOSS_LANGUAGES, canonical_code};
use super::moss_parse::{MossGenerationPlan, MossOutputParser, MossOutputSegment, adapt_output, preview_segment};
use super::{SegmentedTranscription, SegmentingCallbacks, SegmentingCancelled};

mod repetition;
use repetition::RepetitionGuard;
pub(crate) use repetition::repetitive_token_tail;

pub const SAMPLE_RATE: usize = 16_000;
pub const WHISPER_WINDOW_SAMPLES: usize = 480_000;
pub const HOP_LENGTH: usize = 160;
pub const WHISPER_ENCODER_STRIDE: usize = 2;
pub const DEFAULT_AUDIO_TOKEN: i32 = 151_671;
pub const AUDIO_START: i32 = 151_669;
pub const AUDIO_END: i32 = 151_670;
pub const IM_START: i32 = 151_644;
pub const IM_END: i32 = 151_645;
pub const PAD_EOS: i32 = 151_643;
pub const NEWLINE: i32 = 198;
pub const SYSTEM: i32 = 8_948;
pub const USER: i32 = 872;
pub const ASSISTANT: i32 = 77_091;
pub const PREFILL_STEP: usize = 512;

pub const DEFAULT_PROMPT: &str = "Transcribe the audio into text. Start each segment with the start \
timestamp and speaker label ([S01], [S02], [S03], ...), write the corresponding spoken content, \
and end each segment with the ending timestamp to clearly mark the segment range.";

/// `auto` 时追加在 [`DEFAULT_PROMPT`] 之后的语言约束。
///
/// MOSS 没有独立的语言参数。只给 [`DEFAULT_PROMPT`] 时，即便是 300 s 以内的短块也会把
/// 英文整段译成法文输出（贪心解码，同一素材每次都一样）；「照原语言转写、不要翻译」
/// 这类抽象说法它不理（六种措辞、含一种中文，都还是法文），点名几种常见语言它才会回到
/// 实际说的那种。点名的语言不是白名单：列表外的意大利语、葡萄牙语、俄语照样按原文
/// 转写，列表内的也不会被拉向列表里的别种（v2 的实测结论）。
pub const AUTO_LANGUAGE_RULE: &str = "The speech may be in Chinese, English, Japanese, Korean, \
French, German, Spanish or another language. Transcribe it verbatim in the language actually \
spoken; do not translate.";

/// 用户轮里的整段转写指令：[`DEFAULT_PROMPT`] 加语言约束。
///
/// `language` 是要写进指令的源语言，`None` / `auto` 表示自动。**点名是强约束**：
/// MOSS 会把别的语言译成点名的那种输出（英文素材配 `de` 得到德文译文，措辞写成
/// 「预期是」「如果实际不是就照实际」都拦不住），所以调用方只该在语言是用户对这条
/// 素材的断言时传进来（`job.run` 只在 `language` 是断言时交给 MOSS）。
/// 夹在里面的别种语言词（中文口播里的 OPENAI / CHATGPT）按原样保留。
pub fn moss_instruction(language: Option<&str>) -> String {
    match language.and_then(language_name) {
        Some(name) => format!(
            "{DEFAULT_PROMPT} The speech is expected to be in {name}. Transcribe it verbatim \
             in {name}, exactly as spoken; do not translate. Keep any words spoken in \
             another language as they were spoken."
        ),
        None => format!("{DEFAULT_PROMPT} {AUTO_LANGUAGE_RULE}"),
    }
}

/// 指令里用的英文语言名；认不出或是 `auto` 时返回 `None`（按自动处理）。
///
/// 汉语的各种写法（`zh-*`、`yue`、`cmn`）一律是 `Chinese`（同 v2 的 autolang 归一），其余按 MOSS 的语言表
/// （[`MOSS_LANGUAGES`]，与 v2 语言目录给语音模型的英文名相同）取。
pub fn language_name(code: &str) -> Option<String> {
    let code = code.trim();
    if code.is_empty() || code.eq_ignore_ascii_case("auto") {
        return None;
    }
    let canonical = canonical_code(code)?;
    if canonical.starts_with("zh") || canonical == "yue" || canonical == "cmn" {
        return Some("Chinese".to_owned());
    }
    MOSS_LANGUAGES
        .iter()
        .find(|(known, _)| *known == canonical)
        .map(|(_, name)| (*name).to_owned())
}

#[derive(Debug, Clone)]
pub struct MossConfig {
    pub hidden_size: usize,
    pub intermediate_size: usize,
    pub text_layers: usize,
    pub text_heads: usize,
    pub text_kv_heads: usize,
    pub head_dim: usize,
    pub rms_eps: f32,
    pub rope_theta: f32,
    pub mel_bins: usize,
    pub audio_model_size: usize,
    pub audio_layers: usize,
    pub audio_heads: usize,
    pub maximum_source_positions: usize,
    pub audio_token_id: i32,
    pub audio_merge_size: usize,
    pub adaptor_input_dim: usize,
    pub sample_rate: usize,
}

impl MossConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let raw: Value = serde_json::from_slice(&fs::read(path).with_context(|| format!("读取 {}", path.display()))?)
            .context("解析 MOSS config.json")?;
        let text = raw
            .get("text_config")
            .and_then(Value::as_object)
            .context("MOSS config 缺少 text_config")?;
        let audio = raw
            .get("audio_config")
            .and_then(Value::as_object)
            .context("MOSS config 缺少 audio_config")?;
        let audio_model_size = usize_field(audio, "d_model", 1_024);
        let audio_merge_size = usize_value(raw.get("audio_merge_size")).unwrap_or(4);
        let config = Self {
            hidden_size: usize_field(text, "hidden_size", 1_024),
            intermediate_size: usize_field(text, "intermediate_size", 3_072),
            text_layers: usize_field(text, "num_hidden_layers", 28),
            text_heads: usize_field(text, "num_attention_heads", 16),
            text_kv_heads: usize_field(text, "num_key_value_heads", 8),
            head_dim: usize_field(text, "head_dim", 128),
            rms_eps: f32_field(text, "rms_norm_eps", 1e-6),
            rope_theta: f32_field(text, "rope_theta", 1_000_000.0),
            mel_bins: usize_field(audio, "num_mel_bins", 80),
            audio_model_size,
            audio_layers: usize_field(audio, "encoder_layers", 24),
            audio_heads: usize_field(audio, "encoder_attention_heads", 16),
            maximum_source_positions: usize_field(audio, "max_source_positions", 1_500),
            audio_token_id: i32_value(raw.get("audio_token_id")).unwrap_or(DEFAULT_AUDIO_TOKEN),
            audio_merge_size,
            adaptor_input_dim: usize_value(raw.get("adaptor_input_dim")).unwrap_or(audio_model_size * audio_merge_size),
            sample_rate: usize_value(raw.get("sample_rate")).unwrap_or(SAMPLE_RATE),
        };
        if config.sample_rate != SAMPLE_RATE
            || config.mel_bins != 80
            || config.audio_merge_size == 0
            || config.text_heads == 0
            || config.text_kv_heads == 0
        {
            bail!("不支持的 MOSS 配置：{config:?}");
        }
        Ok(config)
    }
}

/// processor_config.json 中影响 prompt 组装的字段。
#[derive(Debug, Clone)]
pub struct MossProcessorConfig {
    pub audio_tokens_per_second: f32,
    pub time_marker_every_seconds: usize,
    pub enable_time_marker: bool,
}

impl Default for MossProcessorConfig {
    fn default() -> Self {
        Self {
            audio_tokens_per_second: 12.5,
            time_marker_every_seconds: 5,
            enable_time_marker: true,
        }
    }
}

impl MossProcessorConfig {
    /// `processor_path` 是清单里的 `processor_config.json`；没有时用默认值。
    pub fn load(processor_path: Option<&Path>) -> Result<Self> {
        let mut config = Self::default();
        if let Some(processor_path) = processor_path {
            let processor: Value = serde_json::from_slice(&fs::read(processor_path)?).context("解析 MOSS processor_config.json")?;
            config.audio_tokens_per_second = processor
                .get("audio_tokens_per_second")
                .and_then(Value::as_f64)
                .map(|value| value as f32)
                .unwrap_or(config.audio_tokens_per_second);
            config.time_marker_every_seconds =
                usize_value(processor.get("time_marker_every_seconds")).unwrap_or(config.time_marker_every_seconds);
            config.enable_time_marker = processor
                .get("enable_time_marker")
                .and_then(Value::as_bool)
                .unwrap_or(config.enable_time_marker);
        }
        Ok(config)
    }
}

/// v2 的名字：MOSS 的结构化输出就是自分段识别器的输出（`rows` 已带绝对时间与说话人标签）。
pub type MossTranscription = SegmentedTranscription;
/// v2 的名字：生成过程的观测与中止钩子。
pub type MossCallbacks<'a> = SegmentingCallbacks<'a>;
/// v2 的名字：取消时的错误载荷。
pub use super::SegmentingCancelled as MossCancelled;

/// 一块没写完整时 [`transcribe_chunks`] 写进 `warnings` 的前缀；`job.run` 据此报 `segment-incomplete`。
pub const INCOMPLETE_WARNING_PREFIX: &str = "moss-incomplete: ";

/// 每积累这么多新 token 就做一次增量解码、旁路解析和取消检查。
pub(crate) const STREAM_FLUSH_INTERVAL: usize = 16;

/// 提前终止生成不能伪装成 EOS，否则分块驱动会把漏掉的音频当成成功。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GenerationStopReason {
    Eos,
    TokenLimit,
    Repetition,
}

pub(crate) struct ChunkGeneration {
    pub(crate) text: String,
    pub(crate) token_count: usize,
    pub(crate) stop_reason: GenerationStopReason,
}

/// 单块生成期间的流式观测状态。`covered` 是跨块共享的全局高水位。
pub(crate) struct StreamState<'a, 'b> {
    pub(crate) callbacks: &'a mut MossCallbacks<'b>,
    pub(crate) offset_seconds: f64,
    pub(crate) chunk_duration: f64,
    pub(crate) total_duration: f64,
    pub(crate) covered: f64,
    /// 全局秒数；起点早于它的实时段不再发出。重跑一块时，失败那次已经把这之前的
    /// 预览推给了界面，重跑只补后面的，不让实时轨上同一段出现两遍。
    pub(crate) preview_floor: f64,
    /// 已发出的实时段里最晚的终点（全局秒数）。
    pub(crate) previewed: f64,
    repetition: RepetitionGuard,
}

impl StreamState<'_, '_> {
    /// 返回 true 时后端应立即结束本次生成，并用 Repetition 原因交回分块驱动。
    pub(crate) fn observe(&mut self, segments: &[MossOutputSegment]) -> bool {
        for segment in segments {
            // 即便没有界面订阅、或预览被重试的 floor 抑制，也必须检查生成循环。
            if self.repetition.observe(segment) {
                return true;
            }
            let (mut live, suppressed) = preview_segment(segment);
            live.start += self.offset_seconds;
            live.end += self.offset_seconds;
            if !suppressed
                && live.end > live.start
                && live.start >= self.preview_floor
                && let Some(callback) = self.callbacks.on_segment.as_deref_mut()
            {
                self.previewed = self.previewed.max(live.end);
                callback(&live);
            }
            let bounded = live.end.min(self.offset_seconds + self.chunk_duration).min(self.total_duration);
            self.advance(bounded);
        }
        false
    }

    /// 推进覆盖进度并保证全局单调不减。
    pub(crate) fn advance(&mut self, covered: f64) {
        if !covered.is_finite() || covered <= self.covered {
            return;
        }
        self.covered = covered;
        if let Some(callback) = self.callbacks.on_progress.as_deref_mut() {
            callback(self.covered, self.total_duration);
        }
    }
}

pub struct AudioChunk<'a> {
    pub samples: &'a [f32],
    pub offset_seconds: f64,
}

pub fn split_audio_at_low_energy(audio: &[f32], chunk_duration: f64, search_seconds: f64, window_seconds: f64) -> Vec<AudioChunk<'_>> {
    let maximum = (chunk_duration * SAMPLE_RATE as f64) as usize;
    if audio.len() <= maximum || maximum == 0 {
        return vec![AudioChunk {
            samples: audio,
            offset_seconds: 0.0,
        }];
    }
    let search = (search_seconds * SAMPLE_RATE as f64) as usize;
    let window = ((window_seconds * SAMPLE_RATE as f64) as usize).max(1);
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < audio.len() {
        let expected_end = (start + maximum).min(audio.len());
        if expected_end == audio.len() {
            chunks.push(AudioChunk {
                samples: &audio[start..],
                offset_seconds: start as f64 / SAMPLE_RATE as f64,
            });
            break;
        }
        let search_start = expected_end.saturating_sub(search).max(start);
        // 只在目标边界之前找低能量点，保证任何块都不超过 chunk_duration 硬上限。
        let search_end = expected_end;
        let cut = lowest_energy_point(audio, search_start, search_end, window)
            .unwrap_or(expected_end)
            .max(start + SAMPLE_RATE)
            .min(audio.len());
        chunks.push(AudioChunk {
            samples: &audio[start..cut],
            offset_seconds: start as f64 / SAMPLE_RATE as f64,
        });
        start = cut;
    }
    chunks
}

/// `audio[search_start..search_end]` 里能量最低的 `window` 样本窗的中心；区间不比窗长
/// 时返回 `None`。
fn lowest_energy_point(audio: &[f32], search_start: usize, search_end: usize, window: usize) -> Option<usize> {
    let region = &audio[search_start..search_end];
    if region.len() <= window {
        return None;
    }
    let mut energy = region[..window].iter().map(|sample| sample * sample).sum::<f32>();
    let mut minimum = energy;
    let mut minimum_index = 0;
    for index in 1..=region.len() - window {
        energy += region[index + window - 1].powi(2) - region[index - 1].powi(2);
        if energy < minimum {
            minimum = energy;
            minimum_index = index;
        }
    }
    Some(search_start + minimum_index + window / 2)
}

/// 重切一块时，切出来的每一半至少这么长。半块短于它就不再切，按部分结果收下。
pub(crate) const MIN_RETRY_PIECE_SECONDS: f64 = MossGenerationPlan::MIN_CHUNK_DURATION;

/// 在中点前后 5 s 内找低能量点把一块切成两半，两半都不短于 `min_seconds`；
/// 块太短切不出来时返回 `None`。返回值是切点的样本下标。
pub(crate) fn split_in_half_at_low_energy(audio: &[f32], min_seconds: f64) -> Option<usize> {
    let minimum = (min_seconds * SAMPLE_RATE as f64) as usize;
    if minimum == 0 || audio.len() < minimum * 2 {
        return None;
    }
    let middle = audio.len() / 2;
    let search = 5 * SAMPLE_RATE;
    let low = middle.saturating_sub(search).max(minimum);
    let high = (middle + search).min(audio.len() - minimum);
    let window = SAMPLE_RATE / 10;
    let cut = lowest_energy_point(audio, low, high, window).unwrap_or(middle);
    Some(cut.clamp(minimum, audio.len() - minimum))
}

/// 交给后端跑一次生成的一块音频。
pub(crate) struct ChunkRequest<'a> {
    pub(crate) samples: &'a [f32],
    /// 在初始分块计划里的序号；重切出来的子块为 `None`。mlx 后端据此取预先物化好的
    /// 输入，子块现算。
    #[cfg_attr(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")), allow(dead_code))]
    pub(crate) planned: Option<usize>,
    pub(crate) max_tokens: usize,
}

struct Piece<'a> {
    samples: &'a [f32],
    offset_seconds: f64,
    planned: Option<usize>,
}

/// 分块转录循环（v2 里 mlx 与 candle 两个后端共用）。`generate` 对一块音频跑一次生成，
/// 返回原始输出、实际生成的 token 数与停止原因。
///
/// 某块检测到重复循环，或用满 token 预算、输出却没写到块尾时（常见于音乐、静音，或
/// 语速极快的段落），原样重试没有用：解码是贪心的，同样的输入每次得到同样的输出。
/// 这时在块中点附近的低能量处切成两半各自重跑——每半至少拿到
/// [`MossGenerationPlan::MIN_TOKENS`] 的预算，每秒可用的 token 翻倍，上下文也变了。
/// 半块短于 [`MIN_RETRY_PIECE_SECONDS`] 还不行，就收下已经写出的段落（剪掉尾部的
/// 循环重复），在 `warnings` 里写明哪一段可能缺字，而不是让前面几个小时的结果作废。
pub(crate) fn transcribe_chunks<'a, G>(
    audio: &'a [f32],
    chunks: &[AudioChunk<'a>],
    chunk_seconds: f64,
    callbacks: &mut MossCallbacks<'_>,
    mut generate: G,
) -> Result<MossTranscription>
where
    G: FnMut(ChunkRequest<'_>, &mut StreamState<'_, '_>) -> Result<ChunkGeneration>,
{
    let total_duration = audio.len() as f64 / SAMPLE_RATE as f64;
    let mut result = MossTranscription::default();
    let mut texts = Vec::new();
    let mut next_cluster = 0;
    let mut accepted_pieces = 0;
    let mut covered = 0.0_f64;
    let mut preview_floor = 0.0_f64;
    let mut previewed = 0.0_f64;
    // 后进先出：重切出来的两半压回栈顶，先于后面的块处理，时间顺序不乱。
    let mut pending = chunks
        .iter()
        .enumerate()
        .rev()
        .map(|(index, chunk)| Piece {
            samples: chunk.samples,
            offset_seconds: chunk.offset_seconds,
            planned: Some(index),
        })
        .collect::<Vec<_>>();
    while let Some(piece) = pending.pop() {
        if callbacks.cancelled() {
            return Err(anyhow::Error::from(SegmentingCancelled));
        }
        let piece_duration = piece.samples.len() as f64 / SAMPLE_RATE as f64;
        let plan = MossGenerationPlan::make_with_chunk_duration(piece_duration, chunk_seconds);
        let mut stream = StreamState {
            callbacks,
            offset_seconds: piece.offset_seconds,
            chunk_duration: piece_duration,
            total_duration,
            covered,
            preview_floor,
            previewed,
            repetition: RepetitionGuard::default(),
        };
        let generation = generate(
            ChunkRequest {
                samples: piece.samples,
                planned: piece.planned,
                max_tokens: plan.max_tokens,
            },
            &mut stream,
        )?;
        result.generation_tokens += generation.token_count;
        let mut segments = MossOutputParser::parse(&generation.text);
        let last_end = segments.iter().map(|segment| segment.end).fold(0.0_f64, f64::max);
        let needs_recovery = match generation.stop_reason {
            GenerationStopReason::Eos => false,
            GenerationStopReason::TokenLimit => plan.stopped_at_token_limit(generation.token_count, last_end, piece_duration),
            // 循环即使发生在块尾也不是正常结束，不能用末尾 5 s 容差掩盖它。
            GenerationStopReason::Repetition => true,
        };
        if needs_recovery {
            if let Some(cut) = split_in_half_at_low_energy(piece.samples, MIN_RETRY_PIECE_SECONDS) {
                covered = stream.covered;
                previewed = stream.previewed;
                preview_floor = preview_floor.max(previewed);
                let (first, second) = piece.samples.split_at(cut);
                pending.push(Piece {
                    samples: second,
                    offset_seconds: piece.offset_seconds + cut as f64 / SAMPLE_RATE as f64,
                    planned: None,
                });
                pending.push(Piece {
                    samples: first,
                    offset_seconds: piece.offset_seconds,
                    planned: None,
                });
                continue;
            }
            segments = drop_runaway_repeats(segments);
            let kept_until = segments
                .iter()
                .map(|segment| segment.end)
                .fold(0.0_f64, f64::max)
                .min(piece_duration);
            let reason = match generation.stop_reason {
                GenerationStopReason::Repetition => {
                    format!("生成 {} token 后因重复循环停止", generation.token_count)
                }
                _ => format!("用满了 {} token 上限仍没写到结尾", plan.max_tokens),
            };
            result.warnings.push(format!(
                "{INCOMPLETE_WARNING_PREFIX}MOSS 在 {}–{} 这段{}，已保留识别出的部分，{} 之后可能缺字；可以换 Qwen3-ASR 或 Whisper 重新转录",
                clock(piece.offset_seconds),
                clock(piece.offset_seconds + piece_duration),
                reason,
                clock(piece.offset_seconds + kept_until),
            ));
        }
        // 块已生成完，覆盖进度至少推进到块尾，避免空块导致进度停滞。
        stream.advance((piece.offset_seconds + piece_duration).min(total_duration));
        covered = stream.covered;
        previewed = stream.previewed;
        let mut adapted = adapt_output(&segments, piece_duration, true);
        let local_cluster_count = adapted.speaker_ranges.iter().map(|range| range.cluster + 1).max().unwrap_or(0);
        for row in &mut adapted.rows {
            row.start += piece.offset_seconds;
            row.end += piece.offset_seconds;
        }
        // 每次生成的说话人标签都各自从 S01 编起，重切出来的两半也是两次独立生成，
        // 所以按实际收下的块计序号，不沿用初始计划的序号。
        for range in &mut adapted.speaker_ranges {
            range.start += piece.offset_seconds;
            range.end += piece.offset_seconds;
            range.cluster += next_cluster;
            range.chunk = accepted_pieces;
        }
        next_cluster += local_cluster_count;
        accepted_pieces += 1;
        result.rows.extend(adapted.rows);
        result.speaker_ranges.extend(adapted.speaker_ranges);
        let shifted = offset_segments(&segments, piece.offset_seconds);
        let shifted_text = render_segments(&shifted);
        if !shifted_text.is_empty() {
            texts.push(shifted_text);
        }
    }
    result.text = texts.join("\n");
    Ok(result)
}

/// 生成失败的输出里，尾部往往是同几句话换着时间戳反复出现。收下部分结果前
/// 去掉时间倒退的段，以及与最近几段文本相同的段。只用在失败兜底上：正常输出里连着
/// 说两遍「はい」是真话。
pub(crate) fn drop_runaway_repeats(segments: Vec<MossOutputSegment>) -> Vec<MossOutputSegment> {
    const LOOKBACK: usize = 4;
    let mut kept: Vec<MossOutputSegment> = Vec::with_capacity(segments.len());
    for segment in segments {
        let text = segment.text.trim();
        // 与最终 rows 的有效性一致；否则警告会把零时长幻觉的终点当成已保留文本。
        if segment.end <= segment.start || text.is_empty() {
            continue;
        }
        let went_back = kept.last().is_some_and(|last| segment.start < last.start);
        let repeated = kept.iter().rev().take(LOOKBACK).any(|previous| previous.text.trim() == text);
        if !went_back && !repeated {
            kept.push(segment);
        }
    }
    kept
}

fn clock(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    format!("{}:{:02}:{:02}", total / 3_600, total / 60 % 60, total % 60)
}

pub fn offset_segments(segments: &[MossOutputSegment], offset: f64) -> Vec<MossOutputSegment> {
    segments
        .iter()
        .cloned()
        .map(|mut segment| {
            segment.start += offset;
            segment.end += offset;
            segment
        })
        .collect()
}

pub fn render_segments(segments: &[MossOutputSegment]) -> String {
    segments
        .iter()
        .map(|segment| format!("[{:.2}][{}]{}[{:.2}]", segment.start, segment.speaker, segment.text, segment.end))
        .collect::<Vec<_>>()
        .join("")
}

pub fn usize_value(value: Option<&Value>) -> Option<usize> {
    value.and_then(Value::as_u64).map(|value| value as usize)
}

pub fn i32_value(value: Option<&Value>) -> Option<i32> {
    value.and_then(Value::as_i64).map(|value| value as i32)
}

pub fn usize_field(object: &serde_json::Map<String, Value>, key: &str, default: usize) -> usize {
    usize_value(object.get(key)).unwrap_or(default)
}

pub fn f32_field(object: &serde_json::Map<String, Value>, key: &str, default: f32) -> f32 {
    object.get(key).and_then(Value::as_f64).map(|value| value as f32).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::speech::LiveSegment;

    #[test]
    fn instruction_names_asserted_language_and_forbids_translation() {
        let english = moss_instruction(Some("en"));
        assert!(english.starts_with(DEFAULT_PROMPT));
        assert!(english.contains("The speech is expected to be in English."));
        assert!(english.contains("Transcribe it verbatim in English, exactly as spoken"));
        assert!(english.contains("do not translate"));
        assert!(!english.contains(AUTO_LANGUAGE_RULE));
        // 内核传进来的是 autolang 归一后的 code，别处可能带地区 / 书写系统子标签。
        assert!(moss_instruction(Some("zh")).contains("expected to be in Chinese."));
        assert!(moss_instruction(Some("zh-Hans")).contains("expected to be in Chinese."));
        assert!(moss_instruction(Some("fr")).contains("expected to be in French."));
        assert!(moss_instruction(Some("ja-JP")).contains("expected to be in Japanese."));
    }

    #[test]
    fn instruction_without_language_keeps_spoken_language() {
        let expected = format!("{DEFAULT_PROMPT} {AUTO_LANGUAGE_RULE}");
        assert_eq!(moss_instruction(None), expected);
        assert_eq!(moss_instruction(Some("auto")), expected);
        assert_eq!(moss_instruction(Some("AUTO")), expected);
        assert_eq!(moss_instruction(Some("  ")), expected);
        // 认不出的 code 不硬塞进指令（点名就会被当成翻译目标），按自动处理。
        assert_eq!(moss_instruction(Some("xx-unknown")), expected);
        assert!(AUTO_LANGUAGE_RULE.contains("in the language actually spoken; do not translate"));
    }

    #[test]
    fn language_names_cover_autolang_and_catalog_codes() {
        assert_eq!(language_name("en").as_deref(), Some("English"));
        assert_eq!(language_name("de").as_deref(), Some("German"));
        assert_eq!(language_name("yue").as_deref(), Some("Chinese"));
        // autolang 不认、语言目录认的 code 取目录里给语音模型的英文名。
        assert_eq!(language_name("uk").as_deref(), Some("Ukrainian"));
        assert_eq!(language_name("auto"), None);
        assert_eq!(language_name(""), None);
    }

    /// 复刻两个后端的分块循环：每块新建 StreamState 但沿用 covered，块末强制推进到块边界。
    fn drive_chunks(chunks: &[(f64, Vec<MossOutputSegment>)], chunk_duration: f64, total_duration: f64, callbacks: &mut MossCallbacks<'_>) {
        let mut covered = 0.0_f64;
        for (offset_seconds, segments) in chunks {
            let mut stream = StreamState {
                callbacks,
                offset_seconds: *offset_seconds,
                chunk_duration,
                total_duration,
                covered,
                preview_floor: 0.0,
                previewed: 0.0,
                repetition: RepetitionGuard::default(),
            };
            stream.observe(segments);
            stream.advance((offset_seconds + chunk_duration).min(total_duration));
            covered = stream.covered;
        }
    }

    fn segment(start: f64, end: f64, text: &str) -> MossOutputSegment {
        MossOutputSegment {
            start,
            end,
            speaker: "S01".to_owned(),
            text: text.to_owned(),
        }
    }

    #[test]
    fn stream_state_keeps_progress_monotonic_and_global_across_chunks() {
        let chunks = vec![
            (
                0.0,
                vec![
                    segment(10.0, 20.0, "one"),
                    // 回退的段不得让进度倒车。
                    segment(2.0, 5.0, "back"),
                    // 含替换字符的段被抑制：不发实时段，但仍然推进覆盖秒数。
                    segment(30.0, 40.0, "bro\u{FFFD}ken"),
                    // 越过块边界的段要被夹回块尾。
                    segment(1_700.0, 5_000.0, "over"),
                ],
            ),
            (1_800.0, vec![segment(5.0, 15.0, "two"), segment(500.0, 700.0, "three")]),
        ];
        let mut live = Vec::new();
        let mut progress = Vec::new();
        let mut on_segment = |segment: &LiveSegment| {
            live.push((segment.start, segment.end, segment.text.clone()));
        };
        let mut on_progress = |covered: f64, total: f64| progress.push((covered, total));
        drive_chunks(
            &chunks,
            1_800.0,
            2_400.0,
            &mut MossCallbacks {
                on_progress: Some(&mut on_progress),
                on_segment: Some(&mut on_segment),
                should_cancel: None,
            },
        );

        assert_eq!(
            live,
            vec![
                (10.0, 20.0, "one".to_owned()),
                (2.0, 5.0, "back".to_owned()),
                (1_700.0, 5_000.0, "over".to_owned()),
                (1_805.0, 1_815.0, "two".to_owned()),
                (2_300.0, 2_500.0, "three".to_owned()),
            ]
        );
        assert!(
            progress.windows(2).all(|pair| pair[1].0 > pair[0].0),
            "覆盖秒数必须全局严格递增：{progress:?}"
        );
        assert!(progress.iter().all(|(_, total)| *total == 2_400.0), "总时长必须始终是整片时长");
        assert_eq!(
            progress.iter().map(|(covered, _)| *covered).collect::<Vec<_>>(),
            vec![20.0, 40.0, 1_800.0, 1_815.0, 2_400.0]
        );
    }

    #[test]
    fn zero_duration_music_segments_do_not_reach_live_preview() {
        let segments = MossOutputParser::parse(
            "[11.98][S01][Music][11.99][11.99][S01][Music][11.99]\
             [11.99][S01][Music][11.99]",
        );
        assert_eq!(segments.len(), 3);
        let mut live = Vec::new();
        let mut on_segment = |segment: &LiveSegment| live.push(segment.clone());
        drive_chunks(
            &[(0.0, segments)],
            60.0,
            60.0,
            &mut MossCallbacks {
                on_progress: None,
                on_segment: Some(&mut on_segment),
                should_cancel: None,
            },
        );
        assert_eq!(live.len(), 1, "zero-duration segments must not flood the preview");
        assert_eq!((live[0].start, live[0].end), (11.98, 11.99));
    }

    /// 假生成器的一次输出：`[start][S01]text[end]` 相对块内时间。
    fn raw(segments: &[(f64, f64, &str)]) -> String {
        segments
            .iter()
            .map(|(start, end, text)| format!("[{start:.2}][S01]{text}[{end:.2}]"))
            .collect()
    }

    fn seconds(samples: &[f32]) -> f64 {
        samples.len() as f64 / SAMPLE_RATE as f64
    }

    #[test]
    fn exhausted_chunk_is_split_and_retried_instead_of_failing() {
        // 第 27 块那种尾块：162 s，预算 5184 token。整块跑用满预算只写到 40 s；
        // 两半各自跑都能写到结尾。
        let audio = vec![0.1_f32; SAMPLE_RATE * 162];
        let chunks = vec![AudioChunk {
            samples: &audio,
            offset_seconds: 0.0,
        }];
        let mut calls = Vec::new();
        let mut live = Vec::new();
        let mut on_segment = |segment: &LiveSegment| live.push((segment.start, segment.text.clone()));
        let result = transcribe_chunks(
            &audio,
            &chunks,
            MossGenerationPlan::CHUNK_DURATION,
            &mut MossCallbacks {
                on_progress: None,
                on_segment: Some(&mut on_segment),
                should_cancel: None,
            },
            |request, stream| {
                let duration = seconds(request.samples);
                calls.push((request.planned, duration, request.max_tokens));
                let output = if duration > 150.0 {
                    raw(&[(0.0, 20.0, "one"), (20.0, 40.0, "two")])
                } else {
                    raw(&[(0.0, duration / 2.0, "head"), (duration / 2.0, duration - 1.0, "tail")])
                };
                stream.observe(&MossOutputParser::parse(&output));
                let tokens = if duration > 150.0 { request.max_tokens } else { 900 };
                Ok(ChunkGeneration {
                    text: output,
                    token_count: tokens,
                    stop_reason: if duration > 150.0 {
                        GenerationStopReason::TokenLimit
                    } else {
                        GenerationStopReason::Eos
                    },
                })
            },
        )
        .unwrap();

        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0], (Some(0), 162.0, 5_184));
        assert!(
            calls[1..]
                .iter()
                .all(|(planned, duration, tokens)| { planned.is_none() && *duration >= MIN_RETRY_PIECE_SECONDS && *tokens == 5_120 })
        );
        assert!(result.warnings.is_empty(), "{:?}", result.warnings);
        assert_eq!(result.generation_tokens, 5_184 + 900 * 2);
        // 失败那次的段落不进结果；两半按时间顺序拼回，末行写到整块结尾附近。
        let texts = result.rows.iter().map(|row| row.text.as_str()).collect::<Vec<_>>();
        assert_eq!(texts, vec!["head", "tail", "head", "tail"]);
        assert!(result.rows.windows(2).all(|pair| pair[1].start >= pair[0].start));
        assert!(result.rows.last().unwrap().end > 160.0);
        // 两半是两次独立生成，说话人区间的块序号与簇编号各自分开。
        let chunks_seen = result
            .speaker_ranges
            .iter()
            .map(|range| (range.chunk, range.cluster))
            .collect::<HashSet<_>>();
        assert_eq!(chunks_seen, HashSet::from([(0, 0), (1, 1)]));
        // 失败那次已经推给实时轨的 0–40 s 不再重发：第一半起点在 40 s 之前的两段都压住，
        // 只补后面的。音频能量处处相同，切点落在中点前 5 s 搜索区的起点（76.05 s）。
        let live = live.iter().map(|(start, text)| (start.round(), text.as_str())).collect::<Vec<_>>();
        assert_eq!(live, vec![(0.0, "one"), (20.0, "two"), (76.0, "head"), (119.0, "tail")]);
    }

    #[test]
    fn centisecond_loop_retries_early_and_recovers_later_audio() {
        let audio = vec![0.1_f32; SAMPLE_RATE * 162];
        let chunks = vec![AudioChunk {
            samples: &audio,
            offset_seconds: 0.0,
        }];
        let mut calls = 0;
        let mut loop_segments = 0;
        let result = transcribe_chunks(
            &audio,
            &chunks,
            MossGenerationPlan::CHUNK_DURATION,
            &mut MossCallbacks::none(),
            |request, stream| {
                calls += 1;
                // 检测不依赖预览订阅或 floor；即使这一段不会发到界面也不能继续循环。
                stream.preview_floor = f64::INFINITY;
                let duration = seconds(request.samples);
                if request.planned.is_some() {
                    let mut output = String::new();
                    for index in 0..100 {
                        let start = 11.0 + index as f64 * 0.01;
                        let next = segment(start, start + 0.01, "[Music]");
                        output.push_str(&raw(&[(next.start, next.end, &next.text)]));
                        loop_segments += 1;
                        if stream.observe(&[next]) {
                            let token_count = loop_segments * STREAM_FLUSH_INTERVAL;
                            assert!(token_count < request.max_tokens);
                            return Ok(ChunkGeneration {
                                text: output,
                                token_count,
                                stop_reason: GenerationStopReason::Repetition,
                            });
                        }
                    }
                    panic!("the centisecond loop was not stopped");
                }
                let output = raw(&[(0.0, duration - 1.0, "recovered speech")]);
                assert!(!stream.observe(&MossOutputParser::parse(&output)));
                Ok(ChunkGeneration {
                    text: output,
                    token_count: 30,
                    stop_reason: GenerationStopReason::Eos,
                })
            },
        )
        .unwrap();

        assert_eq!(loop_segments, 8);
        assert_eq!(calls, 3);
        assert_eq!(result.generation_tokens, 8 * STREAM_FLUSH_INTERVAL + 60);
        assert!(result.warnings.is_empty());
        assert_eq!(result.rows.len(), 2);
        assert!(result.rows.iter().all(|row| row.text == "recovered speech"));
        assert!(result.rows[1].end > 160.0);
    }

    #[test]
    fn unsplittable_loop_warns_even_near_chunk_end_and_drops_zero_duration_tail() {
        for loop_time in [11.99, 99.0] {
            let audio = vec![0.1_f32; SAMPLE_RATE * 100];
            let chunks = vec![AudioChunk {
                samples: &audio,
                offset_seconds: 0.0,
            }];
            let mut calls = 0;
            let result = transcribe_chunks(
                &audio,
                &chunks,
                MossGenerationPlan::CHUNK_DURATION,
                &mut MossCallbacks::none(),
                |request, stream| {
                    calls += 1;
                    let mut output = raw(&[(0.0, 10.0, "real")]);
                    assert!(!stream.observe(&MossOutputParser::parse(&output)));
                    for index in 0..8 {
                        let next = raw(&[(loop_time, loop_time, "[Music]")]);
                        output.push_str(&next);
                        assert_eq!(stream.observe(&MossOutputParser::parse(&next)), index == 7);
                    }
                    assert!(144 < request.max_tokens);
                    Ok(ChunkGeneration {
                        text: output,
                        token_count: 144,
                        stop_reason: GenerationStopReason::Repetition,
                    })
                },
            )
            .unwrap();

            assert_eq!(calls, 1);
            assert_eq!(result.generation_tokens, 144);
            assert_eq!(result.rows.len(), 1);
            assert_eq!(result.rows[0].text, "real");
            assert!(!result.text.contains("[Music]"));
            assert_eq!(result.warnings.len(), 1);
            assert!(result.warnings[0].contains("生成 144 token 后因重复循环停止"));
            assert!(result.warnings[0].contains("0:00:10 之后可能缺字"));
        }
    }

    #[test]
    fn eos_keeps_real_repetition_and_does_not_retry_silent_tail() {
        let audio = vec![0.1_f32; SAMPLE_RATE * 162];
        let chunks = vec![AudioChunk {
            samples: &audio,
            offset_seconds: 0.0,
        }];
        let mut calls = 0;
        let result = transcribe_chunks(
            &audio,
            &chunks,
            MossGenerationPlan::CHUNK_DURATION,
            &mut MossCallbacks::none(),
            |_, stream| {
                calls += 1;
                let output = raw(&[(0.0, 10.0, "はい"), (10.0, 20.0, "はい")]);
                assert!(!stream.observe(&MossOutputParser::parse(&output)));
                Ok(ChunkGeneration {
                    text: output,
                    token_count: 32,
                    stop_reason: GenerationStopReason::Eos,
                })
            },
        )
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(result.rows.len(), 2);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn chunk_that_cannot_be_split_further_keeps_partial_output_with_warning() {
        // 100 s 的块切成两半就短于 60 s，不再切：收下已写出的部分，剪掉尾部的循环。
        let audio = vec![0.1_f32; SAMPLE_RATE * 100];
        let chunks = vec![AudioChunk {
            samples: &audio,
            offset_seconds: 7_700.0,
        }];
        let mut calls = 0;
        let result = transcribe_chunks(
            &audio,
            &chunks,
            MossGenerationPlan::CHUNK_DURATION,
            &mut MossCallbacks::none(),
            |request, _stream| {
                calls += 1;
                let output = raw(&[
                    (0.0, 10.0, "real"),
                    (10.0, 12.0, "ご視聴ありがとうございました"),
                    (12.0, 14.0, "music"),
                    (12.0, 14.0, "ご視聴ありがとうございました"),
                    (14.0, 16.0, "music"),
                ]);
                Ok(ChunkGeneration {
                    text: output,
                    token_count: request.max_tokens,
                    stop_reason: GenerationStopReason::TokenLimit,
                })
            },
        )
        .unwrap();

        assert_eq!(calls, 1);
        let texts = result.rows.iter().map(|row| row.text.as_str()).collect::<Vec<_>>();
        assert_eq!(texts, vec!["real", "ご視聴ありがとうございました", "music"]);
        assert_eq!(result.rows[0].start, 7_700.0);
        assert_eq!(result.warnings.len(), 1);
        let warning = &result.warnings[0];
        assert!(warning.starts_with("moss-incomplete: "), "{warning}");
        assert!(warning.contains("2:08:20–2:10:00"), "{warning}");
        assert!(warning.contains("2:08:34 之后"), "{warning}");
    }

    #[test]
    fn cancellation_is_checked_before_each_piece() {
        let audio = vec![0.1_f32; SAMPLE_RATE * 10];
        let chunks = vec![AudioChunk {
            samples: &audio,
            offset_seconds: 0.0,
        }];
        let mut cancel = || true;
        let error = transcribe_chunks(
            &audio,
            &chunks,
            MossGenerationPlan::CHUNK_DURATION,
            &mut MossCallbacks {
                on_progress: None,
                on_segment: None,
                should_cancel: Some(&mut cancel),
            },
            |_, _| unreachable!("取消后不应再生成"),
        )
        .unwrap_err();
        assert!(error.downcast_ref::<SegmentingCancelled>().is_some());
    }

    #[test]
    fn half_split_prefers_the_quiet_point_and_respects_minimum() {
        let mut audio = vec![0.5_f32; SAMPLE_RATE * 160];
        // 中点前 2 s 处有一段静音。
        let quiet = SAMPLE_RATE * 78;
        audio[quiet..quiet + SAMPLE_RATE / 5].fill(0.0);
        let cut = split_in_half_at_low_energy(&audio, 60.0).unwrap();
        assert!((quiet..quiet + SAMPLE_RATE / 5).contains(&cut), "{cut}");
        assert!(split_in_half_at_low_energy(&audio[..SAMPLE_RATE * 119], 60.0).is_none());
        let cut = split_in_half_at_low_energy(&audio[..SAMPLE_RATE * 121], 60.0).unwrap();
        assert!(cut >= SAMPLE_RATE * 60 && SAMPLE_RATE * 121 - cut >= SAMPLE_RATE * 60);
    }

    #[test]
    fn runaway_repeats_drop_looping_and_backward_segments_only() {
        let segments = MossOutputParser::parse(&raw(&[
            (0.0, 2.0, "はい"),
            (2.0, 4.0, "そうです"),
            (4.0, 6.0, "はい"),
            (6.0, 8.0, "次へ"),
            (3.0, 5.0, "戻り"),
            (8.0, 9.0, "終わり"),
        ]));
        let kept = drop_runaway_repeats(segments)
            .into_iter()
            .map(|segment| segment.text)
            .collect::<Vec<_>>();
        assert_eq!(kept, vec!["はい", "そうです", "次へ", "終わり"]);
    }

    #[test]
    fn audio_token_length_matches_reference_stride() {
        let stride = HOP_LENGTH * WHISPER_ENCODER_STRIDE * 4;
        assert_eq!((WHISPER_WINDOW_SAMPLES - 1) / stride + 1, 375);
    }

    #[test]
    fn low_energy_chunker_offsets_are_contiguous() {
        let mut audio = vec![0.5_f32; SAMPLE_RATE * 4];
        audio[SAMPLE_RATE * 2] = 0.0;
        let chunks = split_audio_at_low_energy(&audio, 2.0, 0.25, 0.01);
        assert!(chunks.len() >= 2);
        assert!(chunks.iter().all(|chunk| chunk.samples.len() <= SAMPLE_RATE * 2));
        for pair in chunks.windows(2) {
            let expected = pair[0].offset_seconds + pair[0].samples.len() as f64 / SAMPLE_RATE as f64;
            assert!((pair[1].offset_seconds - expected).abs() < 1e-9);
        }
    }

    #[test]
    fn rendered_segments_apply_chunk_offset() {
        let segments = vec![MossOutputSegment {
            start: 0.5,
            end: 1.0,
            speaker: "S01".to_owned(),
            text: "hello".to_owned(),
        }];
        let shifted = offset_segments(&segments, 1_800.0);
        assert_eq!(render_segments(&shifted), "[1800.50][S01]hello[1801.00]");
    }
}
