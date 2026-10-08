//! Windows 原生解码：Media Foundation `IMFSourceReader` + `MFVideoFormat_RGB32`。
//! 单帧抽取与顺序帧流共用同一套 reader 搭建与像素搬运，区别只在读法。
//!
//! ## 已知坑：`SetCurrentPosition` 只到关键帧
//!
//! MF 的 seek 语义是「定位到不晚于目标的那个关键帧」，长 GOP 素材上能落在目标
//! 前好几秒。**seek 之后必须循环 `ReadSample` 比对时间戳推进到目标帧**，否则
//! filmstrip 会出现一长串完全相同的格子。这是与 macOS `AVAssetImageGenerator`
//! （容差置零就精确）最大的实现差异，也是本模块存在的主要复杂度。
//!
//! ## 缩放在 CPU 上做
//!
//! 理论上可以给 reader 设一个目标尺寸的输出媒体类型，让 advanced video
//! processing 顺手缩放。实践上这条路对格式协商很挑剔（不同解码器接受的目标
//! 尺寸集合不同），失败方式还是安静的——协商不成时它会给回原尺寸。缩略图一次
//! 只解一帧，CPU 上做一次盒式下采样（[`crate::resize_rgba`]）的成本可以忽略，
//! 换来的是"尺寸契约永远成立"。顺序帧流根本不缩放：渲染管线要的就是源尺寸。
//!
//! ## 旋转
//!
//! MF 不会自动摆正：旋转角从原生媒体类型的 `MF_MT_VIDEO_ROTATION` 读出，在
//! 像素搬运时应用（与 `apps/cli` 的 MF 导出后端同一条规矩）。

use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
use windows::core::{GUID, Interface, PCWSTR};

use crate::{RgbaFrame, scale};

const HNS_PER_SECOND: f64 = 10_000_000.0;
const VIDEO_STREAM: u32 = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
const ALL_STREAMS: u32 = MF_SOURCE_READER_ALL_STREAMS.0 as u32;

/// 一次原生媒体操作（抽帧、顺序流、MP4 写入）期间的 COM + Media Foundation
/// 生命周期。解码与编码共用同一份：两边都要 `CoInitializeEx` + `MFStartup`，
/// 各写一份只会让 `MFShutdown` 的配对更难看清。
pub(crate) struct Runtime;

impl Runtime {
    pub(crate) fn start() -> Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|error| media_feature_error("初始化 COM", error))?;
            if let Err(error) = MFStartup(MF_VERSION, MFSTARTUP_FULL) {
                CoUninitialize();
                return Err(media_feature_error("启动 Media Foundation", error));
            }
        }
        Ok(Self)
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        unsafe {
            let _ = MFShutdown();
            CoUninitialize();
        }
    }
}

pub(crate) fn media_feature_error(context: &str, error: windows::core::Error) -> anyhow::Error {
    anyhow!(
        "{context}失败：{error}。如果使用 Windows N/KN，请在‘可选功能’中安装 Media Feature Pack"
    )
}

/// `\\?\` 前缀的路径 MF 的 URL 解析器不认（会当成网络地址），与导出后端同一条
/// 规范化规则。
pub(crate) fn wide_path(path: &Path) -> Vec<u16> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    let verbatim = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    let unc = [b'U' as u16, b'N' as u16, b'C' as u16, b'\\' as u16];
    let mut normalized =
        if wide.starts_with(&verbatim) && wide.get(4..8).is_some_and(|value| value == unc) {
            [b'\\' as u16, b'\\' as u16]
                .into_iter()
                .chain(wide[8..].iter().copied())
                .collect()
        } else if wide.starts_with(&verbatim)
            && wide.get(5) == Some(&(b':' as u16))
            && wide.get(6) == Some(&(b'\\' as u16))
        {
            wide[4..].to_vec()
        } else {
            wide
        };
    normalized.push(0);
    normalized
}

pub(crate) fn pack_ratio(numerator: u32, denominator: u32) -> u64 {
    (u64::from(numerator) << 32) | u64::from(denominator)
}

fn unpack_ratio(value: u64) -> (u32, u32) {
    ((value >> 32) as u32, value as u32)
}

