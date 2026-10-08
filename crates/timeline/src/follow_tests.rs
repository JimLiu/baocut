use super::*;
use crate::arrange::{add_clip, move_clip, remove_clips, set_clip_rate, split_clip, trim_clip};
use crate::cuts::{insert_cut, restore_cut};
use crate::schema::{Clip, Cut, Source};
use serde_json::{Value, json};

const MAIN: f64 = 12.0;

fn durations() -> BTreeMap<String, f64> {
    BTreeMap::from([("main".to_owned(), MAIN), ("b".to_owned(), 30.0)])
}

fn doc(value: Value) -> TimelineDocument {
    serde_json::from_value(value).expect("timeline fixture")
}

/// `det.bcut` 的形状：源 12 秒、一件 0–12 秒的分离画面，外加一件压在 2–4 上的 B-roll、
/// 一件词锚点文字、一条通铺配乐、一件不设终点的角标。
fn detached() -> TimelineDocument {
    doc(json!({
        "bcutTimeline": "0.11",
        "sources": {"b": {"path": "b.mp4", "kind": "video", "duration": 30.0}},
        "main": {"detached": true, "muted": true, "place": {"opacity": 0}, "background": "black", "sourceDuration": MAIN},
        "tracks": [
            {"id": "video-track", "kind": "overlay", "elements": [
                {"id": "video-c1-1", "kind": "video", "srcId": "main", "srcStart": 0.0, "start": 0.0, "end": MAIN,
                 "rate": 1.0, "muted": false, "volume": 1.0, "mode": "pip", "fit": "contain", "bg": "black",
                 "place": {"w": 100.0}, "fx": {"blur": 2.0}}
            ]},
            {"id": "tr-overlay", "kind": "overlay", "elements": [
                {"id": "broll", "kind": "video", "role": "broll", "srcId": "b", "srcStart": 5.0, "start": 1.0, "end": 3.0},
                {"id": "broll-inside", "kind": "video", "role": "broll", "srcId": "b", "srcStart": 0.0, "start": 2.25, "end": 3.75},
                {"id": "broll-late", "kind": "video", "role": "broll", "srcId": "b", "srcStart": 0.0, "start": 3.0, "end": 6.0},
                {"id": "words", "kind": "text", "start": "~main:w1:start", "end": "~main:w2:end", "text": "anchored"},
                {"id": "badge", "kind": "text", "start": 1.0, "text": "open"}
            ]},
            {"id": "tr-music", "kind": "audio", "elements": [
                {"id": "music", "kind": "audio", "srcId": "b", "srcStart": 0.0, "start": 0.0, "end": MAIN}
            ]}
        ]
    }))
}

fn cut(id: &str, t0: f64, t1: f64) -> Cut {
    Cut {
        id: id.to_owned(),
        t0,
        t1,
        r#ref: None,
    }
}

fn ids() -> impl FnMut() -> String {
    let mut minted = 0;
    move || {
        minted += 1;
        format!("el-{minted}")
    }
}

/// 一项写入：先按 `op` 改时钟，再以这一项之前的时钟为基准跟随。
fn step(
    document: &mut TimelineDocument,
    next_id: &mut dyn FnMut() -> String,
    edit: ClockEdit,
    op: impl FnOnce(&mut TimelineDocument),
) -> FollowReport {
    let before = clock_snapshot(document);
    op(document);
    follow_clock(
        &before,
        document,
        &durations(),
        &BTreeMap::new(),
        &edit,
        next_id,
    )
    .expect("follow")
}

fn add_cuts(document: &mut TimelineDocument, cuts: &[(&str, f64, f64)]) {
    let source = document.sources.entry("main".to_owned()).or_default();
    for (id, t0, t1) in cuts {
        insert_cut(&mut source.cuts, cut(id, *t0, *t1), MAIN).unwrap();
    }
}

fn element<'a>(document: &'a TimelineDocument, id: &str) -> &'a Element {
    document
        .tracks
        .iter()
        .flat_map(|track| &track.elements)
        .find(|element| element.id == id)
        .unwrap_or_else(|| panic!("element {id} missing"))
}

fn has(document: &TimelineDocument, id: &str) -> bool {
    document
        .tracks
        .iter()
        .flat_map(|track| &track.elements)
        .any(|element| element.id == id)
}

fn span(element: &Element) -> (Option<f64>, Option<f64>, Option<f64>) {
    (
        seconds(&element.start),
        seconds(&element.end),
        element.src_start,
    )
}

/// 画面：`(start, end, srcStart)`，按成片时间排序。
fn pictures_of(document: &TimelineDocument) -> Vec<(f64, f64, f64)> {
    let mut out: Vec<(f64, f64, f64)> = document.tracks[0]
        .elements
        .iter()
        .map(|element| {
            (
                seconds(&element.start).unwrap(),
                seconds(&element.end).unwrap(),
                element.src_start.unwrap(),
            )
        })
        .collect();
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out
}

/// 画面对源的覆盖：合并后的 `[源起, 源止)` 列表。
fn coverage(document: &TimelineDocument) -> Vec<(f64, f64)> {
    let mut spans: Vec<(f64, f64)> = pictures_of(document)
        .into_iter()
        .map(|(start, end, src)| (src, src + (end - start)))
        .collect();
    spans.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (s0, s1) in spans {
        match merged.last_mut() {
            Some(last) if s0 <= last.1 + 1e-9 => last.1 = last.1.max(s1),
            _ => merged.push((s0, s1)),
        }
    }
    merged
}

