//! 恒定质量编码的码率封顶：按刚压好的一段实际码率调编码器的质量（macOS 写入器用）。
//!
//! VideoToolbox 的 H.264 在恒定质量（`kVTCompressionPropertyKey_Quality`）下码率随内容长，噪声这类内容在质量 0.75 时
//! 1080p30 能到近 200 Mb/s。编码器自己的上限都用不上（M5 Max 实测）：`AverageBitRate` 与 VBV 上限被质量盖过、
//! 没有作用；`DataRateLimits` 一给，编码器改成在上限之下按平均码率压，质量不再起作用，平稳的素材反而变大。
//! 所以封顶在写入端做：每攒满一个窗口（一个关键帧间隔，正好含一个关键帧）算一次实际码率，超过上限就降质量，
//! 降过之后码率回落得足够低再往回升，最高回到目标质量。编码器中途改质量几帧之内生效。
//!
//! 这是安全网，不是码率控制：一个窗口之内仍可能超出上限，下一个窗口才压回来。

/// 质量每升 0.1，码率约涨 1.7 倍（`ln(1.7) / 0.1`）。验收与测试 §4 的标定里六段素材在质量 0.55–0.80 之间
/// 每 0.1 涨 1.4–2.0 倍（再往上更陡，0.8–0.9 涨 2.4–3.4 倍）；按它换算第一步要改多少。改过一次之后用实测的
/// 响应（前后两个窗口的码率比）：噪声这类素材陡得多（每 0.1 涨三倍上下），按 1.7 倍换算会来回过冲。
const RESPONSE: f64 = 5.3;
/// 实测响应的上限：窗口之间内容也在变，实测值可能离谱。下限就是缺省估计：估小了步子迈大、来回过冲，
/// 估大了只是慢一点收敛。
const MAX_RESPONSE: f64 = 15.0;
/// 超出上限后瞄准的码率（上限的比例）：留余量，免得下一个窗口又顶上去。
const LAND: f64 = 0.85;
/// 降过质量之后，窗口码率低于上限的这个比例才往回升。
const RAISE_BELOW: f64 = 0.6;
/// 质量的下限。再低画面就糊了；到这里还压不住就随它超出。
pub(crate) const QUALITY_FLOOR: f64 = 0.2;
/// 小于这个差就不改，免得在下限上反复设同一个值。
const MIN_STEP: f64 = 0.005;
/// 改质量之后不计的帧数：编码器里还有按旧质量压的帧在路上（B 帧重排与前瞻）。
const SETTLE_FRAMES: usize = 8;

/// 一路编码的质量封顶状态。
#[derive(Debug)]
pub(crate) struct QualityCap {
    /// 目标质量：没有超出上限时用它。
    target: f64,
    /// 编码器当前的质量。
    current: f64,
    /// 一个窗口的帧数。
    window: usize,
    /// 一个窗口允许的字节数（上限码率 × 窗口时长）。
    limit_bytes: f64,
    /// 当前窗口攒下的帧数与字节数。
    frames: usize,
    bytes: u64,
    /// 改质量之后还要跳过的帧数。
    settle: usize,
    /// 质量与码率的响应（`ln(码率比) / 质量差`）。
    response: f64,
    /// 上一次改质量之前那个窗口：质量与码率比（实得 / 上限），用来量响应。
    previous: Option<(f64, f64)>,
}

impl QualityCap {
    /// `quality` 是目标质量，`max_bitrate` 是上限（bit/s），`fps` 是帧率，`window` 是窗口的帧数（至少 1）。
    pub(crate) fn new(quality: f64, max_bitrate: u32, fps: f64, window: usize) -> Self {
        let window = window.max(1);
        Self {
            target: quality,
            current: quality,
            window,
            limit_bytes: f64::from(max_bitrate) / 8.0 * window as f64 / fps,
            frames: 0,
            bytes: 0,
            settle: 0,
            response: RESPONSE,
            previous: None,
        }
    }

