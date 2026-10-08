//! translate 载体（§7）：`<article>` 裸根 HTML 的渲染与解析。
//!
//! 渲染只产出句级结构，**不含时间戳、不含 word id**；解析一律按 `id` 抽取，
//! 标签名不进协议（模型把 `<p>` 改成 `<div>` 但 id 在，照样接受）。

use std::collections::{BTreeMap, BTreeSet};

use crate::atomize::normalize_chars;
use crate::engines::align::FusionGroup;
use crate::engines::translate::term_present;
use crate::language_quality::{
    TRANSLATION_VALIDATOR_VERSION, TranslationQualityCode, duplicate_collapse_ids,
    translation_quality_issues,
};

use super::align_edges::{
    AlignChunk, chunks_from_element, parse_ordinal_words, parse_ordinals, render_ordinal_words,
};
use super::common::{
    Diagnostics, Problem, ProblemCode, TRANSLATION_SOURCE_FORMAT, Warning, WarningCode,
    guard_output_size, normalize_llm_output, sanitize_inline_text,
};
use super::html::{Element, escape_attr, escape_text, index_by_id, parse_html};

/// 一句在翻译载体里的渲染输入。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TranslateSentence {
    /// HTML id：常规场景为 `s-<首词 id>`，timeline 多源场景为全局唯一 route id。
    pub id: String,
    /// 源文（渲染时转义）。
    pub source: String,
    /// 是否可编辑；`false` 即 §7.6 的冻结句。
    pub editable: bool,
    /// 已有译文：冻结句的只读参照，写入 `data-translation`。
    ///
    /// 用属性而不是 HTML 注释承载，是为了让 [`parse_translate_source`] 能从渲染文本
    /// 单独复原校验所需的一切（注释在清洗解析里会被丢弃，且转义不可逆）。
    pub existing_translation: Option<String>,
    /// 锁定术语编译出的 required targets（§5.2 的 `rt`），写入 `data-rt` 的 JSON 数组。
    pub required_targets: Vec<String>,
    /// timeline 多源路由的源 id（写入 `data-source-id`）。
    pub source_id: Option<String>,
    /// timeline 多源路由的句 id（写入 `data-sid`）。
    pub sentence_id: Option<String>,
    /// 本句的阅读预算（阅读单位，见 `target_cps_chars` 口径），写入 `data-budget`。
    ///
    /// 口径与 align 表格的 `data-budget` 一致——只带相对预算文案、绝不带秒数；
    /// 数值由引擎侧的 `reading_budget`（显示时长 × 目标语 cps）算好传进来，
    /// 载体只负责措辞。`None` 即不渲染该属性（冻结句、以及不带预算的旧载荷）。
    pub budget: Option<usize>,
    /// 翻译调用顺带产出展示切分草稿时的源侧提示。输出中的草稿只是尽力而为
    /// 的旁路信息；解析失败绝不影响本句译文验收。
    pub alignment: Option<TranslateAlignmentInput>,
}

/// `file-v1` 翻译载体的一句融合对齐提示（对齐块设计 §6.1）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslateAlignmentInput {
    /// 句内锚定词，顺序即序号；渲染成 `data-align-words="[1]I [2]didn't …"`
    /// （与 `align-edges/1` 载体同一序号词串，见 [`render_ordinal_words`]）。
    pub source_words: Vec<String>,
    /// 与 `source_words` 同下标的「贴前」标记（[`crate::doc::Word::glue`]）；
    /// 空 = 都没有。只在进程内用：从 HTML 解析回来的输入不带它。
    pub source_glue: Vec<bool>,
    /// 源侧已经要求拆分；false 时模型仍可因目标译文超 fit 给出草稿。
    pub needs_split: bool,
    /// 确定性源侧分组（rows 模式）；渲染成 `data-align-groups`。空 = 不渲染。
    pub groups: Vec<FusionGroup>,
}

/// 翻译回答携带的可选块对齐草稿：`<p>` 内按 `<span data-src="…">` 标注的
/// 译文语义块（[`AlignChunk`]，序号 0-based）。span 剥离后逐字等于 `<p>` 正文；
/// 块合并、双语 DP 与验收由 align 引擎完成。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslateAlignmentDraft {
    pub chunks: Vec<AlignChunk>,
    /// 草稿是合格的行分区（见 [`is_row_partition`]）。
    pub rows: bool,
    /// 行边界全部落在 `data-align-groups` 的组边界上（见
    /// [`rows_on_group_boundaries`]）。不满足不影响接受，只作计数。
    pub on_groups: bool,
}

/// 块序列是否构成合格的**行分区**：每块序号非空、连续递增；块间首尾相接；
/// 整体恰好覆盖 `0..word_count`；块文本非空。
///
/// 满足即可把每块直接当一条显示行落库（引擎侧仍会校验行边界能否成为块边界）。
/// 注意：判定为行分区**不等于**要按行落库——只有 rows 模式（载体带
/// `data-align-groups`）的草稿才走行直通，常规 fusion 契约要的是最小语义块。
pub fn is_row_partition(chunks: &[AlignChunk], word_count: usize) -> bool {
    if chunks.is_empty() || word_count == 0 {
        return false;
    }
    let mut expected = 0usize;
    for chunk in chunks {
        if chunk.text.trim().is_empty() || chunk.ordinals.is_empty() {
            return false;
        }
        if chunk.ordinals[0] != expected {
            return false;
        }
        if chunk.ordinals.windows(2).any(|pair| pair[1] != pair[0] + 1) {
            return false;
        }
        expected = chunk.ordinals[chunk.ordinals.len() - 1] + 1;
    }
    expected == word_count
}

/// 行边界是否全部落在确定性分组的边界上：每行的首序号都是某组的首序号，
/// 且末序号都是某组的末序号（即"行 = 一个组或若干相邻组的并"）。
///
/// `groups` 为空时恒 `true`（没有分组提示就没有这条约束）。
pub fn rows_on_group_boundaries(chunks: &[AlignChunk], groups: &[FusionGroup]) -> bool {
    if groups.is_empty() {
        return true;
    }
    let starts: BTreeSet<usize> = groups.iter().map(|group| group.from).collect();
    let ends: BTreeSet<usize> = groups.iter().map(|group| group.to).collect();
    chunks.iter().all(|chunk| {
        match (chunk.ordinals.first(), chunk.ordinals.last()) {
            (Some(first), Some(last)) => starts.contains(first) && ends.contains(last),
            // 空序号块在行分区里已被排除；这里按"不在组边界上"处理。
            _ => false,
        }
    })
}

/// `data-align-groups` 的渲染：`1-4@0.0-1.4;5-9@1.4-3.2`——序号为 1-based
/// 闭区间，时间是相对句首的秒数（固定一位小数）。空表返回空串（不渲染属性）。
pub fn render_align_groups(groups: &[FusionGroup]) -> String {
    groups
        .iter()
        .map(|group| {
            format!(
                "{}-{}@{}-{}",
                group.from + 1,
                group.to + 1,
                format_deciseconds(group.t0_ds),
                format_deciseconds(group.t1_ds),
            )
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn format_deciseconds(value: u32) -> String {
    format!("{}.{}", value / 10, value % 10)
}

fn parse_deciseconds(raw: &str) -> Option<u32> {
    let (whole, fraction) = raw.trim().split_once('.')?;
    let whole: u32 = whole.parse().ok()?;
    let fraction: u32 = (fraction.len() == 1).then(|| fraction.parse().ok())??;
    Some(whole * 10 + fraction)
}

/// [`render_align_groups`] 的逆。任一项不可解析 ⇒ 空表（分组只是提示，
/// 解析失败绝不影响译文）。
pub fn parse_align_groups(raw: &str) -> Vec<FusionGroup> {
    let mut groups = Vec::new();
    for item in raw.split(';').filter(|item| !item.trim().is_empty()) {
        let Some((span, times)) = item.split_once('@') else {
            return Vec::new();
        };
        let (Some((from, to)), Some((t0, t1))) = (span.split_once('-'), times.split_once('-'))
        else {
            return Vec::new();
        };
        let (Ok(from), Ok(to)) = (from.trim().parse::<usize>(), to.trim().parse::<usize>()) else {
            return Vec::new();
        };
        let (Some(t0_ds), Some(t1_ds)) = (parse_deciseconds(t0), parse_deciseconds(t1)) else {
            return Vec::new();
        };
        if from == 0 || to < from {
            return Vec::new();
        }
        groups.push(FusionGroup {
            from: from - 1,
            to: to - 1,
            t0_ds,
            t1_ds,
        });
    }
    groups
}

impl TranslateSentence {
    /// 构造可编辑句。
    pub fn new(id: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            source: source.into(),
            editable: true,
            existing_translation: None,
            required_targets: Vec::new(),
            source_id: None,
            sentence_id: None,
            budget: None,
            alignment: None,
        }
    }

    /// 构造冻结句（stale-only 页里保语境的已译句）。
    pub fn frozen(
        id: impl Into<String>,
        source: impl Into<String>,
        translation: impl Into<String>,
    ) -> Self {
        Self {
            editable: false,
            existing_translation: Some(translation.into()),
            ..Self::new(id, source)
        }
    }
}

/// 一个自然段（`<section>` 是分页原子，不跨页拆分）。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TranslateSection {
    /// 段 id（`p-<段首词 id>`）。
    pub id: String,
    /// 说话人标签，写入 `data-sp`，仅供模型调语气，不要求回写。
    pub speaker: Option<String>,
    /// 段内句子。
    pub sentences: Vec<TranslateSentence>,
}

/// 一页翻译载体。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TranslatePage {
    /// 源语言标签。
    pub source_lang: String,
    /// 目标语言标签。
    pub target_lang: String,
    /// 工程指纹，写入 `data-project-fp`。
    pub project_fingerprint: String,
    /// 上页尾部语境（HTML 注释静态注入，不要求模型输出）。
    pub context_before: Option<String>,
    /// 下页头部语境。
    pub context_after: Option<String>,
    /// 段落列表。
    pub sections: Vec<TranslateSection>,
}

