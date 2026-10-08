//! 分页（源自 voice-ink `PipelinePagination.paginateWordRanges`，现为均衡版）。
//!
//! 页数先按 `ceil(总词数 / (预算 + slack))` 确定——slack 是每页允许的溢出
//! 冗余，词数只比 N 页预算多出一小截时不再为尾巴多切一页；随后每页目标取
//! 「剩余词数 / 剩余页数」，避免贪心装填留下碎尾页（预算 6000、全文 24200
//! 时应是 4 页 ×6050，而不是 8000 时代的 3 页 + 200 词尾页）。断点仍在页
//! 目标最后 20% 窗口内按 rank 选取：说话人切换(3) > 长停顿(2) > 句末标点(1)
//! > 无(0)，平局取靠后者；末页过短并入前页。分页边界不落盘——从指纹化的
//! 词流确定性重导出。
//!
//! 有说话人信息时还可以把分页单位从"词流 + 断点评分"抬到**轮次序列**
//! （[`turn_boundary_cut`]，polish 载体在用）：页 = 连续整轮次的并，词预算
//! 目标不变；只有单独超预算的长轮次才在内部按句界切开。无说话人信息的
//! 文档不进这条路径，逐页结果与改造前相同。

use crate::atomize::{sentence_end, word_count};
use crate::doc::Word;

/// 页预算，全部按 [`crate::atomize::word_count`] 的语言感知词数计量：
/// Latin 按词，CJK 按字，依附标点不单独计数。
pub mod budgets {
    pub const ORGANIZE: usize = 12000;
    pub const SEGMENT: usize = 8000;
    pub const ANALYSIS: usize = 8000;
    /// 分章节 Map 页预算（段落为原子）；一页以下直接单次出章节，多页走
    /// Map/Reduce。与 segment/analysis 同档：一次调用能稳妥读完、并行页数适中。
    pub const CHAPTERS: usize = 8000;
    /// 文件契约（`file-v1`）的翻译/对齐页预算（§12），按执行器分档。
    ///
    /// 单位是词数（口径见 [`crate::atomize::word_count`]）：Latin 一词约
    /// 5.5 字符，按词计量语言中立，CJK 与 Latin 页的信息密度一致。
    ///
    /// 翻译与对齐都只按源文词数分页，不再叠加句数、字符数或 worker 槽位档。
    /// 两档的动机相同——单页应答时长近似随页词数线性，页数太少喂不满并发
    /// ——但两类执行器的单页曲线差很多：
    ///
    /// - **Agent worker**（外部编码代理会话逐句手写答案）：实测 5000 词页
    ///   一个 worker 要 5–11 分钟，193 句谈话（3571 词）在 5000 档下只有
    ///   1 页，多 worker 槽全部闲置。2000 + 10% slack 让一场 30 分钟谈话
    ///   分成 2–3 页并行认领，单页落到 2–4 分钟量级，租约超时与整页重做的
    ///   敞口也随之缩小。
    /// - **Provider 直连**（云模型一次生成整页）：单页时长以输出 token 为主，
    ///   近似随页词数线性，而并发泳道（默认 8）通常吃不满——把页切小就是把
    ///   串行的输出时间摊到并行泳道上。DeepSeek v4-flash 实测（brief 已缓存）：
    ///   3571 词谈话 4000 档 1 页 147/208s，2000 档 2 页 108/95s；9784 词谈话
    ///   4000 档 3 页 244s，2000 档 5 页 140s；残余 violations 也更少。因此
    ///   provider 档目前与 agent 同为 2000，只多付一次 brief 与页首 system
    ///   prompt；两档仍分开声明，宿主按执行器取档，日后可以独立再调。
    ///
    /// 宿主按执行器取档：[`PageExecutor::translate_words_for`] /
    /// [`PageExecutor::align_words`]。
    pub const TRANSLATE_AGENT_WORDS: usize = 2000;
    pub const ALIGN_AGENT_WORDS: usize = 2000;
    pub const TRANSLATE_PROVIDER_WORDS: usize = 2000;
    pub const ALIGN_PROVIDER_WORDS: usize = 2000;

