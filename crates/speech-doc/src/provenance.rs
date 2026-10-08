//! 译文溯源（设计 §11.3）：`ai/state/translation.<lang>.json`。
//!
//! 记录「某句译文是依据哪一版术语/上下文产出的」，术语被改动后即可判定该句
//! 陈旧，而不必整篇重翻。本模块是纯函数：哈希用 [`crate::fingerprint`] 的确
//! 定性摘要，文件读写与时钟一律在宿主。
//!
//! 判据（已裁决，见 M4 报告）：**只有命中该句的术语行哈希集合发生变化才算
//! stale**。摘要/文风差异只作 advisory 上报——否则每次重跑 analysis 让摘要
//! 换一个字，全文都会被判陈旧，代价与收益完全不成比例。

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::engines::brief::{DocumentBrief, GlossaryEntry};
use crate::engines::translate::term_present;
use crate::fingerprint::fingerprint_strings;

/// 单句译文的依据快照。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceProvenance {
    /// 产出该句时的上下文摘要哈希。
    pub context_hash: String,
    /// 产出该句时的文风哈希（`# Translation Style` + tone）。
    pub style_hash: String,
    /// 命中该句的术语行哈希，已排序去重。
    pub term_hashes: Vec<String>,
}

/// `ai/state/translation.<lang>.json` 的整体形状：句 id → 快照。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TranslationProvenance {
    pub sentences: BTreeMap<String, SentenceProvenance>,
}

impl TranslationProvenance {
    pub fn get(&self, sentence_id: &str) -> Option<&SentenceProvenance> {
        self.sentences.get(sentence_id)
    }

    pub fn insert(&mut self, sentence_id: impl Into<String>, record: SentenceProvenance) {
        self.sentences.insert(sentence_id.into(), record);
    }

    /// 文档已不存在的句子不留在状态里（否则文件随编辑单调膨胀）。
    pub fn retain_sentences(&mut self, live: &BTreeSet<String>) {
        self.sentences.retain(|id, _| live.contains(id));
    }

    pub fn is_empty(&self) -> bool {
        self.sentences.is_empty()
    }
}

/// 一次 run 内固定的「当前依据」：由 brief（即 `context.<lang>.md` 的投影）
/// 一次性算出，逐句复用。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ContextDigest {
    pub context_hash: String,
    pub style_hash: String,
    /// `(source, hash)`，按 source 排序。
    terms: Vec<(String, String)>,
    /// 是否真有一份可比较的依据（brief 存在）。
    ///
    /// 必须与「brief 存在但术语表为空」区分开：后者的空术语集是**真实**依据，
    /// 用户删光术语理应让相关句子陈旧；而 `--no-brief` 这类根本没有依据的轮次
    /// 一旦按空集比较，会把整篇已有译文判成陈旧、整篇重翻。
    basis: bool,
}

fn term_hash(entry: &GlossaryEntry) -> String {
    fingerprint_strings([
        entry.source.as_str(),
        entry.target.as_str(),
        entry.note.as_deref().unwrap_or(""),
        if entry.locked { "lock" } else { "free" },
    ])
}

impl ContextDigest {
    /// 从生效的双语简报构造。`brief` 为 `None`（本轮根本没有 context 可依据，
    /// 例如 `--no-brief`）时返回无依据摘要：[`scan_provenance`] 会整体跳过判
    /// 定，既不判陈旧也不报 advisory，账本原样留给下一次有依据的轮次。
    pub fn from_brief(brief: Option<&DocumentBrief>) -> Self {
        let Some(brief) = brief else {
            return Self::default();
        };
        let mut terms: Vec<(String, String)> = brief
            .glossary
            .iter()
            .filter(|entry| !entry.source.trim().is_empty())
            .map(|entry| (entry.source.clone(), term_hash(entry)))
            .collect();
        terms.sort();
        terms.dedup_by(|left, right| left.0 == right.0);
        Self {
            context_hash: fingerprint_strings([brief.summary.as_str()]),
            style_hash: fingerprint_strings([
                brief.style_guide.as_str(),
                brief
                    .tone
                    .map(|tone| tone.prompt_line())
                    .unwrap_or_default(),
            ]),
            terms,
            basis: true,
        }
    }

    /// 本轮是否真有可比较的依据。
    pub fn has_basis(&self) -> bool {
        self.basis
    }

