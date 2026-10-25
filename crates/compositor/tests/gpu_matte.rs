//! Independent RGBA8 matte arithmetic. Bitmap texel centres are exact; no claim
//! of whole-glyph AA equivalence from bitmap fixtures; the real ScenePlan case
//! below checks actual prepare_for_canvas pixels without assuming an AA excuse.
#![cfg(feature = "gpu")]
use caption_scene::{Presentation, parse_style};
use compositor::{CaptionGpuRenderer, RenderTarget};
use motion::effect::BlendMode;
use render_raster::TextEngine;
use render_raster::{
    drawop::{AssociatedBlend, BitmapData, DrawOp, FrameOps, GradientStop, PaintData, path_from_skia},
    effects::material_plan::{MaterialFrame, MaterialLayer, MaterialSource},
    raster::{FrameMedia, rasterize_with_media},
};
use serde_json::{Value, json};
use std::sync::Arc;
use subtitle_render::scene::{SceneCue, ScenePlan};

const W: u32 = 8;
const H: u32 = 8;
const ID: [f32; 6] = [1., 0., 0., 1., 0., 0.];
struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, _: &str, _: i64) -> anyhow::Result<Arc<tiny_skia::Pixmap>> {
        anyhow::bail!("matte oracle does not request media")
    }
}
fn device(trace: wgpu::Trace) -> Option<(wgpu::Device, wgpu::Queue, String, String)> {
    let available = (|| {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: if cfg!(target_os = "macos") {
                wgpu::Backends::METAL
            } else {
                wgpu::Backends::all()
            },
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let adapter = pollster::block_on(instance.request_adapter(&Default::default())).ok()?;
        let info = adapter.get_info();
        eprintln!("matte adapter={} backend={:?} type={:?}", info.name, info.backend, info.device_type);
        if std::env::var_os("BAOCUT_REQUIRE_GPU").is_some() {
            assert_ne!(info.device_type, wgpu::DeviceType::Cpu, "hardware GPU required");
        }
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            required_limits: adapter.limits(),
            trace,
            ..Default::default()
        }))
        .ok()?;
        Some((device, queue, format!("{:?}", info.backend).to_lowercase(), info.name))
    })();
    assert!(
        available.is_some() || std::env::var_os("BAOCUT_REQUIRE_GPU").is_none(),
        "required GPU test cannot skip"
    );
    available
}
fn target(device: &wgpu::Device) -> wgpu::Texture {
    target_size(device, W, H)
}
fn target_size(device: &wgpu::Device, width: u32, height: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("matte-oracle-target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}
fn write(queue: &wgpu::Queue, texture: &wgpu::Texture, bytes: &[u8]) {
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        bytes,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(W * 4),
            rows_per_image: Some(H),
        },
        wgpu::Extent3d {
            width: W,
            height: H,
            depth_or_array_layers: 1,
        },
    );
}
fn read(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture) -> Vec<u8> {
    read_size(device, queue, texture, W, H)
}
fn read_size(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture, width: u32, height: u32) -> Vec<u8> {
    let stride = (width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("matte-test-only-readback"),
        size: u64::from(stride * height),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(stride),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit(Some(encoder.finish()));
    let slice = buffer.slice(..);
    let (send, receive) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = send.send(result);
    });
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    receive.recv().unwrap().unwrap();
    let bytes = slice.get_mapped_range().unwrap();
    bytes
        .chunks_exact(stride as usize)
        .flat_map(|row| row[..(width * 4) as usize].iter().copied())
        .collect()
}
fn bitmap(bytes: Vec<u8>) -> BitmapData {
    BitmapData {
        width: W,
        height: H,
        rgba: Arc::from(bytes),
    }
}
fn draw(index: u32) -> DrawOp {
    // These fixtures intentionally include RGB > alpha (including alpha zero).
    // Preserve independent associated components through their explicit opcode.
    DrawOp::DrawEmissiveBitmap {
        blend: AssociatedBlend::SourceOver,
        bitmap: index,
        opacity: 1.,
        tf: ID,
    }
}
fn group(opacity: f32) -> DrawOp {
    DrawOp::PushLayer {
        opacity,
        blend: BlendMode::Normal,
    }
}
fn frame(bitmaps: &[Vec<u8>], ops: Vec<DrawOp>) -> Arc<FrameOps> {
    Arc::new(FrameOps {
        ops,
        bitmaps: bitmaps.iter().cloned().map(bitmap).collect(),
        ..Default::default()
    })
}
fn material(source: Arc<FrameOps>) -> MaterialFrame {
    MaterialFrame {
        width: W,
        height: H,
        layers: vec![MaterialLayer {
            source: MaterialSource::Draw(source),
            materials: vec![],
            blend: AssociatedBlend::SourceOver,
        }],
    }
}
fn rejected_with_valid_prefix(source: Arc<FrameOps>, data: &[Vec<u8>]) -> MaterialFrame {
    let mut result = material(source);
    result.layers.insert(
        0,
        MaterialLayer {
            source: MaterialSource::Draw(frame(data, vec![draw(0)])),
            materials: vec![],
            blend: AssociatedBlend::SourceOver,
        },
    );
    result
}
fn cpu(source: &FrameOps) -> Vec<u8> {
    rasterize_with_media(source, W, H, &mut NoMedia).unwrap().data().to_vec()
}
fn render(renderer: &mut CaptionGpuRenderer, frame: &MaterialFrame, target: &wgpu::Texture) {
    let view = target.create_view(&Default::default());
    let stats = renderer
        .render(
            frame,
            RenderTarget {
                view: &view,
                width: frame.width,
                height: frame.height,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            true,
        )
        .expect("supported matte frame");
    assert_eq!(
        stats.submissions, 1,
        "live rendering must use one submission; test readback is separate"
    );
}
fn patterns() -> Vec<Vec<u8>> {
    let content = [
        [17, 23, 31, 255],
        [100, 50, 20, 128],
        [0, 0, 0, 0],
        [231, 111, 57, 64],
        [63, 127, 191, 255],
        [192, 80, 48, 0],
        [128, 128, 128, 128],
        [9, 3, 1, 16],
    ];
    let mask = [
        [255, 255, 255, 255],
        [90, 20, 10, 128],
        [0, 0, 0, 0],
        [20, 100, 40, 255],
        [255, 0, 0, 0],
        [10, 10, 10, 128],
        [0, 0, 255, 255],
        [255, 255, 255, 128],
    ];
    let next = [
        [32, 48, 64, 128],
        [10, 20, 5, 32],
        [0, 0, 0, 0],
        [0, 0, 0, 255],
        [17, 23, 31, 255],
        [12, 6, 3, 16],
        [0, 0, 0, 0],
        [25, 0, 0, 64],
    ];
    [content, mask, next]
        .into_iter()
        .map(|values| (0..W * H).flat_map(|i| values[i as usize % 8]).collect())
        .collect()
}
// Entirely integer expected pixels; no GPU uniforms, shader code or planner is read.
fn mul(value: u8, factor: u32) -> u8 {
    ((u32::from(value) * factor + 127) / 255) as u8
}
fn matte(content: &[u8], mask: &[u8], mode: u8) -> Vec<u8> {
    content
        .chunks_exact(4)
        .zip(mask.chunks_exact(4))
        .flat_map(|(c, m)| {
            let luma = (13933 * u32::from(m[0]) + 46871 * u32::from(m[1]) + 4732 * u32::from(m[2])) >> 16;
            let factor = match mode {
                0 => u32::from(m[3]),
                1 => 255 - u32::from(m[3]),
                2 => luma,
                3 => 255 - luma,
                _ => panic!("oracle mode"),
            };
            c.iter().map(move |v| mul(*v, factor))
        })
        .collect()
}
fn opacity(content: &[u8], factor: u32) -> Vec<u8> {
    content.iter().map(|v| mul(*v, factor)).collect()
}
fn over(source: &[u8], destination: &[u8]) -> Vec<u8> {
    source
        .chunks_exact(4)
        .zip(destination.chunks_exact(4))
        .flat_map(|(s, d)| {
            let inverse = 255 - u32::from(s[3]);
            (0..4).map(move |c| (u32::from(s[c]) + (u32::from(d[c]) * inverse + 127) / 255).min(255) as u8)
        })
        .collect()
}
fn same(actual: &[u8], expected: &[u8], context: &str) {
    assert_eq!(actual.len(), expected.len());
    for (index, (a, b)) in actual.iter().zip(expected).enumerate() {
        assert_eq!(
            a,
            b,
            "{context} pixel({},{}), channel{}",
            (index / 4) % W as usize,
            (index / 4) / W as usize,
            index % 4
        );
    }
}

#[test]
fn all_four_matte_modes_match_independent_integer_bytes_cpu_and_gpu() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let data = patterns();
    for mode in 0..4 {
        let source = frame(
            &data,
            vec![
                group(1.),
                draw(0),
                DrawOp::PushMatte,
                draw(1),
                DrawOp::PopMatte { mode },
                DrawOp::PopLayer,
            ],
        );
        let expected = matte(&data[0], &data[1], mode);
        same(&cpu(&source), &expected, &format!("CPU mode{mode}"));
        render(&mut renderer, &material(source), &output);
        same(&read(&device, &queue, &output), &expected, &format!("GPU mode{mode}"));
    }
}