    /// 融合**行分区**模式（`--align-fusion rows`）的翻译页预算，agent 与
    /// provider 共用一档。
    ///
    /// rows 把每源词的调用成本抬高约 1.6–2×，两侧都变贵：
    ///
    /// - **输入**：覆盖面从"源侧已需拆分"放宽到"≥ 8 词"，且每个覆盖句多带
    ///   一条 `data-align-groups`。实测同一页（30 句混合长度英文）用户载荷
    ///   8928 → 10206 字符。
    /// - **输出**：每个覆盖句要把译文切成 `<span data-src>` 显示行，答案不再
    ///   是"整句一行文本"。provider 单页时长以输出 token 为主（见上），这部分
    ///   直接落在关键路径上。
    ///
    /// 更关键的是**合规率随页长下降**：deepseek-v4-flash 实测一页 59 句时，
    /// 只有输出中最前面 3 句给了行 span，其余 56 句整体退回纯译文（回复完整、
    /// 未截断、给出的 span 本身也合法）——长页会让模型在中途放弃微格式。同一
    /// 模型在较短的页上稳定给出 38/50。
    ///
    /// 因此 rows 档取 **800**（加 10% slack 后单页上限 880 词）。取值经过两轮
    /// 收紧：先按 `2000 / 1.67 ≈ 1200` 落档，第四轮对拍显示 1200 已经让
    /// Trilemma 分成 2 页并行、墙钟 58–61 s → 16–22 s，但同一轮里 Pi Agent 仍
    /// 出现整页 0 span（回复干净、结构完整、就是不给行）。页再切一半是压这个
    /// 敞口最直接的手段：一场 30 分钟谈话（约 3500 词）从 3 页变 4 页，单页
    /// 句数落到 30 上下，正处在实测稳定给行的区间。
    ///
    /// 页级重发是同一件事的另一半：仍然整页缺行时由
    /// [`crate::engines::translate`] 的 soft page retry 原样重发一次（有界，
    /// 每页最多 1 次），两者一起把"整页放弃微格式"从不可恢复变成可恢复。
    ///
    /// 宿主取档：[`PageExecutor::translate_words_for`]。`BCUT_LLM_PAGE_WORDS`
    /// 的覆盖语义不变——设置了就整体覆盖，rows 也不例外。
    pub const TRANSLATE_ROWS_WORDS: usize = 800;
    pub const ORGANIZE_MIN_LAST: usize = 100;
    pub const SEGMENT_MIN_LAST: usize = 200;
    pub const ANALYSIS_MIN_LAST: usize = 500;
}

/// 翻译/对齐页预算的执行器档位（宿主从 `--llm` 模式映射）。
///
/// 只决定 [`budgets`] 里取哪一档源文词预算；分页算法本身
/// （[`balanced_page_sizes`] / [`paginate_word_ranges`]）与执行器无关。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageExecutor {
    /// `--llm agent`：外部 worker 池经任务队列逐页认领。
    Agent,
    /// `--llm provider:<vendor>/<model>`：本进程多泳道直连云模型。
    Provider,
}

impl PageExecutor {
    /// 翻译页预算（源文词数），常规融合/无融合档。
    pub fn translate_words(self) -> usize {
        self.translate_words_for(false)
    }

    /// 翻译页预算（源文词数）。`rows` = `--align-fusion rows`：两种执行器
    /// 共用更小的 [`budgets::TRANSLATE_ROWS_WORDS`] 档（理由见该常量）。
    pub fn translate_words_for(self, rows: bool) -> usize {
        if rows {
            return budgets::TRANSLATE_ROWS_WORDS;
        }
        match self {
            Self::Agent => budgets::TRANSLATE_AGENT_WORDS,
            Self::Provider => budgets::TRANSLATE_PROVIDER_WORDS,
        }
    }

