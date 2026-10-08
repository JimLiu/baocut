//! 白板手绘元素的分析与逐帧内核（`docs/design/video/bcut-whiteboard-animation-design.md` §4）。
//!
//! 一张静态图 → 「谁先画、谁后画」的时间场 → 任意 `t` 的揭示帧。两件事分开：
//!
//! * [`analyze`]——**一次性**分析：像素分类（纸 / 墨线 / 色块）→ 膨胀 → 连通域
//!   （`strict` 时再按 `box` 逐像素切开）→ 排序（`beats` 分组 → 阅读带 → 质心 x）
//!   → 每组一段组窗 `[at, end]`（`natural` 时按自然速度画完后定格到 `end`）→ 组内按
//!   √面积分配 → 域内测地 BFS 时间场。结果 [`WhiteboardAnalysis`] 由 host 按
//!   `(源 id, props)` 记忆化（旁白同步设计稿 §6）。
//! * [`whiteboard_frame`]——**逐帧**：`field ≤ t` 的像素取源图，其余透明（或纸色），
//!   `t < 1` 时在笔锋位置画一支矢量笔。每帧只是一次掩码比较 + 一次 blit。
//!
//! 与本目录其余源同一条纪律：**无状态、无随机数、不依赖上一帧**——同一 `t` 在
//! App 预览 / 导出 / `bcut render --t` 三处逐字节一致，乱序采样 == 顺序采样。
//!
//! 本模块只依赖 tiny-skia，属于 `wasm-safe` 最小集。`WhiteboardProps`
//! （`bcut-timeline`）→ [`WhiteboardParams`] 的换算（秒 → 归一化）住在
//! `bcut-timeline-render`，本 crate 不认识 Timeline 的类型。

use std::collections::VecDeque;

use tiny_skia::{Color, LineCap, Paint, PathBuilder, Pixmap, Stroke, Transform};

/// 分析用的工作分辨率上限（长边像素）。更大的源图先按最近邻聚合到这个尺度再分析，
/// 时间场按整数比例映射回自然分辨率。960 是原型验证过的尺度：4K 源图的 BFS 也在
/// 百毫秒量级。
pub const WORK_LONG_EDGE: u32 = 960;
/// 笔画周围多宽的纸像素算作它的晕圈（自然像素）：出图 PNG 的抗锯齿 / 压缩振铃约 5 px。
pub const HALO_RADIUS_PX: u32 = 6;

/// 墨线膨胀半径（工作分辨率像素）：把断笔、锯齿边连成一笔。
const DILATE_RADIUS: i32 = 3;

/// 面积小于此值（工作分辨率像素）的连通域并入最近的域，噪点不单独成笔。
const MIN_COMPONENT_AREA: usize = 12;

/// `inkFirst` 时墨线占时间窗的比例；色块占余下部分。
pub const INK_SHARE: f64 = 0.7;

/// 阅读带数：先按 `ymin` 落在第几个 `H / READING_BANDS` 带，再按 x 排。
const READING_BANDS: usize = 8;

/// 时间场的量化档数。`0` 恒为「一开始就可见」（纸像素），`1..=FIELD_MAX` 是
/// 墨线 / 色块的揭示时刻；`t` 归一化后乘上它取整比较。
const FIELD_MAX: u32 = 65_534;

/// 笔锋窗口：`field ∈ (t − HAND_WINDOW, t]` 的像素质心是手的位置。
const HAND_WINDOW: f64 = 0.02;

/// 笔的样式（`hand` 属性）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WhiteboardHand {
    /// 粗头马克笔（缺省）。
    #[default]
    Marker,
    /// 细杆钢笔。
    Pen,
    /// 不画笔。
    None,
}

/// 语义顺序提示（`beats[]`）。`at` / `end` 已归一化到 `[0, 1]`（相对 `draw`）；
/// `end` 缺席 = 下一拍的 `at`（末拍 = 1）；`rect` 是画面百分比矩形 `[x, y, w, h]`。
#[derive(Debug, Clone, PartialEq)]
pub struct WhiteboardBeat {
    pub at: f64,
    pub end: Option<f64>,
    pub rect: [f64; 4],
}

impl WhiteboardBeat {
    /// 只有起点的节拍（0.8 的形状）。
    pub fn at(at: f64, rect: [f64; 4]) -> Self {
        Self {
            at,
            end: None,
            rect,
        }
    }
}

/// 每拍的节奏（`pace`，旁白同步设计稿 §5）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WhiteboardPace {
    /// 组窗撑满：这拍的笔画拉伸到整个 `[at, end]`（0.8 的行为）。
    #[default]
    Stretch,
    /// 按自然速度（`path / 900 px/s + 0.25 s/域`，不夹）画完后定格到 `end`；
    /// 自然时长超过组窗时压缩到组窗并记 `compressed`。
    Natural,
}

impl WhiteboardPace {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stretch => "stretch",
            Self::Natural => "natural",
        }
    }
}

/// 分析参数。样式（笔、纸色）不在这里——它们不影响时间场，只影响帧。
#[derive(Debug, Clone, PartialEq)]
pub struct WhiteboardParams {
    /// 先墨线后色块（缺省 `true`）；`false` 时两类混排，只按位置排序。
    pub ink_first: bool,
    /// 语义顺序提示；空 = 纯几何顺序。
    pub beats: Vec<WhiteboardBeat>,
    /// 每拍撑满组窗还是画完定格。
    pub pace: WhiteboardPace,
    /// `box` 是硬遮罩：逐像素按矩形标 owner（后拍覆盖），跨 box 的连通域按像素切开，
    /// 膨胀不跨 owner，不在任何 box 里的前景排到末拍之后（`[end_末, 1]`）。
    pub strict: bool,
    /// 生效画时（秒）：`natural` 把自然秒换算到归一化时间轴用；`0` = 未知（按 stretch）。
    pub draw_seconds: f64,
}

impl WhiteboardParams {
    /// 几何基线的副本：去掉 `beats`、回到 `stretch`。`draw` 缺席时先用它拿自然时长
    /// 与 `boxes`，再按最终 `draw` 归一化 `beats` 做第二次分析。
    pub fn beats_cleared(mut self) -> Self {
        self.beats.clear();
        self.pace = WhiteboardPace::Stretch;
        self.strict = false;
        self.draw_seconds = 0.0;
        self
    }

    /// 只影响几何基线以外的分析：有 beats、或 `natural`。
    pub fn needs_second_pass(&self) -> bool {
        !self.beats.is_empty() || self.pace == WhiteboardPace::Natural
    }
}

impl Default for WhiteboardParams {
    fn default() -> Self {
        Self {
            ink_first: true,
            beats: Vec::new(),
            pace: WhiteboardPace::Stretch,
            strict: false,
            draw_seconds: 0.0,
        }
    }
}

/// 一拍（组）的时间账（归一化到 `draw`）。
#[derive(Debug, Clone, PartialEq)]
pub struct WhiteboardGroup {
    /// 组窗 `[at, end]`。
    pub window: [f64; 2],
    /// 这拍墨线画完的时刻：`stretch` = `end`；`natural` = `at + 自然时长`（不超过 `end`）。
    pub draw_end: f64,
    /// 这拍成员的自然时长（秒，不夹）。
    pub natural_seconds: f64,
    /// `natural` 下自然时长超过组窗，被压缩到组窗（`whiteboard-window-too-short`）。
    pub compressed: bool,
    /// 没有任何连通域落进这拍（`whiteboard-empty-box`）。
    pub empty: bool,
}

