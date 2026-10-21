//! Public device-space fill and wide-stroke coverage conformance.
//! The unchanged CPU DrawOp executor is the full-canvas associated RGBA oracle.
//! Every channel, including AA edges, has a maximum byte error of 2.
#![cfg(feature = "gpu")]

use compositor::{CaptionGpuRenderer, CaptionGpuStats, RenderTarget};
use motion::effect::BlendMode;
use render_raster::{
    drawop::{AssociatedBlend, DrawOp, FrameOps, GradientStop, Mat6, PaintData, PathData, path_from_skia},
    effects::{
        component_filters::Size,
        material_plan::{MaterialFrame, MaterialLayer, MaterialSource},
    },
    raster::{FrameMedia, rasterize_with_media},
};
use std::sync::Arc;

const ID: Mat6 = [1., 0., 0., 1., 0., 0.];
const SIZE: Size = Size { width: 112, height: 96 };

struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, id: &str, _: i64) -> anyhow::Result<Arc<tiny_skia::Pixmap>> {
        anyhow::bail!("device-coverage conformance must not request media {id}")
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
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        }))
        .ok()?;
        let info = adapter.get_info();
        eprintln!(
            "device-coverage adapter={} backend={:?} type={:?}",
            info.name, info.backend, info.device_type
        );
        if std::env::var_os("BAOCUT_REQUIRE_GPU").is_some() {
            assert_ne!(info.device_type, wgpu::DeviceType::Cpu, "software adapter is forbidden");
        }
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("baocut.device-coverage.conformance"),
            required_limits: adapter.limits(),
            trace,
            ..Default::default()
        }))
        .ok()?;
        Some((device, queue, format!("{:?}", info.backend).to_lowercase(), info.name))
    })();
    assert!(
        available.is_some() || std::env::var_os("BAOCUT_REQUIRE_GPU").is_none(),
        "native GPU acceptance cannot skip"
    );
    available
}

fn target(device: &wgpu::Device, size: Size) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("baocut.device-coverage.test-target"),
        size: wgpu::Extent3d {
            width: size.width,
            height: size.height,
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

fn write(queue: &wgpu::Queue, texture: &wgpu::Texture, data: &[u8]) {
    let size = Size {
        width: texture.width(),
        height: texture.height(),
    };
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(size.width * 4),
            rows_per_image: Some(size.height),
        },
        wgpu::Extent3d {
            width: size.width,
            height: size.height,
            depth_or_array_layers: 1,
        },
    );
}

fn read(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture) -> Vec<u8> {
    let size = Size {
        width: texture.width(),
        height: texture.height(),
    };
    let stride = (size.width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("baocut.device-coverage.test-only-readback"),
        size: u64::from(stride * size.height),
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
                rows_per_image: Some(size.height),
            },
        },
        wgpu::Extent3d {
            width: size.width,
            height: size.height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit(Some(encoder.finish()));
    let slice = buffer.slice(..);
    let (sender, receiver) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    device.poll(wgpu::PollType::wait_indefinitely()).expect("GPU readback completion");
    receiver.recv().unwrap().expect("readback map");
    let mapped = slice.get_mapped_range().unwrap();
    mapped
        .chunks_exact(stride as usize)
        .flat_map(|row| row[..size.width as usize * 4].iter().copied())
        .collect()
}

fn material(sources: Vec<Arc<FrameOps>>) -> MaterialFrame {
    MaterialFrame {
        width: SIZE.width,
        height: SIZE.height,
        layers: sources
            .into_iter()
            .map(|ops| MaterialLayer {
                source: MaterialSource::Draw(ops),
                materials: vec![],
                blend: AssociatedBlend::SourceOver,
            })
            .collect(),
    }
}

