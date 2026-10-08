//! Strict effect 的 conformance 夹具（设计 §11「Conformance」）。
//!
//! 每个效果一个目录 `core/fixtures/effects/<id>@<ver>/`：
//! `uniforms.json`（case 名 → uniform 表）、`expected-<case>.png`（逐字节
//! 参考输出）、`expected.json`（尺寸 + 输出像素指纹，用来给出精确的失败信息）。
//! 输入是共享的 `input-a.png` / `input-b.png`（程序生成，见 `write_inputs`）。
//!
//! 重生成：`BCUT_UPDATE_GOLDEN=1 cargo test -p bcut-render --test effects_conformance`。
//!
//! **同一套夹具将来要被 GPU / Web 实现原样跑过**——这是 ADR-M05 里
//! 「GPU 只是加速，不过 conformance 就自动回退」的可执行形态。

use motion::effect::{
    Determinism, EffectDomain, EffectRef, UniformMap, UniformValue, builtin_registry,
};
use render_raster::drawop::fnv1a64;
use render_raster::effects::{
    apply_filter, apply_image_mask, apply_transition, kernel_is_implemented,
};
use serde_json::{Map, Value, json};
use std::path::{Path, PathBuf};
use tiny_skia::{IntSize, Pixmap};

const SIZE: u32 = 48;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/effects")
}

fn updating() -> bool {
    std::env::var_os("BCUT_UPDATE_GOLDEN").is_some_and(|value| !value.is_empty())
}

/// 输入 A：高频彩色渐变 + 一块半透明区域 + 一块纯绿（给色键用），四角透明。
/// 输入 B：径向亮度斜坡（给 `mask.luma` / `mask.image` 用）。
/// 两者都是解析式给值 ⇒ 跨机器逐字节确定。
fn make_input_a() -> Pixmap {
    let mut data = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            let corner = (x < 4 && y < 4) || (x >= SIZE - 4 && y >= SIZE - 4);
            let alpha: u32 = if corner {
                0
            } else if x >= SIZE / 2 && y < SIZE / 2 {
                128
            } else {
                255
            };
            let (r, g, b) = if x < SIZE / 3 && y >= SIZE / 2 {
                (0u32, 255u32, 0u32) // 纯绿区：色键
            } else {
                (
                    (x * 7 + y * 13) % 256,
                    (x * 3 + 40) % 256,
                    (y * 5 + 90) % 256,
                )
            };
            // 预乘
            data.push((r * alpha / 255) as u8);
            data.push((g * alpha / 255) as u8);
            data.push((b * alpha / 255) as u8);
            data.push(alpha as u8);
        }
    }
    Pixmap::from_vec(data, IntSize::from_wh(SIZE, SIZE).unwrap()).unwrap()
}

fn make_input_b() -> Pixmap {
    let mut data = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    let center = f64::from(SIZE) / 2.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let distance =
                ((f64::from(x) - center).powi(2) + (f64::from(y) - center).powi(2)).sqrt() / center;
            let level = ((1.0 - distance).clamp(0.0, 1.0) * 255.0).round() as u32;
            let alpha = ((1.0 - distance * 0.5).clamp(0.0, 1.0) * 255.0).round() as u32;
            data.push((level * alpha / 255) as u8);
            data.push((level * alpha / 255) as u8);
            data.push((level * alpha / 255) as u8);
            data.push(alpha as u8);
        }
    }
    Pixmap::from_vec(data, IntSize::from_wh(SIZE, SIZE).unwrap()).unwrap()
}

fn read_or_write_png(path: &Path, produce: impl FnOnce() -> Pixmap) -> Pixmap {
    if updating() || !path.exists() {
        let pixmap = produce();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, pixmap.encode_png().unwrap()).unwrap();
        return pixmap;
    }
    Pixmap::decode_png(&std::fs::read(path).unwrap()).unwrap()
}

fn uniform_from_json(value: &Value) -> UniformValue {
    match value {
        Value::Bool(flag) => UniformValue::Bool(*flag),
        Value::String(text) => UniformValue::Text(text.clone()),
        Value::Array(items) if items.len() == 4 => {
            let mut rgba = [0.0f64; 4];
            for (slot, item) in rgba.iter_mut().zip(items) {
                *slot = item.as_f64().unwrap();
            }
            UniformValue::Color(rgba)
        }
        Value::Array(items) if items.len() == 2 => {
            UniformValue::Vec2([items[0].as_f64().unwrap(), items[1].as_f64().unwrap()])
        }
        other => UniformValue::Scalar(other.as_f64().unwrap()),
    }
}

