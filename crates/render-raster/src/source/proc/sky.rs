//! `proc:"sky"`：夜空。自下而上五层——竖向渐变底、银河（低分辨率噪声位图）、
//! 闪烁的星、月（光晕 + 月面 + 月海）、飘动的云（逐帧低分辨率噪声位图，
//! 靠近月亮的云边被照亮）。星的闪烁与云的漂移都是 `τ` 的闭式函数。
use super::{circle, color, fill, mat, noise, push_box_clip, rect, unit};
use crate::drawop::{BitmapData, DrawOp, FrameBuilder, GradientStop, PaintData, PathData};
use scene_primitives::Rgba;
use scene_primitives::proc::{MAX_STARS, Moon, Sky};
use std::sync::Arc;
use tiny_skia::Transform;

/// 1080p 盒、stars = 1 时的星数。
const STARS_AT_FULL_HD: f64 = 900.0;
/// 星按亮度分桶：同桶一条 `FillPath`。
const STAR_LEVELS: usize = 8;
/// 噪声位图的长边像素（再由 DrawBitmap 双线性放大到盒子）。
const FIELD_LONG_SIDE: f64 = 256.0;

pub(super) fn record(
    sky: &Sky,
    seed: u64,
    w: f64,
    h: f64,
    time: f64,
    tf: Transform,
    b: &mut FrameBuilder,
) {
    push_box_clip(w, h, tf, b);
    if sky.top.a > 0.0 || sky.bottom.a > 0.0 {
        let mut segs = Vec::new();
        rect(&mut segs, w, h);
        let path = b.path_id(PathData(segs));
        let paint = b.paint_id(PaintData::Linear {
            p0: [0.0, 0.0],
            p1: [0.0, h as f32],
            stops: vec![
                GradientStop {
                    offset: 0.0,
                    color: color(&sky.top, 1.0),
                },
                GradientStop {
                    offset: 1.0,
                    color: color(&sky.bottom, 1.0),
                },
            ],
        });
        b.push(DrawOp::FillPathPaint {
            path,
            paint,
            even_odd: false,
            tf: mat(tf),
        });
    }
    let (fw, fh) = field_size(w, h);
    if sky.milky_way > 0.0 {
        let bitmap = milky_way(sky, seed, fw, fh, w / h);
        draw_field(bitmap, fw, fh, w, h, tf, b);
    }
    stars(sky, seed, w, h, time, tf, b);
    if let Some(moon) = &sky.moon {
        draw_moon(moon, seed, w, h, tf, b);
    }
    if sky.cloud > 0.0 {
        let bitmap = clouds(sky, seed, fw, fh, w, h, time);
        draw_field(bitmap, fw, fh, w, h, tf, b);
    }
    b.push(DrawOp::PopClip);
}

fn field_size(w: f64, h: f64) -> (u32, u32) {
    let scale = FIELD_LONG_SIDE / w.max(h);
    (
        ((w * scale).round() as u32).max(2),
        ((h * scale).round() as u32).max(2),
    )
}

fn draw_field(
    rgba: Vec<u8>,
    fw: u32,
    fh: u32,
    w: f64,
    h: f64,
    tf: Transform,
    b: &mut FrameBuilder,
) {
    let bitmap = b.bitmap_id(BitmapData {
        width: fw,
        height: fh,
        rgba: Arc::from(rgba),
    });
    b.push(DrawOp::DrawBitmap {
        bitmap,
        opacity: 1.0,
        tf: mat(tf.pre_scale((w / f64::from(fw)) as f32, (h / f64::from(fh)) as f32)),
    });
}

fn put(out: &mut Vec<u8>, rgb: [f64; 3], alpha: f64) {
    let a = alpha.clamp(0.0, 1.0);
    for c in rgb {
        out.push((c.clamp(0.0, 1.0) * a * 255.0).round() as u8);
    }
    out.push((a * 255.0).round() as u8);
}