fn render(renderer: &mut CaptionGpuRenderer, frame: &MaterialFrame, texture: &wgpu::Texture, clear: bool) -> CaptionGpuStats {
    let view = texture.create_view(&Default::default());
    renderer
        .render(
            frame,
            RenderTarget {
                view: &view,
                width: frame.width,
                height: frame.height,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            clear,
        )
        .expect("supported Draw-source frame")
}

fn cpu(frame: &MaterialFrame, backdrop: &[u8]) -> Vec<u8> {
    let mut output =
        tiny_skia::Pixmap::from_vec(backdrop.to_vec(), tiny_skia::IntSize::from_wh(frame.width, frame.height).unwrap()).unwrap();
    for layer in &frame.layers {
        let MaterialSource::Draw(ops) = &layer.source else { unreachable!() };
        let source = rasterize_with_media(ops, frame.width, frame.height, &mut NoMedia).unwrap();
        render_raster::emissive::composite_associated_with_blend(
            &mut output,
            source.as_ref(),
            1.,
            [1., 0., 0., 1., 0., 0.],
            None,
            layer.blend,
        )
        .unwrap();
    }
    output.data().to_vec()
}

fn stop(offset: f32, color: [f32; 4]) -> GradientStop {
    GradientStop { offset, color }
}

fn paints() -> Vec<(&'static str, PaintData)> {
    vec![
        ("solid-opaque", PaintData::Solid([0.87, 0.19, 0.43, 1.])),
        ("solid-alpha", PaintData::Solid([0.13, 0.81, 0.42, 0.63])),
        (
            "linear-opaque",
            PaintData::Linear {
                p0: [16., 28.],
                p1: [92., 60.],
                stops: vec![stop(0., [0.94, 0.08, 0.19, 1.]), stop(1., [0.05, 0.21, 0.91, 1.])],
            },
        ),
        (
            "linear-nonuniform-alpha",
            PaintData::Linear {
                p0: [16., 28.],
                p1: [92., 60.],
                stops: vec![
                    stop(0., [0.9, 0.1, 0.3, 0.17]),
                    stop(0.23, [0.1, 0.9, 0.3, 0.82]),
                    stop(1., [0.2, 0.1, 0.9, 0.43]),
                ],
            },
        ),
        (
            "linear-hard-stops",
            PaintData::Linear {
                p0: [16., 0.],
                p1: [92., 0.],
                stops: vec![
                    stop(0., [0.94, 0.08, 0.19, 0.83]),
                    stop(0.5, [0.94, 0.08, 0.19, 0.83]),
                    stop(0.5, [0.05, 0.21, 0.91, 0.37]),
                    stop(1., [0.05, 0.21, 0.91, 0.37]),
                ],
            },
        ),
    ]
}

fn transforms() -> [(&'static str, Mat6); 6] {
    [
        ("identity", ID),
        ("positive-phase", [1., 0., 0., 1., 0.37, 0.29]),
        ("negative-phase", [1., 0., 0., 1., -0.37, -0.29]),
        ("rotation", [0.9396926, 0.34202015, -0.34202015, 0.9396926, 20.13, -11.27]),
        ("shear", [1., 0.17, -0.23, 1., 11.37, -7.29]),
        ("nonuniform-scale", [0.73, 0., 0., 1.13, 13.37, -6.29]),
    ]
}

fn contours() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    // Same winding makes the second contour fill under nonzero and form a
    // hole under even-odd. Curved outside edges also exercise device AA.
    p.move_to(14.2, 20.8);
    p.cubic_to(32.7, 5.3, 75.1, 10.8, 95.4, 25.6);
    p.line_to(91.7, 73.4);
    p.quad_to(51.2, 90.3, 17.4, 69.2);
    p.close();
    p.push_rect(tiny_skia::Rect::from_xywh(36.3, 33.7, 34.2, 24.4).unwrap());
    path_from_skia(&p.finish().unwrap())
}

fn across_canvas() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(-14.2, 23.8);
    p.line_to(47.6, -15.3);
    p.line_to(127.4, 24.8);
    p.cubic_to(102.3, 53.2, 135.6, 76.4, 63.8, 111.3);
    p.line_to(-17.2, 71.8);
    p.close();
    p.push_rect(tiny_skia::Rect::from_xywh(34.3, 30.7, 36.2, 30.4).unwrap());
    path_from_skia(&p.finish().unwrap())
}

fn sharp() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(15.2, 70.8);
    p.line_to(44.4, 15.2);
    p.line_to(50.1, 73.3);
    p.line_to(94.6, 30.8);
    path_from_skia(&p.finish().unwrap())
}

fn rect(x: f32, y: f32, w: f32, h: f32) -> PathData {
    path_from_skia(&tiny_skia::PathBuilder::from_rect(tiny_skia::Rect::from_xywh(x, y, w, h).unwrap()))
}

fn fill(path: PathData, paint: PaintData, even_odd: bool, tf: Mat6) -> Arc<FrameOps> {
    Arc::new(FrameOps {
        paths: vec![path],
        paints: vec![paint],
        ops: vec![DrawOp::FillPathPaint {
            path: 0,
            paint: 0,
            even_odd,
            tf,
        }],
        ..Default::default()
    })
}

