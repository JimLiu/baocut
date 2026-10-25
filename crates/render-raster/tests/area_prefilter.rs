//! 缩小画之前的面积平均预滤波（`resample`）：整数实现等于浮点面积平均、预乘仍合法、门槛只在一半以下打开、
//! 换算后的落点不变，缓存只认同一块源画面。

use std::sync::Arc;

use render_raster::resample::{
    AREA_PREFILTER_BELOW, PrefilterCache, area_average, axis_scales, prefilter_for, prefilter_size,
    prefiltered_len,
};
use tiny_skia::{Pixmap, Point, Transform};

/// 确定性噪声，预乘：每个颜色分量都不超过 alpha。
fn noise(width: u32, height: u32, seed: u32) -> Pixmap {
    let mut pixmap = Pixmap::new(width, height).unwrap();
    let mut state = seed;
    for chunk in pixmap.data_mut().chunks_exact_mut(4) {
        let mut next = |bound: u32| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((state >> 16) % bound) as u8
        };
        let alpha = next(256);
        let cap = u32::from(alpha) + 1;
        chunk[0] = next(cap);
        chunk[1] = next(cap);
        chunk[2] = next(cap);
        chunk[3] = alpha;
    }
    pixmap
}

/// 一轴从 `len` 缩到 `n` 时，输出像素 `j` 对源像素 `i` 的浮点覆盖长度。
fn coverage(len: u32, n: u32, j: u32, i: u32) -> f64 {
    let step = f64::from(len) / f64::from(n);
    let (begin, end) = (f64::from(j) * step, f64::from(j + 1) * step);
    (end.min(f64::from(i + 1)) - begin.max(f64::from(i))).max(0.0)
}

/// 浮点的面积平均：输出像素盖住的源区域按覆盖面积加权求均值。
fn reference(source: &Pixmap, width: u32, height: u32) -> Vec<f64> {
    let (source_width, source_height) = (source.width(), source.height());
    let step_x = f64::from(source_width) / f64::from(width);
    let step_y = f64::from(source_height) / f64::from(height);
    let area = step_x * step_y;
    let data = source.data();
    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        let rows = (f64::from(y) * step_y).floor() as u32
            ..((f64::from(y + 1) * step_y).ceil() as u32).min(source_height);
        for x in 0..width {
            let columns = (f64::from(x) * step_x).floor() as u32
                ..((f64::from(x + 1) * step_x).ceil() as u32).min(source_width);
            let mut sum = [0.0f64; 4];
            for source_y in rows.clone() {
                let weight_y = coverage(source_height, height, y, source_y);
                for source_x in columns.clone() {
                    let weight = weight_y * coverage(source_width, width, x, source_x);
                    let index = ((source_y * source_width + source_x) * 4) as usize;
                    for (total, &channel) in sum.iter_mut().zip(&data[index..index + 4]) {
                        *total += f64::from(channel) * weight;
                    }
                }
            }
            out.extend(sum.iter().map(|total| total / area));
        }
    }
    out
}

#[test]
fn integer_kernel_matches_the_float_area_average() {
    // 两轴都除不尽，且横纵比例不同。
    let source = noise(997, 613, 0x1234_5678);
    let (width, height) = (211, 97);
    let filtered = area_average(source.as_ref(), width, height).unwrap();
    assert_eq!((filtered.width(), filtered.height()), (width, height));
    let expected = reference(&source, width, height);
    let worst = filtered
        .data()
        .iter()
        .zip(&expected)
        .map(|(&got, &want)| (f64::from(got) - want).abs())
        .fold(0.0, f64::max);
    // 整数实现是精确和再四舍五入：与浮点均值至多差半级。
    assert!(worst <= 0.5 + 1e-6, "worst deviation {worst}");
}

/// 先横后纵、逐像素累加的整数面积平均（改成先纵后横之前的实现），留作逐字节的参照。
fn horizontal_first(source: &Pixmap, width: u32, height: u32) -> Vec<u8> {
    let spans = |len: u32, n: u32| -> Vec<(usize, Vec<u64>)> {
        let (len, n) = (u64::from(len), u64::from(n));
        (0..n)
            .map(|j| {
                let (begin, end) = (j * len, (j + 1) * len);
                let first = begin / n;
                let weights = (first..end.div_ceil(n))
                    .map(|i| end.min((i + 1) * n) - begin.max(i * n))
                    .collect();
                (first as usize, weights)
            })
            .collect()
    };
    let (source_width, source_height) = (source.width(), source.height());
    let (columns, rows) = (spans(source_width, width), spans(source_height, height));
    let row_len = source_width as usize * 4;
    let denominator = u64::from(source_width) * u64::from(source_height);
    let reduce = |y: usize| -> Vec<u64> {
        let row = &source.data()[y * row_len..(y + 1) * row_len];
        let mut out = Vec::with_capacity(width as usize * 4);
        for (first, weights) in &columns {
            for channel in 0..4 {
                let sum = weights
                    .iter()
                    .enumerate()
                    .map(|(k, w)| u64::from(row[(first + k) * 4 + channel]) * w)
                    .sum::<u64>();
                out.push(sum);
            }
        }
        out
    };
    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for (first, weights) in &rows {
        let mut sums = vec![0u64; width as usize * 4];
        for (k, weight) in weights.iter().enumerate() {
            for (sum, value) in sums.iter_mut().zip(reduce(first + k)) {
                *sum += value * weight;
            }
        }
        out.extend(
            sums.iter()
                .map(|sum| ((sum + denominator / 2) / denominator) as u8),
        );
    }
    out
}

