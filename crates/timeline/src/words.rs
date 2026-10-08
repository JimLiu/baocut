use crate::schema::TimelineError;

pub const DEFAULT_WORD_PAD: f64 = 0.05;

#[derive(Debug, Clone, PartialEq)]
pub struct WordTiming {
    pub id: String,
    pub t0: f64,
    pub t1: f64,
    pub hidden: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WordSpan {
    pub source_start: f64,
    pub source_end: f64,
}

pub fn resolve_word_span(
    words: &[WordTiming],
    first_id: &str,
    last_id: &str,
    media_duration: f64,
    fps: f64,
    pad_pre: f64,
    pad_post: f64,
) -> Result<WordSpan, TimelineError> {
    if !media_duration.is_finite()
        || media_duration < 0.0
        || !fps.is_finite()
        || fps <= 0.0
        || !pad_pre.is_finite()
        || !pad_post.is_finite()
        || pad_pre < 0.0
        || pad_post < 0.0
    {
        return Err(TimelineError::Invalid("WordSpan 参数非法".to_owned()));
    }
    let first_index = words
        .iter()
        .position(|word| word.id == first_id)
        .ok_or_else(|| TimelineError::Invalid(format!("word 不存在：{first_id}")))?;
    let last_index = words
        .iter()
        .position(|word| word.id == last_id)
        .ok_or_else(|| TimelineError::Invalid(format!("word 不存在：{last_id}")))?;
    if first_index > last_index {
        return Err(TimelineError::Invalid(
            "WordSpan 首词位于末词之后".to_owned(),
        ));
    }
    let first = &words[first_index];
    let last = &words[last_index];
    if !first.t0.is_finite() || !last.t1.is_finite() || first.t0 < 0.0 || last.t1 > media_duration {
        return Err(TimelineError::Invalid("word 时间超出媒体范围".to_owned()));
    }
    let source_start = word_span_start(words, first_index, fps, pad_pre);
    let source_end = word_span_end(words, last_index, media_duration, fps, pad_post);
    if source_end <= source_start {
        return Err(TimelineError::Invalid("WordSpan 对齐后为空".to_owned()));
    }
    Ok(WordSpan {
        source_start,
        source_end,
    })
}

/// 「以 `words[first_index]` 开头的按词剪」的起点：不越过前一个可见词的尾（隐藏词不算），
/// 留 `pad_pre` 余量，帧对齐缺省向外（向前）取整、外扩越回前一个可见词时改向内取整。
///
/// [`resolve_word_span`] 的起点就是它；剪辑模式拖剪口左边缘时的吸附候选也只走它，
/// 两处口径因此恒等。调用方保证下标有效、`fps > 0`。
pub fn word_span_start(words: &[WordTiming], first_index: usize, fps: f64, pad_pre: f64) -> f64 {
    let first = &words[first_index];
    let previous_end = words[..first_index]
        .iter()
        .rev()
        .find(|word| !word.hidden)
        .map_or(0.0, |word| word.t1);
    let raw_start = previous_end.max(first.t0 - pad_pre).max(0.0);
    // 帧对齐缺省向外取整；若外扩越回相邻可见词（"不越相邻词"是硬约束），改为向内取整。
    let mut source_start = ((raw_start * fps).floor() / fps).max(0.0);
    if source_start < previous_end - 1e-9 {
        source_start = (raw_start * fps).ceil() / fps;
    }
    source_start
}

/// 「以 `words[last_index]` 结尾的按词剪」的终点（[`word_span_start`] 的镜像）：不越过后一个
/// 可见词的头，留 `pad_post` 余量，夹到 `media_duration`，帧对齐缺省向外（向后）取整、
/// 外扩越过后一个可见词时改向内取整。调用方保证下标有效、`fps > 0`。
pub fn word_span_end(
    words: &[WordTiming],
    last_index: usize,
    media_duration: f64,
    fps: f64,
    pad_post: f64,
) -> f64 {
    let last = &words[last_index];
    let next_start = words[last_index + 1..]
        .iter()
        .find(|word| !word.hidden)
        .map_or(media_duration, |word| word.t0);
    let raw_end = next_start.min(last.t1 + pad_post).min(media_duration);
    let mut source_end = ((raw_end * fps).ceil() / fps).min(media_duration);
    if source_end > next_start + 1e-9 {
        source_end = (raw_end * fps).floor() / fps;
    }
    source_end
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(id: &str, t0: f64, t1: f64, hidden: bool) -> WordTiming {
        WordTiming {
            id: id.to_owned(),
            t0,
            t1,
            hidden,
        }
    }

    #[test]
    fn span_adds_breathing_room_without_crossing_visible_neighbors() {
        let words = vec![
            word("w1", 0.10, 0.30, false),
            word("hidden", 0.31, 0.34, true),
            word("w2", 0.36, 0.55, false),
            word("w3", 0.57, 0.75, false),
        ];
        let span = resolve_word_span(&words, "w2", "w2", 1.0, 30.0, 0.05, 0.05).unwrap();
        // 尾侧向外取整会落到 0.60、越入 w3（0.57 起）：硬约束优先，向内对齐到 17/30。
        assert_eq!(
            span,
            WordSpan {
                source_start: 0.30,
                source_end: 17.0 / 30.0
            }
        );
    }

    #[test]
    fn span_rounds_outward_to_frame_grid_and_clamps_media_edges() {
        let words = vec![word("w1", 0.01, 0.99, false)];
        let span = resolve_word_span(
            &words,
            "w1",
            "w1",
            1.0,
            24.0,
            DEFAULT_WORD_PAD,
            DEFAULT_WORD_PAD,
        )
        .unwrap();
        assert_eq!(
            span,
            WordSpan {
                source_start: 0.0,
                source_end: 1.0
            }
        );
    }
}
