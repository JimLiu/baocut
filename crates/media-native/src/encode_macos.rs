//! macOS 原生 MP4 写入：`VTCompressionSession` 编 H.264，`AVAssetWriter` 封装（视频直通、音频 AAC）。
//!
//! ## 为什么自己开压缩会话
//!
//! 让 `AVAssetWriterInput` 带输出设置替我们压缩时只有两种选择，都不够好（验收与测试 §4 有实测）：
//! 声明实时源（`expectsMediaDataInRealTime`）时 VideoToolbox 只用一个编码引擎，两个引擎的芯片上吞吐少四成；
//! 离线源能用满引擎，但 AVFoundation 内部的压缩线程在 utility 档，机器一忙就被挤掉。
//! 直接开离线的压缩会话，引擎用满，线程又跟着写线程的 QoS。压缩好的样本再经直通的输入封装，码流与
//! AVFoundation 自己压的一样（High、B 帧、关键帧间隔、level、BT.709 标记）。
//!
//! 期望帧率必须是真实帧率：调高它也能解开实时源的上限，但 `AutoLevel` 会跟着把 H.264 level 抬到 5.2 以上，
//! 老设备解不了；显式钉住 level 又会被编码器拒绝。
//!
//! ## 恒定质量
//!
//! 调用方给了质量（[`crate::Mp4Options::video_quality`]）时，Apple 芯片上设 `kVTCompressionPropertyKey_Quality`，
//! 码率随内容长；平均码率照样设上：M5 Max 上两者都设时质量说了算（码流与只设质量的逐字节相同），万一别的芯片
//! 反过来，就还是原来的平均码率。码率上限由写线程按压好的样本大小管（[`crate::quality_cap`]），编码器自己的上限
//! 用不上，原因见那里。Intel Mac 不设质量：ffmpeg 也只在 Apple 芯片上开放 VideoToolbox 的质量档。
//!
//! 结构与 `core/crates/bcut-kernel/src/services/native_video.rs` 的在产导出后端同源（那是这套栈
//! 在本仓库的第一处实现），但这里的场景简单得多，因此**没有**照抄它的流水线：
//! 那边要一边解源码流一边合成字幕，帧的生产成本高，值得单开一条提交线程；这边
//! 的帧由 `bcut-render` 的 worker 池并行光栅化之后按序送到，写入端只剩"喂给
//! 编码器"，再加一层线程只会多一次 8 MB 拷贝和一份 SAFETY 论证。背压因此就地
//! 承担（见下面的「线程」）。
//!
//! ## 音频是自造的 `CMSampleBuffer`
//!
//! 导出后端的音频来自 `AVAssetReader`（源文件里现成的样本），这里的音频是
//! `bcut-render` 混出来的裸 f32le PCM，没有任何容器。所以要自己搭一层：
//! `CMBlockBuffer`（拷进 PCM 字节）+ `CMAudioFormatDescription`（ASBD 描述
//! "48 kHz 立体声交织 f32"）→ `CMAudioSampleBufferCreateReadyWithPacketDescriptions`。
//! 写入端的 `AVAssetWriterInput` 挂的是 AAC 输出设置，转码由 AVFoundation 完成
//! （与导出后端把源 LPCM 喂进 AAC 输入是同一条路径）。
//!
//! ## 交织
//!
//! `AVAssetWriter` 为保持轨道交织，会在一条轨落后太多时压住另一条轨的就绪位。
//! 单线程写两条轨时这一点是死锁面：必须在等视频就绪的**循环里**继续喂音频，
//! 不能先把视频等到就绪再管音频。见 [`AvWriter::pump_audio`] 的调用点。
//!
//! ## 线程
//!
//! 编码回调在 VideoToolbox 的线程上，只把样本放进 [`Encoded`]，从不阻塞；写线程送完一帧就取出来追加进封装。
//! 所有 `AVAssetWriter` 调用都在写线程。背压靠两处：编码器满了 `VTCompressionSessionEncodeFrame` 自己阻塞，
//! 封装跟不上时写线程停在 [`AvWriter::drain_encoded`] 里不送下一帧。

#![allow(deprecated)]

use std::collections::VecDeque;
use std::path::Path;
use std::ptr::{self, NonNull};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use block2::RcBlock;
use objc2::AnyThread;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus, AVFileTypeMPEG4, AVMediaTypeAudio,
    AVMediaTypeVideo,
};
use objc2_avf_audio::{AVEncoderBitRateKey, AVFormatIDKey, AVNumberOfChannelsKey, AVSampleRateKey};
use objc2_core_audio_types::{
    AudioStreamBasicDescription, kAudioFormatFlagIsFloat, kAudioFormatFlagIsPacked,
    kAudioFormatFlagsNativeEndian, kAudioFormatLinearPCM, kAudioFormatMPEG4AAC,
};
use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_media::{
    CMAudioFormatDescriptionCreate, CMAudioSampleBufferCreateReadyWithPacketDescriptions,
    CMBlockBuffer, CMFormatDescription, CMSampleBuffer, CMTime, kCMBlockBufferAssureMemoryNowFlag,
    kCMFormatDescriptionColorPrimaries_ITU_R_709_2,
    kCMFormatDescriptionTransferFunction_ITU_R_709_2, kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2,
    kCMTimeInvalid, kCMVideoCodecType_H264,
};
use objc2_core_video::{
    CVPixelBuffer, CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow,
    CVPixelBufferGetHeight, CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress,
    CVPixelBufferLockFlags, CVPixelBufferPool, CVPixelBufferUnlockBaseAddress,
    kCVPixelBufferHeightKey, kCVPixelBufferIOSurfacePropertiesKey,
    kCVPixelBufferPixelFormatTypeKey, kCVPixelBufferWidthKey, kCVPixelFormatType_32BGRA,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};
