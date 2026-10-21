//! R1 的第一条实时路径门禁：合成器写调用方 TextureView；回读只住在本测试里。
#![cfg(feature = "gpu")]

use compositor::{
    Compositor, ExternalTextureDescriptor, ExternalTextureImporter, GlyphCompositeMode, GlyphInstance, GlyphKey, GlyphMask, GlyphPaint,
    GlyphPixels, GlyphRun, GlyphRunUniform, ImportedExternalTexture, RenderTarget, RenderTextureTarget, SceneFrame, SceneNode, ScenePose,
};
use motion::preset_registry::timeline_progress;
use render_raster::ShaderQuad;
use render_raster::drawop::{DrawOp, FrameBuilder, FrameOps, PathData, PathSeg};
use render_raster::imgcmp;
use render_raster::raster::{FrameMedia, rasterize_with_media};
use render_raster::source::kernel::DrawBox;
use render_raster::source::progress::ProgressParams;
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use subtitle_render::{OverlayIncludes, OverlayRenderPlan};
use timeline::schema::{ElementKind, Place, ProgressProps};
use timeline_render::{ElementDraw, Stage, evaluate_scene_element};
use timeline_render::{TextureBackground, TextureEffect, TextureFit, TextureMaskShape, TextureNode};

const WIDTH: u32 = 64;
const HEIGHT: u32 = 48;
const ROW_BYTES: u32 = 256;

struct TestTextureImporter {
    texture: Option<wgpu::Texture>,
    saw_queue: bool,
    lease_dropped: Arc<AtomicBool>,
}

struct TestTextureLease(Arc<AtomicBool>);

impl Drop for TestTextureLease {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

impl ExternalTextureImporter for TestTextureImporter {
    type Handle = ();
    type Lease = TestTextureLease;

    fn import(
        &mut self,
        _device: &wgpu::Device,
        _queue: &wgpu::Queue,
        _handle: &Self::Handle,
        _descriptor: ExternalTextureDescriptor,
    ) -> anyhow::Result<ImportedExternalTexture<Self::Lease>> {
        self.saw_queue = true;
        self.texture
            .take()
            .map(|texture| ImportedExternalTexture {
                texture,
                lease: TestTextureLease(Arc::clone(&self.lease_dropped)),
            })
            .ok_or_else(|| anyhow::anyhow!("test texture already imported"))
    }
}

#[test]
fn compositor_writes_a_placed_quad_into_the_callers_texture_view() {
    let trace_directory = compositor_trace_directory();
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor target test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | trace_directory
                .is_none()
                .then_some(wgpu::TextureUsages::COPY_SRC)
                .unwrap_or_else(wgpu::TextureUsages::empty),
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let recipe = timeline_progress("normal").expect("built-in progress recipe");
    let quad = ShaderQuad::progress(
        recipe,
        &ProgressParams {
            main_color: [1.0, 0.0, 0.0, 1.0],
            secondary_color: [0.0, 0.0, 1.0, 1.0],
            pixel_scale: 1.0,
        },
        0.5,
        0.5,
        DrawBox {
            x: 16.0,
            y: 12.0,
            w: 32.0,
            h: 8.0,
        },
        (f64::from(WIDTH), f64::from(HEIGHT)),
    )
    .expect("progress quad");
    let scene = SceneFrame {
        nodes: vec![SceneNode::shader_quad(quad, (f64::from(WIDTH), f64::from(HEIGHT)))],
        next_change: Some(1.0),
        active_until: None,
        fingerprint: 7,
    };
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let stats = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("direct target render");
    assert_eq!(stats.nodes, 1);
    assert_eq!(stats.submissions, 1);
    assert_eq!(stats.binding_rebuilds, 1);
    let steady = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("stable direct target render");
    assert_eq!(steady.submissions, 1);
    assert_eq!(steady.binding_rebuilds, 0);

    if let Some(trace_directory) = trace_directory {
        // Trace 模式故意不给 target COPY_SRC，也不调用下面的诊断回读。释放全部
        // wgpu handle 后再审计实际 API 命令流，避免把源码扫描当运行证据。
        drop(compositor);
        drop(view);
        drop(texture);
        drop(queue);
        drop(device);
        let trace =
            std::fs::read_to_string(trace_directory.join("trace.ron")).expect("wgpu trace must be flushed after the device is dropped");
        assert_eq!(trace.matches("Submit(").count(), 2, "两帧实时直写必须各自只提交一次");
        assert_eq!(
            trace.matches("RunRenderPass(").count(),
            2,
            "两次 submit 都必须只包含直接 render pass"
        );
        for forbidden in ["CopyTextureToBuffer(", "MAP_READ", "MapAsync("] {
            assert!(!trace.contains(forbidden), "实时直写 trace 禁止出现 {forbidden}");
        }
        return;
    }

    let bytes = diagnostic_readback(&device, &queue, &texture);
    let alpha = |x: u32, y: u32| bytes[(y * ROW_BYTES + x * 4 + 3) as usize];
    assert_eq!(alpha(2, 2), 0, "quad 外必须保持透明");
    assert!(alpha(20, 15) > 0, "quad 的已播放半段必须落在指定位置");
    assert!(alpha(43, 15) > 0, "progress 背景也应覆盖元素盒");
    assert_eq!(alpha(50, 30), 0, "quad 外另一侧同样透明");
}

#[test]
fn compositor_presents_a_sampleable_scene_target_in_the_same_submission() {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor present-target test");
        return;
    };
    let scene_target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.sampleable-scene-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let scene_view = scene_target.create_view(&wgpu::TextureViewDescriptor::default());
    let present_target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.present-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let present_view = present_target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut builder = FrameBuilder::default();
    builder.push(DrawOp::FillRect {
        x: 12.0,
        y: 10.0,
        w: 40.0,
        h: 20.0,
        radius: 0.0,
        color: [0.0, 0.5, 1.0, 1.0],
        tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    });
    let scene = SceneFrame {
        nodes: vec![SceneNode::Vectors(Arc::new(builder.finish()))],
        next_change: None,
        active_until: None,
        fingerprint: 13,
    };
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let render = |compositor: &mut Compositor| {
        compositor.render_texture_to_view_at(
            &scene,
            RenderTextureTarget {
                texture: &scene_target,
                view: &scene_view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            RenderTarget {
                view: &present_view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            0.0,
            1,
        )
    };
    let first = render(&mut compositor).expect("scene target and present pass");
    assert_eq!(first.nodes, 1);
    assert_eq!(first.submissions, 1);
    assert!(first.binding_rebuilds >= 1);
    let steady = render(&mut compositor).expect("stable scene target and present pass");
    assert_eq!(steady.submissions, 1);
    assert_eq!(steady.binding_rebuilds, 0);

    let bytes = diagnostic_readback(&device, &queue, &present_target);
    let pixel = |x: u32, y: u32| {
        let offset = (y * ROW_BYTES + x * 4) as usize;
        &bytes[offset..offset + 4]
    };
    assert_eq!(pixel(2, 2), &[0, 0, 0, 0]);
    assert!(pixel(32, 20)[2] >= 253, "present pass must sample scene target");
    assert_eq!(pixel(60, 40), &[0, 0, 0, 0]);

    let empty = SceneFrame {
        nodes: Vec::new(),
        next_change: None,
        active_until: None,
        fingerprint: 0,
    };
    let cleared = compositor
        .render_texture_to_view_at(
            &empty,
            RenderTextureTarget {
                texture: &scene_target,
                view: &scene_view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            RenderTarget {
                view: &present_view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            0.0,
            1,
        )
        .expect("empty scene still clears and presents the sampleable target");
    assert_eq!(cleared.submissions, 1);
    let bytes = diagnostic_readback(&device, &queue, &present_target);
    assert!(
        bytes.chunks_exact(4).all(|pixel| pixel == [0, 0, 0, 0]),
        "empty scene must not preserve pixels from the previous present"
    );
}

#[test]
fn compositor_rasterizes_shape_drawops_on_the_gpu() {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor vector test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.vector-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut builder = FrameBuilder::default();
    builder.push(DrawOp::FillRect {
        x: 16.0,
        y: 12.0,
        w: 32.0,
        h: 8.0,
        radius: 0.0,
        color: [0.0, 1.0, 0.0, 0.5],
        tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    });
    let frame = Arc::new(builder.finish());
    let scene = SceneFrame {
        nodes: vec![SceneNode::Vectors(frame.clone())],
        next_change: None,
        active_until: None,
        fingerprint: 11,
    };
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU DrawOp render");
    let bytes = diagnostic_readback(&device, &queue, &texture);
    let pixel = |x: u32, y: u32| {
        let offset = (y * ROW_BYTES + x * 4) as usize;
        &bytes[offset..offset + 4]
    };
    assert_eq!(pixel(2, 2), &[0, 0, 0, 0]);
    let center = pixel(32, 16);
    assert_eq!(center[0], 0);
    assert!(center[1] >= 126 && center[1] <= 129);
    assert!(center[3] >= 126 && center[3] <= 129);
    assert_eq!(pixel(50, 30), &[0, 0, 0, 0]);

    let reference = rasterize_with_media(&frame, WIDTH, HEIGHT, &mut NoMedia).expect("CPU strict shape reference");
    let gpu =
        tiny_skia::Pixmap::from_vec(bytes, tiny_skia::IntSize::from_wh(WIDTH, HEIGHT).unwrap()).expect("GPU premultiplied texture bytes");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized shape frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_samples_external_textures_in_global_scene_order() {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor texture test");
        return;
    };
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.texture-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let source = compositor.external_texture_target("poster", 2, 2).expect("external texture target");
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: source,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &[255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255],
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(8),
            rows_per_image: Some(2),
        },
        wgpu::Extent3d {
            width: 2,
            height: 2,
            depth_or_array_layers: 1,
        },
    );

    let vector = |y: f32, height: f32, color| {
        let mut builder = FrameBuilder::default();
        builder.push(DrawOp::FillRect {
            x: 0.0,
            y,
            w: WIDTH as f32,
            h: height,
            radius: 0.0,
            color,
            tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        });
        SceneNode::Vectors(Arc::new(builder.finish()))
    };
    let scene = SceneFrame {
        nodes: vec![
            vector(0.0, HEIGHT as f32, [0.0, 0.0, 1.0, 1.0]),
            SceneNode::Texture(Arc::new(TextureNode {
                texture: "poster".to_owned(),
                media_ms: -1,
                source_width: 2,
                source_height: 2,
                rect: [8.0, 8.0, 24.0, 16.0],
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                opacity: 0.5,
                radius: 0.0,
                mask_shape: timeline_render::TextureMaskShape::RoundedRect,
                mask_feather: 0.0,
                source_effects: Arc::from([]),
                reveal: 1.0,
                iris: 1.0,
                fit: TextureFit::Cover,
                background: TextureBackground::Transparent,
            })),
            vector(18.0, 6.0, [0.0, 1.0, 0.0, 1.0]),
        ],
        fingerprint: 77,
        ..SceneFrame::default()
    };
    let stats = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("texture scene render");
    assert_eq!(stats.submissions, 1);
    let bytes = diagnostic_readback(&device, &queue, &target);
    let pixel = |x: u32, y: u32| {
        let offset = (y * ROW_BYTES + x * 4) as usize;
        &bytes[offset..offset + 4]
    };
    assert_eq!(pixel(2, 2), &[0, 0, 255, 255], "纹理盒外保留底层");
    let mixed = pixel(16, 12);
    assert!((126..=129).contains(&mixed[0]), "{mixed:?}");
    assert_eq!(mixed[1], 0);
    assert!((126..=129).contains(&mixed[2]), "{mixed:?}");
    assert_eq!(mixed[3], 255);
    assert_eq!(pixel(16, 20), &[0, 255, 0, 255], "后续节点必须压在纹理上");
}

#[test]
fn compositor_registers_a_host_imported_sampled_texture() {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor imported texture test");
        return;
    };
    let descriptor = ExternalTextureDescriptor {
        width: 2,
        height: 2,
        format: wgpu::TextureFormat::Bgra8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.host-import"),
        size: wgpu::Extent3d {
            width: descriptor.width,
            height: descriptor.height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: descriptor.format,
        usage: descriptor.usage,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &[0, 0, 255, 255].repeat(4),
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(8),
            rows_per_image: Some(2),
        },
        wgpu::Extent3d {
            width: 2,
            height: 2,
            depth_or_array_layers: 1,
        },
    );
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.host-import-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let lease_dropped = Arc::new(AtomicBool::new(false));
    let mut importer = TestTextureImporter {
        texture: Some(texture),
        saw_queue: false,
        lease_dropped: Arc::clone(&lease_dropped),
    };
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .import_external_texture("decoded", &mut importer, &(), descriptor)
        .expect("host imported texture registration");
    assert!(importer.saw_queue, "importer must receive the submission queue");
    assert!(
        !lease_dropped.load(Ordering::Acquire),
        "platform lease must stay alive before submit"
    );

    let scene = SceneFrame {
        nodes: vec![SceneNode::Texture(Arc::new(TextureNode {
            texture: "decoded".to_owned(),
            media_ms: 0,
            source_width: 2,
            source_height: 2,
            rect: [0.0, 0.0, WIDTH as f32, HEIGHT as f32],
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            opacity: 1.0,
            radius: 0.0,
            mask_shape: TextureMaskShape::RoundedRect,
            mask_feather: 0.0,
            source_effects: Arc::from([]),
            reveal: 1.0,
            iris: 1.0,
            fit: TextureFit::Cover,
            background: TextureBackground::Transparent,
        }))],
        ..SceneFrame::default()
    };
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("render host imported texture");
    let bytes = diagnostic_readback(&device, &queue, &target);
    assert!(
        lease_dropped.load(Ordering::Acquire),
        "platform lease must retire after submitted GPU work completes"
    );
    assert_eq!(&bytes[..4], &[255, 0, 0, 255], "BGRA resource samples as red");
}

#[test]
fn compositor_texture_color_adjust_mask_and_reveal_match_cpu_local_effects() {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor texture mask test");
        return;
    };
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.texture-mask-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let source = compositor
        .external_texture_target("masked-poster", 2, 2)
        .expect("external texture target");
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: source,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &[255, 0, 0, 255].repeat(4),
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(8),
            rows_per_image: Some(2),
        },
        wgpu::Extent3d {
            width: 2,
            height: 2,
            depth_or_array_layers: 1,
        },
    );
    for iris in [1.0_f32, 0.45] {
        let scene = SceneFrame {
            nodes: vec![SceneNode::Texture(Arc::new(TextureNode {
                texture: "masked-poster".to_owned(),
                media_ms: -1,
                source_width: 2,
                source_height: 2,
                rect: [8.0, 8.0, 48.0, 32.0],
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                opacity: 1.0,
                radius: 0.0,
                mask_shape: TextureMaskShape::Ellipse,
                mask_feather: 3.0,
                source_effects: Arc::from([
                    TextureEffect::ColorAdjust {
                        grayscale: 0.6,
                        brightness: -0.2,
                    },
                    TextureEffect::Brightness(0.12),
                    TextureEffect::Contrast(0.2),
                    TextureEffect::Saturation(1.3),
                    TextureEffect::HueRotate(36.0),
                ]),
                reveal: 0.55,
                iris,
                fit: TextureFit::Cover,
                background: TextureBackground::Transparent,
            }))],
            ..SceneFrame::default()
        };
        compositor
            .render(
                &scene,
                RenderTarget {
                    view: &view,
                    width: WIDTH,
                    height: HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .expect("masked texture render");
        let gpu = tiny_skia::Pixmap::from_vec(
            diagnostic_readback(&device, &queue, &target),
            tiny_skia::IntSize::from_wh(WIDTH, HEIGHT).unwrap(),
        )
        .expect("GPU texture mask bytes");

        let mut local = tiny_skia::Pixmap::new(48, 32).unwrap();
        local.fill(tiny_skia::Color::from_rgba8(255, 0, 0, 255));
        render_raster::effects::filters::color_adjust::color_adjust(local.data_mut(), 0.6, -0.2);
        render_raster::effects::filters::color_adjust::brightness_only(local.data_mut(), 0.12);
        render_raster::effects::filters::color_adjust::contrast(local.data_mut(), 0.2);
        render_raster::effects::filters::color_adjust::saturation(local.data_mut(), 1.3);
        render_raster::effects::filters::color_adjust::hue_rotate(local.data_mut(), 36.0);
        render_raster::effects::filters::mask_shape::mask_shape(local.data_mut(), 48, 32, 0.0, true, 3.0);
        render_raster::effects::filters::reveal::horizontal_reveal(local.data_mut(), 48, 32, 0.55);
        if iris < 1.0 {
            let radius = 24.0_f32.hypot(16.0) * iris;
            for (i, pixel) in local.data_mut().chunks_exact_mut(4).enumerate() {
                let distance = ((i % 48) as f32 + 0.5 - 24.0).hypot((i / 48) as f32 + 0.5 - 16.0);
                let coverage = (radius - distance + 0.5).clamp(0.0, 1.0);
                for channel in pixel {
                    *channel = (f32::from(*channel) * coverage).round() as u8;
                }
            }
        }
        let mut reference = tiny_skia::Pixmap::new(WIDTH, HEIGHT).unwrap();
        reference.draw_pixmap(
            8,
            8,
            local.as_ref(),
            &tiny_skia::PixmapPaint::default(),
            tiny_skia::Transform::identity(),
            None,
        );
        let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized texture mask frames");
        assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
        assert!(comparison.edge_share <= 0.02, "{comparison:?}");
        assert!(comparison.ssim_downsampled >= 0.999, "{comparison:?}");
    }
}

#[test]
fn compositor_source_blur_matches_cpu_and_is_prepared_once_for_tiles() {
    const SOURCE_W: u32 = 12;
    const SOURCE_H: u32 = 8;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor source blur test");
        return;
    };
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.source-blur-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut source = Vec::with_capacity((SOURCE_W * SOURCE_H * 4) as usize);
    for y in 0..SOURCE_H {
        for x in 0..SOURCE_W {
            source.extend_from_slice(&[
                ((x * 37 + y * 11) % 256) as u8,
                ((x * 7 + y * 43) % 256) as u8,
                ((x * 19 + y * 23) % 256) as u8,
                255,
            ]);
        }
    }
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .upload_external_rgba("blurred-tile", SOURCE_W, SOURCE_H, &source)
        .unwrap();
    let node_at = |x: f32| {
        SceneNode::Texture(Arc::new(TextureNode {
            texture: "blurred-tile".to_owned(),
            media_ms: -1,
            source_width: SOURCE_W,
            source_height: SOURCE_H,
            rect: [x, 6.0, SOURCE_W as f32, SOURCE_H as f32],
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            opacity: 1.0,
            radius: 0.0,
            mask_shape: TextureMaskShape::RoundedRect,
            mask_feather: 0.0,
            source_effects: Arc::from([
                TextureEffect::ColorAdjust {
                    grayscale: 0.6,
                    brightness: -0.2,
                },
                TextureEffect::Brightness(0.1),
                TextureEffect::Contrast(-0.15),
                TextureEffect::Saturation(0.8),
                TextureEffect::HueRotate(-25.0),
                TextureEffect::Blur(2),
            ]),
            reveal: 0.625,
            iris: 1.0,
            fit: TextureFit::Cover,
            background: TextureBackground::Transparent,
        }))
    };
    let scene = SceneFrame {
        nodes: vec![node_at(4.0), node_at(28.0)],
        ..SceneFrame::default()
    };
    let first = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("source blur render");
    assert_eq!(first.submissions, 1);
    assert_eq!(
        first.binding_rebuilds, 5,
        "首帧只准备 source effect、external blur source 与两个 tile/final texture binding"
    );
    let steady = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("stable source blur render");
    assert_eq!(steady.submissions, 1);
    assert_eq!(steady.binding_rebuilds, 0);

    let gpu = tiny_skia::Pixmap::from_vec(
        diagnostic_readback(&device, &queue, &target),
        tiny_skia::IntSize::from_wh(WIDTH, HEIGHT).unwrap(),
    )
    .unwrap();
    let mut filtered = tiny_skia::Pixmap::from_vec(source, tiny_skia::IntSize::from_wh(SOURCE_W, SOURCE_H).unwrap()).unwrap();
    render_raster::effects::filters::color_adjust::color_adjust(filtered.data_mut(), 0.6, -0.2);
    render_raster::effects::filters::color_adjust::brightness_only(filtered.data_mut(), 0.1);
    render_raster::effects::filters::color_adjust::contrast(filtered.data_mut(), -0.15);
    render_raster::effects::filters::color_adjust::saturation(filtered.data_mut(), 0.8);
    render_raster::effects::filters::color_adjust::hue_rotate(filtered.data_mut(), -25.0);
    render_raster::effects::filters::blur::box_blur_premul_u8(filtered.data_mut(), SOURCE_W, SOURCE_H, 2);
    render_raster::effects::filters::reveal::horizontal_reveal(filtered.data_mut(), SOURCE_W, SOURCE_H, 0.625);
    let mut reference = tiny_skia::Pixmap::new(WIDTH, HEIGHT).unwrap();
    for x in [4, 28] {
        reference.draw_pixmap(
            x,
            6,
            filtered.as_ref(),
            &tiny_skia::PixmapPaint::default(),
            tiny_skia::Transform::identity(),
            None,
        );
    }
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized source blur frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.02, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.999, "{comparison:?}");
}

