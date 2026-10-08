//! speaker-repair：polish **前置**的说话人归属语义修复波次（`kind = "speaker-repair"`）。
//!
//! 背景：diarization 偶尔把一个词、半句话判给对面（"打 DOTA 什么 | 的 | 就是宿舍
//! 里面…"），或把切换点挪前挪后几个词。polish 把 ⏹ 当硬保证（句不得跨、必分
//! 段），所以只要 `words[].sp` 还错着，主润色就被迫把"的"当独立句加标点。这一
//! 波在分页之前跑：引擎按时间/形态**确定性筛出候选**（夹心短岛、无停顿无标点
//! 的切换点），LLM 只做语义判别（"的"是邻句的语法延续 vs "对。"是独立应答），
//! 答案是**索引契约**——按词编号的窗口 + `a-b LABEL` 区间——改字没有落脚点，
//! 验收是纯算术（连续、覆盖、标签 ∈ 窗口现有说话人、段数不增）。
//!
//! 与其它波次一样：单说话人文档整波跳过（零调用）；定向重润跳过；候选里文本
//! 全落在应答白名单（嗯/哦/对/OK…）的岛直接判 keep 不送 LLM。所有编辑只改
//! `words[].sp`（`sp` 不进指纹，不引发阶段重跑）。

use std::collections::BTreeMap;
use std::ops::Range;

use serde::Serialize;

use crate::atomize::ends_sentence;
use crate::doc::{TranscriptDoc, Word};
use crate::engines::markers::pause_marks;
use crate::filepipe::PageAttempt;
use crate::filepipe::common::{Problem, ProblemCode, ProblemScope};
use crate::llm::{LlmError, LlmJson, LlmRequest};
use crate::speaker::{SpeakerLabels, speaker_turns};

/// 夹心短岛的上限：轮次 ≤ 这么多词且 ≤ 这么多秒、两侧同一说话人 ⇒ 候选。
pub const SPEAKER_REPAIR_ISLAND_MAX_WORDS: usize = 4;
pub const SPEAKER_REPAIR_ISLAND_MAX_SECONDS: f64 = 1.2;
/// 不自然切换点：切换处词间隙小于此值且前词无句末标点 ⇒ 候选。原始 ASR 的
/// 标点分块不稳定（MOSS 同一次转录有的块出标点有的不出），"前词无句末"只是
/// 负向信号——无标点块里多筛出一些候选只多花调用，不伤正确性。
pub const SPEAKER_REPAIR_UNNATURAL_GAP_SECONDS: f64 = 0.25;
/// 候选两侧各带多少词上下文；相邻窗口合并，但合并后不超过 [`SPEAKER_REPAIR_WINDOW_MAX_WORDS`]。
pub const SPEAKER_REPAIR_CONTEXT_WORDS: usize = 40;
pub const SPEAKER_REPAIR_WINDOW_MAX_WORDS: usize = 240;
/// 一次调用最多装几个窗口。
pub const SPEAKER_REPAIR_WINDOWS_PER_CALL: usize = 8;
/// 轮次上限：第一轮发全部窗口，第二轮只重发被拒的（带 `retry_reason`）；耗尽
/// 后仍被拒的窗口保持原样（与不做修复完全一致）。
pub const SPEAKER_REPAIR_MAX_ROUNDS: u32 = 2;
/// 单个窗口里**连续改动**的词串上限（词数 / 时长任一超限即整窗口忽略）。这一波
/// 只修碎片（岛 ≤4 词）与几个词的边界偏移；一次改判几十个词是在改整段引语的
/// 归属，那不是 diarization 碎片而是模型的过度合并（实测 flash 把 7h 访谈片头
/// 里被引用的 38 词嘉宾原声并给了旁白），必须由确定性上限挡住。
pub const SPEAKER_REPAIR_MAX_CHANGE_WORDS: usize = 8;
pub const SPEAKER_REPAIR_MAX_CHANGE_SECONDS: f64 = 2.5;
/// 单个窗口里改动词的**总数**上限（几个岛并回 + 一处边界偏移的量级）；改判
/// 被真实应答隔开的多段同样挡在这里。
pub const SPEAKER_REPAIR_MAX_CHANGE_TOTAL_WORDS: usize = 12;

/// 应答白名单：岛的全部词（剥标点、小写）都在表里 ⇒ 真实应答，直接保留、
/// 不送 LLM。"啊/呃"这类既可能是应答也可能是邻句延续的语气词故意不在表里。
pub const SPEAKER_REPAIR_BACKCHANNEL_LEXICON: &[&str] = &[
    "嗯",
    "嗯嗯",
    "哦",
    "哦哦",
    "噢",
    "唔",
    "对",
    "对对",
    "对对对",
    "对的",
    "对吧",
    "对啊",
    "是",
    "是的",
    "是吗",
    "是啊",
    "好",
    "好的",
    "好吧",
    "行",
    "ok",
    "okay",
    "yeah",
    "yes",
    "yep",
    "no",
    "mm",
    "mhm",
    "hmm",
    "uh-huh",
    "right",
    "sure",
    "exactly",
    "totally",
    "true",
    "wow",
    "really",
    "i see",
];

pub const FENCE_WINDOW_PREFIX: &str = "<<<WINDOW";
pub const FENCE_WINDOW_END: &str = "<<<WINDOW-END>>>";

