//! 字幕：字幕实例按字幕文档与样式文档交给内核排版、画出来。字形来自随内核发布的字体，像素位置不按字身逐个算，
//! 核对的是摆放（锚点、框、上下顺序）、显示时机、颜色与画不出来时的说法。

mod common;

use common::*;
use frame_render::{Documents, FrozenDocument};
use serde_json::{Value, json};

const STUDIO: &str = "baocut.legacy-studio-style/0.1";

/// 字幕文档：`cues` 是（开始秒，结束秒，文字）。
fn caption_doc(id: &str, clock: &str, cues: &[(f64, f64, &str)], line_kind: &str) -> FrozenDocument {
    serde_json::from_value(json!({
        "documentId": id, "kind": "caption", "schema": "baocut.caption/1", "lineKind": line_kind,
        "body": {
            "schema": "baocut.caption/1", "clock": clock, "timescale": 1000,
            "cues": cues.iter().enumerate().map(|(i, (s, e, t))| json!({
                "id": format!("c{i}"), "start": (s * 1000.0) as i64, "end": (e * 1000.0) as i64, "text": t
            })).collect::<Vec<_>>(),
        }
    }))
    .unwrap()
}

fn style_doc(id: &str, body: Value) -> FrozenDocument {
    serde_json::from_value(json!({
        "documentId": id, "kind": "caption-style", "schema": body.get("schema").cloned(), "body": body
    }))
    .unwrap()
}

fn studio(style: Value) -> Value {
    json!({ "schema": STUDIO, "style": style })
}

/// 字幕实例：字幕轨上从第 0 帧起 `frames` 帧。
fn caption(id: &str, document: &str, style: Option<&str>, frames: i64, scopes: &[&str]) -> Value {
    let mut value = item(
        id,
        0,
        frames,
        json!({ "type": "caption", "documentId": document, "scopeItemIds": scopes }),
    );
    value["trackId"] = json!("trk_s1");
    if let Some(style) = style {
        value["styleDocumentId"] = json!(style);
    }
    value
}

fn draw(documents: Vec<FrozenDocument>, items: Vec<Value>, seconds: f64) -> Vec<u8> {
    let video = video(items, vec![], json!({}));
    render_with(
        &mut renderer(false, Documents::new(documents)),
        &video,
        seconds,
        &mut Media::default(),
    )
}

/// 满足 `pick` 的像素的 `(个数, 平均 x, 平均 y)`。
fn centroid(frame: &[u8], pick: impl Fn([u8; 4]) -> bool) -> (usize, f64, f64) {
    let (mut n, mut sx, mut sy) = (0usize, 0.0, 0.0);
    for y in 0..H {
        for x in 0..W {
            if pick(px(frame, x, y)) {
                n += 1;
                sx += f64::from(x);
                sy += f64::from(y);
            }
        }
    }
    (n, sx / n.max(1) as f64, sy / n.max(1) as f64)
}

fn whiteish(p: [u8; 4]) -> bool {
    p[0] > 160 && p[1] > 160 && p[2] > 160
}

fn reddish(p: [u8; 4]) -> bool {
    p[0] > 160 && p[1] < 90 && p[2] < 90
}

fn greenish(p: [u8; 4]) -> bool {
    p[1] > 120 && p[0] < 90 && p[2] < 90
}

#[test]
fn studio_caption_draws_the_active_cue_at_the_anchor() {
    let documents = || {
        vec![
            caption_doc("doc", "sequence", &[(1.0, 2.0, "AB"), (5.0, 6.0, "。")], "original"),
            style_doc(
                "style",
                studio(json!({ "fontSize": 120, "anim": { "name": "None" }, "displayTiming": { "leadIn": 0.5, "tail": 1.0 } })),
            ),
        ]
    };
    let items = || vec![caption("cap", "doc", Some("style"), 240, &[])];
    // 缺省锚点 (50%, 86%)：字落在画布下部、水平居中。
    let frame = draw(documents(), items(), 1.5);
    let (n, x, y) = centroid(&frame, whiteish);
    assert!(n > 20, "{n}");
    assert!((x - 80.0).abs() < 6.0, "{x}");
    assert!((y - 0.86 * 90.0).abs() < 6.0, "{y}");
    // 显示时机：前留 0.5 秒、后留 1 秒。
    assert!(painted(&draw(documents(), items(), 0.6)) > 0);
    assert!(painted(&draw(documents(), items(), 2.9)) > 0);
    assert_eq!(painted(&draw(documents(), items(), 0.4)), 0);
    assert_eq!(painted(&draw(documents(), items(), 3.1)), 0);
    // 交付写法去掉标点后什么都不剩的句子不画。
    assert_eq!(painted(&draw(documents(), items(), 5.5)), 0);
    // 不烧字幕时字幕层不画，也不报画不出来。
    let video = video(items(), vec![], json!({}));
    let mut off = frame_render::FrameRenderer::new(
        frame_render::RenderOptions {
            width: W,
            height: H,
            skip_unsupported: false,
            captions: false,
        },
        Documents::new(documents()),
        fonts(),
    )
    .unwrap();
    assert_eq!(painted(&render_with(&mut off, &video, 1.5, &mut Media::default())), 0);
    assert!(off.skipped().is_empty());
}

