//! context.md 载体（§5）：`ai/context.md` 与 `ai/context.<lang>.md` 的渲染与解析。
//!
//! 两份文档都是「frontmatter + 小节 + Lock/Origin 表格」结构。表头固定用英文
//! （机器契约），`Category` 是闭集。**术语表解析失败时返回 `context: None`**，
//! 调用方必须保留旧的已验证上下文，绝不以空表覆盖（§5.1 重建规则）。

use std::collections::BTreeMap;

use crate::engines::brief::TranslationTone;

use super::common::{
    CONTEXT_DOC_FORMAT, Diagnostics, Problem, ProblemCode, WarningCode, guard_output_size,
    normalize_llm_output, sanitize_inline_text, sanitize_payload_text,
};

/// `Canonical Terms` 表的表头（逐字校验）。
const CANONICAL_HEADER: [&str; 6] = ["Source", "Category", "Variants", "Note", "Lock", "Origin"];
/// `Bilingual Glossary` 表的表头（逐字校验）。
const BILINGUAL_HEADER: [&str; 5] = ["Source", "Target", "Note", "Lock", "Origin"];

/// 单页 `Canonical Terms` 保留的最大行数（重试策略重设计 §2.1）。
///
/// 实测 deepseek-v4-flash 会把「论文/学习/嗯/啊」都写成术语行，一页交回
/// 500–1000 行。行数上限是确定性截断，不是拒收理由：超出部分记
/// [`WarningCode::ContentIgnored`] 并带丢弃计数。
pub const ANALYSIS_MAX_TERMS_PER_PAGE: usize = 150;
/// 全文归并后 `Canonical Terms` 的最大行数（见
/// [`ANALYSIS_MAX_TERMS_PER_PAGE`]；排序口径见
/// `crate::engines::brief::merge_partial_terms`）。
pub const ANALYSIS_MAX_TERMS: usize = 400;

/// 解析模式（重试策略重设计 §2.1）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseMode {
    /// 用户手写 `ai/context.md` / `context.<lang>.md`：任何结构或取值缺陷都判败，
    /// 调用方保留旧的已验证上下文，绝不以半张表覆盖。
    Strict,
    /// 模型答案：能用代码消解的一律消解（R2 代码先修）——重复 Source 合并、
    /// 列数补齐/并回、未知 Category 归 `other`、Lock/Origin 降级、表头放宽、
    /// 垃圾行丢弃、行数截断，全部只记 Warning。只剩「既没有术语表小节也没有
    /// 任何可解析行」与「超体积硬顶」两种 page-fatal。
    Model,
}

/// 术语归并键：小写并去掉空白与 ASCII 标点，`Yann LeCun` / `yann lecun` /
/// `Yann-LeCun` 归到同一组；CJK 与其他字符原样保留。
///
/// 页内去重（[`ParseMode::Model`]）与跨页归并
/// （`crate::engines::brief::merge_partial_terms`）共用这一个键，页内合并过的行
/// 因此不会在跨页阶段被当成两组。
pub fn term_merge_key(source: &str) -> String {
    source
        .chars()
        .filter(|ch| !ch.is_whitespace() && !ch.is_ascii_punctuation())
        .flat_map(char::to_lowercase)
        .collect()
}

/// 垃圾术语行判据（[`ParseMode::Model`] 的确定性过滤）。
///
/// ASR 纠错用的术语表只服务于「容易识别错的专名」；单个 CJK 字、纯标点、纯
/// 数字与应答语气词（复用 speaker-repair 的白名单）没有任何纠错价值，却在实测
/// 里占据成百上千行。它们被丢弃而不是拒页。
pub fn is_junk_term_source(source: &str) -> bool {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return true;
    }
    let meaningful: Vec<char> = trimmed
        .chars()
        .filter(|ch| ch.is_alphanumeric() || *ch == '\u{200D}')
        .collect();
    if meaningful.is_empty() {
        // 纯标点/符号。
        return true;
    }
    if meaningful.iter().all(|ch| ch.is_numeric()) {
        return true;
    }
    if meaningful.len() == 1 && crate::atomize::is_cjk_text(&meaningful[0].to_string()) {
        return true;
    }
    let normalized: String = trimmed
        .chars()
        .filter(|ch| ch.is_alphanumeric() || ch.is_whitespace() || *ch == '-')
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let compact: String = normalized
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect();
    crate::engines::speaker_repair::SPEAKER_REPAIR_BACKCHANNEL_LEXICON
        .iter()
        .any(|entry| *entry == normalized || *entry == compact)
}

/// 术语类别（闭集；未知类别即 lint 失败）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TermCategory {
    /// 产品名。
    Product,
    /// 人名。
    Person,
    /// 技术术语。
    Tech,
    /// 其他专名。
    Proper,
    /// 其他。
    Other,
}

impl TermCategory {
    /// 表格里的字面量。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Product => "product",
            Self::Person => "person",
            Self::Tech => "tech",
            Self::Proper => "proper",
            Self::Other => "other",
        }
    }

    /// 从表格字面量解析（大小写敏感，闭集外一律失败）。
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "product" => Some(Self::Product),
            "person" => Some(Self::Person),
            "tech" => Some(Self::Tech),
            "proper" => Some(Self::Proper),
            "other" => Some(Self::Other),
            _ => None,
        }
    }
}

/// 术语来源：决定优先级 `user+lock > user > analyzed`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TermOrigin {
    /// 用户条目：analysis 重跑时逐条保留，禁止删除或改写。
    User,
    /// 模型条目：analysis 重跑整表覆盖。
    Analyzed,
}

impl TermOrigin {
    /// 表格里的字面量。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Analyzed => "analyzed",
        }
    }

    /// 从表格字面量解析。
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Self::User),
            "analyzed" => Some(Self::Analyzed),
            _ => None,
        }
    }
}

/// `Canonical Terms` 的一行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalTerm {
    /// 规范形（同时是行主键）。
    pub source: String,
    /// 类别。
    pub category: TermCategory,
    /// 正文里真实出现过的误识别变体（禁止编造）。
    pub variants: Vec<String>,
    /// 备注。
    pub note: String,
    /// 是否锁定。
    pub locked: bool,
    /// 来源。
    pub origin: TermOrigin,
}

impl CanonicalTerm {
    /// 优先级：`user+lock` 3 > `user` 2 > `analyzed` 1。
    pub fn priority(&self) -> u8 {
        match (self.origin, self.locked) {
            (TermOrigin::User, true) => 3,
            (TermOrigin::User, false) => 2,
            (TermOrigin::Analyzed, _) => 1,
        }
    }
}

/// `Bilingual Glossary` 的一行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BilingualTerm {
    /// 源语规范形（行主键）。
    pub source: String,
    /// 目标语译名。
    pub target: String,
    /// 备注。
    pub note: String,
    /// 是否锁定；`true` 即编译进 required targets（§5.2）。
    pub locked: bool,
    /// 来源。
    pub origin: TermOrigin,
}

impl BilingualTerm {
    /// 优先级：`user+lock` 3 > `user` 2 > `analyzed` 1（与
    /// [`CanonicalTerm::priority`] 同口径，§5.1）。
    pub fn priority(&self) -> u8 {
        match (self.origin, self.locked) {
            (TermOrigin::User, true) => 3,
            (TermOrigin::User, false) => 2,
            (TermOrigin::Analyzed, _) => 1,
        }
    }
}

/// `ai/context.md`（源语上下文）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SourceContext {
    /// 词指纹。
    pub fingerprint: String,
    /// 用户参考资料指纹。
    pub reference_fingerprint: Option<String>,
    /// 整体摘要。
    pub summary: String,
    /// 规范术语表。
    pub terms: Vec<CanonicalTerm>,
}

