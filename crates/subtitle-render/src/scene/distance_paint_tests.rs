//! End-to-end pixel checks against analytic geometry, independent of flattening internals.
use super::distance_paint::{self, DistanceCache};
use super::text_paint::{GlyphPaint, PaintViewport, Shape};
use super::*;
use serde_json::{Value, json};
use tiny_skia::{Path, PathBuilder};

const SIZE: (u32, u32) = (32, 24);

struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, _: &str, _: i64) -> Result<Arc<Pixmap>> {
        bail!("unexpected media in contour fixture")
    }
}

fn fixture() -> (TextEngine, GlyphPaint) {
    let mut text = TextEngine::with_document_fonts(&[include_bytes!(
        "../../../render-raster/assets/fonts/VKSans-400.ttf"
    )
    .to_vec()]);
    let glyph = text.shape("H", "VK Sans", 16.0, 400).glyphs.remove(0);
    assert!(matches!(
        text.glyph_render(glyph.cache_key),
        GlyphRender::Outline(_)
    ));
    let g = GlyphPaint {
        glyph,
        fill: [1.0; 4],
        opacity: 1.0,
        source_scalar_index: 0,
        page_scalar_origin: 0,
        origin: Transform::from_translate(6.25, 4.75),
        paint_bounds: Bounds {
            x: 6.25,
            y: 4.75,
            width: 8.0,
            height: 6.0,
        },
        page_bounds: Bounds {
            x: 0.0,
            y: 0.0,
            width: 32.0,
            height: 24.0,
        },
        paint_origin: (6.25, 4.75),
    };
    (text, g)
}

fn band(offset: [f64; 2], threshold: f64, half_width: f64) -> Value {
    json!({"offset":offset,"threshold":threshold,"halfWidth":half_width})
}

fn layer(bands: Vec<Value>, source_band: usize, scale: f64) -> PaintLayer {
    serde_json::from_value(json!({
        "id":"distance","paint":{"kind":"solid","color":"#FFFFFF"},
        "distanceCoverage":{
            "source":"glyph-contours","bands":bands,
            "aa":{"kind":"quad-derivative","sourceBand":source_band,"scale":scale},
            "combine":"multiply","zeroWidth":"step-inclusive"
        }
    }))
    .unwrap()
}

#[derive(Clone, Copy)]
struct Geometry {
    outer: [f64; 4],
    inner: Option<([f64; 4], bool)>,
}
impl Geometry {
    fn rectangle(bounds: [f64; 4]) -> Self {
        Self {
            outer: bounds,
            inner: None,
        }
    }
    fn path(self) -> Path {
        fn contour(builder: &mut PathBuilder, bounds: [f64; 4], reverse: bool) {
            let [l, t, r, b] = bounds.map(|n| n as f32);
            builder.move_to(l, t);
            if reverse {
                builder.line_to(l, b);
                builder.line_to(r, b);
                builder.line_to(r, t);
            } else {
                builder.line_to(r, t);
                builder.line_to(r, b);
                builder.line_to(l, b);
            }
            builder.close();
        }
        let mut builder = PathBuilder::new();
        contour(&mut builder, self.outer, false);
        if let Some((bounds, same_direction)) = self.inner {
            contour(&mut builder, bounds, !same_direction);
        }
        builder.finish().unwrap()
    }
    fn distance(self, p: [f64; 2]) -> f64 {
        // Analytic axis-aligned box SDF; there is no edge iteration or flattening here.
        fn box_distance([l, t, r, b]: [f64; 4], [x, y]: [f64; 2]) -> f64 {
            let q = [(l - x).max(x - r), (t - y).max(y - b)];
            -(q[0].max(0.0).hypot(q[1].max(0.0)) + q[0].max(q[1]).min(0.0))
        }
        let outer = box_distance(self.outer, p);
        match self.inner {
            None => outer,
            Some((bounds, same_direction)) => {
                let inner = box_distance(bounds, p);
                let magnitude = outer.abs().min(inner.abs());
                if outer >= 0.0 && (same_direction || inner <= 0.0) {
                    magnitude
                } else {
                    -magnitude
                }
            }
        }
    }
}

fn record(
    layer: &PaintLayer,
    glyphs: &[GlyphPaint],
    shapes: &[Shape],
    viewport: PaintViewport,
    budget: &mut Budget,
) -> Result<FrameOps> {
    let images = BTreeMap::new();
    record_images(layer, glyphs, shapes, viewport, &images, budget)
}

fn record_images(
    layer: &PaintLayer,
    glyphs: &[GlyphPaint],
    shapes: &[Shape],
    viewport: PaintViewport,
    images: &BTreeMap<String, BitmapData>,
    budget: &mut Budget,
) -> Result<FrameOps> {
    let prepared = distance_paint::prepare(
        layer,
        glyphs,
        shapes,
        viewport,
        images,
        &mut DistanceCache::default(),
        budget,
    )?;
    let mut builder = FrameBuilder::default();
    distance_paint::record(prepared, &mut builder)?;
    Ok(builder.finish())
}

fn replay(ops: &FrameOps, viewport: PaintViewport) -> Pixmap {
    let encoded = render_raster::drawop::encode(ops);
    let (_, mut local) = render_raster::drawop::decode(&encoded).unwrap();
    for op in &mut local.ops {
        if let DrawOp::DrawBitmap { tf, .. } = op {
            tf[4] -= viewport.origin[0] as f32;
            tf[5] -= viewport.origin[1] as f32;
        }
    }
    rasterize_with_media(&local, viewport.size.0, viewport.size.1, &mut NoMedia).unwrap()
}

