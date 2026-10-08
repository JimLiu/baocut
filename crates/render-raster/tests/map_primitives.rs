use anyhow::{Result, bail};
use render_raster::{CapabilityProfile, FrameMedia, PreparedBcf, TextEngine};
use scene_primitives::{HostInputs, Resolver};
use serde_json::{Value, json};
use std::sync::Arc;
use tiny_skia::Pixmap;
struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, _: &str, _: i64) -> Result<Arc<Pixmap>> {
        bail!("offscreen tile was decoded")
    }
}
fn doc(element: Value) -> Value {
    json!({"bcut":"0.2","meta":{"width":160,"height":120,"fps":30,"background":"#fff"},"scenes":[{"id":"s","dur":2}],
        "tracks":[{"id":"v","kind":"visual","clips":[{"id":"c","start":0,"end":2,"element":element}]},
        {"id":"camera","kind":"camera","clips":[{"id":"cam","start":0,"end":2,"camera":{"keyframes":[{"t":0,"v":{"x":0,"y":0,"zoom":1}},{"t":2,"v":{"x":0,"y":0,"zoom":2}}]}}]}]})
}
fn session(doc: Value, inputs: HostInputs) -> PreparedBcf {
    let mut r = Resolver::new(doc, None).unwrap();
    r.set_host_inputs(inputs);
    PreparedBcf::new(
        r.resolve().unwrap(),
        TextEngine::with_document_fonts(&[]),
        &Default::default(),
        CapabilityProfile::cpu_reference(),
    )
    .unwrap()
}
#[test]
fn screen_sized_marker_keeps_dimensions_while_its_anchor_tracks_camera() {
    let element = json!({"type":"box","children":[{"type":"box","sizeScale":"screen","style":{"x":100,"y":70,"width":10,"height":10,"background":"#00f"}}]});
    let mut r = session(doc(element), HostInputs::default());
    let a = r.render_cpu(0.0, &mut NoMedia).unwrap();
    let b = r.render_cpu(2.0, &mut NoMedia).unwrap();
    let blue = |p: &Pixmap| {
        p.pixels()
            .iter()
            .filter(|p| p.blue() == 255 && p.red() == 0)
            .count()
    };
    assert_eq!(blue(&a), 100);
    assert_eq!(blue(&b), 100);
    assert_eq!(a.pixel(105, 75).unwrap().red(), 0);
    assert_eq!(b.pixel(130, 90).unwrap().red(), 0);
    assert_eq!(b.pixel(105, 75).unwrap().red(), 255);
    assert_eq!(r.ir().camera_clips.len(), 1);
}
#[test]
fn screen_clip_ignores_camera_and_screen_stroke_keeps_its_width() {
    let element = json!({"type":"box","children":[{"type":"svg","viewBox":"0 0 160 120","style":{"width":160,"height":120},"children":[
        {"type":"path","d":"M40 60 L120 60","stroke":"#f00","strokeWidth":4,"strokeScale":"screen","lineCap":"butt"}]}]});
    let mut document = doc(element);
    let mut r = session(document.clone(), HostInputs::default());
    for t in [0.0, 2.0] {
        let frame = r.render_cpu(t, &mut NoMedia).unwrap();
        let rows = (0..120)
            .filter(|y| frame.pixel(80, *y).unwrap().green() == 0)
            .count();
        assert_eq!(rows, 4);
    }
    document["tracks"][0]["clips"][0]["space"] = json!("screen");
    let mut r = session(document, HostInputs::default());
    assert_eq!(
        r.render_cpu(0.0, &mut NoMedia).unwrap().data(),
        r.render_cpu(2.0, &mut NoMedia).unwrap().data()
    );
}
#[test]
fn invisible_tiles_do_not_request_pixel_bytes() {
    let mut document = doc(
        json!({"type":"box","children":[{"type":"image","src":"$assets.tile","style":{"x":1000,"y":1000,"width":256,"height":256}}]}),
    );
    document["assets"] = json!({"tile":{"type":"image","src":"tile.png","cache":"bounded"}});
    let mut inputs = HostInputs::default();
    inputs.insert_image("tile", 256.0, 256.0);
    session(document, inputs)
        .render_cpu(1.0, &mut NoMedia)
        .unwrap();
}

#[test]
fn camera_payload_and_asset_cache_policy_are_explicit() {
    let mut document = doc(json!({"type":"box"}));
    document["tracks"][1]["clips"][0]
        .as_object_mut()
        .unwrap()
        .remove("camera");
    assert!(
        Resolver::new(document, None)
            .unwrap()
            .resolve()
            .err()
            .unwrap()
            .to_string()
            .contains("缺少 camera")
    );
    let document = json!({"variables":[{"id":"tile","type":"asset","default":{"src":"tile.png"}}],
        "assets":{"tile":{"type":"image","var":"tile","cache":"bounded"}}});
    assert!(scene_primitives::host_requirements(&document).unwrap()[0].bounded_image);
}
#[test]
#[cfg(feature = "media")]
fn lazy_image_cache_is_bounded_and_rejects_changed_inputs() {
    use render_raster::{MediaStore, load_assets};
    let root = std::env::temp_dir().join(format!("bcf-map-cache-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    for (i, color) in [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
        .into_iter()
        .enumerate()
    {
        let mut pix = Pixmap::new(32, 32).unwrap();
        pix.fill(tiny_skia::Color::from_rgba8(
            color[0], color[1], color[2], 255,
        ));
        pix.save_png(root.join(format!("{i}.png"))).unwrap();
    }
    let document = json!({"assets":{"a":{"type":"image","src":"0.png","cache":"bounded"},"b":{"type":"image","src":"1.png","cache":"bounded"},"c":{"type":"image","src":"2.png","cache":"bounded"}}});
    let assets = Arc::new(load_assets(&document, &root).unwrap());
    assert!(assets.images.is_empty());
    assert_eq!(assets.bounded_images.len(), 3);
    let mut media = MediaStore::new(assets, 30.0).with_image_cache_limit(8192);
    let a = FrameMedia::frame(&mut media, "a", -1).unwrap();
    media.image_frame("b").unwrap();
    media.image_frame("c").unwrap();
    assert!(media.image_cache_resident_bytes() <= 8192);
    assert_eq!(a.data(), media.image_frame("a").unwrap().data());
    std::fs::write(root.join("0.png"), b"changed").unwrap();
    assert!(media.image_frame("a").is_err());
    std::fs::remove_dir_all(root).unwrap();
}
