//! 字幕文件导出：Cue / 句 / 译文 Cue → srt、vtt、ass 与带逐词时间的 json。
//!
//! 移植自 BaoCut v2 `bcut-kernel`：`cmd/media/subtitles.rs` 全部可纯函数化的部分与
//! `cmd/media/tests.rs` 的生产代码段（被 `media.rs` 以 `include!` 引入的
//! `build_subtitle_events` / `render_subtitle_events` / `render_source_subtitles` /
//! `ass_time` / `subtitle_time` 等），`ExportMode` 来自 `cmd/media.rs`，
//! ASS 头的常量与 [`AssStyleSheet`] 来自 `cmd/studio_export/ass_style.rs`（见 [`ass_style`]）。
//!
//! 语义原样：双语按「句内源 Cue 边界 ∪ 译片边界」分段（[`build_subtitle_events`]）；
//! 缺译句一律不回退原文——译文模式整句不产出事件，双语模式只留原文行。
//!
//! 只依赖 [`TranscriptDoc`] 与纯数据入参。v2 里读写工程目录、走时间线投影的那一支
//! （`render_project_timeline_subtitles`、`timeline_timed_words`、
//! `extra_source_transcripts`）不在本模块。

pub mod ass_style;

use serde_json::{Value, json};

use crate::asr_rows::RowIn;
use crate::build::{SpeakerBoundaryPolicy, build_doc_with_policy};
use crate::cue::{Cue, derive_cues};
use crate::doc::{DocEngine, DocMedia, TranscriptDoc};
use crate::sentence::{Sentence, derive_sentences};
use crate::split::{TransCue, derive_trans_cues, target_delivery_projection};

pub use ass_style::{ASS_PRIMARY_STYLE, ASS_TRANSLATION_STYLE, AssStyleSheet};

/// 词化落盘时 v2 宿主的固定采样率（v2 `bcut-speech::audio::SAMPLE_RATE`）。
const SAMPLE_RATE: u32 = 16_000;

/// 字幕的内容模式：原文、译文、双语。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportMode {
    Original,
    Translated,
    Bilingual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubtitleFlavor {
    Srt,
    Vtt,
    Ass,
    /// 字幕式 JSON：事件与前三种同源，另附逐词时间戳（[`render_json_words`]）。
    JsonWords,
}

/// One-shot subtitle selection, applied after source/timeline projection.
#[derive(Debug, Clone, Copy)]
pub struct SubtitleWindow {
    start: f64,
    end: f64,
}

impl SubtitleWindow {
    /// `--range` 换算后的一段（秒）：须有限且 `0 <= start < end`。
    ///
    /// 非法时返回错误文案；v2 的 CLI 另把它包成 `time-invalid` / `--range` 的结构化失败。
    pub fn new(start: f64, end: f64) -> Result<Self, String> {
        if start.is_finite() && end.is_finite() && start >= 0.0 && end > start {
            Ok(Self { start, end })
        } else {
            Err(format!(
                "--range 导出窗口非法：换算后是 {start}..{end}，须有限且 0 <= 起 < 止"
            ))
        }
    }

    pub fn overlaps(self, start: f64, end: f64) -> bool {
        start < self.end && end > self.start
    }

    fn apply(self, events: &mut Vec<SubtitleEvent>, words: &mut Vec<TimedWord>) {
        events.retain_mut(|(start, end, _, _)| {
            if !self.overlaps(*start, *end) {
                return false;
            }
            *start = start.max(self.start) - self.start;
            *end = end.min(self.end) - self.start;
            true
        });
        words.retain_mut(|word| {
            if !self.overlaps(word.start, word.end) {
                return false;
            }
            word.start = word.start.max(self.start) - self.start;
            word.end = word.end.min(self.end) - self.start;
            true
        });
    }
}

