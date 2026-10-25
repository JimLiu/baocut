//! Ordered AA stroke replay against the unchanged CPU DrawOp executor.
//! Synthetic paths only. A StrokePath with many contours remains one DrawOp;
//! splitting it into separate operations would evade the per-source failure.
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
        anyhow::bail!("stroke-replay conformance must not request media {id}")
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
            "stroke-replay adapter={} backend={:?} type={:?}",
            info.name, info.backend, info.device_type
        );
        if std::env::var_os("BAOCUT_REQUIRE_GPU").is_some() {
            assert_ne!(info.device_type, wgpu::DeviceType::Cpu, "software adapter is forbidden");
        }
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("baocut.stroke-replay.conformance"),
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
        label: Some("baocut.stroke-replay.test-target"),
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
        label: Some("baocut.stroke-replay.test-only-readback"),
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
                capture: None,
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

fn all_paints() -> Vec<(&'static str, PaintData)> {
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

fn paints() -> Vec<(&'static str, PaintData)> {
    all_paints().into_iter().take(4).collect()
}
fn tested_transforms() -> Vec<(&'static str, Mat6)> {
    transforms().into_iter().filter(|(name, _)| *name != "shear").collect()
}
fn line_contours(count: usize) -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    for _ in 0..count {
        p.move_to(10.2, 20.5);
        p.line_to(100.2, 20.5);
    }
    path_from_skia(&p.finish().unwrap())
}
fn subdivided_curves(count: usize) -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    for _ in 0..count {
        p.move_to(12.4, 53.8);
        p.cubic_to(31.7, -11.2, 70.3, 112.4, 99.1, 34.8);
        p.quad_to(69.3, 83.2, 20.8, 64.6);
        p.cubic_to(92.7, 8.2, 6.3, 22.4, 96.1, 55.8);
    }
    path_from_skia(&p.finish().unwrap())
}
fn rect(x: f32, y: f32, w: f32, h: f32) -> PathData {
    path_from_skia(&tiny_skia::PathBuilder::from_rect(tiny_skia::Rect::from_xywh(x, y, w, h).unwrap()))
}
fn without_tested_path_strokes(source: &FrameOps) -> Arc<FrameOps> {
    Arc::new(FrameOps {
        paths: source.paths.clone(),
        paints: source.paints.clone(),
        ops: source
            .ops
            .iter()
            .filter(|op| !matches!(op, DrawOp::StrokePath { path: 0, .. } | DrawOp::StrokePathPaint { path: 0, .. }))
            .cloned()
            .collect(),
        ..Default::default()
    })
}
fn background(size: Size, color: [f32; 4]) -> DrawOp {
    DrawOp::FillRect {
        x: 0.,
        y: 0.,
        w: size.width as f32,
        h: size.height as f32,
        radius: 0.,
        color,
        tf: ID,
    }
}
fn source(path: PathData, paint: PaintData, width: f32, cap: u8, tf: Mat6, size: Size, underlay: u8) -> Arc<FrameOps> {
    let mut f = FrameOps {
        paths: vec![path, rect(7.3, 12.7, 97.1, 65.3)],
        paints: vec![paint, PaintData::Solid([0.31, 0.79, 0.42, 0.83])],
        ..Default::default()
    };
    f.ops.push(background(size, [0.71, 0.43, 0.87, 1.]));
    if underlay == 1 {
        f.ops.push(DrawOp::FillPathPaint {
            path: 1,
            paint: 1,
            even_odd: false,
            tf,
        });
    } else if underlay == 2 {
        f.ops.push(DrawOp::StrokePathPaint {
            path: 1,
            paint: 1,
            width: 10.5,
            cap: 2,
            join: 0,
            miter: 8.,
            tf,
        });
    }
    f.ops.push(DrawOp::StrokePathPaint {
        path: 0,
        paint: 0,
        width,
        cap,
        join: 1,
        miter: 4.,
        tf,
    });
    Arc::new(f)
}
struct Case {
    label: String,
    source: Arc<FrameOps>,
    size: Size,
    exact: bool,
    probe: Option<([u32; 2], [u8; 4])>,
}
fn case(label: String, source: Arc<FrameOps>) -> Case {
    Case {
        label,
        source,
        size: SIZE,
        exact: false,
        probe: None,
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
    eprintln!("stroke-replay {label} rgba_max={maxima:?} rgba_mae={mae:?}");
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
        return;
    };
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let mut failures = Vec::new();
    let count = cases.len();
    for c in cases {
        if c.size.width.max(c.size.height) > device.limits().max_texture_dimension_2d {
            assert!(
                std::env::var_os("BAOCUT_REQUIRE_GPU").is_none(),
                "required GPU replay case {} cannot skip unsupported texture dimension",
                c.label
            );
            eprintln!(
                "stroke replay {} skipped: actual texture dimension limit {}",
                c.label,
                device.limits().max_texture_dimension_2d
            );
            continue;
        }
        let mut frame = material(vec![c.source.clone()]);
        frame.width = c.size.width;
        frame.height = c.size.height;
        let mut underlying = material(vec![without_tested_path_strokes(&c.source)]);
        underlying.width = c.size.width;
        underlying.height = c.size.height;
        let blank = vec![0; (c.size.width * c.size.height * 4) as usize];
        let expected = cpu(&frame, &blank);
        assert_ne!(
            expected,
            cpu(&underlying, &blank),
            "{}: fixture must contain a visible CPU stroke effect, not only its backdrop",
            c.label
        );
        let output = target(&device, c.size);
        let first = render(&mut renderer, &frame, &output, true);
        assert_eq!(first.submissions, 1, "{}: one submission", c.label);
        let actual = read(&device, &queue, &output);
        if let Some((xy, rgba)) = c.probe {
            let i = ((xy[1] * c.size.width + xy[0]) * 4) as usize;
            assert_eq!(
                &expected[i..i + 4],
                &rgba,
                "{}: independently established CPU golden changed",
                c.label
            );
            assert_eq!(
                &actual[i..i + 4],
                &rgba,
                "{}: ordered-blit counterexample must match the CPU golden exactly",
                c.label
            );
        }
        if c.exact {
            assert_eq!(
                actual, expected,
                "{}: known seven-byte ordered-blit gap must be eliminated",
                c.label
            );
        }
        if let Some(f) = compare(&c.label, c.size, &expected, &actual) {
            failures.push(f);
        }
        let replay = render(&mut renderer, &frame, &output, true);
        assert_eq!(
            replay.prepared_masks, first.prepared_masks,
            "{}: same-frame replay must not prepare another resource",
            c.label
        );
        assert_eq!(
            replay.prepared_strokes, first.prepared_strokes,
            "{}: repeated frame must reuse its prepared ordered stroke programs",
            c.label
        );
        assert_eq!(read(&device, &queue, &output), actual, "{}: cached replay changed RGBA", c.label);
    }
    eprintln!("stroke replay requested_cases={count} failures={}", failures.len());
    assert!(failures.is_empty(), "ordered stroke full-RGBA errors:\n{}", failures.join("\n"));
}

