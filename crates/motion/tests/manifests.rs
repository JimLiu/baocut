//! 目录与 `include_str!` 清单的一致性守卫。
//!
//! `bcut-motion` 本体不做 I/O，所以这条检查只能放在 dev 测试目标里：
//! 少写一行 `builtin!(...)` 时 crate 照样能编译，只有这里会红。

use std::collections::BTreeSet;
use std::path::PathBuf;

use motion::preset_registry::{Domain, ids, registered_files, validate_all};

fn presets_dir(domain: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("presets/builtin")
        .join(domain)
}

/// `core/presets/builtin/transition/` 是**两张**注册表共用的目录：
/// `bcf.*`（双通道属性配方）与 `caption.*`（字幕入场姿态）由 preset 注册表管，
/// `transition.*` 是 effect 注册表的双画面效果（`tests/effects.rs` 管）。
/// 按前缀切分，谁也别把对方的文件算成缺注册。
fn files_on_disk(domain: &str) -> BTreeSet<String> {
    std::fs::read_dir(presets_dir(domain))
        .expect("preset directory")
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            if path.extension()?.to_str()? != "json" {
                return None;
            }
            let stem = path.file_stem()?.to_str()?.to_owned();
            if domain == "transition" && !(stem.starts_with("bcf.") || stem.starts_with("caption."))
            {
                return None;
            }
            Some(stem)
        })
        .collect()
}

#[test]
fn every_manifest_file_on_disk_is_registered() {
    // `shape` / `sticker` / `visualizer` / `progress` 是目录型配方（ADR-E05），
    // `textpreset` 是文字预设包（`docs/design/app-v2/text-pane-and-groups.md` §6.2）。
    // 不把它们加进这个循环，新目录就**永远**不做一致性检查——少写一行
    // `builtin!(...)` 时 crate 照样编译。
    for domain in [
        "motion",
        "transition",
        "shape",
        "sticker",
        "visualizer",
        "progress",
        "confetti",
        "textpreset",
    ] {
        let disk = files_on_disk(domain);
        let registered: BTreeSet<String> = registered_files(domain)
            .into_iter()
            .map(str::to_owned)
            .collect();
        assert_eq!(
            disk, registered,
            "{domain}: core/presets/builtin/{domain} 与 preset_registry.rs 的清单不一致"
        );
    }
}

#[test]
fn the_effect_domain_directories_exist() {
    // effect manifest 的目录一致性由 `tests/effects.rs` 守（它们不是 motion
    // preset，注册表也是另一张）；这里只确认路径约定没被搬走。
    for domain in ["filter", "composite"] {
        assert!(
            presets_dir(domain).is_dir(),
            "缺 core/presets/builtin/{domain}"
        );
    }
}

#[test]
fn all_manifests_parse_and_the_catalogue_is_frozen() {
    validate_all().unwrap();
    // 文字目录 25/21/11 + 元素目录 28/28/9（2026-09-08）。
    assert_eq!(ids(Domain::TimelineEnter).len(), 53);
    assert_eq!(ids(Domain::TimelineExit).len(), 49);
    assert_eq!(ids(Domain::TimelineLoop).len(), 20);
    assert_eq!(ids(Domain::BcfMotion).len(), 5);
    assert_eq!(ids(Domain::BcfTransition).len(), 10);
    // P7a：23 种基础形状 + BaoCut 自有的 `line`，顺序 = 面板网格序。
    assert_eq!(
        ids(Domain::TimelineShape),
        vec![
            "rect", "ellipse", "triangle", "rombus", "pentagon", "hex", "octagon", "squig",
            "squig2", "line", "arrow", "tick", "tick2", "chevron", "chevron2", "cross2", "cross",
            "love2", "love", "diamond", "star", "sharp", "star2", "sharp2"
        ]
    );
    // P7b：模板贴纸首批 10 份，全部是 BaoCut 自绘的归一化 path。
    assert_eq!(
        ids(Domain::TimelineSticker),
        vec![
            "badge_check",
            "badge_cross",
            "star_burst",
            "speech_bubble",
            "heart",
            "bolt",
            "pin",
            "sparkle",
            "arrow_curved",
            "crown"
        ]
    );
    // 声波 10（2026-09 重设计）+ 进度 14（设计 §7.3 / §7.4）——BaoCut 不做付费分层，
    // 也不把 Countdown / Count Up 当 progress（那是文字元素）。
    assert_eq!(ids(Domain::TimelineVisualizer).len(), 10);
    assert_eq!(ids(Domain::TimelineProgress).len(), 14);
    // 彩纸十款（`docs/design/elements/bcut-confetti-element-design.md` §4.4）。
    assert_eq!(ids(Domain::TimelineConfetti).len(), 10);
}

