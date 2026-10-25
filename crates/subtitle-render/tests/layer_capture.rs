//! Local source capture is tested with real glyphs, independent whole-canvas
//! controls, and a projection that brings initially off-canvas ink into view.
use caption_scene::{Presentation, parse_style};
use render_raster::effects::material_plan::{MaterialCommand, MaterialSource};
use render_raster::{TextEngine, drawop::DrawOp};
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan};

fn constant(value: impl Into<Value>) -> Value {
    json!({"kind":"constant","value":value.into()})
}
fn read(path: &str) -> Value {
    json!({"op":"read","path":path})
}
fn call(function: &str, args: Vec<Value>) -> Value {
    json!({"op":"call","function":function,"args":args})
}
fn expression(value: Value) -> Value {
    json!({"kind":"expression","expression":value})
}
fn domain(rect: [i32; 4]) -> Value {
    json!({"x":constant(rect[0]),"y":constant(rect[1]),"width":constant(rect[2]),"height":constant(rect[3])})
}
fn surface_domain() -> Value {
    json!({"x":constant(0),"y":constant(0),
        "width":expression(read("material.surfaceWidth")),
        "height":expression(read("material.surfaceHeight"))})
}
fn body(rect: Option<[i32; 4]>) -> Value {
    let mut body: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/gaussian-axis.json"
    ))
    .unwrap();
    let scene = &mut body["scene"]["value"];
    scene["materials"] = json!([]);
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-render-layers/1"),
            json!("caption-layer-capture/1"),
            json!("caption-affine-over/1"),
            json!("caption-gaussian-uv/1"),
        ]);
    scene["renderLayers"] = json!([{"id":"ink","source":{"kind":"nodes","nodeIds":["caption"]},
        "materials":[],"blend":"source-over"}]);
    if let Some(rect) = rect {
        scene["renderLayers"][0]["capture"] =
            json!({"contextNodeId":"caption","rect":domain(rect)});
    }
    body
}
fn plan(body: Value) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Light".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "capture".into(),
    )
    .unwrap()
}
fn matrix(values: [f64; 6]) -> Value {
    json!(values.map(constant))
}

#[test]
fn full_canvas_capture_preserves_legacy_pixels_and_local_placement_outputs() {
    let legacy = plan(body(None)).render(0.2).unwrap().rgba;
    let full = plan(body(Some([0, 0, 160, 90]))).render(0.2).unwrap().rgba;
    assert_eq!(legacy, full);
    let mut scene = plan(body(Some([20, 10, 120, 70])));
    let (ops, _) = scene.record(0.2).unwrap();
    assert_eq!((ops.bitmaps[0].width, ops.bitmaps[0].height), (120, 70));
    let DrawOp::DrawEmissiveBitmap { tf, .. } = ops.ops[0] else {
        panic!("capture bitmap required")
    };
    assert_eq!(tf, [1.0, 0.0, 0.0, 1.0, 20.0, 10.0]);
    let rendered = scene.render(0.2).unwrap().rgba;
    assert!(rendered.chunks_exact(4).any(|p| p[3] > 0));
    let (outputs, _) = scene.render_outputs(0.2).unwrap();
    assert_eq!(outputs.len(), 1);
    assert_eq!(outputs[0].rgba.len(), 160 * 90 * 4);
    assert_eq!(outputs[0].rgba, rendered);
}

