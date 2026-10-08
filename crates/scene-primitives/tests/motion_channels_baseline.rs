//! 阶段 0 语义基线：BCF `resolve` 产出的绝对时间 `Vec<Channel>` golden 与
//! `sample_frames` 的乱序采样一致性。
//!
//! 夹具：`tests/fixtures/motion/bcf-channels.json`。
//! 重生成：`BCUT_UPDATE_GOLDEN=1 cargo test -p bcut-core --test motion_channels_baseline`。
//!
//! 比较策略：**按序列化文本逐字节比对**，不留 epsilon。`to_string_pretty` 的输出
//! （ryu 最短往返表示 + BTreeMap 键序）本身是确定的，逐字节比对才是真正的
//! 「逐位不变」，也不依赖解析方向的设置（workspace 层的 serde_json 开着
//! `float_roundtrip`，见 `core/Cargo.toml`）。
//! 乱序采样断言另用 `f64::to_bits` 逐位比较。

use std::path::PathBuf;

use scene_primitives::layout::{TextMeasure, TextMetricsLine};
use scene_primitives::resolve::{Ir, RNode, Resolver};
use scene_primitives::sample::{Channel, sample_frames};
use scene_primitives::{HostInputs, Rgba};
use serde_json::{Value, json};

/// 固定文本度量：core 不做 I/O，字体由 host 注入。这里给一份纯算术的假度量，
/// 让夹具与系统字体无关。
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

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/motion")
}

fn updating() -> bool {
    std::env::var_os("BCUT_UPDATE_GOLDEN").is_some_and(|value| !value.is_empty())
}

fn assert_golden(name: &str, actual: &Value) {
    let path = fixture_dir().join(name);
    let mut text = serde_json::to_string_pretty(actual).expect("序列化 golden");
    text.push('\n');
    if updating() {
        std::fs::create_dir_all(fixture_dir()).expect("创建 fixtures/motion");
        std::fs::write(&path, &text).expect("写入 golden");
        return;
    }
    let expected = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "读取 {} 失败：{error}；用 BCUT_UPDATE_GOLDEN=1 重生成",
            path.display()
        )
    });
    if expected == text {
        return;
    }
    let (line, want, got) = expected
        .lines()
        .zip(text.lines())
        .enumerate()
        .find(|(_, (a, b))| a != b)
        .map(|(index, (a, b))| (index + 1, a.to_owned(), b.to_owned()))
        .unwrap_or_else(|| {
            (
                expected.lines().count().min(text.lines().count()) + 1,
                format!("<{} 行>", expected.lines().count()),
                format!("<{} 行>", text.lines().count()),
            )
        });
    panic!(
        "{} 与当前实现不一致（第 {line} 行）：\n  golden: {want}\n  实得:   {got}\n\
         这是语义变更，必须先确认再用 BCUT_UPDATE_GOLDEN=1 重生成。",
        path.display()
    );
}

/// media-demo 的宿主元数据：固定值，夹具不依赖真实媒体探测。
fn media_demo_inputs() -> HostInputs {
    let mut inputs = HostInputs::default();
    inputs.insert_image("card", 640.0, 360.0);
    inputs.insert_image("logo", 128.0, 128.0);
    inputs.insert_video("clip", 1280.0, 720.0, 12.0, 24.0);
    inputs.insert_audio("tone", 30.0);
    inputs
}

fn rgba_json(color: &Rgba) -> Value {
    json!({"r": color.r, "g": color.g, "b": color.b, "a": color.a})
}

/// 通道自适应采样点：区间外各一点、每个关键帧、每段中点。
fn channel_probe_times(channel: &Channel) -> Vec<f64> {
    let mut times = Vec::new();
    if channel.frames.is_empty() {
        return times;
    }
    let first = channel.frames[0].t;
    let last = channel.frames[channel.frames.len() - 1].t;
    times.push(first - 0.25);
    for window in channel.frames.windows(2) {
        times.push(window[0].t);
        times.push((window[0].t + window[1].t) / 2.0);
    }
    times.push(last);
    times.push(last + 0.25);
    times
}

fn channel_json(channel: &Channel) -> Value {
    let frames = channel
        .frames
        .iter()
        .map(|frame| {
            json!({
                "t": frame.t,
                "v": frame.v,
                "ease": frame.ease,
            })
        })
        .collect::<Vec<_>>();
    let samples = channel_probe_times(channel)
        .into_iter()
        .map(|time| json!({"t": time, "v": sample_frames(&channel.frames, time)}))
        .collect::<Vec<_>>();
    json!({
        "prop": channel.prop,
        "meta": channel.meta,
        "frames": frames,
        "samples": samples,
    })
}