/// 没有样式文档的字幕按默认预设画（规范 §5.6「默认预设」）：普通逗号、句号换成空格，白字带黑色描边，白底上也看得见。
/// 有样式文档的照它画：`{}` 仍是内核的兜底（标点换成空格、没有描边）。
#[test]
fn unstyled_captions_draw_the_default_preset() {
    let draw_on = |background: &str, text: &str, style: Option<Value>| {
        let mut documents = vec![caption_doc("doc", "sequence", &[(0.0, 2.0, text)], "original")];
        if let Some(style) = style.clone() {
            documents.push(style_doc("style", studio(style)));
        }
        let items = vec![caption("cap", "doc", style.as_ref().map(|_| "style"), 60, &[])];
        let video = video(
            items,
            vec![],
            json!({ "canvas": { "width": W, "height": H, "workingSpace": "srgb", "background": background } }),
        );
        render_with(&mut renderer(false, Documents::new(documents)), &video, 1.0, &mut Media::default())
    };
    let plain = || Some(json!({ "anim": { "name": "None" } }));
    // 默认投影不画只有逗号、句号的句子；显式关闭时保留，问号与叹号始终保留。
    for punctuation in ["，", "。", "，。"] {
        assert_eq!(painted(&draw_on("#000000", punctuation, None)), 0);
        assert!(painted(&draw_on("#000000", punctuation, Some(json!({"punct": false})))) > 0);
    }
    assert!(painted(&draw_on("#000000", "，。？！", None)) > 0);
    assert_eq!(painted(&draw_on("#000000", "，。", plain())), 0);
    let span = |frame: &[u8]| painted_bounds(frame).map_or(0, |(left, _, right, _)| right - left);
    let projected = span(&draw_on("#000000", "其实，宇航员。", None));
    let spaces = span(&draw_on("#000000", "其实 宇航员", None));
    assert_eq!(projected, spaces, "projected width vs spaces");
    // 描边：白底上的白字靠描边看得见；没有描边的样式在白底上几乎没有深色像素。
    let dark = |frame: &[u8]| centroid(frame, |p| p[0] < 160 && p[1] < 160 && p[2] < 160).0;
    let outlined = dark(&draw_on("#FFFFFF", "微重力环境", None));
    let bare = dark(&draw_on("#FFFFFF", "微重力环境", plain()));
    assert!(outlined > 20 && bare == 0, "{outlined} vs {bare}");
}

#[test]
fn bilingual_captions_stack_once_per_style_group_in_order() {
    let documents = |order: &str| {
        vec![
            caption_doc("orig", "sequence", &[(0.0, 2.0, "AB")], "original"),
            caption_doc("trans", "sequence", &[(0.0, 2.0, "一二")], "translation"),
            style_doc(
                "style",
                studio(json!({
                    "y": 50, "order": order, "fontSize": 90, "anim": { "name": "None" },
                    "origStyle": { "fontColor": "#FFFFFF" },
                    "transStyle": { "fontColor": "#FF0000" },
                    "dropShadow": { "on": false },
                })),
            ),
        ]
    };
    let items = || {
        vec![
            caption("a", "orig", Some("style"), 60, &[]),
            caption("b", "trans", Some("style"), 60, &[]),
        ]
    };
    // 同一样式文档的两层是一组：译文在上（缺省）时红字在白字上面，原文在上时反过来；两行都在画布中线附近。
    let frame = draw(documents("trans"), items(), 1.0);
    let ((reds, _, red_y), (whites, _, white_y)) = (centroid(&frame, reddish), centroid(&frame, whiteish));
    assert!(reds > 10 && whites > 10, "{reds} {whites}");
    assert!(red_y < white_y, "{red_y} {white_y}");
    assert!((red_y + white_y) / 2.0 > 30.0 && (red_y + white_y) / 2.0 < 60.0);
    let frame = draw(documents("orig"), items(), 1.0);
    let ((_, _, red_y), (_, _, white_y)) = (centroid(&frame, reddish), centroid(&frame, whiteish));
    assert!(white_y < red_y, "{red_y} {white_y}");
    // 没有样式文档的字幕各自一组：按缺省样式（逐词变色）单独画在锚点上。
    let frame = draw(
        vec![caption_doc("trans", "sequence", &[(0.0, 2.0, "一二")], "original")],
        vec![caption("a", "trans", None, 60, &[])],
        1.0,
    );
    assert!(painted(&frame) > 0);
}

#[test]
fn source_clock_captions_follow_the_scope_item() {
    let documents = || {
        vec![
            caption_doc("doc", "source-asset", &[(10.0, 11.0, "AB")], "original"),
            style_doc(
                "style",
                studio(json!({ "fontSize": 120, "anim": { "name": "None" }, "displayTiming": { "leadIn": 0, "tail": 0 } })),
            ),
        ]
    };
    // 作用实例从源的第 10 秒起播：序列 0.5 秒是源 10.5 秒，正好在句子里。
    let clip = || {
        video_item(
            "clip",
            "a_clip",
            0,
            60,
            json!({ "timeMap": { "kind": "linear", "sourceIn": { "ticks": "10", "timescale": 1 }, "rate": { "num": 1, "den": 1 } } }),
        )
    };
    let assets = || vec![video_asset("a_clip", 16, 9)];
    let render_at = |scopes: &[&str]| {
        let video = video(vec![clip(), caption("cap", "doc", Some("style"), 60, scopes)], assets(), json!({}));
        render_with(
            &mut renderer(false, Documents::new(documents())),
            &video,
            0.5,
            &mut Media::default(),
        )
    };
    assert!(centroid(&render_at(&["clip"]), whiteish).0 > 10);
    // 没有作用实例时源时刻无从说起：这一刻不画。
    assert_eq!(painted(&render_at(&[])), 0);
}

