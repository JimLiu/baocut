//! Cue / Para 派生投影（§18.5，规范性算法）。
//!
//! 字幕行与段落不落盘；同一份转录在任何实现必须派生出相同结果。

use crate::doc::{BreakOverride, TranscriptDoc, Word};

/// 规范性缺省参数（§18.5）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CueParams {
    pub max_chars: usize,
    pub pause_sec: f64,
    /// 从句标点（逗号类）断行的最短行宽。
    pub min_clause_chars: usize,
    pub min_pause_chars: usize,
    /// 破折号（打断/重启）断行的最短行宽——比逗号档更低。
    pub min_dash_chars: usize,
    pub overflow_slack: usize,
    pub min_cue_display_sec: f64,
}

impl Default for CueParams {
    fn default() -> Self {
        Self {
            max_chars: 42,
            pause_sec: 0.6,
            min_clause_chars: 12,
            min_pause_chars: 20,
            min_dash_chars: 6,
            overflow_slack: 8,
            min_cue_display_sec: 1.0,
        }
    }
}

/// 派生出的字幕行（概念性，非持久化）。
#[derive(Debug, Clone, PartialEq)]
pub struct Cue {
    /// `"q-" + 首词 id`——首词不变则跨重派生稳定。
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub sp: String,
    /// 指回 `doc.words` 的下标（只含非 hidden 词）。
    pub word_indices: Vec<usize>,
}

impl Cue {
    pub fn text(&self, doc: &TranscriptDoc) -> String {
        join_words(self.word_indices.iter().map(|&index| &doc.words[index]))
    }
}

/// 段落：按（章节 × 连续同说话人）分组，再叠加 paraBreaks 钉。
#[derive(Debug, Clone, PartialEq)]
pub struct Para {
    /// `"p-" + 首词 id`。
    pub id: String,
    pub sp: String,
    pub cue_indices: Vec<usize>,
}

/// 词序列拼接为展示文本（CJK 邻接不加空格）。
pub fn join_words<'a, I: IntoIterator<Item = &'a Word>>(words: I) -> String {
    crate::atomize::join_word_texts(words)
}

/// 手工拆行的词边界扫描：把「显示串字符偏移」`target_chars` 映射回词边界。
///
/// 标尺与 [`join_words`] / `join_word_texts` 完全一致（`join_prefix_char_lens`），
/// 不得自行按词累加固定分隔宽度。返回值是 **A 行末词** 在 `word_texts` 中的下标
/// （落在 `0..len-1`，`breaks` 钉就打在该词上）；不足两词时返回 `None`。
///
/// tie-breaking 定死：取前缀长度距 `target_chars` 最近的边界，等距取靠前边界。
pub fn split_boundary_at_char<W: crate::atomize::JoinWord>(
    word_texts: &[W],
    target_chars: usize,
) -> Option<usize> {
    if word_texts.len() < 2 {
        return None;
    }
    let prefixes = crate::atomize::join_prefix_char_lens(word_texts);
    let mut best: Option<(usize, usize)> = None;
    for (index, &prefix) in prefixes.iter().take(word_texts.len() - 1).enumerate() {
        let diff = prefix.abs_diff(target_chars);
        if best.is_none_or(|(_, best_diff)| diff < best_diff) {
            best = Some((index, diff));
        }
    }
    best.map(|(index, _)| index)
}

/// 标点优先断行阶梯（§18.5 条件 3–6，对拍 JS/Swift `autoBreak`）：
/// 句末 > 从句标点（破折号低门槛）> 长停顿 > 溢出。溢出在下一词以从句/
/// 句末标点收尾且总宽不超 `maxChars + overflowSlack` 时延长收入标点，
/// 避免在标点前一格硬切。
pub(crate) fn auto_break(word: &Word, next: &Word, line_chars: usize, params: &CueParams) -> bool {
    if crate::atomize::sentence_end(&word.text) {
        return true;
    }
    if let Some(punct) = crate::atomize::clause_end_char(&word.text) {
        let gate = if punct == '—' || punct == '–' {
            params.min_dash_chars
        } else {
            params.min_clause_chars
        };
        if line_chars >= gate {
            return true;
        }
    }
    if next.t0 - word.t1 >= params.pause_sec && line_chars >= params.min_pause_chars {
        return true;
    }
    let projected = line_chars
        + crate::atomize::word_sep(&word.text, next)
        + crate::atomize::visual_width(&next.text);
    if projected > params.max_chars {
        let imminent_punct = crate::atomize::clause_end_char(&next.text).is_some()
            || crate::atomize::sentence_end(&next.text);
        if imminent_punct && projected <= params.max_chars + params.overflow_slack {
            return false;
        }
        return true;
    }
    false
}

