//! align 缺省载体 `align-edges/1` 与单调化改写窄任务 `align-rewrite/1` 的
//! HTML 表格编解码器（对齐块设计 §6.1 / §6.3）。
//!
//! 与 [`super::align_table`] 的两列切分表不同，这里模型**不切源、不切译、不
//! 解决交叉**：它只把译文划成尽量小的语义块，并列出每块对应的源词序号
//! （可乱序、可不连续、可为空）。块合并、安全边界、双语 DP 与时间分配全部是
//! [`crate::align_block`] 的确定性代码。
//!
//! 载荷形态（标签名不进协议，定位一律走 `data-*` / `class`）：
//!
//! ```html
//! <table data-lang="zh" data-fit="16" data-soft="14" data-hard="20" data-bcut-format="align-edges/1">
//!   <tbody data-sid="s-g1.0">
//!     <tr><th scope="rowgroup">s-g1.0</th>
//!         <td class="src">[1]I [2]didn't [3]go [4]because [5]I [6]was [7]sick.</td>
//!         <td class="tgt">因为我病了，所以没去。</td></tr>
//!   </tbody>
//! </table>
//! ```
//!
//! 模型只能改写 `td.tgt` 的内容，把它变成一串
//! `<span data-src="4-7">因为我病了，</span><span data-src="1 2 3">所以没去。</span>`：
//! `data-src` 是空白/逗号分隔的 1-based 序号与区间列表，可为空（省译/功能块）；
//! 每个序号在一句内至多归属一块；span 文本按 [`normalize_chars`] 口径拼接后必须
//! 等于译文（与切分表的拼接不变式同一容忍度）。`align-rewrite/1` 用同一张表，
//! 但 `td.tgt` 允许被**改写**（单调化），并同时带 span 标注；改写幅度受
//! [`reordered_rewrite_exceeds`] 护栏、硬锚点（数字/URL/原样 Latin）不得丢失。
//!
//! 本模块是这两个 kind 的**唯一字符串级校验**：引擎与 agent 提交期 lint 都调
//! [`parse_align_edges`]。零 I/O、零时钟、零随机。

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

use crate::align_block::{AlignCtx, AlignEdge, AnchorAligner, WordAligner};
use crate::atomize::normalize_chars;
use crate::split::{TransParams, reordered_rewrite_exceeds, target_cps_chars};

use super::common::{
    ALIGN_EDGES_FORMAT, ALIGN_REWRITE_FORMAT, Diagnostics, Problem, ProblemCode, Warning,
    WarningCode, guard_output_size, normalize_llm_output, sanitize_inline_text,
};
use super::html::{Element, Node, escape_attr, escape_text, parse_html, parse_html_in_table};

/// LLM 块对齐边的软边权重（对齐块设计 §4.2：块级归属，未被锚点佐证）。
pub const CHUNK_EDGE_WEIGHT: f32 = 0.75;

/// 一句在表里的渲染输入。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlignEdgesSentenceInput {
    /// 句 id（`data-sid`，逐字节精确匹配）。
    pub id: String,
    /// 句内锚定词，顺序即序号（一词一序号；CJK 源按 `words[]` 原子计）。
    pub source_words: Vec<String>,
    /// `align-edges/1`：自然译句真相；`align-rewrite/1`：改写基准（自然译句）。
    pub translation: String,
    /// `align-rewrite/1` 的超限块提示（`data-over-hard`），只带相对预算，
    /// 如 `chunk 1 (words 1-9): 27 units > hard 20`；edges 模式恒为 `None`。
    pub over_hard: Option<String>,
}

impl AlignEdgesSentenceInput {
    /// 构造一句渲染输入（edges 模式）。
    pub fn new(
        id: impl Into<String>,
        source_words: Vec<String>,
        translation: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            source_words,
            translation: translation.into(),
            over_hard: None,
        }
    }
}

/// 一整张表的渲染输入，同时是解析时的对账基准。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlignEdgesInput {
    /// 目标语言标签（`data-lang`）。
    pub lang: String,
    /// 目标语三阈值（`data-fit` / `data-soft` / `data-hard`）。
    pub params: TransParams,
    /// `true` ⇒ `align-rewrite/1`（允许改写 tgt），否则 `align-edges/1`。
    pub rewrite: bool,
    pub sentences: Vec<AlignEdgesSentenceInput>,
}

impl AlignEdgesInput {
    /// 构造一张 edges 表输入（参数取目标语规范缺省）。
    pub fn new(lang: impl Into<String>, sentences: Vec<AlignEdgesSentenceInput>) -> Self {
        let lang = lang.into();
        let params = TransParams::for_lang(&lang);
        Self {
            lang,
            params,
            rewrite: false,
            sentences,
        }
    }

    fn format(&self) -> &'static str {
        if self.rewrite {
            ALIGN_REWRITE_FORMAT
        } else {
            ALIGN_EDGES_FORMAT
        }
    }
}

/// 模型标注的一个译文语义块：文本 + 归属的源词序号（**0-based**）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AlignChunk {
    pub text: String,
    pub ordinals: Vec<usize>,
}

/// 一句解析出来的分组。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AlignEdgesGroup {
    pub id: String,
    /// 按出现顺序的语义块；空 = tgt 未标注（引擎按"无对齐边"处理）。
    pub chunks: Vec<AlignChunk>,
    /// tgt 单元格的归一化全文（rewrite 模式即改写后的整句）。
    pub text: String,
}

