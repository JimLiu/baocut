//! TTS 合成前的注音（多音字读音），移植自 v2 `bcut-tts::text::readings` 与 `bcut-tts::engine` 的注音包装层。
//!
//! 架构设计 §6.1：读音标注是输入文本的一部分，由适配器转成各模型自己的写法；模型不支持时如实报告，不静默丢弃。
//!
//! - 语法 `<表面|读音>` 的解析 / 去注记 / 原样拼回在 [`syntax`]，这里整体转出；
//! - [`annotate`]：词典判定——词组表（mmseg 最长匹配）定下的读音记成 [`Origin::Phrase`] 注记，
//!   剩下的语境多音字单字列成 [`Candidate`]；
//! - [`parse_for_engine`]：引擎包装层用的解析，把与词组表一致的多字注记认回 [`Origin::Phrase`]；
//! - [`render`]：按引擎的 [`ReadingsSupport`] 把注记渲染成它能吃的文字，渲染不了的进 `dropped`（软失败）；
//! - [`Annotating`]：[`crate::synthesize::load`] 给每只引擎套的包装层，注音的唯一解析点。
//!
//! 数据在 `readings/data/`（来源、许可与 SHA-256 见 `readings/data/README.md`）；词组表与单字默认读音复用
//! GPT-SoVITS 前端内嵌的 pypinyin 表。

pub mod syntax;

pub use syntax::{Annotated, Candidate, Origin, Reading, has_readings, parse, strip};

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::LazyLock;

use anyhow::Result;

use super::gpt_sovits::text::pinyin;
use super::types::{TtsAudio, TtsEngineKind, TtsRequest};
use super::{ProgressSink, TtsEngine};

/// IndexTTS2 渲染出的拼音片用这对私用区字符包住，`normalizer.rs` 据此在数字规范化前把它护住、
/// 之后还原成两侧带空格的片（不会被当成数字读出来，也不会与相邻拉丁字母粘成一个词）。
pub const PIECE_OPEN: char = '\u{E000}';
pub const PIECE_CLOSE: char = '\u{E001}';

/// 引擎渲染后的文字与没能按注记念的部分。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Rendered {
    pub text: String,
    /// 没按注记念的（引擎不认、词表没有这个片、没有代表字）；句子照常合成。
    pub dropped: Vec<Reading>,
}

/// 一只引擎怎么吃读音：能力值与 [`TtsEngineKind::readings_support`] 住在 [`super::types`]。
pub use super::types::ReadingsSupport;

/// 按渲染方式把注记渲染成引擎要的文字。`pinyin_pieces` 是 IndexTTS2 词表里的拼音片集合
/// （大写、无 `▁`），只有 [`ReadingsSupport::InlinePinyin`] 读它；给 `None` 时那一类全部 drop。
pub fn render(support: ReadingsSupport, annotated: &Annotated, pinyin_pieces: Option<&HashSet<String>>) -> Rendered {
    match support {
        ReadingsSupport::Annotated => Rendered {
            text: annotated.to_text(),
            dropped: Vec::new(),
        },
        ReadingsSupport::InlinePinyin => render_inline_pinyin(annotated, pinyin_pieces),
        ReadingsSupport::Homophone => render_homophone(annotated),
        ReadingsSupport::Unsupported => render_unsupported(annotated),
    }
}

/// 不认读音的引擎：表面文字，注记全部 drop（词组读音除外：引擎按自己的词组表念，不算没念，见 [`Origin::Phrase`]）。
pub fn render_unsupported(annotated: &Annotated) -> Rendered {
    let mut out = render_per_char(annotated, |_, _, _| CharRender::Keep);
    out.dropped = annotated.readings.iter().filter(|r| r.origin != Origin::Phrase).cloned().collect();
    out
}

