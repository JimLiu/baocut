//! 屏幕取景的求值，算法版本 1（视频格式规范 §3.18、§4.9）：给定取景文档、录制清单、指针轨与一个内容时刻，求这一刻的
//! 可见区域、光标与点击提示。预览（WASM）与导出（原生）用同一份；自动缩放的生成也在这里（[`auto_zooms`]）。
//!
//! 结果只是内容时间的函数：不读播放历史，也不读序列上的位置。跟随指针的镜头带滞回（安全区），所以它不是窗口滤波，
//! 而是在内容时钟的固定网格上从区间的 `t0` 起算出来的一条路径（[`FOLLOW_GRID_HZ`]）；路径只由文档、清单、指针轨与
//! 裁剪决定，按需算一次缓存起来，随机取值与顺序取值得到同一个结果。数值都是规范 §4.9「求值算法 1」那张表里的。
//!
//! 坐标都是源画面（已摆正、裁剪之前）的归一化坐标，左上为原点；矩形写成 `[x0, y0, x1, y1]`。

use std::collections::HashMap;
use std::sync::Arc;

use crate::pointer_track::PointerTrack;
use crate::recording::{Capture, PointerCursor, PointerMode, RecordingBody, StreamRole, ticks};
use crate::screen_view::{
    CLOCK_SOURCE_ASSET, SCREEN_VIEW_SOLVER, ScreenViewBody, ZoomFocus, ZoomOrigin, ZoomRegion,
};
use crate::recording::CLOCK_RECORDING;
use crate::{Id, VersionRef};

/// 区间开头与结尾的过渡省略时的长度（秒）。区间太短放不下两段时，省略的一侧取剩下的长度，两侧都省略时各取一半。
pub const DEFAULT_RAMP_SECONDS: f64 = 0.5;
/// 跟随路径的网格：每秒这么多步，从区间的 `t0` 起算。
pub const FOLLOW_GRID_HZ: f64 = 120.0;
/// `follow.safeArea` 的缺省。
pub const DEFAULT_SAFE_AREA: f64 = 0.5;
/// `follow.smoothing` 的缺省。
pub const DEFAULT_FOLLOW_SMOOTHING: f64 = 0.5;
/// `follow.smoothing` 为 1 时镜头平滑的半窗长（秒）：窗口是 `[t − s, t + s]`，`s = smoothing × 这个数`。
pub const FOLLOW_SMOOTHING_SECONDS: f64 = 0.5;
/// `pointer.smoothing` 为 1 时光标平滑的半窗长（秒），窗口同上。
pub const POINTER_SMOOTHING_SECONDS: f64 = 0.25;
/// 静止隐去时淡出用多久（秒）；再动时立刻出现。
pub const IDLE_FADE_SECONDS: f64 = 0.25;
/// 点击提示持续多久（秒）。
pub const CLICK_SECONDS: f64 = 0.4;
/// 点击提示散开到的半径，捕获画面的逻辑点（乘 `capture.scale` 是像素，再乘 `pointer.size`）。
pub const CLICK_RADIUS_POINTS: f64 = 20.0;
/// 点击提示外圈的线宽，单位同上。
pub const CLICK_RING_POINTS: f64 = 3.0;
/// 点击提示省略颜色时的颜色。
pub const DEFAULT_CLICK_COLOR: &str = "#FFCC00";
/// 自动缩放：每次点击前留多久、后留多久（秒）。
pub const AUTO_BEFORE_SECONDS: f64 = 0.3;
pub const AUTO_AFTER_SECONDS: f64 = 2.5;
/// 自动缩放：相邻两段的空隙不到这么久（秒）就并成一段。
pub const AUTO_MERGE_GAP_SECONDS: f64 = 1.0;
/// 自动缩放：短于这么久（秒）的区间丢掉。
pub const AUTO_MIN_SECONDS: f64 = 1.0;
/// 自动缩放的倍率。
pub const AUTO_SCALE: f64 = 2.0;

pub type Rect = [f64; 4];

/// 求不了值的原因（英文短语，给开发者看；调用方放进自己的消息里）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SolveError {
    /// 正文读不出来，或 `solver` 不是这一版认得的。
    Body(String),
    UnsupportedSolver(u32),
    /// `clock: 'recording'` 却没有可读的清单。
    ManifestMissing,
    /// 实例的素材不是清单里的一路屏幕流（录制时间对不上）。
    NotAScreenStream,
}

impl std::fmt::Display for SolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SolveError::Body(e) => write!(f, "the screen view body cannot be read: {e}"),
            SolveError::UnsupportedSolver(v) => write!(f, "solver version {v} is not supported"),
            SolveError::ManifestMissing => write!(f, "the recording manifest cannot be read"),
            SolveError::NotAScreenStream => write!(f, "the clip's asset is not a screen stream of the recording"),
        }
    }
}

/// 一路指针流，换到了录制时间（秒）上：只留落在它那一段里的事件。
#[derive(Clone, Debug)]
struct PointerStream {
    /// 所在的段 `[t0, t1)`。
    segment: (f64, f64),
    t: Vec<f64>,
    x: Vec<f64>,
    y: Vec<f64>,
    /// 到第 i 个样本为止，位置最后一次变化的时刻（第一个样本算一次变化）。
    moved: Vec<f64>,
    /// 位置对时间的积分，从第一个样本起到第 i 个样本（梯形）：平滑光标用。
    ix: Vec<f64>,
    iy: Vec<f64>,
    /// 主键按下的时刻。
    downs: Vec<f64>,
    /// 光标外观的切换。
    cursors: Vec<(f64, String)>,
}

impl PointerStream {
    fn new(track: &PointerTrack, start: f64, segment: (f64, f64)) -> PointerStream {
        let scale = track.timescale as f64;
        let at = |tick: u64| start + tick as f64 / scale;
        let inside = |t: f64| t >= segment.0 && t < segment.1;
        let mut stream = PointerStream {
            segment,
            t: Vec::new(),
            x: Vec::new(),
            y: Vec::new(),
            moved: Vec::new(),
            ix: Vec::new(),
            iy: Vec::new(),
            downs: Vec::new(),
            cursors: Vec::new(),
        };
        for &(tick, x, y) in &track.moves {
            let t = at(tick);
            if !inside(t) {
                continue;
            }
            let moved = match (stream.x.last(), stream.y.last(), stream.moved.last()) {
                (Some(&px), Some(&py), Some(&m)) if px == x && py == y => m,
                _ => t,
            };
            if let (Some(&pt), Some(&px), Some(&py), Some(&sx), Some(&sy)) =
                (stream.t.last(), stream.x.last(), stream.y.last(), stream.ix.last(), stream.iy.last())
            {
                stream.ix.push(sx + (t - pt) * (px + x) / 2.0);
                stream.iy.push(sy + (t - pt) * (py + y) / 2.0);
            } else {
                stream.ix.push(0.0);
                stream.iy.push(0.0);
            }
            stream.t.push(t);
            stream.x.push(x);
            stream.y.push(y);
            stream.moved.push(moved);
        }
        stream.downs = track
            .buttons
            .iter()
            .filter(|b| b.1 == 0 && b.2 == 1)
            .map(|b| at(b.0))
            .filter(|t| inside(*t))
            .collect();
        stream.cursors = track
            .cursors
            .iter()
            .map(|(tick, id)| (at(*tick), id.clone()))
            .filter(|(t, _)| inside(*t))
            .collect();
        stream
    }

