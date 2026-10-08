//! 阶段 3：`animate.flow` / `animate.parts` / `split` 进 BCF 0.1 草稿
//! （规范 §7.5 / §7.9、设计 §10 阶段 3）。

use scene_primitives::layout::{TextMeasure, TextMetricsLine};
use scene_primitives::lint::lint;
use scene_primitives::resolve::Resolver;
use scene_primitives::sample::sample_channels;
use serde_json::{Value, json};

/// 固定度量：测试不依赖系统字体。
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

fn doc(element: Value) -> Value {
    json!({
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "s", "dur": 4}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": element}
        ]}]
    })
}

fn text_with(animate: Value, extra: &[(&str, Value)]) -> Value {
    let mut element = json!({
        "type": "text", "id": "el", "text": "BaoCut 剪辑",
        "style": {"fontSize": 48}, "animate": animate
    });
    for (key, value) in extra {
        element[*key] = value.clone();
    }
    element
}

fn resolved(doc: &Value) -> scene_primitives::resolve::Ir {
    let mut resolver = Resolver::new(doc.clone(), None).expect("resolver");
    let mut ir = resolver.resolve().expect("resolve");
    // 相对长度在布局之后求值（设计 §5.5）；这里用零度量布局跑同一条链。
    let (w, h) = (ir.w, ir.h);
    for clip in &mut ir.visual_clips {
        scene_primitives::layout::layout_tree(&mut clip.tree, w, h, &mut FixedMeasure);
    }
    scene_primitives::resolve::build_channels_after_layout(&mut ir).expect("finalize");
    ir
}

fn codes(doc: &Value) -> Vec<&'static str> {
    lint(doc).into_iter().map(|d| d.rule).collect()
}

#[test]
fn a_flow_document_resolves_to_absolute_time_channels() {
    let document = doc(text_with(
        json!({"flow": {
            "op": "sequence", "at": "clip.start",
            "items": [
                {"op": "parallel", "items": [
                    {"op": "tween", "prop": "opacity", "from": 0, "to": 1, "dur": 0.4,
                     "curve": "easeOutCubic", "composite": "replace"},
                    {"op": "tween", "prop": "y",
                     "from": {"value": 0.04, "basis": "canvasShortEdge"}, "to": 0,
                     "dur": 0.4, "curve": "easeOutCubic", "composite": "add"}
                ]},
                {"op": "repeat", "until": "clip.end", "mode": "yoyo",
                 "item": {"op": "tween", "prop": "y", "from": -6, "to": 6, "dur": 1.2,
                          "curve": "easeInOutSine", "composite": "add"}}
            ]
        }}),
        &[],
    ));
    let ir = resolved(&document);
    let node = &ir.visual_clips[0].tree;
    assert!(!node.channels.is_empty());
    // 相对长度已换算成 px（短边 1080 × 0.04）
    let y_add = node
        .channels
        .iter()
        .find(|ch| ch.prop == "y" && ch.composite == motion::CompositeMode::Add)
        .expect("y add channel");
    assert_eq!(y_add.frames[0].v, json!(43.2));

    // t = 0.2 时不透明度是 easeOutCubic 的一半进度
    let pose = sample_channels(&node.channels, 0.2);
    let opacity = pose.scalar("opacity", 1.0);
    assert!(opacity > 0.5 && opacity < 1.0, "{opacity}");
    // repeat 一直铺到 clip.end 附近
    let last = y_add.frames.last().unwrap().t;
    assert!(last >= 4.0 - 1.2, "{last}");
}

#[test]
fn flow_and_the_legacy_slots_are_mutually_exclusive() {
    let document = doc(text_with(
        json!({
            "enter": {"preset": "fadeIn", "dur": 0.4},
            "flow": {"op": "tween", "prop": "opacity", "from": 0, "to": 1, "dur": 0.4}
        }),
        &[],
    ));
    assert!(codes(&document).contains(&"motion-legacy-and-flow"));
    // resolve 也拒绝（lint / resolve 双保险）
    let mut resolver = Resolver::new(document, None).unwrap();
    let error = match resolver.resolve() {
        Ok(_) => panic!("resolve 应当拒绝 flow + 四槽"),
        Err(error) => error.to_string(),
    };
    assert!(error.starts_with("motion-legacy-and-flow"), "{error}");
}

#[test]
fn experimental_fields_are_reported_as_info_on_a_zero_one_document() {
    let document = doc(text_with(
        json!({"parts": {"op": "preset", "preset": "motion.typewriter"}}),
        &[("split", json!({"by": "word"}))],
    ));
    let diagnostics = lint(&document);
    let fields: Vec<&str> = diagnostics
        .iter()
        .filter(|d| d.rule == "experimental-field")
        .map(|d| d.pointer.as_str())
        .collect();
    assert!(
        fields.iter().any(|p| p.ends_with("/animate/parts")),
        "{fields:?}"
    );
    assert!(fields.iter().any(|p| p.ends_with("/split")), "{fields:?}");
    assert!(
        diagnostics.iter().all(|d| d.rule != "schema"),
        "{diagnostics:?}"
    );
}

#[test]
fn split_line_is_deferred_until_text_layout() {
    let mut document = doc(text_with(
        json!({"parts": {"op": "preset", "preset": "motion.typewriter"}}),
        &[("split", json!({"by": "line"}))],
    ));
    document["scenes"][0]["desc"] = json!("line layout");
    assert!(
        !lint(&document)
            .iter()
            .any(|d| d.severity == scene_primitives::lint::Severity::Error),
        "{:?}",
        lint(&document)
    );
}

