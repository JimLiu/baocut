//! Rust 一侧给人看的文字（仓库约定 §5、命令与协议规范 §11.1）：英文文本 + 消息引用。
//!
//! 与 `@baocut/protocol` 的 `message-ref.ts` 同形：引用是 `{ key, params? }`，`key` 是 `<区域>.<名字>`。
//! Rust 只出英文（缺省与兜底）；各语言的译文在 `packages/protocol/src/messages/<crate>/`，界面与 CLI 用
//! `localizeText(text, ref)` 按自己的语言重新生成。两边的英文由 `tools/rust-messages.test.ts` 核对。
//!
//! 写法：`msg!("engine.notFound", "{kind} {id} does not exist", kind = kind, id)`。模板只用 `{名字}` 占位，
//! 每个占位都要在参数里给出；参数是标量或另一条 `Text`（嵌套的引用按读者的语言展开）。供应商原话、文件名、
//! 下层的错误说明作为字符串参数原样传。

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// 消息引用：`key` 发布后不改名、不复用。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageRef {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Map<String, Value>>,
}

impl MessageRef {
    pub fn new(key: &str) -> MessageRef {
        MessageRef {
            key: key.to_string(),
            params: None,
        }
    }

    pub fn param(mut self, name: &str, value: Value) -> MessageRef {
        self.params.get_or_insert_with(Map::new).insert(name.to_string(), value);
        self
    }
}

/// 一段给人看的文字：英文文本，能翻译的带着引用。第三方原话与未迁移的文字没有引用。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Text {
    pub text: String,
    pub message_ref: Option<MessageRef>,
}

impl Text {
    pub fn with_ref(text: String, message_ref: MessageRef) -> Text {
        Text {
            text,
            message_ref: Some(message_ref),
        }
    }

    pub fn plain(text: impl Into<String>) -> Text {
        Text {
            text: text.into(),
            message_ref: None,
        }
    }

    /// 作为嵌套参数：`{ key, params?, text }`；没有引用时就是文本。
    pub fn to_param(&self) -> Value {
        match &self.message_ref {
            Some(message_ref) => {
                let mut value = serde_json::to_value(message_ref).unwrap_or(Value::Null);
                if let Value::Object(map) = &mut value {
                    map.insert("text".into(), Value::String(self.text.clone()));
                }
                value
            }
            None => Value::String(self.text.clone()),
        }
    }
}

impl fmt::Display for Text {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.text)
    }
}

impl From<String> for Text {
    fn from(text: String) -> Text {
        Text::plain(text)
    }
}

impl From<&str> for Text {
    fn from(text: &str) -> Text {
        Text::plain(text)
    }
}

impl From<&String> for Text {
    fn from(text: &String) -> Text {
        Text::plain(text.clone())
    }
}

/// 把几段文字连成一段（英文用 `; ` 分隔）。每段的引用都保留：连接本身也是一条引用（`list.join`），按读者的语言换分隔符。
pub fn join(items: impl IntoIterator<Item = Text>) -> Text {
    let mut items = items.into_iter();
    let Some(first) = items.next() else {
        return Text::plain(String::new());
    };
    items.fold(first, |head, tail| msg!("list.join", "{head}; {tail}", head, tail))
}

/// 能作为参数的值。
pub trait Param {
    fn to_param(&self) -> Value;
}

impl<T: Param + ?Sized> Param for &T {
    fn to_param(&self) -> Value {
        (**self).to_param()
    }
}

impl Param for str {
    fn to_param(&self) -> Value {
        Value::String(self.to_string())
    }
}

impl Param for String {
    fn to_param(&self) -> Value {
        Value::String(self.clone())
    }
}

impl Param for Text {
    fn to_param(&self) -> Value {
        Text::to_param(self)
    }
}

impl Param for bool {
    fn to_param(&self) -> Value {
        Value::Bool(*self)
    }
}

macro_rules! number_params {
    ($($ty:ty),*) => {
        $(impl Param for $ty {
            fn to_param(&self) -> Value {
                serde_json::json!(*self)
            }
        })*
    };
}

number_params!(i8, i16, i32, i64, isize, u8, u16, u32, u64, usize, f32, f64);

/// `msg!("area.name", "English {a} and {b}", a = expr, b)`：英文文本与引用一起生成。
/// 只写名字的参数取同名的变量。参数各求值一次。
#[macro_export]
macro_rules! msg {
    ($key:literal, $template:literal $(,)?) => {
        $crate::Text::with_ref(::std::string::String::from($template), $crate::MessageRef::new($key))
    };
    ($key:literal, $template:literal, $($name:ident $(= $value:expr)?),+ $(,)?) => {{
        $(let $name = &$crate::msg!(@value $name $($value)?);)+
        $crate::Text::with_ref(
            format!($template, $($name = $name),+),
            $crate::MessageRef::new($key)$(.param(stringify!($name), $crate::Param::to_param($name)))+,
        )
    }};
    (@value $name:ident) => { $name };
    (@value $name:ident $value:expr) => { $value };
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plain_message_has_key_only() {
        let text = msg!("test.plain", "Hello");
        assert_eq!(text.text, "Hello");
        assert_eq!(serde_json::to_value(text.message_ref).unwrap(), json!({ "key": "test.plain" }));
    }

    #[test]
    fn params_render_and_are_kept() {
        let id = String::from("seq_1");
        let count = 3usize;
        let text = msg!("test.params", "{id} has {count} items", id, count = count);
        assert_eq!(text.text, "seq_1 has 3 items");
        assert_eq!(
            serde_json::to_value(text.message_ref).unwrap(),
            json!({ "key": "test.params", "params": { "id": "seq_1", "count": 3 } })
        );
        // 参数借用，不移走。
        assert_eq!(id, "seq_1");
    }

    #[test]
    fn nested_text_becomes_nested_ref() {
        let kind = msg!("test.kind", "sequence");
        let text = msg!("test.nested", "No {kind} {id}", kind, id = "a");
        assert_eq!(text.text, "No sequence a");
        assert_eq!(
            serde_json::to_value(text.message_ref).unwrap(),
            json!({ "key": "test.nested", "params": { "kind": { "key": "test.kind", "text": "sequence" }, "id": "a" } })
        );
        assert_eq!(Text::plain("x").to_param(), json!("x"));
    }

    #[test]
    fn join_keeps_each_ref() {
        assert_eq!(join([]).text, "");
        let one = join([msg!("test.a", "A")]);
        assert_eq!(one.message_ref.unwrap().key, "test.a");
        let joined = join([msg!("test.a", "A"), Text::plain("b"), msg!("test.c", "C")]);
        assert_eq!(joined.text, "A; b; C");
        assert_eq!(
            serde_json::to_value(joined.message_ref).unwrap(),
            json!({ "key": "list.join", "params": {
                "head": { "key": "list.join", "params": { "head": { "key": "test.a", "text": "A" }, "tail": "b" }, "text": "A; b" },
                "tail": { "key": "test.c", "text": "C" },
            } })
        );
    }
}