    fn contains(&self, t: f64) -> bool {
        t >= self.segment.0 && t < self.segment.1
    }

    /// 最后一个不晚于 `t` 的样本。
    fn last_at(&self, t: f64) -> Option<usize> {
        let n = self.t.partition_point(|&s| s <= t);
        n.checked_sub(1)
    }

    /// 录下来的位置：相邻样本之间线性插值，最后一个样本之后停在它上面；第一个样本之前没有。
    fn position(&self, t: f64) -> Option<(f64, f64)> {
        let i = self.last_at(t)?;
        match self.t.get(i + 1) {
            Some(&t1) if t1 > self.t[i] => {
                let u = (t - self.t[i]) / (t1 - self.t[i]);
                Some((self.x[i] + (self.x[i + 1] - self.x[i]) * u, self.y[i] + (self.y[i + 1] - self.y[i]) * u))
            }
            _ => Some((self.x[i], self.y[i])),
        }
    }

    /// 位置从第一个样本起到 `t` 的积分（`t` 不早于第一个样本）。
    fn integral(&self, t: f64) -> (f64, f64) {
        let Some(i) = self.last_at(t) else { return (0.0, 0.0) };
        let (x, y) = self.position(t).unwrap_or((self.x[i], self.y[i]));
        let dt = t - self.t[i];
        (self.ix[i] + dt * (self.x[i] + x) / 2.0, self.iy[i] + dt * (self.y[i] + y) / 2.0)
    }

    /// 平滑过的位置：`[t − w, t + w]` 与「第一个样本到段尾」的交集上的平均。
    fn smoothed(&self, t: f64, w: f64) -> Option<(f64, f64)> {
        let raw = self.position(t)?;
        if w <= 0.0 {
            return Some(raw);
        }
        let a = (t - w).max(self.t[0]);
        let b = (t + w).min(self.segment.1);
        if b - a <= 1e-12 {
            return Some(raw);
        }
        let (ax, ay) = self.integral(a);
        let (bx, by) = self.integral(b);
        Some(((bx - ax) / (b - a), (by - ay) / (b - a)))
    }
}

/// 一段区间的跟随路径：网格上的镜头中心（已限制在画面里），网格从 `t0` 起，步长 `1 / FOLLOW_GRID_HZ`。
#[derive(Clone, Debug)]
struct FollowPath {
    t0: f64,
    cx: Vec<f64>,
    cy: Vec<f64>,
    /// 中心对时间的积分（梯形，按网格），平滑用。
    ix: Vec<f64>,
    iy: Vec<f64>,
}

impl FollowPath {
    fn step() -> f64 {
        1.0 / FOLLOW_GRID_HZ
    }

    /// 网格上的值，网格两端之外停在端点上。
    fn at(&self, t: f64) -> (f64, f64) {
        let n = self.cx.len();
        let f = (t - self.t0) * FOLLOW_GRID_HZ;
        if f <= 0.0 {
            return (self.cx[0], self.cy[0]);
        }
        let i = f.floor() as usize;
        if i + 1 >= n {
            return (self.cx[n - 1], self.cy[n - 1]);
        }
        let u = f - i as f64;
        (self.cx[i] + (self.cx[i + 1] - self.cx[i]) * u, self.cy[i] + (self.cy[i + 1] - self.cy[i]) * u)
    }

    /// 从网格起点到 `t` 的积分；起点之前、终点之后按端点的值延伸。
    fn integral(&self, t: f64) -> (f64, f64) {
        let n = self.cx.len();
        let end = self.t0 + (n - 1) as f64 * Self::step();
        if t <= self.t0 {
            return ((t - self.t0) * self.cx[0], (t - self.t0) * self.cy[0]);
        }
        if t >= end {
            return (self.ix[n - 1] + (t - end) * self.cx[n - 1], self.iy[n - 1] + (t - end) * self.cy[n - 1]);
        }
        let i = ((t - self.t0) * FOLLOW_GRID_HZ).floor() as usize;
        let ti = self.t0 + i as f64 * Self::step();
        let (x, y) = self.at(t);
        let dt = t - ti;
        (self.ix[i] + dt * (self.cx[i] + x) / 2.0, self.iy[i] + dt * (self.cy[i] + y) / 2.0)
    }

    /// 平滑过的中心：`[t − s, t + s]` 上的平均。
    fn smoothed(&self, t: f64, s: f64) -> (f64, f64) {
        if s <= 0.0 {
            return self.at(t);
        }
        let (ax, ay) = self.integral(t - s);
        let (bx, by) = self.integral(t + s);
        ((bx - ax) / (2.0 * s), (by - ay) / (2.0 * s))
    }
}

/// 一个缩放区间，换到了内容时钟的秒上，过渡已经按缺省补齐。
#[derive(Clone, Debug)]
struct Region {
    t0: f64,
    t1: f64,
    scale: f64,
    focus: ZoomFocus,
    ramp_in: f64,
    ramp_out: f64,
    /// 前一个区间的终点就是这一个的起点：开头的过渡从前一个的取景开始，不回到全景。
    joins_previous: bool,
}

/// 这一刻的光标。
#[derive(Clone, Debug, PartialEq)]
pub struct CursorState {
    /// 画出来的位置（热点所在处，已平滑）。
    pub x: f64,
    pub y: f64,
    pub cursor: PointerCursor,
    /// 静止隐去时淡出的不透明度，(0, 1]。
    pub opacity: f64,
}

/// 这一刻在散开的一圈点击提示。
#[derive(Clone, Debug, PartialEq)]
pub struct ClickState {
    pub x: f64,
    pub y: f64,
    /// 按下之后过了多久，占提示时长的比例，[0, 1)。
    pub progress: f64,
}

/// 光标与点击提示怎样画：倍率与颜色。
#[derive(Clone, Debug, PartialEq)]
pub struct PointerLook {
    /// `pointer.size`。
    pub size: f64,
    /// 点击提示的颜色 `#RRGGBB`；没有点击提示时为 `None`。
    pub click_color: Option<String>,
}

/// 这一刻的取景结果。
#[derive(Clone, Debug, PartialEq)]
pub struct ScreenViewFrame {
    /// 可见区域 V：与裁剪 C 同宽高比，在 C 之内。
    pub view: Rect,
    pub cursor: Option<CursorState>,
    pub clicks: Vec<ClickState>,
}

