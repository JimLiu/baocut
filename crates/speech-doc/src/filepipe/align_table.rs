//! align 载体（`align-table/1`）的 HTML 表格编解码器（§8）。
//!
//! 四拍里的第一拍与第三拍：把「需要语义切分的超长句」渲染成一张表，
//! 再把模型回来的表解析成「按 `data-sid` 分组的 (源文段, 译文片) 文本对」。
//!
//! 边界（M0 只做结构层，硬性划界）：
//!
//! - **不做 atom-LCS 源文词区间映射，不产出 `from`/`to`**。§8.4 第 1 步的
//!   顺序游标 + 词边界吸附是 M3 引擎的工作；在这里重复实现会造成双镜像。
//! - **绝对时间戳不进载荷**（§8.2）。由停留秒数折算出的「建议片数」由调用方
//!   算好后以 [`AlignSentenceInput::suggested_pieces`] 传入，秒数不进 filepipe。
//! - **标签名不进协议**。定位一律走 `data-sid` / `class` / `scope` / `rowspan`
//!   属性；`<tbody>`/`<tr>`/`<td>` 只是当下的形态。
//! - **不做非回退检查**（§8.4 第 3 步）：它要「输入最坏行」与 `words[]` 时间
//!   真相，属引擎层。
//!
//! M3 起本模块是 file-v1 align 的**唯一字符串级校验**：引擎 provider 路径与
//! agent 提交期 lint 都调 [`parse_align_table`]，后者再持有 §8.3 的 reordered
//! 改写幅度护栏（算术共用 [`crate::split::reordered_rewrite_exceeds`]）。
//! 需要 `words[]` 真相的判据（区间映射、配对密度、双语锚、非回退）仍留引擎。
//!
//! 本模块零 I/O、零时钟、零随机；全部是纯函数。

use std::collections::{BTreeMap, BTreeSet};

use crate::atomize::normalize_chars;
use crate::seam::{SeamLintClass, cjk_midword_boundary, is_objective_blocking, lint_pieces};
use crate::split::{
    TransParams, legal_split_for_lang, piece_display_units, primary_subtag,
    reordered_rewrite_exceeds, target_cps_chars,
};

use super::common::{
    ALIGN_TABLE_FORMAT, Diagnostics, Problem, ProblemCode, Warning, WarningCode, guard_output_size,
    normalize_llm_output, sanitize_inline_text,
};
use super::html::{Element, Node, escape_attr, escape_text, parse_html, parse_html_in_table};

/// 表里的一条只读上下文行（§8.2「前后各一句」）。
///
/// 渲染成 `<tbody class="ctx">` 且**不带 `data-sid`**：它不是可编辑单元，
/// 只是语境。模型改动其内容即报 [`ProblemCode::SourceDrift`]。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AlignContextRow {
    /// 只读源文（可见词序拼接）。
    pub source: String,
    /// 只读译文。
    pub translation: String,
}

impl AlignContextRow {
    /// 构造一条上下文行。
    pub fn new(source: impl Into<String>, translation: impl Into<String>) -> Self {
        Self {
            source: source.into(),
            translation: translation.into(),
        }
    }
}

/// 一句在表里的渲染输入。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlignSentenceInput {
    /// 句 id（`data-sid`，逐字节精确匹配，不做大小写折叠）。
    pub id: String,
    /// 整句源文（可见词序拼接）。不预切、不暴露 word id、不暴露源 Cue 边界。
    pub source: String,
    /// 句级译文真相 `trans[lang][sid]`。行片拼接必须与之等价（§2 不变式）。
    pub translation: String,
    /// 展示行数上限（`data-max-lines`），只是给模型的约束提示。
    pub max_lines: usize,
    /// 建议片数区间 `(下限, 上限)`：由调用方按停留时长折算，**秒数不进载荷**。
    pub suggested_pieces: (usize, usize),
    /// 上一轮模型标记过的「源侧确无切点」状态，回带以便定向轮复核；
    /// 首轮恒为 `false`，为 `false` 时不渲染该属性。
    pub unsplittable: bool,
    /// translate 融合草稿已通过目标侧验收时的冻结目标片。非空时 worker 只能
    /// 重选源边界；提交期可从载体完整复原同一约束。
    pub frozen_target: Vec<String>,
    /// 禁止 `data-reordered="true"`：这一轮只是重选源文切点，改写译文没有意义。
    ///
    /// 与 [`Self::frozen_target`] 的区别是它**不**规定目标片长什么样，只否掉
    /// 「改写译文」这条出路——paired 补行轮要的正是重新选边界，冻结目标片会把
    /// 这轮唯一该做的事一并禁掉。
    ///
    /// 需要它是因为 `data-reordered="true"` 是校验认账的改写通道：一旦标上，
    /// 「行片拼接必须等于句级译文」这条就被换成一个宽得多的幅度阈值，答案照收，
    /// 而 paired 轮的验收又只认原始 `trans` 度量，于是整轮调用注定作废。实测
    /// 38 个候选全数被拒、0 句被修，就是这么烧掉的。
    pub no_rewrite: bool,
}

impl AlignSentenceInput {
    /// 构造一句渲染输入（`max_lines` 默认 2，建议片数默认 2–3，非不可拆）。
    pub fn new(
        id: impl Into<String>,
        source: impl Into<String>,
        translation: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            source: source.into(),
            translation: translation.into(),
            max_lines: 2,
            suggested_pieces: (2, 3),
            unsplittable: false,
            frozen_target: Vec::new(),
            no_rewrite: false,
        }
    }
}

/// 一整张 align 表的渲染输入，同时是解析时的对账基准。
///
/// 解析必须同时拿到它（不能只吃字符串）：期望 id 集合、只读上下文行、
/// 句级译文与源文，都要用它来对账。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlignTableInput {
    /// 目标语言标签（`data-lang`）。
    pub lang: String,
    /// 目标语三阈值（`data-fit` / `data-hard` 由此而来）。
    pub params: TransParams,
    /// 源语言标签（`data-source-lang`）。只喂「并列动作顿号缝」豁免的源行
    /// 宽度口径（`source_fit` 按源语取值）；空串按拉丁源语预算计。
    pub source_lang: String,
    /// 表前的只读上下文行。
    pub context_before: Vec<AlignContextRow>,
    /// 本表要处理的句子（装箱由调用方按句数与体积双约束完成）。
    pub sentences: Vec<AlignSentenceInput>,
    /// 表后的只读上下文行。
    pub context_after: Vec<AlignContextRow>,
}

impl AlignTableInput {
    /// 构造一张只含句子、无上下文的表输入（参数取目标语规范缺省）。
    pub fn new(lang: impl Into<String>, sentences: Vec<AlignSentenceInput>) -> Self {
        let lang = lang.into();
        let params = TransParams::for_lang(&lang);
        Self {
            lang,
            params,
            source_lang: String::new(),
            context_before: Vec::new(),
            sentences,
            context_after: Vec::new(),
        }
    }
}

/// 一句解析出来的行片：一个译文片 + 与之 1:1 的连续源文段。
///
/// M0 只有文本；源词区间（`from`/`to`）由 M3 引擎用 atom-LCS 映射得出。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AlignParsedRow {
    /// 该片对应的源文段（归一化后的可见文本）。
    pub source: String,
    /// 译文片（归一化后的可见文本）。
    pub target: String,
}

/// 一句解析出来的分组。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AlignParsedGroup {
    /// 句 id（`data-sid`）。
    pub id: String,
    /// 按出现顺序的行片。
    pub rows: Vec<AlignParsedRow>,
    /// `data-reordered="true"`：模型改写了译文以消除语序交叉。
    /// 为真时本模块**不做**拼接一致性检查（改写幅度护栏属引擎层）。
    pub reordered: bool,
    /// `data-crossing="true"`：残余语序交叉。与 [`Self::reordered`] 互斥。
    pub crossing: bool,
    /// `data-unsplittable="true"`：源侧确无切点，归 `translation-unsplittable` 通道。
    pub unsplittable: bool,
}

/// 一次 align 表解析的结果。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AlignParsed {
    /// 按输出中出现顺序排列的分组（只含协议内 id）。
    pub groups: Vec<AlignParsedGroup>,
    /// 协议问题与非协议诊断。
    pub diagnostics: Diagnostics,
}