fn content_end(document: &TimelineDocument) -> f64 {
    let projection = TimelineProjection::build(document, &durations()).unwrap();
    document.content_end(&projection)
}

fn bytes(document: &TimelineDocument, id: &str) -> String {
    serde_json::to_string(element(document, id)).unwrap()
}

/// 实测缺陷：分离文档上剪 2–4，画面仍是 0–12、导出 12 秒。跟随之后画面覆盖 0–2（源 0–2）
/// 与 2–10（源 4–12），内容末尾 10 秒；恢复这处剪口回到 0–12 的覆盖。
#[test]
fn cutting_a_detached_document_takes_the_picture_along_and_restore_brings_it_back() {
    let mut document = detached();
    let mut next_id = ids();
    let original_coverage = coverage(&document);
    assert_eq!(content_end(&document), 12.0);

    let report = step(&mut document, &mut next_id, ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-1", 2.0, 4.0)])
    });
    assert_eq!(
        pictures_of(&document),
        vec![(0.0, 2.0, 0.0), (2.0, 10.0, 4.0)]
    );
    assert_eq!(content_end(&document), 10.0);
    let picture = element(&document, "video-c1-1");
    assert_eq!(span(picture), (Some(0.0), Some(2.0), Some(0.0)));
    assert_eq!(picture.fx, element(&document, "el-1").fx, "属性原样保留");
    assert_eq!(
        report.created,
        vec![FollowCreated {
            id: "el-1".to_owned(),
            from: Some("video-c1-1".to_owned()),
            clip_id: Some("c1".to_owned()),
        }]
    );
    assert!(report.retimed.contains(&"video-c1-1".to_owned()));

    let report = step(&mut document, &mut next_id, ClockEdit::Retime, |d| {
        assert!(restore_cut(
            &mut d.sources.get_mut("main").unwrap().cuts,
            "cut-1"
        ));
    });
    assert_eq!(coverage(&document), original_coverage);
    assert_eq!(
        pictures_of(&document),
        vec![(0.0, 4.0, 0.0), (4.0, 12.0, 4.0)],
        "不自动合并相邻两件"
    );
    assert_eq!(content_end(&document), 12.0);
    assert!(report.removed.is_empty() && report.created.is_empty());
}

/// B-roll 按规则缩短 / 删除 / 推后并同步 `srcStart`；词锚点与不设终点的逐字节不变；
/// 通铺配乐在剪口时缩短。
#[test]
fn numeric_elements_shorten_drop_or_advance_and_anchors_stay_put() {
    let mut document = detached();
    let words = bytes(&document, "words");
    let badge = bytes(&document, "badge");
    let report = step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-1", 2.0, 4.0)])
    });
    assert_eq!(
        span(element(&document, "broll")),
        (Some(1.0), Some(2.0), Some(5.0))
    );
    assert!(!has(&document, "broll-inside"));
    assert_eq!(report.removed, vec!["broll-inside".to_owned()]);
    // 起点 3 落在剪口里：推到 4（推后 1 秒），srcStart 同步前移 1 秒。
    assert_eq!(
        span(element(&document, "broll-late")),
        (Some(2.0), Some(4.0), Some(1.0))
    );
    assert_eq!(
        span(element(&document, "music")),
        (Some(0.0), Some(10.0), Some(0.0))
    );
    assert_eq!(bytes(&document, "words"), words);
    assert_eq!(bytes(&document, "badge"), badge);
    for id in ["broll", "broll-late", "music"] {
        assert!(report.retimed.contains(&id.to_owned()), "{id}");
    }
}

fn two_clips() -> TimelineDocument {
    let mut document = detached();
    document.clips = vec![
        Clip {
            id: "c1".to_owned(),
            src_id: "main".to_owned(),
            in_time: 0.0,
            out: 5.0,
            rate: 1.0,
        },
        Clip {
            id: "c2".to_owned(),
            src_id: "main".to_owned(),
            in_time: 5.0,
            out: 12.0,
            rate: 1.0,
        },
    ];
    let pictures = &mut document.tracks[0].elements;
    let mut second = pictures[0].clone();
    pictures[0].end = Some(TimeValue::Seconds(5.0));
    second.id = "video-c2-1".to_owned();
    second.start = Some(TimeValue::Seconds(5.0));
    second.src_start = Some(5.0);
    pictures.push(second);
    document.tracks[1].elements.push(doc_element(json!(
        {"id": "inside-c2", "kind": "text", "start": 6.0, "end": 8.0, "text": "c2"}
    )));
    document.tracks[1].elements.push(doc_element(json!(
        {"id": "across", "kind": "text", "start": 4.0, "end": 6.0, "text": "seam"}
    )));
    document
}

fn doc_element(value: Value) -> Element {
    serde_json::from_value(value).unwrap()
}

