//! Native GPU conformance against the public CPU component-filter reference.
//! Diagnostic readbacks and completed-frame timing are confined to this test.
#![cfg(feature = "gpu")]

use compositor::{CaptionGpuRenderer, CaptionGpuStats, RenderTarget};
use render_raster::{
    drawop::{AssociatedBlend, BitmapData},
    effects::{
        component_filters::{
            Axis, Boundary, ComponentImage, GaussianPass, GaussianSampling, Size,
            affine_samples::{Config, apply},
            gaussian,
        },
        material_plan::{ImageQuad, MaterialCommand, MaterialFrame, MaterialLayer, MaterialSource},
    },
};
use std::{sync::Arc, time::Instant};

const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
const CHANNEL_TOLERANCE: u8 = 2;

fn test_device(trace: wgpu::Trace) -> Option<(wgpu::Device, wgpu::Queue, String, String)> {
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
            "affine native adapter={} backend={:?} device_type={:?}",
            info.name, info.backend, info.device_type
        );
        assert!(
            info.device_type != wgpu::DeviceType::Cpu || std::env::var_os("BAOCUT_REQUIRE_GPU").is_none(),
            "BAOCUT_REQUIRE_GPU forbids a software CPU adapter"
        );
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("baocut.affine.conformance"),
            required_limits: adapter.limits(),
            trace,
            ..Default::default()
        }))
        .ok()?;
        Some((device, queue, format!("{:?}", info.backend).to_lowercase(), info.name))
    })();
    assert!(
        available.is_some() || std::env::var_os("BAOCUT_REQUIRE_GPU").is_none(),
        "BAOCUT_REQUIRE_GPU requires an actual native GPU adapter/device"
    );
    available
}

fn target(device: &wgpu::Device, size: Size) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("baocut.affine.diagnostic-target"),
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

