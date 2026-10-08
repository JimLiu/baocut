//! 量文字元素的框：新建文字时界面要知道一段字排出来多宽，与画它的是同一台排版引擎、同一批字体
//! （`subtitle-render` 的 [`layout_text`]），量出来的框与画出来的字一致。
//!
//! 口径与画文字元素相同：样式按序列画布解释（字号以 540 短边为基准），按 Unicode 词边界折行，行高取排出来的各行。

use render_raster::TextEngine;
use serde::Serialize;
use serde_json::Value;
use subtitle_render::{LineKind, TimedItem, layout_lines_height, layout_text, resolve_line_style};

/// 一段文字作为文字元素要多大的框（序列像素，含底板留白）。
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct TextBox {
    pub width: f64,
    pub height: f64,
}

/// 量 `text` 按 `style` 排在 `canvas` 上要多大的框：给了 `wrap_width` 就按它折行、框宽就是它；否则排成不折的一块，
/// 框宽是最宽一行加左右留白，再多留四分之一个字号的余量（预览与导出按输出尺寸排，与按序列画布量的差一点舍入）。
pub fn measure_text_element(engine: &mut TextEngine, text: &str, style: &Value, wrap_width: Option<f64>, canvas: (u32, u32)) -> TextBox {
    let (canvas_width, canvas_height) = (canvas.0.max(1), canvas.1.max(1));
    let line = resolve_line_style(style, LineKind::Original, canvas_width, canvas_height, false);
    let item = TimedItem {
        id: String::new(),
        series_index: 0,
        text: text.to_string(),
        display_start: 0.0,
        display_end: 1.0,
        words: Vec::new(),
    };
    let wrap = wrap_width.filter(|w| w.is_finite()).map(|w| w.max(1.0));
    let (lines, width) = layout_text(engine, &item, &line, wrap.unwrap_or(f64::INFINITY), None);
    let height = (layout_lines_height(&lines) + line.background_pad_v * 2.0).ceil();
    match wrap {
        Some(wrap) => TextBox { width: wrap, height },
        None => TextBox {
            width: (width + line.background_pad_h * 2.0 + line.font_size * 0.25).ceil(),
            height,
        },
    }
}
