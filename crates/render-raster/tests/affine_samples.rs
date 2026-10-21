use render_raster::effects::component_filters::{
    Boundary, ComponentImage, GaussianSampling, Size,
    affine_samples::{Config, apply},
};

const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

fn config(width: u32, height: u32) -> Config {
    Config {
        sampling: GaussianSampling {
            input: [0, 0, width, height],
            output: [0.0, 0.0, f64::from(width), f64::from(height)],
        },
        transforms: vec![IDENTITY; 2],
        sample_range: [2, 2],
        distance_range: [0.0, 1.0],
        boundary: Boundary::Transparent,
        output: Size { width, height },
    }
}

fn run(input: &ComponentImage, config: &Config) -> ComponentImage {
    apply(input, config, |_| Ok(())).unwrap()
}

fn dense(width: u32, height: u32) -> ComponentImage {
    ComponentImage::new(
        width,
        height,
        (0..width * height)
            .flat_map(|i| {
                [
                    (i * 37 % 251) as u8,
                    (i * 53 % 239) as u8,
                    (i * 19 % 241) as u8,
                    if i % 3 == 0 { 0 } else { (i * 11 % 97) as u8 },
                ]
            })
            .collect(),
    )
    .unwrap()
}

// Dense bilinear oracle, deliberately independent of support tracking and the
// production texture sampler. Values stay in byte space until the final write.
fn dense_sample(input: &ComponentImage, view: [u32; 4], uv: [f64; 2]) -> [f64; 4] {
    let x = (f64::from(view[0]) + uv[0] * f64::from(view[2]) - 0.5)
        .clamp(f64::from(view[0]), f64::from(view[0] + view[2] - 1));
    let y = (f64::from(view[1]) + uv[1] * f64::from(view[3]) - 0.5)
        .clamp(f64::from(view[1]), f64::from(view[1] + view[3] - 1));
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(view[0] + view[2] - 1);
    let y1 = (y0 + 1).min(view[1] + view[3] - 1);
    std::array::from_fn(|channel| {
        let at = |px: u32, py: u32| {
            f64::from(input.data()[((py * input.width() + px) * 4) as usize + channel])
        };
        let top = at(x0, y0) * (1.0 - x.fract()) + at(x1, y0) * x.fract();
        let bottom = at(x0, y1) * (1.0 - x.fract()) + at(x1, y1) * x.fract();
        top * (1.0 - y.fract()) + bottom * y.fract()
    })
}

#[test]
fn identity_preserves_every_component_including_rgb_at_zero_alpha() {
    let input = dense(7, 5);
    let result = run(&input, &config(7, 5));
    assert_eq!(result.data(), input.data());
    assert!(result.data().chunks_exact(4).any(|p| p[3] == 0 && p[0] > 0));
    assert!(result.data().chunks_exact(4).any(|p| p[2] > p[3]));
}

#[test]
fn source_view_matches_real_crop_and_fractional_quad_has_exact_pixel_center_coverage() {
    let input = dense(13, 9);
    let view = [2, 1, 7, 5];
    let crop = ComponentImage::new(
        7,
        5,
        (1..6)
            .flat_map(|y| {
                input.data()[(y * 13 + 2) * 4..(y * 13 + 9) * 4]
                    .iter()
                    .copied()
            })
            .collect(),
    )
    .unwrap();
    for boundary in [
        Boundary::Transparent,
        Boundary::Normalize,
        Boundary::Replicate,
    ] {
        let mut local = config(7, 5);
        local.boundary = boundary;
        local.transforms = vec![
            [1.0, 0.0, 0.0, 1.0, -0.35, 0.0],
            [1.0, 0.0, 0.0, 1.0, 0.35, 0.0],
        ];
        local.sample_range = [7, 7];
        let mut full = local.clone();
        full.sampling.input = view;
        assert_eq!(run(&input, &full).data(), run(&crop, &local).data());
        full.output = Size {
            width: 9,
            height: 10,
        };
        full.sampling.output = [1.25, 2.5, 4.5, 5.25];
        let output = run(&input, &full);
        for y in 0..10 {
            for x in 0..9 {
                if !(1.25..5.75).contains(&(f64::from(x) + 0.5))
                    || !(2.5..7.75).contains(&(f64::from(y) + 0.5))
                {
                    let offset = ((y * 9 + x) * 4) as usize;
                    assert_eq!(&output.data()[offset..offset + 4], &[0; 4]);
                }
            }
        }
    }
}

