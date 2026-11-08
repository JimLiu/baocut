//! 构建器用到的图像算子，逐个对应参考工具里的 OpenCV 调用（`fillPoly`、`dilate`/`erode`、`GaussianBlur`、
//! `blur`、`distanceTransform`、`connectedComponents`、`cvtColor(RGB2LAB)`、`kmeans`）。核大小、核的取值与
//! 边界规则照 OpenCV：高斯核宽 `round(σ·2·f+1)|1`（8 位输入 f=3，浮点输入 f=4），模糊的边界是 reflect-101，
//! 形态学运算忽略图外像素，连通域按 8 邻接。
//!
//! 已知的不同（都不到一个像素或只影响取样）：距离变换是精确欧氏距离，OpenCV 的 `DIST_L2, 5` 是 5×5 倒角近似；
//! 多边形边缘的栅格化可能差一个像素；k-means 的随机初始化不同，聚出的颜色中心会略有出入。

use std::path::Path;

use anyhow::{Context, Result};
use rayon::prelude::*;

/// 一张按行存放的单通道或多通道平面。
#[derive(Clone, Debug, PartialEq)]
pub struct Plane<T> {
    pub width: usize,
    pub height: usize,
    pub data: Vec<T>,
}

pub type Mask = Plane<bool>;
pub type Gray = Plane<f32>;
pub type Rgba = Plane<[u8; 4]>;

impl<T: Copy + Send + Sync> Plane<T> {
    pub fn filled(width: usize, height: usize, value: T) -> Self {
        Self {
            width,
            height,
            data: vec![value; width * height],
        }
    }
    #[inline]
    pub fn at(&self, x: usize, y: usize) -> T {
        self.data[y * self.width + x]
    }
    #[inline]
    pub fn put(&mut self, x: usize, y: usize, value: T) {
        self.data[y * self.width + x] = value;
    }
    pub fn map<U: Copy + Send + Sync>(&self, f: impl Fn(T) -> U + Sync) -> Plane<U> {
        Plane {
            width: self.width,
            height: self.height,
            data: self.data.par_iter().map(|&v| f(v)).collect(),
        }
    }
    pub fn zip<U: Copy + Send + Sync, V: Copy + Send + Sync>(&self, other: &Plane<U>, f: impl Fn(T, U) -> V + Sync) -> Plane<V> {
        assert_eq!((self.width, self.height), (other.width, other.height));
        Plane {
            width: self.width,
            height: self.height,
            data: self.data.par_iter().zip(other.data.par_iter()).map(|(&a, &b)| f(a, b)).collect(),
        }
    }
    /// `[x, y, w, h]` 这一块，原样复制。
    pub fn crop(&self, rect: [usize; 4]) -> Self {
        let [x0, y0, w, h] = rect;
        let mut data = Vec::with_capacity(w * h);
        for y in y0..y0 + h {
            data.extend_from_slice(&self.data[y * self.width + x0..y * self.width + x0 + w]);
        }
        Self { width: w, height: h, data }
    }
}