/// 挪片段：画面跟着片段走；起止都在同一片段里的跟着走；跨片段的（通铺配乐、跨缝文字）原地不动。
#[test]
fn moving_a_clip_carries_its_picture_and_contained_elements_only() {
    let mut document = two_clips();
    let music = bytes(&document, "music");
    let across = bytes(&document, "across");
    let report = step(&mut document, &mut ids(), ClockEdit::Move, |d| {
        move_clip(d, "c2", Some("c1"), None, None).unwrap();
    });
    assert_eq!(
        span(element(&document, "video-c2-1")),
        (Some(0.0), Some(7.0), Some(5.0))
    );
    assert_eq!(
        span(element(&document, "video-c1-1")),
        (Some(7.0), Some(12.0), Some(0.0))
    );
    assert_eq!(
        span(element(&document, "inside-c2")),
        (Some(1.0), Some(3.0), None)
    );
    // 起止都在 c1（0–5）里的 B-roll 跟着 c1 挪到 7 之后；跨 c1/c2 缝的 broll-late 不动。
    assert_eq!(
        span(element(&document, "broll")),
        (Some(8.0), Some(10.0), Some(5.0))
    );
    assert_eq!(
        span(element(&document, "broll-inside")),
        (Some(9.25), Some(10.75), Some(0.0))
    );
    assert_eq!(
        span(element(&document, "broll-late")),
        (Some(3.0), Some(6.0), Some(0.0))
    );
    assert_eq!(bytes(&document, "music"), music);
    assert_eq!(bytes(&document, "across"), across);
    assert!(report.created.is_empty() && report.removed.is_empty());
    assert_eq!(report.retimed.len(), 5);
}

/// 删片段：它的画面整件删除并列出；后面的元素涟漪前移。
#[test]
fn removing_a_clip_drops_its_picture_and_ripples_the_rest() {
    let mut document = two_clips();
    let report = step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        remove_clips(d, &durations(), &["c1".to_owned()]).unwrap();
    });
    assert_eq!(pictures_of(&document), vec![(0.0, 7.0, 5.0)]);
    assert!(report.removed.contains(&"video-c1-1".to_owned()));
    assert_eq!(
        span(element(&document, "inside-c2")),
        (Some(1.0), Some(3.0), None)
    );
    assert_eq!(
        span(element(&document, "across")),
        (Some(0.0), Some(1.0), None)
    );
    assert_eq!(
        span(element(&document, "music")),
        (Some(0.0), Some(7.0), Some(5.0)),
        "起点推后，srcStart 同步"
    );
}

/// 分割：画面在缝上切开，右半取新 id 并归到新片段；其它元素沿用现状（切开压在分割点上的）。
#[test]
fn splitting_cuts_the_picture_and_every_numeric_lane_at_the_seam() {
    let mut document = detached();
    let report = step(
        &mut document,
        &mut ids(),
        ClockEdit::Split {
            left: "c1".to_owned(),
            right: "c2".to_owned(),
            at: 5.0,
        },
        |d| {
            split_clip(d, &durations(), 5.0, "c2".to_owned()).unwrap();
        },
    );
    assert_eq!(
        pictures_of(&document),
        vec![(0.0, 5.0, 0.0), (5.0, 12.0, 5.0)]
    );
    assert_eq!(
        report.created[0],
        FollowCreated {
            id: "el-1".to_owned(),
            from: Some("video-c1-1".to_owned()),
            clip_id: Some("c2".to_owned()),
        }
    );
    // 压在缝上的 B-roll 与配乐被切开（右半 srcStart 前进）；缝前的 B-roll 不动。按轨序发 id。
    assert_eq!(
        span(element(&document, "broll-late")),
        (Some(3.0), Some(5.0), Some(0.0))
    );
    assert_eq!(
        span(element(&document, "el-2")),
        (Some(5.0), Some(6.0), Some(2.0))
    );
    assert_eq!(
        span(element(&document, "music")),
        (Some(0.0), Some(5.0), Some(0.0))
    );
    assert_eq!(
        span(element(&document, "el-3")),
        (Some(5.0), Some(12.0), Some(5.0))
    );
    assert_eq!(bytes(&document, "broll"), bytes(&detached(), "broll"));
    assert!(has(&document, "badge") && has(&document, "words"));
}

/// 修剪外扩：新露出的源区间由相邻画面补上（段首由后一件向前补）；用户删过画面的片段不补。
#[test]
fn trimming_outward_extends_the_neighbouring_picture_but_never_resurrects_a_deleted_one() {
    let mut document = detached();
    document.clips = vec![Clip {
        id: "c1".to_owned(),
        src_id: "main".to_owned(),
        in_time: 2.0,
        out: 10.0,
        rate: 1.0,
    }];
    document.tracks[0].elements[0].src_start = Some(2.0);
    document.tracks[0].elements[0].end = Some(TimeValue::Seconds(8.0));
    document.tracks[1].elements.clear();
    document.tracks[2].elements.clear();
    let mut trimmed = document.clone();
    step(&mut trimmed, &mut ids(), ClockEdit::Retime, |d| {
        trim_clip(d, &durations(), "c1", Some(0.0), Some(12.0)).unwrap();
    });
    assert_eq!(pictures_of(&trimmed), vec![(0.0, 12.0, 0.0)]);
    assert_eq!(trimmed.tracks[0].elements[0].id, "video-c1-1");

    // 用户把画面缩到源 2–6：操作前就可见却没画面的 6–10 不补；新露出的 0–2 挨着画面，
    // 由它向前补；新露出的 10–12 隔着旧空当，照邻件复制一件。
    let mut shortened = document.clone();
    shortened.tracks[0].elements[0].end = Some(TimeValue::Seconds(4.0));
    let report = step(&mut shortened, &mut ids(), ClockEdit::Retime, |d| {
        trim_clip(d, &durations(), "c1", Some(0.0), Some(12.0)).unwrap();
    });
    assert_eq!(
        pictures_of(&shortened),
        vec![(0.0, 6.0, 0.0), (10.0, 12.0, 10.0)]
    );
    assert_eq!(
        report.created,
        vec![FollowCreated {
            id: "el-1".to_owned(),
            from: Some("video-c1-1".to_owned()),
            clip_id: Some("c1".to_owned()),
        }]
    );

    let mut deleted = document.clone();
    deleted.tracks[0].elements.clear();
    step(&mut deleted, &mut ids(), ClockEdit::Retime, |d| {
        trim_clip(d, &durations(), "c1", Some(0.0), Some(12.0)).unwrap();
    });
    assert!(
        deleted.tracks[0].elements.is_empty(),
        "原本就没有画面的片段不补"
    );
}

