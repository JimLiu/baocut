//! 规范 §6.3 新定型的样式值：`background` 渐变对象、`shadow`、`fontStyle`、`mask`，
//! 以及 §6.4 的 `rotationX` / `rotationY` 拒绝。
//!
//! 这些键此前要么 lint 放行而渲染画不出（CSS 渐变字串、`shadow` 字串、
//! `rotationX`），要么根本不在子集里（`fontStyle`、`mask`）。本文件把两种
//! 「静默」都钉死成诊断或可解析结构。

use scene_primitives::lint::lint;
use scene_primitives::resolve::{BgGradient, BoxBorder, BoxShadow, ElementMask, Resolver};
use serde_json::{Value, json};

fn doc_with_children(children: Value) -> Value {
    json!({
        "bcut": "0.2",
        "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "s", "dur": 3}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end",
             "element": {"type": "box", "id": "stage",
                         "style": {"width": 1920, "height": 1080},
                         "children": children}}
        ]}]
    })
}

fn codes(doc: &Value) -> Vec<(&'static str, String)> {
    lint(doc).into_iter().map(|d| (d.rule, d.message)).collect()
}

fn has_code(doc: &Value, rule: &str, needle: &str) -> bool {
    codes(doc)
        .iter()
        .any(|(r, m)| *r == rule && m.contains(needle))
}

fn resolve_err(doc: &Value) -> String {
    Resolver::new(doc.clone(), None)
        .unwrap()
        .resolve()
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default()
}

// ── background ────────────────────────────────────────────────────────

#[test]
fn css_gradient_string_is_a_schema_error_not_a_silent_no_op() {
    let doc = doc_with_children(json!([{
        "type": "box", "id": "bg",
        "style": {"width": 100, "height": 100,
                  "background": "linear-gradient(160deg, #1050e0, #c080ff)"}
    }]));
    assert!(
        has_code(&doc, "schema", "CSS 渐变字串"),
        "{:?}",
        codes(&doc)
    );
    assert!(resolve_err(&doc).contains("CSS 渐变字串"));
}

#[test]
fn gradient_object_parses_and_defaults_even_stops() {
    let g = BgGradient::parse(&json!({
        "kind": "linear", "angle": 160,
        "stops": [{"color": "#1050e0"}, {"color": "#ffffff"}, {"color": "#c080ff"}]
    }))
    .unwrap()
    .unwrap();
    let BgGradient::Linear { angle, stops } = g else {
        panic!("linear");
    };
    assert_eq!(angle, 160.0);
    assert_eq!(stops.len(), 3);
    assert_eq!(stops[1].0, 0.5);

    let r = BgGradient::parse(&json!({
        "kind": "radial", "cx": 0.3, "cy": 0.3, "r": 0.9,
        "stops": [{"at": 0, "color": "#fff"}, {"at": 1, "color": "#ffd080"}]
    }))
    .unwrap()
    .unwrap();
    assert!(matches!(r, BgGradient::Radial { cx, .. } if cx == 0.3));

    // 颜色字串 ⇒ None（交给 Rgba）；坏颜色 ⇒ 错
    assert!(BgGradient::parse(&json!("#123456")).unwrap().is_none());
    assert!(BgGradient::parse(&json!("not-a-color")).is_err());
    assert!(BgGradient::parse(&json!({"kind": "conic", "stops": []})).is_err());
    assert!(
        BgGradient::parse(&json!({"kind": "linear", "stops": [{"color": "#fff"}]})).is_err(),
        "至少两个色标"
    );
    assert!(
        BgGradient::parse(&json!({"kind": "linear",
            "stops": [{"at": 0.8, "color": "#fff"}, {"at": 0.2, "color": "#000"}]}))
        .is_err(),
        "at 必须单调"
    );
}

#[test]
fn gradient_object_in_document_lints_clean_and_resolves() {
    let doc = doc_with_children(json!([{
        "type": "box", "id": "bg",
        "style": {"width": 100, "height": 100,
                  "background": {"kind": "linear", "angle": 90,
                                 "stops": [{"at": 0, "color": "#000"}, {"at": 1, "color": "#fff"}]}}
    }]));
    let errors: Vec<_> = codes(&doc)
        .into_iter()
        .filter(|(r, _)| *r == "schema" || *r == "resolve-error")
        .collect();
    assert!(errors.is_empty(), "{errors:?}");
    let ir = Resolver::new(doc, None).unwrap().resolve().unwrap();
    let node = &ir.visual_clips[0].tree.children[0];
    assert!(node.bg_gradient.is_some());
    assert!(node.bg_color.is_none());
}

