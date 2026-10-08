//! BCF 文档版本与 `0.1 → 0.2` 迁移（ADR-M13，规范 §4 / §16）。
//!
//! 0.2 做的**只有一件事**：把 0.1 草稿里标着「实验」的字段转正式
//! （`animate.flow` / `animate.parts` / `split` / `effects` / `style.blendMode` /
//! 结构化曲线 / `states` / `constraints` / `layoutStates`），并要求配方引用写死
//! 版本。语义一个字节都没变——**0.1 文档永远可读**，legacy 四槽、alias、
//! 旧字段名全部保留。
//!
//! 迁移因此是**非破坏性**的：只写 `bcut` / `motionVersion` 两个顶层键，
//! 并给已经引用了配方却没写 `presetVersion` 的地方补上当前实现版本。
//! 不重排字段、不删 legacy、不改任何取值。

use anyhow::{Result, bail};
use serde_json::{Map, Value};

use crate::json::JsonExt;
use crate::lint::{Diagnostic, Severity};

/// 本实现能读的全部 BCF 文档版本。**只增不删**：0.1 永远在列。
pub use crate::bcf_version::BCF_SUPPORTED as BCF_VERSIONS;

/// 新文档默认写的版本（`bcut migrate --to` 的缺省目标）。
pub use crate::bcf_version::BCF_CURRENT;

/// 缺 `bcut` 键的文档按这个版本读（`bcf-version-missing`，warn）。
pub const BCF_FALLBACK: &str = "0.1";

/// 0.2 文档声明的动画内核版本（`motionVersion`）。
pub const MOTION_VERSION: u64 = 1;

/// 文档声明的版本；缺键按 [`BCF_FALLBACK`]。
pub fn doc_version(doc: &Value) -> &str {
    doc.gstr("bcut").unwrap_or(BCF_FALLBACK)
}

pub fn is_supported(version: &str) -> bool {
    BCF_VERSIONS.contains(&version)
}