/// 一个连通域的外接框（阅读序，`bcut whiteboard probe` 的 `boxes[]`）。
#[derive(Debug, Clone, PartialEq)]
pub struct WhiteboardBox {
    /// 画面百分比 `[x, y, w, h]`。
    pub rect: [f64; 4],
    /// 真实前景像素数（工作分辨率）。
    pub area: usize,
    /// 墨线（`true`）还是色块。
    pub ink: bool,
    /// 单独画这一域的自然时长（秒）。
    pub natural_seconds: f64,
}

/// 像素类别（工作分辨率与自然分辨率共用）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum Class {
    Paper = 0,
    Ink = 1,
    Color = 2,
}

/// 一张源图的分析结果：自然分辨率的量化时间场 + 统计。
#[derive(Debug, Clone, PartialEq)]
pub struct WhiteboardAnalysis {
    width: u32,
    height: u32,
    /// 每个自然像素的揭示时刻（`0` = 一开始可见；`1..=FIELD_MAX` 归一化到 `draw`）。
    field: Vec<u16>,
    /// 工作分辨率的墨线 / 色块像素数与连通域数（探测输出与自然时长推算用）。
    pub ink_pixels: usize,
    pub color_pixels: usize,
    pub components: usize,
    /// 工作分辨率面积（`ink_pixels / work_area` 即墨线占比）。
    pub work_area: usize,
    /// 全部连通域测地 BFS 最长路径之和（工作像素）——「笔要走多远」。
    pub path_length: usize,
    /// 每拍的时间账（无 beats 时恰一组 `[0, 1]`）。
    pub groups: Vec<WhiteboardGroup>,
    /// `strict` 下不在任何 `box` 里的前景像素数（工作分辨率）；非 strict 恒 0。
    pub unassigned_foreground: usize,
    /// 连通域外接框，阅读序（与 beats 无关）。
    pub boxes: Vec<WhiteboardBox>,
    /// hold 段（没有新笔落下）手停在末笔上：`natural` 为 `true`；`stretch` 保持 0.8 的帧。
    pub hold_hand: bool,
    /// 源图自带的不透明纸面代表色（预乘 RGBA，取全部不透明纸面像素的均值）；透明底为
    /// `None`。没给 `paper` 时，还没画到的不透明笔画像素先铺这个色，而不是挖成透明洞
    /// 让项目背景（常见是黑画面）透出来冒充墨线。
    pub paper_fill: Option<[u8; 4]>,
}

impl WhiteboardAnalysis {
    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    /// 墨线占比（工作分辨率）。
    pub fn ink_ratio(&self) -> f64 {
        if self.work_area == 0 {
            0.0
        } else {
            (self.ink_pixels + self.color_pixels) as f64 / self.work_area as f64
        }
    }

    /// 推算的自然作画时长（秒）：笔以约 900 工作像素/秒的速度走完全部测地路径，
    /// 每个域再加 0.25 s 的提笔换位；夹在 `[1, 15]` 秒。只是缺省值的来源，
    /// 作者随时用 `draw` 覆盖。
    pub fn natural_draw_seconds(&self) -> f64 {
        natural_seconds(self.path_length, self.components).clamp(1.0, 15.0)
    }

    /// 不夹的自然时长（秒）：`groups[].natural_seconds` 之和。
    pub fn natural_seconds_unclamped(&self) -> f64 {
        natural_seconds(self.path_length, self.components)
    }

    /// 归一化时刻 `t` 下已揭示的像素数（测试与探测用）。
    pub fn revealed_count(&self, t: f64) -> usize {
        let threshold = quantize(t);
        self.field
            .iter()
            .filter(|&&q| u32::from(q) <= threshold)
            .count()
    }

    /// 自然像素 `(x, y)` 的揭示时刻（归一化；纸像素为 `0`）。
    pub fn reveal_at(&self, x: u32, y: u32) -> f64 {
        let q = self.field[(y * self.width + x) as usize];
        f64::from(q) / f64::from(FIELD_MAX)
    }
}

/// 笔速模型：约 900 工作像素/秒，每个域再加 0.25 s 提笔换位。
fn natural_seconds(path_length: usize, components: usize) -> f64 {
    path_length as f64 / 900.0 + components as f64 * 0.25
}

fn quantize(t: f64) -> u32 {
    if t >= 1.0 {
        FIELD_MAX
    } else if t <= 0.0 {
        0
    } else {
        (t * f64::from(FIELD_MAX)).floor() as u32
    }
}

/// premultiplied RGBA → 类别。
fn classify(px: &[u8]) -> Class {
    let a = px[3];
    if a < 8 {
        return Class::Paper;
    }
    // 反预乘后再取亮度 / 饱和度，半透明边缘不会因为预乘变暗被误判成墨线。
    let un = |c: u8| -> u32 { (u32::from(c) * 255 + u32::from(a) / 2) / u32::from(a) };
    let (r, g, b) = (un(px[0]).min(255), un(px[1]).min(255), un(px[2]).min(255));
    let lum = (r * 299 + g * 587 + b * 114) / 1000;
    let sat = r.max(g).max(b) - r.min(g).min(b);
    if lum > 235 && sat < 40 {
        Class::Paper
    } else if sat > 60 && lum < 235 {
        Class::Color
    } else {
        Class::Ink
    }
}

/// 一个连通域（工作分辨率）。
struct Component {
    class: Class,
    /// 域内真实（未膨胀）像素的工作坐标索引。
    pixels: Vec<u32>,
    /// 膨胀掩码上属于本域的全部像素索引（测地 BFS 的行走面）。
    footprint: Vec<u32>,
    xmin: u32,
    xmax: u32,
    ymin: u32,
    ymax: u32,
    cx: f64,
    cy: f64,
    /// `strict` 下的归属拍；`None` = 不在任何 box 里（非 strict 不用）。
    owner: Option<usize>,
}

impl Component {
    fn new(
        class: Class,
        pixels: Vec<u32>,
        footprint: Vec<u32>,
        w: u32,
        owner: Option<usize>,
    ) -> Self {
        let (mut xmin, mut xmax, mut ymin, mut ymax) = (u32::MAX, 0, u32::MAX, 0);
        let (mut sx, mut sy) = (0f64, 0f64);
        for &p in &pixels {
            let (x, y) = (p % w, p / w);
            xmin = xmin.min(x);
            xmax = xmax.max(x);
            ymin = ymin.min(y);
            ymax = ymax.max(y);
            sx += f64::from(x);
            sy += f64::from(y);
        }
        let n = pixels.len().max(1) as f64;
        Self {
            class,
            pixels,
            footprint,
            xmin,
            xmax,
            ymin,
            ymax,
            cx: sx / n,
            cy: sy / n,
            owner,
        }
    }
}

fn rect_contains(rect: [f64; 4], px: f64, py: f64) -> bool {
    px >= rect[0] && px <= rect[0] + rect[2] && py >= rect[1] && py <= rect[1] + rect[3]
}

