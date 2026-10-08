//! `BlendMode` → tiny-skia。
//!
//! `motion::effect::BlendMode` 是唯一来源（编号进 DrawOp v3 的
//! `PushLayer{blend}` 与 `composite/blend.json`）；这里只做后端映射。

use motion::effect::BlendMode;

pub fn blend_to_skia(mode: BlendMode) -> tiny_skia::BlendMode {
    match mode {
        BlendMode::Normal => tiny_skia::BlendMode::SourceOver,
        BlendMode::Multiply => tiny_skia::BlendMode::Multiply,
        BlendMode::Screen => tiny_skia::BlendMode::Screen,
        BlendMode::Overlay => tiny_skia::BlendMode::Overlay,
        BlendMode::Darken => tiny_skia::BlendMode::Darken,
        BlendMode::Lighten => tiny_skia::BlendMode::Lighten,
        BlendMode::Difference => tiny_skia::BlendMode::Difference,
        BlendMode::Exclusion => tiny_skia::BlendMode::Exclusion,
        BlendMode::Plus => tiny_skia::BlendMode::Plus,
    }
}