impl Mask {
    pub fn empty(width: usize, height: usize) -> Self {
        Self::filled(width, height, false)
    }
    pub fn any(&self) -> bool {
        self.data.iter().any(|&v| v)
    }
    pub fn count(&self) -> usize {
        self.data.iter().filter(|&&v| v).count()
    }
    pub fn and(&self, other: &Mask) -> Mask {
        self.zip(other, |a, b| a && b)
    }
    pub fn or(&self, other: &Mask) -> Mask {
        self.zip(other, |a, b| a || b)
    }
    pub fn and_not(&self, other: &Mask) -> Mask {
        self.zip(other, |a, b| a && !b)
    }
    pub fn not(&self) -> Mask {
        self.map(|v| !v)
    }
    pub fn or_assign(&mut self, other: &Mask) {
        for (a, &b) in self.data.iter_mut().zip(&other.data) {
            *a |= b;
        }
    }
    /// 真像素的外接框 `[x0, y0, x1, y1]`，右下不含。
    pub fn bbox(&self) -> Option<[usize; 4]> {
        let mut out: Option<[usize; 4]> = None;
        for y in 0..self.height {
            let row = &self.data[y * self.width..(y + 1) * self.width];
            let Some(first) = row.iter().position(|&v| v) else {
                continue;
            };
            let last = row.iter().rposition(|&v| v).unwrap();
            out = Some(match out {
                None => [first, y, last + 1, y + 1],
                Some([x0, y0, x1, _]) => [x0.min(first), y0, x1.max(last + 1), y + 1],
            });
        }
        out
    }
    pub fn to_u8(&self) -> Plane<u8> {
        self.map(|v| if v { 255 } else { 0 })
    }
    pub fn to_f32(&self) -> Gray {
        self.map(|v| if v { 1.0 } else { 0.0 })
    }
}

pub fn load_rgba(path: &Path) -> Result<Rgba> {
    let image = image::open(path)
        .with_context(|| format!("cannot read {}", path.display()))?
        .into_rgba8();
    Ok(from_image(image))
}

pub fn from_image(image: image::RgbaImage) -> Rgba {
    let (width, height) = image.dimensions();
    Plane {
        width: width as usize,
        height: height as usize,
        data: image.pixels().map(|p| p.0).collect(),
    }
}

pub fn to_image(plane: &Rgba) -> image::RgbaImage {
    image::RgbaImage::from_raw(
        plane.width as u32,
        plane.height as u32,
        plane.data.iter().flatten().copied().collect(),
    )
    .expect("plane size matches its data")
}

pub fn save_rgba(path: &Path, plane: &Rgba) -> Result<()> {
    to_image(plane)
        .save(path)
        .with_context(|| format!("cannot write {}", path.display()))
}

pub fn save_gray(path: &Path, plane: &Plane<u8>) -> Result<()> {
    image::GrayImage::from_raw(plane.width as u32, plane.height as u32, plane.data.clone())
        .expect("plane size matches its data")
        .save(path)
        .with_context(|| format!("cannot write {}", path.display()))
}

/// `cv2.fillPoly`：顶点先按 `np.int32` 截断，填充内部并画上边线。
pub fn polygon_mask(width: usize, height: usize, poly: &[[f64; 2]]) -> Mask {
    let mut mask = Mask::empty(width, height);
    let points: Vec<[i64; 2]> = poly.iter().map(|p| [p[0] as i64, p[1] as i64]).collect();
    let n = points.len();
    if n < 2 || width == 0 || height == 0 {
        return mask;
    }
    let ymin = points.iter().map(|p| p[1]).min().unwrap().max(0);
    let ymax = points.iter().map(|p| p[1]).max().unwrap().min(height as i64 - 1);
    let mut xs = Vec::new();
    for y in ymin..=ymax {
        xs.clear();
        for i in 0..n {
            let (a, b) = (points[i], points[(i + 1) % n]);
            if (a[1] <= y && y < b[1]) || (b[1] <= y && y < a[1]) {
                xs.push(a[0] as f64 + (y - a[1]) as f64 * (b[0] - a[0]) as f64 / (b[1] - a[1]) as f64);
            }
        }
        xs.sort_by(f64::total_cmp);
        for pair in xs.chunks_exact(2) {
            let x0 = pair[0].ceil().max(0.0) as i64;
            let x1 = (pair[1].floor() as i64).min(width as i64 - 1);
            for x in x0..=x1 {
                mask.put(x as usize, y as usize, true);
            }
        }
    }
    for i in 0..n {
        draw_line(&mut mask, points[i], points[(i + 1) % n]);
    }
    mask
}

