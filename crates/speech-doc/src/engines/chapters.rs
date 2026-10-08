//! 分章节引擎（源自 voice-ink `ChapterPromptBuilder` + `ChapterPlanBuilder` +
//! `CLIFlowChapters`，2026-08 起改为 file-v1 HTML 载体 + 分页 Map/Reduce）。
//!
//! - 段落投影按词预算分页（[`budgets::CHAPTERS`]，段落是原子）。**单页**直接一次
//!   调用出章节（行为与旧的整篇单次一致，只是载体换成 HTML）。
//! - **多页**走两级：Map 每页并行一次调用（kind `chapters`）切「话题单元」
//!   （标题 + 一句概要 + 首段锚）；Reduce 一次小调用（kind `chapters-outline`）
//!   在全部单元的大纲上按全局目标合并/取舍/统一命名，锚只能取自单元起点。
//! - 分层降级、整体永不失败：某页 Map 重试耗尽 → 该页降级为无标题占位单元
//!   （保留该页已解析出的最好一次结果优先）；Reduce 重试耗尽 → 直接采用 Map
//!   单元作为章节。Terminal/Cancelled 照旧直接中止。
//! - 模型输出经 [`crate::filepipe::parse_chapters_output`] 解析后仍走七步确定性
//!   清洗，任何一步都不信任模型；章节是时间锚定的覆盖层，写回只动 `doc.chapters`
//!   与 `stages.chapters`，绝不触碰文本/译文层。
//!
//! 与 voice-ink 的刻意偏差：
//! - 段落来源是 §18.5 规范派生（`derive_cues` + `derive_paras`），段 id 用
//!   `para.id`（`p-<首词id>`）；voice-ink 用编辑器文档的 paragraphs(doc)。
//! - 媒体上下文是宿主从项目清单整理出的有界文本，不在 core 做 I/O。
//! - 章节 id 基毫秒由 `ChaptersOptions.now_ms` 注入（core 零时钟）。
//! - 章节数上限随时长放大（[`chapter_count`]），不再固定 20。

use crate::atomize::word_count;
use crate::cue::{derive_cues, derive_paras, join_words};
use crate::doc::{Chapter, TranscriptDoc};
use crate::filepipe::{
    ChapterAnchor, ChaptersPageInput, OutlineUnit, PageAttempt, ParsedChapterRow,
    lint_chapters_answer, max_rows_for_aim, parse_chapters_output_with_limit,
    render_chapters_outline, render_chapters_source, snippet as anchor_snippet,
};
use crate::fingerprint::fingerprint;
use crate::llm::{LlmError, LlmJson, LlmRequest, MAX_RETRIES, complete_batch_retry_with};
use crate::paging::{balanced_page_sizes, budgets};
use crate::source_chapters::{SnapPlan, SourceChapter, clock, resolve_rows};

#[derive(Debug, Clone)]
pub struct ChaptersOptions {
    /// 目标章节数；缺省由时长与粒度估算。
    pub target: Option<usize>,
    /// 标题风格（voice-ink CLI 缺省 "short"）。
    pub title_style: Option<String>,
    /// 风格示例（voice-ink 里按 title_style 查 SampleData 表；此处由调用方传入）。
    pub examples: Vec<String>,
    pub instructions: Option<String>,
    pub reference_context: Option<String>,
    /// "balanced"（300s/章）| "broad"（600s）| "detailed"（150s）。
    pub granularity: String,
    /// 章节 id 基毫秒（`c-<base36(now_ms)>-<index>`），由宿主注入墙钟。
    pub now_ms: u64,
    /// 页预算（源文词数，[`crate::atomize::word_count`] 口径）；宿主可用
    /// `BCUT_LLM_PAGE_WORDS` 覆盖。
    pub page_budget: usize,
    /// 来源自带的章节（yt-dlp `chapters[]` 或描述里的时间戳大纲），按起点排好。
    /// 非空时整份大纲进契约当参考，缺省目标章数改为它的条数，多页时每页的
    /// `data-aim` 改为落在该页的条数；模型仍在段落投影上锚定。
    pub source_chapters: Vec<SourceChapter>,
}

impl Default for ChaptersOptions {
    fn default() -> Self {
        Self {
            target: None,
            title_style: None,
            examples: Vec::new(),
            instructions: None,
            reference_context: None,
            granularity: "balanced".to_owned(),
            now_ms: 0,
            page_budget: budgets::CHAPTERS,
            source_chapters: Vec::new(),
        }
    }
}

/// 一页（Map 部分）的运行记录，进产物 `parts[]` 便于排查长录音。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPart {
    /// 页 id（`p001`…），与产物目录 `pages/pNNN.*` 同名。
    pub id: String,
    /// 本页时间范围（起始秒）。
    pub start: f64,
    /// 本页时间范围（结束秒 = 下一页起始或媒体时长）。
    pub end: f64,
    /// 本页段落数。
    pub segments: usize,
    /// 本页解析出的话题单元数（单页路径下即章节候选数）。
    pub units: usize,
    /// 本页实际调用次数。
    pub attempts: u32,
    /// 重试耗尽后降级：占位单元或采用了不完整的最好一次结果。
    pub degraded: bool,
}

/// 分章节结果。
#[derive(Debug, Clone, PartialEq)]
pub struct ChaptersOutcome {
    /// 已写回 `doc.chapters` 的章节。
    pub chapters: Vec<Chapter>,
    /// 各页运行记录（单页路径恰一项）。
    pub parts: Vec<ChapterPart>,
    /// Reduce 调用次数（单页路径为 0）。
    pub outline_attempts: u32,
    /// Reduce 重试耗尽、直接采用 Map 单元作为章节。
    pub outline_fallback: bool,
}

/// Map 页契约（system）。页级差异（第几部分、时间范围、单元目标）全部在载体
/// 属性里：agent 路径的契约文件按 kind 唯一，不能逐页不同。
const CHAPTERS_MAP_CONTRACT: &str = r#"You split a transcript into chapters at natural topic boundaries.

Input: an HTML <article> whose <p id="…" data-at="HH:MM:SS"> elements are the transcript paragraphs, in order. The root carries lang (the transcript language), data-part="k/N" (which part of the recording this is), data-range, data-total (whole recording length) and data-aim (roughly how many chapters to produce for this input).

Output: HTML only — no markdown fences, no prose before or after. For each chapter, in chronological order, write exactly:
<h2>chapter title</h2>
<p class="summary">one sentence (at most 20 words) saying what this chapter discusses</p>
<p id="ID">the first few words of the paragraph where the chapter starts</p>

