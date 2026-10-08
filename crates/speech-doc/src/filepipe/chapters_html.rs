//! 分章节载体（file-v1）：`chapters-source/1`（页输入）、`chapters-outline/1`
//! （Reduce 输入）与两者共用的输出解析。
//!
//! 输入是段落级 HTML（`<p id data-at>全文</p>`），输出只写代码推不出的东西：
//!
//! ```html
//! <h2>章节标题</h2>
//! <p class="summary">一句话概要</p>
//! <p id="p-g1203.0">该段开头十几个字…</p>
//! ```
//!
//! 解析按「标题 → 概要 → 首段锚」的顺序状态机走，标签名不进协议：h1–h6 或
//! `class="title"` 视为标题；带 `id` 的元素视为锚；标题与锚之间的无 id 文本块
//! 视为概要。锚 id 由模型抄写，`p-g1203.0` 抄成 `p-g1230.0` 是最常见的静默
//! 丢章，因此锚上的开头片段是 id 的兜底：id 未知但片段能唯一命中某段开头即
//! 按片段修复（`anchor-repaired` 诊断），都命不中才丢行（`unknown-id`）。
//! 章节 `end` 由下一章 `start` 确定性回填，尾锚不进协议、多余的锚一律忽略。

use std::collections::BTreeMap;

use super::common::{
    Diagnostics, Problem, ProblemCode, Warning, WarningCode, normalize_llm_output,
    sanitize_inline_text,
};
use super::html::{Element, Node, escape_attr, escape_text, normalize_html_text, parse_html};

/// 页输入载体的 `data-bcut-format` 值。
pub const CHAPTERS_SOURCE_FORMAT: &str = "chapters-source/1";
/// Reduce（全局大纲）输入载体的 `data-bcut-format` 值。
pub const CHAPTERS_OUTLINE_FORMAT: &str = "chapters-outline/1";

/// 首段片段长度（字符）：既要能唯一定位段落开头，又不能诱导模型抄整段。
pub const SNIPPET_CHARS: usize = 40;
/// 片段修复 / 校验时参与比较的最少字符数；片段短于此不做修复。
const SNIPPET_MATCH_MIN_CHARS: usize = 4;
/// 片段比较最多取前多少个归一化字符（模型常在片段末尾自行截断或加省略号）。
const SNIPPET_MATCH_MAX_CHARS: usize = 16;

/// 一个可作为章节起点的锚：段落（Map 页）或话题单元（Reduce 大纲）。
#[derive(Debug, Clone, PartialEq)]
pub struct ChapterAnchor {
    /// 段 id（`p-<首词id>`）。
    pub id: String,
    /// 起始秒（相对媒体起点）。
    pub start: f64,
    /// 段落全文（页输入）或开头片段（大纲输入）。
    pub text: String,
}

/// 一页 Map 输入。
#[derive(Debug, Clone)]
pub struct ChaptersPageInput<'a> {
    /// 0 基页序。
    pub part_index: usize,
    /// 总页数。
    pub part_count: usize,
    /// 本页段落（全文）。
    pub segments: &'a [ChapterAnchor],
    /// 本页时间范围（起始秒, 结束秒）。
    pub range: (f64, f64),
    /// 媒体总时长（秒）。
    pub total_duration: f64,
    /// 本页期望的话题单元数（进 `data-aim`；契约文件按 kind 唯一，页级差异只能进载体）。
    pub aim: usize,
    /// 转录语言（进根节点 `lang`，标题/概要默认用它）。
    pub lang: &'a str,
    /// 项目词指纹（审计锚点，不参与协议）。
    pub project_fingerprint: &'a str,
}

/// Reduce 大纲里的一个话题单元（Map 阶段的产出）。
#[derive(Debug, Clone, PartialEq)]
pub struct OutlineUnit {
    /// 锚：id + 起始秒 + 开头片段。
    pub anchor: ChapterAnchor,
    /// 单元标题；`None` 表示该页 Map 失败后的占位单元（无标题、无概要）。
    pub title: Option<String>,
    /// 单元概要。
    pub summary: Option<String>,
    /// 来自第几页（0 基）；相邻单元页序不同处渲染页缝标记。
    pub part_index: usize,
}

