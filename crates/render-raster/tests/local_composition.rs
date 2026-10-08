use anyhow::{Result, bail};
use render_raster::{CapabilityProfile, FrameMedia, PreparedBcf, TextEngine};
use scene_primitives::{HostInputs, resolve::Resolver};
use serde_json::{Value, json};
use std::sync::Arc;
use tiny_skia::Pixmap;

struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, _: &str, _: i64) -> Result<Arc<Pixmap>> {
        bail!("unexpected media")
    }
}
fn doc(element: Value) -> Value {
    json!({"bcut":"0.2","meta":{"width":96,"height":64,"fps":30,"background":"#000"},
    "scenes":[{"id":"s","dur":5}],"tracks":[{"id":"v","kind":"visual","clips":[
        {"id":"c","start":1,"end":5,"element":{"type":"box","style":{"width":96,"height":64},"children":[element]}}
    ]}]})
}
fn session(document: Value, inputs: HostInputs) -> PreparedBcf {
    let mut r = Resolver::new(document, None).unwrap();
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
fn local_canvas_time_and_camera_are_independent_of_parent_window() {
    let mut runtime = session(
        doc(json!({"type":"composition","id":"local",
            "canvas":{"width":96,"height":64,"duration":2},"style":{"x":10,"y":8,"width":48,"height":32},
            "timeMap":[{"t":0,"source":2},{"t":2,"source":0}],
            "camera":[{"t":0,"v":{"x":0,"y":0,"zoom":1}},{"t":2,"v":{"x":8,"y":0,"zoom":1}}],
            "children":[{"type":"box","id":"dot","style":{"x":16,"y":16,"width":16,"height":16,"background":"#f00"},
                "animate":{"keyframes":[{"prop":"x","frames":[{"t":"0%","v":0},{"t":"100%","v":32}]}]}}]
        })),
        HostInputs::default(),
    );
    // Parent time 1 -> local 2: x = 10 + (16+32-8)/2 = 30.
    let end = runtime.render_cpu(1.0, &mut NoMedia).unwrap();
    assert_eq!(end.pixel(32, 18).unwrap().red(), 255);
    assert_eq!(end.pixel(19, 18).unwrap().red(), 0);
    // Parent time 3 -> local 0: x = 10+16/2 = 18; map then clamps.
    let start = runtime.render_cpu(3.0, &mut NoMedia).unwrap();
    assert_eq!(start.pixel(19, 18).unwrap().red(), 255);
    assert_eq!(start.pixel(32, 18).unwrap().red(), 0);
    assert_eq!(
        start.data(),
        runtime.render_cpu(4.0, &mut NoMedia).unwrap().data()
    );
    assert_eq!(
        end.data(),
        runtime.render_cpu(1.0, &mut NoMedia).unwrap().data()
    );
}

#[test]
fn repeated_local_mask_ids_do_not_bind_to_another_instance() {
    let local = |x, width| {
        json!({"type":"composition","canvas":{"width":40,"height":40,"duration":4},
            "style":{"x":x,"width":40,"height":40},"children":[
            {"type":"box","id":"fill","style":{"width":40,"height":40,"background":"#f00","mask":{"source":"#mask"}}},
            {"type":"box","id":"mask","style":{"x":0,"width":width,"height":40,"background":"#fff"}}
        ]})
    };
    let mut runtime = session(
        doc(json!({"type":"box","children":[local(0,10),local(50,30)]})),
        HostInputs::default(),
    );
    let frame = runtime.render_cpu(2.0, &mut NoMedia).unwrap();
    assert_eq!(frame.pixel(5, 5).unwrap().red(), 255);
    assert_eq!(frame.pixel(15, 5).unwrap().red(), 0);
    assert_eq!(frame.pixel(75, 5).unwrap().red(), 255);
    assert_eq!(frame.pixel(85, 5).unwrap().red(), 0);
}

#[test]
fn mapped_video_audio_uses_same_source_clock_and_mutes_reverse_hold() {
    struct Frames(Vec<i64>);
    impl FrameMedia for Frames {
        fn frame(&mut self, _: &str, t: i64) -> Result<Arc<Pixmap>> {
            self.0.push(t);
            Ok(Arc::new(Pixmap::new(16, 16).unwrap()))
        }
    }
    let mut document = doc(
        json!({"type":"composition","canvas":{"width":96,"height":64,"duration":4},
        "timeMap":[{"t":0,"source":0},{"t":1,"source":2},{"t":2,"source":1},{"t":3,"source":1},{"t":4,"source":4}],
        "children":[{"type":"video","id":"video","src":"$assets.movie","withAudio":true}]}),
    );
    document["assets"] = json!({"movie":{"type":"video","src":"movie.mp4"}});
    let mut inputs = HostInputs::default();
    inputs.insert_video("movie", 16.0, 16.0, 10.0, 30.0);
    let mut runtime = session(document, inputs);
    let clips = &runtime.ir().audio_clips;
    assert_eq!(clips.len(), 2);
    assert_eq!(
        (
            clips[0].start,
            clips[0].end,
            clips[0].media_start,
            clips[0].rate
        ),
        (1.0, 2.0, 0.0, 2.0)
    );
    assert_eq!(
        (
            clips[1].start,
            clips[1].end,
            clips[1].media_start,
            clips[1].rate
        ),
        (4.0, 5.0, 1.0, 3.0)
    );
    let mut frames = Frames(Vec::new());
    for t in [1.5, 2.5, 3.5, 4.5] {
        runtime.render_cpu(t, &mut frames).unwrap();
    }
    assert_eq!(frames.0, vec![1000, 1500, 2500]);
}

#[test]
fn focal_animation_and_source_crop_do_not_change_the_layout_box() {
    struct Colors;
    impl FrameMedia for Colors {
        fn frame(&mut self, _: &str, _: i64) -> Result<Arc<Pixmap>> {
            let mut p = Pixmap::new(16, 8).unwrap();
            for y in 0..8 {
                for x in 0..16 {
                    let i = (y * 16 + x) * 4;
                    p.data_mut()[i..i + 4].copy_from_slice(if x < 8 {
                        &[255, 0, 0, 255]
                    } else {
                        &[0, 0, 255, 255]
                    });
                }
            }
            Ok(Arc::new(p))
        }
    }
    let mut document = doc(
        json!({"type":"image","id":"image","src":"$assets.photo","fit":"cover",
        "crop":{"x":0,"y":0,"width":1,"height":1},"style":{"x":0,"width":8,"height":8},
        "animate":{"keyframes":[{"prop":"focalX","frames":[{"t":"0%","v":0},{"t":"100%","v":1}]}]}}),
    );
    document["assets"] = json!({"photo":{"type":"image","src":"photo.png"}});
    let mut inputs = HostInputs::default();
    inputs.insert_image("photo", 16.0, 8.0);
    let mut runtime = session(document, inputs);
    assert_eq!(
        runtime
            .render_cpu(1.0, &mut Colors)
            .unwrap()
            .pixel(3, 3)
            .unwrap()
            .red(),
        255
    );
    assert_eq!(
        runtime
            .render_cpu(5.0, &mut Colors)
            .unwrap()
            .pixel(3, 3)
            .unwrap()
            .blue(),
        255
    );
    assert_eq!(runtime.ir().visual_clips[0].tree.children[0].frame.w, 8.0);
}

#[test]
fn invalid_maps_crops_and_cross_canvas_masks_fail_before_render() {
    for element in [
        json!({"type":"video","src":"$assets.movie","timeMap":[{"t":0,"source":0},{"t":1,"source":2}],"playbackRate":2}),
        json!({"type":"image","src":"$assets.photo","crop":{"x":0.8,"y":0,"width":0.5,"height":1}}),
        json!({"type":"composition","canvas":{"width":96,"height":64,"duration":0}}),
        json!({"type":"box","children":[
            {"type":"box","id":"outside","style":{"mask":{"source":"#inside"}}},
            {"type":"composition","canvas":{"width":10,"height":10,"duration":1},"children":[{"type":"box","id":"inside"}]}
        ]}),
    ] {
        assert!(
            Resolver::new(doc(element), None)
                .unwrap()
                .resolve()
                .is_err()
        );
    }
}

#[test]
fn standalone_audio_map_preserves_output_volume_clock() {
    let mut document = doc(json!({"type":"box"}));
    document["assets"] = json!({"voice":{"type":"audio","src":"voice.wav"}});
    document["tracks"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"a","kind":"audio","clips":[{
            "id":"voice","src":"$assets.voice","start":1,"end":5,
            "timeMap":[{"t":0,"source":1},{"t":1,"source":3},{"t":2,"source":3},{"t":4,"source":4}],
            "animate":{"keyframes":[{"prop":"volume","frames":[{"t":0,"v":0},{"t":4,"v":1}]}]}
        }]}));
    let ir = Resolver::new(document, None).unwrap().resolve().unwrap();
    assert_eq!(ir.audio_clips.len(), 2);
    assert_eq!(
        (
            ir.audio_clips[0].start,
            ir.audio_clips[0].end,
            ir.audio_clips[0].rate
        ),
        (1.0, 2.0, 2.0)
    );
    assert_eq!(
        (
            ir.audio_clips[1].start,
            ir.audio_clips[1].end,
            ir.audio_clips[1].rate
        ),
        (3.0, 5.0, 0.5)
    );
    assert_eq!(ir.audio_clips[1].volume[0].t, 1.0);
    assert_eq!(ir.audio_clips[1].volume[1].t, 5.0);
}