fn stroke(path: PathData, paint: PaintData, width: f32, cap: u8, join: u8, miter: f32, tf: Mat6) -> Arc<FrameOps> {
    Arc::new(FrameOps {
        paths: vec![path],
        paints: vec![paint],
        ops: vec![DrawOp::StrokePathPaint {
            path: 0,
            paint: 0,
            width,
            cap,
            join,
            miter,
            tf,
        }],
        ..Default::default()
    })
}

struct Case {
    label: String,
    sources: Vec<Arc<FrameOps>>,
    backdrop: bool,
}
fn case(label: String, source: Arc<FrameOps>) -> Case {
    Case {
        label,
        sources: vec![source],
        backdrop: false,
    }
}

// No alpha-only checks, edge bands, support thresholds, or averaged-error pass
// criteria: sparse and transparent paths must satisfy the same RGBA bound.
fn compare(label: &str, size: Size, expected: &[u8], actual: &[u8]) -> Option<String> {
    assert_eq!(expected.len(), actual.len(), "{label}: RGBA size");
    let mut maxima = [0u8; 4];
    let mut sums = [0u64; 4];
    let mut worst = [0usize; 4];
    for (i, (&a, &b)) in expected.iter().zip(actual).enumerate() {
        let channel = i % 4;
        let error = a.abs_diff(b);
        if error > maxima[channel] {
            maxima[channel] = error;
            worst[channel] = i;
        }
        sums[channel] += u64::from(error);
    }
    let pixels = u64::from(size.width * size.height);
    let mae: [f64; 4] = std::array::from_fn(|c| sums[c] as f64 / pixels as f64);
    eprintln!("device-coverage {label} rgba_max={maxima:?} rgba_mae={mae:?}");
    let channel = (0..4).max_by_key(|&c| maxima[c]).unwrap();
    let i = worst[channel];
    (maxima[channel] > 2).then(|| {
        format!(
            "{label}: rgba_max={maxima:?}, worst=({},{}) channel={channel} cpu={} gpu={}",
            i / 4 % size.width as usize,
            i / 4 / size.width as usize,
            expected[i],
            actual[i]
        )
    })
}

fn run(cases: Vec<Case>) {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        eprintln!("device coverage skipped: no native GPU adapter; BAOCUT_REQUIRE_GPU=1 forbids this skip");
        return;
    };
    let output = target(&device, SIZE);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let blank = vec![0; (SIZE.width * SIZE.height * 4) as usize];
    let backdrop: Vec<u8> = (0..SIZE.width * SIZE.height).flat_map(|_| [11, 19, 29, 255]).collect();
    let count = cases.len();
    let mut failures = Vec::new();
    for c in cases {
        let frame = material(c.sources);
        let source_pixels = cpu(&frame, &blank);
        assert!(
            source_pixels.chunks_exact(4).any(|p| p[3] != 0),
            "{}: CPU fixture must paint before backdrop composition",
            c.label
        );
        let expected = if c.backdrop { cpu(&frame, &backdrop) } else { source_pixels };
        if c.backdrop {
            write(&queue, &output, &backdrop);
        }
        let first = render(&mut renderer, &frame, &output, !c.backdrop);
        assert_eq!(first.submissions, 1, "{}: one GPU submission", c.label);
        assert_eq!(first.material_passes, 0, "{}: no MaterialFrame filters", c.label);
        let actual = read(&device, &queue, &output);
        if let Some(f) = compare(&c.label, SIZE, &expected, &actual) {
            failures.push(f);
        }
        if c.backdrop {
            write(&queue, &output, &backdrop);
        }
        let replay = render(&mut renderer, &frame, &output, !c.backdrop);
        assert_eq!(
            replay.prepared_masks, first.prepared_masks,
            "{}: same-frame coverage must be cached",
            c.label
        );
        assert_eq!(read(&device, &queue, &output), actual, "{}: replay changed RGBA", c.label);
    }
    eprintln!("device coverage cases={count} failures={}", failures.len());
    assert!(failures.is_empty(), "device coverage full-RGBA errors:\n{}", failures.join("\n"));
}

