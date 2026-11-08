//! 画眼睛与口型变体前的准备：每个变体一张编辑遮罩（透明处可改，不透明处保持原样）和一段给图像
//! 编辑模型的英文说明。照搬 mesh-avatar-studio 的 `tools/variant-requests.py` 与 `edit_masks`，
//! 口型说明把日语假名换成了英文元音描述。

use std::fs;
use std::path::Path;

use anyhow::{Context, Result, ensure};
use serde_json::Value;

use crate::imgops::{Mask, Rgba, dilate, polygon_mask, rotated_ellipse_mask, save_rgba};

pub const EYE_VARIANTS: [&str; 5] = ["eyes_closed", "eyes_half", "eyes_smile", "eyes_sad", "eyes_surprise"];
pub const MOUTH_VARIANTS: [&str; 6] = ["mouth_a", "mouth_a_half", "mouth_i", "mouth_o", "mouth_angry", "mouth_sad"];

pub fn is_eye_variant(name: &str) -> bool {
    EYE_VARIANTS.contains(&name)
}

pub fn all_variants() -> impl Iterator<Item = &'static str> {
    EYE_VARIANTS.iter().chain(MOUTH_VARIANTS.iter()).copied()
}

/// 每个变体要画成什么样。
pub fn change(name: &str) -> &'static str {
    match name {
        "eyes_closed" => {
            "Close both eyes naturally, as in a relaxed blink: one clean upper lash line per eye that curves gently downward, not the upward arc of a smiling closed eye. Remove all visible iris and eye white, and the original upper lash and eyelid crease lines, so only the closed lash line remains. Keep the eyebrows unchanged."
        }
        "eyes_half" => {
            "Draw both eyes half closed, with the upper lids halfway down. Keep the iris visible only below the upper lid and preserve the original gaze."
        }
        "eyes_smile" => {
            "Draw both eyes closed in a gentle smiling upward arc, with clean lashes and no visible iris or eye white. Keep the eyebrows unchanged."
        }
        "eyes_sad" => {
            "Redraw both eyes as sad open eyes: the upper lids drooping at the outer corners and raised toward the nose, softer and slightly moist, with the gaze a little downward. Do not draw tears on the cheeks. Keep each eye in place and the eyebrows unchanged; they are moved separately."
        }
        "eyes_surprise" => {
            "Redraw both eyes as surprised wide-open eyes: the upper lids raised to show eye white above the iris, slightly smaller irises with clear highlights, and the gaze straight ahead. Keep each eye in place and the eyebrows unchanged; they are moved separately."
        }
        "mouth_angry" => {
            "Redraw the closed mouth as angry: a tight, closed mouth with the corners turned down into a firm frown (an upside-down V), slightly shorter than the original. Keep it closed with no teeth, and keep its center in place."
        }
        "mouth_sad" => {
            "Redraw the closed mouth as sad: a small closed mouth with the corners drooping downward in a gentle, soft curve, slightly wavering. Keep it closed with no teeth, and keep its center in place."
        }
        "mouth_a" => {
            "Open the mouth for the open vowel \"a\" (as in \"father\"): a natural vertically open mouth, with a subtle tongue and upper teeth."
        }
        "mouth_a_half" => "Draw the open vowel \"a\" (as in \"father\") at half openness: a smaller, gently open mouth.",
        "mouth_i" => "Draw the vowel \"i\" (as in \"see\"): a wide, narrow open smile with subtle upper teeth.",
        "mouth_o" => "Draw the vowel \"o\" (as in \"go\"): a small rounded open mouth.",
        _ => "",
    }
}

