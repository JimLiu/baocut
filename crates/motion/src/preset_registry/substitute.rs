//! `"{param}"` 替换（规范 §7.4：**只替换、不算术**）。
//!
//! 这里的语义必须与 `bcut-core/src/resolve.rs::resolve_ref` 的 `'{'` 分支**逐式相同**：
//! 项目级 preset 走那条路径、内置 manifest 走这条，同一个模板必须给同一个结果。
//! 一致性由 `bcut-motion/tests/substitute_parity.rs` 在两侧对拍。
//!
//! 与 `resolve_ref` 的唯一差别：这里不认 `$vars/$theme/$assets` 引用——manifest 是
//! 仓库内的数据，没有文档上下文可查。

use serde_json::{Map, Value};

/// 单个值的替换。非字符串原样返回。
pub fn substitute(v: &Value, params: &Map<String, Value>) -> Value {
    let Some(s) = v.as_str() else {
        return v.clone();
    };
    if !s.contains('{') {
        return v.clone();
    }
    // 整串就是 "{name}" 且 name 全 [A-Za-z0-9_] → 返回参数原值（保类型）
    if let Some(inner) = s.strip_prefix('{').and_then(|t| t.strip_suffix('}')) {
        if !inner.is_empty() && inner.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            if let Some(pv) = params.get(inner) {
                return pv.clone();
            }
        }
    }
    // 字符串模板："共 {value} 人"
    let mut out = s.to_string();
    for (k, pv) in params {
        let needle = format!("{{{k}}}");
        if !out.contains(&needle) {
            continue;
        }
        let rep = match pv {
            Value::String(ps) => ps.clone(),
            Value::Number(n) => {
                let f = n.as_f64().unwrap_or(0.0);
                if f == f.round() && f.abs() < 1e15 {
                    format!("{}", f as i64)
                } else {
                    format!("{f}")
                }
            }
            _ => String::new(),
        };
        out = out.replace(&needle, &rep);
    }
    Value::from(out)
}

/// 递归替换（数组 / 对象逐键），镜像 `deep_resolve`。
pub fn deep_substitute(v: &Value, params: &Map<String, Value>) -> Value {
    match v {
        Value::String(_) => substitute(v, params),
        Value::Array(a) => Value::Array(a.iter().map(|x| deep_substitute(x, params)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), deep_substitute(x, params)))
                .collect(),
        ),
        _ => v.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params() -> Map<String, Value> {
        let mut map = Map::new();
        map.insert("distance".into(), json!(0.045));
        map.insert("count".into(), json!(24));
        map.insert("direction".into(), json!("up"));
        map.insert("fade".into(), json!(true));
        map
    }

    #[test]
    fn whole_string_placeholder_keeps_the_type() {
        assert_eq!(substitute(&json!("{distance}"), &params()), json!(0.045));
        assert_eq!(substitute(&json!("{fade}"), &params()), json!(true));
    }

    #[test]
    fn templates_print_integers_without_a_decimal_point() {
        assert_eq!(
            substitute(&json!("共 {count} 个"), &params()),
            json!("共 24 个")
        );
        assert_eq!(
            substitute(&json!("d={distance}"), &params()),
            json!("d=0.045")
        );
    }

    #[test]
    fn unknown_names_are_left_alone() {
        assert_eq!(substitute(&json!("{nope}"), &params()), json!("{nope}"));
        assert_eq!(substitute(&json!("plain"), &params()), json!("plain"));
        assert_eq!(substitute(&json!(3), &params()), json!(3));
    }

    #[test]
    fn deep_substitute_walks_objects_and_arrays() {
        let out = deep_substitute(
            &json!({"v": "{distance}", "list": ["{direction}", 1]}),
            &params(),
        );
        assert_eq!(out, json!({"v": 0.045, "list": ["up", 1]}));
    }
}
