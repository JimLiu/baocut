//! speaker-names：polish **收尾**的说话人实名推断波次（`kind = "speaker-names"`）。
//!
//! 背景：diarization 只给得出 `s1`/`s2` 这样的声音 id，三端 UI 于是一直显示
//! `S01`/`S02` 占位名。[`crate::speaker::propose_names`] 的确定性启发式只认
//! **自我介绍**（`my name is …` / `我是…` / `我叫…`），而访谈、播客、圆桌里
//! 的实名绝大多数由**对方**给出（"today I'm joined by Andrew Ng"、"有请张三"），
//! 或者只出现在标题与简介里——那些证据没有任何可写的句式，启发式必然空手。
//! 这一波把这件事交给模型：证据（开场白 + 每个待命名说话人的首次登场上下文
//! + 项目/来源元数据 + analysis 的命名实体）进去，答案只回 `S2 = Andrew Ng`。
//!
//! 波次位置在 polish 的**最后**（正文已 [`super::polish::apply`] 落盘之后）：
//!
//! - `speaker-repair` 会重写 `words[].sp`，可能把一个假聚簇整个吸收掉，
//!   先命名就会把名字挂在一个已经没有词的说话人上；
//! - 润色后的文本才有标点，第三方介绍（"欢迎 Andrew Ng。"）远比生 ASR 好读。
//!
//! 编辑面**只有 `speakers[<id>].name`**：`sp` 与 `speakers[].name` 都不进阶段
//! 指纹（见 [`crate::doc::TranscriptDoc::stage_stamp`]），改名不会让 polish /
//! segment / translate / align 变 stale，因此这一波对已翻译的项目是安全的。
//! 且只写**占位名**——用户改过的名字永远不动。

use serde::Serialize;

use crate::doc::TranscriptDoc;
use crate::engines::markers::marked_text_labeled;
use crate::filepipe::PageAttempt;
use crate::filepipe::common::{Problem, ProblemCode, ProblemScope};
use crate::llm::{LlmError, LlmJson, LlmRequest};
use crate::speaker::{SpeakerLabels, is_placeholder_name};

/// 开场白证据窗口：文档开头这么多词。第三方介绍几乎总在开场的一两分钟里
/// （"welcome back… today I'm joined by…"），400 词覆盖约 2–3 分钟口播。
pub const SPEAKER_NAMES_OPENING_WORDS: usize = 400;
/// 每个待命名说话人首次登场处的证据窗口：其前这么多词（介绍通常出自**对方**
/// 之口，所以上文比下文重要）。
pub const SPEAKER_NAMES_CONTEXT_WORDS: usize = 60;
/// 每个待命名说话人首次登场处的证据窗口：其后这么多词。
pub const SPEAKER_NAMES_SPEAKER_WORDS: usize = 120;
/// 单个名字的字符上限（含空格）。超限一律判非法——模型在越界时的典型失败
/// 形态是把整句介绍抄回来。
pub const SPEAKER_NAMES_MAX_NAME_CHARS: usize = 40;
/// 答案被拒后的重发轮数上限（含首轮）。
pub const SPEAKER_NAMES_MAX_ROUNDS: u32 = 2;

pub const FENCE_OPENING: &str = "<<<OPENING";
pub const FENCE_OPENING_END: &str = "<<<OPENING-END>>>";
pub const FENCE_SPEAKER: &str = "<<<SPEAKER";
pub const FENCE_SPEAKER_END: &str = "<<<SPEAKER-END>>>";
pub const FENCE_ASK: &str = "<<<NAMES-ASK>>>";
pub const FENCE_ASK_END: &str = "<<<NAMES-ASK-END>>>";
pub const FENCE_NAMES: &str = "<<<NAMES>>>";
pub const FENCE_NAMES_END: &str = "<<<NAMES-END>>>";

/// 模型放弃命名时的答案值。
pub const UNKNOWN_ANSWER: &str = "?";

/// speaker-names 的账目（进 polish 信封 `speakerNames.wave`）。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerNamesReport {
    /// 整波跳过的原因：`disabled` / `no-words` / `scoped-run` /
    /// `no-placeholders`；`None` 表示真的发了调用。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
    /// 待命名（名字仍是占位、且在正文里还有词）的说话人数。
    pub targets: u32,
    /// 调用次数（含重试轮）。
    pub calls: u32,
    /// 模型给出了名字的说话人数（含被引擎拒绝的）。
    pub proposed: u32,
    /// 实际写进 `speakers[].name` 的说话人数。
    pub named: u32,
    /// 模型明确回 `?`（证据不足）的说话人数。
    pub unknown: u32,
    /// 轮次耗尽仍没有可用答案 ⇒ 整波无结果。
    pub rejected: bool,
    /// 落盘的实名，`(说话人 id, 名字)`，按 id 升序。
    pub names: Vec<(String, String)>,
}

