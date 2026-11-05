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
use windows::core::{GUID, Interface, PCWSTR};

use crate::encode::{
    AUDIO_CHANNELS, AUDIO_LEAD_SECONDS, AUDIO_SAMPLE_RATE, EncoderDevice, Mp4Sink, PcmChunk,
    PcmSource, WriterSetup,
};
use crate::windows::{Runtime, media_feature_error, pack_ratio, wide_path};
use crate::yuv::{rgba_to_bottom_up_bgrx, rgba_to_nv12};

const HNS_PER_SECOND: i64 = 10_000_000;

/// 关键帧间隔（秒）。编码器默认的 GOP 在本仓库实测能稀到只剩首帧一个关键帧，
/// 拖动预览会很难受；2 秒与导出后端的取值一致。
const KEYFRAME_INTERVAL_SECONDS: f64 = 2.0;

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

/// AAC-LC 输出类型。MF 的 AAC 编码器只接受 96/128/160/192 kbps 四档
/// （`MF_MT_AUDIO_AVG_BYTES_PER_SECOND` 取 12000/16000/20000/24000），
/// 其余请求就近取档。
unsafe fn aac_type(bitrate: u32) -> Result<IMFMediaType> {
    let bytes_per_second = [12_000u32, 16_000, 20_000, 24_000]
        .into_iter()
        .min_by_key(|candidate| candidate.abs_diff(bitrate / 8))
        .unwrap_or(16_000);
    let media_type = unsafe { MFCreateMediaType()? };
    unsafe {
        media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        media_type.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC)?;
        media_type.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)?;
        media_type.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_SAMPLE_RATE)?;
        media_type.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        media_type.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, bytes_per_second)?;
        media_type.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 1)?;
        media_type.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0)?;
        media_type.SetUINT32(&MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, 0x29)?;
        media_type.SetUINT32(&MF_MT_AUDIO_PREFER_WAVEFORMATEX, 1)?;
    }
    Ok(media_type)
}

/// 帧率 `fps_num / fps_den` 下第 `index` 帧的起点（hns）：按有理数逐帧算，向下取整再加 1 hns（首帧为 0）。
///
/// 不能用「单帧时长 × 帧号」：29.97 fps 的单帧是 333666.67 hns，截成 333666 后每帧少 0.67 hns，几百帧后换算到
/// MP4 时标就差出一个 tick。也不能四舍五入或向上取整：Sink 换到容器时标时向下截，恰好落在 tick 边界上的时刻
/// （30 fps 的 333333.33 hns 一帧、时标 30000 时每 3 帧一次）会因浮点误差少一个 tick，`mdhd` 的时长随之短一个
/// tick，读回的末帧时长与帧率就不齐（Windows 11 实测：四舍五入时 1–130 帧里约四成的帧数出错，含 30 fps；本写法
/// 在 23.976 / 29.97 / 59.94 / 30 fps 上全部正确）。多出的 1 hns 远小于一个 tick（≥ 166 hns），帧长不受影响。
fn frame_time_hns(index: u64, fps_num: u32, fps_den: u32) -> i64 {
    if index == 0 {
        return 0;
    }
    let numerator = u128::from(index) * HNS_PER_SECOND as u128 * u128::from(fps_den);
    (numerator / u128::from(fps_num.max(1))) as i64 + 1
}

/// 写进媒体类型的帧率。
///
/// MP4 Sink 按 `round(1000 × 帧率)` 定视频轨的时标，再把样本时刻换算过去（Windows 11 实测）：29.97（30000/1001）的
/// 时标成了 29970、每帧 1000 tick，容器存的是 2997/100，ffprobe 的 `r_frame_rate` 与输出帧率差 3e-5，Runtime 的发布
/// 校验（1e-6）通不过。NTSC 系（`k/1001`）因此在类型上声明整数帧率 `k/1000`：时标成了 `k`，样本时刻仍按真实帧率给，
/// 每帧恰好 1001 tick，读回 30000/1001。代价是编码器以为是 30 fps：码流 VUI 的 timing 写的是 30 fps（MP4 的播放与
/// 探测都以容器的时间戳为准），码控按 30 fps 分配每帧比特，实际码率比设定低 0.1%。
fn declared_frame_rate(fps_num: u32, fps_den: u32) -> (u32, u32) {
    if fps_den == 1001 && fps_num.is_multiple_of(1000) {
        (fps_num / 1000, 1)
    } else {
        (fps_num, fps_den)
    }
}