/// 解析出的一行章节。
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedChapterRow {
    /// 标题（已归一化空白，非空）。
    pub title: String,
    /// 解析/修复后的锚 id，必然存在于输入锚集合。
    pub anchor_id: String,
    /// 概要（可缺）。
    pub summary: Option<String>,
    /// 锚 id 是否经片段修复得到。
    pub repaired: bool,
}

/// 一次输出解析的结果。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChaptersParsed {
    /// 按文档顺序保留的章节行（未按时间排序、未去重——由引擎的确定性清洗负责）。
    pub rows: Vec<ParsedChapterRow>,
    /// 诊断。
    pub diagnostics: Diagnostics,
}

/// mm:ss，过小时 HH:mm:ss（对拍 voice-ink `fmtTime`，秒向下取整）。
pub fn fmt_clock(time: f64) -> String {
    let seconds = time.max(0.0) as u64;
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let remainder = seconds % 60;
    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{remainder:02}")
    } else {
        format!("{minutes:02}:{remainder:02}")
    }
}

/// 段落开头片段：前 [`SNIPPET_CHARS`] 个字符（单行归一化后），截断处加省略号。
pub fn snippet(text: &str) -> String {
    let cleaned = sanitize_inline_text(text);
    let mut chars = cleaned.chars();
    let head: String = chars.by_ref().take(SNIPPET_CHARS).collect();
    if chars.next().is_some() {
        format!("{}…", head.trim_end())
    } else {
        head
    }
}

/// 渲染一页 Map 输入。
pub fn render_chapters_source(input: &ChaptersPageInput<'_>) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "<article lang=\"{}\" data-bcut-format=\"{}\" data-part=\"{}/{}\" data-range=\"{}–{}\" data-total=\"{}\" data-aim=\"{}\" data-project-fp=\"{}\">\n",
        escape_attr(input.lang),
        escape_attr(CHAPTERS_SOURCE_FORMAT),
        input.part_index + 1,
        input.part_count.max(1),
        fmt_clock(input.range.0),
        fmt_clock(input.range.1),
        fmt_clock(input.total_duration),
        input.aim.max(1),
        escape_attr(input.project_fingerprint),
    ));
    for segment in input.segments {
        out.push_str(&format!(
            "  <p id=\"{}\" data-at=\"{}\">{}</p>\n",
            escape_attr(&segment.id),
            fmt_clock(segment.start),
            escape_text(&sanitize_inline_text(&segment.text)),
        ));
    }
    out.push_str("</article>\n");
    out
}

/// 渲染 Reduce 大纲输入：Map 各页的话题单元按序拼接，页缝处插 `<hr data-seam>`。
pub fn render_chapters_outline(
    units: &[OutlineUnit],
    part_count: usize,
    total_duration: f64,
    aim: usize,
    lang: &str,
    project_fingerprint: &str,
) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "<article lang=\"{}\" data-bcut-format=\"{}\" data-parts=\"{}\" data-units=\"{}\" data-total=\"{}\" data-aim=\"{}\" data-project-fp=\"{}\">\n",
        escape_attr(lang),
        escape_attr(CHAPTERS_OUTLINE_FORMAT),
        part_count.max(1),
        units.len(),
        fmt_clock(total_duration),
        aim.max(1),
        escape_attr(project_fingerprint),
    ));
    let mut previous_part: Option<usize> = None;
    for unit in units {
        if let Some(previous) = previous_part
            && previous != unit.part_index
        {
            out.push_str(&format!(
                "  <hr data-seam=\"{}|{}\">\n",
                previous + 1,
                unit.part_index + 1
            ));
        }
        previous_part = Some(unit.part_index);
        match &unit.title {
            Some(title) => out.push_str(&format!(
                "  <h2 data-at=\"{}\">{}</h2>\n",
                fmt_clock(unit.anchor.start),
                escape_text(&sanitize_inline_text(title)),
            )),
            None => out.push_str(&format!(
                "  <h2 data-at=\"{}\" data-untitled=\"true\"></h2>\n",
                fmt_clock(unit.anchor.start),
            )),
        }
        let summary = match (&unit.title, &unit.summary) {
            (_, Some(summary)) if !summary.trim().is_empty() => Some(summary.clone()),
            (None, _) => Some(format!(
                "No summary available for this part (from {}) — title it from context or merge it into a neighbour.",
                fmt_clock(unit.anchor.start)
            )),
            _ => None,
        };
        if let Some(summary) = summary {
            out.push_str(&format!(
                "  <p class=\"summary\">{}</p>\n",
                escape_text(&sanitize_inline_text(&summary))
            ));
        }
        out.push_str(&format!(
            "  <p id=\"{}\">{}</p>\n",
            escape_attr(&unit.anchor.id),
            escape_text(&sanitize_inline_text(&unit.anchor.text)),
        ));
    }
    out.push_str("</article>\n");
    out
}

