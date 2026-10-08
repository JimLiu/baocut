//! MOSS 跨块说话人合并：MOSS 按块生成，`S01` 只是「本块内的第一个人」，不同块之间同名标签毫无关系。这里用说话人
//! 嵌入（WeSpeaker）把各块的局部聚类合并成全局说话人，并把全局标签写回 `row.speaker`。从 v2 `bcut-transcribe` 的
//! `merge_moss_speakers` 一族原样移植；嵌入模型由调用方给（[`SpeakerEmbedding`]），不在这里找文件。
//!
//! 任何一步不成立都保留原始的分块标签并原样返回——合并绝不能作废一次已完成的转录。

use std::collections::{BTreeMap, HashMap, HashSet};

use super::speaker_cluster::{DEFAULT_MERGE_THRESHOLD, SpeakerUnit, merge_speaker_units_capped};
use super::{RowIn, SpeakerEmbedding, SpeakerRange};
use crate::SAMPLE_RATE;

/// 每个合并单元最多取这么多秒音频求嵌入。
pub const SPEAKER_UNIT_MAX_SECONDS: f64 = 30.0;
/// 少于这么多样本（0.5 秒）的单元不求嵌入，独占一个说话人。
pub const SPEAKER_UNIT_MIN_SAMPLES: usize = 8_000;

/// 一次合并的结果（给调用方决定要不要报警告、记 provenance）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpeakerMerge {
    /// 没有说话人区间，无事可做。
    Nothing,
    /// 带说话人的行与区间对不上：保留分块标签。
    Mismatched,
    /// 没有可用的嵌入模型：保留分块标签。
    EmbedderUnavailable,
    /// 合并完成：单元数、求出嵌入的单元数、合并后的说话人数。
    Merged { units: usize, embedded: usize, speakers: usize },
}

/// 把 `speaker_ranges` 按嵌入合并、写回 `rows[].speaker`（`S01`、`S02`……）。`embedder` 为 `None` 表示嵌入模型
/// 整体不可用（本步降级）。不传人数上限：v2 的人数只是提示，引擎不替它做硬截断。
pub fn merge_moss_speakers(
    rows: &mut [RowIn],
    speaker_ranges: &mut [SpeakerRange],
    samples: &[f32],
    embedder: Option<&mut dyn SpeakerEmbedding>,
    threshold: f32,
    max_speakers: Option<usize>,
) -> SpeakerMerge {
    if speaker_ranges.is_empty() {
        return SpeakerMerge::Nothing;
    }
    // MOSS 路径上「带说话人的行」与 speaker_ranges 是 adapt_output 同一轮循环里成对 push 的，因此同序等长；这是写回
    // 标签的唯一依据，先验证再动手。
    let Some(paired) = paired_speaker_rows(rows, speaker_ranges) else {
        return SpeakerMerge::Mismatched;
    };
    if paired.is_empty() {
        return SpeakerMerge::Nothing;
    }
    let Some(embedder) = embedder else {
        return SpeakerMerge::EmbedderUnavailable;
    };
    let (mut units, audio) = build_speaker_units(speaker_ranges, samples);
    let embeddings = embed_speaker_units(embedder, &audio);
    let embedded = embeddings.iter().filter(|slot| slot.is_some()).count();
    for (unit, embedding) in units.iter_mut().zip(embeddings) {
        unit.embedding = embedding;
    }
    let assignments = speaker_assignments(&units, threshold, max_speakers);
    let mut final_id = HashMap::new();
    for (unit, assigned) in units.iter().zip(&assignments) {
        final_id.insert(unit.local_cluster, *assigned);
    }
    let speakers = assignments.iter().copied().collect::<HashSet<_>>().len();
    for (row_index, range) in paired.iter().zip(speaker_ranges.iter_mut()) {
        let Some(assigned) = final_id.get(&range.cluster).copied() else {
            continue;
        };
        range.cluster = assigned;
        rows[*row_index].speaker = Some(format!("S{:02}", assigned + 1));
    }
    SpeakerMerge::Merged {
        units: units.len(),
        embedded,
        speakers,
    }
}