fn uniforms_from_json(object: &Map<String, Value>) -> UniformMap {
    object
        .iter()
        .map(|(key, value)| (key.clone(), uniform_from_json(value)))
        .collect()
}

/// `(id, version, [(case, uniforms JSON)])`。
fn cases() -> Vec<(&'static str, u32, Vec<(&'static str, Value)>)> {
    // `length` 参数是**画布短边的比例**：48 px 的短边下 3/48 = 3 px。
    vec![
        (
            "filter.blur",
            1,
            vec![
                ("r0", json!({"radius": 0.0})),
                ("r3", json!({"radius": 3.0 / 48.0})),
            ],
        ),
        (
            "filter.brightness",
            1,
            vec![
                ("up", json!({"amount": 0.2})),
                ("down", json!({"amount": -0.35})),
            ],
        ),
        ("filter.contrast", 1, vec![("up", json!({"amount": 0.5}))]),
        (
            "filter.saturation",
            1,
            vec![
                ("flat", json!({"amount": 0.0})),
                ("boost", json!({"amount": 1.8})),
            ],
        ),
        (
            "filter.grayscale",
            1,
            vec![("full", json!({"amount": 1.0}))],
        ),
        ("filter.sepia", 1, vec![("full", json!({"amount": 1.0}))]),
        (
            "filter.hueRotate",
            1,
            vec![
                ("q90", json!({"degrees": 90.0})),
                ("neg", json!({"degrees": -120.0})),
            ],
        ),
        (
            "filter.colorAdjust",
            1,
            vec![("gray+bright", json!({"grayscale": 0.6, "brightness": -0.2}))],
        ),
        (
            "filter.invert",
            1,
            vec![("strong", json!({"amount": 0.75}))],
        ),
        (
            "filter.sharpen",
            1,
            vec![("medium", json!({"amount": 0.6}))],
        ),
        (
            "filter.rgbSplit",
            1,
            vec![
                ("horizontal", json!({"distance":3.0/48.0})),
                ("diagonal", json!({"distance":4.0/48.0,"angle":30})),
            ],
        ),
        (
            "filter.directionalBlur",
            1,
            vec![
                ("horizontal", json!({"distance":5.0/48.0})),
                ("diagonal", json!({"distance":4.0/48.0,"angle":-45})),
            ],
        ),
        (
            "filter.outline",
            1,
            vec![
                ("white", json!({"radius":2.0/48.0})),
                (
                    "colored",
                    json!({"radius":3.0/48.0,"color":[0.2,0.7,1.0,0.6]}),
                ),
            ],
        ),
        ("filter.noise", 1, vec![("grain", json!({"amount": 0.8}))]),
        ("filter.vignette", 1, vec![("full", json!({"amount": 1.0}))]),
        (
            "filter.dropShadow",
            1,
            vec![(
                "soft",
                json!({
                    "radius": 2.0 / 48.0, "dx": 2.0 / 48.0, "dy": 2.0 / 48.0,
                    "color": [0.0, 0.0, 0.0, 0.5]
                }),
            )],
        ),
        (
            "filter.chromaKey",
            1,
            vec![(
                "green",
                json!({"color": [0.0, 1.0, 0.0, 1.0], "similarity": 0.4, "smoothness": 0.1}),
            )],
        ),
        (
            "filter.alphaThreshold",
            1,
            vec![
                ("hard", json!({"threshold": 0.6, "softness": 0.0})),
                ("soft", json!({"threshold": 0.6, "softness": 0.25})),
            ],
        ),
        (
            "filter.bloom",
            1,
            vec![
                (
                    "soft",
                    json!({"threshold": 0.5, "knee": 0.25, "radius": 6.0 / 48.0, "intensity": 1.5}),
                ),
                (
                    "wide-hard",
                    json!({"threshold": 0.3, "knee": 0.0, "radius": 13.0 / 48.0, "intensity": 3.0}),
                ),
            ],
        ),
        (
            "filter.grade",
            1,
            vec![
                (
                    "dawn-warm",
                    json!({"lift": 0.04, "gamma": 1.15, "gain": 1.3, "saturation": 1.2, "tint": 0.7, "shoulder": 0.6}),
                ),
                (
                    "moon-cold",
                    json!({"lift": -0.05, "gamma": 0.85, "gain": 0.9, "saturation": 0.6, "tint": -0.8}),
                ),
            ],
        ),
        (
            "filter.radialBlur",
            1,
            vec![
                ("center", json!({"strength": 0.3, "samples": 6})),
                (
                    "corner-strong",
                    json!({"cx": 0.2, "cy": 0.8, "strength": 0.6, "samples": 8}),
                ),
            ],
        ),
        (
            "filter.godRays",
            1,
            vec![
                (
                    "skylight-gold",
                    json!({"cx": 0.5, "cy": 0.0, "threshold": 0.3, "length": 0.6, "intensity": 2.0, "decay": 0.5, "tint": [1.0, 0.85, 0.55, 1.0]}),
                ),
                (
                    "offscreen-long",
                    json!({"cx": 1.4, "cy": -0.5, "threshold": 0.1, "length": 0.9, "intensity": 1.0, "decay": 0.0}),
                ),
            ],
        ),
        (
            "mask.shape",
            1,
            vec![
                (
                    "ellipse",
                    json!({"shape": "ellipse", "feather": 1.0 / 48.0}),
                ),
                (
                    "rounded",
                    json!({"shape": "roundedRect", "radius": 9.0 / 48.0}),
                ),
            ],
        ),
        (
            "mask.progress",
            1,
            vec![
                ("half", json!({"progress": 0.5})),
                ("half-inverted", json!({"progress": 0.5, "invert": true})),
            ],
        ),
        ("mask.image", 1, vec![("plain", json!({}))]),
        ("mask.luma", 1, vec![("inverted", json!({"invert": true}))]),
    ]
}