#[test]
fn child_effects_render_in_local_pixels_before_nonuniform_placement() {
    let child = json!({"type":"box","style":{"x":12,"y":8,"width":12,"height":12,"background":"#f00"},
        "effects":[{"preset":"filter.blur","params":{"radius":0.1}}]});
    let mut local_doc = doc(child.clone());
    local_doc["meta"]["width"] = json!(48);
    local_doc["meta"]["height"] = json!(32);
    let local = session(local_doc, HostInputs::default())
        .render_cpu(2.0, &mut NoMedia)
        .unwrap();
    let mut expected = Pixmap::new(96, 64).unwrap();
    expected.fill(tiny_skia::Color::BLACK);
    expected.draw_pixmap(
        0,
        0,
        local.as_ref(),
        &tiny_skia::PixmapPaint {
            quality: tiny_skia::FilterQuality::Bilinear,
            ..Default::default()
        },
        tiny_skia::Transform::from_scale(0.5, 0.25),
        None,
    );
    let mut nested = session(
        doc(
            json!({"type":"composition","canvas":{"width":48,"height":32,"duration":4},
        "style":{"width":24,"height":8,"background":"#000"},"children":[child]}),
        ),
        HostInputs::default(),
    );
    assert_eq!(
        expected.data(),
        nested.render_cpu(2.0, &mut NoMedia).unwrap().data()
    );
    let half = nested.render_cpu_width(2.0, &mut NoMedia, 48).unwrap();
    assert_eq!((half.width(), half.height()), (48, 32));
    assert!(half.pixel(4, 2).unwrap().red() > 0);
}