/// 一次 speaker-names 波次的证据计划。
#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerNamesPlan {
    /// 待命名说话人：`(说话人 id, 标签)`，按标签在文档中首次出现的顺序。
    pub targets: Vec<(String, String)>,
    /// 全篇标签表（单说话人文档也出标签，见
    /// [`SpeakerLabels::from_words_allow_single`]）。
    pub labels: SpeakerLabels,
    /// 开场白证据的词区间（左闭右开）。
    pub opening: std::ops::Range<usize>,
    /// 每个待命名说话人的首次登场证据区间；与 `targets` 同序，落在开场白
    /// 窗口里的说话人为 `None`（证据已在开场白里，不重复发）。
    pub spotlights: Vec<Option<std::ops::Range<usize>>>,
}

/// 筛出待命名的说话人并规划证据窗口。
///
/// 待命名 = 名字仍是占位（[`is_placeholder_name`]）**且**在 `doc.words` 里还有
/// 词。后一条是必须的：`speaker-repair` 会把假聚簇整个吸收掉，留下一个零词的
/// 说话人条目，给它命名等于凭空发明一个人。
pub fn plan_speaker_names(doc: &TranscriptDoc) -> SpeakerNamesPlan {
    let labels = SpeakerLabels::from_words_allow_single(&doc.words);
    let opening_end = doc.words.len().min(SPEAKER_NAMES_OPENING_WORDS);
    let mut targets: Vec<(String, String)> = Vec::new();
    let mut spotlights: Vec<Option<std::ops::Range<usize>>> = Vec::new();
    // 按标签表的顺序遍历，答案里的标签顺序才与载荷一致。
    for (id, speaker) in &doc.speakers {
        if !is_placeholder_name(&speaker.name, id) {
            continue;
        }
        let Some(label) = labels.label(id) else {
            continue;
        };
        let Some(first) = doc.words.iter().position(|word| &word.sp == id) else {
            continue;
        };
        targets.push((id.clone(), label.to_owned()));
        spotlights.push(if first < opening_end {
            None
        } else {
            let start = first.saturating_sub(SPEAKER_NAMES_CONTEXT_WORDS);
            let end = doc
                .words
                .len()
                .min(first.saturating_add(SPEAKER_NAMES_SPEAKER_WORDS));
            Some(start..end)
        });
    }
    // 标签是 `S<数字>`；按数字排序即"文档里的说话人编号"顺序。
    let mut order: Vec<usize> = (0..targets.len()).collect();
    order.sort_by_key(|&index| label_number(&targets[index].1));
    let sorted_targets = order.iter().map(|&index| targets[index].clone()).collect();
    let sorted_spotlights = order
        .iter()
        .map(|&index| spotlights[index].clone())
        .collect();
    SpeakerNamesPlan {
        targets: sorted_targets,
        labels,
        opening: 0..opening_end,
        spotlights: sorted_spotlights,
    }
}

/// `S12` → 12；不可解析（理论上不会发生）排到最后。
fn label_number(label: &str) -> usize {
    label
        .trim_start_matches(['S', 's'])
        .parse::<usize>()
        .unwrap_or(usize::MAX)
}

fn timecode(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    format!(
        "{:02}:{:02}:{:02}",
        total / 3600,
        (total / 60) % 60,
        total % 60
    )
}