/// 一次解析的结果。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AlignEdgesParsed {
    pub groups: Vec<AlignEdgesGroup>,
    pub diagnostics: Diagnostics,
}

impl AlignEdgesParsed {
    /// 按 id 取分组。
    pub fn group(&self, id: &str) -> Option<&AlignEdgesGroup> {
        self.groups.iter().find(|group| group.id == id)
    }
}

// ---------------------------------------------------------------------------
// 序号词串
// ---------------------------------------------------------------------------

/// `[1]I [2]didn't [3]go` —— 每个锚定词前缀 1-based 序号。词文本先过
/// [`sanitize_inline_text`]；渲染方负责 HTML 转义。
pub fn render_ordinal_words(words: &[String]) -> String {
    words
        .iter()
        .enumerate()
        .map(|(index, word)| format!("[{}]{}", index + 1, sanitize_inline_text(word)))
        .collect::<Vec<_>>()
        .join(" ")
}

/// [`render_ordinal_words`] 的逆：按 `[N]` 标记切回词表（词内空白保留、首尾
/// 修剪）。不是序号词串时返回空表。
pub fn parse_ordinal_words(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    // 每个标记的 (起点, 词起点)。
    let mut markers: Vec<(usize, usize)> = Vec::new();
    let mut index = 0usize;
    while index < chars.len() {
        if chars[index] == '[' && (index == 0 || chars[index - 1].is_whitespace()) {
            let mut end = index + 1;
            while end < chars.len() && chars[end].is_ascii_digit() {
                end += 1;
            }
            if end > index + 1 && end < chars.len() && chars[end] == ']' {
                markers.push((index, end + 1));
                index = end + 1;
                continue;
            }
        }
        index += 1;
    }
    let mut words = Vec::with_capacity(markers.len());
    for (position, &(_, word_start)) in markers.iter().enumerate() {
        let word_end = markers
            .get(position + 1)
            .map(|&(start, _)| start)
            .unwrap_or(chars.len());
        let word: String = chars[word_start..word_end].iter().collect();
        words.push(word.trim().to_owned());
    }
    words
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

/// 渲染一张 edges / rewrite 表。输出确定性：属性顺序、缩进、行序固定。
pub fn render_align_edges(input: &AlignEdgesInput) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "<table data-lang=\"{}\" data-fit=\"{}\" data-soft=\"{}\" data-hard=\"{}\" data-bcut-format=\"{}\">\n",
        escape_attr(&sanitize_inline_text(&input.lang)),
        input.params.fit,
        input.params.soft,
        input.params.hard,
        escape_attr(input.format()),
    ));
    for sentence in &input.sentences {
        let over_hard = match sentence.over_hard.as_deref().filter(|_| input.rewrite) {
            Some(hint) => format!(
                " data-over-hard=\"{}\"",
                escape_attr(&sanitize_inline_text(hint))
            ),
            None => String::new(),
        };
        output.push_str(&format!(
            "  <tbody data-sid=\"{}\"{}>\n",
            escape_attr(&sanitize_inline_text(&sentence.id)),
            over_hard,
        ));
        output.push_str(&format!(
            "    <tr><th scope=\"rowgroup\">{}</th><td class=\"src\">{}</td><td class=\"tgt\">{}</td></tr>\n",
            cell_text(&sentence.id),
            escape_text(&render_ordinal_words(&sentence.source_words)),
            cell_text(&sentence.translation),
        ));
        output.push_str("  </tbody>\n");
    }
    output.push_str("</table>\n");
    output
}

fn cell_text(text: &str) -> String {
    escape_text(&sanitize_inline_text(text))
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/// 解析模型回来的表（引擎与提交期 lint 共用的唯一字符串级校验）。
///
/// `input` 是当初实际发出的渲染文本，只作体积护栏基准；`None` 跳过护栏。
///
/// 判据（逐句 Problem，互不阻断其它句）：
/// - `data-src` 序号不可解析 / 越界 / 跨块重复 ⇒ [`ProblemCode::AlignEdgeOrdinal`]；
/// - edges 模式 span 文本拼接（[`normalize_chars`] 口径）≠ 译文 ⇒
///   [`ProblemCode::AlignEdgeText`]；
/// - rewrite 模式改写为空 ⇒ [`ProblemCode::EmptyTranslation`]；幅度超
///   [`reordered_rewrite_exceeds`] 或丢失数字/URL/原样 Latin 硬锚 ⇒
///   [`ProblemCode::AlignContentDrift`]；
/// - tgt 单元格没有任何 span ⇒ 只记 [`WarningCode::ContentIgnored`]，分组按
///   `chunks: []` 返回（引擎回落无对齐边）。
///
/// 截断 vs 散点缺失、裸 `<tbody>` 恢复与 [`super::align_table`] 同口径。
pub fn parse_align_edges(
    input: &AlignEdgesInput,
    payload: Option<&str>,
    output: &str,
) -> AlignEdgesParsed {
    let mut diagnostics = Diagnostics::new();
    let normalized = normalize_llm_output(output);
    for warning in normalized.warnings() {
        diagnostics.push_warning(warning);
    }
    if let Some(problem) = payload.and_then(|payload| guard_output_size(payload, &normalized.text))
    {
        diagnostics.push_problem(problem);
        return AlignEdgesParsed {
            groups: Vec::new(),
            diagnostics,
        };
    }
    if has_residual_fence(&normalized.text) {
        diagnostics.push_problem(Problem::document(
            ProblemCode::DocumentWrapped,
            "输出仍残留代码块围栏或夹带解释，无法零成本剥离",
        ));
    }

    let mut tree = parse_html(&normalized.text);
    let mut elements = Vec::new();
    walk_groups(&tree.roots, &mut elements);
    if elements.is_empty() && normalized.text.contains("data-sid") {
        tree = parse_html_in_table(&normalized.text);
        elements = Vec::new();
        walk_groups(&tree.roots, &mut elements);
    }
    for warning in tree.warnings() {
        diagnostics.push_warning(warning);
    }

    let expected: BTreeMap<&str, &AlignEdgesSentenceInput> = input
        .sentences
        .iter()
        .map(|sentence| (sentence.id.as_str(), sentence))
        .collect();
    let mut groups = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut duplicated: BTreeSet<String> = BTreeSet::new();
    for element in elements {
        let sid = element
            .attr("data-sid")
            .map(str::trim)
            .unwrap_or_default()
            .to_owned();
        if sid.is_empty() {
            diagnostics.push_warning(Warning::document(
                WarningCode::ContentIgnored,
                "忽略 data-sid 为空的分组",
            ));
            continue;
        }
        if seen.contains(&sid) {
            if duplicated.insert(sid.clone()) {
                diagnostics.push_problem(Problem::sentence(
                    ProblemCode::DuplicateId,
                    sid.clone(),
                    "同一 id 出现多次，只采用首次出现的分组",
                ));
            }
            continue;
        }
        seen.insert(sid.clone());
        let Some(sentence) = expected.get(sid.as_str()).copied() else {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::UnknownId,
                sid.clone(),
                "协议外的 id，已忽略",
            ));
            continue;
        };
        groups.push(parse_group(element, sentence, input, &mut diagnostics));
    }
    report_missing(input, &seen, &mut diagnostics);
    AlignEdgesParsed {
        groups,
        diagnostics,
    }
}