Rules:
- The <p id> is the paragraph where the chapter starts. Copy its id verbatim from the input and quote its opening words; never invent ids and never write timestamps.
- Aim for about data-aim chapters; fewer is fine when the content has fewer real topic shifts.
- If data-part is not the first part, the beginning may continue a topic from the previous part — then the first chapter of your answer simply starts later; do not force a chapter at the very first paragraph.
- Titles and summaries must be non-empty and distinct, written in the transcript's own language (the root's lang attribute — e.g. English titles for an English transcript) unless the extra instructions ask for another language. Emit nothing besides the elements above."#;

/// Reduce 契约（system）。
const CHAPTERS_OUTLINE_CONTRACT: &str = r#"You turn a chronological outline of topic units into the final chapter list of a long recording.

Input: an HTML <article> listing topic units in order. Each unit is <h2 data-at="HH:MM:SS">title</h2>, an optional <p class="summary">, and <p id="ID">opening words</p> — the paragraph where that unit starts. The units were produced part by part; <hr data-seam="k|k+1"> marks where two parts were cut, so a topic may be artificially split around it. An empty <h2 data-untitled="true"> is a part that could not be summarised. The root carries lang (the transcript language), data-units (how many units are listed), data-total and data-aim (how many chapters to end with).

Output: HTML only — no markdown fences, no prose. For each final chapter, in chronological order, write exactly:
<h2>chapter title</h2>
<p class="summary">one sentence summary</p>
<p id="ID">opening words</p>

Rules:
- Every chapter must start at one of the listed units: copy that unit's <p id> and opening words verbatim; never invent ids and never write timestamps.
- Do not copy the outline. The answer must have at most data-aim chapters (fewer is fine): when data-units exceeds data-aim you must merge consecutive units that belong to one broader topic into a single chapter — its anchor is the first merged unit's <p id>, its title and summary cover the whole merged span. Merge especially across a seam. Untitled units get a title from context or are merged into a neighbour.
- Titles must be non-empty, distinct and consistent in style, written in the transcript's own language (the root's lang attribute) unless the extra instructions ask for another language. Emit nothing besides the elements above."#;

/// 每小时章节数上限：`chapter_count` 的上限随时长放大，`max(20, round(小时数 × 20))`。
pub const MAX_CHAPTERS_PER_HOUR: f64 = 20.0;

/// 目标章节数（源自 `PolishEstimator.chapterCount`）：
/// broad ≈10 分钟/章、balanced ≈5、detailed ≈2.5；下限 2，上限
/// `max(20, round(时长小时数 × 20))`——≤60 分钟的媒体与旧的固定 2–20 完全一致
/// （balanced/broad 到 100 分钟都一致），长录音不再被钳到 20 章而把边界全挤进
/// 开头。Mac `PolishEstimator.chapterCount` 与 GPUI `ai_estimates::chapter_count`
/// 是本函数的平价副本，改这里必须同步。
pub fn chapter_count(duration: f64, granularity: &str) -> usize {
    let cap = ((duration.max(0.0) / 3600.0) * MAX_CHAPTERS_PER_HOUR)
        .round()
        .max(20.0) as i64;
    ((duration / seconds_per_chapter(granularity)).round() as i64).clamp(2, cap) as usize
}

fn seconds_per_chapter(granularity: &str) -> f64 {
    match granularity {
        "broad" => 600.0,
        "detailed" => 150.0,
        _ => 300.0,
    }
}

/// Map 页的话题单元目标：与章节粒度同档（页时长 / 粒度秒），钳 2–40。
///
/// 曾按 1.5 倍细切让 Reduce 合并，实测 deepseek-v4-flash（非 thinking）对
/// 「合并到 data-aim」的指令三次都照抄大纲；单元目标与章节同档后 Reduce 只需
/// 处理页缝与统一命名，`chapter-overflow` 护栏退为兜底。
fn units_target(page_duration: f64, granularity: &str) -> usize {
    let per_unit = seconds_per_chapter(granularity);
    ((page_duration.max(0.0) / per_unit).round() as i64).clamp(2, 40) as usize
}

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_owned();
    }
    let mut output = Vec::new();
    while value > 0 {
        output.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    output.reverse();
    String::from_utf8(output).expect("base36 digits are ASCII")
}

/// 段落投影：`(段id, 段起始秒, 段落文本)`，来源是 §18.5 规范派生
/// （`derive_cues` + `derive_paras`），段 id 用 `para.id`（`p-<首词id>`）。
fn derived_segments(doc: &TranscriptDoc) -> Vec<ChapterAnchor> {
    let cues = derive_cues(doc, &crate::layout_profile::cue_params_for_doc(doc));
    derive_paras(doc, &cues)
        .into_iter()
        .map(|para| {
            let first_cue = &cues[para.cue_indices[0]];
            let words = para
                .cue_indices
                .iter()
                .flat_map(|&cue| cues[cue].word_indices.iter())
                .map(|&index| &doc.words[index]);
            ChapterAnchor {
                id: para.id,
                start: first_cue.start,
                text: join_words(words),
            }
        })
        .collect()
}

/// 用户级设定（标题风格、示例、指令、录音背景）拼进契约尾部；同一次运行内
/// 所有页共用，因此进 system 而不进载体。
fn contract_with_options(base: &str, options: &ChaptersOptions) -> String {
    let title_style = options.title_style.as_deref().unwrap_or("short");
    let mut system = format!("{base}\n\nTitle style: {title_style}.");
    if !options.examples.is_empty() {
        system.push_str(&format!(" Examples: {}", options.examples.join(" · ")));
    }
    if let Some(instructions) = options
        .instructions
        .as_deref()
        .filter(|text| !text.trim().is_empty())
    {
        system.push_str(&format!("\nExtra instructions: {instructions}"));
    }
    if let Some(context) = options
        .reference_context
        .as_deref()
        .filter(|text| !text.trim().is_empty())
    {
        system.push_str("\nRecording context (background only; never copy it into titles):\n");
        system.push_str(context);
    }
    if !options.source_chapters.is_empty() {
        system.push_str(SOURCE_CHAPTERS_HINT);
        for chapter in options.source_chapters.iter().take(MAX_HINT_CHAPTERS) {
            let title = chapter
                .title
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let title: String = title.chars().take(MAX_HINT_TITLE_CHARS).collect();
            system.push_str(&format!("\n{} {title}", clock(chapter.start)));
        }
    }
    system
}

