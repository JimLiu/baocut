//! 各路流共用的单调时钟：CoreMedia 的主机时钟（`CMClockGetHostTimeClock`，`mach_absolute_time` 的时间）。
//! ScreenCaptureKit 的样本时刻本来就在这个时钟上；AVCaptureSession 的样本时刻在会话的同步时钟上，用 `CMSyncConvertTime`
//! 换过来（AVCaptureSession 的 `synchronizationClock` 文档）。

use objc2_core_media::{CMClock, CMClockOrTimebase, CMSyncConvertTime, CMTime, CMTimeFlags, CMTimeRoundingMethod};

use crate::protocol::Ns;

const NANOS: i32 = 1_000_000_000;

pub fn host_clock() -> objc2_core_foundation::CFRetained<CMClock> {
    unsafe { CMClock::host_time_clock() }
}

pub fn now() -> Ns {
    let time = unsafe { host_clock().time() };
    to_ns(time).unwrap_or(Ns(0))
}

/// 主机时钟上的一个时刻换成纳秒；无效、无穷或负的时刻是 None。
pub fn to_ns(time: CMTime) -> Option<Ns> {
    if !time.flags.contains(CMTimeFlags::Valid) || time.flags.contains(CMTimeFlags::PositiveInfinity) || time.flags.contains(CMTimeFlags::NegativeInfinity) {
        return None;
    }
    let scaled = unsafe { time.convert_scale(NANOS, CMTimeRoundingMethod::RoundHalfAwayFromZero) };
    u64::try_from(scaled.value).ok().map(Ns)
}

/// 纳秒换回主机时钟上的时刻（`AVAssetWriter` 的 `endSessionAtSourceTime` 用）。
pub fn from_ns(at: Ns) -> CMTime {
    unsafe { CMTime::new(at.0 as i64, NANOS) }
}

fn convert(time: CMTime, from: &CMClock, to: &CMClock) -> CMTime {
    // CMClock 与 CMTimebase 共用 `CMClockOrTimebase` 这个参数类型（CMSync.h）。
    unsafe {
        CMSyncConvertTime(time, &*(from as *const CMClock as *const CMClockOrTimebase), &*(to as *const CMClock as *const CMClockOrTimebase))
    }
}

/// 别的时钟（采集会话的同步时钟）上的时刻换到主机时钟上。
pub fn to_host(time: CMTime, from: &CMClock) -> CMTime {
    convert(time, from, &host_clock())
}

/// 主机时钟上的时刻换到别的时钟上。
pub fn from_host(time: CMTime, to: &CMClock) -> CMTime {
    convert(time, &host_clock(), to)
}

/// AVFoundation 与 ScreenCaptureKit 把 `CMClock` 当 Objective-C 对象交出来（`Retained`）；它就是 CoreFoundation 的对象，
/// 换成 `CFRetained` 交给 CoreMedia 的函数用。
pub fn cf_clock(clock: objc2::rc::Retained<CMClock>) -> objc2_core_foundation::CFRetained<CMClock> {
    let raw = objc2::rc::Retained::into_raw(clock);
    // SAFETY: 两种句柄都持有一次引用计数，这里把它原样转交。
    unsafe { objc2_core_foundation::CFRetained::from_raw(std::ptr::NonNull::new_unchecked(raw)) }
}
