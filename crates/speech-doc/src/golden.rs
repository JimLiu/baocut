//! 对齐 golden 集（`bcut-align-golden/1`）的解析与校验。
//!
//! 数据落在 `core/fixtures/align/golden/<project>/<lang>.json`，格式与字段语义
//! 见同目录 `README.md`。本模块**只做解析与纯校验**：`bcut-flow-core` 不做
//! I/O，读文件由测试宿主（`tests/golden_align.rs`）负责，这里只暴露
//! [`GoldenFile::from_str`]。
//!
//! 指标计算在 [`crate::metrics`]（[`crate::metrics::bead_prf`] /
//! [`crate::metrics::boundary_f1`] / [`crate::metrics::path_exact_match`]）。

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

use crate::doc::Correspondence;
use crate::metrics::{Bead, beads_contiguous};

/// golden 文件的 schema 串。
pub const GOLDEN_SCHEMA: &str = "bcut-align-golden/1";

/// 12 类标注现象对应的 13 个 tag 值（`omission` / `addition` 是"省译/增译"
/// 一类的两个方向）。顺序即 README 中的列出顺序。
pub const GOLDEN_TAGS: &[&str] = &[
    "1:1",
    "1:N",
    "N:1",
    "N:M",
    "causal-inversion",
    "attributive-reorder",
    "negation",
    "number",
    "proper-noun",
    "term",
    "omission",
    "addition",
    "hard-negative",
];

/// 一个 bead 的落盘形态：`[start, end)` 半开区间。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoldenBead {
    /// 源词下标半开区间（下标即 `sourceWords` 的位置）。
    pub src: [usize; 2],
    /// 目标 `chars()` 半开区间（下标即 `target.chars()` 的位置）。
    pub tgt: [usize; 2],
}

impl GoldenBead {
    pub fn bead(&self) -> Bead {
        Bead::new(self.src[0]..self.src[1], self.tgt[0]..self.tgt[1])
    }
}

/// 硬锚：某个源词必须落到的目标字符区间（数字、专名、原样 Latin、锁定术语）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoldenAnchor {
    /// 源词下标。
    pub src: usize,
    /// 目标 `chars()` 半开区间。
    pub tgt: [usize; 2],
}

/// 该句的人工期望。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenExpectation {
    /// 期望的对应粒度：`block` = 可块级对照，`sentence` = 只能整句对应。
    pub correspondence: Correspondence,
    /// 人工认为至少应达到的块数（通常 = `beads.len()`）。
    pub min_blocks: usize,
    /// 相邻 hard negative 对：本例必须能与该用例区分。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hard_negative_of: Option<String>,
}

/// 一条 golden 用例。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenCase {
    /// 全局唯一用例 id（`<project-short>-<lang>-<序号>`）。
    pub id: String,
    /// 该 transcript 真实派生出的句 id（`s-<首词 id>`）。
    pub sentence_id: String,
    /// 句内词文本，必须与派生 Sentence 的词逐一相等。
    pub source_words: Vec<String>,
    /// 人工确认的目标语整句译文；`beads[].tgt` 是它的 `chars()` 下标。
    pub target: String,
    /// 现象标签，取值见 [`GOLDEN_TAGS`]。
    pub tags: Vec<String>,
    /// 人工标注的最小单调对齐块划分（两侧连续全覆盖且单调）。
    pub beads: Vec<GoldenBead>,
    #[serde(default)]
    pub hard_anchors: Vec<GoldenAnchor>,
    pub expected: GoldenExpectation,
}

impl GoldenCase {
    /// 标注的 bead 序列。
    pub fn beads(&self) -> Vec<Bead> {
        self.beads.iter().map(GoldenBead::bead).collect()
    }

    /// 目标文本字符数。
    pub fn target_chars(&self) -> usize {
        self.target.chars().count()
    }

    /// 结构自检（不查 transcript，那部分由宿主对照派生 Sentence 完成）：
    /// tag 合法、bead 两侧连续全覆盖且单调、硬锚落在自己源词所属的 bead 内、
    /// `minBlocks` 不超过标注块数。
    pub fn validate(&self) -> Result<()> {
        if self.id.is_empty() || self.sentence_id.is_empty() {
            bail!("golden 用例缺少 id / sentenceId");
        }
        if self.source_words.is_empty() {
            bail!("{}: sourceWords 为空", self.id);
        }
        if self.tags.is_empty() {
            bail!("{}: tags 为空", self.id);
        }
        for tag in &self.tags {
            if !GOLDEN_TAGS.contains(&tag.as_str()) {
                bail!("{}: 未知 tag {tag}", self.id);
            }
        }
        let beads = self.beads();
        if !beads_contiguous(&beads, self.source_words.len(), self.target_chars()) {
            bail!("{}: beads 不是两侧连续全覆盖的单调划分", self.id);
        }
        if self.expected.min_blocks == 0 || self.expected.min_blocks > beads.len() {
            bail!(
                "{}: expected.minBlocks={} 超出标注块数 {}",
                self.id,
                self.expected.min_blocks,
                beads.len()
            );
        }
        for anchor in &self.hard_anchors {
            let Some(bead) = beads.iter().find(|bead| bead.src.contains(&anchor.src)) else {
                bail!("{}: 硬锚源词 {} 越界", self.id, anchor.src);
            };
            if anchor.tgt[0] >= anchor.tgt[1]
                || anchor.tgt[0] < bead.tgt.start
                || anchor.tgt[1] > bead.tgt.end
            {
                bail!(
                    "{}: 硬锚源词 {} 的目标区间不在其 bead 内",
                    self.id,
                    anchor.src
                );
            }
        }
        Ok(())
    }
}