fn draw_line(mask: &mut Mask, a: [i64; 2], b: [i64; 2]) {
    let (dx, dy) = ((b[0] - a[0]).abs(), -(b[1] - a[1]).abs());
    let (sx, sy) = ((b[0] - a[0]).signum(), (b[1] - a[1]).signum());
    let (mut x, mut y, mut err) = (a[0], a[1], dx + dy);
    loop {
        if x >= 0 && y >= 0 && (x as usize) < mask.width && (y as usize) < mask.height {
            mask.put(x as usize, y as usize, true);
        }
        if x == b[0] && y == b[1] {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
    }
}

/// 轴对齐椭圆 `((x-cx)/rx)² + ((y-cy)/ry)² ≤ 1`，像素坐标取整数点。
pub fn ellipse_mask(width: usize, height: usize, cx: f64, cy: f64, rx: f64, ry: f64) -> Mask {
    rotated_ellipse_mask(width, height, cx, cy, rx, ry, 0.0)
}

/// 旋转椭圆（`cv2.ellipse` 的实心填充）；`angle` 为弧度，图像坐标里顺时针为正。
pub fn rotated_ellipse_mask(width: usize, height: usize, cx: f64, cy: f64, rx: f64, ry: f64, angle: f64) -> Mask {
    let (sin, cos) = angle.sin_cos();
    let mut mask = Mask::empty(width, height);
    let reach = rx.max(ry).ceil() + 1.0;
    let y0 = (cy - reach).floor().max(0.0) as usize;
    let y1 = ((cy + reach).ceil().max(0.0) as usize).min(height.saturating_sub(1));
    let x0 = (cx - reach).floor().max(0.0) as usize;
    let x1 = ((cx + reach).ceil().max(0.0) as usize).min(width.saturating_sub(1));
    for y in y0..=y1 {
        for x in x0..=x1 {
            let (dx, dy) = (x as f64 - cx, y as f64 - cy);
            let u = (dx * cos + dy * sin) / rx;
            let v = (-dx * sin + dy * cos) / ry;
            if u * u + v * v <= 1.0 {
                mask.put(x, y, true);
            }
        }
    }
    mask
}

/// `cv2.polylines(..., False, 255, thickness)`：节点先 `np.rint`，每段画成圆头粗线。
pub fn stroke_polyline(mask: &mut Mask, nodes: &[[f64; 2]], thickness: f64) {
    let radius = thickness / 2.0;
    let points: Vec<[f64; 2]> = nodes.iter().map(|p| [p[0].round(), p[1].round()]).collect();
    for segment in points.windows(2) {
        let ([ax, ay], [bx, by]) = (segment[0], segment[1]);
        let x0 = (ax.min(bx) - radius).floor().max(0.0) as usize;
        let x1 = ((ax.max(bx) + radius).ceil().max(0.0) as usize).min(mask.width - 1);
        let y0 = (ay.min(by) - radius).floor().max(0.0) as usize;
        let y1 = ((ay.max(by) + radius).ceil().max(0.0) as usize).min(mask.height - 1);
        let (ex, ey) = (bx - ax, by - ay);
        let length2 = (ex * ex + ey * ey).max(1e-12);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let (px, py) = (x as f64 - ax, y as f64 - ay);
                let t = ((px * ex + py * ey) / length2).clamp(0.0, 1.0);
                let (qx, qy) = (px - t * ex, py - t * ey);
                if qx * qx + qy * qy <= radius * radius {
                    mask.put(x, y, true);
                }
            }
        }
    }
}

/// 方形核的膨胀（`cv2.dilate(m, np.ones((k, k)))`）。
pub fn dilate(mask: &Mask, k: usize) -> Mask {
    morph(mask, k, true)
}

/// 方形核的腐蚀（`cv2.erode`）；图外像素不参与。
pub fn erode(mask: &Mask, k: usize) -> Mask {
    morph(mask, k, false)
}

/// 闭运算（`cv2.morphologyEx(MORPH_CLOSE)`）。
pub fn close(mask: &Mask, k: usize) -> Mask {
    erode(&dilate(mask, k), k)
}

