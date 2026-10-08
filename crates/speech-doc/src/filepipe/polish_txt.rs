//! polish 阶段的 txt 载体编解码器（§6）。
//!
//! 本模块只负责「载体」：把词流切页、渲染成带哨兵栅栏与软标记的纯文本，
//! 再把模型返回的文本解析回段落序列与诊断。它不做词绑定 / 重绑定 /
//! 相似度匹配（那是 M2 的 rebind 职责），也不写任何真相。
//!
//! 复用关系（禁止在本文件里另造阈值）：
//!
//! - ⏸ / ⏹ 与 0.6 / 1.0 / 1.8 秒档位来自 [`crate::engines::markers`]；
//! - 断点评分来自 [`crate::paging::breakpoint_rank`]（说话人 3 > 停顿 2 >
//!   句末 1 > 0）；
//! - 页预算的「词」口径来自 [`crate::atomize::word_count`]。
//!
//! 零 I/O、零时钟、零随机：全部为纯函数，同样的输入恒等地产出同样的输出。
//!
//! # 输入约定
//!
//! 本模块接收的 `words` 必须已经是**参与本次 AI 处理的投影**：隐藏（被裁掉）
//! 的词不得出现在切片里。页内索引一律是该切片的下标，绝对时间戳不进 payload。

use std::ops::Range;

use crate::atomize::{is_cjk_text, normalize_chars, sentence_end, word_count};
use crate::doc::Word;
use crate::engines::markers;
use crate::paging::breakpoint_rank;
use crate::speaker::{SpeakerLabels, speaker_turns};

use super::common::{
    Diagnostics, Problem, ProblemCode, ProblemScope, Warning, WarningCode, guard_output_size,
    normalize_llm_output, sanitize_inline_text,
};

/// 只读上文栅栏行（整行精确匹配）。
pub const FENCE_CONTEXT_BEFORE: &str = "<<<CONTEXT-BEFORE 只读，勿修改>>>";
/// 可编辑核心区起始栅栏行。
pub const FENCE_EDIT_BEGIN: &str = "<<<EDIT-BEGIN>>>";
/// 可编辑核心区结束栅栏行。
pub const FENCE_EDIT_END: &str = "<<<EDIT-END>>>";
/// 只读下文栅栏行（同时是整页的终止标记）。
pub const FENCE_CONTEXT_AFTER: &str = "<<<CONTEXT-AFTER 只读，勿修改>>>";

/// 只读区指纹相似度低于此值才判 [`ProblemCode::SourceDrift`] 拒页。
///
/// 口径：`atomize::similarity`（归一化字符编辑距离，已剥 ⏸/⏹ 与结构行）。
/// 表面级顺手修（错词、重复词——实测 p850 素材单区 ~70 词改 3 处）落在
/// 0.97+；截断、整句跨栅栏泄漏或答非所问会跌到 0.8 以下。阈值取两者之间，
/// 偏保守。
const READONLY_DRIFT_MIN_SIMILARITY: f64 = 0.85;
/// 硬切标记行：页缝落在句中时提示模型「此处不是段落边界」。
pub const MARKER_HARD_CUT: &str = "<<<HARD-CUT>>>";

/// 单段落词数上限（Latin，[`word_count`] 口径：Latin 每词计一）。
///
/// 口语段落通常 40–150 词；分段退化（模型一个空行都不插，整页糊成一段）时
/// 会冲到页预算量级（默认核心区 2200 词）。真实语料上限与退化值之间差一个
/// 数量级，阈值取 300 只拦退化，不误伤密集独白。
pub const MAX_PARAGRAPH_WORDS_LATIN: usize = 300;
/// 单段落词数上限（CJK，[`word_count`] 口径：CJK 逐字计一）。
///
/// 信息密度不同（1 个 Latin 词 ≈ 1.5–2 个 CJK 字），同一词数量纲下 CJK 段落
/// 天然更长，阈值相应放宽。
pub const MAX_PARAGRAPH_WORDS_CJK: usize = 500;

/// 按段落文本的语言取单段词数上限（任一 CJK 字符即走 CJK 档，宽松方向）。
pub fn paragraph_word_limit(text: &str) -> usize {
    if is_cjk_text(text) {
        MAX_PARAGRAPH_WORDS_CJK
    } else {
        MAX_PARAGRAPH_WORDS_LATIN
    }
}

/// 哨兵前缀：正文行以它开头时需要中和，避免伪造栅栏。
const SENTINEL_PREFIX: &str = "<<<";
/// 断点搜索窗口下界比例（对齐 [`crate::paging`] 的「最后 20%」约定）。
const WINDOW_FLOOR_RATIO: f64 = 0.8;

/// polish 分页预算（§6.2 / §12，全部以词为单位）。
#[derive(Debug, Clone, PartialEq)]
pub struct PolishBudget {
    /// 核心区目标词数。
    pub core_words: usize,
    /// 单侧只读上下文的词数上限。
    pub context_words: usize,
    /// 单侧只读上下文的句数上限。
    pub context_sentences: usize,
    /// 为够到下一个 rank≥1 断点允许的溢出比例。
    pub overflow_ratio: f64,
}

impl Default for PolishBudget {
    /// §6.2 默认：核心区 2200 词，上下文 min(200 词, 3 句)，溢出 15%。
    fn default() -> Self {
        Self {
            core_words: 2200,
            context_words: 200,
            context_sentences: 3,
            overflow_ratio: 0.15,
        }
    }
}

/// 一页的切分计划。所有区间都是 `words` 切片上的下标区间（左闭右开）。
///
/// 页边界不入盘：本结构由 [`plan_polish_pages`] 从词流确定性重推。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolishPagePlan {
    /// 页 id（`p001` 起）。
    pub id: String,
    /// 只读上文区间（首页为空区间）。
    pub before: Range<usize>,
    /// 可编辑核心区间。
    pub core: Range<usize>,
    /// 只读下文区间（末页为空区间）。
    pub after: Range<usize>,
    /// 本页开头是否由硬切产生（上一页在句中被切开）。
    pub hard_cut_start: bool,
    /// 本页结尾是否为硬切。
    pub hard_cut_end: bool,
    /// 已有的人工段钉（`words` 上的绝对下标，表示该词必须另起一段）。
    ///
    /// 等于 `core.start` 的段钉天然成立（该词本就是首段段首），不产生额外分段；
    /// 落在核心区之外的下标被忽略。
    pub para_starts: Vec<usize>,
}

/// 渲染结果：文本 + 渲染期产生的告警（如哨兵中和）。
///
/// 载体渲染需要回传 [`WarningCode::SentinelNeutralized`]，所以返回结构体而不是
/// 裸 `String`。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PolishRendered {
    /// 完整页文本（以换行结尾）。
    pub text: String,
    /// 渲染期告警。
    pub warnings: Vec<Warning>,
}

/// 解析结果。
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PolishParsed {
    /// 核心区解析出的段落（已剥标记、折叠 CJK 空格）。
    pub paragraphs: Vec<String>,
    /// ⏹ 硬保证：这些 `words` 绝对下标必须是段首。
    ///
    /// 无论模型返回什么，本字段都按原文说话人切换位置无条件给出；
    /// 只有在「逐字保真」（模型未改动核心区文字）时，解析才会据此把
    /// [`PolishParsed::paragraphs`] 真正切开并记 [`WarningCode::BoundaryForced`]。
    /// 非保真情形的落位交由 M2 的 rebind 处理。
    pub forced_boundaries: Vec<usize>,
    /// 页缝显式信号：模型在 `EDIT-BEGIN` 之后、第一句之前留了空行，表示
    /// 核心区首段**不延续**只读上文的末段（另起一段）。没留空行只表示
    /// 「未表态」——引擎交给 seam-repair 波次判定，不能反推为「延续」。
    pub starts_new_paragraph: bool,
    /// 协议问题与告警。
    pub diagnostics: Diagnostics,
}

/// 按 §6.2 把词流切成 polish 页。
///
/// 页数先按 `ceil(总核心词 / (core_words + slack))` 确定（见
/// [`crate::paging::page_count_for_total`]），每页目标取「剩余词数 / 剩余
/// 页数」——贪心装填会在结尾留碎尾页，均衡后各页词量相当；剩余页数按
/// `ceil(剩余词数 / (core_words + slack))` 兜底，前页亏空过大时宁可多出
/// 一页也不让末页超载。
///
/// **分页单位随说话人信息切换**：
///
/// - **有说话人**（词流里出现过 ≥2 个 `sp`）：单位是**轮次序列**——页 =
///   连续整轮次的并，页界取 +15% 溢出上限内、词成本最接近页目标的轮次
///   起点（平局取靠后）。短轮次自然成组；只有单独超预算的长轮次才在内部
///   切开，此时**句界优先**（句末标点，见 [`sentence_end`]），窗口内没有
///   句界才回落到下面的通用评分。页缝因此只落在轮次边界或长轮次内的句界，
///   不会劈开一个人话的中段。最接近页目标的轮次边界仍够不到窗口下界时
///   （下一个轮次单独就超预算），不为一句"嗯"单开一页：改在长轮次内部按
///   句界断，这页 = 短轮次 + 长轮次的头；长轮次内什么断点都没有才退回那个
///   偏短的整轮次页。
/// - **无说话人**（全篇单一 `sp`）：单位是词流 + 断点评分——核心区累计到
///   页目标的最后 20% 起，断点按「词位 + rank×(页目标/20)」联合评分
///   （[`breakpoint_rank`] 每高一档只值约 5% 页目标的提前量，同分取靠后），
///   但与长轮次内部一样**句界优先**：窗口里只要有句末标点就取评分最高的
///   句界，没有句界才回落到停顿断点。
///
/// 两条路径都在窗口里找不到断点时于 +15% 溢出区里先取**第一个**句界，再取
/// 第一个 rank≥1 的断点，仍找不到才硬切并置 `hard_cut_*`。上下文取相邻页核心区里的完整句，最多
/// `context_sentences` 句或 `context_words` 词，且至少 1 句。
///
/// 传入的 `words` 必须是已排除隐藏词的投影（见模块文档）。
pub fn plan_polish_pages(words: &[Word], budget: &PolishBudget) -> Vec<PolishPagePlan> {
    if words.is_empty() {
        return Vec::new();
    }
    let counts: Vec<usize> = words.iter().map(|w| word_count(&w.text).max(1)).collect();
    let core_budget = budget.core_words.max(1);
    let total = words.len();
    let total_cost: usize = counts.iter().sum();
    let target_pages = crate::paging::page_count_for_total(total_cost, core_budget);
    // 轮次序列（无说话人信息时只有一个轮次，走原词流路径）。
    let turn_starts: Vec<usize> = speaker_turns(words).into_iter().map(|t| t.start).collect();
    let turn_aware = turn_starts.len() > 1;
    let prefix_cost = crate::paging::cost_prefix(&counts);

    let mut cores: Vec<Range<usize>> = Vec::new();
    // 每页尾部是否硬切。
    let mut hard_cuts: Vec<bool> = Vec::new();
    let mut start = 0usize;
    let mut remaining_cost = total_cost;
    let page_cap = core_budget + crate::paging::page_slack(core_budget);
    while start < total {
        let cap_pages = remaining_cost.div_ceil(page_cap).max(1);
        let pages_left = target_pages
            .saturating_sub(cores.len())
            .max(cap_pages)
            .max(1);
        let page_budget = remaining_cost.div_ceil(pages_left).max(1);
        let floor = ((page_budget as f64) * WINDOW_FLOOR_RATIO) as usize;
        let overflow_budget =
            ((page_budget as f64) * (1.0 + budget.overflow_ratio.max(0.0))) as usize;
        let (budget_end, overflow_end) = span_ends(&counts, start, page_budget, overflow_budget);
        if overflow_end >= total {
            cores.push(start..total);
            hard_cuts.push(false);
            break;
        }
        let rank_bonus = (page_budget / 20).max(1) as i64;
        // 有说话人时先按整轮次找页界；命中即整页由完整轮次组成。
        let turn_cut = turn_aware
            .then(|| {
                crate::paging::turn_boundary_cut(
                    &turn_starts,
                    &prefix_cost,
                    start,
                    overflow_end,
                    page_budget,
                )
            })
            .flatten();
        // 最接近页目标的轮次边界仍够不到窗口下界 ⇒ 下一个轮次单独就超预算
        //（长独白）。此时不为一句"嗯"单开一页，改为在长轮次内部按句界断，
        // 让这页= 短轮次 + 长轮次的头。
        let mut cut = turn_cut
            .filter(|boundary| prefix_cost[*boundary].saturating_sub(prefix_cost[start]) >= floor);
        if cut.is_none() {
            // 长轮次内部（或无说话人的词流）：窗口内联合评分。
            let mut cut_score = 0i64;
            // 句界优先（两条路径一致）：窗口里只要有句末标点就取评分最高的
            // 句界；没有句界才回落到通用评分（停顿）。否则一个 0.6s 的犹豫
            // 停顿就能压过窗口里所有句末——单人长讲实测 47 个页缝里 30 个
            // 落在句中（「我们大 ‖ 脑的皮层」），页缝两侧各剩半句、又被当成
            // 段落边界。句界优先后只剩完全无标点的区段才会在句中切页。
            let mut clause_cut: Option<(usize, i64)> = None;
            let mut used = 0usize;
            for index in start..budget_end {
                used += counts[index];
                if index + 1 >= total {
                    break;
                }
                if used >= floor {
                    let rank = breakpoint_rank(&words[index], &words[index + 1]);
                    // 评分 = 词位 + rank 加成（与 paginate_word_ranges 同法）；
                    // 高档断点最多换取每档约 5% 页目标的提前量，平局取靠后者。
                    if rank > 0 {
                        let score = used as i64 + i64::from(rank) * rank_bonus;
                        if cut.is_none() || score >= cut_score {
                            cut = Some(index + 1);
                            cut_score = score;
                        }
                        if sentence_end(&words[index].text)
                            && clause_cut.is_none_or(|(_, best)| score >= best)
                        {
                            clause_cut = Some((index + 1, score));
                        }
                    }
                }
            }
            if let Some((sentence_cut, _)) = clause_cut {
                cut = Some(sentence_cut);
            }
            if cut.is_none() {
                // 溢出区同样句界优先（轮次感知下这段一定还在同一轮次内：
                // 轮次边界已被 turn_boundary_cut 吃掉）。
                for index in budget_end..overflow_end {
                    if index + 1 >= total {
                        break;
                    }
                    if sentence_end(&words[index].text) {
                        cut = Some(index + 1);
                        break;
                    }
                }
            }
            if cut.is_none() {
                // 窗口 + 溢出区连一个句末标点都没有：退回通用断点（停顿），
                // 仍找不到才硬切。
                for index in budget_end..overflow_end {
                    if index + 1 >= total {
                        break;
                    }
                    if breakpoint_rank(&words[index], &words[index + 1]) > 0 {
                        cut = Some(index + 1);
                        break;
                    }
                }
            }
            // 长轮次内什么断点都没有：宁可要一页偏短的完整轮次，也不硬切。
            if cut.is_none() {
                cut = turn_cut;
            }
        }
        let hard = cut.is_none();
        // 不变式：每页至少吃掉一个词，否则会死循环。
        let cut = cut.unwrap_or(budget_end).clamp(start + 1, total);
        cores.push(start..cut);
        hard_cuts.push(hard);
        remaining_cost = remaining_cost.saturating_sub(counts[start..cut].iter().sum::<usize>());
        start = cut;
    }

    let mut plans = Vec::with_capacity(cores.len());
    for (index, core) in cores.iter().enumerate() {
        let before = if index > 0 {
            context_before(words, &counts, core.start, cores[index - 1].start, budget)
        } else {
            core.start..core.start
        };
        let after = if index + 1 < cores.len() {
            context_after(words, &counts, core.end, cores[index + 1].end, budget)
        } else {
            core.end..core.end
        };
        plans.push(PolishPagePlan {
            id: format!("p{:03}", index + 1),
            before,
            core: core.clone(),
            after,
            hard_cut_start: index > 0 && hard_cuts[index - 1],
            hard_cut_end: hard_cuts[index],
            para_starts: Vec::new(),
        });
    }
    plans
}

/// 计算从 `start` 起分别吃满核心预算 / 溢出预算的结束下标（左闭右开）。
fn span_ends(
    counts: &[usize],
    start: usize,
    core_budget: usize,
    overflow_budget: usize,
) -> (usize, usize) {
    let mut used = 0usize;
    let mut budget_end = start;
    let mut overflow_end = start;
    for (index, count) in counts.iter().enumerate().skip(start) {
        used += count;
        if used <= core_budget {
            budget_end = index + 1;
        }
        if used <= overflow_budget {
            overflow_end = index + 1;
        } else {
            break;
        }
    }
    let budget_end = budget_end.max(start + 1).min(counts.len());
    (budget_end, overflow_end.max(budget_end))
}