/// 恢复一处剪口时，隔着用户删过的空当的新露出区间照邻件复制一件，不连带补上删过的部分。
#[test]
fn restoring_across_a_deleted_gap_clones_instead_of_stretching() {
    let mut document = detached();
    document.tracks[1].elements.clear();
    document.tracks[2].elements.clear();
    let mut next_id = ids();
    step(&mut document, &mut next_id, ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-1", 6.0, 8.0)])
    });
    // 用户删掉源 2–4 的画面：留下源 0–2 与源 4–6、8–12。
    let first = element(&document, "video-c1-1").clone();
    let mut left = first.clone();
    left.end = Some(TimeValue::Seconds(2.0));
    let mut middle = first.clone();
    middle.id = "user-middle".to_owned();
    middle.start = Some(TimeValue::Seconds(4.0));
    middle.src_start = Some(4.0);
    let rest: Vec<Element> = document.tracks[0]
        .elements
        .iter()
        .filter(|el| el.id != "video-c1-1")
        .cloned()
        .collect();
    document.tracks[0].elements = [vec![left, middle], rest].concat();
    assert_eq!(
        coverage(&document),
        vec![(0.0, 2.0), (4.0, 6.0), (8.0, 12.0)]
    );

    let report = step(&mut document, &mut next_id, ClockEdit::Retime, |d| {
        restore_cut(&mut d.sources.get_mut("main").unwrap().cuts, "cut-1");
    });
    assert_eq!(coverage(&document), vec![(0.0, 2.0), (4.0, 12.0)]);
    assert!(report.created.is_empty(), "新露出的 6–8 由前一件延长补上");
}

/// 新加的片段按分离缺省新建画面；倍速改时钟时画面的 `rate` 跟上。
#[test]
fn a_new_clip_gets_a_default_picture_and_rate_changes_retime_it() {
    let mut document = detached();
    document.tracks[1].elements.clear();
    document.tracks[2].elements.clear();
    let widths = BTreeMap::from([("b".to_owned(), 56.25)]);
    let before = clock_snapshot(&document);
    add_clip(
        &mut document,
        &durations(),
        "c9".to_owned(),
        "b".to_owned(),
        Some(0.0),
        Some(4.0),
        None,
        None,
    )
    .unwrap();
    let report = follow_clock(
        &before,
        &mut document,
        &durations(),
        &widths,
        &ClockEdit::Retime,
        &mut ids(),
    )
    .unwrap();
    assert_eq!(report.created.len(), 1);
    assert_eq!(report.created[0].from, None);
    assert_eq!(report.created[0].clip_id.as_deref(), Some("c9"));
    let created = element(&document, "el-1");
    assert_eq!(span(created), (Some(12.0), Some(16.0), Some(0.0)));
    assert_eq!(created.src_id.as_deref(), Some("b"));
    assert_eq!(created.place.as_ref().unwrap().w, Some(56.25));

    step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        set_clip_rate(d, &durations(), "c1", 2.0).unwrap();
    });
    let picture = element(&document, "video-c1-1");
    assert_eq!(span(picture), (Some(0.0), Some(6.0), Some(0.0)));
    assert_eq!(picture.rate, Some(2.0));
    assert_eq!(
        span(element(&document, "el-1")),
        (Some(6.0), Some(10.0), Some(0.0))
    );
}

/// 连续多次剪口与一次性剪同一批区间结果一致（画面、B-roll、配乐、新 id 逐字节相同）。
#[test]
fn cutting_one_at_a_time_equals_cutting_the_batch() {
    let cuts = [
        ("cut-1", 1.0, 1.5),
        ("cut-2", 2.5, 3.5),
        ("cut-3", 5.0, 5.2),
        ("cut-4", 9.0, 11.0),
    ];
    let mut sequential = detached();
    let mut next_id = ids();
    for one in cuts {
        step(&mut sequential, &mut next_id, ClockEdit::Retime, |d| {
            add_cuts(d, &[one])
        });
    }
    let mut batch = detached();
    step(&mut batch, &mut ids(), ClockEdit::Retime, |d| {
        add_cuts(d, &cuts)
    });
    assert_eq!(
        serde_json::to_value(&sequential).unwrap(),
        serde_json::to_value(&batch).unwrap()
    );
}

