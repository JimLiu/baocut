use render_raster::glyph_distance::ContourDistance;
use tiny_skia::{Path, PathBuilder};

fn assert_near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "expected {expected}, got {actual}, tolerance {tolerance}"
    );
}

fn add_rectangle(builder: &mut PathBuilder, bounds: [f32; 4], reverse: bool, close: bool) {
    let [left, top, right, bottom] = bounds;
    builder.move_to(left, top);
    if reverse {
        builder.line_to(left, bottom);
        builder.line_to(right, bottom);
        builder.line_to(right, top);
    } else {
        builder.line_to(right, top);
        builder.line_to(right, bottom);
        builder.line_to(left, bottom);
    }
    if close {
        builder.close();
    }
}

fn rectangle(bounds: [f32; 4]) -> Path {
    let mut builder = PathBuilder::new();
    add_rectangle(&mut builder, bounds, false, true);
    builder.finish().unwrap()
}

#[test]
fn rectangle_distance_matches_analytic_edges_corners_and_negative_coordinates() {
    let field = ContourDistance::from_path(&rectangle([-6.0, -5.0, 8.0, 7.0]), 0.01).unwrap();
    assert_eq!(field.bounds(), [-6.0, -5.0, 8.0, 7.0]);
    assert_eq!(field.segment_count(), 4);
    assert!(!field.is_empty());
    for (point, expected) in [
        ([1.0, 1.0], 6.0),
        ([-5.5, -4.0], 0.5),
        ([8.0, 3.0], 0.0),
        ([-6.0, -5.0], 0.0),
        ([-10.0, -8.0], -5.0),
        ([11.0, 11.0], -5.0),
        ([12.0, 0.0], -4.0),
        ([0.0, -8.0], -3.0),
    ] {
        assert_near(field.sample(point).unwrap(), expected, 1e-12);
    }
}

#[test]
fn reversing_the_outer_winding_keeps_the_interior_positive() {
    let mut builder = PathBuilder::new();
    add_rectangle(&mut builder, [-6.0, -5.0, 8.0, 7.0], true, true);
    let field = ContourDistance::from_path(&builder.finish().unwrap(), 0.01).unwrap();
    assert_near(field.sample([1.0, 1.0]).unwrap(), 6.0, 1e-12);
    assert_near(field.sample([11.0, 11.0]).unwrap(), -5.0, 1e-12);
}

#[test]
fn reversed_inner_contour_creates_a_nonzero_winding_hole() {
    let mut builder = PathBuilder::new();
    add_rectangle(&mut builder, [-6.0, -5.0, 8.0, 7.0], false, true);
    add_rectangle(&mut builder, [-2.0, -1.0, 4.0, 3.0], true, true);
    let field = ContourDistance::from_path(&builder.finish().unwrap(), 0.01).unwrap();
    assert_eq!(field.segment_count(), 8);
    for (point, expected) in [
        ([1.0, 1.0], -2.0),
        ([3.75, 1.0], -0.25),
        ([4.25, 1.0], 0.25),
        ([-2.0, 1.0], 0.0),
        ([-4.0, 1.0], 2.0),
        ([10.0, 1.0], -2.0),
    ] {
        assert_near(field.sample(point).unwrap(), expected, 1e-12);
    }
}

#[test]
fn same_direction_inner_contour_remains_a_distance_source_inside_filled_area() {
    let mut builder = PathBuilder::new();
    add_rectangle(&mut builder, [-6.0, -5.0, 8.0, 7.0], false, true);
    add_rectangle(&mut builder, [-2.0, -1.0, 4.0, 3.0], false, true);
    let field = ContourDistance::from_path(&builder.finish().unwrap(), 0.01).unwrap();
    // Winding two is still filled; its original inner contour is not removed by a union.
    assert_near(field.sample([1.0, 1.0]).unwrap(), 2.0, 1e-12);
    assert_near(field.sample([3.75, 1.0]).unwrap(), 0.25, 1e-12);
    assert_near(field.sample([4.25, 1.0]).unwrap(), 0.25, 1e-12);
    assert_near(field.sample([-2.0, 1.0]).unwrap(), 0.0, 1e-12);
}

