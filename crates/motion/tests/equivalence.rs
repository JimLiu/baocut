//! 等价的 Timeline 与 BCF 文档必须得到同一个 `MotionProgram` 指纹
//! （设计 §10 阶段 1 验收）。
//!
//! 映射表刻意留在测试里，不进生产代码：只有**语义上确实是同一条配方**的组合
//! 才有资格参与。`timeline.enter.fade` 的缺省曲线是 `easeOutCubic`，
//! 而 BCF `fadeIn` 的关键帧没有 ease（等价 `linear`），所以 Timeline 侧显式
//! 写 `ease: "linear"`；`exit: none` 用来阻断镜像退场。

use motion::lower_bcf::{preset_channels, to_program};
use motion::lower_timeline::{AnimationInput, SlotInput, Window, lower_timeline_animation};
use motion::preset_registry::bcf_builtin;
use serde_json::Value;

const START: f64 = 1.0;
const DUR: f64 = 0.4;

fn timeline_fade(dur: f64) -> motion::MotionProgram {
    let animation = AnimationInput {
        enter: Some(SlotInput {
            preset: "fade",
            dur: Some(dur),
            ease: Some("linear"),
            ..SlotInput::default()
        }),
        exit: Some(SlotInput {
            preset: "none",
            ..SlotInput::default()
        }),
        r#loop: None,
    };
    let lowered = lower_timeline_animation(
        &animation,
        Window {
            start: START,
            end: Some(5.0),
            project_end: 10.0,
        },
    )
    .expect("timeline program");
    // Timeline 的窗口是元素局部时间；比对前平移到绝对时间。
    lowered.program.rebased(START)
}

fn bcf_fade_in(t0: f64, dur: f64) -> motion::MotionProgram {
    let keyframes = bcf_builtin("fadeIn")
        .and_then(|def| def.get("keyframes"))
        .and_then(Value::as_array)
        .cloned()
        .expect("fadeIn keyframes");
    to_program(&preset_channels(&keyframes, t0, dur))
}

#[test]
fn timeline_fade_and_bcf_fade_in_share_one_fingerprint() {
    let timeline = timeline_fade(DUR);
    let bcf = bcf_fade_in(START, DUR);
    assert_eq!(timeline.property_tracks.len(), 1);
    assert_eq!(bcf.property_tracks.len(), 1);
    assert_eq!(
        timeline.fingerprint(),
        bcf.fingerprint(),
        "\ntimeline:\n{}\nbcf:\n{}",
        String::from_utf8_lossy(&timeline.canonical_bytes()),
        String::from_utf8_lossy(&bcf.canonical_bytes())
    );
}

#[test]
fn the_provenance_fingerprint_still_separates_the_two_registries() {
    // 等价指纹相同，但配方来源不同：full 指纹必须能区分。
    assert_ne!(
        timeline_fade(DUR).full_fingerprint(),
        bcf_fade_in(START, DUR).full_fingerprint()
    );
}

#[test]
fn the_fingerprint_is_sensitive_to_time_and_duration() {
    assert_ne!(
        timeline_fade(DUR).fingerprint(),
        bcf_fade_in(START, 0.5).fingerprint()
    );
    assert_ne!(
        timeline_fade(DUR).fingerprint(),
        bcf_fade_in(START + 0.1, DUR).fingerprint()
    );
}

#[test]
fn integer_and_float_endpoints_do_not_split_the_fingerprint() {
    // BCF `fadeIn` 的端点是整数 `0`/`1`，Timeline 侧是 `0.0`/`1.0`。
    let bcf = bcf_fade_in(START, DUR);
    let track = &bcf.property_tracks[0];
    assert_eq!(track.property.as_str(), "opacity");
    assert!(matches!(
        &track.segments[0].kind,
        motion::SegmentKind::Tween { from, .. }
            if matches!(from, motion::MotionValue::Discrete(_))
    ));
    assert_eq!(timeline_fade(DUR).fingerprint(), bcf.fingerprint());
}
