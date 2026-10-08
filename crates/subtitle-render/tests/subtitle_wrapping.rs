use serde_json::{Value, json};
use subtitle_render::*;

fn source(text: &str) -> Value {
    json!({
        "meta": {"duration": 3},
        "style": {"mode": "orig", "fontSize": 40, "width": 40,
            "x": 50, "y": 50, "lineHeight": 1.3, "background": false, "punct": false},
        "cues": [{"id": "q1", "start": 0, "end": 3, "text": text,
            "words": [{"text": text, "t0": 0, "t1": 3}]}],
        "sentences": [], "transCues": []
    })
}

fn bilingual(text: &str, order: &str, align: Option<&str>, detached: bool) -> OverlayRenderPlan {
    let mut doc = source(text);
    doc["style"]["mode"] = json!("bi");
    doc["style"]["order"] = json!(order);
    doc["style"]["gap"] = json!(12);
    doc["transCues"] = json!([{"id": "s1#0", "sid": "s1", "kind": "piece",
        "start": 0, "end": 3, "text": text}]);
    for (key, y) in [("origStyle", 45), ("transStyle", 60)] {
        doc["style"][key] = json!({"fontSize": 40});
        if let Some(align) = align {
            doc["style"][key]["verticalAlign"] = json!(align);
        }
        if detached {
            doc["style"][key]["x"] = json!(50);
            doc["style"][key]["y"] = json!(y);
        }
    }
    OverlayRenderPlan::compile(&doc, 640, 360, 3.0, 30.0, None).unwrap()
}

#[test]
fn wrapped_bilingual_lines_keep_the_seam_and_explicit_anchors() {
    let long = "这感觉像是迈出的新一步，让模型真正帮我们创造价值、完成工作、发现新科学。";
    for order in ["orig", "trans"] {
        for align in [None, Some("top"), Some("center"), Some("bottom")] {
            for detached in [false, true] {
                let mut short = bilingual("你好", order, align, detached);
                let mut wrapped = bilingual(long, order, align, detached);
                let before = short.active_layouts(1.0);
                let after = wrapped.active_layouts(1.0);
                assert_eq!(after.len(), 2);
                let a = short.stack_layout(&before, 360.0 / 540.0);
                let b = wrapped.stack_layout(&after, 360.0 / 540.0);
                for i in 0..2 {
                    assert!(after[i].lines.len() > 1);
                    let factor = match align {
                        Some("top") => 0.0,
                        Some("bottom") => 1.0,
                        Some("center") => 0.5,
                        _ if detached => 0.5,
                        _ if i == 0 => 1.0,
                        _ => 0.0,
                    };
                    let edge_before = a.placements[i].1 + factor * before[i].height;
                    let edge_after = b.placements[i].1 + factor * after[i].height;
                    assert!(
                        (edge_before - edge_after).abs() < 0.001,
                        "{order} {align:?} {detached}"
                    );
                }
                if align.is_none() && !detached {
                    assert!(b.placements[0].1 + after[0].height < b.placements[1].1);
                }
            }
        }
    }
}

#[test]
fn timed_spans_wrap_without_losing_timing_or_graphemes() {
    for text in [
        "这感觉像是迈出的新一步，让模型真正帮我们创造价值、完成工作、发现新科学。",
        "towards models that can really help us create value and discover new science",
        "SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious",
        "e\u{301}e\u{301}e\u{301}e\u{301}".repeat(20).as_str(),
    ] {
        let mut plan =
            OverlayRenderPlan::compile(&source(text), 640, 360, 3.0, 30.0, None).unwrap();
        let layouts = plan.active_layouts(1.0);
        let layout = &layouts[0];
        assert!(layout.lines.len() > 1, "{text}");
        for line in layout.lines.iter() {
            assert!(line.width <= 256.0 + 0.001, "{}: {text}", line.width);
            assert!(line.chunks.iter().all(|chunk| chunk.word == Some(0)));
        }
        assert_eq!(layout.item.text, text);
    }
}

#[test]
fn subtitle_horizontal_alignment_reads_root_and_track_override() {
    for (align, expected) in [
        ("left", LineTextAlign::Left),
        ("center", LineTextAlign::Center),
        ("right", LineTextAlign::Right),
    ] {
        for partial in [false, true] {
            let mut doc = source("Hello\nworld here");
            doc["style"]["align"] = json!(if partial { "center" } else { align });
            if partial {
                doc["style"]["origStyle"] = json!({"align": align});
            }
            let mut plan = OverlayRenderPlan::compile(&doc, 640, 360, 3.0, 30.0, None).unwrap();
            let layouts = plan.active_layouts(1.0);
            let layout = &layouts[0];
            assert_eq!(layout.text_align, expected);
            assert_eq!(layout.lines.len(), 2);
            let centers = layout
                .lines
                .iter()
                .map(|line| {
                    line_start_x(layout, line.width, 320.0)
                        + match expected {
                            LineTextAlign::Left => 0.0,
                            LineTextAlign::Center => line.width / 2.0,
                            LineTextAlign::Right => line.width,
                        }
                })
                .collect::<Vec<_>>();
            assert!((centers[0] - centers[1]).abs() < 0.001);
        }
    }
}

#[test]
fn multiline_cpu_png_and_retained_scene_share_the_layout() {
    let text = "这感觉像是迈出的新一步，让模型真正帮我们创造价值、完成工作、发现新科学。";
    for align in ["left", "center", "right"] {
        let mut doc = source(text);
        doc["style"]["mode"] = json!("bi");
        doc["style"]["align"] = json!(align);
        doc["style"]["order"] = json!("trans");
        doc["style"]["width"] = json!(80);
        doc["style"]["fontColor"] = json!("#FFFFFF");
        doc["style"]["origStyle"] = json!({"fontSize": 40});
        doc["transCues"] = json!([{"id": "s1#0", "sid": "s1", "kind": "piece",
            "start": 0, "end": 3, "text": text}]);
        doc["cues"][0]["text"] = json!("towards models that can really help us create value");
        doc["cues"][0]["words"] = json!([]);
        let mut plan = OverlayRenderPlan::compile(&doc, 640, 360, 3.0, 30.0, None).unwrap();
        let layouts = plan.active_layouts(1.0);
        assert!(layouts.iter().all(|layout| layout.lines.len() > 1));
        assert!(plan.subtitle_scene_frame(1.0).is_ok());
        let rgba = plan.render_rgba_frame(1.0).unwrap();
        let png = plan.render_png(1.0).unwrap();
        let decoded = tiny_skia::Pixmap::decode_png(&png.png).unwrap();
        assert_eq!(decoded.data(), rgba.rgba.as_slice());
        assert!(decoded.data().chunks_exact(4).any(|pixel| pixel[3] > 0));
        if let Ok(directory) = std::env::var("BCUT_WRAP_TEST_OUTPUT") {
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(
                std::path::Path::new(&directory).join(format!("{align}.png")),
                &png.png,
            )
            .unwrap();
        }
    }
}
