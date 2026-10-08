//! `bcut transcribe --script` 的文稿读取：纯文本 / LRC / SRT·VTT / JSON 四种形状，
//! 以及「每行落在音频哪一段」的时间窗推导。
//!
//! 纯函数、不做 I/O：调用方读文件、按扩展名给格式提示、拿到行再去对齐。
//!
//! - **纯文本**：按行切，行内再按句末标点切（见 [`split_plain`]）；整行是 `[Chorus]`
//!   这类方括号标记的行是段落标签、不是唱词，丢掉。
//! - **LRC**：`[mm:ss.xx]` 行时间；同一行多个时间标签（副歌复用）各算一行；
//!   `[offset:±ms]` 生效；只有时间标签的空行是上一行的终点；增强 LRC 的
//!   `<mm:ss.xx>` 词标签给出逐词时间。
//! - **SRT / WebVTT**：cue 的起止就是行窗，多行正文并成一行，`<i>` / `{\an8}`
//!   一类标签剥掉。
//! - **JSON**：顶层数组，或 `lines` / `segments` / `cues` 数组；每项是字符串（无时间）
//!   或 `{text, start, end, words?}`（`t0`/`t1` 同义，词的文本键 `text` 或 `word`）。
//!
//! 行窗由 [`resolve_windows`] 补齐：有起点没终点的接下一行起点，连续没时间的行按
//! 字数均分前后两个已知时刻之间的空档。没有任何时间的纯文本可以借一份已有转录
//! 的词做锚点（[`anchor_windows`]）：按词序 LCS 把文稿词对到转录词上，每行取对上
//! 的那几处时间。

use std::collections::HashMap;

use serde_json::Value;

use crate::atomize::{is_cjk_char, unspaced_pair};
use crate::lcs::{LCS_CELL_CAP, lcs_matches};

/// 文稿格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptFormat {
    Text,
    Lrc,
    Srt,
    Json,
}

impl ScriptFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Lrc => "lrc",
            Self::Srt => "srt",
            Self::Json => "json",
        }
    }

    /// 按扩展名判格式；认不出的扩展名返回 `None`，交给 [`detect`] 嗅探。
    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension.to_ascii_lowercase().as_str() {
            "lrc" => Some(Self::Lrc),
            "srt" | "vtt" => Some(Self::Srt),
            "json" => Some(Self::Json),
            "txt" | "md" => Some(Self::Text),
            _ => None,
        }
    }
}

/// 带时间的词（秒）。
#[derive(Debug, Clone, PartialEq)]
pub struct TimedWord {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// 一行文稿：文本，可选的行窗，可选的逐词时间。
#[derive(Debug, Clone, PartialEq)]
pub struct ScriptLine {
    pub text: String,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub words: Option<Vec<TimedWord>>,
}

impl ScriptLine {
    fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            start: None,
            end: None,
            words: None,
        }
    }
}

/// 扩展名优先；认不出就看内容：像 JSON 就是 JSON，有 `-->` 的是 SRT / VTT，
/// 有 `[mm:ss` 行首标签的是 LRC，其余按纯文本。
pub fn detect(text: &str, extension: Option<&str>) -> ScriptFormat {
    if let Some(format) = extension.and_then(ScriptFormat::from_extension) {
        return format;
    }
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && serde_json::from_str::<Value>(trimmed).is_ok()
    {
        return ScriptFormat::Json;
    }
    if text.lines().any(|line| line.contains("-->")) {
        return ScriptFormat::Srt;
    }
    if text
        .lines()
        .any(|line| parse_lrc_time_tag(line.trim_start()).is_some())
    {
        return ScriptFormat::Lrc;
    }
    ScriptFormat::Text
}

/// 按格式解析成行。空文稿返回空 `Vec`（由调用方报错），格式本身坏了返回 `Err`。
pub fn parse(text: &str, format: ScriptFormat) -> Result<Vec<ScriptLine>, String> {
    let text = text.trim_start_matches('\u{feff}');
    match format {
        ScriptFormat::Text => Ok(split_plain(text)
            .into_iter()
            .map(ScriptLine::plain)
            .collect()),
        ScriptFormat::Lrc => Ok(parse_lrc(text)),
        ScriptFormat::Srt => Ok(parse_srt(text)),
        ScriptFormat::Json => parse_json(text),
    }
}

/// 看起来像歌词 / 诗行的文稿至少这么多行……
const VERSE_MIN_LINES: usize = 4;
/// ……且至少 4/5 的行不宽于这个显示宽度（CJK 记 2）：这时一行就是一段，不再按句末切。
const VERSE_LINE_WIDTH: usize = 60;

