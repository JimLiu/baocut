//! macOS 原生解码：单帧抽取走 `AVAssetImageGenerator`，顺序帧流走 `AVAssetReader`。
//!
//! ## 两条路径为什么不共用一个对象
//!
//! `AVAssetReader` 是为顺序流设计的：建一次 reader 只值得读一长串帧。缩略图与
//! filmstrip 恰恰相反——随机时间点、一次一帧。`AVAssetImageGenerator` 就是系统
//! 给后一个场景准备的接口（内部自己管解码器与 seek），把
//! `requestedTimeToleranceBefore/After` 置零后取帧是**精确**的，等价于迁移前
//! `ffmpeg -ss <t> -i <src> -frames:v 1` 的语义（快 seek 到关键帧再解到 t）。
//! 渲染管线的逐帧供片走下半个文件的 `AVAssetReader` 顺序流。
//!
//! ## 旋转
//!
//! 竖屏手机素材要摆正到显示方向：ffmpeg CLI 的 autorotate 默认开启，兜底路径的
//! 输出本来就是摆正的，两条路径必须一致。单帧路径靠
//! `appliesPreferredTrackTransform = YES`，顺序流没有这个开关，改从
//! `preferredTransform` 读出象限自己转。（这与 `bcut-media-probe` 的
//! `naturalW/H` 不含旋转是两回事：那是元数据口径，这是像素口径。）
//!
//! ## 尺寸
//!
//! 单帧路径的 `maximumSize` 只是**快路径提示**：它让系统在解码链路上就把帧缩
//! 下来，省掉整幅 4K 位图。但它只缩不放、且遵守自己的取整规则，所以最终尺寸由
//! 位图上下文说了算——按 [`crate::scaled_height`] 算出目标高，建一个恰好
//! `w × h` 的 RGBA 上下文，让 CoreGraphics 把 CGImage 画进去。上下文的第一行
//! 内存就是图像顶行，因此不需要额外翻转。顺序流缺省不缩放（`bcut-render` 的帧流
//! 要源尺寸原样）；成片导出的顺序解码器（[`crate::SequentialDecoder`]）给了交付
//! 尺寸时，`AVAssetReaderTrackOutput` 的输出设置带上宽高，解码链路直接交那个尺寸
//! （移植自 v2 `native_video.rs` 的 `reader_pixel_settings`）。

#![allow(deprecated)]

use std::path::Path;
use std::ptr::{self, NonNull};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, anyhow, bail};
use block2::RcBlock;
use objc2::AnyThread;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetImageGenerator, AVAssetReader, AVAssetReaderStatus, AVAssetReaderTrackOutput,
    AVAssetTrack, AVMediaTypeVideo, AVSampleBufferGenerator, AVSampleBufferRequest, AVSampleCursor,
    AVURLAsset,
};
use objc2_core_foundation::{
    CFDictionary, CFRetained, CFString, CGAffineTransform, CGPoint, CGRect, CGSize,
};
use objc2_core_graphics::{
    CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
    CGImageByteOrderInfo, CGInterpolationQuality,
};
use objc2_core_media::{
    CMFormatDescription, CMSampleBufferGetDuration, CMSampleBufferGetImageBuffer,
    CMSampleBufferGetPresentationTimeStamp, CMTime, CMTimeRange, kCMTimePositiveInfinity,
};
use objc2_core_video::{
    CVImageBuffer, CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow,
    CVPixelBufferGetHeight, CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress,
    CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress, kCVPixelBufferHeightKey,
    kCVPixelBufferPixelFormatTypeKey, kCVPixelBufferWidthKey, kCVPixelFormatType_32BGRA,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};
use objc2_video_toolbox::{VTDecodeFrameFlags, VTDecodeInfoFlags, VTDecompressionSession};

use crate::frames::{DecodedFrame, DecodedInto, FrameSource};
use crate::{RgbaFrame, scale};

/// 取帧时间的时基。600 是 24/25/30/60 fps 的公倍数，Apple 自家示例的惯用值：
/// 常见帧率的帧边界都能被精确表示，不会因为时基取整落到相邻帧。
const TIMESCALE: i32 = 600;

pub(crate) fn extract_frame_rgba(
    path: &Path,
    time_seconds: f64,
    target_width: u32,
) -> Result<RgbaFrame> {
    if !path.is_file() {
        bail!("媒体文件不存在：{}", path.display());
    }
    // AVFoundation 内部大量使用 autorelease；每次取帧自带一个池，filmstrip 连抓
    // 几十格时临时对象不会攒到线程退出。
    objc2::rc::autoreleasepool(|_| unsafe { extract_inner(path, time_seconds, target_width) })
}