/// 向前收集完整句作为只读上文，下界夹到上一页核心区起点。
fn context_before(
    words: &[Word],
    counts: &[usize],
    core_start: usize,
    lower: usize,
    budget: &PolishBudget,
) -> Range<usize> {
    let mut sentences = 0usize;
    let mut used = 0usize;
    let mut best = core_start;
    let mut index = core_start;
    while index > lower {
        index -= 1;
        used += counts[index];
        let starts_sentence = index == lower || sentence_end(&words[index - 1].text);
        if starts_sentence {
            sentences += 1;
            best = index;
            if sentences >= budget.context_sentences || used >= budget.context_words {
                break;
            }
        } else if sentences >= 1 && used >= budget.context_words {
            break;
        }
    }
    best..core_start
}

/// 向后收集完整句作为只读下文，上界夹到下一页核心区终点。
fn context_after(
    words: &[Word],
    counts: &[usize],
    core_end: usize,
    upper: usize,
    budget: &PolishBudget,
) -> Range<usize> {
    let mut sentences = 0usize;
    let mut used = 0usize;
    let mut best = core_end;
    let mut index = core_end;
    while index < upper {
        used += counts[index];
        let ends_sentence = index + 1 == upper || sentence_end(&words[index].text);
        index += 1;
        if ends_sentence {
            sentences += 1;
            best = index;
            if sentences >= budget.context_sentences || used >= budget.context_words {
                break;
            }
        } else if sentences >= 1 && used >= budget.context_words {
            break;
        }
    }
    core_end..best
}

/// 渲染一页 polish txt（§6.2 栅栏布局）。
///
/// 布局：
///
/// ```text
/// <<<CONTEXT-BEFORE 只读，勿修改>>>
/// …上一页尾部…
/// <<<EDIT-BEGIN>>>
/// …本页核心区，段落之间留一个空行…
/// <<<EDIT-END>>>
/// …下一页头部…
/// <<<CONTEXT-AFTER 只读，勿修改>>>
/// ```
///
/// `<<<HARD-CUT>>>` 落在编辑栅栏**之外**（`EDIT-BEGIN` 前 / `EDIT-END` 后），
/// 保证核心区是纯正文。正文行若以 `<<<` 开头，行首补一个空格中和，并记
/// [`WarningCode::SentinelNeutralized`]。
pub fn render_polish_page(words: &[Word], plan: &PolishPagePlan) -> PolishRendered {
    let mut warnings = Vec::new();
    let before = clamp_range(&plan.before, words.len());
    let core = clamp_range(&plan.core, words.len());
    let after = clamp_range(&plan.after, words.len());
    // 标签从**整份投影**派生，因此同一说话人在所有页里的标签一致。
    let labels = SpeakerLabels::from_words(words);
    let labels = (!labels.is_empty()).then_some(labels);
    let mut lines: Vec<String> = Vec::new();

    lines.push(FENCE_CONTEXT_BEFORE.to_owned());
    push_blocks(
        &mut lines,
        render_region(words, &before, &[], labels.as_ref()),
        &plan.id,
        &mut warnings,
    );
    if plan.hard_cut_start {
        lines.push(MARKER_HARD_CUT.to_owned());
    }
    lines.push(FENCE_EDIT_BEGIN.to_owned());
    push_blocks(
        &mut lines,
        render_region(words, &core, &plan.para_starts, labels.as_ref()),
        &plan.id,
        &mut warnings,
    );
    lines.push(FENCE_EDIT_END.to_owned());
    if plan.hard_cut_end {
        lines.push(MARKER_HARD_CUT.to_owned());
    }
    push_blocks(
        &mut lines,
        render_region(words, &after, &[], labels.as_ref()),
        &plan.id,
        &mut warnings,
    );
    lines.push(FENCE_CONTEXT_AFTER.to_owned());

    let mut text = lines.join("\n");
    text.push('\n');
    PolishRendered { text, warnings }
}

/// 只靠「payload 字符串 + answer 字符串」就能算出的全部检查（§6.4 第 1 档）。
///
/// **为什么校验要按这条线切成两半**：agent 侧 `task submit` 的镜像 lint 只拿得到
/// 磁盘上那两份文本，**没有 `words`**（词流不进 agent 任务目录，任务目录里只有
/// 渲染出来的 txt）。所以判据必须按「是否需要真相」分工：
///
/// - 本函数（字符串就够）：输出体积护栏、哨兵栅栏完整性/顺序/重复、栅栏之外的
///   杂物、只读区漂移（拿 `input` **自己的**只读区与 `output` 的比，不需要词流）、
///   空行语义与 ≥3 连续换行折叠、代码块残留、核心区为空；
/// - 引擎侧 validate（必须有 `words`）：整页 atom-LCS 比值、逐句相似度门、
///   单句源跨度上限（字符 / 秒）。
///
/// [`parse_polish_page`] **内部调用**本函数，`engines::polish::lint_agent_answer_file`
/// 也直接调用它——协议校验只有这一份实现。
///
/// 作用域一律是 [`ProblemScope::Document`]（本函数不知道页 id）；
/// [`parse_polish_page`] 会把它们改写成页作用域。
pub fn lint_polish_page(input: &str, output: &str) -> Diagnostics {
    lint_page(input, output).diagnostics
}

/// [`lint_polish_page`] 的内部形态：诊断 + 已切好的核心区段落。
struct PolishLint {
    diagnostics: Diagnostics,
    paragraphs: Vec<String>,
    /// 核心区以空行开头（页缝显式「另起一段」信号）。
    starts_new_paragraph: bool,
    /// 四条栅栏是否定位成功（失败时 `paragraphs` 必为空）。
    fenced: bool,
}

fn lint_page(input: &str, output: &str) -> PolishLint {
    let mut diagnostics = Diagnostics::new();
    let introduced_controls = output
        .chars()
        .filter(|character| {
            character.is_control()
                && !matches!(character, '\n' | '\r' | '\t')
                && output.matches(*character).count() > input.matches(*character).count()
        })
        .count();
    if introduced_controls > 0 {
        diagnostics.push_problem(Problem::document(
            ProblemCode::SourceDrift,
            "答案引入了非法控制字符（疑似 UTF-8 乱码）",
        ));
    }
    let normalized = normalize_llm_output(output);
    for warning in normalized.warnings() {
        diagnostics.push_warning(Warning {
            code: warning.code,
            scope: ProblemScope::Document,
            detail: warning.detail,
        });
    }
    if let Some(problem) = guard_output_size(input, &normalized.text) {
        diagnostics.push_problem(Problem::document(problem.code, problem.detail));
    }

    // 载荷侧的栅栏总是我们自己渲染出来的，逐字精确定位即可。
    let input_lines: Vec<&str> = input.lines().collect();
    let input_anchors = locate_fences(&input_lines);
    let expected_before = input_anchors
        .map(|[in_before, in_begin, _, _]| region_signature(&input_lines[in_before + 1..in_begin]));

    let lines: Vec<&str> = normalized.text.lines().collect();
    let recovered = recover_fences(&lines, expected_before.as_deref());
    let Some((regions, recoveries)) = recovered else {
        diagnostics.push_problem(Problem::document(
            ProblemCode::DocumentTruncated,
            "两条编辑栅栏都缺失且无法从只读栅栏推断核心区边界",
        ));
        return PolishLint {
            diagnostics,
            paragraphs: Vec::new(),
            starts_new_paragraph: false,
            fenced: false,
        };
    };
    for note in recoveries {
        diagnostics.push_warning(Warning {
            code: WarningCode::FenceRecovered,
            scope: ProblemScope::Document,
            detail: note,
        });
    }

    let stray_outside = lines[..regions.head].iter().any(|l| !l.trim().is_empty())
        || lines[regions.tail..].iter().any(|l| !l.trim().is_empty());
    if stray_outside {
        diagnostics.push_problem(Problem::document(
            ProblemCode::DocumentWrapped,
            "栅栏之外存在正文以外的内容",
        ));
        diagnostics.push_warning(Warning {
            code: WarningCode::ContentIgnored,
            scope: ProblemScope::Document,
            detail: "已忽略栅栏之外的内容".to_owned(),
        });
    }

    // 只读区漂移一律降级为 advisory（重试策略重设计 §2.2）。
    //
    // 解析只取核心区，输出里的只读区从不写回真相；核心区另有词流真相门
    // （映射覆盖、相似度、跨度）独立把关。旧实现在相似度跌破
    // [`READONLY_DRIFT_MIN_SIMILARITY`] 时整页拒收——实测这条规则拒掉的全部是
    // 「模型顺手修掉只读区里的 ASR 错词」与「只读区被截断」，两者都不影响本页
    // 正文，却在温度 0 下确定性复现，三次重试全灭后整页 fallback。现在只记
    // Warning，阈值只用来区分措辞。
    if let Some([_, _, in_end, in_after]) = input_anchors {
        let zones = [
            (
                expected_before.clone().unwrap_or_default(),
                region_signature(&lines[regions.before.clone()]),
                "只读上文区（CONTEXT-BEFORE）",
            ),
            (
                region_signature(&input_lines[in_end + 1..in_after]),
                region_signature(&lines[regions.after.clone()]),
                "只读下文区（CONTEXT-AFTER）",
            ),
        ];
        for (expected, actual, zone) in zones {
            if expected == actual {
                continue;
            }
            let score = crate::atomize::similarity(&expected, &actual);
            let detail = if score < READONLY_DRIFT_MIN_SIMILARITY {
                format!("{zone}被改写或截断，已忽略（只读区从不写回真相）")
            } else {
                format!("{zone}存在表面级改写，已忽略")
            };
            diagnostics.push_warning(Warning {
                code: WarningCode::ContentIgnored,
                scope: ProblemScope::Document,
                detail,
            });
        }
    }

    let (paragraphs, notes) = parse_core_blocks(&lines[regions.core.clone()]);
    if notes.blank_runs {
        diagnostics.push_warning(Warning {
            code: WarningCode::BlankLinesCollapsed,
            scope: ProblemScope::Document,
            detail: "连续空行已折叠为单个段落边界".to_owned(),
        });
    }
    if notes.marker_residue {
        diagnostics.push_warning(Warning {
            code: WarningCode::MarkerResidue,
            scope: ProblemScope::Document,
            detail: "核心区残留 ⏸/⏹ 软标记，已剥除".to_owned(),
        });
    }
    if notes.structural_ignored {
        diagnostics.push_warning(Warning {
            code: WarningCode::ContentIgnored,
            scope: ProblemScope::Document,
            detail: "核心区内的结构标记行已忽略".to_owned(),
        });
    }
    if notes.punctuation_normalized {
        diagnostics.push_warning(Warning {
            code: WarningCode::PunctuationNormalized,
            scope: ProblemScope::Document,
            detail: "核心区里互相冲突的相邻标点已代码归一（保留表达该边界的那一个）".to_owned(),
        });
    }
    if notes.code_fence {
        diagnostics.push_problem(Problem::document(
            ProblemCode::DocumentWrapped,
            "核心区内残留代码块包裹",
        ));
    }
    let input_core_empty = input_anchors
        .map(|[_, in_begin, in_end, _]| {
            parse_core_blocks(&input_lines[in_begin + 1..in_end])
                .0
                .is_empty()
        })
        .unwrap_or(true);
    if paragraphs.is_empty() && !input_core_empty {
        diagnostics.push_problem(Problem::document(
            ProblemCode::DocumentTruncated,
            "核心区为空",
        ));
    }
    // 表面级瑕疵**不拒页**（重试策略重设计 §2.2）：冲突标点已在
    // [`flush_block`] 里代码归一；粘连 Latin 串与悬垂假句末只记
    // [`WarningCode::SurfaceArtifact`]，引擎映射成句之后把它们送进 `polish-retry`
    // 的句级补做队列。旧实现把这三条挂在 `document-oversize` 名下，一句的表面
    // 瑕疵就拒掉整页并重掷全部句子（实测占 polish 重试的相当一部分）。
    for (index, paragraph) in paragraphs.iter().enumerate() {
        // 中文 ASR 的英文 code-switching 偶尔会整串粘进一个 atom。空格不参与
        // atom-LCS 保真签名，因此模型可以、也应该恢复它。
        if crate::atomize::is_cjk_text(paragraph)
            && crate::seam::contains_likely_collapsed_latin_atom(paragraph, 20)
        {
            diagnostics.push_warning(Warning::paragraph(
                WarningCode::SurfaceArtifact,
                index,
                format!(
                    "corrected Chinese transcript still contains a likely run-together Latin phrase (20+ letters): {paragraph:?}; restore the spoken English word boundaries with spaces without translating or changing meaning"
                ),
            ));
        }
        if crate::seam::contains_dangling_sentence_end(paragraph) {
            diagnostics.push_warning(Warning::paragraph(
                WarningCode::SurfaceArtifact,
                index,
                format!(
                    "corrected text contains a sentence ending at a dangling connector/preposition: {paragraph:?}; remove that false sentence end and join the following clause into a complete thought"
                ),
            ));
        }
    }
    // 单段词数超限（分段退化）**不在这里拦**：润色正文本身有效，整页重试
    // 只会重掷全部句子。主页首轮即接受，退化段落由 `segment-repair` 载体
    // （见 [`parse_segment_repair_page`]）在波次后定向补分段。

    PolishLint {
        diagnostics,
        paragraphs,
        starts_new_paragraph: notes.leading_blank,
        fenced: true,
    }
}

/// 解析模型返回的 polish txt（§6.3 / §6.4）。
///
/// 顺序：[`lint_polish_page`] 的全部字符串级检查 → ⏹ 硬保证。
///
/// 换行语义：单换行是软换行（折成空格，无边界含义），空行是段落边界，
/// 连续 ≥2 个空行折叠成一个并记 [`WarningCode::BlankLinesCollapsed`]。
///
/// `words` 与 `plan` 必须与渲染时完全一致（同一投影、同一计划）：逐字保真判定
/// 直接由词流推出。`input` 是当初实际发给模型的那份渲染文本。
pub fn parse_polish_page(
    words: &[Word],
    plan: &PolishPagePlan,
    input: &str,
    output: &str,
) -> PolishParsed {
    let forced = forced_boundaries(words, plan);
    let core = clamp_range(&plan.core, words.len());

    let lint = lint_page(input, output);
    let mut diagnostics = Diagnostics::new();
    for problem in lint.diagnostics.problems {
        diagnostics.push_problem(Problem {
            scope: rescope(problem.scope, plan),
            ..problem
        });
    }
    for warning in lint.diagnostics.warnings {
        diagnostics.push_warning(Warning {
            scope: rescope(warning.scope, plan),
            ..warning
        });
    }
    if !lint.fenced {
        return PolishParsed {
            paragraphs: Vec::new(),
            forced_boundaries: forced,
            starts_new_paragraph: false,
            diagnostics,
        };
    }
    let mut paragraphs = lint.paragraphs;

    // ⏹ 硬保证：仅在逐字保真时就地落位（非保真交给 M2 rebind）。
    let source_signature = words_signature(&words[core.clone()]);
    let actual_signature = normalize_chars(&paragraphs.join(" "));
    if !source_signature.is_empty() && source_signature == actual_signature {
        let targets: Vec<usize> = forced
            .iter()
            .filter(|index| **index > core.start)
            .map(|index| {
                words[core.start..*index]
                    .iter()
                    .map(|word| normalized_len(&word.text))
                    .sum()
            })
            .filter(|offset| *offset > 0)
            .collect();
        if !targets.is_empty() {
            paragraphs = apply_forced_boundaries(paragraphs, &targets, plan, &mut diagnostics);
        }
    }

    PolishParsed {
        paragraphs,
        forced_boundaries: forced,
        starts_new_paragraph: lint.starts_new_paragraph,
        diagnostics,
    }
}

/// ⏹ 硬保证的边界表：核心区内说话人切换处的绝对词下标。
///
/// 页缝本身就是说话人切换时，该边界归**后一页**所有（段落 id 取段首词），
/// 因此 `core.start` 也会入表；硬切页缝是残句续写，不入表。
///
/// 公开给引擎侧：整页兜底路径没有 [`PolishParsed`] 可取，但仍要落 ⏹ 硬保证。
pub fn forced_boundaries(words: &[Word], plan: &PolishPagePlan) -> Vec<usize> {
    let core = clamp_range(&plan.core, words.len());
    let mut boundaries = Vec::new();
    if core.is_empty() {
        return boundaries;
    }
    if core.start > 0 && !plan.hard_cut_start && words[core.start - 1].sp != words[core.start].sp {
        boundaries.push(core.start);
    }
    for index in core.start..core.end.saturating_sub(1) {
        if words[index].sp != words[index + 1].sp {
            boundaries.push(index + 1);
        }
    }
    boundaries
}

/// 按归一化字符偏移把段落切开，记 [`WarningCode::BoundaryForced`]。
fn apply_forced_boundaries(
    paragraphs: Vec<String>,
    targets: &[usize],
    plan: &PolishPagePlan,
    diagnostics: &mut Diagnostics,
) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    let mut consumed = 0usize;
    for paragraph in paragraphs {
        let length = normalized_len(&paragraph);
        let mut rest = paragraph;
        let mut rest_start = consumed;
        for target in targets
            .iter()
            .copied()
            .filter(|t| *t > consumed && *t < consumed + length)
        {
            let Some(index) = split_index(&rest, target - rest_start) else {
                continue;
            };
            let left = rest[..index].trim_end().to_owned();
            let right = rest[index..].trim_start().to_owned();
            if left.is_empty() || right.is_empty() {
                continue;
            }
            diagnostics.push_warning(Warning {
                code: WarningCode::BoundaryForced,
                scope: ProblemScope::Paragraph {
                    index: result.len(),
                },
                detail: format!("按 ⏹ 说话人切换强制段落边界（页 {}）", plan.id),
            });
            result.push(left);
            rest = right;
            rest_start = target;
        }
        result.push(rest);
        consumed += length;
    }
    result
}

