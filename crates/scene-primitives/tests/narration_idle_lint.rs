//! `narration-idle`（规范 §16）：旁白在说、画面连续 >4 s 没动。只查 `assets/vo/` 下的旁白。

use scene_primitives::HostInputs;
use scene_primitives::lint::{Diagnostic, Severity, lint, lint_with_inputs};
use serde_json::{Value, json};

/// 一个场景、一条铺满的 visual clip、一条 `[0, audio_end]` 的音频 clip。
/// `nodes` 是 `(id, frames)`：各自一条 opacity 关键帧轨，`t` 是 clip 内秒。
fn doc(scene_dur: f64, audio_src: &str, audio_end: f64, nodes: &[(&str, Value)]) -> Value {
    let children: Vec<Value> = nodes
        .iter()
        .map(|(id, frames)| {
            json!({"type": "box", "id": id, "style": {"width": 10, "height": 10},
                   "animate": {"keyframes": [{"prop": "opacity", "frames": frames}]}})
        })
        .collect();
    json!({
        "bcut": "0.2",
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 24},
        "assets": {"voice": {"type": "audio", "src": audio_src}},
        "scenes": [{"id": "s", "dur": scene_dur, "desc": "一场"}],
        "tracks": [
            {"id": "board", "kind": "visual", "clips": [
                {"id": "c", "start": "@s", "end": "@s.end",
                 "element": {"type": "box", "id": "root", "children": children}}]},
            {"id": "vo", "kind": "audio", "clips": [
                {"id": "vo-s", "start": "@s", "end": format!("@s+{audio_end}"), "src": "$assets.voice"}]},
        ],
    })
}

fn idle(doc: &Value) -> Vec<Diagnostic> {
    let all = lint(doc);
    assert!(
        all.iter().all(|d| d.severity != Severity::Error),
        "{all:#?}"
    );
    all.into_iter()
        .filter(|d| d.rule == "narration-idle")
        .collect()
}

/// 0–2 s 在动，2–11 s 有一条值不变的轨（不算变化），11 s 起再动。
fn stalled(audio_src: &str) -> Value {
    doc(
        14.0,
        audio_src,
        12.0,
        &[
            ("a", json!([{"t": 0, "v": 0}, {"t": 2, "v": 1}])),
            ("hold", json!([{"t": 2, "v": 1}, {"t": 11, "v": 1}])),
            ("b", json!([{"t": 11, "v": 0}, {"t": 11.5, "v": 1}])),
        ],
    )
}

#[test]
fn lint_narration_idle_reports_the_gap_inside_a_narration_clip() {
    let found = idle(&stalled("assets/vo/s.wav"));
    assert_eq!(found.len(), 1, "{found:#?}");
    let d = &found[0];
    assert_eq!(d.severity, Severity::Warn);
    assert_eq!(d.pointer, "/clips/vo-s");
    assert!(
        d.message.contains("\"vo-s\"")
            && d.message.contains("场景 \"s\"")
            && d.message.contains("2.00–11.00s"),
        "{}",
        d.message
    );
}

#[test]
fn lint_narration_idle_is_clean_when_something_moves_every_three_seconds() {
    let nodes: Vec<(String, Value)> = (1..=4)
        .map(|k| {
            let t = 3.0 * k as f64;
            (
                format!("n{k}"),
                json!([{"t": t - 0.05, "v": 0}, {"t": t, "v": 1}]),
            )
        })
        .collect();
    let refs: Vec<(&str, Value)> = nodes
        .iter()
        .map(|(id, f)| (id.as_str(), f.clone()))
        .collect();
    assert!(idle(&doc(14.0, "assets/vo/s.wav", 12.0, &refs)).is_empty());
}

#[test]
fn lint_narration_idle_ignores_audio_outside_assets_vo_and_short_clips() {
    assert!(idle(&stalled("assets/music/bed.wav")).is_empty());
    // 同样整段不动，但旁白 clip 只有 5 s（< 6 s）
    let short = doc(
        14.0,
        "assets/vo/s.wav",
        5.0,
        &[("a", json!([{"t": 0, "v": 0}, {"t": 0.5, "v": 1}]))],
    );
    assert!(idle(&short).is_empty());
}