pub(crate) fn extract_frame_rgba(
    path: &Path,
    time_seconds: f64,
    target_width: u32,
) -> Result<RgbaFrame> {
    if !path.is_file() {
        bail!("媒体文件不存在：{}", path.display());
    }
    let _runtime = Runtime::start()?;
    unsafe { extract_inner(path, time_seconds, target_width) }
}

unsafe fn extract_inner(path: &Path, time_seconds: f64, target_width: u32) -> Result<RgbaFrame> {
    let attributes = unsafe {
        let mut value = None;
        MFCreateAttributes(&mut value, 2)
            .map_err(|error| media_feature_error("创建 Media Foundation 属性", error))?;
        let value = value.context("Media Foundation 返回空属性对象")?;
        value.SetUINT32(&MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, 1)?;
        value
    };
    let wide = wide_path(path);
    let reader = unsafe { MFCreateSourceReaderFromURL(PCWSTR(wide.as_ptr()), &attributes) }
        .map_err(|error| media_feature_error("打开源媒体", error))?;

    let native = unsafe { reader.GetNativeMediaType(VIDEO_STREAM, 0) }
        .context("unsupported: 源媒体没有视频流")?;
    let (encoded_width, encoded_height) =
        unpack_ratio(unsafe { native.GetUINT64(&MF_MT_FRAME_SIZE) }.context("读取视频尺寸失败")?);
    if encoded_width == 0 || encoded_height == 0 {
        bail!("unsupported: 源媒体没有有效的视频尺寸");
    }
    let rotation = unsafe { native.GetUINT32(&MF_MT_VIDEO_ROTATION) }
        .unwrap_or(0)
        .rem_euclid(360) as u16;

    // 只解视频轨：音频轨一起解只是白花时间。
    unsafe {
        reader.SetStreamSelection(ALL_STREAMS, false)?;
        reader.SetStreamSelection(VIDEO_STREAM, true)?;
    }
    let rgb32 = unsafe {
        let media_type = MFCreateMediaType()?;
        media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
        media_type
    };
    unsafe { reader.SetCurrentMediaType(VIDEO_STREAM, None, &rgb32) }.map_err(|error| {
        anyhow!("unsupported: Media Foundation 无法把该视频解成 RGB32（{error}）")
    })?;

    let target_hns = (time_seconds * HNS_PER_SECOND) as i64;
    if target_hns > 0 {
        let position = PROPVARIANT::from(target_hns);
        unsafe { reader.SetCurrentPosition(&GUID::zeroed(), &position) }.map_err(|error| {
            anyhow!("Media Foundation 无法定位到 {time_seconds:.3}s（{error}）")
        })?;
    }

    // seek 只保证落在目标之前的关键帧上；这里逐帧推进到「覆盖 t 的那一帧」，
    // 也就是最后一个时间戳 ≤ t 的帧。第一帧就晚于 t（seek 过头 / t 在首帧之前）
    // 时用它本身，不然会交出一个空帧。
    let mut held: Option<IMFSample> = None;
    loop {
        let (flags, timestamp, sample) = unsafe { read_sample(&reader)? };
        if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
            break;
        }
        let Some(sample) = sample else {
            // 流间隙 / 格式变更通知：没有样本，继续读。
            continue;
        };
        if timestamp > target_hns {
            if held.is_none() {
                held = Some(sample);
            }
            break;
        }
        held = Some(sample);
    }
    let sample = held.with_context(|| {
        format!(
            "Media Foundation 在 {time_seconds:.3}s 处没有解出任何帧（{}）",
            path.display()
        )
    })?;

    let decoded = unsafe {
        sample_to_rgba(
            &sample,
            encoded_width as usize,
            encoded_height as usize,
            rotation,
        )?
    };
    let height = scale::scaled_height(decoded.width, decoded.height, target_width);
    Ok(scale::resize_rgba(&decoded, target_width, height))
}

unsafe fn read_sample(reader: &IMFSourceReader) -> Result<(u32, i64, Option<IMFSample>)> {
    let mut flags = 0_u32;
    let mut timestamp = 0_i64;
    let mut sample = None;
    unsafe {
        reader.ReadSample(
            VIDEO_STREAM,
            0,
            None,
            Some(&mut flags),
            Some(&mut timestamp),
            Some(&mut sample),
        )?;
    }
    Ok((flags, timestamp, sample))
}

