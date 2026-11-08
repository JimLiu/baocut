//! 由立绘和 rig 切出动画分层：每只眼睛的眼球、上睫毛、下眼线、双眼皮四层，挖掉眼睛后补好皮肤的
//! 底图，以及头发遮罩。步骤与阈值逐条照搬 mesh-avatar-studio 的 `tools/build-layers.py`。

use std::fs;
use std::path::Path;

use anyhow::{Context, Result, ensure};
use rayon::prelude::*;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::imgops::{
    Gray, Mask, Plane, Rgba, close, connected_components, convolve, dilate, ellipse_mask, erode, fill_hole_from_edges, gaussian_blur,
    gaussian_kernel, kmeans, luminance, median, median3, percentile, polygon_mask, rgb_to_lab, save_gray, save_rgba, stroke_polyline,
};
use crate::rig::{EYE_SAMPLES, EyeCurves, RigView, curves_json, eye_curves, store_eye_curves};

/// 参与构建号的算法版本；改动会影响输出的算法时递增。
const ALGORITHM: &[u8] = b"mesh-avatar-build layers 1";

pub enum LayerImage {
    Rgba(Rgba),
    Gray(Plane<u8>),
}

pub struct LayerBuild {
    pub build: String,
    /// `built/layers.json` 的内容。
    pub meta: Value,
    /// 补上眼睛曲线后的 rig。
    pub rig: Value,
    /// 按写出顺序排列的 `(文件名不带 .png, 图像)`。
    pub images: Vec<(String, LayerImage)>,
}

#[inline]
fn rgb(p: [u8; 4]) -> [f32; 3] {
    [p[0] as f32, p[1] as f32, p[2] as f32]
}

#[inline]
fn max_abs_diff(a: [f32; 3], b: [f32; 3]) -> f32 {
    (a[0] - b[0]).abs().max((a[1] - b[1]).abs()).max((a[2] - b[2]).abs())
}

/// 洞外一圈不透明像素里较亮的那一半的中位色，以及判断“还是皮肤”的容差。
pub fn skin_samples(img: &Rgba, hole: &Mask) -> Result<([f32; 3], f32)> {
    let ring = dilate(hole, 25);
    let pixels: Vec<[f32; 3]> = (0..img.data.len())
        .filter(|&i| ring.data[i] && !hole.data[i] && img.data[i][3] > 200)
        .map(|i| rgb(img.data[i]))
        .collect();
    ensure!(!pixels.is_empty(), "no opaque pixels around a cut-out region to estimate skin");
    let lums: Vec<f32> = pixels.iter().map(|&p| luminance(p)).collect();
    let cut = percentile(&lums, 55.0);
    let light: Vec<[f32; 3]> = pixels.iter().zip(&lums).filter(|(_, l)| **l >= cut).map(|(p, _)| *p).collect();
    let colour = median3(&light);
    let spread = median(&light.iter().map(|&p| max_abs_diff(p, colour)).collect::<Vec<_>>());
    Ok((colour, (spread * 3.0).clamp(22.0, 60.0)))
}

/// 高斯核半径：浮点输入的核宽是 `round(8σ+1)|1`。
fn float_radius(sigma: f64) -> usize {
    crate::imgops::gaussian_ksize(sigma, false) / 2
}

const FILL_SIGMAS: [f64; 5] = [3.0, 6.0, 12.0, 24.0, 48.0];

