//! 阶段 0 语义基线：`bcut-timeline::motion` 的 golden 夹具与乱序采样一致性。
//!
//! 夹具位于 `tests/fixtures/motion/`，由本文件生成，也由本文件逐位校验。
//! 重生成：`BCUT_UPDATE_GOLDEN=1 cargo test -p bcut-timeline --test motion_baseline`。
//!
//! 比较策略：**按序列化文本逐字节比对**，不留 epsilon。`to_string_pretty` 的输出
//! （ryu 最短往返表示 + BTreeMap 键序）本身是确定的，逐字节比对才是真正的
//! 「逐位不变」，也不依赖解析方向的设置。
//!
//! 采样要读内置 preset JSON，17 位有效数字的常量（`timeline.loop.elSway3d` 的
//! `0.9659258262890683`）只有正确舍入才读得准。`core/Cargo.toml` 在 workspace 层给
//! serde_json 开了 `float_roundtrip`，`-p bcut-timeline` 单跑、`--workspace` 与 Web
//! wasm 读出同一个 double，golden 只有一份。解析方向的守卫在
//! `bcut-motion/tests/float_parse.rs`。

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{Value, json};
use timeline::motion::{
    AnimationPartUnit, AnimationPose, TextAnimationFrame, resolve_animation_pose,
    resolve_text_animation, split_animation_parts, summarize_animation,
};
use timeline::schema::{
    Animation, AnimationSlot, ENTER_PRESETS, EXIT_LEGACY_PRESETS, EXIT_PRESETS, LOOP_PRESETS,
};

// ── 固定采样窗口 ─────────────────────────────────────────────────────
// start=1.0 / end=5.0 / projectEnd=10.0 / fps=30：lifetime 4s，half=2s，
// 所有内置 preset 的缺省时长（0.30..0.90）都不会被 `half` 挤压，因此入场、
// 空闲循环、退场三段都真实出现在窗口内。
const START: f64 = 1.0;
const END: f64 = 5.0;
const PROJECT_END: f64 = 10.0;
const FPS: f64 = 30.0;

/// 出场配方表 = 文档的 exit 闭集（第 156 轮起同一张表，`preset_lists_frozen`
/// 对拍注册表）；`sink`/`shrink` 既是 `rise`/`pop` 的镜像目标也能显式写进文档。
const EXIT_PRESET_IDS: &[&str] = EXIT_PRESETS;

/// 0.1 兼容名：exit 槽读入合法但没有出场配方，写进 exit 槽应当完全没有退场。
/// `bounce` 没有自己的 exit 配方（倒放的弹跳没有设计稿条目），跟随入场时经
/// `mirror: "rise"` 派生退场（2026-08-30）。`drop` 自 2026-09-05 起有同名出场
/// （设计稿 stomp），不再在此列。
const EXIT_ONLY_IN_SCHEMA: &[&str] = EXIT_LEGACY_PRESETS;

/// 覆盖 [start, end] 的局部偏移网格（秒）。前段密、中段稀、尾段密，
/// 因此同时压住入场曲线、空闲循环包络与退场曲线。
const LOCAL_GRID: &[f64] = &[
    0.0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.9, 1.2, 2.0, 2.8, 3.4, 3.6, 3.8, 3.9, 4.0,
];

/// 显式 `dur = 0.4`（30 fps 下正好 12 帧）时的进度点：0/25/50/75/100%
/// 全部落在帧网格上，进度与量化后的时间一一对应。
const PROGRESS_DUR: f64 = 0.4;
const PROGRESS_POINTS: &[f64] = &[0.0, 0.25, 0.5, 0.75, 1.0];

const INTENSITIES: &[f64] = &[0.5, 1.0];

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/motion")
}

fn updating() -> bool {
    std::env::var_os("BCUT_UPDATE_GOLDEN").is_some_and(|value| !value.is_empty())
}