fn morph(mask: &Mask, k: usize, grow: bool) -> Mask {
    let (before, after) = (k / 2, k - 1 - k / 2);
    let pass = |src: &[bool], len: usize, out: &mut [bool]| {
        let mut prefix = vec![0usize; len + 1];
        for i in 0..len {
            prefix[i + 1] = prefix[i] + src[i] as usize;
        }
        for (i, value) in out.iter_mut().enumerate().take(len) {
            let lo = i.saturating_sub(before);
            let hi = (i + after).min(len - 1);
            let set = prefix[hi + 1] - prefix[lo];
            *value = if grow { set > 0 } else { set == hi + 1 - lo };
        }
    };
    let (w, h) = (mask.width, mask.height);
    let mut rows = Mask::empty(w, h);
    rows.data
        .par_chunks_mut(w)
        .zip(mask.data.par_chunks(w))
        .for_each(|(out, src)| pass(src, w, out));
    let columns: Vec<Vec<bool>> = (0..w)
        .into_par_iter()
        .map(|x| {
            let src: Vec<bool> = (0..h).map(|y| rows.data[y * w + x]).collect();
            let mut out = vec![false; h];
            pass(&src, h, &mut out);
            out
        })
        .collect();
    let mut result = Mask::empty(w, h);
    for (x, column) in columns.iter().enumerate() {
        for (y, &v) in column.iter().enumerate() {
            result.data[y * w + x] = v;
        }
    }
    result
}

/// `GaussianBlur(src, (0, 0), sigma)` 的核宽；`depth_u8` 为 8 位输入。
pub fn gaussian_ksize(sigma: f64, depth_u8: bool) -> usize {
    let factor = if depth_u8 { 3.0 } else { 4.0 };
    ((sigma * factor * 2.0 + 1.0).round() as usize) | 1
}

/// `cv2.getGaussianKernel`：小核且 sigma ≤ 0 时用 OpenCV 的固定表。
pub fn gaussian_kernel(ksize: usize, sigma: f64) -> Vec<f32> {
    if sigma <= 0.0 {
        match ksize {
            1 => return vec![1.0],
            3 => return vec![0.25, 0.5, 0.25],
            5 => return vec![0.0625, 0.25, 0.375, 0.25, 0.0625],
            7 => {
                return vec![0.03125, 0.109375, 0.21875, 0.28125, 0.21875, 0.109375, 0.03125];
            }
            _ => {}
        }
    }
    let s = if sigma > 0.0 {
        sigma
    } else {
        ((ksize as f64 - 1.0) * 0.5 - 1.0) * 0.3 + 0.8
    };
    let centre = (ksize as f64 - 1.0) / 2.0;
    let weights: Vec<f64> = (0..ksize).map(|i| (-(i as f64 - centre).powi(2) / (2.0 * s * s)).exp()).collect();
    let sum: f64 = weights.iter().sum();
    weights.iter().map(|w| (w / sum) as f32).collect()
}

#[inline]
fn reflect101(i: isize, n: usize) -> usize {
    if n == 1 {
        return 0;
    }
    let n = n as isize;
    let mut i = i;
    loop {
        if i < 0 {
            i = -i;
        } else if i >= n {
            i = 2 * n - 2 - i;
        } else {
            return i as usize;
        }
    }
}

/// 可分离卷积，边界 reflect-101。
pub fn convolve(src: &Gray, kernel: &[f32]) -> Gray {
    let (w, h) = (src.width, src.height);
    let r = kernel.len() / 2;
    let mut rows = Gray::filled(w, h, 0.0);
    rows.data.par_chunks_mut(w).zip(src.data.par_chunks(w)).for_each(|(out, row)| {
        let padded: Vec<f32> = (0..w + 2 * r).map(|i| row[reflect101(i as isize - r as isize, w)]).collect();
        for (x, value) in out.iter_mut().enumerate() {
            let window = &padded[x..x + kernel.len()];
            *value = window.iter().zip(kernel).map(|(a, b)| a * b).sum();
        }
    });
    let mut out = Gray::filled(w, h, 0.0);
    out.data.par_chunks_mut(w).enumerate().for_each(|(y, acc)| {
        for (j, &k) in kernel.iter().enumerate() {
            let source = reflect101(y as isize + j as isize - r as isize, h);
            let row = &rows.data[source * w..(source + 1) * w];
            for (a, &b) in acc.iter_mut().zip(row) {
                *a += k * b;
            }
        }
    });
    out
}

