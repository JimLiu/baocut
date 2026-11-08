//! 视频里的 mesh-avatar 角色用 CPU 光栅画（`puppet` 的 mesh-avatar 后端，移植自上游的 `avatar.wgsl`）。这里让它和
//! 上游的 wgpu 渲染器（4 倍多重采样）画同一帧，逐像素比较。没有 GPU 时跳过。
//!
//! 缺省用 `puppet::testing` 的合成角色；`BAOCUT_MESH_AVATAR=<.mavatar>` 换成真实角色。

use std::collections::BTreeMap;
use std::io::Cursor;

use mesh_avatar_core::engine::random::SeededRandom;
use mesh_avatar_core::format::AvatarPackage;
use mesh_avatar_core::{Avatar, AvatarOptions};
use mesh_avatar_wgpu::{Fit, Renderer, ViewOptions, headless_device, wgpu};
use puppet::{MeshPackage, testing};

/// 姿势名、参数与表情。
type Pose = (&'static str, Vec<(&'static str, f64)>, &'static str);

/// 一组姿势：静止、转头说话（嘴张开、扁嘴）、低头看一边、眨到一半、笑着脸红。
fn poses() -> Vec<Pose> {
    vec![
        ("rest", vec![], "neutral"),
        ("turn-talk", vec![("angleX", 20.0), ("angleY", -8.0), ("mouthOpen", 0.9), ("mouthForm", -0.8)], "neutral"),
        ("gaze", vec![("angleY", -15.0), ("gazeX", 0.8), ("gazeY", -0.4), ("angleZ", 10.0)], "neutral"),
        ("half-blink", vec![("eyeLOpen", 0.45), ("eyeROpen", 0.45), ("gazeX", -0.6), ("mouthOpen", 0.4)], "neutral"),
        ("smile-blush", vec![("blush", 1.0), ("mouthOpen", 0.7), ("mouthForm", 0.6), ("bodyAngleX", 6.0)], "smile"),
    ]
}

#[test]
fn the_cpu_raster_matches_the_wgpu_renderer() {
    let Ok((device, queue, _)) = pollster::block_on(headless_device()) else {
        eprintln!("GPU adapter unavailable; skipping the CPU / wgpu comparison.");
        return;
    };
    let bytes = match std::env::var_os("BAOCUT_MESH_AVATAR") {
        Some(path) => std::fs::read(path).expect("read BAOCUT_MESH_AVATAR"),
        None => testing::zip(&testing::mesh_avatar_files()),
    };
    let cpu = MeshPackage::from_zip(&bytes).expect("load the package for the CPU raster");
    let [cw, ch] = cpu.canvas();
    // 与画布同样的宽高比：wgpu 的 contain 贴底、CPU 居中，宽高比一样时两边都铺满
    let (w, h) = (360, (360.0 * f64::from(ch) / f64::from(cw)).round() as u32);
    let view = ViewOptions {
        image_size: [cw, ch],
        pad_top: 0.0,
        pad_side: 0.0,
        fit: Fit::Contain,
    };
    let package = AvatarPackage::from_archive(Cursor::new(&bytes)).unwrap();
    let mut template = Avatar::with_rng(package, AvatarOptions::default(), Box::new(SeededRandom::new(0))).unwrap();
    template.set_auto_idle(false);
    template.set_auto_motion(false);
    template.stop_lip_sync();
    let mut renderer = Renderer::new(&device, &queue, wgpu::TextureFormat::Rgba8Unorm, 4, template.textures()).unwrap();
    for (name, params, expression) in poses() {
        let mut avatar = template.clone();
        avatar.set_parameters(params.iter().map(|&(k, v)| (k.to_string(), v)).collect::<BTreeMap<_, _>>());
        avatar.set_expression(expression);
        for _ in 0..90 {
            avatar.step(1.0 / 60.0);
        }
        let frame = avatar.frame();
        let gpu = renderer.render_rgba_premultiplied(&frame, [w, h], &view).unwrap();
        let mut out = vec![0u8; (w * h * 4) as usize];
        puppet::render_mesh_frame(&cpu, &frame, w, h, &mut out);
        let diffs: Vec<u8> = gpu
            .chunks_exact(4)
            .zip(out.chunks_exact(4))
            .map(|(a, b)| (0..4).map(|c| a[c].abs_diff(b[c])).max().unwrap())
            .collect();
        let n = diffs.len() as f64;
        let mean = diffs.iter().map(|&d| f64::from(d)).sum::<f64>() / n;
        let over = |t: u8| diffs.iter().filter(|&&d| d > t).count() as f64 / n;
        let painted = out.chunks_exact(4).filter(|p| p[3] > 0).count();
        eprintln!(
            "{name}: mean {mean:.3}/255, >2: {:.3}%, >16: {:.3}%, >64: {:.4}%, max {}",
            over(2) * 100.0,
            over(16) * 100.0,
            over(64) * 100.0,
            diffs.iter().max().unwrap()
        );
        assert!(painted > (w * h / 4) as usize, "{name}: the CPU raster drew too little");
        assert!(mean < 0.5, "{name}: mean difference {mean}");
        assert!(over(16) < 0.005, "{name}: {}% of pixels differ by more than 16", over(16) * 100.0);
    }
}