    /// 对齐页预算（源文词数），首轮、定点修复与全局修复轮共用。
    pub fn align_words(self) -> usize {
        match self {
            Self::Agent => budgets::ALIGN_AGENT_WORDS,
            Self::Provider => budgets::ALIGN_PROVIDER_WORDS,
        }
    }
}

/// 每页允许的溢出冗余（预算的 10%）：只用于**页数**计算。
///
/// 总词数只比 N 页预算多出一小截时（例如预算 5000、全文 10300），均衡后每页
/// 5150 仍在可接受区间，不值得为 300 词多切一页多付一次调用。
pub fn page_slack(budget: usize) -> usize {
    budget / 10
}

/// 预算 + slack 下的目标页数（至少 1）。
pub fn page_count_for_total(total_cost: usize, budget: usize) -> usize {
    total_cost
        .div_ceil(budget.max(1) + page_slack(budget))
        .max(1)
}

/// 停顿断点阈值（`Rules.pauseSec`）。
const PAUSE_SEC: f64 = 0.6;

/// 词成本的前缀和（`prefix[i]` = `counts[..i]` 之和），供轮次分页 O(1) 取
/// 任意区间的词预算成本。
pub fn cost_prefix(counts: &[usize]) -> Vec<usize> {
    let mut prefix = Vec::with_capacity(counts.len() + 1);
    prefix.push(0usize);
    for count in counts {
        let last = prefix.last().copied().unwrap_or_default();
        prefix.push(last.saturating_add(*count));
    }
    prefix
}

/// 轮次感知分页的页界选择：在 `(start, limit]` 内挑一个**轮次起点**，使
/// 本页词成本最接近 `target`；平局取靠后者。区间内没有轮次起点时返回
/// `None`——那意味着当前轮次单独就超过了页预算（长独白），调用方改为在
/// 轮次内部按句界取断点。
///
/// 页 = 连续整轮次的并：短轮次（对话、问答）自然成组，页缝不再劈开一个人
/// 的话。`turn_starts` 必须升序（[`crate::speaker::speaker_turns`] 的起点）。
pub fn turn_boundary_cut(
    turn_starts: &[usize],
    prefix_cost: &[usize],
    start: usize,
    limit: usize,
    target: usize,
) -> Option<usize> {
    let base = prefix_cost.get(start).copied()?;
    turn_starts
        .iter()
        .copied()
        .filter(|boundary| *boundary > start && *boundary <= limit)
        .filter_map(|boundary| {
            let cost = prefix_cost.get(boundary)?.saturating_sub(base);
            Some((boundary, cost.abs_diff(target)))
        })
        .reduce(|best, current| if current.1 <= best.1 { current } else { best })
        .map(|(boundary, _)| boundary)
}

/// 词间断点评分：说话人切换 3 > 停顿 2 > 句末 1 > 无 0。
///
/// `word` 为断点左侧词，`next` 为右侧词；分页时在 `word` 之后切开。
pub fn breakpoint_rank(word: &Word, next: &Word) -> u8 {
    if next.sp != word.sp {
        3
    } else if next.t0 - word.t1 >= PAUSE_SEC {
        2
    } else if sentence_end(&word.text) {
        1
    } else {
        0
    }
}