/// `GaussianBlur(src, (0, 0), sigma)`；`depth_u8` 时按 8 位的核宽并把结果四舍五入到 0–255。
pub fn gaussian_blur(src: &Gray, sigma: f64, depth_u8: bool) -> Gray {
    let kernel = gaussian_kernel(gaussian_ksize(sigma, depth_u8), sigma);
    let out = convolve(src, &kernel);
    if depth_u8 { out.map(|v| v.round().clamp(0.0, 255.0)) } else { out }
}

/// 每个真像素到最近假像素的欧氏距离，假像素为 0（`cv2.distanceTransform` 的含义）。
pub fn distance_to_false(mask: &Mask) -> Gray {
    const FAR: f64 = 1e20;
    let (w, h) = (mask.width, mask.height);
    let mut grid: Vec<f64> = mask.data.iter().map(|&v| if v { FAR } else { 0.0 }).collect();
    let columns: Vec<Vec<f64>> = (0..w)
        .into_par_iter()
        .map(|x| {
            let column: Vec<f64> = (0..h).map(|y| grid[y * w + x]).collect();
            edt_1d(&column)
        })
        .collect();
    for (x, column) in columns.iter().enumerate() {
        for (y, &v) in column.iter().enumerate() {
            grid[y * w + x] = v;
        }
    }
    let data: Vec<f32> = grid
        .par_chunks(w)
        .flat_map_iter(|row| edt_1d(row).into_iter().map(|v| v.sqrt() as f32))
        .collect();
    Gray { width: w, height: h, data }
}

/// Felzenszwalb–Huttenlocher 的一维平方距离变换。
fn edt_1d(f: &[f64]) -> Vec<f64> {
    let n = f.len();
    let mut d = vec![0.0; n];
    let mut v = vec![0usize; n];
    let mut z = vec![0.0f64; n + 1];
    let mut k = 0usize;
    z[0] = f64::NEG_INFINITY;
    z[1] = f64::INFINITY;
    for q in 1..n {
        loop {
            let p = v[k];
            let s = ((f[q] + (q * q) as f64) - (f[p] + (p * p) as f64)) / (2.0 * (q as f64 - p as f64));
            if s <= z[k] && k > 0 {
                k -= 1;
                continue;
            }
            if s <= z[k] {
                // k == 0 且抛物线完全压过：替换第一条。
                v[0] = q;
                z[0] = f64::NEG_INFINITY;
                z[1] = f64::INFINITY;
                break;
            }
            k += 1;
            v[k] = q;
            z[k] = s;
            z[k + 1] = f64::INFINITY;
            break;
        }
    }
    k = 0;
    for (q, value) in d.iter_mut().enumerate() {
        while z[k + 1] < q as f64 {
            k += 1;
        }
        let p = v[k];
        *value = (q as f64 - p as f64).powi(2) + f[p];
    }
    d
}

/// 一个连通域的外接框（右下不含）、面积与 x 坐标之和。
#[derive(Clone, Copy, Debug, Default)]
pub struct Component {
    pub x0: usize,
    pub y0: usize,
    pub x1: usize,
    pub y1: usize,
    pub area: usize,
    pub sum_x: f64,
}

