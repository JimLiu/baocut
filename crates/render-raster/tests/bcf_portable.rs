//! BCF 无宿主 I/O 路径：本文件同时以默认和 --no-default-features 构建运行。

use anyhow::{Result, bail};
use render_raster::{CapabilityProfile, FrameMedia, PreparedBcf, RenderPass, TextEngine};
use scene_primitives::{HostInputs, resolve::Resolver};
use serde_json::{Value, json};
use std::sync::Arc;
use tiny_skia::Pixmap;

struct NoMedia;

impl FrameMedia for NoMedia {
    fn frame(&mut self, id: &str, _: i64) -> Result<Arc<Pixmap>> {
        bail!("不应请求媒体 {id}")
    }
}

fn doc(element: Value) -> Value {
    json!({
        "bcut":"0.2", "motionVersion":1,
        "meta":{"width":96,"height":64,"fps":30,"background":"#000000"},
        "scenes":[{"id":"a","dur":2}],
        "tracks":[{"id":"visual","kind":"visual","clips":[{
            "id":"c","start":0,"end":2,"element":element
        }]}]
    })
}

fn session(document: Value, inputs: HostInputs) -> PreparedBcf {
    let mut resolver = Resolver::new(document, None).unwrap();
    resolver.set_host_inputs(inputs);
    PreparedBcf::new(
        resolver.resolve().unwrap(),
        TextEngine::with_document_fonts(&[]),
        &Default::default(),
        CapabilityProfile::cpu_reference(),
    )
    .unwrap()
}

#[test]
fn random_access_keeps_effects_and_identical_pixels() {
    let document = doc(json!({
        "id":"plate","type":"box",
        "style":{"x":8,"y":8,"width":32,"height":32,"background":"#ff0000"},
        "effects":[{"preset":"filter.grayscale","presetVersion":1}],
        "animate":{"keyframes":[{"prop":"x","frames":[
            {"t":0,"v":0},{"t":1,"v":40}
        ]}]}
    }));
    let mut runtime = session(document, HostInputs::default());
    let start = runtime.render_cpu(0.0, &mut NoMedia).unwrap();
    let plan = runtime.plan(0.7).unwrap();
    assert!(
        plan.passes
            .iter()
            .any(|pass| matches!(pass, RenderPass::Filter { .. }))
    );
    let expected = runtime.render_cpu(0.7, &mut NoMedia).unwrap();
    assert!(start.data() != expected.data(), "不同时间应有不同位置");
    // 画面实际经过 grayscale；不是只创建了没执行的 Filter pass。
    let colored = expected.pixels().iter().find(|p| p.red() > 0).unwrap();
    assert_eq!(colored.red(), colored.green());
    assert_eq!(colored.green(), colored.blue());
    for time in [1.5, 0.1, 1.0, 0.7, 0.0] {
        runtime.render_cpu(time, &mut NoMedia).unwrap();
    }
    assert!(expected.data() == runtime.render_cpu(0.7, &mut NoMedia).unwrap().data());
}

#[test]
fn nested_backdrop_and_mask_remain_portable_and_seekable() {
    let document = doc(
        json!({"type":"box","style":{"width":96,"height":64},"children":[
            {"id":"red","type":"box","style":{"x":0,"width":96,"height":64,"background":"#ff0000"}},
            {"id":"glass","type":"box","style":{"x":24,"width":48,"height":64,"mask":{"source":"#matte"}},
             "backdropEffects":[{"preset":"filter.grayscale"}],
             "animate":{"keyframes":[{"prop":"x","frames":[{"t":0,"v":0},{"t":2,"v":24}]}]}} ,
            {"id":"matte","type":"box","style":{"x":0,"width":96,"height":64,"background":"#ffffff"},
             "effects":[{"preset":"filter.blur","params":{"radius":0.02}}]}
        ]}),
    );
    let mut runtime = session(document, HostInputs::default());
    let expected = runtime.render_cpu(0.7, &mut NoMedia).unwrap();
    assert_ne!(
        runtime.render_cpu(0.0, &mut NoMedia).unwrap().data(),
        expected.data()
    );
    for t in [1.8, 0.1, 1.0] {
        runtime.render_cpu(t, &mut NoMedia).unwrap();
    }
    assert_eq!(
        runtime.render_cpu(0.7, &mut NoMedia).unwrap().data(),
        expected.data()
    );
    let smaller = runtime.render_cpu_width(0.7, &mut NoMedia, 48).unwrap();
    assert_eq!(smaller.width(), 48);
    assert_eq!(smaller.pixel(2, 16).unwrap().red(), 255);
    let middle = smaller.pixel(24, 16).unwrap();
    assert_eq!(middle.red(), middle.green());
    assert_eq!(middle.green(), middle.blue());
}

#[test]
fn media_is_requested_at_resolved_source_time_through_the_host_boundary() {
    struct Frames(Vec<(String, i64)>);
    impl FrameMedia for Frames {
        fn frame(&mut self, id: &str, time: i64) -> Result<Arc<Pixmap>> {
            self.0.push((id.to_owned(), time));
            let mut frame = Pixmap::new(16, 16).unwrap();
            frame.fill(tiny_skia::Color::WHITE);
            Ok(Arc::new(frame))
        }
    }
    let mut document = doc(json!({
        "id":"movie","type":"video","src":"$assets.movie",
        "mediaStart":2,"playbackRate":2,
        "style":{"width":96,"height":64}
    }));
    document["assets"] = json!({"movie":{"type":"video","src":"movie.mp4"}});
    let mut inputs = HostInputs::default();
    inputs.insert_video("movie", 16.0, 16.0, 10.0, 30.0);
    let mut runtime = session(document, inputs);
    let mut frames = Frames(Vec::new());
    runtime.render_cpu(0.5, &mut frames).unwrap();
    assert_eq!(frames.0, vec![("movie".to_owned(), 3000)]);
}