/// 文稿 → 行：按换行切，行内再按句末标点切（ASCII 的 `. ! ? ;` 只在后面是空白 /
/// 行尾时算句末，`3.5` 不切；`Dr. Li` 这类缩写会切，只影响行边界不影响词）。空行
/// 与整行方括号标记（`[Chorus]`、`[Verse 1]`）丢弃。整篇都是短行（歌词、诗）时
/// 行内不切：`What did Ilya see? We'll never know.` 是一行歌词，不是两句台词。
pub fn split_plain(text: &str) -> Vec<String> {
    let raw_lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !is_section_tag(line))
        .collect();
    let short = raw_lines
        .iter()
        .filter(|line| display_width(line) <= VERSE_LINE_WIDTH)
        .count();
    if raw_lines.len() >= VERSE_MIN_LINES && short * 5 >= raw_lines.len() * 4 {
        return raw_lines.into_iter().map(str::to_owned).collect();
    }
    let mut lines = Vec::new();
    for line in raw_lines {
        let chars: Vec<char> = line.chars().collect();
        let mut current = String::new();
        for (index, ch) in chars.iter().enumerate() {
            current.push(*ch);
            let next_blank = chars.get(index + 1).is_none_or(|next| next.is_whitespace());
            let terminal = matches!(ch, '。' | '！' | '？' | '；')
                || (matches!(ch, '.' | '!' | '?' | ';') && next_blank);
            if terminal {
                let piece = current.trim();
                if !piece.is_empty() {
                    lines.push(piece.to_owned());
                }
                current.clear();
            }
        }
        let piece = current.trim();
        if !piece.is_empty() {
            lines.push(piece.to_owned());
        }
    }
    lines
}

fn display_width(line: &str) -> usize {
    line.chars()
        .map(|c| if is_cjk_char(c) { 2 } else { 1 })
        .sum()
}

/// 整行都在一对方括号里（歌词网站的段落标记）。
fn is_section_tag(line: &str) -> bool {
    line.starts_with('[') && line.ends_with(']') && line[1..line.len() - 1].find(']').is_none()
}

// ---------------------------------------------------------------- LRC

/// 行首 `[mm:ss]` / `[mm:ss.xx]` / `[mm:ss:xx]`：返回秒与标签后的剩余文本。
fn parse_lrc_time_tag(line: &str) -> Option<(f64, &str)> {
    let rest = line.strip_prefix('[')?;
    let close = rest.find(']')?;
    let seconds = parse_clock(&rest[..close])?;
    Some((seconds, &rest[close + 1..]))
}

/// `mm:ss(.xx)`，也收 `hh:mm:ss(.xx)` 与 `mm:ss:xx`（部分 LRC 编辑器写的小数分隔）。
fn parse_clock(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.is_empty()
        || !text
            .chars()
            .all(|c| c.is_ascii_digit() || c == ':' || c == '.')
    {
        return None;
    }
    let parts: Vec<&str> = text.split(':').collect();
    let number = |part: &str| part.parse::<f64>().ok().filter(|value| value.is_finite());
    match parts.as_slice() {
        [minutes, seconds] => Some(number(minutes)? * 60.0 + number(seconds)?),
        [a, b, c] if c.contains('.') || c.len() == 3 => {
            // hh:mm:ss(.xx)
            Some(number(a)? * 3600.0 + number(b)? * 60.0 + number(c)?)
        }
        [minutes, seconds, fraction] => {
            let digits = fraction.len() as i32;
            Some(
                number(minutes)? * 60.0 + number(seconds)? + number(fraction)? / 10f64.powi(digits),
            )
        }
        _ => None,
    }
}

struct LrcEntry {
    time: f64,
    text: String,
    words: Option<Vec<(f64, String)>>,
}

fn parse_lrc(text: &str) -> Vec<ScriptLine> {
    let mut offset = 0.0_f64;
    let mut entries: Vec<LrcEntry> = Vec::new();
    for raw in text.lines() {
        let mut rest = raw.trim();
        let mut times = Vec::new();
        loop {
            if let Some((time, after)) = parse_lrc_time_tag(rest) {
                times.push(time);
                rest = after.trim_start();
                continue;
            }
            // `[ti:…]` / `[offset:+120]` 这类元数据标签。
            if let Some(tag) = rest.strip_prefix('[')
                && let Some(close) = tag.find(']')
                && let Some((key, value)) = tag[..close].split_once(':')
                && key.chars().all(|c| c.is_ascii_alphabetic())
            {
                if key.eq_ignore_ascii_case("offset")
                    && let Ok(ms) = value.trim().parse::<f64>()
                {
                    offset = ms / 1000.0;
                }
                rest = tag[close + 1..].trim_start();
                continue;
            }
            break;
        }
        if times.is_empty() {
            continue;
        }
        let (line_text, words) = lrc_words(rest);
        for time in times {
            entries.push(LrcEntry {
                time,
                text: line_text.clone(),
                words: words.clone(),
            });
        }
    }
    // 稳定排序：同一时刻的两行保持文件里的先后。
    entries.sort_by(|a, b| a.time.total_cmp(&b.time));
    // LRC 规定正 offset 让歌词提前出现。
    let shift = |time: f64| round_ms((time - offset).max(0.0));
    let mut lines = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        if entry.text.is_empty() {
            continue;
        }
        let next = entries.get(index + 1).map(|next| shift(next.time));
        let start = shift(entry.time);
        let words = entry.words.as_ref().map(|words| {
            let mut timed = Vec::with_capacity(words.len());
            for (position, (time, text)) in words.iter().enumerate() {
                let start = shift(*time);
                let end = words
                    .get(position + 1)
                    .map(|(time, _)| shift(*time))
                    .or(next)
                    .unwrap_or(start)
                    .max(start);
                if !text.is_empty() {
                    timed.push(TimedWord {
                        start,
                        end,
                        text: text.clone(),
                    });
                }
            }
            timed
        });
        lines.push(ScriptLine {
            text: entry.text.clone(),
            start: Some(start),
            end: next.filter(|end| *end > start),
            words: words.filter(|words| !words.is_empty()),
        });
    }
    lines
}

