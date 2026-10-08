//! Pyannote 说话人分段的后处理，MLX 与 candle 共用。移植自 v2 `bcut-speech` 的 `pyannote_common.rs`。
//!
//! The compact PyanNet model emits seven powerset logits per frame (silence,
//! three single-speaker classes and three two-speaker overlaps). Both backends
//! hand those **raw logits** to this module, which owns the whole decode:
//! per-frame softmax → per-speaker probability sum → onset/offset hysteresis →
//! minimum speech/silence smoothing. Keeping the decode here (instead of an
//! `argmax` inside each backend) is what makes MLX and candle frame-identical,
//! and it is the only way overlapped speech survives at all — `argmax` collapses
//! every frame to a single powerset class.
//!
//! Local speaker indices are arbitrary in every ten-second window, so global
//! identity is decided by WeSpeaker voiceprint embeddings plus constrained
//! agglomerative clustering (segmentation first, then embedding clustering).
//! IoU chaining across the window overlap is only the degraded path used when
//! no embedding backend is available.

use crate::speech::speaker_cluster::{DEFAULT_MIN_CLUSTER_SECONDS, SpeakerUnit, merge_speaker_units_with_durations};
use anyhow::{Result, bail};
use std::collections::{BTreeMap, BTreeSet, HashSet};

pub use crate::speech::speaker_cluster::DEFAULT_MERGE_THRESHOLD;

pub const SAMPLE_RATE: usize = 16_000;
pub const WINDOW_SECONDS: f64 = 10.0;
pub const WINDOW_SAMPLES: usize = SAMPLE_RATE * 10;
/// 滑窗步长 = 半个窗口（5 秒，`step = windowSamples / 2`）。
///
/// 曾经是 1 秒。1 秒步长下每一句话会横跨十来个窗口，而窗口之间的 local speaker
/// 编号互不相干，于是同一段连续语音被拆进十几个各自独立的归属区，任何一个窗口
/// 判错都会在时间线上留下一个碎片——实测 102 个 turn 内部自相矛盾。5 秒步长把
/// 归属区宽度也变成 5 秒（见 `render_segments`），一整句话通常落在同一个窗口的
/// 归属区里，碎片化随之消失，顺带把分割推理量降到原来的 1/5。
pub const STEP_SAMPLES: usize = WINDOW_SAMPLES / 2;
/// 一个窗口跨越多少个步长；同时是 IoU 回看的历史窗口数（见 [`STEP_SAMPLES`]）。
pub const WINDOW_STEPS: usize = WINDOW_SAMPLES / STEP_SAMPLES;
pub const FRAMES_PER_WINDOW: usize = 589;
pub const LOCAL_SPEAKERS: usize = 3;
/// powerset 类别数：0 静音、1..=3 单人、4..=6 两人重叠。
pub const CLASS_COUNT: usize = 7;
pub const INFERENCE_BATCH: usize = 8;

/// 迟滞二值化的开启阈值。
pub const ONSET: f32 = 0.5;
/// 迟滞二值化的关闭阈值。
pub const OFFSET: f32 = 0.3;

/// 最短语音段（`minSpeechDuration`）。
const MIN_SPEECH_SECONDS: f64 = 0.30;
/// 最短静音间隔；短于它的空隙在窗口内先被填平，跨窗口再用同一个值合并。
const MIN_SILENCE_SECONDS: f64 = 0.15;
const MERGE_GAP_SECONDS: f64 = MIN_SILENCE_SECONDS;
/// 判定「相邻窗口的两个 local speaker 是同一人」的最低 IoU。
///
/// 只在**没有声纹后端**的降级路径上生效（见 [`diarize_with`]）。步长改成 5 秒
/// 后重叠区是 5 秒而不再是 9 秒，但 IoU 只在重叠区内统计，量纲不随重叠长度漂移，
/// 因此阈值维持不变。
const MATCH_THRESHOLD: f64 = 0.08;
/// 提取声纹所需的最短独占语音（0.5 秒，`sampleRate/2`），与 `wespeaker::MINIMUM_SAMPLES` 一致。
const MIN_EMBEDDING_SAMPLES: usize = SAMPLE_RATE / 2;

/// 严格独占攒不够声纹时的「主导」判据裕度。
///
/// 严格独占要求其余 local 的原始概率全部低于 [`OFFSET`]。在连续对话里主讲人的
/// 概率几乎不会掉到 0.3 以下，于是次要说话人在整个窗口里拿到 **0 毫秒** 独占
/// 语音——实测 121 个窗口里有 81 个因此丢掉至少一个说话人，那个人永远进不了
/// 聚类，也就永远不会成为独立身份。兜底判据改问「本人概率是否显著压过其余
/// local」，0.20 是消融扫描（0.00/0.05/0.10/0.15/0.20/0.30）里 purity 与碎片化
/// 同时达标的工作点：0 会把重叠段全部收进来（碎片化 76 turns），过大又退化回
/// 严格独占。
const DOMINANCE_MARGIN: f32 = 0.20;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DiarizedSegment {
    pub start: f64,
    pub end: f64,
    pub speaker: usize,
}

#[derive(Debug)]
pub struct PyannoteCancelled;

impl std::fmt::Display for PyannoteCancelled {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Pyannote 说话人识别已取消")
    }
}

impl std::error::Error for PyannoteCancelled {}