/// 分析一张源图。`src` 为 premultiplied RGBA。
///
/// 结果只取决于像素与 `params`，不含任何随机性。
pub fn analyze(src: &Pixmap, params: &WhiteboardParams) -> WhiteboardAnalysis {
    let width = src.width();
    let height = src.height();
    let long = width.max(height).max(1);
    let scale = if long > WORK_LONG_EDGE {
        u32::div_ceil(long, WORK_LONG_EDGE)
    } else {
        1
    };
    let ww = u32::div_ceil(width, scale).max(1);
    let wh = u32::div_ceil(height, scale).max(1);
    let work_area = (ww * wh) as usize;

    // 1. 分类（自然分辨率）并聚合到工作格：格内只要有墨线就是墨线，否则有色块
    //    就是色块——保证每个自然墨线像素都落在一个有限时刻的格里。
    let mut natural_class = vec![Class::Paper; (width * height) as usize];
    let mut work_class = vec![Class::Paper; work_area];
    let (mut paper_sum, mut paper_count) = ([0u64; 3], 0u64);
    for y in 0..height {
        let wy = y / scale;
        for x in 0..width {
            let i = (y * width + x) as usize;
            let px = &src.data()[i * 4..i * 4 + 4];
            let c = classify(px);
            natural_class[i] = c;
            if c == Class::Paper && px[3] == 255 {
                for (sum, &v) in paper_sum.iter_mut().zip(&px[..3]) {
                    *sum += u64::from(v);
                }
                paper_count += 1;
            }
            if c != Class::Paper {
                let wi = (wy * ww + x / scale) as usize;
                let cur = work_class[wi];
                if c == Class::Ink || cur == Class::Paper {
                    work_class[wi] = c;
                }
            }
        }
    }
    let ink_pixels = work_class.iter().filter(|&&c| c == Class::Ink).count();
    let color_pixels = work_class.iter().filter(|&&c| c == Class::Color).count();
    let paper_fill = (paper_count > 0).then(|| {
        let avg = |sum: u64| ((sum + paper_count / 2) / paper_count).min(255) as u8;
        [avg(paper_sum[0]), avg(paper_sum[1]), avg(paper_sum[2]), 255]
    });

    // 2–3. 膨胀 + 连通域，墨线与色块各自成域。
    let mut components = Vec::new();
    for class in [Class::Ink, Class::Color] {
        let mask: Vec<bool> = work_class.iter().map(|&c| c == class).collect();
        if !mask.iter().any(|&m| m) {
            continue;
        }
        let dilated = dilate(&mask, ww, wh, DILATE_RADIUS);
        label_components(&dilated, &mask, ww, wh, class, &mut components);
    }
    merge_small_components(&mut components);

    // 3b. strict：逐像素按 box 标 owner（后拍覆盖），跨 box 的域按像素切开；膨胀面同样
    //     按 owner 切，所以测地行走不会跨 box。
    let beat_count = params.beats.len();
    let strict = params.strict && beat_count > 0;
    let mut unassigned_foreground = 0usize;
    if strict {
        let owner_of = |p: u32| -> Option<usize> {
            let px = (f64::from(p % ww) + 0.5) / ww as f64 * 100.0;
            let py = (f64::from(p / ww) + 0.5) / wh as f64 * 100.0;
            params
                .beats
                .iter()
                .rposition(|b| rect_contains(b.rect, px, py))
        };
        components = split_by_owner(components, ww, &owner_of);
        unassigned_foreground = components
            .iter()
            .filter(|c| c.owner.is_none())
            .map(|c| c.pixels.len())
            .sum();
    }

    // 4. 排序：beat 分组 → 阅读带 → 质心 x。
    let band = (wh as f64 / READING_BANDS as f64).max(1.0);
    let reading_key = |c: &Component| ((c.ymin as f64 / band) as usize, c.cx);
    let group_of = |c: &Component| -> usize {
        if beat_count == 0 {
            return 0;
        }
        if strict {
            return c.owner.unwrap_or(beat_count);
        }
        let px = c.cx / ww as f64 * 100.0;
        let py = c.cy / wh as f64 * 100.0;
        // 先取包含质心的第一个 beat；都不包含时取质心到矩形距离最近的 beat。
        if let Some(i) = params
            .beats
            .iter()
            .position(|b| rect_contains(b.rect, px, py))
        {
            return i;
        }
        let mut best = 0;
        let mut best_d = f64::INFINITY;
        for (i, b) in params.beats.iter().enumerate() {
            let dx = (b.rect[0] - px).max(px - (b.rect[0] + b.rect[2])).max(0.0);
            let dy = (b.rect[1] - py).max(py - (b.rect[1] + b.rect[3])).max(0.0);
            let d = dx * dx + dy * dy;
            if d < best_d {
                best_d = d;
                best = i;
            }
        }
        best
    };
    let mut order: Vec<(usize, usize)> = components
        .iter()
        .enumerate()
        .map(|(i, c)| (group_of(c), i))
        .collect();
    order.sort_by(|(ga, ia), (gb, ib)| {
        let (band_a, cx_a) = reading_key(&components[*ia]);
        let (band_b, cx_b) = reading_key(&components[*ib]);
        (*ga, band_a)
            .cmp(&(*gb, band_b))
            .then(cx_a.partial_cmp(&cx_b).unwrap_or(std::cmp::Ordering::Equal))
            .then(ia.cmp(ib))
    });

    // 域内测地距离先算好：natural 要在分配窗前知道每组的自然时长。
    let distances: Vec<(Vec<u32>, u32)> = components
        .iter()
        .map(|c| geodesic_distances(c, ww, wh))
        .collect();

    // 阅读序外接框（与 beats 无关）：probe 的 `boxes[]` 与 sync 兜底的原料。
    let mut reading: Vec<usize> = (0..components.len()).collect();
    reading.sort_by(|&a, &b| {
        let (band_a, cx_a) = reading_key(&components[a]);
        let (band_b, cx_b) = reading_key(&components[b]);
        band_a
            .cmp(&band_b)
            .then(cx_a.partial_cmp(&cx_b).unwrap_or(std::cmp::Ordering::Equal))
            .then(a.cmp(&b))
    });
    let boxes: Vec<WhiteboardBox> = reading
        .iter()
        .map(|&i| {
            let c = &components[i];
            WhiteboardBox {
                rect: [
                    f64::from(c.xmin) / ww as f64 * 100.0,
                    f64::from(c.ymin) / wh as f64 * 100.0,
                    f64::from(c.xmax + 1 - c.xmin) / ww as f64 * 100.0,
                    f64::from(c.ymax + 1 - c.ymin) / wh as f64 * 100.0,
                ],
                area: c.pixels.len(),
                ink: c.class == Class::Ink,
                natural_seconds: natural_seconds(distances[i].1 as usize, 1),
            }
        })
        .collect();

    // 5. 时间窗：每个 beat 组一段 `[at_g, end_g]`（`end` 缺席 = 下一拍 at，末拍 = 1）；
    //    strict 多一组「末拍之后」`[end_末, 1]` 收未归属前景。`natural` 时组内只用
    //    `[at_g, at_g + 自然时长]`，其余定格。组内 inkFirst 再切成墨线 `[0, 0.7]`
    //    与色块 `[0.7, 1]`，各类内部按 √面积分配。
    let group_count = if beat_count == 0 {
        1
    } else if strict {
        beat_count + 1
    } else {
        beat_count
    };
    let group_window = |g: usize| -> (f64, f64) {
        if beat_count == 0 {
            return (0.0, 1.0);
        }
        if g >= beat_count {
            let last = &params.beats[beat_count - 1];
            let start = last.end.unwrap_or(1.0).clamp(0.0, 1.0);
            return (start, 1.0);
        }
        let start = params.beats[g].at.clamp(0.0, 1.0);
        let end = params.beats[g]
            .end
            .or_else(|| params.beats.get(g + 1).map(|b| b.at))
            .unwrap_or(1.0)
            .clamp(0.0, 1.0)
            .max(start);
        (start, end)
    };
    let natural_pace = params.pace == WhiteboardPace::Natural && params.draw_seconds > 0.0;
    let mut field_work = vec![u16::MAX; work_area];
    let mut path_length = 0usize;
    let mut groups = Vec::with_capacity(beat_count.max(1));
    for g in 0..group_count {
        let (g0, g1) = group_window(g);
        let members: Vec<usize> = order
            .iter()
            .filter(|(gg, _)| *gg == g)
            .map(|(_, i)| *i)
            .collect();
        let group_natural: f64 = members
            .iter()
            .map(|&i| natural_seconds(distances[i].1 as usize, 1))
            .sum();
        let (draw_end, compressed) = if natural_pace && !members.is_empty() {
            let window_secs = (g1 - g0) * params.draw_seconds;
            if group_natural >= window_secs {
                (g1, group_natural > window_secs + 1e-9)
            } else {
                (g0 + group_natural / params.draw_seconds, false)
            }
        } else {
            (g1, false)
        };
        if g < beat_count.max(1) {
            groups.push(WhiteboardGroup {
                window: [g0, g1],
                draw_end,
                natural_seconds: group_natural,
                compressed,
                empty: members.is_empty(),
            });
        }
        if members.is_empty() {
            continue;
        }
        let has_ink = members.iter().any(|&i| components[i].class == Class::Ink);
        let has_color = members.iter().any(|&i| components[i].class == Class::Color);
        let (p_start, p_end) = (g0, draw_end);
        let phases: Vec<(Option<Class>, f64, f64)> = if params.ink_first && has_ink && has_color {
            let split = p_start + (p_end - p_start) * INK_SHARE;
            vec![
                (Some(Class::Ink), p_start, split),
                (Some(Class::Color), split, p_end),
            ]
        } else {
            vec![(None, p_start, p_end)]
        };
        for (class, p0, p1) in phases {
            let seq: Vec<usize> = members
                .iter()
                .copied()
                .filter(|&i| class.is_none_or(|c| components[i].class == c))
                .collect();
            let weights: Vec<f64> = seq
                .iter()
                .map(|&i| (components[i].pixels.len() as f64).sqrt())
                .collect();
            let total: f64 = weights.iter().sum::<f64>().max(f64::EPSILON);
            let mut t = p0;
            for (&i, &w) in seq.iter().zip(&weights) {
                let dur = (p1 - p0) * w / total;
                let (dist, maxd) = &distances[i];
                write_field(&components[i], dist, *maxd, t, dur, &mut field_work);
                path_length += *maxd as usize;
                t += dur;
            }
        }
    }

    // 6. 映射回自然分辨率：前景像素取所在工作格的时刻（至少为 1，保证 t = 0 时
    //    一笔都没露）。纸像素分两种：离前景远的恒为 0（真正的纸，始终按源图显示，
    //    纸纹不会在末尾突然出现）；贴着前景的跟最早揭示的那个前景走——出图工具的
    //    PNG 里笔画边缘有一圈几像素宽、亮度刚过纸阈值的浅灰（抗锯齿 / 压缩振铃），
    //    恒为 0 会让整张图在一笔没画时就以淡淡的轮廓全部显形。「贴着」按工作格上
    //    Chebyshev 半径 `HALO_RADIUS_PX` 算：先把前景格的时刻放进网格（纸格为
    //    MAX），再做两次一维最小值扫描。只管不透明的纸像素：透明底的半透明边缘
    //    本来就按反预乘色分进墨线 / 色块，全透明像素画不画都看不见。
    let src_data = src.data();
    let halo_cells = HALO_RADIUS_PX.div_ceil(scale) as usize;
    let mut halo_work: Vec<u16> = (0..work_area)
        .map(|wi| {
            if work_class[wi] == Class::Paper {
                u16::MAX
            } else {
                field_work[wi].min(u16::MAX - 1).max(1)
            }
        })
        .collect();
    let mut pass = halo_work.clone();
    for wy in 0..wh as usize {
        let row = wy * ww as usize;
        for wx in 0..ww as usize {
            let lo = wx.saturating_sub(halo_cells);
            let hi = (wx + halo_cells).min(ww as usize - 1);
            pass[row + wx] = halo_work[row + lo..=row + hi]
                .iter()
                .copied()
                .min()
                .unwrap();
        }
    }
    for wx in 0..ww as usize {
        for wy in 0..wh as usize {
            let lo = wy.saturating_sub(halo_cells);
            let hi = (wy + halo_cells).min(wh as usize - 1);
            halo_work[wy * ww as usize + wx] =
                (lo..=hi).map(|y| pass[y * ww as usize + wx]).min().unwrap();
        }
    }
    let mut field = vec![0u16; (width * height) as usize];
    for y in 0..height {
        let wy = y / scale;
        for x in 0..width {
            let i = (y * width + x) as usize;
            let wi = (wy * ww + x / scale) as usize;
            let q = if natural_class[i] != Class::Paper {
                field_work[wi]
            } else if src_data[i * 4 + 3] != 255 {
                continue;
            } else {
                let q = halo_work[wi];
                if q == u16::MAX {
                    continue;
                }
                q
            };
            field[i] = if q == u16::MAX { 1 } else { q.max(1) };
        }
    }

    WhiteboardAnalysis {
        width,
        height,
        field,
        ink_pixels,
        color_pixels,
        components: components.len(),
        work_area,
        path_length,
        groups,
        unassigned_foreground,
        boxes,
        hold_hand: params.pace == WhiteboardPace::Natural,
        paper_fill,
    }
}