/// 在 `text` 中找到「已消费 `target` 个归一化字符」之后第一个实义字符的字节下标。
fn split_index(text: &str, target: usize) -> Option<usize> {
    let mut consumed = 0usize;
    for (index, ch) in text.char_indices() {
        let mut buffer = [0u8; 4];
        let width = normalized_len(ch.encode_utf8(&mut buffer));
        if consumed == target && width > 0 {
            return Some(index);
        }
        consumed += width;
    }
    None
}

/// 归一化后的字符数（[`normalize_chars`] 会丢弃空白与标点）。
fn normalized_len(text: &str) -> usize {
    normalize_chars(text).chars().count()
}

/// 核心区分段过程中的观察结果。
#[derive(Debug, Default)]
struct CoreNotes {
    blank_runs: bool,
    marker_residue: bool,
    structural_ignored: bool,
    code_fence: bool,
    /// 第一行正文之前有空行（页缝显式「另起一段」信号）。
    leading_blank: bool,
    /// 有段落的冲突相邻标点被代码归一（R2 代码先修）。
    punctuation_normalized: bool,
}

/// 把核心区行序列切成段落：空行分段，单换行折成空格。
///
/// 正文之前的空行不产生段落，只记 [`CoreNotes::leading_blank`]；单个前导
/// 空行不算「连续空行」（它是契约允许的信号，不该记 `BlankLinesCollapsed`）。
fn parse_core_blocks(lines: &[&str]) -> (Vec<String>, CoreNotes) {
    let mut notes = CoreNotes::default();
    let mut blocks: Vec<String> = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    let mut blank_run = 0usize;
    let mut seen_content = false;
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !seen_content {
                notes.leading_blank = true;
                continue;
            }
            blank_run += 1;
            if blank_run >= 2 {
                notes.blank_runs = true;
            }
            flush_block(&mut current, &mut blocks, &mut notes.punctuation_normalized);
            continue;
        }
        blank_run = 0;
        seen_content = true;
        // 结构行一律不进正文：硬切标记，以及**任何**哨兵栅栏行。栅栏恢复
        // （[`recover_fences`]）可能把一条错位/缩进的栅栏留在核心区里，正文
        // 行本身则在渲染期被行首空格中和过，因此这里的判据不会误伤真内容。
        if trimmed == MARKER_HARD_CUT || is_fence_line(line) {
            notes.structural_ignored = true;
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            notes.code_fence = true;
            continue;
        }
        if line.contains(markers::PAUSE_MARKER) || line.contains(markers::SPEAKER_MARKER) {
            notes.marker_residue = true;
        }
        current.push(line);
    }
    flush_block(&mut current, &mut blocks, &mut notes.punctuation_normalized);
    (blocks, notes)
}

/// 收束一个段落：软换行折空格 → 剥标记 → 折叠 CJK 空格 → 冲突标点归一。
///
/// 冲突相邻标点（`。，` / `，。` / `，，` / `..`）是能用代码确定性消解的表面
/// 瑕疵，不再回灌给模型重掷整页（R2 代码先修）。
fn flush_block(current: &mut Vec<&str>, blocks: &mut Vec<String>, normalized: &mut bool) {
    if current.is_empty() {
        return;
    }
    let joined = current.join(" ");
    current.clear();
    let cleaned = markers::sanitize_corrected(&joined).trim().to_owned();
    if cleaned.is_empty() {
        return;
    }
    let repaired = crate::seam::normalize_conflicting_punctuation(&cleaned);
    if repaired != cleaned {
        *normalized = true;
    }
    let repaired = repaired.trim().to_owned();
    if !repaired.is_empty() {
        blocks.push(repaired);
    }
}

/// 定位四条栅栏：每条必须恰好出现一次且顺序正确。
///
/// 整行精确匹配，允许行尾空白（`trim_end`），不允许行首空白。
fn locate_fences(lines: &[&str]) -> Option<[usize; 4]> {
    let mut anchors = [0usize; 4];
    for (slot, fence) in [
        FENCE_CONTEXT_BEFORE,
        FENCE_EDIT_BEGIN,
        FENCE_EDIT_END,
        FENCE_CONTEXT_AFTER,
    ]
    .into_iter()
    .enumerate()
    {
        let hits: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(_, line)| line.trim_end() == fence)
            .map(|(index, _)| index)
            .collect();
        if hits.len() != 1 {
            return None;
        }
        anchors[slot] = hits[0];
    }
    if anchors[0] < anchors[1] && anchors[1] < anchors[2] && anchors[2] < anchors[3] {
        Some(anchors)
    } else {
        None
    }
}

/// 栅栏恢复后的三段行区间（左闭右开，都是 `lines` 上的下标）。
#[derive(Debug, Clone, PartialEq, Eq)]
struct FenceRegions {
    /// 只读上文区。
    before: Range<usize>,
    /// 可编辑核心区。
    core: Range<usize>,
    /// 只读下文区。
    after: Range<usize>,
    /// 栅栏结构的首行（含）：之前的行必须全空白。
    head: usize,
    /// 栅栏结构的末行之后（不含）：之后的行必须全空白。
    tail: usize,
}

/// 某条栅栏在 `lines` 里 `from` 之后的第一次出现。
fn fence_at(lines: &[&str], fence: &str, from: usize) -> Option<usize> {
    lines
        .iter()
        .enumerate()
        .skip(from)
        .find(|(_, line)| line.trim_end() == fence)
        .map(|(index, _)| index)
}

/// 哨兵栅栏恢复（重试策略重设计 §2.2）。
///
/// 实测 7 次「document-truncated 哨兵栅栏缺失」里 5 次只是漏写了
/// `<<<EDIT-END>>>` 而 `<<<CONTEXT-AFTER …>>>` 还在，1 次漏 CONTEXT-AFTER，
/// 1 次漏 EDIT-BEGIN——核心区本身**都是完整的**。整页重试三轮只是在重掷同一份
/// 答案，因此改为先按相邻栅栏推断边界：
///
/// - EDIT-END 缺、CONTEXT-AFTER 在 → 以 CONTEXT-AFTER 为核心区终点，只读下文区
///   视为空；两者都缺 → 核心区一直到文末；
/// - EDIT-BEGIN 缺、CONTEXT-BEFORE 在 → 从 CONTEXT-BEFORE 之后起扫，剥掉与载荷
///   只读上文区归一化相似度 ≥ [`READONLY_DRIFT_MIN_SIMILARITY`] 的前缀；剥不掉
///   才 page-fatal；
/// - CONTEXT-BEFORE 缺、EDIT-BEGIN 在 → 只读上文区取 EDIT-BEGIN 之前的全部行；
/// - 两条 EDIT 栅栏都缺且无从推断 → `None`（page-fatal `document-truncated`）；
/// - 栅栏重复 → 取第一组合法顺序的实例（逐条按前一条之后首见）。
///
/// `expected_before` 是载荷只读上文区的指纹（[`region_signature`] 口径），只在
/// 剥前缀那一支使用；`None` 表示拿不到载荷结构，此时不做前缀剥离。
/// 返回值第二项是恢复动作说明，调用方记 [`WarningCode::FenceRecovered`]。
fn recover_fences(
    lines: &[&str],
    expected_before: Option<&str>,
) -> Option<(FenceRegions, Vec<String>)> {
    if let Some([before_at, begin_at, end_at, after_at]) = locate_fences(lines) {
        return Some((
            FenceRegions {
                before: before_at + 1..begin_at,
                core: begin_at + 1..end_at,
                after: end_at + 1..after_at,
                head: before_at,
                tail: after_at + 1,
            },
            Vec::new(),
        ));
    }
    let mut notes = Vec::new();
    let before_at = fence_at(lines, FENCE_CONTEXT_BEFORE, 0);
    let begin_at = fence_at(lines, FENCE_EDIT_BEGIN, before_at.map_or(0, |at| at + 1));
    let end_at = fence_at(
        lines,
        FENCE_EDIT_END,
        begin_at.or(before_at).map_or(0, |at| at + 1),
    );
    let after_at = fence_at(
        lines,
        FENCE_CONTEXT_AFTER,
        end_at.or(begin_at).or(before_at).map_or(0, |at| at + 1),
    );

    // 核心区起点。
    let (core_start, before) = match begin_at {
        Some(at) => (at + 1, before_at.map_or(0, |b| b + 1)..at),
        None => {
            let before_at = before_at?;
            let limit = end_at.or(after_at).unwrap_or(lines.len());
            if before_at + 1 > limit {
                return None;
            }
            let start = strip_readonly_prefix(lines, before_at + 1, limit, expected_before)?;
            notes.push(format!(
                "缺 `{FENCE_EDIT_BEGIN}`：按 `{FENCE_CONTEXT_BEFORE}` 之后的只读上文区剥离，\
                 核心区从第 {} 行起",
                start + 1
            ));
            (start, before_at + 1..start)
        }
    };
    // 核心区终点与只读下文区。
    let (core_end, after, tail) = match (end_at, after_at) {
        (Some(end), Some(after)) if after > end => (end, end + 1..after, after + 1),
        (Some(end), _) => {
            notes.push(format!(
                "缺 `{FENCE_CONTEXT_AFTER}`：核心区在 `{FENCE_EDIT_END}` 处收尾"
            ));
            (end, end..end, end + 1)
        }
        (None, Some(after)) if after > core_start => {
            notes.push(format!(
                "缺 `{FENCE_EDIT_END}`：以 `{FENCE_CONTEXT_AFTER}` 为核心区终点，\
                 只读下文区按空处理"
            ));
            (after, after..after, after + 1)
        }
        (None, _) => {
            if begin_at.is_none() {
                // 两条 EDIT 栅栏都缺，且上面那支也没能剥出起点。
                return None;
            }
            notes.push(format!(
                "缺 `{FENCE_EDIT_END}` 与 `{FENCE_CONTEXT_AFTER}`：核心区取到文末"
            ));
            (lines.len(), lines.len()..lines.len(), lines.len())
        }
    };
    if core_start > core_end {
        return None;
    }
    // 恢复路径下核心区两端可能夹着一条缩进/错位的栅栏行：收紧边界，别让它
    // 变成一段正文。
    let mut core_start = core_start;
    let mut core_end = core_end;
    while core_start < core_end && is_loose_fence_line(lines[core_start]) {
        core_start += 1;
    }
    while core_end > core_start && is_loose_fence_line(lines[core_end - 1]) {
        core_end -= 1;
    }
    if begin_at.is_some() && before_at.is_none() {
        notes.push(format!(
            "缺 `{FENCE_CONTEXT_BEFORE}`：`{FENCE_EDIT_BEGIN}` 之前的行按只读上文区处理"
        ));
    }
    Some((
        FenceRegions {
            before,
            core: core_start..core_end,
            after,
            head: before_at.or(begin_at).unwrap_or(0),
            tail,
        },
        notes,
    ))
}

/// 缺 `EDIT-BEGIN` 时的前缀剥离：在 `[from, limit)` 里找第一个 `k`，使
/// `lines[from..k]` 的指纹与载荷只读上文区相似度 ≥
/// [`READONLY_DRIFT_MIN_SIMILARITY`]。找不到即无法推断核心区起点。
fn strip_readonly_prefix(
    lines: &[&str],
    from: usize,
    limit: usize,
    expected_before: Option<&str>,
) -> Option<usize> {
    let expected = expected_before?;
    if expected.is_empty() {
        // 首页没有只读上文区：CONTEXT-BEFORE 之后立刻就是核心区。
        return Some(from);
    }
    let mut best: Option<(usize, f64)> = None;
    for k in from..=limit {
        let score = crate::atomize::similarity(expected, &region_signature(&lines[from..k]));
        if score >= READONLY_DRIFT_MIN_SIMILARITY && best.is_none_or(|(_, seen)| score > seen) {
            best = Some((k, score));
        }
    }
    best.map(|(k, _)| k)
}

/// 只读区指纹：剔除结构行 → 剥标记 → 归一化字符。
fn region_signature(lines: &[&str]) -> String {
    let joined = lines
        .iter()
        .filter(|line| !is_structural_line(line))
        .copied()
        .collect::<Vec<_>>()
        .join(" ");
    normalize_chars(&markers::strip_markers(&joined))
}

/// 词流侧的同口径指纹（用于只读区漂移与逐字保真判定）。
fn words_signature(words: &[Word]) -> String {
    normalize_chars(&markers::strip_markers(&markers::marked_text(words)))
}

/// 是否为四条哨兵栅栏之一（与 [`locate_fences`] 同口径：允许行尾空白，
/// **不允许行首空白**——渲染期正是靠行首补一个空格中和正文里的假栅栏）。
fn is_fence_line(line: &str) -> bool {
    matches!(
        line.trim_end(),
        FENCE_CONTEXT_BEFORE | FENCE_EDIT_BEGIN | FENCE_EDIT_END | FENCE_CONTEXT_AFTER
    )
}

/// 宽松栅栏判据：两端都 trim。只用于[`recover_fences`]收紧核心区边界——
/// 恢复路径下一条缩进/错位的栅栏行不该被当成正文。
fn is_loose_fence_line(line: &str) -> bool {
    matches!(
        line.trim(),
        FENCE_CONTEXT_BEFORE | FENCE_EDIT_BEGIN | FENCE_EDIT_END | FENCE_CONTEXT_AFTER
    )
}

/// 是否为结构行（硬切标记 / 哨兵栅栏 / 代码块围栏），不参与漂移比对。
fn is_structural_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed == MARKER_HARD_CUT
        || is_loose_fence_line(line)
        || trimmed.starts_with("```")
        || trimmed.starts_with("~~~")
}

/// 把一段区间渲染成若干正文块（说话人切换与人工段钉处分段）。
///
/// 段落聚合天然不跨轮次：每个说话人切换都在这里切成独立的正文块，页面上
/// 表现为一个空行段落边界，[`forced_boundaries`] 再无条件为它兜底。
fn render_region(
    words: &[Word],
    range: &Range<usize>,
    para_starts: &[usize],
    labels: Option<&SpeakerLabels>,
) -> Vec<String> {
    let mut blocks = Vec::new();
    for segment in segments(words, range, para_starts) {
        let mut text = markers::marked_text_labeled(&words[segment.clone()], labels);
        if segment.end < range.end {
            text.push_str(&markers::boundary_marker_suffix_labeled(
                &words[segment.end - 1],
                &words[segment.end],
                labels,
            ));
        }
        let line = sanitize_inline_text(&text);
        if markers::sanitize_corrected(&line).trim().is_empty() {
            continue;
        }
        blocks.push(line);
    }
    blocks
}

/// 区间内的分段点：说话人切换 + 人工段钉。
fn segments(words: &[Word], range: &Range<usize>, para_starts: &[usize]) -> Vec<Range<usize>> {
    let mut output = Vec::new();
    if range.start >= range.end {
        return output;
    }
    let mut start = range.start;
    for index in range.start..range.end - 1 {
        let boundary = words[index].sp != words[index + 1].sp || para_starts.contains(&(index + 1));
        if boundary {
            output.push(start..index + 1);
            start = index + 1;
        }
    }
    output.push(start..range.end);
    output
}

/// 追加正文块：块间留一个空行，哨兵前缀中和。
fn push_blocks(
    lines: &mut Vec<String>,
    blocks: Vec<String>,
    page: &str,
    warnings: &mut Vec<Warning>,
) {
    for (index, block) in blocks.into_iter().enumerate() {
        if index > 0 {
            lines.push(String::new());
        }
        if block.trim_start().starts_with(SENTINEL_PREFIX) {
            warnings.push(Warning {
                code: WarningCode::SentinelNeutralized,
                scope: ProblemScope::Page {
                    id: page.to_owned(),
                },
                detail: format!("正文行以 `{SENTINEL_PREFIX}` 开头，已在行首补空格中和"),
            });
            lines.push(format!(" {block}"));
        } else {
            lines.push(block);
        }
    }
}

/// 把区间夹到词流长度内（防御外部传入的陈旧计划）。
fn clamp_range(range: &Range<usize>, len: usize) -> Range<usize> {
    let start = range.start.min(len);
    let end = range.end.clamp(start, len);
    start..end
}

/// 把 [`lint_polish_page`] 的文档级作用域改写成页作用域；其余作用域原样保留。
fn rescope(scope: ProblemScope, plan: &PolishPagePlan) -> ProblemScope {
    match scope {
        ProblemScope::Document => ProblemScope::Page {
            id: plan.id.clone(),
        },
        other => other,
    }
}