/// 把词流切成页区间 `[start, end)`。
///
/// `max_words` 是**名义**页预算：先经 [`page_count_for_total`]（含 slack）
/// 确定目标页数，再把每页目标定为「剩余词数 / 剩余页数」并在其最后 20%
/// 窗口内找最佳断点。断点按「词位 + rank×(目标/20)」联合评分：语义更强的
/// 断点每档只能换取约 5% 目标词数的提前量，不会一票否决窗口尾部更均衡的
/// 低档断点。目标随剩余量逐页重算，前页略短时后页自动补齐；剩余页数还按
/// `ceil(剩余词数 / (预算 + slack))` 兜底，因此单页实际词数最多超出名义
/// 预算一个 slack——前页亏空过大时宁可多出一页，也不让末页超载。
pub fn paginate_word_ranges(
    words: &[Word],
    max_words: usize,
    min_last_words: usize,
) -> Vec<std::ops::Range<usize>> {
    if words.is_empty() {
        return Vec::new();
    }
    let counts: Vec<usize> = words
        .iter()
        .map(|word| word_count(&word.text).max(1))
        .collect();
    let total: usize = counts.iter().sum();
    let target_pages = page_count_for_total(total, max_words);

    let page_cap = max_words.max(1) + page_slack(max_words);
    let mut pages: Vec<std::ops::Range<usize>> = Vec::new();
    let mut start = 0;
    let mut remaining = total;
    let mut last_page_words = 0;
    while start < words.len() {
        let cap_pages = remaining.div_ceil(page_cap).max(1);
        let pages_left = target_pages
            .saturating_sub(pages.len())
            .max(cap_pages)
            .max(1);
        let page_target = remaining.div_ceil(pages_left).max(1);
        let window_floor = (page_target as f64 * 0.8) as usize;
        let rank_bonus = (page_target / 20).max(1) as i64;
        let mut page_words = 0;
        let mut end = start;
        let mut candidate: Option<(usize, i64)> = None; // (idx, 联合评分)
        while end < words.len() {
            let add = counts[end];
            if page_words + add > page_target && end > start {
                break;
            }
            page_words += add;
            if page_words >= window_floor && end + 1 < words.len() {
                let rank = breakpoint_rank(&words[end], &words[end + 1]);
                // 评分 = 词位 + rank 加成；平局取靠后者(>=)。
                if rank > 0 {
                    let score = page_words as i64 + i64::from(rank) * rank_bonus;
                    if candidate.is_none_or(|(_, s)| score >= s) {
                        candidate = Some((end, score));
                    }
                }
            }
            end += 1;
        }
        if end >= words.len() {
            pages.push(start..words.len());
            last_page_words = page_words;
            break;
        }
        let cut = candidate.map_or(end, |(idx, _)| idx + 1);
        pages.push(start..cut);
        remaining = remaining.saturating_sub(counts[start..cut].iter().sum::<usize>());
        start = cut;
    }
    if pages.len() > 1
        && last_page_words < min_last_words
        && let Some(last) = pages.last().cloned()
    {
        let previous = pages.len() - 2;
        pages[previous] = pages[previous].start..last.end;
        pages.pop();
    }
    pages
}

