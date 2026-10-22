//! Independent pixel products from ordinary unmasked glyph renderings.
//! No source/vendor constants and no use of the masked implementation as oracle.
use caption_scene::{Presentation, parse_style};
use render_raster::{FrameMedia, FrameOps, TextEngine, drawop::DrawOp, rasterize_with_media};
use serde_json::{Value, json};
use std::sync::Arc;
use subtitle_render::scene::{SceneCue, ScenePlan};
use tiny_skia::Pixmap;

const W: u32 = 160;
const H: u32 = 96;

#[test]
fn nonzero_mask_spread_uses_its_own_px_or_em_extent_under_affine() {
    for em in [false, true] {
        let mut effect = body(red(), [6., -3.], 1., 1., false);
        let pose = json!({"transform.rotation":{"kind":"constant","value":17},
            "transform.scaleX":{"kind":"constant","value":1.15},
            "transform.scaleY":{"kind":"constant","value":0.85}});
        effect["scene"]["value"]["nodes"][0]["properties"] = pose.clone();
        if em {
            let layer = &mut effect["scene"]["value"]["nodes"][0]["style"]["paints"][0];
            layer["unit"] = json!("em");
            layer["offset"] = json!([0.15, -0.075]);
            layer["spread"] = json!(0.025);
            layer["blur"] = json!(0.025);
        }
        let mut origin = body(white(), [0., 0.], 3., 0., false);
        origin["scene"]["value"]["nodes"][0]["properties"] = pose;
        let expected = product(&pixels(effect.clone(), "O"), &pixels(origin, "O"));
        effect["scene"]["value"]["nodes"][0]["style"]["paints"][0]["mask"] =
            json!({"kind":"glyph-fill","spread":if em {0.075} else {3.0}});
        assert_pixels(&pixels(effect, "O"), &expected, 0);
    }
}

#[test]
fn actual_color_bitmap_glyph_is_rejected_instead_of_bypassing_mask() {
    let compile = |masked| {
        let mut style = body(red(), [0., 0.], 0., 0., masked);
        style["scene"]["value"]["nodes"][0]["style"]["fontFamily"] = json!("ColrProbe");
        ScenePlan::compile(
            parse_style(&style).unwrap(),
            Presentation::default(),
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: "A".into(),
                start: 0.,
                end: 2.,
                words: vec![],
            }],
            (W, H),
            TextEngine::with_document_fonts(&[include_bytes!(
                "../../render-raster/tests/fixtures/fonts/ColrProbe.ttf"
            )
            .to_vec()]),
            "bitmap-mask".into(),
        )
        .unwrap()
    };
    let (plain, _) = compile(false).record(0.3).unwrap();
    assert!(
        plain
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::DrawBitmap { .. })),
        "positive control must resolve a color bitmap"
    );
    let error = compile(true).record(0.3).unwrap_err().to_string();
    assert!(
        error.contains("glyph paint mask requires outline glyphs"),
        "{error}"
    );
}

#[test]
fn mask_work_is_rejected_before_any_large_raster_allocation() {
    let mut source = body(red(), [0., 0.], 0., 0., true);
    let first = source["scene"]["value"]["nodes"][0]["style"]["paints"][0].clone();
    source["scene"]["value"]["nodes"][0]["style"]["paints"] = Value::Array(
        (0..5)
            .map(|i| {
                let mut layer = first.clone();
                layer["id"] = json!(format!("mask{i}"));
                layer
            })
            .collect(),
    );
    let mut scene = plan(source, "O");
    scene.width = 4096;
    scene.height = 4096;
    let error = scene.record(0.3).unwrap_err().to_string();
    assert!(
        error.contains("CAPTION_BUDGET_EXCEEDED") && error.contains("paint mask work"),
        "{error}"
    );
}

