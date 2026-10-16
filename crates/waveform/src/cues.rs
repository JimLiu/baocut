//! 声音与画面事件对不对得上：把一串时刻（切点、动画落点、放音效的地方）对到最近的起音，再给出
//! 「碰巧也能对上多少」的基线；另找出整段里明显高出周围的起音（重音），剪辑点与画面重拍该落在它们上。
//!
//! 思路参考开源项目 earshot（MIT 许可）的同步检查：命中率要跟碰巧命中的概率一起看才有意义，起音越密，
//! 随便放一个时刻落进容差里的机会越大。这里是独立实现。
//!
//! 时间都是秒，与 [`crate::beats::features`] 的起音同一个时钟（PCM 的第 0 个采样是 0）。

/// 一个时刻的对齐结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CueStatus {
    /// 最近的起音在 `tolerance` 以内。
    Ok,
    /// 在 `near_tolerance` 以内：听得出先后，值得挪一下。
    Near,
    /// 附近没有起音。
    None,
    /// 时刻不在这段音频里。
    Outside,
}

impl CueStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            CueStatus::Ok => "ok",
            CueStatus::Near => "near",
            CueStatus::None => "none",
            CueStatus::Outside => "outside",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CueMatch {
    /// 给的时刻。
    pub t: f64,
    /// 最近的起音减去时刻（秒）：正的是声音晚到。没有起音或在音频外时为 `None`。
    pub delta: Option<f64>,
    pub status: CueStatus,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SyncReport {
    pub tolerance: f64,
    pub near_tolerance: f64,
    pub cues: Vec<CueMatch>,
    /// 落在音频里的时刻数（`outside` 不算）。
    pub inside: usize,
    pub ok: usize,
    pub near: usize,
    pub none: usize,
    pub outside: usize,
    /// `ok / inside`；没有落在音频里的时刻时为 0。
    pub hit_rate: f64,
    /// 碰巧命中的概率：全部起音 `±tolerance` 窗口的并集长度占时长的比例。
    pub chance: f64,
}

/// 时刻 `cues` 对到起音 `onsets`（升序）。`duration` 是音频时长；`[0, duration]` 外的时刻是 `outside`。
pub fn sync(
    cues: &[f64],
    onsets: &[f64],
    duration: f64,
    tolerance: f64,
    near_tolerance: f64,
) -> SyncReport {
    let near_tolerance = near_tolerance.max(tolerance);
    let mut report = SyncReport {
        tolerance,
        near_tolerance,
        cues: Vec::with_capacity(cues.len()),
        inside: 0,
        ok: 0,
        near: 0,
        none: 0,
        outside: 0,
        hit_rate: 0.0,
        chance: chance(onsets, duration, tolerance),
    };
    for &t in cues {
        if !(0.0..=duration).contains(&t) {
            report.outside += 1;
            report.cues.push(CueMatch {
                t,
                delta: None,
                status: CueStatus::Outside,
            });
            continue;
        }
        report.inside += 1;
        let delta = nearest(onsets, t).map(|onset| onset - t);
        let status = match delta.map(f64::abs) {
            Some(d) if d <= tolerance => CueStatus::Ok,
            Some(d) if d <= near_tolerance => CueStatus::Near,
            _ => CueStatus::None,
        };
        match status {
            CueStatus::Ok => report.ok += 1,
            CueStatus::Near => report.near += 1,
            _ => report.none += 1,
        }
        report.cues.push(CueMatch { t, delta, status });
    }
    if report.inside > 0 {
        report.hit_rate = report.ok as f64 / report.inside as f64;
    }
    report
}

/// 升序 `onsets` 里离 `t` 最近的一个。
fn nearest(onsets: &[f64], t: f64) -> Option<f64> {
    let i = onsets.partition_point(|onset| *onset < t);
    let before = i.checked_sub(1).map(|k| onsets[k]);
    let after = onsets.get(i).copied();
    match (before, after) {
        (Some(a), Some(b)) => Some(if t - a <= b - t { a } else { b }),
        (a, b) => a.or(b),
    }
}

/// 全部起音 `±w` 窗口（夹到 `[0, duration]`）的并集长度 ÷ `duration`。
pub fn chance(onsets: &[f64], duration: f64, w: f64) -> f64 {
    if duration <= 0.0 {
        return 0.0;
    }
    let mut covered = 0.0;
    let mut reach = f64::NEG_INFINITY;
    for &onset in onsets {
        let start = (onset - w).max(0.0).max(reach);
        let end = (onset + w).min(duration);
        if end > start {
            covered += end - start;
        }
        reach = reach.max(end);
    }
    (covered / duration).clamp(0.0, 1.0)
}

/// 重音的门限：起音比它前面的底子至少高这么多 dB。
pub const ACCENT_MIN_DB: f64 = 6.0;
/// 而且在全部起音里按突出程度排在前这么多。
pub const ACCENT_TOP_SHARE: f64 = 0.2;
/// 起音本身：起点之后这么长的均方根。
const HIT_SECONDS: f64 = 0.03;
/// 底子：起点前 `BED_GAP` 到 `BED_SECONDS` 之间的均方根（离起点留一点，不吃进起音的前沿）。
const BED_SECONDS: f64 = 0.4;
const BED_GAP: f64 = 0.02;
/// 底子是静音时的下限（−80 dBFS），免得除以零。
const BED_FLOOR: f64 = 1e-4;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Accent {
    pub t: f64,
    /// 起音比它前面的底子高多少 dB。
    pub prominence_db: f64,
}

/// 每个起音比前面底子高多少 dB（与 `onsets` 一一对应）。
pub fn prominence(pcm: &[f32], sample_rate: u32, onsets: &[f64]) -> Vec<f64> {
    let rate = f64::from(sample_rate);
    let at = |seconds: f64| ((seconds * rate).round().max(0.0) as usize).min(pcm.len());
    onsets
        .iter()
        .map(|&t| {
            let hit = rms(&pcm[at(t)..at(t + HIT_SECONDS)]);
            let bed = rms(&pcm[at(t - BED_SECONDS)..at(t - BED_GAP)]).max(BED_FLOOR);
            20.0 * (hit.max(BED_FLOOR) / bed).log10()
        })
        .collect()
}

/// 重音：比前面的底子高至少 [`ACCENT_MIN_DB`]，并且突出程度在全部起音的前 [`ACCENT_TOP_SHARE`]
/// （至少一个）。按时间排序。
pub fn accents(pcm: &[f32], sample_rate: u32, onsets: &[f64]) -> Vec<Accent> {
    let scores = prominence(pcm, sample_rate, onsets);
    let mut ranked: Vec<f64> = scores.clone();
    ranked.sort_by(|a, b| b.total_cmp(a));
    let keep = ((ranked.len() as f64 * ACCENT_TOP_SHARE).ceil() as usize).max(1);
    let Some(&cut) = ranked.get(keep - 1) else {
        return Vec::new();
    };
    onsets
        .iter()
        .zip(&scores)
        .filter(|(_, score)| **score >= ACCENT_MIN_DB && **score >= cut)
        .map(|(t, score)| Accent {
            t: *t,
            prominence_db: *score,
        })
        .collect()
}

fn rms(x: &[f32]) -> f64 {
    if x.is_empty() {
        return 0.0;
    }
    (x.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cues_get_ok_near_none_and_outside() {
        let onsets = [1.0, 2.0, 3.0];
        let report = sync(&[1.02, 2.1, 2.5, 4.5, -0.1], &onsets, 4.0, 0.05, 0.15);
        let statuses: Vec<_> = report.cues.iter().map(|c| c.status).collect();
        assert_eq!(
            statuses,
            [
                CueStatus::Ok,
                CueStatus::Near,
                CueStatus::None,
                CueStatus::Outside,
                CueStatus::Outside
            ]
        );
        assert!(
            (report.cues[0].delta.unwrap() + 0.02).abs() < 1e-9,
            "sound is 20 ms early"
        );
        assert!((report.cues[1].delta.unwrap() + 0.1).abs() < 1e-9);
        assert_eq!(report.cues[3].delta, None);
        assert_eq!(
            (
                report.inside,
                report.ok,
                report.near,
                report.none,
                report.outside
            ),
            (3, 1, 1, 1, 2)
        );
        assert!((report.hit_rate - 1.0 / 3.0).abs() < 1e-9);
        assert_eq!(
            sync(&[1.0], &[], 4.0, 0.05, 0.15).cues[0].status,
            CueStatus::None
        );
    }

    #[test]
    fn chance_counts_overlapping_windows_once() {
        // 两个起音相隔 60 ms、窗口 ±50 ms：并集 160 ms，不是 200 ms。
        assert!((chance(&[1.0, 1.06], 10.0, 0.05) - 0.016).abs() < 1e-9);
        // 开头的窗口夹到 0。
        assert!((chance(&[0.0], 1.0, 0.05) - 0.05).abs() < 1e-9);
        assert!((chance(&[0.1, 0.2, 0.3], 0.4, 0.1) - 1.0).abs() < 1e-9);
        assert_eq!(chance(&[], 1.0, 0.05), 0.0);
    }

    #[test]
    fn a_hit_over_a_quiet_bed_is_an_accent_and_a_flat_bed_has_none() {
        let rate = 8000;
        let tone = |i: usize, amp: f32| amp * (i as f32 * 0.7).sin();
        // 0.1 振幅的底子，1.0 秒处一下 1.0 振幅、0.5 秒与 1.5 秒各一下 0.15 振幅。
        let mut pcm: Vec<f32> = (0..rate * 2).map(|i| tone(i, 0.1)).collect();
        for (at, amp) in [(0.5, 0.15), (1.0, 1.0), (1.5, 0.15)] {
            let start = (at * rate as f64) as usize;
            for (k, sample) in pcm[start..start + 400].iter_mut().enumerate() {
                *sample = tone(start + k, amp);
            }
        }
        let onsets = [0.5, 1.0, 1.5];
        let found = accents(&pcm, rate as u32, &onsets);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].t, 1.0);
        assert!(
            (found[0].prominence_db - 20.0).abs() < 0.5,
            "{}",
            found[0].prominence_db
        );
        let flat: Vec<f32> = (0..rate * 2).map(|i| tone(i, 0.1)).collect();
        assert!(accents(&flat, rate as u32, &onsets).is_empty());
        assert!(accents(&flat, rate as u32, &[]).is_empty());
    }
}