/// 剪了再恢复：画面对源的覆盖回到原状（任意剪口组合、任意恢复顺序）。
#[test]
fn every_cut_then_restore_order_returns_the_original_coverage() {
    let cuts = [
        ("cut-a", 0.5, 1.0),
        ("cut-b", 3.0, 4.5),
        ("cut-c", 6.0, 6.5),
        ("cut-d", 11.0, 12.0),
    ];
    for mask in 1..(1 << cuts.len()) {
        let chosen: Vec<_> = cuts
            .iter()
            .enumerate()
            .filter(|(index, _)| mask & (1 << index) != 0)
            .map(|(_, cut)| *cut)
            .collect();
        let mut document = detached();
        let original = coverage(&document);
        let mut next_id = ids();
        for one in &chosen {
            step(&mut document, &mut next_id, ClockEdit::Retime, |d| {
                add_cuts(d, &[*one])
            });
        }
        for one in chosen.iter().rev() {
            step(&mut document, &mut next_id, ClockEdit::Retime, |d| {
                restore_cut(&mut d.sources.get_mut("main").unwrap().cuts, one.0);
            });
        }
        assert_eq!(coverage(&document), original, "mask {mask:b}");
        assert_eq!(content_end(&document), 12.0, "mask {mask:b}");
    }
}

/// 旧式文档没有画面可认领，其它元素照样跟随（等同原来的删片段涟漪）。
#[test]
fn legacy_documents_ripple_numeric_elements_without_claiming_pictures() {
    let mut document = doc(json!({
        "bcutTimeline": "0.11",
        "sources": {"b": {"path": "b.mp4", "kind": "video", "duration": 30.0}},
        "clips": [
            {"id": "c1", "in": 0.0, "out": 4.0},
            {"id": "c2", "in": 4.0, "out": 6.0},
            {"id": "c3", "in": 6.0, "out": 12.0}
        ],
        "tracks": [
            {"id": "tr-overlays", "kind": "overlay", "elements": [
                {"id": "inside", "kind": "text", "start": 4.5, "end": 5.5, "text": "gone"},
                {"id": "leading", "kind": "text", "start": 3.0, "end": 4.5, "text": "left"},
                {"id": "crossing", "kind": "video", "start": 3.0, "end": 7.0, "srcId": "b"},
                {"id": "later", "kind": "image", "start": 6.5, "end": 7.5, "srcId": "b"},
                {"id": "global", "kind": "text", "text": "all"},
                {"id": "anchored", "kind": "text", "start": "~main:word-a:start", "end": "~main:word-b:end", "text": "words"}
            ]},
            {"id": "tr-inside-only", "kind": "overlay", "elements": [
                {"id": "inside-image", "kind": "image", "start": 4.25, "end": 5.75, "srcId": "b"}
            ]},
            {"id": "tr-empty", "kind": "overlay"}
        ]
    }));
    let report = step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        remove_clips(d, &durations(), &["c2".to_owned()]).unwrap();
    });
    assert_eq!(
        document
            .tracks
            .iter()
            .map(|track| track.id.as_str())
            .collect::<Vec<_>>(),
        vec!["tr-overlays", "tr-empty"],
        "只删被跟随清空的轨"
    );
    assert_eq!(
        report.removed,
        vec!["inside".to_owned(), "inside-image".to_owned()]
    );
    assert_eq!(
        span(element(&document, "leading")),
        (Some(3.0), Some(4.0), None)
    );
    assert_eq!(
        span(element(&document, "crossing")),
        (Some(3.0), Some(5.0), None),
        "跨被删范围的只缩短，不挖洞"
    );
    assert_eq!(
        span(element(&document, "later")),
        (Some(4.5), Some(5.5), None)
    );
    assert_eq!(span(element(&document, "global")), (None, None, None));
    assert!(matches!(
        element(&document, "anchored").start,
        Some(TimeValue::Anchor(_))
    ));
}

/// 超出片尾的部分保持到片尾的距离。
#[test]
fn elements_past_the_clock_end_keep_their_distance_to_it() {
    let mut document = detached();
    document.tracks[1].elements = vec![doc_element(json!(
        {"id": "outro", "kind": "text", "start": 11.0, "end": 14.0, "text": "outro"}
    ))];
    step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-1", 2.0, 4.0)])
    });
    assert_eq!(
        span(element(&document, "outro")),
        (Some(9.0), Some(12.0), None)
    );
}

#[test]
fn reports_merge_across_one_transaction_and_serialize_the_receipt_shape() {
    let mut first = FollowReport {
        removed: vec!["a".to_owned()],
        created: vec![FollowCreated {
            id: "el-1".to_owned(),
            from: Some("v".to_owned()),
            clip_id: Some("c1".to_owned()),
        }],
        retimed: vec!["v".to_owned(), "m".to_owned()],
    };
    first.merge(FollowReport {
        removed: vec!["el-1".to_owned(), "m".to_owned()],
        created: vec![],
        retimed: vec!["v".to_owned(), "x".to_owned()],
    });
    assert_eq!(first.removed, vec!["a".to_owned(), "m".to_owned()]);
    assert!(first.created.is_empty());
    assert_eq!(first.retimed, vec!["v".to_owned(), "x".to_owned()]);
    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        json!({"removed": ["a", "m"], "created": [], "retimed": 2})
    );
}

