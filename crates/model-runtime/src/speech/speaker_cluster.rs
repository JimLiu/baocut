//! 跨 chunk 说话人合并的纯逻辑聚类。
//!
//! 长音频按 chunk 分段转写后，每个 chunk 内部只知道自己的局部说话人编号。
//! 本模块把各 chunk 的局部聚类当作「单元」，用带约束的凝聚聚类（centroid
//! linkage）在全局把同一个人的单元并起来：
//!
//! - 同一个 chunk 内的两个单元来自同一次局部聚类，已经被判定为不同的人，
//!   因此永远不允许合并；这个约束在合并后按 chunk 集合的并集继续传递。
//! - 没有嵌入的单元（音频太短提不出向量）不参与距离计算，各自独占一个 id。
//! - 全流程无 I/O、无浮点排序容器，同一输入必然得到同一输出。
//!
//! 从 v2 的同名模块原样移植，行为与阈值不变。

use std::collections::BTreeSet;

/// 参与跨 chunk 合并的最小单元：某个 chunk 内的一个局部聚类。
#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerUnit {
    /// 来源 chunk 序号；同 chunk 的单元互斥，永不合并。
    pub chunk: usize,
    /// chunk 内局部聚类 id（已做全局平移），本模块仅透传不参与判定。
    pub local_cluster: usize,
    /// 说话人嵌入；`None` 表示音频不足未提取，永不参与合并。
    pub embedding: Option<Vec<f32>>,
    /// 该单元最早发声时间，用于最终标签排序。
    pub first_start: f64,
}

/// 默认合并阈值，单位是余弦距离（0..=2）；严格小于该值才合并。
pub const DEFAULT_MERGE_THRESHOLD: f32 = 0.715;

/// 判定「孤儿簇」的累计时长门槛，单位秒；见
/// [`merge_speaker_units_with_durations`]。
///
/// 2 秒是按 Pyannote 的取样口径定的：10 秒窗口 / 5 秒步长意味着每一秒真实语音
/// 会被相邻两个窗口各取一次，所以簇的累计时长约等于真实时长的两倍——低于 2 秒
/// 的簇实际独占语音不足 1 秒，落在「短 turn 误判」的高发区间。
pub const DEFAULT_MIN_CLUSTER_SECONDS: f64 = 2.0;

/// 余弦距离，取值落在闭区间 0..=2。
///
/// 空向量、维度不一致或分母 ≤ 1e-10（任一侧近似零向量）都返回 2.0，
/// 即「最远」，在任何正常阈值下都不会被合并。
pub fn cosine_distance(first: &[f32], second: &[f32]) -> f32 {
    if first.is_empty() || first.len() != second.len() {
        return 2.0;
    }
    let mut dot = 0.0f32;
    let mut first_norm = 0.0f32;
    let mut second_norm = 0.0f32;
    for (left, right) in first.iter().zip(second.iter()) {
        dot += left * right;
        first_norm += left * left;
        second_norm += right * right;
    }
    let denominator = first_norm.sqrt() * second_norm.sqrt();
    // 用正向比较写法，NaN 会让 usable 为 false，同样落到 2.0。
    let usable = denominator > 1e-10;
    if !usable {
        return 2.0;
    }
    1.0 - dot / denominator
}

/// 把跨 chunk 的说话人单元合并为全局聚类，返回每个单元的最终聚类 id。
///
/// id 被压缩为连续的 `0..K`，并按「聚类内最早 `first_start`」升序分配，
/// 因此 id 0（展示为 S01）一定是最先发声的说话人。
pub fn merge_speaker_units(units: &[SpeakerUnit], threshold: f32) -> Vec<usize> {
    cluster_speaker_units(units, threshold, None, None).assignment
}

/// 与 [`merge_speaker_units`] 相同，但额外把最终簇数压到 `max_clusters` 以内。
///
/// 阈值循环结束后若簇数仍超上限，继续合并「当前最近且 chunk 不冲突」的一对，
/// 直到满足上限或再无可合并对为止（同 chunk 约束永远优先于上限）。
///
/// 注意：无嵌入的单元各自独占一个 id，同样计入上限，但它们永远无法被合并，
/// 因此调用方若需要硬上限，应只传入带嵌入的单元。
pub fn merge_speaker_units_capped(units: &[SpeakerUnit], threshold: f32, max_clusters: Option<usize>) -> Vec<usize> {
    cluster_speaker_units(units, threshold, max_clusters, None).assignment
}