/// 从输入载体（页或大纲）反解锚集合：所有带 `id` 的 `<p>`，`data-at` 有则取起始秒。
///
/// agent 提交期 lint 只有载荷没有文档，靠这个函数拿到与引擎同一份锚集合。
pub fn parse_chapters_source(input: &str) -> Option<Vec<ChapterAnchor>> {
    let tree = parse_html(input);
    let format = tree
        .elements_with_attr("data-bcut-format")
        .into_iter()
        .find_map(|element| element.attr("data-bcut-format"))?;
    if format != CHAPTERS_SOURCE_FORMAT && format != CHAPTERS_OUTLINE_FORMAT {
        return None;
    }
    let anchors = tree
        .elements()
        .into_iter()
        .filter_map(|element| {
            let id = element.id()?;
            (!id.is_empty()).then(|| ChapterAnchor {
                id: id.to_owned(),
                start: element.attr("data-at").and_then(parse_clock).unwrap_or(0.0),
                text: element.text(),
            })
        })
        .collect::<Vec<_>>();
    (!anchors.is_empty()).then_some(anchors)
}

/// 大纲载荷（`chapters-outline/1`）的行数上限：按根节点 `data-aim` 推；页载荷不设上限。
pub fn outline_row_limit(payload: &str) -> Option<usize> {
    let tree = parse_html(payload);
    let root = tree
        .elements_with_attr("data-bcut-format")
        .into_iter()
        .find(|element| element.attr("data-bcut-format") == Some(CHAPTERS_OUTLINE_FORMAT))?;
    root.attr("data-aim")?
        .trim()
        .parse::<usize>()
        .ok()
        .map(max_rows_for_aim)
}

fn parse_clock(text: &str) -> Option<f64> {
    let parts = text
        .trim()
        .split(':')
        .map(|part| part.parse::<u64>().ok())
        .collect::<Option<Vec<_>>>()?;
    match parts.as_slice() {
        [minutes, seconds] => Some((minutes * 60 + seconds) as f64),
        [hours, minutes, seconds] => Some((hours * 3600 + minutes * 60 + seconds) as f64),
        _ => None,
    }
}

/// 中间表示：把 DOM 拍平成「标题 / 锚 / 文本」三种块。
#[derive(Debug)]
enum Block {
    Heading { title: String, id: Option<String> },
    Anchor { id: String, text: String },
    Text(String),
}

fn is_heading(element: &Element) -> bool {
    matches!(
        element.tag.as_str(),
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
    ) || element.has_class("title")
}

fn contains_heading(element: &Element) -> bool {
    element.descendants().into_iter().any(is_heading)
}