/// 求值器：读好了的文档、清单与指针轨，加上按裁剪缓存的跟随路径。
#[derive(Clone, Debug)]
pub struct ScreenViewSolver {
    clock_recording: bool,
    regions: Vec<Region>,
    safe_area: f64,
    follow_smoothing: f64,
    /// 另画的光标：只在清单的鼠标模式是 `separate`、文档没有隐藏光标时有。
    draw_pointer: bool,
    pointer_smoothing: f64,
    idle_hide: Option<f64>,
    look: PointerLook,
    cursors: Vec<PointerCursor>,
    streams: Vec<PointerStream>,
    /// 屏幕流：素材版本 → (`start` 秒, 捕获画面)。
    screens: Vec<(VersionRef, f64, Option<Capture>)>,
    paths: HashMap<(usize, [u64; 4]), Arc<FollowPath>>,
}

/// 一路指针流的指针轨（按清单里流的 ID）。
pub type PointerTracks<'a> = &'a HashMap<String, Arc<PointerTrack>>;

impl ScreenViewSolver {
    /// 读一份取景文档。`clock: 'recording'` 要有清单；`tracks` 是清单里各路指针流的指针轨（按流的 ID），缺的那路当作
    /// 没有指针。
    pub fn new(body: &ScreenViewBody, manifest: Option<&RecordingBody>, tracks: PointerTracks<'_>) -> Result<ScreenViewSolver, SolveError> {
        if body.solver != SCREEN_VIEW_SOLVER {
            return Err(SolveError::UnsupportedSolver(body.solver));
        }
        let clock_recording = match body.clock.as_str() {
            CLOCK_RECORDING => true,
            CLOCK_SOURCE_ASSET => false,
            other => return Err(SolveError::Body(format!("unknown clock {other}"))),
        };
        if body.timescale == 0 {
            return Err(SolveError::Body("timescale must be positive".into()));
        }
        let manifest = if clock_recording { Some(manifest.ok_or(SolveError::ManifestMissing)?) } else { None };
        let seconds = |text: &str| ticks(text).map(|t| t as f64 / body.timescale as f64);
        let mut regions: Vec<Region> = Vec::new();
        for zoom in &body.zooms {
            let (Some(t0), Some(t1)) = (seconds(&zoom.t0), seconds(&zoom.t1)) else {
                return Err(SolveError::Body(format!("zoom {} has invalid ticks", zoom.id)));
            };
            if t1 <= t0 || !zoom.scale.is_finite() || zoom.scale <= 1.0 {
                return Err(SolveError::Body(format!("zoom {} is not a valid region", zoom.id)));
            }
            let given = |ramp: &Option<String>| ramp.as_deref().map(|r| seconds(r).unwrap_or(0.0).max(0.0));
            let (ramp_in, ramp_out) = default_ramps(t1 - t0, given(&zoom.ramp_in), given(&zoom.ramp_out));
            let joins_previous = regions.last().is_some_and(|r| r.t1 == t0);
            if joins_previous && let Some(previous) = regions.last_mut() {
                // 接着下一个区间：结尾不回到全景，由下一个区间的开头过渡过去。
                previous.ramp_out = 0.0;
            }
            regions.push(Region {
                t0,
                t1,
                scale: zoom.scale.min(crate::screen_view::ZOOM_SCALE_MAX),
                focus: zoom.focus.clone(),
                ramp_in,
                ramp_out,
                joins_previous,
            });
        }
        let follow = body.follow.as_ref();
        let pointer = body.pointer.as_ref();
        let mut streams = Vec::new();
        let mut screens = Vec::new();
        let mut cursors = Vec::new();
        let mut draw_pointer = false;
        if let Some(manifest) = manifest {
            let mt = manifest.timescale.max(1) as f64;
            let segment = |id: &str| {
                manifest
                    .segments
                    .iter()
                    .find(|s| s.id == id)
                    .and_then(|s| Some((ticks(&s.t0)? as f64 / mt, ticks(&s.t1)? as f64 / mt)))
            };
            for stream in &manifest.streams {
                let start = ticks(&stream.start).unwrap_or(0) as f64 / mt;
                match stream.role {
                    StreamRole::Screen => screens.push((stream.asset_ref.clone(), start, stream.capture.clone())),
                    StreamRole::Pointer if manifest.pointer.mode != PointerMode::None => {
                        if let (Some(track), Some(range)) = (tracks.get(&stream.id), segment(&stream.segment_id)) {
                            streams.push(PointerStream::new(track, start, range));
                        }
                    }
                    _ => {}
                }
            }
            streams.sort_by(|a, b| a.segment.0.total_cmp(&b.segment.0));
            draw_pointer = manifest.pointer.mode == PointerMode::Separate && !pointer.is_some_and(|p| p.hidden);
            cursors = manifest.pointer.cursors.clone();
        }
        Ok(ScreenViewSolver {
            clock_recording,
            regions,
            safe_area: follow.and_then(|f| f.safe_area).unwrap_or(DEFAULT_SAFE_AREA).clamp(0.0, 0.999),
            follow_smoothing: follow.and_then(|f| f.smoothing).unwrap_or(DEFAULT_FOLLOW_SMOOTHING).clamp(0.0, 1.0),
            draw_pointer,
            pointer_smoothing: pointer.and_then(|p| p.smoothing).unwrap_or(0.0).clamp(0.0, 1.0),
            idle_hide: pointer
                .and_then(|p| p.idle_hide.as_deref())
                .and_then(seconds)
                .filter(|s| *s > 0.0),
            look: PointerLook {
                size: pointer.and_then(|p| p.size).unwrap_or(1.0),
                click_color: pointer
                    .and_then(|p| p.click.as_ref())
                    .map(|c| c.color.clone().unwrap_or_else(|| DEFAULT_CLICK_COLOR.to_string())),
            },
            cursors,
            streams,
            screens,
            paths: HashMap::new(),
        })
    }

    pub fn look(&self) -> &PointerLook {
        &self.look
    }

    /// 实例的源时刻 `source_seconds`（已经过 timeMap，§2.5）换成文档的时钟：录制时间是这路屏幕流的 `start + s`，
    /// 素材源时钟就是 `s`。实例的素材不是清单里的一路屏幕流时报错。
    pub fn content_seconds(&self, asset: &VersionRef, source_seconds: f64) -> Result<f64, SolveError> {
        if !self.clock_recording {
            return Ok(source_seconds);
        }
        self.screens
            .iter()
            .find(|(r, _, _)| r == asset)
            .map(|(_, start, _)| start + source_seconds)
            .ok_or(SolveError::NotAScreenStream)
    }

    /// 实例的屏幕流的捕获画面（光标与点击提示按它换算大小）；不知道时为 `None`。
    pub fn capture(&self, asset: &VersionRef) -> Option<&Capture> {
        self.screens.iter().find(|(r, _, _)| r == asset).and_then(|(_, _, c)| c.as_ref())
    }

    /// 文档里最大的放大倍率（没有区间时是 1）：预览按它决定要多清楚的源画面。
    pub fn max_scale(&self) -> f64 {
        self.regions.iter().map(|r| r.scale).fold(1.0, f64::max)
    }

