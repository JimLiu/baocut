//! Surface Transition 的 strict CPU 参考实现（规范 §9，设计 §6.4）。
//!
//! 四条 v1 配方共用一条**端点纪律**：`progress` 是闭区间 `[0, 1]`，
//! `progress = 0` 的输出必须与 `from` 逐字节相同、`= 1` 与 `to` 逐字节相同
//! （规范 §9 的 conformance 要求）。这条纪律决定了实现形态：
//!
//! * 覆盖率是 0 或 1 的像素**直接拷贝原字节**，不进混合式；
//! * 混合式本身是整数的（[`lerp_premul_u8`]），`a = 0` / `a = 255` 也各自
//!   恒等，因此「拷贝」与「混合」两条路在端点上不会打架；
//! * 扫掠范围多给一个像素（`span + softness + 1`）——少了它，硬边在
//!   `progress = 1` 时会漏掉最后一列 / 最远那个角。
//!
//! 颜色契约与阶段 4 的滤镜一致：预乘 sRGB / u8（manifest 声明）。

pub mod circle_crop;
pub mod crossfade;
pub mod glitch;
pub mod ink_blot;
pub mod shatter;
pub mod slide;
pub mod wipe;

/// 沿轴方向。`slide` 与 `wipe` 的 `direction` 参数解析结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Left,
    Right,
    Up,
    Down,
}

impl Direction {
    pub fn parse(text: &str) -> Option<Direction> {
        match text {
            "left" => Some(Direction::Left),
            "right" => Some(Direction::Right),
            "up" => Some(Direction::Up),
            "down" => Some(Direction::Down),
            _ => None,
        }
    }

    pub fn is_horizontal(self) -> bool {
        matches!(self, Direction::Left | Direction::Right)
    }
}

/// 预乘 u8 的整数插值：`a = 0` 还原 `from`、`a = 255` 还原 `to`。
///
/// `(f×(255−a) + t×a + 127) / 255` 的截断除法在两端都精确：
/// `a = 0` ⇒ `(f×255 + 127)/255 = f`（余数 127 < 255）；`a = 255` ⇒ `t`。
/// 换成浮点 `f + (t − f)×p` 再 `round()` 在端点也对，但中间会带上二进制舍入的
/// 尾巴——strict 等级要的是可以逐字节复现的算术。
#[inline]
pub fn lerp_premul_u8(from: u8, to: u8, a: u32) -> u8 {
    ((u32::from(from) * (255 - a) + u32::from(to) * a + 127) / 255) as u8
}

/// 覆盖率 → 混合权重。`cov ≤ 0` / `≥ 1` 由调用方走拷贝分支，这里只管中间段。
#[inline]
pub fn coverage_to_alpha(coverage: f64) -> u32 {
    (coverage.clamp(0.0, 1.0) * 255.0).round() as u32
}

/// 按逐像素覆盖率把 `from`、`to` 合成到 `out`。
///
/// `coverage` 返回 0 ⇒ 原样拷 `from` 的四个字节，返回 1 ⇒ 拷 `to` 的。
/// 端点的逐字节相等由这条捷径保证，而不是靠混合式凑巧。
pub fn composite_by_coverage(
    from: &[u8],
    to: &[u8],
    out: &mut [u8],
    width: u32,
    height: u32,
    mut coverage: impl FnMut(u32, u32) -> f64,
) {
    for y in 0..height {
        for x in 0..width {
            let offset = ((y * width + x) * 4) as usize;
            let cov = coverage(x, y);
            if cov <= 0.0 {
                out[offset..offset + 4].copy_from_slice(&from[offset..offset + 4]);
            } else if cov >= 1.0 {
                out[offset..offset + 4].copy_from_slice(&to[offset..offset + 4]);
            } else {
                let a = coverage_to_alpha(cov);
                for channel in 0..4 {
                    out[offset + channel] =
                        lerp_premul_u8(from[offset + channel], to[offset + channel], a);
                }
            }
        }
    }
}

/// 扫掠位置：`progress × (span + softness + 1)`。
///
/// 那个 `+ 1` 是端点纪律的一部分（见模块头）。
#[inline]
pub fn sweep_edge(progress: f64, span: f64, softness: f64) -> f64 {
    progress.clamp(0.0, 1.0) * (span + softness + 1.0)
}

/// 扫掠覆盖率：`softness = 0` 是硬边，否则是宽度为 `softness` 的线性过渡带。
#[inline]
pub fn sweep_coverage(edge: f64, u: f64, softness: f64) -> f64 {
    if softness <= 0.0 {
        if u < edge { 1.0 } else { 0.0 }
    } else {
        ((edge - u) / softness).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_integer_lerp_is_exact_at_both_ends() {
        for value in [0u8, 1, 7, 128, 254, 255] {
            for other in [0u8, 3, 99, 255] {
                assert_eq!(lerp_premul_u8(value, other, 0), value);
                assert_eq!(lerp_premul_u8(other, value, 255), value);
            }
        }
    }

    #[test]
    fn the_sweep_covers_the_whole_axis_at_progress_one() {
        for softness in [0.0, 0.5, 4.0] {
            let edge = sweep_edge(1.0, 48.0, softness);
            // 最后一列的 u = span − 1；必须完全被覆盖。
            assert_eq!(sweep_coverage(edge, 47.0, softness), 1.0);
            let start = sweep_edge(0.0, 48.0, softness);
            assert_eq!(sweep_coverage(start, 0.0, softness), 0.0);
        }
    }
}