#[test]
fn every_strict_manifest_has_a_cpu_reference_kernel() {
    for manifest in builtin_registry().iter() {
        if manifest.determinism != Determinism::Strict {
            continue;
        }
        assert!(
            kernel_is_implemented(&manifest.kernel),
            "{} 声明 strict，但内核 {} 没有 CPU reference 实现",
            manifest.qualified(),
            manifest.kernel
        );
    }
}

#[test]
fn every_conformance_case_names_a_registered_effect() {
    for (id, version, list) in cases() {
        assert!(
            builtin_registry().get(id, version).is_some(),
            "conformance 引用了未注册的 {id}@{version}"
        );
        assert!(!list.is_empty(), "{id}@{version} 没有 case");
    }
}

/// 每个可执行的 strict 效果（`composite.blend` 是表、不是像素内核）都必须
/// 至少有一个 conformance case——加效果不加夹具会在这里红。
#[test]
fn every_pixel_effect_is_covered_by_conformance() {
    let covered: std::collections::BTreeSet<String> = cases()
        .into_iter()
        .map(|(id, version, _)| format!("{id}@{version}"))
        .collect();
    for manifest in builtin_registry().iter() {
        if manifest.kernel == "porter-duff-separable" {
            continue; // blend 表由 raster 的 blend 参考测试覆盖
        }
        if manifest.domain == EffectDomain::Transition {
            continue; // 双画面转场由 `every_surface_transition_is_covered_by_conformance` 管
        }
        assert!(
            covered.contains(&manifest.qualified()),
            "{} 没有 conformance case",
            manifest.qualified()
        );
    }
}