#[test]
fn boxed_captions_sit_in_their_box() {
    // 样式画布 320×180 是输出的两倍：框中心在画布中心上方 60（输出 30）、宽 240 高 40（输出 120×20），
    // 所以输出上的框是 x 20–140、y 5–25。
    let boxed = |align: &str, extra: Value| {
        let mut style = json!({ "fontSize": 24, "color": "#00FF00", "verticalAlign": align });
        if let (Some(style), Value::Object(extra)) = (style.as_object_mut(), extra) {
            style.extend(extra);
        }
        style_doc(
            "style",
            json!({
                "schema": "baocut.boxed-caption-style/1",
                "canvas": { "width": 320, "height": 180 },
                "box": { "x": 0, "y": -60, "width": 240, "height": 40 },
                "style": style,
            }),
        )
    };
    let frame_with = |text: &str, style: FrozenDocument| {
        draw(
            vec![caption_doc("doc", "sequence", &[(0.0, 1.0, text)], "original"), style],
            vec![caption("cap", "doc", Some("style"), 60, &[])],
            0.5,
        )
    };
    let bounds = |frame: &[u8]| {
        let mut b: Option<(u32, u32, u32, u32)> = None;
        for y in 0..H {
            for x in 0..W {
                if greenish(px(frame, x, y)) {
                    b = Some(b.map_or((x, y, x, y), |(x0, y0, x1, y1)| (x0.min(x), y0.min(y), x1.max(x), y1.max(y))));
                }
            }
        }
        b.expect("画出了字")
    };
    // 靠上贴框顶，靠下贴框底，居中在框心（y 15）；都在框里、水平居中。
    let top = bounds(&frame_with("AB", boxed("top", json!({}))));
    let bottom = bounds(&frame_with("AB", boxed("bottom", json!({}))));
    let center = bounds(&frame_with("AB", boxed("center", json!({}))));
    assert!(top.1 >= 5 && top.1 <= 9, "{top:?}");
    assert!(bottom.3 <= 25 && bottom.3 >= 20, "{bottom:?}");
    assert!(top.1 < center.1 && center.1 < bottom.1, "{top:?} {center:?} {bottom:?}");
    assert!(((center.1 + center.3) as f64 / 2.0 - 15.0).abs() < 3.0, "{center:?}");
    for (x0, _, x1, _) in [top, bottom, center] {
        assert!(x0 >= 20 && x1 <= 140 && ((x0 + x1) as f64 / 2.0 - 80.0).abs() < 3.0, "{x0} {x1}");
    }
    // 定位框样式不做交付写法：句号照画。
    let plain = centroid(&frame_with("AB", boxed("top", json!({}))), greenish).0;
    let dotted = centroid(&frame_with("AB.", boxed("top", json!({}))), greenish).0;
    assert!(dotted > plain, "{plain} {dotted}");
    // 不透明度作用在整句上；底板铺在文字周围。
    let faded = frame_with("AB", boxed("top", json!({ "opacity": 0.5 })));
    let brightest = faded.chunks_exact(4).map(|p| p[1]).max().unwrap();
    assert!((110..=140).contains(&brightest), "{brightest}");
    let plated = frame_with("AB", boxed("center", json!({ "backgroundColor": "#0000FF", "textPadding": 8 })));
    assert!(centroid(&plated, |p| p[2] > 200 && p[1] < 60).0 > 50);
}

#[test]
fn boxed_caption_alignment_hugs_the_box_edges() {
    // 输出上的框是 x 20–140（见上一个测试）；留白 8 在输出上是 4：文字离框边一个留白，底板正好铺到框边。
    let frame = |align: &str| {
        draw(
            vec![
                caption_doc("doc", "sequence", &[(0.0, 1.0, "AB")], "original"),
                style_doc(
                    "style",
                    json!({
                        "schema": "baocut.boxed-caption-style/1",
                        "canvas": { "width": 320, "height": 180 },
                        "box": { "x": 0, "y": -60, "width": 240, "height": 40 },
                        "style": { "fontSize": 24, "color": "#00FF00", "verticalAlign": "center", "textAlign": align,
                                   "backgroundColor": "#0000FF", "textPadding": 8 },
                    }),
                ),
            ],
            vec![caption("cap", "doc", Some("style"), 60, &[])],
            0.5,
        )
    };
    let span = |frame: &[u8], pick: fn([u8; 4]) -> bool| {
        let xs: Vec<u32> = (0..H)
            .flat_map(|y| (0..W).map(move |x| (x, y)))
            .filter(|&(x, y)| pick(px(frame, x, y)))
            .map(|(x, _)| x)
            .collect();
        (*xs.iter().min().expect("画出来了"), *xs.iter().max().unwrap())
    };
    let plate = |p: [u8; 4]| p[2] > 200 && p[1] < 60;
    let (left, center, right) = (frame("left"), frame("center"), frame("right"));
    let (lp, cp, rp) = (span(&left, plate), span(&center, plate), span(&right, plate));
    let (lt, ct, rt) = (span(&left, greenish), span(&center, greenish), span(&right, greenish));
    assert!(lp.0.abs_diff(20) <= 1, "左对齐的底板贴框的左边：{lp:?}");
    assert!(rp.1.abs_diff(139) <= 1, "右对齐的底板贴框的右边：{rp:?}");
    assert!((f64::from(cp.0 + cp.1) / 2.0 - 80.0).abs() <= 1.5, "居中照旧：{cp:?}");
    // 同一句话，三种对齐只是平移（边上的抗锯齿差一像素以内）。
    assert!((lp.1 - lp.0).abs_diff(cp.1 - cp.0) <= 1, "{lp:?} {cp:?}");
    assert!((rp.1 - rp.0).abs_diff(cp.1 - cp.0) <= 1, "{rp:?} {cp:?}");
    assert!(lt.0 >= 24 && lt.0 < ct.0 && ct.0 < rt.0 && rt.1 <= 136, "{lt:?} {ct:?} {rt:?}");
}