    /// 命中该句源文的术语行哈希（升序去重）。
    pub fn term_hashes_for(&self, source_text: &str) -> Vec<String> {
        let mut hits: Vec<String> = self
            .terms
            .iter()
            .filter(|(source, _)| term_present(source_text, source))
            .map(|(_, hash)| hash.clone())
            .collect();
        hits.sort();
        hits.dedup();
        hits
    }

    /// 该句在**当前**依据下应有的快照。
    pub fn record_for(&self, source_text: &str) -> SentenceProvenance {
        SentenceProvenance {
            context_hash: self.context_hash.clone(),
            style_hash: self.style_hash.clone(),
            term_hashes: self.term_hashes_for(source_text),
        }
    }
}

/// 溯源扫描结果。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProvenanceScan {
    /// 术语依据变化、必须重翻的句 id。
    pub stale: BTreeSet<String>,
    /// 有译文但没有溯源记录的句 id（存量项目、或上一版 CLI 写的译文）。
    /// 只作提示，不触发重翻。
    pub unknown: BTreeSet<String>,
    /// 术语没变但摘要/文风变了的句 id，仅 advisory。
    pub context_drift: BTreeSet<String>,
}

impl ProvenanceScan {
    pub fn is_clean(&self) -> bool {
        self.stale.is_empty() && self.unknown.is_empty() && self.context_drift.is_empty()
    }
}