/// 从**当初发出的载荷 HTML** 反解出 [`AlignEdgesInput`]（提交期 lint）。
///
/// 必须是 [`render_align_edges`] 的严格逆（`render → parse_input → render`
/// 逐字节相等由单测钉死）。不是 edges / rewrite 表时返回 `None`。
pub fn parse_align_edges_input(payload: &str) -> Option<AlignEdgesInput> {
    let tree = parse_html(payload);
    let table = tree.elements().into_iter().find(|element| {
        matches!(
            element.attr("data-bcut-format"),
            Some(ALIGN_EDGES_FORMAT) | Some(ALIGN_REWRITE_FORMAT)
        )
    })?;
    let rewrite = table.attr("data-bcut-format") == Some(ALIGN_REWRITE_FORMAT);
    let lang = table
        .attr("data-lang")
        .unwrap_or_default()
        .trim()
        .to_owned();
    let defaults = TransParams::for_lang(&lang);
    let params = TransParams {
        fit: attr_usize(table, "data-fit").unwrap_or(defaults.fit),
        soft: attr_usize(table, "data-soft").unwrap_or(defaults.soft),
        hard: attr_usize(table, "data-hard").unwrap_or(defaults.hard),
    };
    let mut elements = Vec::new();
    walk_groups(&tree.roots, &mut elements);
    let mut sentences = Vec::new();
    for element in elements {
        let Some(id) = element
            .attr("data-sid")
            .map(str::trim)
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        let (Some(src), Some(tgt)) = (find_cell(element, "src"), find_cell(element, "tgt")) else {
            continue;
        };
        sentences.push(AlignEdgesSentenceInput {
            id: id.to_owned(),
            source_words: parse_ordinal_words(&src.text()),
            translation: tgt.text(),
            over_hard: element
                .attr("data-over-hard")
                .filter(|_| rewrite)
                .map(str::to_owned),
        });
    }
    Some(AlignEdgesInput {
        lang,
        params,
        rewrite,
        sentences,
    })
}

fn attr_usize(element: &Element, name: &str) -> Option<usize> {
    element.attr(name)?.trim().parse().ok()
}

/// 递归收集带 `data-sid` 的分组；命中后不再下钻。
fn walk_groups<'a>(nodes: &'a [Node], out: &mut Vec<&'a Element>) {
    for node in nodes {
        let Node::Element(element) = node else {
            continue;
        };
        if element.attrs.contains_key("data-sid") {
            out.push(element);
            continue;
        }
        walk_groups(&element.children, out);
    }
}

/// 分组内第一个带指定 class 的后代单元格。
fn find_cell<'a>(group: &'a Element, class: &str) -> Option<&'a Element> {
    group
        .descendants()
        .into_iter()
        .find(|element| element.has_class(class))
}

/// 定位 tgt 单元格：优先 `class="tgt"`；否则取首行剔除 id 列后的最后一格。
fn locate_target_cell<'a>(group: &'a Element, sid: &str) -> Option<&'a Element> {
    if let Some(cell) = find_cell(group, "tgt") {
        return Some(cell);
    }
    for row in group.child_elements() {
        let cells: Vec<&Element> = row
            .child_elements()
            .into_iter()
            .filter(|cell| {
                !(cell.attrs.contains_key("scope")
                    || cell.attrs.contains_key("rowspan")
                    || cell.text().trim() == sid)
            })
            .collect();
        if cells.len() >= 2 {
            return cells.last().copied();
        }
    }
    None
}