/// `ai/context.<lang>.md`（目标语上下文）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TargetContext {
    /// 目标语标签。
    pub target_lang: String,
    /// 词指纹。
    pub fingerprint: String,
    /// 上游 analysis 指纹。
    pub analysis_fingerprint: Option<String>,
    /// 用户指令指纹。
    pub instructions_fingerprint: Option<String>,
    /// 翻译语气（闭集枚举，进 frontmatter 以求逐字往返）。
    pub tone: Option<TranslationTone>,
    /// 译文摘要。
    pub summary: String,
    /// 双语术语表。
    pub glossary: Vec<BilingualTerm>,
    /// 文风要求。
    pub style: String,
    /// 难点说明。
    pub difficulties: Vec<String>,
}

/// 解析结果：`context` 为 `None` 时调用方必须保留旧的已验证上下文。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextParsed<T> {
    /// 解析成功的文档；结构或表格非法时为 `None`。
    pub context: Option<T>,
    /// 诊断。
    pub diagnostics: Diagnostics,
}

impl<T> ContextParsed<T> {
    fn failed(diagnostics: Diagnostics) -> Self {
        Self {
            context: None,
            diagnostics,
        }
    }
}

// --- 渲染 ---

/// Markdown 表格单元格转义：`|` 与 `\` 需要转义，换行折成空格。
fn escape_cell(text: &str) -> String {
    let inline = sanitize_inline_text(text);
    let mut out = String::with_capacity(inline.len());
    for ch in inline.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '|' => out.push_str("\\|"),
            c => out.push(c),
        }
    }
    out
}

/// 单元格反转义。
fn unescape_cell(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('|') => out.push('|'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out.trim().to_owned()
}

/// frontmatter 值转义（双引号包裹）。
fn escape_front(text: &str) -> String {
    let inline = sanitize_inline_text(text);
    format!("\"{}\"", inline.replace('\\', "\\\\").replace('"', "\\\""))
}

/// frontmatter 值反转义（可带可不带双引号）。
fn unescape_front(text: &str) -> String {
    let trimmed = text.trim();
    let inner = match (
        trimmed.starts_with('"'),
        trimmed.ends_with('"'),
        trimmed.len(),
    ) {
        (true, true, len) if len >= 2 => &trimmed[1..len - 1],
        _ => return trimmed.to_owned(),
    };
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn render_row(cells: &[String]) -> String {
    format!("| {} |\n", cells.join(" | "))
}

fn render_header(header: &[&str]) -> String {
    let mut out = render_row(&header.iter().map(|h| (*h).to_owned()).collect::<Vec<_>>());
    out.push_str(&format!("|{}\n", "---|".repeat(header.len())));
    out
}

/// 渲染 `ai/context.md`（§5.1）。
pub fn render_source_context(context: &SourceContext) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("format: {}\n", escape_front(CONTEXT_DOC_FORMAT)));
    out.push_str(&format!(
        "fingerprint: {}\n",
        escape_front(&context.fingerprint)
    ));
    if let Some(reference) = &context.reference_fingerprint {
        out.push_str(&format!(
            "referenceFingerprint: {}\n",
            escape_front(reference)
        ));
    }
    out.push_str("---\n\n# Summary\n");
    out.push_str(&render_body(&context.summary));
    out.push_str("\n# Canonical Terms\n");
    out.push_str(&render_header(&CANONICAL_HEADER));
    for term in &context.terms {
        out.push_str(&render_row(&[
            escape_cell(&term.source),
            term.category.as_str().to_owned(),
            escape_cell(&term.variants.join(", ")),
            escape_cell(&term.note),
            if term.locked { "yes" } else { "no" }.to_owned(),
            term.origin.as_str().to_owned(),
        ]));
    }
    out
}

/// 渲染 `ai/context.<lang>.md`（§5.1）。
pub fn render_target_context(context: &TargetContext) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("format: {}\n", escape_front(CONTEXT_DOC_FORMAT)));
    out.push_str(&format!(
        "targetLang: {}\n",
        escape_front(&context.target_lang)
    ));
    out.push_str(&format!(
        "fingerprint: {}\n",
        escape_front(&context.fingerprint)
    ));
    if let Some(value) = &context.analysis_fingerprint {
        out.push_str(&format!("analysisFingerprint: {}\n", escape_front(value)));
    }
    if let Some(value) = &context.instructions_fingerprint {
        out.push_str(&format!(
            "instructionsFingerprint: {}\n",
            escape_front(value)
        ));
    }
    if let Some(tone) = context.tone {
        let value = match tone {
            TranslationTone::Formal => "formal",
            TranslationTone::Casual => "casual",
        };
        out.push_str(&format!("tone: {}\n", escape_front(value)));
    }
    out.push_str("---\n\n# Translated Summary\n");
    out.push_str(&render_body(&context.summary));
    out.push_str("\n# Bilingual Glossary\n");
    out.push_str(&render_header(&BILINGUAL_HEADER));
    for term in &context.glossary {
        out.push_str(&render_row(&[
            escape_cell(&term.source),
            escape_cell(&term.target),
            escape_cell(&term.note),
            if term.locked { "yes" } else { "no" }.to_owned(),
            term.origin.as_str().to_owned(),
        ]));
    }
    out.push_str("\n# Translation Style\n");
    out.push_str(&render_body(&context.style));
    out.push_str("\n# Difficulties\n");
    for item in &context.difficulties {
        out.push_str(&format!("- {}\n", sanitize_inline_text(item)));
    }
    out
}

/// 正文小节渲染：清洗控制字符，保证以换行收尾。
fn render_body(text: &str) -> String {
    let cleaned = sanitize_payload_text(text);
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    format!("{trimmed}\n")
}

// --- 解析 ---

struct Document {
    front: BTreeMap<String, String>,
    sections: Vec<(String, Vec<String>)>,
}

impl Document {
    fn section(&self, name: &str) -> Option<&[String]> {
        self.sections
            .iter()
            .find(|(title, _)| title == name)
            .map(|(_, lines)| lines.as_slice())
    }

    /// 大小写/空白不敏感的小节查找（[`ParseMode::Model`]）。
    fn section_lenient(&self, name: &str) -> Option<&[String]> {
        self.sections
            .iter()
            .find(|(title, _)| title.trim().eq_ignore_ascii_case(name))
            .map(|(_, lines)| lines.as_slice())
    }

    /// 大小写不敏感的正文取值（[`ParseMode::Model`]）。
    fn body_lenient(&self, name: &str) -> String {
        self.section_lenient(name)
            .map(|lines| lines.join("\n").trim().to_owned())
            .unwrap_or_default()
    }

    /// 全文所有小节里的表格行（缺小节标题时的兜底扫描）。
    fn all_lines(&self) -> Vec<String> {
        self.sections
            .iter()
            .flat_map(|(_, lines)| lines.iter().cloned())
            .collect()
    }

    fn body(&self, name: &str) -> String {
        self.section(name)
            .map(|lines| lines.join("\n").trim().to_owned())
            .unwrap_or_default()
    }
}

/// 拆 frontmatter 与 `# ` 小节。frontmatter 缺失时返回 `None`。
fn split_document(text: &str) -> Option<Document> {
    let mut lines = text.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let mut front = BTreeMap::new();
    let mut closed = false;
    for line in lines.by_ref() {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            front.insert(key.trim().to_owned(), unescape_front(value));
        }
    }
    if !closed {
        return None;
    }
    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    for line in lines {
        if let Some(title) = line.strip_prefix("# ") {
            sections.push((title.trim().to_owned(), Vec::new()));
        } else if let Some((_, body)) = sections.last_mut() {
            body.push(line.to_owned());
        }
    }
    Some(Document { front, sections })
}