impl AlignParsed {
    /// 按 id 取分组。
    pub fn group(&self, id: &str) -> Option<&AlignParsedGroup> {
        self.groups.iter().find(|group| group.id == id)
    }
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

/// Reject contradictory structured input before paying for a model response.
/// This cannot decide whether arbitrary free-text instructions are satisfiable.
pub fn validate_input_constraints(input: &AlignTableInput) -> Result<(), String> {
    for sentence in &input.sentences {
        let (min, max) = sentence.suggested_pieces;
        if min == 0 || min > max {
            return Err(format!(
                "{}: conflicting row budget {min}..{max}",
                sentence.id
            ));
        }
        if !sentence.frozen_target.is_empty() {
            let pieces = &sentence.frozen_target;
            if pieces.len() < min
                || pieces.len() > max
                || normalize_chars(&pieces.concat()) != normalize_chars(&sentence.translation)
                || pieces.iter().any(|p| {
                    p.trim().is_empty() || piece_display_units(p, &input.lang) > input.params.hard
                })
            {
                return Err(format!(
                    "{}: frozen target conflicts with the translation or row budget; replan the target before dispatch",
                    sentence.id
                ));
            }
        }
    }
    Ok(())
}

/// 渲染一张 align 表（§8.2）。输出的属性顺序、缩进、行序固定；文本和属性
/// 分别经 escape_text / escape_attr 转义。不内联预览 style，避免解析时丢弃。
pub fn render_align_table(input: &AlignTableInput) -> String {
    let mut output = String::new();
    // `data-soft` 是相对 §8.2 属性清单的**有意增补**：提交期 lint 只拿得到
    // 落盘的载荷 HTML，[`parse_align_table_input`] 必须能完整还原 TransParams
    // 才能复算同一套接缝判据（soft 进 lint_pieces）。缺它就只能猜，猜错等于
    // 两份不同的校验——正是设计 §2 要消灭的东西。
    // `data-source-lang` 同理：「并列动作顿号缝」豁免要按源语预算量源行宽度，
    // 提交期 lint 只能从载荷里拿到源语。
    let source_lang = if input.source_lang.trim().is_empty() {
        String::new()
    } else {
        format!(
            " data-source-lang=\"{}\"",
            escape_attr(&sanitize_inline_text(&input.source_lang))
        )
    };
    output.push_str(&format!(
        "<table data-lang=\"{}\"{} data-fit=\"{}\" data-soft=\"{}\" data-hard=\"{}\" data-bcut-format=\"{}\">\n",
        escape_attr(&sanitize_inline_text(&input.lang)),
        source_lang,
        input.params.fit,
        input.params.soft,
        input.params.hard,
        escape_attr(ALIGN_TABLE_FORMAT),
    ));
    for row in &input.context_before {
        push_context_group(&mut output, row);
    }
    for sentence in &input.sentences {
        push_sentence_group(&mut output, sentence, &input.lang, &input.params);
    }
    for row in &input.context_after {
        push_context_group(&mut output, row);
    }
    output.push_str("</table>\n");
    output
}

/// 渲染一条只读上下文分组。
fn push_context_group(output: &mut String, row: &AlignContextRow) {
    output.push_str("  <tbody class=\"ctx\">\n");
    output.push_str(&format!(
        "    <tr><th scope=\"rowgroup\"></th><td class=\"src\">{}</td><td class=\"tgt\">{}</td></tr>\n",
        cell_text(&row.source),
        cell_text(&row.translation),
    ));
    output.push_str("  </tbody>\n");
}

/// 渲染一句可编辑分组。
fn push_sentence_group(
    output: &mut String,
    sentence: &AlignSentenceInput,
    lang: &str,
    params: &TransParams,
) {
    let unsplittable = if sentence.unsplittable {
        " data-unsplittable=\"true\""
    } else {
        ""
    };
    let frozen_target = if sentence.frozen_target.is_empty() {
        String::new()
    } else {
        format!(
            " data-target-frozen=\"{}\"",
            escape_attr(
                &serde_json::to_string(&sentence.frozen_target).unwrap_or_else(|_| "[]".to_owned())
            )
        )
    };
    let no_rewrite = if sentence.no_rewrite {
        " data-no-rewrite=\"true\""
    } else {
        ""
    };
    output.push_str(&format!(
        "  <tbody data-sid=\"{}\" data-max-lines=\"{}\" data-budget=\"{}\"{}{}{}>\n",
        escape_attr(&sanitize_inline_text(&sentence.id)),
        sentence.max_lines.max(1),
        escape_attr(&budget_text(params, lang, sentence.suggested_pieces)),
        unsplittable,
        frozen_target,
        no_rewrite,
    ));
    output.push_str(&format!(
        "    <tr><th rowspan=\"1\" scope=\"rowgroup\">{}</th><td class=\"src\">{}</td><td class=\"tgt\">{}</td></tr>\n",
        cell_text(&sentence.id),
        cell_text(&sentence.source),
        cell_text(&sentence.translation),
    ));
    output.push_str("  </tbody>\n");
}

/// 单元格文本：先清洗成单行，再做 HTML 转义。
fn cell_text(text: &str) -> String {
    escape_text(&sanitize_inline_text(text))
}

/// `data-budget` 文案：只带相对预算（每行阈值 + 建议片数），不带秒数。
fn budget_text(params: &TransParams, lang: &str, suggested: (usize, usize)) -> String {
    let unit = if matches!(primary_subtag(lang).as_str(), "zh" | "ja" | "ko") {
        "字"
    } else {
        "字符"
    };
    // Preserve the actual constraint for shared submit lint. The producer
    // preflights it; silently repairing it here would hide an input conflict.
    let (low, high) = suggested;
    let pieces = if low == high {
        format!("建议{low}片")
    } else {
        format!("建议{low}–{high}片")
    };
    format!("每行≤{}{}，{}", params.fit, unit, pieces)
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/// 解析模型回来的 align 表（§8.3、§8.4 第 1 步之前的结构层）。
///
/// 流程：归一化（§10.2 零成本恢复）→ 体积护栏（§16）→ 宽容解析 →
/// 分组对账。
///
/// - `table` 是对账基准（期望 id 集合、只读上下文、句级源文与译文），
///   不是可选参数：只吃字符串无法查 id 集合与拼接不变式。
/// - `input` 是**当初实际发给模型的那份渲染文本**（宿主手里的
///   `DocumentRequest.input.content`），仅用作 [`guard_output_size`] 的体积
///   基准；传 `None` 即跳过该护栏。这里不内部调用 [`render_align_table`]
///   反推长度——那会把 parse 与 render 耦死，也白付一次分配。
///
/// 关键判据：
///
/// - **裸 `<tbody>` 恢复**：模型只回 `<tbody>`/`<tr>` 而不带 `<table>` 外壳时，
///   html5ever 的表格作用域会**静默丢掉所有行**。因此当文档模式解析出 0 个
///   分组、而原文里含 `data-sid` 字样时，用 `<table>` 片段上下文重解析。
///   这一步必须发生在截断判定之前，否则会误报「全句缺失」。
/// - **截断 vs 散点缺失**：宽容解析器会自动闭合一切，不能靠它判截断。判据是
///   「期望 id 的**连续后缀**整体缺失」→ [`ProblemCode::DocumentTruncated`]；
///   散点缺失 → [`ProblemCode::MissingId`]。误判成漏译会白烧一整轮定向重试（§9.3）。
pub fn parse_align_table(
    table: &AlignTableInput,
    input: Option<&str>,
    output: &str,
) -> AlignParsed {
    let mut diagnostics = Diagnostics::new();
    if let Err(detail) = validate_input_constraints(table) {
        diagnostics.push_problem(Problem::document(ProblemCode::InputConflict, detail));
        return AlignParsed {
            groups: Vec::new(),
            diagnostics,
        };
    }

    let normalized = normalize_llm_output(output);
    for warning in normalized.warnings() {
        diagnostics.push_warning(warning);
    }

    // 体积护栏：超限直接拒绝，不再解析（防失控生成把后续判定拖成噪声）。
    if let Some(problem) = input.and_then(|input| guard_output_size(input, &normalized.text)) {
        diagnostics.push_problem(problem);
        return AlignParsed {
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
    let mut collected = collect_groups(&tree.roots);
    if collected.sentences.is_empty() && normalized.text.contains("data-sid") {
        tree = parse_html_in_table(&normalized.text);
        collected = collect_groups(&tree.roots);
    }
    for warning in tree.warnings() {
        diagnostics.push_warning(warning);
    }

    let expected: BTreeMap<&str, &AlignSentenceInput> = table
        .sentences
        .iter()
        .map(|sentence| (sentence.id.as_str(), sentence))
        .collect();

    let mut groups: Vec<AlignParsedGroup> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut duplicated: BTreeSet<String> = BTreeSet::new();

    for element in collected.sentences {
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

        let group = parse_group(element, sentence, table, &mut diagnostics);
        groups.push(group);
    }

    report_missing(table, &seen, &mut diagnostics);
    check_context(table, &collected.contexts, &mut diagnostics);

    AlignParsed {
        groups,
        diagnostics,
    }
}

/// 从**当初发出的载荷 HTML** 反解出 [`AlignTableInput`]（§10.3 提交期 lint）。
///
/// `task submit` 进程没有 `TranscriptDoc`，只有落盘的 `payloads/<callId>.html`。
/// 反解让提交期 lint 能调用与引擎完全相同的 [`parse_align_table`]，从而兑现
/// 设计 §2 的「校验只有一份」——而不是照着判据再抄一遍。
///
/// 反解**必须**是 [`render_align_table`] 的严格逆：`render → parse_input →
/// render` 逐字节相等由单测钉死。任何渲染侧新增属性都要在这里同步，否则
/// lint 会静默退化成「读不出载荷 ⇒ 不拦」。
///
/// 返回 `None` 表示这不是一张 align 表（旧任务目录、别的 kind 的载荷）：
/// 调用方按 M1/M2 惯例降级为「不挡」，不得凭空报错。
pub fn parse_align_table_input(payload: &str) -> Option<AlignTableInput> {
    let tree = parse_html(payload);
    let table = tree
        .elements()
        .into_iter()
        .find(|element| element.attr("data-bcut-format") == Some(ALIGN_TABLE_FORMAT))?;

    let lang = table
        .attr("data-lang")
        .unwrap_or_default()
        .trim()
        .to_owned();
    let source_lang = table
        .attr("data-source-lang")
        .unwrap_or_default()
        .trim()
        .to_owned();
    let defaults = TransParams::for_lang(&lang);
    let params = TransParams {
        fit: attr_usize(table, "data-fit").unwrap_or(defaults.fit),
        soft: attr_usize(table, "data-soft").unwrap_or(defaults.soft),
        hard: attr_usize(table, "data-hard").unwrap_or(defaults.hard),
    };

    let mut ordered = Vec::new();
    walk_groups_ordered(&tree.roots, &mut ordered);
    let mut context_before = Vec::new();
    let mut context_after = Vec::new();
    let mut sentences = Vec::new();
    let mut diagnostics = Diagnostics::new();
    for element in ordered {
        if let Some(id) = element
            .attr("data-sid")
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            let rows = extract_rows(element, Some(id), &mut diagnostics);
            let Some(row) = rows.first() else {
                continue;
            };
            sentences.push(AlignSentenceInput {
                id: id.to_owned(),
                source: row.source.clone(),
                translation: row.target.clone(),
                max_lines: attr_usize(element, "data-max-lines").unwrap_or(2).max(1),
                suggested_pieces: parse_budget_pieces(
                    element.attr("data-budget").unwrap_or_default(),
                )
                .unwrap_or((2, 3)),
                unsplittable: element.attr("data-unsplittable").map(str::trim) == Some("true"),
                frozen_target: element
                    .attr("data-target-frozen")
                    .and_then(|raw| serde_json::from_str(raw).ok())
                    .unwrap_or_default(),
                no_rewrite: element.attr("data-no-rewrite").map(str::trim) == Some("true"),
            });
            continue;
        }
        let rows = extract_rows(element, None, &mut diagnostics);
        if let Some(row) = rows.first() {
            let context = AlignContextRow::new(row.source.clone(), row.target.clone());
            // 前/后归属按文档序：第一条可编辑分组之前的是前文，其余是后文。
            if sentences.is_empty() {
                context_before.push(context);
            } else {
                context_after.push(context);
            }
        }
    }

    Some(AlignTableInput {
        lang,
        params,
        source_lang,
        context_before,
        sentences,
        context_after,
    })
}

/// 按文档序收集分组（可编辑与只读混排）。[`collect_groups`] 分两桶装、
/// 丢失交错次序，反解载荷时需要次序来还原前文/后文归属。
fn walk_groups_ordered<'a>(nodes: &'a [Node], out: &mut Vec<&'a Element>) {
    for node in nodes {
        let Node::Element(element) = node else {
            continue;
        };
        if element.attrs.contains_key("data-sid") || element.has_class("ctx") {
            out.push(element);
            continue;
        }
        walk_groups_ordered(&element.children, out);
    }
}

fn attr_usize(element: &Element, name: &str) -> Option<usize> {
    element.attr(name)?.trim().parse().ok()
}

/// [`budget_text`] 的逆：从 `…建议2–3片` / `…建议3片` 里取回建议片数区间。
fn parse_budget_pieces(budget: &str) -> Option<(usize, usize)> {
    let tail = budget.rsplit_once("建议")?.1;
    let body = tail.strip_suffix('片')?;
    match body.split_once('–') {
        Some((low, high)) => Some((low.trim().parse().ok()?, high.trim().parse().ok()?)),
        None => {
            let value: usize = body.trim().parse().ok()?;
            Some((value, value))
        }
    }
}

/// 分组收集结果：可编辑分组与只读上下文分组。
struct CollectedGroups<'a> {
    sentences: Vec<&'a Element>,
    contexts: Vec<&'a Element>,
}

/// 递归收集分组：命中分组后**不再下钻**。
///
/// 不下钻是为了容忍模型把 `data-sid` 同时写在分组和每一行上——否则同一句
/// 会被数成多个分组，凭空报 `duplicate-id`。
fn collect_groups(nodes: &[Node]) -> CollectedGroups<'_> {
    let mut collected = CollectedGroups {
        sentences: Vec::new(),
        contexts: Vec::new(),
    };
    walk_groups(nodes, &mut collected);
    collected
}

