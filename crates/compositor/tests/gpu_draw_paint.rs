//! Public Draw-source conformance against the independent CPU DrawOp executor.
//! Immutable 4x masks have different AA from canvas rasterization: measure their
//! edges separately, while requiring strict per-pixel interior paint/group fidelity.
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
        anyhow::bail!("paint conformance must not request media {id}")
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
            "draw-paint adapter={} backend={:?} type={:?}",
            info.name, info.backend, info.device_type
        );
        if std::env::var_os("BAOCUT_REQUIRE_GPU").is_some() {
            assert_ne!(info.device_type, wgpu::DeviceType::Cpu, "software adapter is forbidden");
        }
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("baocut.draw-paint.conformance"),
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

fn target(device: &wgpu::Device) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("baocut.draw-paint.test-target"),
        size: wgpu::Extent3d {
            width: SIZE.width,
            height: SIZE.height,
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
            bytes_per_row: Some(SIZE.width * 4),
            rows_per_image: Some(SIZE.height),
        },
        wgpu::Extent3d {
            width: SIZE.width,
            height: SIZE.height,
            depth_or_array_layers: 1,
        },
    );
}

fn read(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture) -> Vec<u8> {
    let stride = (SIZE.width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("baocut.draw-paint.test-only-readback"),
        size: u64::from(stride * SIZE.height),
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
                rows_per_image: Some(SIZE.height),
            },
        },
        wgpu::Extent3d {
            width: SIZE.width,
            height: SIZE.height,
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
        .flat_map(|row| row[..SIZE.width as usize * 4].iter().copied())
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
                width: SIZE.width,
                height: SIZE.height,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            clear,
        )
        .expect("supported Draw-source frame")
}