/// 目录型配方的 id **就是** `timeline.json` 的面值，也**就是**文件名——
/// 三者逐字相同，`preset-unknown` 才不需要额外的前缀换算规则。
#[test]
fn the_catalogue_ids_match_the_files_and_the_document_values() {
    for (dir, domain) in [
        ("shape", Domain::TimelineShape),
        ("sticker", Domain::TimelineSticker),
        ("visualizer", Domain::TimelineVisualizer),
        ("progress", Domain::TimelineProgress),
        ("confetti", Domain::TimelineConfetti),
    ] {
        let registered: BTreeSet<String> = registered_files(dir)
            .into_iter()
            .map(str::to_owned)
            .collect();
        let ids: BTreeSet<String> = ids(domain).into_iter().map(str::to_owned).collect();
        assert_eq!(registered, ids, "{dir}");
        assert_eq!(files_on_disk(dir), ids, "{dir}");
    }
}

/// `(id, version)` 是目录型配方的冻结单位，`manifest_hash` 是源文件内容 hash——
/// 34 份逐份钉住：id 与文件名逐字相同、`version` 恒为 1、`manifest_hash` 互不相同
/// 且随文件内容变（改一个参数就必须自觉升 `version`）。
#[test]
fn the_thirty_four_catalogue_recipes_are_frozen_at_version_one() {
    use motion::preset_registry::{timeline_confettis, timeline_progresses, timeline_visualizers};

    let mut hashes = Vec::new();
    for recipe in timeline_visualizers() {
        assert_eq!(recipe.version, 1, "{}", recipe.id);
        assert!(recipe.available, "{}", recipe.id);
        assert_eq!(recipe.qualified_id(), format!("visualizer.{}", recipe.id));
        assert!(recipe.visualizer().is_some(), "{}", recipe.id);
        hashes.push(recipe.manifest_hash);
    }
    for recipe in timeline_progresses() {
        assert_eq!(recipe.version, 1, "{}", recipe.id);
        assert!(recipe.available, "{}", recipe.id);
        assert_eq!(recipe.qualified_id(), format!("progress.{}", recipe.id));
        assert!(recipe.progress().is_some(), "{}", recipe.id);
        hashes.push(recipe.manifest_hash);
    }
    for recipe in timeline_confettis() {
        assert_eq!(recipe.version, 1, "{}", recipe.id);
        assert!(recipe.available, "{}", recipe.id);
        assert_eq!(recipe.qualified_id(), format!("confetti.{}", recipe.id));
        let body = recipe.confetti().expect(&recipe.id);
        // 「起点」开关只给四款爆发（设计稿 §6.2）。
        let burst = body
            .recipe
            .object("emit")
            .and_then(|e| e.get("mode"))
            .and_then(|m| m.as_str())
            == Some("burst");
        assert_eq!(body.has_emitter_control, burst, "{}", recipe.id);
        hashes.push(recipe.manifest_hash);
    }
    assert_eq!(hashes.len(), 34);
    let total = hashes.len();
    hashes.sort_unstable();
    hashes.dedup();
    assert_eq!(hashes.len(), total, "两份配方的 manifest_hash 撞了");
}

