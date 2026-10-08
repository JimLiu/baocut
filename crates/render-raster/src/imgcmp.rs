//! 图像相似度比较：SSIM + 逐通道最大偏差，供 golden / 跨后端容差比对复用。
//!
//! WP5b 之前仓库里有三份互不一致的 SSIM：`apps/cli` 的 `bcut ssim` / `bcut
//! compare`（灰度、8×8 **非重叠**窗口、总体方差，丢弃 alpha 通道）、这个 crate
//! 的 `tests/gpu_conformance.rs`（逐通道 RGBA、8×8 **滑动**窗口、样本方差、外加
//! 4× 盒式降采样与逐通道最大偏差诊断）、以及 `bcut-media-native` 测试里的一份
//! 最小灰度版本。三处算法各走各的，同一对图片能报出不同的 SSIM。
//!
//! 本模块收敛为唯一实现，算法基准是 `gpu_conformance.rs` 那一份——它是三者里
//! 最成熟的：滑动窗口比非重叠窗口更贴近参考 SSIM 论文的定义，逐通道比灰度更能
//! 抓住只在某一色道上跑偏的解码矩阵差异，降采样 SSIM 与逐通道最大偏差正是
//! `docs/design/bcf/baocut-format-spec.md` §15.1 要求的诊断形状（容差判据 + 偏置诊断）。
//!
//! `gpu_conformance.rs` 自己的判定阈值（`SSIM_FLOOR_STRICT` / `SSIM_FLOOR_VISUAL`
//! / `EDGE_PIXEL_SHARE`）与三条断言逻辑保持原地不动——那些是"GPU 抗锯齿函数
//! 是否可接受"这个特定问题的判据，不是这个模块的算法契约。这个模块只收敛
//! **算法本身**，调用方各自决定拿 [`Comparison`] 的哪个字段做门。
//!
//! 不做 I/O，只依赖 `tiny-skia`（`bcut-render` 的 `wasm-safe` 子集本来就含
//! 光栅化），因此不进 `media` feature 门。

use anyhow::{Result, bail};
use tiny_skia::Pixmap;

/// 平坦区（两幅图 3×3 邻域都恒定的像素）逐通道偏差预算：超过这个值才算
/// "过渡带"像素。沿用 `gpu_conformance.rs` 原有的取值（就是渲染方案 §8.7 那个 2）。
pub const FLAT_CHANNEL_BUDGET: u8 = 2;

/// [`Comparison::ssim_downsampled`] 的盒式降采样倍率。
pub const DOWNSAMPLE_FACTOR: usize = 4;

/// 一次 RGBA 图像对拍的实测分布。
#[derive(Debug, Clone, Copy)]
pub struct Comparison {
    /// 全分辨率下四个通道（R/G/B/A）里最差的那个 SSIM（8×8 滑动窗口、样本方差）。
    pub ssim: f64,
    /// 全图逐通道最大绝对偏差。
    pub max_deviation: u8,
    /// **平坦区**（两幅图的 3×3 邻域都恒定）逐通道最大绝对偏差。§15.1 要求的
    /// "SSIM 之外记录逐通道最大偏差"诊断，对 YUV→RGB 矩阵差异这类整幅小幅
    /// 偏置比 SSIM 更敏感。
    pub flat_max_deviation: u8,
    /// 偏差 > [`FLAT_CHANNEL_BUDGET`] 的像素占比。
    pub edge_share: f64,
    /// 两侧各做一次 [`DOWNSAMPLE_FACTOR`]× 盒式降采样之后的 SSIM：把边缘过渡带
    /// 按面积摊平，衡量"两幅图观感上是不是同一幅"而不是"每个像素的抗锯齿函数
    /// 是不是同一条"。图像小于降采样倍率时退化为与 [`Comparison::ssim`] 相同的值
    /// （降采样在那种尺寸下没有意义）。
    pub ssim_downsampled: f64,
}

