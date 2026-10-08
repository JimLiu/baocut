//! 圆角矩形 / 椭圆的 SDF 覆盖率遮罩（`mask.shape@1`）。
//!
//! **逐行搬自** `core/crates/bcut-kernel/src/cmd/studio_export/raster.rs::apply_local_clip`。
//! 覆盖率乘在**预乘四通道**上，因此预乘不变式 `rgb ≤ a` 保持成立。

/// 覆盖率乘一个像素的全部四个通道。位精确来源：`multiply_pixel_coverage`。
pub fn multiply_pixel_coverage(pixel: &mut [u8], coverage: f64) {
    let coverage = coverage.clamp(0.0, 1.0);
    for channel in pixel {
        *channel = (f64::from(*channel) * coverage).round() as u8;
    }
}

/// 整幅乘一个不透明度。位精确来源：`multiply_premultiplied_alpha`。
pub fn multiply_premultiplied_alpha(data: &mut [u8], opacity: f64) {
    let opacity = opacity.clamp(0.0, 1.0);
    // `(v as f64 * 1.0).round() as u8 == v` 对全部 u8 成立，所以满不透明是恒等变换：
    // 跳过整幅扫描，不写任何字节（与 `mask_shape` 的恒等短路同一约定）。
    if opacity >= 1.0 {
        return;
    }
    for channel in data {
        *channel = (f64::from(*channel) * opacity).round() as u8;
    }
}

/// `radius <= 0 && !ellipse` 时是恒等变换（与原实现一致：不写任何字节）。
pub fn mask_shape(
    data: &mut [u8],
    width: u32,
    height: u32,
    radius: f64,
    ellipse: bool,
    feather: f64,
) {
    mask_shape_corners(data, width, height, [radius; 4], ellipse, feather)
}

/// 四角独立的圆角矩形遮罩。半径顺序为左上、右上、右下、左下；旧单值入口
/// [`mask_shape`] 只是把同一个值复制四次，因此历史像素保持不变。
pub fn mask_shape_corners(
    data: &mut [u8],
    width: u32,
    height: u32,
    radii: [f64; 4],
    ellipse: bool,
    feather: f64,
) {
    if !ellipse && radii.iter().all(|radius| *radius <= 0.0) {
        return;
    }
    let pixmap_width = width as usize;
    let width = f64::from(width);
    let height_f = f64::from(height);
    let center_x = width / 2.0;
    let center_y = height_f / 2.0;
    let radii = radii.map(|radius| radius.max(0.0).min(width.min(height_f) / 2.0));
    let softness = (1.0 + feather).max(1.0);
    for y in 0..height as usize {
        for x in 0..pixmap_width {
            let px = x as f64 + 0.5;
            let py = y as f64 + 0.5;
            let signed_distance = if ellipse {
                let rx = (width / 2.0).max(0.5);
                let ry = (height_f / 2.0).max(0.5);
                ((((px - center_x) / rx).powi(2) + ((py - center_y) / ry).powi(2)).sqrt() - 1.0)
                    * rx.min(ry)
            } else {
                let radius = match (px < center_x, py < center_y) {
                    (true, true) => radii[0],
                    (false, true) => radii[1],
                    (false, false) => radii[2],
                    (true, false) => radii[3],
                };
                let qx = (px - center_x).abs() - (width / 2.0 - radius);
                let qy = (py - center_y).abs() - (height_f / 2.0 - radius);
                qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - radius
            };
            let coverage = (0.5 - signed_distance) / softness + 0.5 * (softness - 1.0) / softness;
            let offset = (y * pixmap_width + x) * 4;
            multiply_pixel_coverage(&mut data[offset..offset + 4], coverage);
        }
    }
}
