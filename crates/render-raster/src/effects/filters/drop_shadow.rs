//! 投影 / 发光（`filter.dropShadow@1`）。
//!
//! 结构与 `studio_export/render_plan.rs` 的字幕 glow 一致：**效果层 → bounded
//! blur → 预乘 source-over 垫在原图之下**。这里把它写成一个单输入滤镜：阴影层
//! 由输入自身的 alpha 着色而来。阴影层只开内容附近的局部窗口（不再整幅分配、
//! 整幅拷贝），结果与整幅 `box_blur_bounded` + `composite_premultiplied_rgba`
//! 逐字节相同，单测对拍。

use super::blur::{ContentBox, MAX_BLUR_RADIUS, alpha_bbox, box_blur_premul_u8};
use super::composite_premul::composite_premultiplied_row;

/// `color` 是非预乘 RGBA 0..1；`dx`/`dy` 是整数像素位移。
///
/// 只在一块局部窗口里干活：窗口 = 位移后内容盒外扩 2×radius（夹在画布内）
/// 与原内容盒的并集。与整幅阴影层逐字节相同的理由同 `box_blur_bounded`——
/// 窗口里离非画布边界不足 radius 的像素，其模糊窗口只读得到零，两种算法都
/// 得 0；其余像素的窗口不越出局部窗口。写回范围（模糊盒 ∪ 内容盒）也落在
/// 窗口内。单测对拍整幅实现。
pub fn drop_shadow(
    data: &mut [u8],
    width: u32,
    height: u32,
    radius: usize,
    dx: i32,
    dy: i32,
    color: [f64; 4],
) {
    let width_usize = width as usize;
    let height_usize = height as usize;
    if data.len() != width_usize * height_usize * 4 {
        return;
    }
    let Some(content) = alpha_bbox(data, width_usize, height_usize) else {
        return; // 整幅透明：没有可投影的内容
    };
    let shifted = ContentBox {
        rows: (content.rows.start as i64 + i64::from(dy)).clamp(0, height_usize as i64) as usize
            ..(content.rows.end as i64 + i64::from(dy)).clamp(0, height_usize as i64) as usize,
        cols: (content.cols.start as i64 + i64::from(dx)).clamp(0, width_usize as i64) as usize
            ..(content.cols.end as i64 + i64::from(dx)).clamp(0, width_usize as i64) as usize,
    };
    if shifted.rows.is_empty() || shifted.cols.is_empty() {
        return;
    }
    let radius = radius.min(MAX_BLUR_RADIUS);
    let margin = radius * 2;
    let window = ContentBox {
        rows: shifted
            .rows
            .start
            .saturating_sub(margin)
            .min(content.rows.start)
            ..(shifted.rows.end + margin)
                .min(height_usize)
                .max(content.rows.end),
        cols: shifted
            .cols
            .start
            .saturating_sub(margin)
            .min(content.cols.start)
            ..(shifted.cols.end + margin)
                .min(width_usize)
                .max(content.cols.end),
    };
    let window_width = window.cols.len();
    let window_height = window.rows.len();
    let local =
        |x: usize, y: usize| ((y - window.rows.start) * window_width + x - window.cols.start) * 4;

    // 阴影层：把输入的 alpha 按 color 着色，并整体位移。着色只取决于 alpha
    // 字节，先按 256 档查表（与逐像素现算同一个表达式）。
    let (cr, cg, cb, ca) = (
        color[0].clamp(0.0, 1.0),
        color[1].clamp(0.0, 1.0),
        color[2].clamp(0.0, 1.0),
        color[3].clamp(0.0, 1.0),
    );
    let mut tint = [[0_u8; 4]; 256];
    for (byte, entry) in tint.iter_mut().enumerate() {
        let alpha = byte as f64 / 255.0 * ca;
        *entry = [
            (cr * alpha * 255.0).round() as u8,
            (cg * alpha * 255.0).round() as u8,
            (cb * alpha * 255.0).round() as u8,
            (alpha * 255.0).round() as u8,
        ];
    }
    let mut shadow = vec![0_u8; window_width * window_height * 4];
    for y in content.rows.clone() {
        let target_y = y as i64 + i64::from(dy);
        if target_y < 0 || target_y >= height_usize as i64 {
            continue;
        }
        for x in content.cols.clone() {
            let source_alpha = data[(y * width_usize + x) * 4 + 3];
            if source_alpha == 0 {
                continue;
            }
            let target_x = x as i64 + i64::from(dx);
            if target_x < 0 || target_x >= width_usize as i64 {
                continue;
            }
            let offset = local(target_x as usize, target_y as usize);
            shadow[offset..offset + 4].copy_from_slice(&tint[usize::from(source_alpha)]);
        }
    }

    let blurred = if radius == 0 {
        shifted
    } else {
        box_blur_premul_u8(
            &mut shadow,
            window_width as u32,
            window_height as u32,
            radius,
        );
        ContentBox {
            rows: shifted.rows.start.saturating_sub(radius)
                ..(shifted.rows.end + radius).min(height_usize),
            cols: shifted.cols.start.saturating_sub(radius)
                ..(shifted.cols.end + radius).min(width_usize),
        }
    };

    // 阴影在下、原图在上：先把原图叠到阴影层，再把并集搬回。
    for y in content.rows.clone() {
        let start = local(content.cols.start, y);
        let end = local(content.cols.end, y);
        composite_premultiplied_row(
            &mut shadow[start..end],
            &data[(y * width_usize + content.cols.start) * 4
                ..(y * width_usize + content.cols.end) * 4],
        );
    }
    let union = ContentBox {
        rows: blurred.rows.start.min(content.rows.start)..blurred.rows.end.max(content.rows.end),
        cols: blurred.cols.start.min(content.cols.start)..blurred.cols.end.max(content.cols.end),
    };
    for y in union.rows.clone() {
        let start = (y * width_usize + union.cols.start) * 4;
        let end = (y * width_usize + union.cols.end) * 4;
        data[start..end]
            .copy_from_slice(&shadow[local(union.cols.start, y)..local(union.cols.end, y)]);
    }
}

