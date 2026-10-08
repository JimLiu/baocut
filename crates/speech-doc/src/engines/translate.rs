//! 阶段四：翻译引擎（§8 / v0.3 §4）——句级整译，**逐页直落 doc**。
//!
//! 三层粒度：句（翻译与脏检测单位，见 `sentence` 模块）、页（打包单位）、
//! 译文 Cue（展示单位，由 align 引擎的 `transAlign` 覆盖层派生）。
//! v0.3 起本引擎写 doc：每页落 `trans[lang][s-…]`（完整自然译句）并盖
//! `transSrc` 句指纹——句子翻完即持久化，doc 本身就是断点续跑现场；
//! 展示切分（`transAlign`）归 align 引擎。
//!
//! 增量语义：先清理源结构变化后不再对应当前句子的孤儿键，缺译或 stale
//! 的句才进 LLM；`force` 重翻全部；`sentences` 定向重翻指定句。

use std::collections::{BTreeMap, BTreeSet};

use crate::atomize::{is_cjk_text, normalize_chars};
use crate::autocorrect::{Options as AutocorrectOptions, format_translation_with_options};
use crate::cue::{derive_cues, derive_paras};
use crate::doc::TranscriptDoc;
use crate::engines::align::{FusionDraft, FusionDrafts, FusionLineInfo, fusion_line_info};
use crate::engines::brief::{
    Analysis, DocumentBrief, TranslationTone, format_for_prompt, simplified_chinese_prompt_block,
};
use crate::filepipe::{
    Diagnostics, ProblemCode, ProblemScope, TranslateAlignmentDraft, TranslateAlignmentInput,
    TranslatePage, TranslateParsed, TranslateSection, TranslateSentence, is_row_partition,
    lines_translation, parse_translate_page, parse_translate_source, render_translate_page,
};
use crate::llm::{
    LlmError, LlmJson, LlmRequest, MAX_RETRIES, RetryPolicy, complete_batch_retry_report,
};
use crate::sentence::{Sentence, derive_sentences, stale_sentences};
use crate::split::{TransParams, primary_subtag};

