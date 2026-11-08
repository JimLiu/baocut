//! 导入画好的整张变体图（闭眼、半闭、笑眼、口型……），检查遮罩外有没有被改动，再切成带羽化边的
//! sprite。照搬 mesh-avatar-studio 的 `tools/build-sprites.py`；图像整体偏移的估计改成在 ±6 像素内
//! 逐个整数偏移比较差异（原工具用 OpenCV 的相位相关）。

use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use rayon::prelude::*;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::imgops::{Mask, Rgba, connected_components, distance_to_false, from_image, median, save_rgba};
use crate::variants::{all_variants, edit_masks, is_eye_variant};

// 图像生成模型常把整张图重新编码、挪一两个像素，或把透明背景填上颜色。sprite 只取遮罩里的像素，
// 只要还是同一张画，就能只按遮罩导入：下面是整体偏移、不透明像素差异和遮罩外一圈的上限。
const MAX_SHIFT: i32 = 3;
const SEARCH_SHIFT: i32 = 6;
const MAX_OPAQUE_MEAN: f32 = 16.0;
const RING: f32 = 12.0;
const MAX_RING_MEAN: f32 = 20.0;
const MAX_RING_SHARE: f32 = 0.12;
const RING_LEVEL: f32 = 48.0;
// 模型还会给整张图轻微偏色；在平的皮肤上几个色阶也会显出一块。偏色在遮罩边缘内侧量，那里的皮肤本该不变。
const TINT_BAND: f32 = 10.0;
const MAX_TINT: f32 = 24.0;
// 有些立绘的皮肤略低于完全不透明（示例里是 253），所以“不透明”不能只算 255。
const OPAQUE_ALPHA: u8 = 240;

/// 一次 sprite 构建的结果。
pub struct SpriteBuild {
    pub build: String,
    pub layers: Vec<(String, [usize; 4], Rgba)>,
    pub log: Vec<String>,
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
}

fn load_png(path: &Path) -> Result<image::RgbaImage> {
    let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    ensure!(is_png(&bytes), "{}: expected a PNG", path.display());
    Ok(image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .with_context(|| format!("cannot decode {}", path.display()))?
        .into_rgba8())
}

fn load_mask(path: &Path, width: usize, height: usize) -> Result<Mask> {
    let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let image = from_image(load_png(path)?);
    ensure!(
        (image.width, image.height) == (width, height),
        "{name}: mask size must match source.png"
    );
    ensure!(
        image.data.iter().all(|p| p[3] == 0 || p[3] == 255),
        "{name}: use a binary alpha edit mask (0 editable, 255 protected)"
    );
    Ok(image.map(|p| p[3] == 0))
}

/// 变体的编辑区域：优先用 `variant-requests/<name>/mask.png`，没有就按 rig 现算；眼睛按 x 从左到右分成两块。
fn regions(project: &Path, rig: &Value, width: usize, height: usize, name: &str) -> Result<Vec<Mask>> {
    let path = project.join("variant-requests").join(name).join("mask.png");
    let legacy = project.join("variant-masks").join(if is_eye_variant(name) {
        "eyes_edit_mask.png"
    } else {
        "mouth_edit_mask.png"
    });
    let chosen = [path, legacy].into_iter().find(|p| p.exists());
    if let Some(path) = chosen {
        let region = load_mask(&path, width, height)?;
        if !is_eye_variant(name) {
            return Ok(vec![region]);
        }
        let (labels, components) = connected_components(&region);
        ensure!(
            components.len() == 2,
            "{name}: expected two separate eye mask regions, got {}",
            components.len()
        );
        let mut order: Vec<usize> = (0..2).collect();
        order.sort_by(|&a, &b| {
            let mean = |c: usize| components[c].sum_x / components[c].area as f64;
            mean(a).total_cmp(&mean(b))
        });
        return Ok(order.into_iter().map(|c| labels.map(|l| l == c as u32 + 1)).collect());
    }
    let (eyes, mouth) = edit_masks(rig, width, height)?;
    Ok(if is_eye_variant(name) { eyes.to_vec() } else { vec![mouth] })
}

fn visible(p: [u8; 4]) -> [f32; 4] {
    let a = p[3] as f32 / 255.0;
    [p[0] as f32 * a, p[1] as f32 * a, p[2] as f32 * a, p[3] as f32]
}

