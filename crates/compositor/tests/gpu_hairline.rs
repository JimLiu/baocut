//! Device-space hairline conformance through the public retained GPU API.
//! Compare every RGBA channel at every canvas pixel against the unchanged CPU
//! DrawOp executor, including AA coverage; the maximum allowed byte error is 2.
#![cfg(feature = "gpu")]

use compositor::{CaptionGpuRenderer, CaptionGpuStats, RenderTarget};
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
        anyhow::bail!("hairline conformance must not request media {id}")
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
            "hairline adapter={} backend={:?} type={:?}",
            info.name, info.backend, info.device_type
        );
        if std::env::var_os("BAOCUT_REQUIRE_GPU").is_some() {
            assert_ne!(info.device_type, wgpu::DeviceType::Cpu, "software adapter is forbidden");
        }
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("baocut.hairline.conformance"),
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
        label: Some("baocut.hairline.test-target"),
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
        label: Some("baocut.hairline.test-only-readback"),
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

const WIDTHS: [f32; 3] = [0., 0.2, 0.8];

fn paints() -> Vec<(&'static str, PaintData)> {
    vec![
        ("solid-opaque", PaintData::Solid([0.87, 0.19, 0.43, 1.])),
        ("solid-alpha", PaintData::Solid([0.13, 0.81, 0.42, 0.37])),
        ("linear-opaque", linear(false)),
        ("linear-alpha", linear(true)),
    ]
}

fn linear(alpha: bool) -> PaintData {
    PaintData::Linear {
        p0: [12.7, 17.3],
        p1: [98.1, 72.9],
        stops: vec![
            GradientStop {
                offset: 0.,
                color: [0.94, 0.08, 0.19, if alpha { 0.13 } else { 1. }],
            },
            GradientStop {
                offset: 0.31,
                color: [0.11, 0.87, 0.36, if alpha { 0.82 } else { 1. }],
            },
            GradientStop {
                offset: 1.,
                color: [0.05, 0.21, 0.91, if alpha { 0.43 } else { 1. }],
            },
        ],
    }
}

fn phases() -> [(&'static str, Mat6); 3] {
    [
        ("identity", ID),
        ("positive-phase", [1., 0., 0., 1., 0.37, 0.29]),
        ("negative-phase", [1., 0., 0., 1., -0.37, -0.29]),
    ]
}

fn transformed() -> [(&'static str, Mat6); 3] {
    [
        ("rotation", [0.9396926, 0.34202015, -0.34202015, 0.9396926, 20.13, -11.27]),
        ("nonuniform-scale", [0.55, 0., 0., 0.65, 18.37, 9.29]),
        ("negative-phase", phases()[2].1),
    ]
}

fn horizontal() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(13.2, 30.8);
    p.line_to(97.6, 30.8);
    path_from_skia(&p.finish().unwrap())
}

fn curve() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(12.4, 53.8);
    p.cubic_to(29.7, 7.2, 76.3, 85.4, 99.1, 34.8);
    p.quad_to(69.3, 83.2, 20.8, 64.6);
    path_from_skia(&p.finish().unwrap())
}

fn sharp() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(17.2, 73.8);
    p.line_to(42.4, 15.2);
    p.line_to(48.1, 72.3);
    p.line_to(92.6, 31.8);
    path_from_skia(&p.finish().unwrap())
}

fn retraced() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(14.2, 41.8);
    p.line_to(95.6, 41.8);
    p.line_to(14.2, 41.8);
    p.line_to(95.6, 41.8);
    // A second contour overlaps the same segment within the same stroke op.
    p.move_to(24.4, 41.8);
    p.line_to(79.3, 41.8);
    path_from_skia(&p.finish().unwrap())
}

fn self_crossing() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(17.2, 19.8);
    p.line_to(94.6, 76.3);
    p.line_to(18.1, 76.3);
    p.line_to(94.6, 19.8);
    p.close();
    p.move_to(16.2, 47.8);
    p.cubic_to(95.7, -9.2, 95.7, 103.4, 16.2, 47.8);
    path_from_skia(&p.finish().unwrap())
}

