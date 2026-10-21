//! Independent literal component.wgsl cell-cache and old four-load fetch oracles.
//! Included by material_support with #[cfg(test)] #[path = "read-budget-tests.rs"].
use super::{gaussian_support, gaussian_texel_reads};
use render_raster::effects::component_filters::{Axis, Boundary, GaussianPass, GaussianSampling, Size, Support};

#[derive(Clone, Copy, Debug)]
enum Arithmetic {
    Separate,
    Reassociated,
    Fused,
}

fn shader_center(pixel: f32, input: f32, output: f32, id: [f32; 2], od: [f32; 2], explicit: bool, math: Arithmetic) -> f32 {
    if explicit {
        let normalized = (pixel - od[0]) / od[1];
        match math {
            Arithmetic::Separate => normalized * id[1] + id[0] - 0.5,
            Arithmetic::Reassociated => normalized * id[1] + (id[0] - 0.5),
            Arithmetic::Fused => normalized.mul_add(id[1], id[0] - 0.5),
        }
    } else {
        match math {
            Arithmetic::Separate => pixel * input / output - 0.5,
            Arithmetic::Reassociated => pixel * (input / output) - 0.5,
            Arithmetic::Fused => pixel.mul_add(input / output, -0.5),
        }
    }
}

fn shader_texels(point: [f32; 2], id: [f32; 4]) -> [[i32; 2]; 4] {
    // WGSL first clamps float coordinates, then floors lo and clips integer hi.
    let upper = [id[0] + id[2] - 1., id[1] + id[3] - 1.];
    let pos = [point[0].clamp(id[0], upper[0]), point[1].clamp(id[1], upper[1])];
    let lo = [pos[0].floor() as i32, pos[1].floor() as i32];
    let hi = [
        (lo[0] + 1).min((id[0] + id[2]) as i32 - 1),
        (lo[1] + 1).min((id[1] + id[3]) as i32 - 1),
    ];
    [lo, [hi[0], lo[1]], [lo[0], hi[1]], hi]
}

fn shader_loads(point: [f32; 2], id: [f32; 4], support: Support) -> u64 {
    shader_texels(point, id)
        .into_iter()
        .filter(|[x, y]| *x >= support.left as i32 && *x < support.right as i32 && *y >= support.top as i32 && *y < support.bottom as i32)
        .count() as u64
}

#[derive(Clone, Copy)]
struct Cell {
    texels: [[i32; 2]; 4],
}

fn supported(point: [i32; 2], support: Support) -> bool {
    point[0] >= support.left as i32 && point[0] < support.right as i32 && point[1] >= support.top as i32 && point[1] < support.bottom as i32
}

fn cached_load(point: [i32; 2], previous: Cell, support: Support) -> u64 {
    // The WGSL compares four prior cell indices before calling supported_load.
    if previous.texels.contains(&point) {
        0
    } else {
        u64::from(supported(point, support))
    }
}

fn cached_sample(point: [f32; 2], id: [f32; 4], previous: Cell, support: Support) -> (Cell, u64) {
    let texels = shader_texels(point, id);
    let mut reads = cached_load(texels[0], previous, support);
    if texels[1][0] != texels[0][0] {
        reads += cached_load(texels[1], previous, support);
    }
    if texels[2][1] != texels[0][1] {
        reads += cached_load(texels[2], previous, support);
    }
    if texels[3][0] != texels[0][0] && texels[3][1] != texels[0][1] {
        reads += cached_load(texels[3], previous, support);
    }
    (Cell { texels }, reads)
}

#[derive(Clone, Copy, Default, Debug)]
struct Reads {
    cached: u64,
    old: u64,
}

fn contains(active: Option<Support>, x: u32, y: u32) -> bool {
    active.is_some_and(|s| x >= s.left && x < s.right && y >= s.top && y < s.bottom)
}