/// 定位框样式选了逐字显现（`animationPresetId: reveal`）：没有词时间的句子按空白切成词、按字数分摊时长，没念到的词不画，
/// 念到一个就整个亮出来；全念到之后与不动画的同一句逐像素相同。
#[test]
fn boxed_reveal_shows_words_as_they_are_reached() {
    let boxed = |preset: Option<&str>| {
        let mut style = json!({ "fontSize": 24, "color": "#00FF00", "verticalAlign": "center" });
        if let Some(preset) = preset {
            style["animationPresetId"] = json!(preset);
        }
        style_doc(
            "style",
            json!({
                "schema": "baocut.boxed-caption-style/18",
                "canvas": { "width": 320, "height": 180 },
                "box": { "x": 0, "y": 0, "width": 300, "height": 60 },
                "style": style,
            }),
        )
    };
    // 三个一样长的词各占一秒：[0, 1)、[1, 2)、[2, 3)。
    let frame = |text: &str, preset: Option<&str>, seconds: f64| {
        draw(
            vec![caption_doc("doc", "sequence", &[(0.0, 3.0, text)], "original"), boxed(preset)],
            vec![caption("cap", "doc", Some("style"), 120, &[])],
            seconds,
        )
    };
    let right_edge = |frame: &[u8]| {
        (0..H)
            .flat_map(|y| (0..W).map(move |x| (x, y)))
            .filter(|&(x, y)| greenish(px(frame, x, y)))
            .map(|(x, _)| x)
            .max()
    };
    let text = "AA BB CC";
    let phases: Vec<Vec<u8>> = [0.5, 1.5, 2.5].iter().map(|&t| frame(text, Some("reveal"), t)).collect();
    let counts: Vec<usize> = phases.iter().map(|f| centroid(f, greenish).0).collect();
    let edges: Vec<u32> = phases.iter().map(|f| right_edge(f).expect("念到的词画出来了")).collect();
    // 一个、两个、三个词：字越来越多，右边一个比一个靠右（行在框里居中排好，没念到的词占着位置）。
    assert!(counts[0] > 10 && counts[0] < counts[1] && counts[1] < counts[2], "{counts:?}");
    assert!(edges[0] < edges[1] && edges[1] < edges[2], "{edges:?}");
    // 起点那一刻第一个词还没亮：整句什么都不画。
    assert_eq!(centroid(&frame(text, Some("reveal"), 0.0), greenish).0, 0);
    // 左边第一个词的像素位置不随后面的词亮起而移动。
    let first_word = |f: &[u8]| {
        (0..H)
            .flat_map(|y| (0..W).map(move |x| (x, y)))
            .filter(|&(x, y)| x <= edges[0] && greenish(px(f, x, y)))
            .count()
    };
    assert_eq!(first_word(&phases[0]), first_word(&phases[2]));
    // 全念到时与不动画的同一句相同；不认识目录 id 之外的写法时（这里不写）也不动画。
    assert_eq!(phases[2], frame(text, None, 2.5));
    // 没有空白的中文句是一个词：一开头就整句亮出来，与不动画的相同。
    assert_eq!(frame("一处切换", Some("reveal"), 0.2), frame("一处切换", None, 0.2));
    assert!(centroid(&frame("一处切换", Some("reveal"), 0.2), greenish).0 > 10);
}

#[test]
fn unreadable_captions_are_refused_or_skipped() {
    let good = || caption_doc("doc", "sequence", &[(0.0, 2.0, "AB")], "original");
    let reason = |documents: Vec<FrozenDocument>, style: Option<&str>| -> String {
        let video = video(vec![caption("cap", "doc", style, 60, &[])], vec![], json!({}));
        let error = try_render(&mut renderer(false, Documents::new(documents)), &video, 1.0, &mut Media::default()).unwrap_err();
        assert_eq!(error.code, "EXPORT_UNSUPPORTED_CONTENT");
        assert_eq!((error.items[0].layer_kind, error.items[0].scope), ("caption", "layer"));
        error.items[0].reason.clone()
    };
    assert_eq!(reason(vec![], None), "caption-document-missing");
    let mut odd = good();
    odd.body = json!({ "schema": "vendor.captions/3", "cues": [] });
    assert_eq!(reason(vec![odd], None), "caption-unknown-document");
    assert_eq!(reason(vec![good()], Some("style")), "caption-style-missing");
    assert_eq!(
        reason(
            vec![good(), style_doc("style", json!({ "schema": "vendor.style/1" }))],
            Some("style")
        ),
        "caption-unknown-style"
    );
    // 跳过时只少这一组字幕。
    let video = video(vec![caption("cap", "doc", Some("style"), 60, &[])], vec![], json!({}));
    let mut skipping = renderer(true, Documents::new(vec![good()]));
    assert_eq!(painted(&render_with(&mut skipping, &video, 1.0, &mut Media::default())), 0);
    assert_eq!(skipping.skipped()[0].reason, "caption-style-missing");
}