#[test]
fn literal_single_stroke_nine_contours_over_gray_29_eliminates_the_seven_byte_gap() {
    let size = Size { width: 112, height: 48 };
    let source = Arc::new(FrameOps {
        paths: vec![line_contours(9)],
        ops: vec![
            background(size, [29. / 255., 29. / 255., 29. / 255., 1.]),
            DrawOp::StrokePath {
                path: 0,
                color: [0., 0., 0., 1.],
                width: 0.036,
                tf: ID,
            },
        ],
        ..Default::default()
    });
    assert_eq!(source.ops.len(), 2, "literal counterexample is FillRect followed by one StrokePath");
    assert_eq!(
        source.paths[0].0.iter().filter(|s| s.verb == 0).count(),
        9,
        "all nine same-direction contours belong to the single stroke"
    );
    run(vec![Case {
        label: "literal-nine-contours/.036/gray29".into(),
        source,
        size,
        exact: true,
        probe: Some(([30, 20], [28, 28, 28, 255])),
    }]);
}

#[test]
fn internal_curve_subdivision_and_contour_order_match_cpu_with_all_caps_and_paints() {
    let mut cases = Vec::new();
    for (geometry, path) in [("nine-contours", line_contours(9)), ("subdivided-curves", subdivided_curves(3))] {
        for width in [0., 0.036, 0.8] {
            for cap in 0..3 {
                for (paint_name, paint) in paints() {
                    for (tf_name, tf) in tested_transforms() {
                        cases.push(case(
                            format!("{geometry}/width={width}/cap={cap}/{paint_name}/{tf_name}"),
                            source(path.clone(), paint.clone(), width, cap, tf, SIZE, 0),
                        ));
                    }
                }
            }
        }
    }
    run(cases);
}