/// 增强 LRC：`<00:12.30>I <00:12.60>see` → 行文本 + (词起点, 词)。最后一个只有标签
/// 没有字的 `<…>` 是末词的终点，以空词记下。没有词标签时 `words` 为 `None`。
fn lrc_words(text: &str) -> (String, Option<Vec<(f64, String)>>) {
    if !text.contains('<') {
        return (collapse_spaces(text), None);
    }
    let mut words = Vec::new();
    let mut plain = String::new();
    let mut rest = text;
    let mut current: Option<(f64, String)> = None;
    while let Some(open) = rest.find('<') {
        let before = &rest[..open];
        plain.push_str(before);
        if let Some((_, word)) = current.as_mut() {
            word.push_str(before);
        }
        let after = &rest[open + 1..];
        let Some(close) = after.find('>') else {
            plain.push_str(&rest[open..]);
            rest = "";
            break;
        };
        match parse_clock(&after[..close]) {
            Some(time) => {
                if let Some((start, word)) = current.take() {
                    words.push((start, word.trim().to_owned()));
                }
                current = Some((time, String::new()));
            }
            None => plain.push_str(&rest[open..open + 1 + close + 1]),
        }
        rest = &after[close + 1..];
    }
    plain.push_str(rest);
    if let Some((start, mut word)) = current.take() {
        word.push_str(rest);
        words.push((start, word.trim().to_owned()));
    }
    let text = collapse_spaces(&plain);
    if words.iter().all(|(_, word)| word.is_empty()) {
        return (text, None);
    }
    (text, Some(words))
}

// ---------------------------------------------------------------- SRT / VTT

fn parse_srt(text: &str) -> Vec<ScriptLine> {
    let mut lines = Vec::new();
    let mut block: Vec<&str> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            srt_block(&block, &mut lines);
            block.clear();
        } else {
            block.push(line);
        }
    }
    srt_block(&block, &mut lines);
    lines.sort_by(|a, b| a.start.unwrap_or(0.0).total_cmp(&b.start.unwrap_or(0.0)));
    lines
}

/// 一个空行分隔的块：有 `-->` 的那一行是时间，之后的行是正文；序号行、`WEBVTT`、
/// `NOTE` / `STYLE` 块没有时间行，整块跳过。
fn srt_block(block: &[&str], lines: &mut Vec<ScriptLine>) {
    let Some(position) = block.iter().position(|line| line.contains("-->")) else {
        return;
    };
    let (from, to) = block[position].split_once("-->").expect("contains -->");
    let start = parse_subtitle_clock(from);
    // VTT 的 cue 设置（`align:start` …）跟在终点后面。
    let end = parse_subtitle_clock(to.split_whitespace().next().unwrap_or(""));
    let body: Vec<String> = block[position + 1..]
        .iter()
        .map(|line| strip_markup(line))
        .filter(|line| !line.is_empty())
        .collect();
    let body = collapse_spaces(&body.join(" "));
    if let (Some(start), Some(end), false) = (start, end, body.is_empty()) {
        lines.push(ScriptLine {
            text: body,
            start: Some(round_ms(start)),
            end: Some(round_ms(end.max(start))),
            words: None,
        });
    }
}

/// `00:01:02,500` / `00:01:02.500` / `01:02.500`。
fn parse_subtitle_clock(text: &str) -> Option<f64> {
    let text = text.trim().replace(',', ".");
    let parts: Vec<&str> = text.split(':').collect();
    let number = |part: &str| part.trim().parse::<f64>().ok().filter(|v| v.is_finite());
    match parts.as_slice() {
        [h, m, s] => Some(number(h)? * 3600.0 + number(m)? * 60.0 + number(s)?),
        [m, s] => Some(number(m)? * 60.0 + number(s)?),
        _ => None,
    }
}

/// 剥 `<i>` / `<c.color>` / `<00:01.000>` 一类 HTML·VTT 标签与 `{\an8}` 一类 ASS 覆写。
fn strip_markup(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth_angle = false;
    let mut depth_brace = false;
    for ch in line.chars() {
        match ch {
            '<' => depth_angle = true,
            '>' if depth_angle => depth_angle = false,
            '{' if line.contains("{\\") => depth_brace = true,
            '}' if depth_brace => depth_brace = false,
            _ if depth_angle || depth_brace => {}
            _ => out.push(ch),
        }
    }
    out.trim().to_owned()
}

// ---------------------------------------------------------------- JSON

