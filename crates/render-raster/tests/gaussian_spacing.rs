use render_raster::effects::component_filters::{
    Axis, Boundary, ComponentImage, GaussianPass, GaussianSampling, Size, SpacingRamp,
    estimate_gaussian_reads, gaussian,
};

fn pass() -> GaussianPass {
    GaussianPass {
        sampling: None,
        axis: Axis::Y,
        sample_count: 3.0,
        step_pixels: 1.75,
        sigma_pixels: 2.0,
        gamma: None,
        boundary: Boundary::Normalize,
        output: Size {
            width: 1,
            height: 9,
        },
        spacing_ramp: Some(SpacingRamp {
            positive_first: false,
            domain: [0.0, 0.0, 1.0, 9.0],
            axis: Axis::Y,
            start: 0.2,
            end: 0.8,
            reverse: false,
            previous_sample: true,
        }),
    }
}

#[test]
fn reflecting_the_texture_requires_reflecting_both_field_and_recursive_tap_order() {
    let data: Vec<u8> = (0..9)
        .flat_map(|i| [i * 27, 90, 120, if i % 3 == 0 { 255 } else { 0 }])
        .collect();
    let flipped: Vec<u8> = data.chunks_exact(4).rev().flatten().copied().collect();
    let a = ComponentImage::new(1, 9, data).unwrap();
    let b = ComponentImage::new(1, 9, flipped).unwrap();
    let mut p = pass();
    let expected = gaussian(&a, p).unwrap();
    p.spacing_ramp.as_mut().unwrap().reverse = true;
    let wrong = gaussian(&b, p).unwrap();
    p.spacing_ramp.as_mut().unwrap().positive_first = true;
    let correct = gaussian(&b, p).unwrap();
    let mirrored: Vec<u8> = correct
        .data()
        .chunks_exact(4)
        .rev()
        .flatten()
        .copied()
        .collect();
    assert_eq!(expected.data(), mirrored);
    assert_ne!(wrong.data(), correct.data());
}

#[test]
fn source_subview_matches_a_real_crop_and_fractional_output_never_leaks_outside_its_quad() {
    let data: Vec<u8> = (0..13 * 9)
        .flat_map(|i| [(i * 37 % 256) as u8, 40, 180, (i * 13 % 256) as u8])
        .collect();
    let cropped: Vec<u8> = (1..6)
        .flat_map(|y| data[(y * 13 + 2) * 4..(y * 13 + 9) * 4].iter().copied())
        .collect();
    let input = ComponentImage::new(13, 9, data).unwrap();
    let local = ComponentImage::new(7, 5, cropped).unwrap();
    for axis in [Axis::X, Axis::Y] {
        for boundary in [
            Boundary::Normalize,
            Boundary::Replicate,
            Boundary::Transparent,
        ] {
            let mut p = GaussianPass {
                axis,
                boundary,
                spacing_ramp: None,
                output: Size {
                    width: 7,
                    height: 11,
                },
                ..pass()
            };
            let expected = gaussian(&local, p).unwrap();
            p.sampling = Some(GaussianSampling {
                input: [2, 1, 7, 5],
                output: [0.0, 0.0, 7.0, 11.0],
            });
            assert_eq!(gaussian(&input, p).unwrap().data(), expected.data());
            p.sampling.as_mut().unwrap().output = [1.25, 2.25, 4.5, 6.25];
            let output = gaussian(&input, p).unwrap();
            for y in 0..11 {
                for x in 0..7 {
                    if !(1.25..5.75).contains(&(x as f64 + 0.5))
                        || !(2.25..8.5).contains(&(y as f64 + 0.5))
                    {
                        assert_eq!(
                            &output.data()[(y * 7 + x) * 4..(y * 7 + x) * 4 + 4],
                            &[0; 4]
                        );
                    }
                }
            }
            p.sampling.as_mut().unwrap().input = [12, 1, 7, 5];
            assert!(gaussian(&input, p).is_err());
        }
    }
}

#[test]
fn spatial_kernel_matches_an_independent_uv_recurrence_and_is_not_a_uniform_blur() {
    let alpha = [0u8, 0, 255, 40, 0, 160, 0, 255, 0];
    let bytes: Vec<u8> = alpha.iter().flat_map(|a| [90, 20, 180, *a]).collect();
    let input = ComponentImage::new(1, 9, bytes).unwrap();
    let p = pass();
    let output = gaussian(&input, p).unwrap();
    for row in 0..9 {
        let base = (row as f64 + 0.5) / 9.0;
        let mut uv = base;
        let mut sum = f64::from(alpha[row]);
        let mut weight_sum = 1.0;
        for tap in 1..=3 {
            let d = tap as f64 * 1.75;
            let weight = (-0.5 * (d / 2.0).powi(2)).exp();
            for sign in [-1.0, 1.0] {
                let t = ((uv - 0.2) / 0.6).clamp(0.0, 1.0);
                uv = base + sign * (d / 9.0) * (1.0 - t * t * (3.0 - 2.0 * t));
                if !(0.0..=1.0).contains(&uv) {
                    continue;
                }
                let at = (uv * 9.0 - 0.5).clamp(0.0, 8.0);
                let lo = at.floor() as usize;
                let hi = (lo + 1).min(8);
                sum += weight
                    * ((1.0 - at.fract()) * f64::from(alpha[lo])
                        + at.fract() * f64::from(alpha[hi]));
                weight_sum += weight;
            }
        }
        assert_eq!(output.data()[row * 4 + 3], (sum / weight_sum).round() as u8);
    }
    let mut centered = p;
    centered.spacing_ramp.as_mut().unwrap().previous_sample = false;
    assert_ne!(output.data(), gaussian(&input, centered).unwrap().data());
    let uniform = GaussianPass {
        sampling: None,
        spacing_ramp: None,
        ..p
    };
    assert_ne!(output.data(), gaussian(&input, uniform).unwrap().data());
    assert_eq!(output.data(), gaussian(&input, p).unwrap().data());
    assert!(estimate_gaussian_reads(&input, p).unwrap().texel_reads <= 9 * 7 * 4);
    assert!(output.data().chunks_exact(4).any(|p| p[2] > p[3]));
}

#[test]
fn ramp_endpoints_disable_spacing_or_preserve_the_original_kernel() {
    let input =
        ComponentImage::new(1, 9, (0..9).flat_map(|i| [i * 20, 0, 0, 255]).collect()).unwrap();
    let mut p = pass();
    let ramp = p.spacing_ramp.as_mut().unwrap();
    ramp.start = -2.0;
    ramp.end = -1.0;
    assert_eq!(gaussian(&input, p).unwrap().data(), input.data());
    let ramp = p.spacing_ramp.as_mut().unwrap();
    ramp.start = 2.0;
    ramp.end = 3.0;
    assert_eq!(
        gaussian(&input, p).unwrap().data(),
        gaussian(
            &input,
            GaussianPass {
                sampling: None,
                spacing_ramp: None,
                ..p
            }
        )
        .unwrap()
        .data()
    );
    p.spacing_ramp.as_mut().unwrap().end = 2.0;
    assert!(gaussian(&input, p).is_err());
}
