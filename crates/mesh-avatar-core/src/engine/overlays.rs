//! Optional face accessories, meshed only over their padded opaque bounds.
use super::{
    grid::{build_grid, Grid},
    rig::{BaseWeights, Parameters, PhysicsOffsets, RigEngine},
};
use crate::format::{OverlayMetadata, Rect, Texture};
use anyhow::{ensure, Context, Result};
use std::collections::BTreeMap;

#[derive(Clone)]
pub(crate) struct OverlayItem {
    pub name: String,
    pub texture: String,
    pub mesh: Grid,
    pub visible: bool,
    weights: Vec<BaseWeights>,
}

/// Alpha values above 3 count as opaque; add six pixels of padding within the image.
fn opaque_rect(image: &Texture) -> Option<Rect> {
    let (mut x0, mut y0, mut x1, mut y1) = (image.width, image.height, 0, 0);
    for (i, pixel) in image.rgba.as_chunks::<4>().0.iter().enumerate() {
        if pixel[3] > 3 {
            let x = i as u32 % image.width;
            let y = i as u32 / image.width;
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x + 1);
            y1 = y1.max(y + 1);
        }
    }
    if x0 == image.width {
        return None;
    }
    let left = x0.saturating_sub(6);
    let top = y0.saturating_sub(6);
    Some([
        left,
        top,
        (x1 + 6).min(image.width) - left,
        (y1 + 6).min(image.height) - top,
    ])
}

fn crop(image: &Texture, [x, y, width, height]: Rect) -> Texture {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for row in y..y + height {
        let start = ((row * image.width + x) * 4) as usize;
        rgba.extend_from_slice(&image.rgba[start..start + width as usize * 4]);
    }
    Texture {
        width,
        height,
        rgba,
    }
}

#[derive(Clone, Default)]
pub(crate) struct Overlays {
    pub items: Vec<OverlayItem>,
}

impl Overlays {
    pub fn new(
        engine: &RigEngine<'_>,
        sheet: &OverlayMetadata,
        textures: &mut BTreeMap<String, Texture>,
    ) -> Result<Self> {
        let mut items = Vec::new();
        let mut cropped = BTreeMap::new();
        for item in &sheet.overlays {
            let name = format!("overlays/{}", item.file);
            let image = textures
                .get(&name)
                .with_context(|| format!("missing overlay texture: {}", item.name))?;
            ensure!(
                [image.width, image.height] == [engine.rig.image.width, engine.rig.image.height],
                "overlay {}: image size does not match base.png",
                item.name
            );
            let Some(rect) = opaque_rect(image) else {
                continue;
            };
            let image = crop(image, rect);
            let mesh = build_grid(
                rect.map(f64::from),
                engine.rig.mesh.sprite_cell as f64,
                &image.alpha(),
                image.width as usize,
                None,
            )?;
            let weights = mesh
                .rest
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&[x, y]| {
                    let mut weights = engine.base_weights(x as f64, y as f64, 0.0);
                    weights.brow = 0.0;
                    weights.jaw = 0.0;
                    weights
                })
                .collect();
            items.push(OverlayItem {
                name: item.name.clone(),
                texture: name.clone(),
                mesh,
                visible: false,
                weights,
            });
            // Several names may reference one PNG. Finish reading full-size images before replacing them.
            cropped.insert(name, image);
        }
        textures.extend(cropped);
        Ok(Self { items })
    }

    pub fn set(&mut self, names: &[&str]) {
        for item in &mut self.items {
            item.visible = names.contains(&item.name.as_str());
        }
    }

    pub fn update(&mut self, engine: &RigEngine<'_>, p: &Parameters, phys: &PhysicsOffsets) {
        for item in self.items.iter_mut().filter(|item| item.visible) {
            for (k, (rest, pos)) in item
                .mesh
                .rest
                .as_chunks::<2>()
                .0
                .iter()
                .zip(item.mesh.pos.as_chunks_mut::<2>().0)
                .enumerate()
            {
                *pos = engine
                    .deform_base(rest[0] as f64, rest[1] as f64, &item.weights[k], p, phys)
                    .map(|v| v as f32);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_bounds_match_alpha_threshold_padding_and_image_edges() {
        let mut image = Texture {
            width: 100,
            height: 50,
            rgba: vec![0; 100 * 50 * 4],
        };
        assert_eq!(opaque_rect(&image), None);
        for (x, y, a) in [(30, 20, 255), (60, 25, 10), (90, 40, 3)] {
            image.rgba[(y * 100 + x) * 4 + 3] = a;
        }
        assert_eq!(opaque_rect(&image), Some([24, 14, 43, 18]));
        image.rgba[3] = 4;
        image.rgba[(50 * 100 - 1) * 4 + 3] = 4;
        assert_eq!(opaque_rect(&image), Some([0, 0, 100, 50]));
    }

    #[test]
    fn shared_images_crop_once_and_hidden_meshes_skip_deformation() {
        use crate::format::OverlayDefinition;
        let rig =
            crate::rig::Rig::parse(include_bytes!("../../tests/fixtures/xiaoli/rig.json")).unwrap();
        let engine = RigEngine::new(&rig);
        let (width, height) = (rig.image.width, rig.image.height);
        let mut image = Texture {
            width,
            height,
            rgba: vec![0; (width * height * 4) as usize],
        };
        let x = width / 3;
        let y = height / 3;
        image.rgba[((y * width + x) * 4) as usize..((y * width + x) * 4 + 4) as usize]
            .copy_from_slice(&[70, 100, 140, 128]);
        let empty = Texture {
            width,
            height,
            rgba: vec![0; (width * height * 4) as usize],
        };
        let mut textures = BTreeMap::from([
            ("overlays/frame.png".into(), image),
            ("overlays/empty.png".into(), empty),
        ]);
        let sheet = OverlayMetadata {
            version: 1,
            overlays: [
                ("z", "frame.png"),
                ("a", "frame.png"),
                ("empty", "empty.png"),
            ]
            .map(|(name, file)| OverlayDefinition {
                name: name.into(),
                file: file.into(),
            })
            .to_vec(),
        };
        let mut overlays = Overlays::new(&engine, &sheet, &mut textures).unwrap();
        assert_eq!(overlays.items.len(), 2);
        assert_eq!(
            (
                textures["overlays/frame.png"].width,
                textures["overlays/frame.png"].height
            ),
            (13, 13)
        );
        assert_eq!(
            &textures["overlays/frame.png"].rgba[(6 * 13 + 6) * 4..(6 * 13 + 6) * 4 + 4],
            &[70, 100, 140, 128]
        );
        let before = overlays.items[0].mesh.pos.clone();
        let p = Parameters {
            angle_x: 30.0,
            mouth_open: 1.0,
            brow_y: 1.0,
            ..Default::default()
        };
        let phys = PhysicsOffsets::default();
        overlays.update(&engine, &p, &phys);
        assert_eq!(before, overlays.items[0].mesh.pos);
        overlays.set(&["a", "z", "unknown"]);
        overlays.update(&engine, &p, &phys);
        assert_ne!(before, overlays.items[0].mesh.pos);
        assert_eq!(overlays.items[0].mesh.pos, overlays.items[1].mesh.pos);
        assert!(overlays.items[0]
            .weights
            .iter()
            .all(|w| w.brow == 0.0 && w.jaw == 0.0));
        let shown = overlays.items[0].mesh.pos.clone();
        overlays.set(&[]);
        overlays.update(&engine, &Parameters::default(), &phys);
        assert_eq!(shown, overlays.items[0].mesh.pos);
        assert!(overlays.items.iter().all(|item| !item.visible));
    }
}