/// speaker-repair 的账目（进 polish 信封 `speakerRepair.wave`）。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerRepairReport {
    /// 整波跳过的原因：`disabled` / `single-speaker` / `scoped-run` /
    /// `no-candidates`；`None` 表示真的发了调用（或候选全被白名单接住）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
    /// 候选：夹心短岛数、其中被应答白名单直接保留数、不自然切换点数。
    pub islands: u32,
    pub islands_kept_by_lexicon: u32,
    pub unnatural_boundaries: u32,
    /// 发给模型的窗口数与调用次数（含重试轮）。
    pub windows: u32,
    pub calls: u32,
    /// 结果：改了说话人的词数；答案与现状一致的窗口数；答案改动了归属的窗口数
    /// （其中段数减少的记 `islands_merged`、段数不变只挪边界的记 `boundaries_moved`）；
    /// 轮次耗尽仍被拒、保持原样的窗口数。
    pub relabelled_words: u32,
    pub windows_confirmed: u32,
    pub windows_changed: u32,
    pub islands_merged: u32,
    pub boundaries_moved: u32,
    pub windows_rejected: u32,
    /// 答案合法但改动超过上限（总数 [`SPEAKER_REPAIR_MAX_CHANGE_TOTAL_WORDS`]，或
    /// 单串 [`SPEAKER_REPAIR_MAX_CHANGE_WORDS`] / [`SPEAKER_REPAIR_MAX_CHANGE_SECONDS`]）、
    /// 被引擎整窗口忽略的窗口数
    /// （成段改判超出这一波的证据范围：实测 flash 会把一整段 38 词的引语并给
    /// 旁白者）。
    pub windows_capped: u32,
}

/// 候选窗口（全局词下标区间，左闭右开）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeakerRepairPlan {
    pub windows: Vec<Range<usize>>,
    pub islands: u32,
    pub islands_kept_by_lexicon: u32,
    pub unnatural_boundaries: u32,
}

fn normalized_island_text(words: &[Word]) -> String {
    words
        .iter()
        .map(|word| word.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|ch| ch.is_alphanumeric() || ch.is_whitespace() || *ch == '-')
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// 岛文本是否整体落在应答白名单里（CJK 逐字岛拼起来比对；Latin 按空格拼）。
pub fn is_backchannel_island(words: &[Word]) -> bool {
    let joined = normalized_island_text(words);
    if joined.is_empty() {
        return false;
    }
    let compact: String = joined.chars().filter(|ch| !ch.is_whitespace()).collect();
    SPEAKER_REPAIR_BACKCHANNEL_LEXICON
        .iter()
        .any(|entry| *entry == joined || *entry == compact)
}

/// 确定性候选筛选 → 窗口。纯函数，不看标点是否存在（只把"前词句末"当负向信号）。
pub fn plan_speaker_repair(words: &[Word]) -> SpeakerRepairPlan {
    let mut plan = SpeakerRepairPlan {
        windows: Vec::new(),
        islands: 0,
        islands_kept_by_lexicon: 0,
        unnatural_boundaries: 0,
    };
    let turns = speaker_turns(words);
    if turns.len() < 2 {
        return plan;
    }
    // 候选锚点区间（全局词下标）。
    let mut anchors: Vec<Range<usize>> = Vec::new();
    for (index, turn) in turns.iter().enumerate() {
        let sandwiched = index > 0
            && index + 1 < turns.len()
            && words[turns[index - 1].start].sp == words[turns[index + 1].start].sp;
        let seconds = words[turn.end - 1].t1 - words[turn.start].t0;
        if sandwiched
            && turn.len() <= SPEAKER_REPAIR_ISLAND_MAX_WORDS
            && seconds <= SPEAKER_REPAIR_ISLAND_MAX_SECONDS
        {
            plan.islands += 1;
            if is_backchannel_island(&words[turn.clone()]) {
                plan.islands_kept_by_lexicon += 1;
            } else {
                anchors.push(turn.clone());
            }
        }
    }
    for turn in turns.iter().skip(1) {
        let boundary = turn.start;
        let gap = (words[boundary].t0 - words[boundary - 1].t1).max(0.0);
        if gap < SPEAKER_REPAIR_UNNATURAL_GAP_SECONDS && !ends_sentence(&words[boundary - 1].text) {
            plan.unnatural_boundaries += 1;
            anchors.push(boundary - 1..boundary + 1);
        }
    }
    if anchors.is_empty() {
        return plan;
    }
    anchors.sort_by_key(|range| (range.start, range.end));
    // 窗口 = 锚点 ± 上下文，重叠/相邻的合并，合并后超上限则另起。
    let mut windows: Vec<Range<usize>> = Vec::new();
    for anchor in anchors {
        let start = anchor.start.saturating_sub(SPEAKER_REPAIR_CONTEXT_WORDS);
        let end = (anchor.end + SPEAKER_REPAIR_CONTEXT_WORDS).min(words.len());
        if let Some(last) = windows.last_mut()
            && start <= last.end
        {
            let merged_end = end.max(last.end);
            if merged_end - last.start <= SPEAKER_REPAIR_WINDOW_MAX_WORDS {
                last.end = merged_end;
                continue;
            }
            // 装不下：新窗口从上一窗口末尾起（锚点仍在窗内）。
            let fresh_start = anchor
                .start
                .saturating_sub(SPEAKER_REPAIR_CONTEXT_WORDS)
                .max(last.end);
            windows.push(fresh_start..end.max(fresh_start + 1).min(words.len()));
            continue;
        }
        windows.push(start..end);
    }
    // 只有一个说话人的窗口（合并/裁剪后可能出现）没有可判的东西。
    windows.retain(|window| speaker_turns(&words[window.clone()]).len() > 1);
    plan.windows = windows;
    plan
}

/// 窗口现状：`(段起始行 1 基, 标签)` 序列。
fn current_segments(
    words: &[Word],
    labels: &SpeakerLabels,
    window: &Range<usize>,
) -> Vec<(usize, usize, String)> {
    let slice = &words[window.clone()];
    speaker_turns(slice)
        .into_iter()
        .map(|turn| {
            let label = labels
                .label(&slice[turn.start].sp)
                .map(str::to_owned)
                .unwrap_or_else(|| slice[turn.start].sp.clone());
            (turn.start + 1, turn.end, label)
        })
        .collect()
}

/// 渲染一个窗口块（`index` 为块内 1 基序号）。
pub fn render_speaker_repair_window(
    words: &[Word],
    labels: &SpeakerLabels,
    index: usize,
    window: &Range<usize>,
) -> String {
    let slice = &words[window.clone()];
    let segments = current_segments(words, labels, window);
    let mut speakers: Vec<&str> = Vec::new();
    for (_, _, label) in &segments {
        if !speakers.iter().any(|known| known == label) {
            speakers.push(label);
        }
    }
    let current = segments
        .iter()
        .map(|(start, end, label)| format!("{start}-{end} {label}"))
        .collect::<Vec<_>>()
        .join(", ");
    let mut out = format!(
        "{FENCE_WINDOW_PREFIX} {index} | {} lines | speakers {} | current: {current}>>>\n",
        slice.len(),
        speakers.join(",")
    );
    for (offset, word) in slice.iter().enumerate() {
        let mut line = format!("{}| {}", offset + 1, word.text);
        if let Some(next) = words.get(window.start + offset + 1) {
            let marks = pause_marks(next.t0 - word.t1);
            if !marks.is_empty() {
                line.push(' ');
                line.push_str(&marks);
            }
        }
        out.push_str(&line);
        out.push('\n');
    }
    out.push_str(FENCE_WINDOW_END);
    out.push('\n');
    out
}

/// 一页 = 若干窗口块，块间空一行。
pub fn render_speaker_repair_page(
    words: &[Word],
    labels: &SpeakerLabels,
    windows: &[Range<usize>],
) -> String {
    windows
        .iter()
        .enumerate()
        .map(|(position, window)| render_speaker_repair_window(words, labels, position + 1, window))
        .collect::<Vec<_>>()
        .join("\n")
}

/// 载荷里一个窗口块的元数据（从块头解析）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowMeta {
    pub lines: usize,
    pub speakers: Vec<String>,
    /// 现状段数。
    pub segments: usize,
    /// 现状 `(起, 止, 标签)`（1 基闭区间）。
    pub current: Vec<(usize, usize, String)>,
}

