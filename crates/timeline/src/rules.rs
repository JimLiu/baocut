//! 跨表面共享的文档判据——**唯一真身**。
//!
//! 2026-09-16 全局审计发现「旧式文档 / 分离文档」「原声在哪」「成片有多长」三条
//! 规则在内核各 crate、App、Web 里各有一份实现，口径互相漂移（无 `main` 对象时
//! 有的算旧式有的算元素文档；原声有的排除 `hasAudio:false` 有的不排；成片长度有的
//! 按源时钟有的按元素）。三条规则从此只在这里定义，各处只负责把自己手里的类型
//! （`TimelineDocument` / 编辑器投影 / 原始 JSON）投成规则的入参：
//!
//! - [`legacy_main`]：文档有没有**特权主轨**。没标 `main.detached`，且真的有一条
//!   主轨片段序列——显式 `clips[]`，或 arrange 为有时长的 `main` 源合成的隐式整段
//!   clip。空白项目（`main` 缺席 / `null`、没有 clips、没有主媒体）**不是**旧式
//!   文档而是纯元素文档：所有轨平等，没有主视频也没有主音频。
//! - [`content_end`]：成片长度。分离 / 纯元素文档只由元素的显式末端决定（空则 0）；
//!   旧式文档是主轨片段与元素末端的并集。
//! - [`original_audio`]：原声在哪。旧式文档在 `main.muted`；其余文档 = 时间轴上
//!   **每一个** `kind:"video"` 元素自带的声音（任何轨、任何 `srcId`），源明确标了
//!   `hasAudio:false` 的除外；分离出来的 `kind:"audio"` 元素是普通音轨，不算原声。
use crate::arrange::TimelineProjection;
use crate::schema::{ElementKind, TimeValue, TimelineDocument};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

// ---------------------------------------------------------------------------
// 旧式特权主轨
// ---------------------------------------------------------------------------

/// 文档有没有旧式特权主轨：没标 `detached`，且真的有主轨片段（显式或隐式）。
pub fn legacy_main(detached: bool, has_main_clips: bool) -> bool {
    !detached && has_main_clips
}

/// 原始 JSON（`timeline.json` 或 studio 投影）的 `main.detached`。
pub fn detached_json(timeline: &Value) -> bool {
    timeline
        .pointer("/main/detached")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// 原始 JSON 上的 [`legacy_main`]。`main_duration` 是主媒体时长（arrange 会为
/// 有时长的 `main` 源合成隐式整段 clip）；调用方不知道就传 0，那就只认显式
/// `clips[]`。
pub fn legacy_main_json(timeline: &Value, main_duration: f64) -> bool {
    let has_clips = timeline
        .get("clips")
        .and_then(Value::as_array)
        .is_some_and(|clips| !clips.is_empty());
    legacy_main(
        detached_json(timeline),
        has_clips || (main_duration.is_finite() && main_duration > 0.0),
    )
}

impl TimelineDocument {
    /// `main.detached` 已经标上（主视频已拆成普通元素）。
    pub fn is_detached(&self) -> bool {
        self.main.as_ref().is_some_and(|main| main.detached)
    }

    /// [`legacy_main`]，只认显式 `clips[]`（没有投影时的判据）。
    pub fn has_legacy_main(&self) -> bool {
        legacy_main(self.is_detached(), !self.clips.is_empty())
    }

    /// [`legacy_main`]，认投影里的片段（含 arrange 合成的隐式整段 clip）。
    pub fn has_legacy_main_with(&self, projection: &TimelineProjection) -> bool {
        legacy_main(self.is_detached(), !projection.clips().is_empty())
    }
}

// ---------------------------------------------------------------------------
// 成片长度
// ---------------------------------------------------------------------------

/// 成片长度。`element_ends` 是元素的显式末端（`end: None` / 词锚 / 非有限值不算，
/// 它们跟随片尾、不能反过来延长片尾）；`clip_ends` 是主轨片段的时间轴末端，只在
/// 旧式文档参与。隐藏 / 静音不改变排布长度。
pub fn content_end(
    legacy: bool,
    element_ends: impl IntoIterator<Item = f64>,
    clip_ends: impl IntoIterator<Item = f64>,
) -> f64 {
    let elements_end = element_ends
        .into_iter()
        .filter(|end| end.is_finite())
        .fold(0.0, f64::max)
        .max(0.0);
    if !legacy {
        return elements_end;
    }
    clip_ends
        .into_iter()
        .filter(|end| end.is_finite())
        .fold(elements_end, f64::max)
}

impl TimelineDocument {
    fn element_ends(&self) -> impl Iterator<Item = f64> + '_ {
        self.tracks
            .iter()
            .flat_map(|track| track.elements.iter())
            .filter_map(|element| match element.end {
                Some(TimeValue::Seconds(end)) => Some(end),
                _ => None,
            })
    }

    /// [`content_end`]：主轨片段的末端就是投影时长。
    pub fn content_end(&self, projection: &TimelineProjection) -> f64 {
        content_end(
            self.has_legacy_main_with(projection),
            self.element_ends(),
            [projection.duration()],
        )
    }
}