/// 在固定页数与每页条数上限下，按顺序切分条目，并最小化最重一页的成本。
///
/// 二分搜索最小可行的最大页成本，再按该上限贪心构造恰好指定数量的连续页；
/// 结果确定、顺序不变，复杂度为 O(n log Σcost)。返回每页条目数，Σ = 条目
/// 总数。调用方可用原始源文预算决定页数，再用更接近真实请求复杂度的
/// `item_costs` 均衡长尾，而不改变调用次数。
pub fn balanced_page_sizes_for_count(
    item_costs: &[usize],
    page_count: usize,
    max_items: usize,
) -> Vec<usize> {
    if item_costs.is_empty() {
        return Vec::new();
    }
    let item_count = item_costs.len();
    let max_items = max_items.max(1).min(item_count);
    let pages = page_count
        .max(item_count.div_ceil(max_items))
        .clamp(1, item_count);

    let total = item_costs
        .iter()
        .fold(0_usize, |sum, cost| sum.saturating_add(*cost));
    let mut low = item_costs
        .iter()
        .copied()
        .max()
        .unwrap_or_default()
        .max(total.div_ceil(pages));
    let mut high = total.max(low);
    let required_pages = |costs: &[usize], capacity: usize| {
        if costs.is_empty() {
            return 0;
        }
        let mut needed = 1_usize;
        let mut page_cost = 0_usize;
        let mut page_items = 0_usize;
        for &cost in costs {
            if page_items == max_items
                || (page_items > 0 && page_cost.saturating_add(cost) > capacity)
            {
                needed += 1;
                page_cost = 0;
                page_items = 0;
            }
            page_cost = page_cost.saturating_add(cost);
            page_items += 1;
        }
        needed
    };
    while low < high {
        let middle = low + (high - low) / 2;
        if required_pages(item_costs, middle) <= pages {
            high = middle;
        } else {
            low = middle + 1;
        }
    }

    let capacity = low;
    let mut prefix = Vec::with_capacity(item_count + 1);
    prefix.push(0_usize);
    for &cost in item_costs {
        prefix.push(
            prefix
                .last()
                .copied()
                .unwrap_or_default()
                .saturating_add(cost),
        );
    }
    let mut sizes = Vec::with_capacity(pages);
    let mut start = 0_usize;
    for page in 0..pages {
        let remaining_pages = pages - page - 1;
        let min_end =
            (start + 1).max(item_count.saturating_sub(remaining_pages.saturating_mul(max_items)));
        let max_end = item_count
            .saturating_sub(remaining_pages)
            .min(start.saturating_add(max_items));
        let remaining_cost = prefix[item_count].saturating_sub(prefix[start]);
        let target = remaining_cost.div_ceil(remaining_pages + 1);
        let mut end = min_end;
        let mut best_diff = usize::MAX;
        for candidate in min_end..=max_end {
            let page_cost = prefix[candidate].saturating_sub(prefix[start]);
            if page_cost > capacity {
                break;
            }
            let diff = page_cost.abs_diff(target);
            if diff < best_diff {
                best_diff = diff;
                end = candidate;
            }
        }
        // 靠均值选出的早边界若让后缀需要过多页，向右扩到后缀可行；最小
        // capacity 的全局贪心边界保证一定能在当前页上限内找到该位置。
        while remaining_pages > 0 && required_pages(&item_costs[end..], capacity) > remaining_pages
        {
            end += 1;
            debug_assert!(end <= max_end);
            debug_assert!(prefix[end].saturating_sub(prefix[start]) <= capacity);
        }
        debug_assert!(end > start);
        sizes.push(end - start);
        start = end;
    }
    debug_assert_eq!(start, item_count);
    sizes
}

/// 均衡分页：按预算 + slack 先算最少页数（[`page_count_for_total`]），再用
/// [`balanced_page_sizes_for_count`] 最小化最重一页的成本。
///
/// 贪心装填会在结尾留碎尾页（G3 基线实测 67 句 → 31/30/6），碎页独占一次
/// LLM 调用与一个 worker 回合；均分（→ 23/22/22）同时缩短最大页——并行
/// 派发下批次墙钟就是最大页的应答时间。slack 则挡住另一头的浪费：总量只比
/// N 页预算多一小截时不为尾巴多付一次调用。
pub fn balanced_page_sizes(item_costs: &[usize], budget: usize) -> Vec<usize> {
    if item_costs.is_empty() {
        return Vec::new();
    }
    let total = item_costs
        .iter()
        .fold(0_usize, |sum, cost| sum.saturating_add(*cost));
    let pages = page_count_for_total(total, budget).clamp(1, item_costs.len());
    balanced_page_sizes_for_count(item_costs, pages, item_costs.len())
}