#[test]
fn theme_reference_background_is_left_to_resolve() {
    let mut doc = doc_with_children(json!([{
        "type": "box", "id": "bg",
        "style": {"width": 100, "height": 100, "background": "$theme.paper"}
    }]));
    doc["theme"] = json!({"paper": "#f6f5f1"});
    assert!(!has_code(&doc, "schema", "background"), "{:?}", codes(&doc));
    assert!(resolve_err(&doc).is_empty());
}

// ── shadow ────────────────────────────────────────────────────────────

#[test]
fn shadow_object_becomes_a_drop_shadow_effect() {
    let doc = doc_with_children(json!([{
        "type": "box", "id": "card",
        "style": {"width": 600, "height": 120, "background": "#fff",
                  "shadow": {"blur": 54, "dx": 0, "dy": 27, "color": "rgba(0,0,0,0.35)"}}
    }]));
    assert!(!has_code(&doc, "schema", "shadow"), "{:?}", codes(&doc));
    let ir = Resolver::new(doc, None).unwrap().resolve().unwrap();
    let node = &ir.visual_clips[0].tree.children[0];
    assert_eq!(node.effects.len(), 1);
    assert_eq!(node.effects[0].effect.id, "filter.dropShadow");
    // 像素 / 画布短边（1080）
    let radius = node.effects[0].uniforms.scalar("radius").unwrap();
    assert!((radius - 54.0 / 1080.0).abs() < 1e-9, "{radius}");
    let dy = node.effects[0].uniforms.scalar("dy").unwrap();
    assert!((dy - 27.0 / 1080.0).abs() < 1e-9, "{dy}");
}

#[test]
fn shadow_string_or_unknown_key_is_a_schema_error() {
    let doc = doc_with_children(json!([{
        "type": "box", "id": "card",
        "style": {"width": 10, "height": 10, "shadow": "0 16px 34px rgba(0,0,0,.2)"}
    }]));
    assert!(
        has_code(&doc, "schema", "style.shadow 必须是对象"),
        "{:?}",
        codes(&doc)
    );
    assert!(BoxShadow::parse(&json!({"blur": 4, "spread": 2})).is_err());
    assert!(BoxShadow::parse(&json!({"blur": -1})).is_err());
}

// ── border ────────────────────────────────────────────────────────────

#[test]
fn border_object_resolves_and_css_shorthand_is_a_schema_error() {
    let doc = doc_with_children(json!([{
        "type": "box", "id": "card",
        "style": {"width": 10, "height": 10, "border": {"width": 3, "color": "#123456"}}
    }]));
    assert!(!has_code(&doc, "schema", "border"), "{:?}", codes(&doc));
    let ir = Resolver::new(doc, None).unwrap().resolve().unwrap();
    let node = &ir.visual_clips[0].tree.children[0];
    assert_eq!(node.border.map(|b| b.width), Some(3.0));

    let css = doc_with_children(json!([{
        "type": "box", "id": "card",
        "style": {"width": 10, "height": 10, "border": "2px solid #000"}
    }]));
    assert!(
        has_code(&css, "schema", "style.border 必须是对象"),
        "{:?}",
        codes(&css)
    );
    assert!(
        resolve_err(&css).contains("style.border"),
        "{}",
        resolve_err(&css)
    );
    assert!(BoxBorder::parse(&json!({"width": 0, "color": "#000"})).is_err());
    assert!(BoxBorder::parse(&json!({"width": 2})).is_err());
    assert!(BoxBorder::parse(&json!({"width": 2, "color": "#000", "style": "dashed"})).is_err());
}

// ── fontStyle ─────────────────────────────────────────────────────────

#[test]
fn font_style_italic_is_in_the_subset_and_resolves() {
    let doc = doc_with_children(json!([{
        "type": "text", "id": "t", "text": "hi",
        "style": {"fontSize": 40, "fontStyle": "italic"}
    }]));
    assert!(!has_code(&doc, "schema", "fontStyle"), "{:?}", codes(&doc));
    let ir = Resolver::new(doc, None).unwrap().resolve().unwrap();
    assert!(ir.visual_clips[0].tree.children[0].font_italic);

    let bad = doc_with_children(json!([{
        "type": "text", "id": "t", "text": "hi",
        "style": {"fontSize": 40, "fontStyle": "oblique"}
    }]));
    assert!(
        has_code(&bad, "schema", "normal | italic"),
        "{:?}",
        codes(&bad)
    );
}

// ── mask ──────────────────────────────────────────────────────────────

