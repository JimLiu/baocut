//! 作者溯源反查表的 **Rust ↔ 预览壳镜像对拍**（BCF 直接编辑回写方案 §4.3-3）。
//!
//! `expand_node` 铸派生 id 的地方就是登记反查表的地方，`preview/resolve.js` 逐位
//! 镜像同一套规则。两侧一旦漂移，舞台上点中的节点就会折回错误的作者节点——那正是
//! W2 字节手术最不能出错的一环，所以这里用真实的 `node` 跑一遍 JS 实现来对拍。
//!
//! 没有 `node` 的环境（CI 的纯 Rust 镜像）直接跳过：这是镜像纪律的守卫，不是
//! core 语义的守卫，core 侧的语义由 `resolve` 自己的单测盯着。

use std::path::PathBuf;
use std::process::Command;

use scene_primitives::resolve::{Resolver, edit_origins};
use serde_json::{Value, json};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root")
}

/// 组件 + `each` + 匿名兄弟：三种路径段形态一次盖全。
fn doc() -> Value {
    json!({
        "meta": {"id": "mirror", "width": 1920, "height": 1080, "fps": 30},
        "scenes": [{"id": "s", "dur": 3, "desc": "对拍"}],
        "components": {
            "Card": {
                "props": {"label": {"type": "string"}},
                "root": {"type": "box", "id": "card", "children": [
                    {"type": "text", "id": "label", "text": "$props.label"},
                    {"type": "box"}
                ]}
            }
        },
        "tracks": [{"id": "main", "kind": "visual", "clips": [{
            "id": "shot", "start": "@s", "end": "@s.end",
            "element": {"type": "box", "id": "stage", "children": [
                {"type": "text", "id": "title", "text": "标题"},
                {"type": "box"},
                {"type": "box"},
                {"type": "use", "id": "cards", "component": "Card",
                 "each": [{"label": "甲"}, {"label": "乙"}]}
            ]}
        }]}]
    })
}

fn rust_origins(doc: &Value) -> Value {
    let resolver = Resolver::new(doc.clone(), None).expect("resolver");
    let element = &doc["tracks"][0]["clips"][0]["element"];
    let tree = resolver
        .expand_node(element, &resolver.ctx.clone())
        .expect("expand");
    Value::Array(edit_origins(&tree).iter().map(|e| e.to_json()).collect())
}

/// 用 `node` 跑预览壳的 `resolveAll` + `editOrigins`。`None` = 环境里没有 node。
fn js_origins(doc: &Value) -> Option<Value> {
    let preview = repo_root().join("core/runtime/preview/resolve.js");
    let module = preview.to_string_lossy().replace('\\', "\\\\");
    let script = format!(
        r#"import {{ resolveAll, editOrigins }} from "file://{module}";
const doc = JSON.parse(process.argv[1]);
const ir = resolveAll(doc);
process.stdout.write(JSON.stringify(editOrigins(ir.visualClips[0].tree)));
"#
    );
    let output = Command::new("node")
        .args(["--input-type=module", "--eval", &script, "--"])
        .arg(doc.to_string())
        .output()
        .ok()?;
    assert!(
        output.status.success(),
        "预览壳 resolve.js 跑不起来：{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Some(serde_json::from_slice(&output.stdout).expect("editOrigins 输出不是 JSON"))
}

#[test]
#[ignore = "用 node 对拍 v2 预览壳 core/runtime/preview/resolve.js：v3 不移植该预览壳（BCF 不在 v3）"]
fn the_preview_shell_mirrors_the_rust_origin_table() {
    let doc = doc();
    let rust = rust_origins(&doc);

    // 先自证 Rust 侧本身说得对：组件展开的节点必须带 component / site / index，
    // 直接写在 clip 里的节点必须只有 authored。
    let row = |resolved: &str| {
        rust.as_array()
            .unwrap()
            .iter()
            .find(|e| e["resolved"] == resolved)
            .unwrap_or_else(|| panic!("反查表里没有 {resolved}：{rust:#}"))
            .clone()
    };
    assert_eq!(row("title")["origin"], json!({"authored": "title"}));
    // 匿名兄弟退化成下标段
    assert_eq!(row("#1")["origin"], json!({"authored": "#1"}));
    // use 节点本身仍是作者节点（可编辑它的 props / each）
    assert_eq!(row("cards")["origin"], json!({"authored": "cards"}));
    // 逐实例的 wrapper：id 是编译器铸的 `cards-0`，溯源指回实例化点
    assert_eq!(
        row("cards/cards-0")["origin"],
        json!({"authored": "cards", "component": "Card", "site": "cards", "index": 0})
    );
    // 组件内部节点：authored 从**组件根**起算
    assert_eq!(
        row("cards/cards-1/card/label")["origin"],
        json!({"authored": "label", "component": "Card", "site": "cards", "index": 1})
    );

    let Some(js) = js_origins(&doc) else {
        eprintln!("跳过镜像对拍：环境里没有 node");
        return;
    };
    assert_eq!(js, rust, "预览壳 resolve.js 与 bcut-core 的反查表漂移了");
}
