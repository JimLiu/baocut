//! 相对长度（规范 §7.8 / 设计 §5.5）：`canvas*` 随画幅走、`self*/parent*` 随
//! 静态布局盒走，求值发生在**布局之后**。
//!
//! 生产顺序由 `FrameRenderer::new` 固化：layout → `build_channels_after_layout`。

use scene_primitives::layout::{TextMeasure, TextMetricsLine};
use scene_primitives::resolve::{Ir, RNode, Resolver};
use serde_json::{Value, json};

struct FixedMeasure;

impl TextMeasure for FixedMeasure {
    fn measure(&mut self, text: &str, _family: &str, size: f64, _w: u16) -> TextMetricsLine {
        TextMetricsLine {
            width: text.chars().count() as f64 * size * 0.6,
            ascent: size * 0.8,
            descent: size * 0.2,
        }
    }
}

fn doc(width: f64, height: f64, frames: Value) -> Value {
    json!({
        "meta": {"id": "t", "width": width, "height": height, "fps": 30},
        "scenes": [{"id": "s", "dur": 3, "desc": "d"}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end",
             "element": {"type": "box", "id": "root",
                "style": {"width": 400, "height": 200},
                "children": [
                    {"type": "box", "id": "card",
                     "style": {"width": 120, "height": 60},
                     "animate": {"keyframes": frames}}
                ]}}
        ]}]
    })
}

fn resolved(doc: Value) -> Ir {
    let mut ir = Resolver::new(doc, None)
        .expect("resolver")
        .resolve()
        .expect("resolve");
    let (w, h) = (ir.w, ir.h);
    for clip in &mut ir.visual_clips {
        scene_primitives::layout::layout_tree(&mut clip.tree, w, h, &mut FixedMeasure);
    }
    scene_primitives::resolve::build_channels_after_layout(&mut ir).expect("finalize");
    ir
}

fn find<'a>(node: &'a RNode, id: &str) -> Option<&'a RNode> {
    if node.id == id {
        return Some(node);
    }
    node.children.iter().find_map(|c| find(c, id))
}

/// `card` 元素上某属性首帧的 px 值。
fn first_frame(ir: &Ir, prop: &str) -> f64 {
    let card = find(&ir.visual_clips[0].tree, "card").expect("card");
    card.channels
        .iter()
        .find(|c| c.prop == prop)
        .expect(prop)
        .frames[0]
        .v
        .as_f64()
        .expect("px number")
}

#[test]
fn canvas_bases_follow_the_frame_size() {
    let frames = json!([
        {"prop": "x", "frames": [
            {"t": "0%", "v": {"value": 0.1, "basis": "canvasWidth"}},
            {"t": "100%", "v": 0}]},
        {"prop": "y", "frames": [
            {"t": "0%", "v": {"value": 0.05, "basis": "canvasShortEdge"}},
            {"t": "100%", "v": 0}]}
    ]);
    for (w, h) in [(1920.0, 1080.0), (1080.0, 1920.0), (1080.0, 1080.0)] {
        let ir = resolved(doc(w, h, frames.clone()));
        assert_eq!(first_frame(&ir, "x"), 0.1 * w, "{w}x{h}");
        assert_eq!(first_frame(&ir, "y"), 0.05 * w.min(h), "{w}x{h}");
    }
}

#[test]
fn self_and_parent_bases_follow_the_static_layout_boxes() {
    let frames = json!([
        {"prop": "x", "frames": [
            {"t": "0%", "v": {"value": 1.0, "basis": "selfWidth"}},
            {"t": "100%", "v": 0}]},
        {"prop": "y", "frames": [
            {"t": "0%", "v": {"value": 0.5, "basis": "parentHeight"}},
            {"t": "100%", "v": 0}]}
    ]);
    // 画幅变了，但 card 的显式 120×60 与父盒 400×200 没变 ⇒ px 也不变。
    for (w, h) in [(1920.0, 1080.0), (1080.0, 1920.0)] {
        let ir = resolved(doc(w, h, frames.clone()));
        assert_eq!(first_frame(&ir, "x"), 120.0, "{w}x{h}");
        assert_eq!(first_frame(&ir, "y"), 100.0, "{w}x{h}");
    }
}

#[test]
fn offset_is_added_after_scaling() {
    let frames = json!([
        {"prop": "x", "frames": [
            {"t": "0%", "v": {"value": 0.1, "basis": "canvasWidth", "offset": -24.0}},
            {"t": "100%", "v": 0}]}
    ]);
    let ir = resolved(doc(1920.0, 1080.0, frames));
    assert_eq!(first_frame(&ir, "x"), 192.0 - 24.0);
}

#[test]
fn the_canonical_families_scale_with_the_canvas() {
    // `motion.moveIn` 的缺省 distance 是画布短边的 4.5%。
    let make = |w: f64, h: f64| {
        json!({
            "meta": {"id": "t", "width": w, "height": h, "fps": 30},
            "scenes": [{"id": "s", "dur": 3, "desc": "d"}],
            "tracks": [{"id": "main", "kind": "visual", "clips": [
                {"id": "c", "start": 0, "end": "@s.end",
                 "element": {"type": "box", "id": "root",
                    "style": {"width": 400, "height": 200},
                    "children": [
                        {"type": "box", "id": "card", "style": {"width": 120, "height": 60},
                         "animate": {"enter": {"preset": "motion.moveIn", "dur": 0.5}}}
                    ]}}
            ]}]
        })
    };
    for (w, h) in [(1920.0, 1080.0), (1080.0, 1920.0), (1080.0, 1080.0)] {
        let ir = resolved(make(w, h));
        assert_eq!(first_frame(&ir, "y"), 0.045 * w.min(h), "{w}x{h}");
    }
}

#[test]
fn documents_without_relative_lengths_are_untouched_by_the_finalize_pass() {
    let frames = json!([
        {"prop": "x", "frames": [{"t": "0%", "v": 40}, {"t": "100%", "v": 0}]}
    ]);
    let mut ir = Resolver::new(doc(1920.0, 1080.0, frames), None)
        .unwrap()
        .resolve()
        .unwrap();
    let before = format!("{:?}", channel_dump(&ir));
    let (w, h) = (ir.w, ir.h);
    for clip in &mut ir.visual_clips {
        scene_primitives::layout::layout_tree(&mut clip.tree, w, h, &mut FixedMeasure);
    }
    scene_primitives::resolve::build_channels_after_layout(&mut ir).unwrap();
    assert_eq!(before, format!("{:?}", channel_dump(&ir)));
}

fn channel_dump(ir: &Ir) -> Vec<(String, Vec<(f64, Value)>)> {
    fn walk(node: &RNode, out: &mut Vec<(String, Vec<(f64, Value)>)>) {
        for ch in &node.channels {
            out.push((
                ch.prop.clone(),
                ch.frames.iter().map(|f| (f.t, f.v.clone())).collect(),
            ));
        }
        for c in &node.children {
            walk(c, out);
        }
    }
    let mut out = Vec::new();
    for clip in &ir.visual_clips {
        walk(&clip.tree, &mut out);
    }
    out
}