fn channels_json(channels: &[Channel]) -> Value {
    Value::Array(channels.iter().map(channel_json).collect())
}

/// 深度优先展开渲染树，只留下带通道或带 extraDelay 的节点，夹具因此聚焦动画。
fn node_rows(node: &RNode, path: &str, rows: &mut Vec<Value>) {
    let here = if path.is_empty() {
        node.id.clone()
    } else {
        format!("{path}/{}", node.id)
    };
    if !node.channels.is_empty() || node.extra_delay != 0.0 {
        rows.push(json!({
            "path": here,
            "ntype": node.ntype,
            "extraDelay": node.extra_delay,
            "channels": channels_json(&node.channels),
        }));
    }
    for child in &node.children {
        node_rows(child, &here, rows);
    }
}

fn ir_json(ir: &Ir) -> Value {
    let visual = ir
        .visual_clips
        .iter()
        .map(|clip| {
            let mut rows = Vec::new();
            node_rows(&clip.tree, "", &mut rows);
            json!({
                "id": clip.id,
                "start": clip.start,
                "end": clip.end,
                "renderStart": clip.render_start,
                "renderEnd": clip.render_end,
                "z": clip.z,
                "order": clip.order,
                "wrapChannels": channels_json(&clip.wrap_channels),
                "nodes": rows,
            })
        })
        .collect::<Vec<_>>();
    let camera = ir
        .camera_clips
        .iter()
        .map(|clip| {
            let channel = Channel::replace("camera".to_owned(), clip.frames.clone(), None);
            json!({
                "start": clip.start,
                "end": clip.end,
                "channel": channel_json(&channel),
            })
        })
        .collect::<Vec<_>>();
    let audio = ir
        .audio_clips
        .iter()
        .map(|clip| {
            let channel = Channel::replace("volume".to_owned(), clip.volume.clone(), None);
            json!({
                "assetId": clip.asset_id,
                "start": clip.start,
                "end": clip.end,
                "mediaStart": clip.media_start,
                "rate": clip.rate,
                "baseVolume": clip.base_volume,
                "channel": channel_json(&channel),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "meta": {
            "total": ir.total,
            "fps": ir.fps,
            "w": ir.w,
            "h": ir.h,
            "bg": rgba_json(&ir.bg),
        },
        "visualClips": visual,
        "cameraClips": camera,
        "audioClips": audio,
    })
}

fn resolve_document(doc: Value, inputs: Option<HostInputs>) -> Ir {
    let mut resolver = Resolver::new(doc, None).expect("构造 Resolver");
    if let Some(inputs) = inputs {
        resolver.set_host_inputs(inputs);
    }
    let mut ir = resolver.resolve().expect("resolve");
    // 阶段 2：生产顺序是 resolve → layout → `build_channels_after_layout`
    // （相对长度求值），`FrameRenderer::new` 已把它固化成契约。
    // media-demo / launch 里没有任何相对长度 ⇒ 这一步**一个字节都不改**，
    // 这正是「绝对通道输出不变」的硬证据，golden 因此不重生成。
    let before: Vec<String> = ir
        .visual_clips
        .iter()
        .map(|clip| serde_json::to_string(&channels_json(&clip.tree.channels)).unwrap())
        .collect();
    let (w, h) = (ir.w, ir.h);
    for clip in &mut ir.visual_clips {
        scene_primitives::layout::layout_tree(&mut clip.tree, w, h, &mut FixedMeasure);
    }
    scene_primitives::resolve::build_channels_after_layout(&mut ir).expect("finalize");
    for (index, clip) in ir.visual_clips.iter().enumerate() {
        let after = serde_json::to_string(&channels_json(&clip.tree.channels)).unwrap();
        assert_eq!(
            before[index], after,
            "布局 + 相对长度求值不得改动无相对长度文档的通道"
        );
    }
    ir
}

fn media_demo_doc() -> Value {
    let path = fixture_root().join("media-demo.bcut.json");
    serde_json::from_slice(&std::fs::read(&path).expect("读取 media-demo.bcut.json")).unwrap()
}

/// `tests/fixtures/launch-golden/launch.bcut.json` 是跟踪进版本库的 fixture。
fn launch_doc() -> Value {
    let path = fixture_root().join("launch-golden/launch.bcut.json");
    serde_json::from_slice(&std::fs::read(&path).expect("读取 launch.bcut.json")).unwrap()
}

// 两份 golden 里的 "path" / "note" / "generator" 记的是 v2 的位置与命令，与夹具逐字节
// 对拍，所以照原文保留；夹具实际从本 crate 的 `tests/fixtures/` 读。
#[test]
fn bcf_channels_match_golden() {
    let document = json!({
        "note": "BCF resolve 后的绝对时间通道语义基线（阶段 0）。",
        "generator": "cargo test -p bcut-core --test motion_channels_baseline（BCUT_UPDATE_GOLDEN=1 重生成）",
        "documents": [{
            "id": "media-demo",
            "path": "core/fixtures/media-demo.bcut.json",
            "hostInputs": {
                "card": {"kind": "image", "width": 640.0, "height": 360.0},
                "clip": {"kind": "video", "width": 1280.0, "height": 720.0, "duration": 12.0, "fps": 24.0},
                "logo": {"kind": "image", "width": 128.0, "height": 128.0},
                "tone": {"kind": "audio", "duration": 30.0},
            },
            "ir": ir_json(&resolve_document(media_demo_doc(), Some(media_demo_inputs()))),
        }],
    });
    assert_golden("bcf-channels.json", &document);
}

/// `tests/fixtures/launch-golden/launch.bcut.json` 与本基线 golden 都在版本库里，
/// 逐位核对，不再跳过。
#[test]
fn bcf_channels_launch_matches_golden() {
    let doc = launch_doc();
    let document = json!({
        "note": "core/fixtures/launch-golden/launch.bcut.json 的通道语义基线（阶段 0）。",
        "generator": "cargo test -p bcut-core --test motion_channels_baseline（BCUT_UPDATE_GOLDEN=1 重生成）",
        "documents": [{
            "id": "launch",
            "path": "core/fixtures/launch-golden/launch.bcut.json",
            "hostInputs": Value::Null,
            "ir": ir_json(&resolve_document(doc, None)),
        }],
    });
    assert_golden("bcf-channels-launch.json", &document);
}

#[test]
fn sample_frames_is_order_independent() {
    let ir = resolve_document(media_demo_doc(), Some(media_demo_inputs()));
    let mut channels = Vec::new();
    for clip in &ir.visual_clips {
        channels.extend(clip.wrap_channels.iter().cloned());
        collect_channels(&clip.tree, &mut channels);
    }
    for clip in &ir.camera_clips {
        channels.push(Channel::replace(
            "camera".to_owned(),
            clip.frames.clone(),
            None,
        ));
    }
    for clip in &ir.audio_clips {
        channels.push(Channel::replace(
            "volume".to_owned(),
            clip.volume.clone(),
            None,
        ));
    }
    assert!(!channels.is_empty(), "media-demo 必须产出通道");

    // 覆盖 [-0.5, total+0.5] 的密集网格 + 若干帧内偏移。
    let mut times = Vec::new();
    let mut frame = -15_i32;
    while frame <= (ir.total * 30.0) as i32 + 15 {
        times.push(f64::from(frame) / 30.0);
        frame += 1;
    }
    times.extend([0.0111, 1.4999, 2.50001, 3.7777, 6.66666]);
    let order = shuffled(times.len(), 0x5EED_1234_ABCD_0003);

    for channel in &channels {
        if channel.frames.is_empty() {
            continue;
        }
        let sorted = times
            .iter()
            .map(|time| sample_frames(&channel.frames, *time))
            .collect::<Vec<_>>();
        let mut out = vec![Value::Null; times.len()];
        for index in &order {
            out[*index] = sample_frames(&channel.frames, times[*index]);
        }
        for (index, (a, b)) in sorted.iter().zip(out.iter()).enumerate() {
            assert!(
                value_bitwise_eq(a, b),
                "{} 在 t={} 上顺序/乱序采样不一致：{a} vs {b}",
                channel.prop,
                times[index]
            );
        }
    }
}

fn collect_channels(node: &RNode, out: &mut Vec<Channel>) {
    out.extend(node.channels.iter().cloned());
    for child in &node.children {
        collect_channels(child, out);
    }
}

/// `Value` 的相等对 f64 走 `PartialEq`，`0.0 == -0.0` 会放过符号翻转；
/// 这里显式按位比，乱序采样必须逐位相同。
fn value_bitwise_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(x), Some(y)) => x.to_bits() == y.to_bits(),
            _ => x == y,
        },
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| value_bitwise_eq(x, y))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(key, x)| y.get(key).is_some_and(|y| value_bitwise_eq(x, y)))
        }
        _ => a == b,
    }
}

/// 固定种子的确定性置换（splitmix64 → Fisher-Yates），不引入 rand 依赖。
fn shuffled(len: usize, mut seed: u64) -> Vec<usize> {
    let mut next = move || {
        seed = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = seed;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    };
    let mut order = (0..len).collect::<Vec<_>>();
    for index in (1..len).rev() {
        let pick = (next() % (index as u64 + 1)) as usize;
        order.swap(index, pick);
    }
    order
}