/// 规模：数小时素材、上千剪口、上万元素是默认场景。5 千剪口 × 5 万元素一次跟随要远低于秒级；
/// 平方算法（2.5 亿次比较）在这个量级上会慢两个数量级。
#[test]
fn following_thousands_of_cuts_and_tens_of_thousands_of_elements_stays_linearithmic() {
    const SOURCE: f64 = 36_000.0;
    let cut_count = 5_000;
    let mut cuts = Vec::with_capacity(cut_count);
    for index in 0..cut_count {
        let t0 = index as f64 * 7.0 + 3.0;
        cuts.push(cut(&format!("cut-{index}"), t0, t0 + 0.5));
    }
    let mut document = doc(json!({
        "bcutTimeline": "0.11",
        "main": {"detached": true, "muted": true, "place": {"opacity": 0}, "background": "black"},
        "tracks": []
    }));
    document.sources.insert(
        "main".to_owned(),
        Source {
            cuts,
            ..Source::default()
        },
    );
    let durations = BTreeMap::from([("main".to_owned(), SOURCE)]);
    let projection = TimelineProjection::build(&document, &durations).unwrap();
    let mut pictures = Vec::new();
    for (index, segment) in projection.clips()[0].segments.iter().enumerate() {
        pictures.push(json!({"id": format!("p{index}"), "kind": "video", "srcId": "main",
            "srcStart": segment.source_start, "start": segment.timeline_start, "end": segment.timeline_end}));
    }
    let mut texts = Vec::new();
    let total = projection.duration();
    for index in 0..45_000 {
        let start = total * index as f64 / 45_000.0;
        texts.push(json!({"id": format!("t{index}"), "kind": "text", "start": start, "end": start + 2.0, "text": "x"}));
    }
    document.tracks = serde_json::from_value(json!([
        {"id": "video-track", "kind": "overlay", "elements": pictures},
        {"id": "texts", "kind": "overlay", "elements": texts}
    ]))
    .unwrap();

    let before = clock_snapshot(&document);
    let started = std::time::Instant::now();
    // 每段中间再剪一刀：5 千处新剪口一次跟随。
    let extra: Vec<Cut> = projection.clips()[0]
        .segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| segment.source_end - segment.source_start > 2.0)
        .map(|(index, segment)| {
            let middle = (segment.source_start + segment.source_end) / 2.0;
            cut(&format!("extra-{index}"), middle, middle + 0.25)
        })
        .collect();
    let source = document.sources.get_mut("main").unwrap();
    let mut all = source.cuts.clone();
    all.extend(extra);
    all.sort_by(|a, b| a.t0.total_cmp(&b.t0));
    source.cuts = all;
    let report = follow_clock(
        &before,
        &mut document,
        &durations,
        &BTreeMap::new(),
        &ClockEdit::Retime,
        &mut ids(),
    )
    .unwrap();
    let elapsed = started.elapsed();
    assert!(report.created.len() >= 5_000);
    assert!(
        elapsed.as_secs_f64() < 10.0,
        "follow took {elapsed:?}; quadratic?"
    );
}

// ---------------------------------------------------------------------------
// 陈旧画面：旧版本剪口不带画面留下的文档
// ---------------------------------------------------------------------------

/// 旧缺陷留下的形状：已剪 2–4，画面仍是 0–12（源 0）。它对不上折叠后的任何一段，却对得上
/// 不计剪口的时钟。
fn stale() -> TimelineDocument {
    let mut document = detached();
    add_cuts(&mut document, &[("cut-1", 2.0, 4.0)]);
    document
}

fn stale_ids(document: &TimelineDocument) -> Vec<(String, String)> {
    let projection = TimelineProjection::build(document, &durations()).unwrap();
    stale_pictures(document, &projection, &durations())
        .into_iter()
        .map(|stale| (stale.element_id, stale.clip_id))
        .collect()
}

fn assignments(document: &TimelineDocument) -> BTreeMap<String, Vec<String>> {
    let projection = TimelineProjection::build(document, &durations()).unwrap();
    picture_assignments(document, &projection)
}

/// 认得出：陈旧画面报出来，但不进 `clip list` 的归属；恢复剪口后原地不动、成了跟得上的画面。
#[test]
fn a_stale_picture_is_recognised_and_restoring_the_cut_leaves_it_in_place() {
    let mut document = stale();
    assert_eq!(
        stale_ids(&document),
        vec![("video-c1-1".to_owned(), "c1".to_owned())]
    );
    assert!(assignments(&document).is_empty());

    let report = step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        assert!(restore_cut(
            &mut d.sources.get_mut("main").unwrap().cuts,
            "cut-1"
        ));
    });
    assert_eq!(pictures_of(&document), vec![(0.0, 12.0, 0.0)]);
    assert!(!report.retimed.contains(&"video-c1-1".to_owned()));
    assert!(!report.removed.contains(&"video-c1-1".to_owned()));
    assert!(report.created.is_empty());
    assert!(stale_ids(&document).is_empty());
    assert_eq!(assignments(&document)["c1"], vec!["video-c1-1".to_owned()]);
}