fn rgb_difference(a: [u8; 4], b: [u8; 4]) -> f32 {
    (0..3).map(|c| (a[c] as f32 - b[c] as f32).abs()).fold(0.0, f32::max)
}

fn mean(values: impl Iterator<Item = f32>) -> f32 {
    let (sum, count) = values.fold((0f64, 0usize), |(s, n), v| (s + v as f64, n + 1));
    if count == 0 { f32::NAN } else { (sum / count as f64) as f32 }
}

/// 平移后的变体（最近邻，边缘复制），即 `moved(x, y) = variant(x + sx, y + sy)`。
fn shifted(variant: &Rgba, sx: i32, sy: i32) -> Rgba {
    let (w, h) = (variant.width as i32, variant.height as i32);
    let mut out = variant.clone();
    out.data.par_chunks_mut(variant.width).enumerate().for_each(|(y, row)| {
        let yy = (y as i32 + sy).clamp(0, h - 1) as usize;
        for (x, p) in row.iter_mut().enumerate() {
            let xx = (x as i32 + sx).clamp(0, w - 1) as usize;
            *p = variant.data[yy * variant.width + xx];
        }
    });
    out
}

/// 只按遮罩导入：先找整体偏移，再检查遮罩外的差异；通过时返回对齐后的变体，透明度取原图，遮罩内去掉偏色。
fn mask_only(name: &str, variant: Rgba, source: &Rgba, region: &Mask, log: &mut Vec<String>) -> Result<Rgba> {
    let n = source.data.len();
    let opaque: Vec<bool> = source.data.iter().map(|p| p[3] >= OPAQUE_ALPHA).collect();
    let rest: Vec<usize> = (0..n).filter(|&i| opaque[i] && !region.data[i]).collect();
    ensure!(
        !rest.is_empty(),
        "{name}: rejected outside-mask changes: no opaque pixels outside the mask"
    );
    // 在稀疏取样的遮罩外像素上逐个比较整数偏移。
    let probe: Vec<usize> = rest.iter().step_by(7).copied().collect();
    let w = source.width as i32;
    let h = source.height as i32;
    let score = |sx: i32, sy: i32| -> f32 {
        let sum: f64 = probe
            .par_iter()
            .map(|&i| {
                let (x, y) = ((i % source.width) as i32, (i / source.width) as i32);
                let j = ((y + sy).clamp(0, h - 1) * w + (x + sx).clamp(0, w - 1)) as usize;
                rgb_difference(variant.data[j], source.data[i]) as f64
            })
            .sum();
        (sum / probe.len() as f64) as f32
    };
    let mut best = (0, 0, score(0, 0));
    for sy in -SEARCH_SHIFT..=SEARCH_SHIFT {
        for sx in -SEARCH_SHIFT..=SEARCH_SHIFT {
            let s = score(sx, sy);
            if s < best.2 {
                best = (sx, sy, s);
            }
        }
    }
    let (mut sx, mut sy, _) = best;
    if sx.abs().max(sy.abs()) > MAX_SHIFT {
        bail!(
            "{name}: rejected outside-mask changes: the whole image is shifted by {sx:+}, {sy:+} px (limit {MAX_SHIFT} px); return it unshifted"
        );
    }
    let difference = |image: &Rgba| -> Vec<f32> {
        image
            .data
            .par_iter()
            .zip(source.data.par_iter())
            .map(|(&a, &b)| rgb_difference(a, b))
            .collect()
    };
    let mut variant = variant;
    let mut delta = difference(&variant);
    if sx != 0 || sy != 0 {
        // 只有确实更接近原图时才保留这次平移。
        let moved = shifted(&variant, sx, sy);
        let moved_delta = difference(&moved);
        if mean(rest.iter().map(|&i| moved_delta[i])) < mean(rest.iter().map(|&i| delta[i])) {
            variant = moved;
            delta = moved_delta;
        } else {
            sx = 0;
            sy = 0;
        }
    }
    let outside = distance_to_false(&region.not());
    let ring: Vec<usize> = rest.iter().copied().filter(|&i| outside.data[i] <= RING).collect();
    ensure!(
        !ring.is_empty(),
        "{name}: rejected outside-mask changes: no opaque pixels border the mask"
    );
    let opaque_mean = mean(rest.iter().map(|&i| delta[i]));
    let ring_mean = mean(ring.iter().map(|&i| delta[i]));
    let ring_share = ring.iter().filter(|&&i| delta[i] > RING_LEVEL).count() as f32 / ring.len() as f32;
    log.push(format!(
        "{name}: mask-only check: shift {sx:+}, {sy:+} px, opaque mean {opaque_mean:.2}/255, edge band mean {ring_mean:.2}/255, {:.1}% of edge band over {RING_LEVEL}",
        ring_share * 100.0
    ));
    ensure!(
        opaque_mean <= MAX_OPAQUE_MEAN,
        "{name}: rejected outside-mask changes: the picture outside the mask was redrawn (opaque mean {opaque_mean:.1}/255, limit {MAX_OPAQUE_MEAN})"
    );
    ensure!(
        ring_mean <= MAX_RING_MEAN && ring_share <= MAX_RING_SHARE,
        "{name}: rejected outside-mask changes: the drawing spills over the mask edge (within {RING} px: mean {ring_mean:.1}/255, {:.0}% over {RING_LEVEL}; limits {MAX_RING_MEAN} and {:.0}%)",
        ring_share * 100.0,
        MAX_RING_SHARE * 100.0
    );
    // 生成模型会把透明压平；遮罩里的脸沿用原图透明度。
    for (v, s) in variant.data.iter_mut().zip(&source.data) {
        v[3] = s[3];
    }
    let inside = distance_to_false(region);
    let band: Vec<usize> = (0..n)
        .filter(|&i| opaque[i] && inside.data[i] > 0.0 && inside.data[i] <= TINT_BAND)
        .collect();
    let mut tint = [0f32; 3];
    if !band.is_empty() {
        for (c, t) in tint.iter_mut().enumerate() {
            *t = median(
                &band
                    .iter()
                    .map(|&i| variant.data[i][c] as f32 - source.data[i][c] as f32)
                    .collect::<Vec<_>>(),
            );
        }
        if tint.iter().all(|t| t.abs() <= MAX_TINT) {
            for (v, &inner) in variant.data.iter_mut().zip(&region.data) {
                if inner {
                    for c in 0..3 {
                        v[c] = (v[c] as f32 - tint[c]).clamp(0.0, 255.0) as u8;
                    }
                }
            }
        } else {
            tint = [0.0; 3];
        }
    }
    log.push(format!(
        "{name}: importing the mask area only (corrected shift {sx:+}, {sy:+} px, tint {:+.0}, {:+.0}, {:+.0})",
        tint[0], tint[1], tint[2]
    ));
    Ok(variant)
}