// ---------------------------------------------------------------------------
// 原声
// ---------------------------------------------------------------------------

/// 一个可能承载原声的元素，由调用方从自己的类型投出来。
#[derive(Debug, Clone, Copy)]
pub struct AudioCarrier<'a> {
    pub id: &'a str,
    /// `kind == "video"`。
    pub video: bool,
    /// 源登记的 `hasAudio`；未登记 / 未知按有声算。
    pub source_has_audio: Option<bool>,
    pub hidden: bool,
    pub muted: bool,
    pub track_hidden: bool,
    pub track_muted: bool,
}

/// 原声在哪、开没开。
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalAudio {
    /// 旧式文档：原声是主轨，开关位在 `main.muted`，`element_ids` 为空。
    pub legacy_main: bool,
    /// 有没有原声可开关（没有就不列 `audio` 泳道）。旧式文档恒有。
    pub has: bool,
    /// 原声关着。元素文档 = 没有任何一个承载元素还在出声（元素与所在轨都没
    /// hidden / muted）；没有承载元素时没有声音可出，算关。
    pub muted: bool,
    /// 承载原声的元素 id，文档序。
    pub element_ids: Vec<String>,
}

/// [`OriginalAudio`] 的唯一算法。`legacy_main_muted` 是旧式文档的 `main.muted`
/// （不是旧式文档传 `None`）。
pub fn original_audio<'a>(
    legacy_main_muted: Option<bool>,
    carriers: impl IntoIterator<Item = AudioCarrier<'a>>,
) -> OriginalAudio {
    if let Some(muted) = legacy_main_muted {
        return OriginalAudio {
            legacy_main: true,
            has: true,
            muted,
            element_ids: Vec::new(),
        };
    }
    let mut element_ids = Vec::new();
    let mut audible = false;
    for carrier in carriers {
        if !carrier.video || carrier.source_has_audio == Some(false) {
            continue;
        }
        element_ids.push(carrier.id.to_owned());
        if !(carrier.hidden || carrier.muted || carrier.track_hidden || carrier.track_muted) {
            audible = true;
        }
    }
    OriginalAudio {
        legacy_main: false,
        has: !element_ids.is_empty(),
        muted: !audible,
        element_ids,
    }
}

