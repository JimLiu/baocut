//! 大图缩小画时不混叠（架构设计 §9.3）：倍率低于一半时源画面先按面积平均，细纹理不再变成摩尔纹；
//! 倍率不低于一半（含 1:1 与放大）时画面与直接双线性逐字节相同。
use serde_json::{Value, json};
use std::sync::Arc;
use subtitle_render::{OverlayRenderPlan, draw_fit_pixmap};
use timeline::schema::Fit;
use tiny_skia::{FilterQuality, Pixmap, PixmapPaint, Transform};

const WIDTH: u32 = 640;
const HEIGHT: u32 = 360;

/// 不透明的灰度画面，`level(x, y)` 是像素的亮度。
fn pattern(width: u32, height: u32, level: impl Fn(u32, u32) -> u8) -> Pixmap {
    let mut pixmap = Pixmap::new(width, height).unwrap();
    for (index, pixel) in pixmap.data_mut().chunks_exact_mut(4).enumerate() {
        let value = level(index as u32 % width, index as u32 / width);
        pixel.copy_from_slice(&[value, value, value, 255]);
    }
    pixmap
}

/// 1 像素的棋盘格：缩小后理想的结果是均匀的灰。
fn checkerboard(width: u32, height: u32) -> Pixmap {
    pattern(width, height, |x, y| if (x + y) % 2 == 0 { 255 } else { 0 })
}

/// 周期 2.7 像素的正弦竖纹（看台座椅那样的细纹理）。它的频率高过缩 5 倍后能表示的上限，理想的缩小结果是
/// 均匀的灰；用正弦而不是黑白条，源里就没有像素化带来的低频拍频，起伏全算混叠。
fn grating(width: u32, height: u32) -> Pixmap {
    pattern(width, height, |x, _| {
        (127.5 + 127.5 * (std::f64::consts::TAU * f64::from(x) / 2.7).cos()).round() as u8
    })
}

/// 预乘噪声：每个分量都不超过 alpha。
fn noise(width: u32, height: u32) -> Pixmap {
    let mut pixmap = Pixmap::new(width, height).unwrap();
    let mut state: u32 = 0x1234_5678;
    for chunk in pixmap.data_mut().chunks_exact_mut(4) {
        let mut next = |bound: u32| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((state >> 16) % bound) as u8
        };
        let alpha = next(256);
        let cap = u32::from(alpha) + 1;
        chunk[0] = next(cap);
        chunk[1] = next(cap);
        chunk[2] = next(cap);
        chunk[3] = alpha;
    }
    pixmap
}

/// `[x0, x1) × [y0, y1)` 里红色分量的均值与标准差：均匀的灰标准差接近 0，摩尔纹的明暗起伏让它变大。
fn red_stats(pixmap: &Pixmap, [x0, y0, x1, y1]: [u32; 4]) -> (f64, f64) {
    let values: Vec<f64> = (y0..y1)
        .flat_map(|y| (x0..x1).map(move |x| (x, y)))
        .map(|(x, y)| f64::from(pixmap.data()[((y * pixmap.width() + x) * 4) as usize]))
        .collect();
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / values.len() as f64;
    (mean, variance.sqrt())
}

/// 改动之前的画法：一次双线性直接缩，`contain` 居中。
fn plain_bilinear(destination: &mut Pixmap, source: &Pixmap) {
    let (source_width, source_height) = (f64::from(source.width()), f64::from(source.height()));
    let (width, height) = (
        f64::from(destination.width()),
        f64::from(destination.height()),
    );
    let scale = (width / source_width).min(height / source_height);
    let transform = Transform::from_scale(scale as f32, scale as f32).post_translate(
        ((width - source_width * scale) * 0.5) as f32,
        ((height - source_height * scale) * 0.5) as f32,
    );
    destination.draw_pixmap(
        0,
        0,
        source.as_ref(),
        &PixmapPaint {
            quality: FilterQuality::Bilinear,
            ..Default::default()
        },
        transform,
        None,
    );
}

#[test]
fn a_fine_checkerboard_shrunk_five_times_stays_flat_grey() {
    let source = checkerboard(1000, 1000);
    let mut drawn = Pixmap::new(200, 200).unwrap();
    draw_fit_pixmap(&mut drawn, &source, Fit::Contain, 1.0);
    let (mean, deviation) = red_stats(&drawn, [0, 0, 200, 200]);
    // 5×5 的格子里白格 12 或 13 个：灰在 122 与 133 之间交替，起伏只剩约 5。
    assert!((mean - 127.5).abs() < 2.0, "mean {mean}");
    assert!(deviation < 8.0, "deviation {deviation}");

    // 直接双线性每个像素只读到 2×2 个源像素，这个倍率下正好落在格子中心：缩出来还是满对比的棋盘。
    let mut aliased = Pixmap::new(200, 200).unwrap();
    plain_bilinear(&mut aliased, &source);
    let (_, aliased_deviation) = red_stats(&aliased, [0, 0, 200, 200]);
    assert!(
        aliased_deviation > 100.0,
        "baseline deviation {aliased_deviation}"
    );
}