fn walk_groups<'a>(nodes: &'a [Node], collected: &mut CollectedGroups<'a>) {
    for node in nodes {
        let Node::Element(element) = node else {
            continue;
        };
        if element.attrs.contains_key("data-sid") {
            collected.sentences.push(element);
            continue;
        }
        if element.has_class("ctx") {
            collected.contexts.push(element);
            continue;
        }
        walk_groups(&element.children, collected);
    }
}

/// 解析一句分组并跑句级验收。
fn parse_group(
    element: &Element,
    sentence: &AlignSentenceInput,
    input: &AlignTableInput,
    diagnostics: &mut Diagnostics,
) -> AlignParsedGroup {
    let sid = sentence.id.as_str();
    let rows = extract_rows(element, Some(sid), diagnostics);

    let reordered = bool_attr(element, "data-reordered", sid, diagnostics);
    let mut crossing = bool_attr(element, "data-crossing", sid, diagnostics);
    let unsplittable = bool_attr(element, "data-unsplittable", sid, diagnostics);
    if reordered && crossing {
        // §8：两者互斥。保留 reordered（改写确已发生），丢弃残余交叉自述。
        crossing = false;
        diagnostics.push_warning(Warning::sentence(
            WarningCode::ContentIgnored,
            sid,
            "data-reordered 与 data-crossing 互斥，已忽略 data-crossing",
        ));
    }

    check_rowspan(element, sid, rows.len(), diagnostics);

    if rows.is_empty() {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::EmptyTranslation,
            sid,
            "分组内没有可用的行片",
        ));
    } else {
        check_rows(&rows, sentence, input, reordered, diagnostics);
    }

    AlignParsedGroup {
        id: sentence.id.clone(),
        rows,
        reordered,
        crossing,
        unsplittable,
    }
}

/// 句级验收：空译、源文漂移、拼接不变式、hard 上限、接缝 lint。
///
/// 不因 `data-unsplittable` 抑制任何检查：抑制在解析器里是不可见的，会抹掉
/// 「不可拆且合规」与「不可拆且超 hard（blocker 档）」的区别（§8.1）。
fn check_rows(
    rows: &[AlignParsedRow],
    sentence: &AlignSentenceInput,
    input: &AlignTableInput,
    reordered: bool,
    diagnostics: &mut Diagnostics,
) {
    let sid = sentence.id.as_str();
    let lang = input.lang.as_str();
    let params = &input.params;

    let empty: Vec<String> = rows
        .iter()
        .enumerate()
        .filter(|(_, row)| row.target.trim().is_empty())
        .map(|(index, _)| (index + 1).to_string())
        .collect();
    if !empty.is_empty() {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::EmptyTranslation,
            sid,
            format!("第 {} 片译文为空", empty.join("、")),
        ));
    }

    // 源文列是只读的：模型只许切，不许改。
    let source_concat: String = rows.iter().map(|row| row.source.as_str()).collect();
    if normalize_chars(&source_concat) != normalize_chars(&sentence.source) {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::SourceDrift,
            sid,
            "源文段拼接与整句源文不一致：源文列只能切分，不能改写",
        ));
    }

    // 拼接不变式（§2）。reordered 分组允许改写译文，拼接自然不等——改判
    // 改写幅度护栏（§8.3 ±25%）。两者都是纯字符串级判据，因此都在这里：
    // 引擎 provider 路径与 agent 提交期 lint 由此共用同一份实现（§2）。
    let target_concat: String = rows.iter().map(|row| row.target.as_str()).collect();
    if !sentence.frozen_target.is_empty() {
        let actual = rows
            .iter()
            .map(|row| row.target.clone())
            .collect::<Vec<_>>();
        if reordered {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::AlignContentDrift,
                sid,
                "data-target-frozen 禁止 data-reordered=\"true\"：只可重选源文边界",
            ));
        } else if actual != sentence.frozen_target {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::AlignContentDrift,
                sid,
                "目标片必须逐片等于 data-target-frozen：只可重选源文边界",
            ));
        }
    }
    if sentence.no_rewrite && reordered {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::AlignContentDrift,
            sid,
            "data-no-rewrite 禁止 data-reordered=\"true\"：本轮只重选源文切点，请原样保留句级译文（词序交叉标 data-crossing=\"true\"）",
        ));
    }
    if reordered {
        let old_units = target_cps_chars(&sentence.translation, lang);
        let new_units = target_cps_chars(&target_concat, lang);
        if reordered_rewrite_exceeds(old_units, new_units) {
            diagnostics.push_problem(Problem::sentence(
                ProblemCode::AlignContentDrift,
                sid,
                format!(
                    "重排译文改写幅度过大（{old_units} → {new_units} 阅读单位）：只调小句顺序与必要的连接词，或改标 data-crossing=\"true\""
                ),
            ));
        }
    } else if normalize_chars(&target_concat) != normalize_chars(&sentence.translation) {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::AlignContentDrift,
            sid,
            "行片拼接与句级译文不一致；若确需改写请标 data-reordered=\"true\"",
        ));
    }

    let pieces: Vec<&str> = rows.iter().map(|row| row.target.as_str()).collect();
    check_over_hard(&pieces, &target_concat, sid, lang, params, diagnostics);

    // 契约允许的「并列动作顿号缝」（源行过密 + 两片都是完整动作）与 json-v0
    // 验收、`bcut check` 用同一份判据豁免；不豁免就是契约放行、lint 拒收。
    let sources: Vec<&str> = rows.iter().map(|row| row.source.as_str()).collect();
    let allowed_list_seams = crate::engines::align::allowed_list_seam_indices_for_source_rows(
        &pieces,
        &sources,
        &input.source_lang,
    );
    let messages: Vec<String> = lint_pieces(&pieces, lang, params)
        .iter()
        .filter(|issue| is_objective_blocking(issue))
        .filter(|issue| {
            !(issue.class == SeamLintClass::ListSeparator
                && allowed_list_seams.contains(&issue.piece_index))
        })
        .map(|issue| issue.message.clone())
        .collect();
    if !messages.is_empty() {
        diagnostics.push_problem(Problem::sentence(
            ProblemCode::AlignIllegalSeam,
            sid,
            messages.join("；"),
        ));
    }
}

/// hard 上限校验，带可操作提示。
///
/// 只报「第 N 片 X 单位超过 hard」的裸消息时，worker 常常原地重复提交（同一
/// 片连吃三次 lint try，最后由 force-through 放行、引擎再机械硬切）——
/// 01a00494 现场 s-g109.20 的 23 单位片明明在「，」处就有合法切点。三档处理：
///
/// 1. 译文存在合法切分（[`legal_split_for_lang`]：每片 ≤ hard、不切客观语病
///    缝）→ 仍报 [`ProblemCode::AlignOverHard`]。切点由标点/空白背书时 detail
///    直接给出切法；只剩 CJK 字界（切分器无词典，不能替 worker 选词边界）时
///    只说明「片内无标点/空白缝，请在词边界处切开」。片内无解、整句有解时
///    提示连同相邻片一起重切；
/// 2. 整句译文也不存在合法切分（巨型 Latin 记号、每条缝都是客观语病）→ 只记
///    [`WarningCode::AlignOverHardUncuttable`]，**不拒收**：worker 除改写译文
///    外没有合法动作，拒收只会烧掉 lint try；引擎在验收侧本就把此码当 advisory
///    并按 `enforce_target_hard_limit` 机械硬切，提交期放行不改变最终结果。
fn check_over_hard(
    pieces: &[&str],
    target_concat: &str,
    sid: &str,
    lang: &str,
    params: &TransParams,
    diagnostics: &mut Diagnostics,
) {
    let over_hard: Vec<(usize, usize)> = pieces
        .iter()
        .enumerate()
        .filter_map(|(index, text)| {
            let width = piece_display_units(text, lang);
            (width > params.hard).then_some((index, width))
        })
        .collect();
    if over_hard.is_empty() {
        return;
    }

    let mut fixable: Vec<String> = Vec::new();
    let mut uncuttable: Vec<String> = Vec::new();
    // 整句合法切分只在片内无解时才算，且整句只算一次。
    let mut sentence_advice: Option<CutAdvice> = None;
    let mut sentence_hint: Option<Vec<String>> = None;
    for (index, width) in over_hard {
        let label = format!(
            "第 {} 片 {} 单位超过 hard 上限 {}",
            index + 1,
            width,
            params.hard
        );
        match over_hard_piece_advice(pieces, index, lang, params) {
            CutAdvice::Backed(parts) => {
                fixable.push(format!("{label}，可切为{}", render_cut_hint(&parts)));
                continue;
            }
            CutAdvice::MidwordOnly => {
                fixable.push(format!("{label}，片内无标点/空白缝，请在词边界处切开"));
                continue;
            }
            CutAdvice::None => {}
        }
        let advice = sentence_advice
            .get_or_insert_with(|| CutAdvice::from(legal_partition(target_concat, lang, params)));
        match advice {
            CutAdvice::Backed(parts) => {
                sentence_hint.get_or_insert_with(|| parts.clone());
                fixable.push(format!("{label}，片内无合法切点，需连同相邻片一起重切"));
            }
            CutAdvice::MidwordOnly => fixable.push(format!(
                "{label}，片内无合法切点，需连同相邻片一起在词边界处重切"
            )),
            CutAdvice::None => uncuttable.push(label),
        }
    }

    if !fixable.is_empty() {
        let mut detail = fixable.join("；");
        if let Some(parts) = sentence_hint.as_ref() {
            detail.push_str(&format!("；整句可重切为{}", render_cut_hint(parts)));
        }
        detail.push_str("；对应源文段在同一位置切开");
        diagnostics.push_problem(Problem::sentence(ProblemCode::AlignOverHard, sid, detail));
    }
    if !uncuttable.is_empty() {
        diagnostics.push_warning(Warning::sentence(
            WarningCode::AlignOverHardUncuttable,
            sid,
            format!(
                "{}，且译文无合法切点：提交期放行，引擎按 hard 机械硬切",
                uncuttable.join("；")
            ),
        ));
    }
}

/// 一段译文的合法切分建议。
enum CutAdvice {
    /// 存在合法切分，且每条缝都由标点/空白背书：可直接当切法提示。
    Backed(Vec<String>),
    /// 存在合法切分，但至少一条缝落在 CJK 字界上（[`cjk_midword_boundary`]）：
    /// 切分器没有词典，不能替 worker 选词边界，只说明需要在词边界处切。
    MidwordOnly,
    /// 不存在合法切分。
    None,
}

impl From<Option<Vec<String>>> for CutAdvice {
    fn from(parts: Option<Vec<String>>) -> Self {
        match parts {
            Option::None => Self::None,
            Some(parts) => {
                let midword = parts
                    .windows(2)
                    .any(|pair| cjk_midword_boundary(pair[0].trim_end(), pair[1].trim_start()));
                if midword {
                    Self::MidwordOnly
                } else {
                    Self::Backed(parts)
                }
            }
        }
    }
}

