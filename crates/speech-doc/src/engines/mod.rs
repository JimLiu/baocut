//! LLM 阶段引擎注册表：统一的「发调用 → 收答案 → 校验 → 应用」生命周期。
//!
//! 每个引擎零 I/O、零网络、零时钟：LLM 经 [`crate::llm::LlmJson`] 注入，
//! 重试退避的 sleep 由宿主闭包注入。全部引擎逻辑可用 [`crate::llm::FakeLlm`]
//! 离线测试。

pub mod align;
pub mod brief;
pub mod broll;
pub mod chapters;
pub mod cleanup;
pub mod markers;
pub mod polish;
pub mod segment;
pub mod speaker_names;
pub mod speaker_repair;
pub mod translate;