fn flatten(nodes: &[Node], out: &mut Vec<Block>) {
    for node in nodes {
        match node {
            Node::Text(text) => {
                let text = normalize_html_text(text);
                if !text.is_empty() {
                    out.push(Block::Text(text));
                }
            }
            Node::Element(element) => {
                if is_heading(element) {
                    out.push(Block::Heading {
                        title: element.text(),
                        id: element.id().filter(|id| !id.is_empty()).map(str::to_owned),
                    });
                } else if let Some(id) = element.id().filter(|id| !id.is_empty()) {
                    if contains_heading(element) {
                        // `<section id="p-…"><h2>…</h2>…</section>`：容器写法。先展开
                        // 内容，再把容器 id 作为锚补在后面（行里已有锚时被忽略）。
                        flatten(&element.children, out);
                        out.push(Block::Anchor {
                            id: id.to_owned(),
                            text: String::new(),
                        });
                    } else {
                        out.push(Block::Anchor {
                            id: id.to_owned(),
                            text: element.text(),
                        });
                    }
                } else if element.has_class("summary") || element.child_elements().is_empty() {
                    let text = element.text();
                    if !text.is_empty() {
                        out.push(Block::Text(text));
                    }
                } else {
                    flatten(&element.children, out);
                }
            }
        }
    }
}

