//! Windows 原生 MP4 写入：Media Foundation `IMFSinkWriter` + H.264 MFT + AAC MFT。
//!
//! 与 `core/crates/bcut-kernel/src/services/native_video/platform.rs` 的在产导出后端同源（媒体
//! 类型协商、NV12 输入优先、GOP 显式给死、faststart 能力探测），但场景简单得多：
//! 那边要一边解源码流一边合成字幕并按 CFR 网格铺帧，这边的帧由 `bcut-render`
//! 按序送到，写入端只剩"喂给编码器"。
//!
//! ## 输入格式优先 NV12
//!
//! 硬件 H.264 MFT 注册的输入是 NV12 系；直接对上可以免掉 MF 插进来的
//! RGB32→YUV 软件转换 MFT，也让硬件编码器真正被选中。4:2:0 要求宽高为偶数，
//! 而 [`crate::open_mp4_writer`] 已经在门口挡掉奇数画布，所以这里 NV12 一定
//! 谈得上号；谈判仍然可能因为本机没有 NV12 输入的编码器而失败，那时退回 RGB32。
//!
//! ## 音频是 16 位 PCM
//!
//! 混音是 f32，AAC MFT 的输入类型却是 16 位 PCM（`MFAudioFormat_PCM` 在 MF 里
//! 就只谈整数）。转换在这里做：夹到 [-1, 1] 之后按 32767 定标，与 ffmpeg
//! `-c:a aac` 前那一步 `f32 → s16` 的口径一致。

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use windows::Win32::Media::MediaFoundation::*;
use windows::core::{GUID, PCWSTR};

use crate::encode::{
    AUDIO_BITRATE, AUDIO_CHANNELS, AUDIO_LEAD_SECONDS, AUDIO_SAMPLE_RATE, Mp4Sink, PcmChunk,
    PcmSource, frame_rate_rational, video_bitrate,
};
use crate::windows::{Runtime, media_feature_error, pack_ratio, wide_path};

const HNS_PER_SECOND: i64 = 10_000_000;

/// 关键帧间隔（秒）。编码器默认的 GOP 在本仓库实测能稀到只剩首帧一个关键帧，
/// 拖动预览会很难受；2 秒与导出后端的取值一致。
const KEYFRAME_INTERVAL_SECONDS: f64 = 2.0;

// ── BT.709 limited range 定点系数（缩放 1<<16），顺序为 R、G、B。
//
// 与 `apps/cli` 导出后端逐位同值：色度两组系数各自求和为 0，亮度组求和为 219/255
// 的定点值，纯黑严格落在 Y=16/UV=128、纯白严格落在 Y=235/UV=128，不靠夹取兜底。
const BT709_LUMA: [i32; 3] = [11966, 40254, 4064];
const BT709_CHROMA_BLUE: [i32; 3] = [-6596, -22189, 28785];
const BT709_CHROMA_RED: [i32; 3] = [28785, -26145, -2640];

#[inline]
fn bt709_luma(red: u8, green: u8, blue: u8) -> u8 {
    let value = BT709_LUMA[0] * i32::from(red)
        + BT709_LUMA[1] * i32::from(green)
        + BT709_LUMA[2] * i32::from(blue);
    (16 + ((value + 32768) >> 16)).clamp(0, 255) as u8
}

#[inline]
fn bt709_chroma(coefficients: [i32; 3], red: i32, green: i32, blue: i32) -> u8 {
    let value = coefficients[0] * red + coefficients[1] * green + coefficients[2] * blue;
    (128 + ((value + 32768) >> 16)).clamp(0, 255) as u8
}

/// 2x2 块内四个分量的四舍五入均值。
#[inline]
fn average4(first: u8, second: u8, third: u8, fourth: u8) -> i32 {
    (i32::from(first) + i32::from(second) + i32::from(third) + i32::from(fourth) + 2) >> 2
}