/// 从一个容器元素的直接子节点里抽取语义块（`<span data-src>` 为块；容器
/// 直属文本或无 `data-src` 的子元素按空归属块计）。返回 `None` 表示容器里
/// 没有任何 `data-src` 标注。
///
/// translate 融合通道（`<p>` 内的 span）与本载体共用这一函数。
pub fn chunks_from_element(container: &Element) -> Option<Vec<(String, Option<String>)>> {
    let mut chunks: Vec<(String, Option<String>)> = Vec::new();
    let mut annotated = false;
    for node in &container.children {
        match node {
            Node::Text(text) => {
                let text = super::html::normalize_html_text(text);
                if !text.trim().is_empty() {
                    chunks.push((text, None));
                }
            }
            Node::Element(element) => {
                let text = element.text();
                match element.attr("data-src") {
                    Some(raw) => {
                        annotated = true;
                        chunks.push((text, Some(raw.to_owned())));
                    }
                    None => {
                        if !text.trim().is_empty() {
                            chunks.push((text, None));
                        }
                    }
                }
            }
        }
    }
    annotated.then_some(chunks)
}

/// 解析 `data-src`：空白/逗号分隔的 1-based 序号或 `a-b` 区间 ⇒ 0-based 序号
/// 列表（保持出现顺序，去重）。
pub fn parse_ordinals(raw: &str, word_count: usize) -> Result<Vec<usize>, String> {
    let mut ordinals: Vec<usize> = Vec::new();
    for token in raw
        .split(|ch: char| ch.is_whitespace() || ch == ',' || ch == '，' || ch == ';')
        .filter(|token| !token.is_empty())
    {
        let (low, high) = match token.split_once(['-', '–', '—']) {
            Some((low, high)) => (parse_ordinal(low)?, parse_ordinal(high)?),
            None => {
                let value = parse_ordinal(token)?;
                (value, value)
            }
        };
        if low > high {
            return Err(format!("区间 `{token}` 起点大于终点"));
        }
        if high > word_count {
            return Err(format!("序号 `{token}` 超出源词数 {word_count}"));
        }
        for value in low..=high {
            if !ordinals.contains(&(value - 1)) {
                ordinals.push(value - 1);
            }
        }
    }
    Ok(ordinals)
}

fn parse_ordinal(token: &str) -> Result<usize, String> {
    let value: usize = token
        .trim()
        .parse()
        .map_err(|_| format!("序号 `{token}` 不可解析"))?;
    if value == 0 {
        return Err("序号从 1 起".to_owned());
    }
    Ok(value)
}

/// 语义块 → 对齐边：按 [`normalize_chars`] 口径在 `target` 上顺序定位每块
/// （空白/标点/大小写容忍），每个归属序号产出一条软边（权重
/// [`CHUNK_EDGE_WEIGHT`]），目标区间为该块首尾有效字符的字符下标半开区间。
/// 任一块定位失败 ⇒ 返回空（无证据优于错证据）。
pub fn chunks_to_edges(chunks: &[AlignChunk], target: &str) -> Vec<AlignEdge> {
    let Some(ranges) = chunk_char_ranges(chunks, target) else {
        return Vec::new();
    };
    let mut edges = Vec::new();
    for (chunk, range) in chunks.iter().zip(ranges) {
        for &ordinal in &chunk.ordinals {
            edges.push(AlignEdge::soft(ordinal, range.clone(), CHUNK_EDGE_WEIGHT));
        }
    }
    edges
}

/// Compress block membership to extrema without filling the source hull. For
/// identical target ranges and weights this preserves every crossing decision.
/// It does not preserve word coverage statistics. Kept separate for M0 A/B tests.
pub fn chunks_to_endpoint_edges(chunks: &[AlignChunk], target: &str) -> Vec<AlignEdge> {
    let Some(ranges) = chunk_char_ranges(chunks, target) else {
        return Vec::new();
    };
    let mut edges = Vec::new();
    for (chunk, range) in chunks.iter().zip(ranges) {
        if let (Some(&lo), Some(&hi)) = (chunk.ordinals.iter().min(), chunk.ordinals.iter().max()) {
            edges.push(AlignEdge::soft(lo, range.clone(), CHUNK_EDGE_WEIGHT));
            if hi != lo {
                edges.push(AlignEdge::soft(hi, range, CHUNK_EDGE_WEIGHT));
            }
        }
    }
    edges
}

/// 每个语义块在 `target` 上的字符区间（与 [`chunks_to_edges`] 完全同一口径的
/// 顺序定位）。任一块定位失败 ⇒ `None`。行分区模式需要块本身的目标坐标来判
/// 定"行边界是否落在块边界上"，因此把定位单独暴露出来。
pub fn chunk_char_ranges(chunks: &[AlignChunk], target: &str) -> Option<Vec<Range<usize>>> {
    let target_chars: Vec<char> = target.chars().collect();
    let mut cursor = 0usize;
    let mut ranges = Vec::with_capacity(chunks.len());
    for chunk in chunks {
        ranges.push(locate_chunk(&target_chars, &mut cursor, &chunk.text)?);
    }
    Some(ranges)
}