#[test]
fn compositor_ordered_source_effect_chain_matches_every_cpu_media_filter() {
    const SOURCE_W: u32 = 17;
    const SOURCE_H: u32 = 13;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping ordered source effect test");
        return;
    };
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.ordered-source-effects-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut source = Vec::with_capacity((SOURCE_W * SOURCE_H * 4) as usize);
    for y in 0..SOURCE_H {
        for x in 0..SOURCE_W {
            let alpha = (80 + (x * 13 + y * 17) % 176) as u8;
            let premultiply = |value: u32| ((value % 256) as f64 * f64::from(alpha) / 255.0).round() as u8;
            source.extend_from_slice(&[
                premultiply(x * 31 + y * 7),
                premultiply(x * 11 + y * 29),
                premultiply(x * 23 + y * 19),
                alpha,
            ]);
        }
    }
    let effects: Arc<[TextureEffect]> = Arc::from([
        TextureEffect::ColorAdjust {
            grayscale: 0.25,
            brightness: -0.08,
        },
        TextureEffect::Sepia(0.34),
        TextureEffect::Invert(0.2),
        TextureEffect::Brightness(0.06),
        TextureEffect::Contrast(-0.12),
        TextureEffect::Saturation(1.45),
        TextureEffect::HueRotate(27.0),
        TextureEffect::Blur(1),
        TextureEffect::Sharpen(0.65),
        TextureEffect::Noise(0.7),
        TextureEffect::Vignette(0.8),
    ]);
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .upload_external_rgba("effect-chain", SOURCE_W, SOURCE_H, &source)
        .unwrap();
    let scene = SceneFrame {
        nodes: vec![SceneNode::Texture(Arc::new(TextureNode {
            texture: "effect-chain".to_owned(),
            media_ms: -1,
            source_width: SOURCE_W,
            source_height: SOURCE_H,
            rect: [5.0, 4.0, SOURCE_W as f32, SOURCE_H as f32],
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            opacity: 1.0,
            radius: 0.0,
            mask_shape: TextureMaskShape::RoundedRect,
            mask_feather: 0.0,
            source_effects: Arc::clone(&effects),
            reveal: 1.0,
            iris: 1.0,
            fit: TextureFit::Cover,
            background: TextureBackground::Transparent,
        }))],
        ..SceneFrame::default()
    };
    let first = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("ordered source effect render");
    assert_eq!(first.submissions, 1);
    let steady = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("stable ordered source effect render");
    assert_eq!(steady.submissions, 1);
    assert_eq!(steady.binding_rebuilds, 0);

    let gpu = tiny_skia::Pixmap::from_vec(
        diagnostic_readback(&device, &queue, &target),
        tiny_skia::IntSize::from_wh(WIDTH, HEIGHT).unwrap(),
    )
    .unwrap();
    let mut filtered = tiny_skia::Pixmap::from_vec(source, tiny_skia::IntSize::from_wh(SOURCE_W, SOURCE_H).unwrap()).unwrap();
    let pixels = filtered.data_mut();
    render_raster::effects::filters::color_adjust::color_adjust(pixels, 0.25, -0.08);
    render_raster::effects::filters::color_adjust::sepia(pixels, 0.34);
    render_raster::effects::filters::color_adjust::invert(pixels, 0.2);
    render_raster::effects::filters::color_adjust::brightness_only(pixels, 0.06);
    render_raster::effects::filters::color_adjust::contrast(pixels, -0.12);
    render_raster::effects::filters::color_adjust::saturation(pixels, 1.45);
    render_raster::effects::filters::color_adjust::hue_rotate(pixels, 27.0);
    render_raster::effects::filters::blur::box_blur_premul_u8(pixels, SOURCE_W, SOURCE_H, 1);
    render_raster::effects::filters::stylize::sharpen(pixels, SOURCE_W, SOURCE_H, 0.65);
    render_raster::effects::filters::stylize::noise(pixels, SOURCE_W, SOURCE_H, 0.7);
    render_raster::effects::filters::stylize::vignette(pixels, SOURCE_W, SOURCE_H, 0.8);
    let mut reference = tiny_skia::Pixmap::new(WIDTH, HEIGHT).unwrap();
    reference.draw_pixmap(
        5,
        4,
        filtered.as_ref(),
        &tiny_skia::PixmapPaint::default(),
        tiny_skia::Transform::identity(),
        None,
    );
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized effect-chain frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.02, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.999, "{comparison:?}");
}

#[test]
fn compositor_contain_blur_background_matches_the_cpu_local_stack() {
    const SOURCE_W: u32 = 16;
    const SOURCE_H: u32 = 8;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping contain blur background test");
        return;
    };
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.contain-blur-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut source = Vec::with_capacity((SOURCE_W * SOURCE_H * 4) as usize);
    for y in 0..SOURCE_H {
        for x in 0..SOURCE_W {
            source.extend_from_slice(&[
                ((x * 29 + y * 17) % 256) as u8,
                ((x * 11 + y * 47) % 256) as u8,
                ((x * 41 + y * 5) % 256) as u8,
                255,
            ]);
        }
    }
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .upload_external_rgba("contain-poster", SOURCE_W, SOURCE_H, &source)
        .unwrap();
    let scene = SceneFrame {
        nodes: vec![SceneNode::Texture(Arc::new(TextureNode {
            texture: "contain-poster".to_owned(),
            media_ms: -1,
            source_width: SOURCE_W,
            source_height: SOURCE_H,
            rect: [0.0, 0.0, WIDTH as f32, HEIGHT as f32],
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            opacity: 0.6,
            radius: 0.0,
            mask_shape: TextureMaskShape::RoundedRect,
            mask_feather: 0.0,
            source_effects: Arc::from([
                TextureEffect::ColorAdjust {
                    grayscale: 0.4,
                    brightness: 0.1,
                },
                TextureEffect::Blur(1),
            ]),
            reveal: 1.0,
            iris: 1.0,
            fit: TextureFit::Contain,
            background: TextureBackground::Blur,
        }))],
        ..SceneFrame::default()
    };
    let first = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("contain blur render");
    assert_eq!(first.submissions, 1);
    assert_eq!(
        first.binding_rebuilds, 9,
        "首帧计入 source effect/external blur，background/composite 与四个 texture pass 各只准备一次"
    );
    let steady = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("stable contain blur render");
    assert_eq!(steady.binding_rebuilds, 0);

    let gpu = tiny_skia::Pixmap::from_vec(
        diagnostic_readback(&device, &queue, &target),
        tiny_skia::IntSize::from_wh(WIDTH, HEIGHT).unwrap(),
    )
    .unwrap();
    let mut filtered = tiny_skia::Pixmap::from_vec(source, tiny_skia::IntSize::from_wh(SOURCE_W, SOURCE_H).unwrap()).unwrap();
    render_raster::effects::filters::color_adjust::color_adjust(filtered.data_mut(), 0.4, 0.1);
    render_raster::effects::filters::blur::box_blur_premul_u8(filtered.data_mut(), SOURCE_W, SOURCE_H, 1);
    let mut reference = tiny_skia::Pixmap::new(WIDTH, HEIGHT).unwrap();
    subtitle_render::draw_fit_pixmap(&mut reference, &filtered, timeline::schema::Fit::Cover, 1.0);
    subtitle_render::box_blur_rgba(
        reference.data_mut(),
        WIDTH,
        HEIGHT,
        ((WIDTH.min(HEIGHT) as f64) * 0.04).round().max(1.0) as usize,
    );
    subtitle_render::adjust_brightness(reference.data_mut(), -0.15);
    subtitle_render::draw_fit_pixmap(&mut reference, &filtered, timeline::schema::Fit::Contain, 1.0);
    subtitle_render::multiply_premultiplied_alpha(reference.data_mut(), 0.6);
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized contain blur frames");
    assert!(comparison.max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.02, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.999, "{comparison:?}");
}

#[test]
fn compositor_reuses_glyph_masks_in_its_bounded_atlas() {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor glyph test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.glyph-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mask = Arc::new(
        GlyphMask::new(
            GlyphKey([41, 9]),
            4,
            4,
            0,
            0,
            vec![0, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 0],
        )
        .expect("valid tightly-packed alpha mask"),
    );
    let geometry: Arc<[GlyphInstance]> = vec![GlyphInstance {
        mask,
        transform: [4.0, 0.0, 0.0, 4.0, 16.0, 12.0],
        uniform_index: 0,
    }]
    .into();
    let scene = SceneFrame {
        nodes: vec![SceneNode::Glyphs(Arc::new(GlyphRun {
            glyphs: Arc::clone(&geometry),
            uniforms: vec![GlyphRunUniform {
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                color: [1.0, 0.0, 0.0, 0.5],
                color_opacity: 1.0,
                clip: None,
                paint: GlyphPaint::Solid,
            }],
            texture: None,
            composite: GlyphCompositeMode::Normal,
            pose: ScenePose::IDENTITY,
            motion: None,
        }))],
        next_change: None,
        active_until: None,
        fingerprint: 13,
    };
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let first = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("first glyph render");
    assert_eq!(first.submissions, 1);
    assert_eq!(compositor.glyph_atlas_stats().resident, 1);
    let first_stats = compositor.glyph_renderer_stats();
    assert_eq!(first_stats.geometry_writes, 1);
    assert_eq!(first_stats.uniform_writes, 1);
    let updated_scene = SceneFrame {
        nodes: vec![SceneNode::Glyphs(Arc::new(GlyphRun {
            glyphs: geometry,
            uniforms: vec![GlyphRunUniform {
                transform: [1.0, 0.0, 0.0, 1.0, 8.0, 0.0],
                color: [0.0, 1.0, 0.0, 0.5],
                color_opacity: 1.0,
                clip: None,
                paint: GlyphPaint::Solid,
            }],
            texture: None,
            composite: GlyphCompositeMode::Normal,
            pose: ScenePose::IDENTITY,
            motion: None,
        }))],
        next_change: None,
        active_until: None,
        fingerprint: 14,
    };
    let steady = compositor
        .render(
            &updated_scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("steady glyph render");
    assert_eq!(steady.binding_rebuilds, 0);
    assert_eq!(compositor.glyph_atlas_stats().rebuilds, 0);
    let steady_stats = compositor.glyph_renderer_stats();
    assert_eq!(steady_stats.geometry_writes, 1, "同一 Arc geometry 只应更新 run uniform");
    assert_eq!(steady_stats.uniform_writes, 2);

    let bytes = diagnostic_readback(&device, &queue, &texture);
    assert_eq!(pixel_at(&bytes, 2, 2, ROW_BYTES), &[0, 0, 0, 0]);
    assert_eq!(pixel_at(&bytes, 20, 20, ROW_BYTES), &[0, 0, 0, 0]);
    let center = pixel_at(&bytes, 32, 20, ROW_BYTES);
    assert_eq!(center[0], 0);
    assert!((124..=130).contains(&center[1]), "{center:?}");
    assert_eq!(center[2], 0);
    assert!((124..=130).contains(&center[3]), "{center:?}");
}

#[test]
fn compositor_real_font_and_plate_frame_matches_the_cpu_reference_structurally() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor real-font test");
        return;
    };
    let document = json!({
        "meta": {"duration": 2.0},
        "style": {
            "mode": "orig",
            "fontFamily": "montserrat",
            "fontSize": 72,
            "fontColor": "#FFFFFF",
            "bold": false,
            "outline": true,
            "underline": true,
            "background": true,
            "backgroundColor": "#202020E6",
            "backgroundPadding": 12,
            "lineHeight": 1.2,
            "x": 50,
            "y": 58,
            "width": 92,
            "scale": 1,
            "rotation": 0,
            "wordAnimation": {"animationName": "None"},
            "transition": {"transitionId": "magic-pop", "transitionSpeed": 50},
            "displayTiming": {"leadIn": 0, "tail": 0}
        },
        "cues": [{
            "id": "font-1",
            "start": 0.0,
            "end": 2.0,
            "text": "BaoCut",
            "words": [{"text": "BaoCut", "t0": 0.0, "t1": 2.0}]
        }],
        "sentences": [],
        "transCues": []
    });
    let mut plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let frame_time = 1.0 / 30.0;
    let reference = plan.render_rgba(frame_time).expect("CPU subtitle reference");
    let scene = plan
        .subtitle_scene_frame(0.01)
        .expect("subtitle glyph motion scene with vector plate")
        .scene;
    assert!((scene.active_until.unwrap() - 0.1).abs() < 1e-9);
    assert!(matches!(scene.nodes[0], SceneNode::AnimatedVectors { .. }));
    assert!(matches!(scene.nodes[1], SceneNode::Glyphs(_)));
    assert!(matches!(scene.nodes[2], SceneNode::Glyphs(_)));
    assert!(matches!(scene.nodes[3], SceneNode::AnimatedVectors { .. }));

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.real-font-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .render_at(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            0.0,
        )
        .expect("GPU real-font motion start");
    let first_stats = compositor.glyph_renderer_stats();
    assert_eq!(first_stats.geometry_writes, 2);
    assert_eq!(first_stats.uniform_writes, 2);
    let first_vector_stats = compositor.vector_renderer_stats();
    assert_eq!(first_vector_stats.geometry_writes, 2);
    assert_eq!(first_vector_stats.uniform_writes, 2);
    compositor
        .render_at(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            frame_time,
        )
        .expect("GPU real-font render");
    let second_stats = compositor.glyph_renderer_stats();
    assert_eq!(second_stats.geometry_writes, 2, "render_at 不得重写 retained glyph geometry");
    assert_eq!(second_stats.uniform_writes, 4);
    let second_vector_stats = compositor.vector_renderer_stats();
    assert_eq!(
        second_vector_stats.geometry_writes, 2,
        "render_at 不得重 tessellate retained subtitle plate / underline"
    );
    assert_eq!(second_vector_stats.uniform_writes, 4);
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU reference pixmap");
    let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU glyph pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized subtitle frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_classic_word_decorations_match_cpu_chunk_order() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor word-decoration test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.word-decoration-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);

    for (animation, time) in [("Highlight", 1.5), ("Paint", 0.75)] {
        let document = json!({
            "meta": {"duration": 2.0},
            "style": {
                "mode": "orig",
                "fontFamily": "montserrat",
                "fontSize": 72,
                "fontColor": "#FFFFFF",
                "bold": false,
                "outline": false,
                "underline": false,
                "background": false,
                "lineHeight": 1.2,
                "x": 50,
                "y": 58,
                "width": 92,
                "scale": 1,
                "rotation": 0,
                "wordAnimation": {"animationName": animation},
                "transition": {"transitionId": "none", "transitionSpeed": 50},
                "displayTiming": {"leadIn": 0, "tail": 0}
            },
            "cues": [{
                "id": "font-word-decoration",
                "start": 0.0,
                "end": 2.0,
                "text": "Bao Cut",
                "words": [
                    {"text": "Bao", "t0": 0.0, "t1": 1.0},
                    {"text": "Cut", "t0": 1.0, "t1": 2.0}
                ]
            }],
            "sentences": [],
            "transCues": []
        });
        let mut plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let reference = plan.render_rgba(time).expect("CPU word-decoration reference");
        let scene = plan
            .subtitle_scene_frame(time)
            .expect("classic word decoration retained scene")
            .scene;
        assert!(matches!(scene.nodes[0], SceneNode::Glyphs(_)), "{animation}");
        assert!(matches!(scene.nodes[1], SceneNode::AnimatedVectors { .. }));
        assert!(matches!(scene.nodes[2], SceneNode::Glyphs(_)), "{animation}");

        let stats = compositor
            .render(
                &scene,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .expect("GPU word-decoration render");
        assert_eq!(stats.submissions, 1, "{animation}");
        let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
        let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
            .expect("CPU word-decoration pixmap");
        let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
            .expect("GPU word-decoration pixmap");
        let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized classic word-decoration frames");
        assert!(comparison.flat_max_deviation <= 2, "{animation}: {comparison:?}");
        assert!(comparison.edge_share <= 0.20, "{animation}: {comparison:?}");
        assert!(comparison.ssim_downsampled >= 0.98, "{animation}: {comparison:?}");
    }
}