fn body(paint: Value, offset: [f64; 2], spread: f64, blur: f64, masked: bool) -> Value {
    let mut layer =
        json!({"id":"probe","paint":paint,"unit":"px","offset":offset,"spread":spread,"blur":blur});
    if masked {
        layer["mask"] = json!({"kind":"glyph-fill","spread":0});
    }
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-paint-stack/1","caption-paint-effects/1",
            "caption-paint-mask/1","caption-gradient-space/1","caption-gradient-glyph/1"],
        "layout":{"x":{"value":80,"basis":"absolute"},"y":{"value":48,"basis":"absolute"},
            "width":{"value":150,"basis":"absolute"},"maxLines":1},
        "nodes":[{"id":"ink","type":"text","style":{"fontFamily":"Noto Sans SC",
            "fontSize":{"value":40,"basis":"absolute"},"fill":"#FFFFFF","paints":[layer]}}]
    }}})
}

fn white() -> Value {
    json!({"kind":"solid","color":"#FFFFFF"})
}
fn red() -> Value {
    json!({"kind":"solid","color":"#FF0000"})
}
fn plan(style: Value, text: &str) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&style).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: text.into(),
            start: 0.,
            end: 2.,
            words: vec![],
        }],
        (W, H),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "mask-oracle".into(),
    )
    .unwrap()
}
fn pixels(style: Value, text: &str) -> Vec<u8> {
    plan(style, text).render(0.3).unwrap().rgba.as_ref().clone()
}
fn product(effect: &[u8], origin: &[u8]) -> Vec<u8> {
    assert_eq!(effect.len(), origin.len());
    effect
        .chunks_exact(4)
        .zip(origin.chunks_exact(4))
        .flat_map(|(rgba, mask)| {
            rgba.iter()
                .map(move |value| ((u32::from(*value) * u32::from(mask[3]) + 127) / 255) as u8)
        })
        .collect()
}
fn assert_pixels(actual: &[u8], expected: &[u8], tolerance: u8) {
    assert_eq!(actual.len(), expected.len());
    for (index, (a, b)) in actual.iter().zip(expected).enumerate() {
        assert!(
            a.abs_diff(*b) <= tolerance,
            "pixel({},{}), channel{}: actual={a}, oracle={b}",
            (index / 4) % (W as usize),
            (index / 4) / (W as usize),
            index % 4
        );
    }
}
fn origin_like(effect: &Value) -> Value {
    let mut origin = effect.clone();
    origin["scene"]["value"]["nodes"][0]["style"]["paints"] =
        json!([{"id":"origin","paint":white(),"unit":"px"}]);
    origin
}

#[test]
fn single_glyph_multiplies_original_coverage_after_effect_blur() {
    for (spread, blur) in [(0., 0.), (1.5, 1.25)] {
        let unmasked = body(red(), [5.25, 1.5], spread, blur, false);
        let effect = pixels(unmasked.clone(), "O");
        let origin = pixels(origin_like(&unmasked), "O");
        assert!(
            origin.chunks_exact(4).any(|p| p[3] > 0 && p[3] < 255),
            "oracle needs fractional AA coverage"
        );
        let expected = product(&effect, &origin);
        assert!(
            expected.iter().any(|v| *v != 0),
            "intersection fixture must be nonempty"
        );
        let actual = pixels(body(red(), [5.25, 1.5], spread, blur, true), "O");
        assert_pixels(&actual, &expected, 0);
        for (p, m) in actual.chunks_exact(4).zip(origin.chunks_exact(4)) {
            if m[3] == 0 {
                assert_eq!(
                    p,
                    [0, 0, 0, 0],
                    "effect must remain inside original coverage"
                );
            }
        }
    }
}

#[test]
fn large_offset_is_empty_even_when_shifted_paint_remains_visible() {
    let effect = pixels(body(red(), [50., 0.], 0., 0., false), "O");
    assert!(
        effect.chunks_exact(4).any(|p| p[3] > 0),
        "offset must not merely leave the canvas"
    );
    let origin = pixels(body(white(), [0., 0.], 0., 0., false), "O");
    let expected = product(&effect, &origin);
    assert!(expected.iter().all(|v| *v == 0));
    assert_eq!(pixels(body(red(), [50., 0.], 0., 0., true), "O"), expected);
}

struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, _: &str, _: i64) -> anyhow::Result<Arc<Pixmap>> {
        anyhow::bail!("unexpected media")
    }
}
fn glyph_ops(frame: &FrameOps) -> Vec<DrawOp> {
    frame
        .ops
        .iter()
        .filter(|op| matches!(op, DrawOp::FillPathPaint { .. }))
        .cloned()
        .collect()
}
fn one_glyph(frame: &FrameOps, op: DrawOp) -> Vec<u8> {
    let subset = FrameOps {
        ops: vec![op],
        static_prefix: None,
        paths: frame.paths.clone(),
        strings: frame.strings.clone(),
        paints: frame.paints.clone(),
        bitmaps: frame.bitmaps.clone(),
    };
    rasterize_with_media(&subset, W, H, &mut NoMedia)
        .unwrap()
        .data()
        .to_vec()
}
fn over(destination: &mut [u8], source: &[u8]) {
    for (d, s) in destination.chunks_exact_mut(4).zip(source.chunks_exact(4)) {
        let inverse = 255 - u32::from(s[3]);
        for c in 0..4 {
            d[c] = (u32::from(s[c]) + (u32::from(d[c]) * inverse + 127) / 255).min(255) as u8;
        }
    }
}

#[test]
fn each_glyph_intersects_itself_before_neighbour_union() {
    let plain = body(white(), [0., 0.], 0., 0., false);
    let (origin_frame, _) = plan(plain.clone(), "OO").record(0.3).unwrap();
    let origins = glyph_ops(&origin_frame);
    assert_eq!(
        origins.len(),
        2,
        "fixture must expose two independent outline glyphs"
    );
    let x = |op: &DrawOp| match op {
        DrawOp::FillPathPaint { tf, .. } => tf[4],
        _ => unreachable!(),
    };
    let advance = f64::from(x(&origins[1]) - x(&origins[0]));
    assert!(advance > 0.);
    let shifted = body(white(), [advance, 0.], 0., 0., false);
    let (effect_frame, _) = plan(shifted.clone(), "OO").record(0.3).unwrap();
    let effects = glyph_ops(&effect_frame);
    assert_eq!(effects.len(), 2);
    let mut expected = vec![0; (W * H * 4) as usize];
    for (origin, effect) in origins.into_iter().zip(effects) {
        let clipped = product(
            &one_glyph(&effect_frame, effect),
            &one_glyph(&origin_frame, origin),
        );
        over(&mut expected, &clipped);
    }
    let wrong_union = product(&pixels(shifted, "OO"), &pixels(plain, "OO"));
    assert_ne!(
        wrong_union, expected,
        "fixture must catch shifted glyph A admitted by glyph B's original mask"
    );
    let actual = pixels(body(white(), [advance, 0.], 0., 0., true), "OO");
    assert_pixels(&actual, &expected, 0);
}

#[test]
fn opacity_is_applied_once_after_intersection() {
    let unmasked = body(red(), [4., 0.], 0., 0., false);
    let full = product(
        &pixels(unmasked.clone(), "O"),
        &pixels(origin_like(&unmasked), "O"),
    );
    assert!(
        full.chunks_exact(4).any(|p| p[3] == 255),
        "fixture needs full-coverage intersection pixels"
    );
    let mut masked = body(red(), [4., 0.], 0., 0., true);
    masked["scene"]["value"]["nodes"][0]["properties"] =
        json!({"opacity":{"kind":"constant","value":128./255.}});
    let half = pixels(masked, "O");
    let expected: Vec<_> = full
        .iter()
        .map(|v| ((u32::from(*v) * 128 + 127) / 255) as u8)
        .collect();
    // Existing group opacity stores f32 to UNORM8; the independent integer
    // product permits one rounding byte, never the extra factor from double alpha.
    assert_pixels(&half, &expected, 1);
    assert!(half.chunks_exact(4).any(|p| p[3] >= 127));
    assert!(half.chunks_exact(4).all(|p| p[3] <= 128));
}

