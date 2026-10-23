//! `caption-active-word-context/1`: the current page's active word, readable by every unit.
//!
//! The active word is the one `active_word` selects for the speech states, so the
//! window follows the same gap/tail hold policies. Selection only changes at word
//! starts/ends, so the contiguous active interval containing the sample time is
//! found by testing those boundaries; it is capped at the page display end.
use super::{Page, Word, active_word};
use caption_scene::{Evaluated, Scene, SpeechState, ValueType};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Clock {
    pub index_in_page: usize,
    pub start: f64,
    pub end: f64,
}

pub(super) fn enabled(scene: &Scene) -> bool {
    scene
        .required_capabilities
        .iter()
        .any(|c| c == "caption-active-word-context/1")
}

pub(super) fn clock(words: &[Word], page: &Page, t: f64, cfg: &SpeechState) -> Option<Clock> {
    let word = active_word(words, &page.words, t, cfg)?;
    let index_in_page = page.words.iter().position(|i| *i == word)?;
    let mut events = page
        .words
        .iter()
        .filter_map(|i| words[*i].span)
        .flat_map(|(start, end)| [start, end])
        .chain([page.start, page.end])
        .filter(|v| v.is_finite())
        .collect::<Vec<_>>();
    events.sort_by(f64::total_cmp);
    events.dedup();
    let active_at = |v: f64| active_word(words, &page.words, v, cfg) == Some(word);
    // Selection is constant on [events[k], events[k + 1]); `t` lies in interval `k`.
    let mut first = events.partition_point(|v| *v <= t).checked_sub(1)?;
    while first > 0 && active_at(events[first - 1]) {
        first -= 1;
    }
    let mut last = events.partition_point(|v| *v <= t) - 1;
    while last + 1 < events.len() && active_at(events[last + 1]) {
        last += 1;
    }
    let start = events[first];
    let end = events
        .get(last + 1)
        .copied()
        .unwrap_or(f64::INFINITY)
        .min(page.end)
        .max(start);
    Some(Clock {
        index_in_page,
        start,
        end,
    })
}