/// top-down RGBA8 → NV12（BT.709 limited range，Y 平面后紧跟交错的 UV 平面）。
///
/// 前置条件：`width`、`height` 均为偶数，两个平面的行距都等于 `width`。色度按
/// 4:2:0 先求 2x2 块的 RGB 均值再转换，亮度仍逐像素独立。
fn rgba_to_nv12(rgba: &[u8], width: usize, height: usize, nv12: &mut [u8]) {
    debug_assert_eq!(width % 2, 0);
    debug_assert_eq!(height % 2, 0);
    let (luma, chroma) = nv12.split_at_mut(width * height);
    for pair in 0..height / 2 {
        let row = pair * 2;
        let (top, bottom) = rgba[row * width * 4..(row + 2) * width * 4].split_at(width * 4);
        let (luma_top, luma_bottom) = luma[row * width..(row + 2) * width].split_at_mut(width);
        let chroma_row = &mut chroma[pair * width..(pair + 1) * width];
        for block in 0..width / 2 {
            let offset = block * 8;
            let upper = &top[offset..offset + 8];
            let lower = &bottom[offset..offset + 8];
            luma_top[block * 2] = bt709_luma(upper[0], upper[1], upper[2]);
            luma_top[block * 2 + 1] = bt709_luma(upper[4], upper[5], upper[6]);
            luma_bottom[block * 2] = bt709_luma(lower[0], lower[1], lower[2]);
            luma_bottom[block * 2 + 1] = bt709_luma(lower[4], lower[5], lower[6]);
            let red = average4(upper[0], upper[4], lower[0], lower[4]);
            let green = average4(upper[1], upper[5], lower[1], lower[5]);
            let blue = average4(upper[2], upper[6], lower[2], lower[6]);
            chroma_row[block * 2] = bt709_chroma(BT709_CHROMA_BLUE, red, green, blue);
            chroma_row[block * 2 + 1] = bt709_chroma(BT709_CHROMA_RED, red, green, blue);
        }
    }
}

unsafe fn attributes(capacity: u32) -> Result<IMFAttributes> {
    let mut value = None;
    unsafe { MFCreateAttributes(&mut value, capacity) }
        .map_err(|error| media_feature_error("创建 Media Foundation 属性", error))?;
    value.context("Media Foundation 返回空属性对象")
}

unsafe fn video_type(
    subtype: &GUID,
    width: u32,
    height: u32,
    fps_num: u32,
    fps_den: u32,
) -> Result<IMFMediaType> {
    let media_type = unsafe { MFCreateMediaType()? };
    unsafe {
        media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media_type.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        media_type.SetUINT64(&MF_MT_FRAME_SIZE, pack_ratio(width, height))?;
        media_type.SetUINT64(&MF_MT_FRAME_RATE, pack_ratio(fps_num, fps_den))?;
        media_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_ratio(1, 1))?;
        media_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
    }
    Ok(media_type)
}

unsafe fn pcm_type() -> Result<IMFMediaType> {
    let media_type = unsafe { MFCreateMediaType()? };
    unsafe {
        media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        media_type.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM)?;
        media_type.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)?;
        media_type.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_SAMPLE_RATE)?;
        media_type.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        media_type.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 2 * AUDIO_CHANNELS)?;
        media_type.SetUINT32(
            &MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
            2 * AUDIO_CHANNELS * AUDIO_SAMPLE_RATE,
        )?;
        media_type.SetUINT32(&MF_MT_FIXED_SIZE_SAMPLES, 1)?;
        media_type.SetUINT32(&MF_MT_ALL_SAMPLES_INDEPENDENT, 1)?;
    }
    Ok(media_type)
}

unsafe fn aac_type() -> Result<IMFMediaType> {
    let media_type = unsafe { MFCreateMediaType()? };
    unsafe {
        media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        media_type.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC)?;
        media_type.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)?;
        media_type.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_SAMPLE_RATE)?;
        media_type.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        media_type.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, AUDIO_BITRATE / 8)?;
        media_type.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 1)?;
        media_type.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0)?;
        media_type.SetUINT32(&MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, 0x29)?;
        media_type.SetUINT32(&MF_MT_AUDIO_PREFER_WAVEFORMATEX, 1)?;
    }
    Ok(media_type)
}

/// 一块像素字节 → 带时间戳的 `IMFSample`。
unsafe fn sample_from_bytes(pixels: &[u8], time: i64, duration: i64) -> Result<IMFSample> {
    let length: u32 = pixels
        .len()
        .try_into()
        .context("单帧超过 4 GiB，Media Foundation 缓冲装不下")?;
    let buffer = unsafe { MFCreateMemoryBuffer(length)? };
    let mut pointer = std::ptr::null_mut();
    unsafe { buffer.Lock(&mut pointer, None, None)? };
    unsafe { std::slice::from_raw_parts_mut(pointer, pixels.len()) }.copy_from_slice(pixels);
    unsafe {
        buffer.Unlock()?;
        buffer.SetCurrentLength(length)?;
    }
    let sample = unsafe { MFCreateSample()? };
    unsafe {
        sample.AddBuffer(&buffer)?;
        sample.SetSampleTime(time)?;
        sample.SetSampleDuration(duration)?;
    }
    Ok(sample)
}