use objc2_video_toolbox::{
    VTCompressionSession, VTEncodeInfoFlags, VTSessionSetProperty,
    kVTCompressionPropertyKey_AllowFrameReordering, kVTCompressionPropertyKey_AverageBitRate,
    kVTCompressionPropertyKey_ColorPrimaries, kVTCompressionPropertyKey_ExpectedFrameRate,
    kVTCompressionPropertyKey_MaxKeyFrameInterval, kVTCompressionPropertyKey_ProfileLevel,
    kVTCompressionPropertyKey_Quality, kVTCompressionPropertyKey_RealTime,
    kVTCompressionPropertyKey_TransferFunction, kVTCompressionPropertyKey_YCbCrMatrix,
    kVTProfileLevel_H264_High_AutoLevel,
    kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder,
};

use crate::encode::{
    AUDIO_CHANNELS, AUDIO_LEAD_SECONDS, AUDIO_SAMPLE_RATE, Mp4Sink, PcmChunk, PcmSource,
    WriterSetup,
};
use crate::quality_cap::QualityCap;

/// 编码器背压时的短睡步长；短睡而不是自旋，避免整核空转（与导出后端同值）。
const BACKPRESSURE_NAP: Duration = Duration::from_micros(500);

/// 关键帧间隔（秒）。硬编默认的 GOP 在本仓库实测能稀到只剩首帧一个关键帧，
/// 那样的产物拖动预览会很难受；2 秒与导出后端的取值一致。
const KEYFRAME_INTERVAL_SECONDS: f64 = 2.0;

/// 一个关键帧间隔的帧数（`MaxKeyFrameInterval`；码率上限的窗口也用它，正好含一个关键帧）。
fn keyframe_interval_frames(fps: f64) -> f64 {
    (fps * KEYFRAME_INTERVAL_SECONDS).round().max(1.0)
}

fn ns_path(path: &Path) -> Retained<NSString> {
    NSString::from_str(&path.to_string_lossy())
}

fn object_dictionary(
    keys: &[&NSString],
    values: &[&AnyObject],
) -> Retained<NSDictionary<NSString, AnyObject>> {
    NSDictionary::from_slices(keys, values)
}

/// `kCV…Key`、`kVT…Key` 这类 `CFStringRef` 与 `NSString *` toll-free bridged，按指针换类型就能当字典键。
fn cf_key(key: &CFString) -> &NSString {
    unsafe { &*ptr::from_ref(key).cast::<NSString>() }
}

/// 同上：`NSDictionary *` 与 `CFDictionaryRef` toll-free bridged。
fn cf_dictionary(dictionary: &NSDictionary<NSString, AnyObject>) -> &CFDictionary {
    unsafe { &*ptr::from_ref(dictionary).cast::<CFDictionary>() }
}

