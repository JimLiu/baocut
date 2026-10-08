//! 断点布局优化：候选断点全局 DP（对齐块方案 §3.3）。
//!
//! Cue 派生算法（§18.5）保持简单、贪心且三端严格一致；展示质量来自这里的
//! 确定性优化器。它把 §18.5 的六条规则当作**候选生成器与最终重放器**：
//!
//! - 硬边界（必断）：用户 `break`、说话人切换、`paraBreaks`、句末标点、
//!   英文有足够正文/时长且后接新从句的从句标点
//!   （Sentence 由完整 Cue 聚合，句末不可越过）；
//! - 禁止边界：用户 `nobreak`、英文高置信度悬挂成分与固定词组内部；
//! - 其余位置是软候选，由 DP 整体选择：
//!
//! ```text
//! dp[j] = min over i<j, [i..j) 合法 of dp[i] + cueCost(words[i..j))
//! cueCost = 行宽（预算外重罚；保留语义不可拆单位与显式 nobreak 的可解性）
//!         + 阅读速度罚（cps 超 warn 线性、超 bad 平方；时窗按 lead_in/tail 借静音口径）
//!         + 时长过短（< min_duration）/ 过长（> max_duration）罚
//!         + 接缝罚（沿用 split.rs 标尺：句末 0 < 从句标点 0.3 < 停顿 0.5 < 普通词间 0.8
//!                   < 悬垂冠词/介词/助词尾 1.5 < CJK 词内字界 3.0）
//!         + 孤立短尾罚（< minClauseChars 且贴着软边界）
//!         + 行长失衡罚（欠满平方，只作平局裁决）
//!         + 两行失衡罚（仅 max_lines > 1 的 profile：行内换行 DP 后最宽/最窄行差的平方）
//! ```
//!
//! 接缝罚按「偏离 §18.5 的代价」计：贪心自己会断的位置断开记 0，贪心不断而
//! 我们断开按缝等级计罚，贪心要断而我们压住按被压缝的等级计罚。这样贪心布局
//! 没有语义/可读性问题时最小 pin 集为空。语义禁切位先从候选中移除，不能用
//! 宽度或 CPS 分数换取非法切点。英文短从句不足两条最短展示时长时，允许用
//! overflowSlack 收入尾标点，避免制造闪现片。不可拆词组或用户 nobreak 超宽时
//! 保留完整单位，让宽度检查报告问题；非英文保持原有软罚分与宽度策略。
//!
//! 双行 profile（`LayoutProfile::max_lines = 2`，方案 §3.4）：宽度预算放大到
//! `max_lines × maxChars`，一条 Cue 允许承载两行文字；行内怎么换行由渲染期投影
//! 决定（不落盘），DP 只用 [`line_break_plan_with`] 复算一次换行位置来给"两行
//! 失衡"打分，且换行数超过 `max_lines` 的段视为超宽。`default` profile
//! （`max_lines = 1`）下这些分支全部不参与，逐字节等于单行行为。
//!
//! 输出仍是**最小 pin 集**：与 `auto_break` 重放不一致处才落 `break`/`nobreak`，
//! 写入 `doc.auto_breaks[layoutProfile]`，**绝不写 `doc.breaks`**（那是用户显式意图，
//! 对 DP 是约束）。任何 §18.5 实现（Studio 服务端、designs 原型、Mac 客户端）
//! 从 words + `autoBreaks ⊕ breaks` 重放都得到同一布局，无需各自内置优化器。
//!
//! 典型修复形态（来自真实失败样本）：
//! - 溢出硬断把句尾单词甩成近零时长 Cue（`…reshape the` / `environment.`）
//!   → 缝回移到行宽均衡处；
//! - 停顿断行的句尾片语速过快（`…tools that were` / `once managed
//!   separately.`，>21 cps）→ 缝前移让第二行获得足够时窗。

use std::collections::{BTreeMap, BTreeSet};

use crate::atomize::{
    clause_end_char, count_cps_chars, is_cjk_text, join_word_texts, sentence_end, visual_width,
    word_sep,
};
use crate::cue::{CueParams, auto_break, derive_cues};
use crate::doc::{BreakOverride, TranscriptDoc, Word};
use crate::fingerprint::fingerprint_strings;
use crate::layout_profile::{CpsBudget, LayoutProfile, line_break_plan_with};
use crate::seam::{cjk_midword_boundary, ends_dangling};
use crate::source_boundary::{english_clause_start, english_cue_boundary_issue};

/// 缝罚分标尺（与 `split.rs::seam_penalty` 同一阶梯；句末是硬边界不参与）。
const SEAM_CLAUSE: f64 = 0.3;
const SEAM_PAUSE: f64 = 0.5;
const SEAM_WORD: f64 = 0.8;
/// 悬垂冠词/介词/助词后的缝（`seam.rs::ends_dangling`）：语法上不可停顿，
/// 但源词是 ASR 原子，长句里未必有更好的缝，故重罚不禁止。
const SEAM_DANGLING: f64 = 1.5;
/// CJK 词内字界（两侧都是表意字且无标点/空白）：与 `split.rs` 的无缝档同量级。
const SEAM_CJK_MIDWORD: f64 = 3.0;
/// 阅读速度：cps 越过 warn 到 bad 的区间记满 0.5（线性），越过 bad 后再按
/// 「超出量 / (bad−warn)」平方 ×4——一条 23.5 cps 的拉丁行 ≈ 2.1，足以买动
/// 一次移缝（0.8）加一次压缝（0.5）。
const READING_WARN_LINEAR: f64 = 0.5;
const READING_BAD_QUADRATIC: f64 = 4.0;
/// 时长：短于 min_duration 按缺口比例线性 ×3（0.58 s 的孤儿尾 ≈ 1.25，买得动
/// 一次移缝）；长于 max_duration 按超出比例 ×2。
const SHORT_DURATION_PENALTY: f64 = 3.0;
const LONG_DURATION_PENALTY: f64 = 2.0;
/// 孤立短段（< minClauseChars 且贴着软边界）按短缺比例 ×1。
const ORPHAN_PENALTY: f64 = 1.0;
/// 超过 maxChars：视为无穷（保持有限只是为了 DP 在用户 nobreak 焊死或单词
/// 本身超宽时仍有解，且越宽越差）。
const OVERWIDE_PENALTY: f64 = 1e6;
/// 欠满平方项权重：只做平局裁决，任何一次偏离（≥ 0.3）都买不动。
const UNDERFILL_WEIGHT: f64 = 0.1;
/// 两行失衡权重（仅 `max_lines > 1`）：最宽行与最窄行之差占单行宽的比例平方。
/// 一行 42、一行 21 时 ≈ 0.25，能买动一次欠满平局但买不动一次移缝（0.8）。
const LINE_IMBALANCE_WEIGHT: f64 = 1.0;

/// 文档脚本的阅读速度预算：取前 80 个词判定 CJK（Han/Kana/Hangul）。
fn reading_budget(words: &[Word], profile: &LayoutProfile) -> CpsBudget {
    let sample: String = words
        .iter()
        .take(80)
        .map(|word| word.text.as_str())
        .collect();
    profile.cps_for_script(is_cjk_text(&sample))
}

/// 边界分类（词 `k` 之后的缝）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Seam {
    /// 必断：末词、用户 break、说话人切换、段落钉、句末、受保护的英文从句标点。
    Hard,
    /// 禁断：用户 nobreak 或英文已识别的非法词组边界，硬边界仍压过它。
    Forbidden,
    /// 软候选。
    Soft,
}