/// 写出或逐位比对 golden。`serde_json` 未开启 `preserve_order`，`Map` 即
/// `BTreeMap`，键序天然稳定。
fn assert_golden(name: &str, actual: &Value) {
    let path = fixture_dir().join(name);
    let mut text = serde_json::to_string_pretty(actual).expect("序列化 golden");
    text.push('\n');
    if updating() {
        std::fs::create_dir_all(fixture_dir()).expect("创建 fixtures/motion");
        std::fs::write(&path, &text).expect("写入 golden");
        return;
    }
    let expected = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "读取 {} 失败：{error}；用 BCUT_UPDATE_GOLDEN=1 重生成",
            path.display()
        )
    });
    if expected == text {
        return;
    }
    let (line, want, got) = expected
        .lines()
        .zip(text.lines())
        .enumerate()
        .find(|(_, (a, b))| a != b)
        .map(|(index, (a, b))| (index + 1, a.to_owned(), b.to_owned()))
        .unwrap_or_else(|| {
            (
                expected.lines().count().min(text.lines().count()) + 1,
                format!("<{} 行>", expected.lines().count()),
                format!("<{} 行>", text.lines().count()),
            )
        });
    panic!(
        "{} 与当前实现不一致（第 {line} 行）：\n  golden: {want}\n  实得:   {got}\n\
         这是语义变更，必须先确认再用 BCUT_UPDATE_GOLDEN=1 重生成。",
        path.display()
    );
}

fn slot(preset: &str) -> AnimationSlot {
    AnimationSlot {
        preset: preset.to_owned(),
        preset_version: Some(1),
        dur: None,
        delay: None,
        intensity: None,
        ease: None,
        stagger: None,
        stagger_from: None,
        period: None,
        phase: None,
        seed: None,
    }
}

fn with_intensity(mut slot: AnimationSlot, intensity: f64) -> AnimationSlot {
    slot.intensity = Some(intensity);
    slot
}

fn animation(
    enter: Option<AnimationSlot>,
    exit: Option<AnimationSlot>,
    r#loop: Option<AnimationSlot>,
) -> Animation {
    Animation {
        enter,
        exit,
        r#loop,
    }
}

fn pose_json(pose: AnimationPose) -> Value {
    json!({
        "opacity": pose.opacity,
        "dx": pose.dx,
        "dy": pose.dy,
        "scaleX": pose.scale_x,
        "scaleY": pose.scale_y,
        "rotation": pose.rotation,
        "blur": pose.blur,
        "reveal": pose.reveal,
    })
}

fn summary_json(animation: &Animation) -> Value {
    Value::Array(
        summarize_animation(animation)
            .into_iter()
            .map(|item| {
                json!({
                    "kind": format!("{:?}", item.kind),
                    "preset": item.preset,
                    "derived": item.derived,
                })
            })
            .collect(),
    )
}

/// 序列化 animation 并剔除 `null` 字段：夹具只记真正被设置的槽位参数。
fn animation_json(animation: &Animation) -> Value {
    fn prune(value: Value) -> Value {
        match value {
            Value::Object(map) => Value::Object(
                map.into_iter()
                    .filter(|(_, value)| !value.is_null())
                    .map(|(key, value)| (key, prune(value)))
                    .collect(),
            ),
            other => other,
        }
    }
    prune(serde_json::to_value(animation).expect("序列化 animation"))
}

struct Case {
    id: String,
    animation: Animation,
    /// `None` = 用 `LOCAL_GRID`；`Some` = 显式进度点（配合 `dur = PROGRESS_DUR`）。
    progress: Option<ProgressKind>,
}

#[derive(Clone, Copy)]
enum ProgressKind {
    Enter,
    Exit,
}

fn case_json(case: &Case) -> Value {
    let mut samples = Vec::new();
    match case.progress {
        None => {
            for offset in LOCAL_GRID {
                let time = START + offset;
                samples.push(json!({
                    "local": offset,
                    "t": time,
                    "pose": pose_json(resolve_animation_pose(
                        Some(&case.animation),
                        START,
                        Some(END),
                        PROJECT_END,
                        time,
                        FPS,
                    )),
                }));
            }
        }
        Some(kind) => {
            for progress in PROGRESS_POINTS {
                let time = match kind {
                    ProgressKind::Enter => START + progress * PROGRESS_DUR,
                    ProgressKind::Exit => END - PROGRESS_DUR + progress * PROGRESS_DUR,
                };
                samples.push(json!({
                    "progress": progress,
                    "t": time,
                    "pose": pose_json(resolve_animation_pose(
                        Some(&case.animation),
                        START,
                        Some(END),
                        PROJECT_END,
                        time,
                        FPS,
                    )),
                }));
            }
        }
    }
    json!({
        "id": case.id,
        "animation": animation_json(&case.animation),
        "summary": summary_json(&case.animation),
        "samples": samples,
    })
}