/// rows → 字幕文本（worker 的 OpenAI 兼容面 `response_format=srt|vtt`）。
///
/// 走的是与 `bcut export --to srt --no-cuts` **同一条**投影：`build_doc` →
/// `derive_cues` → `derive_sentences` → [`render_source_subtitles`]。兼容面没有
/// 工程也没有时间线，因此对应的是「原始源时间」那一支；同一批 rows 两条路径
/// 必须逐字节一致，`worker_openai.rs` 的对拍测试守着这一点。
///
/// v2 在函数内按引擎 id 查模型目录得出说话人边界策略
/// （`speaker_boundary_policy_for_engine`）；这里由调用方传入 `speaker_policy`。
pub fn subtitles_from_rows(
    rows: &[RowIn],
    language: &str,
    duration: f64,
    engine_id: &str,
    speaker_policy: SpeakerBoundaryPolicy,
    flavor: SubtitleFlavor,
) -> String {
    let aligned_words = rows
        .iter()
        .any(|row| row.words.as_ref().is_some_and(|words| !words.is_empty()));
    let doc = build_doc_with_policy(
        rows,
        DocMedia {
            id: None,
            path: None,
            hash: String::new(),
            duration,
            sample_rate: Some(SAMPLE_RATE),
        },
        language,
        DocEngine {
            name: engine_id.to_owned(),
            version: None,
            aligned_words,
        },
        None,
        speaker_policy,
    );
    let cues = derive_cues(&doc, &crate::layout_profile::cue_params_for_doc(&doc));
    let sentences = derive_sentences(&doc, &cues);
    let mut missing = 0_usize;
    render_source_subtitles(
        &doc,
        &cues,
        &sentences,
        ExportMode::Original,
        None,
        // 兼容面没有 studio/style.json，交付标点与 `bcut export` 的缺省一致。
        true,
        flavor,
        &SubtitleRenderOptions::default(),
        &mut missing,
    )
    .0
}

/// 说话人显示名：多说话人才加前缀，单说话人字幕不带。
fn speaker_prefix(doc: &TranscriptDoc, sp: &str, flavor: SubtitleFlavor) -> String {
    if doc.speakers.len() < 2 {
        return String::new();
    }
    let name = doc
        .speakers
        .get(sp)
        .map_or_else(|| sp.to_owned(), |speaker| speaker.name.clone());
    match flavor {
        SubtitleFlavor::Srt => format!("[{name}] "),
        SubtitleFlavor::Vtt => format!("<v {name}>"),
        SubtitleFlavor::Ass | SubtitleFlavor::JsonWords => String::new(),
    }
}

/// 字幕事件里念的说话人显示名：与 ASS 的 Name 字段同一判据（多说话人才有）。
fn speaker_display_name(doc: &TranscriptDoc, sp: &str) -> Option<String> {
    (doc.speakers.len() >= 2).then(|| {
        doc.speakers
            .get(sp)
            .map_or_else(|| sp.to_owned(), |speaker| speaker.name.clone())
    })
}

/// 一个已落到输出时钟上的原文词（`--to json-words` 用）。
///
/// `src` 只在时间轴投影那一支有值：多素材工程的事件 sp 是 `{src}:{speaker}`，
/// 词只归到同一素材的事件里，叠放的两条素材轨不会互相串词。
struct TimedWord {
    src: Option<String>,
    start: f64,
    end: f64,
    text: String,
}

/// 源时间那一支（`--no-cuts`）：非 hidden 词原样取源时间，与 Cue 同一份词集。
fn source_timed_words(doc: &TranscriptDoc) -> Vec<TimedWord> {
    doc.words
        .iter()
        .filter(|word| !doc.hidden.get(&word.id).copied().unwrap_or(false))
        .map(|word| TimedWord {
            src: None,
            start: word.t0,
            end: word.t1,
            text: word.text.clone(),
        })
        .collect()
}

/// 秒 → 毫秒精度，避免 `0.1 + 0.2` 式的浮点尾巴进文件。
fn json_seconds(value: f64) -> Value {
    json!((value * 1000.0).round() / 1000.0)
}

