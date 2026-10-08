//! 恒等媒体元素的直通快路径（`render_media_element`）。
//!
//! `detach_main_video` 把主画面归一化成一个全长的 `mode:"pip"` / `place.w:100`
//! overlay 视频元素后，导出的每一帧都要走 `render_media_element`，而它在这种
//! 恒等形态下原本要做三次满幅 8.3 MB 分配、两次满幅 Bilinear 重采样和一次满幅
//! alpha 扫描——全部是恒等运算。快路径把它们省掉，前提是这几步在恒等参数下
//! **逐字节不改画面**；下面头两个测试就是这个前提的实测，第三个测试盯住整条
//! `render_media_element` 的输出仍等于源图，第四个盯住非恒等形态没被误判。
use serde_json::{Value, json};
use std::sync::Arc;
use subtitle_render::{OverlayRenderPlan, draw_fit_pixmap};
use timeline::schema::Fit;
use tiny_skia::{FilterQuality, Pixmap, PixmapPaint, Transform};

const WIDTH: u32 = 640;
const HEIGHT: u32 = 360;

/// 确定性噪声，premultiplied：每个通道都不超过 alpha，避免造出非法像素。
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

#[test]
fn identity_draw_fit_pixmap_is_bit_exact() {
    let source = noise(WIDTH, HEIGHT);
    let mut destination = Pixmap::new(WIDTH, HEIGHT).unwrap();
    draw_fit_pixmap(&mut destination, &source, Fit::Contain, 1.0);
    assert_eq!(destination.data(), source.data());
}

#[test]
fn identity_draw_pixmap_onto_transparent_field_is_bit_exact() {
    let local = noise(WIDTH, HEIGHT);
    let mut field = Pixmap::new(WIDTH, HEIGHT).unwrap();
    let transform = Transform::from_translate(-(WIDTH as f32) / 2.0, -(HEIGHT as f32) / 2.0)
        .post_scale(1.0, 1.0)
        .post_rotate(0.0)
        .post_translate(WIDTH as f32 / 2.0, HEIGHT as f32 / 2.0);
    assert!(
        transform.is_identity(),
        "构造出的变换不是恒等：{transform:?}"
    );
    field.draw_pixmap(
        0,
        0,
        local.as_ref(),
        &PixmapPaint {
            quality: FilterQuality::Bilinear,
            ..Default::default()
        },
        transform,
        None,
    );
    assert_eq!(field.data(), local.data());
}

#[test]
fn full_opacity_alpha_multiply_writes_nothing() {
    let source = noise(64, 64);
    let mut data = source.data().to_vec();
    render_raster::effects::multiply_premultiplied_alpha(&mut data, 1.0);
    assert_eq!(data, source.data());
}

fn studio_document() -> Value {
    json!({
        "meta": {"duration": 3.0},
        "style": {"mode": "orig", "fontFamily": "montserrat", "fontSize": 30},
        "cues": [], "sentences": [], "transCues": []
    })
}

/// `place.w` 百分比 → 是否把源图原样透出。
fn render_pip(width_percent: f64) -> Pixmap {
    let mut assets = render_raster::LoadedAssets::default();
    assets
        .images
        .insert("probe".to_owned(), Arc::new(noise(WIDTH, HEIGHT)));
    let mut plan =
        OverlayRenderPlan::compile(&studio_document(), WIDTH, HEIGHT, 3.0, 30.0, None).unwrap();
    plan.media.base = render_raster::MediaStore::new(Arc::new(assets), 30.0);
    plan.load_projected_timeline_elements(&json!({
        "timeline": {"tracks": [{"id": "t1", "kind": "overlay", "elements": [{
            "id": "el-1", "kind": "image", "srcId": "probe",
            "start": 0.0, "end": 3.0,
            "mode": "pip", "fit": "contain",
            "place": {"w": width_percent}
        }]}]}
    }))
    .unwrap();
    let element = plan.elements[0].clone();
    plan.render_media_element(&element, 1.0, Default::default())
        .unwrap()
        .expect("媒体元素必须出图")
}

/// 恒等 PIP（盒子等于画布、无 fx/mask/tile/变换、满不透明）必须逐字节透出源图。
/// 这既是快路径的正确性，也正好是快路径生效的判据。
#[test]
fn identity_pip_element_passes_the_source_through_unchanged() {
    let expected = noise(WIDTH, HEIGHT);
    let rendered = render_pip(100.0);
    assert_eq!(rendered.width(), WIDTH);
    assert_eq!(rendered.height(), HEIGHT);
    assert_eq!(rendered.data(), expected.data());
}

/// 非恒等形态不得被误判进直通：半宽 PIP 仍要真重采样并落在画布中央。
#[test]
fn scaled_pip_element_still_resamples() {
    let source = noise(WIDTH, HEIGHT);
    let rendered = render_pip(50.0);
    assert_eq!(rendered.width(), WIDTH);
    assert_eq!(rendered.height(), HEIGHT);
    assert_ne!(rendered.data(), source.data());
    // 缩到一半后画布四角必须是空的，证明走的是真变换而不是直通。
    assert_eq!(&rendered.data()[..4], &[0, 0, 0, 0]);
}
