//! 上游 Python 前端在异常输入上抛出的异常类型；Rust 端返回同类错误，对拍时按类型名比对。

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PyError {
    /// `ValueError`（如 `int("5,0")`）。
    Value,
    /// inflect `NumOutOfRangeError`（超过 decillion）。
    NumOutOfRange,
    /// `IndexError`。
    Index,
    /// `KeyError`（如音素不在符号表）。
    Key,
    /// torch `RuntimeError`（如在空列表上 `torch.cat`）。
    Runtime,
}

impl PyError {
    /// Python 异常类名。
    pub fn name(self) -> &'static str {
        match self {
            Self::Value => "ValueError",
            Self::NumOutOfRange => "NumOutOfRangeError",
            Self::Index => "IndexError",
            Self::Key => "KeyError",
            Self::Runtime => "RuntimeError",
        }
    }
}

impl fmt::Display for PyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl std::error::Error for PyError {}
