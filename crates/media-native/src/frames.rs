//! 顺序帧流：BCF 渲染管线逐帧解码的原生主路径（WP6a）。
//!
//! 与 [`crate::extract_frame_rgba`] 的取舍**完全相反**：那边是"随机时间点、一次
//! 一帧"，每次都值得付一次精确 seek 的代价；这里是"一个起点、之后一直往前走"，
//! 每帧重新 seek 会把整片渲染拖垮。所以两条路径共享平台代码但各有自己的对象：
//! 单帧用 image generator / seek + 推进，顺序流用 asset reader / source reader
//! 一路 `ReadSample`。
//!
//! ## 语义对齐迁移前的 `ffmpeg -ss <from> -i <src> -f rawvideo -r <fps> -`
//!
//! - **起点**：`from` 之后的第一个输出帧是"覆盖 `from` 的那一帧"。平台 seek 只
//!   保证落到不晚于 `from` 的关键帧，多出来的前置帧由本模块按时间戳丢掉。
//! - **帧率重采样**：输出帧 `k` 的目标时刻是 `from + k / fps`，取**最后一个
//!   pts ≤ 目标时刻**的解码帧。源帧率低于合成帧率就重复（dup），高于就跳过
//!   （drop）——这正是 ffmpeg `-r` 在输出侧做的 CFR 转换。
//! - **片尾**：末帧按它自己的呈现区间（`pts + duration`）补满网格，越过区间
//!   右端即 [`FrameStream::next_frame`] 返回 `None`。ffmpeg 的 `-r` 在片尾按
//!   自己的规则还会多补一两帧，本模块严格停在区间右端；调用方（`bcut-render`
//!   的 `VideoReader`）在 EOF 上本来就是**冻结末帧**，那一两帧与冻结出来的画面
//!   逐字节相同，差异不可观测。
//! - **旋转**：按容器的旋转元数据摆正到显示方向（ffmpeg CLI autorotate 默认开）。
//!
//! ## 确定性边界
//!
//! 像素属于平台解码器，只承诺语义等价 + 容差（`docs/design/bcf/baocut-format-spec.md`
//! §15.1，跨后端灰度 SSIM ≥ 0.95）；"取哪一帧"是硬承诺，由上面的时间戳规则保证。

use std::path::Path;

use anyhow::{Result, bail};

use crate::RgbaFrame;

/// 平台解码器交出的一帧。
pub(crate) struct DecodedFrame {
    /// 媒体时间轴上的呈现时间戳（秒）。**绝对值**，不因 seek 归零——帧率重采样
    /// 的目标时刻也是绝对的，两边必须同一个原点。
    pub(crate) pts_seconds: f64,
    /// 这一帧的呈现时长（秒）。`None` = 容器/解码器没给。
    ///
    /// 只有一个用途：判定**片尾**。没有它就只能"末帧交出一次然后 EOF"，
    /// 输出帧数会比 ffmpeg 少一到两帧（ffmpeg 把末帧补满它自己的呈现区间）。
    /// 下游在 EOF 上是冻结末帧，少几帧不改画面，但帧数对不上会让"重采样帧数
    /// 正确"这类断言没法写死。
    pub(crate) duration_seconds: Option<f64>,
    pub(crate) frame: RgbaFrame,
}