fn render(
    layer: &PaintLayer,
    g: &GlyphPaint,
    geometry: Geometry,
    viewport: PaintViewport,
) -> (Pixmap, FrameOps) {
    let ops = record(
        layer,
        std::slice::from_ref(g),
        &[Shape::Outline(geometry.path())],
        viewport,
        &mut Budget::default(),
    )
    .unwrap();
    (replay(&ops, viewport), ops)
}

fn clamp(value: f64, range: Option<[f64; 2]>) -> f64 {
    range.map_or(value, |[lo, hi]| value.max(lo).min(hi))
}

fn coverage(layer: &PaintLayer, g: &GlyphPaint, geometry: Geometry, x: i32, y: i32) -> f64 {
    let spec = layer.distance_coverage.as_ref().unwrap();
    let GlyphDistanceAa::QuadDerivative { source_band, scale } = spec.aa;
    let unit = if layer.unit == PaintUnit::Em {
        f64::from(f32::from_bits(g.glyph.cache_key.font_size_bits))
    } else {
        1.0
    };
    let qx = (f64::from(x) / 2.0).floor() * 2.0;
    let qy = (f64::from(y) / 2.0).floor() * 2.0;
    let current_x = usize::from(f64::from(x) != qx);
    let current_y = usize::from(f64::from(y) != qy);
    let lane = 2 * current_y + current_x;
    let values: Vec<[f64; 4]> = spec
        .bands
        .iter()
        .map(|band| {
            std::array::from_fn(|at| {
                let p = [
                    qx + (at % 2) as f64 + 0.5 - f64::from(g.origin.tx) - band.offset[0] * unit,
                    qy + (at / 2) as f64 + 0.5 - f64::from(g.origin.ty) - band.offset[1] * unit,
                ];
                clamp(
                    geometry.distance(p),
                    band.distance_clamp.map(|r| r.map(|v| v * unit)),
                )
            })
        })
        .collect();
    let reference = values[source_band];
    let aa = scale
        * ((reference[2 * current_y + 1] - reference[2 * current_y]).abs()
            + (reference[2 + current_x] - reference[current_x]).abs());
    spec.bands
        .iter()
        .enumerate()
        .map(|(index, band)| {
            let center = clamp(
                band.threshold * unit,
                band.threshold_clamp.map(|r| r.map(|v| v * unit)),
            );
            let width = band.half_width * unit + aa;
            let range = band.edge_clamp.map(|r| r.map(|v| v * unit));
            let low = clamp(center - width, range);
            let high = clamp(center + width, range);
            if high == low {
                if values[index][lane] >= low { 1.0 } else { 0.0 }
            } else {
                ((values[index][lane] - low) / (high - low)).clamp(0.0, 1.0)
            }
        })
        .product()
}

fn rgba(straight: [f64; 4], coverage: f64, opacity: f64) -> [u8; 4] {
    let alpha = straight[3] * coverage * opacity;
    [
        straight[0] * alpha,
        straight[1] * alpha,
        straight[2] * alpha,
        alpha,
    ]
    .map(|v| (v * 255.0).round().clamp(0.0, 255.0) as u8)
}

fn assert_pixels(actual: &Pixmap, viewport: PaintViewport, expected: impl Fn(i32, i32) -> [u8; 4]) {
    for y in 0..viewport.size.1 {
        for x in 0..viewport.size.0 {
            let at = ((y * viewport.size.0 + x) * 4) as usize;
            let expected = expected(x as i32 + viewport.origin[0], y as i32 + viewport.origin[1]);
            let actual = &actual.data()[at..at + 4];
            assert!(
                actual.iter().zip(expected).all(|(a, b)| a.abs_diff(b) <= 1),
                "pixel ({x},{y}), global ({},{}): expected {expected:?}, got {actual:?}",
                x as i32 + viewport.origin[0],
                y as i32 + viewport.origin[1]
            );
        }
    }
}

#[test]
fn two_rectangle_bands_match_analytic_pixels_and_recording_roundtrip() {
    let (_, g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 8.0, 6.0]);
    let mut layer = layer(
        vec![band([0.0, 0.0], 99.0, 0.7), band([1.5, -0.75], -0.3, 1.2)],
        1,
        0.75,
    );
    let first = &mut layer.distance_coverage.as_mut().unwrap().bands[0];
    first.threshold_clamp = Some([0.0, 0.25]);
    first.edge_clamp = Some([-0.75, 1.0]);
    let viewport = PaintViewport::from(SIZE);
    let (pixels, ops) = render(&layer, &g, geometry, viewport);
    assert_pixels(&pixels, viewport, |x, y| {
        rgba([1.0; 4], coverage(&layer, &g, geometry, x, y), 1.0)
    });
    assert!(
        pixels
            .data()
            .chunks_exact(4)
            .any(|p| p[3] > 0 && p[3] < 255)
    );
    assert!(
        ops.paths.is_empty(),
        "distance pixels must not receive legacy path AA"
    );
    assert!(
        ops.ops
            .iter()
            .all(|op| matches!(op,DrawOp::DrawBitmap { opacity, .. } if *opacity == 1.0))
    );
    let encoded = render_raster::drawop::encode(&ops);
    let (_, decoded) = render_raster::drawop::decode(&encoded).unwrap();
    assert_eq!(replay(&decoded, viewport).data(), pixels.data());
}

