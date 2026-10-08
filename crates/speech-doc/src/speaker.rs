//! 说话人派生：轮次序列、payload 软标记用的稳定短标签，以及实名候选。
//!
//! 实名候选对拍 BaoCut `CLISpeakerProposeNames` 的窄启发式：只产出证据，
//! 不猜声音身份。英文/中文自我介绍捕获到的名字必须与 analysis 的
//! namedEntities 交叉验证，才标为 high confidence。
//!
//! 轮次（[`speaker_turns`]）与标签（[`SpeakerLabels`]）是纯派生：`words[].sp`
//! 是说话人的唯一真相，两者都不落盘、不进输出。

use std::collections::BTreeMap;
use std::ops::Range;

use serde::Serialize;

use crate::cue::join_words;
use crate::doc::{TranscriptDoc, Word};
use crate::row_mapping::{row_has_atoms, row_index_of, sorted_nonempty_rows};

/// 说话人轮次：`sp` 相同的极大连续词段（左闭右开）。
///
/// 空词流返回空表；全篇同一个 `sp`（含"没有说话人信息"的常见形态）返回
/// **恰好一个**轮次——调用方以 `len() > 1` 判定"这篇有说话人信息"。
pub fn speaker_turns(words: &[Word]) -> Vec<Range<usize>> {
    let mut turns: Vec<Range<usize>> = Vec::new();
    let mut start = 0usize;
    for index in 1..words.len() {
        if words[index].sp != words[index - 1].sp {
            turns.push(start..index);
            start = index;
        }
    }
    if !words.is_empty() {
        turns.push(start..words.len());
    }
    turns
}

/// 说话人 → payload 软标记里的稳定短标签（`S1` / `S2` …）。
///
/// 规则（确定性，只看本次投影的词切片，不读 `speakers` 表）：
///
/// 1. 按**首次出现顺序**收集所有 `sp`；
/// 2. 少于 2 个说话人 ⇒ 空表——单说话人的文档不会有说话人切换，也就没有
///    标记可标；
/// 3. 若每个 id 都形如 `s<digits>`（大小写不敏感、1–4 位数字、去重后互不
///    相同）⇒ 标签取该数字：`s2` → `S2`，与三端 UI 的说话人编号一致；
/// 4. 否则整表回落到首次出现序号：`S1`、`S2`……
///
/// 同一份词流恒得同一张表，因此同一说话人在所有页里的标签一致；标签只进
/// payload 副本，禁止进入输出（返回侧由 [`crate::engines::markers`] 剥除）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SpeakerLabels {
    labels: BTreeMap<String, String>,
}

impl SpeakerLabels {
    /// 从词切片派生标签表（规则见结构体文档）。
    pub fn from_words(words: &[Word]) -> Self {
        Self::derive(words, 2)
    }

    /// [`Self::from_words`] 的**单说话人也出标签**形态（编号规则完全相同）。
    ///
    /// payload 软标记要的是"哪里换人"，单说话人没有切换点，所以
    /// [`Self::from_words`] 直接返回空表。但实名推断要的是"这个声音叫什么"，
    /// 独白同样需要一个可寻址的标签（`S1`）——两者的需求不同，编号规则相同。
    pub fn from_words_allow_single(words: &[Word]) -> Self {
        Self::derive(words, 1)
    }

    fn derive(words: &[Word], min_speakers: usize) -> Self {
        let mut order: Vec<&str> = Vec::new();
        for word in words {
            if !order.iter().any(|sp| *sp == word.sp) {
                order.push(&word.sp);
            }
        }
        if order.len() < min_speakers {
            return Self::default();
        }
        let numeric: Option<Vec<usize>> = order
            .iter()
            .map(|sp| {
                let digits = sp.strip_prefix('s').or_else(|| sp.strip_prefix('S'))?;
                (!digits.is_empty()
                    && digits.len() <= 4
                    && digits.chars().all(|ch| ch.is_ascii_digit()))
                .then(|| digits.parse::<usize>().ok())
                .flatten()
                .filter(|value| *value > 0)
            })
            .collect();
        let numbers = numeric.filter(|values| {
            let mut sorted = values.clone();
            sorted.sort_unstable();
            sorted.dedup();
            sorted.len() == values.len()
        });
        let labels = order
            .iter()
            .enumerate()
            .map(|(index, sp)| {
                let number = numbers.as_ref().map_or(index + 1, |values| values[index]);
                ((*sp).to_owned(), format!("S{number}"))
            })
            .collect();
        Self { labels }
    }

