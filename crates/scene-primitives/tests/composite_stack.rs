//! 主运动 + 强调可叠加（设计 §10 阶段 2 验收 / 规范 §7.7）。
//!
//! 真实的多轨来源就是这一条：BCF 的 `enter` 写 `motion.moveIn`（y=add）、
//! `emphasis` 写 `motion.pulse`（scale=multiply）/ `motion.flash`（opacity=multiply）
//! / `motion.tilt`（rotation=add），两者时间交叠时**相加 / 相乘**，
//! 而不是像 legacy 四槽那样后写覆盖。

use scene_primitives::layout::{TextMeasure, TextMetricsLine};
use scene_primitives::resolve::{Ir, RNode, Resolver};
use scene_primitives::sample::sample_channels;
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

fn doc(animate: Value) -> Value {
    json!({
        "meta": {"id": "t", "width": 1000, "height": 1000, "fps": 30},
        "scenes": [{"id": "s", "dur": 4, "desc": "d"}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end",
             "element": {"type": "box", "id": "root", "style": {"width": 400, "height": 200},
                "children": [{"type": "box", "id": "card",
                              "style": {"width": 120, "height": 60},
                              "animate": animate}]}}
        ]}]
    })
}

fn resolved(animate: Value) -> Ir {
    let mut ir = Resolver::new(doc(animate), None)
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

fn card(ir: &Ir) -> &RNode {
    fn walk<'a>(node: &'a RNode, id: &str) -> Option<&'a RNode> {
        if node.id == id {
            return Some(node);
        }
        node.children.iter().find_map(|c| walk(c, id))
    }
    walk(&ir.visual_clips[0].tree, "card").expect("card")
}

#[test]
fn move_in_and_pulse_stack_additively_and_multiplicatively() {
    let ir = resolved(json!({
        "enter": {"preset": "motion.moveIn", "dur": 1.0,
                  "params": {"direction": "up", "distance": 100.0, "curve": "linear",
                             "fade": false}},
        "emphasis": [{"preset": "motion.pulse", "at": 0.0, "dur": 1.0,
                      "params": {"scale": 2.0, "curve": "linear"}}]
    }));
    let node = card(&ir);
    // 两条轨真的存在，而且合成模式不同
    let y = node.channels.iter().find(|c| c.prop == "y").expect("y");
    let scale = node
        .channels
        .iter()
        .find(|c| c.prop == "scale")
        .expect("scale");
    assert_eq!(y.composite, motion::CompositeMode::Add);
    assert_eq!(scale.composite, motion::CompositeMode::Multiply);

    // t = 0.5：moveIn 走完一半（100 → 0，linear ⇒ 50），pulse 在 55% 峰值前
    let pose = sample_channels(&node.channels, 0.5);
    // base y = 0（元素静态位移），add 轨给 +50
    assert!(
        (pose.scalar("y", 0.0) - 50.0).abs() < 1e-9,
        "{}",
        pose.scalar("y", 0.0)
    );
    // base scale = 1.3（假想的元素静态缩放）× pulse 的乘子
    let pulse = pose.scalar("scale", 1.0);
    let with_base = pose.scalar("scale", 1.3);
    assert!(pulse > 1.0 && pulse < 2.0, "{pulse}");
    assert!(
        (with_base - 1.3 * pulse).abs() < 1e-9,
        "{with_base} vs {pulse}"
    );
}

#[test]
fn flash_and_tilt_also_stack_on_top_of_a_main_motion() {
    let ir = resolved(json!({
        "enter": {"preset": "motion.rotateIn", "dur": 1.0,
                  "params": {"rotationFrom": -20.0, "curve": "linear", "fade": true}},
        "emphasis": [
            {"preset": "motion.tilt", "at": 0.0, "dur": 1.0,
             "params": {"angle": 10.0, "curve": "linear"}},
            {"preset": "motion.flash", "at": 0.0, "dur": 1.0,
             "params": {"to": 0.5, "curve": "linear"}}
        ]
    }));
    let node = card(&ir);
    let rotations: Vec<_> = node
        .channels
        .iter()
        .filter(|c| c.prop == "rotation")
        .collect();
    assert_eq!(rotations.len(), 2, "旋转必须是两条独立的 add 轨");
    assert!(
        rotations
            .iter()
            .all(|c| c.composite == motion::CompositeMode::Add)
    );
    let opacities: Vec<_> = node
        .channels
        .iter()
        .filter(|c| c.prop == "opacity")
        .collect();
    assert_eq!(opacities.len(), 2, "不透明度是两条 multiply 轨");

    // t = 0.25：rotateIn 的 -20 → 0（linear）走到 -15；tilt 的 0 → 10（峰值在 50%）
    // 走到 5 ⇒ **相加** = -10。旧的「后写覆盖」在这里只会给 5 或 -15。
    let pose = sample_channels(&node.channels, 0.25);
    assert!(
        (pose.scalar("rotation", 0.0) - (-10.0)).abs() < 1e-9,
        "{}",
        pose.scalar("rotation", 0.0)
    );
    // fadeIn 走 easeOutCubic（compose 步没有传 curve，用 motion.fadeIn 自己的缺省），
    // flash 的 1 → 0.5 走 linear 到 0.75 ⇒ **相乘**。
    let fade = 1.0 - (1.0f64 - 0.25).powi(3);
    assert!(
        (pose.scalar("opacity", 1.0) - fade * 0.75).abs() < 1e-9,
        "{}",
        pose.scalar("opacity", 1.0)
    );
}

