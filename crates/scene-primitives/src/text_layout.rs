//! Deterministic paragraph line breaking; font measurement is supplied by the host.
//! Ranges retain whitespace/newlines for stable part IDs, while `paint_end` omits
//! line-end spacing. No I/O or platform font selection belongs here.

use std::ops::Range;
use unicode_linebreak::{BreakOpportunity, linebreaks};
use unicode_segmentation::UnicodeSegmentation;

use crate::layout::TextMetricsLine;
use serde_json::{Map, Value};

#[derive(Debug, Clone)]
pub struct Run {
    pub bytes: Range<usize>,
    pub style: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FontStyle<'a> {
    pub family: &'a str,
    pub size: f64,
    pub weight: u16,
    pub italic: bool,
    pub spacing: f64,
}

/// Adjacent colour-only spans share shaping, preserving kerning and ligatures.
pub fn font_runs<'a>(
    base: FontStyle<'a>,
    runs: &'a [Run],
    range: Range<usize>,
) -> Vec<(Range<usize>, FontStyle<'a>)> {
    if runs.is_empty() {
        return vec![(range, base)];
    }
    let mut out: Vec<(Range<usize>, FontStyle<'a>)> = Vec::new();
    for run in runs {
        let a = range.start.max(run.bytes.start);
        let b = range.end.min(run.bytes.end);
        if b <= a {
            continue;
        }
        let style = FontStyle {
            family: run
                .style
                .get("font")
                .and_then(Value::as_str)
                .unwrap_or(base.family),
            size: run
                .style
                .get("fontSize")
                .and_then(Value::as_f64)
                .unwrap_or(base.size),
            weight: run
                .style
                .get("fontWeight")
                .and_then(Value::as_f64)
                .map_or(base.weight, |n| n.round() as u16),
            italic: run
                .style
                .get("fontStyle")
                .and_then(Value::as_str)
                .map_or(base.italic, |s| s == "italic"),
            spacing: run
                .style
                .get("letterSpacing")
                .and_then(Value::as_f64)
                .unwrap_or(base.spacing),
        };
        if let Some((previous, attrs)) = out.last_mut() {
            if previous.end == a && *attrs == style {
                previous.end = b;
                continue;
            }
        }
        out.push((a..b, style));
    }
    out
}

pub fn parse_runs(value: &Value) -> anyhow::Result<(String, Vec<Run>)> {
    use anyhow::{anyhow, bail};
    let rows = value
        .as_array()
        .ok_or_else(|| anyhow!("schema: text.runs 必须是数组"))?;
    let mut text = String::new();
    let mut runs = Vec::new();
    for row in rows {
        let row = row
            .as_object()
            .ok_or_else(|| anyhow!("schema: text.runs 项必须是对象"))?;
        if row.keys().any(|k| k != "text" && k != "style") {
            bail!("schema: text.runs 只接受 text/style");
        }
        let content = row
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("schema: run.text 必须是字符串"))?;
        let style = match row.get("style").filter(|v| !v.is_null()) {
            Some(value) => value
                .as_object()
                .cloned()
                .ok_or_else(|| anyhow!("schema: run.style 必须是对象"))?,
            None => Map::new(),
        };
        for (key, value) in &style {
            if ![
                "font",
                "fontSize",
                "fontWeight",
                "fontStyle",
                "letterSpacing",
                "color",
            ]
            .contains(&key.as_str())
            {
                bail!("schema: run.style 不支持 {key}");
            }
            if value.is_null() {
                continue;
            }
            let valid = match key.as_str() {
                "font" => value.is_string(),
                "fontSize" => value.as_f64().is_some_and(|n| n.is_finite() && n > 0.0),
                "fontWeight" => value
                    .as_f64()
                    .is_some_and(|n| n.is_finite() && (1.0..=1000.0).contains(&n)),
                "fontStyle" => matches!(value.as_str(), Some("normal" | "italic")),
                "letterSpacing" => value.as_f64().is_some_and(f64::is_finite),
                "color" => crate::color::Rgba::parse_value(Some(value)).is_some(),
                _ => false,
            };
            if !valid {
                bail!("schema: run.style.{key} 的值无效");
            }
        }
        let start = text.len();
        text.push_str(content);
        runs.push(Run {
            bytes: start..text.len(),
            style,
        });
    }
    let boundaries: Vec<_> = std::iter::once(0)
        .chain(text.grapheme_indices(true).map(|(i, g)| i + g.len()))
        .collect();
    if runs.iter().any(|run| {
        boundaries.binary_search(&run.bytes.start).is_err()
            || boundaries.binary_search(&run.bytes.end).is_err()
    }) {
        bail!("schema: runs 边界不能拆开 grapheme（组合字符或 emoji）");
    }
    Ok((text, runs))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wrap {
    None,
    Word,
    Grapheme,
}

#[derive(Debug, Clone)]
pub struct TextLine {
    pub bytes: Range<usize>,
    pub paint_end: usize,
    pub metrics: TextMetricsLine,
    pub offset: f64,
    pub line_height: f64,
}

#[derive(Debug, Clone, Default)]
pub struct TextBlock {
    pub lines: Vec<TextLine>,
    pub width: f64,
    pub height: f64,
    pub line_height: f64,
}

fn paint_end(text: &str, range: &Range<usize>) -> usize {
    range.start
        + text[range.clone()]
            .trim_end_matches(|c| {
                matches!(
                    c,
                    ' ' | '\t'
                        | '\r'
                        | '\n'
                        | '\u{b}'
                        | '\u{c}'
                        | '\u{85}'
                        | '\u{2028}'
                        | '\u{2029}'
                )
            })
            .len()
}

/// `line_height` is the baseline distance in authored pixels. `width` is only a
/// wrapping constraint: the caller decides whether the node's box uses it or
/// the measured maximum. Overlong words wrap at grapheme boundaries; a single
/// oversized grapheme is retained intact rather than silently clipped.
pub fn layout(
    text: &str,
    wrap: Wrap,
    width: Option<f64>,
    line_height: f64,
    mut measure: impl FnMut(Range<usize>) -> TextMetricsLine,
) -> TextBlock {
    let max_width = width
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(f64::INFINITY);
    let graphemes: Vec<usize> = text
        .grapheme_indices(true)
        .map(|(i, g)| i + g.len())
        .collect();
    let breaks: Vec<_> = linebreaks(text)
        .filter(|(at, _)| graphemes.binary_search(at).is_ok())
        .collect();
    let mut lines = Vec::new();
    let mut start = 0;
    let mut push = |range: Range<usize>,
                    measure: &mut dyn FnMut(Range<usize>) -> TextMetricsLine| {
        let end = paint_end(text, &range);
        let metrics = measure(range.start..end);
        lines.push(TextLine {
            bytes: range,
            paint_end: end,
            metrics,
            offset: 0.0,
            line_height,
        });
    };
    for &(paragraph_end, kind) in &breaks {
        if kind != BreakOpportunity::Mandatory {
            continue;
        }
        while start < paragraph_end {
            let full = start..paragraph_end;
            if wrap == Wrap::None || !max_width.is_finite() {
                push(full, &mut measure);
                start = paragraph_end;
                continue;
            }
            let first = graphemes.partition_point(|p| *p <= start);
            let count = graphemes.partition_point(|p| *p <= paragraph_end) - first;
            let fits = |n: usize, measure: &mut dyn FnMut(Range<usize>) -> TextMetricsLine| {
                let range = start..graphemes[first + n - 1];
                measure(start..paint_end(text, &range)).width <= max_width
            };
            // Exponential bracketing avoids shaping the entire remaining
            // paragraph for every line of a long, unbroken word.
            let mut lo = 0;
            let mut hi = 1;
            while fits(hi, &mut measure) {
                lo = hi;
                if hi == count {
                    break;
                }
                hi = (hi * 2).min(count);
            }
            while hi.saturating_sub(lo) > 1 {
                let middle = (lo + hi) / 2;
                if fits(middle, &mut measure) {
                    lo = middle;
                } else {
                    hi = middle;
                }
            }
            let mut end = graphemes[first + lo.max(1) - 1];
            if wrap == Wrap::Word && lo > 0 {
                let right = breaks.partition_point(|(p, _)| *p <= end);
                for &(candidate, _) in breaks[..right].iter().rev() {
                    if candidate <= start {
                        break;
                    }
                    let range = start..candidate;
                    let visible = paint_end(text, &range);
                    if visible > start && measure(start..visible).width <= max_width {
                        end = candidate;
                        break;
                    }
                }
            }
            push(start..end, &mut measure);
            start = end;
        }
    }
    if text.is_empty()
        || text.ends_with([
            '\n', '\r', '\u{b}', '\u{c}', '\u{85}', '\u{2028}', '\u{2029}',
        ])
    {
        push(text.len()..text.len(), &mut measure);
    }
    let width = lines
        .iter()
        .map(|line| line.metrics.width)
        .fold(0.0, f64::max);
    let mut height = 0.0;
    for line in &mut lines {
        line.offset = height;
        height += line.line_height;
    }
    TextBlock {
        lines,
        width,
        height,
        line_height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn block(text: &str, wrap: Wrap, width: f64) -> TextBlock {
        layout(text, wrap, Some(width), 12.0, |range| TextMetricsLine {
            width: text[range].graphemes(true).count() as f64 * 10.0,
            ascent: 8.0,
            descent: 2.0,
        })
    }
    #[test]
    fn word_wrap_keeps_source_ranges_and_empty_lines() {
        let text = "Hello world\r\n\nNext";
        let b = block(text, Wrap::Word, 60.0);
        let contents: Vec<_> = b
            .lines
            .iter()
            .map(|line| &text[line.bytes.start..line.paint_end])
            .collect();
        assert_eq!(contents, ["Hello", "world", "", "Next"]);
        assert_eq!(b.lines[0].bytes, 0..6);
        assert_eq!(b.lines[1].bytes, 6..13);
        assert_eq!(b.height, 48.0);
    }
    #[test]
    fn overlong_words_never_split_emoji_or_combining_sequences() {
        let text = "A👩🏽‍💻e\u{301}B";
        let b = block(text, Wrap::Word, 10.0);
        let cells: Vec<_> = b
            .lines
            .iter()
            .map(|line| &text[line.bytes.clone()])
            .collect();
        assert_eq!(cells, ["A", "👩🏽‍💻", "e\u{301}", "B"]);
    }
    #[test]
    fn no_wrap_honours_hard_breaks_and_trailing_empty_line() {
        let b = block("long line\n", Wrap::None, 10.0);
        assert_eq!(b.lines.len(), 2);
        assert_eq!(b.width, 90.0);
        assert_eq!(b.lines[1].bytes, 10..10);
    }

    #[test]
    fn long_words_measure_bounded_line_prefixes() {
        let text = "x".repeat(10_000);
        let mut measured = 0;
        let block = layout(&text, Wrap::Word, Some(100.0), 12.0, |range| {
            measured += range.len();
            TextMetricsLine {
                width: range.len() as f64 * 10.0,
                ascent: 8.0,
                descent: 2.0,
            }
        });
        assert_eq!(block.lines.len(), 1000);
        assert!(measured < text.len() * 30, "measured {measured} bytes");
    }
}