/// 校验「带说话人的行」与 `speaker_ranges` 的配对不变量，返回配对行下标。
///
/// 长度不等，或任一对的起点偏差超过 0.5 秒，都判定为不变量被破坏（返回 `None`）。
pub fn paired_speaker_rows(rows: &[RowIn], speaker_ranges: &[SpeakerRange]) -> Option<Vec<usize>> {
    let paired = rows
        .iter()
        .enumerate()
        .filter(|(_, row)| row.speaker.is_some())
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if paired.len() != speaker_ranges.len() {
        return None;
    }
    if paired
        .iter()
        .zip(speaker_ranges)
        .any(|(row_index, range)| (range.start - rows[*row_index].start).abs() > 0.5)
    {
        return None;
    }
    Some(paired)
}

/// 把 `speaker_ranges` 按局部聚类归组成合并单元，并为每个单元拼出限长音频。
pub fn build_speaker_units(speaker_ranges: &[SpeakerRange], samples: &[f32]) -> (Vec<SpeakerUnit>, Vec<Vec<f32>>) {
    let cap = (SPEAKER_UNIT_MAX_SECONDS * f64::from(SAMPLE_RATE)) as usize;
    // BTreeMap 保证单元顺序只由聚类号决定，与 HashMap 的随机遍历无关。
    let mut order = BTreeMap::new();
    let mut units: Vec<SpeakerUnit> = Vec::new();
    let mut audio: Vec<Vec<f32>> = Vec::new();
    for range in speaker_ranges {
        let slot = *order.entry(range.cluster).or_insert_with(|| {
            units.push(SpeakerUnit {
                chunk: range.chunk,
                local_cluster: range.cluster,
                embedding: None,
                first_start: range.start,
            });
            audio.push(Vec::new());
            units.len() - 1
        });
        units[slot].first_start = units[slot].first_start.min(range.start);
        if audio[slot].len() >= cap {
            continue;
        }
        let start = ((range.start.max(0.0) * f64::from(SAMPLE_RATE)) as usize).min(samples.len());
        let end = ((range.end.max(0.0) * f64::from(SAMPLE_RATE)) as usize).clamp(start, samples.len());
        let take = (cap - audio[slot].len()).min(end - start);
        audio[slot].extend_from_slice(&samples[start..start + take]);
    }
    (units, audio)
}

/// 合并阈值：`BCUT_SPEAKER_MERGE_THRESHOLD` 覆盖（诊断用），非法或越界时回落默认值。
pub fn speaker_merge_threshold() -> f32 {
    std::env::var("BCUT_SPEAKER_MERGE_THRESHOLD")
        .ok()
        .and_then(|raw| raw.trim().parse::<f32>().ok())
        .filter(|value| value.is_finite() && *value > 0.0 && *value < 2.0)
        .unwrap_or(DEFAULT_MERGE_THRESHOLD)
}

/// 用所选阈值合并跨块声纹，并在有安全合并余地时尽量收敛到人数上限。同一块内已经被模型判为不同人的单元仍不会强行
/// 合并，因此人数上限是安全目标而不是破坏分离证据的硬截断（上限语义只有一处实现：`merge_speaker_units_capped`）。
pub fn speaker_assignments(units: &[SpeakerUnit], threshold: f32, max_speakers: Option<usize>) -> Vec<usize> {
    merge_speaker_units_capped(units, threshold.clamp(0.01, 1.99), max_speakers.filter(|count| *count > 0))
}