#[test]
fn translucent_solid_and_node_fill_apply_alpha_opacity_and_coverage_once() {
    let (_, mut g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 12.0, 10.0]);
    let mut layer = layer(vec![band([0.0, 0.0], 0.0, 0.75)], 0, 0.5);
    g.opacity = 0.4;
    let straight = [128.0 / 255.0, 64.0 / 255.0, 32.0 / 255.0, 128.0 / 255.0];
    g.fill = [
        straight[0],
        straight[1],
        straight[2],
        straight[3] * g.opacity,
    ];
    layer.paint = serde_json::from_value(json!({"kind":"solid","color":"#80402080"})).unwrap();
    let viewport = PaintViewport::from(SIZE);
    let (solid, _) = render(&layer, &g, geometry, viewport);
    assert_pixels(&solid, viewport, |x, y| {
        rgba(straight, coverage(&layer, &g, geometry, x, y), g.opacity)
    });
    let mut partial = 0;
    for y in 0..SIZE.1 {
        for x in 0..SIZE.0 {
            let c = coverage(&layer, &g, geometry, x as i32, y as i32);
            if (0.05..0.95).contains(&c) {
                let once = rgba(straight, c, g.opacity);
                let twice = rgba(straight, c * c, g.opacity);
                if once[3].abs_diff(twice[3]) > 2 {
                    partial += 1;
                }
            }
        }
    }
    assert!(
        partial > 10,
        "fixture must detect coverage being multiplied twice"
    );
    layer.paint = ScenePaint::NodeFill;
    let (node_fill, _) = render(&layer, &g, geometry, viewport);
    assert_eq!(node_fill.data(), solid.data());
}

#[test]
fn translucent_gradient_samples_original_glyph_domain_despite_band_offset() {
    let (_, mut g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 12.0, 8.0]);
    let mut layer = layer(
        vec![band([0.0, 0.0], 0.0, 0.5), band([2.0, -1.0], 0.0, 0.5)],
        1,
        0.5,
    );
    layer.paint = serde_json::from_value(json!({"kind":"linear","domain":"glyph","space":"local",
        "from":[0,0],"to":[1,0],"stops":[{"at":0,"color":"#FF000080"},{"at":1,"color":"#0000FF40"}]})).unwrap();
    g.opacity = 0.7;
    let viewport = PaintViewport::from(SIZE);
    let (actual, _) = render(&layer, &g, geometry, viewport);
    let gradient = |local_x: f64| {
        let t = (local_x / 12.0).clamp(0.0, 1.0);
        [1.0 - t, 0.0, t, (128.0 * (1.0 - t) + 64.0 * t) / 255.0]
    };
    assert_pixels(&actual, viewport, |x, y| {
        rgba(
            gradient(f64::from(x) + 0.5 - f64::from(g.origin.tx)),
            coverage(&layer, &g, geometry, x, y),
            g.opacity,
        )
    });
    let mut shifted_would_differ = 0;
    for y in 0..SIZE.1 {
        for x in 0..SIZE.0 {
            let c = coverage(&layer, &g, geometry, x as i32, y as i32);
            let original = rgba(
                gradient(f64::from(x) + 0.5 - f64::from(g.origin.tx)),
                c,
                g.opacity,
            );
            let shifted = rgba(
                gradient(f64::from(x) + 0.5 - f64::from(g.origin.tx) - 2.0),
                c,
                g.opacity,
            );
            shifted_would_differ +=
                usize::from(original.iter().zip(shifted).any(|(a, b)| a.abs_diff(b) > 2));
        }
    }
    assert!(
        shifted_would_differ > 20,
        "fixture must distinguish a translated ramp"
    );
}

#[test]
fn holes_and_same_direction_internal_contours_reach_actual_pixels() {
    let (_, mut g) = fixture();
    g.origin = Transform::from_translate(12.5, 10.5);
    let layer = layer(vec![band([0.0, 0.0], 0.0, 0.5)], 0, 0.5);
    let viewport = PaintViewport::from(SIZE);
    let mut center_alpha = Vec::new();
    for same_direction in [false, true] {
        let geometry = Geometry {
            outer: [-6.0, -5.0, 8.0, 7.0],
            inner: Some(([-2.0, -1.0, 4.0, 3.0], same_direction)),
        };
        let (actual, _) = render(&layer, &g, geometry, viewport);
        assert_pixels(&actual, viewport, |x, y| {
            rgba([1.0; 4], coverage(&layer, &g, geometry, x, y), 1.0)
        });
        center_alpha.push(actual.data()[((11 * SIZE.0 + 13) * 4 + 3) as usize]);
    }
    assert_eq!(center_alpha, [0, 255]);
}

#[test]
fn each_glyph_intersects_its_own_bands_before_ordered_source_over() {
    let (_, mut first) = fixture();
    first.origin = Transform::from_translate(4.0, 4.0);
    first.opacity = 0.5;
    first.fill = [1.0, 0.0, 0.0, 0.5];
    let mut second = first.clone();
    second.origin = Transform::from_translate(8.0, 4.0);
    second.opacity = 0.6;
    second.fill = [0.0, 0.0, 1.0, 0.6];
    let geometry = Geometry::rectangle([0.0, 0.0, 8.0, 8.0]);
    let mut layer = layer(
        vec![band([0.0, 0.0], 0.0, 0.5), band([3.0, 0.0], 0.0, 0.5)],
        0,
        0.5,
    );
    layer.paint = ScenePaint::NodeFill;
    let viewport = PaintViewport::from(SIZE);
    let mut results = Vec::new();
    for glyphs in [
        vec![first.clone(), second.clone()],
        vec![second.clone(), first.clone()],
    ] {
        let ops = record(
            &layer,
            &glyphs,
            &[
                Shape::Outline(geometry.path()),
                Shape::Outline(geometry.path()),
            ],
            viewport,
            &mut Budget::default(),
        )
        .unwrap();
        assert_eq!(ops.ops.len(), 2);
        let actual = replay(&ops, viewport);
        assert_pixels(&actual, viewport, |x, y| {
            let mut destination = [0.0; 4];
            for g in &glyphs {
                let straight = [g.fill[0], g.fill[1], g.fill[2], 1.0];
                let source = rgba(straight, coverage(&layer, g, geometry, x, y), g.opacity);
                let source = source.map(|n| f64::from(n) / 255.0);
                for c in 0..4 {
                    destination[c] = source[c] + destination[c] * (1.0 - source[3]);
                }
            }
            destination.map(|n| (n * 255.0).round() as u8)
        });
        results.push(actual);
    }
    assert!(
        results[0]
            .data()
            .iter()
            .zip(results[1].data())
            .any(|(a, b)| a.abs_diff(*b) > 20)
    );
    assert!(
        results[0]
            .data()
            .chunks_exact(4)
            .zip(results[1].data().chunks_exact(4))
            .all(|(a, b)| a[3] == b[3])
    );
}

