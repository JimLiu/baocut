//! Integration tests use real decoded PNGs and recorded glyph coverage, not sampler internals.
use super::*;
use serde_json::{Value, json};

const SIZE: (u32, u32) = (240, 140);

#[test]
fn masked_image_preserves_composition_then_multiplies_original_glyph() {
    let bytes = palette();
    let origin = pixels(&mut plan(body(&bytes, None), "O", vec![], &bytes), 0.3);
    for blur in [0.0, 1.25] {
        let mut paint = image(false);
        paint["opacity"] = json!(0.5);
        paint["compositeOpacity"] = json!(0.75);
        paint["base"] = json!({"kind":"solid","color":"#00FF0080"});
        let mut source = body(&bytes, Some(paint));
        let layer = &mut source["scene"]["value"]["nodes"][0]["style"]["paints"][0];
        layer["offset"] = json!([3, -1]);
        layer["spread"] = json!(0.75);
        layer["blur"] = json!(blur);
        let effect = pixels(&mut plan(source.clone(), "O", vec![], &bytes), 0.3);
        source["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-paint-mask/1"));
        source["scene"]["value"]["nodes"][0]["style"]["paints"][0]["mask"] =
            json!({"kind":"glyph-fill"});
        let actual = pixels(&mut plan(source, "O", vec![], &bytes), 0.3);
        let expected: Vec<u8> = effect
            .chunks_exact(4)
            .zip(origin.chunks_exact(4))
            .flat_map(|(p, m)| {
                p.iter()
                    .map(move |c| ((u32::from(*c) * u32::from(m[3]) + 127) / 255) as u8)
            })
            .collect();
        assert_eq!(
            actual, expected,
            "image composite alpha or mask product changed, blur={blur}"
        );
    }
}
fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn png(width: u32, height: u32, pixels: Vec<u8>) -> Vec<u8> {
    Pixmap::from_vec(pixels, tiny_skia::IntSize::from_wh(width, height).unwrap())
        .unwrap()
        .encode_png()
        .unwrap()
}
fn palette() -> Vec<u8> {
    png(
        4,
        1,
        vec![
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
        ],
    )
}
fn image(phase: bool) -> Value {
    let mut p = json!({"kind":"image","resourceId":"texture","uvTransform":[0.001,0,0,0.001,0.125,0.5],"space":"glyph-normalized","wrap":"repeat","filter":"nearest"});
    if phase {
        p["phase"] = json!({"period":4,"source":"cue-scalar-index"});
    }
    p
}
fn body(bytes: &[u8], paint: Option<Value>) -> Value {
    let font = include_bytes!("../../../render-raster/assets/fonts/VKSans-400.ttf");
    let mut b: Value = serde_json::from_str(include_str!(
        "../../../caption-scene/tests/fixtures/word-pop.json"
    ))
    .unwrap();
    let s = &mut b["scene"]["value"];
    s["animations"] = json!([]);
    s["requiredCapabilities"] = json!([
        "caption-scene/1",
        "caption-expressions/1",
        "caption-word-line-layout/1",
        "caption-font-source/1",
        "caption-image-paint/1",
        "caption-paint-effects/1",
        "caption-text-transform/1"
    ]);
    s["layout"] = json!({"x":{"value":120,"basis":"absolute"},"y":{"value":70,"basis":"absolute"},"width":{"value":220,"basis":"absolute"},"maxLines":2,"overflow":"visible","pagination":{"wordLinePattern":[[1]]}});
    s["resources"] = json!([{"id":"texture","assetRef":{"id":"generic-palette","revision":"1"},"contentHash":format!("sha256:{}",sha(bytes))}]);
    s["nodes"][0]["style"] = json!({"fontFamily":"generic-fixture","fontSource":{"sha256":sha(font),"faceIndex":0},"fontWeight":400,"fontSize":{"value":48,"basis":"absolute"},"fill":"#FFFFFF"});
    if let Some(p) = paint {
        s["nodes"][0]["style"]["paints"] = json!([{"id":"texture","paint":p}]);
    }
    b
}
fn words(parts: &[(&str, f64, f64)]) -> Vec<SceneWord> {
    parts
        .iter()
        .enumerate()
        .map(|(i, (text, start, end))| SceneWord {
            id: format!("w{i}"),
            text: (*text).into(),
            start: *start,
            end: *end,
        })
        .collect()
}
fn compile(b: Value, content: &str, words: Vec<SceneWord>) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&b).unwrap(),
        Default::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: content.into(),
            start: 0.,
            end: 4.,
            words,
        }],
        SIZE,
        TextEngine::with_document_fonts(&[
            include_bytes!("../../../render-raster/assets/fonts/VKSans-400.ttf").to_vec(),
            include_bytes!("../../../render-raster/assets/fonts/Arimo.ttf").to_vec(),
        ]),
        "generic-image-fixture".into(),
    )
    .unwrap()
}
fn plan(b: Value, content: &str, words: Vec<SceneWord>, bytes: &[u8]) -> ScenePlan {
    let mut p = compile(b, content, words);
    p.load_resources(|r| (r.id == "texture").then(|| bytes.to_vec()))
        .unwrap();
    p
}
fn pixels(p: &mut ScenePlan, time: f64) -> Vec<u8> {
    p.render(time).unwrap().rgba.as_ref().clone()
}
fn colors(rgba: &[u8]) -> [usize; 4] {
    let mut n = [0; 4];
    for p in rgba.chunks_exact(4).filter(|p| p[3] >= 250) {
        let i = match (p[0] >= 250, p[1] >= 250, p[2] >= 250) {
            (true, false, false) => 0,
            (false, true, false) => 1,
            (false, false, true) => 2,
            (true, true, false) => 3,
            _ => panic!("unexpected opaque palette sample {p:?}"),
        };
        n[i] += 1;
    }
    assert!(
        n.iter().sum::<usize>() > 20,
        "fixture must paint actual glyph interiors"
    );
    n
}
fn assert_palette(rgba: &[u8], expected: &[usize]) {
    let n = colors(rgba);
    for (i, count) in n.iter().enumerate() {
        if expected.contains(&i) {
            assert!(*count > 20, "missing palette color {i}: {n:?}");
        } else {
            assert_eq!(*count, 0, "unexpected palette color {i}: {n:?}");
        }
    }
}
fn max_diff(a: &[u8], b: &[u8]) -> u8 {
    assert_eq!(a.len(), b.len());
    a.iter().zip(b).map(|(a, b)| a.abs_diff(*b)).max().unwrap()
}
fn unit_opacity(b: &mut Value, opacity: f64) {
    b["scene"]["value"]["animations"] = json!([{"id":"unit-opacity","target":{"nodeId":"caption","selectorId":"words"},"property":"opacity","composite":"replace","value":{"kind":"constant","value":opacity}}]);
}