// ---------------------------------------------------------------------------
// segment-repair 载体（kind = "segment-repair"）
// ---------------------------------------------------------------------------
//
// 定向补分段 / 页缝判定的**索引契约**载体（kind = "segment-repair" /
// "seam-repair"）：主 polish 页首轮即接受正文，波次后把仍超
// [`paragraph_word_limit`] 的段落（或页缝两侧的窗口）凑到一起、按词数预算
// 二次分页。载荷仍是纯文本：每块一对栅栏，栅栏内**一句一行且带行号**
// （`12| 句子`）；块头栅栏写明句数、词数与最少段数。答案**不再复述正文**，
// 每块只回若干 `a-b` 行号区间（一行一个段落），必须从 1 开始、首尾相接、
// 覆盖到最后一行。这样验收是纯算术：区间不连续/不覆盖 ⇒ `range-invalid`；
// 单区间盖住整块且整块超限 ⇒ `paragraph-oversize`。改写正文这一类幻觉在
// 索引契约里没有落脚点（模型顺手改一个字的旧载体 source-drift 占补分段
// 失败的四分之一，而答案文本本就只用来定位边界，从不回写）。答案里若仍
// 复述了带行号的句行（`12| …`），按空行分组也能被接受——只认行号。

/// 索引契约块头栅栏前缀：`<<<BLOCK 1 | 63 sentences | 1832 characters | at least 4 paragraphs>>>`。
pub const FENCE_BLOCK_PREFIX: &str = "<<<BLOCK";
/// 索引契约块尾栅栏行。
pub const FENCE_BLOCK_END: &str = "<<<BLOCK-END>>>";

/// 一块的最少段数：`ceil(词数 / 单段上限)`，至少 1。
pub fn block_min_paragraphs(lines: &[String]) -> usize {
    let text = lines.join(" ");
    let count = word_count(&text);
    let limit = paragraph_word_limit(&text).max(1);
    count.div_ceil(limit).max(1)
}

/// 渲染一块索引契约载荷：块头 `<<<BLOCK k | n sentences | c words|characters[ | extra]>>>`，
/// 栅栏内每句一行、行首 `N| `（1 起），块尾 `<<<BLOCK-END>>>`。
///
/// 行内换行折成空格（软换行语义）。行号前缀天然中和了 `<<<` 哨兵，无需
/// 再补空格。
fn render_index_block(index: usize, lines: &[String], extra: &str) -> String {
    let text = lines.join(" ");
    let count = word_count(&text);
    let unit = if is_cjk_text(&text) {
        "characters"
    } else {
        "words"
    };
    let mut out = Vec::with_capacity(lines.len() + 2);
    let mut header = format!(
        "{FENCE_BLOCK_PREFIX} {} | {} sentences | {count} {unit}",
        index + 1,
        lines.len()
    );
    if !extra.is_empty() {
        header.push_str(" | ");
        header.push_str(extra);
    }
    header.push_str(">>>");
    out.push(header);
    for (offset, line) in lines.iter().enumerate() {
        let flat = line.split_whitespace().collect::<Vec<_>>().join(" ");
        out.push(format!("{}| {flat}", offset + 1));
    }
    out.push(FENCE_BLOCK_END.to_owned());
    out.join("\n")
}

/// 渲染 segment-repair 载荷：每个超限段落一块，块头额外写明最少段数
/// （`at least N paragraphs`，见 [`block_min_paragraphs`]）；块之间空一行。
pub fn render_segment_repair_page(paragraphs: &[Vec<String>]) -> String {
    let mut blocks = Vec::with_capacity(paragraphs.len());
    for (index, lines) in paragraphs.iter().enumerate() {
        let need = block_min_paragraphs(lines);
        blocks.push(render_index_block(
            index,
            lines,
            &format!("at least {need} paragraphs"),
        ));
    }
    let mut text = blocks.join("\n\n");
    text.push('\n');
    text
}

/// 渲染 seam-repair 载荷：每个页缝窗口一块，块头额外写明页缝位置
/// （`page seam before line N`，多个页缝逗号分隔；`seams` 是块内 0 起的句行
/// 偏移，即页 k+1 首句所在行）；不写最少段数——整块同段是合法答案。
pub fn render_seam_repair_page(blocks: &[(Vec<String>, Vec<usize>)]) -> String {
    let mut rendered = Vec::with_capacity(blocks.len());
    for (index, (lines, seams)) in blocks.iter().enumerate() {
        let positions: Vec<String> = seams
            .iter()
            .map(|offset| (offset + 1).to_string())
            .collect();
        let extra = if positions.len() == 1 {
            format!("page seam before line {}", positions[0])
        } else {
            format!("page seams before lines {}", positions.join(", "))
        };
        rendered.push(render_index_block(index, lines, &extra));
    }
    let mut text = rendered.join("\n\n");
    text.push('\n');
    text
}

/// [`parse_segment_repair_page`] 的结果：诊断 + 逐块分组方案。
#[derive(Debug)]
pub struct SegmentRepairParsed {
    /// 字符串级诊断。problems 逐块定位（`ProblemScope::Paragraph`，index 为
    /// 载荷内块序），只挡住对应块；文档级 problem（体积护栏）挡住整份答案。
    pub diagnostics: Diagnostics,
    /// 与 payload 块一一对应：`Some(groups)` = 该块验收通过，按答案区间切出
    /// 的组，每组元素是该块句行的下标（0 起，连续递增，合起来恰好覆盖全块）；
    /// `None` = 该块被拒（区间非法/缺块/整块一段且超限）。
    pub paragraphs: Vec<Option<Vec<Vec<usize>>>>,
}

/// 块头栅栏：返回块序号（1 起）。接受 `<<<BLOCK 3 | …>>>`、`<<<BLOCK 3>>>`、
/// `BLOCK 3`（模型丢了尖括号）；`<<<BLOCK-END>>>` 不算块头。
fn block_header_index(line: &str) -> Option<usize> {
    let trimmed = line.trim();
    let body = trimmed.strip_prefix("<<<").unwrap_or(trimmed).trim_start();
    if body.len() < 5 || !body.is_char_boundary(5) || !body[..5].eq_ignore_ascii_case("block") {
        return None;
    }
    let rest = body[5..].trim_start();
    if rest.starts_with('-') {
        return None;
    }
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

/// 是否块尾栅栏（容忍丢尖括号）。
fn is_block_end(line: &str) -> bool {
    let trimmed = line.trim();
    let body = trimmed.strip_prefix("<<<").unwrap_or(trimmed);
    let body = body.strip_suffix(">>>").unwrap_or(body);
    body.trim().eq_ignore_ascii_case("BLOCK-END")
}

/// 带行号的句行 `12| 句子` → `(12, "句子")`。
fn numbered_line(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim();
    let digits_end = trimmed
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit())
        .map(|(i, _)| i)
        .unwrap_or(trimmed.len());
    if digits_end == 0 {
        return None;
    }
    let rest = trimmed[digits_end..].trim_start();
    let rest = rest.strip_prefix('|')?;
    Some((trimmed[..digits_end].parse().ok()?, rest.trim()))
}

/// payload 侧：按块头/块尾栅栏切出各块的句行（去掉行号、trim 后、非空）。
fn segment_repair_payload_paragraphs(payload: &str) -> Vec<Vec<&str>> {
    let mut paragraphs: Vec<Vec<&str>> = Vec::new();
    let mut current: Option<Vec<&str>> = None;
    for line in payload.lines() {
        if block_header_index(line).is_some() {
            if let Some(lines) = current.take() {
                paragraphs.push(lines);
            }
            current = Some(Vec::new());
        } else if is_block_end(line) {
            if let Some(lines) = current.take() {
                paragraphs.push(lines);
            }
        } else if let Some((_, text)) = numbered_line(line) {
            current.get_or_insert_with(Vec::new).push(text);
        } else if !line.trim().is_empty() {
            current.get_or_insert_with(Vec::new).push(line.trim());
        }
    }
    if let Some(lines) = current {
        paragraphs.push(lines);
    }
    paragraphs
}

/// 一行答案里的区间：`1-14`、`15 – 30`、`31~40`、单个 `41`；一行可写多个
/// （逗号/分号/空格分隔）。出现任何数字、分隔符、连字符之外的字符 ⇒ 整行
/// 不是区间行（返回 None），由调用方忽略。
fn parse_range_line(line: &str) -> Option<Vec<(usize, usize)>> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Tok {
        Num(usize),
        Dash,
    }
    let mut toks: Vec<Tok> = Vec::new();
    let mut digits = String::new();
    for c in line.trim().chars() {
        if c.is_ascii_digit() {
            digits.push(c);
            continue;
        }
        if !digits.is_empty() {
            toks.push(Tok::Num(digits.parse().ok()?));
            digits.clear();
        }
        match c {
            '-' | '–' | '—' | '~' => toks.push(Tok::Dash),
            ',' | ';' | ' ' | '\t' | '，' | '；' | '、' => {}
            _ => return None,
        }
    }
    if !digits.is_empty() {
        toks.push(Tok::Num(digits.parse().ok()?));
    }
    let mut ranges = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let Tok::Num(a) = toks[i] else {
            return None;
        };
        if i + 2 < toks.len()
            && toks[i + 1] == Tok::Dash
            && let Tok::Num(b) = toks[i + 2]
        {
            ranges.push((a, b));
            i += 3;
            continue;
        }
        ranges.push((a, a));
        i += 1;
    }
    Some(ranges)
}

/// 答案里某一块正文的两种可接受形态：区间行，或复述的带行号句行（按空行
/// 分组，只认行号）。返回 (区间列表, 是否解析到任何内容)。
fn parse_block_answer(lines: &[&str]) -> Vec<(usize, usize)> {
    // 形态二：带行号句行。
    let numbered: Vec<Option<usize>> = lines
        .iter()
        .map(|line| numbered_line(line).map(|(n, _)| n))
        .collect();
    if numbered.iter().any(Option::is_some) {
        let mut ranges: Vec<(usize, usize)> = Vec::new();
        let mut open: Option<(usize, usize)> = None;
        for (line, number) in lines.iter().zip(&numbered) {
            match number {
                Some(n) => match open {
                    Some((a, b)) if b + 1 == *n => open = Some((a, *n)),
                    Some(range) => {
                        ranges.push(range);
                        open = Some((*n, *n));
                    }
                    None => open = Some((*n, *n)),
                },
                None if line.trim().is_empty() => {
                    if let Some(range) = open.take() {
                        ranges.push(range);
                    }
                }
                None => {}
            }
        }
        if let Some(range) = open {
            ranges.push(range);
        }
        return ranges;
    }
    // 形态一：区间行。
    let mut ranges = Vec::new();
    for line in lines {
        if let Some(mut found) = parse_range_line(line) {
            ranges.append(&mut found);
        }
    }
    ranges
}

/// 区间序列是否从 1 开始、首尾相接、覆盖到 `total`。返回首个缺陷说明。
fn validate_ranges(ranges: &[(usize, usize)], total: usize) -> Result<(), String> {
    if ranges.is_empty() {
        return Err("没有解析到任何 `a-b` 行号区间".to_owned());
    }
    let mut expected = 1usize;
    for &(a, b) in ranges {
        if a > b {
            return Err(format!("区间 {a}-{b} 起点大于终点"));
        }
        if a != expected {
            return Err(if a > expected {
                format!("第 {expected} 行没有被任何区间覆盖（下一个区间从 {a} 开始）")
            } else {
                format!(
                    "区间 {a}-{b} 与前一个区间重叠（前一个区间到 {} 结束）",
                    expected - 1
                )
            });
        }
        expected = b + 1;
    }
    if expected != total + 1 {
        return Err(if expected <= total {
            format!("第 {expected}–{total} 行没有被任何区间覆盖")
        } else {
            format!(
                "区间越界：块只有 {total} 行，区间却到 {} 结束",
                expected - 1
            )
        });
    }
    Ok(())
}

/// 解析并逐块校验索引契约答案（字符串级，agent 镜像 lint 复用同一实现）。
///
/// 判据全部只靠 payload/answer 两份文本。答案按 `<<<BLOCK k>>>` /
/// `<<<BLOCK-END>>>` 切成各块（块头丢了尖括号也认；载荷只有一块而答案没写
/// 块头时整份答案就是第 1 块）；每块正文解析成 `a-b` 区间序列（也接受复述的
/// 带行号句行按空行分组）：
///
/// - 缺块 / 没有区间 / 区间不从 1 开始、不首尾相接、不覆盖到末行 / 越界 ⇒
///   该块 [`ProblemCode::RangeInvalid`]（detail 定位首个缺陷），
///   `paragraphs[i] = None`；
/// - 区间合法但只有一个且整块超 [`paragraph_word_limit`] ⇒ 该块
///   [`ProblemCode::ParagraphOversize`]（detail 即定向重试指令，含最少段数），
///   `paragraphs[i] = None`；页缝块由引擎把它当"整块同段"接受；
/// - 区间合法且 ≥2 个（或整块本就不超限）⇒ 该块通过，`paragraphs[i] =
///   Some(groups)`。切出的组若仍超限，**不在这里判罪**——引擎按溢出幅度决定
///   确定性补切还是下一轮再问（见 `engines::polish::segment_repair_wave`）。
///
/// 体积护栏（[`guard_output_size`]）是唯一的文档级 problem，命中即全块拒收。
pub fn parse_segment_repair_page(payload: &str, answer: &str) -> SegmentRepairParsed {
    let mut diagnostics = Diagnostics::new();
    let source = segment_repair_payload_paragraphs(payload);
    let normalized = normalize_llm_output(answer);
    for warning in normalized.warnings() {
        diagnostics.push_warning(Warning {
            code: warning.code,
            scope: ProblemScope::Document,
            detail: warning.detail,
        });
    }
    if let Some(problem) = guard_output_size(payload, &normalized.text) {
        diagnostics.push_problem(Problem::document(problem.code, problem.detail));
        return SegmentRepairParsed {
            diagnostics,
            paragraphs: vec![None; source.len()],
        };
    }

    // 答案侧：按块头切段；块头之前的行归入"无块头"桶。
    let mut sections: std::collections::BTreeMap<usize, Vec<&str>> =
        std::collections::BTreeMap::new();
    let mut unlabeled: Vec<&str> = Vec::new();
    let mut current: Option<usize> = None;
    for line in normalized.text.lines() {
        if let Some(index) = block_header_index(line) {
            current = Some(index);
            sections.entry(index).or_default();
            continue;
        }
        if is_block_end(line) {
            current = None;
            continue;
        }
        match current {
            Some(index) => sections.entry(index).or_default().push(line),
            None => unlabeled.push(line),
        }
    }
    if sections.is_empty() && source.len() == 1 {
        sections.insert(1, unlabeled);
    }

    let mut paragraphs: Vec<Option<Vec<Vec<usize>>>> = Vec::with_capacity(source.len());
    for (index, lines) in source.iter().enumerate() {
        let Some(section) = sections.get(&(index + 1)) else {
            diagnostics.push_problem(Problem {
                code: ProblemCode::RangeInvalid,
                scope: ProblemScope::Paragraph { index },
                detail: format!(
                    "第 {} 块缺失：每个块都要回复 `{FENCE_BLOCK_PREFIX} {}>>>` … `{FENCE_BLOCK_END}`，\
                     栅栏内一行一个 `a-b` 行号区间",
                    index + 1,
                    index + 1
                ),
            });
            paragraphs.push(None);
            continue;
        };
        let ranges = parse_block_answer(section);
        if let Err(defect) = validate_ranges(&ranges, lines.len()) {
            diagnostics.push_problem(Problem {
                code: ProblemCode::RangeInvalid,
                scope: ProblemScope::Paragraph { index },
                detail: format!(
                    "第 {} 块区间非法：{defect}。区间必须从 1 开始、首尾相接、到 {} 结束，\
                     一行一个 `a-b`",
                    index + 1,
                    lines.len()
                ),
            });
            paragraphs.push(None);
            continue;
        }
        let text = lines.join(" ");
        let count = word_count(&text);
        let limit = paragraph_word_limit(&text);
        if ranges.len() < 2 && count > limit {
            let need = count.div_ceil(limit.max(1)).max(2);
            diagnostics.push_problem(Problem {
                code: ProblemCode::ParagraphOversize,
                scope: ProblemScope::Paragraph { index },
                detail: format!(
                    "第 {} 块只回了一个区间，仍是 {count} 词的一整段（单段上限 {limit}）：\
                     至少拆成 {need} 个区间，在每个话题/语义转折处断开（口语段落通常 2–6 句）",
                    index + 1
                ),
            });
            paragraphs.push(None);
            continue;
        }
        paragraphs.push(Some(
            ranges
                .iter()
                .map(|&(a, b)| ((a - 1)..b).collect())
                .collect(),
        ));
    }

    SegmentRepairParsed {
        diagnostics,
        paragraphs,
    }
}

// ---------------------------------------------------------------------------
// punct-repair 载体（kind = "punct-repair"）
// ---------------------------------------------------------------------------
//
// 定向补标点：主 polish 页首轮即接受正文，波次后把**所有页**里仍超过单句
// 跨度上限的映射句（模型没在语义完结处加句末标点，一句吞掉上千源字符）凑到
// 一起、二次分页，只要求「加句末标点」。载体仍是纯文本：payload 里每个超长
// 句夹在一对**带 id 的**栅栏之间（`<<<SENTENCE-BEGIN id=s01 min-sentences=4>>>`
// / `<<<SENTENCE-END id=s01>>>`），句与句之间互相隔离；答案按 id 定位，逐句
// 验收：词序列（[`crate::atomize::atom_key`] 口径，纯标点 atom 不计）必须与
// 载荷完全恒等，且至少新增一个句内句末标点。一句被改写不连累同载荷的其他句。