#[test]
fn positive_and_negative_viewport_origins_preserve_global_quad_phase() {
    let (_, mut g) = fixture();
    g.origin = Transform::from_translate(0.25, -1.75);
    let geometry = Geometry::rectangle([-5.0, -3.0, 12.0, 9.0]);
    let layer = layer(
        vec![band([0.5, -0.25], 0.0, 0.3), band([-0.75, 1.25], 0.1, 0.8)],
        1,
        0.75,
    );
    let full = PaintViewport {
        origin: [-16, -12],
        size: (40, 30),
        captured: false,
    };
    let (reference, _) = render(&layer, &g, geometry, full);
    assert_pixels(&reference, full, |x, y| {
        rgba([1.0; 4], coverage(&layer, &g, geometry, x, y), 1.0)
    });
    for (origin, size) in [([-7, -5], (19, 17)), ([3, 1], (13, 11))] {
        let viewport = PaintViewport {
            origin,
            size,
            captured: false,
        };
        let (crop, _) = render(&layer, &g, geometry, viewport);
        assert_pixels(&crop, viewport, |x, y| {
            rgba([1.0; 4], coverage(&layer, &g, geometry, x, y), 1.0)
        });
        for y in 0..size.1 {
            for x in 0..size.0 {
                let full_x = x as i32 + origin[0] - full.origin[0];
                let full_y = y as i32 + origin[1] - full.origin[1];
                let a = ((y * size.0 + x) * 4) as usize;
                let b = ((full_y as u32 * full.size.0 + full_x as u32) * 4) as usize;
                assert_eq!(&crop.data()[a..a + 4], &reference.data()[b..b + 4]);
            }
        }
    }
}

#[test]
fn collapsed_band_has_explicit_error_or_inclusive_step_behavior() {
    let (_, g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 8.0, 6.0]);
    let mut value = band([0.0, 0.0], 0.0, 0.0);
    value["distanceClamp"] = json!([0.0, 0.0]);
    let mut layer = layer(vec![value], 0, 0.75);
    let viewport = PaintViewport::from(SIZE);
    let (actual, _) = render(&layer, &g, geometry, viewport);
    assert!(
        actual
            .data()
            .chunks_exact(4)
            .all(|p| p == [255, 255, 255, 255]),
        "inclusive zero plateau must include every viewport pixel"
    );
    layer.distance_coverage.as_mut().unwrap().zero_width = GlyphDistanceZeroWidth::Error;
    let error = record(
        &layer,
        std::slice::from_ref(&g),
        &[Shape::Outline(geometry.path())],
        viewport,
        &mut Budget::default(),
    );
    assert!(
        error
            .err()
            .unwrap()
            .to_string()
            .contains("zero-width glyph distance band")
    );
}

#[test]
fn clamped_distance_floor_can_paint_far_outside_the_original_contour() {
    let (_, g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 8.0, 6.0]);
    let mut value = band([0.0, 0.0], 0.0, 1.0);
    value["distanceClamp"] = json!([-0.25, 0.75]);
    let layer = layer(vec![value], 0, 0.75);
    let viewport = PaintViewport::from(SIZE);
    let (actual, _) = render(&layer, &g, geometry, viewport);
    assert_pixels(&actual, viewport, |x, y| {
        rgba([1.0; 4], coverage(&layer, &g, geometry, x, y), 1.0)
    });
    let last = ((SIZE.0 * SIZE.1 - 1) * 4) as usize;
    assert_eq!(&actual.data()[last..last + 4], &[96, 96, 96, 96]);
}

#[test]
fn pixel_em_units_scale_all_band_distances_consistently() {
    let (_, g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 8.0, 6.0]);
    let mut px = layer(vec![band([1.5, -0.75], 0.25, 0.5)], 0, 0.5);
    let px_band = &mut px.distance_coverage.as_mut().unwrap().bands[0];
    px_band.distance_clamp = Some([-0.25, 1.0]);
    px_band.threshold_clamp = Some([-0.5, 0.5]);
    px_band.edge_clamp = Some([-1.0, 1.0]);
    let mut em = px.clone();
    em.unit = PaintUnit::Em;
    let em_size = f64::from(f32::from_bits(g.glyph.cache_key.font_size_bits));
    for band in &mut em.distance_coverage.as_mut().unwrap().bands {
        band.offset = band.offset.map(|v| v / em_size);
        band.threshold /= em_size;
        band.half_width /= em_size;
        band.distance_clamp = band.distance_clamp.map(|r| r.map(|v| v / em_size));
        band.threshold_clamp = band.threshold_clamp.map(|r| r.map(|v| v / em_size));
        band.edge_clamp = band.edge_clamp.map(|r| r.map(|v| v / em_size));
    }
    let viewport = PaintViewport::from(SIZE);
    assert_eq!(
        render(&px, &g, geometry, viewport).0.data(),
        render(&em, &g, geometry, viewport).0.data()
    );
}

