//! `"{param}"` 替换必须与 `bcut-core::resolve::resolve_ref` 逐位相同。
//!
//! 两条路径并存是有意的：项目级 preset 走 `resolve_ref`（它还要认 `$vars/$theme`），
//! 内置 manifest 走 `preset_registry::substitute`（`bcut-motion` 不能依赖 `bcut-core`）。
//! 同一个模板必须给同一个结果，否则「内置与项目级没有格式差别」（规范 §7.4）就是假的。

use motion::preset_registry::substitute::{deep_substitute, substitute};
use scene_primitives::resolve::{Ctx, resolve_ref};
use serde_json::{Map, Value, json};

fn params() -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("distance".into(), json!(0.045));
    map.insert("count".into(), json!(24));
    map.insert("big".into(), json!(1.0e16));
    map.insert("neg".into(), json!(-3));
    map.insert("zero".into(), json!(0));
    map.insert("direction".into(), json!("up"));
    map.insert("fade".into(), json!(true));
    map.insert("nothing".into(), Value::Null);
    map.insert("list".into(), json!([1, 2]));
    map
}

fn ctx(params: &Map<String, Value>) -> Ctx {
    Ctx {
        vars: Map::new(),
        theme: Value::Null,
        assets: Value::Null,
        props: Some(params.clone()),
        extra_delay: 0.0,
    }
}

const TEMPLATES: &[&str] = &[
    "{distance}",
    "{count}",
    "{big}",
    "{neg}",
    "{zero}",
    "{direction}",
    "{fade}",
    "{nothing}",
    "{list}",
    "{missing}",
    "",
    "plain",
    "共 {count} 人",
    "{count}/{count}",
    "d={distance} dir={direction}",
    "f={fade} n={nothing} l={list}",
    "{ not a name }",
    "{count",
    "count}",
    "{}",
    "{a-b}",
    "prefix{missing}suffix",
];

#[test]
fn every_template_matches_resolve_ref_bit_for_bit() {
    let params = params();
    let ctx = ctx(&params);
    for raw in TEMPLATES {
        let ours = substitute(&json!(raw), &params);
        let theirs = resolve_ref(&json!(raw), &ctx);
        assert_eq!(
            serde_json::to_string(&ours).unwrap(),
            serde_json::to_string(&theirs).unwrap(),
            "template {raw:?}"
        );
    }
}

#[test]
fn deep_substitute_matches_deep_resolve() {
    let params = params();
    let ctx = ctx(&params);
    let doc = json!({
        "v": "{distance}",
        "nested": {"t": "0%", "v": {"value": "{distance}", "basis": "canvasShortEdge"}},
        "list": ["{direction}", 1, "共 {count} 人", null],
    });
    assert_eq!(
        serde_json::to_string(&deep_substitute(&doc, &params)).unwrap(),
        serde_json::to_string(&scene_primitives::resolve::deep_resolve(&doc, &ctx)).unwrap()
    );
}

#[test]
fn non_strings_pass_through_untouched() {
    let params = params();
    for value in [json!(1), json!(null), json!(true), json!([1, 2])] {
        assert_eq!(substitute(&value, &params), value);
    }
}
