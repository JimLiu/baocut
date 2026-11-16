//! 画面静止时补写重复帧的节奏（屏幕录制设计 §7「输出文件的容器与编码」）。与平台无关，只算「该不该补」。
//!
//! ScreenCaptureKit 只在内容变化时送新画面：屏幕静止时送的是没有像素的 `idle` 样本，窗口被隐藏或最小化时连 `idle`
//! 也不送。写入端只有收到样本时才往前写分片，所以画面静止期间被强杀，最后一个分片之后的内容全部丢失（实测静止
//! 5 秒后强杀，文件读不出来）。补帧把上一帧完整的画面换一个时刻再写一次，文件每隔 [`REPEAT_GAP_NS`] 至少有一帧，
//! 加上一秒一个的分片，崩溃时最多丢最近约一秒半。

/// 画面多久没有新帧就补一帧（纳秒）。小于分片间隔（一秒），崩溃时丢的不超过一个分片加这一段。
pub const REPEAT_GAP_NS: u64 = 500_000_000;

/// 连 `idle` 样本也没有时（窗口被隐藏、最小化），定时检查的间隔与补帧前多等的时长（纳秒）：有样本时由样本驱动补帧，
/// 定时检查只兜底。
pub const KEEP_ALIVE_POLL_NS: u64 = 250_000_000;
pub const KEEP_ALIVE_GAP_NS: u64 = 1_000_000_000;

/// 上一个写下的样本在 `last`，现在到了 `at`（同一个时钟，纳秒）：间隔到了 `gap` 才补。`at` 不晚于 `last` 时不补
/// （写入端要求时刻递增）。
pub fn due(last: u64, at: u64, gap: u64) -> bool {
    at > last && at - last >= gap
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeats_only_after_the_gap() {
        assert!(!due(1_000, 1_000, REPEAT_GAP_NS));
        assert!(!due(1_000, 1_000 + REPEAT_GAP_NS - 1, REPEAT_GAP_NS));
        assert!(due(1_000, 1_000 + REPEAT_GAP_NS, REPEAT_GAP_NS));
        assert!(due(0, 3 * REPEAT_GAP_NS, REPEAT_GAP_NS));
    }

    #[test]
    fn never_goes_back_in_time() {
        assert!(!due(5_000_000_000, 4_000_000_000, REPEAT_GAP_NS));
        assert!(!due(5_000_000_000, 5_000_000_000, 0));
    }

    #[test]
    fn gaps_stay_under_the_fragment_interval() {
        // 分片一秒一个：补帧的间隔要小于它，定时兜底的间隔不超过它。
        assert!(REPEAT_GAP_NS < 1_000_000_000);
        assert!(KEEP_ALIVE_GAP_NS <= 1_000_000_000);
        assert!(KEEP_ALIVE_POLL_NS < KEEP_ALIVE_GAP_NS);
    }
}