#[test]
fn nonzero_even_odd_curved_and_canvas_crossing_fills_match_cpu_rgba() {
    let mut cases = Vec::new();
    for (geometry, path) in [("curved-contours", contours()), ("across-canvas", across_canvas())] {
        for even_odd in [false, true] {
            for (paint_name, paint) in paints() {
                for (tf_name, tf) in transforms() {
                    cases.push(case(
                        format!("fill/{geometry}/evenodd={even_odd}/{paint_name}/{tf_name}"),
                        fill(path.clone(), paint.clone(), even_odd, tf),
                    ));
                }
            }
        }
    }
    // Independently establish that the fixture distinguishes the fill rules.
    let blank = vec![0; (SIZE.width * SIZE.height * 4) as usize];
    let probe = ((45 * SIZE.width + 51) * 4 + 3) as usize;
    let winding = cpu(&material(vec![fill(contours(), PaintData::Solid([1.; 4]), false, ID)]), &blank);
    let parity = cpu(&material(vec![fill(contours(), PaintData::Solid([1.; 4]), true, ID)]), &blank);
    assert_eq!(winding[probe], 255, "same-winding contour must remain filled under nonzero");
    assert_eq!(parity[probe], 0, "same-winding inner contour must make an even-odd hole");
    run(cases);
}

#[test]
fn wide_strokes_every_cap_join_and_miter_match_cpu_rgba() {
    let mut cases = Vec::new();
    for cap in 0..3 {
        for join in 0..3 {
            for miter in [1., 8.] {
                for width in [5.25, 10.5] {
                    for (paint_name, paint) in [("solid-alpha", paints()[1].1.clone()), ("linear-alpha", paints()[3].1.clone())] {
                        cases.push(case(
                            format!("stroke/cap={cap}/join={join}/miter={miter}/width={width}/{paint_name}"),
                            stroke(sharp(), paint, width, cap, join, miter, transforms()[1].1),
                        ));
                    }
                }
            }
        }
    }
    run(cases);
}

#[test]
fn wide_strokes_all_paints_transforms_and_canvas_boundaries_match_cpu_rgba() {
    let mut cases = Vec::new();
    for (geometry, path) in [("sharp", sharp()), ("across-canvas", across_canvas())] {
        for width in [5.25, 10.5] {
            for (paint_name, paint) in paints() {
                for (tf_name, tf) in transforms() {
                    cases.push(case(
                        format!("stroke/{geometry}/width={width}/{paint_name}/{tf_name}"),
                        stroke(path.clone(), paint.clone(), width, 2, 0, 8., tf),
                    ));
                }
            }
        }
    }
    run(cases);
}

fn grouped(outer: f32, inner: f32, tf: Mat6) -> Arc<FrameOps> {
    Arc::new(FrameOps {
        paths: vec![contours(), sharp(), rect(28.3, 35.7, 55.2, 34.4)],
        paints: vec![
            paints()[3].1.clone(),
            PaintData::Solid([0.12, 0.29, 0.94, 0.71]),
            paints()[4].1.clone(),
        ],
        ops: vec![
            DrawOp::PushLayer {
                opacity: outer,
                blend: BlendMode::Normal,
            },
            DrawOp::FillPathPaint {
                path: 0,
                paint: 0,
                even_odd: true,
                tf,
            },
            DrawOp::PushLayer {
                opacity: inner,
                blend: BlendMode::Normal,
            },
            DrawOp::StrokePathPaint {
                path: 1,
                paint: 1,
                width: 10.5,
                cap: 2,
                join: 0,
                miter: 8.,
                tf,
            },
            DrawOp::FillPathPaint {
                path: 2,
                paint: 2,
                even_odd: false,
                tf,
            },
            DrawOp::PopLayer,
            DrawOp::FillPathPaint {
                path: 2,
                paint: 1,
                even_odd: false,
                tf,
            },
            DrawOp::PopLayer,
        ],
        ..Default::default()
    })
}

#[test]
fn nested_normal_opacity_and_ordered_transparent_overlap_match_cpu_rgba() {
    let mut cases = Vec::new();
    for (tf_name, tf) in transforms() {
        for outer in [0.23, 0.63, 0.91] {
            for inner in [0.31, 0.67] {
                for backdrop in [false, true] {
                    cases.push(Case {
                        label: format!("nested/{tf_name}/outer={outer}/inner={inner}/backdrop={backdrop}"),
                        sources: vec![
                            grouped(outer, inner, tf),
                            stroke(sharp(), PaintData::Solid([0.9, 0.21, 0.17, 0.43]), 5.25, 1, 1, 1., tf),
                        ],
                        backdrop,
                    });
                }
            }
        }
    }
    run(cases);
}