#[test]
fn inline_shader_sources_are_a_hard_error_anywhere_in_the_document() {
    let document = doc(text_with(
        json!({"flow": {"op": "tween", "prop": "opacity", "from": 0, "to": 1, "dur": 0.4}}),
        &[(
            "effects",
            json!([{"id": "glow", "shader": "void main(){}"}]),
        )],
    ));
    assert!(codes(&document).contains(&"motion-shader-inline"));
}

#[test]
fn parts_compile_one_channel_set_per_part_with_a_stable_map() {
    let document = doc(text_with(
        json!({"parts": {
            "op": "stagger", "gap": 0.06, "order": "start", "parts": true,
            "item": {"op": "preset", "preset": "motion.riseParts"}
        }}),
        &[("split", json!({"by": "word"}))],
    ));
    let ir = resolved(&document);
    let node = &ir.visual_clips[0].tree;
    let part_motion = node.part_motion.as_ref().expect("part motion");
    // "BaoCut 剪辑" → ["BaoCut ", "剪", "辑"]
    assert_eq!(part_motion.map.len(), 3);
    assert_eq!(part_motion.channels.len(), 3);
    assert_eq!(
        part_motion.map.fingerprint,
        motion::PartMap::build("BaoCut 剪辑", motion::PartUnit::Word).fingerprint
    );
    // 级联：第 i 个 part 的第一帧比第 i-1 个晚 gap
    let start = |index: usize| part_motion.channels[index][0].frames[0].t;
    for index in 1..3 {
        assert!(
            (start(index) - start(index - 1) - 0.06).abs() < 1e-9,
            "{} vs {}",
            start(index),
            start(index - 1)
        );
    }
    // 相对长度已按短边求值
    let y = part_motion.channels[0]
        .iter()
        .find(|ch| ch.prop == "y")
        .expect("y");
    assert_eq!(y.frames[0].v, json!(0.026 * 1080.0));
}

#[test]
fn part_motion_never_moves_the_layout_box() {
    let plain = doc(text_with(json!({}), &[]));
    let animated = doc(text_with(
        json!({"parts": {"op": "preset", "preset": "motion.karaokeScale"}}),
        &[("split", json!({"by": "grapheme"}))],
    ));
    let a = resolved(&plain);
    let b = resolved(&animated);
    let (fa, fb) = (a.visual_clips[0].tree.frame, b.visual_clips[0].tree.frame);
    assert_eq!(
        (fa.x, fa.y, fa.w, fa.h),
        (fb.x, fb.y, fb.w, fb.h),
        "part 动画不得改变布局尺寸（§7.9）"
    );
}

#[test]
fn use_stagger_delay_wraps_the_whole_flow() {
    let document = json!({
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "s", "dur": 4}],
        "components": {"card": {"root": {"type": "box", "id": "card"}}},
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": {
                "type": "use", "id": "cards", "component": "card",
                "each": [1, 2, 3], "stagger": {"delay": 0.2},
                "animate": {"flow": {"op": "tween", "prop": "opacity",
                                     "from": 0, "to": 1, "dur": 0.3}}
            }}
        ]}]
    });
    let ir = resolved(&document);
    let wrappers = &ir.visual_clips[0].tree.children;
    assert_eq!(wrappers.len(), 3);
    for (index, wrapper) in wrappers.iter().enumerate() {
        let channel = &wrapper.channels[0];
        assert!(
            (channel.frames[0].t - 0.2 * index as f64).abs() < 1e-9,
            "实例 {index} 的 flow 起点是 {}",
            channel.frames[0].t
        );
    }
}

/// `sampled`（规范 §7.5）：逐帧采样 = 采样序列的线性插值。采样率（100）与文档帧率（30）
/// 不同、`from` 不落在采样网格上，插值的每一段都会被测到。
#[test]
fn a_sampled_flow_samples_to_the_linear_interpolation_frame_by_frame() {
    let fps = 100.0;
    let values: Vec<f64> = (0..101).map(|i| ((i * 37) % 100) as f64 / 100.0).collect();
    let (at, from) = (0.5, 0.013);
    let document = doc(text_with(
        json!({"flow": {"op": "sampled", "prop": "opacity", "at": "@s+0.5",
                        "values": values, "fps": fps, "from": from}}),
        &[],
    ));
    assert!(
        codes(&document).iter().all(|c| *c != "schema"),
        "{:?}",
        codes(&document)
    );
    let ir = resolved(&document);
    let node = &ir.visual_clips[0].tree;
    let expected = |local: f64| {
        let position = ((local + from) * fps).min(100.0);
        let index = (position.floor() as usize).min(99);
        let frac = position - index as f64;
        values[index] + (values[index + 1] - values[index]) * frac
    };
    let span = 1.0 - from;
    let mut checked = 0;
    for frame in 0..=120 {
        let t = frame as f64 / 30.0;
        if t < at {
            continue;
        }
        let local = (t - at).min(span);
        let got = sample_channels(&node.channels, t).scalar("opacity", 1.0);
        assert!(
            (got - expected(local)).abs() < 1e-9,
            "frame {frame} t={t}: {got} vs {}",
            expected(local)
        );
        checked += 1;
    }
    assert!(checked > 60);
}