fn classify_seams(
    words: &[Word],
    user: &BTreeMap<String, BreakOverride>,
    para_breaks: &BTreeMap<String, bool>,
    english: bool,
    params: &CueParams,
    min_duration: f64,
) -> Vec<Seam> {
    let texts: Vec<_> = words.iter().map(|word| word.text.as_str()).collect();
    let mut clause_start = 0;
    let mut clause_width = 0;
    (0..words.len())
        .map(|k| {
            let Some(next) = words.get(k + 1) else {
                return Seam::Hard;
            };
            let word = &words[k];
            if k > clause_start {
                clause_width += word_sep(&words[k - 1].text, word);
            }
            clause_width += visual_width(&word.text);
            // 判据只需局部词窗，避免每个切点扫描整篇前缀，使长文稿保持线性预处理。
            let start = k.saturating_sub(2);
            let end = (k + 4).min(words.len());
            let seam = if next.sp != word.sp || para_breaks.get(&next.id).copied().unwrap_or(false)
            {
                Seam::Hard
            } else {
                match user.get(&word.id) {
                    Some(BreakOverride::Break) => Seam::Hard,
                    Some(BreakOverride::Nobreak) => Seam::Forbidden,
                    None if sentence_end(&word.text) => Seam::Hard,
                    None if english
                        && english_cue_boundary_issue(&texts[start..end], k + 1 - start)
                            .is_some() =>
                    {
                        Seam::Forbidden
                    }
                    None if english
                        && clause_end_char(&word.text).is_some()
                        && english_clause_start(&next.text)
                        && clause_width >= params.min_clause_chars
                        && word.t1 - words[clause_start].t0 >= min_duration =>
                    {
                        Seam::Hard
                    }
                    None => Seam::Soft,
                }
            };
            if seam == Seam::Hard || clause_end_char(&word.text).is_some() {
                clause_start = k + 1;
                clause_width = 0;
            }
            seam
        })
        .collect()
}

/// 规则版缝等级（低 = 更愿意在此断）：标点 > 停顿 > CJK 词内字界 > 普通词界。
fn seam_grade(word: &Word, next: &Word, params: &CueParams) -> f64 {
    if clause_end_char(&word.text).is_some() {
        SEAM_CLAUSE
    } else if next.t0 - word.t1 >= params.pause_sec {
        SEAM_PAUSE
    } else if next.glue || cjk_midword_boundary(&word.text, &next.text) {
        // 带「贴前」标记的缝没有空格，与表意字之间的字缝同档。
        SEAM_CJK_MIDWORD
    } else {
        SEAM_WORD
    }
}

/// 悬垂尾罚：无论贪心是否会在此断（贪心的溢出臂常把 `the` / `to` 甩在行尾），
/// 缝落在悬垂冠词/介词/助词后都计罚，DP 有更好的缝就会移开。
fn dangling_cost(word: &Word) -> f64 {
    if clause_end_char(&word.text).is_none() && ends_dangling(&word.text) {
        SEAM_DANGLING
    } else {
        0.0
    }
}

/// 贪心在此处要断而被压住的代价：从句/停顿档按缝等级计，溢出档由行宽罚承担。
fn suppression_cost(word: &Word, next: &Word, line_chars: usize, params: &CueParams) -> f64 {
    if let Some(punct) = clause_end_char(&word.text) {
        let gate = if punct == '—' || punct == '–' {
            params.min_dash_chars
        } else {
            params.min_clause_chars
        };
        if line_chars >= gate {
            return SEAM_CLAUSE;
        }
    }
    if next.t0 - word.t1 >= params.pause_sec && line_chars >= params.min_pause_chars {
        return SEAM_PAUSE;
    }
    0.0
}

struct Optimizer<'a> {
    words: &'a [Word],
    seams: Vec<Seam>,
    params: &'a CueParams,
    profile: &'a LayoutProfile,
    budget: CpsBudget,
    english: bool,
}