/// 第 `index` 片的片内合法切分建议：严格切分器给出的分片替换回整组后，客观
/// 阻塞接缝数不得增加（末片可悬垂等规则依赖片在组内的位置，必须放回原位
/// 再 lint）。
fn over_hard_piece_advice(
    pieces: &[&str],
    index: usize,
    lang: &str,
    params: &TransParams,
) -> CutAdvice {
    let text = pieces[index];
    let neighbours: Vec<&str> = pieces
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(i, piece)| (i != index).then_some(piece))
        .collect();
    let baseline = objective_blocking_count(pieces, lang, params);
    CutAdvice::from(legal_partition_with(text, lang, params, |parts| {
        let mut substituted: Vec<&str> = neighbours[..index].to_vec();
        substituted.extend(parts.iter().map(String::as_str));
        substituted.extend_from_slice(&neighbours[index..]);
        objective_blocking_count(&substituted, lang, params) <= baseline
    }))
}

/// 整段文本的独立合法切分：全部 ≤ hard、自身没有客观阻塞接缝。
fn legal_partition(text: &str, lang: &str, params: &TransParams) -> Option<Vec<String>> {
    legal_partition_with(text, lang, params, |parts| {
        let borrowed: Vec<&str> = parts.iter().map(String::as_str).collect();
        objective_blocking_count(&borrowed, lang, params) == 0
    })
}

/// 严格合法切分器（[`legal_split_for_lang`]：只切非客观语病缝、每片 ≤ hard、
/// 不做字符位硬切）给出 ≥2 片且满足 `accept`（调用方放回上下文后的接缝判
/// 据），即为合法切分。
fn legal_partition_with(
    text: &str,
    lang: &str,
    params: &TransParams,
    accept: impl Fn(&[String]) -> bool,
) -> Option<Vec<String>> {
    let width = target_cps_chars(text, lang);
    // 片数上限只为限制 DP 规模：≥ ceil(width / soft) 就足以让每片落到 soft
    // 附近，再多的片数不会改变「是否存在 ≤ hard 合法切分」的结论。
    let max_pieces = width.div_ceil(params.soft.max(1)) + 2;
    let parts = legal_split_for_lang(text, params, max_pieces, lang)?;
    if parts.len() < 2 {
        return None;
    }
    debug_assert!(
        parts
            .iter()
            .all(|part| piece_display_units(part, lang) <= params.hard)
    );
    accept(&parts).then_some(parts)
}

fn objective_blocking_count(pieces: &[&str], lang: &str, params: &TransParams) -> usize {
    lint_pieces(pieces, lang, params)
        .iter()
        .filter(|issue| is_objective_blocking(issue))
        .count()
}

/// 「a」｜「b」｜「c」。
fn render_cut_hint(parts: &[String]) -> String {
    parts
        .iter()
        .map(|part| format!("「{}」", part.trim()))
        .collect::<Vec<_>>()
        .join("｜")
}

/// `rowspan` 冗余校验：不符只报诊断，不是协议问题（§8.3「纯冗余校验」）。
fn check_rowspan(element: &Element, sid: &str, rows: usize, diagnostics: &mut Diagnostics) {
    let Some(raw) = element
        .descendants()
        .into_iter()
        .find_map(|child| child.attr("rowspan"))
    else {
        return;
    };
    match raw.trim().parse::<usize>() {
        Ok(value) if value == rows => {}
        Ok(value) => diagnostics.push_warning(Warning::sentence(
            WarningCode::RowspanMismatch,
            sid,
            format!("rowspan={value} 与实际 {rows} 行不符"),
        )),
        Err(_) => diagnostics.push_warning(Warning::sentence(
            WarningCode::RowspanMismatch,
            sid,
            format!("rowspan=\"{raw}\" 不可解析"),
        )),
    }
}

/// 读取布尔属性；出现无法解释的值时记诊断并按 `false` 处理。
fn bool_attr(element: &Element, name: &str, sid: &str, diagnostics: &mut Diagnostics) -> bool {
    let Some(raw) = element.attr(name) else {
        return false;
    };
    let value = raw.trim();
    if value.eq_ignore_ascii_case("true") || value == "1" {
        return true;
    }
    if value.eq_ignore_ascii_case("false") || value == "0" || value.is_empty() {
        return false;
    }
    diagnostics.push_warning(Warning::sentence(
        WarningCode::ContentIgnored,
        sid,
        format!("{name}=\"{value}\" 不是布尔值，按 false 处理"),
    ));
    false
}

/// 从一个分组里提取 (源文段, 译文片) 对。
///
/// 定位阶梯（标签名全程不参与）：
/// 1. 同一行里同时有 `class="src"` 与 `class="tgt"` ⇒ 直接取；
/// 2. 否则剔除 id 列（带 `rowspan`/`scope`，或文本恰为 sid）后按位置取；
/// 3. 剔除后多于两格时取**最后两格**——id 列恒在最左，冗余列只会长在左边。
fn extract_rows(
    element: &Element,
    sid: Option<&str>,
    diagnostics: &mut Diagnostics,
) -> Vec<AlignParsedRow> {
    let mut rows = Vec::new();
    for row in element.child_elements() {
        let cells = row.child_elements();
        if cells.is_empty() {
            continue;
        }
        if let (Some(source), Some(target)) = (
            cells.iter().find(|cell| cell.has_class("src")),
            cells.iter().find(|cell| cell.has_class("tgt")),
        ) {
            rows.push(AlignParsedRow {
                source: source.text(),
                target: target.text(),
            });
            continue;
        }
        let data: Vec<&&Element> = cells.iter().filter(|cell| !is_id_cell(cell, sid)).collect();
        if data.len() < 2 {
            diagnostics.push_warning(Warning::document(
                WarningCode::ContentIgnored,
                format!("忽略列数不足的行：{}", row.text()),
            ));
            continue;
        }
        if data.len() > 2 {
            diagnostics.push_warning(Warning::document(
                WarningCode::ContentIgnored,
                format!("行内多余的列已忽略：{}", row.text()),
            ));
        }
        rows.push(AlignParsedRow {
            source: data[data.len() - 2].text(),
            target: data[data.len() - 1].text(),
        });
    }
    rows
}

/// 是否为 id 列单元格。
fn is_id_cell(cell: &Element, sid: Option<&str>) -> bool {
    if cell.attrs.contains_key("rowspan") || cell.attrs.contains_key("scope") {
        return true;
    }
    sid.is_some_and(|sid| cell.text().trim() == sid)
}

/// 缺失 id 判定：连续后缀整体缺失 ⇒ 截断；否则逐句 `missing-id`。
fn report_missing(input: &AlignTableInput, seen: &BTreeSet<String>, diagnostics: &mut Diagnostics) {
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
    let suffix_all_missing = input.sentences[first_missing..]
        .iter()
        .all(|sentence| !seen.contains(&sentence.id));
    if suffix_all_missing {
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

/// 只读上下文对账。
///
/// 按内容匹配而非位置：模型只回显其中一条时，位置比对会把「后文」错配到
/// 「前文」上，白报一次 `source-drift`（一整页重试）。出现在输出里但与任何
/// 一条期望上下文都对不上 ⇒ 被改过；整体不回显 ⇒ 只记诊断。
fn check_context(input: &AlignTableInput, contexts: &[&Element], diagnostics: &mut Diagnostics) {
    let expected: Vec<(String, String)> = input
        .context_before
        .iter()
        .chain(input.context_after.iter())
        .map(|row| {
            (
                normalize_chars(&row.source),
                normalize_chars(&row.translation),
            )
        })
        .collect();
    if expected.is_empty() {
        if !contexts.is_empty() {
            diagnostics.push_warning(Warning::document(
                WarningCode::ContentIgnored,
                "输出里出现了协议外的只读上下文分组",
            ));
        }
        return;
    }
    if contexts.is_empty() {
        diagnostics.push_warning(Warning::document(
            WarningCode::ContentIgnored,
            "输出未回显只读上下文行",
        ));
        return;
    }
    // 上下文行的形状诊断没有可操作性（它本就不该被回显/改动），丢进一个
    // 局部诊断桶，不污染句级账本。
    let mut ignored = Diagnostics::new();
    for element in contexts {
        let rows = extract_rows(element, None, &mut ignored);
        if rows.is_empty() {
            diagnostics.push_warning(Warning::document(
                WarningCode::ContentIgnored,
                "忽略无法解析的只读上下文分组",
            ));
            continue;
        }
        let source = normalize_chars(
            &rows
                .iter()
                .map(|row| row.source.as_str())
                .collect::<String>(),
        );
        let target = normalize_chars(
            &rows
                .iter()
                .map(|row| row.target.as_str())
                .collect::<String>(),
        );
        if !expected
            .iter()
            .any(|(want_source, want_target)| *want_source == source && *want_target == target)
        {
            diagnostics.push_problem(Problem::document(
                ProblemCode::SourceDrift,
                "只读上下文行被修改",
            ));
        }
    }
}

/// 归一化后是否仍残留代码块围栏（多 fence / 夹带解释 ⇒ `document-wrapped`）。
fn has_residual_fence(text: &str) -> bool {
    text.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with("```") || trimmed.starts_with("~~~")
    })
}

#[cfg(test)]
mod tests {
    use super::super::html::normalize_html_text;
    use super::*;

    #[test]
    fn contradictory_payload_is_rejected_by_both_preflight_and_answer_lint() {
        let mut input = AlignTableInput {
            lang: "zh".into(),
            params: TransParams::for_lang("zh"),
            source_lang: String::new(),
            context_before: vec![],
            context_after: vec![],
            sentences: vec![AlignSentenceInput::new("s1", "one two", "第一部分第二部分")],
        };
        for (budget, frozen) in [
            ((8, 4), vec![]),
            ((2, 3), vec!["第一部分第二部分".to_owned()]),
            ((2, 3), vec!["第一部分".to_owned(), "不是原译文".to_owned()]),
        ] {
            input.sentences[0].suggested_pieces = budget;
            input.sentences[0].frozen_target = frozen;
            assert!(validate_input_constraints(&input).is_err());
            let payload = render_align_table(&input);
            let restored = parse_align_table_input(&payload).unwrap();
            let result = parse_align_table(&restored, None, &payload);
            assert_eq!(
                result.diagnostics.problems[0].code,
                ProblemCode::InputConflict
            );
        }
    }

    /// 往返不变式的右侧：渲染做 [`sanitize_inline_text`]，解析做
    /// [`normalize_html_text`]（含 CJK 空格折叠）。相等只在这个意义上成立。
    fn expect_cell(text: &str) -> String {
        normalize_html_text(&sanitize_inline_text(text))
    }

    fn sentence(id: &str, source: &str, translation: &str) -> AlignSentenceInput {
        AlignSentenceInput::new(id, source, translation)
    }

    /// 测试侧的「模型回答」渲染器：刻意与生产渲染器分开，免得往返测试
    /// 只是在验证自己。
    struct FakeGroup {
        sid: String,
        rows: Vec<(String, String)>,
        reordered: bool,
        crossing: bool,
        unsplittable: bool,
        rowspan: Option<usize>,
        classed: bool,
    }

    impl FakeGroup {
        fn new(sid: &str, rows: &[(&str, &str)]) -> Self {
            Self {
                sid: sid.to_owned(),
                rows: rows
                    .iter()
                    .map(|(a, b)| ((*a).to_owned(), (*b).to_owned()))
                    .collect(),
                reordered: false,
                crossing: false,
                unsplittable: false,
                rowspan: None,
                classed: false,
            }
        }