#[test]
fn vertical_first_matches_the_horizontal_first_kernel_exactly() {
    // 两轴除不尽、只缩一轴、整倍数、极小的源，以及横向抽头多于展开上限（17）的走运行时那条路。
    let cases = [
        (997, 613, 211, 97),
        (640, 360, 97, 53),
        (64, 48, 64, 12),
        (64, 48, 13, 48),
        (3, 7, 1, 2),
        (2, 2, 1, 1),
        (1001, 1001, 201, 200),
        (17, 5, 16, 2),
        (4000, 300, 300, 299),
        (5000, 64, 97, 9),
        (1280, 720, 40, 30),
        // 展开与运行时的分界：恰好 17 个抽头、18 个，以及 15.8 倍（16 与 17 个混着，补零后走 17 的展开）。
        (1700, 8, 100, 4),
        (1800, 8, 100, 4),
        (1580, 8, 100, 4),
    ];
    for (seed, (source_width, source_height, width, height)) in cases.into_iter().enumerate() {
        let source = noise(source_width, source_height, seed as u32 + 1);
        let filtered = area_average(source.as_ref(), width, height).unwrap();
        assert!(
            filtered.data() == horizontal_first(&source, width, height).as_slice(),
            "{source_width}×{source_height} → {width}×{height}"
        );
    }
}

#[test]
fn averaging_keeps_premultiplied_pixels_valid() {
    let source = noise(640, 360, 0x0bad_cafe);
    let filtered = area_average(source.as_ref(), 97, 53).unwrap();
    for pixel in filtered.data().chunks_exact(4) {
        assert!(
            pixel[..3].iter().all(|&channel| channel <= pixel[3]),
            "{pixel:?}"
        );
    }
}

#[test]
fn a_uniform_picture_stays_uniform() {
    let mut source = Pixmap::new(301, 173).unwrap();
    for pixel in source.data_mut().chunks_exact_mut(4) {
        pixel.copy_from_slice(&[40, 80, 120, 200]);
    }
    let filtered = area_average(source.as_ref(), 43, 29).unwrap();
    assert!(
        filtered
            .data()
            .chunks_exact(4)
            .all(|pixel| pixel == [40, 80, 120, 200])
    );
}

#[test]
fn only_one_axis_shrinks_when_only_one_needs_it() {
    let source = noise(64, 48, 7);
    // 宽不变时那一轴的权重只落在自己身上：只纵向平均。
    let filtered = area_average(source.as_ref(), 64, 12).unwrap();
    let expected = reference(&source, 64, 12);
    assert!(
        filtered
            .data()
            .iter()
            .zip(&expected)
            .all(|(&got, &want)| (f64::from(got) - want).abs() <= 0.5 + 1e-6)
    );
    assert!(
        area_average(source.as_ref(), 65, 12).is_none(),
        "never enlarges"
    );
    assert!(area_average(source.as_ref(), 0, 12).is_none());
}

#[test]
fn sources_too_tall_for_the_vertical_sums_are_left_alone() {
    // `255 × 源高` 超过 u32 时纵向和放不下：不预滤波，调用方照原样画。
    let limit = u32::MAX / 255;
    let tall = Pixmap::new(1, limit + 1).unwrap();
    assert!(area_average(tall.as_ref(), 1, 2).is_none());
    let fits = Pixmap::new(1, limit).unwrap();
    assert!(area_average(fits.as_ref(), 1, 2).is_some());
}