/// 比较两幅 RGBA `Pixmap`；尺寸不一致时返回 `Err`（不 panic——生产 CLI 路径
/// 需要把它转成正常的失败信封，而不是让整个进程崩掉）。
pub fn compare(a: &Pixmap, b: &Pixmap) -> Result<Comparison> {
    if (a.width(), a.height()) != (b.width(), b.height()) {
        bail!(
            "尺寸不一致: {}x{} vs {}x{}",
            a.width(),
            a.height(),
            b.width(),
            b.height()
        );
    }
    let (w, h) = (a.width() as usize, a.height() as usize);
    let (da, db) = (a.data(), b.data());

    let mut ssim = f64::MAX;
    for channel in 0..4 {
        let plane_a: Vec<u8> = da.iter().skip(channel).step_by(4).copied().collect();
        let plane_b: Vec<u8> = db.iter().skip(channel).step_by(4).copied().collect();
        ssim = ssim.min(plane_ssim(&plane_a, &plane_b, w, h));
    }

    let mut max_deviation = 0u8;
    let mut flat_max_deviation = 0u8;
    let mut edge_pixels = 0usize;
    for y in 0..h {
        for x in 0..w {
            let base = (y * w + x) * 4;
            let mut pixel_max = 0u8;
            for channel in 0..4 {
                pixel_max = pixel_max.max(da[base + channel].abs_diff(db[base + channel]));
            }
            max_deviation = max_deviation.max(pixel_max);
            if pixel_max > FLAT_CHANNEL_BUDGET {
                edge_pixels += 1;
            }
            if is_flat(da, w, h, x, y) && is_flat(db, w, h, x, y) {
                flat_max_deviation = flat_max_deviation.max(pixel_max);
            }
        }
    }

    let ssim_downsampled = if w >= DOWNSAMPLE_FACTOR && h >= DOWNSAMPLE_FACTOR {
        let (small_a, sw, sh) = box_downsample(da, w, h, DOWNSAMPLE_FACTOR);
        let (small_b, _, _) = box_downsample(db, w, h, DOWNSAMPLE_FACTOR);
        let mut downsampled = f64::MAX;
        for channel in 0..4 {
            let plane_a: Vec<u8> = small_a.iter().skip(channel).step_by(4).copied().collect();
            let plane_b: Vec<u8> = small_b.iter().skip(channel).step_by(4).copied().collect();
            downsampled = downsampled.min(plane_ssim(&plane_a, &plane_b, sw, sh));
        }
        downsampled
    } else {
        // 图像比降采样倍率还小：降采样没有意义，直接复用全分辨率的 SSIM。
        ssim
    };

    Ok(Comparison {
        ssim,
        max_deviation,
        flat_max_deviation,
        edge_share: edge_pixels as f64 / (w * h).max(1) as f64,
        ssim_downsampled,
    })
}

/// RGBA8 的盒式降采样（在预乘数域里平均，与执行器的超采样同一条规则）。
fn box_downsample(rgba: &[u8], w: usize, h: usize, factor: usize) -> (Vec<u8>, usize, usize) {
    let (ow, oh) = (w / factor, h / factor);
    let area = (factor * factor) as f64;
    let mut out = Vec::with_capacity(ow * oh * 4);
    for y in 0..oh {
        for x in 0..ow {
            let mut sums = [0f64; 4];
            for dy in 0..factor {
                for dx in 0..factor {
                    let base = ((y * factor + dy) * w + x * factor + dx) * 4;
                    for (channel, sum) in sums.iter_mut().enumerate() {
                        *sum += f64::from(rgba[base + channel]);
                    }
                }
            }
            for sum in sums {
                out.push((sum / area).round().clamp(0.0, 255.0) as u8);
            }
        }
    }
    (out, ow, oh)
}

/// 3×3 邻域（含自身）逐通道恒定 = "这个像素不在任何一条边上"。
///
/// 图像边界上的像素邻域不完整，一律算作**非**平坦——那是最保守的读法。
fn is_flat(data: &[u8], w: usize, h: usize, x: usize, y: usize) -> bool {
    if x == 0 || y == 0 || x + 1 >= w || y + 1 >= h {
        return false;
    }
    let center = &data[((y * w + x) * 4)..][..4];
    for dy in -1i64..=1 {
        for dx in -1i64..=1 {
            let nx = (x as i64 + dx) as usize;
            let ny = (y as i64 + dy) as usize;
            if &data[((ny * w + nx) * 4)..][..4] != center {
                return false;
            }
        }
    }
    true
}