/// 一个 `<project>/<lang>.json` 文件。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenFile {
    /// 恒为 [`GOLDEN_SCHEMA`]。
    pub schema: String,
    /// `examples/<project>.bcut` 的目录名（不含 `.bcut`）。
    pub project: String,
    /// 目标语言（BCP-47 主子标签）。
    pub lang: String,
    pub cases: Vec<GoldenCase>,
}

impl GoldenFile {
    /// 解析并做结构自检（无 I/O）。
    ///
    /// 刻意不实现 `std::str::FromStr`：错误类型是 `anyhow::Error`，且这里只
    /// 服务测试宿主，不需要 `"...".parse()` 的泛型入口。
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(text: &str) -> Result<Self> {
        let file: Self = serde_json::from_str(text)?;
        file.validate()?;
        Ok(file)
    }

    /// schema、语言、用例 id 唯一性与逐条 [`GoldenCase::validate`]。
    pub fn validate(&self) -> Result<()> {
        if self.schema != GOLDEN_SCHEMA {
            bail!("未知 golden schema {}", self.schema);
        }
        if self.project.is_empty() || self.lang.is_empty() {
            bail!("golden 文件缺少 project / lang");
        }
        if self.cases.is_empty() {
            bail!("{}/{}: cases 为空", self.project, self.lang);
        }
        let mut seen = std::collections::BTreeSet::new();
        for case in &self.cases {
            if !seen.insert(case.id.as_str()) {
                bail!("{}/{}: 重复用例 id {}", self.project, self.lang, case.id);
            }
            case.validate()?;
        }
        for case in &self.cases {
            let Some(reference) = case.expected.hard_negative_of.as_deref() else {
                continue;
            };
            if reference == case.id || !seen.contains(reference) {
                bail!("{}: hardNegativeOf {reference} 不在同一文件内", case.id);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "schema": "bcut-align-golden/1",
      "project": "demo",
      "lang": "zh",
      "cases": [
        {
          "id": "demo-zh-001",
          "sentenceId": "s-g12.0",
          "sourceWords": ["I", "didn't", "go", "because", "I", "was", "sick"],
          "target": "因为我病了，所以没去",
          "tags": ["N:M", "causal-inversion"],
          "beads": [{ "src": [0, 7], "tgt": [0, 10] }],
          "hardAnchors": [],
          "expected": { "correspondence": "block", "minBlocks": 1 }
        }
      ]
    }"#;

    #[test]
    fn parses_and_validates_sample() {
        let file = GoldenFile::from_str(SAMPLE).expect("sample parses");
        assert_eq!(file.schema, GOLDEN_SCHEMA);
        assert_eq!(file.cases.len(), 1);
        let case = &file.cases[0];
        assert_eq!(case.target_chars(), 10);
        assert_eq!(case.beads(), vec![Bead::new(0..7, 0..10)]);
    }

    #[test]
    fn rejects_non_covering_beads() {
        let broken = SAMPLE.replace(
            r#"{ "src": [0, 7], "tgt": [0, 10] }"#,
            r#"{ "src": [0, 6], "tgt": [0, 10] }"#,
        );
        let error = GoldenFile::from_str(&broken).expect_err("must reject");
        assert!(error.to_string().contains("连续全覆盖"), "{error}");
    }

    #[test]
    fn rejects_unknown_tag() {
        let broken = SAMPLE.replace(r#""causal-inversion""#, r#""nonsense""#);
        let error = GoldenFile::from_str(&broken).expect_err("must reject");
        assert!(error.to_string().contains("未知 tag"), "{error}");
    }

    #[test]
    fn rejects_unknown_schema() {
        let broken = SAMPLE.replace("bcut-align-golden/1", "bcut-align-golden/9");
        let error = GoldenFile::from_str(&broken).expect_err("must reject");
        assert!(error.to_string().contains("未知 golden schema"), "{error}");
    }

    #[test]
    fn rejects_dangling_hard_negative() {
        let broken = SAMPLE.replace(
            r#""minBlocks": 1"#,
            r#""minBlocks": 1, "hardNegativeOf": "demo-zh-999""#,
        );
        let error = GoldenFile::from_str(&broken).expect_err("must reject");
        assert!(error.to_string().contains("hardNegativeOf"), "{error}");
    }
}