/// `available` 是**表面目录**开关（ADR-M09），不是内核门：核心求值从不读它，
/// `bcut render` 照样能画 `wipe`。它只回答「App 的动画面板里能不能选到这一行」，
/// 而 `wipe` 还没有元素包围盒可裁，所以目录里藏着它
/// （`core/crates/bcut-editor-core/src/anim_presets.rs`）。
/// 第 156 轮起目录里没有不可用的行（`wipe` 的 reveal 由核心合成场景裁切）；
/// 这条表钉住"没有配方悄悄以 available: false 溜进目录"。
const UNAVAILABLE_TIMELINE_PRESETS: &[&str] = &[];

#[test]
fn every_manifest_declares_a_determinism_level() {
    for name in ids(Domain::TimelineEnter) {
        let recipe = motion::preset_registry::timeline_enter(name).unwrap();
        assert_eq!(recipe.determinism, "strict", "{name}");
        assert_eq!(
            recipe.available,
            !UNAVAILABLE_TIMELINE_PRESETS.contains(&name),
            "{name}"
        );
    }
    for name in ids(Domain::TimelineExit) {
        let recipe = motion::preset_registry::timeline_exit(name).unwrap();
        assert_eq!(recipe.determinism, "strict", "{name}");
        assert_eq!(
            recipe.available,
            !UNAVAILABLE_TIMELINE_PRESETS.contains(&name),
            "{name}"
        );
    }
    for name in ids(Domain::TimelineLoop) {
        let recipe = motion::preset_registry::timeline_loop(name).unwrap();
        assert_eq!(recipe.determinism, "strict", "{name}");
    }
}

// ── 字幕入场姿态（阶段 5 收编的 `magic-*`）────────────────────────────

/// 三条配方的数字是**字幕像素的真相**。这条测试把它们和收编前
/// `core/crates/bcut-kernel/src/cmd/studio_export/transition.rs` 里的字面量逐项对齐——
/// 改配方就得先改这里，改不动就说明改错了。
#[test]
fn the_caption_transition_recipes_match_the_historical_constants() {
    use motion::curve::CurveSpec;
    use motion::preset_registry::{caption_transition, caption_transitions};

    let expected: &[(&str, &str, [f64; 4])] = &[
        (
            "magic-fade",
            "transition.caption.fade",
            [0.42, 0.0, 0.58, 1.0],
        ),
        (
            "magic-pop",
            "transition.caption.pop",
            [0.22, 0.19, 0.54, 1.62],
        ),
        (
            "magic-flip",
            "transition.caption.flip",
            [0.25, 0.46, 0.45, 0.94],
        ),
    ];
    assert_eq!(caption_transitions().len(), expected.len());
    for (legacy, id, bezier) in expected {
        let recipe = caption_transition(legacy).unwrap_or_else(|| panic!("缺 {legacy}"));
        assert_eq!(recipe.id, *id);
        assert_eq!(recipe.version, 1);
        assert_eq!(recipe.determinism, "strict");
        // 相位量化是配方参数，不是实现细节：字幕姿态跟的是帧号。
        assert_eq!(recipe.time_quantization, "round-both-ends");
        assert_eq!(recipe.solver, "newton6-bisect10-1e-6");
        assert_eq!(
            recipe.curve,
            CurveSpec::CubicBezier {
                x1: bezier[0],
                y1: bezier[1],
                x2: bezier[2],
                y2: bezier[3],
            }
        );
    }

    // 派生通道逐条对齐原实现的表达式。
    let fade = caption_transition("magic-fade").unwrap();
    assert_eq!(
        fade.channels
            .iter()
            .map(|channel| channel.prop.as_str())
            .collect::<Vec<_>>(),
        ["opacity", "blur"]
    );
    for e in [0.0, 0.25, 0.5, 0.75, 1.0] {
        // opacity = clamp(e, 0, 1)
        assert_eq!(
            fade.channel_value(&fade.channels[0], e, 2.5),
            e.clamp(0.0, 1.0)
        );
        // blur = (6 × canvasScale × (1 − e)).max(0) —— 求值顺序与原式相同
        for scale in [1.0, 2.5, 0.75] {
            assert_eq!(
                fade.channel_value(&fade.channels[1], e, scale),
                (6.0 * scale * (1.0 - e)).max(0.0)
            );
        }
    }
    let pop = caption_transition("magic-pop").unwrap();
    for e in [0.0, 0.4, 1.0, 1.1] {
        // scale = 0.7 + 0.3e，**不夹**（曲线会过冲到 1 以上）
        assert_eq!(pop.channel_value(&pop.channels[0], e, 1.0), 0.7 + 0.3 * e);
    }
    let flip = caption_transition("magic-flip").unwrap();
    for e in [-0.1, 0.0, 0.6, 1.0, 1.2] {
        assert_eq!(
            flip.channel_value(&flip.channels[0], e, 1.0),
            e.clamp(0.0, 1.0)
        );
    }

    // 相位：两端各自按 fps 取整再相减。
    let fps = 30.0;
    assert_eq!(
        fade.phase(1.0 / 3.0, 0.02, 0.4, fps),
        (10.0 / 30.0 - 1.0 / 30.0) / 0.4
    );
}