/// 与 [`merge_speaker_units_capped`] 相同，外加「孤儿簇重指派」。
///
/// `unit_seconds[i]` 是 `units[i]` 的语音时长（秒）。阈值循环结束后，累计时长
/// 低于 `min_cluster_seconds` 的簇被判为孤儿：它的每个单元按声纹距离并入最近的
/// 「大簇」，chunk 冲突时跳过该候选；一个目标都找不到就原样保留。
///
/// 为什么需要这一步：同 chunk 互斥是**整簇**约束——两个簇只要各有一个单元落在
/// 同一个 chunk 就永远合不掉，哪怕其余单元声纹完全一致。真实说话人被这条约束
/// 挡在门外时会碎成若干个只有一两秒的簇，把说话人数顶到真实值的两倍。这里把
/// 约束放宽到**单元级**（只要目标簇里没有该单元自己那个 chunk 就可以并入），
/// 既解开了整簇死锁，又保住了「同一窗口的两个 local speaker 不是同一个人」这条
/// 模型给出的硬事实。
///
/// 确定性：所有距离都对**重指派开始前冻结的**质心计算，处理顺序固定为孤儿簇
/// id 升序、簇内单元下标升序，因此同一输入必然得到同一输出。
///
/// `unit_seconds` 长度与 `units` 不一致，或 `min_cluster_seconds <= 0` 时，
/// 本函数等价于 [`merge_speaker_units_capped`]。
pub fn merge_speaker_units_with_durations(
    units: &[SpeakerUnit],
    threshold: f32,
    max_clusters: Option<usize>,
    unit_seconds: &[f64],
    min_cluster_seconds: f64,
) -> Vec<usize> {
    let orphan = (unit_seconds.len() == units.len() && min_cluster_seconds > 0.0).then_some(OrphanRule {
        unit_seconds,
        min_cluster_seconds,
        // 孤儿只能并进「本来就够近、只是被同 chunk 互斥挡住」的簇。没有这条
        // 上限，每个小簇都会被吸进最近的大簇——不管有多远——于是灵敏度旋钮
        // 失效（aggressive 与 balanced 输出逐字节相同）。
        max_distance: threshold,
    });
    cluster_speaker_units(units, threshold, max_clusters, orphan).assignment
}

/// 孤儿簇重指派规则；见 [`merge_speaker_units_with_durations`]。
#[derive(Debug, Clone, Copy)]
struct OrphanRule<'a> {
    unit_seconds: &'a [f64],
    min_cluster_seconds: f64,
    /// 孤儿单元并入大簇所允许的最大余弦距离；超过它就保留原簇。
    max_distance: f32,
}

/// 聚类结果；`centroids[id]` 与最终 id 对齐，无嵌入的单元为 `None`。
#[derive(Debug, Clone, PartialEq)]
struct ClusterOutcome {
    assignment: Vec<usize>,
    centroids: Vec<Option<Vec<f32>>>,
}