pub struct PyannoteCallbacks<'a> {
    pub on_progress: Option<&'a mut dyn FnMut(f64, f64)>,
    pub should_cancel: Option<&'a mut dyn FnMut() -> bool>,
}

impl Default for PyannoteCallbacks<'_> {
    fn default() -> Self {
        Self {
            on_progress: None,
            should_cancel: None,
        }
    }
}

/// 说话人分离参数。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PyannoteOptions {
    /// 全局说话人数上限；`None` 表示不限制。
    pub max_speakers: Option<usize>,
    /// 声纹聚类阈值（余弦距离，严格小于才合并）。越小越保守（人越多）。
    pub clustering_threshold: f32,
}

impl Default for PyannoteOptions {
    fn default() -> Self {
        Self {
            max_speakers: None,
            clustering_threshold: DEFAULT_MERGE_THRESHOLD,
        }
    }
}

/// 声纹提取回调：输入 16 kHz 单声道独占语音，返回嵌入向量；`None` 表示本段
/// 提不出可用向量（音频过短或后端不可用），该 local speaker 不参与全局身份。
pub type SpeakerEmbedder<'a> = &'a mut dyn FnMut(&[f32]) -> Option<Vec<f32>>;

#[derive(Debug, Clone)]
struct WindowActivity {
    start_sample: usize,
    end_sample: usize,
    /// 每帧每 local speaker 的说话概率（powerset 类概率之和，见
    /// [`speaker_probabilities`]）。独占判定必须用它而不是二值化后的
    /// [`Self::tracks`]：迟滞关闭阈值是 0.3，一个概率 0.4 但处于迟滞 off
    /// 的说话人在 tracks 里是静音，把这种帧当独占会污染声纹。
    probabilities: [Vec<f32>; LOCAL_SPEAKERS],
    /// 迟滞 + 最短语音/静音平滑之后的逐帧活跃标志；允许多人同时为 true。
    tracks: [Vec<bool>; LOCAL_SPEAKERS],
}

/// 逐帧 softmax 后按说话人把 powerset 类概率求和。
///
/// 映射与 pyannote 的 powerset 定义一致，也与旧 `decode_powerset` 的 tracks
/// 映射逐位相同：spk1 = {1,4,5}、spk2 = {2,4,6}、spk3 = {3,5,6}。
/// softmax 用「减去逐帧最大值」的数值稳定写法；整帧含 NaN 时该帧概率退化为 0。
pub fn speaker_probabilities(logits: &[f32]) -> [Vec<f32>; LOCAL_SPEAKERS] {
    let frames = logits.len() / CLASS_COUNT;
    let mut probabilities: [Vec<f32>; LOCAL_SPEAKERS] = std::array::from_fn(|_| Vec::with_capacity(frames));
    for frame in 0..frames {
        let row = &logits[frame * CLASS_COUNT..(frame + 1) * CLASS_COUNT];
        let maximum = row.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let mut exponentials = [0.0_f32; CLASS_COUNT];
        let mut total = 0.0_f32;
        for (index, value) in row.iter().enumerate() {
            let exponential = (value - maximum).exp();
            exponentials[index] = exponential;
            total += exponential;
        }
        // total 非有限（logits 含 NaN）时 scale 归零，本帧不会激活任何说话人。
        let scale = if total > 0.0 && total.is_finite() { 1.0 / total } else { 0.0 };
        probabilities[0].push((exponentials[1] + exponentials[4] + exponentials[5]) * scale);
        probabilities[1].push((exponentials[2] + exponentials[4] + exponentials[6]) * scale);
        probabilities[2].push((exponentials[3] + exponentials[5] + exponentials[6]) * scale);
    }
    probabilities
}

/// 单个说话人的迟滞二值化 + 最短语音/静音平滑。
///
/// 迟滞：静默态需 `prob >= ONSET` 才开启，活跃态需 `prob < OFFSET` 才关闭。
/// 随后填平短于
/// [`MIN_SILENCE_SECONDS`] 的**内部**空隙，再丢弃短于 [`MIN_SPEECH_SECONDS`]
/// 的语音段。
pub fn binarize_speaker_track(probabilities: &[f32]) -> Vec<bool> {
    let mut active = vec![false; probabilities.len()];
    let mut open = false;
    for (index, probability) in probabilities.iter().enumerate() {
        open = if open { *probability >= OFFSET } else { *probability >= ONSET };
        active[index] = open;
    }

    let frame_seconds = WINDOW_SECONDS / FRAMES_PER_WINDOW as f64;
    let min_silence_frames = (MIN_SILENCE_SECONDS / frame_seconds).round() as usize;
    let min_speech_frames = (MIN_SPEECH_SECONDS / frame_seconds).round() as usize;

    // 只填内部空隙：前导/尾随静音可能只是被窗口切断，填了会凭空造出语音。
    let mut index = 0;
    while index < active.len() {
        if active[index] {
            index += 1;
            continue;
        }
        let gap_start = index;
        while index < active.len() && !active[index] {
            index += 1;
        }
        let bounded = gap_start > 0 && index < active.len();
        if bounded && index - gap_start < min_silence_frames {
            active[gap_start..index].fill(true);
        }
    }

    let mut index = 0;
    while index < active.len() {
        if !active[index] {
            index += 1;
            continue;
        }
        let run_start = index;
        while index < active.len() && active[index] {
            index += 1;
        }
        if index - run_start < min_speech_frames {
            active[run_start..index].fill(false);
        }
    }
    active
}