/// 建 H.264 压缩会话，连同质量是否设上（`quality` 为 `None`、不是 Apple 芯片或编码器不接受时为假，
/// 那就是平均码率）。这里失败都标 `unsupported`：调用方据此回落 ffmpeg。
///
/// 硬件编码优先，没有时用软件（与 `AVAssetWriter` 自己压缩时相同，所以不用 `Require…`）。
unsafe fn compression_session(
    width: u32,
    height: u32,
    bitrate: u32,
    quality: Option<f64>,
    fps: f64,
) -> Result<(CFRetained<VTCompressionSession>, bool)> {
    let specification = object_dictionary(
        &[cf_key(unsafe {
            kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder
        })],
        &[NSNumber::numberWithBool(true).as_ref() as &AnyObject],
    );
    let (Ok(coded_width), Ok(coded_height)) = (i32::try_from(width), i32::try_from(height)) else {
        bail!("unsupported: video size {width}x{height} is out of range");
    };
    // 给了像素属性，会话才有像素缓冲池；`fill_bgra` 就写进编码器要的那种（IOSurface）缓冲。
    let source = object_dictionary(
        &[
            cf_key(unsafe { kCVPixelBufferPixelFormatTypeKey }),
            cf_key(unsafe { kCVPixelBufferWidthKey }),
            cf_key(unsafe { kCVPixelBufferHeightKey }),
            cf_key(unsafe { kCVPixelBufferIOSurfacePropertiesKey }),
        ],
        &[
            NSNumber::numberWithUnsignedInt(kCVPixelFormatType_32BGRA).as_ref() as &AnyObject,
            NSNumber::numberWithUnsignedInt(width).as_ref(),
            NSNumber::numberWithUnsignedInt(height).as_ref(),
            NSDictionary::<NSString, AnyObject>::new().as_ref(),
        ],
    );
    let mut raw: *mut VTCompressionSession = ptr::null_mut();
    // 不挂会话级回调：编码走 `…WithOutputHandler`，回调随调用给。
    let status = unsafe {
        VTCompressionSession::create(
            None,
            coded_width,
            coded_height,
            kCMVideoCodecType_H264,
            Some(cf_dictionary(&specification)),
            Some(cf_dictionary(&source)),
            None,
            None,
            ptr::null_mut(),
            NonNull::from(&mut raw),
        )
    };
    let session = NonNull::new(raw).filter(|_| status == 0).with_context(|| {
        format!("unsupported: cannot create the H.264 compression session (OSStatus {status})")
    })?;
    let session = unsafe { CFRetained::from_raw(session) };
    let number = |value: f64| CFNumber::new_f64(value);
    let bitrate = CFNumber::new_i32(i32::try_from(bitrate).unwrap_or(i32::MAX));
    let keyframe_interval = number(keyframe_interval_frames(fps));
    let expected_frame_rate = number(fps);
    let properties: [(&str, &CFString, &CFType); 9] = unsafe {
        [
            // 离线：用满全部编码引擎（见模块文档）。写入器不丢帧，也不需要实时的低延迟。
            (
                "RealTime",
                kVTCompressionPropertyKey_RealTime,
                CFBoolean::new(false).as_ref(),
            ),
            (
                "ProfileLevel",
                kVTCompressionPropertyKey_ProfileLevel,
                kVTProfileLevel_H264_High_AutoLevel.as_ref(),
            ),
            (
                "AverageBitRate",
                kVTCompressionPropertyKey_AverageBitRate,
                bitrate.as_ref(),
            ),
            (
                "MaxKeyFrameInterval",
                kVTCompressionPropertyKey_MaxKeyFrameInterval,
                keyframe_interval.as_ref(),
            ),
            // 真实帧率，不能调高（见模块文档）：`AutoLevel` 按它算 level。
            (
                "ExpectedFrameRate",
                kVTCompressionPropertyKey_ExpectedFrameRate,
                expected_frame_rate.as_ref(),
            ),
            (
                "AllowFrameReordering",
                kVTCompressionPropertyKey_AllowFrameReordering,
                CFBoolean::new(true).as_ref(),
            ),
            // BT.709 色彩标记：不给的话写出的码流 primaries / transfer / matrix 全是 unknown（ffprobe 实测），
            // 播放端按 601 猜就会偏色。给了之后 BGRA→YUV 的转换矩阵也随之定为 709，与 ffmpeg 兜底路径的
            // `-colorspace bt709` 合同一致。
            (
                "ColorPrimaries",
                kVTCompressionPropertyKey_ColorPrimaries,
                kCMFormatDescriptionColorPrimaries_ITU_R_709_2.as_ref(),
            ),
            (
                "TransferFunction",
                kVTCompressionPropertyKey_TransferFunction,
                kCMFormatDescriptionTransferFunction_ITU_R_709_2.as_ref(),
            ),
            (
                "YCbCrMatrix",
                kVTCompressionPropertyKey_YCbCrMatrix,
                kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2.as_ref(),
            ),
        ]
    };
    for (name, key, value) in properties {
        let status = unsafe { VTSessionSetProperty(session.as_ref(), key, Some(value)) };
        if status != 0 {
            unsafe { session.invalidate() };
            bail!("unsupported: the H.264 encoder rejected {name} (OSStatus {status})");
        }
    }
    // 编码器不接受质量就留在平均码率上，不为它回落 ffmpeg。
    let constant_quality = quality
        .filter(|_| cfg!(target_arch = "aarch64"))
        .is_some_and(|quality| {
            let value = number(quality);
            let status = unsafe {
                VTSessionSetProperty(
                    session.as_ref(),
                    kVTCompressionPropertyKey_Quality,
                    Some(value.as_ref()),
                )
            };
            status == 0
        });
    let status = unsafe { session.prepare_to_encode_frames() };
    if status != 0 {
        unsafe { session.invalidate() };
        bail!("unsupported: the H.264 encoder cannot start (OSStatus {status})");
    }
    Ok((session, constant_quality))
}

unsafe fn audio_output_settings(bitrate: u32) -> Retained<NSDictionary<NSString, AnyObject>> {
    let format = NSNumber::numberWithUnsignedInt(kAudioFormatMPEG4AAC);
    let sample_rate = NSNumber::numberWithDouble(f64::from(AUDIO_SAMPLE_RATE));
    let channels = NSNumber::numberWithUnsignedInt(AUDIO_CHANNELS);
    let bitrate = NSNumber::numberWithUnsignedInt(bitrate);
    object_dictionary(
        &[
            unsafe { AVFormatIDKey }.expect("AVFormatIDKey"),
            unsafe { AVSampleRateKey }.expect("AVSampleRateKey"),
            unsafe { AVNumberOfChannelsKey }.expect("AVNumberOfChannelsKey"),
            unsafe { AVEncoderBitRateKey }.expect("AVEncoderBitRateKey"),
        ],
        &[&format, &sample_rate, &channels, &bitrate],
    )
}