/// 平台顺序解码器。只负责"按解码顺序交出下一帧 + 它的时间戳"，帧率重采样、
/// 起点丢帧与 EOF 语义全部收敛在 [`FrameStream`] 里，两个平台不各写一遍。
pub(crate) trait FrameSource {
    /// 摆正后的输出尺寸（整条流恒定）。
    fn size(&self) -> (u32, u32);
    /// 下一个解码帧；`None` = 片源解完。
    fn next_decoded(&mut self) -> Result<Option<DecodedFrame>>;
    /// 在**同一份已解析的片源**上从 `from_seconds` 重新起读。
    ///
    /// 随机访问（预览拖 playhead）每次跳转都要换起点；整个重建（重新解析容器、
    /// 找轨、建 reader）在 macOS 上要 20 ms 上下，其中容器解析与找轨是纯浪费。
    /// 平台能复用轨道对象的就在这里只换 reader。默认 `Err`：调用方回退到完整
    /// 重开，语义不变。
    fn reopen(&mut self, from_seconds: f64) -> Result<()> {
        let _ = from_seconds;
        bail!("unsupported: 该平台解码器不支持原地重开")
    }
    /// `time_seconds` 之前（含）最近一个**完全同步样本**（关键帧）的呈现时刻。
    ///
    /// 只给预览拖动用：拖动中把取帧时刻吸到关键帧，跳转就省掉"从关键帧解到
    /// 目标"那段。`Ok(None)` = 平台答不出来（调用方走精确路径）。
    fn sync_sample_at_or_before(&self, time_seconds: f64) -> Result<Option<f64>> {
        let _ = time_seconds;
        Ok(None)
    }
    /// 直接解出 `time_seconds` 之前（含）最近关键帧那一张画面，连同它的呈现
    /// 时刻。**不动**顺序流自身的位置：平台用一条独立的常驻解码路径答这个
    /// 问题，顺序流该在哪还在哪。
    ///
    /// 只给预览拖动用：拖动中每次跳转都落到一个新 GOP 时，「重开 reader + 解
    /// 一帧」的价大头是解码会话冷启动，常驻解码器把它省掉。`Ok(None)` = 平台
    /// 答不出来（调用方回退到重开 + 解一帧），`Err` 只在平台明确失败时出现。
    fn keyframe_at_or_before(&mut self, time_seconds: f64) -> Result<Option<(f64, RgbaFrame)>> {
        let _ = time_seconds;
        Ok(None)
    }
}

/// 时间戳比较容差：1 微秒。合成帧率与源帧率都是有理数，f64 换算后的误差远小于
/// 这个量级；容差太大会在 30fps 对 30fps 时把边界帧多吃一帧。
const PTS_EPSILON: f64 = 1e-6;

/// 顺序帧流。逐次 [`next_frame`](Self::next_frame) 取合成帧率网格上的下一帧。
pub struct FrameStream {
    source: Box<dyn FrameSource>,
    /// 流的起始媒体时刻（秒）。
    from: f64,
    /// 合成帧率。
    fps: f64,
    /// 下一个待产出的输出帧号（相对 `from`）。
    next_index: u64,
    /// 已解出但时间戳还在目标之后的帧（前瞻一帧）。
    pending: Option<DecodedFrame>,
    /// 平台解码器已经报告过 EOF。
    source_done: bool,
    /// 当前有效帧（dup 时重复交出它）。
    current: Option<RgbaFrame>,
    /// 当前帧呈现区间的**开区间右端**（`pts + duration`）。`None` = 时长未知。
    current_end: Option<f64>,
}

// SAFETY：流内部持有的平台对象（AVAssetReader / IMFSourceReader）都不是有线程
// 亲和性的 UI 对象，可以在任意一条线程上使用。契约是**单线程独占**：`bcut-render`
// 的 `MediaStore` 每个渲染 worker 一份、在自己的线程里建立并用到底，跨线程移动
// 之后也只由新线程使用。没有这条 impl，`MediaStore` 会从"是 Send"变成"不是
// Send"——那是既有调用方看得见的 API 回退。
unsafe impl Send for FrameStream {}