/// 跨后端对拍用：逐帧 powerset 胜出类别。**不参与实际解码**，保留它只是为了
/// 把两个后端的差异定位到网络层；真正决定输出的是
/// [`speaker_probabilities`] + [`binarize_speaker_track`]。
pub fn argmax_classes(logits: &[f32]) -> Vec<u8> {
    (0..logits.len() / CLASS_COUNT)
        .map(|frame| {
            let row = &logits[frame * CLASS_COUNT..(frame + 1) * CLASS_COUNT];
            let mut best = 0_usize;
            for index in 1..CLASS_COUNT {
                if row[index] > row[best] {
                    best = index;
                }
            }
            best as u8
        })
        .collect()
}

/// Runs batched segmentation and turns local powerset logits into stable global
/// speaker ranges. `infer` receives tightly packed, zero-padded 10-second
/// windows and returns `FRAMES_PER_WINDOW * CLASS_COUNT` **raw logits** per
/// batch item (row-major, frame outer / class inner).
///
/// `embed` 是可选的声纹提取器：提供时全局身份由约束层次聚类决定；不提供时退化
/// 为纯 IoU 链式传递，跨长静音的同一说话人会被判成新身份——这是后端能力缺失
/// 下的显式降级，不是默认路径。
pub fn diarize_with<F>(
    samples: &[f32],
    options: &PyannoteOptions,
    callbacks: &mut PyannoteCallbacks<'_>,
    mut infer: F,
    embed: Option<SpeakerEmbedder<'_>>,
) -> Result<Vec<DiarizedSegment>>
where
    F: FnMut(&[f32], usize) -> Result<Vec<Vec<f32>>>,
{
    if options.max_speakers == Some(0) {
        bail!("说话人数上限必须至少为 1");
    }
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    let positions = window_positions(samples.len());
    // 有声纹阶段时进度分母翻倍：分割一遍、嵌入一遍。
    let progress_total = (positions.len() * if embed.is_some() { 2 } else { 1 }) as f64;
    let mut windows = Vec::with_capacity(positions.len());
    for batch_start in (0..positions.len()).step_by(INFERENCE_BATCH) {
        check_cancelled(callbacks)?;
        let batch_end = (batch_start + INFERENCE_BATCH).min(positions.len());
        let batch_size = batch_end - batch_start;
        let mut packed = vec![0.0_f32; batch_size * WINDOW_SAMPLES];
        for (batch_index, (start, end)) in positions[batch_start..batch_end].iter().enumerate() {
            let target = &mut packed[batch_index * WINDOW_SAMPLES..(batch_index + 1) * WINDOW_SAMPLES];
            target[..end - start].copy_from_slice(&samples[*start..*end]);
        }
        let batch_logits = infer(&packed, batch_size)?;
        if batch_logits.len() != batch_size {
            bail!("Pyannote 返回窗口数异常：实际 {}，期望 {batch_size}", batch_logits.len());
        }
        for (offset, logits) in batch_logits.into_iter().enumerate() {
            if logits.len() != FRAMES_PER_WINDOW * CLASS_COUNT {
                bail!(
                    "Pyannote 返回 logits 数异常：实际 {}，期望 {}",
                    logits.len(),
                    FRAMES_PER_WINDOW * CLASS_COUNT
                );
            }
            let (start_sample, end_sample) = positions[batch_start + offset];
            let probabilities = speaker_probabilities(&logits);
            let tracks = std::array::from_fn(|local| binarize_speaker_track(&probabilities[local]));
            windows.push(WindowActivity {
                start_sample,
                end_sample,
                probabilities,
                tracks,
            });
        }
        if let Some(on_progress) = callbacks.on_progress.as_deref_mut() {
            on_progress(batch_end as f64, progress_total);
        }
    }

    check_cancelled(callbacks)?;
    let mappings = match embed {
        Some(embed) => {
            match cluster_window_speakers(&windows, samples, options, callbacks, embed)? {
                Some(mappings) => mappings,
                // 全片没有任何一段满足最短独占语音要求：无声纹可用，退回 IoU。
                None => stitch_window_speakers(&windows, options.max_speakers),
            }
        }
        None => stitch_window_speakers(&windows, options.max_speakers),
    };
    Ok(render_segments(&windows, &mappings, samples.len()))
}

