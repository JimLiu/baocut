use render_raster::drawop::{DrawOp, FrameOps, fingerprint};
use render_raster::{FrameRenderer, TextEngine};
use scene_primitives::Resolver;
use serde_json::{Value, json};

fn prepare(element: Value) -> (scene_primitives::Ir, TextEngine, FrameRenderer) {
    let doc = json!({"bcut":"0.2","motionVersion":1,"meta":{"width":640,"height":360,"fps":30},
        "scenes":[{"id":"s","dur":2,"desc":"typography"}],
        "tracks":[{"id":"v","kind":"visual","clips":[{"id":"c","start":0,"end":2,"element":element}]}]});
    let mut ir = Resolver::new(doc, None).unwrap().resolve().unwrap();
    let mut engine = TextEngine::with_document_fonts(&[
        include_bytes!("../assets/fonts/Poppins-Regular.ttf").to_vec(),
        include_bytes!("../assets/fonts/NotoSansSC-Variable.ttf").to_vec(),
    ]);
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    (ir, engine, renderer)
}
fn fills(frame: &FrameOps) -> Vec<([f32; 4], [f32; 6])> {
    frame
        .ops
        .iter()
        .filter_map(|op| match op {
            DrawOp::FillPath { color, tf, .. } => Some((*color, *tf)),
            _ => None,
        })
        .collect()
}

#[test]
fn rich_runs_share_line_layout_and_keep_their_colours() {
    let (ir, mut engine, renderer) = prepare(
        json!({"type":"text","style":{"font":"Poppins","fontSize":40,"width":400,"textWrap":"word","textAlign":"left"},
        "runs":[{"text":"Hello ","style":{"color":"#ff0000"}},
                {"text":"world","style":{"color":"#0000ff","fontSize":60}}]}),
    );
    let node = &ir.visual_clips[0].tree;
    assert_eq!(node.text.as_deref(), Some("Hello world"));
    assert_eq!(node.text_block.as_ref().unwrap().lines.len(), 1);
    assert_eq!(node.frame.h, 75.0);
    let frame = renderer.record(&ir, &mut engine, 0.5);
    let colours = fills(&frame);
    assert!(colours.iter().any(|(c, _)| c[0] == 1.0 && c[2] == 0.0));
    assert!(colours.iter().any(|(c, _)| c[2] == 1.0 && c[0] == 0.0));
}

#[test]
fn tracking_uses_authored_pixels_instead_of_ems() {
    let (_, mut engine, _) = prepare(json!({"type":"text","text":"x"}));
    let plain = engine.shape_spaced("ABC", "Poppins", 40.0, 400, false, 0.0);
    let spaced = engine.shape_spaced("ABC", "Poppins", 40.0, 400, false, 2.0);
    assert!(
        (spaced.width - plain.width - 6.0).abs() < 0.1,
        "{} → {}",
        plain.width,
        spaced.width
    );
}

#[test]
fn reveal_keeps_original_layout_and_glyph_positions() {
    let (ir, mut engine, renderer) = prepare(json!({"type":"text","text":"ABCD",
        "style":{"font":"Poppins","fontSize":48,"width":300,"textWrap":"none"},
        "animate":{"keyframes":[{"prop":"textReveal","frames":[{"t":0,"v":0},{"t":1,"v":1}]}]}}));
    let half = fills(&renderer.record(&ir, &mut engine, 0.5));
    let full = fills(&renderer.record(&ir, &mut engine, 1.0));
    assert_eq!(half.len(), 2);
    assert_eq!(full.len(), 4);
    assert_eq!(half, full[..2]);
    let before = fingerprint(&renderer.record(&ir, &mut engine, 0.5));
    renderer.record(&ir, &mut engine, 1.8);
    assert_eq!(before, fingerprint(&renderer.record(&ir, &mut engine, 0.5)));
}

#[test]
fn text_content_is_discrete_even_when_it_looks_like_a_colour() {
    let (ir, mut engine, renderer) = prepare(json!({"type":"text","text":"#ff0000",
        "style":{"font":"Poppins","fontSize":32},
        "animate":{"keyframes":[{"prop":"text","frames":[{"t":0,"v":"#ff0000"},{"t":1,"v":"#0000ff","ease":"easeOutBack"}]}]}}));
    let initial = fingerprint(&renderer.record(&ir, &mut engine, 0.0));
    assert_eq!(
        initial,
        fingerprint(&renderer.record(&ir, &mut engine, 0.9))
    );
    assert_ne!(
        initial,
        fingerprint(&renderer.record(&ir, &mut engine, 1.0))
    );
}