/// 用周围皮肤的明暗把洞填上：先做多尺度的加权高斯估计，再在洞及洞边的非皮肤像素上做 600 次
/// 3×3 均值迭代（膜方程），最后用 σ=1 的洞边羽化混回原图。透明度不变。
pub fn fill_skin(img: &Rgba, hole: &Mask) -> Result<Rgba> {
    if !hole.any() {
        return Ok(img.clone());
    }
    let (w, h) = (img.width, img.height);
    let (colour, tolerance) = skin_samples(img, hole)?;
    let skin = Mask {
        width: w,
        height: h,
        data: img
            .data
            .par_iter()
            .zip(hole.data.par_iter())
            .map(|(&p, &in_hole)| !in_hole && max_abs_diff(rgb(p), colour) < tolerance && p[3] > 200)
            .collect(),
    };
    let solve = hole.or(&dilate(hole, 17).and_not(&skin));
    let [sx0, sy0, sx1, sy1] = solve.bbox().expect("hole is not empty");
    let (x0, y0) = (sx0.saturating_sub(2), sy0.saturating_sub(2));
    let (x1, y1) = ((sx1 + 2).min(w), (sy1 + 2).min(h));

    // 估计只在求解框里用到；各尺度的影响范围加起来不超过 reach，在扩大 reach 的裁切上算，结果与整图相同。
    let reach: usize = FILL_SIGMAS.iter().map(|&s| float_radius(s)).sum();
    let crop = [
        x0.saturating_sub(reach),
        y0.saturating_sub(reach),
        (x1 + reach).min(w),
        (y1 + reach).min(h),
    ];
    let rect = [crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1]];
    let sub = img.crop(rect);
    let channels: [Gray; 3] = [0, 1, 2].map(|c| sub.map(|p| p[c] as f32));
    let mut known = skin.crop(rect).to_f32();
    let mut est = channels.clone();
    for sigma in FILL_SIGMAS {
        let kernel = gaussian_kernel(crate::imgops::gaussian_ksize(sigma, false), sigma);
        let mut blurred: Vec<Gray> = (0..4)
            .into_par_iter()
            .map(|c| {
                if c == 3 {
                    convolve(&known, &kernel)
                } else {
                    convolve(&channels[c].zip(&known, |a, k| a * k), &kernel)
                }
            })
            .collect();
        let den = blurred.pop().unwrap();
        for i in 0..known.data.len() {
            if known.data[i] == 0.0 && den.data[i] > 0.02 {
                let d = den.data[i].max(1e-4);
                for c in 0..3 {
                    est[c].data[i] = blurred[c].data[i] / d;
                }
                known.data[i] = 0.5;
            }
        }
    }

    // 膜方程迭代，只更新求解像素，其余像素固定。
    let (bw, bh) = (x1 - x0, y1 - y0);
    let mut cur: Vec<[f32; 3]> = Vec::with_capacity(bw * bh);
    let mut solving = Vec::new();
    for y in y0..y1 {
        for x in x0..x1 {
            let i = y * w + x;
            let local = (y - rect[1]) * rect[2] + (x - rect[0]);
            if solve.data[i] {
                solving.push(cur.len());
                cur.push([est[0].data[local], est[1].data[local], est[2].data[local]]);
            } else {
                cur.push(rgb(img.data[i]));
            }
        }
    }
    let reflect = |i: isize, n: usize| -> usize {
        if n == 1 {
            0
        } else if i < 0 {
            (-i) as usize
        } else if i as usize >= n {
            2 * n - 2 - i as usize
        } else {
            i as usize
        }
    };
    for _ in 0..600 {
        let next: Vec<[f32; 3]> = solving
            .par_iter()
            .map(|&j| {
                let (x, y) = ((j % bw) as isize, (j / bw) as isize);
                let mut sum = [0f32; 3];
                for dy in -1..=1 {
                    let row = reflect(y + dy, bh) * bw;
                    for dx in -1..=1 {
                        let p = cur[row + reflect(x + dx, bw)];
                        for c in 0..3 {
                            sum[c] += p[c];
                        }
                    }
                }
                sum.map(|s| s * (1.0 / 9.0))
            })
            .collect();
        for (&j, value) in solving.iter().zip(next) {
            cur[j] = value;
        }
    }

    // σ=1 的洞边羽化；它只在洞外 4 像素内不为零。
    let fx0 = x0.saturating_sub(5);
    let fy0 = y0.saturating_sub(5);
    let fx1 = (x1 + 5).min(w);
    let fy1 = (y1 + 5).min(h);
    let feather_rect = [fx0, fy0, fx1 - fx0, fy1 - fy0];
    let k = gaussian_blur(&hole.crop(feather_rect).to_f32(), 1.0, false);
    let mut res = img.clone();
    for y in fy0..fy1 {
        for x in fx0..fx1 {
            let i = y * w + x;
            let kk = k.data[(y - fy0) * feather_rect[2] + (x - fx0)];
            let original = rgb(img.data[i]);
            let out = if (x0..x1).contains(&x) && (y0..y1).contains(&y) {
                cur[(y - y0) * bw + (x - x0)]
            } else {
                original
            };
            for c in 0..3 {
                let v = original[c] * (1.0 - kk) + out[c] * kk;
                res.data[i][c] = v.clamp(0.0, 255.0) as u8;
            }
        }
    }
    Ok(res)
}