/// 来源大纲进契约的引言：作者时间戳只到秒且常比真起点早几秒，所以是「优先采用」
/// 而不是「照抄」，锚定仍必须落在输入里的段 id 上。
const SOURCE_CHAPTERS_HINT: &str = "\nChapters published with the source video (the author's own outline; times are approximate and may be a few seconds off). Prefer these boundaries and titles wherever the transcript agrees — still anchor every chapter on a paragraph id from the input, and only add, merge or drop chapters where the transcript clearly diverges. Keep the author's title language and wording. Entries outside this part's data-range belong to other parts:";
const MAX_HINT_CHAPTERS: usize = 200;
const MAX_HINT_TITLE_CHARS: usize = 120;

/// 落在 `[start, end)` 的来源章节数；首页把早于首段起点的条目（`0:00 Intro`）也算进来。
fn source_count_in(source: &[SourceChapter], range: (f64, f64), first_page: bool) -> usize {
    source
        .iter()
        .filter(|chapter| {
            (first_page || chapter.start >= range.0) && chapter.start < range.1.max(range.0)
        })
        .count()
}

/// 页划分：段落为原子、按词预算均衡分页；返回每页的段落下标区间。
fn plan_pages(segments: &[ChapterAnchor], page_budget: usize) -> Vec<std::ops::Range<usize>> {
    let costs = segments
        .iter()
        .map(|segment| word_count(&segment.text).max(1))
        .collect::<Vec<_>>();
    let mut ranges = Vec::new();
    let mut start = 0usize;
    for size in balanced_page_sizes(&costs, page_budget.max(1)) {
        ranges.push(start..start + size);
        start += size;
    }
    if ranges.is_empty() && !segments.is_empty() {
        ranges.push(0..segments.len());
    }
    ranges
}

fn page_id(index: usize) -> String {
    format!("p{:03}", index + 1)
}

fn describe_problems(parsed: &crate::filepipe::ChaptersParsed) -> String {
    parsed
        .diagnostics
        .problems
        .iter()
        .map(crate::filepipe::Problem::message)
        .collect::<Vec<_>>()
        .join("; ")
}

/// 一页/一次 Map 或 Reduce 调用的解析结果（供重试判定与降级兜底）。
struct PageResult {
    rows: Vec<ParsedChapterRow>,
    /// 解析出的行虽非空但带协议问题（部分行被丢弃）——重试耗尽时仍可采用。
    partial: bool,
}