/// RGB32 样本 → 摆正后的 top-down RGBA8（源尺寸，尚未缩放）。
///
/// 2D 缓冲的 `Lock2D` 是行序与行距的唯一权威：`scanline0` 永远指向**第一视觉
/// 行**，`pitch` 是到下一视觉行的字节步长，负值表示底部朝上。拿不到 2D 缓冲才
/// 退回连续缓冲，按 RGB32 的历史默认处理（bottom-up、行距 = 宽×4）。
unsafe fn sample_to_rgba(
    sample: &IMFSample,
    width: usize,
    height: usize,
    rotation: u16,
) -> Result<RgbaFrame> {
    let two_dimensional = unsafe { sample.GetBufferByIndex(0) }
        .ok()
        .and_then(|buffer| buffer.cast::<IMF2DBuffer>().ok());
    if let Some(buffer) = two_dimensional {
        let mut scanline0: *mut u8 = std::ptr::null_mut();
        let mut pitch = 0_i32;
        unsafe { buffer.Lock2D(&mut scanline0, &mut pitch)? };
        // Lock2D 与 Unlock2D 之间不用 `?`：结果先落进 `outcome`，解锁无条件执行。
        let outcome = if scanline0.is_null() || (pitch.unsigned_abs() as usize) < width * 4 {
            Err(anyhow!("Media Foundation 返回了不完整的 RGB32 视频帧"))
        } else {
            Ok(unsafe { copy_rows(scanline0, pitch as isize, width, height, rotation) })
        };
        let unlocked = unsafe { buffer.Unlock2D() };
        let frame = outcome?;
        unlocked?;
        return Ok(frame);
    }
    let buffer = unsafe { sample.ConvertToContiguousBuffer()? };
    let mut pointer = std::ptr::null_mut();
    let mut maximum = 0_u32;
    let mut current = 0_u32;
    unsafe { buffer.Lock(&mut pointer, Some(&mut maximum), Some(&mut current))? };
    let stride = width * 4;
    let outcome = if (current as usize) < stride * height {
        Err(anyhow!("Media Foundation 返回了不完整的 RGB32 视频帧"))
    } else {
        // 连续缓冲的 RGB32 是 bottom-up：第一视觉行在缓冲末尾，步长取负。
        let first_visual_row = unsafe { pointer.add(stride * (height - 1)) };
        Ok(unsafe {
            copy_rows(
                first_visual_row,
                -(stride as isize),
                width,
                height,
                rotation,
            )
        })
    };
    let unlocked = unsafe { buffer.Unlock() };
    let frame = outcome?;
    unlocked?;
    Ok(frame)
}

/// 逐视觉行搬运 RGB32（内存序 B,G,R,X）→ RGBA8，同时应用旋转。
///
/// `first_row` 指向第一视觉行，`pitch` 是到下一视觉行的字节步长（可为负）。
/// 旋转后的输出尺寸在 90/270 下宽高互换。alpha 一律 255：MF 的 RGB32 常把
/// alpha 字节留成 0。
unsafe fn copy_rows(
    first_row: *const u8,
    pitch: isize,
    width: usize,
    height: usize,
    rotation: u16,
) -> RgbaFrame {
    let (out_width, out_height) = if matches!(rotation, 90 | 270) {
        (height, width)
    } else {
        (width, height)
    };
    let mut data = vec![0_u8; out_width * out_height * 4];
    for y in 0..height {
        let row = unsafe { first_row.offset(pitch * y as isize) };
        for x in 0..width {
            let pixel = unsafe { std::slice::from_raw_parts(row.add(x * 4), 4) };
            // 顺时针旋转 `rotation` 度后，源 (x, y) 落到的目标坐标。
            let (tx, ty) = match rotation {
                90 => (height - 1 - y, x),
                180 => (width - 1 - x, height - 1 - y),
                270 => (y, width - 1 - x),
                _ => (x, y),
            };
            let out = (ty * out_width + tx) * 4;
            data[out] = pixel[2];
            data[out + 1] = pixel[1];
            data[out + 2] = pixel[0];
            data[out + 3] = 255;
        }
    }
    RgbaFrame {
        width: out_width as u32,
        height: out_height as u32,
        data,
    }
}

