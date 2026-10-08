//! 在线检查生成循环；只看模型输出，不依赖语言、音频后端或墙钟时间。

use std::collections::{HashSet, VecDeque};

use crate::speech::moss_parse::MossOutputSegment;

/// 沿用原来的 token 退化检查，并让两个后端共用同一判据。
pub(crate) fn repetitive_token_tail(tokens: &[i32]) -> bool {
    tokens.len() >= 24 && tokens[tokens.len() - 24..].iter().collect::<HashSet<_>>().len() <= 3
}

/// 有时间戳的整段循环通常含有远多于三种 token，需在解析后检查。
#[derive(Default)]
pub(super) struct RepetitionGuard {
    recent: VecDeque<MossOutputSegment>,
    stopped: bool,
}

impl RepetitionGuard {
    /// 最近八段形成周期不超过四段的重复，且终点高水位相比窗口第一段最多
    /// 推进 0.5 s，才判为循环。覆盖 0.01 s 爬行、原地和倒退循环；正常随时间
    /// 推进的重复词句、歌词、音乐标签保持原样。保留说话人身份以免混同重叠对话。
    pub(super) fn observe(&mut self, segment: &MossOutputSegment) -> bool {
        const WINDOW: usize = 8;
        const MAX_ADVANCE_SECONDS: f64 = 0.5;
        if self.stopped {
            return true;
        }
        if self.recent.len() == WINDOW {
            self.recent.pop_front();
        }
        self.recent.push_back(segment.clone());
        if self.recent.len() < WINDOW {
            return false;
        }
        let first_end = self.recent[0].end;
        let advances = self.recent.iter().any(|recent| recent.end > first_end + MAX_ADVANCE_SECONDS);
        self.stopped = !advances
            && (1..=WINDOW / 2).any(|period| {
                self.recent.iter().enumerate().all(|(index, recent)| {
                    let previous = &self.recent[index % period];
                    recent.text.trim() == previous.text.trim() && recent.speaker == previous.speaker
                })
            });
        self.stopped
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::speech::moss_parse::MossStreamDecoder;

    fn segment(start: f64, end: f64, text: &str) -> MossOutputSegment {
        MossOutputSegment {
            start,
            end,
            text: text.to_owned(),
            speaker: "S01".to_owned(),
        }
    }

    #[test]
    fn centisecond_and_stationary_loops_stop_without_a_token_budget() {
        for text in ["[Music]", "[音楽]", "♪", "مرحبا"] {
            for step in [0.01, 0.0, -0.01] {
                let mut guard = RepetitionGuard::default();
                for index in 0..8 {
                    let start = 11.99 + index as f64 * step;
                    assert_eq!(
                        guard.observe(&segment(start, start + step.max(0.0), text)),
                        index == 7,
                        "{text}, {step}, {index}"
                    );
                }
                assert!(guard.observe(&segment(20.0, 21.0, "later")), "stop is sticky");
            }
        }
    }

    #[test]
    fn alternating_full_segments_are_detected_despite_many_distinct_tokens() {
        let mut guard = RepetitionGuard::default();
        for index in 0..8 {
            let text = ["[Music]", "[Applause]"][index % 2];
            assert_eq!(guard.observe(&segment(10.0, 11.99, text)), index == 7);
        }
        assert!(!repetitive_token_tail(&(0..12).cycle().take(48).collect::<Vec<_>>()));
        assert!(repetitive_token_tail(&[1; 24]));
        assert!(!repetitive_token_tail(&[1; 23]));
    }

    #[test]
    fn stream_chunk_boundaries_and_final_flush_do_not_hide_a_loop() {
        let output = "[11.99][S01][音楽][11.99]".repeat(8);
        for step in [1, 7, 16, 64, output.len()] {
            let mut decoder = MossStreamDecoder::default();
            let mut guard = RepetitionGuard::default();
            // 第八段直到 finish 才完整交付；两个推理后端也检查最终这次 flush。
            for bytes in output.as_bytes().chunks(step) {
                for segment in decoder.push(bytes) {
                    assert!(!guard.observe(&segment), "step {step}");
                }
            }
            let remaining = decoder.finish();
            assert_eq!(remaining.len(), 1);
            assert!(guard.observe(&remaining[0]), "step {step}");
        }
    }

    #[test]
    fn real_repetitions_and_brief_timestamp_errors_keep_generating() {
        for text in ["はい", "yes", "[Music]", "♪"] {
            let mut guard = RepetitionGuard::default();
            for index in 0..100 {
                let start = index as f64 * 0.1;
                assert!(!guard.observe(&segment(start, start + 0.1, text)));
            }
        }
        let mut guard = RepetitionGuard::default();
        for _ in 0..7 {
            assert!(!guard.observe(&segment(11.99, 11.99, "[Music]")));
        }
        assert!(!guard.observe(&segment(12.0, 13.0, "speech resumes")));
        let mut guard = RepetitionGuard::default();
        for index in 0..16 {
            assert!(!guard.observe(&segment(11.99, 11.99, &format!("word {index}"))));
        }
        let mut guard = RepetitionGuard::default();
        for index in 0..8 {
            let mut overlapping = segment(10.0, 11.0, "yes");
            overlapping.speaker = format!("S{index:02}");
            assert!(!guard.observe(&overlapping));
        }
    }
}