/// 声纹再识别：每窗每 local speaker 取独占语音提嵌入，约束层次聚类定全局身份。
///
/// 返回 `None` 表示一个可用嵌入都没有，调用方应退回纯 IoU。
///
/// **没有 IoU 桥。** 旧实现在这里给「提不出嵌入的 local speaker」按 IoU 链的
/// 多数簇补一个标签，理由写在当时的注释里：1 秒步长下归属区只有 1 秒，丢一个
/// 窗口就是在时间线上打一个 1 秒的洞。但那条路径给出的标签与声纹无关，实测
/// 0–1 秒短 turn 的错误率高达 70%。步长改成 5 秒后前提消失：归属区宽 5 秒，
/// 独占语音普遍够长，直接跳过这种 local speaker 即可。跳过的代价只是这一小段没有说话人标注，
/// 而桥接的代价是给出一个错误标注——后者更糟。
fn cluster_window_speakers(
    windows: &[WindowActivity],
    samples: &[f32],
    options: &PyannoteOptions,
    callbacks: &mut PyannoteCallbacks<'_>,
    embed: SpeakerEmbedder<'_>,
) -> Result<Option<Vec<[Option<usize>; LOCAL_SPEAKERS]>>> {
    let mut units: Vec<SpeakerUnit> = Vec::new();
    let mut owners: Vec<(usize, usize)> = Vec::new();
    let mut seconds: Vec<f64> = Vec::new();
    for (window_index, window) in windows.iter().enumerate() {
        // 嵌入是第二长的阶段，取消检查必须落在循环里。
        check_cancelled(callbacks)?;
        for local in 0..LOCAL_SPEAKERS {
            let Some((audio, first_start)) = exclusive_audio(window, local, samples) else {
                continue;
            };
            let duration = audio.len() as f64 / SAMPLE_RATE as f64;
            let Some(embedding) = embed(&audio) else {
                continue;
            };
            units.push(SpeakerUnit {
                chunk: window_index,
                local_cluster: window_index * LOCAL_SPEAKERS + local,
                embedding: Some(embedding),
                first_start,
            });
            owners.push((window_index, local));
            seconds.push(duration);
        }
        if let Some(on_progress) = callbacks.on_progress.as_deref_mut() {
            on_progress((windows.len() + window_index + 1) as f64, (windows.len() * 2) as f64);
        }
    }
    if units.is_empty() {
        return Ok(None);
    }

    let assignment = merge_speaker_units_with_durations(
        &units,
        options.clustering_threshold,
        options.max_speakers,
        &seconds,
        // `seconds[]` 统计的是每 (窗口, local) 的独占秒数，同一秒真实语音被
        // `WINDOW_STEPS` 个窗口各计一次；5s 步长下 2.0 等价于 1.0 秒真实时长。
        DEFAULT_MIN_CLUSTER_SECONDS,
    );

    // 说话人上限是硬承诺，但同 chunk 互斥同样是硬约束，两者冲突时聚类只能留下
    // 超额的簇（例如单人素材里某个窗口误报了第二个 local speaker）。这里按累计
    // 独占时长保留最响的 cap 个簇，其余 local speaker 本窗口不输出——宁可少标，
    // 不可错标。
    let keep = surviving_clusters(&assignment, &seconds, options.max_speakers);

    let mut mappings = vec![[None; LOCAL_SPEAKERS]; windows.len()];
    for (index, (window_index, local)) in owners.iter().copied().enumerate() {
        if let Some(keep) = keep.as_ref()
            && !keep.contains(&assignment[index])
        {
            continue;
        }
        mappings[window_index][local] = Some(assignment[index]);
    }
    Ok(Some(mappings))
}

/// 超出说话人上限时按累计独占时长挑出要保留的簇；未超限返回 `None`。
/// 时长相同则保留 id 更小者，保证确定性。
fn surviving_clusters(assignment: &[usize], seconds: &[f64], max_speakers: Option<usize>) -> Option<BTreeSet<usize>> {
    let cap = max_speakers?;
    let mut totals: BTreeMap<usize, f64> = BTreeMap::new();
    for (index, cluster) in assignment.iter().copied().enumerate() {
        *totals.entry(cluster).or_default() += seconds.get(index).copied().unwrap_or_default();
    }
    if totals.len() <= cap {
        return None;
    }
    let mut ranked = totals.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|left, right| right.1.total_cmp(&left.1).then(left.0.cmp(&right.0)));
    Some(ranked.into_iter().take(cap).map(|(id, _)| id).collect())
}

/// 取某个 local speaker 在本窗口内的独占语音（本帧没有别人同时说话）。
///
/// 「独占」= 本人二值化后活跃，且其余 local speaker 的**原始概率**都低于
/// [`OFFSET`]。用原始
/// 概率而不是二值化 tracks 是刻意的：迟滞让一个概率 0.4 的说话人可能仍处于
/// off，按 tracks 判会把这种帧当成独占，混入他人声音污染 WeSpeaker 向量。
///
/// 返回 `(音频, 首个独占帧的绝对秒数)`；不足 [`MIN_EMBEDDING_SAMPLES`] 返回
/// `None`。采样一律夹到 `end_sample` 与 `samples.len()`：末窗是补零对齐的，
/// 把补零段喂进 WeSpeaker 会污染向量。
fn exclusive_audio(window: &WindowActivity, local: usize, samples: &[f32]) -> Option<(Vec<f32>, f64)> {
    if let Some(strict) = collect_clean_audio(window, local, samples, None) {
        return Some(strict);
    }
    // 严格独占攒不够时的兜底：并上本人「显著压过其余 local」的帧。
    collect_clean_audio(window, local, samples, Some(DOMINANCE_MARGIN))
}

