//! macOS 原生 MP4 写入：`AVAssetWriter` + VideoToolbox H.264 + AAC。
//!
//! 结构与 `core/crates/bcut-kernel/src/services/native_video.rs` 的在产导出后端同源（那是这套栈
//! 在本仓库的第一处实现），但这里的场景简单得多，因此**没有**照抄它的流水线：
//! 那边要一边解源码流一边合成字幕，帧的生产成本高，值得单开一条提交线程；这边
//! 的帧由 `bcut-render` 的 worker 池并行光栅化之后按序送到，写入端只剩"喂给
//! 编码器"，再加一层线程只会多一次 8 MB 拷贝和一份 SAFETY 论证。背压因此就地
//! 承担：`isReadyForMoreMediaData` 为假时短睡等待。
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

#![allow(deprecated)]

use std::path::Path;
use std::ptr::NonNull;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use block2::RcBlock;
use objc2::AnyThread;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterInputPixelBufferAdaptor, AVAssetWriterStatus,
    AVFileTypeMPEG4, AVMediaTypeAudio, AVMediaTypeVideo, AVVideoAverageBitRateKey, AVVideoCodecKey,
    AVVideoCodecTypeH264, AVVideoCompressionPropertiesKey, AVVideoExpectedSourceFrameRateKey,
    AVVideoHeightKey, AVVideoMaxKeyFrameIntervalKey, AVVideoProfileLevelH264HighAutoLevel,
    AVVideoProfileLevelKey, AVVideoWidthKey,
};
use objc2_avf_audio::{AVEncoderBitRateKey, AVFormatIDKey, AVNumberOfChannelsKey, AVSampleRateKey};
use objc2_core_audio_types::{
    AudioStreamBasicDescription, kAudioFormatFlagIsFloat, kAudioFormatFlagIsPacked,
    kAudioFormatFlagsNativeEndian, kAudioFormatLinearPCM, kAudioFormatMPEG4AAC,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{
    CMAudioFormatDescriptionCreate, CMAudioSampleBufferCreateReadyWithPacketDescriptions,
    CMBlockBuffer, CMFormatDescription, CMSampleBuffer, CMTime, kCMBlockBufferAssureMemoryNowFlag,
};
use objc2_core_video::{
    CVPixelBuffer, CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow,
    CVPixelBufferGetHeight, CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress,
    CVPixelBufferLockFlags, CVPixelBufferPool, CVPixelBufferUnlockBaseAddress,
    kCVPixelFormatType_32BGRA,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL, ns_string};

use crate::encode::{
    AUDIO_BITRATE, AUDIO_CHANNELS, AUDIO_LEAD_SECONDS, AUDIO_SAMPLE_RATE, Mp4Sink, PcmChunk,
    PcmSource, frame_rate_rational, video_bitrate,
};

/// 编码器背压时的短睡步长；短睡而不是自旋，避免整核空转（与导出后端同值）。
const BACKPRESSURE_NAP: Duration = Duration::from_micros(500);

/// 关键帧间隔（秒）。硬编默认的 GOP 在本仓库实测能稀到只剩首帧一个关键帧，
/// 那样的产物拖动预览会很难受；2 秒与导出后端的取值一致。
const KEYFRAME_INTERVAL_SECONDS: f64 = 2.0;

fn ns_path(path: &Path) -> Retained<NSString> {
    NSString::from_str(&path.to_string_lossy())
}

fn object_dictionary(
    keys: &[&NSString],
    values: &[&AnyObject],
) -> Retained<NSDictionary<NSString, AnyObject>> {
    NSDictionary::from_slices(keys, values)
}

unsafe fn video_output_settings(
    width: u32,
    height: u32,
    bitrate: u32,
    fps: f64,
) -> Retained<NSDictionary<NSString, AnyObject>> {
    let bitrate = NSNumber::numberWithUnsignedInt(bitrate);
    let keyframe_interval =
        NSNumber::numberWithUnsignedInt(((fps * KEYFRAME_INTERVAL_SECONDS).round() as u32).max(1));
    let source_frame_rate = NSNumber::numberWithDouble(fps);
    let compression = object_dictionary(
        &[
            unsafe { AVVideoAverageBitRateKey }.expect("AVVideoAverageBitRateKey"),
            unsafe { AVVideoProfileLevelKey }.expect("AVVideoProfileLevelKey"),
            unsafe { AVVideoMaxKeyFrameIntervalKey }.expect("AVVideoMaxKeyFrameIntervalKey"),
            unsafe { AVVideoExpectedSourceFrameRateKey }
                .expect("AVVideoExpectedSourceFrameRateKey"),
        ],
        &[
            &bitrate,
            unsafe { AVVideoProfileLevelH264HighAutoLevel }
                .expect("AVVideoProfileLevelH264HighAutoLevel"),
            &keyframe_interval,
            &source_frame_rate,
        ],
    );
    let width = NSNumber::numberWithUnsignedInt(width);
    let height = NSNumber::numberWithUnsignedInt(height);
    object_dictionary(
        &[
            unsafe { AVVideoCodecKey }.expect("AVVideoCodecKey"),
            unsafe { AVVideoWidthKey }.expect("AVVideoWidthKey"),
            unsafe { AVVideoHeightKey }.expect("AVVideoHeightKey"),
            unsafe { AVVideoCompressionPropertiesKey }.expect("AVVideoCompressionPropertiesKey"),
        ],
        &[
            unsafe { AVVideoCodecTypeH264 }.expect("AVVideoCodecTypeH264"),
            &width,
            &height,
            &compression,
        ],
    )
}

unsafe fn adaptor_settings(width: u32, height: u32) -> Retained<NSDictionary<NSString, AnyObject>> {
    let pixel_format = NSNumber::numberWithUnsignedInt(kCVPixelFormatType_32BGRA);
    let width = NSNumber::numberWithUnsignedInt(width);
    let height = NSNumber::numberWithUnsignedInt(height);
    object_dictionary(
        &[
            ns_string!("PixelFormatType"),
            ns_string!("Width"),
            ns_string!("Height"),
        ],
        &[&pixel_format, &width, &height],
    )
}

unsafe fn audio_output_settings() -> Retained<NSDictionary<NSString, AnyObject>> {
    let format = NSNumber::numberWithUnsignedInt(kAudioFormatMPEG4AAC);
    let sample_rate = NSNumber::numberWithDouble(f64::from(AUDIO_SAMPLE_RATE));
    let channels = NSNumber::numberWithUnsignedInt(AUDIO_CHANNELS);
    let bitrate = NSNumber::numberWithUnsignedInt(AUDIO_BITRATE);
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

pub(crate) struct AvWriter {
    writer: Retained<AVAssetWriter>,
    video_input: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    pool: Retained<CVPixelBufferPool>,
    audio: Option<AudioTrack>,
    width: u32,
    height: u32,
    fps_num: u32,
    fps_den: u32,
    /// 已追加的视频帧数，也是下一帧的帧号。
    frames: u64,
    /// 写入器已经收束（`finish` 走完）。
    closed: bool,
    /// AVFoundation 的影子文件目录。`shouldOptimizeForNetworkUse` 为把 moov 前置
    /// 会写一份接近成片大小的 `.sb-*` 临时文件，不指定目录时 macOS 可能把它放在
    /// 用户的输出目录旁边。字段顺序即析构顺序：它排在 writer **之后**，writer
    /// 先释放、AVFoundation 先收束自身文件，TempDir 再兜底清理。
    _temporary: tempfile::TempDir,
}

pub(crate) fn open(
    out: &Path,
    width: u32,
    height: u32,
    fps: f64,
    audio: Option<PcmSource>,
    bitrate: Option<u32>,
) -> Result<Box<dyn Mp4Sink>> {
    objc2::rc::autoreleasepool(|_| open_inner(out, width, height, fps, audio, bitrate))
        .map(|writer| Box::new(writer) as Box<dyn Mp4Sink>)
}

fn open_inner(
    out: &Path,
    width: u32,
    height: u32,
    fps: f64,
    audio: Option<PcmSource>,
    bitrate: Option<u32>,
) -> Result<AvWriter> {
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
    let (fps_num, fps_den) = frame_rate_rational(fps);
    let exact_fps = f64::from(fps_num) / f64::from(fps_den);
    // guard 先于 writer 创建，局部变量逆序析构时 writer 先释放：AVFoundation
    // 收束完自己的影子文件，TempDir 再兜底清理。
    let temporary = tempfile::Builder::new()
        .prefix("bcut-mp4-writer-")
        .tempdir()
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

    let bitrate = bitrate.unwrap_or_else(|| video_bitrate(width, height, exact_fps));
    let video_settings = unsafe { video_output_settings(width, height, bitrate, exact_fps) };
    let video_input = unsafe {
        AVAssetWriterInput::initWithMediaType_outputSettings(
            AVAssetWriterInput::alloc(),
            AVMediaTypeVideo.expect("AVMediaTypeVideo"),
            Some(&video_settings),
        )
    };
    unsafe { video_input.setExpectsMediaDataInRealTime(false) };
    // 非整数帧率把媒体时基钉在分子上：缺省 600 会把 29.97 的帧长取整成 20/600，
    // 读回来就是 30 fps（`bcut-kernel` 的 `pin_media_time_scale` 同一条规则）。
    if fps_den > 1
        && let Ok(scale) = i32::try_from(fps_num)
    {
        unsafe { video_input.setMediaTimeScale(scale) };
    }
    if !unsafe { writer.canAddInput(&video_input) } {
        bail!("unsupported: 本机没有可用的 H.264 编码器");
    }
    unsafe { writer.addInput(&video_input) };
    let adaptor = unsafe {
        AVAssetWriterInputPixelBufferAdaptor::initWithAssetWriterInput_sourcePixelBufferAttributes(
            AVAssetWriterInputPixelBufferAdaptor::alloc(),
            &video_input,
            Some(&adaptor_settings(width, height)),
        )
    };

    let audio_input = audio.as_ref().map(|_| {
        let input = unsafe {
            AVAssetWriterInput::initWithMediaType_outputSettings(
                AVAssetWriterInput::alloc(),
                AVMediaTypeAudio.expect("AVMediaTypeAudio"),
                Some(&audio_output_settings()),
            )
        };
        unsafe { input.setExpectsMediaDataInRealTime(false) };
        input
    });
    if let Some(input) = &audio_input {
        if !unsafe { writer.canAddInput(input) } {
            bail!("unsupported: 本机没有可用的 AAC 编码器");
        }
        unsafe { writer.addInput(input) };
    }

    if !unsafe { writer.startWriting() } {
        bail!(
            "unsupported: AVFoundation 无法启动 MP4 写入（{:?}）",
            unsafe { writer.error() }
        );
    }
    unsafe { writer.startSessionAtSourceTime(CMTime::new(0, 1)) };
    let pool = unsafe { adaptor.pixelBufferPool() }.context("AVFoundation 未创建像素缓冲池")?;

    let audio = match (audio, audio_input) {
        (Some(source), Some(input)) => Some(AudioTrack {
            input,
            format: pcm_format_description()?,
            source,
            finished: false,
        }),
        _ => None,
    };
    Ok(AvWriter {
        writer,
        video_input,
        adaptor,
        pool,
        audio,
        width,
        height,
        fps_num,
        fps_den,
        frames: 0,
        closed: false,
        _temporary: temporary,
    })
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
        // 等视频就绪，同时继续喂音频（交织死锁面，见 `pump_audio`）。
        let limit = self.video_seconds() + AUDIO_LEAD_SECONDS;
        loop {
            self.pump_audio(limit)?;
            if unsafe { self.video_input.isReadyForMoreMediaData() } {
                break;
            }
            self.check_failed()?;
            std::thread::sleep(BACKPRESSURE_NAP);
        }
        let buffer = new_pixel_buffer(&self.pool)?;
        unsafe { fill_bgra(&buffer, rgba, self.width, self.height)? };
        let timestamp = self.timestamp(self.frames);
        if !unsafe {
            self.adaptor
                .appendPixelBuffer_withPresentationTime(&buffer, timestamp)
        } {
            bail!("AVFoundation 写入视频帧失败：{:?}", unsafe {
                self.writer.error()
            });
        }
        self.frames += 1;
        Ok(())
    }

    /// 音频还需不需要继续喂：`video_end` 之前的部分都已交出即算完。
    fn audio_drained(&self, video_end: f64) -> bool {
        self.audio
            .as_ref()
            .is_none_or(|audio| audio.finished || audio.source.position_seconds() >= video_end)
    }

    fn close(&mut self) -> Result<()> {
        // 视频轨**先**收束，再排干音频。顺序不能反：writer 为保持交织可能压住
        // 音频的就绪位来等更多视频数据，而视频这时已经没有下一帧了——先
        // `markAsFinished` 才让它知道这一点，下面的排干循环就不会空转到超时。
        unsafe { self.video_input.markAsFinished() };
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
        // 半途丢弃（渲染出错 / 取消）：显式取消，别让编码器在后台把队列跑完。
        if !self.closed {
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
