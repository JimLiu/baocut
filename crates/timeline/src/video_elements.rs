//! One-time conversion of the legacy base video to normal, independently editable elements.
//! Clips are retained solely as the source-to-transcript clock. Conversion is deterministic,
//! so a read can expose the normalized document before the next normal edit persists it.
use crate::schema::TimeValue;
use crate::{ElementKind, TimelineDocument, TimelineError, TimelineProjection};
use serde_json::json;
use std::collections::{BTreeMap, HashSet};

/// 「源末端落在记下的主源时长上」的判等窗：远小于一帧，又盖得住帧量化与合成总长的
/// 浮点尾数（同一稿子 IR 总长 `73.8333` 与成片探测 `73.833375` 差 7.5e-5）。
const FOLLOW_EPS: f64 = 1e-3;

pub fn detach_main_video(
    document: &mut TimelineDocument,
    durations: &BTreeMap<String, f64>,
    widths: &BTreeMap<String, f64>,
) -> Result<bool, TimelineError> {
    if document.is_detached() {
        return Ok(false);
    }
    let projection = TimelineProjection::build(document, durations)?;
    if projection.clips().is_empty() {
        return Ok(false);
    }
    let old = serde_json::to_value(&document.main).expect("timeline serialization");
    let mut used: HashSet<String> = document
        .sources
        .keys()
        .cloned()
        .chain(document.clips.iter().map(|clip| clip.id.clone()))
        .chain(
            document
                .sources
                .values()
                .flat_map(|source| source.cuts.iter().map(|cut| cut.id.clone())),
        )
        .chain(document.tracks.iter().flat_map(|track| {
            std::iter::once(track.id.clone()).chain(track.elements.iter().map(|el| el.id.clone()))
        }))
        .collect();
    let mut claim = |base: &str| {
        let mut id = base.to_owned();
        let mut suffix = 2;
        while !used.insert(id.clone()) {
            id = format!("{base}-{suffix}");
            suffix += 1;
        }
        id
    };
    let track_id = claim("video-track");
    let mut elements = Vec::new();
    for clip in projection.clips() {
        for (index, segment) in clip.segments.iter().enumerate() {
            let mut place = old
                .get("place")
                .filter(|v| v.is_object())
                .cloned()
                .unwrap_or(json!({}));
            let scale = place["scale"].as_f64().unwrap_or(1.0);
            if let Some(sy) = place["scaleY"].as_f64() {
                place["scaleY"] = json!(sy / scale.max(0.000001));
            }
            place["w"] = json!(widths.get(&clip.src_id).copied().unwrap_or(100.0));
            elements.push(picture_json(
                &claim(&format!("video-{}-{}", clip.id, index + 1)),
                &clip.src_id,
                (
                    segment.source_start,
                    segment.timeline_start,
                    segment.timeline_end,
                ),
                clip.rate,
                old["muted"].as_bool().unwrap_or(false),
                old["background"].as_str().unwrap_or("black"),
                place,
            ));
        }
    }
    let track = serde_json::from_value(json!({"id":track_id,"kind":"overlay","elements":elements}))
        .map_err(|error| TimelineError::Invalid(error.to_string()))?;
    let mut next = document.clone();
    next.tracks.insert(0, track);
    // Keep the legacy base invisible and silent for every existing rendering/audio consumer.
    next.main = Some(
        serde_json::from_value(json!({"detached":true,"muted":true,
        "place":{"opacity":0},"background":"black",
        "sourceDuration":durations.get("main").copied().filter(|d| d.is_finite() && *d > 0.0)}))
        .expect("valid disabled main"),
    );
    next.validate()?;
    *document = next;
    Ok(true)
}

/// 分离出来的一件片段画面：`(srcStart, start, end)` 取自片段投影的一段。
fn picture_json(
    id: &str,
    src_id: &str,
    (src_start, start, end): (f64, f64, f64),
    rate: f64,
    muted: bool,
    background: &str,
    place: serde_json::Value,
) -> serde_json::Value {
    json!({"id":id, "kind":"video", "srcId":src_id, "srcStart":src_start,
        "start":start, "end":end, "rate":rate, "muted":muted, "volume":1.0,
        "mode":"pip", "fit":"contain", "bg":background, "place":place})
}