/// 读一张变体：必须是 PNG；尺寸不同但比例一致时按 Lanczos 缩放到原图大小。
fn read_variant(name: &str, path: &Path, width: usize, height: usize, log: &mut Vec<String>) -> Result<(Rgba, bool)> {
    let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    ensure!(is_png(&bytes), "{name}: expected PNG size {width} x {height}");
    let mut image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .with_context(|| format!("cannot decode {}", path.display()))?
        .into_rgba8();
    let (iw, ih) = image.dimensions();
    let resized = (iw as usize, ih as usize) != (width, height);
    if resized {
        let ratio = iw as f64 * height as f64 / (ih as f64 * width as f64);
        ensure!(
            (ratio - 1.0).abs() <= 0.005,
            "{name}: expected PNG size {width} x {height}, got {iw} x {ih} (different aspect ratio)"
        );
        log.push(format!("{name}: resizing {iw} x {ih} to {width} x {height}"));
        image = image::imageops::resize(&image, width as u32, height as u32, image::imageops::FilterType::Lanczos3);
    }
    Ok((from_image(image), resized))
}

/// 读项目里的 `variants/*.png`，返回切好的 sprite（不写文件）；一张变体都没有时返回 `None`。
pub fn build_sprites(project: &Path, tolerance: f32) -> Result<Option<SpriteBuild>> {
    ensure!(
        tolerance.is_finite() && (0.0..=255.0).contains(&tolerance),
        "tolerance must be between 0 and 255"
    );
    let source = from_image(load_png(&project.join("source.png"))?);
    let rig_path = ["rig.json", "rig.draft.json"]
        .iter()
        .map(|n| project.join(n))
        .find(|p| p.exists())
        .context("project has no rig.json or rig.draft.json")?;
    let rig: Value = serde_json::from_slice(&fs::read(&rig_path)?).with_context(|| format!("{}: invalid JSON", rig_path.display()))?;
    let (w, h) = (source.width, source.height);
    ensure!(
        rig.get("image").and_then(|i| i.get("width")).and_then(Value::as_u64) == Some(w as u64)
            && rig.get("image").and_then(|i| i.get("height")).and_then(Value::as_u64) == Some(h as u64),
        "rig.image must match source.png"
    );
    let mut log = Vec::new();
    let mut layers = Vec::new();
    for name in all_variants() {
        let path = project.join("variants").join(format!("{name}.png"));
        if !path.exists() {
            log.push(format!("Skipping missing variant: {name}"));
            continue;
        }
        let (mut variant, resized) = read_variant(name, &path, w, h, &mut log)?;
        let parts = regions(project, &rig, w, h, name)?;
        let mut region = parts[0].clone();
        for part in &parts[1..] {
            region.or_assign(part);
        }
        let count = region.count();
        ensure!(
            count > 0 && count < w * h,
            "{name}: edit mask must contain a nonempty, bounded region"
        );
        let deltas: Vec<f32> = (0..w * h)
            .filter(|&i| !region.data[i])
            .map(|i| {
                let (a, b) = (visible(variant.data[i]), visible(source.data[i]));
                (0..4).map(|c| (a[c] - b[c]).abs()).fold(0.0, f32::max)
            })
            .collect();
        let maximum = deltas.iter().copied().fold(0.0, f32::max);
        let changed = deltas.iter().filter(|&&d| d > tolerance).count();
        log.push(format!(
            "{name}: outside-mask max {maximum:.3}/255, mean {:.6}/255, {changed} pixels over tolerance {tolerance}",
            mean(deltas.iter().copied())
        ));
        if changed > 0 || resized {
            variant = mask_only(name, variant, &source, &region, &mut log)?;
        }
        for (i, part) in parts.iter().enumerate() {
            let distance = distance_to_false(part);
            let Some([x0, y0, x1, y1]) = part.bbox() else {
                bail!("{name}: empty sprite mask");
            };
            let rect = [x0, y0, x1 - x0, y1 - y0];
            let mut crop = variant.crop(rect);
            let weight = distance.crop(rect);
            for (p, &d) in crop.data.iter_mut().zip(&weight.data) {
                p[3] = (p[3] as f32 * (d / 4.0).clamp(0.0, 1.0)) as u8;
            }
            let layer = if is_eye_variant(name) {
                format!("{name}_{i}")
            } else {
                name.to_owned()
            };
            layers.push((layer, rect, crop));
        }
    }
    if layers.is_empty() {
        return Ok(None);
    }
    let mut sorted: Vec<&(String, [usize; 4], Rgba)> = layers.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = Sha256::new();
    for (name, rect, crop) in sorted {
        hasher.update(name.as_bytes());
        hasher.update(rect.map(|v| v as u32).iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>());
        hasher.update(crop.data.iter().flatten().copied().collect::<Vec<u8>>());
    }
    let build = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>()[..10].to_owned();
    Ok(Some(SpriteBuild { build, layers, log }))
}

/// 写 `sprites.json` 与各 sprite PNG；`sprites.json` 里的顺序就是交叉淡入时的绘制顺序，保持构建顺序。
pub fn write_sprites(result: &SpriteBuild, out: &Path) -> Result<()> {
    fs::create_dir_all(out).with_context(|| format!("cannot create {}", out.display()))?;
    for (name, _, crop) in &result.layers {
        save_rgba(&out.join(format!("{name}.png")), crop)?;
    }
    let entries: Vec<String> = result
        .layers
        .iter()
        .map(|(name, r, _)| format!("    {}: [{}, {}, {}, {}]", Value::from(name.as_str()), r[0], r[1], r[2], r[3]))
        .collect();
    let json = format!(
        "{{\n  \"build\": {},\n  \"layers\": {{\n{}\n  }},\n  \"version\": 1\n}}\n",
        Value::from(result.build.as_str()),
        entries.join(",\n")
    );
    fs::write(out.join("sprites.json"), json)?;
    Ok(())
}