#[test]
fn cpu_reference_output_matches_the_conformance_fixtures() {
    let input_a = read_or_write_png(&fixtures().join("input-a.png"), make_input_a);
    let input_b = read_or_write_png(&fixtures().join("input-b.png"), make_input_b);
    let short_edge = f64::from(SIZE);

    for (id, version, list) in cases() {
        let manifest = builtin_registry().get(id, version).unwrap();
        let dir = fixtures().join(manifest.qualified());
        let effect = EffectRef::new(id, version);

        let mut uniforms_doc = Map::new();
        let mut expected_doc = Map::new();
        for (case, raw) in &list {
            let uniforms = uniforms_from_json(raw.as_object().unwrap());
            let output = if manifest.inputs == 2 {
                apply_image_mask(&effect, &uniforms, &input_a, &input_b).unwrap()
            } else {
                apply_filter(&effect, &uniforms, &input_a, short_edge).unwrap()
            };
            let fingerprint = format!("{:016x}", fnv1a64(output.data()));
            uniforms_doc.insert((*case).to_owned(), raw.clone());
            expected_doc.insert(
                (*case).to_owned(),
                json!({
                    "width": output.width(),
                    "height": output.height(),
                    "pixelFingerprint": fingerprint,
                }),
            );

            let png = dir.join(format!("expected-{case}.png"));
            if updating() {
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(&png, output.encode_png().unwrap()).unwrap();
                continue;
            }
            let expected = Pixmap::decode_png(&std::fs::read(&png).unwrap_or_else(|error| {
                panic!(
                    "读取 {} 失败：{error}；用 BCUT_UPDATE_GOLDEN=1 重生成",
                    png.display()
                )
            }))
            .unwrap();
            assert_eq!(
                expected.data(),
                output.data(),
                "{}/{case}: CPU reference 输出与 conformance 夹具不一致（指纹 {fingerprint}）",
                manifest.qualified()
            );
        }

        for (name, doc) in [
            ("uniforms.json", Value::Object(uniforms_doc)),
            ("expected.json", Value::Object(expected_doc)),
        ] {
            let path = dir.join(name);
            let mut text = serde_json::to_string_pretty(&doc).unwrap();
            text.push('\n');
            if updating() {
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(&path, &text).unwrap();
            } else {
                let stored = std::fs::read_to_string(&path)
                    .unwrap_or_else(|error| panic!("读取 {} 失败：{error}", path.display()));
                assert_eq!(stored, text, "{} 与当前 case 表不一致", path.display());
            }
        }
    }
}

/// `radius = 0` 必须是恒等变换：折叠成「没有效果」的分支要能依赖这一点。
#[test]
fn a_zero_radius_blur_is_the_identity() {
    let input = make_input_a();
    let output = apply_filter(
        &EffectRef::new("filter.blur", 1),
        &UniformMap::new().with("radius", UniformValue::Scalar(0.0)),
        &input,
        f64::from(SIZE),
    )
    .unwrap();
    assert_eq!(input.data(), output.data());
}

/// 两次执行必须逐位一致（strict 的最低门槛）。
#[test]
fn cpu_reference_is_bitwise_repeatable() {
    let input = make_input_a();
    let effect = EffectRef::new("filter.dropShadow", 1);
    let uniforms = UniformMap::new()
        .with("radius", UniformValue::Scalar(2.0 / 48.0))
        .with("dx", UniformValue::Scalar(2.0 / 48.0))
        .with("dy", UniformValue::Scalar(2.0 / 48.0));
    let first = apply_filter(&effect, &uniforms, &input, f64::from(SIZE)).unwrap();
    let second = apply_filter(&effect, &uniforms, &input, f64::from(SIZE)).unwrap();
    assert_eq!(first.data(), second.data());
}

/// 单输入的 Filter pass 拿不到第二张 surface，必须明确报错而不是静默忽略。
#[test]
fn a_two_input_mask_is_rejected_by_the_single_input_entry() {
    let error = apply_filter(
        &EffectRef::new("mask.image", 1),
        &UniformMap::new(),
        &make_input_a(),
        f64::from(SIZE),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("effect-input-mismatch"), "{error}");
}

/// `box_blur_content`（包围盒版）与 `box_blur_premul_u8`（整幅版）必须逐字节
/// 相同——`filter.blur@1` 的参考实现走前者，`blur.rs` 的注释给的是证明，
/// 这条测试是它的可执行形态。半径覆盖「内容占比小」与「触发半幅整帧回退」两侧。
#[test]
fn the_bounded_blur_equals_the_full_frame_blur() {
    for radius in [1usize, 2, 3, 5, 8, 13] {
        let mut bounded = make_input_a();
        let mut full = make_input_a();
        render_raster::effects::box_blur_content(bounded.data_mut(), SIZE, SIZE, radius);
        render_raster::effects::box_blur_premul_u8(full.data_mut(), SIZE, SIZE, radius);
        assert_eq!(
            bounded.data(),
            full.data(),
            "radius={radius}: 包围盒模糊与整幅模糊不一致"
        );
    }
}