fn cpu(frame: &MaterialFrame, backdrop: &[u8]) -> Vec<u8> {
    let mut output = tiny_skia::Pixmap::from_vec(backdrop.to_vec(), tiny_skia::IntSize::from_wh(SIZE.width, SIZE.height).unwrap()).unwrap();
    for layer in &frame.layers {
        let MaterialSource::Draw(ops) = &layer.source else { unreachable!() };
        let source = rasterize_with_media(ops, SIZE.width, SIZE.height, &mut NoMedia).unwrap();
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

fn rect(x: f32, y: f32, w: f32, h: f32) -> PathData {
    path_from_skia(&tiny_skia::PathBuilder::from_rect(tiny_skia::Rect::from_xywh(x, y, w, h).unwrap()))
}

fn sharp_path() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(19., 66.);
    p.line_to(48., 17.);
    p.line_to(55., 68.);
    p.line_to(88., 53.);
    path_from_skia(&p.finish().unwrap())
}

fn fill(paint: PaintData, path: PathData, tf: Mat6, even_odd: bool) -> Arc<FrameOps> {
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

fn stroke(paint: PaintData, cap: u8, join: u8, miter: f32, width: f32, tf: Mat6) -> Arc<FrameOps> {
    Arc::new(FrameOps {
        paths: vec![sharp_path()],
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

fn stop(offset: f32, color: [f32; 4]) -> GradientStop {
    GradientStop { offset, color }
}
fn linear(stops: Vec<GradientStop>) -> PaintData {
    PaintData::Linear {
        p0: [16., 28.],
        p1: [92., 60.],
        stops,
    }
}

fn transforms() -> [(&'static str, Mat6); 3] {
    [
        ("identity", ID),
        ("fractional", [1., 0., 0., 1., 0.37, -0.29]),
        ("rotation", [0.9553365, 0.2955202, -0.2955202, 0.9553365, 15.13, -9.27]),
    ]
}

// Geometry-only masks define the admitted AA band independently of actual colors
// and group opacity. Every primitive contributes, including occluded boundaries.
fn edge_band(frame: &MaterialFrame) -> Vec<bool> {
    let mut edge = vec![false; (SIZE.width * SIZE.height) as usize];
    for layer in &frame.layers {
        let MaterialSource::Draw(source) = &layer.source else {
            unreachable!()
        };
        for op in &source.ops {
            let white = match op {
                DrawOp::FillPathPaint { path, even_odd, tf, .. } => DrawOp::FillPathPaint {
                    path: *path,
                    paint: 0,
                    even_odd: *even_odd,
                    tf: *tf,
                },
                DrawOp::StrokePathPaint {
                    path,
                    width,
                    cap,
                    join,
                    miter,
                    tf,
                    ..
                } => DrawOp::StrokePathPaint {
                    path: *path,
                    paint: 0,
                    width: *width,
                    cap: *cap,
                    join: *join,
                    miter: *miter,
                    tf: *tf,
                },
                DrawOp::FillRect {
                    x, y, w, h, radius, tf, ..
                } => DrawOp::FillRect {
                    x: *x,
                    y: *y,
                    w: *w,
                    h: *h,
                    radius: *radius,
                    color: [1.; 4],
                    tf: *tf,
                },
                _ => continue,
            };
            let mask_frame = FrameOps {
                paths: source.paths.clone(),
                paints: vec![PaintData::Solid([1.; 4])],
                ops: vec![white],
                ..Default::default()
            };
            let mask = rasterize_with_media(&mask_frame, SIZE.width, SIZE.height, &mut NoMedia).unwrap();
            for y in 1..SIZE.height as i32 - 1 {
                for x in 1..SIZE.width as i32 - 1 {
                    let a = mask.data()[((y as u32 * SIZE.width + x as u32) * 4 + 3) as usize];
                    let boundary = (1..255).contains(&a)
                        || [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)].into_iter().any(|(nx, ny)| {
                            let b = mask.data()[((ny as u32 * SIZE.width + nx as u32) * 4 + 3) as usize];
                            (a == 0) != (b == 0) || (a == 255) != (b == 255)
                        });
                    if boundary {
                        for dy in -2..=2 {
                            for dx in -2..=2 {
                                let (nx, ny) = (x + dx, y + dy);
                                if nx >= 0 && ny >= 0 && nx < SIZE.width as i32 && ny < SIZE.height as i32 {
                                    edge[(ny as u32 * SIZE.width + nx as u32) as usize] = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    edge
}

fn bounds(pixels: &[u8]) -> Option<[u32; 4]> {
    let mut b = [SIZE.width, SIZE.height, 0, 0];
    let mut found = false;
    for (i, p) in pixels.chunks_exact(4).enumerate() {
        if p[3] > 16 {
            let (x, y) = (i as u32 % SIZE.width, i as u32 / SIZE.width);
            b[0] = b[0].min(x);
            b[1] = b[1].min(y);
            b[2] = b[2].max(x);
            b[3] = b[3].max(y);
            found = true;
        }
    }
    found.then_some(b)
}

fn compare(label: &str, frame: &MaterialFrame, expected: &[u8], actual: &[u8]) {
    assert_eq!(expected.len(), actual.len());
    let edge = edge_band(frame);
    let mut maxima = [0u8; 2];
    let mut sums = [0u64; 2];
    let mut counts = [0u64; 2];
    let mut worst = [0usize; 2];
    let mut painted_interior = 0;
    for (i, (a, b)) in expected.iter().zip(actual).enumerate() {
        let region = usize::from(edge[i / 4]);
        let error = a.abs_diff(*b);
        if error > maxima[region] {
            maxima[region] = error;
            worst[region] = i;
        }
        sums[region] += u64::from(error);
        counts[region] += 1;
        if i % 4 == 3 && region == 0 && *a > 16 {
            painted_interior += 1;
        }
    }
    let mae = std::array::from_fn::<_, 2, _>(|i| sums[i] as f64 / counts[i].max(1) as f64);
    let (cpu_bounds, gpu_bounds) = (bounds(expected), bounds(actual));
    eprintln!(
        "draw-paint {label} interior_max={} interior_mae={:.4} edge_max={} edge_mae={:.4} painted_interior={painted_interior} cpu_support={cpu_bounds:?} gpu_support={gpu_bounds:?}",
        maxima[0], mae[0], maxima[1], mae[1]
    );
    let i = worst[0];
    assert!(
        maxima[0] <= 3,
        "{label}: interior error={} at ({},{}) channel={} cpu={} gpu={}",
        maxima[0],
        i / 4 % SIZE.width as usize,
        i / 4 / SIZE.width as usize,
        i % 4,
        expected[i],
        actual[i]
    );
    assert!(
        maxima[1] <= 48 && mae[1] <= 3.,
        "{label}: AA edge mismatch max={} MAE={}",
        maxima[1],
        mae[1]
    );
    match (cpu_bounds, gpu_bounds) {
        (Some(a), Some(b)) => {
            for axis in 0..4 {
                assert!(a[axis].abs_diff(b[axis]) <= 1, "{label}: support mismatch {a:?} versus {b:?}");
            }
        }
        (None, None) => {}
        _ => panic!("{label}: support disappeared or appeared"),
    }
}

#[test]
fn solid_even_odd_and_every_stroke_cap_join_miter_match_cpu() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let backdrop = vec![0; (SIZE.width * SIZE.height * 4) as usize];
    let mut donut = tiny_skia::PathBuilder::new();
    donut.push_rect(tiny_skia::Rect::from_xywh(16., 14., 78., 68.).unwrap());
    donut.push_rect(tiny_skia::Rect::from_xywh(34., 31., 40., 34.).unwrap());
    let donut = path_from_skia(&donut.finish().unwrap());
    for (name, tf) in transforms() {
        for even_odd in [false, true] {
            let f = material(vec![fill(PaintData::Solid([0.2, 0.7, 0.9, 0.63]), donut.clone(), tf, even_odd)]);
            assert_eq!(render(&mut renderer, &f, &output, true).submissions, 1);
            let actual = read(&device, &queue, &output);
            compare(&format!("solid/{name}/evenodd={even_odd}"), &f, &cpu(&f, &backdrop), &actual);
            if even_odd && name == "identity" {
                assert_eq!(
                    &actual[((46 * SIZE.width + 52) * 4) as usize..((46 * SIZE.width + 52) * 4 + 4) as usize],
                    &[0; 4],
                    "same-winding inner contour must be a hole"
                );
            }
        }
        for cap in 0..3 {
            for join in 0..3 {
                for miter in [1., 2., 8.] {
                    for width in [5.25, 10.5] {
                        let f = material(vec![stroke(
                            PaintData::Solid([0.85, 0.31, 0.17, 0.72]),
                            cap,
                            join,
                            miter,
                            width,
                            tf,
                        )]);
                        assert_eq!(render(&mut renderer, &f, &output, true).submissions, 1);
                        compare(
                            &format!("stroke/{name}/cap={cap}/join={join}/miter={miter}/width={width}"),
                            &f,
                            &cpu(&f, &backdrop),
                            &read(&device, &queue, &output),
                        );
                    }
                }
            }
        }
    }
}

fn gradient_profiles() -> Vec<(&'static str, PaintData)> {
    let red = [0.94, 0.08, 0.19, 1.];
    let blue = [0.05, 0.21, 0.91, 1.];
    vec![
        ("two", linear(vec![stop(0., red), stop(1., blue)])),
        (
            "three-nonuniform-alpha",
            linear(vec![
                stop(0., [0.9, 0.1, 0.3, 0.17]),
                stop(0.23, [0.1, 0.9, 0.3, 0.82]),
                stop(1., [0.2, 0.1, 0.9, 0.43]),
            ]),
        ),
        (
            "pad-missing-endpoints",
            linear(vec![stop(0.19, red), stop(0.67, [0.2, 0.85, 0.4, 0.61]), stop(0.83, blue)]),
        ),
        (
            "duplicate-hard-edge",
            PaintData::Linear {
                p0: [16., 0.],
                p1: [92., 0.],
                stops: vec![stop(0., red), stop(0.5, red), stop(0.5, blue), stop(1., blue)],
            },
        ),
        (
            "thirty-two",
            linear(
                (0..32)
                    .map(|i| {
                        let t = i as f32 / 31.;
                        stop(
                            t * t,
                            [0.1 + 0.8 * t, 0.85 - 0.7 * t, 0.3 + 0.4 * (t * 9.).sin().abs(), 0.2 + 0.7 * t],
                        )
                    })
                    .collect(),
            ),
        ),
        ("empty-fallback", linear(vec![])),
        ("one-fallback", linear(vec![stop(0.4, [0.2, 0.8, 0.4, 0.67])])),
        (
            "degenerate-fallback",
            PaintData::Linear {
                p0: [3., 4.],
                p1: [3., 4.],
                stops: vec![stop(0., red), stop(1., blue)],
            },
        ),
        (
            "offset-clamp-monotonic",
            linear(vec![
                stop(-0.1, red),
                stop(0.8, [0.3, 0.9, 0.4, 0.7]),
                stop(0.2, [0.5, 0.2, 0.9, 0.5]),
                stop(1.1, blue),
            ]),
        ),
    ]
}

#[test]
fn linear_multistop_alpha_padding_hard_edge_and_local_transform_match_cpu() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let backdrop = vec![0; (SIZE.width * SIZE.height * 4) as usize];
    for (name, paint) in gradient_profiles() {
        for (transform_name, tf) in transforms() {
            for stroked in [false, true] {
                let source = if stroked {
                    stroke(paint.clone(), 2, 0, 8., 12.25, tf)
                } else {
                    fill(paint.clone(), rect(16., 14., 78., 68.), tf, false)
                };
                let f = material(vec![source]);
                let stats = render(&mut renderer, &f, &output, true);
                assert_eq!(stats.submissions, 1);
                assert_eq!(stats.material_passes, 0);
                compare(
                    &format!("linear/{name}/{transform_name}/stroke={stroked}"),
                    &f,
                    &cpu(&f, &backdrop),
                    &read(&device, &queue, &output),
                );
            }
        }
    }
}

#[test]
fn near_degenerate_linear_axis_matches_cpu_last_color_threshold() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let backdrop = vec![0; (SIZE.width * SIZE.height * 4) as usize];
    // tiny-skia's Pad fallback includes the threshold itself. These deltas are
    // representable at x=50.5, so neighboring cases cannot round to the same axis.
    let threshold = 1. / 32768.;
    for delta in [0., 0.000004, threshold * 0.75, threshold, threshold * 1.25, threshold * 2.] {
        let p0 = [50.5, 40.5];
        let p1 = [50.5 + delta, 40.5];
        let paint = PaintData::Linear {
            p0,
            p1,
            stops: vec![stop(0., [1., 0., 0., 1.]), stop(1., [0., 0., 1., 1.])],
        };
        let f = material(vec![fill(paint, rect(16., 14., 78., 68.), ID, false)]);
        assert_eq!(render(&mut renderer, &f, &output, true).submissions, 1);
        let expected = cpu(&f, &backdrop);
        let actual = read(&device, &queue, &output);
        compare(&format!("near-degenerate/delta={delta:.9}"), &f, &expected, &actual);
        let i = ((40 * SIZE.width + 50) * 4) as usize;
        eprintln!(
            "draw-paint near-degenerate probe delta={delta:.9} axis={:.9} cpu={:?} gpu={:?}",
            p1[0] - p0[0],
            &expected[i..i + 4],
            &actual[i..i + 4]
        );
        if p1[0] - p0[0] <= threshold {
            assert_eq!(
                &expected[i..i + 4],
                &[0, 0, 255, 255],
                "CPU must use the last stop at its inclusive degeneracy threshold"
            );
        }
        for c in 0..4 {
            assert!(
                actual[i + c].abs_diff(expected[i + c]) <= 1,
                "near-degenerate center probe differs at delta={delta}, channel={c}"
            );
        }
    }
}

#[test]
fn positive_thin_solid_and_linear_round_strokes_match_cpu() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let backdrop = vec![0; (SIZE.width * SIZE.height * 4) as usize];
    for (paint_name, paint) in [
        ("solid", PaintData::Solid([0.85, 0.31, 0.17, 0.72])),
        ("linear", gradient_profiles()[1].1.clone()),
    ] {
        for (transform_name, tf) in transforms() {
            for width in [0.25, 0.75, 0.832] {
                let f = material(vec![stroke(paint.clone(), 1, 1, 4., width, tf)]);
                assert_eq!(render(&mut renderer, &f, &output, true).submissions, 1);
                compare(
                    &format!("thin/{paint_name}/{transform_name}/width={width}"),
                    &f,
                    &cpu(&f, &backdrop),
                    &read(&device, &queue, &output),
                );
            }
        }
    }
}

fn grouped(outer: f32, inner: f32, tf: Mat6, gradient: PaintData) -> Arc<FrameOps> {
    Arc::new(FrameOps {
        paths: vec![rect(18., 20., 62., 52.), sharp_path()],
        paints: vec![gradient, PaintData::Solid([0.15, 0.3, 0.94, 0.81])],
        ops: vec![
            DrawOp::PushLayer {
                opacity: outer,
                blend: BlendMode::Normal,
            },
            DrawOp::FillPathPaint {
                path: 0,
                paint: 0,
                even_odd: false,
                tf,
            },
            DrawOp::PushLayer {
                opacity: inner,
                blend: BlendMode::Normal,
            },
            DrawOp::StrokePathPaint {
                path: 1,
                paint: 1,
                width: 17.,
                cap: 2,
                join: 0,
                miter: 6.,
                tf,
            },
            DrawOp::FillRect {
                x: 40.,
                y: 36.,
                w: 43.,
                h: 25.,
                radius: 0.,
                color: [0.92, 0.12, 0.21, 0.74],
                tf,
            },
            DrawOp::PopLayer,
            DrawOp::FillRect {
                x: 28.,
                y: 49.,
                w: 34.,
                h: 22.,
                radius: 0.,
                color: [0.1, 0.86, 0.24, 0.65],
                tf,
            },
            DrawOp::PopLayer,
        ],
        ..Default::default()
    })
}

#[test]
fn isolated_nested_fractional_opacity_ordered_layers_and_seek_cache_match_cpu() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let backdrop: Vec<u8> = (0..SIZE.width * SIZE.height).flat_map(|_| [11, 19, 29, 255]).collect();
    let mut replay = None;
    let mut prepared = None;
    for (phase, reverse) in [(0.31, false), (0.79, false), (0.51, true), (0.31, false)] {
        let mut sources = vec![
            grouped(phase, 0.57, transforms()[1].1, gradient_profiles()[1].1.clone()),
            grouped(0.43, phase, [0.78, 0., 0., 0.82, 19.29, 7.31], gradient_profiles()[2].1.clone()),
        ];
        if reverse {
            sources.reverse();
        }
        let f = material(sources);
        write(&queue, &output, &backdrop);
        let stats = render(&mut renderer, &f, &output, false);
        assert_eq!(stats.submissions, 1);
        assert_eq!(stats.material_passes, 0);
        if let Some(n) = prepared {
            assert_eq!(stats.prepared_masks, n, "opacity/transform seek must reuse immutable geometry");
        } else {
            prepared = Some(stats.prepared_masks);
        }
        let actual = read(&device, &queue, &output);
        compare(&format!("group/phase={phase}/reverse={reverse}"), &f, &cpu(&f, &backdrop), &actual);
        // A central overlap pixel makes per-op opacity multiplication fail even
        // if errors at many transparent pixels would lower whole-frame MAE.
        let i = ((52 * SIZE.width + 52) * 4) as usize;
        let expected = cpu(&f, &backdrop);
        for c in 0..4 {
            assert!(actual[i + c].abs_diff(expected[i + c]) <= 3, "isolated overlap channel {c}");
        }
        if phase == 0.31 {
            if let Some(p) = &replay {
                assert_eq!(&actual, p, "seek replay changed cached source pixels");
            } else {
                replay = Some(actual);
            }
        }
    }
    for outer in [0., 1.] {
        for inner in [0., 1.] {
            let f = material(vec![grouped(outer, inner, ID, gradient_profiles()[0].1.clone())]);
            render(&mut renderer, &f, &output, true);
            compare(
                &format!("group/endpoints/{outer}/{inner}"),
                &f,
                &cpu(&f, &vec![0; (SIZE.width * SIZE.height * 4) as usize]),
                &read(&device, &queue, &output),
            );
        }
    }
}

fn rejected_sources() -> Vec<(&'static str, Arc<FrameOps>)> {
    let valid = || {
        fill(
            linear(vec![stop(0., [1.; 4]), stop(1., [0.1, 0.3, 0.9, 0.8])]),
            rect(16., 14., 78., 68.),
            ID,
            false,
        )
    };
    let mut cases = Vec::new();
    let mut paints = vec![
        PaintData::Radial {
            center: [42., 42.],
            radius: 20.,
            focus: [42., 42.],
            stops: vec![stop(0., [1.; 4]), stop(1., [0.; 4])],
        },
        linear((0..33).map(|i| stop(i as f32 / 32., [1.; 4])).collect()),
        linear(vec![stop(f32::NAN, [1.; 4]), stop(1., [1.; 4])]),
        linear(vec![stop(0., [f32::INFINITY, 0., 0., 1.]), stop(1., [1.; 4])]),
        PaintData::Linear {
            p0: [0., 0.],
            p1: [f32::NAN, 4.],
            stops: vec![stop(0., [1.; 4]), stop(1., [1.; 4])],
        },
    ];
    for paint in paints.drain(..) {
        let code = if matches!(&paint, PaintData::Radial { .. }) {
            "gpu-draw-paint-unsupported"
        } else {
            "gpu-draw-gradient-invalid"
        };
        let mut f = valid();
        Arc::get_mut(&mut f).unwrap().paints[0] = paint;
        cases.push((code, f));
    }
    for opacity in [-0.01, 1.01, f32::NAN, f32::INFINITY] {
        cases.push((
            "gpu-draw-group-opacity-invalid",
            grouped(opacity, 0.5, ID, gradient_profiles()[0].1.clone()),
        ));
    }
    for (code, op) in [
        ("gpu-draw-operation-unsupported", DrawOp::ClipPath { path: 0, tf: ID }),
        ("gpu-draw-matte-root-invalid", DrawOp::PushMatte),
        ("gpu-draw-matte-stack-invalid", DrawOp::PopMatte { mode: 0 }),
        (
            "gpu-draw-layer-blend-unsupported",
            DrawOp::PushLayer {
                opacity: 0.5,
                blend: BlendMode::Multiply,
            },
        ),
        ("gpu-draw-layer-stack-invalid", DrawOp::PopLayer),
    ] {
        let mut f = valid();
        Arc::get_mut(&mut f).unwrap().ops.insert(0, op);
        cases.push((code, f));
    }
    let mut f = valid();
    Arc::get_mut(&mut f).unwrap().ops = vec![
        DrawOp::FillPathPaint {
            path: 0,
            paint: 0,
            even_odd: false,
            tf: ID
        };
        65537
    ];
    cases.push(("gpu-draw-operation-limit", f));
    let mut f = valid();
    Arc::get_mut(&mut f).unwrap().ops = vec![
        DrawOp::FillPathPaint {
            path: 0,
            paint: 0,
            even_odd: false,
            tf: ID
        };
        129
    ];
    cases.push(("gpu-draw-source-composite-limit", f));
    let mut f = valid();
    Arc::get_mut(&mut f).unwrap().ops = std::iter::repeat_n(
        DrawOp::PushLayer {
            opacity: 0.5,
            blend: BlendMode::Normal,
        },
        33,
    )
    .chain(std::iter::repeat_n(DrawOp::PopLayer, 33))
    .collect();
    cases.push(("gpu-draw-layer-depth-limit", f));
    let mut f = valid();
    Arc::get_mut(&mut f).unwrap().ops = (0..129)
        .flat_map(|_| {
            [
                DrawOp::PushLayer {
                    opacity: 0.5,
                    blend: BlendMode::Normal,
                },
                DrawOp::PopLayer,
            ]
        })
        .collect();
    cases.push(("gpu-draw-source-composite-limit", f));
    let mut f = valid();
    Arc::get_mut(&mut f).unwrap().ops[0] = DrawOp::FillPathPaint {
        path: 0,
        paint: 0,
        even_odd: false,
        tf: [0., 0., 0., 0., 30., 40.],
    };
    cases.push(("gpu-draw-gradient-transform-unsupported", f));
    for (width, cap, join, miter) in [
        (-1., 0, 0, 2.),
        (f32::NAN, 0, 0, 2.),
        (5., 3, 0, 2.),
        (5., 0, 3, 2.),
        (5., 0, 0, f32::INFINITY),
    ] {
        cases.push((
            "gpu-draw-stroke-invalid",
            stroke(PaintData::Solid([1.; 4]), cap, join, miter, width, ID),
        ));
    }
    cases
}

#[test]
fn invalid_paints_groups_clip_blend_and_budget_preserve_actual_backdrop() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        return;
    };
    let output = target(&device);
    let view = output.create_view(&Default::default());
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let backdrop: Vec<u8> = (0..SIZE.width * SIZE.height).flat_map(|i| [(i % 79) as u8, 31, 47, 255]).collect();
    render(
        &mut renderer,
        &material(vec![fill(gradient_profiles()[0].1.clone(), rect(16., 14., 78., 68.), ID, false)]),
        &output,
        true,
    );
    for (label, source) in rejected_sources() {
        // Valid preceding content must not be submitted when a later source fails.
        let f = material(vec![fill(PaintData::Solid([1.; 4]), rect(4., 4., 12., 12.), ID, false), source]);
        write(&queue, &output, &backdrop);
        let error = renderer
            .render(
                &f,
                RenderTarget {
                    view: &view,
                    width: SIZE.width,
                    height: SIZE.height,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
                true,
            )
            .expect_err("unsupported/invalid Draw source was accepted");
        let error = error.to_string();
        eprintln!("draw-paint rejected {label}: {error}");
        assert!(error.contains(label), "expected explicit rejection {label}, got {error}");
        assert_eq!(
            read(&device, &queue, &output),
            backdrop,
            "{label}: rejection cleared or partially rendered host target"
        );
    }
}

#[cfg(feature = "gpu-trace")]
#[test]
fn draw_paint_trace_has_one_live_submission_and_no_submission_on_rejection() {
    let Some(directory) = std::env::var_os("BAOCUT_DRAW_PAINT_TRACE_DIR").map(std::path::PathBuf::from) else {
        return;
    };
    std::fs::create_dir_all(&directory).unwrap();
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Directory(directory.clone())) else {
        return;
    };
    let output = target(&device);
    let view = output.create_view(&Default::default());
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let frame = material(vec![
        grouped(0.37, 0.61, ID, gradient_profiles()[1].1.clone()),
        grouped(0.48, 0.73, transforms()[1].1, gradient_profiles()[4].1.clone()),
    ]);
    assert_eq!(render(&mut renderer, &frame, &output, true).submissions, 1);
    for (_, source) in rejected_sources() {
        assert!(
            renderer
                .render(
                    &material(vec![source]),
                    RenderTarget {
                        view: &view,
                        width: SIZE.width,
                        height: SIZE.height,
                        format: wgpu::TextureFormat::Rgba8Unorm
                    },
                    true
                )
                .is_err()
        );
    }
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    drop(renderer);
    drop(view);
    drop(output);
    drop(queue);
    drop(device);
    let trace = std::fs::read_to_string(directory.join("trace.ron")).unwrap();
    assert_eq!(
        trace.matches("Submit(").count(),
        1,
        "rejections must submit zero; accepted multi-layer nested source submits once"
    );
    for forbidden in ["CopyTextureToBuffer(", "MAP_READ", "MapAsync("] {
        assert!(!trace.contains(forbidden), "live source trace contains {forbidden}");
    }
}