/// 全部 golden case。顺序即夹具顺序，改动会体现在 diff 里。
fn cases() -> Vec<Case> {
    let mut cases = Vec::new();

    // ① 进度组：显式 dur=0.4 / delay=0，进度 0/25/50/75/100% × intensity。
    for preset in ENTER_PRESETS {
        for intensity in INTENSITIES {
            let mut enter = with_intensity(slot(preset), *intensity);
            enter.dur = Some(PROGRESS_DUR);
            enter.delay = Some(0.0);
            cases.push(Case {
                id: format!("progress/enter/{preset}@i{intensity}"),
                // exit 显式给 none：只观察入场曲线，不让镜像退场混进来。
                animation: animation(Some(enter), Some(slot("none")), None),
                progress: Some(ProgressKind::Enter),
            });
        }
    }
    for preset in EXIT_PRESET_IDS {
        for intensity in INTENSITIES {
            let mut exit = with_intensity(slot(preset), *intensity);
            exit.dur = Some(PROGRESS_DUR);
            exit.delay = Some(0.0);
            cases.push(Case {
                id: format!("progress/exit/{preset}@i{intensity}"),
                animation: animation(None, Some(exit), None),
                progress: Some(ProgressKind::Exit),
            });
        }
    }

    // ② 缺省时长的入场 + 派生镜像退场（exit 缺席 → effective_exit 推导）。
    for preset in ENTER_PRESETS {
        cases.push(Case {
            id: format!("default/enterWithMirroredExit/{preset}"),
            animation: animation(Some(slot(preset)), None, None),
            progress: None,
        });
    }

    // ③ 缺省时长的显式退场（enter 缺席）。
    for preset in EXIT_PRESET_IDS {
        cases.push(Case {
            id: format!("default/explicitExit/{preset}"),
            animation: animation(None, Some(slot(preset)), None),
            progress: None,
        });
    }

    // ④ 写进 exit 槽但无 exit 配方的 id：应当完全没有退场。
    for preset in EXIT_ONLY_IN_SCHEMA {
        cases.push(Case {
            id: format!("default/exitWithoutRecipe/{preset}"),
            animation: animation(Some(slot("fade")), Some(slot(preset)), None),
            progress: None,
        });
    }

    // ⑤ 显式 exit=none 阻断镜像推导。
    cases.push(Case {
        id: "default/explicitNoneBlocksMirror/rise".to_owned(),
        animation: animation(Some(slot("rise")), Some(slot("none")), None),
        progress: None,
    });
    // enter=none 时既无入场也无镜像退场。
    cases.push(Case {
        id: "default/enterNone".to_owned(),
        animation: animation(Some(slot("none")), None, None),
        progress: None,
    });

    // ⑥ 循环：enter/exit 固定为 fade，观察空闲段的循环与包络；
    //    jitter 额外覆盖缺省 seed(17)、显式 17 与 42。
    let mut loop_slots: Vec<(String, AnimationSlot)> = Vec::new();
    for preset in LOOP_PRESETS {
        loop_slots.push(((*preset).to_owned(), slot(preset)));
    }
    for seed in [17_u64, 42] {
        let mut jitter = slot("jitter");
        jitter.seed = Some(seed);
        loop_slots.push((format!("jitter#seed{seed}"), jitter));
    }
    for (label, loop_slot) in loop_slots {
        for intensity in INTENSITIES {
            cases.push(Case {
                id: format!("loop/{label}@i{intensity}"),
                animation: animation(
                    Some(slot("fade")),
                    Some(slot("fade")),
                    Some(with_intensity(loop_slot.clone(), *intensity)),
                ),
                progress: None,
            });
        }
    }
    // 只有循环、没有入场/退场：空闲段 = 整个生命周期。
    cases.push(Case {
        id: "loop/floatOnly".to_owned(),
        animation: animation(None, None, Some(slot("float"))),
        progress: None,
    });

    cases
}

