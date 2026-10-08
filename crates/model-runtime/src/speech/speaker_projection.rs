//! 说话人区间 → 词的投影。移植自 v2 `bcut-kernel` 的 `cmd/media/support.rs`（`project_speaker_clusters` 及其辅助函数）。
//!
//! 输入是 Pyannote 分段 + 声纹聚类得到的全局说话人区间（[`SpeakerRange`]），输出是每个词的簇号。v3 只改边界：
//! 函数挪进 `speech`，由转录作业在识别完成后调用；投影逻辑、常量与测试原样保留。

use super::SpeakerRange;

// ── 词 → 说话人投影层 ──
//
// 区间是「谁在什么时候发声」的证据，词流是「文本在什么时候出现」的事实，两者
// 由不同模型产出，边界从不严格对齐。逐词取最大重叠会把区间的每一次抖动原样搬进
// transcript：诊断显示同一个 ASR 连续发言段内出现 ≥2 个说话人标签的情况多达
// 上百处，是这一层唯一能止血的错误形态。下面的常量都是形态假设（人说话的节奏、
// 抢话至少多长），不是对某个视频调出来的数值。

/// 发言段切分阈值：相邻词的时间间隔达到这个秒数就开新段。
///
/// 取 0.8s 是保守端：常见 diarization 的换人停顿在 0.5–1.0s，中文连续朗读的
/// 词间隙通常远小于 0.5s。取小值会让「一段」更短，投票能抹平的范围更小；
/// 真正的快速换人由下面的抢话逃生口而不是段边界来保住。
const UTTERANCE_GAP_SECONDS: f64 = 0.8;

/// 最近区间兜底的距离上限。超过它不再吸附，交给发言段投票或邻段继承。
///
/// 比段切分阈值略大：段内因非语音判定被区间漏掉的词（换气、笑声、气口）仍能
/// 吸附回本段的区间；离最近区间 1.5s 以上的词已经跨过了至少一次段边界，
/// 那时的「最近」不再是证据。
const NEAREST_RANGE_MAX_GAP_SECONDS: f64 = 1.5;

/// 重叠区打分时参考的前后词数。
const CONTINUITY_WINDOW_WORDS: usize = 3;

/// 邻词一致性对重叠时长的最大加成比例。
///
/// 0.25 表示只有当两个候选簇的重叠时长相差不到 25% 时，邻词标签才可能翻盘；
/// 重叠证据显著占优时连续性一律让位，避免把真实的并发说话人抹成一个人。
const CONTINUITY_SCORE_WEIGHT: f64 = 0.25;

/// 判定一个词的归属「无歧义」（可以给邻居当参考）所需的领先倍数。
const CLEAR_DOMINANCE_RATIO: f64 = 2.0;

/// 抢话逃生口：段内连续子段要保住与段主标签不同的标签，必须同时满足
/// 词数、时长、覆盖率三条。0.6s 的中文大约是 3–4 个字，已经是一句能听清的插话；
/// 覆盖率要求该子段跨度的 60% 以上真的落在那个簇的区间里，排除只擦到边角的情况。
///
/// 词数下限是 1 而不是 2：真实插话（「对」「是啊」「哈哈」）常常只有一个词，
/// 2 会把它们整段抹成邻居的标签。实测收益随上游参数而变——`DOMINANCE_MARGIN`
/// 取 0.10 时，53 处真实插话的宽松口径保留数由 16 升到 19；取当前的 0.20 时保留数
/// 不变（仍是 16），但词层簇数由 6 恢复到 7，即至少一个纯插话簇不再被抹平。两种
/// 情形下时长与覆盖率两条都仍挡住区间抖动，碎片化和 purity 均未回退。
/// 时长/覆盖率再放宽（0.4s / 50%）只多救 2 处插话，却让碎片化从 59 涨到
/// 61 turns、purity 掉 0.06pp，不划算。
const INTERJECTION_MIN_WORDS: usize = 1;
const INTERJECTION_MIN_SECONDS: f64 = 0.6;
const INTERJECTION_MIN_COVERAGE: f64 = 0.6;

/// 零长词的探测窗：`t1 == t0` 的词与任何区间的重叠都是 0，给它一个厘秒窗口
/// 才能拿到证据。
const WORD_PROBE_MIN_SECONDS: f64 = 0.01;