fn parse_json(text: &str) -> Result<Vec<ScriptLine>, String> {
    let value: Value =
        serde_json::from_str(text).map_err(|error| format!("JSON 文稿解析失败：{error}"))?;
    let items = match &value {
        Value::Array(items) => items,
        Value::Object(map) => ["lines", "segments", "cues"]
            .iter()
            .find_map(|key| map.get(*key).and_then(Value::as_array))
            .ok_or("JSON 文稿要么是数组，要么带 lines / segments / cues 数组")?,
        _ => return Err("JSON 文稿要么是数组，要么带 lines / segments / cues 数组".into()),
    };
    let mut lines = Vec::new();
    for (index, item) in items.iter().enumerate() {
        match item {
            Value::String(text) => {
                let text = collapse_spaces(text);
                if !text.is_empty() {
                    lines.push(ScriptLine::plain(text));
                }
            }
            Value::Object(map) => {
                let text = ["text", "line", "lyric"]
                    .iter()
                    .find_map(|key| map.get(*key).and_then(Value::as_str))
                    .map(collapse_spaces)
                    .unwrap_or_default();
                let words = map
                    .get("words")
                    .and_then(Value::as_array)
                    .and_then(|words| json_words(words));
                let text = if text.is_empty() {
                    words
                        .as_ref()
                        .map(|words| join_words(words.iter().map(|w| w.text.as_str())))
                        .unwrap_or_default()
                } else {
                    text
                };
                if text.is_empty() {
                    continue;
                }
                let start = seconds_of(map, &["start", "t0"]);
                let end = seconds_of(map, &["end", "t1"]);
                if let (Some(start), Some(end)) = (start, end)
                    && end < start
                {
                    return Err(format!("JSON 文稿第 {} 行终点早于起点", index + 1));
                }
                lines.push(ScriptLine {
                    text,
                    start: start.map(round_ms),
                    end: end.map(round_ms),
                    words,
                });
            }
            _ => {
                return Err(format!(
                    "JSON 文稿第 {} 项既不是字符串也不是对象",
                    index + 1
                ));
            }
        }
    }
    Ok(lines)
}

fn seconds_of(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| map.get(*key).and_then(Value::as_f64))
        .filter(|value| value.is_finite() && *value >= 0.0)
}

/// 词都得有起止才算数；缺一个就整行不要逐词时间（交给对齐器）。
fn json_words(words: &[Value]) -> Option<Vec<TimedWord>> {
    let mut out = Vec::with_capacity(words.len());
    for word in words {
        let map = word.as_object()?;
        let text = ["text", "word"]
            .iter()
            .find_map(|key| map.get(*key).and_then(Value::as_str))?
            .trim()
            .to_owned();
        let start = seconds_of(map, &["start", "t0"])?;
        let end = seconds_of(map, &["end", "t1"])?.max(start);
        if !text.is_empty() {
            out.push(TimedWord {
                start: round_ms(start),
                end: round_ms(end),
                text,
            });
        }
    }
    (!out.is_empty()).then_some(out)
}

// ---------------------------------------------------------------- 行窗

/// 补齐每一行的 `(start, end)`：
///
/// - 有起点没终点：接下一个已知时刻（下一行的起点），再没有就到 `duration`；
/// - 没起点：一段连续没时间的行按字数均分前一个已知终点与后一个已知起点之间的空档
///   （两头都没有就是 0 与 `duration`）。
///
/// 结果单调不减、落在 `[0, duration]` 内；终点不早于起点。
pub fn resolve_windows(lines: &[ScriptLine], duration: f64) -> Vec<(f64, f64)> {
    let duration = duration.max(0.0);
    let count = lines.len();
    let mut windows: Vec<Option<(f64, f64)>> = vec![None; count];
    for index in 0..count {
        let Some(start) = lines[index].start else {
            continue;
        };
        let start = start.clamp(0.0, duration);
        let next_start = lines[index + 1..]
            .iter()
            .find_map(|line| line.start)
            .map(|next| next.clamp(start, duration));
        let end = lines[index]
            .end
            .or(next_start)
            .unwrap_or(duration)
            .clamp(start, duration);
        windows[index] = Some((start, end));
    }
    let weight = |line: &ScriptLine| {
        line.text
            .chars()
            .filter(|c| !c.is_whitespace())
            .count()
            .max(1) as f64
    };
    let mut index = 0;
    while index < count {
        if windows[index].is_some() {
            index += 1;
            continue;
        }
        let mut run_end = index;
        while run_end < count && windows[run_end].is_none() {
            run_end += 1;
        }
        let gap_start = if index == 0 {
            0.0
        } else {
            windows[index - 1].map_or(0.0, |(_, end)| end)
        };
        let gap_end = if run_end < count {
            windows[run_end].map_or(duration, |(start, _)| start)
        } else {
            duration
        }
        .max(gap_start);
        let total: f64 = lines[index..run_end].iter().map(weight).sum();
        let mut cursor = gap_start;
        for (offset, line) in lines[index..run_end].iter().enumerate() {
            let next = cursor + (gap_end - gap_start) * weight(line) / total;
            windows[index + offset] = Some((round_ms(cursor), round_ms(next)));
            cursor = next;
        }
        index = run_end;
    }
    let mut previous = 0.0_f64;
    windows
        .into_iter()
        .map(|window| {
            let (start, end) = window.expect("every window filled");
            let start = start.max(previous);
            let end = end.max(start);
            previous = start;
            (start, end)
        })
        .collect()
}