/// ADR-M10：舞台 60 fps 与导出项目 fps 用的是两张时间网格，`quantize_time`
/// 向下取整，因此同一瞬时在两张网格上会落到不同的 pose。这里把差异钉成数据。
fn fps_quantization() -> Value {
    let animation = animation(Some(slot("rise")), None, Some(slot("float")));
    let probes = [1.0, 1.01, 1.025, 1.04, 1.1, 1.2599, 2.5, 3.0, 4.995];
    let rows = probes
        .iter()
        .map(|time| {
            let at30 = resolve_animation_pose(
                Some(&animation),
                START,
                Some(END),
                PROJECT_END,
                *time,
                30.0,
            );
            let at60 = resolve_animation_pose(
                Some(&animation),
                START,
                Some(END),
                PROJECT_END,
                *time,
                60.0,
            );
            json!({
                "t": time,
                "quantized30": (time * 30.0 + 1e-9).floor() / 30.0,
                "quantized60": (time * 60.0 + 1e-9).floor() / 60.0,
                "fps30": pose_json(at30),
                "fps60": pose_json(at60),
                "identical": at30 == at60,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "note": "ADR-M10：舞台 60 fps 与导出项目 fps 的量化差异基线；阶段 1 统一到项目 fps 后 fps60 行按预期变化。",
        "animation": animation_json(&animation),
        "window": {"start": START, "end": END, "projectEnd": PROJECT_END},
        "rows": rows,
    })
}

#[test]
fn timeline_poses_match_golden() {
    let cases = cases().iter().map(case_json).collect::<Vec<_>>();
    let document = json!({
        "note": "Timeline enter/exit/loop preset 的 AnimationPose 语义基线（阶段 0）。",
        "generator": "cargo test -p bcut-timeline --test motion_baseline（BCUT_UPDATE_GOLDEN=1 重生成）",
        "window": {"start": START, "end": END, "projectEnd": PROJECT_END, "fps": FPS},
        "enterPresets": ENTER_PRESETS,
        "exitPresets": EXIT_PRESET_IDS,
        "exitLegacyPresets": EXIT_ONLY_IN_SCHEMA,
        "loopPresets": LOOP_PRESETS,
        "localGrid": LOCAL_GRID,
        "progressDur": PROGRESS_DUR,
        "progressPoints": PROGRESS_POINTS,
        "intensities": INTENSITIES,
        "cases": cases,
        "fpsQuantization": fps_quantization(),
    });
    assert_golden("timeline-poses.json", &document);
}

// ── 文字 part ────────────────────────────────────────────────────────

const TEXT_SAMPLES: &[(&str, &str)] = &[
    ("empty", ""),
    ("single", "a"),
    ("english", "Hello world"),
    ("chinese", "你好，世界"),
    ("mixed", "Hello 世界 mix"),
    ("emoji", "ok 👍🏽 go 🇨🇳"),
    ("combining", "cafe\u{301} test"),
    ("padded", "  spaced   out  "),
    ("newline", "line one\nline two"),
];

fn ranges_json(text: &str, unit: AnimationPartUnit) -> Value {
    Value::Array(
        split_animation_parts(text, unit)
            .into_iter()
            .map(|range| {
                json!({
                    "start": range.start,
                    "end": range.end,
                    "text": &text[range.clone()],
                })
            })
            .collect(),
    )
}

/// 每个采样只记 container 与 parts：`ranges` 在同一条 case 内恒定，提到 case
/// 层单记一次（完整切分另见 `splits`）。
fn frame_json(frame: &TextAnimationFrame) -> Value {
    json!({
        "container": pose_json(frame.container),
        "parts": frame.parts.iter().map(|part| json!({
            "index": part.index,
            "opacity": part.opacity,
            "dx": part.dx,
            "dy": part.dy,
        })).collect::<Vec<_>>(),
    })
}

fn frame_ranges_json(frame: &TextAnimationFrame, text: &str) -> Value {
    Value::Array(
        frame
            .ranges
            .iter()
            .map(|range| {
                json!({
                    "start": range.start,
                    "end": range.end,
                    "text": &text[range.clone()],
                })
            })
            .collect(),
    )
}

/// 文字级联采样时刻：入场窗口内密集（级联展开）、窗口后一点（回落到容器
/// pose）、退场段（镜像退场）。
const TEXT_TIMES: &[f64] = &[
    1.0, 1.03, 1.07, 1.12, 1.18, 1.3, 1.5, 1.9, 2.5, 4.6, 4.9, 5.0,
];

#[test]
fn timeline_text_parts_match_golden() {
    let mut splits = Vec::new();
    for (label, text) in TEXT_SAMPLES {
        splits.push(json!({
            "id": label,
            "text": text,
            "byteLen": text.len(),
            "char": ranges_json(text, AnimationPartUnit::Char),
            "word": ranges_json(text, AnimationPartUnit::Word),
        }));
    }

    let mut frames = Vec::new();
    for preset in ["typewriter", "riseWords"] {
        for (label, text) in TEXT_SAMPLES {
            for intensity in INTENSITIES {
                let animation =
                    animation(Some(with_intensity(slot(preset), *intensity)), None, None);
                let mut ranges = Value::Null;
                let mut unit = Value::Null;
                let samples = TEXT_TIMES
                    .iter()
                    .map(|time| {
                        let frame = resolve_text_animation(
                            Some(&animation),
                            START,
                            Some(END),
                            PROJECT_END,
                            *time,
                            FPS,
                            text,
                        );
                        let here = frame_ranges_json(&frame, text);
                        let here_unit = frame
                            .unit
                            .map_or(Value::Null, |unit| Value::from(format!("{unit:?}")));
                        if !frame.parts.is_empty() {
                            // 级联期间 unit/ranges 恒定：提到 case 层单记一次。
                            if ranges.is_null() {
                                ranges = here;
                                unit = here_unit;
                            } else {
                                assert_eq!(
                                    ranges, here,
                                    "{preset}/{label} 的 ranges 在级联期间漂移"
                                );
                                assert_eq!(unit, here_unit);
                            }
                        }
                        json!({"t": time, "frame": frame_json(&frame)})
                    })
                    .collect::<Vec<_>>();
                frames.push(json!({
                    "id": format!("{preset}/{label}@i{intensity}"),
                    "preset": preset,
                    "text": text,
                    "intensity": intensity,
                    "unit": unit,
                    "ranges": ranges,
                    "samples": samples,
                }));
            }
        }
    }

    // stagger / staggerFrom 变体：级联顺序是 part 语义的一部分。
    let mut stagger = Vec::new();
    for from in [None, Some("start"), Some("end"), Some("center")] {
        let mut enter = slot("riseWords");
        enter.stagger = Some(0.08);
        enter.stagger_from = from.map(str::to_owned);
        let animation = animation(Some(enter), None, None);
        let text = "one two three four five";
        let samples = [1.0, 1.15, 1.3, 1.5, 1.8]
            .iter()
            .map(|time| {
                let frame = resolve_text_animation(
                    Some(&animation),
                    START,
                    Some(END),
                    PROJECT_END,
                    *time,
                    FPS,
                    text,
                );
                json!({
                    "t": time,
                    "ranges": frame_ranges_json(&frame, text),
                    "frame": frame_json(&frame),
                })
            })
            .collect::<Vec<_>>();
        stagger.push(json!({
            "id": format!("riseWords/staggerFrom={}", from.unwrap_or("<absent>")),
            "staggerFrom": from,
            "text": text,
            "samples": samples,
        }));
    }

    // 非级联 preset 走整容器：确认 resolve_text_animation 退化为 resolve_animation_pose。
    let mut container = Vec::new();
    for preset in ["fade", "pop", "wipe"] {
        let animation = animation(Some(slot(preset)), None, None);
        let text = "Hello world";
        let samples = TEXT_TIMES
            .iter()
            .map(|time| {
                let frame = resolve_text_animation(
                    Some(&animation),
                    START,
                    Some(END),
                    PROJECT_END,
                    *time,
                    FPS,
                    text,
                );
                let pose = resolve_animation_pose(
                    Some(&animation),
                    START,
                    Some(END),
                    PROJECT_END,
                    *time,
                    FPS,
                );
                assert_eq!(
                    frame.container, pose,
                    "{preset} 非级联，容器 pose 必须与 resolve_animation_pose 相同"
                );
                json!({"t": time, "frame": frame_json(&frame)})
            })
            .collect::<Vec<_>>();
        container.push(json!({"id": format!("container/{preset}"), "samples": samples}));
    }

    let document = json!({
        "note": "typewriter / riseWords 的 part 切分与逐 part pose 语义基线（阶段 0）。",
        "generator": "cargo test -p bcut-timeline --test motion_baseline（BCUT_UPDATE_GOLDEN=1 重生成）",
        "window": {"start": START, "end": END, "projectEnd": PROJECT_END, "fps": FPS},
        "times": TEXT_TIMES,
        "splits": splits,
        "frames": frames,
        "stagger": stagger,
        "containerFallback": container,
    });
    assert_golden("timeline-text-parts.json", &document);
}

// ── 乱序采样一致性 ───────────────────────────────────────────────────

/// 固定种子的确定性置换（splitmix64 → Fisher-Yates），不引入 rand 依赖。
fn shuffled(len: usize, mut seed: u64) -> Vec<usize> {
    let mut next = move || {
        seed = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = seed;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    };
    let mut order = (0..len).collect::<Vec<_>>();
    for index in (1..len).rev() {
        let pick = (next() % (index as u64 + 1)) as usize;
        order.swap(index, pick);
    }
    order
}

fn probe_times() -> Vec<f64> {
    // 覆盖窗口内外，含帧内偏移与端点。
    let mut times = Vec::new();
    let mut frame = -6_i32;
    while frame <= 186 {
        times.push(START + f64::from(frame) / FPS);
        frame += 1;
    }
    for extra in [0.9999, 1.0001, 2.51234, 3.33333, 4.99999, 5.5, 9.9] {
        times.push(extra);
    }
    times
}

#[test]
fn resolve_animation_pose_is_order_independent() {
    let times = probe_times();
    let order = shuffled(times.len(), 0x5EED_1234_ABCD_0001);
    assert_ne!(
        order,
        (0..times.len()).collect::<Vec<_>>(),
        "置换必须真乱序"
    );
    for case in cases() {
        let sorted = times
            .iter()
            .map(|time| {
                resolve_animation_pose(
                    Some(&case.animation),
                    START,
                    Some(END),
                    PROJECT_END,
                    *time,
                    FPS,
                )
            })
            .collect::<Vec<_>>();
        let mut shuffled_out = vec![AnimationPose::IDENTITY; times.len()];
        for index in &order {
            shuffled_out[*index] = resolve_animation_pose(
                Some(&case.animation),
                START,
                Some(END),
                PROJECT_END,
                times[*index],
                FPS,
            );
        }
        for (index, (a, b)) in sorted.iter().zip(shuffled_out.iter()).enumerate() {
            assert!(
                bitwise_eq(*a, *b),
                "{} 在 t={} 上顺序/乱序采样不一致：{a:?} vs {b:?}",
                case.id,
                times[index]
            );
        }
    }
}

fn bitwise_eq(a: AnimationPose, b: AnimationPose) -> bool {
    let bits = |pose: AnimationPose| {
        (
            pose.opacity.to_bits(),
            pose.dx.to_bits(),
            pose.dy.to_bits(),
            pose.scale_x.to_bits(),
            pose.scale_y.to_bits(),
            pose.rotation.to_bits(),
            pose.blur.to_bits(),
            pose.reveal.map(f64::to_bits),
        )
    };
    bits(a) == bits(b)
}

#[test]
fn resolve_text_animation_is_order_independent() {
    let times = probe_times();
    let order = shuffled(times.len(), 0x5EED_1234_ABCD_0002);
    for preset in ["typewriter", "riseWords", "fade"] {
        for (_, text) in TEXT_SAMPLES {
            let animation = animation(Some(slot(preset)), None, None);
            let sample = |time: f64| {
                resolve_text_animation(
                    Some(&animation),
                    START,
                    Some(END),
                    PROJECT_END,
                    time,
                    FPS,
                    text,
                )
            };
            let sorted = times.iter().map(|time| sample(*time)).collect::<Vec<_>>();
            let mut out: BTreeMap<usize, TextAnimationFrame> = BTreeMap::new();
            for index in &order {
                out.insert(*index, sample(times[*index]));
            }
            for (index, expected) in sorted.iter().enumerate() {
                let actual = &out[&index];
                let at = times[index];
                assert_eq!(
                    expected.unit, actual.unit,
                    "{preset} 在 t={at} 上 unit 不一致"
                );
                assert_eq!(
                    expected.ranges, actual.ranges,
                    "{preset} 在 t={at} 上 ranges 不一致"
                );
                assert!(
                    bitwise_eq(expected.container, actual.container),
                    "{preset} 在 t={at} 上容器 pose 不一致"
                );
                assert_eq!(expected.parts.len(), actual.parts.len());
                for (a, b) in expected.parts.iter().zip(actual.parts.iter()) {
                    assert_eq!(a.index, b.index);
                    assert_eq!(a.opacity.to_bits(), b.opacity.to_bits(), "t={at}");
                    assert_eq!(a.dx.to_bits(), b.dx.to_bits(), "t={at}");
                    assert_eq!(a.dy.to_bits(), b.dy.to_bits(), "t={at}");
                }
            }
        }
    }
}

#[test]
fn golden_covers_every_declared_preset() {
    let cases = cases();
    let ids = cases
        .iter()
        .map(|case| case.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        ids.len(),
        ids.iter().collect::<std::collections::BTreeSet<_>>().len(),
        "case id 必须唯一"
    );
    for preset in ENTER_PRESETS {
        assert!(
            ids.iter()
                .any(|id| id.starts_with(&format!("progress/enter/{preset}@"))),
            "缺 enter preset 覆盖：{preset}"
        );
    }
    for preset in LOOP_PRESETS {
        assert!(
            ids.iter()
                .any(|id| id.starts_with(&format!("loop/{preset}@"))),
            "缺 loop preset 覆盖：{preset}"
        );
    }
    // exit 配方表与 schema 声明的差集必须被显式覆盖，避免静默漂移。
    for preset in EXIT_PRESET_IDS {
        assert!(
            ids.iter()
                .any(|id| id.starts_with(&format!("progress/exit/{preset}@")))
        );
    }
}

#[test]
fn timeline_schema_preset_lists_are_frozen() {
    // 夹具是按这两张表生成的；表变了必须同时重生成 golden。
    assert_eq!(
        ENTER_PRESETS,
        [
            "none",
            "fade",
            "rise",
            "drop",
            "slideL",
            "slideR",
            "slideUp",
            "slideDown",
            "pop",
            "zoomIn",
            "zoomOut",
            "spin",
            "blurIn",
            "typewriter",
            "riseWords",
            "wipe",
            "compress",
            "bounce",
            "fall",
            "skid",
            "roll",
            "wave",
            "flipboard",
            "dragonfly",
            "billboard",
            "elFade",
            "elFloatL",
            "elFloatR",
            "elFloatUp",
            "elFloatDown",
            "elZoom",
            "elKenBurns",
            "elDrop",
            "elSlideL",
            "elSlideR",
            "elSlideUp",
            "elSlideDown",
            "elWipeL",
            "elWipeR",
            "elWipeUp",
            "elWipeDown",
            "elPop",
            "elBounce",
            "elSpinCw",
            "elSpinCcw",
            "elSlideBounceL",
            "elSlideBounceR",
            "elSlideBounceUp",
            "elSlideBounceDown",
            "elGentleFloatL",
            "elGentleFloatR",
            "elGentleFloatUp",
            "elGentleFloatDown",
        ]
    );
    assert_eq!(
        LOOP_PRESETS,
        [
            "float",
            "pulse",
            "sway",
            "jitter",
            "blink",
            "rotate",
            "heartBeat",
            "vogue",
            "dragonfly",
            "billboard",
            "roll",
            "elSpin",
            "elSpinSmooth",
            "elSpin3d",
            "elBounce",
            "elHeartbeat",
            "elSway",
            "elSway3d",
            "elSqueezy",
            "elJiggle",
        ]
    );
    // JSON Schema 与常量表同源，确认没有第二份清单在漂移。
    let schema = serde_json::to_string(&timeline::schema::schema_json()).unwrap();
    for preset in ENTER_PRESETS.iter().chain(LOOP_PRESETS.iter()) {
        assert!(
            schema.contains(&format!("\"{preset}\"")),
            "schema 缺 {preset}"
        );
    }
}
