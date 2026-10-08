//! 字幕确定性排版（§3.6 region/grow + §8.4 anchor/offset）：
//! core 排行盒，渲染端只画。度量走 FakeMeasure（每字符宽 = fontSize/2）。

use scene_primitives::Resolver;
use scene_primitives::layout::{self, TextMeasure, TextMetricsLine};
use scene_primitives::resolve::{CapLineBox, Ir};
use serde_json::{Value, json};

struct FakeMeasure;

impl TextMeasure for FakeMeasure {
    fn measure(&mut self, text: &str, _f: &str, font_size: f64, _w: u16) -> TextMetricsLine {
        TextMetricsLine {
            width: text.chars().count() as f64 * font_size / 2.0,
            ascent: font_size * 0.8,
            descent: font_size * 0.2,
        }
    }
}

/// 画布 1000×600、单 lane（fontSize 20 ⇒ 每字符 10px、行高 26、内容高 25）
fn doc(layout_json: Value, lane_extra: Value, line: Value) -> Value {
    let mut lane = json!({ "id": "zh", "style": { "fontSize": 20 } });
    for (k, v) in lane_extra.as_object().unwrap() {
        lane[k] = v.clone();
    }
    json!({
        "meta": { "id": "c", "width": 1000, "height": 600, "fps": 30 },
        "scenes": [ { "id": "s", "dur": 10, "desc": "x" } ],
        "tracks": [ { "id": "cap", "kind": "captions", "clips": [ {
            "id": "caps", "start": 0, "end": 10,
            "layout": layout_json,
            "lanes": [ lane ],
            "captions": [ { "at": 0, "until": 5, "lines": { "zh": line } } ]
        } ] } ]
    })
}

fn laid_out(d: Value) -> Ir {
    let mut ir = Resolver::new(d, None).unwrap().resolve().unwrap();
    layout::layout_captions(&mut ir, &mut FakeMeasure);
    ir
}

fn boxes(ir: &Ir) -> Vec<CapLineBox> {
    ir.caption_clips[0].items[0].lines["zh"]
        .boxes
        .clone()
        .expect("boxes")
}

#[test]
fn anchor_mode_single_line_matches_legacy_geometry() {
    let ir = laid_out(doc(
        json!({ "anchor": "bottom", "offset": "10%", "gap": 10 }),
        json!({}),
        json!({ "text": "abc" }),
    ));
    let bs = boxes(&ir);
    assert_eq!(bs.len(), 1);
    // total_h = 26；top = 600 − 60 − 26 = 514；内容盒再居中 (26−25)/2
    assert_eq!(bs[0].text, "abc");
    assert_eq!(
        (bs[0].x, bs[0].y, bs[0].w, bs[0].h),
        (485.0, 514.5, 30.0, 25.0)
    );
    assert_eq!((bs[0].ascent, bs[0].descent), (16.0, 4.0));
    assert!(bs[0].words.is_empty());
}

#[test]
fn max_width_that_fits_keeps_the_line_verbatim() {
    let ir = laid_out(doc(
        json!({ "anchor": "bottom", "offset": "10%", "maxWidth": 200 }),
        json!({}),
        json!({ "text": "aaaaa bbbbb ccccc" }),
    ));
    let bs = boxes(&ir);
    assert_eq!(bs.len(), 1);
    assert_eq!(bs[0].text, "aaaaa bbbbb ccccc");
    assert_eq!(bs[0].w, 170.0);
}

#[test]
fn max_width_wraps_greedily_on_word_boundaries() {
    let ir = laid_out(doc(
        json!({ "anchor": "bottom", "offset": "10%", "maxWidth": 120 }),
        json!({}),
        json!({ "text": "aaaaa bbbbb ccccc" }),
    ));
    let bs = boxes(&ir);
    assert_eq!(bs.len(), 2);
    assert_eq!(bs[0].text, "aaaaa bbbbb");
    assert_eq!(bs[1].text, "ccccc");
    // total_h = 2 × 26 = 52；top = 600 − 60 − 52 = 488
    assert_eq!((bs[0].x, bs[0].y, bs[0].w), (445.0, 488.5, 110.0));
    assert_eq!((bs[1].x, bs[1].y, bs[1].w), (475.0, 514.5, 50.0));
}

#[test]
fn region_mode_wraps_cjk_per_char_and_grows_up() {
    let ir = laid_out(doc(
        json!({ "region": { "x": 100, "y": 100, "width": 120, "height": 200 }, "grow": "up" }),
        json!({}),
        json!({ "text": "一二三四五六七八九十甲乙丙丁戊己" }),
    ));
    let bs = boxes(&ir);
    assert_eq!(bs.len(), 2);
    assert_eq!(bs[0].text, "一二三四五六七八九十甲乙");
    assert_eq!(bs[1].text, "丙丁戊己");
    // grow up：块底边贴 region 底 → top = 100 + 200 − 52 = 248；中心 x = 160
    assert_eq!((bs[0].x, bs[0].y, bs[0].w), (100.0, 248.5, 120.0));
    assert_eq!((bs[1].x, bs[1].y, bs[1].w), (140.0, 274.5, 40.0));
}