/// 用已有转录的词给无时间的文稿行定锚。
#[derive(Debug, Clone, PartialEq)]
pub struct AnchorOutcome {
    /// 每行的 `(start, end)`；没对上任何词的行是 `None`（交给 [`resolve_windows`] 均分）。
    pub windows: Vec<Option<(f64, f64)>>,
    /// 文稿词里对上转录词的比例。
    pub matched: f64,
}

/// 行首 / 行尾没对上的词按多长估：每词至少这么多秒……
const MISSING_WORD_MIN: f64 = 0.35;
/// ……长词按字符数算（唱得比说得慢）……
const MISSING_WORD_PER_CHAR: f64 = 0.09;
/// ……再放宽这么多倍，窗宁宽勿窄：对齐器在窗里能找对位置，窗外的词只能挤进边缘。
const MISSING_SLACK: f64 = 1.5;

/// 文稿行 × 转录词：规范化成词元（小写、去标点；CJK 逐字），按词序做 LCS，每行
/// 取对上的词的时间范围。离群的零星匹配（副歌里的 `my` / `the` 对到别处）用中位数
/// 附近的一簇收掉。
///
/// 行首几个词没对上（识别漏了、听错了）时，那几个词唱在第一个对上的词**之前**：
/// 窗的起点按它们的估计时长往前放进行间空档，最早到上一行对上的终点；行尾同理往后放、
/// 最晚到下一行的起点。不放的话它们只能挤进对齐的边距里，变成十几毫秒的词、整行晚一截。
pub fn anchor_windows(lines: &[String], anchors: &[TimedWord]) -> AnchorOutcome {
    let mut vocabulary: HashMap<String, u32> = HashMap::new();
    let mut intern = |token: String| -> u32 {
        let next = vocabulary.len() as u32;
        *vocabulary.entry(token).or_insert(next)
    };
    let mut script_tokens: Vec<u32> = Vec::new();
    let mut script_line: Vec<usize> = Vec::new();
    let mut script_pos: Vec<usize> = Vec::new();
    // 每行每个词元的估计时长（秒），给没对上的行首 / 行尾估窗用。
    let mut line_estimates: Vec<Vec<f64>> = vec![Vec::new(); lines.len()];
    for (index, line) in lines.iter().enumerate() {
        for (pos, token) in tokens(line).into_iter().enumerate() {
            let chars = token.chars().count() as f64;
            line_estimates[index].push((chars * MISSING_WORD_PER_CHAR).max(MISSING_WORD_MIN));
            script_tokens.push(intern(token));
            script_line.push(index);
            script_pos.push(pos);
        }
    }
    let mut anchor_tokens: Vec<u32> = Vec::new();
    let mut anchor_time: Vec<(f64, f64)> = Vec::new();
    for word in anchors {
        for token in tokens(&word.text) {
            anchor_tokens.push(intern(token));
            anchor_time.push((word.start, word.end.max(word.start)));
        }
    }
    let empty = AnchorOutcome {
        windows: vec![None; lines.len()],
        matched: 0.0,
    };
    if script_tokens.is_empty() || anchor_tokens.is_empty() {
        return empty;
    }
    let Some(pairs) = lcs_matches(&script_tokens, &anchor_tokens, LCS_CELL_CAP) else {
        return empty;
    };
    // (起, 止, 行内词元序号)
    let mut per_line: Vec<Vec<(f64, f64, usize)>> = vec![Vec::new(); lines.len()];
    for (script_index, anchor_index) in &pairs {
        let (start, end) = anchor_time[*anchor_index];
        per_line[script_line[*script_index]].push((start, end, script_pos[*script_index]));
    }
    // 对上的范围，外加行首 / 行尾没对上的那几个词的估计时长。
    let matched_spans: Vec<Option<(f64, f64, f64, f64)>> = per_line
        .iter()
        .zip(&line_estimates)
        .map(|(times, estimates)| {
            if times.is_empty() {
                return None;
            }
            let mut starts: Vec<f64> = times.iter().map(|(start, _, _)| *start).collect();
            starts.sort_by(f64::total_cmp);
            let median = starts[starts.len() / 2];
            // 一行唱不了多久：一词 0.8 秒、至少 4 秒的半径以外算离群。
            let radius = (estimates.len() as f64 * 0.8).max(4.0);
            let kept: Vec<&(f64, f64, usize)> = times
                .iter()
                .filter(|(start, _, _)| (start - median).abs() <= radius)
                .collect();
            let start = kept
                .iter()
                .map(|(start, _, _)| *start)
                .fold(f64::INFINITY, f64::min);
            let end = kept
                .iter()
                .map(|(_, end, _)| *end)
                .fold(f64::NEG_INFINITY, f64::max);
            let first = kept.iter().map(|(_, _, pos)| *pos).min().unwrap_or(0);
            let last = kept.iter().map(|(_, _, pos)| *pos).max().unwrap_or(0);
            let lead: f64 = estimates[..first].iter().sum();
            let tail: f64 = estimates[last + 1..].iter().sum();
            Some((
                start,
                end.max(start),
                lead * MISSING_SLACK,
                tail * MISSING_SLACK,
            ))
        })
        .collect();
    let known: Vec<usize> = (0..lines.len())
        .filter(|index| matched_spans[*index].is_some())
        .collect();
    let mut windows: Vec<Option<(f64, f64)>> = vec![None; lines.len()];
    for (order, index) in known.iter().enumerate() {
        let (start, end, lead, tail) = matched_spans[*index].expect("known");
        let floor = order
            .checked_sub(1)
            .and_then(|previous| matched_spans[known[previous]])
            .map_or(0.0, |(_, previous_end, _, _)| previous_end);
        let ceiling = known
            .get(order + 1)
            .and_then(|next| matched_spans[*next])
            .map_or(f64::INFINITY, |(next_start, _, _, _)| next_start);
        let widened_start = (start - lead).max(floor).min(start);
        let widened_end = (end + tail).min(ceiling).max(end);
        windows[*index] = Some((widened_start, widened_end));
    }
    // 两行都往同一段空档里放时，在中间分开，不让窗互相盖住。
    for pair in known.windows(2) {
        let (Some((_, previous_end)), Some((next_start, _))) = (windows[pair[0]], windows[pair[1]])
        else {
            continue;
        };
        if previous_end > next_start {
            let middle = (previous_end + next_start) / 2.0;
            let previous_floor = matched_spans[pair[0]].map_or(middle, |span| span.1);
            let next_ceiling = matched_spans[pair[1]].map_or(middle, |span| span.0);
            if let Some(window) = windows[pair[0]].as_mut() {
                window.1 = middle.max(previous_floor);
            }
            if let Some(window) = windows[pair[1]].as_mut() {
                window.0 = middle.min(next_ceiling);
            }
        }
    }
    let windows = windows
        .into_iter()
        .map(|window| window.map(|(start, end)| (round_ms(start), round_ms(end.max(start)))))
        .collect();
    AnchorOutcome {
        windows,
        matched: pairs.len() as f64 / script_tokens.len() as f64,
    }
}

