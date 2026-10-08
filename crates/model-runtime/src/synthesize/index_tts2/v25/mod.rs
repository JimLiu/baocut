//! IndexTTS 2.5 纯逻辑：tiktoken 多语言分词器与文本前端。
//!
//! 2.5 相对 2.0 的文本侧变化：词表换成 60 509 项的 tiktoken（含语言、音频事件、
//! 时间戳等特殊 token），每段文本带 `<|lang|> ` 前缀并按 GPT 位置预算切段，
//! 语言 id 另经 `lang_embedding` 加到每个文本位置。模型图在 `mlx` 模块里与
//! 2.0 共用。

pub mod frontend;
pub mod tiktoken;