/// 引擎包装层的解析：[`parse`] 之后把「多字注记、读音与词组表完全一致」的认回 [`Origin::Phrase`]。
/// 注记只住在文字里、来源不随文字走（`to_text` 之后都成了手写）；这一步让 [`annotate`]
/// 补的词组注记与手写的同款注记一样，在 Qwen3 上不被换成别字、在不认读音的引擎上不报 dropped。
pub fn parse_for_engine(text: &str) -> Annotated {
    let mut annotated = parse(text);
    if annotated.readings.iter().any(|r| r.end - r.start >= 2) {
        let chars: Vec<char> = annotated.surface.chars().collect();
        for r in &mut annotated.readings {
            if r.end - r.start >= 2 && phrase_reading(&chars[r.start..r.end]).is_some_and(|p| p == r.reading) {
                r.origin = Origin::Phrase;
            }
        }
    }
    annotated
}

/// 一整段汉字恰好是词组表里的一个词时，它的读音（TONE3，空格分）。
fn phrase_reading(span: &[char]) -> Option<String> {
    if !span.iter().all(|&c| is_han(c)) {
        return None;
    }
    let run: String = span.iter().collect();
    match pinyin::segments(&run).as_slice() {
        [(piece, Some(ids))] if *piece == run => Some(ids.iter().map(|&id| pinyin::tone3(id)).collect::<Vec<_>>().join(" ")),
        _ => None,
    }
}

/// 畸形注记在表面文字里是字面 `<表面|读音>`；不吃这个语法的引擎只该念到表面那几个字。
/// 返回表面文字里要跳过的位置（`<`、`|读音>`）。
fn malformed_brackets(annotated: &Annotated, len: usize) -> Vec<bool> {
    let mut skip = vec![false; len];
    for m in &annotated.malformed {
        let tail = m.end + 2 + m.reading.chars().count();
        if m.start >= 1 && tail <= len {
            skip[m.start - 1] = true;
            skip[m.end..tail].fill(true);
        }
    }
    skip
}

enum CharRender {
    /// 原字照送（这个字本来只有这一个读音）。
    Keep,
    Replace(String),
    Drop,
}

/// 逐字渲染：注记里的每个字配它的音节，由 `decide` 决定换成什么；drop 按字记。
/// 畸形注记只留表面那几个字（括号与读音不送给引擎）。
fn render_per_char(annotated: &Annotated, mut decide: impl FnMut(char, &str, Origin) -> CharRender) -> Rendered {
    let mut out = Rendered::default();
    let mut readings = annotated.readings.iter().peekable();
    let mut current: Option<(&Reading, Vec<&str>)> = None;
    let skip = malformed_brackets(annotated, annotated.surface.chars().count());
    for (index, c) in annotated.surface.chars().enumerate() {
        if skip[index] {
            continue;
        }
        if current.as_ref().is_some_and(|(r, _)| index >= r.end) {
            current = None;
        }
        if current.is_none()
            && let Some(reading) = readings.next_if(|r| r.start == index)
        {
            current = Some((reading, reading.syllables().collect()));
        }
        let Some((reading, syllables)) = current.as_ref() else {
            out.text.push(c);
            continue;
        };
        let syllable = syllables[index - reading.start];
        match decide(c, syllable, reading.origin) {
            CharRender::Keep => out.text.push(c),
            CharRender::Replace(text) => out.text.push_str(&text),
            CharRender::Drop => {
                out.text.push(c);
                out.dropped.push(Reading {
                    start: index,
                    end: index + 1,
                    reading: syllable.to_owned(),
                    origin: reading.origin,
                });
            }
        }
    }
    out
}

fn is_han(c: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&c)
}

/// 这个字本来就只有这一个读音，注记对它是空操作。
fn only_reading_is(c: char, syllable: &str) -> bool {
    !HETERONYMS.contains_key(&c) && pinyin::default_syllable(c).is_some_and(|id| pinyin::tone3(id) == syllable)
}