impl Optimizer<'_> {
    /// profile 行数（至少 1）。
    fn max_lines(&self) -> usize {
        usize::from(self.profile.max_lines.max(1))
    }

    /// 一条 Cue 的宽度预算：`max_lines × maxChars`（单行 profile 即 `maxChars`）。
    fn width_budget(&self) -> usize {
        self.params.max_chars * self.max_lines()
    }

    /// 两行失衡罚（方案 §3.4）：只对 `max_lines > 1` 且宽度已越过单行的段计算。
    /// 复用 studio `sourceDisplayLines` 的均衡 + 边界罚分口径（Rust 移植
    /// [`line_break_plan_with`]，宽度按 `visual_width` 与本文件其余尺度一致），
    /// 换行数超过 `max_lines` 视为超宽（与行宽无穷罚同档）。
    fn line_imbalance_cost(&self, words: &[Word], width: usize) -> f64 {
        let max_lines = self.max_lines();
        let max_chars = self.params.max_chars;
        if max_lines <= 1 || width <= max_chars {
            return 0.0;
        }
        let plan = line_break_plan_with(words, max_lines, max_chars, visual_width);
        if plan.len() > max_lines {
            return OVERWIDE_PENALTY + (plan.len() - max_lines) as f64 * 1e3;
        }
        let widths: Vec<usize> = plan
            .iter()
            .map(|line| visual_width(&join_word_texts(line.iter().map(|&index| &words[index]))))
            .collect();
        let widest = widths.iter().copied().max().unwrap_or(0);
        let narrowest = widths.iter().copied().min().unwrap_or(0);
        let imbalance = (widest - narrowest) as f64 / max_chars.max(1) as f64;
        LINE_IMBALANCE_WEIGHT * imbalance * imbalance
    }

    fn gap_before(&self, i: usize) -> f64 {
        if i == 0 {
            f64::INFINITY
        } else {
            self.words[i].t0 - self.words[i - 1].t1
        }
    }

    fn gap_after(&self, j: usize) -> f64 {
        if j >= self.words.len() {
            f64::INFINITY
        } else {
            self.words[j].t0 - self.words[j - 1].t1
        }
    }

    /// `[i..j)` 作为一条 Cue 的代价（不含无穷宽度以外的合法性判断）。
    fn segment_cost(&self, i: usize, j: usize) -> f64 {
        let words = &self.words[i..j];
        let params = self.params;
        let mut cost = 0.0;

        // 沿段内重放贪心：压住的贪心断点计罚；末缝按偏离计。
        let mut line = 0_usize;
        for (offset, word) in words.iter().enumerate() {
            if offset > 0 {
                line += word_sep(&words[offset - 1].text, word);
            }
            line += visual_width(&word.text);
            let k = i + offset;
            let Some(next) = self.words.get(k + 1) else {
                break;
            };
            let greedy = auto_break(word, next, line, params);
            if k + 1 < j {
                if greedy && self.seams[k] == Seam::Soft {
                    cost += suppression_cost(word, next, line, params);
                }
            } else if self.seams[k] == Seam::Soft {
                if !greedy {
                    cost += seam_grade(word, next, params);
                }
                cost += dangling_cost(word);
            }
        }

        // 行宽（双行 profile 下预算是 max_lines × maxChars）。
        let width = visual_width(&join_word_texts(words));
        let max_chars = self.width_budget();
        // 两条各至少 min_duration 的 Cue 放不下这个短从句时，允许用既有
        // overflow_slack 收入尾标点，避免 “I think | that's ... world.” 闪现片。
        // 长句仍在正常宽度内选合法切点；不把余量扩成所有行的新目标。
        let short_clause_slack = self.english
            && (clause_end_char(&words[words.len() - 1].text).is_some()
                || sentence_end(&words[words.len() - 1].text))
            && words[words.len() - 1].t1 - words[0].t0 < 2.0 * self.profile.min_duration_sec
            && width <= max_chars + params.overflow_slack;
        if width > max_chars && !short_clause_slack {
            cost += OVERWIDE_PENALTY + (width - max_chars) as f64 * 1e3;
        } else {
            let slack = max_chars.abs_diff(width) as f64 / max_chars.max(1) as f64;
            cost += UNDERFILL_WEIGHT * slack * slack;
        }
        cost += self.line_imbalance_cost(words, width);

        // 阅读速度与时长（借静音口径与屏幕呈现一致）。
        let window = self.profile.display_window(
            words[0].t0,
            words[words.len() - 1].t1,
            self.gap_before(i),
            self.gap_after(j),
        );
        let chars = words
            .iter()
            .map(|word| count_cps_chars(&word.text))
            .sum::<usize>() as f64;
        let CpsBudget { warn, bad, .. } = self.budget;
        let span = (bad - warn).max(f64::EPSILON);
        let cps = if window > 0.0 {
            chars / window
        } else {
            f64::INFINITY
        };
        if cps.is_finite() {
            if cps > warn {
                cost += READING_WARN_LINEAR * (cps - warn) / span;
            }
            if cps > bad {
                let over = (cps - bad) / span;
                cost += READING_BAD_QUADRATIC * over * over;
            }
        } else if chars > 0.0 {
            cost += READING_WARN_LINEAR + READING_BAD_QUADRATIC * 100.0;
        }
        let min_duration = self.profile.min_duration_sec;
        if min_duration > 0.0 && window < min_duration {
            cost += SHORT_DURATION_PENALTY * (min_duration - window) / min_duration;
        }
        let max_duration = self.profile.max_duration_sec;
        if max_duration > 0.0 && window > max_duration {
            cost += LONG_DURATION_PENALTY * (window - max_duration) / max_duration;
        }

        // 孤立短段：贴着软边界的过窄段。
        let start_soft = i > 0 && self.seams[i - 1] == Seam::Soft;
        let end_soft = self.seams[j - 1] == Seam::Soft;
        if width < params.min_clause_chars && (start_soft || end_soft) {
            cost += ORPHAN_PENALTY * (params.min_clause_chars - width) as f64
                / params.min_clause_chars.max(1) as f64;
        }
        cost
    }

    /// 在硬边界切出的一个块 `[start..=end]` 内求最优分段，返回各段末词下标。
    fn solve_block(&self, start: usize, end: usize) -> Vec<usize> {
        let n = end - start + 1;
        let max_chars = self.width_budget()
            + if self.english {
                self.params.overflow_slack
            } else {
                0
            };
        let mut dp = vec![f64::INFINITY; n + 1];
        let mut prev = vec![usize::MAX; n + 1];
        dp[0] = 0.0;
        for i in 0..n {
            if !dp[i].is_finite() {
                continue;
            }
            let mut width = 0_usize;
            let mut found_end = false;
            for j in (i + 1)..=n {
                let k = start + j - 1;
                if j > i + 1 {
                    width += word_sep(&self.words[k - 1].text, &self.words[k]);
                }
                width += visual_width(&self.words[k].text);
                if self.seams[k] != Seam::Forbidden {
                    let candidate = dp[i] + self.segment_cost(start + i, k + 1);
                    if candidate < dp[j] {
                        dp[j] = candidate;
                        prev[j] = i;
                    }
                    found_end = true;
                }
                if width > max_chars && found_end {
                    break;
                }
            }
        }
        let mut ends = Vec::new();
        let mut cursor = n;
        while cursor > 0 {
            ends.push(start + cursor - 1);
            cursor = prev[cursor];
        }
        ends.reverse();
        ends
    }

    /// 全文最优 Cue 末词集合。
    fn desired_ends(&self) -> BTreeSet<usize> {
        let mut ends = BTreeSet::new();
        let mut start = 0;
        for k in 0..self.words.len() {
            if self.seams[k] == Seam::Hard {
                ends.extend(self.solve_block(start, k));
                start = k + 1;
            }
        }
        ends
    }
}

/// 布局层的可见词（非空 id 且未 hidden），顺序即 `doc.words` 顺序。
fn visible_words(doc: &TranscriptDoc) -> Vec<Word> {
    doc.words
        .iter()
        .filter(|word| !word.id.is_empty())
        .filter(|word| !doc.hidden.get(&word.id).copied().unwrap_or(false))
        .cloned()
        .collect()
}

/// `stages.asrLayout` 指纹的组成串：用户版式串
/// （[`TranscriptDoc::layout_strings`]，已排序）。
pub fn layout_fingerprint_strings(doc: &TranscriptDoc) -> Vec<String> {
    doc.layout_strings()
}

/// [`layout_fingerprint_strings`] 的指纹值：写进 `stages.asrLayout` 的串。
pub fn layout_fingerprint(doc: &TranscriptDoc) -> String {
    fingerprint_strings(layout_fingerprint_strings(doc))
}

/// 计算均衡布局的最小自动 pin 集（写入 `autoBreaks[layoutProfile]` 的内容）：
/// 用户 `breaks`、段落钉、说话人与句末为硬约束，其余由候选断点全局 DP 决定；
/// 只在自动阶梯与目标布局不一致、且用户未钉该词处落 `break`/`nobreak`。
/// 段落钉缝显式落 `break`，保证不做段前封口的镜像实现（designs JS / mac
/// Swift）逐词等价。既有 `autoBreaks` 不参与计算，因此重跑幂等。
pub fn balanced_cue_breaks(
    doc: &TranscriptDoc,
    params: &CueParams,
) -> BTreeMap<String, BreakOverride> {
    let visible = visible_words(doc);
    let mut out = BTreeMap::new();
    if visible.len() < 2 {
        return out;
    }
    let profile = LayoutProfile::by_id_or_default(doc.layout_profile_id());
    let seams = classify_seams(
        &visible,
        &doc.breaks,
        &doc.para_breaks,
        crate::split::primary_subtag(&doc.lang) == "en",
        params,
        profile.min_duration_sec,
    );
    let optimizer = Optimizer {
        words: &visible,
        seams,
        params,
        profile: &profile,
        budget: reading_budget(&visible, &profile),
        english: crate::split::primary_subtag(&doc.lang) == "en",
    };
    let desired = optimizer.desired_ends();

    let mut line = 0_usize;
    for position in 0..visible.len() {
        let word = &visible[position];
        if line > 0 {
            line += word_sep(&visible[position - 1].text, word);
        }
        line += visual_width(&word.text);
        let Some(next) = visible.get(position + 1) else {
            break;
        };
        if next.sp != word.sp {
            line = 0;
            continue;
        }
        if doc.para_breaks.get(&next.id).copied().unwrap_or(false) {
            out.insert(word.id.clone(), BreakOverride::Break);
            line = 0;
            continue;
        }
        let want = desired.contains(&position);
        if !doc.breaks.contains_key(&word.id) && want != auto_break(word, next, line, params) {
            out.insert(
                word.id.clone(),
                if want {
                    BreakOverride::Break
                } else {
                    BreakOverride::Nobreak
                },
            );
        }
        if want {
            line = 0;
        }
    }
    out
}