#[test]
fn stroke_order_over_nonzero_fills_and_wide_strokes_matches_cpu_rgba() {
    let mut cases = Vec::new();
    for underlay in 0..3 {
        for width in [0.036, 0.8] {
            for (paint_name, paint) in paints() {
                for (tf_name, tf) in [tested_transforms()[0], tested_transforms()[2], tested_transforms()[3]] {
                    cases.push(case(
                        format!("underlay={underlay}/width={width}/{paint_name}/{tf_name}"),
                        source(subdivided_curves(4), paint.clone(), width, 2, tf, SIZE, underlay),
                    ));
                }
            }
        }
    }
    run(cases);
}

#[test]
fn nested_normal_opacity_and_multiple_ordered_strokes_match_cpu_rgba() {
    let mut cases = Vec::new();
    for width in [0.036, 0.8] {
        for (paint_name, paint) in paints() {
            for (tf_name, tf) in [tested_transforms()[0], tested_transforms()[2], tested_transforms()[3]] {
                for (outer, inner) in [(0.43, 0.31), (0.79, 0.67)] {
                    let source = Arc::new(FrameOps {
                        paths: vec![subdivided_curves(3), line_contours(9), rect(13.2, 17.3, 83.1, 58.4)],
                        paints: vec![
                            paint.clone(),
                            PaintData::Solid([0.83, 0.17, 0.46, 0.53]),
                            PaintData::Solid([0.12, 0.71, 0.94, 0.67]),
                        ],
                        ops: vec![
                            background(SIZE, [0.71, 0.43, 0.87, 1.]),
                            DrawOp::PushLayer {
                                opacity: outer,
                                blend: BlendMode::Normal,
                            },
                            DrawOp::FillPathPaint {
                                path: 2,
                                paint: 2,
                                even_odd: false,
                                tf,
                            },
                            DrawOp::StrokePathPaint {
                                path: 0,
                                paint: 0,
                                width,
                                cap: 0,
                                join: 1,
                                miter: 4.,
                                tf,
                            },
                            DrawOp::PushLayer {
                                opacity: inner,
                                blend: BlendMode::Normal,
                            },
                            DrawOp::StrokePathPaint {
                                path: 1,
                                paint: 1,
                                width: 0.8,
                                cap: 2,
                                join: 2,
                                miter: 4.,
                                tf,
                            },
                            DrawOp::StrokePathPaint {
                                path: 0,
                                paint: 0,
                                width: 0.,
                                cap: 1,
                                join: 1,
                                miter: 4.,
                                tf,
                            },
                            DrawOp::PopLayer,
                            DrawOp::StrokePathPaint {
                                path: 1,
                                paint: 2,
                                width,
                                cap: 1,
                                join: 1,
                                miter: 4.,
                                tf,
                            },
                            DrawOp::PopLayer,
                        ],
                        ..Default::default()
                    });
                    cases.push(case(
                        format!("nested/width={width}/{paint_name}/{tf_name}/outer={outer}/inner={inner}"),
                        source,
                    ));
                }
            }
        }
    }
    run(cases);
}

#[test]
fn ordered_aa_strokes_preserve_cpu_eight_k_clipping_and_scanning() {
    let mut cases = Vec::new();
    for (axis, size, tf) in [
        ("x", Size { width: 8192, height: 64 }, [1., 0., 0., 1., 8100.37, -0.17]),
        ("y", Size { width: 64, height: 8192 }, [0., 1., 1., 0., -0.17, 8100.37]),
        ("x", Size { width: 8200, height: 64 }, [1., 0., 0., 1., 8100.37, -0.17]),
        ("y", Size { width: 64, height: 8200 }, [0., 1., 1., 0., -0.17, 8100.37]),
    ] {
        for width in [0., 0.8] {
            for (paint_name, paint) in paints() {
                cases.push(Case {
                    label: format!("clip/{axis}/{}x{}/width={width}/{paint_name}", size.width, size.height),
                    source: source(subdivided_curves(3), paint, width, 1, tf, size, 0),
                    size,
                    exact: false,
                    probe: None,
                });
            }
        }
    }
    run(cases);
}

