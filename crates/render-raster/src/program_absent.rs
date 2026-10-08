//! 不开 `program` feature 时的 `program` 模块（v3 专有，v2 没有这个文件）。
//!
//! v2 的 `program` 资产要 `bcut-compile` 把 TSX 模块图求值成逐帧 SVG；它不移植
//! （架构设计 §13.6），`program` 因此是占位 feature（见 Cargo.toml 文件头）。
//! `assets::load_assets_with_vars` 遇到 `program` 资产直接报错，`LoadedAssets::programs`
//! 恒为空。帧供给（`media.rs`）与 `LoadedAssets::render_diagnostics` 查 `programs` 的
//! 分支照 v2 原样编译：`ProgramSource` 是无值的枚举，这些分支永远不命中。

use anyhow::Result;
use tiny_skia::Pixmap;

use crate::plan::PreflightDiagnostic;

/// 无值：没有 `program` feature 就造不出来。方法签名与 `program.rs` 里的同名方法一致。
#[derive(Debug)]
pub enum ProgramSource {}

impl ProgramSource {
    pub fn width(&self) -> u32 {
        match *self {}
    }

    pub fn height(&self) -> u32 {
        match *self {}
    }

    pub fn frame_starts_ms(&self) -> &[i64] {
        match *self {}
    }

    pub fn duration(&self) -> f64 {
        match *self {}
    }

    pub fn frame_start_ms(&self, _ms: i64) -> i64 {
        match *self {}
    }

    pub fn late_diagnostics(&self) -> Vec<PreflightDiagnostic> {
        match *self {}
    }

    pub fn render(&self, _ms: i64, _target: Option<(u32, u32)>) -> Result<Pixmap> {
        match *self {}
    }
}