unsafe fn extract_inner(path: &Path, time_seconds: f64, target_width: u32) -> Result<RgbaFrame> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) };
    let generator = unsafe { AVAssetImageGenerator::assetImageGeneratorWithAsset(&asset) };
    unsafe {
        generator.setAppliesPreferredTrackTransform(true);
        // 容差置零 = 精确取帧。留着默认的 kCMTimePositiveInfinity 容差时系统会
        // 直接给最近的关键帧，长 GOP 素材上能差出好几秒，filmstrip 会出现一串
        // 完全相同的格子。
        generator.setRequestedTimeToleranceBefore(CMTime::with_seconds(0.0, TIMESCALE));
        generator.setRequestedTimeToleranceAfter(CMTime::with_seconds(0.0, TIMESCALE));
        // 宽度约束的快路径提示：高度给一个不会成为约束的大值，让系统按宽缩放。
        generator.setMaximumSize(CGSize {
            width: f64::from(target_width),
            height: f64::from(u16::MAX),
        });
    }
    let requested = unsafe { CMTime::with_seconds(time_seconds, TIMESCALE) };
    let image =
        unsafe { generator.copyCGImageAtTime_actualTime_error(requested, std::ptr::null_mut()) }
            .map_err(|error| {
                anyhow!(
                    "AVFoundation 取帧失败（t={time_seconds:.3}s，{}）：{error}",
                    path.display()
                )
            })?;
    let source_width = CGImage::width(Some(&image));
    let source_height = CGImage::height(Some(&image));
    if source_width == 0 || source_height == 0 {
        bail!("AVFoundation 返回了空帧（t={time_seconds:.3}s）");
    }
    let height = scale::scaled_height(source_width as u32, source_height as u32, target_width);
    draw_into_rgba(&image, target_width, height)
}

/// CGImage → 恰好 `width × height` 的 top-down RGBA8。
///
/// 位图上下文的数据缓冲第一行就是图像顶行（CGBitmapContext 的既定内存布局），
/// 把 CGImage 画进 `(0, 0, w, h)` 矩形即得正立的 top-down 图，无需再翻转。
/// 缩放交给 CoreGraphics（高质量插值），不走本 crate 的 CPU 盒式滤波。
fn draw_into_rgba(image: &CGImage, width: u32, height: u32) -> Result<RgbaFrame> {
    let (pixel_width, pixel_height) = (width as usize, height as usize);
    let stride = pixel_width * 4;
    let mut data = vec![0_u8; stride * pixel_height];
    let color_space = CGColorSpace::new_device_rgb().context("创建 sRGB 设备色彩空间失败")?;
    // RGBA8：alpha 在末位、32 位大端序（即字节顺序 R,G,B,A）。视频帧不透明，
    // premultiplied 与否不影响结果；下面仍会把 alpha 统一压成 255。
    let bitmap_info = CGImageAlphaInfo::PremultipliedLast.0 | CGImageByteOrderInfo::Order32Big.0;
    let context = unsafe {
        CGBitmapContextCreate(
            data.as_mut_ptr().cast(),
            pixel_width,
            pixel_height,
            8,
            stride,
            Some(&color_space),
            bitmap_info,
        )
    }
    .context("创建 RGBA 位图上下文失败")?;
    CGContext::set_interpolation_quality(Some(&context), CGInterpolationQuality::High);
    CGContext::draw_image(
        Some(&context),
        CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: f64::from(width),
                height: f64::from(height),
            },
        },
        Some(image),
    );
    // 上下文还持有 `data` 的指针；显式丢弃，之后才动缓冲。
    drop(context);
    for pixel in data.chunks_exact_mut(4) {
        pixel[3] = 255;
    }
    RgbaFrame::new(width, height, data)
}

// ── 顺序帧流（WP6a）：`AVAssetReader` + `AVAssetReaderTrackOutput`
//
// ## 为什么不是 image generator
//
// 单帧路径每次都建解码器再精确 seek；整片渲染逐帧那么干，成本是纯粹的浪费。
// `AVAssetReader` 正是"建一次、一路读到底"的接口：`timeRange` 限定起点，之后
// `copyNextSampleBuffer` 顺序吐 `CMSampleBuffer`。
//
// ## 摆正得自己来
//
// track output **没有** `appliesPreferredTrackTransform`（那是 image generator /
// video composition 的能力）。这里从 `preferredTransform` 读出旋转象限，在
// CPU 上转（[`scale::rotate_rgba`]），与 ffmpeg CLI 的 autorotate 对齐。
// 非"纯 90 度倍数旋转"的仿射变换（镜像、任意角）直接判 unsupported 让调用方
// 回落 ffmpeg——猜错方向比不解更糟。

/// 摆正后的输出像素格式：32BGRA。选 BGRA 而不是 RGBA 是因为它是 VideoToolbox
/// 的原生输出格式之一（不用多一次转换），字节序换算只是逐像素交换 R/B。
const OUTPUT_PIXEL_FORMAT: u32 = kCVPixelFormatType_32BGRA;

/// `size` 是想要的交付尺寸（摆正后的显示方向）：给了就让解码链路直接交这个尺寸（见 [`start_reader`]）。
pub(crate) fn open_frame_source(
    path: &Path,
    from_seconds: f64,
    size: Option<(u32, u32)>,
) -> Result<Box<dyn FrameSource>> {
    if !path.is_file() {
        bail!("媒体文件不存在：{}", path.display());
    }
    objc2::rc::autoreleasepool(|_| unsafe { open_inner(path, from_seconds, size) })
}

