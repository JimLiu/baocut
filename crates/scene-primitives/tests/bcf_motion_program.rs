//! BCF 通道 ↔ `MotionProgram` 的无损往返（计划 §4.4）。
//!
//! 语料就是阶段 0 的 golden 语料：`tests/fixtures/media-demo.bcut.json`
//! 与 `tests/fixtures/launch-golden/launch.bcut.json` resolve 之后的全部通道，
//! 包含 visual clip 的节点通道与 wrap（转场）通道、camera 与 audio 通道。
//!
//! 不变量：`to_channels(to_program(chs)) == chs`，**逐字节**。这是
//! `bcut render` 输出不变的构造性证明——整数 `0` 一直是 `Number(0)`，
//! 不会在往返中变成 `0.0`。

use std::path::PathBuf;

use motion::lower_bcf::{ChannelIr, KfIr, to_channels, to_program};
use scene_primitives::resolve::{Ir, RNode, Resolver};
use scene_primitives::sample::Channel;
use scene_primitives::{HostInputs, Kf};
use serde_json::Value;

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

/// media-demo 的宿主元数据：与 `motion_channels_baseline.rs` 同一组固定值。
fn media_demo_inputs() -> HostInputs {
    let mut inputs = HostInputs::default();
    inputs.insert_image("card", 640.0, 360.0);
    inputs.insert_image("logo", 128.0, 128.0);
    inputs.insert_video("clip", 1280.0, 720.0, 12.0, 24.0);
    inputs.insert_audio("tone", 30.0);
    inputs
}

fn collect_node(node: &RNode, out: &mut Vec<Channel>) {
    out.extend(node.channels.iter().cloned());
    for child in &node.children {
        collect_node(child, out);
    }
}

fn all_channels(ir: &Ir) -> Vec<Channel> {
    let mut out = Vec::new();
    for clip in &ir.visual_clips {
        out.extend(clip.wrap_channels.iter().cloned());
        collect_node(&clip.tree, &mut out);
    }
    for clip in &ir.camera_clips {
        out.push(Channel::replace(
            "camera".to_owned(),
            clip.frames.clone(),
            None,
        ));
    }
    for clip in &ir.audio_clips {
        out.push(Channel::replace(
            "volume".to_owned(),
            clip.volume.clone(),
            None,
        ));
    }
    out
}

fn to_ir(channel: &Channel) -> ChannelIr {
    ChannelIr {
        prop: channel.prop.clone(),
        frames: channel
            .frames
            .iter()
            .map(|frame: &Kf| {
                KfIr::new(&channel.prop, frame.t, frame.v.clone(), frame.ease.clone())
            })
            .collect(),
    }
}

fn resolve(path: &str) -> Option<Ir> {
    let file = fixture_root().join(path);
    let doc: Value = serde_json::from_slice(&std::fs::read(&file).ok()?).ok()?;
    let mut resolver = Resolver::new(doc, None).expect("构造 Resolver");
    resolver.set_host_inputs(media_demo_inputs());
    Some(resolver.resolve().expect("resolve"))
}

fn assert_round_trip(label: &str, channels: &[Channel]) {
    assert!(!channels.is_empty(), "{label}: 语料为空");
    let corpus: Vec<ChannelIr> = channels.iter().map(to_ir).collect();
    let program = to_program(&corpus);
    assert_eq!(to_channels(&program), corpus, "{label}: 往返不无损");
    // 数值通道的强类型视角必须与原文数字一致
    for channel in &corpus {
        for frame in &channel.frames {
            if let Some(n) = frame.v.as_f64() {
                assert_eq!(
                    frame.typed.as_f64().map(f64::to_bits),
                    Some(n.to_bits()),
                    "{label}/{}",
                    channel.prop
                );
            }
        }
    }
}

#[test]
fn media_demo_channels_round_trip_through_the_motion_program() {
    let ir = resolve("media-demo.bcut.json").expect("media-demo.bcut.json");
    assert_round_trip("media-demo", &all_channels(&ir));
}

/// `tests/fixtures/launch-golden/launch.bcut.json` 是跟踪进版本库的 fixture。
#[test]
fn launch_channels_round_trip_through_the_motion_program() {
    let ir = resolve("launch-golden/launch.bcut.json").expect("launch.bcut.json");
    assert_round_trip("launch", &all_channels(&ir));
}

fn two_scenes_with_transition(preset: &str) -> Value {
    serde_json::json!({
        "meta": {"id": "t", "width": 320, "height": 180, "fps": 30},
        "scenes": [{"id": "a", "dur": 1}, {"id": "b", "dur": 1}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "a", "start": 0, "end": "@a.end",
             "transitionOut": {"preset": preset, "dur": 0.4},
             "element": {"type": "box", "id": "ra", "style": {"width": 320, "height": 180}}},
            {"id": "b", "start": "@b", "end": "@b.end",
             "element": {"type": "box", "id": "rb", "style": {"width": 320, "height": 180}}}
        ]}]
    })
}

/// 转场分支的错误串是 lint / 诊断契约，必须逐字节不变。
#[test]
fn unknown_transitions_keep_their_diagnostic_string() {
    let mut resolver =
        Resolver::new(two_scenes_with_transition("notATransition"), None).expect("构造 Resolver");
    let error = match resolver.resolve() {
        Ok(_) => panic!("notATransition 应当报错"),
        Err(error) => error,
    };
    assert_eq!(error.to_string(), "transition-unknown: \"notATransition\"");
}

/// 规范 §9 的全部 Motion Transition 词汇都必须能物化出通道——阶段 5 之前
/// `wipeLeft` / `wipeRight` / `zoomThrough` / `whipPan` 四个词在这里报
/// `transition-unknown`。
#[test]
fn the_whole_spec_section_nine_vocabulary_resolves() {
    let expected: &[(&str, &[&str], &[&str])] = &[
        ("cut", &[], &[]),
        ("crossfade", &["opacity"], &["opacity"]),
        ("slideLeft", &["x"], &["x"]),
        ("slideRight", &["x"], &["x"]),
        ("slideUp", &["y"], &["y"]),
        ("slideDown", &["y"], &["y"]),
        ("wipeLeft", &["clipInsetRight"], &["clipInsetLeft"]),
        ("wipeRight", &["clipInsetLeft"], &["clipInsetRight"]),
        ("zoomThrough", &["scale", "opacity"], &["scale", "opacity"]),
        ("whipPan", &["x", "opacity"], &["x", "opacity"]),
    ];
    for (preset, out_props, in_props) in expected {
        let mut resolver =
            Resolver::new(two_scenes_with_transition(preset), None).expect("构造 Resolver");
        let ir = resolver
            .resolve()
            .unwrap_or_else(|error| panic!("{preset}: {error}"));
        let props = |id: &str| -> Vec<String> {
            ir.visual_clips
                .iter()
                .find(|clip| clip.id == id)
                .unwrap()
                .wrap_channels
                .iter()
                .map(|channel| channel.prop.clone())
                .collect()
        };
        assert_eq!(props("a"), *out_props, "{preset} 的 out 通道");
        assert_eq!(props("b"), *in_props, "{preset} 的 in 通道");
        // 交叠窗口对称展开，与词汇无关。
        let a = ir.visual_clips.iter().find(|c| c.id == "a").unwrap();
        let b = ir.visual_clips.iter().find(|c| c.id == "b").unwrap();
        if *preset == "cut" {
            continue;
        }
        assert!((a.render_end - 1.2).abs() < 1e-9, "{preset}");
        assert!((b.render_start - 0.8).abs() < 1e-9, "{preset}");
    }
}