#[test]
fn budgets_and_bitmap_glyphs_reject_before_any_node_paint_is_recorded() {
    let (mut text, g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 8.0, 6.0]);
    let layer = layer(vec![band([0.0, 0.0], 0.0, 0.5)], 0, 0.5);
    let bitmap = Shape::Bitmap(
        BitmapData {
            width: 1,
            height: 1,
            rgba: Arc::from([255_u8; 4]),
        },
        0,
        0,
    );
    let result = record(
        &layer,
        std::slice::from_ref(&g),
        &[bitmap],
        PaintViewport::from(SIZE),
        &mut Budget::default(),
    );
    assert!(
        result
            .err()
            .unwrap()
            .to_string()
            .contains("requires outline glyphs")
    );
    let result = record(
        &layer,
        std::slice::from_ref(&g),
        &[Shape::Outline(geometry.path())],
        PaintViewport::from((4097, 4096)),
        &mut Budget::default(),
    );
    assert!(
        result
            .err()
            .unwrap()
            .to_string()
            .contains("glyph distance viewport")
    );
    for kind in ["distance", "pixels", "operations"] {
        let mut budget = Budget::default();
        match kind {
            "distance" => budget
                .reserve_glyph_distance_work(128 * 1024 * 1024)
                .unwrap(),
            "pixels" => budget.reserve_image_paint_pixels(16 * 1024 * 1024).unwrap(),
            "operations" => budget = Budget::new(0),
            _ => unreachable!(),
        }
        let mut style: TextStyle = serde_json::from_value(
            json!({"paints":[{"id":"legacy-first","paint":{"kind":"solid","color":"#FFFFFF"}}]}),
        )
        .unwrap();
        style.paints.push(layer.clone());
        let mut builder = FrameBuilder::default();
        let result = text_paint::record_glyphs(
            &style,
            std::slice::from_ref(&g),
            SIZE,
            &mut text,
            &BTreeMap::new(),
            &mut builder,
            &mut budget,
        );
        assert!(result.is_err(), "{kind} budget must reject");
        assert!(
            builder.frame.ops.is_empty(),
            "{kind} rejection must precede legacy paint recording"
        );
    }
}

#[test]
fn absent_distance_field_keeps_legacy_vector_ops_and_pixels() {
    let (mut text, g) = fixture();
    let style: TextStyle = serde_json::from_value(
        json!({"paints":[{"id":"legacy","paint":{"kind":"solid","color":"#FFFFFF"}}]}),
    )
    .unwrap();
    let mut actual = FrameBuilder::default();
    text_paint::record_glyphs(
        &style,
        std::slice::from_ref(&g),
        SIZE,
        &mut text,
        &BTreeMap::new(),
        &mut actual,
        &mut Budget::default(),
    )
    .unwrap();
    let actual = actual.finish();
    assert!(actual.bitmaps.is_empty());
    assert!(
        actual
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::FillPathPaint { .. }))
    );
    let GlyphRender::Outline(path) = text.glyph_render(g.glyph.cache_key) else {
        panic!("fixture outline disappeared")
    };
    let mut expected = FrameBuilder::default();
    let id = expected.path_id(path_from_skia(&path));
    let paint = expected.paint_id(PaintData::Solid([1.0; 4]));
    expected.push(DrawOp::FillPathPaint {
        path: id,
        paint,
        even_odd: false,
        tf: tf(g.origin),
    });
    let expected = expected.finish();
    assert_eq!(
        render_raster::drawop::encode(&actual),
        render_raster::drawop::encode(&expected)
    );
    assert_eq!(
        replay(&actual, PaintViewport::from(SIZE)).data(),
        replay(&expected, PaintViewport::from(SIZE)).data()
    );
}

#[test]
fn real_scene_plan_uses_distance_pixels_and_replays_identically() {
    let (text, _) = fixture();
    let mut body: Value = serde_json::from_str(include_str!(
        "../../../caption-scene/tests/fixtures/word-pop.json"
    ))
    .unwrap();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"] = json!([
        "caption-scene/1",
        "caption-expressions/1",
        "caption-paint-stack/1",
        "caption-glyph-distance-coverage/1"
    ]);
    scene["animations"] = json!([]);
    scene["layout"]["width"] = json!({"value":120,"basis":"absolute"});
    scene["layout"]["x"] = json!({"value":64,"basis":"absolute"});
    scene["layout"]["y"] = json!({"value":48,"basis":"absolute"});
    scene["nodes"][0]["style"] = json!({"fontFamily":"VK Sans","fontWeight":400,"fontSize":{"value":24,"basis":"absolute"},"fill":"#FFFFFF",
        "paints":[serde_json::to_value(layer(vec![band([0.0,0.0],0.0,0.5),band([0.75,-0.5],0.0,0.5)],1,0.5)).unwrap()]});
    let style = parse_style(&body).unwrap();
    let mut plan = ScenePlan::compile(
        style,
        Default::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "HO".into(),
            start: 0.0,
            end: 2.0,
            words: vec![],
        }],
        (128, 96),
        text,
        "distance-fixture".into(),
    )
    .unwrap();
    let (ops, _) = plan.record(0.5).unwrap();
    assert!(
        ops.ops
            .iter()
            .any(|op| matches!(op, DrawOp::DrawBitmap { .. }))
    );
    assert!(
        ops.bitmaps
            .iter()
            .any(|image| image.rgba.chunks_exact(4).any(|p| p[3] > 0))
    );
    let encoded = render_raster::drawop::encode(&ops);
    let (_, decoded) = render_raster::drawop::decode(&encoded).unwrap();
    let replayed = rasterize_with_media(&decoded, 128, 96, &mut NoMedia).unwrap();
    assert_eq!(replayed.data(), plan.render(0.5).unwrap().rgba.as_ref());
    assert_eq!(
        encoded,
        render_raster::drawop::encode(&plan.record(0.5).unwrap().0)
    );
}

