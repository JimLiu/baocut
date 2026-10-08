//! 量文字元素的框（`FrameRenderer::measure_text`）：量出来的宽放得下画出来的字，按它摆的框不折行。

mod common;

use common::*;
use frame_render::Documents;
use serde_json::{Value, json};

/// 「添加文本框」那样的样式：白字、贴字的底板、居中。字号以 540 短边为基准，这块 160×90 的画布上是 20 像素。
fn style() -> Value {
    json!({
        "fontSize": 120, "fontWeight": "bold", "fontColor": "#FFFFFF", "lineHeight": 1.2, "textAlign": "center",
        "backgroundColor": "#000000CC", "backgroundStyle": "wrap", "backgroundPadding": 14, "borderRadius": 12
    })
}

fn titled(text: &str, w: f64) -> Vec<u8> {
    let video = video(
        vec![item(
            "title",
            0,
            30,
            json!({ "type": "text", "text": text, "style": style(), "place": { "x": 50, "y": 50, "w": w } }),
        )],
        vec![],
        json!({}),
    );
    render(&video, 0.5, &mut Media::default())
}

#[test]
fn a_box_as_wide_as_measured_keeps_the_text_on_one_line() {
    for text in ["输入文字", "Hello world"] {
        let measured = renderer(false, Documents::default()).measure_text(text, &style(), None, (W, H));
        assert!(measured.width > 20.0 && measured.width < f64::from(W), "{text}：{measured:?}");
        let w = measured.width / f64::from(W) * 100.0;
        // 框宽就是量出来的宽：与宽得多的框画得一样（居中、一行）。
        assert_eq!(titled(text, w), titled(text, 100.0), "{text} 按量出来的框宽画成了两行");
        // 窄一截就折成两行，画出来更高：说明上面那条比的是折行，不是巧合。
        let (_, top, _, bottom) = painted_bounds(&titled(text, w * 0.55)).unwrap();
        let (_, one_top, _, one_bottom) = painted_bounds(&titled(text, w)).unwrap();
        assert!(bottom - top > one_bottom - one_top, "{text}：窄框应当折行");
    }
}

#[test]
fn a_given_wrap_width_is_the_box_width_and_extra_lines_add_height() {
    let mut renderer = renderer(false, Documents::default());
    let one = renderer.measure_text("输入文字", &style(), None, (W, H));
    let wrapped = renderer.measure_text("输入文字", &style(), Some(one.width * 0.55), (W, H));
    assert_eq!(wrapped.width, one.width * 0.55);
    assert!(wrapped.height > one.height * 1.5, "{one:?} → {wrapped:?}");
    // 字号随画布短边：画布大一倍，框也大一倍左右。
    let large = renderer.measure_text("输入文字", &style(), None, (W * 2, H * 2));
    assert!((large.width / one.width - 2.0).abs() < 0.1, "{one:?} → {large:?}");
}
