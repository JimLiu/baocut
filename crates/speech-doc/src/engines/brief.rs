//! 文档简报（analysis/brief 阶段，对拍 voice-ink `AnalysisStage`）：
//! 摘要 + 术语锁 + 命名实体，进所有后续 LLM 阶段的 system prompt。
//!
//! 降级契约：整个 analysis 可缺省——失败由调用方决定是否忽略（Err 不阻塞
//! 管线），但 [`crate::llm::LlmError::Terminal`] 仍应中止整个 run。

use serde::{Deserialize, Serialize};

use crate::doc::TranscriptDoc;
use crate::engines::markers::marked_text;
use crate::engines::translate::term_occurrences;
use crate::filepipe::{
    ANALYSIS_MAX_TERMS, BilingualTerm, CanonicalTerm, PageAttempt, Problem, ProblemScope,
    SourceContext, TargetContext, TermCategory, TermOrigin, merge_bilingual_terms,
    merge_canonical_terms, parse_model_source_context, parse_model_target_context,
    render_target_context, term_merge_key,
};
use crate::fingerprint::{fingerprint, fingerprint_strings};
use crate::llm::{
    LlmError, LlmJson, LlmRequest, MAX_RETRIES, complete_batch_retry_report, with_retry,
};
use crate::paging::{budgets, paginate_word_ranges};

/// 翻译语气覆盖。缺省 neutral 不注入任何额外约束。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranslationTone {
    Formal,
    Casual,
}

impl TranslationTone {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "formal" => Ok(Self::Formal),
            "casual" => Ok(Self::Casual),
            other => Err(format!("未知翻译语气 {other}（可用：formal|casual）")),
        }
    }

    pub fn prompt_line(self) -> &'static str {
        match self {
            Self::Formal => {
                "Use a formal, polished register appropriate for professional subtitles."
            }
            Self::Casual => {
                "Use a natural, conversational register while preserving the speaker's meaning."
            }
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryEntry {
    pub source: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// 生成式条目恒为 false；用户可编辑工件后显式锁定。
    #[serde(default)]
    pub locked: bool,
}

/// 每目标语言一份、可由用户编辑正文的双语翻译简报。
///
/// 三个指纹字段只约束生成输入；glossary/styleGuide 等正文不参与缓存命中，
/// 因而用户编辑可以跨重翻稳定复用。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBrief {
    #[serde(default)]
    pub target_lang: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tone: Option<TranslationTone>,
    pub summary: String,
    #[serde(default)]
    pub glossary: Vec<GlossaryEntry>,
    #[serde(default)]
    pub named_entities: Vec<String>,
    #[serde(default)]
    pub style_guide: String,
    #[serde(default)]
    pub difficulties: Vec<String>,
    pub fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions_fingerprint: Option<String>,
}

impl DocumentBrief {
    pub fn matches_inputs(
        &self,
        doc: &TranscriptDoc,
        analysis: Option<&Analysis>,
        instructions: Option<&str>,
    ) -> bool {
        self.fingerprint == fingerprint(&doc.words)
            && self.analysis_fingerprint == analysis.map(|analysis| analysis.fingerprint.clone())
            && self.instructions_fingerprint
                == instructions
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| fingerprint_strings([value]))
    }

    /// align-only（精修）轮的放宽复用判定：只比较词真相与目标语。
    ///
    /// 精修轮语义上不改译文真相，brief 在这条路径上只被消费（受保护术语 +
    /// 双语锚点），不参与生成。而精修轮天然拿不到 analysis（`--align-only`
    /// 一律丢弃）也拿不到原始 `instructions`（逐句明细只进 align 契约），用
    /// [`Self::matches_inputs`] 判定必然失配：每一轮精修都会重跑一次
    /// translate-brief，并整体覆盖 `ai/brief-<lang>.json`，把用户显式锁定的
    /// `locked` 术语一起冲掉。词真相没变时直接复用既有 brief 即可。
    pub fn matches_document(&self, doc: &TranscriptDoc, target_lang: &str) -> bool {
        self.target_lang == target_lang && self.fingerprint == fingerprint(&doc.words)
    }

    /// 翻译提示词里的术语表：**只带本篇真的命中的条目**，按命中次数降序，稳定取前
    /// `limit` 条。
    ///
    /// 过去这里只排序不过滤——零命中的条目照样排在后面进了提示词（分析阶段抽出、
    /// 后来被剪掉的片段里的词，或一张很大的用户术语表），既费 token 又把真正要紧
    /// 的几条淹掉。命中口径与每页 `rt` 的 [`term_present`] 相同（拉丁词看标识符
    /// 边界、CJK 字面包含）；`analysis` 里同一个词记下的误识形式也算命中——文稿
    /// 还没润色时，正文里写的可能是「维科夫」而不是 `Wyckoff`。
    ///
    /// [`term_present`]: crate::engines::translate::term_present
    pub fn glossary_for_prompt(
        &self,
        source_text: &str,
        analysis: Option<&Analysis>,
        limit: usize,
    ) -> Vec<&GlossaryEntry> {
        let mut indexed = self
            .glossary
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| {
                let key = term_merge_key(&entry.source);
                let observed = analysis
                    .into_iter()
                    .flat_map(|analysis| analysis.terms.iter())
                    .filter(|term| !key.is_empty() && term_merge_key(&term.term) == key)
                    .flat_map(|term| term.observed_variants.iter().map(String::as_str));
                let count = std::iter::once(entry.source.as_str())
                    .chain(observed)
                    .map(|form| term_occurrences(source_text, form))
                    .sum::<usize>();
                (count > 0).then_some((entry, count, index))
            })
            .collect::<Vec<_>>();
        indexed.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.2.cmp(&right.2)));
        indexed
            .into_iter()
            .take(limit)
            .map(|(entry, _, _)| entry)
            .collect()
    }

    pub fn protected_targets(&self) -> Vec<String> {
        let mut targets = self
            .glossary
            .iter()
            .map(|entry| entry.target.trim())
            .filter(|target| !target.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        targets.sort();
        targets.dedup();
        targets
    }

    /// Align may protect only terms that fit in one target line; a term wider
    /// than `fit` has no legal indivisible placement and must remain splittable.
    pub fn protected_targets_for_fit(&self, lang: &str, fit: usize) -> Vec<String> {
        self.protected_targets()
            .into_iter()
            .filter(|target| !crate::split::exceeds_one_line_fit(target, lang, fit))
            .collect()
    }
}

#[derive(Debug, Clone, Default)]
pub struct TranslationBriefOptions<'a> {
    pub source_lang: &'a str,
    pub target_lang: &'a str,
    pub analysis: Option<&'a Analysis>,
    pub instructions: Option<&'a str>,
    pub reference_context: Option<&'a str>,
    pub tone: Option<TranslationTone>,
}

/// BCP-47 script-aware simplified-Chinese policy gate：zh / zh-Hans 适用，
/// zh-Hant（含地区子标签）不适用。
pub fn is_simplified_chinese(lang: &str) -> bool {
    let subtags = lang
        .split(['-', '_'])
        .map(|part| part.to_ascii_lowercase())
        .collect::<Vec<_>>();
    subtags.first().is_some_and(|primary| primary == "zh")
        && !subtags.iter().any(|subtag| subtag == "hant")
}

pub fn simplified_chinese_prompt_block(lang: &str) -> Option<&'static str> {
    is_simplified_chinese(lang).then_some(
        r#"Simplified-Chinese target policy (fixed, higher priority than a generated style guide):
- Use idiomatic Simplified Chinese, not source-language word order when it sounds translated.
- Use Chinese punctuation conventions. Never insert a space between two Chinese characters, and never insert a space inside an identifier.
- Always put exactly one ASCII space between a Chinese character and adjacent Latin script: Latin words, identifiers, model names, and a CLI flag together with its leading dashes. Write 35% KV 缓存 and 通过 --speculative-model 指定, never 35%KV缓存 or 通过--speculative-model指定. The same single space applies between an Arabic numeral or a % value and an adjacent Latin word. This spacing is mandatory, not a preference.
- Use “…” for ellipses, collapse noisy repeated ?!/？！ punctuation, and write ordinary four-digit numbers without a thousands comma.
- Preserve code, identifiers, URLs, model names, product names, and LOCKED glossary renderings verbatim; copying them verbatim means the identifier's own characters are untouched, and it still takes the single surrounding space when Chinese text touches it.
- Subtitle display cuts are a later transAlign projection; never insert line breaks."#,
    )
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisTerm {
    pub term: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub observed_variants: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub summary: String,
    #[serde(default)]
    pub terms: Vec<AnalysisTerm>,
    #[serde(default)]
    pub named_entities: Vec<String>,
    /// 输入词流内容指纹（落盘产物头必带；读取方必须校验）。
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub fingerprint: String,
    /// 项目/来源元数据参考块的指纹；元数据变化时使 brief 缓存失效。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AnalysisOptions {
    pub instructions: Option<String>,
    pub reference_context: Option<String>,
}

/// 用户指令注入块（逐字对拍 `AnalysisStage.instructionsBlock`）。
pub fn instructions_block(instructions: Option<&str>) -> String {
    match instructions.filter(|text| !text.is_empty()) {
        Some(text) => format!(
            "\n\n\nExtra instructions from the user — AUTHORITATIVE: any names, spellings, or facts stated here are correct by definition and override your own knowledge and mishearing guesses. Never list a \"correct spelling\" that contradicts them: {text}"
        ),
        None => String::new(),
    }
}

/// 项目与来源元数据只作为背景参考：标题/描述通常能提供正确的专有名词，
/// 但不能据此向口述内容添加事实或覆盖明确的转录证据。
pub fn reference_context_block(context: Option<&str>) -> String {
    match context.filter(|text| !text.is_empty()) {
        Some(text) => format!(
            "\n\n\nProject and source metadata — BACKGROUND REFERENCE, not transcript content or absolute authority. Use exact spellings of names, people, organizations, products, and technical terms as strong correction hints only when the speech plausibly refers to them. Never add facts or words merely because they appear here:\n{text}"
        ),
        None => String::new(),
    }
}