/// 把说话人区间投影到词流，返回每个词的簇号（`None` = 没有任何证据可用）。
///
/// 纯函数，只吃时间：`spans` 是词的 `(t0, t1)`，`ranges` 是识别出的说话人区间。
/// 三个阶段依次是——
/// 1. 逐词重叠打分，重叠区结合邻词标签连续性（`CONTINUITY_SCORE_WEIGHT`）；
/// 2. 按词间隔切出连续发言段，段内做时长加权多数投票并统一标签；
/// 3. 段内与主标签不同、且证据够强的连续子段保留自己的标签（抢话逃生口）。
///
/// 没有任何重叠证据的段先用有上限的最近区间兜底，仍拿不到就继承最近的已定段；
/// 只有整份词流都没有证据时才整体返回 `None`。
pub fn project_speaker_clusters(spans: &[(f64, f64)], ranges: &[SpeakerRange]) -> Vec<Option<usize>> {
    if spans.is_empty() {
        return Vec::new();
    }
    if ranges.is_empty() {
        return vec![None; spans.len()];
    }
    let intervals = merged_cluster_intervals(ranges);
    let probes = spans
        .iter()
        .map(|&(start, end)| (start, end.max(start + WORD_PROBE_MIN_SECONDS)))
        .collect::<Vec<_>>();
    let overlaps = probes
        .iter()
        .map(|&(start, end)| {
            intervals
                .iter()
                .filter_map(|(&cluster, list)| {
                    let overlap = interval_overlap(list, start, end);
                    (overlap > 0.0).then_some((cluster, overlap))
                })
                .collect::<std::collections::BTreeMap<usize, f64>>()
        })
        .collect::<Vec<_>>();
    let segments = utterance_segments(&probes);

    // 第一遍只看重叠，产出「无歧义」参考标签；第二遍才让歧义词参考邻居，
    // 因此结果与遍历顺序无关。
    let plain = overlaps.iter().map(heaviest_cluster).collect::<Vec<_>>();
    let clear = overlaps.iter().map(is_clear_overlap).collect::<Vec<_>>();
    let mut labels = plain.clone();
    for segment in &segments {
        for index in segment.clone() {
            if overlaps[index].len() > 1 && !clear[index] {
                labels[index] = continuity_cluster(&overlaps[index], index, segment, &plain, &clear);
            }
        }
    }

    let mut projected = vec![None; spans.len()];
    let mut majorities = vec![None; segments.len()];
    for (slot, segment) in segments.iter().enumerate() {
        let mut weights: std::collections::BTreeMap<usize, f64> = std::collections::BTreeMap::new();
        for index in segment.clone() {
            if let Some(cluster) = labels[index] {
                *weights.entry(cluster).or_default() += word_weight(probes[index]);
            }
        }
        if weights.is_empty() {
            // 整段都没有重叠证据：这时才动用最近区间兜底，且必须在距离上限内。
            for index in segment.clone() {
                if let Some(cluster) = nearest_range_cluster(ranges, probes[index].0, probes[index].1, NEAREST_RANGE_MAX_GAP_SECONDS) {
                    *weights.entry(cluster).or_default() += word_weight(probes[index]);
                }
            }
        }
        let Some(majority) = heaviest_cluster(&weights) else {
            continue;
        };
        majorities[slot] = Some(majority);
        for index in segment.clone() {
            projected[index] = Some(majority);
        }
        for (start, end, cluster) in labeled_runs(segment.clone(), &labels) {
            if cluster == majority {
                continue;
            }
            if !interjection_survives(start, end, cluster, &probes, &intervals) {
                continue;
            }
            for index in start..=end {
                projected[index] = Some(cluster);
            }
        }
    }

    // 仍未定的段（没有重叠、最近区间也超限）继承最近的已定段：先向前找，再向后找。
    for (slot, segment) in segments.iter().enumerate() {
        if majorities[slot].is_some() {
            continue;
        }
        let inherited = majorities[..slot]
            .iter()
            .rev()
            .find_map(|majority| *majority)
            .or_else(|| majorities[slot + 1..].iter().find_map(|majority| *majority));
        let Some(cluster) = inherited else {
            continue;
        };
        for index in segment.clone() {
            projected[index] = Some(cluster);
        }
    }
    projected
}

/// 词在投票里的权重：词时长，零长词按探测窗算，保证每个词都有话语权。
fn word_weight((start, end): (f64, f64)) -> f64 {
    (end - start).max(WORD_PROBE_MIN_SECONDS)
}