/// `--to json-words`：把与 srt/vtt/ass 同一份事件写成 JSON，每条带逐词时间戳。
///
/// - `text` 与 SRT 那一条的正文逐字相同（双语是「原文\n译文」两行）；
/// - `words[]` 是**原文**词：词中点落在这条的 `[start, end)` 里、且来自同一素材；
///   译文没有逐词时间，译文模式下这里仍是说话的那些原文词；
/// - `speaker` 只在多说话人且没加 `--no-speakers` 时出现（与 ASS Name 同判据）；
/// - `timebase` 是 `output`（成片时间，剪口生效）或 `source`（`--no-cuts`）。
fn render_json_words(
    doc: &TranscriptDoc,
    events: &[SubtitleEvent],
    words: &mut [TimedWord],
    timebase: &str,
    options: &SubtitleRenderOptions,
) -> String {
    words.sort_by(|left, right| {
        (left.start + left.end)
            .total_cmp(&(right.start + right.end))
            .then(left.start.total_cmp(&right.start))
    });
    let cues: Vec<Value> = events
        .iter()
        .map(|(start, end, sp, body)| {
            let src = sp.split_once(':').map(|(src, _)| src);
            let first = words.partition_point(|word| (word.start + word.end) / 2.0 < *start);
            let cue_words: Vec<Value> = words[first..]
                .iter()
                .take_while(|word| (word.start + word.end) / 2.0 < *end)
                .filter(|word| word.src.is_none() || word.src.as_deref() == src)
                .map(|word| {
                    json!({
                        "text": word.text,
                        "start": json_seconds(word.start),
                        "end": json_seconds(word.end),
                    })
                })
                .collect();
            let mut cue = serde_json::Map::new();
            cue.insert("start".to_owned(), json_seconds(*start));
            cue.insert("end".to_owned(), json_seconds(*end));
            if options.speakers
                && let Some(name) = speaker_display_name(doc, sp)
            {
                cue.insert("speaker".to_owned(), json!(name));
            }
            cue.insert("text".to_owned(), json!(body));
            cue.insert("words".to_owned(), Value::Array(cue_words));
            Value::Object(cue)
        })
        .collect();
    let mut root = serde_json::Map::new();
    root.insert("version".to_owned(), json!(1));
    root.insert("timebase".to_owned(), json!(timebase));
    if let Value::Object(header) = &options.json_header {
        root.extend(
            header
                .iter()
                .filter(|(_, value)| !value.is_null())
                .map(|(key, value)| (key.clone(), value.clone())),
        );
    }
    root.insert("cues".to_owned(), Value::Array(cues));
    let mut text =
        serde_json::to_string_pretty(&Value::Object(root)).expect("json-words payload serializes");
    text.push('\n');
    text
}

/// 字幕事件:(start, end, sp, body)。
pub type SubtitleEvent = (f64, f64, String, String);

fn subtitle_delivery_text(text: &str, language: &str, project_punctuation: bool) -> String {
    if project_punctuation {
        target_delivery_projection(text, language)
    } else {
        text.to_owned()
    }
}