/// faststart 探测用的临时文件：与真实输出同目录（同卷同文件系统），名字带独有
/// 后缀，绝不与真实输出路径撞名。
fn faststart_probe_path(output: &Path) -> PathBuf {
    let mut name = output
        .file_name()
        .map(|value| value.to_os_string())
        .unwrap_or_default();
    name.push(".faststart-probe.mp4");
    output.with_file_name(name)
}

/// 往临时文件写一段 96x64 的黑帧并 Finalize，验证本机 MP4 sink 能否重写出前置
/// moov。硬件转换显式关掉：moov 布局是 sink 侧行为，与哪个编码器 MFT 喂它无关。
unsafe fn faststart_probe(path: &Path) -> Result<()> {
    const WIDTH: u32 = 96;
    const HEIGHT: u32 = 64;
    const FPS: u32 = 30;
    let attrs = unsafe { attributes(2)? };
    unsafe {
        attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 0)?;
        attrs.SetUINT32(&MF_MPEG4SINK_MOOV_BEFORE_MDAT, 1)?;
    }
    let wide = wide_path(path);
    let writer = unsafe {
        MFCreateSinkWriterFromURL(PCWSTR(wide.as_ptr()), None::<&IMFByteStream>, &attrs)?
    };
    let encoded = unsafe { video_type(&MFVideoFormat_H264, WIDTH, HEIGHT, FPS, 1)? };
    unsafe {
        encoded.SetUINT32(&MF_MT_AVG_BITRATE, 100_000)?;
        encoded.SetUINT32(&MF_MT_MPEG2_PROFILE, 100)?;
    }
    let stream = unsafe { writer.AddStream(&encoded)? };
    let input = unsafe { video_type(&MFVideoFormat_RGB32, WIDTH, HEIGHT, FPS, 1)? };
    unsafe {
        writer.SetInputMediaType(stream, &input, None::<&IMFAttributes>)?;
        writer.BeginWriting()?;
    }
    let frame_duration = HNS_PER_SECOND / i64::from(FPS);
    let pixels = vec![0_u8; (WIDTH * HEIGHT * 4) as usize];
    for index in 0..2_i64 {
        let sample = unsafe { sample_from_bytes(&pixels, index * frame_duration, frame_duration)? };
        unsafe { writer.WriteSample(stream, &sample)? };
    }
    unsafe { writer.Finalize()? };
    Ok(())
}

/// 本机 MP4 sink 是否支持 moov 前置。
///
/// 部分 Windows 版本上 `MF_MPEG4SINK_MOOV_BEFORE_MDAT=1` 会让 Finalize 直接返回
/// `E_ACCESSDENIED`，整个渲染白跑；同一份代码在别的机器上又是好的。所以按「本机
/// 能力」开工前探一次。探测本身出任何意外都算不支持：探测坏了绝不能拖垮一次本来
/// 能成的渲染。
fn faststart_finalize_works(output: &Path) -> bool {
    let path = faststart_probe_path(output);
    let outcome = unsafe { faststart_probe(&path) };
    // COM 对象已随 `faststart_probe` 返回全部释放，无论成败都清掉临时文件。
    let _ = std::fs::remove_file(&path);
    outcome.is_ok()
}

struct AudioTrack {
    stream: u32,
    source: PcmSource,
    /// PCM 已读完。
    finished: bool,
}

pub(crate) struct SinkWriter {
    /// COM + Media Foundation 的生命周期跟着写入器走（`Drop` 里 `MFShutdown`）。
    /// 字段顺序即析构顺序：writer 先释放，runtime 后关。
    writer: IMFSinkWriter,
    video_stream: u32,
    audio: Option<AudioTrack>,
    width: usize,
    height: usize,
    fps_num: u32,
    fps_den: u32,
    /// 编码器输入用 NV12（否则 RGB32）。
    nv12: bool,
    /// 跨帧复用的输入缓冲，只在第一帧分配。
    staging: Vec<u8>,
    frames: u64,
    _runtime: Runtime,
}

pub(crate) fn open(
    out: &Path,
    width: u32,
    height: u32,
    fps: f64,
    audio: Option<PcmSource>,
    bitrate: Option<u32>,
) -> Result<Box<dyn Mp4Sink>> {
    let runtime = Runtime::start()?;
    let writer = unsafe { open_inner(runtime, out, width, height, fps, audio, bitrate) }?;
    Ok(Box::new(writer) as Box<dyn Mp4Sink>)
}