/// 8 邻接的连通域；标签 0 是假像素，`components[i - 1]` 是标签 i。
pub fn connected_components(mask: &Mask) -> (Plane<u32>, Vec<Component>) {
    let (w, h) = (mask.width, mask.height);
    let mut labels = Plane::filled(w, h, 0u32);
    let mut components = Vec::new();
    let mut stack = Vec::new();
    for start in 0..w * h {
        if !mask.data[start] || labels.data[start] != 0 {
            continue;
        }
        let label = components.len() as u32 + 1;
        let mut c = Component {
            x0: usize::MAX,
            y0: usize::MAX,
            ..Default::default()
        };
        labels.data[start] = label;
        stack.push(start);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            c.x0 = c.x0.min(x);
            c.y0 = c.y0.min(y);
            c.x1 = c.x1.max(x + 1);
            c.y1 = c.y1.max(y + 1);
            c.area += 1;
            c.sum_x += x as f64;
            for ny in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for nx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    let j = ny * w + nx;
                    if mask.data[j] && labels.data[j] == 0 {
                        labels.data[j] = label;
                        stack.push(j);
                    }
                }
            }
        }
        components.push(c);
    }
    (labels, components)
}

/// `cv2.cvtColor(RGB2LAB)` 的 8 位结果：sRGB 线性化、D65，L·255/100、a+128、b+128，四舍五入。
pub fn rgb_to_lab(rgb: [u8; 3]) -> [f32; 3] {
    let linear = |c: u8| {
        let c = c as f64 / 255.0;
        if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    };
    let (r, g, b) = (linear(rgb[0]), linear(rgb[1]), linear(rgb[2]));
    let x = (0.412453 * r + 0.357580 * g + 0.180423 * b) / 0.950456;
    let y = 0.212671 * r + 0.715160 * g + 0.072169 * b;
    let z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / 1.088754;
    let f = |t: f64| {
        if t > 0.008856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 }
    };
    let l = if y > 0.008856 { 116.0 * y.cbrt() - 16.0 } else { 903.3 * y };
    let a = 500.0 * (f(x) - f(y)) + 128.0;
    let bb = 200.0 * (f(y) - f(z)) + 128.0;
    let q = |v: f64| v.round().clamp(0.0, 255.0) as f32;
    [q(l * 255.0 / 100.0), q(a), q(bb)]
}

/// numpy 默认（线性插值）的百分位数。
pub fn percentile(values: &[f32], q: f64) -> f32 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f32::total_cmp);
    percentile_sorted(&sorted, q)
}

pub fn percentile_sorted(sorted: &[f32], q: f64) -> f32 {
    if sorted.is_empty() {
        return f32::NAN;
    }
    let position = q / 100.0 * (sorted.len() - 1) as f64;
    let lo = position.floor() as usize;
    let hi = position.ceil() as usize;
    let frac = (position - lo as f64) as f32;
    sorted[lo] + (sorted[hi] - sorted[lo]) * frac
}

pub fn median(values: &[f32]) -> f32 {
    percentile(values, 50.0)
}

/// 每个通道分别取中位数（`np.median(pixels, axis=0)`）。
pub fn median3(pixels: &[[f32; 3]]) -> [f32; 3] {
    let channel = |c: usize| median(&pixels.iter().map(|p| p[c]).collect::<Vec<_>>());
    [channel(0), channel(1), channel(2)]
}

pub fn luminance(rgb: [f32; 3]) -> f32 {
    rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11
}

/// 固定种子的 SplitMix64，k-means 初始化用。
struct SplitMix(u64);
impl SplitMix {
    fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn dist2(a: [f32; 3], b: [f32; 3]) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}