fn join_subtitle_lines(lines: impl IntoIterator<Item = String>) -> String {
    lines
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// independent 双语:句内源 Cue 边界 ∪ 译片边界分段,相邻同内容合并。
fn union_events(
    doc: &TranscriptDoc,
    cues: &[Cue],
    sentence: &Sentence,
    pieces: &[&TransCue],
    target_lang: &str,
    project_punctuation: bool,
) -> Vec<SubtitleEvent> {
    const EPSILON: f64 = 1e-6;
    let mut bounds: Vec<f64> = Vec::new();
    for &cue_index in &sentence.cue_indices {
        bounds.push(cues[cue_index].start);
        bounds.push(cues[cue_index].end);
    }
    for piece in pieces {
        bounds.push(piece.start);
        bounds.push(piece.end);
    }
    bounds.sort_by(f64::total_cmp);
    bounds.dedup_by(|a, b| (*a - *b).abs() < EPSILON);
    let mut events: Vec<SubtitleEvent> = Vec::new();
    for window in bounds.windows(2) {
        let (start, end) = (window[0], window[1]);
        if end - start < EPSILON {
            continue;
        }
        let midpoint = (start + end) / 2.0;
        let source = sentence
            .cue_indices
            .iter()
            .map(|&cue_index| &cues[cue_index])
            .find(|cue| cue.start <= midpoint && midpoint < cue.end);
        let translated = pieces
            .iter()
            .find(|piece| piece.start <= midpoint && midpoint < piece.end);
        let body = match (source, translated) {
            (Some(cue), Some(piece)) => join_subtitle_lines([
                subtitle_delivery_text(&cue.text(doc), &doc.lang, project_punctuation),
                subtitle_delivery_text(&piece.text, target_lang, project_punctuation),
            ]),
            (Some(cue), None) => {
                subtitle_delivery_text(&cue.text(doc), &doc.lang, project_punctuation)
            }
            (None, Some(piece)) => {
                subtitle_delivery_text(&piece.text, target_lang, project_punctuation)
            }
            (None, None) => continue,
        };
        let sp = source.map_or_else(
            || cues[sentence.cue_indices[0]].sp.clone(),
            |cue| cue.sp.clone(),
        );
        if let Some(last) = events.last_mut()
            && last.3 == body
            && (start - last.1).abs() < EPSILON
        {
            last.1 = end;
            continue;
        }
        events.push((start, end, sp, body));
    }
    events
}

/// 字幕文件导出的渲染选项与投影后的区间选择。
pub struct SubtitleRenderOptions {
    /// `--no-speakers` 取反：srt 的 `[Name] `、vtt 的 `<v Name>`、ass 的 Name 字段。
    pub speakers: bool,
    /// ASS 头与双语第二行的样式名；srt/vtt 不消费。
    pub ass: AssStyleSheet,
    /// `--to json-words` 的文首字段（mode / 语言）；值为 null 的键不落盘。其余格式不消费。
    pub json_header: Value,
    /// 裁取投影后的窗口并归零；None 保持整片导出。
    pub window: Option<SubtitleWindow>,
}

impl Default for SubtitleRenderOptions {
    fn default() -> Self {
        Self {
            speakers: true,
            ass: AssStyleSheet::legacy(),
            json_header: Value::Null,
            window: None,
        }
    }
}

#[cfg(test)]
fn render_subtitles(
    doc: &TranscriptDoc,
    cues: &[Cue],
    sentences: &[Sentence],
    stream: &[TransCue],
    mode: ExportMode,
    target_lang: Option<&str>,
    project_punctuation: bool,
    flavor: SubtitleFlavor,
    missing_translations: &mut usize,
) -> String {
    let events = build_subtitle_events(
        doc,
        cues,
        sentences,
        stream,
        mode,
        target_lang,
        project_punctuation,
        missing_translations,
    );
    render_subtitle_events(doc, &events, flavor, &SubtitleRenderOptions::default())
}

pub fn build_subtitle_events(
    doc: &TranscriptDoc,
    cues: &[Cue],
    sentences: &[Sentence],
    stream: &[TransCue],
    mode: ExportMode,
    target_lang: Option<&str>,
    project_punctuation: bool,
    missing_translations: &mut usize,
) -> Vec<SubtitleEvent> {
    let mut events = Vec::new();
    if mode == ExportMode::Original {
        for cue in cues {
            events.push((
                cue.start,
                cue.end,
                cue.sp.clone(),
                subtitle_delivery_text(&cue.text(doc), &doc.lang, project_punctuation),
            ));
        }
    } else {
        let mut by_sentence: std::collections::BTreeMap<&str, Vec<&TransCue>> =
            std::collections::BTreeMap::new();
        for trans_cue in stream {
            by_sentence
                .entry(trans_cue.sentence_id.as_str())
                .or_default()
                .push(trans_cue);
        }
        for sentence in sentences {
            let Some(pieces) = by_sentence.get(sentence.id.as_str()) else {
                // 缺译句一律不回退原文，与画面链路（MP4 烧录/预览）同口径：
                // 译文模式整句留空——sidecar 里就是不产出该条事件，序号顺延；
                // 双语模式只是没有译文行，原文行照常输出。
                *missing_translations += 1;
                if mode == ExportMode::Bilingual {
                    for &cue_index in &sentence.cue_indices {
                        let cue = &cues[cue_index];
                        events.push((
                            cue.start,
                            cue.end,
                            cue.sp.clone(),
                            subtitle_delivery_text(&cue.text(doc), &doc.lang, project_punctuation),
                        ));
                    }
                }
                continue;
            };
            match mode {
                ExportMode::Translated => {
                    // 译文自成 Cue 流(independent 的行边界即译文自己的行)。
                    let sp = cues[sentence.cue_indices[0]].sp.clone();
                    for piece in pieces {
                        events.push((
                            piece.start,
                            piece.end,
                            sp.clone(),
                            subtitle_delivery_text(
                                &piece.text,
                                target_lang.unwrap_or_default(),
                                project_punctuation,
                            ),
                        ));
                    }
                }
                ExportMode::Bilingual => {
                    // 源字幕 Cue 与翻译 Cue 是两条独立时间流；双语导出只在最终
                    // 展示阶段取两者边界并集，不让源 Cue 反向决定译文切分。
                    events.extend(union_events(
                        doc,
                        cues,
                        sentence,
                        pieces,
                        target_lang.unwrap_or_default(),
                        project_punctuation,
                    ));
                }
                ExportMode::Original => unreachable!(),
            }
        }
    }
    events.retain(|(_, _, _, body)| !body.trim().is_empty());
    events
}

pub fn render_subtitle_events(
    doc: &TranscriptDoc,
    events: &[SubtitleEvent],
    flavor: SubtitleFlavor,
    options: &SubtitleRenderOptions,
) -> String {
    let mut output = match flavor {
        SubtitleFlavor::Srt => String::new(),
        SubtitleFlavor::Vtt => String::from("WEBVTT\n\n"),
        // 头由调用方合成：默认来自工程样式（v2 `studio_export::ass_style_sheet`），
        // `--no-style` 退回 VoiceInk 时代的固定头。事件投影仍是三种格式共用的。
        SubtitleFlavor::Ass => options.ass.header.clone(),
        SubtitleFlavor::JsonWords => {
            unreachable!("json-words 带逐词时间，由 render_json_words 渲染")
        }
    };
    for (index, (start, end, sp, body)) in events.iter().enumerate() {
        match flavor {
            SubtitleFlavor::Srt => {
                output.push_str(&(index + 1).to_string());
                output.push('\n');
                output.push_str(&format!(
                    "{} --> {}\n",
                    subtitle_time(*start, ','),
                    subtitle_time(*end, ',')
                ));
                if options.speakers {
                    output.push_str(&speaker_prefix(doc, sp, flavor));
                }
                output.push_str(body);
                output.push_str("\n\n");
            }
            SubtitleFlavor::Vtt => {
                output.push_str(&format!(
                    "{} --> {}\n",
                    subtitle_time(*start, '.'),
                    subtitle_time(*end, '.')
                ));
                if options.speakers {
                    output.push_str(&speaker_prefix(doc, sp, flavor));
                }
                output.push_str(body);
                output.push_str("\n\n");
            }
            SubtitleFlavor::Ass => {
                let speaker = if !options.speakers || doc.speakers.len() < 2 {
                    String::new()
                } else {
                    doc.speakers
                        .get(sp)
                        .map_or_else(|| sp.to_owned(), |speaker| speaker.name.clone())
                        .replace(',', "，")
                        .replace(['\r', '\n'], " ")
                };
                output.push_str(&format!(
                    "Dialogue: 0,{},{},{},{speaker},0,0,0,,{}\n",
                    ass_time(*start),
                    ass_time(*end),
                    ASS_PRIMARY_STYLE,
                    ass_dialogue_text(body, options.ass.translation_style.as_deref())
                ));
            }
            SubtitleFlavor::JsonWords => unreachable!("已在函数开头分流"),
        }
    }
    output
}

/// `--no-cuts`：跳过剪辑时间线投影，直接按 `transcript.json` 的原始源时间输出。
///
/// 只读主 transcript。多素材工程的每条 source 都有自己从 0 开始的源时间轴，放在
/// 同一个字幕文件里必然互相重叠，所以副素材一律跳过并由调用方给出警告——这正是
/// 「原始源时间」这个语义本身的边界，不是实现偷懒。
pub fn render_source_subtitles(
    doc: &TranscriptDoc,
    cues: &[Cue],
    sentences: &[Sentence],
    mode: ExportMode,
    target_lang: Option<&str>,
    project_punctuation: bool,
    flavor: SubtitleFlavor,
    options: &SubtitleRenderOptions,
    missing_translations: &mut usize,
) -> (String, usize, usize) {
    let selected_sentences = options.window.map(|window| {
        sentences
            .iter()
            .filter(|sentence| {
                sentence
                    .cue_indices
                    .iter()
                    .any(|&index| window.overlaps(cues[index].start, cues[index].end))
            })
            .cloned()
            .collect::<Vec<_>>()
    });
    let sentences = selected_sentences.as_deref().unwrap_or(sentences);
    let stream = target_lang
        .map(|lang| derive_trans_cues(doc, sentences, lang))
        .unwrap_or_default();
    let mut events = build_subtitle_events(
        doc,
        cues,
        sentences,
        &stream,
        mode,
        target_lang,
        project_punctuation,
        missing_translations,
    );
    let mut words = if flavor == SubtitleFlavor::JsonWords || options.window.is_some() {
        source_timed_words(doc)
    } else {
        Vec::new()
    };
    let mut word_count = doc.words.len();
    if let Some(window) = options.window {
        window.apply(&mut events, &mut words);
        word_count = words.len();
    }
    let count = events.len();
    let rendered = if flavor == SubtitleFlavor::JsonWords {
        render_json_words(doc, &events, &mut words, "source", options)
    } else {
        render_subtitle_events(doc, &events, flavor, options)
    };
    (rendered, count, word_count)
}

pub fn ass_time(seconds: f64) -> String {
    let total_centis = (seconds.max(0.0) * 100.0).round() as u64;
    let centis = total_centis % 100;
    let total_seconds = total_centis / 100;
    let seconds = total_seconds % 60;
    let total_minutes = total_seconds / 60;
    let minutes = total_minutes % 60;
    let hours = total_minutes / 60;
    format!("{hours}:{minutes:02}:{seconds:02}.{centis:02}")
}

/// 一条 Dialogue 的正文。
///
/// 双语正文永远是「原文行 + `\n` + 译文行」（见 `join_subtitle_lines`），译文行
/// 用行内 `{\r<样式名>}` 切到译文样式。两个样式共享 Alignment/Margin，所以行内
/// 切换不会挪动这一条事件的位置。
///
/// 只有正文真的有换行时才插入切换标签：单行事件（双语模式下整句缺译只剩原文行、或某个
/// 并集区间只落到一侧）保持主样式。已知近似：双语模式下「只有译文没有原文」的单行
/// 事件会按原文样式渲染。
fn ass_dialogue_text(body: &str, translation_style: Option<&str>) -> String {
    let escaped = ass_text(body);
    let Some(style) = translation_style else {
        return escaped;
    };
    escaped
        .split_once("\\N")
        .map_or(escaped.clone(), |(first, rest)| {
            format!("{first}\\N{{\\r{style}}}{rest}")
        })
}

fn ass_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace("\r\n", "\\N")
        .replace(['\r', '\n'], "\\N")
        .replace('{', "\\{")
        .replace('}', "\\}")
}