/// punct-repair 载荷里每句起始栅栏的前缀（整行形如
/// `<<<SENTENCE-BEGIN id=s01 min-sentences=4>>>`）。
pub const FENCE_SENTENCE_BEGIN_PREFIX: &str = "<<<SENTENCE-BEGIN";
/// punct-repair 载荷里每句结束栅栏的前缀（整行形如 `<<<SENTENCE-END id=s01>>>`）。
pub const FENCE_SENTENCE_END_PREFIX: &str = "<<<SENTENCE-END";

/// punct-repair 载荷里的一句。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PunctRepairItem {
    /// 载荷内 id（`s01` 起），答案按它定位。
    pub id: String,
    /// 句子文本（最终口径文本，可含引擎按源停顿投影插入的 ⏸ 提示）。
    pub text: String,
    /// 该句至少应切成几句（提示值，只进栅栏属性；验收只要求 ≥ 2）。
    pub min_sentences: usize,
}

/// 渲染 punct-repair 载荷：每句一对带 id 的栅栏行，句块之间空一行。
///
/// 句内换行折成空格（软换行语义），以 `<<<` 开头的句行行首补空格中和。
pub fn render_punct_repair_page(items: &[PunctRepairItem]) -> String {
    let mut blocks = Vec::with_capacity(items.len());
    for item in items {
        let flat = item.text.split_whitespace().collect::<Vec<_>>().join(" ");
        let body = if flat.starts_with(SENTINEL_PREFIX) {
            format!(" {flat}")
        } else {
            flat
        };
        blocks.push(format!(
            "{FENCE_SENTENCE_BEGIN_PREFIX} id={} min-sentences={}>>>\n{body}\n{FENCE_SENTENCE_END_PREFIX} id={}>>>",
            item.id, item.min_sentences, item.id
        ));
    }
    let mut text = blocks.join("\n\n");
    text.push('\n');
    text
}

/// [`parse_punct_repair_page`] 的结果：诊断 + 逐句验收文本。
#[derive(Debug)]
pub struct PunctRepairParsed {
    /// 字符串级诊断。problems 逐句定位（`ProblemScope::Sentence { id }`），只
    /// 挡住对应句；文档级 problem（体积护栏）挡住整份答案。
    pub diagnostics: Diagnostics,
    /// 与 payload 句一一对应：`Some(text)` = 该句验收通过，值是剥掉标记、
    /// 折叠软换行后的答案文本（引擎再按句末标点切开并回映射）；`None` = 该句
    /// 被拒（缺失 / 词被改写 / 一个句末标点都没加 / 标点冲突或假句末）。
    pub sentences: Vec<Option<String>>,
}

/// 从栅栏行里取 `id=` 属性；栅栏行形如 `<<<SENTENCE-BEGIN id=s01 …>>>`。
/// 属性容错：`id=s01` / `id="s01"` / 只写裸 `s01` 都认。
fn fence_id(line: &str, prefix: &str) -> Option<String> {
    let trimmed = line.trim();
    let rest = trimmed.strip_prefix(prefix)?;
    let rest = rest.strip_suffix(">>>").unwrap_or(rest);
    for token in rest.split_whitespace() {
        let token = token.trim_matches(|ch| ch == '"' || ch == '\'' || ch == ',');
        if let Some(value) = token.strip_prefix("id=") {
            return Some(value.trim_matches(|ch| ch == '"' || ch == '\'').to_owned());
        }
    }
    // 没有 `id=`：把第一个不含 `=` 的 token 当 id（`<<<SENTENCE-END s01>>>`）。
    let bare = rest
        .split_whitespace()
        .find(|token| !token.contains('='))
        .map(str::to_owned);
    bare.or_else(|| Some(String::new()))
}

/// 按栅栏切出 `(id, 句文本)`；答案侧与载荷侧同一解析器。栅栏外的正文
/// 一律忽略（答案里的寒暄/说明不构成拒收理由——正文验收足够严）。
fn punct_repair_blocks(text: &str) -> Vec<(String, String)> {
    let mut blocks: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, Vec<String>)> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(FENCE_SENTENCE_BEGIN_PREFIX) {
            if let Some((id, lines)) = current.take() {
                blocks.push((id, lines.join(" ")));
            }
            let id = fence_id(trimmed, FENCE_SENTENCE_BEGIN_PREFIX).unwrap_or_default();
            current = Some((id, Vec::new()));
        } else if trimmed.starts_with(FENCE_SENTENCE_END_PREFIX) {
            if let Some((mut id, lines)) = current.take() {
                if id.is_empty()
                    && let Some(end_id) = fence_id(trimmed, FENCE_SENTENCE_END_PREFIX)
                {
                    id = end_id;
                }
                blocks.push((id, lines.join(" ")));
            }
        } else if let Some((_, lines)) = current.as_mut()
            && !trimmed.is_empty()
        {
            lines.push(trimmed.to_owned());
        }
    }
    if let Some((id, lines)) = current {
        blocks.push((id, lines.join(" ")));
    }
    blocks
}

/// 词序列签名：剥标记后 atom 化，纯标点 atom 丢弃，其余按 [`atom_key`]
/// 归一化。标点增删替换都不改变签名；改词、增删词、拆合 Latin 词都会改变。
/// 韩文按音节计键：补空格、改空格不改变签名。
fn lexical_keys(text: &str) -> Vec<String> {
    crate::atomize::atomize_syllables(&markers::strip_markers(text))
        .iter()
        .filter_map(|atom| crate::atomize::atom_key(atom))
        .collect()
}

/// 句内句末标点个数（末尾 atom 的句末不计：那只是整句自身的收尾）。
fn internal_sentence_ends(text: &str) -> usize {
    let atoms = crate::atomize::atomize_syllables(text);
    let last = atoms.len().saturating_sub(1);
    atoms
        .iter()
        .enumerate()
        .filter(|(index, atom)| *index < last && sentence_end(atom))
        .count()
}

/// 解析并逐句校验 punct-repair 答案（字符串级，agent 镜像 lint 复用同一实现）。
///
/// 判据全部只靠 payload/answer 两份文本，agent 侧就是完整校验；引擎侧只多做
/// 「按句末标点切开 + LCS 回映射 + 子句是否仍超限」——那不拒句，只决定是否
/// 进下一轮。逐句：
///
/// - 答案里找不到该 id 的栅栏块（或块为空）→ [`ProblemCode::MissingId`]；
/// - 词序列签名与载荷不同 → [`ProblemCode::SourceDrift`]（detail 定位首个被
///   改写/增删的词）；
/// - 词恒等但一个句内句末标点都没加 → [`ProblemCode::SentenceOversize`]
///   （detail 即定向重试指令）；
/// - 出现互相冲突的相邻标点（`。，`/`，。`）→ 代码归一（R2），只记
///   [`WarningCode::PunctuationNormalized`]，不拒句；
/// - 悬垂假句末（`当。`）→ [`ProblemCode::SurfaceArtifact`]（与主 polish 的
///   表面级判据同口径）。
///
/// 体积护栏（[`guard_output_size`]）是唯一的文档级 problem，命中即全句拒收。
pub fn parse_punct_repair_page(payload: &str, answer: &str) -> PunctRepairParsed {
    let mut diagnostics = Diagnostics::new();
    let source = punct_repair_blocks(payload);
    let normalized = normalize_llm_output(answer);
    for warning in normalized.warnings() {
        diagnostics.push_warning(Warning {
            code: warning.code,
            scope: ProblemScope::Document,
            detail: warning.detail,
        });
    }
    if let Some(problem) = guard_output_size(payload, &normalized.text) {
        diagnostics.push_problem(Problem::document(problem.code, problem.detail));
        return PunctRepairParsed {
            diagnostics,
            sentences: vec![None; source.len()],
        };
    }
    let mut got: Vec<(String, String, bool)> = punct_repair_blocks(&normalized.text)
        .into_iter()
        .map(|(id, text)| (id, text, false))
        .collect();
    let mut sentences: Vec<Option<String>> = Vec::with_capacity(source.len());
    for (position, (id, expected)) in source.iter().enumerate() {
        let scope = ProblemScope::Sentence { id: id.clone() };
        // 先按 id 找；答案丢了 id 但块数一致时按位置容错。
        let slot = got
            .iter()
            .position(|(got_id, _, taken)| !taken && got_id == id)
            .or_else(|| {
                (got.len() == source.len() && got[position].0.is_empty() && !got[position].2)
                    .then_some(position)
            });
        let Some(slot) = slot else {
            diagnostics.push_problem(Problem {
                code: ProblemCode::MissingId,
                scope,
                detail: format!(
                    "句 {id} 缺失：答案里没有 `{FENCE_SENTENCE_BEGIN_PREFIX} id={id}>>>` … \
                     `{FENCE_SENTENCE_END_PREFIX} id={id}>>>` 栅栏块；每句都必须带自己的 id \
                     栅栏原样复述"
                ),
            });
            sentences.push(None);
            continue;
        };
        got[slot].2 = true;
        // R2 代码先修：冲突相邻标点先归一，再验收。旧实现把它挂在
        // `document-oversize` 名下逐句拒收，模型下一轮往往只是重掷同一个答案。
        let sanitized = markers::sanitize_corrected(&got[slot].1);
        let text = crate::seam::normalize_conflicting_punctuation(&sanitized);
        if text != sanitized {
            diagnostics.push_warning(Warning {
                code: WarningCode::PunctuationNormalized,
                scope: scope.clone(),
                detail: format!("句 {id} 的冲突相邻标点已代码归一"),
            });
        }
        if text.split_whitespace().next().is_none() {
            diagnostics.push_problem(Problem {
                code: ProblemCode::MissingId,
                scope,
                detail: format!("句 {id} 的栅栏块为空：必须原样复述整句并加上句末标点"),
            });
            sentences.push(None);
            continue;
        }
        let expected_keys = lexical_keys(expected);
        let got_keys = lexical_keys(&text);
        if expected_keys != got_keys {
            diagnostics.push_problem(Problem {
                code: ProblemCode::SourceDrift,
                scope,
                detail: punct_repair_drift_detail(id, &expected_keys, &got_keys),
            });
            sentences.push(None);
            continue;
        }
        if internal_sentence_ends(&text) == 0 {
            let units = word_count(&text);
            let limit = paragraph_word_limit(&text);
            diagnostics.push_problem(Problem {
                code: ProblemCode::SentenceOversize,
                scope,
                detail: format!(
                    "句 {id} 未新增任何句末标点，仍是 {units} 个显示单位的一整句（单句上限 \
                     {limit}）：在每个语义完结处加句号/问号/叹号（`。？！` / `.?!`），把它切成\
                     多句；除标点外不得改动、增删任何词"
                ),
            });
            sentences.push(None);
            continue;
        }
        if crate::seam::contains_dangling_sentence_end(&text) {
            diagnostics.push_problem(Problem {
                code: ProblemCode::SurfaceArtifact,
                scope,
                detail: format!(
                    "句 {id} 有句子结束在悬垂连接词/介词上（如 `当。`、`让。`、`because.`）：\
                     去掉那个假句末，把后面的小句并入，只在完整表达结束处收句"
                ),
            });
            sentences.push(None);
            continue;
        }
        sentences.push(Some(text));
    }
    PunctRepairParsed {
        diagnostics,
        sentences,
    }
}