/// [`ParseMode::Model`] 的文档切分：缺 frontmatter 照样切小节，指纹由引擎盖。
///
/// 小节标题匹配同样放宽：`# `、`## `、`###` 任一层级都算小节头（模型常把
/// `# Canonical Terms` 写成 `## Canonical Terms`），标题按 trim 保存，
/// [`Document::section`] 侧做大小写不敏感比对。
fn split_document_lenient(text: &str) -> Document {
    if let Some(document) = split_document(text) {
        return document;
    }
    let mut front = BTreeMap::new();
    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    let mut lines = text.lines().peekable();
    // 没有闭合的 frontmatter 时，开头若仍写了 `key: value` 行，照样收下。
    while let Some(line) = lines.peek() {
        let trimmed = line.trim();
        if trimmed == "---" {
            lines.next();
            continue;
        }
        if trimmed.starts_with('#') || trimmed.starts_with('|') {
            break;
        }
        match trimmed.split_once(':') {
            Some((key, value)) if !key.trim().is_empty() && !key.contains(' ') => {
                front.insert(key.trim().to_owned(), unescape_front(value));
                lines.next();
            }
            _ => break,
        }
    }
    // 小节头之前的散行归入一个匿名小节，表格扫描才能兜到它们。
    sections.push((String::new(), Vec::new()));
    for line in lines {
        let trimmed = line.trim_start();
        if let Some(title) = trimmed
            .strip_prefix("### ")
            .or_else(|| trimmed.strip_prefix("## "))
            .or_else(|| trimmed.strip_prefix("# "))
        {
            sections.push((title.trim().to_owned(), Vec::new()));
        } else if let Some((_, body)) = sections.last_mut() {
            body.push(line.to_owned());
        }
    }
    Document { front, sections }
}

/// 从小节正文里抽表格行（不含表头与分隔行）；返回 `None` 表示表头不符。
fn table_rows(lines: &[String], header: &[&str]) -> Option<Vec<Vec<String>>> {
    let mut rows = Vec::new();
    let mut seen_header = false;
    let mut seen_divider = false;
    for line in lines {
        let trimmed = line.trim();
        if !trimmed.starts_with('|') {
            continue;
        }
        let cells = split_row(trimmed);
        if !seen_header {
            if cells.len() != header.len()
                || cells
                    .iter()
                    .zip(header.iter())
                    .any(|(cell, expected)| cell != expected)
            {
                return None;
            }
            seen_header = true;
            continue;
        }
        if !seen_divider {
            if cells.iter().all(|cell| {
                !cell.is_empty() && cell.chars().all(|c| c == '-' || c == ':' || c == ' ')
            }) {
                seen_divider = true;
                continue;
            }
            return None;
        }
        rows.push(cells);
    }
    if seen_header && seen_divider {
        Some(rows)
    } else {
        None
    }
}

/// [`ParseMode::Model`] 的表格行抽取：表头与分隔行按形状识别并跳过，其余
/// `|` 行一律当数据行（列数错乱交给行级修复）。
///
/// 表头判据放宽为「首格 trim + 大小写不敏感等于 `Source`」——模型偶尔会漏写、
/// 多写或改写后面几个表头名，而表头本身不承载任何数据。
fn table_rows_lenient(lines: &[String]) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut seen_header = false;
    for line in lines {
        let trimmed = line.trim();
        if !trimmed.starts_with('|') {
            continue;
        }
        let cells = split_row(trimmed);
        if cells
            .iter()
            .all(|cell| !cell.is_empty() && cell.chars().all(|c| c == '-' || c == ':' || c == ' '))
        {
            continue;
        }
        if !seen_header
            && cells
                .first()
                .is_some_and(|cell| cell.trim().eq_ignore_ascii_case("source"))
        {
            seen_header = true;
            continue;
        }
        rows.push(cells);
    }
    rows
}

/// [`ParseMode::Model`] 的列数修复：把任意列数的行拉回固定 `width` 列。
///
/// - `> width`：中间列（`[2..len-2]` 之后的多余部分）并回备注列，模型把一句
///   备注里的 `|` 忘了转义时行还能用；
/// - `< width` 且 ≥2：缺失列按默认补空（Lock/Origin 随后由取值解析降级）；
/// - 只有 1 列：返回 `None`，该行丢弃。
///
/// `note_at` 是备注列下标（canonical 表 3，双语表 2）；`width` 之后的两列固定
/// 是 `Lock` / `Origin`，因此多出来的部分只并入备注。
fn repair_row_width(cells: &[String], width: usize, note_at: usize) -> Option<Vec<String>> {
    if cells.len() == width {
        return Some(cells.to_vec());
    }
    if cells.len() < 2 {
        return None;
    }
    if cells.len() > width {
        let mut repaired: Vec<String> = cells[..note_at].to_vec();
        let tail = cells.len() - 2;
        let note = cells[note_at..tail.max(note_at)]
            .iter()
            .map(|cell| cell.trim())
            .filter(|cell| !cell.is_empty())
            .collect::<Vec<_>>()
            .join(" | ");
        repaired.push(note);
        repaired.push(cells[cells.len() - 2].clone());
        repaired.push(cells[cells.len() - 1].clone());
        debug_assert_eq!(repaired.len(), width);
        return Some(repaired);
    }
    let mut repaired = cells.to_vec();
    repaired.resize(width, String::new());
    Some(repaired)
}

/// 按未转义的 `|` 切分一行。
fn split_row(line: &str) -> Vec<String> {
    let inner = line
        .trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .to_owned();
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut escaped = false;
    for ch in inner.chars() {
        if escaped {
            current.push('\\');
            current.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '|' => cells.push(std::mem::take(&mut current)),
            c => current.push(c),
        }
    }
    if escaped {
        current.push('\\');
    }
    cells.push(current);
    cells.into_iter().map(|cell| unescape_cell(&cell)).collect()
}

fn parse_lock(value: &str) -> Option<bool> {
    match value {
        "yes" => Some(true),
        "no" => Some(false),
        _ => None,
    }
}

fn parse_variants(value: &str) -> Vec<String> {
    value
        .split(&[',', '，'][..])
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_owned)
        .collect()
}

/// 前置归一化 + 体积护栏；`Err` 表示已经可以直接判败。
fn prepare(input: Option<&str>, output: &str) -> Result<(String, Diagnostics), Diagnostics> {
    let mut diagnostics = Diagnostics::new();
    let normalized = normalize_llm_output(output);
    for warning in normalized.warnings() {
        diagnostics.push_warning(warning);
    }
    if let Some(input) = input
        && let Some(problem) = guard_output_size(input, &normalized.text)
    {
        diagnostics.push_problem(problem);
        return Err(diagnostics);
    }
    Ok((normalized.text, diagnostics))
}

/// 解析 `ai/context.md`（[`ParseMode::Strict`]，用户手写文档口径）。
///
/// `input` 是当初实际发给模型的那份渲染文本（可选），仅用作 §16 体积护栏的基准；
/// 传 `None` 表示跳过体积护栏（例如解析用户手写的 context.md）。
pub fn parse_source_context(input: Option<&str>, output: &str) -> ContextParsed<SourceContext> {
    parse_source_context_with_mode(input, output, ParseMode::Strict)
}

/// 解析模型交回的 `ai/context.md`（[`ParseMode::Model`]，宽松口径）。
///
/// 引擎与 agent 镜像 lint 共用这个入口；[`ParseMode::Model`] 的全部修复只记
/// Warning，因此镜像 lint 不会因为可代码消解的缺陷把答案判 `rejected`。
pub fn parse_model_source_context(
    input: Option<&str>,
    output: &str,
) -> ContextParsed<SourceContext> {
    parse_source_context_with_mode(input, output, ParseMode::Model)
}