fn image_layer(bands: Vec<Value>, paint: Value) -> PaintLayer {
    let mut layer = layer(bands, 0, 0.5);
    layer.paint = serde_json::from_value(paint).unwrap();
    layer
}

fn image_paint() -> Value {
    json!({"kind":"image","resourceId":"texture","space":"glyph-normalized",
        "uvTransform":[1,0,0,1,0,0],"filter":"nearest","wrap":"clamp"})
}

fn palette_image(pixels: Vec<u8>) -> BTreeMap<String, BitmapData> {
    BTreeMap::from([(
        "texture".into(),
        BitmapData {
            width: (pixels.len() / 4) as u32,
            height: 1,
            rgba: Arc::from(pixels),
        },
    )])
}

fn render_image(
    layer: &PaintLayer,
    glyphs: &[GlyphPaint],
    geometry: Geometry,
    viewport: PaintViewport,
    images: &BTreeMap<String, BitmapData>,
) -> (Pixmap, FrameOps) {
    let shapes = glyphs
        .iter()
        .map(|_| Shape::Outline(geometry.path()))
        .collect::<Vec<_>>();
    let ops = record_images(
        layer,
        glyphs,
        &shapes,
        viewport,
        images,
        &mut Budget::default(),
    )
    .unwrap();
    (replay(&ops, viewport), ops)
}

/// Independent associated-color arithmetic, before the single RGBA8 conversion.
fn image_rgba(
    image: [u8; 4],
    base: [f64; 4],
    image_opacity: f64,
    coverage_opacity: f64,
) -> [u8; 4] {
    let image_alpha = f64::from(image[3]) / 255.0 * image_opacity;
    std::array::from_fn(|c| {
        ((f64::from(image[c]) / 255.0 * image_opacity + base[c] * (1.0 - image_alpha))
            * coverage_opacity
            * 255.0)
            .round()
            .clamp(0.0, 255.0) as u8
    })
}

#[test]
fn distance_image_samples_unshifted_glyph_uv_after_displaced_contour_coverage() {
    let (_, g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 12.0, 8.0]);
    let images = palette_image(vec![
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
    ]);
    let layer = image_layer(vec![band([2.0, -1.0], 0.0, 0.5)], image_paint());
    let viewport = PaintViewport::from(SIZE);
    let (actual, ops) = render_image(
        &layer,
        std::slice::from_ref(&g),
        geometry,
        viewport,
        &images,
    );
    let palette = [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
    ];
    let at = |local_x: f64| (local_x / 12.0 * 4.0).floor().clamp(0.0, 3.0) as usize;
    assert_pixels(&actual, viewport, |x, y| {
        let local_x = f64::from(x) + 0.5 - f64::from(g.origin.tx);
        image_rgba(
            palette[at(local_x)],
            [0.0; 4],
            1.0,
            coverage(&layer, &g, geometry, x, y),
        )
    });
    let mut sensitive = 0;
    for y in 0..SIZE.1 as i32 {
        for x in 0..SIZE.0 as i32 {
            let local_x = f64::from(x) + 0.5 - f64::from(g.origin.tx);
            if coverage(&layer, &g, geometry, x, y) > 0.5 && at(local_x) != at(local_x - 2.0) {
                sensitive += 1;
            }
        }
    }
    assert!(
        sensitive > 8,
        "fixture must distinguish contour displacement from UV displacement"
    );
    assert!(
        ops.paths.is_empty(),
        "image distance must not add legacy glyph AA"
    );
    let encoded = render_raster::drawop::encode(&ops);
    let (_, decoded) = render_raster::drawop::decode(&encoded).unwrap();
    assert_eq!(replay(&decoded, viewport).data(), actual.data());
}

#[test]
fn distance_image_base_and_both_opacities_are_composited_before_single_rounding() {
    let (_, mut g) = fixture();
    g.opacity = 0.4;
    let geometry = Geometry::rectangle([0.0, 0.0, 12.0, 8.0]);
    let images = palette_image(vec![128, 0, 0, 128]);
    let mut paint = image_paint();
    paint["opacity"] = json!(0.5);
    paint["compositeOpacity"] = json!(0.6);
    paint["base"] = json!({"kind":"solid","color":"#00FF0080"});
    let layer = image_layer(vec![band([0.0, 0.0], 0.0, 0.75)], paint.clone());
    let viewport = PaintViewport::from(SIZE);
    let (solid, _) = render_image(
        &layer,
        std::slice::from_ref(&g),
        geometry,
        viewport,
        &images,
    );
    let base = [0.0, 128.0 / 255.0, 0.0, 128.0 / 255.0];
    assert_pixels(&solid, viewport, |x, y| {
        image_rgba(
            [128, 0, 0, 128],
            base,
            0.5,
            coverage(&layer, &g, geometry, x, y) * 0.4 * 0.6,
        )
    });
    // Node-fill already carries glyph opacity; preparing the base must remove it.
    g.fill = [0.0, 1.0, 0.0, 128.0 / 255.0 * g.opacity];
    paint["base"] = json!({"kind":"node-fill"});
    let node_layer = image_layer(vec![band([0.0, 0.0], 0.0, 0.75)], paint);
    let (node_fill, _) = render_image(
        &node_layer,
        std::slice::from_ref(&g),
        geometry,
        viewport,
        &images,
    );
    assert_eq!(solid.data(), node_fill.data());
    // The oracle includes fractional edges, so applying coverage/composite twice is observable.
    let mut sensitive = 0;
    for y in 0..SIZE.1 as i32 {
        for x in 0..SIZE.0 as i32 {
            let c = coverage(&layer, &g, geometry, x, y);
            let once = image_rgba([128, 0, 0, 128], base, 0.5, c * 0.4 * 0.6);
            let twice = image_rgba([128, 0, 0, 128], base, 0.5, c * c * 0.4 * 0.6 * 0.6);
            if once[3].abs_diff(twice[3]) > 2 {
                sensitive += 1;
            }
        }
    }
    assert!(sensitive > 10);
}