// ── 顺序帧流（WP6a）
//
// 与单帧抽取共用 reader 搭建与 `sample_to_rgba`，区别只有两点：
//
// 1. **不缩放**：渲染管线要的是源尺寸原样。
// 2. **不在这里挑帧**：`FrameStream` 按时间戳做帧率重采样与起点对齐，本模块
//    只负责"按解码顺序交出下一帧 + 它的时间戳与时长"。唯一的例外是 seek 之后
//    那批**完全早于起点**的帧——MF 的 `SetCurrentPosition` 只保证落到不晚于
//    目标的关键帧，长 GOP 上能多出几十帧。它们注定会被丢掉，在这里按时间戳
//    跳过就省掉了同样多次 RGB32 → RGBA 搬运。

pub(crate) fn open_frame_source(
    path: &Path,
    from_seconds: f64,
) -> Result<Box<dyn crate::frames::FrameSource>> {
    if !path.is_file() {
        bail!("媒体文件不存在：{}", path.display());
    }
    let runtime = Runtime::start()?;
    unsafe { open_inner(runtime, path, from_seconds) }
}

unsafe fn open_inner(
    runtime: Runtime,
    path: &Path,
    from_seconds: f64,
) -> Result<Box<dyn crate::frames::FrameSource>> {
    let attributes = unsafe {
        let mut value = None;
        MFCreateAttributes(&mut value, 2)
            .map_err(|error| media_feature_error("创建 Media Foundation 属性", error))?;
        let value = value.context("Media Foundation 返回空属性对象")?;
        value.SetUINT32(&MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, 1)?;
        value
    };
    let wide = wide_path(path);
    let reader = unsafe { MFCreateSourceReaderFromURL(PCWSTR(wide.as_ptr()), &attributes) }
        .map_err(|error| media_feature_error("打开源媒体", error))?;

    let native = unsafe { reader.GetNativeMediaType(VIDEO_STREAM, 0) }
        .context("unsupported: 源媒体没有视频流")?;
    let (encoded_width, encoded_height) =
        unpack_ratio(unsafe { native.GetUINT64(&MF_MT_FRAME_SIZE) }.context("读取视频尺寸失败")?);
    if encoded_width == 0 || encoded_height == 0 {
        bail!("unsupported: 源媒体没有有效的视频尺寸");
    }
    let rotation = unsafe { native.GetUINT32(&MF_MT_VIDEO_ROTATION) }
        .unwrap_or(0)
        .rem_euclid(360) as u16;
    // 轨道级帧长：样本自带的 duration 无效时用它判片尾（macOS 那边同样的坑，
    // 见 `frames::DecodedFrame::duration_seconds`）。
    let track_frame_duration = unsafe { native.GetUINT64(&MF_MT_FRAME_RATE) }
        .ok()
        .map(unpack_ratio)
        .filter(|(numerator, denominator)| *numerator > 0 && *denominator > 0)
        .map(|(numerator, denominator)| f64::from(denominator) / f64::from(numerator));

    unsafe {
        reader.SetStreamSelection(ALL_STREAMS, false)?;
        reader.SetStreamSelection(VIDEO_STREAM, true)?;
    }
    let rgb32 = unsafe {
        let media_type = MFCreateMediaType()?;
        media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
        media_type
    };
    unsafe { reader.SetCurrentMediaType(VIDEO_STREAM, None, &rgb32) }.map_err(|error| {
        anyhow!("unsupported: Media Foundation 无法把该视频解成 RGB32（{error}）")
    })?;

    let from_hns = (from_seconds * HNS_PER_SECOND) as i64;
    if from_hns > 0 {
        let position = PROPVARIANT::from(from_hns);
        unsafe { reader.SetCurrentPosition(&GUID::zeroed(), &position) }.map_err(|error| {
            anyhow!("Media Foundation 无法定位到 {from_seconds:.3}s（{error}）")
        })?;
    }

    let (width, height) = if matches!(rotation, 90 | 270) {
        (encoded_height, encoded_width)
    } else {
        (encoded_width, encoded_height)
    };
    Ok(Box::new(SourceReaderFrames {
        reader,
        encoded_width: encoded_width as usize,
        encoded_height: encoded_height as usize,
        width,
        height,
        rotation,
        from_hns,
        track_frame_duration,
        finished: false,
        _runtime: runtime,
    }))
}

