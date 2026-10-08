//! 媒体面板的确定性像素效果：锐化、噪点与暗角。
//!
//! 三条内核都只依赖输入像素、尺寸和参数；没有时钟或未播种随机数，因而能在
//! App 预览、CLI 导出和 WASM CPU reference 之间保持相同输出。

fn scale_premul(channel: u8, factor: f64) -> u8 {
    (f64::from(channel) * factor).round().clamp(0.0, 255.0) as u8
}

pub fn sharpen(data: &mut [u8], width: u32, height: u32, amount: f64) {
    let amount = amount.clamp(0.0, 1.0);
    if amount <= 0.0 || width == 0 || height == 0 {
        return;
    }
    let source = data.to_vec();
    let width = width as usize;
    let height = height as usize;
    let pixel = |x: usize, y: usize, channel: usize| -> f64 {
        f64::from(source[(y * width + x) * 4 + channel])
    };
    for y in 0..height {
        for x in 0..width {
            let left = x.saturating_sub(1);
            let right = (x + 1).min(width - 1);
            let top = y.saturating_sub(1);
            let bottom = (y + 1).min(height - 1);
            let index = (y * width + x) * 4;
            for channel in 0..3 {
                let center = pixel(x, y, channel);
                let edge = 4.0 * center
                    - pixel(left, y, channel)
                    - pixel(right, y, channel)
                    - pixel(x, top, channel)
                    - pixel(x, bottom, channel);
                data[index + channel] = (center + edge * amount * 0.35)
                    .round()
                    .clamp(0.0, f64::from(source[index + 3]))
                    as u8;
            }
        }
    }
}

fn coordinate_noise(x: u32, y: u32) -> f64 {
    let mut value = u64::from(x) | (u64::from(y) << 32);
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^= value >> 31;
    (value & 0xffff) as f64 / 65_535.0 * 2.0 - 1.0
}

pub fn noise(data: &mut [u8], width: u32, height: u32, amount: f64) {
    let amount = amount.clamp(0.0, 1.0);
    if amount <= 0.0 || width == 0 || height == 0 {
        return;
    }
    for y in 0..height {
        for x in 0..width {
            let index = (y as usize * width as usize + x as usize) * 4;
            let alpha = f64::from(data[index + 3]) / 255.0;
            let delta = coordinate_noise(x, y) * 64.0 * amount * alpha;
            for channel in &mut data[index..index + 3] {
                *channel = (f64::from(*channel) + delta)
                    .round()
                    .clamp(0.0, 255.0 * alpha) as u8;
            }
        }
    }
}

pub fn vignette(data: &mut [u8], width: u32, height: u32, amount: f64) {
    let amount = amount.clamp(0.0, 1.0);
    if amount <= 0.0 || width == 0 || height == 0 {
        return;
    }
    let center_x = f64::from(width.saturating_sub(1)) / 2.0;
    let center_y = f64::from(height.saturating_sub(1)) / 2.0;
    let rx = center_x.max(1.0);
    let ry = center_y.max(1.0);
    for y in 0..height {
        for x in 0..width {
            let nx = (f64::from(x) - center_x) / rx;
            let ny = (f64::from(y) - center_y) / ry;
            let radius = (nx * nx + ny * ny).sqrt() / 2.0_f64.sqrt();
            let edge = ((radius - 0.42) / 0.58).clamp(0.0, 1.0);
            let smooth = edge * edge * (3.0 - 2.0 * edge);
            let factor = 1.0 - smooth * amount * 0.85;
            let index = (y as usize * width as usize + x as usize) * 4;
            for channel in &mut data[index..index + 3] {
                *channel = scale_premul(*channel, factor);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noise_is_coordinate_deterministic_and_preserves_alpha() {
        let mut first = [64_u8, 64, 64, 128].repeat(16);
        let mut second = first.clone();
        noise(&mut first, 4, 4, 0.8);
        noise(&mut second, 4, 4, 0.8);
        assert_eq!(first, second);
        assert!(first.chunks_exact(4).all(|pixel| pixel[3] == 128));
    }

    #[test]
    fn vignette_leaves_the_center_brighter_than_the_corner() {
        let mut pixels = vec![255; 5 * 5 * 4];
        vignette(&mut pixels, 5, 5, 1.0);
        assert!(pixels[(2 * 5 + 2) * 4] > pixels[0]);
        assert!(pixels.chunks_exact(4).all(|pixel| pixel[3] == 255));
    }
}