/// `0.1 → 0.2` 迁移（ADR-M13）。
///
/// `from` 为 `None` 时按文档自身声明；`to` 为 `None` 时按 [`BCF_CURRENT`]。
/// 返回迁移后的文档与过程诊断（补了哪些 `presetVersion`）。
pub fn migrate_doc(
    doc: &Value,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<(Value, Vec<Diagnostic>)> {
    let declared = doc_version(doc);
    let from = from.unwrap_or(declared);
    let to = to.unwrap_or(BCF_CURRENT);
    if !is_supported(from) {
        bail!("bcf-version-unsupported: 源版本 \"{from}\" 不在 {BCF_VERSIONS:?}");
    }
    if !is_supported(to) {
        bail!("bcf-version-unsupported: 目标版本 \"{to}\" 不在 {BCF_VERSIONS:?}");
    }
    if from != declared {
        bail!(
            "bcf-version-unsupported: --from \"{from}\" 与文档声明的 \"{declared}\" 不符；\
             迁移不猜版本"
        );
    }
    if from == to {
        return Ok((doc.clone(), Vec::new()));
    }
    if from != "0.1" || to != "0.2" {
        bail!("bcf-version-unsupported: 本实现只提供 0.1 → 0.2 的迁移路径");
    }
    let Some(object) = doc.as_object() else {
        bail!("schema: 文档根必须是对象");
    };

    let mut out = object.clone();
    let mut diagnostics = Vec::new();
    out.insert("bcut".to_owned(), Value::from(to));
    diagnostics.push(Diagnostic {
        rule: "bcf-version-missing",
        severity: Severity::Info,
        pointer: "/bcut".to_owned(),
        message: format!("bcut 版本写为 \"{to}\"（原声明 \"{declared}\"）"),
    });
    if !out.contains_key("motionVersion") {
        out.insert("motionVersion".to_owned(), Value::from(MOTION_VERSION));
        diagnostics.push(Diagnostic {
            rule: "bcf-version-missing",
            severity: Severity::Info,
            pointer: "/motionVersion".to_owned(),
            message: format!("补 motionVersion = {MOTION_VERSION}（ADR-M13）"),
        });
    }

    let mut migrated = Value::Object(out);
    backfill_preset_versions(&mut migrated, "", &mut diagnostics);
    Ok((migrated, diagnostics))
}

/// 递归补 `presetVersion`。
///
/// 判定刻意保守：只认「**同一个对象**里既有字符串 `preset`、又没有
/// `presetVersion`」这一种形状，并且只在注册表真的认识这个 id 时才写。
/// 项目自定义 `presets` 里的 id 查不到版本，原样留空（它们没有版本序列）。
fn backfill_preset_versions(value: &mut Value, ptr: &str, out: &mut Vec<Diagnostic>) {
    match value {
        Value::Object(map) => {
            if let Some(version) = preset_version_for(map) {
                map.insert("presetVersion".to_owned(), Value::from(version));
                out.push(Diagnostic {
                    rule: "bcf-version-missing",
                    severity: Severity::Info,
                    pointer: format!("{ptr}/presetVersion"),
                    message: format!(
                        "补 presetVersion = {version}（配方 {}）",
                        map.get("preset").and_then(Value::as_str).unwrap_or("")
                    ),
                });
            }
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                if let Some(child) = map.get_mut(&key) {
                    backfill_preset_versions(child, &format!("{ptr}/{key}"), out);
                }
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter_mut().enumerate() {
                backfill_preset_versions(item, &format!("{ptr}/{index}"), out);
            }
        }
        _ => {}
    }
}

fn preset_version_for(map: &Map<String, Value>) -> Option<u32> {
    let id = map.get("preset")?.as_str()?;
    if map.get("presetVersion").is_some_and(|v| !v.is_null()) {
        return None;
    }
    // 动画配方（含 alias）优先；再查效果注册表。
    let canonical = motion::preset_registry::canonical_id(id);
    if let Some(manifest) = motion::preset_registry::manifest(canonical) {
        return Some(manifest.version);
    }
    if motion::preset_registry::bcf_preset(canonical).is_some() {
        // 冻结的 `bcf.*` 配方只有 @1。
        return Some(1);
    }
    motion::effect::builtin_registry()
        .latest(id)
        .map(|manifest| manifest.version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc() -> Value {
        json!({
            "bcut": "0.1",
            "meta": {"id": "t", "width": 1920, "height": 1080, "fps": 30},
            "scenes": [{"id": "s", "dur": 3}],
            "tracks": [{"id": "main", "kind": "visual", "clips": [
                {"id": "c", "start": 0, "end": "@s.end", "element": {
                    "type": "text", "id": "el", "text": "hi",
                    "animate": {"enter": {"preset": "motion.moveIn", "dur": 0.4}},
                    "effects": [{"preset": "filter.blur", "params": {"radius": 0.01}}]
                }}
            ]}]
        })
    }

    #[test]
    fn migration_sets_the_version_keys_and_backfills_preset_versions() {
        let (out, diagnostics) = migrate_doc(&doc(), None, None).unwrap();
        assert_eq!(out["bcut"], "0.2");
        assert_eq!(out["motionVersion"], 1);
        let element = &out["tracks"][0]["clips"][0]["element"];
        assert_eq!(element["animate"]["enter"]["presetVersion"], 1);
        assert_eq!(element["effects"][0]["presetVersion"], 1);
        assert!(diagnostics.len() >= 3);
    }

    /// 非破坏性：除了新增的三个键，其余逐字节不变。
    #[test]
    fn migration_touches_nothing_else() {
        let before = doc();
        let (mut after, _) = migrate_doc(&before, None, None).unwrap();
        let object = after.as_object_mut().unwrap();
        object.insert("bcut".to_owned(), Value::from("0.1"));
        object.remove("motionVersion");
        let element = after
            .pointer_mut("/tracks/0/clips/0/element")
            .and_then(Value::as_object_mut)
            .unwrap()
            .clone();
        let mut element = element;
        element
            .get_mut("animate")
            .and_then(Value::as_object_mut)
            .and_then(|a| a.get_mut("enter"))
            .and_then(Value::as_object_mut)
            .unwrap()
            .remove("presetVersion");
        element
            .get_mut("effects")
            .and_then(Value::as_array_mut)
            .unwrap()[0]
            .as_object_mut()
            .unwrap()
            .remove("presetVersion");
        *after.pointer_mut("/tracks/0/clips/0/element").unwrap() = Value::Object(element);
        assert_eq!(after, before);
    }

    #[test]
    fn migrating_an_already_current_document_is_a_no_op() {
        let (out, _) = migrate_doc(&doc(), None, None).unwrap();
        let (again, diagnostics) = migrate_doc(&out, None, None).unwrap();
        assert_eq!(again, out);
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn unsupported_versions_are_refused() {
        let mut doc = doc();
        doc["bcut"] = Value::from("0.9");
        let error = migrate_doc(&doc, None, None).unwrap_err().to_string();
        assert!(error.starts_with("bcf-version-unsupported"), "{error}");
        // `--from` 与文档声明不符时不猜。
        let doc = super::tests::doc();
        let error = migrate_doc(&doc, Some("0.2"), None)
            .unwrap_err()
            .to_string();
        assert!(error.starts_with("bcf-version-unsupported"), "{error}");
    }
}