    fn stream_at(&self, t: f64) -> Option<&PointerStream> {
        self.streams.iter().find(|s| s.contains(t))
    }

    /// 录下来的指针位置（跟随与点击用）。
    fn raw_position(&self, t: f64) -> Option<(f64, f64)> {
        self.stream_at(t)?.position(t)
    }

    /// 内容时刻 `t`、裁剪 `crop`（`[u0, v0, u1, v1]`，没有裁剪是 `[0, 0, 1, 1]`）时的取景与光标。
    pub fn frame(&mut self, t: f64, crop: Rect) -> ScreenViewFrame {
        let view = self.view(t, crop);
        let (cursor, clicks) = self.pointer(t, view);
        ScreenViewFrame { view, cursor, clicks }
    }

    /// 这一刻的可见区域 V。
    pub fn view(&mut self, t: f64, crop: Rect) -> Rect {
        let index = self.regions.partition_point(|r| r.t0 <= t);
        let Some(i) = index.checked_sub(1).filter(|&i| t < self.regions[i].t1) else {
            return crop;
        };
        let region = self.regions[i].clone();
        let target = self.target(i, t, crop);
        if region.ramp_in > 0.0 && t < region.t0 + region.ramp_in {
            let from = if region.joins_previous { self.target(i - 1, t, crop) } else { crop };
            return interpolate(from, target, smoothstep((t - region.t0) / region.ramp_in));
        }
        if region.ramp_out > 0.0 && t >= region.t1 - region.ramp_out {
            return interpolate(crop, target, smoothstep((region.t1 - t) / region.ramp_out));
        }
        target
    }

    /// 区间 `i` 放大到底时的可见区域（过渡之外的样子）。区间之后的一小段（下一个区间开头的过渡）照样取得到。
    fn target(&mut self, i: usize, t: f64, crop: Rect) -> Rect {
        let region = &self.regions[i];
        let (cw, ch) = (crop[2] - crop[0], crop[3] - crop[1]);
        let (w, h) = (cw / region.scale, ch / region.scale);
        let center = match region.focus {
            ZoomFocus::Point { x, y } => (x, y),
            ZoomFocus::Pointer => {
                let path = self.path(i, crop);
                path.smoothed(t, self.follow_smoothing * FOLLOW_SMOOTHING_SECONDS)
            }
        };
        let x0 = (center.0 - w / 2.0).clamp(crop[0], crop[2] - w);
        let y0 = (center.1 - h / 2.0).clamp(crop[1], crop[3] - h);
        [x0, y0, x0 + w, y0 + h]
    }

    /// 区间 `i` 在裁剪 `crop` 下的跟随路径（缓存）。
    fn path(&mut self, i: usize, crop: Rect) -> Arc<FollowPath> {
        let key = (i, crop.map(f64::to_bits));
        if let Some(path) = self.paths.get(&key) {
            return path.clone();
        }
        let region = &self.regions[i];
        // 路径要盖到下一个区间开头的过渡结束：那一段从这个区间的取景过渡过去。
        let end = match self.regions.get(i + 1) {
            Some(next) if next.joins_previous => region.t1 + next.ramp_in,
            _ => region.t1,
        } + self.follow_smoothing * FOLLOW_SMOOTHING_SECONDS;
        let (cw, ch) = (crop[2] - crop[0], crop[3] - crop[1]);
        let (w, h) = (cw / region.scale, ch / region.scale);
        // 安全区：中心两侧各 safeArea × V / 2 之内，镜头不动。
        let (hx, hy) = (self.safe_area * w / 2.0, self.safe_area * h / 2.0);
        let bounds_x = (crop[0] + w / 2.0, crop[2] - w / 2.0);
        let bounds_y = (crop[1] + h / 2.0, crop[3] - h / 2.0);
        let t0 = region.t0;
        let steps = (((end - t0) * FOLLOW_GRID_HZ).ceil() as usize).max(1);
        let at = |n: usize| t0 + n as f64 / FOLLOW_GRID_HZ;
        let start = (0..=steps)
            .find_map(|n| self.raw_position(at(n)))
            .unwrap_or(((crop[0] + crop[2]) / 2.0, (crop[1] + crop[3]) / 2.0));
        let mut c = (start.0.clamp(bounds_x.0, bounds_x.1), start.1.clamp(bounds_y.0, bounds_y.1));
        let mut path = FollowPath {
            t0,
            cx: Vec::with_capacity(steps + 1),
            cy: Vec::with_capacity(steps + 1),
            ix: Vec::with_capacity(steps + 1),
            iy: Vec::with_capacity(steps + 1),
        };
        for n in 0..=steps {
            if let Some((px, py)) = self.raw_position(at(n)) {
                c.0 = c.0.clamp(px - hx, px + hx).clamp(bounds_x.0, bounds_x.1);
                c.1 = c.1.clamp(py - hy, py + hy).clamp(bounds_y.0, bounds_y.1);
            }
            let (sx, sy) = match (path.cx.last(), path.cy.last(), path.ix.last(), path.iy.last()) {
                (Some(&px), Some(&py), Some(&ix), Some(&iy)) => (ix + (px + c.0) / (2.0 * FOLLOW_GRID_HZ), iy + (py + c.1) / (2.0 * FOLLOW_GRID_HZ)),
                _ => (0.0, 0.0),
            };
            path.cx.push(c.0);
            path.cy.push(c.1);
            path.ix.push(sx);
            path.iy.push(sy);
        }
        let path = Arc::new(path);
        self.paths.insert(key, path.clone());
        path
    }

    /// 这一刻的光标与点击提示。指针在捕获画面之外、或落在 V 之外时不画。
    fn pointer(&self, t: f64, view: Rect) -> (Option<CursorState>, Vec<ClickState>) {
        if !self.draw_pointer {
            return (None, Vec::new());
        }
        let Some(stream) = self.stream_at(t) else {
            return (None, Vec::new());
        };
        let visible = |x: f64, y: f64| (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y) && x >= view[0] && x <= view[2] && y >= view[1] && y <= view[3];
        let mut clicks = Vec::new();
        if self.look.click_color.is_some() {
            let from = stream.downs.partition_point(|&d| d <= t - CLICK_SECONDS);
            for &down in &stream.downs[from..] {
                if down > t {
                    break;
                }
                if let Some((x, y)) = stream.position(down)
                    && visible(x, y)
                {
                    clicks.push(ClickState {
                        x,
                        y,
                        progress: (t - down) / CLICK_SECONDS,
                    });
                }
            }
        }
        let cursor = (|| {
            let (x, y) = stream.smoothed(t, self.pointer_smoothing * POINTER_SMOOTHING_SECONDS)?;
            if !visible(x, y) {
                return None;
            }
            let n = stream.cursors.partition_point(|(s, _)| *s <= t);
            let id = &stream.cursors.get(n.checked_sub(1)?)?.1;
            let cursor = self.cursors.iter().find(|c| &c.id == id)?.clone();
            let opacity = match self.idle_hide {
                Some(idle) => {
                    let moved = stream.moved[stream.last_at(t)?];
                    1.0 - ((t - moved - idle) / IDLE_FADE_SECONDS).clamp(0.0, 1.0)
                }
                None => 1.0,
            };
            (opacity > 0.0).then_some(CursorState { x, y, cursor, opacity })
        })();
        (cursor, clicks)
    }
}