/// Cue 派生：顺序扫描非 hidden 词，按 §18.5 六条断行条件（优先级从高到低）。
///
/// 钉表取 [`TranscriptDoc::effective_breaks`]：`autoBreaks[layoutProfile]`
/// 打底、用户 `breaks` 覆盖同键（0.4 起优化器结果与用户意图分表）。
pub fn derive_cues(doc: &TranscriptDoc, params: &CueParams) -> Vec<Cue> {
    let mut cues: Vec<Cue> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut current_chars = 0_usize;
    let pins = doc.effective_breaks(doc.layout_profile_id());

    let visible: Vec<usize> = (0..doc.words.len())
        .filter(|index| !doc.words[*index].id.is_empty())
        .filter(|index| {
            !doc.hidden
                .get(&doc.words[*index].id)
                .copied()
                .unwrap_or(false)
        })
        .collect();

    let flush = |cues: &mut Vec<Cue>, current: &mut Vec<usize>| {
        if current.is_empty() {
            return;
        }
        let first = &doc.words[current[0]];
        let last = &doc.words[*current.last().expect("non-empty")];
        cues.push(Cue {
            id: format!("q-{}", first.id),
            start: first.t0,
            end: last.t1,
            sp: first.sp.clone(),
            word_indices: std::mem::take(current),
        });
    };

    for (position, &index) in visible.iter().enumerate() {
        let word = &doc.words[index];
        // paraBreaks 钉在词前。若该词落在一个已打开 Cue 内，必须先封口，
        // 否则 derive_paras 只能看到 Cue 首词，段落钉会有数据却无法生效。
        if !current.is_empty() && doc.para_breaks.get(&word.id).copied().unwrap_or(false) {
            flush(&mut cues, &mut current);
            current_chars = 0;
        }
        if let Some(&previous) = current.last() {
            current_chars += crate::atomize::word_sep(&doc.words[previous].text, word);
        }
        current.push(index);
        current_chars += crate::atomize::visual_width(&word.text);

        let next = visible.get(position + 1).map(|&next| &doc.words[next]);
        let Some(next) = next else {
            flush(&mut cues, &mut current);
            break;
        };

        // 优先级：说话人切换（不可抑制）> 手工 break/nobreak > 自动阶梯。
        // 句末必须封 Cue（Sentence 由完整 Cue 聚合），仅显式 nobreak 可抑制。
        let break_now = if next.sp != word.sp {
            true
        } else {
            match pins.get(&word.id).copied() {
                Some(BreakOverride::Break) => true,
                Some(BreakOverride::Nobreak) => false,
                None => auto_break(word, next, current_chars, params),
            }
        };
        if break_now {
            flush(&mut cues, &mut current);
            current_chars = 0;
        }
    }
    cues
}

