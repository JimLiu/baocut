//! 只画了一个媒体元素的一帧带着它的外包框（`RenderedOverlayFrame::bounds`）：叠层时只看框里，框必须盖住全部非零像素。
//! 平移、缩放、旋转、镜像、缩到一半以下（预滤波）、跑出画面、不透明度都要盖住；整幅直通、平铺与不止一个元素时不给框。
use serde_json::{Value, json};
use std::sync::Arc;
use subtitle_render::OverlayRenderPlan;
use tiny_skia::Pixmap;

const WIDTH: u32 = 640;
const HEIGHT: u32 = 360;

/// 确定性噪声，premultiplied，alpha 不为零：源图每个像素都看得见，摆出去盖到的每个像素都非零。
fn noise(width: u32, height: u32) -> Pixmap {
    let mut pixmap = Pixmap::new(width, height).unwrap();
    let mut state: u32 = 0x8765_4321;
    for chunk in pixmap.data_mut().chunks_exact_mut(4) {
        let mut next = |bound: u32| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((state >> 16) % bound) as u8
        };
        let alpha = 1 + next(255);
        let cap = u32::from(alpha) + 1;
        chunk[0] = next(cap);
        chunk[1] = next(cap);
        chunk[2] = next(cap);
        chunk[3] = alpha;
    }
    pixmap
}

fn studio_document() -> Value {
    json!({
        "meta": {"duration": 3.0},
        "style": {"mode": "orig", "fontFamily": "montserrat", "fontSize": 30},
        "cues": [], "sentences": [], "transCues": []
    })
}

/// 按给定的元素画一帧，返回画面与框。
fn render(elements: Value) -> (Vec<u8>, Option<(usize, usize, usize, usize)>) {
    let mut assets = render_raster::LoadedAssets::default();
    assets
        .images
        .insert("probe".to_owned(), Arc::new(noise(WIDTH, HEIGHT)));
    let mut plan =
        OverlayRenderPlan::compile(&studio_document(), WIDTH, HEIGHT, 3.0, 30.0, None).unwrap();
    plan.media.base = render_raster::MediaStore::new(Arc::new(assets), 30.0);
    plan.load_projected_timeline_elements(&json!({
        "timeline": {"tracks": [{"id": "t1", "kind": "overlay", "elements": elements}]}
    }))
    .unwrap();
    let frame = plan.render_elements_overlay_frame(1.0).unwrap();
    (frame.rgba, frame.bounds)
}

fn image(id: &str, extra: Value) -> Value {
    let mut element = json!({
        "id": id, "kind": "image", "srcId": "probe",
        "start": 0.0, "end": 3.0, "mode": "pip", "fit": "contain"
    });
    for (key, value) in extra.as_object().unwrap() {
        element[key] = value.clone();
    }
    element
}

/// 框外没有非零像素；框里有（框不是空的时候）。
fn assert_covers(
    rgba: &[u8],
    (left, top, right, bottom): (usize, usize, usize, usize),
    label: &str,
) {
    assert!(
        right <= WIDTH as usize && bottom <= HEIGHT as usize,
        "{label}: {left},{top},{right},{bottom}"
    );
    let mut inside = 0usize;
    for (index, pixel) in rgba.chunks_exact(4).enumerate() {
        if pixel == [0, 0, 0, 0] {
            continue;
        }
        let (x, y) = (index % WIDTH as usize, index / WIDTH as usize);
        assert!(
            (left..right).contains(&x) && (top..bottom).contains(&y),
            "{label}: pixel ({x}, {y}) is outside {left},{top},{right},{bottom}"
        );
        inside += 1;
    }
    assert!(
        inside > 0 || left >= right || top >= bottom,
        "{label}: nothing drawn inside a non-empty box"
    );
}

#[test]
fn a_single_placed_picture_reports_a_box_that_covers_every_pixel() {
    let cases = [
        ("integer translate", json!({"x": 50, "y": 50, "w": 25})),
        (
            "fractional centre",
            json!({"x": 33.3, "y": 61.7, "w": 21.3}),
        ),
        (
            "scaled up",
            json!({"x": 40, "y": 45, "w": 30, "scale": 1.7}),
        ),
        (
            "prefiltered",
            json!({"x": 70, "y": 30, "w": 60, "scale": 0.2}),
        ),
        ("rotated", json!({"x": 52, "y": 48, "w": 35, "rot": 33})),
        (
            "flipped and squashed",
            json!({"x": 20, "y": 80, "w": 40, "scaleY": 0.6, "flipX": true, "flipY": true}),
        ),
        (
            "off the left and bottom",
            json!({"x": -5, "y": 105, "w": 50}),
        ),
        (
            "half transparent",
            json!({"x": 50, "y": 50, "w": 45, "opacity": 0.5, "rot": -12}),
        ),
    ];
    for (label, place) in cases {
        let (rgba, bounds) = render(json!([image("el-1", json!({"place": place}))]));
        let bounds =
            bounds.unwrap_or_else(|| panic!("{label}: a single picture must report its box"));
        assert!(
            bounds.2 - bounds.0 < WIDTH as usize,
            "{label}: the box should not be the whole frame: {bounds:?}"
        );
        assert_covers(&rgba, bounds, label);
    }
    // 完全透明：空框，整幅全零。
    let (rgba, bounds) = render(json!([image(
        "el-1",
        json!({"place": {"x": 50, "y": 50, "w": 30, "opacity": 0}})
    )]));
    assert_eq!(bounds, Some((0, 0, 0, 0)));
    assert!(rgba.iter().all(|&byte| byte == 0));
}

#[test]
fn whole_frame_tiled_or_several_elements_report_no_box() {
    // 整幅直通（与源图同尺寸、恒等摆放）：交出去的是源图本身，不给框。
    let (_, bounds) = render(json!([image("el-1", json!({"place": {"w": 100}}))]));
    assert_eq!(bounds, None);
    // 平铺盖满画面。
    let (_, bounds) = render(json!([image(
        "el-1",
        json!({"place": {"w": 20}, "tile": {"on": true}})
    )]));
    assert_eq!(bounds, None);
    // 两个元素叠在一起：这一帧不是某一层本身。
    let (_, bounds) = render(json!([
        image("el-1", json!({"place": {"x": 30, "y": 50, "w": 20}})),
        image("el-2", json!({"place": {"x": 70, "y": 50, "w": 20}})),
    ]));
    assert_eq!(bounds, None);
}