/// 按簇归并区间并合并同簇内互相重叠的部分，避免重叠时长被重复计入。
fn merged_cluster_intervals(ranges: &[SpeakerRange]) -> std::collections::BTreeMap<usize, Vec<(f64, f64)>> {
    let mut by_cluster: std::collections::BTreeMap<usize, Vec<(f64, f64)>> = std::collections::BTreeMap::new();
    for range in ranges {
        if range.end > range.start {
            by_cluster.entry(range.cluster).or_default().push((range.start, range.end));
        }
    }
    for list in by_cluster.values_mut() {
        list.sort_by(|left, right| left.0.total_cmp(&right.0));
        let mut merged: Vec<(f64, f64)> = Vec::with_capacity(list.len());
        for &(start, end) in list.iter() {
            match merged.last_mut() {
                Some(last) if start <= last.1 => last.1 = last.1.max(end),
                _ => merged.push((start, end)),
            }
        }
        *list = merged;
    }
    by_cluster
}

/// 一组互不重叠区间与 `[start, end)` 的重叠总秒数。
fn interval_overlap(intervals: &[(f64, f64)], start: f64, end: f64) -> f64 {
    intervals
        .iter()
        .map(|&(range_start, range_end)| (end.min(range_end) - start.max(range_start)).max(0.0))
        .sum()
}

/// 按词间隔切出连续发言段。间隔按「此前所有词的最大结束时间」算并夹到非负，
/// 这样一个乱序或零长的 ASR 词不会凭空切开一段。
fn utterance_segments(probes: &[(f64, f64)]) -> Vec<std::ops::Range<usize>> {
    let mut segments = Vec::new();
    let mut start = 0usize;
    let mut previous_end = probes[0].1;
    for index in 1..probes.len() {
        let gap = (probes[index].0 - previous_end).max(0.0);
        if gap >= UTTERANCE_GAP_SECONDS {
            segments.push(start..index);
            start = index;
        }
        previous_end = previous_end.max(probes[index].1);
    }
    segments.push(start..probes.len());
    segments
}

/// 权重最大的簇；平票取簇号小者（BTreeMap 升序 + `>=` 保留先到者），保证确定性。
fn heaviest_cluster(weights: &std::collections::BTreeMap<usize, f64>) -> Option<usize> {
    weights
        .iter()
        .fold(None, |best: Option<(usize, f64)>, (&cluster, &weight)| match best {
            Some((_, best_weight)) if best_weight >= weight => best,
            _ => Some((cluster, weight)),
        })
        .map(|(cluster, _)| cluster)
}

/// 归属是否足够干净，可以给邻居当参考：只压到一个簇，或领先第二名一倍以上。
fn is_clear_overlap(overlaps: &std::collections::BTreeMap<usize, f64>) -> bool {
    let mut sorted = overlaps.values().copied().collect::<Vec<_>>();
    sorted.sort_by(|left, right| right.total_cmp(left));
    match sorted.as_slice() {
        [] => false,
        [_] => true,
        [top, second, ..] => *top >= *second * CLEAR_DOMINANCE_RATIO,
    }
}

/// 重叠区打分：在重叠时长上叠加同段前后邻词的标签一致性加成。
fn continuity_cluster(
    overlaps: &std::collections::BTreeMap<usize, f64>,
    index: usize,
    segment: &std::ops::Range<usize>,
    plain: &[Option<usize>],
    clear: &[bool],
) -> Option<usize> {
    let low = index.saturating_sub(CONTINUITY_WINDOW_WORDS).max(segment.start);
    let high = (index + CONTINUITY_WINDOW_WORDS + 1).min(segment.end);
    let mut counts: std::collections::BTreeMap<usize, usize> = std::collections::BTreeMap::new();
    let mut total = 0usize;
    for neighbor in low..high {
        if neighbor == index || !clear[neighbor] {
            continue;
        }
        if let Some(cluster) = plain[neighbor] {
            *counts.entry(cluster).or_default() += 1;
            total += 1;
        }
    }
    let scored = overlaps
        .iter()
        .map(|(&cluster, &overlap)| {
            let agreement = if total == 0 {
                0.0
            } else {
                counts.get(&cluster).copied().unwrap_or(0) as f64 / total as f64
            };
            (cluster, overlap * (1.0 + CONTINUITY_SCORE_WEIGHT * agreement))
        })
        .collect::<std::collections::BTreeMap<usize, f64>>();
    heaviest_cluster(&scored)
}

