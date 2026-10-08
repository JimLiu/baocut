//! `ring-v1`：`circle` / `donut`（设计 §7.4）。
//!
//! 参考实现（`progress_circle.frag` / `progress_donut.frag`）：`len = |texCoord·2 − 1|`
//! 的内切圆，`anglePercent`（自正上方顺时针，`atan(−centred.x, −centred.y) + π`）
//! 小于 `u_progress` 的扇区用主色，其余用副色；`donut` 再乘一层 `innerRadius = 0.8`
//! 的内圈遮罩。
//!
//! 矢量侧：底环（整圆 / 整环）+ 进度扇区（饼形 / 环形扇区）两条 `FillPath`。
//! `innerRadius` 是**相对外半径**的比例，与参考实现的 `len` 同一量纲。
//! `featherPx` / `edgeFeatherPx` 是 shader 的抗锯齿带宽，矢量路径不读（见
//! `super::super::draw` 的模块文档）。

use motion::preset_registry::ProgressBody;

use crate::drawop::{DrawOp, FrameBuilder, Mat6, PathData};
use crate::source::kernel::{DrawBox, ring_subpath, sector_subpath};
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
    let (Some(inner_ratio), Some(start_angle), Some(direction)) = (
        recipe.number("innerRadius"),
        recipe.text("startAngle"),
        recipe.text("direction"),
    ) else {
        return 0;
    };
    let center = bbox.center();
    let outer = bbox.w.min(bbox.h) / 2.0;
    if !(outer > 0.0) {
        return 0;
    }
    let inner = outer * inner_ratio.clamp(0.0, 1.0);
    // `startAngle` 的封闭取值目前只有 `"top"`（注册表 `ENUM_KEYS`），而
    // `kernel::polar` 的零角就在正上方；将来加档在这里给偏移。
    let phase = match start_angle {
        "top" => 0.0,
        _ => 0.0,
    };
    // `direction` 的封闭取值里 `ccw` / `rtl` 目前没有 progress 配方在用。
    let sign = if direction == "ccw" { -1.0 } else { 1.0 };

    let before = builder.frame.ops.len();
    let mut path = Vec::new();
    ring_subpath(&mut path, center, outer, inner);
    if !path.is_empty() {
        let path = builder.path_id(PathData(path));
        builder.push(DrawOp::FillPath {
            path,
            color: params.secondary_color,
            tf,
        });
    }
    if progress > 0.0 {
        let sweep = sign * progress * std::f64::consts::TAU;
        let mut path = Vec::new();
        sector_subpath(&mut path, center, outer, inner, phase, phase + sweep);
        if !path.is_empty() {
            let path = builder.path_id(PathData(path));
            builder.push(DrawOp::FillPath {
                path,
                color: params.main_color,
                tf,
            });
        }
    }
    builder.frame.ops.len() - before
}
