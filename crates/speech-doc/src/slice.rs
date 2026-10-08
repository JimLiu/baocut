//! 从一份 transcript 切出源媒体区间 `[in, out)` 的子文档（`bcut shorts cut`，
//! `docs/design/video/bcut-shorts-design.md` §5.5 / D5）。
//!
//! 切出来的新项目与源**引用同一个媒体文件**，主轨是一段 clip `[in, out]`，所以：
//!
//! * 词时间**不重基**，仍是源媒体秒——字幕按 clip 投影到时间轴 `0..out-in`，与在源项目里
//!   对同一段剪一刀完全同口径；`media` 原样保留（`duration` 也是源媒体的）。
//! * 词 id 不变：`s-<首词id>` 句键、覆盖表、译文表都能直接按 id 过滤。
//! * 词的去留看**中点**是否落在 `[in, out)`：跨边界的词归中点那一侧，clip 投影会把
//!   它裁到边界上。
//! * 译文只留**整句都切进来**的句子（`trans` / `transSrc` / `transAlign` /
//!   `transDisplay` 同步过滤）；被切掉头或尾的句子没有译文，交给翻译流程补——
//!   半句的原文配整句的译文只会是错字幕。
//! * 阶段戳：源里「此刻仍有效」的戳按切片重算（切片继承源的有效性），源里已过期的戳
//!   原样留着（仍对不上切片，继续表达「有人工改动」）。
//! * 章节：[`slice_range`] 把与切片相交的章节裁进来；`bcut shorts cut` 走
//!   [`slice_range_with`] 且 `keep_chapters: false`——一支短视频不该带长视频的章节
//!   （`chapters` 为空、`stages.chapters` 清掉，表示「没生成过章节」）。

use std::collections::{BTreeMap, BTreeSet};

use crate::doc::TranscriptDoc;
use crate::fingerprint::{fingerprint, id_fingerprint};
use crate::layout::layout_fingerprint;
use crate::sentence::derive_sentences;

/// [`slice_range_with`] 的选项。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SliceOptions {
    /// 保留与切片相交的章节（裁到切片边界）；`false` 时切片不带章节。
    pub keep_chapters: bool,
}

impl Default for SliceOptions {
    fn default() -> Self {
        Self {
            keep_chapters: true,
        }
    }
}

/// 切出 `[in, out)`，章节裁进来。调用方保证 `in < out`。
pub fn slice_range(doc: &TranscriptDoc, start: f64, end: f64) -> TranscriptDoc {
    slice_range_with(doc, start, end, SliceOptions::default())
}