/// 字幕配方为什么要显式声明 `solver`：两条求解器在 `[0, 1]` 上**不等**，
/// 差值乘 255 之后落到 u8 舍入边界上就是字幕像素差。
#[test]
fn the_caption_solver_is_not_interchangeable_with_the_default_one() {
    let (x1, y1, x2, y2) = (0.22, 0.19, 0.54, 1.62);
    let mut worst = 0.0f64;
    let mut differs = false;
    for step in 0..=1000 {
        let t = f64::from(step) / 1000.0;
        let a = motion::curve::cubic_bezier_caption(x1, y1, x2, y2, t);
        let b = motion::curve::cubic_bezier(x1, y1, x2, y2, t);
        if a != b {
            differs = true;
        }
        worst = worst.max((a - b).abs());
    }
    assert!(differs, "两条求解器如果逐位相同，配方就不必声明 solver 了");
    assert!(worst > 1e-7, "实测最大差 {worst}");
    // 端点仍然一致——差的是中间的迭代精度。
    for (x1, y1, x2, y2) in [(0.42, 0.0, 0.58, 1.0), (0.25, 0.46, 0.45, 0.94)] {
        assert_eq!(
            motion::curve::cubic_bezier_caption(x1, y1, x2, y2, 0.0),
            0.0
        );
        assert_eq!(
            motion::curve::cubic_bezier_caption(x1, y1, x2, y2, 1.0),
            1.0
        );
    }
}

// ── 模板贴纸目录（设计 §10 P7 / P7b）─────────────────────────────────