/// 用均衡布局钉集覆写 `doc.auto_breaks[layoutProfile]`（空集则移除该 profile
/// 的表）；返回是否有变化。`doc.breaks` 只读。
pub fn apply_balanced_cues(doc: &mut TranscriptDoc, params: &CueParams) -> bool {
    let profile = doc.layout_profile_id().to_owned();
    let pins = balanced_cue_breaks(doc, params);
    let current = doc.auto_breaks.get(&profile);
    if pins.is_empty() {
        return doc.auto_breaks.remove(&profile).is_some();
    }
    if current == Some(&pins) {
        return false;
    }
    doc.auto_breaks.insert(profile, pins);
    true
}

/// 铺设均衡布局：总是运行（用户 `breaks` 与 `paraBreaks` 是硬约束，不再因
/// 「已有钉集」整篇跳过），结果只进 `autoBreaks`。返回是否有变化。
pub fn ensure_balanced_cue_layout(doc: &mut TranscriptDoc, params: &CueParams) -> bool {
    apply_balanced_cues(doc, params)
}

/// 布局出口统计：口径与 designs 原型 `optimizeBreaks` 的
/// `stats.after / stats.longAfter` 一致（`over_width` 为新增的越界计数）。
/// 越界判据是 profile 预算 [`LayoutProfile::cue_width_budget`]（单行 profile 即
/// 自动阶梯的实际天花板 `max_chars + overflow_slack`；双行 profile 为
/// `2 × max_chars + overflow_slack`）；正常管线出口应恒为 `over_width == 0`，
/// 非零即代表布局层放出了预算之外的超宽行，属于回归信号。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CueLayoutStats {
    /// 派生 Cue 条数。
    pub cues: usize,
    /// 最长 Cue 的视觉宽度（CJK 计 2）。
    pub longest_width: usize,
    /// 超过单行预算的 Cue 条数。
    pub over_width: usize,
}

/// 按当前钉表（`autoBreaks ⊕ breaks`）派生 Cue 并统计宽度分布。
pub fn cue_layout_stats(doc: &TranscriptDoc, params: &CueParams) -> CueLayoutStats {
    let budget = LayoutProfile::for_doc(doc).cue_width_budget(params);
    let cues = derive_cues(doc, params);
    let mut stats = CueLayoutStats {
        cues: cues.len(),
        ..CueLayoutStats::default()
    };
    for cue in &cues {
        let width = visual_width(&cue.text(doc));
        stats.longest_width = stats.longest_width.max(width);
        if width > budget {
            stats.over_width += 1;
        }
    }
    stats
}

