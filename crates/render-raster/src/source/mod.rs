//! 动态素材源（升级方案 §7 / 规范 §23 第 2 条）。
//!
//! 一个 `VisualSource` 就是「给我一个源时刻、还我一张画面」的可随机访问素材：
//! 动图（GIF / APNG / WebP）、将来的 Lottie，以及概念上早已如此的视频。
//!
//! **唯一正式接口是 [`VisualSource::sample`]，参数是绝对源时间，不是增量。**
//! 没有 `update(delta)`、没有内部时钟、没有"上一帧"状态——这不是风格偏好，
//! 而是导出可乱序 / 可并行 / 可缓存的前提：
//!
//! * 渲染是**乱序**的：`bcut render --t 7.5` 直接跳到第 225 帧，全片导出还按
//!   stride 把帧分给多个 worker，每个 worker 各自跳着走；
//! * 帧指纹（`plan::frame_plan` 三层指纹）要求同一时刻恒等于同一批字节，
//!   持有增量时钟的源做不到；
//! * 因此 conformance 里"顺序采样 == 乱序采样"是必选项，不是可选项
//!   （见 `tests/animated_source.rs`）。
//!
//! 两种实现：[`animated_image::AnimatedImage`]（GIF / APNG / WebP，全帧驻留的
//! 位图源）与 [`lottie::Lottie`]（bodymovin 子集，**直接发 DrawOp** 而不是先
//! 光栅化）。设计 §7 说的「两种并存后再抽 `bcut-source` crate」这一刻到了，
//! 但两者共享的只有本文件这一百来行 trait 与时长表工具，而 `Lottie` 反过来
//! 依赖 `crate::drawop` / `crate::raster` / `crate::plan::PreflightDiagnostic`
//! ——真拆出去会把 `bcut-render` 的三个模块一起拽走，换来的是一条新的 crate
//! 边界和一份新的 Cargo 条目。因此**本批评估后决定不拆**，留在
//! `bcut-render/src/source/` 里；等到出现第三种源（alpha video / 矢量序列）
//! 或有别的 crate 要单独消费源层时再议。

//! ## 两个 trait，不是一个
//!
//! [`VisualSource`] 是**画面**源：`sample` 还的是一张 premultiplied RGBA
//! [`SourceFrame`]。元素方案的 visualizer（[`visualizer::VizTrack`]，ADR-E04）
//! 走的是隔壁的 [`visualizer::VizSource`]，**没有**并进本 trait，理由两条：
//!
//! 1. **一帧频谱不是一张图**。`VizFrame` 是时域行 + 频域行两条**宽度不同**的
//!    字节行（BCS1 的 128 / 512）；硬塞进 `Pixmap` 就要就地发明一套像素约定，
//!    而 ADR-E04 的下游消费者是 `visualizer_frame(recipe, props, viz, bbox)
//!    -> DrawOp`，要的是数据不是像素。§8.3 那张 `w × 2` 的 `R8Unorm` 纹理是
//!    **GPU 上传期**按配方 `binWidth` 现搭的，不是源层的产物。
//! 2. **频谱没有「素材原尺寸」**。[`lottie::Lottie`] 也直接发 DrawOp，但它至少
//!    还有个合成画布可以光栅化（它的 `VisualSource::sample` 就是干这个的，
//!    只服务 probe / conformance）；频谱在拿到配方、颜色与元素盒之前根本没有
//!    画面可言，那一步就是 `visualizer_frame` 本身。
//!
//! 分家的只有「一帧是什么」。**四条采样义务两个 trait 逐字相同**：唯一入口是
//! 绝对时刻的 `sample`、不得持有增量时钟、采样只取 `&self`、内容指纹覆盖全部
//! 字节；conformance 的「乱序采样 == 顺序采样」两边都是必选项。

pub mod animated_image;
pub mod confetti;
pub mod kernel;
pub mod lottie;
pub mod paint;
pub mod proc;
pub mod progress;
pub mod texture;
pub mod visualizer;
pub mod whiteboard;

use anyhow::Result;
use std::fmt;
use std::sync::Arc;
use tiny_skia::Pixmap;

pub use animated_image::AnimatedImage;
pub use confetti::{
    ConfettiBox, ConfettiEmitMode, ConfettiEmitOverride, ConfettiParams, ConfettiShape,
    confetti_frame, confetti_particles, confetti_unit_path,
};
pub use kernel::DrawBox;
pub use lottie::{LOTTIE_RULE, Lottie};
pub use progress::{ProgressBox, ProgressParams, progress_frame};
pub use visualizer::{
    VisualizerParams, VizBox, VizFrame, VizParams, VizSource, VizTrack, visualizer_frame,
};
pub use whiteboard::{
    WhiteboardAnalysis, WhiteboardBeat, WhiteboardBox, WhiteboardGroup, WhiteboardHand,
    WhiteboardPace, WhiteboardParams, analyze as whiteboard_analyze, whiteboard_frame,
};