/// `strict`：把每个域按像素 owner 切成若干子域（`None` = 不在任何 box 里）。
/// 膨胀面按同一规则切，子域之间不共享行走面。
fn split_by_owner(
    components: Vec<Component>,
    w: u32,
    owner_of: &dyn Fn(u32) -> Option<usize>,
) -> Vec<Component> {
    use std::collections::BTreeMap;
    let mut out = Vec::new();
    for c in components {
        let mut by_owner: BTreeMap<Option<usize>, (Vec<u32>, Vec<u32>)> = BTreeMap::new();
        for &p in &c.pixels {
            by_owner.entry(owner_of(p)).or_default().0.push(p);
        }
        for &p in &c.footprint {
            by_owner.entry(owner_of(p)).or_default().1.push(p);
        }
        for (owner, (pixels, footprint)) in by_owner {
            if pixels.is_empty() {
                continue;
            }
            out.push(Component::new(c.class, pixels, footprint, w, owner));
        }
    }
    out
}

fn dilate(mask: &[bool], w: u32, h: u32, radius: i32) -> Vec<bool> {
    let (wi, hi) = (w as i32, h as i32);
    let mut out = mask.to_vec();
    for y in 0..hi {
        for x in 0..wi {
            if !mask[(y * wi + x) as usize] {
                continue;
            }
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    if dx * dx + dy * dy > radius * radius {
                        continue;
                    }
                    let (nx, ny) = (x + dx, y + dy);
                    if nx >= 0 && ny >= 0 && nx < wi && ny < hi {
                        out[(ny * wi + nx) as usize] = true;
                    }
                }
            }
        }
    }
    out
}

const NEIGHBOURS: [(i32, i32); 8] = [
    (-1, 0),
    (1, 0),
    (0, -1),
    (0, 1),
    (-1, -1),
    (-1, 1),
    (1, -1),
    (1, 1),
];