#[test]
fn legacy_enter_and_exit_on_one_prop_each_own_their_window() {
    // 两个 legacy 配方写同一个 opacity 通道：enter(order 0) 在 [0, 1]，exit(order 1000)
    // 在 [3, 4]。窗口不重叠 ⇒ 各管各的：exit 尚未开始时不得拿它回填的首值 1.0
    // 盖掉正在进行的淡入（旧折叠只比 order，淡入整段看不见）。
    let ir = resolved(json!({
        "enter": {"preset": "fadeIn", "dur": 1.0},
        "exit": {"preset": "fadeOut", "dur": 1.0}
    }));
    let node = card(&ir);
    for ch in &node.channels {
        assert_eq!(ch.composite, motion::CompositeMode::Replace);
    }
    let at = |t: f64| sample_channels(&node.channels, t).scalar("opacity", 1.0);
    assert_eq!(at(0.0), 0.0, "淡入从 0 开始");
    assert!(at(0.5) > 0.0 && at(0.5) < 1.0, "淡入进行中：{}", at(0.5));
    assert_eq!(at(2.0), 1.0, "两段之间保持淡入的末值");
    assert!(at(3.5) > 0.0 && at(3.5) < 1.0, "淡出进行中：{}", at(3.5));
    assert_eq!(at(4.0), 0.0, "淡出到 0");
    assert!(
        !sample_channels(&node.channels, 0.5).has_composition(),
        "legacy 路径不得引入 add / multiply"
    );
}

#[test]
fn overlapping_replace_tracks_still_resolve_by_declaration_order() {
    // 真正重叠时仍是 §7.1「后声明覆盖」：keyframes(order ≥ 1_000_000) 压过 enter。
    let ir = resolved(json!({
        "enter": {"preset": "fadeIn", "dur": 1.0},
        "keyframes": [{"prop": "opacity", "frames": [{"t": 0.25, "v": 0.6}, {"t": 0.75, "v": 0.6}]}]
    }));
    let node = card(&ir);
    let at = |t: f64| sample_channels(&node.channels, t).scalar("opacity", 1.0);
    assert_eq!(at(0.5), 0.6);
    // 窗口外各管各的：keyframes 开始前淡入在走，结束后回到仍在进行的淡入
    assert!(at(0.1) < 0.6, "{}", at(0.1));
    assert!(at(0.9) > 0.6 && at(0.9) < 1.0, "{}", at(0.9));
}

#[test]
fn sequential_keyframe_tracks_on_one_prop_play_one_after_another() {
    let ir = resolved(json!({
        "keyframes": [
            {"prop": "rotation", "frames": [{"t": 0.0, "v": 0}, {"t": 0.5, "v": 100}]},
            {"prop": "rotation", "frames": [{"t": 1.0, "v": 300}, {"t": 1.5, "v": 0}]}
        ]
    }));
    let node = card(&ir);
    let at = |t: f64| sample_channels(&node.channels, t).scalar("rotation", 0.0);
    assert_eq!(at(0.25), 50.0, "第一段进行中，不被第二段回填的首值盖掉");
    assert_eq!(at(0.75), 100.0, "两段之间保持第一段的末值");
    assert_eq!(at(1.25), 150.0);
    assert_eq!(at(2.0), 0.0);
}

#[test]
fn the_fade_switch_removes_the_opacity_track_entirely() {
    let with = resolved(json!({
        "enter": {"preset": "motion.moveIn", "dur": 1.0, "params": {"fade": true}}
    }));
    let without = resolved(json!({
        "enter": {"preset": "motion.moveIn", "dur": 1.0, "params": {"fade": false}}
    }));
    assert!(card(&with).channels.iter().any(|c| c.prop == "opacity"));
    assert!(!card(&without).channels.iter().any(|c| c.prop == "opacity"));
}

#[test]
fn aliases_resolve_to_the_same_channels_as_their_canonical_family() {
    let alias = resolved(json!({"enter": {"preset": "springPop", "dur": 0.6}}));
    let canonical = resolved(json!({"enter": {"preset": "motion.backIn", "dur": 0.6}}));
    let dump = |ir: &Ir| {
        card(ir)
            .channels
            .iter()
            .map(|c| {
                format!(
                    "{}|{:?}|{}|{:?}",
                    c.prop,
                    c.composite,
                    c.order,
                    c.frames
                        .iter()
                        .map(|f| (f.t, f.v.clone()))
                        .collect::<Vec<_>>()
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(dump(&alias), dump(&canonical));
}