#[test]
fn lint_narration_idle_caps_reports_and_gives_the_total_in_the_last_one() {
    // 十场，各 10 s 旁白，画面一动不动：十处空档，只报 8 条
    let scenes: Vec<Value> = (0..10)
        .map(|i| json!({"id": format!("s{i}"), "dur": 10, "desc": "一场"}))
        .collect();
    let voice: Vec<Value> = (0..10)
        .map(|i| {
            json!({"id": format!("vo-{i}"), "start": format!("@s{i}"), "end": format!("@s{i}.end"),
                   "src": "$assets.voice"})
        })
        .collect();
    let doc = json!({
        "bcut": "0.2",
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 24},
        "assets": {"voice": {"type": "audio", "src": "assets/vo/all.wav"}},
        "scenes": scenes,
        "tracks": [
            {"id": "board", "kind": "visual", "clips": [
                {"id": "c", "start": "@s0", "end": "@s9.end",
                 "element": {"type": "box", "id": "root", "style": {"width": 10, "height": 10}}}]},
            {"id": "vo", "kind": "audio", "clips": voice},
        ],
    });
    let found = idle(&doc);
    assert_eq!(found.len(), 8);
    let with_total: Vec<_> = found
        .iter()
        .filter(|d| d.message.contains("全片共 10 处这样的空档"))
        .collect();
    assert_eq!(with_total.len(), 1, "{found:#?}");
}

/// 声明窗 0–25 s（旧项目的 `@scene.end` 收尾），画面每 3 s 动一次、12 s 之后定格。
fn frozen_after_12s() -> Value {
    let nodes: Vec<(String, Value)> = (1..=4)
        .map(|k| {
            let t = 3.0 * k as f64;
            (
                format!("n{k}"),
                json!([{"t": t - 0.05, "v": 0}, {"t": t, "v": 1}]),
            )
        })
        .collect();
    let nodes: Vec<(&str, Value)> = nodes.iter().map(|(i, f)| (i.as_str(), f.clone())).collect();
    doc(26.0, "assets/vo/s.wav", 25.0, &nodes)
}

fn idle_with_audio(doc: &Value, duration: Option<f64>) -> Vec<Diagnostic> {
    let mut inputs = HostInputs::default();
    if let Some(duration) = duration {
        inputs.insert_audio("voice", duration);
    }
    let all = lint_with_inputs(doc, Some(&inputs));
    assert!(
        all.iter().all(|d| d.severity != Severity::Error),
        "{all:#?}"
    );
    all.into_iter()
        .filter(|d| d.rule == "narration-idle")
        .collect()
}

#[test]
fn lint_narration_idle_stops_where_the_audio_actually_ends() {
    let doc = frozen_after_12s();
    // 实长 15 s：说完之后的 15–25 s 定格不算，12–15 只有 3 s。
    assert!(idle_with_audio(&doc, Some(15.0)).is_empty());
    // 实长 25 s：旁白真在说，12–25 s 画面不动。
    let found = idle_with_audio(&doc, Some(25.0));
    assert_eq!(found.len(), 1, "{found:#?}");
    assert!(
        found[0].message.contains("12.00–25.00s"),
        "{}",
        found[0].message
    );
    // 实长超过声明窗：以声明终点为准。
    let found = idle_with_audio(&doc, Some(40.0));
    assert!(
        found[0].message.contains("12.00–25.00s"),
        "{}",
        found[0].message
    );
    // 拿不到实长：退回声明窗口。
    let found = idle_with_audio(&doc, None);
    assert!(
        found[0].message.contains("12.00–25.00s"),
        "{}",
        found[0].message
    );
}

#[test]
fn lint_narration_idle_counts_media_start_into_the_real_length() {
    let mut doc = frozen_after_12s();
    doc["tracks"][1]["clips"][0]["mediaStart"] = json!(10);
    // 25 s 的素材从 10 s 处开始放，只剩 15 s 可说。
    assert!(idle_with_audio(&doc, Some(25.0)).is_empty());
    // 剩下的不到 6 s：整条 clip 不查。
    assert!(idle_with_audio(&doc, Some(15.0)).is_empty());
}