#[test]
fn renderers_reused_across_sizes_and_documents_match_fresh_ones() {
    // 换尺寸、换文档时排版引擎拆下来接着用：画出来的与新建的渲染器一模一样。
    let documents = || {
        vec![
            caption_doc("doc", "sequence", &[(0.0, 2.0, "AB")], "original"),
            style_doc("style", studio(json!({ "fontSize": 90, "anim": { "name": "None" } }))),
        ]
    };
    let title = item(
        "title",
        1,
        60,
        json!({ "type": "text", "text": "HH", "style": { "fontSize": 50, "fontColor": "#FF0000" }, "place": { "x": 50, "y": 30, "w": 60 } }),
    );
    let video = video(vec![caption("cap", "doc", Some("style"), 60, &[]), title], vec![], json!({}));
    let fresh = |width: u32, height: u32| {
        let mut renderer = frame_render::FrameRenderer::new(
            frame_render::RenderOptions {
                width,
                height,
                skip_unsupported: false,
                captions: true,
            },
            Documents::new(documents()),
            fonts(),
        )
        .unwrap();
        render_with(&mut renderer, &video, 1.0, &mut Media::default())
    };
    let mut reused = renderer(false, Documents::new(documents()));
    let first = render_with(&mut reused, &video, 1.0, &mut Media::default());
    assert!(painted(&first) > 100);
    assert!(first.chunks_exact(4).any(|p| reddish([p[0], p[1], p[2], p[3]])), "文字层画上去了");
    reused.resize(W * 2, H * 2).unwrap();
    assert_eq!(render_with(&mut reused, &video, 1.0, &mut Media::default()), fresh(W * 2, H * 2));
    reused.resize(W, H).unwrap();
    reused.set_documents(Documents::new(documents()));
    assert_eq!(render_with(&mut reused, &video, 1.0, &mut Media::default()), first);
}

/// 转写文档：`words` 是（ID，文字，开始秒，结束秒），`hidden` 里的词隐藏。
fn speech_doc(id: &str, asset: &str, words: &[(&str, &str, f64, f64)], hidden: &[&str]) -> FrozenDocument {
    serde_json::from_value(json!({
        "documentId": id, "kind": "speech", "schema": "baocut.speech/1", "sourceAssetId": asset,
        "body": {
            "schema": "baocut.speech/1", "clock": "source-asset", "timescale": 1000,
            "words": words.iter().map(|(w, t, s, e)| {
                let mut word = json!({ "id": w, "text": t, "start": (s * 1000.0) as i64, "end": (e * 1000.0) as i64 });
                if hidden.contains(w) {
                    word["hidden"] = json!(true);
                }
                word
            }).collect::<Vec<_>>(),
        }
    }))
    .unwrap()
}

/// 源素材时钟上的字幕文档，一句指向转写的 `first`–`last`。`speech` 为 `None` 时文档头不写 `sourceDocumentId`。
fn worded_caption_doc(id: &str, speech: Option<&str>, cue: (f64, f64, &str), words: (&str, &str)) -> FrozenDocument {
    let mut value = json!({
        "documentId": id, "kind": "caption", "schema": "baocut.caption/1", "lineKind": "original",
        "body": {
            "schema": "baocut.caption/1", "clock": "source-asset", "timescale": 1000,
            "cues": [{ "id": "q-w1", "start": (cue.0 * 1000.0) as i64, "end": (cue.1 * 1000.0) as i64, "text": cue.2,
                       "words": { "first": words.0, "last": words.1 } }],
        }
    });
    if let Some(speech) = speech {
        value["sourceDocumentId"] = json!(speech);
    }
    serde_json::from_value(value).unwrap()
}

/// 从源的 `source_in` 秒起播 `frames` 帧、放在序列第 `from` 帧的视频实例（素材 `a_clip`）。
fn clip_at(id: &str, from: i64, frames: i64, source_in: f64) -> Value {
    video_item(
        id,
        "a_clip",
        from,
        frames,
        json!({ "timeMap": { "kind": "linear", "sourceIn": { "ticks": format!("{}", (source_in * 1000.0) as i64), "timescale": 1000 },
                             "rate": { "num": 1, "den": 1 } } }),
    )
}

/// 逐词变色（`#FFD43B`）的黄色像素。
fn karaoke_yellow(p: [u8; 4]) -> bool {
    p[0] > 180 && p[1] > 150 && p[2] < 120
}

const SPACELESS: [(&str, &str, f64, f64); 4] = [
    ("w1", "真", 10.0, 10.5),
    ("w2", "的", 10.5, 11.0),
    ("w3", "别", 11.0, 11.5),
    ("w4", "再", 11.5, 12.0),
];

