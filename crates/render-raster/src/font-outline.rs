//! Floating design-space outlines for the opt-in unhinted path.
//! Unhandled outline formats retain the existing scaler; no font IO or shaping.
use cosmic_text::skrifa::{FontRef, MetadataProvider, Tag as ShapeTag};
use cosmic_text::{CacheKey, CacheKeyFlags, FontSystem};
use swash::zeno::{Angle, Point, Transform};
use tiny_skia::{Path, PathBuilder};
use ttf_parser::{Face, GlyphId, OutlineBuilder, Tag};

fn compatible_coordinates(
    raw: impl IntoIterator<Item = i16>,
) -> Option<Vec<ttf_parser::NormalizedCoordinate>> {
    raw.into_iter()
        .map(|value| {
            // The parser constructor clamps to [-1,1], while an avar2 shaping
            // location can contain wider F2Dot14 values. Never silently retarget it.
            (-16384..=16384)
                .contains(&value)
                .then(|| ttf_parser::NormalizedCoordinate::from(value))
        })
        .collect()
}

struct Builder {
    path: PathBuilder,
    scale: f64,
    italic: Option<Transform>,
}
impl Builder {
    fn point(&self, x: f32, y: f32) -> (f32, f32) {
        let p = self
            .italic
            .map_or(Point { x, y }, |t| t.transform_point(Point { x, y }));
        (
            (f64::from(p.x) * self.scale) as f32,
            (-f64::from(p.y) * self.scale) as f32,
        )
    }
}
impl OutlineBuilder for Builder {
    fn move_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.point(x, y);
        self.path.move_to(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.point(x, y);
        self.path.line_to(x, y);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (x1, y1) = self.point(x1, y1);
        let (x, y) = self.point(x, y);
        self.path.quad_to(x1, y1, x, y);
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (x1, y1) = self.point(x1, y1);
        let (x2, y2) = self.point(x2, y2);
        let (x, y) = self.point(x, y);
        self.path.cubic_to(x1, y1, x2, y2, x, y);
    }
    fn close(&mut self) {
        self.path.close();
    }
}