#[test]
fn nested_and_sequential_mattes_group_opacity_and_later_draw_keep_order() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let data = patterns();
    let nested = frame(
        &data,
        vec![
            group(128. / 255.),
            draw(0),
            DrawOp::PushMatte,
            group(1.),
            draw(1),
            DrawOp::PushMatte,
            draw(2),
            DrawOp::PopMatte { mode: 0 },
            DrawOp::PopLayer,
            DrawOp::PopMatte { mode: 3 },
            DrawOp::PopLayer,
            draw(2),
        ],
    );
    let nested_mask = matte(&data[1], &data[2], 0);
    let expected = over(&data[2], &opacity(&matte(&data[0], &nested_mask, 3), 128));
    same(&cpu(&nested), &expected, "CPU nested/order/opacity");
    render(&mut renderer, &material(nested), &output);
    same(&read(&device, &queue, &output), &expected, "GPU nested/order/opacity");
    let sequential = frame(
        &data,
        vec![
            group(1.),
            draw(0),
            DrawOp::PushMatte,
            draw(1),
            DrawOp::PopMatte { mode: 0 },
            DrawOp::PushMatte,
            draw(2),
            DrawOp::PopMatte { mode: 1 },
            DrawOp::PopLayer,
        ],
    );
    let expected = matte(&matte(&data[0], &data[1], 0), &data[2], 1);
    same(&cpu(&sequential), &expected, "CPU sequential");
    render(&mut renderer, &material(sequential), &output);
    same(&read(&device, &queue, &output), &expected, "GPU sequential");
    // Restore the first accepted case after another render to exercise pooled
    // targets and rule out stale in-place source/matte aliasing.
    let first = frame(
        &data,
        vec![
            group(1.),
            draw(0),
            DrawOp::PushMatte,
            draw(1),
            DrawOp::PopMatte { mode: 2 },
            DrawOp::PopLayer,
        ],
    );
    let expected = matte(&data[0], &data[1], 2);
    render(&mut renderer, &material(first), &output);
    same(&read(&device, &queue, &output), &expected, "GPU pooled target restoration");
}

