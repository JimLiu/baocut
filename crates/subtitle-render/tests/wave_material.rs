use caption_scene::*;
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::*;
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/wave-displace.json"
    ))
    .unwrap()
}
fn plan(body: Value) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Wave motion".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "wave-instance".into(),
    )
    .unwrap()
}
#[test]
fn wave_material_is_animated_seekable_and_zero_amplitude_is_identity() {
    let body = fixture();
    let mut scene = plan(body.clone());
    let first = scene.render(0.0).unwrap();
    let second = scene.render(0.25).unwrap();
    assert_ne!(first.rgba, second.rgba);
    assert!(second.rgba.chunks_exact(4).any(|p| p[3] > 0));
    for time in [0.75, 0.1, 0.25, 0.0] {
        assert_eq!(
            scene.render(time).unwrap().rgba,
            plan(body.clone()).render(time).unwrap().rgba
        );
    }
    let mut zero = body.clone();
    zero["scene"]["value"]["materials"][0]["amplitude"] = json!({"kind":"constant","value":0});
    let mut plain = body;
    plain["scene"]["value"]["materials"] = json!([]);
    assert_eq!(
        plan(zero).render(0.2).unwrap().rgba,
        plan(plain).render(0.2).unwrap().rgba
    );
}
#[test]
fn dynamic_wave_uniform_ranges_are_checked_even_with_zero_amplitude() {
    for (property, ty, value) in [
        ("amplitude", "length", 257.0),
        ("wavelength", "length", 0.5),
    ] {
        let mut body = fixture();
        body["scene"]["value"]["materials"][0]["amplitude"] = json!({"kind":"constant","value":0});
        body["scene"]["value"]["materials"][0][property] =
            json!({"kind":"expression","expression":{"op":"literal","type":ty,"value":value}});
        assert!(
            plan(body)
                .render(0.2)
                .err()
                .unwrap()
                .to_string()
                .contains("CAPTION_MATERIAL_INVALID")
        );
    }
}

#[test]
fn wave_padding_is_independent_of_uniform_representation_and_bounded() {
    let body = fixture();
    let mut dynamic = body.clone();
    dynamic["scene"]["value"]["materials"][0]["amplitude"] =
        json!({"kind":"expression","expression":{"op":"literal","type":"length","value":4.5}});
    assert_eq!(
        plan(body.clone()).render(0.25).unwrap().rgba,
        plan(dynamic).render(0.25).unwrap().rgba
    );
    let mut excessive = body;
    excessive["scene"]["value"]["materials"] = Value::Array(
        (0..8)
            .map(|index| {
                json!({
                    "kind":"wave-displace", "id":format!("wave-{index}"), "axis":"y",
                    "amplitude":{"kind":"constant","value":256},
                    "wavelength":{"kind":"constant","value":32},
                    "phase":{"kind":"constant","value":0}
                })
            })
            .collect(),
    );
    assert!(
        plan(excessive)
            .render(0.25)
            .err()
            .unwrap()
            .to_string()
            .contains("CAPTION_BUDGET_EXCEEDED")
    );
}

fn with_context(mut body: Value) -> Value {
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-wave-context/1"));
    body["scene"]["value"]["materials"][0]["contextNodeId"] = json!("caption");
    body
}

#[test]
fn wave_context_keeps_the_kernel_for_layout_free_uniforms() {
    let body = fixture();
    let contextual = with_context(body.clone());
    for time in [0.0, 0.25, 0.6] {
        assert_eq!(
            plan(contextual.clone()).render(time).unwrap().rgba,
            plan(body.clone()).render(time).unwrap().rgba
        );
    }
}

#[test]
fn page_anchored_wave_moves_with_its_page() {
    // phase = -tau * layout.x / wavelength puts the sine origin on the page's left edge.
    let anchored = |x: f64, context: bool| {
        let mut body = fixture();
        body["scene"]["value"]["layout"]["x"] = json!({"value": x, "basis": "absolute"});
        body["scene"]["value"]["materials"][0]["phase"] = if context {
            json!({"kind":"expression","expression":{"op":"call","function":"mul","args":[
                {"op":"call","function":"div","args":[
                    {"op":"read","path":"layout.x"},
                    {"op":"literal","type":"length","value":32}
                ]},
                {"op":"literal","type":"angle","value":-std::f64::consts::TAU}
            ]}})
        } else {
            json!({"kind":"constant","value":0})
        };
        let body = if context { with_context(body) } else { body };
        plan(body).render(0.25).unwrap().rgba
    };
    let shifted = |a: &[u8], b: &[u8]| {
        // b is a rendered 20 px left of a on the 160x90 canvas.
        (0..90).all(|y| {
            (0..140).all(|x| {
                let i = (y * 160 + x) * 4;
                let j = (y * 160 + x + 20) * 4;
                b[i..i + 4] == a[j..j + 4]
            })
        })
    };
    let right = anchored(80.0, true);
    let left = anchored(60.0, true);
    assert!(right.chunks_exact(4).any(|p| p[3] > 0));
    assert!(shifted(&right, &left));
    // A canvas-anchored wave with the same wavelength does not follow the page.
    assert!(!shifted(&anchored(80.0, false), &anchored(60.0, false)));
}

#[test]
fn wave_context_without_a_current_page_is_transparent() {
    let mut contextual = with_context(fixture());
    contextual["scene"]["value"]["materials"][0]["wavelength"] =
        json!({"kind":"expression","expression":{"op":"read","path":"layout.width"}});
    let mut scene = ScenePlan::compile(
        parse_style(&contextual).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "wave-instance".into(),
    )
    .unwrap();
    assert!(scene.render(0.25).unwrap().rgba.iter().all(|v| *v == 0));
}