/// 删除把超宽 Cue 焊死的 `nobreak` 覆盖（用户 `breaks` 与当前 profile 的
/// `autoBreaks` 都查）；普通 `break` 与未造成超宽的 `nobreak` 均保留。超宽
/// 判据取 profile 预算 [`LayoutProfile::cue_width_budget`]：双行 profile 下
/// 优化器焊出的两行 Cue 不算超宽。
///
/// rebind 改变词 id/标点后，旧的布局钉可能从「抑制一个过早断点」变成
/// 「抑制唯一合法断点」，形成无法在 UI/导出层再折行的超宽 Cue。逐轮只移除
/// 超宽 Cue 内的 `nobreak`，让规范自动阶梯重新获得断行权；返回实际移除数。
pub fn remove_overwide_nobreaks(doc: &mut TranscriptDoc, params: &CueParams) -> usize {
    let budget = LayoutProfile::for_doc(doc).cue_width_budget(params);
    let profile = doc.layout_profile_id().to_owned();
    let mut removed = 0usize;
    loop {
        let cues = derive_cues(doc, params);
        let mut targets = BTreeSet::new();
        for cue in cues {
            if visual_width(&cue.text(doc)) <= budget {
                continue;
            }
            for &word_index in cue.word_indices.iter().take(cue.word_indices.len() - 1) {
                let id = &doc.words[word_index].id;
                let user = doc.breaks.get(id) == Some(&BreakOverride::Nobreak);
                let auto = doc
                    .auto_breaks
                    .get(&profile)
                    .and_then(|table| table.get(id))
                    == Some(&BreakOverride::Nobreak);
                if user || auto {
                    targets.insert(id.clone());
                }
            }
        }
        if targets.is_empty() {
            break;
        }
        removed += targets.len();
        for id in targets {
            doc.breaks.remove(&id);
            if let Some(table) = doc.auto_breaks.get_mut(&profile) {
                table.remove(&id);
            }
        }
        doc.auto_breaks.retain(|_, table| !table.is_empty());
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cue::derive_cues;
    use crate::doc::{DocEngine, DocMedia, Speaker};

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

    fn w(id: &str, t0: f64, t1: f64, text: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1,
            text: text.to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        }
    }

    fn cue_texts(doc: &TranscriptDoc) -> Vec<String> {
        derive_cues(doc, &CueParams::default())
            .iter()
            .map(|cue| cue.text(doc))
            .collect()
    }

    fn auto_table(doc: &TranscriptDoc) -> BTreeMap<String, BreakOverride> {
        doc.auto_breaks
            .get(doc.layout_profile_id())
            .cloned()
            .unwrap_or_default()
    }

    #[test]
    fn english_source_cues_preserve_phrases_and_clause_punctuation() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/align/source-cue-boundaries.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let words: Vec<Word> = serde_json::from_value(case["words"].clone()).unwrap();
            let mut doc = doc_with_words(words.clone());
            apply_balanced_cues(&mut doc, &CueParams::default());
            let cues = derive_cues(&doc, &CueParams::default());
            let texts: Vec<_> = cues.iter().map(|cue| cue.text(&doc)).collect();
            eprintln!("{}: {texts:?}", case["name"]);
            for phrase in case["protected"].as_array().unwrap() {
                let phrase = phrase.as_str().unwrap();
                assert!(
                    texts.iter().any(|text| text.contains(phrase)),
                    "{phrase}: {texts:?}"
                );
            }
            for id in case["breakAfter"].as_array().unwrap() {
                assert!(
                    cues.iter()
                        .any(|cue| doc.words[*cue.word_indices.last().unwrap()].id
                            == id.as_str().unwrap()),
                    "{id}: {texts:?}"
                );
            }
            assert_eq!(doc.words, words);
            assert!(doc.breaks.is_empty());
            assert!(!apply_balanced_cues(&mut doc, &CueParams::default()));
        }
    }

    #[test]
    fn semantic_guards_yield_to_user_and_paragraph_boundaries() {
        let mut doc = doc_with_words(vec![
            w("a", 0.0, 1.0, "national"),
            w("b", 1.0, 2.0, "security,"),
            w("c", 2.0, 2.5, "we"),
            w("d", 2.5, 3.0, "agree."),
        ]);
        doc.breaks.insert("a".into(), BreakOverride::Break);
        doc.breaks.insert("b".into(), BreakOverride::Nobreak);
        let user = doc.breaks.clone();
        apply_balanced_cues(&mut doc, &CueParams::default());
        assert_eq!(cue_texts(&doc), ["national", "security, we agree."]);
        assert_eq!(doc.breaks, user);
        doc.breaks.clear();
        doc.para_breaks.insert("b".into(), true);
        apply_balanced_cues(&mut doc, &CueParams::default());
        assert_eq!(cue_texts(&doc)[0], "national");
    }

    #[test]
    fn indivisible_phrase_can_exceed_width_without_an_illegal_cut() {
        let mut doc = doc_with_words(vec![
            w("a", 0.0, 1.0, "national"),
            w("b", 1.0, 2.0, "security"),
        ]);
        let params = CueParams {
            max_chars: 8,
            ..CueParams::default()
        };
        apply_balanced_cues(&mut doc, &params);
        let cues = derive_cues(&doc, &params);
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text(&doc), "national security");
        assert_eq!(cue_layout_stats(&doc, &params).over_width, 1);
        assert!(!apply_balanced_cues(&mut doc, &params));
    }

    #[test]
    fn english_guards_do_not_change_other_language_layouts() {
        let words = vec![w("a", 0.0, 1.0, "national"), w("b", 1.0, 2.0, "security")];
        let mut doc = doc_with_words(words);
        doc.lang = "de".into();
        let params = CueParams {
            max_chars: 8,
            ..CueParams::default()
        };
        apply_balanced_cues(&mut doc, &params);
        assert_eq!(derive_cues(&doc, &params).len(), 2);
    }

    #[test]
    fn long_english_transcript_preserves_every_word_and_legal_seams() {
        let phrase = [
            "we", "can", "use", "a", "model", "for", "national", "security",
        ];
        let words: Vec<_> = (0..16_000)
            .map(|i| {
                w(
                    &format!("w{i}"),
                    i as f64 * 0.3,
                    (i + 1) as f64 * 0.3,
                    phrase[i % phrase.len()],
                )
            })
            .collect();
        let mut doc = doc_with_words(words);
        apply_balanced_cues(&mut doc, &CueParams::default());
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(
            cues.iter().map(|cue| cue.word_indices.len()).sum::<usize>(),
            doc.words.len()
        );
        let texts: Vec<_> = doc.words.iter().map(|word| word.text.as_str()).collect();
        for cue in &cues {
            let end = *cue.word_indices.last().unwrap() + 1;
            let start = end.saturating_sub(3);
            assert!(
                english_cue_boundary_issue(&texts[start..(end + 3).min(texts.len())], end - start)
                    .is_none()
            );
        }
        assert_eq!(cue_layout_stats(&doc, &CueParams::default()).over_width, 0);
    }

    /// 真实失败样本 A：溢出硬断把句尾单词甩成近零时长孤儿 Cue（0.58 s < 1 s）。
    /// DP 后缝回移到行宽均衡处，孤儿消失；结果只进 `autoBreaks`。
    /// 与旧成对优化器的差异：旧版移到 `…beginning to | reshape…`，DP 对悬垂
    /// 不定式 `to` 计罚（方案 §3.3 禁止边界），因此选 `…beginning | to reshape…`。
    #[test]
    fn overflow_orphan_tail_is_rebalanced() {
        let mut doc = doc_with_words(vec![
            w("g1.0", 65.0, 65.3, "and"),
            w("g1.1", 65.3, 65.6, "how"),
            w("g1.2", 65.6, 65.9, "AI"),
            w("g1.3", 65.9, 66.1, "is"),
            w("g1.4", 66.1, 66.8, "beginning"),
            w("g1.5", 66.8, 67.0, "to"),
            w("g1.6", 67.0, 67.6, "reshape"),
            w("g1.7", 67.6, 67.8, "the"),
            w("g1.8", 67.8, 68.15, "environment."),
            // 后续句：让孤儿尾无法从媒体尾部借展示时间。
            w("g2.0", 68.5, 69.2, "Modern"),
            w("g2.1", 69.2, 69.9, "workflows"),
            w("g2.2", 69.9, 70.6, "changed."),
        ]);
        // 无布局时的贪心派生：句尾单词被溢出硬断甩出。
        assert_eq!(
            cue_texts(&doc)[0..2],
            [
                "and how AI is beginning to reshape the".to_owned(),
                "environment.".to_owned(),
            ]
        );
        assert!(ensure_balanced_cue_layout(&mut doc, &CueParams::default()));
        assert_eq!(
            cue_texts(&doc),
            vec![
                "and how AI is beginning".to_owned(),
                "to reshape the environment.".to_owned(),
                "Modern workflows changed.".to_owned(),
            ]
        );
        assert!(doc.breaks.is_empty(), "优化器不得写 breaks");
        assert_eq!(auto_table(&doc).get("g1.4"), Some(&BreakOverride::Break));
    }

    /// 真实失败样本 B：停顿断行让句尾片挤进过窄时窗（23.5 cps > 21）。
    /// DP 后缝前移，第二行拿到含停顿在内的完整时窗。
    #[test]
    fn pause_break_too_fast_tail_moves_seam_earlier() {
        let mut doc = doc_with_words(vec![
            w("g1.0", 70.0, 70.4, "Modern"),
            w("g1.1", 70.4, 70.8, "IDEs"),
            w("g1.2", 70.8, 71.2, "bring"),
            w("g1.3", 71.2, 71.8, "together"),
            w("g1.4", 71.8, 72.9, "tools"),
            w("g1.5", 72.9, 73.1, "that"),
            w("g1.6", 73.1, 73.4, "were"),
            // ≥0.6s 停顿：贪心派生在此断行。
            w("g1.7", 74.1, 74.25, "once"),
            w("g1.8", 74.25, 74.5, "managed"),
            w("g1.9", 74.5, 74.75, "separately."),
            w("g2.0", 74.9, 75.5, "Next"),
            w("g2.1", 75.5, 76.1, "topic."),
        ]);
        assert_eq!(
            cue_texts(&doc)[0..2],
            [
                "Modern IDEs bring together tools that were".to_owned(),
                "once managed separately.".to_owned(),
            ]
        );
        assert!(ensure_balanced_cue_layout(&mut doc, &CueParams::default()));
        let texts = cue_texts(&doc);
        assert_eq!(texts[0], "Modern IDEs bring together tools");
        assert_eq!(texts[1], "that were once managed separately.");
        assert!(doc.breaks.is_empty());
    }

    /// 真实失败样本 C（回归）：整段语速贴着 CPS 天花板。旧优化器的合并分支若放宽到
    /// 2×目标，会把两条各 40 宽的合规行焊成 81 宽的单行并钉上 `nobreak`。DP 把
    /// > `max_chars` 视为无穷：无论怎么重排都不得出现超宽行，也不得为了压宽度而
    /// 甩出单词孤儿尾。
    #[test]
    fn merge_is_capped_at_single_line_budget() {
        let mut doc = doc_with_words(vec![
            w("g16.0", 56.70, 56.88, "It's"),
            w("g16.1", 56.88, 57.06, "been"),
            w("g16.2", 57.06, 57.35, "working"),
            w("g16.3", 57.35, 57.60, "really"),
            w("g16.4", 57.60, 57.78, "well."),
            w("g17.0", 57.81, 57.97, "We've"),
            w("g17.1", 57.97, 58.37, "been"),
            w("g17.2", 58.37, 58.45, "running"),
            w("g17.3", 58.45, 58.93, "it"),
            w("g17.4", 58.93, 59.09, "for"),
            w("g17.5", 59.09, 59.10, "a"),
            w("g17.6", 59.10, 59.19, "few"),
            w("g17.7", 59.19, 59.43, "weeks"),
            w("g17.8", 59.43, 59.67, "in"),
            w("g17.9", 59.67, 59.76, "shadow"),
            w("g17.10", 59.76, 60.23, "and"),
            w("g17.11", 60.23, 60.32, "it's"),
            w("g17.12", 60.55, 61.02, "been"),
            w("g17.13", 61.02, 61.03, "consistently"),
            w("g17.14", 61.03, 61.12, "faster"),
            w("g17.15", 61.12, 61.67, "than"),
            w("g17.16", 61.67, 62.45, "where"),
            w("g17.17", 62.45, 63.08, "our"),
            w("g17.18", 63.08, 63.24, "current"),
            w("g17.19", 63.24, 63.49, "implementation"),
            w("g17.20", 63.49, 63.78, "is."),
        ]);
        let params = CueParams::default();
        let budget = params.max_chars + params.overflow_slack;
        // 贪心基线：两条各 40 宽的行，都在单行预算内。
        let greedy = cue_texts(&doc);
        assert_eq!(greedy[1], "We've been running it for a few weeks in");
        assert_eq!(greedy[2], "shadow and it's been consistently faster");

        ensure_balanced_cue_layout(&mut doc, &params);
        let texts = cue_texts(&doc);
        let stats = cue_layout_stats(&doc, &params);
        // 不得出现超宽单行。
        assert_eq!(stats.over_width, 0, "layout: {texts:?}");
        assert!(stats.longest_width <= budget, "layout: {texts:?}");
        // 句首句尾不动：句末是硬边界。
        assert_eq!(texts[0], "It's been working really well.");
        assert!(texts.last().unwrap().ends_with("implementation is."));
        // 也不得为了压宽度而甩出单词孤儿尾。
        let cues = derive_cues(&doc, &params);
        assert!(
            cues.iter().all(|cue| cue.word_indices.len() >= 2),
            "orphan tail: {texts:?}"
        );
        assert!(doc.breaks.is_empty());
    }

    /// 钉集是最小覆盖集：派生重放必须逐字节复现 DP 布局；重跑收敛（幂等）。
    #[test]
    fn emitted_pins_reproduce_dp_layout_and_rerun_is_idempotent() {
        let mut doc = doc_with_words(vec![
            w("g1.0", 65.0, 65.3, "and"),
            w("g1.1", 65.3, 65.6, "how"),
            w("g1.2", 65.6, 65.9, "AI"),
            w("g1.3", 65.9, 66.1, "is"),
            w("g1.4", 66.1, 66.8, "beginning"),
            w("g1.5", 66.8, 67.0, "to"),
            w("g1.6", 67.0, 67.6, "reshape"),
            w("g1.7", 67.6, 67.8, "the"),
            w("g1.8", 67.8, 68.15, "environment."),
            w("g2.0", 68.5, 69.2, "Modern"),
            w("g2.1", 69.2, 69.9, "workflows"),
            w("g2.2", 69.9, 70.6, "changed."),
        ]);
        let params = CueParams::default();
        // DP 的目标布局（词下标末集）与写钉后 derive_cues 的重放逐词一致。
        let visible: Vec<Word> = doc.words.clone();
        let profile = LayoutProfile::default_profile();
        let optimizer = Optimizer {
            words: &visible,
            seams: classify_seams(
                &visible,
                &doc.breaks,
                &doc.para_breaks,
                true,
                &params,
                profile.min_duration_sec,
            ),
            params: &params,
            profile: &profile,
            budget: reading_budget(&visible, &profile),
            english: true,
        };
        let desired = optimizer.desired_ends();
        assert!(apply_balanced_cues(&mut doc, &params));
        let replayed: BTreeSet<usize> = derive_cues(&doc, &params)
            .iter()
            .map(|cue| *cue.word_indices.last().unwrap())
            .collect();
        assert_eq!(replayed, desired);
        // 二次计算收敛：已是均衡布局时不再产生变化。
        let pins = auto_table(&doc);
        assert!(!apply_balanced_cues(&mut doc, &params));
        assert_eq!(auto_table(&doc), pins);
        assert!(!ensure_balanced_cue_layout(&mut doc, &params));
    }

    /// 已经是零偏离的贪心布局：不写任何自动 pin，也不动文档。
    #[test]
    fn well_formed_greedy_layout_needs_no_auto_pins() {
        let mut doc = doc_with_words(vec![
            w("g1.0", 0.0, 0.5, "This"),
            w("g1.1", 0.5, 1.0, "line"),
            w("g1.2", 1.0, 1.5, "reads"),
            w("g1.3", 1.5, 2.0, "fine."),
            w("g2.0", 2.5, 3.0, "So"),
            w("g2.1", 3.0, 3.5, "does"),
            w("g2.2", 3.5, 4.0, "this"),
            w("g2.3", 4.0, 4.5, "one."),
        ]);
        let before = doc.clone();
        assert!(!ensure_balanced_cue_layout(&mut doc, &CueParams::default()));
        assert_eq!(doc, before);
    }

    /// 句末缝与说话人边界不可被重排移动。
    #[test]
    fn dp_never_crosses_sentence_or_speaker_boundaries() {
        let mut words = vec![
            w("g1.0", 0.0, 0.2, "Hi."),
            w("g2.0", 0.2, 0.5, "Quick"),
            w("g2.1", 0.5, 0.7, "reply."),
        ];
        words[1].sp = "s2".to_owned();
        words[2].sp = "s2".to_owned();
        let mut doc = doc_with_words(words);
        ensure_balanced_cue_layout(&mut doc, &CueParams::default());
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text(&doc), "Hi.");
    }

    /// 用户钉是硬约束：优化器总是运行，但 `break` 必断、`nobreak` 必不断，
    /// `breaks` 表原样保留。
    #[test]
    fn user_pins_are_respected_and_never_rewritten() {
        let mut doc = doc_with_words(vec![
            w("g1.0", 65.0, 65.3, "and"),
            w("g1.1", 65.3, 65.6, "how"),
            w("g1.2", 65.6, 65.9, "AI"),
            w("g1.3", 65.9, 66.1, "is"),
            w("g1.4", 66.1, 66.8, "beginning"),
            w("g1.5", 66.8, 67.0, "to"),
            w("g1.6", 67.0, 67.6, "reshape"),
            w("g1.7", 67.6, 67.8, "the"),
            w("g1.8", 67.8, 68.15, "environment."),
            w("g2.0", 68.5, 69.2, "Modern"),
            w("g2.1", 69.2, 69.9, "workflows"),
            w("g2.2", 69.9, 70.6, "changed."),
        ]);
        // 用户要在 "AI" 后断、"to" 后不断。
        doc.breaks.insert("g1.2".to_owned(), BreakOverride::Break);
        doc.breaks.insert("g1.5".to_owned(), BreakOverride::Nobreak);
        let user = doc.breaks.clone();
        ensure_balanced_cue_layout(&mut doc, &CueParams::default());
        assert_eq!(doc.breaks, user);
        let texts = cue_texts(&doc);
        assert_eq!(texts[0], "and how AI");
        assert!(
            !texts.iter().any(|text| text.ends_with(" to")),
            "nobreak 被越过：{texts:?}"
        );
        assert!(texts.iter().all(|text| visual_width(text) <= 42));
        // 自动表不重复用户已钉的键。
        for id in user.keys() {
            assert!(!auto_table(&doc).contains_key(id));
        }
    }

    /// 旧式文档：优化器 pin 还留在 `breaks` 里。读入后视为用户意图——派生结果与
    /// 0.3 时代逐字节相同；重跑优化器也不会改写它们。
    #[test]
    fn legacy_optimizer_pins_in_breaks_are_treated_as_user_intent() {
        let words = vec![
            w("g1.0", 65.0, 65.3, "and"),
            w("g1.1", 65.3, 65.6, "how"),
            w("g1.2", 65.6, 65.9, "AI"),
            w("g1.3", 65.9, 66.1, "is"),
            w("g1.4", 66.1, 66.8, "beginning"),
            w("g1.5", 66.8, 67.0, "to"),
            w("g1.6", 67.0, 67.6, "reshape"),
            w("g1.7", 67.6, 67.8, "the"),
            w("g1.8", 67.8, 68.15, "environment."),
            w("g2.0", 68.5, 69.2, "Modern"),
            w("g2.1", 69.2, 69.9, "workflows"),
            w("g2.2", 69.9, 70.6, "changed."),
        ];
        // 0.3 时代的优化器输出：最小 pin 集直接落在 breaks。
        let mut legacy = doc_with_words(words.clone());
        let mut fresh = doc_with_words(words);
        apply_balanced_cues(&mut fresh, &CueParams::default());
        legacy.breaks = auto_table(&fresh);
        assert!(!legacy.breaks.is_empty());
        let legacy_layout = cue_texts(&legacy);
        assert_eq!(legacy_layout, cue_texts(&fresh));

        // 重跑：breaks 原样、布局不变、无需任何自动 pin。
        let pins = legacy.breaks.clone();
        ensure_balanced_cue_layout(&mut legacy, &CueParams::default());
        assert_eq!(legacy.breaks, pins);
        assert_eq!(cue_texts(&legacy), legacy_layout);
        assert!(auto_table(&legacy).is_empty());
    }

    /// 段落钉边界在钉集中显式落 break（镜像实现无段前封口逻辑）。
    #[test]
    fn paragraph_pin_seams_get_explicit_break_pins() {
        let mut doc = doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "First"),
            w("g1.1", 0.4, 0.8, "paragraph"),
            w("g1.2", 0.8, 1.2, "line"),
            w("g2.0", 1.4, 1.8, "second"),
            w("g2.1", 1.8, 2.2, "starts"),
            w("g2.2", 2.2, 2.6, "here."),
        ]);
        doc.para_breaks.insert("g2.0".to_owned(), true);
        let breaks = balanced_cue_breaks(&doc, &CueParams::default());
        assert_eq!(breaks.get("g1.2"), Some(&BreakOverride::Break));
    }

    /// 用户 nobreak 把行焊超预算时，DP 仍有解（无穷罚保持有限），且不产出
    /// 超出用户约束之外的超宽。
    #[test]
    fn forbidden_seams_keep_the_dp_solvable() {
        let words = (0..12)
            .map(|index| {
                w(
                    &format!("g1.{index}"),
                    index as f64 * 0.3,
                    index as f64 * 0.3 + 0.25,
                    "alpha",
                )
            })
            .collect();
        let mut doc = doc_with_words(words);
        for index in 0..11 {
            doc.breaks
                .insert(format!("g1.{index}"), BreakOverride::Nobreak);
        }
        let params = CueParams::default();
        ensure_balanced_cue_layout(&mut doc, &params);
        assert_eq!(derive_cues(&doc, &params).len(), 1);
        assert!(auto_table(&doc).is_empty());
    }

    #[test]
    fn overwide_nobreak_repair_removes_only_pins_that_weld_an_overwide_cue() {
        let words = (0..12)
            .map(|index| {
                w(
                    &format!("g1.{index}"),
                    index as f64 * 0.3,
                    index as f64 * 0.3 + 0.25,
                    "alpha",
                )
            })
            .collect();
        let mut doc = doc_with_words(words);
        for index in 0..11 {
            doc.breaks
                .insert(format!("g1.{index}"), BreakOverride::Nobreak);
        }
        let params = CueParams::default();
        assert!(cue_layout_stats(&doc, &params).over_width > 0);

        assert_eq!(remove_overwide_nobreaks(&mut doc, &params), 11);
        assert_eq!(cue_layout_stats(&doc, &params).over_width, 0);
    }

    /// `default` profile 的钉集快照。样本 C 曾在 `for | a few weeks` 断开；
    /// 英文语义门禁改为 `weeks | in shadow`，其余两份基线保持不变。
    #[test]
    fn default_profile_pins_preserve_legal_reference_seams() {
        let expected: [&[(&str, BreakOverride)]; 3] = [
            &[("g1.4", BreakOverride::Break)],
            &[("g1.4", BreakOverride::Break)],
            &[("g17.7", BreakOverride::Break)],
        ];
        for (words, pins) in [sample_a(), sample_b(), sample_c()]
            .into_iter()
            .zip(expected)
        {
            let mut doc = doc_with_words(words);
            assert_eq!(doc.layout_profile_id(), "default");
            apply_balanced_cues(&mut doc, &CueParams::default());
            let want: BTreeMap<String, BreakOverride> = pins
                .iter()
                .map(|(id, value)| ((*id).to_owned(), *value))
                .collect();
            assert_eq!(auto_table(&doc), want);
        }
    }

    /// 双行 profile（方案 §3.4）：宽度预算放大到 2 × maxChars，DP 用 `nobreak` 把
    /// 两行合规文字焊成一条 Cue；行内换行由 `line_break_plan` 复算且不超过两行；
    /// `cue_layout_stats` / `remove_overwide_nobreaks` 按 profile 预算判越界，不把
    /// 双行 Cue 当回归。同一文档在 `default` 下仍是两条单行 Cue。
    #[test]
    fn two_line_profile_welds_two_balanced_lines_into_one_cue() {
        let text =
            "the quick brown fox jumps over the lazy dog while the cat watches from the fence.";
        let words: Vec<Word> = text
            .split(' ')
            .enumerate()
            .map(|(index, word)| {
                let t0 = 10.0 + index as f64 * 0.3;
                w(&format!("g1.{index}"), t0, t0 + 0.25, word)
            })
            .collect();
        let params = CueParams::default();

        let mut single = doc_with_words(words.clone());
        ensure_balanced_cue_layout(&mut single, &params);
        assert_eq!(cue_texts(&single).len(), 2, "{:?}", cue_texts(&single));

        let mut two = doc_with_words(words);
        two.layout_profile = Some("two-line".to_owned());
        assert!(ensure_balanced_cue_layout(&mut two, &params));
        let texts = cue_texts(&two);
        assert_eq!(texts, vec![text.to_owned()]);
        assert!(visual_width(&texts[0]) <= 2 * params.max_chars);
        let pins = auto_table(&two);
        assert!(!pins.is_empty());
        assert!(pins.values().all(|value| *value == BreakOverride::Nobreak));
        assert!(two.breaks.is_empty());
        assert!(!two.auto_breaks.contains_key("default"));
        // 行内换行是渲染期投影：这里只验证复算的换行不超过两行且每行合规。
        let word_texts: Vec<&str> = two.words.iter().map(|word| word.text.as_str()).collect();
        let plan = crate::layout_profile::line_break_plan_with(
            &word_texts,
            2,
            params.max_chars,
            visual_width,
        );
        assert_eq!(plan.len(), 2, "{plan:?}");
        for line in &plan {
            let line_text = join_word_texts(line.iter().map(|&index| word_texts[index]));
            assert!(visual_width(&line_text) <= params.max_chars, "{line_text}");
        }
        // profile 预算：双行 Cue 不越界，超宽修复也不会拆掉它。
        let stats = cue_layout_stats(&two, &params);
        assert_eq!(stats.over_width, 0);
        assert_eq!(remove_overwide_nobreaks(&mut two, &params), 0);
        assert_eq!(cue_texts(&two), vec![text.to_owned()]);
        // 重跑幂等。
        assert!(!ensure_balanced_cue_layout(&mut two, &params));
    }

    fn sample_a() -> Vec<Word> {
        vec![
            w("g1.0", 65.0, 65.3, "and"),
            w("g1.1", 65.3, 65.6, "how"),
            w("g1.2", 65.6, 65.9, "AI"),
            w("g1.3", 65.9, 66.1, "is"),
            w("g1.4", 66.1, 66.8, "beginning"),
            w("g1.5", 66.8, 67.0, "to"),
            w("g1.6", 67.0, 67.6, "reshape"),
            w("g1.7", 67.6, 67.8, "the"),
            w("g1.8", 67.8, 68.15, "environment."),
            w("g2.0", 68.5, 69.2, "Modern"),
            w("g2.1", 69.2, 69.9, "workflows"),
            w("g2.2", 69.9, 70.6, "changed."),
        ]
    }
    fn sample_b() -> Vec<Word> {
        vec![
            w("g1.0", 70.0, 70.4, "Modern"),
            w("g1.1", 70.4, 70.8, "IDEs"),
            w("g1.2", 70.8, 71.2, "bring"),
            w("g1.3", 71.2, 71.8, "together"),
            w("g1.4", 71.8, 72.9, "tools"),
            w("g1.5", 72.9, 73.1, "that"),
            w("g1.6", 73.1, 73.4, "were"),
            w("g1.7", 74.1, 74.25, "once"),
            w("g1.8", 74.25, 74.5, "managed"),
            w("g1.9", 74.5, 74.75, "separately."),
            w("g2.0", 74.9, 75.5, "Next"),
            w("g2.1", 75.5, 76.1, "topic."),
        ]
    }
    fn sample_c() -> Vec<Word> {
        vec![
            w("g16.0", 56.70, 56.88, "It's"),
            w("g16.1", 56.88, 57.06, "been"),
            w("g16.2", 57.06, 57.35, "working"),
            w("g16.3", 57.35, 57.60, "really"),
            w("g16.4", 57.60, 57.78, "well."),
            w("g17.0", 57.81, 57.97, "We've"),
            w("g17.1", 57.97, 58.37, "been"),
            w("g17.2", 58.37, 58.45, "running"),
            w("g17.3", 58.45, 58.93, "it"),
            w("g17.4", 58.93, 59.09, "for"),
            w("g17.5", 59.09, 59.10, "a"),
            w("g17.6", 59.10, 59.19, "few"),
            w("g17.7", 59.19, 59.43, "weeks"),
            w("g17.8", 59.43, 59.67, "in"),
            w("g17.9", 59.67, 59.76, "shadow"),
            w("g17.10", 59.76, 60.23, "and"),
            w("g17.11", 60.23, 60.32, "it's"),
            w("g17.12", 60.55, 61.02, "been"),
            w("g17.13", 61.02, 61.03, "consistently"),
            w("g17.14", 61.03, 61.12, "faster"),
            w("g17.15", 61.12, 61.67, "than"),
            w("g17.16", 61.67, 62.45, "where"),
            w("g17.17", 62.45, 63.08, "our"),
            w("g17.18", 63.08, 63.24, "current"),
            w("g17.19", 63.24, 63.49, "implementation"),
            w("g17.20", 63.49, 63.78, "is."),
        ]
    }

    /// 过期的自动 nobreak 同样会被超宽修复移除。
    #[test]
    fn overwide_repair_also_drops_stale_auto_nobreaks() {
        let words = (0..12)
            .map(|index| {
                w(
                    &format!("g1.{index}"),
                    index as f64 * 0.3,
                    index as f64 * 0.3 + 0.25,
                    "alpha",
                )
            })
            .collect();
        let mut doc = doc_with_words(words);
        let table = doc.auto_breaks.entry("default".to_owned()).or_default();
        for index in 0..11 {
            table.insert(format!("g1.{index}"), BreakOverride::Nobreak);
        }
        let params = CueParams::default();
        assert!(cue_layout_stats(&doc, &params).over_width > 0);
        assert_eq!(remove_overwide_nobreaks(&mut doc, &params), 11);
        assert_eq!(cue_layout_stats(&doc, &params).over_width, 0);
        assert!(doc.auto_breaks.is_empty());
    }

    fn seam_grades(words: &[Word]) -> Vec<f64> {
        let params = CueParams::default();
        (0..words.len() - 1)
            .map(|k| seam_grade(&words[k], &words[k + 1], &params))
            .collect()
    }

    #[test]
    fn a_glued_seam_has_no_space_and_grades_as_a_midword_seam() {
        let mut words = vec![
            w("a", 0.0, 0.2, "ab"),
            w("b", 0.2, 0.4, "cd"),
            w("c", 0.4, 0.6, "ef"),
        ];
        words[1].glue = true;
        assert_eq!(seam_grades(&words), [SEAM_CJK_MIDWORD, SEAM_WORD]);
        let doc = doc_with_words(words);
        assert_eq!(cue_texts(&doc), ["abcd ef"]);
        // 换行预算按同一把尺：贴住的缝不占分隔宽度。
        assert_eq!(
            crate::atomize::join_prefix_char_lens(&doc.words),
            vec![2, 4, 7]
        );
    }

    /// **回归锁定**：期望值逐值写死，四份样本覆盖 0.3 / 0.5 / 0.8 / 3.0 四档
    /// 缝等级与 1.5 的悬垂罚。
    #[test]
    fn seam_grade_and_dangling_cost_match_the_locked_baseline() {
        let expected: [(&[f64], &[f64]); 4] = [
            (
                &[0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
                &[1.5, 0.0, 0.0, 0.0, 0.0, 1.5, 0.0, 1.5, 0.0, 0.0, 0.0],
            ),
            (
                &[0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.5, 0.8, 0.8, 0.8, 0.8],
                &[0.0; 11],
            ),
            (&[0.8; 25], {
                const C: [f64; 25] = {
                    let mut values = [0.0; 25];
                    values[10] = 1.5;
                    values[15] = 1.5;
                    values
                };
                &C
            }),
            (
                &[
                    3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 0.8, 0.3, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0,
                    3.0, 3.0, 3.0, 0.8,
                ],
                &[
                    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, 1.5, 0.0, 0.0, 0.0,
                    0.0, 1.5, 0.0, 0.0,
                ],
            ),
        ];
        for (words, (grades, dangling)) in [sample_a(), sample_b(), sample_c()]
            .into_iter()
            .zip(expected)
        {
            assert_eq!(seam_grades(&words), grades.to_vec());
            let actual: Vec<f64> = (0..words.len() - 1)
                .map(|k| dangling_cost(&words[k]))
                .collect();
            assert_eq!(actual, dangling.to_vec());
        }
    }
}