/// 一块字节 → 带时间戳的 `IMFSample`。
unsafe fn sample_from_bytes(bytes: &[u8], time: i64, duration: i64) -> Result<IMFSample> {
    unsafe {
        sample_filled_with(bytes.len(), time, duration, |buffer| {
            buffer.copy_from_slice(bytes)
        })
    }
}

/// 新建一块 `length` 字节的 Media Foundation 缓冲，`fill` 直接写进锁住的内存，再包成带时间戳的 `IMFSample`。
///
/// 视频帧就这样把 RGBA → NV12 的换算直接写进编码器要的缓冲，不先转进一块暂存再整帧拷一遍。缓冲每次新建、不跨帧
/// 复用：Sink Writer 可能异步持有已交出的 sample。
unsafe fn sample_filled_with(
    length: usize,
    time: i64,
    duration: i64,
    fill: impl FnOnce(&mut [u8]),
) -> Result<IMFSample> {
    let length_u32: u32 = length
        .try_into()
        .context("单帧超过 4 GiB，Media Foundation 缓冲装不下")?;
    let buffer = unsafe { MFCreateMemoryBuffer(length_u32)? };
    let mut pointer = std::ptr::null_mut();
    let mut maximum = 0_u32;
    unsafe { buffer.Lock(&mut pointer, Some(&mut maximum), None)? };
    // Lock 与 Unlock 之间不用 `?`：先记下结果，解锁无条件执行。
    let locked = if pointer.is_null() || (maximum as usize) < length {
        Err(anyhow!("Media Foundation 给的缓冲小于 {length} 字节"))
    } else {
        fill(unsafe { std::slice::from_raw_parts_mut(pointer, length) });
        Ok(())
    };
    let unlocked = unsafe { buffer.Unlock() };
    locked?;
    unlocked?;
    unsafe { buffer.SetCurrentLength(length_u32)? };
    let sample = unsafe { MFCreateSample()? };
    unsafe {
        sample.AddBuffer(&buffer)?;
        sample.SetSampleTime(time)?;
        sample.SetSampleDuration(duration)?;
    }
    Ok(sample)
}

/// Sink Writer 给视频流挑中的编码器 MFT（`MFT_CATEGORY_VIDEO_ENCODER` 那一个）。`BeginWriting` 之后才建好整条链。
unsafe fn video_encoder(writer: &IMFSinkWriter, stream: u32) -> Option<IMFTransform> {
    let writer = writer.cast::<IMFSinkWriterEx>().ok()?;
    // 链上还可能有颜色转换之类的 MFT；按序问到出错为止。
    for index in 0..8 {
        let mut category = GUID::zeroed();
        let mut transform = None;
        unsafe { writer.GetTransformForStream(stream, index, Some(&mut category), &mut transform) }
            .ok()?;
        if category == MFT_CATEGORY_VIDEO_ENCODER {
            return transform;
        }
    }
    None
}

/// 实际选中的编码器的名字与软硬件。问不出来时 `None`：只影响报告，不影响写入。
unsafe fn video_encoder_device(writer: &IMFSinkWriter, stream: u32) -> Option<EncoderDevice> {
    let encoder = unsafe { video_encoder(writer, stream)? };
    let attributes = unsafe { encoder.GetAttributes() }.ok()?;
    let hardware = unsafe { attributes.GetItem(&MFT_ENUM_HARDWARE_URL_Attribute, None) }.is_ok();
    // 硬件 MFT 都带友好名；微软的软件编码器不带，按 CLSID 认。
    let name = unsafe { attribute_string(&attributes, &MFT_FRIENDLY_NAME_Attribute) }
        .or_else(|| {
            let clsid = unsafe { attributes.GetGUID(&MFT_TRANSFORM_CLSID_Attribute) }.ok()?;
            Some(if clsid == CLSID_MSH264EncoderMFT {
                "Microsoft H.264 Encoder MFT".to_string()
            } else {
                format!("{clsid:?}")
            })
        })
        .unwrap_or_else(|| "unknown".to_string());
    Some(EncoderDevice { name, hardware })
}

