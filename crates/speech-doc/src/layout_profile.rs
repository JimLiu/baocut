//! `LayoutProfile`：字幕版式阈值的表驱动来源（对齐块方案 §3.1）。
//!
//! 优化器（[`crate::layout`]）、目标语切分、check 与各表面的 CPS 着色此前各持一份
//! 常量：`layout.rs` 的 13/21、`split.rs::target_reading_cps`、gpui 字幕列表的
//! 9/13/17/21。这里把它们收成一份按 id 查表的数据结构；`default` profile 的数值
//! 就是这些常量本身，因此切换到 profile 不改变任何既有行为。
//!
//! 新增 profile（竖屏、Netflix 双行等）只是往 [`LayoutProfile::by_id`] 里加一份
//! 数据，不进算法。

use crate::atomize::{JoinWord, word_sep};
use crate::cue::CueParams;
use crate::doc::TranscriptDoc;
use crate::split::{TransParams, primary_subtag};

/// 缺省 profile id（与 [`crate::doc::DEFAULT_LAYOUT_PROFILE`] 一致）。
pub const DEFAULT_PROFILE_ID: &str = crate::doc::DEFAULT_LAYOUT_PROFILE;
/// 双行 profile id：源侧每行宽度与 `default` 相同、`max_lines = 2`，其余全部
/// 等于 `default`——用来证明 profile 只是数据（方案 §3.4 / D6）。
pub const TWO_LINE_PROFILE_ID: &str = "two-line";
/// 已知 profile id 列表（CLI `--layout-profile` 的可选值提示）。
pub const KNOWN_PROFILE_IDS: &[&str] = &[DEFAULT_PROFILE_ID, TWO_LINE_PROFILE_ID];

/// 阅读速度预算（字符/秒）。
///
/// - `warn` / `bad`：着色与优化器的两档上限（CJK 9/13，其余 17/21）；
/// - `reading`：目标语「按此速度必须读完」的交付速度，与
///   `split.rs::target_reading_cps` 同表（zh 9 / ja、ko 13 / th 15 / ar、hi 18 /
///   其余 21），供 `target_required_seconds` 一类调用方迁移。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CpsBudget {
    pub warn: f64,
    pub bad: f64,
    pub reading: f64,
}

/// CPS 表：按脚本给 warn/bad，按主语言子标签给 reading。
#[derive(Debug, Clone, PartialEq)]
pub struct CpsTable {
    pub cjk_warn: f64,
    pub cjk_bad: f64,
    pub latin_warn: f64,
    pub latin_bad: f64,
    /// 主语言子标签 → 交付阅读速度；缺省 [`CpsTable::reading_default`]。
    pub reading: Vec<(&'static str, f64)>,
    pub reading_default: f64,
}

impl CpsTable {
    /// 主语言子标签是否按 CJK 档取 warn/bad。
    pub fn is_cjk_lang(lang: &str) -> bool {
        matches!(primary_subtag(lang).as_str(), "zh" | "ja" | "ko")
    }

    /// 按脚本（CJK 与否）取 warn/bad；`reading` 取缺省档。
    pub fn for_script(&self, cjk: bool) -> CpsBudget {
        if cjk {
            CpsBudget {
                warn: self.cjk_warn,
                bad: self.cjk_bad,
                reading: self.reading_default,
            }
        } else {
            CpsBudget {
                warn: self.latin_warn,
                bad: self.latin_bad,
                reading: self.reading_default,
            }
        }
    }