#[test]
fn boundaries_change_equal_rgba_weights_without_clamping_emission() {
    let input = ComponentImage::new(1, 1, vec![210, 90, 30, 0]).unwrap();
    let mut c = config(1, 1);
    c.transforms = vec![
        [1.0, 0.0, 0.0, 1.0, -1.0, 0.0],
        IDENTITY,
        [1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
    ];
    c.sample_range = [3, 3];
    for (boundary, expected) in [
        (Boundary::Transparent, [70, 30, 10, 0]),
        (Boundary::Normalize, [210, 90, 30, 0]),
        (Boundary::Replicate, [210, 90, 30, 0]),
    ] {
        c.boundary = boundary;
        assert_eq!(run(&input, &c).data(), expected);
    }
    // Exact UV endpoints are valid samples, including for transparent protection.
    c.transforms = vec![
        [0.0, 0.0, 0.0, 0.0, 0.0, 0.5],
        [0.0, 0.0, 0.0, 0.0, 1.0, 0.5],
    ];
    c.sample_range = [2, 2];
    c.boundary = Boundary::Transparent;
    let edges = ComponentImage::new(2, 1, vec![240, 10, 80, 0, 20, 190, 40, 60]).unwrap();
    c.sampling.input = [0, 0, 2, 1];
    assert_eq!(run(&edges, &c).data(), &[130, 100, 60, 30]);
}

#[test]
fn piecewise_forward_warp_samples_include_control_points_and_shutter_endpoints() {
    let input = dense(11, 7);
    let mut c = config(5, 3);
    c.sampling.input = [0, 0, 11, 7];
    c.transforms = vec![
        IDENTITY,
        [2.0, 0.0, 0.0, 0.5, -0.3, 0.2],
        [0.5, 0.0, 0.0, 1.5, 0.2, -0.1],
    ];
    c.sample_range = [5, 5];
    c.boundary = Boundary::Replicate;
    let output = run(&input, &c);
    for y in 0..3 {
        for x in 0..5 {
            let u = (f64::from(x) + 0.5) / 5.0;
            let v = (f64::from(y) + 0.5) / 3.0;
            // Closed-form five positions for this forward path. Interpolating
            // inverse scale matrices produces different positions and pixels.
            let path = [
                [u, v],
                [1.5 * u - 0.15, 0.75 * v + 0.1],
                [2.0 * u - 0.3, 0.5 * v + 0.2],
                [1.25 * u - 0.05, v + 0.05],
                [0.5 * u + 0.2, 1.5 * v - 0.1],
            ];
            let values = path
                .map(|uv| dense_sample(&input, c.sampling.input, uv.map(|v| v.clamp(0.0, 1.0))));
            let expected: [u8; 4] = std::array::from_fn(|i| {
                (values.iter().map(|p| p[i]).sum::<f64>() / 5.0).round() as u8
            });
            let offset = ((y * 5 + x) * 4) as usize;
            assert_eq!(&output.data()[offset..offset + 4], expected, "at ({x},{y})");
        }
    }
}

#[test]
fn density_is_per_pixel_smoothstep_then_floor_with_bounded_endpoints() {
    let mut c = config(5, 1);
    c.transforms[1][0] = 2.0;
    c.sample_range = [2, 9];
    for (u, count) in [
        (0.0, 2),
        (0.1, 2),
        (0.3, 3),
        (0.5, 5),
        (0.7, 7),
        (0.9, 8),
        (1.0, 9),
        (2.0, 9),
    ] {
        assert_eq!(c.sample_count([u, 0.5]), count, "u={u}");
    }
    let input = dense(5, 1);
    let mut charges = Vec::new();
    apply(&input, &c, |n| {
        charges.push(n);
        Ok(())
    })
    .unwrap();
    // Five independent profile evaluations, even where UV protection rejects taps.
    for count in [2, 3, 5, 7, 8] {
        assert!(charges.contains(&(2 + 3 * count)));
    }
}

#[test]
fn invalid_profiles_domains_and_ranges_fail_before_budget_charge_without_clamping() {
    let input = dense(3, 2);
    let base = config(3, 2);
    let mut invalid = Vec::new();
    for count in [0, 1, 33] {
        let mut c = base.clone();
        c.transforms = vec![IDENTITY; count];
        invalid.push(c);
    }
    for value in [f64::NAN, f64::INFINITY, 10_000.01, -10_000.01] {
        let mut c = base.clone();
        c.transforms[0][3] = value;
        invalid.push(c);
    }
    for range in [[1, 2], [3, 2], [2, 257]] {
        let mut c = base.clone();
        c.sample_range = range;
        invalid.push(c);
    }
    for range in [
        [-0.01, 1.0],
        [1.0, 1.0],
        [2.0, 1.0],
        [0.0, 16.01],
        [0.0, f64::NAN],
    ] {
        let mut c = base.clone();
        c.distance_range = range;
        invalid.push(c);
    }
    for view in [
        [0, 0, 0, 2],
        [0, 0, 3, 0],
        [2, 0, 2, 2],
        [0, 1, 3, 2],
        [u32::MAX, 0, 2, 2],
    ] {
        let mut c = base.clone();
        c.sampling.input = view;
        invalid.push(c);
    }
    for rect in [
        [0.0, 0.0, 0.0, 2.0],
        [0.0, 0.0, 3.0, -1.0],
        [f64::NAN, 0.0, 3.0, 2.0],
        [0.0, 0.0, f64::INFINITY, 2.0],
    ] {
        let mut c = base.clone();
        c.sampling.output = rect;
        invalid.push(c);
    }
    for c in invalid {
        let mut charges = Vec::new();
        let error = apply(&input, &c, |n| {
            charges.push(n);
            Ok(())
        })
        .unwrap_err();
        assert!(
            error.to_string().contains("CAPTION_MATERIAL_INVALID"),
            "{error}"
        );
        assert!(
            charges.is_empty(),
            "invalid config reached allocation/read charges"
        );
    }
    let mut limits = base;
    limits.transforms = vec![[10_000.0; 6]; 32];
    limits.sample_range = [2, 256];
    limits.distance_range = [0.0, 16.0];
    assert!(limits.validate(input.size()).is_ok());
}

#[test]
fn actual_texel_reads_are_charged_and_rejected_before_read_on_every_call() {
    let input = ComponentImage::new(2, 1, vec![80, 30, 100, 0, 180, 50, 200, 10]).unwrap();
    let mut c = config(1, 1);
    c.sampling.input = [0, 0, 2, 1];
    for _ in 0..2 {
        let mut charges = Vec::new();
        let output = apply(&input, &c, |n| {
            charges.push(n);
            Ok(())
        })
        .unwrap();
        assert_eq!(output.data(), &[130, 40, 150, 5]);
        assert_eq!(
            charges,
            [1, 2, 8, 2, 2],
            "allocation, import scan, arithmetic, two bilinear reads"
        );
        let mut charged = 0;
        let mut failed_charges = Vec::new();
        let error = apply(&input, &c, |n| {
            failed_charges.push(n);
            charged += n;
            anyhow::ensure!(charged <= 11, "CAPTION_BUDGET_EXCEEDED: test read budget");
            Ok(())
        })
        .unwrap_err();
        assert!(error.to_string().contains("CAPTION_BUDGET_EXCEEDED"));
        assert_eq!(failed_charges, [1, 2, 8, 2]);
    }
    c.transforms = vec![[0.0, 0.0, 0.0, 0.0, -0.1, 0.5]; 2];
    let mut charges = Vec::new();
    assert_eq!(
        apply(&input, &c, |n| {
            charges.push(n);
            Ok(())
        })
        .unwrap()
        .data(),
        &[0; 4]
    );
    assert_eq!(charges, [1, 2, 8], "protected UVs perform no texel reads");
}
