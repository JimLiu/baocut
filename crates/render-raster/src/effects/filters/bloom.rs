//! `filter.bloom@1`：软膝亮通 + 多级降采样 / 上采样金字塔 + 加法回混。
//!
//! 全程 f32 四则运算（级数由 `libm::log2` 定），不依赖平台超越函数实现，
//! 同一输入在 native 与 wasm 上逐位一致。像素约定与其余滤镜相同：预乘 sRGB / u8。

type Px = [f32; 4];

/// 金字塔级数上限：2⁸ = 256 px 的扩散已经覆盖 4K 画布的大半短边。
const MAX_LEVELS: usize = 8;

/// 泛光。`radius_px` 已按画布短边换算成像素。
#[allow(clippy::too_many_arguments)]
pub fn bloom(
    data: &mut [u8],
    width: usize,
    height: usize,
    threshold: f64,
    knee: f64,
    radius_px: f64,
    intensity: f64,
) {
    if width == 0 || height == 0 || intensity <= 0.0 || radius_px <= 0.0 {
        return;
    }
    // 级数取 log2(半径)，夹到 [1, 8]；末级按小数部分加权，半径动画时连续。
    let exact = libm::log2(radius_px.max(1.0)).clamp(1.0, MAX_LEVELS as f64);
    let levels = exact.ceil() as usize;
    let mut last_weight = (exact - (levels - 1) as f64) as f32;
    if last_weight <= 0.0 {
        last_weight = 1.0;
    }

    let threshold = threshold.clamp(0.0, 1.0) as f32;
    let knee = knee.clamp(0.0, 1.0) as f32;

    // 第 0 级：亮通与第一次降采样合在一起做，不留整幅 f32 缓冲。
    let mut pyramid: Vec<(Vec<Px>, usize, usize)> = Vec::with_capacity(levels);
    pyramid.push(downsample_bright(data, width, height, threshold, knee));
    while pyramid.len() < levels {
        let (prev, w, h) = pyramid.last().expect("至少一级");
        if *w == 1 && *h == 1 {
            // 已经缩到 1×1：再降没有意义，末级按满权重算。
            last_weight = 1.0;
            break;
        }
        let next = downsample(prev, *w, *h);
        pyramid.push(next);
    }
    let used = pyramid.len();
    if used == 1 {
        last_weight = 1.0;
    }

    // 上采样链：b_{n-1} = w·a_{n-1}；b_i = a_i + up(b_{i+1})。
    {
        let (deepest, _, _) = pyramid.last_mut().expect("至少一级");
        if last_weight != 1.0 {
            for px in deepest.iter_mut() {
                for c in px.iter_mut() {
                    *c *= last_weight;
                }
            }
        }
    }
    for level in (0..used - 1).rev() {
        let (coarse_part, fine_part) = {
            let (head, tail) = pyramid.split_at_mut(level + 1);
            (&tail[0], &mut head[level])
        };
        let (coarse, cw, ch) = coarse_part;
        let (fine, fw, fh) = fine_part;
        upsample_add(coarse, *cw, *ch, fine, *fw, *fh);
    }

    let total = (used - 1) as f32 + last_weight;
    let gain = intensity as f32 / total;
    let (glow, gw, gh) = &pyramid[0];
    let mut row: Vec<Px> = vec![[0.0; 4]; width];
    for y in 0..height {
        upsample_row(glow, *gw, *gh, y, &mut row);
        let line = &mut data[y * width * 4..(y + 1) * width * 4];
        for (x, px) in row.iter().enumerate() {
            let out = &mut line[x * 4..x * 4 + 4];
            let alpha = (f32::from(out[3]) / 255.0 + px[3] * gain).min(1.0);
            for c in 0..3 {
                let value = (f32::from(out[c]) / 255.0 + px[c] * gain).min(alpha);
                out[c] = to_u8(value);
            }
            out[3] = to_u8(alpha);
        }
    }
}