#[test]
fn distance_image_phase_uses_logical_cue_scalar_and_exact_float32_arithmetic() {
    let (_, mut g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 12.0, 8.0]);
    let images = palette_image(vec![
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
    ]);
    // A nonzero matrix is retained, but the entire fixture stays within one phase-selected texel.
    for (index, arithmetic, expected) in [
        (3, "integer-modulo", [255, 0, 0, 255]),
        (65536, "integer-modulo", [0, 255, 0, 255]),
        (65536, "float32", [0, 255, 0, 255]),
    ] {
        g.source_scalar_index = index;
        let mut paint = image_paint();
        paint["uvTransform"] = json!([0.001, 0, 0, 0.001, 0.0, 0.5]);
        paint["wrap"] = json!("repeat");
        paint["phase"] = if arithmetic == "float32" {
            json!({"period":3,"source":"cue-scalar-index","arithmetic":"float32","indexOffset":0.000001})
        } else {
            json!({"period":3,"source":"cue-scalar-index"})
        };
        let layer = image_layer(vec![band([1.5, 0.0], 0.0, 0.5)], paint);
        let viewport = PaintViewport::from(SIZE);
        let (actual, _) = render_image(
            &layer,
            std::slice::from_ref(&g),
            geometry,
            viewport,
            &images,
        );
        assert_pixels(&actual, viewport, |x, y| {
            image_rgba(
                expected,
                [0.0; 4],
                1.0,
                coverage(&layer, &g, geometry, x, y),
            )
        });
    }
    // Float32 rounds 32 + 1e-6 to32 exactly; a subtexel threshold detects a static-offset substitute.
    g.source_scalar_index = 32;
    let mut paint = image_paint();
    paint["uvTransform"] = json!([0.00000001, 0, 0, 0.00000001, 0.4999995, 0.5]);
    paint["phase"] = json!({"period":1,"source":"cue-scalar-index","arithmetic":"float32","indexOffset":0.000001});
    let layer = image_layer(vec![band([0.0, 0.0], 0.0, 0.5)], paint);
    let images = palette_image(vec![255, 0, 0, 255, 0, 0, 255, 255]);
    let viewport = PaintViewport::from(SIZE);
    let (actual, _) = render_image(
        &layer,
        std::slice::from_ref(&g),
        geometry,
        viewport,
        &images,
    );
    assert_pixels(&actual, viewport, |x, y| {
        image_rgba(
            [255, 0, 0, 255],
            [0.0; 4],
            1.0,
            coverage(&layer, &g, geometry, x, y),
        )
    });
}

#[test]
fn overlapping_distance_images_apply_glyph_opacity_before_ordered_source_over() {
    let (_, mut first) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 12.0, 8.0]);
    first.opacity = 0.4;
    let mut second = first.clone();
    second.origin = Transform::from_translate(9.25, 6.75);
    second.opacity = 0.7;
    second.source_scalar_index = 1;
    let mut paint = image_paint();
    paint["uvTransform"] = json!([0.001, 0, 0, 0.001, 0.0, 0.5]);
    paint["phase"] = json!({"period":2,"source":"cue-scalar-index"});
    let layer = image_layer(vec![band([1.0, -0.5], 0.0, 0.5)], paint);
    let images = palette_image(vec![128, 0, 0, 128, 0, 0, 128, 128]);
    let viewport = PaintViewport::from(SIZE);
    let (actual, _) = render_image(
        &layer,
        &[first.clone(), second.clone()],
        geometry,
        viewport,
        &images,
    );
    let mut sensitive = 0;
    assert_pixels(&actual, viewport, |x, y| {
        let a = image_rgba(
            [128, 0, 0, 128],
            [0.0; 4],
            1.0,
            coverage(&layer, &first, geometry, x, y) * first.opacity,
        );
        let b = image_rgba(
            [0, 0, 128, 128],
            [0.0; 4],
            1.0,
            coverage(&layer, &second, geometry, x, y) * second.opacity,
        );
        std::array::from_fn(|c| {
            (u32::from(b[c]) + (u32::from(a[c]) * u32::from(255 - b[3]) + 127) / 255).min(255) as u8
        })
    });
    for y in 0..SIZE.1 as i32 {
        for x in 0..SIZE.0 as i32 {
            if coverage(&layer, &first, geometry, x, y) > 0.5
                && coverage(&layer, &second, geometry, x, y) > 0.5
            {
                sensitive += 1;
            }
        }
    }
    assert!(
        sensitive > 8,
        "fixture must include an actual overlapping coverage region"
    );
}