#[cfg(test)]
mod tests {
    use super::super::blur::box_blur_bounded;
    use super::super::composite_premul::composite_premultiplied_rgba;
    use super::*;

    /// 窗口化之前的整幅实现，作对照组。
    fn reference_drop_shadow(
        data: &mut [u8],
        width: u32,
        height: u32,
        radius: usize,
        dx: i32,
        dy: i32,
        color: [f64; 4],
    ) {
        let width_usize = width as usize;
        let height_usize = height as usize;
        let Some(content) = alpha_bbox(data, width_usize, height_usize) else {
            return;
        };
        let mut shadow = vec![0_u8; data.len()];
        let (cr, cg, cb, ca) = (
            color[0].clamp(0.0, 1.0),
            color[1].clamp(0.0, 1.0),
            color[2].clamp(0.0, 1.0),
            color[3].clamp(0.0, 1.0),
        );
        for y in content.rows.clone() {
            for x in content.cols.clone() {
                let source_alpha = f64::from(data[(y * width_usize + x) * 4 + 3]) / 255.0;
                if source_alpha <= 0.0 {
                    continue;
                }
                let target_x = x as i64 + i64::from(dx);
                let target_y = y as i64 + i64::from(dy);
                if target_x < 0
                    || target_y < 0
                    || target_x >= width_usize as i64
                    || target_y >= height_usize as i64
                {
                    continue;
                }
                let alpha = source_alpha * ca;
                let offset = (target_y as usize * width_usize + target_x as usize) * 4;
                shadow[offset] = (cr * alpha * 255.0).round() as u8;
                shadow[offset + 1] = (cg * alpha * 255.0).round() as u8;
                shadow[offset + 2] = (cb * alpha * 255.0).round() as u8;
                shadow[offset + 3] = (alpha * 255.0).round() as u8;
            }
        }
        let shifted = ContentBox {
            rows: (content.rows.start as i64 + i64::from(dy)).clamp(0, height_usize as i64) as usize
                ..(content.rows.end as i64 + i64::from(dy)).clamp(0, height_usize as i64) as usize,
            cols: (content.cols.start as i64 + i64::from(dx)).clamp(0, width_usize as i64) as usize
                ..(content.cols.end as i64 + i64::from(dx)).clamp(0, width_usize as i64) as usize,
        };
        if shifted.rows.is_empty() || shifted.cols.is_empty() {
            return;
        }
        let blurred = box_blur_bounded(&mut shadow, width, height, radius, &shifted);
        let original = data.to_vec();
        composite_premultiplied_rgba(&mut shadow, &original, width_usize, &content);
        let union = ContentBox {
            rows: blurred.rows.start.min(content.rows.start)
                ..blurred.rows.end.max(content.rows.end),
            cols: blurred.cols.start.min(content.cols.start)
                ..blurred.cols.end.max(content.cols.end),
        };
        for y in union.rows.clone() {
            let start = (y * width_usize + union.cols.start) * 4;
            let end = (y * width_usize + union.cols.end) * 4;
            data[start..end].copy_from_slice(&shadow[start..end]);
        }
    }

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 32) as u32
        }
        fn below(&mut self, n: u32) -> u32 {
            self.next() % n
        }
    }

    #[test]
    fn windowed_drop_shadow_matches_full_frame() {
        let mut rng = Rng(0x0dd_b1a5_e5bad_5eed);
        let (width, height) = (71_u32, 47_u32);
        for round in 0..400 {
            let mut data = vec![0_u8; (width * height * 4) as usize];
            // 随机矩形内撒合法预乘像素；偶尔贴边、偶尔只有一个像素。
            let x0 = rng.below(width);
            let y0 = rng.below(height);
            let (w, h) = match round % 4 {
                0 => (1, 1),
                _ => (1 + rng.below(width - x0), 1 + rng.below(height - y0)),
            };
            for y in y0..y0 + h {
                for x in x0..x0 + w {
                    if rng.below(10) < 3 && round % 4 != 0 {
                        continue;
                    }
                    let offset = ((y * width + x) * 4) as usize;
                    let alpha = rng.below(256);
                    for channel in 0..3 {
                        data[offset + channel] = rng.below(alpha + 1) as u8;
                    }
                    data[offset + 3] = alpha as u8;
                }
            }
            let radius = [0, 1, 2, 5, 13, 40, 300][rng.below(7) as usize];
            let dx = rng.below(61) as i32 - 30;
            let dy = if round % 9 == 0 {
                height as i32 + 3 // 整个阴影落到画布外
            } else {
                rng.below(41) as i32 - 20
            };
            let color = [
                rng.below(1001) as f64 / 1000.0,
                rng.below(1001) as f64 / 1000.0,
                rng.below(1001) as f64 / 1000.0,
                rng.below(1201) as f64 / 1000.0,
            ];
            let mut expected = data.clone();
            reference_drop_shadow(&mut expected, width, height, radius, dx, dy, color);
            drop_shadow(&mut data, width, height, radius, dx, dy, color);
            assert!(
                data == expected,
                "round {round}: r={radius} dx={dx} dy={dy} box=({x0},{y0},{w},{h})"
            );
        }
    }
}