/// 稀疏内容夹具：在 `WIDE × TALL` 的全零缓冲里，只往 `[rows] × [cols]` 这块
/// 区域随机点亮像素（播种 LCG，无外部随机源）。返回缓冲与内容所在的区域。
fn sparse_frame(seed: u64) -> (Vec<u8>, std::ops::Range<usize>, std::ops::Range<usize>) {
    const WIDE: usize = 320;
    const TALL: usize = 180;
    let rows = 118..149;
    let cols = 37..262;
    let mut data = vec![0_u8; WIDE * TALL * 4];
    let mut state = seed | 1;
    let mut next = || {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (state >> 33) as u32
    };
    for y in rows.clone() {
        for x in cols.clone() {
            if next() % 5 != 0 {
                continue;
            }
            let alpha = (next() % 255 + 1) as u8;
            let offset = (y * WIDE + x) * 4;
            data[offset] = (u32::from(alpha) * (next() % 256) / 255) as u8;
            data[offset + 1] = (u32::from(alpha) * (next() % 256) / 255) as u8;
            data[offset + 2] = (u32::from(alpha) * (next() % 256) / 255) as u8;
            data[offset + 3] = alpha;
        }
    }
    (data, rows, cols)
}

/// 限定窗口的包围盒扫描：只要窗口是内容的超集，答案就必须与全帧扫描相同。
/// 调用方（字幕渲染）用布局几何算窗口，这条不变量是它敢跳过全帧扫描的全部依据。
#[test]
fn a_windowed_alpha_bbox_matches_the_full_frame_scan() {
    const WIDE: usize = 320;
    const TALL: usize = 180;
    for seed in [1_u64, 7, 4242] {
        let (data, rows, cols) = sparse_frame(seed);
        let full = render_raster::effects::alpha_bbox(&data, WIDE, TALL).expect("内容非空");
        for (label, window) in [
            (
                "整幅窗口",
                render_raster::effects::ContentBox {
                    rows: 0..TALL,
                    cols: 0..WIDE,
                },
            ),
            (
                "贴身超集",
                render_raster::effects::ContentBox {
                    rows: rows.start..rows.end,
                    cols: cols.start..cols.end,
                },
            ),
            (
                "外扩超集（越界由实现夹到画布）",
                render_raster::effects::ContentBox {
                    rows: rows.start.saturating_sub(9)..rows.end + 400,
                    cols: cols.start.saturating_sub(31)..cols.end + 400,
                },
            ),
        ] {
            let windowed =
                render_raster::effects::alpha_bbox_within(&data, WIDE, TALL, &window).expect(label);
            assert_eq!(
                windowed, full,
                "seed={seed} {label}: 窗口扫描与全帧扫描分叉"
            );
        }
    }
    // 空窗口 / 全零窗口都必须是 None，而不是一个退化的空区间。
    let (data, rows, _) = sparse_frame(1);
    assert_eq!(
        render_raster::effects::alpha_bbox_within(
            &data,
            WIDE,
            TALL,
            &render_raster::effects::ContentBox {
                rows: 0..rows.start,
                cols: 0..WIDE,
            },
        ),
        None
    );
}

/// 走「窗口扫描 → bounded blur」这条路，与「全帧扫描 → 整幅 blur」必须逐字节
/// 相同。字幕导出把每帧的 glow / 转场模糊都换到了前一条路上。
#[test]
fn the_windowed_blur_path_equals_the_full_frame_blur_path() {
    const WIDE: usize = 320;
    const TALL: usize = 180;
    for seed in [1_u64, 7, 4242] {
        for radius in [1_usize, 3, 9, 40] {
            let (mut windowed, rows, cols) = sparse_frame(seed);
            let (mut full, _, _) = sparse_frame(seed);
            let window = render_raster::effects::ContentBox {
                rows: rows.start.saturating_sub(9)..rows.end + 400,
                cols: cols.start.saturating_sub(31)..cols.end + 400,
            };
            let bounds =
                render_raster::effects::alpha_bbox_within(&windowed, WIDE, TALL, &window).unwrap();
            render_raster::effects::box_blur_bounded(
                &mut windowed,
                WIDE as u32,
                TALL as u32,
                radius,
                &bounds,
            );
            render_raster::effects::box_blur_premul_u8(&mut full, WIDE as u32, TALL as u32, radius);
            assert_eq!(
                windowed, full,
                "seed={seed} radius={radius}: 窗口路径与整幅路径分叉"
            );
        }
    }
}