        fn html(&self) -> String {
            let mut out = format!("<tbody data-sid=\"{}\"", escape_attr(&self.sid));
            if self.reordered {
                out.push_str(" data-reordered=\"true\"");
            }
            if self.crossing {
                out.push_str(" data-crossing=\"true\"");
            }
            if self.unsplittable {
                out.push_str(" data-unsplittable=\"true\"");
            }
            out.push_str(">\n");
            let rowspan = self.rowspan.unwrap_or(self.rows.len());
            for (index, (source, target)) in self.rows.iter().enumerate() {
                out.push_str("<tr>");
                if index == 0 {
                    out.push_str(&format!(
                        "<th rowspan=\"{}\" scope=\"rowgroup\">{}</th>",
                        rowspan,
                        escape_text(&self.sid)
                    ));
                }
                let (src_attr, tgt_attr) = if self.classed {
                    (" class=\"src\"", " class=\"tgt\"")
                } else {
                    ("", "")
                };
                out.push_str(&format!(
                    "<td{}>{}</td><td{}>{}</td></tr>\n",
                    src_attr,
                    escape_text(source),
                    tgt_attr,
                    escape_text(target)
                ));
            }
            out.push_str("</tbody>\n");
            out
        }
    }

    fn fake_table(groups: &[FakeGroup]) -> String {
        let mut out = String::from("<table data-bcut-format=\"align-table/1\">\n");
        for group in groups {
            out.push_str(&group.html());
        }
        out.push_str("</table>\n");
        out
    }

    fn fake_rows_only(groups: &[FakeGroup]) -> String {
        groups.iter().map(FakeGroup::html).collect()
    }

    // -- 渲染与往返 --------------------------------------------------------

    #[test]
    fn render_carries_protocol_attributes_only() {
        let mut item = sentence("s-g1.0", "hello world", "你好世界");
        item.max_lines = 2;
        item.suggested_pieces = (2, 3);
        let input = AlignTableInput::new("zh", vec![item]);
        let html = render_align_table(&input);
        assert!(html.contains("data-bcut-format=\"align-table/1\""));
        assert!(html.contains("data-lang=\"zh\""));
        assert!(html.contains("data-fit=\"16\""));
        assert!(html.contains("data-hard=\"20\""));
        assert!(html.contains("data-sid=\"s-g1.0\""));
        assert!(html.contains("data-max-lines=\"2\""));
        assert!(html.contains("data-budget=\"每行≤16字，建议2–3片\""));
        assert!(html.contains("rowspan=\"1\""));
        // 绝对时间戳、word id、源 Cue 边界都不进载荷。
        assert!(!html.contains("data-unsplittable"));
        assert!(!html.contains("<style"));
        assert!(!html.contains("秒"));
    }

    #[test]
    fn render_budget_switches_unit_for_latin() {
        let mut item = sentence("s-1", "a", "b");
        item.suggested_pieces = (3, 3);
        let input = AlignTableInput::new("en", vec![item]);
        let html = render_align_table(&input);
        assert!(html.contains("data-fit=\"42\""));
        assert!(html.contains("data-budget=\"每行≤42字符，建议3片\""));
    }

    #[test]
    fn roundtrip_single_sentence_single_piece() {
        let input = AlignTableInput::new(
            "zh",
            vec![sentence("s-g1.0", "hello world", "你好，世界。")],
        );
        let output = render_align_table(&input);
        let parsed = parse_align_table(&input, None, &output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.groups.len(), 1);
        let group = parsed.group("s-g1.0").unwrap();
        assert_eq!(group.rows.len(), 1);
        assert_eq!(group.rows[0].source, "hello world");
        assert_eq!(group.rows[0].target, "你好，世界。");
        assert!(!group.reordered && !group.crossing && !group.unsplittable);
    }

