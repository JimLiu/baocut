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

/// 别的时钟（AVCaptureSession 的同步时钟）上的时刻换到主机时钟上。
pub fn to_host(time: CMTime, from: &CMClock) -> CMTime {
    let host = host_clock();
    unsafe {
        CMSyncConvertTime(
            time,
            &*(from as *const CMClock as *const CMClockOrTimebase),
            &*(&*host as *const CMClock as *const CMClockOrTimebase),
        )
    }
}