struct EyeClasses {
    ball: Mask,
    lash: Mask,
    low: Mask,
    crease: Mask,
    stray: Mask,
    core: Mask,
    white: Mask,
}

/// numpy `interp`：两端外取端点值。
fn interp(x: f64, xp: &[f64], fp: &[f64]) -> f64 {
    if x <= xp[0] {
        return fp[0];
    }
    if x >= xp[xp.len() - 1] {
        return fp[fp.len() - 1];
    }
    let j = xp.partition_point(|&v| v <= x) - 1;
    let t = (x - xp[j]) / (xp[j + 1] - xp[j]);
    fp[j] + t * (fp[j + 1] - fp[j])
}

fn eye_classes(img: &Rgba, opening: &[[f64; 2]], roi: &[[f64; 2]], c: &EyeCurves) -> Result<EyeClasses> {
    let (w, h) = (img.width, img.height);
    let step = (c.x1 - c.x0) / (EYE_SAMPLES - 1) as f64;
    let mut xp: Vec<f64> = (0..EYE_SAMPLES).map(|i| c.x0 + step * i as f64).collect();
    xp[EYE_SAMPLES - 1] = c.x1;
    let top: Vec<f64> = (0..w).map(|x| interp(x as f64, &xp, &c.top)).collect();
    let corner: Vec<f64> = (0..w)
        .map(|x| interp(x as f64, &[c.x0, c.x1], &[c.top[0], c.top[EYE_SAMPLES - 1]]))
        .collect();
    let region = polygon_mask(w, h, roi);
    let core = polygon_mask(w, h, opening);
    let est_img = fill_skin(img, &region)?;
    let n = w * h;
    let lum: Vec<f32> = img.data.par_iter().map(|&p| luminance(rgb(p))).collect();
    let est_lum: Vec<f32> = est_img.data.par_iter().map(|&p| luminance(rgb(p))).collect();
    let opaque = |i: usize| img.data[i][3] > 0;
    let skin: Vec<bool> = (0..n)
        .into_par_iter()
        .map(|i| max_abs_diff(rgb(img.data[i]), rgb(est_img.data[i])) < 22.0)
        .collect();
    let ink: Vec<bool> = (0..n).map(|i| region.data[i] && !skin[i] && !core.data[i] && opaque(i)).collect();
    let core_px: Vec<usize> = (0..n).filter(|&i| core.data[i] && opaque(i)).collect();
    ensure!(!core_px.is_empty(), "eye opening has no source pixels");
    let core_lum: Vec<f32> = core_px.iter().map(|&i| lum[i]).collect();
    let bright = percentile(&core_lum, 85.0);
    let white_colour = median3(
        &core_px
            .iter()
            .filter(|&&i| lum[i] >= bright)
            .map(|&i| rgb(img.data[i]))
            .collect::<Vec<_>>(),
    );
    let white = Mask {
        width: w,
        height: h,
        data: (0..n)
            .into_par_iter()
            .map(|i| max_abs_diff(rgb(img.data[i]), white_colour) < 20.0 && lum[i] > est_lum[i])
            .collect(),
    };
    let dark = percentile(
        &(0..n).filter(|&i| region.data[i] && opaque(i)).map(|i| lum[i]).collect::<Vec<_>>(),
        10.0,
    );
    let light = median(&(0..n).filter(|&i| region.data[i]).map(|i| est_lum[i]).collect::<Vec<_>>());
    let mut lash = Mask::empty(w, h);
    let mut low = Mask::empty(w, h);
    let mut crease = Mask::empty(w, h);
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if !ink[i] || white.data[i] {
                continue;
            }
            let (yf, xf) = (y as f64, x as f64);
            let inside_x = xf >= c.x0 && xf <= c.x1;
            let upper = if inside_x { yf <= top[x] + 3.0 } else { yf <= corner[x] + 2.0 };
            let is_crease = inside_x && yf < top[x] - 9.0 && lum[i] > (light + dark) / 2.0;
            if is_crease {
                crease.data[i] = true;
            } else if upper {
                lash.data[i] = true;
            }
            if !upper {
                low.data[i] = true;
            }
        }
    }
    let ball = dilate(&core, 3);
    let stray = Mask {
        width: w,
        height: h,
        data: (0..n).map(|i| ink[i] && white.data[i] && !ball.data[i]).collect(),
    };
    Ok(EyeClasses {
        ball,
        lash,
        low,
        crease,
        stray,
        core,
        white,
    })
}