#[test]
fn retained_device_alpha_coverage_reuses_color_and_invalidates_transform_and_canvas() {
    fn mask(scene: compositor::SceneFrame) -> Arc<compositor::GlyphMask> {
        let [compositor::SceneNode::Glyphs(run)] = scene.nodes.as_slice() else {
            panic!("one path must produce one glyph run")
        };
        assert_eq!(run.glyphs.len(), 1);
        let mask = run.glyphs[0].mask.clone();
        assert!(
            matches!(&mask.pixels, compositor::GlyphPixels::Alpha(_)),
            "normal device coverage must remain Alpha"
        );
        mask
    }
    for wide_stroke in [false, true] {
        let source = |color, tf| {
            if wide_stroke {
                stroke(contours(), PaintData::Solid(color), 10.5, 2, 0, 8., tf)
            } else {
                fill(contours(), PaintData::Solid(color), true, tf)
            }
        };
        let mut cache = compositor::RetainedDrawCache::default();
        let base = source([1.; 4], ID);
        let first = mask(cache.prepare_for_canvas(&base, SIZE.width, SIZE.height).unwrap());
        let prepared = cache.prepared_masks();
        assert_eq!(prepared, 1);
        let mut keys = vec![first.key];
        for color in [[0.83, 0.17, 0.46, 1.], [0.83, 0.17, 0.46, 0.37]] {
            let changed = mask(cache.prepare_for_canvas(&source(color, ID), SIZE.width, SIZE.height).unwrap());
            assert_eq!(
                cache.prepared_masks(),
                prepared,
                "color/alpha are uniforms for normal path coverage"
            );
            assert!(Arc::ptr_eq(&changed, &first), "color/alpha must reuse device Alpha resource");
        }
        for (label, tf, width, height) in [
            ("phase", transforms()[1].1, SIZE.width, SIZE.height),
            ("rotation", transforms()[3].1, SIZE.width, SIZE.height),
            ("shear", transforms()[4].1, SIZE.width, SIZE.height),
            ("scale", transforms()[5].1, SIZE.width, SIZE.height),
            ("canvas-width", ID, SIZE.width + 7, SIZE.height),
            ("canvas-height", ID, SIZE.width, SIZE.height + 5),
        ] {
            let before = cache.prepared_masks();
            let frame = source([1.; 4], tf);
            let changed = mask(cache.prepare_for_canvas(&frame, width, height).unwrap());
            assert_eq!(cache.prepared_masks(), before + 1, "{label}: device coverage must invalidate");
            assert!(!keys.contains(&changed.key), "{label}: distinct coverage input reused a key");
            keys.push(changed.key);
            let replay = mask(cache.prepare_for_canvas(&frame, width, height).unwrap());
            assert_eq!(cache.prepared_masks(), before + 1, "{label}: same frame must reuse cached coverage");
            assert!(Arc::ptr_eq(&replay, &changed));
        }
    }
}

#[test]
fn gpu_normal_coverage_reuses_solid_linear_paints_and_rebuilds_for_phase_and_viewport() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let mut failures = Vec::new();
    for wide_stroke in [false, true] {
        let mut prepared = None;
        let output = target(&device, SIZE);
        for (paint_name, paint) in paints() {
            let source = if wide_stroke {
                stroke(contours(), paint, 10.5, 2, 0, 8., ID)
            } else {
                fill(contours(), paint, true, ID)
            };
            let frame = material(vec![source]);
            let blank = vec![0; (SIZE.width * SIZE.height * 4) as usize];
            let expected = cpu(&frame, &blank);
            assert!(expected.chunks_exact(4).any(|p| p[3] != 0), "cache reuse fixture must paint");
            let stats = render(&mut renderer, &frame, &output, true);
            assert_eq!(stats.submissions, 1);
            if let Some(n) = prepared {
                assert_eq!(stats.prepared_masks, n, "paint changes must reuse normal coverage")
            } else {
                prepared = Some(stats.prepared_masks)
            }
            let actual = read(&device, &queue, &output);
            if let Some(f) = compare(&format!("reuse/stroke={wide_stroke}/{paint_name}"), SIZE, &expected, &actual) {
                failures.push(f);
            }
            let replay = render(&mut renderer, &frame, &output, true);
            assert_eq!(
                replay.prepared_masks, stats.prepared_masks,
                "{paint_name}: same frame must reuse coverage"
            );
            assert_eq!(read(&device, &queue, &output), actual, "{paint_name}: replay changed RGBA");
        }
        let mut before = prepared.unwrap();
        for (label, tf, size) in [
            ("phase", transforms()[2].1, SIZE),
            (
                "canvas-width",
                ID,
                Size {
                    width: SIZE.width + 7,
                    height: SIZE.height,
                },
            ),
            (
                "canvas-height",
                ID,
                Size {
                    width: SIZE.width,
                    height: SIZE.height + 5,
                },
            ),
        ] {
            let source = if wide_stroke {
                stroke(contours(), paints()[3].1.clone(), 10.5, 2, 0, 8., tf)
            } else {
                fill(contours(), paints()[3].1.clone(), true, tf)
            };
            let mut frame = material(vec![source]);
            frame.width = size.width;
            frame.height = size.height;
            let output = target(&device, size);
            let expected = cpu(&frame, &vec![0; (size.width * size.height * 4) as usize]);
            assert!(
                expected.chunks_exact(4).any(|p| p[3] != 0),
                "{label}: invalidation fixture must paint"
            );
            let stats = render(&mut renderer, &frame, &output, true);
            assert_eq!(
                stats.prepared_masks,
                before + 1,
                "{label}: GPU device coverage must prepare a different resource"
            );
            before = stats.prepared_masks;
            let actual = read(&device, &queue, &output);
            if let Some(f) = compare(&format!("invalidate/stroke={wide_stroke}/{label}"), size, &expected, &actual) {
                failures.push(f);
            }
            let replay = render(&mut renderer, &frame, &output, true);
            assert_eq!(replay.prepared_masks, before, "{label}: changed frame replay must reuse coverage");
            assert_eq!(read(&device, &queue, &output), actual, "{label}: replay changed RGBA");
        }
    }
    assert!(failures.is_empty(), "paint/cache full-RGBA errors:\n{}", failures.join("\n"));
}