pub(super) fn glyph_path(fonts: &mut FontSystem, key: CacheKey) -> Option<Path> {
    let index = fonts.db().face(key.font_id)?.index;
    let font = fonts.get_font(key.font_id, key.font_weight)?;
    let face = Face::parse(font.data(), index).ok()?;
    // VARC and more than the parser's 64-coordinate storage need the
    // original scaler. Do not partially instantiate or discard their axes.
    if face.raw_face().table(Tag::from_bytes(b"VARC")).is_some()
        || face.variation_axes().len() >= 64
    {
        return None;
    }
    if face.tables().glyf.is_none() {
        let cff = face.tables().cff.as_ref()?; // CFF2 retains the existing path.
        if cff.glyph_cid(GlyphId(key.glyph_id)).is_some() {
            return None;
        }
        let m = cff.matrix();
        let unit = 1. / f32::from(face.units_per_em());
        if m.sx != unit || m.sy != unit || [m.kx, m.ky, m.tx, m.ty].iter().any(|v| *v != 0.) {
            return None; // Custom/CID FontMatrix is not an em-unit outline.
        }
    }
    let size = f64::from(f32::from_bits(key.font_size_bits));
    if !size.is_finite() || size <= 0. {
        return None;
    }
    let mut builder = Builder {
        path: PathBuilder::new(),
        scale: size / f64::from(face.units_per_em()),
        italic: key
            .flags
            .contains(CacheKeyFlags::FAKE_ITALIC)
            .then(|| Transform::skew(Angle::from_degrees(14.), Angle::from_degrees(0.))),
    };
    if let Some(gvar) = face.tables().gvar.as_ref() {
        // Use exactly the location fed to cosmic-text's HarfRust instance.
        // Face::set_variation truncates before avar and can select an adjacent
        // F2Dot14 coordinate, causing outlines and advances to disagree.
        let shaping_face = FontRef::from_index(font.data(), index).ok()?;
        let location = shaping_face
            .axes()
            .location([(ShapeTag::new(b"wght"), f32::from(key.font_weight.0))]);
        let coordinates = compatible_coordinates(location.coords().iter().map(|c| c.to_bits()))?;
        gvar.outline(
            face.tables().glyf?,
            &coordinates,
            GlyphId(key.glyph_id),
            &mut builder,
        )?;
    } else {
        face.outline_glyph(GlyphId(key.glyph_id), &mut builder)?;
    }
    builder.path.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TextEngine;
    #[test]
    fn extended_avar_coordinates_fall_back_instead_of_silent_clamping() {
        assert!(compatible_coordinates([20000]).is_none());
        assert!(compatible_coordinates([-20000]).is_none());
        let raw = [-16384, 0, 3072, 16384];
        let result = compatible_coordinates(raw).unwrap();
        assert_eq!(result.iter().map(|c| c.get()).collect::<Vec<_>>(), raw);
    }
    #[test]
    fn static_outline_scales_without_a_pixel_or_font_unit_rounding_grid() {
        let mut text = TextEngine::with_document_fonts(&[include_bytes!(
            "../assets/fonts/Bangers-Regular.ttf"
        )
        .to_vec()]);
        for size in [13.25, 14., 31.75, 48.] {
            let mut line = text.shape("M", "Bangers", size, 400);
            line.set_hinting(false);
            let r = text.glyph_path(line.glyphs[0].cache_key).unwrap().bounds();
            for (actual, units) in [
                (r.x(), -30.),
                (r.y(), -755.),
                (r.width(), 718.),
                (r.height(), 749.),
            ] {
                assert!(
                    (f64::from(actual) - units * size / 1000.).abs() < 0.00001,
                    "size={size} rect={r:?}"
                );
            }
        }
    }
    #[test]
    fn collection_uses_the_actual_resolved_face_index() {
        let mut collection = b"ttcf\0\x01\0\0\0\0\0\x02".to_vec();
        collection.extend_from_slice(&[0; 8]);
        for (index, source) in [
            include_bytes!("../assets/fonts/VKSans-400.ttf").as_slice(),
            include_bytes!("../assets/fonts/Bangers-Regular.ttf").as_slice(),
        ]
        .into_iter()
        .enumerate()
        {
            while collection.len() % 4 != 0 {
                collection.push(0);
            }
            let base = collection.len() as u32;
            collection[12 + index * 4..16 + index * 4].copy_from_slice(&base.to_be_bytes());
            let mut font = source.to_vec();
            let tables = u16::from_be_bytes(font[4..6].try_into().unwrap()) as usize;
            for table in 0..tables {
                let at = 12 + table * 16 + 8;
                let offset = u32::from_be_bytes(font[at..at + 4].try_into().unwrap());
                font[at..at + 4].copy_from_slice(&(offset + base).to_be_bytes());
            }
            collection.extend_from_slice(&font);
        }
        let mut text = TextEngine::with_document_fonts(&[collection]);
        let mut line = text.shape("M", "Bangers", 14., 400);
        line.set_hinting(false);
        let key = line.glyphs[0].cache_key;
        assert_eq!(text.font_system.db().face(key.font_id).unwrap().index, 1);
        let r = text.glyph_path(key).unwrap().bounds();
        assert!((r.width() - 10.052).abs() < 0.00001, "{r:?}");
    }
    #[test]
    fn synthetic_italic_skews_in_font_coordinates_before_flipping_y() {
        let mut text = TextEngine::with_document_fonts(&[include_bytes!(
            "../assets/fonts/Bangers-Regular.ttf"
        )
        .to_vec()]);
        let mut line = text.shape("M", "Bangers", 14., 400);
        line.set_hinting(false);
        let key = line.glyphs[0].cache_key;
        let mut italic_key = key;
        italic_key.flags.insert(CacheKeyFlags::FAKE_ITALIC);
        let plain = text.glyph_path(key).unwrap();
        let italic = text.glyph_path(italic_key).unwrap();
        let expected = plain
            .transform(tiny_skia::Transform::from_row(
                1.,
                0.,
                -14f32.to_radians().tan(),
                1.,
                0.,
                0.,
            ))
            .unwrap();
        for (a, b) in italic.points().iter().zip(expected.points()) {
            assert!((a.x - b.x).abs() < 0.00001 && (a.y - b.y).abs() < 0.00001);
        }
    }
    #[test]
    fn variable_outline_reuses_shaping_location_across_an_avar_breakpoint() {
        let bytes = include_bytes!("../assets/fonts/Rubik.ttf");
        let mut text = TextEngine::with_document_fonts(&[bytes.to_vec()]);
        let mut line = text.shape("M", "Rubik", 48., 400);
        line.set_hinting(false);
        let key = line.glyphs[0].cache_key;
        let face = Face::parse(bytes, 0).unwrap();
        let shaping = FontRef::from_index(bytes, 0).unwrap();
        let location = shaping.axes().location([(ShapeTag::new(b"wght"), 400.)]);
        let coords: Vec<_> = location
            .coords()
            .iter()
            .map(|c| ttf_parser::NormalizedCoordinate::from(c.to_bits()))
            .collect();
        assert_eq!(coords[0].get(), 3072);
        let mut builder = Builder {
            path: PathBuilder::new(),
            scale: 48. / f64::from(face.units_per_em()),
            italic: None,
        };
        face.tables()
            .gvar
            .as_ref()
            .unwrap()
            .outline(
                face.tables().glyf.unwrap(),
                &coords,
                GlyphId(key.glyph_id),
                &mut builder,
            )
            .unwrap();
        let expected = builder.path.finish().unwrap();
        let actual = text.glyph_path(key).unwrap();
        assert_eq!(actual.points(), expected.points());
    }
    #[test]
    fn variable_weight_is_instantiated_and_float_scale_is_linear() {
        let mut text =
            TextEngine::with_document_fonts(&[
                include_bytes!("../assets/fonts/Montserrat.ttf").to_vec()
            ]);
        let mut rectangles = Vec::new();
        for (size, weight) in [(13.25, 400), (48., 400), (48., 100)] {
            let mut line = text.shape("M", "Montserrat", size, weight);
            line.set_hinting(false);
            let r = text.glyph_path(line.glyphs[0].cache_key).unwrap().bounds();
            rectangles.push([
                f64::from(r.x()) / size,
                f64::from(r.y()) / size,
                f64::from(r.width()) / size,
                f64::from(r.height()) / size,
            ]);
        }
        for (a, b) in rectangles[0].into_iter().zip(rectangles[1]) {
            assert!((a - b).abs() < 0.000001);
        }
        assert!(
            rectangles[1]
                .iter()
                .zip(rectangles[2])
                .any(|(a, b)| (*a - b).abs() > 0.02),
            "weight axis was not applied"
        );
    }
}
