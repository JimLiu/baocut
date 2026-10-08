//! translate 编排里不碰 provider、不写盘的纯判定。
//!
//! 移植自 BaoCut v2 `bcut-engine` 的 `flows/translate.rs`：`narrow_to_stale` 与黏结
//! 收尾轮的计划 / 跳过提示（`plan_row_repair_tail`、`row_repair_tail_skip_advisory`）。
//! [`ROW_DEFICIT_MAX_KEYS`] 来自同目录的 `flows/refine.rs`。编排本身（调用 provider、
//! 落审计工件的 `run_row_repair_tail`，读 `project.json` 的 `align_params_for`）不在这里；
//! 后者的阈值逻辑就是 [`crate::split::TransParams::for_delivery`] / `with_fit`。

use std::collections::BTreeSet;

/// 单轮 paired 定向重切的最大句数。refine 的黏结轮与 translate 收尾轮共用同一
/// 上限：两处各写一份字面量，只会在调参时分叉成两种批量语义。
pub const ROW_DEFICIT_MAX_KEYS: usize = 40;

/// `--only-stale` / `--after-cut`：把本语言的 stale 句并成定向集；显式 `--sentences`
/// 存在时取交集。空集是合法结果（本语言没有 stale 句 → 本轮不翻不对齐）。
pub fn narrow_to_stale<K: Ord>(explicit: Option<&BTreeSet<K>>, stale: BTreeSet<K>) -> BTreeSet<K> {
    match explicit {
        Some(filter) => stale
            .into_iter()
            .filter(|key| filter.contains(key))
            .collect(),
        None => stale,
    }
}

/// 黏结自动收尾轮被跳过的原因。四种都是正常路径，不是失败。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowRepairTailSkip {
    /// 调用方显式关闭（`--no-row-repair` / refine 的防套娃）。
    OptedOut,
    /// 本轮主对齐已经是 paired：它自己就是重切轮，不再叠一轮。
    AlreadyPaired,
    /// 本轮没有任何写入：重复跑 translate 是 no-op，收尾轮也必须是 no-op。
    NoWrites,
    /// 检测无命中：没有黏结就没有要修的。
    NoHits,
}

impl RowRepairTailSkip {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OptedOut => "opted-out",
            Self::AlreadyPaired => "already-paired",
            Self::NoWrites => "no-writes",
            Self::NoHits => "no-hits",
        }
    }
}

/// 收尾轮的定向计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowRepairTailPlan {
    /// 截断到 `ROW_DEFICIT_MAX_KEYS` 后的定向句集，作为 `AlignOptions::sentences`。
    pub keys: BTreeSet<String>,
    /// 完整命中集，作为 `AlignOptions::density_sentences`；引擎据此把「本轮上限
    /// 截掉、留给下一轮」的差额算进 `row_repair.capped`。
    pub density_sentences: BTreeSet<String>,
}

/// 纯判定：本轮是否要跑黏结收尾轮，跑的话定向哪些句。零 LLM 调用。
///
/// 检测复用 `bcut check` 的 `align-row-deficit` 唯一谓词入口
/// `row_deficit_issues`，不在这里复制阈值；译文 cue 必须**在主对齐之后**重新
/// 派生（它读 `trans` / `transAlign`，两者刚被主轮改过）。
pub fn plan_row_repair_tail(
    doc: &crate::doc::TranscriptDoc,
    sentences: &[crate::sentence::Sentence],
    cues: &[crate::cue::Cue],
    lang: &str,
    no_row_repair: bool,
    density: crate::engines::align::AlignDensity,
    wrote_this_round: bool,
    sentence_filter: Option<&BTreeSet<String>>,
) -> Result<RowRepairTailPlan, RowRepairTailSkip> {
    if no_row_repair {
        return Err(RowRepairTailSkip::OptedOut);
    }
    if density == crate::engines::align::AlignDensity::Paired {
        return Err(RowRepairTailSkip::AlreadyPaired);
    }
    if !wrote_this_round {
        return Err(RowRepairTailSkip::NoWrites);
    }
    let stream = crate::split::derive_trans_cues(doc, sentences, lang);
    let mut hits: BTreeSet<String> =
        crate::engines::align::row_deficit_issues(doc, sentences, lang, cues, &stream)
            .into_iter()
            .map(|issue| issue.key)
            .collect();
    // 定向重翻只收尾自己这轮碰过的句：本轮没翻的句上的黏结属于历史遗留，
    // 交给 check + refine-align，不在这里扩大写面。
    if let Some(filter) = sentence_filter {
        hits.retain(|key| filter.contains(key));
    }
    if hits.is_empty() {
        return Err(RowRepairTailSkip::NoHits);
    }
    let keys: BTreeSet<String> = hits.iter().take(ROW_DEFICIT_MAX_KEYS).cloned().collect();
    Ok(RowRepairTailPlan {
        keys,
        density_sentences: hits,
    })
}