/// 内部实现，额外暴露合并后的质心供测试断言加权平均语义。
fn cluster_speaker_units(
    units: &[SpeakerUnit],
    threshold: f32,
    max_clusters: Option<usize>,
    orphan: Option<OrphanRule<'_>>,
) -> ClusterOutcome {
    if units.is_empty() {
        return ClusterOutcome {
            assignment: Vec::new(),
            centroids: Vec::new(),
        };
    }

    // 以第一个非空嵌入的维度为准；维度不符或为空的单元退化成「无嵌入」，
    // 既不参与距离矩阵，也保证质心加权平均永远在等长向量上进行。
    let dimension = units
        .iter()
        .filter_map(|unit| unit.embedding.as_deref())
        .map(<[f32]>::len)
        .find(|&len| len > 0);
    let mut clusterable = vec![false; units.len()];
    let mut seeds: Vec<usize> = Vec::new();
    if let Some(dimension) = dimension {
        for (index, unit) in units.iter().enumerate() {
            if unit.embedding.as_deref().is_some_and(|embedding| embedding.len() == dimension) {
                clusterable[index] = true;
                seeds.push(index);
            }
        }
    }

    let count = seeds.len();
    let mut centroids: Vec<Vec<f32>> = seeds
        .iter()
        .map(|&index| units[index].embedding.clone().unwrap_or_default())
        .collect();
    let mut members: Vec<Vec<usize>> = seeds.iter().map(|&index| vec![index]).collect();
    let mut chunks: Vec<BTreeSet<usize>> = seeds.iter().map(|&index| BTreeSet::from([units[index].chunk])).collect();
    let mut active = vec![true; count];
    let mut active_count = count;
    // 无嵌入的单元永远自成一簇，计入最终簇数，因此也计入上限。
    let solo_count = units.len() - count;

    // 簇对距离只在其中一侧发生合并时改变，缓存对称矩阵，每轮只刷新幸存行。
    let mut distances = vec![f32::INFINITY; count * count];
    for first in 0..count {
        for second in (first + 1)..count {
            if units[seeds[first]].chunk == units[seeds[second]].chunk {
                continue;
            }
            let distance = cosine_distance(&centroids[first], &centroids[second]);
            distances[first * count + second] = distance;
            distances[second * count + first] = distance;
        }
    }

    while active_count > 1 {
        // 按索引顺序线性扫描并用严格小于比较，天然让先出现的组合赢得平票。
        let mut best_distance = f32::MAX;
        let mut best_first = usize::MAX;
        let mut best_second = usize::MAX;
        for first in 0..count {
            if !active[first] {
                continue;
            }
            for second in (first + 1)..count {
                if !active[second] {
                    continue;
                }
                let distance = distances[first * count + second];
                if distance < best_distance {
                    best_distance = distance;
                    best_first = first;
                    best_second = second;
                }
            }
        }
        // 严格小于才合并；阈值或距离为 NaN 时 mergeable 为 false。
        // 超出簇数上限时放宽阈值，继续合并最近的一对（无穷远＝同 chunk 冲突，
        // 属于硬约束，任何情况下都不放行）。
        let over_cap = max_clusters.is_some_and(|cap| active_count + solo_count > cap);
        let mergeable = best_distance < threshold || (over_cap && best_distance.is_finite());
        if best_first == usize::MAX || !mergeable {
            break;
        }

        let first_size = members[best_first].len() as f32;
        let second_size = members[best_second].len() as f32;
        let combined_size = first_size + second_size;
        let merged: Vec<f32> = centroids[best_first]
            .iter()
            .zip(centroids[best_second].iter())
            .map(|(left, right)| (left * first_size + right * second_size) / combined_size)
            .collect();
        centroids[best_first] = merged;

        let absorbed = std::mem::take(&mut members[best_second]);
        members[best_first].extend(absorbed);
        let absorbed_chunks = std::mem::take(&mut chunks[best_second]);
        chunks[best_first].extend(absorbed_chunks);
        active[best_second] = false;
        active_count -= 1;

        for other in 0..count {
            if !active[other] || other == best_first {
                continue;
            }
            let distance = if chunks[best_first].is_disjoint(&chunks[other]) {
                cosine_distance(&centroids[best_first], &centroids[other])
            } else {
                f32::INFINITY
            };
            distances[best_first * count + other] = distance;
            distances[other * count + best_first] = distance;
        }
    }

    if let Some(rule) = orphan {
        reassign_orphan_clusters(units, rule, &active, &mut members, &mut chunks, &mut centroids);
        // 单元被搬空的簇不再是一个说话人。
        for cluster in 0..count {
            if members[cluster].is_empty() {
                active[cluster] = false;
            }
        }
    }

    // 存活簇与无嵌入单元一起按「组内最早 first_start」升序压缩成连续 id。
    struct Group {
        first_start: f64,
        anchor: usize,
        members: Vec<usize>,
        centroid: Option<Vec<f32>>,
    }
    let mut groups: Vec<Group> = Vec::new();
    for cluster in 0..count {
        if !active[cluster] {
            continue;
        }
        let mut cluster_members = std::mem::take(&mut members[cluster]);
        cluster_members.sort_unstable();
        let first_start = cluster_members
            .iter()
            .map(|&index| units[index].first_start)
            .min_by(f64::total_cmp)
            .unwrap_or(f64::INFINITY);
        groups.push(Group {
            first_start,
            anchor: cluster_members[0],
            members: cluster_members,
            centroid: Some(centroids[cluster].clone()),
        });
    }
    for (index, unit) in units.iter().enumerate() {
        if clusterable[index] {
            continue;
        }
        groups.push(Group {
            first_start: unit.first_start,
            anchor: index,
            members: vec![index],
            centroid: None,
        });
    }
    // first_start 相同时用最小单元下标兜底，保证顺序完全确定。
    groups.sort_by(|left, right| left.first_start.total_cmp(&right.first_start).then(left.anchor.cmp(&right.anchor)));

    let mut assignment = vec![0usize; units.len()];
    let mut out_centroids = Vec::with_capacity(groups.len());
    for (id, group) in groups.iter().enumerate() {
        for &member in &group.members {
            assignment[member] = id;
        }
        out_centroids.push(group.centroid.clone());
    }
    ClusterOutcome {
        assignment,
        centroids: out_centroids,
    }
}