#[test]
fn local_canvases_remain_complete_inputs_to_surface_transitions() {
    let local = |color| {
        json!({"type":"composition","canvas":{"width":48,"height":32,"duration":2},
        "style":{"width":96,"height":64,"background":color}})
    };
    let mut document = doc(local("#f00"));
    let clips = document["tracks"][0]["clips"].as_array_mut().unwrap();
    clips[0]["end"] = json!(3);
    clips[0]["transitionOut"] = json!({"preset":"transition.circleCrop","dur":0.4});
    clips.push(json!({"id":"second","start":3,"end":5,"element":local("#00f")}));
    let mut runtime = session(document, HostInputs::default());
    assert_eq!(
        runtime
            .render_cpu(2.8, &mut NoMedia)
            .unwrap()
            .pixel(48, 32)
            .unwrap()
            .red(),
        255
    );
    assert_eq!(
        runtime
            .render_cpu(3.2, &mut NoMedia)
            .unwrap()
            .pixel(48, 32)
            .unwrap()
            .blue(),
        255
    );
    let middle = runtime.render_cpu(3.0, &mut NoMedia).unwrap();
    runtime.render_cpu(4.5, &mut NoMedia).unwrap();
    assert_eq!(
        middle.data(),
        runtime.render_cpu(3.0, &mut NoMedia).unwrap().data()
    );
}
