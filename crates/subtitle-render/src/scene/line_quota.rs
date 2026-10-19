//! `caption-line-unit-quota/1`: width-wrapped lines also end before a word quota is passed.
//!
//! A line takes at most `pagination.maxUnitsPerLine` words and still ends early before a
//! word that would pass the wrap width; pages keep taking `maxLines` lines. The quota is
//! applied through the line measure, so frozen pages, per-sample layout and unit font
//! reflow all fold the same lines.
use super::*;

/// Word start offsets relative to `content[origin..end]`, ascending.
pub(super) fn word_starts(words: &[Word], origin: usize, end: usize) -> Vec<usize> {
    words
        .iter()
        .map(|w| w.bytes.start)
        .filter(|s| (origin..end).contains(s))
        .map(|s| s - origin)
        .collect()
}

/// Wraps a line measure so a range holding more than `quota` word starts never fits.
/// The number of word starts grows with the range end, so the fit test of `layout` stays
/// monotone. A line that begins inside a broken overlong word does not count that word
/// again, and a single grapheme always fits the quota, so the grapheme fallback is unchanged.
pub(super) fn capped<'a>(
    quota: Option<usize>,
    starts: Vec<usize>,
    mut measure: impl FnMut(Range<usize>) -> TextMetricsLine + 'a,
) -> impl FnMut(Range<usize>) -> TextMetricsLine + 'a {
    move |r: Range<usize>| {
        if let Some(quota) = quota {
            let first = starts.partition_point(|s| *s < r.start);
            let past = starts.partition_point(|s| *s < r.end);
            if past - first > quota {
                return TextMetricsLine {
                    width: f64::INFINITY,
                    ..TextMetricsLine::default()
                };
            }
        }
        measure(r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{Budget, Presentation, SceneCue, ScenePlan, SceneWord, cue_parameters};
    use serde_json::json;

    const TEXT: &str = "Alpha beta gamma delta epsilon zeta";

    fn plan(width: f64, quota: Option<usize>) -> ScenePlan {
        let mut body: serde_json::Value = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/line-unit-quota.json"
        ))
        .unwrap();
        let layout = &mut body["scene"]["value"]["layout"];
        layout["width"] = json!({"value": width, "basis": "absolute"});
        match quota {
            Some(n) => layout["pagination"]["maxUnitsPerLine"] = json!(n),
            None => {
                layout["pagination"]
                    .as_object_mut()
                    .unwrap()
                    .remove("maxUnitsPerLine");
            }
        }
        let mut start = 0.0;
        let words = TEXT
            .split(' ')
            .enumerate()
            .map(|(i, text)| {
                start += 0.5;
                SceneWord {
                    id: format!("w{i}"),
                    text: text.into(),
                    start: start - 0.5,
                    end: start,
                }
            })
            .collect();
        let cue = SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: TEXT.into(),
            start: 0.0,
            end: 3.0,
            words,
        };
        ScenePlan::compile(
            caption_scene::parse_style(&body).unwrap(),
            Presentation::default(),
            vec![cue],
            (320, 180),
            render_raster::TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "line-quota".into(),
        )
        .unwrap()
    }

    fn rows(layout: &TextLayout) -> Vec<Vec<String>> {
        layout
            .pages
            .iter()
            .map(|page| page_rows(layout, page))
            .collect()
    }

    fn page_rows(layout: &TextLayout, page: &Page) -> Vec<String> {
        page.lines
            .iter()
            .map(|line| layout.content[line.bytes.clone()].to_string())
            .collect()
    }

    #[test]
    fn lines_end_at_the_quota_and_pages_keep_their_line_count() {
        let quoted = plan(1000.0, Some(2));
        let layout = quoted.layouts.values().next().unwrap();
        assert_eq!(
            rows(layout),
            [vec!["Alpha beta", "gamma delta"], vec!["epsilon zeta"]]
        );
        assert_eq!(layout.pages[0].words, [0, 1, 2, 3]);
        assert_eq!(layout.pages[1].words, [4, 5]);
        // Without the quota the same width keeps one line.
        let wide = plan(1000.0, None);
        assert_eq!(rows(wide.layouts.values().next().unwrap()), [vec![TEXT]]);
    }

    #[test]
    fn the_width_still_ends_lines_before_the_quota() {
        // About two short words fit; a quota of three never adds a word to a full line.
        let narrow = plan(90.0, Some(3));
        let unquoted = plan(90.0, None);
        let narrow_rows = rows(narrow.layouts.values().next().unwrap());
        assert_eq!(narrow_rows, rows(unquoted.layouts.values().next().unwrap()));
        assert!(
            narrow_rows
                .iter()
                .flatten()
                .any(|row| row.split(' ').count() < 3)
        );
    }

    #[test]
    fn per_sample_layout_folds_the_same_lines() {
        let mut quoted = plan(1000.0, Some(2));
        let cue = quoted.cues[0].clone();
        let params = cue_parameters(
            &quoted.style,
            &quoted.presentation,
            &cue,
            &quoted.instance_id,
        )
        .unwrap();
        let scene = quoted.style.scene().clone();
        let layout = quoted.layouts.values().next().unwrap().clone();
        for page in &layout.pages {
            let again = sampled_layout::reflow(
                &mut quoted.text,
                &layout,
                page,
                &scene.nodes[0],
                &scene.layout,
                (320, 180),
                &params,
                &mut Budget::default(),
            )
            .unwrap();
            assert_eq!(page_rows(&layout, &again), page_rows(&layout, page));
        }
    }

    #[test]
    fn ranges_past_the_quota_never_fit() {
        let mut measure = capped(Some(2), vec![0, 6, 11], |r: Range<usize>| TextMetricsLine {
            width: r.len() as f64,
            ..TextMetricsLine::default()
        });
        assert_eq!(measure(0..10).width, 10.0);
        assert!(measure(0..12).width.is_infinite());
        // A line that starts inside the first word counts only the words it starts.
        assert_eq!(measure(3..12).width, 9.0);
        let mut open = capped(None, vec![0, 6, 11], |r: Range<usize>| TextMetricsLine {
            width: r.len() as f64,
            ..TextMetricsLine::default()
        });
        assert_eq!(open(0..12).width, 12.0);
    }
}