/// 银河：从左下斜贯右上的一条光带，噪声调制亮度，中线偏一点有一道暗尘带。
fn milky_way(sky: &Sky, seed: u64, fw: u32, fh: u32, aspect: f64) -> Vec<u8> {
    let tilt = 0.35 + 0.3 * unit(seed, 0, 0x6D77);
    let mut out = Vec::with_capacity((fw * fh * 4) as usize);
    for j in 0..fh {
        for i in 0..fw {
            let u = (f64::from(i) + 0.5) / f64::from(fw) * aspect;
            let v = (f64::from(j) + 0.5) / f64::from(fh);
            // 到直线 v = 0.85 − tilt·u 的有向距离
            let d = (v - (0.85 - tilt * u)) / libm::sqrt(1.0 + tilt * tilt);
            let band = libm::exp(-(d / 0.13) * (d / 0.13));
            let grain = noise::fbm(seed ^ 0x6D69_6C6B, u * 7.0, v * 7.0, 5);
            let dust = libm::exp(-((d - 0.015) / 0.03) * ((d - 0.015) / 0.03))
                * noise::fbm(seed ^ 0x6475_7374, u * 11.0, v * 11.0, 4);
            let glow = (band * (0.35 + 0.9 * grain) - 0.55 * dust).max(0.0);
            put(&mut out, [0.78, 0.82, 1.0], sky.milky_way * glow * 0.55);
        }
    }
    out
}

fn stars(sky: &Sky, seed: u64, w: f64, h: f64, time: f64, tf: Transform, b: &mut FrameBuilder) {
    let count = ((sky.stars * STARS_AT_FULL_HD * (w * h) / (1920.0 * 1080.0)).round() as usize)
        .min(MAX_STARS);
    if count == 0 {
        return;
    }
    let px = w.min(h) / 1080.0;
    let moon = sky
        .moon
        .as_ref()
        .map(|m| (m.x * w, m.y * h, m.r * w.min(h) * 1.15));
    let mut levels: [Vec<_>; STAR_LEVELS] = Default::default();
    let mut halos = Vec::new();
    for i in 0..count as u64 {
        let (x, y) = (w * unit(seed, i, 11), h * unit(seed, i, 12));
        if let Some((mx, my, mr)) = moon
            && (x - mx) * (x - mx) + (y - my) * (y - my) < mr * mr
        {
            continue;
        }
        let size = unit(seed, i, 13);
        let base = 0.3 + 0.7 * unit(seed, i, 14);
        let rate = 1.2 + 3.0 * unit(seed, i, 15);
        let phase = core::f64::consts::TAU * unit(seed, i, 16);
        // 近地平线（盒底）雾气压暗星光
        let haze = 0.35 + 0.65 * (1.0 - y / h).clamp(0.0, 1.0);
        let twinkle = 0.72 + 0.28 * libm::sin(time * rate + phase);
        let bright = (base * twinkle * haze).clamp(0.0, 1.0);
        let r = (0.55 + 1.5 * size * size * size) * px.max(0.35);
        let level = ((bright * STAR_LEVELS as f64) as usize).min(STAR_LEVELS - 1);
        circle(&mut levels[level], x, y, r, r);
        if size > 0.92 {
            circle(&mut halos, x, y, r * 4.0, r * 4.0);
        }
    }
    let white = Rgba {
        r: 255.0,
        g: 248.0,
        b: 235.0,
        a: 1.0,
    };
    fill(halos, color(&white, 0.1), tf, b);
    for (level, segs) in levels.into_iter().enumerate() {
        let alpha = (level as f64 + 0.5) / STAR_LEVELS as f64;
        fill(segs, color(&white, alpha), tf, b);
    }
}