    /// 该说话人的标签；单说话人文档恒为 `None`。
    pub fn label(&self, speaker: &str) -> Option<&str> {
        self.labels.get(speaker).map(String::as_str)
    }

    /// 是否没有任何标签（单说话人或空词流）。
    pub fn is_empty(&self) -> bool {
        self.labels.is_empty()
    }

    /// 全部标签，按说话人 id 升序（`BTreeMap` 顺序）。
    pub fn all_labels(&self) -> Vec<&str> {
        self.labels.values().map(String::as_str).collect()
    }

    /// 标签 → 说话人 id（大小写不敏感：`s2` / `S2` 都认）；不在表里为 `None`。
    pub fn speaker_for_label(&self, label: &str) -> Option<&str> {
        let wanted = label.trim().to_ascii_uppercase();
        self.labels
            .iter()
            .find(|(_, candidate)| candidate.to_ascii_uppercase() == wanted)
            .map(|(speaker, _)| speaker.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerNameCandidate {
    pub speaker: String,
    pub current_name: String,
    pub name: String,
    pub confidence: String,
    pub pattern: String,
    pub quote: String,
}

/// 名字是否仍是占位：等于说话人 id 本身、`s<数字>` 或 `speaker <数字>`。
///
/// 用户改过的名字永远不满足这个判据——所有自动命名路径都以它为写入闸门。
pub fn is_placeholder_name(name: &str, id: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    lower == id.to_ascii_lowercase()
        || lower
            .strip_prefix('s')
            .is_some_and(|tail| !tail.is_empty() && tail.chars().all(|ch| ch.is_ascii_digit()))
        || lower
            .strip_prefix("speaker ")
            .is_some_and(|tail| !tail.is_empty() && tail.chars().all(|ch| ch.is_ascii_digit()))
}

fn normalized_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn matches_entity(name: &str, entities: &[String]) -> bool {
    let needle = normalized_name(name);
    !needle.is_empty()
        && entities.iter().any(|entity| {
            let entity = normalized_name(entity);
            entity == needle || entity.contains(&needle) || needle.contains(&entity)
        })
}

fn trim_name_token(token: &str) -> &str {
    token.trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '\'' && ch != '-')
}

fn latin_name_after(text: &str, marker: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    let start = lower.find(marker)? + marker.len();
    let mut words = Vec::new();
    for raw in text[start..].split_whitespace().take(2) {
        let word = trim_name_token(raw);
        let first = word.chars().next()?;
        if word.len() < 2 || !first.is_uppercase() {
            break;
        }
        words.push(word);
    }
    (!words.is_empty()).then(|| words.join(" "))
}

fn cjk_name_after(text: &str, marker: &str) -> Option<String> {
    let start = text.find(marker)? + marker.len();
    let name: String = text[start..]
        .chars()
        .skip_while(|ch| ch.is_whitespace())
        .take_while(|ch| ('\u{4e00}'..='\u{9fff}').contains(ch))
        .take(4)
        .collect();
    (name.chars().count() >= 2).then_some(name)
}

fn self_intro(text: &str) -> Option<String> {
    // 优先精确的实名句式，避免把 "I'm one of…" 里的 one 当成人名。
    latin_name_after(text, "my name is ")
        .or_else(|| cjk_name_after(text, "我是"))
        .or_else(|| cjk_name_after(text, "我叫"))
}

/// 每个 placeholder speaker 最多返回一个候选。扫描该声音开头最多 240 字符，
/// 因为常见的 "Hi everybody." 会把实名推到第二个字幕 cue。
pub fn propose_names(doc: &TranscriptDoc, entities: &[String]) -> Vec<SpeakerNameCandidate> {
    let mut out = Vec::new();
    for (id, speaker) in &doc.speakers {
        if !is_placeholder_name(&speaker.name, id) {
            continue;
        }
        let words = doc.words.iter().filter(|word| &word.sp == id).take(48);
        let opening: String = join_words(words).chars().take(240).collect();
        let Some(name) = self_intro(&opening) else {
            continue;
        };
        let confidence = if matches_entity(&name, entities) {
            "high"
        } else {
            "medium"
        };
        out.push(SpeakerNameCandidate {
            speaker: id.clone(),
            current_name: speaker.name.clone(),
            name,
            confidence: confidence.to_owned(),
            pattern: "self-intro".to_owned(),
            quote: opening,
        });
    }
    out
}

// ── 行归属还原（联合模型行级说话人 → 词 sp）──

/// 一次行归属还原能触碰的失配串上限：只还原"吸附挪过头 / 岛屿被吸收"这种
/// 形态（Pass 2 的搜索窗是 ±1s，Pass 1 的岛 ≤4 词 ≤1.2s），更长的失配串是
/// 用户或事后 reidentify 的有意 relabel，不动。
pub const ROW_REALIGN_MAX_RUN_WORDS: usize = 6;
pub const ROW_REALIGN_MAX_RUN_SECONDS: f64 = 1.5;
/// 全篇失配率超过此值 ⇒ 说话人归属已被整体改写（reidentify 提案已 accept、
/// 或用户批量改名后重编 id），整次还原跳过——逐串还原只会和那次改写打架。
pub const ROW_REALIGN_MAX_DIVERGENCE: f64 = 0.05;

/// [`realign_to_row_speakers`] 的账目。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowRealignReport {
    /// 能映射回原始行的词数（`g<行>.<列>` 系 id）。
    pub row_words: usize,
    /// 其中 `sp` 与所属行说话人不一致的词数（还原前）。
    pub mismatched_words: usize,
    /// 实际改回行说话人的词数（含夹在失配串里、由邻居推断归属的重绑词）。
    pub realigned_words: usize,
    /// 实际改回的失配串数。
    pub realigned_runs: usize,
    /// 因超过串长/时长上限而保留的失配串数。
    pub kept_runs: usize,
    /// 整次跳过的原因：`no-speaker-rows` / `speaker-table-diverged` /
    /// `row-ownership-diverged`；`None` 表示正常执行（哪怕一处都不用改）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
}

/// 把词的 `sp` 还原成它所属原始行（`ai/asr-rows.json`）的说话人。
///
/// 只对**行级说话人权威**的引擎（MOSS 一类联合模型）有意义：这些行是模型的
/// 文本归属判决，而 [`crate::build::build_doc`] 的两遍吸附（2026-08 前对
/// MOSS 同样生效）会把答句开头的语气词挪给提问者、把无标点分块里的整行应答
/// 并进对方的句子。词 id `g<行>.<列>[~k]` 天然指回行号（行序 = 与 `build_doc`
/// 相同的"去空行、按起点稳定排序"），说话人 id 也按 `build_doc` 的首次出现
/// 顺序重建，因此不依赖 `speakers` 表的显示名（用户可能已改名）。
///
/// 三道闸门（任一不满足即整次跳过，`report.skipped` 给出原因）：
///
/// 1. 行里根本没有说话人标签 ⇒ `no-speaker-rows`；
/// 2. 重建出的说话人 id 有不在 `doc.speakers` 里的 ⇒ `speaker-table-diverged`；
/// 3. 失配词占可映射词的比例 > [`ROW_REALIGN_MAX_DIVERGENCE`] ⇒
///    `row-ownership-diverged`（归属已被整体改写，不该逐串纠正）。
///
/// 通过闸门后按失配串还原：串 ≤ [`ROW_REALIGN_MAX_RUN_WORDS`] 词或 ≤
/// [`ROW_REALIGN_MAX_RUN_SECONDS`] 秒才改，更长的保留（计 `kept_runs`）。
/// 重绑过的词（`w…` id，没有行号）夹在失配串里时随串处理：前后最近的可映射
/// 词行说话人一致才把它算进这一串，否则不动。
pub fn realign_to_row_speakers(
    doc: &mut TranscriptDoc,
    rows: &[crate::asr_rows::RowIn],
) -> RowRealignReport {
    let mut report = RowRealignReport::default();
    if !rows.iter().any(|row| row.speaker.is_some()) {
        report.skipped = Some("no-speaker-rows".to_owned());
        return report;
    }
    // 与 build_doc 同一套行序与说话人 id 分配。
    let sorted = sorted_nonempty_rows(rows);
    let mut speaker_ids: BTreeMap<String, String> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut row_speaker: Vec<Option<String>> = Vec::with_capacity(sorted.len());
    for row in &sorted {
        if !row_has_atoms(row) {
            row_speaker.push(None);
            continue;
        }
        let sp = match row.speaker.as_deref() {
            Some(label) => speaker_ids
                .entry(label.to_owned())
                .or_insert_with(|| {
                    let id = format!("s{}", order.len() + 1);
                    order.push(id.clone());
                    id
                })
                .clone(),
            None => {
                if order.is_empty() {
                    order.push("s1".to_owned());
                }
                order[0].clone()
            }
        };
        row_speaker.push(Some(sp));
    }
    if order.iter().any(|id| !doc.speakers.contains_key(id)) {
        report.skipped = Some("speaker-table-diverged".to_owned());
        return report;
    }

    // 每个词的期望说话人：行 id 直接查表；重绑词由前后最近的行词推断。
    let mut expected: Vec<Option<String>> = doc
        .words
        .iter()
        .map(|word| row_index_of(&word.id).and_then(|row| row_speaker.get(row).cloned().flatten()))
        .collect();
    let row_words = expected.iter().filter(|value| value.is_some()).count();
    report.row_words = row_words;
    if row_words == 0 {
        report.skipped = Some("row-ownership-diverged".to_owned());
        return report;
    }
    let mismatched = doc
        .words
        .iter()
        .zip(&expected)
        .filter(|(word, expected)| expected.as_ref().is_some_and(|sp| *sp != word.sp))
        .count();
    report.mismatched_words = mismatched;
    if mismatched as f64 / row_words as f64 > ROW_REALIGN_MAX_DIVERGENCE {
        report.skipped = Some("row-ownership-diverged".to_owned());
        return report;
    }
    // 重绑词的期望：前一个行词与后一个行词的期望一致才继承，否则不动。
    let mut previous: Option<String> = None;
    let mut fill: Vec<Option<String>> = vec![None; expected.len()];
    for (index, value) in expected.iter().enumerate() {
        match value {
            Some(sp) => previous = Some(sp.clone()),
            None => fill[index] = previous.clone(),
        }
    }
    let mut next: Option<String> = None;
    for index in (0..expected.len()).rev() {
        match &expected[index] {
            Some(sp) => next = Some(sp.clone()),
            None => {
                if fill[index].is_some() && fill[index] != next {
                    fill[index] = None;
                }
            }
        }
    }
    for (slot, filled) in expected.iter_mut().zip(fill) {
        if slot.is_none() {
            *slot = filled;
        }
    }

    // 失配串：连续的「期望有值且 ≠ 当前 sp」的词。
    let mut index = 0;
    while index < doc.words.len() {
        let mismatch = expected[index]
            .as_ref()
            .is_some_and(|sp| *sp != doc.words[index].sp);
        if !mismatch {
            index += 1;
            continue;
        }
        let start = index;
        while index < doc.words.len()
            && expected[index]
                .as_ref()
                .is_some_and(|sp| *sp != doc.words[index].sp)
        {
            index += 1;
        }
        let run = start..index;
        let seconds = doc.words[run.end - 1].t1 - doc.words[run.start].t0;
        if run.len() <= ROW_REALIGN_MAX_RUN_WORDS || seconds <= ROW_REALIGN_MAX_RUN_SECONDS {
            for position in run.clone() {
                let sp = expected[position]
                    .clone()
                    .expect("mismatch implies expected");
                doc.words[position].sp = sp;
            }
            report.realigned_words += run.len();
            report.realigned_runs += 1;
        } else {
            report.kept_runs += 1;
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::doc::{DocEngine, DocMedia, Speaker, TranscriptDoc, Word};

    use super::*;

    fn sample() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 10.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        doc.speakers = BTreeMap::from([(
            "s1".to_owned(),
            Speaker {
                name: "S1".to_owned(),
                hue: Some(222),
            },
        )]);
        for (index, text) in ["Hi,", "everybody.", "My", "name", "is", "Sid", "Bidasaria."]
            .into_iter()
            .enumerate()
        {
            doc.words.push(Word {
                id: format!("g1.{index}"),
                t0: index as f64,
                t1: index as f64 + 0.5,
                text: text.to_owned(),
                sp: "s1".to_owned(),
                glue: false,
            });
        }
        doc
    }

    #[test]
    fn proposes_cross_checked_name_after_greeting() {
        let candidates = propose_names(&sample(), &["Sid Bidasaria".to_owned()]);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].name, "Sid Bidasaria");
        assert_eq!(candidates[0].confidence, "high");
    }