/// k-means++ 初始化加 Lloyd 迭代（`cv2.kmeans(..., KMEANS_PP_CENTERS)` 的同一做法，种子固定）。
pub fn kmeans(values: &[[f32; 3]], k: usize, max_iter: usize, epsilon: f32) -> Vec<[f32; 3]> {
    let k = k.min(values.len());
    if k == 0 {
        return Vec::new();
    }
    let mut rng = SplitMix(0);
    let mut centres = vec![values[(rng.next_f64() * values.len() as f64) as usize % values.len()]];
    let mut nearest: Vec<f32> = values.iter().map(|&v| dist2(v, centres[0])).collect();
    while centres.len() < k {
        let total: f64 = nearest.iter().map(|&d| d as f64).sum();
        let pick = if total <= 0.0 {
            (rng.next_f64() * values.len() as f64) as usize % values.len()
        } else {
            let mut target = rng.next_f64() * total;
            let mut index = values.len() - 1;
            for (i, &d) in nearest.iter().enumerate() {
                target -= d as f64;
                if target <= 0.0 {
                    index = i;
                    break;
                }
            }
            index
        };
        centres.push(values[pick]);
        for (n, &v) in nearest.iter_mut().zip(values) {
            *n = n.min(dist2(v, values[pick]));
        }
    }
    let mut assignment = vec![0usize; values.len()];
    for _ in 0..max_iter.max(2) {
        assignment.par_iter_mut().zip(values.par_iter()).for_each(|(a, &v)| {
            *a = (0..k)
                .min_by(|&i, &j| dist2(v, centres[i]).total_cmp(&dist2(v, centres[j])))
                .unwrap();
        });
        let mut sums = vec![[0f64; 4]; k];
        for (&a, v) in assignment.iter().zip(values) {
            for c in 0..3 {
                sums[a][c] += v[c] as f64;
            }
            sums[a][3] += 1.0;
        }
        let mut shift = 0f32;
        for i in 0..k {
            let next = if sums[i][3] > 0.0 {
                [
                    (sums[i][0] / sums[i][3]) as f32,
                    (sums[i][1] / sums[i][3]) as f32,
                    (sums[i][2] / sums[i][3]) as f32,
                ]
            } else {
                // 空簇：换成离自己中心最远的点。
                *values
                    .iter()
                    .zip(&assignment)
                    .max_by(|(a, i), (b, j)| dist2(**a, centres[**i]).total_cmp(&dist2(**b, centres[**j])))
                    .unwrap()
                    .0
            };
            shift = shift.max(dist2(next, centres[i]).sqrt());
            centres[i] = next;
        }
        if shift <= epsilon {
            break;
        }
    }
    centres
}