/// IndexTTS2：字 → 大写拼音片（`XING2`，ü 写 `V`），只在词表有这个片时换。
pub fn render_inline_pinyin(annotated: &Annotated, pinyin_pieces: Option<&HashSet<String>>) -> Rendered {
    render_per_char(annotated, |c, syllable, origin| {
        if !is_han(c) {
            return CharRender::Drop;
        }
        if only_reading_is(c, syllable) {
            return CharRender::Keep;
        }
        let piece = inline_pinyin_piece(syllable);
        match pinyin_pieces {
            Some(pieces) if pieces.contains(&piece) => CharRender::Replace(format!("{PIECE_OPEN}{piece}{PIECE_CLOSE}")),
            // 词组读音没有片：原字照送、引擎按自己的词组切分念，不算没念。
            _ if origin == Origin::Phrase => CharRender::Keep,
            _ => CharRender::Drop,
        }
    })
}

/// 读音 → IndexTTS2 词表里的片名：大写；j / q / x 后的 ü 词表写 `V`（`JV4`、`XVE2`，没有 `JU4`），
/// y 后照 TONE3 写 `U`（`YU2`）。
fn inline_pinyin_piece(syllable: &str) -> String {
    let mut piece = syllable.to_ascii_uppercase();
    if matches!(piece.as_bytes(), [b'J' | b'Q' | b'X', b'U', ..]) {
        piece.replace_range(1..2, "V");
    }
    piece
}

/// Qwen3-TTS：字 → 同读音代表字；词组表来源的注记不换也不报。
pub fn render_homophone(annotated: &Annotated) -> Rendered {
    render_per_char(annotated, |c, syllable, origin| {
        if origin == Origin::Phrase {
            return CharRender::Keep;
        }
        if !is_han(c) {
            return CharRender::Drop;
        }
        if only_reading_is(c, syllable) {
            return CharRender::Keep;
        }
        match HOMOPHONES.get(syllable) {
            Some(&rep) => CharRender::Replace(rep.to_string()),
            None => CharRender::Drop,
        }
    })
}

/// 一个字的全部读音（默认读音在前）；非多音字给它唯一的读音，没有读音给空。
pub fn readings_of(c: char) -> Vec<String> {
    match HETERONYMS.get(&c) {
        Some(entry) => entry.all.clone(),
        None => pinyin::default_syllable(c).map(|id| vec![pinyin::tone3(id)]).unwrap_or_default(),
    }
}

/// 是不是精选的语境多音字（`readings/data/context_heteronyms.txt`）。
pub fn is_context_heteronym(c: char) -> bool {
    CONTEXT.contains(&c)
}

/// [`annotate`] 的选项。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AnnotateOptions {
    /// 候选单字也按词典默认读音写成 [`Origin::Dict`] 注记。v2 CLI 的自动注音不开（只列候选），
    /// 有人审阅或 LLM 收尾的宿主再决定。
    pub dict_readings: bool,
}

/// 词典判定：手写注记原样保留；其余汉字按词组表（mmseg 最长匹配）切分，
/// 词组读音把某个语境多音字定到**非默认**读音时（`银行` → `hang2`），整词记一条 `Phrase` 注记；
/// 词组没盖住的语境多音字单字列进 `candidates`。
pub fn annotate(text: &str, options: AnnotateOptions) -> Annotated {
    let mut annotated = parse(text);
    let chars: Vec<char> = annotated.surface.chars().collect();
    let mut covered = vec![false; chars.len()];
    for r in annotated.readings.iter().chain(&annotated.malformed) {
        covered[r.start..r.end.min(chars.len())].fill(true);
    }
    let mut added = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if covered[index] || !is_han(chars[index]) {
            index += 1;
            continue;
        }
        let start = index;
        while index < chars.len() && !covered[index] && is_han(chars[index]) {
            index += 1;
        }
        let run: String = chars[start..index].iter().collect();
        let mut offset = start;
        for (piece, ids) in pinyin::segments(&run) {
            let piece_chars: Vec<char> = piece.chars().collect();
            let len = piece_chars.len();
            if len >= 2 {
                if let Some(ids) = ids
                    && piece_chars
                        .iter()
                        .zip(ids)
                        .any(|(&c, &id)| is_context_heteronym(c) && pinyin::default_syllable(c) != Some(id))
                {
                    added.push(Reading {
                        start: offset,
                        end: offset + len,
                        reading: ids.iter().map(|&id| pinyin::tone3(id)).collect::<Vec<_>>().join(" "),
                        origin: Origin::Phrase,
                    });
                }
            } else if let Some(&c) = piece_chars.first()
                && is_context_heteronym(c)
                && let Some(entry) = HETERONYMS.get(&c)
            {
                annotated.candidates.push(Candidate {
                    start: offset,
                    end: offset + 1,
                    default: entry.default.clone(),
                    readings: entry.all.clone(),
                });
                if options.dict_readings {
                    added.push(Reading {
                        start: offset,
                        end: offset + 1,
                        reading: entry.default.clone(),
                        origin: Origin::Dict,
                    });
                }
            }
            offset += len;
        }
    }
    annotated.readings.extend(added);
    annotated.readings.sort_by_key(|r| r.start);
    annotated
}

