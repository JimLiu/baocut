//! 缩小画的源画面：先按面积平均预滤波，再交给双线性（架构设计 §9.3）。
//!
//! tiny-skia 的 Bilinear 每个目标像素只读 2×2 个源像素。源画面缩到一半以下时，其余的源像素对结果没有贡献，
//! 细密的纹理（看台的座椅、织物、栅格）就混叠成摩尔纹。某一轴的绘制倍率低于 [`AREA_PREFILTER_BELOW`] 时，
//! 先把源画面在那一轴按面积平均缩到 `ceil(长度 × 倍率)`，再按原来的落点画上去：剩下的一步是接近 1:1 的双线性，
//! 画出来的范围不变。倍率不低于 0.5 的轴不动，两轴都不低于 0.5（含 1:1 与放大）时什么都不做，画面逐字节不变。
//!
//! 面积平均是精确的整数运算：两轴各自把坐标放大到公倍数上，源像素 `i` 占 `[i·n, (i+1)·n)`，输出像素 `j` 占
//! `[j·len, (j+1)·len)`，重叠长度是整数，每个输出像素的权重之和恰为源的边长。先纵后横：每个输出行先把盖住它的
//! 源行整行乘行权重累加到 `u32`（每个分量至多 `255 × 源高`），再在这行纵向和上按列权重累加到 `u64`，最后整体除
//! 一次、四舍五入。和是精确的整数，累加次序不改结果。纵向是连续内存上的同一个乘加，横向把每个输出的抽头数补零
//! 到同一个常数后展开，比逐像素先横后纵快约三倍。在预乘值上平均，四个分量同一份权重，预乘仍合法（分量不超过
//! alpha）；没有浮点，原生导出与预览 WASM 逐字节相同。

use std::collections::HashMap;
use std::sync::{Arc, Weak};

use tiny_skia::{Pixmap, PixmapRef, Transform};

/// 绘制倍率低于它的轴先按面积平均缩小。不低于它时双线性的 2×2 足够，照原样画。
pub const AREA_PREFILTER_BELOW: f64 = 0.5;

/// 一轴长 `len`、按 `scale` 画时预滤波到的长度；不需要预滤波时 `None`。
pub fn prefiltered_len(len: u32, scale: f64) -> Option<u32> {
    if !(scale.is_finite() && scale > 0.0 && scale < AREA_PREFILTER_BELOW) {
        return None;
    }
    // 倍率常来自 f32 的仿射：比整数多出的那一丝舍入误差不该让长度多进一位。
    let target = (f64::from(len) * scale * (1.0 - 1e-6)).ceil().max(1.0);
    // `scale < 0.5` 时 `target < len`（`len ≥ 2`）；`len` 是 1 时缩无可缩。
    (target < f64::from(len)).then_some(target as u32)
}

/// `width × height` 的源画面按两轴倍率画时预滤波到的尺寸；两轴都不需要时 `None`。
pub fn prefilter_size(width: u32, height: u32, scale_x: f64, scale_y: f64) -> Option<(u32, u32)> {
    let x = prefiltered_len(width, scale_x);
    let y = prefiltered_len(height, scale_y);
    if x.is_none() && y.is_none() {
        return None;
    }
    Some((x.unwrap_or(width), y.unwrap_or(height)))
}

/// 仿射下源画面两轴的绘制倍率：源的 x、y 单位向量画出来的长度（旋转、翻转不改它）。
///
/// 不用 `hypot`：它走平台的 libm，原生与 WASM 可能差一位；f32 的平方在 f64 里是精确的，`sqrt` 处处正确舍入。
pub fn axis_scales(transform: Transform) -> (f64, f64) {
    let length =
        |a: f32, b: f32| (f64::from(a) * f64::from(a) + f64::from(b) * f64::from(b)).sqrt();
    (
        length(transform.sx, transform.ky),
        length(transform.kx, transform.sy),
    )
}