unsafe fn open_inner(
    path: &Path,
    from_seconds: f64,
    size: Option<(u32, u32)>,
) -> Result<Box<dyn FrameSource>> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) };
    let media_type = unsafe { AVMediaTypeVideo }.context("AVMediaTypeVideo 未链接")?;
    let tracks = unsafe { asset.tracksWithMediaType(media_type) };
    let track = tracks
        .firstObject()
        .context("unsupported: 源媒体没有视频轨")?;

    let natural = unsafe { track.naturalSize() };
    let rotation = rotation_quadrant(unsafe { track.preferredTransform() })?;
    // 每帧的呈现时长。`AVAssetReaderTrackOutput` 交出的 `CMSampleBuffer`
    // **不带有效 duration**（`CMSampleBufferGetDuration` 给 kCMTimeInvalid，
    // 换算成秒是 NaN），所以时长只能从轨道属性来：`minFrameDuration` 就是
    // CFR 素材的帧长，拿不到再退回 `nominalFrameRate` 的倒数。没有它
    // `FrameStream` 判不出片尾，输出帧数会比 ffmpeg `-r` 少一到两帧。
    let track_frame_duration = unsafe { track.minFrameDuration().seconds() }
        .filter_positive()
        .or_else(|| {
            let rate = f64::from(unsafe { track.nominalFrameRate() });
            (rate > 0.0).then(|| 1.0 / rate)
        });
    let (coded_width, coded_height) = (
        natural.width.round().max(0.0) as u32,
        natural.height.round().max(0.0) as u32,
    );
    if coded_width == 0 || coded_height == 0 {
        bail!("unsupported: 源媒体没有有效的视频尺寸");
    }
    let (width, height) = match size {
        Some(size) => size,
        None if matches!(rotation, 90 | 270) => (coded_height, coded_width),
        None => (coded_width, coded_height),
    };
    // 解码端交付尺寸是编码方向（摆正之前）：90/270 度的素材宽高对调（v2 `EncodeTarget::decoded_size`）。
    // 与源尺寸相同就不请求，免得解码器多走一次缩放。
    let delivery = size
        .map(|(w, h)| {
            if matches!(rotation, 90 | 270) {
                (h, w)
            } else {
                (w, h)
            }
        })
        .filter(|delivery| *delivery != (coded_width, coded_height));

    let (reader, output) = unsafe { start_reader(&asset, &track, from_seconds, delivery)? };
    Ok(Box::new(AssetReaderFrames {
        asset,
        track,
        reader,
        output,
        width,
        height,
        coded_width,
        coded_height,
        delivery,
        rotation,
        track_frame_duration,
        finished: false,
        keyframes: None,
        keyframes_disabled: false,
    }))
}

/// `kCVPixelBuffer…Key` 这类 `CFStringRef` 与 `NSString *` toll-free bridged
/// （Apple 平台的既定 ABI），直接按指针换类型即可当字典键用。
fn cf_key(key: &CFString) -> &NSString {
    unsafe { &*ptr::from_ref(key).cast::<NSString>() }
}

/// 顺序流的像素输出设置：32BGRA，给了 `delivery`（编码方向的宽高）时再带上宽高，让解码链路直接交这个尺寸。
///
/// 移植自 v2 `native_video.rs` 的 `reader_pixel_settings`：成片导出每帧要的是画面里的尺寸，4K 素材在解码端就缩到
/// 1080p，省掉一次整幅 4K 的 BGRA 搬运与 CPU 重采样。不给宽高时交源尺寸原样（`bcut-render` 的帧流要的是这个）。
/// `kCVPixelBuffer…Key` 是 `CFStringRef`，与 `NSString *` toll-free bridged，直接按指针换类型（[`cf_key`]）。
unsafe fn reader_pixel_settings(
    delivery: Option<(u32, u32)>,
) -> Retained<NSDictionary<NSString, AnyObject>> {
    let format = NSNumber::new_u32(OUTPUT_PIXEL_FORMAT);
    let Some((width, height)) = delivery else {
        return NSDictionary::from_slices(
            &[cf_key(unsafe { kCVPixelBufferPixelFormatTypeKey })],
            &[format.as_ref() as &AnyObject],
        );
    };
    let width = NSNumber::new_u32(width);
    let height = NSNumber::new_u32(height);
    NSDictionary::from_slices(
        &[
            cf_key(unsafe { kCVPixelBufferPixelFormatTypeKey }),
            cf_key(unsafe { kCVPixelBufferWidthKey }),
            cf_key(unsafe { kCVPixelBufferHeightKey }),
        ],
        &[
            format.as_ref() as &AnyObject,
            width.as_ref() as &AnyObject,
            height.as_ref() as &AnyObject,
        ],
    )
}

