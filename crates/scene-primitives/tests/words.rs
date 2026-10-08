//! `~` 词锚点求值（§5.2 / §18.6）：引用窗口收集、mapToDoc、四类错误与帧对齐。

use scene_primitives::{CoreWord, HostInputs, Resolver};
use serde_json::{Value, json};

fn word(id: &str, t0: f64, t1: f64) -> CoreWord {
    CoreWord {
        id: id.into(),
        t0,
        t1,
    }
}

/// interview（video，footage clip 引用，rate 2）+ voice（audio clip 引用）。
fn doc() -> Value {
    json!({
        "meta": { "id": "w", "width": 1920, "height": 1080, "fps": 30 },
        "scenes": [ { "id": "a", "dur": 20, "desc": "画面" } ],
        "assets": {
            "interview": { "type": "video", "src": "assets/interview.mp4" },
            "voice":     { "type": "audio", "src": "assets/voice.wav" }
        },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "footage", "start": 4, "end": 10, "element": {
                    "type": "video", "id": "v", "src": "$assets.interview",
                    "mediaStart": 10, "playbackRate": 2,
                    "style": { "width": 640, "height": 360 } } }
            ] },
            { "id": "sound", "kind": "audio", "clips": [
                { "id": "narration", "start": 2, "end": 12,
                  "src": "$assets.voice", "mediaStart": 5 }
            ] }
        ]
    })
}

fn inputs() -> HostInputs {
    let mut inputs = HostInputs::default();
    inputs.insert_video("interview", 1280.0, 720.0, 60.0, 30.0);
    inputs.insert_audio("voice", 30.0);
    // voice 源时基：g1.1 在窗口 [5, 15) 内；g1.2 在窗口外
    inputs.insert_transcript(
        "voice",
        vec![word("g1.1", 6.0, 6.5), word("g1.2", 20.0, 21.0)],
    );
    // interview 源时基：footage 窗口覆盖源 [10, 10+6×2=22)
    inputs.insert_transcript("interview", vec![word("g2.1", 12.0, 13.0)]);
    inputs
}

fn resolved(doc: Value, inputs: HostInputs) -> Resolver {
    let mut r = Resolver::new(doc, None).unwrap();
    r.set_host_inputs(inputs);
    r.resolve().unwrap();
    r
}

#[test]
fn audio_ref_word_anchor_maps_to_doc_time() {
    let r = resolved(doc(), inputs());
    // docTime = clip.start + (wordT − mediaStart) / rate = 2 + (6 − 5) / 1 = 3
    let v = r.eval_t(&json!("~voice:g1.1")).unwrap().unwrap();
    assert!((v - 3.0).abs() < 1e-9, "{v}");
    let v = r.eval_t(&json!("~voice:g1.1:end")).unwrap().unwrap();
    assert!((v - 3.5).abs() < 1e-9, "{v}");
    // 偏移后对齐 1/fps 网格（§5.4）
    let v = r.eval_t(&json!("~voice:g1.1:end-0.2")).unwrap().unwrap();
    let expected = (3.3f64 * 30.0).round() / 30.0;
    assert!((v - expected).abs() < 1e-9, "{v}");
    assert!(
        ((v * 30.0) - (v * 30.0).round()).abs() < 1e-9,
        "未对齐帧网格: {v}"
    );
}

#[test]
fn video_ref_word_anchor_respects_playback_rate() {
    let r = resolved(doc(), inputs());
    // docTime = 4 + (12 − 10) / 2 = 5；end = 4 + (13 − 10) / 2 = 5.5
    let v = r.eval_t(&json!("~interview:g2.1")).unwrap().unwrap();
    assert!((v - 5.0).abs() < 1e-9, "{v}");
    let v = r.eval_t(&json!("~footage:g2.1:end")).unwrap().unwrap(); // clip 限定等价
    assert!((v - 5.5).abs() < 1e-9, "{v}");
}

