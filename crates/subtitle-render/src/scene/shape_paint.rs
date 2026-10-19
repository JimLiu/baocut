//! `caption-shape-paint/1`: a shape filled with a solid or linear paint.
//!
//! The paint frame is the drawn rect (after the width/height poses, before the node transform), so a
//! linear paint stretches and moves with the shape. Node opacity is the caller's pushed layer.
use super::*;

pub(super) fn draw(
    paint: &ScenePaint,
    rect: Bounds,
    radius: f64,
    t: Transform,
    b: &mut FrameBuilder,
) -> Result<()> {
    // A zero-size shape draws nothing, as a solid fill does.
    let Some(path) =
        render_raster::raster::rounded_rect_path(rect.x, rect.y, rect.width, rect.height, radius)
    else {
        return Ok(());
    };
    let paint = b.paint_id(scene_paint(paint, rect, (0.0, 0.0), 1.0)?);
    let path = b.path_id(path_from_skia(&path));
    b.push(DrawOp::FillPathPaint {
        path,
        paint,
        even_odd: false,
        tf: tf(t),
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::scene::{Presentation, SceneCue, ScenePlan, SceneWord};
    use serde_json::{Value, json};

    fn plan(edit: impl Fn(&mut Value)) -> ScenePlan {
        let mut body: Value = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/shape-paint.json"
        ))
        .unwrap();
        edit(&mut body["scene"]["value"]);
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
            "shape-paint".into(),
        )
        .unwrap()
    }

    /// Tinted box pixels (grey text edges excluded): (x, r, g, b, a) in associated RGBA.
    fn box_pixels(plan: &mut ScenePlan, seconds: f64) -> Vec<(usize, u8, u8, u8, u8)> {
        let frame = plan.render(seconds).unwrap();
        let width = plan.width as usize;
        frame
            .rgba
            .chunks_exact(4)
            .enumerate()
            .filter(|(_, p)| p[1].max(p[2]) > p[0].saturating_add(40))
            .map(|(i, p)| (i % width, p[0], p[1], p[2], p[3]))
            .collect()
    }

    #[test]
    fn the_linear_paint_runs_across_the_drawn_box() {
        let pixels = box_pixels(&mut plan(|_| {}), 0.25);
        let mean = |side: &dyn Fn(&(usize, u8, u8, u8, u8)) -> bool| {
            let xs = pixels.iter().filter(|p| side(p)).map(|p| p.0 as f64).collect::<Vec<_>>();
            assert!(!xs.is_empty());
            xs.iter().sum::<f64>() / xs.len() as f64
        };
        let blue = mean(&|p| p.3 > p.2);
        let green = mean(&|p| p.2 > p.3);
        assert!(blue < green, "blue {blue} should sit left of green {green}");
        let (left, right) = pixels.iter().fold((usize::MAX, 0), |(l, r), p| (l.min(p.0), r.max(p.0)));
        assert!(right - left < 160, "the box covers one word, not the line");
        // The paint follows the box to the next word.
        let next = box_pixels(&mut plan(|_| {}), 0.75);
        let next_left = next.iter().map(|p| p.0).min().unwrap();
        assert!(next_left > left);
    }

    #[test]
    fn node_opacity_applies_once_and_empty_boxes_draw_nothing() {
        let half = box_pixels(
            &mut plan(|s| {
                s["nodes"][1]["children"][0]["properties"]["opacity"] = json!({"kind":"constant","value":0.5})
            }),
            0.25,
        );
        let mut alpha = half.iter().map(|p| p.4).collect::<Vec<_>>();
        alpha.sort();
        let median = alpha[alpha.len() / 2];
        assert!((120..=136).contains(&median), "alpha {median}");
        let mut empty = plan(|s| {
            s["nodes"][1]["children"][0]["properties"]["width"] = json!({"kind":"constant","value":0})
        });
        assert!(box_pixels(&mut empty, 0.25).is_empty());
    }

    #[test]
    fn a_solid_paint_matches_the_plain_fill() {
        let mut painted = plan(|s| {
            s["nodes"][1]["children"][0]["fillPaint"] = json!({"kind":"solid","color":"#1876F6"})
        });
        let mut plain = plan(|s| {
            let shape = &mut s["nodes"][1]["children"][0];
            shape.as_object_mut().unwrap().remove("fillPaint");
            shape["properties"]["fill"] = json!({"kind":"constant","value":"#1876F6"});
        });
        let a = painted.render(0.25).unwrap();
        let b = plain.render(0.25).unwrap();
        assert_eq!(a.rgba, b.rgba);
    }
}
