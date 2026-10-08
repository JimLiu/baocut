//! 颜色类滤镜的 CPU 参考实现。
//!
//! [`color_adjust`] 与 [`brightness_only`] **逐行搬自**
//! `core/crates/bcut-kernel/src/cmd/studio_export/raster.rs` 的 `apply_media_effects`（颜色段）
//! 与 `adjust_brightness`；其余（contrast / saturation / sepia / hueRotate）
//! 是本次新增，沿用同一套约定：**反预乘到 f64 → 在 0..255 域运算 → clamp →
//! 乘回 alpha 并 `round()`**，alpha 通道从不改动。
//!
//! 为什么 `color_adjust` 是一个配方而不是 `grayscale ∘ brightness`：原实现在
//! **同一趟循环**里先插值到灰再加亮度偏移，只 clamp 一次、只 round 一次。
//! 拆成两条串联的 filter 会多一次 u8 round-trip，像素不同。

/// Rec.709 亮度权重。
pub const LUMA: [f64; 3] = [0.2126, 0.7152, 0.0722];

fn luma(r: f64, g: f64, b: f64) -> f64 {
    r * LUMA[0] + g * LUMA[1] + b * LUMA[2]
}

/// 反预乘 → `f(r, g, b)` → clamp → 重新预乘并四舍五入。alpha 不变。
fn map_unpremultiplied(data: &mut [u8], mut f: impl FnMut(f64, f64, f64) -> (f64, f64, f64)) {
    for pixel in data.chunks_exact_mut(4) {
        let alpha = f64::from(pixel[3]) / 255.0;
        if alpha <= 0.0 {
            continue;
        }
        let red = f64::from(pixel[0]) / alpha;
        let green = f64::from(pixel[1]) / alpha;
        let blue = f64::from(pixel[2]) / alpha;
        let (red, green, blue) = f(red, green, blue);
        pixel[0] = (red.clamp(0.0, 255.0) * alpha).round() as u8;
        pixel[1] = (green.clamp(0.0, 255.0) * alpha).round() as u8;
        pixel[2] = (blue.clamp(0.0, 255.0) * alpha).round() as u8;
    }
}

/// Timeline 0.1 的 `fx {grayscale, brightness}`（`filter.colorAdjust@1`）。
/// 位精确来源：`studio_export/raster.rs::apply_media_effects` 的颜色段。
pub fn color_adjust(data: &mut [u8], grayscale: f64, brightness: f64) {
    let grayscale = grayscale.clamp(0.0, 1.0);
    let brightness = brightness.clamp(-1.0, 1.0);
    if grayscale <= 0.0 && brightness == 0.0 {
        return;
    }
    for pixel in data.chunks_exact_mut(4) {
        let alpha = f64::from(pixel[3]) / 255.0;
        if alpha <= 0.0 {
            continue;
        }
        let mut red = f64::from(pixel[0]) / alpha;
        let mut green = f64::from(pixel[1]) / alpha;
        let mut blue = f64::from(pixel[2]) / alpha;
        let gray = red * LUMA[0] + green * LUMA[1] + blue * LUMA[2];
        red = red + (gray - red) * grayscale + brightness * 255.0;
        green = green + (gray - green) * grayscale + brightness * 255.0;
        blue = blue + (gray - blue) * grayscale + brightness * 255.0;
        pixel[0] = (red.clamp(0.0, 255.0) * alpha).round() as u8;
        pixel[1] = (green.clamp(0.0, 255.0) * alpha).round() as u8;
        pixel[2] = (blue.clamp(0.0, 255.0) * alpha).round() as u8;
    }
}

/// 只加亮度（`filter.brightness@1`）。位精确来源：`adjust_brightness`。
pub fn brightness_only(data: &mut [u8], amount: f64) {
    for pixel in data.chunks_exact_mut(4) {
        let alpha = f64::from(pixel[3]) / 255.0;
        if alpha <= 0.0 {
            continue;
        }
        for channel in &mut pixel[..3] {
            let raw = f64::from(*channel) / alpha + amount * 255.0;
            *channel = (raw.clamp(0.0, 255.0) * alpha).round() as u8;
        }
    }
}