fn parse_window_header(line: &str) -> Option<(usize, Option<WindowMeta>)> {
    let rest = line.trim().strip_prefix(FENCE_WINDOW_PREFIX)?;
    let rest = rest.trim_end_matches('>').trim();
    let mut parts = rest.split('|').map(str::trim);
    let index: usize = parts.next()?.parse().ok()?;
    let mut lines: Option<usize> = None;
    let mut speakers: Vec<String> = Vec::new();
    let mut current: Vec<(usize, usize, String)> = Vec::new();
    for part in parts {
        if let Some(count) = part
            .strip_suffix("lines")
            .or_else(|| part.strip_suffix("line"))
        {
            lines = count.trim().parse().ok();
        } else if let Some(list) = part.strip_prefix("speakers") {
            speakers = list
                .split(',')
                .map(|label| label.trim().to_owned())
                .filter(|label| !label.is_empty())
                .collect();
        } else if let Some(list) = part.strip_prefix("current:") {
            for item in list.split(',') {
                if let Some((range, label)) = parse_range_label(item) {
                    current.push((range.0, range.1, label));
                }
            }
        }
    }
    let meta = lines.map(|lines| WindowMeta {
        lines,
        speakers,
        segments: current.len(),
        current,
    });
    Some((index, meta))
}

/// 从载荷解析各窗口元数据（按块序）。
pub fn speaker_repair_payload_windows(payload: &str) -> Vec<WindowMeta> {
    payload
        .lines()
        .filter_map(parse_window_header)
        .filter_map(|(_, meta)| meta)
        .collect()
}

/// `a-b LABEL` / `a–b LABEL` / `a LABEL` / `a-b: LABEL` / `a-b → LABEL`。
fn parse_range_label(line: &str) -> Option<((usize, usize), String)> {
    let cleaned: String = line
        .chars()
        .map(|ch| match ch {
            '–' | '—' | '~' | '－' => '-',
            ':' | '：' | '→' | '=' | '>' | '，' | ',' => ' ',
            other => other,
        })
        .collect();
    let mut tokens = cleaned.split_whitespace();
    let range = tokens.next()?;
    let (start, end) = match range.split_once('-') {
        Some((a, b)) => (
            a.trim().parse::<usize>().ok()?,
            b.trim().parse::<usize>().ok()?,
        ),
        None => {
            let only = range.parse::<usize>().ok()?;
            (only, only)
        }
    };
    let label = tokens.next()?.trim().to_owned();
    if label.is_empty() {
        return None;
    }
    Some(((start, end), label))
}

/// 一次答案的解析结果：每个窗口 `Some(段落)`（`(起, 止, 标签)` 1 基闭区间，
/// 已合并相邻同标签段）或 `None`（该窗口被拒，理由在 `problems` 里）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeakerRepairParsed {
    pub problems: Vec<Problem>,
    pub windows: Vec<Option<Vec<(usize, usize, String)>>>,
}