/// 术语表进 prompt 的展示（对拍 `AnalysisStage.formatForPrompt`）。
pub fn format_for_prompt(analysis: &Analysis) -> String {
    if analysis.terms.is_empty() {
        return "(none)".to_owned();
    }
    analysis
        .terms
        .iter()
        .map(|term| {
            let mut line = format!("- {}", term.term);
            if !term.observed_variants.is_empty() {
                let variants = term
                    .observed_variants
                    .iter()
                    .map(|variant| format!("{variant} → {}", term.term))
                    .collect::<Vec<_>>()
                    .join("; ");
                line.push_str(&format!(" [observed ASR: {variants}]"));
            }
            if let Some(note) = term.note.as_deref().filter(|note| !note.is_empty()) {
                line.push_str(&format!(" ({note})"));
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn has_slash(value: &str) -> bool {
    value.contains('/') || value.contains('／')
}

fn head_tail_excerpt(doc: &TranscriptDoc, budget: usize) -> String {
    let joined = marked_text(&doc.words);
    let chars = joined.chars().collect::<Vec<_>>();
    if chars.len() <= budget {
        return joined;
    }
    let half = budget / 2;
    let head = chars[..half].iter().collect::<String>();
    let tail = chars[chars.len().saturating_sub(half)..]
        .iter()
        .collect::<String>();
    format!("{head}\n\n[… middle omitted; use complete analysis …]\n\n{tail}")
}

// ── 文件契约（file-v1）：`ai/context.md` / `ai/context.<lang>.md`（设计 §5） ──

/// analysis 抽取提示（file-v1）：输入是 ASR 原文页，输出是一份 `context.md`。
const CONTEXT_EXTRACT_PROMPT: &str = r#"You are a transcription quality analyst.

The user gives you a RAW speech-recognition transcript. It may contain spelling errors, homophone mistakes, and misrecognized proper nouns.

Answer with ONE markdown document and nothing else — no prose before or after it, no code fence. Its shape is fixed:

---
format: "context-doc/1"
fingerprint: ""
---
# Summary
Two or three sentences describing the subject matter, register, speaker roles, and any style requirement.

# Canonical Terms
| Source | Category | Variants | Note | Lock | Origin |
|---|---|---|---|---|---|
| BaoCut | product | bao cut, BaoKut | keep the English casing | no | analyzed |

Rules:
- Reproduce the frontmatter keys exactly as shown and leave `fingerprint` empty; the app stamps it.
- Keep both headings verbatim: `# Summary` and `# Canonical Terms`. Add no other section.
- This table exists for ONE purpose: fixing speech-recognition mistakes. `Source` is the CORRECT spelling of a term the recognizer is likely to get wrong — a proper noun, a person, a product, a technical term, a brand, an acronym, or a foreign word mixed into the speech. Infer the correct form when the transcript misspells it.
- NEVER list ordinary vocabulary, common nouns, verbs, generic topic words, filler or backchannel words (嗯/啊/哦/对/好/是, um, uh, yeah), single characters, numbers, or punctuation. If a competent typist would spell it correctly without thinking, it does not belong in the table.
- At most 80 rows per answer. When more candidates exist, keep only the ones a recognizer most plausibly mangles. One row per term; never repeat a `Source` — merge every observation of the same term into that single row.
- `Category` is a closed set: product, person, tech, proper, other. Any other value is treated as `other`.
- `Variants` lists exact misrecognized forms that LITERALLY occur in the supplied transcript and clearly refer to that term, separated by commas. Never invent a variant, and never repeat the canonical `Source` as its own variant. Leave the cell empty when there is none.
- `Lock` is always `no` and `Origin` is always `analyzed` in your answer. Rows the user locked are merged back by the app; writing `yes` or `user` yourself is a protocol violation.
- Keep every cell on one line and escape a literal `|` inside a cell as `\|`."#;

/// analysis 摘要归并提示（file-v1）：输入只有各页的 `# Summary`。
///
/// 术语表不再交给模型整表重写——多页 `Canonical Terms` 由宿主按
/// [`merge_partial_terms`] 确定性并集；模型只写一段总摘要，因此这次调用的载荷与
/// 答案都只有几行，串行 reduce 不再是 analysis 阶段的长尾。
const CONTEXT_SUMMARY_PROMPT: &str = r#"You are a transcription quality analyst.

The user gives you the per-part summaries written for consecutive parts of ONE transcript. Write one overall two-to-three sentence summary describing the subject matter, register, speaker roles, and any style requirement.

Answer with ONE markdown document and nothing else — no prose before or after it, no code fence:

---
format: "context-doc/1"
fingerprint: ""
---
# Summary
…

# Canonical Terms
| Source | Category | Variants | Note | Lock | Origin |
|---|---|---|---|---|---|

Rules:
- Reproduce the frontmatter keys exactly as shown and leave `fingerprint` empty.
- Keep both headings and the table header verbatim and leave the table EMPTY: the app merges the term rows itself; any row you add is discarded.
- Do not echo the per-part summaries back; write the merged summary only."#;

/// translate-brief 提示（file-v1）：输入是待补全的 `context.<lang>.md` 种子文档。
const CONTEXT_TARGET_PROMPT: &str = r#"You prepare a bilingual subtitle-translation brief as a markdown document.

The user gives you a target-language context document whose `Bilingual Glossary` rows are already fixed, plus a transcript excerpt for evidence. Fill it in and answer with ONE markdown document and nothing else — no prose before or after it, no code fence. Keep the frontmatter, the four headings, and the table header verbatim:

---
format: "context-doc/1"
targetLang: "…"
fingerprint: "…"
---
# Translated Summary
…
# Bilingual Glossary
| Source | Target | Note | Lock | Origin |
|---|---|---|---|---|
# Translation Style
…
# Difficulties
- …

Rules:
- Copy the frontmatter block through unchanged, including every fingerprint value.
- Keep every glossary row that the input already has, in the same order, and never add or drop a `Source`. Fill in each empty `Target`.
- A row whose `Lock` is `yes` is locked by the user: copy its `Target` character for character when it already has one, and never rewrite it.
- Copy the `Lock` and `Origin` cells through unchanged.
- Every `Target` is exactly one literal, screen-ready rendering. Never offer slash-separated alternatives; a slash is allowed only when the source term itself contains one and is copied verbatim, such as a CLI command like /compact.
- An acronym and its spelled-out form are separate rows that must map to the same single literal target.
- `# Translated Summary` restates the summary in the target language. `# Translation Style` states the register plus the numeric, unit, and spacing conventions that every page must follow: one fixed shape for percent ranges such as 75%–95% written with an en dash and no spaces, Arabic numerals for quantities, and one spelled form per unit.
- When the target language is written in Han characters or kana (Chinese, Japanese), `# Translation Style` must state the CJK/Latin spacing rule as mandatory, never as a preference: exactly one ASCII space between a Han or kana character and adjacent Latin words, identifiers, model names, numerals, % values, and CLI flags together with their leading dashes, as in 35% KV 缓存 and 通过 --speculative-model 指定; never a space between two such characters and never a space inside an identifier.
- That spacing rule does not apply to a target written in Hangul. Korean separates words with spaces and attaches a particle or counter directly to the Latin word or numeral before it (AI가, 2박 3일, 35%를): `# Translation Style` must say so and must never ask for a space between Hangul and an adjacent Latin word or numeral.
- `# Difficulties` is a `- ` bulleted list of translation pitfalls in this document; leave the section empty when there is none.
- Keep every table cell on one line and escape a literal `|` inside a cell as `\|`. Do not echo the transcript excerpt back."#;

/// 页 id（与 translate/polish 的 `pNNN` 同形），供审计工件命名。
fn context_page_id(index: usize) -> String {
    format!("p{:03}", index + 1)
}

/// 问题摘要（回灌重试原因用；与 polish/align 同形）。
fn summarize_context_problems(problems: &[Problem]) -> String {
    if problems.is_empty() {
        return "no parseable context document".to_owned();
    }
    problems
        .iter()
        .take(4)
        .map(|problem| format!("[{}] {}", problem.code, problem.detail))
        .collect::<Vec<_>>()
        .join("; ")
}

/// `LlmError` → 可回灌的人读说明（`Malformed` 的 Display 前缀对 md 载体是误导）。
fn malformed_detail(error: &LlmError) -> String {
    match error {
        LlmError::Malformed(detail) => detail.clone(),
        other => other.to_string(),
    }
}

fn context_problem_lines(problems: &[Problem]) -> Vec<String> {
    problems
        .iter()
        .map(|problem| match &problem.scope {
            ProblemScope::Sentence { id } => format!("[{}] {id}: {}", problem.code, problem.detail),
            _ => format!("[{}] {}", problem.code, problem.detail),
        })
        .collect()
}

/// 模型行一律降为 `Origin=analyzed, Lock=no`：`Lock`/`Origin` 是用户通道，
/// 模型不得自封（否则一次幻觉就能把生成式译名钉成"用户锁定"）。
fn demote_model_terms(terms: &mut Vec<CanonicalTerm>) {
    for term in terms.iter_mut() {
        term.origin = TermOrigin::Analyzed;
        term.locked = false;
        term.source = term.source.trim().to_owned();
    }
    terms.retain(|term| !term.source.is_empty());
}

/// 反幻觉收尾：`Variants` 只保留在全文里字面
/// 出现过的形式。
fn filter_invented_variants(terms: &mut [CanonicalTerm], doc: &TranscriptDoc) {
    let full_text = crate::atomize::join_word_texts(doc.words.iter()).to_lowercase();
    for term in terms.iter_mut() {
        let canonical = term.source.to_lowercase();
        let mut seen = std::collections::HashSet::new();
        term.variants.retain(|variant| {
            let lowered = variant.to_lowercase();
            lowered != canonical && full_text.contains(&lowered) && seen.insert(lowered)
        });
    }
}

/// [`run_analysis_file_contract_report`] 的结账。
///
/// `pages_failed` / `terms_dropped` 是重试策略重设计 §2.1 的两个可观测计数：
/// 前者是三次尝试都没交出可解析文档的页数（**不再**整条 analysis 上抛），
/// 后者是行数上限截掉的术语行数。宿主把它们写进 `bcut polish` / `bcut brief`
/// 的 analysis 段（`pagesFailed` / `termsDropped`）。
#[derive(Debug, Clone, Default)]
pub struct AnalysisOutcome {
    /// 归并后的源语上下文（与旧返回值同物）。
    pub context: SourceContext,
    /// 页级耗尽的页数（≥1 页成功即不算整体失败）。
    pub pages_failed: u32,
    /// 行数上限（单页 150 / 全文 [`ANALYSIS_MAX_TERMS`]）截掉的术语行数。
    pub terms_dropped: u32,
}

/// 多页 `Canonical Terms` 的确定性并集（替代原来让模型整表重写的串行 reduce）。
///
/// 同键组内：`Source` 拼写取出现次数最多者（平局取先见）；`Category` 取众数（平局
/// 取先见）；`Note` 取最长（平局取先见）；`Variants` 取并集（大小写不敏感去重、
/// 剔除胜出拼写），落选的 `Source` 拼写也并入 `Variants`——它们随后同样要过
/// [`filter_invented_variants`] 的字面出现判据，不会凭空多出形式。
/// 输出按首次出现顺序排列；`Lock`/`Origin` 一律是模型行口径。
fn merge_partial_terms(partials: &[SourceContext]) -> (Vec<CanonicalTerm>, u32) {
    struct Group {
        spellings: Vec<(String, usize)>,
        categories: Vec<(TermCategory, usize)>,
        note: String,
        variants: Vec<String>,
        /// 该键在各页里出现的总次数（全文行数上限的排序依据）。
        hits: usize,
    }
    fn bump<T: PartialEq>(counts: &mut Vec<(T, usize)>, value: T) {
        match counts.iter_mut().find(|(seen, _)| *seen == value) {
            Some((_, count)) => *count += 1,
            None => counts.push((value, 1)),
        }
    }
    fn winner<T: Clone>(counts: &[(T, usize)]) -> T {
        let mut best = &counts[0];
        for entry in counts {
            if entry.1 > best.1 {
                best = entry;
            }
        }
        best.0.clone()
    }

    let mut order: Vec<String> = Vec::new();
    let mut groups: std::collections::HashMap<String, Group> = std::collections::HashMap::new();
    for term in partials.iter().flat_map(|partial| partial.terms.iter()) {
        let source = term.source.trim();
        if source.is_empty() {
            continue;
        }
        let key = term_merge_key(source);
        if key.is_empty() {
            continue;
        }
        let group = groups.entry(key.clone()).or_insert_with(|| {
            order.push(key);
            Group {
                spellings: Vec::new(),
                categories: Vec::new(),
                note: String::new(),
                variants: Vec::new(),
                hits: 0,
            }
        });
        group.hits += 1;
        bump(&mut group.spellings, source.to_owned());
        bump(&mut group.categories, term.category);
        let note = term.note.trim();
        if note.chars().count() > group.note.chars().count() {
            group.note = note.to_owned();
        }
        group.variants.extend(
            term.variants
                .iter()
                .map(|variant| variant.trim())
                .filter(|variant| !variant.is_empty())
                .map(str::to_owned),
        );
    }

    // 全文行数上限（R2 确定性截断）：按跨页出现次数降序取前 ANALYSIS_MAX_TERMS
    // 个键，平局按首现顺序；被截掉的行只计数，绝不因此拒页。
    let dropped = order.len().saturating_sub(ANALYSIS_MAX_TERMS) as u32;
    let mut ranked: Vec<(usize, String)> = order.into_iter().enumerate().collect();
    if dropped > 0 {
        ranked.sort_by(|(left_pos, left), (right_pos, right)| {
            groups[right]
                .hits
                .cmp(&groups[left].hits)
                .then(left_pos.cmp(right_pos))
        });
        ranked.truncate(ANALYSIS_MAX_TERMS);
        // 截断后恢复首现顺序：输出顺序仍然只由「第一次出现」决定。
        ranked.sort_by_key(|(position, _)| *position);
    }

    let terms = ranked
        .into_iter()
        .filter_map(|(_, key)| groups.remove(&key))
        .map(|group| {
            let source = winner(&group.spellings);
            let category = winner(&group.categories);
            let canonical = source.to_lowercase();
            let mut seen = std::collections::HashSet::new();
            let variants = group
                .variants
                .into_iter()
                .chain(group.spellings.into_iter().map(|(spelling, _)| spelling))
                .filter(|variant| {
                    let lowered = variant.to_lowercase();
                    lowered != canonical && seen.insert(lowered)
                })
                .collect();
            CanonicalTerm {
                source,
                category,
                variants,
                note: group.note,
                locked: false,
                origin: TermOrigin::Analyzed,
            }
        })
        .collect();
    (terms, dropped)
}

/// 多页摘要归并：只让模型写总摘要（术语表已由 [`merge_partial_terms`] 并好）。
///
/// 重试耗尽仍不可解析时回退到最长的分页摘要——摘要只是提示背景，不值得让整个
/// analysis 因它失败；其他错误（Terminal/Transient 耗尽）照常上抛。
fn merge_partial_summaries(
    partials: &[SourceContext],
    llm: &mut dyn LlmJson,
    options: &AnalysisOptions,
    sleep: &mut dyn FnMut(f64),
    on_attempt: &mut dyn FnMut(&PageAttempt<'_>),
) -> Result<String, LlmError> {
    let payload = partials
        .iter()
        .enumerate()
        .map(|(index, partial)| {
            format!(
                "## Part {}\n{}",
                context_page_id(index),
                partial.summary.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let merge_system = format!(
        "{CONTEXT_SUMMARY_PROMPT}{}{}",
        reference_context_block(options.reference_context.as_deref()),
        instructions_block(options.instructions.as_deref())
    );
    let merge_id = "merge".to_owned();
    let mut merge_tries = 0_u32;
    // 重试意见回灌真实 problems 摘要（重试策略重设计 §2.5）：固定字符串既不
    // 告诉模型哪里错了，也让日志里看不出上一轮到底发生了什么。
    let mut last_problems: Option<String> = None;
    let merged = with_retry(MAX_RETRIES, &mut *sleep, |attempt| {
        let raw = llm.complete(&LlmRequest {
            kind: "analysis",
            system: merge_system.clone(),
            user: payload.clone(),
            temperature: 0.2,
            attempt: attempt + 1,
            retry_reason: (attempt > 0).then(|| {
                last_problems.clone().unwrap_or_else(|| {
                    "the previous merged summary document was not parseable".to_owned()
                })
            }),
        })?;
        merge_tries += 1;
        let parsed = parse_model_source_context(Some(&payload), &raw);
        let problems = parsed.diagnostics.problems.clone();
        on_attempt(&PageAttempt {
            page_id: &merge_id,
            attempt: merge_tries,
            input: &payload,
            output: &raw,
            problems: &problems,
            accepted: parsed.context.is_some(),
        });
        let summary = parsed
            .context
            .map(|context| context.summary.trim().to_owned())
            .filter(|summary| !summary.is_empty());
        match summary {
            Some(summary) => Ok(summary),
            None => {
                let detail = if problems.is_empty() {
                    "the merged summary document had no non-empty `# Summary` section".to_owned()
                } else {
                    summarize_context_problems(&problems)
                };
                last_problems = Some(detail.clone());
                Err(LlmError::Malformed(format!(
                    "merged summary rejected — {detail}"
                )))
            }
        }
    });
    match merged {
        Ok(summary) => Ok(summary),
        Err(LlmError::Malformed(_)) => Ok(partials
            .iter()
            .map(|partial| partial.summary.trim())
            .max_by_key(|summary| summary.chars().count())
            .unwrap_or_default()
            .to_owned()),
        Err(error) => Err(error),
    }
}

/// 文件契约下的全文分析（§5）：产出 `ai/context.md` 的 [`SourceContext`]。
///
/// 语义要点：同一套分页预算、同一套
/// map/reduce 结构（多页时术语表由 [`merge_partial_terms`] 确定性并集，模型只串行
/// 写一次总摘要）、同一条反幻觉收尾、同一个
/// `fingerprint`/`referenceFingerprint` 口径——宿主的缓存新鲜度判据因此原样成立。
///
/// 模型改写的是文档而不是 JSON；`existing` 里 `Origin=user` 的行经
/// [`merge_canonical_terms`] 逐条保留（§5.1 重建规则），模型行一律降为
/// `Origin=analyzed`。解析失败返回 `Err`，宿主必须保留旧的已验证 context，
/// **绝不以空表覆盖**。
pub fn run_analysis_file_contract(
    doc: &TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &AnalysisOptions,
    existing: Option<&SourceContext>,
    sleep: &mut dyn FnMut(f64),
    on_attempt: &mut dyn FnMut(&PageAttempt<'_>),
) -> Result<SourceContext, LlmError> {
    run_analysis_file_contract_report(doc, llm, options, existing, sleep, on_attempt)
        .map(|outcome| outcome.context)
}

/// 同 [`run_analysis_file_contract`]，另外交回 §2.1 的两个降级计数
/// （[`AnalysisOutcome::pages_failed`] / [`AnalysisOutcome::terms_dropped`]）。
///
/// 页级耗尽**不再上抛**：只要还有 ≥1 页成功，就用成功页归并（术语并集 + 摘要
/// merge/回退），失败页只计数。全部页都失败才 `Err`，宿主照旧保留旧 context。
pub fn run_analysis_file_contract_report(
    doc: &TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &AnalysisOptions,
    existing: Option<&SourceContext>,
    sleep: &mut dyn FnMut(f64),
    on_attempt: &mut dyn FnMut(&PageAttempt<'_>),
) -> Result<AnalysisOutcome, LlmError> {
    let pages = paginate_word_ranges(&doc.words, budgets::ANALYSIS, budgets::ANALYSIS_MIN_LAST);
    let system = format!(
        "{CONTEXT_EXTRACT_PROMPT}{}{}",
        reference_context_block(options.reference_context.as_deref()),
        instructions_block(options.instructions.as_deref())
    );
    let inputs = pages
        .iter()
        .map(|page| marked_text(&doc.words[page.clone()]))
        .collect::<Vec<_>>();
    let page_ids = (0..inputs.len()).map(context_page_id).collect::<Vec<_>>();
    let requests = inputs
        .iter()
        .map(|input| LlmRequest {
            kind: "analysis",
            system: system.clone(),
            user: input.clone(),
            temperature: 0.2,
            attempt: 1,
            retry_reason: None,
        })
        .collect::<Vec<_>>();

    let mut partials: Vec<Option<SourceContext>> = vec![None; requests.len()];
    let mut tries = vec![0_u32; requests.len()];
    let wave = complete_batch_retry_report(
        llm,
        &requests,
        MAX_RETRIES,
        sleep,
        &mut |index, raw| {
            tries[index] += 1;
            let parsed = parse_model_source_context(Some(&inputs[index]), raw);
            let problems = parsed.diagnostics.problems.clone();
            on_attempt(&PageAttempt {
                page_id: &page_ids[index],
                attempt: tries[index],
                input: &inputs[index],
                output: raw,
                problems: &problems,
                accepted: parsed.context.is_some(),
            });
            parsed
                .context
                .map(|mut context| {
                    demote_model_terms(&mut context.terms);
                    context
                })
                .ok_or_else(|| {
                    LlmError::Malformed(format!(
                        "context page {} rejected — {}",
                        page_ids[index],
                        summarize_context_problems(&problems)
                    ))
                })
        },
        &mut |_, error| error.to_string(),
        &mut |index, context| partials[index] = Some(context),
    )?;
    // 页级耗尽只丢那一页（R1/R3）：整条 analysis 不再因为某一页三次不可解析
    // 就上抛，把整条 polish 一起拖垮。全部页都失败才判败。
    let pages_failed = wave.failed.len() as u32;
    let first_failure = wave.failed.into_iter().next().map(|(_, error)| error);
    let partials: Vec<SourceContext> = partials.into_iter().flatten().collect();
    if partials.is_empty() {
        return Err(first_failure
            .unwrap_or_else(|| LlmError::Malformed("no context page completed".to_owned())));
    }

    let mut terms_dropped = 0_u32;
    let mut merged = if partials.len() == 1 {
        partials.into_iter().next().unwrap_or_default()
    } else {
        let (terms, dropped) = merge_partial_terms(&partials);
        terms_dropped = dropped;
        let summary = merge_partial_summaries(&partials, llm, options, sleep, on_attempt)?;
        SourceContext {
            summary,
            terms,
            ..SourceContext::default()
        }
    };

    filter_invented_variants(&mut merged.terms, doc);
    merged.terms = merge_canonical_terms(
        existing
            .map(|context| context.terms.as_slice())
            .unwrap_or(&[]),
        &merged.terms,
    );
    if merged.summary.trim().is_empty()
        && let Some(previous) = existing.map(|context| context.summary.as_str())
    {
        merged.summary = previous.to_owned();
    }
    merged.fingerprint = fingerprint(&doc.words);
    merged.reference_fingerprint = options
        .reference_context
        .as_deref()
        .map(|context| fingerprint_strings([context]));
    Ok(AnalysisOutcome {
        context: merged,
        pages_failed,
        terms_dropped,
    })
}

/// 种子文档：把源语 canonical 术语投影成待补全的双语行，已有译名原样带入。
///
/// `Lock`/`Origin` 沿用用户通道（源语行的用户锁定继续锁在目标语行上），模型
/// 只被允许填 `Target` 与三个正文小节。
fn seed_target_context(
    doc: &TranscriptDoc,
    options: &TranslationBriefOptions<'_>,
    source: Option<&SourceContext>,
    existing: Option<&TargetContext>,
) -> TargetContext {
    let prior: std::collections::BTreeMap<&str, &BilingualTerm> = existing
        .map(|context| {
            context
                .glossary
                .iter()
                .map(|term| (term.source.as_str(), term))
                .collect()
        })
        .unwrap_or_default();
    let mut glossary: Vec<BilingualTerm> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for term in source
        .map(|context| context.terms.as_slice())
        .unwrap_or(&[])
    {
        if !seen.insert(term.source.as_str()) {
            continue;
        }
        let existing_row = prior.get(term.source.as_str());
        glossary.push(BilingualTerm {
            source: term.source.clone(),
            target: existing_row
                .map(|row| row.target.clone())
                .unwrap_or_default(),
            note: existing_row
                .map(|row| row.note.clone())
                .filter(|note| !note.is_empty())
                .unwrap_or_else(|| term.note.clone()),
            // 目标语一侧的锁：用户在任一侧锁定都算锁定（§5.2 locked→rt 链）。
            locked: term.locked || existing_row.is_some_and(|row| row.locked),
            origin: if term.origin == TermOrigin::User
                || existing_row.is_some_and(|row| row.origin == TermOrigin::User)
            {
                TermOrigin::User
            } else {
                TermOrigin::Analyzed
            },
        });
    }
    // 目标语侧独有的用户行（源语表里没有的条目）不能凭空消失。
    for term in existing
        .map(|context| context.glossary.as_slice())
        .unwrap_or(&[])
    {
        if term.origin == TermOrigin::User && seen.insert(term.source.as_str()) {
            glossary.push(term.clone());
        }
    }
    glossary.sort_by(|left, right| left.source.cmp(&right.source));
    TargetContext {
        target_lang: options.target_lang.to_owned(),
        fingerprint: fingerprint(&doc.words),
        analysis_fingerprint: options
            .analysis
            .map(|analysis| analysis.fingerprint.clone())
            .or_else(|| source.map(|context| context.fingerprint.clone())),
        instructions_fingerprint: options
            .instructions
            .filter(|value| !value.trim().is_empty())
            .map(|value| fingerprint_strings([value])),
        tone: options.tone,
        summary: existing
            .map(|context| context.summary.clone())
            .unwrap_or_default(),
        glossary,
        style: existing
            .map(|context| context.style.clone())
            .unwrap_or_default(),
        difficulties: existing
            .map(|context| context.difficulties.clone())
            .unwrap_or_default(),
    }
}

fn context_target_system(options: &TranslationBriefOptions<'_>) -> String {
    let mut system = CONTEXT_TARGET_PROMPT.to_owned();
    system.push_str(&format!(
        "\n\nTranslation direction: {} → {}.",
        options.source_lang, options.target_lang
    ));
    if let Some(policy) = simplified_chinese_prompt_block(options.target_lang) {
        system.push_str("\n\n");
        system.push_str(policy);
    }
    if let Some(tone) = options.tone {
        system.push_str("\n\nTone: ");
        system.push_str(tone.prompt_line());
    }
    if let Some(reference) = options
        .reference_context
        .filter(|value| !value.trim().is_empty())
    {
        system.push_str(&reference_context_block(Some(reference)));
    }
    if let Some(instructions) = options
        .instructions
        .filter(|value| !value.trim().is_empty())
    {
        system.push_str(&format!(
            "\n\nExplicit translation instructions — AUTHORITATIVE: {instructions}"
        ));
    }
    system
}

/// 目标语行的合法性：斜杠只在 target 凭空发明时非法（源自带斜杠逐字保留）。
fn validate_target_rows(glossary: &[BilingualTerm]) -> Result<(), LlmError> {
    for term in glossary {
        if !has_slash(&term.source) && has_slash(&term.target) {
            return Err(LlmError::Malformed(format!(
                "translation brief target {:?} for {:?} contains slash-separated alternatives — return exactly one literal rendering",
                term.target, term.source
            )));
        }
    }
    Ok(())
}

/// 文件契约下的译向简报（§5）：产出 `ai/context.<lang>.md` 的 [`TargetContext`]。
///
/// 一次调用：种子文档由 canonical 术语表投影而来（§5.3 术语表先行），模型只
/// 补 `Target` 与三个正文小节，随后代码侧恢复用户行——`Origin=user` 的既有
/// 译名逐字沿用，模型行一律 `Origin=analyzed, Lock=no`。
///
/// 设计裁决：不再按全文分页跑 extract+merge。种子表已经带
/// 着 analysis 的全量术语，剩下的证据需求由首尾节选覆盖；缺 analysis 时退化
/// 为「空表 + 节选」的单次调用，仍不阻塞管线。
pub fn run_translation_brief_file_contract(
    doc: &TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &TranslationBriefOptions<'_>,
    source: Option<&SourceContext>,
    existing: Option<&TargetContext>,
    sleep: &mut dyn FnMut(f64),
    on_attempt: &mut dyn FnMut(&PageAttempt<'_>),
) -> Result<TargetContext, LlmError> {
    let seed = seed_target_context(doc, options, source, existing);
    let input = format!(
        "{}\n# Transcript Excerpt\n{}\n",
        render_target_context(&seed),
        head_tail_excerpt(doc, budgets::ANALYSIS)
    );
    let system = context_target_system(options);
    let page_id = context_page_id(0);
    let mut tries = 0_u32;
    // 重试意见回灌真实 problems 摘要（§2.5），不再是固定字符串。
    let mut last_problems: Option<String> = None;
    let parsed = with_retry(MAX_RETRIES, &mut *sleep, |attempt| {
        let raw = llm.complete(&LlmRequest {
            kind: "translate-brief",
            system: system.clone(),
            user: input.clone(),
            temperature: 0.2,
            attempt: attempt + 1,
            retry_reason: (attempt > 0).then(|| {
                last_problems.clone().unwrap_or_else(|| {
                    "the previous target context document failed validation".to_owned()
                })
            }),
        })?;
        tries += 1;
        let parsed = parse_model_target_context(Some(&input), &raw);
        let problems = parsed.diagnostics.problems.clone();
        let outcome = match parsed.context {
            Some(context) => validate_target_rows(&context.glossary).map(|()| context),
            None => Err(LlmError::Malformed(format!(
                "target context rejected — {}",
                summarize_context_problems(&problems)
            ))),
        };
        if let Err(error) = &outcome {
            last_problems = Some(malformed_detail(error));
        }
        on_attempt(&PageAttempt {
            page_id: &page_id,
            attempt: tries,
            input: &input,
            output: &raw,
            problems: &problems,
            accepted: outcome.is_ok(),
        });
        outcome
    })?;

    let mut model_rows = parsed.glossary;
    for row in &mut model_rows {
        row.source = row.source.trim().to_owned();
        row.target = row.target.trim().to_owned();
        row.origin = TermOrigin::Analyzed;
        row.locked = false;
    }
    model_rows.retain(|row| !row.source.is_empty());
    let model_targets: std::collections::BTreeMap<&str, &str> = model_rows
        .iter()
        .map(|row| (row.source.as_str(), row.target.as_str()))
        .collect();
    // 用户行的最终形态：已有译名逐字沿用；首次补译（`Target` 还空着）才采纳
    // 模型这一轮填进来的译名，`Lock`/`Origin` 始终来自用户通道。
    let user_rows = seed
        .glossary
        .iter()
        .filter(|row| row.origin == TermOrigin::User)
        .map(|row| {
            let mut row = row.clone();
            if row.target.trim().is_empty()
                && let Some(target) = model_targets.get(row.source.as_str())
            {
                row.target = (*target).to_owned();
            }
            row
        })
        .filter(|row| !(row.locked && row.target.trim().is_empty()))
        .collect::<Vec<_>>();
    let glossary = merge_bilingual_terms(&user_rows, &model_rows);

    Ok(TargetContext {
        target_lang: options.target_lang.to_owned(),
        fingerprint: fingerprint(&doc.words),
        analysis_fingerprint: seed.analysis_fingerprint.clone(),
        instructions_fingerprint: seed.instructions_fingerprint.clone(),
        tone: options.tone,
        // 摘要/风格会回显进 translate prompt，验收时
        // 规范化 CJK 语境半角标点，落盘的 context.<lang>.md 即为干净形态。
        summary: crate::atomize::normalize_cjk_ascii_punctuation(
            if parsed.summary.trim().is_empty() {
                &seed.summary
            } else {
                parsed.summary.trim()
            },
        ),
        glossary,
        style: crate::atomize::normalize_cjk_ascii_punctuation(if parsed.style.trim().is_empty() {
            &seed.style
        } else {
            parsed.style.trim()
        }),
        difficulties: if parsed.difficulties.is_empty() {
            seed.difficulties.clone()
        } else {
            parsed.difficulties
        },
    })
}

/// `task submit` 期的镜像 lint（§10.3）：与引擎走同一个解析器。
///
/// 解析口径是 [`crate::filepipe::ParseMode::Model`]：重复行、列数错乱、未知
/// Category、缺 frontmatter 这类可代码消解的缺陷只记 Warning，镜像 lint 因此
/// 不再把它们判成 `rejected`——与引擎的接受判据严格一致。
pub fn lint_agent_answer_context_source(payload: &str, answer: &str) -> Vec<String> {
    let parsed = parse_model_source_context(Some(payload), answer);
    context_problem_lines(&parsed.diagnostics.problems)
}

/// 同上，目标语文档；额外复检斜杠规则（引擎侧同判据）。
pub fn lint_agent_answer_context_target(payload: &str, answer: &str) -> Vec<String> {
    let parsed = parse_model_target_context(Some(payload), answer);
    let mut problems = context_problem_lines(&parsed.diagnostics.problems);
    if let Some(context) = parsed.context
        && let Err(error) = validate_target_rows(&context.glossary)
    {
        problems.push(error.to_string());
    }
    problems
}

/// `context.md` → 旧 [`Analysis`] 模型（下游 prompt 组装仍消费）。
///
/// `namedEntities` 在 context.md 里没有独立字段：设计 §5.1 明写 context.md
/// **替代** `summary/terms/namedEntities` 三者，实体就是 `Category` 落在
/// person/product/proper 的术语行。转换按这条规则重建，`ai/brief.json` 的
/// 双写因此不会退化成空实体表。
pub fn analysis_from_source_context(context: &SourceContext) -> Analysis {
    Analysis {
        summary: context.summary.clone(),
        terms: context
            .terms
            .iter()
            .map(|term| AnalysisTerm {
                term: term.source.clone(),
                note: (!term.note.is_empty()).then(|| term.note.clone()),
                observed_variants: term.variants.clone(),
            })
            .collect(),
        named_entities: context
            .terms
            .iter()
            .filter(|term| {
                matches!(
                    term.category,
                    TermCategory::Person | TermCategory::Product | TermCategory::Proper
                )
            })
            .map(|term| term.source.clone())
            .collect(),
        fingerprint: context.fingerprint.clone(),
        reference_fingerprint: context.reference_fingerprint.clone(),
    }
}

/// 旧 [`Analysis`] 模型 → `context.md`（存量迁移，§5.2 第 2 条）。
///
/// 旧模型的术语没有类别：命名实体行落 `proper`，其余落 `other`。所有行都是
/// `Origin=analyzed, Lock=no`——旧源语表本来就没有用户锁定通道。
pub fn source_context_from_analysis(analysis: &Analysis) -> SourceContext {
    let entities = analysis
        .named_entities
        .iter()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let mut seen = std::collections::BTreeSet::new();
    let mut terms = analysis
        .terms
        .iter()
        .filter(|term| !term.term.trim().is_empty())
        .filter(|term| seen.insert(term.term.trim().to_owned()))
        .map(|term| CanonicalTerm {
            source: term.term.trim().to_owned(),
            category: if entities.contains(term.term.trim()) {
                TermCategory::Proper
            } else {
                TermCategory::Other
            },
            variants: term.observed_variants.clone(),
            note: term.note.clone().unwrap_or_default(),
            locked: false,
            origin: TermOrigin::Analyzed,
        })
        .collect::<Vec<_>>();
    for entity in analysis
        .named_entities
        .iter()
        .filter(|entity| !entity.trim().is_empty())
    {
        if seen.insert(entity.trim().to_owned()) {
            terms.push(CanonicalTerm {
                source: entity.trim().to_owned(),
                category: TermCategory::Proper,
                variants: Vec::new(),
                note: String::new(),
                locked: false,
                origin: TermOrigin::Analyzed,
            });
        }
    }
    terms.sort_by(|left, right| left.source.cmp(&right.source));
    SourceContext {
        fingerprint: analysis.fingerprint.clone(),
        reference_fingerprint: analysis.reference_fingerprint.clone(),
        summary: analysis.summary.clone(),
        terms,
    }
}

/// `context.<lang>.md` → 旧 [`DocumentBrief`] 模型。
///
/// **这是 M4 消费链迁移的落点**：`Lock=yes` 行变成 `GlossaryEntry.locked=true`，
/// 于是 §5.2 的四道下游约束（`rt` → [`crate::engines::translate::validate_translated_page`]
/// → `lint_agent_answer` → `check missingTargets`）与 align 的
/// `protected_targets` / `bilingual_anchors` 全部原样接通，无需改动任何消费者。
/// 尚未补译（`Target` 为空）的行不进 brief：空译名在下游只会产生噪声。
///
/// `source` 是同一文档的 `context.md`。命名实体在 context 契约里由源语表的
/// `Category` 决定（person/product/proper）；缺 `source` 时退化为「用户锁定行
/// 即实体」——注意这是**降级**口径，宿主有源语上下文时必须把它传进来，否则
/// 一篇没有任何锁定行的文档会丢掉 translate 的实体提示块。
pub fn brief_from_target_context(
    context: &TargetContext,
    source: Option<&SourceContext>,
) -> DocumentBrief {
    let glossary = context
        .glossary
        .iter()
        .filter(|term| !term.source.trim().is_empty() && !term.target.trim().is_empty())
        .map(|term| GlossaryEntry {
            source: term.source.clone(),
            target: term.target.clone(),
            note: (!term.note.is_empty()).then(|| term.note.clone()),
            locked: term.locked,
        })
        .collect::<Vec<_>>();
    let named_entities = match source {
        Some(source) => source
            .terms
            .iter()
            .filter(|term| {
                matches!(
                    term.category,
                    TermCategory::Person | TermCategory::Product | TermCategory::Proper
                )
            })
            .map(|term| term.source.clone())
            .collect(),
        None => glossary
            .iter()
            .filter(|entry| entry.locked)
            .map(|entry| entry.source.clone())
            .collect(),
    };
    DocumentBrief {
        target_lang: context.target_lang.clone(),
        tone: context.tone,
        // 读取侧也做标点规范化：存量 context.<lang>.md 里可能带着验收前
        // 混入的半角标点，转换处清洗一次即可覆盖历史残留（幂等）。
        summary: crate::atomize::normalize_cjk_ascii_punctuation(&context.summary),
        named_entities,
        glossary,
        style_guide: crate::atomize::normalize_cjk_ascii_punctuation(&context.style),
        difficulties: context.difficulties.clone(),
        fingerprint: context.fingerprint.clone(),
        analysis_fingerprint: context.analysis_fingerprint.clone(),
        instructions_fingerprint: context.instructions_fingerprint.clone(),
    }
}

/// 旧 [`DocumentBrief`] 模型 → `context.<lang>.md`（存量迁移，§5.2 第 2 条）。
///
/// `locked=true` 的存量条目转为 `Origin=user, Lock=yes`——这正是设计要求的
/// 「用户锁定通道」迁移；生成式条目落 `Origin=analyzed`。
pub fn target_context_from_brief(brief: &DocumentBrief) -> TargetContext {
    let mut glossary = brief
        .glossary
        .iter()
        .filter(|entry| !entry.source.trim().is_empty())
        .map(|entry| BilingualTerm {
            source: entry.source.trim().to_owned(),
            target: entry.target.trim().to_owned(),
            note: entry.note.clone().unwrap_or_default(),
            locked: entry.locked,
            origin: if entry.locked {
                TermOrigin::User
            } else {
                TermOrigin::Analyzed
            },
        })
        // 锁定行没有译名时无法编译 required targets，解析器也会拒；存量里
        // 不该有这种行，真出现就降级为不锁。
        .map(|mut term| {
            if term.locked && term.target.is_empty() {
                term.locked = false;
                term.origin = TermOrigin::Analyzed;
            }
            term
        })
        .collect::<Vec<_>>();
    glossary.sort_by(|left, right| left.source.cmp(&right.source));
    glossary.dedup_by(|left, right| left.source == right.source);
    TargetContext {
        target_lang: brief.target_lang.clone(),
        fingerprint: brief.fingerprint.clone(),
        analysis_fingerprint: brief.analysis_fingerprint.clone(),
        instructions_fingerprint: brief.instructions_fingerprint.clone(),
        tone: brief.tone,
        summary: brief.summary.clone(),
        glossary,
        style: brief.style_guide.clone(),
        difficulties: brief.difficulties.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asr_rows::RowIn;
    use crate::build::build_doc;
    use crate::doc::{DocEngine, DocMedia};
    use crate::llm::FakeLlm;

    fn doc() -> TranscriptDoc {
        build_doc(
            &[RowIn::new(0.0, 5.0, "we use bao cut every day")],
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 10.0,
                sample_rate: None,
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

    // ── file-v1（M4）────────────────────────────────────────────────────

    const CONTEXT_ANSWER: &str = "---\nformat: \"context-doc/1\"\nfingerprint: \"\"\n---\n# Summary\nA demo about BaoCut.\n\n# Canonical Terms\n| Source | Category | Variants | Note | Lock | Origin |\n|---|---|---|---|---|---|\n| BaoCut | product | bao cut, BaoKut | 产品名 | no | analyzed |\n";

    #[test]
    fn file_contract_analysis_filters_variants_and_stamps_fingerprint() {
        let doc = doc();
        let mut llm = FakeLlm::ok([CONTEXT_ANSWER]);
        let mut attempts = Vec::new();
        let context = run_analysis_file_contract(
            &doc,
            &mut llm,
            &AnalysisOptions::default(),
            None,
            &mut |_| {},
            &mut |attempt| attempts.push((attempt.page_id.to_owned(), attempt.accepted)),
        )
        .expect("analysis");
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(llm.calls[0].0, "analysis");
        assert_eq!(attempts, vec![("p001".to_owned(), true)]);
        assert_eq!(context.terms.len(), 1);
        // 反幻觉判据：BaoKut 未字面出现被滤掉。
        assert_eq!(context.terms[0].variants, vec!["bao cut".to_owned()]);
        assert_eq!(context.terms[0].category, TermCategory::Product);
        assert_eq!(context.fingerprint, fingerprint(&doc.words));
    }

    #[test]
    fn file_contract_analysis_keeps_user_rows_and_demotes_model_claims() {
        let doc = doc();
        // 模型自封 Lock/Origin：必须被降级，且不得顶掉用户行。
        let answer: &'static str = Box::leak(
            CONTEXT_ANSWER
                .replace("| no | analyzed |", "| yes | user |")
                .into_boxed_str(),
        );
        let mut llm = FakeLlm::ok([answer]);
        let existing = SourceContext {
            terms: vec![CanonicalTerm {
                source: "BaoCut".to_owned(),
                category: TermCategory::Product,
                variants: vec!["bao cut".to_owned()],
                note: "用户钉死".to_owned(),
                locked: true,
                origin: TermOrigin::User,
            }],
            ..SourceContext::default()
        };
        let context = run_analysis_file_contract(
            &doc,
            &mut llm,
            &AnalysisOptions::default(),
            Some(&existing),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("analysis");
        assert_eq!(context.terms.len(), 1);
        assert_eq!(context.terms[0].origin, TermOrigin::User);
        assert!(context.terms[0].locked);
        assert_eq!(context.terms[0].note, "用户钉死");
    }

    #[test]
    fn file_contract_analysis_rejects_unparseable_document() {
        let doc = doc();
        let mut llm = FakeLlm::ok(["not a context document at all", "still not one", "nor this"]);
        let mut rejected = 0_u32;
        let error = run_analysis_file_contract(
            &doc,
            &mut llm,
            &AnalysisOptions::default(),
            None,
            &mut |_| {},
            &mut |attempt| {
                if !attempt.accepted {
                    rejected += 1;
                }
            },
        )
        .expect_err("must not fabricate an empty context");
        assert!(matches!(error, LlmError::Malformed(_)), "{error:?}");
        assert!(rejected >= 1);
    }

    /// 9600 词 → 两个 analysis 页（ANALYSIS=8000 + 10% slack / ANALYSIS_MIN_LAST=500）。
    fn two_page_doc() -> TranscriptDoc {
        let text = "yan lecun says bao cut ".repeat(40);
        let rows = (0..48)
            .map(|i| RowIn::new(i as f64 * 10.0, i as f64 * 10.0 + 9.0, text.trim()))
            .collect::<Vec<_>>();
        build_doc(
            &rows,
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 430.0,
                sample_rate: None,
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

    const PAGE_ONE_ANSWER: &str = "---\nformat: \"context-doc/1\"\nfingerprint: \"\"\n---\n# Summary\nPart one summary.\n\n# Canonical Terms\n| Source | Category | Variants | Note | Lock | Origin |\n|---|---|---|---|---|---|\n| BaoCut | product | bao cut | short | no | analyzed |\n| Yann LeCun | person | yan lecun | | no | analyzed |\n";
    const PAGE_TWO_ANSWER: &str = "---\nformat: \"context-doc/1\"\nfingerprint: \"\"\n---\n# Summary\nPart two summary is the longer one.\n\n# Canonical Terms\n| Source | Category | Variants | Note | Lock | Origin |\n|---|---|---|---|---|---|\n| baocut | product | | a much longer note | no | analyzed |\n| Yann-LeCun | tech | | | no | analyzed |\n";
    const SUMMARY_ANSWER: &str = "---\nformat: \"context-doc/1\"\nfingerprint: \"\"\n---\n# Summary\nMerged summary.\n\n# Canonical Terms\n| Source | Category | Variants | Note | Lock | Origin |\n|---|---|---|---|---|---|\n";

    #[test]
    fn file_contract_analysis_merges_terms_deterministically_and_asks_summary_only() {
        let doc = two_page_doc();
        assert_eq!(
            paginate_word_ranges(&doc.words, budgets::ANALYSIS, budgets::ANALYSIS_MIN_LAST).len(),
            2
        );
        let mut llm = FakeLlm::ok([PAGE_ONE_ANSWER, PAGE_TWO_ANSWER, SUMMARY_ANSWER]);
        let mut attempts = Vec::new();
        let context = run_analysis_file_contract(
            &doc,
            &mut llm,
            &AnalysisOptions::default(),
            None,
            &mut |_| {},
            &mut |attempt| attempts.push((attempt.page_id.to_owned(), attempt.accepted)),
        )
        .expect("analysis");
        assert_eq!(llm.calls.len(), 3);
        // merge 调用只带各页摘要，不再带整张术语表。
        let merge_user = &llm.calls[2].2;
        assert!(
            merge_user.contains("## Part p001\nPart one summary."),
            "{merge_user}"
        );
        assert!(!merge_user.contains("| BaoCut |"), "{merge_user}");
        assert!(llm.calls[2].1.contains("leave the table EMPTY"));
        assert_eq!(
            attempts,
            vec![
                ("p001".to_owned(), true),
                ("p002".to_owned(), true),
                ("merge".to_owned(), true)
            ]
        );
        assert_eq!(context.summary, "Merged summary.");
        // 术语并集：拼写平局取先见、Note 取最长、Category 众数平局取先见、
        // 落选拼写并入 Variants 后仍受字面出现判据约束（"Yann-LeCun" 未出现被滤）。
        assert_eq!(context.terms.len(), 2);
        let baocut = &context.terms[0];
        assert_eq!(baocut.source, "BaoCut");
        assert_eq!(baocut.note, "a much longer note");
        assert_eq!(baocut.variants, vec!["bao cut".to_owned()]);
        let lecun = &context.terms[1];
        assert_eq!(lecun.source, "Yann LeCun");
        assert_eq!(lecun.category, TermCategory::Person);
        assert_eq!(lecun.variants, vec!["yan lecun".to_owned()]);
        assert_eq!(context.fingerprint, fingerprint(&doc.words));
    }

    #[test]
    fn file_contract_analysis_summary_merge_falls_back_to_longest_partial() {
        let doc = two_page_doc();
        let mut llm = FakeLlm::ok([
            PAGE_ONE_ANSWER,
            PAGE_TWO_ANSWER,
            "not a document",
            "still not",
            "nor this",
        ]);
        let context = run_analysis_file_contract(
            &doc,
            &mut llm,
            &AnalysisOptions::default(),
            None,
            &mut |_| {},
            &mut |_| {},
        )
        .expect("summary failure must not sink the merged terms");
        assert_eq!(llm.calls.len(), 5);
        assert_eq!(context.summary, "Part two summary is the longer one.");
        assert_eq!(context.terms.len(), 2);
    }

    #[test]
    fn merge_partial_terms_prefers_majority_spelling_and_unions_variants() {
        let term = |source: &str, category, variants: &[&str], note: &str| CanonicalTerm {
            source: source.to_owned(),
            category,
            variants: variants.iter().map(|v| (*v).to_owned()).collect(),
            note: note.to_owned(),
            locked: false,
            origin: TermOrigin::Analyzed,
        };
        let partial = |terms: Vec<CanonicalTerm>| SourceContext {
            terms,
            ..SourceContext::default()
        };
        let merged = merge_partial_terms(&[
            partial(vec![term("resnext", TermCategory::Tech, &["res next"], "")]),
            partial(vec![term(
                "ResNeXt",
                TermCategory::Tech,
                &["Res Next", "resnet x"],
                "arch",
            )]),
            partial(vec![
                term("ResNeXt", TermCategory::Proper, &[], ""),
                term("DiT", TermCategory::Tech, &["dit"], ""),
            ]),
        ]);
        let (merged, dropped) = merged;
        assert_eq!(dropped, 0);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].source, "ResNeXt");
        assert_eq!(merged[0].category, TermCategory::Tech);
        assert_eq!(merged[0].note, "arch");
        assert_eq!(
            merged[0].variants,
            vec!["res next".to_owned(), "resnet x".to_owned()]
        );
        assert_eq!(merged[1].source, "DiT");
        // 与规范形只差大小写的变体不保留。
        assert!(merged[1].variants.is_empty());
    }

    /// 全文行数上限（§2.1）：超出 [`ANALYSIS_MAX_TERMS`] 的键按跨页出现次数
    /// 降序取胜，输出仍按首现顺序；丢弃计数交给宿主上报，不拒页。
    #[test]
    fn merge_partial_terms_caps_total_rows_by_cross_page_hits() {
        let term = |source: String| CanonicalTerm {
            source,
            category: TermCategory::Tech,
            variants: Vec::new(),
            note: String::new(),
            locked: false,
            origin: TermOrigin::Analyzed,
        };
        // 页 1 写 ANALYSIS_MAX_TERMS + 20 个独有词；页 2 只复写最后 10 个。
        let unique: Vec<CanonicalTerm> = (0..ANALYSIS_MAX_TERMS + 20)
            .map(|index| term(format!("Term{index:04}")))
            .collect();
        let repeated: Vec<CanonicalTerm> = (ANALYSIS_MAX_TERMS + 10..ANALYSIS_MAX_TERMS + 20)
            .map(|index| term(format!("Term{index:04}")))
            .collect();
        let partial = |terms: Vec<CanonicalTerm>| SourceContext {
            terms,
            ..SourceContext::default()
        };
        let (merged, dropped) = merge_partial_terms(&[partial(unique), partial(repeated)]);
        assert_eq!(merged.len(), ANALYSIS_MAX_TERMS);
        assert_eq!(dropped, 20);
        // 出现两次的 10 个词必须留下，哪怕它们首现顺序最靠后。
        for index in ANALYSIS_MAX_TERMS + 10..ANALYSIS_MAX_TERMS + 20 {
            let wanted = format!("Term{index:04}");
            assert!(
                merged.iter().any(|term| term.source == wanted),
                "{wanted} 出现两次却被截断"
            );
        }
        // 输出顺序仍是首现顺序（单调递增的 Term 序号）。
        let sources: Vec<&str> = merged.iter().map(|term| term.source.as_str()).collect();
        let mut sorted = sources.clone();
        sorted.sort_unstable();
        assert_eq!(sources, sorted);
    }

    /// §2.1 端到端：一页三次耗尽**不再**上抛整条 analysis。剩下的页照常归并，
    /// 失败页只计入 `pages_failed`。实测 5 次 analysis 运行每次都有 3–9 页耗尽，
    /// 旧行为把整条 polish 一起拖垮。
    #[test]
    fn file_contract_analysis_keeps_good_pages_when_one_page_gives_up() {
        let doc = two_page_doc();
        let mut llm = FakeLlm::ok([PAGE_ONE_ANSWER, "not a document", "still not", "nor this"]);
        let outcome = run_analysis_file_contract_report(
            &doc,
            &mut llm,
            &AnalysisOptions::default(),
            None,
            &mut |_| {},
            &mut |_| {},
        )
        .expect("one failed page must not sink the analysis");
        assert_eq!(outcome.pages_failed, 1);
        assert_eq!(outcome.terms_dropped, 0);
        // 只剩一页成功 ⇒ 不再跑 merge 调用，摘要直接取那一页。
        assert_eq!(outcome.context.summary, "Part one summary.");
        assert_eq!(
            outcome
                .context
                .terms
                .iter()
                .map(|term| term.source.as_str())
                .collect::<Vec<_>>(),
            vec!["BaoCut", "Yann LeCun"]
        );
        assert_eq!(outcome.context.fingerprint, fingerprint(&doc.words));
    }

    /// 全部页耗尽仍然 `Err`：宿主必须保留旧 context，绝不以空表覆盖。
    #[test]
    fn file_contract_analysis_errors_only_when_every_page_fails() {
        let doc = two_page_doc();
        let mut llm = FakeLlm::ok(["a", "b", "c", "d", "e", "f"]);
        let error = run_analysis_file_contract_report(
            &doc,
            &mut llm,
            &AnalysisOptions::default(),
            None,
            &mut |_| {},
            &mut |_| {},
        )
        .expect_err("no usable page at all");
        assert!(matches!(error, LlmError::Malformed(_)), "{error:?}");
    }

    /// 实测最高频的两种页拒（重复行 / 大表）现在首轮即接受，一次调用就够。
    #[test]
    fn file_contract_analysis_accepts_duplicate_and_bulky_tables_in_one_call() {
        // 单页但足够长的输入：体积硬顶按 8× 输入算，太短的夹具会被下限吃掉。
        let text = "we use bao cut every day ".repeat(20);
        let rows = (0..20)
            .map(|i| RowIn::new(i as f64 * 10.0, i as f64 * 10.0 + 9.0, text.trim()))
            .collect::<Vec<_>>();
        let doc = build_doc(
            &rows,
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 200.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "t".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        );
        assert_eq!(
            paginate_word_ranges(&doc.words, budgets::ANALYSIS, budgets::ANALYSIS_MIN_LAST).len(),
            1
        );
        let bulky: String = (0..400)
            .map(|index| format!("| Term{index:04} | tech | | | no | analyzed |\n"))
            .collect();
        let answer: &'static str = Box::leak(
            format!(
                "---\nformat: \"context-doc/1\"\nfingerprint: \"\"\n---\n# Summary\n摘要。\n\n\
                 # Canonical Terms\n| Source | Category | Variants | Note | Lock | Origin |\n\
                 |---|---|---|---|---|---|\n\
                 | BaoCut | product | bao cut | | no | analyzed |\n\
                 | baocut | brand | bao cut | 重复行 | no | analyzed |\n{bulky}"
            )
            .into_boxed_str(),
        );
        let mut llm = FakeLlm::ok([answer]);
        let mut rejected = 0_u32;
        let outcome = run_analysis_file_contract_report(
            &doc,
            &mut llm,
            &AnalysisOptions::default(),
            None,
            &mut |_| {},
            &mut |attempt| {
                if !attempt.accepted {
                    rejected += 1;
                }
            },
        )
        .expect("duplicate rows and a 400-row table are repaired, not retried");
        assert_eq!(llm.calls.len(), 1, "首轮即接受，不再烧三次重试");
        assert_eq!(rejected, 0);
        assert_eq!(outcome.pages_failed, 0);
        // 单页上限截到 150 行；第一行的重复被合并。
        assert_eq!(
            outcome.context.terms.len(),
            crate::filepipe::ANALYSIS_MAX_TERMS_PER_PAGE
        );
        assert_eq!(outcome.context.terms[0].source, "BaoCut");
    }

    /// 提示词收紧（§2.1）：明确禁止普通词汇/语气词，并写死每页行数上限。
    #[test]
    fn analysis_prompt_forbids_ordinary_vocabulary() {
        assert!(CONTEXT_EXTRACT_PROMPT.contains("NEVER list ordinary vocabulary"));
        assert!(CONTEXT_EXTRACT_PROMPT.contains("At most 80 rows"));
        assert!(CONTEXT_EXTRACT_PROMPT.contains("never repeat a `Source`"));
    }

    #[test]
    fn file_contract_analysis_injects_reference_and_stamps_fingerprint() {
        let doc = doc();
        let mut llm = FakeLlm::ok([CONTEXT_ANSWER]);
        let context_text = "Source title: BaoCut with Dana Li";
        let context = run_analysis_file_contract(
            &doc,
            &mut llm,
            &AnalysisOptions {
                reference_context: Some(context_text.to_owned()),
                ..Default::default()
            },
            None,
            &mut |_| {},
            &mut |_| {},
        )
        .expect("analysis");
        assert!(llm.calls[0].1.contains(context_text));
        assert_eq!(
            context.reference_fingerprint,
            Some(fingerprint_strings([context_text]))
        );
    }

    fn source_context() -> SourceContext {
        SourceContext {
            fingerprint: "fp-src".to_owned(),
            reference_fingerprint: None,
            summary: "A demo about BaoCut.".to_owned(),
            terms: vec![
                CanonicalTerm {
                    source: "BaoCut".to_owned(),
                    category: TermCategory::Product,
                    variants: vec!["bao cut".to_owned()],
                    note: String::new(),
                    locked: true,
                    origin: TermOrigin::User,
                },
                CanonicalTerm {
                    source: "every day".to_owned(),
                    category: TermCategory::Other,
                    variants: Vec::new(),
                    note: String::new(),
                    locked: false,
                    origin: TermOrigin::Analyzed,
                },
            ],
        }
    }

    #[test]
    fn file_contract_translation_brief_seeds_terms_and_keeps_user_targets() {
        let doc = doc();
        let source = source_context();
        let existing = TargetContext {
            target_lang: "zh-Hans".to_owned(),
            glossary: vec![BilingualTerm {
                source: "BaoCut".to_owned(),
                target: "宝剪".to_owned(),
                note: String::new(),
                locked: true,
                origin: TermOrigin::User,
            }],
            ..TargetContext::default()
        };
        let answer = "---\nformat: \"context-doc/1\"\ntargetLang: \"zh-Hans\"\nfingerprint: \"\"\n---\n# Translated Summary\n关于宝剪的演示。\n\n# Bilingual Glossary\n| Source | Target | Note | Lock | Origin |\n|---|---|---|---|---|\n| BaoCut | 包裁 | | yes | user |\n| every day | 每天 | | no | analyzed |\n\n# Translation Style\n口语化。\n\n# Difficulties\n- 产品名不译\n";
        let mut llm = FakeLlm::ok([answer]);
        let options = TranslationBriefOptions {
            source_lang: "en",
            target_lang: "zh-Hans",
            ..TranslationBriefOptions::default()
        };
        let context = run_translation_brief_file_contract(
            &doc,
            &mut llm,
            &options,
            Some(&source),
            Some(&existing),
            &mut |_| {},
            &mut |_| {},
        )
        .expect("brief");
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(llm.calls[0].0, "translate-brief");
        // 种子文档必须把源语术语投影进去，模型只填 Target。
        assert!(llm.calls[0].2.contains("| BaoCut |"), "{}", llm.calls[0].2);
        let locked = context
            .glossary
            .iter()
            .find(|term| term.source == "BaoCut")
            .expect("locked row");
        // 用户锁定的译名逐字沿用，模型改写（包裁）被丢弃。
        assert_eq!(locked.target, "宝剪");
        assert_eq!(locked.origin, TermOrigin::User);
        assert!(locked.locked);
        let generated = context
            .glossary
            .iter()
            .find(|term| term.source == "every day")
            .expect("generated row");
        assert_eq!(generated.target, "每天");
        assert_eq!(generated.origin, TermOrigin::Analyzed);
        assert!(!generated.locked);
        assert_eq!(context.style, "口语化。");
        assert_eq!(context.difficulties, vec!["产品名不译".to_owned()]);
        assert_eq!(context.fingerprint, fingerprint(&doc.words));
        assert_eq!(context.analysis_fingerprint.as_deref(), Some("fp-src"));
    }

    #[test]
    fn file_contract_translation_brief_rejects_slash_alternatives() {
        let doc = doc();
        let answer = "---\nformat: \"context-doc/1\"\ntargetLang: \"zh-Hans\"\nfingerprint: \"\"\n---\n# Translated Summary\ns\n\n# Bilingual Glossary\n| Source | Target | Note | Lock | Origin |\n|---|---|---|---|---|\n| BaoCut | 宝剪/包裁 | | no | analyzed |\n\n# Translation Style\n\n# Difficulties\n";
        let mut llm = FakeLlm::ok([answer, answer, answer]);
        let options = TranslationBriefOptions {
            source_lang: "en",
            target_lang: "zh-Hans",
            ..TranslationBriefOptions::default()
        };
        let error = run_translation_brief_file_contract(
            &doc,
            &mut llm,
            &options,
            None,
            None,
            &mut |_| {},
            &mut |_| {},
        )
        .expect_err("slash alternatives are rejected");
        assert!(matches!(error, LlmError::Malformed(_)), "{error:?}");
    }

    #[test]
    fn context_documents_round_trip_through_legacy_models() {
        let source = source_context();
        let analysis = analysis_from_source_context(&source);
        // Category ∈ {person, product, proper} 的行就是命名实体。
        assert_eq!(analysis.named_entities, vec!["BaoCut".to_owned()]);
        let back = source_context_from_analysis(&analysis);
        assert_eq!(back.summary, source.summary);
        assert_eq!(
            back.terms
                .iter()
                .map(|t| t.source.as_str())
                .collect::<Vec<_>>(),
            vec!["BaoCut", "every day"]
        );

        let target = TargetContext {
            target_lang: "zh-Hans".to_owned(),
            fingerprint: "fp".to_owned(),
            glossary: vec![
                BilingualTerm {
                    source: "BaoCut".to_owned(),
                    target: "宝剪".to_owned(),
                    note: "产品".to_owned(),
                    locked: true,
                    origin: TermOrigin::User,
                },
                BilingualTerm {
                    source: "pending".to_owned(),
                    target: String::new(),
                    note: String::new(),
                    locked: false,
                    origin: TermOrigin::Analyzed,
                },
            ],
            style: "口语".to_owned(),
            ..TargetContext::default()
        };
        let brief = brief_from_target_context(&target, Some(&source));
        // 未补译的行不进 brief；Lock=yes 变成 GlossaryEntry.locked。
        assert_eq!(brief.glossary.len(), 1);
        assert!(brief.glossary[0].locked);
        // 实体来自源语表的 Category，而不是「锁定行」这个降级口径。
        assert_eq!(brief.named_entities, vec!["BaoCut".to_owned()]);
        assert_eq!(brief.style_guide, "口语");
        let degraded = brief_from_target_context(&target, None);
        // 存量 context 里 CJK 语境的半角标点在转换处被规范化（历史残留清洗）。
        let infected = TargetContext {
            summary: "介绍 vLLM,重点是显存".to_owned(),
            style: "口语化,短句;避免书面腔:直译".to_owned(),
            ..target.clone()
        };
        let cleaned = brief_from_target_context(&infected, Some(&source));
        assert_eq!(cleaned.summary, "介绍 vLLM，重点是显存");
        assert_eq!(cleaned.style_guide, "口语化，短句；避免书面腔：直译");
        assert_eq!(degraded.named_entities, vec!["BaoCut".to_owned()]);
        let back = target_context_from_brief(&brief);
        assert_eq!(back.glossary.len(), 1);
        assert_eq!(back.glossary[0].origin, TermOrigin::User);
        assert!(back.glossary[0].locked);
    }

    #[test]
    fn legacy_brief_locked_entries_migrate_to_user_origin() {
        let brief = DocumentBrief {
            target_lang: "zh-Hans".to_owned(),
            glossary: vec![
                GlossaryEntry {
                    source: "BaoCut".to_owned(),
                    target: "宝剪".to_owned(),
                    note: None,
                    locked: true,
                },
                GlossaryEntry {
                    source: "demo".to_owned(),
                    target: "演示".to_owned(),
                    note: None,
                    locked: false,
                },
            ],
            ..DocumentBrief::default()
        };
        let context = target_context_from_brief(&brief);
        let locked = &context.glossary[0];
        assert_eq!(locked.source, "BaoCut");
        assert_eq!(locked.origin, TermOrigin::User);
        assert!(locked.locked);
        assert_eq!(context.glossary[1].origin, TermOrigin::Analyzed);
    }

    #[test]
    fn merge_bilingual_terms_respects_user_lock_priority() {
        let existing = vec![BilingualTerm {
            source: "BaoCut".to_owned(),
            target: "宝剪".to_owned(),
            note: String::new(),
            locked: true,
            origin: TermOrigin::User,
        }];
        let regenerated = vec![
            BilingualTerm {
                source: "BaoCut".to_owned(),
                target: "包裁".to_owned(),
                note: String::new(),
                locked: false,
                origin: TermOrigin::Analyzed,
            },
            BilingualTerm {
                source: "demo".to_owned(),
                target: "演示".to_owned(),
                note: String::new(),
                locked: false,
                origin: TermOrigin::Analyzed,
            },
        ];
        let merged = merge_bilingual_terms(&existing, &regenerated);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].target, "宝剪");
        assert_eq!(merged[1].target, "演示");
    }

    #[test]
    fn agent_lint_mirrors_engine_rejection() {
        assert!(lint_agent_answer_context_source("", CONTEXT_ANSWER).is_empty());
        assert!(!lint_agent_answer_context_source("", "garbage").is_empty());
        let slashed = "---\nformat: \"context-doc/1\"\ntargetLang: \"zh-Hans\"\nfingerprint: \"\"\n---\n# Translated Summary\ns\n\n# Bilingual Glossary\n| Source | Target | Note | Lock | Origin |\n|---|---|---|---|---|\n| BaoCut | 宝剪/包裁 | | no | analyzed |\n\n# Translation Style\n\n# Difficulties\n";
        let problems = lint_agent_answer_context_target("", slashed);
        assert!(
            problems.iter().any(|line| line.contains("slash")),
            "{problems:?}"
        );
        // 源词自带斜杠（半角/全角）逐字保留不算并列备选；target 凭空发明的
        // 全角斜杠同样被拒。
        let verbatim = "---\nformat: \"context-doc/1\"\ntargetLang: \"zh-Hans\"\nfingerprint: \"\"\n---\n# Translated Summary\ns\n\n# Bilingual Glossary\n| Source | Target | Note | Lock | Origin |\n|---|---|---|---|---|\n| /compact | /compact | | no | analyzed |\n| AI／人工智能 | AI／人工智能 | | no | analyzed |\n\n# Translation Style\n\n# Difficulties\n";
        assert!(lint_agent_answer_context_target("", verbatim).is_empty());
        let fullwidth = "---\nformat: \"context-doc/1\"\ntargetLang: \"zh-Hans\"\nfingerprint: \"\"\n---\n# Translated Summary\ns\n\n# Bilingual Glossary\n| Source | Target | Note | Lock | Origin |\n|---|---|---|---|---|\n| BaoCut | 宝剪辑／包剪 | | no | analyzed |\n\n# Translation Style\n\n# Difficulties\n";
        assert!(!lint_agent_answer_context_target("", fullwidth).is_empty());
    }

    #[test]
    fn format_for_prompt_lists_variants_and_notes() {
        let analysis = Analysis {
            summary: "s".to_owned(),
            terms: vec![AnalysisTerm {
                term: "BaoCut".to_owned(),
                note: Some("产品名".to_owned()),
                observed_variants: vec!["宝卡特".to_owned()],
            }],
            named_entities: vec![],
            fingerprint: String::new(),
            reference_fingerprint: None,
        };
        let text = format_for_prompt(&analysis);
        assert!(text.contains("- BaoCut [observed ASR: 宝卡特 → BaoCut] (产品名)"));
        assert_eq!(format_for_prompt(&Analysis::default()), "(none)");
    }

    #[test]
    fn brief_prompts_require_mandatory_cjk_latin_spacing() {
        let zh = simplified_chinese_prompt_block("zh-Hans").unwrap();
        assert!(zh.contains("mandatory, not a preference"));
        assert!(zh.contains("35% KV 缓存"));
        assert!(zh.contains("--speculative-model"));
        assert!(zh.contains("never insert a space inside an identifier"));

        assert!(CONTEXT_TARGET_PROMPT.contains("spacing rule as mandatory"));
        assert!(CONTEXT_TARGET_PROMPT.contains("35% KV 缓存"));
        assert!(CONTEXT_TARGET_PROMPT.contains("--speculative-model"));
        // 韩文不在这条规则里：助词贴着前面的词写。
        assert!(CONTEXT_TARGET_PROMPT.contains("Han characters or kana"));
        assert!(CONTEXT_TARGET_PROMPT.contains("does not apply to a target written in Hangul"));
    }

    /// 精修（align-only）轮拿不到 analysis / instructions / tone：按生成输入
    /// 判定必然失配，每轮都会重跑 brief 并冲掉用户锁定的术语。放宽判定只看
    /// 词真相与目标语。
    #[test]
    fn align_only_brief_reuse_ignores_generation_inputs() {
        let doc = doc();
        let brief = DocumentBrief {
            target_lang: "zh".to_owned(),
            tone: Some(TranslationTone::Formal),
            fingerprint: fingerprint(&doc.words),
            analysis_fingerprint: Some("analysis-from-the-translate-round".to_owned()),
            instructions_fingerprint: Some(fingerprint_strings(["Keep BaoCut"])),
            ..Default::default()
        };
        // 生成输入判定失配（精修轮传的正是这三个 None）。
        assert!(!brief.matches_inputs(&doc, None, None));
        // 文档判定命中。
        assert!(brief.matches_document(&doc, "zh"));
        // 词真相变了就不再复用——译文真相本身已经过期。
        let mut changed_words = doc.clone();
        changed_words.words[0].text = "They".to_owned();
        assert!(!brief.matches_document(&changed_words, "zh"));
        // 目标语不同不复用。
        assert!(!brief.matches_document(&doc, "ja"));
    }

    #[test]
    fn translation_brief_cache_invalidates_each_input_but_not_user_edits() {
        let doc = doc();
        let analysis = Analysis {
            fingerprint: fingerprint(&doc.words),
            ..Default::default()
        };
        let mut brief = DocumentBrief {
            fingerprint: fingerprint(&doc.words),
            analysis_fingerprint: Some(analysis.fingerprint.clone()),
            instructions_fingerprint: Some(fingerprint_strings(["Keep BaoCut"])),
            summary: "user-edited summary".to_owned(),
            style_guide: "user-edited style".to_owned(),
            glossary: vec![GlossaryEntry {
                source: "BaoCut".to_owned(),
                target: "宝剪辑".to_owned(),
                locked: true,
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(brief.matches_inputs(&doc, Some(&analysis), Some("Keep BaoCut")));

        // Editable body fields are deliberately outside the cache key.
        brief.glossary[0].target = "宝剪".to_owned();
        brief.summary = "another user summary".to_owned();
        assert!(brief.matches_inputs(&doc, Some(&analysis), Some("Keep BaoCut")));

        let mut changed_words = doc.clone();
        changed_words.words[0].text = "They".to_owned();
        assert!(!brief.matches_inputs(&changed_words, Some(&analysis), Some("Keep BaoCut")));

        let mut changed_analysis = analysis.clone();
        changed_analysis.fingerprint = "different-analysis".to_owned();
        assert!(!brief.matches_inputs(&doc, Some(&changed_analysis), Some("Keep BaoCut")));
        assert!(!brief.matches_inputs(&doc, Some(&analysis), Some("Translate formally")));
    }

    #[test]
    fn simplified_chinese_gate_is_script_aware() {
        assert!(simplified_chinese_prompt_block("zh-Hans").is_some());
        assert!(simplified_chinese_prompt_block("zh-CN").is_some());
        assert!(simplified_chinese_prompt_block("zh").is_some());
        assert!(simplified_chinese_prompt_block("zh-Hant").is_none());
        assert!(simplified_chinese_prompt_block("zh-Hant-TW").is_none());
    }

    #[test]
    fn glossary_prompt_limit_prefers_source_hits_stably() {
        let brief = DocumentBrief {
            glossary: vec![
                GlossaryEntry {
                    source: "rare".to_owned(),
                    target: "罕见".to_owned(),
                    ..Default::default()
                },
                GlossaryEntry {
                    source: "Air".to_owned(),
                    target: "空气".to_owned(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let selected = brief.glossary_for_prompt("Air Air Airport", None, 1);
        assert_eq!(selected[0].source, "Air");
    }

    #[test]
    fn glossary_prompt_carries_only_entries_the_source_actually_hits() {
        let entry = |source: &str, target: &str| GlossaryEntry {
            source: source.to_owned(),
            target: target.to_owned(),
            ..Default::default()
        };
        let brief = DocumentBrief {
            glossary: vec![
                entry("commit", "突破确认"),
                entry("Wyckoff", "威科夫"),
                entry("spring", "弹簧"),
                entry("量化", "quantization"),
            ],
            ..Default::default()
        };
        let analysis = Analysis {
            terms: vec![AnalysisTerm {
                term: "Wyckoff".to_owned(),
                note: None,
                observed_variants: vec!["维科夫".to_owned()],
            }],
            ..Default::default()
        };
        // `commitment` 不是 `commit`；`spring` 没出现；`Wyckoff` 只以误识形式出现。
        let source = "维科夫讲过 commitment 和量化，量化之后更稳。";
        let picked = |analysis| {
            brief
                .glossary_for_prompt(source, analysis, 80)
                .into_iter()
                .map(|entry| entry.source.as_str())
                .collect::<Vec<_>>()
        };
        assert_eq!(picked(None), ["量化"]);
        assert_eq!(picked(Some(&analysis)), ["量化", "Wyckoff"]);
    }

    #[test]
    fn alignment_protection_ignores_terms_wider_than_fit() {
        let brief = DocumentBrief {
            glossary: vec![
                GlossaryEntry {
                    target: "宝剪辑".to_owned(),
                    ..Default::default()
                },
                GlossaryEntry {
                    target: "这是一个不可能完整放进同一行的超长锁定译名".to_owned(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        assert_eq!(brief.protected_targets_for_fit("zh-Hans", 8), ["宝剪辑"]);
    }
}