    fn spoken(speakers: &[&str]) -> Vec<Word> {
        speakers
            .iter()
            .enumerate()
            .map(|(index, sp)| Word {
                id: format!("g{index}"),
                t0: index as f64,
                t1: index as f64 + 0.5,
                text: "aaaa".to_owned(),
                sp: (*sp).to_owned(),
                glue: false,
            })
            .collect()
    }

    #[test]
    fn turns_are_maximal_runs_of_one_speaker() {
        assert!(speaker_turns(&[]).is_empty());
        assert_eq!(speaker_turns(&spoken(&["s1", "s1", "s1"])), vec![0..3]);
        assert_eq!(
            speaker_turns(&spoken(&["s1", "s1", "s2", "s1", "s1"])),
            vec![0..2, 2..3, 3..5]
        );
    }

    #[test]
    fn labels_follow_speaker_ids_and_fall_back_to_first_use_order() {
        // 单说话人没有切换点，也就没有标签。
        assert!(SpeakerLabels::from_words(&spoken(&["s1", "s1"])).is_empty());

        // 规范 id：标签取 id 里的数字，与 UI 编号一致（首次出现顺序无关）。
        let canonical = SpeakerLabels::from_words(&spoken(&["s2", "s1", "s2"]));
        assert_eq!(canonical.label("s2"), Some("S2"));
        assert_eq!(canonical.label("s1"), Some("S1"));
        assert_eq!(canonical.label("s3"), None);

        // 非规范 id（或数字冲突）：整表回落到首次出现序号。
        let fallback = SpeakerLabels::from_words(&spoken(&["host", "s1", "host"]));
        assert_eq!(fallback.label("host"), Some("S1"));
        assert_eq!(fallback.label("s1"), Some("S2"));
        let collision = SpeakerLabels::from_words(&spoken(&["s01", "s1"]));
        assert_eq!(collision.label("s01"), Some("S1"));
        assert_eq!(collision.label("s1"), Some("S2"));
    }

