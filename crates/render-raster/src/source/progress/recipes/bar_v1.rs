//! `bar-v1`：`normal` / `rounded`（设计 §7.4）。
//!
//! 参考实现（`progress_normal.frag` / `progress_rounded.frag`）：底色铺满整只
//! quad，`texCoord.x < u_progress` 的部分换成主色；`rounded` 另外乘一张
//! **胶囊形 alpha 遮罩**（`radius = 200px` 的圆角矩形）。
//!
//! 矢量化的关键：颜色分界是**竖直硬边**，圆角只属于外轮廓。因此
//! `radiusPx > 0` 时压一层 `ClipPath`（圆角矩形）再画两块直角矩形——
//! 直接给进度块也加圆角会让它的右端变成一个不该存在的圆头。

use motion::preset_registry::ProgressBody;
use serde_json::Value;

use crate::drawop::{DrawOp, FrameBuilder, Mat6, PathData};
use crate::source::kernel::DrawBox;
use crate::source::progress::ProgressParams;

pub(crate) fn draw(
    builder: &mut FrameBuilder,
    body: &ProgressBody,
    params: &ProgressParams,
    progress: f64,
    bbox: DrawBox,
    tf: Mat6,
) -> usize {
    let recipe = &body.recipe;
    let Some(direction) = recipe.text("direction") else {
        return 0;
    };
    // `corner: {"kind":"none"}` 是直角；`{"kind":"capsule", "radiusPx": …}`
    // 的像素长度按 host 给的系数折算，再夹到半个短边以内（见 draw.rs 模块文档）。
    let radius = recipe
        .object("corner")
        .filter(|corner| corner.get("kind").and_then(Value::as_str) == Some("capsule"))
        .and_then(|corner| corner.get("radiusPx"))
        .and_then(Value::as_f64)
        .map(|pixels| (pixels * params.pixel_scale).min(bbox.w.min(bbox.h) / 2.0))
        .unwrap_or(0.0)
        .max(0.0);

    let before = builder.frame.ops.len();
    if radius > 0.0 {
        let path = builder.path_id(PathData(super::rounded_rect(bbox, radius)));
        builder.push(DrawOp::ClipPath { path, tf });
    }
    builder.push(DrawOp::FillRect {
        x: bbox.x as f32,
        y: bbox.y as f32,
        w: bbox.w as f32,
        h: bbox.h as f32,
        radius: 0.0,
        color: params.secondary_color,
        tf,
    });
    let filled = bbox.w * progress;
    if filled > 0.0 {
        // `rtl` 目前没有配方在用，但取值域是注册表的封闭枚举（`ENUM_KEYS`），
        // 按数据分派而不是按 id。
        let x = if direction == "rtl" {
            bbox.x + bbox.w - filled
        } else {
            bbox.x
        };
        builder.push(DrawOp::FillRect {
            x: x as f32,
            y: bbox.y as f32,
            w: filled as f32,
            h: bbox.h as f32,
            radius: 0.0,
            color: params.main_color,
            tf,
        });
    }
    if radius > 0.0 {
        builder.push(DrawOp::PopClip);
    }
    builder.frame.ops.len() - before
}