#[test]
fn directly_nested_mattes_and_empty_masks_keep_exact_bytes() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let data = patterns();
    // The inner matte targets the enclosing matte directly, with no intervening
    // PushLayer. Its filtered RGBA becomes the outer matte's source.
    let direct = frame(
        &data,
        vec![
            group(1.),
            draw(0),
            DrawOp::PushMatte,
            draw(1),
            DrawOp::PushMatte,
            draw(2),
            DrawOp::PopMatte { mode: 1 },
            DrawOp::PopMatte { mode: 2 },
            DrawOp::PopLayer,
        ],
    );
    let expected = matte(&data[0], &matte(&data[1], &data[2], 1), 2);
    same(&cpu(&direct), &expected, "CPU directly nested mattes");
    render(&mut renderer, &material(direct), &output);
    same(&read(&device, &queue, &output), &expected, "GPU directly nested mattes");
    for mode in [0, 1] {
        let empty = frame(
            &data,
            vec![group(1.), draw(0), DrawOp::PushMatte, DrawOp::PopMatte { mode }, DrawOp::PopLayer],
        );
        let expected = matte(&data[0], &vec![0; (W * H * 4) as usize], mode);
        same(&cpu(&empty), &expected, "CPU empty matte");
        render(&mut renderer, &material(empty), &output);
        same(&read(&device, &queue, &output), &expected, "GPU empty matte");
    }
}

#[test]
fn nested_linear_matte_has_only_existing_gradient_rounding_and_exact_products() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let data = patterns();
    let path = path_from_skia(&tiny_skia::PathBuilder::from_rect(
        tiny_skia::Rect::from_xywh(0., 0., W as f32, H as f32).unwrap(),
    ));
    let paint = PaintData::Linear {
        p0: [0., 0.],
        p1: [W as f32, 0.],
        stops: vec![
            GradientStop {
                offset: 0.,
                color: [1., 0.25, 0., 0.25],
            },
            GradientStop {
                offset: 1.,
                color: [0., 0.5, 1., 0.75],
            },
        ],
    };
    let gradient_op = DrawOp::FillPathPaint {
        path: 0,
        paint: 0,
        even_odd: false,
        tf: ID,
    };
    let gradient_source = || {
        Arc::new(FrameOps {
            ops: vec![gradient_op.clone()],
            paths: vec![path.clone()],
            paints: vec![paint.clone()],
            ..Default::default()
        })
    };
    let cpu_gradient = cpu(&gradient_source());
    render(&mut renderer, &material(gradient_source()), &output);
    let gpu_gradient = read(&device, &queue, &output);
    // Verify the independent CPU control first; permit only the existing one-
    // byte gradient interpolation/UNORM difference, never mask arithmetic error.
    for (index, (a, b)) in gpu_gradient.iter().zip(&cpu_gradient).enumerate() {
        assert!(a.abs_diff(*b) <= 1, "unmasked gradient control byte{index}: GPU={a}, CPU={b}");
    }
    assert!(cpu_gradient.chunks_exact(4).all(|p| p[3] > 0 && p[3] < 255));
    let nested = Arc::new(FrameOps {
        ops: vec![
            group(1.),
            draw(0),
            DrawOp::PushMatte,
            gradient_op,
            DrawOp::PushMatte,
            draw(2),
            DrawOp::PopMatte { mode: 0 },
            DrawOp::PopMatte { mode: 3 },
            DrawOp::PopLayer,
        ],
        bitmaps: data.iter().cloned().map(bitmap).collect(),
        paths: vec![path],
        paints: vec![paint],
        ..Default::default()
    });
    let cpu_expected = matte(&data[0], &matte(&cpu_gradient, &data[2], 0), 3);
    same(&cpu(&nested), &cpu_expected, "CPU gradient nested integer products");
    // The unmasked GPU control is independently checked above. Reuse its input
    // texel values, not the masked output or shader, to require exact integer
    // products separately from the documented gradient rounding difference.
    let gpu_expected = matte(&data[0], &matte(&gpu_gradient, &data[2], 0), 3);
    render(&mut renderer, &material(nested), &output);
    same(
        &read(&device, &queue, &output),
        &gpu_expected,
        "GPU gradient nested integer products",
    );
}

