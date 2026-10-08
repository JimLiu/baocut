use anyhow::{Result, bail};
use render_raster::{CapabilityProfile, FrameMedia, PreparedBcf, RenderPass, TextEngine};
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
fn doc(element: Value) -> Value {
    json!({"bcut":"0.2","meta":{"width":120,"height":60,"fps":30,"background":"rgba(0,0,0,0)"},"scenes":[{"id":"s","dur":2}],
        "tracks":[{"id":"v","kind":"visual","clips":[{"id":"c","start":0,"end":2,"element":element}]}]})
}
fn session(d: Value) -> PreparedBcf {
    PreparedBcf::new(
        Resolver::new(d, None).unwrap().resolve().unwrap(),
        TextEngine::with_document_fonts(&[]),
        &Default::default(),
        CapabilityProfile::cpu_reference(),
    )
    .unwrap()
}
#[test]
fn echoes_use_declared_times_and_random_seek_matches() {
    let node = json!({"type":"box","id":"moving","style":{"width":10,"height":10,"background":"#ff0000"},
        "animate":{"keyframes":[{"prop":"x","frames":[{"t":0,"v":0},{"t":2,"v":100}]}]},
        "echo":{"mode":"over","samples":[{"offset":-0.4,"weight":0.25},{"offset":-0.2,"weight":0.5},{"offset":0,"weight":1}]}});
    let mut r = session(doc(node));
    let frame = r.render_cpu(1.0, &mut NoMedia).unwrap();
    assert_eq!(frame.pixel(55, 5).unwrap().alpha(), 255);
    assert!(
        frame.pixel(45, 5).unwrap().alpha() > 120 && frame.pixel(45, 5).unwrap().alpha() < 135,
        "{:?}",
        frame.pixel(45, 5)
    );
    assert!(frame.pixel(35, 5).unwrap().alpha() > 55 && frame.pixel(35, 5).unwrap().alpha() < 70);
    r.render_cpu(1.8, &mut NoMedia).unwrap();
    r.render_cpu(0.0, &mut NoMedia).unwrap();
    assert_eq!(
        frame.data(),
        r.render_cpu(1.0, &mut NoMedia).unwrap().data()
    );
}
#[test]
fn temporal_average_rounds_once_and_preserves_dim_colors() {
    let mut r = session(doc(
        json!({"type":"box","style":{"width":20,"height":20,"background":"#010101"},
        "echo":{"mode":"average","samples":[{"offset":-0.1},{"offset":0},{"offset":0.1}]}}),
    ));
    assert!(
        r.plan(1.0)
            .unwrap()
            .passes
            .iter()
            .any(|p| matches!(p, RenderPass::Accumulate { .. }))
    );
    let p = r.render_cpu(1.0, &mut NoMedia).unwrap();
    assert_eq!(p.pixel(5, 5).unwrap().red(), 1);
    assert_eq!(p.pixel(5, 5).unwrap().alpha(), 255);
}
#[test]
fn nested_echo_and_invalid_sample_weights_are_rejected() {
    let echo = json!({"samples":[{"offset":0}]});
    for element in [
        json!({"type":"box","echo":echo,"children":[{"type":"box","echo":echo}]}),
        json!({"type":"box","echo":{"samples":[{"offset":0,"weight":0}]}}),
        json!({"type":"box","echo":{"mode":false,"samples":[{"offset":0}]}}),
    ] {
        assert!(
            Resolver::new(doc(element), None)
                .unwrap()
                .resolve()
                .is_err()
        );
    }
}