#[test]
fn spaceless_chinese_lines_advance_per_character_from_the_transcript() {
    let style = || {
        style_doc(
            "style",
            studio(json!({ "fontSize": 120, "anim": { "name": "Color" }, "displayTiming": { "leadIn": 0, "tail": 0 } })),
        )
    };
    let documents = |speech: Option<&str>| {
        vec![
            speech_doc("sp", "a_clip", &SPACELESS, &[]),
            worded_caption_doc("doc", speech, (10.0, 12.0, "真的别再"), ("w1", "w4")),
            style(),
        ]
    };
    let draw_at = |speech: Option<&str>, seconds: f64| {
        let video = video(
            vec![clip_at("clip", 0, 60, 10.0), caption("cap", "doc", Some("style"), 60, &["clip"])],
            vec![video_asset("a_clip", 16, 9)],
            json!({}),
        );
        render_with(
            &mut renderer(false, Documents::new(documents(speech))),
            &video,
            seconds,
            &mut Media::default(),
        )
    };
    // 拿到转写的逐字时间：第一个字说的时候只有它变色，第四个字说的时候变色的跑到右边。
    let first = draw_at(Some("sp"), 0.25);
    let last = draw_at(Some("sp"), 1.75);
    let (yellow_first, x_first, _) = centroid(&first, karaoke_yellow);
    let (yellow_last, x_last, _) = centroid(&last, karaoke_yellow);
    let (white_first, ..) = centroid(&first, whiteish);
    assert!(yellow_first > 10 && yellow_last > 10, "{yellow_first} {yellow_last}");
    assert!(
        white_first > yellow_first * 2,
        "其余三个字还是白的：白 {white_first}，黄 {yellow_first}"
    );
    assert!(x_last - x_first > 30.0, "变色的字从左跑到右：{x_first} → {x_last}");
    // 没有转写可取（文档头不写 sourceDocumentId）时整行是一个「词」，一起变色。
    let whole = draw_at(None, 0.25);
    let (yellow_whole, ..) = centroid(&whole, karaoke_yellow);
    let (white_whole, ..) = centroid(&whole, whiteish);
    assert!(yellow_whole > white_whole * 4, "整行一起变色：黄 {yellow_whole}，白 {white_whole}");
}

#[test]
fn cut_and_hidden_words_leave_the_caption_line() {
    let documents = |hidden: &[&str]| {
        vec![
            speech_doc("sp", "a_clip", &SPACELESS, hidden),
            worded_caption_doc("doc", Some("sp"), (10.0, 12.0, "真的别再"), ("w1", "w4")),
            style_doc(
                "style",
                studio(json!({ "fontSize": 120, "anim": { "name": "None" }, "displayTiming": { "leadIn": 0, "tail": 0 } })),
            ),
        ]
    };
    let width = |items: Vec<Value>, hidden: &[&str], seconds: f64| {
        let video = video(items, vec![video_asset("a_clip", 16, 9)], json!({}));
        let frame = render_with(
            &mut renderer(false, Documents::new(documents(hidden))),
            &video,
            seconds,
            &mut Media::default(),
        );
        let (x0, _, x1, _) = painted_bounds(&frame).expect("字幕画出来了");
        f64::from(x1 - x0)
    };
    let whole = || vec![clip_at("clip", 0, 60, 10.0), caption("cap", "doc", Some("style"), 60, &["clip"])];
    let four = width(whole(), &[], 0.25);
    // 剪掉「的」（源 10.5–11.0）：前一段放源 10.0–10.5，后一段从序列第 15 帧起放源 11.0–12.0。
    let cut = vec![
        clip_at("left", 0, 15, 10.0),
        clip_at("right", 15, 30, 11.0),
        caption("cap", "doc", Some("style"), 45, &["left", "right"]),
    ];
    let three = width(cut, &[], 1.0);
    let char_width = four / 4.0;
    assert!((four - three - char_width).abs() < char_width * 0.4, "少了一个字：{four} → {three}");
    // 隐藏的词同样不画。
    let hidden = width(whole(), &["w2"], 0.25);
    assert!((hidden - three).abs() < 2.0, "{hidden} ≠ {three}");
    // 预览里同一个渲染器跟着剪辑走：剪了之后字幕重编。
    let mut shared = renderer(false, Documents::new(documents(&[])));
    let mut bounds = |items: Vec<Value>, seconds: f64| {
        let video = video(items, vec![video_asset("a_clip", 16, 9)], json!({}));
        // 预览送进新的视频快照时告诉渲染器序列变了（preview-wasm 的 `set_video`）。
        shared.sequence_changed();
        let (x0, _, x1, _) = painted_bounds(&render_with(&mut shared, &video, seconds, &mut Media::default())).unwrap();
        f64::from(x1 - x0)
    };
    assert_eq!(bounds(whole(), 0.25), four);
    let cut = vec![
        clip_at("left", 0, 15, 10.0),
        clip_at("right", 15, 30, 11.0),
        caption("cap", "doc", Some("style"), 45, &["left", "right"]),
    ];
    assert_eq!(bounds(cut, 1.0), three);
}

/// 设计字幕强调色（`#FF00AA`，入场时压在黑底上）的像素。
fn emphasis_magenta(p: [u8; 4]) -> bool {
    p[0] > 90 && p[1] < 50 && p[2] > 45 && p[0] > p[2]
}

