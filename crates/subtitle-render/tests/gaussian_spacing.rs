use caption_scene::{Presentation, parse_style};
use render_raster::{TextEngine, effects::material_plan::MaterialCommand};
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan};

fn fixture() -> Value {
    let mut body: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/gaussian-axis.json"
    ))
    .unwrap();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gaussian-spacing-ramp/1"));
    let c = |v: f64| json!({"kind":"constant","value":v});
    let m = &mut scene["materials"][0];
    m["samples"] = c(5.0);
    m["axis"] = json!("y");
    m["spacingRamp"] = json!({"domain":{"x":c(0.0),"y":c(0.0),"width":c(160.0),"height":c(90.0)},
        "axis":"y","start":{"kind":"keyframes","clock":{"unit":"page","origin":"start","duration":{"kind":"unit-span"}},
        "keys":[{"at":0,"value":0.7},{"at":1,"value":-0.7}],"fill":{"before":"hold","after":"hold"}},
        "end":c(0.8),"reverse":false,"evaluation":"previous-sample"});
    body
}
fn plan(body: Value) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Spatial".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "spacing".into(),
    )
    .unwrap()
}
#[test]
fn dynamic_ramp_survives_shared_plan_resolution_and_seeks_deterministically() {
    let mut p = plan(fixture());
    let first = p.render(0.1).unwrap().rgba;
    let later = p.render(3.9).unwrap().rgba;
    assert_ne!(first, later);
    assert_eq!(first, p.render(0.1).unwrap().rgba);
    let (frame, _) = p.record_material_plan(0.1).unwrap();
    let command = &frame.layers[0].materials[0];
    let MaterialCommand::Gaussian(pass) = command else {
        panic!("Gaussian command missing")
    };
    let ramp = pass.spacing_ramp.unwrap();
    assert!(ramp.previous_sample);
    assert!(ramp.start > 0.6);
    assert_eq!(ramp.domain, [0.0, 0.0, 160.0, 90.0]);
}
#[test]
fn dynamically_invalid_ramp_is_rejected_before_returning_pixels_or_gpu_commands() {
    let mut b = fixture();
    b["scene"]["value"]["materials"][0]["spacingRamp"]["end"] =
        json!({"kind":"expression","expression":{"op":"literal","type":"scalar","value":-1}});
    let mut p = plan(b);
    assert!(
        p.render(0.1)
            .err()
            .expect("invalid ramp must fail")
            .to_string()
            .contains("CAPTION_MATERIAL_INVALID")
    );
    assert!(p.record_material_plan(0.1).is_err());
}

fn sampled_fixture() -> Value {
    let mut body = fixture();
    let c = |value: f64| json!({"kind":"constant","value":value});
    let domain =
        |x: f64, y: f64, w: f64, h: f64| json!({"x":c(x),"y":c(y),"width":c(w),"height":c(h)});
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gaussian-sampling/1"));
    let m = &mut body["scene"]["value"]["materials"][0];
    m["sampling"] =
        json!({"input":domain(0.0,10.0,160.0,50.0),"output":domain(20.25,10.75,100.5,65.5)});
    m["spacingRamp"]["sampleOrder"] = json!("positive-first");
    body
}
#[test]
fn source_texel_dimensions_drive_uv_distances_and_output_quad_clips_in_both_plans() {
    let mut p = plan(sampled_fixture());
    let (frame, _) = p.record_material_plan(0.1).unwrap();
    let MaterialCommand::Gaussian(pass) = &frame.layers[0].materials[0] else {
        panic!("Gaussian command missing")
    };
    assert_eq!(pass.sampling.unwrap().input, [0, 10, 160, 50]);
    assert_eq!(pass.sampling.unwrap().output, [20.25, 10.75, 100.5, 65.5]);
    assert!(pass.spacing_ramp.unwrap().positive_first);
    assert_eq!(pass.step_pixels, 0.5);
    assert_eq!(pass.sigma_pixels, 0.6);
    let first = p.render(0.1).unwrap().rgba;
    assert!(first.iter().any(|v| *v > 0));
    for y in 0..90 {
        for x in 0..160 {
            if !(20.25..120.75).contains(&(x as f64 + 0.5))
                || !(10.75..76.25).contains(&(y as f64 + 0.5))
            {
                assert_eq!(first[(y * 160 + x) * 4 + 3], 0, "outside output at {x},{y}");
            }
        }
    }
    assert_ne!(first, p.render(3.9).unwrap().rgba);
    assert_eq!(first, p.render(0.1).unwrap().rgba);
}
#[test]
fn fractional_or_outside_dynamic_texel_views_fail_before_cpu_and_gpu_output() {
    for value in [-1.0, 0.25, 160.0] {
        let mut body = sampled_fixture();
        body["scene"]["value"]["materials"][0]["sampling"]["input"]["x"] = json!({"kind":"expression","expression":{"op":"literal","type":"length","value":value}});
        let mut p = plan(body);
        assert!(
            p.render(0.1)
                .err()
                .unwrap()
                .to_string()
                .contains("CAPTION_MATERIAL_INVALID")
        );
        assert!(p.record_material_plan(0.1).is_err());
    }
}
