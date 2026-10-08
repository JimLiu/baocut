//! `filter.godRays@1`：体积光 / 光柱——取亮部 → 以光源为中心做径向拉伸模糊 →
//! 乘色调后加回原图。
//!
//! 1. **亮通**：预乘 RGB 最大分量 `m` 超过 `threshold` 的部分按
//!    `w = clamp((m − t) / (1 − t))` 整像素加权（保留色相，金色线稿拖出金色光）；
//!    同时 2×2 降采样到半分辨率——光柱本来就是低频的，半分辨率省四分之三的取样。
//! 2. **拉伸**：与 `filter.radialBlur` 同一套三遍对数步长缩放取样
//!    （[`super::radial_blur::zoom_passes`]），中心是光源；`length` 是最远取样点朝光源
//!    走过的比例，`decay` 让远处的取样权重降到 `1 − decay`。像素 p 收到的光来自
//!    「p → 光源」连线上的亮部，所以亮物体会朝**背离光源**的方向拖出光柱。
//! 3. **加回**：双线性上采样到原分辨率，RGB × `tint`（RGB）× `intensity`、alpha ×
//!    `tint.a` × `intensity` 加到原图上，结果夹到 alpha ≥ RGB（与 `filter.bloom` 同一口径：
//!    透明底上的亮物体会长出带 alpha 的光柱）。
//!
//! 光源坐标是画布（= 输入 surface）宽高的比例，可以落在画面外（天窗在画框上方）。
//! 数值：f32 四则运算，超越函数只在进像素循环前用 `libm` 算权重表。

use super::radial_blur::{Px, bilinear, zoom_passes};

/// 每遍取样数：三遍共 512 个等效采样点。
const TAPS: u32 = 8;

#[derive(Debug, Clone, Copy)]
pub struct GodRays {
    pub cx: f64,
    pub cy: f64,
    pub threshold: f64,
    /// 最远取样点朝光源走过的比例 `0..0.95`。
    pub length: f64,
    pub intensity: f64,
    /// `0..1`：最远处的权重是 `1 − decay`。
    pub decay: f64,
    /// 非预乘 RGBA 0..1。
    pub tint: [f64; 4],
}

pub fn god_rays(data: &mut [u8], width: usize, height: usize, params: &GodRays) {
    let length = params.length.clamp(0.0, 0.95);
    if width == 0 || height == 0 || params.intensity <= 0.0 || length <= 0.0 {
        return;
    }
    let threshold = params.threshold.clamp(0.0, 0.999) as f32;
    let (hw, hh) = (width.div_ceil(2), height.div_ceil(2));

    // 1. 亮通 + 2×2 降采样（边缘夹取）。
    let bright = |x: usize, y: usize| -> Px {
        let offset = (y.min(height - 1) * width + x.min(width - 1)) * 4;
        let px = &data[offset..offset + 4];
        let peak = f32::from(px[0].max(px[1]).max(px[2])) / 255.0;
        let weight = ((peak - threshold) / (1.0 - threshold)).clamp(0.0, 1.0);
        [
            f32::from(px[0]) * weight,
            f32::from(px[1]) * weight,
            f32::from(px[2]) * weight,
            f32::from(px[3]) * weight,
        ]
    };
    let mut rays: Vec<Px> = Vec::with_capacity(hw * hh);
    for y in 0..hh {
        for x in 0..hw {
            let (a, b) = (bright(2 * x, 2 * y), bright(2 * x + 1, 2 * y));
            let (c, d) = (bright(2 * x, 2 * y + 1), bright(2 * x + 1, 2 * y + 1));
            let mut px = [0.0f32; 4];
            for k in 0..4 {
                px[k] = (a[k] + b[k] + c[k] + d[k]) / 4.0;
            }
            rays.push(px);
        }
    }

    // 2. 以光源为中心的径向拉伸（半分辨率像素坐标）。
    let center = (
        params.cx * width as f64 / 2.0,
        params.cy * height as f64 / 2.0,
    );
    let sigma = -libm::log(1.0 - length);
    zoom_passes(
        &mut rays,
        hw,
        hh,
        center,
        sigma,
        TAPS,
        1.0 - params.decay.clamp(0.0, 0.9999),
    );

    // 3. 上采样、上色、加回。
    let gain = params.intensity as f32;
    let tint = [
        params.tint[0].clamp(0.0, 1.0) as f32 * gain,
        params.tint[1].clamp(0.0, 1.0) as f32 * gain,
        params.tint[2].clamp(0.0, 1.0) as f32 * gain,
        params.tint[3].clamp(0.0, 1.0) as f32 * gain,
    ];
    for y in 0..height {
        let sy = (y as f32 + 0.5) / 2.0 - 0.5;
        for x in 0..width {
            let sx = (x as f32 + 0.5) / 2.0 - 0.5;
            let light = bilinear(&rays, hw, hh, sx, sy);
            let offset = (y * width + x) * 4;
            let out = &mut data[offset..offset + 4];
            let alpha = (f32::from(out[3]) + light[3] * tint[3]).min(255.0);
            for k in 0..3 {
                let value = (f32::from(out[k]) + light[k] * tint[k]).min(alpha);
                out[k] = value.round() as u8;
            }
            out[3] = alpha.round() as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> GodRays {
        GodRays {
            cx: 0.5,
            cy: 0.0,
            threshold: 0.5,
            length: 0.6,
            intensity: 1.5,
            decay: 0.5,
            tint: [1.0, 0.85, 0.5, 1.0],
        }
    }

    #[test]
    fn below_threshold_and_zero_intensity_are_identity() {
        let mut data: Vec<u8> = (0..64 * 64).flat_map(|_| [60, 60, 60, 255]).collect();
        let before = data.clone();
        god_rays(&mut data, 64, 64, &params());
        assert_eq!(data, before);
        let mut bright: Vec<u8> = (0..64 * 64).flat_map(|_| [255, 255, 255, 255]).collect();
        let copy = bright.clone();
        god_rays(
            &mut bright,
            64,
            64,
            &GodRays {
                intensity: 0.0,
                ..params()
            },
        );
        assert_eq!(bright, copy);
    }

    #[test]
    fn a_bright_spot_casts_a_shaft_away_from_the_light() {
        let size = 96;
        let mut data: Vec<u8> = (0..size * size).flat_map(|_| [0, 0, 0, 255]).collect();
        // 光源在上边缘正中，亮块在 (48, 24) 附近。
        for y in 22..26 {
            for x in 46..50 {
                let offset = (y * size + x) * 4;
                data[offset..offset + 4].copy_from_slice(&[255, 230, 150, 255]);
            }
        }
        god_rays(&mut data, size, size, &params());
        let red = |x: usize, y: usize| data[(y * size + x) * 4];
        // 亮块下方（背离光源）被照亮，上方（光源一侧）与侧面仍暗。
        assert!(red(48, 40) > 10, "下方应有光柱：{}", red(48, 40));
        assert!(red(48, 40) > red(48, 60), "光柱应随距离衰减");
        assert_eq!(red(48, 12), 0, "光源一侧不应有光");
        assert_eq!(red(20, 40), 0, "侧面不应有光");
    }
}