/// 批量执行一组同 kind 的调用：每次尝试的解析结果先经 `on_attempt` 归档，
/// 有行且无问题即接受；有行但有问题时保留为「最好一次」并重试；重试耗尽后
/// 非终止性错误不再上抛，交由调用方按 `best[index]` 降级。
#[allow(clippy::too_many_arguments)]
fn run_batch(
    llm: &mut dyn LlmJson,
    requests: &[LlmRequest],
    anchors_per_request: &[&[ChapterAnchor]],
    page_ids: &[String],
    max_rows: Option<usize>,
    sleep: &mut dyn FnMut(f64),
    on_attempt: &mut dyn FnMut(&PageAttempt<'_>),
    tries: &mut [u32],
    best: &mut [Option<PageResult>],
) -> Result<(), LlmError> {
    let mut accepted: Vec<Option<PageResult>> = (0..requests.len()).map(|_| None).collect();
    let result = complete_batch_retry_with(
        llm,
        requests,
        MAX_RETRIES,
        sleep,
        &mut |index, raw| {
            tries[index] += 1;
            let parsed =
                parse_chapters_output_with_limit(anchors_per_request[index], raw, max_rows);
            let has_problems = parsed.diagnostics.has_problems();
            let usable = !parsed.rows.is_empty();
            on_attempt(&PageAttempt {
                page_id: &page_ids[index],
                attempt: tries[index],
                input: &requests[index].user,
                output: raw,
                problems: &parsed.diagnostics.problems,
                accepted: usable && !has_problems,
            });
            if usable {
                let keep = match best[index].as_ref() {
                    Some(previous) => previous.partial || previous.rows.len() < parsed.rows.len(),
                    None => true,
                };
                if keep {
                    best[index] = Some(PageResult {
                        rows: parsed.rows.clone(),
                        partial: has_problems,
                    });
                }
            }
            if usable && !has_problems {
                Ok(PageResult {
                    rows: parsed.rows,
                    partial: false,
                })
            } else {
                Err(LlmError::Malformed(format!(
                    "{} rejected — {}",
                    page_ids[index],
                    describe_problems(&parsed)
                )))
            }
        },
        // 重试原因只带结构化 problems：`LlmError::Malformed` 的 Display 前缀是
        // 「returned unusable JSON」，对 HTML 载体是误导。
        &mut |_, error| match error {
            LlmError::Malformed(detail) => detail.clone(),
            other => other.to_string(),
        },
        &mut |index, page| accepted[index] = Some(page),
    );
    for (index, page) in accepted.into_iter().enumerate() {
        if let Some(page) = page {
            best[index] = Some(page);
        }
    }
    match result {
        Ok(()) => Ok(()),
        // 重试耗尽的 Malformed / 可重试 HTTP：留给调用方按 best 降级。
        Err(error) if error.is_retryable() => Ok(()),
        Err(error) => Err(error),
    }
}

/// 分章节主入口：分页 → 单页直出 / 多页 Map+Reduce → 七步清洗 → 写回
/// `doc.chapters`（id `c-<base36(now_ms)>-<index>`）与 `stages.chapters`。
pub fn run_chapters(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &ChaptersOptions,
    sleep: &mut dyn FnMut(f64),
    on_attempt: &mut dyn FnMut(&PageAttempt<'_>),
) -> Result<ChaptersOutcome, LlmError> {
    if doc.words.is_empty() {
        return Err(LlmError::Terminal(
            "Nothing to title — the transcript is empty.".to_owned(),
        ));
    }
    let duration = doc.media.duration;
    let source = options.source_chapters.as_slice();
    let target = options
        .target
        .unwrap_or_else(|| {
            if source.is_empty() {
                chapter_count(duration, &options.granularity)
            } else {
                source.len()
            }
        })
        .max(1);
    let segments = derived_segments(doc);
    if segments.is_empty() {
        return Err(LlmError::Terminal(
            "Nothing to title — the transcript has no paragraphs.".to_owned(),
        ));
    }
    let project_fp = fingerprint(&doc.words);
    let pages = plan_pages(&segments, options.page_budget);
    let part_count = pages.len();
    let page_ranges = pages
        .iter()
        .enumerate()
        .map(|(index, range)| {
            let start = segments[range.start].start;
            let end = pages
                .get(index + 1)
                .map(|next| segments[next.start].start)
                .unwrap_or(duration);
            (start, end.max(start))
        })
        .collect::<Vec<_>>();

    // ── Map（单页时即为唯一一次调用）──
    let map_contract = contract_with_options(CHAPTERS_MAP_CONTRACT, options);
    let inputs = pages
        .iter()
        .enumerate()
        .map(|(index, range)| {
            let aim = if part_count == 1 {
                target
            } else if !source.is_empty() {
                source_count_in(source, page_ranges[index], index == 0).max(1)
            } else {
                units_target(
                    page_ranges[index].1 - page_ranges[index].0,
                    &options.granularity,
                )
            };
            render_chapters_source(&ChaptersPageInput {
                part_index: index,
                part_count,
                segments: &segments[range.clone()],
                range: page_ranges[index],
                total_duration: duration,
                aim,
                lang: &doc.lang,
                project_fingerprint: &project_fp,
            })
        })
        .collect::<Vec<_>>();
    let requests = inputs
        .iter()
        .map(|input| LlmRequest {
            kind: "chapters",
            system: map_contract.clone(),
            user: input.clone(),
            temperature: 0.0,
            attempt: 1,
            retry_reason: None,
        })
        .collect::<Vec<_>>();
    let page_ids = (0..part_count).map(page_id).collect::<Vec<_>>();
    let anchor_slices = pages
        .iter()
        .map(|range| &segments[range.clone()])
        .collect::<Vec<_>>();
    let mut tries = vec![0_u32; part_count];
    let mut best: Vec<Option<PageResult>> = (0..part_count).map(|_| None).collect();
    run_batch(
        llm,
        &requests,
        &anchor_slices,
        &page_ids,
        None,
        sleep,
        on_attempt,
        &mut tries,
        &mut best,
    )?;

    let mut parts = Vec::with_capacity(part_count);
    let mut units: Vec<OutlineUnit> = Vec::new();
    for (index, range) in pages.iter().enumerate() {
        let (start, end) = page_ranges[index];
        let (rows, degraded) = match best[index].take() {
            Some(page) => (page.rows, page.partial),
            None => (Vec::new(), true),
        };
        let unit_count = if rows.is_empty() { 1 } else { rows.len() };
        parts.push(ChapterPart {
            id: page_ids[index].clone(),
            start,
            end,
            segments: range.len(),
            units: unit_count,
            attempts: tries[index],
            degraded,
        });
        if rows.is_empty() {
            // 页降级：无标题占位单元，锚在本页首段，Reduce 负责命名或并入邻章。
            let first = &segments[range.start];
            units.push(OutlineUnit {
                anchor: ChapterAnchor {
                    id: first.id.clone(),
                    start: first.start,
                    text: anchor_snippet(&first.text),
                },
                title: None,
                summary: None,
                part_index: index,
            });
            continue;
        }
        for row in rows {
            let Some(anchor) = segments.iter().find(|segment| segment.id == row.anchor_id) else {
                continue;
            };
            units.push(OutlineUnit {
                anchor: ChapterAnchor {
                    id: anchor.id.clone(),
                    start: anchor.start,
                    text: anchor_snippet(&anchor.text),
                },
                title: Some(row.title),
                summary: row.summary,
                part_index: index,
            });
        }
    }

    // ── 单页：Map 结果即章节 ──
    if part_count == 1 {
        let rows = units
            .into_iter()
            .filter_map(|unit| Some((unit.title?, unit.anchor.id)))
            .collect::<Vec<_>>();
        let plan = require_plan(build_plan(&rows, &segments, duration))?;
        return Ok(ChaptersOutcome {
            chapters: commit_chapters(doc, plan, options.now_ms),
            parts,
            outline_attempts: 0,
            outline_fallback: false,
        });
    }

    // ── Reduce ──
    let outline =
        render_chapters_outline(&units, part_count, duration, target, &doc.lang, &project_fp);
    let outline_anchors = units
        .iter()
        .map(|unit| unit.anchor.clone())
        .collect::<Vec<_>>();
    let outline_request = [LlmRequest {
        kind: "chapters-outline",
        system: contract_with_options(CHAPTERS_OUTLINE_CONTRACT, options),
        user: outline,
        temperature: 0.0,
        attempt: 1,
        retry_reason: None,
    }];
    let outline_id = ["outline".to_owned()];
    let mut outline_tries = [0_u32];
    let mut outline_best: [Option<PageResult>; 1] = [None];
    // Reduce 的行数护栏：超出 aim 两成即 `chapter-overflow` 重试（模型常照抄大纲）；
    // 三次仍超则采用行数最多的一次（章节偏多但完整覆盖）。
    run_batch(
        llm,
        &outline_request,
        &[outline_anchors.as_slice()],
        &outline_id,
        Some(max_rows_for_aim(target)),
        sleep,
        on_attempt,
        &mut outline_tries,
        &mut outline_best,
    )?;
    let (rows, outline_fallback) = match outline_best[0].take() {
        Some(page) => (
            page.rows
                .into_iter()
                .map(|row| (row.title, row.anchor_id))
                .collect::<Vec<_>>(),
            false,
        ),
        // Reduce 兜底：直接采用 Map 单元（占位单元没有标题，跳过；其时间并入前一章）。
        None => (
            units
                .into_iter()
                .filter_map(|unit| Some((unit.title?, unit.anchor.id)))
                .collect::<Vec<_>>(),
            true,
        ),
    };
    let plan = require_plan(build_plan(&rows, &segments, duration))?;
    Ok(ChaptersOutcome {
        chapters: commit_chapters(doc, plan, options.now_ms),
        parts,
        outline_attempts: outline_tries[0],
        outline_fallback,
    })
}

/// agent 提交期 lint（`chapters` / `chapters-outline` 共用）：与引擎同一份解析器。
pub fn lint_agent_answer_file(payload: &str, answer: &str) -> Vec<String> {
    lint_chapters_answer(payload, answer)
}

#[derive(Debug, Clone, PartialEq)]
struct PlanRow {
    title: String,
    /// 该章起点所在的段 id（清洗后必然是既有段起点）。
    seg_id: String,
    start: f64,
    end: f64,
}

/// 七步确定性清洗（对拍 `ChapterPlanBuilder.build`）：
/// 建索引 → 丢空标题 → 丢未知段 id → 按（段起始时间, 输出顺序）排序 →
/// 跳过重复起点 → 首章起点钳 0 → 跳过非严格递增；回填 end=下一章 start，
/// 末章 = 媒体时长。
fn build_plan(
    rows: &[(String, String)],
    segments: &[ChapterAnchor],
    duration: f64,
) -> Vec<PlanRow> {
    let mut start_by_id: std::collections::HashMap<&str, f64> = std::collections::HashMap::new();
    for segment in segments {
        // 病态文档同 id 多段:保留首现(对拍 first(where:) 行为)。
        start_by_id
            .entry(segment.id.as_str())
            .or_insert(segment.start);
    }

    struct Candidate {
        title: String,
        seg_id: String,
        source_start: f64,
        order: usize,
    }
    let mut candidates: Vec<Candidate> = Vec::with_capacity(rows.len());
    for (order, (title, seg_id)) in rows.iter().enumerate() {
        let title = title.trim();
        if title.is_empty() {
            continue;
        }
        let Some(start) = start_by_id.get(seg_id.as_str()).copied() else {
            continue;
        };
        candidates.push(Candidate {
            title: title.to_owned(),
            seg_id: seg_id.clone(),
            source_start: start,
            order,
        });
    }
    candidates.sort_by(|a, b| {
        a.source_start
            .partial_cmp(&b.source_start)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.order.cmp(&b.order))
    });

    let mut plan: Vec<PlanRow> = Vec::with_capacity(candidates.len());
    let mut previous_source_start: Option<f64> = None;
    for candidate in candidates {
        if previous_source_start == Some(candidate.source_start) {
            continue;
        }
        previous_source_start = Some(candidate.source_start);
        let start = if plan.is_empty() {
            0.0
        } else {
            candidate.source_start
        };
        if plan.last().is_some_and(|last| start <= last.start) {
            continue;
        }
        plan.push(PlanRow {
            title: candidate.title,
            seg_id: candidate.seg_id,
            start,
            end: duration,
        });
    }
    for index in 0..plan.len().saturating_sub(1) {
        plan[index].end = plan[index + 1].start;
    }
    plan
}

fn require_plan(plan: Vec<PlanRow>) -> Result<Vec<PlanRow>, LlmError> {
    if plan.is_empty() {
        return Err(LlmError::Malformed(
            "The model returned no usable chapters — try again or adjust --target.".to_owned(),
        ));
    }
    Ok(plan)
}

/// 章节 id 前缀 `c-<base36(now_ms)>`；App 侧直采来源章节时与 CLI 同一口径。
pub fn chapter_id_base(now_ms: u64) -> String {
    format!("c-{}", base36(now_ms))
}

/// 不经模型：把来源章节的吸附计划写回 `doc.chapters` + `stages.chapters`，
/// id 与阶段戳口径同 [`commit_chapters`]。清洗后一章都不剩时报错。
pub fn commit_source_chapters(
    doc: &mut TranscriptDoc,
    plan: &SnapPlan,
    now_ms: u64,
) -> Result<Vec<Chapter>, String> {
    let rows = resolve_rows(&plan.rows(), doc.media.duration);
    if rows.is_empty() {
        return Err(
            "Source chapters produced no usable rows (empty titles or duplicate starts)."
                .to_owned(),
        );
    }
    let plan = rows
        .into_iter()
        .map(|row| {
            let seg_id = plan
                .entries
                .iter()
                .find(|entry| entry.source.title == row.title && entry.start() == row.start)
                .and_then(|entry| entry.anchor_id())
                .unwrap_or_default()
                .to_owned();
            PlanRow {
                title: row.title,
                seg_id,
                start: row.start,
                end: row.end,
            }
        })
        .collect();
    Ok(commit_chapters(doc, plan, now_ms))
}

/// 写回 `doc.chapters` + `stages.chapters`。id 方案不变。
fn commit_chapters(doc: &mut TranscriptDoc, plan: Vec<PlanRow>, now_ms: u64) -> Vec<Chapter> {
    let base = chapter_id_base(now_ms);
    doc.chapters = plan
        .into_iter()
        .enumerate()
        .map(|(index, row)| Chapter {
            id: format!("{base}-{index}"),
            title: row.title,
            start: row.start,
            end: row.end,
        })
        .collect();
    doc.stages.chapters = Some(fingerprint(&doc.words));
    doc.chapters.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia, Speaker, Word};
    use crate::filepipe::CHAPTERS_OUTLINE_FORMAT;
    use crate::llm::FakeLlm;

    fn make_doc() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: Some("talk.wav".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 600.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        for sp in ["s1", "s2"] {
            doc.speakers.insert(
                sp.to_owned(),
                Speaker {
                    name: sp.to_uppercase(),
                    hue: None,
                },
            );
        }
        // 两个说话人 → 两个派生段落 p-g1.0 / p-g2.0。
        let words = [
            ("g1.0", 0.0, 0.4, "hello", "s1"),
            ("g1.1", 0.4, 0.8, "world.", "s1"),
            ("g2.0", 120.0, 120.4, "bye", "s2"),
            ("g2.1", 120.4, 120.8, "now.", "s2"),
        ];
        doc.words = words
            .into_iter()
            .map(|(id, t0, t1, text, sp)| Word {
                id: id.to_owned(),
                t0,
                t1,
                text: text.to_owned(),
                sp: sp.to_owned(),
                glue: false,
            })
            .collect();
        doc
    }

    /// 长文档：`paragraphs` 个说话人交替段落，每段 `words_per_para` 个词，每词 1 秒。
    fn make_long_doc(paragraphs: usize, words_per_para: usize) -> TranscriptDoc {
        let mut doc = make_doc();
        doc.words.clear();
        let mut t = 0.0;
        for para in 0..paragraphs {
            let sp = if para % 2 == 0 { "s1" } else { "s2" };
            for word in 0..words_per_para {
                doc.words.push(Word {
                    id: format!("g{}.{}", para + 1, word),
                    t0: t,
                    t1: t + 1.0,
                    text: format!("w{para}x{word}"),
                    sp: sp.to_owned(),
                    glue: false,
                });
                t += 1.0;
            }
        }
        doc.media.duration = t;
        doc
    }

    fn run(
        doc: &mut TranscriptDoc,
        llm: &mut dyn LlmJson,
        options: &ChaptersOptions,
    ) -> Result<ChaptersOutcome, LlmError> {
        run_chapters(doc, llm, options, &mut |_| {}, &mut |_| {})
    }

    fn fake<const N: usize>(answers: [&str; N]) -> FakeLlm {
        FakeLlm::new(answers.iter().map(|answer| Ok((*answer).to_owned())))
    }

    fn html(rows: &[(&str, &str)]) -> String {
        rows.iter()
            .map(|(title, id)| {
                format!("<h2>{title}</h2><p class=\"summary\">s</p><p id=\"{id}\">…</p>")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn single_page_run_writes_chapters_and_stamp() {
        let mut doc = make_doc();
        let answer = html(&[("Intro", "p-g1.0"), ("Wrap", "p-g2.0")]);
        let mut llm = fake([answer.as_str()]);
        let options = ChaptersOptions {
            now_ms: 36,
            title_style: Some("descriptive".to_owned()),
            examples: vec!["Example A".to_owned()],
            ..ChaptersOptions::default()
        };
        let outcome = run(&mut doc, &mut llm, &options).unwrap();
        let chapters = &outcome.chapters;

        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].id, "c-10-0");
        assert_eq!(chapters[1].id, "c-10-1");
        assert_eq!(chapters[0].title, "Intro");
        assert_eq!((chapters[0].start, chapters[0].end), (0.0, 120.0));
        assert_eq!((chapters[1].start, chapters[1].end), (120.0, 600.0));
        assert_eq!(doc.chapters, *chapters);
        assert_eq!(doc.stages.chapters, Some(fingerprint(&doc.words)));
        assert_eq!(outcome.parts.len(), 1);
        assert_eq!(outcome.parts[0].id, "p001");
        assert_eq!(outcome.parts[0].units, 2);
        assert_eq!(outcome.parts[0].attempts, 1);
        assert!(!outcome.parts[0].degraded);
        assert_eq!(outcome.outline_attempts, 0);
        // prompt:kind/temperature/载体形状。
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(llm.calls[0].0, "chapters");
        assert!(
            llm.calls[0]
                .1
                .starts_with("You split a transcript into chapters")
        );
        assert!(
            llm.calls[0]
                .1
                .contains("Title style: descriptive. Examples: Example A")
        );
        let user = &llm.calls[0].2;
        assert!(user.contains("data-bcut-format=\"chapters-source/1\""));
        assert!(user.contains("data-part=\"1/1\""));
        assert!(user.contains("data-aim=\"2\""));
        assert!(user.contains("data-total=\"10:00\""));
        assert!(user.contains("<p id=\"p-g1.0\" data-at=\"00:00\">hello world.</p>"));
        assert!(user.contains("<p id=\"p-g2.0\" data-at=\"02:00\">bye now.</p>"));
    }

    #[test]
    fn cleanup_drops_junk_sorts_dedupes_and_clamps() {
        let mut doc = make_doc();
        // 乱序 + 围栏 + 闲话 + 重复起点 + 未知 id + 空标题。
        let raw = concat!(
            "Sure, here are the chapters:\n",
            "```html\n",
            "<h2>Late</h2><p id=\"p-g2.0\">bye</p>\n",
            "<h2>Early</h2><p id=\"p-g1.0\">hello</p>\n",
            "<h2>Dup</h2><p id=\"p-g2.0\">bye</p>\n",
            "<h2></h2><p id=\"p-g1.0\">hello</p>\n",
            "<h2>Ghost</h2><p id=\"p-nope\">zzz</p>\n",
            "```"
        );
        // §2.4：空标题与幽灵锚都是行级丢弃 ⇒ 首轮即接受，不再为它们重试整页。
        let mut llm = fake([raw]);
        let outcome = run(&mut doc, &mut llm, &ChaptersOptions::default()).unwrap();
        let chapters = &outcome.chapters;
        // Early 排到首章并钳 0;Late 保留;Dup(同起点)与 Ghost/空标题丢弃。
        let titles: Vec<&str> = chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["Early", "Late"]);
        assert_eq!(chapters[0].start, 0.0);
        assert_eq!(chapters[1].start, 120.0);
        assert_eq!(chapters[1].end, 600.0);
        assert_eq!(llm.calls.len(), 1);
        assert!(!outcome.parts[0].degraded);
        assert_eq!(outcome.parts[0].attempts, 1);
    }

    #[test]
    fn empty_response_retries_with_problems_then_fails_without_touching_doc() {
        let mut doc = make_doc();
        let answer = html(&[("Only", "p-g1.0")]);
        let mut llm = fake(["no rows here", answer.as_str()]);
        let outcome = run(&mut doc, &mut llm, &ChaptersOptions::default()).unwrap();
        assert_eq!(outcome.chapters.len(), 1);
        assert_eq!(llm.calls.len(), 2);
        assert_eq!(llm.calls[0].3, None);
        assert!(llm.calls[1].3.as_deref().unwrap().contains("missing-id"));
        // 两次都是同一载体。
        assert_eq!(llm.calls[0].2, llm.calls[1].2);

        // 三次仍空 → Malformed,文档不动。
        let mut doc = make_doc();
        let mut llm = FakeLlm::ok(["nope", "still nope", "nada"]);
        let result = run(&mut doc, &mut llm, &ChaptersOptions::default());
        assert!(matches!(result, Err(LlmError::Malformed(_))));
        assert!(doc.chapters.is_empty());
        assert!(doc.stages.chapters.is_none());
    }

    #[test]
    fn terminal_error_aborts_without_degrading() {
        let mut doc = make_doc();
        let mut llm = FakeLlm::new([Err(LlmError::Terminal("401".to_owned()))]);
        let result = run(&mut doc, &mut llm, &ChaptersOptions::default());
        assert!(matches!(result, Err(LlmError::Terminal(_))));
        assert!(doc.chapters.is_empty());
    }

    #[test]
    fn chapter_count_scales_cap_with_duration() {
        assert_eq!(chapter_count(3000.0, "balanced"), 10);
        assert_eq!(chapter_count(3000.0, "broad"), 5);
        assert_eq!(chapter_count(3000.0, "detailed"), 20);
        assert_eq!(chapter_count(100.0, "balanced"), 2); // 下限 2
        assert_eq!(chapter_count(750.0, "balanced"), 3); // round(2.5) → 3(half away from zero)
        // ≤60 分钟仍是旧的 2–20：上限 max(20, round(小时 × 20))。
        assert_eq!(chapter_count(3600.0, "detailed"), 20);
        assert_eq!(chapter_count(6000.0, "balanced"), 20);
        // 长录音上限随时长放大：每小时 20 章。
        assert_eq!(chapter_count(6000.0, "detailed"), 33);
        assert_eq!(chapter_count(7200.0, "balanced"), 24);
        assert_eq!(chapter_count(24277.0, "balanced"), 81);
        assert_eq!(chapter_count(24277.0, "detailed"), 135);
        assert_eq!(chapter_count(24277.0, "broad"), 40);
        // target 显式覆盖公式。
        let mut doc = make_doc();
        let answer = html(&[("A", "p-g1.0")]);
        let mut llm = fake([answer.as_str()]);
        let options = ChaptersOptions {
            target: Some(7),
            ..ChaptersOptions::default()
        };
        run(&mut doc, &mut llm, &options).unwrap();
        assert!(llm.calls[0].2.contains("data-aim=\"7\""));
    }

    #[test]
    fn multi_page_map_reduce_merges_units_into_chapters() {
        // 6 段 × 10 词，预算 20 词 → 3 页各 2 段。
        let mut doc = make_long_doc(6, 10);
        let options = ChaptersOptions {
            page_budget: 20,
            now_ms: 1,
            ..ChaptersOptions::default()
        };
        let map1 = html(&[("Opening", "p-g1.0"), ("Second", "p-g2.0")]);
        // 第 2 页首单元不从页首开始（延续上一话题），第 3 页正常。
        let map2 = html(&[("Fourth", "p-g4.0")]);
        let map3 = html(&[("Fifth", "p-g5.0"), ("Sixth", "p-g6.0")]);
        // Reduce：合并 Second+Fourth、丢 Sixth。
        let reduce = html(&[
            ("Opening", "p-g1.0"),
            ("Middle", "p-g2.0"),
            ("Fifth", "p-g5.0"),
        ]);
        let mut llm = fake([map1.as_str(), map2.as_str(), map3.as_str(), reduce.as_str()]);
        let outcome = run(&mut doc, &mut llm, &options).unwrap();
        assert_eq!(llm.calls.len(), 4);
        assert!(llm.calls[..3].iter().all(|call| call.0 == "chapters"));
        assert_eq!(llm.calls[3].0, "chapters-outline");
        assert!(llm.calls[1].2.contains("data-part=\"2/3\""));
        assert!(llm.calls[1].2.contains("data-range=\"00:20–00:40\""));
        assert!(llm.calls[1].2.contains("data-total=\"01:00\""));
        let outline = &llm.calls[3].2;
        assert!(outline.contains(&format!("data-bcut-format=\"{CHAPTERS_OUTLINE_FORMAT}\"")));
        assert!(outline.contains("data-parts=\"3\""));
        assert!(outline.contains("<hr data-seam=\"1|2\">"));
        assert!(outline.contains("<hr data-seam=\"2|3\">"));
        assert!(outline.contains("<h2 data-at=\"00:30\">Fourth</h2>"));
        assert!(outline.contains("<p id=\"p-g4.0\">w3x0 w3x1"));
        let titles: Vec<&str> = outcome.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, ["Opening", "Middle", "Fifth"]);
        let ranges: Vec<(f64, f64)> = outcome.chapters.iter().map(|c| (c.start, c.end)).collect();
        assert_eq!(ranges, [(0.0, 10.0), (10.0, 40.0), (40.0, 60.0)]);
        assert_eq!(outcome.parts.len(), 3);
        assert_eq!(
            outcome.parts.iter().map(|p| p.units).collect::<Vec<_>>(),
            [2, 1, 2]
        );
        assert_eq!(outcome.parts[1].segments, 2);
        assert_eq!((outcome.parts[1].start, outcome.parts[1].end), (20.0, 40.0));
        assert_eq!(outcome.outline_attempts, 1);
        assert!(!outcome.outline_fallback);
        assert_eq!(doc.stages.chapters, Some(fingerprint(&doc.words)));
    }

    #[test]
    fn reduce_that_copies_the_outline_is_retried_with_chapter_overflow() {
        // 60s 文档 → 目标 2 章 → Reduce 上限 4；Map 共 5 单元，Reduce 首答照抄 5 单元。
        let mut doc = make_long_doc(6, 10);
        let options = ChaptersOptions {
            page_budget: 20,
            ..ChaptersOptions::default()
        };
        let map1 = html(&[("A", "p-g1.0"), ("B", "p-g2.0")]);
        let map2 = html(&[("C", "p-g3.0"), ("D", "p-g4.0")]);
        let map3 = html(&[("E", "p-g5.0")]);
        let copied = html(&[
            ("A", "p-g1.0"),
            ("B", "p-g2.0"),
            ("C", "p-g3.0"),
            ("D", "p-g4.0"),
            ("E", "p-g5.0"),
        ]);
        let merged = html(&[("AB", "p-g1.0"), ("CDE", "p-g3.0")]);
        let mut llm = fake([
            map1.as_str(),
            map2.as_str(),
            map3.as_str(),
            copied.as_str(),
            merged.as_str(),
        ]);
        let outcome = run(&mut doc, &mut llm, &options).unwrap();
        assert_eq!(llm.calls.len(), 5);
        assert!(llm.calls[3].2.contains("data-units=\"5\""));
        assert!(llm.calls[3].2.contains("data-aim=\"2\""));
        assert!(
            llm.calls[4]
                .3
                .as_deref()
                .unwrap()
                .contains("chapter-overflow")
        );
        let titles: Vec<&str> = outcome.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, ["AB", "CDE"]);
        assert_eq!(outcome.outline_attempts, 2);
        assert!(!outcome.outline_fallback);

        // 三次都照抄 → 采用照抄结果（章节偏多但覆盖完整），不失败。
        let mut doc = make_long_doc(6, 10);
        let mut llm = fake([
            map1.as_str(),
            map2.as_str(),
            map3.as_str(),
            copied.as_str(),
            copied.as_str(),
            copied.as_str(),
        ]);
        let outcome = run(&mut doc, &mut llm, &options).unwrap();
        assert_eq!(outcome.chapters.len(), 5);
        assert_eq!(outcome.outline_attempts, 3);
        assert!(!outcome.outline_fallback);
    }

    #[test]
    fn failed_page_degrades_to_placeholder_and_reduce_fallback_uses_units() {
        let mut doc = make_long_doc(4, 10);
        let options = ChaptersOptions {
            page_budget: 20,
            ..ChaptersOptions::default()
        };
        let map1 = html(&[("Opening", "p-g1.0"), ("Second", "p-g2.0")]);
        // 第 2 页三次都没有可用行 → 占位单元；Reduce 三次都失败 → 采用 Map 单元。
        let mut llm = fake([
            map1.as_str(),
            "garbage",
            "garbage",
            "garbage",
            "no outline",
            "no outline",
            "no outline",
        ]);
        let outcome = run(&mut doc, &mut llm, &options).unwrap();
        assert_eq!(llm.calls.len(), 7);
        let outline = &llm.calls[4].2;
        assert!(outline.contains("data-untitled=\"true\""));
        assert!(outline.contains("<p id=\"p-g3.0\">"));
        assert!(outcome.outline_fallback);
        assert_eq!(outcome.outline_attempts, 3);
        assert!(outcome.parts[1].degraded);
        assert_eq!(outcome.parts[1].attempts, 3);
        assert_eq!(outcome.parts[1].units, 1);
        // 占位单元无标题被跳过，其时间并入 Second。
        let titles: Vec<&str> = outcome.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, ["Opening", "Second"]);
        assert_eq!(outcome.chapters[1].end, 40.0);
    }

    #[test]
    fn page_plan_is_deterministic_and_paragraph_atomic() {
        let doc = make_long_doc(9, 10);
        let segments = derived_segments(&doc);
        assert_eq!(segments.len(), 9);
        let pages = plan_pages(&segments, 30);
        assert_eq!(pages, plan_pages(&segments, 30));
        assert_eq!(pages.iter().map(|r| r.len()).sum::<usize>(), 9);
        assert!(pages.iter().all(|r| !r.is_empty()));
        assert!(pages.len() >= 3);
        // 单段超预算仍独占一页而不被拆开。
        let big = derived_segments(&make_long_doc(1, 200));
        assert_eq!(plan_pages(&big, 30), vec![0..1]);
        assert_eq!(units_target(2000.0, "balanced"), 7);
        assert_eq!(units_target(2000.0, "broad"), 3);
        assert_eq!(units_target(2000.0, "detailed"), 13);
        assert_eq!(units_target(60.0, "detailed"), 2);
    }

    fn src(start: f64, title: &str) -> SourceChapter {
        SourceChapter {
            start,
            end: None,
            title: title.to_owned(),
        }
    }

    #[test]
    fn source_outline_enters_the_contract_and_sets_the_default_target() {
        let mut doc = make_doc();
        let answer = html(&[("Intro", "p-g1.0"), ("The Normal One", "p-g2.0")]);
        let mut llm = fake([answer.as_str()]);
        let options = ChaptersOptions {
            source_chapters: vec![
                src(0.0, "Intro"),
                src(79.0, "The Normal One —— 普通人"),
                src(22_725.0, "\"42\"\n wrapped"),
            ],
            ..ChaptersOptions::default()
        };
        run(&mut doc, &mut llm, &options).unwrap();
        let system = &llm.calls[0].1;
        assert!(system.contains("Chapters published with the source video"));
        assert!(system.contains(
            "\n00:00:00 Intro\n00:01:19 The Normal One —— 普通人\n06:18:45 \"42\" wrapped"
        ));
        // 缺省目标 = 大纲条数（不是 600s → 2 的时长公式）。
        assert!(llm.calls[0].2.contains("data-aim=\"3\""));
        assert_eq!(doc.chapters.len(), 2);

        // 显式 --target 仍优先。
        let mut doc = make_doc();
        let mut llm = fake([answer.as_str()]);
        let options = ChaptersOptions {
            target: Some(5),
            ..options
        };
        run(&mut doc, &mut llm, &options).unwrap();
        assert!(llm.calls[0].2.contains("data-aim=\"5\""));
        assert!(
            ChaptersOptions::default().source_chapters.is_empty()
                && !contract_with_options("base", &ChaptersOptions::default())
                    .contains("Chapters published")
        );
    }

    #[test]
    fn multi_page_aims_count_the_source_entries_on_each_page() {
        // 6 段 × 10 词，预算 20 词 → 3 页（0–20s / 20–40s / 40–60s）。
        let mut doc = make_long_doc(6, 10);
        let options = ChaptersOptions {
            page_budget: 20,
            // 第 1 页两条（含早于首段的 0:00），第 2 页零条 → 下限 1，第 3 页一条。
            source_chapters: vec![src(0.0, "A"), src(12.0, "B"), src(41.0, "C")],
            ..ChaptersOptions::default()
        };
        let map1 = html(&[("A", "p-g1.0"), ("B", "p-g2.0")]);
        let map2 = html(&[("B", "p-g3.0")]);
        let map3 = html(&[("C", "p-g5.0")]);
        let reduce = html(&[("A", "p-g1.0"), ("B", "p-g2.0"), ("C", "p-g5.0")]);
        let mut llm = fake([map1.as_str(), map2.as_str(), map3.as_str(), reduce.as_str()]);
        let outcome = run(&mut doc, &mut llm, &options).unwrap();
        assert!(llm.calls[0].2.contains("data-aim=\"2\""));
        assert!(llm.calls[1].2.contains("data-aim=\"1\""));
        assert!(llm.calls[2].2.contains("data-aim=\"1\""));
        assert!(llm.calls[3].1.contains("\n00:00:41 C"));
        let titles: Vec<&str> = outcome.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, ["A", "B", "C"]);
    }

    #[test]
    fn commit_source_chapters_snaps_and_stamps_like_the_model_path() {
        let mut doc = make_doc();
        let anchors = crate::source_chapters::doc_anchors(&doc);
        let plan = crate::source_chapters::snap_to_anchors(
            &[src(1.0, "Hello"), src(119.0, "Bye")],
            &anchors,
        );
        let chapters = commit_source_chapters(&mut doc, &plan, 36).unwrap();
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].id, "c-10-0");
        assert_eq!((chapters[0].start, chapters[0].end), (0.0, 120.0));
        assert_eq!((chapters[1].start, chapters[1].end), (120.0, 600.0));
        assert_eq!(doc.chapters, chapters);
        assert_eq!(doc.stages.chapters, Some(fingerprint(&doc.words)));
        assert!(commit_source_chapters(&mut doc, &SnapPlan::default(), 36).is_err());
    }
}