/// 从 `cursor` 起在 `target` 里匹配块的有效字符序列；成功则推进 `cursor`。
/// 块无有效字符（纯标点）时返回空区间而不推进。
fn locate_chunk(target: &[char], cursor: &mut usize, text: &str) -> Option<Range<usize>> {
    let want: Vec<char> = normalize_chars(text).chars().collect();
    if want.is_empty() {
        return Some(*cursor..*cursor);
    }
    let mut position = *cursor;
    let mut matched = 0usize;
    let mut first: Option<usize> = None;
    let mut last = 0usize;
    while position < target.len() && matched < want.len() {
        let ch = target[position];
        let mut significant = String::new();
        if !ch.is_whitespace() && !crate::atomize::is_punctuation_or_symbol(ch) {
            significant.extend(ch.to_lowercase());
        }
        if significant.is_empty() {
            position += 1;
            continue;
        }
        for low in significant.chars() {
            if matched < want.len() && want[matched] == low {
                matched += 1;
            } else {
                return None;
            }
        }
        first.get_or_insert(position);
        last = position;
        position += 1;
    }
    if matched < want.len() {
        return None;
    }
    *cursor = last + 1;
    Some(first.unwrap_or(*cursor)..last + 1)
}

/// 解析一句分组并跑句级验收。
fn parse_group(
    element: &Element,
    sentence: &AlignEdgesSentenceInput,
    input: &AlignEdgesInput,
    diagnostics: &mut Diagnostics,
) -> AlignEdgesGroup {
    let sid = sentence.id.as_str();
    let Some(cell) = locate_target_cell(element, sid) else {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::EmptyTranslation,
            sid,
            "分组内没有 tgt 单元格",
        ));
        return AlignEdgesGroup {
            id: sentence.id.clone(),
            chunks: Vec::new(),
            text: String::new(),
        };
    };
    let text = cell.text();
    let Some(raw_chunks) = chunks_from_element(cell) else {
        diagnostics.push_warning(Warning::sentence(
            WarningCode::ContentIgnored,
            sid,
            "tgt 单元格没有 <span data-src> 标注，按无对齐边处理",
        ));
        return AlignEdgesGroup {
            id: sentence.id.clone(),
            chunks: Vec::new(),
            text,
        };
    };
    let word_count = sentence.source_words.len();
    let mut chunks: Vec<AlignChunk> = Vec::with_capacity(raw_chunks.len());
    let mut used: BTreeSet<usize> = BTreeSet::new();
    let mut ordinal_errors: Vec<String> = Vec::new();
    for (index, (chunk_text, raw)) in raw_chunks.into_iter().enumerate() {
        if chunk_text.trim().is_empty() {
            diagnostics.push_warning(Warning::sentence(
                WarningCode::ContentIgnored,
                sid,
                format!("第 {} 块文本为空，已忽略", index + 1),
            ));
            continue;
        }
        let ordinals = match raw.as_deref() {
            None => Vec::new(),
            Some(raw) => match parse_ordinals(raw, word_count) {
                Ok(ordinals) => ordinals,
                Err(detail) => {
                    ordinal_errors
                        .push(format!("第 {} 块 data-src=\"{raw}\"：{detail}", index + 1));
                    Vec::new()
                }
            },
        };
        for &ordinal in &ordinals {
            if !used.insert(ordinal) {
                ordinal_errors.push(format!(
                    "第 {} 块重复引用源词 {}（每个序号至多归属一块）",
                    index + 1,
                    ordinal + 1
                ));
            }
        }
        chunks.push(AlignChunk {
            text: chunk_text,
            ordinals,
        });
    }
    if !ordinal_errors.is_empty() {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::AlignEdgeOrdinal,
            sid,
            ordinal_errors.join("；"),
        ));
    }
    let concat: String = chunks.iter().map(|chunk| chunk.text.as_str()).collect();
    if input.rewrite {
        check_rewrite(&concat, sentence, input, diagnostics);
    } else if normalize_chars(&concat) != normalize_chars(&sentence.translation) {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::AlignEdgeText,
            sid,
            "span 文本拼接与译文不一致：只能包裹译文，不能改写、增删或重排任何字符",
        ));
    }
    AlignEdgesGroup {
        id: sentence.id.clone(),
        chunks,
        text,
    }
}

/// rewrite 模式的字符串级验收：非空、幅度护栏、硬锚保留。
fn check_rewrite(
    rewritten: &str,
    sentence: &AlignEdgesSentenceInput,
    input: &AlignEdgesInput,
    diagnostics: &mut Diagnostics,
) {
    let sid = sentence.id.as_str();
    if rewritten.trim().is_empty() {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::EmptyTranslation,
            sid,
            "改写后的译文为空",
        ));
        return;
    }
    let lang = input.lang.as_str();
    let old_units = target_cps_chars(&sentence.translation, lang);
    let new_units = target_cps_chars(rewritten, lang);
    if reordered_rewrite_exceeds(old_units, new_units) {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::AlignContentDrift,
            sid,
            format!(
                "改写幅度过大（{old_units} → {new_units} 阅读单位）：只调小句顺序与必要的连接词/助词/标点，不得增删或压缩内容"
            ),
        ));
    }
    let dropped = dropped_hard_anchors(
        &sentence.source_words,
        &sentence.translation,
        rewritten,
        lang,
    );
    if !dropped.is_empty() {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::AlignContentDrift,
            sid,
            format!("改写丢失了数字/URL/原样 Latin 锚点：{}", dropped.join("、")),
        ));
    }
}