#[test]
fn every_classic_word_motion_matches_the_cpu_reference_on_gpu() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping classic word-motion catalogue test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.classic-word-motion-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);

    for animation in subtitle_render::word_motion::WORD_ANIM_TRACKS
        .iter()
        .filter(|animation| animation.catalog_id != "none")
    {
        let id = animation.catalog_id;
        let animation_name = if id == "boxHighlight" { "Highlight" } else { id };
        let document = json!({
            "meta": {"duration": 2.0},
            "style": {
                "mode": "orig",
                "fontFamily": "montserrat",
                "fontSize": 72,
                "fontColor": "#FFFFFF",
                "bold": false,
                "outline": false,
                "underline": false,
                "background": true,
                "backgroundColor": "#202020E6",
                "backgroundPadding": 12,
                "lineHeight": 1.2,
                "x": 50,
                "y": 58,
                "width": 92,
                "scale": 1,
                "rotation": 0,
                "wordAnimation": {
                    "animationName": animation_name,
                    "catalogId": id,
                    "active": {
                        "color": "#FFFFFF",
                        "backgroundColor": "#6147FF"
                    }
                },
                "transition": {"transitionId": "none", "transitionSpeed": 50},
                "displayTiming": {"leadIn": 0, "tail": 0}
            },
            "cues": [{
                "id": "classic-motion",
                "start": 0.0,
                "end": 2.0,
                "text": "Bao Cut",
                "words": [
                    {"text": "Bao", "t0": 0.0, "t1": 1.0},
                    {"text": "Cut", "t0": 1.0, "t1": 2.0}
                ]
            }],
            "sentences": [],
            "transCues": []
        });
        let time = 0.54;
        let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let reference = cpu_plan
            .render_rgba(time)
            .unwrap_or_else(|error| panic!("{id} CPU reference: {error}"));
        let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let scene = gpu_plan
            .subtitle_scene_frame(time)
            .unwrap_or_else(|fallback| panic!("{id} GPU scene: {fallback}"))
            .scene;
        compositor
            .render(
                &scene,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap_or_else(|error| panic!("{id} GPU render: {error}"));
        let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
        let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).unwrap();
        let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).unwrap();
        let comparison = imgcmp::compare(&reference, &gpu).unwrap_or_else(|error| panic!("{id} comparison: {error}"));
        assert!(comparison.flat_max_deviation <= 2, "{id}: {comparison:?}");
        assert!(comparison.edge_share <= 0.20, "{id}: {comparison:?}");
        assert!(comparison.ssim_downsampled >= 0.98, "{id}: {comparison:?}");
    }
}

#[test]
fn compositor_whiteboard_keeps_reveal_at_source_size_and_matches_cpu_geometry() {
    const BOARD_WIDTH: u32 = 320;
    const BOARD_HEIGHT: u32 = 180;
    const BOARD_ROW_BYTES: u32 = BOARD_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping whiteboard source-texture test");
        return;
    };
    let project = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(project.path().join("media")).unwrap();
    let mut board = tiny_skia::Pixmap::new(240, 120).unwrap();
    board.fill(tiny_skia::Color::WHITE);
    let mut ink = tiny_skia::Paint::default();
    ink.set_color_rgba8(24, 24, 24, 255);
    let mut red = tiny_skia::Paint::default();
    red.set_color_rgba8(230, 40, 40, 255);
    board.fill_rect(
        tiny_skia::Rect::from_xywh(16.0, 16.0, 90.0, 8.0).unwrap(),
        &ink,
        tiny_skia::Transform::identity(),
        None,
    );
    board.fill_rect(
        tiny_skia::Rect::from_xywh(145.0, 30.0, 70.0, 65.0).unwrap(),
        &red,
        tiny_skia::Transform::identity(),
        None,
    );
    std::fs::write(project.path().join("media/board.png"), board.encode_png().unwrap()).unwrap();
    let document = json!({
        "meta": {"duration": 4.0},
        "style": {
            "mode": "orig", "fontFamily": "montserrat", "fontSize": 30,
            "fontColor": "#FFFFFF", "outline": false, "background": false,
            "x": 50, "y": 86, "width": 80, "scale": 1, "rotation": 0,
            "wordAnimation": {"animationName": "None"},
            "transition": {"transitionId": "none", "transitionSpeed": 50},
            "displayTiming": {"leadIn": 0, "tail": 0}
        },
        "cues": [], "sentences": [], "transCues": [],
        "timeline": {
            "bcutTimeline": "0.8",
            "sources": {"board": {"path": "media/board.png", "kind": "image"}},
            "tracks": [{"id": "overlay", "kind": "overlay", "elements": [{
                "id": "wb", "kind": "whiteboard", "srcId": "board",
                "start": 0.0, "end": 4.0,
                "place": {"x": 55, "y": 48, "w": 78, "rot": 7, "opacity": 0.8},
                "mask": {"shape": "ellipse", "feather": 2},
                "fx": {"brightness": 0.1, "contrast": 0.2},
                "whiteboard": {"draw": 2.0, "hand": "none"}
            }]}]
        }
    });
    std::fs::write(
        project.path().join("timeline.json"),
        serde_json::to_vec(&document["timeline"]).unwrap(),
    )
    .unwrap();
    let time = 1.6;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, BOARD_WIDTH, BOARD_HEIGHT, 4.0, 30.0, None).unwrap();
    cpu_plan.load_timeline_elements(project.path(), &document).unwrap();
    let reference = cpu_plan.render_rgba(time).unwrap();

    let mut gpu_plan = OverlayRenderPlan::compile(&document, BOARD_WIDTH, BOARD_HEIGHT, 4.0, 30.0, None).unwrap();
    gpu_plan.load_timeline_elements(project.path(), &document).unwrap();
    let scene = gpu_plan.compositor_scene_frame(time).unwrap();
    let [SceneNode::Texture(node)] = scene.nodes.as_slice() else {
        panic!("whiteboard should be one source-sized texture node")
    };
    assert_eq!((node.source_width, node.source_height), (240, 120));
    let pixels = gpu_plan.compositor_texture_frame(&node.texture, node.media_ms).unwrap();
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.whiteboard-target"),
        size: wgpu::Extent3d {
            width: BOARD_WIDTH,
            height: BOARD_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .upload_external_rgba(&node.texture, pixels.width(), pixels.height(), pixels.data())
        .unwrap();
    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: BOARD_WIDTH,
                height: BOARD_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .unwrap();
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, BOARD_WIDTH, BOARD_HEIGHT, BOARD_ROW_BYTES);
    let size = tiny_skia::IntSize::from_wh(BOARD_WIDTH, BOARD_HEIGHT).unwrap();
    let reference = tiny_skia::Pixmap::from_vec(reference, size).unwrap();
    let gpu = tiny_skia::Pixmap::from_vec(gpu, size).unwrap();
    let comparison = imgcmp::compare(&reference, &gpu).unwrap();
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