#[test]
fn designed_caption_emphasis_lands_on_transcript_words() {
    let words = [("w1", "真", 10.0, 10.5), ("w2", "的", 10.5, 11.0), ("w3", "说了", 11.0, 12.0)];
    let draw = |speech: Option<&str>, emphasis: Value| {
        let documents = vec![
            speech_doc("sp", "a_clip", &words, &[]),
            worded_caption_doc("doc", speech, (10.0, 12.0, "真的说了"), ("w1", "w3")),
            style_doc(
                "style",
                studio(json!({
                    "fontSize": 110, "displayTiming": { "leadIn": 0, "tail": 0 },
                    "wordAnimation": { "caption": { "schema": 1, "style": { "id": "caption-highlight", "version": 1 }, "content": "orig",
                                                    "palette": { "primary": "#FFFFFF", "accent": "#00FF66" } } },
                    "captionEmphasis": emphasis,
                })),
            ),
        ];
        let video = video(
            vec![clip_at("clip", 0, 60, 10.0), caption("cap", "doc", Some("style"), 60, &["clip"])],
            vec![video_asset("a_clip", 16, 9)],
            json!({}),
        );
        let frame = render_with(&mut renderer(false, Documents::new(documents)), &video, 0.25, &mut Media::default());
        let (count, x, _) = centroid(&frame, emphasis_magenta);
        let columns: Vec<u32> = (0..W).filter(|&x| (0..H).any(|y| emphasis_magenta(px(&frame, x, y)))).collect();
        (
            count,
            x,
            columns.first().copied().unwrap_or(0),
            columns.last().copied().unwrap_or(0),
        )
    };
    let hero = |id: &str| json!({ id: { "anchorText": "", "role": "hero", "color": "#FF00AA" } });
    // 强调按转写的词 ID 写：「的」画成强调色。
    let (single, x_single, ..) = draw(Some("sp"), hero("w2"));
    assert!(single > 5, "强调的字画成强调色：{single}");
    // 写在多字词「说了」（拆成 `w3`、`w3~1`）上的强调落到拆出来的每个字上：右边一直到「了」的右边，
    // 左边在「了」的左边（「说」也是强调色）。
    let (split, x_split, left, right) = draw(Some("sp"), hero("w3"));
    let (last, _, last_left, last_right) = draw(Some("sp"), hero("w3~1"));
    assert!(split > 5 && last > 5, "{split} {last}");
    assert!(x_single < x_split, "「的」在「说了」左边：{x_single} {x_split}");
    assert!(
        right + 1 >= last_right && left + 4 < last_left,
        "「说了」两个字都是强调色：{left}–{right}，「了」{last_left}–{last_right}"
    );
    // 没有转写可取时词按空白切分推算，没有这个 ID，强调不落。
    let (none, ..) = draw(None, hero("w2"));
    assert_eq!(none, 0, "取不到词时不冒充强调");
}

#[test]
fn cue_styles_follow_the_document_cue_id_in_every_member() {
    // 同一样式组里两份字幕文档的句子 ID 撞了：交给内核时第二句补了后缀，逐句样式仍按文档里的 ID 落到两句上。
    let documents = vec![
        caption_doc("one", "sequence", &[(0.0, 1.0, "AB")], "original"),
        caption_doc("two", "sequence", &[(2.0, 3.0, "CD")], "original"),
        style_doc(
            "style",
            studio(json!({
                "fontSize": 110, "anim": { "name": "None" }, "displayTiming": { "leadIn": 0, "tail": 0 },
                "cueStyles": { "c0": { "source": { "fontColor": "#FF0000" } } },
            })),
        ),
    ];
    let video = video(
        vec![
            caption("a", "one", Some("style"), 120, &[]),
            caption("b", "two", Some("style"), 120, &[]),
        ],
        vec![],
        json!({}),
    );
    let mut shared = renderer(false, Documents::new(documents));
    for seconds in [0.5, 2.5] {
        let frame = render_with(&mut shared, &video, seconds, &mut Media::default());
        let (red, ..) = centroid(&frame, reddish);
        let (white, ..) = centroid(&frame, whiteish);
        assert!(red > 10 && white < red / 4, "{seconds} 秒：红 {red}，白 {white}");
    }
}