/// "48 kHz 立体声交织 f32" 的音频格式描述。混音 PCM 没有容器，格式只能自己声明。
fn pcm_format_description() -> Result<CFRetained<CMFormatDescription>> {
    let mut asbd = AudioStreamBasicDescription {
        mSampleRate: f64::from(AUDIO_SAMPLE_RATE),
        mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat
            | kAudioFormatFlagsNativeEndian
            | kAudioFormatFlagIsPacked,
        mBytesPerPacket: 4 * AUDIO_CHANNELS,
        mFramesPerPacket: 1,
        mBytesPerFrame: 4 * AUDIO_CHANNELS,
        mChannelsPerFrame: AUDIO_CHANNELS,
        mBitsPerChannel: 32,
        mReserved: 0,
    };
    let mut description: *const CMFormatDescription = std::ptr::null();
    let status = unsafe {
        CMAudioFormatDescriptionCreate(
            None,
            NonNull::from(&mut asbd),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            None,
            NonNull::from(&mut description),
        )
    };
    if status != 0 {
        bail!("创建 PCM 音频格式描述失败：{status}");
    }
    let pointer = NonNull::new(description.cast_mut()).context("CoreMedia 返回了空音频格式描述")?;
    Ok(unsafe { CFRetained::from_raw(pointer) })
}

/// 一块交织 f32 PCM → 可以直接 append 的 `CMSampleBuffer`。
fn pcm_sample_buffer(
    format: &CMFormatDescription,
    chunk: &PcmChunk,
) -> Result<CFRetained<CMSampleBuffer>> {
    let length = std::mem::size_of_val(chunk.samples.as_slice());
    let mut block: *mut CMBlockBuffer = std::ptr::null_mut();
    // `memory_block` 为空 + `block_allocator` 为空 ⇒ 用默认分配器现分配；
    // `AssureMemoryNow` 让它当场分配而不是等到第一次访问。
    let status = unsafe {
        CMBlockBuffer::create_with_memory_block(
            None,
            std::ptr::null_mut(),
            length,
            None,
            std::ptr::null(),
            0,
            length,
            kCMBlockBufferAssureMemoryNowFlag,
            NonNull::from(&mut block),
        )
    };
    if status != 0 {
        bail!("创建音频块缓冲失败：{status}");
    }
    let block = unsafe {
        CFRetained::from_raw(NonNull::new(block).context("CoreMedia 返回了空音频块缓冲")?)
    };
    let source = NonNull::new(chunk.samples.as_ptr().cast::<std::ffi::c_void>().cast_mut())
        .context("空 PCM 分块")?;
    let status = unsafe { CMBlockBuffer::replace_data_bytes(source, &block, 0, length) };
    if status != 0 {
        bail!("拷贝音频样本字节失败：{status}");
    }
    let mut sample: *mut CMSampleBuffer = std::ptr::null_mut();
    let status = unsafe {
        CMAudioSampleBufferCreateReadyWithPacketDescriptions(
            None,
            &block,
            format,
            chunk.frames() as isize,
            CMTime::new(chunk.start_frame as i64, AUDIO_SAMPLE_RATE as i32),
            std::ptr::null(),
            NonNull::from(&mut sample),
        )
    };
    if status != 0 {
        bail!("创建音频样本缓冲失败：{status}");
    }
    let pointer = NonNull::new(sample).context("CoreMedia 返回了空音频样本缓冲")?;
    Ok(unsafe { CFRetained::from_raw(pointer) })
}

struct AudioTrack {
    input: Retained<AVAssetWriterInput>,
    format: CFRetained<CMFormatDescription>,
    source: PcmSource,
    /// PCM 已读完并且音轨已 `markAsFinished`。
    finished: bool,
}

/// 音轨在封装开始之前的样子：直通的视频输入要等第一个样本才有格式，输入都在那时才加（音轨排在视频后面）。
struct PendingAudio {
    source: PcmSource,
    format: CFRetained<CMFormatDescription>,
    settings: Retained<NSDictionary<NSString, AnyObject>>,
}

/// 压缩好的样本，从编码回调的线程交到写线程。
struct EncodedSample(CFRetained<CMSampleBuffer>);

// SAFETY: `CMSampleBuffer` 的引用计数是线程安全的；回调把它放进队列之后就不再碰，交接之后只有写线程用它。
unsafe impl Send for EncodedSample {}

/// 编码回调交给写线程的东西（见模块文档「线程」）。
#[derive(Default)]
struct Encoded {
    /// 压缩好的样本，按解码顺序。
    samples: VecDeque<EncodedSample>,
    /// 第一次编码失败的说明。
    failure: Option<String>,
}