#[test]
fn variable_weight_changes_outlines_without_changing_the_layout_box() {
    let (ir, mut engine, renderer) = prepare(json!({"type":"text","text":"图像",
        "style":{"font":"Noto Sans SC","fontSize":64,"textWrap":"none"},
        "animate":{"keyframes":[{"prop":"fontWeight","frames":[{"t":0,"v":100},{"t":1,"v":900}]}]}}));
    let frame = ir.visual_clips[0].tree.frame;
    let light = fingerprint(&renderer.record(&ir, &mut engine, 0.0));
    let heavy = fingerprint(&renderer.record(&ir, &mut engine, 1.0));
    assert_ne!(light, heavy);
    assert_eq!(ir.visual_clips[0].tree.frame.w, frame.w);
    assert_eq!(ir.visual_clips[0].tree.frame.h, frame.h);
}

#[test]
fn changed_content_keeps_its_base_wrapping_during_tracking_animation() {
    let (ir, mut engine, renderer) = prepare(json!({"type":"text","text":"A",
    "style":{"font":"Poppins","fontSize":40,"width":180,"lineHeight":50,"textWrap":"word"},
    "animate":{"keyframes":[
        {"prop":"text","frames":[{"t":0,"v":"A"},{"t":1,"v":"Alpha Beta Gamma"}]},
        {"prop":"letterSpacing","frames":[{"t":1,"v":0},{"t":2,"v":8}]}
    ]}}));
    let lines = |frame: FrameOps| {
        fills(&frame)
            .into_iter()
            .map(|(_, tf)| tf[5].to_bits())
            .collect::<std::collections::BTreeSet<_>>()
    };
    assert_eq!(lines(renderer.record(&ir, &mut engine, 1.01)).len(), 3);
    assert_eq!(lines(renderer.record(&ir, &mut engine, 1.9)).len(), 3);
}

#[test]
fn gradient_strokes_are_recorded_before_glyph_fills() {
    let (ir, mut engine, renderer) = prepare(json!({"type":"text","text":"ABC",
        "style":{"font":"Poppins","fontSize":48,"textStroke":{"width":4,
            "paint":{"kind":"linear","angle":90,"stops":[{"color":"#ff0000"},{"color":"#0000ff"}]}}}}));
    let frame = renderer.record(&ir, &mut engine, 0.0);
    let strokes: Vec<_> = frame
        .ops
        .iter()
        .enumerate()
        .filter_map(|(i, op)| matches!(op, DrawOp::StrokePathPaint { .. }).then_some(i))
        .collect();
    let first_fill = frame
        .ops
        .iter()
        .position(|op| matches!(op, DrawOp::FillPath { .. }))
        .unwrap();
    assert_eq!(strokes.len(), 3);
    assert!(strokes.iter().all(|i| *i < first_fill));
}

/// 内容轨 `text` 换成更长的字符串、又没写 `width`：元素盒按所有关键帧字符串里
/// 最宽的一个定，长字符串从 `style.x` 起笔而不是居中溢出到盒子左边（常驻 HUD 的
/// 章节名）。写了 `width` 的照作者的宽度。
#[test]
fn a_text_track_sizes_the_auto_box_by_its_widest_string() {
    let hud = |style: Value| {
        json!({"type":"text","id":"hud","text":"IGNIS","style":style,
            "animate":{"keyframes":[{"prop":"text","frames":[
                {"t":0,"v":"IGNIS"},{"t":1,"v":"XIII · SILICIVM"},{"t":1.5,"v":"II"}]}]}})
    };
    let min_x = |frame: FrameOps| {
        fills(&frame)
            .into_iter()
            .map(|(_, tf)| tf[4])
            .fold(f32::INFINITY, f32::min)
    };
    for style in [
        json!({"x":70,"y":60,"font":"Poppins","fontSize":26}),
        json!({"x":70,"y":60,"font":"Poppins","fontSize":26,"textWrap":"none","textAlign":"left"}),
    ] {
        let (ir, mut engine, renderer) = prepare(hud(style.clone()));
        let long = engine.shape_spaced("XIII · SILICIVM", "Poppins", 26.0, 400, false, 0.0);
        let frame = ir.visual_clips[0].tree.frame;
        assert!(
            (frame.w - long.width).abs() < 0.01,
            "{style}: 盒宽 {} vs {}",
            frame.w,
            long.width
        );
        // 旧行为：盒宽按初始的短串定，长串居中后从盒子左缘外面起笔。
        let left = frame.x as f32;
        let at_long = min_x(renderer.record(&ir, &mut engine, 1.2));
        assert!(
            at_long >= left - 1.0,
            "{style}: 长串起笔 {at_long} < 盒左 {left}"
        );
        let at_short = min_x(renderer.record(&ir, &mut engine, 0.5));
        if style.get("textAlign").is_some() {
            assert!((at_short - at_long).abs() < 1.0, "{style}: 靠左时同一起笔");
        } else {
            assert!(
                at_short > at_long + 1.0,
                "{style}: 旧单行路径短串在宽盒里居中"
            );
        }
    }
    // 写了 width：盒宽不动。
    let (ir, _, _) = prepare(hud(
        json!({"x":70,"y":60,"font":"Poppins","fontSize":26,"width":90}),
    ));
    assert_eq!(ir.visual_clips[0].tree.frame.w, 90.0);
}