fn label_components(
    dilated: &[bool],
    real: &[bool],
    w: u32,
    h: u32,
    class: Class,
    out: &mut Vec<Component>,
) {
    let (wi, hi) = (w as i32, h as i32);
    let mut seen = vec![false; dilated.len()];
    let mut queue = VecDeque::new();
    for start in 0..dilated.len() {
        if !dilated[start] || seen[start] {
            continue;
        }
        seen[start] = true;
        queue.push_back(start as u32);
        let mut footprint = Vec::new();
        let mut pixels = Vec::new();
        while let Some(idx) = queue.pop_front() {
            footprint.push(idx);
            if real[idx as usize] {
                pixels.push(idx);
            }
            let (x, y) = ((idx % w) as i32, (idx / w) as i32);
            for (dx, dy) in NEIGHBOURS {
                let (nx, ny) = (x + dx, y + dy);
                if nx < 0 || ny < 0 || nx >= wi || ny >= hi {
                    continue;
                }
                let n = (ny * wi + nx) as usize;
                if dilated[n] && !seen[n] {
                    seen[n] = true;
                    queue.push_back(n as u32);
                }
            }
        }
        if pixels.is_empty() {
            continue;
        }
        out.push(Component::new(class, pixels, footprint, w, None));
    }
}

/// 面积小于 [`MIN_COMPONENT_AREA`] 的域并入**同类**中质心最近的大域；没有大域
/// 时保留原样。
fn merge_small_components(components: &mut Vec<Component>) {
    let small: Vec<usize> = (0..components.len())
        .filter(|&i| components[i].pixels.len() < MIN_COMPONENT_AREA)
        .collect();
    if small.is_empty() {
        return;
    }
    let mut removed = vec![false; components.len()];
    for &s in &small {
        let (cx, cy, class) = (components[s].cx, components[s].cy, components[s].class);
        let target = (0..components.len())
            .filter(|&i| {
                i != s
                    && !removed[i]
                    && components[i].class == class
                    && components[i].pixels.len() >= MIN_COMPONENT_AREA
            })
            .min_by(|&a, &b| {
                let da = (components[a].cx - cx).powi(2) + (components[a].cy - cy).powi(2);
                let db = (components[b].cx - cx).powi(2) + (components[b].cy - cy).powi(2);
                da.partial_cmp(&db)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(a.cmp(&b))
            });
        let Some(t) = target else {
            continue;
        };
        let (pixels, footprint) = {
            let c = &mut components[s];
            (
                std::mem::take(&mut c.pixels),
                std::mem::take(&mut c.footprint),
            )
        };
        let dst = &mut components[t];
        dst.pixels.extend(pixels);
        dst.footprint.extend(footprint);
        removed[s] = true;
    }
    let mut i = 0;
    components.retain(|_| {
        let keep = !removed[i];
        i += 1;
        keep
    });
}