/// 自然译句里能被 [`AnchorAligner`] 唯一锚定、而改写后找不到的源词。
pub fn dropped_hard_anchors(
    source_words: &[String],
    translation: &str,
    rewritten: &str,
    lang: &str,
) -> Vec<String> {
    let refs: Vec<&str> = source_words.iter().map(String::as_str).collect();
    let ctx = AlignCtx {
        source_lang: String::new(),
        lang: lang.to_owned(),
        protected_terms: Vec::new(),
    };
    let before: BTreeSet<usize> = AnchorAligner
        .align(&refs, translation, &ctx)
        .into_iter()
        .filter(|edge| edge.hard)
        .map(|edge| edge.src)
        .collect();
    if before.is_empty() {
        return Vec::new();
    }
    let after: BTreeSet<usize> = AnchorAligner
        .align(&refs, rewritten, &ctx)
        .into_iter()
        .filter(|edge| edge.hard)
        .map(|edge| edge.src)
        .collect();
    before
        .difference(&after)
        .filter_map(|&index| source_words.get(index).cloned())
        .collect()
}

/// 缺失 id 判定：连续后缀整体缺失 ⇒ 截断；否则逐句 `missing-id`。
fn report_missing(input: &AlignEdgesInput, seen: &BTreeSet<String>, diagnostics: &mut Diagnostics) {
    let missing: Vec<&str> = input
        .sentences
        .iter()
        .map(|sentence| sentence.id.as_str())
        .filter(|id| !seen.contains(*id))
        .collect();
    if missing.is_empty() {
        return;
    }
    let first_missing = input
        .sentences
        .iter()
        .position(|sentence| !seen.contains(&sentence.id))
        .unwrap_or(0);
    if input.sentences[first_missing..]
        .iter()
        .all(|sentence| !seen.contains(&sentence.id))
    {
        diagnostics.push_problem(Problem::document(
            ProblemCode::DocumentTruncated,
            format!(
                "自 {} 起共 {} 句整体缺失，疑似输出被截断",
                input.sentences[first_missing].id,
                missing.len()
            ),
        ));
        return;
    }
    for id in missing {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::MissingId,
            id,
            "期望的 id 未出现在输出中",
        ));
    }
}