// Enumerates pixel centers and actual cached_load/supported_load calls at every
// admitted tap, alongside the former four-load shader. No host interval or
// axis_reads/distinct-span formula is used in this oracle.
fn literal_shader_reads(input: Size, support: Support, pass: GaussianPass, math: Arithmetic) -> Reads {
    assert!(pass.spacing_ramp.is_none());
    let count = pass.validate().unwrap();
    let (id, od) = pass.sampling_domains(input).unwrap();
    let id = id.map(|v| v as f32);
    let od = od.map(|v| v as f32);
    let step = pass.step_pixels as f32;
    let active = gaussian_support(input, Some(support), pass).unwrap();
    let axis = usize::from(pass.axis == Axis::Y);
    let mut total = Reads::default();
    // Replicate fetches depend on the off-axis integer cell, not its fractional
    // mix weight. Memoize identical literal tap traces for the large profile;
    // every distinct trace still executes the shader's per-tap cache algorithm.
    let mut memo = std::collections::HashMap::new();
    for y in 0..pass.output.height {
        for x in 0..pass.output.width {
            let pixel = [x as f32 + 0.5, y as f32 + 0.5];
            if (0..2).any(|d| pixel[d] < od[d] || pixel[d] >= od[d] + od[d + 2]) {
                continue;
            }
            let center = [
                shader_center(
                    pixel[0],
                    input.width as f32,
                    pass.output.width as f32,
                    [id[0], id[2]],
                    [od[0], od[2]],
                    pass.sampling.is_some(),
                    math,
                ),
                shader_center(
                    pixel[1],
                    input.height as f32,
                    pass.output.height as f32,
                    [id[1], id[3]],
                    [od[1], od[3]],
                    pass.sampling.is_some(),
                    math,
                ),
            ];
            let other = 1 - axis;
            let center_texels = shader_texels(center, id);
            let key = (center[axis].to_bits(), center_texels[0][other], center_texels[3][other]);
            if pass.boundary == Boundary::Replicate
                && let Some(reads) = memo.get(&key)
            {
                let reads: Reads = *reads;
                if reads.cached != 0 {
                    assert!(contains(active, x, y), "memoized shader reads outside active scissor");
                }
                total.cached += reads.cached;
                total.old += reads.old;
                continue;
            }
            // Center sampling always clamps, including Normalize/Transparent.
            let (initial, initial_reads) = cached_sample(center, id, Cell { texels: [[-1; 2]; 4] }, support);
            let mut caches = [initial; 2];
            let mut reads = Reads {
                cached: initial_reads,
                old: shader_loads(center, id, support),
            };
            for tap in 1..=count {
                for side in [-1., 1.] {
                    let mut point = center;
                    point[axis] = match math {
                        Arithmetic::Fused => (side * tap as f32).mul_add(step, center[axis]),
                        _ => center[axis] + side * (tap as f32 * step),
                    };
                    let valid = (0..2).all(|d| point[d] >= id[d] - 0.5 && point[d] <= id[d] + id[d + 2] - 0.5);
                    if valid || pass.boundary == Boundary::Replicate {
                        let direction = usize::from(side > 0.);
                        let (cell, fetched) = cached_sample(point, id, caches[direction], support);
                        caches[direction] = cell;
                        reads.cached += fetched;
                        reads.old += shader_loads(point, id, support);
                    }
                }
            }
            assert!(
                reads.cached <= reads.old,
                "cell cache increased literal fetches at ({x},{y}): {reads:?}"
            );
            if reads.cached != 0 {
                assert!(
                    contains(active, x, y),
                    "host support scissor missed shader reads at ({x},{y}) math={math:?} pass={pass:?} source={support:?} active={active:?}"
                );
            }
            if pass.boundary == Boundary::Replicate {
                memo.insert(key, reads);
            }
            total.cached += reads.cached;
            total.old += reads.old;
        }
    }
    total
}

fn verify(input: Size, source: Support, pass: GaussianPass) {
    let bound = gaussian_texel_reads(input, Some(source), pass).unwrap();
    for math in [Arithmetic::Separate, Arithmetic::Reassociated, Arithmetic::Fused] {
        let actual = literal_shader_reads(input, source, pass, math);
        assert!(
            actual.cached <= bound,
            "GPU cached texel reads underestimated: actual={actual:?}, bound={bound}, math={math:?}, input={input:?}, support={source:?}, pass={pass:?}"
        );
        assert!(actual.cached <= actual.old, "cached fetches exceeded former shader fetches");
    }
}

fn pass(output: Size, axis: Axis, boundary: Boundary) -> GaussianPass {
    GaussianPass {
        axis,
        boundary,
        output,
        sample_count: 7.,
        step_pixels: 0.73,
        sigma_pixels: 2.,
        gamma: None,
        spacing_ramp: None,
        sampling: None,
    }
}