/// 线条区域里最暗那一成像素的中位色；没有像素时退回皮肤色。
fn infer_ink(img: &Rgba, mask: &Mask, skin: [f32; 3]) -> [f32; 3] {
    let pixels: Vec<[f32; 3]> = (0..img.data.len())
        .filter(|&i| mask.data[i] && img.data[i][3] > 200)
        .map(|i| rgb(img.data[i]))
        .collect();
    if pixels.is_empty() {
        return skin;
    }
    let lums: Vec<f32> = pixels.iter().map(|&p| luminance(p)).collect();
    let cut = percentile(&lums, 10.0);
    median3(
        &pixels
            .iter()
            .zip(&lums)
            .filter(|(_, l)| **l <= cut)
            .map(|(p, _)| *p)
            .collect::<Vec<_>>(),
    )
}

/// 把画在皮肤上的线条拆成能叠回皮肤的 RGBA：线条边缘保留抗锯齿，不带旧背景的光晕。
fn unblend(img: &Rgba, skin: &Rgba, mask: &Mask, ink: [f32; 3]) -> Rgba {
    let data = img
        .data
        .par_iter()
        .zip(skin.data.par_iter())
        .zip(mask.data.par_iter())
        .map(|((&o, &s), &m)| {
            let (orig, sk) = (rgb(o), rgb(s));
            let mut a = f32::NEG_INFINITY;
            for c in 0..3 {
                a = a.max((sk[c] - orig[c]) / (sk[c] - ink[c]).max(1.0));
            }
            let a = if m { a.clamp(0.0, 1.0) } else { 0.0 };
            let mut out = [0u8; 4];
            for c in 0..3 {
                out[c] = ((orig[c] - sk[c] * (1.0 - a)) / a.max(1e-3)).clamp(0.0, 255.0) as u8;
            }
            out[3] = (a * 255.0) as u8;
            out
        })
        .collect();
    Plane {
        width: img.width,
        height: img.height,
        data,
    }
}

/// 遮罩外接框四周加 `pad` 后裁出图层，框外透明度清零；返回图像与 `[x, y, w, h]`。
fn crop_layer(img: &Rgba, mask: &Mask, pad: usize) -> (Rgba, [usize; 4]) {
    let Some([bx0, by0, bx1, by1]) = mask.bbox() else {
        return (Rgba::filled(1, 1, [0; 4]), [0, 0, 1, 1]);
    };
    let x0 = bx0.saturating_sub(pad);
    let y0 = by0.saturating_sub(pad);
    let x1 = (bx1 + pad).min(img.width);
    let y1 = (by1 + pad).min(img.height);
    let rect = [x0, y0, x1 - x0, y1 - y0];
    let mut layer = img.crop(rect);
    let m = mask.crop(rect);
    for (p, &keep) in layer.data.iter_mut().zip(&m.data) {
        if !keep {
            p[3] = 0;
        }
    }
    (layer, rect)
}