pub(super) fn add_fields(
    fields: &mut BTreeMap<String, Evaluated>,
    clock: Option<Clock>,
    seconds: f64,
) {
    fields.insert(
        "unit.activeWordAvailable".into(),
        Evaluated::Bool(clock.is_some()),
    );
    for (path, ty, value) in [
        (
            "unit.activeWordIndexInPage",
            ValueType::Scalar,
            clock.map_or(0.0, |c| c.index_in_page as f64),
        ),
        (
            "time.activeWordElapsedSeconds",
            ValueType::Time,
            clock.map_or(0.0, |c| seconds - c.start),
        ),
        (
            "time.activeWordDurationSeconds",
            ValueType::Time,
            clock.map_or(0.0, |c| c.end - c.start),
        ),
    ] {
        fields.insert(path.into(), Evaluated::Number(ty, value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{
        Bounds, Presentation, RenderContext, SceneCue, ScenePlan, SceneWord, UnitKind, context,
        cue_parameters, units_for,
    };
    use caption_scene::{GapPolicy, TailPolicy, TimingPolicy};

    fn words(spans: &[(f64, f64)]) -> Vec<Word> {
        spans
            .iter()
            .enumerate()
            .map(|(i, span)| Word {
                id: format!("w{i}"),
                bytes: i * 2..i * 2 + 1,
                span: Some(*span),
                input_timed: true,
                run_start: false,
            })
            .collect()
    }
    fn page(count: usize, end: f64) -> Page {
        Page {
            source_range: 0..count * 2,
            paint_start: 0,
            lines: vec![],
            words: (0..count).collect(),
            start: 0.0,
            end,
            bounds: Bounds::default(),
        }
    }
    fn cfg(gap: GapPolicy, tail: TailPolicy) -> SpeechState {
        SpeechState {
            gap_policy: gap,
            tail_policy: tail,
            timing_policy: TimingPolicy::default(),
        }
    }
    fn window(c: Option<Clock>) -> Option<(usize, f64, f64)> {
        c.map(|c| (c.index_in_page, c.start, c.end))
    }

    #[test]
    fn gaps_follow_the_hold_policy() {
        let w = words(&[(0.0, 0.5), (1.0, 1.5), (2.0, 2.5)]);
        let p = page(3, 4.0);
        let none = cfg(GapPolicy::None, TailPolicy::None);
        assert_eq!(window(clock(&w, &p, 0.2, &none)), Some((0, 0.0, 0.5)));
        assert_eq!(clock(&w, &p, 0.7, &none), None);
        let hold = cfg(GapPolicy::HoldPrevious, TailPolicy::None);
        assert_eq!(window(clock(&w, &p, 0.2, &hold)), Some((0, 0.0, 1.0)));
        assert_eq!(window(clock(&w, &p, 0.7, &hold)), Some((0, 0.0, 1.0)));
        assert_eq!(window(clock(&w, &p, 1.2, &hold)), Some((1, 1.0, 2.0)));
        // Without a tail hold the last word ends with its own span.
        assert_eq!(window(clock(&w, &p, 2.2, &hold)), Some((2, 2.0, 2.5)));
        assert_eq!(clock(&w, &p, 3.0, &hold), None);
    }

    #[test]
    fn tail_hold_runs_to_the_page_end() {
        let w = words(&[(0.0, 0.5), (1.0, 1.5)]);
        let p = page(2, 3.0);
        let tail = cfg(GapPolicy::HoldPrevious, TailPolicy::HoldLast);
        assert_eq!(window(clock(&w, &p, 1.2, &tail)), Some((1, 1.0, 3.0)));
        assert_eq!(window(clock(&w, &p, 2.5, &tail)), Some((1, 1.0, 3.0)));
    }

    #[test]
    fn an_overlapped_word_resumes_with_a_new_window() {
        // The later start wins while both are spoken; the earlier word resumes afterwards.
        let w = words(&[(0.0, 3.0), (1.0, 2.0)]);
        let p = page(2, 3.0);
        let none = cfg(GapPolicy::None, TailPolicy::None);
        assert_eq!(window(clock(&w, &p, 0.5, &none)), Some((0, 0.0, 1.0)));
        assert_eq!(window(clock(&w, &p, 1.5, &none)), Some((1, 1.0, 2.0)));
        assert_eq!(window(clock(&w, &p, 2.5, &none)), Some((0, 2.0, 3.0)));
    }

    #[test]
    fn zero_length_words_are_never_active_and_fields_default_to_zero() {
        let w = words(&[(1.0, 1.0)]);
        let p = page(1, 2.0);
        let hold = cfg(GapPolicy::HoldPrevious, TailPolicy::HoldLast);
        assert_eq!(clock(&w, &p, 1.0, &hold), None);
        let mut fields = BTreeMap::new();
        add_fields(&mut fields, None, 1.0);
        assert!(matches!(
            fields["unit.activeWordAvailable"],
            Evaluated::Bool(false)
        ));
        assert!(
            matches!(fields["time.activeWordDurationSeconds"], Evaluated::Number(ValueType::Time, v) if v == 0.0)
        );
        add_fields(
            &mut fields,
            Some(Clock {
                index_in_page: 2,
                start: 1.0,
                end: 1.5,
            }),
            1.2,
        );
        assert!(
            matches!(fields["unit.activeWordIndexInPage"], Evaluated::Number(ValueType::Scalar, v) if v == 2.0)
        );
        assert!(
            matches!(fields["time.activeWordElapsedSeconds"], Evaluated::Number(ValueType::Time, v) if (v - 0.2).abs() < 1e-12)
        );
    }

    #[test]
    fn every_unit_reads_the_page_window_and_the_page_swells_with_it() {
        let body: serde_json::Value = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/active-word-context.json"
        ))
        .unwrap();
        let spoken = [
            ("a", "Alpha", 0.0, 0.5),
            ("b", "beta", 1.0, 1.5),
            ("c", "gamma", 2.0, 2.5),
        ];
        let cue = SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Alpha beta gamma".into(),
            start: 0.0,
            end: 4.0,
            words: spoken
                .iter()
                .map(|(id, text, start, end)| SceneWord {
                    id: (*id).into(),
                    text: (*text).into(),
                    start: *start,
                    end: *end,
                })
                .collect(),
        };
        let mut plan = ScenePlan::compile(
            caption_scene::parse_style(&body).unwrap(),
            Presentation::default(),
            vec![cue],
            (320, 180),
            render_raster::TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "active-word".into(),
        )
        .unwrap();
        let cue = &plan.cues[0];
        let scene = plan.style.scene();
        let params =
            cue_parameters(&plan.style, &plan.presentation, cue, &plan.instance_id).unwrap();
        let layout = plan.layouts.values().next().unwrap();
        assert_eq!(layout.pages.len(), 1);
        let read = |t: f64| {
            let units = units_for(
                cue,
                layout,
                &layout.pages[0],
                t,
                &scene.speech_state,
                &Presentation::default(),
            );
            let r = RenderContext {
                scene,
                units: &BTreeMap::new(),
                params: &params,
                seconds: t,
                seed: 0,
                instance: "active-word",
                cue,
                size: (320, 180),
                images: &BTreeMap::new(),
            };
            units
                .iter()
                .filter(|(u, _)| matches!(u.kind, UnitKind::Page | UnitKind::Word))
                .map(|(u, _)| {
                    let c = context(u, &r);
                    let number = |path: &str| match c.fields[path] {
                        Evaluated::Number(_, v) => (v * 1000.0).round() / 1000.0,
                        _ => panic!("{path}"),
                    };
                    (
                        matches!(c.fields["unit.activeWordAvailable"], Evaluated::Bool(true)),
                        number("unit.activeWordIndexInPage"),
                        number("time.activeWordElapsedSeconds"),
                        number("time.activeWordDurationSeconds"),
                    )
                })
                .collect::<Vec<_>>()
        };
        // Page and word units share one value; the gap holds the previous word.
        for (t, expected) in [
            (0.05, (true, 0.0, 0.05, 1.0)),
            (0.7, (true, 0.0, 0.7, 1.0)),
            (1.25, (true, 1.0, 0.25, 1.0)),
            (2.2, (true, 2.0, 0.2, 0.5)),
            (3.0, (false, 0.0, 0.0, 0.0)),
        ] {
            let values = read(t);
            assert_eq!(values.len(), 4, "{t}");
            assert!(values.iter().all(|v| *v == expected), "{t}: {values:?}");
        }
        let swelling = plan.render(1.05).unwrap().fingerprint;
        let settled = plan.render(1.3).unwrap().fingerprint;
        let held = plan.render(1.7).unwrap().fingerprint;
        assert_ne!(swelling, settled);
        assert_eq!(settled, held);
    }
}