/// 源类型（`AssetKind` 的渲染侧对应物）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    /// GIF / APNG / 动画 WebP
    AnimatedImage,
    /// bodymovin JSON 的纯 Rust 子集渲染器（ADR-M11）
    Lottie,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceKind::AnimatedImage => "animatedImage",
            SourceKind::Lottie => "lottie",
        }
    }
}

impl fmt::Display for SourceKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 源时间（媒体源时刻）。
///
/// 内部按**整毫秒**存放：动图的逐帧时长本来就是毫秒（GIF 是 10ms 单位、
/// APNG/WebP 是毫秒），DrawOp 的 `media_ms` 也是毫秒，多留一层浮点只会给
/// 「同一时刻两次取到不同帧」留缝。秒 → 毫秒的取整只发生在
/// [`MediaTime::from_secs`] 这一处。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct MediaTime {
    ms: i64,
}

impl MediaTime {
    pub const ZERO: MediaTime = MediaTime { ms: 0 };

    /// 秒 → 源时间（四舍五入到毫秒，与 `record_media` 的视频路径同一口径）。
    pub fn from_secs(secs: f64) -> MediaTime {
        MediaTime {
            ms: (secs * 1000.0).round() as i64,
        }
    }

    pub const fn from_millis(ms: i64) -> MediaTime {
        MediaTime { ms }
    }

    pub const fn millis(self) -> i64 {
        self.ms
    }

    pub fn secs(self) -> f64 {
        self.ms as f64 / 1000.0
    }
}

impl fmt::Display for MediaTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}ms", self.ms)
    }
}

/// 素材自带的循环声明（GIF 的 NETSCAPE2.0 / APNG 的 `acTL.num_plays` /
/// WebP 的 `ANIM.loop_count`）。
///
/// **它是探测出来的元数据，不是渲染判据**：文档里 `animatedImage` 元素写不写
/// `loop` 才决定画面循不循环（缺省沿用本字段）。理由是确定性——一份文档的
/// 播放行为不该取决于某个容器字节，而应当写在文档里；`bcut probe` 把它打出来，
/// 作者据此决定要不要显式写 `loop`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceLoop {
    Infinite,
    Finite(u32),
}

impl SourceLoop {
    /// 播放遍数；`0` = 无限（`RNode::media_plays` 的编码）。
    pub fn plays(self) -> u32 {
        match self {
            SourceLoop::Infinite => 0,
            SourceLoop::Finite(n) => n,
        }
    }

    pub fn from_plays(plays: u32) -> SourceLoop {
        match plays {
            0 => SourceLoop::Infinite,
            n => SourceLoop::Finite(n),
        }
    }
}

impl fmt::Display for SourceLoop {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SourceLoop::Infinite => f.write_str("infinite"),
            SourceLoop::Finite(n) => write!(f, "{n}x"),
        }
    }
}

/// 探测结果：尺寸、帧数、逐帧时长表、循环声明。
#[derive(Debug, Clone)]
pub struct SourceMetadata {
    pub kind: SourceKind,
    pub width: u32,
    pub height: u32,
    /// 逐帧**起点**毫秒表，长度 = 帧数 + 1，末项是总时长（累积和）。
    /// 单调不减；相邻两项相等表示该帧时长为 0（容器里写了 delay 0）。
    pub frame_starts_ms: Vec<i64>,
    pub loops: SourceLoop,
}

impl SourceMetadata {
    pub fn frame_count(&self) -> usize {
        self.frame_starts_ms.len().saturating_sub(1)
    }

    /// 总时长（秒）。
    pub fn duration(&self) -> f64 {
        self.total_ms() as f64 / 1000.0
    }

    pub fn total_ms(&self) -> i64 {
        self.frame_starts_ms.last().copied().unwrap_or(0)
    }

    /// `frameIndex = frame_at_duration_table(localTime)`（设计 §7）。
    ///
    /// 落在末端之后一律冻结末帧——循环折叠是**调用方**的事（元素的
    /// `loop` / `segment` 语义在 `record_media` 里已经折过了），源本身不循环。
    pub fn frame_at(&self, time: MediaTime) -> usize {
        frame_index(&self.frame_starts_ms, time.millis())
    }

    /// 该时刻所属帧的**起点**——录制期用它把源时间量化到帧起点，
    /// 同一帧的连续时刻因此得到逐字节相同的 DrawOp（静止帧缓存靠这个命中）。
    pub fn frame_start(&self, time: MediaTime) -> MediaTime {
        MediaTime::from_millis(frame_start_ms(&self.frame_starts_ms, time.millis()))
    }
}

/// 时长表查找：返回 `ms` 所在的帧序号。表须为 `frame_starts_ms` 形态
/// （N+1 项、单调不减）。空表返回 0。
pub fn frame_index(frame_starts_ms: &[i64], ms: i64) -> usize {
    let n = frame_starts_ms.len().saturating_sub(1);
    if n == 0 {
        return 0;
    }
    let total = frame_starts_ms[n];
    let ms = ms.clamp(0, (total - 1).max(0));
    // 相等时取**后**一帧：零时长帧（delay 0）因此被跳过，与浏览器一致。
    frame_starts_ms[..n]
        .partition_point(|start| *start <= ms)
        .saturating_sub(1)
}