#[test]
fn capture_rasterizes_off_canvas_ink_before_projection_brings_it_back() {
    let mut captured = body(Some([-80, 0, 160, 90]));
    captured["scene"]["value"]["layout"]["x"] = json!({"value":-40,"basis":"absolute"});
    captured["scene"]["value"]["renderLayers"][0]["materials"] = json!([{
        "kind":"affine-over","id":"project","contextNodeId":"caption",
        "sampling":{"input":surface_domain(),"output":surface_domain()},
        "foreground":matrix([1.,0.,0.,1.,0.,0.]),
        "background":matrix([1.,0.,0.,1.,-0.5,0.]),
        "backgroundOpacity":constant(1),"backgroundRgbScale":constant(1),"boundary":"transparent"
    }]);
    let pixels = plan(captured.clone()).render(0.2).unwrap().rgba;
    assert!(
        pixels.chunks_exact(4).any(|p| p[3] > 0),
        "off-canvas source must survive local capture"
    );
    captured["scene"]["value"]["renderLayers"][0]
        .as_object_mut()
        .unwrap()
        .remove("capture");
    let cropped_first = plan(captured).render(0.2).unwrap().rgba;
    assert!(
        cropped_first.iter().all(|v| *v == 0),
        "whole-canvas source is the negative control"
    );
}

#[test]
fn material_surface_fields_do_not_replace_global_canvas_or_layout_context() {
    let mut body = body(Some([-10, 5, 120, 70]));
    let ratio = |origin, extent, canvas| {
        expression(call(
            "div",
            vec![call("add", vec![read(origin), read(extent)]), read(canvas)],
        ))
    };
    body["scene"]["value"]["renderLayers"][0]["materials"] = json!([
        {"kind":"gaussian-axis","id":"x","contextNodeId":"caption","axis":"x",
            "samples":constant(0),"stepUv":ratio("material.surfaceX","material.surfaceWidth","canvas.width"),
            "sigmaUv":constant(0),"gamma":1,"boundary":"replicate"},
        {"kind":"gaussian-axis","id":"y","contextNodeId":"caption","axis":"y",
            "samples":constant(0),"stepUv":ratio("material.surfaceY","material.surfaceHeight","canvas.height"),
            "sigmaUv":constant(0),"gamma":1,"boundary":"replicate"}]);
    let (frame, _) = plan(body).record_material_plan(0.2).unwrap();
    assert_eq!((frame.width, frame.height), (160, 90));
    let layer = &frame.layers[0];
    let capture = layer.capture.unwrap();
    assert_eq!(capture.origin, [-10, 5]);
    assert_eq!((capture.width, capture.height), (120, 70));
    let MaterialSource::Draw(source) = &layer.source else {
        panic!("draw source required")
    };
    assert!(!source.ops.is_empty());
    let MaterialCommand::Gaussian(x) = &layer.materials[0] else {
        panic!("Gaussian required")
    };
    let MaterialCommand::Gaussian(y) = &layer.materials[1] else {
        panic!("Gaussian required")
    };
    assert_eq!((x.output.width, x.output.height), (120, 70));
    assert!((x.step_pixels - 82.5).abs() < 1e-12);
    assert!((y.step_pixels - (75.0 / 90.0 * 70.0)).abs() < 1e-12);
}

#[test]
fn dynamic_capture_dimensions_are_resampled_for_reverse_seek() {
    let mut body = body(Some([0, 0, 160, 90]));
    body["scene"]["value"]["renderLayers"][0]["capture"]["rect"]["width"] = json!({
        "kind":"keyframes","clock":{"unit":"page","origin":"start","duration":{"kind":"unit-span"}},
        "interpolation":"step","keys":[{"at":0,"value":100},{"at":0.5,"value":120}],
        "fill":{"before":"hold","after":"hold"}});
    let mut scene = plan(body);
    let (first, _) = scene.record(0.2).unwrap();
    let (second, _) = scene.record(2.2).unwrap();
    let (again, _) = scene.record(0.2).unwrap();
    assert_eq!(first.bitmaps[0].width, 100);
    assert_eq!(second.bitmaps[0].width, 120);
    assert_eq!(
        render_raster::fingerprint(&first),
        render_raster::fingerprint(&again)
    );
}