// ── Surface Transition（规范 §9，设计 §11「Golden 帧」）─────────────────

/// 设计 §11 钉的采样点。端点 `0` / `1` 同时是 conformance 的硬要求：
/// 输出必须与 `from` / `to` **逐字节**相同。
const PROGRESS: &[f64] = &[0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];

fn progress_case(progress: f64) -> String {
    format!("p{:03}", (progress * 100.0).round() as u32)
}

/// `(id, version, uniforms)`。每条转场一组 uniform × 七个 progress。
fn transition_cases() -> Vec<(&'static str, u32, Value)> {
    vec![
        ("transition.crossfade", 1, json!({})),
        ("transition.slide", 1, json!({"direction": "up"})),
        (
            "transition.wipe",
            1,
            json!({"direction": "right", "softness": 4.0 / 48.0}),
        ),
        (
            "transition.circleCrop",
            1,
            json!({"softness": 3.0 / 48.0, "cx": 0.5, "cy": 0.5}),
        ),
        (
            "transition.inkBlot",
            1,
            json!({"cx": 0.2, "cy": 0.3, "roughness": 0.1, "seed": 7}),
        ),
        (
            "transition.shatter",
            1,
            json!({"pieces": 24, "seed": 5, "cx": 0.4, "cy": 0.45, "force": 0.3, "gravity": 0.25}),
        ),
        (
            "transition.glitch",
            1,
            json!({"slices": 8, "amount": 0.15, "rgb": 0.06, "seed": 3}),
        ),
    ]
}

fn run_transition(id: &str, version: u32, uniforms: &UniformMap, progress: f64) -> Pixmap {
    apply_transition(
        &EffectRef::new(id, version),
        uniforms,
        &make_input_a(),
        &make_input_b(),
        progress as f32,
        f64::from(SIZE),
    )
    .unwrap()
}

/// 每条已注册的 `transition.*` 都要有 case——加一条配方不加夹具就红。
#[test]
fn every_surface_transition_is_covered_by_conformance() {
    let covered: std::collections::BTreeSet<String> = transition_cases()
        .into_iter()
        .map(|(id, version, _)| format!("{id}@{version}"))
        .collect();
    for manifest in builtin_registry().in_domain(EffectDomain::Transition) {
        assert!(
            covered.contains(&manifest.qualified()),
            "{} 没有 conformance case",
            manifest.qualified()
        );
    }
    assert!(!covered.is_empty());
}

/// **端点纪律**（规范 §9）：`progress = 0` 逐字节等于 `from`，`= 1` 等于 `to`。
/// 不是"看起来一样"——是同一串字节。
#[test]
fn progress_zero_is_from_and_progress_one_is_to() {
    let (from, to) = (make_input_a(), make_input_b());
    for (id, version, raw) in transition_cases() {
        let manifest = builtin_registry().get(id, version).unwrap();
        // 每个 uniform 组合都要过，不只是默认值：softness / invert / direction
        // 都不该动端点。
        let variants = [
            raw.clone(),
            json!({}),
            match manifest.params.contains_key("invert") {
                true => json!({"invert": true}),
                false => json!({}),
            },
        ];
        for variant in variants {
            let uniforms = uniforms_from_json(variant.as_object().unwrap());
            let start = run_transition(id, version, &uniforms, 0.0);
            assert_eq!(start.data(), from.data(), "{id}@{version} {variant}: p=0");
            let end = run_transition(id, version, &uniforms, 1.0);
            assert_eq!(end.data(), to.data(), "{id}@{version} {variant}: p=1");
        }
    }
}

/// 单调推进的 progress 必须给出**互不相同**的画面——「配方注册了但什么都没做」
/// 会在这里红。
#[test]
fn monotonic_progress_yields_distinct_frames() {
    for (id, version, raw) in transition_cases() {
        let uniforms = uniforms_from_json(raw.as_object().unwrap());
        let mut seen: std::collections::BTreeMap<u64, f64> = std::collections::BTreeMap::new();
        for progress in PROGRESS {
            let output = run_transition(id, version, &uniforms, *progress);
            let hash = fnv1a64(output.data());
            if let Some(previous) = seen.insert(hash, *progress) {
                panic!("{id}@{version}: progress {previous} 与 {progress} 输出相同");
            }
        }
    }
}

