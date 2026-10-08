//! BCF 文档的版本常量。
//!
//! v2 放在 `bcut-protocol/src/version.rs` 的 `versions` 模块里；本 crate 只用到这两个，
//! 不移植 `bcut-protocol`，原值照搬到这里。`migrate` 仍以原来的公共名字导出它们。

/// BCF（`main.bcut.tsx` 的 `bcf` 字段）：读 0.1/0.2，写 0.2。
pub const BCF_SUPPORTED: &[&str] = &["0.1", "0.2"];
pub const BCF_CURRENT: &str = "0.2";