/// [`parse_source_context`] / [`parse_model_source_context`] 的共同实现。
pub fn parse_source_context_with_mode(
    input: Option<&str>,
    output: &str,
    mode: ParseMode,
) -> ContextParsed<SourceContext> {
    if mode == ParseMode::Model {
        return parse_source_context_model(input, output);
    }
    let (text, mut diagnostics) = match prepare(input, output) {
        Ok(value) => value,
        Err(diagnostics) => return ContextParsed::failed(diagnostics),
    };
    let Some(document) = split_document(&text) else {
        diagnostics.push_problem(Problem::document(
            ProblemCode::ContextInvalid,
            "缺少 frontmatter（`---` 包裹的键值区）",
        ));
        return ContextParsed::failed(diagnostics);
    };
    let Some(lines) = document.section("Canonical Terms") else {
        diagnostics.push_problem(Problem::document(
            ProblemCode::ContextInvalid,
            "缺少 `# Canonical Terms` 小节",
        ));
        return ContextParsed::failed(diagnostics);
    };
    let Some(rows) = table_rows(lines, &CANONICAL_HEADER) else {
        diagnostics.push_problem(Problem::document(
            ProblemCode::ContextInvalid,
            format!(
                "`Canonical Terms` 表头必须逐字为 {}",
                CANONICAL_HEADER.join(" | ")
            ),
        ));
        return ContextParsed::failed(diagnostics);
    };

    let mut terms: Vec<CanonicalTerm> = Vec::new();
    for row in rows {
        if row.len() != CANONICAL_HEADER.len() {
            diagnostics.push_problem(Problem::document(
                ProblemCode::ContextInvalid,
                format!(
                    "术语行列数为 {}，期望 {}",
                    row.len(),
                    CANONICAL_HEADER.len()
                ),
            ));
            return ContextParsed::failed(diagnostics);
        }
        let source = row[0].clone();
        if source.is_empty() {
            diagnostics.push_problem(Problem::document(
                ProblemCode::ContextInvalid,
                "术语行的 Source 为空",
            ));
            return ContextParsed::failed(diagnostics);
        }
        let Some(category) = TermCategory::parse(&row[1]) else {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::ContextInvalid,
                &source,
                format!(
                    "未知 Category `{}`（闭集：product/person/tech/proper/other）",
                    row[1]
                ),
            ));
            return ContextParsed::failed(diagnostics);
        };
        let (Some(locked), Some(origin)) = (parse_lock(&row[4]), TermOrigin::parse(&row[5])) else {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::ContextInvalid,
                &source,
                format!("Lock/Origin 取值非法：`{}` / `{}`", row[4], row[5]),
            ));
            return ContextParsed::failed(diagnostics);
        };
        if terms.iter().any(|term| term.source == source) {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::DuplicateId,
                &source,
                "同一 Source 出现多行",
            ));
            return ContextParsed::failed(diagnostics);
        }
        terms.push(CanonicalTerm {
            source,
            category,
            variants: parse_variants(&row[2]),
            note: row[3].clone(),
            locked,
            origin,
        });
    }

    let summary = document.body("Summary");
    if summary.is_empty() {
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::ContentIgnored,
            "`# Summary` 为空",
        ));
    }
    ContextParsed {
        context: Some(SourceContext {
            fingerprint: document
                .front
                .get("fingerprint")
                .cloned()
                .unwrap_or_default(),
            reference_fingerprint: document.front.get("referenceFingerprint").cloned(),
            summary,
            terms,
        }),
        diagnostics,
    }
}

/// [`ParseMode::Model`] 的 `ai/context.md` 解析（重试策略重设计 §2.1）。
///
/// page-fatal 只剩两种：超体积硬顶、既没有 `# Canonical Terms` 小节也扫不到
/// 任何表格行。其余一律代码消解并记 Warning：
///
/// - 缺 frontmatter → 照常解析（指纹由引擎盖）；表头按首格放宽；
/// - 列数错乱 → [`repair_row_width`]；未知 Category → `other`；
///   Lock/Origin 非法 → 降级（模型行本来就要被降级）；
/// - 垃圾行（[`is_junk_term_source`]）丢弃；
/// - 同一 Source（按 [`term_merge_key`]）多行 → 合并（Variants 并集、Note 取最长、
///   Category 取先见）；
/// - 超过 [`ANALYSIS_MAX_TERMS_PER_PAGE`] 行 → 截断并带丢弃计数。
fn parse_source_context_model(input: Option<&str>, output: &str) -> ContextParsed<SourceContext> {
    let (text, mut diagnostics) = match prepare(input, output) {
        Ok(value) => value,
        Err(diagnostics) => return ContextParsed::failed(diagnostics),
    };
    let document = split_document_lenient(&text);
    let has_section = document.section_lenient("Canonical Terms").is_some();
    let owned_all;
    let lines: &[String] = match document.section_lenient("Canonical Terms") {
        Some(lines) => lines,
        None => {
            owned_all = document.all_lines();
            &owned_all
        }
    };
    let rows = table_rows_lenient(lines);
    if !has_section && rows.is_empty() {
        diagnostics.push_problem(Problem::document(
            ProblemCode::ContextInvalid,
            "缺少 `# Canonical Terms` 小节，且全文没有任何可解析的表格行",
        ));
        return ContextParsed::failed(diagnostics);
    }
    if !has_section {
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::RowRepaired,
            "缺少 `# Canonical Terms` 小节，已按全文表格行接受",
        ));
    }

    let mut repaired_rows = 0usize;
    let mut dropped_rows = 0usize;
    let mut demoted = 0usize;
    let mut merged_rows = 0usize;
    let mut terms: Vec<CanonicalTerm> = Vec::new();
    let mut index_of: BTreeMap<String, usize> = BTreeMap::new();
    for row in rows {
        let original_width = row.len();
        let Some(row) = repair_row_width(&row, CANONICAL_HEADER.len(), 3) else {
            dropped_rows += 1;
            continue;
        };
        repaired_rows += usize::from(original_width != CANONICAL_HEADER.len());
        let source = row[0].trim().to_owned();
        if is_junk_term_source(&source) {
            dropped_rows += 1;
            continue;
        }
        let category = TermCategory::parse(row[1].trim()).unwrap_or_else(|| {
            demoted += 1;
            TermCategory::Other
        });
        // Lock/Origin 是用户通道：模型行无论写什么都要降级，非法取值只是同一件事。
        if parse_lock(row[4].trim()).is_none() || TermOrigin::parse(row[5].trim()).is_none() {
            demoted += 1;
        }
        let key = term_merge_key(&source);
        if key.is_empty() {
            dropped_rows += 1;
            continue;
        }
        let variants = parse_variants(&row[2]);
        let note = row[3].trim().to_owned();
        match index_of.get(&key) {
            Some(&slot) => {
                merged_rows += 1;
                let term: &mut CanonicalTerm = &mut terms[slot];
                for variant in variants {
                    if !term
                        .variants
                        .iter()
                        .any(|seen| seen.eq_ignore_ascii_case(&variant))
                    {
                        term.variants.push(variant);
                    }
                }
                if note.chars().count() > term.note.chars().count() {
                    term.note = note;
                }
            }
            None => {
                index_of.insert(key, terms.len());
                terms.push(CanonicalTerm {
                    source,
                    category,
                    variants,
                    note,
                    locked: false,
                    origin: TermOrigin::Analyzed,
                });
            }
        }
    }
    if merged_rows > 0 {
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::DuplicateId,
            format!("同一 Source 出现多行，已合并 {merged_rows} 行"),
        ));
    }
    if repaired_rows > 0 || demoted > 0 {
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::RowRepaired,
            format!("确定性修复了 {repaired_rows} 行列数、{demoted} 处非法取值"),
        ));
    }
    if dropped_rows > 0 {
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::ContentIgnored,
            format!(
                "丢弃了 {dropped_rows} 行无法使用的术语行（空 Source / 单字 / 纯标点数字 / 语气词）"
            ),
        ));
    }
    if terms.len() > ANALYSIS_MAX_TERMS_PER_PAGE {
        let overflow = terms.len() - ANALYSIS_MAX_TERMS_PER_PAGE;
        terms.truncate(ANALYSIS_MAX_TERMS_PER_PAGE);
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::ContentIgnored,
            format!("术语行超过单页上限 {ANALYSIS_MAX_TERMS_PER_PAGE}，丢弃了末尾 {overflow} 行"),
        ));
    }

    let summary = document.body_lenient("Summary");
    if summary.is_empty() {
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::ContentIgnored,
            "`# Summary` 为空",
        ));
    }
    ContextParsed {
        context: Some(SourceContext {
            fingerprint: document
                .front
                .get("fingerprint")
                .cloned()
                .unwrap_or_default(),
            reference_fingerprint: document.front.get("referenceFingerprint").cloned(),
            summary,
            terms,
        }),
        diagnostics,
    }
}