/// 两侧的过渡长度：给了的照用（核对保证两者之和不超过区间），省略的取缺省，放不下时省略的一侧取剩下的长度
/// （两侧都省略时各取一半）。
fn default_ramps(length: f64, ramp_in: Option<f64>, ramp_out: Option<f64>) -> (f64, f64) {
    match (ramp_in, ramp_out) {
        (Some(a), Some(b)) => (a, b),
        (Some(a), None) => (a, DEFAULT_RAMP_SECONDS.min((length - a).max(0.0))),
        (None, Some(b)) => (DEFAULT_RAMP_SECONDS.min((length - b).max(0.0)), b),
        (None, None) => {
            let each = DEFAULT_RAMP_SECONDS.min(length / 2.0);
            (each, each)
        }
    }
}

/// 过渡的曲线：`3u² − 2u³`。
pub fn smoothstep(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    u * u * (3.0 - 2.0 * u)
}

/// 两个同宽高比的矩形之间的过渡（`e` 是曲线之后的进度）：绕一个不动点缩放，宽高按几何插值，所以放大的速度看起来
/// 均匀、画面里的点沿直线走。两者一样大时是平移。两个矩形都在 C 之内时，中间的每一个也在。
pub fn interpolate(a: Rect, b: Rect, e: f64) -> Rect {
    let (aw, ah) = (a[2] - a[0], a[3] - a[1]);
    let bw = b[2] - b[0];
    if aw <= 0.0 || ah <= 0.0 {
        return b;
    }
    let r = bw / aw;
    if (r - 1.0).abs() < 1e-9 {
        let x0 = a[0] + (b[0] - a[0]) * e;
        let y0 = a[1] + (b[1] - a[1]) * e;
        return [x0, y0, x0 + aw, y0 + ah];
    }
    let g = r.powf(e);
    let px = (b[0] - r * a[0]) / (1.0 - r);
    let py = (b[1] - r * a[1]) / (1.0 - r);
    let x0 = px + (a[0] - px) * g;
    let y0 = py + (a[1] - py) * g;
    [x0, y0, x0 + aw * g, y0 + ah * g]
}