/// 渲染证据载荷（`speaker-names` 的 file-v1 纯文本载体）。
pub fn render_speaker_names_page(doc: &TranscriptDoc, plan: &SpeakerNamesPlan) -> String {
    let labels = Some(&plan.labels);
    let mut out = String::new();
    let opening = &doc.words[plan.opening.clone()];
    out.push_str(&format!(
        "{FENCE_OPENING} | {} words | speakers {}>>>\n",
        opening.len(),
        plan.labels.all_labels().join(",")
    ));
    // 开场白起手的说话人没有切换标记，显式补一个，否则模型分不清第一段是谁说的。
    if let Some(first) = opening.first()
        && let Some(label) = plan.labels.label(&first.sp)
    {
        out.push_str(&format!("⏹{label} "));
    }
    out.push_str(&marked_text_labeled(opening, labels));
    out.push('\n');
    out.push_str(FENCE_OPENING_END);
    out.push('\n');
    for ((_, label), spotlight) in plan.targets.iter().zip(&plan.spotlights) {
        let Some(range) = spotlight else {
            continue;
        };
        let words = &doc.words[range.clone()];
        let at = words.first().map(|word| word.t0).unwrap_or_default();
        out.push('\n');
        out.push_str(&format!(
            "{FENCE_SPEAKER} {label} | first speaks around {} | {} words>>>\n",
            timecode(at),
            words.len()
        ));
        if let Some(first) = words.first()
            && let Some(label) = plan.labels.label(&first.sp)
        {
            out.push_str(&format!("⏹{label} "));
        }
        out.push_str(&marked_text_labeled(words, labels));
        out.push('\n');
        out.push_str(FENCE_SPEAKER_END);
        out.push('\n');
    }
    out.push('\n');
    out.push_str(FENCE_ASK);
    out.push('\n');
    for (_, label) in &plan.targets {
        out.push_str(label);
        out.push('\n');
    }
    out.push_str(FENCE_ASK_END);
    out.push('\n');
    out
}

/// 载荷里被问到的标签（`<<<NAMES-ASK>>>` 块），按载荷顺序。
///
/// 这是 lint 与引擎共用的**唯一**期望集合来源：agent 侧只拿得到载荷与答案，
/// 拿不到 `SpeakerNamesPlan`。
pub fn speaker_names_asked(payload: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut inside = false;
    for line in payload.lines() {
        let line = line.trim();
        if line == FENCE_ASK {
            inside = true;
            continue;
        }
        if line == FENCE_ASK_END {
            break;
        }
        if inside && !line.is_empty() {
            out.push(line.to_owned());
        }
    }
    out
}

/// 解析结果：与载荷问的标签同序，`None` = 模型回了 `?`。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SpeakerNamesParsed {
    /// `(标签, 名字)`；整份答案不可用时为空。
    pub names: Vec<(String, Option<String>)>,
    pub problems: Vec<Problem>,
}

/// 名字是否可接受：非空、单行、不超长、不含 `=`、本身不是占位名。
fn valid_name(label: &str, name: &str) -> Result<(), &'static str> {
    if name.is_empty() {
        return Err("名字为空——证据不足时回 `?`，不要回空值");
    }
    if name.chars().count() > SPEAKER_NAMES_MAX_NAME_CHARS {
        return Err("名字超过长度上限——只回名字本身，不要复述介绍语");
    }
    if name.contains('=') || name.contains('\t') {
        return Err("名字含非法字符（`=` / 制表符）");
    }
    if is_placeholder_name(name, label) {
        return Err("名字仍是占位标签（`S1` / `Speaker 1`）——证据不足时回 `?`");
    }
    Ok(())
}

/// 解析并校验答案。判据全是算术与字符串级：标签集必须与载荷所问**恰好相等**、
/// 不重复、值要么是 `?` 要么是合法名字。任一不满足即整份答案不可用（这一波
/// 只有一次调用，没有「部分接受」的意义——重发一次比落一半名字更划算）。
pub fn parse_speaker_names_page(payload: &str, answer: &str) -> SpeakerNamesParsed {
    let asked = speaker_names_asked(payload);
    let mut parsed = SpeakerNamesParsed::default();
    let Some(body) = fenced_body(answer) else {
        parsed.problems.push(Problem {
            code: ProblemCode::DocumentWrapped,
            scope: ProblemScope::Document,
            detail: format!("答案必须整段包在 `{FENCE_NAMES}` … `{FENCE_NAMES_END}` 之间"),
        });
        return parsed;
    };
    let mut seen: Vec<(String, Option<String>)> = Vec::new();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((label, value)) = line.split_once('=') else {
            parsed.problems.push(Problem {
                code: ProblemCode::SpeakerNameInvalid,
                scope: ProblemScope::Document,
                detail: format!("`{line}` 不是 `标签 = 名字` 形式"),
            });
            return parsed;
        };
        let label = label.trim().to_ascii_uppercase();
        let value = value.trim();
        if !asked
            .iter()
            .any(|wanted| wanted.eq_ignore_ascii_case(&label))
        {
            parsed.problems.push(Problem {
                code: ProblemCode::UnknownId,
                scope: ProblemScope::Document,
                detail: format!("`{label}` 不在被问的标签里（{}）", asked.join(", ")),
            });
            return parsed;
        }
        if seen.iter().any(|(seen_label, _)| *seen_label == label) {
            parsed.problems.push(Problem {
                code: ProblemCode::DuplicateId,
                scope: ProblemScope::Document,
                detail: format!("`{label}` 出现了多次，每个标签只回一行"),
            });
            return parsed;
        }
        if value == UNKNOWN_ANSWER {
            seen.push((label, None));
            continue;
        }
        if let Err(reason) = valid_name(&label, value) {
            parsed.problems.push(Problem {
                code: ProblemCode::SpeakerNameInvalid,
                scope: ProblemScope::Document,
                detail: format!("`{label}` 的答案不合法：{reason}"),
            });
            return parsed;
        }
        seen.push((label, Some(value.to_owned())));
    }
    let missing: Vec<&str> = asked
        .iter()
        .filter(|wanted| {
            !seen
                .iter()
                .any(|(label, _)| label.eq_ignore_ascii_case(wanted))
        })
        .map(String::as_str)
        .collect();
    if !missing.is_empty() {
        parsed.problems.push(Problem {
            code: ProblemCode::MissingId,
            scope: ProblemScope::Document,
            detail: format!(
                "缺少标签 {}——每个被问到的标签都要回一行，不知道就回 `?`",
                missing.join(", ")
            ),
        });
        return parsed;
    }
    parsed.names = seen;
    parsed
}