fn masked_pair(mask: Value, extra: Value) -> Value {
    let mut children = vec![
        json!({"type": "image", "id": "tex", "src": "$assets.tex",
               "style": {"x": 0, "y": 0, "width": 800, "height": 300, "mask": mask}}),
        json!({"type": "text", "id": "word", "text": "METAL",
               "style": {"x": 0, "y": 0, "width": 800, "height": 300, "fontSize": 200}}),
    ];
    if let Some(items) = extra.as_array() {
        children.extend(items.iter().cloned());
    }
    let mut doc = doc_with_children(Value::Array(children));
    doc["assets"] = json!({"tex": {"type": "image", "src": "assets/tex.png"}});
    doc
}

#[test]
fn element_mask_parses_and_links_its_source() {
    let m =
        ElementMask::parse(&json!({"source": "#word", "mode": "luma", "invert": true})).unwrap();
    assert_eq!(m.source, "word");
    assert!(m.luma && m.invert);
    assert!(
        ElementMask::parse(&json!({"source": "word"})).is_err(),
        "必须带 #"
    );
    assert!(ElementMask::parse(&json!({"source": "#w", "mode": "alpha2"})).is_err());
    assert!(ElementMask::parse(&json!({"source": "#w", "feather": 2})).is_err());

    let doc = masked_pair(json!({"source": "#word"}), Value::Null);
    let errors: Vec<_> = codes(&doc)
        .into_iter()
        .filter(|(r, _)| *r == "schema" || *r == "resolve-error" || *r == "mask-source-unknown")
        .collect();
    assert!(errors.is_empty(), "{errors:?}");
    let ir = Resolver::new(doc, None).unwrap().resolve().unwrap();
    let tree = &ir.visual_clips[0].tree;
    assert!(tree.children[0].mask.is_some());
    assert!(!tree.children[0].mask_source);
    assert!(tree.children[1].mask_source, "源元素被标成遮罩定义");
}

#[test]
fn mask_source_unknown_when_missing_or_ancestor() {
    let doc = masked_pair(json!({"source": "#nope"}), Value::Null);
    assert!(
        has_code(&doc, "mask-source-unknown", "找不到"),
        "{:?}",
        codes(&doc)
    );

    // 指向自己的祖先（stage）
    let doc = masked_pair(json!({"source": "#stage"}), Value::Null);
    assert!(
        has_code(&doc, "mask-source-unknown", "祖先或后代"),
        "{:?}",
        codes(&doc)
    );
}

#[test]
fn mask_source_subtree_can_carry_effects() {
    let mut doc = masked_pair(json!({"source": "#word"}), Value::Null);
    doc["tracks"][0]["clips"][0]["element"]["children"][1]["effects"] =
        json!([{"preset": "filter.blur", "params": {"radius": 0.01}}]);
    assert!(
        !has_code(&doc, "mask-source-unknown", "effects"),
        "{:?}",
        codes(&doc)
    );
}

#[test]
fn two_input_effect_on_element_points_at_style_mask() {
    let doc = doc_with_children(json!([{
        "type": "image", "id": "tex", "src": "$assets.tex",
        "style": {"width": 10, "height": 10},
        "effects": [{"preset": "mask.image"}]
    }]));
    assert!(
        has_code(&doc, "effect-capability-unsupported", "style.mask"),
        "{:?}",
        codes(&doc)
    );
}

// ── rotationX / rotationY ─────────────────────────────────────────────

#[test]
fn rotation_x_is_rejected_instead_of_rendering_nothing() {
    let doc = doc_with_children(json!([{
        "type": "box", "id": "card",
        "style": {"width": 800, "height": 300, "background": "#fff"},
        "animate": {"keyframes": [{"prop": "rotationX",
            "frames": [{"t": "0%", "v": 60}, {"t": "100%", "v": 0}]}]}
    }]));
    let err = resolve_err(&doc);
    assert!(
        err.contains("motion-unsupported") && err.contains("rotationX"),
        "{err}"
    );
    // lint 把它映射到 schema（§16 没有为未实现的运动能力定独立码）
    assert!(has_code(&doc, "schema", "rotationX"), "{:?}", codes(&doc));

    // skewX 是仿射，照常通过
    let ok = doc_with_children(json!([{
        "type": "box", "id": "card",
        "style": {"width": 800, "height": 300, "background": "#fff"},
        "animate": {"keyframes": [{"prop": "skewX",
            "frames": [{"t": "0%", "v": -20}, {"t": "100%", "v": 20}]}]}
    }]));
    assert!(resolve_err(&ok).is_empty());
}