unsafe fn attribute_string(attributes: &IMFAttributes, key: &GUID) -> Option<String> {
    let length = unsafe { attributes.GetStringLength(key) }.ok()?;
    let mut buffer = vec![0_u16; length as usize + 1];
    unsafe { attributes.GetString(key, &mut buffer, None) }.ok()?;
    buffer.truncate(length as usize);
    Some(String::from_utf16_lossy(&buffer))
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
    frames: u64,
    /// Sink Writer 实际选中的 H.264 编码器。
    encoder: Option<EncoderDevice>,
    _runtime: Runtime,
}

pub(crate) fn open(out: &Path, setup: WriterSetup) -> Result<Box<dyn Mp4Sink>> {
    let runtime = Runtime::start()?;
    let writer = unsafe { open_inner(runtime, out, setup) }?;
    Ok(Box::new(writer) as Box<dyn Mp4Sink>)
}

unsafe fn open_inner(runtime: Runtime, out: &Path, setup: WriterSetup) -> Result<SinkWriter> {
    let WriterSetup {
        width,
        height,
        fps_num,
        fps_den,
        bitrate,
        // Media Foundation 的 H.264 MFT 有质量档（`eAVEncCommonRateControlMode_Quality`），但各家硬件编码器
        // 支持不一、还没在实机上标定，先照旧按平均码率编码（`docs/design/export/windows-media-path-todo.md` W10）。
        quality: _,
        audio,
        audio_bitrate,
    } = setup;
    let exact_fps = f64::from(fps_num) / f64::from(fps_den);
    // 媒体类型上的帧率；样本时刻始终按真实帧率 `fps_num / fps_den` 给（见 `declared_frame_rate`）。
    let (rate_num, rate_den) = declared_frame_rate(fps_num, fps_den);
    let gop = ((exact_fps * KEYFRAME_INTERVAL_SECONDS).round() as u32).max(1);
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
        unsafe { video_type(&MFVideoFormat_H264, width, height, rate_num, rate_den)? };
    unsafe {
        encoded_video.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
        encoded_video.SetUINT32(&MF_MT_MPEG2_PROFILE, 100)?;
        // BT.709 色彩标记写在输出类型上，H.264 MFT 据此填 VUI（primaries /
        // transfer / matrix；RTX 3060 的 NVIDIA MFT 上 ffprobe 核验过）。
        encoded_video.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32)?;
        encoded_video.SetUINT32(&MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709.0 as u32)?;
        encoded_video.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
        encoded_video.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
        // GOP 必须显式给死：编码器默认的关键帧间隔在本仓库实测能稀到只剩首帧
        // 一个关键帧。GOP 长度不进 avcC/序列头，不影响格式描述的相等性判定。
        // 有的 MFT 只认下面编码器参数里的 `CODECAPI_AVEncMPVGOPSize`，两处都给。
        encoded_video.SetUINT32(&MF_MT_MAX_KEYFRAME_SPACING, gop)?;
    }
    let video_stream = unsafe { writer.AddStream(&encoded_video) }.map_err(|error| {
        media_feature_error(
            "unsupported: 创建 H.264 输出流（系统可能缺少视频编码器）",
            error,
        )
    })?;

    // 编码器参数：Sink Writer 把这份属性按 `ICodecAPI` 交给它挑中的 MFT（Windows 11 / RTX 3060 实测）。
    //
    // - GOP：NVIDIA 的 H.264 MFT 不看输出类型上的 `MF_MT_MAX_KEYFRAME_SPACING`，720p 起每 30 帧一个关键帧，
    //   `CODECAPI_AVEncMPVGOPSize` 才生效（60 帧）。
    // - 不用 B 帧：微软的软件编码器缺省带 B 帧，MP4 Sink 写组合时间偏移却不写编辑表，画面整体晚一帧开始
    //   （ffprobe 的 `start_time` 0.0333 秒，声音从 0 开始）。NVIDIA 的 MFT 本来就不出 B 帧。
    let encoding = unsafe { attributes(2)? };
    unsafe {
        encoding.SetUINT32(&CODECAPI_AVEncMPVGOPSize, gop)?;
        encoding.SetUINT32(&CODECAPI_AVEncMPVDefaultBPictureCount, 0)?;
    }
    // NV12 优先（硬件 MFT 的原生输入）；谈不成退回 RGB32。奇数画布已被
    // `open_mp4_writer` 挡在门外，这里不必再判偶数。
    let nv12 = {
        let media_type =
            unsafe { video_type(&MFVideoFormat_NV12, width, height, rate_num, rate_den)? };
        unsafe {
            media_type.SetUINT32(&MF_MT_DEFAULT_STRIDE, width)?;
            // 显式标注矩阵与量化范围：不标的话编码器可能按 BT.601 打标记，
            // 播放端就会偏色。
            media_type.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
            media_type.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
            writer
                .SetInputMediaType(video_stream, &media_type, &encoding)
                .is_ok()
        }
    };
    if !nv12 {
        let input_video =
            unsafe { video_type(&MFVideoFormat_RGB32, width, height, rate_num, rate_den)? };
        unsafe { writer.SetInputMediaType(video_stream, &input_video, &encoding) }
            .map_err(|error| media_feature_error("unsupported: 配置 RGB32→H.264 编码器", error))?;
    }

    let audio = match audio {
        Some(source) => {
            let encoded_audio = unsafe { aac_type(audio_bitrate)? };
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
    let encoder = unsafe { video_encoder_device(&writer, video_stream) };

    Ok(SinkWriter {
        writer,
        video_stream,
        audio,
        width: width as usize,
        height: height as usize,
        fps_num,
        fps_den,
        nv12,
        frames: 0,
        encoder,
        _runtime: runtime,
    })
}

impl SinkWriter {
    /// 第 `index` 帧的起点（hns）。
    fn frame_time_hns(&self, index: u64) -> i64 {
        frame_time_hns(index, self.fps_num, self.fps_den)
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
        let time = self.frame_time_hns(self.frames);
        let duration = self.frame_time_hns(self.frames + 1) - time;
        // 换算直接写进交给编码器的缓冲（NV12，或回落时的 RGB32）。
        let sample = if self.nv12 {
            unsafe {
                sample_filled_with(width * height * 3 / 2, time, duration, |buffer| {
                    rgba_to_nv12(rgba, width, height, buffer)
                })?
            }
        } else {
            unsafe {
                sample_filled_with(width * height * 4, time, duration, |buffer| {
                    rgba_to_bottom_up_bgrx(rgba, width, height, buffer)
                })?
            }
        };
        unsafe { self.writer.WriteSample(self.video_stream, &sample) }
            .map_err(|error| anyhow!("Media Foundation 写入视频帧失败：{error}"))?;
        self.frames += 1;
        Ok(())
    }

    fn encoder(&self) -> Option<&EncoderDevice> {
        self.encoder.as_ref()
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

    /// 帧起点按有理数逐帧算、不累积单帧时长的截断，且总比真实时刻多不到 1 hns（首帧为 0）：29.97 fps 第 30 帧
    /// 在 1.001 秒之后 1 hns，一小时后仍是 1 hns。
    #[test]
    fn frame_times_follow_the_exact_rational_rate() {
        assert_eq!(frame_time_hns(0, 30000, 1001), 0);
        assert_eq!(frame_time_hns(1, 30000, 1001), 333_667);
        assert_eq!(frame_time_hns(2, 30000, 1001), 667_334);
        assert_eq!(frame_time_hns(30, 30000, 1001), 10_010_001);
        assert_eq!(frame_time_hns(108_000, 30000, 1001), 36_036_000_001);
        assert_eq!(frame_time_hns(3, 30, 1), 1_000_001);
    }

    /// 只有 NTSC 系换成整数帧率声明，其余原样。
    #[test]
    fn ntsc_rates_are_declared_as_their_integer_neighbour() {
        assert_eq!(declared_frame_rate(30000, 1001), (30, 1));
        assert_eq!(declared_frame_rate(24000, 1001), (24, 1));
        assert_eq!(declared_frame_rate(60000, 1001), (60, 1));
        assert_eq!(declared_frame_rate(30, 1), (30, 1));
        assert_eq!(declared_frame_rate(12500, 1000), (12500, 1000));
    }
}