struct SourceReaderFrames {
    reader: IMFSourceReader,
    encoded_width: usize,
    encoded_height: usize,
    /// 摆正后的输出尺寸。
    width: u32,
    height: u32,
    rotation: u16,
    /// 流的起始媒体时刻（hns）。完全早于它的帧在搬像素之前就跳过。
    from_hns: i64,
    track_frame_duration: Option<f64>,
    finished: bool,
    /// COM + Media Foundation 的生命周期跟着流走（`Drop` 里 `MFShutdown` +
    /// `CoUninitialize`）。
    ///
    /// **必须是最后一个字段**：Rust 按声明顺序析构字段，放在 `reader` 前面
    /// 就会先 `MFShutdown` 再 Release 源读取器，等于在 MF 关停之后回调已经
    /// 卸载的解码器 MFT——实测 `bcut export` 收尾必崩 `0xC0000005`
    /// （`msmpeg2vdec.dll_unloaded`，调用方 `mfreadwrite.dll`），MP4 已经写
    /// 完整但退出码是访问违例。同理见 `encode_windows.rs` 的 `SinkWriter`。
    _runtime: Runtime,
}

impl crate::frames::FrameSource for SourceReaderFrames {
    fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn next_decoded(&mut self) -> Result<Option<crate::frames::DecodedFrame>> {
        if self.finished {
            return Ok(None);
        }
        loop {
            let (flags, timestamp, sample) = unsafe { read_sample(&self.reader)? };
            if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                self.finished = true;
                return Ok(None);
            }
            let Some(sample) = sample else {
                // 流间隙 / 格式变更通知：没有样本，继续读。
                continue;
            };
            let duration_hns = unsafe { sample.GetSampleDuration() }.ok();
            let duration_seconds = duration_hns
                .filter(|value| *value > 0)
                .map(|value| value as f64 / HNS_PER_SECOND)
                .or(self.track_frame_duration);
            // seek 落点到起点之间那批注定被丢掉的帧：整帧**完全早于**起点才跳，
            // 覆盖起点的那一帧（ts ≤ from < ts + dur）必须留下。
            if let Some(duration) = duration_hns.filter(|value| *value > 0)
                && timestamp + duration <= self.from_hns
            {
                continue;
            }
            let frame = unsafe {
                sample_to_rgba(
                    &sample,
                    self.encoded_width,
                    self.encoded_height,
                    self.rotation,
                )?
            };
            return Ok(Some(crate::frames::DecodedFrame {
                pts_seconds: timestamp as f64 / HNS_PER_SECOND,
                duration_seconds,
                frame,
            }));
        }
    }
}

#[cfg(test)]
mod tests {
    /// Media Foundation 的关停必须晚于它发出的每一个 COM 接口：`Runtime` 的
    /// `Drop` 会 `MFShutdown` + `CoUninitialize`，而 Rust 按**声明顺序**析构
    /// 字段，所以持有它的结构体必须把它写在最后一个字段。
    ///
    /// 曾经 `SourceReaderFrames` 把 `_runtime` 放在 `reader` 前面：MF 先关停，
    /// 随后才 Release 源读取器，`mfreadwrite.dll` 回调到已卸载的解码器 MFT，
    /// `bcut export` 每次收尾都以 `0xC0000005` 退出（MP4 其实已经写完整，只是
    /// 退出码是访问违例，调用方一律当成导出失败）。字段顺序没有类型能表达，
    /// 只能扫源码钉住。
    #[test]
    fn every_media_foundation_runtime_is_declared_as_the_last_droppable_field() {
        for file in ["windows.rs", "encode_windows.rs", "playback_windows.rs"] {
            let source = std::fs::read_to_string(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("src")
                    .join(file),
            )
            .expect("读取平台源码");
            for (index, line) in source.lines().enumerate() {
                if line.trim() != "_runtime: Runtime," {
                    continue;
                }
                // 后面只允许再出现没有析构行为的字段（当前只有 PhantomData），
                // 然后就必须是结构体的收尾 `}`。
                let rest = source
                    .lines()
                    .skip(index + 1)
                    .map(str::trim)
                    .filter(|line| !line.is_empty() && !line.starts_with("///"));
                for following in rest {
                    if following == "}" {
                        break;
                    }
                    assert!(
                        following.contains("PhantomData"),
                        "{file}:{} 的 Runtime 后面还有会析构的字段 `{following}`",
                        index + 1
                    );
                }
            }
        }
    }
}