/// 时长表查找：返回 `ms` 所在帧的起点毫秒。
pub fn frame_start_ms(frame_starts_ms: &[i64], ms: i64) -> i64 {
    frame_starts_ms
        .get(frame_index(frame_starts_ms, ms))
        .copied()
        .unwrap_or(0)
}

/// 一帧画面（premultiplied RGBA，与 `MediaStore` 的其余画面同一像素格式）。
#[derive(Debug, Clone)]
pub struct SourceFrame {
    pub index: usize,
    /// 该帧在源时间轴上的起点
    pub start: MediaTime,
    pub pixmap: Arc<Pixmap>,
}

/// 内容指纹：`sha256(源类型 ‖ 解码器版本 ‖ 全部字节)`。
///
/// 「全部字节」是刻意的——动图的每一帧都在同一个容器里，改任何一帧、改任何一条
/// delay、改 loop count 都换指纹。等 Lottie 进来（子资源 image/font 是独立文件）
/// 时，子资源的 hash 按 preflight 收集顺序并入同一条链（设计 §7）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ContentHash([u8; 32]);

impl ContentHash {
    pub fn new(bytes: [u8; 32]) -> ContentHash {
        ContentHash(bytes)
    }

    pub fn bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}

impl fmt::Display for ContentHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "sha256-{}", self.hex())
    }
}

/// 解码预算：动图是**全帧驻留**的（见 `AnimatedImage`），必须有上限，
/// 否则一个 1080p × 400 帧的 GIF 直接吃掉 3.3 GB。
#[derive(Debug, Clone, Copy)]
pub struct PrepareCtx {
    pub max_frames: usize,
    pub max_bytes: usize,
}

impl Default for PrepareCtx {
    fn default() -> Self {
        PrepareCtx {
            max_frames: 2048,
            // 256 MiB：1080p 约 32 帧、512×512 约 256 帧、常见表情包动图数千帧
            max_bytes: 256 << 20,
        }
    }
}

/// 动态素材源（设计 §7）。
///
/// `prepare` 与 `sample` 都取 `&self`：源在 `load_assets` 期一次性构造，之后由
/// 多个渲染 worker 共享（`Arc<LoadedAssets>`），采样不得改变任何可观察状态。
pub trait VisualSource: Send + Sync {
    fn kind(&self) -> SourceKind;

    /// 元数据（尺寸、时长表、循环声明）。
    fn probe(&self) -> Result<SourceMetadata>;

    /// 预热：把渲染期需要的一切在这里备齐（Lottie 的子资源在此收集并入 hash）。
    /// 幂等；渲染期不得再有 I/O、更不得有网络。
    fn prepare(&self, ctx: &PrepareCtx) -> Result<()>;

    /// **唯一正式采样接口**：绝对源时间 → 画面。
    fn sample(&self, time: MediaTime) -> Result<SourceFrame>;

    fn fingerprint(&self) -> ContentHash;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_duration_table_maps_time_to_frames() {
        // 三帧：[0,100) [100,300) [300,600)
        let table = [0, 100, 300, 600];
        assert_eq!(frame_index(&table, 0), 0);
        assert_eq!(frame_index(&table, 99), 0);
        assert_eq!(frame_index(&table, 100), 1);
        assert_eq!(frame_index(&table, 299), 1);
        assert_eq!(frame_index(&table, 300), 2);
        assert_eq!(frame_index(&table, 599), 2);
        // 末端之后冻结末帧，负数夹到首帧
        assert_eq!(frame_index(&table, 600), 2);
        assert_eq!(frame_index(&table, 10_000), 2);
        assert_eq!(frame_index(&table, -5), 0);
    }

    #[test]
    fn zero_length_frames_are_skipped() {
        // 第 1 帧 delay 0：任何时刻都不该落在它上面
        let table = [0, 100, 100, 400];
        assert_eq!(frame_index(&table, 99), 0);
        assert_eq!(frame_index(&table, 100), 2);
        assert_eq!(frame_index(&table, 399), 2);
    }

    #[test]
    fn frame_start_quantises_time() {
        let table = [0, 100, 300, 600];
        assert_eq!(frame_start_ms(&table, 0), 0);
        assert_eq!(frame_start_ms(&table, 99), 0);
        assert_eq!(frame_start_ms(&table, 250), 100);
        assert_eq!(frame_start_ms(&table, 599), 300);
        assert_eq!(frame_start_ms(&table, 1_000), 300);
    }

    #[test]
    fn media_time_rounds_once() {
        assert_eq!(MediaTime::from_secs(0.1234).millis(), 123);
        assert_eq!(MediaTime::from_secs(0.1235).millis(), 124);
        assert_eq!(MediaTime::from_millis(250).secs(), 0.25);
    }

    #[test]
    fn loop_counts_round_trip_through_the_plays_encoding() {
        assert_eq!(SourceLoop::Infinite.plays(), 0);
        assert_eq!(SourceLoop::Finite(3).plays(), 3);
        assert_eq!(SourceLoop::from_plays(0), SourceLoop::Infinite);
        assert_eq!(SourceLoop::from_plays(1), SourceLoop::Finite(1));
    }
}