/// 匹配用词元：小写，字母数字以外都当分隔；CJK 字符各自成一个词元。
fn tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if is_cjk_char(ch) {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
            out.push(ch.to_string());
        } else if ch.is_alphanumeric() {
            current.extend(ch.to_lowercase());
        } else if ch == '\'' || ch == '’' {
            // `that's` / `don't` 在转录里常被写成 `thats` / 拆开，都并成一个词元。
        } else if !current.is_empty() {
            out.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn collapse_spaces(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 词拼回行文本：两侧是不留空格的文字（汉字 / 假名）时不加空格；韩文的词
/// 是어절，词间加空格。
pub fn join_words<'a>(words: impl Iterator<Item = &'a str>) -> String {
    let mut out = String::new();
    for word in words {
        let word = word.trim();
        if word.is_empty() {
            continue;
        }
        let glue = match (out.chars().last(), word.chars().next()) {
            (Some(prev), Some(next)) => {
                !(is_cjk_char(prev) && is_cjk_char(next) && unspaced_pair(prev, next))
            }
            _ => false,
        };
        if glue {
            out.push(' ');
        }
        out.push_str(word);
    }
    out
}

fn round_ms(seconds: f64) -> f64 {
    (seconds * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(lines: &[ScriptLine]) -> Vec<&str> {
        lines.iter().map(|line| line.text.as_str()).collect()
    }

    #[test]
    fn join_words_spaces_korean_and_glues_han_and_kana() {
        assert_eq!(
            join_words(["저는", "내일", "샀다."].into_iter()),
            "저는 내일 샀다."
        );
        assert_eq!(join_words(["大", "家", "好"].into_iter()), "大家好");
        assert_eq!(join_words(["い", "い", "天", "気"].into_iter()), "いい天気");
        assert_eq!(join_words(["hello", "world"].into_iter()), "hello world");
    }

    #[test]
    fn plain_text_splits_sentences_and_drops_section_tags() {
        let lines = split_plain(
            "[Verse 1]\nDraw the sun. Then the tree!\n\n  第一步，收需求。第二步：画图？  \nVersion 3.5 is fine\n[Chorus]\n",
        );
        assert_eq!(
            lines,
            vec![
                "Draw the sun.",
                "Then the tree!",
                "第一步，收需求。",
                "第二步：画图？",
                "Version 3.5 is fine",
            ]
        );
        assert!(split_plain("  \n\t\n").is_empty());
        // 整篇短行（歌词）：行内的句末不切。
        assert_eq!(
            split_plain(
                "I see sparks\nNo surprise\nWhat did Ilya see? We'll never know.\nWas it all for show?\n"
            ),
            vec![
                "I see sparks",
                "No surprise",
                "What did Ilya see? We'll never know.",
                "Was it all for show?"
            ]
        );
        // 方括号只占行首一段的不是标记。
        assert_eq!(split_plain("[laughs] okay"), vec!["[laughs] okay"]);
    }

    #[test]
    fn detect_prefers_extension_then_sniffs() {
        assert_eq!(detect("hello", Some("lrc")), ScriptFormat::Lrc);
        assert_eq!(detect("hello", Some("SRT")), ScriptFormat::Srt);
        assert_eq!(detect("[00:01.00]hi", None), ScriptFormat::Lrc);
        assert_eq!(detect("[00:01.00]hi", Some("txt")), ScriptFormat::Text);
        assert_eq!(
            detect("1\n00:00:01,000 --> 00:00:02,000\nhi\n", None),
            ScriptFormat::Srt
        );
        assert_eq!(detect("{\"lines\":[\"hi\"]}", None), ScriptFormat::Json);
        assert_eq!(detect("[Chorus]\nla la", None), ScriptFormat::Text);
        assert_eq!(detect("just words", Some("lyrics")), ScriptFormat::Text);
    }

    #[test]
    fn lrc_lines_take_the_next_tag_as_their_end() {
        let lines = parse(
            "[ti:Song]\n[ar:Someone]\n[00:04.25]I see sparks\n[00:07.85][01:02.00]Your circuits\n[00:09.81]\n[00:10.50]that's no surprise\n",
            ScriptFormat::Lrc,
        )
        .unwrap();
        assert_eq!(
            texts(&lines),
            vec![
                "I see sparks",
                "Your circuits",
                "that's no surprise",
                "Your circuits"
            ]
        );
        assert_eq!(lines[0].start, Some(4.25));
        assert_eq!(lines[0].end, Some(7.85));
        // 空标签行是上一行的终点。
        assert_eq!(lines[1].end, Some(9.81));
        assert_eq!(lines[2].end, Some(62.0));
        // 最后一行没有终点，交给 resolve_windows。
        assert_eq!(lines[3].start, Some(62.0));
        assert_eq!(lines[3].end, None);
    }

    #[test]
    fn lrc_offset_and_three_part_clocks() {
        let lines = parse(
            "[offset:+500]\n[00:02:50]one\n[00:04.000]two\n",
            ScriptFormat::Lrc,
        )
        .unwrap();
        assert_eq!(lines[0].start, Some(2.0));
        assert_eq!(lines[1].start, Some(3.5));
        assert_eq!(lines[0].end, Some(3.5));
    }

    #[test]
    fn enhanced_lrc_gives_word_times() {
        let lines = parse(
            "[00:01.00]<00:01.00>I <00:01.40>see <00:01.90>sparks<00:02.60>\n[00:03.00]next\n",
            ScriptFormat::Lrc,
        )
        .unwrap();
        assert_eq!(lines[0].text, "I see sparks");
        let words = lines[0].words.as_ref().unwrap();
        assert_eq!(words.len(), 3);
        assert_eq!((words[0].start, words[0].end), (1.0, 1.4));
        assert_eq!(words[2].text, "sparks");
        assert_eq!((words[2].start, words[2].end), (1.9, 2.6));
        assert!(lines[1].words.is_none());
    }

    #[test]
    fn srt_and_vtt_cues_become_windows() {
        let srt = "1\n00:00:01,000 --> 00:00:02,500\n<i>Hello</i>\nthere\n\n2\n00:00:03,000 --> 00:00:04,000\n{\\an8}Bye\n";
        let lines = parse(srt, ScriptFormat::Srt).unwrap();
        assert_eq!(texts(&lines), vec!["Hello there", "Bye"]);
        assert_eq!((lines[0].start, lines[0].end), (Some(1.0), Some(2.5)));
        let vtt = "WEBVTT\n\nNOTE hi\n\n00:01.000 --> 00:02.000 align:start\n- Hey\n";
        let lines = parse(vtt, ScriptFormat::Srt).unwrap();
        assert_eq!(texts(&lines), vec!["- Hey"]);
        assert_eq!(lines[0].end, Some(2.0));
    }

    #[test]
    fn json_lines_accept_strings_objects_and_word_times() {
        let lines = parse(
            r#"{"lines":[
                "untimed",
                {"text":"timed","start":1.0,"end":2.0},
                {"start":3,"end":4,"words":[{"word":"a","start":3,"end":3.4},{"text":"b","t0":3.4,"t1":4}]},
                {"text":"partial words","words":[{"text":"x"}]}
            ]}"#,
            ScriptFormat::Json,
        )
        .unwrap();
        assert_eq!(
            texts(&lines),
            vec!["untimed", "timed", "a b", "partial words"]
        );
        assert_eq!(lines[0].start, None);
        assert_eq!(lines[2].words.as_ref().unwrap()[1].start, 3.4);
        assert!(lines[3].words.is_none());
        let segments = parse(
            r#"{"segments":[{"text":" hi ","start":0.5,"end":1}]}"#,
            ScriptFormat::Json,
        )
        .unwrap();
        assert_eq!(texts(&segments), vec!["hi"]);
        assert!(parse(r#"{"x":1}"#, ScriptFormat::Json).is_err());
        assert!(parse(r#"[{"text":"bad","start":2,"end":1}]"#, ScriptFormat::Json).is_err());
    }

    #[test]
    fn windows_fill_open_ends_and_untimed_runs() {
        let line = |text: &str, start: Option<f64>, end: Option<f64>| ScriptLine {
            text: text.into(),
            start,
            end,
            words: None,
        };
        let lines = vec![
            line("aa", None, None),
            line("bb", Some(2.0), None),
            line("cc", None, None),
            line("dddddd", None, None),
            line("ee", Some(10.0), Some(11.0)),
            line("ff", Some(12.0), None),
        ];
        let windows = resolve_windows(&lines, 20.0);
        assert_eq!(windows[0], (0.0, 2.0));
        // 有起点没终点：接下一个已知起点。
        assert_eq!(windows[1], (2.0, 10.0));
        // 这两行夹在 10.0（bb 的终点）与 10.0 之间：空档为零，照样单调。
        assert_eq!(windows[2], (10.0, 10.0));
        assert_eq!(windows[4], (10.0, 11.0));
        assert_eq!(windows[5], (12.0, 20.0));
        let untimed = vec![line("aa", None, None), line("bbbbbb", None, None)];
        assert_eq!(resolve_windows(&untimed, 8.0), vec![(0.0, 2.0), (2.0, 8.0)]);
    }

    #[test]
    fn anchors_place_untimed_lines_on_asr_words() {
        let word = |text: &str, start: f64, end: f64| TimedWord {
            text: text.into(),
            start,
            end,
        };
        let asr = vec![
            word("I", 4.3, 4.5),
            word("see", 4.5, 4.9),
            word("sparks", 4.9, 5.4),
            word("of", 5.4, 5.6),
            word("AGI", 5.6, 6.5),
            word("your", 7.9, 8.2),
            word("circus", 8.2, 8.8), // ASR 听错：不影响行窗
            word("make", 8.8, 9.0),
            word("me", 9.0, 9.2),
            word("nervous", 9.2, 9.8),
            word("thats", 9.9, 10.2),
            word("no", 10.2, 10.4),
            word("surprise", 10.4, 11.0),
        ];
        let lines: Vec<String> = [
            "I see sparks of AGI",
            "Your circuits make me nervous,",
            "that's no surprise",
            "[never sung]",
        ]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
        let outcome = anchor_windows(&lines, &asr);
        assert_eq!(outcome.windows[0], Some((4.3, 6.5)));
        assert_eq!(outcome.windows[1], Some((7.9, 9.8)));
        assert_eq!(outcome.windows[2], Some((9.9, 11.0)));
        assert_eq!(outcome.windows[3], None);
        // 15 个文稿词元里 12 个对上。
        assert!(
            (outcome.matched - 12.0 / 15.0).abs() < 1e-9,
            "{}",
            outcome.matched
        );
        assert_eq!(anchor_windows(&lines, &[]).matched, 0.0);
    }

    #[test]
    fn anchor_outliers_do_not_stretch_a_line() {
        let word = |text: &str, start: f64| TimedWord {
            text: text.into(),
            start,
            end: start + 0.3,
        };
        // 「my」在 30 秒外又出现一次，LCS 可能把它配过去——窗不该被拉长到 30 秒。
        let asr = vec![word("upping", 1.0), word("doom", 1.6), word("my", 31.0)];
        let lines = vec!["upping doom my".to_owned()];
        let outcome = anchor_windows(&lines, &asr);
        // 离群的 `my` 不拉长窗；它算行尾没对上的词，窗只往后放它的估计时长（0.35 × 1.5）。
        assert_eq!(outcome.windows[0], Some((1.0, 2.425)));
    }

    #[test]
    fn unmatched_line_heads_and_tails_widen_into_the_gaps() {
        let word = |text: &str, start: f64, end: f64| TimedWord {
            text: text.into(),
            start,
            end,
        };
        // 识别漏了第二行的「orthogonality thesis」、第三行的「dense」：
        // 只对上 `blues` 与 `post chinchilla super`。
        let asr = vec![
            word("we", 4.0, 4.3),
            word("had", 4.3, 4.6),
            word("a", 4.6, 4.7),
            word("stable", 4.7, 5.4),
            word("run", 5.4, 6.0),
            word("blues", 10.0, 10.5),
            word("post", 11.0, 11.3),
            word("chinchilla", 11.3, 12.0),
            word("super", 12.0, 12.3),
            word("next", 12.8, 13.1),
        ];
        let lines: Vec<String> = [
            "We had a stable run",
            "Orthogonality thesis blues.",
            "Post-Chinchilla, super-dense",
            "next",
        ]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
        let outcome = anchor_windows(&lines, &asr);
        assert_eq!(outcome.windows[0], Some((4.0, 6.0)));
        // 行首两词估 (13 × 0.09 + 6 × 0.09) × 1.5 = 2.565 s：起点从 10.0 放到 7.435。
        assert_eq!(outcome.windows[1], Some((7.435, 10.5)));
        // 行尾 `dense` 估 0.45 × 1.5 = 0.675 s，但下一行 12.8 起：止于 12.8。
        assert_eq!(outcome.windows[2], Some((11.0, 12.8)));
        assert_eq!(outcome.windows[3], Some((12.8, 13.1)));

        // 行间空档不够放时，最早到上一行的终点，窗不重叠。
        let tight = vec![word("run", 5.4, 6.0), word("blues", 6.3, 6.8)];
        let lines = vec!["run".to_owned(), "orthogonality thesis blues".to_owned()];
        let outcome = anchor_windows(&lines, &tight);
        assert_eq!(outcome.windows[0], Some((5.4, 6.0)));
        assert_eq!(outcome.windows[1], Some((6.0, 6.8)));
    }
}