/// 按 `body`（会并进元素）画一个图片元素；返回渲染计划，好查缓存。
fn media_plan(
    source: Pixmap,
    body: Value,
) -> (OverlayRenderPlan, subtitle_render::TimelineVisualElement) {
    let mut assets = render_raster::LoadedAssets::default();
    assets.images.insert("probe".to_owned(), Arc::new(source));
    let mut plan = OverlayRenderPlan::compile(
        &json!({
            "meta": {"duration": 3.0},
            "style": {"mode": "orig", "fontFamily": "montserrat", "fontSize": 30},
            "cues": [], "sentences": [], "transCues": []
        }),
        WIDTH,
        HEIGHT,
        3.0,
        30.0,
        None,
    )
    .unwrap();
    plan.media.base = render_raster::MediaStore::new(Arc::new(assets), 30.0);
    let mut element = json!({
        "id": "el-1", "kind": "image", "srcId": "probe",
        "start": 0.0, "end": 3.0, "mode": "pip", "fit": "cover"
    });
    if let (Some(element), Value::Object(extra)) = (element.as_object_mut(), body) {
        element.extend(extra);
    }
    plan.load_projected_timeline_elements(&json!({
        "timeline": {"tracks": [{"id": "t1", "kind": "overlay", "elements": [element]}]}
    }))
    .unwrap();
    let element = plan.elements[0].clone();
    (plan, element)
}

fn render(
    plan: &mut OverlayRenderPlan,
    element: &subtitle_render::TimelineVisualElement,
) -> Arc<Pixmap> {
    plan.render_media_element(element, 1.0, Default::default())
        .unwrap()
        .expect("媒体元素必须出图")
}

#[test]
fn a_large_pip_picture_does_not_alias_and_is_averaged_once() {
    // 1600×900 的细条纹放进半宽的画中画：320×180，缩 5 倍。
    let (mut plan, element) = media_plan(grating(1600, 900), json!({"place": {"w": 50}}));
    let first = render(&mut plan, &element);
    // 盒子居中：[160, 480) × [90, 270)，边上留两像素不算。
    let inside = [162, 92, 478, 268];
    let (mean, deviation) = red_stats(&first, inside);
    assert!((mean - 127.5).abs() < 4.0, "mean {mean}");
    // 宽 5 像素的盒子对这个频率还剩不到一成的响应：起伏约 9，直接双线性约 90。
    assert!(deviation < 15.0, "deviation {deviation}");

    let mut aliased = Pixmap::new(320, 180).unwrap();
    plain_bilinear(&mut aliased, &grating(1600, 900));
    let (_, aliased_deviation) = red_stats(&aliased, [2, 2, 318, 178]);
    assert!(
        aliased_deviation > 60.0,
        "baseline deviation {aliased_deviation}"
    );

    // 同一张静态图的下一帧复用缩好的那份，画面不变。
    assert_eq!(plan.media_prefilter.len(), 1);
    let second = render(&mut plan, &element);
    assert_eq!(first.data(), second.data());
    assert_eq!(plan.media_prefilter.len(), 1);
}

#[test]
fn shrinking_the_placed_box_averages_it_too() {
    // 盒子与画布一样大（1:1 放进去），`place.scale` 再把它缩到 0.3。
    let (mut plan, element) = media_plan(
        checkerboard(WIDTH, HEIGHT),
        json!({"place": {"w": 100, "scale": 0.3}}),
    );
    let drawn = render(&mut plan, &element);
    assert!(plan.media_prefilter.is_empty(), "the fit itself is 1:1");
    // 缩后的盒子 192×108，居中在 [224, 416) × [126, 234)。
    let inside = [227, 129, 413, 231];
    let (mean, deviation) = red_stats(&drawn, inside);
    assert!((mean - 127.5).abs() < 4.0, "mean {mean}");
    assert!(deviation < 10.0, "deviation {deviation}");

    // 同一个仿射直接双线性：格子混叠成明暗块。
    let mut aliased = Pixmap::new(WIDTH, HEIGHT).unwrap();
    let half = (WIDTH as f32 / 2.0, HEIGHT as f32 / 2.0);
    aliased.draw_pixmap(
        0,
        0,
        checkerboard(WIDTH, HEIGHT).as_ref(),
        &PixmapPaint {
            quality: FilterQuality::Bilinear,
            ..Default::default()
        },
        Transform::from_translate(-half.0, -half.1)
            .post_scale(0.3, 0.3)
            .post_translate(half.0, half.1),
        None,
    );
    let (_, aliased_deviation) = red_stats(&aliased, inside);
    assert!(
        aliased_deviation > 3.0 * deviation.max(10.0),
        "baseline deviation {aliased_deviation}"
    );
}

#[test]
fn half_scale_and_larger_draw_exactly_as_before() {
    let source = noise(WIDTH, HEIGHT);
    // 0.5、0.6、1:1、放大：与改动之前的直接双线性逐字节相同。
    for (width, height) in [
        (320, 180),
        (384, 216),
        (WIDTH, HEIGHT),
        (1280, 720),
        (500, 180),
    ] {
        let mut drawn = Pixmap::new(width, height).unwrap();
        draw_fit_pixmap(&mut drawn, &source, Fit::Contain, 1.0);
        let mut before = Pixmap::new(width, height).unwrap();
        plain_bilinear(&mut before, &source);
        assert_eq!(drawn.data(), before.data(), "{width}×{height}");
    }
    // 一半以下才换画法。
    let mut drawn = Pixmap::new(313, 176).unwrap();
    draw_fit_pixmap(&mut drawn, &source, Fit::Contain, 1.0);
    let mut before = Pixmap::new(313, 176).unwrap();
    plain_bilinear(&mut before, &source);
    assert_ne!(drawn.data(), before.data());
}

#[test]
fn small_pip_pictures_skip_the_prefilter() {
    // 源比盒子还小（放大）：不缩，也不进缓存。
    let (mut plan, element) = media_plan(noise(160, 90), json!({"place": {"w": 50}}));
    render(&mut plan, &element);
    assert!(plan.media_prefilter.is_empty());
}