/// 逐单元提取声纹嵌入。单个单元失败（例如音频过短）只置 `None`，该单元独占一个说话人。
fn embed_speaker_units(embedder: &mut dyn SpeakerEmbedding, audio: &[Vec<f32>]) -> Vec<Option<Vec<f32>>> {
    audio
        .iter()
        .map(|unit| {
            if unit.len() < SPEAKER_UNIT_MIN_SAMPLES {
                return None;
            }
            embedder.embed(unit).ok()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(start: f64, end: f64, cluster: usize, chunk: usize) -> SpeakerRange {
        SpeakerRange {
            start,
            end,
            cluster,
            chunk,
        }
    }

    fn row(start: f64, end: f64, speaker: &str) -> RowIn {
        let mut row = RowIn::new(start, end, "text");
        row.speaker = Some(speaker.to_owned());
        row
    }

    /// 按单元音频的首个样本值给出嵌入：值相同的单元是同一个人。
    struct ByFirstSample;

    impl SpeakerEmbedding for ByFirstSample {
        fn embed(&mut self, samples: &[f32]) -> anyhow::Result<Vec<f32>> {
            Ok(if samples[0] > 0.0 { vec![1.0, 0.0] } else { vec![0.0, 1.0] })
        }
    }

    /// 两块，每块两个人；第二块的 S01 其实是第一块的 S02。合并后全局只剩两个人，标签按全局编号写回。
    #[test]
    fn merges_local_clusters_across_chunks() {
        let rate = SAMPLE_RATE as usize;
        let mut samples = vec![0.0_f32; 40 * rate];
        // 0–10 s 与 30–40 s 是 A（正值），10–30 s 是 B（负值）。
        samples[..10 * rate].fill(0.5);
        samples[10 * rate..30 * rate].fill(-0.5);
        samples[30 * rate..].fill(0.5);
        let mut rows = vec![
            row(0.0, 10.0, "S01"),
            row(10.0, 20.0, "S02"),
            row(20.0, 30.0, "S01"),
            row(30.0, 40.0, "S02"),
        ];
        let mut ranges = vec![
            range(0.0, 10.0, 0, 0),
            range(10.0, 20.0, 1, 0),
            range(20.0, 30.0, 2, 1),
            range(30.0, 40.0, 3, 1),
        ];
        let outcome = merge_moss_speakers(
            &mut rows,
            &mut ranges,
            &samples,
            Some(&mut ByFirstSample),
            DEFAULT_MERGE_THRESHOLD,
            None,
        );
        assert_eq!(
            outcome,
            SpeakerMerge::Merged {
                units: 4,
                embedded: 4,
                speakers: 2
            }
        );
        let labels: Vec<_> = rows.iter().map(|row| row.speaker.clone().unwrap()).collect();
        assert_eq!(labels[0], labels[3]);
        assert_eq!(labels[1], labels[2]);
        assert_ne!(labels[0], labels[1]);
    }

    #[test]
    fn keeps_chunk_labels_without_an_embedder_or_when_rows_do_not_pair() {
        let samples = vec![0.5_f32; 20 * SAMPLE_RATE as usize];
        let mut rows = vec![row(0.0, 10.0, "S01"), row(10.0, 20.0, "S01")];
        let mut ranges = vec![range(0.0, 10.0, 0, 0), range(10.0, 20.0, 1, 1)];
        assert_eq!(
            merge_moss_speakers(&mut rows, &mut ranges, &samples, None, DEFAULT_MERGE_THRESHOLD, None),
            SpeakerMerge::EmbedderUnavailable
        );
        let mut shifted = vec![range(3.0, 10.0, 0, 0), range(10.0, 20.0, 1, 1)];
        assert_eq!(
            merge_moss_speakers(
                &mut rows,
                &mut shifted,
                &samples,
                Some(&mut ByFirstSample),
                DEFAULT_MERGE_THRESHOLD,
                None
            ),
            SpeakerMerge::Mismatched
        );
        assert_eq!(
            merge_moss_speakers(
                &mut rows,
                &mut [],
                &samples,
                Some(&mut ByFirstSample),
                DEFAULT_MERGE_THRESHOLD,
                None
            ),
            SpeakerMerge::Nothing
        );
        assert!(rows.iter().all(|row| row.speaker.as_deref() == Some("S01")));
    }

    /// 单元音频按聚类号归组、限长；太短的单元不求嵌入。
    #[test]
    fn speaker_units_group_by_cluster_and_cap_audio() {
        let rate = SAMPLE_RATE as usize;
        let samples = vec![0.1_f32; 100 * rate];
        let ranges = vec![range(0.0, 20.0, 1, 0), range(20.0, 20.2, 0, 0), range(40.0, 60.0, 1, 0)];
        let (units, audio) = build_speaker_units(&ranges, &samples);
        assert_eq!(units.iter().map(|unit| unit.local_cluster).collect::<Vec<_>>(), vec![1, 0]);
        assert_eq!(audio[0].len(), (SPEAKER_UNIT_MAX_SECONDS as usize) * rate);
        assert!(audio[1].len() < SPEAKER_UNIT_MIN_SAMPLES);
        let embedded = embed_speaker_units(&mut ByFirstSample, &audio);
        assert!(embedded[0].is_some() && embedded[1].is_none());
    }
}