fn scan_grid_boundary_path() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(-18.2, 8.3);
    p.cubic_to(35.7, -16.2, 84.3, 18.8, 125.2, 27.4);
    p.line_to(126.2, 43.8);
    p.line_to(74.1, 72.6);
    p.quad_to(31.9, 47.6, -38.2, 55.3);
    p.close();
    // With long-axis translation 8100.37, local 91.13 maps to the
    // center of pixel 8191. Explicit vertical and horizontal segments ensure
    // hairlines exercise both scanner tiles instead of depending on a curve's
    // subpixel coverage at the single-column tile's clipping boundary.
    p.move_to(91.13, 14.17);
    p.line_to(91.13, 47.17);
    p.move_to(88.13, 30.17);
    p.line_to(96.13, 30.17);
    path_from_skia(&p.finish().unwrap())
}

#[test]
fn eight_k_canvas_internal_scan_grid_and_canvas_edges_match_cpu_rgba() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let limit = device.limits().max_texture_dimension_2d;
    if limit < 8192 {
        assert!(
            std::env::var_os("BAOCUT_REQUIRE_GPU").is_none(),
            "required GPU conformance cannot skip 8192-pixel scan-grid coverage: actual texture limit={limit}"
        );
        eprintln!("device coverage 8k scan-grid cases skipped: actual max_texture_dimension_2d={limit}");
        return;
    }
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let mut failures = Vec::new();
    let mut count = 0;
    let mut expected_count = 0;
    for (axis, size, tf) in [
        ("x", Size { width: 8192, height: 64 }, [1., 0., 0., 1., 8100.37, -0.17]),
        ("y", Size { width: 64, height: 8192 }, [0., 1., 1., 0., -0.17, 8100.37]),
        ("x", Size { width: 8200, height: 64 }, [1., 0., 0., 1., 8100.37, -0.17]),
        ("y", Size { width: 64, height: 8200 }, [0., 1., 1., 0., -0.17, 8100.37]),
    ] {
        let long_side = size.width.max(size.height);
        if long_side > limit {
            assert!(
                std::env::var_os("BAOCUT_REQUIRE_GPU").is_none(),
                "required GPU conformance cannot skip {long_side}-pixel scan-grid coverage: actual texture limit={limit}"
            );
            eprintln!("device coverage {long_side}-pixel scan-grid canvas skipped: actual max_texture_dimension_2d={limit}");
            continue;
        }
        expected_count += 30;
        let output = target(&device, size);
        let blank = vec![0; (size.width * size.height * 4) as usize];
        for (paint_name, paint) in paints() {
            for (geometry, source) in [
                ("nonzero-fill", fill(scan_grid_boundary_path(), paint.clone(), false, tf)),
                ("evenodd-fill", fill(scan_grid_boundary_path(), paint.clone(), true, tf)),
                ("wide-5.25", stroke(scan_grid_boundary_path(), paint.clone(), 5.25, 2, 0, 8., tf)),
                ("wide-10.5", stroke(scan_grid_boundary_path(), paint.clone(), 10.5, 1, 2, 1., tf)),
                ("hairline-zero", stroke(scan_grid_boundary_path(), paint.clone(), 0., 1, 1, 1., tf)),
                ("hairline-thin", stroke(scan_grid_boundary_path(), paint.clone(), 0.8, 2, 2, 1., tf)),
            ] {
                let label = format!("scan-grid/{axis}/canvas={}x{}/{geometry}/{paint_name}", size.width, size.height);
                let mut frame = material(vec![source]);
                frame.width = size.width;
                frame.height = size.height;
                let expected = cpu(&frame, &blank);
                assert!(expected.chunks_exact(4).any(|p| p[3] != 0), "{label}: CPU fixture must paint");
                // CPU scanning of a final single-column tile can omit
                // hairlines even with an explicit segment at its pixel center.
                // Keep that CPU result in the full-frame oracle, and require
                // actual cross-grid support for the nine-pixel final tile.
                for coordinate in [8190, 8191] {
                    let painted_pixels = if axis == "x" {
                        (0..size.height)
                            .filter(|&y| expected[((y * size.width + coordinate) * 4 + 3) as usize] != 0)
                            .count()
                    } else {
                        (0..size.width)
                            .filter(|&x| expected[((coordinate * size.width + x) * 4 + 3) as usize] != 0)
                            .count()
                    };
                    eprintln!("device coverage {label} cpu_scanner_coordinate={coordinate} cpu_painted_pixels={painted_pixels}");
                    if long_side == 8192 && coordinate == 8191 && geometry.starts_with("hairline-") {
                        // This particular CPU golden was independently observed
                        // with both curved and explicit straight segments. The
                        // transpose and positive-thin cases remain their actual
                        // CPU oracle rather than assuming identical scan quirks.
                        if axis == "x" && geometry == "hairline-zero" {
                            assert_eq!(painted_pixels, 0, "{label}: CPU single-column zero-width hairline golden changed");
                        }
                    } else {
                        assert!(painted_pixels > 0, "{label}: fixture must paint scanner coordinate {coordinate}");
                    }
                }
                let first = render(&mut renderer, &frame, &output, true);
                assert_eq!(first.submissions, 1, "{label}: one submission");
                let actual = read(&device, &queue, &output);
                if let Some(failure) = compare(&label, size, &expected, &actual) {
                    failures.push(failure);
                }
                let replay = render(&mut renderer, &frame, &output, true);
                assert_eq!(
                    replay.prepared_masks, first.prepared_masks,
                    "{label}: same-frame scan coverage must be cached"
                );
                assert_eq!(read(&device, &queue, &output), actual, "{label}: replay changed RGBA");
                count += 1;
            }
        }
    }
    assert_eq!(count, expected_count);
    assert!(count >= 60, "at least both 8192-pixel canvases must be exercised");
    eprintln!("device coverage 8k cases={count} failures={}", failures.len());
    assert!(failures.is_empty(), "8k scan-grid full-RGBA errors:\n{}", failures.join("\n"));
}