/// 词序列签名不一致时的定位说明：报出首个不一致的词位置与两侧词形。
fn punct_repair_drift_detail(id: &str, expected: &[String], got: &[String]) -> String {
    let first = expected
        .iter()
        .zip(got)
        .position(|(left, right)| left != right)
        .unwrap_or(expected.len().min(got.len()));
    let show = |keys: &[String]| -> String {
        let lo = first.saturating_sub(2);
        let hi = (first + 3).min(keys.len());
        keys[lo..hi].join(" ")
    };
    if expected.len() != got.len() {
        return format!(
            "句 {id} 的词被增删：载荷 {} 个词、答案 {} 个词（第 {} 个词附近：载荷 “{}” / 答案 \
             “{}”）；只允许增加、替换或删除标点，每个词都必须逐字保留",
            expected.len(),
            got.len(),
            first + 1,
            show(expected),
            show(got)
        );
    }
    format!(
        "句 {id} 第 {} 个词被改写：载荷 “{}” / 答案 “{}”；只允许增加、替换或删除标点，\
         每个词都必须逐字保留（错别字也不要改，那不是本次的任务）",
        first + 1,
        show(expected),
        show(got)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(index: usize, t0: f64, t1: f64, text: &str, sp: &str) -> Word {
        Word {
            id: format!("g{index}"),
            t0,
            t1,
            text: text.to_owned(),
            sp: sp.to_owned(),
            glue: false,
        }
    }

    /// 无停顿、同说话人的连续词流。
    fn stream(texts: &[&str]) -> Vec<Word> {
        texts
            .iter()
            .enumerate()
            .map(|(index, text)| {
                let t0 = index as f64 * 0.5;
                word(index, t0, t0 + 0.4, text, "s1")
            })
            .collect()
    }

    fn single_page(words: &[Word]) -> PolishPagePlan {
        PolishPagePlan {
            id: "p001".to_owned(),
            before: 0..0,
            core: 0..words.len(),
            after: words.len()..words.len(),
            hard_cut_start: false,
            hard_cut_end: false,
            para_starts: Vec::new(),
        }
    }

    /// 测试用解析入口：`input` 恒取本页的渲染文本（体积护栏基准）。
    fn parse(words: &[Word], plan: &PolishPagePlan, output: &str) -> PolishParsed {
        let input = render_polish_page(words, plan).text;
        parse_polish_page(words, plan, &input, output)
    }

    /// 与解析口径一致的期望段落。
    fn expected_paragraphs(words: &[Word], plan: &PolishPagePlan) -> Vec<String> {
        segments(words, &plan.core, &plan.para_starts)
            .into_iter()
            .map(|segment| {
                markers::sanitize_corrected(&markers::marked_text(&words[segment]))
                    .trim()
                    .to_owned()
            })
            .filter(|text| !text.is_empty())
            .collect()
    }

    fn assert_round_trip(words: &[Word], plan: &PolishPagePlan) -> PolishParsed {
        let rendered = render_polish_page(words, plan);
        let parsed = parse(words, plan, &rendered.text);
        assert!(
            !parsed.diagnostics.has_problems(),
            "unexpected problems: {:?}",
            parsed.diagnostics.problems
        );
        assert_eq!(parsed.paragraphs, expected_paragraphs(words, plan));
        parsed
    }

    #[test]
    fn render_uses_documented_fence_layout() {
        let words = vec![
            word(0, 0.0, 0.5, "hello", "s1"),
            word(1, 0.5, 1.0, "world.", "s1"),
        ];
        let rendered = render_polish_page(&words, &single_page(&words));
        assert_eq!(
            rendered.text,
            format!(
                "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\nhello world.\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
            )
        );
        assert!(rendered.warnings.is_empty());
    }

    /// 分段与标记摆放的逐字锚点：不经 `segments()` 反算期望值，
    /// 以免渲染与期望共享同一处实现而互相掩盖回归。
    #[test]
    fn segments_and_markers_render_verbatim() {
        let words = vec![
            word(0, 0.0, 0.5, "hello", "s1"),
            word(1, 1.7, 2.0, "there.", "s1"),
            word(2, 2.0, 2.5, "yes", "s2"),
            word(3, 2.5, 3.0, "indeed.", "s2"),
        ];
        let plan = single_page(&words);
        let rendered = render_polish_page(&words, &plan);
        assert_eq!(
            rendered.text,
            format!(
                "{FENCE_CONTEXT_BEFORE}\n\
                 {FENCE_EDIT_BEGIN}\n\
                 hello ⏸⏸ there. ⏹S2\n\
                 \n\
                 yes indeed.\n\
                 {FENCE_EDIT_END}\n\
                 {FENCE_CONTEXT_AFTER}\n"
            )
        );

        let parsed = parse(&words, &plan, &rendered.text);
        assert!(!parsed.diagnostics.has_problems());
        assert_eq!(parsed.paragraphs, vec!["hello there.", "yes indeed."]);
        assert_eq!(parsed.forced_boundaries, vec![2]);

        // 等于 core.start 的段钉天然成立，不改变任何输出。
        let mut pinned = plan.clone();
        pinned.para_starts = vec![0];
        assert_eq!(render_polish_page(&words, &pinned).text, rendered.text);
    }

    #[test]
    fn round_trip_latin_cjk_and_mixed() {
        for texts in [
            vec!["Hello", "there,", "friend."],
            vec!["你", "好", "，", "世", "界", "。"],
            vec!["用", "Agent", "做", "事", "很", "好", "。"],
            vec!["<>&\"", "escaped", "text."],
        ] {
            let words = stream(&texts);
            assert_round_trip(&words, &single_page(&words));
        }
    }

    #[test]
    fn round_trip_empty_paragraph_and_empty_core() {
        let words = stream(&["ok."]);
        let mut plan = single_page(&words);
        plan.core = 0..0;
        plan.before = 0..0;
        plan.after = 0..0;
        let rendered = render_polish_page(&words, &plan);
        let parsed = parse(&words, &plan, &rendered.text);
        assert!(parsed.paragraphs.is_empty());
        assert!(!parsed.diagnostics.has_problems());
    }

    #[test]
    fn round_trip_very_long_sentence() {
        let texts: Vec<&str> = std::iter::repeat_n("word", 900).collect();
        let words = stream(&texts);
        let mut plan = single_page(&words);
        // 段钉切成 3×300 词：分段质量门落地后，恰在单段上限内的合法分段
        // 才是可回环的答案；本测试关心的是超长单句行的渲染/解析恒等。
        plan.para_starts = vec![300, 600];
        assert_round_trip(&words, &plan);
    }

    #[test]
    fn round_trip_with_manual_para_start() {
        let words = stream(&["one.", "two.", "three.", "four."]);
        let mut plan = single_page(&words);
        plan.para_starts = vec![2];
        let parsed = assert_round_trip(&words, &plan);
        assert_eq!(parsed.paragraphs, vec!["one. two.", "three. four."]);
    }

    #[test]
    fn sentinel_literal_in_source_is_neutralized() {
        let words = stream(&[FENCE_EDIT_END, "trailing."]);
        let plan = single_page(&words);
        let rendered = render_polish_page(&words, &plan);
        assert!(
            rendered
                .text
                .contains(&format!(" {FENCE_EDIT_END} trailing."))
        );
        assert_eq!(rendered.warnings.len(), 1);
        assert_eq!(rendered.warnings[0].code, WarningCode::SentinelNeutralized);
        assert_round_trip(&words, &plan);
    }

    #[test]
    fn plan_splits_at_speaker_change_without_hard_cut() {
        let mut words = stream(&["a", "b", "c", "d", "e", "f"]);
        for word in words.iter_mut().skip(3) {
            word.sp = "s2".to_owned();
        }
        let budget = PolishBudget {
            core_words: 4,
            context_words: 4,
            context_sentences: 1,
            overflow_ratio: 0.15,
        };
        let plans = plan_polish_pages(&words, &budget);
        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].core, 0..3);
        assert_eq!(plans[1].core, 3..6);
        assert!(!plans[0].hard_cut_end);
        assert!(!plans[1].hard_cut_start);
        // 页缝即说话人切换 → 边界归后一页。
        assert!(forced_boundaries(&words, &plans[1]).contains(&3));
        assert!(!forced_boundaries(&words, &plans[0]).contains(&3));
    }

    #[test]
    fn plan_stronger_rank_cannot_veto_a_much_later_breakpoint() {
        // 窗口早段有停顿(rank2)、尾段有句末(rank1)：联合评分下 rank 每档只
        // 值 5% 页目标的提前量，应选 48 词处的句末而不是 42 词处的停顿。
        let mut words = stream(&vec!["aaaa"; 100]);
        words[42].t0 = 21.6; // 41→42 之间 0.7s 停顿（rank2）
        words[47].text = "aaaa.".to_owned(); // 47→48 句末（rank1）
        let budget = PolishBudget {
            core_words: 90,
            context_words: 3,
            context_sentences: 1,
            overflow_ratio: 0.15,
        };
        let plans = plan_polish_pages(&words, &budget);
        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].core, 0..48);
        assert_eq!(plans[1].core, 48..100);
    }

    #[test]
    fn plan_falls_back_to_hard_cut() {
        let words = stream(&["a", "b", "c", "d", "e", "f", "g", "h"]);
        let budget = PolishBudget {
            core_words: 3,
            context_words: 3,
            context_sentences: 1,
            overflow_ratio: 0.15,
        };
        let plans = plan_polish_pages(&words, &budget);
        assert!(plans.len() >= 2);
        assert!(plans[0].hard_cut_end);
        assert!(plans[1].hard_cut_start);
        assert!(forced_boundaries(&words, &plans[1]).is_empty());
        let rendered = render_polish_page(&words, &plans[0]);
        assert!(rendered.text.contains(MARKER_HARD_CUT));
    }

    #[test]
    fn plan_never_stalls_on_tiny_budget() {
        let words = stream(&["a", "b", "c", "d", "e"]);
        let budget = PolishBudget {
            core_words: 1,
            context_words: 1,
            context_sentences: 1,
            overflow_ratio: 0.0,
        };
        let plans = plan_polish_pages(&words, &budget);
        assert!(!plans.is_empty());
        let mut cursor = 0;
        for plan in &plans {
            assert_eq!(plan.core.start, cursor);
            assert!(plan.core.end > plan.core.start);
            cursor = plan.core.end;
        }
        assert_eq!(cursor, words.len());
    }

    #[test]
    fn plan_context_regions_hold_complete_sentences() {
        let words = stream(&["a.", "b.", "c.", "d.", "e.", "f.", "g.", "h."]);
        let budget = PolishBudget {
            core_words: 4,
            context_words: 200,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans = plan_polish_pages(&words, &budget);
        assert_eq!(plans.len(), 2);
        assert!(plans[0].before.is_empty());
        assert_eq!(plans[0].after, 4..6);
        assert_eq!(plans[1].before, 2..4);
        assert!(plans[1].after.is_empty());
        assert_round_trip(&words, &plans[0]);
        assert_round_trip(&words, &plans[1]);
    }

    /// 回归锁：全篇单一 `sp`（无说话人信息）时的分页基线。
    ///
    /// 2026-08 起无说话人路径与长轮次内部一样**句界优先**：窗口里有句末标点
    /// 就不在停顿处切页（此前基线 `(0,55)…` 里 55/165 两处页缝落在句中的
    /// 停顿上）。每个页缝都必须落在句末，且期望值不得再刷新。
    #[test]
    fn plan_pages_without_speakers_match_the_pre_turn_baseline() {
        let mut rng = Lcg(0xB40C_0757_0004_0001);
        let mut words: Vec<Word> = Vec::new();
        let mut clock = 0.0_f64;
        for index in 0..400 {
            let text = if rng.below(100) < 15 { "aaaa." } else { "aaaa" };
            let gap = if rng.below(100) < 10 { 0.9 } else { 0.05 };
            clock += gap;
            words.push(word(index, clock, clock + 0.4, text, "s1"));
            clock += 0.4;
        }
        let budget = PolishBudget {
            core_words: 60,
            context_words: 20,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans: Vec<(usize, usize, bool, bool)> = plan_polish_pages(&words, &budget)
            .iter()
            .map(|plan| {
                (
                    plan.core.start,
                    plan.core.end,
                    plan.hard_cut_start,
                    plan.hard_cut_end,
                )
            })
            .collect();
        assert_eq!(
            plans,
            vec![
                (0, 50, false, false),
                (50, 107, false, false),
                (107, 166, false, false),
                (166, 222, false, false),
                (222, 276, false, false),
                (276, 336, false, false),
                (336, 400, false, false),
            ]
        );
        for (_, end, _, _) in &plans[..plans.len() - 1] {
            assert!(
                sentence_end(&words[end - 1].text),
                "页缝 {end} 落在句中：{}",
                words[end - 1].text
            );
        }
    }

    /// 无说话人路径的句界优先：窗口里靠后的停顿（rank 2）不再压过靠前的
    /// 句末（rank 1）；窗口与溢出区都没有句末时才回落到停顿。
    #[test]
    fn plan_without_speakers_prefers_sentence_end_over_a_later_pause() {
        // 60 词预算 → 窗口 [48, 60)。第 50 词句末、第 57 词后 0.9s 停顿（句中）。
        let mut words: Vec<Word> = Vec::new();
        let mut clock = 0.0_f64;
        for index in 0..120 {
            let text = if index == 49 || index == 90 {
                "aaaa."
            } else {
                "aaaa"
            };
            let gap = if index == 58 { 0.9 } else { 0.05 };
            clock += gap;
            words.push(word(index, clock, clock + 0.4, text, "s1"));
            clock += 0.4;
        }
        let budget = PolishBudget {
            core_words: 60,
            context_words: 20,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans = plan_polish_pages(&words, &budget);
        assert_eq!(plans[0].core.end, 50, "应在句末切页，而不是靠后的句中停顿");
        assert!(!plans[0].hard_cut_end);
        // 把句末挪出窗口与溢出区：只剩停顿可用，回落到停顿断点。
        for w in words.iter_mut() {
            if w.text == "aaaa." {
                w.text = "aaaa".to_owned();
            }
        }
        let plans = plan_polish_pages(&words, &budget);
        assert_eq!(plans[0].core.end, 58);
        assert!(!plans[0].hard_cut_end);
    }

    /// 逐词指定说话人的密排词流（词间隔 0.1s，不产生停顿断点）。
    fn voices(entries: &[(&str, &str)]) -> Vec<Word> {
        entries
            .iter()
            .enumerate()
            .map(|(index, (sp, text))| {
                let t0 = index as f64 * 0.5;
                word(index, t0, t0 + 0.4, text, sp)
            })
            .collect()
    }

    /// 轮次感知分页的共同断言：页界只落在轮次边界，或**单独超预算**的长轮次
    /// 内部的句界；页面连续覆盖全篇。
    fn assert_turn_aware_pages(words: &[Word], budget: &PolishBudget) -> Vec<PolishPagePlan> {
        let plans = plan_polish_pages(words, budget);
        let turns = speaker_turns(words);
        let starts: Vec<usize> = turns.iter().map(|turn| turn.start).collect();
        assert!(plans.len() > 1, "用例应当分出多页");
        assert_eq!(plans.first().unwrap().core.start, 0);
        assert_eq!(plans.last().unwrap().core.end, words.len());
        for pair in plans.windows(2) {
            assert_eq!(pair[0].core.end, pair[1].core.start);
        }
        for plan in &plans {
            let cut = plan.core.end;
            if cut == words.len() || starts.contains(&cut) {
                continue;
            }
            let turn = turns
                .iter()
                .find(|turn| turn.contains(&cut))
                .expect("页界必须落在某个轮次内");
            assert!(
                turn.len() > budget.core_words,
                "页缝劈开了未超预算的轮次（cut {cut}, turn {turn:?}）"
            );
            assert!(
                sentence_end(&words[cut - 1].text),
                "长轮次内的页缝没有落在句界（cut {cut}）"
            );
            assert!(!plan.hard_cut_end, "句界页缝不应记为硬切");
        }
        plans
    }

    /// 短轮次对话：页 = 连续整轮次的并，每个页界都是轮次起点。
    #[test]
    fn turn_paging_groups_short_dialogue_turns() {
        let entries: Vec<(String, String)> = (0..36)
            .map(|index| {
                let speaker = if (index / 3) % 2 == 0 { "s1" } else { "s2" };
                let text = if index % 3 == 2 { "aaaa." } else { "aaaa" };
                (speaker.to_owned(), text.to_owned())
            })
            .collect();
        let entries: Vec<(&str, &str)> = entries
            .iter()
            .map(|(sp, text)| (sp.as_str(), text.as_str()))
            .collect();
        let words = voices(&entries);
        let budget = PolishBudget {
            core_words: 9,
            context_words: 20,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans = assert_turn_aware_pages(&words, &budget);
        // 12 个 3 词轮次 → 每页 3 个整轮次。
        assert_eq!(
            plans
                .iter()
                .map(|plan| (plan.core.start, plan.core.end))
                .collect::<Vec<_>>(),
            vec![(0, 9), (9, 18), (18, 27), (27, 36)]
        );
        assert!(plans.iter().all(|plan| !plan.hard_cut_end));
    }

    /// 长独白：轮次单独超预算，内部按句界切；偏晚的停顿不再抢走页界。
    #[test]
    fn turn_paging_splits_a_long_monologue_at_sentence_ends() {
        let mut entries: Vec<(String, String)> = Vec::new();
        for _ in 0..3 {
            entries.push(("s1".to_owned(), "aaaa".to_owned()));
        }
        for index in 0..60 {
            // 每 6 词一个句末标点。
            let text = if index % 6 == 5 { "aaaa." } else { "aaaa" };
            entries.push(("s2".to_owned(), text.to_owned()));
        }
        for _ in 0..3 {
            entries.push(("s1".to_owned(), "aaaa".to_owned()));
        }
        let entries: Vec<(&str, &str)> = entries
            .iter()
            .map(|(sp, text)| (sp.as_str(), text.as_str()))
            .collect();
        let mut words = voices(&entries);
        // 首页窗口尾部塞一个长停顿（rank2，比窗口内的句界更靠后、评分更高）：
        // 纯 rank 联合评分会选它，轮次内的句界优先不会。
        for word in words.iter_mut().skip(17) {
            word.t0 += 1.2;
            word.t1 += 1.2;
        }
        let budget = PolishBudget {
            core_words: 16,
            context_words: 20,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans = assert_turn_aware_pages(&words, &budget);
        let cuts: Vec<usize> = plans.iter().map(|plan| plan.core.end).collect();
        assert!(
            !cuts.contains(&3),
            "3 词的短轮次够不到窗口下界，不该独占一页: {cuts:?}"
        );
        assert!(cuts.contains(&15), "长轮次首页应当断在句界 15: {cuts:?}");
        assert!(!cuts.contains(&17), "停顿不得抢走长轮次内的句界: {cuts:?}");
        assert!(
            cuts.iter()
                .filter(|cut| (4..63).contains(*cut))
                .all(|cut| words[cut - 1].text.ends_with('.')),
            "长轮次内的页界必须是句界: {cuts:?}"
        );

        // 对照组：同一词流抹掉说话人信息 ⇒ 走词流路径。2026-08 起两条路径
        // 同样句界优先：停顿(rank2)不再抢走窗口内的句界 15。
        let flat: Vec<Word> = words
            .iter()
            .cloned()
            .map(|mut word| {
                word.sp = "s1".to_owned();
                word
            })
            .collect();
        let flat_cuts: Vec<usize> = plan_polish_pages(&flat, &budget)
            .iter()
            .map(|plan| plan.core.end)
            .collect();
        assert!(
            !flat_cuts.contains(&17) && flat_cuts.contains(&15),
            "无说话人路径同样句界优先，不该在句中停顿处切页: {flat_cuts:?}"
        );
    }

    /// 一句"嗯"之后接长独白：不为这个短轮次单开一页，页界改落在长轮次内的
    /// 句界（这页 = 短轮次 + 长轮次的头）。
    #[test]
    fn turn_paging_does_not_waste_a_page_on_a_one_word_interjection() {
        let mut entries: Vec<(String, String)> = vec![("s1".to_owned(), "yeah".to_owned())];
        for index in 0..60 {
            let text = if index % 5 == 4 { "aaaa." } else { "aaaa" };
            entries.push(("s2".to_owned(), text.to_owned()));
        }
        let entries: Vec<(&str, &str)> = entries
            .iter()
            .map(|(sp, text)| (sp.as_str(), text.as_str()))
            .collect();
        let words = voices(&entries);
        let budget = PolishBudget {
            core_words: 15,
            context_words: 20,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans = assert_turn_aware_pages(&words, &budget);
        assert!(
            plans.iter().all(|plan| plan.core.len() > 1),
            "短轮次不该独占一页: {:?}",
            plans
                .iter()
                .map(|plan| plan.core.clone())
                .collect::<Vec<_>>()
        );
    }

    /// 混合：短轮次成组 + 长轮次内部按句界切，两种页界共存。
    #[test]
    fn turn_paging_mixes_grouped_turns_and_a_split_long_turn() {
        let mut entries: Vec<(String, String)> = Vec::new();
        for turn in 0..6 {
            let speaker = if turn % 2 == 0 { "s1" } else { "s2" };
            for index in 0..4 {
                let text = if index == 3 { "aaaa." } else { "aaaa" };
                entries.push((speaker.to_owned(), text.to_owned()));
            }
        }
        for index in 0..40 {
            let text = if index % 5 == 4 { "aaaa." } else { "aaaa" };
            entries.push(("s3".to_owned(), text.to_owned()));
        }
        for index in 0..4 {
            let text = if index == 3 { "aaaa." } else { "aaaa" };
            entries.push(("s1".to_owned(), text.to_owned()));
        }
        let entries: Vec<(&str, &str)> = entries
            .iter()
            .map(|(sp, text)| (sp.as_str(), text.as_str()))
            .collect();
        let words = voices(&entries);
        let budget = PolishBudget {
            core_words: 12,
            context_words: 20,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans = assert_turn_aware_pages(&words, &budget);
        let starts: Vec<usize> = speaker_turns(&words)
            .iter()
            .map(|turn| turn.start)
            .collect();
        let cuts: Vec<usize> = plans
            .iter()
            .map(|plan| plan.core.end)
            .filter(|cut| *cut < words.len())
            .collect();
        assert!(
            cuts.iter().any(|cut| starts.contains(cut)),
            "应当有落在轮次边界的页界: {cuts:?}"
        );
        assert!(
            cuts.iter().any(|cut| !starts.contains(cut)),
            "长轮次应当被内部切开: {cuts:?}"
        );
    }

    /// `⏹S2` 只属于 payload：模型抄回来照样被剥除，标签不进段落文本。
    #[test]
    fn speaker_label_lives_only_in_the_payload() {
        let mut words = stream(&["hello", "there.", "yes", "indeed."]);
        words[2].sp = "s2".to_owned();
        words[3].sp = "s2".to_owned();
        let plan = single_page(&words);
        let rendered = render_polish_page(&words, &plan);
        assert!(
            rendered.text.contains("hello there. ⏹S2"),
            "{}",
            rendered.text
        );

        for echoed in ["⏹S2", "⏹"] {
            let output = format!(
                "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\nhello there. {echoed} yes indeed.\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
            );
            let parsed = parse(&words, &plan, &output);
            assert!(!parsed.diagnostics.has_problems(), "{echoed}");
            // 剥标记后仍逐字保真 → ⏹ 硬保证就地落位。
            assert_eq!(parsed.paragraphs, vec!["hello there.", "yes indeed."]);
            assert!(
                parsed
                    .paragraphs
                    .iter()
                    .all(|text| !text.contains('S') && !text.contains(markers::SPEAKER_MARKER)),
                "标签泄漏进输出: {:?}",
                parsed.paragraphs
            );
            assert!(
                parsed
                    .diagnostics
                    .warnings
                    .iter()
                    .any(|warning| warning.code == WarningCode::MarkerResidue),
                "{echoed}"
            );
        }
    }

    /// 段落聚合不跨轮次：每个轮次自成正文块，⏹ 硬保证表恰是轮次起点。
    #[test]
    fn paragraph_blocks_never_span_a_speaker_turn() {
        let mut words = stream(&["a.", "b.", "c.", "d.", "e."]);
        words[1].sp = "s2".to_owned();
        words[2].sp = "s2".to_owned();
        words[4].sp = "s3".to_owned();
        let plan = single_page(&words);
        let parsed = assert_round_trip(&words, &plan);
        assert_eq!(parsed.paragraphs, vec!["a.", "b. c.", "d.", "e."]);
        assert_eq!(parsed.forced_boundaries, vec![1, 3, 4]);
        let rendered = render_polish_page(&words, &plan).text;
        assert!(rendered.contains("a. ⏹S2"), "{rendered}");
        assert!(rendered.contains("d. ⏹S3"), "{rendered}");
    }

    #[test]
    fn multi_page_round_trip_keeps_context_readonly() {
        let mut words = stream(&["a.", "b.", "c.", "d.", "e.", "f."]);
        words[3].sp = "s2".to_owned();
        words[4].sp = "s2".to_owned();
        words[5].sp = "s2".to_owned();
        let budget = PolishBudget {
            core_words: 3,
            context_words: 10,
            context_sentences: 1,
            overflow_ratio: 0.15,
        };
        for plan in plan_polish_pages(&words, &budget) {
            assert_round_trip(&words, &plan);
        }
    }

    #[test]
    fn speaker_boundary_is_forced_back_when_model_drops_blank_line() {
        let mut words = stream(&["hello", "there.", "yes", "indeed."]);
        words[2].sp = "s2".to_owned();
        words[3].sp = "s2".to_owned();
        let plan = single_page(&words);
        let output = format!(
            "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\nhello there. yes indeed.\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
        );
        let parsed = parse(&words, &plan, &output);
        assert!(!parsed.diagnostics.has_problems());
        assert_eq!(parsed.forced_boundaries, vec![2]);
        assert_eq!(parsed.paragraphs, vec!["hello there.", "yes indeed."]);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::BoundaryForced)
        );
    }

    /// §2.2 栅栏恢复：实测 7 次「哨兵栅栏缺失」里 5 次只是漏写了
    /// `<<<EDIT-END>>>` 而 `<<<CONTEXT-AFTER>>>` 还在——核心区本身完整，整页
    /// 重试三轮只是重掷同一份答案。现在按相邻栅栏推断边界并记警告。
    #[test]
    fn missing_edit_end_fence_is_recovered_from_context_after() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let output =
            format!("{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\na. b.\n{FENCE_CONTEXT_AFTER}\n");
        let parsed = parse(&words, &plan, &output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.paragraphs, vec!["a. b.".to_owned()]);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::FenceRecovered)
        );
    }

    /// 漏写 `<<<CONTEXT-AFTER>>>`（末页本就没有只读下文）同样可恢复。
    #[test]
    fn missing_context_after_fence_is_recovered_from_edit_end() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let output =
            format!("{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\na. b.\n{FENCE_EDIT_END}\n");
        let parsed = parse(&words, &plan, &output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.paragraphs, vec!["a. b.".to_owned()]);
    }

    /// 缩进的 `<<<EDIT-BEGIN>>>`：核心区起点由 `CONTEXT-BEFORE` 之后的只读
    /// 上文区剥离推断，错位的栅栏行本身被当结构行忽略。
    #[test]
    fn indented_edit_begin_fence_is_recovered() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let output = format!(
            "{FENCE_CONTEXT_BEFORE}\n  {FENCE_EDIT_BEGIN}\na. b.\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
        );
        let parsed = parse(&words, &plan, &output);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert_eq!(parsed.paragraphs, vec!["a. b.".to_owned()]);
    }

    /// 两条 EDIT 栅栏都缺、只读栅栏也推不出核心区 ⇒ 仍是 page-fatal。
    #[test]
    fn structureless_answer_still_reports_document_truncated() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let parsed = parse(&words, &plan, "a. b.\n");
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
        assert!(parsed.paragraphs.is_empty());
    }

    /// 栅栏顺序错乱时按「首见合法顺序」恢复；恢复出来的核心区为空仍判
    /// page-fatal（核心区为空 = 正文没了）。
    #[test]
    fn out_of_order_fences_report_document_truncated() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let output = format!(
            "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_END}\na. b.\n{FENCE_EDIT_BEGIN}\n{FENCE_CONTEXT_AFTER}\n"
        );
        let parsed = parse(&words, &plan, &output);
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
    }

    /// §2.2：只读区被改写不再拒页——只读区从不写回真相，核心区另有词流真相门。
    #[test]
    fn modified_readonly_context_is_only_a_warning() {
        let words = stream(&["a.", "b.", "c.", "d.", "e.", "f.", "g.", "h."]);
        let budget = PolishBudget {
            core_words: 4,
            context_words: 200,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans = plan_polish_pages(&words, &budget);
        let plan = &plans[1];
        let rendered = render_polish_page(&words, plan);
        let tampered = rendered.text.replacen("c. d.", "c. changed.", 1);
        assert_ne!(tampered, rendered.text);
        let parsed = parse(&words, plan, &tampered);
        assert!(
            !parsed.diagnostics.has_code(ProblemCode::SourceDrift),
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
        assert!(!parsed.paragraphs.is_empty());
    }

    #[test]
    fn mojibake_control_bytes_in_polish_answer_are_rejected() {
        let words = stream(&["你好。"]);
        let plan = single_page(&words);
        let rendered = render_polish_page(&words, &plan);
        let tampered = rendered.text.replace("你好。", "你好ã\u{80}\u{82}");

        let parsed = parse(&words, &plan, &tampered);

        assert!(parsed.diagnostics.has_code(ProblemCode::SourceDrift));
        assert!(
            parsed
                .diagnostics
                .problems
                .iter()
                .any(|problem| problem.detail.contains("UTF-8 乱码"))
        );
    }

    /// §2.2：悬垂假句末不再拒页，改为按段落记 `surface-artifact` 警告；引擎
    /// 映射成句后把它送进 `polish-retry` 的句级补做队列。
    #[test]
    fn dangling_sentence_end_becomes_a_surface_artifact_warning() {
        let words = stream(&["就是说当。", "你的 group 数目越多，效果越明显。"]);
        let plan = single_page(&words);
        let rendered = render_polish_page(&words, &plan);

        let parsed = parse(&words, &plan, &rendered.text);

        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert!(parsed.diagnostics.warnings.iter().any(|warning| {
            warning.code == WarningCode::SurfaceArtifact
                && warning.detail.contains("dangling connector/preposition")
                && warning.detail.contains("remove that false sentence end")
        }));
    }

    /// §2.2：冲突相邻标点由代码归一（R2），粘连 Latin 串只记警告；两者都不再
    /// 让一句的表面瑕疵拒掉整页。
    #[test]
    fn conflicting_punctuation_is_repaired_and_collapsed_latin_only_warns() {
        let words = stream(&["所以他说。，呃 purereinforcementlearning 很重要。"]);
        let plan = single_page(&words);
        let rendered = render_polish_page(&words, &plan);

        let parsed = parse(&words, &plan, &rendered.text);

        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics
        );
        assert!(
            parsed
                .paragraphs
                .iter()
                .all(|paragraph| { !crate::seam::contains_conflicting_punctuation(paragraph) }),
            "{:?}",
            parsed.paragraphs
        );
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::PunctuationNormalized)
        );
        assert!(parsed.diagnostics.warnings.iter().any(|warning| {
            warning.code == WarningCode::SurfaceArtifact
                && warning.detail.contains("run-together Latin phrase")
                && warning.detail.contains("word boundaries with spaces")
        }));
    }

    /// 实测回归（deepseek-v4-flash）：模型顺手修掉只读区里的 ASR 错词
    /// （"RL don"→"RL'd on"、"the the"→"the"）。表面级改写不再拒页——
    /// 只读区反正不进正文，核心区另有词流真相门。
    #[test]
    fn cosmetic_readonly_drift_is_ignored_with_a_warning() {
        let words = stream(&[
            "models",
            "have",
            "been",
            "RL",
            "don,",
            "and",
            "the",
            "the",
            "models",
            "work.",
            "Second",
            "sentence",
            "of",
            "context",
            "stays",
            "here",
            "unchanged",
            "today.",
            "Core",
            "region",
            "starts",
            "here",
            "and",
            "keeps",
            "going",
            "fine.",
            "More",
            "core",
            "words",
            "fill",
            "the",
            "budget",
            "till",
            "the",
            "end.",
        ]);
        let budget = PolishBudget {
            core_words: 17,
            context_words: 200,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans = plan_polish_pages(&words, &budget);
        let plan = plans.last().unwrap();
        let rendered = render_polish_page(&words, plan);
        assert!(rendered.text.contains("RL don,"), "前置：只读上文含错词");
        let tampered = rendered.text.replacen("RL don,", "RL'd on,", 1).replacen(
            "the the models",
            "the models",
            1,
        );
        assert_ne!(tampered, rendered.text);
        let parsed = parse(&words, plan, &tampered);
        assert!(
            !parsed.diagnostics.has_code(ProblemCode::SourceDrift),
            "表面级只读区改写不应拒页：{:?}",
            parsed.diagnostics.problems
        );
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ContentIgnored && w.detail.contains("只读上文区")),
            "应记 ContentIgnored 警告：{:?}",
            parsed.diagnostics.warnings
        );
        assert!(!parsed.paragraphs.is_empty(), "核心区照常解析");
    }

    /// §2.2：只读区被截断（整句消失）同样只记警告——只读区从不写回真相，
    /// 而截断本身不影响本页正文。旧实现在这里拒页并重掷全部句子。
    #[test]
    fn truncated_readonly_context_is_only_a_warning() {
        let words = stream(&[
            "models",
            "have",
            "been",
            "RL",
            "don,",
            "and",
            "the",
            "the",
            "models",
            "work.",
            "Second",
            "sentence",
            "of",
            "context",
            "stays",
            "here",
            "unchanged",
            "today.",
            "Core",
            "region",
            "starts",
            "here",
            "and",
            "keeps",
            "going",
            "fine.",
            "More",
            "core",
            "words",
            "fill",
            "the",
            "budget",
            "till",
            "the",
            "end.",
        ]);
        let budget = PolishBudget {
            core_words: 17,
            context_words: 200,
            context_sentences: 2,
            overflow_ratio: 0.15,
        };
        let plans = plan_polish_pages(&words, &budget);
        let plan = plans.last().unwrap();
        let rendered = render_polish_page(&words, plan);
        let truncated = rendered.text.replacen(
            "Second sentence of context stays here unchanged today.",
            "",
            1,
        );
        assert_ne!(truncated, rendered.text);
        let parsed = parse(&words, plan, &truncated);
        assert!(
            !parsed.diagnostics.has_code(ProblemCode::SourceDrift),
            "{:?}",
            parsed.diagnostics
        );
        assert!(parsed.diagnostics.warnings.iter().any(|warning| {
            warning.code == WarningCode::ContentIgnored && warning.detail.contains("被改写或截断")
        }));
        assert!(!parsed.paragraphs.is_empty(), "核心区照常解析");
    }

    #[test]
    fn oversize_output_is_guarded() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let bloat: String = std::iter::repeat_n('x', 6000).collect();
        let output = format!(
            "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\n{bloat}\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
        );
        let parsed = parse(&words, &plan, &output);
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentOversize));
    }

    #[test]
    fn clean_code_fence_is_free_but_stray_fence_is_wrapped() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let body = render_polish_page(&words, &plan).text;

        let wrapped = format!("```\n{body}```\n");
        let parsed = parse(&words, &plan, &wrapped);
        assert!(!parsed.diagnostics.has_problems());
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::WrapperStripped)
        );

        let stray = format!("```text\n{body}");
        let parsed = parse(&words, &plan, &stray);
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentWrapped));
    }

    #[test]
    fn chatter_outside_fences_is_wrapped_and_ignored() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let output = format!(
            "好的，这是修订后的文本：\n{}",
            render_polish_page(&words, &plan).text
        );
        let parsed = parse(&words, &plan, &output);
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentWrapped));
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::ContentIgnored)
        );
        assert_eq!(parsed.paragraphs, vec!["a. b."]);
    }

    #[test]
    fn blank_line_runs_collapse_and_soft_wrap_joins() {
        let words = stream(&["a.", "b.", "c.", "d."]);
        let plan = single_page(&words);
        let output = format!(
            "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\na.\nb.\n\n\n\nc. d.\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
        );
        let parsed = parse(&words, &plan, &output);
        assert_eq!(parsed.paragraphs, vec!["a. b.", "c. d."]);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::BlankLinesCollapsed)
        );
    }

    /// 页缝显式信号：核心区正文之前的空行不产生段落、不记 BlankLinesCollapsed，
    /// 只置 `starts_new_paragraph`；没有前导空行则为 false。
    #[test]
    fn leading_blank_line_is_the_new_paragraph_signal() {
        let words = stream(&["a.", "b.", "c."]);
        let plan = single_page(&words);
        let output = format!(
            "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\n\na. b.\n\nc.\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
        );
        let parsed = parse(&words, &plan, &output);
        assert!(parsed.starts_new_paragraph);
        assert_eq!(parsed.paragraphs, vec!["a. b.", "c."]);
        assert!(parsed.diagnostics.problems.is_empty());
        assert!(
            !parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::BlankLinesCollapsed)
        );
        let plain = format!(
            "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\na. b.\n\nc.\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
        );
        assert!(!parse(&words, &plan, &plain).starts_new_paragraph);
    }

    #[test]
    fn marker_residue_is_stripped_and_reported() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let output = format!(
            "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\na. ⏸⏸ b. ⏹\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
        );
        let parsed = parse(&words, &plan, &output);
        assert_eq!(parsed.paragraphs, vec!["a. b."]);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::MarkerResidue)
        );
    }

    #[test]
    fn empty_core_against_nonempty_source_is_truncated() {
        let words = stream(&["a.", "b."]);
        let plan = single_page(&words);
        let output = format!(
            "{FENCE_CONTEXT_BEFORE}\n{FENCE_EDIT_BEGIN}\n\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}\n"
        );
        let parsed = parse(&words, &plan, &output);
        assert!(parsed.diagnostics.has_code(ProblemCode::DocumentTruncated));
    }

    /// 固定种子 LCG（禁止未播种随机）。
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0 >> 33
        }

        fn below(&mut self, bound: u64) -> usize {
            (self.next() % bound) as usize
        }
    }

    const VOCAB: [&str; 10] = [
        "hello",
        "world,",
        "你",
        "好。",
        "Agent",
        "做事",
        "end.",
        "<>&\"",
        "<<<EDIT-END>>>",
        "fine",
    ];

    #[test]
    fn property_render_parse_round_trip_is_identity() {
        let mut rng = Lcg(0x5EED_1234_ABCD_0001);
        for case in 0..40 {
            let count = 5 + rng.below(45);
            let mut words = Vec::with_capacity(count);
            let mut clock = 0.0f64;
            let mut speaker = 1u32;
            for index in 0..count {
                let gap = (rng.below(30) as f64) / 10.0;
                clock += gap;
                let t0 = clock;
                clock += 0.3;
                if rng.below(6) == 0 {
                    speaker += 1;
                }
                words.push(word(
                    index,
                    t0,
                    clock,
                    VOCAB[rng.below(VOCAB.len() as u64)],
                    &format!("s{speaker}"),
                ));
            }
            let budget = PolishBudget {
                core_words: 6 + rng.below(10),
                context_words: 20,
                context_sentences: 2,
                overflow_ratio: 0.15,
            };
            let plans = plan_polish_pages(&words, &budget);
            assert!(!plans.is_empty(), "case {case} produced no pages");
            let mut cursor = 0;
            for plan in &plans {
                assert_eq!(
                    plan.core.start, cursor,
                    "case {case} page {} 不连续",
                    plan.id
                );
                cursor = plan.core.end;
                assert_round_trip(&words, plan);
            }
            assert_eq!(cursor, words.len(), "case {case} 未覆盖全部词");
        }
    }

    #[test]
    fn parse_never_panics_on_malformed_input() {
        let words = stream(&["你好。", "world.", "<<<EDIT-BEGIN>>>"]);
        let plan = single_page(&words);
        let cases = [
            String::new(),
            "\n\n\n".to_owned(),
            "<".to_owned(),
            "<<<".to_owned(),
            "<<<EDIT-BEGIN>>>".to_owned(),
            format!("{FENCE_EDIT_BEGIN}\n{FENCE_EDIT_BEGIN}\n{FENCE_EDIT_END}"),
            format!(
                "{FENCE_CONTEXT_BEFORE}\n\u{0}\u{1}\n{FENCE_EDIT_BEGIN}\n你\u{7}好\n{FENCE_EDIT_END}\n{FENCE_CONTEXT_AFTER}"
            ),
            format!(
                "{FENCE_CONTEXT_BEFORE}{FENCE_EDIT_BEGIN}{FENCE_EDIT_END}{FENCE_CONTEXT_AFTER}"
            ),
            "\u{FEFF}```\n```\n".to_owned(),
            "⏸⏹⏸⏹".to_owned(),
            format!(
                "{FENCE_CONTEXT_BEFORE}\r\n{FENCE_EDIT_BEGIN}\r\n你好。\r\n{FENCE_EDIT_END}\r\n{FENCE_CONTEXT_AFTER}\r\n"
            ),
        ];
        for case in cases {
            let parsed = parse(&words, &plan, &case);
            let _ = parsed.paragraphs.len();
        }
        // 陈旧计划（区间越界）也不得 panic。
        let stale = PolishPagePlan {
            id: "p009".to_owned(),
            before: 100..200,
            core: 50..80,
            after: 999..1000,
            hard_cut_start: true,
            hard_cut_end: true,
            para_starts: vec![9999],
        };
        let rendered = render_polish_page(&words, &stale);
        let _ = parse(&words, &stale, &rendered.text);
    }

    /// 主 polish lint 不再拦单段超限：整页糊成一段的答案照常放行（正文
    /// 有效即接受），分段退化交给 segment-repair 定向补。
    #[test]
    fn oversized_paragraph_passes_the_main_polish_lint() {
        let texts: Vec<String> = (0..(MAX_PARAGRAPH_WORDS_LATIN * 2))
            .map(|index| {
                if (index + 1) % 10 == 0 {
                    format!("w{index}.")
                } else {
                    format!("w{index}")
                }
            })
            .collect();
        let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        let words = stream(&refs);
        let input = render_polish_page(&words, &single_page(&words)).text;
        let diagnostics = lint_polish_page(&input, &input);
        assert!(
            !diagnostics.has_problems(),
            "problems: {:?}",
            diagnostics.problems
        );
    }

    /// 索引契约区间门：缺块、区间不连续、不覆盖、越界都判 RangeInvalid（detail
    /// 定位到块与缺陷），只挡住对应块。
    #[test]
    fn segment_repair_rejects_invalid_ranges() {
        let lines: Vec<String> = (0..6).map(|index| format!("sentence {index}.")).collect();
        let payload = render_segment_repair_page(&[lines.clone()]);
        assert!(
            payload.starts_with("<<<BLOCK 1 | 6 sentences | "),
            "{payload}"
        );
        assert!(payload.contains("\n3| sentence 2.\n"));

        for (answer, needle) in [
            (
                "<<<BLOCK 1>>>\n1-2\n4-6\n<<<BLOCK-END>>>\n",
                "第 3 行没有被任何区间覆盖",
            ),
            ("<<<BLOCK 1>>>\n1-3\n3-6\n<<<BLOCK-END>>>\n", "重叠"),
            (
                "<<<BLOCK 1>>>\n1-3\n4-5\n<<<BLOCK-END>>>\n",
                "第 6–6 行没有被任何区间覆盖",
            ),
            ("<<<BLOCK 1>>>\n1-3\n4-9\n<<<BLOCK-END>>>\n", "越界"),
            (
                "<<<BLOCK 1>>>\n2-6\n<<<BLOCK-END>>>\n",
                "第 1 行没有被任何区间覆盖",
            ),
            ("<<<BLOCK 1>>>\nOK\n<<<BLOCK-END>>>\n", "没有解析到任何"),
            ("<<<BLOCK 2>>>\n1-6\n<<<BLOCK-END>>>\n", "第 1 块缺失"),
        ] {
            let parsed = parse_segment_repair_page(&payload, answer);
            assert!(
                parsed.diagnostics.has_code(ProblemCode::RangeInvalid),
                "{answer:?}: {:?}",
                parsed.diagnostics.problems
            );
            assert_eq!(parsed.paragraphs, vec![None], "{answer:?}");
            assert_eq!(
                parsed.diagnostics.problems[0].scope,
                ProblemScope::Paragraph { index: 0 }
            );
            assert!(
                parsed.diagnostics.problems[0].detail.contains(needle),
                "{answer:?} detail: {}",
                parsed.diagnostics.problems[0].detail
            );
        }
    }

    /// 索引契约分段门：只回一个区间且整块超限判 ParagraphOversize（detail 是
    /// 定向重试指令，词数按 `word_count` + 语言分档报出、含最少段数）；拆成
    /// ≥2 个区间即接受——切出的组仍超限由引擎处理。
    #[test]
    fn segment_repair_accepts_progress_and_rejects_untouched_paragraphs() {
        let latin: Vec<String> = (0..MAX_PARAGRAPH_WORDS_LATIN)
            .map(|index| format!("word{index} word{}.", index + 1000))
            .collect();
        let cjk: Vec<String> = (0..MAX_PARAGRAPH_WORDS_CJK)
            .map(|index| format!("第{index}字字。"))
            .collect();
        let payload = render_segment_repair_page(&[latin.clone(), cjk.clone()]);
        let latin_need = block_min_paragraphs(&latin);
        let cjk_need = block_min_paragraphs(&cjk);
        assert_eq!(latin_need, 2);
        assert!(cjk_need >= 2, "{cjk_need}");
        assert!(
            payload.contains(&format!(" words | at least {latin_need} paragraphs>>>")),
            "{payload}"
        );
        assert!(
            payload.contains(&format!(" characters | at least {cjk_need} paragraphs>>>")),
            "{payload}"
        );

        // 两块都只回一个区间 ⇒ 都被拒，detail 按各自语言口径。
        let answer = format!(
            "<<<BLOCK 1>>>\n1-{}\n<<<BLOCK-END>>>\n\n<<<BLOCK 2>>>\n1-{}\n<<<BLOCK-END>>>\n",
            latin.len(),
            cjk.len()
        );
        let parsed = parse_segment_repair_page(&payload, &answer);
        assert_eq!(parsed.paragraphs, vec![None, None]);
        let oversize: Vec<&Problem> = parsed
            .diagnostics
            .problems
            .iter()
            .filter(|problem| problem.code == ProblemCode::ParagraphOversize)
            .collect();
        assert_eq!(oversize.len(), 2, "{:?}", parsed.diagnostics.problems);
        assert!(
            oversize[0]
                .detail
                .contains(&format!("单段上限 {MAX_PARAGRAPH_WORDS_LATIN}"))
        );
        assert!(
            oversize[1]
                .detail
                .contains(&format!("单段上限 {MAX_PARAGRAPH_WORDS_CJK}"))
        );
        assert!(
            oversize[0].detail.contains("至少拆成 2 个区间"),
            "{}",
            oversize[0].detail
        );
        assert!(
            oversize[1]
                .detail
                .contains(&format!("至少拆成 {cjk_need} 个区间")),
            "{}",
            oversize[1].detail
        );

        // 拉丁块对半拆：两组各 300 词仍超限，但已取得边界 ⇒ 接受；CJK 块仍
        // 一个区间 ⇒ 仍拒。
        let half = MAX_PARAGRAPH_WORDS_LATIN / 2;
        let answer = format!(
            "<<<BLOCK 1>>>\n1-{half}\n{}-{}\n<<<BLOCK-END>>>\n<<<BLOCK 2>>>\n1-{}\n<<<BLOCK-END>>>\n",
            half + 1,
            latin.len(),
            cjk.len()
        );
        let parsed = parse_segment_repair_page(&payload, &answer);
        assert_eq!(
            parsed.diagnostics.problems.len(),
            1,
            "{:?}",
            parsed.diagnostics.problems
        );
        assert_eq!(
            parsed.diagnostics.problems[0].scope,
            ProblemScope::Paragraph { index: 1 }
        );
        let first = parsed.paragraphs[0].as_ref().expect("拉丁块应接受");
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].len(), half);
        assert_eq!(first[0][0], 0);
        assert_eq!(first[1][0], half);
        assert!(parsed.paragraphs[1].is_none());
    }

    /// 索引契约快乐路径（多块载荷）：块乱序、块头丢尖括号、一行多个区间、
    /// en dash、单行单句、复述带行号句行按空行分组、单块无块头都被宽容处理；
    /// 一块非法不连累其他块；整块本就不超限时只回一个区间也接受。
    #[test]
    fn segment_repair_accepts_range_answers_per_block() {
        let first: Vec<String> = (0..8).map(|index| format!("sentence {index}.")).collect();
        let second: Vec<String> = (0..4).map(|index| format!("other {index}.")).collect();
        let third: Vec<String> = (0..3).map(|index| format!("third {index}.")).collect();
        let payload = render_segment_repair_page(&[first.clone(), second.clone(), third.clone()]);
        assert_eq!(payload.matches("<<<BLOCK 1 |").count(), 1);
        assert_eq!(payload.matches("<<<BLOCK 3 |").count(), 1);
        assert_eq!(payload.matches(FENCE_BLOCK_END).count(), 3);

        let answer = "BLOCK 2\n1–2, 3-4\n<<<BLOCK-END>>>\n\
                      <<<BLOCK 1 | whatever>>>\n1-3\n4 - 6\n7\n8\n<<<BLOCK-END>>>\n\
                      <<<BLOCK 3>>>\n1-4\n<<<BLOCK-END>>>\n";
        let parsed = parse_segment_repair_page(&payload, answer);
        assert_eq!(
            parsed.diagnostics.problems.len(),
            1,
            "{:?}",
            parsed.diagnostics.problems
        );
        assert_eq!(
            parsed.diagnostics.problems[0].code,
            ProblemCode::RangeInvalid
        );
        assert_eq!(
            parsed.diagnostics.problems[0].scope,
            ProblemScope::Paragraph { index: 2 }
        );
        assert_eq!(
            parsed.paragraphs,
            vec![
                Some(vec![vec![0, 1, 2], vec![3, 4, 5], vec![6], vec![7]]),
                Some(vec![vec![0, 1], vec![2, 3]]),
                None,
            ]
        );

        // 复述带行号句行（按空行分组）也认，只看行号；单块载荷可省块头。
        let payload = render_segment_repair_page(&[first.clone()]);
        let answer =
            "1| sentence 0.\n2| sentence 1.\n\n3| sentence two.\n4| x\n5| y\n\n6| \n7| \n8| \n";
        let parsed = parse_segment_repair_page(&payload, answer);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics.problems
        );
        assert_eq!(
            parsed.paragraphs,
            vec![Some(vec![vec![0, 1], vec![2, 3, 4], vec![5, 6, 7]])]
        );

        // 整块不超限：一个区间盖全块也是合法答案（页缝块"整块同段"）。
        let answer = "1-8\n";
        let parsed = parse_segment_repair_page(&payload, answer);
        assert!(
            !parsed.diagnostics.has_problems(),
            "{:?}",
            parsed.diagnostics.problems
        );
        assert_eq!(parsed.paragraphs, vec![Some(vec![(0..8).collect()])]);
    }

    fn punct_items() -> Vec<PunctRepairItem> {
        vec![
            PunctRepairItem {
                id: "s01".to_owned(),
                text: "我们先看第一个问题 ⏸ 这个模型在训练的时候没有见过这样的数据 ⏸⏸ 所以它的表现会差一些 然后我们再看第二个问题".to_owned(),
                min_sentences: 3,
            },
            PunctRepairItem {
                id: "s02".to_owned(),
                text: "<<<so we start with the data ⏸ then we train the model and then we evaluate it on the held-out set".to_owned(),
                min_sentences: 2,
            },
        ]
    }

    /// punct-repair 快乐路径：栅栏带 id、句块之间空行；答案只加标点、把 ⏸
    /// 剥掉、软换行折叠；乱序与丢掉 `min-sentences` 属性都被宽容处理。
    #[test]
    fn punct_repair_accepts_punctuation_only_answers_per_sentence() {
        let payload = render_punct_repair_page(&punct_items());
        assert!(payload.contains("<<<SENTENCE-BEGIN id=s01 min-sentences=3>>>"));
        assert!(payload.contains("<<<SENTENCE-END id=s01>>>"));
        assert!(payload.contains("\n <<<so we start"), "哨兵行首需中和");
        let answer = "<<<SENTENCE-BEGIN id=s02>>>\nSo we start with the data.\nThen we train the model, and then we evaluate it on the held-out set.\n<<<SENTENCE-END id=s02>>>\n\n<<<SENTENCE-BEGIN id=s01>>>\n我们先看第一个问题。这个模型在训练的时候没有见过这样的数据，所以它的表现会差一些。然后我们再看第二个问题。\n<<<SENTENCE-END id=s01>>>\n";
        let parsed = parse_punct_repair_page(&payload, answer);
        assert!(
            parsed.diagnostics.problems.is_empty(),
            "{:?}",
            parsed.diagnostics.problems
        );
        assert_eq!(
            parsed.sentences,
            vec![
                Some(
                    "我们先看第一个问题。这个模型在训练的时候没有见过这样的数据，所以它的表现会差一些。然后我们再看第二个问题。"
                        .to_owned()
                ),
                Some(
                    "So we start with the data. Then we train the model, and then we evaluate it on the held-out set."
                        .to_owned()
                ),
            ]
        );
    }

    /// 逐句拒收：改词判 `source-drift`、没加句末判 `sentence-oversize`、缺块判
    /// `missing-id`、`。，` 判质量闸门；一句被拒不连累其他句。
    #[test]
    fn punct_repair_rejects_word_edits_missing_ends_and_conflicting_marks() {
        let payload = render_punct_repair_page(&punct_items());
        // s01 改了一个词（“差一些”→“好一些”），s02 原样复述没加任何句末。
        let answer = "<<<SENTENCE-BEGIN id=s01>>>\n我们先看第一个问题。这个模型在训练的时候没有见过这样的数据，所以它的表现会好一些。然后我们再看第二个问题。\n<<<SENTENCE-END id=s01>>>\n<<<SENTENCE-BEGIN id=s02>>>\nso we start with the data, then we train the model and then we evaluate it on the held-out set\n<<<SENTENCE-END id=s02>>>\n";
        let parsed = parse_punct_repair_page(&payload, answer);
        assert_eq!(parsed.sentences, vec![None, None]);
        let codes: Vec<ProblemCode> = parsed.diagnostics.problems.iter().map(|p| p.code).collect();
        assert_eq!(
            codes,
            vec![ProblemCode::SourceDrift, ProblemCode::SentenceOversize]
        );
        assert_eq!(
            parsed.diagnostics.problems[0].scope,
            ProblemScope::Sentence {
                id: "s01".to_owned()
            }
        );
        assert!(
            parsed.diagnostics.problems[0].detail.contains("被改写"),
            "{}",
            parsed.diagnostics.problems[0].detail
        );
        assert!(
            parsed.diagnostics.problems[1]
                .detail
                .contains("未新增任何句末标点"),
            "{}",
            parsed.diagnostics.problems[1].detail
        );

        // s02 缺失、s01 留下 `。，`：冲突标点由代码归一（R2），s01 照常通过。
        let answer = "<<<SENTENCE-BEGIN id=s01>>>\n我们先看第一个问题。，这个模型在训练的时候没有见过这样的数据，所以它的表现会差一些。然后我们再看第二个问题。\n<<<SENTENCE-END id=s01>>>\n";
        let parsed = parse_punct_repair_page(&payload, answer);
        assert!(parsed.sentences[0].is_some());
        assert!(!crate::seam::contains_conflicting_punctuation(
            parsed.sentences[0].as_deref().unwrap()
        ));
        assert!(parsed.sentences[1].is_none());
        let codes: Vec<ProblemCode> = parsed.diagnostics.problems.iter().map(|p| p.code).collect();
        assert_eq!(codes, vec![ProblemCode::MissingId]);
        assert!(
            parsed
                .diagnostics
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::PunctuationNormalized)
        );

        // 只坏一句：s02 通过、s01 增了一个词。
        let answer = "<<<SENTENCE-BEGIN id=s01>>>\n我们先看第一个问题。这个模型在训练的时候其实没有见过这样的数据，所以它的表现会差一些。然后我们再看第二个问题。\n<<<SENTENCE-END id=s01>>>\n<<<SENTENCE-BEGIN id=s02>>>\nSo we start with the data. Then we train the model and then we evaluate it on the held-out set.\n<<<SENTENCE-END id=s02>>>\n";
        let parsed = parse_punct_repair_page(&payload, answer);
        assert!(parsed.sentences[0].is_none());
        assert!(parsed.sentences[1].is_some());
        assert_eq!(parsed.diagnostics.problems.len(), 1);
        assert!(
            parsed.diagnostics.problems[0].detail.contains("被增删"),
            "{}",
            parsed.diagnostics.problems[0].detail
        );
    }
}
