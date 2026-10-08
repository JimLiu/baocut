use crate::arrange::TimelineProjection;

/// §2.3 clampEvent 的规范阈值：折叠后保留不足 10ms 的事件片段丢弃。
/// Rust/JS/Swift 三端与所有调用方都必须消费同一常量，不得各自内联。
pub const MIN_EVENT_DURATION: f64 = 0.01;

#[derive(Debug, Clone, PartialEq)]
pub struct MappedEvent {
    pub clip_id: String,
    pub src_id: String,
    pub source_start: f64,
    pub source_end: f64,
    pub timeline_start: f64,
    pub timeline_end: f64,
}

impl TimelineProjection {
    /// Maps one source-clock event through cuts and every clip reuse. Each kept fragment
    /// is returned independently so subtitle and export callers never bridge a removed gap.
    pub fn clamp_source_event(
        &self,
        src_id: &str,
        start: f64,
        end: f64,
        minimum_duration: f64,
    ) -> Vec<MappedEvent> {
        if !start.is_finite() || !end.is_finite() || start >= end {
            return Vec::new();
        }
        let minimum_duration = minimum_duration.max(0.0);
        let mut mapped = Vec::new();
        for clip in self.clips().iter().filter(|clip| clip.src_id == src_id) {
            let first = clip
                .segments
                .partition_point(|segment| segment.source_end <= start);
            for segment in clip.segments[first..]
                .iter()
                .take_while(|segment| segment.source_start < end)
            {
                let source_start = start.max(segment.source_start);
                let source_end = end.min(segment.source_end);
                let source_duration = source_end - source_start;
                if source_duration / clip.rate < minimum_duration {
                    continue;
                }
                mapped.push(MappedEvent {
                    clip_id: clip.id.clone(),
                    src_id: src_id.to_owned(),
                    source_start,
                    source_end,
                    timeline_start: segment.timeline_start
                        + (source_start - segment.source_start) / clip.rate,
                    timeline_end: segment.timeline_start
                        + (source_end - segment.source_start) / clip.rate,
                });
            }
        }
        mapped
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::arrange::TimelineProjection;
    use crate::schema::{Clip, Cut, Source, TimelineDocument};

    fn projection() -> TimelineProjection {
        let document = TimelineDocument {
            sources: BTreeMap::from([(
                "main".to_owned(),
                Source {
                    cuts: vec![
                        Cut {
                            id: "cut-1".to_owned(),
                            t0: 0.0,
                            t1: 2.0,
                            r#ref: None,
                        },
                        Cut {
                            id: "cut-2".to_owned(),
                            t0: 4.0,
                            t1: 6.0,
                            r#ref: None,
                        },
                        Cut {
                            id: "cut-3".to_owned(),
                            t0: 8.0,
                            t1: 10.0,
                            r#ref: None,
                        },
                    ],
                    ..Source::default()
                },
            )]),
            clips: vec![Clip {
                id: "c1".to_owned(),
                src_id: "main".to_owned(),
                in_time: 0.0,
                out: 10.0,
                rate: 1.0,
            }],
            ..TimelineDocument::default()
        };
        TimelineProjection::build(&document, &BTreeMap::from([("main".to_owned(), 10.0)])).unwrap()
    }

    // Migrated from VoiceInk CutTimelineMapTests into BaoCut's two-layer mapping model.
    #[test]
    fn leading_middle_and_trailing_cuts_map_events_without_bridging_gaps() {
        let projection = projection();
        assert_eq!(projection.duration(), 4.0);
        let events = projection.clamp_source_event("main", 1.0, 7.0, 0.01);
        assert_eq!(
            events
                .iter()
                .map(|event| (event.timeline_start, event.timeline_end))
                .collect::<Vec<_>>(),
            vec![(0.0, 2.0), (2.0, 3.0)]
        );
        assert!(
            projection
                .clamp_source_event("main", 4.2, 5.8, 0.01)
                .is_empty()
        );
        assert!(
            projection
                .clamp_source_event("main", 8.2, 9.8, 0.01)
                .is_empty()
        );
    }

    #[test]
    fn material_reuse_emits_one_event_per_clip_placement() {
        let mut document = TimelineDocument::default();
        document.clips = vec![
            Clip {
                id: "c1".to_owned(),
                src_id: "main".to_owned(),
                in_time: 0.0,
                out: 2.0,
                rate: 1.0,
            },
            Clip {
                id: "c2".to_owned(),
                src_id: "main".to_owned(),
                in_time: 0.0,
                out: 2.0,
                rate: 1.0,
            },
        ];
        let projection =
            TimelineProjection::build(&document, &BTreeMap::from([("main".to_owned(), 2.0)]))
                .unwrap();
        let events = projection.clamp_source_event("main", 0.5, 1.5, 0.01);
        assert_eq!(
            events
                .iter()
                .map(|event| (event.timeline_start, event.timeline_end))
                .collect::<Vec<_>>(),
            vec![(0.5, 1.5), (2.5, 3.5)]
        );
    }
}