#[test]
fn gaussian_read_budget_bounds_shader_roi_edges_duplicate_loads_and_fractional_output() {
    let single = Size { width: 1, height: 1 };
    let single_support = Support {
        left: 0,
        top: 0,
        right: 1,
        bottom: 1,
    };
    let enlarged = Size { width: 5, height: 3 };
    for axis in [Axis::X, Axis::Y] {
        let p = GaussianPass {
            sample_count: 40.,
            step_pixels: 0.,
            ..pass(enlarged, axis, Boundary::Replicate)
        };
        let reads = literal_shader_reads(single, single_support, p, Arithmetic::Separate);
        assert_eq!(
            reads.cached, 15,
            "1x1 ROI needs precisely one initial supported_load per output pixel"
        );
        assert_eq!(
            reads.old,
            15 * 81 * 4,
            "old bilinear duplicates all four corners for every repeated tap"
        );
        verify(single, single_support, p);
    }
    let input = Size { width: 17, height: 13 };
    let output = Size { width: 23, height: 19 };
    for source in [
        Support {
            left: 0,
            top: 0,
            right: 17,
            bottom: 13,
        },
        Support {
            left: 4,
            top: 3,
            right: 5,
            bottom: 4,
        },
        Support {
            left: 4,
            top: 3,
            right: 10,
            bottom: 9,
        },
        Support {
            left: 0,
            top: 12,
            right: 1,
            bottom: 13,
        },
    ] {
        for axis in [Axis::X, Axis::Y] {
            for boundary in [Boundary::Normalize, Boundary::Replicate, Boundary::Transparent] {
                for sampling in [
                    None,
                    Some(GaussianSampling {
                        input: [4, 3, 6, 6],
                        output: [-0.3, 0.6, 17.1, 15.8],
                    }),
                    Some(GaussianSampling {
                        input: [4, 3, 1, 1],
                        output: [0.50000002, -0.50000003, 20.4999999, 19.5000001],
                    }),
                    Some(GaussianSampling {
                        input: [0, 0, 17, 13],
                        output: [9.4999999, 8.5000001, 0.000003, 0.000004],
                    }),
                ] {
                    for step_pixels in [0., 0.000003, 0.5, 1. / 3., 37.125] {
                        verify(
                            input,
                            source,
                            GaussianPass {
                                sampling,
                                step_pixels,
                                ..pass(output, axis, boundary)
                            },
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn gaussian_read_budget_bounds_deterministic_random_literal_shader_fetches() {
    let mut state = 0x694b_321d_u32;
    let mut next = || {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        state
    };
    for index in 0..180 {
        let input = Size {
            width: next() % 35 + 1,
            height: next() % 31 + 1,
        };
        let output = Size {
            width: next() % 29 + 1,
            height: next() % 27 + 1,
        };
        let left = next() % input.width;
        let top = next() % input.height;
        let source = Support {
            left,
            top,
            right: left + next() % (input.width - left) + 1,
            bottom: top + next() % (input.height - top) + 1,
        };
        let x = next() % input.width;
        let y = next() % input.height;
        let w = next() % (input.width - x) + 1;
        let h = next() % (input.height - y) + 1;
        let sampling = (index % 4 != 0).then(|| GaussianSampling {
            input: [x, y, w, h],
            output: [
                (next() % 41) as f64 * 0.251 - 3.5000001,
                (next() % 37) as f64 * 0.249 + 0.5000001,
                (next() % 43 + 1) as f64 * 0.731,
                (next() % 39 + 1) as f64 * 0.683,
            ],
        });
        let axis = if index % 2 == 0 { Axis::X } else { Axis::Y };
        let boundary = [Boundary::Normalize, Boundary::Replicate, Boundary::Transparent][index % 3];
        let p = GaussianPass {
            sampling,
            sample_count: (next() % 9) as f64 + 0.31,
            step_pixels: (next() % 127) as f64 / 37.,
            ..pass(output, axis, boundary)
        };
        verify(input, source, p);
    }
}

#[test]
fn gaussian_read_budget_large_word_profile_counts_real_fetches_without_raising_gate() {
    let input = Size { width: 720, height: 1280 };
    let source = Support {
        left: 293,
        top: 604,
        right: 427,
        bottom: 676,
    };
    let p = GaussianPass {
        sample_count: 40.,
        step_pixels: 0.128,
        sigma_pixels: 128.,
        sampling: Some(GaussianSampling {
            input: [296, 601, 128, 78],
            output: [0., 0., 720., 1280.],
        }),
        ..pass(input, Axis::X, Boundary::Replicate)
    };
    let active = gaussian_support(input, Some(source), p).unwrap().unwrap();
    let raw = u64::from(active.right - active.left) * u64::from(active.bottom - active.top) * (2 * p.validate().unwrap() as u64 + 1) * 4;
    let bound = gaussian_texel_reads(input, Some(source), p).unwrap();
    let actual = literal_shader_reads(input, source, p, Arithmetic::Separate);
    eprintln!(
        "gaussian-read-budget large-word raw={raw} host_bound={bound} literal_cached_f32_fetches={} old_f32_fetches={} unchanged_gate={}",
        actual.cached,
        actual.old,
        256 * 1024 * 1024
    );
    assert!(actual.cached <= bound, "large-word GPU cache fetch count underestimated");
    assert!(bound < raw, "zero support must lower the raw four-load estimate");
    assert!(
        bound < actual.old,
        "new cache bound must reduce the old literal fetches for this profile"
    );
    assert_eq!(actual.old, 275_736_960, "former four-load word shader reference changed");
    assert!(actual.old > 256 * 1024 * 1024, "old word profile did not exceed the unchanged gate");
    assert!(bound <= 256 * 1024 * 1024, "new actual cache bound must fit the unchanged gate");
    assert!(actual.cached < actual.old, "word cell cache did not reduce fetches");
    for math in [Arithmetic::Reassociated, Arithmetic::Fused] {
        let reads = literal_shader_reads(input, source, p, math);
        assert!(
            reads.cached <= bound && reads.cached <= reads.old,
            "large-word arithmetic variant violated cache budget: math={math:?} reads={reads:?} bound={bound}"
        );
    }
}
