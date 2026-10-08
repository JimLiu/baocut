use serde_json::{Value, json};

fn resolve(element: Value) -> anyhow::Result<scene_primitives::Ir> {
    let document = json!({"bcut":"0.2","motionVersion":1,"meta":{"width":640,"height":360,"fps":30},
        "scenes":[{"id":"s","dur":2,"desc":"text layout"}],
        "tracks":[{"id":"v","kind":"visual","clips":[{"id":"c","start":0,"end":2,"element":element}]}]});
    scene_primitives::Resolver::new(document, None)?.resolve()
}

#[test]
fn rich_runs_require_an_explicit_layout_and_whole_graphemes() {
    assert!(resolve(json!({"type":"text","runs":[{"text":"x"}]})).is_err());
    assert!(
        resolve(
            json!({"type":"text","text":"x","runs":[{"text":"y"}],"style":{"textWrap":"none"}})
        )
        .is_err()
    );
    assert!(resolve(json!({"type":"text","runs":[{"text":"e"},{"text":"\u{301}"}],"style":{"textWrap":"none"}})).is_err());
    assert!(
        resolve(json!({"type":"text","runs":[{"text":"👩🏽‍💻"}],"style":{"textWrap":"none"}})).is_ok()
    );
}

#[test]
fn paragraph_schema_rejects_unrenderable_values() {
    for style in [
        json!({"textWrap":"word"}),
        json!({"textWrap":"none","lineHeight":0}),
        json!({"textWrap":"none","letterSpacing":"wide"}),
        json!({"textWrap":"none","textAlign":"justify"}),
        json!({"textStroke":{"width":-1}}),
    ] {
        assert!(resolve(json!({"type":"text","text":"Test","style":style})).is_err());
    }
    assert!(resolve(json!({"type":"box","style":{"textWrap":"none"}})).is_err());
    assert!(resolve(json!({"type":"box","animate":{"keyframes":[{"prop":"fontWeight","frames":[{"t":0,"v":500}]}]}})).is_err());
}

#[test]
fn content_tracks_do_not_guess_rich_run_ranges_or_apply_tween_easing() {
    assert!(
        resolve(
            json!({"type":"text","style":{"textWrap":"none"},"runs":[{"text":"x"}],
        "animate":{"keyframes":[{"prop":"textCount","frames":[{"t":0,"v":1}]}]}})
        )
        .is_err()
    );
    assert!(
        resolve(json!({"type":"text","text":"A","animate":{"flow":{
        "op":"tween","prop":"text","from":"A","to":"B","dur":1}}}))
        .is_err()
    );
}

/// `textCount` 的 `format` 是封闭键集（§7.1）：新增的 `grouping` / `pad` /
/// `negativePrefix` 被接受，未知键与类型不对的值在 resolve 期报错。
#[test]
fn text_count_format_is_a_closed_schema() {
    let counter = |format: Value| {
        resolve(json!({"type":"text","text":"0","animate":{"keyframes":[
            {"prop":"textCount","format":format,"frames":[{"t":0,"v":-2070},{"t":1,"v":220}]}]}}))
    };
    assert!(
        counter(json!({"prefix":"公元 ","negativePrefix":"公元前 ","grouping":false,"pad":0}))
            .is_ok()
    );
    assert!(counter(json!({"decimals":2,"suffix":"%","pad":5})).is_ok());
    for (format, needle) in [
        (json!({"sign":"-"}), "未知键 `sign`"),
        (json!({"grouping":"no"}), "format.grouping"),
        (json!({"pad":-1}), "format.pad"),
        (json!({"pad":2.5}), "format.pad"),
        (json!({"pad":21}), "format.pad"),
        (json!({"negativePrefix":7}), "format.negativePrefix"),
        (json!({"decimals":"2"}), "format.decimals"),
        (json!("0,0"), "必须是对象"),
    ] {
        let error = match counter(format.clone()) {
            Ok(_) => panic!("{format} 应当被拒"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains(needle), "{format}: {error}");
    }
}