/// 解析并验收一页答案。宽容：块头可丢 `>>>`、块尾可缺（下一块头或文末即止）、
/// 单窗口页可省块头；一行多个 `a-b LABEL` 也认。验收：区间从 1 起、首尾相接、
/// 到末行；标签 ∈ 窗口现有说话人；段数（合并相邻同标签后）≤ 现状段数。
pub fn parse_speaker_repair_page(payload: &str, answer: &str) -> SpeakerRepairParsed {
    let metas = speaker_repair_payload_windows(payload);
    let mut parsed = SpeakerRepairParsed {
        problems: Vec::new(),
        windows: vec![None; metas.len()],
    };
    if metas.is_empty() {
        return parsed;
    }
    // 收集块：块序号 → 原始行。
    let mut blocks: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    let mut current: Option<usize> = None;
    let mut orphan: Vec<String> = Vec::new();
    for raw in answer.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with("```") {
            continue;
        }
        if line.starts_with(FENCE_WINDOW_END) {
            current = None;
            continue;
        }
        if let Some((index, _)) = parse_window_header(line) {
            current = Some(index);
            blocks.entry(index).or_default();
            continue;
        }
        match current {
            Some(index) => blocks.entry(index).or_default().push(line.to_owned()),
            None => orphan.push(line.to_owned()),
        }
    }
    if blocks.is_empty() && metas.len() == 1 && !orphan.is_empty() {
        blocks.insert(1, orphan);
    }
    for (position, meta) in metas.iter().enumerate() {
        let index = position + 1;
        let Some(lines) = blocks.get(&index) else {
            parsed.problems.push(Problem::paragraph(
                ProblemCode::RangeInvalid,
                position,
                format!("窗口 {index} 没有答案块（需要 `{FENCE_WINDOW_PREFIX} {index}>>>` … `{FENCE_WINDOW_END}`）"),
            ));
            continue;
        };
        let mut ranges: Vec<(usize, usize, String)> = Vec::new();
        let mut bad: Option<String> = None;
        for line in lines {
            // 一行可能有多个 `a-b LABEL`：按「数字开头」切。
            let mut pieces: Vec<String> = Vec::new();
            for token in line.split_whitespace() {
                let starts_range = token.chars().next().is_some_and(|ch| ch.is_ascii_digit());
                if starts_range || pieces.is_empty() {
                    pieces.push(token.to_owned());
                } else if let Some(last) = pieces.last_mut() {
                    last.push(' ');
                    last.push_str(token);
                }
            }
            for piece in pieces {
                match parse_range_label(&piece) {
                    Some(((start, end), label)) => ranges.push((start, end, label)),
                    None => {
                        bad = Some(format!("无法解析行 `{line}`：每行只写 `起-止 标签`"));
                        break;
                    }
                }
            }
            if bad.is_some() {
                break;
            }
        }
        if let Some(detail) = bad {
            parsed.problems.push(Problem::paragraph(
                ProblemCode::RangeInvalid,
                position,
                detail,
            ));
            continue;
        }
        if let Err(detail) = validate_window_answer(meta, &mut ranges) {
            parsed.problems.push(Problem::paragraph(
                ProblemCode::RangeInvalid,
                position,
                detail,
            ));
            continue;
        }
        parsed.windows[position] = Some(ranges);
    }
    parsed
}

fn validate_window_answer(
    meta: &WindowMeta,
    ranges: &mut Vec<(usize, usize, String)>,
) -> Result<(), String> {
    if ranges.is_empty() {
        return Err("答案为空：至少要一个 `起-止 标签` 区间".to_owned());
    }
    ranges.sort_by_key(|(start, _, _)| *start);
    let mut expected = 1usize;
    for (start, end, label) in ranges.iter() {
        if *start != expected {
            return Err(format!(
                "区间必须从 1 起、首尾相接：期望从 {expected} 开始，得到 {start}-{end}"
            ));
        }
        if end < start {
            return Err(format!("区间 {start}-{end} 起止颠倒"));
        }
        if *end > meta.lines {
            return Err(format!("区间 {start}-{end} 超出窗口末行 {}", meta.lines));
        }
        if !meta
            .speakers
            .iter()
            .any(|known| known.eq_ignore_ascii_case(label))
        {
            return Err(format!(
                "标签 `{label}` 不在本窗口的说话人里（只能是 {}）",
                meta.speakers.join(" / ")
            ));
        }
        expected = end + 1;
    }
    if expected != meta.lines + 1 {
        return Err(format!(
            "区间必须覆盖到末行 {}：只到 {}",
            meta.lines,
            expected - 1
        ));
    }
    // 合并相邻同标签段再数段。
    let mut merged: Vec<(usize, usize, String)> = Vec::new();
    for (start, end, label) in ranges.drain(..) {
        match merged.last_mut() {
            Some((_, last_end, last_label)) if last_label.eq_ignore_ascii_case(&label) => {
                *last_end = end;
            }
            _ => merged.push((start, end, label)),
        }
    }
    if merged.len() > meta.segments {
        return Err(format!(
            "段数不得增加：现状 {} 段，答案 {} 段——只能把碎片并回邻居或挪动现有切换点，不能凭空造新的换人",
            meta.segments,
            merged.len()
        ));
    }
    *ranges = merged;
    Ok(())
}

/// agent 侧 `task submit` 对 speaker-repair 答案的镜像 lint。
pub fn lint_agent_answer_speaker_repair(payload: &str, answer: &str) -> Vec<String> {
    parse_speaker_repair_page(payload, answer)
        .problems
        .iter()
        .map(|problem| format!("{}: {}", problem.code, problem.detail))
        .collect()
}

pub fn speaker_repair_system_prompt() -> String {
    format!(
        r#"You are checking SPEAKER ATTRIBUTION in a raw multi-speaker ASR transcript before it is copy-edited.

Automatic speaker diarization sometimes hands a fragment to the wrong person: a particle, a syllable or a few words that grammatically CONTINUE the neighbouring speaker's sentence get their own turn ("打 DOTA 什么 | 的 | 就是宿舍…", "he was | going to | say"), or a speaker change is placed a few words too early or too late. You receive ONE OR MORE windows as PLAIN TEXT, ONE WORD (or one CJK character) PER LINE, every line prefixed with its 1-based line number; a "⏸" after a word marks a pause. The header names the speakers present in the window and the CURRENT attribution as line ranges:

{FENCE_WINDOW_PREFIX} 1 | 31 lines | speakers S1,S2 | current: 1-13 S1, 14-14 S2, 15-31 S1>>>
1| 打
…
31| 吗
{FENCE_WINDOW_END}

Answer with LINE-NUMBER RANGES AND A LABEL ONLY — one range per turn, do NOT copy any words back:

{FENCE_WINDOW_PREFIX} 1>>>
1-31 S1
{FENCE_WINDOW_END}

Rules:
- Ranges must start at 1, be contiguous and end at the window's last line — no gaps, no overlaps, no numbers outside the window. Each range names exactly one label from the header's speaker list.
- Decide by MEANING AND GRAMMAR, then by timing. Reassign a fragment when it obviously completes the neighbouring speaker's clause (a particle like 的/了/吗/种, the tail or head of a word or phrase, a run-on that cannot stand as an utterance) and the pause around it is tiny.
- Keep a short turn when it is a real utterance of its own: acknowledgements (嗯 / 对 / 哦 / yeah / right), questions, answers, interjections that respond to the other speaker. A one-word turn is normal in dialogue — do not merge it just because it is short.
- You may move an existing speaker change by a few words when the words next to it clearly belong to the other side. You may merge a SHORT fragment into its neighbours. You must NEVER create a new speaker change where there is none: the number of turns in your answer must not exceed the number in `current:`.
- Only fragments are in scope. A turn of a full clause or more (roughly 8+ words / characters, or longer than a couple of seconds) is almost never a diarization error — a quoted sound bite, an interruption or an aside is a real turn even when it sits between the same speaker's lines. Do not reassign it; changes longer than a few words are discarded.
- The transcript is raw: punctuation may be missing or inconsistent, so do not rely on it. When you are not sure, repeat the current attribution unchanged.
- Answer for every window, in the same order, each with its own `{FENCE_WINDOW_PREFIX} k>>>` … `{FENCE_WINDOW_END}` fences, and emit NOTHING else: no words, no preamble, no explanations, no code block wrapper."#
    )
}