#[test]
fn cpu_preparation_scratch_is_bounded_shared_and_reused_with_explicit_over_budget_errors() {
    const BUDGET: usize = 64 * 1024 * 1024;
    fn mask(scene: compositor::SceneFrame, color: bool) -> Arc<compositor::GlyphMask> {
        let [compositor::SceneNode::Glyphs(run)] = scene.nodes.as_slice() else {
            panic!("preparation fixture must produce one glyph run")
        };
        assert_eq!(run.glyphs.len(), 1);
        let mask = run.glyphs[0].mask.clone();
        assert_eq!(mask.pixels.is_color(), color, "preparation fixture returned the wrong mask kind");
        assert!(
            mask.pixels.data().iter().any(|b| *b != 0),
            "preparation fixture must actually paint"
        );
        assert!(
            mask.width <= 2046 && mask.height <= 2046,
            "only bounded cropped glyph pixels may remain resident"
        );
        mask
    }
    let fill_source = fill(contours(), PaintData::Solid([0.13, 0.81, 0.42, 0.63]), true, ID);
    let wide_source = stroke(sharp(), PaintData::Solid([0.83, 0.17, 0.46, 0.71]), 10.5, 2, 0, 8., ID);
    let hair_source = stroke(sharp(), paints()[3].1.clone(), 0.8, 1, 1, 1., ID);
    let mut cache = compositor::RetainedDrawCache::default();
    assert_eq!(cache.preparation_bytes(), 0);
    let fill_mask = mask(cache.prepare_for_canvas(&fill_source, 2048, 2048).unwrap(), false);
    assert_eq!(
        cache.preparation_bytes(),
        2048 * 2048,
        "normal path must use A8 preparation scratch"
    );
    let wide_mask = mask(cache.prepare_for_canvas(&wide_source, 2048, 2048).unwrap(), false);
    assert_eq!(cache.preparation_bytes(), 2048 * 2048, "wide stroke must reuse A8 scratch");
    let hair_mask = mask(cache.prepare_for_canvas(&hair_source, 2048, 2048).unwrap(), true);
    assert_eq!(
        cache.preparation_bytes(),
        2048 * 2048 * 5,
        "A8 and painted RGBA scratch can coexist within their shared budget"
    );
    let prepared = cache.prepared_masks();
    for (source, original, color) in [
        (&fill_source, &fill_mask, false),
        (&wide_source, &wide_mask, false),
        (&hair_source, &hair_mask, true),
    ] {
        let before = cache.preparation_bytes();
        let replay = mask(cache.prepare_for_canvas(source, 2048, 2048).unwrap(), color);
        assert_eq!(
            cache.prepared_masks(),
            prepared,
            "same-frame preparation must reuse its immutable tile"
        );
        assert_eq!(cache.preparation_bytes(), before, "cache hit must not rebuild preparation scratch");
        assert!(Arc::ptr_eq(&replay, original));
    }
    let color_limit = stroke(sharp(), paints()[3].1.clone(), 0.8, 1, 1, 1., transforms()[1].1);
    mask(cache.prepare_for_canvas(&color_limit, 4096, 4096).unwrap(), true);
    assert_eq!(
        cache.preparation_bytes(),
        BUDGET,
        "64MiB RGBA scratch must retire incompatible A8 scratch"
    );
    let normal_after = fill(contours(), PaintData::Solid([1.; 4]), true, transforms()[2].1);
    mask(cache.prepare_for_canvas(&normal_after, 4096, 4096).unwrap(), false);
    assert_eq!(
        cache.preparation_bytes(),
        4096 * 4096,
        "new A8 scratch must retire RGBA when their sum exceeds budget"
    );
    let color_after = stroke(sharp(), paints()[3].1.clone(), 0., 1, 1, 1., transforms()[2].1);
    mask(cache.prepare_for_canvas(&color_after, 4096, 4096).unwrap(), true);
    assert_eq!(
        cache.preparation_bytes(),
        BUDGET,
        "normal and hairline modes must respect one shared scratch budget"
    );
    assert!(
        cache.resident_bytes() <= BUDGET,
        "uploaded cropped glyph cache has a separate bounded budget"
    );

    // These sizes exceed A8 or RGBA scratch budgets independently. Validate
    // through the CPU preparation API so no enormous GPU target is allocated.
    for (label, source, width, height) in [
        ("normal-fill-a8", fill_source.clone(), 8193, 8193),
        ("wide-stroke-a8", wide_source.clone(), 8193, 8193),
        ("thin-hairline-rgba", hair_source.clone(), 4097, 4096),
        ("zero-hairline-rgba", color_after.clone(), 4097, 4096),
        ("uint-max-normal-a8", fill_source.clone(), u32::MAX, u32::MAX),
        ("uint-max-wide-a8", wide_source.clone(), u32::MAX, u32::MAX),
        ("uint-max-thin-rgba", hair_source.clone(), u32::MAX, u32::MAX),
        ("uint-max-zero-rgba", color_after.clone(), u32::MAX, u32::MAX),
    ] {
        let before = (cache.prepared_masks(), cache.resident_bytes(), cache.preparation_bytes());
        let error = cache
            .prepare_for_canvas(&source, width, height)
            .expect_err("over-budget CPU preparation must be rejected before allocation");
        assert!(error.to_string().contains("gpu-draw-preparation-budget"), "{label}: {error}");
        assert_eq!(
            (cache.prepared_masks(), cache.resident_bytes(), cache.preparation_bytes()),
            before,
            "{label}: rejection mutated established masks or scratch"
        );
        for (known, original, color) in [
            (&fill_source, &fill_mask, false),
            (&wide_source, &wide_mask, false),
            (&hair_source, &hair_mask, true),
        ] {
            let replay = mask(cache.prepare_for_canvas(known, 2048, 2048).unwrap(), color);
            assert_eq!(
                cache.prepared_masks(),
                before.0,
                "{label}: rejection must preserve all mode cache hits"
            );
            assert!(Arc::ptr_eq(&replay, original), "{label}: rejection replaced a resident mask");
            assert!(cache.preparation_bytes() <= BUDGET);
        }
    }
}