    #[test]
    fn roundtrip_multi_sentence_multi_piece() {
        let input = AlignTableInput::new(
            "zh",
            vec![
                sentence(
                    "s-g1.0",
                    "Ninety days, eight times the growth, and we did it without any paid marketing.",
                    "九十天翻了八倍，没花一分钱做付费营销。",
                ),
                sentence("s-g1.1", "That is the whole story.", "这就是全部经过。"),
            ],
        );
        let output = fake_table(&[
            FakeGroup::new(
                "s-g1.0",
                &[
                    ("Ninety days, eight times the growth,", "九十天翻了八倍，"),
                    (
                        "and we did it without any paid marketing.",
                        "没花一分钱做付费营销。",
                    ),
                ],
            ),
            FakeGroup::new(
                "s-g1.1",
                &[("That is the whole story.", "这就是全部经过。")],
            ),
        ]);
        let parsed = parse_align_table(&input, None, &output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(
            parsed
                .groups
                .iter()
                .map(|g| g.id.as_str())
                .collect::<Vec<_>>(),
            vec!["s-g1.0", "s-g1.1"]
        );
        assert_eq!(parsed.groups[0].rows.len(), 2);
        assert_eq!(parsed.groups[0].rows[1].target, "没花一分钱做付费营销。");
    }

    #[test]
    fn roundtrip_covers_cjk_latin_and_mixed_scripts() {
        let cases = [
            ("s-1", "純粋な日本語の文です", "纯 CJK 的一句"),
            ("s-2", "a plain latin sentence here", "another latin line"),
            ("s-3", "mixed 中文 and English 混排", "混排 mixed 结果"),
        ];
        let input = AlignTableInput::new(
            "zh",
            cases
                .iter()
                .map(|(id, source, translation)| sentence(id, source, translation))
                .collect(),
        );
        let output = render_align_table(&input);
        let parsed = parse_align_table(&input, None, &output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        for (id, source, translation) in cases {
            let group = parsed.group(id).unwrap();
            assert_eq!(group.rows[0].source, expect_cell(source));
            assert_eq!(group.rows[0].target, expect_cell(translation));
        }
        // CJK 之间的空格被折叠，Latin 之间的不被折叠：往返只在归一化意义上成立。
        assert_eq!(expect_cell("纯 CJK 的一句"), "纯 CJK 的一句");
        assert_eq!(expect_cell("你好 世界"), "你好世界");
        assert_eq!(expect_cell("hello  world"), "hello world");
    }

    #[test]
    fn roundtrip_escapes_html_specials() {
        let input = AlignTableInput::new(
            "zh",
            vec![sentence(
                "s-1",
                "a < b && c > d \"quoted\"",
                "a < b 且 c > d 「引用」",
            )],
        );
        let output = render_align_table(&input);
        assert!(output.contains("&lt;") && output.contains("&amp;") && output.contains("&gt;"));
        let parsed = parse_align_table(&input, None, &output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.groups[0].rows[0].source, "a < b && c > d \"quoted\"");
    }

    #[test]
    fn roundtrip_long_sentence_and_empty_context() {
        let source = "word ".repeat(120);
        let translation = "很长的中文句子".repeat(30);
        let input = AlignTableInput::new("zh", vec![sentence("s-1", &source, &translation)]);
        assert!(input.context_before.is_empty() && input.context_after.is_empty());
        let output = render_align_table(&input);
        let parsed = parse_align_table(&input, None, &output);
        assert_eq!(parsed.groups[0].rows[0].source, expect_cell(&source));
        // 整句一片必然超 hard，但结构层不因此丢分组。
        assert!(parsed.diagnostics.has_code(ProblemCode::AlignOverHard));
        assert!(!parsed.diagnostics.has_code(ProblemCode::AlignContentDrift));
    }

    #[test]
    fn roundtrip_context_rows() {
        let mut input = AlignTableInput::new("zh", vec![sentence("s-2", "middle", "中间句")]);
        input.context_before = vec![AlignContextRow::new("before sentence", "前一句")];
        input.context_after = vec![AlignContextRow::new("after sentence", "后一句")];
        let output = render_align_table(&input);
        assert!(output.contains("class=\"ctx\""));
        let parsed = parse_align_table(&input, None, &output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.groups.len(), 1);
    }

    #[test]
    fn empty_sentence_list_renders_and_parses_clean() {
        let input = AlignTableInput::new("zh", Vec::new());
        let output = render_align_table(&input);
        let parsed = parse_align_table(&input, None, &output);
        assert!(parsed.groups.is_empty());
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
    }

    #[test]
    fn model_flags_roundtrip() {
        let input = AlignTableInput::new(
            "zh",
            vec![
                sentence("s-1", "abc", "甲乙丙"),
                sentence("s-2", "def", "丁戊己"),
            ],
        );
        let mut reordered = FakeGroup::new("s-1", &[("abc", "丙乙甲")]);
        reordered.reordered = true;
        let mut unsplittable = FakeGroup::new("s-2", &[("def", "丁戊己")]);
        unsplittable.unsplittable = true;
        let parsed = parse_align_table(&input, None, &fake_table(&[reordered, unsplittable]));
        assert!(parsed.group("s-1").unwrap().reordered);
        assert!(parsed.group("s-2").unwrap().unsplittable);
        // reordered 分组不做拼接一致性检查（改写幅度护栏在引擎层）。
        assert!(!parsed.diagnostics.has_code(ProblemCode::AlignContentDrift));
    }

    #[test]
    fn unsplittable_group_still_reports_over_hard() {
        let translation = "这是一个非常长且完全无法在源侧找到任何切点的中文译句内容";
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "src", translation)]);
        let mut group = FakeGroup::new("s-1", &[("src", translation)]);
        group.unsplittable = true;
        let parsed = parse_align_table(&input, None, &fake_table(&[group]));
        assert!(parsed.group("s-1").unwrap().unsplittable);
        assert!(parsed.diagnostics.has_code(ProblemCode::AlignOverHard));
    }

    // -- 负面用例 ----------------------------------------------------------

    #[test]
    fn bare_tbody_without_table_wrapper_is_recovered() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "abc def", "甲乙丙")]);
        let bare = fake_rows_only(&[FakeGroup::new("s-1", &[("abc", "甲乙"), ("def", "丙")])]);
        assert!(!bare.contains("<table"));
        // 文档模式会静默丢掉所有行——恢复路径必须先于截断判定。
        assert!(parse_html(&bare).elements_with_attr("data-sid").is_empty());
        let parsed = parse_align_table(&input, None, &bare);
        assert_eq!(parsed.groups.len(), 1);
        assert_eq!(parsed.groups[0].rows.len(), 2);
        assert!(!parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
        assert!(!parsed.diagnostics.has_code(ProblemCode::MissingId));
    }

    #[test]
    fn trailing_suffix_gap_reports_truncated() {
        let input = AlignTableInput::new(
            "zh",
            vec![
                sentence("s-1", "a", "甲"),
                sentence("s-2", "b", "乙"),
                sentence("s-3", "c", "丙"),
                sentence("s-4", "d", "丁"),
            ],
        );
        let output = fake_table(&[
            FakeGroup::new("s-1", &[("a", "甲")]),
            FakeGroup::new("s-2", &[("b", "乙")]),
        ]);
        let parsed = parse_align_table(&input, None, &output);
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
        assert!(!parsed.diagnostics.has_code(ProblemCode::MissingId));
        assert!(
            parsed.diagnostics.problems[0].detail.contains("s-3"),
            "{:?}",
            parsed.diagnostics.problems
        );
    }

    #[test]
    fn scattered_gap_reports_missing_id() {
        let input = AlignTableInput::new(
            "zh",
            vec![
                sentence("s-1", "a", "甲"),
                sentence("s-2", "b", "乙"),
                sentence("s-3", "c", "丙"),
            ],
        );
        let output = fake_table(&[
            FakeGroup::new("s-1", &[("a", "甲")]),
            FakeGroup::new("s-3", &[("c", "丙")]),
        ]);
        let parsed = parse_align_table(&input, None, &output);
        assert!(parsed.diagnostics.has_code(ProblemCode::MissingId));
        assert!(!parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
    }

    #[test]
    fn empty_output_counts_as_truncated() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let parsed = parse_align_table(&input, None, "");
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
    }

    #[test]
    fn duplicate_sid_is_reported_once_and_first_wins() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a b", "甲乙")]);
        let output = fake_table(&[
            FakeGroup::new("s-1", &[("a", "甲"), ("b", "乙")]),
            FakeGroup::new("s-1", &[("a b", "甲乙")]),
        ]);
        let parsed = parse_align_table(&input, None, &output);
        assert_eq!(parsed.groups.len(), 1);
        assert_eq!(parsed.groups[0].rows.len(), 2);
        assert_eq!(
            parsed
                .diagnostics
                .problems
                .iter()
                .filter(|p| p.code == ProblemCode::DuplicateId)
                .count(),
            1
        );
    }

    #[test]
    fn nested_sid_echo_is_not_a_duplicate() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a b", "甲乙")]);
        // 模型把 data-sid 同时写在分组和每一行上。
        let output = concat!(
            "<table><tbody data-sid=\"s-1\">",
            "<tr data-sid=\"s-1\"><th rowspan=\"2\" scope=\"rowgroup\">s-1</th><td>a</td><td>甲</td></tr>",
            "<tr data-sid=\"s-1\"><td>b</td><td>乙</td></tr>",
            "</tbody></table>"
        );
        let parsed = parse_align_table(&input, None, output);
        assert_eq!(parsed.groups.len(), 1);
        assert_eq!(parsed.groups[0].rows.len(), 2);
        assert!(!parsed.diagnostics.has_code(ProblemCode::DuplicateId));
    }

    #[test]
    fn unknown_sid_is_reported_and_ignored() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let output = fake_table(&[
            FakeGroup::new("s-1", &[("a", "甲")]),
            FakeGroup::new("s-99", &[("x", "叉")]),
        ]);
        let parsed = parse_align_table(&input, None, &output);
        assert_eq!(parsed.groups.len(), 1);
        assert!(parsed.diagnostics.has_code(ProblemCode::UnknownId));
    }

    #[test]
    fn ids_are_compared_byte_exactly() {
        let input = AlignTableInput::new("zh", vec![sentence("s-G1.0", "a", "甲")]);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new("s-g1.0", &[("a", "甲")])]),
        );
        assert!(parsed.diagnostics.has_code(ProblemCode::UnknownId));
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
    }

    #[test]
    fn empty_translation_is_reported() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a b", "甲乙")]);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new("s-1", &[("a", "甲乙"), ("b", "  ")])]),
        );
        assert!(parsed.diagnostics.has_code(ProblemCode::EmptyTranslation));
    }

    #[test]
    fn group_without_rows_is_present_but_empty() {
        let input = AlignTableInput::new(
            "zh",
            vec![sentence("s-1", "a", "甲"), sentence("s-2", "b", "乙")],
        );
        let output = concat!(
            "<table><tbody data-sid=\"s-1\"><tr><th scope=\"rowgroup\">s-1</th><td>a</td><td>甲</td></tr></tbody>",
            "<tbody data-sid=\"s-2\"></tbody></table>"
        );
        let parsed = parse_align_table(&input, None, output);
        // 有 data-sid 即视为「id 已出现」：不算截断，只报空译。
        assert!(!parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
        assert!(!parsed.diagnostics.has_code(ProblemCode::MissingId));
        assert!(parsed.diagnostics.has_code(ProblemCode::EmptyTranslation));
        assert_eq!(parsed.group("s-2").unwrap().rows.len(), 0);
    }

    #[test]
    fn source_column_edit_reports_source_drift() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "alpha beta gamma", "甲乙丙")]);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new(
                "s-1",
                &[("alpha beta", "甲乙"), ("delta", "丙")],
            )]),
        );
        assert!(parsed.diagnostics.has_code(ProblemCode::SourceDrift));
    }

    #[test]
    fn source_split_with_only_punctuation_changes_is_accepted() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "alpha beta gamma", "甲乙丙")]);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new(
                "s-1",
                &[("alpha, beta", "甲乙"), ("gamma.", "丙")],
            )]),
        );
        assert!(!parsed.diagnostics.has_code(ProblemCode::SourceDrift));
    }

    #[test]
    fn context_row_edit_reports_source_drift() {
        let mut input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        input.context_before = vec![AlignContextRow::new("before sentence", "前一句")];
        let output = concat!(
            "<table><tbody class=\"ctx\"><tr><th scope=\"rowgroup\"></th>",
            "<td class=\"src\">before sentence CHANGED</td><td class=\"tgt\">前一句</td></tr></tbody>",
            "<tbody data-sid=\"s-1\"><tr><th rowspan=\"1\" scope=\"rowgroup\">s-1</th><td>a</td><td>甲</td></tr></tbody></table>"
        );
        let parsed = parse_align_table(&input, None, output);
        assert!(parsed.diagnostics.has_code(ProblemCode::SourceDrift));
    }

    #[test]
    fn omitted_context_is_a_warning_not_a_problem() {
        let mut input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        input.context_before = vec![AlignContextRow::new("before", "前")];
        input.context_after = vec![AlignContextRow::new("after", "后")];
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new("s-1", &[("a", "甲")])]),
        );
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ContentIgnored)
        );
    }

    #[test]
    fn partial_context_echo_matches_by_content_not_position() {
        let mut input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        input.context_before = vec![AlignContextRow::new("before", "前")];
        input.context_after = vec![AlignContextRow::new("after", "后")];
        // 只回显了「后文」那一条：按位置比对会把它错配到 context_before。
        let output = concat!(
            "<table><tbody data-sid=\"s-1\"><tr><th rowspan=\"1\" scope=\"rowgroup\">s-1</th><td>a</td><td>甲</td></tr></tbody>",
            "<tbody class=\"ctx\"><tr><th scope=\"rowgroup\"></th><td class=\"src\">after</td><td class=\"tgt\">后</td></tr></tbody></table>"
        );
        let parsed = parse_align_table(&input, None, output);
        assert!(!parsed.diagnostics.has_code(ProblemCode::SourceDrift));
    }

    #[test]
    fn concat_mismatch_reports_content_drift() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a b", "九十天翻了八倍")]);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new("s-1", &[("a", "九十天"), ("b", "涨了八倍")])]),
        );
        assert!(parsed.diagnostics.has_code(ProblemCode::AlignContentDrift));
    }

    #[test]
    fn frozen_target_is_enforced_by_shared_file_lint() {
        let mut frozen = sentence("s-1", "a b", "第一段第二段");
        frozen.frozen_target = vec!["第一段".to_owned(), "第二段".to_owned()];
        let input = AlignTableInput::new("zh", vec![frozen]);

        let accepted = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new("s-1", &[("a", "第一段"), ("b", "第二段")])]),
        );
        assert!(!accepted.diagnostics.has_problems());

        let changed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new("s-1", &[("a", "第一"), ("b", "段第二段")])]),
        );
        assert!(
            changed.diagnostics.problems.iter().any(|problem| {
                problem.code == ProblemCode::AlignContentDrift
                    && problem.detail.contains("data-target-frozen")
            }),
            "{:?}",
            changed.diagnostics
        );

        let mut reordered = FakeGroup::new("s-1", &[("a", "第一段"), ("b", "第二段")]);
        reordered.reordered = true;
        let changed = parse_align_table(&input, None, &fake_table(&[reordered]));
        assert!(changed.diagnostics.problems.iter().any(|problem| {
            problem.code == ProblemCode::AlignContentDrift
                && problem.detail.contains("禁止 data-reordered")
        }));
    }

    /// `data-no-rewrite` 的两条要求：随载体往返不丢，且拒掉改写通道。
    ///
    /// p-fb353b44 实测：paired 补行轮 38 个候选全数被拒、0 句被修。答案里
    /// `data-reordered="true"` 让校验换用宽得多的改写幅度阈值放行，而 paired
    /// 验收只按原始 `trans` 度量数行，两把尺子对不上，整轮调用白烧。
    ///
    /// 这条校验住在 `parse_align_table` 里，所以引擎 provider 路径与
    /// `lint_agent_answer_file` 的提交期校验共用同一份，不存在第二份可漂移的副本。
    #[test]
    fn no_rewrite_rejects_the_reorder_escape_hatch_in_the_shared_lint() {
        let mut locked = sentence("s-1", "a b", "第一段第二段");
        locked.no_rewrite = true;
        let input = AlignTableInput::new("zh", vec![locked]);

        // 属性要能随载体往返：渲染出去、再解析回来仍然是 no_rewrite。
        let rendered = render_align_table(&input);
        assert!(rendered.contains("data-no-rewrite=\"true\""), "{rendered}");
        let round_tripped = parse_align_table_input(&rendered).expect("round trip");
        assert!(round_tripped.sentences[0].no_rewrite);

        // 只重选切点：照收。
        let accepted = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new("s-1", &[("a", "第一段"), ("b", "第二段")])]),
        );
        assert!(
            !accepted.diagnostics.has_problems(),
            "{:?}",
            accepted.diagnostics
        );

        // 改写译文并标 data-reordered：拒。
        let mut reordered = FakeGroup::new("s-1", &[("a", "第二段落"), ("b", "第一段落")]);
        reordered.reordered = true;
        let rejected = parse_align_table(&input, None, &fake_table(&[reordered]));
        assert!(
            rejected.diagnostics.problems.iter().any(|problem| {
                problem.code == ProblemCode::AlignContentDrift
                    && problem.detail.contains("data-no-rewrite")
            }),
            "{:?}",
            rejected.diagnostics
        );

        // 词序交叉的正当出路仍然开着。
        let mut crossing = FakeGroup::new("s-1", &[("a", "第一段"), ("b", "第二段")]);
        crossing.crossing = true;
        let crossed = parse_align_table(&input, None, &fake_table(&[crossing]));
        assert!(!crossed.diagnostics.has_code(ProblemCode::AlignContentDrift));

        // 不带该属性的句子不受影响：改写通道照常可用。
        let free = AlignTableInput::new("zh", vec![sentence("s-2", "a b", "第一段第二段")]);
        let mut reordered = FakeGroup::new("s-2", &[("a", "第二段"), ("b", "第一段")]);
        reordered.reordered = true;
        let parsed = parse_align_table(&free, None, &fake_table(&[reordered]));
        assert!(!parsed.diagnostics.has_code(ProblemCode::AlignContentDrift));
    }

    #[test]
    fn punctuation_only_change_is_not_content_drift() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a b", "九十天翻了八倍")]);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new(
                "s-1",
                &[("a", "九十天，"), ("b", "翻了八倍。")],
            )]),
        );
        assert!(!parsed.diagnostics.has_code(ProblemCode::AlignContentDrift));
    }

    #[test]
    fn over_hard_piece_is_reported() {
        let long = "这是一个远远超过硬上限的中文字幕行内容不可接受";
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a b", long)]);
        assert!(target_cps_chars(long, "zh") > TransParams::for_lang("zh").hard);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new("s-1", &[("a b", long)])]),
        );
        assert!(parsed.diagnostics.has_code(ProblemCode::AlignOverHard));
        let problem = parsed
            .diagnostics
            .problems
            .iter()
            .find(|p| p.code == ProblemCode::AlignOverHard)
            .expect("over-hard problem");
        assert!(problem.detail.contains("第 1 片"), "{}", problem.detail);
        // 纯 CJK、无标点：切分器没有词典，不给具体切法（会切进词内），只说明
        // 需在词边界处切开；仍是 Problem 而非放行。
        assert!(
            problem.detail.contains("请在词边界处切开") && !problem.detail.contains("可切为"),
            "{}",
            problem.detail
        );
        assert!(
            parsed.diagnostics.warnings.is_empty(),
            "{:?}",
            parsed.diagnostics
        );
    }

    /// 01a00494 现场 s-g109.20：第 4 片 23 单位，「，」处就有合法切点，worker
    /// 却连吃三次 lint try。detail 必须直接给出切法，且该切法本身能过 lint。
    #[test]
    fn over_hard_hint_names_a_legal_in_piece_cut() {
        let translation = "那就是你设定的目标。我们会持续这样做，直到模型自己调用工具update plan、update goal，说明计划或目标已真正实现。";
        let input = AlignTableInput::new(
            "zh-Hans",
            vec![sentence("s-g109.20", "a b c d", translation)],
        );
        let over = "update plan、update goal，说明计划或目标已真正实现。";
        assert!(piece_display_units(over, "zh-Hans") > input.params.hard);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new(
                "s-g109.20",
                &[
                    ("a", "那就是你设定的目标。"),
                    ("b", "我们会持续这样做，"),
                    ("c", "直到模型自己调用工具"),
                    ("d", over),
                ],
            )]),
        );
        let problem = parsed
            .diagnostics
            .problems
            .iter()
            .find(|p| p.code == ProblemCode::AlignOverHard)
            .expect("over-hard problem");
        assert!(
            problem.detail.contains("第 4 片 23 单位"),
            "{}",
            problem.detail
        );
        assert!(
            problem
                .detail
                .contains("可切为「update plan、update goal，」｜「说明计划或目标已真正实现。」"),
            "{}",
            problem.detail
        );
        assert!(
            !parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::AlignOverHardUncuttable)
        );

        // 照提示切开后：不再超 hard，也不引入 align-illegal-seam。
        let fixed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new(
                "s-g109.20",
                &[
                    ("a", "那就是你设定的目标。"),
                    ("b", "我们会持续这样做，"),
                    ("c", "直到模型自己调用工具"),
                    ("d", "update plan、update goal，"),
                    ("", "说明计划或目标已真正实现。"),
                ],
            )]),
        );
        assert!(
            !fixed.diagnostics.has_code(ProblemCode::AlignOverHard)
                && !fixed.diagnostics.has_code(ProblemCode::AlignIllegalSeam),
            "{:?}",
            fixed.diagnostics
        );
    }

    /// 整句无合法切分时降为 warning 放行——worker 没有合法动作，拒收只烧 try。
    #[test]
    fn over_hard_without_legal_cut_downgrades_to_warning() {
        // 单原子巨型 Latin 记号：切分器不做字符位硬切，整句无合法切分。
        let token = "supercalifragilisticexpialidocious_extremely_long_identifier_name";
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a b", token)]);
        assert!(piece_display_units(token, "zh") > input.params.hard);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new("s-1", &[("a b", token)])]),
        );
        assert!(
            !parsed.diagnostics.has_code(ProblemCode::AlignOverHard),
            "{:?}",
            parsed.diagnostics
        );
        let warning = parsed
            .diagnostics
            .warnings
            .iter()
            .find(|w| w.code == WarningCode::AlignOverHardUncuttable)
            .expect("uncuttable warning");
        assert!(warning.detail.contains("第 1 片"), "{}", warning.detail);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
    }

    #[test]
    fn illegal_seam_is_reported() {
        // 片尾悬垂连词「和」：seam::lint_pieces 的客观语病级问题。
        let translation = "我们砍掉了付费营销和自建的渠道团队";
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a b", translation)]);
        let parsed = parse_align_table(
            &input,
            None,
            &fake_table(&[FakeGroup::new(
                "s-1",
                &[("a", "我们砍掉了付费营销和"), ("b", "自建的渠道团队")],
            )]),
        );
        assert!(
            parsed.diagnostics.has_code(ProblemCode::AlignIllegalSeam),
            "{:?}",
            parsed.diagnostics.problems
        );
    }

    /// 契约的 paired-row balance 允许「源行过密 + 两侧都是完整并列动作」时切在
    /// 顿号上；Shorts 验收 C6 实测 align-table 提交期 lint 仍按普通列表拒收。
    fn list_seam_parsed(source_lang: &str, rows: &[(&str, &str)]) -> AlignParsed {
        let source: String = rows
            .iter()
            .map(|(source, _)| *source)
            .collect::<Vec<_>>()
            .join(" ");
        let translation: String = rows.iter().map(|(_, target)| *target).collect();
        let mut input = AlignTableInput::new("zh", vec![sentence("s-1", &source, &translation)]);
        input.source_lang = source_lang.to_owned();
        // 走提交期 lint 的真实入口：从落盘载荷反解表输入。
        let table = parse_align_table_input(&render_align_table(&input)).expect("align payload");
        parse_align_table(&table, None, &fake_table(&[FakeGroup::new("s-1", rows)]))
    }

    fn reports_list_separator(parsed: &AlignParsed) -> bool {
        parsed.diagnostics.problems.iter().any(|problem| {
            problem.code == ProblemCode::AlignIllegalSeam
                && problem.detail.contains("list separator")
        })
    }

    #[test]
    fn parallel_action_list_seam_is_allowed_when_source_rows_are_dense() {
        let parsed = list_seam_parsed(
            "en",
            &[
                (
                    "because every single time we have to go and update the skills",
                    "因为得不断更新技能、",
                ),
                ("and check out the branch again", "检出分支，"),
                ("before we push.", "然后再推送。"),
            ],
        );
        assert!(
            !parsed.diagnostics.has_code(ProblemCode::AlignIllegalSeam),
            "{:?}",
            parsed.diagnostics.problems
        );
    }

    #[test]
    fn parallel_action_list_seam_is_rejected_when_source_rows_fit() {
        let parsed = list_seam_parsed(
            "en",
            &[
                ("update skills", "因为得不断更新技能、"),
                ("check out", "检出分支，"),
                ("then push.", "然后再推送。"),
            ],
        );
        assert!(
            reports_list_separator(&parsed),
            "{:?}",
            parsed.diagnostics.problems
        );
    }

    #[test]
    fn noun_list_seam_stays_rejected_even_when_source_rows_are_dense() {
        let parsed = list_seam_parsed(
            "en",
            &[
                (
                    "and what you end up with is the controller that reads the error",
                    "最后得到的是控制器、",
                ),
                ("and the actuator that applies the fix", "执行器，"),
                ("working together.", "二者协同工作。"),
            ],
        );
        assert!(
            reports_list_separator(&parsed),
            "{:?}",
            parsed.diagnostics.problems
        );
    }

    #[test]
    fn list_seam_source_width_follows_the_source_language_budget() {
        // 同样 20 个源字：中文源语单行预算 16，已过密；拉丁源语预算 42，不过密。
        let rows = [
            (
                "我们每一次都得回去把全部技能重新更新一",
                "因为得不断更新技能、",
            ),
            ("遍", "检出分支，"),
            ("然后推送。", "然后再推送。"),
        ];
        assert!(
            !list_seam_parsed("zh", &rows)
                .diagnostics
                .has_code(ProblemCode::AlignIllegalSeam)
        );
        assert!(
            list_seam_parsed("", &rows)
                .diagnostics
                .has_code(ProblemCode::AlignIllegalSeam)
        );
    }

    #[test]
    fn rowspan_mismatch_is_a_warning_not_a_problem() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a b", "甲乙")]);
        let mut group = FakeGroup::new("s-1", &[("a", "甲"), ("b", "乙")]);
        group.rowspan = Some(5);
        let parsed = parse_align_table(&input, None, &fake_table(&[group]));
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::RowspanMismatch)
        );
    }

    #[test]
    fn crossing_and_reordered_are_mutually_exclusive() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let mut group = FakeGroup::new("s-1", &[("a", "乙")]);
        group.reordered = true;
        group.crossing = true;
        let parsed = parse_align_table(&input, None, &fake_table(&[group]));
        let parsed_group = parsed.group("s-1").unwrap();
        assert!(parsed_group.reordered);
        assert!(!parsed_group.crossing);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ContentIgnored)
        );
    }

    #[test]
    fn crossing_alone_survives() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let mut group = FakeGroup::new("s-1", &[("a", "甲")]);
        group.crossing = true;
        let parsed = parse_align_table(&input, None, &fake_table(&[group]));
        assert!(parsed.group("s-1").unwrap().crossing);
        assert!(!parsed.group("s-1").unwrap().reordered);
    }

    #[test]
    fn non_boolean_flag_value_degrades_to_false() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let output = "<table><tbody data-sid=\"s-1\" data-unsplittable=\"maybe\"><tr><td>a</td><td>甲</td></tr></tbody></table>";
        let parsed = parse_align_table(&input, None, output);
        assert!(!parsed.group("s-1").unwrap().unsplittable);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ContentIgnored)
        );
    }

    #[test]
    fn control_characters_are_stripped_before_parsing() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "ab", "甲乙")]);
        let output = "<table><tbody data-sid=\"s-1\"><tr><td>a\u{202E}b</td><td>甲\u{0007}乙</td></tr></tbody></table>";
        let parsed = parse_align_table(&input, None, output);
        assert_eq!(parsed.groups[0].rows[0].source, "ab");
        assert_eq!(parsed.groups[0].rows[0].target, "甲乙");
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ControlStripped)
        );
    }

    #[test]
    fn script_injection_is_dropped() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let output = concat!(
            "<table><script>fetch('http://evil')</script><style>td{color:red}</style>",
            "<tbody data-sid=\"s-1\"><tr><td onclick=\"x()\">a</td><td>甲</td></tr></tbody></table>"
        );
        let parsed = parse_align_table(&input, None, output);
        assert_eq!(parsed.groups[0].rows[0].target, "甲");
        assert!(!parsed.groups[0].rows[0].source.contains("evil"));
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::NodeDropped)
        );
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
    }

    #[test]
    fn oversize_output_is_rejected_without_parsing() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let sent = render_align_table(&input);
        let parsed = parse_align_table(&input, Some(&sent), &"x".repeat(50_000));
        assert!(parsed.groups.is_empty());
        assert_eq!(
            parsed.diagnostics.codes(),
            vec![ProblemCode::DocumentOversize]
        );
    }

    #[test]
    fn residual_fence_reports_wrapped() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let body = fake_table(&[FakeGroup::new("s-1", &[("a", "甲")])]);
        let output = format!("好的，这是结果：\n```html\n{body}```\n希望有帮助。");
        let parsed = parse_align_table(&input, None, &output);
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentWrapped));
        // 夹带解释不妨碍继续提取结构。
        assert_eq!(parsed.groups.len(), 1);
    }

    #[test]
    fn single_clean_fence_is_stripped_for_free() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let body = fake_table(&[FakeGroup::new("s-1", &[("a", "甲")])]);
        let parsed = parse_align_table(&input, None, &format!("```html\n{body}```\n"));
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::WrapperStripped)
        );
    }

    #[test]
    fn extra_left_column_is_ignored_and_last_two_win() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let output = "<table><tbody data-sid=\"s-1\"><tr><td>1</td><td>a</td><td>甲</td></tr></tbody></table>";
        let parsed = parse_align_table(&input, None, output);
        assert_eq!(parsed.groups[0].rows[0].source, "a");
        assert_eq!(parsed.groups[0].rows[0].target, "甲");
    }

    #[test]
    fn classed_cells_win_over_position() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let output = "<table><tbody data-sid=\"s-1\"><tr><td class=\"tgt\">甲</td><td class=\"src\">a</td></tr></tbody></table>";
        let parsed = parse_align_table(&input, None, output);
        assert_eq!(parsed.groups[0].rows[0].source, "a");
        assert_eq!(parsed.groups[0].rows[0].target, "甲");
    }

    #[test]
    fn short_row_is_ignored_with_warning() {
        let input = AlignTableInput::new("zh", vec![sentence("s-1", "a", "甲")]);
        let output = "<table><tbody data-sid=\"s-1\"><tr><td>甲</td></tr></tbody></table>";
        let parsed = parse_align_table(&input, None, output);
        assert!(parsed.groups[0].rows.is_empty());
        assert!(parsed.diagnostics.has_code(ProblemCode::EmptyTranslation));
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ContentIgnored)
        );
    }

    // -- 确定性 property 测试 ----------------------------------------------

    /// 固定种子手写 LCG（禁止未播种随机；测试必须逐位可复现）。
    struct Lcg(u64);

    impl Lcg {
        fn new(seed: u64) -> Self {
            Self(seed)
        }

        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 33
        }

        fn below(&mut self, bound: usize) -> usize {
            (self.next() % bound as u64) as usize
        }

        fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
            &items[self.below(items.len())]
        }
    }

    const TOKENS: &[&str] = &[
        "hello",
        "world",
        "growth",
        "paid",
        "中文",
        "字幕",
        "翻译",
        "对齐",
        "a&b",
        "x<y",
        "z>w",
        "\"quo\"",
        "混排 mix",
        "９０天",
        "emoji👍",
        "tail,",
    ];

    fn random_text(rng: &mut Lcg, count: usize) -> String {
        (0..count.max(1))
            .map(|_| *rng.pick(TOKENS))
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn property_render_parse_roundtrip_is_identity_modulo_normalization() {
        let mut rng = Lcg::new(0x5EED_1234_ABCD_0001);
        for _ in 0..200 {
            let sentence_count = 1 + rng.below(4);
            let mut sentences = Vec::new();
            let mut fakes = Vec::new();
            for index in 0..sentence_count {
                let id = format!("s-g{index}.0");
                let piece_count = 1 + rng.below(4);
                let mut sources = Vec::new();
                let mut targets = Vec::new();
                for _ in 0..piece_count {
                    let source_len = 1 + rng.below(3);
                    sources.push(random_text(&mut rng, source_len));
                    let target_len = 1 + rng.below(3);
                    targets.push(random_text(&mut rng, target_len));
                }
                let source = sources.join(" ");
                let translation = targets.join("");
                let mut fake = FakeGroup::new(
                    &id,
                    &sources
                        .iter()
                        .zip(targets.iter())
                        .map(|(a, b)| (a.as_str(), b.as_str()))
                        .collect::<Vec<_>>(),
                );
                fake.reordered = rng.below(4) == 0;
                fake.crossing = !fake.reordered && rng.below(4) == 0;
                fake.unsplittable = piece_count == 1 && rng.below(3) == 0;
                fake.classed = rng.below(2) == 0;
                fakes.push((fake, sources, targets));
                sentences.push(sentence(&id, &source, &translation));
            }
            let input = AlignTableInput::new("zh", sentences);
            let output = fake_table(
                &fakes
                    .iter()
                    .map(|(fake, sources, targets)| FakeGroup {
                        sid: fake.sid.clone(),
                        rows: sources
                            .iter()
                            .cloned()
                            .zip(targets.iter().cloned())
                            .collect(),
                        reordered: fake.reordered,
                        crossing: fake.crossing,
                        unsplittable: fake.unsplittable,
                        rowspan: None,
                        classed: fake.classed,
                    })
                    .collect::<Vec<_>>(),
            );
            let parsed = parse_align_table(&input, None, &output);
            assert_eq!(parsed.groups.len(), fakes.len());
            for (group, (fake, sources, targets)) in parsed.groups.iter().zip(fakes.iter()) {
                assert_eq!(group.id, fake.sid);
                assert_eq!(group.reordered, fake.reordered);
                assert_eq!(group.crossing, fake.crossing);
                assert_eq!(group.unsplittable, fake.unsplittable);
                assert_eq!(group.rows.len(), sources.len());
                for (row, (source, target)) in group.rows.iter().zip(sources.iter().zip(targets)) {
                    assert_eq!(row.source, expect_cell(source));
                    assert_eq!(row.target, expect_cell(target));
                }
            }
            // 结构层的账必须是干净的：内容类问题（超 hard / 缝）不在断言范围内。
            for code in [
                ProblemCode::DocumentTruncated,
                ProblemCode::DocumentWrapped,
                ProblemCode::DocumentOversize,
                ProblemCode::MissingId,
                ProblemCode::DuplicateId,
                ProblemCode::UnknownId,
                ProblemCode::EmptyTranslation,
                ProblemCode::SourceDrift,
                ProblemCode::AlignContentDrift,
            ] {
                assert!(
                    !parsed.diagnostics.has_code(code),
                    "unexpected {code} in {:?}",
                    parsed.diagnostics.problems
                );
            }

            // 第二条腿：走真正的 render_align_table（上面那条腿刻意用测试侧的
            // 「模型答卷」渲染器，避免只自证其说）。渲染器的 escape_text /
            // escape_attr 只有在这里才被 property 覆盖到。未切分的整句本身就是
            // 合法答卷：一句一片、原文译文原样回写。
            let rendered = render_align_table(&input);
            let direct = parse_align_table(&input, Some(&rendered), &rendered);
            assert_eq!(direct.groups.len(), input.sentences.len());
            for (group, expected) in direct.groups.iter().zip(input.sentences.iter()) {
                assert_eq!(group.id, expected.id);
                assert!(!group.reordered);
                assert!(!group.crossing);
                assert_eq!(group.rows.len(), 1);
                assert_eq!(group.rows[0].source, expect_cell(&expected.source));
                assert_eq!(group.rows[0].target, expect_cell(&expected.translation));
            }
            for code in [
                ProblemCode::DocumentTruncated,
                ProblemCode::DocumentWrapped,
                ProblemCode::DocumentOversize,
                ProblemCode::MissingId,
                ProblemCode::DuplicateId,
                ProblemCode::UnknownId,
                ProblemCode::EmptyTranslation,
                ProblemCode::SourceDrift,
                ProblemCode::AlignContentDrift,
            ] {
                assert!(
                    !direct.diagnostics.has_code(code),
                    "unexpected {code} on self-roundtrip in {:?}",
                    direct.diagnostics.problems
                );
            }
            // 自回环不得掉节点/掉属性：渲染器只能产出解析器允许的标签与属性。
            for warning in &direct.diagnostics.warnings {
                assert!(
                    warning.code != WarningCode::NodeDropped
                        && warning.code != WarningCode::AttributeDropped,
                    "render emitted something the parser strips: {warning:?}"
                );
            }
        }
    }

    #[test]
    fn property_parse_never_panics_on_garbage() {
        const CHUNKS: &[&str] = &[
            "<", ">", "&", "\"", "'", "/", "=", "table", "tbody", "tr", "td", "th", "data-sid",
            "s-1", "rowspan", "class", "ctx", "甲", "a", " ", "\n", "\t", "\u{0000}", "\u{202E}",
            "```", "<!--", "-->", "\u{FEFF}", "<script>", "</table>", "&amp;", "&#x41;",
        ];
        let input = AlignTableInput::new(
            "zh",
            vec![sentence("s-1", "a b", "甲乙"), sentence("s-2", "c", "丙")],
        );
        let mut rng = Lcg::new(0x0BAD_C0DE_0000_0007);
        for _ in 0..300 {
            let length = rng.below(40);
            let junk: String = (0..length).map(|_| *rng.pick(CHUNKS)).collect();
            let first = parse_align_table(&input, None, &junk);
            let second = parse_align_table(&input, None, &junk);
            // 纯函数：同一输入两次解析必须逐字段相等。
            assert_eq!(first, second);
        }
    }

    #[test]
    fn render_parse_input_render_is_byte_identical() {
        // `parse_align_table_input` 必须是 `render_align_table` 的严格逆：
        // 提交期 lint 只拿得到落盘的载荷 HTML，反解一旦缺字段就会静默退化成
        // 「读不出载荷 ⇒ 不拦」，等于凭空多出第二套判据（§2）。渲染侧新增
        // 任何属性都必须让这条断言先红。
        let input = AlignTableInput {
            lang: "zh".to_owned(),
            params: TransParams {
                fit: 15,
                soft: 13,
                hard: 19,
            },
            source_lang: "en".to_owned(),
            context_before: vec![AlignContextRow::new("Before it.", "前一句。")],
            sentences: vec![
                AlignSentenceInput {
                    id: "s-g1.0".to_owned(),
                    source: "alpha bravo ⏸ charlie delta".to_owned(),
                    translation: "第一段译文需要自然对应，第二段负责收尾。".to_owned(),
                    max_lines: 2,
                    suggested_pieces: (2, 3),
                    unsplittable: false,
                    frozen_target: vec![
                        "第一段译文需要自然对应，".to_owned(),
                        "第二段负责收尾。".to_owned(),
                    ],
                    no_rewrite: false,
                },
                AlignSentenceInput {
                    id: "s-g2.0".to_owned(),
                    source: "echo foxtrot".to_owned(),
                    translation: "回声与狐步。".to_owned(),
                    max_lines: 1,
                    suggested_pieces: (2, 2),
                    unsplittable: true,
                    frozen_target: Vec::new(),
                    no_rewrite: false,
                },
            ],
            context_after: vec![AlignContextRow::new("After it.", "后一句。")],
        };
        let rendered = render_align_table(&input);
        let parsed = parse_align_table_input(&rendered).expect("payload is an align table");
        assert_eq!(parsed, input);
        assert_eq!(render_align_table(&parsed), rendered);
        // 不是 align 表的载荷返回 None（调用方据此降级为「不挡」）。
        assert!(parse_align_table_input("<article><p id=\"s-1\">x</p></article>").is_none());
    }
}