/// 段内按标签切出连续子段，返回 `(首词下标, 末词下标, 簇号)`。
/// 没有标签的词不打断子段——它会随所在子段的裁决一起走。
fn labeled_runs(segment: std::ops::Range<usize>, labels: &[Option<usize>]) -> Vec<(usize, usize, usize)> {
    let mut runs: Vec<(usize, usize, usize)> = Vec::new();
    for index in segment {
        let Some(cluster) = labels[index] else {
            continue;
        };
        match runs.last_mut() {
            Some(last) if last.2 == cluster => last.1 = index,
            _ => runs.push((index, index, cluster)),
        }
    }
    runs
}

/// 抢话逃生口：够长、够多词、且真的被那个簇的区间覆盖，才允许在段内换标签。
fn interjection_survives(
    start: usize,
    end: usize,
    cluster: usize,
    probes: &[(f64, f64)],
    intervals: &std::collections::BTreeMap<usize, Vec<(f64, f64)>>,
) -> bool {
    if end + 1 - start < INTERJECTION_MIN_WORDS {
        return false;
    }
    let span_start = probes[start].0;
    let span_end = probes[end].1;
    let span = span_end - span_start;
    if span < INTERJECTION_MIN_SECONDS {
        return false;
    }
    let Some(list) = intervals.get(&cluster) else {
        return false;
    };
    interval_overlap(list, span_start, span_end) >= span * INTERJECTION_MIN_COVERAGE
}

