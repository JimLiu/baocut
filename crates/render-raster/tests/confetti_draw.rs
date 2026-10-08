//! confetti 的 DrawOp golden：10 款样式 × 6 个时刻（设计稿 §4.5 / §9）。
//!
//! confetti **没有素材源**，输入只有 `(配方, 覆盖参数, 元素本地时刻, 元素盒)`，
//! 因此夹具自带一份 `cases.json`（与 `core/fixtures/progress/cases.json` 平级、
//! 互不引用）。比法同样是**序列化文本逐字节比对**。
//!
//! ```bash
//! cd core
//! cargo test -p bcut-render --test confetti_draw
//! cargo test -p bcut-render --test confetti_draw -- --ignored   # 确认过再重生成
//! ```

use std::path::{Path, PathBuf};

use motion::preset_registry::{CatalogueRecipe, timeline_confettis};
use render_raster::drawop::{FrameBuilder, fingerprint};
use render_raster::source::{
    ConfettiBox, ConfettiParams, ConfettiShape, confetti_frame, confetti_particles,
};
use serde_json::{Value, json};

/// 元素本地时刻（秒）。`0.0` 是「第一波刚出生」（continuous 在 t=0 只有 0 号
/// 粒子可能活着；burst 整波同时出生）；[`TILE_FRAME`] 是目录磁贴的静止帧；
/// `12.0` 超过所有配方的 `lifeSec`，考的是连续发射 / 重复爆发的第 N 轮，以及
/// `interval: 0` 只爆一次的样式在这里必须是空帧。
const TIMES: [f64; 6] = [0.0, 0.4, 1.2, 2.5, TILE_FRAME, 12.0];
/// 目录磁贴的静止帧（秒），与 `apps/baocut` 的 `CONFETTI_THUMB_TIME`、原型
/// `panel-elements-tile.jsx` 的 `TILE_T` 同一个数。
///
/// 第 234 轮从 1.2 提到 4.5：1.2 s 上连续款才发了一两拍（`hearts-petals`
/// 只有 19 颗、还全挤在顶边那一成里），磁贴看上去是几粒尘。4.5 s 是十款里
/// 「最弱的一款也最强」的时刻——爆发款四种间隔（1.6 / 1.8 / 2.0 / 2.4 s）
/// 在这里都已经炸过且散开，连续款已进稳态。
const TILE_FRAME: f64 = 4.5;
const CANVAS: (f64, f64) = (1920.0, 1080.0);
const PIXEL_SCALE: f64 = 2.0;
const SEED: u64 = 20_260_909;
/// 磁贴静止帧上每款至少要有的活粒子数。
const TILE_MIN_ALIVE: u64 = 24;

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/confetti")
}

fn element_box() -> ConfettiBox {
    ConfettiBox {
        x: 0.0,
        y: 0.0,
        w: CANVAS.0,
        h: CANVAS.1,
    }
}

