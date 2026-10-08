//! [`crate::host::OverlayHost`] 实现方的共享零件。
//!
//! 为什么需要这一层：本 crate 把 timeline 投影**注入**给 host（纪律二），
//! 但「投影出来的形状」是内核自己规定的——`OverlayRenderPlan` 只读
//! `document.pointer("/timeline/tracks")`，且要求 `start` / `end` 已经从
//! 词锚解析成秒。这条规则如果让每个 host 各写一遍，CLI 与 App v2 就会有
//! 两份锚解析：同一个项目，导出把元素放在 12.31 s，预览放在 12.28 s，
//! 而两边都「没报错」。D2 的原话是「CLI 与 App 各有一份在任何时刻都不允许」。
//!
//! 所以这里放的是 host 的**共享实现**而不是 host 本身：
//! - [`word_timings_from_transcripts`]：转录稿 → 词时序表（锚解析的输入）。
//! - [`tracks_with_resolved_anchors`]：`tracks` 序列化 ＋ 词锚 → 秒。
//!
//! 仍留在各 host 自己手里的，是**从哪儿把文档读起来**（CLI 走
//! `ProjectTimeline`／`IdAllocator`／`HistoryStore`，App v2 M1 只做只读装载），
//! 那部分随 D2 第三刀的 `bcut-workspace` 才统一。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{Map, Value, json};
use speech_doc::doc::TranscriptDoc;
use timeline::schema::{TimeValue, WhiteboardBeat};
use timeline::{TimelineDocument, TimelineProjection, WordTiming, resolve_word_anchor};

/// `source id → 该源的词时序`。`main` 取 `transcript.json`，附加源取
/// `transcripts/<src>.json`。
pub type WordTimings = BTreeMap<String, Vec<WordTiming>>;

/// 读项目下所有可用转录稿，投影成词锚解析所需的时序表。
///
/// 缺文件不是错误（附加源常常没有自己的转录稿，主源也可能还没转录）——
/// 该源就没有可解析的词锚，交给 [`tracks_with_resolved_anchors`] 报具体
/// 的 anchor 错误，而不是在这里把整次投影打回。
pub fn word_timings_from_transcripts(
    project: &Path,
    document: &TimelineDocument,
) -> Result<WordTimings> {
    let mut source_ids = BTreeSet::from(["main".to_owned()]);
    source_ids.extend(document.sources.keys().cloned());
    let mut result = WordTimings::new();
    for source_id in source_ids {
        let path = if source_id == "main" {
            project.join("transcript.json")
        } else {
            project
                .join("transcripts")
                .join(format!("{source_id}.json"))
        };
        if !path.is_file() {
            continue;
        }
        let doc = TranscriptDoc::from_json(
            &fs::read(&path).with_context(|| format!("读取 {}", path.display()))?,
        )
        .map_err(|error| anyhow::anyhow!("{} 无效：{error:#}", path.display()))?;
        result.insert(
            source_id,
            doc.words
                .iter()
                .map(|word| WordTiming {
                    id: word.id.clone(),
                    t0: word.t0,
                    t1: word.t1,
                    hidden: doc.hidden.get(&word.id).copied().unwrap_or(false),
                })
                .collect(),
        );
    }
    Ok(result)
}