#[test]
fn implicit_closure_occurs_at_move_and_at_end_without_connecting_contours() {
    let mut builder = PathBuilder::new();
    add_rectangle(&mut builder, [0.0, 0.0, 8.0, 6.0], false, false);
    add_rectangle(&mut builder, [20.0, 0.0, 24.0, 6.0], false, false);
    let field = ContourDistance::from_path(&builder.finish().unwrap(), 0.01).unwrap();
    assert_eq!(field.segment_count(), 8);
    assert_eq!(field.bounds(), [0.0, 0.0, 24.0, 6.0]);
    for (point, expected) in [
        ([0.0, 3.0], 0.0),
        ([1.0, 3.0], 1.0),
        ([20.0, 3.0], 0.0),
        ([21.0, 3.0], 1.0),
        ([12.0, 3.0], -4.0),
    ] {
        assert_near(field.sample(point).unwrap(), expected, 1e-12);
    }
}

#[test]
fn quadratic_curve_tracks_analytic_parabola_within_requested_tolerance() {
    let mut builder = PathBuilder::new();
    builder.move_to(-4.0, 0.0);
    builder.quad_to(0.0, 8.0, 4.0, 0.0);
    builder.close();
    let tolerance = 0.002;
    let field = ContourDistance::from_path(&builder.finish().unwrap(), tolerance).unwrap();
    // Bounds retain the conservative control-point box, rather than the curve's tight box.
    assert_eq!(field.bounds(), [-4.0, 0.0, 4.0, 8.0]);
    for step in 0..=64 {
        let t = f64::from(step) / 64.0;
        let point = [-4.0 + 8.0 * t, 16.0 * t * (1.0 - t)];
        assert!(field.sample(point).unwrap().abs() <= tolerance + 1e-12);
    }
    for (point, expected) in [
        ([0.0, 5.0], -1.0),
        ([0.0, -2.0], -2.0),
        ([0.0, 1.0], 1.0),
        ([0.0, 3.0], 1.0),
    ] {
        assert_near(field.sample(point).unwrap(), expected, tolerance);
    }
}

#[test]
fn cubic_curve_tracks_exact_bezier_points_and_extremum_distances() {
    let mut builder = PathBuilder::new();
    builder.move_to(-4.0, 0.0);
    builder.cubic_to(-4.0, 6.0, 4.0, 6.0, 4.0, 0.0);
    builder.close();
    let tolerance = 0.002;
    let field = ContourDistance::from_path(&builder.finish().unwrap(), tolerance).unwrap();
    assert_eq!(field.bounds(), [-4.0, 0.0, 4.0, 6.0]);
    for step in 0..=64 {
        let t = f64::from(step) / 64.0;
        let point = [-4.0 + 24.0 * t * t - 16.0 * t * t * t, 18.0 * t * (1.0 - t)];
        assert!(field.sample(point).unwrap().abs() <= tolerance + 1e-12);
    }
    assert_near(field.sample([0.0, 5.5]).unwrap(), -1.0, tolerance);
    assert_near(field.sample([0.0, -2.0]).unwrap(), -2.0, tolerance);
    assert_near(field.sample([0.0, 4.0]).unwrap(), 0.5, tolerance);
}

#[test]
fn degenerate_contours_are_empty_or_unsigned_lines_without_invented_fill() {
    let mut point = PathBuilder::new();
    point.move_to(7.0, -9.0);
    point.line_to(7.0, -9.0);
    let empty = ContourDistance::from_path(&point.finish().unwrap(), 0.01).unwrap();
    assert!(empty.is_empty());
    assert_eq!(empty.segment_count(), 0);
    assert_eq!(empty.bounds(), [7.0, -9.0, 7.0, -9.0]);
    assert!(empty.sample([7.0, -9.0]).is_err());

    let mut line = PathBuilder::new();
    line.move_to(-3.0, -2.0);
    line.line_to(3.0, -2.0);
    line.line_to(3.0, -2.0);
    let line = ContourDistance::from_path(&line.finish().unwrap(), 0.01).unwrap();
    assert_eq!(line.segment_count(), 2);
    assert_near(line.sample([0.0, -2.0]).unwrap(), 0.0, 1e-12);
    assert_near(line.sample([0.0, 2.0]).unwrap(), -4.0, 1e-12);
    assert_near(line.sample([6.0, 2.0]).unwrap(), -5.0, 1e-12);
}