fn across_canvas() -> PathData {
    let mut p = tiny_skia::PathBuilder::new();
    p.move_to(-19.2, 20.8);
    p.line_to(131.6, 20.8);
    p.line_to(83.1, 116.3);
    p.line_to(-15.2, 74.8);
    p.line_to(42.4, -18.3);
    p.line_to(114.2, 94.7);
    path_from_skia(&p.finish().unwrap())
}

fn painted(path: PathData, paint: PaintData, width: f32, cap: u8, join: u8, tf: Mat6) -> Arc<FrameOps> {
    Arc::new(FrameOps {
        paths: vec![path],
        paints: vec![paint],
        ops: vec![DrawOp::StrokePathPaint {
            path: 0,
            paint: 0,
            width,
            cap,
            join,
            miter: 8.,
            tf,
        }],
        ..Default::default()
    })
}

fn legacy(path: PathData, width: f32, tf: Mat6) -> Arc<FrameOps> {
    Arc::new(FrameOps {
        paths: vec![path],
        ops: vec![DrawOp::StrokePath {
            path: 0,
            color: [0.83, 0.17, 0.46, 0.41],
            width,
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
// criteria: sparse and transparent hairlines must satisfy the same RGBA bound.
fn compare(label: &str, expected: &[u8], actual: &[u8]) -> Option<String> {
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
    let pixels = u64::from(SIZE.width * SIZE.height);
    let mae: [f64; 4] = std::array::from_fn(|c| sums[c] as f64 / pixels as f64);
    eprintln!("hairline {label} rgba_max={maxima:?} rgba_mae={mae:?}");
    let channel = (0..4).max_by_key(|&c| maxima[c]).unwrap();
    let i = worst[channel];
    (maxima[channel] > 2).then(|| {
        format!(
            "{label}: rgba_max={maxima:?}, worst=({},{}) channel={channel} cpu={} gpu={}",
            i / 4 % SIZE.width as usize,
            i / 4 / SIZE.width as usize,
            expected[i],
            actual[i]
        )
    })
}

fn run(cases: Vec<Case>) {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        eprintln!("hairline conformance skipped: no native GPU adapter; BAOCUT_REQUIRE_GPU=1 forbids this skip");
        return;
    };
    let output = target(&device);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let blank = vec![0; (SIZE.width * SIZE.height * 4) as usize];
    let backdrop: Vec<u8> = (0..SIZE.width * SIZE.height).flat_map(|_| [11, 19, 29, 255]).collect();
    let mut failures = Vec::new();
    let count = cases.len();
    for case in cases {
        let frame = material(case.sources);
        let expected = cpu(&frame, if case.backdrop { &backdrop } else { &blank });
        assert!(
            expected.chunks_exact(4).any(|p| p[3] != 0),
            "{}: CPU fixture must paint",
            case.label
        );
        if case.backdrop {
            write(&queue, &output, &backdrop);
        }
        let first = render(&mut renderer, &frame, &output, !case.backdrop);
        assert_eq!(first.submissions, 1, "{}: one submission", case.label);
        assert_eq!(first.material_passes, 0, "{}: no material passes", case.label);
        let actual = read(&device, &queue, &output);
        if let Some(failure) = compare(&case.label, &expected, &actual) {
            failures.push(failure);
        }
        // Replay the same frame against the same backdrop; cache preparation is
        // cumulative, so equality proves that replay did not bake another tile.
        if case.backdrop {
            write(&queue, &output, &backdrop);
        }
        let replay = render(&mut renderer, &frame, &output, !case.backdrop);
        assert_eq!(replay.submissions, 1, "{}: replay submission", case.label);
        assert_eq!(
            replay.prepared_masks, first.prepared_masks,
            "{}: repeated frame must reuse its prepared tile",
            case.label
        );
        assert_eq!(read(&device, &queue, &output), actual, "{}: replay changed RGBA", case.label);
    }
    eprintln!("hairline cases={count} failures={}", failures.len());
    assert!(
        failures.is_empty(),
        "hairline full-RGBA conformance failed:\n{}",
        failures.join("\n")
    );
}

#[test]
fn zero_and_positive_thin_horizontal_curves_all_paints_and_signed_phases_match_cpu_rgba() {
    let mut cases = Vec::new();
    for (path_name, path) in [("horizontal", horizontal()), ("curve", curve())] {
        for width in WIDTHS {
            for (paint_name, paint) in paints() {
                for (tf_name, tf) in phases() {
                    cases.push(case(
                        format!("{path_name}/{paint_name}/{tf_name}/width={width}"),
                        painted(path.clone(), paint.clone(), width, 1, 1, tf),
                    ));
                }
            }
        }
    }
    run(cases);
}

#[test]
fn every_cap_and_join_zero_and_positive_thin_strokes_match_cpu_rgba() {
    let mut cases = Vec::new();
    for cap in 0..3 {
        for join in 0..3 {
            for width in [0., 0.8] {
                for (paint_name, paint) in [("solid-alpha", paints()[1].1.clone()), ("linear-alpha", linear(true))] {
                    cases.push(case(
                        format!("cap={cap}/join={join}/{paint_name}/width={width}"),
                        painted(sharp(), paint, width, cap, join, phases()[1].1),
                    ));
                }
            }
        }
    }
    run(cases);
}

#[test]
fn transparent_retracing_self_intersections_and_canvas_clipping_survive_rotation_and_scale() {
    let mut cases = Vec::new();
    for (path_name, path) in [
        ("retraced", retraced()),
        ("self-crossing", self_crossing()),
        ("across-canvas", across_canvas()),
    ] {
        for width in [0., 0.8] {
            for (paint_name, paint) in paints() {
                for (tf_name, tf) in transformed() {
                    cases.push(case(
                        format!("{path_name}/{paint_name}/{tf_name}/width={width}"),
                        painted(path.clone(), paint.clone(), width, 2, 0, tf),
                    ));
                }
            }
        }
    }
    run(cases);
}

#[test]
fn rank_one_transforms_preserve_cpu_solid_coverage() {
    let mut cases = Vec::new();
    for (tf_name, tf) in [
        ("rank-one-horizontal", [1., 0., 0., 0., 0., 44.3]),
        ("rank-one-diagonal", [0.5, 0.25, 1., 0.5, -5.37, -5.29]),
    ] {
        for width in [0., 0.8] {
            for (paint_name, paint) in paints() {
                if matches!(&paint, PaintData::Linear { .. }) {
                    continue;
                }
                cases.push(case(
                    format!("{tf_name}/{paint_name}/width={width}"),
                    painted(curve(), paint, width, 1, 1, tf),
                ));
            }
        }
    }
    run(cases);
}

#[test]
fn legacy_solid_stroke_path_hairlines_and_transparent_overlaps_match_cpu_rgba() {
    let mut cases = Vec::new();
    for (path_name, path) in [("horizontal", horizontal()), ("curve", curve()), ("retraced", retraced())] {
        for width in WIDTHS {
            for (tf_name, tf) in phases() {
                cases.push(case(
                    format!("legacy/{path_name}/{tf_name}/width={width}"),
                    legacy(path.clone(), width, tf),
                ));
            }
        }
    }
    for width in [0., 0.8] {
        for backdrop in [false, true] {
            for same_source in [false, true] {
                let a = painted(retraced(), PaintData::Solid([0.91, 0.13, 0.21, 0.31]), width, 1, 1, phases()[1].1);
                let b = painted(self_crossing(), linear(true), width, 2, 2, phases()[2].1);
                let sources = if same_source {
                    let mut ops = FrameOps {
                        paths: a.paths.clone(),
                        paints: a.paints.clone(),
                        ops: a.ops.clone(),
                        ..Default::default()
                    };
                    ops.paths.extend(b.paths.iter().cloned());
                    ops.paints.extend(b.paints.iter().cloned());
                    ops.ops.push(DrawOp::StrokePathPaint {
                        path: 1,
                        paint: 1,
                        width,
                        cap: 2,
                        join: 2,
                        miter: 8.,
                        tf: phases()[2].1,
                    });
                    vec![Arc::new(ops)]
                } else {
                    vec![a, b]
                };
                cases.push(Case {
                    label: format!("ordered-overlap/width={width}/backdrop={backdrop}/same-source={same_source}"),
                    sources,
                    backdrop,
                });
            }
        }
    }
    run(cases);
}

#[test]
fn singular_linear_hairlines_fail_explicitly_without_changing_the_backdrop() {
    let Some((device, queue, backend, adapter)) = device(wgpu::Trace::Off) else {
        eprintln!("hairline rejection conformance skipped: no native GPU adapter");
        return;
    };
    let output = target(&device);
    let view = output.create_view(&Default::default());
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let backdrop: Vec<u8> = (0..SIZE.width * SIZE.height).flat_map(|i| [(i % 79) as u8, 31, 47, 255]).collect();
    for (tf_name, tf) in [
        ("rank-one-horizontal", [1., 0., 0., 0., 0., 44.3]),
        ("rank-one-diagonal", [0.5, 0.25, 1., 0.5, -5.37, -5.29]),
    ] {
        for width in [0., 0.8] {
            for alpha in [false, true] {
                let label = format!("singular-linear/{tf_name}/width={width}/alpha={alpha}");
                let frame = material(vec![
                    // Earlier valid content must also remain unsubmitted when
                    // admitting the later gradient requires an inverse matrix.
                    legacy(horizontal(), 0.8, ID),
                    painted(curve(), linear(alpha), width, 1, 1, tf),
                ]);
                write(&queue, &output, &backdrop);
                let error = renderer
                    .render(
                        &frame,
                        RenderTarget {
                            view: &view,
                            width: SIZE.width,
                            height: SIZE.height,
                            format: wgpu::TextureFormat::Rgba8Unorm,
                        },
                        true,
                    )
                    .expect_err("singular linear hairline must preserve its explicit unsupported contract");
                assert!(
                    error.to_string().contains("gpu-draw-gradient-transform-unsupported"),
                    "{label}: {error}"
                );
                assert_eq!(read(&device, &queue, &output), backdrop, "{label}: rejection changed backdrop RGBA");
            }
        }
    }
}

#[test]
fn retained_hairline_cache_separates_device_color_and_local_alpha_keys() {
    fn mask(scene: compositor::SceneFrame) -> Arc<compositor::GlyphMask> {
        let [compositor::SceneNode::Glyphs(run)] = scene.nodes.as_slice() else {
            panic!("single stroke must prepare exactly one glyph run");
        };
        assert_eq!(run.glyphs.len(), 1, "single stroke must prepare one retained mask");
        run.glyphs[0].mask.clone()
    }

    let base = painted(curve(), PaintData::Solid([1.; 4]), 0.8, 1, 1, ID);
    let normal = painted(curve(), PaintData::Solid([1.; 4]), 0.8, 1, 1, [2., 0., 0., 2., 0., 0.]);
    // prepare preserves the generic local 4x policy; prepare_for_canvas uses
    // device coverage. Hairline RGBA, local Alpha and device Alpha must retain
    // independent identities even when they describe the same white stroke.
    // Exercise both initial admission orders so either namespace can be resident.
    for normal_first in [false, true] {
        let mut cache = compositor::RetainedDrawCache::default();
        let first = mask(
            if normal_first {
                cache.prepare(&normal)
            } else {
                cache.prepare_for_canvas(&base, SIZE.width, SIZE.height)
            }
            .unwrap(),
        );
        assert_eq!(cache.prepared_masks(), 1);
        let second = mask(
            if normal_first {
                cache.prepare_for_canvas(&base, SIZE.width, SIZE.height)
            } else {
                cache.prepare(&normal)
            }
            .unwrap(),
        );
        assert_eq!(
            cache.prepared_masks(),
            2,
            "color and alpha preparation must occupy independent cache entries"
        );
        let (color, alpha) = if normal_first { (second, first) } else { (first, second) };
        assert!(
            matches!(&color.pixels, compositor::GlyphPixels::Color(_)),
            "device hairline must retain RGBA"
        );
        assert!(
            matches!(&alpha.pixels, compositor::GlyphPixels::Alpha(_)),
            "normal stroke must retain local coverage"
        );
        assert_ne!(color.key, alpha.key, "device and geometric mask namespaces collided");
        assert!(!Arc::ptr_eq(&color, &alpha), "independent mask kinds cannot share an entry");
        assert!(
            alpha.width > color.width && alpha.height > color.height,
            "normal local mask must remain supersampled"
        );
        let device_alpha = mask(cache.prepare_for_canvas(&normal, SIZE.width, SIZE.height).unwrap());
        assert_eq!(cache.prepared_masks(), 3, "canvas coverage must occupy a third independent entry");
        assert!(
            matches!(&device_alpha.pixels, compositor::GlyphPixels::Alpha(_)),
            "normal canvas coverage must remain Alpha"
        );
        assert!(
            device_alpha.width <= SIZE.width && device_alpha.height <= SIZE.height,
            "device Alpha must stay within its canvas"
        );
        assert!(
            alpha.width > device_alpha.width && alpha.height > device_alpha.height,
            "generic local Alpha must remain 4x sampled"
        );
        for original in [&color, &alpha] {
            assert_ne!(
                device_alpha.key, original.key,
                "device Alpha namespace collided with an earlier mask"
            );
            assert!(!Arc::ptr_eq(&device_alpha, original), "device Alpha cannot share an earlier entry");
        }
        let mut keys = vec![color.key, alpha.key, device_alpha.key];
        for (local, source, original) in [(false, &base, &color), (true, &normal, &alpha), (false, &normal, &device_alpha)] {
            let replay = mask(
                if local {
                    cache.prepare(source)
                } else {
                    cache.prepare_for_canvas(source, SIZE.width, SIZE.height)
                }
                .unwrap(),
            );
            assert_eq!(cache.prepared_masks(), 3, "same frame must not prepare another mask");
            assert_eq!(replay.key, original.key);
            assert!(Arc::ptr_eq(&replay, original), "same frame must return its resident mask");
        }

        let changes = [
            (
                "positive-phase",
                painted(curve(), PaintData::Solid([1.; 4]), 0.8, 1, 1, phases()[1].1),
                SIZE.width,
                SIZE.height,
            ),
            (
                "negative-phase",
                painted(curve(), PaintData::Solid([1.; 4]), 0.8, 1, 1, phases()[2].1),
                SIZE.width,
                SIZE.height,
            ),
            (
                "paint-rgb",
                painted(curve(), PaintData::Solid([0.83, 0.17, 0.46, 1.]), 0.8, 1, 1, ID),
                SIZE.width,
                SIZE.height,
            ),
            (
                "paint-alpha",
                painted(curve(), PaintData::Solid([1., 1., 1., 0.37]), 0.8, 1, 1, ID),
                SIZE.width,
                SIZE.height,
            ),
            (
                "linear-paint",
                painted(curve(), linear(false), 0.8, 1, 1, ID),
                SIZE.width,
                SIZE.height,
            ),
            (
                "linear-alpha",
                painted(curve(), linear(true), 0.8, 1, 1, ID),
                SIZE.width,
                SIZE.height,
            ),
            ("canvas-width", base.clone(), SIZE.width + 7, SIZE.height),
            ("canvas-height", base.clone(), SIZE.width, SIZE.height + 5),
        ];
        for (label, source, width, height) in changes {
            let before = cache.prepared_masks();
            let changed = mask(cache.prepare_for_canvas(&source, width, height).unwrap());
            assert_eq!(
                cache.prepared_masks(),
                before + 1,
                "{label}: changed device coverage inputs must prepare a new entry"
            );
            assert!(
                matches!(&changed.pixels, compositor::GlyphPixels::Color(_)),
                "{label}: device entry must remain RGBA"
            );
            assert!(
                !keys.contains(&changed.key),
                "{label}: distinct device coverage input reused an earlier key"
            );
            keys.push(changed.key);
            let replay = mask(cache.prepare_for_canvas(&source, width, height).unwrap());
            assert_eq!(cache.prepared_masks(), before + 1, "{label}: replay prepared another mask");
            assert_eq!(replay.key, changed.key, "{label}: replay changed key");
            assert!(Arc::ptr_eq(&replay, &changed), "{label}: replay did not reuse resident entry");
        }
        let prepared = cache.prepared_masks();
        let base_replay = mask(cache.prepare_for_canvas(&base, SIZE.width, SIZE.height).unwrap());
        let normal_replay = mask(cache.prepare(&normal).unwrap());
        let device_alpha_replay = mask(cache.prepare_for_canvas(&normal, SIZE.width, SIZE.height).unwrap());
        assert_eq!(
            cache.prepared_masks(),
            prepared,
            "later variants must not evict or replace the original entries"
        );
        assert!(Arc::ptr_eq(&base_replay, &color));
        assert!(Arc::ptr_eq(&normal_replay, &alpha));
        assert!(Arc::ptr_eq(&device_alpha_replay, &device_alpha));
    }
}