#[test]
fn captured_component_emission_survives_placement_and_screen_output() {
    let mut body = body(Some([20, 10, 120, 70]));
    body["scene"]["value"]["renderLayers"][0]["blend"] = json!("screen");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-noisy-sweep/1"));
    body["scene"]["value"]["renderLayers"][0]["materials"] = json!([{
        "kind":"gaussian-uv","id":"gain","contextNodeId":"caption",
        "sampling":{"input":surface_domain(),"output":surface_domain()},
        "samples":constant(0),"stepUv":[constant(0),constant(0)],"sigmaUv":constant(0),
        "rgbGain":constant(2),"boundary":"replicate"},
        {"kind":"noisy-sweep","id":"mask","contextNodeId":"caption","domain":surface_domain(),
            "position":constant(2),"maskScale":[1,1],"reveal":true,"uvY":"down"}]);
    let (outputs, _) = plan(body).render_outputs(0.2).unwrap();
    assert_eq!(
        outputs[0].blend,
        render_raster::drawop::AssociatedBlend::Screen
    );
    assert!(
        outputs[0].rgba.chunks_exact(4).any(|p| p[0] > p[3]),
        "emission must not be clamped to alpha"
    );
}

#[test]
fn capture_memory_budget_is_checked_before_large_source_rasterization() {
    let error = plan(body(Some([0, 0, 4096, 4096])))
        .record(0.2)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("CAPTION_BUDGET_EXCEEDED: capture surfaces"),
        "{error}"
    );
}

#[test]
fn independent_capture_layers_keep_their_own_sizes_and_output_planes() {
    let mut body = body(Some([20, 10, 120, 70]));
    let first = plan(body.clone()).render_outputs(0.2).unwrap().0[0]
        .rgba
        .clone();
    let mut other = body["scene"]["value"]["renderLayers"][0].clone();
    other["id"] = json!("other");
    other["capture"]["rect"] = domain([40, 15, 80, 60]);
    body["scene"]["value"]["renderLayers"]
        .as_array_mut()
        .unwrap()
        .push(other);
    let mut scene = plan(body);
    let (ops, _) = scene.record(0.2).unwrap();
    assert_eq!((ops.bitmaps[0].width, ops.bitmaps[0].height), (120, 70));
    assert_eq!((ops.bitmaps[1].width, ops.bitmaps[1].height), (80, 60));
    let (outputs, _) = scene.render_outputs(0.2).unwrap();
    assert_eq!(outputs.len(), 2);
    assert_eq!(outputs[0].rgba, first);
    assert!(
        outputs
            .iter()
            .all(|output| output.rgba.len() == 160 * 90 * 4
                && output.rgba.chunks_exact(4).any(|p| p[3] > 0))
    );
}

#[test]
fn dynamically_invalid_capture_dimensions_fail_without_rounding_or_reusing() {
    for value in [0.0, 1.5, 4097.0] {
        let mut body = body(Some([0, 0, 160, 90]));
        body["scene"]["value"]["renderLayers"][0]["capture"]["rect"]["width"] =
            expression(json!({"op":"literal","type":"length","value":value}));
        let error = plan(body).record(0.2).unwrap_err().to_string();
        assert!(
            error.contains("CAPTION_MATERIAL_INVALID"),
            "{value}: {error}"
        );
    }
}

fn projected_paint_body(paint: Value) -> Value {
    let mut body = body(Some([-80, 0, 160, 90]));
    let scene = &mut body["scene"]["value"];
    scene["layout"]["x"] = json!({"value":-40,"basis":"absolute"});
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-paint-stack/1"),
            json!("caption-paint-effects/1"),
            json!("caption-paint-coverage/1"),
            json!("caption-paint-mask/1"),
            json!("caption-image-paint/1"),
        ]);
    scene["nodes"][0]["style"]["paints"] = json!([paint]);
    scene["renderLayers"][0]["materials"] = json!([{
        "kind":"affine-over","id":"project","contextNodeId":"caption",
        "sampling":{"input":surface_domain(),"output":surface_domain()},
        "foreground":matrix([1.,0.,0.,1.,0.,0.]),
        "background":matrix([1.,0.,0.,1.,-0.5,0.]),
        "backgroundOpacity":constant(1),"backgroundRgbScale":constant(1),"boundary":"transparent"}]);
    body
}