fn has_residual_fence(text: &str) -> bool {
    text.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with("```") || trimmed.starts_with("~~~")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn en_words(text: &str) -> Vec<String> {
        text.split_whitespace().map(str::to_owned).collect()
    }

    fn causal_input() -> AlignEdgesInput {
        AlignEdgesInput::new(
            "zh",
            vec![
                AlignEdgesSentenceInput::new(
                    "s-g1.0",
                    en_words("I didn't go because I was sick."),
                    "因为我病了，所以没去。",
                ),
                AlignEdgesSentenceInput::new(
                    "s-g2.0",
                    en_words("We ship today."),
                    "我们今天发布。",
                ),
            ],
        )
    }

    /// 测试侧的「模型回答」渲染器：刻意与生产渲染器分开。
    fn answer(groups: &[(&str, &[(&str, &str)])]) -> String {
        let mut out = String::from("<table>\n");
        for (sid, spans) in groups {
            out.push_str(&format!("<tbody data-sid=\"{sid}\"><tr><th>{sid}</th><td class=\"src\">x</td><td class=\"tgt\">"));
            for (src, text) in *spans {
                out.push_str(&format!("<span data-src=\"{src}\">{text}</span>"));
            }
            out.push_str("</td></tr></tbody>\n");
        }
        out.push_str("</table>\n");
        out
    }

    #[test]
    fn render_carries_ordinal_words_and_parse_extracts_chunks_and_edges() {
        let input = causal_input();
        let rendered = render_align_edges(&input);
        assert!(
            rendered.contains("data-bcut-format=\"align-edges/1\""),
            "{rendered}"
        );
        assert!(
            rendered.contains("[1]I [2]didn't [3]go [4]because [5]I [6]was [7]sick."),
            "{rendered}"
        );
        let output = answer(&[
            (
                "s-g1.0",
                &[("4-7", "因为我病了，"), ("1 2 3", "所以没去。")],
            ),
            ("s-g2.0", &[("1", "我们"), ("3", "今天"), ("2", "发布。")]),
        ]);
        let parsed = parse_align_edges(&input, Some(&rendered), &output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        let group = parsed.group("s-g1.0").unwrap();
        assert_eq!(group.chunks.len(), 2);
        assert_eq!(group.chunks[0].ordinals, vec![3, 4, 5, 6]);
        assert_eq!(group.chunks[1].ordinals, vec![0, 1, 2]);
        assert_eq!(group.text, "因为我病了，所以没去。");
        let edges = chunks_to_edges(&group.chunks, "因为我病了，所以没去。");
        assert_eq!(edges.len(), 7);
        assert!(
            edges
                .iter()
                .all(|edge| !edge.hard && edge.weight == CHUNK_EDGE_WEIGHT)
        );
        assert_eq!(edges[0].src, 3);
        assert_eq!(edges[0].tgt, 0..5, "首块到「了」为止（标点不计）");
        assert_eq!(edges[4].src, 0);
        assert_eq!(edges[4].tgt, 6..10);
    }

    #[test]
    fn plain_text_outside_spans_is_an_unattributed_chunk_and_no_span_is_a_warning() {
        let input = causal_input();
        let output = concat!(
            "<table><tbody data-sid=\"s-g1.0\"><tr><th>s-g1.0</th><td class=\"src\">x</td>",
            "<td class=\"tgt\">因为<span data-src=\"5-7\">我病了，</span>所以<span data-src=\"1-3\">没去。</span></td></tr></tbody>",
            "<tbody data-sid=\"s-g2.0\"><tr><th>s-g2.0</th><td class=\"src\">x</td><td class=\"tgt\">我们今天发布。</td></tr></tbody></table>",
        );
        let parsed = parse_align_edges(&input, None, output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        let group = parsed.group("s-g1.0").unwrap();
        assert_eq!(group.chunks.len(), 4);
        assert!(group.chunks[0].ordinals.is_empty());
        assert_eq!(group.chunks[0].text, "因为");
        assert_eq!(group.chunks[1].ordinals, vec![4, 5, 6]);
        let plain = parsed.group("s-g2.0").unwrap();
        assert!(plain.chunks.is_empty());
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::ContentIgnored)
        );
        // 未标注块不产边；chunks_to_edges 仍能越过它顺序定位。
        let edges = chunks_to_edges(&group.chunks, "因为我病了，所以没去。");
        assert_eq!(edges.len(), 6);
        assert_eq!(edges[0].tgt, 2..5);
    }

    #[test]
    fn text_drift_bad_ordinals_and_duplicates_are_sentence_problems() {
        let input = causal_input();
        let output = answer(&[
            (
                "s-g1.0",
                &[("4-7", "因为我生病了，"), ("1 2 3", "所以没去。")],
            ),
            (
                "s-g2.0",
                &[("1 9", "我们"), ("2", "今天"), ("2,3", "发布。")],
            ),
        ]);
        let parsed = parse_align_edges(&input, None, &output);
        let codes: Vec<(ProblemCode, String)> = parsed
            .diagnostics
            .problems
            .iter()
            .map(|problem| (problem.code, problem.scope.describe()))
            .collect();
        assert!(
            codes.iter().any(
                |(code, scope)| *code == ProblemCode::AlignEdgeText && scope.contains("s-g1.0")
            ),
            "{codes:?}"
        );
        assert!(
            codes
                .iter()
                .any(|(code, scope)| *code == ProblemCode::AlignEdgeOrdinal
                    && scope.contains("s-g2.0")),
            "{codes:?}"
        );
        let detail = &parsed
            .diagnostics
            .problems
            .iter()
            .find(|problem| problem.code == ProblemCode::AlignEdgeOrdinal)
            .unwrap()
            .detail;
        assert!(detail.contains("超出源词数 3"), "{detail}");
        assert!(detail.contains("重复引用源词 2"), "{detail}");
        // 有问题的句不影响另一句被正常解析。
        assert_eq!(parsed.groups.len(), 2);
    }

    #[test]
    fn missing_suffix_is_truncation_and_scattered_missing_is_missing_id() {
        let input = causal_input();
        let only_first = answer(&[("s-g1.0", &[("4-7", "因为我病了，"), ("1-3", "所以没去。")])]);
        let parsed = parse_align_edges(&input, None, &only_first);
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
        assert!(!parsed.diagnostics.has_code(ProblemCode::MissingId));
        let only_second = answer(&[("s-g2.0", &[("1", "我们"), ("3", "今天"), ("2", "发布。")])]);
        let parsed = parse_align_edges(&input, None, &only_second);
        assert!(parsed.diagnostics.has_code(ProblemCode::MissingId));
        assert!(!parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
        // 裸 <tbody>（无 <table> 外壳）仍能恢复。
        let bare = "<tbody data-sid=\"s-g1.0\"><tr><td class=\"src\">x</td><td class=\"tgt\"><span data-src=\"4-7\">因为我病了，</span><span data-src=\"1-3\">所以没去。</span></td></tr></tbody><tbody data-sid=\"s-g2.0\"><tr><td class=\"src\">x</td><td class=\"tgt\"><span data-src=\"1-3\">我们今天发布。</span></td></tr></tbody>";
        let parsed = parse_align_edges(&input, None, bare);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.groups.len(), 2);
    }

    #[test]
    fn rewrite_mode_guards_amplitude_anchors_and_emptiness() {
        let mut input = AlignEdgesInput::new(
            "zh",
            vec![AlignEdgesSentenceInput {
                id: "s-1".to_owned(),
                source_words: en_words("Revenue grew 40% in 2025 because we cut costs."),
                translation: "因为我们削减了成本，2025 年收入增长了 40%。".to_owned(),
                over_hard: Some("chunk 1 (words 1-9): 24 units > hard 20".to_owned()),
            }],
        );
        input.rewrite = true;
        let rendered = render_align_edges(&input);
        assert!(
            rendered.contains("data-bcut-format=\"align-rewrite/1\""),
            "{rendered}"
        );
        assert!(
            rendered.contains("data-over-hard=\"chunk 1 (words 1-9): 24 units &gt; hard 20\""),
            "{rendered}"
        );

        let good = answer(&[(
            "s-1",
            &[
                ("1-5", "2025 年收入增长了 40%，"),
                ("6-9", "因为我们削减了成本。"),
            ],
        )]);
        let parsed = parse_align_edges(&input, Some(&rendered), &good);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(
            parsed.groups[0].text,
            "2025 年收入增长了 40%，因为我们削减了成本。"
        );

        let dropped = answer(&[(
            "s-1",
            &[
                ("1-5", "去年收入增长了 40%，"),
                ("6-9", "因为我们削减了成本。"),
            ],
        )]);
        let parsed = parse_align_edges(&input, None, &dropped);
        assert!(parsed.diagnostics.has_code(ProblemCode::AlignContentDrift));
        assert!(
            parsed.diagnostics.problems[0].detail.contains("2025"),
            "{:?}",
            parsed.diagnostics
        );

        let bloated = answer(&[(
            "s-1",
            &[(
                "1-9",
                "2025 年公司的整体收入相比去年同期大幅增长了 40%，原因是我们削减了成本。",
            )],
        )]);
        let parsed = parse_align_edges(&input, None, &bloated);
        assert!(parsed.diagnostics.has_code(ProblemCode::AlignContentDrift));

        let empty = answer(&[("s-1", &[("1-9", " ")])]);
        let parsed = parse_align_edges(&input, None, &empty);
        assert!(parsed.diagnostics.has_code(ProblemCode::EmptyTranslation));
    }

    #[test]
    fn ordinal_words_round_trip_including_cjk_atoms() {
        let words: Vec<String> = ["我们", "今天", "[x]", "发布。"]
            .into_iter()
            .map(str::to_owned)
            .collect();
        let rendered = render_ordinal_words(&words);
        assert_eq!(rendered, "[1]我们 [2]今天 [3][x] [4]发布。");
        assert_eq!(parse_ordinal_words(&rendered), words);
        assert!(parse_ordinal_words("no markers here").is_empty());
        assert_eq!(parse_ordinals("1-3, 9 5", 9).unwrap(), vec![0, 1, 2, 8, 4]);
        assert!(parse_ordinals("0", 3).is_err());
        assert!(parse_ordinals("3-2", 3).is_err());
        assert!(parse_ordinals("a", 3).is_err());
        assert_eq!(parse_ordinals("", 3).unwrap(), Vec::<usize>::new());
    }

    #[test]
    fn chunks_to_edges_tolerates_autocorrect_spacing_and_punctuation() {
        let chunks = vec![
            AlignChunk {
                text: "Revenue grew 40%".to_owned(),
                ordinals: vec![0, 1, 2],
            },
            AlignChunk {
                text: "in 2025".to_owned(),
                ordinals: vec![3, 4],
            },
        ];
        // 提交后经 AutoCorrect：CJK/Latin 混排加空格、逗号改全角。
        let target = "Revenue grew 40 %，in 2025.";
        let edges = chunks_to_edges(&chunks, target);
        assert_eq!(edges.len(), 5);
        assert_eq!(edges[0].tgt, 0..15);
        assert_eq!(edges[3].tgt, 18..25);
        // 文本对不上 ⇒ 空。
        assert!(chunks_to_edges(&chunks, "Something else").is_empty());
    }

    #[test]
    fn render_parse_input_render_is_byte_identical() {
        let mut input = AlignEdgesInput {
            lang: "zh".to_owned(),
            params: TransParams {
                fit: 15,
                soft: 13,
                hard: 19,
            },
            rewrite: false,
            sentences: vec![
                AlignEdgesSentenceInput::new(
                    "s-g1.0",
                    en_words("alpha bravo charlie delta"),
                    "第一段译文需要自然对应，第二段负责收尾。",
                ),
                AlignEdgesSentenceInput::new("s-g2.0", en_words("echo foxtrot"), "回声与狐步。"),
            ],
        };
        let rendered = render_align_edges(&input);
        let recovered = parse_align_edges_input(&rendered).expect("payload is an edges table");
        assert_eq!(recovered, input);
        assert_eq!(render_align_edges(&recovered), rendered);

        input.rewrite = true;
        input.sentences[0].over_hard = Some("chunk 1 (words 1-4): 27 units > hard 19".to_owned());
        let rendered = render_align_edges(&input);
        let recovered = parse_align_edges_input(&rendered).expect("payload is a rewrite table");
        assert_eq!(recovered, input);
        assert_eq!(render_align_edges(&recovered), rendered);
        assert!(parse_align_edges_input("<article><p id=\"s-1\">x</p></article>").is_none());
        assert!(
            parse_align_edges_input(
                "<table data-bcut-format=\"align-table/1\"><tbody data-sid=\"s-1\"></tbody></table>"
            )
            .is_none()
        );
    }

    #[test]
    fn self_roundtrip_of_rendered_payload_has_no_problems() {
        // 把渲染出的载荷（未标注 span）当作回答喂回去：只有 ContentIgnored 警告。
        let input = causal_input();
        let rendered = render_align_edges(&input);
        let parsed = parse_align_edges(&input, Some(&rendered), &rendered);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.groups.len(), 2);
        assert!(parsed.groups.iter().all(|group| group.chunks.is_empty()));
    }

    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0 >> 33
        }

        fn below(&mut self, bound: usize) -> usize {
            (self.next() as usize) % bound.max(1)
        }
    }

    #[test]
    fn property_parse_never_panics_on_garbage() {
        const CHUNKS: &[&str] = &[
            "<", ">", "&", "\"", "'", "/", "=", "table", "tbody", "tr", "td", "th", "span",
            "data-sid", "data-src", "s-g1.0", "1-3", "9", "0", ",", "-", "class", "tgt", "src",
            "甲", "a", " ", "\n", "\u{0000}", "\u{202E}", "```", "<!--", "-->", "&amp;",
        ];
        let input = causal_input();
        let mut rng = Lcg(0x0BAD_C0DE_0000_0011);
        for _ in 0..300 {
            let length = rng.below(40);
            let junk: String = (0..length)
                .map(|_| CHUNKS[rng.below(CHUNKS.len())])
                .collect();
            let first = parse_align_edges(&input, None, &junk);
            let second = parse_align_edges(&input, None, &junk);
            assert_eq!(first, second);
            let _ = parse_align_edges_input(&junk);
            let _ = parse_ordinal_words(&junk);
            let _ = parse_ordinals(&junk, 7);
        }
    }
}