fn write_target(queue: &wgpu::Queue, texture: &wgpu::Texture, size: Size, pixels: &[u8]) {
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        pixels,
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

fn readback(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture, size: Size) -> Vec<u8> {
    let stride = (size.width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("baocut.affine.test-only-readback"),
        size: u64::from(stride) * u64::from(size.height),
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
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
    device.poll(wgpu::PollType::wait_indefinitely()).expect("complete GPU readback");
    receiver.recv().unwrap().expect("readback map");
    let mapped = slice.get_mapped_range().expect("mapped diagnostic pixels");
    mapped
        .chunks_exact(stride as usize)
        .flat_map(|row| row[..(size.width * 4) as usize].iter().copied())
        .collect()
}

fn dense(size: Size, seed: u32) -> Arc<BitmapData> {
    Arc::new(BitmapData {
        width: size.width,
        height: size.height,
        rgba: (0..size.width * size.height)
            .flat_map(|i| {
                let x = i % size.width;
                let y = i / size.width;
                [
                    ((x * 71 + y * 19 + seed * 13) % 251 + 1) as u8,
                    ((x * 23 + y * 83 + seed * 7) % 239 + 1) as u8,
                    ((x * 53 + y * 11 + seed * 31) % 241 + 1) as u8,
                    if (x + 2 * y + seed) % 3 == 0 {
                        0
                    } else {
                        ((i * 11 + seed) % 97) as u8
                    },
                ]
            })
            .collect::<Vec<_>>()
            .into(),
    })
}

fn source(bitmap: Arc<BitmapData>) -> MaterialSource {
    MaterialSource::Image(ImageQuad {
        domain: [0.0, 0.0, f64::from(bitmap.width), f64::from(bitmap.height)],
        bitmap,
        uv_scale: [1.0, 1.0],
        uv_offset: [0.0, 0.0],
    })
}

fn config(size: Size) -> Config {
    Config {
        sampling: GaussianSampling {
            input: [0, 0, size.width, size.height],
            output: [0.0, 0.0, f64::from(size.width), f64::from(size.height)],
        },
        transforms: vec![IDENTITY; 2],
        sample_range: [3, 19],
        distance_range: [0.03, 0.93],
        boundary: Boundary::Replicate,
        output: size,
    }
}

fn frame(bitmap: Arc<BitmapData>, config: Config) -> MaterialFrame {
    MaterialFrame {
        width: config.output.width,
        height: config.output.height,
        layers: vec![MaterialLayer {
            capture: None,
            source: source(bitmap),
            materials: vec![MaterialCommand::AffineSampleBlend(config)],
            blend: AssociatedBlend::SourceOver,
        }],
    }
}

fn cpu_layer(layer: &MaterialLayer, size: Size) -> ComponentImage {
    let MaterialSource::Image(image) = &layer.source else {
        panic!("test source must be an image")
    };
    assert_eq!((image.bitmap.width, image.bitmap.height), (size.width, size.height));
    let mut current = ComponentImage::new(size.width, size.height, image.bitmap.rgba.to_vec()).unwrap();
    for command in &layer.materials {
        current = match command {
            MaterialCommand::AffineSampleBlend(c) => apply(&current, c, |_| Ok(())).unwrap(),
            MaterialCommand::Gaussian(pass) => gaussian(&current, *pass).unwrap(),
            _ => panic!("unexpected material in independent component oracle"),
        };
    }
    current
}

fn cpu_frame(frame: &MaterialFrame, backdrop: &[u8]) -> Vec<u8> {
    let size = Size {
        width: frame.width,
        height: frame.height,
    };
    let mut result = tiny_skia::Pixmap::from_vec(backdrop.to_vec(), tiny_skia::IntSize::from_wh(size.width, size.height).unwrap()).unwrap();
    for layer in &frame.layers {
        let pixels = cpu_layer(layer, size);
        render_raster::emissive::composite_associated_with_blend(
            &mut result,
            tiny_skia::PixmapRef::from_bytes(pixels.data(), size.width, size.height).unwrap(),
            1.0,
            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            None,
            layer.blend,
        )
        .unwrap();
    }
    result.data().to_vec()
}

fn render(renderer: &mut CaptionGpuRenderer, frame: &MaterialFrame, output: &wgpu::Texture, clear: bool) -> CaptionGpuStats {
    let view = output.create_view(&Default::default());
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
        .expect("actual affine GPU frame")
}

fn measure(label: &str, size: Size, expected: &[u8], actual: &[u8]) -> (usize, u8) {
    assert_eq!(expected.len(), actual.len());
    let (offset, error) = expected
        .iter()
        .zip(actual)
        .enumerate()
        .map(|(i, (a, b))| (i, a.abs_diff(*b)))
        .max_by_key(|(_, error)| *error)
        .unwrap();
    eprintln!(
        "affine case={label} max_channel_error={error} position=({},{}) channel={} cpu={} gpu={}",
        offset / 4 % size.width as usize,
        offset / 4 / size.width as usize,
        offset % 4,
        expected[offset],
        actual[offset]
    );
    (offset, error)
}

fn compare(label: &str, size: Size, expected: &[u8], actual: &[u8]) {
    let (offset, error) = measure(label, size, expected, actual);
    assert!(
        error <= CHANNEL_TOLERANCE,
        "{label}: CPU f64 / GPU mismatch {error} exceeds {CHANNEL_TOLERANCE}; pixel=({},{}) channel={} cpu={} gpu={}",
        offset / 4 % size.width as usize,
        offset / 4 / size.width as usize,
        offset % 4,
        expected[offset],
        actual[offset]
    );
}

fn profiles() -> Vec<(&'static str, Vec<[f64; 6]>)> {
    let mut x = IDENTITY;
    x[4] = 0.32;
    let mut y = IDENTITY;
    y[5] = -0.27;
    let mut diagonal = IDENTITY;
    diagonal[4] = -0.23;
    diagonal[5] = 0.31;
    vec![
        ("identity", vec![IDENTITY; 2]),
        ("horizontal", vec![IDENTITY, x]),
        ("vertical", vec![IDENTITY, y]),
        ("diagonal", vec![IDENTITY, diagonal]),
        ("nonuniform-scale", vec![IDENTITY, [1.7, 0.0, 0.0, 0.58, -0.24, 0.13]]),
        (
            "shear",
            vec![[1.0, -0.31, 0.27, 1.0, -0.03, 0.14], [0.8, 0.37, -0.41, 1.1, 0.19, -0.12]],
        ),
        ("rotation", vec![IDENTITY, [0.8660254, 0.5, -0.5, 0.8660254, 0.3169873, -0.1830127]]),
        (
            "middle-loop-equal-endpoints",
            vec![IDENTITY, [1.3, 0.2, -0.1, 0.9, 0.2, -0.3], IDENTITY],
        ),
        (
            "forward-three-controls",
            vec![IDENTITY, [2.0, 0.0, 0.0, 0.5, -0.3, 0.2], [0.5, 0.0, 0.0, 1.5, 0.2, -0.1]],
        ),
        (
            "eleven-controls",
            (0..11)
                .map(|i| {
                    let t = f64::from(i) / 10.0;
                    [1.0 + t * 0.2, t * 0.14, -t * 0.09, 1.0 - t * 0.16, t * t * 0.23, -t * 0.21]
                })
                .collect(),
        ),
        (
            "thirty-two-controls",
            (0..32)
                .map(|i| {
                    let t = f64::from(i) / 31.0;
                    [1.0, t * 0.11, t * 0.17, 1.0, t * 0.22, (t * std::f64::consts::TAU).sin() * 0.13]
                })
                .collect(),
        ),
    ]
}

#[test]
fn affine_profiles_match_cpu_for_independent_rgba_roi_and_fractional_output() {
    let Some((device, queue, backend, adapter)) = test_device(wgpu::Trace::Off) else {
        return;
    };
    let size = Size { width: 31, height: 23 };
    let bitmap = dense(size, 3);
    let output = target(&device, size);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    for (name, transforms) in profiles() {
        for boundary in [Boundary::Normalize, Boundary::Replicate, Boundary::Transparent] {
            for clipped in [false, true] {
                let mut c = config(size);
                c.transforms = transforms.clone();
                c.boundary = boundary;
                if clipped {
                    c.sampling.input = [3, 2, 21, 16];
                    c.sampling.output = [2.25, 3.5, 24.5, 14.75];
                }
                let f = frame(bitmap.clone(), c);
                let cpu = cpu_layer(&f.layers[0], size);
                let stats = render(&mut renderer, &f, &output, true);
                assert_eq!(stats.submissions, 1);
                assert_eq!(stats.material_passes, 1);
                assert_eq!(stats.prepared_masks, 0);
                assert_eq!(stats.noise_field_uploads, 0);
                let gpu = readback(&device, &queue, &output, size);
                compare(&format!("{name}/{boundary:?}/clipped={clipped}"), size, cpu.data(), &gpu);
                assert!(gpu.chunks_exact(4).any(|p| p[0] > p[3]), "associated emission was clamped");
                if name == "identity" && !clipped {
                    assert!(
                        gpu.chunks_exact(4).any(|p| p[3] == 0 && p[0] > 0),
                        "RGB at zero alpha was discarded"
                    );
                }
                if clipped {
                    for y in 0..size.height {
                        for x in 0..size.width {
                            if !(2.25..26.75).contains(&(f64::from(x) + 0.5)) || !(3.5..18.25).contains(&(f64::from(y) + 0.5)) {
                                let i = ((y * size.width + x) * 4) as usize;
                                assert_eq!(&gpu[i..i + 4], &[0; 4], "fractional clip leaked at ({x},{y})");
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn affine_inclusive_endpoints_boundary_weights_and_maximum_count_match_cpu() {
    let Some((device, queue, backend, adapter)) = test_device(wgpu::Trace::Off) else {
        return;
    };
    let size = Size { width: 2, height: 1 };
    let bitmap = Arc::new(BitmapData {
        width: 2,
        height: 1,
        rgba: vec![240, 10, 80, 0, 20, 190, 40, 60].into(),
    });
    let output = target(&device, size);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    for count in [2, 3, 17, 256] {
        for boundary in [Boundary::Normalize, Boundary::Replicate, Boundary::Transparent] {
            let mut c = config(size);
            c.sample_range = [count, count];
            c.boundary = boundary;
            c.transforms = if count == 2 {
                vec![[0.0, 0.0, 0.0, 0.0, 0.0, 0.5], [0.0, 0.0, 0.0, 0.0, 1.0, 0.5]]
            } else {
                vec![
                    [0.0, 0.0, 0.0, 0.0, -0.5, 0.5],
                    [0.0, 0.0, 0.0, 0.0, 0.5, 0.5],
                    [0.0, 0.0, 0.0, 0.0, 1.5, 0.5],
                ]
            };
            let f = frame(bitmap.clone(), c);
            let cpu = cpu_layer(&f.layers[0], size);
            if count == 2 {
                assert_eq!(cpu.data(), &[130, 100, 60, 30, 130, 100, 60, 30]);
            }
            render(&mut renderer, &f, &output, true);
            compare(
                &format!("inclusive/count={count}/{boundary:?}"),
                size,
                cpu.data(),
                &readback(&device, &queue, &output, size),
            );
        }
    }
}

#[test]
fn affine_density_floor_thresholds_do_not_hide_large_precision_errors() {
    let Some((device, queue, backend, adapter)) = test_device(wgpu::Trace::Off) else {
        return;
    };
    let size = Size { width: 17, height: 13 };
    let bitmap = dense(size, 1);
    let backdrop: Vec<u8> = (0..size.width * size.height).flat_map(|_| [9, 19, 31, 255]).collect();
    let output = target(&device, size);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let mut failures = Vec::new();
    for axis in [0, 1] {
        for delta in [-1e-6, -1e-9, 0.0, 1e-9, 1e-6] {
            let mut c = config(size);
            c.sample_range = [2, 10];
            c.distance_range = [0.0, 1.0];
            c.transforms[1][4 + axis] = 0.5 + delta;
            c.boundary = Boundary::Replicate;
            assert_eq!(c.sample_count([0.5, 0.5]), if delta < 0.0 { 5 } else { 6 });
            let f = frame(bitmap.clone(), c);
            let cpu = cpu_layer(&f.layers[0], size);
            if delta == 0.0 {
                // Nonbinary pixel-center UVs let canonical f64 subtraction land
                // on either side of the exact integer threshold. This admitted
                // precision failure must preserve the actual host backdrop.
                write_target(&queue, &output, size, &backdrop);
                let view = output.create_view(&Default::default());
                let error = renderer
                    .render(
                        &f,
                        RenderTarget {
                            view: &view,
                            width: size.width,
                            height: size.height,
                            format: wgpu::TextureFormat::Rgba8Unorm,
                        },
                        true,
                    )
                    .expect_err("exact density threshold must return explicit precision rejection");
                assert!(error.to_string().contains("gpu-affine-density-precision"), "{error}");
                assert_eq!(
                    readback(&device, &queue, &output, size),
                    backdrop,
                    "density precision rejection partially changed the host target"
                );
                continue;
            }
            render(&mut renderer, &f, &output, true);
            let label = format!("density/axis={axis}/delta={delta}");
            let (_, error) = measure(&label, size, cpu.data(), &readback(&device, &queue, &output, size));
            if error > CHANNEL_TOLERANCE {
                failures.push((label, error));
            }
        }
    }
    assert!(failures.is_empty(), "density floor errors exceed {CHANNEL_TOLERANCE}: {failures:?}");
}

#[test]
fn affine_uv_protection_near_edges_keeps_cpu_boundary_decisions() {
    let Some((device, queue, backend, adapter)) = test_device(wgpu::Trace::Off) else {
        return;
    };
    let size = Size { width: 7, height: 5 };
    let bitmap = dense(size, 9);
    let output = target(&device, size);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let mut failures = Vec::new();
    for axis in [0, 1] {
        for edge in [0.0, 1.0] {
            for delta in [-1e-9, 0.0, 1e-9] {
                for boundary in [Boundary::Normalize, Boundary::Replicate, Boundary::Transparent] {
                    let mut c = config(size);
                    let mut matrix = [0.0, 0.0, 0.0, 0.0, 0.5, 0.5];
                    matrix[4 + axis] = edge + delta;
                    c.transforms = vec![matrix; 2];
                    c.sample_range = [2, 2];
                    c.boundary = boundary;
                    let f = frame(bitmap.clone(), c);
                    let cpu = cpu_layer(&f.layers[0], size);
                    render(&mut renderer, &f, &output, true);
                    let label = format!("uv-protection/axis={axis}/edge={edge}/delta={delta}/{boundary:?}");
                    let (_, error) = measure(&label, size, cpu.data(), &readback(&device, &queue, &output, size));
                    if error > CHANNEL_TOLERANCE {
                        failures.push((label, error));
                    }
                }
            }
        }
    }
    assert!(failures.is_empty(), "UV protection errors exceed {CHANNEL_TOLERANCE}: {failures:?}");
}

fn gaussian_pass(size: Size, axis: Axis, count: f64) -> GaussianPass {
    GaussianPass {
        axis,
        sample_count: count,
        step_pixels: 0.7,
        sigma_pixels: 2.1,
        gamma: None,
        boundary: Boundary::Replicate,
        output: size,
        spacing_ramp: None,
        sampling: None,
    }
}

#[test]
fn affine_mixed_layers_distinct_uniform_slots_and_reordered_seeks_match_cpu() {
    let Some((device, queue, backend, adapter)) = test_device(wgpu::Trace::Off) else {
        return;
    };
    let size = Size { width: 35, height: 21 };
    let output = target(&device, size);
    let bitmaps = [dense(size, 2), dense(size, 7)];
    let backdrop: Vec<u8> = (0..size.width * size.height).flat_map(|_| [19, 31, 47, 255]).collect();
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let mut first_pixels = None;
    let mut resident = None;
    for (phase, reverse) in [(0.13, false), (0.71, false), (0.42, true), (0.13, false)] {
        let mut first = config(size);
        first.transforms[1] = [1.0 + phase * 0.2, 0.0, phase * 0.13, 1.0, -phase * 0.21, 0.08];
        first.sampling.output = [1.25, 2.75, 30.5, 15.5];
        first.sample_range = [9, 9];
        let mut second = config(size);
        second.transforms = vec![IDENTITY, [0.8, -0.15, 0.11, 1.2, phase * 0.27, -0.05]];
        second.sample_range = [13, 13];
        second.boundary = Boundary::Normalize;
        let mut layers = vec![
            MaterialLayer {
                capture: None,
                source: source(bitmaps[0].clone()),
                materials: vec![
                    MaterialCommand::Gaussian(gaussian_pass(size, Axis::X, 3.0)),
                    MaterialCommand::AffineSampleBlend(first),
                    MaterialCommand::AffineSampleBlend(second.clone()),
                    MaterialCommand::Gaussian(gaussian_pass(size, Axis::Y, 2.0)),
                ],
                blend: AssociatedBlend::SourceOver,
            },
            MaterialLayer {
                capture: None,
                source: source(bitmaps[1].clone()),
                materials: vec![MaterialCommand::AffineSampleBlend(second)],
                blend: AssociatedBlend::Screen,
            },
        ];
        if reverse {
            layers.reverse();
        }
        let f = MaterialFrame {
            width: size.width,
            height: size.height,
            layers,
        };
        let cpu = cpu_frame(&f, &backdrop);
        write_target(&queue, &output, size, &backdrop);
        let stats = render(&mut renderer, &f, &output, false);
        assert_eq!(stats.submissions, 1);
        assert_eq!(stats.material_passes, 5);
        assert_eq!(stats.prepared_masks, 0);
        assert_eq!(stats.noise_field_uploads, 0);
        if let Some(bytes) = resident {
            assert_eq!(stats.resident_surface_bytes, bytes);
        } else {
            resident = Some(stats.resident_surface_bytes);
        }
        let gpu = readback(&device, &queue, &output, size);
        compare(&format!("mixed/phase={phase}/reverse={reverse}"), size, &cpu, &gpu);
        if phase == 0.13 {
            if let Some(pixels) = &first_pixels {
                assert_eq!(&gpu, pixels, "cached seek replay changed pixels");
            } else {
                first_pixels = Some(gpu);
            }
        }
    }
}

#[test]
fn associated_add_layer_sums_components_on_the_backdrop_like_cpu() {
    let Some((device, queue, backend, adapter)) = test_device(wgpu::Trace::Off) else {
        return;
    };
    let size = Size { width: 35, height: 21 };
    let output = target(&device, size);
    let backdrop: Vec<u8> = (0..size.width * size.height).flat_map(|_| [119, 31, 47, 200]).collect();
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let f = MaterialFrame {
        width: size.width,
        height: size.height,
        layers: vec![
            MaterialLayer {
                source: source(dense(size, 2)),
                materials: vec![MaterialCommand::AffineSampleBlend(config(size))],
                blend: AssociatedBlend::Add,
            },
            MaterialLayer {
                source: source(dense(size, 7)),
                materials: vec![MaterialCommand::Gaussian(gaussian_pass(size, Axis::X, 2.0))],
                blend: AssociatedBlend::Add,
            },
        ],
    };
    let cpu = cpu_frame(&f, &backdrop);
    assert!(cpu.iter().any(|v| *v == 255), "the fixture must exercise RGBA8 clamping");
    write_target(&queue, &output, size, &backdrop);
    render(&mut renderer, &f, &output, false);
    let gpu = readback(&device, &queue, &output, size);
    compare("add", size, &cpu, &gpu);
}

fn invalid_configs(size: Size) -> Vec<Config> {
    let base = config(size);
    let mut cases = Vec::new();
    for count in [1, 33] {
        let mut c = base.clone();
        c.transforms = vec![IDENTITY; count];
        cases.push(c);
    }
    for value in [f64::NAN, f64::INFINITY, 10_000.01] {
        let mut c = base.clone();
        c.transforms[0][2] = value;
        cases.push(c);
    }
    for range in [[1, 3], [10, 9], [2, 257]] {
        let mut c = base.clone();
        c.sample_range = range;
        cases.push(c);
    }
    for range in [[-0.1, 1.0], [1.0, 1.0], [0.0, 16.1], [0.0, f64::NAN], [1.0, 1.0 + 1e-12]] {
        let mut c = base.clone();
        c.distance_range = range;
        cases.push(c);
    }
    for view in [[0, 0, 0, 3], [size.width - 1, 0, 2, 3], [0, u32::MAX, 2, 3]] {
        let mut c = base.clone();
        c.sampling.input = view;
        cases.push(c);
    }
    for rect in [[0.0, 0.0, 0.0, 3.0], [0.0, 0.0, 3.0, f64::INFINITY], [f64::NAN, 0.0, 3.0, 3.0]] {
        let mut c = base.clone();
        c.sampling.output = rect;
        cases.push(c);
    }
    let mut exact_density_threshold = base;
    exact_density_threshold.sample_range = [2, 10];
    exact_density_threshold.distance_range = [0.0, 1.0];
    exact_density_threshold.transforms[1][4] = 0.5;
    cases.push(exact_density_threshold);
    cases
}

#[test]
fn invalid_affine_configs_and_f32_collapsed_distance_range_preserve_backdrop() {
    let Some((device, queue, backend, adapter)) = test_device(wgpu::Trace::Off) else {
        return;
    };
    let size = Size { width: 13, height: 9 };
    let bitmap = dense(size, 5);
    let backdrop: Vec<u8> = (0..size.width * size.height).flat_map(|_| [7, 17, 29, 255]).collect();
    let output = target(&device, size);
    let view = output.create_view(&Default::default());
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    // Warm every resource first; errors must remain transactional on a retained renderer.
    render(&mut renderer, &frame(bitmap.clone(), config(size)), &output, true);
    for c in invalid_configs(size) {
        let description = format!("{c:?}");
        let f = frame(bitmap.clone(), c);
        write_target(&queue, &output, size, &backdrop);
        let error = renderer
            .render(
                &f,
                RenderTarget {
                    view: &view,
                    width: size.width,
                    height: size.height,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
                true,
            )
            .expect_err("invalid affine config was accepted");
        eprintln!("affine rejected config={description} error={error}");
        assert_eq!(
            readback(&device, &queue, &output, size),
            backdrop,
            "invalid affine command partially cleared or rendered target"
        );
    }
}

#[cfg(feature = "gpu-trace")]
#[test]
fn affine_trace_has_one_submission_and_no_live_readbacks_or_density_textures() {
    let Some(directory) = std::env::var_os("BAOCUT_AFFINE_TRACE_DIR").map(std::path::PathBuf::from) else {
        return;
    };
    std::fs::create_dir_all(&directory).unwrap();
    let Some((device, queue, backend, adapter)) = test_device(wgpu::Trace::Directory(directory.clone())) else {
        return;
    };
    let size = Size { width: 35, height: 21 };
    let bitmap = dense(size, 6);
    let output = target(&device, size);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let mut f = frame(bitmap, config(size));
    f.layers[0].materials.push(MaterialCommand::AffineSampleBlend(config(size)));
    let stats = render(&mut renderer, &f, &output, true);
    assert_eq!(stats.submissions, 1);
    assert_eq!(stats.material_passes, 2);
    // Rejected commands cannot append a submission, including clear=true.
    let view = output.create_view(&Default::default());
    for c in invalid_configs(size) {
        f.layers[0].materials[1] = MaterialCommand::AffineSampleBlend(c);
        assert!(
            renderer
                .render(
                    &f,
                    RenderTarget {
                        view: &view,
                        width: size.width,
                        height: size.height,
                        format: wgpu::TextureFormat::Rgba8Unorm,
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
        "affine frame must use one live submit; rejected frames must use zero"
    );
    for forbidden in ["CopyTextureToBuffer(", "MAP_READ", "MapAsync(", "density-field", "density-texture"] {
        assert!(!trace.contains(forbidden), "live affine trace contains {forbidden}");
    }
}

#[test]
#[ignore = "completed-frame native GPU benchmark; run explicitly with --ignored --nocapture"]
fn affine_720p_portrait_gaussian_chain_completed_frame_benchmark() {
    let Some((device, queue, backend, adapter)) = test_device(wgpu::Trace::Off) else {
        return;
    };
    let size = Size { width: 720, height: 1280 };
    let view = [232, 576, 256, 128];
    let mut pixels = vec![0; size.width as usize * size.height as usize * 4];
    for y in view[1]..view[1] + view[3] {
        for x in view[0]..view[0] + view[2] {
            let offset = ((y * size.width + x) * 4) as usize;
            pixels[offset..offset + 4].copy_from_slice(&[210, ((x * 11 + y * 7) % 180) as u8, 95, if (x + y) % 3 == 0 { 0 } else { 70 }]);
        }
    }
    let bitmap = Arc::new(BitmapData {
        width: size.width,
        height: size.height,
        rgba: pixels.into(),
    });
    let mut c = config(size);
    c.sampling.input = view;
    c.sampling.output = view.map(f64::from);
    c.sample_range = [24, 128];
    c.distance_range = [0.0, 0.75];
    c.transforms = vec![IDENTITY, [1.6, 0.13, -0.11, 0.8, -0.2, 0.07]];
    let mut f = frame(bitmap, c);
    f.layers[0]
        .materials
        .insert(0, MaterialCommand::Gaussian(gaussian_pass(size, Axis::Y, 40.0)));
    f.layers[0]
        .materials
        .insert(0, MaterialCommand::Gaussian(gaussian_pass(size, Axis::X, 40.0)));
    let output = target(&device, size);
    let mut renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend.clone(), adapter.clone());
    let iterations = std::env::var("BAOCUT_AFFINE_BENCH_FRAMES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(6)
        .max(1);
    render(&mut renderer, &f, &output, true);
    readback(&device, &queue, &output, size);
    let mut cpu_ms = Vec::new();
    let mut cpu_stage_ms = Vec::new();
    let mut gpu_ms = Vec::new();
    let mut gpu_draw_ms = Vec::new();
    let mut stats = CaptionGpuStats::default();
    for i in 0..iterations {
        let MaterialCommand::AffineSampleBlend(c) = f.layers[0].materials.last_mut().unwrap() else {
            unreachable!()
        };
        c.transforms[1][4] = -0.2 + i as f64 * 0.004;
        c.transforms[1][5] = 0.07 - i as f64 * 0.002;
        let cpu_run = || {
            let start = Instant::now();
            let MaterialSource::Image(source) = &f.layers[0].source else {
                unreachable!()
            };
            let mut image = ComponentImage::new(size.width, size.height, source.bitmap.rgba.to_vec()).unwrap();
            let mut stages = [0.0; 3];
            for (index, command) in f.layers[0].materials.iter().enumerate() {
                let stage_start = Instant::now();
                image = match command {
                    MaterialCommand::Gaussian(pass) => gaussian(&image, *pass).unwrap(),
                    MaterialCommand::AffineSampleBlend(c) => apply(&image, c, |_| Ok(())).unwrap(),
                    _ => unreachable!(),
                };
                stages[index] = stage_start.elapsed().as_secs_f64() * 1000.0;
            }
            (start.elapsed().as_secs_f64() * 1000.0, image, stages)
        };
        let mut gpu_run = || {
            let start = Instant::now();
            let stats = render(&mut renderer, &f, &output, true);
            device.poll(wgpu::PollType::wait_indefinitely()).expect("complete live GPU draw");
            let draw_ms = start.elapsed().as_secs_f64() * 1000.0;
            let image = readback(&device, &queue, &output, size);
            (start.elapsed().as_secs_f64() * 1000.0, draw_ms, image, stats)
        };
        let ((cpu_time, cpu, stages), (gpu_time, draw_time, gpu, completed_stats)) = if i % 2 == 0 {
            let cpu = cpu_run();
            (cpu, gpu_run())
        } else {
            let gpu = gpu_run();
            (cpu_run(), gpu)
        };
        compare(&format!("portrait-bench/frame={i}"), size, cpu.data(), &gpu);
        assert_eq!(completed_stats.submissions, 1);
        assert_eq!(completed_stats.material_passes, 3);
        cpu_ms.push(cpu_time);
        cpu_stage_ms.push(stages);
        gpu_ms.push(gpu_time);
        gpu_draw_ms.push(draw_time);
        stats = completed_stats;
    }
    let median = |values: &mut Vec<f64>| {
        values.sort_by(f64::total_cmp);
        let middle = values.len() / 2;
        if values.len() % 2 == 0 {
            (values[middle - 1] + values[middle]) * 0.5
        } else {
            values[middle]
        }
    };
    let cpu_median = median(&mut cpu_ms);
    let gpu_median = median(&mut gpu_ms);
    let gpu_draw_median = median(&mut gpu_draw_ms);
    let cpu_stage_median_ms: [f64; 3] = std::array::from_fn(|index| median(&mut cpu_stage_ms.iter().map(|stages| stages[index]).collect()));
    let load = std::process::Command::new("uptime")
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned());
    let report = serde_json::json!({
        "backend": backend, "adapter": adapter, "width": size.width, "height": size.height,
        "source_region": view, "gaussian_counts": [40, 40], "affine_sample_range": [24, 128],
        "frames": iterations, "cpu_ms": cpu_ms, "gpu_completed_readback_ms": gpu_ms,
        "gpu_completed_draw_ms": gpu_draw_ms, "gpu_draw_median_ms": gpu_draw_median,
        "cpu_stage_order": ["gaussian_x", "gaussian_y", "affine_apply"],
        "cpu_stage_ms": cpu_stage_ms, "cpu_stage_median_ms": cpu_stage_median_ms,
        "cpu_median_ms": cpu_median, "gpu_median_ms": gpu_median,
        "cpu_fps": 1000.0 / cpu_median, "gpu_completed_readback_fps": 1000.0 / gpu_median,
        "gpu_completed_draw_fps": 1000.0 / gpu_draw_median,
        "ratio_cpu_over_gpu": cpu_median / gpu_median, "load": load,
        "live_submissions_per_frame": stats.submissions, "material_passes": stats.material_passes,
        "resident_surface_bytes": stats.resident_surface_bytes,
    });
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(directory) = std::env::var_os("BAOCUT_AFFINE_BENCH_DIR") {
        let directory = std::path::PathBuf::from(directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join("native-affine-benchmark.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
    }
}