type OutputHandler = RcBlock<dyn Fn(i32, VTEncodeInfoFlags, *mut CMSampleBuffer)>;

/// 编码回调：只记下结果，不碰 `AVAssetWriter`、不阻塞。一个块反复用，逐帧不分配。
fn output_handler(encoded: Arc<Mutex<Encoded>>) -> OutputHandler {
    RcBlock::new(
        move |status: i32, _flags: VTEncodeInfoFlags, sample: *mut CMSampleBuffer| {
            let Ok(mut encoded) = encoded.lock() else {
                return;
            };
            match NonNull::new(sample).filter(|_| status == 0) {
                Some(sample) => encoded
                    .samples
                    .push_back(EncodedSample(unsafe { CFRetained::retain(sample) })),
                // 离线会话不该丢帧；真丢了就是失败，别写出少帧的成片。
                None => {
                    encoded.failure.get_or_insert_with(|| {
                        format!("VideoToolbox failed to encode a frame (OSStatus {status})")
                    });
                }
            }
        },
    )
}

pub(crate) struct AvWriter {
    writer: Retained<AVAssetWriter>,
    session: CFRetained<VTCompressionSession>,
    pool: CFRetained<CVPixelBufferPool>,
    encoded: Arc<Mutex<Encoded>>,
    handler: OutputHandler,
    /// 视频的封装输入；第一个样本到了才有（[`AvWriter::start_muxing`]），有了就说明写入器开始写了。
    video_input: Option<Retained<AVAssetWriterInput>>,
    pending_audio: Option<PendingAudio>,
    audio: Option<AudioTrack>,
    width: u32,
    height: u32,
    fps_num: u32,
    fps_den: u32,
    /// 已送进编码器的视频帧数，也是下一帧的帧号。
    submitted: u64,
    /// 已追加进封装的视频帧数：音频按它定提前量。
    frames: u64,
    /// 恒定质量的码率上限；平均码率编码时没有。
    quality_cap: Option<QualityCap>,
    /// 写入器已经收束（`finish` 走完）。
    closed: bool,
    /// AVFoundation 的影子文件目录。`shouldOptimizeForNetworkUse` 为把 moov 前置
    /// 会写一份接近成片大小的 `.sb-*` 临时文件，目录必须与输出同盘，不能用系统
    /// 临时目录绕过目标盘的空间预检。字段顺序即析构顺序：它排在 writer **之后**，writer
    /// 先释放、AVFoundation 先收束自身文件，TempDir 再兜底清理。
    _temporary: tempfile::TempDir,
}

pub(crate) fn open(out: &Path, setup: WriterSetup) -> Result<Box<dyn Mp4Sink>> {
    objc2::rc::autoreleasepool(|_| open_inner(out, setup))
        .map(|writer| Box::new(writer) as Box<dyn Mp4Sink>)
}

fn open_inner(out: &Path, setup: WriterSetup) -> Result<AvWriter> {
    let WriterSetup {
        width,
        height,
        fps_num,
        fps_den,
        bitrate,
        quality,
        audio,
        audio_bitrate,
    } = setup;
    // AVAssetWriter 拒绝已存在的输出路径，而调用方常常先建好临时文件再交给我们
    // （`bcut-render` 就是 `tempfile_in` 出来的空文件）。ffmpeg 那条路径是 `-y`
    // 覆盖，语义要一致。
    match std::fs::remove_file(out) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| format!("清理旧输出 {}", out.display()));
        }
    }
    let exact_fps = f64::from(fps_num) / f64::from(fps_den);
    // guard 先于 writer 创建，局部变量逆序析构时 writer 先释放：AVFoundation
    // 收束完自己的影子文件，TempDir 再兜底清理。
    // 相对文件名的 parent 是空路径，按当前目录处理；父目录失联时直接失败，
    // 不创建父目录，也不回落到系统临时目录（外置盘导出不能占满系统盘）。
    let parent = out
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let temporary = tempfile::Builder::new()
        .prefix("bcut-mp4-writer-")
        .tempdir_in(parent)
        .context("创建 AVFoundation 临时目录")?;
    let url = NSURL::fileURLWithPath(&ns_path(out));
    let writer = unsafe {
        AVAssetWriter::assetWriterWithURL_fileType_error(
            &url,
            AVFileTypeMPEG4.expect("AVFileTypeMPEG4"),
        )
    }
    .map_err(|error| anyhow!("unsupported: 创建 AVAssetWriter 失败（{error}）"))?;
    unsafe {
        let temporary_url = NSURL::fileURLWithPath(&ns_path(temporary.path()));
        writer.setDirectoryForTemporaryFiles(Some(&temporary_url));
        // 与迁移前 ffmpeg 的 `-movflags +faststart` 对齐：moov 前置。
        writer.setShouldOptimizeForNetworkUse(true);
    }

    let (session, constant_quality) =
        unsafe { compression_session(width, height, bitrate, quality, exact_fps)? };
    let quality_cap = quality.filter(|_| constant_quality).map(|quality| {
        QualityCap::new(
            quality,
            bitrate,
            exact_fps,
            keyframe_interval_frames(exact_fps) as usize,
        )
    });
    let pool = unsafe { session.pixel_buffer_pool() };
    let Some(pool) = pool else {
        unsafe { session.invalidate() };
        bail!("unsupported: the H.264 compression session has no pixel buffer pool");
    };
    let encoded = Arc::new(Mutex::new(Encoded::default()));
    let handler = output_handler(Arc::clone(&encoded));
    let mut writer = AvWriter {
        writer,
        session,
        pool,
        encoded,
        handler,
        video_input: None,
        pending_audio: None,
        audio: None,
        width,
        height,
        fps_num,
        fps_den,
        submitted: 0,
        frames: 0,
        quality_cap,
        closed: false,
        _temporary: temporary,
    };
    if let Some(source) = audio {
        let settings = unsafe { audio_output_settings(audio_bitrate) };
        // 音轨要到第一个样本才加，这里先问一声：没有 AAC 编码器时现在失败，调用方才回落得了 ffmpeg。
        let media_type = unsafe { AVMediaTypeAudio }.expect("AVMediaTypeAudio");
        if !unsafe {
            writer
                .writer
                .canApplyOutputSettings_forMediaType(Some(&settings), media_type)
        } {
            bail!("unsupported: this machine has no AAC encoder");
        }
        writer.pending_audio = Some(PendingAudio {
            source,
            format: pcm_format_description()?,
            settings,
        });
    }
    Ok(writer)
}