/// 扫描已有译文的溯源状态。
///
/// `translated` 是已有该语言译文的句子 `(id, source_text)`——没有译文的句子
/// 本来就会被 translate 的缺译判据选中，不必进溯源账本。
///
/// `digest` 无依据（brief 缺席）时整体不判定：拿空术语集去比对已有记录，会把
/// 每一条带术语的记录都算成「术语没了」，等于整篇重翻。
pub fn scan_provenance<'a, I>(
    records: &TranslationProvenance,
    digest: &ContextDigest,
    translated: I,
) -> ProvenanceScan
where
    I: IntoIterator<Item = (&'a str, &'a str)>,
{
    let mut scan = ProvenanceScan::default();
    if !digest.has_basis() {
        return scan;
    }
    for (id, source_text) in translated {
        let Some(record) = records.get(id) else {
            scan.unknown.insert(id.to_owned());
            continue;
        };
        let current = digest.term_hashes_for(source_text);
        if current != record.term_hashes {
            scan.stale.insert(id.to_owned());
        } else if !digest.context_hash.is_empty()
            && (digest.context_hash != record.context_hash
                || digest.style_hash != record.style_hash)
        {
            scan.context_drift.insert(id.to_owned());
        }
    }
    scan
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::brief::GlossaryEntry;

    fn brief_with(glossary: Vec<GlossaryEntry>, summary: &str, style: &str) -> DocumentBrief {
        DocumentBrief {
            target_lang: "zh-Hans".to_owned(),
            tone: None,
            summary: summary.to_owned(),
            glossary,
            named_entities: Vec::new(),
            style_guide: style.to_owned(),
            difficulties: Vec::new(),
            fingerprint: String::new(),
            analysis_fingerprint: None,
            instructions_fingerprint: None,
        }
    }

    fn entry(source: &str, target: &str) -> GlossaryEntry {
        GlossaryEntry {
            source: source.to_owned(),
            target: target.to_owned(),
            note: None,
            locked: false,
        }
    }

    #[test]
    fn term_change_marks_only_hit_sentences_stale() {
        let before = brief_with(vec![entry("BaoCut", "宝剪")], "a doc", "plain");
        let digest_before = ContextDigest::from_brief(Some(&before));
        let mut records = TranslationProvenance::default();
        records.insert("s-1", digest_before.record_for("BaoCut ships today"));
        records.insert("s-2", digest_before.record_for("nothing relevant here"));

        let after = brief_with(vec![entry("BaoCut", "BaoCut")], "a doc", "plain");
        let digest_after = ContextDigest::from_brief(Some(&after));
        let scan = scan_provenance(
            &records,
            &digest_after,
            [
                ("s-1", "BaoCut ships today"),
                ("s-2", "nothing relevant here"),
            ],
        );
        assert_eq!(scan.stale, BTreeSet::from(["s-1".to_owned()]));
        assert!(scan.unknown.is_empty());
        assert!(scan.context_drift.is_empty());
    }

    #[test]
    fn unchanged_terms_are_clean() {
        let brief = brief_with(vec![entry("BaoCut", "宝剪")], "a doc", "plain");
        let digest = ContextDigest::from_brief(Some(&brief));
        let mut records = TranslationProvenance::default();
        records.insert("s-1", digest.record_for("BaoCut ships today"));
        let scan = scan_provenance(&records, &digest, [("s-1", "BaoCut ships today")]);
        assert!(scan.is_clean());
    }

    #[test]
    fn missing_record_is_unknown_not_stale() {
        let brief = brief_with(vec![entry("BaoCut", "宝剪")], "a doc", "plain");
        let digest = ContextDigest::from_brief(Some(&brief));
        let scan = scan_provenance(
            &TranslationProvenance::default(),
            &digest,
            [("s-1", "BaoCut ships today")],
        );
        assert!(scan.stale.is_empty());
        assert_eq!(scan.unknown, BTreeSet::from(["s-1".to_owned()]));
    }

    #[test]
    fn summary_change_is_advisory_only() {
        let before = brief_with(vec![entry("BaoCut", "宝剪")], "a doc", "plain");
        let digest_before = ContextDigest::from_brief(Some(&before));
        let mut records = TranslationProvenance::default();
        records.insert("s-1", digest_before.record_for("BaoCut ships today"));

        let after = brief_with(vec![entry("BaoCut", "宝剪")], "a different doc", "plain");
        let digest_after = ContextDigest::from_brief(Some(&after));
        let scan = scan_provenance(&records, &digest_after, [("s-1", "BaoCut ships today")]);
        assert!(scan.stale.is_empty());
        assert_eq!(scan.context_drift, BTreeSet::from(["s-1".to_owned()]));
    }

    #[test]
    fn missing_brief_never_marks_anything_stale() {
        // `--no-brief` 之类的轮次没有依据可比。若按空术语集比对，s-1 会被判成
        // 「术语没了」而整篇重翻——这里必须保持沉默。
        let brief = brief_with(vec![entry("BaoCut", "宝剪")], "a doc", "plain");
        let digest = ContextDigest::from_brief(Some(&brief));
        let mut records = TranslationProvenance::default();
        records.insert("s-1", digest.record_for("BaoCut ships today"));

        let no_basis = ContextDigest::from_brief(None);
        assert!(!no_basis.has_basis());
        let scan = scan_provenance(&records, &no_basis, [("s-1", "BaoCut ships today")]);
        assert!(scan.is_clean(), "{scan:?}");
    }

    #[test]
    fn empty_glossary_is_a_real_basis() {
        // 与「没有 brief」相反：用户把术语删光了是**真实**依据变化，命中的句子
        // 应当判陈旧。
        let before = brief_with(vec![entry("BaoCut", "宝剪")], "a doc", "plain");
        let digest_before = ContextDigest::from_brief(Some(&before));
        let mut records = TranslationProvenance::default();
        records.insert("s-1", digest_before.record_for("BaoCut ships today"));

        let after = brief_with(Vec::new(), "a doc", "plain");
        let digest_after = ContextDigest::from_brief(Some(&after));
        assert!(digest_after.has_basis());
        let scan = scan_provenance(&records, &digest_after, [("s-1", "BaoCut ships today")]);
        assert_eq!(scan.stale, BTreeSet::from(["s-1".to_owned()]));
    }

    #[test]
    fn round_trips_through_json() {
        let brief = brief_with(vec![entry("BaoCut", "宝剪")], "a doc", "plain");
        let digest = ContextDigest::from_brief(Some(&brief));
        let mut records = TranslationProvenance::default();
        records.insert("s-g1.0", digest.record_for("BaoCut ships today"));
        let json = serde_json::to_string(&records).expect("serialize");
        assert!(json.starts_with("{\"s-g1.0\":{\"contextHash\":"), "{json}");
        let back: TranslationProvenance = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, records);
    }

    #[test]
    fn retain_drops_deleted_sentences() {
        let mut records = TranslationProvenance::default();
        records.insert("s-1", SentenceProvenance::default());
        records.insert("s-2", SentenceProvenance::default());
        records.retain_sentences(&BTreeSet::from(["s-2".to_owned()]));
        assert_eq!(records.sentences.len(), 1);
        assert!(records.get("s-2").is_some());
    }
}
