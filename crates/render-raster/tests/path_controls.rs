use anyhow::{Result, bail};
use render_raster::drawop::DrawOp;
use render_raster::{CapabilityProfile, FrameMedia, PreparedBcf, TextEngine};
use scene_primitives::Resolver;
use serde_json::{Value, json};
use std::sync::Arc;
use tiny_skia::Pixmap;
struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, _: &str, _: i64) -> Result<Arc<Pixmap>> {
        bail!("no media")
    }
}
fn document(path: Value, follower: bool) -> Value {
    let mut children = vec![
        json!({"type":"svg","id":"svg","viewBox":"0 0 100 100","style":{"x":10,"y":20,"width":100,"height":100},"children":[path]}),
    ];
    if follower {
        children.push(json!({"type":"box","id":"pen","style":{"x":0,"y":0,"width":10,"height":10,"background":"#00f"},"follow":{"source":"#line","position":"end"}}));
    }
    json!({"bcut":"0.2","meta":{"width":160,"height":140,"fps":30,"background":"#fff"},"scenes":[{"id":"s","dur":2}],
        "tracks":[{"id":"v","kind":"visual","clips":[{"id":"c","start":0,"end":2,"element":{"type":"box","id":"root","children":children}}]}]})
}
fn line() -> Value {
    json!({"type":"path","id":"line","d":"M10 50 L90 50","stroke":"#f00","strokeWidth":2,"lineCap":"butt"})
}
fn session(doc: Value) -> PreparedBcf {
    PreparedBcf::new(
        Resolver::new(doc, None).unwrap().resolve().unwrap(),
        TextEngine::with_document_fonts(&[]),
        &Default::default(),
        CapabilityProfile::cpu_reference(),
    )
    .unwrap()
}
#[test]
fn trim_and_endpoint_follow_share_source_progress() {
    let mut path = line();
    path["trim"] = json!({"start":0.25,"end":0.75});
    path["animate"] =
        json!({"keyframes":[{"prop":"pathDraw","frames":[{"t":0,"v":0},{"t":2,"v":1}]}]});
    let mut runtime = session(document(path, true));
    let frame = runtime.render_cpu(1.0, &mut NoMedia).unwrap();
    assert_eq!(frame.pixel(60, 70).unwrap().blue(), 255);
    assert_eq!(frame.pixel(30, 70).unwrap().green(), 255); // before the trimmed range
    assert_eq!(frame.pixel(45, 70).unwrap().green(), 0); // red stroke
    let plan = runtime.plan(1.0).unwrap();
    let render_raster::RenderPass::Draw { ops, .. } = &plan.passes[0] else {
        panic!()
    };
    let pen = ops
        .ops
        .iter()
        .find_map(|op| match op {
            DrawOp::FillRect { color, tf, .. } if color[2] == 1.0 && color[0] == 0.0 => Some(tf),
            _ => None,
        })
        .unwrap();
    assert_eq!((pen[4], pen[5]), (55.0, 65.0));
    runtime.render_cpu(0.2, &mut NoMedia).unwrap();
    assert_eq!(
        frame.data(),
        runtime.render_cpu(1.0, &mut NoMedia).unwrap().data()
    );
}
#[test]
fn dash_phase_really_moves_the_gaps() {
    let mut path = line();
    path["dash"] = json!([10, 10]);
    let a = session(document(path.clone(), false))
        .render_cpu(1.0, &mut NoMedia)
        .unwrap();
    path["dashOffset"] = json!(10);
    let b = session(document(path, false))
        .render_cpu(1.0, &mut NoMedia)
        .unwrap();
    assert_eq!(a.pixel(25, 70).unwrap().green(), 0);
    assert_eq!(b.pixel(25, 70).unwrap().green(), 255);
    assert_eq!(b.pixel(35, 70).unwrap().green(), 0);
}
#[test]
fn pencil_passes_and_watercolor_are_seeded_and_clipped() {
    let mut path = line();
    path["d"] = json!("M10 10 L90 10 L90 90 L10 90 Z");
    path["brush"] = json!({"kind":"pencil","seed":7,"roughness":1});
    path["texture"] = json!({"finish":"wash","color":"#2288cc","gap":18,"alpha":0.35,"seed":9});
    let mut runtime = session(document(path, false));
    let frame = runtime.render_cpu(1.0, &mut NoMedia).unwrap();
    assert_eq!(frame.pixel(2, 2).unwrap().red(), 255);
    assert!(frame.pixels().iter().any(|p| p.blue() > p.red()));
    let plan = runtime.plan(1.0).unwrap();
    let render_raster::RenderPass::Draw { ops, .. } = &plan.passes[0] else {
        panic!()
    };
    assert_eq!(
        ops.ops
            .iter()
            .filter(|op| matches!(
                op,
                DrawOp::StrokePath { .. } | DrawOp::StrokePathPaint { .. }
            ))
            .count(),
        3
    );
    runtime.render_cpu(0.0, &mut NoMedia).unwrap();
    assert_eq!(
        frame.data(),
        runtime.render_cpu(1.0, &mut NoMedia).unwrap().data()
    );
}
#[test]
fn follow_rejects_unknown_source_and_recursive_transform_dependencies() {
    let mut doc = document(line(), true);
    doc["tracks"][0]["clips"][0]["element"]["children"][1]["follow"]["source"] = json!("#missing");
    assert!(Resolver::new(doc, None).unwrap().resolve().is_err());
    let mut doc = document(line(), true);
    doc["tracks"][0]["clips"][0]["element"]["children"][0]["follow"] = json!({"source":"#line"});
    assert!(Resolver::new(doc, None).unwrap().resolve().is_err());
}