impl TranslatePage {
    /// 按渲染顺序列出全部句 id。
    pub fn sentence_ids(&self) -> Vec<&str> {
        self.sections
            .iter()
            .flat_map(|section| section.sentences.iter())
            .map(|sentence| sentence.id.as_str())
            .collect()
    }

    /// 按 id 查句。
    pub fn sentence(&self, id: &str) -> Option<&TranslateSentence> {
        self.sections
            .iter()
            .flat_map(|section| section.sentences.iter())
            .find(|sentence| sentence.id == id)
    }

    /// 句 id → 所属段 id。
    pub fn section_of(&self) -> BTreeMap<&str, &str> {
        let mut map = BTreeMap::new();
        for section in &self.sections {
            for sentence in &section.sentences {
                map.insert(sentence.id.as_str(), section.id.as_str());
            }
        }
        map
    }
}

/// 解析结果。
///
/// **重试判据是 [`page_rejected`](Self::page_rejected) 与 [`retry_ids`](Self::retry_ids)，
/// 不是 `diagnostics.has_problems()`。** 有两个 §10 码会落在一页「其余内容全部接受」的
/// 结果上：可编辑句的 `paragraph-move`（版式建议已记录，译文照常入库）与 `unknown-id`
/// （多余节点已丢弃）。调用方若用 `has_problems()` 决定是否重发，这两种情况会无限空转。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TranslateParsed {
    /// 通过校验、可以落盘的句译（句 id → 译文）。冻结句不在其中。
    pub translations: BTreeMap<String, String>,
    /// 尽力而为的融合对齐草稿。坏草稿静默丢弃，不进入 `retry_ids`，因此
    /// submit 成功只证明译文正确，不代表草稿已被 align 验收。
    pub alignments: BTreeMap<String, TranslateAlignmentDraft>,
    /// 行文本载体（`lines/1`，[`super::lines_translation`]）的逐句对齐草稿；
    /// HTML 载体下恒空。同 `alignments`：坏草稿只丢弃，不影响译文验收。
    pub lines: BTreeMap<String, super::lines_translation::TranslateLinesDraft>,
    /// 需要进修复波次的句 id（缺失/空译/术语缺失/截断尾部）。
    pub retry_ids: Vec<String>,
    /// 本页是否整体拒绝。
    ///
    /// 重试策略重设计 §2.3 之后只剩两种 page-fatal：体积超硬顶
    /// （`document-oversize`），以及一个期望句都没解析到（`document-truncated` /
    /// `document-wrapped`）。重复 id、截断尾部、冻结句被改/被搬都已降为
    /// 单元级或 advisory。
    pub page_rejected: bool,
    /// 诊断。
    pub diagnostics: Diagnostics,
}

/// 把注释文本变成安全的 HTML 注释内容（`--` 会提前闭合注释）。
fn escape_comment(text: &str) -> String {
    sanitize_inline_text(text).replace("--", "- -")
}

/// `data-rt` 的编码：JSON 数组，保证任意目标词（含 `"` `<` `&` `/`）都能原样回来。
fn encode_required_targets(targets: &[String]) -> String {
    serde_json::to_string(targets).unwrap_or_else(|_| "[]".to_owned())
}

/// `data-rt` 的解码；非法值按「没有锁定术语」处理，绝不因此拒页。
fn decode_required_targets(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

/// 从回答的 `<p>` 里抽取块对齐草稿：至少一个 `<span data-src>`、每个序号
/// 合法且句内不重复、块文本拼接（[`normalize_chars`] 口径）等于译文。任一
/// 条不满足 ⇒ `None`（丢草稿，不拒译文）。
fn fused_chunks(
    element: &Element,
    word_count: usize,
    translation: &str,
) -> Option<Vec<AlignChunk>> {
    let raw_chunks = chunks_from_element(element)?;
    let mut chunks = Vec::with_capacity(raw_chunks.len());
    let mut used = std::collections::BTreeSet::new();
    for (chunk_text, raw) in raw_chunks {
        if chunk_text.trim().is_empty() {
            continue;
        }
        let ordinals = match raw {
            None => Vec::new(),
            Some(raw) => parse_ordinals(&raw, word_count).ok()?,
        };
        if ordinals.iter().any(|ordinal| !used.insert(*ordinal)) {
            return None;
        }
        chunks.push(AlignChunk {
            text: chunk_text,
            ordinals,
        });
    }
    if chunks.is_empty() || chunks.iter().all(|chunk| chunk.ordinals.is_empty()) {
        return None;
    }
    let concat: String = chunks.iter().map(|chunk| chunk.text.as_str()).collect();
    (normalize_chars(&concat) == normalize_chars(translation)).then_some(chunks)
}

/// `data-budget` 文案：只带相对预算（整句字数上限），不带秒数。
///
/// 与 [`super::align_table`] 的同名属性同口径：单位按**目标语**在 CJK 与
/// 其他文字之间切换，数值本身已由引擎按目标语 cps 算好。
fn budget_text(budget: usize, target_lang: &str) -> String {
    let unit = if matches!(
        crate::split::primary_subtag(target_lang).as_str(),
        "zh" | "ja" | "ko"
    ) {
        "字"
    } else {
        "字符"
    };
    format!("整句≤{budget}{unit}")
}

/// 渲染一页翻译载体（§7.1）。
pub fn render_translate_page(page: &TranslatePage) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "<article lang=\"{}\" data-target=\"{}\" data-bcut-format=\"{}\" data-project-fp=\"{}\" data-validator=\"{}\">\n",
        escape_attr(&page.source_lang),
        escape_attr(&page.target_lang),
        escape_attr(TRANSLATION_SOURCE_FORMAT),
        escape_attr(&page.project_fingerprint),
        TRANSLATION_VALIDATOR_VERSION,
    ));
    if let Some(context) = &page.context_before {
        out.push_str(&format!(
            "  <!-- context-before: {} -->\n",
            escape_comment(context)
        ));
    }
    for section in &page.sections {
        out.push_str(&format!("  <section id=\"{}\"", escape_attr(&section.id)));
        if let Some(speaker) = &section.speaker {
            out.push_str(&format!(" data-sp=\"{}\"", escape_attr(speaker)));
        }
        out.push_str(">\n");
        for sentence in &section.sentences {
            out.push_str(&format!("    <p id=\"{}\"", escape_attr(&sentence.id)));
            if let Some(source_id) = &sentence.source_id {
                out.push_str(&format!(" data-source-id=\"{}\"", escape_attr(source_id)));
            }
            if let Some(sid) = &sentence.sentence_id {
                out.push_str(&format!(" data-sid=\"{}\"", escape_attr(sid)));
            }
            if !sentence.editable {
                out.push_str(" data-editable=\"false\"");
            }
            if let Some(budget) = sentence.budget {
                out.push_str(&format!(
                    " data-budget=\"{}\"",
                    escape_attr(&budget_text(budget, &page.target_lang))
                ));
            }
            if let Some(alignment) = sentence.alignment.as_ref().filter(|_| sentence.editable) {
                out.push_str(&format!(
                    " data-align-words=\"{}\" data-align-needed=\"{}\"",
                    escape_attr(&render_ordinal_words(&alignment.source_words)),
                    alignment.needs_split,
                ));
                if !alignment.groups.is_empty() {
                    out.push_str(&format!(
                        " data-align-groups=\"{}\"",
                        escape_attr(&render_align_groups(&alignment.groups))
                    ));
                }
            }
            if !sentence.required_targets.is_empty() {
                out.push_str(&format!(
                    " data-rt=\"{}\"",
                    escape_attr(&encode_required_targets(&sentence.required_targets))
                ));
            }
            if let Some(translation) = &sentence.existing_translation {
                out.push_str(&format!(
                    " data-translation=\"{}\"",
                    escape_attr(&sanitize_inline_text(translation))
                ));
            }
            out.push_str(&format!(
                ">{}</p>\n",
                escape_text(&sanitize_inline_text(&sentence.source))
            ));
        }
        out.push_str("  </section>\n");
    }
    if let Some(context) = &page.context_after {
        out.push_str(&format!(
            "  <!-- context-after: {} -->\n",
            escape_comment(context)
        ));
    }
    out.push_str("</article>\n");
    if let Some(reminder) = fusion_reminder(page) {
        out.push_str(reminder);
    }
    out
}

/// 载荷末尾的融合提醒（`</article>` 之后一行纯文本）。
///
/// system prompt 里的融合契约在长文档上会被"稀释"：实测 deepseek 一页 59 句
/// 只给前 3 句标了行，其余全部退回纯译文。把最关键的一条要求贴在用户消息
/// **末尾**（模型最后读到的地方）是侵入最小的补救——不改协议、不改解析
/// （[`parse_translate_source`] 按 `data-bcut-format` 定位 `<article>`，
/// 根级尾随文本一律忽略），也不影响 §16 体积护栏（它只看长度）。
///
/// 返回 `None` = 本页没有任何融合句，不加提醒。
fn fusion_reminder(page: &TranslatePage) -> Option<&'static str> {
    let alignments = page
        .sections
        .iter()
        .flat_map(|section| section.sentences.iter())
        .filter(|sentence| sentence.editable)
        .filter_map(|sentence| sentence.alignment.as_ref());
    let mut any = false;
    let mut rows = false;
    for alignment in alignments {
        any = true;
        rows |= !alignment.groups.is_empty();
    }
    if !any {
        return None;
    }
    Some(if rows {
        "\nReminder: answer with `<p id=\"…\">` and no other attributes. EVERY sentence that carried data-align-groups — all of them, not just the first few — must come back cut into <span data-src=\"a-b\"> display rows.\n"
    } else {
        "\nReminder: answer with `<p id=\"…\">` and no other attributes. EVERY sentence that carried data-align-words must come back with its <span data-src=\"…\"> chunk annotation.\n"
    })
}