    /// 记一个压好的样本（按解码顺序）。窗口攒满时决定要不要改质量，要改时返回新的质量。
    pub(crate) fn record(&mut self, bytes: u64) -> Option<f64> {
        if self.settle > 0 {
            self.settle -= 1;
            return None;
        }
        self.bytes = self.bytes.saturating_add(bytes);
        self.frames += 1;
        if self.frames < self.window {
            return None;
        }
        let ratio = self.bytes as f64 / self.limit_bytes;
        self.frames = 0;
        self.bytes = 0;
        // 上一次改过质量：用这个窗口与改之前那个窗口的码率比量出响应。码率为 0 时量不出来。
        if let Some((quality, before)) = self.previous.take()
            && ratio > 0.0
            && (self.current - quality).abs() >= MIN_STEP
        {
            let measured = (ratio / before).ln() / (self.current - quality);
            if measured.is_finite() {
                self.response = measured.clamp(RESPONSE, MAX_RESPONSE);
            }
        }
        // `ratio` 为 0 时 `ln` 得正无穷，升的一支取到目标质量为止。
        let step = (LAND / ratio).ln() / self.response;
        let next = if ratio > 1.0 {
            (self.current + step).max(QUALITY_FLOOR)
        } else if self.current < self.target && ratio < RAISE_BELOW {
            // 往回升只走半步：升过头就要再降，那一个窗口是超出上限的。
            (self.current + step / 2.0).min(self.target)
        } else {
            return None;
        };
        if (next - self.current).abs() < MIN_STEP {
            return None;
        }
        self.previous = Some((self.current, ratio));
        self.current = next;
        self.settle = SETTLE_FRAMES.min(self.window / 4);
        Some(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 30 fps、一个窗口 60 帧、上限 10 Mb/s：一个窗口允许 2.5 MB，平均每帧 41 667 字节。
    fn cap() -> QualityCap {
        QualityCap::new(0.75, 10_000_000, 30.0, 60)
    }

    fn feed(cap: &mut QualityCap, frames: usize, bytes: u64) -> Vec<f64> {
        (0..frames).filter_map(|_| cap.record(bytes)).collect()
    }

    #[test]
    fn stays_on_the_target_while_under_the_cap() {
        let mut cap = cap();
        assert!(feed(&mut cap, 600, 41_000).is_empty());
        assert_eq!(cap.current, 0.75);
    }

    #[test]
    fn decides_once_per_full_window() {
        let mut cap = cap();
        // 两倍于上限：窗口攒满之前不动，攒满的那一帧给出新质量。
        assert!(feed(&mut cap, 59, 83_334).is_empty());
        let lowered = cap.record(83_334).expect("over the cap");
        let expected = 0.75 + (0.85_f64 / 2.0).ln() / RESPONSE;
        assert!((lowered - expected).abs() < 1e-3, "{lowered} vs {expected}");
    }

    #[test]
    fn lowers_over_the_cap_and_climbs_back_to_the_target_only() {
        let mut cap = cap();
        let lowered = feed(&mut cap, 60, 125_000);
        assert_eq!(lowered.len(), 1);
        assert!(lowered[0] < 0.75);
        // 降下来之后码率落在上限的 0.6–1 之间：不动。
        assert!(feed(&mut cap, 60, 33_000).is_empty());
        // 素材变平稳：往回升，但不超过目标质量。
        let raised = feed(&mut cap, 600, 1_000);
        assert_eq!(raised.last().copied(), Some(0.75));
        assert!(raised.iter().all(|&quality| quality <= 0.75));
        // 已在目标上，再平稳也不动。
        assert!(feed(&mut cap, 600, 1_000).is_empty());
    }

    #[test]
    fn never_goes_below_the_floor() {
        let mut cap = cap();
        let steps = feed(&mut cap, 6_000, 10_000_000);
        assert!(!steps.is_empty());
        assert_eq!(steps.last().copied(), Some(QUALITY_FLOOR));
        // 已在下限：不再反复设同一个值。
        assert!(feed(&mut cap, 600, 10_000_000).is_empty());
    }

    /// 噪声这类素材：码率对质量的响应比缺省估计陡得多（每 0.1 涨 2.5 倍）。第一步按缺省估计降，之后用实测的
    /// 响应：收敛到上限之下，不来回过冲。
    #[test]
    fn converges_under_the_cap_on_a_steep_response() {
        let mut cap = cap();
        // 质量 0.75 时码率是上限的 10 倍；改质量 4 帧之后才生效（编码器里在路上的帧）。
        let per_frame = |quality: f64| 41_667.0 * 10.0 * (9.0 * (quality - 0.75)).exp();
        let mut applied = std::collections::VecDeque::from([0.75; 4]);
        let mut quality = 0.75;
        let mut ratios = Vec::new();
        for _ in 0..40 {
            for _ in 0..60 {
                let encoded_at = applied.pop_front().unwrap();
                if let Some(next) = cap.record(per_frame(encoded_at).round() as u64) {
                    quality = next;
                }
                applied.push_back(quality);
            }
            ratios.push(per_frame(quality) / 41_667.0);
        }
        let settled = &ratios[6..];
        assert!(settled.iter().all(|&ratio| ratio <= 1.0), "{ratios:?}");
        assert!(settled.iter().all(|&ratio| ratio >= 0.5), "{ratios:?}");
    }

    #[test]
    fn a_zero_window_is_treated_as_one_frame() {
        let mut cap = QualityCap::new(0.75, 10_000_000, 30.0, 0);
        assert!(cap.record(1_000_000).is_some());
    }
}