/// 向 Rec.709 亮度插值（`filter.grayscale@1`）。
pub fn grayscale(data: &mut [u8], amount: f64) {
    let amount = amount.clamp(0.0, 1.0);
    map_unpremultiplied(data, |r, g, b| {
        let gray = luma(r, g, b);
        (
            r + (gray - r) * amount,
            g + (gray - g) * amount,
            b + (gray - b) * amount,
        )
    });
}

/// 围绕 127.5 缩放（`filter.contrast@1`）。
pub fn contrast(data: &mut [u8], amount: f64) {
    let factor = 1.0 + amount.clamp(-1.0, 1.0);
    map_unpremultiplied(data, |r, g, b| {
        (
            (r - 127.5) * factor + 127.5,
            (g - 127.5) * factor + 127.5,
            (b - 127.5) * factor + 127.5,
        )
    });
}

/// 以亮度为锚做线性插值（`filter.saturation@1`）。`amount = 1` 是恒等。
pub fn saturation(data: &mut [u8], amount: f64) {
    map_unpremultiplied(data, |r, g, b| {
        let gray = luma(r, g, b);
        (
            gray + (r - gray) * amount,
            gray + (g - gray) * amount,
            gray + (b - gray) * amount,
        )
    });
}

/// 3×3 颜色矩阵（行优先，作用在 0..255 域），与恒等矩阵按 `amount` 插值。
fn apply_matrix(data: &mut [u8], matrix: [f64; 9], amount: f64) {
    let identity = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    let mut m = [0.0f64; 9];
    for index in 0..9 {
        m[index] = identity[index] + (matrix[index] - identity[index]) * amount;
    }
    map_unpremultiplied(data, |r, g, b| {
        (
            m[0] * r + m[1] * g + m[2] * b,
            m[3] * r + m[4] * g + m[5] * b,
            m[6] * r + m[7] * g + m[8] * b,
        )
    });
}

/// W3C filter-effects 的 sepia 矩阵（`filter.sepia@1`）。
pub fn sepia(data: &mut [u8], amount: f64) {
    apply_matrix(
        data,
        [
            0.393, 0.769, 0.189, //
            0.349, 0.686, 0.168, //
            0.272, 0.534, 0.131,
        ],
        amount.clamp(0.0, 1.0),
    );
}

/// W3C filter-effects 的 hue-rotate 矩阵（`filter.hueRotate@1`）。
pub fn hue_rotate(data: &mut [u8], degrees: f64) {
    let radians = degrees.to_radians();
    let (sin, cos) = radians.sin_cos();
    let matrix = [
        0.213 + cos * 0.787 - sin * 0.213,
        0.715 - cos * 0.715 - sin * 0.715,
        0.072 - cos * 0.072 + sin * 0.928,
        0.213 - cos * 0.213 + sin * 0.143,
        0.715 + cos * 0.285 + sin * 0.140,
        0.072 - cos * 0.072 - sin * 0.283,
        0.213 - cos * 0.213 - sin * 0.787,
        0.715 - cos * 0.715 + sin * 0.715,
        0.072 + cos * 0.928 + sin * 0.072,
    ];
    apply_matrix(data, matrix, 1.0);
}

/// 反色，与恒等色按 `amount` 插值；在反预乘颜色域运算，alpha 不变。
pub fn invert(data: &mut [u8], amount: f64) {
    let amount = amount.clamp(0.0, 1.0);
    map_unpremultiplied(data, |r, g, b| {
        (
            r + (255.0 - 2.0 * r) * amount,
            g + (255.0 - 2.0 * g) * amount,
            b + (255.0 - 2.0 * b) * amount,
        )
    });
}