#[test]
fn the_gate_opens_only_below_half_scale() {
    assert_eq!(AREA_PREFILTER_BELOW, 0.5);
    assert_eq!(prefiltered_len(1000, 0.5), None);
    assert_eq!(prefiltered_len(1000, 0.49), Some(490));
    assert_eq!(prefiltered_len(1000, 0.2), Some(200));
    assert_eq!(
        prefiltered_len(1001, 0.2),
        Some(201),
        "rounds up so the last bilinear step never shrinks past 1:1"
    );
    assert_eq!(prefiltered_len(1000, 1.0), None);
    assert_eq!(prefiltered_len(1000, 2.0), None);
    assert_eq!(prefiltered_len(1000, f64::NAN), None);
    assert_eq!(prefiltered_len(1000, 0.0), None);
    assert_eq!(prefiltered_len(1000, -0.2), None);
    assert_eq!(
        prefiltered_len(1, 0.1),
        None,
        "a single pixel has nothing to average"
    );
    assert_eq!(prefiltered_len(3, 0.1), Some(1));
    assert_eq!(prefilter_size(1000, 800, 0.5, 0.5), None);
    assert_eq!(prefilter_size(1000, 800, 0.3, 0.8), Some((300, 800)));
    assert_eq!(prefilter_size(1000, 800, 0.8, 0.25), Some((1000, 200)));
    assert_eq!(prefilter_size(1000, 800, 0.2, 0.2), Some((200, 160)));
}

#[test]
fn axis_scales_ignore_rotation_and_flips() {
    let transform = Transform::from_scale(-0.2, 0.3)
        .post_rotate(37.0)
        .post_translate(11.0, -4.0);
    let (scale_x, scale_y) = axis_scales(transform);
    assert!(
        (scale_x - 0.2).abs() < 1e-6 && (scale_y - 0.3).abs() < 1e-6,
        "{scale_x} {scale_y}"
    );
}

#[test]
fn prefiltered_draws_cover_the_same_area() {
    let source = noise(1000, 700, 3);
    let transform = Transform::from_translate(-500.0, -350.0)
        .post_scale(0.2, -0.15)
        .post_rotate(23.0)
        .post_translate(320.0, 180.0);
    let (filtered, adjusted) = prefilter_for(source.as_ref(), transform).unwrap();
    assert_eq!((filtered.width(), filtered.height()), (200, 105));
    // 源与缩小后那份的四个角画到同一处。
    let corners = |width: u32, height: u32, transform: Transform| {
        let mut points = [
            Point::from_xy(0.0, 0.0),
            Point::from_xy(width as f32, 0.0),
            Point::from_xy(0.0, height as f32),
            Point::from_xy(width as f32, height as f32),
        ];
        transform.map_points(&mut points);
        points
    };
    let before = corners(1000, 700, transform);
    let after = corners(filtered.width(), filtered.height(), adjusted);
    for (a, b) in before.iter().zip(&after) {
        assert!(
            (a.x - b.x).abs() < 1e-3 && (a.y - b.y).abs() < 1e-3,
            "{a:?} vs {b:?}"
        );
    }
    assert!(prefilter_for(source.as_ref(), Transform::from_scale(0.5, 0.5)).is_none());
    assert!(prefilter_for(source.as_ref(), Transform::identity()).is_none());
    assert!(prefilter_for(source.as_ref(), Transform::from_scale(3.0, 3.0)).is_none());
}

#[test]
fn the_cache_reuses_only_the_same_source() {
    let mut cache = PrefilterCache::default();
    let source = Arc::new(noise(400, 300, 11));
    let first = cache.get("photo", &source, (100, 75)).unwrap();
    let again = cache.get("photo", &source, (100, 75)).unwrap();
    assert!(
        Arc::ptr_eq(&first, &again),
        "same source, same size: reused"
    );
    assert_eq!(cache.len(), 1);

    // 同样的像素换一块缓冲（视频的下一帧）：重算。
    let copy = Arc::new(noise(400, 300, 11));
    let recomputed = cache.get("photo", &copy, (100, 75)).unwrap();
    assert!(!Arc::ptr_eq(&first, &recomputed));
    assert_eq!(first.data(), recomputed.data());

    // 尺寸变了：重算。
    let resized = cache.get("photo", &copy, (80, 60)).unwrap();
    assert_eq!((resized.width(), resized.height()), (80, 60));

    // 缓存只留 `Weak`：宿主照样拿得回唯一的那份缓冲。
    drop(source);
    let owned = Arc::try_unwrap(copy).expect("the cache must not hold the source strongly");

    // 源改了像素：`make_mut` 解除 `Weak` 的关联，缓存认不出来，结果跟着新像素走。
    let mut source = Arc::new(owned);
    let before = cache.get("photo", &source, (80, 60)).unwrap();
    Arc::make_mut(&mut source).data_mut().fill(0);
    let after = cache.get("photo", &source, (80, 60)).unwrap();
    assert!(!Arc::ptr_eq(&before, &after));
    assert!(after.data().iter().all(|&value| value == 0));
}

#[test]
fn the_cache_stays_bounded() {
    let mut cache = PrefilterCache::default();
    let sources: Vec<_> = (0..40).map(|seed| Arc::new(noise(8, 8, seed))).collect();
    for (index, source) in sources.iter().enumerate() {
        cache.get(&format!("item-{index}"), source, (2, 2)).unwrap();
    }
    assert!(cache.len() <= 32, "{}", cache.len());
    cache.clear();
    assert!(cache.is_empty());
}