#[test]
fn bottom_template_strips_lift_captions_without_drawing_the_template_twice() {
    // 字幕底边贴着锚线（`verticalAlign: bottom`），缺省锚线在 86%。
    let documents = || {
        vec![
            caption_doc("doc", "sequence", &[(0.0, 2.0, "AB")], "original"),
            style_doc(
                "style",
                studio(json!({ "fontSize": 80, "verticalAlign": "bottom", "anim": { "name": "None" },
                               "displayTiming": { "leadIn": 0, "tail": 0 } })),
            ),
        ]
    };
    // y = 80% 起、整宽的进度线：避让时锚线抬到 100 − 80 + 2 = 22% 之上，即 78%。
    let template = |subs_avoid: bool, accent: &str, track: &str| {
        json!({ "durationPolicy": { "kind": "fixed", "frames": 60 }, "template": { "id": "tpl", "name": "条", "subsAvoid": subs_avoid, "layers": [
            { "id": "bar", "box": { "x": 0, "y": 80, "w": 100, "h": 20 }, "kind": "progress", "accent": accent, "track": track }
        ] } })
    };
    let draw = |sequence: Value, with_caption: bool| {
        let mut items = vec![];
        if with_caption {
            items.push(caption("cap", "doc", Some("style"), 60, &[]));
        }
        let video = video(items, vec![], sequence);
        render_with(
            &mut renderer(false, Documents::new(documents())),
            &video,
            0.5,
            &mut Media::default(),
        )
    };
    let bottom = |frame: &[u8]| {
        (0..H)
            .rev()
            .find(|&y| (0..W).any(|x| whiteish(px(frame, x, y))))
            .expect("字幕画出来了")
    };
    let strip_top = (f64::from(H) * 0.8) as u32;
    // 透明的横条：只看字幕摆在哪。
    let clear = |avoid: bool| template(avoid, "#FF000000", "#0000FF00");
    let plain = draw(json!({}), true);
    let lifted = draw(clear(true), true);
    let off = draw(clear(false), true);
    assert!(bottom(&plain) >= strip_top, "没有模板时字幕底边在 86% 附近：{}", bottom(&plain));
    assert!(bottom(&lifted) < strip_top, "底部横条把字幕抬到条的上沿之上：{}", bottom(&lifted));
    assert_eq!(off, plain, "关掉 subsAvoid 不抬");
    // 字幕长相不变：白字的像素数差不多。
    let (white_plain, ..) = centroid(&plain, whiteish);
    let (white_lifted, ..) = centroid(&lifted, whiteish);
    assert!(
        white_plain.abs_diff(white_lifted) * 10 < white_plain,
        "{white_plain} vs {white_lifted}"
    );
    // 字幕层只画字幕：不透明的横条那一片与只有模板时逐像素一样（模板不被字幕层再画一遍），字幕照样抬在上面。
    let opaque = template(true, "#FF0000", "#0000FF");
    let over = draw(opaque.clone(), true);
    let bare = draw(opaque, false);
    for y in strip_top..H {
        for x in 0..W {
            assert_eq!(px(&over, x, y), px(&bare, x, y), "({x}, {y})");
        }
    }
    assert_eq!(bottom(&over), bottom(&lifted));
}

#[test]
fn caption_font_notes_stand_on_every_frame() {
    let documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 2.0, "AB")], "original"),
        style_doc(
            "style",
            studio(json!({ "fontSize": 120, "fontFamily": "Nowhere Sans", "anim": { "name": "None" },
                           "displayTiming": { "leadIn": 0, "tail": 0 } })),
        ),
    ];
    let video = video(vec![caption("cap", "doc", Some("style"), 60, &[])], vec![], json!({}));
    let note = "cap：字体 \"Nowhere Sans\" 在当前字体库中不可用，将使用 Noto Sans SC fallback";
    let mut renderer = renderer(false, Documents::new(documents));
    // 预览每帧先清掉报告；字幕的缺字体提示每一帧都在（以前只有编译的那一帧报）。
    for seconds in [0.5, 1.0, 1.5] {
        renderer.clear_reports();
        render_with(&mut renderer, &video, seconds, &mut Media::default());
        let notes: Vec<&str> = renderer.warnings().iter().map(|w| w.detail.as_str()).collect();
        assert_eq!(notes, vec![note], "{seconds} 秒");
        assert_eq!(renderer.missing_fonts(), vec!["Nowhere Sans".to_string()], "{seconds} 秒");
    }
}

#[test]
fn preview_hits_follow_rendered_bilingual_lines_and_clear_between_frames() {
    let docs = vec![
        caption_doc("orig", "sequence", &[(1.0, 2.0, "Original")], "original"),
        caption_doc("trans", "sequence", &[(1.0, 2.0, "Translation")], "translation"),
        style_doc(
            "style",
            studio(json!({ "fontSize": 40, "rotation": 15, "anim": { "name": "None" }, "displayTiming": { "leadIn": 0, "tail": 0 } })),
        ),
    ];
    let video = video(
        vec![
            caption("cap_o", "orig", Some("style"), 240, &[]),
            caption("cap_t", "trans", Some("style"), 240, &[]),
        ],
        vec![],
        json!({}),
    );
    let mut renderer = renderer(false, Documents::new(docs));
    renderer.set_collect_caption_hits(true);
    render_with(&mut renderer, &video, 1.5, &mut Media::default());
    let hits = renderer.caption_hits();
    assert_eq!(hits.len(), 2);
    for (document, item) in [("orig", "cap_o"), ("trans", "cap_t")] {
        let hit = hits.iter().find(|hit| hit.document_id == document).unwrap();
        assert_eq!(hit.item_id, item);
        assert_eq!(hit.layer_id, "cap_o");
        assert_eq!(hit.cue_id, "c0");
        assert_eq!(hit.rotation, 15.0);
        assert!(hit.w > 0.0 && hit.h > 0.0);
    }
    assert_ne!(hits[0].cy, hits[1].cy);
    // 没有句子的帧不能留下上一次的命中框；不烧字幕时也不能命中。
    render_with(&mut renderer, &video, 3.5, &mut Media::default());
    assert!(renderer.caption_hits().is_empty());
    renderer.set_captions(false);
    render_with(&mut renderer, &video, 1.5, &mut Media::default());
    assert!(renderer.caption_hits().is_empty());
}