impl TimelineDocument {
    /// [`original_audio`] on the typed document.
    pub fn original_audio(&self) -> OriginalAudio {
        let legacy = self
            .has_legacy_main()
            .then(|| self.main.as_ref().is_some_and(|main| main.muted));
        original_audio(
            legacy,
            self.tracks.iter().flat_map(|track| {
                track.elements.iter().map(move |element| AudioCarrier {
                    id: &element.id,
                    video: element.kind == ElementKind::Video,
                    source_has_audio: element
                        .src_id
                        .as_deref()
                        .and_then(|id| self.sources.get(id))
                        .and_then(|source| source.has_audio),
                    hidden: element.hidden,
                    muted: element.muted == Some(true),
                    track_hidden: track.hidden,
                    track_muted: track.muted,
                })
            }),
        )
    }
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// [`original_audio`] on raw JSON（`timeline.json` 或 studio 投影；只认显式
/// `clips[]`，见 [`legacy_main_json`]）。
pub fn original_audio_json(timeline: &Value) -> OriginalAudio {
    let legacy = legacy_main_json(timeline, 0.0)
        .then(|| timeline.get("main").is_some_and(|main| flag(main, "muted")));
    let sources = timeline.get("sources");
    original_audio(
        legacy,
        timeline
            .get("tracks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .flat_map(|track| {
                track
                    .get("elements")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(move |element| AudioCarrier {
                        id: element
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        video: element.get("kind").and_then(Value::as_str) == Some("video"),
                        source_has_audio: element
                            .get("srcId")
                            .and_then(Value::as_str)
                            .and_then(|id| sources?.get(id)?.get("hasAudio")?.as_bool()),
                        hidden: flag(element, "hidden"),
                        muted: flag(element, "muted"),
                        track_hidden: flag(track, "hidden"),
                        track_muted: flag(track, "muted"),
                    })
            }),
    )
}