/// 分离文档里新加的片段按分离的缺省新建的画面（跟随规则 2）：有声、`place.w` 取源的宽度。
pub fn default_picture_element(
    id: &str,
    src_id: &str,
    src_start: f64,
    start: f64,
    end: f64,
    rate: f64,
    width: f64,
) -> crate::Element {
    serde_json::from_value(picture_json(
        id,
        src_id,
        (src_start, start, end),
        rate,
        false,
        "black",
        json!({"w": width}),
    ))
    .expect("valid default picture element")
}

/// 主源时长变了，让「一直放到主源末尾」的 main 视频元素跟到新末尾。
///
/// 分离文档里的视频元素是拆分那一刻按当时的主源时长落下的；动画项目的主源是现场合成，
/// 作者改稿重渲一次时长就变，不对账的话成片会停在旧长度、尾巴被截掉（旁白同步是动画
/// 项目最常见的第一笔元素写入，拆分就发生在那时）。`main.sourceDuration` 记着这份排布
/// 对齐的主源时长：源末端（`srcStart + (end − start) × rate`）正好落在它上面的元素改到
/// 新末端，剪短过的不动；然后把记录刷成当前值。
///
/// 读时归一化（同 `fold_main_duplicates`）：纯内存，下一次写事务一并落盘；记录跟着
/// 文档走，撤销回旧文档再读也按当时的记录对账。只做分离文档；`current` 不是正有限值
/// （没有主媒体、合成还没算出来）时什么都不改，免得一个看不见合成的进程把记录写成 0。
/// 返回文档有没有变。
pub fn follow_main_duration(document: &mut TimelineDocument, current: f64) -> bool {
    if !document.is_detached() || !current.is_finite() || current <= 0.0 {
        return false;
    }
    let Some(main) = document.main.as_mut() else {
        return false;
    };
    let recorded = main.source_duration;
    if recorded.is_some_and(|recorded| (recorded - current).abs() < FOLLOW_EPS) {
        return false;
    }
    main.source_duration = Some(current);
    let Some(recorded) = recorded else {
        return true;
    };
    for element in document
        .tracks
        .iter_mut()
        .flat_map(|track| track.elements.iter_mut())
    {
        if element.kind != ElementKind::Video || element.src_id.as_deref() != Some("main") {
            continue;
        }
        let (Some(TimeValue::Seconds(start)), Some(TimeValue::Seconds(end))) =
            (&element.start, &element.end)
        else {
            continue;
        };
        let (start, end) = (*start, *end);
        let rate = element.rate.filter(|rate| *rate > 0.0).unwrap_or(1.0);
        let src_start = element.src_start.unwrap_or(0.0);
        if (src_start + (end - start) * rate - recorded).abs() >= FOLLOW_EPS {
            continue;
        }
        let next = start + (current - src_start) / rate;
        if next > start + FOLLOW_EPS {
            element.end = Some(TimeValue::Seconds(next));
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conversion_preserves_cuts_rates_and_source_clock_and_never_resurrects_deleted_video() {
        let mut doc: TimelineDocument = serde_json::from_value(json!({"bcutTimeline":"0.4",
            "sources":{"main":{"cuts":[{"id":"cut-1","t0":2,"t1":4}]}},
            "clips":[{"id":"c1","in":0,"out":10,"rate":2}],
            "main":{"muted":false,"place":{"scale":0.5,"scaleY":0.8,"rot":20,"opacity":0.7}}
        }))
        .unwrap();
        let durations = BTreeMap::from([("main".into(), 10.0)]);
        let before = TimelineProjection::build(&doc, &durations).unwrap();
        assert!(detach_main_video(&mut doc, &durations, &BTreeMap::new()).unwrap());
        let json = serde_json::to_value(&doc).unwrap();
        let els = json["tracks"][0]["elements"].as_array().unwrap();
        assert_eq!(els.len(), 2);
        assert_eq!(els[0]["end"], 1.0);
        assert_eq!(els[1]["srcStart"], 4.0);
        assert_eq!(els[1]["start"], 1.0);
        assert_eq!(els[1]["end"], 4.0);
        assert_eq!(els[1]["rate"], 2.0);
        assert_eq!(els[1]["place"]["scaleY"], 1.6);
        assert_eq!(els[1]["place"]["opacity"], 0.7);
        assert_eq!(
            TimelineProjection::build(&doc, &durations).unwrap().clips(),
            before.clips()
        );
        doc.tracks.clear();
        assert!(!detach_main_video(&mut doc, &durations, &BTreeMap::new()).unwrap());
        assert!(doc.tracks.is_empty());
    }

    fn ends(doc: &TimelineDocument) -> Vec<f64> {
        doc.tracks[0]
            .elements
            .iter()
            .map(|el| match el.end {
                Some(TimeValue::Seconds(end)) => end,
                _ => f64::NAN,
            })
            .collect()
    }

    /// 动画项目：拆分那一刻合成 60 s，重渲成 70 s / 50 s，放到头的视频元素跟着走；
    /// 旁边一条剪短过的（末端不在记录上）不动；撤销回拆分时的文档再读，照样对上当前长度。
    #[test]
    fn detached_video_that_ran_to_the_source_end_follows_a_rerendered_composition() {
        let mut doc: TimelineDocument =
            serde_json::from_value(json!({"bcutTimeline":"0.4"})).unwrap();
        let durations = BTreeMap::from([("main".into(), 60.0)]);
        assert!(detach_main_video(&mut doc, &durations, &BTreeMap::new()).unwrap());
        assert_eq!(doc.main.as_ref().unwrap().source_duration, Some(60.0));
        let trimmed: crate::Element = serde_json::from_value(json!({"id":"cut-short",
            "kind":"video","srcId":"main","srcStart":10,"start":0,"end":20}))
        .unwrap();
        doc.tracks[0].elements.push(trimmed);
        let detached_at_60 = doc.clone();

        assert!(!follow_main_duration(&mut doc, 60.0000001));
        assert!(follow_main_duration(&mut doc, 70.0));
        assert_eq!(ends(&doc), vec![70.0, 20.0]);
        assert_eq!(doc.main.as_ref().unwrap().source_duration, Some(70.0));
        doc.validate().unwrap();
        assert!(!follow_main_duration(&mut doc, 70.0));

        assert!(follow_main_duration(&mut doc, 50.0));
        assert_eq!(ends(&doc), vec![50.0, 20.0]);

        let mut undone = detached_at_60;
        assert!(follow_main_duration(&mut undone, 50.0));
        assert_eq!(ends(&undone), vec![50.0, 20.0]);
    }

    /// 变速与分割：末段按 rate 换算源末端；没有记录的老文档只记下当前值，不猜。
    #[test]
    fn follow_honours_rate_and_leaves_unrecorded_or_legacy_documents_alone() {
        let mut doc: TimelineDocument = serde_json::from_value(json!({"bcutTimeline":"0.4",
        "main":{"detached":true,"muted":true,"place":{"opacity":0},"sourceDuration":10},
        "tracks":[{"id":"video-track","kind":"overlay","elements":[
            {"id":"a","kind":"video","srcId":"main","srcStart":0,"start":0,"end":2,"rate":2},
            {"id":"b","kind":"video","srcId":"main","srcStart":4,"start":2,"end":5,"rate":2}
        ]}]}))
        .unwrap();
        assert!(follow_main_duration(&mut doc, 14.0));
        assert_eq!(ends(&doc), vec![2.0, 7.0]);

        let mut old = doc.clone();
        old.main.as_mut().unwrap().source_duration = None;
        assert!(follow_main_duration(&mut old, 20.0));
        assert_eq!(ends(&old), vec![2.0, 7.0]);
        assert_eq!(old.main.as_ref().unwrap().source_duration, Some(20.0));
        assert!(!follow_main_duration(&mut old, 0.0));
        assert_eq!(old.main.as_ref().unwrap().source_duration, Some(20.0));

        let mut legacy: TimelineDocument =
            serde_json::from_value(json!({"bcutTimeline":"0.4"})).unwrap();
        assert!(!follow_main_duration(&mut legacy, 20.0));
        assert!(legacy.main.is_none());
    }
}
