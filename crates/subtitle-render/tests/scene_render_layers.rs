//! Scene-level acceptance of isolated materials and actual-backdrop composition.
use caption_scene::{Presentation, parse_style};
use render_raster::{
    TextEngine, drawop::AssociatedBlend, emissive::composite_associated_with_blend,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use subtitle_render::scene::{SceneCue, ScenePlan, SceneWord};
use tiny_skia::Pixmap;
const W: u32 = 96;
const H: u32 = 48;
const IDENTITY: [f32; 6] = [1., 0., 0., 1., 0., 0.];
const RED: &str = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8efa0d00000058101e08b41ea950000000049454e44ae426082";
const PREMULT: &str = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cf78b201000616024afcfa93580000000049454e44ae426082";
const GREEN: &str = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6310f8d070000004d50241d5dbebe20000000049454e44ae426082";
fn bytes(hex: &str) -> Vec<u8> {
    hex.as_bytes()
        .chunks_exact(2)
        .map(|v| u8::from_str_radix(std::str::from_utf8(v).unwrap(), 16).unwrap())
        .collect()
}
fn c(value: f64) -> Value {
    json!({"kind":"constant","value":value})
}
fn domain() -> Value {
    json!({"x":c(0.),"y":c(0.),"width":c(W as f64),"height":c(H as f64)})
}
fn resource(id: &str, bytes: &[u8]) -> Value {
    json!({"id":id,"assetRef":{"id":id,"revision":"1"},"contentHash":format!("sha256:{}",Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect::<String>())})
}
fn base() -> Value {
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-render-layers/1","caption-image-sequence/1","caption-noisy-sweep/1"],
        "layout":{"x":{"value":48,"basis":"absolute"},"y":{"value":24,"basis":"absolute"},"width":{"value":90,"basis":"absolute"}},
        "nodes":[{"id":"text","type":"text","style":{"fontFamily":"Noto Sans SC","fontSize":{"value":16,"basis":"absolute"},"fill":"#FFFFFF"}}]
    }}})
}
fn plan(body: Value) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Mark".into(),
            start: 0.,
            end: 2.,
            words: vec![SceneWord {
                id: "w0".into(),
                text: "Mark".into(),
                start: 0.,
                end: 2.,
            }],
        }],
        (W, H),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "layers".into(),
    )
    .unwrap()
}
fn node_layer(id: &str, materials: Value) -> Value {
    json!({"id":id,"source":{"kind":"nodes","nodeIds":["text"]},"materials":materials,"blend":"source-over"})
}
fn sequence_source(id: &str, frame: Value) -> Value {
    json!({"kind":"image-sequence","contextNodeId":"text","sequenceId":id,"frame":frame,"domain":domain(),"uvScale":[1,1],"uvOffset":[0,0]})
}
fn sequence_body(
    frames: &[Vec<u8>],
    premultiply: &str,
    frame: Value,
) -> (Value, BTreeMap<String, Vec<u8>>) {
    let mut body = base();
    let scene = &mut body["scene"]["value"];
    let assets: BTreeMap<_, _> = frames
        .iter()
        .enumerate()
        .map(|(i, b)| (format!("f{i}"), b.clone()))
        .collect();
    scene["sequences"] = json!([{"id":"sequence","premultiply":premultiply,"frames":frames.iter().enumerate().map(|(i,b)|resource(&format!("f{i}"),b)).collect::<Vec<_>>()}]);
    scene["renderLayers"] = json!([{"id":"pixels","source":sequence_source("sequence",frame),"materials":[],"blend":"source-over"}]);
    (body, assets)
}
fn all_pixels_equal(rgba: &[u8], pixel: [u8; 4]) {
    assert_eq!(rgba.len(), (W * H * 4) as usize);
    assert!(
        rgba.chunks_exact(4).all(|p| p == pixel),
        "expected constant plane {pixel:?}"
    );
}
#[test]
fn material_stack_isolation_keeps_adjacent_layer_identical() {
    let plain = plan(base()).render(0.3).unwrap().rgba;
    let mut body = base();
    body["scene"]["value"]["renderLayers"] = json!([
        node_layer(
            "masked",
            json!([{"kind":"noisy-sweep","id":"mask","contextNodeId":"text","domain":domain(),"position":c(-10.),"maskScale":[1,1],"reveal":false,"uvY":"down"}])
        ),
        node_layer("plain", json!([]))
    ]);
    let mut p = plan(body.clone());
    let (out, _) = p.render_outputs(0.3).unwrap();
    assert_eq!(out.len(), 2);
    assert!(out[0].rgba.iter().all(|v| *v == 0));
    assert_eq!(out[1].rgba, plain);
    body["scene"]["value"]["renderLayers"][0]["materials"][0]["position"] = c(2.);
    body["scene"]["value"]["renderLayers"][0]["materials"][0]["reveal"] = json!(true);
    let (shown, _) = plan(body).render_outputs(0.3).unwrap();
    assert_eq!(shown[0].rgba, plain);
    assert_eq!(shown[1].rgba, plain);
    assert!(plain.iter().any(|v| *v > 0));
}
#[test]
fn only_selected_root_subtrees_draw_while_sequence_context_remains_available() {
    let (body, assets) = sequence_body(&[bytes(RED)], "rounded", c(0.));
    let mut p = plan(body);
    p.load_resources(|r| assets.get(&r.id).cloned()).unwrap();
    let (out, hits) = p.render_outputs(0.3).unwrap();
    all_pixels_equal(&out[0].rgba, [128, 32, 16, 128]);
    assert!(
        hits.is_empty(),
        "unselected reference text must not generate visible hits"
    );
    let mut body = base();
    let scene = &mut body["scene"]["value"];
    let text = scene["nodes"][0].take();
    scene["nodes"] = json!([{"id":"selected","type":"group","children":[text]},
        {"id":"not-selected","type":"shape","properties":{"fill":{"kind":"constant","value":"#00FF00"},"width":c(96.),"height":c(48.)}}]);
    scene["renderLayers"] = json!([{"id":"letters","source":{"kind":"nodes","nodeIds":["selected"]},"materials":[],"blend":"source-over"}]);
    let (out, _) = plan(body).render_outputs(0.3).unwrap();
    assert_eq!(out[0].rgba, plan(base()).render(0.3).unwrap().rgba);
}
fn expected_blend(destination: [u8; 4], source: [u8; 4], blend: AssociatedBlend) -> [u8; 4] {
    std::array::from_fn(|i| {
        let gate = if blend == AssociatedBlend::Screen {
            source[i]
        } else {
            source[3]
        };
        (f64::from(source[i]) + f64::from(destination[i]) * (1. - f64::from(gate) / 255.))
            .round()
            .clamp(0., 255.) as u8
    })
}
#[test]
fn ordered_screen_planes_compose_against_actual_backdrop_not_a_transparent_preflatten() {
    let mut body = base();
    let scene = &mut body["scene"]["value"];
    let red = bytes(RED);
    let green = bytes(GREEN);
    scene["sequences"] = json!([{"id":"red","frames":[resource("red-frame",&red)],"premultiply":"rounded"},{"id":"green","frames":[resource("green-frame",&green)],"premultiply":"rounded"}]);
    scene["renderLayers"] = json!([
        {"id":"screen","source":sequence_source("red",c(0.)),"materials":[],"blend":"screen"},
        {"id":"front","source":sequence_source("green",c(0.)),"materials":[],"blend":"source-over"}
    ]);
    let mut p = plan(body.clone());
    p.load_resources(|r| match r.id.as_str() {
        "red-frame" => Some(red.clone()),
        "green-frame" => Some(green.clone()),
        _ => None,
    })
    .unwrap();
    let error = p.render(0.3).err().expect("Screen must require a backdrop");
    assert!(error.to_string().contains("CAPTION_BACKDROP_REQUIRED"));
    let (out, _) = p.render_outputs(0.3).unwrap();
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].blend, AssociatedBlend::Screen);
    assert_eq!(out[1].blend, AssociatedBlend::SourceOver);
    let backdrop = [24, 64, 96, 255];
    let mut target = Pixmap::new(W, H).unwrap();
    for pixel in target.data_mut().chunks_exact_mut(4) {
        pixel.copy_from_slice(&backdrop);
    }
    let mut expected = backdrop;
    for plane in &out {
        let mut src = Pixmap::new(W, H).unwrap();
        src.data_mut().copy_from_slice(&plane.rgba);
        composite_associated_with_blend(&mut target, src.as_ref(), 1., IDENTITY, None, plane.blend)
            .unwrap();
        expected = expected_blend(expected, plane.rgba[..4].try_into().unwrap(), plane.blend);
    }
    all_pixels_equal(target.data(), expected);
    let reversed = expected_blend(
        expected_blend(backdrop, [12, 181, 96, 192], AssociatedBlend::SourceOver),
        [128, 32, 16, 128],
        AssociatedBlend::Screen,
    );
    assert_ne!(
        expected, reversed,
        "output order must materially affect the real backdrop"
    );
    body["scene"]["value"]["renderLayers"]
        .as_array_mut()
        .unwrap()
        .reverse();
    let mut reverse = plan(body);
    reverse
        .load_resources(|r| match r.id.as_str() {
            "red-frame" => Some(red.clone()),
            "green-frame" => Some(green.clone()),
            _ => None,
        })
        .unwrap();
    let (out, _) = reverse.render_outputs(0.3).unwrap();
    assert_eq!(out[0].blend, AssociatedBlend::SourceOver);
    assert_eq!(out[1].blend, AssociatedBlend::Screen);
}
#[test]
fn sequence_modes_preserve_explicit_byte_premultiplication() {
    for (mode, expected) in [
        ("rounded", [128, 1, 101, 128]),
        ("shifted-byte", [128, 0, 101, 128]),
    ] {
        let (body, assets) = sequence_body(&[bytes(PREMULT)], mode, c(0.));
        let mut p = plan(body);
        p.load_resources(|r| assets.get(&r.id).cloned()).unwrap();
        let (out, _) = p.render_outputs(0.3).unwrap();
        all_pixels_equal(&out[0].rgba, expected);
    }
}
#[test]
fn nonmonotonic_sequence_seek_survives_cache_eviction_and_does_not_use_previous_frame() {
    let colors = (0..6)
        .map(|i| [20 + i * 17, 40 + i * 11, 80 + i * 9, 255])
        .collect::<Vec<[u8; 4]>>();
    let frames = colors
        .iter()
        .map(|pixel| {
            let mut png = Pixmap::new(1, 1).unwrap();
            png.data_mut().copy_from_slice(pixel);
            png.encode_png().unwrap()
        })
        .collect::<Vec<_>>();
    let frame = json!({"kind":"expression","expression":{"op":"call","function":"floor","args":[{"op":"call","function":"div","args":[{"op":"read","path":"time.pageElapsedSeconds"},{"op":"literal","type":"time","value":0.25}]}]}});
    let (body, assets) = sequence_body(&frames, "rounded", frame);
    let mut p = plan(body);
    p.load_resources(|r| assets.get(&r.id).cloned()).unwrap();
    for (t, index) in [
        (0.1, 0),
        (1.1, 4),
        (0.35, 1),
        (1.35, 5),
        (0.85, 3),
        (0.6, 2),
        (0.1, 0),
    ] {
        let (out, _) = p.render_outputs(t).unwrap();
        all_pixels_equal(&out[0].rgba, colors[index]);
    }
    let (out, hits) = p.render_outputs(2.).unwrap();
    assert!(out.iter().all(|p| p.rgba.iter().all(|v| *v == 0)));
    assert!(hits.is_empty());
}
#[test]
fn valid_header_bad_payload_fails_only_when_selected_and_does_not_poison_good_cached_frame() {
    let good = bytes(RED);
    let mut bad = bytes(GREEN);
    bad[45] ^= 0xff;
    let frame = json!({"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"lt","args":[{"op":"read","path":"time.pageElapsedSeconds"},{"op":"literal","type":"time","value":0.5}]},"then":{"op":"literal","type":"scalar","value":0},"else":{"op":"literal","type":"scalar","value":1}}});
    let (body, assets) = sequence_body(&[good, bad], "rounded", frame);
    let mut p = plan(body);
    p.load_resources(|r| assets.get(&r.id).cloned())
        .expect("hash/header validation must not eagerly decode IDAT");
    let first = p.render_outputs(0.2).unwrap().0[0].rgba.clone();
    assert!(p.render_outputs(0.8).is_err());
    assert_eq!(first, p.render_outputs(0.2).unwrap().0[0].rgba);
}
#[test]
fn missing_digest_and_header_fail_during_load_atomically() {
    let (body, assets) = sequence_body(&[bytes(RED), bytes(GREEN)], "rounded", c(0.));
    let mut p = plan(body.clone());
    p.load_resources(|r| assets.get(&r.id).cloned()).unwrap();
    let good = p.render_outputs(0.2).unwrap().0[0].rgba.clone();
    assert!(
        p.load_resources(|r| if r.id == "f1" {
            None
        } else {
            assets.get(&r.id).cloned()
        })
        .is_err()
    );
    assert_eq!(good, p.render_outputs(0.2).unwrap().0[0].rgba);
    assert!(
        plan(body).load_resources(|_| Some(bytes(RED))).is_err(),
        "declared digest must bind each frame's bytes"
    );
    let invalid = b"not a PNG even though its digest matches".to_vec();
    let (body, assets) = sequence_body(&[invalid], "rounded", c(0.));
    assert!(
        plan(body)
            .load_resources(|r| assets.get(&r.id).cloned())
            .is_err()
    );
}
#[test]
fn dynamically_invalid_frame_index_and_domain_fail_instead_of_clamping_or_reusing() {
    for (case, value) in [("frame", 2.0), ("width", 0.0)] {
        let (mut body, assets) = sequence_body(&[bytes(RED), bytes(GREEN)], "rounded", c(0.));
        let expression = json!({"kind":"expression","expression":{"op":"literal","type":if case=="frame"{"scalar"}else{"length"},"value":value}});
        if case == "frame" {
            body["scene"]["value"]["renderLayers"][0]["source"]["frame"] = expression;
        } else {
            body["scene"]["value"]["renderLayers"][0]["source"]["domain"]["width"] = expression;
        }
        let mut p = plan(body);
        p.load_resources(|r| assets.get(&r.id).cloned()).unwrap();
        assert!(
            p.render_outputs(0.2).is_err(),
            "invalid {case} was silently accepted"
        );
    }
}
#[test]
fn independently_filtered_text_roots_keep_their_own_pixels_and_contexts() {
    let mut body = base();
    let scene = &mut body["scene"]["value"];
    scene["nodes"][0]["properties"] = json!({"transform.x":c(-12.)});
    let mut other = scene["nodes"][0].clone();
    other["id"] = json!("other");
    other["style"]["fill"] = json!("#00FF00");
    other["style"]["fontSize"] = json!({"value":22,"basis":"absolute"});
    other["properties"] = json!({"transform.x":c(12.)});
    let left_node = scene["nodes"][0].clone();
    let right_node = other.clone();
    scene["nodes"].as_array_mut().unwrap().push(other);
    scene["renderLayers"] = json!([
        {"id":"left","source":{"kind":"nodes","nodeIds":["text"]},"materials":[{"kind":"noisy-sweep","id":"left-mask","contextNodeId":"text","domain":domain(),"position":c(-10.),"maskScale":[1,1],"reveal":false,"uvY":"down"}],"blend":"source-over"},
        {"id":"right","source":{"kind":"nodes","nodeIds":["other"]},"materials":[{"kind":"noisy-sweep","id":"right-mask","contextNodeId":"other","domain":domain(),"position":c(2.),"maskScale":[1,1],"reveal":true,"uvY":"down"}],"blend":"source-over"}
    ]);
    let mut left = base();
    left["scene"]["value"]["nodes"] = json!([left_node]);
    let left_pixels = plan(left).render(0.3).unwrap().rgba;
    let mut right = base();
    right["scene"]["value"]["nodes"] = json!([right_node]);
    let right_pixels = plan(right).render(0.3).unwrap().rgba;
    assert_ne!(left_pixels, right_pixels);
    let (out, _) = plan(body.clone()).render_outputs(0.3).unwrap();
    assert!(out[0].rgba.iter().all(|v| *v == 0));
    assert_eq!(out[1].rgba, right_pixels);
    body["scene"]["value"]["renderLayers"][0]["materials"][0]["position"] = c(2.);
    body["scene"]["value"]["renderLayers"][0]["materials"][0]["reveal"] = json!(true);
    let (out, _) = plan(body).render_outputs(0.3).unwrap();
    assert_eq!(out[0].rgba, left_pixels);
    assert_eq!(out[1].rgba, right_pixels);
}
#[test]
fn fractional_frame_values_floor_without_interpolating_neighbor_images() {
    for (value, color) in [(0.999, [128, 32, 16, 128]), (1.0, [12, 181, 96, 192])] {
        let (body, assets) = sequence_body(&[bytes(RED), bytes(GREEN)], "rounded", c(value));
        let mut p = plan(body);
        p.load_resources(|r| assets.get(&r.id).cloned()).unwrap();
        let (out, _) = p.render_outputs(0.3).unwrap();
        all_pixels_equal(&out[0].rgba, color);
    }
}
#[test]
fn padded_blur_stack_does_not_resize_or_blur_an_adjacent_surface() {
    let plain = plan(base()).render(0.3).unwrap().rgba;
    let mut body = base();
    body["scene"]["value"]["renderLayers"] = json!([
        node_layer(
            "blurred",
            json!([{"kind":"blur","id":"soft","radius":c(3.0),"passes":1}])
        ),
        node_layer("sharp", json!([]))
    ]);
    let (out, _) = plan(body).render_outputs(0.3).unwrap();
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].rgba.len(), plain.len());
    assert_ne!(out[0].rgba, plain);
    assert_eq!(out[1].rgba, plain);
}
#[test]
fn add_planes_sum_every_component_on_the_actual_backdrop() {
    let mut body = base();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-layer-add/1"));
    let red = bytes(RED);
    let green = bytes(GREEN);
    scene["sequences"] = json!([{"id":"red","frames":[resource("red-frame",&red)],"premultiply":"rounded"},{"id":"green","frames":[resource("green-frame",&green)],"premultiply":"rounded"}]);
    scene["renderLayers"] = json!([
        {"id":"red","source":sequence_source("red",c(0.)),"materials":[],"blend":"add"},
        {"id":"green","source":sequence_source("green",c(0.)),"materials":[],"blend":"add"}
    ]);
    let mut p = plan(body.clone());
    p.load_resources(|r| match r.id.as_str() {
        "red-frame" => Some(red.clone()),
        "green-frame" => Some(green.clone()),
        _ => None,
    })
    .unwrap();
    let error = p.render(0.3).err().expect("Add must require a backdrop");
    assert!(error.to_string().contains("CAPTION_BACKDROP_REQUIRED"));
    let (out, _) = p.render_outputs(0.3).unwrap();
    assert_eq!(out.len(), 2);
    assert!(out.iter().all(|plane| plane.blend == AssociatedBlend::Add));
    let backdrop = [24, 64, 96, 255];
    let mut target = Pixmap::new(W, H).unwrap();
    for pixel in target.data_mut().chunks_exact_mut(4) {
        pixel.copy_from_slice(&backdrop);
    }
    for plane in &out {
        let mut src = Pixmap::new(W, H).unwrap();
        src.data_mut().copy_from_slice(&plane.rgba);
        composite_associated_with_blend(&mut target, src.as_ref(), 1., IDENTITY, None, plane.blend)
            .unwrap();
    }
    // red [128,32,16,128] + green [12,181,96,192] + backdrop, clamped per component.
    all_pixels_equal(target.data(), [164, 255, 208, 255]);
    let mut missing = body;
    missing["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-layer-add/1");
    assert!(parse_style(&missing).is_err());
}