/// 域内测地 BFS：从最左上的真实像素出发，沿膨胀掩码行走。返回与 `pixels` 对齐的
/// 到达序号（走不到的为 `u32::MAX`）与最长路径（工作像素）。
///
/// 并入过小域后 `footprint` 可能不连通（小域的落脚面与大域相隔几像素）；
/// 走不到的像素按最远时刻落笔，不会被漏掉。
fn geodesic_distances(component: &Component, w: u32, h: u32) -> (Vec<u32>, u32) {
    let (wi, hi) = (w as i32, h as i32);
    let start = component
        .pixels
        .iter()
        .copied()
        .min_by(|&a, &b| {
            let key = |p: u32| {
                let (x, y) = (f64::from(p % w), f64::from(p / w));
                (y + x * 0.3, x)
            };
            key(a)
                .partial_cmp(&key(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .expect("component has pixels");
    let area = (w * h) as usize;
    let mut walkable = vec![false; area];
    for &p in &component.footprint {
        walkable[p as usize] = true;
    }
    let mut dist = vec![u32::MAX; area];
    let mut queue = VecDeque::new();
    dist[start as usize] = 0;
    queue.push_back(start);
    let mut maxd = 0u32;
    while let Some(idx) = queue.pop_front() {
        let d = dist[idx as usize];
        let (x, y) = ((idx % w) as i32, (idx / w) as i32);
        for (dx, dy) in NEIGHBOURS {
            let (nx, ny) = (x + dx, y + dy);
            if nx < 0 || ny < 0 || nx >= wi || ny >= hi {
                continue;
            }
            let n = (ny * wi + nx) as usize;
            if walkable[n] && dist[n] == u32::MAX {
                dist[n] = d + 1;
                maxd = maxd.max(d + 1);
                queue.push_back(n as u32);
            }
        }
    }
    (
        component.pixels.iter().map(|&p| dist[p as usize]).collect(),
        maxd,
    )
}

/// 把到达序号归一化到 `[t0, t0 + dur]` 写进时间场。
fn write_field(
    component: &Component,
    dist: &[u32],
    maxd: u32,
    t0: f64,
    dur: f64,
    field: &mut [u16],
) {
    let denom = f64::from(maxd.max(1));
    for (&p, &d) in component.pixels.iter().zip(dist) {
        let frac = if d == u32::MAX {
            1.0
        } else {
            f64::from(d) / denom
        };
        let t = t0 + dur * frac;
        let q = quantize(t).clamp(1, FIELD_MAX) as u16;
        let slot = &mut field[p as usize];
        // 同一格被两个域触及时取更早的时刻。
        if *slot == u16::MAX || q < *slot {
            *slot = q;
        }
    }
}

/// 一帧：`t` 是归一化进度（`elapsed / draw`），`≥ 1` 为画完。
///
/// 输出与源图同尺寸、premultiplied RGBA。`paper` 给出时整幅先填纸色。
/// `t ≥ 1` 且无纸色时输出与源图逐字节相等。
pub fn whiteboard_frame(
    analysis: &WhiteboardAnalysis,
    src: &Pixmap,
    t: f64,
    hand: WhiteboardHand,
    paper: Option<Color>,
) -> Pixmap {
    debug_assert_eq!(src.width(), analysis.width);
    debug_assert_eq!(src.height(), analysis.height);
    let mut out =
        Pixmap::new(src.width().max(1), src.height().max(1)).expect("whiteboard frame pixmap");
    if let Some(paper) = paper {
        out.fill(paper);
    }
    let threshold = quantize(t);
    let src_data = src.data();
    let out_data = out.data_mut();
    let (mut front_x, mut front_y, mut front_n) = (0f64, 0f64, 0usize);
    // hold 段的手：已揭示像素里时刻最晚的那一笔的质心（只在 `hold_hand` 时用）。
    let (mut last_q, mut last_x, mut last_y, mut last_n) = (0u32, 0f64, 0f64, 0usize);
    let window = (HAND_WINDOW * f64::from(FIELD_MAX)) as u32;
    let lower = threshold.saturating_sub(window);
    for (i, &q) in analysis.field.iter().enumerate() {
        let q = u32::from(q);
        if q > threshold {
            // 还没画到：显式纸色已铺底；没给纸色时，源图自己的不透明纸面顶上，
            // 只有透明底才真的透出下层。
            if paper.is_none()
                && let Some(fill) = analysis.paper_fill
                && src_data[i * 4 + 3] == 255
            {
                out_data[i * 4..i * 4 + 4].copy_from_slice(&fill);
            }
            continue;
        }
        if analysis.hold_hand && q > 0 {
            let (x, y) = (
                (i as u32 % analysis.width) as f64,
                (i as u32 / analysis.width) as f64,
            );
            if q > last_q {
                (last_q, last_x, last_y, last_n) = (q, x, y, 1);
            } else if q == last_q {
                last_x += x;
                last_y += y;
                last_n += 1;
            }
        }
        let px = &src_data[i * 4..i * 4 + 4];
        if px[3] == 0 && paper.is_some() {
            continue;
        }
        if paper.is_some() && px[3] < 255 {
            // 半透明源像素叠在纸色上（source-over，预乘）。
            let a = u32::from(px[3]);
            for c in 0..4 {
                let dst = u32::from(out_data[i * 4 + c]);
                out_data[i * 4 + c] = (u32::from(px[c]) + dst * (255 - a) / 255).min(255) as u8;
            }
        } else {
            out_data[i * 4..i * 4 + 4].copy_from_slice(px);
        }
        if q > lower && q > 0 {
            front_x += (i as u32 % analysis.width) as f64;
            front_y += (i as u32 / analysis.width) as f64;
            front_n += 1;
        }
    }
    if t < 1.0 && hand != WhiteboardHand::None {
        if front_n > 0 {
            let x = front_x / front_n as f64 + 0.5;
            let y = front_y / front_n as f64 + 0.5;
            draw_hand(&mut out, hand, x, y);
        } else if analysis.hold_hand && last_n > 0 {
            let x = last_x / last_n as f64 + 0.5;
            let y = last_y / last_n as f64 + 0.5;
            draw_hand(&mut out, hand, x, y);
        }
    }
    out
}

/// 矢量笔：笔尖落在 `(x, y)`，笔杆朝右下 55°。尺寸随画面短边走。
fn draw_hand(out: &mut Pixmap, hand: WhiteboardHand, x: f64, y: f64) {
    let short = f64::from(out.width().min(out.height())).max(1.0);
    let (len, width, body, cap, band) = match hand {
        WhiteboardHand::Marker => (
            short * 0.22,
            short * 0.05,
            Color::from_rgba8(44, 44, 48, 255),
            Color::from_rgba8(28, 28, 30, 255),
            Color::from_rgba8(205, 205, 210, 255),
        ),
        WhiteboardHand::Pen => (
            short * 0.2,
            short * 0.022,
            Color::from_rgba8(34, 36, 62, 255),
            Color::from_rgba8(190, 194, 205, 255),
            Color::from_rgba8(150, 154, 168, 255),
        ),
        WhiteboardHand::None => return,
    };
    let angle = 55f64.to_radians();
    let (dx, dy) = (angle.cos(), angle.sin());
    let at = |d: f64| ((x + dx * d) as f32, (y + dy * d) as f32);
    let mut paint = Paint::default();
    paint.anti_alias = true;

    // 影子：笔尖处一枚偏移的淡椭圆，让笔「贴在纸上」。
    let shadow_r = (width * 0.7) as f32;
    if let Some(shadow) = PathBuilder::from_circle(
        x as f32 + shadow_r * 0.4,
        y as f32 + shadow_r * 0.5,
        shadow_r,
    ) {
        paint.set_color(Color::from_rgba8(0, 0, 0, 46));
        out.fill_path(
            &shadow,
            &paint,
            tiny_skia::FillRule::Winding,
            Transform::identity(),
            None,
        );
    }

    // 笔尖：从笔尖到 0.14·len 的锥形。
    let tip_len = len * 0.14;
    let tip_w = width * 0.9;
    let (nx, ny) = (-dy, dx);
    let (bx, by) = (x + dx * tip_len, y + dy * tip_len);
    let mut tip = PathBuilder::new();
    tip.move_to(x as f32, y as f32);
    tip.line_to(
        (bx + nx * tip_w / 2.0) as f32,
        (by + ny * tip_w / 2.0) as f32,
    );
    tip.line_to(
        (bx - nx * tip_w / 2.0) as f32,
        (by - ny * tip_w / 2.0) as f32,
    );
    tip.close();
    if let Some(tip) = tip.finish() {
        paint.set_color(cap);
        out.fill_path(
            &tip,
            &paint,
            tiny_skia::FillRule::Winding,
            Transform::identity(),
            None,
        );
    }

    let stroke_segment = |out: &mut Pixmap, from: f64, to: f64, w: f64, color: Color| {
        let mut pb = PathBuilder::new();
        let (x0, y0) = at(from);
        let (x1, y1) = at(to);
        pb.move_to(x0, y0);
        pb.line_to(x1, y1);
        let Some(path) = pb.finish() else {
            return;
        };
        let mut p = Paint::default();
        p.anti_alias = true;
        p.set_color(color);
        let stroke = Stroke {
            width: w as f32,
            line_cap: LineCap::Round,
            ..Stroke::default()
        };
        out.stroke_path(&path, &p, &stroke, Transform::identity(), None);
    };
    // 笔杆、色环、尾帽。
    stroke_segment(out, tip_len + width * 0.3, len, width, body);
    stroke_segment(
        out,
        tip_len + width * 0.6,
        tip_len + width * 0.9,
        width * 1.02,
        band,
    );
    stroke_segment(out, len * 0.86, len, width * 0.9, cap);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 三笔墨线（左上横线、右上横线、下方竖线）+ 右下一块红色块，透明底。
    fn sample() -> Pixmap {
        let mut pm = Pixmap::new(200, 120).unwrap();
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba8(20, 20, 20, 255));
        let rect = |x: f32, y: f32, w: f32, h: f32| {
            PathBuilder::from_rect(tiny_skia::Rect::from_xywh(x, y, w, h).unwrap())
        };
        for r in [
            rect(10.0, 10.0, 60.0, 4.0),
            rect(120.0, 12.0, 60.0, 4.0),
            rect(30.0, 40.0, 4.0, 60.0),
        ] {
            pm.fill_path(
                &r,
                &paint,
                tiny_skia::FillRule::Winding,
                Transform::identity(),
                None,
            );
        }
        paint.set_color(Color::from_rgba8(220, 40, 40, 255));
        pm.fill_path(
            &rect(130.0, 60.0, 50.0, 40.0),
            &paint,
            tiny_skia::FillRule::Winding,
            Transform::identity(),
            None,
        );
        pm
    }

    fn count_visible(pm: &Pixmap) -> usize {
        pm.data().chunks_exact(4).filter(|p| p[3] > 0).count()
    }

    #[test]
    fn classifies_and_orders_components() {
        let src = sample();
        let a = analyze(&src, &WhiteboardParams::default());
        assert_eq!(a.components, 4);
        assert!(a.ink_pixels > 0 && a.color_pixels > 0);
        assert!(a.natural_draw_seconds() >= 1.0);
    }

    #[test]
    fn frame_zero_is_empty_and_frame_one_equals_source() {
        let src = sample();
        let a = analyze(&src, &WhiteboardParams::default());
        let f0 = whiteboard_frame(&a, &src, 0.0, WhiteboardHand::None, None);
        assert_eq!(count_visible(&f0), 0);
        let f1 = whiteboard_frame(&a, &src, 1.0, WhiteboardHand::Marker, None);
        assert_eq!(f1.data(), src.data());
    }

    /// 不透明白底的源（AI 出图的常态）：没给 `paper` 时未画到的笔画铺源图纸色，不挖透明洞。
    #[test]
    fn opaque_paper_source_fills_unrevealed_strokes_with_its_own_paper() {
        let mut src = sample();
        let strokes = src.clone();
        src.fill(Color::from_rgba8(250, 250, 250, 255));
        src.draw_pixmap(
            0,
            0,
            strokes.as_ref(),
            &tiny_skia::PixmapPaint::default(),
            Transform::identity(),
            None,
        );
        let a = analyze(&src, &WhiteboardParams::default());
        assert_eq!(a.paper_fill, Some([250, 250, 250, 255]));
        let f0 = whiteboard_frame(&a, &src, 0.0, WhiteboardHand::None, None);
        assert_eq!(count_visible(&f0), 200 * 120);
        assert!(
            f0.data().chunks_exact(4).all(|p| p == [250, 250, 250, 255]),
            "t=0 应整幅纸色"
        );
        let f1 = whiteboard_frame(&a, &src, 1.0, WhiteboardHand::None, None);
        assert_eq!(f1.data(), src.data());
        // 显式纸色优先于源图纸面。
        let f0 = whiteboard_frame(
            &a,
            &src,
            0.0,
            WhiteboardHand::None,
            Some(Color::from_rgba8(0, 0, 255, 255)),
        );
        // 源图自带的纸面像素一开始就可见（与 0.8 相同），笔画处先是显式纸色。
        let px = |pm: &Pixmap, x: usize, y: usize| {
            pm.data()[(y * 200 + x) * 4..(y * 200 + x) * 4 + 4].to_vec()
        };
        assert_eq!(px(&f0, 68, 11), [0, 0, 255, 255]);
        // 贴着笔画的纸像素算晕圈，跟笔画走；离笔画超过 HALO_RADIUS_PX 的才是纸。
        assert_eq!(px(&f0, 5, 5), [0, 0, 255, 255]);
        assert_eq!(px(&f0, 100, 110), [250, 250, 250, 255]);
        // 透明底的源仍然透明。
        let t = sample();
        assert_eq!(analyze(&t, &WhiteboardParams::default()).paper_fill, None);
    }

    /// 笔画的抗锯齿边缘是亮度刚过纸阈值的浅灰（被分成纸）：它们跟所在工作格的
    /// 笔画一起揭示，t = 0 时铺纸色，不能一开始就以淡轮廓显形；远离笔画的纸像素
    /// 仍恒为 0，始终按源图显示。
    #[test]
    fn antialiased_halo_around_strokes_is_revealed_with_the_stroke() {
        let mut src = Pixmap::new(200, 120).unwrap();
        src.fill(Color::from_rgba8(255, 255, 255, 255));
        let mut paint = Paint::default();
        // 3 px 宽的浅灰晕圈（lum 240 > 235 → 纸）包着一条黑线。
        paint.set_color(Color::from_rgba8(240, 240, 240, 255));
        let halo =
            PathBuilder::from_rect(tiny_skia::Rect::from_xywh(19.0, 50.0, 122.0, 8.0).unwrap());
        src.fill_path(
            &halo,
            &paint,
            tiny_skia::FillRule::Winding,
            Transform::identity(),
            None,
        );
        paint.set_color(Color::from_rgba8(0, 0, 0, 255));
        let line =
            PathBuilder::from_rect(tiny_skia::Rect::from_xywh(22.0, 53.0, 116.0, 2.0).unwrap());
        src.fill_path(
            &line,
            &paint,
            tiny_skia::FillRule::Winding,
            Transform::identity(),
            None,
        );
        let a = analyze(&src, &WhiteboardParams::default());
        let fill = a.paper_fill.unwrap();
        assert!(fill[0] > 250, "{fill:?}");
        let px = |pm: &Pixmap, x: usize, y: usize| {
            pm.data()[(y * 200 + x) * 4..(y * 200 + x) * 4 + 4].to_vec()
        };
        // 晕圈像素跟线走：t = 0 时是纸色，不是源图的浅灰；远处的纸恒为源图。
        assert!(a.reveal_at(30, 50) > 0.0);
        assert!(a.reveal_at(19, 53) > 0.0);
        assert!(a.reveal_at(30, 57) > 0.0);
        assert_eq!(a.reveal_at(5, 5), 0.0);
        let f0 = whiteboard_frame(&a, &src, 0.0, WhiteboardHand::None, None);
        assert_eq!(px(&f0, 30, 50), fill.to_vec());
        assert_eq!(px(&f0, 30, 57), fill.to_vec());
        assert_eq!(px(&f0, 30, 54), fill.to_vec());
        assert_eq!(px(&f0, 5, 5), [255, 255, 255, 255]);
        assert!(
            f0.data().chunks_exact(4).all(|p| p[0] >= 250),
            "t=0 不应有浅灰轮廓"
        );
        let f1 = whiteboard_frame(&a, &src, 1.0, WhiteboardHand::None, None);
        assert_eq!(f1.data(), src.data());
    }

    #[test]
    fn reveal_is_monotonic_and_ink_precedes_color() {
        let src = sample();
        let a = analyze(&src, &WhiteboardParams::default());
        let mut last = 0;
        for i in 0..=20 {
            let n = a.revealed_count(i as f64 / 20.0);
            assert!(n >= last, "t={i}/20 revealed {n} < {last}");
            last = n;
        }
        // 色块像素（130..180, 60..100）在 0.7 之前一个都不出现；墨线在 0.7 时全部出现。
        let f = whiteboard_frame(&a, &src, INK_SHARE - 0.001, WhiteboardHand::None, None);
        for y in 60..100u32 {
            for x in 130..180u32 {
                assert_eq!(f.data()[((y * 200 + x) * 4 + 3) as usize], 0);
            }
        }
        let f = whiteboard_frame(&a, &src, INK_SHARE, WhiteboardHand::None, None);
        assert_eq!(f.data()[((11 * 200 + 68) * 4 + 3) as usize], 255);
        assert_eq!(f.data()[((13 * 200 + 178) * 4 + 3) as usize], 255);
        assert_eq!(f.data()[((99 * 200 + 31) * 4 + 3) as usize], 255);
    }

    #[test]
    fn beats_reorder_components() {
        let src = sample();
        // 缺省：左上横线先于右上横线。
        let a = analyze(&src, &WhiteboardParams::default());
        assert!(a.reveal_at(12, 11) < a.reveal_at(122, 13));
        // beats：先画右半，再画左半。
        let b = analyze(
            &src,
            &WhiteboardParams {
                beats: vec![
                    WhiteboardBeat::at(0.0, [50.0, 0.0, 50.0, 100.0]),
                    WhiteboardBeat::at(0.5, [0.0, 0.0, 50.0, 100.0]),
                ],
                ..WhiteboardParams::default()
            },
        );
        assert!(b.reveal_at(178, 13) < b.reveal_at(12, 11));
        assert!(b.reveal_at(12, 11) >= 0.5);
        assert_eq!(b.groups.len(), 2);
        assert_eq!(b.groups[0].window, [0.0, 0.5]);
        assert_eq!(b.groups[1].window, [0.5, 1.0]);
        assert!(!b.hold_hand);
        assert_eq!(b.unassigned_foreground, 0);
    }

    /// `end`：组窗右缘不再是下一拍的 `at`。左半 `[0, 0.3]`、右半 `[0.5, 1]`，
    /// `(0.3, 0.5)` 之间没有任何像素落笔。
    #[test]
    fn beat_end_closes_the_window_before_the_next_beat() {
        let src = sample();
        let a = analyze(
            &src,
            &WhiteboardParams {
                beats: vec![
                    WhiteboardBeat {
                        at: 0.0,
                        end: Some(0.3),
                        rect: [0.0, 0.0, 50.0, 100.0],
                    },
                    WhiteboardBeat::at(0.5, [50.0, 0.0, 50.0, 100.0]),
                ],
                ..WhiteboardParams::default()
            },
        );
        assert_eq!(a.groups[0].window, [0.0, 0.3]);
        assert!(a.reveal_at(12, 11) <= 0.3 && a.reveal_at(31, 99) <= 0.3);
        assert!(a.reveal_at(178, 13) >= 0.5 && a.reveal_at(150, 80) >= 0.5);
        assert_eq!(a.revealed_count(0.3), a.revealed_count(0.499));
    }

    /// `natural`：画时远长于自然时长时，笔画在开头按自然速度画完，其余定格；
    /// hold 段手停在末笔上（stretch 下同一时刻没有新笔就不画手）。
    #[test]
    fn natural_pace_draws_at_natural_speed_then_holds() {
        let src = sample();
        let base = analyze(&src, &WhiteboardParams::default());
        let natural = base.natural_seconds_unclamped();
        let draw_seconds = natural * 10.0;
        let a = analyze(
            &src,
            &WhiteboardParams {
                pace: WhiteboardPace::Natural,
                draw_seconds,
                ..WhiteboardParams::default()
            },
        );
        assert_eq!(a.groups.len(), 1);
        assert!(!a.groups[0].compressed);
        assert!(
            (a.groups[0].draw_end - 0.1).abs() < 1e-6,
            "{:?}",
            a.groups[0]
        );
        assert!((a.groups[0].natural_seconds - natural).abs() < 1e-9);
        assert_eq!(a.revealed_count(0.11), a.revealed_count(1.0));
        assert!(a.revealed_count(0.05) < a.revealed_count(1.0));
        // hold 段仍有手；stretch 的画完前每一刻都有新笔，这里只验 natural。
        let bare = whiteboard_frame(&a, &src, 0.6, WhiteboardHand::None, None);
        let with_hand = whiteboard_frame(&a, &src, 0.6, WhiteboardHand::Marker, None);
        assert!(count_visible(&with_hand) > count_visible(&bare));
        assert!(a.hold_hand);
        // 组窗短于自然时长：压缩到组窗并记 compressed。
        let tight = analyze(
            &src,
            &WhiteboardParams {
                pace: WhiteboardPace::Natural,
                draw_seconds: natural * 0.5,
                ..WhiteboardParams::default()
            },
        );
        assert!(tight.groups[0].compressed);
        assert_eq!(tight.groups[0].draw_end, 1.0);
        // draw_seconds 未知 = stretch。
        let unknown = analyze(
            &src,
            &WhiteboardParams {
                pace: WhiteboardPace::Natural,
                ..WhiteboardParams::default()
            },
        );
        assert_eq!(unknown.groups[0].draw_end, 1.0);
    }

    /// `strict`：box 是硬遮罩。左上横线（x 10..70）被 `[0, 0, 20, 100]`（x < 40 px）
    /// 切开：左段属第一拍，右段不在任何 box 里 → 排到末拍之后 `[0.5, 1]`。
    #[test]
    fn strict_boxes_split_components_and_park_unassigned_foreground_after_the_last_beat() {
        let src = sample();
        let a = analyze(
            &src,
            &WhiteboardParams {
                strict: true,
                beats: vec![WhiteboardBeat {
                    at: 0.0,
                    end: Some(0.5),
                    rect: [0.0, 0.0, 20.0, 100.0],
                }],
                ..WhiteboardParams::default()
            },
        );
        assert!(a.reveal_at(12, 11) < 0.5, "{}", a.reveal_at(12, 11));
        assert!(a.reveal_at(60, 11) >= 0.5, "{}", a.reveal_at(60, 11));
        assert!(a.reveal_at(178, 13) >= 0.5);
        assert!(a.unassigned_foreground > 0);
        assert_eq!(a.groups.len(), 1);
        assert!(!a.groups[0].empty);
        // 非 strict 的同一 box：整条横线归第一拍（质心在 box 里），没有未归属。
        let loose = analyze(
            &src,
            &WhiteboardParams {
                beats: vec![WhiteboardBeat {
                    at: 0.0,
                    end: Some(0.5),
                    rect: [0.0, 0.0, 20.0, 100.0],
                }],
                ..WhiteboardParams::default()
            },
        );
        assert!(loose.reveal_at(60, 11) <= 0.5);
        assert_eq!(loose.unassigned_foreground, 0);
        // 后拍覆盖前拍：第一拍的 box 被第二拍整个盖住 → 第一拍扣空。
        let covered = analyze(
            &src,
            &WhiteboardParams {
                strict: true,
                beats: vec![
                    WhiteboardBeat::at(0.0, [0.0, 0.0, 50.0, 100.0]),
                    WhiteboardBeat::at(0.5, [0.0, 0.0, 100.0, 100.0]),
                ],
                ..WhiteboardParams::default()
            },
        );
        assert!(covered.groups[0].empty);
        assert!(!covered.groups[1].empty);
        assert!(covered.reveal_at(12, 11) >= 0.5);
    }

    /// `boxes[]`：四个连通域按阅读序给外接框（百分比）、面积与单域自然时长。
    #[test]
    fn boxes_list_components_in_reading_order() {
        let src = sample();
        let a = analyze(&src, &WhiteboardParams::default());
        assert_eq!(a.boxes.len(), 4);
        let first = &a.boxes[0];
        assert!(first.ink);
        assert!((first.rect[0] - 5.0).abs() < 0.6, "{:?}", first.rect);
        assert!((first.rect[1] - 10.0 / 120.0 * 100.0).abs() < 1.0);
        assert!((first.rect[2] - 30.0).abs() < 0.6);
        assert!(first.natural_seconds > 0.25);
        assert!(!a.boxes[3].ink, "{:?}", a.boxes);
        assert!(a.boxes[3].rect[1] > a.boxes[0].rect[1]);
        let total: f64 = a.boxes.iter().map(|b| b.natural_seconds).sum();
        assert!((total - a.natural_seconds_unclamped()).abs() < 1e-9);
    }

    #[test]
    fn hand_and_paper_render_deterministically() {
        let src = sample();
        let a = analyze(&src, &WhiteboardParams::default());
        let paper = Some(Color::from_rgba8(245, 235, 215, 255));
        let f1 = whiteboard_frame(&a, &src, 0.4, WhiteboardHand::Marker, paper);
        let f2 = whiteboard_frame(&a, &src, 0.4, WhiteboardHand::Marker, paper);
        assert_eq!(f1.data(), f2.data());
        // 纸色铺满整幅。
        assert_eq!(count_visible(&f1), 200 * 120);
        // 笔在 t < 1 时可见：透明底 + 无纸色的帧里，可见像素多于纯揭示像素。
        let bare = whiteboard_frame(&a, &src, 0.4, WhiteboardHand::None, None);
        let with_hand = whiteboard_frame(&a, &src, 0.4, WhiteboardHand::Pen, None);
        assert!(count_visible(&with_hand) > count_visible(&bare));
    }

    #[test]
    fn large_sources_are_analysed_at_work_resolution() {
        let mut pm = Pixmap::new(2400, 1200).unwrap();
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba8(0, 0, 0, 255));
        let r =
            PathBuilder::from_rect(tiny_skia::Rect::from_xywh(100.0, 100.0, 1.0, 600.0).unwrap());
        pm.fill_path(
            &r,
            &paint,
            tiny_skia::FillRule::Winding,
            Transform::identity(),
            None,
        );
        let a = analyze(&pm, &WhiteboardParams::default());
        assert_eq!(a.components, 1);
        assert!(a.work_area <= (WORK_LONG_EDGE * WORK_LONG_EDGE) as usize);
        // 1 px 细线在聚合后仍全部有时刻，画完等于源图。
        let f1 = whiteboard_frame(&a, &pm, 1.0, WhiteboardHand::None, None);
        assert_eq!(f1.data(), pm.data());
        assert_eq!(a.revealed_count(0.0), 2400 * 1200 - 600);
    }
}
