//! BaoCut 的编辑语义（架构设计 §13.1 `crates/editor-semantics`）：时间类型、十进制秒、
//! 帧量化与映射。纯函数，没有状态，也不碰文件；视频引擎与将来的 WASM 预测共用它。

pub mod ratio;
pub mod time;

pub use ratio::Ratio;
pub use time::*;