#[test]
fn gradient_domain_and_original_mask_share_the_glyph_affine() {
    let paint = json!({"kind":"linear","space":"normalized","domain":"glyph","from":[0,0],"to":[1,1],
        "stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]});
    let mut effect = body(paint, [4.25, -2.5], 0., 0., false);
    effect["scene"]["value"]["nodes"][0]["properties"] = json!({
        "transform.rotation":{"kind":"constant","value":17},
        "transform.scaleX":{"kind":"constant","value":1.15},
        "transform.scaleY":{"kind":"constant","value":0.85}});
    let expected = product(
        &pixels(effect.clone(), "O"),
        &pixels(origin_like(&effect), "O"),
    );
    assert!(
        expected
            .chunks_exact(4)
            .any(|p| p[0] > 0 && p[2] > 0 && p[3] > 0),
        "gradient oracle must contain mixed colours"
    );
    let mut masked = effect;
    masked["scene"]["value"]["nodes"][0]["style"]["paints"][0]["mask"] =
        json!({"kind":"glyph-fill","spread":0});
    assert_pixels(&pixels(masked, "O"), &expected, 0);
}

#[test]
fn unused_mask_capability_preserves_unmasked_pixels_and_fingerprint() {
    let body = body(red(), [3., 1.], 1., 1.25, false);
    let advertised = plan(body.clone(), "OO").render(0.3).unwrap();
    let mut legacy = body;
    legacy["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|v| v != "caption-paint-mask/1");
    let unadvertised = plan(legacy, "OO").render(0.3).unwrap();
    assert_eq!(advertised.rgba, unadvertised.rgba);
    assert_eq!(advertised.fingerprint, unadvertised.fingerprint);
}

// Construct the existing alpha-matte IR from independently rendered *unmasked*
// paint and mask planes. No new mask-transform recorder produces expected pixels.
fn manual_transform_matte(effect: &[u8], mask: &[u8], inverted: bool) -> Vec<u8> {
    use render_raster::drawop::{BitmapData, MatteMode};
    let bitmap = |data: &[u8]| BitmapData {
        width: W,
        height: H,
        rgba: Arc::from(data.to_vec()),
    };
    let identity = [1., 0., 0., 1., 0., 0.];
    let frame = FrameOps {
        ops: vec![
            DrawOp::PushLayer {
                opacity: 1.,
                blend: motion::effect::BlendMode::Normal,
            },
            DrawOp::DrawBitmap {
                bitmap: 0,
                opacity: 1.,
                tf: identity,
            },
            DrawOp::PushMatte,
            DrawOp::DrawBitmap {
                bitmap: 1,
                opacity: 1.,
                tf: identity,
            },
            DrawOp::PopMatte {
                mode: if inverted {
                    MatteMode::AlphaInverted as u8
                } else {
                    MatteMode::Alpha as u8
                },
            },
            DrawOp::PopLayer,
        ],
        bitmaps: vec![bitmap(effect), bitmap(mask)],
        ..Default::default()
    };
    let rgba = rasterize_with_media(&frame, W, H, &mut NoMedia)
        .unwrap()
        .data()
        .to_vec();
    let integer: Vec<_> = effect
        .chunks_exact(4)
        .zip(mask.chunks_exact(4))
        .flat_map(|(p, m)| {
            let factor = if inverted {
                255 - u32::from(m[3])
            } else {
                u32::from(m[3])
            };
            p.iter()
                .map(move |v| ((u32::from(*v) * factor + 127) / 255) as u8)
        })
        .collect();
    assert_eq!(
        rgba, integer,
        "manual matte IR must itself obey the independent integer product"
    );
    rgba
}
fn transformed_mask(mut effect: Value, offset: [f64; 2], spread: f64, inverted: bool) -> Value {
    effect["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-mask-transform/1"));
    effect["scene"]["value"]["nodes"][0]["style"]["paints"][0]["mask"] =
        json!({"kind":"glyph-fill","offset":offset,"spread":spread,"inverted":inverted});
    effect
}

#[test]
fn equal_paint_and_inverted_mask_offsets_form_a_shifted_ring() {
    let offset = [6.25, -2.5];
    let effect = body(red(), offset, 3., 0., false);
    let paint = pixels(effect.clone(), "O");
    let mask = pixels(body(white(), offset, 0., 0., false), "O");
    let expected = manual_transform_matte(&paint, &mask, true);
    assert!(
        expected.chunks_exact(4).any(|p| p[3] > 0),
        "ring must be visible"
    );
    assert!(
        paint
            .chunks_exact(4)
            .zip(mask.chunks_exact(4))
            .any(|(p, m)| p[3] == 255 && m[3] == 255),
        "ring needs an opaque interior to remove"
    );
    for (p, m) in expected.chunks_exact(4).zip(mask.chunks_exact(4)) {
        if m[3] == 255 {
            assert_eq!(p, [0, 0, 0, 0], "inverted origin removes the ring interior");
        }
    }
    let wrong_unshifted = manual_transform_matte(
        &paint,
        &pixels(body(white(), [0., 0.], 0., 0., false), "O"),
        true,
    );
    assert_ne!(
        expected, wrong_unshifted,
        "fixture must detect silently ignored mask offset"
    );
    assert_pixels(
        &pixels(transformed_mask(effect, offset, 0., true), "O"),
        &expected,
        0,
    );
}

#[test]
fn independent_mask_offset_and_inversion_match_manual_ir_with_em_affine() {
    for em in [false, true] {
        let (paint_offset, mask_offset, paint_spread, mask_spread, blur) = if em {
            ([0.15, -0.075], [-0.05, 0.1], 0.025, 0.05, 0.025)
        } else {
            ([6., -3.], [-2., 4.], 1., 2., 1.)
        };
        let mut effect = body(red(), paint_offset, paint_spread, blur, false);
        let mut mask = body(white(), mask_offset, mask_spread, 0., false);
        let pose = json!({"transform.rotation":{"kind":"constant","value":17},
            "transform.scaleX":{"kind":"constant","value":1.15},
            "transform.scaleY":{"kind":"constant","value":0.85}});
        effect["scene"]["value"]["nodes"][0]["properties"] = pose.clone();
        mask["scene"]["value"]["nodes"][0]["properties"] = pose;
        if em {
            effect["scene"]["value"]["nodes"][0]["style"]["paints"][0]["unit"] = json!("em");
            mask["scene"]["value"]["nodes"][0]["style"]["paints"][0]["unit"] = json!("em");
        }
        let paint = pixels(effect.clone(), "O");
        let origin = pixels(mask, "O");
        for inverted in [false, true] {
            let expected = manual_transform_matte(&paint, &origin, inverted);
            assert!(
                expected.chunks_exact(4).any(|p| p[3] > 0),
                "fixture must exercise mode={inverted}, em={em}"
            );
            let actual = pixels(
                transformed_mask(effect.clone(), mask_offset, mask_spread, inverted),
                "O",
            );
            assert_pixels(&actual, &expected, 0);
        }
    }
}

fn locally(mut style: Value) -> Value {
    let scene = &mut style["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-mask-local/1"));
    for layer in scene["nodes"][0]["style"]["paints"].as_array_mut().unwrap() {
        if layer.get("mask").is_some() {
            layer["mask"]["rasterization"] = json!("glyph-bounds");
        }
    }
    style
}

#[test]
fn local_blurred_masks_preserve_canvas_pixels_with_gradient_and_affine() {
    for paint in [
        red(),
        json!({"kind":"linear","space":"normalized","domain":"glyph","from":[0,0],"to":[1,1],
        "stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]}),
    ] {
        for blur in [1.25] {
            for inverted in [false, true] {
                let mut style = transformed_mask(
                    body(paint.clone(), [5.25, -2.5], 1.25, blur, false),
                    [-2.25, 1.5],
                    1.5,
                    inverted,
                );
                style["scene"]["value"]["nodes"][0]["properties"] = json!({
                    "opacity":{"kind":"constant","value":0.7},
                    "transform.rotation":{"kind":"constant","value":17},
                    "transform.scaleX":{"kind":"constant","value":1.15},
                    "transform.scaleY":{"kind":"constant","value":0.85}});
                let expected = pixels(style.clone(), "Ogj");
                let actual = pixels(locally(style), "Ogj");
                assert_pixels(&actual, &expected, 1);
            }
        }
    }
}

#[test]
fn local_inversion_keeps_displaced_content_outside_mask_support() {
    let style = transformed_mask(body(red(), [34., 0.], 0., 0., false), [0., 0.], 0., true);
    let expected = pixels(style.clone(), "O");
    assert!(expected.chunks_exact(4).any(|p| p[3] > 0));
    assert_pixels(&pixels(locally(style), "O"), &expected, 0);
    let normal = transformed_mask(body(red(), [200., 0.], 0., 0., false), [0., 0.], 0., false);
    assert!(pixels(locally(normal), "O").iter().all(|v| *v == 0));
}

#[test]
fn local_multilayer_long_text_uses_small_bitmaps_without_live_matte_groups() {
    let mut style = body(red(), [0., 0.], 0., 0., true);
    style["scene"]["value"]["layout"]["x"]["value"] = json!(2048);
    style["scene"]["value"]["layout"]["y"]["value"] = json!(2048);
    style["scene"]["value"]["layout"]["width"]["value"] = json!(3000);
    let first = style["scene"]["value"]["nodes"][0]["style"]["paints"][0].clone();
    style["scene"]["value"]["nodes"][0]["style"]["paints"] = Value::Array(
        (0..8)
            .map(|i| {
                let mut next = first.clone();
                next["id"] = json!(format!("layer{i}"));
                next
            })
            .collect(),
    );
    let mut old = plan(style.clone(), "INTERSTELLAR");
    old.width = 4096;
    old.height = 4096;
    assert!(
        old.record(0.3)
            .unwrap_err()
            .to_string()
            .contains("paint mask work")
    );
    let mut local = plan(locally(style), "INTERSTELLAR");
    local.width = 4096;
    local.height = 4096;
    let (frame, _) = local.record(0.3).unwrap();
    assert!(
        frame
            .ops
            .iter()
            .filter(|op| matches!(op, DrawOp::DrawBitmap { .. }))
            .count()
            >= 80
    );
    assert!(
        !frame
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::PushMatte | DrawOp::PopMatte { .. }))
    );
    assert!(frame.bitmaps.iter().all(|b| b.width < 80 && b.height < 80));
    assert!(frame.bitmaps.iter().any(|b| b.rgba.iter().any(|v| *v > 0)));
    assert!(frame.bitmaps.iter().map(|b| b.rgba.len()).sum::<usize>() < 1024 * 1024);
}

#[test]
fn advertising_local_masks_does_not_change_legacy_ir_or_fingerprint() {
    let style = body(red(), [2., -1.], 1., 1., true);
    let mut advertised = style.clone();
    advertised["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-mask-local/1"));
    let a = plan(style, "OO").record(0.3).unwrap().0;
    let b = plan(advertised, "OO").record(0.3).unwrap().0;
    assert_eq!(
        render_raster::drawop::encode(&a),
        render_raster::drawop::encode(&b)
    );
}