/// 解析 `ai/context.<lang>.md`（[`ParseMode::Strict`]）。
///
/// `input` 语义同 [`parse_source_context`]：发给模型的渲染文本，仅用于体积护栏。
pub fn parse_target_context(input: Option<&str>, output: &str) -> ContextParsed<TargetContext> {
    parse_target_context_with_mode(input, output, ParseMode::Strict)
}

/// 解析模型交回的 `ai/context.<lang>.md`（[`ParseMode::Model`]）。
pub fn parse_model_target_context(
    input: Option<&str>,
    output: &str,
) -> ContextParsed<TargetContext> {
    parse_target_context_with_mode(input, output, ParseMode::Model)
}

/// [`parse_target_context`] / [`parse_model_target_context`] 的共同实现。
pub fn parse_target_context_with_mode(
    input: Option<&str>,
    output: &str,
    mode: ParseMode,
) -> ContextParsed<TargetContext> {
    if mode == ParseMode::Model {
        return parse_target_context_model(input, output);
    }
    let (text, mut diagnostics) = match prepare(input, output) {
        Ok(value) => value,
        Err(diagnostics) => return ContextParsed::failed(diagnostics),
    };
    let Some(document) = split_document(&text) else {
        diagnostics.push_problem(Problem::document(
            ProblemCode::ContextInvalid,
            "缺少 frontmatter（`---` 包裹的键值区）",
        ));
        return ContextParsed::failed(diagnostics);
    };
    let Some(lines) = document.section("Bilingual Glossary") else {
        diagnostics.push_problem(Problem::document(
            ProblemCode::ContextInvalid,
            "缺少 `# Bilingual Glossary` 小节",
        ));
        return ContextParsed::failed(diagnostics);
    };
    let Some(rows) = table_rows(lines, &BILINGUAL_HEADER) else {
        diagnostics.push_problem(Problem::document(
            ProblemCode::ContextInvalid,
            format!(
                "`Bilingual Glossary` 表头必须逐字为 {}",
                BILINGUAL_HEADER.join(" | ")
            ),
        ));
        return ContextParsed::failed(diagnostics);
    };

    let mut glossary: Vec<BilingualTerm> = Vec::new();
    for row in rows {
        if row.len() != BILINGUAL_HEADER.len() {
            diagnostics.push_problem(Problem::document(
                ProblemCode::ContextInvalid,
                format!(
                    "术语行列数为 {}，期望 {}",
                    row.len(),
                    BILINGUAL_HEADER.len()
                ),
            ));
            return ContextParsed::failed(diagnostics);
        }
        let source = row[0].clone();
        if source.is_empty() {
            diagnostics.push_problem(Problem::document(
                ProblemCode::ContextInvalid,
                "术语行的 Source 为空",
            ));
            return ContextParsed::failed(diagnostics);
        }
        let (Some(locked), Some(origin)) = (parse_lock(&row[3]), TermOrigin::parse(&row[4])) else {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::ContextInvalid,
                &source,
                format!("Lock/Origin 取值非法：`{}` / `{}`", row[3], row[4]),
            ));
            return ContextParsed::failed(diagnostics);
        };
        if glossary.iter().any(|term| term.source == source) {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::DuplicateId,
                &source,
                "同一 Source 出现多行",
            ));
            return ContextParsed::failed(diagnostics);
        }
        if row[1].is_empty() {
            // 尚未翻译的行是合法中间态（translate-brief 只翻译无 Target 的行），
            // 但锁定行必须有 Target，否则无法编译 required targets。
            if locked {
                diagnostics.push_problem(Problem::sentence(
                    ProblemCode::EmptyTranslation,
                    &source,
                    "锁定术语缺少 Target",
                ));
                return ContextParsed::failed(diagnostics);
            }
        }
        glossary.push(BilingualTerm {
            source,
            target: row[1].clone(),
            note: row[2].clone(),
            locked,
            origin,
        });
    }

    let tone = match document.front.get("tone") {
        Some(value) => match TranslationTone::parse(value) {
            Ok(tone) => Some(tone),
            Err(message) => {
                diagnostics.push_problem(Problem::document(ProblemCode::ContextInvalid, message));
                return ContextParsed::failed(diagnostics);
            }
        },
        None => None,
    };

    let difficulties = document
        .section("Difficulties")
        .map(|lines| {
            lines
                .iter()
                .filter_map(|line| line.trim().strip_prefix("- ").map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();

    ContextParsed {
        context: Some(TargetContext {
            target_lang: document
                .front
                .get("targetLang")
                .cloned()
                .unwrap_or_default(),
            fingerprint: document
                .front
                .get("fingerprint")
                .cloned()
                .unwrap_or_default(),
            analysis_fingerprint: document.front.get("analysisFingerprint").cloned(),
            instructions_fingerprint: document.front.get("instructionsFingerprint").cloned(),
            tone,
            summary: document.body("Translated Summary"),
            glossary,
            style: document.body("Translation Style"),
            difficulties,
        }),
        diagnostics,
    }
}

/// [`ParseMode::Model`] 的 `ai/context.<lang>.md` 解析。
///
/// 与 [`parse_source_context_model`] 同一套 R2 修复：缺 frontmatter / 表头错乱 /
/// 列数错乱 / Lock/Origin 非法 / 重复 Source 全部代码消解。锁定行缺 `Target`
/// 也不再拒页——模型行本来就要被降级为 `Origin=analyzed, Lock=no`，引擎随后用
/// 种子表恢复用户通道。page-fatal 只剩超硬顶与「既无术语表小节也无表格行」。
fn parse_target_context_model(input: Option<&str>, output: &str) -> ContextParsed<TargetContext> {
    let (text, mut diagnostics) = match prepare(input, output) {
        Ok(value) => value,
        Err(diagnostics) => return ContextParsed::failed(diagnostics),
    };
    let document = split_document_lenient(&text);
    let has_section = document.section_lenient("Bilingual Glossary").is_some();
    let owned_all;
    let lines: &[String] = match document.section_lenient("Bilingual Glossary") {
        Some(lines) => lines,
        None => {
            owned_all = document.all_lines();
            &owned_all
        }
    };
    let rows = table_rows_lenient(lines);
    if !has_section && rows.is_empty() {
        diagnostics.push_problem(Problem::document(
            ProblemCode::ContextInvalid,
            "缺少 `# Bilingual Glossary` 小节，且全文没有任何可解析的表格行",
        ));
        return ContextParsed::failed(diagnostics);
    }

    let mut repaired_rows = 0usize;
    let mut dropped_rows = 0usize;
    let mut merged_rows = 0usize;
    let mut glossary: Vec<BilingualTerm> = Vec::new();
    let mut index_of: BTreeMap<String, usize> = BTreeMap::new();
    for row in rows {
        let original_width = row.len();
        let Some(row) = repair_row_width(&row, BILINGUAL_HEADER.len(), 2) else {
            dropped_rows += 1;
            continue;
        };
        repaired_rows += usize::from(original_width != BILINGUAL_HEADER.len());
        let source = row[0].trim().to_owned();
        if source.is_empty() {
            dropped_rows += 1;
            continue;
        }
        let key = term_merge_key(&source);
        if key.is_empty() {
            dropped_rows += 1;
            continue;
        }
        let target = row[1].trim().to_owned();
        let note = row[2].trim().to_owned();
        match index_of.get(&key) {
            Some(&slot) => {
                merged_rows += 1;
                let term: &mut BilingualTerm = &mut glossary[slot];
                if term.target.is_empty() {
                    term.target = target;
                }
                if note.chars().count() > term.note.chars().count() {
                    term.note = note;
                }
            }
            None => {
                index_of.insert(key, glossary.len());
                glossary.push(BilingualTerm {
                    source,
                    target,
                    note,
                    // 模型行的 Lock/Origin 一律降级，引擎侧再用种子表恢复用户通道。
                    locked: false,
                    origin: TermOrigin::Analyzed,
                });
            }
        }
    }
    if merged_rows > 0 {
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::DuplicateId,
            format!("同一 Source 出现多行，已合并 {merged_rows} 行"),
        ));
    }
    if repaired_rows > 0 {
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::RowRepaired,
            format!("确定性修复了 {repaired_rows} 行列数"),
        ));
    }
    if dropped_rows > 0 {
        diagnostics.push_warning(super::common::Warning::document(
            WarningCode::ContentIgnored,
            format!("丢弃了 {dropped_rows} 行无法使用的术语行"),
        ));
    }

    // 语气非法只降级为「未指定」：它是提示背景，不值得拒一份完整译表。
    let tone = document
        .front
        .get("tone")
        .and_then(|value| match TranslationTone::parse(value) {
            Ok(tone) => Some(tone),
            Err(message) => {
                diagnostics.push_warning(super::common::Warning::document(
                    WarningCode::ContentIgnored,
                    message,
                ));
                None
            }
        });
    let difficulties = document
        .section_lenient("Difficulties")
        .map(|lines| {
            lines
                .iter()
                .filter_map(|line| line.trim().strip_prefix("- ").map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();

    ContextParsed {
        context: Some(TargetContext {
            target_lang: document
                .front
                .get("targetLang")
                .cloned()
                .unwrap_or_default(),
            fingerprint: document
                .front
                .get("fingerprint")
                .cloned()
                .unwrap_or_default(),
            analysis_fingerprint: document.front.get("analysisFingerprint").cloned(),
            instructions_fingerprint: document.front.get("instructionsFingerprint").cloned(),
            tone,
            summary: document.body_lenient("Translated Summary"),
            glossary,
            style: document.body_lenient("Translation Style"),
            difficulties,
        }),
        diagnostics,
    }
}

/// §5.1 重建规则：analysis 重跑整表覆盖 `Origin=analyzed`，`Origin=user` 行逐条保留。
///
/// 同一 Source 冲突时按 [`CanonicalTerm::priority`] 取胜者；结果按 Source 排序，
/// 保证确定性。
pub fn merge_canonical_terms(
    existing: &[CanonicalTerm],
    regenerated: &[CanonicalTerm],
) -> Vec<CanonicalTerm> {
    let mut merged: BTreeMap<&str, CanonicalTerm> = BTreeMap::new();
    for term in existing
        .iter()
        .filter(|term| term.origin == TermOrigin::User)
    {
        merged.insert(term.source.as_str(), term.clone());
    }
    for term in regenerated {
        let entry = merged.get(term.source.as_str());
        if entry.is_none_or(|current| term.priority() > current.priority()) {
            merged.insert(term.source.as_str(), term.clone());
        }
    }
    merged.into_values().collect()
}

/// [`merge_canonical_terms`] 的双语表对应物（§5.1 重建规则的目标语一侧）。
///
/// `Origin=user` 行逐条保留；重生成表只能覆盖优先级更低的行——用户锁定的译名
/// 因此不会被 translate-brief 重跑冲掉。结果按 Source 排序，保证确定性。
pub fn merge_bilingual_terms(
    existing: &[BilingualTerm],
    regenerated: &[BilingualTerm],
) -> Vec<BilingualTerm> {
    let mut merged: BTreeMap<&str, BilingualTerm> = BTreeMap::new();
    for term in existing
        .iter()
        .filter(|term| term.origin == TermOrigin::User)
    {
        merged.insert(term.source.as_str(), term.clone());
    }
    for term in regenerated {
        let entry = merged.get(term.source.as_str());
        if entry.is_none_or(|current| term.priority() > current.priority()) {
            merged.insert(term.source.as_str(), term.clone());
        }
    }
    merged.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_source() -> SourceContext {
        SourceContext {
            fingerprint: "1024:g1.0:g88.4:ab12cd".to_owned(),
            reference_fingerprint: Some("ref-1".to_owned()),
            summary: "科技访谈，语域偏口语。".to_owned(),
            terms: vec![
                CanonicalTerm {
                    source: "BaoCut".to_owned(),
                    category: TermCategory::Product,
                    variants: vec!["宝卡特".to_owned(), "包卡".to_owned()],
                    note: "保持英文大小写".to_owned(),
                    locked: true,
                    origin: TermOrigin::User,
                },
                CanonicalTerm {
                    source: "KV cache".to_owned(),
                    category: TermCategory::Tech,
                    variants: Vec::new(),
                    note: "首次可译，后文统一".to_owned(),
                    locked: false,
                    origin: TermOrigin::Analyzed,
                },
            ],
        }
    }

    fn sample_target() -> TargetContext {
        TargetContext {
            target_lang: "zh".to_owned(),
            fingerprint: "1024:g1.0:g88.4:ab12cd".to_owned(),
            analysis_fingerprint: Some("an-1".to_owned()),
            instructions_fingerprint: Some("in-1".to_owned()),
            tone: Some(TranslationTone::Formal),
            summary: "整体讲增长与产品策略。".to_owned(),
            glossary: vec![BilingualTerm {
                source: "BaoCut".to_owned(),
                target: "BaoCut".to_owned(),
                note: "产品名保留英文".to_owned(),
                locked: true,
                origin: TermOrigin::User,
            }],
            style: "短句优先，避免翻译腔。".to_owned(),
            difficulties: vec!["双关语较多".to_owned(), "行业黑话".to_owned()],
        }
    }

    #[test]
    fn source_context_render_matches_spec_shape() {
        let rendered = render_source_context(&sample_source());
        assert!(rendered.starts_with("---\n"));
        assert!(rendered.contains("fingerprint: \"1024:g1.0:g88.4:ab12cd\"\n"));
        assert!(rendered.contains("# Summary\n科技访谈，语域偏口语。\n"));
        assert!(rendered.contains("| Source | Category | Variants | Note | Lock | Origin |\n"));
        assert!(
            rendered
                .contains("| BaoCut | product | 宝卡特, 包卡 | 保持英文大小写 | yes | user |\n")
        );
    }

    #[test]
    fn source_context_round_trips() {
        let context = sample_source();
        let rendered = render_source_context(&context);
        let parsed = parse_source_context(Some(&rendered), &rendered);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.context.unwrap(), context);
    }

    #[test]
    fn target_context_round_trips_all_brief_fields() {
        let context = sample_target();
        let rendered = render_target_context(&context);
        let parsed = parse_target_context(Some(&rendered), &rendered);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.context.unwrap(), context);
    }

    #[test]
    fn empty_tables_and_bodies_round_trip() {
        let context = SourceContext {
            fingerprint: "fp".to_owned(),
            reference_fingerprint: None,
            summary: String::new(),
            terms: Vec::new(),
        };
        let rendered = render_source_context(&context);
        let parsed = parse_source_context(Some(&rendered), &rendered);
        assert_eq!(parsed.context.unwrap(), context);
    }

    #[test]
    fn pipe_and_backslash_in_cells_survive() {
        let mut context = sample_source();
        context.terms[0].note = "含 | 竖线 与 \\ 反斜杠".to_owned();
        context.terms[0].source = "A|B".to_owned();
        let rendered = render_source_context(&context);
        let parsed = parse_source_context(Some(&rendered), &rendered);
        assert_eq!(parsed.context.unwrap(), context);
    }

    #[test]
    fn unknown_category_keeps_old_context() {
        let mut rendered = render_source_context(&sample_source());
        rendered = rendered.replace("| BaoCut | product |", "| BaoCut | brand |");
        let parsed = parse_source_context(None, &rendered);
        assert!(parsed.context.is_none(), "解析失败时绝不返回半张表");
        assert!(parsed.diagnostics.has_code(ProblemCode::ContextInvalid));
    }

    #[test]
    fn wrong_header_is_rejected() {
        let rendered = render_source_context(&sample_source())
            .replace("| Source | Category |", "| 来源 | 类别 |");
        let parsed = parse_source_context(None, &rendered);
        assert!(parsed.context.is_none());
        assert!(parsed.diagnostics.has_code(ProblemCode::ContextInvalid));
    }

    #[test]
    fn missing_frontmatter_is_rejected() {
        let parsed = parse_source_context(None, "# Summary\nhi\n");
        assert!(parsed.context.is_none());
        assert!(parsed.diagnostics.has_code(ProblemCode::ContextInvalid));
    }

    #[test]
    fn missing_terms_section_is_rejected() {
        let parsed = parse_source_context(None, "---\nfingerprint: \"a\"\n---\n\n# Summary\nhi\n");
        assert!(parsed.context.is_none());
        assert!(parsed.diagnostics.has_code(ProblemCode::ContextInvalid));
    }

    #[test]
    fn duplicate_term_source_is_rejected() {
        let rendered = render_source_context(&sample_source())
            .replace("| KV cache | tech |", "| BaoCut | tech |");
        let parsed = parse_source_context(None, &rendered);
        assert!(parsed.context.is_none());
        assert!(parsed.diagnostics.has_code(ProblemCode::DuplicateId));
    }

    #[test]
    fn locked_glossary_row_needs_target() {
        let rendered =
            render_target_context(&sample_target()).replace("| BaoCut | BaoCut |", "| BaoCut |  |");
        let parsed = parse_target_context(None, &rendered);
        assert!(parsed.context.is_none());
        assert!(parsed.diagnostics.has_code(ProblemCode::EmptyTranslation));
    }

    #[test]
    fn unlocked_glossary_row_may_await_translation() {
        let mut context = sample_target();
        context.glossary.push(BilingualTerm {
            source: "KV cache".to_owned(),
            target: String::new(),
            note: String::new(),
            locked: false,
            origin: TermOrigin::Analyzed,
        });
        let rendered = render_target_context(&context);
        let parsed = parse_target_context(Some(&rendered), &rendered);
        assert_eq!(parsed.context.unwrap(), context);
    }

    #[test]
    fn code_fence_wrapper_is_stripped() {
        let rendered = render_source_context(&sample_source());
        let wrapped = format!("```markdown\n{rendered}```\n");
        let parsed = parse_source_context(None, &wrapped);
        assert!(parsed.context.is_some());
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::WrapperStripped)
        );
    }

    #[test]
    fn control_characters_are_stripped() {
        let rendered = render_source_context(&sample_source()).replace("BaoCut", "Bao\u{202E}Cut");
        let parsed = parse_source_context(None, &rendered);
        let context = parsed.context.unwrap();
        assert_eq!(context.terms[0].source, "BaoCut");
    }

    #[test]
    fn oversized_document_is_rejected() {
        let rendered = render_source_context(&sample_source());
        let bloat =
            "啊".repeat(super::super::common::max_output_chars(rendered.chars().count()) + 1);
        let parsed = parse_source_context(Some(&rendered), &bloat);
        assert!(parsed.context.is_none());
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentOversize));
    }

    #[test]
    fn merge_keeps_user_rows_and_refreshes_analyzed() {
        let existing = sample_source().terms;
        let regenerated = vec![
            CanonicalTerm {
                source: "BaoCut".to_owned(),
                category: TermCategory::Other,
                variants: vec!["爆刻".to_owned()],
                note: "模型重写".to_owned(),
                locked: false,
                origin: TermOrigin::Analyzed,
            },
            CanonicalTerm {
                source: "KV cache".to_owned(),
                category: TermCategory::Tech,
                variants: vec!["KV 缓存".to_owned()],
                note: "更新说明".to_owned(),
                locked: false,
                origin: TermOrigin::Analyzed,
            },
        ];
        let merged = merge_canonical_terms(&existing, &regenerated);
        assert_eq!(merged.len(), 2);
        let baocut = merged.iter().find(|t| t.source == "BaoCut").unwrap();
        assert_eq!(baocut.origin, TermOrigin::User);
        assert_eq!(baocut.note, "保持英文大小写");
        let kv = merged.iter().find(|t| t.source == "KV cache").unwrap();
        assert_eq!(kv.variants, vec!["KV 缓存".to_owned()]);
    }

    // --- ParseMode::Model（重试策略重设计 §2.1 的 R2 代码先修）---

    /// Model 模式的最小可用文档（表头齐全，行随调用者给）。
    fn model_doc(rows: &str) -> String {
        format!(
            "---\nformat: \"context-doc/1\"\nfingerprint: \"\"\n---\n# Summary\n一段摘要。\n\n\
             # Canonical Terms\n| Source | Category | Variants | Note | Lock | Origin |\n\
             |---|---|---|---|---|---|\n{rows}"
        )
    }

    /// 实测最高频的失败：同一 Source 在一页里重复 6–11 行。旧解析整页拒并
    /// 重试三轮；现在合并成一行（Variants 并集、Note 取最长）并只记 Warning。
    #[test]
    fn model_mode_merges_duplicate_sources_instead_of_rejecting() {
        let rows = "| ResNeXt | tech | res next | | no | analyzed |\n\
                    | resnext | proper | resnet x | 更长的备注说明 | no | analyzed |\n\
                    | Res-NeXt | tech | | | no | analyzed |\n\
                    | DiT | tech | dit | | no | analyzed |\n";
        let parsed = parse_model_source_context(None, &model_doc(rows));
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        let context = parsed.context.expect("model mode accepts duplicates");
        assert_eq!(context.terms.len(), 2);
        assert_eq!(context.terms[0].source, "ResNeXt");
        // Category 取先见，Note 取最长，Variants 取并集。
        assert_eq!(context.terms[0].category, TermCategory::Tech);
        assert_eq!(context.terms[0].note, "更长的备注说明");
        assert_eq!(
            context.terms[0].variants,
            vec!["res next".to_owned(), "resnet x".to_owned()]
        );
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::DuplicateId)
        );
        // 严格模式（用户手写文档）仍然整份判败——那里的重复是真的冲突。
        let strict = parse_source_context(
            None,
            &model_doc(
                "| ResNeXt | tech | | | no | analyzed |\n\
                 | ResNeXt | tech | | | no | analyzed |\n",
            ),
        );
        assert!(strict.context.is_none());
        assert!(strict.diagnostics.has_code(ProblemCode::DuplicateId));
    }

    /// 列数错乱、未知 Category、非法 Lock/Origin：全部代码修复，不拒页。
    #[test]
    fn model_mode_repairs_row_shape_and_illegal_values() {
        let rows = "| BaoCut | brand | bao cut | 备注 | 也许 | 模型自封 |\n\
                    | KV cache | tech |\n\
                    | ResNeXt | tech | res next | 前半 | 后半 | 再来 | no | analyzed |\n\
                    | 只有一列 |\n";
        let parsed = parse_model_source_context(None, &model_doc(rows));
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        let context = parsed.context.expect("model mode repairs rows");
        assert_eq!(context.terms.len(), 3);
        // 未知 Category → other；Lock/Origin 非法 → 降级（模型行本就要降级）。
        assert_eq!(context.terms[0].category, TermCategory::Other);
        assert!(!context.terms[0].locked);
        assert_eq!(context.terms[0].origin, TermOrigin::Analyzed);
        // 少列按默认补齐。
        assert_eq!(context.terms[1].source, "KV cache");
        assert!(context.terms[1].note.is_empty());
        // 多列把中间部分并回 Note。
        assert_eq!(context.terms[2].note, "前半 | 后半 | 再来");
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::RowRepaired)
        );
    }

    /// 垃圾行确定性过滤：单个 CJK 字、纯标点、纯数字、应答语气词。
    #[test]
    fn model_mode_drops_junk_term_rows() {
        let rows = "| 嗯 | other | | | no | analyzed |\n\
                    | 好的 | other | | | no | analyzed |\n\
                    | 的 | other | | | no | analyzed |\n\
                    | ！！！ | other | | | no | analyzed |\n\
                    | 2024 | other | | | no | analyzed |\n\
                    | yeah | other | | | no | analyzed |\n\
                    | 论文集 | other | | | no | analyzed |\n\
                    | BaoCut | product | | | no | analyzed |\n";
        let parsed = parse_model_source_context(None, &model_doc(rows));
        let context = parsed.context.expect("junk rows are dropped, not fatal");
        assert_eq!(
            context
                .terms
                .iter()
                .map(|term| term.source.as_str())
                .collect::<Vec<_>>(),
            vec!["论文集", "BaoCut"],
            "只有单字/纯标点/纯数字/应答词被丢弃"
        );
        assert!(is_junk_term_source("嗯"));
        assert!(is_junk_term_source("OK"));
        assert!(!is_junk_term_source("BaoCut"));
        assert!(!is_junk_term_source("KV cache"));
    }

    /// 表头放宽（trim + 大小写不敏感 + 只认首格）、缺 frontmatter 仍接受。
    #[test]
    fn model_mode_relaxes_header_and_frontmatter() {
        let text = "## Canonical Terms\n| source | CATEGORY | variants | note | lock | origin |\n\
                    |---|---|---|---|---|---|\n\
                    | BaoCut | product | bao cut | | no | analyzed |\n";
        let parsed = parse_model_source_context(None, text);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        let context = parsed.context.expect("relaxed header is accepted");
        assert_eq!(context.terms.len(), 1);
        assert_eq!(context.terms[0].source, "BaoCut");
        // 严格模式仍然要求逐字表头与 frontmatter。
        assert!(parse_source_context(None, text).context.is_none());
    }

    /// 单页行数上限：截断 + 计数警告，绝不拒页（实测 flash 交回 500–1000 行）。
    #[test]
    fn model_mode_truncates_oversized_term_tables() {
        let rows: String = (0..1000)
            .map(|index| format!("| Term{index:04} | tech | | | no | analyzed |\n"))
            .collect();
        let parsed = parse_model_source_context(None, &model_doc(&rows));
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        let context = parsed.context.expect("1000-row table is truncated");
        assert_eq!(context.terms.len(), ANALYSIS_MAX_TERMS_PER_PAGE);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::ContentIgnored
                    && warning.detail.contains("850"))
        );
    }

    /// page-fatal 只剩两种：超硬顶、既无术语表小节也无任何表格行。
    #[test]
    fn model_mode_page_fatal_is_only_shape_free_or_over_cap() {
        let parsed = parse_model_source_context(None, "完全不是一份文档");
        assert!(parsed.context.is_none());
        assert!(parsed.diagnostics.has_code(ProblemCode::ContextInvalid));

        // 没有小节标题但有表格行 ⇒ 仍然接受。
        let loose = "| Source | Category | Variants | Note | Lock | Origin |\n\
                     |---|---|---|---|---|---|\n\
                     | BaoCut | product | | | no | analyzed |\n";
        let parsed = parse_model_source_context(None, loose);
        assert_eq!(
            parsed
                .context
                .expect("stray table is recoverable")
                .terms
                .len(),
            1
        );

        // 超硬顶（8× 输入）仍然 page-fatal。
        let rendered = render_source_context(&sample_source());
        let bloat =
            "啊".repeat(super::super::common::max_output_chars(rendered.chars().count()) + 1);
        let parsed = parse_model_source_context(Some(&rendered), &bloat);
        assert!(parsed.context.is_none());
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentOversize));
    }

    /// 目标语文档的 Model 模式：锁定行缺 Target 不再拒页（模型行随后被降级），
    /// 重复 Source 合并。
    #[test]
    fn model_mode_target_context_is_lenient() {
        let text = "---\ntargetLang: \"zh-Hans\"\n---\n# Translated Summary\n摘要\n\n\
                    # Bilingual Glossary\n| Source | Target | Note | Lock | Origin |\n\
                    |---|---|---|---|---|\n\
                    | BaoCut |  | | yes | user |\n\
                    | BaoCut | 宝剪 | 补上的备注 | yes | user |\n";
        let parsed = parse_model_target_context(None, text);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        let context = parsed.context.expect("model mode accepts the glossary");
        assert_eq!(context.glossary.len(), 1);
        assert_eq!(context.glossary[0].target, "宝剪");
        assert_eq!(context.glossary[0].note, "补上的备注");
        assert!(!context.glossary[0].locked);
        assert_eq!(context.glossary[0].origin, TermOrigin::Analyzed);
        // 严格模式仍然拒（用户手写文档里的锁定行必须有 Target）。
        assert!(parse_target_context(None, text).context.is_none());
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
    fn property_source_context_round_trip_is_identity() {
        const CELLS: &[&str] = &[
            "BaoCut",
            "你好世界",
            "mixed 中英",
            "with | pipe",
            "with \\ slash",
            "quote \" and '",
            "",
        ];
        const CATEGORIES: [TermCategory; 5] = [
            TermCategory::Product,
            TermCategory::Person,
            TermCategory::Tech,
            TermCategory::Proper,
            TermCategory::Other,
        ];
        let mut rng = Lcg(0xc0ffee);
        for round in 0..200 {
            let count = (rng.next() as usize) % 5;
            let mut terms = Vec::new();
            for index in 0..count {
                terms.push(CanonicalTerm {
                    source: format!("{}-{index}", rng.pick(CELLS)),
                    category: CATEGORIES[(rng.next() as usize) % CATEGORIES.len()],
                    variants: (0..(rng.next() as usize) % 3)
                        .map(|_| rng.pick(CELLS).to_owned())
                        .filter(|v: &String| !v.is_empty())
                        .collect(),
                    note: rng.pick(CELLS).to_owned(),
                    locked: rng.next().is_multiple_of(2),
                    origin: if rng.next().is_multiple_of(2) {
                        TermOrigin::User
                    } else {
                        TermOrigin::Analyzed
                    },
                });
            }
            let context = SourceContext {
                fingerprint: format!("fp-{round}"),
                reference_fingerprint: if rng.next().is_multiple_of(2) {
                    Some(format!("ref-{round}"))
                } else {
                    None
                },
                summary: rng.pick(CELLS).to_owned(),
                terms,
            };
            let rendered = render_source_context(&context);
            let parsed = parse_source_context(Some(&rendered), &rendered);
            assert!(
                !parsed.diagnostics.has_problems(),
                "{:?}",
                parsed.diagnostics
            );
            assert_eq!(parsed.context.unwrap(), context);
        }
    }

    #[test]
    fn property_parse_never_panics_on_hostile_input() {
        const CHARS: &[char] = &[
            '-', '|', '\\', '"', '#', ':', '\n', ' ', 'a', '你', '\u{0000}', '\u{202E}', '`', '{',
            '}', 'S', 'o', 'u', 'r', 'c', 'e',
        ];
        let mut rng = Lcg(0xfeed_face);
        for _ in 0..500 {
            let len = (rng.next() as usize) % 200;
            let text: String = (0..len)
                .map(|_| CHARS[(rng.next() as usize) % CHARS.len()])
                .collect();
            let _ = parse_source_context(None, &text);
            let _ = parse_target_context(None, &text);
        }
    }
}