impl AvWriter {
    /// 第 `index` 帧的呈现时间。分数时基（`den/num`），29.97 这类帧率不会漂。
    fn timestamp(&self, index: u64) -> CMTime {
        unsafe { CMTime::new(index as i64 * i64::from(self.fps_den), self.fps_num as i32) }
    }

    fn video_seconds(&self) -> f64 {
        self.frames as f64 * f64::from(self.fps_den) / f64::from(self.fps_num)
    }

    fn check_failed(&self) -> Result<()> {
        if unsafe { self.writer.status() } == AVAssetWriterStatus::Failed {
            bail!("AVFoundation 编码失败：{:?}", unsafe {
                self.writer.error()
            });
        }
        Ok(())
    }

    /// 第一个样本到了：照它的格式加上直通的视频输入、再加音轨，开始写。
    fn start_muxing(&mut self, first: &CMSampleBuffer) -> Result<()> {
        let format = unsafe { first.format_description() }
            .context("the first encoded sample has no format description")?;
        let video_input = unsafe {
            AVAssetWriterInput::initWithMediaType_outputSettings_sourceFormatHint(
                AVAssetWriterInput::alloc(),
                AVMediaTypeVideo.expect("AVMediaTypeVideo"),
                None,
                Some(&format),
            )
        };
        // 视频已经压缩好，这里只封装：实时源让写入器不囤样本，音视频交织更紧。
        unsafe { video_input.setExpectsMediaDataInRealTime(true) };
        // 非整数帧率把媒体时基钉在分子上：缺省 600 会把 29.97 的帧长取整成 20/600，
        // 读回来就是 30 fps（`bcut-kernel` 的 `pin_media_time_scale` 同一条规则）。
        if self.fps_den > 1
            && let Ok(scale) = i32::try_from(self.fps_num)
        {
            unsafe { video_input.setMediaTimeScale(scale) };
        }
        if !unsafe { self.writer.canAddInput(&video_input) } {
            bail!("AVAssetWriter does not accept the encoded H.264 video");
        }
        unsafe { self.writer.addInput(&video_input) };
        if let Some(PendingAudio {
            source,
            format,
            settings,
        }) = self.pending_audio.take()
        {
            let input = unsafe {
                AVAssetWriterInput::initWithMediaType_outputSettings(
                    AVAssetWriterInput::alloc(),
                    AVMediaTypeAudio.expect("AVMediaTypeAudio"),
                    Some(&settings),
                )
            };
            unsafe { input.setExpectsMediaDataInRealTime(false) };
            if !unsafe { self.writer.canAddInput(&input) } {
                bail!("AVAssetWriter does not accept the AAC audio track");
            }
            unsafe { self.writer.addInput(&input) };
            self.audio = Some(AudioTrack {
                input,
                format,
                source,
                finished: false,
            });
        }
        if !unsafe { self.writer.startWriting() } {
            bail!("AVFoundation cannot start writing the MP4 ({:?})", unsafe {
                self.writer.error()
            });
        }
        unsafe { self.writer.startSessionAtSourceTime(CMTime::new(0, 1)) };
        self.video_input = Some(video_input);
        Ok(())
    }