fn masked_text_scene(paint: Value) -> ScenePlan {
    masked_text_scene_with_mode(paint, false, false)
}

fn masked_text_scene_with_mode(paint: Value, local: bool, inverted: bool) -> ScenePlan {
    let mut style = json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-expressions/1","caption-paint-stack/1",
            "caption-paint-effects/1","caption-paint-mask/1","caption-gradient-space/1","caption-gradient-glyph/1"],
        "layout":{"x":{"value":80,"basis":"absolute"},"y":{"value":48,"basis":"absolute"},
            "width":{"value":150,"basis":"absolute"},"maxLines":1},
        "nodes":[{"id":"text","type":"text","style":{"fontFamily":"Noto Sans SC",
            "fontSize":{"value":36,"basis":"absolute"},"fill":"#FFFFFF",
            "paints":[{"id":"masked","paint":paint,"unit":"px","offset":[4.25,-2.5],
                "mask":{"kind":"glyph-fill","spread":2}}]},
            "properties":{"opacity":{"kind":"constant","value":0.5},
                "transform.rotation":{"kind":"constant","value":17},
                "transform.scaleX":{"kind":"constant","value":1.15},
                "transform.scaleY":{"kind":"constant","value":0.85}}}],
        "animations":[{"id":"move","target":{"nodeId":"text"},"property":"transform.x","composite":"replace",
            "value":{"kind":"keyframes","clock":{"unit":"cue","origin":"start","duration":{"kind":"unit-span"}},
                "keys":[{"at":0,"value":-3},{"at":1,"value":4}]}}]
    }}});
    if local {
        style["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-paint-mask-local/1"));
        style["scene"]["value"]["nodes"][0]["style"]["paints"][0]["mask"]["rasterization"] = json!("glyph-bounds");
    }
    if inverted {
        style["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-paint-mask-transform/1"));
        let mask = &mut style["scene"]["value"]["nodes"][0]["style"]["paints"][0]["mask"];
        mask["inverted"] = json!(true);
        mask["offset"] = json!([-3.0, 2.0]);
    }
    ScenePlan::compile(
        parse_style(&style).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "OO".into(),
            start: 0.,
            end: 2.,
            words: vec![],
        }],
        (160, 96),
        TextEngine::with_document_fonts(&[include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec()]),
        "actual-masked-text".into(),
    )
    .unwrap()
}

