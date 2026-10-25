//! `caption-line-box-context/1`: the line box of the visual line a unit belongs to.
//!
//! Line units, their words, graphemes and whitespace (and the decorations bound to them)
//! read the advance/line-box rect of their own visual line on the current page, in the same
//! canvas coordinates as `layout.x/y/width/height`. Cue and page units read zero.
use super::Bounds;
use caption_scene::{Evaluated, Scene, ValueType};
use std::collections::BTreeMap;

pub(super) fn enabled(scene: &Scene) -> bool {
    scene
        .required_capabilities
        .iter()
        .any(|c| c == "caption-line-box-context/1")
}

pub(super) fn add_fields(fields: &mut BTreeMap<String, Evaluated>, line: Option<Bounds>) {
    let b = line.unwrap_or_default();
    for (path, value) in [
        ("layout.lineBoxX", b.x),
        ("layout.lineBoxY", b.y),
        ("layout.lineBoxWidth", b.width),
        ("layout.lineBoxHeight", b.height),
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
            "../../../caption-scene/tests/fixtures/line-box-context.json"
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
            end: 2.0,
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
            "line-box".into(),
        )
        .unwrap()
    }

    #[test]
    fn every_unit_of_a_line_reads_that_line_box() {
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
            instance: "line-box",
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
            (
                number("layout.lineBoxX"),
                number("layout.lineBoxY"),
                number("layout.lineBoxWidth"),
                number("layout.lineBoxHeight"),
            )
        };
        let mut lines = Vec::new();
        let mut members = 0;
        for (u, _) in &units {
            match u.kind {
                UnitKind::Cue | UnitKind::Page => assert_eq!(read(u), (0.0, 0.0, 0.0, 0.0)),
                UnitKind::Line => {
                    let line = &page.lines[u.line_position.unwrap()];
                    let b = line.bounds;
                    assert_eq!(read(u), (b.x, b.y, b.width, b.height));
                    lines.push(read(u));
                }
                UnitKind::Word | UnitKind::Grapheme => {
                    // Units follow their line unit in order, so the last line read is theirs.
                    assert_eq!(read(u), *lines.last().unwrap(), "{}", u.id);
                    let (x, _, width, _) = read(u);
                    assert!(u.bounds.x >= x - 1e-6 && u.bounds.x <= x + width + 1e-6);
                    members += 1;
                }
            }
        }
        assert_eq!(lines.len(), 2);
        assert_ne!(lines[0].1, lines[1].1, "wrapped lines have their own boxes");
        assert!(members > 0);
    }

    #[test]
    fn the_wipe_reveals_each_line_left_to_right() {
        let mut plan = plan();
        let hidden = plan.render(0.0).unwrap().fingerprint;
        let partial = plan.render(0.8).unwrap().fingerprint;
        let full = plan.render(1.99).unwrap().fingerprint;
        assert_ne!(hidden, partial);
        assert_ne!(partial, full);
    }

    #[test]
    fn missing_lines_read_zero() {
        let mut fields = BTreeMap::new();
        add_fields(&mut fields, None);
        assert!(
            matches!(fields["layout.lineBoxWidth"], Evaluated::Number(ValueType::Length, v) if v == 0.0)
        );
    }
}