/// `document.tracks` 的投影：原样序列化，再把 `start` / `end` 的词锚解析成秒。
///
/// 返回 `(tracks, anchorErrors)`。约定与内核的读取口径一一对应：
/// - `start` 缺省为 `0.0`，`end` 缺省为**内容尾**：`projection.duration()` 与
///   文档里所有数值 `end` 的最大值取大（第 168 轮 / 第 216 轮：空白项目没有
///   主素材，`endAnchor` 类跟着元素撑出来的成片尾走，而不是塌成 0 长）；
/// - 词锚解析成功写回同名字段，并把原锚保留在 `startAnchor` / `endAnchor`；白板拍的
///   原锚保留在元素级 `whiteboardBeatAnchors[]`（`index / at / end / error`）；
/// - 解析失败把字段置 `null` 并写 `startError` / `endError`，同时汇总进
///   第二个返回值。内核见到 `start` 不是数字就跳过该元素并留一条 warning，
///   **不会**把整帧渲成黑屏——这正是「坏锚不该炸掉整个预览」的落点。
/// - 白板 `whiteboard.beats[].at` / `end`（0.9）的词锚同样在这里解析：成片秒减元素
///   `start` 写回本地秒；任一端解析失败**整拍剔除**（它的 box 里的笔画退回几何顺序），
///   错误报到 `field: "whiteboard.beats[i].at|end"`；元素 `start` 自己没解析出来时
///   元素整个被跳过，节拍不另报。
pub fn tracks_with_resolved_anchors(
    document: &TimelineDocument,
    projection: &TimelineProjection,
    words: &WordTimings,
) -> (Value, Vec<Value>) {
    let mut tracks = serde_json::to_value(&document.tracks).expect("tracks serialize");
    let mut errors = Vec::new();
    // 内容尾走内核唯一规则（`TimelineDocument::content_end`）：分离 / 纯元素文档只由
    // 元素决定，旧式文档是主轨与元素的并集。
    let content_end = document.content_end(projection);
    for (track_index, track) in document.tracks.iter().enumerate() {
        for (element_index, element) in track.elements.iter().enumerate() {
            let output = &mut tracks[track_index]["elements"][element_index];
            for (field, value, fallback) in [
                ("start", element.start.as_ref(), 0.0),
                ("end", element.end.as_ref(), content_end),
            ] {
                match value {
                    Some(TimeValue::Anchor(anchor)) => {
                        output[format!("{field}Anchor")] = json!(anchor);
                        match resolve_word_anchor(anchor, projection, words) {
                            Ok(time) => output[field] = json!(time),
                            Err(error) => {
                                output[field] = Value::Null;
                                output[format!("{field}Error")] = json!({
                                    "code": error.code(),
                                    "message": error.to_string(),
                                });
                                errors.push(json!({
                                    "code": error.code(),
                                    "trackId": track.id,
                                    "elementId": element.id,
                                    "field": field,
                                    "anchor": anchor,
                                    "message": error.to_string(),
                                }));
                            }
                        }
                    }
                    Some(TimeValue::Seconds(time)) => output[field] = json!(time),
                    None => output[field] = json!(fallback),
                }
            }
            let Some(beats) = element
                .whiteboard
                .as_ref()
                .and_then(|props| props.beats.as_ref())
                .filter(|beats| beats.iter().any(WhiteboardBeat::is_anchored))
            else {
                continue;
            };
            let start_secs = output["start"].as_f64();
            let mut kept = Vec::with_capacity(beats.len());
            let mut anchors = Vec::new();
            for (index, beat) in beats.iter().enumerate() {
                let mut resolved = serde_json::to_value(beat).expect("beat serialize");
                let mut record = json!({"index": index});
                let mut failure: Option<String> = None;
                for (field, value) in [("at", Some(&beat.at)), ("end", beat.end.as_ref())] {
                    let Some(TimeValue::Anchor(anchor)) = value else {
                        continue;
                    };
                    record[field] = json!(anchor);
                    match resolve_word_anchor(anchor, projection, words) {
                        Ok(time) => match start_secs {
                            Some(start) => resolved[field] = json!((time - start).max(0.0)),
                            None => {
                                failure.get_or_insert_with(|| {
                                    "元素 start 自己没有解析出来".to_owned()
                                });
                            }
                        },
                        Err(error) => {
                            failure.get_or_insert_with(|| error.to_string());
                            errors.push(json!({
                                "code": error.code(),
                                "trackId": track.id,
                                "elementId": element.id,
                                "field": format!("whiteboard.beats[{index}].{field}"),
                                "anchor": anchor,
                                "message": error.to_string(),
                            }));
                        }
                    }
                }
                if record.as_object().map_or(0, Map::len) > 1 {
                    if let Some(message) = &failure {
                        record["error"] = json!(message);
                    }
                    anchors.push(record);
                }
                if failure.is_none() {
                    kept.push(resolved);
                }
            }
            output["whiteboard"]["beats"] = Value::Array(kept);
            // 原锚保留在元素级 `whiteboardBeatAnchors`（同 `startAnchor` 的约定）：
            // 薄视图据此认「跟旁白」的拍并列出解析失败的拍；渲染前由 `render_plan` 剥掉。
            output["whiteboardBeatAnchors"] = Value::Array(anchors);
        }
    }
    (tracks, errors)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(tracks: Value) -> TimelineDocument {
        serde_json::from_value(json!({
            "bcutTimeline": "0.1",
            "sources": {},
            "clips": [],
            "tracks": tracks,
        }))
        .unwrap()
    }

    fn projection(document: &TimelineDocument, duration: f64) -> TimelineProjection {
        projection_of(document, duration)
    }

    fn projection_of(document: &TimelineDocument, duration: f64) -> TimelineProjection {
        TimelineProjection::build(document, &BTreeMap::from([("main".to_owned(), duration)]))
            .unwrap()
    }

    #[test]
    fn missing_bounds_fall_back_to_zero_and_duration() {
        let document = document(json!([{
            "id": "tr-1",
            "kind": "overlay",
            "elements": [{"id": "el-1", "kind": "text", "text": "hi"}],
        }]));
        let projection = projection(&document, 30.0);
        let (tracks, errors) =
            tracks_with_resolved_anchors(&document, &projection, &WordTimings::new());

        assert!(errors.is_empty());
        let element = &tracks[0]["elements"][0];
        assert_eq!(element["start"], json!(0.0));
        assert_eq!(element["end"], json!(30.0));
    }

    /// 第 216 轮：空白项目片长 0，`endAnchor` 类跟着其他元素撑出的内容尾走。
    #[test]
    fn missing_end_follows_the_content_end_when_the_film_is_open_ended() {
        let document = document(json!([{
            "id": "tr-1",
            "kind": "overlay",
            "elements": [
                {"id": "el-1", "kind": "text", "text": "hi"},
                {"id": "el-2", "kind": "text", "text": "later", "start": 4.0, "end": 14.0},
            ],
        }]));
        let projection = projection(&document, 0.0);
        let (tracks, errors) =
            tracks_with_resolved_anchors(&document, &projection, &WordTimings::new());
        assert!(errors.is_empty());
        assert_eq!(tracks[0]["elements"][0]["end"], json!(14.0));
        // 有片长时片长仍是下限：内容尾不会把 30s 的片压短。
        let projection = projection_of(&document, 30.0);
        let (tracks, _) = tracks_with_resolved_anchors(&document, &projection, &WordTimings::new());
        assert_eq!(tracks[0]["elements"][0]["end"], json!(30.0));
    }

    /// 0.9：白板节拍的词锚解析成**元素本地秒**；解析不到的拍整拍剔除并报到
    /// `whiteboard.beats[i].at|end`，元素与其余拍照旧。
    #[test]
    fn whiteboard_beat_anchors_resolve_to_local_seconds_and_bad_beats_are_dropped() {
        let document: TimelineDocument = serde_json::from_value(json!({
            "bcutTimeline": "0.9",
            "sources": {"board": {"path": "media/board.png", "kind": "image"}},
            "clips": [],
            "tracks": [{
            "id": "tr-1",
            "kind": "overlay",
            "elements": [{
                "id": "wb",
                "kind": "whiteboard",
                "srcId": "board",
                "start": "~main:w1:start",
                "end": 20.0,
                "whiteboard": {"draw": 6.0, "pace": "natural", "beats": [
                    {"at": "~main:w1:start", "end": "~main:w1:end", "box": [0, 0, 50, 100], "label": "一"},
                    {"at": "~main:w9:start", "box": [50, 0, 50, 100]},
                    {"at": 3.0, "end": "~main:w2:end", "box": [0, 50, 100, 50]}
                ]}
            }],
        }]}))
        .unwrap();
        let projection = TimelineProjection::build(
            &document,
            &BTreeMap::from([("main".to_owned(), 30.0), ("board".to_owned(), 0.0)]),
        )
        .unwrap();
        let words = WordTimings::from([(
            "main".to_owned(),
            vec![
                WordTiming {
                    id: "w1".into(),
                    t0: 1.0,
                    t1: 2.5,
                    hidden: false,
                },
                WordTiming {
                    id: "w2".into(),
                    t0: 2.5,
                    t1: 5.0,
                    hidden: false,
                },
            ],
        )]);
        let (tracks, errors) = tracks_with_resolved_anchors(&document, &projection, &words);
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0]["elementId"], json!("wb"));
        assert_eq!(errors[0]["field"], json!("whiteboard.beats[1].at"));
        assert_eq!(errors[0]["anchor"], json!("~main:w9:start"));
        let element = &tracks[0]["elements"][0];
        assert_eq!(element["start"], json!(1.0));
        let beats = element["whiteboard"]["beats"].as_array().unwrap();
        assert_eq!(beats.len(), 2);
        assert_eq!(beats[0]["at"], json!(0.0));
        assert_eq!(beats[0]["end"], json!(1.5));
        assert_eq!(beats[0]["label"], json!("一"));
        assert_eq!(beats[1]["at"], json!(3.0));
        assert_eq!(beats[1]["end"], json!(4.0));
        assert_eq!(element["whiteboard"]["pace"], json!("natural"));
        // 解析后的形状仍能读回 WhiteboardProps（不带多余键）。
        let props: timeline::WhiteboardProps =
            serde_json::from_value(element["whiteboard"].clone()).unwrap();
        assert_eq!(props.beats.unwrap()[0].end_local(), Some(1.5));
        // 原锚留在元素级 `whiteboardBeatAnchors`：三拍都带锚，第 2 拍带 error。
        let anchors = element["whiteboardBeatAnchors"].as_array().unwrap();
        assert_eq!(anchors.len(), 3);
        assert_eq!(anchors[0]["index"], json!(0));
        assert_eq!(anchors[0]["at"], json!("~main:w1:start"));
        assert_eq!(anchors[0]["end"], json!("~main:w1:end"));
        assert!(anchors[0].get("error").is_none());
        assert_eq!(anchors[1]["index"], json!(1));
        assert!(anchors[1]["error"].is_string());
        assert_eq!(anchors[2]["index"], json!(2));
        assert!(anchors[2].get("at").is_none());
        assert_eq!(anchors[2]["end"], json!("~main:w2:end"));
    }

    #[test]
    fn word_anchors_resolve_to_seconds_and_keep_the_anchor() {
        let document = document(json!([{
            "id": "tr-1",
            "kind": "overlay",
            "elements": [{
                "id": "el-1",
                "kind": "text",
                "text": "hi",
                "start": "~main:w2:start",
                "end": "~main:w2:end",
            }],
        }]));
        let projection = projection(&document, 30.0);
        let words = WordTimings::from([(
            "main".to_owned(),
            vec![
                WordTiming {
                    id: "w1".into(),
                    t0: 0.0,
                    t1: 1.0,
                    hidden: false,
                },
                WordTiming {
                    id: "w2".into(),
                    t0: 2.5,
                    t1: 3.25,
                    hidden: false,
                },
            ],
        )]);

        let (tracks, errors) = tracks_with_resolved_anchors(&document, &projection, &words);

        assert!(errors.is_empty(), "意外的 anchor 错误：{errors:?}");
        let element = &tracks[0]["elements"][0];
        assert_eq!(element["start"], json!(2.5));
        assert_eq!(element["end"], json!(3.25));
        // 原锚必须留着：authoring 字段是真相，秒是派生投影。
        assert_eq!(element["startAnchor"], json!("~main:w2:start"));
    }

    #[test]
    fn an_unresolvable_anchor_nulls_the_field_and_reports_once() {
        let document = document(json!([{
            "id": "tr-1",
            "kind": "overlay",
            "elements": [{
                "id": "el-1",
                "kind": "text",
                "text": "hi",
                "start": "~main:gone:start",
            }],
        }]));
        let projection = projection(&document, 30.0);
        let (tracks, errors) =
            tracks_with_resolved_anchors(&document, &projection, &WordTimings::new());

        assert_eq!(errors.len(), 1, "每个坏锚一条：{errors:?}");
        assert_eq!(errors[0]["elementId"], json!("el-1"));
        assert_eq!(errors[0]["field"], json!("start"));
        let element = &tracks[0]["elements"][0];
        assert!(element["start"].is_null());
        assert!(element["startError"]["code"].is_string());
    }

    #[test]
    fn transcripts_load_per_source_and_missing_files_are_not_errors() {
        let project = tempfile::tempdir().unwrap();
        fs::write(
            project.path().join("transcript.json"),
            serde_json::to_vec(&json!({
                "bcutTranscript": "0.3",
                "media": {"path": "main.mp4", "hash": "deadbeef", "duration": 10.0},
                "lang": "en",
                "engine": {"name": "test", "alignedWords": true},
                "speakers": {"s1": {"name": "S1"}},
                "words": [
                    {"id": "w1", "t0": 0.0, "t1": 0.5, "text": "hello", "sp": "s1"},
                    {"id": "w2", "t0": 0.5, "t1": 1.0, "text": "world", "sp": "s1"},
                ],
            }))
            .unwrap(),
        )
        .unwrap();
        let document = document(json!([]));

        let words = word_timings_from_transcripts(project.path(), &document).unwrap();

        assert_eq!(words.len(), 1, "只有 main 有转录稿");
        assert_eq!(words["main"].len(), 2);
        assert_eq!(words["main"][1].id, "w2");
    }
}
