//! `transition.glitch@1`：数字故障切换——画面切成条带各自错位、RGB 三通道分离、
//! 偶尔整帧闪白，出场与入场画面在条带之间来回跳，最后停在入场画面上。
//!
//! 全部随机量按 progress 的**档位** `b = ⌊p·steps⌋` 取（`splitmix64(seed, 档位×…)`），
//! 同一档内画面不变、跨档整体重掷——这就是故障的「卡顿」节奏，而且是 progress
//! 的纯函数（可 seek）。强度 `I = 1 − |2p − 1|` 在转场正中最大、两端归零；
//! 条带换成入场画面的比例 `q = clamp((p − 0.25) / 0.5)`，每条带各自掷骰。
//!
//! `direction = "vertical"`（缺省）把画面切成**竖条**、各条上下错位，RGB 沿竖直
//! 方向分离；`"horizontal"` 切成横条、左右错位。错位取样在画布边缘夹取，所以
//! 移出去的部分会拖出一道边缘像素的拖影。
//!
//! 位移全部取整后按最近像素搬运，没有超越函数；`progress = 0` / `1` 直接拷贝
//! `from` / `to`。

use motion::rng::splitmix64_unit;

#[derive(Debug, Clone, Copy)]
pub struct Glitch {
    /// true = 竖条上下错位；false = 横条左右错位。
    pub vertical: bool,
    /// 条带数（取整，2..=400）。
    pub slices: f64,
    /// 条带最大错位（像素，已按画布短边换算）。
    pub amount: f64,
    /// RGB 分离距离（像素，已换算）。
    pub rgb: f64,
    /// progress 上的重掷档数（取整，2..=120）。
    pub steps: f64,
    /// 闪白概率与亮度 `0..1`。
    pub flicker: f64,
    pub seed: u64,
}

pub fn glitch(
    from: &[u8],
    to: &[u8],
    out: &mut [u8],
    width: u32,
    height: u32,
    params: &Glitch,
    progress: f64,
) {
    if progress <= 0.0 || width == 0 || height == 0 {
        out.copy_from_slice(from);
        return;
    }
    if progress >= 1.0 {
        out.copy_from_slice(to);
        return;
    }
    let steps = params.steps.round().clamp(2.0, 120.0);
    let bucket = ((progress * steps).floor()).min(steps - 1.0) as i64;
    let intensity = 1.0 - (2.0 * progress - 1.0).abs();
    let to_share = ((progress - 0.25) / 0.5).clamp(0.0, 1.0);
    let random = |slot: i64| splitmix64_unit(params.seed, bucket * 1_048_576 + slot);

    // 切条的轴：竖条沿 x 排开、沿 y 错位；横条反过来。
    let (across, along) = if params.vertical {
        (width as usize, height as usize)
    } else {
        (height as usize, width as usize)
    };
    let slice_count = params.slices.round().clamp(2.0, 400.0) as usize;
    // 本档的条带宽度：各条 0.3..1.3 的随机权重，按比例铺满整条轴。
    let weights: Vec<f64> = (0..slice_count)
        .map(|k| 0.3 + random(k as i64 * 8))
        .collect();
    let total: f64 = weights.iter().sum();
    struct Band {
        shift: isize,
        to: bool,
    }
    let bands: Vec<Band> = (0..slice_count)
        .map(|k| {
            let slot = k as i64 * 8;
            let active = random(slot + 1) < 0.2 + 0.7 * intensity;
            let tear = if random(slot + 2) > 0.85 { 2.5 } else { 1.0 };
            let shift = if active {
                ((2.0 * random(slot + 3) - 1.0) * params.amount * intensity * tear).round() as isize
            } else {
                0
            };
            Band {
                shift,
                to: random(slot + 4) < to_share,
            }
        })
        .collect();
    // 每个横坐标（沿切条轴）属于哪一条带。
    let mut band_of = Vec::with_capacity(across);
    let mut band = 0usize;
    let mut next = weights[0] / total * across as f64;
    for position in 0..across {
        let center = position as f64 + 0.5;
        while center >= next && band + 1 < slice_count {
            band += 1;
            next += weights[band] / total * across as f64;
        }
        band_of.push(band);
    }
    let split = (params.rgb * intensity * (0.5 + random(-1))).round() as isize;
    let flash = if random(-2) < params.flicker.clamp(0.0, 1.0) * intensity {
        0.35 * intensity * params.flicker.clamp(0.0, 1.0)
    } else {
        0.0
    };

    let w = width as usize;
    let fetch = |a: usize, b: isize| -> usize {
        let b = b.clamp(0, along as isize - 1) as usize;
        let (x, y) = if params.vertical { (a, b) } else { (b, a) };
        (y * w + x) * 4
    };
    for y in 0..height as usize {
        for x in 0..w {
            let (a, b) = if params.vertical { (x, y) } else { (y, x) };
            let band = &bands[band_of[a]];
            let source = if band.to { to } else { from };
            let base = b as isize - band.shift;
            let red = fetch(a, base + split);
            let green = fetch(a, base);
            let blue = fetch(a, base - split);
            let alpha = source[red + 3].max(source[green + 3]).max(source[blue + 3]);
            let mut pixel = [source[red], source[green + 1], source[blue + 2], alpha];
            if flash > 0.0 {
                for channel in 0..3 {
                    let c = f64::from(pixel[channel]);
                    pixel[channel] = (c + (f64::from(alpha) - c) * flash).round() as u8;
                }
            }
            let offset = (y * w + x) * 4;
            out[offset..offset + 4].copy_from_slice(&pixel);
        }
    }
}