/// 收尾轮被跳过时该说的话：只在「本轮主对齐就是 paired 重切轮」且跑完仍有黏结
/// 时出声，返回一条 advisory。纯判定，零 LLM 调用。
///
/// 另外三种跳过刻意不报。`opted-out` 里混着 refine 内部的防套娃（见
/// [`RowRepairTailSkip::OptedOut`]），refine 每轮都会命中，报出来就是一条永远
/// 为真的噪音；`no-writes` 是幂等空跑，本轮什么也没改；`no-hits` 本来就没有
/// 黏结。留下的 `already-paired` 才是真信号：调用方点名要重切，跑完还剩黏结，
/// 而收尾轮按设计不会在 paired 轮上再叠一轮，于是这批句在 `--json` 之外没有
/// 任何提示。
pub fn row_repair_tail_skip_advisory(
    doc: &crate::doc::TranscriptDoc,
    sentences: &[crate::sentence::Sentence],
    cues: &[crate::cue::Cue],
    lang: &str,
    skip: RowRepairTailSkip,
    sentence_filter: Option<&BTreeSet<String>>,
) -> Option<String> {
    if skip != RowRepairTailSkip::AlreadyPaired {
        return None;
    }
    let stream = crate::split::derive_trans_cues(doc, sentences, lang);
    let mut remaining =
        crate::engines::align::row_deficit_issues(doc, sentences, lang, cues, &stream);
    if let Some(filter) = sentence_filter {
        remaining.retain(|issue| filter.contains(&issue.key));
    }
    if remaining.is_empty() {
        return None;
    }
    let sample = remaining
        .iter()
        .take(5)
        .map(|issue| issue.key.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let more = if remaining.len() > 5 { " …" } else { "" };
    Some(format!(
        "{lang}: 本轮 --align-density paired 之后仍有 {} 句译文黏结多行源字幕（{sample}{more}）；收尾轮按设计不会在 paired 轮上再叠一轮，请跑 bcut check + bcut refine-align",
        remaining.len()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asr_rows::RowIn;
    use crate::build::build_doc;
    use crate::cue::{Cue, derive_cues};
    use crate::doc::{AlignMode, DocEngine, DocMedia, TransAlign, TransPiece, TranscriptDoc};
    use crate::engines::align::AlignDensity;
    use crate::sentence::Sentence;

    const SOURCE_TEXT: &str = "we have been working on this particular problem for a very long time and the results are finally starting to show up in the numbers that everybody can see today.";
    const TRANSLATION: &str = "我们在这个具体的问题上已经投入了非常长的时间，而现在所有人都能够从每天更新的数字里，清清楚楚地看到那些最终开始显现出来的结果。";

    fn doc_with_rows(rows: &[RowIn]) -> TranscriptDoc {
        build_doc(
            rows,
            DocMedia {
                id: None,
                path: Some("talk.wav".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 10_000.0,
                sample_rate: Some(16_000),
            },
            "en",
            DocEngine {
                name: "t".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        )
    }

    /// 装一条**有效的整句** ManyToOne 条目：这正是黏结的现场形态，也是
    /// 收尾轮必须 `force: true` 的原因——非 force 轮会把这类句整批跳过。
    fn glue_sentence(doc: &mut TranscriptDoc, sentence_id: &str, word_ids: Vec<String>) {
        let last = word_ids.len() - 1;
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentence_id.to_owned(), TRANSLATION.to_owned());
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            sentence_id.to_owned(),
            TransAlign::new(
                AlignMode::ManyToOne,
                word_ids,
                vec![TransPiece {
                    from: Some(0),
                    to: Some(last),
                    text: TRANSLATION.to_owned(),
                }],
            ),
        );
    }

    /// 单句黏结：4 源行 + 1 条覆盖全句的译文 cue，驻留 30s。
    fn glued_doc() -> (TranscriptDoc, Vec<Cue>, Vec<Sentence>) {
        let mut doc = doc_with_rows(&[RowIn::new(0.0, 30.0, SOURCE_TEXT)]);
        let word_ids = doc.words.iter().map(|word| word.id.clone()).collect();
        glue_sentence(&mut doc, "s-g1.0", word_ids);
        let (cues, sentences) = derive(&doc);
        (doc, cues, sentences)
    }

    fn derive(doc: &TranscriptDoc) -> (Vec<Cue>, Vec<Sentence>) {
        let cues = derive_cues(doc, &crate::layout_profile::cue_params_for_doc(doc));
        let sentences = crate::sentence::derive_sentences(doc, &cues);
        (cues, sentences)
    }

    fn plan(
        doc: &TranscriptDoc,
        cues: &[Cue],
        sentences: &[Sentence],
        no_row_repair: bool,
        density: AlignDensity,
        wrote: bool,
        filter: Option<&BTreeSet<String>>,
    ) -> Result<RowRepairTailPlan, RowRepairTailSkip> {
        plan_row_repair_tail(
            doc,
            sentences,
            cues,
            "zh",
            no_row_repair,
            density,
            wrote,
            filter,
        )
    }

    /// `--only-stale` 与 `--sentences` 取交集；没有显式定向集时 stale 集就是定向集；
    /// 空集是合法结果（本语言没有 stale 句 → 本轮什么都不翻）。
    #[test]
    fn only_stale_narrows_the_targeted_set() {
        let stale: BTreeSet<String> = ["s-1", "s-2", "s-3"].map(str::to_owned).into();
        let explicit: BTreeSet<String> = ["s-2", "s-9"].map(str::to_owned).into();
        assert_eq!(
            narrow_to_stale(None, stale.clone()),
            ["s-1", "s-2", "s-3"].map(str::to_owned).into()
        );
        assert_eq!(
            narrow_to_stale(Some(&explicit), stale),
            ["s-2"].map(str::to_owned).into()
        );
        assert!(narrow_to_stale(Some(&explicit), BTreeSet::new()).is_empty());
    }

    #[test]
    fn tail_is_skipped_when_opted_out() {
        let (doc, cues, sentences) = glued_doc();
        assert_eq!(
            plan(
                &doc,
                &cues,
                &sentences,
                true,
                AlignDensity::Auto,
                true,
                None
            ),
            Err(RowRepairTailSkip::OptedOut)
        );
    }

    #[test]
    fn tail_is_skipped_when_the_main_round_is_already_paired() {
        let (doc, cues, sentences) = glued_doc();
        assert_eq!(
            plan(
                &doc,
                &cues,
                &sentences,
                false,
                AlignDensity::Paired,
                true,
                None
            ),
            Err(RowRepairTailSkip::AlreadyPaired)
        );
    }

    #[test]
    fn tail_is_skipped_when_the_round_wrote_nothing() {
        // 幂等：重复跑一次 translate 是 no-op，收尾轮也必须是 no-op。
        let (doc, cues, sentences) = glued_doc();
        assert_eq!(
            plan(
                &doc,
                &cues,
                &sentences,
                false,
                AlignDensity::Auto,
                false,
                None
            ),
            Err(RowRepairTailSkip::NoWrites)
        );
    }

    #[test]
    fn tail_is_skipped_when_nothing_is_glued() {
        // 没有黏结的项目：翻译输出零漂移，收尾轮一次调用都不发。
        let doc = doc_with_rows(&[RowIn::new(0.0, 3.0, "a short clean line.")]);
        let (cues, sentences) = derive(&doc);
        let mut doc = doc;
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentences[0].id.clone(), "一句干净的短译文。".to_owned());
        assert_eq!(
            plan(
                &doc,
                &cues,
                &sentences,
                false,
                AlignDensity::Auto,
                true,
                None
            ),
            Err(RowRepairTailSkip::NoHits)
        );
    }

    #[test]
    fn tail_only_targets_sentences_this_round_touched() {
        // 定向重翻只收尾自己碰过的句：本轮 filter 之外的历史黏结交给
        // check + refine-align，不在这里扩大写面。
        let (doc, cues, sentences) = glued_doc();
        let filter = BTreeSet::from(["s-g9.9".to_owned()]);
        assert_eq!(
            plan(
                &doc,
                &cues,
                &sentences,
                false,
                AlignDensity::Auto,
                true,
                Some(&filter)
            ),
            Err(RowRepairTailSkip::NoHits)
        );
    }

    /// 本轮主对齐就是 paired、跑完仍有黏结：收尾轮不会再叠一轮，必须出声。
    #[test]
    fn a_skipped_tail_after_a_paired_round_still_reports_the_remaining_glue() {
        let (doc, cues, sentences) = glued_doc();
        let advisory = row_repair_tail_skip_advisory(
            &doc,
            &sentences,
            &cues,
            "zh",
            RowRepairTailSkip::AlreadyPaired,
            None,
        )
        .expect("paired 轮之后仍有黏结");
        assert!(advisory.contains("s-g1.0"), "{advisory}");
        assert!(advisory.contains("refine-align"), "{advisory}");
    }

    /// `opted-out` 里混着 refine 内部的防套娃：报出来就是一条永远为真的噪音。
    /// `no-writes` / `no-hits` 同理不报。
    #[test]
    fn the_other_skip_reasons_stay_silent_even_with_glue_left() {
        let (doc, cues, sentences) = glued_doc();
        for skip in [
            RowRepairTailSkip::OptedOut,
            RowRepairTailSkip::NoWrites,
            RowRepairTailSkip::NoHits,
        ] {
            assert_eq!(
                row_repair_tail_skip_advisory(&doc, &sentences, &cues, "zh", skip, None,),
                None,
                "{skip:?}"
            );
        }
    }

    /// 没有黏结剩下时不出声。
    #[test]
    fn a_skipped_paired_tail_without_glue_says_nothing() {
        let mut doc = doc_with_rows(&[RowIn::new(0.0, 3.0, SOURCE_TEXT)]);
        let (cues, sentences) = derive(&doc);
        for sentence in &sentences {
            doc.trans
                .entry("zh".to_owned())
                .or_default()
                .insert(sentence.id.clone(), "短句。".to_owned());
        }
        assert_eq!(
            row_repair_tail_skip_advisory(
                &doc,
                &sentences,
                &cues,
                "zh",
                RowRepairTailSkip::AlreadyPaired,
                None,
            ),
            None
        );
    }

    #[test]
    fn tail_truncates_the_targeted_set_to_the_shared_cap() {
        let rows = (0..45)
            .map(|index| {
                let start = index as f64 * 40.0;
                RowIn::new(start, start + 30.0, SOURCE_TEXT)
            })
            .collect::<Vec<_>>();
        let mut doc = doc_with_rows(&rows);
        let (cues, sentences) = derive(&doc);
        assert_eq!(sentences.len(), 45);
        for sentence in &sentences {
            let word_ids = sentence
                .word_indices
                .iter()
                .map(|&index| doc.words[index].id.clone())
                .collect();
            glue_sentence(&mut doc, &sentence.id, word_ids);
        }
        let plan = plan(
            &doc,
            &cues,
            &sentences,
            false,
            AlignDensity::Auto,
            true,
            None,
        )
        .expect("45 句黏结");
        // 截断只影响本轮定向的句集；完整命中集仍整份交给引擎，差额由引擎
        // 记进 `row_repair.capped`（留给下一轮）。
        assert_eq!(plan.keys.len(), ROW_DEFICIT_MAX_KEYS);
        assert_eq!(plan.density_sentences.len(), 45);
        assert!(plan.density_sentences.is_superset(&plan.keys));
    }
}