/// `margin = None` ⇒ 严格独占（其余 local 原始概率 < OFFSET）。
/// `margin = Some(m)` ⇒ 主导判据（本人概率比其余 local 至少高 m）。
fn collect_clean_audio(window: &WindowActivity, local: usize, samples: &[f32], margin: Option<f32>) -> Option<(Vec<f32>, f64)> {
    let frame_samples = WINDOW_SAMPLES as f64 / FRAMES_PER_WINDOW as f64;
    let limit = window.end_sample.min(samples.len());
    let mut audio = Vec::new();
    let mut first_start = None;
    for frame in 0..window.tracks[local].len() {
        if !window.tracks[local][frame] {
            continue;
        }
        let own = window.probabilities[local][frame];
        // margin = Some(m) 时取「严格独占 ∪ 主导」的并集：严格独占帧本身就是最纯的
        // 那批，放宽判据不应该把它们排除掉。
        let clean = (0..LOCAL_SPEAKERS)
            .filter(|other| *other != local)
            .all(|other| window.probabilities[other][frame] < OFFSET)
            || margin.is_some_and(|margin| {
                (0..LOCAL_SPEAKERS)
                    .filter(|other| *other != local)
                    .all(|other| window.probabilities[other][frame] + margin <= own)
            });
        if !clean {
            continue;
        }
        let start = window.start_sample + (frame as f64 * frame_samples) as usize;
        let end = window.start_sample + ((frame + 1) as f64 * frame_samples) as usize;
        let (start, end) = (start.min(limit), end.min(limit));
        if end <= start {
            continue;
        }
        first_start.get_or_insert(start as f64 / SAMPLE_RATE as f64);
        audio.extend_from_slice(&samples[start..end]);
    }
    if audio.len() < MIN_EMBEDDING_SAMPLES {
        return None;
    }
    Some((audio, first_start?))
}

fn check_cancelled(callbacks: &mut PyannoteCallbacks<'_>) -> Result<()> {
    if callbacks.should_cancel.as_deref_mut().is_some_and(|should_cancel| should_cancel()) {
        return Err(anyhow::Error::new(PyannoteCancelled));
    }
    Ok(())
}

fn window_positions(sample_count: usize) -> Vec<(usize, usize)> {
    if sample_count <= WINDOW_SAMPLES {
        return vec![(0, sample_count)];
    }
    let mut positions = Vec::new();
    let mut start = 0;
    while start + WINDOW_SAMPLES <= sample_count {
        positions.push((start, start + WINDOW_SAMPLES));
        start += STEP_SAMPLES;
    }
    if positions.last().is_none_or(|(_, end)| *end < sample_count) {
        let final_start = sample_count - WINDOW_SAMPLES;
        if positions.last().is_none_or(|(start, _)| *start != final_start) {
            positions.push((final_start, sample_count));
        }
    }
    positions
}

fn stitch_window_speakers(windows: &[WindowActivity], max_speakers: Option<usize>) -> Vec<[Option<usize>; LOCAL_SPEAKERS]> {
    let mut mappings = Vec::with_capacity(windows.len());
    let mut next_speaker = 0_usize;

    for (window_index, window) in windows.iter().enumerate() {
        let active = (0..LOCAL_SPEAKERS)
            .filter(|speaker| window.tracks[*speaker].iter().any(|value| *value))
            .collect::<Vec<_>>();
        let mut mapping = [None; LOCAL_SPEAKERS];
        if active.is_empty() {
            mappings.push(mapping);
            continue;
        }

        let mut scores = Vec::new();
        // 只回看仍与当前窗口有共同采样的历史窗口；更早的窗口交集恒为 0。
        let history_start = window_index.saturating_sub(WINDOW_STEPS);
        for local in active.iter().copied() {
            let mut by_global = BTreeMap::<usize, (usize, usize)>::new();
            for previous_index in history_start..window_index {
                let previous = &windows[previous_index];
                if previous.end_sample <= window.start_sample {
                    continue;
                }
                for previous_local in 0..LOCAL_SPEAKERS {
                    let Some(global) = mappings[previous_index][previous_local] else {
                        continue;
                    };
                    let (intersection, union) = track_overlap(window, local, previous, previous_local);
                    let entry = by_global.entry(global).or_default();
                    entry.0 += intersection;
                    entry.1 += union;
                }
            }
            for (global, (intersection, union)) in by_global {
                if union > 0 {
                    scores.push((intersection as f64 / union as f64, local, global));
                }
            }
        }
        scores.sort_by(|left, right| {
            right
                .0
                .total_cmp(&left.0)
                .then_with(|| left.1.cmp(&right.1))
                .then_with(|| left.2.cmp(&right.2))
        });

        let mut used_local = HashSet::new();
        let mut used_global = HashSet::new();
        for (score, local, global) in scores {
            if score < MATCH_THRESHOLD || used_local.contains(&local) || used_global.contains(&global) {
                continue;
            }
            mapping[local] = Some(global);
            used_local.insert(local);
            used_global.insert(global);
        }

        for local in active {
            if mapping[local].is_some() {
                continue;
            }
            // 达到上限时不再臆造身份：既没有重叠证据也没有空位可分，就让这个
            // local speaker 在本窗口不参与输出——它的时间大概率被相邻窗口覆盖。
            // （旧实现在这里按序号找空位并 `unwrap_or(0)`，等于把无证据的语音
            // 硬塞进 speaker 0。）
            if max_speakers.is_some_and(|limit| next_speaker >= limit) {
                continue;
            }
            let global = next_speaker;
            next_speaker += 1;
            mapping[local] = Some(global);
            used_global.insert(global);
        }
        mappings.push(mapping);
    }
    mappings
}