/// 打开 `path` 从 `from_seconds` 开始、按 `fps` 重采样的顺序帧流。
///
/// 返回 `Err` 就是"这条片源原生解不了"（容器/编码不支持、平台没有实现、文件
/// 打不开）。**调用方必须自带 ffmpeg 兜底**——本 crate 不发现也不启动任何外部
/// 二进制。
pub fn open_frame_stream(path: &Path, from_seconds: f64, fps: f64) -> Result<FrameStream> {
    if !fps.is_finite() || fps <= 0.0 {
        bail!("fps 必须是正的有限值，实得 {fps}");
    }
    let from = if from_seconds.is_finite() {
        from_seconds.max(0.0)
    } else {
        bail!("from_seconds 必须是有限值，实得 {from_seconds}");
    };
    #[cfg(target_os = "macos")]
    let source = crate::macos::open_frame_source(path, from)?;
    #[cfg(target_os = "windows")]
    let source = crate::windows::open_frame_source(path, from)?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let source: Box<dyn FrameSource> = {
        let _ = (path, from);
        bail!("unsupported: 当前平台没有原生顺序帧流后端（请安装 ffmpeg 走兜底路径）")
    };
    Ok(FrameStream::new(source, from, fps))
}

impl FrameStream {
    pub(crate) fn new(source: Box<dyn FrameSource>, from: f64, fps: f64) -> Self {
        Self {
            source,
            from,
            fps,
            next_index: 0,
            pending: None,
            source_done: false,
            current: None,
            current_end: None,
        }
    }

    /// 输出帧宽（摆正后）。整条流恒定。
    pub fn width(&self) -> u32 {
        self.source.size().0
    }

    /// 输出帧高（摆正后）。整条流恒定。
    pub fn height(&self) -> u32 {
        self.source.size().1
    }

    /// 在同一片源上从 `from_seconds` 重新起读（重采样网格也重挂到新起点）。
    ///
    /// 成功后这条流的语义与 `open_frame_stream(path, from_seconds, fps)` 新开的
    /// 一条完全相同；`Err` 表示平台不支持或重开失败，此时流处于**未定义**状态，
    /// 调用方应当丢掉它完整重开。
    pub fn reopen(&mut self, from_seconds: f64) -> Result<()> {
        if !from_seconds.is_finite() {
            bail!("from_seconds 必须是有限值，实得 {from_seconds}");
        }
        let from = from_seconds.max(0.0);
        self.source.reopen(from)?;
        self.from = from;
        self.next_index = 0;
        self.pending = None;
        self.source_done = false;
        self.current = None;
        self.current_end = None;
        Ok(())
    }

    /// `time_seconds` 之前（含）最近一个关键帧的呈现时刻；`None` = 平台答不出。
    pub fn sync_sample_at_or_before(&self, time_seconds: f64) -> Result<Option<f64>> {
        if !time_seconds.is_finite() {
            return Ok(None);
        }
        self.source.sync_sample_at_or_before(time_seconds.max(0.0))
    }

    /// `time_seconds` 之前（含）最近关键帧的画面与呈现时刻，走平台的常驻关键帧
    /// 解码器，不改变这条流的位置；`None` = 平台答不出（调用方回退到
    /// [`reopen`](Self::reopen) + [`next_frame`](Self::next_frame)）。
    pub fn keyframe_at_or_before(&mut self, time_seconds: f64) -> Result<Option<(f64, RgbaFrame)>> {
        if !time_seconds.is_finite() {
            return Ok(None);
        }
        self.source.keyframe_at_or_before(time_seconds.max(0.0))
    }