/// 从渲染文本反解出**校验等价**的 [`TranslatePage`]（§2「校验只有一份」）。
///
/// `bcut task submit` 在独立进程里只拿得到磁盘上的输入文件与模型答案，手上没有渲染侧
/// 结构；本函数让 agent lint 与 provider validate 都能落到同一个 [`parse_translate_page`]，
/// 而不是各写一份校验。
///
/// 只复原**校验相关**的字段：句 id 与顺序、段归属、`editable`、既有译文、required
/// targets。源文按归一化文本回填（[`parse_translate_page`] 从不读 `source`），
/// 语境注释与 `budget` 不复原（它们是给模型看的提示，没有对应的校验项；重试波次
/// 由引擎侧的行投影重新渲染，不会从这里回推预算）。
///
/// 解析对**未知属性一律忽略**：新增载体属性不会让旧任务目录里的 `src.html`
/// 变成 `document-*` 问题，反之亦然。
///
/// 返回 `None` 表示这不是一份 translate 载体（找不到 `data-bcut-format` 根）。
pub fn parse_translate_source(input: &str) -> Option<TranslatePage> {
    let tree = parse_html(input);
    let article = tree
        .elements()
        .into_iter()
        .find(|element| element.attr("data-bcut-format") == Some(TRANSLATION_SOURCE_FORMAT))?;
    let mut page = TranslatePage {
        source_lang: article.attr("lang").unwrap_or_default().to_owned(),
        target_lang: article.attr("data-target").unwrap_or_default().to_owned(),
        project_fingerprint: article
            .attr("data-project-fp")
            .unwrap_or_default()
            .to_owned(),
        context_before: None,
        context_after: None,
        sections: Vec::new(),
    };
    for section_element in article.child_elements() {
        let Some(section_id) = section_element.id().filter(|id| !id.is_empty()) else {
            continue;
        };
        let mut section = TranslateSection {
            id: section_id.to_owned(),
            speaker: section_element.attr("data-sp").map(str::to_owned),
            sentences: Vec::new(),
        };
        for element in section_element.descendants() {
            let Some(id) = element.id().filter(|id| !id.is_empty()) else {
                continue;
            };
            section.sentences.push(TranslateSentence {
                id: id.to_owned(),
                source: element.text(),
                editable: element.attr("data-editable") != Some("false"),
                existing_translation: element.attr("data-translation").map(str::to_owned),
                required_targets: element
                    .attr("data-rt")
                    .map(decode_required_targets)
                    .unwrap_or_default(),
                source_id: element.attr("data-source-id").map(str::to_owned),
                sentence_id: element.attr("data-sid").map(str::to_owned),
                budget: None,
                alignment: element
                    .attr("data-align-words")
                    .map(|raw| TranslateAlignmentInput {
                        source_words: parse_ordinal_words(raw),
                        needs_split: element.attr("data-align-needed") == Some("true"),
                        groups: element
                            .attr("data-align-groups")
                            .map(parse_align_groups)
                            .unwrap_or_default(),
                        source_glue: Vec::new(),
                    }),
            });
        }
        page.sections.push(section);
    }
    Some(page)
}

/// 解析并 lint 模型返回的翻译 HTML（§7.4 症状对账表）。
///
/// `page` 是渲染侧结构：id 集合、冻结句与 required targets 都从这里来，
/// 因此解析入口不接受裸字符串。
///
/// `input` 是当初实际发给模型的那份渲染文本（宿主手上即 `DocumentRequest.input.content`），
/// 只用作 §16 体积护栏的基准；传 `None` 表示跳过体积护栏。parse 不会自己调用 render 反推长度。
pub fn parse_translate_page(
    page: &TranslatePage,
    input: Option<&str>,
    output: &str,
) -> TranslateParsed {
    let mut parsed = TranslateParsed::default();
    let normalized = normalize_llm_output(output);
    for warning in normalized.warnings() {
        parsed.diagnostics.push_warning(warning);
    }
    if let Some(problem) = input.and_then(|input| guard_output_size(input, &normalized.text)) {
        parsed.diagnostics.push_problem(problem);
        parsed.page_rejected = true;
        return parsed;
    }

    let tree = parse_html(&normalized.text);
    for warning in tree.warnings() {
        parsed.diagnostics.push_warning(warning);
    }
    let (index, duplicates) = index_by_id(&tree);

    let expected_sentences: BTreeSet<&str> = page.sentence_ids().into_iter().collect();
    let expected_sections: BTreeSet<&str> = page.sections.iter().map(|s| s.id.as_str()).collect();

    // 重复 id：取**首个**并记 Warning（重试策略重设计 §2.3）。
    //
    // `index_by_id` 已经按首见保留，因此这里只需要说明取舍。旧实现整页拒收
    // 重试——重复 id 是模型把同一句写了两遍，其余句子完全可用，为它重掷整页
    // 是纯烧 token。
    for id in &duplicates {
        if expected_sentences.contains(id.as_str()) || expected_sections.contains(id.as_str()) {
            parsed.diagnostics.push_warning(Warning::sentence(
                WarningCode::DuplicateId,
                id,
                "同一 id 出现多次，已取首个",
            ));
        }
    }

    // 未知 id：判据是**结构**而不是 id 字面量。
    //
    // id 方案不止一种：常规是 `s-<首词 id>`，timeline 多源场景是全局唯一 route id
    // （现行 `r%06d`）。按前缀猜「像不像协议 id」会让 route id 场景的幻觉句被静默丢掉，
    // 所以改为看它包不包着本页期望的 id：
    // - 包着期望 id → 模型自己套的容器（`<div id="page">` 之类）→ ContentIgnored 警告，
    //   advisory 不进重试账本，免得污染 §10 的封闭集合语义；
    // - 不包任何期望 id → 凭空多出来的内容节点 → `unknown-id`。
    for (id, element) in index.iter() {
        if expected_sentences.contains(id.as_str()) || expected_sections.contains(id.as_str()) {
            continue;
        }
        let wraps_expected = element.descendants().into_iter().any(|descendant| {
            descendant.id().is_some_and(|inner| {
                expected_sentences.contains(inner) || expected_sections.contains(inner)
            })
        });
        if wraps_expected {
            parsed.diagnostics.push_warning(Warning::sentence(
                WarningCode::ContentIgnored,
                id,
                "模型自加的容器节点，已忽略",
            ));
        } else {
            parsed.diagnostics.push_problem(Problem::sentence(
                ProblemCode::UnknownId,
                id,
                "协议外的 id，已忽略该节点",
            ));
        }
    }

    // 段落归属：只在「句落在另一个已知段里」时判 paragraph-move。
    let mut actual_section: BTreeMap<&str, &str> = BTreeMap::new();
    for section_id in &expected_sections {
        if let Some(element) = index.get(*section_id) {
            for descendant in element.descendants() {
                if let Some(id) = descendant.id()
                    && expected_sentences.contains(id)
                {
                    actual_section.entry(id).or_insert(section_id);
                }
            }
        }
    }
    let expected_section_of = page.section_of();

    let ordered_ids = page.sentence_ids();
    let mut present = Vec::new();
    let mut missing = Vec::new();
    for id in &ordered_ids {
        if index.contains_key(*id) {
            present.push(*id);
        } else {
            missing.push(*id);
        }
    }

    // §9.3：截断与漏译必须区分——期望 id 的「连续后缀」整体缺失才是截断。
    let truncated = !missing.is_empty()
        && !present.is_empty()
        && ordered_ids[ordered_ids.len() - missing.len()..] == missing[..];
    // 一个期望句都没解析到：这已经不是「漏了几句」而是整页失败，本页拒绝。
    // 判据：输出里还有别的 id（含 section id）→ 结构在但句子没了，按截断处理；
    // 输出里一个 id 都没有 → 模型多半把文档整个改写/包裹了，按 document-wrapped 处理。
    let nothing_parsed = present.is_empty() && !ordered_ids.is_empty();
    if nothing_parsed {
        let has_any_id = !index.is_empty();
        let code = if has_any_id {
            ProblemCode::DocumentTruncated
        } else {
            ProblemCode::DocumentWrapped
        };
        parsed.page_rejected = true;
        parsed.diagnostics.push_problem(Problem::document(
            code,
            format!("未解析到任何期望句 id（共 {} 句）", ordered_ids.len()),
        ));
        return parsed;
    }
    // 截断（期望 id 的连续后缀整体缺失）与散点漏译现在**同样按单元处理**
    // （重试策略重设计 §2.3）：已解析的句照常接受落库，缺失 id 进 `retry_ids`
    // 交给波 2/3 重发。一个期望句都没解析到才 page-fatal（上面 `nothing_parsed`
    // 那一支）。旧实现把截断整页拒收，前面几十句白翻一遍。
    if truncated {
        parsed.diagnostics.push_problem(Problem::document(
            ProblemCode::DocumentTruncated,
            format!(
                "尾部 {} 句连续缺失，疑似输出截断；已接受前 {} 句，缺失 id 进补做波次",
                missing.len(),
                present.len()
            ),
        ));
    }
    for id in &missing {
        parsed.retry_ids.push((*id).to_owned());
        if !truncated {
            parsed.diagnostics.push_problem(Problem::sentence(
                ProblemCode::MissingId,
                *id,
                "输出中缺少该句 id",
            ));
        }
    }

    for id in present {
        let Some(sentence) = page.sentence(id) else {
            continue;
        };
        let element = index[id];
        let text = element.text();

        // 段落归属：可编辑句被挪段是单元级问题（照常记 problem，不拒页）；
        // 冻结句被挪段降为 advisory——冻结句的**文本从不进 `translations`**
        // （下面那个 `continue` 是唯一出口），既有译文在 apply 侧原样保留，
        // 因此挪动它对真相没有任何影响（重试策略重设计 §2.3）。
        let moved = match (actual_section.get(id), expected_section_of.get(id)) {
            (Some(actual), Some(expected)) => actual != expected,
            _ => false,
        };
        if moved {
            let actual = actual_section[id];
            let expected = expected_section_of[id];
            if sentence.editable {
                parsed.diagnostics.push_problem(Problem::sentence(
                    ProblemCode::ParagraphMove,
                    id,
                    format!("句子被移到段 {actual}（应在 {expected}）"),
                ));
            } else {
                parsed.diagnostics.push_warning(Warning::sentence(
                    WarningCode::FrozenIgnored,
                    id,
                    format!("冻结句被移到段 {actual}（应在 {expected}），已忽略"),
                ));
            }
        }

        if !sentence.editable {
            let existing = sentence.existing_translation.as_deref().unwrap_or_default();
            if normalize_chars(&text) != normalize_chars(existing) {
                parsed.diagnostics.push_warning(Warning::sentence(
                    WarningCode::FrozenIgnored,
                    id,
                    "冻结句被改动，已忽略模型文本并保留既有译文",
                ));
            }
            continue;
        }

        if text.trim().is_empty() {
            parsed.retry_ids.push(id.to_owned());
            parsed.diagnostics.push_problem(Problem::sentence(
                ProblemCode::EmptyTranslation,
                id,
                "译文为空",
            ));
            continue;
        }

        let missing_terms: Vec<&str> = sentence
            .required_targets
            .iter()
            .filter(|target| !term_present(&text, target))
            .map(String::as_str)
            .collect();
        if !missing_terms.is_empty() {
            parsed.retry_ids.push(id.to_owned());
            parsed.diagnostics.push_problem(Problem::sentence(
                ProblemCode::GlossaryMissing,
                id,
                format!("锁定术语缺失：{}", missing_terms.join(", ")),
            ));
            continue;
        }

        // 融合块对齐草稿（对齐块设计 §6.1）：`<p>` 内的 `<span data-src>`。
        // 坏草稿静默丢弃，绝不拒译文。
        if let Some(alignment) = sentence.alignment.as_ref()
            && let Some(chunks) = fused_chunks(element, alignment.source_words.len(), &text)
        {
            // 行分区只在**载体请求了行**时采信：`data-align-groups` 就是
            // rows 模式的载体信号（常规 fusion 契约要的是最小语义块，把它
            // 当显示行会把一句切成一串碎行）。
            let rows = !alignment.groups.is_empty()
                && is_row_partition(&chunks, alignment.source_words.len());
            let on_groups = rows && rows_on_group_boundaries(&chunks, &alignment.groups);
            parsed.alignments.insert(
                id.to_owned(),
                TranslateAlignmentDraft {
                    chunks,
                    rows,
                    on_groups,
                },
            );
        }
        parsed.translations.insert(id.to_owned(), text);
    }

    if !normalized.text.trim_start().starts_with('<') && !parsed.translations.is_empty() {
        parsed.diagnostics.push_warning(Warning::document(
            WarningCode::ContentIgnored,
            "输出开头存在非 HTML 内容，已按 id 抽取",
        ));
    }

    parsed
}