#[test]
fn local_mask_bitmaps_reduce_gpu_surfaces_and_preserve_pixels_and_reverse_seek() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target_size(&device, 160, 96);
    for inverted in [false, true] {
        for (kind, paint) in [
            ("solid", json!({"kind":"solid","color":"#2ABBD0"})),
            (
                "gradient",
                json!({"kind":"linear","space":"normalized","domain":"glyph","from":[0,0],"to":[1,1],
                    "stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]}),
            ),
        ] {
            let mut legacy_scene = masked_text_scene_with_mode(paint.clone(), false, inverted);
            let (legacy_frame, _) = legacy_scene.record_material_plan(0.2).unwrap();
            assert!(legacy_frame.layers.iter().any(|layer| {
                let MaterialSource::Draw(ops) = &layer.source else { return false };
                ops.ops.iter().any(|op| matches!(op, DrawOp::PushMatte))
            }));
            let mut legacy = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend.clone(), adapter.clone());
            let legacy_stats = legacy
                .render(
                    &legacy_frame,
                    RenderTarget {
                        view: &output.create_view(&Default::default()),
                        width: 160,
                        height: 96,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                    },
                    true,
                )
                .unwrap();
            assert_eq!(legacy_stats.submissions, 1);

            let mut local_scene = masked_text_scene_with_mode(paint, true, inverted);
            let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend.clone(), adapter.clone());
            let mut seen = std::collections::BTreeMap::new();
            let mut uploaded_bitmaps = std::collections::BTreeSet::new();
            let mut previous_uploads = 0;
            for time in [0.2_f64, 0.8, 0.1, 0.8, 0.2] {
                let cpu = local_scene.render(time).unwrap();
                let (frame, _) = local_scene.record_material_plan(time).unwrap();
                let mut draws = 0;
                for layer in &frame.layers {
                    let MaterialSource::Draw(ops) = &layer.source else {
                        panic!("local mask must retain an ordered DrawOp source");
                    };
                    assert!(!ops.bitmaps.is_empty(), "explicit local mode must produce real bitmap bytes");
                    for bitmap in &ops.bitmaps {
                        let area = u64::from(bitmap.width) * u64::from(bitmap.height);
                        assert!(bitmap.width < 160 && bitmap.height < 96 && area < 160 * 96 / 2);
                        assert_eq!(bitmap.rgba.len() as u64, area * 4);
                        uploaded_bitmaps.insert((bitmap.width, bitmap.height, bitmap.rgba.to_vec()));
                    }
                    for op in &ops.ops {
                        match op {
                            DrawOp::DrawBitmap { opacity, tf, .. } => {
                                draws += 1;
                                assert_eq!(*opacity, 1.0, "glyph opacity is already included once");
                                assert_eq!(&tf[..4], &[1., 0., 0., 1.]);
                                assert_eq!(tf[4].fract(), 0.0);
                                assert_eq!(tf[5].fract(), 0.0);
                            }
                            DrawOp::PushLayer { .. } | DrawOp::PopLayer | DrawOp::Clear { .. } => {}
                            _ => panic!("local mask unexpectedly retained vector/matte work: {op:?}"),
                        }
                    }
                }
                assert_eq!(draws, 2, "OO must preserve per-glyph masking and order");
                let stats = renderer
                    .render(
                        &frame,
                        RenderTarget {
                            view: &output.create_view(&Default::default()),
                            width: 160,
                            height: 96,
                            format: wgpu::TextureFormat::Rgba8Unorm,
                        },
                        true,
                    )
                    .unwrap();
                assert_eq!(stats.submissions, 1);
                assert_eq!(stats.prepared_strokes, 0, "local IR must not prepare vector strokes");
                // This historical counter includes cached RGBA bitmap uploads;
                // zero would incorrectly claim that the GPU received no tiles.
                assert_eq!(stats.prepared_masks as usize, uploaded_bitmaps.len());
                assert!(
                    stats.resident_surface_bytes < legacy_stats.resident_surface_bytes,
                    "local mask must eliminate real full-canvas isolation surfaces"
                );
                let actual = read_size(&device, &queue, &output, 160, 96);
                let maximum = actual.iter().zip(cpu.rgba.iter()).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
                assert!(cpu.rgba.chunks_exact(4).any(|pixel| pixel[3] > 0));
                assert!(maximum <= 1, "local {kind} inverted={inverted} t={time}: GPU/CPU delta={maximum}");
                eprintln!(
                    "local masked {kind} inverted={inverted} t={time}: maxDelta={maximum}, bitmapUploads={}, preparedStrokes={}, residentBytes={}, legacyResidentBytes={}",
                    stats.prepared_masks, stats.prepared_strokes, stats.resident_surface_bytes, legacy_stats.resident_surface_bytes
                );
                if let Some((old_cpu, old_gpu)) = seen.get(&time.to_bits()) {
                    assert_eq!(cpu.rgba.as_ref(), old_cpu, "local CPU reverse seek");
                    assert_eq!(&actual, old_gpu, "local GPU reverse seek");
                    assert_eq!(stats.prepared_masks, previous_uploads, "repeat seek must not upload new bitmaps");
                } else {
                    seen.insert(time.to_bits(), (cpu.rgba.as_ref().clone(), actual));
                }
                previous_uploads = stats.prepared_masks;
            }
        }
    }
}