/// 取 `<<<NAMES>>>` … `<<<NAMES-END>>>` 之间的正文；缺栅栏返回 `None`。
fn fenced_body(answer: &str) -> Option<String> {
    let mut inside = false;
    let mut closed = false;
    let mut body = String::new();
    for line in answer.lines() {
        let trimmed = line.trim();
        if trimmed == FENCE_NAMES {
            inside = true;
            body.clear();
            continue;
        }
        if trimmed == FENCE_NAMES_END {
            if !inside {
                return None;
            }
            closed = true;
            break;
        }
        if inside {
            body.push_str(line);
            body.push('\n');
        }
    }
    (inside && closed).then_some(body)
}

/// agent 侧 `task submit` 对 speaker-names 答案的镜像 lint。
pub fn lint_agent_answer_speaker_names(payload: &str, answer: &str) -> Vec<String> {
    parse_speaker_names_page(payload, answer)
        .problems
        .iter()
        .map(|problem| format!("{}: {}", problem.code.as_str(), problem.detail))
        .collect()
}

/// 系统提示词。与 [`super::speaker_repair::speaker_repair_system_prompt`] 不同，
/// 这里**必须**吃到项目/来源元数据与 analysis 的命名实体：第三方介绍常常只在
/// 标题、频道名或简介里给出全名（"Andrew Ng"），正文里只剩 "Andrew"。
pub fn speaker_names_system_prompt(
    reference_context: Option<&str>,
    summary: Option<&str>,
    named_entities: &[String],
) -> String {
    let mut prompt = format!(
        r#"You identify WHO IS SPEAKING in a transcript whose speakers are still anonymous.

Automatic diarization only produces voice ids (S1, S2 …). Your job is to attach a real name to each anonymous speaker USING THE EVIDENCE BELOW AND NOTHING ELSE.

The payload contains the opening of the transcript, then one excerpt per speaker you are asked about, then the list of labels to answer. `⏹S2` marks the point where S2 starts talking; `⏸` marks a pause. Both are metadata — never copy them back.

Answer with ONE LINE PER ASKED LABEL, wrapped in the fences, and NOTHING else:

{FENCE_NAMES}
S1 = Jordan Wilson
S2 = Andrew Ng
{FENCE_NAMES_END}

Rules:
- Answer every asked label exactly once, in the order they are asked. No extra labels.
- Give the person's name as it is actually used in this material — usually the full name ("Andrew Ng"), otherwise the form that appears ("Andrew"). Keep the original script and spelling; do not translate or transliterate a name.
- Evidence that counts: a self-introduction ("my name is …", "我是…"), an introduction by the other side ("today I'm joined by …", "有请…", "welcome, …"), being addressed by name ("Andrew, what do you think"), a sign-off, or the project/source metadata below when it unambiguously names one of the voices.
- When the speaker has no name in the evidence but the material clearly states their role (the host of a named show, the interviewer, the narrator), a short role label is acceptable — never invent one from the mere shape of the conversation.
- If you cannot name a speaker from the evidence, answer `{UNKNOWN_ANSWER}`. Guessing is strictly worse than `{UNKNOWN_ANSWER}`: a wrong name is shown to the user on every subtitle line and in the exported file.
- Never answer with a placeholder such as `S1`, `Speaker 1`, `Unknown`, `未知` — those are exactly what `{UNKNOWN_ANSWER}` is for.
- Do not add titles, honorifics, affiliations, parentheses, quotes or explanations. The name only, at most {SPEAKER_NAMES_MAX_NAME_CHARS} characters."#
    );
    if let Some(context) = reference_context.map(str::trim).filter(|s| !s.is_empty()) {
        prompt.push_str("\n\nProject / source metadata:\n");
        prompt.push_str(context);
    }
    if let Some(summary) = summary.map(str::trim).filter(|s| !s.is_empty()) {
        prompt.push_str("\n\nWhat this material is about:\n");
        prompt.push_str(summary);
    }
    if !named_entities.is_empty() {
        prompt.push_str("\n\nNames and proper nouns already extracted from this material (a speaker's name is often among them, but many of these are merely mentioned, not present):\n");
        prompt.push_str(&named_entities.join(", "));
    }
    prompt
}