/// 在已解析的 `asset` / `track` 上建一个从 `from_seconds` 起读的 reader。
///
/// 拆出来是为了 [`AssetReaderFrames::reopen`]：随机访问跳转只换 reader，不重
/// 解析容器、不重新找轨（那两步是完整重开里最贵的部分）。
unsafe fn start_reader(
    asset: &AVURLAsset,
    track: &AVAssetTrack,
    from_seconds: f64,
    delivery: Option<(u32, u32)>,
) -> Result<(Retained<AVAssetReader>, Retained<AVAssetReaderTrackOutput>)> {
    let reader = unsafe { AVAssetReader::assetReaderWithAsset_error(asset) }
        .map_err(|error| anyhow!("unsupported: 建立 AVAssetReader 失败（{error}）"))?;
    let settings = unsafe { reader_pixel_settings(delivery) };
    let output = unsafe {
        AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(
            track,
            Some(&settings),
        )
    };
    // 我们在下一次 `copyNextSampleBuffer` 之前就把像素拷进自己的 `Vec`，
    // 不需要 AVFoundation 再复制一份。
    unsafe { output.setAlwaysCopiesSampleData(false) };
    if !unsafe { reader.canAddOutput(&output) } {
        bail!("unsupported: AVAssetReader 不接受该视频轨的 32BGRA 输出（交付尺寸 {delivery:?}）");
    }
    unsafe { reader.addOutput(&output) };
    if from_seconds > 0.0 {
        // 起点之后一直读到片尾。AVAssetReader 会交出**与区间相交**的样本，
        // 也就是覆盖起点的那一帧也在内——正是 ffmpeg `-ss` 的语义。
        unsafe {
            reader.setTimeRange(CMTimeRange {
                start: CMTime::with_seconds(from_seconds, TIMESCALE),
                duration: kCMTimePositiveInfinity,
            })
        };
    }
    if !unsafe { reader.startReading() } {
        let detail = unsafe { reader.error() }
            .map(|error| error.to_string())
            .unwrap_or_else(|| "未知错误".to_owned());
        bail!("unsupported: AVAssetReader 无法读取该片源（{detail}）");
    }
    Ok((reader, output))
}

/// `Option<f64>` 的"只留有限正值"。`CMTimeGetSeconds` 用 NaN 表示无效时间，
/// 单独一个扩展比在四处各写一遍 `is_finite() && > 0.0` 清楚。
trait FilterPositive {
    fn filter_positive(self) -> Option<f64>;
    fn filter_finite(self) -> Option<f64>;
}

impl FilterPositive for f64 {
    fn filter_positive(self) -> Option<f64> {
        (self.is_finite() && self > 0.0).then_some(self)
    }
    fn filter_finite(self) -> Option<f64> {
        self.is_finite().then_some(self)
    }
}

/// `preferredTransform` → 顺时针旋转象限（0 / 90 / 180 / 270）。
///
/// 只认纯旋转：矩阵必须是 `[a b; c d]` 里恰好两个 ±1、另外两个 0，且行列式为 +1
/// （镜像的行列式是 −1）。角度取 `atan2(b, a)`——竖屏手机素材的
/// `preferredTransform` 是 `[0 1; -1 0]`，得 90，正是 ffmpeg autorotate 会顺时针
/// 转的角度。
fn rotation_quadrant(transform: CGAffineTransform) -> Result<u16> {
    const TOLERANCE: f64 = 1e-3;
    let CGAffineTransform { a, b, c, d, .. } = transform;
    let determinant = a * d - b * c;
    let pure_rotation = (determinant - 1.0).abs() < TOLERANCE
        && (a - d).abs() < TOLERANCE
        && (b + c).abs() < TOLERANCE
        && (a * a + b * b - 1.0).abs() < TOLERANCE;
    if !pure_rotation {
        bail!("unsupported: 视频轨的 preferredTransform 不是纯 90 度倍数旋转");
    }
    let degrees = b.atan2(a).to_degrees();
    let quadrant = (degrees / 90.0).round().rem_euclid(4.0) as u16 * 90;
    if (degrees - f64::from(quadrant))
        .abs()
        .min((degrees + 360.0 - f64::from(quadrant)).abs())
        > 1.0
    {
        bail!("unsupported: 视频轨的旋转角 {degrees:.2}° 不是 90 度的整数倍");
    }
    Ok(quadrant)
}

struct AssetReaderFrames {
    /// `reopen` 的新 reader 与关键帧解码器的样本生成器都挂在同一个 asset 上。
    asset: Retained<AVURLAsset>,
    /// 视频轨：`reopen` 在它上面建新的 output，`sync_sample_at_or_before`
    /// 用它的 sample cursor 找关键帧。
    track: Retained<AVAssetTrack>,
    reader: Retained<AVAssetReader>,
    output: Retained<AVAssetReaderTrackOutput>,
    width: u32,
    height: u32,
    /// 摆正**前**的编码尺寸：关键帧解码器要按它约束输出像素缓冲，才与
    /// `AVAssetReaderTrackOutput` 交出的帧同尺寸（clean aperture 已裁掉）。
    coded_width: u32,
    coded_height: u32,
    /// 向解码端请求的交付尺寸（编码方向）；`None` = 源尺寸原样。`reopen` 沿用。
    delivery: Option<(u32, u32)>,
    rotation: u16,
    /// 轨道级的帧时长（秒）；样本自带的 duration 无效时用它。
    track_frame_duration: Option<f64>,
    finished: bool,
    /// 拖动中的常驻关键帧解码器，第一次用到才建。
    keyframes: Option<KeyframeDecoder>,
    /// 关键帧解码器失败过一次就永久让位给「重开 + 解一帧」，不反复试。
    keyframes_disabled: bool,
}