/// 再剪一刀：陈旧画面按源区间收到操作后的各段上，等于先补放了历史剪口 2–4。
#[test]
fn cutting_again_fits_a_stale_picture_onto_every_segment() {
    let mut document = stale();
    let report = step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-2", 6.0, 7.0)])
    });
    assert_eq!(
        pictures_of(&document),
        vec![(0.0, 2.0, 0.0), (2.0, 4.0, 4.0), (4.0, 9.0, 7.0)]
    );
    // 只看时钟：夹具里的配乐当年也没跟剪口（0–12 超出成片 2 秒），按规则 3 保持到片尾的距离。
    assert_eq!(
        TimelineProjection::build(&document, &durations())
            .unwrap()
            .duration(),
        9.0
    );
    assert_eq!(
        span(element(&document, "video-c1-1")),
        (Some(0.0), Some(2.0), Some(0.0))
    );
    assert!(report.retimed.contains(&"video-c1-1".to_owned()));
    let created: Vec<_> = report
        .created
        .iter()
        .filter(|created| created.clip_id.is_some())
        .collect();
    assert_eq!(created.len(), 2);
    for created in created {
        assert_eq!(created.from.as_deref(), Some("video-c1-1"));
        assert_eq!(created.clip_id.as_deref(), Some("c1"));
    }
    assert!(stale_ids(&document).is_empty());
    assert_eq!(assignments(&document)["c1"].len(), 3);
}

/// 分割：陈旧画面收到左片段的两段与右片段上，右片段那件取新 id 归到新片段。
#[test]
fn splitting_fits_a_stale_picture_onto_both_halves() {
    let mut document = stale();
    let report = step(
        &mut document,
        &mut ids(),
        ClockEdit::Split {
            left: "c1".to_owned(),
            right: "c2".to_owned(),
            at: 6.0,
        },
        |d| {
            split_clip(d, &durations(), 6.0, "c2".to_owned()).unwrap();
        },
    );
    assert_eq!(
        pictures_of(&document),
        vec![(0.0, 2.0, 0.0), (2.0, 6.0, 4.0), (6.0, 10.0, 8.0)]
    );
    assert_eq!(
        report.created[..2],
        [
            FollowCreated {
                id: "el-1".to_owned(),
                from: Some("video-c1-1".to_owned()),
                clip_id: Some("c1".to_owned()),
            },
            FollowCreated {
                id: "el-2".to_owned(),
                from: Some("video-c1-1".to_owned()),
                clip_id: Some("c2".to_owned()),
            },
        ]
    );
    let owned = assignments(&document);
    assert_eq!(
        owned["c1"],
        vec!["video-c1-1".to_owned(), "el-1".to_owned()]
    );
    assert_eq!(owned["c2"], vec!["el-2".to_owned()]);
}

/// 不认领：有意摆的叠加视频（源同步但起点不在片段未折叠的位置上），以及片段已有跟得上的画面时
/// 另一件恰好对得上未折叠时钟的视频。它们按数字时间跟随，不当画面分段。
#[test]
fn deliberate_overlay_video_is_never_claimed_as_a_stale_picture() {
    // 片段自己的画面被删了，只剩一件从源 0 播起、摆在 1–3 的叠加视频。
    let mut document = stale();
    document.tracks[0].elements[0] = doc_element(json!(
        {"id": "pip", "kind": "video", "srcId": "main", "srcStart": 0.0, "start": 1.0, "end": 3.0}
    ));
    assert!(stale_ids(&document).is_empty());
    let report = step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-2", 6.0, 7.0)])
    });
    assert_eq!(
        span(element(&document, "pip")),
        (Some(1.0), Some(3.0), Some(0.0))
    );
    assert!(
        report
            .created
            .iter()
            .all(|created| created.clip_id.is_none())
    );

    // 画面已经跟上剪口；另一件对得上未折叠时钟的视频不算这个片段的画面。
    let mut document = detached();
    let mut next_id = ids();
    step(&mut document, &mut next_id, ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-1", 2.0, 4.0)])
    });
    document.tracks[1].elements.push(doc_element(json!(
        {"id": "ghost", "kind": "video", "srcId": "main", "srcStart": 0.0, "start": 0.0, "end": 12.0}
    )));
    assert!(stale_ids(&document).is_empty());
    let report = step(&mut document, &mut next_id, ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-2", 6.0, 7.0)])
    });
    assert!(
        report
            .created
            .iter()
            .all(|created| created.from.as_deref() != Some("ghost"))
    );
    assert!(has(&document, "ghost"));
}

// ---------------------------------------------------------------------------
// 关键帧与闪避跟着走（G6 × G4）
// ---------------------------------------------------------------------------

fn keyframes_of(value: Value) -> Option<crate::keyframes::Keyframes> {
    Some(serde_json::from_value(value).expect("keyframes fixture"))
}

fn frames_of(element: &Element, prop: &str) -> Vec<(Value, f64)> {
    element
        .keyframes
        .as_ref()
        .and_then(|keyframes| keyframes.get(prop))
        .unwrap_or_else(|| panic!("{} 没有 {prop} 关键帧", element.id))
        .iter()
        .map(|frame| (serde_json::to_value(&frame.t).unwrap(), frame.v))
        .collect()
}

fn close(actual: &[(Value, f64)], expected: &[(Value, f64)]) {
    assert_eq!(actual.len(), expected.len(), "{actual:?} vs {expected:?}");
    for ((t, v), (et, ev)) in actual.iter().zip(expected) {
        match (t.as_f64(), et.as_f64()) {
            (Some(a), Some(b)) => assert!((a - b).abs() < 1e-6, "{actual:?} vs {expected:?}"),
            _ => assert_eq!(t, et, "{actual:?} vs {expected:?}"),
        }
        assert!((v - ev).abs() < 1e-6, "{actual:?} vs {expected:?}");
    }
}