    /// 合成帧率网格上的下一帧；`None` = 片源已尽（调用方按"冻结末帧"处理）。
    pub fn next_frame(&mut self) -> Result<Option<RgbaFrame>> {
        if self.next_index == 0
            && let Some(first) = self.peek()?
            && first > self.from + PTS_EPSILON
        {
            // seek 落点之后的首帧比请求的起点还晚（`from` 落在片源首帧之前，或者
            // 平台把起点吸附到了更晚的位置）。ffmpeg 在这种情况下把输出时间轴
            // **对齐到首帧**（`-ss` 之后的第一个解码帧就是输出帧 0），而不是先
            // 补一串重复帧；这里同样重挂原点。
            self.from = first;
        }
        let target = self.from + self.next_index as f64 / self.fps;
        let mut advanced = false;
        // 把所有 pts ≤ 目标时刻的帧吃掉，留下最后一个——drop 就发生在这里。
        while let Some(pts) = self.peek()? {
            if pts > target + PTS_EPSILON {
                break;
            }
            self.take_pending();
            advanced = true;
        }
        if self.current.is_none() {
            // 还没有任何有效帧（重挂原点后的浮点误差、或者时间戳非单调的片源）：
            // 用手上这一帧顶上，不交空帧。
            if self.pending.is_some() {
                self.take_pending();
                advanced = true;
            }
        }
        let Some(frame) = self.current.as_ref() else {
            return Ok(None); // 片源里一帧都没有
        };
        if self.source_done {
            // 片尾判定。目标时刻越过末帧呈现区间的右端就是 EOF；还在区间内就
            // 按 CFR 再补一份（ffmpeg `-r` 在片尾同样这么补）。时长未知时退回
            // "末帧只交一次"——比无限 dup 安全。
            match self.current_end {
                Some(end) if target >= end - PTS_EPSILON => return Ok(None),
                None if !advanced => return Ok(None),
                _ => {}
            }
        }
        self.next_index += 1;
        // dup 时这里是一次整帧拷贝——与 ffmpeg 往管道里再写一份 rawvideo 同价。
        Ok(Some(frame.clone()))
    }

    /// The last actually decoded frame and the exclusive end of its presentation
    /// interval, once the decoder has reached clean EOF. This does not extend the
    /// stream or guess a duration. Hosts can distinguish a short audio/container
    /// tail from missing video while retaining their own bounded tail policy.
    pub fn terminal_frame(&self) -> Option<(&RgbaFrame, f64)> {
        if !self.source_done || self.pending.is_some() {
            return None;
        }
        Some((self.current.as_ref()?, self.current_end?))
    }

    /// 把前瞻的那一帧提升为当前帧，同时记住它的呈现区间右端。
    fn take_pending(&mut self) {
        let decoded = self.pending.take().expect("调用前已确认 pending 非空");
        self.current_end = decoded
            .duration_seconds
            .filter(|duration| duration.is_finite() && *duration > 0.0)
            .map(|duration| decoded.pts_seconds + duration);
        self.current = Some(decoded.frame);
    }

    /// 前瞻一帧的时间戳（必要时先向平台解码器要一帧）。
    fn peek(&mut self) -> Result<Option<f64>> {
        if self.pending.is_none() && !self.source_done {
            match self.source.next_decoded()? {
                Some(decoded) => self.pending = Some(decoded),
                None => self.source_done = true,
            }
        }
        Ok(self.pending.as_ref().map(|decoded| decoded.pts_seconds))
    }
}