#[derive(Debug, Clone)]
pub struct TranslateOptions {
    pub source_lang: String,
    /// 目标语言（BCP-47）。
    pub lang: String,
    /// 重翻全部句（缺省只翻缺译 + stale 句）。
    pub force: bool,
    /// `Some` 时只处理指定句；显式选中的句即使译文新鲜也会重翻。
    pub sentences: Option<BTreeSet<String>>,
    /// 页预算（源文词数，口径见 [`crate::atomize::word_count`]），宿主按
    /// 执行器取 [`crate::paging::PageExecutor::translate_words`]（§12）。
    pub page_budget: usize,
    /// 显式用户指令（进 system prompt 末尾）。
    pub instructions: Option<String>,
    /// 全文源语 analysis；无双语 brief 时也是完整的降级语境。
    pub analysis: Option<Analysis>,
    /// 每目标语言可编辑双语简报。
    pub brief: Option<DocumentBrief>,
    /// formal/casual；None 为 neutral。
    pub tone: Option<TranslationTone>,
    /// Apply the default CJK punctuation/spacing/casing normalization.
    pub autocorrect: bool,
    /// `Some` 时让 translate `file-v1` 回答顺带产出目标先行的对齐草稿；坏草稿
    /// 只被丢弃，不影响译文验收。
    pub align: Option<TransParams>,
    /// 融合草稿的**行分区模式**（`--align-fusion rows`）：契约改为要求模型把
    /// 译文按源词顺序切成显示行，载体额外带确定性源侧分组
    /// （`data-align-groups`），覆盖面从"源侧已需拆分"放宽到"≥ 8 词"。
    /// `align` 为 `None` 时本字段无效。
    pub align_rows: bool,
    /// 行文本载体（`--align-fusion lines`，[`crate::filepipe::lines_translation`]）：
    /// 整页改走 `lines/1` 纯文本——一句一行、译文按块写、每块用首尾源词引用
    /// 标出对应；对齐证据由引擎联合定位后直接进块核。为真时 `align_rows`
    /// 无效；`align` 为 `None` 时本字段无效。
    pub align_lines: bool,
    /// 执行侧可用并发槽数。保留在选项中供宿主做 worker 计划；分页只看
    /// `page_budget` 的源文词数，不随并发槽或句数改变。
    pub worker_slots: Option<usize>,
    /// 溯源判定为陈旧的句 id（§11.3，由宿主用
    /// [`crate::provenance::scan_provenance`] 算出）。
    ///
    /// 这是**增量**判据：与 stale/缺译并列 OR 进待翻集合，但仍受
    /// `sentences` 显式选择的限制——`sentences` 是收缩语义，溯源不得绕过它。
    pub provenance_stale: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranslateOutcome {
    /// 本次真正拿到译文并入库的句数（doc 路径 = `committed_sentences.len()`；
    /// routed 路径无法逐句核对，仍是本次送翻的句数）。
    pub translated_sentences: usize,
    /// 跳过的句数（已有新鲜译文）。
    pub skipped_sentences: usize,
    /// 当前文档的句总数。
    pub total_sentences: usize,
    /// 本次送翻却没有拿到译文的句 id（每页部分成功、补做轮也没收回的那些），
    /// 升序。它们没有新指纹，下次仍会被选中重译；routed 路径恒为空。
    pub missing_sentences: Vec<String>,
    /// 本次真正入库译文的句 id（文件契约下按页部分成功，因此不等于 pending）。
    /// 宿主据此写 `ai/state/translation.<lang>.json`（§11.3）：只有确实重译过
    /// 的句子才刷新溯源快照。routed（最终时间线）路径不产出该集合。
    pub committed_sentences: BTreeSet<String>,
    /// 本次翻译回答中结构合法的融合草稿；align 仍会以 worker 答案同规复验。
    pub alignment_drafts: FusionDrafts,
    /// rows 模式下"行分区合格、但行边界没落在 `data-align-groups` 的组边界上"
    /// 的句数。这类草稿**照常接受**，计数只用于观测分组提示的命中率。
    pub rows_off_group_sentences: usize,
    /// rows 模式下因"整页交回纯译文"而软重发并成功取用第二次答案的页数
    /// （每页最多 1 次，见 [`rows_page_gave_up`]）。
    pub rows_page_retries: usize,
}

/// One source-owned sentence after a host has projected it through the final
/// timeline. Route ids are request-local opaque ids; `(src_id, sentence_id)` is
/// the durable scatter destination.
#[derive(Debug, Clone, PartialEq)]
pub struct RoutedSentence {
    pub route_id: String,
    pub src_id: String,
    pub sentence_id: String,
    pub source_lang: String,
    pub source_text: String,
    pub src_fingerprint: String,
    pub display_duration: f64,
    pub translation: Option<String>,
    pub stamped_fingerprint: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RoutedTranslation {
    pub src_id: String,
    pub sentence_id: String,
    pub text: String,
    pub src_fingerprint: String,
}

#[derive(Debug, Clone)]
pub struct RoutedTranslateOptions {
    pub lang: String,
    pub force: bool,
    /// Durable `(srcId, sentenceId)` keys. Explicit selection always retranslates.
    pub sentences: Option<BTreeSet<(String, String)>>,
    /// 页预算（源文词数，口径见 [`crate::atomize::word_count`]），宿主按
    /// 执行器取 [`crate::paging::PageExecutor::translate_words`]（§12）。
    pub page_budget: usize,
    pub instructions: Option<String>,
    pub analysis: Option<Analysis>,
    pub brief: Option<DocumentBrief>,
    pub tone: Option<TranslationTone>,
    pub autocorrect: bool,
    /// 最终时间线路径没有单一 doc 可读时，由宿主投影的章节标题。
    pub chapter_titles: Vec<String>,
    /// 执行侧可用并发槽数。保留在选项中供宿主做 worker 计划；分页只看
    /// `page_budget` 的源文词数，不随并发槽或句数改变。
    pub worker_slots: Option<usize>,
}

fn identifier_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

/// 与 VoiceInk `termPresent` 同口径：CJK 使用字面包含；Latin/标识符用
/// 大小写不敏感匹配并检查两侧标识符边界，避免 Air 命中 Airport。
pub fn term_present(source: &str, term: &str) -> bool {
    term_occurrences(source, term) > 0
}

/// [`term_present`] 的计数版：这个词在 `source` 里按同一口径出现了几次。
pub fn term_occurrences(source: &str, term: &str) -> usize {
    let term = term.trim();
    if term.is_empty() {
        return 0;
    }
    if is_cjk_text(term) {
        return source.match_indices(term).count();
    }
    let source_lower = source.to_lowercase();
    let term_lower = term.to_lowercase();
    source_lower
        .match_indices(&term_lower)
        .filter(|(start, matched)| {
            let end = start + matched.len();
            let before = source_lower[..*start].chars().next_back();
            let after = source_lower[end..].chars().next();
            !before.is_some_and(identifier_char) && !after.is_some_and(identifier_char)
        })
        .count()
}

fn required_targets(source: &str, brief: Option<&DocumentBrief>) -> Vec<String> {
    let Some(brief) = brief else {
        return Vec::new();
    };
    let mut targets = brief
        .glossary
        .iter()
        .filter(|entry| entry.locked && term_present(source, &entry.source))
        .map(|entry| entry.target.trim())
        .filter(|target| !target.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    targets.sort();
    targets.dedup();
    targets
}

fn prune_orphans<T>(
    table: Option<&mut BTreeMap<String, T>>,
    sentence_ids: &BTreeSet<&str>,
) -> bool {
    let Some(table) = table else {
        return false;
    };
    let before = table.len();
    table.retain(|id, _| sentence_ids.contains(id.as_str()));
    table.len() != before
}

/// 句级整译。零 I/O：LLM 注入、退避 sleep 注入；每页落盘 `doc.trans` /
/// `doc.transSrc` 后回调 `on_page`（宿主负责把 doc 原子写盘——doc 即续跑现场）。
pub fn run_translate(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &TranslateOptions,
    on_page: &mut dyn FnMut(&TranscriptDoc),
    sleep: &mut dyn FnMut(f64),
) -> Result<TranslateOutcome, LlmError> {
    run_translate_with_artifacts(doc, llm, options, on_page, &mut |_| {}, sleep)
}

/// 同 [`run_translate`]，另把页级尝试递给宿主落盘
/// （`ai/translate/<lang>/vNNN/`，§4/§11）。
pub fn run_translate_with_artifacts(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &TranslateOptions,
    on_page: &mut dyn FnMut(&TranscriptDoc),
    on_attempt: &mut dyn FnMut(&TranslatePageAttempt<'_>),
    sleep: &mut dyn FnMut(f64),
) -> Result<TranslateOutcome, LlmError> {
    let cues = derive_cues(doc, &crate::layout_profile::cue_params_for_doc(doc));
    let sentences = derive_sentences(doc, &cues);
    let sentence_ids: BTreeSet<&str> = sentences
        .iter()
        .map(|sentence| sentence.id.as_str())
        .collect();

    // 结构性重分句后，旧句 id 已无法被任何投影消费。若继续保留，check 会
    // 永久报告 translation-orphan，用户也无法通过重跑翻译自然消除它们。
    // 三张同源表必须一起收敛；先回调落盘，再进入可能失败的 LLM 阶段。
    let pruned_orphans = prune_orphans(doc.trans.get_mut(&options.lang), &sentence_ids)
        | prune_orphans(doc.trans_src.get_mut(&options.lang), &sentence_ids)
        | prune_orphans(doc.trans_align.get_mut(&options.lang), &sentence_ids);
    if pruned_orphans {
        on_page(doc);
    }

    let stale = stale_sentences(doc, &options.lang, &sentences);
    let translated: BTreeSet<&str> = doc
        .trans
        .get(&options.lang)
        .map(|table| table.keys().map(String::as_str).collect())
        .unwrap_or_default();
    let pending: Vec<&Sentence> = sentences
        .iter()
        .filter(|sentence| {
            options
                .sentences
                .as_ref()
                .is_none_or(|filter| filter.contains(&sentence.id))
                && (options.force
                    || options.sentences.is_some()
                    || stale.contains(&sentence.id)
                    || options.provenance_stale.contains(&sentence.id)
                    || !translated.contains(sentence.id.as_str()))
        })
        .collect();
    let skipped = sentences.len() - pending.len();
    let mut committed_sentences: BTreeSet<String> = BTreeSet::new();

    // 页数与边界都只由源文的语言感知词数决定。这样 Latin 按词、CJK 按字，
    // 不再让句数、序列化字符数或 worker 槽位暗中改变调用次数。
    let prepared: Vec<PreparedLine<'_>> = pending
        .iter()
        .map(|sentence| PreparedLine::new(sentence, options.brief.as_ref()))
        .collect();
    let source_words: Vec<usize> = prepared
        .iter()
        .map(|line| crate::atomize::word_count(&line.sentence.source_text))
        .collect();
    let mut pages: Vec<&[PreparedLine<'_>]> = Vec::new();
    let mut cursor = 0_usize;
    for size in translate_page_sizes(&source_words, options.page_budget) {
        pages.push(&prepared[cursor..cursor + size]);
        cursor += size;
    }

    let document_source = sentences
        .iter()
        .map(|sentence| sentence.source_text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let carrier = match options.align {
        Some(params) if options.align_lines => FileCarrier::Lines(params),
        Some(_) => FileCarrier::Html {
            rows: options.align_rows,
        },
        None => FileCarrier::Html { rows: false },
    };
    let system = {
        let mut system = translate_system_prompt(
            &options.source_lang,
            &options.lang,
            options.analysis.as_ref(),
            options.brief.as_ref(),
            options.tone,
            options.instructions.as_deref(),
            &document_source,
            carrier.prompt_body(),
        );
        if !doc.chapters.is_empty() {
            system.push_str(&format!(
                "\n\nChapters (document context only; never translate them): {}",
                doc.chapters
                    .iter()
                    .map(|chapter| chapter.title.as_str())
                    .collect::<Vec<_>>()
                    .join(" · ")
            ));
        }
        match carrier {
            FileCarrier::Html { rows } => {
                if let Some(params) = options.align.as_ref() {
                    system.push_str(&fusion_file_prompt_section(params, rows));
                }
            }
            // The carrier grammar reads last: it is what the model must obey
            // line by line, after the document context.
            FileCarrier::Lines(_) => {
                system.push_str("\n\nCarrier format — ");
                system.push_str(lines_translation::PROTOCOL);
            }
        }
        system
    };
    let file_pages = project_file_pages(
        doc,
        &cues,
        &sentences,
        &options.lang,
        &pages,
        &prepared,
        options.align.is_some(),
        carrier,
    );
    // 融合草稿的行分区复验需要句的源词数（AutoCorrect 后再验一次）。
    let align_word_counts: BTreeMap<String, usize> = file_pages
        .iter()
        .flat_map(|page| page.lines.iter())
        .filter_map(|line| {
            line.alignment
                .as_ref()
                .map(|info| (line.id.clone(), info.source_words.len()))
        })
        .collect();
    let project_fingerprint = crate::fingerprint::fingerprint(&doc.words);
    let fingerprint_by_id = sentences
        .iter()
        .map(|sentence| (sentence.id.clone(), sentence.src_fingerprint.clone()))
        .collect::<BTreeMap<_, _>>();
    let protected_terms = options
        .brief
        .as_ref()
        .map(DocumentBrief::protected_targets)
        .unwrap_or_default();
    let mut alignment_drafts = FusionDrafts::new();
    let mut rows_off_group_sentences = 0usize;
    let mut rows_page_retries = 0usize;
    run_translate_file_contract(
        llm,
        sleep,
        &system,
        &options.source_lang,
        &options.lang,
        &project_fingerprint,
        &file_pages,
        carrier,
        &mut rows_page_retries,
        on_attempt,
        &mut |parsed| {
            let trans_table = doc.trans.entry(options.lang.clone()).or_default();
            let mut committed = Vec::with_capacity(parsed.translations.len());
            for (id, text) in parsed.translations {
                let text = if options.autocorrect {
                    format_translation_with_options(
                        &text,
                        &options.lang,
                        &protected_terms,
                        AutocorrectOptions::default(),
                    )
                } else {
                    text
                };
                if let Some(draft) = parsed.alignments.get(&id)
                    && let Some(draft) = format_fusion_draft(
                        draft,
                        &text,
                        align_word_counts.get(&id).copied().unwrap_or_default(),
                    )
                {
                    if draft.rows && !draft.on_groups {
                        rows_off_group_sentences += 1;
                    }
                    alignment_drafts.insert(id.clone(), draft);
                }
                if let Some(draft) = parsed.lines.get(&id)
                    && let Some(draft) = format_lines_draft(draft, &text)
                {
                    alignment_drafts.insert(id.clone(), draft);
                }
                trans_table.insert(id.clone(), text);
                committed.push(id);
            }
            // 句指纹只盖在**真正入库**的句上。一页可以部分成功，若按整页盖戳，
            // 落空的句会带着新鲜指纹却没有译文，从此不再被 stale 选中——永久
            // 漏译且不可见。
            let src_table = doc.trans_src.entry(options.lang.clone()).or_default();
            for id in committed {
                if let Some(fingerprint) = fingerprint_by_id.get(&id) {
                    src_table.insert(id.clone(), fingerprint.clone());
                }
                committed_sentences.insert(id);
            }
            on_page(doc);
        },
    )?;
    let missing_sentences: Vec<String> = pending
        .iter()
        .map(|sentence| sentence.id.clone())
        .filter(|id| !committed_sentences.contains(id))
        .collect();
    Ok(TranslateOutcome {
        translated_sentences: committed_sentences.len(),
        skipped_sentences: skipped,
        total_sentences: sentences.len(),
        missing_sentences,
        committed_sentences,
        alignment_drafts,
        rows_off_group_sentences,
        rows_page_retries,
    })
}

/// Translate a final-timeline sentence stream and scatter each completed page
/// back through the host callback. The engine owns paging, global context,
/// response validation and formatting; source document I/O remains in the host.
pub fn run_routed_translate(
    sentences: &[RoutedSentence],
    llm: &mut dyn LlmJson,
    options: &RoutedTranslateOptions,
    on_page: &mut dyn FnMut(&[RoutedTranslation]),
    sleep: &mut dyn FnMut(f64),
) -> Result<TranslateOutcome, LlmError> {
    run_routed_translate_with_artifacts(sentences, llm, options, on_page, &mut |_| {}, sleep)
}

/// 同 [`run_routed_translate`]，另把页级尝试递给宿主落盘
/// （`ai/translate/<lang>/vNNN/`，§4/§11）。
pub fn run_routed_translate_with_artifacts(
    sentences: &[RoutedSentence],
    llm: &mut dyn LlmJson,
    options: &RoutedTranslateOptions,
    on_page: &mut dyn FnMut(&[RoutedTranslation]),
    on_attempt: &mut dyn FnMut(&TranslatePageAttempt<'_>),
    sleep: &mut dyn FnMut(f64),
) -> Result<TranslateOutcome, LlmError> {
    let pending: Vec<&RoutedSentence> = sentences
        .iter()
        .filter(|sentence| {
            let key = (sentence.src_id.clone(), sentence.sentence_id.clone());
            options
                .sentences
                .as_ref()
                .is_none_or(|filter| filter.contains(&key))
                && (options.force
                    || options.sentences.is_some()
                    || sentence.translation.is_none()
                    || sentence.stamped_fingerprint.as_deref()
                        != Some(sentence.src_fingerprint.as_str()))
        })
        .collect();
    let skipped = sentences.len() - pending.len();
    let source_words: Vec<usize> = pending
        .iter()
        .map(|sentence| crate::atomize::word_count(&sentence.source_text))
        .collect();
    let mut pages: Vec<Vec<&RoutedSentence>> = Vec::new();
    let mut cursor = 0_usize;
    for size in translate_page_sizes(&source_words, options.page_budget) {
        pages.push(pending[cursor..cursor + size].to_vec());
        cursor += size;
    }

    let mut source_languages = sentences
        .iter()
        .map(|sentence| sentence.source_lang.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    source_languages.sort_unstable();
    let source_language = source_languages.join(", ");
    let system = translate_system_prompt(
        if source_language.is_empty() {
            "und"
        } else {
            &source_language
        },
        &options.lang,
        options.analysis.as_ref(),
        options.brief.as_ref(),
        options.tone,
        options.instructions.as_deref(),
        &sentences
            .iter()
            .map(|sentence| sentence.source_text.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        TRANSLATE_FILE_PROMPT_BODY,
    );

    run_routed_translate_file(
        sentences, llm, options, &pages, system, on_page, on_attempt, sleep,
    )
    .map(|()| TranslateOutcome {
        translated_sentences: pending.len(),
        skipped_sentences: skipped,
        total_sentences: sentences.len(),
        missing_sentences: Vec::new(),
        // routed（最终时间线）路径的真相散射到多个源工程，没有单一
        // doc 可挂溯源；§11.3 状态文件不覆盖该路径。
        committed_sentences: BTreeSet::new(),
        alignment_drafts: FusionDrafts::new(),
        rows_off_group_sentences: 0,
        rows_page_retries: 0,
    })
}

/// routed 路径的文件契约分支。段以 `src_id` 为界（最终时间线里没有 doc 自然段，
/// 同一源片段的连续句就是最接近的语境单位）。
#[allow(clippy::too_many_arguments)]
fn run_routed_translate_file(
    sentences: &[RoutedSentence],
    llm: &mut dyn LlmJson,
    options: &RoutedTranslateOptions,
    pages: &[Vec<&RoutedSentence>],
    mut system: String,
    on_page: &mut dyn FnMut(&[RoutedTranslation]),
    on_attempt: &mut dyn FnMut(&TranslatePageAttempt<'_>),
    sleep: &mut dyn FnMut(f64),
) -> Result<(), LlmError> {
    if !options.chapter_titles.is_empty() {
        system.push_str(&format!(
            "\n\nChapters (document context only; never translate them): {}",
            options.chapter_titles.join(" · ")
        ));
    }
    let position = sentences
        .iter()
        .enumerate()
        .map(|(index, sentence)| (sentence.route_id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let by_route = sentences
        .iter()
        .map(|sentence| (sentence.route_id.as_str(), sentence))
        .collect::<BTreeMap<_, _>>();

    let mut file_pages = Vec::with_capacity(pages.len());
    for (index, page) in pages.iter().enumerate() {
        let (Some(first), Some(last)) = (page.first(), page.last()) else {
            continue;
        };
        let editable_ids = page
            .iter()
            .map(|sentence| sentence.route_id.as_str())
            .collect::<BTreeSet<_>>();
        let span = position[first.route_id.as_str()]..=position[last.route_id.as_str()];
        let mut lines = Vec::new();
        for sentence in &sentences[span] {
            let editable = editable_ids.contains(sentence.route_id.as_str());
            if !editable && sentence.translation.is_none() {
                continue;
            }
            lines.push(FileLine {
                id: sentence.route_id.clone(),
                source: sentence.source_text.clone(),
                section_id: format!("p-{}", sentence.src_id),
                speaker: None,
                required_targets: if editable {
                    required_targets(&sentence.source_text, options.brief.as_ref())
                } else {
                    Vec::new()
                },
                source_id: Some(sentence.src_id.clone()),
                sentence_id: Some(sentence.sentence_id.clone()),
                editable,
                existing_translation: (!editable).then(|| sentence.translation.clone()).flatten(),
                budget: editable
                    .then(|| reading_budget_duration(sentence.display_duration, &options.lang)),
                // routed 最终时间线的源词属于多个源文档，当前没有单一 doc 可
                // 生成稳定 bN 边界；保持 dedicated projected align 路径。
                alignment: None,
            });
        }
        file_pages.push(FilePage {
            id: format!("p{:03}", index + 1),
            lines,
        });
    }

    let source_languages = sentences
        .iter()
        .map(|sentence| sentence.source_lang.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(", ");
    let project_fingerprint = crate::fingerprint::fingerprint_strings(
        sentences
            .iter()
            .map(|sentence| sentence.src_fingerprint.as_str()),
    );
    let protected_terms = options
        .brief
        .as_ref()
        .map(DocumentBrief::protected_targets)
        .unwrap_or_default();
    run_translate_file_contract(
        llm,
        sleep,
        &system,
        if source_languages.is_empty() {
            "und"
        } else {
            &source_languages
        },
        &options.lang,
        &project_fingerprint,
        &file_pages,
        // routed（最终时间线）路径不跑融合草稿，也就没有缺行可重发。
        FileCarrier::Html { rows: false },
        &mut 0,
        on_attempt,
        &mut |parsed| {
            let completed = parsed
                .translations
                .into_iter()
                .filter_map(|(route_id, text)| {
                    let sentence = by_route.get(route_id.as_str())?;
                    Some(RoutedTranslation {
                        src_id: sentence.src_id.clone(),
                        sentence_id: sentence.sentence_id.clone(),
                        text: if options.autocorrect {
                            format_translation_with_options(
                                &text,
                                &options.lang,
                                &protected_terms,
                                AutocorrectOptions::default(),
                            )
                        } else {
                            text
                        },
                        src_fingerprint: sentence.src_fingerprint.clone(),
                    })
                })
                .collect::<Vec<_>>();
            on_page(&completed);
        },
    )
}

// ---- 文件契约（file-v1）路径 ----------------------------------------------

/// 一次页级尝试的材料，供宿主写 `ai/translate/<lang>/vNNN/`（§4/§11）。
///
/// 形状与 polish 共用 [`crate::filepipe::PageAttempt`]：`accepted` 在这里的含义
/// 是 `page_rejected == false`。
pub type TranslatePageAttempt<'a> = crate::filepipe::PageAttempt<'a>;

/// 文件契约下的一句渲染投影：脱开 doc / routed 两条数据源的差异。
#[derive(Debug, Clone)]
struct FileLine {
    id: String,
    source: String,
    section_id: String,
    speaker: Option<String>,
    required_targets: Vec<String>,
    source_id: Option<String>,
    sentence_id: Option<String>,
    /// `false` 即 §7.6 冻结句：只为保住段落语境，不进 `translations`。
    editable: bool,
    existing_translation: Option<String>,
    /// 阅读预算（[`reading_budget`] 同源），写进 `data-budget`。
    ///
    /// 与 `required_targets` 同样只给可编辑句：冻结句要的是逐字复制，给它挂
    /// 预算只会诱导模型去「优化」不该动的译文。
    budget: Option<usize>,
    alignment: Option<FusionLineInfo>,
}

/// 一页的渲染投影。
#[derive(Debug, Clone)]
struct FilePage {
    id: String,
    lines: Vec<FileLine>,
}

/// 把行投影拼成 [`TranslatePage`]。
///
/// 段按 **id 合并**而不是按相邻分组：全局残余波次会把来自不同页的句重新打包，
/// 跨页自然段在那里会出现两段同 id，落进渲染文本就是 `duplicate-id` 直接拒页。
fn build_translate_page(
    source_lang: &str,
    target_lang: &str,
    project_fingerprint: &str,
    lines: &[FileLine],
    context_before: Option<String>,
    context_after: Option<String>,
) -> TranslatePage {
    let mut page = TranslatePage {
        source_lang: source_lang.to_owned(),
        target_lang: target_lang.to_owned(),
        project_fingerprint: project_fingerprint.to_owned(),
        context_before,
        context_after,
        sections: Vec::new(),
    };
    let mut seen_sentences: BTreeSet<&str> = BTreeSet::new();
    for line in lines {
        if !seen_sentences.insert(line.id.as_str()) {
            continue;
        }
        let sentence = TranslateSentence {
            id: line.id.clone(),
            source: line.source.clone(),
            editable: line.editable,
            existing_translation: line.existing_translation.clone(),
            required_targets: line.required_targets.clone(),
            source_id: line.source_id.clone(),
            sentence_id: line.sentence_id.clone(),
            budget: line.budget,
            alignment: line.alignment.as_ref().map(|info| TranslateAlignmentInput {
                source_words: info.source_words.clone(),
                source_glue: info.source_glue.clone(),
                needs_split: info.needs_split,
                groups: info.groups.clone(),
            }),
        };
        match page
            .sections
            .iter_mut()
            .find(|section| section.id == line.section_id)
        {
            Some(section) => section.sentences.push(sentence),
            None => page.sections.push(TranslateSection {
                id: line.section_id.clone(),
                speaker: line.speaker.clone(),
                sentences: vec![sentence],
            }),
        }
    }
    page
}

/// 翻译页的载体：HTML（`file-v1`，可带融合草稿通道）或行文本（`lines/1`）。
#[derive(Debug, Clone, Copy)]
enum FileCarrier {
    Html {
        /// `--align-fusion rows`：行分区草稿通道。
        rows: bool,
    },
    /// `--align-fusion lines`：`row=` 与 `≥k` 提示按这组阈值给出。
    Lines(TransParams),
}

impl FileCarrier {
    /// [`LlmRequest::kind`]：两种载体在执行层是两个 kind（载体格式、条目
    /// 计数与复用 lint 都按 kind 分派）。
    fn kind(self) -> &'static str {
        match self {
            Self::Html { .. } => "translate",
            Self::Lines(_) => "translate-lines",
        }
    }

    fn rows(self) -> bool {
        matches!(self, Self::Html { rows: true })
    }

    /// system prompt 的契约段（载体说明 + 质量规则）。
    fn prompt_body(self) -> &'static str {
        match self {
            Self::Html { .. } => TRANSLATE_FILE_PROMPT_BODY,
            Self::Lines(_) => TRANSLATE_LINES_PROMPT_BODY,
        }
    }

    /// 采样温度：行文本载体按实测对照的档位（0.2）。
    fn temperature(self) -> f32 {
        match self {
            Self::Html { .. } => 0.3,
            Self::Lines(_) => 0.2,
        }
    }

    fn render(self, page: &TranslatePage) -> String {
        match self {
            Self::Html { .. } => render_translate_page(page),
            Self::Lines(params) => lines_translation::render_with_params(page, &params),
        }
    }

    /// 解析一次回答：两种载体都走各自唯一的解析 + 内容质量门。
    fn parse(self, page: &TranslatePage, rendered: &str, raw: &str) -> TranslateParsed {
        match self {
            Self::Html { .. } => {
                let mut parsed = parse_translate_page(page, Some(rendered), raw);
                crate::filepipe::translate_html::validate_translation_quality(page, &mut parsed);
                parsed
            }
            Self::Lines(params) => {
                lines_translation::parse_with_params(page, rendered, raw, &params).translation
            }
        }
    }
}

/// 渲染一页并把「发出去的那份文本」一起留下——§16 体积护栏要拿它当基准。
fn render_file_page(
    source_lang: &str,
    target_lang: &str,
    project_fingerprint: &str,
    lines: &[FileLine],
    context_before: Option<String>,
    context_after: Option<String>,
    carrier: FileCarrier,
) -> (TranslatePage, String) {
    let page = build_translate_page(
        source_lang,
        target_lang,
        project_fingerprint,
        lines,
        context_before,
        context_after,
    );
    let rendered = carrier.render(&page);
    (page, rendered)
}

fn summarize_problems(diagnostics: &Diagnostics) -> String {
    if diagnostics.problems.is_empty() {
        return "unspecified".to_owned();
    }
    // 定向重翻时一页会带大量只读语境。弱模型若把所有冻结句都重写，解析器
    // 会逐句报 frozen-modified；把上百条同文案原样塞回 retryReason 既挤掉
    // 真正的修复指令，也会让下一次调用继续照着噪声改。保持首见顺序，把
    // 相同 code + detail 聚合成计数；细粒度诊断仍完整保留在尝试工件中。
    let mut groups: Vec<(crate::filepipe::ProblemCode, &str, usize)> = Vec::new();
    for problem in &diagnostics.problems {
        if let Some((_, _, count)) = groups
            .iter_mut()
            .find(|(code, detail, _)| *code == problem.code && *detail == problem.detail)
        {
            *count += 1;
        } else {
            groups.push((problem.code, problem.detail.as_str(), 1));
        }
    }
    groups
        .into_iter()
        .map(|(code, detail, count)| {
            if count == 1 {
                format!("{code}: {detail}")
            } else {
                format!("{code}: {detail} (repeated {count} times)")
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// 跑一个波次：骨架 [`complete_batch_retry_report`] **一行不改**，靠注入的
/// validate 闭包判 `page_rejected`（整页重试），靠 on_ready 收 `retry_ids`
/// （句级修复留给下一波）。
///
/// 返回 `(每页需要进下一波的句 id, 整页尝试耗尽的页下标)`。页级耗尽**不再**
/// 上抛（重试策略重设计 §2.3）：调用方按 [`RetryPolicy::SPLIT_THEN`] 对半缩窄，
/// 仍失败的半页把自己的可编辑句丢进补做波次，最终缺失照 `translation-partial`
/// 上报。Terminal/Cancelled 照常立即上抛。
#[allow(clippy::too_many_arguments)]
/// rows soft page retry：一页里"载体请求了行"的句子至少要有这么多，才值得
/// 为缺行重发整页。
const ROWS_RETRY_MIN_SENTENCES: usize = 3;
/// 缺行比例门槛（百分比）：请求了行的句子里，拿到合格行分区的不足 30% 才重发。
const ROWS_RETRY_MISSING_PERCENT: usize = 70;
/// 重发时挂在 `retry_reason` 上的强调文案。
const ROWS_RETRY_REASON: &str = "Your previous answer for this page contained NO display rows: the sentences carrying data-align-groups came back as plain translations. Translate the page again and this time wrap EVERY such sentence's translation in <span data-src=\"a-b\"> display rows, exactly as the contract describes. Keep only the id attribute on each element.";

/// 这一页是否"整页放弃了行"：请求了行的句子 ≥ [`ROWS_RETRY_MIN_SENTENCES`]，
/// 且其中拿到合格行分区的不足 `100 - ROWS_RETRY_MISSING_PERCENT`%。
///
/// 实测（第四轮对拍）模型偶尔会交回一份结构完整、只留 id 的干净答案，却一个
/// `<span data-src>` 都不给——这不是坏草稿而是**整页漏做**，重发一次通常就
/// 能拿到。判据故意保守：少量句子没标不算（那本来就允许），只抓整页放弃。
fn rows_page_gave_up(page: &TranslatePage, parsed: &TranslateParsed) -> bool {
    let requested: Vec<&str> = page
        .sections
        .iter()
        .flat_map(|section| section.sentences.iter())
        .filter(|sentence| sentence.editable)
        .filter(|sentence| {
            sentence
                .alignment
                .as_ref()
                .is_some_and(|alignment| !alignment.groups.is_empty())
        })
        .map(|sentence| sentence.id.as_str())
        .collect();
    if requested.len() < ROWS_RETRY_MIN_SENTENCES {
        return false;
    }
    let missing = requested
        .iter()
        .filter(|id| !parsed.alignments.get(**id).is_some_and(|draft| draft.rows))
        .count();
    missing * 100 >= requested.len() * ROWS_RETRY_MISSING_PERCENT
}

/// 记下这一页里「没译成目标语」被拒的句（照抄源文、语言不符）：本页出现过的
/// 句先清掉旧记录，再登记这一次仍被这两类问题拒收的。
fn note_untranslated(
    untranslated: &mut BTreeSet<String>,
    page: &TranslatePage,
    parsed: &TranslateParsed,
) {
    for sentence in page.sections.iter().flat_map(|section| &section.sentences) {
        untranslated.remove(&sentence.id);
    }
    for problem in &parsed.diagnostics.problems {
        let ProblemScope::Sentence { id } = &problem.scope else {
            continue;
        };
        if matches!(
            problem.code,
            ProblemCode::TranslationSourceCopy | ProblemCode::TargetLanguageMismatch
        ) && parsed.retry_ids.contains(id)
        {
            untranslated.insert(id.clone());
        }
    }
}

/// 补做波次的重问原因：这一页里有句子上一次交回的不是目标语译文时，点名
/// 目标语言重问。实测（无 brief 的整页）同一请求原样重发会得到同一份照抄，
/// 所以重问必须说出上一次错在哪。其余原因的补做（漂行、缺行）照旧不带原因。
fn untranslated_retry_reason(
    target_lang: &str,
    lines: &[FileLine],
    untranslated: &BTreeSet<String>,
) -> Option<String> {
    let count = lines
        .iter()
        .filter(|line| line.editable && untranslated.contains(&line.id))
        .count();
    (count > 0).then(|| {
        format!(
            "{count} of the {total} sentences on this page were answered before with text that is not a translation into \"{target_lang}\": the source text was copied, or the answer was written in another language. Write every translation in \"{target_lang}\". Only names, code, and terms that \"{target_lang}\" itself writes the same way stay as they are.",
            total = lines.len(),
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn run_file_wave(
    llm: &mut dyn LlmJson,
    sleep: &mut dyn FnMut(f64),
    system: &str,
    page_ids: &[String],
    prepared: &[(TranslatePage, String)],
    // 每页自带的重问原因（补做波次用）；空切片即都不带。
    reasons: &[Option<String>],
    attempts: u32,
    attempt_base: u32,
    carrier: FileCarrier,
    rows_page_retries: &mut usize,
    untranslated: &mut BTreeSet<String>,
    on_attempt: &mut dyn FnMut(&TranslatePageAttempt<'_>),
    commit: &mut dyn FnMut(TranslateParsed),
) -> Result<(Vec<Vec<String>>, Vec<usize>), LlmError> {
    let rows = carrier.rows();
    let requests = prepared
        .iter()
        .enumerate()
        .map(|(index, (_, rendered))| LlmRequest {
            kind: carrier.kind(),
            system: system.to_owned(),
            user: rendered.clone(),
            temperature: carrier.temperature(),
            attempt: 1,
            retry_reason: reasons.get(index).cloned().flatten(),
        })
        .collect::<Vec<_>>();
    let mut retry_by_page = vec![Vec::new(); prepared.len()];
    let mut tries = vec![0_u32; prepared.len()];
    // rows soft page retry：整页缺行的页下标（只在 rows 模式下填）。
    let mut gave_up_rows = vec![false; prepared.len()];
    let outcome = complete_batch_retry_report(
        llm,
        &requests,
        attempts,
        sleep,
        &mut |index, raw| {
            tries[index] += 1;
            let (page, rendered) = &prepared[index];
            let parsed = carrier.parse(page, rendered, raw);
            on_attempt(&TranslatePageAttempt {
                page_id: &page_ids[index],
                attempt: attempt_base + tries[index],
                input: rendered,
                output: raw,
                problems: &parsed.diagnostics.problems,
                accepted: !parsed.page_rejected,
            });
            if parsed.page_rejected {
                // 判据是 page_rejected 而不是 has_problems()：可编辑句的
                // paragraph-move 与 unknown-id 会落在「其余全部接受」的结果上，
                // 用 has_problems() 重发会无限空转。
                return Err(LlmError::Malformed(format!(
                    "translate page {} rejected — {}",
                    page_ids[index],
                    summarize_problems(&parsed.diagnostics)
                )));
            }
            Ok(parsed)
        },
        &mut |_, error| error.to_string(),
        &mut |index, parsed: TranslateParsed| {
            retry_by_page[index] = parsed.retry_ids.clone();
            gave_up_rows[index] = rows && rows_page_gave_up(&prepared[index].0, &parsed);
            note_untranslated(untranslated, &prepared[index].0, &parsed);
            commit(parsed);
        },
    )?;

    // rows soft page retry（有界，每页最多 1 次）：整页交回纯译文时原样重发
    // 一页，`retry_reason` 里点名"上一次一个行都没有"。这是**软**重试——
    // 不走 `complete_batch_retry_report` 的失败账本，不消耗页级错误重试预算，
    // 传输失败或第二次仍被拒都只是放弃重试，第一次的译文原样保留（坏草稿
    // 不拒译文这条原则对整页缺行同样成立）。第二次可用时译文与行都以它为准
    // ——`commit` 对同一批 id 是覆盖写。
    let retry_pages: Vec<usize> = (0..prepared.len())
        .filter(|&index| gave_up_rows[index])
        .collect();
    if !retry_pages.is_empty() {
        let requests = retry_pages
            .iter()
            .map(|&index| LlmRequest {
                kind: carrier.kind(),
                system: system.to_owned(),
                user: prepared[index].1.clone(),
                temperature: carrier.temperature(),
                attempt: attempt_base + tries[index] + 1,
                retry_reason: Some(ROWS_RETRY_REASON.to_owned()),
            })
            .collect::<Vec<_>>();
        let mut second: Vec<Option<TranslateParsed>> =
            (0..retry_pages.len()).map(|_| None).collect();
        llm.complete_batch_with(&requests, &mut |slot, result| {
            let (Some(&index), Ok(raw)) = (retry_pages.get(slot), result.as_ref()) else {
                return;
            };
            let (page, rendered) = &prepared[index];
            let parsed = carrier.parse(page, rendered, raw);
            on_attempt(&TranslatePageAttempt {
                page_id: &page_ids[index],
                attempt: attempt_base + tries[index] + 1,
                input: rendered,
                output: raw,
                problems: &parsed.diagnostics.problems,
                accepted: !parsed.page_rejected,
            });
            if !parsed.page_rejected {
                second[slot] = Some(parsed);
            }
        });
        for (slot, parsed) in second.into_iter().enumerate() {
            let (Some(parsed), Some(&index)) = (parsed, retry_pages.get(slot)) else {
                continue;
            };
            *rows_page_retries += 1;
            retry_by_page[index] = parsed.retry_ids.clone();
            note_untranslated(untranslated, &prepared[index].0, &parsed);
            commit(parsed);
        }
    }
    // 残余句宁可留空（check 报 translation-partial），也绝不写伪译。
    Ok((
        retry_by_page,
        outcome.failed.into_iter().map(|(index, _)| index).collect(),
    ))
}

/// 文件契约三波次（§7.5 句级账本：每句总共 3 次尝试）。
///
/// - 波 1：全部页，整页尝试 [`RetryPolicy::MAX_PAGE_ATTEMPTS`] 次（同时吸收
///   传输错误）；耗尽的页对半切成两份句集各发一次（R3 拒绝即缩窄），仍失败的
///   半页把可编辑句丢进补做波次——**不再** hard error；
/// - 波 2：每页把自己的 `retry_ids` 单独打一页重发一次；
/// - 波 3：跨页残余合成一页再发一次。
///
/// 三波都调用同一个未改动的骨架。
#[allow(clippy::too_many_arguments)]
fn run_translate_file_contract(
    llm: &mut dyn LlmJson,
    sleep: &mut dyn FnMut(f64),
    system: &str,
    source_lang: &str,
    target_lang: &str,
    project_fingerprint: &str,
    pages: &[FilePage],
    carrier: FileCarrier,
    rows_page_retries: &mut usize,
    on_attempt: &mut dyn FnMut(&TranslatePageAttempt<'_>),
    commit: &mut dyn FnMut(TranslateParsed),
) -> Result<(), LlmError> {
    if pages.is_empty() {
        return Ok(());
    }
    let page_ids = pages.iter().map(|page| page.id.clone()).collect::<Vec<_>>();
    let prepared = pages
        .iter()
        .enumerate()
        .map(|(index, page)| {
            // 静态邻页语境：只用源文，页间无串行数据依赖。
            let before = index
                .checked_sub(1)
                .and_then(|previous| pages[previous].lines.last())
                .map(|line| line.source.clone());
            let after = pages
                .get(index + 1)
                .and_then(|next| next.lines.first())
                .map(|line| line.source.clone());
            render_file_page(
                source_lang,
                target_lang,
                project_fingerprint,
                &page.lines,
                before,
                after,
                carrier,
            )
        })
        .collect::<Vec<_>>();

    let mut untranslated = BTreeSet::new();
    let (mut wave_one, failed_pages) = run_file_wave(
        llm,
        sleep,
        system,
        &page_ids,
        &prepared,
        &[],
        RetryPolicy::MAX_PAGE_ATTEMPTS,
        0,
        carrier,
        rows_page_retries,
        &mut untranslated,
        on_attempt,
        commit,
    )?;

    // R3 拒绝即缩窄：整页尝试耗尽的页对半切成两份句集各发一次；仍失败的半页
    // 把自己的可编辑句丢进波 2/3，最终缺失照 `translation-partial` 上报。
    if RetryPolicy::SPLIT_THEN && !failed_pages.is_empty() {
        let mut half_ids = Vec::new();
        let mut half_prepared = Vec::new();
        // (原页下标, 这半页的可编辑 id)
        let mut half_origin: Vec<(usize, Vec<String>)> = Vec::new();
        for &index in &failed_pages {
            let lines = &pages[index].lines;
            let mid = lines.len() / 2;
            if mid == 0 {
                // 单句页切不动：全部可编辑句直接进补做波次。
                wave_one[index].extend(
                    lines
                        .iter()
                        .filter(|line| line.editable)
                        .map(|line| line.id.clone()),
                );
                continue;
            }
            for (slot, half) in [&lines[..mid], &lines[mid..]].into_iter().enumerate() {
                half_ids.push(format!("{}-h{}", page_ids[index], slot + 1));
                half_prepared.push(render_file_page(
                    source_lang,
                    target_lang,
                    project_fingerprint,
                    half,
                    None,
                    None,
                    carrier,
                ));
                half_origin.push((
                    index,
                    half.iter()
                        .filter(|line| line.editable)
                        .map(|line| line.id.clone())
                        .collect(),
                ));
            }
        }
        if !half_prepared.is_empty() {
            let (half_retry, half_failed) = run_file_wave(
                llm,
                sleep,
                system,
                &half_ids,
                &half_prepared,
                &[],
                1,
                RetryPolicy::MAX_PAGE_ATTEMPTS,
                carrier,
                rows_page_retries,
                &mut untranslated,
                on_attempt,
                commit,
            )?;
            for (slot, ids) in half_retry.iter().enumerate() {
                wave_one[half_origin[slot].0].extend(ids.iter().cloned());
            }
            for slot in half_failed {
                let (page, ids) = &half_origin[slot];
                wave_one[*page].extend(ids.iter().cloned());
            }
        }
    }

    // 波 2：逐页修复。
    let mut repair_ids = Vec::new();
    let mut repair_prepared = Vec::new();
    let mut repair_origin = Vec::new();
    let mut repair_reasons = Vec::new();
    for (index, ids) in wave_one.iter().enumerate() {
        let wanted = ids.iter().map(String::as_str).collect::<BTreeSet<_>>();
        let lines = pages[index]
            .lines
            .iter()
            .filter(|line| line.editable && wanted.contains(line.id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if lines.is_empty() {
            continue;
        }
        repair_reasons.push(untranslated_retry_reason(
            target_lang,
            &lines,
            &untranslated,
        ));
        repair_prepared.push(render_file_page(
            source_lang,
            target_lang,
            project_fingerprint,
            &lines,
            None,
            None,
            carrier,
        ));
        repair_ids.push(page_ids[index].clone());
        repair_origin.push(index);
    }
    if repair_prepared.is_empty() {
        return Ok(());
    }
    let (mut wave_two, wave_two_failed) = run_file_wave(
        llm,
        sleep,
        system,
        &repair_ids,
        &repair_prepared,
        &repair_reasons,
        1,
        MAX_RETRIES,
        carrier,
        rows_page_retries,
        &mut untranslated,
        on_attempt,
        commit,
    )?;
    // 波 2 整页被拒的那一页，它的全部待修句进波 3；不然它们连最后一次机会
    // 都没有就直接落成 `translation-partial`。
    for slot in wave_two_failed {
        let index = repair_origin[slot];
        let wanted = wave_one[index].iter().cloned().collect::<BTreeSet<_>>();
        wave_two[slot] = wanted.into_iter().collect();
    }

    // 波 3：跨页残余合成一页。
    let mut residual = Vec::new();
    for (slot, ids) in wave_two.iter().enumerate() {
        let wanted = ids.iter().map(String::as_str).collect::<BTreeSet<_>>();
        residual.extend(
            pages[repair_origin[slot]]
                .lines
                .iter()
                .filter(|line| line.editable && wanted.contains(line.id.as_str()))
                .cloned(),
        );
    }
    if residual.is_empty() {
        return Ok(());
    }
    let residual_reasons = [untranslated_retry_reason(
        target_lang,
        &residual,
        &untranslated,
    )];
    let residual_prepared = vec![render_file_page(
        source_lang,
        target_lang,
        project_fingerprint,
        &residual,
        None,
        None,
        carrier,
    )];
    run_file_wave(
        llm,
        sleep,
        system,
        &["residual".to_owned()],
        &residual_prepared,
        &residual_reasons,
        1,
        MAX_RETRIES + 1,
        carrier,
        rows_page_retries,
        &mut untranslated,
        on_attempt,
        commit,
    )?;
    Ok(())
}

/// rows 模式挂融合属性的最小源词数：低于它的短句本来就一行放得下，行分区
/// 提示只是白付上下文。
const FUSED_ROWS_MIN_WORDS: usize = 8;

/// doc 路径的行投影：句 → 段（`derive_paras`）、待翻句 → 可编辑、页内空隙里
/// 已有译文的句 → §7.6 冻结句（保住段落语境而不允许被改写）。
///
/// 冻结句只填在**本页首尾之间**的空隙里，不跨页扩张，因此不改变页数与波次对齐。
fn project_file_pages(
    doc: &TranscriptDoc,
    cues: &[crate::cue::Cue],
    sentences: &[Sentence],
    lang: &str,
    pages: &[&[PreparedLine<'_>]],
    prepared: &[PreparedLine<'_>],
    fused_alignment: bool,
    carrier: FileCarrier,
) -> Vec<FilePage> {
    let fused_rows = carrier.rows();
    let fused_lines = matches!(carrier, FileCarrier::Lines(_));
    let paras = derive_paras(doc, cues);
    let mut para_of_cue: BTreeMap<usize, usize> = BTreeMap::new();
    for (index, para) in paras.iter().enumerate() {
        for cue_index in &para.cue_indices {
            para_of_cue.insert(*cue_index, index);
        }
    }
    let position = sentences
        .iter()
        .enumerate()
        .map(|(index, sentence)| (sentence.id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let targets_of = prepared
        .iter()
        .map(|line| (line.sentence.id.as_str(), &line.required_targets))
        .collect::<BTreeMap<_, _>>();
    let existing = doc.trans.get(lang).cloned().unwrap_or_default();

    let section_of = |sentence: &Sentence| -> (String, Option<String>) {
        match sentence
            .cue_indices
            .first()
            .and_then(|cue| para_of_cue.get(cue))
        {
            Some(&index) => (
                paras[index].id.clone(),
                (!paras[index].sp.is_empty()).then(|| paras[index].sp.clone()),
            ),
            // 派生不到段（理论上不该发生）时退回「一句一段」，绝不让 section id 撞号。
            None => (format!("p-{}", sentence.id.trim_start_matches("s-")), None),
        }
    };

    let mut file_pages = Vec::with_capacity(pages.len());
    for (index, page) in pages.iter().enumerate() {
        let (Some(first), Some(last)) = (page.first(), page.last()) else {
            continue;
        };
        let editable_ids = page
            .iter()
            .map(|line| line.sentence.id.as_str())
            .collect::<BTreeSet<_>>();
        let span = position[first.sentence.id.as_str()]..=position[last.sentence.id.as_str()];
        let mut lines = Vec::new();
        for sentence in &sentences[span] {
            let editable = editable_ids.contains(sentence.id.as_str());
            let translation = existing.get(&sentence.id);
            if !editable && translation.is_none() {
                continue;
            }
            let (section_id, speaker) = section_of(sentence);
            lines.push(FileLine {
                id: sentence.id.clone(),
                source: sentence.source_text.clone(),
                section_id,
                speaker,
                required_targets: if editable {
                    targets_of
                        .get(sentence.id.as_str())
                        .map(|targets| (*targets).clone())
                        .unwrap_or_default()
                } else {
                    Vec::new()
                },
                source_id: None,
                sentence_id: None,
                editable,
                existing_translation: (!editable).then(|| translation.cloned()).flatten(),
                budget: editable.then(|| reading_budget(doc, sentence, lang)),
                alignment: if editable && fused_alignment {
                    let info = fusion_line_info(doc, cues, sentence, fused_rows);
                    // 常规融合只服务于确定性判据已经要求拆分的句子。短句即使
                    // 译文偶尔超过 fit，dedicated align 仍会兜底；不给所有短句
                    // 重复携带源文和逐边界提示，可显著降低 translate 单页上下文。
                    //
                    // rows 模式把判据放宽到「≥ FUSED_ROWS_MIN_WORDS 词」：行分
                    // 区是免 align 调用的直通路径，多覆盖一句就少派一句 align，
                    // 而它比逐块草稿更省提示（一句一条 groups 串）。
                    //
                    // lines 载体的每一句都用首尾源词引用标块，源词表是引用的
                    // 定位依据，因此可编辑句一律携带（载体里不回显词表，只在
                    // 长句间放分片记号，不付逐词序号的代价）。
                    let covered = if fused_lines {
                        true
                    } else if fused_rows {
                        info.needs_split || info.source_words.len() >= FUSED_ROWS_MIN_WORDS
                    } else {
                        info.needs_split
                    };
                    covered.then_some(info)
                } else {
                    None
                },
            });
        }
        file_pages.push(FilePage {
            id: format!("p{:03}", index + 1),
            lines,
        });
    }
    file_pages
}

// ---- 请求构造 -------------------------------------------------------------

struct PreparedLine<'a> {
    sentence: &'a Sentence,
    required_targets: Vec<String>,
}

impl<'a> PreparedLine<'a> {
    fn new(sentence: &'a Sentence, brief: Option<&DocumentBrief>) -> Self {
        Self {
            sentence,
            required_targets: required_targets(&sentence.source_text, brief),
        }
    }
}

/// 单页判据（P2-1 单页免 brief）：句数不参与分页，只看整篇源文词数。
/// 与 [`crate::paging::balanced_page_sizes`] 同一口径（预算 + slack），
/// 判定为单页的文档在实际分页时也必然是一页。
pub fn fits_single_translate_page(
    sentence_count: usize,
    total_words: usize,
    page_budget: usize,
) -> bool {
    sentence_count > 0 && crate::paging::page_count_for_total(total_words, page_budget) == 1
}

fn translate_page_sizes(source_words: &[usize], page_budget: usize) -> Vec<usize> {
    crate::paging::balanced_page_sizes(source_words, page_budget)
}

/// CPS 阅读预算：`maxChars = max(1, floor(显示时长 × cps))`；显示时长 =
/// 句末词 t1 − 首词 t0；cps 按目标语言 zh→9、其他 CJK（ja/ko）→13、默认→21，
/// 与 [`crate::split::target_reading_cps`] 的阅读单位/秒同源。计数口径 =
/// [`crate::split::target_cps_chars`] 的阅读单位（普通逗号/句号免费；CJK 目标
/// 语下 Latin 约半字），**不是**裸的非空白字符数——曾经两份提示词都声明
/// "characters excluding whitespace"，对短句 + 必带 Latin 锁定术语（rt）的
/// 组合是恒不可满足的预算（"description" 11 字符对预算 11），worker 只能
/// 违约或砍语义。
fn reading_budget(doc: &TranscriptDoc, sentence: &Sentence, target_lang: &str) -> usize {
    let first = &doc.words[*sentence.word_indices.first().expect("sentence non-empty")];
    let last = &doc.words[*sentence.word_indices.last().expect("sentence non-empty")];
    let duration = (last.t1 - first.t0).max(0.0);
    reading_budget_duration(duration, target_lang)
}

fn reading_budget_duration(duration: f64, target_lang: &str) -> usize {
    let cps = match primary_subtag(target_lang).as_str() {
        "zh" => 9.0,
        "ja" | "ko" => 13.0,
        _ => 21.0,
    };
    ((duration * cps).floor() as usize).max(1)
}

// system prompt 底本取自 voice-ink `TranslatePrompts.translateSystemPrompt`。
// analysis 与每语言 DocumentBrief 均可缺省；块级组装保证 brief 失败或
// `--no-brief` 时稳定降级到源语 analysis，再降级到基础契约。
// bcut 追加：顺句驱动（同传式顺译）偏好——在同样自然的几种语序中优先贴近
// 源语小句顺序，从源头减少展示对齐的语序交叉；见字幕对齐三问题方案。
/// 文件契约（`file-v1`）的契约段。
///
/// 长度通道：历史 json 版靠 `maxChars` 与融合段的每行展示上限压住译文宽度，
/// file 版早期两条全无，实测展示宽度高出一成以上。因此契约直接声明「成品是
/// 字幕」并把逐句预算挂在 `data-budget` 上。每行展示上限按目标语言变
/// （CJK 约 16 格、拉丁文字约 42 字符），契约文本只描述**约束的性质**，
/// 具体数字一律由载体的 `data-budget` 携带。
const TRANSLATE_FILE_PROMPT_BODY: &str = r#"The user message is ONE HTML document: an <article> whose <section> elements are paragraphs and whose elements carrying an "id" attribute are the sentences to translate.

Respond with the SAME document structure and nothing else — no markdown fences, no prose, no explanation. Keep the <article> wrapper and every <section id>, and replace each sentence element's text content with its translation.

Rules:
- Ids are the only thing that locates a sentence. Reproduce every "id" byte-for-byte, exactly once. Never invent, drop, merge, split, or reorder ids, and never move a sentence into a different <section>.
- OMIT every other attribute from your answer. data-align-words, data-align-groups, data-align-needed, data-budget, data-rt, data-source-id, data-sid and data-translation are INPUT-ONLY instructions: nothing reads them back, so echoing them only makes your answer longer and slower. The ideal sentence element is exactly `<p id="s-g1.0">译文</p>`. (Copying them back is tolerated and never an error — but always prefer to leave them out.) Never translate or edit them either.
- An element with data-editable="false" is FROZEN: emit its data-translation value verbatim as that element's text content — you still drop the attributes themselves. Never retranslate it and never move it.
- data-rt, when present, is a JSON array of exact required target renderings for LOCKED glossary terms found in that sentence. Every string in it MUST appear verbatim in that sentence's translation. Do not inflect, respell, re-space, translate, or omit it.
- HTML comments carry neighbouring context for continuity only — never translate them and never reproduce them.
- Understand the complete sentence, then translate faithfully and naturally in the TARGET language's own idiomatic word order. The later alignment phase maps that natural sentence to timing; never produce stilted phrasing just to follow the source clause order.
- Among equally natural renderings, prefer the one whose clause order FOLLOWS the source clause order (simultaneous-interpretation style): subtitle rows are timed against the source speech, so a translation that unfolds in the same order yields rows whose meaning matches what is being heard. Reorder only when the target language genuinely requires it.
- The finished product is SUBTITLES, not prose: every sentence you write is later cut into narrow display rows (a row holds only a handful of display cells) that must be read while the speaker is still talking. Length is therefore part of correctness, not a matter of style — a translation that says the same thing in fewer characters is the better translation.
- data-budget, when present, restates that sentence's reading-speed budget in reading units, not raw characters: whitespace and ordinary commas and periods are free, and in CJK target languages a Latin letter or digit counts about half a unit — so a required data-rt term costs far less than its letter count. The whole translation should fit the budget. Prefer concise phrasing — cut filler, redundant connectives, restated subjects, and padding first, and choose the shorter of two equally faithful wordings.
- The budget never outranks meaning. Never remove essential meaning, negation, qualifications, numbers, names, tone, or register just to meet it: when a sentence genuinely needs the length, take the length.
- Preserve every explicit causal, contrastive, conditional, and result relation (for example because / but / if / therefore) and the content governed by it, even when that pushes the sentence past data-budget. The alignment phase can split a complete translation but cannot recover an omitted clause.
- Output exactly ONE rendering per sentence — never slash-separated or parenthesized alternatives. A slash is allowed only when it belongs to a term that is copied verbatim — a CLI command like /compact, whether it comes from the source text, a data-rt string, or a glossary target.
- Keep terminology consistent across the whole document.
- Follow the target language's own spacing conventions: no spaces between Chinese or Japanese characters; Korean separates words with spaces and attaches a particle or counter to the word or numeral before it.
- Do not insert newline characters or segmentation marks inside a sentence. When fusion metadata is present, the only markup allowed inside a sentence element is the `<span data-src>` annotation described below; the sentence text remains one complete translation."#;

/// 行文本载体（`lines/1`，`--align-fusion lines`）的契约段：质量规则与
/// [`TRANSLATE_FILE_PROMPT_BODY`] 同一套（预算与锁定术语改由 `≤n` 与
/// `! N required=` 行携带），载体语法在 system prompt 末尾单独附上
/// （[`lines_translation::PROTOCOL`]）。
const TRANSLATE_LINES_PROMPT_BODY: &str = r#"The user message is ONE plain-text page in the lines/1 format described at the end of these instructions: each numbered line is one sentence to translate, in document order.

Rules:
- Understand the complete sentence, then translate faithfully and naturally in the TARGET language's own idiomatic word order. The later alignment phase maps that natural sentence to timing; never produce stilted phrasing just to follow the source clause order.
- Among equally natural renderings, prefer the one whose clause order FOLLOWS the source clause order (simultaneous-interpretation style): subtitle rows are timed against the source speech, so a translation that unfolds in the same order yields rows whose meaning matches what is being heard. Reorder only when the target language genuinely requires it.
- The finished product is SUBTITLES, not prose: every sentence you write is later cut into narrow display rows (a row holds only a handful of display cells) that must be read while the speaker is still talking. Length is therefore part of correctness, not a matter of style — a translation that says the same thing in fewer characters is the better translation.
- `≤n` before a sentence restates that sentence's reading-speed budget in reading units, not raw characters: whitespace and ordinary commas and periods are free, and in CJK target languages a Latin letter or digit counts about half a unit — so a required term costs far less than its letter count. The whole translation should fit the budget. Prefer concise phrasing — cut filler, redundant connectives, restated subjects, and padding first, and choose the shorter of two equally faithful wordings.
- The budget never outranks meaning. Never remove essential meaning, negation, qualifications, numbers, names, tone, or register just to meet it: when a sentence genuinely needs the length, take the length.
- Preserve every explicit causal, contrastive, conditional, and result relation (for example because / but / if / therefore) and the content governed by it, even when that pushes the sentence past the budget. The alignment phase can split a complete translation but cannot recover an omitted clause.
- A `! N required=[…]` line lists exact required target renderings for LOCKED glossary terms found in sentence N. Every string in it MUST appear verbatim in that sentence's translation. Do not inflect, respell, re-space, translate, or omit it.
- Output exactly ONE rendering per sentence — never slash-separated or parenthesized alternatives. A slash is allowed only when it belongs to a term that is copied verbatim — a CLI command like /compact, whether it comes from the source text, a required string, or a glossary target.
- Keep terminology consistent across the whole document.
- Follow the target language's own spacing conventions: no spaces between Chinese or Japanese characters; Korean separates words with spaces and attaches a particle or counter to the word or numeral before it.
- A sentence's translation stays on its own numbered line: no newline inside it, and the chunk markers described below are the only structure inside a line."#;

/// `file-v1` 翻译融合契约（对齐块设计 §6.1）。译文文本仍是唯一真相；
/// `<span data-src>` 只是尽力而为的块对齐草稿通道，align 引擎把它展开成对齐边
/// 后走与 dedicated `align-edges` 完全相同的确定性块合并 / 双语 DP。
fn fusion_file_prompt_section(params: &TransParams, rows: bool) -> String {
    if rows {
        return fusion_rows_prompt_section(params);
    }
    format!(
        r#"

Fused block alignment (optional draft channel): editable sentences that already need display splitting carry `data-align-words` (the source words, each prefixed with its 1-based ordinal like `[1]I [2]didn't [3]go`) and `data-align-needed`. Sentences without those attributes need only a translation. Read those attributes, then drop them from your answer — the `<span data-src>` annotation below is the only thing that must come back.
- First write the complete natural translation as the element text. Then, INSIDE that same `<p>`, wrap the translation in a sequence of `<span data-src="…">chunk</span>` elements: the span texts concatenated must reproduce the translation exactly (never add, drop, reorder, or rewrite a character; punctuation stays with the chunk it ends). Everything outside a span counts as an unattributed chunk.
- Chunk the translation into the SMALLEST natural semantic chunks (a clause, a phrase, a term — never below a word). For each chunk, `data-src` lists the ordinals of the source words it translates: whitespace or comma separated, ranges allowed (`4-7`, `1 2 3`, `1-3,9`), any order, non-contiguous ok, empty (`data-src=""`) for particles or connectives with no source word. Every ordinal may appear at most once in the sentence; unaligned source words are fine.
- Never reorder, merge, or split chunks to imitate the source order — the chunk order is the translation's own order; the ordinals record the correspondence, including crossings. Numbers, names, URLs, and glossary terms must sit in the chunk whose `data-src` contains their source ordinal.
- Aim the whole sentence at ≤{fit} display units per eventual row (prefer ≤{soft}, absolute {hard}), but never distort, shorten, or retranslate the sentence to make chunks smaller. A bad or missing annotation is silently discarded and never rejects the translation."#,
        fit = params.fit,
        soft = params.soft,
        hard = params.hard,
    )
}

/// `file-v1` 翻译融合契约的**行分区**变体（`--align-fusion rows`）。整句译文
/// 仍是唯一真相；`<span data-src>` 从"语义块草稿"升格为"显示行分区"：每个
/// span 是一条字幕行，`data-src` 是连续递增的源词序号区间，全部区间首尾相接
/// 覆盖 `1..N`。满足该形状的句子由引擎直接落 blocks/pieces，不再派 align 调用。
///
/// 载体额外带 `data-align-groups`（确定性源侧分组 + 每组时长），让模型在切行
/// 时同时看得见"这一小段说了多久"，从而兼顾读速与排版。
fn fusion_rows_prompt_section(params: &TransParams) -> String {
    format!(
        r#"

Fused display rows (draft channel): editable sentences carry `data-align-words` (the source words, each prefixed with its 1-based ordinal like `[1]I [2]didn't [3]go`), `data-align-needed`, and `data-align-groups`. Sentences without those attributes need only a translation. Read those attributes, then drop them from your answer — the `<span data-src>` rows below are the only thing that must come back, and a sentence that carried `data-align-groups` and comes back WITHOUT rows is an incomplete answer.
- Every sentence carrying `data-align-groups` needs rows — all of them, from the first to the last element in the document. Do not annotate the first few and then fall back to plain translations: the rows are the point of this request, and dropping the attributes above leaves you plenty of room for them.
- `data-align-groups` lists deterministic source groups as `firstOrdinal-lastOrdinal@startSec-endSec`, separated by `;` — the seconds are measured from the start of that sentence, so `5-9@1.4-3.2` means source words 5 to 9 are spoken between 1.4s and 3.2s, lasting 1.8s.
- First write the complete natural translation as the element text. Then, INSIDE that same `<p>`, cut that translation into DISPLAY ROWS: a sequence of `<span data-src="a-b">row</span>` elements whose texts concatenated reproduce the translation exactly — never add, drop, reorder, or rewrite a character, and never leave any text outside a span.
- Each row's `data-src` is ONE contiguous ascending ordinal range. Consecutive rows must be adjacent and together cover every ordinal from 1 to the last one exactly once, in source order: `1-9`, `10-14`, `15-20`. The first row therefore translates the first source words, the second row the next ones, and so on (simultaneous-interpretation style).
- Rows are built out of the groups: a row is exactly one group, or several ADJACENT groups joined together (`1-4` plus `5-9` becomes `data-src="1-9"`). Never cut inside a group.
- AIM FOR {floor} to {fit} display units per row. Group boundaries are candidate cuts, not required cuts — never chop a sentence into many short rows just to land on every one of them. Merge a group into a neighbour whenever that group lasts under 1.5s, or whenever its share of the translation is under 6 display units, unless it ends the sentence; and merge two adjacent groups whenever the joined row still fits {fit} units. A sentence of four groups usually wants two rows, not four.
- Keep every row at most {fit} display units and NEVER above {hard}.
- Reading speed is a target of the same rank: for every row, its display units divided by its duration in seconds (add up the durations of the groups it covers) must be at most 6, and the row must last at least 1s. A row failing either test is too short — join it with a neighbour, and prefer a longer row over one whose words have not been spoken yet.
- Numbers, names, URLs and glossary terms must sit in the row whose ordinal range contains their source ordinal.
- When the natural target word order does not follow the source order at some point, join the groups involved into ONE longer row instead of reordering; if the whole sentence cannot be laid out in source order, emit a single span covering `1-N`. Fewer, longer rows are always better than rows that misstate the correspondence.
- Never distort, shorten, pad, or retranslate the sentence to make the rows come out — the translation is the truth and the rows are a draft. A malformed annotation is silently discarded and never rejects the translation."#,
        // 下限缺省 10；Shorts 等窄预算下 soft 小于 10 时跟着 soft 收，免得写成「10 到 10」。
        floor = params.soft.min(10),
        fit = params.fit,
        hard = params.hard,
    )
}

/// 融合草稿在译文经 AutoCorrect 入库后是否仍可用：块文本拼接与入库译文在
/// [`normalize_chars`] 口径下相等（AutoCorrect 只动空白/标点/大小写）。可用即
/// 原样交给 align 引擎（块在入库译文上的字符区间由 `chunks_to_edges` 顺序定位）。
fn format_fusion_draft(
    draft: &TranslateAlignmentDraft,
    committed_translation: &str,
    source_words: usize,
) -> Option<FusionDraft> {
    let concat: String = draft
        .chunks
        .iter()
        .map(|chunk| chunk.text.as_str())
        .collect();
    if draft.chunks.is_empty() || normalize_chars(&concat) != normalize_chars(committed_translation)
    {
        return None;
    }
    // 行分区在 AutoCorrect 之后再验一次：入库译文才是引擎将要切分的文本。
    let rows = draft.rows && is_row_partition(&draft.chunks, source_words);
    Some(FusionDraft {
        chunks: draft.chunks.clone(),
        rows,
        on_groups: rows && draft.on_groups,
        lines: None,
    })
}

/// 行文本载体的草稿在译文经 AutoCorrect 入库后是否仍可用：把记录的块文本按
/// 有效字符顺序定位到入库译文上重切（[`lines_translation::rebase`]），块文本
/// 拼接就是入库译文；定位不上（AutoCorrect 之外的改动）即丢弃。
fn format_lines_draft(
    draft: &crate::filepipe::TranslateLinesDraft,
    committed_translation: &str,
) -> Option<FusionDraft> {
    let record = lines_translation::rebase(&draft.record, committed_translation)?;
    Some(FusionDraft {
        chunks: Vec::new(),
        rows: false,
        on_groups: false,
        lines: Some(crate::filepipe::TranslateLinesDraft {
            record,
            pieces: draft.pieces.clone(),
            source_words: draft.source_words.clone(),
        }),
    })
}

fn translate_system_prompt(
    source_lang: &str,
    target_lang: &str,
    analysis: Option<&Analysis>,
    brief: Option<&DocumentBrief>,
    tone: Option<TranslationTone>,
    instructions: Option<&str>,
    source_text: &str,
    body: &str,
) -> String {
    let mut prompt = format!(
        "You are a professional subtitle translator translating from \"{source_lang}\" to \"{target_lang}\"."
    );
    if let Some(summary) = brief
        .map(|brief| brief.summary.as_str())
        .filter(|summary| !summary.trim().is_empty())
        .or_else(|| {
            analysis
                .map(|analysis| analysis.summary.as_str())
                .filter(|summary| !summary.trim().is_empty())
        })
    {
        prompt.push_str(&format!("\n\nDocument summary: {summary}"));
    }
    if let Some(analysis) = analysis {
        prompt.push_str(&format!(
            "\n\nSource-language terms confirmed during transcript analysis — recognize them in the source (ASR may misspell them; observed forms are listed) and render each ONE consistent way across the whole document:\n{}",
            format_for_prompt(analysis)
        ));
    }
    if let Some(brief) = brief {
        if !brief.style_guide.trim().is_empty() {
            prompt.push_str(&format!(
                "\n\nGenerated style guide (advisory; fixed target-locale rules and explicit user instructions override it): {}",
                brief.style_guide.trim()
            ));
        }
        let glossary = brief.glossary_for_prompt(source_text, analysis, 80);
        if !glossary.is_empty() {
            let lines = glossary
                .into_iter()
                .map(|entry| {
                    let lock = if entry.locked { "LOCKED" } else { "preferred" };
                    let note = entry
                        .note
                        .as_deref()
                        .filter(|note| !note.trim().is_empty())
                        .map(|note| format!(" ({note})"))
                        .unwrap_or_default();
                    format!("- [{lock}] {} → {}{note}", entry.source, entry.target)
                })
                .collect::<Vec<_>>()
                .join("\n");
            prompt.push_str(&format!(
                "\n\nGlossary — LOCKED entries are exact requirements; preferred entries guide consistency but may yield to context. Each entry has ONE target rendering; never emit slash-separated alternatives — but when an entry's own target contains a slash (a CLI command such as /compact), reproduce it exactly as written:\n{lines}"
            ));
        }
    }
    let mut named_entities = brief
        .map(|brief| brief.named_entities.clone())
        .unwrap_or_default();
    if named_entities.is_empty() {
        named_entities = analysis
            .map(|analysis| analysis.named_entities.clone())
            .unwrap_or_default();
    }
    if !named_entities.is_empty() {
        prompt.push_str(&format!(
            "\n\nNamed entities to preserve and render consistently: {}",
            named_entities.join(" · ")
        ));
    }
    prompt.push_str("\n\n");
    prompt.push_str(body);
    if let Some(policy) = simplified_chinese_prompt_block(target_lang) {
        prompt.push_str("\n\n");
        prompt.push_str(policy);
    }
    if let Some(tone) = tone {
        prompt.push_str("\n\nTone: ");
        prompt.push_str(tone.prompt_line());
    }
    if let Some(instructions) = instructions.filter(|text| !text.is_empty()) {
        prompt.push_str(&format!(
            "\n\nExplicit user instructions (highest content-specific priority; do not violate LOCKED glossary renderings or the document contract): {instructions}"
        ));
    }
    prompt
}

// ---- 响应校验 -------------------------------------------------------------

/// 文件契约（`file-v1`）的 `task submit` 镜像 lint。
///
/// `input` 是磁盘上那份渲染文本。校验**只有一份**：这里先用
/// [`parse_translate_source`] 复原校验等价的渲染结构，再走引擎同一个
/// [`parse_translate_page`]，不存在第二套判据。
///
/// 判据同引擎：`page_rejected`（整页作废）或存在 `retry_ids`（缺句/空译/
/// 术语缺失）才拒；可编辑句的 `paragraph-move` 与 `unknown-id` 是 advisory，
/// 不拒——否则 agent 会在无法消除的告警上无限空转。
pub fn lint_agent_answer_file(input: &str, answer: &str) -> Vec<String> {
    let Some(page) = parse_translate_source(input) else {
        return Vec::new();
    };
    let mut parsed = parse_translate_page(&page, Some(input), answer);
    crate::filepipe::translate_html::validate_translation_quality(&page, &mut parsed);
    if !parsed.page_rejected && parsed.retry_ids.is_empty() {
        return Vec::new();
    }
    parsed
        .diagnostics
        .problems
        .iter()
        .map(|problem| match &problem.scope {
            crate::filepipe::ProblemScope::Sentence { id } => {
                format!("[{}] {id}: {}", problem.code, problem.detail)
            }
            _ => format!("[{}] {}", problem.code, problem.detail),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cue::CueParams;
    use crate::doc::{AlignMode, DocEngine, DocMedia, Speaker, TransAlign, Word};
    use crate::llm::FakeLlm;
    use crate::split::TransParams;
    use std::collections::VecDeque;

    struct ScriptedBatchLlm {
        rounds: VecDeque<Vec<(usize, Result<String, LlmError>)>>,
        requests: Vec<Vec<(String, Option<String>)>>,
    }

    impl ScriptedBatchLlm {
        fn new(rounds: Vec<Vec<(usize, Result<String, LlmError>)>>) -> Self {
            Self {
                rounds: rounds.into(),
                requests: Vec::new(),
            }
        }
    }

    impl LlmJson for ScriptedBatchLlm {
        fn complete(&mut self, _: &LlmRequest) -> Result<String, LlmError> {
            panic!("translate should use complete_batch_with")
        }

        fn complete_batch_with(
            &mut self,
            requests: &[LlmRequest],
            on_ready: &mut dyn FnMut(usize, Result<String, LlmError>),
        ) {
            self.requests.push(
                requests
                    .iter()
                    .map(|request| (request.user.clone(), request.retry_reason.clone()))
                    .collect(),
            );
            for (index, result) in self.rounds.pop_front().expect("scripted batch round") {
                on_ready(index, result);
            }
        }
    }

    fn doc_with_words(words: Vec<Word>) -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 1000.0,
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
        doc.words = words;
        doc
    }

    fn w(id: &str, t0: f64, t1: f64, text: &str, sp: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1,
            text: text.to_owned(),
            sp: sp.to_owned(),
            glue: false,
        }
    }

    /// 句1 = 两 Cue（"echo," 处 pause_punct 断行 / "hotel." 句末）；
    /// 句2 = 单 Cue "Done."。
    fn two_sentence_doc() -> TranscriptDoc {
        doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "alpha", "s1"),
            w("g1.1", 0.4, 0.8, "bravo", "s1"),
            w("g1.2", 0.8, 1.2, "charlie", "s1"),
            w("g1.3", 1.2, 1.6, "delta", "s1"),
            w("g1.4", 1.6, 2.0, "echo,", "s1"),
            w("g1.5", 2.0, 2.4, "foxtrot", "s1"),
            w("g1.6", 2.4, 2.8, "golf", "s1"),
            w("g1.7", 2.8, 3.2, "hotel.", "s1"),
            w("g2.0", 3.4, 3.8, "Done.", "s1"),
        ])
    }

    fn options(lang: &str) -> TranslateOptions {
        TranslateOptions {
            source_lang: "en".to_owned(),
            lang: lang.to_owned(),
            force: false,
            sentences: None,
            page_budget: crate::paging::budgets::TRANSLATE_PROVIDER_WORDS,
            instructions: None,
            analysis: None,
            brief: None,
            tone: None,
            autocorrect: true,
            align: None,
            align_rows: false,
            align_lines: false,
            worker_slots: None,
            provenance_stale: BTreeSet::new(),
        }
    }

    #[test]
    fn word_balancing_uses_only_source_words() {
        let source_words = [10, 10, 10, 10, 10, 10];
        let sizes = translate_page_sizes(&source_words, 30);
        assert_eq!(sizes, vec![3, 3]);
        assert_eq!(sizes.len(), 2);
        assert_eq!(sizes.iter().sum::<usize>(), source_words.len());
    }

    #[test]
    fn sentence_count_does_not_split_a_page_under_the_word_budget() {
        // 218 句 × 10 词 = 2180 ≤ 2000 + 200 slack：句数多也不拆页。
        let source_words = vec![10_usize; 218];
        let budget = crate::paging::budgets::TRANSLATE_PROVIDER_WORDS;
        assert_eq!(218 * 10, 2180);
        assert_eq!(translate_page_sizes(&source_words, budget), vec![218]);
        assert!(fits_single_translate_page(218, 2180, budget));
    }

    #[test]
    fn long_documents_split_only_at_word_budget_multiples() {
        // 9860 词 ÷ (2000 + 200 slack) → 5 页，每页约 1972 词。
        let source_words = vec![20_usize; 493];
        let sizes = translate_page_sizes(
            &source_words,
            crate::paging::budgets::TRANSLATE_PROVIDER_WORDS,
        );
        assert_eq!(sizes.len(), 5);
        assert_eq!(sizes.iter().sum::<usize>(), 493);
        assert!(sizes.iter().max().unwrap() - sizes.iter().min().unwrap() <= 1);
    }

    #[test]
    fn a_talk_that_the_old_budget_kept_whole_now_splits_in_two() {
        // 193 句 / 3571 词的谈话（p-00ec2e27 基线）：旧 5000 档单页、多 worker
        // 闲置；agent 与 provider 两档都分成 2 页并行认领。
        let source_words = vec![18_usize; 199];
        assert_eq!(199 * 18, 3582);
        assert!(fits_single_translate_page(199, 3582, 5000));
        for executor in [
            crate::paging::PageExecutor::Agent,
            crate::paging::PageExecutor::Provider,
        ] {
            let budget = executor.translate_words();
            assert!(!fits_single_translate_page(199, 3582, budget));
            let sizes = translate_page_sizes(&source_words, budget);
            assert_eq!(sizes.len(), 2);
            assert!(sizes.iter().all(|size| size * 18 <= budget + budget / 10));
        }
    }

    #[test]
    fn word_budget_drives_page_count_for_long_sentences() {
        let source_words = vec![500_usize; 6];
        let budget = 1000;
        assert_eq!(translate_page_sizes(&source_words, budget), vec![2, 2, 2]);

        // 预算把每条都单独成页时，页数被 clamp 回条目数，不会切出空页。
        let dense_words = vec![100_usize; 10];
        let sizes = translate_page_sizes(&dense_words, 100);
        assert_eq!(sizes.len(), 10);
        assert!(sizes.iter().all(|size| *size == 1));
    }

    #[test]
    fn run_translate_lands_sentences_and_stamps_into_doc() {
        let mut doc = two_sentence_doc();
        let mut llm = FakeLlm::new([Ok(file_answer(&[
            ("s-g1.0", "第一段译文,第二段收尾。"),
            ("s-g2.0", "完成。"),
        ]))]);
        let mut page_snapshots = Vec::new();
        let outcome = run_translate(
            &mut doc,
            &mut llm,
            &options("zh"),
            &mut |doc| page_snapshots.push(doc.trans["zh"].len()),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.translated_sentences, 2);
        assert_eq!(outcome.skipped_sentences, 0);
        assert_eq!(outcome.total_sentences, 2);
        assert_eq!(doc.trans["zh"]["s-g1.0"], "第一段译文，第二段收尾。");
        assert_eq!(doc.trans["zh"]["s-g2.0"], "完成。");
        // 句指纹随页盖章 ⇒ stale 为空。
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert!(stale_sentences(&doc, "zh", &sentences).is_empty());
        assert_eq!(page_snapshots, vec![2]);

        assert_eq!(llm.calls.len(), 1);
        let (kind, system, user, retry) = &llm.calls[0];
        assert_eq!(kind, "translate");
        assert!(system.contains("professional subtitle translator"));
        assert!(system.contains("from \"en\" to \"zh\""));
        assert!(retry.is_none());
        // HTML 载荷；zh CPS=9：3.2s → 28、"Done." 0.4s×9 → 3。
        assert!(user.contains("id=\"s-g1.0\""), "{user}");
        assert!(user.contains("data-budget=\"整句≤28字\""), "{user}");
        assert!(user.contains("data-budget=\"整句≤3字\""), "{user}");
    }

    #[test]
    fn fused_translate_only_marks_sentences_that_already_need_splitting() {
        let mut doc = two_sentence_doc();
        doc.words[7].t1 = 8.0;
        doc.words[8].t0 = 8.2;
        doc.words[8].t1 = 8.6;
        let mut llm = FakeLlm::new([Ok(file_answer(&[
            ("s-g1.0", "第一段译文，第二段收尾。"),
            ("s-g2.0", "完成。"),
        ]))]);
        let mut options = options("zh-Hans");
        options.align = Some(TransParams::for_lang("zh-Hans"));

        run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();

        let user = &llm.calls[0].2;
        let long = user
            .lines()
            .find(|line| line.contains("id=\"s-g1.0\""))
            .expect("long sentence row");
        let short = user
            .lines()
            .find(|line| line.contains("id=\"s-g2.0\""))
            .expect("short sentence row");
        assert!(
            long.contains("data-align-words=\"[1]alpha [2]bravo [3]charlie [4]delta [5]echo, [6]foxtrot [7]golf [8]hotel.\""),
            "{long}"
        );
        assert!(long.contains("data-align-needed=\"true\""), "{long}");
        assert!(!short.contains("data-align-words="), "{short}");
        assert!(!short.contains("data-align-needed="), "{short}");
    }

    #[test]
    fn run_translate_respects_disabled_autocorrect() {
        let mut doc = two_sentence_doc();
        let mut llm = FakeLlm::new([Ok(file_answer(&[
            ("s-g1.0", "在Claude里开发."),
            ("s-g2.0", "完成."),
        ]))]);
        let mut options = options("zh-Hans");
        options.autocorrect = false;

        run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();

        assert_eq!(doc.trans["zh-Hans"]["s-g1.0"], "在Claude里开发.");
        assert_eq!(doc.trans["zh-Hans"]["s-g2.0"], "完成.");
    }

    #[test]
    fn routed_translate_keeps_timeline_order_and_scatter_keys() {
        let rows = vec![
            RoutedSentence {
                route_id: "r1".to_owned(),
                src_id: "src-b".to_owned(),
                sentence_id: "s-b1".to_owned(),
                source_lang: "ja".to_owned(),
                source_text: "先に見せる。".to_owned(),
                src_fingerprint: "visible-b".to_owned(),
                display_duration: 2.0,
                translation: None,
                stamped_fingerprint: None,
            },
            RoutedSentence {
                route_id: "r2".to_owned(),
                src_id: "main".to_owned(),
                sentence_id: "s-a1".to_owned(),
                source_lang: "en".to_owned(),
                source_text: "Then the main source.".to_owned(),
                src_fingerprint: "visible-a".to_owned(),
                display_duration: 3.0,
                translation: Some("old".to_owned()),
                stamped_fingerprint: Some("old-visible".to_owned()),
            },
            RoutedSentence {
                route_id: "r3".to_owned(),
                src_id: "main".to_owned(),
                sentence_id: "s-a2".to_owned(),
                source_lang: "en".to_owned(),
                source_text: "A legacy unstamped translation.".to_owned(),
                src_fingerprint: "visible-a2".to_owned(),
                display_duration: 2.0,
                translation: Some("legacy".to_owned()),
                stamped_fingerprint: None,
            },
        ];
        let mut llm = FakeLlm::new([Ok("<article><section id=\"p-src-b\"><p id=\"r1\">先展示。</p></section><section id=\"p-main\"><p id=\"r2\">然后是主素材。</p><p id=\"r3\">补盖可见指纹。</p></section></article>".to_owned())]);
        let mut pages = Vec::new();
        let outcome = run_routed_translate(
            &rows,
            &mut llm,
            &RoutedTranslateOptions {
                lang: "zh-Hans".to_owned(),
                force: false,
                sentences: None,
                page_budget: 10_000,
                instructions: None,
                analysis: None,
                brief: None,
                tone: None,
                autocorrect: true,
                chapter_titles: Vec::new(),
                worker_slots: None,
            },
            &mut |page| pages.push(page.to_vec()),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.translated_sentences, 3);
        assert_eq!(pages[0][0].src_id, "src-b");
        assert_eq!(pages[0][0].sentence_id, "s-b1");
        assert_eq!(pages[0][0].src_fingerprint, "visible-b");
        assert_eq!(pages[0][1].src_id, "main");
        assert_eq!(pages[0][2].sentence_id, "s-a2");
        let user = &llm.calls[0].2;
        assert!(user.find("先に見せる").unwrap() < user.find("Then the main").unwrap());
    }

    /// routed 路径的两句最小语料：同一源片段 ⇒ 文件契约下同属 `p-main` 段。
    fn routed_pair() -> Vec<RoutedSentence> {
        vec![
            RoutedSentence {
                route_id: "r1".to_owned(),
                src_id: "main".to_owned(),
                sentence_id: "s-a1".to_owned(),
                source_lang: "en".to_owned(),
                source_text: "First line.".to_owned(),
                src_fingerprint: "fp-a1".to_owned(),
                display_duration: 2.0,
                translation: None,
                stamped_fingerprint: None,
            },
            RoutedSentence {
                route_id: "r2".to_owned(),
                src_id: "main".to_owned(),
                sentence_id: "s-a2".to_owned(),
                source_lang: "en".to_owned(),
                source_text: "Second line.".to_owned(),
                src_fingerprint: "fp-a2".to_owned(),
                display_duration: 2.0,
                translation: None,
                stamped_fingerprint: None,
            },
        ]
    }

    fn routed_options() -> RoutedTranslateOptions {
        RoutedTranslateOptions {
            lang: "zh-Hans".to_owned(),
            force: false,
            sentences: None,
            page_budget: 10_000,
            instructions: None,
            analysis: None,
            brief: None,
            tone: None,
            autocorrect: false,
            chapter_titles: Vec::new(),
            worker_slots: None,
        }
    }

    fn routed_file_answer(pairs: &[(&str, &str)]) -> String {
        let mut out = String::from("<article><section id=\"p-main\">");
        for (id, text) in pairs {
            out.push_str(&format!("<p id=\"{id}\">{text}</p>"));
        }
        out.push_str("</section></article>");
        out
    }

    #[test]
    fn file_contract_routed_reports_every_page_attempt() {
        let rows = routed_pair();
        let mut llm = ScriptedBatchLlm::new(vec![
            // 一个期望句都没解析到（page-fatal）⇒ 同一页第二次尝试。
            vec![(0, Ok("好的，这是翻译：一。二。".to_owned()))],
            vec![(0, Ok(routed_file_answer(&[("r1", "一。"), ("r2", "二。")])))],
        ]);
        let mut attempts: Vec<(String, u32, bool, bool)> = Vec::new();
        let mut pages = Vec::new();
        let outcome = run_routed_translate_with_artifacts(
            &rows,
            &mut llm,
            &routed_options(),
            &mut |page| pages.push(page.to_vec()),
            &mut |attempt| {
                attempts.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    attempt.input.contains("id=\"r1\"") && !attempt.output.is_empty(),
                ));
            },
            &mut |_| {},
        )
        .expect("routed file contract translate");

        assert_eq!(outcome.translated_sentences, 2);
        // 波 1 的两次页级尝试各回调一次；没有多余的修复波。
        assert_eq!(llm.requests.len(), 2);
        assert_eq!(
            attempts.len(),
            2,
            "extra attempts would mean a repair wave fired: {attempts:?}"
        );
        assert_eq!(
            attempts,
            vec![
                ("p001".to_owned(), 1, false, true),
                ("p001".to_owned(), 2, true, true),
            ]
        );
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].len(), 2);
        assert_eq!(pages[0][0].sentence_id, "s-a1");
    }

    #[test]
    fn rerun_skips_fresh_sentences_and_retranslates_stale_only() {
        let mut doc = two_sentence_doc();
        let mut llm = FakeLlm::new([Ok(file_answer(&[("s-g1.0", "甲。"), ("s-g2.0", "乙。")]))]);
        run_translate(&mut doc, &mut llm, &options("zh"), &mut |_| {}, &mut |_| {}).unwrap();

        // 全部新鲜 ⇒ 零调用。
        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());
        let outcome =
            run_translate(&mut doc, &mut llm, &options("zh"), &mut |_| {}, &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 0);
        assert_eq!(outcome.translated_sentences, 0);
        assert_eq!(outcome.skipped_sentences, 2);

        // 编辑句 1 的词 ⇒ 只重翻句 1。
        doc.words[2].text = "charlee".to_owned();
        let mut llm = FakeLlm::new([Ok(file_answer(&[("s-g1.0", "重翻。")]))]);
        let outcome =
            run_translate(&mut doc, &mut llm, &options("zh"), &mut |_| {}, &mut |_| {}).unwrap();
        assert_eq!(outcome.translated_sentences, 1);
        assert_eq!(outcome.skipped_sentences, 1);
        assert!(!llm.calls[0].2.contains("s-g2.0"));
        assert_eq!(doc.trans["zh"]["s-g1.0"], "重翻。");
        assert_eq!(doc.trans["zh"]["s-g2.0"], "乙。");

        // force ⇒ 全部重翻。
        let mut llm = FakeLlm::new([Ok(file_answer(&[
            ("s-g1.0", "强一。"),
            ("s-g2.0", "强二。"),
        ]))]);
        let mut opts = options("zh");
        opts.force = true;
        let outcome = run_translate(&mut doc, &mut llm, &opts, &mut |_| {}, &mut |_| {}).unwrap();
        assert_eq!(outcome.translated_sentences, 2);
    }

    #[test]
    fn sentence_filter_retranslates_only_the_selected_fresh_sentence() {
        let mut doc = two_sentence_doc();
        let mut llm = FakeLlm::new([Ok(file_answer(&[("s-g1.0", "甲。"), ("s-g2.0", "乙。")]))]);
        run_translate(&mut doc, &mut llm, &options("zh"), &mut |_| {}, &mut |_| {}).unwrap();

        let mut opts = options("zh");
        opts.sentences = Some(BTreeSet::from(["s-g1.0".to_owned()]));
        let mut llm = FakeLlm::new([Ok(file_answer(&[("s-g1.0", "定向重翻。")]))]);
        let outcome = run_translate(&mut doc, &mut llm, &opts, &mut |_| {}, &mut |_| {}).unwrap();

        assert_eq!(outcome.translated_sentences, 1);
        assert_eq!(outcome.skipped_sentences, 1);
        assert_eq!(doc.trans["zh"]["s-g1.0"], "定向重翻。");
        assert_eq!(doc.trans["zh"]["s-g2.0"], "乙。");
        assert_eq!(llm.calls.len(), 1);
        assert!(!llm.calls[0].2.contains("s-g2.0"));
    }

    #[test]
    fn rerun_prunes_orphan_translation_state_without_calling_llm() {
        let mut doc = two_sentence_doc();
        let mut llm = FakeLlm::new([Ok(file_answer(&[("s-g1.0", "甲。"), ("s-g2.0", "乙。")]))]);
        run_translate(&mut doc, &mut llm, &options("zh"), &mut |_| {}, &mut |_| {}).unwrap();

        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert("s-retired".to_owned(), "旧译文".to_owned());
        doc.trans_src
            .entry("zh".to_owned())
            .or_default()
            .insert("s-retired".to_owned(), "old-fingerprint".to_owned());
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            "s-retired".to_owned(),
            TransAlign {
                mode: AlignMode::ManyToOne,
                crossing: false,
                correspondence: None,
                text_basis: Default::default(),
                aligner: None,
                blocks: Vec::new(),
                cues: vec![],
                words: vec![],
                pieces: vec![],
            },
        );

        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());
        let mut snapshots = Vec::new();
        let outcome = run_translate(
            &mut doc,
            &mut llm,
            &options("zh"),
            &mut |doc| {
                snapshots.push((
                    doc.trans["zh"].contains_key("s-retired"),
                    doc.trans_src["zh"].contains_key("s-retired"),
                    doc.trans_align["zh"].contains_key("s-retired"),
                ));
            },
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(outcome.translated_sentences, 0);
        assert_eq!(outcome.skipped_sentences, 2);
        assert!(llm.calls.is_empty());
        assert_eq!(snapshots, vec![(false, false, false)]);
        assert_eq!(doc.trans["zh"].len(), 2);
        assert_eq!(doc.trans_src["zh"].len(), 2);
        assert!(doc.trans_align["zh"].is_empty());
    }

    #[test]
    fn run_translate_stops_on_terminal_without_retry() {
        // 格式错误的重试/耗尽语义由 file_contract_* 系列测试覆盖；这里只钉
        // Terminal 直接上抛、不重试、doc 不落任何页。
        let mut doc = two_sentence_doc();
        let mut llm = FakeLlm::new([Err(LlmError::Terminal("401".to_owned()))]);
        let result = run_translate(&mut doc, &mut llm, &options("zh"), &mut |_| {}, &mut |_| {});
        assert!(matches!(result, Err(LlmError::Terminal(_))));
        assert_eq!(llm.calls.len(), 1);
        assert!(doc.trans.is_empty());
    }

    #[test]
    fn paging_splits_by_budget_and_carries_static_neighbour_context() {
        let mut doc = two_sentence_doc();
        let mut opts = options("zh");
        opts.page_budget = 1; // 词数预算 1：每句独占一页
        let mut llm = FakeLlm::new([
            Ok(file_answer(&[("s-g1.0", "第一页。")])),
            Ok(file_answer(&[("s-g2.0", "第二页。")])),
        ]);
        let mut page_sizes = Vec::new();
        let outcome = run_translate(
            &mut doc,
            &mut llm,
            &opts,
            &mut |doc| page_sizes.push(doc.trans["zh"].len()),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.translated_sentences, 2);
        assert_eq!(llm.calls.len(), 2);
        assert_eq!(page_sizes, vec![1, 2]);
        assert!(
            llm.calls[0].2.contains("context-after: Done."),
            "{}",
            llm.calls[0].2
        );
        assert!(!llm.calls[0].2.contains("context-before"));
        assert!(
            llm.calls[1].2.contains("context-before: alpha bravo"),
            "{}",
            llm.calls[1].2
        );
    }

    #[test]
    fn batch_retries_only_the_bad_page_and_checkpoints_out_of_order_success() {
        let mut doc = two_sentence_doc();
        let mut opts = options("zh");
        opts.page_budget = 1;
        let mut llm = ScriptedBatchLlm::new(vec![
            vec![
                (1, Ok(file_answer(&[("s-g2.0", "第二页。")]))),
                // 一个期望句都没解析到 ⇒ page-fatal,只有这一页整页重试。
                (0, Ok("好的，这是第一页的翻译。".to_owned())),
            ],
            vec![(0, Ok(file_answer(&[("s-g1.0", "第一页。")])))],
        ]);
        let mut snapshots = Vec::new();
        run_translate(
            &mut doc,
            &mut llm,
            &opts,
            &mut |doc| snapshots.push(doc.trans["zh"].keys().cloned().collect::<Vec<_>>()),
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(snapshots[0], vec!["s-g2.0"]);
        assert_eq!(snapshots[1], vec!["s-g1.0", "s-g2.0"]);
        assert_eq!(llm.requests[0].len(), 2);
        assert_eq!(llm.requests[1].len(), 1);
        assert!(llm.requests[0].iter().all(|(_, reason)| reason.is_none()));
        assert!(
            llm.requests[1][0]
                .1
                .as_deref()
                .unwrap()
                .contains("document-wrapped")
        );
    }

    #[test]
    fn terminal_batch_error_keeps_successful_pages_from_the_same_round() {
        let mut doc = two_sentence_doc();
        let mut opts = options("zh");
        opts.page_budget = 1;
        let mut llm = ScriptedBatchLlm::new(vec![vec![
            (0, Err(LlmError::Terminal("401".to_owned()))),
            (1, Ok(file_answer(&[("s-g2.0", "已落盘。")]))),
        ]]);
        let mut snapshots = Vec::new();
        let result = run_translate(
            &mut doc,
            &mut llm,
            &opts,
            &mut |doc| snapshots.push(doc.trans["zh"].len()),
            &mut |_| {},
        );

        assert!(matches!(result, Err(LlmError::Terminal(_))));
        assert_eq!(snapshots, vec![1]);
        assert_eq!(doc.trans["zh"]["s-g2.0"], "已落盘。");
        assert_eq!(llm.requests.len(), 1);
    }

    #[test]
    fn reading_budget_cps_varies_by_target_lang() {
        let doc = two_sentence_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(reading_budget(&doc, &sentences[0], "zh-CN"), 28);
        assert_eq!(reading_budget(&doc, &sentences[0], "ja"), 41);
        assert_eq!(reading_budget(&doc, &sentences[0], "fr"), 67);
        assert_eq!(reading_budget(&doc, &sentences[1], "zh"), 3);
    }

    #[test]
    fn instructions_append_to_system_prompt() {
        let prompt = translate_system_prompt(
            "en",
            "zh",
            None,
            None,
            None,
            Some("正式书面语"),
            "",
            TRANSLATE_FILE_PROMPT_BODY,
        );
        assert!(prompt.contains("Explicit user instructions"));
        assert!(prompt.ends_with("正式书面语"));
        let prompt = translate_system_prompt(
            "en",
            "zh-Hant",
            None,
            None,
            None,
            None,
            "",
            TRANSLATE_FILE_PROMPT_BODY,
        );
        assert!(!prompt.contains("Explicit user instructions"));
        assert!(!prompt.contains("Simplified-Chinese target policy"));
        assert!(prompt.contains("cannot recover an omitted clause"));
    }

    #[test]
    fn term_presence_uses_identifier_boundaries_and_cjk_contains() {
        assert!(term_present("Air is a model", "Air"));
        assert!(!term_present("Airport is nearby", "Air"));
        assert!(term_present("We compile C++ today", "C++"));
        assert!(term_present("使用宝剪辑处理字幕", "宝剪辑"));
    }

    #[test]
    fn prompt_includes_analysis_brief_tone_and_chapters() {
        let mut doc = two_sentence_doc();
        doc.chapters.push(crate::doc::Chapter {
            id: "ch1".to_owned(),
            title: "Opening".to_owned(),
            start: 0.0,
            end: 10.0,
        });
        let mut opts = options("zh-Hans");
        opts.analysis = Some(Analysis {
            summary: "source summary".to_owned(),
            terms: vec![],
            named_entities: vec!["Alice".to_owned()],
            fingerprint: "fp".to_owned(),
            reference_fingerprint: None,
        });
        opts.brief = Some(DocumentBrief {
            summary: "译向摘要".to_owned(),
            style_guide: "短句".to_owned(),
            named_entities: vec!["BaoCut".to_owned()],
            ..Default::default()
        });
        opts.tone = Some(TranslationTone::Casual);
        let mut llm = FakeLlm::new([Ok(file_answer(&[
            ("s-g1.0", "第一段。"),
            ("s-g2.0", "完成。"),
        ]))]);
        run_translate(&mut doc, &mut llm, &opts, &mut |_| {}, &mut |_| {}).unwrap();
        let system = &llm.calls[0].1;
        assert!(system.contains("Document summary: 译向摘要"));
        assert!(system.contains("Generated style guide"));
        assert!(system.contains("BaoCut"));
        assert!(system.contains("conversational register"));
        assert!(system.contains("Simplified-Chinese target policy"));
        assert!(system.contains("Chapters (document context only"));
        assert!(system.contains("Opening"));
    }

    // ---- 文件契约（file-v1）--------------------------------------------

    /// 三句单段：`s-g1.0` / `s-g2.0` / `s-g3.0` 全落在段 `p-g1.0`。
    fn three_sentence_doc() -> TranscriptDoc {
        doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "alpha", "s1"),
            w("g1.1", 0.4, 0.8, "bravo", "s1"),
            w("g1.2", 0.8, 1.2, "charlie.", "s1"),
            w("g2.0", 1.4, 1.8, "delta", "s1"),
            w("g2.1", 1.8, 2.2, "echo.", "s1"),
            w("g3.0", 2.4, 2.8, "foxtrot", "s1"),
            w("g3.1", 2.8, 3.2, "golf.", "s1"),
        ])
    }

    /// `count` 句 × 10 词的稿，全部落在同一页（rows 档 880 词以内）。
    fn rows_page_doc(count: usize) -> TranscriptDoc {
        let mut words = Vec::new();
        let mut clock = 0.0f64;
        for sentence in 0..count {
            for index in 0..10 {
                let text = if index == 9 {
                    "end.".to_owned()
                } else {
                    format!("word{index}")
                };
                words.push(w(
                    &format!("g{sentence}.{index}"),
                    clock,
                    clock + 0.4,
                    &text,
                    "s1",
                ));
                clock += 0.4;
            }
            clock += 0.9;
        }
        doc_with_words(words)
    }

    fn file_answer(pairs: &[(&str, &str)]) -> String {
        let mut out = String::from("<article><section id=\"p-g1.0\">");
        for (id, text) in pairs {
            out.push_str(&format!("<p id=\"{id}\">{text}</p>"));
        }
        out.push_str("</section></article>");
        out
    }

    #[test]
    fn file_contract_renders_html_and_writes_truth() {
        let mut doc = three_sentence_doc();
        let mut llm = ScriptedBatchLlm::new(vec![vec![(
            0,
            Ok(file_answer(&[
                ("s-g1.0", "一。"),
                ("s-g2.0", "二。"),
                ("s-g3.0", "三。"),
            ])),
        )]]);
        let mut pages = 0;
        let outcome = run_translate(
            &mut doc,
            &mut llm,
            &options("zh-Hans"),
            &mut |_| pages += 1,
            &mut |_| {},
        )
        .expect("file contract translate");

        let sent = &llm.requests[0][0].0;
        assert!(
            sent.contains("data-bcut-format=\"translation-source/1\""),
            "{sent}"
        );
        assert!(
            sent.contains("<section id=\"p-g1.0\" data-sp=\"s1\">"),
            "{sent}"
        );
        // 逐句阅读预算是 file-v1 的长度通道（对拍 json-v0 的 `maxChars`）：
        // 没有它，译者不知道成品是字幕，展示宽度会整体膨胀。
        assert!(
            sent.contains("<p id=\"s-g2.0\" data-budget=\"整句≤7字\">delta echo.</p>"),
            "{sent}"
        );
        // §7.7：文件契约不再挂融合契约段。
        assert!(!sent.contains("sourceBreaks"));

        assert_eq!(outcome.translated_sentences, 3);
        let trans = &doc.trans["zh-Hans"];
        assert_eq!(trans["s-g1.0"], "一。");
        assert_eq!(trans["s-g3.0"], "三。");
        assert_eq!(doc.trans_src["zh-Hans"].len(), 3);
        assert!(pages >= 1);
    }

    #[test]
    fn file_contract_rejected_page_retries_whole_page() {
        let mut doc = three_sentence_doc();
        let mut llm = ScriptedBatchLlm::new(vec![
            // 一个期望句都没解析到 ⇒ page-fatal，整页重试。
            vec![(0, Ok("好的，这是翻译：一。二。三。".to_owned()))],
            vec![(
                0,
                Ok(file_answer(&[
                    ("s-g1.0", "一。"),
                    ("s-g2.0", "二。"),
                    ("s-g3.0", "三。"),
                ])),
            )],
        ]);
        run_translate(
            &mut doc,
            &mut llm,
            &options("zh-Hans"),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("retry succeeds");
        assert_eq!(doc.trans["zh-Hans"].len(), 3);
        let reason = llm.requests[1][0]
            .1
            .as_deref()
            .expect("second round carries a retry reason");
        assert!(reason.contains("document-wrapped"), "{reason}");
    }

    /// M4 端到端：`context.md` / `context.<lang>.md` → brief → 文件契约
    /// translate 的 `data-rt` → 缺锁定译名被拒 → align 的保护词/锚点。
    ///
    /// 只断言「转换后 locked=true」证明不了这条链是通的，所以这里从 Markdown
    /// 原文起跳，一路断言到引擎真的拒页。
    #[test]
    fn file_contract_terms_flow_from_context_md_into_translate_and_align() {
        let source_md = "---\nformat: \"context-doc/1\"\nfingerprint: \"fp\"\n---\n\n\
# Summary\nA product demo.\n\n\
# Canonical Terms\n| Source | Category | Variants | Note | Lock | Origin |\n\
|---|---|---|---|---|---|\n| Air | product | | 机型 | yes | user |\n";
        let target_md = "---\nformat: \"context-doc/1\"\ntargetLang: \"zh-Hans\"\nfingerprint: \"fp\"\n---\n\n\
# Translated Summary\n产品演示。\n\n\
# Bilingual Glossary\n| Source | Target | Note | Lock | Origin |\n\
|---|---|---|---|---|\n| Air | 空气 | 机型 | yes | user |\n\n\
# Translation Style\n短句。\n\n# Difficulties\n";
        let source = crate::filepipe::parse_source_context(None, source_md)
            .context
            .expect("source context parses");
        let target = crate::filepipe::parse_target_context(None, target_md)
            .context
            .expect("target context parses");
        let brief = crate::engines::brief::brief_from_target_context(&target, Some(&source));
        // Lock=yes → GlossaryEntry.locked；Category=product → 命名实体。
        assert!(brief.glossary[0].locked);
        assert_eq!(brief.named_entities, vec!["Air".to_owned()]);

        let mut doc = three_sentence_doc();
        doc.words[0].text = "Air".to_owned();
        let mut opts = options("zh-Hans");
        opts.brief = Some(brief.clone());

        // 漏掉锁定译名 → 三次尝试全被拒。
        let miss = file_answer(&[("s-g1.0", "一。"), ("s-g2.0", "二。"), ("s-g3.0", "三。")]);
        let mut llm = ScriptedBatchLlm::new(vec![
            vec![(0, Ok(miss.clone()))],
            vec![(0, Ok(miss.clone()))],
            vec![(0, Ok(miss))],
        ]);
        let outcome = run_translate(&mut doc, &mut llm, &opts, &mut |_| {}, &mut |_| {})
            .expect("file contract degrades per line, not per run");
        // 文件契约按行部分成功：漏译锁定术语的那一句重试到耗尽后仍被拒，
        // 既不入库也不进溯源账本；同页其它句照常落地。
        assert!(!doc.trans["zh-Hans"].contains_key("s-g1.0"));
        assert!(!outcome.committed_sentences.contains("s-g1.0"));
        assert!(outcome.committed_sentences.contains("s-g2.0"));
        // rt 确实随页面下发。
        assert!(
            llm.requests[0][0].0.contains("data-rt="),
            "{}",
            llm.requests[0][0].0
        );
        assert!(
            llm.requests[0][0].0.contains("空气"),
            "{}",
            llm.requests[0][0].0
        );

        let mut llm = ScriptedBatchLlm::new(vec![vec![(
            0,
            Ok(file_answer(&[
                ("s-g1.0", "空气一。"),
                ("s-g2.0", "二。"),
                ("s-g3.0", "三。"),
            ])),
        )]]);
        run_translate(&mut doc, &mut llm, &opts, &mut |_| {}, &mut |_| {})
            .expect("locked target satisfied");
        assert_eq!(doc.trans["zh-Hans"]["s-g1.0"], "空气一。");

        // align 侧：保护词与双语锚点（宿主按 glossary 直投）都拿到该术语。
        assert!(
            brief
                .protected_targets_for_fit("zh-Hans", TransParams::for_lang("zh-Hans").fit)
                .contains(&"空气".to_owned())
        );
        assert_eq!(brief.glossary[0].source, "Air");
        assert_eq!(brief.glossary[0].target, "空气");
    }

    #[test]
    fn file_contract_missing_sentence_goes_to_a_repair_wave() {
        let mut doc = three_sentence_doc();
        let mut llm = ScriptedBatchLlm::new(vec![
            // 中间句缺失：不是尾部连续缺失，因此按 missing-id 进句级修复波。
            vec![(
                0,
                Ok(file_answer(&[("s-g1.0", "一。"), ("s-g3.0", "三。")])),
            )],
            vec![(0, Ok(file_answer(&[("s-g2.0", "二。")])))],
        ]);
        run_translate(
            &mut doc,
            &mut llm,
            &options("zh-Hans"),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("repair wave succeeds");
        assert_eq!(doc.trans["zh-Hans"].len(), 3);
        assert_eq!(doc.trans["zh-Hans"]["s-g2.0"], "二。");
        // 修复波只重发缺的那一句。
        let repair = &llm.requests[1][0].0;
        assert!(repair.contains("id=\"s-g2.0\""), "{repair}");
        assert!(!repair.contains("id=\"s-g1.0\""), "{repair}");
    }

    #[test]
    fn file_contract_never_stamps_a_sentence_it_did_not_translate() {
        let mut doc = doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "alpha", "s1"),
            w("g1.1", 0.4, 0.8, "bravo.", "s1"),
            w("g2.0", 1.0, 1.4, "charlie", "s1"),
            w("g2.1", 1.4, 1.8, "delta.", "s1"),
            w("g3.0", 2.0, 2.4, "echo", "s1"),
            w("g3.1", 2.4, 2.8, "foxtrot.", "s1"),
            w("g4.0", 3.0, 3.4, "golf", "s1"),
            w("g4.1", 3.4, 3.8, "hotel.", "s1"),
        ]);
        // 每一波都少交一句，且缺的都不是尾部连续缺失（那是 document-truncated 拒页），
        // 于是 s-g2.0 一路走到跨页残余波仍然落空。
        let mut llm = ScriptedBatchLlm::new(vec![
            vec![(
                0,
                Ok(file_answer(&[("s-g1.0", "一。"), ("s-g4.0", "四。")])),
            )],
            vec![(0, Ok(file_answer(&[("s-g3.0", "三。")])))],
            vec![(0, Ok(file_answer(&[])))],
        ]);
        run_translate(
            &mut doc,
            &mut llm,
            &options("zh-Hans"),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("residual failure is not a translation failure");
        // 波 1（整页）+ 波 2（页内修复）+ 波 3（跨页残余）各一次调用。
        assert_eq!(llm.requests.len(), 3);
        assert!(llm.requests[2][0].0.contains("id=\"s-g2.0\""));

        // 落空的句既没有译文，也没有指纹戳：盖了戳它就再也不会被 stale 选中。
        assert!(!doc.trans["zh-Hans"].contains_key("s-g2.0"));
        assert!(!doc.trans_src["zh-Hans"].contains_key("s-g2.0"));
        assert_eq!(doc.trans["zh-Hans"].len(), 3);
        assert_eq!(doc.trans_src["zh-Hans"].len(), 3);
    }

    /// §2.3：波 1 页级耗尽**不再** hard error。阶梯是「整页 2 次 → 对半各 1 次
    /// → 半页的可编辑句进补做波次」；一句都没救回来时命令照常成功，缺失句由
    /// `bcut check` 报 `translation-partial`。
    #[test]
    fn page_rejections_fall_through_to_the_unit_wave_without_failing_the_command() {
        let mut doc = three_sentence_doc();
        let garbage = || Ok("好的，这是翻译：一。二。三。".to_owned());
        let mut llm = ScriptedBatchLlm::new(vec![
            // 波 1 两次整页尝试。
            vec![(0, garbage())],
            vec![(0, garbage())],
            // 对半缩窄：两个半页各一次。
            vec![(0, garbage()), (1, garbage())],
            // 波 2：整页的待修句。
            vec![(0, garbage())],
            // 波 3：跨页残余。
            vec![(0, garbage())],
        ]);
        run_translate(
            &mut doc,
            &mut llm,
            &options("zh-Hans"),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("page rejections are no longer a command failure");
        assert!(doc.trans.get("zh-Hans").is_none_or(BTreeMap::is_empty));
        assert_eq!(llm.requests.len(), 5);
        assert_eq!(llm.requests[2].len(), 2, "第三轮是两个半页");
    }

    /// 缩窄之后半页能翻出来时，那一半照常落库；只有仍失败的半页进补做波次。
    #[test]
    fn split_retry_saves_the_half_the_model_can_translate() {
        let mut doc = three_sentence_doc();
        let garbage = || Ok("好的，这是翻译：一。二。三。".to_owned());
        let mut llm = ScriptedBatchLlm::new(vec![
            vec![(0, garbage())],
            vec![(0, garbage())],
            // 半页 1（s-g1.0）翻出来了，半页 2 仍然答非所问。
            vec![(0, Ok(file_answer(&[("s-g1.0", "一。")]))), (1, garbage())],
            // 波 2：只剩后半页那两句。
            vec![(
                0,
                Ok(file_answer(&[("s-g2.0", "二。"), ("s-g3.0", "三。")])),
            )],
        ]);
        run_translate(
            &mut doc,
            &mut llm,
            &options("zh-Hans"),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("split retry recovers what it can");
        assert_eq!(doc.trans["zh-Hans"].len(), 3);
        assert!(llm.requests[3][0].0.contains("id=\"s-g2.0\""));
        assert!(!llm.requests[3][0].0.contains("id=\"s-g1.0\""));
    }

    #[test]
    fn file_contract_freezes_fresh_sentences_for_context() {
        let mut doc = three_sentence_doc();
        // 先让中间句「新鲜」：有译文且指纹对得上 ⇒ 不进本次待翻集合。
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let fresh = sentences
            .iter()
            .find(|sentence| sentence.id == "s-g2.0")
            .expect("middle sentence");
        doc.trans
            .entry("zh-Hans".to_owned())
            .or_default()
            .insert("s-g2.0".to_owned(), "既有译文。".to_owned());
        doc.trans_src
            .entry("zh-Hans".to_owned())
            .or_default()
            .insert("s-g2.0".to_owned(), fresh.src_fingerprint.clone());

        let mut llm = ScriptedBatchLlm::new(vec![vec![(
            0,
            Ok(file_answer(&[
                ("s-g1.0", "一。"),
                ("s-g2.0", "既有译文。"),
                ("s-g3.0", "三。"),
            ])),
        )]]);
        let outcome = run_translate(
            &mut doc,
            &mut llm,
            &options("zh-Hans"),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("frozen context page");
        assert_eq!(outcome.translated_sentences, 2);
        assert_eq!(outcome.skipped_sentences, 1);

        let sent = &llm.requests[0][0].0;
        assert!(sent.contains("data-editable=\"false\""), "{sent}");
        assert!(sent.contains("data-translation=\"既有译文。\""), "{sent}");
        // 冻结句要的是逐字复制：挂预算只会诱导模型「顺手压一压」不该动的译文。
        // 断言落在冻结句那一行本身，而不是「data-editable 紧跟 data-budget」这种
        // 属性顺序巧合上——否则调换渲染顺序就能让这条断言无声失效。
        let frozen_line = sent
            .lines()
            .find(|line| line.contains("id=\"s-g2.0\""))
            .expect("frozen sentence renders on its own line");
        assert!(!frozen_line.contains("data-budget="), "{frozen_line}");
        // 另外两句都是可编辑句，预算一句不落。
        assert_eq!(sent.matches("data-budget=").count(), 2, "{sent}");
        assert_eq!(doc.trans["zh-Hans"]["s-g2.0"], "既有译文。");
    }

    /// file-v1 的长度通道回归：json-v0 靠 `maxChars` 与融合段的每行展示上限
    /// 压住译文宽度，file-v1 早期两条都没有，实测展示宽度整体高一成以上。
    /// 契约文本只描述约束的性质（成品是字幕 + 逐句预算 + 反向护栏），具体
    /// 数字由载体的 `data-budget` 按目标语言携带——所以这里同时断言它**不**
    /// 把某个语言的每行格数写死。
    #[test]
    fn file_contract_prompt_states_the_subtitle_length_channel() {
        let body = TRANSLATE_FILE_PROMPT_BODY;
        assert!(body.contains("SUBTITLES"), "{body}");
        assert!(body.contains("data-budget"), "{body}");
        assert!(body.contains("reading-speed budget"), "{body}");
        assert!(body.contains("Prefer concise phrasing"), "{body}");
        // 反向护栏：该长就长优先于压缩。
        assert!(body.contains("never outranks meaning"), "{body}");
        assert!(body.contains("past data-budget"), "{body}");
        // 没有切分通道，就不能诱导模型自己往句子里塞分隔符。
        assert!(body.contains("or segmentation marks"), "{body}");
        // 每行展示上限按目标语言变（CJK ≈16 格、拉丁 ≈42 字符），常量提示词
        // 里写死任何一个都会对另一半语言说假话。
        assert!(!body.contains("16"), "{body}");
        assert!(!body.contains("42"), "{body}");
    }

    #[test]
    fn retry_reason_compacts_repeated_frozen_sentence_failures() {
        use crate::filepipe::{Problem, ProblemCode};

        let mut diagnostics = Diagnostics::new();
        for id in ["s-g1.0", "s-g2.0", "s-g3.0"] {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::FrozenModified,
                id,
                "冻结句被改动，绝不覆盖已有译文",
            ));
        }
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::MissingId,
            "s-g4.0",
            "缺少句子 s-g4.0",
        ));

        assert_eq!(
            summarize_problems(&diagnostics),
            "frozen-modified: 冻结句被改动，绝不覆盖已有译文 (repeated 3 times); missing-id: 缺少句子 s-g4.0"
        );
    }

    #[test]
    /// §2.3：冻结句被改动只记 Warning，本页照常接受——既有译文原样保留，
    /// 不再为它整页重掷。
    fn file_contract_ignores_a_modified_frozen_sentence() {
        let mut doc = three_sentence_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let fresh = sentences
            .iter()
            .find(|sentence| sentence.id == "s-g2.0")
            .expect("middle sentence");
        doc.trans
            .entry("zh-Hans".to_owned())
            .or_default()
            .insert("s-g2.0".to_owned(), "既有译文。".to_owned());
        doc.trans_src
            .entry("zh-Hans".to_owned())
            .or_default()
            .insert("s-g2.0".to_owned(), fresh.src_fingerprint.clone());

        let mut llm = ScriptedBatchLlm::new(vec![vec![(
            0,
            Ok(file_answer(&[
                ("s-g1.0", "一。"),
                ("s-g2.0", "改写过的译文。"),
                ("s-g3.0", "三。"),
            ])),
        )]]);
        run_translate(
            &mut doc,
            &mut llm,
            &options("zh-Hans"),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("a modified frozen sentence no longer rejects the page");
        assert_eq!(llm.requests.len(), 1, "不再有整页重试");
        assert_eq!(doc.trans["zh-Hans"]["s-g2.0"], "既有译文。");
        assert_eq!(doc.trans["zh-Hans"]["s-g1.0"], "一。");
    }

    #[test]
    fn file_contract_locked_glossary_target_drives_a_repair_wave() {
        let mut doc = three_sentence_doc();
        let mut opts = options("zh-Hans");
        opts.brief = Some(DocumentBrief {
            glossary: vec![crate::engines::brief::GlossaryEntry {
                source: "delta".to_owned(),
                target: "增量/差值".to_owned(),
                locked: true,
                note: None,
            }],
            ..Default::default()
        });
        let mut llm = ScriptedBatchLlm::new(vec![
            vec![(
                0,
                Ok(file_answer(&[
                    ("s-g1.0", "一。"),
                    ("s-g2.0", "德尔塔回声。"),
                    ("s-g3.0", "三。"),
                ])),
            )],
            vec![(0, Ok(file_answer(&[("s-g2.0", "增量/差值 回声。")])))],
        ]);
        run_translate(&mut doc, &mut llm, &opts, &mut |_| {}, &mut |_| {})
            .expect("glossary repair wave");
        let sent = &llm.requests[0][0].0;
        // 锁定术语以 JSON 数组落在 data-rt，含 `/` 也能原样往返。
        assert!(
            sent.contains("data-rt=\"[&quot;增量/差值&quot;]\""),
            "{sent}"
        );
        assert!(doc.trans["zh-Hans"]["s-g2.0"].contains("增量/差值"));
    }

    #[test]
    fn file_contract_lint_mirrors_the_engine_validator() {
        let mut doc = three_sentence_doc();
        let mut llm = ScriptedBatchLlm::new(vec![vec![(
            0,
            Ok(file_answer(&[
                ("s-g1.0", "一。"),
                ("s-g2.0", "二。"),
                ("s-g3.0", "三。"),
            ])),
        )]]);
        run_translate(
            &mut doc,
            &mut llm,
            &options("zh-Hans"),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("translate");
        let input = &llm.requests[0][0].0;

        assert!(
            lint_agent_answer_file(
                input,
                &file_answer(&[("s-g1.0", "一。"), ("s-g2.0", "二。"), ("s-g3.0", "三。")])
            )
            .is_empty()
        );
        let complaints = lint_agent_answer_file(
            input,
            &file_answer(&[("s-g1.0", "一。"), ("s-g3.0", "三。")]),
        );
        assert!(
            complaints.iter().any(|line| line.contains("missing-id")),
            "{complaints:?}"
        );
        // 载荷不是 translate 载体时 lint 静默放行（历史 json-v0 任务不误伤）。
        assert!(lint_agent_answer_file("{\"lines\":[]}", "whatever").is_empty());
    }

    #[test]
    fn file_contract_budgets_are_declared_per_executor() {
        use crate::paging::{PageExecutor, budgets};
        // 两档分开声明、宿主按执行器取档；当前实测都落在 2000（见 paging.rs）。
        assert_eq!(budgets::TRANSLATE_AGENT_WORDS, 2000);
        assert_eq!(budgets::TRANSLATE_PROVIDER_WORDS, 2000);
        assert_eq!(PageExecutor::Agent.translate_words(), 2000);
        assert_eq!(PageExecutor::Provider.translate_words(), 2000);
        assert!(fits_single_translate_page(66, 1200, 2000));
        // slack（预算 10%）以内仍算单页；一旦超出就分页。
        assert!(fits_single_translate_page(66, 2200, 2000));
        assert!(!fits_single_translate_page(66, 2201, 2000));
    }

    /// rows 档（`--align-fusion rows`）：两种执行器共用更小的 1200 词预算。
    /// rows 每源词成本约 1.6–2×，且长页会让模型整页放弃行标注（实测 59 句
    /// 一页只标了 3 句），因此页要切得更小。
    #[test]
    fn rows_mode_uses_a_smaller_translate_page_budget() {
        use crate::paging::{PageExecutor, budgets, page_count_for_total};
        assert_eq!(budgets::TRANSLATE_ROWS_WORDS, 800);
        assert_eq!(PageExecutor::Agent.translate_words_for(true), 800);
        assert_eq!(PageExecutor::Provider.translate_words_for(true), 800);
        // `translate_words()` 仍是常规档，`translate_words_for(false)` 与它同义。
        assert_eq!(PageExecutor::Agent.translate_words_for(false), 2000);
        assert_eq!(
            PageExecutor::Provider.translate_words_for(false),
            PageExecutor::Provider.translate_words()
        );

        // slack 仍是预算 10%：rows 单页上限 880 词，常规档 2200 词。
        let rows = budgets::TRANSLATE_ROWS_WORDS;
        let plain = budgets::TRANSLATE_PROVIDER_WORDS;
        assert!(fits_single_translate_page(60, 880, rows));
        assert!(!fits_single_translate_page(60, 881, rows));
        // 同一篇稿：常规档一页、rows 档两页。
        assert!(fits_single_translate_page(66, 1526, plain));
        assert!(!fits_single_translate_page(66, 1526, rows));
        assert_eq!(page_count_for_total(1526, plain), 1);
        assert_eq!(page_count_for_total(1526, rows), 2);
        assert_eq!(page_count_for_total(1257, plain), 1);
        assert_eq!(page_count_for_total(1257, rows), 2);
        // 30 分钟谈话（约 3500 词）：常规档 2 页 → rows 档 4 页。
        assert_eq!(page_count_for_total(3500, plain), 2);
        assert_eq!(page_count_for_total(3500, rows), 4);
    }

    /// 显式 `page_budget` 永远是唯一分页依据——rows 也不例外。
    ///
    /// 这是 `BCUT_LLM_PAGE_WORDS` 覆盖语义落在引擎侧的形式：档位选择归宿主
    /// （[`crate::paging::PageExecutor::translate_words_for`]），引擎只认传进来
    /// 的那个数，绝不因为 `align_rows` 自作主张缩页。
    #[test]
    fn explicit_page_budget_always_wins_including_rows_mode() {
        // 100 句 × 15 词 = 1500 词：rows 档（800 + 10% slack = 880）要 2 页，
        // 常规档（2000 + slack = 2200）只要 1 页。
        let mut words = Vec::new();
        let mut clock = 0.0f64;
        for sentence in 0..100 {
            for index in 0..15 {
                let text = if index == 14 {
                    "end.".to_owned()
                } else {
                    format!("word{index}")
                };
                words.push(w(
                    &format!("g{sentence}.{index}"),
                    clock,
                    clock + 0.3,
                    &text,
                    "s1",
                ));
                clock += 0.3;
            }
            clock += 0.8;
        }
        let doc = doc_with_words(words);
        let ids: Vec<String> = (0..100).map(|index| format!("s-g{index}.0")).collect();
        // 答案带合格行分区（整句一行），否则会触发 rows 的整页缺行软重发，
        // 多出来的那次调用会污染"页数 = 调用数"的判据。
        let answer = rows_answer(&ids, "译文内容需要足够长。", 15);

        for (budget, expected_calls) in [(2000usize, 1usize), (800, 2)] {
            let mut doc = doc.clone();
            let mut options = options("zh");
            options.align = Some(TransParams::for_lang("zh"));
            options.align_rows = true;
            options.page_budget = budget;
            let mut llm = FakeLlm::new((0..4).map(|_| Ok::<_, LlmError>(answer.clone())));
            run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();
            assert_eq!(llm.calls.len(), expected_calls, "budget {budget}");
        }
    }

    /// 每句一条覆盖 `1..word_count` 的行 span：最小的合格行分区答案。
    fn rows_answer(ids: &[String], text: &str, word_count: usize) -> String {
        let mut out = String::from("<article><section id=\"p-g0.0\">");
        for id in ids {
            out.push_str(&format!(
                "<p id=\"{id}\"><span data-src=\"1-{word_count}\">{text}</span></p>"
            ));
        }
        out.push_str("</section></article>");
        out
    }

    /// rows 整页缺行的软重发：第一次交回结构完整、只留 id 的纯译文（一个
    /// span 都没有），引擎原样重发一页并采用第二次答案的译文与行。有界：
    /// 每页最多 1 次。
    #[test]
    fn a_rows_page_with_no_spans_is_resent_once_and_the_second_answer_wins() {
        let mut doc = rows_page_doc(12);
        let ids: Vec<String> = (0..12).map(|index| format!("s-g{index}.0")).collect();
        let plain = file_answer(
            &ids.iter()
                .map(|id| (id.as_str(), "第一次的译文内容。"))
                .collect::<Vec<_>>(),
        );
        let with_rows = rows_answer(&ids, "第二次的译文内容。", 10);
        let mut llm = FakeLlm::new([Ok(plain), Ok(with_rows)]);

        let mut options = options("zh");
        options.align = Some(TransParams::for_lang("zh"));
        options.align_rows = true;
        let outcome =
            run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();

        assert_eq!(llm.calls.len(), 2, "整页缺行必须重发一次");
        assert_eq!(outcome.rows_page_retries, 1);
        // 重发时 retry_reason 点名"上一次一个行都没有"。
        assert!(
            llm.calls[1]
                .3
                .as_deref()
                .is_some_and(|reason| reason.contains("NO display rows")),
            "{:?}",
            llm.calls[1].3
        );
        // 译文与行都以第二次为准。
        assert_eq!(doc.trans["zh"]["s-g0.0"], "第二次的译文内容。");
        assert_eq!(outcome.alignment_drafts.len(), 12);
        assert!(outcome.alignment_drafts["s-g0.0"].rows);
    }

    /// 第二次仍然不给行 ⇒ 不再重发（每页 1 次），第二次的译文照常采用，
    /// 该句照常回落 dedicated align 路径。
    #[test]
    fn a_rows_page_is_never_resent_more_than_once() {
        let mut doc = rows_page_doc(12);
        let ids: Vec<String> = (0..12).map(|index| format!("s-g{index}.0")).collect();
        let plain =
            |text: &str| file_answer(&ids.iter().map(|id| (id.as_str(), text)).collect::<Vec<_>>());
        let mut llm = FakeLlm::new([
            Ok(plain("第一次的译文内容。")),
            Ok(plain("第二次的译文内容。")),
        ]);

        let mut options = options("zh");
        options.align = Some(TransParams::for_lang("zh"));
        options.align_rows = true;
        let outcome =
            run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();

        assert_eq!(llm.calls.len(), 2, "最多重发一次");
        assert_eq!(outcome.rows_page_retries, 1);
        assert_eq!(doc.trans["zh"]["s-g0.0"], "第二次的译文内容。");
        assert!(outcome.alignment_drafts.is_empty(), "没有行 ⇒ 没有草稿");
    }

    /// 整页交回的是源文照抄（没译成目标语）时，补做波次的请求必须说出上一次
    /// 错在哪、目标语言是什么：原样重发只会再得到同一份照抄。
    #[test]
    fn a_page_answered_in_the_source_language_is_asked_again_with_the_reason() {
        let mut doc = rows_page_doc(3);
        let source = "word0 word1 word2 word3 word4 word5 word6 word7 word8 end.";
        let copied = (1..=3)
            .map(|n| format!("{n} |word0..end.|{source}"))
            .collect::<Vec<_>>()
            .join("\n");
        let translated = (1..=3)
            .map(|n| format!("{n} |word0..end.|这一句的译文内容。"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut llm = FakeLlm::new([Ok(copied), Ok(translated)]);

        let mut options = options("zh");
        options.align = Some(TransParams::for_lang("zh"));
        options.align_lines = true;
        run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();

        assert_eq!(llm.calls.len(), 2);
        assert_eq!(llm.calls[0].3, None);
        let reason = llm.calls[1]
            .3
            .as_deref()
            .expect("repair wave carries a reason");
        assert!(
            reason.starts_with("3 of the 3 sentences on this page")
                && reason.contains("not a translation into \"zh\""),
            "{reason}"
        );
        assert_eq!(doc.trans["zh"]["s-g0.0"], "这一句的译文内容。");
        assert_eq!(doc.trans["zh"].len(), 3);
    }

    /// 别的原因进补做波次（这里是漏了一行）不带这条原因。
    #[test]
    fn a_repair_wave_for_a_missing_line_carries_no_language_reason() {
        let mut doc = rows_page_doc(3);
        let line = |n: usize| format!("{n} |word0..end.|这一句的译文内容。");
        let mut llm = FakeLlm::new([Ok(format!("{}\n{}", line(1), line(2))), Ok(line(1))]);

        let mut options = options("zh");
        options.align = Some(TransParams::for_lang("zh"));
        options.align_lines = true;
        run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();

        assert_eq!(llm.calls.len(), 2);
        assert_eq!(llm.calls[1].3, None);
        assert_eq!(doc.trans["zh"].len(), 3);
    }

    /// 少量句子没标行不算"整页放弃"：门槛是请求了行的句 ≥ 3 且缺行 ≥ 70%。
    #[test]
    fn a_page_where_most_sentences_carry_rows_is_not_resent() {
        let mut doc = rows_page_doc(12);
        let ids: Vec<String> = (0..12).map(|index| format!("s-g{index}.0")).collect();
        // 12 句里 10 句给了行（缺行 2/12 ≈ 17% < 70%）。
        let mut answer = String::from("<article><section id=\"p-g0.0\">");
        for (index, id) in ids.iter().enumerate() {
            if index < 10 {
                answer.push_str(&format!(
                    "<p id=\"{id}\"><span data-src=\"1-10\">这一句的译文内容。</span></p>"
                ));
            } else {
                answer.push_str(&format!("<p id=\"{id}\">这一句的译文内容。</p>"));
            }
        }
        answer.push_str("</section></article>");

        let mut llm = FakeLlm::new([Ok(answer)]);
        let mut options = options("zh");
        options.align = Some(TransParams::for_lang("zh"));
        options.align_rows = true;
        let outcome =
            run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();

        assert_eq!(llm.calls.len(), 1, "没到门槛就不该重发");
        assert_eq!(outcome.rows_page_retries, 0);
        assert_eq!(outcome.alignment_drafts.len(), 10);
    }

    /// `on` 模式（非 rows）永不触发缺行重发：那条契约本来就允许没有草稿。
    #[test]
    fn a_chunk_mode_page_without_spans_is_never_resent() {
        let mut doc = rows_page_doc(12);
        let ids: Vec<String> = (0..12).map(|index| format!("s-g{index}.0")).collect();
        let plain = file_answer(
            &ids.iter()
                .map(|id| (id.as_str(), "这一句的译文内容。"))
                .collect::<Vec<_>>(),
        );
        let mut llm = FakeLlm::new([Ok(plain)]);
        let mut options = options("zh");
        options.align = Some(TransParams::for_lang("zh"));
        options.align_rows = false;
        let outcome =
            run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.rows_page_retries, 0);
    }

    // ---- M5.2：`--align-fusion off`（设计 §20.4 ③） -------------------------

    /// `off`（`align: None`）时翻译提示不带 `data-align-*` 融合微格式，系统
    /// 提示也不再挂融合契约段——这正是"提示更短"的可观测形式。
    #[test]
    fn align_fusion_off_drops_the_microformat_from_the_prompt() {
        let mut doc = two_sentence_doc();
        doc.words[7].t1 = 8.0;
        doc.words[8].t0 = 8.2;
        doc.words[8].t1 = 8.6;
        let answer = file_answer(&[("s-g1.0", "第一段译文，第二段收尾。"), ("s-g2.0", "完成。")]);

        let mut on = options("zh-Hans");
        on.align = Some(TransParams::for_lang("zh-Hans"));
        let mut on_llm = FakeLlm::new([Ok(answer.clone())]);
        run_translate(&mut doc.clone(), &mut on_llm, &on, &mut |_| {}, &mut |_| {}).unwrap();
        let (_, on_system, on_user, _) = &on_llm.calls[0];
        assert!(on_user.contains("data-align-words="), "{on_user}");
        assert!(on_system.contains("Fused block alignment"), "{on_system}");

        let mut off_llm = FakeLlm::new([Ok(answer)]);
        run_translate(
            &mut doc,
            &mut off_llm,
            &options("zh-Hans"),
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        let (_, off_system, off_user, _) = &off_llm.calls[0];
        assert!(!off_user.contains("data-align-"), "{off_user}");
        // 融合关掉时载荷末尾也不加提醒。
        assert!(!off_user.contains("Reminder:"), "{off_user}");
        assert!(on_user.contains("Reminder: answer with"), "{on_user}");
        // 只读属性一律可省：两种模式的契约都明说「OMIT every other attribute」。
        assert!(
            on_system.contains("OMIT every other attribute"),
            "{on_system}"
        );
        assert!(
            off_system.contains("OMIT every other attribute"),
            "{off_system}"
        );
        assert!(
            !off_system.contains("Fused block alignment"),
            "{off_system}"
        );
        assert!(off_system.len() < on_system.len());
    }

    /// `off` 下解析仍兼容带微格式的回答：多余的 `<span data-src>` 只当译文
    /// 文本，不拒页、不丢句（换开关不该让一次回答整页作废）。
    #[test]
    fn align_fusion_off_still_parses_answers_that_carry_the_microformat() {
        let mut doc = two_sentence_doc();
        let mut llm = FakeLlm::new([Ok(String::from(
            "<article><section id=\"p-g1.0\">\
             <p id=\"s-g1.0\"><span data-src=\"1-5\">第一段译文，</span><span data-src=\"6-9\">第二段收尾。</span></p>\
             <p id=\"s-g2.0\">完成。</p></section></article>",
        ))]);

        let outcome =
            run_translate(&mut doc, &mut llm, &options("zh"), &mut |_| {}, &mut |_| {}).unwrap();

        assert_eq!(outcome.translated_sentences, 2);
        assert_eq!(doc.trans["zh"]["s-g1.0"], "第一段译文，第二段收尾。");
        assert_eq!(doc.trans["zh"]["s-g2.0"], "完成。");
        // 融合通道关着 ⇒ 不采信这份草稿。
        assert!(outcome.alignment_drafts.is_empty());
    }

    /// 只读属性可省的 agent 镜像：rows 载荷 + 「只留 id」的答案必须通过提交期
    /// lint，并且从载荷反解出的页仍能提取合格行分区。答案里的 `data-align-*`
    /// 从来没人读，省掉它才是推荐形态（实测占 provider 输出一半以上）。
    #[test]
    fn rows_answers_that_keep_only_ids_pass_the_agent_submit_lint() {
        let mut doc = two_sentence_doc();
        doc.words[7].t1 = 8.0;
        doc.words[8].t0 = 8.2;
        doc.words[8].t1 = 8.6;
        let mut options = options("zh");
        options.align = Some(TransParams::for_lang("zh"));
        options.align_rows = true;
        let mut llm = FakeLlm::new([Ok(file_answer(&[
            ("s-g1.0", "第一段译文需要自然对应，第二段译文负责完整收尾。"),
            ("s-g2.0", "完成。"),
        ]))]);
        run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();
        let payload = llm.calls[0].2.clone();
        assert!(payload.contains("data-align-groups="), "{payload}");
        assert!(payload.contains("Reminder: answer with"), "{payload}");

        // 答案：只留 id + 行 span，别的属性一个都不回显。
        let answer = "<article><section id=\"p-g1.0\">\
             <p id=\"s-g1.0\"><span data-src=\"1-5\">第一段译文需要自然对应，</span>\
             <span data-src=\"6-8\">第二段译文负责完整收尾。</span></p>\
             <p id=\"s-g2.0\">完成。</p></section></article>";
        assert!(!answer.contains("data-align-words"), "{answer}");
        assert!(
            lint_agent_answer_file(&payload, answer).is_empty(),
            "{:?}",
            lint_agent_answer_file(&payload, answer)
        );

        // 反解出的页 + 同一份答案仍然给出合格行分区。
        let page = parse_translate_source(&payload).expect("translate carrier");
        let parsed = parse_translate_page(&page, Some(&payload), answer);
        assert!(
            parsed.diagnostics.problems.is_empty(),
            "{:?}",
            parsed.diagnostics
        );
        assert!(parsed.alignments["s-g1.0"].rows);
    }

    /// 同一件事在 agent 路径上的镜像：提交期 lint（`lint_agent_answer_file`）
    /// 面对 fusion-off 载荷 + 带微格式的答案也必须放行。翻译对齐契约的两条
    /// 路径共用同一份字符串级校验，这里各覆盖一次。
    #[test]
    fn align_fusion_off_answers_with_spans_pass_the_agent_submit_lint() {
        let mut doc = two_sentence_doc();
        doc.words[7].t1 = 8.0;
        doc.words[8].t0 = 8.2;
        doc.words[8].t1 = 8.6;
        let mut llm = FakeLlm::new([Ok(file_answer(&[
            ("s-g1.0", "第一段译文，第二段收尾。"),
            ("s-g2.0", "完成。"),
        ]))]);
        run_translate(&mut doc, &mut llm, &options("zh"), &mut |_| {}, &mut |_| {}).unwrap();
        let payload = llm.calls[0].2.clone();
        assert!(!payload.contains("data-align-"), "{payload}");

        let with_spans = "<article><section id=\"p-g1.0\">\
             <p id=\"s-g1.0\"><span data-src=\"1-5\">第一段译文，</span><span data-src=\"6-9\">第二段收尾。</span></p>\
             <p id=\"s-g2.0\">完成。</p></section></article>";
        assert!(
            lint_agent_answer_file(&payload, with_spans).is_empty(),
            "{:?}",
            lint_agent_answer_file(&payload, with_spans)
        );
    }
}