/// 把预乘 RGBA 的 `source` 按面积平均缩到 `width × height`（两轴都不放大）。尺寸为 0 或比源大时 `None`；
/// 源高超过 `u32::MAX / 255`（纵向和放不进 u32）时也 `None`，调用方照原样画。
pub fn area_average(source: PixmapRef, width: u32, height: u32) -> Option<Pixmap> {
    let (source_width, source_height) = (source.width(), source.height());
    if width == 0 || height == 0 || width > source_width || height > source_height {
        return None;
    }
    // 一个输出行的行权重之和是源高，纵向和每个分量至多 `255 × 源高`。
    if 255 * u64::from(source_height) > u64::from(u32::MAX) {
        return None;
    }
    let mut out = Pixmap::new(width, height)?;
    let rows = Spans::new(source_height, height);
    let columns = Spans::new(source_width, width);
    let taps = columns.widest();
    let (starts, weights) = (&columns.starts, columns.padded(taps));
    let reduce = row_reducer(taps);
    let source_row_len = source_width as usize * 4;
    let data = source.data();
    // 权重之和是源的面积；横向和至多 `255 × 面积`，面积 × 4 是源的字节数，放得进 u64。
    let denominator = u64::from(source_width) * u64::from(source_height);
    // 末尾补 `taps` 个零像素：补齐的抽头权重为零，可能越过右边。
    let mut column_sums = vec![[0u32; 4]; source_width as usize + taps];
    for (y, out_row) in out
        .data_mut()
        .chunks_exact_mut(width as usize * 4)
        .enumerate()
    {
        let (first_row, row_weights) = rows.span(y);
        let source_rows = &data[first_row * source_row_len..];
        sum_rows(
            source_rows.chunks_exact(source_row_len),
            row_weights,
            &mut column_sums.as_flattened_mut()[..source_row_len],
        );
        reduce(&column_sums, starts, &weights, taps, denominator, out_row);
    }
    Some(out)
}

/// 纵向：盖住这个输出行的源行整行乘各自的行权重累加（连续内存，可向量化）。
fn sum_rows<'a>(rows: impl Iterator<Item = &'a [u8]>, weights: &[u32], sums: &mut [u32]) {
    for (index, (row, &weight)) in rows.zip(weights).enumerate() {
        if index == 0 {
            for (sum, &value) in sums.iter_mut().zip(row) {
                *sum = u32::from(value) * weight;
            }
        } else {
            for (sum, &value) in sums.iter_mut().zip(row) {
                *sum += u32::from(value) * weight;
            }
        }
    }
}

/// 横向：一行纵向和按列权重累加、除以面积、四舍五入成一行输出像素。参数依次是纵向和、每个输出的起点、补齐到
/// `taps` 个的列权重、`taps`、面积、输出行。
type ReduceRow = fn(&[[u32; 4]], &[usize], &[u32], usize, u64, &mut [u8]);

/// 抽头数常见时（缩小到十六分之一以内）用把它定死的版本，循环在编译期展开；更多时按运行时的抽头数。
fn row_reducer(taps: usize) -> ReduceRow {
    macro_rules! fixed {
        ($($taps:literal)*) => {
            match taps {
                $($taps => |sums, starts, weights, _, denominator, out| {
                    reduce_row(sums, starts, weights, $taps, denominator, out)
                },)*
                _ => reduce_row,
            }
        };
    }
    fixed!(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17)
}

#[inline(always)]
fn reduce_row(
    sums: &[[u32; 4]],
    starts: &[usize],
    weights: &[u32],
    taps: usize,
    denominator: u64,
    out: &mut [u8],
) {
    let half = denominator / 2;
    for ((pixel, &first), weights) in out
        .chunks_exact_mut(4)
        .zip(starts)
        .zip(weights.chunks_exact(taps))
    {
        let mut total = [0u64; 4];
        for (tap, &weight) in sums[first..first + taps].iter().zip(weights) {
            for (total, &value) in total.iter_mut().zip(tap) {
                *total += u64::from(value) * u64::from(weight);
            }
        }
        for (channel, total) in pixel.iter_mut().zip(total) {
            *channel = ((total + half) / denominator) as u8;
        }
    }
}

/// 一轴从 `len` 缩到 `n` 时每个输出像素盖住的源像素：起点与逐个的重叠长度（坐标放大 `n · len` 倍后的整数）。
struct Spans {
    starts: Vec<usize>,
    offsets: Vec<usize>,
    weights: Vec<u32>,
}