pub fn subtitle_time(seconds: f64, separator: char) -> String {
    let total_millis = (seconds.max(0.0) * 1_000.0).round() as u64;
    let millis = total_millis % 1_000;
    let total_seconds = total_millis / 1_000;
    let seconds = total_seconds % 60;
    let total_minutes = total_seconds / 60;
    let minutes = total_minutes % 60;
    let hours = total_minutes / 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}{separator}{millis:03}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::build_doc;
    use crate::cue::CueParams;

    fn word_doc() -> TranscriptDoc {
        let mut row_a = RowIn::new(1.23, 5.0, "hello there");
        row_a.speaker = Some("S01".to_owned());
        let mut row_b = RowIn::new(6.0, 65.5, "goodbye now");
        row_b.speaker = Some("S02".to_owned());
        build_doc(
            &[row_a, row_b],
            DocMedia {
                id: None,
                path: Some("sample.wav".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 65.5,
                sample_rate: Some(16_000),
            },
            "en",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        )
    }

    #[test]
    fn subtitle_renderers_use_required_time_separators() {
        assert_eq!(
            join_subtitle_lines([String::new(), "译文".to_owned()]),
            "译文"
        );
        assert_eq!(subtitle_delivery_text("，，。", "zh", true), "");
        assert_eq!(
            subtitle_delivery_text("Hello, world.", "en", true),
            "Hello world"
        );
        let doc = word_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let mut missing = 0;
        let srt = render_subtitles(
            &doc,
            &cues,
            &sentences,
            &[],
            ExportMode::Original,
            None,
            true,
            SubtitleFlavor::Srt,
            &mut missing,
        );
        assert!(srt.contains("00:00:01,230 -->"));
        assert!(srt.contains("[S01] hello there"));
        let vtt = render_subtitles(
            &doc,
            &cues,
            &sentences,
            &[],
            ExportMode::Original,
            None,
            true,
            SubtitleFlavor::Vtt,
            &mut missing,
        );
        assert!(vtt.starts_with("WEBVTT\n\n"));
        assert!(vtt.contains("00:00:01.230 -->"));
        assert!(vtt.contains("<v S02>goodbye now"));
        let ass = render_subtitles(
            &doc,
            &cues,
            &sentences,
            &[],
            ExportMode::Original,
            None,
            true,
            SubtitleFlavor::Ass,
            &mut missing,
        );
        assert!(ass.starts_with("[Script Info]\nTitle: BaoCut\nScriptType: v4.00+"));
        assert!(ass.contains("Dialogue: 0,0:00:01.23,0:00:05.00,BaoCut,S01,0,0,0,,hello there"));
        assert_eq!(ass_text("one\ntwo {x} \\"), "one\\Ntwo \\{x\\} \\\\");
        assert_eq!(missing, 0);
    }

    #[test]
    fn bilingual_mode_stacks_original_and_translation() {
        let mut doc = word_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 2);
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentences[0].id.clone(), "你好".to_owned());
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        let mut missing = 0;
        let bilingual = render_subtitles(
            &doc,
            &cues,
            &sentences,
            &stream,
            ExportMode::Bilingual,
            Some("zh"),
            true,
            SubtitleFlavor::Srt,
            &mut missing,
        );
        assert!(bilingual.contains("hello there\n你好"));
        // 双语语义不变：缺译句只是没有译文行，原文行照常输出。
        assert!(bilingual.contains("goodbye now"), "{bilingual}");
        assert_eq!(missing, 1); // 第二句没有译文
        let mut missing = 0;
        let translated = render_subtitles(
            &doc,
            &cues,
            &sentences,
            &stream,
            ExportMode::Translated,
            Some("zh"),
            true,
            SubtitleFlavor::Srt,
            &mut missing,
        );
        assert!(translated.contains("你好"));
        // 译文模式缺译句留空 = 根本不产出这条事件，绝不回退原文；序号顺延。
        assert!(!translated.contains("goodbye now"), "{translated}");
        assert!(!translated.contains("\n2\n"), "{translated}");
        assert_eq!(missing, 1); // 计数不受留空影响
    }

    /// 缺译句在 vtt/ass 里同样是「这条不存在」，而不是空文本条目。
    #[test]
    fn translated_mode_drops_untranslated_sentences_from_every_flavor() {
        let mut doc = word_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentences[0].id.clone(), "你好".to_owned());
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        for flavor in [SubtitleFlavor::Vtt, SubtitleFlavor::Ass] {
            let mut missing = 0;
            let rendered = render_subtitles(
                &doc,
                &cues,
                &sentences,
                &stream,
                ExportMode::Translated,
                Some("zh"),
                true,
                flavor,
                &mut missing,
            );
            assert!(rendered.contains("你好"), "{rendered}");
            assert!(!rendered.contains("goodbye now"), "{rendered}");
            assert_eq!(missing, 1);
            if flavor == SubtitleFlavor::Ass {
                // 只剩第一句那一条 Dialogue，缺译句连时间轴都不占。
                assert_eq!(rendered.matches("Dialogue:").count(), 1, "{rendered}");
            }
        }
    }

    /// ASS 双语是「一条 Dialogue 两行」，缺译时那条事件只剩原文一行：
    /// 正文里没有 `\N`，也就不该出现切到译文样式的 `{\r...}` 标签。
    #[test]
    fn ass_bilingual_missing_translation_stays_a_single_primary_line() {
        let mut doc = word_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentences[0].id.clone(), "你好".to_owned());
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        let mut missing = 0;
        let events = build_subtitle_events(
            &doc,
            &cues,
            &sentences,
            &stream,
            ExportMode::Bilingual,
            Some("zh"),
            true,
            &mut missing,
        );
        // v2 用 `studio_export::ass_style_sheet(&json!({}), "bi", …)` 合成双语头；它依赖字幕渲染
        // 内核，在 `subtitle-render` 的 `ass_style`（那里有这条测试的原样版本），本 crate 不依赖
        // 渲染，这里手建一份带译文样式的头，断言只看 Dialogue 行。
        let ass = AssStyleSheet {
            translation_style: Some(ASS_TRANSLATION_STYLE.to_owned()),
            ..AssStyleSheet::legacy()
        };
        let translation_style = ass.translation_style.clone();
        assert!(translation_style.is_some(), "双语头必须带译文样式");
        let rendered = render_subtitle_events(
            &doc,
            &events,
            SubtitleFlavor::Ass,
            &SubtitleRenderOptions {
                speakers: true,
                ass,
                ..SubtitleRenderOptions::default()
            },
        );
        assert_eq!(missing, 1);
        let dialogues: Vec<&str> = rendered
            .lines()
            .filter(|line| line.starts_with("Dialogue:"))
            .collect();
        assert_eq!(dialogues.len(), 2, "{rendered}");
        assert!(dialogues[0].contains("hello there\\N"), "{rendered}");
        // 缺译那条：单行原文，没有换行也没有译文样式切换。
        let missing_line = dialogues[1];
        assert!(missing_line.contains("goodbye now"), "{rendered}");
        assert!(!missing_line.contains("\\N"), "{rendered}");
        if let Some(style) = translation_style.as_deref() {
            assert!(!missing_line.contains(style), "{rendered}");
        }
    }

    #[test]
    fn bilingual_spanning_piece_repeats_across_its_cues() {
        use crate::doc::{AlignMode, TransAlign, TransPiece};
        // 一句两 Cue,单片跨两 Cue(整句上屏):译行在两条事件里重复。
        let mut row = RowIn::new(
            0.0,
            8.0,
            "alpha bravo charlie delta echo, foxtrot golf hotel.",
        );
        row.speaker = Some("S01".to_owned());
        let mut doc = build_doc(
            &[row],
            DocMedia {
                id: None,
                path: Some("sample.wav".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 10.0,
                sample_rate: Some(16_000),
            },
            "en",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        );
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        let sentences = derive_sentences(&doc, &cues);
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentences[0].id.clone(), "整句译文。".to_owned());
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            sentences[0].id.clone(),
            TransAlign {
                mode: AlignMode::ManyToOne,
                crossing: false,
                correspondence: None,
                text_basis: Default::default(),
                aligner: None,
                blocks: Vec::new(),
                cues: sentences[0].cue_ids.clone(),
                words: Vec::new(),
                pieces: vec![TransPiece {
                    from: Some(0),
                    to: Some(1),
                    text: "整句译文。".to_owned(),
                }],
            },
        );
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        let mut missing = 0;
        let bilingual = render_subtitles(
            &doc,
            &cues,
            &sentences,
            &stream,
            ExportMode::Bilingual,
            Some("zh"),
            true,
            SubtitleFlavor::Srt,
            &mut missing,
        );
        assert_eq!(bilingual.matches("整句译文").count(), 2, "{bilingual}");
        assert!(!bilingual.contains("整句译文。"), "{bilingual}");
        let literal = render_subtitles(
            &doc,
            &cues,
            &sentences,
            &stream,
            ExportMode::Bilingual,
            Some("zh"),
            false,
            SubtitleFlavor::Srt,
            &mut missing,
        );
        assert_eq!(literal.matches("整句译文。").count(), 2, "{literal}");
        assert_eq!(missing, 0);
    }

    #[test]
    fn bilingual_independent_uses_union_partition() {
        use crate::doc::{AlignMode, TransAlign, TransPiece};
        let mut row = RowIn::new(
            0.0,
            8.0,
            "alpha bravo charlie delta echo, foxtrot golf hotel.",
        );
        row.speaker = Some("S01".to_owned());
        let mut doc = build_doc(
            &[row],
            DocMedia {
                id: None,
                path: Some("sample.wav".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 10.0,
                sample_rate: Some(16_000),
            },
            "en",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        );
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        doc.trans.entry("zh".to_owned()).or_default().insert(
            sentences[0].id.clone(),
            "前半句译文，后半句译文。".to_owned(),
        );
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            sentences[0].id.clone(),
            TransAlign {
                mode: AlignMode::Independent,
                crossing: false,
                correspondence: None,
                text_basis: Default::default(),
                aligner: None,
                blocks: Vec::new(),
                cues: sentences[0].cue_ids.clone(),
                words: Vec::new(),
                pieces: vec![
                    TransPiece {
                        from: None,
                        to: None,
                        text: "前半句译文，".to_owned(),
                    },
                    TransPiece {
                        from: None,
                        to: None,
                        text: "后半句译文。".to_owned(),
                    },
                ],
            },
        );
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        let mut missing = 0;
        let bilingual = render_subtitles(
            &doc,
            &cues,
            &sentences,
            &stream,
            ExportMode::Bilingual,
            Some("zh"),
            true,
            SubtitleFlavor::Srt,
            &mut missing,
        );
        // 并集分段:每个事件都是 原文\n译文 两行;边界并集 ≥ 源 Cue 数。
        assert!(bilingual.contains("\n前半句译文\n"), "{bilingual}");
        assert!(bilingual.contains("\n后半句译文\n"), "{bilingual}");
        assert_eq!(missing, 0);
        // 译文单语导出:行 = 译片自己的边界。
        let mut missing = 0;
        let translated = render_subtitles(
            &doc,
            &cues,
            &sentences,
            &stream,
            ExportMode::Translated,
            Some("zh"),
            true,
            SubtitleFlavor::Srt,
            &mut missing,
        );
        assert!(translated.contains("前半句译文\n\n"), "{translated}");
    }
}
