//! 手绘能力的 lint 契约（规范 §6.2.1 / §6.3 / §16）。

use scene_primitives::lint::{Severity, lint};
use serde_json::{Value, json};

fn doc(element: Value) -> Value {
    json!({
        "bcut": "0.2",
        "meta": {"id": "sk", "width": 240, "height": 160, "fps": 30, "background": "#ffffff"},
        "scenes": [{"id": "s", "dur": 2, "desc": "手绘夹具"}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": element}
        ]}]
    })
}

fn svg(children: Value) -> Value {
    json!({
        "type": "svg", "id": "art", "viewBox": "0 0 100 100",
        "style": {"width": 100, "height": 100}, "children": children
    })
}

fn rules(doc: &Value) -> Vec<(&'static str, Severity)> {
    lint(doc)
        .into_iter()
        .map(|d| (d.rule, d.severity))
        .collect()
}

#[test]
fn full_path_grammar_is_clean() {
    let d =
        "M10 10 h20 v20 H10 Z m40 0 c5-5 15-5 20 0 s15 5 20 0 q5 10 0 20 t-10 10 a8 8 0 0 1-16 0 z";
    let found = rules(&doc(svg(json!([
        {"type": "path", "d": d, "fill": "#f00", "fillRule": "evenodd",
         "texture": {"finish": "riso", "seed": 4},
         "stroke": "#000", "lineCap": "butt", "lineJoin": "miter", "dash": [4, 2],
         "wobble": {"amp": 1, "seed": 1, "every": 2}}
    ]))));
    assert!(
        found
            .iter()
            .all(|(_, severity)| *severity != Severity::Error),
        "{found:?}"
    );
}

#[test]
fn unsupported_path_commands_are_errors_with_a_pointer() {
    let diagnostics = lint(&doc(svg(json!([
        {"type": "path", "d": "M0 0 L10 10 R 5 5 X", "stroke": "#000"}
    ]))));
    let hit = diagnostics
        .iter()
        .find(|d| d.rule == "path-command-unsupported")
        .expect("应报 path-command-unsupported");
    assert_eq!(hit.severity, Severity::Error);
    assert!(hit.pointer.ends_with("/children/0/d"), "{}", hit.pointer);
    assert!(hit.message.contains('R') && hit.message.contains('X'));
}

#[test]
fn path_outside_svg_warns() {
    let found = rules(&doc(json!({
        "type": "box", "id": "b", "style": {"width": 100, "height": 100},
        "children": [{"type": "path", "d": "M0 0 L1 1", "stroke": "#000"}]
    })));
    assert!(
        found.contains(&("path-outside-svg", Severity::Warn)),
        "{found:?}"
    );
}

#[test]
fn non_path_children_of_svg_warn() {
    let found = rules(&doc(svg(json!([
        {"type": "path", "d": "M0 0 L1 1", "stroke": "#000"},
        {"type": "text", "id": "label", "text": "hi", "style": {"fontSize": 20}}
    ]))));
    let hits: Vec<_> = found
        .iter()
        .filter(|(rule, _)| *rule == "svg-child-unsupported")
        .collect();
    assert_eq!(
        hits,
        [&("svg-child-unsupported", Severity::Warn)],
        "{found:?}"
    );
}

#[test]
fn clip_path_shape_path_lints() {
    let clean = rules(&doc(json!({
        "type": "box", "id": "b",
        "style": {"width": 100, "height": 100, "clipPath": {"shape": "path", "d": "M0 0 L1 0 L0 1 Z"}}
    })));
    assert!(
        clean.iter().all(|(_, s)| *s != Severity::Error),
        "{clean:?}"
    );

    let even_odd = rules(&doc(json!({
        "type": "box", "id": "b",
        "style": {"width": 100, "height": 100,
                  "clipPath": {"shape": "path", "d": "M0 0 L1 0 L0 1 Z", "fillRule": "evenodd"}}
    })));
    assert!(
        even_odd.contains(&("clip-path-evenodd", Severity::Warn)),
        "{even_odd:?}"
    );

    let bad = rules(&doc(json!({
        "type": "box", "id": "b",
        "style": {"width": 100, "height": 100, "clipPath": {"shape": "path", "d": "M0 0 L1 0 K 3 Z"}}
    })));
    assert!(
        bad.contains(&("path-command-unsupported", Severity::Error)),
        "{bad:?}"
    );
}

fn cadence_doc(fps: f64, cadence: Value, second_start: f64, transition: Option<&str>) -> Value {
    let mut first = json!({"id": "a", "start": 0, "end": second_start,
        "element": {"type": "box", "id": "pa", "style": {"width": 10, "height": 10}}});
    if let Some(preset) = transition {
        first["transitionOut"] = json!({"preset": preset, "dur": 0.2});
    }
    json!({
        "bcut": "0.2",
        "meta": {"id": "sk", "width": 240, "height": 160, "fps": fps, "cadence": cadence},
        "scenes": [{"id": "s", "dur": 2, "desc": "cadence 夹具"}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            first,
            {"id": "b", "start": second_start, "end": "@s.end",
             "element": {"type": "box", "id": "pb", "style": {"width": 10, "height": 10}}}
        ]}]
    })
}