    /// 按语言取全部三档。
    pub fn for_lang(&self, lang: &str) -> CpsBudget {
        let subtag = primary_subtag(lang);
        let mut budget = self.for_script(Self::is_cjk_lang(lang));
        budget.reading = self
            .reading
            .iter()
            .find(|(tag, _)| *tag == subtag.as_str())
            .map(|(_, cps)| *cps)
            .unwrap_or(self.reading_default);
        budget
    }
}

/// 一份版式 profile：源 Cue 参数、目标语三阈值、行数、CPS 与时长/借静音口径。
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutProfile {
    /// `"default"` | `"portrait"` | `"netflix-2line"` …
    pub id: String,
    /// 源字幕 §18.5 参数（maxChars 等）。
    pub source: CueParams,
    /// 每条字幕最多几行；M1 保持 1（换行仍是渲染期投影，不落盘）。
    pub max_lines: u8,
    /// 阅读速度表。
    pub cps: CpsTable,
    /// 最短展示时长（现 `min_cue_display_sec`）。
    pub min_duration_sec: f64,
    /// 最长展示时长（现 align 引擎的 `LONG_DWELL_SECONDS`）。
    pub max_duration_sec: f64,
    /// 展示 padding：向前一条真实间隙借入场时间（studio `SUB_TIMING.leadIn`）。
    pub lead_in_sec: f64,
    /// 展示 padding：向后一条真实间隙借收尾时间（studio `SUB_TIMING.tail`）。
    pub tail_sec: f64,
}

impl Default for LayoutProfile {
    fn default() -> Self {
        Self::default_profile()
    }
}

impl LayoutProfile {
    /// `default` profile：数值即今天的全部常量，保证零行为漂移。
    pub fn default_profile() -> Self {
        Self {
            id: DEFAULT_PROFILE_ID.to_owned(),
            source: CueParams::default(),
            max_lines: 1,
            cps: CpsTable {
                cjk_warn: 9.0,
                cjk_bad: 13.0,
                latin_warn: 17.0,
                latin_bad: 21.0,
                reading: vec![
                    ("zh", 9.0),
                    ("ja", 13.0),
                    ("ko", 13.0),
                    ("th", 15.0),
                    ("ar", 18.0),
                    ("hi", 18.0),
                ],
                reading_default: 21.0,
            },
            min_duration_sec: 1.0,
            max_duration_sec: 7.0,
            lead_in_sec: 0.5,
            tail_sec: 1.0,
        }
    }

    /// `two-line` profile：只把 `max_lines` 改成 2，其余数据与 `default` 逐项相同。
    pub fn two_line_profile() -> Self {
        Self {
            id: TWO_LINE_PROFILE_ID.to_owned(),
            max_lines: 2,
            ..Self::default_profile()
        }
    }

    /// 按 id 查 profile；未知 id 返回 `None`（调用方自行决定回退）。
    /// 新增 profile 只需在这里加一个分支的数据。
    pub fn by_id(id: &str) -> Option<Self> {
        match id {
            DEFAULT_PROFILE_ID => Some(Self::default_profile()),
            TWO_LINE_PROFILE_ID => Some(Self::two_line_profile()),
            _ => None,
        }
    }

    /// 文档生效的 profile（`doc.layoutProfile`，未知 id 按 `default` 数值回退）。
    pub fn for_doc(doc: &TranscriptDoc) -> Self {
        Self::by_id_or_default(doc.layout_profile_id())
    }

    /// 一条 Cue 的视觉宽度预算：`max_lines × params.max_chars + overflow_slack`。
    /// 单行 profile 下就是自动阶梯的实际天花板（`max_chars + overflow_slack`）；
    /// 双行 profile 下优化器可以用 `nobreak` 把两行焊成一条 Cue，越界判据、
    /// 超宽修复与 check 的 `source-width` 都必须按这条预算取，否则会把合法的
    /// 双行 Cue 当作回归。`params` 允许调用方覆盖 `max_chars`（`--cue-line-length`）。
    pub fn cue_width_budget(&self, params: &CueParams) -> usize {
        params.max_chars * usize::from(self.max_lines.max(1)) + params.overflow_slack
    }

    /// 按 id 查 profile，未知 id 回退到 `default` 的数值（id 仍取传入值，
    /// 这样 `autoBreaks` 仍按调用方的 profile 键写入）。
    pub fn by_id_or_default(id: &str) -> Self {
        Self::by_id(id).unwrap_or_else(|| Self {
            id: id.to_owned(),
            ..Self::default_profile()
        })
    }

    /// 目标语三阈值（委托 [`TransParams::for_lang`]）。
    pub fn target(&self, lang: &str) -> TransParams {
        TransParams::for_lang(lang)
    }

    /// 按语言取 CPS 预算。
    pub fn cps_for_lang(&self, lang: &str) -> CpsBudget {
        self.cps.for_lang(lang)
    }