#[test]
fn word_anchor_drives_clip_window_via_fixed_point() {
    let mut d = doc();
    d["tracks"][0]["clips"].as_array_mut().unwrap().push(json!({
        "id": "callout", "start": "~interview:g2.1", "dur": 2,
        "element": { "type": "box", "id": "c" }
    }));
    let r = resolved(d, inputs());
    let win = r.clip_wins.get("callout").copied().unwrap();
    assert_eq!(win, (Some(5.0), Some(7.0)));
}

#[test]
fn word_outside_reference_window_is_unmapped() {
    let r = {
        let mut r = Resolver::new(doc(), None).unwrap();
        r.set_host_inputs(inputs());
        r.resolve().unwrap();
        r
    };
    let err = r.eval_t(&json!("~voice:g1.2")).unwrap_err().to_string();
    assert!(err.starts_with("word-anchor-unmapped"), "{err}");
}

#[test]
fn unknown_word_and_unknown_ref_are_time_ref_unknown() {
    let r = resolved(doc(), inputs());
    let err = r.eval_t(&json!("~voice:nope")).unwrap_err().to_string();
    assert!(err.starts_with("time-ref-unknown"), "{err}");
    let err = r.eval_t(&json!("~ghost:g1.1")).unwrap_err().to_string();
    assert!(err.starts_with("time-ref-unknown"), "{err}");
}

#[test]
fn missing_transcript_fails_resolution_and_lint() {
    let mut d = doc();
    d["tracks"][0]["clips"][0]["start"] = json!("~voice:g1.1");
    // 只注入媒体元数据，不注入词表
    let mut r = Resolver::new(d.clone(), None).unwrap();
    let mut media_only = HostInputs::default();
    media_only.insert_video("interview", 1280.0, 720.0, 60.0, 30.0);
    media_only.insert_audio("voice", 30.0);
    r.set_host_inputs(media_only);
    let err = match r.resolve() {
        Ok(_) => panic!("缺词表应失败"),
        Err(e) => e.to_string(),
    };
    assert!(err.starts_with("word-anchor-no-transcript"), "{err}");

    let diags = scene_primitives::lint::lint(&d);
    assert!(
        diags.iter().any(|x| x.rule == "word-anchor-no-transcript"),
        "{diags:?}"
    );
    // 注入词表后 lint 干净
    let diags = scene_primitives::lint::lint_with_inputs(&d, Some(&inputs()));
    assert!(
        !diags
            .iter()
            .any(|x| x.severity == scene_primitives::lint::Severity::Error),
        "{diags:?}"
    );
}

#[test]
fn multiple_reference_points_are_ambiguous_unless_clip_qualified() {
    let mut d = doc();
    d["tracks"][0]["clips"].as_array_mut().unwrap().push(json!({
        "id": "footage-2", "start": 10, "end": 16, "element": {
            "type": "video", "id": "v2", "src": "$assets.interview",
            "mediaStart": 10, "playbackRate": 2,
            "style": { "width": 640, "height": 360 } }
    }));
    let r = resolved(d, inputs());
    let err = r.eval_t(&json!("~interview:g2.1")).unwrap_err().to_string();
    assert!(err.starts_with("word-anchor-ambiguous"), "{err}");
    // clip 限定消歧
    let v = r.eval_t(&json!("~footage-2:g2.1")).unwrap().unwrap();
    assert!((v - 11.0).abs() < 1e-9, "{v}");
}

#[test]
fn media_and_clip_name_clash_is_rejected() {
    let mut d = doc();
    d["tracks"][1]["clips"][0]["id"] = json!("voice"); // clip 与媒体同名
    let r = resolved(d, inputs());
    let err = r.eval_t(&json!("~voice:g1.1")).unwrap_err().to_string();
    assert!(err.starts_with("word-anchor-name-clash"), "{err}");
}

#[test]
fn eval_t_aligns_to_frame_grid() {
    let r = resolved(doc(), inputs());
    // 0.111s @30fps → 3.33 帧 → round 3 → 0.1s
    let v = r.eval_t(&json!(0.111)).unwrap().unwrap();
    assert!((v - 0.1).abs() < 1e-9, "{v}");
}