#[test]
fn cadence_rules_fire_only_inside_a_sampling_domain() {
    let has = |doc: &Value, rule: &str| rules(doc).iter().any(|(r, _)| *r == rule);

    // 12fps 域、24fps 输出、切点落格、硬切：三条都不触发
    let clean = cadence_doc(24.0, json!({"fps": 12}), 1.0, None);
    for rule in [
        "cue-off-grid",
        "transition-in-sketch",
        "cadence-fps-mismatch",
    ] {
        assert!(!has(&clean, rule), "{rule}: {:?}", rules(&clean));
    }

    // 切点不在 1/12 格上
    assert!(has(
        &cadence_doc(24.0, json!({"fps": 12}), 1.03, None),
        "cue-off-grid"
    ));
    // 30fps 输出不是 12 的整数倍：info
    let mismatch = cadence_doc(30.0, json!({"fps": 12}), 1.0, None);
    assert!(rules(&mismatch).contains(&("cadence-fps-mismatch", Severity::Info)));
    // crossfade 进了采样域
    assert!(has(
        &cadence_doc(24.0, json!({"fps": 12}), 1.0, Some("crossfade")),
        "transition-in-sketch"
    ));
    assert!(!has(
        &cadence_doc(24.0, json!({"fps": 12}), 1.0, Some("transition.inkBlot")),
        "transition-in-sketch"
    ));

    // 没有 cadence 的普通文档：同样的写法一条都不报
    let mut plain = cadence_doc(30.0, json!({"fps": 12}), 1.03, Some("crossfade"));
    plain["meta"].as_object_mut().unwrap().remove("cadence");
    for rule in [
        "cue-off-grid",
        "transition-in-sketch",
        "cadence-fps-mismatch",
    ] {
        assert!(!has(&plain, rule), "{rule}: {:?}", rules(&plain));
    }
}

fn sketch_rules(doc: &Value) -> Vec<&'static str> {
    use scene_primitives::lint::{LintOptions, LintProfile, lint_with_options};
    lint_with_options(
        doc,
        None,
        LintOptions {
            profile: LintProfile::Sketch,
        },
    )
    .iter()
    .map(|d| d.rule)
    .filter(|rule| rule.starts_with("sketch-"))
    .collect()
}

fn sketch_doc(paths: Value, with_text_in_first: bool) -> Value {
    let mut first = vec![
        json!({"type": "svg", "id": "art", "viewBox": [0, 0, 100, 100],
        "style": {"width": 100, "height": 100}, "children": paths}),
    ];
    if with_text_in_first {
        first.push(json!({"type": "text", "id": "label", "text": "hi", "style": {"fontSize": 12}}));
    }
    json!({
        "bcut": "0.2",
        "meta": {"id": "sk", "width": 240, "height": 160, "fps": 24},
        "theme": {"look": {"ink": "#1f2430", "fill1": "#e0a458", "paper": "#f6efe2"}},
        "scenes": [
            {"id": "a", "dur": 1, "desc": "画面"},
            {"id": "end", "dur": 1, "desc": "落款"}
        ],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "ca", "start": "@a", "end": "@a.end",
             "element": {"type": "box", "id": "ra", "children": first}},
            {"id": "cend", "start": "@end", "end": "@end.end",
             "element": {"type": "text", "id": "sign", "text": "fin", "style": {"fontSize": 12}}}
        ]}]
    })
}

#[test]
fn sketch_profile_flags_mixed_finish_off_palette_and_stray_text() {
    let square = "M10 10 L90 10 L90 90 L10 90 Z";
    let clean = sketch_doc(
        json!([{"type": "path", "id": "p1", "d": square, "fill": "$theme.look.fill1",
                "stroke": "#1f2430", "texture": {"finish": "ink", "color": "$theme.look.ink"}},
               {"type": "path", "id": "p2", "d": square, "fill": "#f6efe2",
                "texture": {"finish": "grain", "color": "#1f2430"}}]),
        false,
    );
    assert!(
        sketch_rules(&clean).is_empty(),
        "{:?}",
        sketch_rules(&clean)
    );
    // document 剖面永远不报 sketch-*
    assert!(!rules(&clean).iter().any(|(r, _)| r.starts_with("sketch-")));

    let messy = sketch_doc(
        json!([{"type": "path", "id": "p1", "d": square, "fill": "#ff00aa",
                "texture": {"finish": "ink", "color": "#1f2430"}},
               {"type": "path", "id": "p2", "d": square, "fill": "#e0a458",
                "texture": {"finish": "riso", "color": "#1f2430"}}]),
        true,
    );
    let got = sketch_rules(&messy);
    for rule in [
        "sketch-mixed-finish",
        "sketch-color-off-palette",
        "sketch-text-outside-signoff",
    ] {
        assert_eq!(
            got.iter().filter(|r| **r == rule).count(),
            1,
            "{rule}: {got:?}"
        );
    }
    // 同样的脏文档在 document 剖面下一条都不报
    assert!(!rules(&messy).iter().any(|(r, _)| r.starts_with("sketch-")));
}
