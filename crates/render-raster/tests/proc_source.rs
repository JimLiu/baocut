//! 程序化源 `type:"proc"`（规范 §6.12）：雨 / 溅落 / 夜空。
//!
//! 闭式求值的三条承诺都在这里钉住：同一时刻同一批字节（乱序渲染也一样）、
//! 画面随时间变（帧指纹跟着变）、`seed` 换一个画面就换一个。
#![cfg(feature = "media")]

use render_raster::plan::{CapabilityProfile, CpuExecutor, FramePlanner, execute_plan};
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use scene_primitives::resolve::{Ir, Resolver};
use serde_json::{Value, json};
use std::sync::Arc;

const W: u32 = 320;
const H: u32 = 180;

fn doc(element: Value) -> Value {
    json!({
        "bcut": "0.1",
        "meta": {"id": "proc", "width": W, "height": H, "fps": 30, "background": "#000000"},
        "scenes": [{"id": "s", "dur": 6}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": {
                "type": "box", "id": "root", "style": {"width": W, "height": H},
                "children": [element]
            }}
        ]}]
    })
}

fn ir_of(doc: Value) -> Ir {
    Resolver::new(doc, None).unwrap().resolve().unwrap()
}

/// `(像素, 帧指纹)`。
fn render(doc: &Value, t: f64) -> (Vec<u8>, String) {
    let mut ir = ir_of(doc.clone());
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    let plan = planner.plan(&renderer, &ir, &mut engine, t);
    plan.validate().unwrap();
    let fp = format!("{:?}", plan.frame_fingerprint());
    let mut executor = CpuExecutor::new(CapabilityProfile::cpu_reference());
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), ir.fps);
    let pixmap = execute_plan(&plan, &mut executor, &mut media, None).unwrap();
    (pixmap.data().to_vec(), fp)
}

fn px(data: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * W + x) * 4) as usize;
    [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

/// 比背景（纯黑）亮的像素数，限定在 `[x0, x1) × [y0, y1)`。
fn lit(data: &[u8], (x0, y0, x1, y1): (u32, u32, u32, u32)) -> usize {
    let mut n = 0;
    for y in y0..y1 {
        for x in x0..x1 {
            let p = px(data, x, y);
            if p[0].max(p[1]).max(p[2]) > 12 {
                n += 1;
            }
        }
    }
    n
}

fn rain(seed: u64) -> Value {
    json!({"type": "proc", "id": "rain", "proc": "rain", "seed": seed,
           "params": {"density": 1.0, "length": 0.12, "width": 1.5, "color": "#ffffff"},
           "style": {"x": 40, "y": 20, "width": 200, "height": 120}})
}

#[test]
fn rain_moves_with_time_is_repeatable_and_stays_in_its_box() {
    let d = doc(rain(3));
    let (a0, f0) = render(&d, 0.5);
    let (a1, f1) = render(&d, 0.8);
    assert_ne!(f0, f1, "雨在动，帧指纹必须跟着变");
    assert_ne!(a0, a1);
    // 乱序：先跳到 0.8 再回 0.5，逐字节相同
    let (again, f_again) = render(&d, 0.5);
    assert_eq!((a0.clone(), f0.clone()), (again, f_again));

    let inside = lit(&a0, (40, 20, 240, 140));
    assert!(inside > 150, "盒内应有雨丝：{inside}");
    // 盒外一个亮像素都没有（ClipPath 把越界的雨丝头尾裁掉）
    assert_eq!(lit(&a0, (0, 0, W, 18)), 0);
    assert_eq!(lit(&a0, (242, 0, W, H)), 0);

    let (other_seed, _) = render(&doc(rain(4)), 0.5);
    assert_ne!(a0, other_seed, "换 seed 换画面");
}

#[test]
fn splash_is_one_shot() {
    let d = doc(
        json!({"type": "proc", "id": "sp", "proc": "splash", "seed": 1,
        "params": {"at": 1.0, "x": 0.5, "y": 0.8, "count": 40, "size": 3, "life": 1.0,
                   "color": "#ffffff"}}),
    );
    let (before, f_before) = render(&d, 0.9);
    let (during, f_during) = render(&d, 1.25);
    let (after, f_after) = render(&d, 2.1);
    assert_eq!(lit(&before, (0, 0, W, H)), 0);
    assert_eq!(lit(&after, (0, 0, W, H)), 0);
    assert_eq!(f_before, f_after, "溅落前后都是空画面");
    assert_ne!(f_before, f_during);
    let n = lit(&during, (0, 0, W, H));
    assert!(n > 20, "溅落中应有水珠：{n}");
    // 水珠向上飞：落点线（y = 144）上方有亮像素
    assert!(lit(&during, (0, 0, W, 140)) > 0);
}

fn sky(params: Value) -> Value {
    json!({"type": "proc", "id": "sky", "proc": "sky", "seed": 9, "params": params})
}

#[test]
fn sky_draws_gradient_moon_and_twinkling_stars() {
    let d = doc(sky(json!({"stars": 1.0,
        "moon": {"x": 0.75, "y": 0.3, "r": 0.1, "glow": 0.8, "color": "#f4f1e6"}})));
    let (a, fa) = render(&d, 0.0);
    // 缺省铺满画布；竖向渐变底：底部比顶部亮
    let (top, bottom) = (px(&a, 5, 1), px(&a, 5, H - 2));
    assert!(bottom[2] > top[2], "{top:?} {bottom:?}");
    // 月面中心接近月色
    let moon = px(&a, 240, 54);
    assert!(moon[0] > 200 && moon[1] > 190, "{moon:?}");
    // 光晕：月面外一圈比远处天空亮
    let halo = px(&a, 240 + 28, 54);
    let far = px(&a, 20, 54);
    assert!(halo[0] > far[0] + 20, "{halo:?} vs {far:?}");
    // 星在闪：同一片天空换个时刻画面不同
    let (b, fb) = render(&d, 1.3);
    assert_ne!(fa, fb);
    assert_ne!(a, b);
}

#[test]
fn sky_clouds_drift_and_a_static_sky_keeps_its_fingerprint() {
    // 无星无云：整片天空不随时间变，帧指纹恒定（缓存可复用）
    let still = doc(sky(json!({"stars": 0, "milkyWay": 0.8,
        "moon": {"x": 0.5, "y": 0.4, "r": 0.08}})));
    assert_eq!(render(&still, 0.0).1, render(&still, 2.0).1);

    let cloudy = doc(sky(
        json!({"stars": 0, "cloud": 1.0, "cover": 0.6, "drift": 0.05,
        "top": "rgba(0,0,0,0)", "bottom": "rgba(0,0,0,0)"}),
    ));
    let (a, fa) = render(&cloudy, 0.0);
    let (b, fb) = render(&cloudy, 3.0);
    assert_ne!(fa, fb, "云在飘");
    assert!(
        lit(&a, (0, 0, W, H)) > (W * H / 10) as usize,
        "云量 0.6 应盖住一片天"
    );
    assert_ne!(a, b);
}
