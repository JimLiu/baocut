//! 用强制对齐给没有词时间的长行补词时间，并把词起点展开为严格递增。移植自 v2 `bcut-speech-core`。

use anyhow::Result;

use super::{AlignedWord, RowIn, WordIn};

pub const MIN_ROW_DURATION: f64 = 5.0;

/// 对齐器的时间格（秒）。零时长的词补到一格（至多到下一个词的起点）；`align` 的一段只有零长的词时，段尾往后补一格。
pub const ALIGNER_GRID_SECONDS: f64 = 0.08;

/// 将量化到同一时间格的词起点稳定地展开为严格递增序列，并给零时长的词补上时长。
///
/// forced aligner 的时间格是 80 ms，连续短词可能得到相同起点；落盘契约要求
/// `words[].t` 严格递增，因此只加不影响字幕可见时间的亚毫秒偏移。
/// 起止塌成一点的词（对齐器把两个时间槽解到同一格）补到一个对齐格，不越过下一个词的起点与行尾：
/// 下游按 `end > start` 认词，零时长的词会从字幕与导出里消失。
pub fn enforce_strict_word_times(words: &mut [WordIn], row_start: f64, row_end: f64) {
    if words.is_empty() || row_end <= row_start {
        return;
    }
    let epsilon = (row_end - row_start) / (words.len() + 1) as f64;
    let epsilon = epsilon.min(0.000_1);
    let count = words.len();
    let mut previous = row_start - epsilon;
    for (index, word) in words.iter_mut().enumerate() {
        let remaining = count - index;
        let latest = row_end - epsilon * remaining as f64;
        word.start = word.start.clamp(row_start, latest).max(previous + epsilon);
        word.end = word.end.clamp(word.start, row_end);
        previous = word.start;
    }
    // 起点已严格递增且最后一个起点 ≤ row_end − epsilon，所以上限总在起点之后。
    for index in 0..count {
        if words[index].end > words[index].start {
            continue;
        }
        let limit = words.get(index + 1).map_or(row_end, |next| next.start);
        words[index].end = (words[index].start + ALIGNER_GRID_SECONDS).min(limit);
    }
}

pub fn indices_needing_words(rows: &[RowIn]) -> Vec<usize> {
    rows.iter()
        .enumerate()
        .filter_map(|(index, row)| {
            let missing_words = row.words.as_ref().is_none_or(Vec::is_empty);
            (missing_words && row.end - row.start > MIN_ROW_DURATION && !row.text.is_empty()).then_some(index)
        })
        .collect()
}

pub fn refine_word_timings<F, P>(
    rows: &[RowIn],
    samples: &[f32],
    sample_rate: f64,
    language: &str,
    mut align: F,
    mut progress: P,
) -> Result<Vec<RowIn>>
where
    F: FnMut(&[f32], &str, &str) -> Result<Vec<AlignedWord>>,
    P: FnMut(f64),
{
    let targets = indices_needing_words(rows);
    if targets.is_empty() {
        return Ok(rows.to_vec());
    }
    let mut output = rows.to_vec();
    for (done, index) in targets.iter().copied().enumerate() {
        let row = &output[index];
        let lower = ((row.start * sample_rate) as usize).min(samples.len());
        let upper = ((row.end * sample_rate) as usize).min(samples.len());
        if upper <= lower {
            continue;
        }
        let aligned = align(&samples[lower..upper], &row.text, language)?;
        let mut words: Vec<WordIn> = aligned
            .into_iter()
            .filter_map(|word| {
                let text = word.text.trim();
                if text.is_empty() {
                    return None;
                }
                let start = row.start + word.start as f64;
                Some(WordIn {
                    start,
                    end: start.max(row.start + word.end as f64),
                    text: text.to_string(),
                })
            })
            .collect();
        enforce_strict_word_times(&mut words, row.start, row.end);
        if !words.is_empty() {
            output[index].words = Some(words);
        }
        progress((done + 1) as f64 / targets.len() as f64);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_timing_refiner_selects_and_maps_absolute_times() -> Result<()> {
        let rows = vec![RowIn::new(3.0, 5.0, "短行"), RowIn::new(10.0, 20.0, "你好 世界")];
        assert_eq!(indices_needing_words(&rows), vec![1]);
        let samples = vec![0.1; 25 * 16_000];
        let mut progress = Vec::new();
        let output = refine_word_timings(
            &rows,
            &samples,
            16_000.0,
            "Chinese",
            |audio, text, language| {
                assert_eq!(audio.len(), 10 * 16_000);
                assert_eq!(text, "你好 世界");
                assert_eq!(language, "Chinese");
                Ok(vec![
                    AlignedWord {
                        text: "你好".into(),
                        start: 0.5,
                        end: 1.0,
                    },
                    AlignedWord {
                        text: "世界".into(),
                        start: 8.5,
                        end: 9.25,
                    },
                ])
            },
            |fraction| progress.push(fraction),
        )?;
        assert_eq!(
            output[1].words,
            Some(vec![
                WordIn {
                    start: 10.5,
                    end: 11.0,
                    text: "你好".into()
                },
                WordIn {
                    start: 18.5,
                    end: 19.25,
                    text: "世界".into()
                },
            ])
        );
        assert_eq!(progress, vec![1.0]);
        Ok(())
    }

    #[test]
    fn word_timing_refiner_expands_duplicate_starts_inside_row_bounds() {
        let mut words = vec![
            WordIn {
                start: 1.0,
                end: 1.0,
                text: "一".into(),
            },
            WordIn {
                start: 1.0,
                end: 1.0,
                text: "二".into(),
            },
            WordIn {
                start: 3.0,
                end: 9.0,
                text: "三".into(),
            },
        ];
        enforce_strict_word_times(&mut words, 1.0, 4.0);
        assert!(words.windows(2).all(|pair| pair[0].start < pair[1].start));
        assert!(
            words
                .iter()
                .all(|word| { word.start >= 1.0 && word.start < 4.0 && word.end > word.start && word.end <= 4.0 })
        );
    }

    /// 真实样本（qwen3-asr + 强制对齐）：`ask—you` 的两个时间槽解到同一格，起止塌成一点，后面有 0.24 秒的空隙。
    #[test]
    fn zero_duration_word_takes_one_grid_from_the_following_gap() {
        let word = |start: f64, end: f64, text: &str| WordIn {
            start,
            end,
            text: text.into(),
        };
        let mut words = vec![
            word(14.716, 14.956, "just"),
            word(14.956, 14.956, "ask—you"),
            word(15.196, 15.436, "know,"),
        ];
        enforce_strict_word_times(&mut words, 14.0, 16.0);
        assert_eq!(words[0].end, 14.956);
        assert_eq!(words[1].start, 14.956);
        assert!((words[1].end - 15.036).abs() < 1e-9, "{words:?}");
        assert_eq!(words[2].start, 15.196);

        // 空隙比一格窄：只补到下一个词的起点；行尾的零时长词补到行尾为止。
        let mut tight = vec![word(1.0, 1.0, "to"), word(1.03, 1.3, "be"), word(1.3, 1.3, "frank.")];
        enforce_strict_word_times(&mut tight, 1.0, 1.35);
        assert!((tight[0].end - 1.03).abs() < 1e-9, "{tight:?}");
        assert!((tight[2].end - 1.35).abs() < 1e-9, "{tight:?}");
        assert!(tight.iter().all(|word| word.end > word.start));
        assert!(tight.windows(2).all(|pair| pair[0].end <= pair[1].start));
    }
}