/// Para 派生：（章节 × 连续同说话人）分组 + paraBreaks 钉。
pub fn derive_paras(doc: &TranscriptDoc, cues: &[Cue]) -> Vec<Para> {
    let mut paras: Vec<Para> = Vec::new();
    let mut current: Vec<usize> = Vec::new();

    let chapter_of = |t: f64| -> usize {
        doc.chapters
            .iter()
            .position(|chapter| t >= chapter.start && t < chapter.end)
            .unwrap_or(usize::MAX)
    };

    let flush = |paras: &mut Vec<Para>, current: &mut Vec<usize>| {
        if current.is_empty() {
            return;
        }
        let first_cue = &cues[current[0]];
        let first_word_id = first_cue.id.trim_start_matches("q-");
        paras.push(Para {
            id: format!("p-{first_word_id}"),
            sp: first_cue.sp.clone(),
            cue_indices: std::mem::take(current),
        });
    };

    for (index, cue) in cues.iter().enumerate() {
        // paraBreaks 钉在词前起新段：Cue 首词被钉 ⇒ 该 Cue 起新段。
        let first_word = &doc.words[cue.word_indices[0]];
        let pinned = doc
            .para_breaks
            .get(&first_word.id)
            .copied()
            .unwrap_or(false);
        if !current.is_empty() {
            let previous = &cues[*current.last().expect("non-empty")];
            let speaker_changed = previous.sp != cue.sp;
            let chapter_changed = chapter_of(previous.start) != chapter_of(cue.start);
            if pinned || speaker_changed || chapter_changed {
                flush(&mut paras, &mut current);
            }
        }
        current.push(index);
    }
    flush(&mut paras, &mut current);
    paras
}

/// 「短插话」段落的缺省字数上限（展示口径 `join_words` 字符数）。
pub const SHORT_INTERJECTION_MAX_CHARS: usize = 10;
/// 「短插话」段落的缺省时长上限（秒）。
pub const SHORT_INTERJECTION_MAX_SECONDS: f64 = 3.0;