#[test]
fn invalid_tolerances_and_samples_are_rejected() {
    let path = rectangle([0.0, 0.0, 8.0, 6.0]);
    for tolerance in [
        0.0,
        -0.01,
        256.01,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NAN,
    ] {
        assert!(ContourDistance::from_path(&path, tolerance).is_err());
    }
    let field = ContourDistance::from_path(&path, 256.0).unwrap();
    for point in [[1_000_000.0, 0.0], [-1_000_000.0, 0.0], [0.0, 1_000_000.0]] {
        assert!(field.sample(point).is_ok());
    }
    for point in [
        [f64::NAN, 0.0],
        [0.0, f64::NAN],
        [f64::INFINITY, 0.0],
        [0.0, f64::NEG_INFINITY],
        [f64::MAX, f64::MAX],
        [1_000_001.0, 0.0],
        [-1_000_001.0, 0.0],
        [0.0, 1e20],
    ] {
        assert!(field.sample(point).is_err());
    }
}

#[test]
fn contour_coordinate_limit_is_inclusive_and_rejects_larger_finite_bounds() {
    for bounds in [
        [999_990.0, 999_990.0, 1_000_000.0, 1_000_000.0],
        [-1_000_000.0, -1_000_000.0, -999_990.0, -999_990.0],
    ] {
        assert!(ContourDistance::from_path(&rectangle(bounds), 0.01).is_ok());
    }
    for bounds in [
        [0.0, 0.0, 1_000_001.0, 1.0],
        [-1_000_001.0, 0.0, 0.0, 1.0],
        [0.0, 0.0, 1.0, 1_000_001.0],
        [0.0, -1_000_001.0, 1.0, 0.0],
    ] {
        assert!(ContourDistance::from_path(&rectangle(bounds), 0.01).is_err());
    }
}

fn polygon(vertex_count: usize) -> Path {
    let mut builder = PathBuilder::new();
    for index in 0..vertex_count {
        let angle = std::f64::consts::TAU * index as f64 / vertex_count as f64;
        let x = (100.0 * angle.cos()) as f32;
        let y = (100.0 * angle.sin()) as f32;
        if index == 0 {
            builder.move_to(x, y);
        } else {
            builder.line_to(x, y);
        }
    }
    builder.close();
    builder.finish().unwrap()
}

#[test]
fn flattened_segment_budget_accepts_exact_limit_and_rejects_one_more() {
    let at_limit = ContourDistance::from_path(&polygon(8192), 0.01).unwrap();
    assert_eq!(at_limit.segment_count(), 8192);
    assert!(at_limit.sample([0.0, 0.0]).unwrap() > 99.0);
    let error = ContourDistance::from_path(&polygon(8193), 0.01).unwrap_err();
    assert!(error.to_string().contains("flattened segments"));
}

fn degenerate_operations(operation_count: usize) -> Path {
    let mut builder = PathBuilder::new();
    builder.move_to(0.0, 0.0);
    for _ in 1..operation_count {
        builder.line_to(0.0, 0.0);
    }
    builder.finish().unwrap()
}

#[test]
fn input_operation_budget_counts_degenerate_operations_too() {
    let at_limit = ContourDistance::from_path(&degenerate_operations(32768), 0.01).unwrap();
    assert!(at_limit.is_empty());
    let error = ContourDistance::from_path(&degenerate_operations(32769), 0.01).unwrap_err();
    assert!(error.to_string().contains("input operations"));
}

#[test]
fn impossible_curve_precision_is_rejected_instead_of_silently_clamped() {
    let mut builder = PathBuilder::new();
    builder.move_to(0.0, 0.0);
    builder.quad_to(1.0, 2.0, 2.0, 0.0);
    let error =
        ContourDistance::from_path(&builder.finish().unwrap(), f64::MIN_POSITIVE).unwrap_err();
    assert!(error.to_string().contains("curve subdivision"));
}