/// 模板贴纸的**结构**判据：这一批的价值不在"画了什么"，而在"配方形状对不对"。
/// 每份都要有层、每层都要有颜色和轮廓、`strokeWidth` 是元素盒短边的比例而不是
/// 像素、`(id, version)` 冻结、`manifest_hash` 互不相同。P7c 扩充模板是纯数据，
/// 这条测试是它的护栏。
#[test]
fn every_sticker_template_is_a_stack_of_coloured_outlines() {
    use motion::preset_registry::{PathSegment, timeline_sticker, timeline_stickers};

    let mut hashes = Vec::new();
    for recipe in timeline_stickers() {
        let id = recipe.id.as_str();
        assert_eq!(recipe.version, 1, "{id}");
        assert!(recipe.available, "{id}");
        assert_eq!(recipe.qualified_id(), format!("sticker.{id}"), "{id}");
        // 贴纸没有绘制算法：它是矢量直出，不像 visualizer / progress 要内核名。
        assert!(recipe.recipe().is_none(), "{id}");
        assert!(recipe.shape().is_none(), "{id}");
        let body = recipe.sticker().expect("sticker 目录只装 sticker 配方");
        assert!(!body.layers.is_empty(), "{id}");
        for layer in &body.layers {
            assert!(
                layer.fill.is_some() || layer.stroke.is_some(),
                "{id}: 每层至少要有一个颜色"
            );
            for color in [layer.fill.as_deref(), layer.stroke.as_deref()]
                .into_iter()
                .flatten()
            {
                assert!(color.starts_with('#'), "{id}: {color}");
                assert!(matches!(color.len(), 7 | 9), "{id}: {color}");
            }
            assert!(
                layer.stroke_width > 0.0 && layer.stroke_width <= 1.0,
                "{id}: strokeWidth 是元素盒短边的比例"
            );
            assert!(
                matches!(layer.segments.first(), Some(PathSegment::Move(_))),
                "{id}: 轮廓必须以 move 开头"
            );
            // 几何写在单位正方里（0..1）：越界会在元素盒外画出去。
            for point in layer.segments.iter().flat_map(|segment| match segment {
                PathSegment::Move(p) | PathSegment::Line(p) => vec![*p],
                PathSegment::Quad(a, b) => vec![*a, *b],
                PathSegment::Cubic(a, b, c) => vec![*a, *b, *c],
                PathSegment::Close => Vec::new(),
            }) {
                assert!(
                    (0.0..=1.0).contains(&point[0]) && (0.0..=1.0).contains(&point[1]),
                    "{id}: 点 {point:?} 越出单位正方"
                );
            }
        }
        assert!(timeline_sticker(id).is_some(), "{id}");
        hashes.push(recipe.manifest_hash);
    }
    assert_eq!(hashes.len(), 10);
    let total = hashes.len();
    hashes.sort_unstable();
    hashes.dedup();
    assert_eq!(hashes.len(), total, "两份模板的 manifest_hash 撞了");
    assert!(timeline_sticker("no-such-template").is_none());
}

/// 多层多色是贴纸与 shape 的分水岭：至少有一份模板真的用了两层以上、两种颜色。
/// 只有一层单色的"贴纸"应该做成 shape 配方，不该占贴纸目录。
#[test]
fn the_sticker_catalogue_actually_uses_more_than_one_layer() {
    use motion::preset_registry::timeline_stickers;

    let multi = timeline_stickers()
        .iter()
        .filter(|recipe| recipe.sticker().expect("sticker body").layers.len() > 1)
        .count();
    assert!(multi >= 6, "多层模板只有 {multi} 份");
}

/// 贴纸几何的自证不变量（原先长在 `gen_element_sticker_paths.rs` 的
/// `every_sticker_recipe_has_geometry` 里；Swift/`designs/baocut-mac` 两份
/// 生成物随旧 Mac 表面一起下线后，生成器整体删除，这些与生成物无关的注册表
/// 断言搬到这里继续守着）。
#[test]
fn every_sticker_layer_is_well_formed() {
    use motion::preset_registry::{PathSegment, timeline_stickers};

    for recipe in timeline_stickers() {
        let layers = &recipe.sticker().expect("sticker body").layers;
        assert!(!layers.is_empty(), "{} 一层都没有", recipe.id);
        for layer in layers {
            // 每层的第一段必须是 `move`（解析期已校验），消费者因此不必防守。
            assert!(
                matches!(layer.segments.first(), Some(PathSegment::Move(_))),
                "{} 的某一层没有以 move 开头",
                recipe.id
            );
            // 至少一种颜色（解析期已校验），否则这一层画不出任何东西。
            assert!(
                layer.fill.is_some() || layer.stroke.is_some(),
                "{} 的某一层既没有 fill 也没有 stroke",
                recipe.id
            );
            // 口径自证：描边宽度是比例，不是像素。
            assert!(
                layer.stroke_width > 0.0 && layer.stroke_width <= 1.0,
                "{} 的 strokeWidth 不像比例：{}",
                recipe.id,
                layer.stroke_width
            );
        }
    }
}

