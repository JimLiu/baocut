//! BaoCut 视频引擎：视频的唯一写入者（架构设计 §2.3、§5）。
//!
//! 一个视频是一个目录：`video.db`（SQLite，WAL）、`video.lock`（写锁）与 `blobs/`（按内容寻址的素材）。
//! 编辑通过经过校验的操作提交为事务；每笔事务原子地写入实体、回执、撤销记录与事件 outbox。

// 错误体带实体、版本与细节，只在失败路径上出现；不为了缩小 Result 而装箱。
#![allow(clippy::result_large_err)]

pub mod anchors;
pub mod asset_usage;
pub mod chapters;
pub mod cuts;
pub mod ducking;
pub mod effects;
mod elements;
pub mod error;
pub mod ids;
pub mod import;
mod item_keyframes;
mod item_local;
pub mod ops;
pub mod package;
pub mod proposals;
pub mod receipt;
mod sequence_end;
pub mod state;
pub mod store;
pub mod task_guard;
pub mod transitions;
pub mod video;

/// 交换 DTO 在 `video-model` 里，渲染计划与 WASM 预览也用它；这里保留原来的路径。
pub use video_model as model;

pub use error::{EngineResult, ErrorBody, Retryability};
pub use ops::EditOperation;
pub use receipt::{HistoryEntry, TransactionReceipt, VideoEvent};
pub use store::{ProjectClaim, UndoStep};
pub use task_guard::{ProtectionTarget, TaskProtection};
pub use video::{Committed, CreateOptions, OpenMode, UndoRequest, UndoState, UndoTarget, Video, VideoTransaction, claim_project_dir};