#[test]
fn invalid_seek_times_are_rejected_before_building_a_frame() {
    let mut runtime = session(doc(json!({"type":"box"})), HostInputs::default());
    for time in [f64::NAN, f64::INFINITY, -0.1] {
        assert!(
            runtime
                .plan(time)
                .unwrap_err()
                .to_string()
                .contains("bcf-time-invalid")
        );
    }
}

#[test]
fn preview_resolution_preserves_coordinates_and_does_not_change_export() {
    let mut runtime = session(
        doc(json!({"type":"group","children":[
            {"type":"box","style":{"x":16,"y":16,"width":32,"height":32,"background":"#ff0000"}}
        ]})),
        HostInputs::default(),
    );
    let original = runtime.render_cpu(0.0, &mut NoMedia).unwrap();
    let preview = runtime.render_cpu_width(0.0, &mut NoMedia, 48).unwrap();
    assert_eq!((preview.width(), preview.height()), (48, 32));
    assert_eq!(preview.pixel(12, 12).unwrap().red(), 255);
    assert_eq!(preview.pixel(2, 2).unwrap().red(), 0);
    assert_eq!(runtime.ir().w, 96.0);
    assert!(original.data() == runtime.render_cpu(0.0, &mut NoMedia).unwrap().data());
}

#[test]
fn element_matte_and_surface_transition_survive_portable_planning() {
    let mut document = doc(json!({
        "type":"group","children":[
            {"type":"box","id":"fill","style":{
                "width":96,"height":64,"background":"#ff0000","mask":{"source":"#matte"}
            }},
            {"type":"box","id":"matte","style":{
                "width":24,"height":64,"background":"#ffffff"
            }}
        ]
    }));
    let mut runtime = session(document.clone(), HostInputs::default());
    let image = runtime.render_cpu(0.0, &mut NoMedia).unwrap();
    assert_eq!(image.pixel(10, 10).unwrap().red(), 255);
    assert_eq!(image.pixel(60, 10).unwrap().red(), 0);

    document["tracks"][0]["clips"][0]["end"] = json!(1);
    document["tracks"][0]["clips"][0]["transitionOut"] = json!({
        "preset":"transition.crossfade","presetVersion":1,"dur":0.4
    });
    document["tracks"][0]["clips"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id":"second","start":1,"end":2,"element":{
                "type":"box","style":{"width":96,"height":64,"background":"#0000ff"}
            }
        }));
    let mut runtime = session(document, HostInputs::default());
    let plan = runtime.plan(1.0).unwrap();
    assert!(
        plan.passes
            .iter()
            .any(|pass| matches!(pass, RenderPass::Transition { .. }))
    );
    let image = runtime.render_cpu(1.0, &mut NoMedia).unwrap();
    let middle = image.pixel(10, 10).unwrap();
    assert!(middle.red() > 100 && middle.blue() > 100);
}

#[cfg(feature = "media")]
#[test]
fn portable_session_matches_the_existing_export_entry() {
    use render_raster::{FramePlanner, FrameRenderer, LoadedAssets, MediaStore};
    let document = doc(json!({
        "type":"box","style":{"width":32,"height":32,"background":"#80ff20"},
        "effects":[{"preset":"filter.blur","presetVersion":1,"params":{"radius":0.02}}]
    }));
    let mut portable = session(document.clone(), HostInputs::default());
    let mut ir = Resolver::new(document, None).unwrap().resolve().unwrap();
    let assets = Arc::new(LoadedAssets::default());
    let mut text = TextEngine::with_document_fonts(&assets.fonts);
    let renderer = FrameRenderer::new_with_assets(&mut ir, &mut text, &assets).unwrap();
    let planner = FramePlanner::cpu_with_assets(&ir, &assets).unwrap();
    let mut media = MediaStore::new(assets, ir.fps);
    for time in [0.0, 0.4, 1.8] {
        let existing = planner
            .render(&renderer, &ir, &mut text, &mut media, time)
            .unwrap();
        let shared = portable.render_cpu(time, &mut NoMedia).unwrap();
        assert!(
            existing.data() == shared.data(),
            "时间 {time} 的旧导出与共享会话不同"
        );
    }
}

#[test]
fn missing_lottie_is_rejected_during_preparation() {
    let mut document = doc(json!({"id":"l","type":"lottie","src":"$assets.anim"}));
    document["assets"] = json!({"anim":{"type":"lottie","src":"anim.json"}});
    let mut resolver = Resolver::new(document, None).unwrap();
    let mut inputs = HostInputs::default();
    inputs.insert_lottie("anim", 96.0, 64.0, vec![0, 33, 67]);
    resolver.set_host_inputs(inputs);
    let result = PreparedBcf::new(
        resolver.resolve().unwrap(),
        TextEngine::with_document_fonts(&[]),
        &Default::default(),
        CapabilityProfile::cpu_reference(),
    );
    assert!(
        result
            .err()
            .unwrap()
            .to_string()
            .contains("lottie-source-missing")
    );
}