#[test]
fn region_mode_grows_down_by_default() {
    let ir = laid_out(doc(
        json!({ "region": { "x": "10%", "y": "50%", "width": "20%", "height": 200 } }),
        json!({}),
        json!({ "text": "一二三四五六七八九十甲乙丙丁戊己" }),
    ));
    let bs = boxes(&ir);
    // region = (100, 300, 200, 200)；200px 宽放得下 16 字（160）→ 单行
    assert_eq!(bs.len(), 1);
    assert_eq!((bs[0].x, bs[0].y), (120.0, 300.5));
}

#[test]
fn word_lane_keeps_word_boxes_and_resets_dx_per_row() {
    let lane_extra = json!({
        "highlight": { "preset": "wordHighlight", "params": { "color": "#e8906a" } }
    });
    let words = json!([
        { "t": 0.0, "d": 0.5, "text": "one" },
        { "t": 0.5, "d": 0.5, "text": "two" },
        { "t": 1.0, "d": 0.5, "text": "six" }
    ]);

    // ① 放得下：单行，dx 与旧逐词累加一致（空格 10px）
    let ir = laid_out(doc(
        json!({ "anchor": "bottom", "offset": "10%", "maxWidth": 200 }),
        lane_extra.clone(),
        json!({ "text": "one two six", "words": words }),
    ));
    let bs = boxes(&ir);
    assert_eq!(bs.len(), 1);
    assert_eq!(bs[0].text, "one two six");
    assert_eq!(bs[0].w, 110.0);
    let dxs: Vec<f64> = bs[0].words.iter().map(|w| w.dx).collect();
    assert_eq!(dxs, vec![0.0, 40.0, 80.0]);
    let idx: Vec<usize> = bs[0].words.iter().map(|w| w.index).collect();
    assert_eq!(idx, vec![0, 1, 2]);

    // ② 换行：词保持原子，dx 相对各自行首，index 仍指回 words[]
    let words2 = json!([
        { "t": 0.0, "d": 0.5, "text": "one" },
        { "t": 0.5, "d": 0.5, "text": "two" },
        { "t": 1.0, "d": 0.5, "text": "six" }
    ]);
    let ir = laid_out(doc(
        json!({ "anchor": "bottom", "offset": "10%", "maxWidth": 80 }),
        lane_extra,
        json!({ "text": "one two six", "words": words2 }),
    ));
    let bs = boxes(&ir);
    assert_eq!(bs.len(), 2);
    assert_eq!((bs[0].text.as_str(), bs[0].w), ("one two", 70.0));
    assert_eq!((bs[1].text.as_str(), bs[1].w), ("six", 30.0));
    assert_eq!(
        bs[0]
            .words
            .iter()
            .map(|w| (w.index, w.dx))
            .collect::<Vec<_>>(),
        vec![(0, 0.0), (1, 40.0)]
    );
    assert_eq!(
        bs[1]
            .words
            .iter()
            .map(|w| (w.index, w.dx))
            .collect::<Vec<_>>(),
        vec![(2, 0.0)]
    );
}

#[test]
fn two_lanes_stack_with_gap_and_wrapped_rows() {
    let d = json!({
        "meta": { "id": "c", "width": 1000, "height": 600, "fps": 30 },
        "scenes": [ { "id": "s", "dur": 10, "desc": "x" } ],
        "tracks": [ { "id": "cap", "kind": "captions", "clips": [ {
            "id": "caps", "start": 0, "end": 10,
            "layout": { "anchor": "top", "offset": 100, "gap": 10, "maxWidth": 120 },
            "lanes": [
                { "id": "zh", "style": { "fontSize": 20 } },
                { "id": "en", "style": { "fontSize": 10 } }
            ],
            "captions": [ { "at": 0, "until": 5, "lines": {
                "zh": { "text": "aaaaa bbbbb ccccc" },
                "en": { "text": "hi" }
            } } ]
        } ] } ]
    });
    let ir = laid_out(d);
    let lines = &ir.caption_clips[0].items[0].lines;
    let zh = lines["zh"].boxes.as_ref().unwrap();
    let en = lines["en"].boxes.as_ref().unwrap();
    assert_eq!(zh.len(), 2);
    assert_eq!(en.len(), 1);
    // anchor top、offset 100px → zh 两行（26 each），gap 10 后是 en（行高 13）
    assert_eq!(zh[0].y, 100.5);
    assert_eq!(zh[1].y, 126.5);
    assert_eq!(en[0].y, 100.0 + 52.0 + 10.0 + (13.0 - 12.5) / 2.0);
}