/// 短插话段落：夹在**同一说话人**的两段之间、自身说话人不同、文本不超过
/// `max_chars` 字且时长不超过 `max_seconds` 秒的段落（「嗯。」「哦。」「对。」
/// 这类应答）。返回它们在 `paras` 里的下标（升序）。
///
/// 只是**观测口径**，不改派生：规范 §18.5 的 Para 仍按（章节 × 连续同说话人）
/// 分组，说话人一切换必然另起段。多人访谈实测 1965 段里 1284 段是这类插话
/// （369×「嗯。」，中位 8 字 / 0.95 s）；polish 信封以此计数上报，供 UI 决定
/// 折叠/内联展示，而不是改四端的派生逻辑（2026-08 裁决）。
pub fn short_interjection_paragraphs(
    doc: &TranscriptDoc,
    cues: &[Cue],
    paras: &[Para],
    max_chars: usize,
    max_seconds: f64,
) -> Vec<usize> {
    let mut found = Vec::new();
    for index in 1..paras.len().saturating_sub(1) {
        let (prev, this, next) = (&paras[index - 1], &paras[index], &paras[index + 1]);
        if prev.sp != next.sp || this.sp == prev.sp {
            continue;
        }
        let Some(&first) = this.cue_indices.first() else {
            continue;
        };
        let Some(&last) = this.cue_indices.last() else {
            continue;
        };
        let duration = cues[last].end - cues[first].start;
        if duration > max_seconds {
            continue;
        }
        let chars: usize = this
            .cue_indices
            .iter()
            .map(|&cue| cues[cue].text(doc).chars().count())
            .sum();
        if chars <= max_chars {
            found.push(index);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asr_rows::RowIn;
    use crate::build::build_doc;
    use crate::doc::{DocEngine, DocMedia, Word};
    use serde_json::{Value, json};

    fn doc_from_rows(rows: &[RowIn]) -> TranscriptDoc {
        build_doc(
            rows,
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 1000.0,
                sample_rate: None,
            },
            "zh",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        )
    }

    #[test]
    fn split_boundary_uses_the_join_ruler_and_breaks_ties_toward_the_earlier_boundary() {
        // 前缀长度按 join_word_texts 计：CJK 相邻不加空格。
        assert_eq!(
            crate::atomize::join_prefix_char_lens(["我", "用", "BaoCut", "剪"]),
            vec![1, 2, 9, 11]
        );
        // 等距 → 取靠前边界：前缀 [2, 4, 7]，target 3 与前两个边界等距。
        assert_eq!(split_boundary_at_char(&["ab", "c", "de"], 3), Some(0));
        // 不等距 → 取最近边界。
        assert_eq!(split_boundary_at_char(&["ab", "c", "de"], 4), Some(1));
        // 末词边界不参与（拆在末词之后等于没拆）；不足两词无法拆分。
        assert_eq!(split_boundary_at_char(&["ab", "c", "de"], 99), Some(1));
        assert_eq!(split_boundary_at_char(&["ab"], 0), None);
        assert_eq!(split_boundary_at_char::<&str>(&[], 0), None);
    }

    #[test]
    fn speaker_switch_always_breaks() {
        let mut row_a = RowIn::new(0.0, 2.0, "你好");
        row_a.speaker = Some("A".to_owned());
        let mut row_b = RowIn::new(2.0, 4.0, "再见");
        row_b.speaker = Some("B".to_owned());
        let doc = doc_from_rows(&[row_a, row_b]);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert_ne!(cues[0].sp, cues[1].sp);
    }

    #[test]
    fn clause_punctuation_breaks_after_min_chars() {
        let text = "今天我们来聊一聊这个产品的设计。然后再看看它的实现细节究竟如何。";
        let doc = doc_from_rows(&[RowIn::new(0.0, 10.0, text)]);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert!(cues[0].text(&doc).ends_with("。"));
    }

    #[test]
    fn short_sentence_end_still_closes_before_the_next_sentence() {
        // 回归真实失败形态：前一个展示 Cue 因 overflow 已在 "take" 前断开，
        // 剩下的 "their job." 很短；句号仍必须封口，不能把
        // 后一句 "Maybe…" 吞进同一 Cue / Sentence。
        let doc = doc_from_rows(&[RowIn::new(
            0.0,
            5.0,
            "take their job. Maybe they use a new tool.",
        )]);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text(&doc), "take their job.");
        assert_eq!(cues[1].text(&doc), "Maybe they use a new tool.");
    }

    #[test]
    fn manual_break_and_nobreak_overrides_apply() {
        let doc = {
            let mut doc = doc_from_rows(&[RowIn::new(0.0, 5.0, "一二三四五")]);
            doc.breaks.insert("g1.0~1".to_owned(), BreakOverride::Break);
            doc
        };
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text(&doc), "一二");
        assert_eq!(cues[1].id, "q-g1.0~2");
    }

    fn auto_pin(doc: &mut TranscriptDoc, profile: &str, id: &str, value: BreakOverride) {
        doc.auto_breaks
            .entry(profile.to_owned())
            .or_default()
            .insert(id.to_owned(), value);
    }

    /// `autoBreaks[default]` 的自动 pin 与用户 `breaks` 一样参与派生。
    #[test]
    fn auto_pins_apply_when_no_user_pin_covers_the_same_word() {
        let mut doc = doc_from_rows(&[RowIn::new(0.0, 5.0, "一二三四五")]);
        auto_pin(&mut doc, "default", "g1.0~1", BreakOverride::Break);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text(&doc), "一二");
        assert_eq!(cues[1].id, "q-g1.0~2");
    }

    /// 同键以用户 `breaks` 为准：用户 nobreak 压过自动 break，用户 break 压过自动 nobreak。
    #[test]
    fn user_pins_override_auto_pins_on_the_same_word() {
        let mut doc = doc_from_rows(&[RowIn::new(0.0, 5.0, "一二三四五")]);
        auto_pin(&mut doc, "default", "g1.0~1", BreakOverride::Break);
        doc.breaks
            .insert("g1.0~1".to_owned(), BreakOverride::Nobreak);
        assert_eq!(derive_cues(&doc, &CueParams::default()).len(), 1);

        // 句末封口只有 nobreak 能抑制；自动 nobreak 同样有效，但用户 break 压过它。
        let mut doc = doc_from_rows(&[RowIn::new(0.0, 5.0, "今天聊设计。再看实现。")]);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        let seam = doc.words[cues[0].word_indices[cues[0].word_indices.len() - 1]]
            .id
            .clone();
        auto_pin(&mut doc, "default", &seam, BreakOverride::Nobreak);
        assert_eq!(derive_cues(&doc, &CueParams::default()).len(), 1);
        doc.breaks.insert(seam, BreakOverride::Break);
        assert_eq!(derive_cues(&doc, &CueParams::default()).len(), 2);
    }

    /// 说话人切换不可抑制：用户与自动 nobreak 都拦不住。
    #[test]
    fn nobreak_pins_still_cannot_suppress_a_speaker_change() {
        let mut row_a = RowIn::new(0.0, 2.0, "你好");
        row_a.speaker = Some("A".to_owned());
        let mut row_b = RowIn::new(2.0, 4.0, "再见");
        row_b.speaker = Some("B".to_owned());
        let mut doc = doc_from_rows(&[row_a, row_b]);
        let seam = doc.words[0].id.clone();
        doc.breaks.insert(seam.clone(), BreakOverride::Nobreak);
        auto_pin(&mut doc, "default", &seam, BreakOverride::Nobreak);
        assert_eq!(derive_cues(&doc, &CueParams::default()).len(), 2);
    }

    /// 文档指向未知/其他 profile 时，只有用户 pin 生效。
    #[test]
    fn unknown_layout_profile_falls_back_to_user_pins_only() {
        let mut doc = doc_from_rows(&[RowIn::new(0.0, 5.0, "一二三四五")]);
        auto_pin(&mut doc, "default", "g1.0~1", BreakOverride::Break);
        doc.layout_profile = Some("portrait".to_owned());
        assert_eq!(derive_cues(&doc, &CueParams::default()).len(), 1);
        doc.breaks.insert("g1.0~3".to_owned(), BreakOverride::Break);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text(&doc), "一二三四");
    }

    #[test]
    fn hidden_words_are_excluded_from_cues() {
        let mut doc = doc_from_rows(&[RowIn::new(0.0, 5.0, "嗯这个很好")]);
        doc.hidden.insert("g1.0".to_owned(), true);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues[0].text(&doc), "这个很好");
        assert_eq!(cues[0].id, "q-g1.0~1");
    }

    #[test]
    fn cue_derivation_matches_shared_rust_javascript_and_swift_contract() {
        let contract: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/subtitle-render-contract.json"
        ))
        .unwrap();

        for row in contract["cueDerivations"].as_array().unwrap() {
            let mut doc = TranscriptDoc::new(
                DocMedia {
                    id: None,
                    path: None,
                    hash: "sha256-contract".to_owned(),
                    duration: 10.0,
                    sample_rate: None,
                },
                "en",
                DocEngine {
                    name: "contract".to_owned(),
                    version: None,
                    aligned_words: true,
                },
            );
            doc.words = serde_json::from_value::<Vec<Word>>(row["words"].clone()).unwrap();
            doc.breaks = serde_json::from_value(row["breaks"].clone()).unwrap();
            doc.hidden = serde_json::from_value(row["hidden"].clone()).unwrap();
            // 0.4 增补：`autoBreaks[profile]` 打底、`breaks` 覆盖；夹具缺省即空表。
            if let Some(auto) = row.get("autoBreaks") {
                doc.auto_breaks = serde_json::from_value(auto.clone()).unwrap();
            }
            if let Some(profile) = row.get("layoutProfile") {
                doc.layout_profile = serde_json::from_value(profile.clone()).unwrap();
            }

            let actual = derive_cues(&doc, &CueParams::default())
                .into_iter()
                .map(|cue| {
                    json!({
                        "id": cue.id,
                        "start": cue.start,
                        "end": cue.end,
                        "sp": cue.sp,
                        "text": cue.text(&doc),
                        "wordIds": cue.word_indices.into_iter()
                            .map(|index| doc.words[index].id.clone())
                            .collect::<Vec<_>>(),
                    })
                })
                .collect::<Vec<_>>();
            assert_eq!(Value::Array(actual), row["expected"], "{}", row["name"]);
        }
    }

    #[test]
    fn cue_id_is_stable_across_rederivation() {
        let doc = doc_from_rows(&[RowIn::new(0.0, 5.0, "大家好，今天讲字幕系统的设计与实现。")]);
        let a = derive_cues(&doc, &CueParams::default());
        let b = derive_cues(&doc, &CueParams::default());
        assert_eq!(a, b);
    }

    #[test]
    fn paras_group_by_speaker_and_pins() {
        let mut row_a = RowIn::new(0.0, 2.0, "今天我们先来讲第一个完整的句子。");
        row_a.speaker = Some("A".to_owned());
        let mut row_b = RowIn::new(2.0, 4.0, "然后我们再来讲第二个完整的句子。");
        row_b.speaker = Some("A".to_owned());
        let mut doc = doc_from_rows(&[row_a, row_b]);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(derive_paras(&doc, &cues).len(), 1);
        doc.para_breaks.insert("g2.0".to_owned(), true);
        let paras = derive_paras(&doc, &cues);
        assert_eq!(paras.len(), 2);
        assert_eq!(paras[1].id, "p-g2.0");
    }

    #[test]
    fn paragraph_pin_inside_open_cue_forces_a_cue_boundary() {
        let mut doc = doc_from_rows(&[RowIn::new(0.0, 5.0, "alpha bravo charlie delta")]);
        doc.para_breaks.insert("g1.2".to_owned(), true);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text(&doc), "alpha bravo");
        assert_eq!(cues[1].id, "q-g1.2");
        let paras = derive_paras(&doc, &cues);
        assert_eq!(paras.len(), 2);
        assert_eq!(paras[1].id, "p-g1.2");
    }
    /// 短插话观测口径：夹在同一说话人之间的「嗯。」计入，长回答与同说话人
    /// 的相邻段不计；派生本身不变（插话仍是独立 Para）。
    #[test]
    fn short_interjections_are_counted_but_still_their_own_paragraphs() {
        let mut row_a = RowIn::new(0.0, 4.0, "今天我们先来讲第一个完整的句子。");
        row_a.speaker = Some("A".to_owned());
        let mut row_b = RowIn::new(4.0, 4.6, "嗯。");
        row_b.speaker = Some("B".to_owned());
        let mut row_c = RowIn::new(4.6, 8.0, "然后我们再来讲第二个完整的句子。");
        row_c.speaker = Some("A".to_owned());
        let mut row_d = RowIn::new(8.0, 12.0, "这个问题我觉得要分三层来看才说得清楚。");
        row_d.speaker = Some("B".to_owned());
        let mut row_e = RowIn::new(12.0, 14.0, "好的。");
        row_e.speaker = Some("A".to_owned());
        let doc = doc_from_rows(&[row_a, row_b, row_c, row_d, row_e]);
        let cues = derive_cues(&doc, &CueParams::default());
        let paras = derive_paras(&doc, &cues);
        assert_eq!(paras.len(), 5, "派生不变：说话人一切换必然另起段");
        let found = short_interjection_paragraphs(
            &doc,
            &cues,
            &paras,
            SHORT_INTERJECTION_MAX_CHARS,
            SHORT_INTERJECTION_MAX_SECONDS,
        );
        assert_eq!(
            found,
            vec![1],
            "「嗯。」计入；长回答不计；末段「好的。」没有右邻不计"
        );
        // 时长上限：同样的「嗯。」拖到 5 秒就不算插话。
        let mut row_slow = RowIn::new(4.0, 9.0, "嗯。");
        row_slow.speaker = Some("B".to_owned());
        let mut row_a2 = RowIn::new(0.0, 4.0, "今天我们先来讲第一个完整的句子。");
        row_a2.speaker = Some("A".to_owned());
        let mut row_c2 = RowIn::new(9.0, 12.0, "然后我们再来讲第二个完整的句子。");
        row_c2.speaker = Some("A".to_owned());
        let doc = doc_from_rows(&[row_a2, row_slow, row_c2]);
        let cues = derive_cues(&doc, &CueParams::default());
        let paras = derive_paras(&doc, &cues);
        assert!(short_interjection_paragraphs(&doc, &cues, &paras, 10, 3.0).is_empty());
    }
}