/// 拖动中的关键帧解码器：`AVSampleBufferGenerator` 从容器里直接抓出关键帧的
/// **压缩**样本，交给一个常驻的 `VTDecompressionSession` 解。
///
/// `AVAssetReader` 每次重开都要重新建解码会话，1080p H.264 上第一帧要付
/// ≈ 50 ms 的冷启动（之后每帧 2 ms）；拖 playhead 一旦跨 GOP 就得付这个价，
/// 缩小时间轴后每次移动都跨 GOP，拖动就被钉在 12–15 fps。常驻会话只在
/// 格式描述变了才重建，关键帧本身是完全同步样本，一次 `DecodeFrame` 就出图。
struct KeyframeDecoder {
    generator: Retained<AVSampleBufferGenerator>,
    /// 当前会话与它接受的格式描述；样本换了格式且会话吃不下时重建。
    session: Option<(
        CFRetained<VTDecompressionSession>,
        CFRetained<CMFormatDescription>,
    )>,
    /// 目标像素缓冲属性：32BGRA、编码尺寸（让 VT 自己把 clean aperture 裁掉）。
    destination: Retained<NSDictionary<NSString, AnyObject>>,
}

impl KeyframeDecoder {
    unsafe fn new(asset: &AVURLAsset, coded_width: u32, coded_height: u32) -> Self {
        // timebase 为 nil：请求默认 immediate 模式，样本数据同步加载。
        let generator = unsafe {
            AVSampleBufferGenerator::initWithAsset_timebase(
                AVSampleBufferGenerator::alloc(),
                asset,
                None,
            )
        };
        let format = NSNumber::new_u32(OUTPUT_PIXEL_FORMAT);
        let width = NSNumber::new_u32(coded_width);
        let height = NSNumber::new_u32(coded_height);
        let destination = NSDictionary::from_slices(
            &[
                cf_key(unsafe { kCVPixelBufferPixelFormatTypeKey }),
                cf_key(unsafe { kCVPixelBufferWidthKey }),
                cf_key(unsafe { kCVPixelBufferHeightKey }),
            ],
            &[
                format.as_ref() as &AnyObject,
                width.as_ref() as &AnyObject,
                height.as_ref() as &AnyObject,
            ],
        );
        Self {
            generator,
            session: None,
            destination,
        }
    }

    /// 能解 `format` 的会话：手上的能用就复用，否则作废重建。
    unsafe fn session_for(
        &mut self,
        format: &CMFormatDescription,
    ) -> Result<&VTDecompressionSession> {
        let reusable = match &self.session {
            Some((session, current)) => {
                ptr::eq(&**current, format)
                    || unsafe { session.can_accept_format_description(format) }
            }
            None => false,
        };
        if !reusable {
            if let Some((session, _)) = self.session.take() {
                unsafe { session.invalidate() };
            }
            let attributes: &CFDictionary =
                unsafe { &*ptr::from_ref(&*self.destination).cast::<CFDictionary>() };
            let mut raw: *mut VTDecompressionSession = ptr::null_mut();
            // 不挂会话级回调：解帧走 `…WithOutputHandler`，回调随调用给。
            let status = unsafe {
                VTDecompressionSession::create(
                    None,
                    format,
                    None,
                    Some(attributes),
                    ptr::null(),
                    NonNull::from(&mut raw),
                )
            };
            let session = NonNull::new(raw).filter(|_| status == 0).with_context(|| {
                format!("unsupported: 建立 VTDecompressionSession 失败（OSStatus {status}）")
            })?;
            self.session = Some((unsafe { CFRetained::from_raw(session) }, unsafe {
                CFRetained::retain(NonNull::from(format))
            }));
        }
        Ok(&self.session.as_ref().expect("刚放进去").0)
    }
}

impl Drop for KeyframeDecoder {
    fn drop(&mut self) {
        if let Some((session, _)) = self.session.take() {
            unsafe { session.invalidate() };
        }
    }
}

/// 游标落在"呈现时刻 ≤ t 的最后一个样本"上，再沿解码顺序往回走到第一个
/// 完全同步样本——就是解码器要从哪一帧起解才能给出 t 的画面。
unsafe fn sync_cursor_at_or_before(
    track: &AVAssetTrack,
    time_seconds: f64,
) -> Option<Retained<AVSampleCursor>> {
    if !unsafe { track.canProvideSampleCursors() } {
        return None;
    }
    let cursor = unsafe {
        track.makeSampleCursorWithPresentationTimeStamp(CMTime::with_seconds(
            time_seconds,
            TIMESCALE,
        ))
    }?;
    let mut steps = 0_u32;
    while !unsafe { cursor.currentSampleSyncInfo() }
        .sampleIsFullSync
        .as_bool()
    {
        if steps >= SYNC_SEARCH_LIMIT || unsafe { cursor.stepInDecodeOrderByCount(-1) } == 0 {
            return None;
        }
        steps += 1;
    }
    Some(cursor)
}

/// 一次 `copyNextSampleBuffer` 的三种结局。用枚举而不是 `Option`＋哨兵错误，
/// 是因为"没有像素的样本"和"流结束"必须分得开：前者要继续读，后者才检查状态。
enum ReadStep {
    Frame(DecodedFrame),
    Skip,
    End,
}

impl AssetReaderFrames {
    /// 没读完就丢弃时显式取消，别让解码器把剩下的片源读完才收工。
    fn cancel(&mut self) {
        if !self.finished {
            unsafe { self.reader.cancelReading() };
            self.finished = true;
        }
    }