fn track_overlap(left: &WindowActivity, left_speaker: usize, right: &WindowActivity, right_speaker: usize) -> (usize, usize) {
    let overlap_start = left.start_sample.max(right.start_sample);
    let overlap_end = left.end_sample.min(right.end_sample);
    if overlap_end <= overlap_start {
        return (0, 0);
    }
    let mut intersection = 0;
    let mut union = 0;
    for frame in 0..FRAMES_PER_WINDOW {
        let absolute_sample = left.start_sample + ((frame as f64 + 0.5) * WINDOW_SAMPLES as f64 / FRAMES_PER_WINDOW as f64) as usize;
        if absolute_sample < overlap_start || absolute_sample >= overlap_end {
            continue;
        }
        let right_frame =
            (((absolute_sample - right.start_sample) as f64 / WINDOW_SAMPLES as f64) * FRAMES_PER_WINDOW as f64).floor() as usize;
        if right_frame >= FRAMES_PER_WINDOW {
            continue;
        }
        let a = left.tracks[left_speaker][frame];
        let b = right.tracks[right_speaker][right_frame];
        intersection += usize::from(a && b);
        union += usize::from(a || b);
    }
    (intersection, union)
}

fn render_segments(windows: &[WindowActivity], mappings: &[[Option<usize>; LOCAL_SPEAKERS]], sample_count: usize) -> Vec<DiarizedSegment> {
    let duration = sample_count as f64 / SAMPLE_RATE as f64;
    let frame_duration = WINDOW_SECONDS / FRAMES_PER_WINDOW as f64;
    let mut segments = Vec::new();
    for (index, window) in windows.iter().enumerate() {
        let window_start = window.start_sample as f64 / SAMPLE_RATE as f64;
        let window_end = window.end_sample as f64 / SAMPLE_RATE as f64;
        let previous_end = index
            .checked_sub(1)
            .map(|previous| windows[previous].end_sample as f64 / SAMPLE_RATE as f64)
            .unwrap_or(0.0);
        let next_start = windows
            .get(index + 1)
            .map(|next| next.start_sample as f64 / SAMPLE_RATE as f64)
            .unwrap_or(duration);
        // 归属区（center zone）：步长 5 秒时正好是窗口中间的 5 秒，首窗左边界
        // 拉到 0、末窗右边界拉到片长。
        let own_start = if index == 0 { 0.0 } else { (window_start + previous_end) * 0.5 };
        let own_end = if index + 1 == windows.len() {
            duration
        } else {
            (window_end + next_start) * 0.5
        };

        for local in 0..LOCAL_SPEAKERS {
            let Some(global) = mappings[index][local] else {
                continue;
            };
            let mut run_start = None;
            for frame in 0..=FRAMES_PER_WINDOW {
                let active = frame < FRAMES_PER_WINDOW && window.tracks[local][frame];
                if active && run_start.is_none() {
                    run_start = Some(frame);
                } else if !active && let Some(start_frame) = run_start.take() {
                    // 时长门槛已经在 binarize_speaker_track 里按窗口内原始 run
                    // 判过，这里只做归属区裁剪；跨归属区被切开的两半时间相邻，
                    // 下面的 MERGE_GAP_SECONDS 合并会把它们接回去。
                    let raw_start = window_start + start_frame as f64 * frame_duration;
                    let raw_end = window_start + frame as f64 * frame_duration;
                    let start = raw_start.max(own_start);
                    let end = raw_end.min(window_end).min(own_end);
                    if end > start {
                        segments.push(DiarizedSegment {
                            start,
                            end,
                            speaker: global,
                        });
                    }
                }
            }
        }
    }

    segments.sort_by(|left, right| left.speaker.cmp(&right.speaker).then_with(|| left.start.total_cmp(&right.start)));
    let mut merged: Vec<DiarizedSegment> = Vec::new();
    for segment in segments {
        if let Some(previous) = merged.last_mut()
            && previous.speaker == segment.speaker
            && segment.start - previous.end < MERGE_GAP_SECONDS
        {
            previous.end = previous.end.max(segment.end);
        } else {
            merged.push(segment);
        }
    }
    // 合并后再兜一次底：孤立的、被归属区切到极短的碎片仍然不输出。
    merged.retain(|segment| segment.end - segment.start >= MIN_SPEECH_SECONDS);

    let used = merged.iter().map(|segment| segment.speaker).collect::<BTreeSet<_>>();
    let compact = used
        .into_iter()
        .enumerate()
        .map(|(new, old)| (old, new))
        .collect::<BTreeMap<_, _>>();
    for segment in &mut merged {
        segment.speaker = compact[&segment.speaker];
    }
    merged.sort_by(|left, right| left.start.total_cmp(&right.start).then_with(|| left.speaker.cmp(&right.speaker)));
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 把「每帧一个 powerset 类别」的意图翻译成 logits：胜出类给 10.0，其余 0.0。
    /// softmax 后胜出类概率 ≈0.99994，稳稳越过 [`ONSET`]。
    fn logits_from_classes(classes: &[u8]) -> Vec<f32> {
        let mut logits = vec![0.0_f32; classes.len() * CLASS_COUNT];
        for (frame, class) in classes.iter().enumerate() {
            logits[frame * CLASS_COUNT + *class as usize] = 10.0;
        }
        logits
    }

    #[test]
    fn positions_use_ten_second_windows_with_half_window_step() {
        assert_eq!(window_positions(8_000), vec![(0, 8_000)]);
        assert_eq!(STEP_SAMPLES, 80_000);
        assert_eq!(WINDOW_STEPS, 2);
        let positions = window_positions(WINDOW_SAMPLES + 2 * STEP_SAMPLES);
        assert_eq!(positions, vec![(0, 160_000), (80_000, 240_000), (160_000, 320_000)]);
        // 尾部不足一个步长时补一个贴边窗口。
        assert_eq!(window_positions(WINDOW_SAMPLES + 20_000), vec![(0, 160_000), (20_000, 180_000)]);
    }

    #[test]
    fn powerset_probabilities_sum_per_speaker() {
        // 帧 0 静音、帧 1 只有 spk1、帧 2 是 spk1+spk2、帧 3 是 spk2+spk3。
        let probabilities = speaker_probabilities(&logits_from_classes(&[0, 1, 4, 6]));
        let active: Vec<Vec<bool>> = probabilities
            .iter()
            .map(|track| track.iter().map(|value| *value >= ONSET).collect())
            .collect();
        assert_eq!(active[0], vec![false, true, true, false]);
        assert_eq!(active[1], vec![false, false, true, true]);
        assert_eq!(active[2], vec![false, false, false, true]);
    }

    #[test]
    fn overlap_probability_survives_when_argmax_would_lose() {
        // 单人类 1 拿 0.40，重叠类 4 拿 0.35：argmax 判「只有 spk1」，
        // 概率求和后 spk2 = 0.35 < onset 但 spk1 = 0.75 —— 关键是 spk2 的
        // 0.35 高于 OFFSET，会让这一帧不再被当成 spk1 的独占语音。
        let mut logits = vec![f32::NEG_INFINITY; CLASS_COUNT];
        logits[0] = 0.25_f32.ln();
        logits[1] = 0.40_f32.ln();
        logits[4] = 0.35_f32.ln();
        let probabilities = speaker_probabilities(&logits);
        assert!((probabilities[0][0] - 0.75).abs() < 1e-5);
        assert!((probabilities[1][0] - 0.35).abs() < 1e-5);
        assert!(probabilities[1][0] >= OFFSET);
        assert_eq!(argmax_classes(&logits), vec![1]);
    }

    #[test]
    fn hysteresis_keeps_a_dipping_speaker_active() {
        // 0.6 开启 → 0.4 落在 onset 与 offset 之间，迟滞保持活跃 → 0.1 关闭。
        let probabilities = std::iter::repeat_n(0.6_f32, 40)
            .chain(std::iter::repeat_n(0.4, 40))
            .chain(std::iter::repeat_n(0.1, 40))
            .collect::<Vec<_>>();
        let track = binarize_speaker_track(&probabilities);
        assert!(track[0..80].iter().all(|value| *value));
        assert!(track[80..].iter().all(|value| !*value));
        // 没有迟滞（单阈值 0.5）时中间 40 帧会被误判为静音。
        assert!(probabilities[40] < ONSET && probabilities[40] >= OFFSET);
    }

    #[test]
    fn smoothing_fills_short_gaps_and_drops_short_speech() {
        let frame_seconds = WINDOW_SECONDS / FRAMES_PER_WINDOW as f64;
        let long = (1.0 / frame_seconds) as usize; // 1 秒
        let short_gap = (0.10 / frame_seconds) as usize; // < MIN_SILENCE_SECONDS
        let short_speech = (0.20 / frame_seconds) as usize; // < MIN_SPEECH_SECONDS
        let probabilities = std::iter::repeat_n(0.9_f32, long)
            .chain(std::iter::repeat_n(0.0, short_gap))
            .chain(std::iter::repeat_n(0.9, long))
            .chain(std::iter::repeat_n(0.0, long))
            .chain(std::iter::repeat_n(0.9, short_speech))
            .collect::<Vec<_>>();
        let track = binarize_speaker_track(&probabilities);
        // 短空隙被填平：前 2 秒 + 中间空隙连成一段。
        assert!(track[..2 * long + short_gap].iter().all(|value| *value));
        // 结尾 0.2 秒语音短于 MIN_SPEECH_SECONDS，被丢弃。
        assert!(track[2 * long + short_gap..].iter().all(|value| !*value));
    }

    fn blank_window(start_sample: usize) -> WindowActivity {
        WindowActivity {
            start_sample,
            end_sample: start_sample + WINDOW_SAMPLES,
            probabilities: std::array::from_fn(|_| vec![0.0; FRAMES_PER_WINDOW]),
            tracks: std::array::from_fn(|_| vec![false; FRAMES_PER_WINDOW]),
        }
    }

    /// 把窗口某个 local speaker 的一段帧区间置为活跃（概率与 tracks 同时写）。
    fn activate(window: &mut WindowActivity, local: usize, range: std::ops::Range<usize>) {
        window.probabilities[local][range.clone()].fill(1.0);
        window.tracks[local][range].fill(true);
    }

    #[test]
    fn overlap_stitching_survives_local_label_swap() {
        // 步长 5 秒 = 294.5 帧：窗口 0 的帧 f（f ≥ 294）对应窗口 1 的帧 f-294，
        // 由 `track_overlap` 的帧中心映射决定。下面的区间是照这条映射手算的。
        let mut first = blank_window(0);
        let mut second = blank_window(STEP_SAMPLES);
        activate(&mut first, 0, 300..500);
        activate(&mut first, 1, 520..580);
        activate(&mut second, 1, 6..206); // 与 first.tracks[0] 完全重合
        activate(&mut second, 0, 226..286); // 与 first.tracks[1] 完全重合
        let mappings = stitch_window_speakers(&[first, second], None);
        assert_eq!(mappings[0][0], mappings[1][1]);
        assert_eq!(mappings[0][1], mappings[1][0]);
        assert_ne!(mappings[0][0], mappings[0][1]);
    }

    #[test]
    fn speaker_cap_does_not_create_extra_global_ids() {
        let mut window = blank_window(0);
        for local in 0..LOCAL_SPEAKERS {
            activate(&mut window, local, 0..FRAMES_PER_WINDOW);
        }
        let mappings = stitch_window_speakers(&[window], Some(2));
        let ids = mappings[0].into_iter().flatten().collect::<BTreeSet<_>>();
        assert_eq!(ids, BTreeSet::from([0, 1]));
        // 第三个 local speaker 没有空位也没有重叠证据，不再被硬塞进 speaker 0。
        assert_eq!(mappings[0].iter().flatten().count(), 2);
    }

    /// 同一个人先说 0–5 秒，静默 25 秒后在 30–35 秒回来，且模型给了不同的
    /// local 编号。IoU 回看只有 [`WINDOW_STEPS`] 个窗口，必然判成两个人；
    /// 声纹聚类必须把两段并回同一个全局 id。
    #[test]
    fn same_speaker_returning_after_long_silence_keeps_one_identity() {
        const DURATION_SECONDS: usize = 40;
        let samples = vec![0.1_f32; DURATION_SECONDS * SAMPLE_RATE];

        fn synth(window_index: usize) -> Vec<f32> {
            let classes = (0..FRAMES_PER_WINDOW)
                .map(|frame| {
                    let time = window_index as f64 * (STEP_SAMPLES as f64 / SAMPLE_RATE as f64)
                        + frame as f64 * WINDOW_SECONDS / FRAMES_PER_WINDOW as f64;
                    if (0.0..5.0).contains(&time) {
                        1 // local 0
                    } else if (30.0..35.0).contains(&time) {
                        2 // 同一个人，模型这次给的是 local 1
                    } else {
                        0
                    }
                })
                .collect::<Vec<u8>>();
            logits_from_classes(&classes)
        }

        fn infer() -> impl FnMut(&[f32], usize) -> Result<Vec<Vec<f32>>> {
            let mut next_window = 0_usize;
            move |_packed: &[f32], batch: usize| {
                let logits = (0..batch).map(|index| synth(next_window + index)).collect();
                next_window += batch;
                Ok(logits)
            }
        }

        // 纯 IoU（无声纹后端）：长静音后回来的同一个人被判成第二个说话人。
        let iou_only = diarize_with(
            &samples,
            &PyannoteOptions::default(),
            &mut PyannoteCallbacks::default(),
            infer(),
            None,
        )
        .unwrap();
        let iou_speakers = iou_only.iter().map(|segment| segment.speaker).collect::<BTreeSet<_>>();
        assert_eq!(iou_speakers.len(), 2, "{iou_only:?}");

        // 接入声纹后：两段嵌入相同 → 约束层次聚类合成同一个全局身份。
        let mut embed = |audio: &[f32]| {
            assert!(audio.len() >= MIN_EMBEDDING_SAMPLES);
            Some(vec![1.0_f32, 0.0])
        };
        let clustered = diarize_with(
            &samples,
            &PyannoteOptions::default(),
            &mut PyannoteCallbacks::default(),
            infer(),
            Some(&mut embed),
        )
        .unwrap();
        let speakers = clustered.iter().map(|segment| segment.speaker).collect::<BTreeSet<_>>();
        assert_eq!(speakers, BTreeSet::from([0]), "{clustered:?}");
        assert!(clustered.iter().any(|segment| segment.start < 1.0));
        assert!(clustered.iter().any(|segment| segment.end > 34.0));
    }

    /// 一段跨越多个归属区的连续语音必须作为一段整体输出，不能被裁剪切碎。
    #[test]
    fn continuous_speech_survives_ownership_zone_clipping() {
        let step_seconds = STEP_SAMPLES as f64 / SAMPLE_RATE as f64;
        let windows = (0..4)
            .map(|index| {
                let mut window = blank_window(index * STEP_SAMPLES);
                for frame in 0..FRAMES_PER_WINDOW {
                    let time = index as f64 * step_seconds + frame as f64 * WINDOW_SECONDS / FRAMES_PER_WINDOW as f64;
                    if (2.0..12.0).contains(&time) {
                        window.probabilities[0][frame] = 1.0;
                        window.tracks[0][frame] = true;
                    }
                }
                window
            })
            .collect::<Vec<_>>();
        let mappings = stitch_window_speakers(&windows, None);
        let segments = render_segments(&windows, &mappings, 25 * SAMPLE_RATE);
        assert_eq!(segments.len(), 1, "{segments:?}");
        assert!((segments[0].start - 2.0).abs() < 0.05, "{segments:?}");
        assert!((segments[0].end - 12.0).abs() < 0.05, "{segments:?}");
    }

    #[test]
    fn speaker_cap_drops_the_quietest_cluster_when_chunks_conflict() {
        // 同一个 chunk 里的两个单元互斥、永远合不掉；cap=1 时必须靠时长排序
        // 把短的那个丢掉，而不是输出两个说话人。
        let assignment = vec![0, 1];
        let seconds = vec![9.0, 0.4];
        let keep = surviving_clusters(&assignment, &seconds, Some(1)).expect("超限");
        assert_eq!(keep, BTreeSet::from([0]));
        assert!(surviving_clusters(&assignment, &seconds, Some(2)).is_none());
        assert!(surviving_clusters(&assignment, &seconds, None).is_none());
    }
}