#[test]
fn distance_image_resource_or_sampling_preflight_fails_before_any_node_draw_op() {
    let (mut text, g) = fixture();
    let mut style: TextStyle = serde_json::from_value(
        json!({"paints":[{"id":"ordinary-first","paint":{"kind":"solid","color":"#FFFFFF"}}]}),
    )
    .unwrap();
    style
        .paints
        .push(image_layer(vec![band([0.0, 0.0], 0.0, 0.5)], image_paint()));
    let invalid = BTreeMap::from([(
        "texture".into(),
        BitmapData {
            width: 2,
            height: 1,
            rgba: Arc::from([0_u8; 4]),
        },
    )]);
    for images in [BTreeMap::new(), invalid] {
        let mut builder = FrameBuilder::default();
        let result = text_paint::record_glyphs(
            &style,
            std::slice::from_ref(&g),
            SIZE,
            &mut text,
            &images,
            &mut builder,
            &mut Budget::default(),
        );
        assert!(result.is_err());
        assert!(
            builder.frame.ops.is_empty(),
            "later image distance failure must precede the ordinary paint"
        );
    }
    let images = palette_image(vec![255, 255, 255, 255]);
    for kind in ["distance", "pixels", "image-work"] {
        let mut budget = Budget::default();
        match kind {
            "distance" => budget
                .reserve_glyph_distance_work(128 * 1024 * 1024)
                .unwrap(),
            "pixels" => budget.reserve_image_paint_pixels(16 * 1024 * 1024).unwrap(),
            "image-work" => budget.reserve_image_paint_work(256 * 1024 * 1024).unwrap(),
            _ => unreachable!(),
        }
        let mut builder = FrameBuilder::default();
        assert!(
            text_paint::record_glyphs(
                &style,
                std::slice::from_ref(&g),
                SIZE,
                &mut text,
                &images,
                &mut builder,
                &mut budget
            )
            .is_err()
        );
        assert!(
            builder.frame.ops.is_empty(),
            "{kind} must fail before ordinary paint recording"
        );
    }
}

#[test]
fn distance_image_rounds_only_after_fractional_coverage_and_all_opacity_factors() {
    let (_, mut g) = fixture();
    g.opacity = 0.4;
    let geometry = Geometry::rectangle([0.0, 0.0, 8.0, 6.0]);
    let images = palette_image(vec![26, 0, 0, 128]);
    let mut paint = image_paint();
    paint["opacity"] = json!(0.51);
    paint["compositeOpacity"] = json!(0.6);
    paint["base"] = json!({"kind":"solid","color":"#800000FF"});
    let mut value = band([0.0, 0.0], 0.0, 0.5);
    value["distanceClamp"] = json!([-0.25, 0.75]);
    let mut layer = image_layer(vec![value], paint);
    layer.distance_coverage.as_mut().unwrap().aa = GlyphDistanceAa::QuadDerivative {
        source_band: 0,
        scale: 0.0,
    };
    let viewport = PaintViewport::from(SIZE);
    let (actual, _) = render_image(
        &layer,
        std::slice::from_ref(&g),
        geometry,
        viewport,
        &images,
    );
    // This far-outside pixel has distance clamped to-0.25: coverage is exactly0.25.
    // The independent formula fixes the byte oracle before any implementation rounding.
    let expected = image_rgba(
        [26, 0, 0, 128],
        [128.0 / 255.0, 0.0, 0.0, 1.0],
        0.51,
        0.25 * 0.4 * 0.6,
    );
    assert_eq!(expected, [7, 0, 0, 15]);
    let at = ((SIZE.1 - 1) * SIZE.0 + SIZE.0 - 1) as usize * 4;
    assert_eq!(&actual.data()[at..at + 4], &expected);
    // Rounding the image-over-base toU8 before coverage would produce red6.
    let prematurely_rounded =
        image_rgba([26, 0, 0, 128], [128.0 / 255.0, 0.0, 0.0, 1.0], 0.51, 1.0);
    assert_eq!(
        (f64::from(prematurely_rounded[0]) * 0.25 * 0.4 * 0.6).round() as u8,
        6
    );
}

#[test]
fn distance_image_odd_negative_viewport_origins_keep_original_uv_and_global_quad_phase() {
    let (_, g) = fixture();
    let geometry = Geometry::rectangle([0.0, 0.0, 12.0, 8.0]);
    let images = palette_image(vec![255, 0, 0, 255, 0, 0, 255, 255]);
    let layer = image_layer(vec![band([1.25, -0.75], 0.0, 0.75)], image_paint());
    let full_viewport = PaintViewport::from(SIZE);
    let (full, _) = render_image(
        &layer,
        std::slice::from_ref(&g),
        geometry,
        full_viewport,
        &images,
    );
    for origin in [[3, 5], [-3, -1]] {
        let viewport = PaintViewport {
            origin,
            size: (21, 17),
            captured: false,
        };
        let (actual, _) = render_image(
            &layer,
            std::slice::from_ref(&g),
            geometry,
            viewport,
            &images,
        );
        for y in 0..viewport.size.1 {
            for x in 0..viewport.size.0 {
                let gx = origin[0] + x as i32;
                let gy = origin[1] + y as i32;
                if gx >= 0 && gy >= 0 && gx < SIZE.0 as i32 && gy < SIZE.1 as i32 {
                    let at = ((y * viewport.size.0 + x) * 4) as usize;
                    let expected = ((gy as u32 * SIZE.0 + gx as u32) * 4) as usize;
                    assert_eq!(
                        &actual.data()[at..at + 4],
                        &full.data()[expected..expected + 4],
                        "origin={origin:?}, local=({x},{y})"
                    );
                }
            }
        }
    }
}