fn hex(color: &str) -> [f32; 4] {
    let v = u32::from_str_radix(color.trim_start_matches('#'), 16).unwrap();
    let (r, g, b, a) = if color.len() == 9 {
        (
            (v >> 24) & 0xff,
            (v >> 16) & 0xff,
            (v >> 8) & 0xff,
            v & 0xff,
        )
    } else {
        ((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff, 0xff)
    };
    [
        r as f32 / 255.0,
        g as f32 / 255.0,
        b as f32 / 255.0,
        a as f32 / 255.0,
    ]
}

/// 配方缺省 + 固定种子：`colors` / `shapes` 用配方的，倍率全 1。
fn params(recipe: &CatalogueRecipe) -> ConfettiParams {
    let body = recipe.confetti().expect("confetti 配方");
    ConfettiParams {
        seed: SEED,
        colors: body.palette.iter().map(|c| hex(c)).collect(),
        shapes: body
            .shapes
            .iter()
            .map(|s| ConfettiShape::parse(s).expect("配方形状已在注册表解析期校验"))
            .collect(),
        pixel_scale: PIXEL_SCALE,
        ..ConfettiParams::default()
    }
}

fn record(recipe: &CatalogueRecipe, time: f64) -> Value {
    let mut builder = FrameBuilder::default();
    let pushed = confetti_frame(
        &mut builder,
        recipe,
        &params(recipe),
        time,
        None,
        element_box(),
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    );
    let frame = builder.finish();
    assert_eq!(pushed, frame.ops.len(), "返回条数必须等于实际压入条数");
    json!({
        "t": time,
        "ops": frame.ops.len(),
        "paths": frame.paths.len(),
        "fingerprint": format!("{:016x}", fingerprint(&frame)),
    })
}

fn cases_json() -> Value {
    json!({
        "note": "confetti 夹具的**输入**。GPU 对拍与 wasm 复用同一份，各自追加 \
                 expected-*.json。追加新输入请往末尾加，既有编号不动。times 是元素\
                 本地时刻（秒）；颜色与形状取配方缺省，倍率全 1，种子固定。",
        "canvas": [CANVAS.0, CANVAS.1],
        "times": TIMES.to_vec(),
        "pixelScale": PIXEL_SCALE,
        "seed": SEED,
        "box": "画幅 100% × 100%",
        "styles": timeline_confettis()
            .iter()
            .map(CatalogueRecipe::qualified_id)
            .collect::<Vec<_>>(),
    })
}

fn expected_json() -> Value {
    let styles = timeline_confettis()
        .iter()
        .map(|recipe| {
            let body = recipe.confetti().unwrap();
            json!({
                "style": recipe.qualified_id(),
                "algorithm": body.recipe.algorithm.name(),
                "samples": TIMES
                    .iter()
                    .map(|time| record(recipe, *time))
                    .collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "note": "DrawOp 指令流指纹：每帧 = ClipPath + FillPath × N + PopClip，空帧 0 条。",
        "styles": styles,
    })
}

fn pretty(value: &Value) -> Vec<u8> {
    let mut out = serde_json::to_vec_pretty(value).unwrap();
    out.push(b'\n');
    out
}

/// 重新生成夹具。确认过再跑：
/// `cargo test -p bcut-render --test confetti_draw -- --ignored`
#[test]
#[ignore]
fn write_confetti_draw_fixture() {
    let dir = fixture_dir();
    std::fs::create_dir_all(&dir).expect("建夹具目录");
    std::fs::write(dir.join("cases.json"), pretty(&cases_json())).unwrap();
    std::fs::write(dir.join("expected-draw.json"), pretty(&expected_json())).unwrap();
}

/// 日常门禁：当场重算再**逐字节**比。
#[test]
fn the_confetti_fixtures_are_up_to_date() {
    let dir = fixture_dir();
    for (name, expected) in [
        ("cases.json", pretty(&cases_json())),
        ("expected-draw.json", pretty(&expected_json())),
    ] {
        let actual = std::fs::read(dir.join(name))
            .unwrap_or_else(|e| panic!("{name} 缺失（跑 --ignored）：{e}"));
        assert_eq!(actual, expected, "{name} 与生成器不一致");
    }
}

/// **10 款在磁贴静止帧上都画得满**：[`TILE_FRAME`] 上每款至少 [`TILE_MIN_ALIVE`]
/// 颗粒子，且指令流形状恒为 `ClipPath … PopClip`、路径按形状去重
/// （path 数 ≤ 形状数 + 1）。
///
/// 下限不是「> 0」：磁贴是用户认款的唯一凭据，一两颗粒子的帧技术上「活着」
/// 却什么也没告诉他——第 234 轮之前这一条卡在 `ops >= 3`，而 `hearts-petals`
/// 在旧的 1.2 s 上只有 19 颗、全挤在顶边一成里，门禁照样是绿的。
#[test]
fn every_style_is_live_at_the_tile_frame() {
    let styles = timeline_confettis();
    assert_eq!(styles.len(), 10);
    for recipe in styles {
        let entry = record(recipe, TILE_FRAME);
        let ops = entry["ops"].as_u64().unwrap();
        assert!(
            ops >= TILE_MIN_ALIVE + 2,
            "{} @ t={TILE_FRAME} 只有 {} 颗粒子，磁贴上认不出款",
            recipe.qualified_id(),
            ops.saturating_sub(2),
        );
        let shapes = recipe.confetti().unwrap().shapes.len() as u64;
        assert!(
            entry["paths"].as_u64().unwrap() <= shapes + 1,
            "{} 的路径没有按形状去重",
            recipe.qualified_id()
        );
        let body = recipe.confetti().unwrap();
        let max_alive = body.recipe.integer("maxAlive").unwrap();
        assert!(
            ops - 2 <= max_alive,
            "{} 超过 maxAlive",
            recipe.qualified_id()
        );
    }
}

/// 负时刻与空帧：`t < 0` 一条 op 都不压；`interval: 0` 的爆发款在寿命之后是空帧。
#[test]
fn negative_time_and_finished_bursts_push_nothing() {
    for recipe in timeline_confettis() {
        let mut builder = FrameBuilder::default();
        let pushed = confetti_frame(
            &mut builder,
            recipe,
            &params(recipe),
            -0.5,
            None,
            element_box(),
            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        );
        assert_eq!(pushed, 0, "{} 在 t<0 不得画", recipe.qualified_id());
        assert!(builder.finish().ops.is_empty());
    }
    // 单次爆发：用户覆盖 interval = 0 后，t = 12 s 一定是空帧。
    let recipe = timeline_confettis()
        .iter()
        .find(|r| r.qualified_id().ends_with("golden-starburst"))
        .unwrap();
    let mut p = params(recipe);
    p.emit.interval = Some(0.0);
    let mut builder = FrameBuilder::default();
    let pushed = confetti_frame(
        &mut builder,
        recipe,
        &p,
        12.0,
        None,
        element_box(),
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    );
    assert_eq!(pushed, 0);
}

/// 乱序采样 == 顺序采样（导出并行 / 拖播放头的前提）：同一时刻不论之前采过
/// 什么都得到同一指纹；换种子指纹必变。
#[test]
fn sampling_is_order_independent_and_seeded() {
    for recipe in timeline_confettis() {
        let forward: Vec<Value> = TIMES.iter().map(|t| record(recipe, *t)).collect();
        let backward: Vec<Value> = TIMES.iter().rev().map(|t| record(recipe, *t)).collect();
        for (a, b) in forward.iter().zip(backward.iter().rev()) {
            assert_eq!(a, b, "{} 乱序采样漂移", recipe.qualified_id());
        }
        let mut other = params(recipe);
        other.seed = SEED + 1;
        let mut builder = FrameBuilder::default();
        confetti_frame(
            &mut builder,
            recipe,
            &other,
            1.2,
            None,
            element_box(),
            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        );
        let reseeded = format!("{:016x}", fingerprint(&builder.finish()));
        assert_ne!(
            reseeded,
            forward[2]["fingerprint"].as_str().unwrap(),
            "{} 换种子必须换画面",
            recipe.qualified_id()
        );
    }
}

/// `settle`：给定元素时长后，最后 `lifeSec` 秒不再发射，片尾自然清空。
#[test]
fn settle_empties_the_frame_before_the_element_ends() {
    let recipe = timeline_confettis()
        .iter()
        .find(|r| r.qualified_id().ends_with("rainbow-paper"))
        .unwrap();
    let mut p = params(recipe);
    p.emit.settle = true;
    let duration = 6.0;
    let life = recipe.confetti().unwrap().recipe.number("lifeSec").unwrap();
    let mut builder = FrameBuilder::default();
    let at_end = confetti_frame(
        &mut builder,
        recipe,
        &p,
        duration,
        Some(duration),
        element_box(),
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    );
    assert_eq!(at_end, 0, "片尾必须清空");
    let mut builder = FrameBuilder::default();
    let mid = confetti_frame(
        &mut builder,
        recipe,
        &p,
        duration - life - 0.5,
        Some(duration),
        element_box(),
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    );
    assert!(mid > 0, "settle 之前照常发射");
}

// ---------------------------------------------------------------------------
// 铺满整幅（第 234 轮）
// ---------------------------------------------------------------------------

/// **阻力不得把粒子钉死在画面里**。
///
/// 闭式核 `axis(p0, v0, a, k, τ)` 在 `a == 0 && k > 0` 时的位移有硬渐近线
/// `v0 / k`——再长的寿命也越不过去。`hearts-petals` 曾经带着 `gravityPx: 0`
/// 配 `dragY: 0.4`，纵向渐近线只有 `136 / 0.4 = 340` 参考 px，而它是从顶边
/// （`spreadY: 0`）撒下来的，整幅高度都得靠飞行铺，于是画面永远只铺到 51%，
/// 下半幅是空的（用户报的「只铺满了一半」）。
///
/// 门禁按轴看**发射器本来就铺开了多少**：某一轴上发射带已经占满元素盒
/// （`spread == 100`，例如顶边款的横向）时，覆盖不依赖飞行，阻力随便设；
/// 发射带在这一轴上是窄的，剩下的 `(100 − spread)%` 就必须靠位移补上，
/// 而没有加速度（重力 / 风）时位移的上限只有 `speed / drag`。
#[test]
fn drag_never_pins_particles_to_a_frontier_inside_the_frame() {
    const REF_SHORT: f64 = render_raster::source::confetti::kernel::REF_SHORT;
    for recipe in timeline_confettis() {
        let body = recipe.confetti().unwrap();
        let p = &body.recipe;
        let speed = p.array("speedPx").map_or(0.0, |a| {
            a.iter().filter_map(Value::as_f64).fold(0.0, f64::max)
        });
        let emitters = p.array("emitters").expect("配方必须有发射器");
        let widest = |key: &str| {
            emitters
                .iter()
                .filter_map(|e| e.get(key).and_then(Value::as_f64))
                .fold(0.0, f64::max)
        };
        for (axis, drag, accel, spread) in [
            (
                "dragX",
                p.number("dragX"),
                p.number("windPx"),
                widest("spreadX"),
            ),
            (
                "dragY",
                p.number("dragY"),
                p.number("gravityPx"),
                widest("spreadY"),
            ),
        ] {
            let drag = drag.unwrap_or(0.0);
            if drag <= 0.0 || accel.unwrap_or(0.0) != 0.0 {
                continue;
            }
            // 这一轴上还得靠飞行铺开的比例，折成参考短边上的像素（保守下界：
            // 长边方向要求更高，但按短边算已经能拦住整幅留白）。
            let gap = (100.0 - spread).max(0.0) / 100.0 * REF_SHORT;
            assert!(
                speed / drag >= gap,
                "{} 的 {axis}={drag} 把位移钉在 {:.0} 参考 px，\
                 而发射带只铺了这一轴的 {spread:.0}%，还差 {gap:.0} px 要靠飞行——\
                 画面会留一道永远不动的锋面",
                recipe.qualified_id(),
                speed / drag,
            );
        }
    }
}

/// **从顶边或整幅带发射的款必须铺到底边**。
///
/// 上一条是配方层的必要条件，这一条是画面层的实测：把发射器覆盖到画面上半段
/// （顶边撒落）或整幅（全屏带）的那几款采到稳态（`t = 6 s`，已过所有配方的
/// `lifeSec`），画面最上一成与最下一成都必须有粒子。底部礼炮 / 低空爆发那几款
/// 顶部本来就该是空的（那是它们的形，不是缺陷），按发射器带自动豁免。
#[test]
fn styles_seeded_across_the_frame_reach_both_edges() {
    let mut checked = 0;
    for recipe in timeline_confettis() {
        let body = recipe.confetti().unwrap();
        let emitters = body.recipe.array("emitters").expect("配方必须有发射器");
        // 发射器带的上下沿（元素盒百分比）。
        let (mut top, mut bottom) = (f64::MAX, f64::MIN);
        for e in emitters {
            let y = e.get("y").and_then(Value::as_f64).unwrap_or(50.0);
            let h = e.get("spreadY").and_then(Value::as_f64).unwrap_or(0.0);
            top = top.min(y - h / 2.0);
            bottom = bottom.max(y + h / 2.0);
        }
        // 只考「从画面上半段起跑」的款：顶边撒落（带顶沿在 20% 以上）或整幅带。
        if top > 20.0 {
            continue;
        }
        checked += 1;
        let particles = confetti_particles(recipe, &params(recipe), 6.0, None, CANVAS);
        let band = CANVAS.1 / 10.0;
        let hits = |lo: f64, hi: f64| particles.iter().filter(|q| q.y >= lo && q.y < hi).count();
        assert!(
            hits(0.0, band) > 0,
            "{} 稳态时画面顶部一成是空的（发射带 {top:.0}%–{bottom:.0}%）",
            recipe.qualified_id(),
        );
        assert!(
            hits(CANVAS.1 - band, CANVAS.1) > 0,
            "{} 稳态时画面底部一成是空的（发射带 {top:.0}%–{bottom:.0}%），\
             这就是「只铺满了一半」",
            recipe.qualified_id(),
        );
    }
    assert!(checked >= 5, "应有至少 5 款从上半段起跑，实得 {checked}");
}
