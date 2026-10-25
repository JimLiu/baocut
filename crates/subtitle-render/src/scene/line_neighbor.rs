//! `caption-line-neighbor-context/1`: the previous word on the same visual line.
//!
//! Word units (and the graphemes and decorations bound to them) read the layout rect of
//! the word before them in source order on the same visual line of the current page, in
//! the same advance/line-box canvas coordinates as `layout.x/y/width/height`. A word that
//! starts its line, and every other unit kind, reads false and zero.
use super::Bounds;
use caption_scene::{Evaluated, Scene, ValueType};
use std::collections::BTreeMap;

pub(super) fn enabled(scene: &Scene) -> bool {
    scene
        .required_capabilities
        .iter()
        .any(|c| c == "caption-line-neighbor-context/1")
}

pub(super) fn add_fields(fields: &mut BTreeMap<String, Evaluated>, previous: Option<Bounds>) {
    fields.insert(
        "unit.previousWordInLine".into(),
        Evaluated::Bool(previous.is_some()),
    );
    let b = previous.unwrap_or_default();
    for (path, value) in [
        ("layout.previousWordX", b.x),
        ("layout.previousWordY", b.y),
        ("layout.previousWordWidth", b.width),
        ("layout.previousWordHeight", b.height),
    ] {
        fields.insert(path.into(), Evaluated::Number(ValueType::Length, value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{
        Presentation, RenderContext, SceneCue, ScenePlan, SceneWord, UnitKind, context,
        cue_parameters, units_for,
    };

    fn plan() -> ScenePlan {
        let body: serde_json::Value = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/line-neighbor-context.json"
        ))
        .unwrap();
        let spoken = [
            ("a", "Alpha", 0.0, 0.5),
            ("b", "beta", 0.5, 1.0),
            ("c", "gamma", 1.0, 1.5),
            ("d", "delta", 1.5, 2.0),
        ];
        let cue = SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Alpha beta gamma delta".into(),
            start: 0.0,
            end: 2.5,
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
        ScenePlan::compile(
            caption_scene::parse_style(&body).unwrap(),
            Presentation::default(),
            vec![cue],
            (320, 180),
            render_raster::TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "line-neighbor".into(),
        )
        .unwrap()
    }

    #[test]
    fn words_read_the_previous_word_of_their_own_line() {
        let plan = plan();
        let cue = &plan.cues[0];
        let scene = plan.style.scene();
        let params =
            cue_parameters(&plan.style, &plan.presentation, cue, &plan.instance_id).unwrap();
        let layout = plan.layouts.values().next().unwrap();
        let page = &layout.pages[0];
        assert_eq!(page.lines.len(), 2, "fixture wraps into two lines");
        let units = units_for(
            cue,
            layout,
            page,
            0.7,
            &scene.speech_state,
            &Presentation::default(),
        );
        let r = RenderContext {
            paint_viewport: None,
            scene,
            units: &BTreeMap::new(),
            params: &params,
            seconds: 0.7,
            seed: 0,
            instance: "line-neighbor",
            cue,
            size: (320, 180),
            images: &BTreeMap::new(),
        };
        let read = |u: &crate::scene::Unit| {
            let c = context(u, &r);
            let number = |path: &str| match c.fields[path] {
                Evaluated::Number(ValueType::Length, v) => v,
                _ => panic!("{path}"),
            };
            let available = matches!(c.fields["unit.previousWordInLine"], Evaluated::Bool(true));
            (
                available,
                Bounds {
                    x: number("layout.previousWordX"),
                    y: number("layout.previousWordY"),
                    width: number("layout.previousWordWidth"),
                    height: number("layout.previousWordHeight"),
                },
            )
        };
        let mut previous: Option<(usize, Bounds)> = None;
        let mut words = 0;
        let mut followers = 0;
        for (u, _) in &units {
            match u.kind {
                UnitKind::Word => {
                    words += 1;
                    let line = u.line_position.unwrap();
                    let (available, bounds) = read(u);
                    match previous.filter(|(l, _)| *l == line) {
                        Some((_, expected)) => {
                            followers += 1;
                            assert!(available);
                            assert_eq!(
                                (bounds.x, bounds.y, bounds.width, bounds.height),
                                (expected.x, expected.y, expected.width, expected.height)
                            );
                        }
                        None => {
                            assert!(!available);
                            assert_eq!((bounds.x, bounds.width), (0.0, 0.0));
                        }
                    }
                    previous = Some((line, u.bounds));
                }
                UnitKind::Grapheme if !u.whitespace => {
                    // Graphemes read their word's neighbour.
                    let word = units
                        .iter()
                        .find(|(w, _)| {
                            w.kind == UnitKind::Word && w.id == u.id.split(':').next().unwrap()
                        })
                        .unwrap();
                    assert_eq!(read(u).0, read(&word.0).0);
                }
                _ => assert!(!read(u).0, "{:?}", u.kind),
            }
        }
        // Every word but the first of each line has a neighbour.
        assert!(followers >= 1);
        assert_eq!(followers, words - page.lines.len());
    }

    #[test]
    fn the_box_slides_from_the_previous_word_and_settles() {
        let mut plan = plan();
        // Second word of the first line: sliding, then settled on the word.
        let sliding = plan.render(0.52).unwrap().fingerprint;
        let settled = plan.render(0.7).unwrap().fingerprint;
        let held = plan.render(0.9).unwrap().fingerprint;
        assert_ne!(sliding, settled);
        assert_eq!(settled, held);
        // First word of the second line snaps: no slide frame differs from the settled one.
        assert_eq!(
            plan.render(1.02).unwrap().fingerprint,
            plan.render(1.3).unwrap().fingerprint
        );
    }

    #[test]
    fn missing_neighbours_read_zero() {
        let mut fields = BTreeMap::new();
        add_fields(&mut fields, None);
        assert!(matches!(
            fields["unit.previousWordInLine"],
            Evaluated::Bool(false)
        ));
        assert!(
            matches!(fields["layout.previousWordWidth"], Evaluated::Number(ValueType::Length, v) if v == 0.0)
        );
    }
}