#[test]
fn ordered_aa_event_budget_rejection_preserves_the_actual_target() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device, SIZE);
    let view = output.create_view(&Default::default());
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let backdrop: Vec<u8> = (0..SIZE.width * SIZE.height).flat_map(|i| [(i % 79) as u8, 31, 47, 255]).collect();
    // One literal StrokePath drives many ordered events at the same pixels.
    // A budget must reject the program instead of dropping/coalescing events.
    // The final stable event threshold/error classification is owned by the
    // public renderer; this draft does not call proposed internal APIs.
    let huge = Arc::new(FrameOps {
        paths: vec![line_contours(262_144)],
        ops: vec![
            background(SIZE, [1.; 4]),
            DrawOp::StrokePath {
                path: 0,
                color: [0., 0., 0., 1.],
                width: 0.036,
                tf: ID,
            },
        ],
        ..Default::default()
    });
    assert_eq!(huge.ops.len(), 2, "event-budget input must remain one stroke, not many ops");
    write(&queue, &output, &backdrop);
    let error = renderer
        .render(
            &material(vec![huge]),
            RenderTarget {
                view: &view,
                width: SIZE.width,
                height: SIZE.height,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            true,
        )
        .expect_err("over-budget ordered AA program must be rejected explicitly");
    assert!(
        error.to_string().contains("budget"),
        "ordered AA budget rejection must identify its resource limit: {error}"
    );
    assert_eq!(
        read(&device, &queue, &output),
        backdrop,
        "budget rejection changed target or submitted preceding content"
    );
}

#[test]
fn unique_ordered_programs_share_one_frame_budget_across_multiple_draw_sources() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let size = Size { width: 1024, height: 1024 };
    let output = target(&device, size);
    let view = output.create_view(&Default::default());
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let rectangle = rect(20.25, 20.25, 900., 900.);
    let sources: Vec<_> = (0..10)
        .map(|i| {
            Arc::new(FrameOps {
                paths: vec![rectangle.clone()],
                paints: vec![PaintData::Solid([0., 0., 0., 1.])],
                ops: vec![DrawOp::StrokePathPaint {
                    path: 0,
                    paint: 0,
                    width: 0.036,
                    cap: 0,
                    join: 1,
                    miter: 4.,
                    tf: [1., 0., 0., 1., i as f32 * 0.01, 0.],
                }],
                ..Default::default()
            })
        })
        .collect();
    // A roughly 905x905 offset/count/support ROI is about 7MiB per program;
    // events are sparse. Every source independently fits capture/event budgets,
    // while ten distinct transforms exceed the shared 64MiB CPU frame ledger.
    // Cache eviction cannot release programs still retained by the frame plans.
    let mut warm = material(vec![sources[0].clone()]);
    warm.width = size.width;
    warm.height = size.height;
    let first = render(&mut renderer, &warm, &output, true);
    assert_eq!(first.submissions, 1, "one outlined rectangle must be admitted individually");
    assert!(first.prepared_strokes > 0, "single source must prepare an ordered coverage program");
    let warm_pixels = read(&device, &queue, &output);
    assert!(
        warm_pixels.chunks_exact(4).any(|p| p[3] != 0),
        "individually admitted ordered program must actually paint"
    );
    let replay = render(&mut renderer, &warm, &output, true);
    assert_eq!(
        replay.prepared_strokes, first.prepared_strokes,
        "identical warm frame must reuse its ordered program"
    );
    assert_eq!(
        replay.prepared_masks, first.prepared_masks,
        "identical warm frame must reuse all other prepared masks"
    );
    assert_eq!(read(&device, &queue, &output), warm_pixels, "warm repeated frame changed RGBA");
    let preceding = Arc::new(FrameOps {
        ops: vec![background(size, [1.; 4])],
        ..Default::default()
    });
    let mut all_sources = vec![preceding];
    all_sources.extend(sources);
    let mut frame = material(all_sources);
    frame.width = size.width;
    frame.height = size.height;
    let backdrop: Vec<u8> = (0..size.width * size.height).flat_map(|i| [(i % 79) as u8, 31, 47, 255]).collect();
    write(&queue, &output, &backdrop);
    let error = renderer
        .render(
            &frame,
            RenderTarget {
                view: &view,
                width: size.width,
                height: size.height,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            true,
        )
        .expect_err("multiple admitted sources must share one bounded CPU event-program frame ledger");
    assert!(
        error.to_string().contains("gpu-stroke-program-frame-budget"),
        "global program budget must be distinct from per-program event, GPU surface, and slot limits: {error}"
    );
    assert_eq!(
        read(&device, &queue, &output),
        backdrop,
        "global CPU frame rejection submitted preceding content or changed the target"
    );
}