/// 词与所有说话人区间都不重叠时的兜底：取时间距离最近的区间。
///
/// 距离超过 `max_gap` 不再吸附——无上限的吸附会把远处的静音、笑声、非语音
/// 强行记到某个说话人名下（历史行为）。调用方只在整段都没有重叠证据时才用它，
/// 拿不到结果时由发言段继承邻段裁决，因此不会退化成 `Word::sp` 的默认 "s1"。
/// 平票（等距）取 cluster 序号最小者，保证确定性。
fn nearest_range_cluster(ranges: &[SpeakerRange], start: f64, end: f64, max_gap: f64) -> Option<usize> {
    let mut best: Option<(f64, usize)> = None;
    for range in ranges {
        let gap = if end < range.start {
            range.start - end
        } else if start > range.end {
            start - range.end
        } else {
            0.0
        };
        if gap > max_gap {
            continue;
        }
        let better = match best {
            None => true,
            Some((best_gap, best_cluster)) => gap < best_gap || (gap == best_gap && range.cluster < best_cluster),
        };
        if better {
            best = Some((gap, range.cluster));
        }
    }
    best.map(|(_, cluster)| cluster)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn speaker_range(start: f64, end: f64, cluster: usize) -> SpeakerRange {
        SpeakerRange {
            start,
            end,
            cluster,
            chunk: 0,
        }
    }

    /// 0.3 秒一格、首尾相接的合成词流：格点用整数除法算，边界与区间端点严格相等，
    /// 断言不受浮点误差影响。
    fn word_grid(count: usize) -> Vec<(f64, f64)> {
        (0..count)
            .map(|index| ((index * 3) as f64 / 10.0, ((index + 1) * 3) as f64 / 10.0))
            .collect()
    }

    /// P3：段内一两个词的标签抖动被时长加权多数投票抹平，不再穿透到 transcript。
    #[test]
    fn speaker_projection_smooths_short_label_flicker() {
        let spans = word_grid(10);
        // s0 占满全段，只在 1.2–1.5（第 5 个词）被切出一个 0.3s 的异标签碎片。
        let ranges = vec![speaker_range(0.0, 1.2, 0), speaker_range(1.2, 1.5, 1), speaker_range(1.5, 3.0, 0)];
        assert_eq!(project_speaker_clusters(&spans, &ranges), vec![Some(0); 10]);

        // 单个词只要够长（≥0.6s）且证据够足就保留：真实插话（「对」「是啊」）
        // 常常只有一个词，词数下限是 1。
        let long_flicker = vec![(0.0, 0.9), (0.9, 1.8), (1.8, 2.7)];
        let ranges = vec![speaker_range(0.0, 0.9, 0), speaker_range(0.9, 1.8, 1), speaker_range(1.8, 2.7, 0)];
        assert_eq!(project_speaker_clusters(&long_flicker, &ranges), vec![Some(0), Some(1), Some(0)]);

        // 同样是单个词，短于 0.6s 就仍被判成区间抖动抹平。
        let short_flicker = vec![(0.0, 0.9), (0.9, 1.4), (1.4, 2.3)];
        let ranges = vec![speaker_range(0.0, 0.9, 0), speaker_range(0.9, 1.4, 1), speaker_range(1.4, 2.3, 0)];
        assert_eq!(project_speaker_clusters(&short_flicker, &ranges), vec![Some(0); 3]);

        // 词数、时长都够，但异标签只擦到子段跨度的 1/3（三段 0.1s 的碎区间），
        // 覆盖率门槛把它判成区间抖动。
        let spans = word_grid(6);
        let ranges = vec![
            speaker_range(0.0, 0.6, 0),
            speaker_range(0.7, 0.8, 1),
            speaker_range(1.0, 1.1, 1),
            speaker_range(1.3, 1.4, 1),
            speaker_range(1.5, 1.8, 0),
        ];
        assert_eq!(project_speaker_clusters(&spans, &ranges), vec![Some(0); 6]);
    }

    /// P3 逃生口：真实的快速插话（≥2 词、≥0.6s、覆盖率 ≥60%）必须活着穿过投票。
    #[test]
    fn speaker_projection_keeps_real_interjection() {
        let spans = word_grid(10);
        // 1.2–2.1 是 3 个词、0.9s、完全被 s1 覆盖的插话，段主标签仍是 s0。
        let ranges = vec![speaker_range(0.0, 1.2, 0), speaker_range(1.2, 2.1, 1), speaker_range(2.1, 3.0, 0)];
        assert_eq!(
            project_speaker_clusters(&spans, &ranges),
            vec![
                Some(0),
                Some(0),
                Some(0),
                Some(0),
                Some(1),
                Some(1),
                Some(1),
                Some(0),
                Some(0),
                Some(0),
            ]
        );

        // 两个词、0.7s 的插话正好在门槛之上，也必须活下来。
        let spans = vec![(0.0, 1.0), (1.0, 1.35), (1.35, 1.7), (1.7, 2.7), (2.7, 3.7)];
        let ranges = vec![speaker_range(0.0, 1.0, 0), speaker_range(1.0, 1.7, 1), speaker_range(1.7, 3.7, 0)];
        assert_eq!(
            project_speaker_clusters(&spans, &ranges),
            vec![Some(0), Some(1), Some(1), Some(0), Some(0)]
        );
    }

    /// P5：并发区里重叠时长打平时，由前后邻词的标签一致性决定归属。
    #[test]
    fn speaker_projection_uses_neighbor_continuity_in_overlap() {
        let spans = word_grid(10);
        // 1.2–2.1 是两人并发区：区内每个词与两簇的重叠完全相等，
        // 纯「最大重叠」会一律判给簇号小的 s0，连续性把靠后的词交给 s1。
        let ranges = vec![speaker_range(0.0, 2.1, 0), speaker_range(1.2, 3.0, 1)];
        let projected = project_speaker_clusters(&spans, &ranges);
        assert_eq!(projected[4], Some(0), "并发区靠前的词跟随前文 {projected:?}");
        assert_eq!(projected[6], Some(1), "并发区靠后的词跟随后文 {projected:?}");
        assert_eq!(
            projected,
            vec![
                Some(0),
                Some(0),
                Some(0),
                Some(0),
                Some(0),
                Some(0),
                Some(1),
                Some(1),
                Some(1),
                Some(1),
            ]
        );
    }

    /// P4：最近区间兜底有距离上限；超限的词由发言段继承邻段，绝不静默落到 s1。
    #[test]
    fn speaker_projection_caps_nearest_range_fallback() {
        let ranges = vec![speaker_range(0.0, 1.0, 0), speaker_range(5.0, 6.0, 1)];

        // 上限内（间隔 1.0s < 1.5s）仍然吸附。
        assert_eq!(project_speaker_clusters(&[(2.0, 2.5)], &ranges), vec![Some(0)]);
        // 超过上限且整份词流没有别的证据：保持无归属，让调用方保留原值。
        assert_eq!(project_speaker_clusters(&[(20.0, 20.5)], &ranges), vec![None]);

        // 超限的段继承最近的已定段，而不是被记到 0 号说话人名下。
        let spans = vec![(0.2, 0.8), (5.2, 5.8), (20.0, 20.5), (20.6, 21.0)];
        assert_eq!(project_speaker_clusters(&spans, &ranges), vec![Some(0), Some(1), Some(1), Some(1)]);
    }

    /// 没有区间时投影是纯粹的 no-op：不能给任何词编造说话人。
    #[test]
    fn speaker_projection_without_ranges_is_a_no_op() {
        assert_eq!(project_speaker_clusters(&word_grid(3), &[]), vec![None, None, None]);
        assert!(project_speaker_clusters(&[], &[speaker_range(0.0, 1.0, 0)]).is_empty());
    }
}