#[test]
fn float32_phase_rounding_reaches_real_png_pixels_and_retains_whitespace_indices() {
    let texture = png(2, 1, vec![255, 0, 0, 255, 0, 0, 255, 255]);
    let make = |float32: bool, content: &str| {
        let phase = if float32 {
            json!({"period":1,"source":"cue-scalar-index","arithmetic":"float32","indexOffset":1e-6})
        } else {
            json!({"period":1,"source":"cue-scalar-index"})
        };
        let paint = json!({"kind":"image","resourceId":"texture","space":"glyph-normalized",
            "uvTransform":[1e-9,0,0,1e-9,0.4999995,0.5],"filter":"nearest","phase":phase});
        let mut b = body(&texture, Some(paint));
        if float32 {
            b["scene"]["value"]["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!("caption-image-phase-float32/1"));
        }
        plan(b, content, words(&[("A", 0., 4.)]), &texture)
    };
    let mut old = make(false, "A");
    let mut at_zero = make(true, "A");
    let padded = format!("{}A", " ".repeat(32));
    let mut at_thirty_two = make(true, &padded);
    assert_palette(&pixels(&mut old, 0.5), &[0]);
    let blue = pixels(&mut at_zero, 0.5);
    assert_palette(&blue, &[2]);
    assert_palette(&pixels(&mut at_thirty_two, 0.5), &[0]);
    let _ = pixels(&mut at_zero, 2.5);
    assert_eq!(pixels(&mut at_zero, 0.5), blue);
}

#[test]
fn real_png_requires_matching_sha_and_loaded_resources_and_is_not_constant() {
    let bytes = palette();
    let b = body(&bytes, Some(image(true)));
    let mut p = compile(b, "MM", words(&[("MM", 0., 4.)]));
    assert!(
        p.record(0.2)
            .unwrap_err()
            .to_string()
            .contains("CAPTION_RESOURCE_MISSING")
    );
    assert!(
        p.load_resources(|_| None)
            .unwrap_err()
            .to_string()
            .contains("CAPTION_RESOURCE_MISSING")
    );
    let wrong = png(1, 1, vec![0, 0, 255, 255]);
    assert!(
        p.load_resources(|_| Some(wrong.clone()))
            .unwrap_err()
            .to_string()
            .contains("CAPTION_RESOURCE_DIGEST")
    );
    assert!(
        p.record(0.2).is_err(),
        "failed loads cannot install partial resources"
    );
    p.load_resources(|_| Some(bytes.clone())).unwrap();
    assert_palette(&pixels(&mut p, 0.2), &[0, 1]);
}

#[test]
fn png_resource_roundtrip_preserves_every_associated_channel_alpha_pair() {
    let mut associated = Vec::new();
    let mut straight = Vec::new();
    for alpha in 0_u32..=255 {
        for channel in 0..=alpha {
            let pixel = [channel, alpha - channel, channel / 2, alpha];
            associated.extend(pixel.map(|v| v as u8));
            straight.extend(pixel[..3].iter().map(|v| {
                if alpha == 0 {
                    0
                } else {
                    ((v * 255 + alpha / 2) / alpha) as u8
                }
            }));
            straight.push(alpha as u8);
        }
    }
    let width = (associated.len() / 4) as u32;
    let mut encoded = Vec::new();
    {
        // PNG stores straight RGBA. Decode through the real scene resource
        // loader, rather than assuming its premultiplication formula in a test.
        let mut encoder = png::Encoder::new(&mut encoded, width, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&straight)
            .unwrap();
    }
    let mut p = compile(
        body(&encoded, Some(image(false))),
        "M",
        words(&[("M", 0., 4.)]),
    );
    p.load_resources(|_| Some(encoded.clone())).unwrap();
    let decoded = &p.images["texture"];
    assert_eq!((decoded.width, decoded.height), (width, 1));
    assert_eq!(
        decoded.rgba.as_ref(),
        associated,
        "valid associated values must not be premultiplied twice"
    );
}

#[test]
fn image_base_node_fill_and_unit_opacity_use_one_glyph_coverage() {
    let bytes = png(1, 1, vec![128, 0, 0, 128]);
    let mut paint = image(false);
    paint["base"] = json!({"kind":"node-fill"});
    let mut mask = plan(body(&bytes, None), "M", words(&[("M", 0., 4.)]), &bytes);
    let mask = pixels(&mut mask, 0.2);
    for (opacity, rgba) in [(0.5, [64u8, 32, 0, 96]), (2., [128u8, 64, 0, 192])] {
        let mut b = body(&bytes, Some(paint.clone()));
        b["scene"]["value"]["nodes"][0]["style"]["fill"] = json!("#00FF0080");
        unit_opacity(&mut b, opacity);
        let mut p = plan(b, "M", words(&[("M", 0., 4.)]), &bytes);
        let actual = pixels(&mut p, 0.2);
        let mut interior = 0;
        let mut edge = 0;
        let mut differs_double = 0;
        for (m, a) in mask.chunks_exact(4).zip(actual.chunks_exact(4)) {
            for c in 0..4 {
                let want = (f64::from(rgba[c]) * f64::from(m[3]) / 255.).round() as u8;
                assert!(
                    a[c].abs_diff(want) <= 2,
                    "opacity={opacity}, mask={m:?}, actual={a:?}, want={want}, channel={c}"
                );
            }
            if m[3] == 255 {
                assert_eq!(a, rgba);
                interior += 1;
            }
            if (32..224).contains(&m[3]) {
                edge += 1;
                let cov = f64::from(m[3]) / 255.;
                let op = opacity.min(1.);
                // A separately composed base and texture applies source-over after two AA masks.
                let double = (255. * (0.5 * op * cov + 0.5 * op * cov * (1. - 0.5 * op * cov)))
                    .round() as u8;
                if a[3].abs_diff(double) > 2 {
                    differs_double += 1;
                }
            }
        }
        assert!(
            interior > 20 && edge > 10 && differs_double > 10,
            "fixture must distinguish AA edges from a two-layer composite"
        );
    }
}

#[test]
fn phase_preserves_cue_scalar_indices_across_pages_spaces_and_tabs() {
    let bytes = palette();
    let mut p = plan(
        body(&bytes, Some(image(true))),
        "M \tM M",
        words(&[("M", 0., 0.8), ("M", 1., 1.8), ("M", 2., 2.8)]),
        &bytes,
    );
    for (t, c) in [(0.2, 0), (1.2, 3), (2.2, 1)] {
        assert_palette(&pixels(&mut p, t), &[c]);
    }
    let first = pixels(&mut p, 0.2);
    let _ = pixels(&mut p, 2.2);
    assert_eq!(
        pixels(&mut p, 0.2),
        first,
        "nonmonotonic seek must preserve phase"
    );
}

#[test]
fn composite_opacity_scales_sample_and_base_after_composition_with_one_coverage() {
    let bytes = png(1, 1, vec![128, 0, 0, 128]);
    let mut paint = image(false);
    paint["base"] = json!({"kind":"node-fill"});
    paint["opacity"] = json!(0.5);
    let mut source = body(&bytes, Some(paint));
    source["scene"]["value"]["nodes"][0]["style"]["fill"] = json!("#00FF00FF");
    let mut mask = plan(body(&bytes, None), "M", words(&[("M", 0., 4.)]), &bytes);
    let coverage = pixels(&mut mask, 0.2);
    let mut full = plan(source.clone(), "M", words(&[("M", 0., 4.)]), &bytes);
    let full = pixels(&mut full, 0.2);
    let mut explicit = source.clone();
    explicit["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["compositeOpacity"] =
        json!(1);
    let mut same = plan(explicit, "M", words(&[("M", 0., 4.)]), &bytes);
    assert_eq!(
        pixels(&mut same, 0.2),
        full,
        "default opacity must preserve old pixels"
    );
    for (composite, glyph) in [(0., 1.), (0.5, 1.), (0.5, 0.5)] {
        let mut b = source.clone();
        b["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["compositeOpacity"] =
            json!(composite);
        unit_opacity(&mut b, glyph);
        let mut p = plan(b, "M", words(&[("M", 0., 4.)]), &bytes);
        let actual = pixels(&mut p, 0.2);
        let mut interiors = 0;
        let mut edges = 0;
        for (m, pixel) in coverage.chunks_exact(4).zip(actual.chunks_exact(4)) {
            // Image alpha=128/255, image opacity=.5; base is opaque green.
            // Keep these channels floating until all opacities and coverage apply.
            for (channel, color) in [64., 191., 0., 255.].into_iter().enumerate() {
                let want = (color * composite * glyph * f64::from(m[3]) / 255.).round() as u8;
                assert!(
                    pixel[channel].abs_diff(want) <= 1,
                    "pixel={pixel:?}, mask={m:?}, wanted={want}"
                );
            }
            interiors += usize::from(m[3] == 255);
            edges += usize::from((32..224).contains(&m[3]));
        }
        assert!(interiors > 20 && edges > 10);
    }
}

#[test]
fn effect_composite_opacity_applies_once_after_overlap_and_blur() {
    let bytes = png(1, 1, vec![128, 0, 0, 128]);
    let mut paint = image(false);
    paint["base"] = json!({"kind":"node-fill"});
    let mut source = body(&bytes, Some(paint));
    source["scene"]["value"]["nodes"][0]["style"]["fill"] = json!("#00FF0080");
    source["scene"]["value"]["nodes"][0]["style"]["letterSpacing"] = json!(-0.45);
    source["scene"]["value"]["nodes"][0]["style"]["paints"][0]["blur"] = json!(2);
    source["scene"]["value"]["nodes"][0]["style"]["paints"][0]["spread"] = json!(1);
    let mut full = plan(source.clone(), "MM", words(&[("MM", 0., 4.)]), &bytes);
    let full = pixels(&mut full, 0.2);
    assert!(
        full.chunks_exact(4).map(|p| p[3]).max().unwrap() > 192,
        "fixture must overlap"
    );
    for (composite, glyph) in [(0., 1.), (0.5, 1.), (0.5, 0.5)] {
        let mut b = source.clone();
        b["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["compositeOpacity"] =
            json!(composite);
        unit_opacity(&mut b, glyph);
        let mut p = plan(b, "MM", words(&[("MM", 0., 4.)]), &bytes);
        let actual = pixels(&mut p, 0.2);
        let expected = full
            .iter()
            .map(|v| (f64::from(*v) * composite * glyph).round() as u8)
            .collect::<Vec<_>>();
        assert!(
            max_diff(&actual, &expected) <= 2,
            "opacity must follow effect-run composition and blur"
        );
    }
}

#[test]
fn static_text_phase_uses_its_own_uppercase_expansion_not_cue_bytes() {
    let bytes = palette();
    let mut b = body(&bytes, Some(image(true)));
    b["scene"]["value"]["nodes"][0]["text"] = json!({"source":"static","text":"ß\tM"});
    b["scene"]["value"]["nodes"][0]["style"]["textTransform"] = json!("uppercase");
    let mut p = plan(b, "unrelated cue bytes", vec![], &bytes);
    assert_palette(&pixels(&mut p, 0.2), &[0, 1]);
    assert_palette(&pixels(&mut p, 2.2), &[3]);
}

#[test]
fn ligature_phase_is_source_scalar_not_physical_glyph_ordinal() {
    let bytes = palette();
    let mut p = plan(
        body(&bytes, Some(image(true))),
        "ff\tM",
        words(&[("ff", 0., 1.8), ("M", 2., 3.8)]),
        &bytes,
    );
    let family = p.style.scene().nodes[0].style.font_family.clone();
    let shaped = p.text.shape("ff", &family, 48., 400);
    assert!(
        shaped
            .glyphs
            .iter()
            .any(|g| g.cluster.end - g.cluster.start >= 2),
        "fixture must shape a real multi-scalar ligature"
    );
    assert_palette(&pixels(&mut p, 0.2), &[0]);
    assert_palette(&pixels(&mut p, 2.2), &[3]);
}

#[test]
fn label_phase_uses_its_own_transformed_content() {
    let bytes = palette();
    let mut b = body(&bytes, None);
    let mut label: Value = serde_json::from_str(include_str!(
        "../../../caption-scene/tests/fixtures/bound-label.json"
    ))
    .unwrap();
    let s = &mut b["scene"]["value"];
    s["requiredCapabilities"].as_array_mut().unwrap().extend([
        json!("caption-bound-label/1"),
        json!("caption-ink-context/1"),
        json!("caption-unit-context/1"),
    ]);
    s["nodes"][0]["properties"] = json!({"opacity":{"kind":"constant","value":0}});
    let mut repeat = label["scene"]["value"]["nodes"][1].take();
    repeat["children"][0]["text"] = json!({"source":"static","text":"ßM"});
    repeat["children"][0]["style"] = s["nodes"][0]["style"].clone();
    repeat["children"][0]["style"]["textTransform"] = json!("uppercase");
    repeat["children"][0]["style"]["paints"] = json!([{"id":"texture","paint":image(true)}]);
    repeat["children"][0]["properties"] = json!({});
    s["nodes"].as_array_mut().unwrap().push(repeat);
    s["selectors"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"pages","nodeId":"caption","unit":"page"}));
    let mut p = plan(b, "Q", words(&[("Q", 0., 4.)]), &bytes);
    assert_palette(&pixels(&mut p, 0.2), &[0, 1, 2]);
}

#[test]
fn bitmap_recording_roundtrips_bcop_and_unused_image_resources_preserve_legacy() {
    struct NoMedia;
    impl FrameMedia for NoMedia {
        fn frame(&mut self, _: &str, _: i64) -> Result<Arc<Pixmap>> {
            bail!("unexpected external media")
        }
    }
    let bytes = palette();
    let mut p = plan(
        body(&bytes, Some(image(true))),
        "MM",
        words(&[("MM", 0., 4.)]),
        &bytes,
    );
    let (ops, _) = p.record(0.2).unwrap();
    assert!(
        ops.ops
            .iter()
            .any(|op| matches!(op, DrawOp::DrawBitmap { .. })),
        "image paint must lower to ordinary bitmap composition"
    );
    let encoded = render_raster::drawop::encode(&ops);
    let (_, decoded) = render_raster::drawop::decode(&encoded).unwrap();
    let replay = rasterize_with_media(&decoded, SIZE.0, SIZE.1, &mut NoMedia).unwrap();
    assert_eq!(replay.data(), pixels(&mut p, 0.2));
    assert_eq!(
        render_raster::drawop::encode(&p.record(0.2).unwrap().0),
        encoded
    );
    let with = body(&bytes, None);
    let mut without = with.clone();
    let s = &mut without["scene"]["value"];
    s.as_object_mut().unwrap().remove("resources");
    s["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|v| v != "caption-image-paint/1");
    let mut a = plan(with, "MM", words(&[("MM", 0., 4.)]), &bytes);
    let mut b = compile(without, "MM", words(&[("MM", 0., 4.)]));
    assert_eq!(
        render_raster::drawop::encode(&a.record(0.2).unwrap().0),
        render_raster::drawop::encode(&b.record(0.2).unwrap().0)
    );
    assert_eq!(pixels(&mut a, 0.2), pixels(&mut b, 0.2));
}

#[test]
fn image_surface_phase_and_work_budgets_are_cumulative_atomic_and_overflow_safe() {
    let mut b = Budget::default();
    let max = 16 * 1024 * 1024;
    b.reserve_image_paint_pixels(max / 2).unwrap();
    assert!(b.reserve_image_paint_pixels(max / 2 + 1).is_err());
    b.reserve_image_paint_pixels(max / 2).unwrap();
    assert!(b.reserve_image_paint_pixels(1).is_err());
    assert!(b.reserve_image_paint_pixels(usize::MAX).is_err());
    let mut b = Budget::default();
    b.reserve_image_phase_slots(65536).unwrap();
    assert!(b.reserve_image_phase_slots(65537).is_err());
    b.reserve_image_phase_slots(65536).unwrap();
    assert!(b.reserve_image_phase_slots(1).is_err());
    assert!(b.reserve_image_phase_slots(usize::MAX).is_err());
    let mut b = Budget::default();
    b.reserve_image_paint_work(128 * 1024 * 1024).unwrap();
    assert!(b.reserve_image_paint_work(128 * 1024 * 1024 + 1).is_err());
    b.reserve_image_paint_work(128 * 1024 * 1024).unwrap();
    assert!(b.reserve_image_paint_work(u64::MAX).is_err());
}

#[test]
fn valid_em_effect_that_exceeds_actual_sigma_budget_rejects_before_large_allocation() {
    let bytes = palette();
    let mut b = body(&bytes, Some(image(false)));
    b["scene"]["value"]["nodes"][0]["style"]["fontSize"]["value"] = json!(72);
    let layer = &mut b["scene"]["value"]["nodes"][0]["style"]["paints"][0];
    layer["unit"] = json!("em");
    layer["blur"] = json!(4);
    let mut p = plan(b, "M", words(&[("M", 0., 4.)]), &bytes);
    let err = p.record(0.2).unwrap_err().to_string();
    assert!(
        err.contains("CAPTION_BUDGET_EXCEEDED") && err.contains("blur"),
        "{err}"
    );
}
// Append after the first integration test session has completed.
#[test]
fn rtl_phase_uses_logical_scalars_despite_visual_glyph_order() {
    let bytes = palette();
    let mut p = plan(
        body(&bytes, Some(image(true))),
        "אב M",
        words(&[("אב", 0., 1.8), ("M", 2., 3.8)]),
        &bytes,
    );
    let family = p.style.scene().nodes[0].style.font_family.clone();
    let shaped = p.text.shape("אב", &family, 48., 400);
    assert!(
        shaped.glyphs.len() >= 2 && shaped.glyphs.iter().all(|g| g.rtl),
        "fixture must shape real RTL glyphs"
    );
    let frame = pixels(&mut p, 0.2);
    assert_palette(&frame, &[0, 1]);
    let mut sums = [(0u64, 0u64); 2];
    for (i, p) in frame
        .chunks_exact(4)
        .enumerate()
        .filter(|(_, p)| p[3] >= 250)
    {
        let c = if p[0] >= 250 { 0 } else { 1 };
        sums[c].0 += (i as u64 % u64::from(SIZE.0)) * u64::from(p[3]);
        sums[c].1 += u64::from(p[3]);
    }
    assert!(
        (sums[1].0 as f64 / sums[1].1 as f64) < (sums[0].0 as f64 / sums[0].1 as f64),
        "logical index1 must appear visually left of index0"
    );
    assert_palette(&pixels(&mut p, 2.2), &[3]);
}

#[test]
fn normalized_line_page_and_em_domains_have_observable_distinct_sampling() {
    let bytes = png(2, 1, vec![255, 0, 0, 255, 0, 0, 255, 255]);
    let paint = |space| json!({"kind":"image","resourceId":"texture","uvTransform":[1,0,0,1,0,0],"space":space,"filter":"nearest"});
    let mut b = body(&bytes, Some(paint("glyph-normalized")));
    b["scene"]["value"]["layout"]["pagination"] = json!({"wordLinePattern":[[2]]});
    let mut g = plan(
        b.clone(),
        "M M",
        words(&[("M", 0., 1.8), ("M", 2., 3.8)]),
        &bytes,
    );
    let glyph = pixels(&mut g, 0.2);
    b["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"] = paint("line-normalized");
    let mut l = plan(b, "M M", words(&[("M", 0., 1.8), ("M", 2., 3.8)]), &bytes);
    let line = pixels(&mut l, 0.2);
    for frame in [&glyph, &line] {
        assert_palette(frame, &[0, 2]);
    }
    let mid = (0..SIZE.0)
        .filter(|x| (0..SIZE.1).any(|y| glyph[((y * SIZE.0 + x) * 4 + 3) as usize] > 0))
        .collect::<Vec<_>>();
    let center = (mid[0] + mid[mid.len() - 1]) as usize / 2;
    let count = |frame: &[u8], left: bool, channel: usize| {
        frame
            .chunks_exact(4)
            .enumerate()
            .filter(|(i, p)| {
                p[3] >= 250 && ((*i % SIZE.0 as usize) < center) == left && p[channel] >= 250
            })
            .count()
    };
    assert!(
        count(&glyph, true, 0) > 20
            && count(&glyph, true, 2) > 20
            && count(&glyph, false, 0) > 20
            && count(&glyph, false, 2) > 20,
        "each glyph must sample both halves"
    );
    assert!(count(&line, true, 0) > 20 && count(&line, false, 2) > 20);
    assert_eq!(
        count(&line, true, 2),
        0,
        "line coordinates cannot restart at each glyph"
    );
    assert_eq!(count(&line, false, 0), 0);
    // On a one-line page, the declared line and page coordinate bounds coincide.
    let mut same = body(&bytes, Some(paint("line-normalized")));
    let mut l = plan(same.clone(), "M", words(&[("M", 0., 4.)]), &bytes);
    same["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["space"] =
        json!("page-normalized");
    let mut p = plan(same, "M", words(&[("M", 0., 4.)]), &bytes);
    assert_eq!(pixels(&mut l, 0.2), pixels(&mut p, 0.2));
    let vertical = png(1, 2, vec![255, 0, 0, 255, 0, 0, 255, 255]);
    let mut b = body(&vertical, Some(paint("line-normalized")));
    b["scene"]["value"]["layout"]["pagination"] = json!({"wordLinePattern":[[1,1]]});
    let mut l = plan(
        b.clone(),
        "M M",
        words(&[("M", 0., 1.8), ("M", 2., 3.8)]),
        &vertical,
    );
    let line = pixels(&mut l, 0.2);
    b["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"] = paint("page-normalized");
    let mut p = plan(
        b,
        "M M",
        words(&[("M", 0., 1.8), ("M", 2., 3.8)]),
        &vertical,
    );
    let page = pixels(&mut p, 0.2);
    assert_palette(&line, &[0, 2]);
    assert_palette(&page, &[0, 2]);
    assert!(
        max_diff(&line, &page) > 128,
        "page domain must retain two-line position"
    );
    let palette = palette();
    let mut norm = paint("glyph-normalized");
    norm["uvTransform"] = json!([1, 0, 0, 1, 0.5, 0.5]);
    let mut b = body(&palette, Some(norm));
    let mut n = plan(b.clone(), "M", words(&[("M", 0., 4.)]), &palette);
    let normal = pixels(&mut n, 0.2);
    assert_palette(&normal, &[2, 3]);
    b["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["space"] = json!("glyph-em");
    let mut e = plan(b, "M", words(&[("M", 0., 4.)]), &palette);
    let em = pixels(&mut e, 0.2);
    assert!(
        colors(&em)[0] > 20 && max_diff(&normal, &em) > 128,
        "centered em coordinates must be distinguishable from normalized ink"
    );
}

#[test]
fn repeat_mirror_and_uv_shear_are_sampled_in_real_glyphs() {
    let bytes = palette();
    let sample = |wrap: &str, matrix: Value| {
        let mut paint = image(false);
        paint["uvTransform"] = matrix;
        paint["filter"] = json!("bilinear");
        paint["wrap"] = json!(wrap);
        let mut p = plan(
            body(&bytes, Some(paint)),
            "MM",
            words(&[("MM", 0., 4.)]),
            &bytes,
        );
        pixels(&mut p, 0.2)
    };
    let repeat = sample("repeat", json!([1, 0, 0, 1, 0, 0]));
    assert!(max_diff(&repeat, &sample("repeat", json!([1, 0, 0, 1, 1, 0]))) <= 1);
    let mirror = sample("mirror", json!([1, 0, 0, 1, 0, 0]));
    assert!(max_diff(&mirror, &sample("mirror", json!([1, 0, 0, 1, 2, 0]))) <= 1);
    assert!(max_diff(&mirror, &sample("mirror", json!([-1, 0, 0, 1, 0, 0]))) <= 1);
    let rotated = sample("repeat", json!([0, 1, -1, 0, 1, 0]));
    assert!(
        max_diff(&repeat, &rotated) > 64,
        "UV rotation must change actual texture sampling"
    );
    assert!(
        repeat
            .chunks_exact(4)
            .zip(rotated.chunks_exact(4))
            .all(|(a, b)| a[3] == b[3])
    );
    let sheared = sample("repeat", json!([1, 0, 0.6, 1, 0, 0]));
    assert!(
        max_diff(&repeat, &sheared) > 64,
        "UV shear must affect nonconstant image paint"
    );
    assert!(
        repeat
            .chunks_exact(4)
            .zip(sheared.chunks_exact(4))
            .all(|(a, b)| a[3] == b[3]),
        "opaque texture UV changes cannot change glyph coverage"
    );
}

#[test]
fn parent_affine_shear_and_layer_offset_follow_world_glyph_coverage() {
    let bytes = png(1, 1, vec![255, 255, 255, 255]);
    let mut b = body(&bytes, Some(image(false)));
    let text = b["scene"]["value"]["nodes"][0].take();
    b["scene"]["value"]["nodes"] = json!([{"id":"outer","type":"group","properties":{"transform.rotation":{"kind":"constant","value":0.45},"transform.scaleX":{"kind":"constant","value":1.4},"transform.scaleY":{"kind":"constant","value":0.8}},"children":[{"id":"inner","type":"group","properties":{"transform.rotation":{"kind":"constant","value":-0.45}},"children":[text]}]}]);
    let mut image_plan = plan(b.clone(), "M", words(&[("M", 0., 4.)]), &bytes);
    let painted = pixels(&mut image_plan, 0.2);
    b["scene"]["value"]["nodes"][0]["children"][0]["children"][0]["style"]
        .as_object_mut()
        .unwrap()
        .remove("paints");
    let mut plain = plan(b, "M", words(&[("M", 0., 4.)]), &bytes);
    let plain = pixels(&mut plain, 0.2);
    assert!(plain.chunks_exact(4).filter(|p| p[3] > 0).count() > 100);
    assert!(
        max_diff(&painted, &plain) <= 2,
        "image coverage must follow the actual affine parent"
    );
    let b = body(&bytes, Some(image(false)));
    let mut base = plan(b.clone(), "M", words(&[("M", 0., 4.)]), &bytes);
    let base = pixels(&mut base, 0.2);
    let mut shifted = b;
    shifted["scene"]["value"]["nodes"][0]["style"]["paints"][0]["offset"] = json!([5, -3]);
    let mut p = plan(shifted, "M", words(&[("M", 0., 4.)]), &bytes);
    let shifted = pixels(&mut p, 0.2);
    for y in 3..SIZE.1 {
        for x in 0..SIZE.0 - 5 {
            let a = ((y * SIZE.0 + x) * 4) as usize;
            let b = (((y - 3) * SIZE.0 + x + 5) * 4) as usize;
            assert_eq!(&base[a..a + 4], &shifted[b..b + 4]);
        }
    }
}

#[test]
fn overlapping_translucent_effects_apply_common_opacity_once_after_blur_and_spread() {
    let bytes = png(1, 1, vec![128, 0, 0, 128]);
    let mut paint = image(false);
    paint["base"] = json!({"kind":"node-fill"});
    let mut b = body(&bytes, Some(paint));
    b["scene"]["value"]["nodes"][0]["style"]["fill"] = json!("#00FF0080");
    b["scene"]["value"]["nodes"][0]["style"]["letterSpacing"] = json!(-0.45);
    let layer = &mut b["scene"]["value"]["nodes"][0]["style"]["paints"][0];
    layer["blur"] = json!(2);
    layer["spread"] = json!(1);
    let mut full = plan(b.clone(), "MM", words(&[("MM", 0., 4.)]), &bytes);
    let full = pixels(&mut full, 0.2);
    let mut half = b.clone();
    unit_opacity(&mut half, 0.5);
    let mut p = plan(half, "MM", words(&[("MM", 0., 4.)]), &bytes);
    let half = pixels(&mut p, 0.2);
    let expected = full
        .iter()
        .map(|v| (*v as f64 * 0.5).round() as u8)
        .collect::<Vec<_>>();
    assert!(
        max_diff(&half, &expected) <= 2,
        "effect run must composite overlaps before shared unit opacity"
    );
    let mut clamped = b.clone();
    unit_opacity(&mut clamped, 2.);
    let mut p = plan(clamped, "MM", words(&[("MM", 0., 4.)]), &bytes);
    assert_eq!(pixels(&mut p, 0.2), full);
    // Opaque .5 normal glyphs overlap to approximately .75. The effects run
    // instead applies .5 once after collecting the opaque silhouette.
    let opaque = png(1, 1, vec![255, 255, 255, 255]);
    let mut normal = body(&opaque, Some(image(false)));
    normal["scene"]["value"]["nodes"][0]["style"]["letterSpacing"] = json!(-0.45);
    unit_opacity(&mut normal, 0.5);
    let mut p = plan(normal.clone(), "MM", words(&[("MM", 0., 4.)]), &opaque);
    let normal = pixels(&mut p, 0.2);
    let mut effect = body(&opaque, Some(image(false)));
    effect["scene"]["value"]["nodes"][0]["style"]["letterSpacing"] = json!(-0.45);
    unit_opacity(&mut effect, 0.5);
    let layer = &mut effect["scene"]["value"]["nodes"][0]["style"]["paints"][0];
    layer["blur"] = json!(2);
    layer["spread"] = json!(1);
    let mut p = plan(effect, "MM", words(&[("MM", 0., 4.)]), &opaque);
    let effect = pixels(&mut p, 0.2);
    assert!(
        normal.chunks_exact(4).map(|p| p[3]).max().unwrap() >= 180,
        "normal glyph fixture must actually overlap"
    );
    assert!(
        effect.chunks_exact(4).map(|p| p[3]).max().unwrap() <= 128,
        "shared opacity must not become .75 at overlaps"
    );
    assert!(
        full.chunks_exact(4).map(|p| p[3]).max().unwrap() > 192,
        "negative tracking must create actual translucent overlap"
    );
}

#[test]
fn image_base_linear_matches_cpu_gradient_and_tiny_axis_uses_last_stop() {
    let transparent = png(1, 1, vec![0, 0, 0, 0]);
    for (name, gradient) in [
        (
            "transparent-nonuniform",
            json!({"kind":"linear","from":[0,0],"to":[1,0.25],"stops":[{"at":0,"color":"#FF000080"},{"at":0.35,"color":"#00FF0040"},{"at":1,"color":"#0000FFC0"}]}),
        ),
        (
            "tiny-axis",
            json!({"kind":"linear","from":[0,0],"to":[0.00000001,0],"stops":[{"at":0,"color":"#FF000080"},{"at":1,"color":"#0000FF40"}]}),
        ),
        (
            "glyph-domain",
            json!({"kind":"linear","from":[0,0],"to":[0,1],"domain":"glyph","glyphOutset":0.25,"stops":[{"at":0,"color":"#FF000080"},{"at":1,"color":"#0000FFC0"}]}),
        ),
    ] {
        let declare = |mut b: Value| {
            if gradient.get("domain").is_some() {
                let capabilities = b["scene"]["value"]["requiredCapabilities"]
                    .as_array_mut()
                    .unwrap();
                capabilities.push(json!("caption-gradient-glyph/1"));
            }
            b
        };
        let mut paint = image(false);
        paint["base"] = gradient.clone();
        let mut p = plan(
            declare(body(&transparent, Some(paint))),
            "M",
            words(&[("M", 0., 4.)]),
            &transparent,
        );
        let actual = pixels(&mut p, 0.2);
        let mut p = plan(
            declare(body(&transparent, Some(gradient.clone()))),
            "M",
            words(&[("M", 0., 4.)]),
            &transparent,
        );
        let ordinary = pixels(&mut p, 0.2);
        if name == "glyph-domain" {
            let mut line = gradient.clone();
            line.as_object_mut()
                .unwrap()
                .retain(|k, _| k != "domain" && k != "glyphOutset");
            let mut p = plan(
                body(&transparent, Some(line)),
                "M",
                words(&[("M", 0., 4.)]),
                &transparent,
            );
            assert!(
                max_diff(&pixels(&mut p, 0.2), &ordinary) > 8,
                "the glyph box is not the line box"
            );
        }
        let worst = max_diff(&actual, &ordinary);
        assert!(
            worst <= 2,
            "{name} image base vs original CPU gradient max={worst}"
        );
        assert!(
            actual.chunks_exact(4).filter(|p| p[3] > 0).count() > 100,
            "{name} must paint real glyph coverage"
        );
        if name == "tiny-axis" {
            assert!(
                actual.chunks_exact(4).any(|p| p == [0, 0, 64, 64]),
                "last stop must produce interior pixels"
            );
            assert!(
                actual
                    .chunks_exact(4)
                    .all(|p| p[0] == 0 && p[1] == 0 && p[2] == p[3]),
                "tiny axis cannot choose the first stop or unstable interpolation"
            );
        } else {
            assert!(
                actual.chunks_exact(4).any(|p| p[0] > 10)
                    && actual.chunks_exact(4).any(|p| p[2] > 10)
            );
        }
    }
}

#[test]
fn local_mask_preserves_global_image_phase_domain_and_blur() {
    let bytes = palette();
    for blur in [0., 1.25] {
        let mut source = body(&bytes, Some(image(true)));
        for cap in ["caption-paint-mask/1", "caption-paint-mask-transform/1"] {
            source["scene"]["value"]["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!(cap));
        }
        let layer = &mut source["scene"]["value"]["nodes"][0]["style"]["paints"][0];
        layer["offset"] = json!([4.25, -2.5]);
        layer["spread"] = json!(1.);
        layer["blur"] = json!(blur);
        layer["mask"] = json!({"kind":"glyph-fill","offset":[-1.5,2.25],"inverted":true});
        let expected = pixels(&mut plan(source.clone(), "OOgj", vec![], &bytes), 0.3);
        source["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-paint-mask-local/1"));
        source["scene"]["value"]["nodes"][0]["style"]["paints"][0]["mask"]["rasterization"] =
            json!("glyph-bounds");
        let actual = pixels(&mut plan(source, "OOgj", vec![], &bytes), 0.3);
        assert!(expected.iter().any(|v| *v > 0));
        let delta = actual
            .iter()
            .zip(&expected)
            .map(|(a, b)| a.abs_diff(*b))
            .max()
            .unwrap();
        assert!(
            delta <= 1,
            "local image domain/phase changed: blur={blur}, maxDelta={delta}"
        );
    }
}

fn glyph_ramp_texture(vertical: bool) -> Vec<u8> {
    let rgba = (0..=255u8).flat_map(|i| [i, 0, 255 - i, 255]).collect();
    if vertical { png(1, 256, rgba) } else { png(256, 1, rgba) }
}

fn glyph_ramp_paint(outset: f64, vertical: bool) -> Value {
    // Texel i stores i/255. The half-texel transform makes bilinear sampling
    // reconstruct the continuous ramp exactly: 256 * U - 0.5 = 255 * u.
    let uv = if vertical {
        json!([1, 0, 0, 255.0 / 256.0, 0, 0.5 / 256.0])
    } else {
        json!([255.0 / 256.0, 0, 0, 1, 0.5 / 256.0, 0])
    };
    json!({"kind":"image","resourceId":"texture","space":"glyph-normalized",
        "glyphOutset":outset,"uvTransform":uv,"wrap":"clamp","filter":"bilinear"})
}

fn glyph_ramp_gradient(outset: f64, vertical: bool) -> Value {
    json!({"kind":"linear","from":[0,0],"to":if vertical { [0,1] } else { [1,0] },
        "space":"normalized","domain":"glyph","glyphOutset":outset,
        "stops":[{"at":0,"color":"#0000FF"},{"at":1,"color":"#FF0000"}]})
}

fn glyph_ramp_body(bytes: &[u8], paint: Value) -> Value {
    let mut source = body(bytes, Some(paint));
    source["scene"]["value"]["requiredCapabilities"].as_array_mut().unwrap().extend([
        json!("caption-image-glyph-outset/1"),
        json!("caption-gradient-glyph/1"),
        json!("caption-gradient-space/1"),
    ]);
    source
}

fn glyph_ramp_distance(mut source: Value, offset: [f64; 2]) -> Value {
    source["scene"]["value"]["requiredCapabilities"].as_array_mut().unwrap().extend([
        json!("caption-glyph-distance-coverage/1"),
        json!("caption-image-distance-coverage/1"),
    ]);
    source["scene"]["value"]["nodes"][0]["style"]["paints"][0]["distanceCoverage"] = json!({
        "source":"glyph-contours",
        "bands":[{"offset":offset,"threshold":0,"halfWidth":0.5}],
        "aa":{"kind":"quad-derivative","sourceBand":0,"scale":0.5},
        "combine":"multiply","zeroWidth":"step-inclusive"
    });
    source
}

fn assert_same_alpha(a: &[u8], b: &[u8]) {
    assert_eq!(a.len(), b.len());
    assert!(
        a.chunks_exact(4).zip(b.chunks_exact(4)).all(|(a, b)| a[3] == b[3]),
        "opaque image domain changes cannot change coverage"
    );
}

#[test]
fn zero_image_glyph_outset_keeps_legacy_recorded_bytes_and_pixels() {
    let bytes = glyph_ramp_texture(false);
    for space in ["glyph-em", "glyph-normalized", "line-normalized", "page-normalized"] {
        let mut absent = glyph_ramp_paint(0.0, false);
        absent.as_object_mut().unwrap().remove("glyphOutset");
        absent["space"] = json!(space);
        let mut explicit_zero = absent.clone();
        explicit_zero["glyphOutset"] = json!(0);
        let mut old = plan(body(&bytes, Some(absent)), "MWI", words(&[("MWI", 0., 4.)]), &bytes);
        let mut zero = plan(body(&bytes, Some(explicit_zero)), "MWI", words(&[("MWI", 0., 4.)]), &bytes);
        assert_eq!(
            render_raster::drawop::encode(&old.record(0.3).unwrap().0),
            render_raster::drawop::encode(&zero.record(0.3).unwrap().0),
            "{space} explicit zero must preserve the legacy transport"
        );
        assert_eq!(pixels(&mut old, 0.3), pixels(&mut zero, 0.3), "{space}");
    }
}

#[test]
fn image_glyph_outset_matches_existing_font_em_gradient_for_both_axes_and_glyph_widths() {
    for vertical in [false, true] {
        let bytes = glyph_ramp_texture(vertical);
        for font_size in [24, 48] {
            for outset in [0.125, 0.4] {
                let declare = |paint| {
                    let mut source = glyph_ramp_body(&bytes, paint);
                    source["scene"]["value"]["nodes"][0]["style"]["fontSize"]["value"] = json!(font_size);
                    source
                };
                let mut image_plan = plan(
                    declare(glyph_ramp_paint(outset, vertical)),
                    "MWI",
                    words(&[("MWI", 0., 4.)]),
                    &bytes,
                );
                let actual = pixels(&mut image_plan, 0.3);
                let mut gradient = plan(
                    declare(glyph_ramp_gradient(outset, vertical)),
                    "MWI",
                    words(&[("MWI", 0., 4.)]),
                    &bytes,
                );
                let expected = pixels(&mut gradient, 0.3);
                let worst = max_diff(&actual, &expected);
                assert!(
                    worst <= 2,
                    "font-em image vs existing glyph gradient: vertical={vertical}, font={font_size}, outset={outset}, max={worst}"
                );
                assert!(actual.chunks_exact(4).filter(|p| p[3] > 0).count() > 100);
                let mut zero = plan(declare(glyph_ramp_paint(0.0, vertical)), "MWI", words(&[("MWI", 0., 4.)]), &bytes);
                let zero = pixels(&mut zero, 0.3);
                assert_same_alpha(&actual, &zero);
                assert!(
                    max_diff(&actual, &zero) > 8,
                    "fixture must distinguish expanded sampling from the legacy domain"
                );
            }
        }
    }
}

#[test]
fn image_glyph_outset_changes_color_without_expanding_effects_and_offset_is_rigid() {
    let bytes = glyph_ramp_texture(false);
    for (spread, blur) in [(0.0, 0.0), (1.5, 2.0)] {
        let declare = |outset| {
            let mut source = glyph_ramp_body(&bytes, glyph_ramp_paint(outset, false));
            let layer = &mut source["scene"]["value"]["nodes"][0]["style"]["paints"][0];
            layer["spread"] = json!(spread);
            layer["blur"] = json!(blur);
            source
        };
        let mut zero = plan(declare(0.0), "MWI", words(&[("MWI", 0., 4.)]), &bytes);
        let zero = pixels(&mut zero, 0.3);
        let source = declare(0.4);
        let mut grown = plan(source.clone(), "MWI", words(&[("MWI", 0., 4.)]), &bytes);
        let grown = pixels(&mut grown, 0.3);
        assert_same_alpha(&zero, &grown);
        assert!(max_diff(&zero, &grown) > 8);
        let mut shifted_source = source;
        shifted_source["scene"]["value"]["nodes"][0]["style"]["paints"][0]["offset"] = json!([5, -3]);
        let mut shifted = plan(shifted_source, "MWI", words(&[("MWI", 0., 4.)]), &bytes);
        let shifted = pixels(&mut shifted, 0.3);
        for y in 3..SIZE.1 {
            for x in 0..SIZE.0 - 5 {
                let a = ((y * SIZE.0 + x) * 4) as usize;
                let b = (((y - 3) * SIZE.0 + x + 5) * 4) as usize;
                assert!(
                    max_diff(&grown[a..a + 4], &shifted[b..b + 4]) <= 1,
                    "offset must translate color and silhouette together, spread={spread}, blur={blur}"
                );
            }
        }
    }
}

#[test]
fn distance_image_glyph_outset_uses_original_domain_after_contour_displacement() {
    for vertical in [false, true] {
        let bytes = glyph_ramp_texture(vertical);
        for offset in [[0.0, 0.0], [3.0, -2.0]] {
            let declare = |paint| glyph_ramp_distance(glyph_ramp_body(&bytes, paint), offset);
            let mut p = plan(declare(glyph_ramp_paint(0.4, vertical)), "MWI", words(&[("MWI", 0., 4.)]), &bytes);
            let actual = pixels(&mut p, 0.3);
            let mut p = plan(
                declare(glyph_ramp_gradient(0.4, vertical)),
                "MWI",
                words(&[("MWI", 0., 4.)]),
                &bytes,
            );
            let expected = pixels(&mut p, 0.3);
            assert!(
                max_diff(&actual, &expected) <= 2,
                "distance coverage must not reanchor the expanded image domain: vertical={vertical}, offset={offset:?}"
            );
            let mut p = plan(declare(glyph_ramp_paint(0.0, vertical)), "MWI", words(&[("MWI", 0., 4.)]), &bytes);
            let zero = pixels(&mut p, 0.3);
            assert_same_alpha(&actual, &zero);
            assert!(max_diff(&actual, &zero) > 8);
            let (ops, _) = p.record(0.3).unwrap();
            assert!(ops.paths.is_empty(), "distance images must not add a second glyph AA mask");
        }
    }
}