/// speaker-names 波次。返回是否真的写了名字。
///
/// `enabled=false`、空文档、定向重润（`scoped`）或没有占位说话人时整波跳过、
/// `report.skipped` 给出原因。答案被拒时最多重发到
/// [`SPEAKER_NAMES_MAX_ROUNDS`] 轮，仍不可用就保持占位名（`report.rejected`）。
///
/// 只写 `speakers[<id>].name`，且**只覆盖占位名**：一次波次内两次读取
/// 占位判据（规划时、落盘前），用户在这中间改过名字的说话人不会被盖掉。
pub fn speaker_names_wave(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    enabled: bool,
    scoped: bool,
    reference_context: Option<&str>,
    summary: Option<&str>,
    named_entities: &[String],
    report: &mut SpeakerNamesReport,
    on_attempt: &mut dyn FnMut(&PageAttempt<'_>),
) -> Result<bool, LlmError> {
    if !enabled {
        report.skipped = Some("disabled".to_owned());
        return Ok(false);
    }
    if doc.words.is_empty() {
        report.skipped = Some("no-words".to_owned());
        return Ok(false);
    }
    if scoped {
        report.skipped = Some("scoped-run".to_owned());
        return Ok(false);
    }
    let plan = plan_speaker_names(doc);
    if plan.targets.is_empty() {
        report.skipped = Some("no-placeholders".to_owned());
        return Ok(false);
    }
    report.targets = plan.targets.len() as u32;
    let payload = render_speaker_names_page(doc, &plan);
    let system = speaker_names_system_prompt(reference_context, summary, named_entities);
    let mut retry_reason: Option<String> = None;
    let mut answer: Option<Vec<(String, Option<String>)>> = None;
    for round in 1..=SPEAKER_NAMES_MAX_ROUNDS {
        let request = LlmRequest {
            kind: "speaker-names",
            system: system.clone(),
            user: payload.clone(),
            temperature: 0.0,
            attempt: round,
            retry_reason: retry_reason.take(),
        };
        report.calls += 1;
        let raw = match llm.complete_batch(std::slice::from_ref(&request)).pop() {
            Some(Ok(raw)) => raw,
            Some(Err(error)) if error.is_retryable() => continue,
            Some(Err(error)) => return Err(error),
            // 宿主返回空批：当作一次不可重试的协议故障，保持占位名。
            None => break,
        };
        let parsed = parse_speaker_names_page(&payload, &raw);
        on_attempt(&PageAttempt {
            page_id: &format!("sn-{round:03}"),
            attempt: round,
            input: &payload,
            output: &raw,
            problems: &parsed.problems,
            accepted: !parsed.names.is_empty(),
        });
        if !parsed.names.is_empty() {
            answer = Some(parsed.names);
            break;
        }
        retry_reason = Some(format!(
            "[{}] {}",
            parsed
                .problems
                .first()
                .map(|problem| problem.code.as_str())
                .unwrap_or("speaker-name-invalid"),
            parsed
                .problems
                .first()
                .map(|problem| problem.detail.as_str())
                .unwrap_or("答案不可用，请按契约只回 `标签 = 名字` 行")
        ));
    }
    let Some(names) = answer else {
        report.rejected = true;
        return Ok(false);
    };
    let mut changed = false;
    for (label, name) in names {
        let Some(name) = name else {
            report.unknown += 1;
            continue;
        };
        report.proposed += 1;
        let Some(id) = plan.labels.speaker_for_label(&label).map(str::to_owned) else {
            continue;
        };
        let Some(speaker) = doc.speakers.get_mut(&id) else {
            continue;
        };
        // 落盘前复核占位判据：用户改过名字的说话人绝不覆盖。
        if !is_placeholder_name(&speaker.name, &id) {
            continue;
        }
        speaker.name = name.clone();
        report.names.push((id, name));
        report.named += 1;
        changed = true;
    }
    report.names.sort();
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia, Speaker, Word};

    fn word(index: usize, text: &str, sp: &str) -> Word {
        let t0 = index as f64 * 0.4;
        Word {
            id: format!("w{index}"),
            t0,
            t1: t0 + 0.35,
            text: text.to_owned(),
            sp: sp.to_owned(),
            glue: false,
        }
    }

    /// 主持人开场介绍嘉宾：证据在开场白里，嘉宾的名字只由**对方**说出。
    fn interview(ids: [&str; 2], names: [&str; 2]) -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: String::new(),
                duration: 60.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        for (id, name) in ids.iter().zip(names) {
            doc.speakers.insert(
                (*id).to_owned(),
                Speaker {
                    name: name.to_owned(),
                    hue: None,
                },
            );
        }
        let script: Vec<(&str, usize)> = vec![
            ("Welcome", 0),
            ("back.", 0),
            ("Today", 0),
            ("I'm", 0),
            ("joined", 0),
            ("by", 0),
            ("Andrew", 0),
            ("Ng.", 0),
            ("Thanks", 1),
            ("for", 1),
            ("having", 1),
            ("me,", 1),
            ("Jordan.", 1),
        ];
        doc.words = script
            .into_iter()
            .enumerate()
            .map(|(index, (text, who))| word(index, text, ids[who]))
            .collect();
        doc
    }

    fn answer(lines: &[&str]) -> String {
        format!("{FENCE_NAMES}\n{}\n{FENCE_NAMES_END}\n", lines.join("\n"))
    }

    /// 顺序回放的假 LLM。
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

    fn run(
        doc: &mut TranscriptDoc,
        llm: &mut Scripted,
        enabled: bool,
        scoped: bool,
    ) -> (bool, SpeakerNamesReport) {
        let mut report = SpeakerNamesReport::default();
        let changed = speaker_names_wave(
            doc,
            llm,
            enabled,
            scoped,
            None,
            None,
            &[],
            &mut report,
            &mut |_| {},
        )
        .unwrap();
        (changed, report)
    }

    #[test]
    fn plan_targets_placeholders_that_still_have_words() {
        let mut doc = interview(["s1", "s2"], ["S01", "S02"]);
        // speaker-repair 把 s3 的假聚簇整个吸收掉，只剩一个零词条目。
        doc.speakers.insert(
            "s3".to_owned(),
            Speaker {
                name: "S03".to_owned(),
                hue: None,
            },
        );
        let plan = plan_speaker_names(&doc);
        assert_eq!(
            plan.targets,
            vec![
                ("s1".to_owned(), "S1".to_owned()),
                ("s2".to_owned(), "S2".to_owned())
            ]
        );
    }

    #[test]
    fn plan_skips_speakers_the_user_already_named() {
        let doc = interview(["s1", "s2"], ["Jordan Wilson", "S02"]);
        let plan = plan_speaker_names(&doc);
        assert_eq!(plan.targets, vec![("s2".to_owned(), "S2".to_owned())]);
    }

    #[test]
    fn single_speaker_document_still_gets_a_label() {
        let mut doc = interview(["s1", "s2"], ["S01", "S02"]);
        for w in &mut doc.words {
            w.sp = "s1".to_owned();
        }
        doc.speakers.remove("s2");
        let plan = plan_speaker_names(&doc);
        assert_eq!(plan.targets, vec![("s1".to_owned(), "S1".to_owned())]);
        let payload = render_speaker_names_page(&doc, &plan);
        assert_eq!(speaker_names_asked(&payload), vec!["S1".to_owned()]);
    }

    #[test]
    fn payload_asks_every_target_and_carries_the_opening() {
        let doc = interview(["s1", "s2"], ["S01", "S02"]);
        let plan = plan_speaker_names(&doc);
        let payload = render_speaker_names_page(&doc, &plan);
        assert_eq!(
            speaker_names_asked(&payload),
            vec!["S1".to_owned(), "S2".to_owned()]
        );
        assert!(payload.contains("Today I'm joined by Andrew Ng."));
        // 开场白首句的说话人显式补标记，模型才分得清第一段是谁说的。
        assert!(payload.contains("⏹S1 Welcome"));
        assert!(payload.contains("⏹S2"));
        // 两位说话人都在开场白窗口里，不再补发单独的登场证据块。
        assert!(!payload.contains(FENCE_SPEAKER));
    }

    #[test]
    fn payload_adds_a_spotlight_for_a_late_speaker() {
        let mut doc = interview(["s1", "s2"], ["S01", "S02"]);
        let tail: Vec<Word> = (0..SPEAKER_NAMES_OPENING_WORDS)
            .map(|index| word(100 + index, "filler", "s1"))
            .collect();
        let late = word(9000, "Hi.", "s2");
        doc.words.retain(|w| w.sp == "s1");
        doc.words.extend(tail);
        doc.words.push(late);
        let plan = plan_speaker_names(&doc);
        assert_eq!(plan.spotlights[0], None);
        assert!(plan.spotlights[1].is_some());
        let payload = render_speaker_names_page(&doc, &plan);
        assert!(payload.contains(&format!("{FENCE_SPEAKER} S2 |")));
    }

    #[test]
    fn wave_writes_names_and_reports() {
        let mut doc = interview(["s1", "s2"], ["S01", "S02"]);
        let mut llm = Scripted {
            answers: vec![answer(&["S1 = Jordan Wilson", "S2 = Andrew Ng"])],
            seen: Vec::new(),
        };
        let (changed, report) = run(&mut doc, &mut llm, true, false);
        assert!(changed);
        assert_eq!(llm.seen.len(), 1);
        assert_eq!(llm.seen[0].kind, "speaker-names");
        assert_eq!(doc.speakers["s1"].name, "Jordan Wilson");
        assert_eq!(doc.speakers["s2"].name, "Andrew Ng");
        assert_eq!(report.skipped, None);
        assert_eq!((report.targets, report.calls, report.named), (2, 1, 2));
        assert_eq!(
            (report.proposed, report.unknown, report.rejected),
            (2, 0, false)
        );
        assert_eq!(
            report.names,
            vec![
                ("s1".to_owned(), "Jordan Wilson".to_owned()),
                ("s2".to_owned(), "Andrew Ng".to_owned())
            ]
        );
    }

    #[test]
    fn wave_maps_labels_back_through_the_label_table_not_the_digits() {
        // id 不是 `s<数字>` ⇒ 标签退回首次出现序号，`S2` 并不意味着 id `s2`。
        let mut doc = interview(["spk-b", "spk-a"], ["S01", "S02"]);
        let plan = plan_speaker_names(&doc);
        assert_eq!(
            plan.targets,
            vec![
                ("spk-b".to_owned(), "S1".to_owned()),
                ("spk-a".to_owned(), "S2".to_owned())
            ]
        );
        let mut llm = Scripted {
            answers: vec![answer(&["S1 = Jordan Wilson", "S2 = Andrew Ng"])],
            seen: Vec::new(),
        };
        let (changed, _) = run(&mut doc, &mut llm, true, false);
        assert!(changed);
        assert_eq!(doc.speakers["spk-b"].name, "Jordan Wilson");
        assert_eq!(doc.speakers["spk-a"].name, "Andrew Ng");
    }

    #[test]
    fn wave_keeps_placeholder_when_the_model_answers_unknown() {
        let mut doc = interview(["s1", "s2"], ["S01", "S02"]);
        let mut llm = Scripted {
            answers: vec![answer(&["S1 = Jordan Wilson", "S2 = ?"])],
            seen: Vec::new(),
        };
        let (changed, report) = run(&mut doc, &mut llm, true, false);
        assert!(changed);
        assert_eq!(doc.speakers["s2"].name, "S02");
        assert_eq!((report.named, report.unknown), (1, 1));
    }

    #[test]
    fn wave_retries_once_then_accepts() {
        let mut doc = interview(["s1", "s2"], ["S01", "S02"]);
        let mut llm = Scripted {
            answers: vec![
                "S1 = Jordan Wilson\nS2 = Andrew Ng".to_owned(),
                answer(&["S1 = Jordan Wilson", "S2 = Andrew Ng"]),
            ],
            seen: Vec::new(),
        };
        let (changed, report) = run(&mut doc, &mut llm, true, false);
        assert!(changed);
        assert_eq!(report.calls, 2);
        assert_eq!(llm.seen[0].retry_reason, None);
        let retry = llm.seen[1].retry_reason.as_deref().unwrap_or_default();
        assert!(retry.contains("document-wrapped"), "{retry}");
        assert_eq!(doc.speakers["s2"].name, "Andrew Ng");
    }

    #[test]
    fn wave_gives_up_after_the_round_cap_and_keeps_placeholders() {
        let mut doc = interview(["s1", "s2"], ["S01", "S02"]);
        let mut llm = Scripted {
            answers: vec![
                answer(&["S1 = Jordan Wilson"]),
                answer(&["S9 = Nobody"]),
                answer(&["S1 = Jordan Wilson", "S2 = Andrew Ng"]),
            ],
            seen: Vec::new(),
        };
        let (changed, report) = run(&mut doc, &mut llm, true, false);
        assert!(!changed);
        assert!(report.rejected);
        assert_eq!(report.calls, SPEAKER_NAMES_MAX_ROUNDS);
        assert_eq!(doc.speakers["s1"].name, "S01");
        assert_eq!(doc.speakers["s2"].name, "S02");
    }

    #[test]
    fn wave_skips_when_disabled_scoped_or_without_placeholders() {
        for (enabled, scoped, names, reason) in [
            (false, false, ["S01", "S02"], "disabled"),
            (true, true, ["S01", "S02"], "scoped-run"),
            (
                true,
                false,
                ["Jordan Wilson", "Andrew Ng"],
                "no-placeholders",
            ),
        ] {
            let mut doc = interview(["s1", "s2"], names);
            let mut llm = Scripted {
                answers: Vec::new(),
                seen: Vec::new(),
            };
            let (changed, report) = run(&mut doc, &mut llm, enabled, scoped);
            assert!(!changed);
            assert_eq!(report.skipped.as_deref(), Some(reason));
            assert_eq!(report.calls, 0);
            assert!(llm.seen.is_empty());
        }
        let mut doc = interview(["s1", "s2"], ["S01", "S02"]);
        doc.words.clear();
        let mut llm = Scripted {
            answers: Vec::new(),
            seen: Vec::new(),
        };
        let (changed, report) = run(&mut doc, &mut llm, true, false);
        assert!(!changed);
        assert_eq!(report.skipped.as_deref(), Some("no-words"));
    }

    #[test]
    fn parse_accepts_the_contract_and_rejects_every_deviation() {
        let doc = interview(["s1", "s2"], ["S01", "S02"]);
        let payload = render_speaker_names_page(&doc, &plan_speaker_names(&doc));
        let good = answer(&["S1 = Jordan Wilson", "S2 = ?"]);
        let parsed = parse_speaker_names_page(&payload, &good);
        assert!(parsed.problems.is_empty());
        assert_eq!(
            parsed.names,
            vec![
                ("S1".to_owned(), Some("Jordan Wilson".to_owned())),
                ("S2".to_owned(), None)
            ]
        );
        assert!(lint_agent_answer_speaker_names(&payload, &good).is_empty());

        let long = "N".repeat(SPEAKER_NAMES_MAX_NAME_CHARS + 1);
        for (bad, code) in [
            (
                "S1 = Jordan Wilson\nS2 = Andrew Ng".to_owned(),
                "document-wrapped",
            ),
            (
                answer(&["S1 Jordan Wilson", "S2 = Andrew Ng"]),
                "speaker-name-invalid",
            ),
            (
                answer(&["S1 = Jordan Wilson", "S7 = Andrew Ng"]),
                "unknown-id",
            ),
            (
                answer(&["S1 = Jordan Wilson", "S1 = Andrew Ng"]),
                "duplicate-id",
            ),
            (answer(&["S1 = Jordan Wilson"]), "missing-id"),
            (answer(&["S1 = ", "S2 = Andrew Ng"]), "speaker-name-invalid"),
            (
                answer(&["S1 = Speaker 1", "S2 = Andrew Ng"]),
                "speaker-name-invalid",
            ),
            (
                answer(&[&format!("S1 = {long}"), "S2 = Andrew Ng"]),
                "speaker-name-invalid",
            ),
        ] {
            let parsed = parse_speaker_names_page(&payload, &bad);
            assert!(parsed.names.is_empty(), "{bad}");
            assert_eq!(
                parsed.problems.first().map(|problem| problem.code.as_str()),
                Some(code),
                "{bad}"
            );
            assert!(!lint_agent_answer_speaker_names(&payload, &bad).is_empty());
        }
    }

    #[test]
    fn system_prompt_carries_the_metadata_evidence() {
        let prompt = speaker_names_system_prompt(
            Some("Title: Andrew Ng on agentic AI"),
            Some("An interview about AI agents."),
            &["Andrew Ng".to_owned(), "Stanford".to_owned()],
        );
        assert!(prompt.contains("Title: Andrew Ng on agentic AI"));
        assert!(prompt.contains("An interview about AI agents."));
        assert!(prompt.contains("Andrew Ng, Stanford"));
        assert!(prompt.contains(FENCE_NAMES));
        // 空元数据不留下空标题。
        let bare = speaker_names_system_prompt(Some("  "), None, &[]);
        assert!(!bare.contains("Project / source metadata"));
    }
}