/// 剪口把带关键帧的片段画面切成两件：秒写法按各自的源区间换算、边界补取样帧；百分比按
/// 各自那一份改写，两件在接缝处的值就是原动画在那一刻的值。
#[test]
fn a_mid_cut_divides_picture_keyframes_between_the_two_pieces() {
    let mut document = detached();
    document.tracks[0].elements[0].keyframes = keyframes_of(json!({
        "scale": [{"t": 0.0, "v": 1.0}, {"t": 12.0, "v": 2.0}],
        "x": [{"t": "0%", "v": 0.0}, {"t": "100%", "v": 12.0}]
    }));
    step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-1", 2.0, 4.0)])
    });
    let left = element(&document, "video-c1-1");
    let right = element(&document, "el-1");
    close(
        &frames_of(left, "scale"),
        &[(json!(0.0), 1.0), (json!(2.0), 1.0 + 2.0 / 12.0)],
    );
    close(
        &frames_of(right, "scale"),
        &[(json!(0.0), 1.0 + 4.0 / 12.0), (json!(8.0), 2.0)],
    );
    close(
        &frames_of(left, "x"),
        &[(json!("0%"), 0.0), (json!("100%"), 2.0)],
    );
    close(
        &frames_of(right, "x"),
        &[(json!("0%"), 4.0), (json!("100%"), 12.0)],
    );
    document.validate().expect("跟随后的关键帧仍合法");
}

/// 一件元素只被修剪：秒写法按起点被推后的量平移（去掉的帧换成 0 处的取样帧），百分比
/// 原样（随新时长伸缩）。
#[test]
fn a_head_trim_shifts_second_keyframes_and_keeps_percent_ones() {
    let mut document = detached();
    document.tracks[1].elements.push(doc_element(json!({
        "id": "title", "kind": "text", "text": "hi", "start": 1.0, "end": 5.0,
        "keyframes": {
            "opacity": [{"t": 0.0, "v": 0.0}, {"t": 2.0, "v": 1.0}],
            "scale": [{"t": "0%", "v": 1.0}, {"t": "100%", "v": 2.0}]
        }
    })));
    step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-1", 0.0, 2.0)])
    });
    let title = element(&document, "title");
    assert_eq!(span(title), (Some(0.0), Some(3.0), None));
    close(
        &frames_of(title, "opacity"),
        &[(json!(0.0), 0.5), (json!(1.0), 1.0)],
    );
    close(
        &frames_of(title, "scale"),
        &[(json!("0%"), 1.0), (json!("100%"), 2.0)],
    );
}

/// 分割缝切开带关键帧与闪避的配乐：两半各自改写百分比、在缝上连续；`duck` 两半都带。
#[test]
fn splitting_divides_keyframes_and_copies_duck_to_both_halves() {
    let mut document = detached();
    let music = &mut document.tracks[2].elements[0];
    music.keyframes = keyframes_of(json!({
        "volume": [{"t": "0%", "v": 1.0}, {"t": "100%", "v": 0.0}]
    }));
    music.duck = Some(serde_json::from_value(json!({"under": "speech", "depth": 12.0})).unwrap());
    step(
        &mut document,
        &mut ids(),
        ClockEdit::Split {
            left: "c1".to_owned(),
            right: "c2".to_owned(),
            at: 5.0,
        },
        |d| {
            split_clip(d, &durations(), 5.0, "c2".to_owned()).unwrap();
        },
    );
    let left = element(&document, "music");
    let right = element(&document, "el-3");
    let seam = 1.0 - 5.0 / 12.0;
    close(
        &frames_of(left, "volume"),
        &[(json!("0%"), 1.0), (json!("100%"), seam)],
    );
    close(
        &frames_of(right, "volume"),
        &[(json!("0%"), seam), (json!("100%"), 0.0)],
    );
    assert_eq!(left.duck, right.duck);
    assert!(right.duck.is_some());
    document.validate().expect("分割后仍合法");
}

/// 跟随删光了被闪避引用的那条轨上的元素：轨留着（空），`duck.under` 不悬空，写入仍合法。
#[test]
fn a_ducked_track_survives_being_emptied_by_follow() {
    let mut document = detached();
    document.tracks.push(
        serde_json::from_value(json!({"id": "tr-vo", "kind": "audio", "elements": [
            {"id": "vo", "kind": "audio", "srcId": "b", "srcStart": 0.0, "start": 2.0, "end": 4.0}
        ]}))
        .unwrap(),
    );
    document.tracks[2].elements[0].duck =
        Some(serde_json::from_value(json!({"under": "tr-vo"})).unwrap());
    let report = step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-1", 1.5, 4.5)])
    });
    assert!(report.removed.contains(&"vo".to_owned()));
    let track = document
        .tracks
        .iter()
        .find(|track| track.id == "tr-vo")
        .expect("被闪避引用的空轨保留");
    assert!(track.elements.is_empty());
    document.validate().expect("duck.under 仍指向存在的轨");
}

/// 没有关键帧的元素跟随之后也不会多出 `keyframes`。
#[test]
fn follow_never_adds_keyframes_to_elements_without_them() {
    let mut document = detached();
    step(&mut document, &mut ids(), ClockEdit::Retime, |d| {
        add_cuts(d, &[("cut-1", 2.0, 4.0)])
    });
    for element in document.tracks.iter().flat_map(|track| &track.elements) {
        assert!(element.keyframes.is_none(), "{}", element.id);
    }
}