fn lab_distance(colours: &[[f32; 3]], value: [f32; 3]) -> f32 {
    colours
        .iter()
        .map(|c| ((value[0] - c[0]).powi(2) + (value[1] - c[1]).powi(2) + (value[2] - c[2]).powi(2)).sqrt())
        .fold(f32::INFINITY, f32::min)
}

fn palette(values: &[[f32; 3]], count: usize) -> Vec<[f32; 3]> {
    let stride = (values.len() / 12000).max(1);
    let sampled: Vec<[f32; 3]> = values.iter().step_by(stride).copied().collect();
    kmeans(&sampled, count, 40, 0.1)
}

fn ellipse_of(w: usize, h: usize, e: &crate::rig::Ellipse) -> Mask {
    ellipse_mask(w, h, e.cx, e.cy, e.rx, e.ry)
}

/// 从发束取样的头发颜色在头部范围里生长出头发遮罩，排除皮肤和衣服。
pub fn hair_mask(img: &Rgba, rig: &RigView) -> Result<Plane<u8>> {
    let (w, h) = (img.width, img.height);
    let n = w * h;
    let mut sample = Mask::empty(w, h);
    let mut scope = ellipse_of(w, h, &rig.head);
    let mut blur = 9.0f64;
    for strand in &rig.strands {
        stroke_polyline(&mut sample, &strand.nodes, strand.sigma.round_ties_even().max(3.0));
        stroke_polyline(&mut scope, &strand.nodes, (strand.sigma * 6.0).round_ties_even().max(3.0));
        blur = blur.max(strand.max * 1.2);
    }
    for bun in &rig.buns {
        scope.or_assign(&ellipse_of(w, h, bun));
        let centre = crate::rig::Ellipse {
            rx: bun.rx * 0.5,
            ry: bun.ry * 0.5,
            ..*bun
        };
        sample.or_assign(&ellipse_of(w, h, &centre));
    }
    let scope = dilate(&scope, 19);
    let mut excluded = Mask::empty(w, h);
    for eye in &rig.eyes {
        excluded.or_assign(&polygon_mask(w, h, &eye.roi));
    }
    for e in [&rig.brow, &rig.mouth_face, &rig.nose] {
        excluded.or_assign(&ellipse_of(w, h, e));
    }
    let opaque = |i: usize| img.data[i][3] > 200;
    let lab: Vec<[f32; 3]> = img.data.par_iter().map(|p| rgb_to_lab([p[0], p[1], p[2]])).collect();
    let sampling: Vec<bool> = (0..n).map(|i| sample.data[i] && opaque(i) && !excluded.data[i]).collect();
    let mut pixels: Vec<[f32; 3]> = (0..n).filter(|&i| sampling[i]).map(|i| lab[i]).collect();
    if pixels.is_empty() {
        return Ok(Plane::filled(w, h, 0u8));
    }
    // Lab 能把棕色阴影和同样暗的中性色衣服分开；聚几种发色，而不是用一个宽的 RGB 容差把两者都收进来。
    let cut = percentile(&pixels.iter().map(|p| p[0]).collect::<Vec<_>>(), 90.0);
    pixels.retain(|p| p[0] <= cut);
    let hair_colours = palette(&pixels, 8);
    let hair_d: Vec<f32> = lab.par_iter().map(|&v| lab_distance(&hair_colours, v)).collect();
    let spread = percentile(&pixels.iter().map(|&v| lab_distance(&hair_colours, v)).collect::<Vec<_>>(), 95.0);
    let tolerance = (spread * 1.5).clamp(16.0, 35.0);
    let mut body = ellipse_of(w, h, &rig.chest);
    for s in &rig.shoulders {
        body.or_assign(&ellipse_of(w, h, s));
    }
    let negative: Vec<[f32; 3]> = (0..n)
        .filter(|&i| body.data[i] && !scope.data[i] && opaque(i))
        .map(|i| lab[i])
        .collect();
    let mut other: Vec<[f32; 3]> = Vec::new();
    for eye in &rig.eyes {
        let (colour, _) = skin_samples(img, &polygon_mask(w, h, &eye.roi))?;
        other.push(rgb_to_lab(colour.map(|c| c as u8)));
    }
    if !negative.is_empty() {
        other.extend(palette(&negative, 8));
    }
    let not_hair: Vec<bool> = lab
        .par_iter()
        .zip(hair_d.par_iter())
        .map(|(&v, &d)| lab_distance(&other, v) < d)
        .collect();
    let candidate = Mask {
        width: w,
        height: h,
        data: (0..n)
            .map(|i| hair_d[i] < tolerance && scope.data[i] && opaque(i) && !excluded.data[i] && !not_hair[i])
            .collect(),
    };
    let mut candidate = close(&candidate, 5);
    for (i, c) in candidate.data.iter_mut().enumerate() {
        if excluded.data[i] || !scope.data[i] || !opaque(i) || not_hair[i] {
            *c = false;
        }
    }
    let (labels, components) = connected_components(&candidate);
    let mut seeded = vec![false; components.len() + 1];
    for i in 0..n {
        if sampling[i] && candidate.data[i] {
            seeded[labels.data[i] as usize] = true;
        }
    }
    seeded[0] = false;
    let mut mask = Mask {
        width: w,
        height: h,
        data: labels.data.iter().map(|&l| seeded[l as usize]).collect(),
    };
    // 被头发包住的小块阴影和高光也算头发；皮肤和颜色不同的亮色挂件仍排除在外。
    let (holes, hole_stats) = connected_components(&mask.not());
    let max_hole = (rig.head.rx * rig.head.ry * 0.03).max(64.0);
    let fillable: Vec<bool> = std::iter::once(false)
        .chain(
            hole_stats
                .iter()
                .map(|c| !(c.x0 == 0 || c.y0 == 0 || c.x1 == w || c.y1 == h || c.area as f64 > max_hole)),
        )
        .collect();
    let filled: Vec<bool> = (0..n)
        .map(|i| fillable[holes.data[i] as usize] && hair_d[i] < tolerance * 2.0 && !excluded.data[i] && opaque(i))
        .collect();
    for (m, &f) in mask.data.iter_mut().zip(&filled) {
        *m |= f;
    }
    let blurred = gaussian_blur(&mask.map(|v| if v { 255.0 } else { 0.0 }), blur, true);
    let mut out = blurred.map(|v| v as u8);
    for i in 0..n {
        if excluded.data[i] || !scope.data[i] || (not_hair[i] && !filled[i]) || hair_d[i] >= tolerance * 2.0 || img.data[i][3] == 0 {
            out.data[i] = 0;
        }
    }
    Ok(out)
}