impl Spans {
    fn new(len: u32, n: u32) -> Self {
        let (len, n) = (u64::from(len), u64::from(n));
        let mut starts = Vec::with_capacity(n as usize);
        let mut offsets = Vec::with_capacity(n as usize + 1);
        let mut weights = Vec::with_capacity((len + n) as usize);
        offsets.push(0);
        for j in 0..n {
            let (begin, end) = (j * len, (j + 1) * len);
            let first = begin / n;
            let last = end.div_ceil(n);
            starts.push(first as usize);
            for i in first..last {
                let overlap = end.min((i + 1) * n) - begin.max(i * n);
                weights.push(overlap as u32);
            }
            offsets.push(weights.len());
        }
        Self {
            starts,
            offsets,
            weights,
        }
    }

    fn span(&self, index: usize) -> (usize, &[u32]) {
        (
            self.starts[index],
            &self.weights[self.offsets[index]..self.offsets[index + 1]],
        )
    }

    /// 最长的一段盖住几个源像素。
    fn widest(&self) -> usize {
        self.offsets
            .windows(2)
            .map(|pair| pair[1] - pair[0])
            .max()
            .unwrap_or(0)
    }

    /// 每段的权重补零到 `taps` 个，首尾相接。
    fn padded(&self, taps: usize) -> Vec<u32> {
        let mut padded = vec![0; self.starts.len() * taps];
        for (index, slot) in padded.chunks_exact_mut(taps).enumerate() {
            let (_, weights) = self.span(index);
            slot[..weights.len()].copy_from_slice(weights);
        }
        padded
    }
}

/// 源画面按 `transform` 画之前的预滤波：缩好的画面，与把它画到同一位置的仿射。两轴倍率都不低于
/// [`AREA_PREFILTER_BELOW`] 时 `None`，照原样画。
pub fn prefilter_for(source: PixmapRef, transform: Transform) -> Option<(Pixmap, Transform)> {
    let (scale_x, scale_y) = axis_scales(transform);
    let (width, height) = prefilter_size(source.width(), source.height(), scale_x, scale_y)?;
    let filtered = area_average(source, width, height)?;
    let transform = transform.pre_scale(
        (f64::from(source.width()) / f64::from(width)) as f32,
        (f64::from(source.height()) / f64::from(height)) as f32,
    );
    Some((filtered, transform))
}

/// 预滤波结果的缓存，按调用方给的键（源画面的 ID）各留一份。
///
/// 只认同一块源画面：条目记着源的 `Weak`，源还活着、指针相同、尺寸相同才复用。`Arc::make_mut` 改像素前会解除
/// `Weak` 的关联，所以内容变了的源一定认不出来；`Weak` 不挡 `Arc::try_unwrap`，宿主照样拿得回缓冲。导出的静态图
/// 每帧是同一个 `Arc`，只缩一次；视频每帧是新的 `Arc`，每帧重缩。
#[derive(Default)]
pub struct PrefilterCache {
    entries: HashMap<String, PrefilterEntry>,
}

struct PrefilterEntry {
    source: Weak<Pixmap>,
    filtered: Arc<Pixmap>,
}

impl PrefilterCache {
    /// 条目数的上限：超过时先丢掉源已不在的，仍超过就清空。
    const LIMIT: usize = 32;

    /// `source` 按面积平均缩到 `size` 的画面（见 [`area_average`]）。
    pub fn get(
        &mut self,
        key: &str,
        source: &Arc<Pixmap>,
        size: (u32, u32),
    ) -> Option<Arc<Pixmap>> {
        if let Some(entry) = self.entries.get(key)
            && (entry.filtered.width(), entry.filtered.height()) == size
            && entry
                .source
                .upgrade()
                .is_some_and(|alive| Arc::ptr_eq(&alive, source))
        {
            return Some(Arc::clone(&entry.filtered));
        }
        let filtered = Arc::new(area_average(source.as_ref().as_ref(), size.0, size.1)?);
        if self.entries.len() >= Self::LIMIT && !self.entries.contains_key(key) {
            self.entries
                .retain(|_, entry| entry.source.strong_count() > 0);
            if self.entries.len() >= Self::LIMIT {
                self.entries.clear();
            }
        }
        self.entries.insert(
            key.to_owned(),
            PrefilterEntry {
                source: Arc::downgrade(source),
                filtered: Arc::clone(&filtered),
            },
        );
        Some(filtered)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}