    /// 把编码器交回来的样本都追加进封装，封装跟不上时在这里等（同时继续喂音频，交织死锁面见 `pump_audio`）。
    fn drain_encoded(&mut self) -> Result<()> {
        loop {
            let sample = {
                let mut encoded = self
                    .encoded
                    .lock()
                    .map_err(|_| anyhow!("the encoded sample queue is poisoned"))?;
                if let Some(failure) = encoded.failure.take() {
                    bail!(failure);
                }
                encoded.samples.pop_front()
            };
            let Some(EncodedSample(sample)) = sample else {
                return Ok(());
            };
            if self.video_input.is_none() {
                self.start_muxing(&sample)?;
            }
            let input = self
                .video_input
                .clone()
                .context("the video input was not created")?;
            let limit = self.video_seconds() + AUDIO_LEAD_SECONDS;
            loop {
                self.pump_audio(limit)?;
                if unsafe { input.isReadyForMoreMediaData() } {
                    break;
                }
                self.check_failed()?;
                std::thread::sleep(BACKPRESSURE_NAP);
            }
            if !unsafe { input.appendSampleBuffer(&sample) } {
                bail!(
                    "AVFoundation failed to write a video sample: {:?}",
                    unsafe { self.writer.error() }
                );
            }
            self.frames += 1;
            self.limit_bitrate(&sample);
        }
    }

    /// 恒定质量时记下样本大小，码率超出上限（或回落）时改编码器的质量（[`QualityCap`]）。
    /// 设不上就保持原来的质量：上限只是安全网，不为它让导出失败。
    fn limit_bitrate(&mut self, sample: &CMSampleBuffer) {
        let Some(cap) = self.quality_cap.as_mut() else {
            return;
        };
        let bytes = unsafe { sample.total_sample_size() } as u64;
        if let Some(quality) = cap.record(bytes) {
            let value = CFNumber::new_f64(quality);
            let _ = unsafe {
                VTSessionSetProperty(
                    self.session.as_ref(),
                    kVTCompressionPropertyKey_Quality,
                    Some(value.as_ref()),
                )
            };
        }
    }

    /// 把音频喂到 `limit_seconds`（音频时间轴上的硬上限）。
    ///
    /// 返回是否真的推进了。等视频就绪的循环里必须调用它，否则 writer 为保持交织
    /// 压住视频就绪位、调用方又只等视频，带音轨的渲染会死锁。
    fn pump_audio(&mut self, limit_seconds: f64) -> Result<bool> {
        let Some(audio) = self.audio.as_mut() else {
            return Ok(false);
        };
        if audio.finished {
            return Ok(false);
        }
        let mut advanced = false;
        loop {
            if audio.source.position_seconds() >= limit_seconds {
                return Ok(advanced);
            }
            if !unsafe { audio.input.isReadyForMoreMediaData() } {
                return Ok(advanced);
            }
            let chunk = audio.source.next_chunk()?;
            let Some(chunk) = chunk else {
                unsafe { audio.input.markAsFinished() };
                audio.finished = true;
                return Ok(true);
            };
            let sample = pcm_sample_buffer(&audio.format, &chunk)?;
            if !unsafe { audio.input.appendSampleBuffer(&sample) } {
                bail!("AVFoundation 写入 AAC 音频失败：{:?}", unsafe {
                    self.writer.error()
                });
            }
            advanced = true;
        }
    }

    fn append_frame(&mut self, rgba: &[u8]) -> Result<()> {
        let expected = self.width as usize * self.height as usize * 4;
        if rgba.len() != expected {
            bail!(
                "MP4 帧字节数与几何不符：{}x{} 需要 {expected} 字节，实得 {}",
                self.width,
                self.height,
                rgba.len()
            );
        }
        let buffer = new_pixel_buffer(&self.pool)?;
        unsafe { fill_bgra(&buffer, rgba, self.width, self.height)? };
        let timestamp = self.timestamp(self.submitted);
        let duration = unsafe { CMTime::new(i64::from(self.fps_den), self.fps_num as i32) };
        // 编码器满了在这里阻塞（背压）；回调不等写线程，所以不会互相等死。
        let status = unsafe {
            self.session.encode_frame_with_output_handler(
                &buffer,
                timestamp,
                duration,
                None,
                ptr::null_mut(),
                ptr::from_ref(&*self.handler).cast_mut(),
            )
        };
        if status != 0 {
            bail!("VideoToolbox refused a frame (OSStatus {status})");
        }
        self.submitted += 1;
        self.drain_encoded()
    }

    /// 音频还需不需要继续喂：`video_end` 之前的部分都已交出即算完。
    fn audio_drained(&self, video_end: f64) -> bool {
        self.audio
            .as_ref()
            .is_none_or(|audio| audio.finished || audio.source.position_seconds() >= video_end)
    }

