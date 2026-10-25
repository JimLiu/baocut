//! Radial warp (`caption-radial-warp/1`): one resampling of a page domain in which the
//! sample point moves along its radius about the domain centre by a cubic term and is
//! then shifted by a constant.
use anyhow::{Result, ensure};
use caption_scene::MaterialUvY;
use tiny_skia::Pixmap;

/// Resolved uniforms; ranges are checked by validation and again here.
pub(super) struct RadialWarp {
    /// Canvas-space domain `[x, y, width, height]` in output pixels.
    pub(super) domain: [f64; 4],
    pub(super) uv_y: MaterialUvY,
    pub(super) strength: f64,
    pub(super) shift: [f64; 2],
}

/// Work units charged per domain pixel: the radial map and one bilinear tap.
const PIXEL_COST: u64 = 12;

/// Per destination pixel center inside the domain, with material coordinates `m`
/// (`m.y` flipped for `uvY: up`) and centred coordinates `p = 2m - 1`: the sample point is
/// `(p * (1 + strength * dot(p, p))) / 2 + 1/2 + shift`, read with one premultiplied bilinear
/// tap. Sample points outside the unit square are transparent, as are pixels outside the domain.
pub(super) fn apply(
    source: &Pixmap,
    pad: u32,
    u: &RadialWarp,
    mut spend: impl FnMut(u64) -> Result<()>,
) -> Result<Pixmap> {
    ensure!(
        u.domain
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
            && u.domain[2] >= 0.001
            && u.domain[3] >= 0.001
            && (-4.0..=4.0).contains(&u.strength)
            && u.shift.iter().all(|v| (-4.0..=4.0).contains(v)),
        "CAPTION_MATERIAL_INVALID: radial warp uniforms"
    );
    let (width, height) = (source.width(), source.height());
    let mut out = Pixmap::new(width, height)
        .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: radial warp surface"))?;
    let [dx, dy, dw, dh] = u.domain;
    let origin = f64::from(pad);
    let flip = u.uv_y == MaterialUvY::Up;
    for y in 0..height {
        for x in 0..width {
            let uv = [
                (f64::from(x) + 0.5 - origin - dx) / dw,
                (f64::from(y) + 0.5 - origin - dy) / dh,
            ];
            if uv.iter().any(|v| !(0.0..1.0).contains(v)) {
                continue;
            }
            spend(PIXEL_COST)?;
            let m = [uv[0], if flip { 1.0 - uv[1] } else { uv[1] }];
            let p = [2.0 * m[0] - 1.0, 2.0 * m[1] - 1.0];
            let scale = 1.0 + u.strength * (p[0] * p[0] + p[1] * p[1]);
            let sample = [
                p[0] * scale * 0.5 + 0.5 + u.shift[0],
                p[1] * scale * 0.5 + 0.5 + u.shift[1],
            ];
            if sample.iter().any(|v| !(0.0..1.0).contains(v)) {
                continue;
            }
            let row = if flip { 1.0 - sample[1] } else { sample[1] };
            // Back to texel-center coordinates: zero displacement is the identity.
            let sx = origin + dx + sample[0] * dw - 0.5;
            let sy = origin + dy + row * dh - 0.5;
            let color = super::materials::bilinear_transparent(source, sx, sy);
            let index = (y as usize * width as usize + x as usize) * 4;
            out.data_mut()[index..index + 4].copy_from_slice(&color);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> Pixmap {
        let mut pixmap = Pixmap::new(16, 12).unwrap();
        for (i, px) in pixmap.data_mut().chunks_exact_mut(4).enumerate() {
            let a = (i * 37 % 200 + 56) as u8;
            px.copy_from_slice(&[a / 2, a / 3, a / 4, a]);
        }
        pixmap
    }

    fn neutral() -> RadialWarp {
        RadialWarp {
            domain: [2.0, 1.0, 12.0, 10.0],
            uv_y: MaterialUvY::Down,
            strength: 0.0,
            shift: [0.0, 0.0],
        }
    }

    fn run(u: &RadialWarp) -> Pixmap {
        apply(&source(), 0, u, |_| Ok(())).unwrap()
    }

    fn pixel(map: &Pixmap, x: u32, y: u32) -> [u8; 4] {
        let i = (y as usize * map.width() as usize + x as usize) * 4;
        map.data()[i..i + 4].try_into().unwrap()
    }

    #[test]
    fn neutral_uniforms_copy_the_domain_and_clear_the_rest() {
        let (input, out) = (source(), run(&neutral()));
        for y in 0..12 {
            for x in 0..16 {
                let inside = (2..14).contains(&x) && (1..11).contains(&y);
                let expected = if inside { pixel(&input, x, y) } else { [0; 4] };
                assert_eq!(pixel(&out, x, y), expected, "{x},{y}");
            }
        }
    }

    #[test]
    fn positive_strength_samples_further_out_and_leaves_the_centre_alone() {
        let mut u = neutral();
        u.strength = 0.5;
        let (input, out) = (source(), run(&u));
        // The centre of an even-sized domain sits between texels, so the nearest ones barely move.
        let near = |a: [u8; 4], b: [u8; 4]| a.iter().zip(b).all(|(x, y)| x.abs_diff(y) <= 40);
        assert!(near(pixel(&out, 8, 6), pixel(&input, 8, 6)));
        // A pixel near the edge reads from beyond the domain and goes transparent.
        assert_eq!(pixel(&out, 2, 1), [0; 4]);
        assert_ne!(pixel(&out, 4, 3), pixel(&input, 4, 3));
    }

    #[test]
    fn shift_moves_the_content_along_material_y_and_uv_y_reverses_it() {
        let mut down = neutral();
        down.shift = [0.0, 0.2];
        let (input, out) = (source(), run(&down));
        // Sample row = row + 0.2 * domain height (two rows) for `down`.
        assert_eq!(pixel(&out, 5, 3), pixel(&input, 5, 5));
        let mut up = neutral();
        up.uv_y = MaterialUvY::Up;
        up.shift = [0.0, 0.2];
        assert_eq!(pixel(&run(&up), 5, 5), pixel(&input, 5, 3));
        // Moving past the domain edge reads nothing.
        assert_eq!(pixel(&out, 5, 9), [0; 4]);
    }

    #[test]
    fn work_is_charged_per_domain_pixel_and_bad_uniforms_fail() {
        let mut total = 0;
        apply(&source(), 0, &neutral(), |count| {
            total += count;
            Ok(())
        })
        .unwrap();
        assert_eq!(total, 12 * 10 * PIXEL_COST);
        let mut bad = neutral();
        bad.strength = 5.0;
        assert!(apply(&source(), 0, &bad, |_| Ok(())).is_err());
        let mut bad = neutral();
        bad.shift = [f64::NAN, 0.0];
        assert!(apply(&source(), 0, &bad, |_| Ok(())).is_err());
    }
}