/// 从洞外逐圈向里填：每圈的像素取已知 8 邻域四个通道的平均。参考工具这里用 OpenCV 的 Telea 修补；
/// 没有手与挂件时洞只有眼睛，`fill_skin` 随后重画洞里的颜色，修补值只留在洞边一两个像素的过渡里。
pub fn fill_hole_from_edges(image: &Rgba, hole: &Mask) -> Rgba {
    let (w, h) = (image.width, image.height);
    let mut out = image.clone();
    let mut known = hole.not();
    let neighbours = |i: usize| {
        let (x, y) = (i % w, i / w);
        (y.saturating_sub(1)..=(y + 1).min(h - 1)).flat_map(move |ny| (x.saturating_sub(1)..=(x + 1).min(w - 1)).map(move |nx| ny * w + nx))
    };
    let mut frontier: Vec<usize> = (0..w * h)
        .filter(|&i| hole.data[i] && neighbours(i).any(|j| known.data[j]))
        .collect();
    while !frontier.is_empty() {
        let values: Vec<[u8; 4]> = frontier
            .iter()
            .map(|&i| {
                let mut sum = [0f32; 4];
                let mut count = 0f32;
                for j in neighbours(i).filter(|&j| known.data[j]) {
                    for (total, &v) in sum.iter_mut().zip(&out.data[j]) {
                        *total += v as f32;
                    }
                    count += 1.0;
                }
                sum.map(|s| (s / count).round() as u8)
            })
            .collect();
        for (&i, value) in frontier.iter().zip(values) {
            out.data[i] = value;
            known.data[i] = true;
        }
        let mut next: Vec<usize> = frontier
            .iter()
            .flat_map(|&i| neighbours(i))
            .filter(|&j| hole.data[j] && !known.data[j])
            .collect();
        next.sort_unstable();
        next.dedup();
        frontier = next;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polygon_fills_interior_and_edges() {
        let m = polygon_mask(10, 10, &[[2.0, 2.0], [7.0, 2.0], [7.0, 6.0], [2.0, 6.0]]);
        assert_eq!(m.count(), 6 * 5);
        assert_eq!(m.bbox(), Some([2, 2, 8, 7]));
    }

    #[test]
    fn dilate_and_erode_are_square_and_clip_to_the_image() {
        let mut m = Mask::empty(9, 9);
        m.put(4, 4, true);
        let d = dilate(&m, 3);
        assert_eq!(d.count(), 9);
        assert_eq!(erode(&d, 3).count(), 1);
        let full = Mask::filled(4, 4, true);
        assert_eq!(erode(&full, 3).count(), 16);
    }

    #[test]
    fn gaussian_kernel_follows_opencv_sizes() {
        assert_eq!(gaussian_ksize(1.0, false), 9);
        assert_eq!(gaussian_ksize(9.0, true), 55);
        assert_eq!(gaussian_kernel(3, 0.0), vec![0.25, 0.5, 0.25]);
        let k = gaussian_kernel(9, 1.0);
        assert!((k.iter().sum::<f32>() - 1.0).abs() < 1e-6);
        let flat = Gray::filled(5, 4, 3.0);
        let blurred = convolve(&flat, &k);
        assert!(blurred.data.iter().all(|v| (v - 3.0).abs() < 1e-5));
    }

    #[test]
    fn distance_transform_is_euclidean() {
        let mut m = Mask::filled(7, 7, true);
        m.put(0, 0, false);
        let d = distance_to_false(&m);
        assert_eq!(d.at(0, 0), 0.0);
        assert!((d.at(3, 4) - 5.0).abs() < 1e-5);
    }

    #[test]
    fn components_use_eight_neighbours() {
        let mut m = Mask::empty(4, 4);
        m.put(0, 0, true);
        m.put(1, 1, true);
        m.put(3, 3, true);
        let (_, components) = connected_components(&m);
        assert_eq!(components.len(), 2);
        assert_eq!(components[0].area, 2);
    }

    #[test]
    fn lab_matches_opencv_for_reference_colours() {
        // cv2.cvtColor(np.uint8([[[255,255,255],[0,0,0],[255,0,0],[130,72,56]]]), cv2.COLOR_RGB2LAB)
        assert_eq!(rgb_to_lab([255, 255, 255]), [255.0, 128.0, 128.0]);
        assert_eq!(rgb_to_lab([0, 0, 0]), [0.0, 128.0, 128.0]);
        assert_eq!(rgb_to_lab([255, 0, 0]), [136.0, 208.0, 195.0]);
        assert_eq!(rgb_to_lab([130, 72, 56]), [95.0, 151.0, 148.0]);
    }

    #[test]
    fn kmeans_separates_two_clusters() {
        let mut values = vec![[0.0f32, 0.0, 0.0]; 50];
        values.extend(vec![[100.0f32, 100.0, 100.0]; 50]);
        let mut centres = kmeans(&values, 2, 40, 0.1);
        centres.sort_by(|a, b| a[0].total_cmp(&b[0]));
        assert_eq!(centres, vec![[0.0, 0.0, 0.0], [100.0, 100.0, 100.0]]);
    }

    #[test]
    fn hole_fill_copies_the_border_inwards() {
        let mut image = Rgba::filled(5, 5, [10, 20, 30, 255]);
        image.put(2, 2, [0, 0, 0, 0]);
        let mut hole = Mask::empty(5, 5);
        hole.put(2, 2, true);
        assert_eq!(fill_hole_from_edges(&image, &hole).at(2, 2), [10, 20, 30, 255]);
    }
}