/// 两只眼睛的 roi 各自外扩 4 像素，嘴是 `mouth.area` 椭圆外扩 4 像素。
pub fn edit_masks(rig: &Value, width: usize, height: usize) -> Result<([Mask; 2], Mask)> {
    let eyes = rig
        .get("eyes")
        .and_then(Value::as_array)
        .filter(|e| e.len() == 2)
        .context("rig.eyes must contain two eyes")?;
    let mut regions = Vec::new();
    for (i, eye) in eyes.iter().enumerate() {
        let points: Option<Vec<[f64; 2]>> = eye
            .get("roi")
            .and_then(Value::as_array)
            .and_then(|list| list.iter().map(|p| Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?])).collect());
        let points = points
            .filter(|p| p.len() >= 3 && p.iter().flatten().all(|v| v.is_finite()) && crate::rig::polygon_area(p).abs() > 0.0)
            .with_context(|| format!("rig.eyes[{i}].roi: expected a finite polygon with positive area"))?;
        let rounded: Vec<[f64; 2]> = points.iter().map(|p| [p[0].round_ties_even(), p[1].round_ties_even()]).collect();
        regions.push(dilate(&polygon_mask(width, height, &rounded), 9));
    }
    ensure!(
        !regions[0].and(&regions[1]).any(),
        "dilated eye ROIs overlap; separate them before requesting variants"
    );
    let area = rig
        .get("mouth")
        .and_then(|m| m.get("area"))
        .context("rig.mouth.area: expected a finite ellipse with positive radii")?;
    let get = |key: &str| area.get(key).and_then(Value::as_f64).filter(|v| v.is_finite());
    let (Some(cx), Some(cy), Some(rx), Some(ry)) = (get("cx"), get("cy"), get("rx"), get("ry")) else {
        anyhow::bail!("rig.mouth.area: expected a finite ellipse with positive radii");
    };
    let angle = match area.get("angle") {
        None => 0.0,
        Some(v) => v
            .as_f64()
            .filter(|a| a.is_finite())
            .context("rig.mouth.area: expected a finite ellipse with positive radii")?,
    };
    ensure!(
        rx > 0.0 && ry > 0.0,
        "rig.mouth.area: expected a finite ellipse with positive radii"
    );
    let mouth = rotated_ellipse_mask(
        width,
        height,
        cx.round_ties_even(),
        cy.round_ties_even(),
        rx.round_ties_even(),
        ry.round_ties_even(),
        angle,
    );
    let [a, b]: [Mask; 2] = regions.try_into().expect("two eyes");
    Ok(([a, b], dilate(&mouth, 9)))
}

/// 编辑遮罩的约定：可改的像素透明，其余白色不透明。
pub fn rgba_mask(region: &Mask) -> Rgba {
    region.map(|editable| [255, 255, 255, if editable { 0 } else { 255 }])
}

pub fn prompt(name: &str, width: usize, height: usize) -> String {
    format!(
        "Edit the supplied source.png, exactly {width} x {height} pixels.\n\n{}\n\n\
         Only fully transparent pixels (alpha = 0) in the supplied mask.png are editable; \
         opaque pixels are protected. Preserve the original drawing style, line weight, \
         skin colour, head pose, hair, accessories, clothing and transparent background. \
         Return a full-size RGBA PNG, not a crop. Pixels outside the edit region must be \
         identical to source.png, including alpha. Do not resize, shift, recolour or redraw \
         the rest of the image. Keep all changes at least 4 pixels inside the mask edge \
         so sprite feathering blends into the unchanged source.\n",
        change(name)
    )
}

/// 在 `<project>/variant-requests/` 下为每个变体写 `mask.png` 与 `prompt.md`，再写一份 README。
pub fn write_requests(project: &Path, rig: &Value, width: usize, height: usize) -> Result<usize> {
    let (eyes, mouth) = edit_masks(rig, width, height)?;
    let both_eyes = eyes[0].or(&eyes[1]);
    let output = project.join("variant-requests");
    let names: Vec<&str> = all_variants().collect();
    for name in &names {
        let folder = output.join(name);
        fs::create_dir_all(&folder).with_context(|| format!("cannot create {}", folder.display()))?;
        let region = if is_eye_variant(name) { &both_eyes } else { &mouth };
        save_rgba(&folder.join("mask.png"), &rgba_mask(region))?;
        fs::write(folder.join("prompt.md"), prompt(name, width, height))?;
    }
    let list: String = names
        .iter()
        .map(|n| format!("- `{n}/mask.png` + `{n}/prompt.md` -> `../variants/{n}.png`\n"))
        .collect();
    fs::write(
        output.join("README.md"),
        format!(
            "# Drawn variant requests\n\n\
             Required output size: **{width} x {height}** pixels, RGBA PNG.\n\n\
             For each variant below, supply `../source.png`, the variant's `mask.png`, and its \
             `prompt.md` to an image editor you trust. The expression eyes (`eyes_sad`, `eyes_surprise`) \
             and closed mouths (`mouth_angry`, `mouth_sad`) are optional; generate only the ones you want. \
             Transparent mask pixels may change; opaque mask pixels must stay identical. Generating these \
             files is a separate action: this command uploads nothing.\n\n{list}\n\
             Create the `variants/` directory in the project and save each full-size result there. \
             Then run `mesh-avatar-build sprites <project>`. It measures outside-mask changes and rejects \
             shifted or redrawn images. Missing variants are skipped. Review the resulting poses again.\n"
        ),
    )?;
    Ok(names.len())
}