/// **可 seek**：随机顺序采样与顺序采样逐字节相同（设计 §11 的 Property 一条）。
/// 转场不许持有增量时钟。
#[test]
fn transitions_are_seek_safe() {
    for (id, version, raw) in transition_cases() {
        let uniforms = uniforms_from_json(raw.as_object().unwrap());
        let sorted: Vec<Vec<u8>> = PROGRESS
            .iter()
            .map(|progress| {
                run_transition(id, version, &uniforms, *progress)
                    .data()
                    .to_vec()
            })
            .collect();
        // 固定的"乱序"：不引入随机源，但顺序与上面不同。
        let shuffled = [3usize, 0, 6, 2, 5, 1, 4];
        let mut out = vec![Vec::new(); PROGRESS.len()];
        for index in shuffled {
            out[index] = run_transition(id, version, &uniforms, PROGRESS[index])
                .data()
                .to_vec();
        }
        assert_eq!(sorted, out, "{id}@{version}: 乱序采样与顺序采样不一致");
    }
}

/// 闭区间之外必须报错，而不是悄悄夹回来——`progress` 的定义域是契约。
#[test]
fn progress_outside_the_closed_interval_is_refused() {
    for progress in [-0.01f32, 1.01] {
        let error = apply_transition(
            &EffectRef::new("transition.crossfade", 1),
            &UniformMap::new(),
            &make_input_a(),
            &make_input_b(),
            progress,
            f64::from(SIZE),
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("preset-param-invalid"), "{error}");
    }
}

/// 两张输入尺寸不同时必须报错（manifest 声明 `resizeMode: same-as-input`）。
#[test]
fn mismatched_input_sizes_are_refused() {
    let small = Pixmap::new(SIZE / 2, SIZE).unwrap();
    let error = apply_transition(
        &EffectRef::new("transition.crossfade", 1),
        &UniformMap::new(),
        &make_input_a(),
        &small,
        0.5,
        f64::from(SIZE),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("effect-capability-unsupported"), "{error}");
}

#[test]
fn surface_transition_output_matches_the_conformance_fixtures() {
    for (id, version, raw) in transition_cases() {
        let manifest = builtin_registry().get(id, version).unwrap();
        let dir = fixtures().join(manifest.qualified());
        let uniforms = uniforms_from_json(raw.as_object().unwrap());

        let mut expected_doc = Map::new();
        for progress in PROGRESS {
            let case = progress_case(*progress);
            let output = run_transition(id, version, &uniforms, *progress);
            let fingerprint = format!("{:016x}", fnv1a64(output.data()));
            expected_doc.insert(
                case.clone(),
                json!({
                    "width": output.width(),
                    "height": output.height(),
                    "pixelFingerprint": fingerprint,
                }),
            );

            let png = dir.join(format!("expected-{case}.png"));
            if updating() {
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(&png, output.encode_png().unwrap()).unwrap();
                continue;
            }
            let stored = Pixmap::decode_png(&std::fs::read(&png).unwrap_or_else(|error| {
                panic!(
                    "读取 {} 失败：{error}；用 BCUT_UPDATE_GOLDEN=1 重生成",
                    png.display()
                )
            }))
            .unwrap();
            assert_eq!(
                stored.data(),
                output.data(),
                "{}/{case}: CPU reference 与 conformance 夹具不一致（指纹 {fingerprint}）",
                manifest.qualified()
            );
        }

        for (name, doc) in [
            (
                "uniforms.json",
                json!({ "params": raw.clone(), "progress": PROGRESS }),
            ),
            ("expected.json", Value::Object(expected_doc)),
        ] {
            let path = dir.join(name);
            let mut text = serde_json::to_string_pretty(&doc).unwrap();
            text.push('\n');
            if updating() {
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(&path, &text).unwrap();
            } else {
                let stored = std::fs::read_to_string(&path)
                    .unwrap_or_else(|error| panic!("读取 {} 失败：{error}", path.display()));
                assert_eq!(stored, text, "{} 与当前 case 表不一致", path.display());
            }
        }
    }
}