fn draw_moon(moon: &Moon, seed: u64, w: f64, h: f64, tf: Transform, b: &mut FrameBuilder) {
    let (cx, cy) = (moon.x * w, moon.y * h);
    let r = moon.r * w.min(h);
    if moon.glow > 0.0 {
        let outer = r * (1.0 + 7.0 * moon.glow);
        let k = r / outer;
        let stop = |offset: f64, alpha: f64| GradientStop {
            offset: offset as f32,
            color: color(&moon.color, alpha * moon.glow),
        };
        let mut segs = Vec::new();
        circle(&mut segs, cx, cy, outer, outer);
        let path = b.path_id(PathData(segs));
        let paint = b.paint_id(PaintData::Radial {
            center: [cx as f32, cy as f32],
            radius: outer as f32,
            focus: [cx as f32, cy as f32],
            stops: vec![
                stop(0.0, 0.5),
                stop(k, 0.5),
                stop(k + (1.0 - k) * 0.12, 0.22),
                stop(k + (1.0 - k) * 0.4, 0.07),
                stop(1.0, 0.0),
            ],
        });
        b.push(DrawOp::FillPathPaint {
            path,
            paint,
            even_odd: false,
            tf: mat(tf),
        });
    }
    let mut disc = Vec::new();
    circle(&mut disc, cx, cy, r, r);
    fill(disc.clone(), color(&moon.color, 1.0), tf, b);
    // 月海：裁在月面里的几团暗斑，位置由 seed 定。
    let clip = b.path_id(PathData(disc.clone()));
    b.push(DrawOp::ClipPath {
        path: clip,
        tf: mat(tf),
    });
    let mut maria = Vec::new();
    for i in 0..5u64 {
        let (u, v) = (unit(seed, i, 21) - 0.5, unit(seed, i, 22) - 0.5);
        let s = r * (0.18 + 0.22 * unit(seed, i, 23));
        circle(&mut maria, cx + u * r * 1.1, cy + v * r * 1.1, s, s * 0.85);
    }
    let dark = Rgba {
        r: moon.color.r * 0.72,
        g: moon.color.g * 0.72,
        b: moon.color.b * 0.76,
        a: 1.0,
    };
    fill(maria, color(&dark, 0.35), tf, b);
    // 临边昏暗
    let path = b.path_id(PathData(disc));
    let limb = Rgba {
        r: 40.0,
        g: 40.0,
        b: 60.0,
        a: 1.0,
    };
    let paint = b.paint_id(PaintData::Radial {
        center: [cx as f32, cy as f32],
        radius: r as f32,
        focus: [cx as f32, cy as f32],
        stops: vec![
            GradientStop {
                offset: 0.6,
                color: color(&limb, 0.0),
            },
            GradientStop {
                offset: 1.0,
                color: color(&limb, 0.28),
            },
        ],
    });
    b.push(DrawOp::FillPathPaint {
        path,
        paint,
        even_odd: false,
        tf: mat(tf),
    });
    b.push(DrawOp::PopClip);
}

/// 云：横向拉长的 fbm，`cover` 定阈值，`drift` 让噪声场随时间平移。
fn clouds(sky: &Sky, seed: u64, fw: u32, fh: u32, w: f64, h: f64, time: f64) -> Vec<u8> {
    let aspect = w / h;
    let shift = sky.drift * time * aspect * 2.2;
    let lo = 1.0 - sky.cover - 0.12;
    let hi = 1.0 - sky.cover + 0.22;
    let base = [
        sky.cloud_color.r / 255.0,
        sky.cloud_color.g / 255.0,
        sky.cloud_color.b / 255.0,
    ];
    let moon = sky.moon.as_ref().map(|m| {
        (
            m.x * aspect,
            m.y,
            m.r * w.min(h) / h * 6.0,
            m.glow.max(0.25),
            [m.color.r / 255.0, m.color.g / 255.0, m.color.b / 255.0],
        )
    });
    let mut out = Vec::with_capacity((fw * fh * 4) as usize);
    for j in 0..fh {
        for i in 0..fw {
            let u = (f64::from(i) + 0.5) / f64::from(fw) * aspect;
            let v = (f64::from(j) + 0.5) / f64::from(fh);
            // fbm 值集中在 0.5 附近，先拉开再按云量取阈
            let n = noise::fbm(seed ^ 0x636C_6F75, (u - shift) * 2.2, v * 4.5, 5);
            let n = ((n - 0.5) * 1.8 + 0.5).clamp(0.0, 1.0);
            let t = ((n - lo) / (hi - lo)).clamp(0.0, 1.0);
            let density = t * t * (3.0 - 2.0 * t);
            if density <= 0.0 {
                out.extend_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            // 厚处发暗；靠近月亮的云被照亮，薄边（银边）更亮
            let mut rgb = base.map(|c| c * (1.0 - 0.35 * density));
            if let Some((mx, my, reach, glow, tint)) = moon {
                let d2 = ((u - mx) * (u - mx) + (v - my) * (v - my)) / (reach * reach);
                let lit = libm::exp(-d2) * glow * (1.0 - 0.6 * density);
                for c in 0..3 {
                    rgb[c] += (tint[c] - rgb[c]) * lit.min(1.0);
                }
            }
            put(&mut out, rgb, sky.cloud * density);
        }
    }
    out
}
