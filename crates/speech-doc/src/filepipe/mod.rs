//! 文件契约字幕 AI 管线（`file-v1`）的载体编解码层。
//!
//! 见 `docs/design/subtitle/bcut-file-contract-subtitle-ai-design.md`。每个阶段的四拍是
//! `render（代码）→ edit（LLM/Agent）→ parse + lint（代码）→ apply（代码写真相）`；
//! 本模块只负责第一拍和第三拍，且全部是零 I/O、零时钟、零随机的纯函数。
//!
//! 五种载体：
//! - [`polish_txt`]：哨兵栅栏纯文本，用于断句与顺读修订。
//! - [`translate_html`]：`<article>` 裸根 HTML，用于句级翻译（可携带块对齐边草稿）。
//! - [`align_edges`]：HTML 表格，模型只标注"译文语义块 → 源词序号"（缺省对齐
//!   载体 `align-edges/1`）与单调化显示改写（`align-rewrite/1`）。
//! - [`align_table`]：HTML 表格，用于译文行片切分与源文区间对齐（审阅/修复载体）。
//! - [`context_md`]：Markdown，用于全局摘要与术语表。
//! - [`chapters_html`]：段落级 HTML 进、`<h2>` + 概要 + 首段锚出，用于分章节的
//!   Map 页与 Reduce 大纲。
//!
//! 解析一律「按 id/data 属性定位」，标签名不进协议；解析出的问题分两路：
//! [`common::Problem`]（§10 闭集，进重试账本）与 [`common::Warning`]（仅可观测性）。

pub mod align_edges;
pub mod align_table;
pub mod chapters_html;
pub mod common;
pub mod context_md;
pub mod html;
/// Experimental `lines/1` codec; production carriers remain versioned separately.
pub mod lines;
pub mod lines_translation;
pub mod manifest;
pub mod polish_txt;
pub mod translate_html;

pub use align_edges::{
    AlignChunk, AlignEdgesGroup, AlignEdgesInput, AlignEdgesParsed, AlignEdgesSentenceInput,
    CHUNK_EDGE_WEIGHT, chunk_char_ranges, chunks_to_edges, parse_align_edges,
    parse_align_edges_input, parse_ordinal_words, parse_ordinals, render_align_edges,
    render_ordinal_words,
};
pub use align_table::{
    AlignContextRow, AlignParsed, AlignParsedGroup, AlignParsedRow, AlignSentenceInput,
    AlignTableInput, parse_align_table, parse_align_table_input, render_align_table,
};
pub use chapters_html::{
    CHAPTERS_OUTLINE_FORMAT, CHAPTERS_SOURCE_FORMAT, ChapterAnchor, ChaptersPageInput,
    ChaptersParsed, OutlineUnit, ParsedChapterRow, lint_chapters_answer, max_rows_for_aim,
    outline_row_limit, parse_chapters_output, parse_chapters_output_with_limit,
    parse_chapters_source, render_chapters_outline, render_chapters_source, snippet,
};
pub use common::{
    ALIGN_EDGES_FORMAT, ALIGN_REWRITE_FORMAT, ALIGN_TABLE_FORMAT, CONTEXT_DOC_FORMAT, Diagnostics,
    DocumentArtifact, DocumentFormat, DocumentRequest, POLISH_TEXT_FORMAT, PROTOCOL_VERSION,
    PROTOCOL_VERSION_JSON, PageAttempt, Problem, ProblemCode, ProblemScope,
    TRANSLATION_SOURCE_FORMAT, Warning, WarningCode, max_output_chars, normalize_llm_output,
    sanitize_inline_text, sanitize_payload_text, uses_file_contract,
};
pub use context_md::{
    ANALYSIS_MAX_TERMS, ANALYSIS_MAX_TERMS_PER_PAGE, BilingualTerm, CanonicalTerm, ContextParsed,
    ParseMode, SourceContext, TargetContext, TermCategory, TermOrigin, is_junk_term_source,
    merge_bilingual_terms, merge_canonical_terms, parse_model_source_context,
    parse_model_target_context, parse_source_context, parse_source_context_with_mode,
    parse_target_context, parse_target_context_with_mode, render_source_context,
    render_target_context, term_merge_key,
};
pub use lines_translation::TranslateLinesDraft;
pub use manifest::{Manifest, PageRecord, RunRecord, RunStatus};
pub use polish_txt::{
    PolishBudget, PolishPagePlan, PolishParsed, PolishRendered, lint_polish_page,
    parse_polish_page, plan_polish_pages, render_polish_page,
};
pub use translate_html::{
    TranslateAlignmentDraft, TranslateAlignmentInput, TranslatePage, TranslateParsed,
    TranslateSection, TranslateSentence, is_row_partition, parse_align_groups,
    parse_translate_page, parse_translate_source, render_align_groups, render_translate_page,
    rows_on_group_boundaries,
};