    /// 常驻解码器解出 `time_seconds` 之前最近关键帧那一张；`Ok(None)` 只在轨道
    /// 给不出 sample cursor 时出现，其余失败都是 `Err`。
    unsafe fn decode_keyframe(&mut self, time_seconds: f64) -> Result<Option<(f64, RgbaFrame)>> {
        let Some(cursor) = (unsafe { sync_cursor_at_or_before(&self.track, time_seconds) }) else {
            return Ok(None);
        };
        let Some(pts) = (unsafe { cursor.presentationTimeStamp().seconds() }).filter_finite()
        else {
            return Ok(None);
        };
        let decoder = match self.keyframes.as_mut() {
            Some(decoder) => decoder,
            None => self.keyframes.insert(unsafe {
                KeyframeDecoder::new(&self.asset, self.coded_width, self.coded_height)
            }),
        };
        let request = unsafe {
            AVSampleBufferRequest::initWithStartCursor(AVSampleBufferRequest::alloc(), &cursor)
        };
        unsafe {
            request.setPreferredMinSampleCount(1);
            request.setMaxSampleCount(1);
        }
        let sample = unsafe {
            decoder
                .generator
                .createSampleBufferForRequest_error(&request)
        }
        .map_err(|error| anyhow!("unsupported: 抓取关键帧样本失败（{error}）"))?;
        if !unsafe { sample.data_is_ready() } {
            let status = unsafe { sample.make_data_ready() };
            if status != 0 {
                bail!("unsupported: 关键帧样本数据加载失败（OSStatus {status}）");
            }
        }
        let format = unsafe { sample.format_description() }
            .context("unsupported: 关键帧样本没有格式描述")?;
        let session = unsafe { decoder.session_for(&format)? };
        // 同步解码（不开异步位）：回调在 `DecodeFrame` 返回前跑完，槽里就有帧。
        let slot: Arc<Mutex<Option<Result<RgbaFrame>>>> = Arc::new(Mutex::new(None));
        let sink = Arc::clone(&slot);
        let rotation = self.rotation;
        let handler = RcBlock::new(
            move |status: i32,
                  _info: VTDecodeInfoFlags,
                  image: *mut CVImageBuffer,
                  _: CMTime,
                  _: CMTime| {
                let decoded = if status != 0 {
                    Err(anyhow!("VideoToolbox 解关键帧失败（OSStatus {status}）"))
                } else if image.is_null() {
                    Err(anyhow!("VideoToolbox 没有交出像素"))
                } else {
                    unsafe { pixel_buffer_to_rgba(&*image, rotation) }
                };
                if let Ok(mut guard) = sink.lock() {
                    *guard = Some(decoded);
                }
            },
        );
        let mut info = VTDecodeInfoFlags::empty();
        let status = unsafe {
            session.decode_frame_with_output_handler(
                &sample,
                VTDecodeFrameFlags::empty(),
                &mut info,
                ptr::from_ref(&*handler).cast_mut(),
            )
        };
        if status != 0 {
            bail!("unsupported: VTDecompressionSessionDecodeFrame 失败（OSStatus {status}）");
        }
        // 解码器有权异步交帧；等它把所有在飞的帧都回调完再看槽。
        unsafe { session.wait_for_asynchronous_frames() };
        let frame = slot
            .lock()
            .map_err(|_| anyhow!("关键帧槽被毒化"))?
            .take()
            .context("VideoToolbox 没有回调")??;
        if (frame.width, frame.height) != (self.width, self.height) {
            bail!(
                "unsupported: 关键帧解码尺寸 {}x{} 与顺序流 {}x{} 不一致",
                frame.width,
                frame.height,
                self.width,
                self.height
            );
        }
        Ok(Some((pts, frame)))
    }
}

impl Drop for AssetReaderFrames {
    fn drop(&mut self) {
        self.cancel();
    }
}

/// 向解码顺序前方找关键帧时最多走多少个样本。H.264/HEVC 的 GOP 通常在几十
/// 到几百帧；这个上限只防病态片源（全片没有 sync 样本）把游标走到片头。
const SYNC_SEARCH_LIMIT: u32 = 4096;

impl FrameSource for AssetReaderFrames {
    fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn reopen(&mut self, from_seconds: f64) -> Result<()> {
        self.cancel();
        let (reader, output) = objc2::rc::autoreleasepool(|_| unsafe {
            start_reader(&self.asset, &self.track, from_seconds, self.delivery)
        })?;
        self.reader = reader;
        self.output = output;
        self.finished = false;
        Ok(())
    }

    fn sync_sample_at_or_before(&self, time_seconds: f64) -> Result<Option<f64>> {
        objc2::rc::autoreleasepool(|_| unsafe {
            Ok(sync_cursor_at_or_before(&self.track, time_seconds)
                .and_then(|cursor| cursor.presentationTimeStamp().seconds().filter_finite()))
        })
    }

    fn keyframe_at_or_before(&mut self, time_seconds: f64) -> Result<Option<(f64, RgbaFrame)>> {
        if self.keyframes_disabled {
            return Ok(None);
        }
        let decoded = objc2::rc::autoreleasepool(|_| unsafe { self.decode_keyframe(time_seconds) });
        match decoded {
            Ok(found) => Ok(found),
            // 常驻解码器答不了这条片源（VT 不认的编码、尺寸对不上……）：让位给
            // 「重开 + 解一帧」，那条路语义相同只是慢；不把错误往上抛，否则
            // 上层会把整条片源降级到 ffmpeg。
            Err(_) => {
                self.keyframes_disabled = true;
                self.keyframes = None;
                Ok(None)
            }
        }
    }