    fn close(&mut self) -> Result<()> {
        // 等编码器交出还在路上的帧（回调不阻塞），全部追加进封装。
        let status = unsafe { self.session.complete_frames(kCMTimeInvalid) };
        if status != 0 {
            bail!("VideoToolbox failed to flush the encoder (OSStatus {status})");
        }
        self.drain_encoded()?;
        let input = self
            .video_input
            .clone()
            .context("no video frames were encoded")?;
        // 视频轨**先**收束，再排干音频。顺序不能反：writer 为保持交织可能压住
        // 音频的就绪位来等更多视频数据，而视频这时已经没有下一帧了——先
        // `markAsFinished` 才让它知道这一点，下面的排干循环就不会空转到超时。
        unsafe { input.markAsFinished() };
        // 剩余音频按 ffmpeg 的 `-shortest` 截到视频末尾。分块粒度是 0.1 秒，
        // 音频比视频长时最多多出不到一块——BCF 渲染里两者本来等长，不会走到。
        let video_end = self.video_seconds();
        while !self.audio_drained(video_end) {
            if !self.pump_audio(video_end)? {
                self.check_failed()?;
                std::thread::sleep(BACKPRESSURE_NAP);
            }
        }
        if let Some(audio) = self.audio.as_mut()
            && !audio.finished
        {
            unsafe { audio.input.markAsFinished() };
            audio.finished = true;
        }
        // 从这里起 writer 交给 `finishWriting`，`Drop` 不得再取消它。
        self.closed = true;
        let (finished_tx, finished_rx) = std::sync::mpsc::sync_channel(1);
        let completion = RcBlock::new(move || {
            let _ = finished_tx.send(());
        });
        unsafe { self.writer.finishWritingWithCompletionHandler(&completion) };
        finished_rx.recv().context("等待 AVFoundation 完成 MP4")?;
        if unsafe { self.writer.status() } != AVAssetWriterStatus::Completed {
            bail!("AVFoundation 完成 MP4 失败：{:?}", unsafe {
                self.writer.error()
            });
        }
        Ok(())
    }
}

impl Drop for AvWriter {
    fn drop(&mut self) {
        // 正常收尾时帧都交完了；半途丢弃（渲染出错 / 取消）时显式取消，别让编码器在后台把队列跑完。
        unsafe { self.session.invalidate() };
        // 第一个样本到之前写入器还没开始写，没有东西可取消。
        if !self.closed && self.video_input.is_some() {
            unsafe { self.writer.cancelWriting() };
        }
    }
}

impl Mp4Sink for AvWriter {
    fn write_frame(&mut self, rgba: &[u8]) -> Result<()> {
        // AVFoundation 内部大量 autorelease；每帧一个池，长渲染里临时对象不会
        // 攒到线程退出。
        objc2::rc::autoreleasepool(|_| self.append_frame(rgba))
    }

    fn finish(mut self: Box<Self>) -> Result<()> {
        objc2::rc::autoreleasepool(|_| self.close())
    }
}

fn new_pixel_buffer(pool: &CVPixelBufferPool) -> Result<CFRetained<CVPixelBuffer>> {
    let mut pointer: *mut CVPixelBuffer = std::ptr::null_mut();
    let status =
        unsafe { CVPixelBufferPool::create_pixel_buffer(None, pool, NonNull::from(&mut pointer)) };
    if status != 0 {
        bail!("AVFoundation 无法分配 BGRA 输出帧：{status}");
    }
    let pointer = NonNull::new(pointer).context("AVFoundation 返回空 BGRA 输出帧")?;
    Ok(unsafe { CFRetained::from_raw(pointer) })
}

/// top-down RGBA8 → 像素缓冲的 32BGRA。
///
/// `bytesPerRow` 带对齐补白（16/64 字节），**不能**当成 `width * 4`。
unsafe fn fill_bgra(buffer: &CVPixelBuffer, rgba: &[u8], width: u32, height: u32) -> Result<()> {
    let flags = CVPixelBufferLockFlags(0);
    if unsafe { CVPixelBufferLockBaseAddress(buffer, flags) } != 0 {
        bail!("锁定输出 CVPixelBuffer 失败");
    }
    let outcome = (|| -> Result<()> {
        let buffer_width = CVPixelBufferGetWidth(buffer);
        let buffer_height = CVPixelBufferGetHeight(buffer);
        let stride = CVPixelBufferGetBytesPerRow(buffer);
        let base = CVPixelBufferGetBaseAddress(buffer);
        if base.is_null()
            || buffer_width != width as usize
            || buffer_height != height as usize
            || stride < buffer_width * 4
        {
            bail!(
                "AVFoundation 交出的像素缓冲与请求不符：{buffer_width}x{buffer_height}（请求 {width}x{height}）"
            );
        }
        for y in 0..buffer_height {
            let row = unsafe {
                std::slice::from_raw_parts_mut(base.cast::<u8>().add(y * stride), buffer_width * 4)
            };
            let source = &rgba[y * buffer_width * 4..(y + 1) * buffer_width * 4];
            for (source, target) in source.chunks_exact(4).zip(row.chunks_exact_mut(4)) {
                // R,G,B,A → 内存序 B,G,R,A。
                target[0] = source[2];
                target[1] = source[1];
                target[2] = source[0];
                target[3] = source[3];
            }
        }
        Ok(())
    })();
    // 解锁无条件执行，不因上面的错误提前返回而漏掉。
    let unlocked = unsafe { CVPixelBufferUnlockBaseAddress(buffer, flags) };
    outcome?;
    if unlocked != 0 {
        bail!("解锁输出 CVPixelBuffer 失败");
    }
    Ok(())
}
