//! 渲染指纹（规范 §15）：
//! 内容指纹 = sha256( canonical(文档 JSON) ‖ canonical(变量集 JSON) )，
//! canonical 为键排序、无多余空白的规范化序列化。
//! 帧指纹（DrawOp fnv1a64）在 bcut-render::drawop。

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// 键排序 + 紧凑（无空白）的规范化 JSON 序列化。
pub fn canonical_json(v: &Value) -> String {
    let mut out = String::new();
    write_canonical(v, &mut out);
    out
}

fn write_canonical(v: &Value, out: &mut String) {
    match v {
        Value::Object(o) => {
            out.push('{');
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort();
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::from(k.as_str()).to_string());
                out.push(':');
                write_canonical(&o[*k], out);
            }
            out.push('}');
        }
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(x, out);
            }
            out.push(']');
        }
        // 标量走 serde_json 的确定性文本形态（数字保持解析时的规范表示）
        _ => out.push_str(&v.to_string()),
    }
}

/// 文本的 sha256 裸十六进制（无 `sha256-` 前缀）。
///
/// 与 `bcut_workspace::history::sha_of` 同口径——`__bcut/put` 的 `base`、
/// direct-edit 的 `baseSourceHash` 都用这一种形态，跨模块比较不需要换算。
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    lower_hex(&h.finalize())
}

/// 内容指纹（§15）："sha256-<64hex>"。变量覆盖缺省视为空对象。
pub fn content_fingerprint(doc: &Value, overrides: Option<&Map<String, Value>>) -> String {
    let vars = match overrides {
        Some(o) => Value::Object(o.clone()),
        None => Value::Object(Map::new()),
    };
    let mut h = Sha256::new();
    h.update(canonical_json(doc).as_bytes());
    h.update(canonical_json(&vars).as_bytes());
    format!("sha256-{}", lower_hex(&h.finalize()))
}

/// 摘要的小写十六进制，与 v2（sha2 0.10）的 `{:x}` 逐字相同；sha2 0.11 的输出类型不再实现
/// `LowerHex`。
fn lower_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_sorts_keys_and_strips_whitespace() {
        let v = json!({ "b": [1, 2.5, null], "a": { "z": "文", "y": true } });
        assert_eq!(
            canonical_json(&v),
            r#"{"a":{"y":true,"z":"文"},"b":[1,2.5,null]}"#
        );
    }

    #[test]
    fn fingerprint_is_stable_and_var_sensitive() {
        let a = json!({ "meta": { "id": "x" }, "scenes": [] });
        let b = json!({ "scenes": [], "meta": { "id": "x" } }); // 键序无关
        assert_eq!(content_fingerprint(&a, None), content_fingerprint(&b, None));
        let mut vars = Map::new();
        vars.insert("name".into(), json!("客户A"));
        assert_ne!(
            content_fingerprint(&a, None),
            content_fingerprint(&a, Some(&vars))
        );
        assert!(content_fingerprint(&a, None).starts_with("sha256-"));
        assert_eq!(content_fingerprint(&a, None).len(), 7 + 64);
    }
}