    /// 按脚本取 CPS 预算（文本抽样判 CJK 的调用方使用）。
    pub fn cps_for_script(&self, cjk: bool) -> CpsBudget {
        self.cps.for_script(cjk)
    }

    /// 借静音口径（对拍 studio `subPad`）：`buffer` 是想借的展示 padding，
    /// `gap` 是相邻字幕之间的真实间隙；只能按间隙占 `leadIn + tail` 的比例借。
    pub fn borrowed_pad(&self, buffer: f64, gap: f64) -> f64 {
        let cap = self.lead_in_sec + self.tail_sec;
        if cap <= 0.0 {
            return 0.0;
        }
        (gap.max(0.0) * buffer / cap).min(buffer)
    }

    /// 一条 Cue 的展示时窗：词时窗 + 向两侧真实间隙借来的入场/收尾 padding。
    pub fn display_window(&self, t0: f64, t1: f64, gap_prev: f64, gap_next: f64) -> f64 {
        (t1 - t0)
            + self.borrowed_pad(self.tail_sec, gap_next)
            + self.borrowed_pad(self.lead_in_sec, gap_prev)
    }
}

/// 文档派生/优化 Cue 应使用的 §18.5 参数：`LayoutProfile::for_doc(doc).source`。
///
/// 所有从 transcript 派生源 Cue 的消费端（引擎写路径、`derive_project_rows`、
/// 导出、check）都经这里取参，而不是各自 `CueParams::default()`——文档带
/// `layoutProfile` 时三端才会按同一份 profile 数据重放 `autoBreaks[profile]`。
/// 已知 profile 的 `source` 目前都等于 `CueParams::default()`，因此对现有文档
/// 零行为漂移。
pub fn cue_params_for_doc(doc: &TranscriptDoc) -> CueParams {
    LayoutProfile::for_doc(doc).source
}

/// 行内换行位置的边界罚：行尾落在句末/从句标点上（或是末行）不罚，否则罚 12
/// （对拍 studio `sourceDisplayLines` 的 `boundaryPenalty`）。
const LINE_BREAK_BOUNDARY_PENALTY: i64 = 12;
/// 每多一行的基础分（对拍 JS 的 `100000`：行数优先于均衡）。
const LINE_BREAK_LINE_BASE: i64 = 100_000;
/// JS `Math.max(8, floor(fit))`：宽度下限。
const LINE_BREAK_MIN_LIMIT: usize = 8;

/// 行内换行计划（方案 §3.4）：把一条 Cue 的词按 `max_chars_per_line` 均衡地分到
/// 若干行，返回每行的词下标。移植自
/// `skills/baocut/templates/studio/subtitle-rendering.js::sourceDisplayLines`
/// （`designs/baocut-mac/app/translate-model.js` 同源）：
///
/// - 整体宽度 ≤ 上限 ⇒ 单行；
/// - 否则目标行数 `n = clamp(ceil(total / limit), 2, max(2, max_lines))`，
///   理想行宽 `ideal = min(limit, ceil(total / n))`；
/// - 逆序 DP：每行分 `LINE_BREAK_LINE_BASE + (ideal − min(width, limit))² +
///   边界罚`，行宽超上限的候选只在单词独占一行时保留；相同分数取靠前的行尾
///   （与 JS 的严格 `<` 更新一致）。
///
/// 只要文本落在 `max_lines × limit` 预算内，行数箝位不生效，结果与 JS 逐行相同；
/// 共享夹具 `core/fixtures/subtitle-render-contract.json#lineBreaks` 钉住这一点。
/// JS 那两份消费者（Subtitle Studio 页面与 `designs/baocut-mac`）已随各自表面
/// 归档，夹具现在只有 Rust 侧消费，仍是本函数的非回归基线。
///
/// 宽度按 Unicode 标量计数（JS `Array.from(text).length`），词间分隔按
/// [`crate::atomize::sep_len`]（Latin 词间一个空格、CJK 邻接不加）。换行位置**不落盘**：这里
/// 只给 Cue DP 打"两行失衡"分，渲染期各表面仍自行投影。
pub fn line_break_plan(
    words: &[&str],
    max_lines: usize,
    max_chars_per_line: usize,
) -> Vec<Vec<usize>> {
    line_break_plan_with(words, max_lines, max_chars_per_line, |text| {
        text.chars().count()
    })
}

/// [`line_break_plan`] 的宽度可注入版本：源 Cue 优化器用 [`crate::atomize::visual_width`]
/// （CJK 计 2）与其余 §18.5 尺度保持一致；Latin 文本下二者相同。
pub fn line_break_plan_with<W: JoinWord>(
    words: &[W],
    max_lines: usize,
    max_chars_per_line: usize,
    width: impl Fn(&str) -> usize,
) -> Vec<Vec<usize>> {
    let n = words.len();
    if n == 0 {
        return Vec::new();
    }
    let limit = max_chars_per_line.max(LINE_BREAK_MIN_LIMIT);
    // 前缀宽度：`prefix[i]` 是前 i 个词拼接后的宽度；`line_width(from, to)` 由
    // 前缀差与首词前的分隔修正得到，与逐次拼接测量等价。
    let mut prefix = Vec::with_capacity(n + 1);
    prefix.push(0_usize);
    for (index, word) in words.iter().enumerate() {
        let sep = if index == 0 {
            0
        } else {
            word_sep(words[index - 1].join_text(), word)
        };
        prefix.push(prefix[index] + sep + width(word.join_text()));
    }
    let line_width = |from: usize, to: usize| -> usize {
        // 行内不含 `from` 词前面的分隔。
        let lead = if from == 0 {
            0
        } else {
            word_sep(words[from - 1].join_text(), &words[from])
        };
        prefix[to + 1] - prefix[from] - lead
    };
    let total = line_width(0, n - 1);
    if total <= limit {
        return vec![(0..n).collect()];
    }
    let line_count = total.div_ceil(limit).clamp(2, max_lines.max(2));
    let ideal = limit.min(total.div_ceil(line_count));

    let mut best = vec![i64::MAX; n + 1];
    let mut next = vec![usize::MAX; n];
    best[n] = 0;
    for from in (0..n).rev() {
        for to in from..n {
            let w = line_width(from, to);
            if w > limit && to > from {
                break;
            }
            let boundary = if to == n - 1 || ends_at_line_boundary(words[to].join_text()) {
                0
            } else {
                LINE_BREAK_BOUNDARY_PENALTY
            };
            // 每个后缀都至少有"单词独占一行"的解，`best[to + 1]` 恒有限；防御性守住。
            if best[to + 1] == i64::MAX {
                continue;
            }
            let gap = ideal as i64 - w.min(limit) as i64;
            let score = LINE_BREAK_LINE_BASE + gap * gap + boundary + best[to + 1];
            if score < best[from] {
                best[from] = score;
                next[from] = to + 1;
            }
        }
    }
    let mut lines = Vec::new();
    let mut from = 0;
    while from < n {
        let end = if next[from] != usize::MAX && next[from] > from {
            next[from]
        } else {
            from + 1
        };
        lines.push((from..end).collect());
        from = end;
    }
    lines
}

/// JS：`/[.!?;:，。！？；：]/u.test(line.trim().slice(-1))`——行尾字符（即行末词
/// 的末字符）是句末或从句标点。刻意逐字对拍正则字符集，不用 `sentence_end` /
/// `clause_end_char`（二者会剥引号/括号并排除缩写点，与 JS 结果不同）。
fn ends_at_line_boundary(word: &str) -> bool {
    matches!(
        word.trim_end().chars().last(),
        Some('.' | '!' | '?' | ';' | ':' | '，' | '。' | '！' | '？' | '；' | '：')
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_profile_equals_the_legacy_constants() {
        let profile = LayoutProfile::default_profile();
        assert_eq!(profile.id, "default");
        assert_eq!(profile.source, CueParams::default());
        assert_eq!(profile.max_lines, 1);
        assert_eq!(
            profile.min_duration_sec,
            CueParams::default().min_cue_display_sec
        );
        assert_eq!(profile.max_duration_sec, 7.0);
        assert_eq!((profile.lead_in_sec, profile.tail_sec), (0.5, 1.0));
        // layout.rs 旧常量：CJK 13 / Latin 21 是 bad 档。
        assert_eq!(profile.cps_for_script(true).bad, 13.0);
        assert_eq!(profile.cps_for_script(false).bad, 21.0);
        // gpui `cps_level`：(9, 13) / (17, 21)。
        let cjk = profile.cps_for_script(true);
        let latin = profile.cps_for_script(false);
        assert_eq!((cjk.warn, cjk.bad), (9.0, 13.0));
        assert_eq!((latin.warn, latin.bad), (17.0, 21.0));
        assert_eq!(profile.target("zh"), TransParams::for_lang("zh"));
        assert_eq!(profile.target("en"), TransParams::for_lang("en"));
    }

    #[test]
    fn reading_cps_matches_split_target_reading_cps_for_every_language_tier() {
        let profile = LayoutProfile::default_profile();
        for lang in [
            "zh", "zh-Hans", "ja", "ko", "th", "ar", "hi", "en", "en-US", "de", "fr", "vi", "",
        ] {
            assert_eq!(
                profile.cps_for_lang(lang).reading,
                crate::split::target_reading_cps(lang),
                "{lang}"
            );
        }
        assert_eq!(profile.cps_for_lang("ja").warn, 9.0);
        assert_eq!(profile.cps_for_lang("th").warn, 17.0);
    }

    #[test]
    fn by_id_knows_default_and_two_line_and_or_default_keeps_the_requested_id() {
        assert_eq!(
            LayoutProfile::by_id("default"),
            Some(LayoutProfile::default_profile())
        );
        assert_eq!(
            LayoutProfile::by_id("two-line"),
            Some(LayoutProfile::two_line_profile())
        );
        assert_eq!(LayoutProfile::by_id("portrait"), None);
        let fallback = LayoutProfile::by_id_or_default("portrait");
        assert_eq!(fallback.id, "portrait");
        assert_eq!(fallback.cps, LayoutProfile::default_profile().cps);
        for id in KNOWN_PROFILE_IDS {
            assert_eq!(LayoutProfile::by_id(id).map(|p| p.id).as_deref(), Some(*id));
        }
    }

    /// 双行 profile 只是数据：除 `id` 与 `max_lines` 外逐项等于 `default`。
    #[test]
    fn two_line_profile_differs_from_default_only_in_max_lines() {
        let two = LayoutProfile::two_line_profile();
        let expected = LayoutProfile {
            id: "two-line".to_owned(),
            max_lines: 2,
            ..LayoutProfile::default_profile()
        };
        assert_eq!(two, expected);
        assert_eq!(two.source, CueParams::default());
        let params = CueParams::default();
        assert_eq!(
            LayoutProfile::default_profile().cue_width_budget(&params),
            42 + 8
        );
        assert_eq!(two.cue_width_budget(&params), 84 + 8);
        let narrow = CueParams {
            max_chars: 24,
            ..params
        };
        assert_eq!(two.cue_width_budget(&narrow), 48 + 8);
    }

    #[test]
    fn cue_params_for_doc_follow_the_document_profile() {
        let mut doc = TranscriptDoc::new(
            crate::doc::DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 1.0,
                sample_rate: None,
            },
            "en",
            crate::doc::DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        assert_eq!(cue_params_for_doc(&doc), CueParams::default());
        assert_eq!(LayoutProfile::for_doc(&doc).id, "default");
        doc.layout_profile = Some("two-line".to_owned());
        assert_eq!(LayoutProfile::for_doc(&doc).max_lines, 2);
        assert_eq!(cue_params_for_doc(&doc), CueParams::default());
        doc.layout_profile = Some("portrait".to_owned());
        assert_eq!(LayoutProfile::for_doc(&doc).id, "portrait");
        assert_eq!(cue_params_for_doc(&doc), CueParams::default());
    }

    /// 夹具 `core/fixtures/subtitle-render-contract.json#lineBreaks`（原与已归档
    /// 的 studio `sourceDisplayLines` / designs `translate-model.js` 共用）：
    /// 逐行词下标必须一致。
    #[test]
    fn line_break_plan_matches_the_shared_javascript_contract() {
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/subtitle-render-contract.json"
        ))
        .unwrap();
        let rows = contract["lineBreaks"].as_array().unwrap();
        assert!(!rows.is_empty());
        for row in rows {
            let words: Vec<String> = serde_json::from_value(row["words"].clone()).unwrap();
            let refs: Vec<&str> = words.iter().map(String::as_str).collect();
            let fit = row["fit"].as_u64().unwrap() as usize;
            let max_lines = row["maxLines"].as_u64().unwrap() as usize;
            let expected: Vec<Vec<usize>> =
                serde_json::from_value(row["expected"].clone()).unwrap();
            assert_eq!(
                line_break_plan(&refs, max_lines, fit),
                expected,
                "{}",
                row["name"]
            );
            // Latin 夹具下视觉宽度与码点数相同，注入 `visual_width` 的变体必须同解。
            if words.iter().all(|word| word.is_ascii()) {
                assert_eq!(
                    line_break_plan_with(&refs, max_lines, fit, crate::atomize::visual_width),
                    expected,
                    "{} (visual_width)",
                    row["name"]
                );
            }
        }
    }