// ---------------------------------------------------------------- 包装层

/// [`crate::synthesize::load`] 返回的包装层：注音的唯一解析点，每只引擎都经它合成。没有注记时原样透传；
/// 有注记时向内层要渲染结果（[`TtsEngine::render_readings`]），把渲染后的文字换进请求副本再合成，
/// 没能按注记念的读音写进 [`TtsAudio::readings_dropped`]——不认读音的引擎在这里如实报告，不静默丢弃。
pub struct Annotating {
    inner: Box<dyn TtsEngine>,
}

impl Annotating {
    pub fn new(inner: Box<dyn TtsEngine>) -> Self {
        Self { inner }
    }
}

impl TtsEngine for Annotating {
    fn kind(&self) -> TtsEngineKind {
        self.inner.kind()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn preset_speakers(&self) -> Vec<String> {
        self.inner.preset_speakers()
    }

    fn render_readings(&self, annotated: &Annotated) -> Rendered {
        self.inner.render_readings(annotated)
    }

    fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio> {
        if !request.text.contains('<') {
            return self.inner.synthesize(request, progress);
        }
        let annotated = parse_for_engine(&request.text);
        if annotated.is_plain() {
            return self.inner.synthesize(request, progress);
        }
        let rendered = self.inner.render_readings(&annotated);
        let mut rendered_request = request.clone();
        rendered_request.text = rendered.text;
        let mut audio = self.inner.synthesize(&rendered_request, progress)?;
        let mut dropped = annotated.malformed;
        dropped.extend(rendered.dropped);
        dropped.sort_by_key(|r| r.start);
        audio.readings_dropped = dropped;
        Ok(audio)
    }
}

// ---------------------------------------------------------------- 内嵌表

struct Heteronym {
    default: String,
    all: Vec<String>,
}

fn inflate_text(bytes: &[u8]) -> String {
    let mut out = String::new();
    flate2::read::ZlibDecoder::new(bytes)
        .read_to_string(&mut out)
        .expect("注音内嵌数据解压失败");
    out
}

static HETERONYMS: LazyLock<HashMap<char, Heteronym>> = LazyLock::new(|| {
    inflate_text(include_bytes!("readings/data/heteronyms.txt.z"))
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let c = parts.next()?.chars().next()?;
            let default = parts.next()?.to_owned();
            let all = parts.next()?.split(' ').map(str::to_owned).collect();
            Some((c, Heteronym { default, all }))
        })
        .collect()
});

static HOMOPHONES: LazyLock<HashMap<String, char>> = LazyLock::new(|| {
    inflate_text(include_bytes!("readings/data/homophones.txt.z"))
        .lines()
        .filter_map(|line| {
            let (reading, c) = line.split_once('\t')?;
            Some((reading.to_owned(), c.chars().next()?))
        })
        .collect()
});

static CONTEXT: LazyLock<HashSet<char>> = LazyLock::new(|| {
    include_str!("readings/data/context_heteronyms.txt")
        .lines()
        .flat_map(|line| line.split('#').next().unwrap_or("").split_whitespace())
        .filter_map(|word| word.chars().next())
        .collect()
});

#[cfg(test)]
mod tests;
