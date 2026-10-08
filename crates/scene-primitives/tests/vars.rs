//! 变量与批量渲染（§5.1 / §11.1 / §11.2）：
//! variables 类型校验、asset 变量委托、scenes[].dur 变量引用。

use scene_primitives::{Resolver, host_requirements, host_requirements_with_vars};
use serde_json::{Map, Value, json};

fn doc() -> Value {
    json!({
        "meta": { "id": "vars", "width": 1920, "height": 1080, "fps": 30 },
        "variables": [
            { "id": "heroDur", "type": "number", "default": 5 },
            { "id": "heroClip", "type": "asset",
              "default": { "src": "assets/default.mp4" } }
        ],
        "scenes": [
            { "id": "hero", "dur": "$vars.heroDur", "desc": "个性化片段" },
            { "id": "outro", "dur": 3, "desc": "收尾" }
        ],
        "assets": {
            "hero": { "type": "video", "var": "heroClip" }
        },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": "@hero", "end": "@outro.end", "element": {
                    "type": "video", "id": "v", "src": "$assets.hero",
                    "style": { "width": 640, "height": 360 } } }
            ] }
        ]
    })
}

fn overrides() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("heroDur".into(), json!(9));
    m.insert(
        "heroClip".into(),
        json!({ "src": "assets/customer-a.mp4",
                "hash": format!("sha256-{}", "ab".repeat(32)) }),
    );
    m
}

#[test]
fn asset_var_delegation_resolves_requirements() {
    let reqs = host_requirements(&doc()).unwrap();
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].src, "assets/default.mp4");
    assert!(reqs[0].hash.is_none());

    let reqs = host_requirements_with_vars(&doc(), Some(&overrides())).unwrap();
    assert_eq!(reqs[0].src, "assets/customer-a.mp4");
    assert!(reqs[0].hash.as_deref().unwrap().starts_with("sha256-"));
}

#[test]
fn scene_dur_variable_reflows_document() {
    let mut r = Resolver::new(doc(), None).unwrap();
    let ir = r.resolve().unwrap();
    assert_eq!(ir.total, 8.0);
    assert_eq!(
        (ir.visual_clips[0].start, ir.visual_clips[0].end),
        (0.0, 8.0)
    );

    let mut r = Resolver::new(doc(), Some(&overrides())).unwrap();
    let ir = r.resolve().unwrap();
    assert_eq!(ir.total, 12.0);
    assert_eq!(ir.visual_clips[0].end, 12.0);
}

#[test]
fn asset_var_src_resolves_in_ctx() {
    let r = Resolver::new(doc(), Some(&overrides())).unwrap();
    let src = scene_primitives::resolve::resolve_ref(&json!("$assets.hero"), &r.ctx);
    assert_eq!(src, json!("assets/customer-a.mp4"));
}

#[test]
fn lint_variable_and_asset_var_rules() {
    let mut bad = doc();
    bad["variables"].as_array_mut().unwrap().extend([
        json!({ "id": "x", "type": "gradient", "default": 1 }), // 未知类型
        json!({ "id": "mode", "type": "enum", "default": "a" }), // enum 缺 options
        json!({ "id": "clip2", "type": "asset",
                "default": { "media": "interview" } }), // media 形态
    ]);
    bad["assets"]["hero2"] = json!({ "type": "video", "src": "a.mp4", "var": "heroClip" }); // src+var 互斥
    bad["assets"]["hero3"] = json!({ "type": "video", "var": "heroDur" }); // 委托非 asset 变量
    bad["assets"]["hero4"] = json!({ "type": "video", "var": "ghost" }); // 委托未声明变量
    let diags = scene_primitives::lint::lint(&bad);
    let msgs: Vec<String> = diags
        .iter()
        .map(|d| format!("{} {}", d.rule, d.message))
        .collect();
    assert!(msgs.iter().any(|m| m.contains("gradient")), "{msgs:?}");
    assert!(msgs.iter().any(|m| m.contains("options")), "{msgs:?}");
    assert!(
        diags
            .iter()
            .any(|d| d.rule == "asset-media-outside-project"),
        "{msgs:?}"
    );
    assert!(msgs.iter().any(|m| m.contains("互斥")), "{msgs:?}");
    assert!(msgs.iter().any(|m| m.contains("须为 asset")), "{msgs:?}");
    assert!(msgs.iter().any(|m| m.contains("未声明")), "{msgs:?}");
}

#[test]
fn lint_scene_dur_accepts_var_and_rejects_garbage() {
    let clean = doc();
    let diags = scene_primitives::lint::lint(&clean);
    assert!(
        !diags
            .iter()
            .any(|d| d.severity == scene_primitives::lint::Severity::Error),
        "{diags:?}"
    );
    let mut bad = doc();
    bad["scenes"][0]["dur"] = json!("very long");
    let diags = scene_primitives::lint::lint(&bad);
    assert!(
        diags
            .iter()
            .any(|d| d.rule == "schema" && d.pointer == "/scenes/0/dur"),
        "{diags:?}"
    );
}