/// 同时受成本预算和每页条数上限约束的均衡分页。页数取两种约束所需页数的
/// 较大值，随后仍按连续顺序最小化最大页成本。
pub fn balanced_bounded_page_sizes(
    item_costs: &[usize],
    budget: usize,
    max_items: usize,
) -> Vec<usize> {
    if item_costs.is_empty() {
        return Vec::new();
    }
    let max_items = max_items.max(1);
    let total = item_costs
        .iter()
        .fold(0_usize, |sum, cost| sum.saturating_add(*cost));
    let pages = page_count_for_total(total, budget)
        .max(item_costs.len().div_ceil(max_items))
        .clamp(1, item_costs.len());
    balanced_page_sizes_for_count(item_costs, pages, max_items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(t0: f64, t1: f64, text: &str, sp: &str) -> Word {
        Word {
            id: format!("g{t0}"),
            t0,
            t1,
            text: text.to_owned(),
            sp: sp.to_owned(),
            glue: false,
        }
    }

    #[test]
    fn prefers_higher_ranked_speaker_boundary() {
        // 5 词,预算容 3 词多一点;窗口内既有句末(rank1)也有说话人切换(rank3)。
        let words = vec![
            word(0.0, 1.0, "aaaa.", "s1"),
            word(1.0, 2.0, "bbbb", "s1"),
            word(2.0, 3.0, "cccc.", "s1"),
            word(3.1, 4.0, "dddd", "s2"),
            word(4.0, 5.0, "eeee", "s2"),
        ];
        let pages = paginate_word_ranges(&words, 3, 1);
        assert_eq!(pages, vec![0..3, 3..5]);
    }

    #[test]
    fn turn_cut_picks_the_boundary_closest_to_the_word_target() {
        let counts = vec![1usize; 12];
        let prefix = cost_prefix(&counts);
        assert_eq!(prefix.last(), Some(&12));
        let turn_starts = vec![0usize, 2, 5, 9];
        // 目标 4：候选 2(差2) / 5(差1) / 9(超出上限) → 取 5。
        assert_eq!(turn_boundary_cut(&turn_starts, &prefix, 0, 6, 4), Some(5));
        // 平局取靠后者：目标 3.5 时 2 与 5 等距。
        assert_eq!(turn_boundary_cut(&turn_starts, &prefix, 0, 6, 3), Some(2));
        assert_eq!(turn_boundary_cut(&turn_starts, &prefix, 0, 6, 4), Some(5));
        // 上限内没有轮次起点（长轮次）→ None，调用方改走句界。
        assert_eq!(turn_boundary_cut(&turn_starts, &prefix, 5, 8, 3), None);
        // 只剩一个偏短的候选时仍取它——下一轮次超预算，留给它自己的页。
        assert_eq!(turn_boundary_cut(&turn_starts, &prefix, 2, 6, 9), Some(5));
    }

    #[test]
    fn short_last_page_merges_into_previous() {
        let words: Vec<Word> = (0..5)
            .map(|i| word(i as f64, i as f64 + 1.0, "aaaa", "s1"))
            .collect();
        let pages = paginate_word_ranges(&words, 2, 2);
        assert_eq!(pages, vec![0..2, 2..5]);
        for pair in pages.windows(2) {
            assert_eq!(pair[0].end, pair[1].start);
        }
        assert_eq!(pages.first().unwrap().start, 0);
    }

    #[test]
    fn single_page_when_budget_fits_all() {
        let words: Vec<Word> = (0..3)
            .map(|i| word(i as f64, i as f64 + 1.0, "hi", "s1"))
            .collect();
        assert_eq!(paginate_word_ranges(&words, 1000, 10), vec![0..3]);
    }

    #[test]
    fn page_cost_uses_language_aware_word_count() {
        let words = vec![
            word(0.0, 1.0, "one two", "s1"),
            word(1.0, 2.0, "三四", "s1"),
            word(2.0, 3.0, "five", "s1"),
        ];
        // 总 5 词、预算 4 → 2 页，均衡后每页目标 3：首页只装下 "one two"
        //（再加 CJK 两字就到 4 超目标）。裸字符计数会得出不同边界。
        assert_eq!(paginate_word_ranges(&words, 4, 1), vec![0..1, 1..3]);
    }

    #[test]
    fn word_pages_balance_instead_of_leaving_a_fragment_tail() {
        // 用户场景：预算 6000、全文 24200 词——旧贪心是 6000×4 + 200 尾页，
        // 均衡后是 4 页 ×6050（slack 600 吸收溢出）。
        let words: Vec<Word> = (0..24_200)
            .map(|i| word(i as f64, i as f64 + 1.0, "aaaa", "s1"))
            .collect();
        let pages = paginate_word_ranges(&words, 6000, 200);
        assert_eq!(pages.len(), 4);
        assert_eq!(pages.last().unwrap().end, 24_200);
        for page in &pages {
            let size = page.end - page.start;
            assert!((6000..=6100).contains(&size), "unbalanced page: {size}");
        }
    }

    #[test]
    fn stronger_rank_cannot_veto_a_much_later_breakpoint() {
        // 真实词流回归：窗口早段有停顿(rank2)、尾段有句末(rank1)。旧逻辑
        // rank 高者一票否决，首页在 42 词处早断、末页超载；联合评分下
        // rank 只值 5% 目标的提前量，应选 48 词处的句末断点。
        let mut words: Vec<Word> = (0..100)
            .map(|i| word(i as f64, i as f64 + 0.9, "aaaa", "s1"))
            .collect();
        words[42].t0 = 42.7; // 41→42 之间 0.8s 停顿（rank2）
        words[47].text = "aaaa.".to_owned(); // 47→48 句末（rank1）
        let pages = paginate_word_ranges(&words, 90, 10);
        assert_eq!(pages, vec![0..48, 48..100]);
    }

    #[test]
    fn accumulated_deficit_adds_a_page_instead_of_overloading_the_tail() {
        // 前两页都只有一个偏早的停顿断点，亏空持续转嫁；cap 兜底应多切一
        // 页，任何一页都不得超过 预算+slack（100+10）。
        let mut words: Vec<Word> = (0..300)
            .map(|i| word(i as f64, i as f64 + 0.9, "aaaa", "s1"))
            .collect();
        words[80].t0 = 80.7;
        words[168].t0 = 168.7;
        let pages = paginate_word_ranges(&words, 100, 10);
        assert_eq!(pages.first().unwrap().start, 0);
        assert_eq!(pages.last().unwrap().end, 300);
        for pair in pages.windows(2) {
            assert_eq!(pair[0].end, pair[1].start);
        }
        for page in &pages {
            let size = page.end - page.start;
            assert!(size <= 110, "page exceeds budget+slack: {size}");
        }
        assert!(pages.len() >= 3);
    }

    #[test]
    fn slack_absorbs_a_small_overflow_without_an_extra_page() {
        // 8300 词、预算 8000：slack 800 内，单页吃下，不为 300 词付一次调用。
        let words: Vec<Word> = (0..8300)
            .map(|i| word(i as f64, i as f64 + 1.0, "aaaa", "s1"))
            .collect();
        assert_eq!(paginate_word_ranges(&words, 8000, 500), vec![0..8300]);
        assert_eq!(page_count_for_total(8300, 8000), 1);
        // 超过 slack 才分页，且一分就均衡。
        assert_eq!(page_count_for_total(8801, 8000), 2);
        assert_eq!(page_count_for_total(24_200, 6000), 4);
    }

    #[test]
    fn balanced_pages_avoid_fragment_tail() {
        // 67 条等长条目 ×128 = 8576：贪心装填是 31/31/5 的碎尾页；slack
        //（4000+400）先把页数压到 2，均衡再切成 34/33（每页 4352 ≤ 4400）。
        let items = vec![128_usize; 67];
        let sizes = balanced_page_sizes(&items, 4000);
        assert_eq!(sizes.iter().sum::<usize>(), 67);
        assert_eq!(sizes.len(), 2);
        let max = *sizes.iter().max().unwrap();
        let min = *sizes.iter().min().unwrap();
        assert!(max - min <= 1, "sizes not balanced: {sizes:?}");
        // slack 吸收不了时页数照常增长，且仍均衡。
        let items = vec![128_usize; 110];
        let sizes = balanced_page_sizes(&items, 4000);
        assert_eq!(sizes.len(), 4);
        assert!(sizes.iter().max().unwrap() - sizes.iter().min().unwrap() <= 1);
    }

    #[test]
    fn balanced_pages_edge_cases() {
        assert!(balanced_page_sizes(&[], 100).is_empty());
        // 全部塞进单页。
        assert_eq!(balanced_page_sizes(&[10, 20, 30], 1000), vec![3]);
        // 单条超预算仍独占一页，不 panic。
        assert_eq!(balanced_page_sizes(&[5000], 100), vec![1]);
        // 页数不超过条目数。
        assert_eq!(balanced_page_sizes(&[5000, 5000], 100), vec![1, 1]);
        // 变长条目也保持覆盖完整、页数正确。
        let items = vec![900, 100, 100, 900, 100, 900];
        let sizes = balanced_page_sizes(&items, 1000);
        assert_eq!(sizes.iter().sum::<usize>(), items.len());
        assert_eq!(sizes.len(), 3);
    }

    #[test]
    fn fixed_page_count_balances_cost_without_reordering() {
        let items = [50, 50, 1, 1, 1, 1];
        let sizes = balanced_page_sizes_for_count(&items, 2, items.len());
        assert_eq!(sizes, vec![1, 5]);
        assert_eq!(sizes.iter().sum::<usize>(), items.len());
    }

    #[test]
    fn bounded_pages_balance_seventeen_items_in_two_batches() {
        let items = vec![1_600_usize; 17];
        let sizes = balanced_bounded_page_sizes(&items, 20_000, 15);
        assert_eq!(sizes.len(), 2);
        assert_eq!(sizes.iter().sum::<usize>(), 17);
        assert!(sizes.iter().all(|size| *size <= 15));
        assert_eq!(sizes.iter().max().unwrap() - sizes.iter().min().unwrap(), 1);
    }

    #[test]
    fn bounded_pages_respect_hard_item_cap_and_oversized_items() {
        let items = [50_000, 10, 10, 10, 10, 10, 10];
        let sizes = balanced_bounded_page_sizes(&items, 20_000, 3);
        assert_eq!(sizes.iter().sum::<usize>(), items.len());
        assert!(sizes.iter().all(|size| *size <= 3));
        assert_eq!(sizes.first(), Some(&1));
    }

    #[test]
    fn fixed_page_partitioner_matches_small_exhaustive_optimum() {
        fn optimum(costs: &[usize], pages: usize, max_items: usize) -> usize {
            if pages == 1 {
                return (costs.len() <= max_items)
                    .then(|| costs.iter().sum())
                    .unwrap_or(usize::MAX);
            }
            let max_first = max_items.min(costs.len().saturating_sub(pages - 1));
            (1..=max_first)
                .filter_map(|size| {
                    let suffix = optimum(&costs[size..], pages - 1, max_items);
                    (suffix != usize::MAX).then(|| costs[..size].iter().sum::<usize>().max(suffix))
                })
                .min()
                .unwrap_or(usize::MAX)
        }

        for item_count in 1_usize..=6 {
            let combinations = 3_usize.pow(item_count as u32);
            for encoded in 0..combinations {
                let mut value = encoded;
                let costs = (0..item_count)
                    .map(|_| {
                        let cost = value % 3 + 1;
                        value /= 3;
                        cost
                    })
                    .collect::<Vec<_>>();
                for max_items in 1..=item_count {
                    for requested_pages in 1..=item_count {
                        let pages = requested_pages
                            .max(item_count.div_ceil(max_items))
                            .min(item_count);
                        let sizes =
                            balanced_page_sizes_for_count(&costs, requested_pages, max_items);
                        assert_eq!(sizes.len(), pages, "{costs:?}");
                        assert_eq!(sizes.iter().sum::<usize>(), item_count, "{costs:?}");
                        assert!(sizes.iter().all(|size| *size <= max_items), "{costs:?}");
                        let mut cursor = 0_usize;
                        let actual = sizes
                            .iter()
                            .map(|size| {
                                let cost = costs[cursor..cursor + size].iter().sum::<usize>();
                                cursor += size;
                                cost
                            })
                            .max()
                            .unwrap();
                        assert_eq!(
                            actual,
                            optimum(&costs, pages, max_items),
                            "costs={costs:?} sizes={sizes:?}"
                        );
                    }
                }
            }
        }
    }
}
