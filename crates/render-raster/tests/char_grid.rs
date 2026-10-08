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
        bail!("no media expected")
    }
}
fn session(element: Value) -> PreparedBcf {
    let doc = json!({"bcut":"0.2","meta":{"width":960,"height":600,"fps":30,"background":"#000"},
    "scenes":[{"id":"s","dur":4}],"tracks":[{"id":"v","kind":"visual","clips":[{
        "id":"c","start":1,"end":4,"element":element
    }]}]});
    PreparedBcf::new(
        Resolver::new(doc, None).unwrap().resolve().unwrap(),
        TextEngine::with_document_fonts(&[
            include_bytes!("../assets/fonts/VKCode-400.ttf").to_vec()
        ]),
        &Default::default(),
        CapabilityProfile::cpu_reference(),
    )
    .unwrap()
}

#[test]
fn character_layers_batch_glyphs_and_seek_without_history() {
    let mut runtime = session(
        json!({"type":"charGrid","cols":32,"rows":6,"cellWidth":10,"cellHeight":20,
        "style":{"fontSize":16},"layers":[
            {"id":"red","color":"#ff0000","ops":[{"op":"text","text":"HELLO WORLD","cps":10}]},
            {"id":"blue","color":"#0000ff","ops":[{"op":"box","x":0,"y":2,"width":32,"height":4}]}
        ]}),
    );
    let early = runtime.render_cpu(1.2, &mut NoMedia).unwrap();
    let expected = runtime.render_cpu(2.0, &mut NoMedia).unwrap();
    assert_ne!(early.data(), expected.data());
    assert!(expected.pixels().iter().any(|p| p.red() > 0));
    assert!(expected.pixels().iter().any(|p| p.blue() > 0));
    for y in 51..109 {
        assert!(
            expected.pixel(5, y).unwrap().blue() > 0,
            "box border gap at {y}"
        );
    }
    runtime.render_cpu(3.5, &mut NoMedia).unwrap();
    assert_eq!(
        expected.data(),
        runtime.render_cpu(2.0, &mut NoMedia).unwrap().data()
    );
    let plan = runtime.plan(2.0).unwrap();
    let render_raster::RenderPass::Draw { ops, .. } = &plan.passes[0] else {
        panic!("plain grid must fold");
    };
    assert_eq!(
        ops.ops
            .iter()
            .filter(|op| matches!(op, DrawOp::FillPath { .. }))
            .count(),
        2
    );
}

#[test]
fn full_three_layer_grid_uses_three_draw_batches() {
    let lines: Vec<String> = (0..30)
        .map(|y| {
            (0..96)
                .map(|x| if (x + y) % 3 == 0 { '#' } else { ' ' })
                .collect()
        })
        .collect();
    let layers:Vec<_>=["#777777","#dddddd","#ff9955"].into_iter().enumerate().map(|(i,color)|
        json!({"id":format!("layer-{i}"),"color":color,"ops":[{"op":"sprite","lines":lines}]})).collect();
    let mut runtime = session(
        json!({"type":"charGrid","cols":96,"rows":30,"cellWidth":10,"cellHeight":20,"style":{"fontSize":16},"layers":layers}),
    );
    let plan = runtime.plan(2.0).unwrap();
    let render_raster::RenderPass::Draw { ops, .. } = &plan.passes[0] else {
        panic!("grid must fold");
    };
    assert_eq!(
        ops.ops
            .iter()
            .filter(|op| matches!(op, DrawOp::FillPath { .. }))
            .count(),
        3
    );
    let full = runtime.render_cpu(2.0, &mut NoMedia).unwrap();
    let small = runtime.render_cpu_width(2.0, &mut NoMedia, 480).unwrap();
    assert_eq!((small.width(), small.height()), (480, 300));
    assert!(full.pixels().iter().any(|p| p.red() > p.blue()));
}