/// 开 / 关原声的唯一写法：旧式文档写 `main.muted`；其余文档写每个承载元素的
/// `muted`，`main.muted`（若有）保持原样——分离文档的 `main.muted` 必须是 true，
/// 否则 `[amain]` 会把同一段声音再混一遍。
pub fn set_original_audio_muted_json(timeline: &mut Value, muted: bool) {
    let audio = original_audio_json(timeline);
    if audio.legacy_main {
        timeline["main"]["muted"] = json!(muted);
        return;
    }
    for track in timeline
        .get_mut("tracks")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        for element in track
            .get_mut("elements")
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            let carries = element
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| audio.element_ids.iter().any(|known| known == id));
            if carries {
                element["muted"] = json!(muted);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 开放式（空白）项目
// ---------------------------------------------------------------------------

/// 开放式项目在内容尾之后保留的可落点空档（秒，原型 `BLANK_TAIL`）：标尺 / scrub
/// 条铺到 `content_end + OPEN_TAIL`，播放头才有地方落到「下一件元素该开始的位置」。
pub const OPEN_TAIL: f64 = 10.0;

/// 开放式项目：没有主轨片段、也没有主媒体——成片时长完全由元素撑出来，没有片尾
/// 可以截断新建元素或播放头。分离文档只要还留着 `clips[]` 源时钟就不是开放式。
pub fn open_ended(has_main_clips: bool, has_main_media: bool) -> bool {
    !has_main_clips && !has_main_media
}

/// 原始 JSON 上的 [`open_ended`]：只认显式 `clips[]`。
pub fn open_ended_json(timeline: &Value, has_main_media: bool) -> bool {
    let has_clips = timeline
        .get("clips")
        .and_then(Value::as_array)
        .is_some_and(|clips| !clips.is_empty());
    open_ended(has_clips, has_main_media)
}

/// 标尺 / scrub 条铺到哪里：开放式项目在内容尾之后多留 [`OPEN_TAIL`]，有片尾的
/// 项目就是片长本身。
pub fn display_duration(content_end: f64, open_ended: bool) -> f64 {
    let base = if content_end.is_finite() {
        content_end.max(0.0)
    } else {
        0.0
    };
    if open_ended { base + OPEN_TAIL } else { base }
}

impl TimelineDocument {
    /// [`open_ended`]：`has_main_media` 由宿主判（项目清单 / `meta.media`）。
    pub fn is_open_ended(&self, has_main_media: bool) -> bool {
        open_ended(!self.clips.is_empty(), has_main_media)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn open_ended_needs_neither_clips_nor_media() {
        assert!(open_ended(false, false));
        assert!(!open_ended(true, false));
        assert!(!open_ended(false, true));
        assert!(open_ended_json(&json!({"main": {"detached": true}}), false));
        assert!(!open_ended_json(
            &json!({"main": {"detached": true}, "clips": [{"id": "c1"}]}),
            false
        ));
        assert_eq!(display_duration(12.0, true), 12.0 + OPEN_TAIL);
        assert_eq!(display_duration(12.0, false), 12.0);
        assert_eq!(display_duration(f64::NAN, true), OPEN_TAIL);
    }

    fn document(value: Value) -> TimelineDocument {
        serde_json::from_value(value).expect("测试文档")
    }

    fn projection(document: &TimelineDocument, main: f64) -> TimelineProjection {
        TimelineProjection::build(document, &BTreeMap::from([("main".to_owned(), main)]))
            .expect("投影")
    }

    /// 空白项目（无 `main`、无 clips、无主媒体）是元素文档；有显式 clips 或隐式
    /// 整段 clip 且没标 detached 才是旧式；标了 detached 永远不是。
    #[test]
    fn legacy_main_needs_a_real_clip_track_and_no_detached_flag() {
        let blank = document(json!({"bcutTimeline": "0.1", "tracks": []}));
        assert!(!blank.has_legacy_main());
        assert!(!blank.has_legacy_main_with(&projection(&blank, 0.0)));
        assert!(!blank.is_detached());
        // 有主媒体：arrange 合成隐式 clip，投影判据认它，纯文档判据不认。
        assert!(blank.has_legacy_main_with(&projection(&blank, 30.0)));
        assert!(!blank.has_legacy_main());

        let clips = document(json!({"bcutTimeline": "0.1",
            "clips": [{"id": "c1", "srcId": "main", "in": 0.0, "out": 5.0}]}));
        assert!(clips.has_legacy_main());
        let detached = document(json!({"bcutTimeline": "0.1",
            "clips": [{"id": "c1", "srcId": "main", "in": 0.0, "out": 5.0}],
            "main": {"detached": true, "muted": true, "place": {"opacity": 0}}}));
        assert!(detached.is_detached());
        assert!(!detached.has_legacy_main());
        assert!(!detached.has_legacy_main_with(&projection(&detached, 30.0)));

        assert!(!legacy_main_json(&json!({"main": null, "tracks": []}), 0.0));
        assert!(legacy_main_json(&json!({"main": null, "tracks": []}), 30.0));
        assert!(legacy_main_json(&json!({"clips": [{"id": "c1"}]}), 0.0));
        assert!(!legacy_main_json(
            &json!({"clips": [{"id": "c1"}], "main": {"detached": true}}),
            30.0
        ));
    }

    #[test]
    fn content_end_is_elements_only_unless_the_document_has_a_legacy_main() {
        let tracks = json!([{"id": "t", "kind": "overlay", "elements": [
            {"id": "a", "kind": "text", "text": "x", "start": 0.0, "end": 14.0},
            {"id": "b", "kind": "text", "text": "y", "start": 0.0, "end": "~main:w1:end"},
            {"id": "c", "kind": "text", "text": "z", "start": 1.0}
        ]}]);
        let open_ended = document(json!({"bcutTimeline": "0.1", "tracks": tracks}));
        assert_eq!(open_ended.content_end(&projection(&open_ended, 0.0)), 14.0);
        // 隐式整段主轨 30s：旧式文档取并集。
        assert_eq!(open_ended.content_end(&projection(&open_ended, 30.0)), 30.0);
        assert_eq!(open_ended.content_end(&projection(&open_ended, 8.0)), 14.0);
        let detached = document(json!({"bcutTimeline": "0.1", "tracks": tracks,
            "clips": [{"id": "c1", "srcId": "main", "in": 0.0, "out": 30.0}],
            "main": {"detached": true, "muted": true, "place": {"opacity": 0}}}));
        assert_eq!(detached.content_end(&projection(&detached, 30.0)), 14.0);
        assert_eq!(content_end(false, [f64::NAN, -1.0], [99.0]), 0.0);
        assert_eq!(content_end(true, [], [99.0]), 99.0);
    }

    #[test]
    fn original_audio_is_every_audible_video_element_except_silent_sources() {
        let doc = json!({
            "bcutTimeline": "0.1",
            "sources": {"src-b1": {"kind": "video", "hasAudio": true},
                        "src-silent": {"kind": "video", "hasAudio": false}},
            "main": {"detached": true, "muted": true, "place": {"opacity": 0}},
            "tracks": [
                {"id": "tv", "kind": "overlay", "elements": [
                    {"id": "v1", "kind": "video", "srcId": "main", "muted": true},
                    {"id": "b1", "kind": "video", "srcId": "src-b1"},
                    {"id": "s1", "kind": "video", "srcId": "src-silent"},
                    {"id": "t1", "kind": "text", "text": "x"}
                ]},
                {"id": "ta", "kind": "audio", "elements": [
                    {"id": "a1", "kind": "audio", "srcId": "src-b1"}
                ]}
            ]
        });
        let expected = OriginalAudio {
            legacy_main: false,
            has: true,
            muted: false,
            element_ids: vec!["v1".into(), "b1".into()],
        };
        assert_eq!(original_audio_json(&doc), expected);
        assert_eq!(
            document(doc.clone()).original_audio(),
            expected,
            "两种入参同一答案"
        );

        let mut off = doc.clone();
        set_original_audio_muted_json(&mut off, true);
        assert_eq!(off["tracks"][0]["elements"][1]["muted"], json!(true));
        assert_eq!(
            off["tracks"][0]["elements"][2].get("muted"),
            None,
            "静音源不写"
        );
        assert_eq!(
            off["tracks"][1]["elements"][0].get("muted"),
            None,
            "分离音轨不是原声"
        );
        assert_eq!(off["main"]["muted"], json!(true));
        assert!(original_audio_json(&off).muted);
        set_original_audio_muted_json(&mut off, false);
        assert_eq!(
            off["main"]["muted"],
            json!(true),
            "分离文档的 main.muted 不动"
        );
        assert!(!original_audio_json(&off).muted);

        // 整轨静音 ⇒ 关；没有承载元素 ⇒ 没有原声、算关。
        let mut track_muted = doc.clone();
        track_muted["tracks"][0]["muted"] = json!(true);
        assert!(original_audio_json(&track_muted).muted);
        let none = json!({"main": {"detached": true, "muted": true}, "tracks": []});
        assert_eq!(
            original_audio_json(&none),
            OriginalAudio {
                legacy_main: false,
                has: false,
                muted: true,
                element_ids: vec![]
            }
        );
    }

    #[test]
    fn legacy_documents_keep_their_audio_on_main_and_blank_projects_do_not() {
        let mut legacy = json!({"bcutTimeline": "0.1",
            "clips": [{"id": "c1", "srcId": "main", "in": 0.0, "out": 5.0}],
            "main": {"muted": true},
            "tracks": [{"id": "tv", "kind": "overlay", "elements": [
                {"id": "v1", "kind": "video", "srcId": "main"}]}]});
        let audio = original_audio_json(&legacy);
        assert!(audio.legacy_main && audio.has && audio.muted);
        assert!(audio.element_ids.is_empty());
        assert_eq!(document(legacy.clone()).original_audio(), audio);
        set_original_audio_muted_json(&mut legacy, false);
        assert_eq!(legacy["main"]["muted"], json!(false));
        assert_eq!(legacy["tracks"][0]["elements"][0].get("muted"), None);

        // `main` 对象在但没有 clips、没有主媒体：空白项目，原声在元素上。
        let blank = json!({"main": {}, "tracks": [{"id": "tv", "kind": "overlay", "elements": [
            {"id": "v1", "kind": "video", "srcId": "src-x"}]}]});
        let audio = original_audio_json(&blank);
        assert!(!audio.legacy_main);
        assert_eq!(audio.element_ids, vec!["v1".to_owned()]);
        let no_video = json!({"main": null, "tracks": []});
        assert!(!original_audio_json(&no_video).has);
    }
}