/// 切出 `[in, out)`，按 `options` 决定带不带章节。调用方保证 `in < out`。
pub fn slice_range_with(
    doc: &TranscriptDoc,
    start: f64,
    end: f64,
    options: SliceOptions,
) -> TranscriptDoc {
    let keep = |t0: f64, t1: f64| {
        let mid = (t0 + t1) / 2.0;
        mid >= start && mid < end
    };
    let kept: BTreeSet<&str> = doc
        .words
        .iter()
        .filter(|word| keep(word.t0, word.t1))
        .map(|word| word.id.as_str())
        .collect();
    // 整句都在切片里的句子才保留译文。
    let whole_sentences: BTreeSet<String> = derive_sentences(doc, &[])
        .into_iter()
        .filter(|sentence| {
            sentence
                .word_indices
                .iter()
                .all(|&index| kept.contains(doc.words[index].id.as_str()))
        })
        .map(|sentence| sentence.id)
        .collect();

    let mut out = doc.clone();
    out.words.retain(|word| kept.contains(word.id.as_str()));
    let speakers: BTreeSet<&str> = out.words.iter().map(|word| word.sp.as_str()).collect();
    out.speakers.retain(|id, _| speakers.contains(id.as_str()));
    out.chapters = if options.keep_chapters {
        doc.chapters
            .iter()
            .filter(|chapter| chapter.end > start && chapter.start < end)
            .map(|chapter| {
                let mut chapter = chapter.clone();
                chapter.start = chapter.start.max(start);
                chapter.end = chapter.end.min(end);
                chapter
            })
            .collect()
    } else {
        Vec::new()
    };
    out.prune_orphan_overrides();

    fn keep_sentences<V>(
        table: &mut BTreeMap<String, BTreeMap<String, V>>,
        ids: &BTreeSet<String>,
    ) {
        for rows in table.values_mut() {
            rows.retain(|id, _| ids.contains(id));
        }
        table.retain(|_, rows| !rows.is_empty());
    }
    keep_sentences(&mut out.trans, &whole_sentences);
    keep_sentences(&mut out.trans_src, &whole_sentences);
    keep_sentences(&mut out.trans_align, &whole_sentences);
    keep_sentences(&mut out.trans_display, &whole_sentences);

    // 阶段戳：源里仍有效的按切片重算，过期的原样保留。
    let source_content = fingerprint(&doc.words);
    let source_ids = id_fingerprint(&doc.words);
    let source_layout = layout_fingerprint(doc);
    let content = fingerprint(&out.words);
    let ids = id_fingerprint(&out.words);
    let layout = layout_fingerprint(&out);
    let restamp = |stamp: &mut Option<String>, source: &str, sliced: &str| {
        if stamp.as_deref() == Some(source) {
            *stamp = Some(sliced.to_owned());
        }
    };
    restamp(&mut out.stages.asr, &source_content, &content);
    restamp(&mut out.stages.polish, &source_content, &content);
    restamp(&mut out.stages.chapters, &source_content, &content);
    restamp(&mut out.stages.segment, &source_ids, &ids);
    restamp(&mut out.stages.asr_layout, &source_layout, &layout);
    if !options.keep_chapters {
        out.stages.chapters = None;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{Chapter, DocEngine, DocMedia, Speaker, Word};

    fn word(id: &str, t0: f64, t1: f64, text: &str, sp: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1,
            text: text.to_owned(),
            sp: sp.to_owned(),
            glue: false,
        }
    }

    fn source() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: Some("talk.mp4".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 100.0,
                sample_rate: None,
            },
            "zh",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        for (id, name) in [("s1", "甲"), ("s2", "乙")] {
            doc.speakers.insert(
                id.to_owned(),
                Speaker {
                    name: name.to_owned(),
                    hue: None,
                },
            );
        }
        // 句 A：w0..w1（10–11 s，头在切片外）；句 B：w2..w3（20–21 s，整句在内）；
        // 句 C：w4..w5（29.5–31 s，尾在切片外）；w6 是乙在 50 s 说的，切片外。
        doc.words = vec![
            word("w0", 9.0, 9.8, "前面", "s1"),
            word("w1", 10.2, 11.0, "一句。", "s1"),
            word("w2", 20.0, 20.5, "中间", "s1"),
            word("w3", 20.5, 21.0, "一句。", "s1"),
            word("w4", 29.5, 29.9, "后面", "s1"),
            word("w5", 30.2, 31.0, "一句。", "s1"),
            word("w6", 50.0, 51.0, "乙。", "s2"),
        ];
        doc.chapters = vec![
            Chapter {
                id: "ch1".to_owned(),
                title: "开头".to_owned(),
                start: 0.0,
                end: 25.0,
            },
            Chapter {
                id: "ch2".to_owned(),
                title: "后面".to_owned(),
                start: 25.0,
                end: 100.0,
            },
        ];
        doc.para_breaks.insert("w2".to_owned(), true);
        doc.para_breaks.insert("w6".to_owned(), true);
        for sid in ["s-w0", "s-w2", "s-w4"] {
            doc.trans
                .entry("en".to_owned())
                .or_default()
                .insert(sid.to_owned(), format!("{sid} in English"));
            doc.trans_src
                .entry("en".to_owned())
                .or_default()
                .insert(sid.to_owned(), "fp".to_owned());
        }
        doc.stages.asr = Some(fingerprint(&doc.words));
        doc.stages.segment = Some(id_fingerprint(&doc.words));
        doc.stages.asr_layout = Some(layout_fingerprint(&doc));
        doc.stages.polish = Some("stale-by-hand-edit".to_owned());
        doc
    }

    #[test]
    fn keeps_word_ids_and_media_seconds_and_only_whole_sentence_translations() {
        let doc = source();
        let cut = slice_range(&doc, 10.0, 30.0);
        let ids: Vec<&str> = cut.words.iter().map(|word| word.id.as_str()).collect();
        // w0 中点 9.4 在外；w1 中点 10.6 在内；w4 中点 29.7 在内；w5 中点 30.6 在外。
        assert_eq!(ids, ["w1", "w2", "w3", "w4"]);
        assert_eq!(cut.words[0].t0, 10.2, "词时间不重基");
        assert_eq!(cut.media, doc.media);
        assert_eq!(cut.speakers.keys().collect::<Vec<_>>(), ["s1"]);
        assert_eq!(
            cut.chapters
                .iter()
                .map(|chapter| (chapter.id.as_str(), chapter.start, chapter.end))
                .collect::<Vec<_>>(),
            [("ch1", 10.0, 25.0), ("ch2", 25.0, 30.0)]
        );
        assert_eq!(cut.para_breaks.keys().collect::<Vec<_>>(), ["w2"]);
        assert_eq!(cut.trans["en"].keys().collect::<Vec<_>>(), ["s-w2"]);
        assert_eq!(cut.trans_src["en"].keys().collect::<Vec<_>>(), ["s-w2"]);
        cut.validate().unwrap();
    }

    #[test]
    fn valid_stamps_follow_the_slice_and_stale_ones_stay_stale() {
        let doc = source();
        let cut = slice_range(&doc, 10.0, 30.0);
        assert_eq!(cut.stages.asr, Some(fingerprint(&cut.words)));
        assert_eq!(cut.stages.segment, Some(id_fingerprint(&cut.words)));
        assert_eq!(cut.stages.asr_layout, Some(layout_fingerprint(&cut)));
        assert_eq!(cut.stages.polish.as_deref(), Some("stale-by-hand-edit"));
    }

    #[test]
    fn without_chapters_the_slice_drops_chapters_and_their_stamp() {
        let mut doc = source();
        doc.stages.chapters = Some(fingerprint(&doc.words));
        let kept = slice_range(&doc, 10.0, 30.0);
        assert_eq!(kept.chapters.len(), 2, "缺省行为不变：章节裁进来");
        assert_eq!(kept.stages.chapters, Some(fingerprint(&kept.words)));
        let cut = slice_range_with(
            &doc,
            10.0,
            30.0,
            SliceOptions {
                keep_chapters: false,
            },
        );
        assert!(cut.chapters.is_empty());
        assert_eq!(cut.stages.chapters, None);
        assert_eq!(cut.words, kept.words, "只少章节，词与译文和缺省切法一致");
        assert_eq!(cut.trans, kept.trans);
        assert_eq!(cut.stages.asr, kept.stages.asr);
        cut.validate().unwrap();
    }

    #[test]
    fn an_empty_range_keeps_no_words_or_translations() {
        let cut = slice_range(&source(), 60.0, 70.0);
        assert!(cut.words.is_empty());
        assert!(cut.trans.is_empty());
        assert!(cut.speakers.is_empty());
        assert!(cut.chapters.iter().all(|chapter| chapter.id == "ch2"));
    }
}