/// 归一化片段用于比较：单行归一化 → 去尾部省略号 → 去全部空白 → 小写。
fn normalize_snippet(text: &str) -> String {
    let normalized = normalize_html_text(text);
    let trimmed = normalized.trim_end_matches(['…', '.', ' ']);
    trimmed
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn snippet_head(text: &str) -> String {
    normalize_snippet(text)
        .chars()
        .take(SNIPPET_MATCH_MAX_CHARS)
        .collect()
}

/// 片段是否命中某段开头。
fn snippet_matches(anchor_text: &str, snippet: &str) -> bool {
    let head = snippet_head(snippet);
    if head.chars().count() < SNIPPET_MATCH_MIN_CHARS {
        return false;
    }
    normalize_snippet(anchor_text).starts_with(&head)
}

struct Draft {
    title: String,
    anchor: Option<(String, String)>,
    summary: Option<String>,
}

/// 章节数上限护栏（Reduce）：允许超出 `aim` 两成或 2 章（取大者）。
pub fn max_rows_for_aim(aim: usize) -> usize {
    aim + (aim / 5).max(2)
}

/// 解析模型输出（Map 页或 Reduce 大纲共用），`anchors` 是本次调用允许的锚集合。
pub fn parse_chapters_output(anchors: &[ChapterAnchor], raw: &str) -> ChaptersParsed {
    parse_chapters_output_with_limit(anchors, raw, None)
}

/// 同 [`parse_chapters_output`]，另可给出行数上限：超出即 `chapter-overflow`
/// 问题（Reduce 只照抄大纲、不合并时触发重试；行本身仍全部保留供降级采用）。
pub fn parse_chapters_output_with_limit(
    anchors: &[ChapterAnchor],
    raw: &str,
    max_rows: Option<usize>,
) -> ChaptersParsed {
    let mut parsed = ChaptersParsed::default();
    let normalized = normalize_llm_output(raw);
    for warning in normalized.warnings() {
        parsed.diagnostics.push_warning(warning);
    }
    let tree = parse_html(&normalized.text);
    for warning in tree.warnings() {
        parsed.diagnostics.push_warning(warning);
    }
    let mut blocks = Vec::new();
    flatten(&tree.roots, &mut blocks);

    let by_id: BTreeMap<&str, &ChapterAnchor> = anchors
        .iter()
        .map(|anchor| (anchor.id.as_str(), anchor))
        .collect();

    let mut drafts: Vec<Draft> = Vec::new();
    let mut current: Option<Draft> = None;
    let mut ignored_anchors = 0usize;
    let mut stray_anchors = 0usize;
    for block in blocks {
        match block {
            Block::Heading { title, id } => {
                if let Some(draft) = current.take() {
                    drafts.push(draft);
                }
                current = Some(Draft {
                    title,
                    anchor: id.map(|id| (id, String::new())),
                    summary: None,
                });
            }
            Block::Anchor { id, text } => match current.as_mut() {
                Some(draft) if draft.anchor.is_none() => draft.anchor = Some((id, text)),
                Some(_) => ignored_anchors += 1,
                None => stray_anchors += 1,
            },
            Block::Text(text) => {
                if let Some(draft) = current.as_mut()
                    && draft.anchor.is_none()
                    && draft.summary.is_none()
                {
                    draft.summary = Some(text);
                }
            }
        }
    }
    if let Some(draft) = current.take() {
        drafts.push(draft);
    }
    if ignored_anchors > 0 {
        parsed.diagnostics.push_warning(Warning::document(
            WarningCode::ContentIgnored,
            format!("忽略了 {ignored_anchors} 个多余锚（每章只取标题后的首个锚）"),
        ));
    }
    if stray_anchors > 0 {
        parsed.diagnostics.push_warning(Warning::document(
            WarningCode::ContentIgnored,
            format!("忽略了 {stray_anchors} 个没有标题的锚"),
        ));
    }

    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for draft in drafts {
        let title = normalize_html_text(&draft.title);
        let Some((raw_id, snippet_text)) = draft.anchor else {
            parsed.diagnostics.push_problem(Problem::document(
                ProblemCode::MissingId,
                format!("heading `{title}` has no anchored paragraph — add `<p id=\"…\">` copied from the input right after it"),
            ));
            continue;
        };
        let raw_id = raw_id.trim().to_owned();
        let (anchor_id, repaired) = if let Some(anchor) = by_id.get(raw_id.as_str()) {
            if !snippet_text.is_empty() && !snippet_matches(&anchor.text, &snippet_text) {
                parsed.diagnostics.push_warning(Warning::sentence(
                    WarningCode::AnchorTextMismatch,
                    raw_id.clone(),
                    "锚上的开头片段与该段实际开头不符，以 id 为准",
                ));
            }
            (raw_id.clone(), false)
        } else {
            let candidates = anchors
                .iter()
                .filter(|anchor| snippet_matches(&anchor.text, &snippet_text))
                .collect::<Vec<_>>();
            match candidates.as_slice() {
                [anchor] => {
                    parsed.diagnostics.push_warning(Warning::sentence(
                        WarningCode::AnchorRepaired,
                        anchor.id.clone(),
                        format!("模型写的锚 id `{raw_id}` 不存在，已按开头片段修复"),
                    ));
                    (anchor.id.clone(), true)
                }
                // 不可修复的锚：**丢该行**并记 Warning（重试策略重设计 §2.4）。
                // 其余章节行完全可用，为一行幻觉锚重掷整页只是烧 token；剩余
                // 0 行才在下面判 page-fatal。
                _ => {
                    parsed.diagnostics.push_warning(Warning::sentence(
                        WarningCode::ContentIgnored,
                        raw_id.clone(),
                        format!(
                            "anchor id `{raw_id}` does not exist in the input (heading `{title}`), row dropped"
                        ),
                    ));
                    continue;
                }
            }
        };
        // 空标题同样是行级丢弃（§2.4）：一个没写标题的章节不该拖累整页。
        if title.is_empty() {
            parsed.diagnostics.push_warning(Warning::sentence(
                WarningCode::ContentIgnored,
                anchor_id.clone(),
                "chapter heading is empty, row dropped",
            ));
            continue;
        }
        if let Some(previous) = seen.get(&anchor_id) {
            parsed.diagnostics.push_warning(Warning::sentence(
                WarningCode::ContentIgnored,
                anchor_id.clone(),
                format!("同一锚出现多次，保留第 {} 行的标题", previous + 1),
            ));
            continue;
        }
        seen.insert(anchor_id.clone(), parsed.rows.len());
        parsed.rows.push(ParsedChapterRow {
            title,
            anchor_id,
            summary: draft
                .summary
                .map(|summary| normalize_html_text(&summary))
                .filter(|summary| !summary.is_empty()),
            repaired,
        });
    }
    if parsed.rows.is_empty() {
        parsed.diagnostics.push_problem(Problem::document(
            ProblemCode::MissingId,
            "no chapter rows — write one `<h2>title</h2>` followed by `<p id=\"…\">opening words</p>` per chapter, ids copied from the input",
        ));
    } else if let Some(limit) = max_rows
        && parsed.rows.len() > limit
    {
        parsed.diagnostics.push_problem(Problem::document(
            ProblemCode::ChapterOverflow,
            format!(
                "{} chapters is far more than data-aim allows (at most {limit}) — merge consecutive units that belong to one topic into broader chapters instead of copying the outline",
                parsed.rows.len()
            ),
        ));
    }
    parsed
}

/// agent 提交期 lint：与引擎共用同一份解析器（载荷 = 页/大纲输入，答案 = 模型输出）。
pub fn lint_chapters_answer(payload: &str, answer: &str) -> Vec<String> {
    let Some(anchors) = parse_chapters_source(payload) else {
        return Vec::new();
    };
    parse_chapters_output_with_limit(&anchors, answer, outline_row_limit(payload))
        .diagnostics
        .problems
        .iter()
        .map(Problem::message)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchors() -> Vec<ChapterAnchor> {
        vec![
            ChapterAnchor {
                id: "p-g1.0".to_owned(),
                start: 0.0,
                text: "大家好，欢迎收听今天的节目，我们先聊聊开场。".to_owned(),
            },
            ChapterAnchor {
                id: "p-g20.0".to_owned(),
                start: 130.0,
                text: "接下来说说拒绝 OpenAI 的那段往事。".to_owned(),
            },
            ChapterAnchor {
                id: "p-g40.0".to_owned(),
                start: 400.0,
                text: "Now let's talk about New York and the city impression.".to_owned(),
            },
        ]
    }

    #[test]
    fn source_render_roundtrips_anchors() {
        let anchors = anchors();
        let input = ChaptersPageInput {
            part_index: 2,
            part_count: 9,
            segments: &anchors,
            range: (4324.0, 6510.0),
            total_duration: 24277.0,
            aim: 10,
            lang: "zh",
            project_fingerprint: "fp",
        };
        let html = render_chapters_source(&input);
        assert!(html.contains("<article lang=\"zh\""));
        assert!(html.contains("data-part=\"3/9\""));
        assert!(html.contains("data-aim=\"10\""));
        assert!(html.contains("data-range=\"01:12:04–01:48:30\""));
        assert!(html.contains("data-total=\"06:44:37\""));
        assert!(html.contains(
            "<p id=\"p-g20.0\" data-at=\"02:10\">接下来说说拒绝 OpenAI 的那段往事。</p>"
        ));
        let parsed = parse_chapters_source(&html).unwrap();
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[1].id, "p-g20.0");
        assert_eq!(parsed[1].start, 130.0);
        assert_eq!(parsed[2].text, anchors[2].text);
        assert!(parse_chapters_source("<article><p id=\"x\">y</p></article>").is_none());
    }

    #[test]
    fn outline_render_marks_seams_and_untitled_units() {
        let units = vec![
            OutlineUnit {
                anchor: ChapterAnchor {
                    id: "p-g1.0".to_owned(),
                    start: 0.0,
                    text: "大家好…".to_owned(),
                },
                title: Some("开场".to_owned()),
                summary: Some("主持人开场".to_owned()),
                part_index: 0,
            },
            OutlineUnit {
                anchor: ChapterAnchor {
                    id: "p-g40.0".to_owned(),
                    start: 400.0,
                    text: "Now let's…".to_owned(),
                },
                title: None,
                summary: None,
                part_index: 1,
            },
        ];
        let html = render_chapters_outline(&units, 2, 900.0, 3, "en", "fp");
        assert!(html.contains("data-aim=\"3\""));
        assert!(html.contains("data-units=\"2\""));
        assert_eq!(outline_row_limit(&html), Some(5));
        assert!(html.contains("data-bcut-format=\"chapters-outline/1\""));
        assert!(html.contains("<hr data-seam=\"1|2\">"));
        assert!(html.contains("<h2 data-at=\"00:00\">开场</h2>"));
        assert!(html.contains("<p class=\"summary\">主持人开场</p>"));
        assert!(html.contains("<h2 data-at=\"06:40\" data-untitled=\"true\"></h2>"));
        assert!(html.contains("No summary available"));
        let parsed = parse_chapters_source(&html).unwrap();
        assert_eq!(
            parsed.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["p-g1.0", "p-g40.0"]
        );
    }

    #[test]
    fn output_parse_extracts_title_summary_and_anchor() {
        let raw = "<h2>开场</h2>\n<p class=\"summary\">主持人开场白</p>\n<p id=\"p-g1.0\">大家好，欢迎收听</p>\n<h2>纽约印象</h2>\n<p id=\"p-g40.0\">Now let's talk about New York</p>";
        let parsed = parse_chapters_output(&anchors(), raw);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.rows.len(), 2);
        assert_eq!(parsed.rows[0].title, "开场");
        assert_eq!(parsed.rows[0].summary.as_deref(), Some("主持人开场白"));
        assert_eq!(parsed.rows[0].anchor_id, "p-g1.0");
        assert_eq!(parsed.rows[1].anchor_id, "p-g40.0");
        assert!(parsed.rows[1].summary.is_none());
    }

    #[test]
    fn output_parse_tolerates_fences_sections_and_tag_variants() {
        let raw = concat!(
            "```html\n",
            "<article>\n",
            "<section id=\"p-g1.0\"><h3>开场</h3><div>主持人开场</div></section>\n",
            "<section><h2 id=\"p-g20.0\">往事</h2></section>\n",
            "<div class=\"title\">纽约</div><summary>城市</summary><span id=\"p-g40.0\">Now let's talk</span>\n",
            "</article>\n",
            "```"
        );
        let parsed = parse_chapters_output(&anchors(), raw);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        let ids: Vec<&str> = parsed
            .rows
            .iter()
            .map(|row| row.anchor_id.as_str())
            .collect();
        assert_eq!(ids, ["p-g1.0", "p-g20.0", "p-g40.0"]);
        assert_eq!(parsed.rows[0].summary.as_deref(), Some("主持人开场"));
        assert_eq!(parsed.rows[2].summary.as_deref(), Some("城市"));
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::WrapperStripped)
        );
    }

    #[test]
    fn output_parse_repairs_mangled_ids_by_snippet() {
        let raw = "<h2>往事</h2><p id=\"p-g2.0\">接下来说说拒绝 OpenAI…</p><h2>纽约</h2><p id=\"p-nope\">Now let's talk about New York</p>";
        let parsed = parse_chapters_output(&anchors(), raw);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.rows[0].anchor_id, "p-g20.0");
        assert!(parsed.rows[0].repaired);
        assert_eq!(parsed.rows[1].anchor_id, "p-g40.0");
        assert_eq!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .filter(|w| w.code == WarningCode::AnchorRepaired)
                .count(),
            2
        );
    }

    #[test]
    /// §2.4：不可修复的锚与空标题都是**行级丢弃 + Warning**；只有「没有锚」
    /// 这种连行都拼不出来的形状仍是 problem（`missing-id`）。
    fn output_parse_drops_unknown_and_empty_rows_but_reports_missing_anchor() {
        let raw = "<h2>幽灵</h2><p id=\"p-ghost\">完全不存在的开头</p><h2></h2><p id=\"p-g1.0\">大家好</p><h2>没锚</h2><h2>正常</h2><p id=\"p-g40.0\">Now let's</p><p id=\"p-g20.0\">多余</p>";
        let parsed = parse_chapters_output(&anchors(), raw);
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.rows[0].title, "正常");
        assert_eq!(parsed.diagnostics.codes(), vec![ProblemCode::MissingId]);
        assert_eq!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .filter(|w| w.code == WarningCode::ContentIgnored)
                .count(),
            3,
            "幽灵锚、空标题、以及多余的 p 各记一条：{:?}",
            parsed.diagnostics.warnings
        );
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ContentIgnored)
        );
        // 片段与 id 不符：以 id 为准并留诊断。
        let mismatch = parse_chapters_output(
            &anchors(),
            "<h2>A</h2><p id=\"p-g1.0\">Now let's talk about</p>",
        );
        assert_eq!(mismatch.rows[0].anchor_id, "p-g1.0");
        assert!(
            mismatch
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::AnchorTextMismatch)
        );
        // 空输出：文档级 missing-id。
        let empty = parse_chapters_output(&anchors(), "Sure, here are the chapters.");
        assert!(empty.rows.is_empty());
        assert!(empty.diagnostics.has_code(ProblemCode::MissingId));
    }

    #[test]
    fn row_limit_flags_outline_copies() {
        let anchors = anchors();
        let raw = "<h2>一</h2><p id=\"p-g1.0\">大家好</p><h2>二</h2><p id=\"p-g20.0\">接下来</p><h2>三</h2><p id=\"p-g40.0\">Now let's</p>";
        assert!(
            !parse_chapters_output_with_limit(&anchors, raw, Some(3))
                .diagnostics
                .has_problems()
        );
        let over = parse_chapters_output_with_limit(&anchors, raw, Some(2));
        assert_eq!(over.rows.len(), 3, "行全部保留供降级采用");
        assert!(over.diagnostics.has_code(ProblemCode::ChapterOverflow));
        assert_eq!(max_rows_for_aim(81), 97);
        assert_eq!(max_rows_for_aim(3), 5);
        assert_eq!(
            outline_row_limit(
                "<article data-bcut-format=\"chapters-source/1\" data-aim=\"2\"></article>"
            ),
            None
        );
    }

    #[test]
    fn duplicate_anchor_keeps_first_row() {
        let raw = "<h2>一</h2><p id=\"p-g1.0\">大家好</p><h2>二</h2><p id=\"p-g1.0\">大家好</p>";
        let parsed = parse_chapters_output(&anchors(), raw);
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.rows[0].title, "一");
        assert!(!parsed.diagnostics.has_problems());
    }

    #[test]
    fn lint_uses_source_payload_as_anchor_set() {
        let anchors = anchors();
        let input = ChaptersPageInput {
            part_index: 0,
            part_count: 1,
            segments: &anchors,
            range: (0.0, 600.0),
            total_duration: 600.0,
            aim: 2,
            lang: "en",
            project_fingerprint: "fp",
        };
        let payload = render_chapters_source(&input);
        assert!(
            lint_chapters_answer(&payload, "<h2>开场</h2><p id=\"p-g1.0\">大家好</p>").is_empty()
        );
        // 不可修复的锚只丢那一行；剩余 0 行才报 `missing-id`。
        let problems = lint_chapters_answer(&payload, "<h2>开场</h2><p id=\"p-zzz\">谁知道</p>");
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].starts_with("[missing-id]"));
        assert!(lint_chapters_answer("not a chapters payload", "x").is_empty());
    }

    #[test]
    fn snippet_and_clock_helpers() {
        assert_eq!(snippet("short"), "short");
        let long = "一".repeat(60);
        let cut = snippet(&long);
        assert_eq!(cut.chars().count(), SNIPPET_CHARS + 1);
        assert!(cut.ends_with('…'));
        assert_eq!(fmt_clock(65.9), "01:05");
        assert_eq!(fmt_clock(3600.0), "01:00:00");
        assert_eq!(parse_clock("01:12:04"), Some(4324.0));
        assert_eq!(parse_clock("02:10"), Some(130.0));
        assert!(snippet_matches("Hello world, this is", "hello world…"));
        assert!(!snippet_matches("Hello world", "hey"));
    }
}