/// 单通道 SSIM：8×8 滑窗、步长 1、窗口均值、样本方差（N−1）。
///
/// 常量取标准值 `C1 = (0.01·255)²`、`C2 = (0.03·255)²`。
fn plane_ssim(a: &[u8], b: &[u8], w: usize, h: usize) -> f64 {
    const WINDOW: usize = 8;
    const C1: f64 = 6.5025; // (0.01 * 255)^2
    const C2: f64 = 58.5225; // (0.03 * 255)^2
    if w < WINDOW || h < WINDOW {
        // 小于一个窗口时退化成全图单窗。
        return window_ssim(a, b, w, 0, 0, w, h, C1, C2);
    }
    let mut total = 0.0;
    let mut count = 0usize;
    for y in 0..=(h - WINDOW) {
        for x in 0..=(w - WINDOW) {
            total += window_ssim(a, b, w, x, y, WINDOW, WINDOW, C1, C2);
            count += 1;
        }
    }
    total / count as f64
}

#[allow(clippy::too_many_arguments)]
fn window_ssim(
    a: &[u8],
    b: &[u8],
    w: usize,
    x0: usize,
    y0: usize,
    ww: usize,
    wh: usize,
    c1: f64,
    c2: f64,
) -> f64 {
    let n = (ww.max(1) * wh.max(1)) as f64;
    let (mut sum_a, mut sum_b) = (0.0, 0.0);
    for y in y0..y0 + wh {
        for x in x0..x0 + ww {
            sum_a += f64::from(a[y * w + x]);
            sum_b += f64::from(b[y * w + x]);
        }
    }
    let (mu_a, mu_b) = (sum_a / n, sum_b / n);
    let (mut va, mut vb, mut cov) = (0.0, 0.0, 0.0);
    for y in y0..y0 + wh {
        for x in x0..x0 + ww {
            let da = f64::from(a[y * w + x]) - mu_a;
            let db = f64::from(b[y * w + x]) - mu_b;
            va += da * da;
            vb += db * db;
            cov += da * db;
        }
    }
    // 样本方差（N−1），与常见 SSIM 实现一致；单像素窗口（N=1）退化成 0。
    let denom = (n - 1.0).max(1.0);
    let (va, vb, cov) = (va / denom, vb / denom, cov / denom);
    ((2.0 * mu_a * mu_b + c1) * (2.0 * cov + c2))
        / ((mu_a * mu_a + mu_b * mu_b + c1) * (va + vb + c2))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, gray: u8) -> Pixmap {
        let mut pixmap = Pixmap::new(width, height).unwrap();
        let color = tiny_skia::Color::from_rgba8(gray, gray, gray, 255);
        pixmap.fill(color);
        pixmap
    }

    #[test]
    fn identical_solids_score_a_perfect_ssim() {
        let a = solid(16, 16, 80);
        let b = solid(16, 16, 80);
        let measured = compare(&a, &b).unwrap();
        assert!((measured.ssim - 1.0).abs() < 1e-9);
        assert!((measured.ssim_downsampled - 1.0).abs() < 1e-9);
        assert_eq!(measured.max_deviation, 0);
        assert_eq!(measured.flat_max_deviation, 0);
        assert_eq!(measured.edge_share, 0.0);
    }

    #[test]
    fn black_vs_white_scores_a_near_zero_ssim() {
        let black = solid(16, 16, 0);
        let white = solid(16, 16, 255);
        let measured = compare(&black, &white).unwrap();
        assert!(measured.ssim < 0.001, "ssim={}", measured.ssim);
        assert_eq!(measured.max_deviation, 255);
    }

    #[test]
    fn mismatched_sizes_are_reported_not_panicked() {
        let a = solid(8, 8, 0);
        let b = solid(9, 8, 0);
        let error = compare(&a, &b).unwrap_err();
        assert!(error.to_string().contains("尺寸不一致"), "{error}");
    }

    /// 图像小于降采样倍率时不 panic、不产生 NaN。
    #[test]
    fn tiny_images_fall_back_to_full_resolution_ssim() {
        let a = solid(2, 2, 40);
        let b = solid(2, 2, 40);
        let measured = compare(&a, &b).unwrap();
        assert!((measured.ssim - 1.0).abs() < 1e-9);
        assert_eq!(measured.ssim_downsampled, measured.ssim);
    }
}