unsafe fn open_inner(
    runtime: Runtime,
    out: &Path,
    width: u32,
    height: u32,
    fps: f64,
    audio: Option<PcmSource>,
    bitrate: Option<u32>,
) -> Result<SinkWriter> {
    let (fps_num, fps_den) = frame_rate_rational(fps);
    let exact_fps = f64::from(fps_num) / f64::from(fps_den);
    let faststart = faststart_finalize_works(out);
    if !faststart {
        eprintln!(
            "warning: 本机 Media Foundation 不支持 moov 前置（faststart），已回退为标准 MP4 布局"
        );
    }
    let writer_attrs = unsafe { attributes(2)? };
    unsafe {
        writer_attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)?;
        writer_attrs.SetUINT32(&MF_MPEG4SINK_MOOV_BEFORE_MDAT, u32::from(faststart))?;
    }
    let output_path = wide_path(out);
    let writer = unsafe {
        MFCreateSinkWriterFromURL(
            PCWSTR(output_path.as_ptr()),
            None::<&IMFByteStream>,
            &writer_attrs,
        )
    }
    .map_err(|error| media_feature_error("创建 MP4 Sink Writer", error))?;

    let encoded_video =
        unsafe { video_type(&MFVideoFormat_H264, width, height, fps_num, fps_den)? };
    unsafe {
        encoded_video.SetUINT32(
            &MF_MT_AVG_BITRATE,
            bitrate.unwrap_or_else(|| video_bitrate(width, height, exact_fps)),
        )?;
        encoded_video.SetUINT32(&MF_MT_MPEG2_PROFILE, 100)?;
        // GOP 必须显式给死：编码器默认的关键帧间隔在本仓库实测能稀到只剩首帧
        // 一个关键帧。GOP 长度不进 avcC/序列头，不影响格式描述的相等性判定。
        encoded_video.SetUINT32(
            &MF_MT_MAX_KEYFRAME_SPACING,
            ((exact_fps * KEYFRAME_INTERVAL_SECONDS).round() as u32).max(1),
        )?;
    }
    let video_stream = unsafe { writer.AddStream(&encoded_video) }.map_err(|error| {
        media_feature_error(
            "unsupported: 创建 H.264 输出流（系统可能缺少视频编码器）",
            error,
        )
    })?;

    // NV12 优先（硬件 MFT 的原生输入）；谈不成退回 RGB32。奇数画布已被
    // `open_mp4_writer` 挡在门外，这里不必再判偶数。
    let nv12 = {
        let media_type =
            unsafe { video_type(&MFVideoFormat_NV12, width, height, fps_num, fps_den)? };
        unsafe {
            media_type.SetUINT32(&MF_MT_DEFAULT_STRIDE, width)?;
            // 显式标注矩阵与量化范围：不标的话编码器可能按 BT.601 打标记，
            // 播放端就会偏色。
            media_type.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
            media_type.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
            writer
                .SetInputMediaType(video_stream, &media_type, None::<&IMFAttributes>)
                .is_ok()
        }
    };
    if !nv12 {
        let input_video =
            unsafe { video_type(&MFVideoFormat_RGB32, width, height, fps_num, fps_den)? };
        unsafe { writer.SetInputMediaType(video_stream, &input_video, None::<&IMFAttributes>) }
            .map_err(|error| media_feature_error("unsupported: 配置 RGB32→H.264 编码器", error))?;
    }

    let audio = match audio {
        Some(source) => {
            let encoded_audio = unsafe { aac_type()? };
            let stream = unsafe { writer.AddStream(&encoded_audio) }
                .map_err(|error| media_feature_error("unsupported: 创建 AAC-LC 输出流", error))?;
            let pcm = unsafe { pcm_type()? };
            unsafe { writer.SetInputMediaType(stream, &pcm, None::<&IMFAttributes>) }
                .map_err(|error| media_feature_error("unsupported: 配置 PCM→AAC 编码器", error))?;
            Some(AudioTrack {
                stream,
                source,
                finished: false,
            })
        }
        None => None,
    };
    unsafe { writer.BeginWriting() }
        .map_err(|error| media_feature_error("unsupported: 启动 MP4 写入", error))?;

    Ok(SinkWriter {
        writer,
        video_stream,
        audio,
        width: width as usize,
        height: height as usize,
        fps_num,
        fps_den,
        nv12,
        staging: Vec::new(),
        frames: 0,
        _runtime: runtime,
    })
}

impl SinkWriter {
    fn frame_duration_hns(&self) -> i64 {
        HNS_PER_SECOND * i64::from(self.fps_den) / i64::from(self.fps_num.max(1))
    }

    fn video_seconds(&self) -> f64 {
        self.frames as f64 * f64::from(self.fps_den) / f64::from(self.fps_num)
    }