/// 自动缩放（屏幕录制设计 §6）：读有效录制区间里主键的按下，每次按下前留 [`AUTO_BEFORE_SECONDS`]、后留
/// [`AUTO_AFTER_SECONDS`]，空隙不到 [`AUTO_MERGE_GAP_SECONDS`] 的并成一段，短于 [`AUTO_MIN_SECONDS`] 的丢掉；结果是
/// `origin: 'auto'`、跟着指针、倍率 [`AUTO_SCALE`]、过渡取缺省的区间。
///
/// `existing` 是文档里已有的区间：`manual` 与改过的 `auto`（`edited`）原样保留，没改过的 `auto` 被新生成的替换；新生成的
/// 与保留的重叠时让开保留的（切掉重叠的部分，剩下的短于下限就丢掉）。`timescale` 是取景文档的刻度；`new_id` 给新区间
/// 起 ID（与已有区间重名的跳过）；与被替换的某段完全相同的区间沿用那一段的 ID。清单的鼠标模式是 `none`（没有指针轨）时不生成，只留保留的区间。
pub fn auto_zooms(
    manifest: &RecordingBody,
    tracks: PointerTracks<'_>,
    timescale: u64,
    existing: &[ZoomRegion],
    mut new_id: impl FnMut() -> Id,
) -> Vec<ZoomRegion> {
    let kept: Vec<ZoomRegion> = existing.iter().filter(|z| z.origin == ZoomOrigin::Manual || z.edited).cloned().collect();
    let ts = timescale.max(1) as f64;
    let mt = manifest.timescale.max(1) as f64;
    let to_ticks = |s: f64| (s * ts).round() as i128;
    let kept_ranges: Vec<(i128, i128)> = kept.iter().filter_map(|z| Some((ticks(&z.t0)?, ticks(&z.t1)?))).collect();

    let mut generated: Vec<(i128, i128)> = Vec::new();
    if manifest.pointer.mode != PointerMode::None {
        let duration = ticks(&manifest.duration).unwrap_or(0) as f64 / mt;
        let mut downs: Vec<f64> = Vec::new();
        for stream in manifest.streams.iter().filter(|s| s.role == StreamRole::Pointer) {
            let Some(track) = tracks.get(&stream.id) else { continue };
            let Some(segment) = manifest
                .segments
                .iter()
                .find(|s| s.id == stream.segment_id)
                .and_then(|s| Some((ticks(&s.t0)? as f64 / mt, ticks(&s.t1)? as f64 / mt)))
            else {
                continue;
            };
            let start = ticks(&stream.start).unwrap_or(0) as f64 / mt;
            let coverage: Option<Vec<(f64, f64)>> = stream.coverage.as_ref().map(|c| {
                c.iter()
                    .filter_map(|r| Some((ticks(&r.t0)? as f64 / mt, ticks(&r.t1)? as f64 / mt)))
                    .collect()
            });
            downs.extend(PointerStream::new(track, start, segment).downs.into_iter().filter(|t| {
                coverage.as_ref().is_none_or(|ranges| ranges.iter().any(|(a, b)| t >= a && t < b))
            }));
        }
        downs.sort_by(f64::total_cmp);
        let mut spans: Vec<(f64, f64)> = Vec::new();
        for down in downs {
            let (a, b) = ((down - AUTO_BEFORE_SECONDS).max(0.0), (down + AUTO_AFTER_SECONDS).min(duration));
            match spans.last_mut() {
                Some(last) if a - last.1 < AUTO_MERGE_GAP_SECONDS => last.1 = last.1.max(b),
                _ => spans.push((a, b)),
            }
        }
        let min = to_ticks(AUTO_MIN_SECONDS);
        for (a, b) in spans {
            // 让开保留的区间：切掉重叠的部分。
            let mut pieces = vec![(to_ticks(a), to_ticks(b))];
            for &(k0, k1) in &kept_ranges {
                pieces = pieces
                    .into_iter()
                    .flat_map(|(p0, p1)| {
                        if k1 <= p0 || k0 >= p1 {
                            vec![(p0, p1)]
                        } else {
                            [(p0, k0.min(p1)), (k1.max(p0), p1)].into_iter().filter(|(x, y)| y > x).collect()
                        }
                    })
                    .collect();
            }
            generated.extend(pieces.into_iter().filter(|(p0, p1)| p1 - p0 >= min));
        }
    }

    let taken: std::collections::HashSet<Id> = existing.iter().map(|z| z.id.clone()).collect();
    let mut fresh_id = || loop {
        let id = new_id();
        if !taken.contains(&id) {
            break id;
        }
    };
    let mut zooms = kept;
    zooms.extend(generated.into_iter().map(|(t0, t1)| {
        let region = ZoomRegion {
            id: String::new(),
            t0: t0.to_string(),
            t1: t1.to_string(),
            scale: AUTO_SCALE,
            focus: ZoomFocus::Pointer,
            origin: ZoomOrigin::Auto,
            edited: false,
            ramp_in: None,
            ramp_out: None,
        };
        // 与被替换的一段一模一样：沿用它的 ID，重新生成没有变化时文档不变。
        match existing.iter().find(|z| z.origin == ZoomOrigin::Auto && !z.edited && ZoomRegion { id: String::new(), ..(*z).clone() } == region) {
            Some(same) => same.clone(),
            None => ZoomRegion { id: fresh_id(), ..region },
        }
    }));
    zooms.sort_by_key(|z| ticks(&z.t0).unwrap_or(0));
    zooms
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    const EPS: f64 = 1e-9;

    fn manifest(mode: &str) -> RecordingBody {
        let mut body = json!({
            "schema": "baocut.recording/1", "timescale": 1000, "clock": "recording", "recorder": { "name": "test" },
            "duration": "20000",
            "segments": [{ "id": "s0", "t0": "0", "t1": "12000" }, { "id": "s1", "t0": "12000", "t1": "20000" }],
            "streams": [
                { "id": "screen0", "role": "screen", "segmentId": "s0", "assetRef": { "id": "scr", "revision": "1" }, "start": "-500",
                  "capture": { "kind": "display", "width": 1000, "height": 500, "scale": 2.0 } },
                { "id": "ptr0", "role": "pointer", "segmentId": "s0", "assetRef": { "id": "ptr", "revision": "1" }, "start": "0" },
                { "id": "screen1", "role": "screen", "segmentId": "s1", "assetRef": { "id": "scr", "revision": "2" }, "start": "12000" }
            ],
            "pointer": { "mode": mode, "cursors": [{ "id": "arrow", "assetRef": { "id": "cur", "revision": "1" }, "hotspot": { "x": 0.0, "y": 0.0 } }] }
        });
        if mode != "separate" {
            body["pointer"] = json!({ "mode": mode });
        }
        if mode == "none" {
            body["streams"].as_array_mut().unwrap().remove(1);
        }
        serde_json::from_value(body).unwrap()
    }

    /// 指针轨：0–2 秒停在 (0.2, 0.2)，2–3 秒移到 (0.9, 0.8)，之后停住；4 秒按一次主键。
    fn track() -> HashMap<String, Arc<PointerTrack>> {
        let track = PointerTrack::parse(
            br#"{"format":"baocut-pointer-track","version":1,"timescale":1000,
            "moves":[[0,0.2,0.2],[2000,0.2,0.2],[3000,0.9,0.8],[9000,0.9,0.8],[9500,1.4,0.5]],
            "buttons":[[4000,0,1],[4100,0,0],[6000,1,1]],"cursors":[[0,"arrow"]]}"#,
        )
        .unwrap();
        HashMap::from([("ptr0".to_string(), Arc::new(track))])
    }

    fn body(zooms: Value, extra: Value) -> ScreenViewBody {
        let mut body = json!({ "schema": "baocut.screen-view/1", "timescale": 1000, "clock": "recording", "solver": 1, "zooms": zooms });
        for (k, v) in extra.as_object().unwrap() {
            body[k] = v.clone();
        }
        serde_json::from_value(body).unwrap()
    }

    fn solver(zooms: Value, extra: Value) -> ScreenViewSolver {
        ScreenViewSolver::new(&body(zooms, extra), Some(&manifest("separate")), &track()).unwrap()
    }

    fn point(id: &str, t0: u32, t1: u32, scale: f64, x: f64, y: f64) -> Value {
        json!({ "id": id, "t0": t0.to_string(), "t1": t1.to_string(), "scale": scale,
                "focus": { "kind": "point", "x": x, "y": y }, "origin": "manual" })
    }

    const FULL: Rect = [0.0, 0.0, 1.0, 1.0];

    fn close(a: Rect, b: Rect) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6)
    }

    #[test]
    fn outside_zooms_is_the_whole_crop_and_inside_is_the_scaled_view() {
        let mut s = solver(json!([point("z", 1000, 5000, 2.0, 0.5, 0.5)]), json!({}));
        assert_eq!(s.view(0.5, FULL), FULL);
        assert_eq!(s.view(5.0, FULL), FULL);
        assert!(close(s.view(3.0, FULL), [0.25, 0.25, 0.75, 0.75]));
        // 裁剪之后：V 与 C 同宽高比、在 C 之内。
        let crop = [0.1, 0.0, 0.9, 0.5];
        let v = s.view(3.0, crop);
        assert!(close(v, [0.3, 0.25, 0.7, 0.5]));
    }

    #[test]
    fn ramps_ease_between_the_whole_frame_and_the_zoom() {
        let mut s = solver(json!([point("z", 1000, 5000, 2.0, 0.5, 0.5)]), json!({}));
        // 缺省过渡 0.5 秒：开头从全景出发、结尾回到全景，中点放大到 √2（几何插值），曲线是 smoothstep。
        assert!(close(s.view(1.0, FULL), FULL));
        let mid = s.view(1.25, FULL);
        assert!(((mid[2] - mid[0]) - 1.0 / 2f64.sqrt()).abs() < 1e-9);
        let late = s.view(1.4, FULL);
        assert!((late[2] - late[0] - 0.5f64.powf(smoothstep(0.8))).abs() < 1e-9);
        assert!(close(s.view(1.5, FULL), [0.25, 0.25, 0.75, 0.75]));
        let out = s.view(4.75, FULL);
        assert!(((out[2] - out[0]) - 1.0 / 2f64.sqrt()).abs() < 1e-9);
        // 0 是直接切过去；太短的区间两侧各取一半。
        let mut cut = solver(json!([{ "id": "z", "t0": "1000", "t1": "2000", "scale": 4.0, "focus": { "kind": "point", "x": 0.5, "y": 0.5 },
            "origin": "manual", "rampIn": "0", "rampOut": "0" }]), json!({}));
        assert!(close(cut.view(1.0, FULL), [0.375, 0.375, 0.625, 0.625]));
        let mut short = solver(json!([point("z", 1000, 1600, 2.0, 0.5, 0.5)]), json!({}));
        assert!(close(short.view(1.3, FULL), [0.25, 0.25, 0.75, 0.75]));
        assert_eq!(default_ramps(0.6, None, None), (0.3, 0.3));
        assert_eq!(default_ramps(0.6, Some(0.4), None), (0.4, 0.19999999999999996));
    }

    #[test]
    fn adjacent_zooms_go_straight_from_one_view_to_the_next() {
        let mut s = solver(json!([point("a", 1000, 3000, 2.0, 0.25, 0.25), point("b", 3000, 6000, 2.0, 0.75, 0.75)]), json!({}));
        // a 的结尾不回到全景；b 的开头从 a 的取景平移过去（同样大小）。
        assert!(close(s.view(2.9, FULL), [0.0, 0.0, 0.5, 0.5]));
        let mid = s.view(3.25, FULL);
        assert!(close(mid, [0.25, 0.25, 0.75, 0.75]));
        assert!(close(s.view(3.5, FULL), [0.5, 0.5, 1.0, 1.0]));
        // 不同倍率：大小沿几何插值变，始终不出画面。
        let mut z = solver(json!([point("a", 1000, 3000, 2.0, 0.0, 0.0), point("b", 3000, 6000, 4.0, 1.0, 1.0)]), json!({}));
        for k in 0..=50 {
            let v = z.view(3.0 + k as f64 * 0.01, FULL);
            assert!(v[0] >= -EPS && v[1] >= -EPS && v[2] <= 1.0 + EPS && v[3] <= 1.0 + EPS, "{v:?}");
        }
    }

    #[test]
    fn a_focus_on_the_edge_pins_the_view_to_the_crop_edge() {
        let mut s = solver(json!([point("z", 0, 5000, 4.0, 0.0, 1.0)]), json!({}));
        assert!(close(s.view(2.0, FULL), [0.0, 0.75, 0.25, 1.0]));
        // 焦点落在裁剪之外：贴着 C 的边。
        let crop = [0.2, 0.2, 0.8, 0.8];
        assert!(close(s.view(2.0, crop), [0.2, 0.65, 0.35, 0.8]));
    }

    #[test]
    fn following_the_pointer_holds_still_inside_the_safe_area() {
        let zoom = json!([{ "id": "z", "t0": "0", "t1": "8000", "scale": 2.0, "focus": { "kind": "pointer" }, "origin": "auto" }]);
        let mut s = solver(zoom.clone(), json!({ "follow": { "safeArea": 0.5, "smoothing": 0 } }));
        // 开头对着指针（贴边限制住）：(0.2, 0.2) → V 贴左上角。
        assert!(close(s.view(1.0, FULL), [0.0, 0.0, 0.5, 0.5]));
        // 指针走到 (0.9, 0.8)：越出安全区，镜头跟过去；横向贴着右边，纵向停在指针离安全区上沿正好 0.125 处。
        assert!(close(s.view(5.0, FULL), [0.5, 0.425, 1.0, 0.925]));
        // 随机取值与顺序取值相同；换一个新的求值器（没有缓存）也相同。
        let forward: Vec<Rect> = (0..800).map(|k| s.view(k as f64 * 0.01, FULL)).collect();
        let mut fresh = solver(zoom.clone(), json!({ "follow": { "safeArea": 0.5, "smoothing": 0 } }));
        for k in (0..800).rev().step_by(7) {
            assert_eq!(fresh.view(k as f64 * 0.01, FULL), forward[k]);
        }
        // 平滑：镜头的移动比紧跟慢，但最后停在同一处。
        let mut smooth = solver(zoom, json!({ "follow": { "safeArea": 0.5, "smoothing": 1 } }));
        let (a, b) = (s.view(2.6, FULL), smooth.view(2.6, FULL));
        assert!(a[0] != b[0]);
        assert!(close(smooth.view(6.0, FULL), [0.5, 0.425, 1.0, 0.925]));
        for k in 0..800 {
            let v = smooth.view(k as f64 * 0.01, FULL);
            assert!(v[0] >= -EPS && v[2] <= 1.0 + EPS, "{v:?}");
        }
    }

    #[test]
    fn the_safe_area_keeps_the_camera_still_for_small_moves() {
        let track = PointerTrack::parse(
            br#"{"format":"baocut-pointer-track","version":1,"timescale":1000,
            "moves":[[0,0.5,0.5],[1000,0.55,0.52],[2000,0.45,0.48],[3000,0.5,0.5]],"buttons":[],"cursors":[]}"#,
        )
        .unwrap();
        let tracks = HashMap::from([("ptr0".to_string(), Arc::new(track))]);
        let zoom = json!([{ "id": "z", "t0": "0", "t1": "4000", "scale": 2.0, "focus": { "kind": "pointer" }, "origin": "auto" }]);
        let mut s = ScreenViewSolver::new(&body(zoom, json!({ "follow": { "smoothing": 0 } })), Some(&manifest("separate")), &tracks).unwrap();
        for k in 50..350 {
            assert!(close(s.view(k as f64 * 0.01, FULL), [0.25, 0.25, 0.75, 0.75]));
        }
    }

    #[test]
    fn the_cursor_is_drawn_only_inside_the_capture_and_the_view() {
        let mut s = solver(json!([point("z", 0, 2500, 4.0, 0.9, 0.9)]), json!({}));
        // 指针在 (0.2, 0.2)，可见区域在右下角：不画。
        assert!(s.frame(1.0, FULL).cursor.is_none());
        let full = s.frame(3.0, FULL);
        let cursor = full.cursor.unwrap();
        assert_eq!((cursor.x, cursor.y, cursor.cursor.id.as_str(), cursor.opacity), (0.9, 0.8, "arrow", 1.0));
        // 9.5 秒时指针在捕获画面之外（x = 1.4）：不画，也不夹到边上。
        assert!(s.frame(9.6, FULL).cursor.is_none());
        // 第二段没有指针流：不画。
        assert!(s.frame(13.0, FULL).cursor.is_none());
        // 第一个样本之前没有位置。
        let early = HashMap::from([(
            "ptr0".to_string(),
            Arc::new(PointerTrack::parse(br#"{"format":"baocut-pointer-track","version":1,"timescale":1000,"moves":[[1000,0.5,0.5]],"cursors":[[0,"arrow"]]}"#).unwrap()),
        )]);
        let s = ScreenViewSolver::new(&body(json!([]), json!({})), Some(&manifest("separate")), &early).unwrap();
        assert!(s.pointer(0.5, FULL).0.is_none());
        assert!(s.pointer(1.5, FULL).0.is_some());
    }

    #[test]
    fn baked_and_hidden_pointers_are_not_drawn() {
        let baked = ScreenViewSolver::new(&body(json!([]), json!({})), Some(&manifest("baked")), &track()).unwrap();
        assert!(baked.pointer(3.0, FULL).0.is_none());
        let hidden = solver(json!([]), json!({ "pointer": { "hidden": true, "click": { "effect": "ripple" } } }));
        assert_eq!(hidden.pointer(4.1, FULL), (None, vec![]));
        // 光标录进了画面也可以跟着指针取景。
        let zoom = json!([{ "id": "z", "t0": "0", "t1": "8000", "scale": 2.0, "focus": { "kind": "pointer" }, "origin": "auto" }]);
        let mut baked = ScreenViewSolver::new(&body(zoom, json!({ "follow": { "smoothing": 0 } })), Some(&manifest("baked")), &track()).unwrap();
        assert!(close(baked.view(5.0, FULL), [0.5, 0.425, 1.0, 0.925]));
    }

    #[test]
    fn idle_hide_fades_out_and_clicks_ripple() {
        let s = solver(json!([]), json!({ "pointer": { "idleHide": "1000", "click": { "effect": "ripple" }, "smoothing": 0 } }));
        // 3 秒后不再动：4 秒还在，4.125 秒淡到一半，4.25 秒之后隐去。
        assert_eq!(s.pointer(3.9, FULL).0.unwrap().opacity, 1.0);
        assert!((s.pointer(4.125, FULL).0.unwrap().opacity - 0.5).abs() < 1e-9);
        assert!(s.pointer(4.3, FULL).0.is_none());
        // 4 秒按下主键：0.4 秒的提示，位置是那一刻的指针；辅键不算。
        let (_, clicks) = s.pointer(4.1, FULL);
        assert_eq!(clicks.len(), 1);
        assert!((clicks[0].progress - 0.25).abs() < 1e-9 && clicks[0].x == 0.9);
        assert!(s.pointer(4.4, FULL).1.is_empty());
        assert!(s.pointer(6.1, FULL).1.is_empty());
        assert_eq!(s.look().click_color.as_deref(), Some(DEFAULT_CLICK_COLOR));
    }

    #[test]
    fn pointer_smoothing_averages_the_drawn_path_only() {
        let s = solver(json!([]), json!({ "pointer": { "smoothing": 1 } }));
        let c = s.pointer(2.1, FULL).0.unwrap();
        // 平均窗 [1.85, 2.35]：0.15 秒停在 0.2，0.35 秒从 0.2 匀速走（平均 0.3225），不是录下来的 0.27。
        assert!((c.x - (0.15 * 0.2 + 0.35 * 0.3225) / 0.5).abs() < 1e-9);
        // 点击仍按录下来的位置。
        assert_eq!(s.raw_position(2.5), Some((0.55, 0.5)));
    }

    #[test]
    fn content_time_comes_from_the_screen_stream() {
        let s = solver(json!([]), json!({}));
        assert_eq!(s.content_seconds(&VersionRef { id: "scr".into(), revision: "1".into() }, 1.0), Ok(0.5));
        assert_eq!(s.content_seconds(&VersionRef { id: "scr".into(), revision: "2".into() }, 1.0), Ok(13.0));
        assert_eq!(s.content_seconds(&VersionRef { id: "ptr".into(), revision: "1".into() }, 1.0), Err(SolveError::NotAScreenStream));
        assert_eq!(s.capture(&VersionRef { id: "scr".into(), revision: "1".into() }).map(|c| c.width), Some(1000));
        let plain: ScreenViewBody = serde_json::from_value(json!({ "schema": "baocut.screen-view/1", "timescale": 1000, "clock": "source-asset", "solver": 1, "zooms": [] })).unwrap();
        let plain = ScreenViewSolver::new(&plain, None, &HashMap::new()).unwrap();
        assert_eq!(plain.content_seconds(&VersionRef { id: "any".into(), revision: "1".into() }, 2.5), Ok(2.5));
        let mut two = body(json!([]), json!({}));
        two.solver = 2;
        assert_eq!(ScreenViewSolver::new(&two, Some(&manifest("separate")), &track()).unwrap_err(), SolveError::UnsupportedSolver(2));
        assert_eq!(ScreenViewSolver::new(&body(json!([]), json!({})), None, &track()).unwrap_err(), SolveError::ManifestMissing);
    }

    #[test]
    fn interpolation_is_a_zoom_about_a_fixed_point() {
        let a = FULL;
        let b = [0.5, 0.5, 0.75, 0.75];
        assert!(close(interpolate(a, b, 0.0), a));
        assert!(close(interpolate(a, b, 1.0), b));
        // 不动点 (2/3, 2/3)：中间的矩形都绕它缩放。
        let m = interpolate(a, b, 0.5);
        let p = 2.0 / 3.0;
        assert!(((m[0] - p) / (a[0] - p) - (m[2] - p) / (a[2] - p)).abs() < 1e-9);
    }

    fn ids() -> impl FnMut() -> Id {
        let mut n = 0;
        move || {
            n += 1;
            format!("auto{n}")
        }
    }

    #[test]
    fn auto_zooms_follow_the_clicks_and_regeneration_keeps_edits() {
        let track = PointerTrack::parse(
            br#"{"format":"baocut-pointer-track","version":1,"timescale":1000,"moves":[[0,0.5,0.5]],
            "buttons":[[1000,0,1],[1100,0,0],[2500,0,1],[2600,0,0],[8000,0,1],[8050,0,0],[9000,1,1],[11900,0,1]]}"#,
        )
        .unwrap();
        let tracks = HashMap::from([("ptr0".to_string(), Arc::new(track))]);
        let m = manifest("separate");
        let zooms = auto_zooms(&m, &tracks, 1000, &[], ids());
        let spans: Vec<(&str, &str)> = zooms.iter().map(|z| (z.t0.as_str(), z.t1.as_str())).collect();
        // 1 秒与 2.5 秒的两次点击并成一段；8 秒一段；11.9 秒那段越过段尾也照样延伸（区间在录制时间上，录制长 20 秒）。
        // 辅键不算。
        assert_eq!(spans, [("700", "5000"), ("7700", "10500"), ("11600", "14400")]);
        assert!(zooms.iter().all(|z| z.origin == ZoomOrigin::Auto && z.focus == ZoomFocus::Pointer && z.scale == AUTO_SCALE));
        let value = json!({ "schema": "baocut.screen-view/1", "timescale": 1000, "clock": "recording", "solver": 1, "zooms": zooms });
        assert_eq!(crate::screen_view::screen_view_body_problems(&value, Some(PointerMode::Separate)), vec![]);

        // 重新生成：改过的自动区间与手加的保留，新生成的让开它们。
        let mut existing = zooms.clone();
        existing[0].edited = true;
        existing[0].t1 = "3000".into();
        existing.push(serde_json::from_value(point("m", 9000, 10000, 3.0, 0.5, 0.5)).unwrap());
        let again = auto_zooms(&m, &tracks, 1000, &existing, ids());
        let spans: Vec<(&str, &str, bool)> = again.iter().map(|z| (z.t0.as_str(), z.t1.as_str(), z.origin == ZoomOrigin::Manual || z.edited)).collect();
        assert_eq!(spans, [("700", "3000", true), ("3000", "5000", false), ("7700", "9000", false), ("9000", "10000", true), ("11600", "14400", false)]);
        let value = json!({ "schema": "baocut.screen-view/1", "timescale": 1000, "clock": "recording", "solver": 1, "zooms": again });
        assert_eq!(crate::screen_view::screen_view_body_problems(&value, Some(PointerMode::Separate)), vec![]);
        // 什么都没改时重新生成，结果不变（ID 也不变）。
        assert_eq!(auto_zooms(&m, &tracks, 1000, &zooms, ids()), zooms);
        // 没有指针轨：只留保留的。
        let none = auto_zooms(&manifest("none"), &HashMap::new(), 1000, &existing, ids());
        assert_eq!(none.len(), 2);
    }
}