/// Independent unmasked scene recordings are replayed in the specified device
/// viewport. Only transforms are rebased; no mask implementation is invoked.
fn cropped_unmasked(style: Value, window: [i32; 4]) -> Vec<u8> {
    let (mut frame, _) = plan(style, "O").record(0.3).unwrap();
    for op in &mut frame.ops {
        let matrix = match op {
            DrawOp::FillPath { tf, .. }
            | DrawOp::StrokePath { tf, .. }
            | DrawOp::FillPathPaint { tf, .. }
            | DrawOp::StrokePathPaint { tf, .. }
            | DrawOp::DrawBitmap { tf, .. } => tf,
            DrawOp::PushLayer { .. } | DrawOp::PopLayer | DrawOp::Clear { .. } => continue,
            _ => panic!("unmasked oracle must not contain matte operations"),
        };
        matrix[4] -= window[0] as f32;
        matrix[5] -= window[1] as f32;
    }
    rasterize_with_media(&frame, window[2] as u32, window[3] as u32, &mut NoMedia)
        .unwrap()
        .data()
        .to_vec()
}

#[test]
fn local_unblurred_masks_match_independent_viewport_coverage_products() {
    // Curved-path scan conversion is not translation-invariant in tiny-skia.
    // The local mode defines its own integer device viewport; its arithmetic
    // oracle uses independently recorded unmasked paint and coverage there.
    for paint in [
        red(),
        json!({"kind":"linear","space":"normalized","domain":"glyph","from":[0,0],"to":[1,1],
        "stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]}),
    ] {
        for em in [false, true] {
            let (paint_offset, mask_offset, spread) = if em {
                ([0.15, -0.075], [-0.05, 0.1], 0.075)
            } else {
                ([6., -3.], [-2., 4.], 3.)
            };
            let mut effect = body(
                paint.clone(),
                paint_offset,
                if em { 0.025 } else { 1. },
                0.,
                false,
            );
            let mut mask = body(white(), mask_offset, spread, 0., false);
            let pose = json!({"transform.rotation":{"kind":"constant","value":17},
                "transform.scaleX":{"kind":"constant","value":1.15},
                "transform.scaleY":{"kind":"constant","value":0.85}});
            for source in [&mut effect, &mut mask] {
                source["scene"]["value"]["nodes"][0]["properties"] = pose.clone();
                if em {
                    source["scene"]["value"]["nodes"][0]["style"]["paints"][0]["unit"] =
                        json!("em");
                }
            }
            for inverted in [false, true] {
                let masked = locally(transformed_mask(
                    effect.clone(),
                    mask_offset,
                    spread,
                    inverted,
                ));
                let (frame, _) = plan(masked, "O").record(0.3).unwrap();
                let (bitmap, tf) = frame
                    .ops
                    .iter()
                    .find_map(|op| match op {
                        DrawOp::DrawBitmap { bitmap, tf, .. } => {
                            Some((&frame.bitmaps[*bitmap as usize], tf))
                        }
                        _ => None,
                    })
                    .unwrap();
                let window = [
                    tf[4] as i32,
                    tf[5] as i32,
                    bitmap.width as i32,
                    bitmap.height as i32,
                ];
                let paint = cropped_unmasked(effect.clone(), window);
                let mask = cropped_unmasked(mask.clone(), window);
                let expected: Vec<_> = paint
                    .chunks_exact(4)
                    .zip(mask.chunks_exact(4))
                    .flat_map(|(p, m)| {
                        let factor = if inverted {
                            255 - u32::from(m[3])
                        } else {
                            u32::from(m[3])
                        };
                        p.iter()
                            .map(move |v| ((u32::from(*v) * factor + 127) / 255) as u8)
                    })
                    .collect();
                assert!(expected.iter().any(|v| *v > 0));
                assert_eq!(
                    bitmap.rgba.as_ref(),
                    expected,
                    "paint={},em={em},inverted={inverted}",
                    paint.len()
                );
            }
        }
    }
}