    /// 把音频喂到 `limit_seconds`（音频时间轴上的硬上限）。
    ///
    /// `IMFSinkWriter::WriteSample` 自己做交织与背压（内部队列），不像
    /// AVFoundation 那样要外部轮询就绪位，所以这里是纯粹的"按需推进"。
    fn pump_audio(&mut self, limit_seconds: f64) -> Result<()> {
        let Some(audio) = self.audio.as_mut() else {
            return Ok(());
        };
        while !audio.finished && audio.source.position_seconds() < limit_seconds {
            let Some(chunk) = audio.source.next_chunk()? else {
                audio.finished = true;
                break;
            };
            let sample = unsafe { pcm_sample(&chunk)? };
            unsafe { self.writer.WriteSample(audio.stream, &sample) }
                .map_err(|error| anyhow!("Media Foundation 写入 AAC 音频失败：{error}"))?;
        }
        Ok(())
    }
}

/// 一块交织 f32 PCM → 16 位 PCM 的 `IMFSample`。
unsafe fn pcm_sample(chunk: &PcmChunk) -> Result<IMFSample> {
    let mut bytes = Vec::with_capacity(chunk.samples.len() * 2);
    for sample in &chunk.samples {
        let value = (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    let rate = i64::from(AUDIO_SAMPLE_RATE);
    let time = chunk.start_frame as i64 * HNS_PER_SECOND / rate;
    let duration = chunk.frames() as i64 * HNS_PER_SECOND / rate;
    unsafe { sample_from_bytes(&bytes, time, duration) }
}

impl Mp4Sink for SinkWriter {
    fn write_frame(&mut self, rgba: &[u8]) -> Result<()> {
        let expected = self.width * self.height * 4;
        if rgba.len() != expected {
            bail!(
                "MP4 帧字节数与几何不符：{}x{} 需要 {expected} 字节，实得 {}",
                self.width,
                self.height,
                rgba.len()
            );
        }
        self.pump_audio(self.video_seconds() + AUDIO_LEAD_SECONDS)?;
        let (width, height) = (self.width, self.height);
        if self.nv12 {
            self.staging.resize(width * height * 3 / 2, 0);
            rgba_to_nv12(rgba, width, height, &mut self.staging);
        } else {
            // RGB32 的连续缓冲是 bottom-up，内存序 B,G,R,X。
            self.staging.resize(width * height * 4, 0);
            for y in 0..height {
                let source = &rgba[y * width * 4..(y + 1) * width * 4];
                let target_row = height - 1 - y;
                let target =
                    &mut self.staging[target_row * width * 4..(target_row + 1) * width * 4];
                for (source, target) in source.chunks_exact(4).zip(target.chunks_exact_mut(4)) {
                    target[0] = source[2];
                    target[1] = source[1];
                    target[2] = source[0];
                    target[3] = source[3];
                }
            }
        }
        let duration = self.frame_duration_hns();
        let time = self.frames as i64 * duration;
        let sample = unsafe { sample_from_bytes(&self.staging, time, duration)? };
        unsafe { self.writer.WriteSample(self.video_stream, &sample) }
            .map_err(|error| anyhow!("Media Foundation 写入视频帧失败：{error}"))?;
        self.frames += 1;
        Ok(())
    }

    fn finish(mut self: Box<Self>) -> Result<()> {
        // 剩余音频按 ffmpeg 的 `-shortest` 截到视频末尾。
        let video_end = self.video_seconds();
        self.pump_audio(video_end)?;
        // 半途丢弃（渲染出错 / 取消）不调 `Finalize`：sink 释放时留下一份没有
        // moov 的半截文件，调用方本来就在临时文件上渲染，直接删掉即可。
        unsafe { self.writer.Finalize() }
            .map_err(|error| anyhow!("Media Foundation 完成 MP4 失败：{error}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 纯色块的 NV12 换算与 `apps/cli` 导出后端逐位同值（同一组定点系数）：
    /// 纯黑落在 Y=16/UV=128，纯白落在 Y=235/UV=128。
    #[test]
    fn solid_colours_land_on_the_limited_range_anchors() {
        let mut nv12 = vec![0_u8; 2 * 2 * 3 / 2];
        let black = vec![0_u8, 0, 0, 255].repeat(4);
        rgba_to_nv12(&black, 2, 2, &mut nv12);
        assert_eq!(&nv12[..4], &[16, 16, 16, 16]);
        assert_eq!(&nv12[4..], &[128, 128]);
        let white = vec![255_u8, 255, 255, 255].repeat(4);
        rgba_to_nv12(&white, 2, 2, &mut nv12);
        assert_eq!(&nv12[..4], &[235, 235, 235, 235]);
        assert_eq!(&nv12[4..], &[128, 128]);
    }
}