/// 预热：打开 `path` 在 `from_seconds` 附近的帧流并解出一帧，然后丢掉。
///
/// 进程里**第一次**打开某个文件要付容器索引解析与解码会话建立的价（1 GB 级
/// H.264 冷开 ≈ 230 ms，同进程第二次 ≈ 12 ms），首帧解码再付 ≈ 80 ms；这些
/// 平台层缓存按进程/文件共享，不依赖具体的流对象。调用方在文档装载与计划编译
/// 还在跑的时候于后台线程调用一次，真正的取帧就落在热路径上。
///
/// 任何失败都静默：预热只是加速，打不开的片源由正式路径报错。
pub fn prewarm_frame_stream(path: &Path, from_seconds: f64, fps: f64) {
    if let Ok(mut stream) = open_frame_stream(path, from_seconds, fps) {
        let _ = stream.next_frame();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 预热对不存在的片源静默：它只是加速，报错留给正式路径。
    #[test]
    fn prewarm_is_silent_on_missing_media() {
        let dir = std::env::temp_dir().join("bcut-media-native-prewarm-missing");
        prewarm_frame_stream(&dir.join("missing.mp4"), 12.5, 30.0);
        prewarm_frame_stream(&dir.join("missing.mp4"), f64::NAN, 0.0);
    }

    /// 按给定 (pts, 时长, 亮度) 序列吐帧的假解码器：帧率重采样规则可以离线验。
    /// `script` 是整条片源；`reopen` 模拟平台 seek——从第一个 pts ≤ from 的帧
    /// 起重吐（没有就从头）。
    struct ScriptedSource {
        script: Vec<(f64, Option<f64>, u8)>,
        frames: std::vec::IntoIter<(f64, Option<f64>, u8)>,
    }

    impl ScriptedSource {
        fn new(script: Vec<(f64, Option<f64>, u8)>) -> Self {
            Self {
                frames: script.clone().into_iter(),
                script,
            }
        }
    }

    impl FrameSource for ScriptedSource {
        fn size(&self) -> (u32, u32) {
            (1, 1)
        }
        fn next_decoded(&mut self) -> Result<Option<DecodedFrame>> {
            Ok(self
                .frames
                .next()
                .map(|(pts_seconds, duration_seconds, value)| DecodedFrame {
                    pts_seconds,
                    duration_seconds,
                    frame: RgbaFrame::new(1, 1, vec![value, value, value, 255]).unwrap(),
                }))
        }
        fn reopen(&mut self, from_seconds: f64) -> Result<()> {
            let start = self
                .script
                .iter()
                .rposition(|(pts, _, _)| *pts <= from_seconds + PTS_EPSILON)
                .unwrap_or(0);
            self.frames = self.script[start..].to_vec().into_iter();
            Ok(())
        }
    }

    /// 源帧率 `source_fps` 的等间隔序列，帧值 0,1,2…
    fn cfr(count: u8, source_fps: f64) -> Vec<(f64, Option<f64>, u8)> {
        (0..count)
            .map(|i| (f64::from(i) / source_fps, Some(1.0 / source_fps), i))
            .collect()
    }

    fn stream(frames: Vec<(f64, Option<f64>, u8)>, from: f64, fps: f64) -> FrameStream {
        FrameStream::new(Box::new(ScriptedSource::new(frames)), from, fps)
    }

    /// 原地重开 = 新开一条：起点、网格、前瞻帧、EOF 状态全部归零。
    #[test]
    fn reopen_matches_a_freshly_opened_stream() {
        let script = cfr(12, 10.0);
        // 先把一条流读到 EOF（pending 空、source_done 真、current 是末帧）。
        let mut reused = stream(script.clone(), 0.0, 10.0);
        while reused.next_frame().unwrap().is_some() {}
        reused.reopen(0.55).unwrap();
        let fresh = stream(script, 0.55, 10.0);
        assert_eq!(drain(reused), drain(fresh));
    }

    /// 平台不支持原地重开时 `reopen` 报错，调用方据此完整重开。
    #[test]
    fn reopen_without_platform_support_is_an_error() {
        struct Plain;
        impl FrameSource for Plain {
            fn size(&self) -> (u32, u32) {
                (1, 1)
            }
            fn next_decoded(&mut self) -> Result<Option<DecodedFrame>> {
                Ok(None)
            }
        }
        let mut stream = FrameStream::new(Box::new(Plain), 0.0, 10.0);
        assert!(stream.reopen(1.0).is_err());
        assert_eq!(stream.sync_sample_at_or_before(1.0).unwrap(), None);
    }

    fn drain(mut stream: FrameStream) -> Vec<u8> {
        let mut out = Vec::new();
        while let Some(frame) = stream.next_frame().unwrap() {
            out.push(frame.pixel(0, 0).unwrap()[0]);
        }
        out
    }

    /// 源帧率 = 合成帧率：一帧一帧原样过。
    #[test]
    fn a_matching_frame_rate_passes_every_frame_through_once() {
        assert_eq!(drain(stream(cfr(5, 10.0), 0.0, 10.0)), vec![0, 1, 2, 3, 4]);
    }

    /// 源 10fps、合成 20fps：每帧复制一次（dup），总帧数翻倍——0.3 秒素材在
    /// 20fps 网格上正好 6 帧，与 ffmpeg `-r 20` 的输出帧数一致。
    #[test]
    fn a_slower_source_duplicates_frames_to_fill_the_grid() {
        assert_eq!(
            drain(stream(cfr(3, 10.0), 0.0, 20.0)),
            vec![0, 0, 1, 1, 2, 2]
        );
    }

    /// 源 20fps、合成 10fps：隔一帧丢一帧（drop）。0.3 秒素材在 10fps 网格上
    /// 是 3 帧——末帧的呈现区间在 0.30s 结束，网格点 0.3 已经越界。
    #[test]
    fn a_faster_source_drops_frames_to_fit_the_grid() {
        assert_eq!(drain(stream(cfr(6, 20.0), 0.0, 10.0)), vec![0, 2, 4]);
    }

    /// `from` 落在两帧之间：首个输出帧是**覆盖它的那一帧**，不是它之后的第一帧。
    #[test]
    fn the_first_output_frame_covers_the_requested_start() {
        // 0.25s 落在帧 2（0.2s）的呈现区间内。
        assert_eq!(drain(stream(cfr(5, 10.0), 0.25, 10.0)), vec![2, 3, 4]);
    }

    /// 平台把 seek 落点吸附到了目标之后（第一帧就晚于 `from`）：输出时间轴
    /// 重挂到首帧，不在前面补一串重复帧。
    #[test]
    fn a_seek_that_overshoots_rebases_the_output_timeline_onto_the_first_frame() {
        let source = vec![(1.0, Some(0.1), 7), (1.1, Some(0.1), 8)];
        assert_eq!(drain(stream(source, 0.5, 10.0)), vec![7, 8]);
    }

    /// 容器不给帧时长时退回"末帧只交一次"：不会因为算不出呈现区间而无限 dup。
    #[test]
    fn an_unknown_frame_duration_falls_back_to_emitting_the_last_frame_once() {
        let source = vec![(0.0, None, 0), (0.1, None, 1)];
        assert_eq!(drain(stream(source, 0.0, 20.0)), vec![0, 0, 1]);
    }

    #[test]
    fn terminal_frame_reports_the_actual_final_frame_between_sampling_points() {
        let mut source = stream(cfr(3, 10.0), 0.0, 2.0);
        assert_eq!(source.terminal_frame(), None);
        assert_eq!(
            source.next_frame().unwrap().unwrap().pixel(0, 0).unwrap()[0],
            0
        );
        assert_eq!(source.terminal_frame(), None);
        assert!(source.next_frame().unwrap().is_none());
        let (last, end) = source.terminal_frame().unwrap();
        assert_eq!(last.pixel(0, 0).unwrap()[0], 2);
        assert!((end - 0.3).abs() < 1e-9);
        assert!(source.next_frame().unwrap().is_none());
    }

    #[test]
    fn terminal_frame_never_invents_an_unknown_duration_or_empty_frame() {
        let mut unknown = stream(vec![(0.0, None, 7)], 0.0, 2.0);
        assert!(unknown.next_frame().unwrap().is_some());
        assert!(unknown.next_frame().unwrap().is_none());
        assert_eq!(unknown.terminal_frame(), None);
        let mut empty = stream(Vec::new(), 0.0, 2.0);
        assert!(empty.next_frame().unwrap().is_none());
        assert_eq!(empty.terminal_frame(), None);
    }

    /// 空片源：一帧都不交，直接 EOF（不是 panic，也不是无限 dup）。
    #[test]
    fn an_empty_source_ends_immediately() {
        assert_eq!(drain(stream(Vec::new(), 0.0, 30.0)), Vec::<u8>::new());
    }

    /// 非法参数在碰平台之前就被拒。
    #[test]
    fn invalid_rates_and_times_are_rejected_before_touching_the_platform() {
        let path = Path::new("/nonexistent.mp4");
        assert!(open_frame_stream(path, 0.0, 0.0).is_err());
        assert!(open_frame_stream(path, 0.0, f64::NAN).is_err());
        assert!(open_frame_stream(path, f64::NAN, 30.0).is_err());
    }
}