/// 分层文字动画（`textMotion`）不再把整片 GPU 场景判死：动效 cue 活动的帧，
/// 字幕层是一张按非零 alpha 包围盒裁出的 1:1 CPU 光栅纹理，离屏合成结果必须与
/// CPU 参考 `render_rgba` 逐字节相同；用逐条覆盖撤掉动效的另一条 cue 照常走
/// glyph scene（场景里没有纹理节点）。
#[test]
fn compositor_text_motion_subtitle_texture_matches_cpu_and_plain_cues_stay_glyphs() {
    const MOTION_WIDTH: u32 = 320;
    const MOTION_HEIGHT: u32 = 180;
    const MOTION_ROW_BYTES: u32 = MOTION_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping text-motion subtitle texture test");
        return;
    };
    let design = subtitle_render::text_design::designs()
        .iter()
        .find(|design| design["id"] == "kinetic-wave")
        .expect("kinetic-wave design has an entrance and a loop");
    let mut document = subtitle_render::text_design::demo_document(&design["style"], "Make every word");
    document["cues"] = json!([
        {"id": "moving", "start": 0.0, "end": 2.0, "text": "Make every word",
         "words": [
            {"id": "m0", "text": "Make", "t0": 0.0, "t1": 0.5},
            {"id": "m1", "text": "every", "t0": 0.6, "t1": 1.1},
            {"id": "m2", "text": "word", "t0": 1.2, "t1": 1.8}]},
        {"id": "plain", "start": 2.0, "end": 4.0, "text": "Plain line",
         "words": [
            {"id": "p0", "text": "Plain", "t0": 2.0, "t1": 2.8},
            {"id": "p1", "text": "line", "t0": 2.9, "t1": 3.8}]}
    ]);
    document["style"]["cueStyles"] = json!({
        "plain": {"source": {"textMotion": null, "wordBackground": null}}
    });
    let compile = || {
        OverlayRenderPlan::compile_with_injected_fonts(
            &document,
            MOTION_WIDTH,
            MOTION_HEIGHT,
            4.0,
            30.0,
            None,
            OverlayIncludes::ALL,
            vec![
                include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec(),
                include_bytes!("../../render-raster/assets/fonts/Inter-Medium.ttf").to_vec(),
            ],
        )
        .unwrap()
    };
    let mut cpu_plan = compile();
    let mut gpu_plan = compile();
    gpu_plan
        .compositor_scene_support()
        .expect("text motion must not reject the whole GPU scene");

    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.text-motion-target"),
        size: wgpu::Extent3d {
            width: MOTION_WIDTH,
            height: MOTION_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let size = tiny_skia::IntSize::from_wh(MOTION_WIDTH, MOTION_HEIGHT).unwrap();
    // 入场中、循环中各取一帧：两帧用同一个纹理槽。
    let mut slots = Vec::new();
    for time in [0.1, 1.3] {
        let scene = gpu_plan
            .compositor_scene_frame_with(time, subtitle_render::SceneIdentity::Structural)
            .expect("text-motion frame must build a compositor scene");
        let [SceneNode::Texture(node)] = scene.nodes.as_slice() else {
            panic!("text-motion subtitle layer should be one texture node at t={time}")
        };
        assert!(node.texture.starts_with("subtitle-motion:"));
        slots.push(node.texture.clone());
        let pixels = gpu_plan.compositor_texture_frame(&node.texture, node.media_ms).unwrap();
        compositor
            .upload_external_rgba(&node.texture, pixels.width(), pixels.height(), pixels.data())
            .unwrap();
        compositor
            .render(
                &scene,
                RenderTarget {
                    view: &view,
                    width: MOTION_WIDTH,
                    height: MOTION_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap();
        let gpu = diagnostic_readback_sized(&device, &queue, &target, MOTION_WIDTH, MOTION_HEIGHT, MOTION_ROW_BYTES);
        let reference = cpu_plan.render_rgba(time).unwrap();
        assert!(
            reference.chunks_exact(4).any(|pixel| pixel[3] > 0),
            "CPU reference must draw the caption at t={time}"
        );
        let reference = tiny_skia::Pixmap::from_vec(reference, size).unwrap();
        let gpu = tiny_skia::Pixmap::from_vec(gpu, size).unwrap();
        let comparison = imgcmp::compare(&reference, &gpu).unwrap();
        assert_eq!(
            comparison.max_deviation, 0,
            "1:1 texture must reproduce the CPU layer byte for byte at t={time}: {comparison:?}"
        );
    }
    assert_eq!(slots[0], slots[1], "the subtitle-motion texture slot is stable");

    let plain = gpu_plan
        .compositor_scene_frame_with(3.0, subtitle_render::SceneIdentity::Structural)
        .expect("a cue without motion keeps the glyph scene");
    assert!(!plain.nodes.is_empty());
    assert!(
        plain.nodes.iter().all(|node| !matches!(node, SceneNode::Texture(_))),
        "no texture node when no motion cue is active"
    );
}

fn designed_caption_gpu_document(style_id: &str) -> serde_json::Value {
    json!({
        "meta": {"duration": 2.0},
        "style": {
            "mode": "orig",
            "fontFamily": "montserrat",
            "fontSize": 52,
            "fontColor": "#FFFFFF",
            "bold": true,
            "outline": false,
            "underline": false,
            "background": false,
            "lineHeight": 1.2,
            "x": 50,
            "y": 50,
            "width": 90,
            "scale": 1,
            "rotation": 0,
            "wordAnimation": {
                "animationName": "None",
                "caption": {
                    "schema": 1,
                    "style": {"id": style_id, "version": 1},
                    "content": "orig",
                    "palette": {"primary": "#FFFFFF", "accent": "#FFD43B"},
                    "intensity": 60,
                    "speed": 1
                }
            },
            "transition": {"transitionId": "none", "transitionSpeed": 50},
            "displayTiming": {"leadIn": 0, "tail": 0}
        },
        "cues": [{
            "id": "designed-1",
            "start": 0.5,
            "end": 2.0,
            "text": "Bao Cut",
            "words": [
                {"id": "designed-w1", "text": "Bao", "t0": 0.5, "t1": 1.2},
                {"id": "designed-w2", "text": "Cut", "t0": 1.3, "t1": 2.0}
            ]
        }],
        "sentences": [],
        "transCues": []
    })
}

#[test]
fn compositor_screen_caption_matches_cpu_on_a_real_backdrop_with_retained_geometry() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    const BACKDROP: u8 = 64;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor screen-caption test");
        return;
    };
    let mut document = designed_caption_gpu_document("caption-blend-difference");
    document["style"]["outline"] = json!(true);
    document["style"]["wordAnimation"]["caption"]["options"] = json!([{"kind": "text", "key": "composite", "text": "screen"}]);
    let time = 0.58;

    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let mut reference = vec![BACKDROP, BACKDROP, BACKDROP, 255].repeat(usize::try_from(FONT_WIDTH * FONT_HEIGHT).unwrap());
    cpu_plan
        .composite_bgra(&mut reference, FONT_ROW_BYTES as usize, time)
        .expect("CPU screen composite");
    for pixel in reference.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let mut scene = gpu_plan.subtitle_scene_frame(time).expect("screen caption retained scene").scene;
    let [SceneNode::BlurredGroup(screen_group)] = scene.nodes.as_slice() else {
        panic!("screen caption must use one group-level composite")
    };
    assert_eq!(screen_group.composite, GlyphCompositeMode::Screen);
    let first_glyphs = screen_group
        .nodes
        .iter()
        .filter_map(|node| match node {
            SceneNode::Glyphs(run) => {
                assert_eq!(run.composite, GlyphCompositeMode::Normal);
                Some(Arc::clone(&run.glyphs))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(first_glyphs.len(), 2, "outline 与 fill 应各自保留一条 Screen run");
    let glyph_node_count = first_glyphs.len() as u64;
    let mut background = FrameBuilder::default();
    background.push(DrawOp::FillRect {
        x: 0.0,
        y: 0.0,
        w: FONT_WIDTH as f32,
        h: FONT_HEIGHT as f32,
        radius: 0.0,
        color: [
            f32::from(BACKDROP) / 255.0,
            f32::from(BACKDROP) / 255.0,
            f32::from(BACKDROP) / 255.0,
            1.0,
        ],
        tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    });
    let background = Arc::new(background.finish());
    scene.nodes.insert(0, SceneNode::Vectors(Arc::clone(&background)));

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.screen-caption-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU screen composite");
    assert_eq!(compositor.glyph_renderer_stats().geometry_writes, glyph_node_count);

    let mut later = gpu_plan
        .subtitle_scene_frame(0.62)
        .expect("later screen caption retained scene")
        .scene;
    let [SceneNode::BlurredGroup(later_group)] = later.nodes.as_slice() else {
        panic!("later screen caption must keep one group-level composite")
    };
    assert_eq!(later_group.composite, GlyphCompositeMode::Screen);
    let later_glyphs = later_group
        .nodes
        .iter()
        .filter_map(|node| match node {
            SceneNode::Glyphs(run) => {
                assert_eq!(run.composite, GlyphCompositeMode::Normal);
                Some(Arc::clone(&run.glyphs))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(first_glyphs.len(), later_glyphs.len());
    for (first, later) in first_glyphs.iter().zip(&later_glyphs) {
        assert!(Arc::ptr_eq(first, later));
    }
    later.nodes.insert(0, SceneNode::Vectors(Arc::clone(&background)));
    compositor
        .render(
            &later,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("later GPU screen composite");
    assert_eq!(
        compositor.glyph_renderer_stats().geometry_writes,
        glyph_node_count,
        "screen blend state must not invalidate retained glyph geometry"
    );

    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("restore screen conformance sample");
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference =
        tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("CPU screen pixmap");
    let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU screen pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized screen frames");
    assert!(comparison.flat_max_deviation <= 3, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_target_sampling_captions_match_cpu_without_readback_in_the_scene_submit() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    const BACKDROP_BGRA: [u8; 4] = [31, 97, 173, 255];
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping target-sampling caption test");
        return;
    };

    for (option, expected_mode) in [
        ("difference", GlyphCompositeMode::Difference),
        ("exclusion", GlyphCompositeMode::Exclusion),
    ] {
        let mut document = designed_caption_gpu_document("caption-blend-difference");
        document["style"]["wordAnimation"]["caption"]["options"] = json!([{"kind": "text", "key": "composite", "text": option}]);
        let time = 0.58;

        let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let mut reference = BACKDROP_BGRA.repeat(usize::try_from(FONT_WIDTH * FONT_HEIGHT).unwrap());
        cpu_plan
            .composite_bgra(&mut reference, FONT_ROW_BYTES as usize, time)
            .expect("CPU target-sampling composite");

        let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let scene = gpu_plan
            .compositor_scene_frame(time)
            .expect("offline scene admits target-sampling caption");
        let [SceneNode::BlurredGroup(group)] = scene.nodes.as_slice() else {
            panic!("target-sampling caption must use one top-level group")
        };
        assert_eq!(group.composite, expected_mode);
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("bcut.compositor.test.target-sampling-caption"),
            size: wgpu::Extent3d {
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let backdrop_bgra = BACKDROP_BGRA.repeat(usize::try_from(FONT_WIDTH * FONT_HEIGHT).unwrap());
        let upload_backdrop = || {
            queue.write_texture(
                texture.as_image_copy(),
                &backdrop_bgra,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(FONT_ROW_BYTES),
                    rows_per_image: Some(FONT_HEIGHT),
                },
                wgpu::Extent3d {
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    depth_or_array_layers: 1,
                },
            );
        };
        upload_backdrop();
        let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend.clone(), adapter_name.clone());
        let error = compositor
            .render_over_at(
                &scene,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Bgra8Unorm,
                },
                time,
            )
            .unwrap_err()
            .to_string();
        assert!(error.contains("target-sampling-unavailable"), "{error}");
        let first = compositor
            .render_over_texture_at(
                &scene,
                RenderTextureTarget {
                    texture: &texture,
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Bgra8Unorm,
                },
                time,
            )
            .expect("GPU target-sampling composite");
        assert_eq!(first.submissions, 1);
        upload_backdrop();
        let steady = compositor
            .render_over_texture_at(
                &scene,
                RenderTextureTarget {
                    texture: &texture,
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Bgra8Unorm,
                },
                time,
            )
            .expect("stable GPU target-sampling composite");
        assert_eq!(steady.submissions, 1);
        assert_eq!(steady.binding_rebuilds, 0);

        let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
        let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
            .expect("CPU target-sampling pixmap");
        let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
            .expect("GPU target-sampling pixmap");
        let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized composite frames");
        assert!(comparison.flat_max_deviation <= 3, "{option}: {comparison:?}");
        assert!(comparison.edge_share <= 0.20, "{option}: {comparison:?}");
        assert!(comparison.ssim_downsampled >= 0.98, "{option}: {comparison:?}");

        if option == "difference" {
            let mut blurred_scene = scene.clone();
            let SceneNode::BlurredGroup(group) = &mut blurred_scene.nodes[0] else {
                unreachable!("target caption topology checked above")
            };
            Arc::make_mut(group).radius = 2.0;
            upload_backdrop();
            let switched = compositor
                .render_over_texture_at(
                    &blurred_scene,
                    RenderTextureTarget {
                        texture: &texture,
                        view: &view,
                        width: FONT_WIDTH,
                        height: FONT_HEIGHT,
                        format: wgpu::TextureFormat::Bgra8Unorm,
                    },
                    time,
                )
                .expect("target composite switches to blurred group source");
            assert_eq!(switched.submissions, 1);
            assert_eq!(switched.binding_rebuilds, 1, "source/result view 切换必须重建一次 bind group");
            upload_backdrop();
            let blurred_steady = compositor
                .render_over_texture_at(
                    &blurred_scene,
                    RenderTextureTarget {
                        texture: &texture,
                        view: &view,
                        width: FONT_WIDTH,
                        height: FONT_HEIGHT,
                        format: wgpu::TextureFormat::Bgra8Unorm,
                    },
                    time,
                )
                .expect("stable blurred target composite");
            assert_eq!(blurred_steady.binding_rebuilds, 0);
        }
    }
}

#[test]
fn compositor_procedural_screen_captions_match_cpu_as_one_group_on_a_real_backdrop() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    const BACKDROP: u8 = 53;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping procedural screen-caption test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.procedural-screen-caption-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let mut background = FrameBuilder::default();
    background.push(DrawOp::FillRect {
        x: 0.0,
        y: 0.0,
        w: FONT_WIDTH as f32,
        h: FONT_HEIGHT as f32,
        radius: 0.0,
        color: [
            f32::from(BACKDROP) / 255.0,
            f32::from(BACKDROP) / 255.0,
            f32::from(BACKDROP) / 255.0,
            1.0,
        ],
        tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    });
    let background = Arc::new(background.finish());

    for (style_id, expected_rects, time, later_time) in [
        ("caption-glitch-rgb", None, 0.80, 0.84),
        ("caption-particle-burst", Some(12), 0.70, 0.76),
    ] {
        let mut document = designed_caption_gpu_document(style_id);
        if style_id == "caption-particle-burst" {
            document["style"]["captionEmphasis"] = json!({
                "designed-w1": {"anchorText": "Bao", "role": "hero"}
            });
            document["style"]["wordAnimation"]["caption"]["options"] = json!([{"kind": "number", "key": "particleCount", "number": 12}]);
        }
        let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let mut reference = vec![BACKDROP, BACKDROP, BACKDROP, 255].repeat(usize::try_from(FONT_WIDTH * FONT_HEIGHT).unwrap());
        cpu_plan
            .composite_bgra(&mut reference, FONT_ROW_BYTES as usize, time)
            .unwrap_or_else(|error| panic!("CPU {style_id} screen composite: {error}"));
        for pixel in reference.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let mut scene = gpu_plan
            .subtitle_scene_frame(time)
            .unwrap_or_else(|error| panic!("{style_id} retained scene: {error:?}"))
            .scene;
        let [SceneNode::BlurredGroup(group)] = scene.nodes.as_slice() else {
            panic!("{style_id} must use one composite group")
        };
        assert_eq!(group.composite, GlyphCompositeMode::Screen, "{style_id}");
        assert_eq!(group.radius, 0.0, "{style_id}");
        let first_rect_count = group.nodes.iter().filter(|node| matches!(node, SceneNode::RoundedRect(_))).count();
        if let Some(expected) = expected_rects {
            assert_eq!(first_rect_count, expected, "{style_id}");
        } else {
            assert!(first_rect_count > 0, "{style_id}");
        }
        let first_glyphs = group
            .nodes
            .iter()
            .filter_map(|node| match node {
                SceneNode::Glyphs(run) => {
                    assert_eq!(run.composite, GlyphCompositeMode::Normal, "{style_id}");
                    Some(Arc::clone(&run.glyphs))
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(!first_glyphs.is_empty(), "{style_id}");
        scene.nodes.insert(0, SceneNode::Vectors(Arc::clone(&background)));
        compositor
            .render(
                &scene,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap_or_else(|error| panic!("GPU {style_id}: {error}"));
        let geometry_writes = compositor.glyph_renderer_stats().geometry_writes;

        let mut later = gpu_plan
            .subtitle_scene_frame(later_time)
            .unwrap_or_else(|error| panic!("later {style_id} retained scene: {error:?}"))
            .scene;
        let [SceneNode::BlurredGroup(later_group)] = later.nodes.as_slice() else {
            panic!("later {style_id} must keep one composite group")
        };
        assert_eq!(later_group.composite, GlyphCompositeMode::Screen, "{style_id}");
        assert_eq!(
            later_group
                .nodes
                .iter()
                .filter(|node| matches!(node, SceneNode::RoundedRect(_)))
                .count(),
            first_rect_count,
            "{style_id} must keep fixed procedural slots"
        );
        let later_glyphs = later_group
            .nodes
            .iter()
            .filter_map(|node| match node {
                SceneNode::Glyphs(run) => Some(Arc::clone(&run.glyphs)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(first_glyphs.len(), later_glyphs.len(), "{style_id}");
        for (first, later) in first_glyphs.iter().zip(&later_glyphs) {
            assert!(Arc::ptr_eq(first, later), "{style_id}");
        }
        later.nodes.insert(0, SceneNode::Vectors(Arc::clone(&background)));
        compositor
            .render(
                &later,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap_or_else(|error| panic!("later GPU {style_id}: {error}"));
        assert_eq!(
            compositor.glyph_renderer_stats().geometry_writes,
            geometry_writes,
            "{style_id} must update uniforms only"
        );

        compositor
            .render(
                &scene,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap_or_else(|error| panic!("restore GPU {style_id}: {error}"));
        let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
        let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).unwrap();
        let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).unwrap();
        let comparison = imgcmp::compare(&reference, &gpu).unwrap_or_else(|error| panic!("{style_id} comparison: {error}"));
        assert!(comparison.flat_max_deviation <= 4, "{style_id}: {comparison:?}");
        assert!(comparison.edge_share <= 0.24, "{style_id}: {comparison:?}");
        assert!(comparison.ssim_downsampled >= 0.97, "{style_id}: {comparison:?}");
    }
}

#[test]
fn compositor_retained_recipe_strokes_match_cpu_and_reuse_glyph_geometry() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    const BACKDROP: u8 = 47;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping retained recipe-stroke test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.recipe-stroke-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let mut background = FrameBuilder::default();
    background.push(DrawOp::FillRect {
        x: 0.0,
        y: 0.0,
        w: FONT_WIDTH as f32,
        h: FONT_HEIGHT as f32,
        radius: 0.0,
        color: [
            f32::from(BACKDROP) / 255.0,
            f32::from(BACKDROP) / 255.0,
            f32::from(BACKDROP) / 255.0,
            1.0,
        ],
        tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    });
    let background = Arc::new(background.finish());

    for (style_id, expected_stroke_runs, expected_composite) in [
        ("caption-neon-accent", 3, GlyphCompositeMode::Screen),
        ("caption-neon-glow", 3, GlyphCompositeMode::Screen),
        ("caption-weight-shift", 1, GlyphCompositeMode::Normal),
    ] {
        let document = designed_caption_gpu_document(style_id);
        let time = 0.58;
        let later_time = 0.62;
        let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let mut reference = vec![BACKDROP, BACKDROP, BACKDROP, 255].repeat(usize::try_from(FONT_WIDTH * FONT_HEIGHT).unwrap());
        cpu_plan
            .composite_bgra(&mut reference, FONT_ROW_BYTES as usize, time)
            .unwrap_or_else(|error| panic!("CPU {style_id} recipe stroke: {error}"));
        for pixel in reference.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let mut scene = gpu_plan
            .subtitle_scene_frame(time)
            .unwrap_or_else(|error| panic!("{style_id} retained scene: {error:?}"))
            .scene;
        let children = match (expected_composite, scene.nodes.as_slice()) {
            (GlyphCompositeMode::Screen, [SceneNode::BlurredGroup(group)]) => {
                assert_eq!(group.composite, expected_composite, "{style_id}");
                group.nodes.as_slice()
            }
            (GlyphCompositeMode::Normal, nodes) => nodes,
            _ => panic!("{style_id} composite group mismatch"),
        };
        let first_glyphs = children
            .iter()
            .filter_map(|node| match node {
                SceneNode::Glyphs(run) => Some((
                    Arc::clone(&run.glyphs),
                    run.uniforms.iter().any(|uniform| {
                        matches!(
                            uniform.paint,
                            GlyphPaint::DilatedStroke { width } if width > 0.0
                        )
                    }),
                )),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            first_glyphs.iter().filter(|(_, stroke)| *stroke).count(),
            expected_stroke_runs,
            "{style_id}"
        );
        scene.nodes.insert(0, SceneNode::Vectors(Arc::clone(&background)));
        compositor
            .render(
                &scene,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap_or_else(|error| panic!("GPU {style_id} recipe stroke: {error}"));
        let geometry_writes = compositor.glyph_renderer_stats().geometry_writes;

        let mut later = gpu_plan
            .subtitle_scene_frame(later_time)
            .unwrap_or_else(|error| panic!("later {style_id} scene: {error:?}"))
            .scene;
        let later_children = match (expected_composite, later.nodes.as_slice()) {
            (GlyphCompositeMode::Screen, [SceneNode::BlurredGroup(group)]) => group.nodes.as_slice(),
            (GlyphCompositeMode::Normal, nodes) => nodes,
            _ => panic!("later {style_id} composite group mismatch"),
        };
        let later_glyphs = later_children
            .iter()
            .filter_map(|node| match node {
                SceneNode::Glyphs(run) => Some(Arc::clone(&run.glyphs)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(first_glyphs.len(), later_glyphs.len(), "{style_id}");
        for ((first, _), later) in first_glyphs.iter().zip(&later_glyphs) {
            assert!(Arc::ptr_eq(first, later), "{style_id}");
        }
        later.nodes.insert(0, SceneNode::Vectors(Arc::clone(&background)));
        compositor
            .render(
                &later,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap_or_else(|error| panic!("later GPU {style_id}: {error}"));
        assert_eq!(
            compositor.glyph_renderer_stats().geometry_writes,
            geometry_writes,
            "{style_id} must only update stroke uniforms"
        );

        compositor
            .render(
                &scene,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap_or_else(|error| panic!("restore GPU {style_id}: {error}"));
        let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
        let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).unwrap();
        let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).unwrap();
        let comparison = imgcmp::compare(&reference, &gpu).unwrap_or_else(|error| panic!("{style_id} comparison: {error}"));
        assert!(comparison.flat_max_deviation <= 2, "{style_id}: {comparison:?}");
        assert!(comparison.edge_share <= 0.20, "{style_id}: {comparison:?}");
        assert!(comparison.ssim_downsampled >= 0.98, "{style_id}: {comparison:?}");
    }
}

#[test]
fn compositor_matrix_decode_matches_cpu_with_phase_local_glyph_geometry() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor matrix-decode test");
        return;
    };
    let document = designed_caption_gpu_document("caption-matrix-decode");
    let time = 0.82;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU matrix-decode reference");
    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let scene = gpu_plan.subtitle_scene_frame(time).expect("matrix-decode retained scene").scene;
    let [SceneNode::Glyphs(first_run)] = scene.nodes.as_slice() else {
        panic!("matrix decode must stay in one glyph layer")
    };

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.matrix-decode-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let target = || RenderTarget {
        view: &view,
        width: FONT_WIDTH,
        height: FONT_HEIGHT,
        format: wgpu::TextureFormat::Rgba8Unorm,
    };
    compositor.render(&scene, target()).expect("GPU matrix-decode render");
    assert_eq!(compositor.glyph_renderer_stats().geometry_writes, 1);

    let repeated = gpu_plan
        .subtitle_scene_frame(time + 0.001)
        .expect("same-phase matrix-decode scene")
        .scene;
    let [SceneNode::Glyphs(repeated_run)] = repeated.nodes.as_slice() else {
        unreachable!()
    };
    assert!(Arc::ptr_eq(&first_run.glyphs, &repeated_run.glyphs));
    compositor.render(&repeated, target()).expect("same-phase GPU matrix-decode render");
    assert_eq!(
        compositor.glyph_renderer_stats().geometry_writes,
        1,
        "同一 scramble phase 不得重传 glyph geometry"
    );

    compositor
        .render(&scene, target())
        .expect("restore matrix-decode conformance sample");
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU matrix-decode pixmap");
    let gpu =
        tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU matrix-decode pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized matrix-decode frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_kinetic_slam_matches_cpu_with_retained_glyph_geometry() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor kinetic-slam test");
        return;
    };
    let document = designed_caption_gpu_document("caption-kinetic-slam");
    let time = 0.58;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU kinetic-slam reference");
    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let scene = gpu_plan.subtitle_scene_frame(time).expect("kinetic-slam retained scene").scene;
    let [SceneNode::Glyphs(first_run)] = scene.nodes.as_slice() else {
        panic!("kinetic slam must stay in one glyph layer")
    };
    assert!(
        first_run
            .uniforms
            .iter()
            .any(|uniform| uniform.transform != ScenePose::IDENTITY.transform)
    );

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.kinetic-slam-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU kinetic-slam render");
    let first_stats = compositor.glyph_renderer_stats();
    assert_eq!(first_stats.geometry_writes, 1);

    let later = gpu_plan
        .subtitle_scene_frame(0.62)
        .expect("later kinetic-slam retained scene")
        .scene;
    let [SceneNode::Glyphs(later_run)] = later.nodes.as_slice() else {
        panic!("later kinetic slam must stay in one glyph layer")
    };
    assert!(Arc::ptr_eq(&first_run.glyphs, &later_run.glyphs));
    compositor
        .render(
            &later,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("later GPU kinetic-slam render");
    let later_stats = compositor.glyph_renderer_stats();
    assert_eq!(later_stats.geometry_writes, 1, "同一可见词的 recipe 动画只应改 run uniform");

    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("restore conformance sample");
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU kinetic-slam pixmap");
    let gpu =
        tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU kinetic-slam pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized kinetic-slam frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_clip_wipe_matches_cpu_with_retained_glyph_geometry() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor clip-wipe test");
        return;
    };
    let document = designed_caption_gpu_document("caption-clip-wipe");
    let time = 0.58;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU clip-wipe reference");
    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let scene = gpu_plan.subtitle_scene_frame(time).expect("clip-wipe retained scene").scene;
    let [SceneNode::Glyphs(first_run)] = scene.nodes.as_slice() else {
        panic!("clip wipe must stay in one glyph layer")
    };
    assert!(first_run.uniforms.iter().any(|uniform| uniform.clip.is_some()));

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.clip-wipe-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU clip-wipe render");
    assert_eq!(compositor.glyph_renderer_stats().geometry_writes, 1);

    let later = gpu_plan.subtitle_scene_frame(0.62).expect("later clip-wipe retained scene").scene;
    let [SceneNode::Glyphs(later_run)] = later.nodes.as_slice() else {
        panic!("later clip wipe must stay in one glyph layer")
    };
    assert!(Arc::ptr_eq(&first_run.glyphs, &later_run.glyphs));
    assert_ne!(first_run.uniforms, later_run.uniforms);
    compositor
        .render(
            &later,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("later GPU clip-wipe render");
    assert_eq!(compositor.glyph_renderer_stats().geometry_writes, 1, "clip 动画只应改 run uniform");

    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("restore clip-wipe conformance sample");
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU clip-wipe pixmap");
    let gpu =
        tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU clip-wipe pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized clip-wipe frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_text_element_wipe_matches_the_cpu_reference() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping text element wipe test");
        return;
    };
    let document = json!({
        "meta": {"duration": 2.0},
        "style": {
            "mode": "orig", "fontFamily": "montserrat", "fontSize": 30,
            "fontColor": "#FFFFFF", "background": false,
            "wordAnimation": {"animationName": "None"},
            "transition": {"transitionId": "none", "transitionSpeed": 50}
        },
        "cues": [], "sentences": [], "transCues": [],
        "timeline": {"tracks": [{"kind": "overlay", "elements": [{
            "id": "wiped-title", "kind": "text", "start": 0.0, "end": 2.0,
            "text": "WIPE TITLE",
            "place": {"x": 50, "y": 50, "w": 90},
            "style": {
                "fontFamily": "Montserrat", "fontSize": 44,
                "fontColor": "#ffffff", "background": true,
                "backgroundColor": "#2455d6dd", "backgroundPadding": 12,
                "outline": true,
                "textOutline": {"on": true, "width": 3, "color": "#000000"},
                "dropShadow": {"on": true, "color": "#000000", "opacity": 0.55,
                    "distance": 0.08, "rotation": 20, "blur": 0.04}
            },
            "animate": {"enter": {"preset": "wipe", "presetVersion": 1, "dur": 0.6}}
        }]}]}
    });
    let time = 0.067;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    cpu_plan
        .load_timeline_elements(std::path::Path::new("/nonexistent/baocut-gpu-text-wipe"), &document)
        .unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU text wipe reference");

    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    gpu_plan
        .load_timeline_elements(std::path::Path::new("/nonexistent/baocut-gpu-text-wipe"), &document)
        .unwrap();
    let scene = gpu_plan.compositor_scene_frame(time).expect("retained text wipe scene");
    let [SceneNode::BlurredGroup(group)] = scene.nodes.as_slice() else {
        panic!("text wipe must stay in one retained reveal group")
    };
    assert!(group.reveal.is_some_and(|reveal| (0.0..1.0).contains(&reveal)));

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.text-wipe-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let stats = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU text wipe render");
    assert_eq!(stats.submissions, 1);
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU text wipe pixmap");
    let gpu =
        tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU text wipe pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized text wipe frames");
    assert!(comparison.flat_max_deviation <= 8, "{comparison:?}");
    assert!(comparison.edge_share <= 0.25, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.97, "{comparison:?}");
}

#[test]
fn compositor_cascading_underlined_text_matches_the_cpu_chunk_order() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping cascading underline test");
        return;
    };
    let document = json!({
        "meta": {"duration": 2.0},
        "style": {
            "mode": "orig", "fontFamily": "montserrat", "fontSize": 30,
            "fontColor": "#FFFFFF", "background": false,
            "wordAnimation": {"animationName": "None"},
            "transition": {"transitionId": "none", "transitionSpeed": 50}
        },
        "cues": [], "sentences": [], "transCues": [],
        "timeline": {"tracks": [{"kind": "overlay", "elements": [{
            "id": "underlined-rise", "kind": "text", "start": 0.0, "end": 2.0,
            "text": "UNDER LINE",
            "place": {"x": 50, "y": 50, "w": 42},
            "style": {
                "fontFamily": "Montserrat", "fontSize": 44,
                "fontColor": "#f4dc62", "background": false,
                "underline": true, "outline": true,
                "textOutline": {"on": true, "width": 3, "color": "#102040"},
                "dropShadow": {"on": false}, "glow": {"on": false}
            },
            "animate": {"enter": {
                "preset": "riseWords", "presetVersion": 1, "dur": 0.8, "stagger": 0.16
            }}
        }]}]}
    });
    let time = 0.10;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    cpu_plan
        .load_timeline_elements(std::path::Path::new("/nonexistent/baocut-gpu-cascade-underline"), &document)
        .unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU cascading underline reference");

    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    gpu_plan
        .load_timeline_elements(std::path::Path::new("/nonexistent/baocut-gpu-cascade-underline"), &document)
        .unwrap();
    let scene = gpu_plan.compositor_scene_frame(time).expect("retained cascading underline scene");
    assert!(scene.nodes.len() >= 6);
    let mut index = 0;
    let mut glyph_chunks = 0;
    while index < scene.nodes.len() {
        if matches!(scene.nodes[index], SceneNode::AnimatedVectors { .. }) {
            index += 1;
            continue;
        }
        assert!(matches!(
            scene.nodes.get(index..index + 3),
            Some([SceneNode::Glyphs(_), SceneNode::Glyphs(_), SceneNode::AnimatedVectors { .. }])
        ));
        glyph_chunks += 1;
        index += 3;
    }
    assert!(glyph_chunks >= 2);

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.cascade-underline-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let stats = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU cascading underline render");
    assert_eq!(stats.submissions, 1);
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU cascading underline pixmap");
    let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("GPU cascading underline pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized cascading underline frames");
    assert!(comparison.flat_max_deviation <= 8, "{comparison:?}");
    assert!(comparison.edge_share <= 0.25, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.97, "{comparison:?}");
}

#[test]
fn compositor_gradient_fill_matches_cpu_with_retained_glyph_geometry() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor gradient-fill test");
        return;
    };
    let document = designed_caption_gpu_document("caption-gradient-fill");
    let time = 0.58;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU gradient-fill reference");
    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let scene = gpu_plan.subtitle_scene_frame(time).expect("gradient-fill retained scene").scene;
    let [SceneNode::Glyphs(first_run)] = scene.nodes.as_slice() else {
        panic!("gradient fill must stay in one glyph layer")
    };
    assert!(
        first_run
            .uniforms
            .iter()
            .any(|uniform| matches!(uniform.paint, GlyphPaint::RepeatLinearGradient { .. }))
    );

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.gradient-fill-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU gradient-fill render");
    assert_eq!(compositor.glyph_renderer_stats().geometry_writes, 1);

    let later = gpu_plan
        .subtitle_scene_frame(0.62)
        .expect("later gradient-fill retained scene")
        .scene;
    let [SceneNode::Glyphs(later_run)] = later.nodes.as_slice() else {
        panic!("later gradient fill must stay in one glyph layer")
    };
    assert!(Arc::ptr_eq(&first_run.glyphs, &later_run.glyphs));
    assert_ne!(first_run.uniforms, later_run.uniforms);
    compositor
        .render(
            &later,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("later GPU gradient-fill render");
    assert_eq!(
        compositor.glyph_renderer_stats().geometry_writes,
        1,
        "gradient 动画只应改 run uniform"
    );

    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("restore gradient-fill conformance sample");
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU gradient-fill pixmap");
    let gpu =
        tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU gradient-fill pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized gradient-fill frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_texture_fill_matches_cpu_and_reuses_the_content_texture() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor texture-fill test");
        return;
    };
    let document = designed_caption_gpu_document("caption-texture");
    let time = 0.58;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU texture-fill reference");
    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let scene = gpu_plan.subtitle_scene_frame(time).expect("texture-fill retained scene").scene;
    let [SceneNode::Glyphs(first_run)] = scene.nodes.as_slice() else {
        panic!("texture fill must stay in one glyph layer")
    };
    assert!(first_run.uniforms.iter().all(|uniform| uniform.paint == GlyphPaint::RepeatTexture));
    let first_pattern = first_run.texture.as_ref().expect("glyph pattern resource");
    assert_eq!((first_pattern.width, first_pattern.height), (128, 128));

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.texture-fill-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let first_report = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU texture-fill render");
    assert_eq!(first_report.binding_rebuilds, 1, "pattern first uploads once");
    assert_eq!(compositor.glyph_renderer_stats().geometry_writes, 1);

    let later = gpu_plan
        .subtitle_scene_frame(0.62)
        .expect("later texture-fill retained scene")
        .scene;
    let [SceneNode::Glyphs(later_run)] = later.nodes.as_slice() else {
        panic!("later texture fill must stay in one glyph layer")
    };
    assert!(Arc::ptr_eq(&first_run.glyphs, &later_run.glyphs));
    assert!(Arc::ptr_eq(
        first_run.texture.as_ref().unwrap(),
        later_run.texture.as_ref().unwrap()
    ));
    assert_ne!(first_run.uniforms, later_run.uniforms);
    let steady = compositor
        .render(
            &later,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("later GPU texture-fill render");
    assert_eq!(steady.binding_rebuilds, 0, "resident pattern must reuse its bind group");
    assert_eq!(
        compositor.glyph_renderer_stats().geometry_writes,
        1,
        "texture animation must only update run uniforms"
    );

    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("restore texture-fill conformance sample");
    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU texture-fill pixmap");
    let gpu =
        tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU texture-fill pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized texture-fill frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_designed_caption_plates_match_cpu_without_vector_tessellation() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor plate test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.designed-caption-plate-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);

    for style_id in ["caption-highlight", "caption-pill-karaoke"] {
        let document = designed_caption_gpu_document(style_id);
        let (time, later_time) = if style_id == "caption-pill-karaoke" {
            (1.35, 1.39)
        } else {
            (0.58, 0.62)
        };
        let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let reference = cpu_plan
            .render_rgba(time)
            .unwrap_or_else(|error| panic!("CPU {style_id} reference: {error}"));
        let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
        let scene = gpu_plan
            .subtitle_scene_frame(time)
            .unwrap_or_else(|error| panic!("{style_id} retained scene: {error:?}"))
            .scene;
        assert!(
            scene.nodes.iter().any(|node| matches!(node, SceneNode::RoundedRect(_))),
            "{style_id} must use the procedural plate pass"
        );
        let first_run = scene
            .nodes
            .iter()
            .find_map(|node| match node {
                SceneNode::Glyphs(run) => Some(run),
                _ => None,
            })
            .expect("plate scene glyph run");
        let glyph_node_count = scene.nodes.iter().filter(|node| matches!(node, SceneNode::Glyphs(_))).count() as u64;

        let vector_writes = compositor.vector_renderer_stats().geometry_writes;
        let glyph_writes = compositor.glyph_renderer_stats().geometry_writes;
        let plate_writes = compositor.rounded_rect_renderer_stats().uniform_writes;
        let stats = compositor
            .render(
                &scene,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap_or_else(|error| panic!("GPU {style_id} render: {error}"));
        assert_eq!(stats.submissions, 1);
        assert_eq!(
            compositor.vector_renderer_stats().geometry_writes,
            vector_writes,
            "{style_id} must not tessellate a per-frame plate"
        );
        assert_eq!(compositor.glyph_renderer_stats().geometry_writes, glyph_writes + glyph_node_count);
        assert_eq!(compositor.rounded_rect_renderer_stats().uniform_writes, plate_writes + 1);

        let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
        let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
            .expect("CPU plate pixmap");
        let gpu =
            tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU plate pixmap");
        let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized plate frames");
        assert!(comparison.flat_max_deviation <= 2, "{style_id}: {comparison:?}");
        assert!(comparison.edge_share <= 0.20, "{style_id}: {comparison:?}");
        assert!(comparison.ssim_downsampled >= 0.98, "{style_id}: {comparison:?}");

        let later = gpu_plan
            .subtitle_scene_frame(later_time)
            .unwrap_or_else(|error| panic!("later {style_id} scene: {error:?}"))
            .scene;
        let later_run = later
            .nodes
            .iter()
            .find_map(|node| match node {
                SceneNode::Glyphs(run) => Some(run),
                _ => None,
            })
            .expect("later plate scene glyph run");
        assert!(Arc::ptr_eq(&first_run.glyphs, &later_run.glyphs));
        compositor
            .render(
                &later,
                RenderTarget {
                    view: &view,
                    width: FONT_WIDTH,
                    height: FONT_HEIGHT,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
            )
            .unwrap_or_else(|error| panic!("later GPU {style_id} render: {error}"));
        assert_eq!(
            compositor.glyph_renderer_stats().geometry_writes,
            glyph_writes + glyph_node_count,
            "{style_id} plate motion must not rebuild glyph geometry"
        );
        assert_eq!(
            compositor.vector_renderer_stats().geometry_writes,
            vector_writes,
            "{style_id} plate motion must stay out of vector tessellation"
        );
        assert_eq!(compositor.rounded_rect_renderer_stats().uniform_writes, plate_writes + 2);
    }
}

#[test]
fn compositor_parallax_duplicate_layers_match_cpu_with_retained_geometry() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor duplicate-layer test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.parallax-duplicate-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let mut document = designed_caption_gpu_document("caption-parallax-layers");
    document["style"]["italic"] = json!(true);
    document["style"]["captionEmphasis"] = json!({
        "designed-w1": {"anchorText": "Bao", "role": "hero"}
    });
    let time = 0.8;
    let later_time = 0.84;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU parallax duplicate reference");
    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let scene = gpu_plan
        .subtitle_scene_frame(time)
        .expect("retained parallax duplicate scene")
        .scene;
    let runs = scene
        .nodes
        .iter()
        .filter_map(|node| match node {
            SceneNode::Glyphs(run) => Some(run),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(runs.len(), 6, "两词各应提交两层 duplicate + 正文");
    assert!(
        runs.chunks_exact(3).any(|word| word[0].uniforms[0].color[3] > 0.0),
        "hero 词必须产生可见 duplicate"
    );
    for word in runs.chunks_exact(3) {
        assert!(Arc::ptr_eq(&word[0].glyphs, &word[1].glyphs));
        assert!(Arc::ptr_eq(&word[1].glyphs, &word[2].glyphs));
    }

    let glyph_writes = compositor.glyph_renderer_stats().geometry_writes;
    let stats = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU parallax duplicate render");
    assert_eq!(stats.submissions, 1);
    assert_eq!(compositor.glyph_renderer_stats().geometry_writes, glyph_writes + runs.len() as u64);

    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU parallax duplicate pixmap");
    let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("GPU parallax duplicate pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized duplicate frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");

    let later = gpu_plan
        .subtitle_scene_frame(later_time)
        .expect("later parallax duplicate scene")
        .scene;
    let later_runs = later
        .nodes
        .iter()
        .filter_map(|node| match node {
            SceneNode::Glyphs(run) => Some(run),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(later_runs.len(), runs.len());
    for (first, later) in runs.iter().zip(&later_runs) {
        assert!(Arc::ptr_eq(&first.glyphs, &later.glyphs));
    }
    compositor
        .render(
            &later,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("later GPU parallax duplicate render");
    assert_eq!(
        compositor.glyph_renderer_stats().geometry_writes,
        glyph_writes + runs.len() as u64,
        "duplicate animation must only rewrite uniforms"
    );
}

#[test]
fn compositor_editorial_color_mix_matches_cpu_without_a_duplicate_pass() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor editorial color-mix test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.editorial-color-mix-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let mut document = designed_caption_gpu_document("caption-editorial-emphasis");
    document["style"]["captionEmphasis"] = json!({
        "designed-w1": {"anchorText": "Bao", "role": "hero"}
    });
    let time = 0.58;
    let later_time = 0.62;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU editorial color-mix reference");
    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let scene = gpu_plan
        .subtitle_scene_frame(time)
        .expect("retained editorial color-mix scene")
        .scene;
    let runs = scene
        .nodes
        .iter()
        .filter_map(|node| match node {
            SceneNode::Glyphs(run) => Some(run),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(runs.len(), 1, "editorial 不应提交全透明 duplicate pass");
    assert_eq!(runs[0].uniforms.len(), 2);
    assert!(
        runs[0].uniforms.iter().any(|uniform| uniform.color[2] < 0.5),
        "hero colorMix 必须到达 GPU color uniform"
    );

    let glyph_writes = compositor.glyph_renderer_stats().geometry_writes;
    let stats = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU editorial color-mix render");
    assert_eq!(stats.submissions, 1);
    assert_eq!(compositor.glyph_renderer_stats().geometry_writes, glyph_writes + 1);

    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU editorial color-mix pixmap");
    let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("GPU editorial color-mix pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized editorial frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");

    let later = gpu_plan
        .subtitle_scene_frame(later_time)
        .expect("later editorial color-mix scene")
        .scene;
    let later_runs = later
        .nodes
        .iter()
        .filter_map(|node| match node {
            SceneNode::Glyphs(run) => Some(run),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(later_runs.len(), 1);
    assert!(Arc::ptr_eq(&runs[0].glyphs, &later_runs[0].glyphs));
    assert_ne!(runs[0].uniforms, later_runs[0].uniforms);
    compositor
        .render(
            &later,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("later GPU editorial color-mix render");
    assert_eq!(
        compositor.glyph_renderer_stats().geometry_writes,
        glyph_writes + 1,
        "editorial enter animation must only rewrite uniforms"
    );
}

#[test]
fn compositor_emoji_pop_matches_cpu_with_retained_word_local_geometry() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor emoji-pop test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.emoji-pop-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let mut document = designed_caption_gpu_document("caption-emoji-pop");
    document["style"]["captionEmphasis"] = json!({
        "designed-w1": {"anchorText": "Bao", "role": "hero"}
    });
    let time = 0.58;
    let later_time = 0.62;
    let mut cpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = cpu_plan.render_rgba(time).expect("CPU emoji-pop reference");
    let mut gpu_plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let scene = gpu_plan.subtitle_scene_frame(time).expect("retained emoji-pop scene").scene;
    let runs = scene
        .nodes
        .iter()
        .filter_map(|node| match node {
            SceneNode::Glyphs(run) => Some(run),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(runs.len(), 4, "两词应按 emoji→正文 交错提交");
    assert!(runs[0].uniforms[0].color_opacity > 0.0);
    assert_eq!(runs[2].uniforms[0].color_opacity, 0.0);

    let stats = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU emoji-pop render");
    assert_eq!(stats.submissions, 1);
    let geometry_writes = compositor.glyph_renderer_stats().geometry_writes;

    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU emoji-pop pixmap");
    let gpu =
        tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU emoji-pop pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized emoji-pop frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");

    let later = gpu_plan
        .subtitle_scene_frame(later_time)
        .expect("later retained emoji-pop scene")
        .scene;
    let later_runs = later
        .nodes
        .iter()
        .filter_map(|node| match node {
            SceneNode::Glyphs(run) => Some(run),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(later_runs.len(), runs.len());
    for (first, second) in runs.iter().zip(later_runs.iter()) {
        assert!(Arc::ptr_eq(&first.glyphs, &second.glyphs));
    }
    compositor
        .render(
            &later,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("later GPU emoji-pop render");
    assert_eq!(
        compositor.glyph_renderer_stats().geometry_writes,
        geometry_writes,
        "emoji-pop animation must only rewrite uniforms"
    );
}

#[test]
fn compositor_colr_glyph_matches_the_cpu_reference_without_font_color_tint() {
    // 诊断读回要求 bytes_per_row 按 256 B 对齐；192×4 = 768。
    const COLOR_WIDTH: u32 = 192;
    const COLOR_HEIGHT: u32 = 90;
    const COLOR_ROW_BYTES: u32 = COLOR_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor COLR glyph test");
        return;
    };
    let document = json!({
        "meta": {"duration": 2.0},
        "style": {
            "mode": "orig",
            "fontFamily": "ColrProbe",
            "fontSize": 64,
            "fontColor": "#00FF0080",
            "bold": false,
            "outline": false,
            "underline": false,
            "background": false,
            "lineHeight": 1.2,
            "x": 50,
            "y": 50,
            "width": 90,
            "scale": 1,
            "rotation": 0,
            "wordAnimation": {"animationName": "None"},
            "transition": {"transitionId": "none", "transitionSpeed": 50},
            "displayTiming": {"leadIn": 0, "tail": 0}
        },
        "cues": [{
            "id": "color-1",
            "start": 0.0,
            "end": 2.0,
            "text": "A",
            "words": [{"text": "A", "t0": 0.0, "t1": 2.0}]
        }],
        "sentences": [],
        "transCues": []
    });
    let mut plan = OverlayRenderPlan::compile_with_injected_fonts(
        &document,
        COLOR_WIDTH,
        COLOR_HEIGHT,
        2.0,
        30.0,
        None,
        OverlayIncludes::ALL,
        vec![include_bytes!("../../render-raster/tests/fixtures/fonts/ColrProbe.ttf").to_vec()],
    )
    .unwrap();
    let reference = plan.render_rgba(1.0).expect("CPU COLR subtitle reference");
    let scene = plan.subtitle_scene_frame(1.0).expect("COLR glyph scene").scene;
    let [SceneNode::Glyphs(run)] = scene.nodes.as_slice() else {
        panic!("COLR subtitle must stay in the ordered glyph run")
    };
    assert!(matches!(&run.glyphs[0].mask.pixels, GlyphPixels::Color(_)));

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.colr-target"),
        size: wgpu::Extent3d {
            width: COLOR_WIDTH,
            height: COLOR_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: COLOR_WIDTH,
                height: COLOR_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU COLR glyph render");
    assert_eq!(compositor.glyph_atlas_stats().resident, 0);
    assert_eq!(compositor.color_glyph_atlas_stats().resident, 1);

    let gpu = diagnostic_readback_sized(&device, &queue, &texture, COLOR_WIDTH, COLOR_HEIGHT, COLOR_ROW_BYTES);
    let reference =
        tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(COLOR_WIDTH, COLOR_HEIGHT).unwrap()).expect("CPU COLR pixmap");
    let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(COLOR_WIDTH, COLOR_HEIGHT).unwrap()).expect("GPU COLR pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized COLR frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_real_font_glow_matches_the_cpu_reference_structurally() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor glow test");
        return;
    };
    let document = json!({
        "meta": {"duration": 2.0},
        "style": {
            "mode": "orig",
            "fontFamily": "montserrat",
            "fontSize": 72,
            "fontColor": "#FFFFFF",
            "bold": false,
            "outline": true,
            "textOutline": {"on": true, "color": "#101828", "width": 10},
            "glow": {"on": true, "color": "#40A0FF", "intensity": 60, "range": 8},
            "background": false,
            "lineHeight": 1.2,
            "x": 50,
            "y": 58,
            "width": 92,
            "scale": 1,
            "rotation": 0,
            "wordAnimation": {"animationName": "None"},
            "transition": {"transitionId": "none", "transitionSpeed": 50},
            "displayTiming": {"leadIn": 0, "tail": 0}
        },
        "cues": [{
            "id": "font-glow",
            "start": 0.0,
            "end": 2.0,
            "text": "BaoCut",
            "words": [{"text": "BaoCut", "t0": 0.0, "t1": 2.0}]
        }],
        "sentences": [],
        "transCues": []
    });
    let mut plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = plan.render_rgba(1.0).expect("CPU glow reference");
    let scene = plan.subtitle_scene_frame(1.0).expect("subtitle glow scene").scene;
    assert!(matches!(scene.nodes[0], SceneNode::BlurredGlyphs(_)));
    assert!(matches!(scene.nodes[1], SceneNode::Glyphs(_)));
    assert!(matches!(scene.nodes[2], SceneNode::Glyphs(_)));

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.real-font-glow-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let first = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("GPU glow render");
    assert_eq!(first.submissions, 1);
    assert_eq!(first.binding_rebuilds, 1);
    let steady = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("stable GPU glow render");
    assert_eq!(steady.binding_rebuilds, 0);
    let stats = compositor.glyph_renderer_stats();
    assert_eq!(stats.geometry_writes, 4, "effect 与清晰层都必须保留 geometry");

    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference =
        tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("CPU glow pixmap");
    let gpu = tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU glow pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized glow frames");
    assert!(comparison.flat_max_deviation <= 8, "{comparison:?}");
    assert!(comparison.edge_share <= 0.25, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.97, "{comparison:?}");
}

#[test]
fn compositor_nested_glow_and_transition_blur_match_the_cpu_reference() {
    const FONT_WIDTH: u32 = 320;
    const FONT_HEIGHT: u32 = 180;
    const FONT_ROW_BYTES: u32 = FONT_WIDTH * 4;
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor transition blur test");
        return;
    };
    let document = json!({
        "meta": {"duration": 2.0},
        "style": {
            "mode": "orig",
            "fontFamily": "montserrat",
            "fontSize": 72,
            "fontColor": "#FFFFFF",
            "bold": false,
            "outline": true,
            "textOutline": {"on": true, "color": "#101828", "width": 10},
            "glow": {"on": true, "color": "#40A0FF", "intensity": 55, "range": 8},
            "background": true,
            "backgroundColor": "#202020E6",
            "backgroundPadding": 12,
            "lineHeight": 1.2,
            "x": 50,
            "y": 58,
            "width": 92,
            "scale": 1,
            "rotation": 0,
            "wordAnimation": {"animationName": "None"},
            "transition": {"transitionId": "magic-fade", "transitionSpeed": 50},
            "displayTiming": {"leadIn": 0, "tail": 0}
        },
        "cues": [{
            "id": "font-nested-blur",
            "start": 0.0,
            "end": 2.0,
            "text": "BaoCut",
            "words": [{"text": "BaoCut", "t0": 0.0, "t1": 2.0}]
        }],
        "sentences": [],
        "transCues": []
    });
    let frame_time = 1.0 / 30.0;
    let mut plan = OverlayRenderPlan::compile(&document, FONT_WIDTH, FONT_HEIGHT, 2.0, 30.0, None).unwrap();
    let reference = plan.render_rgba(frame_time).expect("CPU nested blur reference");
    let scene = plan.subtitle_scene_frame(0.01).expect("nested subtitle blur scene").scene;
    let [SceneNode::BlurredGroup(group)] = scene.nodes.as_slice() else {
        panic!("magic-fade 必须成为整组 blur")
    };
    assert!(matches!(group.nodes[0], SceneNode::AnimatedVectors { .. }));
    assert!(matches!(group.nodes[1], SceneNode::BlurredGlyphs(_)));
    assert!(matches!(group.nodes[2], SceneNode::Glyphs(_)));
    assert!(matches!(group.nodes[3], SceneNode::Glyphs(_)));

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.nested-blur-target"),
        size: wgpu::Extent3d {
            width: FONT_WIDTH,
            height: FONT_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let first = compositor
        .render_at(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            frame_time,
        )
        .expect("GPU nested blur render");
    assert_eq!(first.submissions, 1);
    assert_eq!(first.binding_rebuilds, 2, "glow 与整组 blur 各驻留一组纹理");
    let steady = compositor
        .render_at(
            &scene,
            RenderTarget {
                view: &view,
                width: FONT_WIDTH,
                height: FONT_HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
            frame_time,
        )
        .expect("stable GPU nested blur render");
    assert_eq!(steady.binding_rebuilds, 0);

    let gpu = diagnostic_readback_sized(&device, &queue, &texture, FONT_WIDTH, FONT_HEIGHT, FONT_ROW_BYTES);
    let reference = tiny_skia::Pixmap::from_vec(reference, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap())
        .expect("CPU nested blur pixmap");
    let gpu =
        tiny_skia::Pixmap::from_vec(gpu, tiny_skia::IntSize::from_wh(FONT_WIDTH, FONT_HEIGHT).unwrap()).expect("GPU nested blur pixmap");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized nested blur frames");
    assert!(comparison.flat_max_deviation <= 12, "{comparison:?}");
    assert!(comparison.edge_share <= 0.30, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.95, "{comparison:?}");
}

/// `DrawOp::FillPath` 的冻结口径是 nonzero。五角星的自交中心仍应实心；
/// EvenOdd 会把中心错误地挖成洞，简单矩形 conformance 看不出来。
#[test]
fn compositor_fill_path_uses_the_cpu_nonzero_rule() {
    let frame = Arc::new(FrameOps {
        paths: vec![self_intersecting_star()],
        ops: vec![DrawOp::FillPath {
            path: 0,
            color: [0.9, 0.2, 0.1, 1.0],
            tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        }],
        ..FrameOps::default()
    });
    assert_vector_frame_matches_cpu(&frame, "nonzero-fill", |bytes| {
        let center = pixel_at(bytes, 32, 24, ROW_BYTES);
        assert!(center[0] >= 228, "nested center must stay filled: {center:?}");
        assert!(center[3] >= 253, "nested center must stay opaque: {center:?}");
    });
}

/// 半透明描边必须与 tiny-skia 的单次覆盖口径一致。圆角 join 是 lyon 最容易
/// 产生重叠三角形的位置；若同一 mesh 内直接 alpha-over，两次覆盖会从 0.5
/// 叠成 0.75，这条会在 join 中心和结构指标上同时报错。
#[test]
fn compositor_translucent_round_stroke_matches_the_cpu_reference() {
    let frame = Arc::new(FrameOps {
        paths: vec![sharp_zigzag_path()],
        ops: vec![DrawOp::StrokePath {
            path: 0,
            color: [0.1, 0.8, 0.3, 0.5],
            width: 12.0,
            tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        }],
        ..FrameOps::default()
    });
    assert_vector_frame_matches_cpu(&frame, "translucent-round-stroke", |bytes| {
        for (x, y) in [(24, 8), (32, 24), (40, 8)] {
            let join = pixel_at(bytes, x, y, ROW_BYTES);
            assert!(
                (124..=131).contains(&join[3]),
                "round join must be covered once at ({x},{y}): {join:?}"
            );
        }
    });
}

/// 真实元素求值层同时产出 CPU reference 和 ShaderQuad；这条从
/// `ElementDraw` 一路跑到 compositor 目标，防止旋转/镜像/动画的 Mat6 在
/// 跨越节点边界时被退化成轴对齐盒。
#[test]
fn compositor_affine_shader_quad_matches_the_cpu_element_reference() {
    const AFFINE_W: u32 = 640;
    const AFFINE_H: u32 = 400;
    const AFFINE_ROW_BYTES: u32 = AFFINE_W * 4;

    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor affine conformance test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.affine-target"),
        size: wgpu::Extent3d {
            width: AFFINE_W,
            height: AFFINE_H,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let place = Place {
        x: Some(50.0),
        y: Some(50.0),
        w: Some(50.0),
        rot: Some(30.0),
        ..Place::default()
    };
    let mut props = ProgressProps::new("normal");
    props.main_color = Some("#ff0000".to_owned());
    props.secondary_color = Some("#0000ff".to_owned());
    let element = ElementDraw {
        id: "affine-progress",
        kind: ElementKind::Progress,
        start: 0.0,
        end: 4.0,
        place: &place,
        shape: None,
        sticker: None,
        visualizer: None,
        progress: Some(&props),
        draw: None,
        placeholder: None,
        confetti: None,
        whiteboard: None,
        has_source: false,
    };
    let pose = timeline::resolve_animation_pose(None, 0.0, Some(4.0), 4.0, 2.0, 30.0);
    let evaluated = evaluate_scene_element(&element, 2.0, &pose, Stage::new(AFFINE_W, AFFINE_H), None, Some(2.0), &mut |_| {})
        .expect("evaluate compositor-owned progress")
        .expect("progress should be claimed");
    let node = evaluated.node.expect("progress should emit a shader quad");
    let scene = SceneFrame {
        nodes: vec![node],
        next_change: Some(61.0 / 30.0),
        active_until: None,
        fingerprint: render_raster::fingerprint(&evaluated.reference),
    };

    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let stats = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: AFFINE_W,
                height: AFFINE_H,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .expect("render affine progress directly into target");
    assert_eq!(stats.nodes, 1);
    assert_eq!(stats.submissions, 1);

    let gpu_bytes = diagnostic_readback_sized(&device, &queue, &texture, AFFINE_W, AFFINE_H, AFFINE_ROW_BYTES);
    let reference = rasterize_with_media(&evaluated.reference, AFFINE_W, AFFINE_H, &mut NoMedia).expect("CPU progress reference");
    let gpu = tiny_skia::Pixmap::from_vec(gpu_bytes, tiny_skia::IntSize::from_wh(AFFINE_W, AFFINE_H).unwrap())
        .expect("GPU premultiplied texture bytes");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized affine frames");
    assert!(comparison.flat_max_deviation <= 2, "{comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{comparison:?}");
}

#[test]
fn compositor_preserves_cross_pipeline_order_in_one_submission() {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor z-order test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.z-order-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

    let mut builder = FrameBuilder::default();
    builder.push(DrawOp::FillRect {
        x: 0.0,
        y: 0.0,
        w: WIDTH as f32,
        h: HEIGHT as f32,
        radius: 0.0,
        color: [0.0, 0.0, 1.0, 1.0],
        tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    });
    let background = Arc::new(builder.finish());
    let mut builder = FrameBuilder::default();
    builder.push(DrawOp::FillRect {
        x: 0.0,
        y: 32.0,
        w: WIDTH as f32,
        h: 16.0,
        radius: 0.0,
        color: [0.0, 1.0, 0.0, 1.0],
        tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    });
    let stripe = Arc::new(builder.finish());
    let foreground = ShaderQuad::progress(
        timeline_progress("normal").unwrap(),
        &ProgressParams {
            main_color: [1.0, 0.0, 0.0, 1.0],
            secondary_color: [0.0, 0.0, 0.0, 0.0],
            pixel_scale: 1.0,
        },
        0.5,
        0.0,
        DrawBox {
            x: 8.0,
            y: 8.0,
            w: 48.0,
            h: 12.0,
        },
        (f64::from(WIDTH), f64::from(HEIGHT)),
    )
    .unwrap();
    let scene = SceneFrame {
        nodes: vec![
            SceneNode::Vectors(background),
            SceneNode::Vectors(stripe),
            SceneNode::shader_quad(foreground, (f64::from(WIDTH), f64::from(HEIGHT))),
        ],
        next_change: None,
        active_until: None,
        fingerprint: 12,
    };
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    let stats = compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .unwrap();
    assert_eq!(stats.nodes, 3);
    assert_eq!(stats.submissions, 1);
    assert_eq!(stats.binding_rebuilds, 1);

    let bytes = diagnostic_readback(&device, &queue, &texture);
    let pixel = |x: u32, y: u32| {
        let offset = (y * ROW_BYTES + x * 4) as usize;
        &bytes[offset..offset + 4]
    };
    assert_eq!(pixel(2, 2), &[0, 0, 255, 255]);
    assert_eq!(pixel(16, 12), &[255, 0, 0, 255]);
    assert_eq!(pixel(48, 12), &[0, 0, 255, 255]);
    assert_eq!(pixel(2, 40), &[0, 255, 0, 255]);
}

/// R1 性能台架：release 档手动运行，避免普通 CPU-only CI 把 Metal 数字当功能门。
///
/// `cargo test -p compositor --release --features gpu --test gpu_target \
///   -- --ignored --nocapture compositor_1080p_20_elements_profile`
#[test]
#[ignore]
fn compositor_1080p_20_elements_profile() {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping compositor profile");
        return;
    };
    const PROFILE_W: u32 = 1920;
    const PROFILE_H: u32 = 1080;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.profile.target"),
        size: wgpu::Extent3d {
            width: PROFILE_W,
            height: PROFILE_H,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let recipe = timeline_progress("normal").unwrap();
    let params = ProgressParams {
        main_color: [0.23, 0.68, 1.0, 0.85],
        secondary_color: [0.77, 0.90, 1.0, 0.35],
        pixel_scale: 2.0,
    };
    let nodes = (0..20)
        .map(|index| {
            let row = index / 4;
            let column = index % 4;
            ShaderQuad::progress(
                recipe,
                &params,
                f64::from(index + 1) / 20.0,
                0.5,
                DrawBox {
                    x: 80.0 + f64::from(column) * 460.0,
                    y: 80.0 + f64::from(row) * 190.0,
                    w: 360.0,
                    h: 54.0,
                },
                (f64::from(PROFILE_W), f64::from(PROFILE_H)),
            )
            .map(|quad| SceneNode::shader_quad(quad, (f64::from(PROFILE_W), f64::from(PROFILE_H))))
            .unwrap()
        })
        .collect();
    let scene = SceneFrame {
        nodes,
        next_change: Some(1.0 / 30.0),
        active_until: None,
        fingerprint: 20,
    };
    let mut compositor = Compositor::from_device(device.clone(), queue, backend.clone(), adapter_name.clone());
    let target = || RenderTarget {
        view: &view,
        width: PROFILE_W,
        height: PROFILE_H,
        format: wgpu::TextureFormat::Rgba8Unorm,
    };
    for warm_index in 0..5 {
        let stats = compositor.render(&scene, target()).unwrap();
        assert_eq!(stats.submissions, 1);
        assert_eq!(stats.binding_rebuilds, if warm_index == 0 { 20 } else { 0 });
        device.poll(wgpu::PollType::wait_indefinitely()).expect("warm GPU");
    }
    let mut samples = Vec::with_capacity(120);
    for _ in 0..120 {
        let started = std::time::Instant::now();
        compositor.render(&scene, target()).unwrap();
        device.poll(wgpu::PollType::wait_indefinitely()).expect("finish GPU frame");
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    samples.sort_by(f64::total_cmp);
    let percentile = |q: f64| {
        let index = ((samples.len() as f64 * q).ceil() as usize)
            .saturating_sub(1)
            .min(samples.len() - 1);
        samples[index]
    };
    eprintln!(
        "compositor profile backend={backend} adapter={adapter_name:?} n={} p50={:.3}ms p95={:.3}ms p99={:.3}ms max={:.3}ms",
        samples.len(),
        percentile(0.50),
        percentile(0.95),
        percentile(0.99),
        samples.last().copied().unwrap_or_default(),
    );
    assert!(percentile(0.95) <= 12.0, "1080p/20 elements p95 exceeded 12ms");
}

/// R2 性能台架：同一份五行、圆角底板、Color 逐词与入场 pose，比较 CPU 整幅
/// tiny-skia 光栅和 retained glyph scene + compositor。release 手动运行：
///
/// `cargo test -p compositor --release --features gpu --test gpu_target \
///   -- --ignored --nocapture compositor_1080p_five_line_subtitle_profile`
///
/// 加 `BCUT_PROFILE_SUBTITLE_BLUR=1` 会在同一五行场景上启用 outline + glow +
/// magic-fade，覆盖逐行与整组两层 blur 的最坏常用组合。
#[test]
#[ignore]
fn compositor_1080p_five_line_subtitle_profile() {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping R2 subtitle profile");
        return;
    };
    const PROFILE_W: u32 = 1920;
    const PROFILE_H: u32 = 1080;
    const SAMPLE_COUNT: usize = 120;
    let mut document = json!({
        "meta": {"duration": 2.0},
        "style": {
            "mode": "orig",
            "fontFamily": "montserrat",
            "fontSize": 64,
            "fontColor": "#FFFFFF",
            "fontWeight": 700,
            "outline": false,
            "background": true,
            "backgroundColor": "#101820D9",
            "backgroundPadding": 14,
            "backgroundStyle": "wrap",
            "lineHeight": 1.15,
            "x": 50,
            "y": 52,
            "width": 80,
            "scale": 1,
            "rotation": 0,
            "wordAnimation": {"animationName": "Color"},
            "transition": {"transitionId": "magic-pop", "transitionSpeed": 50},
            "displayTiming": {"leadIn": 0, "tail": 0}
        },
        "cues": [{
            "id": "five-lines",
            "start": 0.0,
            "end": 2.0,
            "text": "Build once\nRetain every glyph\nAnimate tiny uniforms\nComposite on the GPU\nKeep CPU as reference",
            "words": [
                {"text":"Build", "t0":0.0, "t1":0.12},
                {"text":"once", "t0":0.12, "t1":0.24},
                {"text":"Retain", "t0":0.24, "t1":0.36},
                {"text":"every", "t0":0.36, "t1":0.48},
                {"text":"glyph", "t0":0.48, "t1":0.60},
                {"text":"Animate", "t0":0.60, "t1":0.72},
                {"text":"tiny", "t0":0.72, "t1":0.84},
                {"text":"uniforms", "t0":0.84, "t1":0.96},
                {"text":"Composite", "t0":0.96, "t1":1.08},
                {"text":"on", "t0":1.08, "t1":1.20},
                {"text":"the", "t0":1.20, "t1":1.32},
                {"text":"GPU", "t0":1.32, "t1":1.44},
                {"text":"Keep", "t0":1.44, "t1":1.56},
                {"text":"CPU", "t0":1.56, "t1":1.68},
                {"text":"as", "t0":1.68, "t1":1.80},
                {"text":"reference", "t0":1.80, "t1":2.0}
            ]
        }],
        "sentences": [],
        "transCues": []
    });
    let blur_profile = std::env::var_os("BCUT_PROFILE_SUBTITLE_BLUR").is_some();
    if blur_profile {
        document["style"]["outline"] = json!(true);
        document["style"]["textOutline"] = json!({"on": true, "color": "#101828", "width": 10});
        document["style"]["glow"] = json!({"on": true, "color": "#40A0FF", "intensity": 55, "range": 8});
        document["style"]["transition"] = json!({"transitionId": "magic-fade", "transitionSpeed": 50});
    }
    let mut cpu_plan = OverlayRenderPlan::compile(&document, PROFILE_W, PROFILE_H, 2.0, 30.0, None).unwrap();
    let mut gpu_plan = OverlayRenderPlan::compile(&document, PROFILE_W, PROFILE_H, 2.0, 30.0, None).unwrap();
    assert_eq!(gpu_plan.active_layouts(0.1)[0].lines.len(), 5);

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.profile.subtitle-target"),
        size: wgpu::Extent3d {
            width: PROFILE_W,
            height: PROFILE_H,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut compositor = Compositor::from_device(device.clone(), queue, backend.clone(), adapter_name.clone());
    let target = || RenderTarget {
        view: &view,
        width: PROFILE_W,
        height: PROFILE_H,
        format: wgpu::TextureFormat::Rgba8Unorm,
    };
    let sample_time = |index: usize| 0.02 + f64::from((index % 30) as u32) / 120.0;

    for index in 0..5 {
        cpu_plan.cache.clear();
        std::hint::black_box(cpu_plan.render_rgba(sample_time(index)).unwrap());
        let scene = gpu_plan.subtitle_scene_frame(sample_time(index)).unwrap();
        compositor.render(&scene.scene, target()).unwrap();
        device.poll(wgpu::PollType::wait_indefinitely()).expect("warm R2 subtitle GPU");
    }

    let mut cpu_samples = Vec::with_capacity(SAMPLE_COUNT);
    let mut gpu_samples = Vec::with_capacity(SAMPLE_COUNT);
    for index in 0..SAMPLE_COUNT {
        let time = sample_time(index);
        cpu_plan.cache.clear();
        let started = std::time::Instant::now();
        std::hint::black_box(cpu_plan.render_rgba(time).unwrap());
        cpu_samples.push(started.elapsed().as_secs_f64() * 1_000.0);

        let started = std::time::Instant::now();
        let scene = gpu_plan.subtitle_scene_frame(time).unwrap();
        compositor.render(&scene.scene, target()).unwrap();
        device
            .poll(wgpu::PollType::wait_indefinitely())
            .expect("finish R2 subtitle GPU frame");
        gpu_samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    let summarize = |samples: &mut Vec<f64>| {
        samples.sort_by(f64::total_cmp);
        let percentile = |q: f64| {
            let index = ((samples.len() as f64 * q).ceil() as usize)
                .saturating_sub(1)
                .min(samples.len() - 1);
            samples[index]
        };
        (
            percentile(0.50),
            percentile(0.95),
            percentile(0.99),
            samples.last().copied().unwrap_or_default(),
        )
    };
    let cpu = summarize(&mut cpu_samples);
    let gpu = summarize(&mut gpu_samples);
    eprintln!(
        "R2 five-line subtitle blur={blur_profile} backend={backend} adapter={adapter_name:?} n={SAMPLE_COUNT} cpu[p50={:.3} p95={:.3} p99={:.3} max={:.3}]ms gpu_scene_submit[p50={:.3} p95={:.3} p99={:.3} max={:.3}]ms",
        cpu.0, cpu.1, cpu.2, cpu.3, gpu.0, gpu.1, gpu.2, gpu.3,
    );
    assert!(gpu.1 <= 12.0, "1080p/five-line subtitle p95 exceeded 12ms");
}

fn assert_vector_frame_matches_cpu(frame: &Arc<FrameOps>, label: &str, inspect: impl FnOnce(&[u8])) {
    let Some((device, queue, backend, adapter_name)) = test_device() else {
        eprintln!("GPU adapter unavailable; skipping {label} conformance test");
        return;
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.compositor.test.vector-conformance-target"),
        size: wgpu::Extent3d {
            width: WIDTH,
            height: HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let scene = SceneFrame {
        nodes: vec![SceneNode::Vectors(frame.clone())],
        next_change: None,
        active_until: None,
        fingerprint: render_raster::fingerprint(frame),
    };
    let mut compositor = Compositor::from_device(device.clone(), queue.clone(), backend, adapter_name);
    compositor
        .render(
            &scene,
            RenderTarget {
                view: &view,
                width: WIDTH,
                height: HEIGHT,
                format: wgpu::TextureFormat::Rgba8Unorm,
            },
        )
        .unwrap_or_else(|error| panic!("GPU {label} render failed: {error:#}"));
    let bytes = diagnostic_readback(&device, &queue, &texture);
    inspect(&bytes);

    let reference =
        rasterize_with_media(frame, WIDTH, HEIGHT, &mut NoMedia).unwrap_or_else(|error| panic!("CPU {label} reference failed: {error:#}"));
    let gpu =
        tiny_skia::Pixmap::from_vec(bytes, tiny_skia::IntSize::from_wh(WIDTH, HEIGHT).unwrap()).expect("GPU premultiplied texture bytes");
    let comparison = imgcmp::compare(&reference, &gpu).expect("same-sized vector frames");
    assert!(comparison.flat_max_deviation <= 2, "{label}: {comparison:?}");
    assert!(comparison.edge_share <= 0.20, "{label}: {comparison:?}");
    assert!(comparison.ssim_downsampled >= 0.98, "{label}: {comparison:?}");
}

fn self_intersecting_star() -> PathData {
    let point = |verb, x, y| PathSeg {
        verb,
        pts: [x, y, 0.0, 0.0, 0.0, 0.0],
    };
    PathData(vec![
        point(0, 32.0, 3.0),
        point(1, 44.3, 41.0),
        point(1, 12.0, 17.5),
        point(1, 52.0, 17.5),
        point(1, 19.7, 41.0),
        PathSeg { verb: 4, pts: [0.0; 6] },
    ])
}

fn sharp_zigzag_path() -> PathData {
    let point = |verb, x, y| PathSeg {
        verb,
        pts: [x, y, 0.0, 0.0, 0.0, 0.0],
    };
    PathData(vec![
        point(0, 8.0, 24.0),
        point(1, 24.0, 8.0),
        point(1, 32.0, 24.0),
        point(1, 40.0, 8.0),
        point(1, 56.0, 24.0),
    ])
}

fn pixel_at(bytes: &[u8], x: u32, y: u32, row_bytes: u32) -> &[u8] {
    let offset = (y * row_bytes + x * 4) as usize;
    &bytes[offset..offset + 4]
}

struct NoMedia;

impl FrameMedia for NoMedia {
    fn frame(&mut self, id: &str, _media_ms: i64) -> anyhow::Result<std::sync::Arc<tiny_skia::Pixmap>> {
        anyhow::bail!("shape conformance must not request media {id}")
    }
}

fn test_device() -> Option<(wgpu::Device, wgpu::Queue, String, String)> {
    let device = try_test_device();
    assert!(
        device.is_some() || std::env::var_os("BAOCUT_REQUIRE_GPU").is_none(),
        "GPU acceptance requires a working adapter/device; skipping is forbidden"
    );
    device
}

fn try_test_device() -> Option<(wgpu::Device, wgpu::Queue, String, String)> {
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
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("bcut.compositor.test"),
        required_limits: adapter.limits(),
        trace: compositor_test_trace(),
        ..Default::default()
    }))
    .ok()?;
    Some((device, queue, format!("{:?}", info.backend).to_lowercase(), info.name))
}

#[cfg(feature = "gpu-trace")]
fn compositor_trace_directory() -> Option<std::path::PathBuf> {
    std::env::var_os("BCUT_WGPU_TRACE_DIR").map(std::path::PathBuf::from)
}

#[cfg(not(feature = "gpu-trace"))]
fn compositor_trace_directory() -> Option<std::path::PathBuf> {
    None
}

#[cfg(feature = "gpu-trace")]
fn compositor_test_trace() -> wgpu::Trace {
    compositor_trace_directory().map(wgpu::Trace::Directory).unwrap_or(wgpu::Trace::Off)
}

#[cfg(not(feature = "gpu-trace"))]
fn compositor_test_trace() -> wgpu::Trace {
    wgpu::Trace::Off
}

/// Readback 是 conformance/诊断特权，只允许出现在测试，不进 `src/gpu.rs`。
fn diagnostic_readback(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture) -> Vec<u8> {
    diagnostic_readback_sized(device, queue, texture, WIDTH, HEIGHT, ROW_BYTES)
}

fn diagnostic_readback_sized(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
    row_bytes: u32,
) -> Vec<u8> {
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("bcut.compositor.test.readback"),
        size: u64::from(row_bytes) * u64::from(height),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("bcut.compositor.test.copy"),
    });
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
                bytes_per_row: Some(row_bytes),
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
    let (sender, receiver) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    device.poll(wgpu::PollType::wait_indefinitely()).expect("poll readback");
    receiver.recv().expect("map callback").expect("map buffer");
    slice.get_mapped_range().expect("mapped range").to_vec()
}

#[test]
fn texture_pool_bounds_all_resize_keys_and_removes_empty_entries() {
    let Some((device, _, _, _)) = test_device() else {
        return;
    };
    let mut pool = compositor::TexturePool::with_idle_budget(device, 2, 1024);
    let usage = wgpu::TextureUsages::RENDER_ATTACHMENT;
    for width in 1..=16 {
        let texture = pool.acquire(width, 16, wgpu::TextureFormat::Rgba8Unorm, usage, 1);
        pool.recycle(texture, width, 16, wgpu::TextureFormat::Rgba8Unorm, usage, 1);
        assert!(pool.idle_bytes() <= 1024);
    }
    let mismatch = pool.acquire(64, 64, wgpu::TextureFormat::Rgba8Unorm, usage, 1);
    pool.recycle(mismatch, 1, 1, wgpu::TextureFormat::Rgba8Unorm, usage, 1);
    assert_eq!(pool.idle_bytes(), 1024);
    let texture = pool.acquire(16, 16, wgpu::TextureFormat::Rgba8Unorm, usage, 1);
    assert_eq!(pool.idle_bytes(), 0);
    assert_eq!(pool.idle_len(), 0);
    drop(texture);
    let oversize = pool.acquire(17, 16, wgpu::TextureFormat::Rgba8Unorm, usage, 1);
    pool.recycle(oversize, 17, 16, wgpu::TextureFormat::Rgba8Unorm, usage, 1);
    assert_eq!(pool.idle_bytes(), 0);
    assert_eq!(pool.idle_len(), 0);
}

#[test]
fn associated_gaussian_matches_cpu_for_boundaries_gamma_and_resizing() {
    use render_raster::effects::component_filters::{
        Axis, Boundary, ComponentImage, GaussianPass, GaussianSampling, Size, SpacingRamp, gaussian,
    };
    let Some((device, queue, _, _)) = test_device() else {
        return;
    };
    let input_size = Size { width: 13, height: 9 };
    let data: Vec<u8> = (0..13 * 9)
        .flat_map(|i| [(i * 37 % 256) as u8, (i * 11 % 256) as u8, 180, if i % 3 == 0 { 0 } else { 70 }])
        .collect();
    let input = ComponentImage::new(13, 9, data.clone()).unwrap();
    let texture = |width, height| {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("component-conformance"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
    };
    let source = texture(13, 9);
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &source,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(52),
            rows_per_image: Some(9),
        },
        wgpu::Extent3d {
            width: 13,
            height: 9,
            depth_or_array_layers: 1,
        },
    );
    let source_view = source.create_view(&Default::default());
    let mut renderer = compositor::ComponentRenderer::new(device.clone(), queue.clone());
    for boundary in [Boundary::Normalize, Boundary::Replicate, Boundary::Transparent] {
        for axis in [Axis::X, Axis::Y] {
            for gamma in [None, Some(2.2)] {
                for count in [0.0, 3.75, 20.0] {
                    for spacing_ramp in [
                        None,
                        Some(SpacingRamp {
                            positive_first: false,
                            domain: [-1.0, 0.5, 15.0, 8.0],
                            axis: Axis::Y,
                            start: 0.2,
                            end: 0.8,
                            reverse: false,
                            previous_sample: false,
                        }),
                        Some(SpacingRamp {
                            positive_first: true,
                            domain: [0.0, -1.0, 13.0, 11.0],
                            axis: Axis::Y,
                            start: 0.1,
                            end: 0.9,
                            reverse: true,
                            previous_sample: true,
                        }),
                        Some(SpacingRamp {
                            positive_first: false,
                            domain: [0.0, 0.0, 13.0, 9.0],
                            axis: Axis::X,
                            start: 0.2,
                            end: 0.6,
                            reverse: false,
                            previous_sample: true,
                        }),
                    ] {
                        for sampling in [
                            None,
                            Some(GaussianSampling {
                                input: [2, 1, 7, 5],
                                output: [1.25, 2.25, 4.5, 6.25],
                            }),
                        ] {
                            let pass = GaussianPass {
                                sampling,
                                spacing_ramp,
                                axis,
                                boundary,
                                gamma,
                                sample_count: count,
                                step_pixels: 0.875,
                                sigma_pixels: 1.3,
                                output: Size { width: 7, height: 11 },
                            };
                            let cpu = gaussian(&input, pass).unwrap();
                            let output = texture(7, 11);
                            let view = output.create_view(&Default::default());
                            let mut encoder = device.create_command_encoder(&Default::default());
                            renderer
                                .encode_gaussian(0, &source_view, input_size, &view, pass, &mut encoder)
                                .unwrap();
                            queue.submit(Some(encoder.finish()));
                            let padded = diagnostic_readback_sized(&device, &queue, &output, 7, 11, 256);
                            let gpu: Vec<u8> = padded.chunks_exact(256).flat_map(|row| row[..28].iter().copied()).collect();
                            let error = gpu.iter().zip(cpu.data()).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
                            assert!(error <= 1, "{axis:?} {boundary:?} gamma={gamma:?} count={count}: max error {error}");
                            assert!(gpu.chunks_exact(4).any(|p| p[2] > p[3]), "emission was clamped to alpha");
                        }
                    }
                }
            }
        }
    }
    let output = texture(7, 11);
    let view = output.create_view(&Default::default());
    let mut encoder = device.create_command_encoder(&Default::default());
    let excessive = GaussianPass {
        sampling: None,
        spacing_ramp: None,
        axis: Axis::X,
        boundary: Boundary::Normalize,
        gamma: None,
        sample_count: 1024.0,
        step_pixels: 1.0,
        sigma_pixels: 10.0,
        output: Size { width: 2048, height: 2048 },
    };
    assert!(
        renderer
            .encode_gaussian(0, &source_view, input_size, &view, excessive, &mut encoder)
            .unwrap_err()
            .to_string()
            .contains("gpu-component-work-budget")
    );
}

#[test]
fn associated_glow_matches_cpu_and_reuses_bounded_intermediates() {
    use render_raster::effects::component_filters::{
        Axis, Boundary, ComponentImage, GaussianPass, GlowComposite, GlowConfig, GlowLevel, Size, cascade_glow,
    };
    let Some((device, queue, _, _)) = test_device() else {
        return;
    };
    let size = Size { width: 13, height: 9 };
    let data: Vec<u8> = (0..13 * 9)
        .flat_map(|i| [(i * 37 % 256) as u8, (i * 11 % 256) as u8, 180, if i % 3 == 0 { 0 } else { 70 }])
        .collect();
    let input = ComponentImage::new(13, 9, data.clone()).unwrap();
    let texture = |label| {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: 13,
                height: 9,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
    };
    let source = texture("glow.source");
    let output = texture("glow.output");
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &source,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(52),
            rows_per_image: Some(9),
        },
        wgpu::Extent3d {
            width: 13,
            height: 9,
            depth_or_array_layers: 1,
        },
    );
    let source_view = source.create_view(&Default::default());
    let view = output.create_view(&Default::default());
    let mut renderer = compositor::GlowRenderer::new(device.clone(), queue.clone());
    let mut cases = 0;
    for levels in [1, 3, 7] {
        for gamma in [1.0, 2.2] {
            for intensity in [0.0, 0.25, 1.8, 16.0] {
                for composite in [GlowComposite::Screen, GlowComposite::SourceOverGlow] {
                    let config = GlowConfig {
                        levels: (0..levels)
                            .map(|i| {
                                let output = Size {
                                    width: (13 >> i).max(1),
                                    height: (9 >> i).max(1),
                                };
                                let pass = |axis| GaussianPass {
                                    sampling: None,
                                    spacing_ramp: None,
                                    axis,
                                    sample_count: 3.75,
                                    step_pixels: 0.875,
                                    sigma_pixels: 1.3,
                                    gamma: Some(gamma),
                                    boundary: Boundary::Replicate,
                                    output,
                                };
                                GlowLevel {
                                    x: pass(Axis::X),
                                    y: pass(Axis::Y),
                                }
                            })
                            .collect(),
                        intensity,
                        gamma,
                        original_opacity: 0.4,
                        glow_tint: [0.9, 0.7, 0.3],
                        glow_color_matrix: [1.0, 0.1, 0.0, 0.1, 0.9, 0.0, 0.0, -0.1, 0.9],
                        gamma_alpha: false,
                        linear: None,
                        composite,
                        output: size,
                    };
                    let cpu = cascade_glow(&input, &config).unwrap().image;
                    for repeat in 0..2 {
                        let allocations = renderer.surface_allocations();
                        let mut encoder = device.create_command_encoder(&Default::default());
                        renderer.encode(0, &source_view, size, &view, &config, &mut encoder).unwrap();
                        queue.submit(Some(encoder.finish()));
                        if repeat == 1 {
                            assert_eq!(renderer.surface_allocations(), allocations, "stable frame allocated textures");
                        }
                        let padded = diagnostic_readback_sized(&device, &queue, &output, 13, 9, 256);
                        let gpu: Vec<u8> = padded.chunks_exact(256).flat_map(|row| row[..52].iter().copied()).collect();
                        let error = gpu.iter().zip(cpu.data()).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
                        assert!(
                            error <= 2,
                            "levels={levels} gamma={gamma} intensity={intensity} {composite:?}: error={error}"
                        );
                    }
                    assert!(renderer.resident_bytes() < 8192);
                    cases += 1;
                }
            }
        }
    }
    assert_eq!(cases, 48);
    renderer.finish_frame(0);
    assert_eq!(renderer.resident_bytes(), 0);
}

#[test]
fn dynamic_caption_material_plan_renders_in_one_gpu_submission() {
    use caption_scene::{Presentation, parse_style};
    use sha2::{Digest, Sha256};
    use subtitle_render::scene::{SceneCue, ScenePlan};
    let Some((device, queue, backend, adapter)) = test_device() else {
        return;
    };
    let mut body: serde_json::Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/glow-cascade.json")).unwrap();
    let c = |v: f64| json!({"kind":"constant","value":v});
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"].as_array_mut().unwrap().extend([
        json!("caption-render-layers/1"),
        json!("caption-image-sequence/1"),
        json!("caption-noisy-sweep/1"),
    ]);
    let glow = scene["materials"].take()[0].clone();
    scene["materials"] = json!([]);
    let noisy = json!({"kind":"noisy-sweep","id":"sweep","contextNodeId":"caption","domain":{"x":c(0.0),"y":c(0.0),"width":c(160.0),"height":c(90.0)},"position":c(0.56),"maskScale":[1,1],"reveal":true,"uvY":"up"});
    let mut png = tiny_skia::Pixmap::new(2, 2).unwrap();
    png.data_mut()
        .copy_from_slice(&[70, 10, 2, 90, 1, 20, 80, 120, 25, 40, 2, 120, 60, 5, 15, 75]);
    let png = png.encode_png().unwrap();
    let digest = Sha256::digest(&png).iter().map(|b| format!("{b:02x}")).collect::<String>();
    scene["sequences"] = json!([{"id":"particles","premultiply":"shifted-byte","frames":[{"id":"frame","assetRef":{"id":"frame","revision":"1"},"contentHash":format!("sha256:{digest}")}]}]);
    scene["renderLayers"] = json!([
        {"id":"letters","source":{"kind":"nodes","nodeIds":["caption"]},"materials":[noisy,glow],"blend":"source-over"},
        {"id":"particles","source":{"kind":"image-sequence","contextNodeId":"caption","sequenceId":"particles","frame":c(0.0),"domain":{"x":c(15.0),"y":c(12.0),"width":c(58.0),"height":c(45.0)},"uvScale":[0.75,1.2],"uvOffset":[0.12,-0.06]},"materials":[],"blend":"screen"}
    ]);
    let mut plan = ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "One two three four".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (160, 90),
        render_raster::TextEngine::with_document_fonts(&[
            include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec()
        ]),
        "gpu-conformance".into(),
    )
    .unwrap();
    plan.load_resources(|_| Some(png.clone())).unwrap();
    let output = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("caption.material.target"),
        size: wgpu::Extent3d {
            width: 160,
            height: 90,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = output.create_view(&Default::default());
    let mut renderer = compositor::CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let mut replay = None;
    let mut warm = None;
    for t in [0.2, 0.9, 2.3, 0.2] {
        let mut cpu = tiny_skia::Pixmap::new(160, 90).unwrap();
        cpu.fill(tiny_skia::Color::from_rgba8(80, 100, 120, 255));
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &output,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            cpu.data(),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(640),
                rows_per_image: Some(90),
            },
            wgpu::Extent3d {
                width: 160,
                height: 90,
                depth_or_array_layers: 1,
            },
        );
        let (layers, _) = plan.render_outputs(t).unwrap();
        for layer in layers {
            let pixmap = tiny_skia::PixmapRef::from_bytes(&layer.rgba, 160, 90).unwrap();
            render_raster::emissive::composite_associated_with_blend(&mut cpu, pixmap, 1.0, [1., 0., 0., 1., 0., 0.], None, layer.blend)
                .unwrap();
        }
        let (frame, _) = plan.record_material_plan(t).unwrap();
        let stats = renderer
            .render(
                &frame,
                RenderTarget {
                    view: &view,
                    width: 160,
                    height: 90,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
                false,
            )
            .unwrap();
        assert_eq!(stats.submissions, 1);
        assert_eq!(stats.material_passes, 2);
        if let Some(fields) = warm {
            assert_eq!(stats.noise_field_uploads, fields, "time changes rebuilt the static noise field");
        } else {
            warm = Some(stats.noise_field_uploads);
        }
        let padded = diagnostic_readback_sized(&device, &queue, &output, 160, 90, 768);
        let gpu: Vec<u8> = padded.chunks_exact(768).flat_map(|row| row[..640].iter().copied()).collect();
        let gpu_image = tiny_skia::Pixmap::from_vec(gpu.clone(), tiny_skia::IntSize::from_wh(160, 90).unwrap()).unwrap();
        let comparison = imgcmp::compare(&cpu, &gpu_image).unwrap();
        assert!(comparison.ssim_downsampled >= 0.98, "time={t}: {comparison:?}");
        if t == 0.2 {
            if let Some(prior) = &replay {
                assert_eq!(&gpu, prior, "out-of-order seek changed GPU pixels");
            } else {
                replay = Some(gpu);
            }
        }
    }
}

#[test]
fn gaussian_local_scene_plan_preserves_two_sampling_grids_in_one_submission() {
    use caption_scene::{Presentation, parse_style};
    use render_raster::drawop::BitmapData;
    use render_raster::effects::{
        component_filters::{ComponentImage, gaussian},
        material_plan::{ImageQuad, MaterialCommand, MaterialSource},
    };
    use subtitle_render::scene::{SceneCue, ScenePlan};
    let Some((device, queue, backend, adapter)) = test_device() else {
        return;
    };
    let mut body: serde_json::Value =
        serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/gaussian-local-sampling.json")).unwrap();
    let c = |v: f64| json!({"kind":"constant","value":v});
    let full = json!({"x":c(0.0),"y":c(0.0),"width":c(160.0),"height":c(90.0)});
    let mut x = body["scene"]["value"]["materials"][0].clone();
    x["id"] = json!("horizontal");
    x["axis"] = json!("x");
    x["sampling"]["output"] = full.clone();
    x["spacingRamp"]["sampleOrder"] = json!("negative-first");
    let mut y = body["scene"]["value"]["materials"][0].clone();
    y["id"] = json!("vertical");
    y["sampling"]["input"] = full.clone();
    y["spacingRamp"]["domain"] = full;
    body["scene"]["value"]["materials"] = json!([x, y]);
    let mut plan = ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Spatial".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (160, 90),
        render_raster::TextEngine::with_document_fonts(&[
            include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec()
        ]),
        "local-grid".into(),
    )
    .unwrap();
    // Replace only the glyph source with frozen diagnostic pixels; the shared
    // scene parser, clock evaluation and material recorder remain real.
    let pixels: Vec<u8> = (0..160 * 90)
        .flat_map(|i| [(i * 37 % 256) as u8, (i * 13 % 256) as u8, 220, 160])
        .collect();
    let bitmap = Arc::new(BitmapData {
        width: 160,
        height: 90,
        rgba: pixels.clone().into(),
    });
    let output = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("gaussian.local-scene"),
        size: wgpu::Extent3d {
            width: 160,
            height: 90,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = output.create_view(&Default::default());
    let mut renderer = compositor::CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend, adapter);
    let mut results = Vec::new();
    let mut resident = None;
    for t in [0.05, 1.0, 3.9, 0.05] {
        let (mut frame, _) = plan.record_material_plan(t).unwrap();
        frame.layers[0].source = MaterialSource::Image(ImageQuad {
            bitmap: bitmap.clone(),
            domain: [0.0, 0.0, 160.0, 90.0],
            uv_scale: [1.0, 1.0],
            uv_offset: [0.0, 0.0],
        });
        let mut cpu = ComponentImage::new(160, 90, pixels.clone()).unwrap();
        for command in &frame.layers[0].materials {
            let MaterialCommand::Gaussian(pass) = command else {
                panic!("Unexpected material")
            };
            cpu = gaussian(&cpu, *pass).unwrap();
        }
        let stats = renderer
            .render(
                &frame,
                RenderTarget {
                    view: &view,
                    width: 160,
                    height: 90,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                },
                true,
            )
            .unwrap();
        assert_eq!(stats.submissions, 1);
        assert_eq!(stats.material_passes, 2);
        if let Some(bytes) = resident {
            assert_eq!(stats.resident_surface_bytes, bytes);
        } else {
            resident = Some(stats.resident_surface_bytes);
        }
        let padded = diagnostic_readback_sized(&device, &queue, &output, 160, 90, 768);
        let gpu: Vec<u8> = padded.chunks_exact(768).flat_map(|row| row[..640].iter().copied()).collect();
        let error = gpu.iter().zip(cpu.data()).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
        assert!(error <= 2, "two-grid mismatch at {t}: max error {error}");
        assert!(gpu.chunks_exact(4).any(|v| v[2] > v[3]), "emission clamped to coverage");
        results.push(gpu);
    }
    assert_ne!(results[0], results[2]);
    assert_eq!(results[0], results[3]);
}
