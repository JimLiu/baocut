use crate::schema::{Cut, TimelineError};

pub const CUT_MERGE_GAP: f64 = 0.02;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeamBias {
    Preceding,
    Following,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KeptSpan {
    pub source_start: f64,
    pub source_end: f64,
    pub view_start: f64,
}

impl KeptSpan {
    pub fn duration(self) -> f64 {
        self.source_end - self.source_start
    }

    pub fn view_end(self) -> f64 {
        self.view_start + self.duration()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CutSet {
    duration: f64,
    cuts: Vec<Cut>,
    removed_before: Vec<f64>,
    kept_spans: Vec<KeptSpan>,
}

impl CutSet {
    pub fn new(duration: f64, cuts: Vec<Cut>) -> Result<Self, TimelineError> {
        if !duration.is_finite() || duration < 0.0 {
            return Err(TimelineError::Invalid("source duration 非法".to_owned()));
        }

        let mut previous_end = 0.0;
        let mut view_start = 0.0;
        let mut removed = 0.0;
        let mut removed_before = Vec::with_capacity(cuts.len() + 1);
        removed_before.push(0.0);
        let mut kept_spans = Vec::with_capacity(cuts.len() + 1);
        for cut in &cuts {
            if !cut.t0.is_finite()
                || !cut.t1.is_finite()
                || cut.t0 < previous_end
                || cut.t1 <= cut.t0
                || cut.t1 > duration
            {
                return Err(TimelineError::Invalid(format!(
                    "cut {} 必须排序、互不重叠且位于 source 时长内",
                    cut.id
                )));
            }
            if cut.t0 > previous_end {
                kept_spans.push(KeptSpan {
                    source_start: previous_end,
                    source_end: cut.t0,
                    view_start,
                });
                view_start += cut.t0 - previous_end;
            }
            removed += cut.t1 - cut.t0;
            removed_before.push(removed);
            previous_end = cut.t1;
        }
        if previous_end < duration {
            kept_spans.push(KeptSpan {
                source_start: previous_end,
                source_end: duration,
                view_start,
            });
        }

        Ok(Self {
            duration,
            cuts,
            removed_before,
            kept_spans,
        })
    }

    pub fn empty(duration: f64) -> Result<Self, TimelineError> {
        Self::new(duration, Vec::new())
    }

    pub fn duration(&self) -> f64 {
        self.duration
    }

    pub fn cuts(&self) -> &[Cut] {
        &self.cuts
    }

    pub fn kept_spans(&self) -> &[KeptSpan] {
        &self.kept_spans
    }

    pub fn view_duration(&self) -> f64 {
        self.kept_spans.last().map_or(0.0, |span| span.view_end())
    }

    pub fn removed_duration(&self) -> f64 {
        self.duration - self.view_duration()
    }

    pub fn contains_cut(&self, source_time: f64) -> bool {
        self.cut_index_containing(source_time, 0.0).is_some()
    }

    /// §3.3-4：词的剪切状态是派生量——词中点落入某 cut 区间（半开 `[t0, t1)`）即被剪。
    /// 全仓唯一判定入口；锚点求值、投影、翻译可见词都必须走这里。
    pub fn word_is_cut(&self, word_start: f64, word_end: f64) -> bool {
        self.contains_cut((word_start + word_end) / 2.0)
    }

    pub fn contains_cut_interior(&self, source_time: f64, inset: f64) -> bool {
        if !source_time.is_finite() || !inset.is_finite() || inset < 0.0 {
            return false;
        }
        let index = self
            .cuts
            .partition_point(|cut| cut.t0 + inset < source_time);
        index > 0
            && source_time > self.cuts[index - 1].t0 + inset
            && source_time < self.cuts[index - 1].t1 - inset
    }

    pub fn cut_end_containing(&self, source_time: f64, leading_tolerance: f64) -> Option<f64> {
        self.cut_index_containing(source_time, leading_tolerance.max(0.0))
            .map(|index| self.cuts[index].t1)
    }

    pub fn contains_cut_range(&self, start: f64, end: f64, tolerance: f64) -> bool {
        if !start.is_finite() || !end.is_finite() || start > end || !tolerance.is_finite() {
            return false;
        }
        let tolerance = tolerance.max(0.0);
        let index = self.cuts.partition_point(|cut| cut.t0 - tolerance <= start);
        index > 0 && end <= self.cuts[index - 1].t1 + tolerance
    }

    /// Maps a kept source instant into the collapsed media-view clock.
    /// Cut intervals are half-open: `[t0, t1)` has no mapping, while `t1` is kept.
    pub fn view_time(&self, source_time: f64) -> Option<f64> {
        if !source_time.is_finite() || source_time < 0.0 || source_time > self.duration {
            return None;
        }
        if self.contains_cut(source_time) {
            return None;
        }
        Some(self.view_time_at_seam(source_time))
    }

    /// Collapses a source instant even when it lies in a cut. This is the common seam
    /// coordinate used for clip endpoints and UI geometry.
    pub fn view_time_at_seam(&self, source_time: f64) -> f64 {
        if !source_time.is_finite() {
            return 0.0;
        }
        let source_time = source_time.clamp(0.0, self.duration);
        let completed = self.cuts.partition_point(|cut| cut.t1 <= source_time);
        let mut removed = self.removed_before[completed];
        if let Some(cut) = self.cuts.get(completed)
            && source_time >= cut.t0
        {
            removed += source_time - cut.t0;
        }
        source_time - removed
    }

    pub fn source_time(&self, view_time: f64, bias: SeamBias) -> f64 {
        if !view_time.is_finite() {
            return 0.0;
        }
        let view_time = view_time.clamp(0.0, self.view_duration());
        if self.kept_spans.is_empty() {
            return match bias {
                SeamBias::Preceding => 0.0,
                SeamBias::Following => self.duration,
            };
        }

        let next = self
            .kept_spans
            .partition_point(|span| span.view_end() < view_time);
        if let Some(span) = self.kept_spans.get(next) {
            if view_time > span.view_start && view_time < span.view_end() {
                return span.source_start + (view_time - span.view_start);
            }
            if view_time == span.view_start {
                return match bias {
                    SeamBias::Following => span.source_start,
                    SeamBias::Preceding if next > 0 => self.kept_spans[next - 1].source_end,
                    SeamBias::Preceding => 0.0,
                };
            }
            if view_time == span.view_end() {
                if bias == SeamBias::Following {
                    if let Some(following) = self.kept_spans.get(next + 1)
                        && following.view_start == view_time
                    {
                        return following.source_start;
                    }
                    if span.source_end < self.duration {
                        return self.duration;
                    }
                }
                return span.source_end;
            }
        }
        self.duration
    }

    pub fn kept_intersections(
        &self,
        start: f64,
        end: f64,
        minimum_duration: f64,
    ) -> Vec<(f64, f64)> {
        if !start.is_finite() || !end.is_finite() || start >= end {
            return Vec::new();
        }
        let start = start.clamp(0.0, self.duration);
        let end = end.clamp(0.0, self.duration);
        let minimum_duration = minimum_duration.max(0.0);
        let first = self
            .kept_spans
            .partition_point(|span| span.source_end <= start);
        self.kept_spans[first..]
            .iter()
            .take_while(|span| span.source_start < end)
            .filter_map(|span| {
                let kept_start = start.max(span.source_start);
                let kept_end = end.min(span.source_end);
                let duration = kept_end - kept_start;
                (duration > 0.0 && duration >= minimum_duration).then_some((kept_start, kept_end))
            })
            .collect()
    }

    fn cut_index_containing(&self, source_time: f64, leading_tolerance: f64) -> Option<usize> {
        if !source_time.is_finite() {
            return None;
        }
        let index = self
            .cuts
            .partition_point(|cut| cut.t0 - leading_tolerance <= source_time);
        if index == 0 {
            return None;
        }
        let candidate = index - 1;
        (source_time < self.cuts[candidate].t1).then_some(candidate)
    }
}

pub fn insert_cut(
    cuts: &mut Vec<Cut>,
    mut incoming: Cut,
    duration: f64,
) -> Result<Cut, TimelineError> {
    if !duration.is_finite()
        || !incoming.t0.is_finite()
        || !incoming.t1.is_finite()
        || incoming.t0 < 0.0
        || incoming.t1 <= incoming.t0
        || incoming.t1 > duration
    {
        return Err(TimelineError::Invalid(format!(
            "cut {} 区间非法",
            incoming.id
        )));
    }
    cuts.push(incoming.clone());
    cuts.sort_by(|left, right| {
        left.t0
            .total_cmp(&right.t0)
            .then(left.t1.total_cmp(&right.t1))
    });

    let mut merged = Vec::<Cut>::with_capacity(cuts.len());
    for cut in cuts.drain(..) {
        if let Some(previous) = merged.last_mut()
            && cut.t0 - previous.t1 <= CUT_MERGE_GAP
        {
            previous.t1 = previous.t1.max(cut.t1);
            if cut.t0 < incoming.t0 {
                incoming.id = previous.id.clone();
                incoming.r#ref = previous.r#ref.clone();
            }
            if previous.id == incoming.id || cut.id == incoming.id {
                incoming = previous.clone();
            }
            continue;
        }
        merged.push(cut);
    }
    *cuts = merged;
    CutSet::new(duration, cuts.clone())?;
    cuts.iter()
        .find(|cut| cut.id == incoming.id || (cut.t0 <= incoming.t0 && cut.t1 >= incoming.t1))
        .cloned()
        .ok_or_else(|| TimelineError::Invalid("cut 合并结果缺失".to_owned()))
}

pub fn restore_cut(cuts: &mut Vec<Cut>, id: &str) -> bool {
    let previous_len = cuts.len();
    cuts.retain(|cut| cut.id != id);
    cuts.len() != previous_len
}

/// 改一个剪口的源区间，`id` 与 `ref`（出处）原样保留。
///
/// - 找不到 `id` → `Ok(None)`（调用方报 `not_found`）；
/// - 新区间须 `0 ≤ t0 < t1 ≤ duration`，且不与同源其它剪口重叠（与 [`CutSet::new`] 同判据：
///   贴边 `t0 == 前一个.t1` 允许）；不合法 → `Err(Invalid)`，`cuts` 不动；
/// - 成功 → `Ok(Some(改之前的那个剪口))`。区间没变也算成功（调用方据旧值判断）。
///
/// 不做 [`insert_cut`] 那样的相邻合并：两边的剪口各有各的 id 与出处，拖边贴上邻居
/// 不该把邻居吞掉。
pub fn retime_cut(
    cuts: &mut [Cut],
    id: &str,
    t0: f64,
    t1: f64,
    duration: f64,
) -> Result<Option<Cut>, TimelineError> {
    let Some(index) = cuts.iter().position(|cut| cut.id == id) else {
        return Ok(None);
    };
    if !duration.is_finite()
        || !t0.is_finite()
        || !t1.is_finite()
        || t0 < 0.0
        || t1 <= t0
        || t1 > duration
    {
        return Err(TimelineError::Invalid(format!("cut {id} 区间非法")));
    }
    if let Some(other) = cuts
        .iter()
        .enumerate()
        .find(|(other, cut)| *other != index && cut.t0 < t1 && t0 < cut.t1)
        .map(|(_, cut)| cut)
    {
        return Err(TimelineError::Invalid(format!(
            "cut {id} 的新区间与 cut {} 重叠",
            other.id
        )));
    }
    let previous = cuts[index].clone();
    cuts[index].t0 = t0;
    cuts[index].t1 = t1;
    cuts.sort_by(|left, right| {
        left.t0
            .total_cmp(&right.t0)
            .then(left.t1.total_cmp(&right.t1))
    });
    Ok(Some(previous))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cut(id: &str, t0: f64, t1: f64) -> Cut {
        Cut {
            id: id.to_owned(),
            t0,
            t1,
            r#ref: None,
        }
    }

    // Migrated from VoiceInk ClipPartitionIndexTests, expressed in BaoCut's source-cut layer.
    #[test]
    fn collapsed_projection_preserves_half_open_cuts_and_seam_direction() {
        let set = CutSet::new(30.0, vec![cut("cut", 10.0, 20.0)]).unwrap();
        assert_eq!(set.view_duration(), 20.0);
        assert_eq!(
            set.kept_spans()
                .iter()
                .map(|span| span.source_start)
                .collect::<Vec<_>>(),
            vec![0.0, 20.0]
        );
        assert!(!set.contains_cut(9.999));
        assert!(set.contains_cut(10.0));
        assert!(set.contains_cut(19.999));
        assert!(!set.contains_cut(20.0));
        assert_eq!(set.view_time(5.0), Some(5.0));
        assert_eq!(set.view_time(15.0), None);
        assert_eq!(set.view_time_at_seam(15.0), 10.0);
        assert_eq!(set.view_time(25.0), Some(15.0));
        assert_eq!(set.source_time(10.0, SeamBias::Preceding), 10.0);
        assert_eq!(set.source_time(10.0, SeamBias::Following), 20.0);
        assert_eq!(set.source_time(10.25, SeamBias::Following), 20.25);
        assert_eq!(set.source_time(50.0, SeamBias::Following), 30.0);

        let trailing = CutSet::new(30.0, vec![cut("tail", 20.0, 30.0)]).unwrap();
        assert_eq!(trailing.source_time(20.0, SeamBias::Preceding), 20.0);
        assert_eq!(trailing.source_time(20.0, SeamBias::Following), 30.0);
    }

    #[test]
    fn playback_tolerance_and_range_queries_match_voiceink_boundaries() {
        let set = CutSet::new(30.0, vec![cut("cut", 10.0, 20.0)]).unwrap();
        assert_eq!(set.cut_end_containing(9.998, 0.001), None);
        assert_eq!(set.cut_end_containing(9.9995, 0.001), Some(20.0));
        assert_eq!(set.cut_end_containing(20.0, 0.001), None);
        assert!(!set.contains_cut_interior(10.01, 0.01));
        assert!(set.contains_cut_interior(10.02, 0.01));
        assert!(set.contains_cut_range(9.995, 20.005, 0.01));
        assert!(!set.contains_cut_range(9.989, 20.0, 0.01));
    }

    #[test]
    fn kept_intersections_exclude_cut_only_and_short_windows() {
        let set = CutSet::new(30.0, vec![cut("cut", 10.0, 20.0)]).unwrap();
        assert_eq!(
            set.kept_intersections(9.0, 21.0, 0.01),
            vec![(9.0, 10.0), (20.0, 21.0)]
        );
        assert!(set.kept_intersections(12.0, 18.0, 0.01).is_empty());
        assert!(set.kept_intersections(9.995, 10.0, 0.01).is_empty());
    }

    #[test]
    fn insert_merges_twenty_millisecond_neighbors_and_keeps_earlier_id() {
        let mut cuts = vec![cut("cut-1", 1.0, 2.0), cut("cut-3", 4.0, 5.0)];
        let merged = insert_cut(&mut cuts, cut("cut-2", 2.019, 4.0), 10.0).unwrap();
        assert_eq!(merged.id, "cut-1");
        assert_eq!(cuts, vec![cut("cut-1", 1.0, 5.0)]);
        assert!(restore_cut(&mut cuts, "cut-1"));
        assert!(cuts.is_empty());
    }

    #[test]
    fn retime_keeps_id_and_ref_and_rejects_overlap_or_out_of_range() {
        let mut cuts = vec![
            Cut {
                r#ref: Some("prov-1".to_owned()),
                ..cut("cut-1", 1.0, 2.0)
            },
            cut("cut-2", 4.0, 5.0),
        ];
        let previous = retime_cut(&mut cuts, "cut-1", 0.5, 3.0, 10.0)
            .unwrap()
            .unwrap();
        assert_eq!((previous.t0, previous.t1), (1.0, 2.0));
        assert_eq!(cuts[0].id, "cut-1");
        assert_eq!(cuts[0].r#ref.as_deref(), Some("prov-1"));
        assert_eq!((cuts[0].t0, cuts[0].t1), (0.5, 3.0));
        // 贴边允许、不合并：两个剪口各自保留。
        retime_cut(&mut cuts, "cut-1", 0.5, 4.0, 10.0)
            .unwrap()
            .unwrap();
        assert_eq!(cuts.len(), 2);
        CutSet::new(10.0, cuts.clone()).unwrap();
        // 重叠、越界、空区间都拒绝，且不改动。
        let before = cuts.clone();
        assert!(retime_cut(&mut cuts, "cut-1", 0.5, 4.1, 10.0).is_err());
        assert!(retime_cut(&mut cuts, "cut-2", 4.0, 10.5, 10.0).is_err());
        assert!(retime_cut(&mut cuts, "cut-2", -0.1, 0.2, 10.0).is_err());
        assert!(retime_cut(&mut cuts, "cut-2", 6.0, 6.0, 10.0).is_err());
        assert_eq!(cuts, before);
        assert_eq!(retime_cut(&mut cuts, "nope", 6.0, 7.0, 10.0).unwrap(), None);
        // 越过邻居挪到另一侧（不重叠）后仍按 t0 排序。
        retime_cut(&mut cuts, "cut-1", 6.0, 7.0, 10.0)
            .unwrap()
            .unwrap();
        assert_eq!(cuts[0].id, "cut-2");
        assert_eq!(cuts[1].id, "cut-1");
    }
}