/// 波次列的自证：「柱状 4 种 + 曲线/点阵/脉冲 6 种 + progress 8 种」不是一份手抄 id 清单，
/// 而是「绘制内核已落地的算法 ∩ strict」的结果（设计 §7.3/§7.4 的波次列）。
/// 消费者用同一条规则筛，这里钉住它在当前目录上的解——否则 P5 往白名单里加
/// 算法（并放开 strict 限定）时没人知道基线是多少。
/// （原先长在 `gen_element_catalogue.rs`：那份契约夹具的唯一消费者是已下线的
/// Mac 客户端，生成器随之删除，这条与生成物无关的注册表断言搬到这里。）
#[test]
fn the_shipped_wave_is_a_function_of_algorithm_and_determinism() {
    use motion::preset_registry::{timeline_progresses, timeline_visualizers};

    const VISUALIZER_BARS: [&str; 2] = ["spectrum-bars-v1", "polar-bars-v1"];
    const VISUALIZER_CURVES: [&str; 5] = [
        "oscilloscope-v1",
        "spectrum-area-v1",
        "dot-matrix-v1",
        "pulse-rings-v1",
        "ribbons-v1",
    ];
    const PROGRESS_P3: [&str; 3] = ["bar-v1", "frame-v1", "ring-v1"];
    const PROGRESS_P4: [&str; 1] = ["snake-v1"];

    let visualizers = |kernels: &[&str]| {
        let mut ids: Vec<&str> = timeline_visualizers()
            .iter()
            .filter(|recipe| {
                let body = recipe.visualizer().expect("visualizer body");
                recipe.available
                    && body.determinism.name() == "strict"
                    && kernels.contains(&body.recipe.algorithm.name())
            })
            .map(|recipe| recipe.id.as_str())
            .collect();
        ids.sort_unstable();
        ids
    };
    assert_eq!(
        visualizers(&VISUALIZER_BARS),
        ["bars", "bars_bottom", "bars_rounded", "ring_bars"],
        "柱状 4 种"
    );
    assert_eq!(
        visualizers(&VISUALIZER_CURVES),
        [
            "dots",
            "oscilloscope",
            "pulse_rings",
            "ribbons",
            "ring_wave",
            "spectrum_area"
        ],
        "曲线 / 点阵 / 脉冲 6 种"
    );

    let progresses = |kernels: &[&str]| {
        let mut ids: Vec<&str> = timeline_progresses()
            .iter()
            .filter(|recipe| {
                let body = recipe.progress().expect("progress body");
                recipe.available
                    && body.determinism.name() == "strict"
                    && kernels.contains(&body.recipe.algorithm.name())
            })
            .map(|recipe| recipe.id.as_str())
            .collect();
        ids.sort_unstable();
        ids
    };
    assert_eq!(
        progresses(&PROGRESS_P3),
        [
            "border",
            "circle",
            "donut",
            "normal",
            "reverse_border",
            "rounded"
        ],
        "P3 的 progress 6 种"
    );
    assert_eq!(
        progresses(&PROGRESS_P4),
        ["snake", "snake_spin"],
        "P4 的 snake 2 种"
    );

    // 已上线的合集正是消费者白名单的解：10 + 8。
    let mut shipped = VISUALIZER_BARS.to_vec();
    shipped.extend(VISUALIZER_CURVES);
    assert_eq!(visualizers(&shipped).len(), 10);
    let mut shipped = PROGRESS_P3.to_vec();
    shipped.extend(PROGRESS_P4);
    assert_eq!(progresses(&shipped).len(), 8);
}