/// 在结构解析之后追加内容质量门。拆成显式步骤，让底层 HTML 解析器仍可单独
/// 测试结构恢复；生产 provider 与 Agent lint 都必须调用本函数。
pub fn validate_translation_quality(page: &TranslatePage, parsed: &mut TranslateParsed) {
    let accepted = parsed.translations.clone();
    for (id, text) in accepted {
        let Some(sentence) = page.sentence(&id) else {
            continue;
        };
        let issues = translation_quality_issues(&sentence.source, &page.target_lang, &text);
        if issues.is_empty() {
            continue;
        }
        parsed.translations.remove(&id);
        if !parsed.retry_ids.contains(&id) {
            parsed.retry_ids.push(id.clone());
        }
        for issue in issues {
            let code = match issue.code {
                TranslationQualityCode::TargetLanguageMismatch => {
                    ProblemCode::TargetLanguageMismatch
                }
                TranslationQualityCode::Placeholder => ProblemCode::TranslationPlaceholder,
                TranslationQualityCode::SourceCopy => ProblemCode::TranslationSourceCopy,
                TranslationQualityCode::TooShort => ProblemCode::TranslationTooShort,
            };
            parsed
                .diagnostics
                .push_problem(Problem::sentence(code, &id, issue.detail));
        }
    }

    let collapsed = duplicate_collapse_ids(parsed.translations.iter().filter_map(|(id, text)| {
        page.sentence(id)
            .map(|sentence| (id.as_str(), sentence.source.as_str(), text.as_str()))
    }));
    let collapsed_count = collapsed.len();
    for id in collapsed {
        parsed.translations.remove(&id);
        if !parsed.retry_ids.contains(&id) {
            parsed.retry_ids.push(id.clone());
        }
        parsed.diagnostics.push_problem(Problem::sentence(
            ProblemCode::TranslationDuplicateCollapse,
            &id,
            format!("本页 {collapsed_count} 句塌缩成同一个短译文"),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_page() -> TranslatePage {
        TranslatePage {
            source_lang: "en".to_owned(),
            target_lang: "zh".to_owned(),
            project_fingerprint: "1024:g1.0:g88.4:ab12cd".to_owned(),
            context_before: Some("previous tail".to_owned()),
            context_after: None,
            sections: vec![TranslateSection {
                id: "p-g1.0".to_owned(),
                speaker: Some("S1".to_owned()),
                sentences: vec![
                    TranslateSentence::new("s-g1.0", "Ninety days, eight times the growth."),
                    TranslateSentence::new("s-g1.7", "We did it without ads."),
                ],
            }],
        }
    }

    fn answer(pairs: &[(&str, &str)]) -> String {
        let mut out = String::from("<article>\n  <section id=\"p-g1.0\">\n");
        for (id, text) in pairs {
            out.push_str(&format!("    <p id=\"{id}\">{text}</p>\n"));
        }
        out.push_str("  </section>\n</article>\n");
        out
    }

    #[test]
    fn render_matches_spec_shape() {
        let rendered = render_translate_page(&sample_page());
        let expected = concat!(
            "<article lang=\"en\" data-target=\"zh\" data-bcut-format=\"translation-source/1\" data-project-fp=\"1024:g1.0:g88.4:ab12cd\" data-validator=\"4\">\n",
            "  <!-- context-before: previous tail -->\n",
            "  <section id=\"p-g1.0\" data-sp=\"S1\">\n",
            "    <p id=\"s-g1.0\">Ninety days, eight times the growth.</p>\n",
            "    <p id=\"s-g1.7\">We did it without ads.</p>\n",
            "  </section>\n",
            "</article>\n",
        );
        assert_eq!(rendered, expected);
    }

    #[test]
    fn round_trip_accepts_all_sentences() {
        let page = sample_page();
        let parsed = parse_translate_page(
            &page,
            None,
            &answer(&[("s-g1.0", "九十天翻了八倍。"), ("s-g1.7", "没投一分广告。")]),
        );
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.translations["s-g1.0"], "九十天翻了八倍。");
        assert_eq!(parsed.translations["s-g1.7"], "没投一分广告。");
        assert!(!parsed.page_rejected);
    }

    #[test]
    fn content_gate_rejects_wrong_language_placeholders_and_source_copy() {
        let mut page = sample_page();
        page.source_lang = "zh".to_owned();
        page.target_lang = "en".to_owned();
        page.sections[0].sentences[0].source = "这是第一句中文源文。".to_owned();
        page.sections[0].sentences[1].source = "这是第二句中文源文。".to_owned();
        let mut parsed = parse_translate_page(
            &page,
            None,
            &answer(&[
                ("s-g1.0", "这是完整的中文回答。"),
                ("s-g1.7", "Translation."),
            ]),
        );
        validate_translation_quality(&page, &mut parsed);
        assert!(parsed.translations.is_empty());
        assert!(
            parsed
                .diagnostics
                .has_code(ProblemCode::TargetLanguageMismatch)
        );
        assert!(
            parsed
                .diagnostics
                .has_code(ProblemCode::TranslationPlaceholder)
        );

        let mut copied = parse_translate_page(
            &page,
            None,
            &answer(&[
                ("s-g1.0", "这是第一句中文源文。"),
                ("s-g1.7", "A valid translation."),
            ]),
        );
        validate_translation_quality(&page, &mut copied);
        assert!(
            copied
                .diagnostics
                .has_code(ProblemCode::TranslationSourceCopy)
        );
    }

    #[test]
    fn content_gate_rejects_page_duplicate_collapse() {
        let mut page = sample_page();
        page.target_lang = "en".to_owned();
        page.sections[0]
            .sentences
            .push(TranslateSentence::new("s-g1.9", "Third source sentence."));
        let mut parsed = parse_translate_page(
            &page,
            None,
            &answer(&[
                ("s-g1.0", "Done."),
                ("s-g1.7", "Done."),
                ("s-g1.9", "Done."),
            ]),
        );
        validate_translation_quality(&page, &mut parsed);
        assert!(parsed.translations.is_empty());
        assert!(
            parsed
                .diagnostics
                .has_code(ProblemCode::TranslationDuplicateCollapse)
        );
    }

    /// 逐句阅读预算是 file-v1 的长度通道：`data-budget` 只带相对预算文案，
    /// 单位随目标语言切换，绝不带秒数。
    #[test]
    fn budget_renders_as_a_readable_attribute() {
        let mut page = sample_page();
        page.sections[0].sentences[0].budget = Some(42);
        let rendered = render_translate_page(&page);
        assert!(
            rendered.contains(
                "    <p id=\"s-g1.0\" data-budget=\"整句≤42字\">Ninety days, eight times the growth.</p>\n"
            ),
            "{rendered}"
        );
        // 没有预算的句子照旧不带该属性。
        assert!(
            rendered.contains("    <p id=\"s-g1.7\">We did it without ads.</p>\n"),
            "{rendered}"
        );

        page.target_lang = "de".to_owned();
        let rendered = render_translate_page(&page);
        assert!(
            rendered.contains("data-budget=\"整句≤42字符\""),
            "{rendered}"
        );
    }

    /// 新属性不进校验：解析器忽略它，旧任务目录里不带 `data-budget` 的
    /// `src.html` 与新渲染文本必须给出完全一致的判定。
    #[test]
    fn budget_is_ignored_by_the_parser() {
        let mut page = sample_page();
        page.sections[0].sentences[0].budget = Some(42);
        page.sections[0].sentences[1].budget = Some(9);
        let rendered = render_translate_page(&page);

        let recovered = parse_translate_source(&rendered).expect("translate carrier");
        assert_eq!(recovered.sentence_ids(), page.sentence_ids());
        assert_eq!(recovered.sentence("s-g1.0").unwrap().budget, None);

        let mut legacy = page.clone();
        for sentence in &mut legacy.sections[0].sentences {
            sentence.budget = None;
        }
        let legacy_rendered = render_translate_page(&legacy);
        assert!(!legacy_rendered.contains("data-budget"));

        let answer = answer(&[("s-g1.0", "九十天翻了八倍。"), ("s-g1.7", "没投一分广告。")]);
        let with_budget = parse_translate_page(&page, Some(&rendered), &answer);
        let without_budget = parse_translate_page(&legacy, Some(&legacy_rendered), &answer);
        assert!(!with_budget.diagnostics.has_problems());
        assert_eq!(with_budget, without_budget);
        // 反向兼容：旧载荷配新渲染结构、新载荷配旧结构，判定都不变。
        assert_eq!(
            parse_translate_page(&recovered, Some(&rendered), &answer),
            without_budget
        );
    }

    #[test]
    fn fused_alignment_attributes_round_trip_and_extract_a_valid_draft() {
        let mut page = sample_page();
        page.sections[0].sentences[0].alignment = Some(TranslateAlignmentInput {
            source_words: ["Ninety", "days,", "eight", "times", "the", "growth."]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            needs_split: true,
            groups: Vec::new(),
            source_glue: Vec::new(),
        });
        let rendered = render_translate_page(&page);
        assert!(
            rendered.contains(
                "data-align-words=\"[1]Ninety [2]days, [3]eight [4]times [5]the [6]growth.\" data-align-needed=\"true\""
            ),
            "{rendered}"
        );
        assert!(!rendered.contains("data-align-target"), "{rendered}");
        let recovered = parse_translate_source(&rendered).expect("translate carrier");
        assert_eq!(
            recovered.sections[0].sentences[0].alignment,
            page.sections[0].sentences[0].alignment
        );

        let output = concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\" data-align-words=\"[1]Ninety [2]days, [3]eight [4]times [5]the [6]growth.\" data-align-needed=\"true\">",
            "<span data-src=\"1-2\">九十天</span><span data-src=\"3 4 6\">增长八倍。</span></p>",
            "<p id=\"s-g1.7\">没投一分广告。</p>",
            "</section></article>",
        );
        let parsed = parse_translate_page(&page, Some(&rendered), output);
        assert!(!parsed.page_rejected);
        assert!(parsed.retry_ids.is_empty(), "{:?}", parsed.diagnostics);
        // span 对译文透明：正文仍是完整译句。
        assert_eq!(parsed.translations["s-g1.0"], "九十天增长八倍。");
        assert_eq!(
            parsed.alignments["s-g1.0"],
            TranslateAlignmentDraft {
                chunks: vec![
                    AlignChunk {
                        text: "九十天".to_owned(),
                        ordinals: vec![0, 1],
                    },
                    AlignChunk {
                        text: "增长八倍。".to_owned(),
                        ordinals: vec![2, 3, 5],
                    },
                ],
                // 序号有缺口（4 未覆盖）⇒ 不是行分区。
                rows: false,
                on_groups: false,
            }
        );
    }

    #[test]
    fn invalid_fused_draft_is_silently_ignored_without_rejecting_translation() {
        let mut page = sample_page();
        page.sections[0].sentences[0].alignment = Some(TranslateAlignmentInput {
            source_words: ["Ninety", "days,", "eight", "times", "the", "growth."]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            needs_split: true,
            groups: Vec::new(),
            source_glue: Vec::new(),
        });
        // 序号越界（9 > 6）与序号跨块重复各一例；译文本身照常入库。
        for output in [
            concat!(
                "<article><section id=\"p-g1.0\">",
                "<p id=\"s-g1.0\"><span data-src=\"1-2\">九十天</span><span data-src=\"9\">增长八倍。</span></p>",
                "<p id=\"s-g1.7\">没投一分广告。</p>",
                "</section></article>",
            ),
            concat!(
                "<article><section id=\"p-g1.0\">",
                "<p id=\"s-g1.0\"><span data-src=\"1-2\">九十天</span><span data-src=\"2 3\">增长八倍。</span></p>",
                "<p id=\"s-g1.7\">没投一分广告。</p>",
                "</section></article>",
            ),
        ] {
            let parsed = parse_translate_page(&page, None, output);
            assert!(parsed.alignments.is_empty(), "{output}");
            assert!(parsed.retry_ids.is_empty(), "{:?}", parsed.diagnostics);
            assert!(!parsed.page_rejected);
            assert_eq!(parsed.translations["s-g1.0"], "九十天增长八倍。");
        }
    }

    #[test]
    fn source_specials_survive_round_trip() {
        let mut page = sample_page();
        page.sections[0].sentences[0].source = "a <b> & \"c\" 'd'".to_owned();
        let rendered = render_translate_page(&page);
        assert!(rendered.contains("a &lt;b&gt; &amp; \"c\" 'd'"));
        let tree = parse_html(&rendered);
        let (index, _) = index_by_id(&tree);
        assert_eq!(index["s-g1.0"].text(), "a <b> & \"c\" 'd'");
    }

    #[test]
    fn cjk_spaces_are_collapsed_on_parse() {
        // 与 `markers::sanitize_corrected` 同口径：CJK 之间的空格是模型噪声。
        let page = sample_page();
        let parsed = parse_translate_page(
            &page,
            None,
            &answer(&[("s-g1.0", "九十 天"), ("s-g1.7", "no ads")]),
        );
        assert_eq!(parsed.translations["s-g1.0"], "九十天");
        assert_eq!(parsed.translations["s-g1.7"], "no ads");
    }

    #[test]
    fn tag_name_changes_are_accepted() {
        let page = sample_page();
        let output = "<div><div id=\"p-g1.0\"><span id=\"s-g1.0\">译一</span><span id=\"s-g1.7\">译二</span></div></div>";
        let parsed = parse_translate_page(&page, None, output);
        assert!(!parsed.diagnostics.has_problems());
        assert_eq!(parsed.translations.len(), 2);
    }

    #[test]
    fn missing_middle_sentence_is_missing_id() {
        let mut page = sample_page();
        page.sections[0]
            .sentences
            .push(TranslateSentence::new("s-g2.0", "Third."));
        let parsed =
            parse_translate_page(&page, None, &answer(&[("s-g1.0", "一"), ("s-g2.0", "三")]));
        assert!(parsed.diagnostics.has_code(ProblemCode::MissingId));
        assert!(!parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
        assert_eq!(parsed.retry_ids, vec!["s-g1.7".to_owned()]);
        assert_eq!(parsed.translations.len(), 2);
    }

    #[test]
    /// §2.3：连续后缀缺失（截断）且已解析 ≥1 句 ⇒ 接受已解析句，缺失 id 进
    /// `retry_ids`（波 2/3 既有机制），不再整页拒收把前面几十句白翻一遍。
    fn missing_suffix_is_truncation_but_keeps_the_parsed_prefix() {
        let mut page = sample_page();
        page.sections[0]
            .sentences
            .push(TranslateSentence::new("s-g2.0", "Third."));
        let parsed = parse_translate_page(&page, None, &answer(&[("s-g1.0", "一")]));
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
        assert!(!parsed.diagnostics.has_code(ProblemCode::MissingId));
        assert!(!parsed.page_rejected);
        assert_eq!(parsed.translations["s-g1.0"], "一");
        assert_eq!(parsed.retry_ids, vec!["s-g1.7", "s-g2.0"]);
    }

    #[test]
    fn chatter_without_html_is_document_wrapped() {
        let page = sample_page();
        let parsed = parse_translate_page(&page, None, "好的，这是翻译：九十天翻了八倍。");
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentWrapped));
        assert!(parsed.page_rejected);
    }

    #[test]
    fn single_code_fence_is_stripped_without_error() {
        let page = sample_page();
        let wrapped = format!(
            "```html\n{}```\n",
            answer(&[("s-g1.0", "一"), ("s-g1.7", "二")])
        );
        let parsed = parse_translate_page(&page, None, &wrapped);
        assert!(!parsed.diagnostics.has_problems());
        assert_eq!(parsed.translations.len(), 2);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::WrapperStripped)
        );
    }

    #[test]
    /// §2.3：重复 id 取首个 + Warning，不再整页拒收——其余句子完全可用。
    fn duplicate_id_takes_the_first_and_warns() {
        let page = sample_page();
        let parsed = parse_translate_page(
            &page,
            None,
            &answer(&[("s-g1.0", "一"), ("s-g1.0", "壹"), ("s-g1.7", "二")]),
        );
        assert!(!parsed.page_rejected);
        assert!(!parsed.diagnostics.has_code(ProblemCode::DuplicateId));
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::DuplicateId)
        );
        assert_eq!(parsed.translations["s-g1.0"], "一");
        assert_eq!(parsed.translations.len(), 2);
    }

    #[test]
    fn unknown_id_is_reported_and_ignored() {
        let page = sample_page();
        let parsed = parse_translate_page(
            &page,
            None,
            &answer(&[("s-g1.0", "一"), ("s-g1.7", "二"), ("s-g9.9", "凭空")]),
        );
        assert!(parsed.diagnostics.has_code(ProblemCode::UnknownId));
        assert_eq!(parsed.translations.len(), 2);
        assert!(!parsed.page_rejected);
    }

    #[test]
    fn non_protocol_wrapper_id_is_only_a_warning() {
        // 模型自己套一层 `<div id="page">` 不是协议违规，不能进重试账本。
        let page = sample_page();
        let body = answer(&[("s-g1.0", "一"), ("s-g1.7", "二")]);
        let wrapped = format!("<div id=\"page\">\n{body}</div>\n");
        let parsed = parse_translate_page(&page, None, &wrapped);
        assert!(!parsed.diagnostics.has_code(ProblemCode::UnknownId));
        assert!(!parsed.diagnostics.has_problems());
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ContentIgnored)
        );
        assert_eq!(parsed.translations.len(), 2);
    }

    #[test]
    fn route_style_stray_leaf_is_an_unknown_id() {
        // timeline 多源场景的 id 是全局唯一 route id（`r%06d`），没有 `s-` 前缀。
        // 凭空多出来的这类叶子节点必须判 unknown-id，不能被当成模型容器静默丢掉。
        let page = sample_page();
        let body = answer(&[("s-g1.0", "一"), ("s-g1.7", "二")]);
        let polluted = format!("{body}<p id=\"r000999\">凭空</p>\n");
        let parsed = parse_translate_page(&page, None, &polluted);
        assert!(parsed.diagnostics.has_code(ProblemCode::UnknownId));
        assert_eq!(parsed.translations.len(), 2);
        assert!(!parsed.page_rejected);
    }

    #[test]
    fn empty_translation_is_reported() {
        let page = sample_page();
        let parsed =
            parse_translate_page(&page, None, &answer(&[("s-g1.0", "  "), ("s-g1.7", "二")]));
        assert!(parsed.diagnostics.has_code(ProblemCode::EmptyTranslation));
        assert_eq!(parsed.retry_ids, vec!["s-g1.0".to_owned()]);
    }

    #[test]
    fn locked_glossary_target_must_appear() {
        let mut page = sample_page();
        page.sections[0].sentences[0].required_targets = vec!["BaoCut".to_owned()];
        let ok = parse_translate_page(
            &page,
            None,
            &answer(&[("s-g1.0", "BaoCut 增长八倍"), ("s-g1.7", "二")]),
        );
        assert!(!ok.diagnostics.has_code(ProblemCode::GlossaryMissing));
        let bad = parse_translate_page(
            &page,
            None,
            &answer(&[("s-g1.0", "宝卡特增长八倍"), ("s-g1.7", "二")]),
        );
        assert!(bad.diagnostics.has_code(ProblemCode::GlossaryMissing));
        assert!(!bad.translations.contains_key("s-g1.0"));
    }

    #[test]
    fn frozen_sentence_must_stay_verbatim() {
        let mut page = sample_page();
        page.sections[0].sentences[1] =
            TranslateSentence::frozen("s-g1.7", "We did it without ads.", "没投一分广告。");
        let rendered = render_translate_page(&page);
        assert!(rendered.contains("data-editable=\"false\""));
        assert!(rendered.contains("data-translation=\"没投一分广告。\""));

        let intact = parse_translate_page(
            &page,
            None,
            &answer(&[("s-g1.0", "一"), ("s-g1.7", "没投一分广告。")]),
        );
        assert!(!intact.diagnostics.has_code(ProblemCode::FrozenModified));
        assert_eq!(intact.translations.len(), 1);

        // §2.3：冻结句被改动只记 Warning——它的文本从不进 `translations`，
        // 既有译文在 apply 侧原样保留，整页拒收只是白白重掷其余句子。
        let touched = parse_translate_page(
            &page,
            None,
            &answer(&[("s-g1.0", "一"), ("s-g1.7", "一分广告都没投。")]),
        );
        assert!(!touched.diagnostics.has_code(ProblemCode::FrozenModified));
        assert!(!touched.page_rejected);
        assert!(
            !touched.translations.contains_key("s-g1.7"),
            "冻结句从不写回"
        );
        assert!(
            touched
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::FrozenIgnored)
        );
    }

    #[test]
    fn paragraph_move_is_detected() {
        let mut page = sample_page();
        page.sections.push(TranslateSection {
            id: "p-g2.0".to_owned(),
            speaker: None,
            sentences: vec![TranslateSentence::new("s-g2.0", "Third.")],
        });
        let output = concat!(
            "<article><section id=\"p-g1.0\"><p id=\"s-g1.0\">一</p></section>",
            "<section id=\"p-g2.0\"><p id=\"s-g1.7\">二</p><p id=\"s-g2.0\">三</p></section></article>",
        );
        let parsed = parse_translate_page(&page, None, output);
        assert!(parsed.diagnostics.has_code(ProblemCode::ParagraphMove));
        assert_eq!(parsed.translations.len(), 3);
    }

    #[test]
    fn moving_a_frozen_sentence_is_only_a_warning() {
        // §2.3：挪动冻结句同样只记 Warning——冻结句文本从不写回真相。
        let mut page = sample_page();
        page.sections[0].sentences[1] =
            TranslateSentence::frozen("s-g1.7", "We did it without ads.", "没投一分广告。");
        page.sections.push(TranslateSection {
            id: "p-g2.0".to_owned(),
            speaker: None,
            sentences: vec![TranslateSentence::new("s-g2.0", "Third.")],
        });
        let output = concat!(
            "<article><section id=\"p-g1.0\"><p id=\"s-g1.0\">一</p></section>",
            "<section id=\"p-g2.0\"><p id=\"s-g1.7\">没投一分广告。</p>",
            "<p id=\"s-g2.0\">三</p></section></article>",
        );
        let parsed = parse_translate_page(&page, None, output);
        assert!(!parsed.diagnostics.has_code(ProblemCode::ParagraphMove));
        assert!(!parsed.page_rejected);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::FrozenIgnored)
        );
    }

    #[test]
    fn missing_section_ids_still_accept_sentences() {
        let page = sample_page();
        let parsed = parse_translate_page(
            &page,
            None,
            "<article><p id=\"s-g1.0\">一</p><p id=\"s-g1.7\">二</p></article>",
        );
        assert!(!parsed.diagnostics.has_problems());
        assert_eq!(parsed.translations.len(), 2);
    }

    #[test]
    fn script_injection_is_dropped() {
        let page = sample_page();
        let output = concat!(
            "<article><section id=\"p-g1.0\">",
            "<script>alert(1)</script>",
            "<p id=\"s-g1.0\" onclick=\"steal()\">一</p><p id=\"s-g1.7\">二</p>",
            "</section></article>",
        );
        let parsed = parse_translate_page(&page, None, output);
        assert_eq!(parsed.translations["s-g1.0"], "一");
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::NodeDropped)
        );
    }

    #[test]
    fn control_characters_are_stripped_before_parsing() {
        let page = sample_page();
        let output = answer(&[("s-g1.0", "一\u{202E}二"), ("s-g1.7", "三")]);
        let parsed = parse_translate_page(&page, None, &output);
        assert_eq!(parsed.translations["s-g1.0"], "一二");
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ControlStripped)
        );
    }

    #[test]
    fn oversized_output_is_rejected() {
        let page = sample_page();
        let rendered = render_translate_page(&page);
        let bloat =
            "啊".repeat(super::super::common::max_output_chars(rendered.chars().count()) + 1);
        let parsed = parse_translate_page(&page, Some(&rendered), &bloat);
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentOversize));
        assert!(parsed.page_rejected);

        // 不传 input 就没有护栏基准，同一份输出必须放行到正常解析流程。
        let unguarded = parse_translate_page(&page, None, &bloat);
        assert!(
            !unguarded
                .diagnostics
                .has_code(ProblemCode::DocumentOversize)
        );
    }

    // --- property 测试：固定种子 LCG，禁止未播种随机 ---

    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0 >> 33
        }

        fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
            items[(self.next() as usize) % items.len()]
        }
    }

    #[test]
    fn property_round_trip_is_identity_for_random_pages() {
        const FRAGMENTS: &[&str] = &[
            "hello world",
            "你好，世界",
            "mixed 中英 text",
            "a <b> & \"c\"",
            "",
            "emoji 👍🏽 test",
            "很长很长的一句话，用来验证渲染与解析在长文本下仍然逐字一致，不会被空白折叠吃掉内容。",
        ];
        const TRANSLATIONS: &[&str] = &[
            "译文一",
            "translation two",
            "混合 translation 三",
            "带 <标签> 与 & 符号",
        ];
        let mut rng = Lcg(0x5eed_1234);
        for _ in 0..200 {
            let section_count = 1 + (rng.next() as usize) % 3;
            let mut sections = Vec::new();
            let mut index = 0usize;
            for s in 0..section_count {
                let sentence_count = 1 + (rng.next() as usize) % 4;
                let mut sentences = Vec::new();
                for _ in 0..sentence_count {
                    let mut sentence =
                        TranslateSentence::new(format!("s-g{index}"), rng.pick(FRAGMENTS));
                    sentence.editable = true;
                    sentences.push(sentence);
                    index += 1;
                }
                sections.push(TranslateSection {
                    id: format!("p-g{s}"),
                    speaker: None,
                    sentences,
                });
            }
            let page = TranslatePage {
                source_lang: "en".to_owned(),
                target_lang: "zh".to_owned(),
                project_fingerprint: "fp".to_owned(),
                context_before: None,
                context_after: None,
                sections,
            };
            let expected: Vec<(String, String)> = page
                .sentence_ids()
                .into_iter()
                .map(|id| (id.to_owned(), rng.pick(TRANSLATIONS).to_owned()))
                .collect();
            let mut output = String::from("<article>\n");
            for section in &page.sections {
                output.push_str(&format!("<section id=\"{}\">\n", section.id));
                for sentence in &section.sentences {
                    let text = &expected
                        .iter()
                        .find(|(id, _)| id == &sentence.id)
                        .unwrap()
                        .1;
                    output.push_str(&format!(
                        "<p id=\"{}\">{}</p>\n",
                        sentence.id,
                        escape_text(text)
                    ));
                }
                output.push_str("</section>\n");
            }
            output.push_str("</article>\n");
            let parsed = parse_translate_page(&page, None, &output);
            assert!(
                !parsed.diagnostics.has_problems(),
                "{:?}",
                parsed.diagnostics
            );
            for (id, text) in expected {
                assert_eq!(parsed.translations[&id], text);
            }
        }
    }

    #[test]
    fn property_parse_never_panics_on_hostile_input() {
        const CHARS: &[char] = &[
            '<', '>', '&', '"', '\'', '/', '=', 'p', 'i', 'd', 's', '-', 'g', '1', '.', '0', '\n',
            '\t', '\u{0000}', '\u{202E}', '你', '👍', '`', '{', '}',
        ];
        let page = sample_page();
        let mut rng = Lcg(0xdead_beef);
        for _ in 0..500 {
            let len = (rng.next() as usize) % 120;
            let text: String = (0..len)
                .map(|_| CHARS[(rng.next() as usize) % CHARS.len()])
                .collect();
            let parsed = parse_translate_page(&page, None, &text);
            let _ = parsed.translations.len();
        }
    }

    #[test]
    fn property_escaping_round_trips() {
        const CHARS: &[char] = &['<', '>', '&', '"', '\'', 'a', '你', ' ', '👍'];
        let mut rng = Lcg(0x1234_5678);
        for _ in 0..300 {
            let len = 1 + (rng.next() as usize) % 30;
            let text: String = (0..len)
                .map(|_| CHARS[(rng.next() as usize) % CHARS.len()])
                .collect();
            // 契约：转义在「HTML 空白归一化之后」的文本上逐字往返。
            // `Element::text()` 会折叠 CJK 之间的空格（与 `sanitize_corrected` 同口径），
            // 所以基准文本先过一遍同样的归一化，保证幂等。
            let text = super::super::html::normalize_html_text(&sanitize_inline_text(&text));
            if text.is_empty() {
                continue;
            }
            let html = format!("<p id=\"s-x\">{}</p>", escape_text(&text));
            let tree = parse_html(&html);
            let (index, _) = index_by_id(&tree);
            assert_eq!(index["s-x"].text(), text);
        }
    }

    #[test]
    fn parse_source_recovers_validation_shape() {
        // 渲染文本必须自带校验所需的全部机读信息：`task submit` 在独立进程里
        // 只有输入文件和答案，没有渲染侧结构。
        let mut page = sample_page();
        page.sections[0].sentences[0].required_targets =
            vec!["A&<B> \"C\"".to_owned(), "/compact".to_owned()];
        page.sections[0].sentences[0].source_id = Some("src-1".to_owned());
        page.sections[0].sentences[0].sentence_id = Some("42".to_owned());
        page.sections[0].sentences[1] =
            TranslateSentence::frozen("s-g1.7", "We did it without ads.", "没投 <一分> & 广告。");
        let rendered = render_translate_page(&page);

        let recovered = parse_translate_source(&rendered).expect("translate carrier");
        assert_eq!(recovered.source_lang, "en");
        assert_eq!(recovered.target_lang, "zh");
        assert_eq!(recovered.project_fingerprint, "1024:g1.0:g88.4:ab12cd");
        assert_eq!(recovered.sections.len(), 1);
        assert_eq!(recovered.sections[0].id, "p-g1.0");
        assert_eq!(recovered.sections[0].speaker.as_deref(), Some("S1"));
        assert_eq!(recovered.sentence_ids(), page.sentence_ids());

        let first = recovered.sentence("s-g1.0").unwrap();
        assert!(first.editable);
        assert_eq!(
            first.required_targets,
            page.sections[0].sentences[0].required_targets
        );
        assert_eq!(first.source_id.as_deref(), Some("src-1"));
        assert_eq!(first.sentence_id.as_deref(), Some("42"));
        let second = recovered.sentence("s-g1.7").unwrap();
        assert!(!second.editable);
        assert_eq!(
            second.existing_translation.as_deref(),
            Some("没投 <一分> & 广告。")
        );
    }

    #[test]
    fn parse_source_is_validation_equivalent() {
        let mut page = sample_page();
        page.sections[0].sentences[0].required_targets = vec!["BaoCut".to_owned()];
        page.sections[0].sentences[1] =
            TranslateSentence::frozen("s-g1.7", "We did it without ads.", "没投一分广告。");
        page.sections.push(TranslateSection {
            id: "p-g2.0".to_owned(),
            speaker: None,
            sentences: vec![TranslateSentence::new("s-g2.0", "Third.")],
        });
        let rendered = render_translate_page(&page);
        let recovered = parse_translate_source(&rendered).expect("translate carrier");

        let outputs = [
            // 全部合格
            "<article><section id=\"p-g1.0\"><p id=\"s-g1.0\">BaoCut 八倍</p><p id=\"s-g1.7\">没投一分广告。</p></section><section id=\"p-g2.0\"><p id=\"s-g2.0\">三</p></section></article>".to_owned(),
            // 术语缺失 + 空译
            "<article><section id=\"p-g1.0\"><p id=\"s-g1.0\">宝卡特八倍</p><p id=\"s-g1.7\">没投一分广告。</p></section><section id=\"p-g2.0\"><p id=\"s-g2.0\"> </p></section></article>".to_owned(),
            // 冻结句被改
            "<article><section id=\"p-g1.0\"><p id=\"s-g1.0\">BaoCut 八倍</p><p id=\"s-g1.7\">改了</p></section><section id=\"p-g2.0\"><p id=\"s-g2.0\">三</p></section></article>".to_owned(),
            // 冻结句被挪段
            "<article><section id=\"p-g1.0\"><p id=\"s-g1.0\">BaoCut 八倍</p></section><section id=\"p-g2.0\"><p id=\"s-g1.7\">没投一分广告。</p><p id=\"s-g2.0\">三</p></section></article>".to_owned(),
            // 尾部截断
            "<article><section id=\"p-g1.0\"><p id=\"s-g1.0\">BaoCut 八倍</p></section></article>".to_owned(),
            // 垃圾
            "好的，这是翻译".to_owned(),
        ];
        for output in &outputs {
            let from_page = parse_translate_page(&page, Some(&rendered), output);
            let from_source = parse_translate_page(&recovered, Some(&rendered), output);
            assert_eq!(from_page, from_source, "output: {output}");
        }
    }

    #[test]
    fn parse_source_rejects_foreign_document() {
        assert!(parse_translate_source("<article><p id=\"s-g1.0\">x</p></article>").is_none());
        assert!(parse_translate_source("").is_none());
    }

    // ---- 行分区（`--align-fusion rows`） -----------------------------------

    fn chunk(text: &str, ordinals: &[usize]) -> AlignChunk {
        AlignChunk {
            text: text.to_owned(),
            ordinals: ordinals.to_vec(),
        }
    }

    /// 合格行分区：每块序号连续递增、块间首尾相接、恰好覆盖 `0..N`。
    #[test]
    fn row_partition_accepts_contiguous_full_coverage() {
        let chunks = vec![chunk("九十天", &[0, 1]), chunk("增长八倍。", &[2, 3, 4, 5])];
        assert!(is_row_partition(&chunks, 6));
        // 单行覆盖整句（语序对不上时的合法退化形态）。
        assert!(is_row_partition(
            &[chunk("九十天增长八倍。", &[0, 1, 2, 3, 4, 5])],
            6
        ));
    }

    /// 反例逐条：区间有缺口 / 区间不递增 / 覆盖不到 N / 起点不是 1 /
    /// 空序号 / 空文本。这些草稿在 rows 模式下一律不进直通路径。
    #[test]
    fn row_partition_rejects_gaps_reordering_and_short_coverage() {
        // 拼接可以恰好等于译文，但序号 3 谁也没覆盖——缺口。
        assert!(!is_row_partition(
            &[chunk("九十天", &[0, 1, 2]), chunk("增长八倍。", &[4, 5])],
            6
        ));
        // 块内序号不递增。
        assert!(!is_row_partition(
            &[chunk("九十天", &[1, 0]), chunk("增长八倍。", &[2, 3, 4, 5])],
            6
        ));
        // 块间逆序（第二块回头）。
        assert!(!is_row_partition(
            &[chunk("九十天", &[3, 4, 5]), chunk("增长八倍。", &[0, 1, 2])],
            6
        ));
        // 覆盖不到 N。
        assert!(!is_row_partition(
            &[chunk("九十天", &[0, 1]), chunk("增长八倍。", &[2, 3])],
            6
        ));
        // 首块不从 0 起。
        assert!(!is_row_partition(
            &[chunk("九十天增长八倍。", &[1, 2, 3, 4, 5])],
            6
        ));
        // 空序号块 / 空文本块 / 空表。
        assert!(!is_row_partition(
            &[chunk("九十天", &[0, 1]), chunk("增长八倍。", &[])],
            2
        ));
        assert!(!is_row_partition(
            &[chunk("  ", &[0, 1]), chunk("增长八倍。", &[2, 3, 4, 5])],
            6
        ));
        assert!(!is_row_partition(&[], 6));
    }

    /// 行 = 一个组或若干相邻组的并；在组内部切开就不算落在组边界上
    /// （只影响计数，不影响接受）。
    #[test]
    fn rows_on_group_boundaries_only_accepts_unions_of_whole_groups() {
        let groups = vec![
            FusionGroup {
                from: 0,
                to: 3,
                t0_ds: 0,
                t1_ds: 14,
            },
            FusionGroup {
                from: 4,
                to: 8,
                t0_ds: 14,
                t1_ds: 32,
            },
            FusionGroup {
                from: 9,
                to: 11,
                t0_ds: 32,
                t1_ds: 41,
            },
        ];
        // 前两组合成一行，第三组独立成行。
        let joined = vec![
            chunk("甲", &(0..=8).collect::<Vec<_>>()),
            chunk("乙", &(9..=11).collect::<Vec<_>>()),
        ];
        assert!(rows_on_group_boundaries(&joined, &groups));
        // 在第二组内部切开。
        let split_inside = vec![
            chunk("甲", &(0..=5).collect::<Vec<_>>()),
            chunk("乙", &(6..=11).collect::<Vec<_>>()),
        ];
        assert!(!rows_on_group_boundaries(&split_inside, &groups));
        // 没有分组提示时这条约束不存在。
        assert!(rows_on_group_boundaries(&split_inside, &[]));
    }

    /// `data-align-groups` 的渲染/解析同源；不可解析的值退回空表（分组只是
    /// 提示，绝不因此影响译文）。
    #[test]
    fn align_groups_round_trip_through_the_carrier() {
        let groups = vec![
            FusionGroup {
                from: 0,
                to: 3,
                t0_ds: 0,
                t1_ds: 14,
            },
            FusionGroup {
                from: 4,
                to: 8,
                t0_ds: 14,
                t1_ds: 32,
            },
            FusionGroup {
                from: 9,
                to: 11,
                t0_ds: 32,
                t1_ds: 41,
            },
        ];
        let rendered = render_align_groups(&groups);
        assert_eq!(rendered, "1-4@0.0-1.4;5-9@1.4-3.2;10-12@3.2-4.1");
        assert_eq!(parse_align_groups(&rendered), groups);
        assert!(parse_align_groups("1-4;5-9").is_empty());
        assert!(parse_align_groups("0-4@0.0-1.4").is_empty());
        assert!(parse_align_groups("1-4@0-1.4").is_empty());
        assert!(parse_align_groups("").is_empty());
    }

    fn rows_page() -> TranslatePage {
        let mut page = sample_page();
        page.sections[0].sentences[0].alignment = Some(TranslateAlignmentInput {
            source_words: ["Ninety", "days,", "eight", "times", "the", "growth."]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            needs_split: true,
            groups: vec![
                FusionGroup {
                    from: 0,
                    to: 1,
                    t0_ds: 0,
                    t1_ds: 8,
                },
                FusionGroup {
                    from: 2,
                    to: 5,
                    t0_ds: 8,
                    t1_ds: 24,
                },
            ],
            source_glue: Vec::new(),
        });
        page
    }

    /// rows 模式载体：`data-align-groups` 渲染并反解；合格行分区被标成
    /// `rows` 且落在组边界上。
    #[test]
    fn rows_carrier_round_trips_groups_and_extracts_a_row_partition() {
        let page = rows_page();
        let rendered = render_translate_page(&page);
        assert!(
            rendered.contains("data-align-groups=\"1-2@0.0-0.8;3-6@0.8-2.4\""),
            "{rendered}"
        );
        let recovered = parse_translate_source(&rendered).expect("translate carrier");
        assert_eq!(
            recovered.sections[0].sentences[0].alignment,
            page.sections[0].sentences[0].alignment
        );

        let output = concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\">",
            "<span data-src=\"1-2\">九十天，</span><span data-src=\"3-6\">增长八倍。</span></p>",
            "<p id=\"s-g1.7\">没投一分广告。</p>",
            "</section></article>",
        );
        let parsed = parse_translate_page(&page, Some(&rendered), output);
        assert!(parsed.retry_ids.is_empty(), "{:?}", parsed.diagnostics);
        assert_eq!(parsed.translations["s-g1.0"], "九十天，增长八倍。");
        let draft = &parsed.alignments["s-g1.0"];
        assert!(draft.rows);
        assert!(draft.on_groups);
        assert_eq!(draft.chunks.len(), 2);
    }

    /// 行边界切在组内部：仍是合格行分区（照常接受），只是 `on_groups` 为假。
    #[test]
    fn rows_off_group_boundaries_are_still_accepted_as_rows() {
        let page = rows_page();
        let rendered = render_translate_page(&page);
        let output = concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\">",
            "<span data-src=\"1-3\">九十天，</span><span data-src=\"4-6\">增长八倍。</span></p>",
            "</section></article>",
        );
        let draft = &parse_translate_page(&page, Some(&rendered), output).alignments["s-g1.0"];
        assert!(draft.rows);
        assert!(!draft.on_groups);
    }

    /// 常规 fusion（载体不带 `data-align-groups`）的草稿即使形状上恰好是行
    /// 分区，也不标 `rows`——它的契约要的是最小语义块，按行落库会切出碎行。
    #[test]
    fn row_shaped_draft_without_groups_is_not_marked_as_rows() {
        let mut page = sample_page();
        page.sections[0].sentences[0].alignment = Some(TranslateAlignmentInput {
            source_words: ["Ninety", "days,", "eight", "times", "the", "growth."]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            needs_split: true,
            groups: Vec::new(),
            source_glue: Vec::new(),
        });
        let rendered = render_translate_page(&page);
        assert!(!rendered.contains("data-align-groups"), "{rendered}");
        let output = concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\">",
            "<span data-src=\"1-2\">九十天，</span><span data-src=\"3-6\">增长八倍。</span></p>",
            "</section></article>",
        );
        let draft = &parse_translate_page(&page, Some(&rendered), output).alignments["s-g1.0"];
        assert!(!draft.rows);
        assert!(!draft.on_groups);
    }

    /// 只读属性可省：答案里每个 `<p>` 只留 `id`（连 `data-align-*` 一起丢掉）
    /// 时，译文与**行分区**草稿照常提取，零 problem。这是 rows 模式压缩输出的
    /// 关键——校验用的是输入页，答案里回显那些属性纯属白付 token。
    #[test]
    fn an_answer_that_keeps_only_ids_still_yields_translations_and_row_drafts() {
        let page = rows_page();
        let rendered = render_translate_page(&page);
        // 输入页当然带着全套只读属性。
        assert!(rendered.contains("data-align-words="), "{rendered}");
        assert!(rendered.contains("data-align-groups="), "{rendered}");

        let output = concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\">",
            "<span data-src=\"1-2\">九十天，</span><span data-src=\"3-6\">增长八倍。</span></p>",
            "<p id=\"s-g1.7\">没投一分广告。</p>",
            "</section></article>",
        );
        assert!(!output.contains("data-align-words"), "答案不回显只读属性");
        let parsed = parse_translate_page(&page, Some(&rendered), output);
        assert!(!parsed.page_rejected);
        assert!(parsed.retry_ids.is_empty(), "{:?}", parsed.diagnostics);
        assert!(
            parsed.diagnostics.problems.is_empty(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.translations["s-g1.0"], "九十天，增长八倍。");
        assert_eq!(parsed.translations["s-g1.7"], "没投一分广告。");
        let draft = &parsed.alignments["s-g1.0"];
        assert!(draft.rows && draft.on_groups);
    }

    /// 同一件事在 `on` 模式（块草稿）与冻结句/术语句上的镜像：`data-editable`、
    /// `data-translation`、`data-rt` 全部只从**输入页**读，答案丢光也不改判定。
    #[test]
    fn readonly_attributes_are_read_from_the_input_page_not_the_answer() {
        let mut page = sample_page();
        page.sections[0].sentences[0].alignment = Some(TranslateAlignmentInput {
            source_words: ["Ninety", "days,", "eight", "times", "the", "growth."]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            needs_split: true,
            groups: Vec::new(),
            source_glue: Vec::new(),
        });
        page.sections[0].sentences[0].required_targets = vec!["ARR".to_owned()];
        page.sections[0].sentences[1] =
            TranslateSentence::frozen("s-g1.7", "We did it without ads.", "没投一分广告。");
        let rendered = render_translate_page(&page);

        // 答案：全部属性省略，冻结句原样回显其既有译文文本。
        let output = concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\"><span data-src=\"1-2\">九十天，</span>",
            "<span data-src=\"3 4 6\">ARR 增长八倍。</span></p>",
            "<p id=\"s-g1.7\">没投一分广告。</p>",
            "</section></article>",
        );
        let parsed = parse_translate_page(&page, Some(&rendered), output);
        assert!(parsed.retry_ids.is_empty(), "{:?}", parsed.diagnostics);
        assert!(
            parsed.diagnostics.problems.is_empty(),
            "{:?}",
            parsed.diagnostics
        );
        // 冻结句仍不进 translations（判据来自输入页的 editable=false）。
        assert!(!parsed.translations.contains_key("s-g1.7"));
        // 术语校验也用输入页的 data-rt：答案没回显，依然生效。
        assert_eq!(parsed.translations["s-g1.0"], "九十天，ARR 增长八倍。");
        assert_eq!(parsed.alignments["s-g1.0"].chunks.len(), 2);
    }

    /// 载荷末尾的融合提醒：有融合句才加，rows / on 文案不同，且不影响反解。
    #[test]
    fn the_payload_carries_a_trailing_fusion_reminder_that_parsing_ignores() {
        let plain = render_translate_page(&sample_page());
        assert!(!plain.contains("Reminder:"), "{plain}");

        let rows = render_translate_page(&rows_page());
        assert!(
            rows.contains("must come back cut into <span data-src="),
            "{rows}"
        );
        assert!(rows.trim_end().ends_with("display rows."), "{rows}");
        // 提醒是 `</article>` 之后的根级文本，反解一律忽略。
        let recovered = parse_translate_source(&rows).expect("translate carrier");
        assert_eq!(recovered.sentence_ids(), vec!["s-g1.0", "s-g1.7"]);
        assert_eq!(
            recovered.sections[0].sentences[0].alignment,
            rows_page().sections[0].sentences[0].alignment
        );

        let mut chunk_page = rows_page();
        chunk_page.sections[0].sentences[0]
            .alignment
            .as_mut()
            .unwrap()
            .groups
            .clear();
        let chunks = render_translate_page(&chunk_page);
        assert!(chunks.contains("chunk annotation"), "{chunks}");
    }

    /// 行分区不合格（区间有缺口）时草稿仍按普通块草稿保留，译文照常入库。
    #[test]
    fn row_partition_failure_keeps_the_translation_and_the_plain_draft() {
        let page = rows_page();
        let rendered = render_translate_page(&page);
        let output = concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\">",
            "<span data-src=\"1-2\">九十天，</span><span data-src=\"4-6\">增长八倍。</span></p>",
            "<p id=\"s-g1.7\">没投一分广告。</p>",
            "</section></article>",
        );
        let parsed = parse_translate_page(&page, Some(&rendered), output);
        assert_eq!(parsed.translations["s-g1.0"], "九十天，增长八倍。");
        assert!(parsed.retry_ids.is_empty(), "{:?}", parsed.diagnostics);
        let draft = &parsed.alignments["s-g1.0"];
        assert!(!draft.rows);
    }
}