/// 读 `source.png` 与 rig，算出全部分层（不写文件）。
pub fn build_layers(source_bytes: &[u8], rig_bytes: &[u8]) -> Result<LayerBuild> {
    let mut img = crate::imgops::from_image(
        image::load_from_memory_with_format(source_bytes, image::ImageFormat::Png)
            .context("source.png must be a PNG")?
            .into_rgba8(),
    );
    let mut rig_value: Value = serde_json::from_slice(rig_bytes).context("rig: invalid JSON")?;
    let (w, h) = (img.width, img.height);
    let rig = RigView::parse(&rig_value, w, h)?;
    for (i, eye) in rig.eyes.iter().enumerate() {
        let core = polygon_mask(w, h, &eye.opening);
        let region = polygon_mask(w, h, &eye.roi);
        ensure!(core.and(&region).any(), "eyes[{i}].roi must overlap opening");
        ensure!(
            (0..w * h).any(|j| core.data[j] && img.data[j][3] > 0),
            "eyes[{i}].opening has no source pixels"
        );
    }
    for p in &mut img.data {
        if p[3] > 240 {
            p[3] = 255;
        }
    }
    let build = {
        let mut hasher = Sha256::new();
        hasher.update(source_bytes);
        hasher.update(rig_bytes);
        hasher.update(ALGORITHM);
        let digest = hasher.finalize();
        digest.iter().map(|b| format!("{b:02x}")).collect::<String>()[..12].to_owned()
    };

    let mut eye_hole = Mask::empty(w, h);
    let mut curves = Vec::new();
    let mut parts = Vec::new();
    for eye in &rig.eyes {
        let c = eye_curves(&eye.opening)?;
        let classes = eye_classes(&img, &eye.opening, &eye.roi, &c)?;
        let mut taken = erode(&classes.core, 3);
        let region = polygon_mask(w, h, &eye.roi);
        let region_grown = dilate(&region, 5);
        let (skin, _) = skin_samples(&img, &region)?;
        let mut lines = Vec::new();
        for (name, mask) in [("lash", &classes.lash), ("low", &classes.low), ("crease", &classes.crease)] {
            let ink = infer_ink(&img, mask, skin);
            let line = dilate(mask, 5).and_not(&taken).and(&region_grown);
            taken.or_assign(&line);
            lines.push((name, line, ink));
        }
        let near = dilate(&classes.core, 15).and_not(&classes.core);
        eye_hole.or_assign(&taken);
        eye_hole.or_assign(&classes.core);
        eye_hole.or_assign(&classes.stray);
        eye_hole.or_assign(&classes.white.and(&near));
        parts.push((classes.ball, lines));
        curves.push(c);
    }
    let skin_under = fill_skin(&img, &eye_hole)?;
    let mut images = Vec::new();
    let mut rects = serde_json::Map::new();
    for (i, (ball, lines)) in parts.into_iter().enumerate() {
        let (layer, rect) = crop_layer(&img, &ball, 3);
        rects.insert(format!("eye{i}_ball"), json!(rect));
        images.push((format!("eye{i}_ball"), LayerImage::Rgba(layer)));
        for (name, mask, ink) in lines {
            let mut full = unblend(&img, &skin_under, &mask, ink);
            let edge = gaussian_blur(&mask.to_f32(), 0.7, false);
            for (p, &e) in full.data.iter_mut().zip(&edge.data) {
                p[3] = (p[3] as f32 * (e * 1.6).clamp(0.0, 1.0)) as u8;
            }
            let visible = full.map(|p| p[3] > 0);
            let (layer, rect) = crop_layer(&full, &visible, 2);
            rects.insert(format!("eye{i}_{name}"), json!(rect));
            images.push((format!("eye{i}_{name}"), LayerImage::Rgba(layer)));
        }
    }
    let curves: [EyeCurves; 2] = [curves[0].clone(), curves[1].clone()];
    store_eye_curves(&mut rig_value, &curves)?;

    let base = fill_skin(&fill_hole_from_edges(&img, &eye_hole), &eye_hole)?;
    images.insert(0, ("base".into(), LayerImage::Rgba(base)));
    images.insert(1, ("hairmask".into(), LayerImage::Gray(hair_mask(&img, &rig)?)));
    let meta = json!({
        "size": [w, h],
        "build": build,
        "layers": rects,
        "eyes": [curves_json(&curves[0]), curves_json(&curves[1])],
        "version": 1,
    });
    Ok(LayerBuild {
        build,
        meta,
        rig: rig_value,
        images,
    })
}

/// 把分层写进 `<avatar>/built/`，补好曲线的 rig 写成 `<avatar>/rig.json`。已有的 sprite 与其他文件不动。
pub fn write_layers(result: &LayerBuild, avatar: &Path) -> Result<()> {
    let built = avatar.join("built");
    fs::create_dir_all(&built).with_context(|| format!("cannot create {}", built.display()))?;
    for (name, image) in &result.images {
        let path = built.join(format!("{name}.png"));
        match image {
            LayerImage::Rgba(p) => save_rgba(&path, p)?,
            LayerImage::Gray(p) => save_gray(&path, p)?,
        }
    }
    let pretty = |v: &Value| -> Result<String> { Ok(serde_json::to_string_pretty(v)? + "\n") };
    fs::write(built.join("layers.json"), pretty(&result.meta)?)?;
    fs::write(avatar.join("rig.json"), pretty(&result.rig)?)?;
    Ok(())
}