fn to_u8(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// 软膝亮通（Unity 式二次膝）：权重作用在预乘 RGB 上，alpha 取发光量本身，
/// 这样透明底上的亮物体会长出自带 alpha 的光晕。
fn bright(px: &[u8], threshold: f32, knee: f32) -> Px {
    let r = f32::from(px[0]) / 255.0;
    let g = f32::from(px[1]) / 255.0;
    let b = f32::from(px[2]) / 255.0;
    let peak = r.max(g).max(b);
    if peak <= 0.0 {
        return [0.0; 4];
    }
    let soft = (peak - threshold + knee).clamp(0.0, 2.0 * knee);
    let soft = soft * soft / (4.0 * knee + 1e-5);
    let weight = soft.max(peak - threshold) / peak.max(1e-5);
    if weight <= 0.0 {
        return [0.0; 4];
    }
    [r * weight, g * weight, b * weight, (peak * weight).min(1.0)]
}

/// 帐篷核 [1,3,3,1]/8 的一维 2× 降采样，边缘夹取。
fn tap(get: impl Fn(usize) -> Px, len: usize, x: usize) -> Px {
    let at = |i: isize| get(i.clamp(0, len as isize - 1) as usize);
    let c = 2 * x as isize;
    let (a, b, d, e) = (at(c - 1), at(c), at(c + 1), at(c + 2));
    let mut out = [0.0f32; 4];
    for k in 0..4 {
        out[k] = (a[k] + 3.0 * b[k] + 3.0 * d[k] + e[k]) / 8.0;
    }
    out
}

fn half(len: usize) -> usize {
    len.div_ceil(2).max(1)
}

fn downsample_bright(
    data: &[u8],
    width: usize,
    height: usize,
    threshold: f32,
    knee: f32,
) -> (Vec<Px>, usize, usize) {
    let hw = half(width);
    let hh = half(height);
    let mut tmp: Vec<Px> = Vec::with_capacity(hw * height);
    let mut row: Vec<Px> = vec![[0.0; 4]; width];
    for y in 0..height {
        let line = &data[y * width * 4..(y + 1) * width * 4];
        for (x, slot) in row.iter_mut().enumerate() {
            *slot = bright(&line[x * 4..x * 4 + 4], threshold, knee);
        }
        for x in 0..hw {
            tmp.push(tap(|i| row[i], width, x));
        }
    }
    (vertical(&tmp, hw, height, hh), hw, hh)
}

fn downsample(src: &[Px], width: usize, height: usize) -> (Vec<Px>, usize, usize) {
    let hw = half(width);
    let hh = half(height);
    let mut tmp: Vec<Px> = Vec::with_capacity(hw * height);
    for y in 0..height {
        let row = &src[y * width..(y + 1) * width];
        for x in 0..hw {
            tmp.push(tap(|i| row[i], width, x));
        }
    }
    (vertical(&tmp, hw, height, hh), hw, hh)
}

fn vertical(tmp: &[Px], width: usize, height: usize, out_height: usize) -> Vec<Px> {
    let mut out = Vec::with_capacity(width * out_height);
    for y in 0..out_height {
        for x in 0..width {
            out.push(tap(|i| tmp[i * width + x], height, y));
        }
    }
    out
}

/// 细级坐标 `i` 在粗级上的两个双线性抽头（像素中心对齐）。
fn up_taps(i: usize, coarse_len: usize) -> [(usize, f32); 2] {
    let last = coarse_len as isize - 1;
    let clamp = |v: isize| v.clamp(0, last) as usize;
    let half = (i / 2) as isize;
    if i % 2 == 0 {
        [(clamp(half - 1), 0.25), (clamp(half), 0.75)]
    } else {
        [(clamp(half), 0.75), (clamp(half + 1), 0.25)]
    }
}

fn upsample_row(coarse: &[Px], cw: usize, ch: usize, y: usize, out: &mut [Px]) {
    let rows = up_taps(y, ch);
    for (x, slot) in out.iter_mut().enumerate() {
        let cols = up_taps(x, cw);
        let mut acc = [0.0f32; 4];
        for (ry, wy) in rows {
            for (cx, wx) in cols {
                let px = coarse[ry * cw + cx];
                let w = wy * wx;
                for k in 0..4 {
                    acc[k] += px[k] * w;
                }
            }
        }
        *slot = acc;
    }
}

fn upsample_add(coarse: &[Px], cw: usize, ch: usize, fine: &mut [Px], fw: usize, fh: usize) {
    let mut row: Vec<Px> = vec![[0.0; 4]; fw];
    for y in 0..fh {
        upsample_row(coarse, cw, ch, y, &mut row);
        for (slot, add) in fine[y * fw..(y + 1) * fw].iter_mut().zip(&row) {
            for k in 0..4 {
                slot[k] += add[k];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dot(size: usize) -> Vec<u8> {
        let mut data = vec![0u8; size * size * 4];
        let c = size / 2;
        for y in c - 1..=c {
            for x in c - 1..=c {
                data[(y * size + x) * 4..(y * size + x) * 4 + 4].copy_from_slice(&[255; 4]);
            }
        }
        data
    }

    #[test]
    fn a_bright_dot_on_transparent_grows_a_halo_with_alpha() {
        let mut data = dot(32);
        bloom(&mut data, 32, 32, 0.5, 0.2, 6.0, 2.0);
        let at = |x: usize, y: usize| &data[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4];
        // 离中心 4 px 处原本全透明，现在有光。
        assert!(at(20, 16)[3] > 0, "{:?}", at(20, 16));
        assert!(at(20, 16)[0] <= at(20, 16)[3]);
        assert_eq!(at(16, 16), &[255, 255, 255, 255]);
        // 远角仍是暗的，且亮度随距离单调下降。
        assert!(at(16 + 2, 16)[3] >= at(16 + 6, 16)[3]);
    }

    #[test]
    fn below_threshold_and_zero_intensity_are_identity() {
        let mut dim = vec![100u8, 100, 100, 255].repeat(16 * 16);
        let before = dim.clone();
        bloom(&mut dim, 16, 16, 0.9, 0.0, 4.0, 1.0);
        assert_eq!(dim, before);
        let mut bright = dot(16);
        let before = bright.clone();
        bloom(&mut bright, 16, 16, 0.1, 0.1, 4.0, 0.0);
        assert_eq!(bright, before);
    }

    #[test]
    fn radius_changes_are_continuous_between_levels() {
        let run = |radius: f64| {
            let mut data = dot(64);
            bloom(&mut data, 64, 64, 0.5, 0.2, radius, 1.0);
            data
        };
        let a = run(7.99);
        let b = run(8.01);
        let max_delta = a
            .iter()
            .zip(&b)
            .map(|(x, y)| (i16::from(*x) - i16::from(*y)).abs())
            .max()
            .unwrap();
        assert!(max_delta <= 3, "跨级跳变 {max_delta}");
    }
}