#[test]
fn local_camera_and_morph_are_shared_by_the_follow_target() {
    let mut path = line();
    path["morphTo"] = json!(["M10 10 L90 90"]);
    path["animate"] = json!({"keyframes":[{"prop":"pathMorph","frames":[{"t":0,"v":0},{"t":2,"v":1}]},
        {"prop":"pathDraw","frames":[{"t":0,"v":0},{"t":2,"v":1}]}]});
    let mut doc = document(path, true);
    let root = doc["tracks"][0]["clips"][0]["element"].clone();
    doc["tracks"][0]["clips"][0]["element"] = json!({"type":"composition","canvas":{"width":160,"height":140,"duration":2},
        "style":{"width":160,"height":140},"camera":[{"t":0,"v":{"x":10,"y":0,"zoom":1}}],"children":root["children"]});
    let mut runtime = session(doc);
    // At t=1 the morphed line is (10,30)->(90,70), halfway at (50,50).
    // Svg offset (10,20), local camera offset (-10,0): marker centre (50,70).
    let frame = runtime.render_cpu(1.0, &mut NoMedia).unwrap();
    assert_eq!(frame.pixel(50, 70).unwrap().blue(), 255);
    assert_eq!(frame.pixel(50, 70).unwrap().red(), 0);
}

#[test]
fn path_geometry_variables_are_resolved_before_command_validation() {
    let mut path = line();
    path["d"] = json!("$vars.shape");
    path["strokeWidth"] = json!("$vars.width");
    let mut doc = document(path, false);
    doc["variables"] = json!([{"id":"shape","type":"string","default":"M10 50 L90 50"},
        {"id":"width","type":"number","default":4}]);
    let mut runtime = session(doc.clone());
    assert_eq!(
        runtime.ir().visual_clips[0].tree.children[0].children[0].stroke_width,
        4.0
    );
    assert_eq!(
        runtime
            .render_cpu(1.0, &mut NoMedia)
            .unwrap()
            .pixel(50, 70)
            .unwrap()
            .green(),
        0
    );
    doc["variables"][0]["default"] = json!("M0 0 R10 10");
    assert!(
        Resolver::new(doc, None)
            .unwrap()
            .resolve()
            .err()
            .unwrap()
            .to_string()
            .starts_with("path-command-unsupported")
    );
}

#[test]
#[cfg(feature = "media")]
fn declared_font_assets_select_their_actual_family() {
    let mut doc = document(line(), false);
    doc["assets"] = json!({"hand":{"type":"font","src":"PermanentMarker-Regular.ttf"}});
    doc["tracks"][0]["clips"][0]["element"] = json!({"type":"text","id":"label","text":"HAND DRAWN",
        "style":{"font":"$assets.hand","fontSize":24}});
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/fonts");
    let assets = render_raster::load_assets(&doc, &root).unwrap();
    let family = assets.inputs.font_families["PermanentMarker-Regular.ttf"].clone();
    assert_eq!(family, "Permanent Marker");
    let render = |doc: Value| {
        let mut resolver = Resolver::new(doc, None).unwrap();
        resolver.set_host_inputs(assets.inputs.clone());
        let ir = resolver.resolve().unwrap();
        assert_eq!(ir.visual_clips[0].tree.style["font"], family);
        PreparedBcf::new(
            ir,
            TextEngine::with_document_fonts(&assets.fonts),
            &Default::default(),
            CapabilityProfile::cpu_reference(),
        )
        .unwrap()
        .render_cpu(1.0, &mut NoMedia)
        .unwrap()
    };
    let referenced = render(doc.clone());
    doc["tracks"][0]["clips"][0]["element"]["style"]["font"] = json!(family);
    assert_eq!(referenced.data(), render(doc).data());
}