#[test]
fn off_canvas_blur_coverage_and_matte_paints_survive_capture_before_projection() {
    let mut paints = vec![
        json!({"id":"blur","paint":{"kind":"solid","color":"#FF0000"},"unit":"px","blur":1.25}),
        json!({"id":"coverage","paint":{"kind":"solid","color":"#FF0000"},"unit":"px","coverage":{"lo":0.1,"hi":0.5}}),
        json!({"id":"matte","paint":{"kind":"solid","color":"#FF0000"},"unit":"px","blur":1.25,"mask":{"kind":"glyph-fill"}}),
    ];
    for paint in paints.drain(..) {
        let mut body = projected_paint_body(paint.clone());
        let captured = plan(body.clone()).render(0.2).unwrap().rgba;
        assert!(
            captured.chunks_exact(4).any(|p| p[0] > 0 && p[3] > 0),
            "paint={paint}"
        );
        body["scene"]["value"]["renderLayers"][0]
            .as_object_mut()
            .unwrap()
            .remove("capture");
        let control = plan(body).render(0.2).unwrap().rgba;
        assert!(
            control.iter().all(|v| *v == 0),
            "whole-canvas source must be empty, paint={paint}"
        );
    }
}

#[test]
fn off_canvas_decoded_image_paint_is_preserved_with_and_without_blur() {
    use sha2::{Digest, Sha256};
    let bytes = tiny_skia::Pixmap::from_vec(
        vec![255, 0, 0, 255],
        tiny_skia::IntSize::from_wh(1, 1).unwrap(),
    )
    .unwrap()
    .encode_png()
    .unwrap();
    let digest = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    for blur in [0.0, 1.25] {
        let mut body = projected_paint_body(json!({"id":"texture","unit":"px","blur":blur,
            "paint":{"kind":"image","resourceId":"texture","uvTransform":[1,0,0,1,0,0],
                "space":"glyph-normalized","wrap":"clamp","filter":"nearest"}}));
        body["scene"]["value"]["resources"] = json!([{"id":"texture","assetRef":{"id":"red-fixture","revision":"1"},"contentHash":format!("sha256:{digest}")}]);
        let mut captured = plan(body.clone());
        captured
            .load_resources(|r| (r.id == "texture").then(|| bytes.clone()))
            .unwrap();
        let captured = captured.render(0.2).unwrap().rgba;
        assert!(
            captured.chunks_exact(4).any(|p| p[0] > 0 && p[3] > 0),
            "blur={blur}"
        );
        body["scene"]["value"]["renderLayers"][0]
            .as_object_mut()
            .unwrap()
            .remove("capture");
        let mut control = plan(body);
        control
            .load_resources(|r| (r.id == "texture").then(|| bytes.clone()))
            .unwrap();
        assert!(
            control.render(0.2).unwrap().rgba.iter().all(|v| *v == 0),
            "blur={blur}"
        );
    }
}

#[test]
fn expanded_paint_scratch_is_bounded_even_when_capture_texture_is_tiny() {
    let mut body = body(Some([76, 41, 8, 8]));
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-paint-stack/1"),
            json!("caption-paint-effects/1"),
        ]);
    scene["layout"]["width"] = json!({"value":10000,"basis":"absolute"});
    scene["nodes"][0]["style"]["fontSize"] = json!({"value":512,"basis":"absolute"});
    scene["nodes"][0]["style"]["paints"] = json!([{
        "id":"expanded","paint":{"kind":"solid","color":"#FF0000"},"unit":"em","blur":0.6}]);
    let error = plan(body).record(0.2).unwrap_err().to_string();
    assert!(
        error.contains("CAPTION_BUDGET_EXCEEDED") && error.contains("image paint surfaces"),
        "{error}"
    );
}