/// speaker-repair 波次。返回是否有词被改了说话人（调用方据此知道轮次已变）。
///
/// `enabled=false`、单说话人、定向重润（`scoped`）或没有候选时整波跳过、
/// `report.skipped` 给出原因；否则窗口分页发送（每页 ≤
/// [`SPEAKER_REPAIR_WINDOWS_PER_CALL`] 个窗口），被拒窗口第二轮带原因重发，
/// 耗尽后保持原样。窗口之间互不重叠，答案按窗口独立落到 `doc.words[].sp`。
pub fn speaker_repair_wave(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    enabled: bool,
    scoped: bool,
    report: &mut SpeakerRepairReport,
    on_attempt: &mut dyn FnMut(&PageAttempt<'_>),
) -> Result<bool, LlmError> {
    if !enabled {
        report.skipped = Some("disabled".to_owned());
        return Ok(false);
    }
    if speaker_turns(&doc.words).len() < 2 {
        report.skipped = Some("single-speaker".to_owned());
        return Ok(false);
    }
    if scoped {
        report.skipped = Some("scoped-run".to_owned());
        return Ok(false);
    }
    let plan = plan_speaker_repair(&doc.words);
    report.islands = plan.islands;
    report.islands_kept_by_lexicon = plan.islands_kept_by_lexicon;
    report.unnatural_boundaries = plan.unnatural_boundaries;
    if plan.windows.is_empty() {
        report.skipped = Some("no-candidates".to_owned());
        return Ok(false);
    }
    report.windows = plan.windows.len() as u32;
    let labels = SpeakerLabels::from_words(&doc.words);
    let system = speaker_repair_system_prompt();
    let mut pending: Vec<usize> = (0..plan.windows.len()).collect();
    let mut reasons: BTreeMap<usize, String> = BTreeMap::new();
    let mut answers: Vec<Option<Vec<(usize, usize, String)>>> = vec![None; plan.windows.len()];
    let mut page_serial = 0usize;
    for round in 1..=SPEAKER_REPAIR_MAX_ROUNDS {
        if pending.is_empty() {
            break;
        }
        let pages: Vec<(String, Vec<usize>, String)> = pending
            .chunks(SPEAKER_REPAIR_WINDOWS_PER_CALL)
            .map(|members| {
                page_serial += 1;
                let windows: Vec<Range<usize>> = members
                    .iter()
                    .map(|&item| plan.windows[item].clone())
                    .collect();
                (
                    format!("sk{round}-{page_serial:03}"),
                    members.to_vec(),
                    render_speaker_repair_page(&doc.words, &labels, &windows),
                )
            })
            .collect();
        let requests: Vec<LlmRequest> = pages
            .iter()
            .map(|(_, members, payload)| {
                let notes: Vec<String> = members
                    .iter()
                    .enumerate()
                    .filter_map(|(position, item)| {
                        reasons
                            .get(item)
                            .map(|reason| format!("第 {} 个窗口：{reason}", position + 1))
                    })
                    .collect();
                LlmRequest {
                    kind: "speaker-repair",
                    system: system.clone(),
                    user: payload.clone(),
                    temperature: 0.1,
                    attempt: round,
                    retry_reason: (!notes.is_empty())
                        .then(|| format!("[range-invalid] {}", notes.join("；"))),
                }
            })
            .collect();
        reasons.clear();
        report.calls += requests.len() as u32;
        let results = llm.complete_batch(&requests);
        debug_assert_eq!(results.len(), pages.len());
        let mut next_pending: Vec<usize> = Vec::new();
        for ((page_id, members, payload), result) in pages.iter().zip(results) {
            let raw = match result {
                Ok(raw) => raw,
                Err(error) if error.is_retryable() => {
                    next_pending.extend(members.iter().copied());
                    continue;
                }
                Err(error) => return Err(error),
            };
            let parsed = parse_speaker_repair_page(payload, &raw);
            debug_assert_eq!(parsed.windows.len(), members.len());
            on_attempt(&PageAttempt {
                page_id,
                attempt: round,
                input: payload,
                output: &raw,
                problems: &parsed.problems,
                accepted: parsed.windows.iter().any(Option::is_some),
            });
            for (position, (&item, answer)) in members.iter().zip(parsed.windows).enumerate() {
                match answer {
                    Some(answer) => answers[item] = Some(answer),
                    None => {
                        let detail = parsed
                            .problems
                            .iter()
                            .find(|problem| {
                                problem.scope == ProblemScope::Paragraph { index: position }
                            })
                            .map(|problem| format!("[{}] {}", problem.code, problem.detail))
                            .unwrap_or_else(|| {
                                "上一轮答案不可用，请按契约只回 `起-止 标签` 区间".to_owned()
                            });
                        reasons.insert(item, detail);
                        next_pending.push(item);
                    }
                }
            }
        }
        pending = next_pending;
    }
    report.windows_rejected = pending.len() as u32;

    // 应用：窗口互不重叠，逐窗口把 `a-b LABEL` 落到 sp。先算出改动串再落地：
    // 任一改动串超过 [`SPEAKER_REPAIR_MAX_CHANGE_WORDS`] / [`SPEAKER_REPAIR_MAX_CHANGE_SECONDS`]
    // 就整窗口忽略（`windows_capped`）——这一波只修碎片与几个词的边界偏移，
    // 成段改判超出它的证据范围。
    let mut changed_any = false;
    for (item, window) in plan.windows.iter().enumerate() {
        let Some(answer) = answers[item].as_ref() else {
            continue;
        };
        let mut proposed: Vec<(usize, String)> = Vec::new();
        for (start, end, label) in answer {
            let Some(sp) = labels.speaker_for_label(label) else {
                continue;
            };
            for offset in (start - 1)..*end {
                let global = window.start + offset;
                if doc.words[global].sp != sp {
                    proposed.push((global, sp.to_owned()));
                }
            }
        }
        if proposed.is_empty() {
            report.windows_confirmed += 1;
            continue;
        }
        if change_runs_exceed_cap(&doc.words, &proposed) {
            report.windows_capped += 1;
            continue;
        }
        let before_segments = speaker_turns(&doc.words[window.clone()]).len();
        let changed_words = proposed.len() as u32;
        for (global, sp) in proposed {
            doc.words[global].sp = sp;
        }
        changed_any = true;
        report.windows_changed += 1;
        report.relabelled_words += changed_words;
        let after_segments = speaker_turns(&doc.words[window.clone()]).len();
        if after_segments < before_segments {
            report.islands_merged += 1;
        } else {
            report.boundaries_moved += 1;
        }
    }
    Ok(changed_any)
}

/// 答案的改动是否超过上限：改动词总数超过 [`SPEAKER_REPAIR_MAX_CHANGE_TOTAL_WORDS`]，
/// 或任一连续改动串的词数 / 时长超限。
/// `proposed` 是升序的全局词下标（同一窗口内）。
fn change_runs_exceed_cap(words: &[Word], proposed: &[(usize, String)]) -> bool {
    if proposed.len() > SPEAKER_REPAIR_MAX_CHANGE_TOTAL_WORDS {
        return true;
    }
    let mut run_start = 0usize;
    for index in 0..=proposed.len() {
        let breaks = index == proposed.len()
            || (index > 0 && proposed[index].0 != proposed[index - 1].0 + 1);
        if !breaks {
            continue;
        }
        if index > run_start {
            let first = proposed[run_start].0;
            let last = proposed[index - 1].0;
            let count = last - first + 1;
            let seconds = words[last].t1 - words[first].t0;
            if count > SPEAKER_REPAIR_MAX_CHANGE_WORDS
                || seconds > SPEAKER_REPAIR_MAX_CHANGE_SECONDS
            {
                return true;
            }
        }
        run_start = index;
    }
    false
}

/// 词流是否值得跑这一波（供宿主提前判断，例如进度估算）。
pub fn has_multiple_speakers(words: &[Word]) -> bool {
    speaker_turns(words).len() > 1
}

/// 供测试与诊断：窗口的现状段描述。
pub fn describe_current(
    words: &[Word],
    labels: &SpeakerLabels,
    window: &Range<usize>,
) -> Vec<(usize, usize, String)> {
    current_segments(words, labels, window)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia, Speaker};
    use crate::llm::LlmRequest;

    fn word(id: &str, t0: f64, text: &str, sp: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1: t0 + 0.15,
            text: text.to_owned(),
            sp: sp.to_owned(),
            glue: false,
        }
    }

    /// 截图夹具：S2 长句里夹着 S1 的"的""种""吗"，外加一个真实应答"嗯"。
    fn dialogue() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: String::new(),
                duration: 100.0,
                sample_rate: None,
            },
            "zh",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        for (id, name) in [("s1", "S01"), ("s2", "S02")] {
            doc.speakers.insert(
                id.to_owned(),
                Speaker {
                    name: name.to_owned(),
                    hue: None,
                },
            );
        }
        let script: Vec<(&str, &str)> = vec![
            ("当", "s1"),
            ("时", "s1"),
            ("打", "s1"),
            ("什", "s1"),
            ("么", "s1"),
            ("游", "s1"),
            ("戏", "s1"),
            ("很", "s2"),
            ("多", "s2"),
            ("打", "s2"),
            ("DOTA", "s2"),
            ("什", "s2"),
            ("么", "s2"),
            ("的", "s1"),
            ("就", "s2"),
            ("是", "s2"),
            ("宿", "s2"),
            ("舍", "s2"),
            ("里", "s2"),
            ("面", "s2"),
            ("那", "s2"),
            ("种", "s1"),
            ("大", "s2"),
            ("学", "s2"),
            ("生", "s2"),
            ("活", "s2"),
            ("你", "s2"),
            ("知", "s2"),
            ("道", "s2"),
            ("吗", "s1"),
            ("就", "s2"),
            ("是", "s2"),
            ("有", "s2"),
            ("好", "s2"),
            ("好", "s2"),
            ("学", "s2"),
            ("习", "s2"),
            ("嗯", "s1"),
            ("但", "s2"),
            ("也", "s2"),
            ("有", "s2"),
            ("找", "s2"),
            ("寻", "s2"),
            ("自", "s2"),
            ("己", "s2"),
        ];
        let mut t = 10.0;
        for (index, (text, sp)) in script.iter().enumerate() {
            doc.words.push(word(&format!("g1.{index}"), t, text, sp));
            t += 0.16;
        }
        // 提问与回答之间留 0.7s 停顿（自然切换点，payload 里出 ⏸）。
        for word in doc.words.iter_mut().skip(7) {
            word.t0 += 0.7;
            word.t1 += 0.7;
        }
        doc
    }

    #[test]
    fn plan_finds_islands_and_unnatural_boundaries_and_skips_backchannels() {
        let doc = dialogue();
        let plan = plan_speaker_repair(&doc.words);
        // 岛："的""种""吗""嗯"四个夹心单词岛，其中"嗯"被白名单接住。
        assert_eq!(plan.islands, 4, "{plan:?}");
        assert_eq!(plan.islands_kept_by_lexicon, 1);
        // 不自然切换点：岛的两侧都是无停顿无标点的切换（每岛 2 个）+ "嗯" 两侧 2 个。
        assert!(plan.unnatural_boundaries >= 6, "{plan:?}");
        // 全部候选靠得近，合成一个窗口，盖住全文。
        assert_eq!(plan.windows.len(), 1, "{plan:?}");
        assert_eq!(plan.windows[0], 0..doc.words.len());
    }

    #[test]
    fn single_speaker_or_no_candidates_plan_nothing() {
        let mut doc = dialogue();
        for word in &mut doc.words {
            word.sp = "s1".to_owned();
        }
        assert!(plan_speaker_repair(&doc.words).windows.is_empty());

        // 干净的对话：切换点都有停顿 ⇒ 无候选。
        let mut clean = dialogue();
        for word in &mut clean.words {
            word.sp = if word.t0 < 11.0 { "s1" } else { "s2" }.to_owned();
        }
        let split = clean.words.iter().position(|w| w.sp == "s2").unwrap();
        clean.words[split].t0 += 0.6;
        clean.words[split].t1 += 0.6;
        for word in clean.words.iter_mut().skip(split + 1) {
            word.t0 += 0.6;
            word.t1 += 0.6;
        }
        let plan = plan_speaker_repair(&clean.words);
        assert!(plan.windows.is_empty(), "{plan:?}");
    }

    #[test]
    fn render_and_parse_round_trip_with_lenient_answers() {
        let doc = dialogue();
        let labels = SpeakerLabels::from_words(&doc.words);
        let plan = plan_speaker_repair(&doc.words);
        let payload = render_speaker_repair_page(&doc.words, &labels, &plan.windows);
        assert!(
            payload.starts_with(
                "<<<WINDOW 1 | 45 lines | speakers S1,S2 | current: 1-7 S1, 8-13 S2, 14-14 S1"
            ),
            "{payload}"
        );
        assert!(
            payload.contains("7| 戏 ⏸\n8| 很"),
            "停顿标记跟在词后：{payload}"
        );
        let metas = speaker_repair_payload_windows(&payload);
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].lines, 45);
        assert_eq!(metas[0].speakers, vec!["S1", "S2"]);
        assert_eq!(metas[0].segments, 10);

        // 规范答案：碎片并回 S2、"嗯"保留。
        let answer = "<<<WINDOW 1>>>\n1-7 S1\n8-37 S2\n38-38 S1\n39-45 S2\n<<<WINDOW-END>>>\n";
        let parsed = parse_speaker_repair_page(&payload, answer);
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(
            parsed.windows[0].as_ref().unwrap(),
            &vec![
                (1, 7, "S1".to_owned()),
                (8, 37, "S2".to_owned()),
                (38, 38, "S1".to_owned()),
                (39, 45, "S2".to_owned())
            ]
        );
        // 宽容形态：无尖括号、en dash、冒号、小写标签、单窗口省块头、相邻同标签合并。
        let sloppy = "1–7: s1\n8-20 S2\n21-37 S2\n38 S1\n39-45 S2";
        let parsed = parse_speaker_repair_page(&payload, sloppy);
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.windows[0].as_ref().unwrap().len(), 4);
    }

    #[test]
    fn parse_rejects_gaps_unknown_labels_and_extra_turns() {
        let doc = dialogue();
        let labels = SpeakerLabels::from_words(&doc.words);
        let plan = plan_speaker_repair(&doc.words);
        let payload = render_speaker_repair_page(&doc.words, &labels, &plan.windows);
        for (answer, needle) in [
            (
                "<<<WINDOW 1>>>\n1-7 S1\n9-45 S2\n<<<WINDOW-END>>>",
                "首尾相接",
            ),
            (
                "<<<WINDOW 1>>>\n1-7 S1\n8-45 S3\n<<<WINDOW-END>>>",
                "不在本窗口",
            ),
            (
                "<<<WINDOW 1>>>\n1-7 S1\n8-40 S2\n<<<WINDOW-END>>>",
                "覆盖到末行",
            ),
            (
                "<<<WINDOW 1>>>\n1-3 S1\n4-5 S2\n6-7 S1\n8-13 S2\n14-14 S1\n15-21 S2\n22-22 S1\n23-29 S2\n30-30 S1\n31-37 S2\n38-38 S1\n39-45 S2\n<<<WINDOW-END>>>",
                "段数不得增加",
            ),
            ("I cannot decide this.", "无法解析"),
        ] {
            let parsed = parse_speaker_repair_page(&payload, answer);
            assert!(parsed.windows[0].is_none(), "{answer}");
            assert_eq!(parsed.problems.len(), 1, "{answer}");
            assert_eq!(parsed.problems[0].code, ProblemCode::RangeInvalid);
            assert!(
                parsed.problems[0].detail.contains(needle),
                "{answer} → {}",
                parsed.problems[0].detail
            );
            assert!(!lint_agent_answer_speaker_repair(&payload, answer).is_empty());
        }
    }

    /// 顺序回放的假 LLM：按调用次序返回预设答案。
    struct Scripted {
        answers: Vec<String>,
        seen: Vec<LlmRequest>,
    }

    impl LlmJson for Scripted {
        fn complete(&mut self, request: &LlmRequest) -> Result<String, LlmError> {
            self.seen.push(request.clone());
            if self.answers.is_empty() {
                return Err(LlmError::Malformed("no more scripted answers".to_owned()));
            }
            Ok(self.answers.remove(0))
        }
    }

    #[test]
    fn wave_relabels_fragments_keeps_backchannels_and_reports() {
        let mut doc = dialogue();
        let mut llm = Scripted {
            answers: vec![
                "<<<WINDOW 1>>>\n1-7 S1\n8-37 S2\n38-38 S1\n39-45 S2\n<<<WINDOW-END>>>".to_owned(),
            ],
            seen: Vec::new(),
        };
        let mut report = SpeakerRepairReport::default();
        let mut attempts = 0;
        let changed = speaker_repair_wave(
            &mut doc,
            &mut llm,
            true,
            false,
            &mut report,
            &mut |attempt| {
                attempts += 1;
                assert!(attempt.page_id.starts_with("sk1-"));
                assert!(attempt.accepted);
            },
        )
        .unwrap();
        assert!(changed);
        assert_eq!(attempts, 1);
        assert_eq!(llm.seen.len(), 1);
        assert_eq!(llm.seen[0].kind, "speaker-repair");
        assert_eq!(report.skipped, None);
        assert_eq!(report.calls, 1);
        assert_eq!(report.windows, 1);
        assert_eq!(report.relabelled_words, 3, "{report:?}");
        assert_eq!(report.windows_changed, 1);
        assert_eq!(report.islands_merged, 1);
        assert_eq!(report.windows_rejected, 0);
        let turns: Vec<(String, String)> = {
            let mut out: Vec<(String, String)> = Vec::new();
            for word in &doc.words {
                match out.last_mut() {
                    Some((sp, text)) if *sp == word.sp => text.push_str(&word.text),
                    _ => out.push((word.sp.clone(), word.text.clone())),
                }
            }
            out
        };
        assert_eq!(turns.len(), 4, "{turns:?}");
        assert_eq!(
            turns[1].1,
            "很多打DOTA什么的就是宿舍里面那种大学生活你知道吗就是有好好学习"
        );
        assert_eq!(turns[2], ("s1".to_owned(), "嗯".to_owned()));
    }

    #[test]
    fn wave_retries_rejected_windows_once_then_keeps_the_original() {
        let mut doc = dialogue();
        let before: Vec<String> = doc.words.iter().map(|w| w.sp.clone()).collect();
        let mut llm = Scripted {
            answers: vec!["nonsense".to_owned(), "still nonsense".to_owned()],
            seen: Vec::new(),
        };
        let mut report = SpeakerRepairReport::default();
        let changed =
            speaker_repair_wave(&mut doc, &mut llm, true, false, &mut report, &mut |_| {}).unwrap();
        assert!(!changed);
        assert_eq!(llm.seen.len(), 2);
        assert_eq!(llm.seen[1].attempt, 2);
        assert!(
            llm.seen[1]
                .retry_reason
                .as_deref()
                .unwrap_or("")
                .starts_with("[range-invalid]")
        );
        assert_eq!(report.windows_rejected, 1);
        assert_eq!(report.calls, 2);
        assert_eq!(
            doc.words.iter().map(|w| w.sp.clone()).collect::<Vec<_>>(),
            before
        );
    }

    /// 合法但改动过大的答案（把 S2 的整段并给 S1）被上限挡住：窗口按原样保留。
    #[test]
    fn wave_ignores_answers_that_relabel_more_than_a_fragment() {
        let mut doc = dialogue();
        let before: Vec<String> = doc.words.iter().map(|w| w.sp.clone()).collect();
        // 段数 4 < 现状 10，契约上合法；但 8-37 里 30 个词连续改判。
        let mut llm = Scripted {
            answers: vec![
                "<<<WINDOW 1>>>\n1-37 S1\n38-38 S1\n39-45 S1\n<<<WINDOW-END>>>".to_owned(),
            ],
            seen: Vec::new(),
        };
        let mut report = SpeakerRepairReport::default();
        let changed =
            speaker_repair_wave(&mut doc, &mut llm, true, false, &mut report, &mut |_| {}).unwrap();
        assert!(!changed);
        assert_eq!(report.windows_capped, 1, "{report:?}");
        assert_eq!(report.windows_changed, 0);
        assert_eq!(report.relabelled_words, 0);
        assert_eq!(
            doc.words.iter().map(|w| w.sp.clone()).collect::<Vec<_>>(),
            before
        );
    }

    #[test]
    fn wave_skips_single_speaker_and_scoped_runs_without_calling() {
        let mut doc = dialogue();
        for word in &mut doc.words {
            word.sp = "s1".to_owned();
        }
        let mut llm = Scripted {
            answers: vec![],
            seen: Vec::new(),
        };
        let mut report = SpeakerRepairReport::default();
        speaker_repair_wave(&mut doc, &mut llm, true, false, &mut report, &mut |_| {}).unwrap();
        assert_eq!(report.skipped.as_deref(), Some("single-speaker"));
        assert!(llm.seen.is_empty());

        let mut doc = dialogue();
        let mut report = SpeakerRepairReport::default();
        speaker_repair_wave(&mut doc, &mut llm, true, true, &mut report, &mut |_| {}).unwrap();
        assert_eq!(report.skipped.as_deref(), Some("scoped-run"));
        let mut report = SpeakerRepairReport::default();
        speaker_repair_wave(&mut doc, &mut llm, false, false, &mut report, &mut |_| {}).unwrap();
        assert_eq!(report.skipped.as_deref(), Some("disabled"));
        assert!(llm.seen.is_empty());
    }

    #[test]
    fn backchannel_lexicon_matches_cjk_islands_and_latin_phrases() {
        let mk = |texts: &[&str]| -> Vec<Word> {
            texts
                .iter()
                .enumerate()
                .map(|(i, t)| word(&format!("w{i}"), i as f64, t, "s1"))
                .collect()
        };
        assert!(is_backchannel_island(&mk(&["嗯"])));
        assert!(is_backchannel_island(&mk(&["对", "对", "对"])));
        assert!(is_backchannel_island(&mk(&["嗯。"])));
        assert!(is_backchannel_island(&mk(&["I", "see."])));
        assert!(is_backchannel_island(&mk(&["OK"])));
        assert!(!is_backchannel_island(&mk(&["的"])));
        assert!(!is_backchannel_island(&mk(&["啊"])));
        assert!(!is_backchannel_island(&mk(&["对", "的", "确"])));
    }
}