    fn next_decoded_into(&mut self, data: &mut Vec<u8>) -> Result<Option<DecodedInto>> {
        if self.finished {
            return Ok(None);
        }
        loop {
            // 每帧一个 autorelease 池（同 `next_decoded`）。
            let step = objc2::rc::autoreleasepool(|_| -> Result<Option<Option<DecodedInto>>> {
                let Some(sample) = (unsafe { self.output.copyNextSampleBuffer() }) else {
                    return Ok(None);
                };
                let pts_seconds =
                    unsafe { CMSampleBufferGetPresentationTimeStamp(&sample).seconds() };
                let duration_seconds = unsafe { CMSampleBufferGetDuration(&sample).seconds() }
                    .filter_positive()
                    .or(self.track_frame_duration);
                let Some(image) = (unsafe { CMSampleBufferGetImageBuffer(&sample) }) else {
                    return Ok(Some(None));
                };
                let (width, height) = if self.rotation == 0 {
                    // 不转的素材（绝大多数）直接从像素缓冲换进调用方的缓冲：不分配、不再复制一遍。
                    unsafe { pixel_buffer_into_rgba(image.as_ref(), data)? }
                } else {
                    let frame = unsafe { pixel_buffer_to_rgba(image.as_ref(), self.rotation)? };
                    *data = frame.data;
                    (frame.width, frame.height)
                };
                Ok(Some(Some(DecodedInto {
                    pts_seconds,
                    duration_seconds,
                    width,
                    height,
                })))
            })?;
            match step {
                Some(Some(frame)) => return Ok(Some(frame)),
                Some(None) => continue,
                None => {
                    self.finished = true;
                    if unsafe { self.reader.status() } != AVAssetReaderStatus::Completed {
                        let detail = unsafe { self.reader.error() }
                            .map(|error| error.to_string())
                            .unwrap_or_else(|| "未知错误".to_owned());
                        bail!("AVAssetReader 解码中断（{detail}）");
                    }
                    return Ok(None);
                }
            }
        }
    }

    fn next_decoded(&mut self) -> Result<Option<DecodedFrame>> {
        if self.finished {
            return Ok(None);
        }
        loop {
            // 每帧一个 autorelease 池：AVFoundation 内部的临时对象不会攒到线程退出。
            let step = objc2::rc::autoreleasepool(|_| -> Result<ReadStep> {
                let Some(sample) = (unsafe { self.output.copyNextSampleBuffer() }) else {
                    return Ok(ReadStep::End);
                };
                let pts_seconds =
                    unsafe { CMSampleBufferGetPresentationTimeStamp(&sample).seconds() };
                // `CMTimeGetSeconds` 对 invalid / indefinite 的 CMTime 给 NaN。
                // asset reader 的样本实测就是这种，所以退回轨道级帧长。
                let duration_seconds = unsafe { CMSampleBufferGetDuration(&sample).seconds() }
                    .filter_positive()
                    .or(self.track_frame_duration);
                let Some(image) = (unsafe { CMSampleBufferGetImageBuffer(&sample) }) else {
                    // 没有像素的样本（格式变更等标记）：跳过，不算 EOF。
                    return Ok(ReadStep::Skip);
                };
                let frame = unsafe { pixel_buffer_to_rgba(image.as_ref(), self.rotation)? };
                Ok(ReadStep::Frame(DecodedFrame {
                    pts_seconds,
                    duration_seconds,
                    frame,
                }))
            })?;
            match step {
                ReadStep::Frame(frame) => return Ok(Some(frame)),
                ReadStep::Skip => continue,
                ReadStep::End => {
                    self.finished = true;
                    // 读完了才有资格问状态：`Completed` 之外都是真失败。
                    if unsafe { self.reader.status() } != AVAssetReaderStatus::Completed {
                        let detail = unsafe { self.reader.error() }
                            .map(|error| error.to_string())
                            .unwrap_or_else(|| "未知错误".to_owned());
                        bail!("AVAssetReader 解码中断（{detail}）");
                    }
                    return Ok(None);
                }
            }
        }
    }
}

/// `CVPixelBuffer`（32BGRA）→ 摆正后的 top-down RGBA8。
///
/// `bytesPerRow` 通常带对齐补白（16/64 字节），**不能**当成 `width * 4`。
unsafe fn pixel_buffer_to_rgba(
    buffer: &objc2_core_video::CVPixelBuffer,
    rotation: u16,
) -> Result<RgbaFrame> {
    let flags = CVPixelBufferLockFlags::ReadOnly;
    if unsafe { CVPixelBufferLockBaseAddress(buffer, flags) } != 0 {
        bail!("锁定 CVPixelBuffer 失败");
    }
    let width = CVPixelBufferGetWidth(buffer);
    let height = CVPixelBufferGetHeight(buffer);
    let stride = CVPixelBufferGetBytesPerRow(buffer);
    let base = CVPixelBufferGetBaseAddress(buffer);
    let outcome = if base.is_null() || width == 0 || height == 0 || stride < width * 4 {
        Err(anyhow!("AVFoundation 返回了不完整的 32BGRA 视频帧"))
    } else {
        let mut data = vec![0_u8; width * height * 4];
        for y in 0..height {
            let row =
                unsafe { std::slice::from_raw_parts(base.cast::<u8>().add(y * stride), width * 4) };
            let out = &mut data[y * width * 4..(y + 1) * width * 4];
            swizzle_bgra_to_rgba_row(row, out);
        }
        RgbaFrame::new(width as u32, height as u32, data)
    };
    // 解锁无条件执行，不因上面的错误提前返回而漏掉。
    let unlocked = unsafe { CVPixelBufferUnlockBaseAddress(buffer, flags) };
    let frame = outcome?;
    if unlocked != 0 {
        bail!("解锁 CVPixelBuffer 失败");
    }
    Ok(scale::rotate_rgba(&frame, rotation))
}