#[test]
fn real_masked_text_draw_ir_matches_cpu_and_reverse_seek_without_source_image() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target_size(&device, 160, 96);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    for (kind, paint) in [
        ("solid", json!({"kind":"solid","color":"#2ABBD0"})),
        (
            "gradient",
            json!({"kind":"linear","space":"normalized","domain":"glyph","from":[0,0],"to":[1,1],
            "stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]}),
        ),
    ] {
        let mut scene = masked_text_scene(paint);
        let mut seen = std::collections::BTreeMap::new();
        let mut previous_masks = 0;
        let mut previous_strokes = 0;
        for time in [0.2_f64, 0.8, 0.1, 0.8, 0.2] {
            let cpu = scene.render(time).unwrap();
            let (frame, _) = scene.record_material_plan(time).unwrap();
            assert_eq!((frame.width, frame.height), (160, 96));
            let mut matte_push = 0;
            let mut matte_pop = 0;
            let mut geometry = 0;
            for layer in &frame.layers {
                let MaterialSource::Draw(ops) = &layer.source else {
                    panic!("{kind}: CPU finished image substituted for Draw IR");
                };
                assert!(
                    ops.bitmaps.is_empty(),
                    "{kind}: unblurred outline source must not upload a finished CPU bitmap"
                );
                for op in &ops.ops {
                    match op {
                        DrawOp::PushMatte => matte_push += 1,
                        DrawOp::PopMatte { mode } => {
                            assert_eq!(*mode, 0);
                            matte_pop += 1;
                        }
                        DrawOp::FillPath { .. } | DrawOp::FillPathPaint { .. } | DrawOp::StrokePath { .. } => geometry += 1,
                        DrawOp::DrawBitmap { .. } | DrawOp::DrawEmissiveBitmap { .. } => {
                            panic!("{kind}: finished bitmap bypassed actual matte IR")
                        }
                        _ => {}
                    }
                }
            }
            assert_eq!(matte_push, 2, "OO requires independently masked adjacent glyphs");
            assert_eq!(matte_pop, matte_push);
            assert!(geometry >= 6);
            let view = output.create_view(&Default::default());
            let stats = renderer
                .render(
                    &frame,
                    RenderTarget {
                        view: &view,
                        width: 160,
                        height: 96,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                    },
                    true,
                )
                .unwrap();
            assert_eq!(stats.submissions, 1);
            let actual = read_size(&device, &queue, &output, 160, 96);
            let differences = actual.iter().zip(cpu.rgba.iter()).filter(|(a, b)| a != b).count();
            let maximum = actual.iter().zip(cpu.rgba.iter()).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
            eprintln!(
                "actual masked {kind} t={time}: differingBytes={differences}, maxDelta={maximum}, preparedMasks={}, preparedStrokes={}, residentBytes={}",
                stats.prepared_masks, stats.prepared_strokes, stats.resident_surface_bytes
            );
            assert!(cpu.rgba.chunks_exact(4).any(|p| p[3] > 0), "fixture must render real glyphs");
            assert!(
                maximum <= 1,
                "{kind} t={time}: actual glyph CPU/GPU difference must be measured, not excused as 4x AA"
            );
            if let Some((old_cpu, old_gpu)) = seen.get(&time.to_bits()) {
                assert_eq!(cpu.rgba.as_ref(), old_cpu, "CPU reverse seek {kind}");
                assert_eq!(&actual, old_gpu, "GPU reverse seek {kind}");
                assert_eq!(stats.prepared_masks, previous_masks, "repeat frame uploaded new outline coverage");
                assert_eq!(
                    stats.prepared_strokes, previous_strokes,
                    "repeat frame prepared new stroke coverage"
                );
            } else {
                seen.insert(time.to_bits(), (cpu.rgba.as_ref().clone(), actual));
            }
            previous_masks = stats.prepared_masks;
            previous_strokes = stats.prepared_strokes;
        }
    }
}

#[test]
fn real_inverted_offset_glyph_masks_keep_local_affine_and_reverse_seek() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target_size(&device, 160, 96);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let style = |paint: Value, em: bool, independent: bool, masked: bool| {
        // A dilated paint minus its own undilated fill makes an actual ring.
        // The second case moves the mask independently, in the glyph's local
        // coordinates before this rotated, nonuniform instance transform.
        let factor = if em { 1. / 36. } else { 1. };
        let mask_offset = if independent { [-3.0, 2.0] } else { [4.25, -2.5] };
        let mut layer = json!({"id":"ring","paint":paint,"unit":if em {"em"} else {"px"},
            "offset":[4.25*factor,-2.5*factor],"spread":3.0*factor});
        if masked {
            layer["mask"] = json!({"kind":"glyph-fill","spread":if independent {1.25*factor} else {0.0},
                "offset":[mask_offset[0]*factor,mask_offset[1]*factor],"inverted":true});
        }
        json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
            "schema":"baocut.caption-scene/1","evaluationVersion":1,
            "requiredCapabilities":["caption-scene/1","caption-expressions/1","caption-paint-stack/1",
                "caption-paint-effects/1","caption-paint-mask/1","caption-paint-mask-transform/1",
                "caption-gradient-space/1","caption-gradient-glyph/1"],
            "layout":{"x":{"value":80,"basis":"absolute"},"y":{"value":48,"basis":"absolute"},
                "width":{"value":150,"basis":"absolute"},"maxLines":1},
            "nodes":[{"id":"text","type":"text","style":{"fontFamily":"Noto Sans SC",
                "fontSize":{"value":36,"basis":"absolute"},"fill":"#FFFFFF","paints":[layer]},
                "properties":{"opacity":{"kind":"constant","value":0.5},
                    "transform.rotation":{"kind":"constant","value":17},
                    "transform.scaleX":{"kind":"constant","value":1.15},
                    "transform.scaleY":{"kind":"constant","value":0.85}}}],
            "animations":[{"id":"move","target":{"nodeId":"text"},"property":"transform.x","composite":"replace",
                "value":{"kind":"keyframes","clock":{"unit":"cue","origin":"start","duration":{"kind":"unit-span"}},
                    "keys":[{"at":0,"value":-3},{"at":1,"value":4}]}}]
        }}})
    };
    let compile = |value: Value| {
        ScenePlan::compile(
            parse_style(&value).unwrap(),
            Presentation::default(),
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: "OO".into(),
                start: 0.,
                end: 2.,
                words: vec![],
            }],
            (160, 96),
            TextEngine::with_document_fonts(&[include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec()]),
            "actual-inverted-offset-glyph-mask".into(),
        )
        .unwrap()
    };
    for (kind, paint) in [
        ("solid", json!({"kind":"solid","color":"#2ABBD0"})),
        (
            "gradient",
            json!({"kind":"linear","space":"normalized","domain":"glyph","from":[0,0],"to":[1,1],
                "stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]}),
        ),
    ] {
        for em in [false, true] {
            let mut aligned = compile(style(paint.clone(), em, false, true));
            let ring = aligned.render(0.2).unwrap();
            let plain = compile(style(paint.clone(), em, false, false)).render(0.2).unwrap();
            assert!(
                ring.rgba.chunks_exact(4).any(|p| p[3] > 0),
                "{kind} em={em}: ring must remain visible"
            );
            assert!(
                ring.rgba
                    .chunks_exact(4)
                    .zip(plain.rgba.chunks_exact(4))
                    .any(|(a, b)| a[3] == 0 && b[3] > 0),
                "{kind} em={em}: inversion must remove glyph interior from the dilated paint"
            );
            let moved = compile(style(paint.clone(), em, true, true)).render(0.2).unwrap();
            assert_ne!(
                ring.rgba, moved.rgba,
                "{kind} em={em}: independent mask offset must affect real pixels"
            );
            for independent in [false, true] {
                let mut scene = compile(style(paint.clone(), em, independent, true));
                let mut seen = std::collections::BTreeMap::new();
                for time in [0.2_f64, 0.8, 0.1, 0.8, 0.2] {
                    let cpu = scene.render(time).unwrap();
                    let (frame, _) = scene.record_material_plan(time).unwrap();
                    let mut mattes = 0;
                    let mut content_tf = None;
                    let mut in_matte = false;
                    let mut checked_offsets = 0;
                    for layer in &frame.layers {
                        let MaterialSource::Draw(ops) = &layer.source else {
                            panic!("{kind}: finished CPU image bypassed transformed mask Draw IR");
                        };
                        assert!(ops.bitmaps.is_empty(), "{kind}: mask must retain outline operations");
                        for op in &ops.ops {
                            match op {
                                DrawOp::PushMatte => {
                                    assert!(!in_matte);
                                    in_matte = true;
                                }
                                DrawOp::PopMatte { mode } => {
                                    assert!(in_matte);
                                    assert_eq!(*mode, 1, "inverted glyph fill must emit AlphaInverted");
                                    in_matte = false;
                                    mattes += 1;
                                }
                                DrawOp::FillPathPaint { tf, .. } if !in_matte => content_tf = Some(*tf),
                                DrawOp::FillPath { tf, .. } if in_matte => {
                                    let content: [f32; 6] = content_tf.expect("paint must precede its own glyph mask");
                                    let delta = if independent { [-7.25_f32, 4.5] } else { [0., 0.] };
                                    let expected = [
                                        content[4] + content[0] * delta[0] + content[2] * delta[1],
                                        content[5] + content[1] * delta[0] + content[3] * delta[1],
                                    ];
                                    for axis in 0..2 {
                                        assert!(
                                            (tf[axis + 4] - expected[axis]).abs() <= 0.0001,
                                            "{kind} em={em}: mask offset must follow local affine, axis={axis}, actual={}, expected={}",
                                            tf[axis + 4],
                                            expected[axis]
                                        );
                                    }
                                    checked_offsets += 1;
                                }
                                DrawOp::DrawBitmap { .. } | DrawOp::DrawEmissiveBitmap { .. } => {
                                    panic!("{kind}: transformed mask used completed CPU bitmap");
                                }
                                _ => {}
                            }
                        }
                    }
                    assert!(!in_matte);
                    assert_eq!(mattes, 2, "OO must independently invert each glyph mask");
                    assert_eq!(checked_offsets, 2, "each glyph mask must expose local offset geometry");
                    let view = output.create_view(&Default::default());
                    let stats = renderer
                        .render(
                            &frame,
                            RenderTarget {
                                view: &view,
                                width: 160,
                                height: 96,
                                format: wgpu::TextureFormat::Rgba8Unorm,
                            },
                            true,
                        )
                        .unwrap();
                    assert_eq!(stats.submissions, 1);
                    let actual = read_size(&device, &queue, &output, 160, 96);
                    let maximum = actual.iter().zip(cpu.rgba.iter()).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
                    eprintln!("actual inverted {kind} em={em} independent={independent} t={time}: maxDelta={maximum}");
                    assert!(
                        maximum <= 1,
                        "{kind} em={em} independent={independent} t={time}: GPU/CPU maxDelta={maximum}"
                    );
                    if let Some((old_cpu, old_gpu)) = seen.get(&time.to_bits()) {
                        assert_eq!(cpu.rgba.as_ref(), old_cpu, "CPU reverse seek transformed mask");
                        assert_eq!(&actual, old_gpu, "GPU reverse seek transformed mask");
                    } else {
                        seen.insert(time.to_bits(), (cpu.rgba.as_ref().clone(), actual));
                    }
                }
            }
        }
    }
}

fn invalid_cases(data: &[Vec<u8>]) -> Vec<(&'static str, &'static str, Arc<FrameOps>)> {
    let mut result = vec![
        (
            "root matte",
            "gpu-draw-matte-root-invalid",
            frame(data, vec![DrawOp::PushMatte, draw(1), DrawOp::PopMatte { mode: 0 }]),
        ),
        (
            "unmatched pop matte",
            "gpu-draw-matte-stack-invalid",
            frame(data, vec![group(1.), draw(0), DrawOp::PopMatte { mode: 0 }, DrawOp::PopLayer]),
        ),
        (
            "pop layer inside matte",
            "gpu-draw-matte-stack-invalid",
            frame(
                data,
                vec![
                    group(1.),
                    DrawOp::PushMatte,
                    draw(1),
                    DrawOp::PopLayer,
                    DrawOp::PopMatte { mode: 0 },
                ],
            ),
        ),
        (
            "unclosed matte",
            "gpu-draw-matte-stack-invalid",
            frame(data, vec![group(1.), DrawOp::PushMatte, draw(1)]),
        ),
        (
            "screen cannot be flattened into matte content",
            "gpu-draw-operation-unsupported",
            frame(
                data,
                vec![
                    group(1.),
                    DrawOp::DrawEmissiveBitmap {
                        bitmap: 0,
                        opacity: 1.,
                        tf: ID,
                        blend: AssociatedBlend::Screen,
                    },
                    DrawOp::PushMatte,
                    draw(1),
                    DrawOp::PopMatte { mode: 0 },
                    DrawOp::PopLayer,
                ],
            ),
        ),
        (
            "invalid mode",
            "gpu-draw-matte-mode-invalid",
            frame(
                data,
                vec![
                    group(1.),
                    draw(0),
                    DrawOp::PushMatte,
                    draw(1),
                    DrawOp::PopMatte { mode: 4 },
                    DrawOp::PopLayer,
                ],
            ),
        ),
    ];
    result.push((
        "zero opacity cannot hide invalid matte stack",
        "gpu-draw-matte-stack-invalid",
        frame(
            data,
            vec![
                group(0.),
                DrawOp::PushMatte,
                draw(1),
                DrawOp::PopLayer,
                DrawOp::PopMatte { mode: 0 },
            ],
        ),
    ));
    let mut deep = vec![group(1.)];
    deep.extend(std::iter::repeat_n(DrawOp::PushMatte, 33));
    deep.extend(std::iter::repeat_n(DrawOp::PopMatte { mode: 0 }, 33));
    deep.push(DrawOp::PopLayer);
    result.push(("matte depth", "gpu-draw-layer-depth-limit", frame(data, deep)));
    let mut many = vec![group(1.), draw(0)];
    for _ in 0..129 {
        many.extend([DrawOp::PushMatte, draw(1), DrawOp::PopMatte { mode: 0 }]);
    }
    many.push(DrawOp::PopLayer);
    result.push(("matte count", "gpu-draw-source-composite-limit", frame(data, many)));
    result
}
#[test]
fn invalid_matte_stacks_and_budget_preserve_target_backdrop() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let view = output.create_view(&Default::default());
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let data = patterns();
    let backdrop: Vec<_> = (0..W * H).flat_map(|i| [17 + (i % 8) as u8, 23, 31, 211]).collect();
    for (label, code, source) in invalid_cases(&data) {
        write(&queue, &output, &backdrop);
        let error = renderer
            .render(
                &rejected_with_valid_prefix(source, &data),
                RenderTarget {
                    view: &view,
                    width: W,
                    height: H,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
                true,
            )
            .expect_err(label);
        assert!(error.to_string().contains(code), "{label}: {error}");
        same(&read(&device, &queue, &output), &backdrop, label);
        eprintln!("matte rejected {label}: {error}");
    }
}

#[cfg(feature = "gpu-trace")]
#[test]
fn actual_trace_has_one_live_submit_and_zero_for_all_rejections() {
    let specified = std::env::var_os("BAOCUT_GPU_MATTE_TRACE_DIR").map(std::path::PathBuf::from);
    let temporary = if specified.is_none() {
        Some(tempfile::tempdir().unwrap())
    } else {
        None
    };
    let trace_path = specified.unwrap_or_else(|| temporary.as_ref().unwrap().path().to_owned());
    assert!(trace_path.is_absolute(), "external matte trace path must be absolute");
    if temporary.is_none() {
        std::fs::create_dir(&trace_path).expect("fresh external trace directory required; never overwrite");
    }
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Directory(trace_path.clone())) else {
        return;
    };
    let output = target(&device);
    let view = output.create_view(&Default::default());
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let data = patterns();
    let source = frame(
        &data,
        vec![
            group(1.),
            draw(0),
            DrawOp::PushMatte,
            group(1.),
            draw(1),
            DrawOp::PushMatte,
            draw(2),
            DrawOp::PopMatte { mode: 0 },
            DrawOp::PopLayer,
            DrawOp::PopMatte { mode: 2 },
            DrawOp::PopLayer,
        ],
    );
    render(&mut renderer, &material(source), &output);
    let reject_count = invalid_cases(&data).len();
    for (label, code, source) in invalid_cases(&data) {
        let error = renderer
            .render(
                &rejected_with_valid_prefix(source, &data),
                RenderTarget {
                    view: &view,
                    width: W,
                    height: H,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
                true,
            )
            .expect_err(label);
        assert!(error.to_string().contains(code), "{label}: {error}");
    }
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    drop(renderer);
    drop(view);
    drop(output);
    drop(queue);
    drop(device);
    let trace = std::fs::read_to_string(trace_path.join("trace.ron")).unwrap();
    assert_eq!(
        trace.matches("Submit(").count(),
        1,
        "accepted matte is one submit; rejected frames submit zero"
    );
    eprintln!(
        "matte trace path={} SubmitCount={} rejectCount={reject_count}",
        trace_path.display(),
        trace.matches("Submit(").count()
    );
    for forbidden in ["CopyTextureToBuffer(", "MAP_READ", "MapAsync("] {
        assert!(
            !trace.contains(forbidden),
            "live matte path contains test readback operation {forbidden}"
        );
    }
}
