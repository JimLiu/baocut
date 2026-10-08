//! `transition.circleCrop@1`：一个（可羽化的）圆从圆心张开。
//!
//! 与 [`super::wipe`] 共用同一条扫掠式，只是把「沿轴坐标」换成「到圆心的
//! 距离」。`invert` 把距离取反（`R − d`），圆因此变成收缩——端点纪律不变。

use super::{composite_by_coverage, sweep_coverage, sweep_edge};

#[allow(clippy::too_many_arguments)]
pub fn circle_crop(
    from: &[u8],
    to: &[u8],
    out: &mut [u8],
    width: u32,
    height: u32,
    cx: f64,
    cy: f64,
    softness: f64,
    invert: bool,
    progress: f64,
) {
    let (w, h) = (f64::from(width), f64::from(height));
    let (center_x, center_y) = (cx.clamp(0.0, 1.0) * w, cy.clamp(0.0, 1.0) * h);
    // R = 圆心到最远画布角的距离：progress = 1 时圆必须盖住整幅画面。
    let radius_max = [(0.0, 0.0), (w, 0.0), (0.0, h), (w, h)]
        .into_iter()
        .map(|(x, y)| ((x - center_x).powi(2) + (y - center_y).powi(2)).sqrt())
        .fold(0.0f64, f64::max);
    let softness = softness.max(0.0);
    let edge = sweep_edge(progress, radius_max, softness);
    composite_by_coverage(from, to, out, width, height, |x, y| {
        let distance =
            ((f64::from(x) - center_x).powi(2) + (f64::from(y) - center_y).powi(2)).sqrt();
        let u = if invert {
            radius_max - distance
        } else {
            distance
        };
        sweep_coverage(edge, u, softness)
    });
}
