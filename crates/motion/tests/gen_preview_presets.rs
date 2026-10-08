//! `core/runtime/preview/vendor/presets.json` 的生成器（预览壳内嵌进 `bcut serve`）。
//!
//! 浏览器预览曾经是 BCF 内置配方的**第四份实现**（`preview/core.js` 里手写的 5 个
//! `BUILTIN_PRESETS`）。阶段 2 新增的 canonical family 落地后，预览对 `motion.*`
//! 直接报 `preset-unknown`（设计 §9 / §15 阶段 2「已知缺口」）。处置不是把数值表
//! 手抄第二遍，而是**从同一批 manifest 生成一份数据**：`core.js` 只保留展开算法，
//! 一个数字都不复制。
//!
//! 跑法（`#[ignore]`，日常 `cargo test` 不写盘）：
//!
//! ```sh
//! cargo test -p bcut-motion --test gen_preview_presets -- --ignored emit_preview_presets_json
//! ```
//!
//! 日常门禁是同文件的 `preview_presets_json_is_up_to_date`：渲染到内存后逐字节比对。

use std::collections::BTreeMap;
use std::path::PathBuf;

use motion::preset_registry::{aliases, manifest_ids};
use serde_json::{Map, Value};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root")
}

fn target_path() -> PathBuf {
    repo_root().join("core/runtime/preview/vendor/presets.json")
}

/// 生成 JSON 文本。数值全部来自 `core/presets/builtin/motion/motion.*.json` 原文。
fn render() -> String {
    let dir = repo_root().join("core/presets/builtin/motion");
    let mut presets: BTreeMap<String, Value> = BTreeMap::new();
    for id in manifest_ids() {
        let path = dir.join(format!("{id}.json"));
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
        let doc: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path:?}: {e}"));
        assert_eq!(
            doc.get("id").and_then(Value::as_str),
            Some(id),
            "{path:?}: 文件名与 manifest id 不一致"
        );
        presets.insert(id.to_owned(), doc);
    }
    let alias_map: BTreeMap<String, String> = aliases()
        .into_iter()
        .map(|(alias, canonical)| (alias.to_owned(), canonical.to_owned()))
        .collect();

    let mut root = Map::new();
    root.insert(
        "generatedBy".into(),
        Value::from("core/crates/bcut-motion/tests/gen_preview_presets.rs"),
    );
    root.insert(
        "source".into(),
        Value::from("core/presets/builtin/motion/motion.*.json"),
    );
    root.insert(
        "note".into(),
        Value::from(
            "生成物，请勿手改。展开算法在 preview/core.js（镜像 bcut-motion 的 \
             preset_registry::compose）；ops 体配方在浏览器预览里不展开。",
        ),
    );
    root.insert("aliases".into(), serde_json::to_value(alias_map).unwrap());
    root.insert("presets".into(), serde_json::to_value(presets).unwrap());
    let mut text = serde_json::to_string_pretty(&Value::Object(root)).expect("json");
    text.push('\n');
    text
}

#[test]
#[ignore = "写盘：cargo test -p bcut-motion --test gen_preview_presets -- --ignored"]
fn emit_preview_presets_json() {
    let path = target_path();
    std::fs::write(&path, render()).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    eprintln!("wrote {path:?}");
}

#[test]
#[ignore = "对拍 v2 的预览壳生成物 core/runtime/preview/vendor/presets.json：v3 没有这份文件，待预览 WASM 批次决定去留"]
fn preview_presets_json_is_up_to_date() {
    let path = target_path();
    let on_disk = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{path:?}: {e}（先跑 --ignored emit_preview_presets_json）"));
    assert_eq!(
        on_disk,
        render(),
        "vendor/presets.json 与 core/presets/builtin/motion 不同步；\
         跑 `cargo test -p bcut-motion --test gen_preview_presets -- --ignored`"
    );
}

/// 预览的展开器只认 `tracks` / `compose`；`ops` 体它会给出明确提示而不是画错。
/// 这条测试保证「哪些配方在预览里可用」是**可枚举**的，而不是碰运气。
#[test]
#[ignore = "读 v2 的预览壳生成物 core/runtime/preview/vendor/presets.json：v3 没有这份文件，待预览 WASM 批次决定去留"]
fn the_generated_registry_declares_which_recipes_the_preview_can_expand() {
    let text = std::fs::read_to_string(target_path()).expect("presets.json");
    let registry: Value = serde_json::from_str(&text).expect("json");
    let presets = registry["presets"].as_object().expect("presets");
    let mut ops_bodied: Vec<&str> = presets
        .iter()
        .filter(|(_, doc)| doc.get("ops").is_some())
        .map(|(id, _)| id.as_str())
        .collect();
    ops_bodied.sort_unstable();
    assert_eq!(
        ops_bodied,
        vec!["motion.drift", "motion.seededJitter", "motion.shake"],
        "ops 体配方名单变了：同步 preview/core.js 的提示与作者文档"
    );
    for (_, doc) in presets {
        assert!(
            doc.get("tracks").is_some() || doc.get("compose").is_some() || doc.get("ops").is_some(),
            "{doc:?} 没有可展开的体"
        );
    }
}