    #[test]
    fn does_not_treat_role_intro_as_name() {
        let mut doc = sample();
        for word in &mut doc.words {
            word.text = "I'm".to_owned();
        }
        assert!(propose_names(&doc, &[]).is_empty());
    }

    // ── 行归属还原 ──

    use crate::asr_rows::{RowIn, WordIn};

    fn cjk_row(start: f64, end: f64, text: &str, speaker: &str) -> RowIn {
        let chars: Vec<char> = text.chars().collect();
        let step = (end - start) / chars.len() as f64;
        let mut row = RowIn::new(start, end, text);
        row.speaker = Some(speaker.to_owned());
        row.words = Some(
            chars
                .iter()
                .enumerate()
                .map(|(index, character)| WordIn {
                    start: start + step * index as f64,
                    end: start + step * (index + 1) as f64,
                    text: character.to_string(),
                })
                .collect(),
        );
        row
    }

    fn turn_texts(doc: &TranscriptDoc) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = Vec::new();
        for word in &doc.words {
            match out.last_mut() {
                Some((sp, text)) if *sp == word.sp => text.push_str(&word.text),
                _ => out.push((word.sp.clone(), word.text.clone())),
            }
        }
        out
    }

    fn built(rows: &[RowIn], policy: crate::build::SpeakerBoundaryPolicy) -> TranscriptDoc {
        crate::build::build_doc_with_policy(
            rows,
            crate::doc::DocMedia {
                id: None,
                path: None,
                hash: String::new(),
                duration: 1000.0,
                sample_rate: Some(16_000),
            },
            "zh",
            crate::doc::DocEngine {
                name: "moss-transcribe-diarize".to_owned(),
                version: None,
                aligned_words: true,
            },
            None,
            policy,
        )
    }

    /// 夹具 = MOSS 7h 访谈原始行（719s 的"呃"、154s 的整行"嗯"）。用吸附策略
    /// 建出来的旧项目，经行归属还原后与行级权威策略建出的结果逐词一致。
    #[test]
    fn realign_restores_snapped_fillers_and_absorbed_backchannels() {
        let mut answer = cjk_row(719.41, 724.99, "呃很多啊打DOTA啊什么的", "S02");
        {
            let words = answer.words.as_mut().unwrap();
            words[0].end = 719.41;
            words[1].start = 719.89;
        }
        let rows = vec![
            cjk_row(151.0, 154.57, "呃NYU其实确实做得很不错", "S02"),
            cjk_row(154.70, 155.01, "嗯", "S01"),
            cjk_row(155.02, 158.0, "但另一方面NYU还有很强的电影学院", "S02"),
            cjk_row(718.14, 719.22, "当时打什么游戏", "S01"),
            answer,
        ];
        let mut legacy = built(&rows, crate::build::SpeakerBoundaryPolicy::SnapToPauses);
        let authoritative = built(&rows, crate::build::SpeakerBoundaryPolicy::RowAuthoritative);
        assert_ne!(
            turn_texts(&legacy),
            turn_texts(&authoritative),
            "夹具必须真的触发吸附"
        );

        let report = realign_to_row_speakers(&mut legacy, &rows);
        assert_eq!(report.skipped, None, "{report:?}");
        assert_eq!(report.realigned_runs, 2, "{report:?}");
        assert_eq!(report.kept_runs, 0);
        assert!(report.mismatched_words >= 2);
        assert_eq!(report.realigned_words, report.mismatched_words);
        assert_eq!(turn_texts(&legacy), turn_texts(&authoritative));
        // 幂等：再跑一次一处都不改。
        let again = realign_to_row_speakers(&mut legacy, &rows);
        assert_eq!(again.realigned_words, 0);
        assert_eq!(again.mismatched_words, 0);
    }

    /// 重绑过的词（`w…` id）夹在失配串里：前后行词的期望一致才随串还原。
    #[test]
    fn realign_carries_rebound_words_inside_a_run_by_their_neighbours() {
        let rows = vec![
            cjk_row(0.0, 3.0, "你好啊今天天气不错我们来聊一聊", "S01"),
            cjk_row(3.0, 6.0, "呃我们开始今天的话题吧好不好呀", "S02"),
        ];
        let mut doc = built(&rows, crate::build::SpeakerBoundaryPolicy::RowAuthoritative);
        // 模拟旧吸附 + 润色重绑："呃我" 被挪给 S01，其中"我"被重绑成新 id
        // （没有行号，只能靠前后行词"呃""们"的期望一致来推断归属）。
        let filler = doc.words.iter().position(|word| word.text == "呃").unwrap();
        doc.words[filler].sp = "s1".to_owned();
        doc.words[filler + 1].sp = "s1".to_owned();
        doc.words[filler + 1].id = "wabc-1".to_owned();
        let report = realign_to_row_speakers(&mut doc, &rows);
        assert_eq!(report.skipped, None);
        assert_eq!(report.realigned_words, 2, "{report:?}");
        assert!(doc.words.iter().skip(filler).all(|word| word.sp == "s2"));
    }

    #[test]
    fn realign_skips_when_ownership_was_rewritten_or_rows_carry_no_speakers() {
        let rows = vec![
            cjk_row(0.0, 2.0, "第一句话说得很长很长", "S01"),
            cjk_row(2.0, 4.0, "第二句话也说得很长很长", "S02"),
        ];
        // 整篇 relabel（reidentify 已 accept）：失配率远超 5% ⇒ 跳过。
        let mut rewritten = built(&rows, crate::build::SpeakerBoundaryPolicy::RowAuthoritative);
        for word in &mut rewritten.words {
            word.sp = "s1".to_owned();
        }
        let report = realign_to_row_speakers(&mut rewritten, &rows);
        assert_eq!(report.skipped.as_deref(), Some("row-ownership-diverged"));
        assert!(rewritten.words.iter().all(|word| word.sp == "s1"));

        // 长失配串（用户有意改了整句）保留，不算跳过。
        let mut edited = built(&rows, crate::build::SpeakerBoundaryPolicy::RowAuthoritative);
        edited.words[0].sp = "s2".to_owned(); // 单个词：短串，会被还原
        let report = realign_to_row_speakers(&mut edited, &rows);
        assert_eq!(report.realigned_runs, 1);

        // 行里没有说话人标签：无事可做。
        let plain = vec![RowIn::new(0.0, 1.0, "hello there")];
        let mut doc = built(
            &plain,
            crate::build::SpeakerBoundaryPolicy::RowAuthoritative,
        );
        let report = realign_to_row_speakers(&mut doc, &plain);
        assert_eq!(report.skipped.as_deref(), Some("no-speaker-rows"));

        // 说话人表被重编（id 不在表里）：跳过。
        let mut renamed = built(&rows, crate::build::SpeakerBoundaryPolicy::RowAuthoritative);
        let s2 = renamed.speakers.remove("s2").unwrap();
        renamed.speakers.insert("guest".to_owned(), s2);
        for word in &mut renamed.words {
            if word.sp == "s2" {
                word.sp = "guest".to_owned();
            }
        }
        let report = realign_to_row_speakers(&mut renamed, &rows);
        assert_eq!(report.skipped.as_deref(), Some("speaker-table-diverged"));
    }
}