/// `CVPixelBuffer`（32BGRA、不需要摆正）→ 紧排的 top-down RGBA8，写进 `data`（长度改成一帧）。返回宽高。
unsafe fn pixel_buffer_into_rgba(
    buffer: &objc2_core_video::CVPixelBuffer,
    data: &mut Vec<u8>,
) -> Result<(u32, u32)> {
    let flags = CVPixelBufferLockFlags::ReadOnly;
    if unsafe { CVPixelBufferLockBaseAddress(buffer, flags) } != 0 {
        bail!("锁定 CVPixelBuffer 失败");
    }
    let width = CVPixelBufferGetWidth(buffer);
    let height = CVPixelBufferGetHeight(buffer);
    let stride = CVPixelBufferGetBytesPerRow(buffer);
    let base = CVPixelBufferGetBaseAddress(buffer);
    let outcome = if base.is_null() || width == 0 || height == 0 || stride < width * 4 {
        Err(anyhow!("AVFoundation 返回了不完整的 32BGRA 视频帧"))
    } else {
        let row = width * 4;
        data.resize(row * height, 0);
        for (y, out) in data.chunks_exact_mut(row).enumerate() {
            let source =
                unsafe { std::slice::from_raw_parts(base.cast::<u8>().add(y * stride), row) };
            swizzle_bgra_to_rgba_row(source, out);
        }
        Ok((width as u32, height as u32))
    };
    // 解锁无条件执行，不因上面的错误提前返回而漏掉。
    let unlocked = unsafe { CVPixelBufferUnlockBaseAddress(buffer, flags) };
    let size = outcome?;
    if unlocked != 0 {
        bail!("解锁 CVPixelBuffer 失败");
    }
    Ok(size)
}

/// 一行 32BGRA → RGBA（alpha 压成 255）。
///
/// 内存序 B,G,R,A → R,G,B,A。视频帧不透明，alpha 一律压成 255：平台可能把它
/// 留成未定义字节，漏下去合成时会变成黑图。按 `u32` 整像素换算而不是逐字节
/// 搬——1080p 一帧 200 万像素，逐字节循环在 debug 构建里要 15 ms 以上，是
/// 预览取帧路径里仅次于解码的开销；整字换算能让编译器直接向量化。
fn swizzle_bgra_to_rgba_row(source: &[u8], target: &mut [u8]) {
    debug_assert_eq!(source.len(), target.len());
    for (bgra, rgba) in source.chunks_exact(4).zip(target.chunks_exact_mut(4)) {
        let px = u32::from_le_bytes([bgra[0], bgra[1], bgra[2], bgra[3]]);
        let out = ((px >> 16) & 0xFF) | (px & 0xFF00) | ((px & 0xFF) << 16) | 0xFF00_0000;
        rgba.copy_from_slice(&out.to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 整字换算与逐字节交换逐字节相同（含 alpha 压 255）。
    #[test]
    fn swizzle_matches_byte_wise_swap() {
        let source: Vec<u8> = (0..64_u8).map(|i| i.wrapping_mul(37)).collect();
        let mut expected = vec![0_u8; source.len()];
        for (s, t) in source.chunks_exact(4).zip(expected.chunks_exact_mut(4)) {
            t[0] = s[2];
            t[1] = s[1];
            t[2] = s[0];
            t[3] = 255;
        }
        let mut actual = vec![0_u8; source.len()];
        swizzle_bgra_to_rgba_row(&source, &mut actual);
        assert_eq!(actual, expected);
    }

    /// 四个象限的 `preferredTransform` 与 ffmpeg autorotate 同口径；镜像与任意角
    /// 判 unsupported（让调用方回落 ffmpeg，而不是猜一个方向转出去）。
    #[test]
    fn preferred_transforms_map_to_clockwise_quadrants() {
        let make = |a, b, c, d| CGAffineTransform {
            a,
            b,
            c,
            d,
            tx: 0.0,
            ty: 0.0,
        };
        assert_eq!(rotation_quadrant(make(1.0, 0.0, 0.0, 1.0)).unwrap(), 0);
        assert_eq!(rotation_quadrant(make(0.0, 1.0, -1.0, 0.0)).unwrap(), 90);
        assert_eq!(rotation_quadrant(make(-1.0, 0.0, 0.0, -1.0)).unwrap(), 180);
        assert_eq!(rotation_quadrant(make(0.0, -1.0, 1.0, 0.0)).unwrap(), 270);
        // 水平镜像（行列式 −1）与 45 度：都不接。
        assert!(rotation_quadrant(make(-1.0, 0.0, 0.0, 1.0)).is_err());
        let half = std::f64::consts::FRAC_1_SQRT_2;
        assert!(rotation_quadrant(make(half, half, -half, half)).is_err());
    }
}
