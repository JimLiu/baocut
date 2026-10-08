//! 运动模糊（`bcut render --motion-blur N`，规范 §15.2）：N = 1 与不开时逐字节、
//! 逐指纹相同；动的内容被子帧平均抹开；静止内容平均后仍逐字节相同，只有指纹换口径。
#![cfg(feature = "media")]

use render_raster::motion_blur::render_frame;
use render_raster::plan::{CpuExecutor, FramePlanner, execute_plan};
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use scene_primitives::resolve::{Ir, Resolver};
use serde_json::{Value, json};
use std::sync::Arc;

const W: u32 = 320;
const H: u32 = 180;

fn doc(animate: Option<Value>) -> Value {
    let mut mover = json!({"type": "box", "id": "mover",
        "style": {"x": 0, "y": 60, "width": 40, "height": 40, "background": "#ffffff"}});
    if let Some(animate) = animate {
        mover["animate"] = animate;
    }
    json!({
        "bcut": "0.1",
        "meta": {"id": "blur-doc", "width": W, "height": H, "fps": 30, "background": "#000000"},
        "scenes": [{"id": "s", "dur": 2}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": {
                "type": "box", "id": "root", "style": {"width": W, "height": H},
                "children": [mover]
            }}
        ]}]
    })
}

fn moving() -> Value {
    doc(Some(json!({"keyframes": [
        {"prop": "x", "frames": [{"t": 0, "v": 0}, {"t": 1, "v": 600}]}
    ]})))
}

fn ir_of(doc: &Value) -> Ir {
    Resolver::new(doc.clone(), None).unwrap().resolve().unwrap()
}

/// 不经运动模糊的参照：planner → FramePlan → CPU 执行。
fn plain(doc: &Value, t: f64) -> (Vec<u8>, u64) {
    let mut ir = ir_of(doc);
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    let plan = planner.plan(&renderer, &ir, &mut engine, t);
    let fp = plan.frame_fingerprint().unwrap();
    let mut executor = CpuExecutor::new(planner.capabilities().clone());
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), ir.fps);
    let pixmap = execute_plan(&plan, &mut executor, &mut media, None).unwrap();
    (pixmap.data().to_vec(), fp)
}

fn blurred(doc: &Value, t: f64, samples: u32) -> anyhow::Result<(Vec<u8>, u64)> {
    let mut ir = ir_of(doc);
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), ir.fps);
    let (pixmap, fp) = render_frame(
        &planner,
        &renderer,
        &ir,
        &mut engine,
        &mut media,
        t,
        samples,
    )?;
    Ok((pixmap.data().to_vec(), fp))
}

/// 既不全黑也不全白的红通道像素数：被子帧平均抹开的边。
fn partial(data: &[u8]) -> usize {
    data.chunks_exact(4)
        .filter(|p| p[0] > 8 && p[0] < 247)
        .count()
}

#[test]
fn one_sample_is_byte_and_fingerprint_identical_to_plain_rendering() {
    let d = moving();
    assert_eq!(blurred(&d, 0.2, 1).unwrap(), plain(&d, 0.2));
}

#[test]
fn moving_content_is_smeared_and_fingerprint_changes() {
    let d = moving();
    let (sharp, sharp_fp) = plain(&d, 0.2);
    let (two, two_fp) = blurred(&d, 0.2, 2).unwrap();
    let (four, four_fp) = blurred(&d, 0.2, 4).unwrap();
    assert_ne!(sharp_fp, two_fp);
    assert_ne!(two_fp, four_fp, "N 进帧指纹");
    assert_ne!(sharp, two);
    // 600 px/s、30 fps、180° 快门 → 子帧跨 10 px：边缘出现半透明过渡带。
    assert!(
        partial(&two) > partial(&sharp) + 100,
        "{} vs {}",
        partial(&two),
        partial(&sharp)
    );
    assert!(partial(&four) > partial(&two), "子帧越多过渡越细");
    // 快门向后开：本帧时刻的位置（x = 120）仍被完整覆盖，左侧不会出现提前的拖影。
    let at = |data: &[u8], x: u32| data[((80 * W + x) * 4) as usize];
    assert_eq!(at(&two, 125), 255);
    assert_eq!(at(&two, 110), 0);
    // 同一时刻重渲逐字节相同。
    assert_eq!(blurred(&d, 0.2, 2).unwrap(), (two, two_fp));
}

#[test]
fn static_content_averages_to_the_same_bytes_under_a_new_fingerprint() {
    let d = doc(None);
    let (sharp, sharp_fp) = plain(&d, 0.5);
    let (four, four_fp) = blurred(&d, 0.5, 4).unwrap();
    assert_eq!(sharp, four);
    assert_ne!(sharp_fp, four_fp, "两种口径的帧指纹不混用");
}

#[test]
fn sample_count_out_of_range_is_rejected() {
    let d = doc(None);
    assert!(blurred(&d, 0.0, 0).is_err());
    assert!(blurred(&d, 0.0, 17).is_err());
}