    #[test]
    fn line_break_plan_covers_every_word_exactly_once_and_respects_the_width() {
        let text = "Modern IDEs bring together tools that were once managed separately \
                    and now sit behind a single command palette that anyone can search";
        let words: Vec<&str> = text.split(' ').collect();
        for (max_lines, fit) in [(2, 42), (3, 30), (4, 20), (2, 8)] {
            let plan = line_break_plan(&words, max_lines, fit);
            let flat: Vec<usize> = plan.iter().flatten().copied().collect();
            assert_eq!(
                flat,
                (0..words.len()).collect::<Vec<_>>(),
                "{max_lines}x{fit}"
            );
            for line in &plan {
                let width: usize =
                    line.iter().map(|&i| words[i].len()).sum::<usize>() + line.len() - 1;
                assert!(
                    width <= fit.max(8) || line.len() == 1,
                    "{max_lines}x{fit}: {line:?}"
                );
            }
        }
        assert!(line_break_plan(&[], 2, 42).is_empty());
        assert_eq!(line_break_plan(&["one"], 2, 42), vec![vec![0]]);
    }

    /// 文本超出 `max_lines × limit` 预算时行数箝位只改理想行宽（更愿意填满行），
    /// 不改变"每行不超宽、每词恰覆盖一次"的约束。
    #[test]
    fn line_break_plan_clamp_keeps_the_width_constraint_when_over_budget() {
        let text = "so the humans don't get distracted paying attention to that in reviews, stuff like that.";
        let words: Vec<&str> = text.split(' ').collect();
        // 88 字符 > 2 × 42：箝到 2 行后仍需三行才不超宽。
        let clamped = line_break_plan(&words, 2, 42);
        assert_eq!(clamped.len(), 3);
        let flat: Vec<usize> = clamped.iter().flatten().copied().collect();
        assert_eq!(flat, (0..words.len()).collect::<Vec<_>>());
        for line in &clamped {
            let width: usize = line.iter().map(|&i| words[i].len()).sum::<usize>() + line.len() - 1;
            assert!(width <= 42, "{line:?}");
        }
    }

    #[test]
    fn borrowed_pad_matches_studio_sub_pad() {
        let profile = LayoutProfile::default_profile();
        // 间隙 ≥ leadIn + tail 时整份 buffer 都能借到；否则按比例。
        assert_eq!(profile.borrowed_pad(1.0, f64::INFINITY), 1.0);
        assert_eq!(profile.borrowed_pad(1.0, 1.5), 1.0);
        assert!((profile.borrowed_pad(1.0, 0.75) - 0.5).abs() < 1e-12);
        assert_eq!(profile.borrowed_pad(0.5, 0.0), 0.0);
        assert_eq!(profile.borrowed_pad(0.5, -1.0), 0.0);
        assert!(
            (profile.display_window(1.0, 2.0, f64::INFINITY, 0.3) - (1.0 + 0.5 + 0.2)).abs()
                < 1e-12
        );
    }
}