/// 把累计时长不足的孤儿簇拆开，按声纹距离并入最近的大簇。
///
/// 距离一律对 `centroids` 的**冻结快照**计算，因此处理顺序只影响 chunk 冲突的
/// 判定，不影响距离本身；顺序固定为孤儿簇 id 升序、簇内单元下标升序。
fn reassign_orphan_clusters(
    units: &[SpeakerUnit],
    rule: OrphanRule<'_>,
    active: &[bool],
    members: &mut [Vec<usize>],
    chunks: &mut [BTreeSet<usize>],
    centroids: &mut [Vec<f32>],
) {
    let count = members.len();
    let frozen: Vec<Vec<f32>> = centroids.to_vec();
    let totals: Vec<f64> = (0..count)
        .map(|cluster| members[cluster].iter().map(|&index| rule.unit_seconds[index]).sum())
        .collect();
    let targets: Vec<usize> = (0..count)
        .filter(|&cluster| active[cluster] && !members[cluster].is_empty() && totals[cluster] >= rule.min_cluster_seconds)
        .collect();
    if targets.is_empty() {
        return;
    }

    for orphan in 0..count {
        if !active[orphan] || members[orphan].is_empty() || totals[orphan] >= rule.min_cluster_seconds {
            continue;
        }
        let mut kept: Vec<usize> = Vec::new();
        let mut moving = std::mem::take(&mut members[orphan]);
        moving.sort_unstable();
        for index in moving {
            let Some(embedding) = units[index].embedding.as_deref() else {
                kept.push(index);
                continue;
            };
            let mut best: Option<(f32, usize)> = None;
            for &target in &targets {
                // 同一窗口的两个 local speaker 已被模型判为不同人：这条硬事实
                // 在单元级仍然生效，只是不再要求整簇 chunk 集合互斥。
                if chunks[target].contains(&units[index].chunk) {
                    continue;
                }
                let distance = cosine_distance(embedding, &frozen[target]);
                if !distance.is_finite() || distance >= rule.max_distance {
                    continue;
                }
                // 严格小于让扫描顺序（簇 id 升序）赢得平票。
                if best.is_none_or(|(current, _)| distance < current) {
                    best = Some((distance, target));
                }
            }
            let Some((_, target)) = best else {
                kept.push(index);
                continue;
            };
            let size = members[target].len() as f32;
            if centroids[target].len() == embedding.len() {
                for (slot, value) in centroids[target].iter_mut().zip(embedding) {
                    *slot = (*slot * size + value) / (size + 1.0);
                }
            }
            members[target].push(index);
            chunks[target].insert(units[index].chunk);
        }
        members[orphan] = kept;
    }

    for cluster_members in members.iter_mut().take(count) {
        cluster_members.sort_unstable();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(chunk: usize, embedding: &[f32], first_start: f64) -> SpeakerUnit {
        SpeakerUnit {
            chunk,
            local_cluster: chunk * 10,
            embedding: Some(embedding.to_vec()),
            first_start,
        }
    }

    fn silent_unit(chunk: usize, first_start: f64) -> SpeakerUnit {
        SpeakerUnit {
            chunk,
            local_cluster: chunk * 10,
            embedding: None,
            first_start,
        }
    }

    fn assert_vec_close(actual: &[f32], expected: &[f32]) {
        assert_eq!(actual.len(), expected.len(), "{actual:?} != {expected:?}");
        for (left, right) in actual.iter().zip(expected) {
            assert!((left - right).abs() <= 1e-6, "{actual:?} != {expected:?} ± 1e-6");
        }
    }

    #[test]
    fn three_speakers_merge_across_chunks_and_sort_by_first_speech() {
        // 三个近似正交的说话人，同人跨 chunk 距离 ≈0.02，异人距离 ≈0.8~1.0。
        let units = vec![
            unit(0, &[1.0, 0.0, 0.0], 10.0),  // A@chunk0
            unit(0, &[0.0, 1.0, 0.0], 5.0),   // B@chunk0
            unit(0, &[0.0, 0.0, 1.0], 1.0),   // C@chunk0
            unit(1, &[0.98, 0.2, 0.0], 30.0), // A@chunk1
            unit(1, &[0.2, 0.98, 0.0], 25.0), // B@chunk1
            unit(1, &[0.0, 0.2, 0.98], 21.0), // C@chunk1
        ];
        assert!(cosine_distance(&[1.0, 0.0, 0.0], &[0.98, 0.2, 0.0]) < DEFAULT_MERGE_THRESHOLD);
        assert!(cosine_distance(&[1.0, 0.0, 0.0], &[0.2, 0.98, 0.0]) > DEFAULT_MERGE_THRESHOLD);

        // C 最先发声 → 0，其次 B → 1，最后 A → 2。
        assert_eq!(merge_speaker_units(&units, DEFAULT_MERGE_THRESHOLD), vec![2, 1, 0, 2, 1, 0]);
    }

    #[test]
    fn identical_embeddings_in_same_chunk_never_merge() {
        let units = vec![unit(0, &[1.0, 0.0], 4.0), unit(0, &[1.0, 0.0], 2.0), unit(0, &[1.0, 0.0], 9.0)];
        assert_eq!(merge_speaker_units(&units, DEFAULT_MERGE_THRESHOLD), vec![1, 0, 2]);
    }

    #[test]
    fn merged_chunk_sets_keep_blocking_further_merges() {
        // A(chunk0) 与 B(chunk1) 合并后 chunk 集合是 {0,1}，
        // 因此即使 C(chunk1) 距离为 0 也不得再并进来。
        let units = vec![unit(0, &[1.0, 0.0], 0.0), unit(1, &[1.0, 0.0], 1.0), unit(1, &[1.0, 0.0], 2.0)];
        assert_eq!(merge_speaker_units(&units, DEFAULT_MERGE_THRESHOLD), vec![0, 0, 1]);
    }

    #[test]
    fn units_without_embedding_stay_alone_but_join_ordering() {
        let units = vec![
            silent_unit(0, 5.0),
            unit(0, &[1.0, 0.0], 10.0),
            unit(1, &[1.0, 0.0], 1.0),
            silent_unit(1, 0.5),
        ];
        // 合并簇最早 1.0，静默单元分别是 0.5 与 5.0。
        assert_eq!(merge_speaker_units(&units, DEFAULT_MERGE_THRESHOLD), vec![2, 1, 1, 0]);
    }

    #[test]
    fn distance_exactly_at_threshold_does_not_merge() {
        let units = vec![unit(0, &[1.0, 0.0], 0.0), unit(1, &[0.0, 1.0], 1.0)];
        assert_eq!(cosine_distance(&[1.0, 0.0], &[0.0, 1.0]), 1.0);
        // 严格小于才合并。
        assert_eq!(merge_speaker_units(&units, 1.0), vec![0, 1]);
        assert_eq!(merge_speaker_units(&units, 1.000_001), vec![0, 0]);
    }

    #[test]
    fn centroid_uses_size_weighted_average_without_renormalizing() {
        let units = vec![unit(0, &[2.0, 0.0], 0.0), unit(1, &[2.0, 2.0], 1.0), unit(2, &[0.0, 2.0], 2.0)];
        // 第一轮：d(0,1)=d(1,2)≈0.29289，扫描顺序让 (0,1) 先赢 → 质心 [2,1]。
        // 第二轮：[2,1](size2) 与 [0,2](size1) 距离≈0.55279 < 0.6 → 合并，
        //         质心 = ([2,1]*2 + [0,2]*1)/3 = [4/3, 4/3]。
        // 若错误地重新 L2 归一化会得到 [0.7071, 0.7071]，
        // 若错误地用等权平均会得到 [1.0, 1.5]，两者都会被下面的断言拒绝。
        let outcome = cluster_speaker_units(&units, 0.6, None, None);
        assert_eq!(outcome.assignment, vec![0, 0, 0]);
        assert_eq!(outcome.centroids.len(), 1);
        assert_vec_close(outcome.centroids[0].as_deref().expect("centroid"), &[4.0 / 3.0, 4.0 / 3.0]);
    }

    #[test]
    fn zero_and_mismatched_embeddings_never_merge() {
        assert_eq!(cosine_distance(&[0.0, 0.0], &[1.0, 0.0]), 2.0);
        assert_eq!(cosine_distance(&[1.0, 0.0], &[1.0, 0.0, 0.0]), 2.0);
        assert_eq!(cosine_distance(&[], &[]), 2.0);

        let units = vec![
            unit(0, &[1.0, 0.0], 0.0),
            unit(1, &[1.0, 0.0, 0.0], 1.0), // 维度不符 → 退化为无嵌入
            unit(2, &[0.0, 0.0], 2.0),      // 零向量 → 距离恒为 2.0
        ];
        assert_eq!(merge_speaker_units(&units, DEFAULT_MERGE_THRESHOLD), vec![0, 1, 2]);
    }

    #[test]
    fn degenerate_inputs_are_handled() {
        assert!(merge_speaker_units(&[], DEFAULT_MERGE_THRESHOLD).is_empty());
        assert_eq!(merge_speaker_units(&[unit(0, &[1.0, 0.0], 3.0)], DEFAULT_MERGE_THRESHOLD), vec![0]);
        assert_eq!(merge_speaker_units(&[silent_unit(0, 3.0)], DEFAULT_MERGE_THRESHOLD), vec![0]);
        assert_eq!(
            merge_speaker_units(
                &[silent_unit(0, 8.0), silent_unit(1, 2.0), silent_unit(2, 5.0)],
                DEFAULT_MERGE_THRESHOLD
            ),
            vec![2, 0, 1]
        );
    }

    #[test]
    fn cap_keeps_merging_nearest_clusters_beyond_threshold() {
        // 三个互相远离的说话人（两两距离 1.0 > 阈值），不设上限时得到 3 个簇。
        let units = vec![
            unit(0, &[1.0, 0.0, 0.0], 0.0),
            unit(1, &[0.0, 1.0, 0.0], 1.0),
            unit(2, &[0.0, 0.0, 1.0], 2.0),
        ];
        assert_eq!(merge_speaker_units_capped(&units, DEFAULT_MERGE_THRESHOLD, None), vec![0, 1, 2]);
        // 上限 2 时继续合并最近的一对：距离全等，扫描顺序让 (0,1) 先赢。
        assert_eq!(merge_speaker_units_capped(&units, DEFAULT_MERGE_THRESHOLD, Some(2)), vec![0, 0, 1]);
        assert_eq!(merge_speaker_units_capped(&units, DEFAULT_MERGE_THRESHOLD, Some(1)), vec![0, 0, 0]);
        // 上限宽于实际簇数时不产生任何额外合并。
        assert_eq!(merge_speaker_units_capped(&units, DEFAULT_MERGE_THRESHOLD, Some(9)), vec![0, 1, 2]);
    }

    #[test]
    fn cap_never_overrides_same_chunk_constraint() {
        // 三个单元全在 chunk 0，互斥约束是硬的：即便上限为 1 也不能合并。
        let units = vec![unit(0, &[1.0, 0.0], 0.0), unit(0, &[1.0, 0.0], 1.0), unit(0, &[1.0, 0.0], 2.0)];
        assert_eq!(merge_speaker_units_capped(&units, DEFAULT_MERGE_THRESHOLD, Some(1)), vec![0, 1, 2]);
    }

    #[test]
    fn symmetric_input_has_fixed_tie_break_and_is_deterministic() {
        // 四个完全相同的嵌入分布在两个 chunk 上：距离全为 0，靠扫描顺序定胜负。
        // (0,1) 先合并后 chunk 集合变成 {0,1}，剩下 (2,3) 只能自成一簇。
        let units = vec![
            unit(0, &[1.0, 0.0], 3.0),
            unit(1, &[1.0, 0.0], 4.0),
            unit(0, &[1.0, 0.0], 1.0),
            unit(1, &[1.0, 0.0], 2.0),
        ];
        let first = merge_speaker_units(&units, DEFAULT_MERGE_THRESHOLD);
        let second = merge_speaker_units(&units, DEFAULT_MERGE_THRESHOLD);
        assert_eq!(first, second);
        assert_eq!(first, vec![1, 1, 0, 0]);
    }

    /// 两个说话人各占两个 chunk，外加一个只有 0.5 秒、声纹被噪声推到阈值之外的
    /// 碎片。阈值聚类必然给它一个独立 id；孤儿重指派要把它并回最近的大簇。
    #[test]
    fn orphan_cluster_joins_nearest_large_cluster() {
        // A = {u0, u1}；O = {u2, u3}。O 与 A 的质心距离本来够近，但 O 里的 u2 与
        // A 里的 u0 同属 chunk 0，整簇互斥挡住了合并。重指派在单元级放开这条：
        // u3（chunk 2，A 没有）可以并入 A，u2 仍然留在原簇。
        let units = vec![
            unit(0, &[1.0, 0.0, 0.0], 0.0),
            unit(1, &[1.0, 0.0, 0.0], 10.0),
            unit(0, &[1.0, 0.9, 0.0], 1.0),
            unit(2, &[1.0, 0.6, 0.0], 20.0),
        ];
        let seconds = vec![10.0, 10.0, 0.25, 0.25];
        let to_a = cosine_distance(&[1.0, 0.6, 0.0], &[1.0, 0.0, 0.0]);
        assert!(to_a < DEFAULT_MERGE_THRESHOLD);

        assert_eq!(merge_speaker_units_capped(&units, DEFAULT_MERGE_THRESHOLD, None), vec![0, 0, 1, 1]);
        assert_eq!(
            merge_speaker_units_with_durations(&units, DEFAULT_MERGE_THRESHOLD, None, &seconds, DEFAULT_MIN_CLUSTER_SECONDS),
            vec![0, 0, 1, 0]
        );
        // 门槛降到碎片时长以下时不再触发重指派。
        assert_eq!(
            merge_speaker_units_with_durations(&units, DEFAULT_MERGE_THRESHOLD, None, &seconds, 0.1),
            vec![0, 0, 1, 1]
        );
    }

    /// 距离上限：孤儿离最近的大簇比合并阈值还远时保留自己的身份，不被吞掉。
    /// 没有这条，任何小簇都会被最近的大簇吸收，灵敏度旋钮随之失效。
    #[test]
    fn orphan_cluster_beyond_threshold_keeps_its_identity() {
        let units = vec![
            unit(0, &[1.0, 0.0, 0.0], 0.0),
            unit(1, &[1.0, 0.0, 0.0], 10.0),
            unit(2, &[0.0, 1.0, 0.0], 20.0),
            unit(3, &[0.0, 1.0, 0.0], 30.0),
            unit(4, &[0.3, 0.2, 1.0], 40.0),
        ];
        let seconds = vec![10.0, 10.0, 10.0, 10.0, 0.5];
        // 碎片到两个大簇的距离都越过了合并阈值。
        let to_a = cosine_distance(&[0.3, 0.2, 1.0], &[1.0, 0.0, 0.0]);
        let to_b = cosine_distance(&[0.3, 0.2, 1.0], &[0.0, 1.0, 0.0]);
        assert!(to_a > DEFAULT_MERGE_THRESHOLD && to_b > DEFAULT_MERGE_THRESHOLD);

        assert_eq!(
            merge_speaker_units_capped(&units, DEFAULT_MERGE_THRESHOLD, None),
            vec![0, 0, 1, 1, 2]
        );
        assert_eq!(
            merge_speaker_units_with_durations(&units, DEFAULT_MERGE_THRESHOLD, None, &seconds, DEFAULT_MIN_CLUSTER_SECONDS),
            vec![0, 0, 1, 1, 2]
        );
    }

    /// 距离完全相同时按簇的内部扫描顺序取胜，重复调用结果必须一致。
    #[test]
    fn orphan_reassignment_tie_break_is_deterministic() {
        // A = {u0, u1}，B = {u2, u3}，孤儿簇 O = {u4, u5, u6}。O 与 A、B 的距离
        // 相等且都在阈值内，只是 u5/u6 分别与 A、B 撞了 chunk，整簇合并被互斥挡住。
        // 单元级重指派按下标升序处理：u4（chunk 4，两边都没有）平票归 id 更小的 A，
        // 随后 u5 只剩 B、u6 只剩 A。
        let units = vec![
            unit(0, &[1.0, 0.0, 0.0], 0.0),
            unit(1, &[1.0, 0.0, 0.0], 10.0),
            unit(2, &[0.0, 1.0, 0.0], 20.0),
            unit(3, &[0.0, 1.0, 0.0], 30.0),
            unit(4, &[1.0, 1.0, 0.0], 40.0),
            unit(0, &[1.0, 1.0, 0.0], 1.0),
            unit(2, &[1.0, 1.0, 0.0], 21.0),
        ];
        let seconds = vec![10.0, 10.0, 10.0, 10.0, 0.2, 0.2, 0.2];
        assert_eq!(
            cosine_distance(&[1.0, 1.0, 0.0], &[1.0, 0.0, 0.0]),
            cosine_distance(&[1.0, 1.0, 0.0], &[0.0, 1.0, 0.0])
        );
        assert!(cosine_distance(&[1.0, 1.0, 0.0], &[1.0, 0.0, 0.0]) < DEFAULT_MERGE_THRESHOLD);
        let first = merge_speaker_units_with_durations(&units, DEFAULT_MERGE_THRESHOLD, None, &seconds, DEFAULT_MIN_CLUSTER_SECONDS);
        let second = merge_speaker_units_with_durations(&units, DEFAULT_MERGE_THRESHOLD, None, &seconds, DEFAULT_MIN_CLUSTER_SECONDS);
        assert_eq!(first, second);
        assert_eq!(first, vec![0, 0, 1, 1, 0, 1, 0]);
    }

    /// 目标簇已经包含碎片所在的 chunk 时不得吸收：同一窗口的两个 local speaker
    /// 是模型给出的「不同人」硬事实。
    #[test]
    fn orphan_reassignment_respects_same_chunk_constraint() {
        let units = vec![
            unit(0, &[1.0, 0.0, 0.0], 0.0),
            unit(1, &[1.0, 0.0, 0.0], 10.0),
            unit(1, &[0.3, 0.2, 1.0], 12.0),
        ];
        let seconds = vec![10.0, 10.0, 0.5];
        assert_eq!(
            merge_speaker_units_with_durations(&units, DEFAULT_MERGE_THRESHOLD, None, &seconds, DEFAULT_MIN_CLUSTER_SECONDS),
            vec![0, 0, 1]
        );
    }

    /// 全部都是孤儿时没有可并入的目标，行为退化为普通聚类。
    #[test]
    fn orphan_reassignment_needs_at_least_one_large_cluster() {
        let units = vec![unit(0, &[1.0, 0.0, 0.0], 0.0), unit(1, &[0.0, 1.0, 0.0], 1.0)];
        let seconds = vec![0.4, 0.4];
        assert_eq!(
            merge_speaker_units_with_durations(&units, DEFAULT_MERGE_THRESHOLD, None, &seconds, DEFAULT_MIN_CLUSTER_SECONDS),
            vec![0, 1]
        );
    }

    /// 时长数组长度对不上或门槛非正时，静默退化为 [`merge_speaker_units_capped`]。
    #[test]
    fn orphan_reassignment_is_skipped_on_malformed_input() {
        let units = vec![
            unit(0, &[1.0, 0.0, 0.0], 0.0),
            unit(1, &[1.0, 0.0, 0.0], 10.0),
            unit(2, &[0.3, 0.2, 1.0], 40.0),
        ];
        let baseline = merge_speaker_units_capped(&units, DEFAULT_MERGE_THRESHOLD, None);
        assert_eq!(
            merge_speaker_units_with_durations(&units, DEFAULT_MERGE_THRESHOLD, None, &[10.0, 10.0], DEFAULT_MIN_CLUSTER_SECONDS),
            baseline
        );
        assert_eq!(
            merge_speaker_units_with_durations(&units, DEFAULT_MERGE_THRESHOLD, None, &[10.0, 10.0, 0.5], 0.0),
            baseline
        );
    }
}
